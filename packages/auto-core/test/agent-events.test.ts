// MA.1 (plans/0037): the opencode → AgentEvent mapping table, row by row, and
// a minimal fake AgentClient proving the frozen interface is implementable
// without any SDK type (the claude adapter and test fakes stand on the same
// footing).
import { describe, expect, test } from "bun:test"
import type { Event } from "@opencode-ai/sdk/v2"
import { mapEvent, mapMessage } from "../src/agent/opencode/events"
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
