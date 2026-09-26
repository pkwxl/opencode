// The driver over a native AgentClient (MA.6): no SDK shape and no adapter,
// only src/agent/types.ts. Every session-driving path the driver owns —
// dispatch and settle, usage and window, steer, length resume, questions,
// permissions, error signals, retries, forks, history, liveness — runs here
// against test/fixtures/agent.ts, under the full capability set and under the
// barest one. The suite closes by checking that all fourteen AgentClient calls
// were exercised.
//
// The opencode-shaped fakes (fixtures/runner.ts) keep covering the opencode
// adapter's mapping end to end; test/agent-claude.test.ts does the same for
// claude. This file is the agent-neutral layer between them.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentEvent, AgentHost } from "../src/agent/types"
import { attempt } from "../src/attempt"
import { singleHost } from "../src/agent-pool"
import { requireArtifact } from "../src/artifact"
import { degrade } from "../src/capability"
import type { SessionChain } from "../src/chain"
import type { Interactive } from "../src/interactive"
import type { ModelEntry, ModelRegistry, TierList } from "../src/models"
import type { Opts } from "../src/opts"
import { isModelDown, modelDownMark, resetFailback, clearDownMarks } from "../src/failback"
import { resetClassifier } from "../src/classify"
import { activateRings, resetKeyring, ringHasUsableKey, spawnKeyConfig } from "../src/keyring"
import { resetSteps } from "../src/model-step"
import { isoInZone, parseWindow } from "../src/model-window"
import { logRunRouting, type RoutingFacts } from "../src/routing"
import { recallProgress, saveProgress } from "../src/resume"
import { forkSession, probeSession, seedForkSession, sessionAlive, sessionUsage, sessionUsed } from "../src/session-api"
import { runSession } from "../src/session"
import { flushStats, setStatsClock } from "../src/stats"
import { parseSwitches, SWITCH_ENV } from "../src/switches"
import { watch } from "../src/watch"
import { AGENT_CALLS, type AgentCall, BARE_CAPABILITIES, ev, type FakeAgent, fakeAgent, type FakeAgentOptions, MODEL, WINDOW } from "./fixtures/agent"
import { task } from "./fixtures/runner"

// Every fake made in this file (the closing roster check reads their calls).
const agents: FakeAgent[] = []
const make = (options?: FakeAgentOptions): FakeAgent => {
  const agent = fakeAgent(options)
  agents.push(agent)
  return agent
}

const opts: Opts = {}
const DEFAULTS = parseSwitches({})
const fresh = (): SessionChain => ({ pct: 100, used: 0, at: 0 })
const names = (agent: FakeAgent) => agent.calls.map((c) => c.name)

// A finite stream for driving watch() directly (the end of the iterable is
// what a transport loss looks like).
async function* stream(events: AgentEvent[]) {
  for (const event of events) yield event
}

describe("dispatch and settle", () => {
  test("a new session: subscribe before dispatch, the closing words, usage and window from the agent", async () => {
    const agent = make()
    const chain = fresh()
    const result = await runSession(agent.client, task, "do it", { agent: "build" }, chain, undefined, undefined, DEFAULTS)
    expect(result).toEqual({ type: "idle", lastText: "done: do it", testHandover: false })
    // Order: create → events → prompt (events emitted after subscribe are delivered).
    const order = names(agent)
    expect(order.indexOf("create")).toBeLessThan(order.indexOf("events"))
    expect(order.indexOf("events")).toBeLessThan(order.indexOf("prompt"))
    // No model routed: the prompt carries no model key; the model the agent
    // reports on its messages is what the driver displays.
    expect(agent.prompts).toEqual([{ session: "ses_1", agent: "build", text: "do it" }])
    // The completed message measured 1000 tokens against the model's window.
    expect(chain.id).toBe("ses_1")
    expect(chain.used).toBe(1000)
    expect(chain.pct).toBe(Math.round((1000 / WINDOW) * 100))
  })

  test("a routed model travels as the agent's opaque model string", async () => {
    const agent = make()
    const switches = parseSwitches({ [SWITCH_ENV.model]: "fake/model-2" })
    await runSession(agent.client, task, "p", {}, fresh(), undefined, undefined, switches)
    expect(agent.prompts[0]!.model).toBe("fake/model-2")
  })

  test("create or dispatch failing: blocked with the agent's error, never thrown", async () => {
    const created = make({ fail: { create: new Error("no room") } })
    const outcome = await attempt(created.client, task, "p", opts, fresh(), undefined, undefined, DEFAULTS)
    expect(outcome).toEqual({ type: "blocked", question: expect.stringContaining("session creation failed") })
    const dispatched = make({ fail: { prompt: new Error("refused") } })
    const second = await attempt(dispatched.client, task, "p", opts, fresh(), undefined, undefined, DEFAULTS)
    expect(second.type).toBe("blocked")
    expect((second as { question: string }).question).toContain("task dispatch failed")
  })

  test("reuse on: the chain's session takes the next prompt and is renamed to the new subject", async () => {
    const agent = make()
    const switches = parseSwitches({ [SWITCH_ENV.reuseSession]: "on" })
    const chain: SessionChain = { ...fresh(), subject: "T-001 S1 first" }
    await runSession(agent.client, task, "one", opts, chain, undefined, undefined, switches)
    chain.subject = "T-001 S2 second"
    await runSession(agent.client, task, "two", opts, chain, undefined, undefined, switches)
    expect(agent.argsOf("create")).toHaveLength(1)
    expect(agent.prompts.map((p) => p.session)).toEqual(["ses_1", "ses_1"])
    expect(agent.argsOf("rename")).toEqual([["ses_1", expect.stringContaining("S2")]])
  })
})

describe("usage tiers", () => {
  test("events: the steer hint goes into the live session once the figure reaches the cap", async () => {
    const agent = make()
    const chain = fresh()
    await runSession(agent.client, task, "p", opts, chain, { limit: 500, text: "hand over" }, undefined, DEFAULTS)
    expect(agent.steers).toEqual(["hand over"])
    expect(chain.hinted).toBe(true)
  })

  test("reported: the same figure arrives at turn end, so no in-turn hint", async () => {
    const agent = make({ capabilities: { usage: "reported" } })
    const chain = fresh()
    await runSession(agent.client, task, "p", opts, chain, { limit: 500, text: "hand over" }, undefined, DEFAULTS)
    expect(agent.steers).toEqual([])
    expect(chain.used).toBe(1000)
  })

  test("none: nothing measured — no hint, no figure, the share counts as full", async () => {
    const agent = make({ capabilities: { usage: "none" } })
    const chain = fresh()
    await runSession(agent.client, task, "p", opts, chain, { limit: 500, text: "hand over" }, undefined, DEFAULTS)
    expect(agent.steers).toEqual([])
    expect(chain.used).toBe(0)
    expect(chain.pct).toBe(100)
    expect(agent.argsOf("contextLimits")).toEqual([])
  })
})

describe("length resume", () => {
  const truncated = (ctx: { session: string; n: number }) => [ev.step(ctx.session, `stp_${ctx.n}`, "length"), ev.idle(ctx.session)]
  const resumed = (ctx: { session: string }) => [ev.text(ctx.session, "txt_resumed", "finished"), ev.step(ctx.session, "stp_resumed"), ev.idle(ctx.session)]

  test("steer: a truncated turn is told to continue and settles on the continuation", async () => {
    const agent = make({ turn: truncated, steer: resumed })
    const result = await runSession(agent.client, task, "p", opts, fresh(), undefined, undefined, DEFAULTS)
    expect(result).toEqual({ type: "idle", lastText: "finished", testHandover: false })
    expect(agent.steers).toHaveLength(1)
  })

  test("no steer: the truncated turn ends as it is", async () => {
    const agent = make({ capabilities: { steer: false }, turn: truncated, steer: resumed })
    const result = await runSession(agent.client, task, "p", opts, fresh(), undefined, undefined, DEFAULTS)
    expect(result).toEqual({ type: "idle", lastText: "", testHandover: false })
    expect(agent.argsOf("promptAsync")).toEqual([])
  })
})

