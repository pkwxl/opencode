// The driver over a native AgentClient (MA.6): no SDK shape and no adapter,
// only src/agent/types.ts. Every session-driving path the driver owns —
// dispatch and settle, usage and window, steer, length resume, questions,
// permissions, error signals, retries, forks, history, liveness — runs here
// against test/fixtures/agent.ts, under the full capability set and under the
// barest one. The suite closes by checking that all thirteen AgentClient calls
// were exercised.
//
// The opencode-shaped fakes (fixtures/runner.ts) keep covering the opencode
// adapter's mapping end to end; test/agent-claude.test.ts does the same for
// claude. This file is the agent-neutral layer between them.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentError, AgentEvent, AgentHost, AgentRetryPolicy } from "../src/agent/types"
import { attempt } from "../src/attempt"
import { singleHost, startPool } from "../src/agent-pool"
import { requireArtifact } from "../src/artifact"
import { degrade } from "../src/capability"
import { ExitRequested, exitRequested, requestExit, resetExitRequest } from "../src/exit"
import type { SessionChain, Watch } from "../src/chain"
import type { Interactive } from "../src/interactive"
import { loadModels, type ModelEntry, type ModelRegistry, type TierList } from "../src/models"
import type { Opts } from "../src/opts"
import { cachedAnswer } from "../src/classify"
import { isoInZone, parseWindow } from "../src/model-window"
import { logRunRouting, routingFacts, type RoutingFacts } from "../src/routing"
import { resetQuotaWindows } from "../src/quota-windows"
import { recallProgress, saveProgress } from "../src/resume"
import { runTask } from "../src/runner"
import { forkSession, probeSession, seedForkSession, sessionAlive, sessionUsage, sessionUsed } from "../src/session-api"
import { ensureForkBase, runSession } from "../src/session"
import { registerAgentAdapter, resetShellAdapters } from "../src/shell"
import { createServices, installServices, services, uninstallServices, type Clock } from "../src/services"
import { flushStats } from "../src/stats"
import { clampSwitches, parseSwitches, SWITCH_ENV } from "../src/switches"
import { handoffSteer } from "../src/testrun"
import { sessionHandoverDue } from "../src/usage"
import type { Plan, Task } from "../src/tasks"
import { watch } from "../src/watch"
import { AGENT_CALLS, type AgentCall, BARE_CAPABILITIES, ev, type FakeAgent, fakeAgent, fakeAgentHost, FULL_CAPABILITIES, type FakeAgentOptions, MODEL, WINDOW } from "./fixtures/agent"
import { clockAt, fixedClock, manualClock } from "./fixtures/clock"
import { freshRepo, git, task } from "./fixtures/runner"
import { reloadUnits, seedUnits, unitsText } from "./fixtures/units"

// Fresh failback/down-mark state mid-test (the moved state lives in the
// run's router and has no reset hook): reinstall the holder with a fresh
// router, keeping the clock the test steered — a plain createServices()
// would fall back to wall time.
const freshFailback = (): void => installServices(createServices({ clock: services().clock }))

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

  test("a resumed takeover: the chain's recorded session takes the next prompt and is renamed to the new subject", async () => {
    const agent = make()
    const chain: SessionChain = { ...fresh(), subject: "T-001 S1 first" }
    await runSession(agent.client, task, "one", opts, chain, undefined, undefined, DEFAULTS)
    chain.subject = "T-001 S2 second"
    // A recovery note on the chain's session is a takeover (resumed): the
    // next prompt continues that session instead of creating one.
    chain.note = "[driver] continuation after interruption"
    await runSession(agent.client, task, "two", opts, chain, undefined, undefined, DEFAULTS)
    expect(agent.argsOf("create")).toHaveLength(1)
    expect(agent.prompts.map((p) => p.session)).toEqual(["ses_1", "ses_1"])
    expect(agent.argsOf("rename")).toEqual([["ses_1", expect.stringContaining("S2")]])
  })
})

