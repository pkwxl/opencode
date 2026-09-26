import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  flushStats,
  loadStats,
  MAX_TICK,
  setStatsClock,
  statsBoot,
  statsClassifyUsage,
  statsHistory,
  statsId,
  statsModelEvent,
  statsPhase,
  statsSessionBegin,
  statsSessionEnd,
  statsTask,
  statsTotals,
  statsWaitBegin,
  statsWaitEnd,
  type StatsDoc,
  type Usage,
} from "../src/stats"

// S02 覆盖: 持久化与装载闭环(schema/宽容解析/原子写/折旧/轮次滚动/flush)。
// 会话 API(statsSessionBegin/End、wait、per-session)与读数 API 的用例在 S03/S04 追加。

describe("stats 持久化与装载", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-stats-"))
    now = 100_000
    setStatsClock(() => now)
  })

  afterEach(async () => {
    setStatsClock()
    await rm(dir, { recursive: true, force: true })
  })

  async function readDoc(): Promise<StatsDoc> {
    return JSON.parse(await Bun.file(join(dir, ".auto", "stats.json")).text()) as StatsDoc
  }

  async function writeDoc(doc: unknown) {
    await mkdir(join(dir, ".auto"), { recursive: true })
    await Bun.write(join(dir, ".auto", "stats.json"), JSON.stringify(doc))
  }

  test("dir === undefined 全部空转", async () => {
    expect(await loadStats(undefined)).toBeUndefined()
    await flushStats(undefined)
  })

  test("首载 → flush 往返: 墙钟段并行入三桶,flush 关段;二次装载无折旧不双计", async () => {
    expect(await loadStats(dir)).toBeUndefined() // 全新目录无续接信息
    now += 5000
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.v).toBe(1)
    expect(doc.round).toBe(1)
    expect(doc.open).toBeUndefined() // 优雅收口不留开放段
    expect(doc.taskB.wallMs).toBe(5000)
    expect(doc.phaseB.wallMs).toBe(5000)
    expect(doc.roundB.wallMs).toBe(5000)
    expect(doc.taskB.aiMs).toBe(0) // 墙钟段不进 aiMs
    expect(doc.lastWriteAt).toBe(105_000)

    // 模拟下一进程: 盘上无 open,折旧为 0,续接信息带已累计值
    now += 60_000
    const resumed = await loadStats(dir)
    expect(resumed?.round).toBe(1)
    expect(resumed?.taskWallMs).toBe(5000)
    expect(resumed?.taskAiMs).toBe(0)
    await flushStats(dir)
    const doc2 = await readDoc()
    expect(doc2.taskB.wallMs).toBe(5000) // 不双重入账
  })

  test("坏文件宽容: 非法 JSON 从当下重开;部分坏字段逐字段缺失化不 throw", async () => {
    await writeDoc("not-json{{{")
    expect(await loadStats(dir)).toBeUndefined()
    await flushStats(dir)
    expect((await readDoc()).v).toBe(1) // 重写为合法文档

    await flushStats(dir) // 已卸载,空转
    await writeDoc({
      v: "x",
      round: 1,
      phase: 3,
      lastWriteAt: "bad",
      open: { at: "bad", ai: "yes" },
      taskB: { id: 5, wallMs: "bad", usage: { input: "bad" } },
      sessions: "nope",
      history: { rounds: "bad" },
    })
    await loadStats(dir) // 不 throw
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.phase).toBe("")
    expect(doc.taskB.wallMs).toBe(0)
    expect(doc.taskB.usage.input).toBe(0)
    expect(doc.sessions).toEqual({})
    expect(doc.history.rounds).toBe(0)
    expect(doc.open).toBeUndefined() // 坏 open 被丢弃,flush 后无新段
  })

  test("折旧: 上一进程遗留段只承认 [open.at, lastWriteAt] 精确入账", async () => {
    await writeDoc({
      v: 1,
      round: 1,
      phase: "m",
      open: { at: 1000, ai: true },
      lastWriteAt: 5000,
      taskB: { id: "T-001" },
      phaseB: { id: "m" },
      roundB: { id: "1" },
      sessions: {},
      history: { rounds: 0 },
    })
    now = 100_000 // 装载时刻远超 lastWriteAt: 超出部分不认
    const resumed = await loadStats(dir)
    expect(resumed?.task).toBe("T-001")
    expect(resumed?.phase).toBe("m")
    expect(resumed?.taskWallMs).toBe(4000)
    expect(resumed?.taskAiMs).toBe(4000) // ai 段折旧同加 aiMs
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.taskB.wallMs).toBe(4000)
    expect(doc.phaseB.wallMs).toBe(4000)
    expect(doc.roundB.wallMs).toBe(4000)
    expect(doc.roundB.aiMs).toBe(4000)
  })

  test("MAX_TICK 钳制: 折旧与活体 fold 都截断到 30 分钟", async () => {
    await writeDoc({
      v: 1,
      round: 1,
      phase: "",
      open: { at: 1000, ai: false },
      lastWriteAt: 1000 + MAX_TICK + 10_000,
      taskB: {},
      phaseB: {},
      roundB: {},
      sessions: {},
      history: { rounds: 0 },
    })
    await loadStats(dir)
    await flushStats(dir)
    expect((await readDoc()).taskB.wallMs).toBe(MAX_TICK) // 折旧钳制

    // 活体 fold 钳制: 重新装载(上段已入账 MAX_TICK),时钟一次性跳过 MAX_TICK+5s
    // (休眠唤醒),flush 只再入 MAX_TICK——总量恰好 2×MAX_TICK。
    now = 1000
    await loadStats(dir)
    now += MAX_TICK + 5000
    await flushStats(dir)
    expect((await readDoc()).taskB.wallMs).toBe(2 * MAX_TICK)
  })

  test("负值归 0: 时钟回拨(lastWriteAt < open.at / now < open.at)不入账", async () => {
    await writeDoc({
      v: 1,
      round: 1,
      phase: "",
      open: { at: 5000, ai: true },
      lastWriteAt: 1000,
      taskB: {},
      phaseB: {},
      roundB: {},
      sessions: {},
      history: { rounds: 0 },
    })
    await loadStats(dir)
    await flushStats(dir)
    expect((await readDoc()).taskB.wallMs).toBe(0) // 折旧负值归 0

    now = 100_000
    await loadStats(dir)
    now = 50_000 // 时钟回拨
    await flushStats(dir)
    expect((await readDoc()).taskB.wallMs).toBe(0) // 活体 fold 负值归 0
  })

  test("轮次滚动: 轮号变化把 roundB 滚进 history 并重置;round 字段损坏只刷快照不滚动", async () => {
    await mkdir(join(dir, "docs", "R-02"), { recursive: true }) // currentRound → 2
    await writeDoc({
      v: 1,
      round: 1,
      phase: "m",
      lastWriteAt: 90_000,
      taskB: { id: "T-003", wallMs: 45_000, aiMs: 20_000 },
      phaseB: { id: "m", wallMs: 50_000 },
      roundB: {
        id: "1",
        wallMs: 60_000,
        aiMs: 30_000,
        waitMs: 5000,
        sessions: 2,
        tasks: 1,
        usage: { input: 100, output: 40, reasoning: 10, cacheRead: 80, cacheWrite: 20, cost: 0.5, steps: 3 },
      },
      sessions: {},
      history: { rounds: 0 },
    })
    const resumed = await loadStats(dir)
    expect(resumed?.round).toBe(1) // 续接快照是上一进程停下时的轮次
    expect(resumed?.taskWallMs).toBe(45_000)
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.round).toBe(2)
    expect(doc.history.rounds).toBe(1)
    expect(doc.history.totals.wallMs).toBe(60_000)
    expect(doc.history.totals.aiMs).toBe(30_000)
    expect(doc.history.totals.waitMs).toBe(5000)
    expect(doc.history.totals.sessions).toBe(2)
    expect(doc.history.totals.tasks).toBe(1)
    expect(doc.history.totals.usage.input).toBe(100)
    expect(doc.history.totals.usage.cost).toBe(0.5)
    expect(doc.roundB.id).toBe("2")
    expect(doc.roundB.wallMs).toBe(0) // 重置(装载与 flush 同时刻,新段折 0)
    expect(doc.taskB.wallMs).toBe(45_000) // task/phase 桶不动(已含于 roundB)
    expect(doc.phaseB.wallMs).toBe(50_000)

    // round 字段损坏(<1): 不滚动,history 不虚增,roundB 原值续用
    await writeDoc({
      v: 1,
      round: 0,
      phase: "",
      lastWriteAt: 90_000,
      taskB: {},
      phaseB: {},
      roundB: { id: "?", wallMs: 60_000 },
      sessions: {},
      history: { rounds: 0 },
    })
    await loadStats(dir)
    await flushStats(dir)
    const doc2 = await readDoc()
    expect(doc2.round).toBe(2)
    expect(doc2.history.rounds).toBe(0)
    expect(doc2.roundB.wallMs).toBe(60_000)
  })

  test("并发写经队列串行化,.auto/ 下无 .tmp 残留", async () => {
    await loadStats(dir) // 入队写 #1
    await Promise.all([flushStats(dir), flushStats(dir)]) // 并发 flush 共用句柄与写链
    const names = await readdir(join(dir, ".auto"))
    expect(names).toContain("stats.json")
    expect(names.filter((name) => name.endsWith(".tmp"))).toEqual([])
  })

  test("并发首次装载共用同一 promise,不重复折旧", async () => {
    await writeDoc({
      v: 1,
      round: 1,
      phase: "",
      open: { at: 1000, ai: false },
      lastWriteAt: 5000,
      taskB: { id: "T-001" },
      phaseB: {},
      roundB: {},
      sessions: {},
      history: { rounds: 0 },
    })
    await Promise.all([loadStats(dir), loadStats(dir)])
    await flushStats(dir)
    expect((await readDoc()).taskB.wallMs).toBe(4000) // 折旧只入一次
  })
})

