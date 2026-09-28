// Wiring tests for src/watch.ts (error signals / stats / the two-line report
// driven through attempt or runSession): SSE subscription lifecycle, the
// three trigger surfaces of error signals, session-boundary stats, the ◉
// two-line report, proxy-answer collection. Session-failure exits (session
// error / dispatch failure) are driven directly through attempt — since
// 2026-09-16 runSession no longer returns blocked for failures (it enters
// the wait-and-probe loop, see test/session.test.ts), and attempt's return
// value is the direct exit surface of watch's classification marks (P3).
// Split out of test/runner.test.ts (plans/0024-module-split-plan.md S18,
// pure move).

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { opencodeAgent } from "../src/agent/opencode/client"
import { attempt } from "../src/attempt"
import type { SessionChain } from "../src/chain"
import type { Interactive } from "../src/interactive"
import { resolvesOf } from "../src/resolve"
import { runSession } from "../src/session"
import { flushStats, statsTotals } from "../src/stats"
import { parseSwitches, SWITCH_ENV } from "../src/switches"
import type { TestRun } from "../src/testrun"
import { afterSession, autoAnswer } from "../src/unit-commit"
import { task, fakeClient, freshRepo, sseClient } from "./fixtures/runner"
import { phaseTypeOfLetter, type PhaseLetter } from "../src/phases/registry"

const key = (letter: PhaseLetter) => ({ id: "R-01.P01", entry: phaseTypeOfLetter(letter) })

// ---- SSE subscription lifecycle (attempt tears the stream down at session end — the cure for long-connection leaks) ----

describe("SSE subscription lifecycle (disconnected at session end)", () => {
  test("normal end: after runSession returns, the subscription signal is aborted and the event stream has wound down", async () => {
    const { client, state } = sseClient("ses_sse_1")
    const result = await runSession(client, task, "prompt", {}, { pct: 100, used: 0, at: 0 })
    expect(result.type).toBe("idle")
    expect(state.signal).toBeDefined()
    expect(state.signal?.aborted).toBe(true)
    expect(state.closed).toBe(true)
  })

  test("dispatch-failure early return: the subscription is likewise aborted immediately, leaving no dangling long connection", async () => {
    const { client, state } = sseClient("ses_sse_2", { prompt: () => ({ error: { name: "UnknownError" } }) })
    const result = await attempt(client, task, "prompt", {}, { pct: 100, used: 0, at: 0 }, undefined, undefined, parseSwitches({}))
    expect(result.type).toBe("blocked")
    expect((result as { question: string }).question).toContain("task dispatch failed")
    expect(state.signal?.aborted).toBe(true)
    // The liveness probe's trip race wrapper (S4, watch.ts) leaves the event
    // stream generator's teardown to settle a few microtasks later (this
    // path's attempt returns without awaiting watching) — yield one
    // macrotask before asserting the stream has wound down.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(state.closed).toBe(true)
  })
})