describe("usage tiers", () => {
  // A turn measuring 30k: past a 30k budget, which sits above the 100k
  // window's quarter floor (plans/0059 D6), so the wall is the budget.
  const at30k: FakeAgentOptions["turn"] = (ctx) => [ev.message(ctx.session, `m_${ctx.n}`, 30_000), ev.idle(ctx.session)]

  test("events: the steer hint goes into the live session once the figure reaches the cap", async () => {
    const agent = make({ turn: at30k })
    const chain = fresh()
    await runSession(agent.client, task, "p", opts, chain, { limit: 30_000, text: "hand over", notes: [] }, undefined, DEFAULTS)
    expect(agent.steers).toEqual(["hand over"])
    expect(chain.hinted).toBe(true)
    expect(chain.wall).toBe(30_000)
  })

  test("usage notices (plans/0056): each band steers once with the figures filled, at a completed-message measurement point", async () => {
    const agent = make({
      turn: (ctx) => [
        ev.message(ctx.session, `m_${ctx.n}_a`, 10_000),
        ev.message(ctx.session, `m_${ctx.n}_b`, 60_000),
        ev.message(ctx.session, `m_${ctx.n}_c`, 70_000),
        ev.idle(ctx.session),
      ],
    })
    const chain = fresh()
    // Wall = min(2×50k budget, 80%×100k window) = 80k; bands at 40k / 68k:
    // 10k crosses nothing, 60k the 50% band, 70k the 85% band.
    await runSession(agent.client, task, "p", opts, chain, handoffSteer(true, 50_000, task)!, undefined, DEFAULTS)
    expect(agent.steers).toHaveLength(2)
    expect(agent.steers[0]).toContain("60.0k")
    expect(agent.steers[0]).toContain("75%")
    expect(agent.steers[0]).toContain("80.0k")
    expect(agent.steers[1]).toContain("70.0k")
    expect(agent.steers[1]).toContain("88%")
    // Informational steers only: not a handover, nothing hinted.
    expect(chain.hinted).toBe(false)
  })

  test("a jump crossing bands and the wall together sends the hard-wall hint only, and the bands are spent with it", async () => {
    const agent = make({ turn: (ctx) => [ev.message(ctx.session, `m_${ctx.n}`, 90_000), ev.idle(ctx.session)] })
    const chain = fresh()
    await runSession(agent.client, task, "p", opts, chain, handoffSteer(true, 50_000, task)!, undefined, DEFAULTS)
    expect(agent.steers).toHaveLength(1)
    expect(agent.steers[0]).toContain("reached the wall")
    expect(chain.hinted).toBe(true)
  })

  test("the wall is clamped to 80% of the model's window: a figure under the 2×cap budget but past the window headroom hands over", async () => {
    const agent = make({ turn: (ctx) => [ev.message(ctx.session, `m_${ctx.n}`, 85_000), ev.idle(ctx.session)] })
    const chain = fresh()
    // Budget 500k ≫ the 100k window: without the clamp (85k < 500k) no hint.
    await runSession(agent.client, task, "p", opts, chain, handoffSteer(true, 250_000, task)!, undefined, DEFAULTS)
    expect(agent.steers).toHaveLength(1)
    expect(agent.steers[0]).toContain("reached the wall")
    expect(chain.hinted).toBe(true)
  })

  test("a large window raises the wall to a quarter of it (plans/0059 D6): past the 2×cap budget but under the wall is a notice, not a handover", async () => {
    const figures = [150_000, 260_000]
    const agent = make({ limits: { [MODEL]: 1_000_000 }, turn: (ctx) => [ev.message(ctx.session, `m_${ctx.n}`, figures[ctx.n - 1]), ev.idle(ctx.session)] })
    // The default cap: a 128k budget, a 250k wall on the 1M window.
    const steer = handoffSteer(true, 64_000, task)!
    const chain = fresh()
    await runSession(agent.client, task, "one", opts, chain, steer, undefined, DEFAULTS)
    // 150k crosses the 50% band of the 250k wall only.
    expect(agent.steers).toHaveLength(1)
    expect(agent.steers[0]).toContain("150.0k")
    expect(agent.steers[0]).toContain("60%")
    expect(agent.steers[0]).toContain("250.0k")
    expect(chain.hinted).toBe(false)
    expect(chain.wall).toBe(250_000)
    // The session was never asked for a handover, so finishing here is a
    // natural finish; measured against the budget alone it would be judged due.
    expect(sessionHandoverDue("events", steer, chain.used, chain.hinted, chain.wall)).toBe(false)
    expect(sessionHandoverDue("events", steer, chain.used, chain.hinted)).toBe(true)
    // A new session reaching the raised wall gets the hard-wall hint.
    const next = fresh()
    await runSession(agent.client, task, "two", opts, next, steer, undefined, DEFAULTS)
    expect(agent.steers).toHaveLength(2)
    expect(agent.steers[1]).toContain("reached the wall")
    expect(next.hinted).toBe(true)
    expect(sessionHandoverDue("events", steer, next.used, next.hinted, next.wall)).toBe(true)
  })

  test("reported: the same figure arrives at turn end, so no in-turn hint", async () => {
    const agent = make({ capabilities: { usage: "reported" } })
    const chain = fresh()
    await runSession(agent.client, task, "p", opts, chain, { limit: 500, text: "hand over", notes: [] }, undefined, DEFAULTS)
    expect(agent.steers).toEqual([])
    expect(chain.used).toBe(1000)
  })

  test("none: nothing measured — no hint, no figure, the share counts as full", async () => {
    const agent = make({ capabilities: { usage: "none" } })
    const chain = fresh()
    await runSession(agent.client, task, "p", opts, chain, { limit: 500, text: "hand over", notes: [] }, undefined, DEFAULTS)
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

// A stream with pauses (ms) between its events; "hang" never yields again,
// the half-open shape.
async function* timed(steps: (AgentEvent | number | "hang")[]) {
  for (const step of steps) {
    if (step === "hang") await new Promise(() => {})
    else if (typeof step === "number") await new Promise((resolve) => setTimeout(resolve, step))
    else yield step
  }
}

describe("the agent's retry policy (plans/0057 §4)", () => {
  const POLICY: AgentRetryPolicy = { maxAttempts: 5, backoffCapMs: 10_000, honorsRetryAfter: true, waitsOutLimit: true, silenceBudgetMs: 60_000 }
  const throttled = (attempt: number, next?: number): AgentEvent => ({
    type: "retry",
    session: "s",
    attempt,
    ...(next !== undefined ? { next } : {}),
    error: { message: "too many requests", statusCode: 429 },
  })

  test("a rate signal is the rate class once the agent's own retrying gave up, as its policy states", async () => {
    // Attempt 3: the neutral threshold is met, this agent's cap (5) is not.
    const neutral = make()
    const early = await watch(neutral.client, "s", stream([throttled(3, 5_000), ev.idle("s")]), opts)
    expect(early.errorClass).toBe("rate")
    const declared = make({ retryPolicy: POLICY })
    const still = await watch(declared.client, "s", stream([throttled(3, 5_000), ev.idle("s")]), opts)
    expect(still.failover).toBeUndefined()
    expect(declared.argsOf("abort")).toEqual([])
    // Its cap spent, or a wait above its own backoff: settled as rate.
    for (const signal of [throttled(5, 5_000), throttled(1, 15_000)]) {
      const agent = make({ retryPolicy: POLICY })
      const result = await watch(agent.client, "s", stream([signal, ev.idle("s")]), opts)
      expect(result.errorClass).toBe("rate")
      expect(result.failover).toBe(true)
      expect(agent.argsOf("abort")).toEqual([["s"]])
    }
  })

  test("an agent that does not wait out a limit: its turn ending on a rate signal is the rate class", async () => {
    const ended = [ev.error("s", { name: "rate_limit", message: "request throttled", statusCode: 429 }), ev.idle("s")]
    const gives = make({ retryPolicy: { ...POLICY, waitsOutLimit: false } })
    expect((await watch(gives.client, "s", stream(ended), opts)).errorClass).toBe("rate")
    const waits = make({ retryPolicy: POLICY })
    expect((await watch(waits.client, "s", stream(ended), opts)).errorClass).toBe("unknown")
  })

  test("a registry entry's retry override lays over the adapter's record", async () => {
    const agent = make({ retryPolicy: POLICY })
    const entry: ModelEntry = { name: "m", layer: "project", agent: "a", retry: { maxAttempts: 2 } }
    const result = await watch(agent.client, "s", stream([throttled(2, 5_000), ev.idle("s")]), opts, undefined, undefined, undefined, DEFAULTS, undefined, { name: "m", label: "T-001", entry })
    expect(result.errorClass).toBe("rate")
  })

  // §4.2: the probe fails on every call; a wait the agent announced beyond
  // its silence budget holds the half-open verdict until the wait's end.
  const quiet: AgentRetryPolicy = { ...POLICY, silenceBudgetMs: 0 }
  const unavailable = (next: number): AgentEvent => ({ type: "retry", session: "s", attempt: 1, next, error: { message: "service unavailable", statusCode: 503 } })
  const unreachable = { get: new Error("connection refused") }
  const capture = async (run: () => Promise<Watch>): Promise<{ result: Watch; lines: string[] }> => {
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    })
    try {
      return { result: await run(), lines }
    } finally {
      printed.mockRestore()
    }
  }

  test("an announced silence: the line names its end, and the probe's failures inside it are not counted", async () => {
    const agent = make({ retryPolicy: quiet, fail: unreachable })
    const { result, lines } = await capture(() =>
      watch(agent.client, "s", timed([unavailable(300), 150, ev.text("s", "t", "back"), ev.idle("s")]), { idleMs: 20 }),
    )
    expect(result.error).toBe("")
    expect(lines.some((line) => /⏳ the agent waits \S+ before retrying \(attempt 1\) \(session s\); no events are expected until \d{4}-/.test(line))).toBe(true)
    expect(lines.some((line) => line.includes("inside the agent's announced wait; not counted before"))).toBe(true)
    expect(agent.argsOf("abort")).toEqual([])
    // Without honorsRetryAfter the same wait is not announced: two failures
    // judge the connection half-open long before the agent speaks again.
    const deaf = make({ retryPolicy: { ...quiet, honorsRetryAfter: false }, fail: unreachable })
    const judged = await watch(deaf.client, "s", timed([unavailable(300), 150, ev.text("s", "t", "back"), ev.idle("s")]), { idleMs: 20 })
    expect(judged.error).toContain("half-open")
  })

  test("past the announced end the probe counts again, and model output ends the silence early", async () => {
    const past = make({ retryPolicy: quiet, fail: unreachable })
    const late = await watch(past.client, "s", timed([unavailable(80), "hang"]), { idleMs: 20 })
    expect(late.error).toContain("half-open")
    expect(late.durationMs ?? 0).toBeGreaterThanOrEqual(80)
    const resumed = make({ retryPolicy: quiet, fail: unreachable })
    const early = await watch(resumed.client, "s", timed([unavailable(60_000), 5, ev.text("s", "t", "retry got through"), "hang"]), { idleMs: 20 })
    expect(early.error).toContain("half-open")
    expect(early.durationMs ?? 0).toBeLessThan(10_000)
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
      [SWITCH_ENV.steer]: "on",
      [SWITCH_ENV.stuck]: "on",
      [SWITCH_ENV.ask]: "on",
    })
    const degraded = degrade(BARE_CAPABILITIES, on, {})
    expect(degraded.switches).toEqual({ fork: false, steer: false, stuck: false, ask: false })
    expect(degraded.error).toBeUndefined()
    const switches = { ...on, ...degraded.switches }
    const agent = make({ capabilities: BARE_CAPABILITIES })
    const chain = fresh()
    const first = await runSession(agent.client, task, "one", opts, chain, { limit: 1, text: "hand over", notes: [] }, undefined, switches)
    const second = await runSession(agent.client, task, "two", opts, chain, { limit: 1, text: "hand over", notes: [] }, undefined, switches)
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
  // fixture overrides the models, the tiers or the window wait's random knob.
  // The clock always comes from the installed services — a case that steers
  // time installs its own holder, and the facts follow it.
  const facts = (
    models: ModelEntry[],
    over: {
      tiers?: Partial<Record<"deep" | "simple", TierList>>
      random?: () => number
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
    router: services().router,
    clock: services().clock,
    ...(over.random ? { random: over.random } : {}),
  })

  const FLEET = [entry("a", { model: "prov/a" }), entry("b", { model: "prov/b" }), entry("s", { model: "prov/s" })]
  // The fleet's opts, resolved per access: the router is per-test state
  // (the preload installs a fresh instance for every test), so capturing
  // the facts at describe scope would pin one stale router and the marks a
  // test writes would never reach the dispatch.
  const deep: Opts = { get routing() { return facts(FLEET) } }
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
    expect(services().router.isModelDown("a", Date.now())).toBe(true)
    expect(services().router.isModelDown("b", Date.now())).toBe(false)
  })

  test("a new prompt returns to the primary once its mark clears at the scope boundary", async () => {
    const agent = make({ turn: quotaTurn })
    const chain = deepChain()
    await runSession(agent.client, task, "p", deep, chain, undefined, undefined, DEFAULTS)
    // The task boundary under the default task scope: the marks clear, the
    // next task's chain re-selects and the primary is back.
    services().router.clearDownMarks("task", "task")
    const next = deepChain()
    await runSession(agent.client, task, "q", deep, next, undefined, undefined, DEFAULTS)
    expect(agent.prompts[2]!.model).toBe("prov/a")
    expect(next.modelEntry).toBe("a")
  })

  test("a takeover of the same session keeps the chain's model while it is usable, even after the primary is eligible again", async () => {
    const agent = make({ turn: quotaTurn })
    const chain = deepChain()
    await runSession(agent.client, task, "p", deep, chain, undefined, undefined, DEFAULTS)
    services().router.clearDownMarks("task", "task")
    // A takeover of the same session is a continuation of the same prompt
    // line: it stays on the failover candidate although the primary is
    // usable again.
    chain.note = "[driver] continuation after interruption"
    await runSession(agent.client, task, "q", deep, chain, undefined, undefined, DEFAULTS)
    expect(agent.prompts[2]).toMatchObject({ session: "ses_2", model: "prov/b" })
    expect(agent.argsOf("create")).toHaveLength(1)
  })

  test("a window closing mid-turn never aborts the turn; it finishes and the next dispatch selects again", async () => {
    let now = Date.parse("2026-09-25T12:00:30Z")
    installServices(createServices({ clock: fixedClock(() => now) }))
    const only = parseWindow("00:00-12:01")
    if ("error" in only) throw new Error(only.error)
    const models = [entry("w", { model: "prov/w", only: [only.window] }), entry("b", { model: "prov/b" })]
    const routing = facts(models, { tiers: { deep: tierList("deep", ["w", "b"]), simple: tierList("simple", ["w", "b"]) } })
    // The turn itself moves the clock past the window's end: the running turn
    // is never aborted (§4.4) — windows gate dispatches only.
    const agent = make({ turn: (ctx) => ((now = Date.parse("2026-09-25T12:02:00Z")), undefined) })
    const chain = deepChain()
    try {
      const result = await runSession(agent.client, task, "p", { routing }, chain, undefined, undefined, DEFAULTS)
      expect(result).toEqual({ type: "idle", lastText: expect.stringContaining("done:"), testHandover: false })
      expect(agent.argsOf("abort")).toEqual([])
      expect(agent.prompts[0]!.model).toBe("prov/w")
    } finally {
      uninstallServices()
    }
  })

  // §6.3's window wait: a deep dispatch whose only candidate is outside its
  // windows sleeps inside the unit until the earliest opening plus
  // hibernate's jitter, logs the wait line, books a `window` wait, and then
  // dispatches on the re-selection.
  test("a deep dispatch with only closed-window candidates waits for the opening plus jitter, then dispatches", async () => {
    // One manual services clock steers the whole run: the selection reads
    // it through the facts, the window wait sleeps on it, and the stats
    // timeline follows the same holder.
    const mc = manualClock(Date.parse("2026-09-25T12:00:00Z"))
    installServices(createServices({ clock: mc.clock }))
    const only = parseWindow("18:00-24:00")
    if ("error" in only) throw new Error(only.error)
    const models = [entry("w", { model: "prov/w", only: [only.window] })]
    const dir = await mkdtemp(join(tmpdir(), "auto-window-"))
    const routing = facts(models, {
      random: () => 0.25,
      tiers: { deep: tierList("deep", ["w"]), simple: tierList("simple", ["w"]) },
    })
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "))
    })
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
      expect(mc.at).toBe(Date.parse("2026-09-25T18:02:30Z"))
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
      uninstallServices()
      await rm(dir, { recursive: true, force: true })
    }
  })

  // §10 item 6: the machine clock decides after the wake. A suspend that
  // wakes past a short window simply waits for the next opening — the wait
  // never exits on its own (C5).
  test("a wake past the window (a suspend) waits again for the next opening instead of dispatching", async () => {
    // The run's clock is hand-built: its sleep overshoots the first wake by
    // seven hours, like a machine that suspended; the second wakes exactly
    // on time.
    let wakes = 0
    const mc = manualClock(Date.parse("2026-09-25T12:00:00Z"))
    const suspended: Clock = {
      now: () => mc.at,
      sleep: async (ms) => {
        mc.at += ms + (wakes++ === 0 ? 7 * 3_600_000 : 0)
      },
      sleepUnlessExit: mc.clock.sleepUnlessExit,
      timer: mc.clock.timer,
    }
    installServices(createServices({ clock: suspended }))
    const only = parseWindow("18:00-20:00")
    if ("error" in only) throw new Error(only.error)
    const models = [entry("w", { model: "prov/w", only: [only.window] })]
    const routing = facts(models, {
      random: () => 0.25,
      tiers: { deep: tierList("deep", ["w"]), simple: tierList("simple", ["w"]) },
    })
    const agent = make()
    const chain = deepChain()
    try {
      const result = await runSession(agent.client, task, "p", { routing }, chain, undefined, undefined, DEFAULTS)
      expect(result).toEqual({ type: "idle", lastText: expect.stringContaining("done:"), testHandover: false })
      expect(agent.prompts).toHaveLength(1)
      expect(agent.prompts[0]).toMatchObject({ model: "prov/w" })
      expect(mc.at).toBe(Date.parse("2026-09-26T18:02:30Z"))
    } finally {
      uninstallServices()
    }
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
    expect(services().router.isModelDown("a", Date.now())).toBe(false)
    expect(services().router.isModelDown("b", Date.now())).toBe(true)
  })

  // Escalation step 3 (§7): a quota failure whose remaining candidates are
  // blocked only by their windows waits for the opening instead of handing a
  // closed window to the probe loop; the failover lands on the opened model.
  test("a failover onto a window-blocked list waits for the opening, then switches to the opened model", async () => {
    const mc = manualClock(Date.parse("2026-09-25T12:00:00Z"))
    installServices(createServices({ clock: mc.clock }))
    const only = parseWindow("18:00-24:00")
    if ("error" in only) throw new Error(only.error)
    const models = [entry("a", { model: "prov/a" }), entry("w", { model: "prov/w", only: [only.window] })]
    const routing = facts(models, {
      random: () => 0,
      tiers: { deep: tierList("deep", ["a", "w"]), simple: tierList("simple", ["a", "w"]) },
    })
    const agent = make({ turn: quotaTurn })
    const chain = deepChain()
    try {
      const result = await runSession(agent.client, task, "p", { routing }, chain, undefined, undefined, DEFAULTS)
      expect(result.type).toBe("idle")
      // a fails with quota; w is closed until 18:00 — the failover waits the
      // six hours (zero jitter from the injected random) and forks onto w.
      expect(agent.prompts.map((p) => p.model)).toEqual(["prov/a", "prov/w"])
      expect(agent.argsOf("fork")).toEqual([["ses_1", undefined]])
      expect(chain.modelEntry).toBe("w")
      expect(mc.at).toBe(Date.parse("2026-09-25T18:00:00Z"))
    } finally {
      uninstallServices()
    }
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
    router: services().router,
    clock: services().clock,
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

  test("quota rotates to the next key: host restart, spawn config reference, same model from a fork", async () => {
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    })
    try {
      const routing = facts()
      routing.router.activateRings(routing.registry, false)
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
      expect(services().router.isModelDown("a", Date.now())).toBe(false)
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
    routing.router.activateRings(routing.registry, false)
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
    expect(services().router.isModelDown("a", Date.now())).toBe(true)
    // Every key of the ring is down now, so §6.2 rule 4 keeps a out (the
    // spawn config still names the current key — a restart for any other
    // reason spawns on the last position).
    expect(services().router.ringHasUsableKey("prov", Date.now())).toBe(false)
    expect(services().router.spawnKeyConfig()).toEqual({ provider: { prov: { options: { apiKey: "{env:PROV_KEY_B}" } } } })
  })

  test("an auth failure counts as a key failure: the ring rotates too", async () => {
    const routing = facts()
    routing.router.activateRings(routing.registry, false)
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
    routing.router.activateRings(routing.registry, false)
    // First dispatch: turn 1 fails with quota, the ring rotates A → B.
    const first = fakeHost()
    const firstAgent = make({ turn: classTurn("usage limit reached, quota exceeded") })
    await runSession(firstAgent.client, task, "p", optsWith(first.host, routing), deepChain(), undefined, undefined, DEFAULTS)
    expect(first.configs).toEqual([{ provider: { prov: { options: { apiKey: "{env:PROV_KEY_B}" } } } }])
    // A scope boundary clears every mark: the ring stays on key B (the
    // config still names it — no restart churn) and the model is eligible
    // again, so the next dispatch selects a.
    services().router.clearDownMarks("task", "task")
    expect(services().router.spawnKeyConfig()).toEqual({ provider: { prov: { options: { apiKey: "{env:PROV_KEY_B}" } } } })
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
      routing.router.activateRings(routing.registry, true)
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
    router: services().router,
    clock: services().clock,
  })
  const BASE = "prov/k3-256k"
  const WIDE = "prov/k3"
  // Base window 100k → step-up point 52k; the wider window 200k.
  const LIMITS = { [BASE]: 100_000, [WIDE]: 200_000 }
  const stepsOpts = (over: Partial<Opts> = {}): Opts => ({ routing: facts([entry("k3", { model: BASE, wider: [WIDE] })]), ...over })
  const deepChain = (): SessionChain => ({ pct: 100, used: 0, at: 0, role: "decompose" })
  const steerInputs = (agent: FakeAgent) => agent.argsOf("promptAsync").map((args) => args[0] as { session: string; text: string; model?: string })


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
    const result = await runSession(agent.client, task, "p", stepsOpts(), chain, { limit: 70_000, text: "hand over", notes: [] }, undefined, DEFAULTS)
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
    const chain = deepChain()
    await runSession(agent.client, task, "p", stepsOpts(), chain, undefined, undefined, DEFAULTS)
    expect(agent.prompts[0]).toMatchObject({ model: BASE })
    // The chain's next prompt into the same session (a resumed takeover)
    // names the step it reached.
    chain.note = "[driver] continuation after interruption"
    await runSession(agent.client, task, "q", stepsOpts({ contextLimit: 200_000 }), chain, undefined, undefined, DEFAULTS)
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
    const agent = make({ turn: (ctx) => [ev.message(ctx.session, `m_${ctx.n}`, 30_000), ev.idle(ctx.session)] })
    const chain = fresh()
    await runSession(agent.client, task, "p", opts, chain, { limit: 30_000, text: "hand over", notes: [] }, undefined, DEFAULTS)
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
    router: services().router,
    clock: services().clock,
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

  // The classifier's run state (answers, budget) lives in the run's router;
  // the preload installs a fresh instance before every test, so no reset
  // hook appears here.

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
      expect(services().router.modelDownMark("a")).toEqual({ until: Math.floor(resetAt / 1000) * 1000, classifier: true })
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
    await until(() => services().router.isModelDown("free", Date.now()))
    expect(services().router.isModelDown("free", Date.now())).toBe(true)
    // Neither the primary nor its fallback was touched: the unknown failure
    // took the retry ladder on the same model.
    expect(services().router.isModelDown("a", Date.now())).toBe(false)
    expect(services().router.isModelDown("b", Date.now())).toBe(false)
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
      expect(services().router.modelDownMark("a")).toEqual({})
      release()
      await until(() => services().router.modelDownMark("a")?.until !== undefined)
      expect(services().router.modelDownMark("a")).toEqual({ until: Math.floor(resetAt / 1000) * 1000 })
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

  // plans/0057 §5.3: a reset the provider or the agent stated outranks the
  // classifier's, lands on the same down-mark `until`, and spares asking.
  test("a stated reset sets when the down mark clears; the classifier is not asked", async () => {
    // Whole seconds, as a provider states them.
    const resetAt = Math.floor((Date.now() + 3 * 3_600_000) / 1000) * 1000
    const agent = make({
      turn: (ctx) =>
        ctx.n === 1
          ? [
              ev.message(ctx.session, "msg_retrying", 5000),
              { type: "retry", session: ctx.session, attempt: 1, next: 3 * 3_600_000, error: { message: "rate limited", statusCode: 429, resetAt, scope: "5h" } },
            ]
          : undefined,
    })
    const chain = deepChain()
    const result = await runSession(agent.client, task, "p", { routing: facts() }, chain, undefined, undefined, DEFAULTS)
    expect(result.type).toBe("idle")
    expect(chain.modelEntry).toBe("b")
    expect(services().router.modelDownMark("a")).toEqual({ until: resetAt })
    expect(agent.prompts.some((p) => p.bare === true)).toBe(false)
  })

  test("the classifier is not asked about wording it would read when the reset is stated", async () => {
    const statedAt = Math.floor((Date.now() + 2 * 3_600_000) / 1000) * 1000
    const agent = make({ turn: (ctx) => (isClassify(ctx.text) ? answerTurn('{"class": "quota", "resetAt": null}')(ctx.session) : undefined) })
    const result = await watch(
      agent.client,
      "s",
      stream([{ type: "retry", session: "s", attempt: 1, error: { message: UNKNOWN, resetAt: statedAt } }, ev.text("s", "t", "back"), ev.idle("s")]),
      { routing: facts() },
    )
    expect(result.error).toBe("")
    expect(agent.prompts).toEqual([])
  })

  test("a stated reset ends with the retry: model output clears it before a later failure", async () => {
    const statedAt = Math.floor((Date.now() + 2 * 3_600_000) / 1000) * 1000
    const retry: AgentEvent = { type: "retry", session: "s", attempt: 1, error: { message: "service unavailable", statusCode: 503, resetAt: statedAt, retryAfterMs: 7_200_000 } }
    const quota = ev.error("s", { name: "APIError", message: "usage limit reached", isRetryable: false })
    // No registry: the stated reset still rides the result (to no effect there).
    const held = await watch(make().client, "s", stream([retry, quota, ev.idle("s")]), opts)
    expect(held.resetAt).toBe(statedAt)
    const recovered = await watch(make().client, "s", stream([retry, ev.text("s", "t", "back"), quota, ev.idle("s")]), opts)
    expect(recovered.errorClass).toBe("quota")
    expect(recovered.resetAt).toBeUndefined()
    expect(recovered.errorInfo?.retryAfterMs).toBeUndefined()
  })

  test("a stated reset outranks the answer's", async () => {
    const answered = Date.now() + 5 * 3_600_000
    const statedAt = Math.floor((Date.now() + 2 * 3_600_000) / 1000) * 1000
    const settle = async (stated: boolean): Promise<Watch> => {
      // Fresh state between the two runs (the moved state has no reset
      // hook; a fresh services instance replaces it, keeping the wall
      // clock this suite runs on).
      installServices(createServices())
      const agent = make({
        turn: (ctx) => (isClassify(ctx.text) ? answerTurn(`{"class": "unknown", "resetAt": "${isoInZone(answered, "UTC")}"}`)(ctx.session) : undefined),
      })
      // The first retry is undecided and asked about; once the answer is in,
      // the agent gives up with a quota verdict the patterns settle on their
      // own, stating the reset (or not).
      async function* turn() {
        yield { type: "retry", session: "s", attempt: 1, error: { message: UNKNOWN } } satisfies AgentEvent
        await until(() => cachedAnswer(services().router, { message: UNKNOWN }) !== undefined)
        yield ev.error("s", { name: "APIError", message: "usage limit reached", isRetryable: false, ...(stated ? { resetAt: statedAt, scope: "5h" as const } : {}) })
        yield ev.idle("s")
      }
      return watch(agent.client, "s", turn(), { routing: facts() })
    }
    const answer = await settle(false)
    expect(answer.errorClass).toBe("quota")
    expect(answer.resetAt).toBe(Math.floor(answered / 1000) * 1000)
    const header = await settle(true)
    expect(header.errorClass).toBe("quota")
    expect(header.resetAt).toBe(statedAt)
    expect(header.pendingReset).toBeUndefined()
    expect(header.errorInfo).toMatchObject({ resetAt: statedAt, scope: "5h" })
  })
})

