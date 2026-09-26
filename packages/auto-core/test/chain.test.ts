// Unit tests for src/chain.ts: model-routing evaluation (resolveModel/splitModel),
// role derivation (phaseToRole/roleOf), session-error classification (classifySessionError).
// Split out of test/runner.test.ts (plans/0024-module-split-plan.md S18, pure move).

import { describe, expect, test } from "bun:test"
import { OPENCODE_ERROR_PATTERNS, splitModel } from "../src/agent/opencode/client"
import { classifySessionError, phaseToRole, resolveModel, roleOf } from "../src/chain"
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
