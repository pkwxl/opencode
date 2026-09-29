// The failure concern's suite (plans/0061 §4.6: a concern suite over a fake
// TurnFx): the turn's failure accumulator — the error text fold and the
// name-keyed message fold, the pessimistic retryable, the ErrorInfo
// accumulation with the limit statement laid over (withLimit, moved here from
// the watch body) and the reset a known wording states (withWording), the
// retrying lifecycle (a retry signal sets it, model output ends it) and the
// stated-limit drop that ends it.
import { describe, expect, test } from "bun:test"
import type { AgentError, AgentEvent } from "../src/agent/types"
import type { Advice, TurnState } from "../src/engine/contract"
import { failureConcern } from "../src/engine/concerns/failure"
import { fakeTurnFx, turnContext, viewOver } from "./fixtures/turn"

const SESSION = "ses_1"

type Own = TurnState["failure"]
type Drive = (event: AgentEvent, fx?: ReturnType<typeof fakeTurnFx>) => Promise<Advice>

// One concern instance per case, driven over one event at a time. The fx
// double's now() answers 0, so a wording-stated reset must fall inside the
// epoch's first five hours for statedInWording to accept it (+08:00 zone:
// 1970-01-01 08:01–13:01 wall time).
const setup = (): { own: Own; drive: Drive; fx: ReturnType<typeof fakeTurnFx> } => {
  const ctx = turnContext()
  const own = failureConcern.initial(ctx)
  const fx = fakeTurnFx()
  const drive: Drive = (event, useFx) => failureConcern.handle({ kind: "event", event }, own, viewOver({}), useFx ?? fx, ctx)
  return { own, drive, fx }
}

const error = (e: AgentError): AgentEvent => ({ type: "error", session: SESSION, error: e })
const retry = (e: AgentError, over: { attempt?: number; next?: number } = {}): AgentEvent => ({
  type: "retry",
  session: SESSION,
  error: e,
  ...(over.attempt !== undefined ? { attempt: over.attempt } : {}),
  ...(over.next !== undefined ? { next: over.next } : {}),
})

describe("the failure concern (error: the text fold and the pessimistic retryable)", () => {
  test("a session error appends its text and folds its name into the info's message; terminal marks the agent's stopped retrying", async () => {
    const { own, drive } = setup()
    await expect(drive(error({ name: "APIError", message: "boom" }))).resolves.toBe("pass")
    expect(own.error).toBe("boom")
    expect(own.info).toEqual({ message: "APIError boom", terminal: true })
    expect(own.retryable).toBeUndefined()
  })

  test("a second error joins both the text and the folded message with a newline", async () => {
    const { own, drive } = setup()
    await drive(error({ name: "APIError", message: "first failure" }))
    await drive(error({ name: "ProviderAuthError", message: "key rejected" }))
    expect(own.error).toBe("first failure\nkey rejected")
    expect(own.info?.message).toBe("APIError first failure\nProviderAuthError key rejected")
  })

  test("a detail that already names the error type needs no fold; a name-less error uses its message alone", async () => {
    const { own, drive } = setup()
    await drive(error({ name: "APIError", message: "APIError: rate limited" }))
    expect(own.info?.message).toBe("APIError: rate limited")
    await drive(error({ message: "plain transport loss" }))
    expect(own.info?.message).toBe("APIError: rate limited\nplain transport loss")
    expect(own.error).toBe("APIError: rate limited\nplain transport loss")
  })

  test("the pessimistic retryable: once any error carries isRetryable:false the turn stays non-retryable, while the info keeps the latest statement", async () => {
    const { own, drive } = setup()
    await drive(error({ message: "first", isRetryable: true }))
    expect(own.retryable).toBeUndefined()
    await drive(error({ message: "second", isRetryable: false }))
    expect(own.retryable).toBe(false)
    // Never retracted by later events — but the info's own field is the
    // latest statement, not the latch.
    await drive(error({ message: "third", isRetryable: true }))
    expect(own.retryable).toBe(false)
    expect(own.info?.isRetryable).toBe(true)
  })
})

