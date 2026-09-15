import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { clearSticky, consumeFailback, requestFailback, resetFailback, stickyModel } from "../src/failback"
import { changedFiles, commitTree, unitBaseline } from "../src/git"
import { load, parse } from "../src/plan"
import type { Interactive } from "../src/interactive"
import { afterSession, askHuman, autoAnswer, classifySessionError, cleanTestHandoffs, seedPinFork, ensureForkBase, forkSession, gatedAutoCorrectRefs, gatedTaskRefGap, handoffSteer, handoverDue, phaseText, phaseToRole, requireArtifact, resolveModel, restoreTestHandoffs, resumeNote, resolveTestScript, retryDecision, roleOf, runSession, seedForkSession, sessionUsage, splitModel, testHandoverDue, unitReruns, type ForkBaseInfo, type SessionChain, type UnitRerunCtx } from "../src/runner"
import { openStep, recallProgress, saveProgress, type Phase } from "../src/resume"
import { saveHandover } from "../src/handover"
import { resolvesOf } from "../src/resolve"
import { flushStats, loadStats, setStatsClock, statsSessionBegin, statsSessionEnd, statsTotals } from "../src/stats"
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
    // 自定义事件流(缺省为单 idle 正常结束流):收当前会话 id,便于测试发定向事件;
    // () => AsyncIterable 亦可(参数少者可赋给参数多者)。
    events?: (sessionID: string) => AsyncIterable<unknown>
  } = {},
) {
  const calls = {
    forks: [] as string[],
    creates: 0,
    updates: [] as { id: string; title: string }[],
    // 记录每次 prompt 下发参数,供模型路由断言(model 缺省时该属性不存在)。
    prompts: [] as { sessionID: string; agent?: string; model?: { providerID: string; modelID: string }; parts: unknown[] }[],
    // 记录 session.abort 调用的会话 id,供提前结算/断流清理断言(D.2 降级前必 abort)。
    aborts: [] as string[],
    // 提问答复/驳回(auto-resolve T-005): replies 记每次答复文案,rejects 记驳回的
    // requestID(重复提问走驳回 + abort)。
    replies: [] as string[],
    rejects: [] as string[],
    // 每次 fork 传入的分叉锚点(undefined = 整份分叉),供定版点分叉断言。
    forkAnchors: [] as (string | undefined)[],
  }
  let seq = 0
  let lastCreated = over.current ?? "ses_new_0"
  const client = {
    session: {
      create: async () => {
        calls.creates++
        lastCreated = `ses_new_${++seq}`
        return { data: { id: lastCreated } }
      },
      fork: async (params: { sessionID: string; messageID?: string }) => {
        calls.forks.push(params.sessionID)
        calls.forkAnchors.push(params.messageID)
        const result = over.fork ? over.fork(params.sessionID) : { data: { id: `ses_fork_${calls.forks.length}` } }
        // fork 出的副本是后续 prompt 的下发目标,事件流跟随它(与 create 同规则)。
        const id = (result as { data?: { id?: string } }).data?.id
        if (id) lastCreated = id
        return result
      },
      get: async (params: { sessionID: string }) => (over.get ? over.get(params.sessionID) : { data: { id: params.sessionID } }),
      update: async (params: { sessionID: string; title: string }) => {
        calls.updates.push({ id: params.sessionID, title: params.title })
        return {}
      },
      prompt: async (
        params: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string }; parts: unknown[] },
      ) => {
        calls.prompts.push(params)
        return over.prompt ? over.prompt() : {}
      },
      promptAsync: async () => ({}),
      abort: async (params?: { sessionID: string }) => {
        if (params?.sessionID) calls.aborts.push(params.sessionID)
        return {}
      },
      messages: async (params: { sessionID: string }) => (over.messages ? over.messages(params.sessionID) : { data: [] }),
    },
    question: {
      reply: async (params: { requestID: string; answers: string[][] }) => {
        calls.replies.push(params.answers.flat().join(""))
        return {}
      },
      reject: async (params: { requestID: string }) => {
        calls.rejects.push(params.requestID)
        return {}
      },
    },
    event: { subscribe: async () => ({ stream: over.events ? over.events(lastCreated) : idleStream(lastCreated) }) },
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

// 构造一个只发 session.error(可选 isRetryable)+ session.idle 的事件流,喂给
// fakeClient 同款的 subscribe——outcomes 按 create/fork 调用顺序逐个消费,
// 决定该次新建/分叉出的会话本轮是否报错。
type Outcome = "error-retryable" | "error-fatal" | "ok"
// used: 与 outcomes 同序的"该次会话末端上下文用量"(给数字则每次会话同额),不给则为
// 0(纯报错桩)。
// 经 message.updated 事件注入,与真实链路同一条计量路径(input + cache.read)。
// message: 报错文案,决定 classifySessionError 的归类 —— 缺省 "usage limit" 落 quota
// (配额支的既有用例据此),传 transient/unknown 文案则走重试阶梯。
function retryClient(outcomes: Outcome[], used: number[] | number = [], message = "usage limit") {
  // prompts 记每次下发参数(model 缺省时该属性不存在),供模型路由/降级断言。
  const calls = { forks: [] as string[], creates: 0, prompts: [] as { sessionID: string; model?: { providerID: string; modelID: string }; parts: unknown[] }[] }
  const queue: unknown[] = []
  let index = 0
  let seq = 0
  const enqueue = (id: string) => {
    const tokens = typeof used === "number" ? used : (used[index] ?? 0)
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
        properties: { sessionID: id, error: { name: "APIError", data: { message, isRetryable: outcome === "error-retryable" } } },
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
      prompt: async (params: { sessionID: string; model?: { providerID: string; modelID: string }; parts: unknown[] }) => {
        calls.prompts.push(params)
        return {}
      },
      promptAsync: async () => ({}),
      abort: async () => ({}),
      messages: async () => ({ data: [] }),
      get: async (params: { sessionID: string }) => ({ data: { id: params.sessionID } }),
    },
    event: { subscribe: async () => ({ stream: (async function* () { while (queue.length) yield queue.shift() })() }) },
  } as unknown as OpencodeClient
  return { client, calls }
}