// ---- error-signal wiring → attempt exits (plans/0017-model-routing-design.md D.2/CRITICAL invariant, P3) ----
describe("error-signal wiring: watch's three trigger surfaces → attempt exits (P3 classifies and marks only, makes no candidate decisions)", () => {
  // Zero-wait ladder: this block only checks error classification and exit
  // marks; retry backoff must not drag it out to minutes.
  const SIGNAL_NO_WAIT = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0", [SWITCH_ENV.recoveryWait]: "0" })
  test("retry part quota (isRetryable:false): early settle — abort first, then return; failover=true, errorClass=quota", async () => {
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield {
            type: "message.part.updated",
            properties: {
              part: {
                id: "pt_retry",
                sessionID: sid,
                messageID: "msg_1",
                type: "retry",
                attempt: 2,
                error: { name: "APIError", data: { message: "insufficient_quota", isRetryable: false, statusCode: 429, responseBody: '{"code":"insufficient_quota"}' } },
                time: { created: 1 },
              },
            },
          }
          // Even with a subsequent idle, the early settle has already
          // returned and never reaches settled.
          yield { type: "session.idle", properties: { sessionID: sid } }
        })(),
    })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await attempt(client, task, "prompt", {}, chain, undefined, undefined, SIGNAL_NO_WAIT)
    expect(result.type).toBe("blocked")
    const blocked = result as { question: string; failover?: boolean; errorClass?: string; retryable?: boolean }
    expect(blocked.failover).toBe(true)
    expect(blocked.errorClass).toBe("quota")
    expect(blocked.retryable).toBe(false)
    expect(blocked.question).toContain("session error: ")
    // D.2 core: the abort must precede the early settle (no orphaned server
    // turns or forks concurrently editing files).
    expect(calls.aborts).toContain("ses_new_1")
    expect(calls.creates).toBe(1)
    expect(calls.forks).toEqual([])
  })

  test("session.status retry variant rate (next over the threshold): triggers the early settle and abort", async () => {
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield {
            type: "session.status",
            // opencode's next is the attempt's instant (plans/0057 F3): 40 minutes out.
            properties: { sessionID: sid, status: { type: "retry", attempt: 1, message: "rate limit, retrying later", next: Date.now() + 40 * 60_000 } },
          }
          yield { type: "session.idle", properties: { sessionID: sid } }
        })(),
    })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    // rate carries no isRetryable:false → retryable stays undefined → P3
    // changes no control flow; runSession still retries with new sessions in
    // the existing order until RETRIES is exhausted and it blocks (the
    // failover decision is left to P4 reading result.failover). But every
    // attempt's early settle necessarily aborts — the aborts record proves
    // trigger surface 3 of D.2 is in effect.
    const result = await attempt(client, task, "prompt", {}, chain, undefined, undefined, SIGNAL_NO_WAIT)
    expect(result.type).toBe("blocked")
    expect(calls.aborts.length).toBeGreaterThanOrEqual(1)
    expect(calls.aborts).toContain("ses_new_1")
  })

  test("session.error quota (isRetryable:false): carries errorClass=quota, but no failover, no abort, no early settle", async () => {
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield {
            type: "session.error",
            properties: { sessionID: sid, error: { name: "APIError", data: { message: "insufficient_quota", isRetryable: false, statusCode: 402 } } },
          }
          yield { type: "session.idle", properties: { sessionID: sid } }
        })(),
    })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await attempt(client, task, "prompt", {}, chain, undefined, undefined, SIGNAL_NO_WAIT)
    expect(result.type).toBe("blocked")
    const blocked = result as { errorClass?: string; failover?: boolean; retryable?: boolean }
    expect(blocked.errorClass).toBe("quota")
    expect(blocked.failover).toBeUndefined()
    expect(blocked.retryable).toBe(false)
    // The session.error path never does the early-settle abort.
    expect(calls.aborts).toEqual([])
  })

  test("session.error ordinary retryable 500: no early failover (takes the existing retry-exhaustion path)", async () => {
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield {
            type: "session.error",
            properties: { sessionID: sid, error: { name: "APIError", data: { message: "Internal Server Error", isRetryable: true, statusCode: 500 } } },
          }
          yield { type: "session.idle", properties: { sessionID: sid } }
        })(),
    })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await attempt(client, task, "prompt", {}, chain, undefined, undefined, SIGNAL_NO_WAIT)
    expect(result.type).toBe("blocked")
    expect((result as { failover?: boolean }).failover).toBeUndefined()
    // Retryable 500 → errorClass transient (reported only, no failover; the
    // ladder and wait-and-probe consumption on the runSession side are
    // covered in test/session.test.ts).
    expect(calls.creates).toBe(1)
  })

  test("retry part overflow: accumulates only, no early settle; watching continues to a normal idle end", async () => {
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield {
            type: "message.part.updated",
            properties: {
              part: {
                id: "pt_retry2",
                sessionID: sid,
                messageID: "msg_1",
                type: "retry",
                attempt: 1,
                error: { name: "APIError", data: { message: "ContextOverflowError: input too long", isRetryable: true } },
                time: { created: 1 },
              },
            },
          }
          yield { type: "session.idle", properties: { sessionID: sid } }
        })(),
    })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt", {}, chain, undefined, undefined, SIGNAL_NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.aborts).toEqual([])
  })
})

