// src/watch.ts 的接线单测(错误信号/统计/两行报文经 attempt 或 runSession 驱动):
// SSE 订阅生命周期、错误信号三触发面、会话边界统计、◉ 两行报文、代答采集。
// 会话故障类出口(会话错误/下发失败)经 attempt 直驱——runSession 自 2026-09-16 起
// 对故障不再返回 blocked(进入等待-探测环,见 test/session.test.ts),而 attempt 的
// 返回值正是 watch 分类标记(P3)的直接出口面。
// 拆分自 test/runner.test.ts(plans/0024-module-split-plan.md S18,纯搬运)。

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
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

// ---- SSE 订阅生命周期(attempt 会话结束即断流,根治长连接泄漏)----

describe("SSE 订阅生命周期(会话结束即断开)", () => {
  test("正常结束: runSession 返回后订阅信号已中止,事件流已收尾", async () => {
    const { client, state } = sseClient("ses_sse_1")
    const result = await runSession(client, task, "提示词", {}, { pct: 100, used: 0, at: 0 })
    expect(result.type).toBe("idle")
    expect(state.signal).toBeDefined()
    expect(state.signal?.aborted).toBe(true)
    expect(state.closed).toBe(true)
  })

  test("下发失败提前返回: 同样立即中止订阅,不留下悬挂长连接", async () => {
    const { client, state } = sseClient("ses_sse_2", { prompt: () => ({ error: { name: "UnknownError" } }) })
    const result = await attempt(client, task, "提示词", {}, { pct: 100, used: 0, at: 0 }, undefined, undefined, parseSwitches({}))
    expect(result.type).toBe("blocked")
    expect((result as { question: string }).question).toContain("下发任务失败")
    expect(state.signal?.aborted).toBe(true)
    // 失联探针的 trip 竞速包装(S4,watch.ts)让事件流生成器的收尾晚几个微任务才
    // 落定(本路径 attempt 不等 watching 即返回)——让出一个宏任务再断言流已收尾。
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(state.closed).toBe(true)
  })
})

// ---- 错误信号接线 → attempt 出口(plans/0017-model-routing-design.md D.2/CRITICAL 不变量,P3)----
describe("错误信号接线: watch 三触发面 → attempt 出口(P3 仅分类+标记,不做候选决策)", () => {
  // 零等待阶梯: 本块只验错误归类与出口标记,不该被重试退避拖成分钟级。
  const SIGNAL_NO_WAIT = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0", [SWITCH_ENV.recoveryWait]: "0" })
  test("retry part quota(isRetryable:false): 提前结算——先 abort 再返回,failover=true、errorClass=quota", async () => {
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
          // 即便随后有 idle,提前结算也已 return,不会走到 settled。
          yield { type: "session.idle", properties: { sessionID: sid } }
        })(),
    })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await attempt(client, task, "提示词", {}, chain, undefined, undefined, SIGNAL_NO_WAIT)
    expect(result.type).toBe("blocked")
    const blocked = result as { question: string; failover?: boolean; errorClass?: string; retryable?: boolean }
    expect(blocked.failover).toBe(true)
    expect(blocked.errorClass).toBe("quota")
    expect(blocked.retryable).toBe(false)
    expect(blocked.question).toContain("会话错误:")
    // D.2 核心:提前结算前必须 abort(不留孤儿 server 回合与 fork 并发改文件)。
    expect(calls.aborts).toContain("ses_new_1")
    expect(calls.creates).toBe(1)
    expect(calls.forks).toEqual([])
  })

  test("session.status retry 变体 rate(next 超阈值): 触发提前结算并 abort", async () => {
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield {
            type: "session.status",
            properties: { sessionID: sid, status: { type: "retry", attempt: 1, message: "rate limit, retrying later", next: 40 * 60_000 } },
          }
          yield { type: "session.idle", properties: { sessionID: sid } }
        })(),
    })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    // rate 无 isRetryable:false → retryable 保持 undefined → P3 不改控制流,runSession 仍按
    // 既有序换会话重试至 RETRIES 耗尽阻塞(降级决策留 P4 读 result.failover)。但每次尝试的
    // 提前结算都必然 abort——aborts 记录证明 D.2 触发面 3 已生效。
    const result = await attempt(client, task, "提示词", {}, chain, undefined, undefined, SIGNAL_NO_WAIT)
    expect(result.type).toBe("blocked")
    expect(calls.aborts.length).toBeGreaterThanOrEqual(1)
    expect(calls.aborts).toContain("ses_new_1")
  })

  test("session.error quota(isRetryable:false): 带出 errorClass=quota,但不 failover、不 abort、不提前结算", async () => {
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
    const result = await attempt(client, task, "提示词", {}, chain, undefined, undefined, SIGNAL_NO_WAIT)
    expect(result.type).toBe("blocked")
    const blocked = result as { errorClass?: string; failover?: boolean; retryable?: boolean }
    expect(blocked.errorClass).toBe("quota")
    expect(blocked.failover).toBeUndefined()
    expect(blocked.retryable).toBe(false)
    // session.error 路径绝不做提前结算的 abort。
    expect(calls.aborts).toEqual([])
  })

  test("session.error 普通可重试 500: 不触发提前 failover(走既有重试耗尽路径)", async () => {
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
    const result = await attempt(client, task, "提示词", {}, chain, undefined, undefined, SIGNAL_NO_WAIT)
    expect(result.type).toBe("blocked")
    expect((result as { failover?: boolean }).failover).toBeUndefined()
    // 可重试 500 → errorClass transient(仅上报,不降级;runSession 侧的阶梯与
    // 等待-探测消费在 test/session.test.ts 覆盖)。
    expect(calls.creates).toBe(1)
  })

  test("retry part overflow: 只累积不提前结算,继续观察到 idle 正常结束", async () => {
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
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, SIGNAL_NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.aborts).toEqual([])
  })
})