describe("questions and permissions", () => {
  test("a question is answered; the same question again is rejected, the turn aborted, the run blocked", async () => {
    const agent = make()
    const first = await watch(agent.client, "s", stream([ev.question("s", "q1", "which db?"), ev.idle("s")]), opts)
    expect(first.blocked).toBeUndefined()
    expect(agent.argsOf("replyQuestion")).toEqual([["q1", [[expect.any(String)]]]])
    const again = await watch(agent.client, "s", stream([ev.question("s", "q1", "which db?"), ev.question("s", "q2", "which db?"), ev.idle("s")]), opts)
    expect(again.blocked?.question).toContain("which db?")
    expect(agent.argsOf("rejectQuestion")).toEqual([["q2"]])
    expect(agent.argsOf("abort")).toEqual([["s"]])
  })

  test("permissions settle per --permission: auto-allow grants, ask-deny refuses and goes on, ask-fail blocks", async () => {
    const perm = (request: string) => ev.permission("s", request, "bash", "rm -rf build")
    const allow = make()
    await watch(allow.client, "s", stream([perm("p1"), ev.idle("s")]), { permission: "auto-allow" })
    expect(allow.argsOf("replyPermission")).toEqual([["p1", "always"]])
    const deny = make()
    const denied = await watch(deny.client, "s", stream([perm("p2"), ev.idle("s")]), { permission: "ask-deny" })
    expect(deny.argsOf("replyPermission")).toEqual([["p2", "reject"]])
    expect(denied.blocked).toBeUndefined()
    const fail = make()
    const failed = await watch(fail.client, "s", stream([perm("p3"), ev.idle("s")]), { permission: "ask-fail" })
    expect(fail.argsOf("replyPermission")).toEqual([["p3", "reject"]])
    expect(fail.argsOf("abort")).toEqual([["s"]])
    expect(failed.blocked?.question).toContain("ask-fail")
  })

  test("events of other sessions are ignored", async () => {
    const agent = make()
    const result = await watch(agent.client, "s", stream([ev.question("other", "q", "?"), ev.text("other", "t", "not mine"), ev.idle("s")]), opts)
    expect(result.lastText).toBe("")
    expect(agent.argsOf("replyQuestion")).toEqual([])
  })

  // plan's sessions (Opts.humanQuestions): a question is the human's call —
  // the driver waits for the answer with no timeout and never proxy-answers
  // (no AUTO-RESOLVE); a closed input or a repeated question blocks.
  const line = (answer: string | undefined): Interactive =>
    ({ attach: () => {}, question: async () => answer, close: () => {} }) as unknown as Interactive

  test("plan's sessions (humanQuestions): the human answers; no proxy answer, no resolve recorded", async () => {
    const agent = make()
    const result = await watch(agent.client, "s", stream([ev.question("s", "q1", "which db?"), ev.idle("s")]), {
      humanQuestions: true,
      interactive: line("use postgres"),
    })
    expect(result.blocked).toBeUndefined()
    expect(result.resolves).toEqual([])
    expect(agent.argsOf("replyQuestion")).toEqual([["q1", [["use postgres"]]]])
  })

  test("plan's sessions (humanQuestions): a closed input blocks; the same question again blocks", async () => {
    const closed = make()
    const blocked = await watch(closed.client, "s", stream([ev.question("s", "q1", "which db?"), ev.idle("s")]), {
      humanQuestions: true,
      interactive: line(undefined),
    })
    expect(blocked.blocked?.question).toContain("which db?")
    expect(closed.argsOf("replyQuestion")).toEqual([])
    expect(closed.argsOf("rejectQuestion")).toEqual([["q1"]])
    expect(closed.argsOf("abort")).toEqual([["s"]])
    const attended = make()
    const again = await watch(
      attended.client,
      "s",
      stream([ev.question("s", "q1", "which db?"), ev.question("s", "q2", "which db?"), ev.idle("s")]),
      { humanQuestions: true, interactive: line("use postgres") },
    )
    expect(attended.argsOf("replyQuestion")).toEqual([["q1", [["use postgres"]]]])
    expect(again.blocked?.question).toContain("asked again about the same question after the human's answer")
    expect(attended.argsOf("rejectQuestion")).toEqual([["q2"]])
  })
})

describe("error signals", () => {
  test("the agent's own error wording classifies through its errorPatterns", async () => {
    const own = make({ errorPatterns: { overflow: /FakeWindowFull/ } })
    const result = await watch(own.client, "s", stream([ev.error("s", { name: "FakeWindowFull", message: "too long" }), ev.idle("s")]), opts)
    expect(result.errorClass).toBe("overflow")
    const neutral = make()
    const plain = await watch(neutral.client, "s", stream([ev.error("s", { name: "FakeWindowFull", message: "too long" }), ev.idle("s")]), opts)
    expect(plain.errorClass).not.toBe("overflow")
  })

  test("a retry signal classed as quota settles early and aborts the running turn", async () => {
    const agent = make()
    const result = await watch(agent.client, "s", stream([{ type: "retry", session: "s", attempt: 1, error: { message: "usage limit reached", statusCode: 429 } }]), opts)
    expect(result.failover).toBe(true)
    expect(agent.argsOf("abort")).toEqual([["s"]])
  })

  test("a stream that ends without idle is a transport loss: abort, then a session error", async () => {
    const agent = make()
    const result = await watch(agent.client, "s", stream([ev.text("s", "t", "half")]), opts)
    expect(result.error).toContain("event stream interrupted")
    expect(agent.argsOf("abort")).toEqual([["s"]])
  })

  const failing = (ctx: { session: string; n: number }) =>
    ctx.n === 1 ? [ev.message(ctx.session, "msg_fail", 5000), ev.error(ctx.session, { name: "APIError", message: "upstream hiccup" }), ev.idle(ctx.session)] : undefined

  test("retryable error, fork capable: the retry continues on a fork of the failed session", async () => {
    const agent = make({ turn: failing })
    const result = await runSession(agent.client, task, "p", opts, fresh(), undefined, undefined, DEFAULTS)
    expect(result.type).toBe("idle")
    expect(agent.argsOf("fork")).toEqual([["ses_1", undefined]])
    expect(agent.argsOf("rename")).toHaveLength(1)
    expect(agent.prompts.map((p) => p.session)).toEqual(["ses_1", "ses_2"])
  })

  test("retryable error, no fork: the retry opens a new session and sends no fork request", async () => {
    const agent = make({ capabilities: { fork: "none" }, turn: failing })
    const result = await runSession(agent.client, task, "p", opts, fresh(), undefined, undefined, DEFAULTS)
    expect(result.type).toBe("idle")
    expect(agent.argsOf("fork")).toEqual([])
    expect(agent.argsOf("create")).toHaveLength(2)
  })
})

describe("forks, history and liveness", () => {
  const history = {
    ses_base: [
      { id: "m1", role: "user" as const, completed: true, failed: false },
      { id: "m2", role: "assistant" as const, completed: true, failed: false, model: MODEL, contextUsed: 30_000 },
      { id: "m3", role: "assistant" as const, completed: false, failed: true, model: MODEL, contextUsed: 0 },
    ],
  }

  test("fork granularity: message keeps the anchor, session drops it, none sends nothing", async () => {
    const byMessage = make({ history })
    expect(await forkSession(byMessage.client, "ses_base", "T-001 S1 x", "m2")).toBe("ses_1")
    expect(byMessage.argsOf("fork")).toEqual([["ses_base", "m2"]])
    expect(byMessage.argsOf("rename")).toEqual([["ses_1", expect.stringContaining("S1")]])
    const bySession = make({ capabilities: { fork: "session" }, history })
    await forkSession(bySession.client, "ses_base", "T-001 S1 x", "m2")
    expect(bySession.argsOf("fork")).toEqual([["ses_base", undefined]])
    const none = make({ capabilities: { fork: "none" } })
    expect(await forkSession(none.client, "ses_base", "T-001 S1 x", "m2")).toBeUndefined()
    expect(none.calls).toEqual([])
  })

  test("history: usage rebuilt from the last measured assistant message; without it, unknown and unasked", async () => {
    const agent = make({ history })
    expect(await sessionUsage(agent.client, "ses_base")).toEqual({ used: 30_000, pct: 30, limit: WINDOW, errorStub: false })
    const blind = make({ capabilities: { history: false }, history })
    expect(await sessionUsed(blind.client, "ses_base")).toBeUndefined()
    expect(blind.argsOf("messages")).toEqual([])
  })

  test("fork base: a measured base seeds a warm fork; an unmeasurable base starts cold", async () => {
    const base = async (agent: FakeAgent) => ({ id: "ses_base", used: await sessionUsed(agent.client, "ses_base") })
    const agent = make({ history })
    const chain = fresh()
    expect(await seedForkSession(agent.client, opts, chain, await base(agent), "T-001 S1 x")).toBe(true)
    expect(chain.pending).toBe("ses_1")
    expect(chain.used).toBe(30_000)
    // No readable history: the base's size is unknown, so it counts as full (plans/0038 G1).
    const blind = make({ capabilities: { history: false }, history })
    const cold = fresh()
    expect(await seedForkSession(blind.client, opts, cold, await base(blind), "T-001 S1 x")).toBe(false)
    expect(cold.pending).toBeUndefined()
    expect(blind.calls).toEqual([])
  })

  test("liveness: get answers resume checks and the in-flight probe; no resume means nothing is alive", async () => {
    const agent = make({ gone: ["ses_dead"] })
    expect(await sessionAlive(agent.client, "ses_live")).toBe(true)
    expect(await sessionAlive(agent.client, "ses_dead")).toBe(false)
    expect(await probeSession(agent.client, "ses_live")).toBe(true)
    const oneShot = make({ capabilities: { resume: false } })
    expect(await sessionAlive(oneShot.client, "ses_live")).toBe(false)
    expect(oneShot.argsOf("get")).toEqual([])
  })
})

