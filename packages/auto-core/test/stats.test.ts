import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { flushStats, loadStats, MAX_TICK, setStatsClock, statsBoot, statsId, statsPhase, statsTask, statsTotals, type StatsDoc } from "../src/stats"

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