describe("the failure concern (the limit statement: withLimit over, withWording beneath)", () => {
  test("a stated reset replaces the earlier one together with its scope; retryAfterMs and limitReason ride beside", async () => {
    const { own, drive } = setup()
    await drive(error({ message: "first", resetAt: 1000, scope: "5h" }))
    await drive(error({ message: "second", resetAt: 2000, scope: "7d", retryAfterMs: 5000, limitReason: "five_hour" }))
    expect(own.info).toMatchObject({ resetAt: 2000, scope: "7d", retryAfterMs: 5000, limitReason: "five_hour" })
  })

  test("a half-stated replacement: an event naming only the scope drops the earlier reset with it", async () => {
    const { own, drive } = setup()
    await drive(error({ message: "first", resetAt: 1000, scope: "5h" }))
    await drive(error({ message: "second", scope: "7d" }))
    expect(own.info?.scope).toBe("7d")
    expect(own.info?.resetAt).toBeUndefined()
  })

  test("an event stating no limit field leaves the earlier pair standing, and unstated retryAfterMs/limitReason persist", async () => {
    const { own, drive } = setup()
    await drive(error({ message: "first", resetAt: 1000, scope: "5h", retryAfterMs: 60_000, limitReason: "r1" }))
    await drive(error({ message: "second" }))
    expect(own.info).toMatchObject({ resetAt: 1000, scope: "5h", retryAfterMs: 60_000, limitReason: "r1" })
  })

  test("a reset the provider stated only in a known wording counts when the event states no structured limit (the message and response body are read together)", async () => {
    const { own, drive } = setup()
    await drive(error({ message: "Usage limit reached for 5 hour.", responseBody: "… your limit will reset at 1970-01-01 10:00:00 (details)" }))
    expect(own.info?.resetAt).toBe(7_200_000) // 1970-01-01 10:00 +08:00 = 02:00 UTC
    expect(own.info?.scope).toBe("5h")
  })

  test("a structured statement outranks the wording: an event stating its own reset keeps it, however valid the text reads", async () => {
    const { own, drive } = setup()
    await drive(error({ message: "Usage limit reached for 5 hour. Your limit will reset at 1970-01-01 09:00:00", resetAt: 1000, scope: "5h" }))
    expect(own.info?.resetAt).toBe(1000)
    expect(own.info?.scope).toBe("5h")
  })

  test("a wording outside its window's own horizon does not count (a misread zone is dropped, not guessed)", async () => {
    const { own, drive } = setup()
    await drive(error({ message: "Usage limit reached for 5 hour. Your limit will reset at 1970-01-01 20:00:00" }))
    expect(own.info?.resetAt).toBeUndefined()
    expect(own.info?.scope).toBeUndefined()
  })
})

describe("the failure concern (retry: the signal's own record)", () => {
  test("a retry sets retrying, replaces the info's message with the signal's own and drops the earlier end's terminal flag", async () => {
    const { own, drive } = setup()
    await drive(error({ name: "APIError", message: "the turn failed" }))
    expect(own.info?.terminal).toBe(true)
    await expect(drive(retry({ message: "provider 500" }, { attempt: 2, next: 30_000 }))).resolves.toBe("pass")
    expect(own.retrying).toBe(true)
    // The signal appends no text of its own: the accumulated error string is
    // the closing report's basis, and a retrying agent has not ended.
    expect(own.error).toBe("the turn failed")
    expect(own.info).toEqual({ message: "provider 500", attempt: 2, next: 30_000 })
  })

  test("a retry whose error carries no message keeps the accumulated one, and states its own limit through the same overlay", async () => {
    const { own, drive } = setup()
    await drive(error({ message: "earlier failure", resetAt: 1000, scope: "5h" }))
    await drive(retry({ statusCode: 429 }, { attempt: 3 }))
    expect(own.info).toEqual({ message: "earlier failure", statusCode: 429, attempt: 3, resetAt: 1000, scope: "5h" })
  })
})

describe("the failure concern (part: model output ends retrying and drops the stated limit)", () => {
  test("a non-step-start part ends retrying and drops every stated limit field; the rest of the record stands", async () => {
    const { own, drive } = setup()
    await drive(retry({ message: "curing it", statusCode: 429, resetAt: 1000, scope: "5h", retryAfterMs: 60_000, limitReason: "r" }, { attempt: 1 }))
    expect(own.retrying).toBe(true)
    await expect(
      drive({ type: "part", session: SESSION, part: { kind: "tool", id: "pt_1", tool: "Read", status: "running", input: {} } }),
    ).resolves.toBe("pass")
    expect(own.retrying).toBe(false)
    expect(own.info).toEqual({ message: "curing it", statusCode: 429, attempt: 1 })
  })

  test("a step-start part is not output: retrying stands and the record is untouched", async () => {
    const { own, drive } = setup()
    await drive(retry({ message: "curing it", resetAt: 1000, scope: "5h" }, { attempt: 1 }))
    await drive({ type: "part", session: SESSION, part: { kind: "step-start", id: "pt_s1" } })
    expect(own.retrying).toBe(true)
    expect(own.info).toMatchObject({ resetAt: 1000, scope: "5h" })
  })
})

describe("the failure concern (the pass-through)", () => {
  test("inputs outside its cells pass through with the slice untouched — including before any failure arrived", async () => {
    const { own, drive } = setup()
    await expect(drive({ type: "message", session: SESSION, message: { id: "m1", role: "assistant", completed: true, failed: false } })).resolves.toBe("pass")
    await expect(drive({ type: "idle", session: SESSION })).resolves.toBe("pass")
    await expect(failureConcern.handle({ kind: "probe", ok: false, at: 0 }, own, viewOver({}), fakeTurnFx(), turnContext())).resolves.toBe("pass")
    expect(own).toEqual({ error: "", retrying: false })
  })
})