describe("the barest agent", () => {
  test("degrade clamps every switch it can, and a session still runs on create + events + prompt alone", async () => {
    const on = parseSwitches({
      [SWITCH_ENV.fork]: "on",
      [SWITCH_ENV.reuseSession]: "on",
      [SWITCH_ENV.steer]: "on",
      [SWITCH_ENV.stuck]: "on",
      [SWITCH_ENV.ask]: "on",
    })
    const degraded = degrade(BARE_CAPABILITIES, on, {})
    expect(degraded.switches).toEqual({ fork: false, reuseSession: false, steer: false, stuck: false, ask: false })
    expect(degraded.error).toBeUndefined()
    const switches = { ...on, ...degraded.switches }
    const agent = make({ capabilities: BARE_CAPABILITIES })
    const chain = fresh()
    const first = await runSession(agent.client, task, "one", opts, chain, { limit: 1, text: "hand over" }, undefined, switches)
    const second = await runSession(agent.client, task, "two", opts, chain, { limit: 1, text: "hand over" }, undefined, switches)
    expect([first, second]).toEqual([
      { type: "idle", lastText: "done: one", testHandover: false },
      { type: "idle", lastText: "done: two", testHandover: false },
    ])
    // One session per prompt, nothing but the three calls a one-shot agent needs.
    expect(new Set(names(agent))).toEqual(new Set<AgentCall>(["create", "events", "prompt"]))
    expect(agent.argsOf("create")).toHaveLength(2)
  })

  test("--test-by-driver needs steer: the one configuration without a fallback", () => {
    expect(degrade(BARE_CAPABILITIES, DEFAULTS, { testByDriver: true }).error).toContain("--test-by-driver")
  })
})