// ---- 会话边界统计接线(STATS_PLAN §2,T-003): 逐 step-finish part 去重累加、
// 全出口(含 blocked/下发失败)收段入账。仿 :601 artifactClient 手法,事件流经
// fakeClient 的 events 注入;统计读数经 statsTotals(公开 API),per-session 归
// 属经落盘 .auto/stats.json 核对。----
describe("会话边界统计接线(T-003): Watch.usage 与 statsSessionBegin/End", () => {
  // 构造一条 step-finish 的 message.part.updated 事件(tokens 分项缺省补 0)。
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

  test("Watch.usage = 逐 part 之和(分项含 reasoning/cache/cost,steps 按 part 计数),per-session 归任务", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-stats-"))
    try {
      const { client } = fakeClient({
        events: (sid) =>
          (async function* () {
            yield stepFinish(sid, "pt_sf1", { input: 1200, output: 300, reasoning: 50, cache: { read: 800, write: 100 } }, 0.01)
            yield stepFinish(sid, "pt_sf2", { input: 500, output: 40 })
            // 串话守卫: 别的会话的 step-finish 不得计入本会话。
            yield stepFinish("ses_other", "pt_sfX", { input: 9999, output: 9999 })
            yield { type: "session.idle", properties: { sessionID: sid } }
          })(),
      })
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const result = await runSession(client, task, "提示词", { dir }, chain)
      expect(result.type).toBe("idle")
      const round = await statsTotals(dir, "round")
      expect(round?.usage).toEqual({ input: 1700, output: 340, reasoning: 50, cacheRead: 800, cacheWrite: 100, cost: 0.01, steps: 2 })
      expect(round?.sessions).toBe(1)
      await flushStats(dir)
      // per-session 入账: sessionID → 任务关联 + 同口径 usage。
      const doc = JSON.parse(await Bun.file(join(dir, ".auto/stats.json")).text())
      expect(doc.sessions.ses_new_1.task).toBe("T-001")
      expect(doc.sessions.ses_new_1.usage).toEqual({ input: 1700, output: 340, reasoning: 50, cacheRead: 800, cacheWrite: 100, cost: 0.01, steps: 2 })
    } finally {
      await flushStats(dir)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("同 part 重发(SSE 重放同一 step-finish 更新事件)不重计", async () => {
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
      await runSession(client, task, "提示词", { dir }, chain)
      const round = await statsTotals(dir, "round")
      expect(round?.usage).toEqual({ input: 1200, output: 300, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0.02, steps: 1 })
    } finally {
      await flushStats(dir)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("blocked 出口 usage 不丢(阻塞前已累加的 step 照常入账)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-stats-"))
    try {
      const { client } = fakeClient({
        events: (sid) =>
          (async function* () {
            yield stepFinish(sid, "pt_sf1", { input: 1200, output: 300 })
            // 权限提问且未设 --wait-answer → 立即阻塞(watch 的 blocked return 出口)。
            yield { type: "question.asked", properties: { id: "q1", sessionID: sid, questions: [{ question: "请求权限: 写文件" }] } }
          })(),
      })
      // fakeClient 未覆盖 question/permission 表面,补桩(拒绝+中止即返回)。
      const stubbed = {
        ...client,
        question: { reply: async () => ({}), reject: async () => ({}) },
        permission: { reply: async () => ({}) },
      } as unknown as OpencodeClient
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const result = await runSession(stubbed, task, "提示词", { dir }, chain)
      expect(result.type).toBe("blocked")
      const round = await statsTotals(dir, "round")
      expect(round?.usage).toEqual({ input: 1200, output: 300, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 1 })
      expect(round?.sessions).toBe(1)
    } finally {
      await flushStats(dir)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("下发失败路径: finally 兜底收段(零 usage 照记、sessions +1,AI 段不悬挂)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-stats-"))
    try {
      const { client } = fakeClient({ prompt: () => ({ error: { name: "UnknownError", data: {} } }) })
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      // 下发失败(runSession 侧自 2026-09-16 起作为会话故障重试,这里直驱单次
      // attempt 验证其 finally 兜底收段)。
      const result = await attempt(client, task, "提示词", { dir }, chain, undefined, undefined, parseSwitches({}))
      expect(result.type).toBe("blocked")
      const round = await statsTotals(dir, "round")
      expect(round?.sessions).toBe(1)
      expect(round?.usage).toEqual({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 })
      await flushStats(dir)
      const doc = JSON.parse(await Bun.file(join(dir, ".auto/stats.json")).text())
      expect(doc.open).toBeUndefined() // 优雅收口后不留悬挂段
    } finally {
      await flushStats(dir)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("旁路会话(伪任务 PLAN,无 phase)同样照记: 入 phase+round 桶与 per-session", async () => {
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
      const plan = { id: "PLAN", title: "阶段规划(m 迁移实现)", status: "in_progress" as const, attempts: 0, body: "" }
      const result = await runSession(client, plan, "规划提示词", { dir }, chain)
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

// ---- ◉ 会话结束两行化 + 无条件打印(STATS_PLAN §4.1,T-004)----
describe("◉ 会话结束两行报文(T-004): 无条件打印与省略规则", () => {
  // 捕获 log() 的终端输出(console.log);vlog 缺省不上终端,不影响过滤。
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
  // 取一次运行输出的 ◉ 两行(行 1 以 ◉ 开头,行 2 以 "tokens 入" 开头)。
  const endLines = (lines: string[]) => {
    const i = lines.findIndex((l) => l.startsWith("◉ 会话结束"))
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

  test("两行输出: 行 1 上下文+用时,行 2 tokens 分项/命中率/费用;单轮省略(累计…),reasoning=0 省略思考项", async () => {
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
      const lines = await captureLogs(() => runSession(client, task, "提示词", { dir }, chain))
      const [line1, line2] = endLines(lines)
      expect(line1).toMatch(/^◉ 会话结束: 上下文 100% \(0 tokens\),用时 \S+$/)
      expect(line1).not.toContain("(累计")
      // 命中率 28400/(28400+1200) = 95.9%;reasoning=0 无思考项(formatTokens ≥10000 才缩写,3100 原样)。
      expect(line2).toBe("tokens 入 1200 / 出 340 / 缓存读 28.4k / 缓存写 3100,命中率 95.9%,费用 $0.041")
    } finally {
      await flushStats(dir)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("reasoning>0: 思考项插在「出」与「缓存读」之间", async () => {
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
      const lines = await captureLogs(() => runSession(client, task, "提示词", { dir }, chain))
      const [, line2] = endLines(lines)
      expect(line2).toBe("tokens 入 100 / 出 20 / 思考 120 / 缓存读 0 / 缓存写 0,命中率 0.0%")
      expect(line2).not.toContain("费用") // cost=0 省略费用
    } finally {
      await flushStats(dir)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("零用量: 命中率分母 0 显示 —;blocked 出口同样无条件打印两行", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-endline-"))
    try {
      const { client } = fakeClient({
        events: (sid) =>
          (async function* () {
            // 权限提问且未设 --wait-answer → 立即阻塞(无任何 step-finish)。
            yield { type: "question.asked", properties: { id: "q1", sessionID: sid, questions: [{ question: "请求权限: 写文件" }] } }
          })(),
      })
      const stubbed = {
        ...client,
        question: { reply: async () => ({}), reject: async () => ({}) },
        permission: { reply: async () => ({}) },
      } as unknown as OpencodeClient
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      let outcome: unknown
      const lines = await captureLogs(async () => {
        outcome = await runSession(stubbed, task, "提示词", { dir }, chain)
      })
      expect((outcome as { type: string }).type).toBe("blocked")
      const [line1, line2] = endLines(lines)
      expect(line1).toMatch(/^◉ 会话结束: 上下文 /)
      expect(line2).toBe("tokens 入 0 / 出 0 / 缓存读 0 / 缓存写 0,命中率 —")
    } finally {
      await flushStats(dir)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("复用会话第 2 轮: 行 1 带(累计 … / 2 轮),费用带(累计 $X);单轮省略规则对照", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-endline-"))
    try {
      // 每轮的 step-finish 用量由 outer 变量驱动(第 1 轮 cost 0.01,第 2 轮 0.02)。
      let roundUsage = { input: 100, output: 10, cost: 0.01 }
      const { client } = fakeClient({
        events: (sid) =>
          (async function* () {
            yield stepFinish(sid, `pt_sf_${roundUsage.cost}`, { input: roundUsage.input, output: roundUsage.output }, roundUsage.cost)
            yield { type: "session.idle", properties: { sessionID: sid } }
          })(),
      })
      const REUSE_ON = parseSwitches({ [SWITCH_ENV.reuseSession]: "on" })
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const first = await captureLogs(() => runSession(client, task, "提示词", { dir, contextLimit: 100_000 }, chain, undefined, undefined, REUSE_ON))
      // 第 1 轮(单轮): 两处累计均省略。
      const [first1, first2] = endLines(first)
      expect(first1).not.toContain("(累计")
      expect(first2).toContain("费用 $0.01")
      expect(first2).not.toContain("(累计")
      // 造可复用链(pct<50、used<cap/2、刚结束)→ 第 2 轮复用同一 sessionID。
      chain.pct = 10
      chain.used = 100
      chain.at = Date.now()
      roundUsage = { input: 200, output: 20, cost: 0.02 }
      const second = await captureLogs(() => runSession(client, task, "提示词", { dir, contextLimit: 100_000 }, chain, undefined, undefined, REUSE_ON))
      const [line1, line2] = endLines(second)
      expect(line1).toMatch(/,用时 \S+\(累计 \S+ \/ 2 轮\)$/)
      expect(line2).toContain("tokens 入 200 / 出 20")
      expect(line2).toContain("费用 $0.02(累计 $0.03)")
    } finally {
      await flushStats(dir)
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ---- driver 侧代答采集接线(plans/0020-auto-resolve-design.md §G,T-005): H1..H4 ----
// H1 观测(question.asked 回落自动答复)→ H2 随 snapshot 出全部出口 → H3 收段落账
// (补 task/phase/round/session)→ H4 会话收尾扫描 agent 标记。台账读回经
// resolvesOf,模块本身的单测在 test/resolve.test.ts。
describe("代答采集接线(AUTO-RESOLVE,T-005)", () => {
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

  // 一条 question.asked 事件(非权限提问: 文案不含"权限/permission")。
  const question = (sid: string, id: string, text: string) => ({
    type: "question.asked",
    properties: { id, sessionID: sid, questions: [{ question: text }] },
  })

  const idle = (sid: string) => ({ type: "session.idle", properties: { sessionID: sid } })

  // fake 常驻输入行: 人工在 --wait-answer 内真答了。
  const fakeInteractive = (answer: string) =>
    ({ attach: () => {}, question: async () => answer, close: () => {} }) as unknown as Interactive

  const Q1 = "是否把 prompt.ts 的第三份 formatTokens 一并收口?"
  const Q2 = "折旧入账是否同样过 MAX_TICK 钳制?"

  let dir = ""

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-resolve-runner-"))
  })

  afterEach(async () => {
    await flushStats(dir)
    await rm(dir, { recursive: true, force: true })
  })

  test("回落自动答复: 落 driver 台账(桶身份 + 会话 id)并打 ⚑ 两行,答复全文降为明细日志", async () => {
    // 轮号取目标目录推导值(docs/R-03 → 第 3 轮),阶段字母由 opts.phase 带入。
    await mkdir(join(dir, "docs", "R-03"), { recursive: true })
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield question(sid, "req_1", Q1)
          yield idle(sid)
        })(),
    })
    const lines = await captureLogs(() => runSession(client, task, "提示词", { dir, phase: "m" }, { pct: 100, used: 0, at: 0 }))
    const items = await resolvesOf(dir, "task", "T-001")
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      source: "driver",
      task: "T-001",
      phase: "m",
      round: 3,
      session: "ses_new_1",
      question: Q1,
    })
    expect(lines.some((l) => l.startsWith(`⚑ 自动代答(AUTO-RESOLVE)第 1 个: ${Q1}`))).toBe(true)
    expect(lines.some((l) => l.includes("要求会话以 AUTO-RESOLVE 标注决策"))).toBe(true)
    // 旧的 `→ 自动答复: <长文案>` 不再上终端(降为 vlog),但答复本身照发。
    expect(lines.some((l) => l.startsWith("→ 自动答复"))).toBe(false)
    expect(calls.replies).toHaveLength(1)
    expect(calls.replies[0]).toContain("AUTO-RESOLVE")
  })

  test("同一回合两个不同提问: 计数递增,台账两条(按轮号/阶段缺省入桶)", async () => {
    const { client } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield question(sid, "req_1", Q1)
          yield question(sid, "req_2", Q2)
          yield idle(sid)
        })(),
    })
    const lines = await captureLogs(() => runSession(client, task, "提示词", { dir }, { pct: 100, used: 0, at: 0 }))
    const items = await resolvesOf(dir, "task", "T-001")
    expect(items.map((item) => item.question)).toEqual([Q1, Q2])
    expect(items.every((item) => item.phase === "" && item.round === 1)).toBe(true)
    expect(lines.some((l) => l.startsWith("⚑ 自动代答(AUTO-RESOLVE)第 2 个"))).toBe(true)
  })

  test("重复提问阻塞(blocked 出口): 已代答的第 1 条不丢,第 2 次不重复落账", async () => {
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield question(sid, "req_1", Q1)
          yield question(sid, "req_2", Q1)
          yield idle(sid)
        })(),
    })
    const result = await captureLogs(async () => {
      const outcome = await runSession(client, task, "提示词", { dir }, { pct: 100, used: 0, at: 0 })
      expect(outcome.type).toBe("blocked")
    })
    expect(result.length).toBeGreaterThan(0)
    expect(calls.rejects).toEqual(["req_2"])
    expect(await resolvesOf(dir, "task", "T-001")).toHaveLength(1)
  })

  test("人工在 --wait-answer 内真答了: 不计代答(那是真人做的决定)", async () => {
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
        "提示词",
        { dir, waitAnswer: 5, interactive: fakeInteractive("按方案 A 做") },
        { pct: 100, used: 0, at: 0 },
      ),
    )
    expect(await resolvesOf(dir, "task", "T-001")).toEqual([])
    expect(lines.some((l) => l.startsWith("→ 人工答复: 按方案 A 做"))).toBe(true)
    expect(lines.some((l) => l.startsWith("⚑ 自动代答"))).toBe(false)
    expect(calls.replies[0]).toBe("按方案 A 做")
  })

  test("dryrun 预检会话: 自动答复照旧,但不计代答(预检只探查权限)", async () => {
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield question(sid, "req_1", Q1)
          yield idle(sid)
        })(),
    })
    const lines = await captureLogs(() => runSession(client, task, "提示词", { dir, dryrun: true }, { pct: 100, used: 0, at: 0 }))
    expect(await resolvesOf(dir, "task", "T-001")).toEqual([])
    expect(lines.some((l) => l.startsWith("→ 自动答复:"))).toBe(true)
    expect(calls.replies).toHaveLength(1)
  })

  test("autoAnswer 两档文案: 都点明被代答;off 要求标注 AUTO-RESOLVE,on 不提标注", () => {
    const off = autoAnswer(false)
    const on = autoAnswer(true)
    expect(off).toContain("这是一个被代答的提问")
    expect(on).toContain("这是一个被代答的提问")
    expect(off).toContain("AUTO-RESOLVE: <原问题> -> <所选方案> (<理由>)")
    expect(off).toContain("AUTO-DECISION")
    expect(on).not.toContain("AUTO-DECISION")
    expect(on).not.toContain("AUTO-RESOLVE")
  })

  test("H4 会话收尾扫描: --commit false 下照样采集(采集是审计,不受提交开关影响)", async () => {
    const proc = Bun.spawn(["git", "-C", dir, "init", "-q"], { stdout: "pipe", stderr: "pipe" })
    expect(await proc.exited).toBe(0)
    await mkdir(join(dir, "docs", "R-02"), { recursive: true })
    await Bun.write(
      join(dir, "report.md"),
      ["## 自动代答问题", "", "- AUTO-RESOLVE: 是否顺带收口 -> 顺带收口 (同层依赖)", "- AUTO-DECISION: 字段命名取 matched (与 schema 一致)", ""].join("\n"),
    )
    await afterSession(dir, { commit: false, phase: "t" }, { id: "T-001", title: "示例任务" }, { stage: "wrapup", subject: "T-001 wrapup 示例任务" })
    const items = await resolvesOf(dir, "task", "T-001")
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ source: "agent", phase: "t", round: 2, question: "是否顺带收口", file: "report.md:3" })
  })
})

