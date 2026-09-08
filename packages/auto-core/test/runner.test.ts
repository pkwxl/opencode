import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { load, parse } from "../src/plan"
import { ensureForkBase, forkSession, gatedAutoCorrectRefs, gatedTaskRefGap, handoffSteer, handoverDue, seedForkSession, type ForkBaseInfo, type SessionChain } from "../src/runner"
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
  } = {},
) {
  const calls = { forks: [] as string[], creates: 0, updates: [] as { id: string; title: string }[] }
  let seq = 0
  let lastCreated = "ses_new_0"
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
  const digest = parseSwitches({ [SWITCH_ENV.forkBase]: "digest" })
  const session = parseSwitches({})
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