// ---- session-boundary stats wiring (STATS_PLAN §2, T-003): per-step-finish
// part deduplicated accumulation, the segment closed into the books on every
// exit (including blocked / dispatch failure). Modeled on the :601
// artifactClient technique — the event stream is injected through
// fakeClient's events; stat readings go through statsTotals (public API),
// per-session attribution checked against the flushed .auto/stats.json. ----
describe("session-boundary stats wiring (T-003): Watch.usage and statsSessionBegin/End", () => {
  // Build one step-finish message.part.updated event (missing token
  // sub-fields default to 0).
  const stepFinish = (
    sid: string,
    id: string,
    tokens: { input: number; output: number; reasoning?: number; cache?: { read: number; write: number } },
    cost = 0,
  ) => ({
    type: "message.part.updated",
    properties: {
      part: {
        id,
        sessionID: sid,
        messageID: "msg_1",
        type: "step-finish",
        reason: "stop",
        cost,
        tokens: { reasoning: 0, cache: { read: 0, write: 0 }, ...tokens },
        time: { created: 1 },
      },
    },
  })

  test("Watch.usage = sum over parts (sub-fields include reasoning/cache/cost; steps count parts); per-session attributed to the task", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-stats-"))
    try {
      const { client } = fakeClient({
        events: (sid) =>
          (async function* () {
            yield stepFinish(sid, "pt_sf1", { input: 1200, output: 300, reasoning: 50, cache: { read: 800, write: 100 } }, 0.01)
            yield stepFinish(sid, "pt_sf2", { input: 500, output: 40 })
            // Cross-talk guard: another session's step-finish must not be
            // counted into this one.
            yield stepFinish("ses_other", "pt_sfX", { input: 9999, output: 9999 })
            yield { type: "session.idle", properties: { sessionID: sid } }
          })(),
      })
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const result = await runSession(client, task, "prompt", { dir }, chain)
      expect(result.type).toBe("idle")
      const round = await statsTotals(dir, "round")
      expect(round?.usage).toEqual({ input: 1700, output: 340, reasoning: 50, cacheRead: 800, cacheWrite: 100, cost: 0.01, steps: 2 })
      expect(round?.sessions).toBe(1)
      await flushStats(dir)
      // Per-session booking: sessionID → task association + same-basis
      // usage.
      const doc = JSON.parse(await Bun.file(join(dir, ".auto/stats.json")).text())
      expect(doc.sessions.ses_new_1.task).toBe("T-001")
      expect(doc.sessions.ses_new_1.usage).toEqual({ input: 1700, output: 340, reasoning: 50, cacheRead: 800, cacheWrite: 100, cost: 0.01, steps: 2 })
    } finally {
      await flushStats(dir)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a re-sent part (SSE replaying the same step-finish update event) is not counted twice", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-stats-"))
    try {
      const { client } = fakeClient({
        events: (sid) =>
          (async function* () {
            yield stepFinish(sid, "pt_sf1", { input: 1200, output: 300 }, 0.02)
            yield stepFinish(sid, "pt_sf1", { input: 1200, output: 300 }, 0.02)
            yield { type: "session.idle", properties: { sessionID: sid } }
          })(),
      })
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      await runSession(client, task, "prompt", { dir }, chain)
      const round = await statsTotals(dir, "round")
      expect(round?.usage).toEqual({ input: 1200, output: 300, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0.02, steps: 1 })
    } finally {
      await flushStats(dir)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the blocked exit loses no usage (steps accumulated before the block are booked as usual)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-stats-"))
    try {
      const { sdk } = fakeClient({
        events: (sid) =>
          (async function* () {
            yield stepFinish(sid, "pt_sf1", { input: 1200, output: 300 })
            // A permission question with --wait-answer unset → immediate
            // block (watch's blocked return exit).
            yield { type: "question.asked", properties: { id: "q1", sessionID: sid, questions: [{ question: "Permission request: write a file" }] } }
          })(),
      })
      // fakeClient does not cover the question/permission surfaces; stub
      // them (reject + abort, then return).
      const stubbed = opencodeAgent({
        ...sdk,
        question: { reply: async () => ({}), reject: async () => ({}) },
        permission: { reply: async () => ({}) },
      } as unknown as OpencodeClient)
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const result = await runSession(stubbed, task, "prompt", { dir }, chain)
      expect(result.type).toBe("blocked")
      const round = await statsTotals(dir, "round")
      expect(round?.usage).toEqual({ input: 1200, output: 300, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 1 })
      expect(round?.sessions).toBe(1)
    } finally {
      await flushStats(dir)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("dispatch-failure path: finally closes the segment as a safety net (zero usage still recorded, sessions +1, no dangling AI segment)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-stats-"))
    try {
      const { client } = fakeClient({ prompt: () => ({ error: { name: "UnknownError", data: {} } }) })
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      // Dispatch failure (since 2026-09-16 the runSession side retries it as
      // a session failure; here a single attempt is driven directly to
      // verify its finally safety-net segment close).
      const result = await attempt(client, task, "prompt", { dir }, chain, undefined, undefined, parseSwitches({}))
      expect(result.type).toBe("blocked")
      const round = await statsTotals(dir, "round")
      expect(round?.sessions).toBe(1)
      expect(round?.usage).toEqual({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 })
      await flushStats(dir)
      const doc = JSON.parse(await Bun.file(join(dir, ".auto/stats.json")).text())
      expect(doc.open).toBeUndefined() // no dangling segment after the graceful close-out
    } finally {
      await flushStats(dir)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a bypass session (pseudo task PLAN, no phase) is likewise recorded: into the phase+round buckets and per-session", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-stats-"))
    try {
      const { client } = fakeClient({
        events: (sid) =>
          (async function* () {
            yield stepFinish(sid, "pt_sf1", { input: 700, output: 90 })
            yield { type: "session.idle", properties: { sessionID: sid } }
          })(),
      })
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const plan = { id: "PLAN", title: "phase planning (m implementation)", status: "in_progress" as const, attempts: 0, body: "" }
      const result = await runSession(client, plan, "planning prompt", { dir }, chain)
      expect(result.type).toBe("idle")
      const phase = await statsTotals(dir, "phase")
      expect(phase?.usage.input).toBe(700)
      expect(phase?.sessions).toBe(1)
      await flushStats(dir)
      const doc = JSON.parse(await Bun.file(join(dir, ".auto/stats.json")).text())
      expect(doc.sessions.ses_new_1.task).toBe("PLAN")
    } finally {
      await flushStats(dir)
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ---- ◉ two-line session end + unconditional printing (STATS_PLAN §4.1, T-004) ----
describe("◉ session-end two-line report (T-004): unconditional printing and omission rules", () => {
  // Capture log()'s terminal output (console.log); vlog does not reach the
  // terminal by default and does not affect the filtering.
  async function captureLogs(fn: () => Promise<unknown>): Promise<string[]> {
    const lines: string[] = []
    const orig = console.log
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    }
    try {
      await fn()
    } finally {
      console.log = orig
    }
    return lines
  }
  // Take a run's ◉ two lines (line 1 starts with ◉, line 2 starts with
  // "tokens in").
  const endLines = (lines: string[]) => {
    const i = lines.findIndex((l) => l.startsWith("◉ session ended"))
    return i >= 0 ? [lines[i]!, lines[i + 1]!] : []
  }
  const stepFinish = (
    sid: string,
    id: string,
    tokens: { input: number; output: number; reasoning?: number; cache?: { read: number; write: number } },
    cost = 0,
  ) => ({
    type: "message.part.updated",
    properties: {
      part: {
        id,
        sessionID: sid,
        messageID: "msg_1",
        type: "step-finish",
        reason: "stop",
        cost,
        tokens: { reasoning: 0, cache: { read: 0, write: 0 }, ...tokens },
        time: { created: 1 },
      },
    },
  })

  test("two-line output: line 1 context + elapsed, line 2 token sub-fields / hit rate / cost; single-round omits (cumulative …), reasoning=0 omits the thinking item", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-endline-"))
    try {
      const { client } = fakeClient({
        events: (sid) =>
          (async function* () {
            yield stepFinish(sid, "pt_sf1", { input: 1200, output: 340, cache: { read: 28400, write: 3100 } }, 0.041)
            yield { type: "session.idle", properties: { sessionID: sid } }
          })(),
      })
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const lines = await captureLogs(() => runSession(client, task, "prompt", { dir }, chain))
      const [line1, line2] = endLines(lines)
      expect(line1).toMatch(/^◉ session ended: context 100% \(0 tokens\), elapsed \S+$/)
      expect(line1).not.toContain("(cumulative")
      // Hit rate 28400/(28400+1200) = 95.9%; reasoning=0 means no thinking
      // item (formatTokens abbreviates only ≥10000; 3100 stays as is).
      expect(line2).toBe("tokens in 1200 / out 340 / cache-read 28.4k / cache-write 3100, hit 95.9%, cost $0.041")
    } finally {
      await flushStats(dir)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("reasoning>0: the thinking item sits between out and cache-read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-endline-"))
    try {
      const { client } = fakeClient({
        events: (sid) =>
          (async function* () {
            yield stepFinish(sid, "pt_sf1", { input: 100, output: 20, reasoning: 120 })
            yield { type: "session.idle", properties: { sessionID: sid } }
          })(),
      })
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const lines = await captureLogs(() => runSession(client, task, "prompt", { dir }, chain))
      const [, line2] = endLines(lines)
      expect(line2).toBe("tokens in 100 / out 20 / reasoning 120 / cache-read 0 / cache-write 0, hit 0.0%")
      expect(line2).not.toContain("cost") // cost=0 omits the cost item
    } finally {
      await flushStats(dir)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("zero usage: hit-rate denominator 0 shows —; the blocked exit likewise prints both lines unconditionally", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-endline-"))
    try {
      const { sdk } = fakeClient({
        events: (sid) =>
          (async function* () {
            // A permission question with --wait-answer unset → immediate
            // block (no step-finish at all).
            yield { type: "question.asked", properties: { id: "q1", sessionID: sid, questions: [{ question: "Permission request: write a file" }] } }
          })(),
      })
      const stubbed = opencodeAgent({
        ...sdk,
        question: { reply: async () => ({}), reject: async () => ({}) },
        permission: { reply: async () => ({}) },
      } as unknown as OpencodeClient)
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      let outcome: unknown
      const lines = await captureLogs(async () => {
        outcome = await runSession(stubbed, task, "prompt", { dir }, chain)
      })
      expect((outcome as { type: string }).type).toBe("blocked")
      const [line1, line2] = endLines(lines)
      expect(line1).toMatch(/^◉ session ended: context /)
      expect(line2).toBe("tokens in 0 / out 0 / cache-read 0 / cache-write 0, hit —")
    } finally {
      await flushStats(dir)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a session's second round (a resumed takeover): line 1 carries (cumulative … / 2 rounds), cost carries (cumulative $X); single-round omission rules as the contrast", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-endline-"))
    try {
      // Each round's step-finish usage is driven by the outer variable
      // (round 1 cost 0.01, round 2 0.02).
      let roundUsage = { input: 100, output: 10, cost: 0.01 }
      const { client } = fakeClient({
        events: (sid) =>
          (async function* () {
            yield stepFinish(sid, `pt_sf_${roundUsage.cost}`, { input: roundUsage.input, output: roundUsage.output }, roundUsage.cost)
            yield { type: "session.idle", properties: { sessionID: sid } }
          })(),
      })
      const NONE = parseSwitches({})
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const first = await captureLogs(() => runSession(client, task, "prompt", { dir, contextLimit: 100_000 }, chain, undefined, undefined, NONE))
      // Round 1 (single round): both cumulative markers are omitted.
      const [first1, first2] = endLines(first)
      expect(first1).not.toContain("(cumulative")
      expect(first2).toContain("cost $0.01")
      expect(first2).not.toContain("(cumulative")
      // Round 2 continues the same session through a resumed takeover (the
      // chain holds the session and a recovery note), so the stats segment
      // accrues a second round on the same session id.
      chain.note = "[driver] continuation after interruption"
      roundUsage = { input: 200, output: 20, cost: 0.02 }
      const second = await captureLogs(() => runSession(client, task, "prompt", { dir, contextLimit: 100_000 }, chain, undefined, undefined, NONE))
      const [line1, line2] = endLines(second)
      expect(line1).toMatch(/, elapsed \S+ \(cumulative \S+ \/ 2 rounds\)$/)
      expect(line2).toContain("tokens in 200 / out 20")
      expect(line2).toContain("cost $0.02 (cumulative $0.03)")
    } finally {
      await flushStats(dir)
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ---- driver-side proxy-answer collection wiring (plans/0020-auto-resolve-design.md §G, T-005): H1..H4 ----
// H1 observation (question.asked falls back to auto-answer) → H2 out of
// every exit with the snapshot → H3 booking when the segment closes (fills
// in task/phase/round/session) → H4 session close-out scan of agent
// markers. The ledger is read back via resolvesOf; the module's own unit
// tests live in test/resolve.test.ts.
describe("proxy-answer collection wiring (AUTO-RESOLVE, T-005)", () => {
  async function captureLogs(fn: () => Promise<unknown>): Promise<string[]> {
    const lines: string[] = []
    const orig = console.log
    console.log = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "))
    }
    try {
      await fn()
    } finally {
      console.log = orig
    }
    return lines
  }

  // One question.asked event (a non-permission question: the text does not
  // contain "permission").
  const question = (sid: string, id: string, text: string) => ({
    type: "question.asked",
    properties: { id, sessionID: sid, questions: [{ question: text }] },
  })

  const idle = (sid: string) => ({ type: "session.idle", properties: { sessionID: sid } })

  // Fake resident input line: a human really answered within --wait-answer.
  const fakeInteractive = (answer: string) =>
    ({ attach: () => {}, question: async () => answer, close: () => {} }) as unknown as Interactive

  const Q1 = "Should the third copy of formatTokens in prompt.ts be cleaned up as well?"
  const Q2 = "Should depreciation booking also go through the MAX_TICK clamp?"

  let dir = ""

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-resolve-runner-"))
  })

  afterEach(async () => {
    await flushStats(dir)
    await rm(dir, { recursive: true, force: true })
  })

  test("fallback auto-answer: booked into the driver ledger (bucket identity + session id) with the ⚑ two lines; the full answer text is demoted to detail logging", async () => {
    // The round number takes the target directory's derived value
    // (docs/R-03 → round 3); the phase letter comes in via opts.phase.
    await mkdir(join(dir, "docs", "R-03"), { recursive: true })
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield question(sid, "req_1", Q1)
          yield idle(sid)
        })(),
    })
    const lines = await captureLogs(() => runSession(client, task, "prompt", { dir, phase: key("m") }, { pct: 100, used: 0, at: 0 }))
    const items = await resolvesOf(dir, "task", "T-001")
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      source: "driver",
      task: "T-001",
      phase: "R-01.P01",
      round: 3,
      session: "ses_new_1",
      question: Q1,
    })
    expect(lines.some((l) => l.startsWith(`⚑ auto-answer (AUTO-RESOLVE) #1: ${Q1}`))).toBe(true)
    expect(lines.some((l) => l.includes("asking the session to label the decision with AUTO-RESOLVE"))).toBe(true)
    // The old `→ auto answer: <long text>` no longer reaches the terminal
    // (demoted to vlog), but the reply itself is still sent.
    expect(lines.some((l) => l.startsWith("→ auto answer"))).toBe(false)
    expect(calls.replies).toHaveLength(1)
    expect(calls.replies[0]).toContain("AUTO-RESOLVE")
  })

  test("two different questions in one turn: the count increments, two ledger entries (bucketed by the round/phase defaults)", async () => {
    const { client } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield question(sid, "req_1", Q1)
          yield question(sid, "req_2", Q2)
          yield idle(sid)
        })(),
    })
    const lines = await captureLogs(() => runSession(client, task, "prompt", { dir }, { pct: 100, used: 0, at: 0 }))
    const items = await resolvesOf(dir, "task", "T-001")
    expect(items.map((item) => item.question)).toEqual([Q1, Q2])
    expect(items.every((item) => item.phase === "" && item.round === 1)).toBe(true)
    expect(lines.some((l) => l.startsWith("⚑ auto-answer (AUTO-RESOLVE) #2"))).toBe(true)
  })

  test("a repeated question blocks (blocked exit): the first auto-answered entry is not lost; the second is not booked again", async () => {
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield question(sid, "req_1", Q1)
          yield question(sid, "req_2", Q1)
          yield idle(sid)
        })(),
    })
    const result = await captureLogs(async () => {
      const outcome = await runSession(client, task, "prompt", { dir }, { pct: 100, used: 0, at: 0 })
      expect(outcome.type).toBe("blocked")
    })
    expect(result.length).toBeGreaterThan(0)
    expect(calls.rejects).toEqual(["req_2"])
    expect(await resolvesOf(dir, "task", "T-001")).toHaveLength(1)
  })

  test("a human really answered within --wait-answer: not counted as a proxy answer (a real person made that decision)", async () => {
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield question(sid, "req_1", Q1)
          yield idle(sid)
        })(),
    })
    const lines = await captureLogs(() =>
      runSession(
        client,
        task,
        "prompt",
        { dir, waitAnswer: 5, interactive: fakeInteractive("go with plan A") },
        { pct: 100, used: 0, at: 0 },
      ),
    )
    expect(await resolvesOf(dir, "task", "T-001")).toEqual([])
    expect(lines.some((l) => l.startsWith("→ human answer: go with plan A"))).toBe(true)
    expect(lines.some((l) => l.startsWith("⚑ auto-answer"))).toBe(false)
    expect(calls.replies[0]).toBe("go with plan A")
  })

  test("dryrun preflight session: the auto-answer happens as usual but is not counted as a proxy answer (the preflight only probes permissions)", async () => {
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield question(sid, "req_1", Q1)
          yield idle(sid)
        })(),
    })
    const lines = await captureLogs(() => runSession(client, task, "prompt", { dir, dryrun: true }, { pct: 100, used: 0, at: 0 }))
    expect(await resolvesOf(dir, "task", "T-001")).toEqual([])
    expect(lines.some((l) => l.startsWith("→ auto answer:"))).toBe(true)
    expect(calls.replies).toHaveLength(1)
  })

  test("autoAnswer texts: both say answered on the user's behalf; off requires AUTO-RESOLVE, on asks for no marking", () => {
    const off = autoAnswer(false)
    const on = autoAnswer(true)
    expect(off).toContain("This question was answered on the user's behalf")
    expect(on).toContain("This question was answered on the user's behalf")
    expect(off).toContain("AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)")
    expect(off).toContain("AUTO-DECISION")
    expect(on).not.toContain("AUTO-DECISION")
    expect(on).not.toContain("AUTO-RESOLVE")
  })

  test("H4 session close-out scan: still collected under --commit false (collection is an audit, unaffected by the commit switch)", async () => {
    const proc = Bun.spawn(["git", "-C", dir, "init", "-q"], { stdout: "pipe", stderr: "pipe" })
    expect(await proc.exited).toBe(0)
    await mkdir(join(dir, "docs", "R-02"), { recursive: true })
    await Bun.write(
      join(dir, "report.md"),
      ["## Proxy-answered questions", "", "- AUTO-RESOLVE: clean this up too -> clean this up too (same-layer dependency)", "- AUTO-DECISION: field naming takes matched (consistent with the schema)", ""].join("\n"),
    )
    await afterSession(dir, { commit: false, phase: key("t") }, { id: "T-001", title: "sample task" }, { stage: "wrapup", subject: "T-001 wrapup sample task" })
    const items = await resolvesOf(dir, "task", "T-001")
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ source: "agent", phase: "R-01.P01", round: 2, question: "clean this up too", file: "report.md:3" })
  })
})

