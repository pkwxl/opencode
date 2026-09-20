// src/prompt.ts 执行族渲染的单测: 合并理解与分解/基点/子任务/收尾/修复/整任务/测试执行协议/死循环提示/dryrun。
// 拆分自 test/prompt.test.ts(plans/0024-module-split-plan.md S19,纯搬运)。

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
  renderWhole,
  renderWrapup,
  subtaskOutputFile,
  testHandoffFile,
  useIntentPacks,
  type TestRunInfo,
} from "../src/prompt"
import { groundPlan, groundTask, listPlan, listTask, plan, resolveItem, task } from "./fixtures/prompt"

describe("renderDecompose", () => {
  test("合并会话(M1.0): 理解四节 + 公共上下文索引 + subtasks.md 检查项 + 各子任务 todo.md", () => {
    const text = renderDecompose(plan, task)
    expect(text).toContain("This session completes the task-background understanding and the subtask decomposition; it writes no implementation code")
    expect(text).toContain("docs/T-002/context.md")
    expect(text).toContain("## Relevant files and key symbols")
    expect(text).toContain("## Constraints and premises")
    expect(text).toContain("## Existing decisions and current state")
    expect(text).toContain("## Risks and unknowns")
    expect(text).toContain("docs/T-002/shared.md")
    expect(text).toContain("prefetch by reference")
    expect(text).toContain("docs/T-002/subtasks.md")
    expect(text).toContain("- [ ] <subtask description; ends with 产出: <path list>>")
    expect(text).toContain("docs/T-002/S<two-digit zero-padded index>/todo.md")
    expect(text).toContain("## 范围声明")
    expect(text).toContain("## 产出清单")
    expect(text).toContain("modify no implementation code")
    expect(text).toContain("question tool")
    // 状态文件排他: todo.md/done.md 由 DRIVER 管理
    expect(text).toContain("must neither create done.md")
    expect(text).toContain("blocks the task and stops the run")
    expect(text).toContain("End the session as soon as the files are written")
  })

  test("taskContext 档位: off 缺省 200 行,small/medium/large 放宽 300/400/500 行", () => {
    expect(renderDecompose(plan, task)).toContain("aim for 200 lines or fewer")
    expect(renderDecompose(plan, task, { taskContext: "off" })).toContain("aim for 200 lines or fewer")
    expect(renderDecompose(plan, task, { taskContext: "small" })).toContain("aim for 300 lines or fewer")
    expect(renderDecompose(plan, task, { taskContext: "medium" })).toContain("aim for 400 lines or fewer")
    expect(renderDecompose(plan, task, { taskContext: "large" })).toContain("aim for 500 lines or fewer")
  })

  test("包含已完成任务、当前任务与状态文件只读规则,不再复述 PLAN.md 阻塞记事", () => {
    const text = renderDecompose(plan, task)
    expect(text).toContain("[done] T-001: 搭建 schema")
    expect(text).toContain("you do not need to know anything about the other tasks")
    expect(text).toContain("T-002: 实现迁移")
    expect(text).toContain("编写迁移脚本。")
    // 阻塞原因/解答已退役: 不再从 PLAN.md 读出来注入提示词
    expect(text).not.toContain("策略选 A 还是 B?")
    expect(text).not.toContain("此前被阻塞")
    expect(text).toContain("are maintained by the DRIVER alone")
    // 自动答复要求记录决策过程并标注 AUTO-DECISION
    expect(text).toContain("must leave a record of how it was made")
    expect(text).toContain("AUTO-DECISION")
  })
})

