import { describe, expect, test } from "bun:test"
import { PassThrough, Writable } from "node:stream"
import type { Interactive } from "../src/interactive"
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
