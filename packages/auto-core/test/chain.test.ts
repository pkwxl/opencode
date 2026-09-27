// Unit tests for src/chain.ts: model-routing evaluation (resolveModel/splitModel),
// role derivation (phaseToRole/roleOf), session-error classification (classifySessionError),
// the agent's retry policy (agentGaveUp/retryPolicyOf, plans/0057 §4), the
// resets stated in a provider's wording (statedInWording, plans/0057 S4a).
// Split out of test/runner.test.ts (plans/0024-module-split-plan.md S18, pure move).

import { describe, expect, test } from "bun:test"
import type { Event } from "@opencode-ai/sdk/v2"
import { CLAUDE_ERROR_PATTERNS, CLAUDE_RETRY_POLICY } from "../src/agent/claude/client"
import { claudeStream } from "../src/agent/claude/stream"
import { OPENCODE_ERROR_PATTERNS, OPENCODE_RETRY_POLICY, splitModel } from "../src/agent/opencode/client"
import { mapEvent } from "../src/agent/opencode/events"
import type { AgentEvent, AgentRetryPolicy } from "../src/agent/types"
import { agentGaveUp, classifySessionError, type ErrorInfo, NEUTRAL_RETRY_POLICY, phaseToRole, resolveModel, retryPolicyOf, roleOf, statedInWording } from "../src/chain"
import { parsePhaseTypeFile } from "../src/phases/custom"
import { phaseTypeOfLetter, type PhaseLetter } from "../src/phases/registry"
import { parseSwitches, SWITCH_ENV } from "../src/switches"

const L = (letter: PhaseLetter) => phaseTypeOfLetter(letter)

// ---- Phased model routing (plans/0017-model-routing-design.md C.1/C.3, P2) ----

describe("resolveModel (routing precedence role > type > letter > wildcard)", () => {
  const policy = (raw?: string) => parseSwitches(raw ? { [SWITCH_ENV.model]: raw } : {}).model

  test("role overrides letter overrides wildcard", () => {
    const p = policy("*=kimi/k2,m=anthropic/c-4,wrapup=kimi/k2-lite")
    expect(resolveModel(p, L("m"), "wrapup")).toBe("kimi/k2-lite") // a role hit wins
    expect(resolveModel(p, L("m"), "decompose")).toBe("anthropic/c-4") // no role, letter hit
    expect(resolveModel(p, L("t"), "decompose")).toBe("kimi/k2") // no letter, wildcard fallback
  })

  test("unset (empty policy): any (letter, role) → undefined", () => {
    const p = policy()
    expect(resolveModel(p, undefined, "bypass")).toBeUndefined()
    expect(resolveModel(p, L("m"), "decompose")).toBeUndefined()
  })

  test("letters only: the hit letter's value, else undefined", () => {
    const p = policy("m=anthropic/c-4")
    expect(resolveModel(p, L("m"), "subtask")).toBe("anthropic/c-4")
    expect(resolveModel(p, L("t"), "subtask")).toBeUndefined()
  })

  test("wildcard only (bare-value form): matches everything", () => {
    const p = policy("kimi/k2")
    expect(resolveModel(p, undefined, "bypass")).toBe("kimi/k2")
    expect(resolveModel(p, L("m"), "subtask")).toBe("kimi/k2")
  })

  test("type-id keys (M3.6): type beats letter, role beats type; custom types route by id only", () => {
    const p = policy("*=kimi/k2,m=anthropic/c-4,implement=openai/g-5,security-review=kimi/k2-sec,decompose=kimi/k2-lite")
    const custom = parsePhaseTypeFile("security-review", "# Security review\n\n## plan duties\n\nx\n")
    expect(resolveModel(p, L("m"), "subtask")).toBe("openai/g-5")
    expect(resolveModel(p, L("m"), "decompose")).toBe("kimi/k2-lite")
    expect(resolveModel(p, custom, "subtask")).toBe("kimi/k2-sec")
    expect(resolveModel(p, L("t"), "subtask")).toBe("kimi/k2")
  })
})

describe("splitModel (prov/model → the SDK model param, split on the first /; in the opencode adapter since MA.3)", () => {
  test("basic split", () => {
    expect(splitModel("anthropic/c-4")).toEqual({ providerID: "anthropic", modelID: "c-4" })
  })
  test("a modelID containing a colon still splits on the first slash only", () => {
    expect(splitModel("openai/gpt-4:128k")).toEqual({ providerID: "openai", modelID: "gpt-4:128k" })
  })
})