// Registry-driven dispatch (plans/0055 §6, §7): selection picks the model of
// every prompt under a hand-built registry (opts.routing), a classified
// failure marks the model down and fails over along the tier list on the
// same agent, the recovery probe clears a mark, windows gate dispatches
// without ever aborting a running turn, and a dispatch with only
// closed-window candidates waits inside the unit for the opening plus
// hibernate's jitter.
describe("registry routing (plans/0055 §6, §7)", () => {
  const entry = (name: string, fields: Partial<ModelEntry> = {}): ModelEntry => ({ name, layer: "operator", agent: "opencode", ...fields })
  const tierList = (tier: "deep" | "simple", names: string[]): TierList => ({ tier, names, layer: "operator" })

  // The routing facts of a one-agent fleet: deep [a, b], simple [s] unless a
  // fixture overrides the models, the tiers, the clock or the window wait's
  // random/sleep knobs.
  const facts = (
    models: ModelEntry[],
    over: {
      tiers?: Partial<Record<"deep" | "simple", TierList>>
      clock?: () => number
      random?: () => number
      sleep?: (ms: number) => Promise<void>
    } = {},
  ): RoutingFacts => ({
    registry: {
      layers: [{ name: "operator", path: "/unused/models.json" }],
      tz: "UTC",
      agents: new Map([["opencode", { name: "opencode", layer: "operator", adapter: "opencode" }]]),
      models: new Map(models.map((item) => [item.name, item])),
      tiers: over.tiers ?? { deep: tierList("deep", ["a", "b"]), simple: tierList("simple", ["s"]) },
      routes: new Map(),
      unused: [],
    },
    agentFilter: "opencode",
    filterSource: undefined,
    defaultAgent: "opencode",
    runAgent: "opencode",
    ...(over.clock ? { clock: over.clock } : {}),
    ...(over.random ? { random: over.random } : {}),
    ...(over.sleep ? { sleep: over.sleep } : {}),
  })

  const FLEET = [entry("a", { model: "prov/a" }), entry("b", { model: "prov/b" }), entry("s", { model: "prov/s" })]
  const deep: Opts = { routing: facts(FLEET) }
  // The chain of a deep session: decompose routes deep by default.
  const deepChain = (): SessionChain => ({ pct: 100, used: 0, at: 0, role: "decompose" })
  const quotaTurn = (ctx: { session: string; n: number }): AgentEvent[] | undefined =>
    ctx.n === 1
      ? [
          ev.message(ctx.session, `msg_fail_${ctx.n}`, 5000),
          ev.error(ctx.session, { name: "APIError", message: "usage limit reached, quota exceeded", isRetryable: false }),
          ev.idle(ctx.session),
        ]
      : undefined

  beforeEach(() => {
    resetFailback()
  })

  test("every prompt names the tier's first model; the dispatch line format comes from the selection", async () => {
    const agent = make()
    const chain = deepChain()
    await runSession(agent.client, task, "p", deep, chain, undefined, undefined, DEFAULTS)
    expect(agent.prompts[0]).toMatchObject({ model: "prov/a" })
    expect(agent.prompts[0]).not.toHaveProperty("variant")
    expect(chain.modelEntry).toBe("a")
    expect(chain.modelStep).toBe(0)
  })

  test("tier-ordered failover on one agent: quota marks the model down, the next candidate takes over via a fork", async () => {
    const agent = make({ turn: quotaTurn })
    const chain = deepChain()
    const result = await runSession(agent.client, task, "p", deep, chain, undefined, undefined, DEFAULTS)
    expect(result).toEqual({ type: "idle", lastText: expect.stringContaining("done:"), testHandover: false })
    // First prompt on the primary, the failover fork's prompt on the second
    // candidate of the tier list.
    expect(agent.prompts.map((p) => p.model)).toEqual(["prov/a", "prov/b"])
    expect(agent.argsOf("fork")).toEqual([["ses_1", undefined]])
    expect(chain.modelEntry).toBe("b")
    expect(isModelDown("a", Date.now())).toBe(true)
    expect(isModelDown("b", Date.now())).toBe(false)
  })

  test("a new prompt returns to the primary once its mark clears at the scope boundary", async () => {
    const agent = make({ turn: quotaTurn })
    const chain = deepChain()
    await runSession(agent.client, task, "p", deep, chain, undefined, undefined, DEFAULTS)
    // The task boundary under the default task scope: the marks clear, the
    // next task's chain re-selects and the primary is back.
    clearDownMarks("task", "task")
    const next = deepChain()
    await runSession(agent.client, task, "q", deep, next, undefined, undefined, DEFAULTS)
    expect(agent.prompts[2]!.model).toBe("prov/a")
    expect(next.modelEntry).toBe("a")
  })

  test("a continuation keeps the chain's model while it is usable, even after the primary is eligible again", async () => {
    const agent = make({ turn: quotaTurn })
    const chain = deepChain()
    const reuse = parseSwitches({ [SWITCH_ENV.reuseSession]: "on" })
    await runSession(agent.client, task, "p", deep, chain, undefined, undefined, reuse)
    clearDownMarks("task", "task")
    // The reused session is a continuation of the same prompt line: it stays
    // on the failover candidate although the primary is usable again.
    await runSession(agent.client, task, "q", deep, chain, undefined, undefined, reuse)
    expect(agent.prompts[2]).toMatchObject({ session: "ses_2", model: "prov/b" })
    expect(agent.argsOf("create")).toHaveLength(1)
  })

  test("a window closing mid-turn never aborts the turn; it finishes and the next dispatch selects again", async () => {
    let now = Date.parse("2026-09-25T12:00:30Z")
    const clock = () => now
    const only = parseWindow("00:00-12:01")
    if ("error" in only) throw new Error(only.error)
    const models = [entry("w", { model: "prov/w", only: [only.window] }), entry("b", { model: "prov/b" })]
    const routing = facts(models, { clock, tiers: { deep: tierList("deep", ["w", "b"]), simple: tierList("simple", ["w", "b"]) } })
    // The turn itself moves the clock past the window's end: the running turn
    // is never aborted (§4.4) — windows gate dispatches only.
    const agent = make({ turn: (ctx) => ((now = Date.parse("2026-09-25T12:02:00Z")), undefined) })
    const chain = deepChain()
    const result = await runSession(agent.client, task, "p", { routing }, chain, undefined, undefined, DEFAULTS)
    expect(result).toEqual({ type: "idle", lastText: expect.stringContaining("done:"), testHandover: false })
    expect(agent.argsOf("abort")).toEqual([])
    expect(agent.prompts[0]!.model).toBe("prov/w")
  })

  // §6.3's window wait: a deep dispatch whose only candidate is outside its
  // windows sleeps inside the unit until the earliest opening plus
  // hibernate's jitter, logs the wait line, books a `window` wait, and then
  // dispatches on the re-selection.
  test("a deep dispatch with only closed-window candidates waits for the opening plus jitter, then dispatches", async () => {
    let now = Date.parse("2026-09-25T12:00:00Z")
    const clock = () => now
    const only = parseWindow("18:00-24:00")
    if ("error" in only) throw new Error(only.error)
    const models = [entry("w", { model: "prov/w", only: [only.window] })]
    const dir = await mkdtemp(join(tmpdir(), "auto-window-"))
    const routing = facts(models, {
      clock,
      random: () => 0.25,
      sleep: async (ms) => {
        now += ms
      },
      tiers: { deep: tierList("deep", ["w"]), simple: tierList("simple", ["w"]) },
    })
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "))
    })
    setStatsClock(clock)
    try {
      const agent = make()
      const chain = deepChain()
      const result = await runSession(agent.client, task, "p", { routing, dir }, chain, undefined, undefined, DEFAULTS)
      expect(result).toEqual({ type: "idle", lastText: expect.stringContaining("done:"), testHandover: false })
      // The only prompt went out after the wait, on the candidate whose
      // window opened (the first attempt returned before dispatching; its
      // session was created and abandoned, so this is the second one).
      expect(agent.prompts).toHaveLength(1)
      expect(agent.prompts[0]).toMatchObject({ model: "prov/w" })
      // The wait covered the distance to the opening (6 h) plus a quarter of
      // hibernate's jitter (0.25 × 600 s = 150 s).
      expect(now).toBe(Date.parse("2026-09-25T18:02:30Z"))
      // One wait line naming the model and its opening, one line after.
      expect(lines.filter((line) => line.includes("waits for a deep model"))).toEqual([
        `⏸ T-001 decompose waits for a deep model: w opens 18:00 UTC, resuming around ${new Date(Date.parse("2026-09-25T18:02:30Z")).toISOString()} (local ${new Date(Date.parse("2026-09-25T18:02:30Z")).toLocaleString()}, includes random delay); press Ctrl+C twice to force-quit`,
      ])
      expect(lines).toContain("→ window wait over: continuing after w opened")
      // The interval was booked as a window wait: excluded from aiMs and
      // recorded as waitMs (clamped to the 30-minute booking tick).
      await flushStats(dir)
      const doc = JSON.parse(await Bun.file(join(dir, ".auto", "stats.json")).text())
      expect(doc.roundB.waitMs).toBe(1_800_000)
      expect(doc.roundB.aiMs).toBeLessThan(1_800_000)
    } finally {
      printed.mockRestore()
      setStatsClock()
      await rm(dir, { recursive: true, force: true })
    }
  })

  // §10 item 6: the machine clock decides after the wake. A suspend that
  // wakes past a short window simply waits for the next opening — the wait
  // never exits on its own (C5).
  test("a wake past the window (a suspend) waits again for the next opening instead of dispatching", async () => {
    let now = Date.parse("2026-09-25T12:00:00Z")
    const clock = () => now
    const only = parseWindow("18:00-20:00")
    if ("error" in only) throw new Error(only.error)
    const models = [entry("w", { model: "prov/w", only: [only.window] })]
    let wakes = 0
    const routing = facts(models, {
      clock,
      random: () => 0.25,
      // The first wake overshoots the window by seven hours, like a machine
      // that suspended; the second wakes exactly on time.
      sleep: async (ms) => {
        now += ms + (wakes++ === 0 ? 7 * 3_600_000 : 0)
      },
      tiers: { deep: tierList("deep", ["w"]), simple: tierList("simple", ["w"]) },
    })
    const agent = make()
    const chain = deepChain()
    const result = await runSession(agent.client, task, "p", { routing }, chain, undefined, undefined, DEFAULTS)
    expect(result).toEqual({ type: "idle", lastText: expect.stringContaining("done:"), testHandover: false })
    expect(agent.prompts).toHaveLength(1)
    expect(agent.prompts[0]).toMatchObject({ model: "prov/w" })
    expect(now).toBe(Date.parse("2026-09-26T18:02:30Z"))
  })

  test("a variant declared on the entry reaches the prompt body", async () => {
    const agent = make()
    const models = [entry("think", { model: "prov/big", variant: "high" })]
    await runSession(agent.client, task, "p", { routing: facts(models, { tiers: { deep: tierList("deep", ["think"]), simple: tierList("simple", ["think"]) } }) }, deepChain(), undefined, undefined, DEFAULTS)
    expect(agent.prompts[0]).toMatchObject({ model: "prov/big", variant: "high" })
  })

  test("an entry without model sends no model key; the agent's own default runs", async () => {
    const agent = make()
    const models = [entry("any")]
    const chain = deepChain()
    await runSession(agent.client, task, "p", { routing: facts(models, { tiers: { deep: tierList("deep", ["any"]), simple: tierList("simple", ["any"]) } }) }, chain, undefined, undefined, DEFAULTS)
    expect(agent.prompts[0]).not.toHaveProperty("model")
    expect(agent.prompts[0]).not.toHaveProperty("variant")
    expect(chain.modelEntry).toBe("any")
    expect(chain.model).toBeUndefined()
  })

  test("all candidates down: the wait-and-probe loop probes the first in-window candidate and continues on it when service is back", async () => {
    // Both candidates fail their first turns with quota; everything after
    // (the probe and the re-dispatch) succeeds.
    const quotaBoth = (ctx: { session: string; n: number }): AgentEvent[] | undefined =>
      ctx.n <= 2
        ? [
            ev.message(ctx.session, `msg_fail_${ctx.n}`, 5000),
            ev.error(ctx.session, { name: "APIError", message: "usage limit reached, quota exceeded", isRetryable: false }),
            ev.idle(ctx.session),
          ]
        : undefined
    const agent = make({ turn: quotaBoth })
    const chain = deepChain()
    const switches = parseSwitches({ [SWITCH_ENV.recoveryWait]: "0" })
    const result = await runSession(agent.client, task, "p", deep, chain, undefined, undefined, switches)
    expect(result).toEqual({ type: "idle", lastText: expect.stringContaining("done:"), testHandover: false })
    // a fails, b fails: both down → the probe clears a's mark, the probe
    // succeeds on it, and the re-dispatch continues there.
    expect(agent.prompts.map((p) => p.model)).toEqual(["prov/a", "prov/b", "prov/a", "prov/a"])
    expect(isModelDown("a", Date.now())).toBe(false)
    expect(isModelDown("b", Date.now())).toBe(true)
  })

  // Escalation step 3 (§7): a quota failure whose remaining candidates are
  // blocked only by their windows waits for the opening instead of handing a
  // closed window to the probe loop; the failover lands on the opened model.
  test("a failover onto a window-blocked list waits for the opening, then switches to the opened model", async () => {
    let now = Date.parse("2026-09-25T12:00:00Z")
    const only = parseWindow("18:00-24:00")
    if ("error" in only) throw new Error(only.error)
    const models = [entry("a", { model: "prov/a" }), entry("w", { model: "prov/w", only: [only.window] })]
    const routing = facts(models, {
      clock: () => now,
      random: () => 0,
      sleep: async (ms) => {
        now += ms
      },
      tiers: { deep: tierList("deep", ["a", "w"]), simple: tierList("simple", ["a", "w"]) },
    })
    const agent = make({ turn: quotaTurn })
    const chain = deepChain()
    const result = await runSession(agent.client, task, "p", { routing }, chain, undefined, undefined, DEFAULTS)
    expect(result.type).toBe("idle")
    // a fails with quota; w is closed until 18:00 — the failover waits the
    // six hours (zero jitter from the injected random) and forks onto w.
    expect(agent.prompts.map((p) => p.model)).toEqual(["prov/a", "prov/w"])
    expect(agent.argsOf("fork")).toEqual([["ses_1", undefined]])
    expect(chain.modelEntry).toBe("w")
    expect(now).toBe(Date.parse("2026-09-25T18:00:00Z"))
  })
})

