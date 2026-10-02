// The ladder decision (plans/0061 §4.7): what the session-driving loop does
// with a dispatch's outcome — one row per Step kind, per class label, per
// spent window and per ladder position, over hand-built results, counters
// and facts. The decision is pure: the result and the ladder are inputs, and
// runSession (the executor) owns every effect the steps name.
import { describe, expect, test } from "bun:test"
import type { SessionResult, WindowWait } from "../src/chain"
import { nextStep, type LadderFacts, type LadderState } from "../src/engine/ladder"

// A blocked dispatch outcome, in the shape attempt (or the SDK catch) builds.
const blocked = (question: string, over: Partial<Extract<SessionResult, { type: "blocked" }>> = {}): SessionResult => ({ type: "blocked", question, ...over })

// The ladder's counters; i is the next retry's ordinal (a three-step ladder
// by default: retries 1, 2, 3).
const ladder = (i = 1): LadderState => ({ i, tried: [], clipped: [] })

// The run's facts: no managed server, no account unless a row says otherwise.
// (Every run has a registry since the implicit registry, 0061 F2 — the
// candidate table needs no fact.)
const facts = (over: Partial<LadderFacts> = {}): LadderFacts => ({ waits: [0, 1, 2], server: false, ...over })

describe("the ladder decision", () => {
  test("a live outcome returns as-is (the executor books the answered account on the way out)", () => {
    const result: SessionResult = { type: "idle", lastText: "done" }
    expect(nextStep(result, ladder(), facts())).toEqual({ kind: "return", result })
  })

  test("an in-session blocked question returns as-is — a human reply is not a fault", () => {
    const result = blocked("blocked: the session asked which file to touch")
    expect(nextStep(result, ladder(), facts())).toEqual({ kind: "return", result })
  })

  test("a no-model wait sleeps on the window and dispatches again", () => {
    const wait: WindowWait = { until: 1_750_000_000_000, model: "e2", tier: "simple", opens: "opens 12:30 UTC" }
    const result = blocked("no usable model candidate now: every candidate of the simple list is outside its windows; waiting for the earliest opening", { noModel: true, windowWait: wait })
    expect(nextStep(result, ladder(), facts())).toEqual({ kind: "window-wait", wait })
  })

  test("a no-model exhaustion enters the wait-and-probe loop with no cause (no session ran)", () => {
    const result = blocked("no usable model candidate: every candidate of the simple list is down\nsecond line", { noModel: true })
    expect(nextStep(result, ladder(), facts())).toEqual({ kind: "recover", why: "no usable model candidate: every candidate of the simple list is down" })
  })

  test("quota escalates: the key ring first, then the model, then recovery", () => {
    const result = blocked("session error: insufficient_quota", { errorClass: "quota" })
    expect(nextStep(result, ladder(), facts({ account: "prov" }))).toEqual({
      kind: "escalate",
      label: "quota restricted",
      until: undefined,
      classified: undefined,
      cause: { ...result, account: "prov" },
    })
  })

  test("auth escalates the same way (the tier lists are the candidate table)", () => {
    const result = blocked("session creation failed: 401 unauthorized", { errorClass: "auth" })
    expect(nextStep(result, ladder(), facts())).toEqual({
      kind: "escalate",
      label: "provider auth failed",
      until: undefined,
      classified: undefined,
      cause: { ...result, account: undefined },
    })
  })

  test("rate escalates likewise", () => {
    const result = blocked("session error: rate limit exceeded", { errorClass: "rate" })
    expect(nextStep(result, ladder(), facts({ account: "zai-coding-plan" }))).toEqual({
      kind: "escalate",
      label: "rate-limit wait too long",
      until: undefined,
      classified: undefined,
      cause: { ...result, account: "zai-coding-plan" },
    })
  })

  test("a classifier-raised class marks the label and carries the reset into the down marks", () => {
    const result = blocked("session error: usage limit reached", { errorClass: "quota", classified: true, resetAt: 1_750_000_000_000 })
    expect(nextStep(result, ladder(), facts())).toEqual({
      kind: "escalate",
      label: "quota restricted (classifier)",
      until: 1_750_000_000_000,
      classified: true,
      cause: { ...result, account: undefined },
    })
  })

  test("a spent five-hour window with a stated reset escalates without a class (the ladder would only hit it again)", () => {
    const result = blocked("session error: usage window spent", { resetAt: 1_750_000_000_000, scope: "5h" })
    expect(nextStep(result, ladder(), facts())).toEqual({
      kind: "escalate",
      label: "five-hour usage window spent",
      until: 1_750_000_000_000,
      classified: undefined,
      cause: { ...result, account: undefined },
    })
  })

  test("a spent weekly window escalates as the weekly label", () => {
    const result = blocked("session error: usage window spent", { resetAt: 1_750_000_000_000, scope: "7d" })
    const step = nextStep(result, ladder(), facts())
    if (step.kind !== "escalate") throw new Error(`expected escalate, got ${step.kind}`)
    expect(step.label).toBe("weekly usage window spent")
  })

  test("a spent daily window escalates as the daily label", () => {
    const result = blocked("session error: usage window spent", { resetAt: 1_750_000_000_000, scope: "day" })
    const step = nextStep(result, ladder(), facts())
    if (step.kind !== "escalate") throw new Error(`expected escalate, got ${step.kind}`)
    expect(step.label).toBe("daily usage window spent")
  })

  test("a stated per-minute reset is not a spent window — the ladder retries it (the agent's own backoff cures it)", () => {
    const result = blocked("session error: per-minute cap", { resetAt: 1_750_000_000_000, scope: "request" })
    expect(nextStep(result, ladder(), facts())).toEqual({ kind: "retry", nth: 1, waitMinutes: 0, restartServer: false })
  })

  test("a reset of unknown scope is not a spent window either", () => {
    const result = blocked("session error: limit resets later", { resetAt: 1_750_000_000_000 })
    expect(nextStep(result, ladder(), facts())).toEqual({ kind: "retry", nth: 1, waitMinutes: 0, restartServer: false })
  })

  test("a non-retryable error outside the escalation classes: straight into the wait-and-probe loop", () => {
    const result = blocked("session error: hard gateway failure", { errorClass: "unknown", retryable: false })
    expect(nextStep(result, ladder(), facts({ account: "prov" }))).toEqual({
      kind: "recover",
      why: "non-retryable session error encountered (session error: hard gateway failure)",
      cause: { ...result, account: "prov" },
    })
  })

  test("a retryable transient error takes the ladder's next round: the first retry is immediate (waits[0] = 0)", () => {
    const result = blocked("session error: stream disconnected")
    expect(nextStep(result, ladder(1), facts())).toEqual({ kind: "retry", nth: 1, waitMinutes: 0, restartServer: false })
  })

  test("the ladder's later rounds carry their wait minutes and ordinals", () => {
    const result = blocked("task dispatch failed: request timed out")
    expect(nextStep(result, ladder(3), facts())).toEqual({ kind: "retry", nth: 3, waitMinutes: 2, restartServer: false })
  })

  test("ladder exhausted: the model failover runs first, recovery takes what it cannot move", () => {
    const result = blocked("session error: stream disconnected")
    expect(nextStep(result, ladder(4), facts())).toEqual({
      kind: "after-ladder",
      why: "retry ladder exhausted (3 retries) without success",
      cause: { ...result, account: undefined },
    })
  })

  test("an empty ladder (RETRY_WAITS=off) exhausts on the first failure", () => {
    const result = blocked("session error: stream disconnected")
    expect(nextStep(result, ladder(1), facts({ waits: [] }))).toEqual({
      kind: "after-ladder",
      why: "retry ladder exhausted (0 retries) without success",
      cause: { ...result, account: undefined },
    })
  })

  test("a network/service failure with a managed server restarts it before the retry", () => {
    const result = blocked("session error: fetch failed: connection refused")
    expect(nextStep(result, ladder(), facts({ server: true }))).toMatchObject({ kind: "retry", restartServer: true })
  })

  test("a network/service failure without a managed server (an external one) cannot restart anything", () => {
    const result = blocked("session error: fetch failed: connection refused")
    expect(nextStep(result, ladder(), facts({ server: false }))).toEqual({ kind: "retry", nth: 1, waitMinutes: 0, restartServer: false })
  })

  test("a non-network transient error does not restart the server even when one exists", () => {
    const result = blocked("session error: malformed reasoning content")
    expect(nextStep(result, ladder(), facts({ server: true }))).toEqual({ kind: "retry", nth: 1, waitMinutes: 0, restartServer: false })
  })

  test("the decision writes nothing: the result and the ladder are inputs", () => {
    const result = blocked("session error: insufficient_quota", { errorClass: "quota" })
    const state = ladder(2)
    const before = structuredClone(state)
    const beforeResult = structuredClone(result)
    nextStep(result, state, facts())
    expect(state).toEqual(before)
    expect(result).toEqual(beforeResult)
  })
})