// ---- Truncated-output resume (2026-09-18, kernel-spi-nor T-030 S13 field
// case): a final step-finish ending with reason length = the reply was cut
// off by the output limit, not a natural finish — a "continue from the
// cut-off point" steer lets the original session carry on; consecutive
// truncations are capped at LENGTH_CONTINUE_MAX (3), a non-length ending
// resets the count; once a session.error is observed there is no resume
// (the error path wins). ----

describe("truncated-output resume (a step ending with length is not a natural finish)", () => {
  const stepFinish = (sid: string, id: string, reason: string) => ({
    type: "message.part.updated",
    properties: {
      part: {
        id,
        sessionID: sid,
        messageID: "msg_1",
        type: "step-finish",
        reason,
        cost: 0,
        tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1 },
      },
    },
  })
  const idle = (sid: string) => ({ type: "session.idle", properties: { sessionID: sid } })

  test("length truncation: one resume steer (the original session carries on); the next turn ends normally with stop", async () => {
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield stepFinish(sid, "pt_1", "length")
          yield idle(sid)
          // Resume turn: normal work ending with stop.
          yield stepFinish(sid, "pt_2", "stop")
          yield idle(sid)
        })(),
    })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt", {}, chain)
    expect(result.type).toBe("idle")
    // The resume goes into the original session via steer (promptAsync): no
    // new session, no re-sent prompt.
    expect(calls.steers.length).toBe(1)
    expect(calls.steers[0]).toContain("cut off by the output length limit")
    expect(calls.steers[0]).toContain("continue the unfinished work")
    expect(calls.creates).toBe(1)
    expect(calls.prompts.length).toBe(1)
  })

  test("more than 3 consecutive truncations: no further resume; settles as a natural finish (left to the shape-check loop)", async () => {
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          for (let i = 0; i < 4; i++) {
            yield stepFinish(sid, `pt_${i}`, "length")
            yield idle(sid)
          }
        })(),
    })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt", {}, chain)
    expect(result.type).toBe("idle")
    expect(calls.steers.length).toBe(3)
  })

  test("a non-length step ending (work back to normal after a resume) resets the consecutive-truncation count", async () => {
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield stepFinish(sid, "pt_1", "length")
          yield idle(sid)
          // After the resume, work is back to normal (tool step) ...
          yield stepFinish(sid, "pt_2", "tool-calls")
          // ... then another truncation: the count was reset, so it resumes
          // again.
          yield stepFinish(sid, "pt_3", "length")
          yield idle(sid)
          yield stepFinish(sid, "pt_4", "stop")
          yield idle(sid)
        })(),
    })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt", {}, chain)
    expect(result.type).toBe("idle")
    expect(calls.steers.length).toBe(2)
  })

  test("session.error already observed: no truncation resume; the error path (retry ladder) wins", async () => {
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield stepFinish(sid, "pt_1", "length")
          yield {
            type: "session.error",
            properties: { sessionID: sid, error: { name: "APIError", data: { message: "Internal Server Error", isRetryable: true, statusCode: 500 } } },
          }
          yield idle(sid)
        })(),
    })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    // Drive attempt directly for the single result (runSession would take
    // the failure into its retry loop).
    const result = await attempt(client, task, "prompt", {}, chain, undefined, undefined, parseSwitches({}))
    expect(result.type).toBe("blocked")
    expect((result as { question: string }).question).toContain("session error: ")
    expect(calls.steers).toEqual([])
  })
})

