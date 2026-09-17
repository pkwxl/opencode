// src/chain.ts 的单测: 模型路由求值(resolveModel/splitModel)、角色推导(phaseToRole/roleOf)、会话错误归类(classifySessionError)。
// 拆分自 test/runner.test.ts(docs/module-split-plan.md S18,纯搬运)。

import { describe, expect, test } from "bun:test"
import { classifySessionError, phaseToRole, resolveModel, roleOf, splitModel } from "../src/chain"
import { parseSwitches, SWITCH_ENV } from "../src/switches"

// ---- 阶段化模型路由(docs/model-routing-design.md C.1/C.3,P2)----

describe("resolveModel(路由求值 role > letter > wildcard)", () => {
  const policy = (raw?: string) => parseSwitches(raw ? { [SWITCH_ENV.model]: raw } : {}).model

  test("role 覆盖 letter 覆盖 wildcard", () => {
    const p = policy("*=kimi/k2,m=anthropic/c-4,verify-judge=kimi/k2-lite")
    expect(resolveModel(p, "m", "verify-judge")).toBe("kimi/k2-lite") // role 命中优先
    expect(resolveModel(p, "m", "understand")).toBe("anthropic/c-4") // role 缺、letter 命中
    expect(resolveModel(p, "t", "understand")).toBe("kimi/k2") // letter 缺、wildcard 兜底
  })

  test("未设(空策略): 任意 (letter, role) → undefined", () => {
    const p = policy()
    expect(resolveModel(p, undefined, "bypass")).toBeUndefined()
    expect(resolveModel(p, "m", "understand")).toBeUndefined()
  })

  test("仅字母: 命中字母取值,否则 undefined", () => {
    const p = policy("m=anthropic/c-4")
    expect(resolveModel(p, "m", "subtask")).toBe("anthropic/c-4")
    expect(resolveModel(p, "t", "subtask")).toBeUndefined()
  })

  test("仅通配(裸值形态): 全量命中", () => {
    const p = policy("kimi/k2")
    expect(resolveModel(p, undefined, "bypass")).toBe("kimi/k2")
    expect(resolveModel(p, "m", "subtask")).toBe("kimi/k2")
  })
})

describe("splitModel(prov/model → SDK model 参数,按首个 / 切分)", () => {
  test("基本切分", () => {
    expect(splitModel("anthropic/c-4")).toEqual({ providerID: "anthropic", modelID: "c-4" })
  })
  test("modelID 含冒号仍只按首个斜杠切", () => {
    expect(splitModel("openai/gpt-4:128k")).toEqual({ providerID: "openai", modelID: "gpt-4:128k" })
  })
})

describe("phaseToRole / roleOf(执行链与旁路角色)", () => {
  test("phaseToRole: 执行链各阶段映射(subtasks→subtask,verify/review 按 stage,step 按 slug)", () => {
    expect(phaseToRole({ kind: "understand" })).toBe("understand")
    expect(phaseToRole({ kind: "decompose" })).toBe("decompose")
    expect(phaseToRole({ kind: "whole" })).toBe("whole")
    expect(phaseToRole({ kind: "subtasks" })).toBe("subtask")
    expect(phaseToRole({ kind: "wrapup" })).toBe("wrapup")
    expect(phaseToRole({ kind: "verify", stage: "generate", round: 1, rechecks: 0, replaced: false })).toBe("verify-generate")
    expect(phaseToRole({ kind: "verify", stage: "exec", round: 1, rechecks: 0, replaced: false })).toBe("verify-exec")
    expect(phaseToRole({ kind: "verify", stage: "judge", round: 1, rechecks: 0, replaced: false })).toBe("verify-judge")
    expect(phaseToRole({ kind: "verify", stage: "fix", round: 1, rechecks: 0, replaced: false })).toBe("verify-fix")
    expect(phaseToRole({ kind: "review", round: 1, stage: "audit" })).toBe("review-audit")
    expect(phaseToRole({ kind: "review", round: 1, stage: "planfix" })).toBe("review-planfix")
    expect(phaseToRole({ kind: "review", round: 1, stage: "fixrun" })).toBe("review-fixrun")
    expect(phaseToRole({ kind: "step", step: "phase-plan", letter: "a" })).toBe("phase-plan")
    expect(phaseToRole({ kind: "step", step: "phase-handover", letter: "m" })).toBe("phase-handover")
    expect(phaseToRole(undefined)).toBeUndefined()
  })

  test("roleOf: 显式 role 优先 > phase 推导 > bypass 兜底", () => {
    expect(roleOf({ pct: 100, used: 0, at: 0, role: "knowledge" })).toBe("knowledge")
    expect(
      roleOf({ pct: 100, used: 0, at: 0, role: "verify-judge", phase: { kind: "review", round: 1, stage: "audit" } }),
    ).toBe("verify-judge")
    expect(roleOf({ pct: 100, used: 0, at: 0, phase: { kind: "wrapup" } })).toBe("wrapup")
    expect(roleOf({ pct: 100, used: 0, at: 0 })).toBe("bypass")
  })
})