// S03 覆盖: statsPhase/statsTask/statsTotals/statsId/statsBoot。
describe("stats 层级切换与读数", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-stats-"))
    now = 100_000
    setStatsClock(() => now)
  })

  afterEach(async () => {
    setStatsClock()
    await rm(dir, { recursive: true, force: true })
  })

  async function readDoc(): Promise<StatsDoc> {
    return JSON.parse(await Bun.file(join(dir, ".auto", "stats.json")).text()) as StatsDoc
  }

  async function writeDoc(doc: unknown) {
    await mkdir(join(dir, ".auto"), { recursive: true })
    await Bun.write(join(dir, ".auto", "stats.json"), JSON.stringify(doc))
  }

  test("dir === undefined 全部空转", async () => {
    await statsPhase(undefined, "a")
    await statsTask(undefined, "T-001")
    expect(await statsTotals(undefined, "task")).toBeUndefined()
    expect(await statsBoot(undefined)).toBeUndefined()
    expect(statsId(undefined)).toBeUndefined()
  })

  test("三桶包含关系: 同一 fold 并行入三桶,任意时刻 Σtask ≤ phase ≤ round", async () => {
    await loadStats(dir)
    now += 1000 // 阶段/任务未挂名前的非任务时间: 进三桶(taskB id="")
    await statsPhase(dir, "a") // fold 1000 入旧桶后重置 phaseB
    await statsTask(dir, "T-001") // 重置 taskB(那 1000 只留在 phase/round)
    now += 3000
    const t1 = await statsTotals(dir, "task")
    expect(t1?.wallMs).toBe(3000)
    await statsTask(dir, "T-002") // T-001 的 3000 折入旧 taskB 后随重置离桶
    now += 2000
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.taskB.wallMs).toBe(2000)
    expect(doc.phaseB.wallMs).toBe(5000) // = 3000(T-001) + 2000(T-002)
    expect(doc.roundB.wallMs).toBe(6000) // = 1000(非任务) + 5000
    // Σ 各 task 桶(离桶的 T-001 + 当前 T-002) = phase ≤ round
    expect(3000 + doc.taskB.wallMs).toBe(doc.phaseB.wallMs)
    expect(doc.phaseB.wallMs).toBeLessThanOrEqual(doc.roundB.wallMs)
    // tasks 计数: 进入不同任务 id 各 +1,taskB 本桶 = 1
    expect(doc.taskB.tasks).toBe(1)
    expect(doc.phaseB.tasks).toBe(2)
    expect(doc.roundB.tasks).toBe(2)
  })

  test("phase 切换重置: 异字母重置(since 更新、旧值离桶),同字母幂等", async () => {
    await loadStats(dir)
    await statsPhase(dir, "a") // since = 100_000
    now += 2000
    await statsPhase(dir, "a") // 同字母: 不重置,累计继续
    const mid = await statsTotals(dir, "phase")
    expect(mid?.id).toBe("a")
    expect(mid?.wallMs).toBe(2000)
    expect(mid?.since).toBe(100_000)
    now += 1000
    await statsPhase(dir, "b") // 重置: fold 先把 3000 折入旧 a 桶(离桶)
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.phase).toBe("b")
    expect(doc.phaseB.id).toBe("b")
    expect(doc.phaseB.since).toBe(103_000)
    expect(doc.phaseB.wallMs).toBe(0) // 旧值不保留(装载与 flush 同时刻,新段折 0)
    expect(doc.roundB.wallMs).toBe(3000) // round 不随 phase 重置
  })

  test("statsTask 清空 sessions;同 id 幂等不清(跨中断续接保留 per-session)", async () => {
    await writeDoc({
      v: 1,
      round: 1,
      phase: "m",
      lastWriteAt: 90_000,
      taskB: { id: "T-001", wallMs: 5000 },
      phaseB: { id: "m" },
      roundB: { id: "1" },
      sessions: { s1: { task: "T-001", aiMs: 1, wallMs: 2, rounds: 1, usage: {}, at: 90_000 } },
      history: { rounds: 0 },
    })
    await loadStats(dir)
    await statsTask(dir, "T-001") // 同 id(中断续跑): 不重置、不清 sessions
    await flushStats(dir)
    let doc = await readDoc()
    expect(doc.taskB.wallMs).toBe(5000) // 续接累计不归零
    expect(Object.keys(doc.sessions)).toEqual(["s1"])

    await loadStats(dir)
    await statsTask(dir, "T-002") // 切换: 重置 taskB + 清空 sessions
    await flushStats(dir)
    doc = await readDoc()
    expect(doc.taskB.id).toBe("T-002")
    expect(doc.sessions).toEqual({})
    expect(doc.phaseB.tasks).toBe(1) // 同 id 不计、异 id 计 1
  })

  test("实时外推: statsTotals 随注入 now 前进,不修改状态不落盘", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    now += 4000
    expect((await statsTotals(dir, "task"))?.wallMs).toBe(4000)
    now += 4000
    expect((await statsTotals(dir, "task"))?.wallMs).toBe(8000) // 开放段外推
    await new Promise((resolve) => setTimeout(resolve, 20)) // 等写队列排空
    const doc = await readDoc() // 盘上仍是最后一次落盘快照,外推未落账
    expect(doc.taskB.wallMs).toBe(0)
    expect(doc.lastWriteAt).toBe(100_000)
    await flushStats(dir) // fold 一次入账 8000,外推未造成双计
    expect((await readDoc()).taskB.wallMs).toBe(8000)
  })

  test("statsBoot: 本进程起点快照;增量 = statsTotals − 快照;桶重置后快照归零", async () => {
    await writeDoc({
      v: 1,
      round: 1,
      phase: "m",
      lastWriteAt: 90_000,
      taskB: { id: "T-003", wallMs: 45_000, aiMs: 20_000 },
      phaseB: { id: "m", wallMs: 50_000 },
      roundB: { id: "1", wallMs: 60_000 },
      sessions: {},
      history: { rounds: 0 },
    })
    await loadStats(dir)
    const boot = await statsBoot(dir)
    expect(boot?.task.wallMs).toBe(45_000) // 续接快照含上一进程累计
    expect(boot?.round.wallMs).toBe(60_000)
    now += 5000
    const task = await statsTotals(dir, "task")
    expect(task!.wallMs - boot!.task.wallMs).toBe(5000) // 本进程增量
    await statsTask(dir, "T-004") // 桶重置 → boot.task 归零,增量 = 当前桶全值
    now += 1000
    const boot2 = await statsBoot(dir)
    expect(boot2?.task.wallMs).toBe(0)
    expect(boot2?.round.wallMs).toBe(60_000) // round 快照不受任务切换影响
    expect((await statsTotals(dir, "task"))?.wallMs).toBe(1000)
    await flushStats(dir)
  })

  test("statsId: 守卫读数,未装载/空 id 返回 undefined,不触发装载", async () => {
    expect(statsId(dir)).toBeUndefined() // 未装载
    await loadStats(dir)
    expect(statsId(dir)).toBeUndefined() // 空 id
    await statsTask(dir, "T-007")
    expect(statsId(dir)).toBe("T-007")
    await flushStats(dir)
    expect(statsId(dir)).toBeUndefined() // 卸载后无句柄
  })
})

