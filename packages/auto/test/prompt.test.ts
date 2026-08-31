import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { loadModes } from "../src/mode"
import { parse } from "../src/plan"
import { renderText } from "../src/template"
import { verifyTmpDir } from "../src/verify"
import agentTemplate from "../templates/.opencode/agent/auto.md" with { type: "file" }
import planTemplate from "../templates/PLAN.md" with { type: "file" }
import {
  renderDecompose,
  renderDryrun,
  renderFinalTask,
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
    expect(text).toContain("其他任务无需了解")
    expect(text).toContain("T-002: 实现迁移")
    expect(text).toContain("编写迁移脚本。")
    expect(text).toContain("策略选 A 还是 B?")
    expect(text).toContain("选 A")
    expect(text).toContain("由 driver 独占维护")
    // 自动答复要求记录决策过程并标注 AUTO-DECISION
    expect(text).toContain("记录决策过程")
    expect(text).toContain("AUTO-DECISION")
  })
})

describe("renderSubtask", () => {
  const subtask = "编写迁移脚本的 schema 部分"

  test("只做一个子任务并自我检查,验收交给任务级审核(verify 启用)", () => {
    const text = renderSubtask(plan, task, subtask, { verify: true })
    expect(text).toContain(subtask)
    expect(text).toContain("严格只完成这一个子任务")
    expect(text).toContain("自我检查该子任务是否真正完成")
    expect(text).toContain("整个任务的验收在最后由独立审核会话统一进行")
    expect(text).toContain("不要运行任务级 verify(验收由 driver 交独立审核会话处理)、不要更新 docs/")
    expect(text).toContain("T-002: 实现迁移")
    // 状态文件由 driver 维护,不再要求 agent 勾选
    expect(text).toContain("由 driver 独占维护")
    expect(text).toContain("verified 字段")
    expect(text).not.toContain("改为 `- [x]`")
  })

  test("verify 未启用: 不含任务级验收与 verify 描述,仍要求不更新 docs/", () => {
    const text = renderSubtask(plan, task, subtask)
    expect(text).toContain("自我检查该子任务是否真正完成")
    expect(text).toContain("不要更新 docs/(最后统一收尾)")
    expect(text).not.toContain("verify")
    expect(text).not.toContain("验收")
    expect(text).not.toContain("verified 字段")
  })

  test("不含会话内提交要求: 统一提交由 driver 在会话后执行", () => {
    const text = renderSubtask(plan, task, subtask)
    expect(text).not.toContain("git 提交全部未提交改动")
    expect(text).toContain("git 提交由 driver 在会话结束后统一执行")
    expect(text).toContain("不要运行 git commit")
  })
})

