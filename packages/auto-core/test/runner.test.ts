import { describe, expect, test } from "bun:test"
import { parse } from "../src/plan"
import { handoffSteer, handoverDue } from "../src/runner"

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
    expect(steer.text).toContain("docs/T-001.handoff.md")
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
