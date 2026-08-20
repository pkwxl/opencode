import { describe, expect, test } from "bun:test"
import { parse } from "../src/plan"
import { render, renderSubtask, renderWrapup } from "../src/prompt"

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
    expect(text).toContain("勾选任务正文中对应的验证检查项")
    expect(text).toContain("未实际完成的项不得勾选")
  })

  test("有问题但无解答时提示已在会话外解决、不要重问", () => {
    const blocked = parse(
      "PLAN.md",
      `## T-001: 写文件 [blocked]
  - question: "是否允许放行写权限?"
  - attempts: 1
正文。
`,
    )
    const text = render(blocked, blocked.tasks[0]!)
    expect(text).toContain("是否允许放行写权限?")
    expect(text).toContain("会话外处理完毕")
    expect(text).toContain("不要再就同一问题调用 question 工具")
    expect(text).not.toContain("已获解答")
  })

  test("无问答历史时不含阻塞段落", () => {
    const text = render(plan, plan.tasks[2]!)
    expect(text).not.toContain("已获解答")
    expect(text).toContain("运行项目自身的测试/检查")
  })

  test("--commit-subtask 启用时注入子任务级提交要求", () => {
    const on = render(plan, task, { commitSubtask: true })
    expect(on).toContain("每完成并勾选一项子任务检查项")
    expect(on).toContain("子任务级别的变动历史追踪")
    const off = render(plan, task)
    expect(off).not.toContain("子任务级别的变动历史追踪")
  })

  test("--new-session-subtask 子任务会话只做一项子任务并不做收尾", () => {
    const text = renderSubtask(plan, task, "编写迁移脚本的 schema 部分")
    expect(text).toContain("编写迁移脚本的 schema 部分")
    expect(text).toContain("严格只完成这一个子任务")
    expect(text).toContain("改为 `- [x]`")
    expect(text).toContain("不要运行 verify、不要把任务标记为 [done]、不要更新 docs/")
    expect(text).toContain("T-002: 实现迁移")
    expect(text).not.toContain("git 提交全部未提交改动")
    const committed = renderSubtask(plan, task, "编写迁移脚本的 schema 部分", { commitSubtask: true })
    expect(committed).toContain("git 提交全部未提交改动,实现子任务级别的变动历史追踪")
    expect(committed).toContain("find . -name .git")
  })

  test("--new-session-subtask 收尾会话只执行完成契约", () => {
    const text = renderWrapup(plan, task)
    expect(text).toContain("全部子任务已在之前的会话中逐一完成并勾选,不要重做")
    expect(text).toContain("`bun test`")
    expect(text).toContain("verified")
    expect(text).toContain("[done]")
    expect(text).toContain("git 提交全部未提交改动")
    expect(text).not.toContain("每完成并勾选一项子任务检查项")
  })
})