describe("phaseToRole / roleOf (pipeline and bypass roles)", () => {
  test("phaseToRole: pipeline step mapping (subtasks→subtask, closeout has no session, step by slug)", () => {
    expect(phaseToRole({ kind: "decompose" })).toBe("decompose")
    expect(phaseToRole({ kind: "whole" })).toBe("whole")
    expect(phaseToRole({ kind: "subtasks" })).toBe("subtask")
    expect(phaseToRole({ kind: "wrapup" })).toBe("wrapup")
    expect(phaseToRole({ kind: "closeout" })).toBeUndefined()
    expect(phaseToRole({ kind: "step", step: "phase-plan", unit: "R-01.P01" })).toBe("phase-plan")
    expect(phaseToRole({ kind: "step", step: "phase-handover", unit: "R-01.P01" })).toBe("phase-handover")
    // phase-append is the append variant of the planning session; routing keeps
    // the phase-plan role (0053 D23/F6: neither a new role word nor a bypass
    // fallback, so existing route configuration keeps working)
    expect(phaseToRole({ kind: "step", step: "phase-append", unit: "R-01.P02" })).toBe("phase-plan")
    expect(phaseToRole(undefined)).toBeUndefined()
  })

  test("roleOf: explicit role first > phase-derived > bypass fallback", () => {
    expect(roleOf({ pct: 100, used: 0, at: 0, role: "knowledge" })).toBe("knowledge")
    expect(
      roleOf({ pct: 100, used: 0, at: 0, role: "knowledge", phase: { kind: "wrapup" } }),
    ).toBe("knowledge")
    expect(roleOf({ pct: 100, used: 0, at: 0, phase: { kind: "wrapup" } })).toBe("wrapup")
    expect(roleOf({ pct: 100, used: 0, at: 0 })).toBe("bypass")
  })
})

// ---- Session-error classifier (plans/0017-model-routing-design.md D.1, P3) ----
// Fixed message samples drive the criteria's evolution (design G.2): when a new
// provider's wording slips through, change these and regress.
// The classification asks "would switching the model help", unlike opencode's own
// RETRYABLE criterion ("would switching the session help").
describe("classifySessionError (fixed message samples → class)", () => {
  test("quota: an insufficient_quota message with isRetryable:false", () => {
    expect(
      classifySessionError({
        message: "Error 002: Invalid request",
        responseBody: '{"error":{"message":"You exceeded your current quota","code":"insufficient_quota"}}',
        statusCode: 429,
        isRetryable: false,
      }),
    ).toBe("quota")
  })
  test("quota: status code 402", () => {
    expect(classifySessionError({ statusCode: 402, message: "Payment Required" })).toBe("quota")
  })
  test("quota: balance/quota wording", () => {
    expect(classifySessionError({ message: "insufficient balance in your account" })).toBe("quota")
    expect(classifySessionError({ responseBody: "you have reached your usage limit" })).toBe("quota")
  })
  test("quota beats auth: isRetryable:false together with a 401", () => {
    expect(classifySessionError({ isRetryable: false, statusCode: 401, message: "unauthorized" })).toBe("quota")
  })
  test("auth: 401", () => {
    expect(classifySessionError({ statusCode: 401, message: "bad credentials" })).toBe("auth")
  })
  test("auth: 403 + ProviderAuthError name", () => {
    expect(classifySessionError({ statusCode: 403, message: "ProviderAuthError: rejected key" })).toBe("auth")
  })
  test("rate: 429 with attempt>=3", () => {
    expect(classifySessionError({ statusCode: 429, message: "rate limit exceeded", attempt: 3 })).toBe("rate")
  })
  test("rate: 429 with next > 60s", () => {
    expect(classifySessionError({ statusCode: 429, message: "resource_exhausted", next: 40 * 60_000 })).toBe("rate")
  })
  test("not rate: a lone 429 (attempt:1, no next) → unknown (still treated as opencode backing off)", () => {
    expect(classifySessionError({ statusCode: 429, message: "too many requests", attempt: 1 })).toBe("unknown")
  })
  test("not rate: 429 with next<=60s → unknown", () => {
    expect(classifySessionError({ statusCode: 429, message: "too many requests", next: 30_000 })).toBe("unknown")
  })
  test("overflow: message contains ContextOverflowError (the opencode adapter's error-name table)", () => {
    expect(classifySessionError({ message: "ContextOverflowError: prompt is too long" }, OPENCODE_ERROR_PATTERNS)).toBe("overflow")
  })
  test("overflow wins: still classified overflow when it co-occurs with isRetryable:false", () => {
    expect(classifySessionError({ message: "ContextOverflowError", isRetryable: false }, OPENCODE_ERROR_PATTERNS)).toBe("overflow")
  })
  test("adapter patterns (MA.3): agent error names are the adapter's; the neutral table does not know them", () => {
    // Without the opencode table the name is just text: no overflow class, and
    // ProviderAuthError without a 401/403 is not auth.
    expect(classifySessionError({ message: "ContextOverflowError: prompt is too long" })).toBe("unknown")
    expect(classifySessionError({ message: "ProviderAuthError: rejected key" })).toBe("unknown")
    expect(classifySessionError({ message: "ProviderAuthError: rejected key" }, OPENCODE_ERROR_PATTERNS)).toBe("auth")
    // Another adapter extends any class with its own wording; neutral patterns still apply.
    const other = { transient: /upstream hiccup/i, rate: /slow down/i }
    expect(classifySessionError({ message: "upstream hiccup" }, other)).toBe("transient")
    expect(classifySessionError({ message: "please slow down", attempt: 3 }, other)).toBe("rate")
    expect(classifySessionError({ message: "service unavailable" }, other)).toBe("transient")
  })
  test("transient: overloaded_error", () => {
    expect(classifySessionError({ message: "overloaded_error: engine busy" })).toBe("transient")
  })
  test("transient: a 500 internal error", () => {
    expect(classifySessionError({ statusCode: 500, message: "Internal Server Error" })).toBe("transient")
  })
  test("transient: a standalone 5xx numeric code in the message", () => {
    expect(classifySessionError({ message: "upstream returned 502" })).toBe("transient")
    expect(classifySessionError({ message: "HTTP/1.1 503" })).toBe("transient")
  })
  test("not transient: a 50x substring inside a longer number is not a 5xx signal (2026-09-17 review H4)", () => {
    expect(classifySessionError({ message: "Error 1500: something odd" })).toBe("unknown")
    expect(classifySessionError({ message: "error code 5042" })).toBe("unknown")
    expect(classifySessionError({ message: "5000 requests sent" })).toBe("unknown")
    expect(classifySessionError({ message: "runtime v5.0.4" })).toBe("unknown")
  })
  test("unknown: a meaningless string (conservative default; no model switch on unknown)", () => {
    expect(classifySessionError({ message: "asdf zxcv qwerty" })).toBe("unknown")
  })
  test("unknown: empty input", () => {
    expect(classifySessionError({})).toBe("unknown")
  })
})