// Key rings (plans/0055 §4.3, §7 step 1): a quota/auth/rate failure on a
// ringed provider first rotates the ring — the current key is marked down,
// the next key goes into the spawn config, the managed server restarts and
// the SAME model continues from a fork of the failed session. An exhausted
// ring falls through to model failover; a cleared key mark never moves the
// ring back; under an external server the rings are inactive, with a note.
describe("key rings (plans/0055 §4.3, §7 step 1)", () => {
  const entry = (name: string, fields: Partial<ModelEntry> = {}): ModelEntry => ({ name, layer: "operator", agent: "opencode", ...fields })
  const tierList = (tier: "deep" | "simple", names: string[]): TierList => ({ tier, names, layer: "operator" })
  const KEY_A = { kind: "env" as const, name: "PROV_KEY_A", ref: "{env:PROV_KEY_A}", label: "PROV_KEY_A" }
  const KEY_B = { kind: "env" as const, name: "PROV_KEY_B", ref: "{env:PROV_KEY_B}", label: "PROV_KEY_B" }
  const MODELS = [
    entry("a", { model: "prov/a", provider: "prov", keys: [KEY_A, KEY_B] }),
    entry("b", { model: "other/b", provider: "other" }),
  ]

  const facts = (): RoutingFacts => ({
    registry: {
      layers: [{ name: "operator", path: "/unused/models.json" }],
      tz: "UTC",
      agents: new Map([["opencode", { name: "opencode", layer: "operator", adapter: "opencode" }]]),
      models: new Map(MODELS.map((item) => [item.name, item])),
      tiers: { deep: tierList("deep", ["a", "b"]), simple: tierList("simple", ["b"]) },
      routes: new Map(),
      unused: [],
    },
    agentFilter: "opencode",
    filterSource: undefined,
    defaultAgent: "opencode",
    runAgent: "opencode",
  })
  const deepChain = (): SessionChain => ({ pct: 100, used: 0, at: 0, role: "decompose" })

  // A managed-host double: restart and setConfig are recorded, nothing
  // really restarts (the fake agent keeps answering for the same server).
  const fakeHost = () => {
    const restarts: string[] = []
    const configs: (Record<string, unknown> | undefined)[] = []
    const host: AgentHost = {
      client: undefined as never,
      syncContext: async () => {},
      restart: async (reason) => {
        restarts.push(reason)
        return true
      },
      setConfig: (config) => {
        configs.push(config)
      },
      close: () => {},
    }
    return { host, restarts, configs }
  }

  // A turn that fails with the given class on the first n prompts (0-token
  // stubs never fork well, so each failed turn also measures 5000 tokens).
  const classTurn = (message: string, statusCode?: number, fails = 1) => (ctx: { session: string; n: number }): AgentEvent[] | undefined =>
    ctx.n <= fails
      ? [ev.message(ctx.session, `msg_fail_${ctx.n}`, 5000), ev.error(ctx.session, { name: "APIError", message, ...(statusCode !== undefined ? { statusCode } : {}), isRetryable: message.includes("quota") ? false : undefined }), ev.idle(ctx.session)]
      : undefined

  const optsWith = (host: AgentHost, routing: RoutingFacts): Opts => ({ routing, server: singleHost(host) })

  beforeEach(() => {
    resetFailback()
    resetKeyring()
  })
  afterEach(() => {
    resetKeyring()
  })

  test("quota rotates to the next key: host restart, spawn config reference, same model from a fork", async () => {
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    })
    try {
      const routing = facts()
      activateRings(routing.registry, false)
      const agent = make({ turn: classTurn("usage limit reached, quota exceeded") })
      const { host, restarts, configs } = fakeHost()
      const chain = deepChain()
      const result = await runSession(agent.client, task, "p", optsWith(host, routing), chain, undefined, undefined, DEFAULTS)
      expect(result).toEqual({ type: "idle", lastText: expect.stringContaining("done:"), testHandover: false })
      // The same model was re-dispatched from a fork of the failed session.
      expect(agent.prompts.map((p) => p.model)).toEqual(["prov/a", "prov/a"])
      expect(agent.argsOf("fork")).toEqual([["ses_1", undefined]])
      expect(agent.prompts[1]!.text).toContain("next key of the ring")
      expect(chain.modelEntry).toBe("a")
      expect(isModelDown("a", Date.now())).toBe(false)
      // The host restarted once on the next key, and the spawn config names
      // the reference only — never a value.
      expect(restarts).toHaveLength(1)
      expect(restarts[0]).toContain("key 2/2 PROV_KEY_B")
      expect(configs).toEqual([{ provider: { prov: { options: { apiKey: "{env:PROV_KEY_B}" } } } }])
      expect(lines.some((line) => line.includes("key 1/2 PROV_KEY_A marked down, continuing the same model on key 2/2 PROV_KEY_B"))).toBe(true)
      expect(lines.join("\n")).not.toContain("sk-")
    } finally {
      printed.mockRestore()
    }
  })

  test("an exhausted ring falls through to model failover on the next candidate", async () => {
    const routing = facts()
    activateRings(routing.registry, false)
    const agent = make({ turn: classTurn("usage limit reached, quota exceeded", undefined, 2) })
    const { host, restarts, configs } = fakeHost()
    const chain = deepChain()
    const result = await runSession(agent.client, task, "p", optsWith(host, routing), chain, undefined, undefined, DEFAULTS)
    expect(result.type).toBe("idle")
    // a fails on key A (rotation), fails again on key B (exhausted): the
    // model itself is marked down and b takes over via a fork.
    expect(agent.prompts.map((p) => p.model)).toEqual(["prov/a", "prov/a", "other/b"])
    expect(restarts).toHaveLength(1)
    expect(configs).toHaveLength(1)
    expect(chain.modelEntry).toBe("b")
    expect(isModelDown("a", Date.now())).toBe(true)
    // Every key of the ring is down now, so §6.2 rule 4 keeps a out (the
    // spawn config still names the current key — a restart for any other
    // reason spawns on the last position).
    expect(ringHasUsableKey("prov", Date.now())).toBe(false)
    expect(spawnKeyConfig()).toEqual({ provider: { prov: { options: { apiKey: "{env:PROV_KEY_B}" } } } })
  })

  test("an auth failure counts as a key failure: the ring rotates too", async () => {
    const routing = facts()
    activateRings(routing.registry, false)
    // 401 with no isRetryable statement: the classifier reads auth (a revoked
    // key looks like one).
    const agent = make({ turn: classTurn("unauthorized", 401) })
    const { host, restarts, configs } = fakeHost()
    const chain = deepChain()
    const result = await runSession(agent.client, task, "p", optsWith(host, routing), chain, undefined, undefined, DEFAULTS)
    expect(result.type).toBe("idle")
    expect(agent.prompts.map((p) => p.model)).toEqual(["prov/a", "prov/a"])
    expect(restarts).toHaveLength(1)
    expect(configs).toEqual([{ provider: { prov: { options: { apiKey: "{env:PROV_KEY_B}" } } } }])
    expect(chain.modelEntry).toBe("a")
  })

  test("a cleared key mark does not move the ring back; only a failure of the current key advances it (wrapping onto the cleared key)", async () => {
    const routing = facts()
    activateRings(routing.registry, false)
    // First dispatch: turn 1 fails with quota, the ring rotates A → B.
    const first = fakeHost()
    const firstAgent = make({ turn: classTurn("usage limit reached, quota exceeded") })
    await runSession(firstAgent.client, task, "p", optsWith(first.host, routing), deepChain(), undefined, undefined, DEFAULTS)
    expect(first.configs).toEqual([{ provider: { prov: { options: { apiKey: "{env:PROV_KEY_B}" } } } }])
    // A scope boundary clears every mark: the ring stays on key B (the
    // config still names it — no restart churn) and the model is eligible
    // again, so the next dispatch selects a.
    clearDownMarks("task", "task")
    expect(spawnKeyConfig()).toEqual({ provider: { prov: { options: { apiKey: "{env:PROV_KEY_B}" } } } })
    // That dispatch fails on key B: only now does the ring move — wrapping
    // onto key A, whose mark the boundary cleared.
    const second = fakeHost()
    const secondAgent = make({ turn: classTurn("usage limit reached, quota exceeded") })
    const chain = deepChain()
    const result = await runSession(secondAgent.client, task, "q", optsWith(second.host, routing), chain, undefined, undefined, DEFAULTS)
    expect(result.type).toBe("idle")
    expect(secondAgent.prompts.map((p) => p.model)).toEqual(["prov/a", "prov/a"])
    expect(second.restarts).toHaveLength(1)
    expect(second.configs).toEqual([{ provider: { prov: { options: { apiKey: "{env:PROV_KEY_A}" } } } }])
    expect(chain.modelEntry).toBe("a")
  })

  test("under an external server the rings are inactive, with a note, and quota goes straight to model failover", async () => {
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    })
    try {
      const routing = facts()
      activateRings(routing.registry, true)
      logRunRouting(routing)
      expect(lines.some((line) => line.includes("key rings are inactive") && line.includes("external"))).toBe(true)
      expect(lines.some((line) => line.includes("ring 2"))).toBe(true)
      expect(lines.some((line) => line.includes("ring 1/2"))).toBe(false)
      // A quota failure cannot rotate (no restart possible): the model
      // failover of step 2 takes over directly.
      const agent = make({ turn: classTurn("usage limit reached, quota exceeded") })
      const { host, restarts, configs } = fakeHost()
      const chain = deepChain()
      const result = await runSession(agent.client, task, "p", optsWith(host, routing), chain, undefined, undefined, DEFAULTS)
      expect(result.type).toBe("idle")
      expect(agent.prompts.map((p) => p.model)).toEqual(["prov/a", "other/b"])
      expect(restarts).toEqual([])
      expect(configs).toEqual([])
      expect(chain.modelEntry).toBe("b")
    } finally {
      printed.mockRestore()
    }
  })
})

