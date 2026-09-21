// MA.2 (plans/0038): the usage-source tiers and the behavior matrix of the
// usage-driven mechanisms. The `events` rows are checked against today's
// inline rules (testrun.ts predicates, attempt.ts reuse, seedForkSession's
// guard) so MA.3 can swap them in without a behavior change.
import { describe, expect, test } from "bun:test"
import type { AgentEvent } from "../src/agent/types"
import { REUSE_BELOW, REUSE_IDLE_MS } from "../src/chain"
import { handoverDue as todayHandoverDue, testHandoverDue as todayTestHandoverDue } from "../src/testrun"
import {
  estimateTokens,
  forkBaseAllowed,
  liveUsage,
  reuseAllowed,
  sessionHandoverDue,
  steerDue,
  testHandoverDue,
  usageSource,
} from "../src/usage"

const message = (id: string, contextUsed: number | undefined, completed = true): AgentEvent => ({
  type: "message",
  session: "s",
  message: { id, role: "assistant", completed, failed: false, ...(contextUsed !== undefined ? { contextUsed } : {}) },
})
const text = (id: string, body: string): AgentEvent => ({ type: "part", session: "s", part: { kind: "text", id, text: body, final: false } })

describe("usage source", () => {
  test("events/reported: latest completed assistant figure; nothing before it", () => {
    for (const tier of ["events", "reported"] as const) {
      const src = usageSource(tier, 999)
      expect(src.used()).toBeUndefined()
      src.observe(message("m1", 1200))
      src.observe(message("m2", 5000, false))
      expect(src.used()).toBe(1200)
      src.observe(message("m2", 5000))
      src.observe(text("p", "x".repeat(300)))
      expect(src.used()).toBe(5000)
    }
  })

  test("estimated: start + prompts + latest size of each part", () => {
    const src = usageSource("estimated", 100)
    src.prompt("abcdef")
    expect(src.used()).toBe(102)
    src.observe(text("p1", "abc"))
    src.observe(text("p1", "abcdefghi")) // re-sent, grown: only the last size counts
    src.observe({ type: "part", session: "s", part: { kind: "tool", id: "t1", tool: "bash", status: "completed", input: { c: "ls" }, output: "a.ts" } })
    src.observe(message("m1", 50_000)) // an estimated adapter's figures are not trusted over the estimate
    expect(src.used()).toBe(102 + 3 + estimateTokens('{"c":"ls"}') + estimateTokens("a.ts"))
  })

  test("none: never known", () => {
    const src = usageSource("none")
    src.prompt("hello")
    src.observe(message("m1", 1000))
    expect(src.used()).toBeUndefined()
  })

  test("estimate is conservative for CJK text", () => {
    expect(estimateTokens("")).toBe(0)
    expect(estimateTokens("abcd")).toBe(2)
    expect(estimateTokens("上下文")).toBe(3)
  })

  test("liveness per tier", () => {
    expect([liveUsage("events"), liveUsage("reported"), liveUsage("estimated"), liveUsage("none")]).toEqual([true, false, true, false])
  })
})

describe("behavior matrix: events row equals today", () => {
  const cap = 64_000
  const grid = [0, 1, cap / 2 - 1, cap / 2, cap - 1, cap, 2 * cap - 1, 2 * cap, 5 * cap]

  test("reuse threshold", () => {
    const now = 10 * REUSE_IDLE_MS
    for (const used of grid)
      for (const pct of [0, REUSE_BELOW - 1, REUSE_BELOW, 100])
        for (const at of [now, now - REUSE_IDLE_MS, now - REUSE_IDLE_MS - 1]) {
          // attempt.ts inline rule (reuse switch on, chain has a session, not resumed).
          const today = pct < REUSE_BELOW && used < cap / 2 && now - at <= REUSE_IDLE_MS
          expect(reuseAllowed({ pct, used, at }, cap, now)).toBe(today)
        }
  })

  test("steer and post-session handover check", () => {
    const steer = { limit: 2 * cap, text: "hint" }
    for (const used of grid) {
      // watch.ts: used >= steer.limit
      expect(steerDue("events", used, steer.limit)).toBe(used >= steer.limit)
      expect(sessionHandoverDue("events", steer, used)).toBe(todayHandoverDue(steer, used))
      expect(sessionHandoverDue("events", undefined, used)).toBe(todayHandoverDue(undefined, used))
    }
  })

  test("test handover incl. the startUsed fallback", () => {
    for (const handover of [true, false])
      for (const startUsed of grid)
        for (const used of grid) {
          const t = { handover, limit: cap, startUsed }
          expect(testHandoverDue(t, used)).toBe(todayTestHandoverDue(t, used))
        }
  })

  test("fork base guard", () => {
    // seedForkSession: base.used >= cap / 2 → cold start.
    for (const used of grid) expect(forkBaseAllowed(used, cap)).toBe(!(used >= cap / 2))
  })
})

describe("behavior matrix: other tiers", () => {
  const cap = 64_000
  const steer = { limit: 2 * cap, text: "hint" }

  test("reported: no in-turn steer and no handover demand, turn-end figure still drives the rest", () => {
    expect(steerDue("reported", 10 * cap, steer.limit)).toBe(false)
    expect(sessionHandoverDue("reported", steer, 10 * cap)).toBe(false)
    expect(testHandoverDue({ handover: true, limit: cap, startUsed: 0 }, cap)).toBe(true)
    expect(reuseAllowed({ pct: 10, used: 1000, at: 0 }, cap, 0)).toBe(true)
  })

  test("estimated: in-turn triggers fire on the estimate", () => {
    expect(steerDue("estimated", steer.limit, steer.limit)).toBe(true)
    expect(sessionHandoverDue("estimated", steer, steer.limit)).toBe(true)
  })

  test("none: unknown never carries context forward and never ends a session", () => {
    expect(reuseAllowed({ pct: 0, used: undefined, at: 0 }, cap, 0)).toBe(false)
    expect(steerDue("none", undefined, steer.limit)).toBe(false)
    expect(sessionHandoverDue("none", steer, undefined)).toBe(false)
    expect(testHandoverDue({ handover: true, limit: cap, startUsed: undefined }, undefined)).toBe(false)
    expect(forkBaseAllowed(undefined, cap)).toBe(false)
  })
})