// ---- 输出截断续跑(2026-09-18,kernel-spi-nor T-030 S13 现场): 末步 step-finish
// 以 length 收场 = 回复被输出上限截断,不作自然结束——steer「从截断处继续」让原会话
// 接着做;连续截断以 LENGTH_CONTINUE_MAX(3)为限,非 length 收场重置计数;观测到
// session.error 则不续跑(错误路径优先)。----

describe("输出截断续跑(步骤结束 length 不作自然结束)", () => {
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

  test("length 截断: steer 续跑一句(原会话接着做),下一回合 stop 正常结束", async () => {
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield stepFinish(sid, "pt_1", "length")
          yield idle(sid)
          // 续跑回合: 正常工作并以 stop 收场。
          yield stepFinish(sid, "pt_2", "stop")
          yield idle(sid)
        })(),
    })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain)
    expect(result.type).toBe("idle")
    // 续跑经 steer(promptAsync)进原会话: 不新建会话、不重发提示词。
    expect(calls.steers.length).toBe(1)
    expect(calls.steers[0]).toContain("截断")
    expect(calls.steers[0]).toContain("继续")
    expect(calls.creates).toBe(1)
    expect(calls.prompts.length).toBe(1)
  })

  test("连续截断超过 3 次: 不再续跑,按自然结束收口(交形检环处置)", async () => {
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
    const result = await runSession(client, task, "提示词", {}, chain)
    expect(result.type).toBe("idle")
    expect(calls.steers.length).toBe(3)
  })

  test("非 length 的步骤收场(续跑后恢复正常工作)重置连续截断计数", async () => {
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield stepFinish(sid, "pt_1", "length")
          yield idle(sid)
          // 续跑后恢复了正常工作(工具步)……
          yield stepFinish(sid, "pt_2", "tool-calls")
          // ……而后又一次截断: 计数已重置,仍续跑。
          yield stepFinish(sid, "pt_3", "length")
          yield idle(sid)
          yield stepFinish(sid, "pt_4", "stop")
          yield idle(sid)
        })(),
    })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain)
    expect(result.type).toBe("idle")
    expect(calls.steers.length).toBe(2)
  })

  test("已观测到 session.error: 截断不续跑,错误路径(重试阶梯)优先", async () => {
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
    // 直驱 attempt 取单次结果(runSession 会把故障带进重试环)。
    const result = await attempt(client, task, "提示词", {}, chain, undefined, undefined, parseSwitches({}))
    expect(result.type).toBe("blocked")
    expect((result as { question: string }).question).toContain("会话错误:")
    expect(calls.steers).toEqual([])
  })
})