// Context steps (plans/0055 §4.5): an entry with `wider` steps a session up
// in place — the same session continues on the next id once its context
// reaches the step-up point, every steer names the id the session runs on,
// and the step lives with the session (a new one starts at the base).
describe("context steps (plans/0055 §4.5)", () => {
  const entry = (name: string, fields: Partial<ModelEntry> = {}): ModelEntry => ({ name, layer: "operator", agent: "opencode", ...fields })
  const tierList = (tier: "deep" | "simple", names: string[]): TierList => ({ tier, names, layer: "operator" })
  const facts = (models: ModelEntry[]): RoutingFacts => ({
    registry: {
      layers: [{ name: "operator", path: "/unused/models.json" }],
      tz: "UTC",
      agents: new Map([["opencode", { name: "opencode", layer: "operator", adapter: "opencode" }]]),
      models: new Map(models.map((item) => [item.name, item])),
      tiers: { deep: tierList("deep", ["k3"]), simple: tierList("simple", ["k3"]) },
      routes: new Map(),
      unused: [],
    },
    agentFilter: "opencode",
    filterSource: undefined,
    defaultAgent: "opencode",
    runAgent: "opencode",
  })
  const BASE = "prov/k3-256k"
  const WIDE = "prov/k3"
  // Base window 100k → step-up point 52k; the wider window 200k.
  const LIMITS = { [BASE]: 100_000, [WIDE]: 200_000 }
  const stepsOpts = (over: Partial<Opts> = {}): Opts => ({ routing: facts([entry("k3", { model: BASE, wider: [WIDE] })]), ...over })
  const deepChain = (): SessionChain => ({ pct: 100, used: 0, at: 0, role: "decompose" })
  const steerInputs = (agent: FakeAgent) => agent.argsOf("promptAsync").map((args) => args[0] as { session: string; text: string; model?: string })

  beforeEach(() => {
    resetFailback()
    resetSteps()
  })

  test("the steer at the step-up point names the next id and the chain records the reached step", async () => {
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    })
    try {
      let steered = 0
      const agent = make({
        limits: LIMITS,
        turn: (ctx) => (ctx.n === 1 ? [ev.message(ctx.session, "m1", 60_000)] : undefined),
        steer: (ctx) => {
          steered++
          return steered === 1 ? [ev.message(ctx.session, "m2", 61_000, { model: WIDE }), ev.idle(ctx.session)] : [ev.idle(ctx.session)]
        },
      })
      const chain = deepChain()
      const result = await runSession(agent.client, task, "p", stepsOpts(), chain, undefined, undefined, DEFAULTS)
      expect(result.type).toBe("idle")
      const steers = steerInputs(agent)
      expect(steers).toHaveLength(1)
      // The steer names the next id and carries the one-line note.
      expect(steers[0]).toMatchObject({ session: "ses_1", model: WIDE })
      expect(steers[0]!.text).toContain(WIDE)
      expect(steers[0]!.text).toContain(BASE)
      expect(lines.some((line) => line === `⇡ T-001 context 60.0k reached the step-up point of k3 (${BASE}); continuing the same session on ${WIDE}`)).toBe(true)
      expect(chain.modelEntry).toBe("k3")
      expect(chain.modelStep).toBe(1)
      expect(chain.model).toBe(WIDE)
    } finally {
      printed.mockRestore()
    }
  })

  test("a later steer in the same session keeps the reached step (the handover hint names it)", async () => {
    let steered = 0
    const agent = make({
      limits: LIMITS,
      turn: (ctx) => (ctx.n === 1 ? [ev.message(ctx.session, "m1", 60_000)] : undefined),
      steer: (ctx) => {
        steered++
        return steered === 1 ? [ev.message(ctx.session, "m2", 75_000, { model: WIDE })] : [ev.idle(ctx.session)]
      },
    })
    const chain = deepChain()
    const result = await runSession(agent.client, task, "p", stepsOpts(), chain, { limit: 70_000, text: "hand over" }, undefined, DEFAULTS)
    expect(result.type).toBe("idle")
    const steers = steerInputs(agent)
    expect(steers).toHaveLength(2)
    expect(steers[0]).toMatchObject({ model: WIDE })
    expect(steers[1]).toMatchObject({ model: WIDE, text: "hand over" })
    expect(chain.modelStep).toBe(1)
  })

  test("a continuation of the same session keeps its step; a new session starts at the base", async () => {
    let steered = 0
    const agent = make({
      limits: LIMITS,
      turn: (ctx) => (ctx.n === 1 ? [ev.message(ctx.session, "m1", 60_000)] : undefined),
      steer: (ctx) => {
        steered++
        return steered === 1 ? [ev.message(ctx.session, "m2", 61_000, { model: WIDE }), ev.idle(ctx.session)] : [ev.idle(ctx.session)]
      },
    })
    const reuse = parseSwitches({ [SWITCH_ENV.reuseSession]: "on" })
    const chain = deepChain()
    await runSession(agent.client, task, "p", stepsOpts(), chain, undefined, undefined, DEFAULTS)
    expect(agent.prompts[0]).toMatchObject({ model: BASE })
    // The chain's next prompt into the same session names the step it
    // reached (a large cap keeps the session under the reuse thresholds).
    await runSession(agent.client, task, "q", stepsOpts({ contextLimit: 200_000 }), chain, undefined, undefined, reuse)
    expect(agent.prompts[1]).toMatchObject({ session: "ses_1", model: WIDE })
    // The next task's chain is a new prompt: a new session at the base step.
    const next = deepChain()
    await runSession(agent.client, task, "r", stepsOpts(), next, undefined, undefined, DEFAULTS)
    expect(agent.prompts[2]).toMatchObject({ model: BASE })
    expect(agent.prompts[2]!.session).not.toBe("ses_1")
    expect(next.modelStep).toBe(0)
  })

  test("a compaction before the steer lands is logged as late; the next prompt names the next step", async () => {
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    })
    try {
      const agent = make({
        limits: LIMITS,
        errorPatterns: { overflow: /ContextOverflowError/i },
        // The turn overflows mid-flight (no completed message crossed the
        // step-up point first), the agent compacts and the session finishes
        // the turn on the shrunk context — the driver sees the overflow
        // error and the post-compaction measurement.
        turn: (ctx) =>
          ctx.n === 1
            ? [
                ev.error(ctx.session, { name: "ContextOverflowError", message: "context length exceeded, compacting" }),
                ev.message(ctx.session, "m1", 30_000),
                ev.idle(ctx.session),
              ]
            : undefined,
      })
      const chain = deepChain()
      const result = await runSession(agent.client, task, "p", stepsOpts(), chain, undefined, undefined, DEFAULTS)
      expect(result.type).toBe("idle")
      // No step-up steer went out; the overflow was absorbed as a late
      // step-up, and the retry ladder's fork of the compacted session
      // dispatches on the next step's id.
      expect(agent.argsOf("promptAsync")).toEqual([])
      expect(lines.some((line) => line.includes("step-up late") && line.includes(WIDE))).toBe(true)
      expect(agent.prompts.map((p) => p.model)).toEqual([BASE, WIDE])
      expect(chain.modelStep).toBe(1)
    } finally {
      printed.mockRestore()
    }
  })

  test("the cache-claim warning: a whole-prefix cacheWrite on the wider id contradicts the shared cache", async () => {
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    })
    try {
      let steered = 0
      const agent = make({
        limits: LIMITS,
        turn: (ctx) => (ctx.n === 1 ? [ev.message(ctx.session, "m1", 60_000)] : undefined),
        steer: (ctx) => {
          steered++
          return steered === 1
            ? [
                {
                  type: "part" as const,
                  session: ctx.session,
                  part: {
                    kind: "step-finish" as const,
                    id: "claim",
                    reason: "stop",
                    tokens: { input: 1000, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 55_000 },
                    cost: 0,
                  },
                },
                ev.message(ctx.session, "m2", 61_000, { model: WIDE }),
                ev.idle(ctx.session),
              ]
            : [ev.idle(ctx.session)]
        },
      })
      const chain = deepChain()
      const result = await runSession(agent.client, task, "p", stepsOpts(), chain, undefined, undefined, DEFAULTS)
      expect(result.type).toBe("idle")
      expect(lines.some((line) => line.includes("k3") && line.includes("does not share the base id's prompt cache"))).toBe(true)
    } finally {
      printed.mockRestore()
    }
  })

  test("an unknown step window disables the steps above it (no steer, base id kept)", async () => {
    const agent = make({
      limits: { [BASE]: 100_000 },
      turn: (ctx) => (ctx.n === 1 ? [ev.message(ctx.session, "m1", 60_000), ev.idle(ctx.session)] : undefined),
    })
    const chain = deepChain()
    const result = await runSession(agent.client, task, "p", stepsOpts(), chain, undefined, undefined, DEFAULTS)
    expect(result.type).toBe("idle")
    expect(agent.argsOf("promptAsync")).toEqual([])
    expect(agent.prompts[0]).toMatchObject({ model: BASE })
    expect(chain.modelStep).toBe(0)
  })

  test("without the steer capability the step lands on the next prompt into the session", async () => {
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    })
    try {
      const agent = make({
        capabilities: { steer: false },
        limits: LIMITS,
        // The turn crosses the step-up point and then fails transiently: the
        // step-up steer cannot go out (no steer capability), so the step
        // lands on the next prompt into this session — the retry ladder's
        // fork of it, the one continuation a stepped-up session can take
        // (reuse thresholds refuse a session this full).
        turn: (ctx) =>
          ctx.n === 1
            ? [ev.message(ctx.session, "m1", 60_000, { model: BASE }), ev.error(ctx.session, { message: "upstream hiccup" }), ev.idle(ctx.session)]
            : undefined,
      })
      const chain = deepChain()
      const result = await runSession(agent.client, task, "p", stepsOpts(), chain, undefined, undefined, DEFAULTS)
      expect(result.type).toBe("idle")
      expect(agent.argsOf("promptAsync")).toEqual([])
      expect(lines.some((line) => line.includes("the agent takes no mid-turn steers") && line.includes(WIDE))).toBe(true)
      expect(chain.modelStep).toBe(1)
      expect(agent.prompts.map((p) => p.model)).toEqual([BASE, WIDE])
    } finally {
      printed.mockRestore()
    }
  })

  test("on resume the step is recomputed from the context size in the session's history", async () => {
    const agent = make({
      limits: LIMITS,
      history: { ses_old: [{ id: "m0", role: "assistant", completed: true, model: WIDE, contextUsed: 61_000, failed: false }] },
    })
    // The recovery takeover shape: the session id with the resume note, and
    // the context size rebuilt from the history (the runner's usage figure).
    const chain: SessionChain = { ...deepChain(), id: "ses_old", used: 61_000, note: "[DRIVER] resume note" }
    await runSession(agent.client, task, "p", stepsOpts(), chain, undefined, undefined, DEFAULTS)
    expect(agent.prompts[0]).toMatchObject({ session: "ses_old", model: WIDE })
    expect(chain.modelStep).toBe(1)
  })

  test("no registry: steers stay exactly as today (no model key)", async () => {
    const agent = make()
    const chain = fresh()
    await runSession(agent.client, task, "p", opts, chain, { limit: 500, text: "hand over" }, undefined, DEFAULTS)
    expect(agent.argsOf("promptAsync")).toEqual([[{ session: "ses_1", text: "hand over" }]])
    expect(chain.modelStep).toBeUndefined()
  })
})

