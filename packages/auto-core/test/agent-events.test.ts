// MA.1 (plans/0037): the opencode → AgentEvent mapping table, row by row, and
// a minimal fake AgentClient proving the frozen interface is implementable
// without any SDK type (the claude adapter and test fakes stand on the same
// footing).
import { describe, expect, test } from "bun:test"
import type { Event } from "@opencode-ai/sdk/v2"
import { limitFields, mapEvent, mapMessage } from "../src/agent/opencode/events"
import type { AgentClient, AgentEvent } from "../src/agent/types"

// Fixtures are cast from plain objects: only the fields the mapping reads matter.
const ev = (value: unknown) => value as Event
const partEvent = (part: Record<string, unknown>) =>
  ev({ id: "e", type: "message.part.updated", properties: { sessionID: "s1", time: 0, part: { id: "p1", sessionID: "s1", messageID: "m1", ...part } } })

describe("opencode event mapping", () => {
  test("text part: final once time.end is set", () => {
    expect(mapEvent(partEvent({ type: "text", text: "hi", time: { start: 1 } }))).toEqual({
      type: "part",
      session: "s1",
      part: { kind: "text", id: "p1", text: "hi", final: false },
    })
    expect(mapEvent(partEvent({ type: "text", text: "done", time: { start: 1, end: 2 } }))).toMatchObject({ part: { final: true } })
  })

  test("tool part: terminal states carry results", () => {
    const completed = mapEvent(partEvent({ type: "tool", callID: "c", tool: "bash", state: { status: "completed", input: { cmd: "ls" }, output: "a", title: "ls", metadata: {}, time: { start: 1, end: 2 } } }))
    expect(completed).toMatchObject({ part: { kind: "tool", tool: "bash", status: "completed", input: { cmd: "ls" }, output: "a", title: "ls" } })
    const failed = mapEvent(partEvent({ type: "tool", callID: "c", tool: "bash", state: { status: "error", input: {}, error: "boom", time: { start: 1, end: 2 } } }))
    expect(failed).toMatchObject({ part: { status: "error", error: "boom" } })
    const running = mapEvent(partEvent({ type: "tool", callID: "c", tool: "bash", state: { status: "running", input: {}, time: { start: 1 } } }))
    expect(running).toEqual({ type: "part", session: "s1", part: { kind: "tool", id: "p1", tool: "bash", status: "running", input: {} } })
  })

  test("step-finish part: tokens flattened, reason and cost kept", () => {
    const got = mapEvent(partEvent({ type: "step-finish", reason: "length", cost: 0.5, tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 7, write: 3 } } }))
    expect(got).toEqual({
      type: "part",
      session: "s1",
      part: { kind: "step-finish", id: "p1", reason: "length", cost: 0.5, tokens: { input: 10, output: 5, reasoning: 2, cacheRead: 7, cacheWrite: 3 } },
    })
  })

  test("display-only parts become notes with today's log text", () => {
    expect(mapEvent(partEvent({ type: "patch", hash: "h", files: ["a.ts", "b.ts"] }))).toMatchObject({ part: { kind: "note", text: "patch (2 files): a.ts, b.ts" } })
    expect(mapEvent(partEvent({ type: "compaction", auto: true }))).toMatchObject({ part: { kind: "note", text: "context compaction (auto)" } })
  })

  test("retry part and session.status retry both become retry events", () => {
    const fromPart = mapEvent(
      partEvent({ type: "retry", attempt: 2, time: { created: 0 }, error: { name: "APIError", data: { message: "quota", statusCode: 402, isRetryable: false, responseBody: "{}" } } }),
    )
    expect(fromPart).toEqual({
      type: "retry",
      session: "s1",
      id: "p1",
      attempt: 2,
      error: { name: "APIError", message: "quota", statusCode: 402, isRetryable: false, responseBody: "{}" },
    })
    // opencode states the next attempt's instant; the event carries the wait.
    const now = Date.parse("2026-09-25T11:44:57Z")
    const fromStatus = mapEvent(ev({ id: "e", type: "session.status", properties: { sessionID: "s1", status: { type: "retry", attempt: 3, message: "rate limit", next: now + 90_000 } } }), now)
    expect(fromStatus).toEqual({ type: "retry", session: "s1", attempt: 3, next: 90_000, error: { message: "rate limit" } })
    // An instant already past (the event arrived late) is no wait at all.
    expect(mapEvent(ev({ id: "e", type: "session.status", properties: { sessionID: "s1", status: { type: "retry", attempt: 1, message: "x", next: now - 500 } } }), now)).toMatchObject({ next: 0 })
    // Older servers: missing fields stay absent.
    expect(mapEvent(ev({ id: "e", type: "session.status", properties: { sessionID: "s1", status: { type: "retry" } } }))).toEqual({ type: "retry", session: "s1", error: {} })
  })

  test("message.updated: model string, context occupancy, completion, failure", () => {
    const info = {
      id: "m2",
      sessionID: "s1",
      role: "assistant",
      time: { created: 1, completed: 2 },
      providerID: "deepseek",
      modelID: "deepseek-v4-pro",
      tokens: { input: 1000, output: 10, reasoning: 0, cache: { read: 500, write: 0 } },
    }
    expect(mapEvent(ev({ id: "e", type: "message.updated", properties: { sessionID: "s1", info } }))).toEqual({
      type: "message",
      session: "s1",
      message: { id: "m2", role: "assistant", completed: true, model: "deepseek/deepseek-v4-pro", contextUsed: 1500, failed: false },
    })
    expect(mapMessage({ ...info, time: { created: 1 }, error: { name: "UnknownError", data: { message: "x" } } } as never)).toMatchObject({ completed: false, failed: true })
    expect(mapMessage({ id: "m1", sessionID: "s1", role: "user", time: { created: 1 } } as never)).toEqual({ id: "m1", role: "user", completed: false, failed: false })
  })

  test("question and permission requests", () => {
    expect(mapEvent(ev({ id: "e", type: "question.asked", properties: { id: "q1", sessionID: "s1", questions: [{ question: "A?" }, { question: "B?" }] } }))).toEqual({
      type: "question",
      session: "s1",
      request: "q1",
      questions: ["A?", "B?"],
    })
    expect(mapEvent(ev({ id: "e", type: "permission.asked", properties: { id: "r1", sessionID: "s1", permission: "bash", patterns: ["rm *"], metadata: {}, always: [] } }))).toEqual({
      type: "permission",
      session: "s1",
      request: "r1",
      permission: "bash",
      patterns: ["rm *"],
    })
  })

  test("session.error: structured fields kept; sessionless or empty errors dropped", () => {
    const got = mapEvent(ev({ id: "e", type: "session.error", properties: { sessionID: "s1", error: { name: "ContextOverflowError", data: { message: "too long" } } } }))
    expect(got).toEqual({ type: "error", session: "s1", error: { name: "ContextOverflowError", message: "too long" } })
    expect(mapEvent(ev({ id: "e", type: "session.error", properties: { error: { name: "UnknownError", data: { message: "x" } } } }))).toBeUndefined()
    expect(mapEvent(ev({ id: "e", type: "session.error", properties: { sessionID: "s1" } }))).toBeUndefined()
  })

  // plans/0057 §5.1: the response headers of an API error give its limit
  // fields; the retry status's action.reason its limit reason (F5, F6).
  test("session.error: an API error's headers become its limit fields", () => {
    const now = Date.parse("2026-09-25T11:44:57Z")
    const reset = Date.parse("2026-09-25T12:30:00Z")
    const got = mapEvent(
      ev({
        id: "e",
        type: "session.error",
        properties: {
          sessionID: "s1",
          error: {
            name: "APIError",
            data: {
              message: "rate_limit_error",
              statusCode: 429,
              isRetryable: true,
              responseHeaders: {
                "Retry-After-Ms": "2700000",
                "anthropic-ratelimit-unified-status": "rejected",
                "anthropic-ratelimit-unified-5h-reset": String(reset / 1000),
                "anthropic-ratelimit-unified-7d-reset": String(Date.parse("2026-09-30T22:00:00Z") / 1000),
                "anthropic-ratelimit-unified-reset": String(reset / 1000),
              },
            },
          },
        },
      }),
      now,
    )
    expect(got).toEqual({
      type: "error",
      session: "s1",
      error: { name: "APIError", message: "rate_limit_error", statusCode: 429, isRetryable: true, retryAfterMs: 2_700_000, resetAt: reset, scope: "5h" },
    })
    // The retry status: action.reason is the limit reason; no headers ride it.
    const status = mapEvent(
      ev({
        id: "e",
        type: "session.status",
        properties: {
          sessionID: "s1",
          status: { type: "retry", attempt: 1, message: "Free usage exceeded", next: now + 30_000, action: { reason: "free_tier_limit", provider: "opencode", title: "t", message: "m", label: "l" } },
        },
      }),
      now,
    )
    expect(status).toEqual({ type: "retry", session: "s1", attempt: 1, next: 30_000, error: { message: "Free usage exceeded", limitReason: "free_tier_limit" } })
  })

  test("limitFields: the header table, the most specific reset first; unparsable values dropped", () => {
    const now = Date.parse("2026-09-25T11:00:00Z")
    const at = (iso: string) => Date.parse(iso)
    const epoch = (iso: string) => String(at(iso) / 1000)
    // A stated wait alone: retry-after in seconds or as an HTTP-date, counted from now.
    expect(limitFields({ "retry-after": "90" }, now)).toEqual({ retryAfterMs: 90_000, resetAt: now + 90_000 })
    expect(limitFields({ "retry-after": "Thu, 25 Sep 2026 11:05:00 GMT" }, now)).toEqual({ retryAfterMs: 300_000, resetAt: now + 300_000 })
    // retry-after-ms wins over retry-after, as in opencode's own delay().
    expect(limitFields({ "retry-after-ms": "1500.5", "retry-after": "90" }, now)).toEqual({ retryAfterMs: 1501, resetAt: now + 1501 })
    // The unified reset names the binding window: here the weekly one.
    const week = { "anthropic-ratelimit-unified-5h-reset": epoch("2026-09-25T14:00:00Z"), "anthropic-ratelimit-unified-7d-reset": epoch("2026-09-30T22:00:00Z") }
    expect(limitFields({ ...week, "anthropic-ratelimit-unified-reset": epoch("2026-09-30T22:00:00Z") }, now)).toEqual({ resetAt: at("2026-09-30T22:00:00Z"), scope: "7d" })
    // A unified reset that matches neither window: scope unknown.
    expect(limitFields({ "anthropic-ratelimit-unified-reset": epoch("2026-09-25T13:00:00Z") }, now)).toEqual({ resetAt: at("2026-09-25T13:00:00Z"), scope: "unknown" })
    // Two windows and no binding reset: the fuller one, else the later.
    expect(limitFields({ ...week, "anthropic-ratelimit-unified-5h-utilization": "1.0", "anthropic-ratelimit-unified-7d-utilization": "0.4" }, now)).toMatchObject({ scope: "5h" })
    expect(limitFields(week, now)).toMatchObject({ scope: "7d" })
    // Open windows (status allowed): the family is not the failure's; a stated wait still is.
    expect(limitFields({ ...week, "anthropic-ratelimit-unified-status": "allowed", "retry-after": "2" }, now)).toEqual({ retryAfterMs: 2000, resetAt: now + 2000 })
    // The per-minute caps: RFC 3339 instants; a cap with requests left did not refuse.
    const caps = {
      "anthropic-ratelimit-requests-remaining": "12",
      "anthropic-ratelimit-requests-reset": "2026-09-25T11:00:40Z",
      "anthropic-ratelimit-input-tokens-remaining": "0",
      "anthropic-ratelimit-input-tokens-reset": "2026-09-25T11:00:20Z",
    }
    expect(limitFields(caps, now)).toEqual({ resetAt: at("2026-09-25T11:00:20Z"), scope: "token" })
    // The windows outrank the caps, which outrank a bare retry-after.
    expect(limitFields({ ...caps, "anthropic-ratelimit-unified-5h-reset": epoch("2026-09-25T14:00:00Z"), "retry-after": "20" }, now)).toEqual({
      retryAfterMs: 20_000,
      resetAt: at("2026-09-25T14:00:00Z"),
      scope: "5h",
    })
    // The OpenAI family states durations: the wait, and the reset counted from now; the latest refused cap binds.
    expect(limitFields({ "x-ratelimit-reset-requests": "1s", "x-ratelimit-reset-tokens": "6m0s" }, now)).toEqual({ retryAfterMs: 360_000, resetAt: now + 360_000, scope: "token" })
    expect(limitFields({ "x-ratelimit-reset-requests": "20ms", "x-ratelimit-remaining-tokens": "5", "x-ratelimit-reset-tokens": "6m0s" }, now)).toEqual({
      retryAfterMs: 20,
      resetAt: now + 20,
      scope: "request",
    })
    // Values that do not parse are dropped, not guessed: a bare clock time, a
    // date without an offset, a number too small to be an instant, a malformed duration.
    expect(
      limitFields(
        {
          "retry-after": "soon",
          "anthropic-ratelimit-unified-reset": "12:30",
          "anthropic-ratelimit-requests-reset": "2026-09-25T11:00:40",
          "anthropic-ratelimit-tokens-reset": "42",
          "x-ratelimit-reset-tokens": "6 minutes",
        },
        now,
      ),
    ).toEqual({})
    expect(limitFields(undefined, now)).toEqual({})
  })

  test("idle from both opencode signals; busy and unrelated events dropped", () => {
    expect(mapEvent(ev({ id: "e", type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } }))).toEqual({ type: "idle", session: "s1" })
    expect(mapEvent(ev({ id: "e", type: "session.idle", properties: { sessionID: "s1" } }))).toEqual({ type: "idle", session: "s1" })
    expect(mapEvent(ev({ id: "e", type: "session.status", properties: { sessionID: "s1", status: { type: "busy" } } }))).toBeUndefined()
    expect(mapEvent(ev({ id: "e", type: "server.connected", properties: {} }))).toBeUndefined()
  })
})