// plans/0057 F24: the three messages Zhipu's coding plan sent through
// opencode on 2026-09-15 and 2026-09-26, verbatim. Times are UTC; the reset
// instant is Beijing time with no offset.
describe("Zhipu's wording (plans/0057 S4a, F24)", () => {
  const FIVE = "Usage limit reached for 5 hour. Your limit will reset at 2026-09-16 06:28:10"
  const WEEK = "Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-10-02 11:25:23"
  const RATE = "Rate limit reached for requests"

  test("both spent windows class as quota; the per-minute cap stays a rate signal the agent's backoff owns", () => {
    expect(classifySessionError({ message: FIVE })).toBe("quota")
    expect(classifySessionError({ message: WEEK })).toBe("quota")
    expect(classifySessionError({ message: RATE })).toBe("unknown")
    expect(classifySessionError({ message: RATE, attempt: 4, next: 16_000 }, OPENCODE_ERROR_PATTERNS, OPENCODE_RETRY_POLICY)).toBe("unknown")
    expect(classifySessionError({ message: RATE, attempt: 5, next: 32_000 }, OPENCODE_ERROR_PATTERNS, OPENCODE_RETRY_POLICY)).toBe("rate")
  })

  test("the stated reset reads as +08:00, with the window's scope", () => {
    expect(statedInWording(FIVE, Date.parse("2026-09-15T19:33:04Z"))).toEqual({ resetAt: Date.parse("2026-09-15T22:28:10Z"), scope: "5h" })
    expect(statedInWording(WEEK, Date.parse("2026-09-26T17:15:20Z"))).toEqual({ resetAt: Date.parse("2026-10-02T03:25:23Z"), scope: "7d" })
    // The 2026-09-17 weekly event on the same account.
    const virtio = "Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-09-17 10:16:43"
    expect(statedInWording(virtio, Date.parse("2026-09-17T01:53:30Z"))?.resetAt).toBe(Date.parse("2026-09-17T02:16:43Z"))
    // Folded into a longer text (the error name ahead, a response body after).
    expect(statedInWording(`APIError ${FIVE}\n{"error":{"code":"1308"}}`, Date.parse("2026-09-15T19:33:04Z"))?.scope).toBe("5h")
  })

  test("an instant that is past, or further away than the window allows, is dropped, not guessed", () => {
    expect(statedInWording(FIVE, Date.parse("2026-09-15T22:28:10Z"))).toBeUndefined()
    // Twelve hours ahead: no five-hour window resets that late (a misread zone).
    expect(statedInWording(FIVE, Date.parse("2026-09-15T10:28:10Z"))).toBeUndefined()
    // The weekly wording has no bound of its own; the horizon applies downstream.
    expect(statedInWording(WEEK, Date.parse("2026-09-01T00:00:00Z"))?.scope).toBe("7d")
  })

  test("no statement without a known window's wording and a reset sentence", () => {
    const now = Date.parse("2026-09-15T19:33:04Z")
    expect(statedInWording(RATE, now)).toBeUndefined()
    expect(statedInWording("Your limit will reset at 2026-09-16 06:28:10", now)).toBeUndefined()
    expect(statedInWording("Usage limit reached for 5 hour.", now)).toBeUndefined()
    expect(statedInWording("Usage limit reached for 5 hour. Your limit will reset at 2026-09-16T06:28:10Z", now)).toBeUndefined()
  })
})

