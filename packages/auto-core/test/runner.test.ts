import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { load, parse } from "../src/plan"
import { ensureForkBase, forkSession, gatedAutoCorrectRefs, gatedTaskRefGap, handoffSteer, handoverDue, requireArtifact, runSession, seedForkSession, sessionUsage, type ForkBaseInfo, type SessionChain } from "../src/runner"
import { openStep, recallProgress, saveProgress } from "../src/resume"
import { parseSwitches, SWITCH_ENV } from "../src/switches"

// 交接 steer 构造与交接判定的纯函数单测(接线在 executeWhole/runSubtask;完整
// 流水线行为由 packages/auto 的 e2e 覆盖)。
const task = parse(
  "PLAN.md",
  `## T-001: 示例任务 [pending]
正文。
`,
).tasks[0]!

describe("handoffSteer / handoverDue(OPENCODE_AUTO_STEER 接线)", () => {
  const cap = 64_000

  test("steer=on: 构造 2×cap 交接 steer,提示文案指向交接文档", () => {
    const steer = handoffSteer(true, cap, task)!
    expect(steer).toBeDefined()
    expect(steer.limit).toBe(cap * 2)
    expect(steer.text).toContain("docs/T-001/handoff.md")
  })

  test("steer=off: 不构造交接 steer(会话中不注入交接提示)", () => {
    expect(handoffSteer(false, cap, task)).toBeUndefined()
  })

  test("steer=off: 会话自然完成即收——用量远超 2×cap 也不索要交接文档(交接判定停用)", () => {
    expect(handoverDue(undefined, cap * 10)).toBe(false)
  })

  test("steer=on: 用量达到 2×cap 才要求交接,阈值下自然完成", () => {
    const steer = handoffSteer(true, cap, task)!
    expect(handoverDue(steer, steer.limit)).toBe(true)
    expect(handoverDue(steer, steer.limit + 1)).toBe(true)
    expect(handoverDue(steer, steer.limit - 1)).toBe(false)
    expect(handoverDue(steer, 0)).toBe(false)
  })
})

// ---- fork 三段式流水线(fork-decompose 设计 §4.2/§4.3)----

// 立即结束的事件流: 只发一个属于 sessionID 的 idle 事件(watch 据此正常结算)。
async function* idleStream(sessionID: string) {
  yield { type: "session.idle", properties: { sessionID } }
}