describe("会话错误重试: isRetryable 驱动的 fork-重试 / 直接阻塞", () => {
  // 阶梯夹具: 两次重试、零等待 —— 次数与改造前的 RETRIES=3(共三次尝试)一致,
  // 使既有用例的报错条数与断言逐字节沿用;retryAsk=0 关掉人工等待(无人值守形态)。
  const NO_WAIT = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0", [SWITCH_ENV.retryAsk]: "0" })
  test("isRetryable:false: 不 fork、不换新会话重试,直接阻塞", async () => {
    const { client, calls } = retryClient(["error-fatal"])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("blocked")
    expect((result as { question: string }).question).toContain("会话错误:")
    expect((result as { retryable?: boolean }).retryable).toBe(false)
    expect(calls.creates).toBe(1)
    expect(calls.forks).toEqual([])
  })

  test("可重试错误 + chain.id 已有真实累计上下文: fork 原会话重试,成功即晋升为 chain.id", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"])
    const chain: SessionChain = { id: "ses_real", pct: 10, used: 5000, at: Date.now() }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_real"])
    expect(calls.creates).toBe(1)
    expect(chain.id).toBe("ses_fork_1")
  })

  test("fork 副本重试仍失败: 丢弃副本,从同一个原会话重新 fork(不是对失败副本再 fork)", async () => {
    const { client, calls } = retryClient(["error-retryable", "error-retryable", "ok"])
    const chain: SessionChain = { id: "ses_real", pct: 10, used: 5000, at: Date.now() }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_real", "ses_real"])
    expect(chain.id).toBe("ses_fork_2")
  })

  test("chain.id 本为空(首条消息即失败): 无值得保护的内容,维持现状开空白新会话", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
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
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_new_1"])
    expect(calls.creates).toBe(1)
    expect(chain.id).toBe("ses_fork_1")
  })

  test("失败会话用量高于链上原会话: 取失败会话(价值 = 已积累上下文)", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"], [50_000])
    const chain: SessionChain = { id: "ses_real", pct: 10, used: 5000, at: Date.now() }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_new_1"])
  })

  test("副本承接失败会话的前缀用量(2×cap 交接阈值按前缀 + 新增计算)", async () => {
    // 三次全失败 → 耗尽阻塞;链上留下的 used 即重试时播种进副本的前缀值
    // (attempt() 的可重试分支把 used 还原为本轮下发前快照,即播种值)。
    const { client } = retryClient(["error-retryable", "error-retryable", "error-retryable"], [50_000])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("blocked")
    expect(chain.used).toBe(50_000)
  })

  test("失败会话用量低于链上原会话: 仍取原会话(刚失败不等于更值钱)", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"], [800])
    const chain: SessionChain = { id: "ses_real", pct: 10, used: 5000, at: Date.now() }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_real"])
  })

  test("链上无会话可分叉但基点存活: 从基点重新播种,赚回暖前缀而非纯冷启动", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"])
    const chain: SessionChain = { pct: 100, used: 0, at: 0, forkBase: "ses_base" }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_base"])
    expect(calls.creates).toBe(1)
    expect(chain.forkBase).toBe("ses_base")
  })

  test("失败会话为纯报错桩(用量 0)且无基点: 维持空白新会话,不把报错桩背进副本", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(calls.forks).toEqual([])
  })

  test("重试成功后 chain.failed 清空,不残留到下一轮", async () => {
    const { client } = retryClient(["error-retryable", "ok"], [9000])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_WAIT)
    expect(chain.failed).toBeUndefined()
  })

  // ---- 重试阶梯与人工裁决(provider-timeout-analysis-20260912.md §8.4)----

  // 只答固定几句的人工输入行(--interactive 形态);答完即回落 undefined。
  const answering = (answers: (string | undefined)[]): Interactive => ({
    attach() {},
    question: async () => answers.shift(),
    close() {},
  })

  test("阶梯次数由 waits 的元素个数决定,不再是写死的 RETRIES", async () => {
    // 0,0,0 = 三次重试 → 连同首次共四次尝试,第四次仍失败才阻塞。
    const three = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0,0", [SWITCH_ENV.retryAsk]: "0" })
    const { client, calls } = retryClient(["error-retryable", "error-retryable", "error-retryable", "ok"])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, three)
    expect(result.type).toBe("idle")
    expect(calls.creates).toBe(4)
  })

  test("退避真的等待: waits 的分钟数落到实际睡眠上", async () => {
    // 0.002 分钟 = 120ms,足以与零等待区分又不拖慢测试。
    const slow = parseSwitches({ [SWITCH_ENV.retryWaits]: "0.002", [SWITCH_ENV.retryAsk]: "0" })
    const { client } = retryClient(["error-retryable", "ok"])
    const began = Date.now()
    const result = await runSession(client, task, "提示词", {}, { pct: 100, used: 0, at: 0 }, undefined, undefined, slow)
    expect(result.type).toBe("idle")
    expect(Date.now() - began).toBeGreaterThanOrEqual(100)
  })

  test("阶梯耗尽 + 人工答继续: 阶梯从头再走一轮,不退出", async () => {
    const ask = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0", [SWITCH_ENV.retryAsk]: "1" })
    const { client, calls } = retryClient(["error-retryable", "error-retryable", "error-retryable", "ok"])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", { interactive: answering(["继续"]) }, chain, undefined, undefined, ask)
    expect(result.type).toBe("idle")
    // 三次尝试用尽 → 问人工 → 继续 → 第四次成功。
    expect(calls.creates).toBe(4)
  })

  test("阶梯耗尽 + 人工答退出: 立即阻塞,文案标明是人工决定", async () => {
    const ask = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0", [SWITCH_ENV.retryAsk]: "1" })
    const { client } = retryClient(["error-retryable", "error-retryable", "error-retryable", "ok"])
    const result = await runSession(client, task, "提示词", { interactive: answering(["exit"]) }, { pct: 100, used: 0, at: 0 }, undefined, undefined, ask)
    expect(result.type).toBe("blocked")
    expect((result as { question: string }).question).toContain("人工选择退出")
  })

  test("阶梯耗尽 + 无人应答: 按回落阻塞(无人值守跑批不会卡死)", async () => {
    const ask = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0", [SWITCH_ENV.retryAsk]: "1" })
    const { client } = retryClient(["error-retryable", "error-retryable", "error-retryable", "ok"])
    const result = await runSession(client, task, "提示词", { interactive: answering([undefined]) }, { pct: 100, used: 0, at: 0 }, undefined, undefined, ask)
    expect(result.type).toBe("blocked")
    expect((result as { question: string }).question).toContain("人工未裁决")
  })

  test("retryAsk=0: 不等人工,耗尽即阻塞(文案不提人工)", async () => {
    const { client } = retryClient(["error-retryable", "error-retryable", "error-retryable"])
    const result = await runSession(client, task, "提示词", {}, { pct: 100, used: 0, at: 0 }, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("blocked")
    expect((result as { question: string }).question).toContain("自动重试 2 次仍失败")
    expect((result as { question: string }).question).not.toContain("人工")
  })

  test("waits=off: 首次失败即进人工裁决,不自动重试", async () => {
    const none = parseSwitches({ [SWITCH_ENV.retryWaits]: "off", [SWITCH_ENV.retryAsk]: "1" })
    const { client, calls } = retryClient(["error-retryable", "ok"])
    const result = await runSession(client, task, "提示词", { interactive: answering(["继续"]) }, { pct: 100, used: 0, at: 0 }, undefined, undefined, none)
    expect(result.type).toBe("idle")
    expect(calls.creates).toBe(2)
  })

  test("retryDecision: 继续/退出词表与回落归一", () => {
    for (const yes of ["c", "continue", "retry", "y", "YES", " 继续 ", "重试"]) expect(retryDecision(yes)).toBe("continue")
    for (const no of ["q", "quit", "exit", "stop", "n", "NO", "退出", "停"]) expect(retryDecision(no)).toBe("exit")
    for (const other of [undefined, "", "   ", "嗯", "maybe"]) expect(retryDecision(other)).toBe("fallback")
  })

  test("可重试的中间失败态不落盘 progress.json,不顶替之前的真实记录", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-remember-"))
    try {
      const real: Awaited<ReturnType<typeof recallProgress>> = { task: "T-001", session: "ses_real_old", at: 1, active: true, phase: { kind: "understand" } }
      await saveProgress(dir, real!)
      // 阶梯 0,0: 三次尝试全部可重试失败,耗尽后阻塞——全程不应落盘。
      const { client } = retryClient(["error-retryable", "error-retryable", "error-retryable"])
      const chain: SessionChain = { pct: 100, used: 0, at: 0, phase: { kind: "understand" } }
      const result = await runSession(client, task, "提示词", { dir }, chain, undefined, undefined, NO_WAIT)
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
      const result = await runSession(client, task, "提示词", { dir }, chain, undefined, undefined, NO_WAIT)
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
  // 零等待阶梯: 本块只验恢复点语义,不该被重试退避拖成分钟级。
  const STEP_NO_WAIT = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0", [SWITCH_ENV.retryAsk]: "0" })
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
      // 每次会话都以可重试错误结束 → runSession 走完阶梯后阻塞。
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
      const result = await requireArtifact(client, planTask, "规划提示词", { dir }, spec(() => {}), STEP_NO_WAIT)
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

// ---- requireArtifact 独立单元门禁(spec.unitStart,commit-boundary-design.md)----

describe("requireArtifact 独立单元门禁(spec.unitStart)", () => {
  // 复用 step 恢复块的 fake client 形态: 单会话 + idle 结算,记录 create/prompt;
  // produce 使会话回合内落一个文件(模拟 AI 写产物,供统一提交有物可提)。
  function unitClient(produce?: () => Promise<void>) {
    const state = { creates: 0, prompts: [] as string[] }
    const client = {
      session: {
        create: async () => {
          state.creates++
          return { data: { id: `ses_new_${state.creates}` } }
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
        messages: async () => ({ data: [{ info: { role: "user" } }] }),
      },
      provider: { list: async () => ({ data: { all: [] } }) },
      event: {
        subscribe: async () => ({
          stream: (async function* () {
            if (produce) await produce()
            yield { type: "session.idle", properties: { sessionID: `ses_new_${state.creates}` } }
          })(),
        }),
      },
    } as unknown as OpencodeClient
    return { client, state }
  }

  const planTask = { id: "PLAN", title: "知识提取(k)", status: "in_progress" as const, attempts: 0, body: "" }
  const unitSpec = {
    kind: "知识提取",
    unitStart: true,
    artifact: "非空知识文档",
    requirement: "写入文档",
    collect: async () => "产出",
  }

  async function git(dir: string, ...args: string[]) {
    const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    if (code !== 0) throw new Error(`git ${args.join(" ")} 退出码 ${code}: ${err || out}`)
    return out
  }

  test("启动前工作区脏(人工改动)→ dirty,不开会话", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-unit-gate-"))
    try {
      await git(dir, "init", "-q")
      await writeFile(join(dir, "human.txt"), "人工遗留")
      const { client, state } = unitClient()
      const value = await requireArtifact(client, planTask, "提取提示词", { dir }, unitSpec)
      expect(value).toEqual({ type: "dirty", files: ["human.txt"] })
      expect(state.creates).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("driver 状态文件(PLAN.md)遗留 → carryover 自愈后照常开会话产出", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-unit-gate-"))
    try {
      await git(dir, "init", "-q")
      await writeFile(join(dir, "seed.txt"), "s")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "seed")
      // 上次提交失败遗留的 driver 状态落账: 只含 PLAN.md → 自愈补提交
      await writeFile(join(dir, "PLAN.md"), "## T-001: 遗留 [done]\n")
      const { client, state } = unitClient()
      const value = await requireArtifact(client, planTask, "提取提示词", { dir }, unitSpec)
      expect(value).toBe("产出")
      expect(state.creates).toBe(1)
      const log = await git(dir, "log", "--pretty=%B")
      expect(log).toContain("Auto-Stage: carryover")
      // .auto/ 运行时状态(stats)不属纳管内容,排除后工作区应干净
      expect((await changedFiles(dir)).filter((file) => !file.startsWith(".auto/"))).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("spec.commit 提交失败(pre-commit 拒绝)→ blocked,不视为完成", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-unit-gate-"))
    try {
      await git(dir, "init", "-q")
      await mkdir(join(dir, "hooks"))
      await writeFile(join(dir, "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 })
      // 先落账 hook 脚本本身(保持工作区 clean),再启用 hooksPath 使后续提交失败
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "hooks")
      await git(dir, "config", "core.hooksPath", "hooks")
      const { client } = unitClient(async () => {
        await writeFile(join(dir, "kb.md"), "知识")
      })
      const value = await requireArtifact(client, planTask, "提取提示词", { dir }, {
        ...unitSpec,
        commit: { stage: "knowledge", subject: "PLAN knowledge 提取" },
      })
      expect(typeof value === "object" && "type" in value && value.type).toBe("blocked")
      if (typeof value === "object" && "type" in value && value.type === "blocked") {
        expect(value.question).toContain("统一提交失败")
        expect(value.question).toContain("不视为完成")
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("恢复复用原会话(step 记录存活)豁免 clean 检查: 脏的产物现场照常续跑", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-unit-gate-"))
    try {
      await git(dir, "init", "-q")
      // 半途产物 + active step 记录 + 存活会话 → 复用续跑而非 dirty 阻塞
      await writeFile(join(dir, "docs-kb.md"), "半途产物")
      await saveProgress(dir, { task: "PLAN", session: "ses_alive", at: 1, active: true, phase: { kind: "step", step: "phase-plan", letter: "m" } })
      const state = { creates: 0, prompts: [] as string[] }
      const client = {
        session: {
          create: async () => {
            state.creates++
            return { data: { id: `ses_new_${state.creates}` } }
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
              yield { type: "session.idle", properties: { sessionID: "ses_alive" } }
            })(),
          }),
        },
      } as unknown as OpencodeClient
      const value = await requireArtifact(client, planTask, "续跑提示词", { dir }, {
        ...unitSpec,
        step: { step: "phase-plan", letter: "m" },
      })
      expect(value).toBe("产出")
      expect(state.prompts).toEqual(["ses_alive"]) // 复用原会话,未因脏区分叉
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("afterSession 完成条件门禁(commit-boundary-design.md)", () => {
  test("提交失败(pre-commit 拒绝)→ failed 带问题文本;门禁关闭(--commit false)→ ok", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-after-gate-"))
    try {
      await Bun.spawn(["git", "-C", dir, "init", "-q"]).exited
      await mkdir(join(dir, "hooks"))
      await writeFile(join(dir, "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 })
      await Bun.spawn(["git", "-C", dir, "config", "core.hooksPath", "hooks"]).exited
      await writeFile(join(dir, "a.txt"), "a")
      const failed = await afterSession(dir, {}, { id: "T-001", title: "示例" }, { stage: "execute", subject: "T-001 执行" })
      expect(failed.type).toBe("failed")
      if (failed.type === "failed") expect(failed.question).toContain("统一提交失败")
      const off = await afterSession(dir, { commit: false }, { id: "T-001", title: "示例" }, { stage: "execute", subject: "T-001 执行" })
      expect(off).toEqual({ type: "ok" })
      const none = await afterSession(undefined, {}, { id: "T-001", title: "示例" }, { stage: "execute", subject: "T-001 执行" })
      expect(none).toEqual({ type: "ok" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

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

describe("unitReruns(恢复点的单元归属门禁: 仅当所属单元将重跑才允许复用)", () => {
  const ctx = (over: Partial<UnitRerunCtx> = {}): UnitRerunCtx => ({
    mode: "auto",
    fork: true,
    items: [{ text: "第一项", done: true }, { text: "第二项", done: false }, { text: "第三项", done: false }],
    contextExists: false,
    subtasksFileItems: 0,
    wrapup: true,
    verify: true,
    review: true,
    ...over,
  })

  test("subtasks: 归属序号恰为首个未勾选项才可复用;已勾选(间歇期中断)/缺序号(老记录)/越界均否", () => {
    expect(unitReruns({ kind: "subtasks", index: 2 }, ctx())).toBe(true)
    expect(unitReruns({ kind: "subtasks", index: 1 }, ctx())).toBe(false) // 中断于子任务 1 收口后的间歇
    expect(unitReruns({ kind: "subtasks", index: 3 }, ctx())).toBe(false)
    expect(unitReruns({ kind: "subtasks" }, ctx())).toBe(false) // 老版本无序号记录: 无法判定归属
    expect(unitReruns({ kind: "subtasks", index: 9 }, ctx())).toBe(false)
  })

  test("understand/decompose: 产物已出现(摘要在位/检查项已注入)使单元幂等跳过 → 不复用", () => {
    const noItems = ctx({ items: [] })
    expect(unitReruns({ kind: "understand" }, noItems)).toBe(true)
    expect(unitReruns({ kind: "understand" }, ctx({ items: [] }))).toBe(true)
    expect(unitReruns({ kind: "understand" }, ctx({ items: [], contextExists: true }))).toBe(false)
    expect(unitReruns({ kind: "understand" }, ctx({ items: [], fork: false }))).toBe(false)
    expect(unitReruns({ kind: "understand" }, ctx({ items: [], mode: "off" }))).toBe(false)
    // decompose: 理解单元将先跑(摘要缺失)时,分解会话不是首个消费链的单元
    expect(unitReruns({ kind: "decompose" }, noItems)).toBe(false)
    expect(unitReruns({ kind: "decompose" }, ctx({ items: [], contextExists: true }))).toBe(true)
    expect(unitReruns({ kind: "decompose" }, ctx({ items: [], fork: false }))).toBe(true)
    expect(unitReruns({ kind: "decompose" }, ctx({ items: [], subtasksFileItems: 3, contextExists: true }))).toBe(false)
    // 已有检查项时两个前置单元都不再跑
    expect(unitReruns({ kind: "understand" }, ctx())).toBe(false)
    expect(unitReruns({ kind: "decompose" }, ctx())).toBe(false)
  })

  test("whole/wrapup: 模式或配置使单元不跑 → 不复用;wrapup 要求检查项已全部勾完", () => {
    expect(unitReruns({ kind: "whole" }, ctx({ mode: "off" }))).toBe(true)
    expect(unitReruns({ kind: "whole" }, ctx({ mode: "ondemand" }))).toBe(true)
    expect(unitReruns({ kind: "whole" }, ctx({ mode: "auto" }))).toBe(false)
    const done = ctx({ items: [{ text: "唯一项", done: true }] })
    expect(unitReruns({ kind: "wrapup" }, done)).toBe(true)
    expect(unitReruns({ kind: "wrapup" }, ctx())).toBe(false) // 尚有未勾项,下一个单元是子任务
    expect(unitReruns({ kind: "wrapup" }, ctx({ items: [], wrapup: false }))).toBe(false)
  })

  test("verify/review: active 记录只会是链上修复会话;旁路阶段与开关关闭均不复用", () => {
    const fix = { kind: "verify", stage: "fix", round: 1, rechecks: 0, replaced: false } as const
    expect(unitReruns(fix, ctx())).toBe(true)
    expect(unitReruns(fix, ctx({ verify: false }))).toBe(false)
    expect(unitReruns({ kind: "verify", stage: "judge", round: 1, rechecks: 0, replaced: false }, ctx())).toBe(false)
    const fixrun = { kind: "review", round: 1, stage: "fixrun", index: 2 } as const
    expect(unitReruns(fixrun, ctx())).toBe(true)
    expect(unitReruns(fixrun, ctx({ review: false }))).toBe(false)
    expect(unitReruns({ kind: "review", round: 1, stage: "fixrun", index: 1 }, ctx())).toBe(false)
    expect(unitReruns({ kind: "review", round: 1, stage: "fixrun" }, ctx())).toBe(false) // 老记录无序号
    expect(unitReruns({ kind: "review", round: 1, stage: "audit" }, ctx())).toBe(false) // 旁路会话重跑恒新建
  })

  test("无阶段(旧版 session.json)无法判定归属 → 不复用;step 记录不归本门禁", () => {
    expect(unitReruns(undefined, ctx())).toBe(false)
    expect(unitReruns({ kind: "step", step: "phase-plan", letter: "m" }, ctx())).toBe(true)
  })

  test("phaseText 的 subtasks 文案带归属序号", () => {
    expect(phaseText({ kind: "subtasks", index: 2 })).toBe("逐子任务执行阶段(中断于子任务 2,从首个未勾选项继续)")
    expect(phaseText({ kind: "subtasks" })).toBe("逐子任务执行阶段(从首个未勾选项继续)")
  })
})

describe("attempt 接线: runSession 依注入策略带/不带 model(不依赖 autoSwitches memo)", () => {
  test("字母命中: opts.phase=m → anthropic/c-4 进 prompt.model", async () => {
    const { client, calls } = fakeClient()
    const chain: SessionChain = { pct: 100, used: 0, at: 0 } // 无 role/phase → bypass;letter m 命中
    await runSession(client, task, "提示词", { phase: "m" }, chain, undefined, undefined, parseSwitches({ [SWITCH_ENV.model]: "m=anthropic/c-4,*=kimi/k2" }))
    expect(calls.prompts[0]!.model).toEqual({ providerID: "anthropic", modelID: "c-4" })
  })

  test("旁路角色: chain.role=verify-judge → role 覆盖 wildcard", async () => {
    const { client, calls } = fakeClient()
    const chain: SessionChain = { pct: 100, used: 0, at: 0, role: "verify-judge" }
    await runSession(client, task, "提示词", {}, chain, undefined, undefined, parseSwitches({ [SWITCH_ENV.model]: "verify-judge=kimi/k2-lite,*=kimi/k2" }))
    expect(calls.prompts[0]!.model).toEqual({ providerID: "kimi", modelID: "k2-lite" })
  })

  test("未设策略: prompt 参数里没有 model 键(逐字节等价现状)", async () => {
    const { client, calls } = fakeClient()
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "提示词", { phase: "m" }, chain, undefined, undefined, parseSwitches({}))
    expect("model" in calls.prompts[0]!).toBe(false)
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
  test("unknown: 无意义字符串(保守缺省,不在 unknown 上换模型)", () => {
    expect(classifySessionError({ message: "asdf zxcv qwerty" })).toBe("unknown")
  })
  test("unknown: 空输入", () => {
    expect(classifySessionError({})).toBe("unknown")
  })
})

// ---- 错误信号接线 → runSession 出口(docs/model-routing-design.md D.2/CRITICAL 不变量,P3)----
describe("错误信号接线: watch 三触发面 → runSession 出口(P3 仅分类+标记,不做候选决策)", () => {
  // 零等待阶梯: 本块只验错误归类与出口标记,不该被重试退避拖成分钟级。
  const SIGNAL_NO_WAIT = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0", [SWITCH_ENV.retryAsk]: "0" })
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
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, SIGNAL_NO_WAIT)
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
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, SIGNAL_NO_WAIT)
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
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, SIGNAL_NO_WAIT)
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
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, SIGNAL_NO_WAIT)
    expect(result.type).toBe("blocked")
    expect((result as { failover?: boolean }).failover).toBeUndefined()
    // 可重试 500 → errorClass transient(仅上报,不降级)。耗尽前每次尝试都开新会话。
    expect(calls.creates).toBe(3)
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

// ---- 配额降级(D.3/D.4,P4):runSession 降级支 + 候选钳制与耗尽 + 降级 note ----
// 复用 fakeClient(over.events 按当前会话 id 造定向事件流、over.fork 造分叉结果),
// 仅注入 switches.model.fallback 驱动降级;候选窗口钳制经扩展 provider.list 表面断言。
describe("配额降级 failover(D.3/D.4):候选切换保上下文 / 钳制跳过 / 耗尽仍阻塞", () => {
  const FAILOVER = parseSwitches({ [SWITCH_ENV.modelFallback]: "prov/b,prov/c" })
  // 第 n 次订阅(n 从 1)发不可重试 quota 的 session.error,其后仍发 idle 让 watch
  // 正常结算;第 2 次起发 idle。用于「首轮配额失败、次轮成功」。
  const quotaThenIdleEvents = () => {
    let n = 0
    return (sid: string) =>
      (async function* () {
        n++
        if (n === 1) yield { type: "session.error", properties: { sessionID: sid, error: { name: "APIError", data: { message: "insufficient_quota", isRetryable: false } } } }
        yield { type: "session.idle", properties: { sessionID: sid } }
      })()
  }
  // 每次订阅都发不可重试 quota session.error(耗尽场景)。
  const alwaysQuotaEvents = () => {
    return (sid: string) =>
      (async function* () {
        yield { type: "session.error", properties: { sessionID: sid, error: { name: "APIError", data: { message: "insufficient_quota", isRetryable: false } } } }
        yield { type: "session.idle", properties: { sessionID: sid } }
      })()
  }

  test("quota + 两候选:切到首个候选(prov/b),从首个失败会话 fork 保上下文,降级 note 随次轮提示词带给 AI", async () => {
    const { client, calls } = fakeClient({ events: quotaThenIdleEvents() })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, FAILOVER)
    expect(result.type).toBe("idle")
    // 首轮不带 model(未设路由主模型),次轮带首个降级候选 prov/b。
    expect("model" in calls.prompts[0]!).toBe(false)
    expect(calls.prompts[1]!.model).toEqual({ providerID: "prov", modelID: "b" })
    // 上下文随迁:对首个失败会话(ses_new_1)做了一次 fork。
    expect(calls.forks).toContain("ses_new_1")
    // 降级 note(一次性)已随次轮提示词下发并自动清除。
    const text = (calls.prompts[1]!.parts[0] as { text: string }).text
    expect(text).toContain("[driver]")
    expect(text).toContain("已切换模型")
    expect(chain.note).toBeUndefined()
    // 换模型续跑落在分叉出的会话上(ses_fork_1),而非白板新会话。
    expect(calls.prompts[1]!.sessionID).toBe("ses_fork_1")
  })

  test("候选耗尽(每轮都 quota):回落 blocked,问题含全部已试候选;尝试次数有界(候选×RETRIES)", async () => {
    const { client, calls } = fakeClient({ events: alwaysQuotaEvents() })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, FAILOVER)
    expect(result.type).toBe("blocked")
    const blocked = result as { question: string; retryable?: boolean }
    expect(blocked.question).toContain("配额降级已用尽候选")
    expect(blocked.question).toContain("prov/b")
    expect(blocked.question).toContain("prov/c")
    expect(blocked.retryable).toBe(false)
    // 有界:不挂死。每个候选独享一轮 RETRIES(3),首个未降级候选由首轮失败带出 →
    // 总提示词数 ≤ 1 + fallback.length × RETRIES。
    expect(calls.prompts.length).toBeLessThanOrEqual(1 + FAILOVER.model.fallback.length * 3)
  })

  test("候选窗口钳制:prov/b 上下文窗口 < cap 被跳过,首个生效切换为窗口足够的 prov2/c", async () => {
    const { client, calls } = fakeClient({ events: quotaThenIdleEvents() })
    // 扩展 provider 表面:prov/b 窗口 1000 < 显式 cap 5000(跳过),prov2/c 窗口 1_000_000(可用)。
    const clamped = {
      ...client,
      provider: {
        list: async () => ({
          data: {
            all: [
              { id: "prov", models: { b: { limit: { context: 1000 } } } },
              { id: "prov2", models: { c: { limit: { context: 1_000_000 } } } },
            ],
          },
        }),
      },
    } as unknown as OpencodeClient
    const CLAMP = parseSwitches({ [SWITCH_ENV.modelFallback]: "prov/b,prov2/c" })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(clamped, task, "提示词", { contextLimit: 5000 }, chain, undefined, undefined, CLAMP)
    expect(result.type).toBe("idle")
    // 被选中的降级候选跳过了 prov/b(窗口不足),直接取 prov2/c。
    expect(calls.prompts[1]!.model).toEqual({ providerID: "prov2", modelID: "c" })
    // prov/b 从未作为下发模型出现(证明是被跳过、而非选中后失败)。
    expect(calls.prompts.some((p) => p.model?.providerID === "prov" && p.model?.modelID === "b")).toBe(false)
  })

  test("不变量 F:fallback 为空 ⇒ quota 直接阻塞,无降级 fork、prompt 不带 model(逐字节等价现状)", async () => {
    const { client, calls } = fakeClient({ events: quotaThenIdleEvents() })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, parseSwitches({}))
    expect(result.type).toBe("blocked")
    const blocked = result as { question: string; retryable?: boolean }
    expect(blocked.retryable).toBe(false)
    expect(blocked.question).toContain("会话错误:")
    expect(blocked.question).not.toContain("配额降级已用尽候选")
    // 未进降级支:一次 fork 都没有;首轮即直接阻塞、无第二次提示词;prompt 无 model 键。
    expect(calls.forks.length).toBe(0)
    expect(calls.prompts.length).toBe(1)
    expect("model" in calls.prompts[0]!).toBe(false)
  })
})

// ---- 降级回试粒度(OPENCODE_AUTO_MODEL_FAILBACK_SCOPE)与 /failback 覆写 ----
// scope 决定降级后何时回试首选: task(缺省)= 链内粘滞(现状);session = 新建会话即回试;
// phase = 经 failback 模块 sticky holder 跨链(跨任务)粘滞、阶段边界清零。/failback 带参
// 消费后整体重定义模型序(首选通配 + 候选环),经 override 层优先于 switches.model。
describe("failback 粒度与 /failback 覆写:回试时机 / 跨任务粘滞 / 模型序重定义 / 使用模型播报", () => {
  afterEach(() => {
    resetFailback()
  })
  const SCOPED = (scope: "task" | "session" | "phase") =>
    parseSwitches({ [SWITCH_ENV.model]: "prov/a", [SWITCH_ENV.modelFallback]: "prov/b", [SWITCH_ENV.modelFailbackScope]: scope })
  // 首轮订阅发不可重试 quota,其后 idle(与上组 quotaThenIdleEvents 同构,自带计数器
  // 以支撑同一 client 跨多次 runSession 的订阅序号)。
  const quotaThenIdle = () => {
    let n = 0
    return (sid: string) =>
      (async function* () {
        n++
        if (n === 1) yield { type: "session.error", properties: { sessionID: sid, error: { name: "APIError", data: { message: "insufficient_quota", isRetryable: false } } } }
        yield { type: "session.idle", properties: { sessionID: sid } }
      })()
  }

  test("缺省 task 粒度: 降级在同一条链内粘滞——第二次 runSession(同链)仍用候选 prov/b(现状不变)", async () => {
    const { client, calls } = fakeClient({ events: quotaThenIdle() })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "提示词", {}, chain, undefined, undefined, SCOPED("task"))
    expect(chain.model).toBe("prov/b")
    await runSession(client, task, "提示词2", {}, chain, undefined, undefined, SCOPED("task"))
    // 第三次提示词(第二次 runSession 的首轮)仍带降级候选。
    expect(calls.prompts[2]!.model).toEqual({ providerID: "prov", modelID: "b" })
  })

  test("session 粒度: 新建会话起点回试首选 prov/a(降级 fork 的迁移会话不被 undo)", async () => {
    const { client, calls } = fakeClient({ events: quotaThenIdle() })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "提示词", {}, chain, undefined, undefined, SCOPED("session"))
    // 降级 fork 出的迁移会话仍用候选 prov/b(不在 fork 消费点清零,防震荡)。
    expect(calls.prompts[1]!.model).toEqual({ providerID: "prov", modelID: "b" })
    expect(chain.model).toBe("prov/b")
    // 第二次 runSession: 复用关闭 → 全新 create,起点清零回首选 prov/a。
    await runSession(client, task, "提示词2", {}, chain, undefined, undefined, SCOPED("session"))
    expect(calls.prompts[2]!.model).toEqual({ providerID: "prov", modelID: "a" })
    expect(chain.model).toBeUndefined()
  })

  test("phase 粒度: 降级经 sticky holder 跨链粘滞(模拟下一任务的新链),clearSticky(阶段边界)后回首选", async () => {
    const { client, calls } = fakeClient({ events: quotaThenIdle() })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "提示词", {}, chain, undefined, undefined, SCOPED("phase"))
    expect(stickyModel()).toBe("prov/b")
    // 新链(下一任务): 链上无 chain.model,sticky 兜底仍用 prov/b。
    const next: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "提示词2", {}, next, undefined, undefined, SCOPED("phase"))
    expect(calls.prompts[2]!.model).toEqual({ providerID: "prov", modelID: "b" })
    // 阶段边界清零: 再下一条链回首选 prov/a。
    clearSticky()
    const third: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "提示词3", {}, third, undefined, undefined, SCOPED("phase"))
    expect(calls.prompts[3]!.model).toEqual({ providerID: "prov", modelID: "a" })
  })

  test("/failback 带参覆写: 首选 prov/x + 候选环 prov/y;env 未设 fallback 也能经覆写环降级", async () => {
    const { client, calls } = fakeClient({ events: quotaThenIdle() })
    requestFailback(["prov/x", "prov/y"])
    expect(consumeFailback()).toBe(true)
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, parseSwitches({}))
    expect(result.type).toBe("idle")
    // 首选取覆写通配(路由表未设);quota 后从覆写环降级到 prov/y。
    expect(calls.prompts[0]!.model).toEqual({ providerID: "prov", modelID: "x" })
    expect(calls.prompts[1]!.model).toEqual({ providerID: "prov", modelID: "y" })
  })

  test("实际使用模型播报: ◈ 行含模型与来源,同链同模型不重复,降级切换后再播报", async () => {
    const lines: string[] = []
    const orig = console.log
    console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "))
    try {
      const { client } = fakeClient({ events: quotaThenIdle() })
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      await runSession(client, task, "提示词", {}, chain, undefined, undefined, SCOPED("task"))
      await runSession(client, task, "提示词2", {}, chain, undefined, undefined, SCOPED("task"))
    } finally {
      console.log = orig
    }
    const shown = lines.filter((line) => line.includes("◈") && line.includes("使用模型"))
    // 首选 prov/a(路由)一次 + 降级 prov/b(降级候选)一次;第二次 runSession 模型
    // 未变(prov/b 粘滞)不重复播报。
    expect(shown.length).toBe(2)
    expect(shown[0]).toContain("prov/a")
    expect(shown[0]).toContain("路由")
    expect(shown[1]).toContain("prov/b")
    expect(shown[1]).toContain("降级候选")
  })
})

// ---- 阶梯耗尽后的回落接入配额降级环(T1):transient/unknown 耗尽阶梯 → 换候选续跑 ----
// 与上组的区别:触发面不是 quota/auth/rate(那三类在阶梯之前就换模型),而是重试阶梯
// 跑完、人工也没给出继续/退出时的回落支。用 retryClient:它按 create/fork 顺序给每个
// 会话排事件,能如实模拟「每次重试都失败」并让失败会话带上真实用量。
describe("阶梯耗尽回落 → 候选降级:换模型重开一轮阶梯 / exit 不降级 / 候选耗尽仍阻塞", () => {
  // 零等待两级阶梯(首次 + 两次重试 = 三次尝试)+ 不等人工(retryAsk=0 ⇒ askRetry
  // 直接回落)+ 两个候选。
  const LADDER_FAILOVER = parseSwitches({
    [SWITCH_ENV.retryWaits]: "0,0",
    [SWITCH_ENV.retryAsk]: "0",
    [SWITCH_ENV.modelFallback]: "prov/b,prov/c",
  })
  // 可重试(未标 isRetryable:false)⇒ 归类落 transient/unknown ⇒ 不进 quota 支,只能
  // 走阶梯。每个会话带 50k 用量:失败会话有真实上下文才进分叉候选(0 用量是纯报错桩,
  // 按设计不保),而这正是本项要保住的资产。
  const TRANSIENT = "stream disconnected"
  const allFail = (n = 12) => Array<Outcome>(n).fill("error-retryable")
  const answering = (answers: (string | undefined)[]): Interactive => ({
    attach() {},
    question: async () => answers.shift(),
    close() {},
  })

  test("阶梯耗尽 + 回落:切到首个候选(prov/b)、带降级 note 从最值钱的会话 fork 续跑,阶梯重开一轮", async () => {
    // 三次尝试全失败 → 回落降级 → 第四次带 prov/b 成功。
    const { client, calls } = retryClient(["error-retryable", "error-retryable", "error-retryable", "ok"], 50_000, TRANSIENT)
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, LADDER_FAILOVER)
    expect(result.type).toBe("idle")
    expect(calls.prompts.length).toBe(4)
    // 阶梯内三次尝试都不带 model(未设路由主模型),降级后第四次带首个候选。
    for (const p of calls.prompts.slice(0, 3)) expect("model" in p).toBe(false)
    expect(calls.prompts[3]!.model).toEqual({ providerID: "prov", modelID: "b" })
    // 上下文随迁:降级从上一轮的失败会话(50k 用量,链上 chain.id 已被 attempt 还原为空)
    // 分叉,而不是开白板新会话。
    expect(calls.forks).toEqual(["ses_new_1", "ses_fork_1", "ses_fork_2"])
    expect(calls.creates).toBe(1)
    expect(calls.prompts[3]!.sessionID).toBe("ses_fork_3")
    // 一次性降级 note 已随该提示词下发并清除,文案点名触发原因。
    const text = (calls.prompts[3]!.parts[0] as { text: string }).text
    expect(text).toContain("[driver]")
    expect(text).toContain("重试阶梯耗尽")
    expect(text).toContain("已切换模型")
    expect(chain.note).toBeUndefined()
    // chain.model 停在生效候选上(作用域:chain 由 runTask 逐任务新建,下一个任务自动
    // 回首选模型,无需退回逻辑)。
    expect(chain.model).toBe("prov/b")
  })

  test("人工答 exit:不降级,立即阻塞(exit 是停下来,不是再想办法)", async () => {
    const ask = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0", [SWITCH_ENV.retryAsk]: "1", [SWITCH_ENV.modelFallback]: "prov/b,prov/c" })
    const { client, calls } = retryClient(allFail(), 50_000, TRANSIENT)
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", { interactive: answering(["exit"]) }, chain, undefined, undefined, ask)
    expect(result.type).toBe("blocked")
    const blocked = result as { question: string }
    expect(blocked.question).toContain("人工选择退出")
    expect(blocked.question).not.toContain("已用尽候选")
    // 三次尝试后即阻塞,没有第四次;没有任何 prompt 带 model,链上也没留下降级痕迹。
    expect(calls.prompts.length).toBe(3)
    expect(calls.prompts.every((p) => !("model" in p))).toBe(true)
    expect(chain.model).toBeUndefined()
  })

  test("候选耗尽(每个候选各跑一轮完整阶梯仍失败):阻塞,文案列全部已试候选", async () => {
    const { client, calls } = retryClient(allFail(), 50_000, TRANSIENT)
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, LADDER_FAILOVER)
    expect(result.type).toBe("blocked")
    const blocked = result as { question: string }
    expect(blocked.question).toContain("自动重试 2 次仍失败")
    expect(blocked.question).toContain("降级已用尽候选")
    expect(blocked.question).toContain("prov/b")
    expect(blocked.question).toContain("prov/c")
    // 有界、不挂死:主模型 + 每个候选各独享一轮三次尝试的阶梯。
    expect(calls.prompts.length).toBe(3 * (1 + LADDER_FAILOVER.model.fallback.length))
    // 后两轮分别带两个候选下发。
    expect(calls.prompts[3]!.model).toEqual({ providerID: "prov", modelID: "b" })
    expect(calls.prompts[6]!.model).toEqual({ providerID: "prov", modelID: "c" })
  })

  test("候选窗口钳制同样生效:窗口不足的候选被跳过,不作为回落目标下发", async () => {
    const { client: base, calls } = retryClient(["error-retryable", "error-retryable", "error-retryable", "ok"], 50_000, TRANSIENT)
    const clamped = {
      ...base,
      provider: {
        list: async () => ({
          data: { all: [{ id: "prov", models: { b: { limit: { context: 1000 } } } }, { id: "prov2", models: { c: { limit: { context: 1_000_000 } } } }] },
        }),
      },
    } as unknown as OpencodeClient
    const CLAMP = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0", [SWITCH_ENV.retryAsk]: "0", [SWITCH_ENV.modelFallback]: "prov/b,prov2/c" })
    const result = await runSession(clamped, task, "提示词", { contextLimit: 5000 }, { pct: 100, used: 0, at: 0 }, undefined, undefined, CLAMP)
    expect(result.type).toBe("idle")
    expect(calls.prompts[3]!.model).toEqual({ providerID: "prov2", modelID: "c" })
    expect(calls.prompts.some((p) => p.model?.providerID === "prov" && p.model?.modelID === "b")).toBe(false)
  })

  test("不变量 F:候选表为空 ⇒ 阶梯耗尽照旧阻塞,文案与 model 面逐字节等价现状", async () => {
    const NO_FAILOVER = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0", [SWITCH_ENV.retryAsk]: "0" })
    const { client, calls } = retryClient(allFail(), 50_000, TRANSIENT)
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "提示词", {}, chain, undefined, undefined, NO_FAILOVER)
    expect(result.type).toBe("blocked")
    const blocked = result as { question: string }
    expect(blocked.question).toContain("自动重试 2 次仍失败")
    expect(blocked.question).not.toContain("降级")
    expect(blocked.question).not.toContain("已用尽候选")
    expect(calls.prompts.length).toBe(3)
    expect(calls.prompts.every((p) => !("model" in p))).toBe(true)
    expect(chain.model).toBeUndefined()
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
      // 下发失败(非"会话错误:"前缀)→ 不重试直接阻塞;唯一一次 attempt 由 finally
      // 兜底收段。
      const result = await runSession(client, task, "提示词", { dir }, chain)
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

// ---- 三处人工等待点扣时长(STATS_PLAN §2/§3,T-005): askHuman 接线 ----
// stepPause / waitBetweenTasks 的接线用例分别在 step.test.ts / loop-progress.test.ts。
describe("askHuman 等待扣除(stats 接线,T-005)", () => {
  let now: number

  beforeEach(() => {
    now = 100_000
    setStatsClock(() => now)
  })

  afterEach(() => {
    setStatsClock()
  })

  // fake 常驻输入行: 作答前推进注入时钟,模拟人工等待时长。
  function fakeInteractive(answer: string, advance: number): Interactive {
    return {
      attach: () => {},
      question: async () => {
        now += advance
        return answer
      },
      close: () => {},
    } as unknown as Interactive
  }

  test("interactive 路径: 会话内等待同步扣除会话用时与 AI 用时,waitMs 单记", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-ask-"))
    try {
      await loadStats(dir)
      await statsSessionBegin(dir, "T-001")
      now += 3000 // AI 活跃 3s
      const answer = await askHuman(5, "超时将自动答复", fakeInteractive("allow", 8000), dir)
      expect(answer).toBe("allow") // 行为不变: 回答照传
      now += 2000 // AI 再活跃 2s
      const report = await statsSessionEnd(dir, "s1", { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 })
      expect(report?.thisAiMs).toBe(5000) // 3000 + 2000,等待 8000 不计
      expect(report?.session.wallMs).toBe(13_000) // per-session wallMs = aiMs + waitMs
      const round = await statsTotals(dir, "round")
      expect(round?.aiMs).toBe(5000)
      expect(round?.wallMs).toBe(5000)
      expect(round?.waitMs).toBe(8000)
    } finally {
      await flushStats(dir)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("空回答回落 undefined(行为不变);dir 缺省统计零接触", async () => {
    // interactive 路径历来不做 trim(readline 路径才有 answer?.trim()),空串 → undefined。
    expect(await askHuman(5, "hint", fakeInteractive("", 1000))).toBeUndefined()
    // 非空回答(含空白)原样返回——与改动前对等行为。
    expect(await askHuman(5, "hint", fakeInteractive("allow", 1000))).toBe("allow")
  })
})

// ---- driver 侧代答采集接线(docs/auto-resolve-design.md §G,T-005): H1..H4 ----
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

// ---- 恢复保真(session-recovery-fidelity-design.md 3.2/3.1/3.3)----

describe("resumeNote(中断恢复说明)", () => {
  const subtasks: Phase = { kind: "subtasks", index: 2 }
  const planStep: Phase = { kind: "step", step: "phase-plan", letter: "m" }
  const ONE_LINE = "[driver] 会话曾中断,请继续当前工作直至本单元完成。"

  test("严格恢复门禁在位 + 复用原会话 → 收敛为一句 continue(3.2)", () => {
    expect(resumeNote(subtasks, true, true)).toBe(ONE_LINE)
    expect(resumeNote(planStep, true, true)).toBe(ONE_LINE)
    expect(resumeNote(undefined, true, true)).toBe(ONE_LINE)
  })

  test("门禁不在位(缺省 off / dryrun)→ 复用路径维持既有按阶段指引", () => {
    const note = resumeNote(subtasks, true, false)
    expect(note).not.toBe(ONE_LINE)
    expect(note).toContain("你正在原来中断的会话中继续")
    expect(note).toContain("首个未勾选项")
  })

  test("非复用路径(总结态续跑)恒给按阶段指引,不受严格恢复影响", () => {
    const note = resumeNote(subtasks, false, true)
    expect(note).toContain("部分工作可能已完成")
    expect(note).toContain("首个未勾选项")
    const step = resumeNote({ kind: "step", step: "phase-handover", letter: "t" }, false, true)
    expect(step).toContain("本阶段步骤")
    expect(step).toContain("四个必备小节")
  })
})

describe("requireArtifact 严格恢复(OPENCODE_AUTO_STRICT_RESUME + 单元基线/模型核对)", () => {
  // 注入开关: 严格恢复 on + 模型路由(严格恢复要求记录带生效模型,未配路由一律不复用)
  // + 零等待重试阶梯(本块只验恢复判据,不该被退避拖成分钟级)。
  const STRICT = parseSwitches({
    [SWITCH_ENV.strictResume]: "on",
    [SWITCH_ENV.model]: "*=kimi/k2",
    [SWITCH_ENV.retryWaits]: "0,0",
    [SWITCH_ENV.retryAsk]: "0",
  })
  const LOOSE = parseSwitches({
    [SWITCH_ENV.model]: "*=kimi/k2",
    [SWITCH_ENV.retryWaits]: "0,0",
    [SWITCH_ENV.retryAsk]: "0",
  })

  beforeEach(() => {
    // 严格恢复的模型求值链含 sticky / /failback 覆写(src/failback.ts 模块态),
    // 与其他用例共享进程 → 每例前复位,避免串扰。
    clearSticky()
    resetFailback()
  })

  async function git(dir: string, ...args: string[]) {
    const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    if (code !== 0) throw new Error(`git ${args.join(" ")} 退出码 ${code}: ${err || out}`)
    return out
  }

  // 记录了阶段步骤恢复点的临时仓库: 种子提交 + active step 记录(基线/模型由入参给定)。
  async function seeded(record: { model?: string; withBaseline?: boolean } = {}) {
    const dir = await mkdtemp(join(tmpdir(), "auto-strict-resume-"))
    await git(dir, "init", "-q")
    await writeFile(join(dir, "seed.txt"), "s")
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "seed")
    const baseline = await unitBaseline(dir)
    await saveProgress(dir, {
      task: "PLAN",
      session: "ses_plan_old",
      at: 1,
      active: true,
      phase: { kind: "step", step: "phase-plan", letter: "m" },
      ...(record.withBaseline === false ? {} : { baseline }),
      ...(record.model === undefined ? {} : { model: record.model }),
    })
    return { dir, head: (await git(dir, "rev-parse", "--short", "HEAD")).trim() }
  }

  function stepClient(current?: string, alive = true) {
    const state = { creates: 0, prompts: [] as string[], current }
    const client = {
      session: {
        create: async () => {
          state.creates++
          state.current = `ses_new_${state.creates}`
          return { data: { id: state.current } }
        },
        fork: async () => ({ data: { id: "ses_fork" } }),
        get: async (params: { sessionID: string }) => (alive ? { data: { id: params.sessionID } } : { error: { name: "NotFound" } }),
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

  test("基线完好 + 模型一致 + 会话存活 → 复用原会话、保留产物现场", async () => {
    const { dir } = await seeded({ model: "kimi/k2" })
    try {
      const { client, state } = stepClient("ses_plan_old")
      let resetCalled = false
      expect(await requireArtifact(client, planTask, "规划提示词", { dir }, spec(() => (resetCalled = true)), STRICT)).toBe(4)
      expect(resetCalled).toBe(false)
      expect(state.creates).toBe(0)
      expect(state.prompts).toEqual(["ses_plan_old"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("模型不一致 → 回滚到单元基线(现场进 stash)后开新会话重做本步骤", async () => {
    const { dir, head } = await seeded({ model: "kimi/old" })
    try {
      const { client, state } = stepClient("ses_plan_old")
      let resetCalled = false
      expect(await requireArtifact(client, planTask, "规划提示词", { dir }, spec(() => (resetCalled = true)), STRICT)).toBe(4)
      expect(resetCalled).toBe(true)
      expect(state.creates).toBe(1)
      expect(state.prompts).toEqual(["ses_new_1"])
      expect((await git(dir, "rev-parse", "--short", "HEAD")).trim()).toBe(head)
      expect(await git(dir, "stash", "list")).toContain("auto-rollback")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("原会话已死 → 同样回滚后重做(不在陌生脏区上续跑)", async () => {
    const { dir } = await seeded({ model: "kimi/k2" })
    try {
      const { client, state } = stepClient("ses_plan_old", false)
      let resetCalled = false
      expect(await requireArtifact(client, planTask, "规划提示词", { dir }, spec(() => (resetCalled = true)), STRICT)).toBe(4)
      expect(resetCalled).toBe(true)
      expect(state.creates).toBe(1)
      expect(await git(dir, "stash", "list")).toContain("auto-rollback")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("基线以来混入外部提交 → dirty 交人工(不回滚、不开会话)", async () => {
    const { dir } = await seeded({ model: "kimi/k2" })
    try {
      await writeFile(join(dir, "human.txt"), "人工改动")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "人工提交")
      const { client, state } = stepClient("ses_plan_old")
      const value = await requireArtifact(client, planTask, "规划提示词", { dir }, spec(() => {}), STRICT)
      expect(typeof value === "object" && "type" in value && value.type).toBe("dirty")
      expect(state.creates).toBe(0)
      expect(await git(dir, "stash", "list")).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("严格恢复启用前的旧记录(无基线)→ 不复用也不回滚,开新会话重做", async () => {
    const { dir } = await seeded({ withBaseline: false })
    try {
      const { client, state } = stepClient("ses_plan_old")
      let resetCalled = false
      expect(await requireArtifact(client, planTask, "规划提示词", { dir }, spec(() => (resetCalled = true)), STRICT)).toBe(4)
      expect(resetCalled).toBe(true)
      expect(state.creates).toBe(1)
      expect(await git(dir, "stash", "list")).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("开关缺省 off: 同一条模型不一致的记录仍按既有语义复用(等价现状)", async () => {
    const { dir } = await seeded({ model: "kimi/old" })
    try {
      const { client, state } = stepClient("ses_plan_old")
      let resetCalled = false
      expect(await requireArtifact(client, planTask, "规划提示词", { dir }, spec(() => (resetCalled = true)), LOOSE)).toBe(4)
      expect(resetCalled).toBe(false)
      expect(state.creates).toBe(0)
      expect(state.prompts).toEqual(["ses_plan_old"])
      expect(await git(dir, "stash", "list")).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// 测试交接判据(交接触发解耦,D1): 与 handoverDue 并列——两套阈值两套语义,
// 前者是 ondemand 上下文交接的 2×cap,这里是 --handover-test 的 contextLimit
// 单条件,且判定时点固定在"AI 发起测试的那一刻"。
describe("testHandoverDue(--handover-test 判据)", () => {
  const test64k = { handover: true, limit: 64_000, startUsed: 0 }

  test("解耦: 不看测试成败,上下文达 contextLimit 单条件即交接", () => {
    expect(testHandoverDue(test64k, 64_000)).toBe(true)
    expect(testHandoverDue(test64k, 64_001)).toBe(true)
    expect(testHandoverDue(test64k, 63_999)).toBe(false)
  })

  test("开关关闭(未启用 --handover-test): 冲多高都不交接", () => {
    expect(testHandoverDue({ ...test64k, handover: false }, 640_000)).toBe(false)
  })

  test("实时用量拿不到时回落起跑值: 复用会话起跑就超限,首次测试请求即判得出来", () => {
    const resumed = { handover: true, limit: 64_000, startUsed: 120_000 }
    expect(testHandoverDue(resumed, 0)).toBe(true)
    // 实时值一到就以实时值为准(单调增,回落值只在 used=0 的窗口起作用)。
    expect(testHandoverDue(resumed, 1_000)).toBe(false)
  })

  test("全新/fork 会话起跑值归零: 不被上一个会话的残值误判为超限", () => {
    expect(testHandoverDue(test64k, 0)).toBe(false)
  })
})

// 请求标记的消费(测试交接顺序化 E1): 顺序态在定版那一刻就把脚本定下来、标记拿走,
// 执行推迟到交接收口之后,所以"定出脚本"必须独立于"执行"可测。
describe("resolveTestScript(消费 tmp/test.sh 请求标记)", () => {
  let dir = ""
  let tmp = ""

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-test-script-"))
    tmp = join(dir, "tmp")
    await mkdir(tmp, { recursive: true })
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("test/ 路径形态: 直取该脚本,不另产 tmp/test.<n>.sh", async () => {
    await mkdir(join(dir, "test"), { recursive: true })
    await writeFile(join(dir, "test", "build.sh"), "echo hi")
    await writeFile(join(tmp, "test.sh"), "test/build.sh")
    const run = { dir, tmp, seq: 0 }
    expect(await resolveTestScript(run)).toEqual({ script: join(dir, "test", "build.sh"), seq: 1 })
    expect(await Bun.file(join(tmp, "test.1.sh")).exists()).toBe(false)
  })

  // 现状固定(非本次改动引入): 判据是"整份内容不含换行",所以标记文件带尾随换行
  // 时——AI 写文件的常态——走的是内联回落,tmp/test.<n>.sh 里是一行路径,由 bash
  // 当命令执行。结果等价、脚本照跑,但 test/ 路径形态实际很少命中。
  test("路径后带尾随换行: 现状走内联回落(整份内容含换行即判为内联)", async () => {
    await mkdir(join(dir, "test"), { recursive: true })
    await writeFile(join(dir, "test", "build.sh"), "echo hi")
    await writeFile(join(tmp, "test.sh"), "test/build.sh\n")
    const pending = await resolveTestScript({ dir, tmp, seq: 0 })
    expect(pending.script).toBe(join(tmp, "test.1.sh"))
    expect(await Bun.file(pending.script).text()).toBe("test/build.sh\n")
  })

  test("内联形态回落: 整写为 tmp/test.<n>.sh 保留执行快照", async () => {
    await writeFile(join(tmp, "test.sh"), "set -e\necho inline\n")
    const run = { dir, tmp, seq: 4 }
    const pending = await resolveTestScript(run)
    expect(pending).toEqual({ script: join(tmp, "test.5.sh"), seq: 5 })
    expect(await Bun.file(pending.script).text()).toBe("set -e\necho inline\n")
  })

  test("单行但指向不存在的文件: 当内联脚本处理(不误判为路径)", async () => {
    await writeFile(join(tmp, "test.sh"), "make check")
    const run = { dir, tmp, seq: 0 }
    const pending = await resolveTestScript(run)
    expect(pending.script).toBe(join(tmp, "test.1.sh"))
    expect(await Bun.file(pending.script).text()).toBe("make check")
  })

  test("标记读完即删且序号递增: 会话收尾期重写标记不会让 driver 跑错脚本", async () => {
    await writeFile(join(tmp, "test.sh"), "echo one")
    const run = { dir, tmp, seq: 0 }
    expect((await resolveTestScript(run)).seq).toBe(1)
    expect(await Bun.file(join(tmp, "test.sh")).exists()).toBe(false)
    expect(run.seq).toBe(1)

    await writeFile(join(tmp, "test.sh"), "echo two")
    expect((await resolveTestScript(run)).seq).toBe(2)
    expect(run.seq).toBe(2)
  })
})

// 测试交接文档的陈旧清理与现场复原(中断恢复 F3/F4): 真实临时 git 仓库驱动
// ——判据本身就是"被 git 跟踪与否",替身无法覆盖。
describe("cleanTestHandoffs / restoreTestHandoffs(测试交接中断恢复)", () => {
  const t028 = parse("PLAN.md", `## T-028: 落码 [in_progress]\n正文。\n`).tasks[0]!

  async function fixture() {
    const dir = await mkdtemp(join(tmpdir(), "auto-handover-runner-"))
    const proc = Bun.spawn(["git", "-C", dir, "init", "-q"], { stdout: "ignore", stderr: "ignore" })
    await proc.exited
    await mkdir(join(dir, "docs", "T-028", "S03"), { recursive: true })
    await writeFile(join(dir, "PLAN.md"), "# PLAN\n")
    return dir
  }

  test("已落账的在途文档不删: 删它等于制造脏区,撞停下一个执行单元的 clean 门禁", async () => {
    const dir = await fixture()
    try {
      const rel = join("docs", "T-028", "S03", "testhandoff.md")
      await writeFile(join(dir, rel), "交接正文\n\n状态: 继续\n")
      await commitTree(dir, { id: "T-028", title: "落码" }, { stage: "subtask 3 handoff-1", subject: "T-028 测试交接 #1" })
      await cleanTestHandoffs(join(dir, "PLAN.md"), t028)
      expect(await Bun.file(join(dir, rel)).exists()).toBe(true)
      expect(await changedFiles(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("未跟踪的遗留照删", async () => {
    const dir = await fixture()
    try {
      await writeFile(join(dir, "PLAN.md"), "# PLAN\n")
      await commitTree(dir, { id: "T-028", title: "落码" }, { stage: "execute", subject: "T-028 基线" })
      const rel = join("docs", "T-028", "S03", "testhandoff.md")
      await writeFile(join(dir, rel), "上一次尝试的遗留")
      await cleanTestHandoffs(join(dir, "PLAN.md"), t028)
      expect(await Bun.file(join(dir, rel)).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("有在途交接记录时整段跳过(未跟踪的当前份同样保留)", async () => {
    const dir = await fixture()
    try {
      const rel = join("docs", "T-028", "S03", "testhandoff.md")
      await writeFile(join(dir, rel), "会话正在写")
      await saveHandover(dir, { task: "T-028", scope: rel, unit: "subtask 3", n: 1 })
      await cleanTestHandoffs(join(dir, "PLAN.md"), t028)
      expect(await Bun.file(join(dir, rel)).exists()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("现场复原: 被上一次运行删掉的已落账文档取回,脏区随之消失", async () => {
    const dir = await fixture()
    try {
      const rel = join("docs", "T-028", "S03", "testhandoff.md")
      await writeFile(join(dir, rel), "交接正文\n\n状态: 继续\n")
      await commitTree(dir, { id: "T-028", title: "落码" }, { stage: "subtask 3 handoff-1", subject: "T-028 测试交接 #1" })
      await rm(join(dir, rel), { force: true })
      expect(await changedFiles(dir)).toEqual([rel])
      await restoreTestHandoffs(dir, t028)
      expect(await Bun.file(join(dir, rel)).text()).toContain("状态: 继续")
      expect(await changedFiles(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("现场复原只认本任务的交接文档", async () => {
    const dir = await fixture()
    try {
      await mkdir(join(dir, "docs", "T-029"), { recursive: true })
      const mine = join("docs", "T-028", "S03", "testhandoff.md")
      const other = join("docs", "T-029", "testhandoff.md")
      const report = join("docs", "T-028", "S03", "index.md")
      for (const rel of [mine, other, report]) await writeFile(join(dir, rel), "正文\n")
      await commitTree(dir, { id: "T-028", title: "落码" }, { stage: "execute", subject: "T-028 基线" })
      for (const rel of [mine, other, report]) await rm(join(dir, rel), { force: true })
      await restoreTestHandoffs(dir, t028)
      expect(await Bun.file(join(dir, mine)).exists()).toBe(true)
      expect(await Bun.file(join(dir, other)).exists()).toBe(false)
      expect(await Bun.file(join(dir, report)).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// 定版点分叉(中断恢复 F5): server 的 fork 语义是"复制 target **之前**的消息",
// 故锚点取定版时观测到的末条消息的后一条。
describe("seedPinFork(从定版那一刻的会话状态分叉)", () => {
  const record = { task: "T-028", scope: "docs/T-028/S03/testhandoff.md", unit: "subtask 3", n: 1 }
  const makeChain = (): SessionChain => ({ pct: 10, used: 100, at: Date.now(), id: "ses_prev", note: "恢复说明" })
  const messages = () => ({ data: [{ info: { id: "msg_1" } }, { info: { id: "msg_2" } }, { info: { id: "msg_3" } }] })

  test("锚点 = 定版末条消息的后一条;链改为消费分叉会话,恢复说明清掉", async () => {
    const { client, calls } = fakeClient({ messages })
    const chain = makeChain()
    await expect(seedPinFork(client, chain, { ...record, pinSession: "ses_pin", pinMessage: "msg_2" }, "T-028 收尾")).resolves.toBe(true)
    expect(calls.forks).toEqual(["ses_pin"])
    expect(calls.forkAnchors).toEqual(["msg_3"])
    expect(chain).toMatchObject({ id: undefined, pending: "ses_fork_1", pct: 100, used: 0, at: 0, note: undefined })
  })

  test("定版消息就是末条(收尾回合一条都没落下): 整份分叉", async () => {
    const { client, calls } = fakeClient({ messages })
    await expect(seedPinFork(client, makeChain(), { ...record, pinSession: "ses_pin", pinMessage: "msg_3" }, "x")).resolves.toBe(true)
    expect(calls.forkAnchors).toEqual([undefined])
  })

  test("锚点已不在会话里(消息被清理)或记录没记锚点: 整份分叉", async () => {
    const { client, calls } = fakeClient({ messages })
    await expect(seedPinFork(client, makeChain(), { ...record, pinSession: "ses_pin", pinMessage: "msg_没了" }, "x")).resolves.toBe(true)
    await expect(seedPinFork(client, makeChain(), { ...record, pinSession: "ses_pin" }, "x")).resolves.toBe(true)
    expect(calls.forkAnchors).toEqual([undefined, undefined])
  })

  test("没有定版会话、会话已失效、fork 失败: 一律 false,调用方冷启动", async () => {
    const { client } = fakeClient({ messages })
    await expect(seedPinFork(client, makeChain(), record, "x")).resolves.toBe(false)
    const dead = fakeClient({ get: () => ({ error: { name: "NotFoundError" } }) })
    await expect(seedPinFork(dead.client, makeChain(), { ...record, pinSession: "ses_pin" }, "x")).resolves.toBe(false)
    expect(dead.calls.forks).toEqual([])
    const broken = fakeClient({ messages, fork: () => ({ error: { name: "NotFoundError" } }) })
    await expect(seedPinFork(broken.client, makeChain(), { ...record, pinSession: "ses_pin" }, "x")).resolves.toBe(false)
  })
})
