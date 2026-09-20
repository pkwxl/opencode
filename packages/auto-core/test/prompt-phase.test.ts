// src/prompt.ts 阶段族渲染的单测: 终审任务/阶段规划/阶段交接/知识提取/编号恢复/implement 快捷模式。
// 拆分自 test/prompt.test.ts(plans/0024-module-split-plan.md S19,纯搬运)。

import { describe, expect, test } from "bun:test"
import { parse } from "../src/plan"
import {
  renderFinalTask,
  renderImplementPlan,
  renderKnowledge,
  renderNumberRecovery,
  renderPhaseHandover,
  renderPhasePlan,
  renderPriorKnowledge,
} from "../src/prompt"
import { usePromptLibrary } from "../src/template"
import { migrate, plan } from "./fixtures/prompt"

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
    expect(text).toContain("maintained by the DRIVER alone")
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
    expect(renderFinalTask(plan, "audit", 1, "", migrate)).toContain("behavioural equivalence")
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
    expect(validate).toContain("What regression means in a migration scenario")
    const finalize = renderFinalTask(plan, "finalize", 1, "docs/T-F3/validate-r1.md 末行: 结论: 通过", migrate)
    expect(finalize).toContain("docs/T-F1/plan-finalize-r1.md")
    expect(finalize).toContain("docs/T-F1/finalize.md")
    expect(finalize).toContain("closing out the compatibility layers")
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
    expect(text).toContain("git 提交由 DRIVER 在会话结束后统一执行")
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
    // 协议敏感标记: DRIVER 解析会话产出的依据
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
    expect(text).toContain("由 DRIVER 独占维护")
    expect(text).toContain("git 提交由 DRIVER 在会话结束后统一执行")
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
    expect(text).toContain("maintained by the DRIVER alone")
    expect(text).toContain("Git commits are made by the DRIVER in one pass after the session ends")
    expect(text).toContain("只提炼、")
  })

  test("注入 mode.exec 场景背景;不传模式时整块消失", () => {
    const text = renderKnowledge({ file: FILE, mode: migrate })
    expect(text).toContain("场景模式注记(migrate)")
    expect(text).toContain("Migration/upgrade mode notes")
    expect(renderKnowledge({ file: FILE })).not.toContain("场景模式注记")
  })

  test("渲染后不残留模板标签", () => {
    for (const text of [renderKnowledge({ file: FILE }), renderKnowledge({ file: FILE, mode: migrate })]) {
      expect(text).not.toMatch(/\{\{|\}\}/)
    }
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

  test("收笔标记协议: 中间产物路径说明 + 末尾「完成」独占一行 + 未写全前不写", () => {
    usePromptLibrary(undefined)
    const text = renderPriorKnowledge({ file: "docs/R-01/temp-kb.md" })
    expect(text).toContain("中间产物路径")
    expect(text).toContain("独占一行写「完成」作为收笔标记")
    expect(text).toContain("绝不写该行")
    expect(text).toContain("转正为正式的前置知识文档")
  })
})
