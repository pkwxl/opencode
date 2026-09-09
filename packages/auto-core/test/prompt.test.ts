import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { loadModes } from "../src/mode"
import { renderAgentContract } from "../src/loop"
import { parse } from "../src/plan"
import type { Phase } from "../src/phases"
import { renderText, usePromptLibrary } from "../src/template"
import { verifyTmpDir } from "../src/verify"
import agentTemplate from "../templates/.opencode/agent/auto.md" with { type: "file" }
import planTemplate from "../templates/PLAN.md" with { type: "file" }
import {
  decomposeTemplateName,
  modeCtx,
  renderContextBase,
  renderDecompose,
  renderDryrun,
  renderFinalTask,
  renderFix,
  renderHandoffSteer,
  renderImplementPlan,
  renderInferSource,
  renderKnowledge,
  renderNumberRecovery,
  renderPhaseHandover,
  renderPhasePlan,
  renderPriorKnowledge,
  renderReview,
  renderReviewFix,
  renderStuckHint,
  renderSubtask,
  renderTestContinue,
  renderTestHandover,
  renderTestResult,
  renderUnderstand,
  renderVerifyJudge,
  renderVerifyScriptGen,
  renderWhole,
  renderWrapup,
  REVIEW_FILE,
  subtaskOutputFile,
  testHandoffFile,
  VERDICT_FILE,
  type TestRunInfo,
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

// 带检查项的任务(fork 流水线子任务列表注入的载体): 首项已勾选模拟恢复场景。
const listPlan = parse(
  "PLAN.md",
  `## T-004: 拆解执行 [pending]
整体描述。

- [x] 编写 schema 部分
- [ ] 编写执行逻辑
- [ ] 编写文档
`,
)
const listTask = listPlan.tasks[0]!

describe("renderDecompose", () => {
  test("要求只读分析并产出 subtasks.md 检查项", () => {
    const text = renderDecompose(plan, task)
    expect(text).toContain("docs/T-002/subtasks.md")
    expect(text).toContain("- [ ] <子任务描述;末尾注明该项的产出>")
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

describe("renderDecompose(分阶段模板 decompose-<phase>)", () => {
  const phaseCases: Array<[Phase, string, string]> = [
    ["a", "分析", "按问题/疑点/子系统/风险面切分"],
    ["d", "设计", "按设计关注点切分"],
    ["m", "迁移实现", "垂直薄切片优先"],
    ["t", "测试", "按测试面/场景族切分"],
    ["v", "验收", "按验收维度切分"],
    ["k", "知识提炼", "按知识产物切分"],
  ]

  test("各阶段渲染: 注入阶段名与该阶段的切分准则段", () => {
    for (const [phase, name, rule] of phaseCases) {
      const text = renderDecompose(plan, task, { phase })
      expect(text).toContain(`当前处于阶段 ${name}`)
      expect(text).toContain(rule)
      // 共通粒度准则段(decompose-rule)与检查项协议
      expect(text).toContain("分解粒度准则")
      expect(text).toContain("以任务描述为基准")
      expect(text).toContain("- [ ]")
    }
  })

  test("m 默认: 未传 phase 时选择 decompose-m", () => {
    const text = renderDecompose(plan, task)
    expect(text).toContain("当前处于阶段 迁移实现")
    expect(text).toContain("垂直薄切片优先")
  })

  test("fine 两态: 细粒度段按开关出现/消失;contextBudget 注入半预算", () => {
    const off = renderDecompose(plan, task, { contextLimit: 100_000 })
    expect(off).toContain("约 50.0k tokens 量级")
    expect(off).not.toContain("细粒度模式")
    const on = renderDecompose(plan, task, { fine: true })
    expect(on).toContain("细粒度模式")
    expect(on).toContain("宁细勿粗")
    expect(on).toContain("约 32.0k tokens 量级")
  })

  test("回退: 库中无 decompose-<phase> 时回退通用 decompose(缺省按 m 查名)", () => {
    expect(decomposeTemplateName("m", ["decompose"])).toBe("decompose")
    expect(decomposeTemplateName(undefined, ["decompose"])).toBe("decompose")
    expect(decomposeTemplateName("v", ["decompose", "decompose-v"])).toBe("decompose-v")
    expect(decomposeTemplateName(undefined, ["decompose", "decompose-m"])).toBe("decompose-m")
  })

  test("目标目录覆盖 decompose-m.md: 缺检查项协议行报错并指明文件,保留则生效", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-prompt-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "decompose-m.md"), "自定义分解提示词,丢了检查项协议")
      expect(() => usePromptLibrary(dir)).toThrow(/decompose-m\.md 缺少关键协议内容/)
      expect(() => usePromptLibrary(dir)).toThrow(/- \[ \]/)
      writeFileSync(join(overlay, "decompose-m.md"), "自定义分解提示词,保留协议: - [ ] 项")
      usePromptLibrary(dir)
      expect(renderDecompose(plan, task)).toBe("自定义分解提示词,保留协议: - [ ] 项")
      // 未覆盖的阶段模板仍取内置
      expect(renderDecompose(plan, task, { phase: "a" })).toContain("按问题/疑点/子系统/风险面切分")
    } finally {
      usePromptLibrary(undefined)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("renderUnderstand(fork 流水线 ① 理解会话)", () => {
  test("只读理解 + 摘要四节结构 + 硬性要求 + 写完即结束", () => {
    const text = renderUnderstand(plan, task)
    expect(text).toContain("只做任务背景理解,不写实现代码、不做任务分解")
    expect(text).toContain("不修改任何实现代码")
    expect(text).toContain("docs/T-002/context.md")
    expect(text).toContain("## 相关文件与关键符号")
    expect(text).toContain("## 约束与前提")
    expect(text).toContain("## 已有决策与现状")
    expect(text).toContain("## 风险与未知")
    expect(text).toContain("不产出有效文件会导致任务阻塞停机")
    expect(text).toContain("写完该文件后立即结束会话")
    // 紧凑性约束(digest 模式下摘要成为全部分叉的前缀)
    expect(text).toContain("写得紧凑、可检索")
    expect(text).toContain("200 行")
    // 状态文件只读规则与问答历史
    expect(text).toContain("由 driver 独占维护")
    expect(text).toContain("[done] T-001: 搭建 schema")
    expect(text).toContain("策略选 A 还是 B?")
  })

  test("优先选读任务正文点名的文件,不求全", () => {
    const text = renderUnderstand(plan, task)
    expect(text).toContain("有选择地阅读相关源码与 docs/")
    expect(text).toContain("优先任务正文")
    expect(text).toContain("点名的文件与直接相关模块,不求全")
  })

  test("taskContext 档位: off 缺省 200 行,small/medium/large 放宽 300/400/500 行", () => {
    expect(renderUnderstand(plan, task)).toContain("建议 200 行")
    expect(renderUnderstand(plan, task, { taskContext: "off" })).toContain("建议 200 行")
    expect(renderUnderstand(plan, task, { taskContext: "small" })).toContain("建议 300 行")
    expect(renderUnderstand(plan, task, { taskContext: "medium" })).toContain("建议 400 行")
    expect(renderUnderstand(plan, task, { taskContext: "large" })).toContain("建议 500 行")
  })
})

describe("renderContextBase(fork 流水线 ①′ digest 基点会话)", () => {
  test("摘要全文逐字注入 + 一句确认 + 不读不写不展开", () => {
    const digest = "## 相关文件与关键符号\n- src/x.ts: 数据模型\n\n## 约束与前提\n- 只读目标目录"
    const text = renderContextBase(task, digest)
    expect(text).toContain("任务 T-002 理解阶段产出的背景摘要")
    expect(text).toContain("docs/T-002/context.md 全文")
    expect(text).toContain("本会话由 driver 建立")
    expect(text).toContain(digest)
    expect(text).toContain("回复一句简短确认即可")
    expect(text).toContain("不要读取文件、不要展开分析")
    expect(text).toContain("不要修改任何内容")
    expect(text).toContain("确认后立即结束会话")
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
    expect(text).toContain("可新增但不要修改 docs/ 中的内容")
    expect(text).toContain("T-002: 实现迁移")
    // 状态文件由 driver 维护,不再要求 agent 勾选
    expect(text).toContain("由 driver 独占维护")
    expect(text).toContain("verified 字段")
    expect(text).not.toContain("改为 `- [x]`")
  })

  test("verify 未启用: 不含任务级验收与 verify 描述,仍要求不更新 docs/", () => {
    const text = renderSubtask(plan, task, subtask)
    expect(text).toContain("自我检查该子任务是否真正完成")
    expect(text).toContain("可新增但不要修改 docs/ 中的内容")
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

  test("交接条款默认注入;continuation 要求先读交接文档", () => {
    const text = renderSubtask(plan, task, subtask)
    expect(text).toContain("docs/T-002/handoff.md")
    expect(text).toContain("[driver] 上下文即将达到上限")
    expect(text).toContain("以本子任务是否完成计")
    expect(text).not.toContain("先读 docs/T-002/handoff.md")
    const cont = renderSubtask(plan, task, subtask, { continuation: true })
    expect(cont).toContain("先读 docs/T-002/handoff.md")
    expect(cont).toContain("据此继续")
  })

  test("test-by-driver: 注入测试执行协议;未启用时整块消失", () => {
    const on = renderSubtask(plan, task, subtask, { testByDriver: true })
    expect(on).toContain("测试执行协议(--test-by-driver)")
    expect(on).toContain("tmp/test.sh")
    expect(on).toContain("不要在会话内直接运行编译、测试、构建、lint")
    expect(on).toContain("把命令写成脚本放入 test/ 目录")
    expect(on).toContain("把同一脚本路径再次写入 tmp/test.sh")
    // handover-test 附带交接文档提示
    const handover = renderSubtask(plan, task, subtask, { testByDriver: true, handoverTest: true })
    expect(handover).toContain("docs/T-002/testhandoff.md")
    expect(handover).toContain("由新会话继续")
    // 未启用时协议与交接描述均不出现(doc-layout 共享段的规范性提及不含交接协议本身)
    const off = renderSubtask(plan, task, subtask)
    expect(off).not.toContain("测试执行协议")
    expect(off).not.toContain("tmp/test.sh")
    expect(off).not.toContain("driver 会要求你把进度与后续步骤写入")
  })

  test("测试交接文档按子任务级目录命名: 下一子任务不会误读上一子任务的遗留交接", () => {
    const handover = renderSubtask(listPlan, listTask, "编写执行逻辑", { index: 2, testByDriver: true, handoverTest: true })
    expect(handover).toContain("docs/T-004/S02/testhandoff.md")
    expect(handover).not.toContain("docs/T-004/testhandoff.md")
    // 缺省推导 index(按正文检查项定位)同样落子任务级目录
    const derived = renderSubtask(listPlan, listTask, "编写文档", { testByDriver: true, handoverTest: true })
    expect(derived).toContain("docs/T-004/S03/testhandoff.md")
    // 无检查项任务(旧形态单子任务)保持任务级命名
    expect(renderSubtask(plan, task, subtask, { testByDriver: true, handoverTest: true })).toContain("docs/T-002/testhandoff.md")
  })
})

describe("renderSubtask(子任务列表/产出文件/背景段,fork 流水线注入)", () => {
  test("注入全量检查项列表(按序编号)与「第 N 项」;产出文件按位补零", () => {
    const text = renderSubtask(listPlan, listTask, "编写执行逻辑", { index: 2 })
    expect(text).toContain("本任务的完整子任务列表(按序执行,其他项由其他会话完成,不要碰)")
    expect(text).toContain("1. 编写 schema 部分\n2. 编写执行逻辑\n3. 编写文档")
    expect(text).toContain("你本次只负责其中的第 2 项")
    expect(text).toContain("- [ ] 编写执行逻辑")
    // 产出约定: 文档类产出写 driver 机械命名的独立文件
    expect(text).toContain("产出约定")
    expect(text).toContain("写入 docs/T-004/S02/index.md(独立文件,标题写在首行,不并入其他文档)")
    expect(text).toContain("代码类产出直接落于源码树")
  })

  test("缺省推导: 不传 index 时按正文检查项定位同名项", () => {
    const text = renderSubtask(listPlan, listTask, "编写文档")
    expect(text).toContain("你本次只负责其中的第 3 项")
    expect(text).toContain("写入 docs/T-004/S03/index.md")
  })

  test("背景段 warm 两态: 继承上下文勿重读 / 冷启动先读 context.md 摘要", () => {
    const warm = renderSubtask(listPlan, listTask, "编写文档", { index: 3, warm: true })
    expect(warm).toContain("本会话已继承任务背景上下文(理解阶段的摘要与已加载内容),无需重读已在上下文中的文件")
    expect(warm).toContain("如仍缺背景,可读 docs/T-004/context.md 摘要")
    expect(warm).not.toContain("先读之了解任务背景")
    const cold = renderSubtask(listPlan, listTask, "编写文档", { index: 3 })
    expect(cold).toContain("如存在 docs/T-004/context.md,先读之了解任务背景再开始(不存在则按需自行阅读源码)")
    expect(cold).not.toContain("已继承任务背景上下文")
  })

  test("无检查项任务(旧形态): 单条呈现,列表与产出约定段不出现", () => {
    const text = renderSubtask(plan, task, "编写迁移脚本")
    expect(text).toContain("你本次只负责该任务的这一个子任务")
    expect(text).not.toContain("完整子任务列表")
    expect(text).not.toContain("产出约定")
  })

  test("subtaskOutputFile: 两位递增命名(超出两位自然进位)", () => {
    expect(subtaskOutputFile(task, 1)).toBe("docs/T-002/S01/index.md")
    expect(subtaskOutputFile(task, 9)).toBe("docs/T-002/S09/index.md")
    expect(subtaskOutputFile(task, 12)).toBe("docs/T-002/S12/index.md")
    expect(subtaskOutputFile(task, 123)).toBe("docs/T-002/S123/index.md")
  })
})

describe("renderWrapup", () => {
  test("只执行收尾: docs、report.md,不标 done、不提交", () => {
    const text = renderWrapup(plan, task)
    expect(text).toContain("全部子任务已在之前的会话中逐一完成,不要重做")
    expect(text).toContain("docs/T-002/report.md")
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

  test("索引式报告(auto 模式): 逐子任务一行引用产物路径,不复制产物内容", () => {
    const text = renderWrapup(plan, task)
    expect(text).toContain("索引式报告")
    expect(text).toContain("逐子任务一行")
    expect(text).toContain("docs/T-002/S<NN>/index.md 或代码位置")
    expect(text).toContain("不复制或改写子任务产物的内容")
    expect(text).toContain("整体结论与遗留问题两节")
  })

  test("solo 模式保持摘要式报告,不带索引式协议", () => {
    const text = renderWrapup(plan, task, { solo: true })
    expect(text).not.toContain("索引式")
    expect(text).toContain("产出摘要(改动了什么、关键决策与遗留事项)")
    expect(text).not.toContain("S<NN>")
  })
})

describe("renderFix", () => {
  test("把审核差距反馈回执行会话: 只修差距、不运行 verify、不下结论", () => {
    const text = renderFix(plan, task, "迁移脚本缺少回滚逻辑", { verify: true })
    expect(text).toContain("迁移脚本缺少回滚逻辑")
    expect(text).toContain("验收未通过")
    expect(text).toContain("只修复审核指出的差距")
    expect(text).toContain("不要运行任务级 verify")
    expect(text).toContain("由 driver 独占维护")
    expect(text).not.toContain("verified-command")
  })

  test("test-by-driver: 修复轮同样注入测试执行协议", () => {
    const text = renderFix(plan, task, "差距", { testByDriver: true })
    expect(text).toContain("测试执行协议(--test-by-driver)")
    expect(text).toContain("tmp/test.sh")
    expect(renderFix(plan, task, "差距")).not.toContain("tmp/test.sh")
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
    expect(text).toContain("验证的执行权在 driver")
    expect(text).toContain("只读检查")
    // 替换重验协议: 新脚本写指定路径,结论为重验,driver 执行后经同一输出文件回传
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
    expect(text).toContain("docs/T-002/audit.md")
    expect(text).toContain(REVIEW_FILE)
    expect(text).toContain("docs/T-002/report.md")
    expect(text).toContain("git log/status")
    expect(text).toContain("禁止审核其他任务的代码")
    expect(text).toContain("只审不改")
    expect(text).toContain("结论: 通过")
    expect(text).toContain("结论: 差距")
    expect(text).toContain("由 driver 独占维护")
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
    expect(plain).toContain("验证的执行权在 driver")
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
    expect(text).toContain("docs/T-002/handoff.md")
    expect(text).toContain("[driver] 上下文即将达到上限")
    expect(text).not.toContain("先读 docs/T-002/handoff.md")
    const cont = renderWhole(plan, task, { ondemand: true, continuation: true })
    expect(cont).toContain("先读 docs/T-002/handoff.md")
    expect(cont).toContain("据此继续")
  })

  test("不含会话内提交要求(state-rule 注入提交原则)", () => {
    expect(renderWhole(plan, task)).not.toContain("git 提交全部未提交改动")
    expect(renderWhole(plan, task)).toContain("git 提交由 driver 在会话结束后统一执行")
  })

  test("交接提示要求写出状态行", () => {
    const steer = renderHandoffSteer(task)
    expect(steer).toContain("docs/T-002/handoff.md")
    expect(steer).toContain("状态: 继续")
    expect(steer).toContain("状态: 完成")
  })

  test("test-by-driver: 注入测试执行协议(与 ondemand 交接条款可同现)", () => {
    const text = renderWhole(plan, task, { ondemand: true, testByDriver: true, handoverTest: true })
    expect(text).toContain("测试执行协议(--test-by-driver)")
    expect(text).toContain("tmp/test.sh")
    expect(text).toContain("docs/T-002/handoff.md")
    expect(text).toContain("docs/T-002/testhandoff.md")
    expect(renderWhole(plan, task)).not.toContain("测试执行协议")
  })
})

describe("测试执行协议(--test-by-driver,与 verify 正交)", () => {
  const run: TestRunInfo = {
    seq: 3,
    script: "/tmp/pkg/test/build.sh",
    code: 1,
    ms: 1234,
    timedOut: false,
    out: "/tmp/pkg/tmp/test.3.out",
  }

  test("testHandoffFile 路径与 ondemand handoff 分离命名;子任务级目录(两位零填充)", () => {
    expect(testHandoffFile(task)).toBe("docs/T-002/testhandoff.md")
    expect(testHandoffFile(task)).not.toBe("docs/T-002/handoff.md")
    expect(testHandoffFile(task, 2)).toBe("docs/T-002/S02/testhandoff.md")
    expect(testHandoffFile(task, 12)).toBe("docs/T-002/S12/testhandoff.md")
    expect(testHandoffFile(task, 123)).toBe("docs/T-002/S123/testhandoff.md")
  })

  test("结果反馈: 退出码/耗时/脚本与输出路径,要求直读文件判断并说明再次请求方式", () => {
    const text = renderTestResult(run)
    expect(text).toContain("第 3 次")
    expect(text).toContain("/tmp/pkg/test/build.sh")
    expect(text).toContain("退出码: 1")
    expect(text).toContain("1234ms")
    expect(text).toContain("/tmp/pkg/tmp/test.3.out")
    expect(text).toContain("直读文件判断")
    expect(text).toContain("把同一脚本路径再次写入 tmp/test.sh")
    const timeout = renderTestResult({ ...run, timedOut: true, timeoutReason: "idle" })
    expect(timeout).toContain("持续无输出")
  })

  test("交接要求: 失败上下文 + 已用 tokens 达上限 + 交接文档硬性要求", () => {
    const text = renderTestHandover(run, { handoffFile: "/tmp/pkg/docs/T-002/testhandoff.md", used: 66000, limit: 64000 })
    expect(text).toContain("退出码 1")
    expect(text).toContain("/tmp/pkg/tmp/test.3.out")
    expect(text).toContain("66000")
    expect(text).toContain("64000")
    expect(text).toContain("/tmp/pkg/docs/T-002/testhandoff.md")
    expect(text).toContain("写完立即结束会话")
  })

  test("续跑说明: 先读交接文档与最近输出;连续交接超阈值时提示 AUTO-FIXME 评估", () => {
    const plain = renderTestContinue({ handoffFile: "docs/T-002/testhandoff.md", run })
    expect(plain).toContain("docs/T-002/testhandoff.md")
    expect(plain).toContain("/tmp/pkg/tmp/test.3.out")
    expect(plain).toContain("tmp/test.sh")
    expect(plain).not.toContain("AUTO-FIXME")
    const stuck = renderTestContinue({ handoffFile: "docs/T-002/testhandoff.md", run, stuck: 11 })
    expect(stuck).toContain("已连续进行 11 次")
    expect(stuck).toContain("AUTO-FIXME")
    // 无运行信息时省略最近测试段,仍渲染
    const bare = renderTestContinue({ handoffFile: "docs/T-002/testhandoff.md" })
    expect(bare).toContain("docs/T-002/testhandoff.md")
    expect(bare).not.toContain("test.3.out")
    expect(bare).not.toMatch(/\{\{|\}\}/)
  })
})

describe("renderStuckHint(死循环提示)", () => {
  const errorHit = {
    kind: "error" as const,
    tool: "edit",
    count: 3,
    level: 1,
    input: '{"filePath":"src/a.ts"}',
    detail: "String not found in file",
  }

  test("同报错重复: 说明是同一个报错,列出工具/参数/报错原文", () => {
    const text = renderStuckHint(errorHit)
    expect(text).toContain("循环检测")
    expect(text).toContain("edit")
    expect(text).toContain("3 次以完全相同的报错失败")
    expect(text).toContain("src/a.ts")
    expect(text).toContain("String not found in file")
    expect(text).toContain("报错:")
    expect(text).not.toContain("相同的参数得到完全相同的结果")
  })

  test("同参同果重复: 换一种说法,标注的是输出而非报错", () => {
    const text = renderStuckHint({ ...errorHit, kind: "repeat", tool: "read", count: 4, detail: "文件内容" })
    expect(text).toContain("4 次以相同的参数得到完全相同的结果")
    expect(text).toContain("输出:")
    expect(text).not.toContain("报错失败")
  })

  test("三级升级: 换思路 → 先写诊断 → 停止重试并收尾", () => {
    const first = renderStuckHint(errorHit)
    expect(first).toContain("先停下来核对前提")
    expect(first).not.toContain("AUTO-FIXME")
    const second = renderStuckHint({ ...errorHit, level: 2 })
    expect(second).toContain("第 2 次提醒")
    expect(second).toContain("已经试过哪些做法")
    expect(second).not.toContain("AUTO-FIXME")
    const third = renderStuckHint({ ...errorHit, level: 3 })
    expect(third).toContain("最后一次提醒")
    expect(third).toContain("AUTO-FIXME")
    expect(third).toContain("结束本次会话")
    expect(third).not.toContain("先停下来核对前提")
  })

  test("空参数/空输出有占位,渲染无残留标签", () => {
    const text = renderStuckHint({ ...errorHit, input: "", detail: "" })
    expect(text).toContain("(无参数)")
    expect(text).toContain("(空)")
    expect(text).not.toMatch(/\{\{|\}\}/)
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

const migrate = loadModes().migrate!

describe("模式注入(-m/--mode)", () => {
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

  test("modeCtx: 共享模式变量组装(壳层自写 render* 的扩展点),verify 条件段与缺省形态", () => {
    const withVerify = modeCtx(migrate, { verify: true })
    expect(withVerify.modeName).toBe("migrate")
    expect(withVerify.modeInit).toContain("优先复用既有的测试/构建命令")
    const without = modeCtx(migrate)
    expect(without.modeInit).not.toContain("优先复用既有的测试/构建命令")
    expect(without.modeExec).toContain("对等行为")
    expect(modeCtx()).toEqual({ modeName: undefined, modeInit: undefined, modeExec: undefined })
  })
})

describe("renderFinalTask", () => {
  test("audit 首轮: 提案与报告锚定 T-F<k>、报告协议、无 verify 行块与硬性要求", () => {
    const text = renderFinalTask(plan, "audit", 1, "全部原任务已完成,开始首轮终审", migrate)
    expect(text).toContain("docs/T-F1/plan-audit-r1.md")
    // 上游输入注入
    expect(text).toContain("全部原任务已完成,开始首轮终审")
    // 提案格式
    expect(text).toContain("# <任务标题>")
    // 终审任务不做任务级验收: 提案不再含 verify 行块
    expect(text).not.toContain("verify: command: <命令>")
    expect(text).not.toContain("优先复用原任务的验证命令")
    // 报告协议随提案正文要求下沉(锚定同一 T-F<k> 任务目录,P1-D1)
    expect(text).toContain("docs/T-F1/audit-r1.md")
    expect(text).toContain("结论: <概述>")
    expect(text).toContain("策略: 重构|修补|无")
    // 旧 docs/final/ 布局不再出现
    expect(text).not.toContain("docs/final/")
    // 只规划不实施与硬性要求
    expect(text).toContain("只规划不实施")
    expect(text).toContain("产出该提案文件是硬性要求")
    // STATE_RULE / QUESTION_RULE
    expect(text).toContain("由 driver 独占维护")
    expect(text).toContain("AUTO-DECISION")
    // 首轮不做回退重审措辞
    expect(text).not.toContain("不做全量重审")
  })

  test("锚定编号随 plan 内终审任务数推进(finalTask 推导)", () => {
    const finalsPlan = parse(
      "PLAN.md",
      `## T-001: 原任务 [done]
正文。

## T-F1: 终审审计 [done]
  - final: audit@1
正文。
`,
    )
    const text = renderFinalTask(finalsPlan, "remediate", 1, "", migrate)
    expect(text).toContain("docs/T-F2/plan-remediate-r1.md")
    expect(text).toContain("docs/T-F2/refactor-r1.md")
    expect(text).not.toContain("docs/final/")
  })

  test("audit 首轮注入 migrate 的终审侧重;不传模式时不注入", () => {
    expect(renderFinalTask(plan, "audit", 1, "", migrate)).toContain("场景模式侧重(migrate)")
    expect(renderFinalTask(plan, "audit", 1, "", migrate)).toContain("行为对等")
    expect(renderFinalTask(plan, "audit", 1, "", undefined)).not.toContain("场景模式侧重")
    // 无 prior 时不带上游输入块
    expect(renderFinalTask(plan, "audit", 1, "", migrate)).not.toContain("上游输入(终审上游产物指针与残余差距原文)")
  })

  test("audit 第 2 轮: 聚焦残余差距,不做全量重审", () => {
    const text = renderFinalTask(plan, "audit", 2, "docs/T-F3/validate-r1.md 末行: 结论: 差距 空输入未覆盖", migrate)
    expect(text).toContain("docs/T-F1/plan-audit-r2.md")
    expect(text).toContain("docs/T-F1/audit-r2.md")
    expect(text).toContain("聚焦上游残余差距与回归检查")
    expect(text).toContain("不做全量重审")
    expect(text).toContain("结论: 差距 空输入未覆盖")
  })

  test("remediate: 提案路径与修复报告双命名,无模式侧重注入", () => {
    const text = renderFinalTask(plan, "remediate", 1, "docs/T-F1/audit-r1.md 末行: 策略: 修补", migrate)
    expect(text).toContain("docs/T-F1/plan-remediate-r1.md")
    expect(text).toContain("docs/T-F1/refactor-r1.md")
    expect(text).toContain("docs/T-F1/patch-r1.md")
    expect(text).toContain("策略: 修补")
    expect(text).not.toContain("场景模式侧重")
  })

  test("validate 与 finalize: 各自提案路径、结论协议与模式侧重", () => {
    const validate = renderFinalTask(plan, "validate", 1, "docs/T-F2/patch-r1.md 修复已完成", migrate)
    expect(validate).toContain("docs/T-F1/plan-validate-r1.md")
    expect(validate).toContain("docs/T-F1/validate-r1.md")
    expect(validate).toContain("结论: 通过")
    expect(validate).toContain("结论: 差距 <描述>")
    expect(validate).toContain("回归覆盖")
    const finalize = renderFinalTask(plan, "finalize", 1, "docs/T-F3/validate-r1.md 末行: 结论: 通过", migrate)
    expect(finalize).toContain("docs/T-F1/plan-finalize-r1.md")
    expect(finalize).toContain("docs/T-F1/finalize.md")
    expect(finalize).toContain("兼容层的收尾")
  })
})

describe("renderPhasePlan(阶段规划会话,E 节)", () => {
  test("注入 brief/迁移源与目标/模式导语与任务格式协议;授权直接编辑 PLAN.md", () => {
    const text = renderPhasePlan({
      phase: "a",
      brief: "把 legacy 迁移到 bun",
      source: { dir: "legacy", path: "src/mod.ts" },
      destDir: "target",
      mode: migrate,
      verify: true,
    })
    expect(text).toContain("「分析」阶段(a)")
    expect(text).toContain("把 legacy 迁移到 bun")
    expect(text).toContain("legacy")
    expect(text).toContain("src/mod.ts")
    // 迁移目标参数: dest-dir 隔离流程文件与迁移产出
    expect(text).toContain("迁移目标目录(相对工作目录): target")
    expect(text).toContain("不要把迁移代码混入")
    expect(text).toContain("场景模式导语(migrate)")
    // a 阶段职责(任务锚定产物约定)与首批勘察要求
    expect(text).toContain("文档存放以任务为锚")
    expect(text).toContain("行为基线")
    expect(text).toContain("勘察计划排为首批任务")
    // 任务格式协议(协议敏感标记)
    expect(text).toContain("## T-NNN: <任务标题> [pending]")
    expect(text).toContain("- verify: <验收标准")
    // 本会话被授权直接编辑 PLAN.md(通常只读),其余状态文件仍禁改
    expect(text).toContain("唯一可写的文件是 PLAN.md")
    expect(text).toContain("CURRENT.md 与其余")
    expect(text).toContain("不要用 chmod 等方式改动文件权限")
    expect(text).toContain("git 提交由 driver 在会话结束后统一执行")
    expect(text).toContain("AUTO-DECISION")
    // 非 m 阶段不带终审预留提示
    expect(text).not.toContain("终审提醒")
  })

  test("brief 缺失 → 未提供提示段;各阶段职责条件注入(任务锚定,k 为永久路径知识文档)", () => {
    const missing = renderPhasePlan({ phase: "d" })
    expect(missing).toContain("未提供(brief.md 缺失或为空)")
    expect(missing).toContain("模块设计")
    expect(missing).not.toContain("行为基线")
    expect(renderPhasePlan({ phase: "m" })).toContain("代码迁移与改造")
    expect(renderPhasePlan({ phase: "t" })).toContain("回归覆盖")
    expect(renderPhasePlan({ phase: "v" })).toContain("整体验收")
    expect(renderPhasePlan({ phase: "k" })).toContain("docs/R-NN/migration-kb.md")
  })

  test("handovers 注入两态: 有前序交接则注入清单(标注 docs/handovers/ 永久路径),无则整块消失", () => {
    const text = renderPhasePlan({
      phase: "m",
      handovers: "### a 分析(docs/handovers/R1-a-analysis.md)\n\n- 决策甲: 选型 X",
    })
    expect(text).toContain("前序阶段交接")
    expect(text).toContain("唯一通道")
    expect(text).toContain("docs/handovers/")
    expect(text).toContain("### a 分析(docs/handovers/R1-a-analysis.md)")
    expect(text).toContain("- 决策甲: 选型 X")
    // 首阶段无前序交接: 交接块整块消失
    expect(renderPhasePlan({ phase: "a" })).not.toContain("前序阶段交接")
  })

  test("prevRound 注入两态: 续轮结论块出现/整块消失(仅新一轮首个规划会话由 loop 传入)", () => {
    const text = renderPhasePlan({
      phase: "a",
      prevRound: "### 上一轮(第 1 轮)阶段归档索引(docs/phases/round-1/)\n\n- docs/phases/round-1/m-migrate/",
    })
    expect(text).toContain("上一轮迁移结论(续轮)")
    expect(text).toContain("完整、一致")
    expect(text).toContain("不要重做已完成")
    expect(text).toContain("永久路径")
    expect(text).toContain("- docs/phases/round-1/m-migrate/")
    // 非续轮(无 prevRound): 结论块整块消失
    expect(renderPhasePlan({ phase: "a" })).not.toContain("上一轮迁移结论")
  })

  test("m 阶段经 trimmedPhases 注入流程裁剪注记(--phases 裁剪 → 勘察设计并入首批任务,底线不省),缺省与其余阶段无", () => {
    const m = renderPhasePlan({ phase: "m", trimmedPhases: true })
    expect(m).toContain("流程裁剪注记")
    expect(m).toContain("--phases 裁剪")
    expect(m).toContain("并入本阶段首批任务")
    expect(m).toContain("底线保障")
    // 缺省(完整流程)不注入;非 m 阶段即使传入也不注入(门控在函数内)
    expect(renderPhasePlan({ phase: "m" })).not.toContain("流程裁剪注记")
    expect(renderPhasePlan({ phase: "a", trimmedPhases: true })).not.toContain("流程裁剪注记")
  })

  test("迁移参数注入两态: destDir 未给出则目标参数段整块消失", () => {
    const withSource = renderPhasePlan({ phase: "m", source: { dir: "legacy", path: "pkg" } })
    expect(withSource).toContain("## 输入: 迁移源参数")
    expect(withSource).not.toContain("## 输入: 迁移目标参数")
    const bare = renderPhasePlan({ phase: "m" })
    expect(bare).not.toContain("## 输入: 迁移源参数")
    expect(bare).not.toContain("## 输入: 迁移目标参数")
  })

  test("verify 未启用: 不含 verify 字段与验收执行权描述(m 阶段)", () => {
    const text = renderPhasePlan({ phase: "m" })
    expect(text).not.toContain("verify")
    expect(text).not.toContain("验收")
  })

  test("finalReview 仅 m 阶段且启用时提示预留终审空间", () => {
    const text = renderPhasePlan({ phase: "m", finalReview: 3 })
    expect(text).toContain("终审提醒")
    expect(text).toContain("审计轮上限 3")
    // 非 m 阶段即使启用也不提示
    expect(renderPhasePlan({ phase: "a", finalReview: 3 })).not.toContain("终审提醒")
  })

  test("numberStart 两态: 自动编号起点注入 / 缺省自 T-001 起", () => {
    const text = renderPhasePlan({ phase: "m", numberStart: 4 })
    expect(text).toContain("任务编号自 T-004 起连续递增")
    expect(text).toContain("不得复用")
    expect(text).not.toContain("任务编号自 T-001")
    // 未启用自动编号(缺省): 维持历史文案
    const bare = renderPhasePlan({ phase: "m" })
    expect(bare).toContain("任务编号自 T-001 连续递增")
    expect(bare).not.toContain("不得复用")
  })

  test("代表性参数组合渲染后不残留模板标签", () => {
    for (const text of [
      renderPhasePlan({ phase: "a" }),
      renderPhasePlan({ phase: "m", brief: "意图", handovers: "### a 分析(x)\n\n- 决策", source: { dir: "legacy", path: "pkg" }, destDir: "target", mode: migrate, verify: true, finalReview: 2, numberStart: 12 }),
      renderPhasePlan({ phase: "a", prevRound: "### 上一轮(第 1 轮)阶段归档索引\n\n- docs/phases/round-1/m-migrate/" }),
      renderPhasePlan({ phase: "k", verify: true }),
    ]) {
      expect(text).not.toMatch(/\{\{|\}\}/)
    }
  })
})

describe("renderImplementPlan(init 快捷模式 --implement-file/--implement-prompt)", () => {
  test("file 给出: 按「计划文件」呈现,注入路径与全文;任务格式协议与授权文案同 phase-plan", () => {
    const text = renderImplementPlan({ file: "/tmp/rough-plan.md", content: "先做 A,再做 B", verify: true })
    expect(text).toContain("## 输入: 计划文件(/tmp/rough-plan.md)")
    expect(text).toContain("先做 A,再做 B")
    expect(text).not.toContain("## 输入: 实施提示词")
    expect(text).toContain("## T-NNN: <任务标题> [pending]")
    expect(text).toContain("- verify: <验收标准")
    expect(text).toContain("唯一可写的文件是 PLAN.md")
    expect(text).toContain("不要用 chmod 等方式改动文件权限")
    expect(text).toContain("AUTO-DECISION")
  })

  test("file 未给出: 按「实施提示词」呈现同一 content", () => {
    const text = renderImplementPlan({ content: "实现一个登录页面" })
    expect(text).toContain("## 输入: 实施提示词")
    expect(text).toContain("实现一个登录页面")
    expect(text).not.toContain("## 输入: 计划文件")
  })

  test("brief 两态: 给出则注入项目意图段,未给出/空白则整块消失", () => {
    const withBrief = renderImplementPlan({ content: "x", brief: "把 legacy 迁移到 bun" })
    expect(withBrief).toContain("## 输入: 项目意图(.opencode/auto/brief.md)")
    expect(withBrief).toContain("把 legacy 迁移到 bun")
    expect(renderImplementPlan({ content: "x" })).not.toContain("## 输入: 项目意图")
    expect(renderImplementPlan({ content: "x", brief: "   " })).not.toContain("## 输入: 项目意图")
  })

  test("verify 未启用: 不含 verify 字段与验收执行权描述", () => {
    const text = renderImplementPlan({ content: "x" })
    expect(text).not.toContain("verify")
    expect(text).not.toContain("验收")
  })

  test("代表性参数组合渲染后不残留模板标签", () => {
    for (const text of [
      renderImplementPlan({ content: "提示词" }),
      renderImplementPlan({ file: "docs/rough.md", content: "计划全文", brief: "意图", verify: true }),
    ]) {
      expect(text).not.toMatch(/\{\{|\}\}/)
    }
  })
})

describe("renderNumberRecovery(编号恢复会话)", () => {
  test("注入下限与证据清单,硬性产出协议指向 .auto/next-task", () => {
    // 模板库可能被同进程其他用例覆盖过,复位为仅内置
    usePromptLibrary(undefined)
    const text = renderNumberRecovery({ floor: 5 })
    // 协议敏感标记: driver 解析会话产出的依据
    expect(text).toContain(".auto/next-task")
    // 下限注入(原值与补零形式)
    expect(text).toContain("= 5")
    expect(text).toContain("T-005")
    expect(text).toContain("不得小于它")
    // 证据清单含 git 历史(发现产物已删除的编号)与归档 PLAN
    expect(text).toContain("git log --oneline")
    expect(text).toContain("docs/phases/")
    // 硬性产出协议: 内容仅为不小于下限的正整数
    expect(text).toContain("正整数")
    expect(text).toContain("不要写任何其他内容")
    expect(text).toContain("唯一可写的文件是 .auto/next-task")
    expect(text).not.toMatch(/\{\{|\}\}/)
  })
})

describe("renderPhaseHandover(阶段交接蒸馏会话,F.1)", () => {
  test("注入阶段/交接永久路径/四小节协议与唯一可写文件约束", () => {
    const text = renderPhaseHandover({ phase: "a", handover: "docs/handovers/R1-a-analysis.md", next: "m 迁移实现", verify: true })
    expect(text).toContain("「分析」阶段(a)")
    expect(text).toContain("交接蒸馏者")
    expect(text).toContain("docs/handovers/R1-a-analysis.md")
    for (const section of ["## 关键决策", "## 约束与坑", "## 下一阶段必读清单", "## 产物索引"]) {
      expect(text).toContain(section)
    }
    expect(text).toContain("下一阶段为「m 迁移实现」")
    expect(text).toContain("唯一可写的文件是 docs/handovers/R1-a-analysis.md")
    expect(text).toContain("只蒸馏、")
    expect(text).toContain("不改动任何既有产物")
    expect(text).toContain("AUTO-DECISION")
    expect(text).toContain("由 driver 独占维护")
    expect(text).toContain("git 提交由 driver 在会话结束后统一执行")
  })

  test("k 阶段无下一阶段: 供后续查阅措辞,仍要求四小节", () => {
    const text = renderPhaseHandover({ phase: "k", handover: "docs/handovers/R1-k-knowledge.md" })
    expect(text).toContain("无下一阶段")
    expect(text).toContain("供后续轮次与人工查阅")
    for (const section of ["## 关键决策", "## 约束与坑", "## 下一阶段必读清单", "## 产物索引"]) {
      expect(text).toContain(section)
    }
    // 无任务清单阶段(k)的兜底表述: 空 PLAN.md/CURRENT.md 缺失属预期,蒸馏以本轮 migration-kb 产物为准
    expect(text).toContain("PLAN.md 为空模板")
    expect(text).toContain("CURRENT.md 不存在,属预期")
    expect(text).toContain("docs/R-NN/migration-kb.md")
    expect(text).toContain("无任务清单时跳过")
    // 有下一阶段时不带收尾措辞
    const withNext = renderPhaseHandover({ phase: "a", handover: "docs/handovers/R1-a-analysis.md", next: "m 迁移实现" })
    expect(withNext).not.toContain("无下一阶段")
    expect(withNext).not.toContain("migration-kb")
  })

  test("verify 未启用: 不含 verified 字段描述", () => {
    expect(renderPhaseHandover({ phase: "m", handover: "docs/handovers/R1-m-migrate.md" })).not.toContain("verified")
  })

  test("代表性参数组合渲染后不残留模板标签", () => {
    for (const text of [
      renderPhaseHandover({ phase: "a", handover: "docs/handovers/R1-a-analysis.md", next: "m 迁移实现", verify: true }),
      renderPhaseHandover({ phase: "k", handover: "docs/handovers/R1-k-knowledge.md" }),
    ]) {
      expect(text).not.toMatch(/\{\{|\}\}/)
    }
  })
})

describe("renderKnowledge(k 阶段知识提取会话,P4 认领 --extract-knowledge)", () => {
  const FILE = "docs/migration-kb/R1-migration-2026-01-01_00-00-00.md"

  test("注入输出路径、来源清单与章节骨架;只读分析、唯一可写文件为输出路径", () => {
    const text = renderKnowledge({ file: FILE })
    expect(text).toContain(FILE)
    // 来源指针(本轮轮次目录内的阶段台账与各阶段交接文档,归档目录内是阶段 PLAN 快照)
    expect(text).toContain("docs/R-NN/phases.md")
    expect(text).toContain("docs/R-NN/handovers/")
    expect(text).toContain("docs/R-NN/<字母>-<名称>/")
    expect(text).toContain("git log")
    // 章节骨架(规格书 §13 的本仓库化,Design Deviations 改以 AUTO-DECISION 为来源)
    for (const section of ["## 迁移概要", "## API 与类型映射", "## 实现模式", "## 坑点与边界情况", "## 可复用规则", "## 设计偏差与重要决策", "## 验证证据", "## 参考"]) {
      expect(text).toContain(section)
    }
    expect(text).toContain("AUTO-DECISION")
    // 质量约束(规格书 §14)
    expect(text).toContain("最终状态优先")
    expect(text).toContain("去重")
    expect(text).toContain("不照抄会话对话")
    expect(text).toContain("可验证锚点")
    expect(text).toContain("已否决")
    expect(text).toContain("唯一可写的文件是 " + FILE)
    expect(text).toContain("由 driver 独占维护")
    expect(text).toContain("git 提交由 driver 在会话结束后统一执行")
    expect(text).toContain("只提炼、")
  })

  test("注入 mode.exec 场景背景;不传模式时整块消失", () => {
    const text = renderKnowledge({ file: FILE, mode: migrate })
    expect(text).toContain("场景模式注记(migrate)")
    expect(text).toContain("迁移/升级模式注意事项")
    expect(renderKnowledge({ file: FILE })).not.toContain("场景模式注记")
  })

  test("渲染后不残留模板标签", () => {
    for (const text of [renderKnowledge({ file: FILE }), renderKnowledge({ file: FILE, mode: migrate })]) {
      expect(text).not.toMatch(/\{\{|\}\}/)
    }
  })
})

describe("init 产物模板(PLAN.md / agent 契约)", () => {
  test("verify 启用: PLAN.md 含 verify 字段示例与验证执行权原则", async () => {
    const text = renderText(await Bun.file(planTemplate).text(), { verify: true })
    expect(text).toContain("  - verify: command: <建议的验收命令,如 bun test>")
    expect(text).toContain("验证脚本与验证命令的执行权在 driver")
    expect(text).not.toContain("opencode-auto check")
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
    expect(off).toContain("不得删除或改写 opencode-auto")
    expect(off).toContain("标记块(指针/提交/摘要/维护规则/引用规范")
    expect(off).toContain("<!-- opencode-auto:start -->")
    expect(off).toContain("<!-- opencode-auto:end -->")
    expect(off).toContain("遵守块内的 AGENTS.md 维护规则")
    expect(off).not.toContain("verify")
    expect(off).not.toContain("验证")
  })
})

describe("agent 契约模板(templates/.opencode/agent/auto.md)", () => {
  test("一致性比对口径 = 写入口径:两态渲染文本与原始模板互不相等(含条件块),四组渲染与 renderText 直渲一致", async () => {
    const raw = await Bun.file(agentTemplate).text()
    expect(raw).toContain("{{#if verify}}")
    for (const verify of [true, false]) {
      for (const testByDriver of [true, false]) {
        const rendered = await renderAgentContract(verify, testByDriver)
        expect(rendered).toBe(renderText(raw, { verify, testByDriver }))
        expect(rendered).not.toBe(raw)
      }
    }
  })
  test("AGENTS.md 条款覆盖 opencode-auto 单一标记块并引用维护规则(防漂移,verify 启用)", async () => {
    const raw = await Bun.file(agentTemplate).text()
    const text = renderText(raw, { verify: true, testByDriver: true })
    expect(text).toContain("AGENTS.md 不在只读之列")
    // 不得删除或改写 opencode-auto 标记块(指针/验证/测试/提交/摘要/维护规则/引用规范),
    // 合并为单一 start/end 块,而非旧版按名各自独立的多个标记块
    expect(text).toContain("不得删除或改写 opencode-auto")
    expect(text).toContain("标记块(指针/验证/测试/提交/摘要/维护规则/引用规范")
    expect(text).toContain("<!-- opencode-auto:start -->")
    expect(text).toContain("<!-- opencode-auto:end -->")
    expect(text).not.toContain("<!-- opencode-auto:*:start -->")
    expect(text).not.toContain("不得删除 opencode-auto 指针块")
    // 更新其余内容时遵守块内的维护规则(精简/路由/更新不追加/只沉淀持久知识)
    expect(text).toContain("遵守块内的 AGENTS.md 维护规则")
    expect(text).toContain("docs/agents/")
    expect(text).toContain("保持精简")
    expect(text).toContain("更新不追加")
    expect(text).toContain("只沉淀持久工作流知识")
  })
})

describe("renderPriorKnowledge(前置知识提取会话)", () => {
  test("引用化两态: distilled 非空注入清单与不复述要求;空/缺省整块消失(行为同全量蒸馏)", () => {
    usePromptLibrary(undefined)
    const withList = renderPriorKnowledge({
      file: "docs/prior-kb/R2-prior-x.md",
      brief: "意图",
      distilled: ["docs/handovers/R1-m-migrate.md", "docs/migration-kb/R1-migration-a.md"],
    })
    expect(withList).toContain("## 输入: 已有蒸馏产物(引用化要求)")
    expect(withList).toContain("不得在本文复述")
    expect(withList).toContain("- docs/handovers/R1-m-migrate.md")
    expect(withList).toContain("- docs/migration-kb/R1-migration-a.md")
    // 引用化同款约束: 已覆盖知识点以一行引用代替摘抄
    expect(withList).toContain("一行引用代替摘抄")
    const bare = renderPriorKnowledge({ file: "docs/prior-kb/R1-prior-x.md" })
    expect(bare).not.toContain("## 输入: 已有蒸馏产物")
    expect(bare).not.toContain("不得在本文复述")
    expect(renderPriorKnowledge({ file: "docs/prior-kb/R1-prior-x.md", distilled: [] })).not.toContain("## 输入: 已有蒸馏产物")
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
      renderSubtask(listPlan, listTask, "编写执行逻辑", { index: 2, warm: true, mode: migrate }),
      renderSubtask(listPlan, listTask, "编写执行逻辑", { index: 2, continuation: true }),
      renderWrapup(plan, task),
      renderWrapup(plan, task, { solo: true, mode: migrate }),
      renderWhole(plan, task, { ondemand: true, continuation: true, mode: migrate }),
      renderVerifyScriptGen(plan, task, "/tmp/auto/verify.sh"),
      renderVerifyJudge(plan, task, { script: "/s", code: 1, ms: 2, timedOut: true, timeoutReason: "idle", out: "/o" }),
      renderFix(plan, task, "差距"),
      renderReview(plan, task, { final: false }),
      renderReview(plan, task, { final: true, early: true }),
      renderReviewFix(plan, task, "差距"),
      renderFinalTask(plan, "audit", 2, "残余差距", migrate),
      renderFinalTask(plan, "finalize", 1, "", undefined),
      renderHandoffSteer(task),
      renderTestResult({ script: "/s", code: 0, ms: 9, timedOut: false, out: "/o", seq: 1 }),
      renderTestHandover({ script: "/s", code: 1, ms: 9, timedOut: true, timeoutReason: "max", out: "/o", seq: 2 }, { handoffFile: "/h", used: 1, limit: 2 }),
      renderTestContinue({ handoffFile: "docs/T-002/testhandoff.md", run: { script: "/s", code: 1, ms: 9, timedOut: false, out: "/o", seq: 2 }, stuck: 11 }),
      renderKnowledge({ file: "docs/migration-kb/migration-x.md", mode: migrate }),
      renderPriorKnowledge({ file: "docs/prior-kb/prior-x.md", brief: "意图", mode: migrate }),
      renderPriorKnowledge({ file: "docs/prior-kb/prior-x.md" }),
      renderPriorKnowledge({ file: "docs/prior-kb/prior-x.md", distilled: ["docs/handovers/R1-m-migrate.md"] }),
      renderInferSource({ file: ".auto/infer.json", brief: "意图", priorKb: "- docs/prior-kb/prior-x.md", known: "- 迁移目标目录: target" }),
      renderInferSource({ file: ".auto/infer.json" }),
      renderDryrun(),
      renderDecompose(plan, solo),
      renderHandoffSteer(solo),
    ]
    for (const text of texts) expect(text).not.toMatch(/\{\{|\}\}/)
  })

  test("init 产物模板按 verify/testByDriver 两态渲染后不残留模板标签", async () => {
    for (const raw of [await Bun.file(planTemplate).text(), await Bun.file(agentTemplate).text()]) {
      for (const verify of [true, false]) {
        for (const testByDriver of [true, false]) {
          expect(renderText(raw, { verify, testByDriver })).not.toMatch(/\{\{|\}\}/)
        }
      }
    }
  })
})