// testHandoverAsked is per-watch-instance state; when a mid-wrap-up session
// error is forked and resumed by runSession's retry loop, the new attempt
// builds a new watch instance — without the resumeWrapup seeding, the new
// instance mistakes the completed wrap-up for a natural finish and the
// handover loop is lost (the freeze script never runs, the handover document
// is never archived).

describe("test handover: the freeze steer's successful delivery seeds resumeWrapup", () => {
  let dir = ""

  beforeEach(async () => {
    dir = await freshRepo()
  })

  afterEach(async () => {
    await flushStats(dir)
    await rm(dir, { recursive: true, force: true })
  })

  const msg = (sid: string, id: string) => ({
    type: "message.updated",
    properties: {
      info: {
        id,
        sessionID: sid,
        role: "assistant",
        time: { completed: Date.now() },
        tokens: { input: 1000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        providerID: "zai",
        modelID: "glm",
      },
    },
  })

  test("after the freeze the flag is set; a new watch instance verifies the handover document at idle on the strength of the flag instead of calling it a natural finish", async () => {
    const tmp = join(dir, "tmp")
    await mkdir(join(dir, "test"), { recursive: true })
    await mkdir(tmp, { recursive: true })
    await writeFile(join(dir, "test", "build.sh"), "#!/bin/sh\nexit 0\n")
    const handoffPath = join(dir, "docs", "T-001", "testhandoff.md")
    const testRun: TestRun = {
      dir,
      tmp,
      handoffFile: handoffPath,
      handover: true,
      limit: 1,
      seq: 0,
      task,
      unit: "execute",
      subject: "T-001 exec sample task",
      label: "T-001",
      handovers: 0,
      startUsed: 0,
    }
    const { client } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield msg(sid, `${sid}_m1`)
          // The session starts a test within the turn (attempt clears
          // leftover markers at the start, so it must be written here).
          await writeFile(join(tmp, "test.sh"), "test/build.sh")
          yield { type: "session.idle", properties: { sessionID: sid } }
          // The freeze + wrap-up steer has happened; the session writes the
          // handover document at close and goes idle again.
          await mkdir(dirname(handoffPath), { recursive: true })
          await writeFile(handoffPath, "# Handover\n\nStatus: continue\n")
          yield msg(sid, `${sid}_m2`)
          yield { type: "session.idle", properties: { sessionID: sid } }
        })(),
    })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await attempt(client, task, "prompt", { dir }, chain, undefined, testRun, parseSwitches({}))
    expect(result.type).toBe("idle")
    expect((result as { testHandover?: boolean }).testHandover).toBe(true)
    // The freeze steer's successful delivery is the seeding (this fix's
    // assertion): the new instance forked by the retry loop carries on from
    // it.
    expect(testRun.resumeWrapup).toBe(true)
    // The in-flight record is already flushed after the freeze; the pending
    // script has the path form the freeze consumed.
    const record = JSON.parse(await Bun.file(join(dir, ".auto", "handover.json")).text())
    expect(record.n).toBe(1)
    expect(record.script).toBe(join(dir, "test", "build.sh"))
    // Retry scenario: the same TestRun on a fresh session (the marker
    // already consumed, the document ready) — the new watch instance must
    // verify the handover document at idle and rule testHandover, not drop
    // the handover as a natural finish.
    const { client: client2 } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield msg(sid, `${sid}_m1`)
          yield { type: "session.idle", properties: { sessionID: sid } }
        })(),
    })
    const chain2: SessionChain = { pct: 100, used: 0, at: 0 }
    const result2 = await attempt(client2, task, "prompt", { dir }, chain2, undefined, testRun, parseSwitches({}))
    expect(result2.type).toBe("idle")
    expect((result2 as { testHandover?: boolean }).testHandover).toBe(true)
  })
})