describe("renderDecompose(分阶段模板 decompose-<phase>)", () => {
  const phaseCases: Array<[Phase, string, string]> = [
    ["a", "分析", "Split by problem/open question/subsystem/risk surface"],
    ["d", "设计", "Split by design concern"],
    ["m", "迁移实现", "Vertical thin slices first"],
    ["t", "测试", "Split by test surface / scenario family"],
    ["v", "验收", "Split by acceptance dimension"],
    ["k", "知识提炼", "Split by knowledge artifact"],
  ]

  test("各阶段渲染: 注入阶段名与该阶段的切分准则段", () => {
    for (const [phase, name, rule] of phaseCases) {
      const text = renderDecompose(plan, task, { phase })
      expect(text).toContain(`The current phase is ${name}`)
      expect(text).toContain(rule)
      // 共通粒度准则段(decompose-rule)与检查项协议
      expect(text).toContain("Decomposition granularity criteria")
      expect(text).toContain("measured against the task description")
      expect(text).toContain("- [ ]")
    }
  })

  test("m 默认: 未传 phase 时选择 decompose-m", () => {
    const text = renderDecompose(plan, task)
    expect(text).toContain("The current phase is 迁移实现")
    expect(text).toContain("Vertical thin slices first")
  })

  test("fine 两态: 细粒度段按开关出现/消失;contextBudget 注入半预算", () => {
    const off = renderDecompose(plan, task, { contextLimit: 100_000 })
    expect(off).toContain("on the order of 50.0k tokens")
    expect(off).not.toContain("Fine-grained mode")
    const on = renderDecompose(plan, task, { fine: true })
    expect(on).toContain("Fine-grained mode")
    expect(on).toContain("prefer finer over coarser")
    expect(on).toContain("on the order of 32.0k tokens")
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
      expect(() => usePromptLibrary(dir)).toThrow(/decompose-m\.md is missing required protocol content/)
      expect(() => usePromptLibrary(dir)).toThrow(/- \[ \]/)
      writeFileSync(join(overlay, "decompose-m.md"), "自定义分解提示词,保留协议: - [ ] 项,产物 context.md 与各 todo.md")
      usePromptLibrary(dir)
      expect(renderDecompose(plan, task)).toBe("自定义分解提示词,保留协议: - [ ] 项,产物 context.md 与各 todo.md")
      // 未覆盖的阶段模板仍取内置
      expect(renderDecompose(plan, task, { phase: "a" })).toContain("Split by problem/open question/subsystem/risk surface")
    } finally {
      usePromptLibrary(undefined)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("意图包外置(M1.2): 项目覆盖 default 包即替换分解意图,useIntentPacks 装载生效", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-intent-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "intents")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(
        join(overlay, "default.md"),
        "# default\n\n## quality\n\n### decompose\n\nCUSTOM-RULE {{contextBudget}}\n\n## phase duties\n\n### m 迁移实现\n\nCUSTOM-DUTIES {{phaseName}}\n",
      )
      useIntentPacks(dir)
      const text = renderDecompose(plan, task)
      expect(text).toContain("CUSTOM-RULE 32.0k")
      expect(text).toContain("CUSTOM-DUTIES 迁移实现")
      // 整包替换(无合并): 内置准则消失
      expect(text).not.toContain("Decomposition granularity criteria")
      expect(text).not.toContain("Vertical thin slices first")
    } finally {
      useIntentPacks(undefined)
      rmSync(dir, { recursive: true, force: true })
    }
    // 复位后内置包恢复生效
    expect(renderDecompose(plan, task)).toContain("Vertical thin slices first")
  })

  test("零意图基线: 空 default 包覆盖时准则段整体消失,核心协议保留", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-intent-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "intents")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "default.md"), "# default\n\n## quality\n\n## phase duties\n")
      useIntentPacks(dir)
      const text = renderDecompose(plan, task)
      expect(text).not.toContain("Decomposition granularity criteria")
      expect(text).not.toContain("Splitting and artifact criteria for this phase (迁移实现)")
      // 核心模板仍承载角色边界与格式协议
      expect(text).toContain("This session completes the task-background understanding and the subtask decomposition; it writes no implementation code")
      expect(text).toContain("- [ ] <subtask description; ends with 产出: <path list>>")
      expect(text).not.toMatch(/\{\{|\}\}/)
    } finally {
      useIntentPacks(undefined)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("renderSubtask/renderWhole 收尾自查句意图外置(M1.3)", () => {
  const subtask = "编写迁移脚本的 schema 部分"

  test("内置包: 子任务与整任务模板各自注入对应范围的自查句", () => {
    expect(renderSubtask(plan, task, subtask)).toContain("check for yourself whether this subtask is genuinely complete")
    expect(renderWhole(plan, task)).toContain("once the whole task is complete, check for yourself whether it is genuinely complete")
    // 两句不同文: 子任务句不带"完成整个任务后"前缀,整任务句不带"该子任务"
    expect(renderSubtask(plan, task, subtask)).not.toContain("once the whole task is complete, check for yourself")
    expect(renderWhole(plan, task)).not.toContain("whether this subtask is genuinely complete")
  })

  test("项目覆盖 default 包即替换自查句,useIntentPacks 装载生效", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-intent-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "intents")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(
        join(overlay, "default.md"),
        "# default\n\n## quality\n\n### self-check-subtask\n\nCUSTOM-SUBTASK-CHECK\n\n### self-check-whole\n\nCUSTOM-WHOLE-CHECK\n",
      )
      useIntentPacks(dir)
      const sub = renderSubtask(plan, task, subtask, { verify: true })
      expect(sub).toContain("CUSTOM-SUBTASK-CHECK")
      expect(sub).not.toContain("check for yourself whether this subtask is genuinely complete")
      // 核心协议不受影响: 验收交接描述与收尾步骤仍在
      expect(sub).toContain("independent review session")
      const whole = renderWhole(plan, task)
      expect(whole).toContain("CUSTOM-WHOLE-CHECK")
      expect(whole).not.toContain("once the whole task is complete, check for yourself whether it is genuinely complete")
    } finally {
      useIntentPacks(undefined)
      rmSync(dir, { recursive: true, force: true })
    }
    expect(renderSubtask(plan, task, subtask)).toContain("check for yourself whether this subtask is genuinely complete")
  })

  test("零意图基线: 空 default 包覆盖时自查项整行消失,核心协议保留且无残渣", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-intent-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "intents")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "default.md"), "# default\n\n## quality\n")
      useIntentPacks(dir)
      const sub = renderSubtask(plan, task, subtask, { verify: true })
      expect(sub).not.toContain("check for yourself")
      // 收尾步骤仍在(b/c 项保留既有编号,0032 D4 的编号取舍同口径)
      expect(sub).toContain("3. Close-out:")
      expect(sub).toContain("you may add to the content of docs/ but not modify it")
      const whole = renderWhole(plan, task, { verify: true })
      expect(whole).not.toContain("check for yourself")
      expect(whole).toContain("约束:")
      for (const text of [sub, whole]) {
        expect(text).not.toMatch(/\{\{|\}\}/)
        expect(text).not.toMatch(/\n\n\n/)
      }
    } finally {
      useIntentPacks(undefined)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("renderSubtask 产出约定意图外置(M1.4,artifact spec 节)", () => {
  const subtask = "编写执行逻辑"

  test("内置包: 有产出文件位(index 给定或推导)时注入约定段,无位时整段消失", () => {
    const withFile = renderSubtask(listPlan, listTask, subtask, { index: 2 })
    expect(withFile).toContain("Artifact placement convention")
    expect(withFile).toContain("write it into docs/T-004/S02/index.md (a standalone file, title on the first line, not merged into another document)")
    expect(withFile).toContain("code artifacts go directly into the source tree")
    const noFile = renderSubtask(plan, task, "编写迁移脚本")
    expect(noFile).not.toContain("Artifact placement convention")
  })

  test("项目覆盖 default 包即替换约定段,useIntentPacks 装载生效;包文本可用模板变量", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-intent-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "intents")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "default.md"), "# default\n\n## artifact spec\n\n### subtask-output\n\nCUSTOM-CONVENTION 写入 {{outputFile}}\n")
      useIntentPacks(dir)
      const text = renderSubtask(listPlan, listTask, subtask, { index: 2 })
      expect(text).toContain("CUSTOM-CONVENTION 写入 docs/T-004/S02/index.md")
      // 整包替换(无合并): 内置约定消失
      expect(text).not.toContain("Artifact placement convention")
    } finally {
      useIntentPacks(undefined)
      rmSync(dir, { recursive: true, force: true })
    }
    // 复位后内置包恢复生效
    expect(renderSubtask(listPlan, listTask, subtask, { index: 2 })).toContain("Artifact placement convention")
  })

  test("零意图基线: 空 default 包覆盖时约定段消失,核心协议保留且无残渣", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-intent-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "intents")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "default.md"), "# default\n")
      useIntentPacks(dir)
      const text = renderSubtask(listPlan, listTask, subtask, { index: 2 })
      expect(text).not.toContain("Artifact placement convention")
      // 核心协议不受影响: 状态文件指针与排他条款仍在(tier-1 面不随意图包消失)
      expect(text).toContain("This subtask's scope declaration is in docs/T-004/S02/todo.md")
      expect(text).toContain("managed by the DRIVER alone")
      expect(text).toContain("Constraints:")
      expect(text).not.toMatch(/\{\{|\}\}/)
      expect(text).not.toMatch(/\n\n\n/)
    } finally {
      useIntentPacks(undefined)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("renderContextBase(fork 流水线 ①′ digest 基点会话)", () => {
  test("摘要全文逐字注入 + 一句确认 + 不读不写不展开", () => {
    const digest = "## 相关文件与关键符号\n- src/x.ts: 数据模型\n\n## 约束与前提\n- 只读目标目录"
    const text = renderContextBase(task, digest)
    expect(text).toContain("任务 T-002 理解阶段产出的背景摘要")
    expect(text).toContain("docs/T-002/context.md 全文")
    expect(text).toContain("本会话由 DRIVER 建立")
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
    expect(text).toContain("Complete this one subtask strictly")
    expect(text).toContain("check for yourself whether this subtask is genuinely complete")
    expect(text).toContain("acceptance for the whole task happens at the very end in one independent review session")
    expect(text).toContain("you may add to the content of docs/ but not modify it")
    expect(text).toContain("T-002: 实现迁移")
    // 状态文件由 DRIVER 维护,不再要求 agent 勾选
    expect(text).toContain("are maintained by the DRIVER alone")
    expect(text).toContain("the verified field")
    expect(text).not.toContain("change it to `- [x]`")
  })

  test("verify 未启用: 不含任务级验收与 verify 描述,仍要求不更新 docs/", () => {
    const text = renderSubtask(plan, task, subtask)
    expect(text).toContain("check for yourself whether this subtask is genuinely complete")
    expect(text).toContain("you may add to the content of docs/ but not modify it")
    expect(text).not.toContain("verify")
    expect(text).not.toContain("acceptance")
    expect(text).not.toContain("the verified field")
  })

  test("不含会话内提交要求: 统一提交由 DRIVER 在会话后执行", () => {
    const text = renderSubtask(plan, task, subtask)
    expect(text).not.toContain("commit all uncommitted changes")
    expect(text).toContain("Git commits are made by the DRIVER in one pass after the session ends")
    expect(text).toContain("do not run git commit")
  })

  test("交接条款默认注入;continuation 要求先读交接文档", () => {
    const text = renderSubtask(plan, task, subtask)
    expect(text).toContain("docs/T-002/handoff.md")
    expect(text).toContain("[DRIVER] This session's context is about to reach the limit")
    expect(text).toContain("counting whether this subtask is complete")
    expect(text).not.toContain("First read docs/T-002/handoff.md")
    const cont = renderSubtask(plan, task, subtask, { continuation: true })
    expect(cont).toContain("First read docs/T-002/handoff.md")
    expect(cont).toContain("then carry on from there")
  })

  test("test-by-DRIVER: 注入测试执行协议;未启用时整块消失", () => {
    const on = renderSubtask(plan, task, subtask, { testByDriver: true })
    expect(on).toContain("Test execution protocol (--test-by-driver)")
    expect(on).toContain("tmp/test.sh")
    expect(on).toContain("do not run compile, test, build, lint or similar commands directly inside the session")
    expect(on).toContain("write the command as a script into the test/ directory")
    expect(on).toContain("write the same script path into tmp/test.sh once more")
    // handover-test 附带交接文档提示
    const handover = renderSubtask(plan, task, subtask, { testByDriver: true, handoverTest: true })
    expect(handover).toContain("docs/T-002/testhandoff.md")
    expect(handover).toContain("so that a new session can interpret the test result and continue")
    // 未启用时协议与交接描述均不出现(doc-layout 共享段的规范性提及不含交接协议本身)
    const off = renderSubtask(plan, task, subtask)
    expect(off).not.toContain("Test execution protocol")
    expect(off).not.toContain("tmp/test.sh")
    expect(off).not.toContain("the established handover rhythm")
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
    expect(text).toContain("The complete subtask list of this task (executed in order; the other items belong to other sessions, do not touch them)")
    expect(text).toContain("1. 编写 schema 部分\n2. 编写执行逻辑\n3. 编写文档")
    expect(text).toContain("You are responsible for item 2 of that list only")
    expect(text).toContain("- [ ] 编写执行逻辑")
    // 产出约定: 文档类产出写 DRIVER 机械命名的独立文件
    expect(text).toContain("Artifact placement convention")
    expect(text).toContain("write it into docs/T-004/S02/index.md (a standalone file, title on the first line, not merged into another document)")
    expect(text).toContain("code artifacts go directly into the source tree")
  })

  test("缺省推导: 不传 index 时按正文检查项定位同名项", () => {
    const text = renderSubtask(listPlan, listTask, "编写文档")
    expect(text).toContain("You are responsible for item 3 of that list only")
    expect(text).toContain("write it into docs/T-004/S03/index.md")
  })

  test("背景段 warm 两态: 继承上下文勿重读 / 冷启动先读 context.md 摘要", () => {
    const warm = renderSubtask(listPlan, listTask, "编写文档", { index: 3, warm: true })
    expect(warm).toContain("This session has inherited the task-background context (the understanding stage's digest and loaded content), so do not re-read files that are already in context")
    expect(warm).toContain("if background is still missing, read the docs/T-004/context.md digest")
    expect(warm).not.toContain("read it first to learn the task background")
    const cold = renderSubtask(listPlan, listTask, "编写文档", { index: 3 })
    expect(cold).toContain("If docs/T-004/context.md exists, read it first to learn the task background before starting (if it does not exist, read the source yourself as needed)")
    expect(cold).not.toContain("inherited the task-background context")
  })

  test("无检查项任务(旧形态): 单条呈现,列表与产出约定段不出现", () => {
    const text = renderSubtask(plan, task, "编写迁移脚本")
    expect(text).toContain("You are responsible for this single subtask of the task only")
    expect(text).not.toContain("complete subtask list")
    expect(text).not.toContain("Artifact placement convention")
  })

  test("subtaskOutputFile: 两位递增命名(超出两位自然进位)", () => {
    expect(subtaskOutputFile(task, 1)).toBe("docs/T-002/S01/index.md")
    expect(subtaskOutputFile(task, 9)).toBe("docs/T-002/S09/index.md")
    expect(subtaskOutputFile(task, 12)).toBe("docs/T-002/S12/index.md")
    expect(subtaskOutputFile(task, 123)).toBe("docs/T-002/S123/index.md")
  })
})

describe("renderSubtask(L1 权威状态接地 + L3 全限定编号,session-boundary-hardening §4.1)", () => {
  test("接地块注入: 当前任务状态 + 全限定编号 + 勾选快照 + 前序任务独立声明", () => {
    const text = renderSubtask(groundPlan, groundTask, "本任务子任务一", { index: 1 })
    expect(text).toContain("Authoritative DRIVER ledger state")
    expect(text).toContain("Current task: T-002 \"本任务\", status: in progress")
    expect(text).toContain("Fully qualified id of this subtask: T-002.S01")
    expect(text).toContain("S01☐ S02☐ S03☐, done 0/3")
    expect(text).toContain("ticks are maintained by the DRIVER once each subtask session ends")
    expect(text).toContain("The previously completed tasks T-001 are independent of this task")
    expect(text).toContain("say nothing about this task's progress")
    expect(text).toContain("may be consulted only as a format/precedent reference")
    // 接地块紧随 head 之后、任务块之前(会话先见权威状态再看任务正文)
    expect(text.indexOf("Authoritative DRIVER ledger state")).toBeGreaterThan(text.indexOf("do not carry them out."))
    expect(text.indexOf("Authoritative DRIVER ledger state")).toBeLessThan(text.indexOf("# T-002: 本任务"))
  })

  test("勾选快照反映台账勾选状态: S 编号与全限定编号两位补零、已完成 k/n 如实计数", () => {
    const text = renderSubtask(listPlan, listTask, "编写执行逻辑", { index: 2 })
    expect(text).toContain("S01☑ S02☐ S03☐, done 1/3")
    expect(text).toContain("Fully qualified id of this subtask: T-004.S02")
  })

  test("编号撞名防误读: 前序任务的勾选状态不注入,声明直指他任务的 S 编号与本任务无关", () => {
    const text = renderSubtask(groundPlan, groundTask, "本任务子任务一", { index: 1 })
    expect(text).toContain("S-numbers appearing in other tasks' documents or commit records belong to those tasks and are unrelated to this one")
    expect(text).not.toContain("S01☑")
    // 防的就是把 T-001 的「S01 已完成」读成本任务状态
    expect(text).toContain("never infer whether this task is done from other tasks' documents, handovers or git commit records")
  })

  test("无检查项任务(旧形态): 无编号与快照行,状态行与声明仍注入", () => {
    const text = renderSubtask(plan, task, "编写迁移脚本")
    expect(text).toContain("Current task: T-002 \"实现迁移\", status: blocked")
    expect(text).not.toContain("Fully qualified id")
    expect(text).not.toContain("Subtask tick snapshot")
    // 前序声明仍在场(plan 夹具有已完成的 T-001)
    expect(text).toContain("The previously completed tasks T-001")
  })

  test("无前序已完成任务: 前序声明整体消失", () => {
    const text = renderSubtask(listPlan, listTask, "编写执行逻辑", { index: 2 })
    expect(text).not.toContain("The previously completed tasks")
  })
})

describe("renderWrapup", () => {
  test("只执行收尾: docs、report.md,不标 done、不提交", () => {
    const text = renderWrapup(plan, task)
    expect(text).toContain("全部子任务已在之前的会话中逐一完成,不要重做")
    expect(text).toContain("docs/T-002/report.md")
    expect(text).not.toContain("git 提交全部未提交改动")
    expect(text).toContain("Git commits are made by the DRIVER in one pass after the session ends")
    expect(text).toContain("are maintained by the DRIVER alone")
    expect(text).not.toContain("把当前任务的状态标记改为 [done]")
  })

  test("verify 处理权在 DRIVER(verify 启用): 收尾不运行 verify、不下结论,由独立审核会话验收", () => {
    const text = renderWrapup(plan, task, { verify: true })
    expect(text).toContain("不要运行任务级 verify、不要下验收结论")
    expect(text).toContain("verify 的处理权在 DRIVER")
    expect(text).toContain("独立审核会话")
    expect(text).toContain("the verified field")
    expect(text).not.toContain("verified-command")
    expect(text).not.toContain("结论: 通过")
    expect(text).not.toContain("结论: 差距")
  })

  test("verify 未启用: 收尾提示不涉及验收,任务状态由 DRIVER 登记", () => {
    const text = renderWrapup(plan, task)
    expect(text).toContain("任务状态由 DRIVER 在会话结束后统一登记")
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

  // 收尾闭环 H7(plans/0020-auto-resolve-design.md §I): DRIVER 观测到的代答清单注入收尾
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
    expect(text).toContain("DRIVER 自动代答了以下本应由你询问用户的问题")
    expect(text).toContain("   - 是否把第三份 formatTokens 一并收口?")
    expect(text).toContain("请在 docs/T-002/report.md 中单列「自动代答问题」一节")
    expect(text).toContain("AUTO-RESOLVE: <原问题> -> <所选方案> (<理由>)")
    expect(text).toContain("上面每一条都必须出现")
    // 置于三项固定收尾要求之后、"以上全部完成前不要结束会话"之前
    expect(text.indexOf("自动代答")).toBeGreaterThan(text.indexOf("report.md:"))
    expect(text.indexOf("自动代答")).toBeLessThan(text.indexOf("以上全部完成前不要结束会话"))
  })

  test("清单只列 DRIVER 源(agent 源已由会话自行标注),未配对的排在前", () => {
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
    expect(text).toContain("did not pass this task's acceptance")
    expect(text).toContain("Fix only the gaps the review pointed out")
    expect(text).toContain("do not run the task-level verify")
    expect(text).toContain("are maintained by the DRIVER alone")
    expect(text).not.toContain("verified-command")
  })

  test("test-by-DRIVER: 修复轮同样注入测试执行协议", () => {
    const text = renderFix(plan, task, "差距", { testByDriver: true })
    expect(text).toContain("Test execution protocol (--test-by-driver)")
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
    expect(text).toContain("[DRIVER] 上下文即将达到上限")
    expect(text).not.toContain("先读 docs/T-002/handoff.md")
    const cont = renderWhole(plan, task, { ondemand: true, continuation: true })
    expect(cont).toContain("先读 docs/T-002/handoff.md")
    expect(cont).toContain("据此继续")
  })

  test("不含会话内提交要求(state-rule 注入提交原则)", () => {
    expect(renderWhole(plan, task)).not.toContain("git 提交全部未提交改动")
    expect(renderWhole(plan, task)).toContain("Git commits are made by the DRIVER in one pass after the session ends")
  })

  test("交接提示要求写出状态行", () => {
    const steer = renderHandoffSteer(task)
    expect(steer).toContain("docs/T-002/handoff.md")
    expect(steer).toContain("状态: 继续")
    expect(steer).toContain("状态: 完成")
  })

  test("test-by-DRIVER: 注入测试执行协议(与 ondemand 交接条款可同现)", () => {
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
    expect(text).toContain("run number 3")
    expect(text).toContain("/tmp/pkg/test/build.sh")
    expect(text).toContain("Exit code: 1")
    expect(text).toContain("1234ms")
    expect(text).toContain("/tmp/pkg/tmp/test.3.out")
    expect(text).toContain("judge by reading the file directly")
    expect(text).toContain("write the same script path into tmp/test.sh once more")
    const timeout = renderTestResult({ ...run, timedOut: true, timeoutReason: "idle" })
    expect(timeout).toContain("no output throughout")
  })

  test("收尾+交接要求: 落盘不依赖测试的剩余工作 + 交接文档硬性要求", () => {
    const text = renderTestWrapup({ handoffFile: "/tmp/pkg/docs/T-002/testhandoff.md" })
    // 对测试时机保持中性: 顺序态(缺省)交接收口后才跑,并发态此刻已在跑,一份文案两态都成立。
    expect(text).toContain("will be run by the DRIVER")
    expect(text).not.toContain("in parallel")
    expect(text).toContain("not dependent on this test run's result")
    // 未完成事项必须随交接带走: 否则新会话无从知晓,会被当成已完成而永久遗漏
    expect(text).toContain("what is still unfinished in this execution scope")
    expect(text).toContain("/tmp/pkg/docs/T-002/testhandoff.md")
    expect(text).toContain("End the session as soon as the file is written")
    // 状态行(中断恢复 F1): DRIVER 凭它分辨"写完了"与"DRIVER 死在会话写文件途中的半截文件"
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
    for (const banned of ["context", "limit", "cap", "token", "Token", "do not modify", "do not change"]) {
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
    expect(stuck).toContain("has now happened 11 times in a row")
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
    expect(text).toContain("Loop detected")
    expect(text).toContain("edit")
    expect(text).toContain("has now failed 3 times with exactly the same error")
    expect(text).toContain("src/a.ts")
    expect(text).toContain("String not found in file")
    expect(text).toContain("Error:")
    expect(text).not.toContain("returned exactly the same result")
  })

  test("同参同果重复: 换一种说法,标注的是输出而非报错", () => {
    const text = renderStuckHint({ ...errorHit, kind: "repeat", tool: "read", count: 4, detail: "文件内容" })
    expect(text).toContain("has now returned exactly the same result 4 times for the same arguments")
    expect(text).toContain("Output:")
    expect(text).not.toContain("with exactly the same error")
  })

  test("三级升级: 换思路 → 先写诊断 → 停止重试并收尾", () => {
    const first = renderStuckHint(errorHit)
    expect(first).toContain("Stop and check your premises before acting again")
    expect(first).not.toContain("AUTO-FIXME")
    const second = renderStuckHint({ ...errorHit, level: 2 })
    expect(second).toContain("This is reminder number 2")
    expect(second).toContain("which approaches you have already tried")
    expect(second).not.toContain("AUTO-FIXME")
    const third = renderStuckHint({ ...errorHit, level: 3 })
    expect(third).toContain("This is the last reminder")
    expect(third).toContain("AUTO-FIXME")
    expect(third).toContain("end this session")
    expect(third).not.toContain("Stop and check your premises before acting again")
  })

  test("空参数/空输出有占位,渲染无残留标签", () => {
    const text = renderStuckHint({ ...errorHit, input: "", detail: "" })
    expect(text).toContain("(no arguments)")
    expect(text).toContain("(empty)")
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
