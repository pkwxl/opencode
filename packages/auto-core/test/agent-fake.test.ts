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

import { beforeEach, describe, expect, test } from "bun:test"
import type { AgentEvent } from "../src/agent/types"
import { attempt } from "../src/attempt"
import { degrade } from "../src/capability"
import type { SessionChain } from "../src/chain"
import type { Opts } from "../src/opts"
import { forkSession, probeSession, resetServerModelCache, seedForkSession, sessionAlive, sessionUsage, sessionUsed } from "../src/session-api"
import { runSession } from "../src/session"
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

beforeEach(() => resetServerModelCache())

describe("dispatch and settle", () => {
  test("a new session: subscribe before dispatch, the closing words, usage and window from the agent", async () => {
    const agent = make({ defaultModel: "fake/default" })
    const chain = fresh()
    const result = await runSession(agent.client, task, "do it", { agent: "build" }, chain, undefined, undefined, DEFAULTS)
    expect(result).toEqual({ type: "idle", lastText: "done: do it", testHandover: false })
    // Order: create → events → prompt (events emitted after subscribe are delivered).
    const order = names(agent)
    expect(order.indexOf("create")).toBeLessThan(order.indexOf("events"))
    expect(order.indexOf("events")).toBeLessThan(order.indexOf("prompt"))
    // No model routed: the prompt carries no model key; the agent's default is shown only.
    expect(agent.prompts).toEqual([{ session: "ses_1", agent: "build", text: "do it" }])
    expect(agent.argsOf("defaultModel")).toEqual([["build"]])
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
    expect(agent.argsOf("defaultModel")).toEqual([])
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
    // One session per prompt, nothing but the three calls a one-shot agent needs
    // (plus the display-only default-model lookup, cached per agent name).
    expect(new Set(names(agent))).toEqual(new Set<AgentCall>(["create", "events", "prompt", "defaultModel"]))
    expect(agent.argsOf("create")).toHaveLength(2)
  })

  test("--test-by-driver needs steer: the one configuration without a fallback", () => {
    expect(degrade(BARE_CAPABILITIES, DEFAULTS, { testByDriver: true }).error).toContain("--test-by-driver")
  })
})

// Runs last (bun runs a file's tests in order): the roster check.
describe("coverage", () => {
  test("every AgentClient call was exercised by this suite", () => {
    const seen = new Set(agents.flatMap((agent) => agent.calls.map((c) => c.name)))
    expect(AGENT_CALLS.filter((call) => !seen.has(call))).toEqual([])
  })
})