// S04 覆盖: statsSessionBegin/End、statsWaitBegin/End、per-session 续接、淘汰。
describe("stats 会话与等待", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-stats-"))
    now = 100_000
    setStatsClock(() => now)
  })

  afterEach(async () => {
    setStatsClock()
    await rm(dir, { recursive: true, force: true })
  })

  async function readDoc(): Promise<StatsDoc> {
    return JSON.parse(await Bun.file(join(dir, ".auto", "stats.json")).text()) as StatsDoc
  }

  function usage(input: number): Usage {
    return { input, output: 10, reasoning: 5, cacheRead: 90, cacheWrite: 20, cost: 0.01, steps: 2 }
  }

  test("dir === undefined 全部空转", async () => {
    await statsSessionBegin(undefined, "T-001")
    expect(await statsSessionEnd(undefined, "s1", usage(100))).toBeUndefined()
    await statsWaitBegin(undefined, "askHuman")
    await statsWaitEnd(undefined)
  })

  test("会话闭环: AI 段入 aiMs,usage 入四层,报告携带累计,结束后恢复墙钟段", async () => {
    await loadStats(dir)
    now += 2000 // 会话前墙钟(驱动工作): 只进 wallMs
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 5000
    const report = await statsSessionEnd(dir, "s1", usage(100))
    expect(report?.thisAiMs).toBe(5000)
    expect(report?.session.task).toBe("T-001")
    expect(report?.session.aiMs).toBe(5000)
    expect(report?.session.wallMs).toBe(5000) // 无等待: wallMs = aiMs
    expect(report?.session.rounds).toBe(1)
    expect(report?.session.usage.input).toBe(100)
    expect(report?.session.at).toBe(107_000)
    expect(report?.task.aiMs).toBe(5000)
    expect(report?.phase.wallMs).toBe(7000) // 2000 墙钟 + 5000 AI
    expect(report?.round.usage.cacheRead).toBe(90)

    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.open).toBeUndefined() // flush 收口
    expect(doc.taskB.wallMs).toBe(5000) // 会话前 2000 随 statsTask 重置离桶(留在 phase/round)
    expect(doc.taskB.aiMs).toBe(5000)
    expect(doc.phaseB.wallMs).toBe(7000)
    expect(doc.phaseB.aiMs).toBe(5000)
    expect(doc.roundB.aiMs).toBe(5000)
    expect(doc.taskB.sessions).toBe(1)
    expect(doc.phaseB.sessions).toBe(1)
    expect(doc.roundB.sessions).toBe(1)
    expect(doc.taskB.usage).toEqual(usage(100))
    expect(doc.roundB.usage.steps).toBe(2)

    // 会话结束后恢复墙钟段: 时长照进 wallMs 但 aiMs 不再增长
    await loadStats(dir)
    now += 3000
    const t = await statsTotals(dir, "task")
    expect(t?.wallMs).toBe(8000) // 5000 + 3000
    expect(t?.aiMs).toBe(5000)
    await flushStats(dir)
  })

  test("等待扣除: 等待期间 aiMs/wallMs 均不增长,waitMs 单记;嵌套去重只计一次", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 3000
    await statsWaitBegin(dir, "askHuman") // 关 AI 段
    now += 2000
    await statsWaitBegin(dir, "nested") // 嵌套: 仍同一段等待
    now += 1000
    await statsWaitEnd(dir) // 深度 2→1: 仍在等待
    now += 1000
    expect((await statsTotals(dir, "task"))?.aiMs).toBe(3000) // 等待中不外推
    await statsWaitEnd(dir) // 深度归零: 等待 4000 入账,重开 AI 段
    now += 4000
    const report = await statsSessionEnd(dir, "s1", usage(50))
    expect(report?.thisAiMs).toBe(7000) // 3000 + 4000,等待不计
    expect(report?.session.wallMs).toBe(11_000) // per-session wallMs 含等待
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.taskB.aiMs).toBe(7000)
    expect(doc.taskB.wallMs).toBe(7000) // 三桶 wallMs 排除纯人工等待
    expect(doc.taskB.waitMs).toBe(4000)
    expect(doc.phaseB.waitMs).toBe(4000)
    expect(doc.roundB.waitMs).toBe(4000)
  })

  test("等待中关段重开保持 ai 标志: 会话内等待结束后 AI 时长继续累计", async () => {
    await loadStats(dir)
    await statsSessionBegin(dir, "T-001")
    now += 1000
    await statsWaitBegin(dir)
    now += 500
    await statsWaitEnd(dir)
    now += 1000
    const report = await statsSessionEnd(dir, "s1", usage(1))
    expect(report?.thisAiMs).toBe(2000) // 等待前后两段 AI 拼接
    await flushStats(dir)
  })

  test("waitEnd 无配对 begin 空转;会话外等待(stepPause)进三桶不进 per-session", async () => {
    await loadStats(dir)
    await statsWaitEnd(dir) // 无配对: 不炸
    now += 1000
    await statsWaitBegin(dir, "stepPause") // 会话外(墙钟段)等待
    now += 2000
    await statsWaitEnd(dir)
    now += 1000
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.taskB.waitMs).toBe(2000)
    expect(doc.taskB.wallMs).toBe(2000) // 等待前后墙钟各 1000
    expect(doc.sessions).toEqual({})
  })

  // The window wait kind (plans/0055 §6.3): a dispatch whose candidates are
  // all outside their windows books its sleep as a `window` wait — the same
  // caliber as every planned wait (excluded from aiMs/wallMs, recorded as
  // waitMs alone).
  test("the window wait kind books like every planned wait: excluded from wallMs, recorded as waitMs", async () => {
    await loadStats(dir)
    now += 1000
    await statsWaitBegin(dir, "window")
    now += 2000
    await statsWaitEnd(dir)
    now += 1000
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.taskB.waitMs).toBe(2000)
    expect(doc.taskB.wallMs).toBe(2000)
    expect(doc.taskB.aiMs).toBe(0)
  })

  test("per-session 跨装载续接: 同 sessionID 二次会话累加 rounds/aiMs/usage", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 5000
    await statsSessionEnd(dir, "s1", usage(100))
    await flushStats(dir)

    now += 60_000 // 模拟进程重启
    await loadStats(dir)
    await statsTask(dir, "T-001") // 同 id 幂等: sessions 映射保留
    await statsSessionBegin(dir, "T-001")
    now += 3000
    const report = await statsSessionEnd(dir, "s1", usage(50))
    expect(report?.thisAiMs).toBe(3000) // 本次
    expect(report?.session.aiMs).toBe(8000) // 跨中断累计
    expect(report?.session.rounds).toBe(2)
    expect(report?.session.usage.input).toBe(150)
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.sessions.s1.rounds).toBe(2)
    expect(doc.sessions.s1.at).toBe(168_000)
  })

  test("sessions 超 64 按 at 淘汰最旧,聚合无损", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    for (let i = 0; i < 65; i++) {
      await statsSessionBegin(dir, "T-001")
      now += 1000
      await statsSessionEnd(dir, `s${i}`, usage(1))
    }
    await flushStats(dir)
    const doc = await readDoc()
    expect(Object.keys(doc.sessions)).toHaveLength(64)
    expect(doc.sessions.s0).toBeUndefined() // 最旧被淘汰
    expect(doc.sessions.s64).toBeDefined()
    expect(doc.taskB.sessions).toBe(65) // 聚合不受影响
    expect(doc.taskB.usage.input).toBe(65)
  })

  test("statsSessionEnd 无配对 begin(异常兜底): usage 照记,thisAiMs = 0", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    now += 1000
    const report = await statsSessionEnd(dir, "sX", usage(7))
    expect(report?.thisAiMs).toBe(0)
    expect(report?.session.task).toBe("T-001") // 缺省回落当前 taskB.id
    expect(report?.session.rounds).toBe(1)
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.taskB.sessions).toBe(1)
    expect(doc.taskB.usage.input).toBe(7)
    expect(doc.taskB.aiMs).toBe(0) // 墙钟段: 无 AI 入账
    expect(doc.taskB.wallMs).toBe(1000)
  })
})

