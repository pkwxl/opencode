import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Interactive } from "../src/interactive"
import { subtaskProgressLine, waitBetweenTasks } from "../src/loop"
import { flushStats, loadStats, setStatsClock, statsTask, statsTotals } from "../src/stats"

// T-002: loop 生命周期接线 —— 进度心跳(trackSubtasks → subtaskProgressLine)改读
// stats 任务桶累计的守卫与文案断言(statsId 守卫、"本进程"仅当 ≠ 累计时输出)。

describe("subtaskProgressLine 进度心跳", () => {
  let dir: string
  let path: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-loop-"))
    path = join(dir, "PLAN.md")
    now = 1_000_000
    setStatsClock(() => now)
    await Bun.write(
      path,
      ["# 计划", "", "## T-001: 第一任务 [in_progress]", "", "- [x] 已完成子任务", "- [ ] 待办子任务", ""].join("\n"),
    )
  })

  afterEach(async () => {
    setStatsClock()
    await flushStats(dir).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  })

  test("statsId 守卫: 桶身份与当前任务不一致时不信 statsTotals,跳过上报", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-999") // 桶身份是别的任务
    expect(await subtaskProgressLine(path, dir)).toBeUndefined()
    // 未装载句柄(目录从未 loadStats)同样守卫失败
    const fresh = await mkdtemp(join(tmpdir(), "auto-loop-fresh-"))
    try {
      await Bun.write(join(fresh, "PLAN.md"), await Bun.file(path).text())
      expect(await subtaskProgressLine(join(fresh, "PLAN.md"), fresh)).toBeUndefined()
    } finally {
      await rm(fresh, { recursive: true, force: true })
    }
  })

  test("守卫通过: 累计用时读任务桶(含开放段外推);未中断时无“本进程”段", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    now += 24 * 60_000
    const line = await subtaskProgressLine(path, dir)
    expect(line).toContain("⏳ T-001 子任务进度 1/2")
    expect(line).toContain("累计用时 24 分 0 秒")
    expect(line).not.toContain("本进程") // 本进程 == 累计,省略
    expect(line).toContain("预计剩余 24 分 0 秒") // 线性外推: 1/2 完成 → 剩余 = 已用
  })

  test("跨中断续接: 累计含上一进程,“本进程” ≠ 累计时输出", async () => {
    // 第一“进程”: 跑 18 分钟后优雅收口(等价 kill 后经折旧的已入账部分)。
    await loadStats(dir)
    await statsTask(dir, "T-001")
    now += 18 * 60_000
    await flushStats(dir)
    // 第二“进程”: 续跑同任务(statsTask 同 id 幂等,桶不重置),再跑 6 分钟。
    expect(await loadStats(dir)).toBeDefined() // 有旧文档 → 续接信息
    await statsTask(dir, "T-001")
    now += 6 * 60_000
    const line = await subtaskProgressLine(path, dir)
    expect(line).toContain("累计用时 24 分 0 秒(本进程 6 分 0 秒)")
    expect(line).toContain("预计剩余 24 分 0 秒") // 外推基于累计口径
  })
})

// T-005 接线覆盖: waitBetweenTasks(--wait-between 任务间暂停)传 dir 时暂停区间
// 经 statsWaitBegin/End 从总用时扣除、单记 waitMs。
describe("waitBetweenTasks 等待扣除(stats 接线)", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-loop-wait-"))
    now = 100_000
    setStatsClock(() => now)
  })

  afterEach(async () => {
    setStatsClock()
    await flushStats(dir).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  })

  // fake 常驻输入行: 作答前推进注入时钟,模拟人工等待;answer 控制回车/超时语义。
  function fakeRepl(answer: string | undefined, advance: number): Interactive {
    return {
      attach: () => {},
      question: async () => {
        now += advance
        return answer as string
      },
      close: () => {},
    } as unknown as Interactive
  }

  test("回车立即继续: 等待 40s 不进 wallMs,单记 waitMs", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    now += 5000
    await waitBetweenTasks(5, "T-002", fakeRepl("", 40_000), dir)
    const totals = await statsTotals(dir, "task")
    expect(totals?.wallMs).toBe(5000)
    expect(totals?.waitMs).toBe(40_000)
  })

  test("超时自动继续(answer=undefined): 同样扣除;dir 缺省则统计零接触", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await waitBetweenTasks(5, "T-002", fakeRepl(undefined, 5 * 60_000), dir)
    expect((await statsTotals(dir, "task"))?.waitMs).toBe(5 * 60_000)
    // dir 缺省: 空转,不落盘不装载
    const fresh = await mkdtemp(join(tmpdir(), "auto-loop-wait-fresh-"))
    try {
      await waitBetweenTasks(5, "T-002", fakeRepl("", 1000))
      expect(await Bun.file(join(fresh, ".auto", "stats.json")).exists()).toBe(false)
    } finally {
      await rm(fresh, { recursive: true, force: true })
    }
  })
})
