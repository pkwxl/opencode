import { describe, expect, test } from "bun:test"
import { parse } from "../src/plan"
import { renderDecompose, renderSubtask, renderWrapup } from "../src/prompt"

const plan = parse(
  "PLAN.md",
  `## T-001: 搭建 schema [done]
建模。

## T-002: 实现迁移 [blocked]
  - verify: command: bun test
  - question: "策略选 A 还是 B?"
  - answer: "选 A"
  - attempts: 1
编写迁移脚本。

## T-003: 编写 API [pending]
  - verify: API 返回 200
REST 接口。
`,
)

const task = plan.tasks[1]!

describe("renderDecompose", () => {
  test("要求只读分析并产出带 verify 命令的 subtasks.md", () => {
    const text = renderDecompose(plan, task)
    expect(text).toContain("docs/T-002.subtasks.md")
    expect(text).toContain("(verify: `<验证命令>`)")
    expect(text).toContain("只做任务分解,不写实现代码")
    expect(text).toContain("不修改任何实现代码")
    expect(text).toContain("question 工具")
  })

  test("包含已完成任务、当前任务、问答历史与状态文件只读规则", () => {
    const text = renderDecompose(plan, task)
    expect(text).toContain("[done] T-001: 搭建 schema")
    expect(text).toContain("其他任务的描述只作背景")
    expect(text).toContain("T-002: 实现迁移")
    expect(text).toContain("编写迁移脚本。")
    expect(text).toContain("策略选 A 还是 B?")
    expect(text).toContain("选 A")
    expect(text).toContain("由 driver 独占维护")
  })
})

describe("renderSubtask", () => {
  const subtask = "编写迁移脚本的 schema 部分 (verify: `bun test test/schema.test.ts`)"

  test("只做一个子任务并运行其 verify 命令,不做收尾", () => {
    const text = renderSubtask(plan, task, subtask)
    expect(text).toContain(subtask)
    expect(text).toContain("严格只完成这一个子任务")
    expect(text).toContain("运行该子任务末尾标注的 verify 命令")
    expect(text).toContain("不要运行任务级 verify、不要更新 docs/")
    expect(text).toContain("T-002: 实现迁移")
    // 状态文件由 driver 维护,不再要求 agent 勾选
    expect(text).toContain("由 driver 独占维护")
    expect(text).not.toContain("改为 `- [x]`")
  })

  test("--commit-subtask 启用时注入子任务级提交要求", () => {
    const on = renderSubtask(plan, task, subtask, { commitSubtask: true })
    expect(on).toContain("git 提交全部未提交改动,实现子任务级别的变动历史追踪")
    expect(on).toContain("find . -name .git")
    const off = renderSubtask(plan, task, subtask)
    expect(off).not.toContain("git 提交全部未提交改动")
  })
})

describe("renderWrapup", () => {
  test("只执行收尾: docs、report.md、清扫提交,不标 done", () => {
    const text = renderWrapup(plan, task)
    expect(text).toContain("全部子任务已在之前的会话中逐一完成并验证,不要重做")
    expect(text).toContain("docs/T-002.report.md")
    expect(text).toContain("verified-command")
    expect(text).toContain("结论: 通过")
    expect(text).toContain("结论: 差距")
    expect(text).toContain("git 提交全部未提交改动")
    expect(text).toContain("由 driver 独占维护")
    expect(text).not.toContain("把当前任务的状态标记改为 [done]")
  })

  test("command: 前缀的任务直接照抄命令;自然语言 verify 要求翻译", () => {
    expect(renderWrapup(plan, task)).toContain("直接照抄:\\`bun test\\`".replaceAll("\\`", "`"))
    const nl = renderWrapup(plan, plan.tasks[2]!)
    expect(nl).toContain('任务 verify 字段是"API 返回 200",把它翻译为具体的测试/检查命令')
  })
})