// The failure-message classifier (plans/0055 §7.1): a registry `classifier`
// entry reads the failure wording the patterns cannot settle, in a one-shot
// bare session beside the event stream. Its quota answer settles a turn the
// agent is still retrying (abort, then key → model → wait) long before the
// agent's own retries run out; a reset time sets when the down mark clears,
// also when the answer lands after the turn ended; its own failures mark
// only its entry.
describe("the failure-message classifier (plans/0055 §7.1)", () => {
  const entry = (name: string, fields: Partial<ModelEntry> = {}): ModelEntry => ({ name, layer: "operator", agent: "opencode", ...fields })
  const tierList = (tier: "deep" | "simple", names: string[]): TierList => ({ tier, names, layer: "operator" })
  const facts = (): RoutingFacts => ({
    registry: {
      layers: [{ name: "operator", path: "/unused/models.json" }],
      tz: "UTC",
      agents: new Map([["opencode", { name: "opencode", layer: "operator", adapter: "opencode" }]]),
      models: new Map([entry("a", { model: "prov/a" }), entry("b", { model: "prov/b" }), entry("free", { model: "free/model" })].map((item) => [item.name, item])),
      tiers: { deep: tierList("deep", ["a", "b"]), simple: tierList("simple", ["b"]) },
      routes: new Map(),
      unused: [],
      classifier: { names: ["free"], layer: "operator" },
    },
    agentFilter: "opencode",
    filterSource: undefined,
    defaultAgent: "opencode",
    runAgent: "opencode",
  })
  const deepChain = (): SessionChain => ({ pct: 100, used: 0, at: 0, role: "decompose" })
  // Wording no pattern knows (another language, a plan-specific limit).
  const UNKNOWN = "Ihr Kontingent für diesen Tarif ist erschöpft"
  const isClassify = (text: string) => text.includes("The error text:")
  const answerTurn = (text: string) => (session: string): AgentEvent[] => [ev.text(session, `cls_${session}`, text), ev.idle(session)]
  const capture = () => {
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    })
    return { lines, restore: () => printed.mockRestore() }
  }
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 200 && !done(); i++) await Bun.sleep(5)
  }

  beforeEach(() => {
    resetFailback()
    resetClassifier()
  })
  afterEach(() => {
    resetClassifier()
  })

  test("a quota answer during retries settles the turn before the agent's retries run out; bare reaches the prompt", async () => {
    const resetAt = Date.now() + 2 * 3_600_000
    // The primary's first turn only retries (the agent's own backoff, which
    // would run on for many minutes); every later turn is the default one.
    const agent = make({
      turn: (ctx) => {
        if (isClassify(ctx.text)) return answerTurn(`{"class": "quota", "resetAt": "${isoInZone(resetAt, "UTC")}"}`)(ctx.session)
        if (ctx.n === 1)
          return [ev.message(ctx.session, "msg_retrying", 5000), { type: "retry", session: ctx.session, id: "rty_1", attempt: 1, next: 2000, error: { message: UNKNOWN } }]
        return undefined
      },
    })
    const out = capture()
    try {
      const chain = deepChain()
      const result = await runSession(agent.client, task, "p", { routing: facts() }, chain, undefined, undefined, DEFAULTS)
      expect(result).toEqual({ type: "idle", lastText: expect.stringContaining("done:"), testHandover: false })
      // The primary, the classifier's one-shot session, then the failover
      // fork on the tier's next candidate.
      expect(agent.prompts.map((p) => p.model)).toEqual(["prov/a", "free/model", "prov/b"])
      const classify = agent.prompts[1]!
      expect(classify.bare).toBe(true)
      expect("agent" in classify).toBe(false)
      expect(agent.prompts[0]!.bare).toBeUndefined()
      expect(agent.prompts[2]!.bare).toBeUndefined()
      expect(agent.argsOf("create")).toContainEqual([{ title: "auto: classify error" }])
      // The retrying turn was aborted after its first retry: no more retries ran.
      expect(agent.argsOf("abort")).toContainEqual(["ses_1"])
      expect(chain.modelEntry).toBe("b")
      // The down mark lasts until the answer's reset time and remembers where
      // the class came from; the ⇄ and ◈ lines say so.
      expect(modelDownMark("a")).toEqual({ until: Math.floor(resetAt / 1000) * 1000, classifier: true })
      expect(out.lines.some((line) => line.includes("the classifier reads the failure as quota, resets"))).toBe(true)
      expect(out.lines.some((line) => line.includes("quota restricted (classifier)") && line.includes("a → b"))).toBe(true)
      expect(out.lines.some((line) => line.startsWith("◈ T-001 using model b") && line.includes("quota (classifier)"))).toBe(true)
    } finally {
      out.restore()
    }
  })

  test("the classifier's own failure is classified by the patterns alone and marks only its entry", async () => {
    // The primary's turn ends with a failure no pattern knows (the retry
    // ladder retries it); the classifier's session fails with quota wording.
    const agent = make({
      turn: (ctx) => {
        if (isClassify(ctx.text))
          return [ev.error(ctx.session, { name: "APIError", message: "insufficient_quota: the free tier is spent", isRetryable: false }), ev.idle(ctx.session)]
        if (ctx.n === 1)
          return [
            ev.message(ctx.session, "msg_fail", 5000),
            { type: "retry", session: ctx.session, id: "rty_1", attempt: 1, error: { message: UNKNOWN } },
            ev.error(ctx.session, { name: "APIError", message: UNKNOWN }),
            ev.idle(ctx.session),
          ]
        return undefined
      },
    })
    const chain = deepChain()
    const result = await runSession(agent.client, task, "p", { routing: facts() }, chain, undefined, undefined, DEFAULTS)
    expect(result.type).toBe("idle")
    await until(() => isModelDown("free", Date.now()))
    expect(isModelDown("free", Date.now())).toBe(true)
    // Neither the primary nor its fallback was touched: the unknown failure
    // took the retry ladder on the same model.
    expect(isModelDown("a", Date.now())).toBe(false)
    expect(isModelDown("b", Date.now())).toBe(false)
    expect(agent.prompts.filter((p) => p.bare === true)).toHaveLength(1)
    expect(agent.prompts.filter((p) => p.bare !== true).map((p) => p.model)).toEqual(["prov/a", "prov/a"])
    expect(chain.modelEntry).toBe("a")
  })

  test("an answer that lands after the turn ended only sets when the down mark clears", async () => {
    const resetAt = Date.now() + 3 * 3_600_000
    const inner = make({
      turn: (ctx) => {
        if (isClassify(ctx.text)) return answerTurn(`{"class": "quota", "resetAt": "${isoInZone(resetAt, "UTC")}"}`)(ctx.session)
        // The primary retries once on unknown wording, then the agent gives
        // up with a quota verdict the patterns settle on their own.
        if (ctx.n === 1)
          return [
            ev.message(ctx.session, "msg_fail", 5000),
            { type: "retry", session: ctx.session, id: "rty_1", attempt: 1, error: { message: UNKNOWN } },
            ev.error(ctx.session, { name: "APIError", message: "usage limit reached, quota exceeded", isRetryable: false }),
            ev.idle(ctx.session),
          ]
        return undefined
      },
    })
    // The classifier's dispatch is slow: its answer can only arrive after
    // the primary's turn has settled and the escalation marked a down.
    let release!: () => void
    const released = new Promise<void>((resolve) => (release = resolve))
    const client = {
      ...inner.client,
      prompt: async (input: Parameters<typeof inner.client.prompt>[0], signal?: AbortSignal) => {
        if (input.bare === true) await released
        return inner.client.prompt(input, signal)
      },
    }
    const out = capture()
    try {
      const chain = deepChain()
      const result = await runSession(client, task, "p", { routing: facts() }, chain, undefined, undefined, DEFAULTS)
      expect(result.type).toBe("idle")
      expect(chain.modelEntry).toBe("b")
      // Marked by the patterns' quota verdict, with no reset time yet.
      expect(modelDownMark("a")).toEqual({})
      release()
      await until(() => modelDownMark("a")?.until !== undefined)
      expect(modelDownMark("a")).toEqual({ until: Math.floor(resetAt / 1000) * 1000 })
      // The class it named came too late to change anything.
      expect(out.lines.some((line) => line.includes("the classifier's answer arrived after the turn ended: a stays down until"))).toBe(true)
      expect(out.lines.some((line) => line.includes("(classifier)"))).toBe(false)
    } finally {
      release()
      out.restore()
    }
  })

  test("without a classifier list nothing is asked and the retry branch is unchanged (C2)", async () => {
    const plain = facts()
    delete (plain.registry as { classifier?: unknown }).classifier
    const agent = make({
      turn: (ctx) =>
        ctx.n === 1
          ? [
              ev.message(ctx.session, "msg_fail", 5000),
              { type: "retry", session: ctx.session, id: "rty_1", attempt: 1, error: { message: UNKNOWN } },
              ev.error(ctx.session, { name: "APIError", message: UNKNOWN }),
              ev.idle(ctx.session),
            ]
          : undefined,
    })
    const result = await runSession(agent.client, task, "p", { routing: plain }, deepChain(), undefined, undefined, DEFAULTS)
    expect(result.type).toBe("idle")
    expect(agent.prompts.map((p) => p.model)).toEqual(["prov/a", "prov/a"])
    expect(agent.argsOf("create").some(([input]) => (input as { title: string }).title === "auto: classify error")).toBe(false)
  })
})

