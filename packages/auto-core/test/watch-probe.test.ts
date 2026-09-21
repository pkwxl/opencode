// 在途失联探针(plans/0026-session-boundary-hardening-design.md D3/§4.4,S4): watching 期间
// 每 idleTime 经独立短超时连接探测会话活性——两连败判半开 → abort + 可重试会话
// 错误(transient,走既有重试阶梯与降级环);探针恢复即重置计数、继续 watching;
// 定时器随全部出口清理。半开形态用「永不产事件的事件流」复现(无 FIN/RST,客户端
// 永远收不到结束信号);探针周期经 opts.idleMs 缩到毫秒级。

import { describe, expect, test } from "bun:test"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { opencodeAgent } from "../src/agent/opencode/client"
import { attempt } from "../src/attempt"
import { runSession } from "../src/session"
import { probeSession } from "../src/session-api"
import { parseSwitches } from "../src/switches"
import { task, fakeClient } from "./fixtures/runner"

describe("在途失联探针(S4/D3)", () => {
  test("两连败: 判半开,abort 会话并返回可重试会话错误(errorClass=transient)", async () => {
    let gets = 0
    const { client, calls } = fakeClient({
      get: () => {
        gets++
        return { error: { name: "UnknownError", data: {} } }
      },
      // 半开形态: 事件流永不产事件(无结束信号、无断开错误)。
      events: () =>
        (async function* () {
          await new Promise(() => {})
        })(),
    })
    const result = await attempt(client, task, "提示词", { idleMs: 20 }, { pct: 100, used: 0, at: 0 }, undefined, undefined, parseSwitches({}))
    expect(result.type).toBe("blocked")
    const blocked = result as { question: string; retryable?: boolean; errorClass?: string }
    expect(blocked.question).toContain("session error: ")
    expect(blocked.question).toContain("half-open")
    // 可重试(retryable 非 false)+ transient 归类(传输层故障,不换模型)。
    expect(blocked.retryable).not.toBe(false)
    expect(blocked.errorClass).toBe("transient")
    expect(gets).toBeGreaterThanOrEqual(2)
    // 收口必须 abort(不留孤儿 server 回合与重试 fork 并发改文件)。
    expect(calls.aborts).toContain("ses_new_1")
  })

  test("一败后恢复: 计数重置不判半开,会话照常经 idle 结算、不 abort", async () => {
    let gets = 0
    const { client, calls } = fakeClient({
      // 第 1 次未通,其后全通——两连败门槛不得被单次抖动触达。
      get: () => (gets++ === 0 ? { error: { name: "UnknownError", data: {} } } : { data: { id: "ses_x" } }),
      events: (sid) =>
        (async function* () {
          // 三个探针周期内无事件(探针工作区间),随后正常 idle 结算。
          await new Promise((resolve) => setTimeout(resolve, 75))
          yield { type: "session.idle", properties: { sessionID: sid } }
        })(),
    })
    const result = await runSession(client, task, "提示词", { idleMs: 20 }, { pct: 100, used: 0, at: 0 })
    expect(result.type).toBe("idle")
    expect(gets).toBeGreaterThanOrEqual(2)
    expect(calls.aborts).toEqual([])
  })

  test("定时器清理: 会话结算后不再发探针(无泄漏)", async () => {
    let gets = 0
    const { client } = fakeClient({
      get: () => {
        gets++
        return { data: { id: "ses_x" } }
      },
    })
    const result = await runSession(client, task, "提示词", { idleMs: 20 }, { pct: 100, used: 0, at: 0 })
    expect(result.type).toBe("idle")
    const atSettle = gets
    // 等三个探针周期以上,探针计数不得再增长(结算即清链,迟到回调亦不续排)。
    await new Promise((resolve) => setTimeout(resolve, 70))
    expect(gets).toBe(atSettle)
  })

  test("H7: POST 悬挂在半开连接上时,探针判定即联动中止 POST 并按会话错误收口(不等 TURN_TIMEOUT)", async () => {
    const { client, calls } = fakeClient({
      get: () => {
        return { error: { name: "UnknownError", data: {} } }
      },
      // H7 现场: 同步 POST 与 SSE 同挂半开连接,两侧都永不兑现。
      prompt: () => new Promise(() => {}),
      events: () =>
        (async function* () {
          await new Promise(() => {})
        })(),
    })
    // 若仍押在 POST 上等 TURN_TIMEOUT,本用例会挂到测试超时;能在探针尺度
    // (~2×idleMs)返回即证明联动生效。
    const result = await attempt(client, task, "提示词", { idleMs: 20 }, { pct: 100, used: 0, at: 0 }, undefined, undefined, parseSwitches({}))
    expect(result.type).toBe("blocked")
    const blocked = result as { question: string; retryable?: boolean; errorClass?: string }
    // 按 watch 的半开会话错误收口,不得报成"下发任务失败"(abort 回声)。
    expect(blocked.question).toContain("session error: ")
    expect(blocked.question).toContain("half-open")
    expect(blocked.question).not.toContain("task dispatch failed")
    expect(blocked.retryable).not.toBe(false)
    expect(blocked.errorClass).toBe("transient")
    // POST 携带中止信号,且随半开判定被 abort(真实链路即取消底层 fetch)。
    expect(calls.promptSignals[0]?.aborted).toBe(true)
    expect(calls.aborts).toContain("ses_new_1")
  })

  test("probeSession 探测体: 超时无响应与请求异常同按未通计,正常响应为通", async () => {
    const hanging = opencodeAgent({ session: { get: () => new Promise(() => {}) } } as unknown as OpencodeClient)
    expect(await probeSession(hanging, "ses_x", 20)).toBe(false)
    const throwing = opencodeAgent({ session: { get: () => Promise.reject(new Error("boom")) } } as unknown as OpencodeClient)
    expect(await probeSession(throwing, "ses_x", 20)).toBe(false)
    const failing = opencodeAgent({ session: { get: async () => ({ error: { name: "UnknownError" } }) } } as unknown as OpencodeClient)
    expect(await probeSession(failing, "ses_x", 20)).toBe(false)
    const ok = opencodeAgent({ session: { get: async () => ({ data: { id: "ses_x" } }) } } as unknown as OpencodeClient)
    expect(await probeSession(ok, "ses_x", 20)).toBe(true)
  })
})