// ---- 会话错误分类器(docs/model-routing-design.md D.1,P3)----
// 固定报文样本驱动判据演进(设计 G.2):新 provider 措辞漏判时改这里并回归。
// 分类问"换模型有没有用",与 opencode 自身 RETRYABLE 判据(换会话有没有用)不同。
describe("classifySessionError(固定报文样本 → 类别)", () => {
  test("quota: isRetryable:false 的 insufficient_quota 报文", () => {
    expect(
      classifySessionError({
        message: "Error 002: Invalid request",
        responseBody: '{"error":{"message":"You exceeded your current quota","code":"insufficient_quota"}}',
        statusCode: 429,
        isRetryable: false,
      }),
    ).toBe("quota")
  })
  test("quota: 402 状态码", () => {
    expect(classifySessionError({ statusCode: 402, message: "Payment Required" })).toBe("quota")
  })
  test("quota: 余额/额度文案", () => {
    expect(classifySessionError({ message: "insufficient balance in your account" })).toBe("quota")
    expect(classifySessionError({ responseBody: "you have reached your usage limit" })).toBe("quota")
  })
  test("quota 优先于 auth: isRetryable:false 同时带 401", () => {
    expect(classifySessionError({ isRetryable: false, statusCode: 401, message: "unauthorized" })).toBe("quota")
  })
  test("auth: 401", () => {
    expect(classifySessionError({ statusCode: 401, message: "bad credentials" })).toBe("auth")
  })
  test("auth: 403 + ProviderAuthError 名", () => {
    expect(classifySessionError({ statusCode: 403, message: "ProviderAuthError: rejected key" })).toBe("auth")
  })
  test("rate: 429 且 attempt>=3", () => {
    expect(classifySessionError({ statusCode: 429, message: "rate limit exceeded", attempt: 3 })).toBe("rate")
  })
  test("rate: 429 且 next > 60s", () => {
    expect(classifySessionError({ statusCode: 429, message: "resource_exhausted", next: 40 * 60_000 })).toBe("rate")
  })
  test("非 rate: 单个 429(attempt:1、无 next)→ unknown(仍视为 opencode 在退避)", () => {
    expect(classifySessionError({ statusCode: 429, message: "too many requests", attempt: 1 })).toBe("unknown")
  })
  test("非 rate: 429 且 next<=60s → unknown", () => {
    expect(classifySessionError({ statusCode: 429, message: "too many requests", next: 30_000 })).toBe("unknown")
  })
  test("overflow: 报文含 ContextOverflowError", () => {
    expect(classifySessionError({ message: "ContextOverflowError: prompt is too long" })).toBe("overflow")
  })
  test("overflow 优先: 与 isRetryable:false 同时出现仍判 overflow", () => {
    expect(classifySessionError({ message: "ContextOverflowError", isRetryable: false })).toBe("overflow")
  })
  test("transient: overloaded_error", () => {
    expect(classifySessionError({ message: "overloaded_error: engine busy" })).toBe("transient")
  })
  test("transient: 500 内部错误", () => {
    expect(classifySessionError({ statusCode: 500, message: "Internal Server Error" })).toBe("transient")
  })
  test("transient: 报文里独立出现的 5xx 数字码", () => {
    expect(classifySessionError({ message: "upstream returned 502" })).toBe("transient")
    expect(classifySessionError({ message: "HTTP/1.1 503" })).toBe("transient")
  })
  test("非 transient: 长号码里的 50x 子串不算 5xx 信号(2026-09-17 审查 H4)", () => {
    expect(classifySessionError({ message: "Error 1500: something odd" })).toBe("unknown")
    expect(classifySessionError({ message: "error code 5042" })).toBe("unknown")
    expect(classifySessionError({ message: "5000 requests sent" })).toBe("unknown")
    expect(classifySessionError({ message: "runtime v5.0.4" })).toBe("unknown")
  })
  test("unknown: 无意义字符串(保守缺省,不在 unknown 上换模型)", () => {
    expect(classifySessionError({ message: "asdf zxcv qwerty" })).toBe("unknown")
  })
  test("unknown: 空输入", () => {
    expect(classifySessionError({})).toBe("unknown")
  })
})
