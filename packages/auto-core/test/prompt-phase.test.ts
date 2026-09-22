// src/prompt.ts 阶段族渲染的单测: 阶段规划/阶段交接/知识提取/编号恢复/implement 快捷模式。
// 拆分自 test/prompt.test.ts(plans/0024-module-split-plan.md S19,纯搬运)。

import { describe, expect, test } from "bun:test"
import {
  renderImplementPlan,
  renderKnowledge,
  renderNumberRecovery,
  renderPhaseHandover,
  renderPhasePlan,
  renderPriorKnowledge,
} from "../src/prompt"
import { usePromptLibrary } from "../src/template"
import { migrate, plan } from "./fixtures/prompt"
import { parsePhaseTypeFile } from "../src/phases/custom"
import { phaseTypeOfLetter as L } from "../src/phases/registry"

// The unit coordinates every planning render needs (M3.4); tests vary the rest.
const phasePlan = (input: Omit<Parameters<typeof renderPhasePlan>[0], "phaseId" | "taskIndex">) =>
  renderPhasePlan({ phaseId: "R-01.P02", taskIndex: "docs/R-01/P02-implement/tasks.md", ...input })
const implementPlan = (input: Omit<Parameters<typeof renderImplementPlan>[0], "phaseId" | "taskIndex">) =>
  renderImplementPlan({ phaseId: "R-01.P01", taskIndex: "docs/R-01/P01-implement/tasks.md", ...input })