// 最小 fake client(仅覆盖 runner 用到的表面;缺省行为 = 全部成功):
// calls 记录 fork/create 调用,updates 记录会话改名参数。
function fakeClient(
  over: {
    fork?: (sessionID: string) => unknown
    get?: (sessionID: string) => unknown
    prompt?: () => unknown
    messages?: (sessionID: string) => unknown
    // 事件流当前跟随的会话(未新建时的 idle 目标): 复用/恢复接管路径不调用
    // create,idle 事件须发给链上既有会话,否则 watch 收不到结束事件。
    current?: string
  } = {},
) {
  const calls = { forks: [] as string[], creates: 0, updates: [] as { id: string; title: string }[] }
  let seq = 0
  let lastCreated = over.current ?? "ses_new_0"
  const client = {
    session: {
      create: async () => {
        calls.creates++
        lastCreated = `ses_new_${++seq}`
        return { data: { id: lastCreated } }
      },
      fork: async (params: { sessionID: string }) => {
        calls.forks.push(params.sessionID)
        return over.fork ? over.fork(params.sessionID) : { data: { id: `ses_fork_${calls.forks.length}` } }
      },
      get: async (params: { sessionID: string }) => (over.get ? over.get(params.sessionID) : { data: { id: params.sessionID } }),
      update: async (params: { sessionID: string; title: string }) => {
        calls.updates.push({ id: params.sessionID, title: params.title })
        return {}
      },
      prompt: async () => (over.prompt ? over.prompt() : {}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
      messages: async (params: { sessionID: string }) => (over.messages ? over.messages(params.sessionID) : { data: [] }),
    },
    event: { subscribe: async () => ({ stream: idleStream(lastCreated) }) },
  } as unknown as OpencodeClient
  return { client, calls }
}

describe("forkSession(基点分叉与回退)", () => {
  test("成功: 返回新会话 id,并改名为本阶段标题", async () => {
    const { client, calls } = fakeClient({ fork: () => ({ data: { id: "ses_forked" } }) })
    expect(await forkSession(client, "ses_base", "T-001 S1 编写 schema")).toBe("ses_forked")
    expect(calls.forks).toEqual(["ses_base"])
    expect(calls.updates).toEqual([{ id: "ses_forked", title: "T-001 S1 编写 schema" }])
  })

  test("返回 error(外部旧版 --server 无 fork 路由等): log 后 undefined,不抛错", async () => {
    const { client } = fakeClient({ fork: () => ({ error: { name: "NotFoundError" } }) })
    expect(await forkSession(client, "ses_base", "T-001 S1 x")).toBeUndefined()
  })

  test("抛异常(网络断开等): 同样回退 undefined", async () => {
    const { client } = fakeClient({ fork: () => Promise.reject(new Error("fetch failed")) })
    expect(await forkSession(client, "ses_base", "T-001 S1 x")).toBeUndefined()
  })
})

describe("seedForkSession(阶段/子任务首个会话的播种)", () => {
  const base: ForkBaseInfo = { id: "ses_base", used: 500 }
  const opts = {}
  const makeChain = (over: Partial<SessionChain> = {}): SessionChain => ({ pct: 10, used: 100, at: Date.now(), id: "ses_prev", ...over })

  test("分叉成功: pending=分叉会话,种子链 pct=100/used=基点用量/at=0,返回 warm", async () => {
    const { client, calls } = fakeClient()
    const chain = makeChain()
    await expect(seedForkSession(client, opts, chain, base, "T-001 S1 x")).resolves.toBe(true)
    expect(chain).toMatchObject({ id: undefined, pending: "ses_fork_1", forkBase: "ses_base", pct: 100, used: 500, at: 0 })
    expect(calls.forks).toEqual(["ses_base"])
  })

  test("fork 失败: 重置链走全新会话(冷启动),warm=false", async () => {
    const { client } = fakeClient({ fork: () => ({ error: { name: "NotFound" } }) })
    const chain = makeChain()
    await expect(seedForkSession(client, opts, chain, base, "T-001 S1 x")).resolves.toBe(false)
    expect(chain).toMatchObject({ id: undefined, pending: undefined, pct: 100, used: 0, at: 0 })
  })

  test("基点用量达 cap/2: 不起 fork,直接重置为冷启动", async () => {
    const { client, calls } = fakeClient()
    const chain = makeChain()
    await expect(seedForkSession(client, opts, chain, { id: "ses_base", used: 32_000 }, "T-001 S1 x")).resolves.toBe(false)
    expect(calls.forks).toEqual([])
    expect(chain).toMatchObject({ id: undefined, pending: undefined, pct: 100, used: 0, at: 0 })
  })

  test("中断恢复复用会话(链上有会话且 note 待注入): 不分叉、链不动,warm=true", async () => {
    const { client, calls } = fakeClient()
    const chain = makeChain({ id: "ses_interrupted", note: "[driver] 中断后的继续" })
    await expect(seedForkSession(client, opts, chain, base, "T-001 S1 x")).resolves.toBe(true)
    expect(calls.forks).toEqual([])
    expect(chain.pending).toBeUndefined()
    expect(chain).toMatchObject({ id: "ses_interrupted", pct: 10, used: 100 })
  })

  test("无基点(fork=off/冷启动): 链与现状一致,不动", async () => {
    const { client, calls } = fakeClient()
    const chain = makeChain()
    await expect(seedForkSession(client, opts, chain, undefined, "T-001 S1 x")).resolves.toBe(false)
    expect(calls.forks).toEqual([])
    expect(chain).toMatchObject({ id: "ses_prev", pct: 10, used: 100 })
  })
})

describe("ensureForkBase(基点确立与回退链: digest → session → 冷启动)", () => {
  let dir: string
  let path: string
  const digest = parseSwitches({})
  const session = parseSwitches({ [SWITCH_ENV.forkBase]: "session" })
  const chain = { pct: 100, used: 0, at: 0 }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-fork-"))
    path = join(dir, "PLAN.md")
    await mkdir(join(dir, "docs"), { recursive: true })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function setupTask(withForkBase: boolean) {
    await Bun.write(path, `## T-001: 示例任务 [in_progress]\n${withForkBase ? "  - fork-base: ses_U\n" : ""}正文。\n`)
    return (await load(path)).tasks[0]!
  }

  test("digest 成功: 从 context.md 一次性链建基点会话,覆写 fork-base,返回基点", async () => {
    await Bun.write(join(dir, "docs", "T-001", "context.md"), "## 相关文件与关键符号\n- a.ts\n")
    const taskNoBase = await setupTask(false)
    const { client, calls } = fakeClient()
    const base = await ensureForkBase(client, await load(path), taskNoBase, {}, chain, digest)
    expect(base).toEqual({ id: "ses_new_1", used: 0 })
    // 一次性链建会话(标题即提交标题),不 fork、不改名(新建已命名)
    expect(calls.creates).toBe(1)
    expect(calls.forks).toEqual([])
    expect(calls.updates).toEqual([])
    // fork-base 覆写为新基点会话 id
    expect(await Bun.file(path).text()).toContain("  - fork-base: ses_new_1")
  })

  test("digest 读回落: 新路径缺失而旧平铺 docs/T-001.context.md 存在 → 同样建立基点", async () => {
    await Bun.write(join(dir, "docs", "T-001.context.md"), "## 相关文件与关键符号\n- a.ts\n")
    const taskNoBase = await setupTask(false)
    const { client } = fakeClient()
    const base = await ensureForkBase(client, await load(path), taskNoBase, {}, chain, digest)
    expect(base).toEqual({ id: "ses_new_1", used: 0 })
  })

  test("digest 基点会话失败(下发错误)→ 回退 session 基点: 校验存活并按 messages 重建用量", async () => {
    await Bun.write(join(dir, "docs", "T-001", "context.md"), "## 相关文件与关键符号\n- a.ts\n")
    const taskWithBase = await setupTask(true)
    const { client } = fakeClient({
      prompt: () => ({ error: { message: "boom" } }),
      messages: () => ({ data: [{ info: { role: "user" } }, { info: { role: "assistant", tokens: { input: 700, cache: { read: 300 } } } }] }),
    })
    const base = await ensureForkBase(client, await load(path), taskWithBase, {}, chain, digest)
    expect(base).toEqual({ id: "ses_U", used: 1000 })
    expect(await Bun.file(path).text()).toContain("  - fork-base: ses_U")
  })

  test("digest 摘要缺失 → 回退 session 基点", async () => {
    const taskWithBase = await setupTask(true)
    const { client } = fakeClient({ messages: () => ({ data: [] }) })
    const base = await ensureForkBase(client, await load(path), taskWithBase, {}, chain, digest)
    // session 基点存活但用量取不到 → 按 0
    expect(base).toEqual({ id: "ses_U", used: 0 })
  })

  test("session 模式基点失效(存储清理)→ 回退冷启动(undefined)", async () => {
    const taskWithBase = await setupTask(true)
    const { client } = fakeClient({ get: () => undefined })
    expect(await ensureForkBase(client, await load(path), taskWithBase, {}, chain, session)).toBeUndefined()
  })

  test("fork=off: 恒为 undefined(现状流水线)", async () => {
    const taskWithBase = await setupTask(true)
    const { client } = fakeClient()
    const off = parseSwitches({ [SWITCH_ENV.fork]: "off" })
    expect(await ensureForkBase(client, await load(path), taskWithBase, {}, chain, off)).toBeUndefined()
  })
})

// ---- SSE 订阅生命周期(attempt 会话结束即断流,根治长连接泄漏)----

// 带 signal 透传的 fake 订阅: 记录 subscribe 收到的 AbortSignal;事件流先发一个
// idle 事件(watch 据此正常结算),finally 记录收尾——真实 SDK 生成器在消费方
// break 时经 return() 走 finally(仅 releaseLock 不断连接),由 driver 显式 abort
// 关闭底层连接,本测试断言的正是"信号已透传且各退出路径必然 abort"。
function sseClient(
  id: string,
  over: { prompt?: () => unknown } = {},
) {
  const state = { signal: undefined as AbortSignal | undefined, closed: false }
  const client = {
    session: {
      create: async () => ({ data: { id } }),
      prompt: async () => (over.prompt ? over.prompt() : {}),
      abort: async () => ({}),
    },
    event: {
      subscribe: async (_params: unknown, options?: { signal?: AbortSignal }) => {
        state.signal = options?.signal
        const stream = async function* () {
          try {
            yield { type: "session.idle", properties: { sessionID: id } }
          } finally {
            state.closed = true
          }
        }
        return { stream: stream() }
      },
    },
  } as unknown as OpencodeClient
  return { client, state }
}

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
    const result = await runSession(client, task, "提示词", {}, { pct: 100, used: 0, at: 0 })
    expect(result.type).toBe("blocked")
    expect((result as { question: string }).question).toContain("下发任务失败")
    expect(state.signal?.aborted).toBe(true)
    expect(state.closed).toBe(true)
  })
})