// Sessions bound to their agent (plans/0055 §8.2, §8.3): the persisted
// records carry the agent profile their session lives on, and on resume a
// recorded session is used only if its agent is this run's and its recorded
// model is usable now — otherwise it is a dead session, and the resume takes
// the existing path of a new session with the resume note.
describe("session-agent binding (plans/0055 §8.2, §8.3)", () => {
  const entry = (name: string, fields: Partial<ModelEntry> = {}): ModelEntry => ({ name, layer: "operator", agent: "opencode", ...fields })
  const tierList = (tier: "deep" | "simple", names: string[]): TierList => ({ tier, names, layer: "operator" })
  // Friday 2026-09-25 12:00 UTC: w's only window (18:00-24:00) is closed.
  const NOW = Date.parse("2026-09-25T12:00:00Z")
  const w = (() => {
    const parsed = parseWindow("18:00-24:00")
    if ("error" in parsed) throw new Error(parsed.error)
    return entry("w", { model: "prov/w", only: [parsed.window] })
  })()
  const facts = (): RoutingFacts => ({
    registry: {
      layers: [{ name: "operator", path: "/unused/models.json" }],
      tz: "UTC",
      agents: new Map([["opencode", { name: "opencode", layer: "operator", adapter: "opencode" }]]),
      models: new Map([w, entry("b", { model: "prov/b" })].map((item) => [item.name, item])),
      tiers: { deep: tierList("deep", ["w", "b"]), simple: tierList("simple", ["b"]) },
      routes: new Map(),
      unused: [],
    },
    agentFilter: "opencode",
    filterSource: undefined,
    defaultAgent: "opencode",
    runAgent: "opencode",
    clock: () => NOW,
  })
  const planTask = { id: "PLAN", title: "phase planning", status: "in_progress" as const, attempts: 0, body: "" }
  const spec = (reset: () => void) => ({
    kind: "phase planning",
    step: { step: "phase-plan" as const, unit: "R-01.P01" },
    artifact: "a filled task index",
    requirement: "write the index",
    reset: async () => {
      reset()
    },
    collect: async () => 4,
  })
  const seededRecord = async (dir: string, record: { agent?: string; model?: string }) => {
    await saveProgress(dir, {
      task: "PLAN",
      session: "ses_old",
      at: 1,
      active: true,
      phase: { kind: "step", step: "phase-plan", unit: "R-01.P01" },
      ...record,
    })
  }

  test("a session whose agent's model is not usable now is dead: the step is redone in a new session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-bind-dead-"))
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    })
    try {
      // w is outside its only window at the record's clock.
      await seededRecord(dir, { agent: "opencode", model: "w" })
      const agent = make()
      let resetCalled = false
      const value = await requireArtifact(agent.client, planTask, "planning prompt", { dir, routing: facts() }, spec(() => (resetCalled = true)), DEFAULTS)
      expect(value).toBe(4)
      // Dead session: the original is never prompted or forked; the step is
      // redone in a new session (the existing redo path: reset + fresh
      // dispatch, no note — the note belongs to the task-level resume).
      expect(resetCalled).toBe(true)
      expect(agent.prompts).toHaveLength(1)
      expect(agent.prompts[0]!.session).not.toBe("ses_old")
      expect(agent.argsOf("fork")).toEqual([])
      // The new session dispatches on a usable candidate, not the recorded w.
      expect(agent.prompts[0]!.model).toBe("prov/b")
      expect(lines.some((line) => line.includes("the recorded session's model w is not usable now") && line.includes("redoing this step in a new session"))).toBe(true)
      // The record the new dispatch writes names the run's agent.
      expect((await recallProgress(dir, "PLAN"))?.agent).toBe("opencode")
    } finally {
      printed.mockRestore()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a recorded session of another agent is dead even with a usable model", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-bind-agent-"))
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    })
    try {
      await seededRecord(dir, { agent: "claude-b", model: "b" })
      const agent = make()
      const value = await requireArtifact(agent.client, planTask, "planning prompt", { dir, routing: facts() }, spec(() => {}), DEFAULTS)
      expect(value).toBe(4)
      expect(agent.prompts).toHaveLength(1)
      expect(agent.prompts[0]!.session).not.toBe("ses_old")
      expect(agent.argsOf("fork")).toEqual([])
      expect(lines.some((line) => line.includes("the recorded session lives on agent claude-b") && line.includes("redoing this step in a new session"))).toBe(true)
    } finally {
      printed.mockRestore()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a live record on this run's agent with a usable model is resumed and keeps its model", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-bind-live-"))
    try {
      // b is the second candidate but the only usable one; the resumed
      // session continues on it (the continuation keeps the recorded entry).
      await seededRecord(dir, { agent: "opencode", model: "b" })
      const agent = make()
      let resetCalled = false
      const value = await requireArtifact(agent.client, planTask, "planning prompt", { dir, routing: facts() }, spec(() => (resetCalled = true)), DEFAULTS)
      expect(value).toBe(4)
      expect(resetCalled).toBe(false)
      expect(agent.prompts).toHaveLength(1)
      expect(agent.prompts[0]!.session).toBe("ses_old")
      expect(agent.prompts[0]!.text).toContain("You are continuing in the original, interrupted session")
      expect(agent.prompts[0]!.model).toBe("prov/b")
      expect(agent.argsOf("create")).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// Runs last (bun runs a file's tests in order): the roster check.
describe("coverage", () => {
  test("every AgentClient call was exercised by this suite", () => {
    const seen = new Set(agents.flatMap((agent) => agent.calls.map((c) => c.name)))
    expect(AGENT_CALLS.filter((call) => !seen.has(call))).toEqual([])
  })
})