// The scheduled wait (plans/0057 §6, §7): the wait-and-probe loop sleeps to a
// known reset plus hibernate's jitter instead of polling; a spent usage
// window skips the retry ladder; a per-minute cap stays with the agent's own
// ladder; /exit inside the wait pauses the run and keeps the recovery point.
describe("the scheduled wait (plans/0057 §6, §7)", () => {
  const entry = (name: string, fields: Partial<ModelEntry> = {}): ModelEntry => ({ name, layer: "operator", agent: "opencode", ...fields })
  const tierList = (tier: "deep" | "simple", names: string[]): TierList => ({ tier, names, layer: "operator" })
  const T0 = Date.parse("2026-09-25T14:39:25Z")
  // A one-agent fleet, deep [a, b], on the installed services' clock: every
  // sleep (the window wait's and the recovery's) advances the fake timeline
  // and is recorded. Installing here also steers the stats timeline, the
  // same holder the run would use.
  const fleet = (random = 0.5) => {
    const clock = { now: T0, sleeps: [] as number[] }
    const advance = async (ms: number): Promise<void> => {
      clock.sleeps.push(ms)
      clock.now += ms
    }
    installServices(
      createServices({
        clock: {
          now: () => clock.now,
          sleep: advance,
          sleepUnlessExit: async (ms) => {
            if (exitRequested()) return true
            await advance(ms)
            return false
          },
          timer: () => () => {},
        },
      }),
    )
    const routing: RoutingFacts = {
      registry: {
        layers: [{ name: "operator", path: "/unused/models.json" }],
        tz: "UTC",
        agents: new Map([["opencode", { name: "opencode", layer: "operator", adapter: "opencode" }]]),
        models: new Map([entry("a", { model: "prov/a" }), entry("b", { model: "prov/b" })].map((item) => [item.name, item])),
        tiers: { deep: tierList("deep", ["a", "b"]), simple: tierList("simple", ["b"]) },
        routes: new Map(),
        unused: [],
      },
      agentFilter: "opencode",
      filterSource: undefined,
      defaultAgent: "opencode",
      runAgent: "opencode",
      router: services().router,
      clock: services().clock,
      random: () => random,
    }
    return { clock, routing }
  }
  const deepChain = (): SessionChain => ({ pct: 100, used: 0, at: 0, role: "decompose" })
  const limitError = (session: string, fields: Partial<AgentError> = {}): AgentEvent =>
    ev.error(session, { name: "APIError", message: "usage limit reached, quota exceeded", isRetryable: false, ...fields })
  // The first turn fails with the given events after 5000 tokens of work;
  // every later turn is the default one.
  const failsFirst = (fail: (session: string) => AgentEvent[]) => (ctx: { session: string; n: number }) =>
    ctx.n === 1 ? [ev.message(ctx.session, "msg_fail", 5000), ...fail(ctx.session)] : undefined
  const capture = (onLine?: (line: string) => void) => {
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      const line = args.map(String).join(" ")
      lines.push(line)
      onLine?.(line)
    })
    return { lines, restore: () => printed.mockRestore() }
  }
  const waitLine = (lines: string[]) => lines.find((line) => line.includes("then probing service recovery"))
  const quotaWaits = async (dir: string): Promise<Record<string, number> | undefined> => {
    await flushStats(dir)
    return JSON.parse(await Bun.file(join(dir, ".auto", "stats.json")).text()).roundB.quotaWaits
  }

  let dir: string
  beforeEach(async () => {
    resetQuotaWindows()
    dir = await mkdtemp(join(tmpdir(), "auto-wait-"))
  })
  afterEach(async () => {
    resetExitRequest()
    uninstallServices()
    await flushStats(dir)
    await rm(dir, { recursive: true, force: true })
  })

  test("no registry: a stated five-hour reset sets the sleep, and the wait is booked as time lost to quota windows", async () => {
    const random = spyOn(Math, "random").mockReturnValue(0)
    const resetAt = Date.now() + 300
    const agent = make({ turn: failsFirst((session) => [limitError(session, { resetAt, scope: "5h" }), ev.idle(session)]) })
    const out = capture()
    const began = Date.now()
    let result
    try {
      result = await runSession(agent.client, task, "p", { dir }, fresh(), undefined, undefined, DEFAULTS)
    } finally {
      out.restore()
      random.mockRestore()
    }
    expect(result.type).toBe("idle")
    // Slept to the reset (zero jitter), not the 30-minute poll.
    expect(Date.now() - began).toBeGreaterThanOrEqual(100)
    expect(waitLine(out.lines)).toContain(`; the five-hour usage window resets ${new Date(resetAt).toISOString()}, sleeping until about `)
    expect(waitLine(out.lines)).toContain("(local ")
    expect(agent.prompts.map((p) => p.session)).toEqual(["ses_1", "ses_2", "ses_3"])
    expect(agent.argsOf("fork")).toEqual([["ses_1", undefined]])
    const booked = (await quotaWaits(dir))?.[MODEL] ?? 0
    expect(booked).toBeGreaterThan(0)
    expect(booked).toBeLessThanOrEqual(300)
  })

  test("a registry: the sleep ends when the first candidate is usable again by waiting alone, plus the jitter", async () => {
    const { clock, routing } = fleet(0.5)
    const aReset = T0 + 3 * 3_600_000
    const bReset = T0 + 3_600_000
    const agent = make({
      turn: (ctx) =>
        ctx.n === 1
          ? [
              ev.message(ctx.session, "msg_a", 5000),
              { type: "retry", session: ctx.session, attempt: 1, next: 3 * 3_600_000, error: { message: "rate limited", statusCode: 429, resetAt: aReset, scope: "5h" } },
            ]
          : ctx.n === 2
            ? [ev.message(ctx.session, "msg_b", 5000), limitError(ctx.session, { resetAt: bReset }), ev.idle(ctx.session)]
            : undefined,
    })
    const out = capture()
    let result
    try {
      result = await runSession(agent.client, task, "p", { routing }, deepChain(), undefined, undefined, DEFAULTS)
    } finally {
      out.restore()
    }
    expect(result.type).toBe("idle")
    // a is down to its five-hour reset, b to its quota reset: b comes back
    // first, and the sleep is b's reset plus half the jitter.
    expect(clock.sleeps).toEqual([3_600_000 + 300_000])
    expect(waitLine(out.lines)).toContain(`; b is usable again at ${isoInZone(bReset, "UTC")}, sleeping until about ${new Date(bReset + 300_000).toISOString()}`)
    expect(agent.prompts.map((p) => p.model)).toEqual(["prov/a", "prov/b", "prov/b", "prov/b"])
    expect(services().router.modelDownMark("a")).toEqual({ until: aReset })
  })

  test("an end beyond the horizon, or a down candidate with no known end, polls at the recovery interval", async () => {
    const polled = parseSwitches({ [SWITCH_ENV.recoveryWait]: "1" })
    const layouts: [string, number | undefined][][] = [
      [
        ["a", T0 + 8 * 86_400_000],
        ["b", T0 + 8 * 86_400_000],
      ],
      [
        ["a", undefined],
        ["b", T0 + 3_600_000],
      ],
    ]
    for (const marks of layouts) {
      freshFailback()
      const { clock, routing } = fleet()
      for (const [name, until] of marks) services().router.markModelDown(name, until)
      const agent = make()
      const out = capture()
      try {
        expect((await runSession(agent.client, task, "p", { routing }, deepChain(), undefined, undefined, polled)).type).toBe("idle")
      } finally {
        out.restore()
      }
      expect(clock.sleeps).toEqual([60_000])
      expect(waitLine(out.lines)).toContain("; waiting 1 minutes, then probing service recovery")
      // The probe clears a's mark and the dispatch continues on it.
      expect(agent.prompts.map((p) => p.model)).toEqual(["prov/a", "prov/a"])
    }
  })

  test("a candidate usable now explains no wait: after a probe fails on it, the failure's own reset, else the poll", async () => {
    // Both candidates down to known ends: the first sleep is a's. At the wake
    // a's mark has lapsed, so selection picks it for the probe as usable, and
    // the probe's failure re-marks nothing. The next round's wait is that
    // failure's, never a jitter-only round.
    const polled = parseSwitches({ [SWITCH_ENV.recoveryWait]: "1" })
    const wake = T0 + 3_600_000 + 300_000
    const probeReset = T0 + 3 * 3_600_000
    const cases: { fields: Partial<AgentError>; second: number; reason: string }[] = [
      { fields: {}, second: 60_000, reason: "; waiting 1 minutes, then probing" },
      { fields: { resetAt: probeReset }, second: probeReset - wake + 300_000, reason: `; the limit resets ${new Date(probeReset).toISOString()}, sleeping until about ` },
    ]
    for (const { fields, second, reason } of cases) {
      freshFailback()
      const { clock, routing } = fleet(0.5)
      services().router.markModelDown("a", T0 + 3_600_000)
      services().router.markModelDown("b", T0 + 2 * 3_600_000)
      const agent = make({ turn: (ctx) => (ctx.n === 1 ? [limitError(ctx.session, fields), ev.idle(ctx.session)] : undefined) })
      const out = capture()
      try {
        expect((await runSession(agent.client, task, "p", { routing }, deepChain(), undefined, undefined, polled)).type).toBe("idle")
      } finally {
        out.restore()
      }
      expect(clock.sleeps).toEqual([3_900_000, second])
      expect(out.lines.filter((line) => line.includes("then probing service recovery"))[1]).toContain(reason)
      // The failed probe, the probe that got through, the dispatch.
      expect(agent.prompts.map((p) => p.model)).toEqual(["prov/a", "prov/a", "prov/a"])
    }
  })

  test("a spent weekly window of unknown wording skips the retry ladder: without a registry it sleeps to the reset, under one it escalates at once", async () => {
    const weekly = (resetAt: number) =>
      failsFirst((session) => [ev.error(session, { name: "APIError", message: "Wochenkontingent aufgebraucht", resetAt, scope: "7d" }), ev.idle(session)])
    const random = spyOn(Math, "random").mockReturnValue(0)
    const resetAt = Date.now() + 200
    const plain = make({ turn: weekly(resetAt) })
    const out = capture()
    let result
    try {
      result = await runSession(plain.client, task, "p", opts, fresh(), undefined, undefined, DEFAULTS)
    } finally {
      out.restore()
      random.mockRestore()
    }
    expect(result.type).toBe("idle")
    // The ladder's first rung (0 minutes) would have retried at once.
    expect(out.lines.some((line) => line.includes("transient session error"))).toBe(false)
    expect(waitLine(out.lines)).toContain("⏳ T-001 the weekly usage window is spent (session error: ")
    expect(waitLine(out.lines)).toContain(`; the weekly usage window resets ${new Date(resetAt).toISOString()}, sleeping until about `)
    expect(plain.prompts.map((p) => p.session)).toEqual(["ses_1", "ses_2", "ses_3"])
    expect(plain.argsOf("fork")).toEqual([["ses_1", undefined]])

    const { routing } = fleet()
    const aReset = T0 + 2 * 86_400_000
    const routed = make({ turn: weekly(aReset) })
    const routedOut = capture()
    try {
      expect((await runSession(routed.client, task, "p", { routing }, deepChain(), undefined, undefined, DEFAULTS)).type).toBe("idle")
    } finally {
      routedOut.restore()
    }
    expect(routedOut.lines.some((line) => line.includes("⇄ T-001 weekly usage window spent; keeping chain context, switching model a → b"))).toBe(true)
    expect(routed.prompts.map((p) => p.model)).toEqual(["prov/a", "prov/b"])
    expect(services().router.modelDownMark("a")).toEqual({ until: aReset })
  })

  // Zhipu's wording (plans/0057 S4a, F24): the reset instant in Beijing time
  // with no offset, in whole seconds.
  const beijing = (at: number) => new Date(at + 8 * 3_600_000).toISOString().slice(0, 19).replace("T", " ")
  const zhipuFive = (at: number) => `Usage limit reached for 5 hour. Your limit will reset at ${beijing(at)}`
  const zhipuWeekly = (at: number) => `Weekly/Monthly Limit Exhausted. Your limit will reset at ${beijing(at)}`

  test("a reset stated in Zhipu's wording (S4a): the first retry settles as quota, no ladder, and the wait sleeps to it", async () => {
    const random = spyOn(Math, "random").mockReturnValue(0)
    const resetAt = (Math.floor(Date.now() / 1000) + 1) * 1000
    // opencode's retry status: the provider's words, no status code, no headers.
    const agent = make({
      turn: (ctx) =>
        ctx.n === 1 ? [ev.message(ctx.session, "msg_fail", 5000), { type: "retry", session: ctx.session, attempt: 1, next: 2_000, error: { message: zhipuWeekly(resetAt) } }] : undefined,
    })
    const out = capture()
    let result
    try {
      result = await runSession(agent.client, task, "p", opts, fresh(), undefined, undefined, DEFAULTS)
    } finally {
      out.restore()
      random.mockRestore()
    }
    expect(result.type).toBe("idle")
    // Settled on the first retry signal, not after the agent's own retrying.
    expect(agent.argsOf("abort")).toContainEqual(["ses_1"])
    expect(out.lines.some((line) => line.includes("transient session error"))).toBe(false)
    expect(waitLine(out.lines)).toContain("⏳ T-001 the weekly usage window is spent (session error: Weekly/Monthly Limit Exhausted.")
    expect(waitLine(out.lines)).toContain(`; the weekly usage window resets ${new Date(resetAt).toISOString()}, sleeping until about `)
    expect(agent.prompts.map((p) => p.session)).toEqual(["ses_1", "ses_2", "ses_3"])
    expect(agent.argsOf("fork")).toEqual([["ses_1", undefined]])
  })

  test("under a registry the reset Zhipu's wording states is the down mark's end (S4a)", async () => {
    const { routing } = fleet()
    const aReset = T0 + 2 * 3_600_000
    const agent = make({ turn: failsFirst((session) => [ev.error(session, { name: "APIError", message: zhipuFive(aReset), statusCode: 429 }), ev.idle(session)]) })
    const out = capture()
    try {
      expect((await runSession(agent.client, task, "p", { routing }, deepChain(), undefined, undefined, DEFAULTS)).type).toBe("idle")
    } finally {
      out.restore()
    }
    expect(out.lines.some((line) => line.includes("⇄ T-001 quota restricted; keeping chain context, switching model a → b"))).toBe(true)
    expect(agent.prompts.map((p) => p.model)).toEqual(["prov/a", "prov/b"])
    expect(services().router.modelDownMark("a")).toEqual({ until: aReset })
  })

  test("a limit the event states in structured form outranks the reset in its wording (S4a)", async () => {
    const header = Math.floor((Date.now() + 3_600_000) / 1000) * 1000
    const worded = Math.floor((Date.now() + 2 * 3_600_000) / 1000) * 1000
    const both = await watch(make().client, "s", stream([ev.error("s", { name: "APIError", message: zhipuFive(worded), resetAt: header, scope: "unknown" }), ev.idle("s")]), opts)
    expect(both.errorClass).toBe("quota")
    expect(both.resetAt).toBe(header)
    expect(both.scope).toBe("unknown")
    const words = await watch(make().client, "s", stream([ev.error("s", { name: "APIError", message: zhipuFive(worded) }), ev.idle("s")]), opts)
    expect(words.resetAt).toBe(worded)
    expect(words.scope).toBe("5h")
  })

  // Learned windows (plans/0057 §8, S5): the record in .auto/windows.json,
  // keyed by the account — without a registry the provider of the model the
  // terminal was shown, `fake` here.
  const windowsFile = () => join(dir, ".auto", "windows.json")
  const recorded = async (): Promise<Record<string, unknown>[]> => JSON.parse(await Bun.file(windowsFile()).text()).windows
  const seedWindows = async (windows: Record<string, unknown>[]) => {
    await mkdir(join(dir, ".auto"), { recursive: true })
    await writeFile(windowsFile(), JSON.stringify({ windows }))
  }
  // /exit at the wait line: the run pauses where it would have slept.
  const pauseAtWait = () =>
    capture((line) => {
      if (line.includes("then probing service recovery")) requestExit()
    })

  test("a stated reset outlives the run: a re-run whose failure states none sleeps to the recorded reset (S5)", async () => {
    const resetAt = (Math.floor(Date.now() / 1000) + 3 * 86_400) * 1000
    const stated = make({ turn: failsFirst((session) => [ev.error(session, { name: "APIError", message: zhipuWeekly(resetAt) }), ev.idle(session)]) })
    let out = pauseAtWait()
    try {
      await expect(runSession(stated.client, task, "p", { dir }, fresh(), undefined, undefined, DEFAULTS)).rejects.toBeInstanceOf(ExitRequested)
    } finally {
      out.restore()
    }
    const [entry] = await recorded()
    expect(await recorded()).toEqual([{ account: "fake", scope: "7d", resetAt, learnedAt: expect.any(Number), source: "stated", spent: true }])
    // The re-run, a new process: its failure says nothing of the limit.
    resetExitRequest()
    resetQuotaWindows()
    const silent = make({ turn: failsFirst((session) => [limitError(session), ev.idle(session)]) })
    out = pauseAtWait()
    try {
      await expect(runSession(silent.client, task, "p", { dir }, fresh(), undefined, undefined, DEFAULTS)).rejects.toBeInstanceOf(ExitRequested)
    } finally {
      out.restore()
    }
    expect(waitLine(out.lines)).toContain("⏳ T-001 non-retryable session error encountered (session error: usage limit reached, quota exceeded)")
    expect(waitLine(out.lines)).toContain(
      `; the weekly usage window resets ${new Date(resetAt).toISOString()} (recorded ${new Date(entry!.learnedAt as number).toISOString()}), sleeping until about `,
    )
    expect(silent.prompts).toHaveLength(1)
  })

  test("a probe that errors on its own sleeps to the account's recorded reset, not the poll (S5)", async () => {
    const random = spyOn(Math, "random").mockReturnValue(0)
    const weekEnd = Date.now() + 3 * 86_400_000
    await seedWindows([{ account: "fake", scope: "7d", resetAt: weekEnd, learnedAt: Date.now() - 86_400_000, source: "observed", spent: true, utilization: 1 }])
    const fiveEnd = Date.now() + 300
    const agent = make({ turn: failsFirst((session) => [limitError(session, { resetAt: fiveEnd, scope: "5h" }), ev.idle(session)]) })
    // The probe's session cannot be created: it errors on its own.
    let creates = 0
    const client = {
      ...agent.client,
      create: (input: { title: string }) => {
        if (++creates === 2) throw new Error("socket hang up")
        return agent.client.create(input)
      },
    }
    let waited = 0
    const out = capture((line) => {
      if (line.includes("then probing service recovery") && ++waited === 2) requestExit()
    })
    try {
      await expect(runSession(client, task, "p", { dir }, fresh(), undefined, undefined, DEFAULTS)).rejects.toBeInstanceOf(ExitRequested)
    } finally {
      out.restore()
      random.mockRestore()
    }
    const waits = out.lines.filter((line) => line.includes("then probing service recovery"))
    // The failure's own reset first; after the failed probe, the recorded one.
    expect(out.lines.some((line) => line.includes("probe session itself errored (socket hang up)"))).toBe(true)
    expect(waits[0]).toContain(`; the five-hour usage window resets ${new Date(fiveEnd).toISOString()}, sleeping until about `)
    expect(waits[1]).toContain(`; the weekly usage window resets ${new Date(weekEnd).toISOString()} (recorded `)
    expect(waits[1]).not.toContain("waiting 30 minutes")
  })

  test("a turn that goes through clears the account's spent windows, and a usage-window observation is recorded (S5)", async () => {
    const ahead = Date.now() + 86_400_000
    await seedWindows([
      { account: "fake", scope: "7d", resetAt: ahead, learnedAt: Date.now(), source: "stated", spent: true },
      { account: "other", scope: "7d", resetAt: ahead, learnedAt: Date.now(), source: "stated", spent: true },
    ])
    const week = Date.now() + 2 * 86_400_000
    const agent = make({
      turn: (ctx) => [
        ev.message(ctx.session, "msg_1", 1000),
        { type: "limit", session: ctx.session, status: "allowed", windows: [{ scope: "7d", resetAt: week, utilization: 0.4 }] },
        ev.text(ctx.session, "txt_1", "done"),
        ev.step(ctx.session, "stp_1"),
        ev.idle(ctx.session),
      ],
    })
    const out = capture()
    try {
      expect((await runSession(agent.client, task, "p", { dir }, fresh(), undefined, undefined, DEFAULTS)).type).toBe("idle")
    } finally {
      out.restore()
    }
    const byAccount = (await recorded()).map((w) => [w.account, w.scope, w.source, w.spent])
    expect(byAccount).toEqual([
      ["other", "7d", "stated", true],
      ["fake", "7d", "observed", false],
    ])
  })

  test("a per-minute cap stays with the agent's own ladder until it gives up, quota wording included", async () => {
    const refused = (attempt: number, scope?: "request" | "token"): AgentEvent => ({
      type: "retry",
      session: "s",
      attempt,
      error: { message: "usage limit reached, quota exceeded", statusCode: 429, ...(scope !== undefined ? { scope } : {}) },
    })
    for (const scope of ["request", "token"] as const) {
      const agent = make()
      const cured = await watch(agent.client, "s", stream([refused(1, scope), ev.text("s", "t", "back"), ev.idle("s")]), opts)
      expect(cured.error).toBe("")
      expect(agent.argsOf("abort")).toEqual([])
    }
    // No scope, or the agent's attempts spent: settled as quota.
    for (const signal of [refused(1), refused(3, "request")]) {
      const agent = make()
      const result = await watch(agent.client, "s", stream([signal, ev.idle("s")]), opts)
      expect(result.errorClass).toBe("quota")
      expect(result.failover).toBe(true)
      expect(agent.argsOf("abort")).toEqual([["s"]])
    }
  })

  test("/exit inside the wait pauses the run: the progress record keeps the session the recovery would continue, with its figure", async () => {
    const agent = make({ turn: failsFirst((session) => [limitError(session), ev.idle(session)]) })
    const chain: SessionChain = { ...fresh(), phase: { kind: "decompose" } }
    const out = capture((line) => {
      if (line.includes("then probing service recovery")) setTimeout(requestExit, 20)
    })
    const began = Date.now()
    let caught: unknown
    try {
      await runSession(agent.client, task, "p", { dir }, chain, undefined, undefined, DEFAULTS)
    } catch (error) {
      caught = error
    } finally {
      out.restore()
    }
    // The 30-minute poll ended at the request.
    expect(Date.now() - began).toBeLessThan(10_000)
    expect(caught).toBeInstanceOf(ExitRequested)
    expect((caught as ExitRequested).boundary).toBe("wait")
    expect(out.lines).toContain("⏸ T-001 /exit inside the recovery wait: the re-run resumes the original session ses_1 (5000 tokens)")
    expect(await recallProgress(dir, task.id)).toMatchObject({ session: "ses_1", active: true, phase: { kind: "decompose" }, used: 5000 })
    // No probe ran.
    expect(agent.prompts).toHaveLength(1)
    // The part slept before the pause is booked, not the planned half hour.
    const booked = (await quotaWaits(dir))?.[MODEL] ?? 0
    expect(booked).toBeGreaterThan(0)
    expect(booked).toBeLessThan(10_000)
  })

  test("an /exit already requested pauses as the wait starts; a phase-less chain keeps no record", async () => {
    const noLadder = parseSwitches({ [SWITCH_ENV.retryWaits]: "off" })
    const hiccup = failsFirst((session) => [ev.error(session, { name: "APIError", message: "upstream hiccup" }), ev.idle(session)])
    requestExit()
    const phased = make({ turn: hiccup })
    const oneOff = make({ turn: hiccup })
    const out = capture()
    try {
      await expect(runSession(phased.client, task, "p", { dir }, { ...fresh(), phase: { kind: "whole" } }, undefined, undefined, noLadder)).rejects.toBeInstanceOf(ExitRequested)
      await expect(runSession(oneOff.client, task, "p", opts, fresh(), undefined, undefined, noLadder)).rejects.toBeInstanceOf(ExitRequested)
    } finally {
      out.restore()
    }
    expect(out.lines).toContain("⏸ T-001 /exit inside the recovery wait: the re-run resumes the failed session ses_1 (5000 tokens)")
    expect(out.lines).toContain(
      "⏸ T-001 /exit inside the recovery wait: the failed session ses_1 is a one-off session with no progress record, so the re-run starts it anew",
    )
    expect(await recallProgress(dir, task.id)).toMatchObject({ session: "ses_1", used: 5000 })
    expect(waitLine(out.lines)).toBeUndefined()
  })

  test("the recorded figure stands in for an agent that keeps no history", async () => {
    const agent = make({ capabilities: { history: false } })
    expect(await sessionUsage(agent.client, "ses_9", 5000)).toEqual({ used: 5000, pct: 100, errorStub: false })
    expect((await sessionUsage(agent.client, "ses_9")).used).toBe(0)
    expect(agent.argsOf("messages")).toEqual([])
  })
})