// ---- 会话链复用(OPENCODE_AUTO_REUSE_SESSION,缺省 off)----

describe("会话链复用开关(OPENCODE_AUTO_REUSE_SESSION)", () => {
  const REUSE_OFF = parseSwitches({})
  const REUSE_ON = parseSwitches({ [SWITCH_ENV.reuseSession]: "on" })
  // 复用阈值(占比 <50%、已用 <cap/2、闲置 ≤5 分钟)全部满足的链。
  const reusable = (): SessionChain => ({ id: "ses_new_1", pct: 10, used: 100, at: Date.now() })

  test("off(缺省): 阈值全部满足也开新会话", async () => {
    const { client, calls } = fakeClient({ current: "ses_new_1" })
    const chain = reusable()
    expect((await runSession(client, task, "提示词", {}, chain, undefined, undefined, REUSE_OFF)).type).toBe("idle")
    expect(calls.creates).toBe(1)
  })

  test("on: 阈值满足即复用链上会话,不新建", async () => {
    const { client, calls } = fakeClient({ current: "ses_new_1" })
    const chain = reusable()
    expect((await runSession(client, task, "提示词", {}, chain, undefined, undefined, REUSE_ON)).type).toBe("idle")
    expect(calls.creates).toBe(0)
    expect(chain.id).toBe("ses_new_1")
  })

  test("中断恢复接管(链上有会话且 note 待注入): 开关 off、阈值全不满足也进原会话;说明用后即清", async () => {
    const { client, calls } = fakeClient({ current: "ses_interrupted" })
    const chain: SessionChain = {
      id: "ses_interrupted",
      pct: 80,
      used: 90_000,
      at: Date.now() - 10 * 60_000,
      note: "[driver] 中断后的继续",
    }
    expect((await runSession(client, task, "提示词", {}, chain, undefined, undefined, REUSE_OFF)).type).toBe("idle")
    expect(calls.creates).toBe(0)
    expect(chain.id).toBe("ses_interrupted")
    expect(chain.note).toBeUndefined()
    // 恢复说明已消费: 下一个提示词回归常规规则(off → 新会话)
    expect((await runSession(client, task, "下一个提示词", {}, chain, undefined, undefined, REUSE_OFF)).type).toBe("idle")
    expect(calls.creates).toBe(1)
  })
})

