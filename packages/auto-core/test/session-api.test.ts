// src/session-api.ts 的单测: 基点分叉(forkSession/seedForkSession)、末端用量重建(sessionUsage)、askHuman 等待扣除;
// 另含 src/session.ts 的 ensureForkBase(基点确立与回退链,经会话驱动,见 §F.2 归属)。
// 拆分自 test/runner.test.ts(docs/module-split-plan.md S18,纯搬运)。

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import type { ForkBaseInfo, SessionChain } from "../src/chain"
import type { Interactive } from "../src/interactive"
import { load } from "../src/plan"
import { ensureForkBase } from "../src/session"
import { askHuman, forkSession, resetServerModelCache, seedForkSession, serverDefaultModel, sessionUsage } from "../src/session-api"
import { flushStats, loadStats, setStatsClock, statsSessionBegin, statsSessionEnd, statsTotals } from "../src/stats"
import { parseSwitches, SWITCH_ENV } from "../src/switches"
import { fakeClient } from "./fixtures/runner"

// ---- fork 三段式流水线(fork-decompose 设计 §4.2/§4.3)----

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

describe("ensureForkBase(基点确立与回退链: digest 持久复用 → digest 重建 → session → 冷启动)", () => {
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

  async function setupTask(forkBase?: string) {
    await Bun.write(path, `## T-001: 示例任务 [in_progress]\n${forkBase ? `  - fork-base: ${forkBase}\n` : ""}正文。\n`)
    return (await load(path)).tasks[0]!
  }

  test("digest 成功: 从 context.md 一次性链建基点会话,以 digest: 前缀落 fork-base 持久,返回基点", async () => {
    await Bun.write(join(dir, "docs", "T-001", "context.md"), "## 相关文件与关键符号\n- a.ts\n")
    const taskNoBase = await setupTask()
    const { client, calls } = fakeClient()
    const base = await ensureForkBase(client, await load(path), taskNoBase, {}, chain, digest)
    expect(base).toEqual({ id: "ses_new_1", used: 0 })
    // 一次性链建会话(标题即提交标题),不 fork、不改名(新建已命名)
    expect(calls.creates).toBe(1)
    expect(calls.forks).toEqual([])
    expect(calls.updates).toEqual([])
    // fork-base 以 digest: 前缀持久为新基点会话 id
    expect(await Bun.file(path).text()).toContain("  - fork-base: digest:ses_new_1")
  })

  test("digest 读回落: 新路径缺失而旧平铺 docs/T-001.context.md 存在 → 同样建立基点", async () => {
    await Bun.write(join(dir, "docs", "T-001.context.md"), "## 相关文件与关键符号\n- a.ts\n")
    const taskNoBase = await setupTask()
    const { client } = fakeClient()
    const base = await ensureForkBase(client, await load(path), taskNoBase, {}, chain, digest)
    expect(base).toEqual({ id: "ses_new_1", used: 0 })
  })

  test("digest 持久基点存活(中断后重跑/子任务未竟再运行): 复用同一基点会话,不重建、字段不动", async () => {
    await Bun.write(join(dir, "docs", "T-001", "context.md"), "## 相关文件与关键符号\n- a.ts\n")
    const taskPersisted = await setupTask("digest:ses_P")
    const { client, calls } = fakeClient({
      messages: () => ({ data: [{ info: { role: "user" } }, { info: { role: "assistant", tokens: { input: 400, cache: { read: 100 } } } }] }),
    })
    const base = await ensureForkBase(client, await load(path), taskPersisted, {}, chain, digest)
    // 用量经 messages 末条 assistant 重建(400 + 100)
    expect(base).toEqual({ id: "ses_P", used: 500 })
    expect(calls.creates).toBe(0)
    expect(await Bun.file(path).text()).toContain("  - fork-base: digest:ses_P")
  })

  test("digest 持久基点失效(存储清理): 从摘要重建并覆写字段", async () => {
    await Bun.write(join(dir, "docs", "T-001", "context.md"), "## 相关文件与关键符号\n- a.ts\n")
    const taskPersisted = await setupTask("digest:ses_dead")
    const { client, calls } = fakeClient({ get: () => undefined })
    const base = await ensureForkBase(client, await load(path), taskPersisted, {}, chain, digest)
    expect(base).toEqual({ id: "ses_new_1", used: 0 })
    expect(calls.creates).toBe(1)
    expect(await Bun.file(path).text()).toContain("  - fork-base: digest:ses_new_1")
  })

  test("digest 持久基点失效 + 重建受阻(会话内阻塞提问): 不重复校验死基点,回退冷启动", async () => {
    await Bun.write(join(dir, "docs", "T-001", "context.md"), "## 相关文件与关键符号\n- a.ts\n")
    const taskPersisted = await setupTask("digest:ses_dead")
    const gets: string[] = []
    const { client } = fakeClient({
      get: (id) => {
        gets.push(id)
        return undefined
      },
      events: (sid) =>
        (async function* () {
          yield { type: "question.asked", properties: { id: "q1", sessionID: sid, questions: [{ question: "请求权限: 写文件" }] } }
        })(),
    })
    const stubbed = { ...client, permission: { reply: async () => ({}) } } as unknown as OpencodeClient
    expect(await ensureForkBase(stubbed, await load(path), taskPersisted, {}, chain, digest)).toBeUndefined()
    // 存活校验只对死基点做过一次;回退链不再拿 digest: 前缀值重复校验
    expect(gets).toEqual(["ses_dead"])
  })

  test("digest 基点会话受阻(会话内阻塞提问,非故障)→ 回退 session 基点: 校验存活并按 messages 重建用量", async () => {
    await Bun.write(join(dir, "docs", "T-001", "context.md"), "## 相关文件与关键符号\n- a.ts\n")
    const taskWithBase = await setupTask("ses_U")
    // 权限提问且未设 --wait-answer → 会话以非故障的 blocked 收场(会话故障——错误/
    // 下发失败——自 2026-09-16 起在 runSession 内重试至恢复,不再走到回退)。
    const { client } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield { type: "question.asked", properties: { id: "q1", sessionID: sid, questions: [{ question: "请求权限: 写文件" }] } }
        })(),
      messages: () => ({ data: [{ info: { role: "user" } }, { info: { role: "assistant", tokens: { input: 700, cache: { read: 300 } } } }] }),
    })
    const stubbed = { ...client, permission: { reply: async () => ({}) } } as unknown as OpencodeClient
    const base = await ensureForkBase(stubbed, await load(path), taskWithBase, {}, chain, digest)
    expect(base).toEqual({ id: "ses_U", used: 1000 })
    expect(await Bun.file(path).text()).toContain("  - fork-base: ses_U")
  })

  test("digest 基点会话遇下发故障不回退: 会话故障经重试恢复后照样建立基点", async () => {
    await Bun.write(join(dir, "docs", "T-001", "context.md"), "## 相关文件与关键符号\n- a.ts\n")
    const taskNoBase = await setupTask()
    let n = 0
    const { client } = fakeClient({
      prompt: () => {
        n++
        return n === 1 ? { error: { message: "boom" } } : {}
      },
    })
    const base = await ensureForkBase(client, await load(path), taskNoBase, {}, chain, digest)
    expect(base).toEqual({ id: "ses_new_2", used: 0 })
    expect(await Bun.file(path).text()).toContain("  - fork-base: digest:ses_new_2")
  })

  test("digest 摘要缺失 → 回退 session 基点", async () => {
    const taskWithBase = await setupTask("ses_U")
    const { client } = fakeClient({ messages: () => ({ data: [] }) })
    const base = await ensureForkBase(client, await load(path), taskWithBase, {}, chain, digest)
    // session 基点存活但用量取不到 → 按 0
    expect(base).toEqual({ id: "ses_U", used: 0 })
  })

  test("session 模式基点失效(存储清理)→ 回退冷启动(undefined)", async () => {
    const taskWithBase = await setupTask("ses_U")
    const { client } = fakeClient({ get: () => undefined })
    expect(await ensureForkBase(client, await load(path), taskWithBase, {}, chain, session)).toBeUndefined()
  })

  test("session 模式遇 digest: 前缀遗留(运行中途切换基点模式): 剥壳校验,存活即复用为暖前缀", async () => {
    const taskPersisted = await setupTask("digest:ses_P")
    const { client } = fakeClient({ messages: () => ({ data: [] }) })
    expect(await ensureForkBase(client, await load(path), taskPersisted, {}, chain, session)).toEqual({ id: "ses_P", used: 0 })
  })

  test("fork=off: 恒为 undefined(现状流水线)", async () => {
    const taskWithBase = await setupTask("ses_U")
    const { client } = fakeClient()
    const off = parseSwitches({ [SWITCH_ENV.fork]: "off" })
    expect(await ensureForkBase(client, await load(path), taskWithBase, {}, chain, off)).toBeUndefined()
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

// ---- 服务端生效模型解析(serverDefaultModel: 未设路由时 ◈ 播报的回落)----

describe("serverDefaultModel(服务端生效模型解析)", () => {
  // 进程内缓存会被本文件其他用例(ensureForkBase 经 attempt 的 ◈ 播报)以同键占据,
  // 每个用例前后都清。
  beforeEach(() => resetServerModelCache())
  afterEach(() => resetServerModelCache())

  test("agent 配置级 model 优先(指定 agent 命中;缺省取首个 primary)", async () => {
    const client = {
      app: {
        agents: async () => ({
          data: [
            { name: "build", mode: "primary", model: { providerID: "p0", modelID: "m0" } },
            { name: "auto", mode: "primary", model: { providerID: "p1", modelID: "m1" } },
          ],
        }),
      },
      config: { get: async () => ({ data: { model: "p2/m2" } }) },
    } as unknown as OpencodeClient
    expect(await serverDefaultModel(client, "auto")).toBe("p1/m1")
    expect(await serverDefaultModel(client)).toBe("p0/m0")
  })

  test("agent 无 model 回落全局 config.model", async () => {
    const client = {
      app: { agents: async () => ({ data: [{ name: "auto", mode: "primary" }] }) },
      config: { get: async () => ({ data: { model: "prov/cfg" } }) },
    } as unknown as OpencodeClient
    expect(await serverDefaultModel(client, "auto")).toBe("prov/cfg")
  })

  test("config 无 model 回落首个已连接 provider 的缺省模型", async () => {
    const client = {
      app: { agents: async () => ({ data: [{ name: "auto", mode: "primary" }] }) },
      config: { get: async () => ({ data: {} }) },
      provider: { list: async () => ({ data: { connected: ["zai", "openai"], default: { zai: "glm", openai: "gpt" } } }) },
    } as unknown as OpencodeClient
    expect(await serverDefaultModel(client, "auto")).toBe("zai/glm")
  })

  test("全取不到(表面缺失/请求失败)返回 undefined,不抛错", async () => {
    expect(await serverDefaultModel({} as unknown as OpencodeClient, "auto")).toBeUndefined()
    const failing = {
      app: { agents: async () => Promise.reject(new Error("boom")) },
      config: { get: async () => ({ error: { name: "UnknownError" } }) },
      provider: { list: async () => ({ data: { connected: [], default: {} } }) },
    } as unknown as OpencodeClient
    expect(await serverDefaultModel(failing, "auto")).toBeUndefined()
  })

  test("进程内按 agent 缓存: 同键第二次不再请求", async () => {
    let calls = 0
    const client = {
      config: {
        get: async () => {
          calls++
          return { data: { model: "prov/cached" } }
        },
      },
    } as unknown as OpencodeClient
    expect(await serverDefaultModel(client, "auto")).toBe("prov/cached")
    expect(await serverDefaultModel(client, "auto")).toBe("prov/cached")
    expect(calls).toBe(1)
  })
})
