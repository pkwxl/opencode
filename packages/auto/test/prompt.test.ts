import { describe, expect, test } from "bun:test"
import { parse } from "../src/plan"
import {
  renderCommitAll,
  renderDecompose,
  renderDryrun,
  renderHandoffSteer,
  renderInit,
  renderSubtask,
  renderVerify,
  renderWhole,
  renderWrapup,
  VERDICT_FILE,
} from "../src/prompt"

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
  test("要求只读分析并产出 subtasks.md 检查项", () => {
    const text = renderDecompose(plan, task)
    expect(text).toContain("docs/T-002.subtasks.md")
    expect(text).toContain("- [ ] <子任务描述>")
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
  const subtask = "编写迁移脚本的 schema 部分"

  test("只做一个子任务并自我检查,验收交给任务级审核", () => {
    const text = renderSubtask(plan, task, subtask)
    expect(text).toContain(subtask)
    expect(text).toContain("严格只完成这一个子任务")
    expect(text).toContain("自我检查该子任务是否真正完成")
    expect(text).toContain("整个任务的验收在最后由独立审核会话统一进行")
    expect(text).toContain("不要运行任务级 verify、不要更新 docs/")
    expect(text).toContain("T-002: 实现迁移")
    // 状态文件由 driver 维护,不再要求 agent 勾选
    expect(text).toContain("由 driver 独占维护")
    expect(text).not.toContain("改为 `- [x]`")
  })

  test("--commit subtask 启用时注入子任务级提交要求", () => {
    const on = renderSubtask(plan, task, subtask, { commit: "subtask" })
    expect(on).toContain("git 提交全部未提交改动,实现子任务级别的变动历史追踪")
    expect(on).toContain("find . -name .git")
    const off = renderSubtask(plan, task, subtask)
    expect(off).not.toContain("git 提交全部未提交改动")
  })
})

describe("renderWrapup", () => {
  test("只执行收尾: docs、report.md、清扫提交,不标 done", () => {
    const text = renderWrapup(plan, task)
    expect(text).toContain("全部子任务已在之前的会话中逐一完成,不要重做")
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

  test("--commit once/none 省略清扫提交;--commit task 保留", () => {
    expect(renderWrapup(plan, task, { commit: "task" })).toContain("git 提交全部未提交改动")
    expect(renderWrapup(plan, task, { commit: "once" })).not.toContain("git 提交")
    expect(renderWrapup(plan, task, { commit: "none" })).not.toContain("git 提交")
  })

  test("solo 模式(off/ondemand)不提及子任务", () => {
    expect(renderWrapup(plan, task, { solo: true })).toContain("实现已在之前的会话中完成")
    expect(renderWrapup(plan, task)).toContain("全部子任务已在之前的会话中逐一完成")
  })
})

describe("renderVerify", () => {
  test("任务级审核: 独立判定、引用收尾报告与任务 verify 字段、结论写入判定文件", () => {
    const text = renderVerify(plan, task)
    expect(text).toContain("独立审核者")
    expect(text).toContain("建议的验证命令仅供参考")
    expect(text).toContain("不要因为命令本身的问题判不通过")
    expect(text).toContain("禁止修改任何实现代码")
    expect(text).toContain(VERDICT_FILE)
    expect(text).toContain("结论: 通过")
    expect(text).toContain("结论: 差距")
    expect(text).toContain("verified-command")
    expect(text).toContain("由 driver 独占维护")
    expect(text).toContain("docs/T-002.report.md")
    expect(text).toContain('任务 verify 字段是"command: bun test"')
    expect(text).toContain("不要重做实现")
    const nl = renderVerify(plan, plan.tasks[2]!)
    expect(nl).toContain('任务 verify 字段是"API 返回 200"')
  })
})

describe("renderWhole", () => {
  test("off 模式: 单会话完成整个任务,不含交接条款", () => {
    const text = renderWhole(plan, task)
    expect(text).toContain("你本次负责整个任务,在单个会话内完成,不做子任务分解")
    expect(text).toContain("T-002: 实现迁移")
    expect(text).not.toContain("handoff.md")
    expect(text).not.toContain("git 提交")
  })

  test("ondemand 模式: 附交接条款;continuation 要求先读交接文档", () => {
    const text = renderWhole(plan, task, { ondemand: true })
    expect(text).toContain("docs/T-002.handoff.md")
    expect(text).toContain("[driver] 上下文即将达到上限")
    expect(text).not.toContain("先读 docs/T-002.handoff.md")
    const cont = renderWhole(plan, task, { ondemand: true, continuation: true })
    expect(cont).toContain("先读 docs/T-002.handoff.md")
    expect(cont).toContain("据此继续")
  })

  test("--commit subtask 时包含提交步骤", () => {
    expect(renderWhole(plan, task, { commit: "subtask" })).toContain("git 提交全部未提交改动")
    expect(renderWhole(plan, task, { commit: "task" })).not.toContain("git 提交")
  })

  test("交接提示要求写出状态行", () => {
    const steer = renderHandoffSteer(task)
    expect(steer).toContain("docs/T-002.handoff.md")
    expect(steer).toContain("状态: 继续")
    expect(steer).toContain("状态: 完成")
  })
})

describe("renderDryrun", () => {
  test("权限预检: 列出授权外访问并逐只读探查,报告写入 .auto/dryrun.md", () => {
    const text = renderDryrun()
    expect(text).toContain("权限预检")
    expect(text).toContain("opencode.json")
    expect(text).toContain("只读探查")
    expect(text).toContain(".auto/dryrun.md")
    expect(text).toContain("不修改任何实现代码")
  })
})

describe("renderCommitAll", () => {
  test("整体提交: 只做一次提交,含嵌套仓库规则", () => {
    const text = renderCommitAll(plan)
    expect(text).toContain("git 提交全部未提交改动")
    expect(text).toContain("find . -name .git")
    expect(text).toContain("整个计划完成")
  })
})

describe("renderInit", () => {
  test("初始化规划: 填充 PLAN.md,只规划不实施,包含用户提示词", () => {
    const text = renderInit("实现一个待办事项 CLI")
    expect(text).toContain("实现一个待办事项 CLI")
    expect(text).toContain("把 PLAN.md 填充为一份可执行的实施计划")
    expect(text).toContain("只做规划,不实施")
    expect(text).toContain("verify")
    expect(text).toContain("permission")
  })
})