describe("AgentClient interface", () => {
  test("a fake client implements it without SDK types", async () => {
    const script: AgentEvent[] = [
      { type: "part", session: "f1", part: { kind: "text", id: "t", text: "ok", final: true } },
      { type: "idle", session: "f1" },
    ]
    const ok = async () => ({ ok: true as const, value: undefined })
    const fake: AgentClient = {
      capabilities: { resume: false, fork: "none", steer: false, abort: true, question: false, permission: false, history: false, usage: "none" },
      create: async () => ({ ok: true, value: { id: "f1" } }),
      prompt: ok,
      promptAsync: async () => ({ ok: false, error: new Error("steer unsupported") }),
      abort: ok,
      fork: async () => ({ ok: false, error: new Error("fork unsupported") }),
      rename: ok,
      messages: async () => ({ ok: false, error: new Error("history unsupported") }),
      get: async (id) => ({ ok: true, value: { id } }),
      events: async () =>
        (async function* () {
          yield* script
        })(),
      replyQuestion: ok,
      rejectQuestion: ok,
      replyPermission: ok,
      contextLimits: async () => new Map(),
    }
    const created = await fake.create({ title: "t" })
    expect(created).toEqual({ ok: true, value: { id: "f1" } })
    const seen: AgentEvent[] = []
    for await (const event of await fake.events(new AbortController().signal)) seen.push(event)
    expect(seen.map((e) => e.type)).toEqual(["part", "idle"])
    expect((await fake.fork("f1")).ok).toBe(false)
  })
})
