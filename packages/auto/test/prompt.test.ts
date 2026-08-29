import { describe, expect, test } from "bun:test"
import { parse } from "../src/plan"
import {
  renderCommitAll,
  renderDecompose,
  renderDryrun,
  renderFix,
  renderHandoffSteer,
  renderInit,
  renderReview,
  renderReviewFix,
  renderSubtask,
  renderVerifyJudge,
  renderVerifyScriptGen,
  renderWhole,
  renderWrapup,
  REVIEW_FILE,
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
    expect(text).toContain("不要运行任务级 verify(验收由 driver 交独立审核会话处理)、不要更新 docs/")
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
    expect(text).toContain("git 提交全部未提交改动")
    expect(text).toContain("由 driver 独占维护")
    expect(text).not.toContain("把当前任务的状态标记改为 [done]")
  })

  test("verify 处理权在 driver: 收尾不运行 verify、不下结论,由独立审核会话验收", () => {
    const text = renderWrapup(plan, task)
    expect(text).toContain("不要运行任务级 verify、不要下验收结论")
    expect(text).toContain("verify 的处理权在 driver")
    expect(text).toContain("独立审核会话")
    expect(text).not.toContain("verified-command")
    expect(text).not.toContain("结论: 通过")
    expect(text).not.toContain("结论: 差距")
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

describe("renderFix", () => {
  test("把审核差距反馈回执行会话: 只修差距、不运行 verify、不下结论", () => {
    const text = renderFix(plan, task, "迁移脚本缺少回滚逻辑")
    expect(text).toContain("迁移脚本缺少回滚逻辑")
    expect(text).toContain("验收未通过")
    expect(text).toContain("只修复审核指出的差距")
    expect(text).toContain("不要运行任务级 verify")
    expect(text).toContain("由 driver 独占维护")
    expect(text).not.toContain("verified-command")
  })
})

describe("renderVerifyScriptGen", () => {
  test("生成会话: 脚本写入指定路径并 chmod,只读分析、硬性要求产出", () => {
    const text = renderVerifyScriptGen(plan, task, "/tmp/auto/verify.sh")
    expect(text).toContain("/tmp/auto/verify.sh")
    expect(text).toContain("chmod +x")
    expect(text).toContain("只读分析")
    expect(text).toContain("只做验证类操作")
    expect(text).toContain("不修改任何实现代码")
    expect(text).toContain("不要执行你写出的脚本")
    expect(text).toContain("产出该脚本是硬性要求")
    expect(text).toContain('任务 verify 字段是"command: bun test"')
    expect(text).toContain("question 工具")
    expect(text).toContain("由 driver 独占维护")
  })

  test("自然语言 verify 同样给出验收标准语义", () => {
    expect(renderVerifyScriptGen(plan, plan.tasks[2]!, "/tmp/auto/verify.sh")).toContain('任务 verify 字段是"API 返回 200"')
  })
})

describe("renderVerifyJudge", () => {
  const run = {
    script: "/tmp/pkg/verify.sh",
    code: 124,
    ms: 600012,
    timedOut: true,
    out: "/tmp/pkg/verify.out",
    err: "/tmp/pkg/verify.err",
  }

  test("注入脚本路径、退出码、耗时、超时与 out/err 路径", () => {
    const text = renderVerifyJudge(plan, task, run)
    expect(text).toContain("/tmp/pkg/verify.sh")
    expect(text).toContain("124")
    expect(text).toContain("600012ms")
    expect(text).toContain("超时: 是")
    expect(text).toContain("/tmp/pkg/verify.out")
    expect(text).toContain("/tmp/pkg/verify.err")
    const fresh = renderVerifyJudge(plan, task, { ...run, timedOut: false })
    expect(fresh).toContain("超时: 否")
  })

  test("直读文件分段读、退出码不直接判死、等价验证与判定协议", () => {
    const text = renderVerifyJudge(plan, task, run)
    expect(text).toContain("直读上述 out/err 文件")
    expect(text).toContain("分段读取")
    expect(text).toContain("不直接判不通过")
    expect(text).toContain("等价方式验证")
    expect(text).toContain("只判定不修复")
    expect(text).toContain(VERDICT_FILE)
    expect(text).toContain("结论: 通过")
    expect(text).toContain("结论: 差距")
    expect(text).toContain("verified-command")
    expect(text).toContain("docs/T-002.report.md")
    expect(text).toContain('任务 verify 字段是"command: bun test"')
    expect(text).toContain("由 driver 独占维护")
    expect(text).toContain("不要重做")
  })
})

describe("renderReview", () => {
  test("非 final: 三维度审核、范围限于本任务改动、产出 audit 与结论文件", () => {
    const text = renderReview(plan, task, { final: false })
    expect(text).toContain("忠实性")
    expect(text).toContain("正确性")
    expect(text).toContain("验证过程")
    expect(text).toContain("docs/T-002.audit.md")
    expect(text).toContain(REVIEW_FILE)
    expect(text).toContain("docs/T-002.report.md")
    expect(text).toContain("git log/status")
    expect(text).toContain("禁止审核其他任务的代码")
    expect(text).toContain("只审不改")
    expect(text).toContain("结论: 通过")
    expect(text).toContain("结论: 差距")
    expect(text).toContain("由 driver 独占维护")
    expect(text).not.toContain("docs/final-audit.md")
  })

  test("final: 对全计划全面审核,报告写 final-audit.md", () => {
    const text = renderReview(plan, task, { final: true })
    expect(text).toContain("docs/final-audit.md")
    expect(text).toContain("最终审核")
    expect(text).toContain("整个计划的设计、实现与文档")
    expect(text).not.toContain("docs/T-002.audit.md")
    expect(text).not.toContain("禁止审核其他任务的代码")
  })
})

describe("renderReviewFix", () => {
  test("把审核差距转为自包含 fix 检查项: 只规划不修复、硬性要求产出", () => {
    const text = renderReviewFix(plan, task, "错误处理未覆盖空输入")
    expect(text).toContain("错误处理未覆盖空输入")
    expect(text).toContain("docs/T-002.fix.md")
    expect(text).toContain("docs/T-002.audit.md")
    expect(text).toContain("- [ ] <修复步骤描述>")
    expect(text).toContain("自包含")
    expect(text).toContain("只规划不修复")
    expect(text).toContain("唯一可写的文件是 docs/T-002.fix.md")
    expect(text).toContain("产出该文件是硬性要求")
    expect(text).toContain("由 driver 独占维护")
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