describe("renderPhasePlan(阶段规划会话,E 节)", () => {
  test("注入 brief/迁移源与目标/模式导语与任务单元格式协议;只写任务索引与任务文档", () => {
    const text = phasePlan({
      phase: L("a"),
      brief: "把 legacy 迁移到 bun",
      source: { dir: "legacy", path: "src/mod.ts" },
      destDir: "target",
      mode: migrate,
    })
    expect(text).toContain("\"Analysis\" phase (a)")
    expect(text).toContain("把 legacy 迁移到 bun")
    expect(text).toContain("legacy")
    expect(text).toContain("src/mod.ts")
    // 迁移目标参数: dest-dir 隔离流程文件与迁移产出
    expect(text).toContain("Migration-target directory (relative to the working directory): target")
    expect(text).toContain("do not mix migrated code into it")
    expect(text).toContain("scenario-mode preamble (migrate)")
    // a 阶段职责(任务锚定产物约定)与首批勘察要求
    expect(text).toContain("Document placement is anchored to tasks")
    expect(text).toContain("behaviour baseline")
    expect(text).toContain("first batch of tasks")
    // 任务单元格式协议(协议敏感标记,M3.4): 任务文档标题行、Phase 字段、三节与索引行
    for (const marker of ["# T-NNN: <task title>", "Phase: R-01.P02", "## Goal", "## Scope", "## Acceptance", "- [ ] T-NNN <task title>", "<!-- auto: eof -->"]) {
      expect(text).toContain(marker)
    }
    expect(text).not.toContain("- verify:")
    expect(text).not.toContain("PLAN.md")
    // 本会话只写任务索引与任务文档,不建 done.md;其余状态文件禁改
    expect(text).toContain("This session writes only the task index docs/R-01/P02-implement/tasks.md and each task's docs/T-NNN/todo.md")
    expect(text).toContain("do not create done.md")
    expect(text).toContain("CURRENT.md and the other state files are read-only")
    expect(text).toContain("do not change file permissions via chmod or the like")
    expect(text).toContain("git commits are made by the DRIVER after the session")
    expect(text).toContain("AUTO-DECISION")
    expect(text).not.toContain("终审提醒")
  })

  test("brief 缺失 → 未提供提示段;各阶段职责条件注入(任务锚定,k 为永久路径知识文档)", () => {
    const missing = phasePlan({ phase: L("d") })
    expect(missing).toContain("Not provided (brief.md missing or empty)")
    expect(missing).toContain("module design")
    expect(missing).not.toContain("behaviour baseline")
    expect(phasePlan({ phase: L("m") })).toContain("code migration and rework")
    expect(phasePlan({ phase: L("t") })).toContain("regression coverage")
    expect(phasePlan({ phase: L("v") })).toContain("overall acceptance")
    expect(phasePlan({ phase: L("k") })).toContain("docs/R-NN/P<nn>-knowledge/kb.md")
  })

  test("handovers 注入两态: 有前序交接则注入清单(标注阶段目录内 handover.md 永久路径),无则整块消失", () => {
    const text = phasePlan({
      phase: L("m"),
      handovers: "### P01-analysis 分析(docs/R-01/P01-analysis/handover.md)\n\n- 决策甲: 选型 X",
    })
    expect(text).toContain("prior-phase handovers")
    expect(text).toContain("sole channel")
    expect(text).toContain("P<nn>-<type>/handover.md")
    expect(text).toContain("### P01-analysis 分析(docs/R-01/P01-analysis/handover.md)")
    expect(text).toContain("- 决策甲: 选型 X")
    // 首阶段无前序交接: 交接块整块消失
    expect(phasePlan({ phase: L("a") })).not.toContain("prior-phase handovers")
  })

  test("prevRound 注入两态: 续轮结论块出现/整块消失(仅新一轮首个规划会话由 loop 传入)", () => {
    const text = phasePlan({
      phase: L("a"),
      prevRound: "### Previous round (round 1) phase directory index (docs/R-01/)\n\n- docs/R-01/P01-implement/",
    })
    expect(text).toContain("prior-round migration conclusions (continuation round)")
    expect(text).toContain("fuller agreement")
    expect(text).toContain("do not redo finished work")
    expect(text).toContain("permanent path")
    expect(text).toContain("- docs/R-01/P01-implement/")
    // 非续轮(无 prevRound): 结论块整块消失
    expect(phasePlan({ phase: L("a") })).not.toContain("prior-round migration conclusions")
  })

  test("m 阶段经 trimmedPhases 注入流程裁剪注记(--phases 裁剪 → 勘察设计并入首批任务,底线不省),缺省与其余阶段无", () => {
    const m = phasePlan({ phase: L("m"), trimmedPhases: true })
    expect(m).toContain("Pipeline-trimming note")
    expect(m).toContain("trimmed via --phases")
    expect(m).toContain("first batch of tasks")
    expect(m).toContain("baseline-safety-net items")
    // 缺省(完整流程)不注入;非 m 阶段即使传入也不注入(门控在函数内)
    expect(phasePlan({ phase: L("m") })).not.toContain("Pipeline-trimming note")
    expect(phasePlan({ phase: L("a"), trimmedPhases: true })).not.toContain("Pipeline-trimming note")
  })

  test("迁移参数注入两态: destDir 未给出则目标参数段整块消失", () => {
    const withSource = phasePlan({ phase: L("m"), source: { dir: "legacy", path: "pkg" } })
    expect(withSource).toContain("## Input: migration-source parameters")
    expect(withSource).not.toContain("## Input: migration-target parameters")
    const bare = phasePlan({ phase: L("m") })
    expect(bare).not.toContain("## Input: migration-source parameters")
    expect(bare).not.toContain("## Input: migration-target parameters")
  })

  test("不含 verify 字段与验收执行权描述(verify 已退役,m 阶段)", () => {
    const text = phasePlan({ phase: L("m") })
    expect(text).not.toContain("verify")
    expect(text).not.toContain("验收")
  })

  test("numberStart 两态: 自动编号起点注入 / 缺省自 T-001 起", () => {
    const text = phasePlan({ phase: L("m"), numberStart: 4 })
    expect(text).toContain("Task numbers increment continuously from T-004")
    expect(text).toContain("must not be reused")
    expect(text).not.toContain("Task numbers increment continuously from T-001")
    // 未启用自动编号(缺省): 维持历史文案
    const bare = phasePlan({ phase: L("m") })
    expect(bare).toContain("Task numbers increment continuously from T-001")
    expect(bare).not.toContain("must not reuse")
  })

  test("代表性参数组合渲染后不残留模板标签", () => {
    for (const text of [
      phasePlan({ phase: L("a") }),
      phasePlan({ phase: L("m"), brief: "意图", handovers: "### a 分析(x)\n\n- 决策", source: { dir: "legacy", path: "pkg" }, destDir: "target", mode: migrate, numberStart: 12 }),
      phasePlan({ phase: L("a"), prevRound: "### Previous round (round 1) phase directory index\n\n- docs/R-01/P01-implement/" }),
      phasePlan({ phase: L("k") }),
    ]) {
      expect(text).not.toMatch(/\{\{|\}\}/)
    }
  })

  test("custom type (M3.6): the file's plan duties and display name replace the builtin duty paragraph", () => {
    const custom = parsePhaseTypeFile("security-review", "# Security review\n\n## plan duties\n\nPlan one review task per trust boundary.\n")
    const text = phasePlan({ phase: custom })
    expect(text).toContain("\"Security review\" phase (security-review)")
    expect(text).toContain("Plan one review task per trust boundary.")
    expect(text).not.toContain("code migration and rework")
    expect(text).not.toMatch(/\{\{|\}\}/)
    expect(renderPhaseHandover({ phase: custom, handover: "docs/R-01/P02-security-review/handover.md" })).toContain("Security review")
  })
})

