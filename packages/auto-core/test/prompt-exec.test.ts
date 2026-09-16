// src/prompt.ts 执行族渲染的单测: 分解/理解/基点/子任务/收尾/修复/整任务/测试执行协议/死循环提示/dryrun。
// 拆分自 test/prompt.test.ts(docs/module-split-plan.md S19,纯搬运)。

import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Phase } from "../src/phases"
import { usePromptLibrary } from "../src/template"
import {
  decomposeTemplateName,
  renderContextBase,
  renderDecompose,
  renderDryrun,
  renderFix,
  renderHandoffSteer,
  renderStuckHint,
  renderSubtask,
  renderTestContinue,
  renderTestResult,
  renderTestWrapup,
  renderUnderstand,
  renderWhole,
  renderWrapup,
  subtaskOutputFile,
  testHandoffFile,
  type TestRunInfo,
} from "../src/prompt"
import { listPlan, listTask, plan, resolveItem, task } from "./fixtures/prompt"

describe("renderDecompose", () => {
  test("要求只读分析并产出 subtasks.md 检查项", () => {
    const text = renderDecompose(plan, task)
    expect(text).toContain("docs/T-002/subtasks.md")
    expect(text).toContain("- [ ] <子任务描述;末尾注明该项的产出>")
    expect(text).toContain("只做任务分解,不写实现代码")
    expect(text).toContain("不修改任何实现代码")
    expect(text).toContain("question 工具")
  })

  test("包含已完成任务、当前任务与状态文件只读规则,不再复述 PLAN.md 阻塞记事", () => {
    const text = renderDecompose(plan, task)
    expect(text).toContain("[done] T-001: 搭建 schema")
    expect(text).toContain("其他任务无需了解")
    expect(text).toContain("T-002: 实现迁移")
    expect(text).toContain("编写迁移脚本。")
    // 阻塞原因/解答已退役: 不再从 PLAN.md 读出来注入提示词
    expect(text).not.toContain("策略选 A 还是 B?")
    expect(text).not.toContain("此前被阻塞")
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
    // 状态文件只读规则
    expect(text).toContain("由 driver 独占维护")
    expect(text).toContain("[done] T-001: 搭建 schema")
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
    expect(handover).toContain("由新会话判读测试结果继续")
    // 未启用时协议与交接描述均不出现(doc-layout 共享段的规范性提及不含交接协议本身)
    const off = renderSubtask(plan, task, subtask)
    expect(off).not.toContain("测试执行协议")
    expect(off).not.toContain("tmp/test.sh")
    expect(off).not.toContain("既定的交接节奏")
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

  // 收尾闭环 H7(docs/auto-resolve-design.md §I): driver 观测到的代答清单注入收尾
  // 提示词,要求 report.md 单列「自动代答问题」节。
  test("无代答(缺省/空清单)时代答段整体消失", () => {
    for (const text of [renderWrapup(plan, task), renderWrapup(plan, task, { resolves: [] })]) {
      expect(text).not.toContain("自动代答")
      expect(text).not.toContain("AUTO-RESOLVE")
      expect(text).not.toContain("resolveList")
    }
  })

  test("有代答时逐条列出原问题,并要求 report.md 单列「自动代答问题」节", () => {
    const text = renderWrapup(plan, task, { resolves: [resolveItem("是否把第三份 formatTokens 一并收口?")] })
    expect(text).toContain("driver 自动代答了以下本应由你询问用户的问题")
    expect(text).toContain("   - 是否把第三份 formatTokens 一并收口?")
    expect(text).toContain("请在 docs/T-002/report.md 中单列「自动代答问题」一节")
    expect(text).toContain("AUTO-RESOLVE: <原问题> -> <所选方案> (<理由>)")
    expect(text).toContain("上面每一条都必须出现")
    // 置于三项固定收尾要求之后、"以上全部完成前不要结束会话"之前
    expect(text.indexOf("自动代答")).toBeGreaterThan(text.indexOf("report.md:"))
    expect(text.indexOf("自动代答")).toBeLessThan(text.indexOf("以上全部完成前不要结束会话"))
  })

  test("清单只列 driver 源(agent 源已由会话自行标注),未配对的排在前", () => {
    const text = renderWrapup(plan, task, {
      resolves: [
        { ...resolveItem("已配对的问题"), matched: true },
        { ...resolveItem("会话自己标过的"), source: "agent", option: "方案甲", reason: "理由" },
        resolveItem("没被标注的问题"),
      ],
    })
    expect(text).not.toContain("会话自己标过的")
    expect(text.indexOf("没被标注的问题")).toBeLessThan(text.indexOf("已配对的问题"))
  })

  test("多行提问压成单行,空问题不占位", () => {
    const text = renderWrapup(plan, task, {
      resolves: [resolveItem("折旧入账\n是否同样过   钳制?"), resolveItem("   ")],
    })
    expect(text).toContain("   - 折旧入账 是否同样过 钳制?")
    expect(text).not.toContain("   - \n")
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

  test("收尾+交接要求: 落盘不依赖测试的剩余工作 + 交接文档硬性要求", () => {
    const text = renderTestWrapup({ handoffFile: "/tmp/pkg/docs/T-002/testhandoff.md" })
    // 对测试时机保持中性: 顺序态(缺省)交接收口后才跑,并发态此刻已在跑,一份文案两态都成立。
    expect(text).toContain("将由 driver 执行")
    expect(text).not.toContain("并行执行")
    expect(text).toContain("不依赖本次测试结果")
    // 未完成事项必须随交接带走: 否则新会话无从知晓,会被当成已完成而永久遗漏
    expect(text).toContain("还没做完的事")
    expect(text).toContain("/tmp/pkg/docs/T-002/testhandoff.md")
    expect(text).toContain("写完立即结束会话")
    // 状态行(中断恢复 F1): driver 凭它分辨"写完了"与"driver 死在会话写文件途中的半截文件"
    expect(text).toContain("状态: 继续")
    // 测试结果恒由下一个会话判读,交接之后一定还有工作——测试交接没有"完成"这一态
    // (handoff.md 才有: 那边的交接只是建议,活干完了自然不交接)
    expect(text).not.toContain("状态: 完成")
  })

  // 文案硬约束(测试交接前置化设计 D2): 收尾提示词不得让会话知道"上下文吃紧"
  // ——现场实证会话一旦知道就会自行判定余量不足、省略本应完成的落盘工作;
  // 也不写"不要改源码"(顺序态下收尾改动本就会落进提交 #2 并被测试覆盖)。
  test("收尾提示词不得出现上下文/超限措辞,也不代劳禁改源码", () => {
    const text = renderTestWrapup({ handoffFile: "docs/T-002/testhandoff.md" })
    for (const banned of ["上下文", "超限", "上限", "token", "Token", "不要修改", "不要改动"]) {
      expect(text).not.toContain(banned)
    }
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