// plans/0057 F3, §11 item 2: `next` is the wait in ms on every adapter. Each
// adapter's own retry signal for the same wait must reach the classifier as
// the same figure — opencode states an instant, claude a delay — so a lone
// 429 with a two-second backoff never classes as rate on either one.
describe("retry wait: one unit across adapters (plans/0057 F3)", () => {
  const now = Date.parse("2026-09-25T11:44:57Z")
  const opencodeRetry = (wait: number) =>
    mapEvent({ id: "e", type: "session.status", properties: { sessionID: "s", status: { type: "retry", attempt: 1, message: "rate limit exceeded", next: now + wait } } } as unknown as Event, now)
  const claudeRetry = (wait: number) =>
    claudeStream("s").feed({ type: "system", subtype: "api_retry", attempt: 1, retry_delay_ms: wait, error_status: 429, error: "rate_limit" })[0]
  const info = (event: AgentEvent | undefined): ErrorInfo => {
    if (event?.type !== "retry") throw new Error(`not a retry event: ${JSON.stringify(event)}`)
    return { ...event.error, attempt: event.attempt, next: event.next }
  }

  test("a two-second backoff: the same next, below the threshold, on both", () => {
    const opencode = info(opencodeRetry(2000))
    const claude = info(claudeRetry(2000))
    expect([opencode.next, claude.next]).toEqual([2000, 2000])
    expect(classifySessionError(opencode, OPENCODE_ERROR_PATTERNS)).toBe("unknown")
    expect(classifySessionError(claude, CLAUDE_ERROR_PATTERNS)).toBe("unknown")
  })

  test("a forty-minute wait: the same next, above the threshold, rate on both", () => {
    const opencode = info(opencodeRetry(40 * 60_000))
    const claude = info(claudeRetry(40 * 60_000))
    expect([opencode.next, claude.next]).toEqual([40 * 60_000, 40 * 60_000])
    expect(classifySessionError(opencode, OPENCODE_ERROR_PATTERNS)).toBe("rate")
    expect(classifySessionError(claude, CLAUDE_ERROR_PATTERNS)).toBe("rate")
  })

  // plans/0057 §4.1: under each adapter's own policy the two signals still
  // agree on the two ends, and part where the agents differ.
  test("under each adapter's own retry policy", () => {
    const opencode = (wait: number) => classifySessionError(info(opencodeRetry(wait)), OPENCODE_ERROR_PATTERNS, OPENCODE_RETRY_POLICY)
    const claude = (wait: number) => classifySessionError(info(claudeRetry(wait)), CLAUDE_ERROR_PATTERNS, CLAUDE_RETRY_POLICY)
    expect([opencode(2000), claude(2000)]).toEqual(["unknown", "unknown"])
    expect([opencode(40 * 60_000), claude(40 * 60_000)]).toEqual(["rate", "rate"])
    // A 45-second wait: above opencode's 30 s backoff cap and claude's 40 s
    // one, so neither agent cures it sooner; the neutral minute would still
    // wait. 35 s is inside claude's own backoff (32 s plus jitter).
    expect(opencode(45_000)).toBe("rate")
    expect(classifySessionError(info(opencodeRetry(45_000)), OPENCODE_ERROR_PATTERNS)).toBe("unknown")
    expect(claude(45_000)).toBe("rate")
    expect(claude(35_000)).toBe("unknown")
  })
})