// testHandoverAsked 是 watch 实例状态;收尾途中会话出错被 runSession 重试环 fork
// 续跑时新 attempt 建新 watch 实例——没有 resumeWrapup 播种,新实例会把收尾完成
// 误判为自然结束,交接循环就此丢失(定版脚本永不执行、交接文档永不归档)。

describe("测试交接: 定版 steer 投递成功即播种 resumeWrapup", () => {
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

  test("定版后旗标置位;新 watch 实例凭旗标在 idle 时校验交接文档而非判自然结束", async () => {
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
      subject: "T-001 exec 示例任务",
      label: "T-001",
      handovers: 0,
      startUsed: 0,
    }
    const { client } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield msg(sid, `${sid}_m1`)
          // 会话在回合内发起测试(attempt 开局会清掉遗留标记,须在此写入)。
          await writeFile(join(tmp, "test.sh"), "test/build.sh")
          yield { type: "session.idle", properties: { sessionID: sid } }
          // 定版 + 收尾 steer 已发生;会话收尾写出交接文档后再次 idle。
          await mkdir(dirname(handoffPath), { recursive: true })
          await writeFile(handoffPath, "# 交接\n\n状态: 继续\n")
          yield msg(sid, `${sid}_m2`)
          yield { type: "session.idle", properties: { sessionID: sid } }
        })(),
    })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await attempt(client, task, "提示词", { dir }, chain, undefined, testRun, parseSwitches({}))
    expect(result.type).toBe("idle")
    expect((result as { testHandover?: boolean }).testHandover).toBe(true)
    // 定版 steer 投递成功即播种(本修复断言): 重试环 fork 出的新实例凭此接续。
    expect(testRun.resumeWrapup).toBe(true)
    // 在途记录已在定版后落盘,待跑脚本为定版消费出的路径形态。
    const record = JSON.parse(await Bun.file(join(dir, ".auto", "handover.json")).text())
    expect(record.n).toBe(1)
    expect(record.script).toBe(join(dir, "test", "build.sh"))
    // 重试场景: 同一 TestRun 换新会话(标记已消费、文档已就绪)——新 watch 实例
    // 必须在 idle 时校验交接文档并判 testHandover,而不是当成自然结束丢掉交接。
    const { client: client2 } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield msg(sid, `${sid}_m1`)
          yield { type: "session.idle", properties: { sessionID: sid } }
        })(),
    })
    const chain2: SessionChain = { pct: 100, used: 0, at: 0 }
    const result2 = await attempt(client2, task, "提示词", { dir }, chain2, undefined, testRun, parseSwitches({}))
    expect(result2.type).toBe("idle")
    expect((result2 as { testHandover?: boolean }).testHandover).toBe(true)
  })
})
