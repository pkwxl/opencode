import { describe, expect, test } from "bun:test"
import { parse } from "../src/plan"
import { render } from "../src/prompt"

const plan = parse(
  "PLAN.md",
  `## T-001: 搭建 schema [done]
建模。

## T-002: 实现迁移 [blocked]
  - verify: bun test
  - question: "策略选 A 还是 B?"
  - answer: "选 A"
  - attempts: 1
编写迁移脚本。

## T-003: 编写 API [pending]
REST 接口。
`,
)

describe("render", () => {
  const task = plan.tasks[1]!

  test("包含已完成任务、当前任务与问答历史", () => {
    const text = render(plan, task)
    expect(text).toContain("[done] T-001: 搭建 schema")
    expect(text).toContain("T-002: 实现迁移")
    expect(text).toContain("编写迁移脚本。")
    expect(text).toContain("策略选 A 还是 B?")
    expect(text).toContain("选 A")
  })

  test("包含完成契约与 verify 命令", () => {
    const text = render(plan, task)
    expect(text).toContain("question 工具")
    expect(text).toContain("`bun test`")
    expect(text).toContain("[done]")
  })

  test("无问答历史时不含阻塞段落", () => {
    const text = render(plan, plan.tasks[2]!)
    expect(text).not.toContain("已获解答")
    expect(text).toContain("运行项目自身的测试/检查")
  })
})
