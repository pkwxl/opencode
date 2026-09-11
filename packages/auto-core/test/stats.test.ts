import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { flushStats, loadStats, MAX_TICK, setStatsClock, type StatsDoc } from "../src/stats"

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