describe("renderWrapup", () => {
  test("只执行收尾: docs、report.md,不标 done、不提交", () => {
    const text = renderWrapup(plan, task)
    expect(text).toContain("全部子任务已在之前的会话中逐一完成,不要重做")
    expect(text).toContain("docs/T-002.report.md")
    expect(text).not.toContain("git 提交全部未提交改动")
    expect(text).toContain("git 提交由 driver 在会话结束后统一执行")
    expect(text).toContain("由 driver 独占维护")
    expect(text).not.toContain("把当前任务的状态标记改为 [done]")
  })

  test("verify 处理权在 driver(verify 启用): 收尾不运行 verify、不下结论,由独立审核会话验收", () => {
    const text = renderWrapup(plan, task, { verify: true })
    expect(text).toContain("不要运行任务级 verify、不要下验收结论")
    expect(text).toContain("verify 的处理权在 driver")
    expect(text).toContain("独立审核会话")
    expect(text).toContain("verified 字段")
    expect(text).not.toContain("verified-command")
    expect(text).not.toContain("结论: 通过")
    expect(text).not.toContain("结论: 差距")
  })

  test("verify 未启用: 收尾提示不涉及验收,任务状态由 driver 登记", () => {
    const text = renderWrapup(plan, task)
    expect(text).toContain("任务状态由 driver 在会话结束后统一登记")
    expect(text).not.toContain("verify")
    expect(text).not.toContain("验收")
    expect(text).not.toContain("verified")
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
    expect(text).toContain("只做验证类设计")
    expect(text).toContain("不修改任何实现代码")
    expect(text).toContain("禁止直接执行任何验证脚本或验证性命令")
    expect(text).toContain("验证的执行权在 driver")
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

  test("直读文件分段读、禁止执行验证、替换重验协议与判定协议", () => {
    const text = renderVerifyJudge(plan, task, run)
    expect(text).toContain("直读上述 out/err 文件")
    expect(text).toContain("分段读取")
    expect(text).toContain("不直接判不通过")
    expect(text).toContain("禁止直接执行任何验证脚本或验证性命令")
    expect(text).toContain("验证的执行权在 driver")
    expect(text).toContain("只读检查")
    // 替换重验协议: 新脚本写指定路径,结论为重验,driver 执行后经同一对文件回传
    const replacement = join(verifyTmpDir(dirname(plan.path)), "verify.sh")
    expect(text).toContain(`编写新的验证脚本替换 ${replacement}`)
    expect(text).toContain("结论: 重验")
    expect(text).toContain("整写回传到同一对 out/err 文件")
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

  test("verify 经验沉淀授权: 仅后续未完成任务的 verify 字段,附现值清单", () => {
    const text = renderVerifyJudge(plan, task, run)
    expect(text).toContain("verify 经验沉淀")
    expect(text).toContain("后续未完成任务")
    expect(text).toContain("仅限 verify 字段")
    expect(text).toContain("没有此类问题时不要做任何修改")
    expect(text).toContain("越权编辑会被整体还原")
    // 当前任务为 T-002: 现值清单只列后续未完成且带 verify 的 T-003。
    expect(text).toContain(`后续未完成任务的 verify 字段现值:\n   - T-003: API 返回 200;\n7.`)
    // CURRENT.md 仍禁改
    expect(text).toContain("CURRENT.md 由 driver 独占维护,不得编辑")
  })

  test("运行信息标注看门狗超时原因", () => {
    const text = renderVerifyJudge(plan, task, { ...run, timeoutReason: "idle" })
    expect(text).toContain("持续无输出,看门狗判定无进度")
    const capped = renderVerifyJudge(plan, task, { ...run, timeoutReason: "max" })
    expect(capped).toContain("超过绝对时长上限")
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

  test("early: 告知 verify 脚本并行执行、只读为主,维度 3 静态审核脚本内容", () => {
    const script = join(verifyTmpDir(dirname(plan.path)), "verify.sh")
    const text = renderReview(plan, task, { final: false, early: true })
    expect(text).toContain("并行执行该任务的 verify 脚本")
    expect(text).toContain("避免执行")
    expect(text).toContain("只读方式为主")
    expect(text).toContain(script)
    expect(text).toContain("静态审核")
    expect(text).toContain("运行结果的解读属独立判定会话")
    expect(text).toContain("你不要执行该脚本")
    // 非 early 不带并行窗口措辞,但同样禁止执行验证
    const plain = renderReview(plan, task, { final: false })
    expect(plain).not.toContain("并行")
    expect(plain).not.toContain(script)
    expect(plain).toContain("静态审核")
    expect(plain).toContain("不要执行验证脚本或")
    expect(plain).toContain("验证的执行权在 driver")
  })

  test("early 与 final 可组合: 终审措辞与并行窗口措辞并存", () => {
    const text = renderReview(plan, task, { final: true, early: true })
    expect(text).toContain("docs/final-audit.md")
    expect(text).toContain("最终审核")
    expect(text).toContain("并行执行该任务的 verify 脚本")
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
    expect(text).not.toContain("git 提交全部未提交改动")
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

  test("不含会话内提交要求(state-rule 注入提交原则)", () => {
    expect(renderWhole(plan, task)).not.toContain("git 提交全部未提交改动")
    expect(renderWhole(plan, task)).toContain("git 提交由 driver 在会话结束后统一执行")
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

describe("renderInit", () => {
  test("初始化规划(verify 未启用): 填充 PLAN.md,不含 verify 相关描述", () => {
    const text = renderInit("实现一个待办事项 CLI")
    expect(text).toContain("实现一个待办事项 CLI")
    expect(text).toContain("把 PLAN.md 填充为一份可执行的实施计划")
    expect(text).toContain("只做规划,不实施")
    expect(text).toContain("permission")
    expect(text).not.toContain("verify")
    expect(text).not.toContain("验证")
  })

  test("初始化规划(verify 启用): 注入验收标准要求与验证执行权原则", () => {
    const text = renderInit("实现一个待办事项 CLI", undefined, { verify: true })
    expect(text).toContain("每个任务带 verify 验收标准")
    expect(text).toContain("任务描述不要包含要求执行者亲自运行验证脚本/验证命令")
    expect(text).toContain("验证的执行权在 driver")
    expect(text).toContain("AGENTS.md 验证原则块")
  })

  test("模式导语同样按 verify 门控(migrate 的 verify 字段侧重)", () => {
    const on = renderInit("把项目迁移到新框架", migrate, { verify: true })
    expect(on).toContain("verify 字段优先复用既有的测试/构建命令")
    const off = renderInit("把项目迁移到新框架", migrate)
    expect(off).toContain("基线确认")
    expect(off).not.toContain("verify")
  })
})

const migrate = loadModes().migrate!

describe("模式注入(-m/--mode)", () => {
  test("renderInit 注入 migrate 模式导语;不传模式时不注入", () => {
    const text = renderInit("把项目迁移到新框架", migrate)
    expect(text).toContain("场景模式: migrate")
    expect(text).toContain("外部行为不变")
    expect(text).toContain("基线确认")
    expect(text).toContain("回归验证")
    const plain = renderInit("实现一个待办事项 CLI")
    expect(plain).not.toContain("场景模式")
    expect(plain).not.toContain("基线确认")
  })

  test("执行类模板注入 exec 段;不传模式时不注入", () => {
    for (const text of [
      renderDecompose(plan, task, { mode: migrate }),
      renderSubtask(plan, task, "编写迁移脚本的 schema 部分", { mode: migrate }),
      renderWrapup(plan, task, { mode: migrate }),
      renderWhole(plan, task, { mode: migrate }),
    ]) {
      expect(text).toContain("场景模式注意事项(migrate)")
      expect(text).toContain("对等行为")
      expect(text).toContain("AUTO-DECISION")
    }
    expect(renderDecompose(plan, task)).not.toContain("场景模式注意事项")
    expect(renderSubtask(plan, task, "编写迁移脚本的 schema 部分")).not.toContain("场景模式注意事项")
    expect(renderWrapup(plan, task)).not.toContain("场景模式注意事项")
    expect(renderWhole(plan, task)).not.toContain("场景模式注意事项")
  })
})

describe("renderFinalTask", () => {
  test("audit 首轮: 提案路径、报告协议、无 verify 行块与硬性要求", () => {
    const text = renderFinalTask(plan, "audit", 1, "全部原任务已完成,开始首轮终审", migrate)
    expect(text).toContain("docs/final/plan-audit-r1.md")
    // 上游输入注入
    expect(text).toContain("全部原任务已完成,开始首轮终审")
    // 提案格式
    expect(text).toContain("# <任务标题>")
    // 终审任务不做任务级验收: 提案不再含 verify 行块
    expect(text).not.toContain("verify: command: <命令>")
    expect(text).not.toContain("优先复用原任务的验证命令")
    // 报告协议随提案正文要求下沉
    expect(text).toContain("docs/final/audit-r1.md")
    expect(text).toContain("结论: <概述>")
    expect(text).toContain("策略: 重构|修补|无")
    // 只规划不实施与硬性要求
    expect(text).toContain("只规划不实施")
    expect(text).toContain("产出该提案文件是硬性要求")
    // STATE_RULE / QUESTION_RULE
    expect(text).toContain("由 driver 独占维护")
    expect(text).toContain("AUTO-DECISION")
    // 首轮不做回退重审措辞
    expect(text).not.toContain("不做全量重审")
  })

  test("audit 首轮注入 migrate 的终审侧重;不传模式时不注入", () => {
    expect(renderFinalTask(plan, "audit", 1, "", migrate)).toContain("场景模式侧重(migrate)")
    expect(renderFinalTask(plan, "audit", 1, "", migrate)).toContain("行为对等")
    expect(renderFinalTask(plan, "audit", 1, "", undefined)).not.toContain("场景模式侧重")
    // 无 prior 时不带上游输入块
    expect(renderFinalTask(plan, "audit", 1, "", migrate)).not.toContain("上游输入(终审上游产物指针与残余差距原文)")
  })

  test("audit 第 2 轮: 聚焦残余差距,不做全量重审", () => {
    const text = renderFinalTask(plan, "audit", 2, "docs/final/validate-r1.md 末行: 结论: 差距 空输入未覆盖", migrate)
    expect(text).toContain("docs/final/plan-audit-r2.md")
    expect(text).toContain("docs/final/audit-r2.md")
    expect(text).toContain("聚焦上游残余差距与回归检查")
    expect(text).toContain("不做全量重审")
    expect(text).toContain("结论: 差距 空输入未覆盖")
  })

  test("remediate: 提案路径与修复报告双命名,无模式侧重注入", () => {
    const text = renderFinalTask(plan, "remediate", 1, "docs/final/audit-r1.md 末行: 策略: 修补", migrate)
    expect(text).toContain("docs/final/plan-remediate-r1.md")
    expect(text).toContain("docs/final/refactor-r1.md")
    expect(text).toContain("docs/final/patch-r1.md")
    expect(text).toContain("策略: 修补")
    expect(text).not.toContain("场景模式侧重")
  })

  test("validate 与 finalize: 各自提案路径、结论协议与模式侧重", () => {
    const validate = renderFinalTask(plan, "validate", 1, "docs/final/patch-r1.md 修复已完成", migrate)
    expect(validate).toContain("docs/final/plan-validate-r1.md")
    expect(validate).toContain("docs/final/validate-r1.md")
    expect(validate).toContain("结论: 通过")
    expect(validate).toContain("结论: 差距 <描述>")
    expect(validate).toContain("回归覆盖")
    const finalize = renderFinalTask(plan, "finalize", 1, "docs/final/validate-r1.md 末行: 结论: 通过", migrate)
    expect(finalize).toContain("docs/final/plan-finalize-r1.md")
    expect(finalize).toContain("docs/final/finalize.md")
    expect(finalize).toContain("兼容层的收尾")
  })
})

describe("init 产物模板(PLAN.md / agent 契约)", () => {
  test("verify 启用: PLAN.md 含 verify 字段示例与验证执行权原则", async () => {
    const text = renderText(await Bun.file(planTemplate).text(), { verify: true })
    expect(text).toContain("  - verify: command: <建议的验收命令,如 bun test>")
    expect(text).toContain("验证脚本与验证命令的执行权在 driver")
    expect(text).toContain("opencode-auto check")
    expect(text).toContain("不要手工编写子任务")
  })

  test("verify 未启用: PLAN.md 不含 verify 字段示例与验证原则描述", async () => {
    const text = renderText(await Bun.file(planTemplate).text(), { verify: false })
    expect(text).toContain("## T-001: <任务标题> [pending]")
    expect(text).toContain("<任务描述:目标、范围、关键约束。")
    expect(text).toContain("不要手工编写子任务")
    expect(text).not.toContain("verify")
    expect(text).not.toContain("验证")
  })

  test("verify 未启用: agent 契约不含验收/验证描述,标记块列举相应收窄", async () => {
    const raw = await Bun.file(agentTemplate).text()
    const off = renderText(raw, { verify: false })
    expect(off).toContain("AGENTS.md 不在只读之列")
    expect(off).toContain("不得删除或改写任何")
    expect(off).toContain("opencode-auto 标记块(指针/提交/维护规则")
    expect(off).toContain("遵守 AGENTS.md 维护规则块")
    expect(off).not.toContain("verify")
    expect(off).not.toContain("验证")
  })
})

describe("agent 契约模板(templates/.opencode/agent/auto.md)", () => {
  test("AGENTS.md 条款覆盖全部四类标记块并引用维护规则(防漂移,verify 启用)", async () => {
    const raw = await Bun.file(agentTemplate).text()
    const text = renderText(raw, { verify: true })
    expect(text).toContain("AGENTS.md 不在只读之列")
    // 不得删除或改写任何标记块(指针/验证/提交/维护规则),而非仅旧版的指针块
    expect(text).toContain("不得删除或改写任何")
    expect(text).toContain("opencode-auto 标记块(指针/验证/提交/维护规则")
    expect(text).toContain("<!-- opencode-auto:*:start -->")
    expect(text).toContain("<!-- opencode-auto:*:end -->")
    expect(text).not.toContain("不得删除 opencode-auto 指针块")
    // 更新其余内容时遵守维护规则块(精简/路由/更新不追加/只沉淀持久知识)
    expect(text).toContain("遵守 AGENTS.md 维护规则块")
    expect(text).toContain("docs/agents/")
    expect(text).toContain("保持精简")
    expect(text).toContain("更新不追加")
    expect(text).toContain("只沉淀持久工作流知识")
  })
})

describe("模板渲染完整性", () => {
  test("全部 render* 在代表性参数组合下渲染后不残留模板标签", () => {
    const solo = plan.tasks[0]!
    const texts = [
      renderDecompose(plan, task),
      renderDecompose(plan, task, { mode: migrate }),
      renderSubtask(plan, task, "子任务甲"),
      renderSubtask(plan, task, "子任务甲", { mode: migrate }),
      renderWrapup(plan, task),
      renderWrapup(plan, task, { solo: true, mode: migrate }),
      renderWhole(plan, task, { ondemand: true, continuation: true, mode: migrate }),
      renderVerifyScriptGen(plan, task, "/tmp/auto/verify.sh"),
      renderVerifyJudge(plan, task, { script: "/s", code: 1, ms: 2, timedOut: true, timeoutReason: "idle", out: "/o", err: "/e" }),
      renderFix(plan, task, "差距"),
      renderReview(plan, task, { final: false }),
      renderReview(plan, task, { final: true, early: true }),
      renderReviewFix(plan, task, "差距"),
      renderFinalTask(plan, "audit", 2, "残余差距", migrate),
      renderFinalTask(plan, "finalize", 1, "", undefined),
      renderHandoffSteer(task),
      renderDryrun(),
      renderInit("需求"),
      renderInit("需求", migrate),
      renderInit("需求", migrate, { verify: true }),
      renderDecompose(plan, solo),
      renderHandoffSteer(solo),
    ]
    for (const text of texts) expect(text).not.toMatch(/\{\{|\}\}/)
  })

  test("init 产物模板按 verify 两态渲染后不残留模板标签", async () => {
    for (const raw of [await Bun.file(planTemplate).text(), await Bun.file(agentTemplate).text()]) {
      for (const verify of [true, false]) {
        expect(renderText(raw, { verify })).not.toMatch(/\{\{|\}\}/)
      }
    }
  })
})
