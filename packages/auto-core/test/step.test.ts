import { describe, expect, test, afterEach, beforeEach } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough, Writable } from "node:stream"
import type { Interactive } from "../src/interactive"
import {
  flushStats,
  loadStats,
  setStatsClock,
  statsSessionBegin,
  statsSessionEnd,
  statsTask,
  statsTotals,
} from "../src/stats"
import { stepApplies, stepPause } from "../src/step"
import type { StepMode } from "../src/switches"

describe("stepApplies(包含式粒度判定)", () => {
  const cases: Array<[StepMode, Array<["phase" | "task" | "subtask", boolean]>]> = [
    ["off", [["phase", false], ["task", false], ["subtask", false]]],
    ["phase", [["phase", true], ["task", false], ["subtask", false]]],
    ["task", [["phase", true], ["task", true], ["subtask", false]]],
    ["subtask", [["phase", true], ["task", true], ["subtask", true]]],
  ]
  for (const [step, boundaries] of cases) {
    test(`step=${step}: ${boundaries.filter(([, hit]) => hit).map(([b]) => b).join("+") || "全不暂停"}`, () => {
      for (const [boundary, hit] of boundaries) expect(stepApplies(step, boundary)).toBe(hit)
    })
  }
})

// 用注入的流驱动暂停 readline;显式 step 覆盖直测 IO(不依赖 autoSwitches 的
// memo),off 同样显式传入保持密闭(不受运行环境变量影响)。
function setup() {
  const input = new PassThrough()
  const chunks: string[] = []
  const output = new Writable({ write: (chunk, _enc, cb) => void chunks.push(chunk.toString()) })
  return { input, io: { input, output }, written: () => chunks.join("") }
}

describe("stepPause(硬暂停等待)", () => {
  test("off(缺省档位): 零行为立即返回,不碰 stdin", async () => {
    const ctx = setup()
    await stepPause("subtask", "T-001 子任务 1", { io: ctx.io, step: "off" })
    expect(ctx.written()).toBe("")
  })

  test("命中边界: 等待回车放行,提示含档位与标签", async () => {
    const ctx = setup()
    const paused = stepPause("task", "任务 T-001 示例", { io: ctx.io, step: "subtask" })
    ctx.input.write("\n")
    await paused
    expect(ctx.written()).toContain("step=subtask")
    expect(ctx.written()).toContain("任务 T-001 示例")
  })

  test("任意输入行(非空)同样放行", async () => {
    const ctx = setup()
    const paused = stepPause("phase", "阶段 m 迁移实现 交接", { io: ctx.io, step: "phase" })
    ctx.input.write("继续\n")
    await expect(paused).resolves.toBeUndefined()
  })

  test("stdin 关闭(管道结束): 回落自动放行,不挂死", async () => {
    const ctx = setup()
    const paused = stepPause("task", "任务 T-001 示例", { io: ctx.io, step: "task" })
    ctx.input.end()
    await expect(paused).resolves.toBeUndefined()
  })

  test("interactive 常驻输入行接收: 提示语透传,作答即放行", async () => {
    const questions: string[] = []
    const interactive = {
      attach: () => {},
      question: async (promptText: string) => {
        questions.push(promptText)
        return ""
      },
      close: () => {},
    } as unknown as Interactive
    await stepPause("subtask", "T-001 子任务 2", { interactive, step: "subtask" })
    expect(questions).toEqual([`⏸ 步进暂停(step=subtask): T-001 子任务 2 已完成,回车继续: `])
    // 档位未覆盖的边界(interactive 下同样零行为): task 不覆盖 subtask
    await stepPause("subtask", "T-001 子任务 3", { interactive, step: "task" })
    expect(questions).toHaveLength(1)
  })
})

// T-005 接线覆盖: stepPause 传 dir 时暂停区间经 statsWaitBegin/End 从总用时/AI
// 用时扣除、单记 waitMs(模块级扣除口径在 stats.test.ts,此处只验证挂点接线)。
describe("stepPause 等待扣除(stats 接线)", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-step-stats-"))
    now = 100_000
    setStatsClock(() => now)
  })

  afterEach(async () => {
    setStatsClock()
    await flushStats(dir).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  })

  // 等提示语真正输出(readline 已建立、statsWaitBegin 已完成)再推进时钟作答,
  // 保证等待区间完全落在注入时钟的可控段内。
  async function untilPrompt(written: () => string) {
    for (let i = 0; i < 100 && !written().includes("回车继续"); i++) {
      await new Promise((resolve) => setImmediate(resolve))
    }
  }

  test("会话内暂停: 等待不进 aiMs/wallMs,单记 waitMs,per-session wallMs 含等待", async () => {
    const ctx = setup()
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 3000 // AI 活跃 3s
    const paused = stepPause("subtask", "T-001 子任务 1", { io: ctx.io, step: "subtask", dir })
    await untilPrompt(ctx.written)
    now += 4000 // 人工等待 4s
    ctx.input.write("\n")
    await paused
    now += 2000 // AI 再活跃 2s
    const report = await statsSessionEnd(dir, "s1", { input: 1, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 1 })
    expect(report?.thisAiMs).toBe(5000) // 3000 + 2000,等待 4000 不计
    expect(report?.session.wallMs).toBe(9000) // per-session wallMs = aiMs + waitMs
    const totals = await statsTotals(dir, "task")
    expect(totals?.aiMs).toBe(5000)
    expect(totals?.wallMs).toBe(5000) // 三桶 wallMs 排除纯人工等待
    expect(totals?.waitMs).toBe(4000)
  })

  test("interactive 路径同样包裹;off 零行为时统计零接触", async () => {
    const interactive = {
      attach: () => {},
      question: async () => {
        now += 2500 // 人工等待 2.5s
        return ""
      },
      close: () => {},
    } as unknown as Interactive
    await loadStats(dir)
    await stepPause("task", "任务 T-001 示例", { interactive, step: "off", dir }) // off: 零行为
    now += 1000
    await stepPause("task", "任务 T-001 示例", { interactive, step: "task", dir })
    const totals = await statsTotals(dir, "task")
    expect(totals?.waitMs).toBe(2500)
    expect(totals?.wallMs).toBe(1000) // off 未暂停的 1s + 等待 2.5s 已扣除
  })
})