// Per-model and per-tier usage, the `classify` bucket and the protocol-drift
// counters (plans/0055 §7.1 "Stats", §10 items 3 and 12): booked beside the
// bucket's own usage at the same session-booking point, persisted
// backward-compatibly (absent sections = no model data, the pre-registry
// shape) and cumulative across interruptions like the flat fields.
describe("stats per-model / per-tier / classify buckets", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-stats-models-"))
    now = 100_000
    setStatsClock(() => now)
  })

  afterEach(async () => {
    setStatsClock()
    await rm(dir, { recursive: true, force: true })
  })

  async function readDoc(): Promise<StatsDoc> {
    return JSON.parse(await Bun.file(join(dir, ".auto", "stats.json")).text()) as StatsDoc
  }

  async function writeDoc(doc: unknown) {
    await mkdir(join(dir, ".auto"), { recursive: true })
    await Bun.write(join(dir, ".auto", "stats.json"), JSON.stringify(doc))
  }

  function usage(input: number): Usage {
    return { input, output: 10, reasoning: 5, cacheRead: 90, cacheWrite: 20, cost: 0.01, steps: 2 }
  }

  test("dir/model undefined: no-ops that write nothing", async () => {
    await statsModelEvent(undefined, "glm", "fail")
    await statsModelEvent(dir, undefined, "fail")
    await statsClassifyUsage(undefined, usage(1))
    expect(await Bun.file(join(dir, ".auto", "stats.json")).exists()).toBe(false)
  })

  test("session booking by model and tier: parallel into the three buckets, report carries them", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 5000
    const report = await statsSessionEnd(dir, "s1", usage(100), "glm", "simple")
    expect(report?.task.models?.glm?.sessions).toBe(1)
    expect(report?.task.models?.glm?.usage.input).toBe(100)
    expect(report?.phase.tiers?.simple?.sessions).toBe(1)
    expect(report?.round.tiers?.simple?.usage.input).toBe(100)
    await flushStats(dir)
    const doc = await readDoc()
    for (const bucket of [doc.taskB, doc.phaseB, doc.roundB]) {
      expect(bucket.models?.glm?.usage.input).toBe(100)
      expect(bucket.models?.glm?.usage.steps).toBe(2)
      expect(bucket.models?.glm?.sessions).toBe(1)
      expect(bucket.tiers?.simple?.usage.input).toBe(100)
      expect(bucket.tiers?.simple?.sessions).toBe(1)
    }
  })

  test("a session without model/tier persists the pre-registry shape (C2)", async () => {
    await loadStats(dir)
    await statsSessionBegin(dir, "T-001")
    now += 1000
    await statsSessionEnd(dir, "s1", usage(10))
    await statsModelEvent(dir, undefined, "fail")
    await flushStats(dir)
    const text = await Bun.file(join(dir, ".auto", "stats.json")).text()
    expect(text).not.toContain('"models"')
    expect(text).not.toContain('"tiers"')
  })

  test("a raw provider/model override value keys by its raw string", async () => {
    await loadStats(dir)
    await statsSessionBegin(dir, "T-001")
    now += 1000
    await statsSessionEnd(dir, "s1", usage(7), "zhipuai/glm-4.6", "deep")
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.roundB.models?.["zhipuai/glm-4.6"]?.usage.input).toBe(7)
    expect(doc.roundB.tiers?.deep?.sessions).toBe(1)
  })

  test("the classify bucket: classifier tokens outside the unit's session totals", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await statsClassifyUsage(dir, usage(42))
    await flushStats(dir)
    const doc = await readDoc()
    for (const bucket of [doc.taskB, doc.phaseB, doc.roundB]) {
      expect(bucket.models?.classify?.usage.input).toBe(42)
      expect(bucket.models?.classify?.sessions).toBe(1)
      expect(bucket.usage.input).toBe(0) // never in the bucket's own totals
      expect(bucket.sessions).toBe(0)
    }
    expect(doc.sessions).toEqual({}) // and never in a per-session record
  })

  test("protocol-drift counters: fail / stuck / reprompt land on the model record in all three buckets", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await statsModelEvent(dir, "glm", "fail")
    await statsModelEvent(dir, "glm", "stuck")
    await statsModelEvent(dir, "glm", "stuck")
    await statsModelEvent(dir, "glm", "reprompt")
    const totals = await statsTotals(dir, "task")
    expect(totals?.models?.glm).toMatchObject({ fails: 1, stuckHints: 2, reprompts: 1, sessions: 0 })
    await statsModelEvent(dir, "opus", "fail")
    await flushStats(dir)
    const doc = await readDoc()
    for (const bucket of [doc.taskB, doc.phaseB, doc.roundB]) {
      expect(bucket.models?.glm?.fails).toBe(1)
      expect(bucket.models?.opus?.fails).toBe(1)
      expect(bucket.models?.opus?.usage.input).toBe(0)
    }
  })

  test("an older stats file loads; the new sections default empty and booking then works", async () => {
    // A pre-registry v:1 document: no models/tiers anywhere, a hand-written
    // task bucket and history aggregate.
    await writeDoc({
      v: 1,
      round: 1,
      phase: "m",
      lastWriteAt: 90_000,
      taskB: { id: "T-001", wallMs: 5000 },
      phaseB: { id: "m", wallMs: 5000 },
      roundB: { id: "1", wallMs: 5000, usage: { input: 40 } },
      sessions: {},
      history: { rounds: 1, totals: { wallMs: 60_000, usage: { input: 30 } } },
    })
    await loadStats(dir)
    const totals = await statsTotals(dir, "task")
    expect(totals?.models).toBeUndefined()
    expect(totals?.tiers).toBeUndefined()
    expect(totals?.usage.input).toBe(0)
    expect((await statsHistory(dir))?.totals.models).toBeUndefined()
    // booking then works on top of the loaded document
    await statsSessionBegin(dir, "T-001")
    now += 1000
    await statsSessionEnd(dir, "s1", usage(5), "glm", "simple")
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.roundB.usage.input).toBe(45) // 40 loaded + 5 booked
    expect(doc.roundB.models?.glm?.usage.input).toBe(5)
    expect(doc.roundB.tiers?.simple?.sessions).toBe(1)
  })

  test("corrupt model sections parse leniently: bad entries drop, the flat fields survive", async () => {
    await writeDoc({
      v: 1,
      round: 1,
      phase: "m",
      lastWriteAt: 90_000,
      taskB: { id: "T-001", wallMs: 5000, models: "nope", tiers: { deep: "nope", simple: { usage: { input: "bad" } } } },
      phaseB: { id: "m" },
      roundB: { id: "1", models: { glm: { usage: { input: 9 }, sessions: "bad", fails: 2, junk: true } } },
      sessions: {},
      history: { rounds: 0 },
    })
    await loadStats(dir)
    const task = await statsTotals(dir, "task")
    expect(task?.models).toBeUndefined() // a non-object section drops whole
    expect(task?.tiers?.simple?.usage.input).toBe(0) // a bad entry keeps its shell
    expect(task?.tiers?.deep).toBeUndefined()
    expect(task?.wallMs).toBe(5000)
    const round = await statsTotals(dir, "round")
    expect(round?.models?.glm?.usage.input).toBe(9) // unknown fields ignored
    expect(round?.models?.glm?.sessions).toBe(0) // bad counter = missing
    expect(round?.models?.glm?.fails).toBe(2)
  })

  test("cross-interruption cumulation: usage, sessions and counters accumulate over reloads", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 5000
    await statsSessionEnd(dir, "s1", usage(100), "glm", "simple")
    await statsModelEvent(dir, "glm", "fail")
    await statsClassifyUsage(dir, usage(10))
    await flushStats(dir)

    // 模拟进程重启: 同任务续跑,同模型再一会话,计数再各加一。
    now += 60_000
    await loadStats(dir)
    await statsTask(dir, "T-001") // 同 id 幂等
    await statsSessionBegin(dir, "T-001")
    now += 3000
    await statsSessionEnd(dir, "s2", usage(50), "glm", "simple")
    await statsModelEvent(dir, "glm", "fail")
    await statsClassifyUsage(dir, usage(5))
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.taskB.models?.glm?.sessions).toBe(2)
    expect(doc.taskB.models?.glm?.usage.input).toBe(150)
    expect(doc.taskB.models?.glm?.fails).toBe(2)
    expect(doc.taskB.models?.classify?.usage.input).toBe(15)
    expect(doc.taskB.models?.classify?.sessions).toBe(2)
    expect(doc.taskB.tiers?.simple?.sessions).toBe(2)
    expect(doc.taskB.usage.input).toBe(150) // classify stays outside the flat totals
    expect(doc.taskB.sessions).toBe(2)
  })

  test("round rollover merges the model and tier sections into history", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 5000
    await statsSessionEnd(dir, "s1", usage(100), "glm", "simple")
    await statsModelEvent(dir, "glm", "fail")
    await statsClassifyUsage(dir, usage(10))
    await flushStats(dir)

    // 进入第 2 轮: 装载时第 1 轮滚进 history(models/tiers 一并入聚合)。
    await mkdir(join(dir, "docs", "R-02"), { recursive: true })
    await loadStats(dir)
    const history = await statsHistory(dir)
    expect(history?.rounds).toBe(1)
    expect(history?.totals.models?.glm?.usage.input).toBe(100)
    expect(history?.totals.models?.glm?.sessions).toBe(1)
    expect(history?.totals.models?.glm?.fails).toBe(1)
    expect(history?.totals.models?.classify?.usage.input).toBe(10)
    expect(history?.totals.tiers?.simple?.sessions).toBe(1)
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.history.totals.models?.glm?.usage.input).toBe(100)
    expect(doc.roundB.models).toBeUndefined() // the new round starts empty (C2 shape)
    expect(doc.roundB.tiers).toBeUndefined()
  })
})