// plans/0057 §4.1: whether the agent's own retrying will cure a failure,
// read from its declared policy instead of two constants.
describe("agentGaveUp (plans/0057 §4.1)", () => {
  const capped: AgentRetryPolicy = { maxAttempts: 10, backoffCapMs: 40_000, honorsRetryAfter: true, waitsOutLimit: false, silenceBudgetMs: 60_000 }
  const uncapped: AgentRetryPolicy = { backoffCapMs: 30_000, honorsRetryAfter: true, waitsOutLimit: true, silenceBudgetMs: 600_000 }

  test("the attempt cap: spent at maxAttempts; an uncapped agent never spends it", () => {
    expect(agentGaveUp({ attempt: 9 }, capped)).toBe(false)
    expect(agentGaveUp({ attempt: 10 }, capped)).toBe(true)
    expect(agentGaveUp({ attempt: 1_000 }, uncapped)).toBe(false)
  })

  test("a wait above the agent's own backoff cap came from elsewhere; one at or below it is the agent's own", () => {
    expect(agentGaveUp({ attempt: 1, next: 30_000 }, uncapped)).toBe(false)
    expect(agentGaveUp({ attempt: 1, next: 30_001 }, uncapped)).toBe(true)
    expect(agentGaveUp({ attempt: 1, next: 40_000 }, capped)).toBe(false)
    expect(agentGaveUp({ attempt: 1, next: 40_001 }, capped)).toBe(true)
  })

  test("a terminal signal: final for an agent that does not wait out a limit, one more step for one that does", () => {
    expect(agentGaveUp({ terminal: true }, capped)).toBe(true)
    expect(agentGaveUp({ terminal: true }, uncapped)).toBe(false)
    expect(agentGaveUp({}, capped)).toBe(false)
  })

  test("the neutral policy is plans/0017's threshold: three attempts, or a wait above a minute", () => {
    expect(agentGaveUp({ attempt: 2, next: 60_000 }, NEUTRAL_RETRY_POLICY)).toBe(false)
    expect(agentGaveUp({ attempt: 3 }, NEUTRAL_RETRY_POLICY)).toBe(true)
    expect(agentGaveUp({ next: 60_001 }, NEUTRAL_RETRY_POLICY)).toBe(true)
    expect(agentGaveUp({ terminal: true }, NEUTRAL_RETRY_POLICY)).toBe(false)
  })

  test("a claude turn that ended on a throttle is the rate class under its policy (no more unknown → ladder)", () => {
    const ended: ErrorInfo = { message: "rate_limit API Error: Request rejected (429)", statusCode: 429, terminal: true }
    expect(classifySessionError(ended, CLAUDE_ERROR_PATTERNS, CLAUDE_RETRY_POLICY)).toBe("rate")
    expect(classifySessionError(ended, CLAUDE_ERROR_PATTERNS)).toBe("unknown")
    // Still backing off inside the CLI's ladder: not yet.
    expect(classifySessionError({ message: "rate_limit", statusCode: 429, attempt: 3, next: 2_000 }, CLAUDE_ERROR_PATTERNS, CLAUDE_RETRY_POLICY)).toBe("unknown")
  })
})

describe("retryPolicyOf (plans/0057 §11 item 3)", () => {
  test("the adapter's record, else the neutral one, with an entry's fields laid over it", () => {
    expect(retryPolicyOf(undefined)).toEqual(NEUTRAL_RETRY_POLICY)
    expect(retryPolicyOf(CLAUDE_RETRY_POLICY)).toEqual(CLAUDE_RETRY_POLICY)
    expect(retryPolicyOf(CLAUDE_RETRY_POLICY, { maxAttempts: 15 })).toEqual({ ...CLAUDE_RETRY_POLICY, maxAttempts: 15 })
    expect(retryPolicyOf(undefined, { waitsOutLimit: false })).toEqual({ ...NEUTRAL_RETRY_POLICY, waitsOutLimit: false })
    // opencode declares no cap; an override may give it one.
    expect(retryPolicyOf(OPENCODE_RETRY_POLICY).maxAttempts).toBeUndefined()
    expect(retryPolicyOf(OPENCODE_RETRY_POLICY, { maxAttempts: 8 }).maxAttempts).toBe(8)
  })
})
