// src/prompt.ts 验收族渲染的单测: verify 脚本生成/判定(verifyScriptGen/verifyJudge)与审核(review/reviewFix)。
// 拆分自 test/prompt.test.ts(plans/0024-module-split-plan.md S19,纯搬运)。

import { describe, expect, test } from "bun:test"
import { dirname, join } from "node:path"
import {
  renderReview,
  renderReviewFix,
  renderVerifyJudge,
  renderVerifyScriptGen,
  REVIEW_FILE,
  VERDICT_FILE,
} from "../src/prompt"
import { verifyTmpDir } from "../src/verify"
import { plan, task } from "./fixtures/prompt"

describe("renderVerifyScriptGen", () => {
  test("生成会话: 脚本写入指定路径并 chmod,只读分析、硬性要求产出", () => {
    const text = renderVerifyScriptGen(plan, task, "/tmp/auto/verify.sh")
    expect(text).toContain("/tmp/auto/verify.sh")
    expect(text).toContain("chmod +x")
    expect(text).toContain("只读分析")
    expect(text).toContain("只做验证类设计")
    expect(text).toContain("不修改任何实现代码")
    expect(text).toContain("禁止直接执行任何验证脚本或验证性命令")
    expect(text).toContain("验证的执行权在 DRIVER")
    expect(text).toContain("产出该脚本是硬性要求")
    expect(text).toContain('任务 verify 字段是"command: bun test"')
    expect(text).toContain("question tool")
    expect(text).toContain("maintained by the DRIVER alone")
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
  }

  test("注入脚本路径、退出码、耗时、超时与输出文件路径", () => {
    const text = renderVerifyJudge(plan, task, run)
    expect(text).toContain("/tmp/pkg/verify.sh")
    expect(text).toContain("124")
    expect(text).toContain("600012ms")
    expect(text).toContain("超时: 是")
    expect(text).toContain("/tmp/pkg/verify.out")
    const fresh = renderVerifyJudge(plan, task, { ...run, timedOut: false })
    expect(fresh).toContain("超时: 否")
  })

  test("直读文件分段读、禁止执行验证、替换重验协议与判定协议", () => {
    const text = renderVerifyJudge(plan, task, run)
    expect(text).toContain("直读上述输出文件")
    expect(text).toContain("分段读取")
    expect(text).toContain("不直接判不通过")
    expect(text).toContain("禁止直接执行任何验证脚本或验证性命令")
    expect(text).toContain("验证的执行权在 DRIVER")
    expect(text).toContain("只读检查")
    // 替换重验协议: 新脚本写指定路径,结论为重验,DRIVER 执行后经同一输出文件回传
    const replacement = join(verifyTmpDir(dirname(plan.path)), "verify.sh")
    expect(text).toContain(`编写新的验证脚本替换 ${replacement}`)
    expect(text).toContain("结论: 重验")
    expect(text).toContain("合并整写回传到同一输出文件")
    expect(text).toContain("只判定不修复")
    expect(text).toContain(VERDICT_FILE)
    expect(text).toContain("结论: 通过")
    expect(text).toContain("结论: 差距")
    expect(text).toContain("verified-command")
    expect(text).toContain("docs/T-002/report.md")
    expect(text).toContain('任务 verify 字段是"command: bun test"')
    expect(text).toContain("由 DRIVER 独占维护")
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
    expect(text).toContain("CURRENT.md 由 DRIVER 独占维护,不得编辑")
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
    expect(text).toContain("docs/T-002/audit.md")
    expect(text).toContain(REVIEW_FILE)
    expect(text).toContain("docs/T-002/report.md")
    expect(text).toContain("git log/status")
    expect(text).toContain("禁止审核其他任务的代码")
    expect(text).toContain("只审不改")
    expect(text).toContain("结论: 通过")
    expect(text).toContain("结论: 差距")
    expect(text).toContain("maintained by the DRIVER alone")
    expect(text).not.toContain("docs/final-audit.md")
  })

  test("final: 对全计划全面审核,终审审计并入任务审计路径(P1-D2)", () => {
    const text = renderReview(plan, task, { final: true })
    expect(text).toContain("最终审核")
    expect(text).toContain("整个计划的设计、实现与文档")
    expect(text).toContain("docs/T-002/audit.md")
    expect(text).not.toContain("docs/final-audit.md")
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
    expect(plain).toContain("验证的执行权在 DRIVER")
  })

  test("early 与 final 可组合: 终审措辞与并行窗口措辞并存", () => {
    const text = renderReview(plan, task, { final: true, early: true })
    expect(text).toContain("docs/T-002/audit.md")
    expect(text).toContain("最终审核")
    expect(text).toContain("并行执行该任务的 verify 脚本")
  })
})

describe("renderReviewFix", () => {
  test("把审核差距转为自包含 fix 检查项: 只规划不修复、硬性要求产出", () => {
    const text = renderReviewFix(plan, task, "错误处理未覆盖空输入")
    expect(text).toContain("错误处理未覆盖空输入")
    expect(text).toContain("docs/T-002/fix.md")
    expect(text).toContain("docs/T-002/audit.md")
    expect(text).toContain("- [ ] <修复步骤描述>")
    expect(text).toContain("自包含")
    expect(text).toContain("只规划不修复")
    expect(text).toContain("唯一可写的文件是 docs/T-002/fix.md")
    expect(text).toContain("产出该文件是硬性要求")
    expect(text).toContain("maintained by the DRIVER alone")
  })
})