// ---- 会话错误重试(session-error-retry-plan.md)----

describe("会话错误重试: isRetryable 驱动的 fork-重试 / 直接阻塞", () => {
  // 构造一个只发 session.error(可选 isRetryable)+ session.idle 的事件流,喂给
  // fakeClient 同款的 subscribe——outcomes 按 create/fork 调用顺序逐个消费,
  // 决定该次新建/分叉出的会话本轮是否报错。
  type Outcome = "error-retryable" | "error-fatal" | "ok"
  // used: 与 outcomes 同序的"该次会话末端上下文用量",不给则为 0(纯报错桩)。
  // 经 message.updated 事件注入,与真实链路同一条计量路径(input + cache.read)。
  function retryClient(outcomes: Outcome[], used: number[] = []) {
    const calls = { forks: [] as string[], creates: 0 }
    const queue: unknown[] = []
    let index = 0
    let seq = 0
    const enqueue = (id: string) => {
      const tokens = used[index] ?? 0
      const outcome = outcomes[index++]
      if (tokens > 0) {
        queue.push({
          type: "message.updated",
          properties: {
            info: {
              id: `msg_${id}`,
              sessionID: id,
              role: "assistant",
              time: { completed: Date.now() },
              tokens: { input: tokens, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              providerID: "zai",
              modelID: "glm",
            },
          },
        })
      }
      if (outcome === "error-retryable" || outcome === "error-fatal") {
        queue.push({
          type: "session.error",
          properties: { sessionID: id, error: { name: "APIError", data: { message: "usage limit", isRetryable: outcome === "error-retryable" } } },
        })
      }
      queue.push({ type: "session.idle", properties: { sessionID: id } })
    }
    const client = {
      session: {
        create: async () => {
          calls.creates++
          const id = `ses_new_${++seq}`
          enqueue(id)
          return { data: { id } }
        },
        fork: async (params: { sessionID: string }) => {
          calls.forks.push(params.sessionID)
          const id = `ses_fork_${calls.forks.length}`
          enqueue(id)
          return { data: { id } }
        },
        update: async () => ({}),
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
        get: async (params: { sessionID: string }) => ({ data: { id: params.sessionID } }),
      },
      event: { subscribe: async () => ({ stream: (async function* () { while (queue.length) yield queue.shift() })() }) },
    } as unknown as OpencodeClient
    return { client, calls }
  }

  test("isRetryable:false: 不 fork、不换新会话重试,直接阻塞", async () => {
    const { client, calls } = retryClient(["error-fatal"])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain)
    expect(result.type).toBe("blocked")
    expect((result as { question: string }).question).toContain("会话错误:")
    expect((result as { retryable?: boolean }).retryable).toBe(false)
    expect(calls.creates).toBe(1)
    expect(calls.forks).toEqual([])
  })

  test("可重试错误 + chain.id 已有真实累计上下文: fork 原会话重试,成功即晋升为 chain.id", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"])
    const chain: SessionChain = { id: "ses_real", pct: 10, used: 5000, at: Date.now() }
    const result = await runSession(client, task, "提示词", {}, chain)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_real"])
    expect(calls.creates).toBe(1)
    expect(chain.id).toBe("ses_fork_1")
  })

  test("fork 副本重试仍失败: 丢弃副本,从同一个原会话重新 fork(不是对失败副本再 fork)", async () => {
    const { client, calls } = retryClient(["error-retryable", "error-retryable", "ok"])
    const chain: SessionChain = { id: "ses_real", pct: 10, used: 5000, at: Date.now() }
    const result = await runSession(client, task, "提示词", {}, chain)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_real", "ses_real"])
    expect(chain.id).toBe("ses_fork_2")
  })

  test("chain.id 本为空(首条消息即失败): 无值得保护的内容,维持现状开空白新会话", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual([])
    expect(calls.creates).toBe(2)
  })

  // ---- 保住最值钱的会话(provider-timeout-analysis-20260912.md §8.4)----

  test("chain.id 为空但失败会话已积累上下文(子任务形态): 分叉失败会话本体,不开空白会话", async () => {
    // 子任务只有一个提示词回合,失败那一刻链上必然无会话——老策略在此开空白
    // 新会话,把会话里已核实的研究成果整份扔掉,重开后在同一点再撞墙。
    const { client, calls } = retryClient(["error-retryable", "ok"], [168_000])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_new_1"])
    expect(calls.creates).toBe(1)
    expect(chain.id).toBe("ses_fork_1")
  })

  test("失败会话用量高于链上原会话: 取失败会话(价值 = 已积累上下文)", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"], [50_000])
    const chain: SessionChain = { id: "ses_real", pct: 10, used: 5000, at: Date.now() }
    const result = await runSession(client, task, "提示词", {}, chain)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_new_1"])
  })

  test("副本承接失败会话的前缀用量(2×cap 交接阈值按前缀 + 新增计算)", async () => {
    // 三次全失败 → 耗尽阻塞;链上留下的 used 即重试时播种进副本的前缀值
    // (attempt() 的可重试分支把 used 还原为本轮下发前快照,即播种值)。
    const { client } = retryClient(["error-retryable", "error-retryable", "error-retryable"], [50_000])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain)
    expect(result.type).toBe("blocked")
    expect(chain.used).toBe(50_000)
  })

  test("失败会话用量低于链上原会话: 仍取原会话(刚失败不等于更值钱)", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"], [800])
    const chain: SessionChain = { id: "ses_real", pct: 10, used: 5000, at: Date.now() }
    const result = await runSession(client, task, "提示词", {}, chain)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_real"])
  })

  test("链上无会话可分叉但基点存活: 从基点重新播种,赚回暖前缀而非纯冷启动", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"])
    const chain: SessionChain = { pct: 100, used: 0, at: 0, forkBase: "ses_base" }
    const result = await runSession(client, task, "提示词", {}, chain)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_base"])
    expect(calls.creates).toBe(1)
    expect(chain.forkBase).toBe("ses_base")
  })

  test("失败会话为纯报错桩(用量 0)且无基点: 维持空白新会话,不把报错桩背进副本", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "提示词", {}, chain)
    expect(calls.forks).toEqual([])
  })

  test("重试成功后 chain.failed 清空,不残留到下一轮", async () => {
    const { client } = retryClient(["error-retryable", "ok"], [9000])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "提示词", {}, chain)
    expect(chain.failed).toBeUndefined()
  })

  test("可重试的中间失败态不落盘 progress.json,不顶替之前的真实记录", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-remember-"))
    try {
      const real: Awaited<ReturnType<typeof recallProgress>> = { task: "T-001", session: "ses_real_old", at: 1, active: true, phase: { kind: "understand" } }
      await saveProgress(dir, real!)
      // RETRIES=3: 三次尝试全部可重试失败,耗尽后阻塞——全程不应落盘。
      const { client } = retryClient(["error-retryable", "error-retryable", "error-retryable"])
      const chain: SessionChain = { pct: 100, used: 0, at: 0, phase: { kind: "understand" } }
      const result = await runSession(client, task, "提示词", { dir }, chain)
      expect(result.type).toBe("blocked")
      expect(await recallProgress(dir, "T-001")).toEqual(real)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("不可重试的阻塞: 属于'非可重试会话错误的终态',正常落盘 progress.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-remember-fatal-"))
    try {
      const { client } = retryClient(["error-fatal"])
      const chain: SessionChain = { pct: 100, used: 0, at: 0, phase: { kind: "understand" } }
      const result = await runSession(client, task, "提示词", { dir }, chain)
      expect(result.type).toBe("blocked")
      expect((await recallProgress(dir, "T-001"))?.session).toBe("ses_new_1")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ---- 会话末端用量重建与"报错桩"判据(sessionUsage: 跨进程恢复是否复用旧会话的依据)----

describe("sessionUsage(恢复复用判据)", () => {
  // server 的 messages 按创建序(旧→新)返回;runner 只读 info 的 role/tokens/error
  // 与 providerID/modelID(查上下文上限)。
  const user = { info: { role: "user" } }
  const asst = (input: number, cacheRead: number, error?: unknown) => ({
    info: {
      role: "assistant",
      providerID: "kimi",
      modelID: "k2",
      tokens: { input, cache: { read: cacheRead } },
      ...(error ? { error } : {}),
    },
  })
  const limit = 262_100
  const client = (messages: unknown[] | { error: unknown }) =>
    ({
      session: {
        messages: async () => (Array.isArray(messages) ? { data: messages } : messages),
      },
      provider: { list: async () => ({ data: { all: [{ id: "kimi", models: { k2: { limit: { context: limit } } } }] } }) },
    }) as unknown as OpencodeClient

  test("末条是 0-token 报错桩、此前有真实产出: 用量取真实末端,不判为报错桩(T-063 现场)", async () => {
    // 第 1–4 点刻意把这个会话留在 progress.json 里:跑了很多活,最后一轮撞 isRetryable:false
    // 的账号级限流——服务端为此追加了 tokens 全 0 的报错行。
    const usage = await sessionUsage(
      client([user, asst(3981, 8448), asst(1416, 107776), asst(0, 0, { name: "APIError" })]),
      "ses_real",
    )
    expect(usage.used).toBe(109192)
    expect(usage.pct).toBe(42)
    expect(usage.errorStub).toBe(false)
  })

  test("整条会话只有报错桩(旧'重试即换白板会话'遗留形态): 判为报错桩,恢复时开新会话", async () => {
    const usage = await sessionUsage(client([user, asst(0, 0, { name: "APIError" })]), "ses_stub")
    expect(usage.used).toBe(0)
    expect(usage.errorStub).toBe(true)
  })

  test("末条是被中断的 0-token 残行(无 error,kill/崩溃场景): 用量取更早的真实轮次", async () => {
    const usage = await sessionUsage(client([user, asst(2675, 62720), asst(0, 0)]), "ses_killed")
    expect(usage.used).toBe(65395)
    expect(usage.errorStub).toBe(false)
  })

  test("末条错误行自带真实 tokens(step-finish 后才判定,如输出超限): 直接以它为基准", async () => {
    const usage = await sessionUsage(client([user, asst(1000, 5000), asst(2000, 60000, { name: "MessageOutputLengthError" })]), "ses_partial")
    expect(usage.used).toBe(62000)
    expect(usage.errorStub).toBe(false)
  })

  test("尚无任何 assistant 消息: used 0、上限未知口径不变,不判为报错桩(空会话第一轮照常复用)", async () => {
    const usage = await sessionUsage(client([user]), "ses_fresh")
    expect(usage).toEqual({ used: 0, pct: 100, errorStub: false })
  })

  test("messages 拉取失败或返回 error: 退化为用量 0 且不判报错桩(不因查询故障牺牲会话)", async () => {
    expect(await sessionUsage(client({ error: { name: "UnknownError" } }), "ses_x")).toEqual({ used: 0, pct: 100, errorStub: false })
    const broken = { session: { messages: async () => { throw new Error("fetch failed") } } } as unknown as OpencodeClient
    expect(await sessionUsage(broken, "ses_x")).toEqual({ used: 0, pct: 100, errorStub: false })
  })
})

// ---- refcheck 挂点门禁(refcheck-scope-design D3,OPENCODE_AUTO_REF_CHECK 缺省 off)----

async function git(dir: string, ...args: string[]) {
  const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`git ${args.join(" ")} 退出码 ${code}: ${err || out}`)
  return out
}

async function freshRepo() {
  const dir = await mkdtemp(join(tmpdir(), "auto-runner-"))
  await git(dir, "init", "-q")
  await git(dir, "config", "user.email", "t@t")
  await git(dir, "config", "user.name", "t")
  return dir
}

describe("gatedAutoCorrectRefs / gatedTaskRefGap(OPENCODE_AUTO_REF_CHECK 挂点门禁)", () => {
  test("off(缺省): 提交前 auto-correct 与 verify 门禁预扫空转,目标目录零引用检查行为", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, "src/old.ts"), "code\n")
      await Bun.write(join(dir, "docs/T-001/report.md"), "见 `src/old.ts` 与 `docs/gone.md`。\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      // 提交前发生移动(rename 配对可得),但 off 时不得改写
      await Bun.spawn(["mv", join(dir, "src/old.ts"), join(dir, "src/new.ts")]).exited
      const before = await Bun.file(join(dir, "docs/T-001/report.md")).text()
      await gatedAutoCorrectRefs(dir, false)
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe(before)
      // 不扫失效引用、不产生失效清单
      expect(await Bun.file(join(dir, ".auto/invalid-refs.md")).exists()).toBe(false)
      // verify 门禁预扫空转: 无差距(门禁不存在)
      expect(await gatedTaskRefGap(dir, "T-001", false)).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("on: auto-correct 按 rename 配对改写并落失效清单;verify 门禁产出差距文案", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, "src/old.ts"), "code\n")
      await Bun.write(join(dir, "docs/T-001/report.md"), "见 `src/old.ts` 与 `docs/gone.md`。\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      await Bun.spawn(["mv", join(dir, "src/old.ts"), join(dir, "src/new.ts")]).exited
      await gatedAutoCorrectRefs(dir, true)
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe("见 `src/new.ts` 与 `docs/gone.md`。\n")
      expect(await Bun.file(join(dir, ".auto/invalid-refs.md")).exists()).toBe(true)
      const gap = await gatedTaskRefGap(dir, "T-001", true)
      expect(gap).toContain("任务产物文档存在失效引用")
      expect(gap).toContain("docs/gone.md")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ---- 阶段步骤恢复点(requireArtifact spec.step: 会话恢复优先于文件推导)----

describe("requireArtifact 阶段步骤恢复(spec.step)", () => {
  // 专用 fake client: 记录 create 次数与每个 prompt 的目标会话;messages 返回一条
  // 真实 assistant 轮次(tokens>0)使 sessionUsage 判为可复用、非报错桩;事件流对
  // "当前会话"(新建则随之更新,复用则保持)发一个 idle 让 watch 正常结算。
  function artifactClient(current?: string) {
    const state = { creates: 0, prompts: [] as string[], current }
    const client = {
      session: {
        create: async () => {
          state.creates++
          state.current = `ses_new_${state.creates}`
          return { data: { id: state.current } }
        },
        fork: async () => ({ data: { id: "ses_fork" } }),
        get: async (params: { sessionID: string }) => ({ data: { id: params.sessionID } }),
        update: async () => ({}),
        prompt: async (params: { sessionID: string }) => {
          state.prompts.push(params.sessionID)
          return {}
        },
        promptAsync: async () => ({}),
        abort: async () => ({}),
        messages: async () => ({
          data: [
            { info: { role: "user" } },
            { info: { role: "assistant", providerID: "kimi", modelID: "k2", tokens: { input: 5000, output: 200, reasoning: 0, cache: { read: 1000, write: 0 } } } },
          ],
        }),
      },
      provider: { list: async () => ({ data: { all: [] } }) },
      event: {
        subscribe: async () => ({
          stream: (async function* () {
            yield { type: "session.idle", properties: { sessionID: state.current } }
          })(),
        }),
      },
    } as unknown as OpencodeClient
    return { client, state }
  }

  const planTask = { id: "PLAN", title: "阶段规划(m 迁移实现)", status: "in_progress" as const, attempts: 0, body: "" }
  const spec = (reset: () => void) => ({
    kind: "阶段规划",
    step: { step: "phase-plan" as const, letter: "m" as const },
    artifact: "已填充的 PLAN.md",
    requirement: "写入 PLAN.md",
    reset: async () => {
      reset()
    },
    collect: async () => 4,
  })

  test("未收口 step 记录 + 会话存活: 复用原会话、不重置产物、提示词进原会话", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-step-resume-"))
    try {
      await saveProgress(dir, { task: "PLAN", session: "ses_plan_old", at: 1, active: true, phase: { kind: "step", step: "phase-plan", letter: "m" } })
      const { client, state } = artifactClient("ses_plan_old")
      let resetCalled = false
      const value = await requireArtifact(client, planTask, "规划提示词", { dir }, spec(() => (resetCalled = true)))
      expect(value).toBe(4)
      expect(resetCalled).toBe(false) // 复用会话 → 保留产物现场,不重置
      expect(state.creates).toBe(0) // 复用,不新建
      expect(state.prompts).toEqual(["ses_plan_old"]) // 提示词进原会话
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("无 step 记录(全新步骤): 重置产物、开新会话,且下发即写 active 恢复点", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-step-fresh-"))
    try {
      const { client, state } = artifactClient()
      let resetCalled = false
      const value = await requireArtifact(client, planTask, "规划提示词", { dir }, spec(() => (resetCalled = true)))
      expect(value).toBe(4)
      expect(resetCalled).toBe(true)
      expect(state.creates).toBe(1)
      // 伪任务 PLAN 携带 step 阶段 → 下发成功即落盘(此前 T- 门控会漏掉旁路会话)
      const rec = await recallProgress(dir, "PLAN")
      expect(rec?.active).toBe(true)
      expect(rec?.session).toBe("ses_new_1")
      expect(rec?.phase).toEqual({ kind: "step", step: "phase-plan", letter: "m" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("step 记录存在但会话已死(get 失败): 不复用,重置并开新会话", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-step-dead-"))
    try {
      await saveProgress(dir, { task: "PLAN", session: "ses_dead", at: 1, active: true, phase: { kind: "step", step: "phase-plan", letter: "m" } })
      const { client, state } = artifactClient("ses_dead")
      ;(client as unknown as { session: { get: unknown } }).session.get = async () => ({ error: { name: "NotFound" } })
      let resetCalled = false
      const value = await requireArtifact(client, planTask, "规划提示词", { dir }, spec(() => (resetCalled = true)))
      expect(value).toBe(4)
      expect(resetCalled).toBe(true) // 会话不可复用 → 重置重做
      expect(state.creates).toBe(1)
      expect(state.prompts).toEqual(["ses_new_1"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("可重试错误耗尽: 步骤恢复点不被删除(还原为 session 未定的初始认领),下次运行仍重入本步骤", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-step-retry-"))
    try {
      // 每次会话都以可重试错误结束 → runSession 重试 RETRIES 次后阻塞。
      const queue: unknown[] = []
      let seq = 0
      const enqueue = (id: string) => {
        queue.push({ type: "session.error", properties: { sessionID: id, error: { name: "APIError", data: { message: "net", isRetryable: true } } } })
        queue.push({ type: "session.idle", properties: { sessionID: id } })
      }
      const client = {
        session: {
          create: async () => {
            const id = `ses_new_${++seq}`
            enqueue(id)
            return { data: { id } }
          },
          fork: async () => {
            const id = `ses_fork_${++seq}`
            enqueue(id)
            return { data: { id } }
          },
          get: async (params: { sessionID: string }) => ({ data: { id: params.sessionID } }),
          update: async () => ({}),
          prompt: async () => ({}),
          promptAsync: async () => ({}),
          abort: async () => ({}),
          messages: async () => ({ data: [] }),
        },
        provider: { list: async () => ({ data: { all: [] } }) },
        event: { subscribe: async () => ({ stream: (async function* () { while (queue.length) yield queue.shift() })() }) },
      } as unknown as OpencodeClient
      const result = await requireArtifact(client, planTask, "规划提示词", { dir }, spec(() => {}))
      expect((result as { type: string }).type).toBe("blocked")
      // 关键: 可重试错误把记录还原为下发前快照(requireArtifact 进入时写的初始恢复点,
      // session 未定),而非删除——步骤认领保留,下次运行 openStep 命中即重入规划,
      // 不会凭半成品 PLAN.md(AI 写的文件)跳过本步骤。
      const open = await openStep(dir)
      expect(open?.step).toBe("phase-plan")
      expect(open?.letter).toBe("m")
      expect(open?.session).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