// The account's usage windows (plans/0057 §5.2): the `limit` event is logged
// when its status or a window's reset changes, once per agent across its
// sessions, and never settles anything.
describe("usage windows (plans/0057 §5.2)", () => {
  const FIVE = Date.parse("2026-09-27T03:20:00Z")
  const WEEK = Date.parse("2026-09-30T22:00:00Z")
  const limit = (status: "allowed" | "warning" | "rejected", five = FIVE, used = 0.04): AgentEvent => ({
    type: "limit",
    session: "s",
    status,
    windows: [
      { scope: "5h", resetAt: five, utilization: used },
      { scope: "7d", resetAt: WEEK, utilization: 0.4 },
    ],
  })
  const logged = async (agent: FakeAgent, events: AgentEvent[]): Promise<{ result: Watch; lines: string[] }> => {
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    })
    try {
      return { result: await watch(agent.client, "s", stream([...events, ev.text("s", "t", "done"), ev.idle("s")]), opts), lines: lines.filter((line) => line.includes("usage window")) }
    } finally {
      printed.mockRestore()
    }
  }

  test("logged when the status or a reset changes, not when only the utilization moves", async () => {
    const agent = make()
    const first = await logged(agent, [limit("allowed"), limit("allowed", FIVE, 0.07), limit("warning", FIVE, 0.92), limit("rejected", FIVE, 1)])
    expect(first.result.error).toBe("")
    expect(first.result.lastText).toBe("done")
    expect(first.lines).toEqual([
      "ℹ usage windows (session s): 5h 4% used, resets 2026-09-27T03:20:00.000Z; 7d 40% used, resets 2026-09-30T22:00:00.000Z",
      "⚠ usage windows near their limit (session s): 5h 92% used, resets 2026-09-27T03:20:00.000Z; 7d 40% used, resets 2026-09-30T22:00:00.000Z",
      "⚠ a usage window is spent (session s): 5h 100% used, resets 2026-09-27T03:20:00.000Z; 7d 40% used, resets 2026-09-30T22:00:00.000Z",
    ])
    // The next session on the same agent: unchanged windows stay quiet, the
    // next five-hour window is logged.
    const next = await logged(agent, [limit("rejected", FIVE, 1), limit("allowed", FIVE + 5 * 3_600_000, 0.01)])
    expect(next.lines).toEqual(["ℹ usage windows (session s): 5h 1% used, resets 2026-09-27T08:20:00.000Z; 7d 40% used, resets 2026-09-30T22:00:00.000Z"])
    // Another agent has its own account.
    expect((await logged(make(), [limit("allowed")])).lines).toHaveLength(1)
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
    router: services().router,
    clock: clockAt(NOW),
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

// The per-agent fork base (plans/0055 §8.4) over a two-agent pool of different
// capabilities: the digest base is built lazily on the agent of the first
// subtask that forks on it, dispatched with the model the `subtask` route
// selects (not `bypass`, variant and base step included); a subtask that
// moved to another agent forks from that agent's base, building it on first
// use while the other agents' entries stay untouched; a dead base is rebuilt
// on its own agent.
describe("the per-agent fork base (plans/0055 §8.4)", () => {
  const PHASE_TYPES = ["analysis", "design", "implement", "test", "acceptance", "knowledge"]

  // deep [a1 (agent a), b1 (agent b)], simple [a1, b1]. The default registry
  // adds a `subtask` route naming b1 (with a variant), so the subtask route's
  // pick — agent b, other/b, think — differs from what the deep pick before
  // it (a1 on agent a) and what a bypass dispatch (the simple tier's first
  // candidate a1) would take: the base's model and agent both prove the
  // route.
  const FLEET_ROUTE = JSON.stringify({
    agents: { a: { adapter: "fake-a" }, b: { adapter: "fake-b" } },
    models: { a1: { agent: "a", model: "prov/a" }, b1: { agent: "b", model: "other/b", variant: "think" } },
    tiers: { deep: ["a1", "b1"], simple: ["a1", "b1"] },
    routes: { subtask: ["b1"] },
  })
  // Without the route the tiers decide: the simple tier's first candidate
  // (a1 on agent a) serves a subtask until it is down, then b1 on agent b.
  const FLEET_TIERS = JSON.stringify({
    agents: { a: { adapter: "fake-a" }, b: { adapter: "fake-b" } },
    models: { a1: { agent: "a", model: "prov/a" }, b1: { agent: "b", model: "other/b" } },
    tiers: { deep: ["a1", "b1"], simple: ["a1", "b1"] },
  })

  type BaseFleet = {
    a: FakeAgent
    b: FakeAgent
    goneA: string[]
    goneB: string[]
    pool: Exclude<Awaited<ReturnType<typeof startPool>>["pool"], undefined>
    facts: RoutingFacts
    dir: string
    plan: Plan
    task: Task
  }

  // Two fake agents of different capabilities (fake-a asks no questions and
  // grants no permission events but keeps readable history, so the base's
  // usage rebuild works on both), registered as shell adapters and run
  // through a real pool over a registry loaded from JSON.
  async function baseFleet(registryText: string = FLEET_ROUTE): Promise<BaseFleet> {
    const dir = await mkdtemp(join(tmpdir(), "auto-fork-base-"))
    const goneA: string[] = []
    const goneB: string[] = []
    const a = fakeAgent({ capabilities: { question: false, permission: false }, limits: { "prov/a": 100_000 }, gone: goneA })
    const b = fakeAgent({ limits: { "other/b": 100_000 }, gone: goneB })
    registerAgentAdapter("fake-a", { host: fakeAgentHost(a).factory, capabilities: { ...FULL_CAPABILITIES, question: false, permission: false } })
    registerAgentAdapter("fake-b", { host: fakeAgentHost(b).factory, capabilities: FULL_CAPABILITIES })
    // Offset the two fakes' id counters so a test can tell the two agents'
    // session ids apart (each fake numbers its own sessions from ses_1).
    await a.client.create({ title: "warmup" })
    const file = join(dir, "models.json")
    await writeFile(file, registryText)
    const registry = await loadModels(dir, { phaseTypes: PHASE_TYPES, env: { OPENCODE_AUTO_MODELS: file } })
    if (registry === undefined) throw new Error("the test registry did not load")
    const started = await startPool(dir, { registry })
    if (started.pool === undefined) throw new Error(started.error)
    // No agent filter is in force (the ambient OPENCODE_AUTO_AGENT would
    // otherwise narrow the fleet).
    const facts = { ...routingFacts(registry, undefined, services().clock, services().router, started.profileName), agentFilter: undefined, filterSource: undefined }
    const plan = await seedUnits(dir, `## T-001: per-agent base [in_progress]\nBody.\n`)
    await Bun.write(join(dir, "docs", "T-001", "context.md"), "## Relevant files\n- a.ts\n")
    return { a, b, goneA, goneB, pool: started.pool, facts, dir, plan, task: plan.tasks[0]! }
  }

  const teardown = async (fleet: BaseFleet): Promise<void> => {
    fleet.pool.close()
    await rm(fleet.dir, { recursive: true, force: true })
  }

  const recordOf = async (fleet: BaseFleet): Promise<Record<string, string>> => JSON.parse(await unitsText(fleet.dir)).tasks["T-001"].forkBase

  let printed: ReturnType<typeof spyOn>
  let lines: string[]

  beforeEach(() => {
    lines = []
    printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    })
  })

  afterEach(() => {
    printed.mockRestore()
    resetShellAdapters()
  })

  test("the digest base is built on the first forking subtask's agent with the subtask route's model", async () => {
    const fleet = await baseFleet()
    try {
      const opts: Opts = { routing: fleet.facts, server: fleet.pool, dir: fleet.dir }
      // The chain after the decompose dispatch: deep picked a1, so the chain
      // runs on agent a while the subtask route's pick is b1 on agent b.
      const chain: SessionChain = { pct: 100, used: 0, at: 0, agent: "a" }
      const base = await ensureForkBase(fleet.pool, fleet.plan, fleet.task, opts, chain, DEFAULTS)
      expect(base).toMatchObject({ agent: "b" })
      // The one-shot build dispatched on agent b alone, with the subtask
      // route's model and variant (a bypass build would have taken the
      // simple tier's first candidate a1 on agent a).
      expect(fleet.a.prompts).toEqual([])
      expect(fleet.b.prompts).toHaveLength(1)
      expect(fleet.b.prompts[0]).toMatchObject({ model: "other/b", variant: "think" })
      // The ready line names the agent and the model under a registry.
      expect(lines.some((line) => line.includes(`digest base ready: session ${base!.id} on agent b (model b1,`))).toBe(true)
      // The record is the per-agent map, stored under the agent the base
      // session lives on.
      expect(await recordOf(fleet)).toEqual({ b: `digest:${base!.id}` })
      // The seeding forks that agent's base and moves the chain's binding to
      // it, so the pending session and its consuming dispatch agree on the
      // agent.
      const sub: SessionChain = { pct: 10, used: 5, at: 0, id: "ses_prev", agent: "a" }
      await expect(seedForkSession(fleet.pool, opts, sub, base, "T-001 S1 x")).resolves.toBe(true)
      expect(sub.agent).toBe("b")
      expect(sub.pending).not.toBe(base!.id)
      expect(sub.forkBase).toBe(base!.id)
      expect(fleet.b.argsOf("fork")).toEqual([[base!.id, undefined]])
      expect(fleet.a.argsOf("fork")).toEqual([])
    } finally {
      await teardown(fleet)
    }
  })

  test("a second agent gets its own base lazily, and the other agents' entries stay untouched", async () => {
    const fleet = await baseFleet(FLEET_TIERS)
    try {
      const opts: Opts = { routing: fleet.facts, server: fleet.pool, dir: fleet.dir }
      // The first forking subtask: the chain runs on agent a (the decompose
      // dispatch's agent) and the simple tier's first candidate a1 is on a
      // too, so the base is built and recorded there.
      const first = await ensureForkBase(fleet.pool, fleet.plan, fleet.task, opts, { pct: 100, used: 0, at: 0, agent: "a" }, DEFAULTS)
      expect(first).toMatchObject({ agent: "a" })
      expect(fleet.a.prompts[0]!.model).toBe("prov/a")
      // A failover moved the chain to agent b (a1 marked down): the next
      // subtask resolves b's base on first use. The reload mirrors the
      // pipeline, which re-reads the task between subtasks.
      services().router.markModelDown("a1")
      const fresh = (await reloadUnits(fleet.dir)).tasks[0]!
      const second = await ensureForkBase(fleet.pool, fleet.plan, fresh, opts, { pct: 100, used: 0, at: 0, agent: "b" }, DEFAULTS)
      expect(second).toMatchObject({ agent: "b" })
      expect(fleet.b.prompts[0]!.model).toBe("other/b")
      expect(await recordOf(fleet)).toEqual({ a: `digest:${first!.id}`, b: `digest:${second!.id}` })
      // The base of an agent that did not move is reused as-is: no second
      // build runs on a while its base is alive.
      const again = await ensureForkBase(fleet.pool, fleet.plan, fresh, opts, { pct: 100, used: 0, at: 0, agent: "a" }, DEFAULTS)
      expect(again).toMatchObject({ id: first!.id, agent: "a" })
      expect(fleet.a.prompts).toHaveLength(1)
    } finally {
      await teardown(fleet)
    }
  })

  test("a dead base is rebuilt on its own agent, leaving the other agents' entries alone", async () => {
    const fleet = await baseFleet(FLEET_TIERS)
    try {
      const opts: Opts = { routing: fleet.facts, server: fleet.pool, dir: fleet.dir }
      const onA = await ensureForkBase(fleet.pool, fleet.plan, fleet.task, opts, { pct: 100, used: 0, at: 0, agent: "a" }, DEFAULTS)
      services().router.markModelDown("a1")
      let fresh = (await reloadUnits(fleet.dir)).tasks[0]!
      const onB = await ensureForkBase(fleet.pool, fleet.plan, fresh, opts, { pct: 100, used: 0, at: 0, agent: "b" }, DEFAULTS)
      expect(onA!.id).not.toBe(onB!.id)
      // Storage cleanup took b's base (a1 is still down, so the rebuild stays
      // on agent b's candidate). The reload mirrors the pipeline, which
      // re-reads the task between subtasks.
      fleet.goneB.push(onB!.id)
      fresh = (await reloadUnits(fleet.dir)).tasks[0]!
      const rebuilt = await ensureForkBase(fleet.pool, fleet.plan, fresh, opts, { pct: 100, used: 0, at: 0, agent: "b" }, DEFAULTS)
      expect(rebuilt).toMatchObject({ agent: "b" })
      expect(rebuilt!.id).not.toBe(onB!.id)
      expect(fleet.b.argsOf("create")).toHaveLength(2)
      expect(lines.some((line) => line.includes(`persistent digest base ${onB!.id} on agent b is stale`))).toBe(true)
      // a's entry survived b's rebuild untouched.
      expect(await recordOf(fleet)).toEqual({ a: `digest:${onA!.id}`, b: `digest:${rebuilt!.id}` })
    } finally {
      await teardown(fleet)
    }
  })

  test("without a registry the base lines and the record keep the one-agent era's shape", async () => {
    const agent = make()
    const dir = await mkdtemp(join(tmpdir(), "auto-fork-plain-"))
    try {
      const plan = await seedUnits(dir, `## T-001: plain base [in_progress]\nBody.\n`)
      await Bun.write(join(dir, "docs", "T-001", "context.md"), "## Relevant files\n- a.ts\n")
      const base = await ensureForkBase(agent.client, plan, plan.tasks[0]!, {}, { pct: 100, used: 0, at: 0 }, DEFAULTS)
      expect(base).toEqual({ id: "ses_1", used: 1000, digest: true })
      // The record stays the plain string and the ready line names neither
      // an agent nor a model.
      expect(await unitsText(dir)).toContain('"forkBase": "digest:ses_1"')
      expect(lines.some((line) => line.includes("digest base ready: session ses_1 (digest prefix 1000 tokens)"))).toBe(true)
      const chain: SessionChain = { pct: 10, used: 5, at: 0, id: "ses_prev" }
      await expect(seedForkSession(agent.client, {}, chain, base, "T-001 S1 x")).resolves.toBe(true)
      expect(chain.pending).toBe("ses_2")
      expect(lines.some((line) => line.includes("forked a new session from base ses_1 (prefix 1000 tokens)"))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("runner dispatch by subtask mode (plans/0059 D1)", () => {
  // Log lines of the runs, kept out of the test output.
  let printed: ReturnType<typeof spyOn>
  beforeEach(() => {
    printed = spyOn(console, "log").mockImplementation(() => {})
  })
  afterEach(() => {
    printed.mockRestore()
  })

  // A committed repository with one pending task; the task runs with no
  // wrap-up, so its sessions are the execution stage's alone.
  const run = async (subtask: Opts["subtask"]) => {
    const dir = await freshRepo()
    await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
    const plan = await seedUnits(dir, `## T-001: sample task [pending]\nBody.\n`)
    await git(dir, "add", "-A")
    await git(dir, "commit", "-q", "-m", "init")
    const agent = make()
    try {
      const outcome = await runTask(agent.client, plan, plan.tasks[0]!, { dir, commit: true, wrapup: false, router: services().router, ...(subtask ? { subtask } : {}) })
      return { outcome, prompts: agent.prompts.map((prompt) => prompt.text.replaceAll(dir, "<dir>")), creates: names(agent).filter((name) => name === "create").length }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  test("auto — the default — runs one lead session: ondemand's whole-task session with the context-budget protocol plus the split clause, no decompose", async () => {
    const ondemand = await run("ondemand")
    expect(ondemand.outcome).toEqual({ type: "completed" })
    expect(ondemand.prompts).toHaveLength(1)
    expect(ondemand.prompts[0]).toContain("Context-budget protocol")
    expect(ondemand.prompts[0]).not.toContain("Split rule")
    const auto = await run("auto")
    for (const lead of [auto, await run(undefined)]) {
      expect(lead.outcome).toEqual({ type: "completed" })
      expect(lead.prompts).toEqual(auto.prompts)
      expect(lead.prompts).toHaveLength(1)
      expect(lead.prompts[0]).toContain("Context-budget protocol")
      expect(lead.prompts[0]).toContain("Split rule (adaptive decomposition)")
      expect(lead.creates).toBe(1)
    }
    // off is the same whole-task session without the protocol.
    const off = await run("off")
    expect(off.outcome).toEqual({ type: "completed" })
    expect(off.prompts).toHaveLength(1)
    expect(off.prompts[0]).not.toContain("Context-budget protocol")
  })

  test("true's subtasks fork the digest base and are told only the digest is inherited, see the other items by title, and the last one runs the full verification (plans/0059 T1, T2, T5)", async () => {
    const dir = await freshRepo()
    await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
    const plan = await seedUnits(dir, `## T-001: sample task [pending]\nBody.\n`)
    await git(dir, "add", "-A")
    await git(dir, "commit", "-q", "-m", "init")
    const doc = (head: string) => `${head}\n\n${"Background the subtasks rely on. ".repeat(6)}\n\n<!-- auto: eof -->\n`
    const checklist = [
      "- [ ] alpha: the alpha module in src/alpha.ts, with its constant and a check that reads it back Artifacts: src/alpha.ts",
      "- [ ] beta: the beta module in src/beta.ts, with its constant and a check that reads it back Artifacts: src/beta.ts",
      "",
      "<!-- auto: eof -->",
      "",
    ].join("\n")
    const agent = make({
      turn: (ctx) => {
        if (ctx.n === 1) {
          mkdirSync(join(dir, "docs/T-001/S01"), { recursive: true })
          mkdirSync(join(dir, "docs/T-001/S02"), { recursive: true })
          writeFileSync(join(dir, "docs/T-001/context.md"), doc("## Relevant files and key symbols\n- src/alpha.ts, src/beta.ts"))
          writeFileSync(join(dir, "docs/T-001/shared.md"), doc("- src/index.ts: the module index both items extend"))
          writeFileSync(join(dir, "docs/T-001/subtasks.md"), checklist)
          writeFileSync(join(dir, "docs/T-001/S01/todo.md"), doc("## Scope\n\nThe alpha module.\n\n## Artifacts\n\n- src/alpha.ts"))
          writeFileSync(join(dir, "docs/T-001/S02/todo.md"), doc("## Scope\n\nThe beta module.\n\n## Artifacts\n\n- src/beta.ts"))
        }
        if (ctx.text.includes("item 1 of that list only")) writeFileSync(join(dir, "src/alpha.ts"), "export const alpha = 1\n")
        if (ctx.text.includes("item 2 of that list only")) writeFileSync(join(dir, "src/beta.ts"), "export const beta = 1\n")
        return undefined
      },
    })
    try {
      mkdirSync(join(dir, "src"), { recursive: true })
      const outcome = await runTask(agent.client, plan, plan.tasks[0]!, { dir, commit: true, wrapup: false, subtask: "true", router: services().router })
      expect(outcome).toEqual({ type: "completed" })
      const prompts = agent.prompts.map((prompt) => prompt.text)
      // decompose, the digest base, then the two subtasks, each a fork of the base.
      expect(prompts).toHaveLength(4)
      const base = agent.prompts[1]!.session
      expect(agent.argsOf("fork").map((args) => args[0])).toEqual([base, base])
      const [first, second] = [prompts[2]!, prompts[3]!]
      expect(first).toContain("The subtask list of this task, by title (executed in order; the other items belong to other sessions, do not touch them):\n\n1. alpha\n2. beta\n")
      expect(first).toContain(`You are responsible for item 1 of that list only:\n\n${checklist.split("\n")[0]}\n`)
      expect(first).not.toContain("the beta module in src/beta.ts")
      expect(first).toContain("This session has inherited the task-background digest: the text of docs/T-001/context.md is already in context")
      expect(first).not.toContain("loaded content")
      expect(first).toContain("Verification: run the checks that target this subtask's own changes")
      expect(first).not.toContain("This is the last subtask")
      expect(second).not.toContain("the alpha module in src/alpha.ts")
      expect(second).toContain("This is the last subtask: once it is done, run the task's full acceptance verification once")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("true runs the planned pipeline: the merged understand/decompose session comes first", async () => {
    // The fake's default turn writes none of the decompose artifacts, so the
    // session is re-prompted once with feedback and the task blocks there.
    const pipeline = await run("true")
    expect(pipeline.outcome).toMatchObject({ type: "blocked" })
    expect((pipeline.outcome as { question: string }).question).toContain("decompose session ended twice")
    expect(pipeline.prompts[0]).toContain("This session completes the task-background understanding and the subtask decomposition")
    expect(pipeline.prompts[0]).not.toContain("Context-budget protocol")
  })
})

describe("auto's lead and its split (plans/0059 D2–D5)", () => {
  let lines: string[]
  let printed: ReturnType<typeof spyOn>
  beforeEach(() => {
    lines = []
    printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    })
  })
  afterEach(() => {
    printed.mockRestore()
  })

  // The wall on the fake's 100k window at the default 64k cap is 80k (the
  // 2×cap budget clamped to 80% of the window), so half of it is 40k: the
  // lead scripts 50k to reach it, the default turn's 1000 does not.
  const BIG = 50_000
  const SPLIT = [
    "- [ ] alpha: the alpha module in src/alpha.ts, verify by reading it back Depends: none Artifacts: src/alpha.ts",
    "- [ ] beta: the beta module in src/beta.ts, verify by reading it back Depends: none Artifacts: src/beta.ts",
    "",
  ].join("\n")

  // A committed repository with one pending task (wrap-up off: the sessions
  // are the execution stage's alone). `seed` writes files before the initial
  // commit; the turn script receives the directory.
  const run = async (
    turn: (dir: string) => FakeAgentOptions["turn"],
    options: { capabilities?: FakeAgentOptions["capabilities"]; seed?: (dir: string) => Promise<void>; body?: string; agent?: FakeAgentOptions; opts?: Partial<Opts> } = {},
  ) => {
    const dir = await freshRepo()
    await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
    const plan = await seedUnits(dir, `## T-001: sample task [pending]\n${options.body ?? "Body.\n"}`)
    await options.seed?.(dir)
    await git(dir, "add", "-A")
    await git(dir, "commit", "-q", "-m", "init")
    const script = turn(dir)
    const agent = make({ ...options.agent, ...(script ? { turn: script } : {}), ...(options.capabilities ? { capabilities: options.capabilities } : {}) })
    const outcome = await runTask(agent.client, plan, plan.tasks[0]!, { dir, commit: true, wrapup: false, subtask: "auto", router: services().router, ...options.opts })
    return { dir, agent, outcome, prompts: agent.prompts.map((prompt) => prompt.text) }
  }
  const write = (dir: string, rel: string, text: string) => {
    mkdirSync(join(dir, rel, ".."), { recursive: true })
    writeFileSync(join(dir, rel), text)
  }
  const big = (session: string, n: number): AgentEvent[] => [ev.message(session, `m_big_${n}`, BIG), ev.text(session, `t_${n}`, "split"), ev.idle(session)]
  const read = (dir: string, rel: string) => readFileSync(join(dir, rel), "utf8")
  const subjects = async (dir: string) => (await git(dir, "log", "--format=%s")).trim().split("\n")

  test("no split: the lead finishes the task alone — one session, nothing judged", async () => {
    const { dir, outcome, prompts } = await run(() => undefined)
    try {
      expect(outcome).toEqual({ type: "completed" })
      expect(prompts).toHaveLength(1)
      expect(prompts[0]).toContain("You are the lead session of this task")
      expect(existsSync(join(dir, "docs/T-001/subtasks.md"))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a split the guard takes: the driver writes each line's todo.md, the lead's work lands in the exec commit, and the streams run as forks of the lead", async () => {
    const { dir, agent, outcome, prompts } = await run((dir) => (ctx) => {
      if (ctx.n === 1) {
        write(dir, "src/shared.ts", "export const shared = 1\n")
        write(dir, "docs/T-001/subtasks.md", SPLIT)
        return big(ctx.session, ctx.n)
      }
      if (ctx.text.includes("runs stream T-001.S01")) write(dir, "src/alpha.ts", "export const alpha = 1\n")
      if (ctx.text.includes("runs stream T-001.S02")) write(dir, "src/beta.ts", "export const beta = 1\n")
      return undefined
    })
    try {
      expect(outcome).toEqual({ type: "completed" })
      expect(prompts).toHaveLength(3)
      // Each stream is a fork of the lead (plans/0059 D5), sent the delta alone.
      const lead = agent.prompts[0]!.session
      expect(agent.argsOf("fork").map((args) => args[0])).toEqual([lead, lead])
      expect(agent.prompts[1]!.session).not.toBe(lead)
      expect(agent.prompts[2]!.session).not.toBe(agent.prompts[1]!.session)
      expect(prompts[1]).toStartWith("[DRIVER] Your split was taken")
      expect(prompts[1]).toContain(`- [ ] ${SPLIT.split("\n")[0]!.slice("- [ ] ".length)}`)
      expect(prompts[1]).toContain("- S02 beta\n")
      expect(prompts[1]).not.toContain("This is the last stream")
      expect(prompts[2]).toContain("runs stream T-001.S02")
      expect(prompts[2]).toContain("- S01 alpha (done)\n")
      expect(prompts[2]).toContain("This is the last stream")
      // S02 declares no prerequisite: no changed-files list.
      expect(prompts[2]).toContain("Do not re-read what you already read")
      expect(lines.some((line) => line.includes(`lead base: session ${lead} (50.0k tokens)`))).toBe(true)
      // The driver's scope files, renamed to done.md at each stream's close-out.
      expect(read(dir, "docs/T-001/S01/done.md")).toBe(
        "Depends: none\nTouches: src/alpha.ts\n\n## Scope\n\nalpha: the alpha module in src/alpha.ts, verify by reading it back\n\n## Artifacts\n\n- src/alpha.ts\n\n<!-- auto: eof -->\n",
      )
      expect(existsSync(join(dir, "docs/T-001/S02/done.md"))).toBe(true)
      expect(read(dir, "docs/T-001/subtasks.md")).toBe(SPLIT.replaceAll("- [ ]", "- [x]"))
      // The lead's commit holds its own work, the checklist and the scope
      // files; each stream then commits on its own.
      const log = await subjects(dir)
      expect(log[0]).toStartWith("T-001 S2 beta")
      expect(log[1]).toStartWith("T-001 S1 alpha")
      expect(log[2]).toBe("T-001 exec sample task")
      const exec = (await git(dir, "show", "--name-only", "--format=", "HEAD~2")).trim().split("\n").sort()
      expect(exec).toEqual(["docs/T-001/S01/todo.md", "docs/T-001/S02/todo.md", "docs/T-001/subtasks.md", "src/shared.ts"])
      expect(lines.some((line) => line.includes("the lead split the remaining work into 2 streams (S01, S02)"))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a split the guard rejects: subtasks.md is removed, the lead's work is committed, and a fork of the lead gets the reason alone — no second split", async () => {
    const { dir, agent, outcome, prompts } = await run((dir) => (ctx) => {
      write(dir, "docs/T-001/subtasks.md", "- [ ] everything: the rest Depends: none Artifacts: src/all.ts\n")
      if (ctx.n === 1) {
        write(dir, "src/lead.ts", "export const lead = 1\n")
        return big(ctx.session, ctx.n)
      }
      // The continuation writes a checklist again: ignored and removed.
      write(dir, "src/all.ts", "export const all = 1\n")
      return undefined
    })
    try {
      expect(outcome).toEqual({ type: "completed" })
      expect(prompts).toHaveLength(2)
      expect(names(agent)).toContain("fork")
      // The fork already holds the task and the lead's work: the note alone.
      expect(prompts[1]).toBe(
        "[DRIVER] The split was not taken: 1 item, where a split takes 2 to 5 streams. docs/T-001/subtasks.md has been removed. " +
          "Finish the task in this session and do not split it again — a new docs/T-001/subtasks.md would be ignored and removed; the context-budget protocol still applies if the budget runs out.",
      )
      expect(agent.prompts[1]!.session).not.toBe(agent.prompts[0]!.session)
      expect(existsSync(join(dir, "docs/T-001/subtasks.md"))).toBe(false)
      expect(existsSync(join(dir, "docs/T-001/S01"))).toBe(false)
      const log = await subjects(dir)
      expect(log.slice(0, 2)).toEqual(["T-001 exec sample task", "T-001 exec sample task"])
      expect((await git(dir, "show", "--name-only", "--format=", "HEAD~1")).trim()).toBe("src/lead.ts")
      expect((await git(dir, "show", "--name-only", "--format=", "HEAD")).trim()).toBe("src/all.ts")
      expect(lines.some((line) => line.includes("was written again after the rejected split; ignored and removed"))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the usage condition: a sound split from a lead under half the wall is not taken", async () => {
    const { dir, outcome, prompts } = await run((dir) => (ctx) => {
      if (ctx.n === 1) write(dir, "docs/T-001/subtasks.md", SPLIT)
      else write(dir, "src/done.ts", "export const done = 1\n")
      return undefined
    })
    try {
      expect(outcome).toEqual({ type: "completed" })
      expect(prompts).toHaveLength(2)
      expect(prompts[1]).toStartWith("[DRIVER] The split was not taken: the lead's context (1000 tokens) is under half the wall (80.0k)")
      expect(existsSync(join(dir, "docs/T-001/S01"))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a lead stopped before its split is judged (blocked): the unjudged checklist is removed, so the interruption commit cannot keep it", async () => {
    const { dir, outcome } = await run((dir) => (ctx) => {
      write(dir, "docs/T-001/subtasks.md", SPLIT)
      return [ev.question(ctx.session, "q1", "which db?"), ev.question(ctx.session, "q2", "which db?"), ev.idle(ctx.session)]
    })
    try {
      expect(outcome).toMatchObject({ type: "blocked" })
      expect(existsSync(join(dir, "docs/T-001/subtasks.md"))).toBe(false)
      expect(lines.some((line) => line.includes("the unjudged split was removed"))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a rejected lead whose fork fails (its session is gone): it continues in a new session with the full prompt, no split clause, and the note saying the earlier work is committed", async () => {
    const { dir, outcome, prompts } = await run(
      (dir) => (ctx) => {
        if (ctx.n === 1) {
          write(dir, "docs/T-001/subtasks.md", "- [ ] everything: the rest Artifacts: src/all.ts\n")
          return big(ctx.session, ctx.n)
        }
        return undefined
      },
      { agent: { fail: { fork: new Error("fork refused") } } },
    )
    try {
      expect(outcome).toEqual({ type: "completed" })
      expect(prompts).toHaveLength(2)
      expect(prompts[1]).toContain("You are responsible for the whole task this time, completed within a single session")
      expect(prompts[1]).not.toContain("Split rule")
      expect(prompts[1]).toContain("\n\n[DRIVER] The split was not taken: 1 item, where a split takes 2 to 5 streams.")
      expect(prompts[1]).toContain("its changes are committed: check git log and git diff")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an agent that cannot fork (plans/0059 D7): the run start withholds the clause — the lead is ondemand's session, and a checklist it writes runs after it, unjudged", async () => {
    const { dir, outcome, prompts } = await run(
      (dir) => (ctx) => {
        if (ctx.n === 1) write(dir, "docs/T-001/subtasks.md", SPLIT)
        if (ctx.text.includes("item 1 of that list only")) write(dir, "src/alpha.ts", "export const alpha = 1\n")
        if (ctx.text.includes("item 2 of that list only")) write(dir, "src/beta.ts", "export const beta = 1\n")
        return undefined
      },
      { capabilities: { fork: "none" }, opts: { leadSplit: false } },
    )
    try {
      expect(outcome).toEqual({ type: "completed" })
      // Ondemand's whole-task session: the protocol, no clause.
      expect(prompts[0]).toContain("Context-budget protocol")
      expect(prompts[0]).not.toContain("Split rule")
      expect(prompts[0]).not.toContain("You are the lead session of this task")
      // Not judged: no driver-written scope files, the items run on ticks.
      expect(prompts).toHaveLength(3)
      expect(existsSync(join(dir, "docs/T-001/S01"))).toBe(false)
      expect(lines.some((line) => line.includes("already holds a checklist"))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a split taken by an earlier run with no split record (a checklist the planned pipeline left reads the same): the lead does not run again, the items run as plain subtasks", async () => {
    const { dir, outcome, prompts } = await run(
      (dir) => (ctx) => {
        if (ctx.text.includes("item 1 of that list only")) write(dir, "src/alpha.ts", "export const alpha = 1\n")
        if (ctx.text.includes("item 2 of that list only")) write(dir, "src/beta.ts", "export const beta = 1\n")
        return undefined
      },
      {
        seed: async (dir) => {
          write(dir, "docs/T-001/subtasks.md", SPLIT)
          write(dir, "docs/T-001/S01/todo.md", "Depends: none\nTouches: src/alpha.ts\n\n## Scope\n\nalpha\n\n## Artifacts\n\n- src/alpha.ts\n\n<!-- auto: eof -->\n")
          write(dir, "docs/T-001/S02/todo.md", "Depends: none\nTouches: src/beta.ts\n\n## Scope\n\nbeta\n\n## Artifacts\n\n- src/beta.ts\n\n<!-- auto: eof -->\n")
        },
      },
    )
    try {
      expect(outcome).toEqual({ type: "completed" })
      expect(prompts).toHaveLength(2)
      expect(prompts[0]).toContain("You are responsible for item 1 of that list only")
      expect(prompts.some((prompt) => prompt.includes("lead session"))).toBe(false)
      expect(lines.some((line) => line.includes("the lead's split was taken earlier"))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a checklist written by hand before the run: the lead gets no split clause, and the checklist runs after it, as under ondemand", async () => {
    const { dir, outcome, prompts } = await run(
      (dir) => (ctx) => {
        if (ctx.n === 2) write(dir, "src/extra.ts", "export const extra = 1\n")
        return undefined
      },
      { body: "Body.\n\n- [ ] the extra step\n" },
    )
    try {
      expect(outcome).toEqual({ type: "completed" })
      expect(prompts).toHaveLength(2)
      expect(prompts[0]).toContain("Context-budget protocol")
      expect(prompts[0]).not.toContain("Split rule")
      expect(prompts[1]).toContain("- [ ] the extra step")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // —— The streams of a taken split (plans/0059 D5) ——

  // S02 waits for S01: the changed-files list names what S01 changed.
  const DEPENDENT = [
    "- [ ] alpha: the alpha module in src/alpha.ts, verify by reading it back Depends: none Artifacts: src/alpha.ts",
    "- [ ] beta: the beta module over alpha in src/beta.ts, verify by reading it back Depends: S01 Artifacts: src/beta.ts",
    "",
  ].join("\n")
  // The lead's turn that takes a split, and the streams' default work.
  const lead = (dir: string, ctx: { n: number; session: string }, split = SPLIT) => {
    write(dir, "docs/T-001/subtasks.md", split)
    return big(ctx.session, ctx.n)
  }
  const streams = (dir: string, text: string) => {
    if (text.includes("runs stream T-001.S01")) write(dir, "src/alpha.ts", "export const alpha = 1\n")
    if (text.includes("runs stream T-001.S02")) write(dir, "src/beta.ts", "export const beta = 1\n")
  }

  test("a dependent stream: its delta names the files changed since the split, without the driver's checklist ticks and state files", async () => {
    const { dir, outcome, prompts } = await run((dir) => (ctx) => {
      if (ctx.n === 1) return lead(dir, ctx, DEPENDENT)
      streams(dir, ctx.text)
      return undefined
    })
    try {
      expect(outcome).toEqual({ type: "completed" })
      expect(prompts).toHaveLength(3)
      // S01 has no prerequisite.
      expect(prompts[1]).toContain("Do not re-read what you already read")
      expect(prompts[2]).toContain("Since the split, the streams that ran before this one changed these files; re-read those this stream relies on, and nothing else you already read:\n- src/alpha.ts\n\n")
      expect(prompts[2]).not.toContain("subtasks.md\n")
      expect(prompts[2]).not.toContain("S01/done.md")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a stream hands itself over: a new session continues it from handoff.md with the full subtask prompt and the protocol, and one commit closes the stream", async () => {
    const { dir, agent, outcome, prompts } = await run((dir) => (ctx) => {
      if (ctx.n === 1) return lead(dir, ctx)
      if (ctx.text.includes("runs stream T-001.S01")) {
        write(dir, "src/alpha.ts", "export const alpha = 0\n")
        write(dir, "docs/T-001/handoff.md", "alpha is half done: the constant is a placeholder.\n\nStatus: continue\n")
        return undefined
      }
      if (ctx.text.includes("You are responsible for item 1 of that list only")) {
        write(dir, "src/alpha.ts", "export const alpha = 1\n")
        return undefined
      }
      streams(dir, ctx.text)
      return undefined
    })
    try {
      expect(outcome).toEqual({ type: "completed" })
      expect(prompts).toHaveLength(4)
      // The continuation is a new session, not a fork of the lead.
      expect(names(agent).filter((name) => name === "create")).toHaveLength(2)
      expect(agent.argsOf("fork")).toHaveLength(2)
      expect(prompts[2]).toContain("You are responsible for item 1 of that list only")
      expect(prompts[2]).toContain("First read docs/T-001/handoff.md")
      expect(prompts[2]).toContain("Context-budget protocol (this session manages its own context)")
      expect(prompts[3]).toContain("runs stream T-001.S02")
      expect(lines.some((line) => line.includes("subtask 1 session handed itself over as docs/T-001/handoff.md; continuing in a new session"))).toBe(true)
      // One commit per stream; the handover document is gone with the close-out.
      expect((await subjects(dir)).slice(0, 3).map((subject) => subject.split(" ").slice(0, 2).join(" "))).toEqual(["T-001 S2", "T-001 S1", "T-001 exec"])
      expect(existsSync(join(dir, "docs/T-001/handoff.md"))).toBe(false)
      expect(read(dir, "src/alpha.ts")).toBe("export const alpha = 1\n")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a stream hinted at the wall that writes no handover document: one re-prompt in a fork of the ended session, the demand alone", async () => {
    const { dir, agent, outcome, prompts } = await run((dir) => (ctx) => {
      if (ctx.n === 1) return lead(dir, ctx)
      if (ctx.text.includes("runs stream T-001.S01")) {
        write(dir, "src/alpha.ts", "export const alpha = 1\n")
        // Past the 80k wall: the hard-wall hint goes out, no document follows.
        return [ev.message(ctx.session, `m_wall_${ctx.n}`, 85_000), ev.text(ctx.session, `t_${ctx.n}`, "done"), ev.idle(ctx.session)]
      }
      if (ctx.text.startsWith("The last time you ended the session a handover was due")) {
        write(dir, "docs/T-001/handoff.md", "alpha is finished.\n\nStatus: done\n")
        return undefined
      }
      streams(dir, ctx.text)
      return undefined
    })
    try {
      expect(outcome).toEqual({ type: "completed" })
      expect(prompts).toHaveLength(4)
      expect(agent.steers.some((text) => text.startsWith("[DRIVER] This session's context has reached the wall"))).toBe(true)
      // The re-prompt is the feedback alone, in a fork of the stream's ended session.
      expect(prompts[2]).toStartWith("The last time you ended the session a handover was due, but no valid docs/T-001/handoff.md was written")
      expect(agent.argsOf("fork").map((args) => args[0])).toEqual([agent.prompts[0]!.session, agent.prompts[1]!.session, agent.prompts[0]!.session])
      expect(prompts[3]).toContain("runs stream T-001.S02")
      expect(existsSync(join(dir, "docs/T-001/S01/done.md"))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a stream whose fork fails: a new session with the full subtask prompt and the context-budget protocol", async () => {
    const { dir, agent, outcome, prompts } = await run(
      (dir) => (ctx) => {
        if (ctx.n === 1) return lead(dir, ctx)
        if (ctx.text.includes("item 1 of that list only")) write(dir, "src/alpha.ts", "export const alpha = 1\n")
        if (ctx.text.includes("item 2 of that list only")) write(dir, "src/beta.ts", "export const beta = 1\n")
        return undefined
      },
      { agent: { fail: { fork: new Error("fork refused") } } },
    )
    try {
      expect(outcome).toEqual({ type: "completed" })
      expect(prompts).toHaveLength(3)
      expect(agent.argsOf("fork")).toHaveLength(2)
      for (const prompt of prompts.slice(1)) {
        expect(prompt).not.toStartWith("[DRIVER] Your split was taken")
        expect(prompt).toContain("Context-budget protocol (this session manages its own context)")
      }
      expect(prompts[1]).toContain("You are responsible for item 1 of that list only")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a split record left by an earlier run: the streams fork the recorded lead, the lead does not run again", async () => {
    const { dir, agent, outcome, prompts } = await run(
      (dir) => (ctx) => {
        streams(dir, ctx.text)
        return undefined
      },
      {
        seed: async (dir) => {
          write(dir, "docs/T-001/subtasks.md", SPLIT)
          write(dir, "docs/T-001/S01/todo.md", "Depends: none\nTouches: src/alpha.ts\n\n## Scope\n\nalpha\n\n## Artifacts\n\n- src/alpha.ts\n\n<!-- auto: eof -->\n")
          write(dir, "docs/T-001/S02/todo.md", "Depends: none\nTouches: src/beta.ts\n\n## Scope\n\nbeta\n\n## Artifacts\n\n- src/beta.ts\n\n<!-- auto: eof -->\n")
          write(dir, ".auto/units.json", JSON.stringify({ tasks: { "T-001": { forkBase: "ses_lead", split: [] } } }))
        },
        agent: { history: { ses_lead: [{ id: "m_lead", role: "assistant", completed: true, model: MODEL, failed: false, contextUsed: BIG }] } },
      },
    )
    try {
      expect(outcome).toEqual({ type: "completed" })
      expect(prompts).toHaveLength(2)
      expect(agent.argsOf("fork").map((args) => args[0])).toEqual(["ses_lead", "ses_lead"])
      expect(prompts[0]).toStartWith("[DRIVER] Your split was taken")
      expect(prompts[1]).toContain("This is the last stream")
      expect(lines.some((line) => line.includes("lead base: session ses_lead (50.0k tokens)"))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // An agent with no readable session history (claude) cannot tell an ended
  // session's size: the lead's figure travels with the split record instead.
  test("an agent without session history: every stream forks the lead, its size read from the figure recorded with the split", async () => {
    const { dir, agent, outcome, prompts } = await run(
      (dir) => (ctx) => {
        if (ctx.n === 1) {
          write(dir, "docs/T-001/subtasks.md", SPLIT)
          return big(ctx.session, ctx.n)
        }
        streams(dir, ctx.text)
        return undefined
      },
      { capabilities: { history: false } },
    )
    try {
      expect(outcome).toEqual({ type: "completed" })
      expect(prompts).toHaveLength(3)
      const lead = agent.prompts[0]!.session
      expect(agent.argsOf("fork").map((args) => args[0])).toEqual([lead, lead])
      expect(prompts[1]).toStartWith("[DRIVER] Your split was taken")
      expect(prompts[2]).toStartWith("[DRIVER] Your split was taken")
      // The first stream reads the lead's chain, the second the record.
      expect(lines.filter((line) => line.includes(`lead base: session ${lead} (50.0k tokens)`))).toHaveLength(2)
      expect(lines.some((line) => line.includes("base usage unknown"))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an agent without session history, resumed after the split: the streams fork the recorded lead at its recorded size", async () => {
    const { dir, agent, outcome, prompts } = await run(
      (dir) => (ctx) => {
        streams(dir, ctx.text)
        return undefined
      },
      {
        seed: async (dir) => {
          write(dir, "docs/T-001/subtasks.md", SPLIT)
          write(dir, "docs/T-001/S01/todo.md", "Depends: none\nTouches: src/alpha.ts\n\n## Scope\n\nalpha\n\n## Artifacts\n\n- src/alpha.ts\n\n<!-- auto: eof -->\n")
          write(dir, "docs/T-001/S02/todo.md", "Depends: none\nTouches: src/beta.ts\n\n## Scope\n\nbeta\n\n## Artifacts\n\n- src/beta.ts\n\n<!-- auto: eof -->\n")
          write(dir, ".auto/units.json", JSON.stringify({ tasks: { "T-001": { forkBase: "ses_lead", split: [], leadUsed: BIG } } }))
        },
        capabilities: { history: false },
      },
    )
    try {
      expect(outcome).toEqual({ type: "completed" })
      expect(prompts).toHaveLength(2)
      expect(agent.argsOf("fork").map((args) => args[0])).toEqual(["ses_lead", "ses_lead"])
      expect(prompts[0]).toStartWith("[DRIVER] Your split was taken")
      expect(lines.filter((line) => line.includes("lead base: session ses_lead (50.0k tokens)"))).toHaveLength(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("OPENCODE_AUTO_STEER=off: no notices, so no split clause either — a checklist the lead writes runs after it, as under ondemand", async () => {
    clampSwitches({ steer: false })
    try {
      const { dir, outcome, prompts } = await run((dir) => (ctx) => {
        if (ctx.n === 1) write(dir, "docs/T-001/subtasks.md", SPLIT)
        if (ctx.text.includes("item 1 of that list only")) write(dir, "src/alpha.ts", "export const alpha = 1\n")
        if (ctx.text.includes("item 2 of that list only")) write(dir, "src/beta.ts", "export const beta = 1\n")
        return undefined
      })
      try {
        expect(outcome).toEqual({ type: "completed" })
        expect(prompts[0]).not.toContain("Split rule")
        expect(prompts[0]).not.toContain("Context-budget protocol")
        // Not judged: no driver-written scope files, the items run on ticks.
        expect(prompts).toHaveLength(3)
        expect(existsSync(join(dir, "docs/T-001/S01"))).toBe(false)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    } finally {
      clampSwitches({ steer: true })
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