describe("renderImplementPlan(init 快捷模式 --implement-file/--implement-prompt)", () => {
  test("file 给出: 按「计划文件」呈现,注入路径与全文;任务格式协议与授权文案同 phase-plan", () => {
    const text = implementPlan({ file: "/tmp/rough-plan.md", content: "先做 A,再做 B" })
    expect(text).toContain("## Input: plan file (/tmp/rough-plan.md)")
    expect(text).toContain("先做 A,再做 B")
    expect(text).not.toContain("## Input: implementation prompt")
    expect(text).toContain("# T-NNN: <task title>")
    expect(text).toContain("Phase: R-01.P01")
    expect(text).toContain("docs/R-01/P01-implement/tasks.md")
    expect(text).toContain("Task numbers increment continuously from T-001")
    expect(text).not.toContain("- verify:")
    expect(text).not.toContain("PLAN.md")
    expect(text).toContain("do not change file permissions via chmod or the like")
    expect(text).toContain("AUTO-DECISION")
  })

  test("file 未给出: 按「实施提示词」呈现同一 content", () => {
    const text = implementPlan({ content: "实现一个登录页面" })
    expect(text).toContain("## Input: implementation prompt")
    expect(text).toContain("实现一个登录页面")
    expect(text).not.toContain("## Input: plan file")
  })

  test("brief 两态: 给出则注入项目意图段,未给出/空白则整块消失", () => {
    const withBrief = implementPlan({ content: "x", brief: "把 legacy 迁移到 bun" })
    expect(withBrief).toContain("## Input: project intent (.opencode/auto/brief.md)")
    expect(withBrief).toContain("把 legacy 迁移到 bun")
    expect(implementPlan({ content: "x" })).not.toContain("## Input: project intent")
    expect(implementPlan({ content: "x", brief: "   " })).not.toContain("## Input: project intent")
  })

  test("不含 verify 字段与验收执行权描述(verify 已退役)", () => {
    const text = implementPlan({ content: "x" })
    expect(text).not.toContain("verify")
    expect(text).not.toContain("验收")
  })

  test("代表性参数组合渲染后不残留模板标签", () => {
    for (const text of [
      implementPlan({ content: "提示词" }),
      implementPlan({ file: "docs/rough.md", content: "计划全文", brief: "意图" }),
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
    expect(text).toContain("must not be smaller than this")
    // 证据清单含 git 历史(发现产物已删除的编号)与各阶段任务索引
    expect(text).toContain("git log --oneline")
    expect(text).toContain("tasks.md")
    expect(text).not.toContain("PLAN")
    // 硬性产出协议: 内容仅为不小于下限的正整数
    expect(text).toContain("positive integer")
    expect(text).toContain("write nothing else")
    expect(text).toContain("only file this session may write is .auto/next-task")
    expect(text).not.toMatch(/\{\{|\}\}/)
  })
})

describe("renderPhaseHandover(阶段交接蒸馏会话,F.1)", () => {
  test("注入阶段/交接永久路径/四小节协议与唯一可写文件约束", () => {
    const text = renderPhaseHandover({ phase: L("a"), handover: "docs/R-01/P01-analysis/handover.md", next: "m 迁移实现" })
    expect(text).toContain("\"Analysis\" phase (a)")
    expect(text).toContain("handover distiller")
    expect(text).toContain("docs/R-01/P01-analysis/handover.md")
    for (const section of ["## Key decisions", "## Constraints and pitfalls", "## Required reading for the next phase", "## Artifact index"]) {
      expect(text).toContain(section)
    }
    expect(text).toContain("The next phase is \"m 迁移实现\"")
    expect(text).toContain("only file this session may write is docs/R-01/P01-analysis/handover.md")
    expect(text).toContain("Distill only")
    expect(text).toContain("do not modify any")
    expect(text).toContain("AUTO-DECISION")
    expect(text).toContain("maintained exclusively by the DRIVER")
    expect(text).toContain("git commits are made by the DRIVER after the session ends")
  })

  test("k 阶段无下一阶段: 供后续查阅措辞,仍要求四小节", () => {
    const text = renderPhaseHandover({ phase: L("k"), handover: "docs/R-01/P03-knowledge/handover.md" })
    expect(text).toContain("no next phase")
    expect(text).toContain("later rounds and")
    for (const section of ["## Key decisions", "## Constraints and pitfalls", "## Required reading for the next phase", "## Artifact index"]) {
      expect(text).toContain(section)
    }
    // 无任务清单阶段(k)的兜底表述: 无任务索引/CURRENT.md 缺失属预期,蒸馏以本阶段 kb.md 产物为准
    expect(text).toContain("no task index tasks.md")
    expect(text).toContain("no\nCURRENT.md")
    expect(text).toContain("this phase directory's kb.md")
    expect(text).toContain("skip")
    // 有下一阶段时不带收尾措辞
    const withNext = renderPhaseHandover({ phase: L("a"), handover: "docs/R-01/P01-analysis/handover.md", next: "m 迁移实现" })
    expect(withNext).not.toContain("no next phase")
    expect(withNext).not.toContain("kb.md")
  })

  test("不含 verified 字段描述(verify 已退役)", () => {
    expect(renderPhaseHandover({ phase: L("m"), handover: "docs/R-01/P02-implement/handover.md" })).not.toContain("verified")
  })

  test("代表性参数组合渲染后不残留模板标签", () => {
    for (const text of [
      renderPhaseHandover({ phase: L("a"), handover: "docs/R-01/P01-analysis/handover.md", next: "m 迁移实现" }),
      renderPhaseHandover({ phase: L("k"), handover: "docs/R-01/P03-knowledge/handover.md" }),
    ]) {
      expect(text).not.toMatch(/\{\{|\}\}/)
    }
  })
})

describe("renderKnowledge(k 阶段知识提取会话,P4 认领 --extract-knowledge)", () => {
  const FILE = "docs/R-01/P03-knowledge/kb.md"

  test("注入输出路径、来源清单与章节骨架;只读分析、唯一可写文件为输出路径", () => {
    const text = renderKnowledge({ file: FILE })
    expect(text).toContain(FILE)
    // 来源指针(本轮轮次目录内的阶段索引与各阶段目录的交接文档,阶段目录内另有 PLAN 快照)
    expect(text).toContain("docs/R-NN/phases.md")
    expect(text).toContain("docs/R-NN/P<nn>-<type>/handover.md")
    expect(text).toContain("docs/R-NN/P<nn>-<type>/")
    expect(text).toContain("git log")
    // 章节骨架(规格书 §13 的本仓库化,Design Deviations 改以 AUTO-DECISION 为来源)
    for (const section of ["## Migration summary", "## API and type mapping", "## Implementation patterns", "## Pitfalls and edge cases", "## Reusable rules", "## Design deviations and key decisions", "## Verification evidence", "## References"]) {
      expect(text).toContain(section)
    }
    expect(text).toContain("AUTO-DECISION")
    // 质量约束(规格书 §14)
    expect(text).toContain("Final state first")
    expect(text).toContain("Deduplicate")
    expect(text).toContain("Do not copy session dialogue")
    expect(text).toContain("verifiable anchor")
    expect(text).toContain('labelled "rejected"')
    expect(text).toContain("the only file you may write this time is " + FILE)
    expect(text).toContain("maintained by the DRIVER alone")
    expect(text).toContain("Git commits are made by the DRIVER in one pass after the session ends")
    expect(text).toContain("Distil only")
  })

  test("注入 mode.exec 场景背景;不传模式时整块消失", () => {
    const text = renderKnowledge({ file: FILE, mode: migrate })
    expect(text).toContain("Scenario mode notes (migrate)")
    expect(text).toContain("Migration/upgrade mode notes")
    expect(renderKnowledge({ file: FILE })).not.toContain("Scenario mode notes")
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
      distilled: ["docs/R-01/P02-implement/handover.md", "docs/R-01/P03-knowledge/kb.md"],
    })
    expect(withList).toContain("## Input: existing distilled artifacts (reference, do not restate)")
    expect(withList).toContain("must not be restated in this")
    expect(withList).toContain("- docs/R-01/P02-implement/handover.md")
    expect(withList).toContain("- docs/R-01/P03-knowledge/kb.md")
    // 引用化同款约束: 已覆盖知识点以一行引用代替摘抄
    expect(withList).toContain("a one-line reference (`see <path>: <one sentence>`)")
    const bare = renderPriorKnowledge({ file: "docs/prior-kb/R1-prior-x.md" })
    expect(bare).not.toContain("## Input: existing distilled artifacts")
    expect(bare).not.toContain("must not be restated")
    expect(renderPriorKnowledge({ file: "docs/prior-kb/R1-prior-x.md", distilled: [] })).not.toContain("## Input: existing distilled artifacts")
  })

  test("收笔标记协议: 中间产物路径说明 + 末尾「DONE」独占一行 + 未写全前不写", () => {
    usePromptLibrary(undefined)
    const text = renderPriorKnowledge({ file: "docs/R-01/temp-kb.md" })
    expect(text).toContain("intermediate artifact path")
    expect(text).toContain("put the line `DONE` on a line of its own at the very end of the document")
    expect(text).toContain("DRIVER-parsed protocol string: write it verbatim, do not translate it")
    expect(text).toContain("never write that line before every section is complete")
    expect(text).toContain("promote the file to the official prior-knowledge document")
  })
})
