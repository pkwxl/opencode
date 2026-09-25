// src/prompt.ts 执行族渲染的单测: 合并理解与分解/基点/子任务/收尾/修复/整任务/测试执行协议/死循环提示/dryrun。
// 拆分自 test/prompt.test.ts(plans/0024-module-split-plan.md S19,纯搬运)。

import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parsePhaseTypeFile } from "../src/phases/custom"
import { phaseTypeOfLetter, type PhaseLetter } from "../src/phases/registry"

const key = (letter: PhaseLetter) => ({ id: "R-01.P01", entry: phaseTypeOfLetter(letter) })
import { renderAgentsBlock } from "../src/agents-block"
import { usePromptLibrary } from "../src/template"
import {
  decomposeTemplateName,
  renderContextBase,
  renderDecompose,
  renderDryrun,
  renderHandoffSteer,
  renderKnowledge,
  renderPriorKnowledge,
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
import { prerequisites } from "../src/tasks"
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
    expect(text).toContain("- [ ] <subtask description; ends with Artifacts: <path list>>")
    expect(text).toContain("docs/T-002/S<two-digit zero-padded index>/todo.md")
    expect(text).toContain("## Scope")
    expect(text).toContain("## Artifacts")
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

  test("closed task (plans/0053 D16): the done list labels it [closed] with its reason, still under already done", () => {
    const closedPlan = {
      ...plan,
      tasks: plan.tasks.map((t) => (t.id === "T-001" ? { ...t, closed: "superseded" } : t)),
      closed: new Map([["T-001", "superseded"]]),
    }
    const text = renderDecompose(closedPlan, closedPlan.tasks[1]!)
    const line = "- [closed] T-001: 搭建 schema (closed without completing: superseded)"
    expect(text).toContain(line)
    expect(text).not.toContain("[done] T-001")
    expect(text.indexOf("These tasks are already done, do not redo them:")).toBeLessThan(text.indexOf(line))
    // The original fixture without closures still renders the [done] line
    expect(renderDecompose(plan, task)).toContain("- [done] T-001: 搭建 schema")
    expect(renderDecompose(plan, task)).not.toContain("[closed]")
  })

  // Closed-prerequisite notes in the task block (plans/0053 D16): one DRIVER line per closed
  // effective prerequisite (explicit or implicit).
  const note = (id: string, reason: string) =>
    `[DRIVER] Prerequisite ${id} was closed without completing (${reason}); do not assume its deliverables exist.`

  test("closed-prerequisite note: a closed implicit prerequisite (no Depends:, the previous task) → note after the body and a blank line", () => {
    const closedPlan = {
      ...plan,
      tasks: plan.tasks.map((t) => (t.id === "T-001" ? { ...t, closed: "superseded" } : t)),
      closed: new Map([["T-001", "superseded"]]),
    }
    const current = closedPlan.tasks[1]!
    expect(prerequisites(closedPlan, current.id)).toEqual(["T-001"])
    const text = renderDecompose(closedPlan, current)
    expect(text).toContain(`# T-002: 实现迁移\n\n${current.body}\n\n${note("T-001", "superseded")}`)
    expect(text.split("[DRIVER] Prerequisite").length - 1).toBe(1)
  })

  test("closed-prerequisite note: closed explicit external prerequisites → one line each in Depends: order; a closed non-prerequisite gets none", () => {
    const closedPlan = {
      ...plan,
      tasks: plan.tasks.map((t) => (t.id === "T-003" ? { ...t, depends: ["T-050", "T-060", "T-001"] } : t)),
      closed: new Map([
        ["T-050", "scope dropped"],
        ["T-001", "superseded"],
      ]),
    }
    const current = closedPlan.tasks[2]!
    const text = renderDecompose(closedPlan, current)
    // T-060 is a prerequisite but not closed: no note
    expect(text).toContain(`${current.body}\n\n${note("T-050", "scope dropped")}\n${note("T-001", "superseded")}`)
    expect(text).not.toContain("Prerequisite T-060")
    // T-002's only effective prerequisite is the implicit T-001; T-050 is closed but not its prerequisite
    const other = renderDecompose(closedPlan, closedPlan.tasks[1]!)
    expect(other).toContain(note("T-001", "superseded"))
    expect(other).not.toContain("Prerequisite T-050")
  })

  test("closed-prerequisite note: a closed task that is not a prerequisite → no note; without closures the task block is byte-identical", () => {
    // T-003 has no Depends:; its implicit prerequisite is T-002 (not closed); the closed T-001 is not its prerequisite
    const closedPlan = {
      ...plan,
      tasks: plan.tasks.map((t) => (t.id === "T-001" ? { ...t, closed: "superseded" } : t)),
      closed: new Map([["T-001", "superseded"]]),
    }
    expect(prerequisites(closedPlan, "T-003")).toEqual(["T-002"])
    expect(renderDecompose(closedPlan, closedPlan.tasks[2]!)).not.toContain("[DRIVER] Prerequisite")
    // The first task has no prerequisites
    expect(prerequisites(closedPlan, "T-001")).toEqual([])
    expect(renderDecompose(closedPlan, closedPlan.tasks[0]!)).not.toContain("[DRIVER] Prerequisite")
    // No closures: the task block is the title plus the body, with nothing appended
    const text = renderDecompose(plan, task)
    expect(text).not.toContain("[DRIVER] Prerequisite")
    expect(text).toContain(`# T-002: 实现迁移\n\n${task.body}`)
    expect(text).not.toContain(`${task.body}\n\n[DRIVER]`)
  })
})

describe("renderDecompose(分阶段模板 decompose-<phase>)", () => {
  const phaseCases: Array<[PhaseLetter, string, string]> = [
    ["a", "Analysis", "Split by problem/open question/subsystem/risk surface"],
    ["d", "Design", "Split by design concern"],
    ["m", "Implementation", "Vertical thin slices first"],
    ["t", "Testing", "Split by test surface / scenario family"],
    ["v", "Acceptance", "Split by acceptance dimension"],
    ["k", "Knowledge distillation", "Split by knowledge artifact"],
  ]

  test("各阶段渲染: 注入阶段名与该阶段的切分准则段", () => {
    for (const [phase, name, rule] of phaseCases) {
      const text = renderDecompose(plan, task, { phase: key(phase) })
      expect(text).toContain(`The current phase is ${name}`)
      expect(text).toContain(rule)
      // 共通粒度准则段(decompose-rule)与检查项协议
      expect(text).toContain("Decomposition granularity criteria")
      expect(text).toContain("measured against the task description")
      expect(text).toContain("- [ ]")
    }
  })

  test("custom type (M3.6): the phase-generic body with the file's decompose duties, or none", () => {
    const withDuties = parsePhaseTypeFile("security-review", "# Security review\n\n## plan duties\n\nx\n\n## decompose duties\n\nSplit by attack surface.\n")
    const text = renderDecompose(plan, task, { phase: { id: "R-01.P02", entry: withDuties } })
    expect(text).toContain("The current phase is Security review")
    expect(text).toContain("Split by attack surface.")
    expect(text).not.toContain("Vertical thin slices first")
    expect(text).toContain("- [ ]")
    const bare = parsePhaseTypeFile("review", "# Review\n\n## plan duties\n\nx\n")
    const plain = renderDecompose(plan, task, { phase: { id: "R-01.P02", entry: bare } })
    expect(plain).toContain("The current phase is Review")
    expect(plain).not.toContain("Vertical thin slices first")
    expect(plain).not.toMatch(/\{\{|\}\}/)
  })

  test("m 默认: 未传 phase 时选择 decompose-m", () => {
    const text = renderDecompose(plan, task)
    expect(text).toContain("The current phase is Implementation")
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
    expect(decomposeTemplateName(phaseTypeOfLetter("m"), ["decompose"])).toBe("decompose")
    expect(decomposeTemplateName(undefined, ["decompose"])).toBe("decompose")
    expect(decomposeTemplateName(phaseTypeOfLetter("v"), ["decompose", "decompose-v"])).toBe("decompose-v")
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
      expect(renderDecompose(plan, task, { phase: key("a") })).toContain("Split by problem/open question/subsystem/risk surface")
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
        "# default\n\n## quality\n\n### decompose\n\nCUSTOM-RULE {{contextBudget}}\n\n## phase duties\n\n### m Implementation\n\nCUSTOM-DUTIES {{phaseName}}\n",
      )
      useIntentPacks(dir)
      const text = renderDecompose(plan, task)
      expect(text).toContain("CUSTOM-RULE 32.0k")
      expect(text).toContain("CUSTOM-DUTIES Implementation")
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
      expect(text).toContain("- [ ] <subtask description; ends with Artifacts: <path list>>")
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
      const sub = renderSubtask(plan, task, subtask)
      expect(sub).toContain("CUSTOM-SUBTASK-CHECK")
      expect(sub).not.toContain("check for yourself whether this subtask is genuinely complete")
      // 核心协议不受影响: 收尾步骤仍在
      expect(sub).toContain("you may add to the content of docs/ but not modify it")
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
      const sub = renderSubtask(plan, task, subtask)
      expect(sub).not.toContain("check for yourself")
      // 收尾步骤仍在(b/c 项保留既有编号,0032 D4 的编号取舍同口径)
      expect(sub).toContain("3. Close-out:")
      expect(sub).toContain("you may add to the content of docs/ but not modify it")
      const whole = renderWhole(plan, task)
      expect(whole).not.toContain("check for yourself")
      expect(whole).toContain("Constraints:")
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
    expect(text).toContain("task T-002's understanding phase")
    expect(text).toContain("docs/T-002/context.md). This session")
    expect(text).toContain("established by the DRIVER")
    expect(text).toContain(digest)
    expect(text).toContain("a short acknowledgement reply is enough")
    expect(text).toContain("do not expand any analysis")
    expect(text).toContain("do not modify anything")
    expect(text).toContain("once you have acknowledged it")
  })
})

describe("renderSubtask", () => {
  const subtask = "编写迁移脚本的 schema 部分"

  test("只做一个子任务并自我检查;不含任务级验收与 verify 描述(verify 已退役)", () => {
    const text = renderSubtask(plan, task, subtask)
    expect(text).toContain(subtask)
    expect(text).toContain("Complete this one subtask strictly")
    expect(text).toContain("check for yourself whether this subtask is genuinely complete")
    expect(text).toContain("you may add to the content of docs/ but not modify it")
    expect(text).toContain("T-002: 实现迁移")
    // 状态文件由 DRIVER 维护,不再要求 agent 勾选
    expect(text).toContain("are maintained by the DRIVER alone")
    expect(text).not.toContain("change it to `- [x]`")
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
    expect(text).toContain("All subtasks of this task were completed one by one in earlier sessions; do not redo them")
    expect(text).toContain("docs/T-002/report.md")
    expect(text).not.toContain("git 提交全部未提交改动")
    expect(text).toContain("Git commits are made by the DRIVER in one pass after the session ends")
    expect(text).toContain("are maintained by the DRIVER alone")
    expect(text).not.toContain("把当前任务的状态标记改为 [done]")
  })

  test("收尾: 任务状态由 DRIVER 登记;结论行协议(Result: PASS|FAIL)落 report.md,写作纪律来自意图包", () => {
    const text = renderWrapup(plan, task)
    expect(text).toContain("The task status is recorded by the DRIVER in one pass after the session ends")
    expect(text).toContain("`Result: PASS` or `Result: FAIL <one-sentence reason>`")
    expect(text).toContain(`last line of body text of docs/${task.id}/report.md`)
    // (b) 类纪律来自内置意图包 ## acceptance / ### result-line
    expect(text).toContain("Never write PASS for a check you did not run or observe")
    expect(text).not.toContain("verified")
    expect(text).not.toContain("结论: 通过")
  })

  test("零意图基线: 意图包缺 ### result-line 时结论行指令整段消失(从不因结论停机)", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-intent-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "intents")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "default.md"), "# default\n\n## acceptance\n")
      useIntentPacks(dir)
      const text = renderWrapup(plan, task)
      expect(text).not.toContain("Result:")
      expect(text).toContain("The task status is recorded by the DRIVER in one pass after the session ends")
      expect(text).not.toMatch(/\{\{|\}\}/)
    } finally {
      useIntentPacks(undefined)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("solo 模式(off/ondemand)不提及子任务", () => {
    expect(renderWrapup(plan, task, { solo: true })).toContain("The implementation of this task was completed in earlier sessions")
    expect(renderWrapup(plan, task, { solo: true })).not.toContain("All subtasks")
    expect(renderWrapup(plan, task)).toContain("All subtasks of this task were completed one by one")
  })

  test("索引式报告(auto 模式): 逐子任务一行引用产物路径,不复制产物内容", () => {
    const text = renderWrapup(plan, task)
    expect(text).toContain("an indexed report")
    expect(text).toContain("one line per subtask")
    expect(text).toContain("docs/T-002/S<NN>/index.md or code location")
    expect(text).toContain("do not copy or rewrite the content of the subtask artifacts")
    expect(text).toContain("overall conclusion and open issues, so that later sessions")
  })

  test("solo 模式保持摘要式报告,不带索引式协议", () => {
    const text = renderWrapup(plan, task, { solo: true })
    expect(text).not.toContain("indexed")
    expect(text).toContain("a summary of the output (what changed, key decisions and open items),\n   so that later sessions")
    expect(text).not.toContain("S<NN>")
  })

  // 收尾闭环 H7(plans/0020-auto-resolve-design.md §I): DRIVER 观测到的代答清单注入收尾
  // 提示词,要求 report.md 单列 "Proxy-answered questions" 节。
  test("无代答(缺省/空清单)时代答段整体消失", () => {
    for (const text of [renderWrapup(plan, task), renderWrapup(plan, task, { resolves: [] })]) {
      expect(text).not.toContain("auto-answered")
      expect(text).not.toContain("Proxy-answered")
      expect(text).not.toContain("AUTO-RESOLVE")
      expect(text).not.toContain("resolveList")
    }
  })

  test("有代答时逐条列出原问题,并要求 report.md 单列 Proxy-answered questions 节", () => {
    const text = renderWrapup(plan, task, { resolves: [resolveItem("是否把第三份 formatTokens 一并收口?")] })
    expect(text).toContain("the DRIVER auto-answered the following questions that you should have asked the user")
    expect(text).toContain("   - 是否把第三份 formatTokens 一并收口?")
    expect(text).toContain('In docs/T-002/report.md give these their own section, "Proxy-answered questions"')
    expect(text).toContain("AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)")
    expect(text).toContain("Every item above must appear")
    // 置于三项固定收尾要求之后、"以上全部完成前不要结束会话"之前
    expect(text.indexOf("auto-answered")).toBeGreaterThan(text.indexOf("report.md:"))
    expect(text.indexOf("auto-answered")).toBeLessThan(text.indexOf("Do not end the session before all of the above is done"))
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

describe("renderWhole", () => {
  test("off 模式: 单会话完成整个任务,不含交接条款", () => {
    const text = renderWhole(plan, task)
    expect(text).toContain("You are responsible for the whole task this time, completed within a single session, without decomposing it into subtasks")
    expect(text).toContain("T-002: 实现迁移")
    expect(text).not.toContain("handoff.md")
    expect(text).not.toContain("git 提交全部未提交改动")
  })

  test("ondemand 模式: 附交接条款;continuation 要求先读交接文档", () => {
    const text = renderWhole(plan, task, { ondemand: true })
    expect(text).toContain("docs/T-002/handoff.md")
    expect(text).toContain("[DRIVER] This session's context is about to reach the limit")
    expect(text).not.toContain("First read docs/T-002/handoff.md")
    const cont = renderWhole(plan, task, { ondemand: true, continuation: true })
    expect(cont).toContain("First read docs/T-002/handoff.md")
    expect(cont).toContain("then carry on from there")
  })

  test("不含会话内提交要求(state-rule 注入提交原则)", () => {
    expect(renderWhole(plan, task)).not.toContain("git 提交全部未提交改动")
    expect(renderWhole(plan, task)).toContain("Git commits are made by the DRIVER in one pass after the session ends")
  })

  test("交接提示要求写出状态行", () => {
    const steer = renderHandoffSteer(task)
    expect(steer).toContain("docs/T-002/handoff.md")
    expect(steer).toContain("Status: continue")
    expect(steer).toContain("Status: done")
  })

  test("test-by-DRIVER: 注入测试执行协议(与 ondemand 交接条款可同现)", () => {
    const text = renderWhole(plan, task, { ondemand: true, testByDriver: true, handoverTest: true })
    expect(text).toContain("Test execution protocol (--test-by-driver)")
    expect(text).toContain("tmp/test.sh")
    expect(text).toContain("docs/T-002/handoff.md")
    expect(text).toContain("docs/T-002/testhandoff.md")
    expect(renderWhole(plan, task)).not.toContain("Test execution protocol")
  })
})

describe("测试执行协议(--test-by-driver)", () => {
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
    expect(text).toContain("Status: continue")
    // 测试结果恒由下一个会话判读,交接之后一定还有工作——测试交接没有"完成"这一态
    // (handoff.md 才有: 那边的交接只是建议,活干完了自然不交接)
    expect(text).not.toContain("Status: done")
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
    expect(text).toContain("permission pre-check")
    expect(text).toContain("opencode.json")
    expect(text).toContain("read-only probes")
    expect(text).toContain(".auto/dryrun.md")
    expect(text).toContain("do not modify any implementation code")
  })
})

describe("intent externalization, understand/wrap-up/knowledge family (M2.1)", () => {
  const stuck = { kind: "repeat" as const, tool: "bash", count: 3, level: 2, input: "ls", detail: "x" }
  const driverResolve = resolveItem("策略选 A 还是 B?")

  function withPack(text: string, fn: () => void) {
    const dir = mkdtempSync(join(tmpdir(), "auto-intent-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "intents")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "default.md"), text)
      useIntentPacks(dir)
      fn()
    } finally {
      useIntentPacks(undefined)
      rmSync(dir, { recursive: true, force: true })
    }
  }

  test("built-in pack: every moved segment reaches its session", () => {
    expect(renderDecompose(plan, task)).toContain("in four sections:")
    const wrapup = renderWrapup(plan, task, { resolves: [driverResolve] })
    expect(wrapup).toContain("an indexed report")
    expect(wrapup).toContain("Every item above must appear; also list any other proxy decisions you identified on your own")
    expect(renderWrapup(plan, task, { solo: true })).toContain("a summary of the output (what changed, key decisions and open items),\n   so that later sessions")
    expect(renderKnowledge({ file: "kb.md" })).toContain("## Quality constraints (hard requirements)\n\n1. Final state first")
    expect(renderPriorKnowledge({ file: "kb.md" })).toContain("deduplicate across documents")
    expect(renderStuckHint(stuck)).toContain("still going in circles. Write these three things out")
    expect(renderStuckHint({ ...stuck, level: 1 })).not.toContain("Write these three things out")
    // The AGENTS.md block carries no maintenance rules any more (plans/0054 D2).
    expect(renderAgentsBlock()).not.toContain("maintenance rules")
  })

  test("zero-intent baseline: an empty pack drops each segment cleanly, core protocol stays", () => {
    withPack("# default\n", () => {
      const decompose = renderDecompose(plan, task)
      expect(decompose).not.toContain("four sections")
      expect(decompose).toContain("docs/T-002/context.md\n   Keep it compact")
      const wrapup = renderWrapup(plan, task, { resolves: [driverResolve] })
      expect(wrapup).not.toContain("an indexed report")
      expect(wrapup).toContain("docs/T-002/report.md: so that later sessions")
      expect(wrapup).toContain("Every item above must appear.")
      expect(renderWrapup(plan, task, { solo: true })).toContain("report.md:\n   so that later sessions")
      const knowledge = renderKnowledge({ file: "kb.md" })
      expect(knowledge).not.toContain("Quality constraints")
      expect(knowledge).toMatch(/`>\n\n## Steps/)
      expect(renderPriorKnowledge({ file: "kb.md" })).not.toContain("Quality constraints")
      const hint = renderStuckHint(stuck)
      expect(hint).toContain("still going in circles.\n")
      expect(hint).not.toContain("Write these three things out")
      const block = renderAgentsBlock()
      expect(block).not.toContain("maintenance rules")
      expect(block).toContain("Summary principle")
      // question-rule falls back to the core minimum: protocol + marker formats
      const subtask = renderSubtask(plan, task, "编写迁移脚本的 schema 部分")
      expect(subtask).not.toContain("The call should have been the user's")
      expect(subtask).toContain("AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)")
      for (const text of [decompose, wrapup, knowledge, hint, subtask]) expect(text).not.toMatch(/\{\{|\}\}/)
    })
  })

  test("a project pack replaces the governance catalog; marker formats stay core-owned", () => {
    withPack(
      "# default\n\n## governance\n\n### decisions-unattended\n\n   CUSTOM-CATALOG: mark user-owned calls with {{resolveFormat}}.\n\n### agents-maintenance\n\nCUSTOM-MAINT\n",
      () => {
        const subtask = renderSubtask(plan, task, "编写迁移脚本的 schema 部分")
        expect(subtask).toContain("   CUSTOM-CATALOG: mark user-owned calls with `AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)`.")
        expect(subtask).not.toContain("A decision of your own must leave a record in the relevant document")
        // A leftover `### agents-maintenance` subsection has no consumer (plans/0054 D2).
        expect(renderAgentsBlock()).not.toContain("CUSTOM-MAINT")
      },
    )
  })
})

describe("intent externalization, P1 and test-handover discipline (M2.3)", () => {
  function withPack(text: string, fn: () => void) {
    const dir = mkdtempSync(join(tmpdir(), "auto-intent-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "intents")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "default.md"), text)
      useIntentPacks(dir)
      fn()
    } finally {
      useIntentPacks(undefined)
      rmSync(dir, { recursive: true, force: true })
    }
  }

  test("built-in pack: the P1 discipline reaches subtask and whole sessions; test-wrapup keeps its wording", () => {
    for (const text of [renderSubtask(plan, task, "编写迁移脚本的 schema 部分"), renderWhole(plan, task)]) {
      expect(text).toContain("Process documents are the DRIVER's record of this long-running work")
      expect(text).toContain("each line must carry its own question, decision and reason and never point at a process document")
    }
    const wrap = renderTestWrapup({ handoffFile: "docs/T-002/testhandoff.md" })
    expect(wrap).toContain("(code, documents, artifacts) — do not omit any of it because a handover is due")
    expect(wrap).toContain("handover notes. This is not a loophole for omitting work — what step 1 says to finish must still be finished; remaining work that you do not list here")
  })

  test("zero-intent baseline: the discipline drops out, the handover protocol stays", () => {
    withPack("# default\n", () => {
      expect(renderSubtask(plan, task, "编写迁移脚本的 schema 部分")).not.toContain("Process documents are")
      expect(renderWhole(plan, task)).not.toContain("Process documents are")
      const wrap = renderTestWrapup({ handoffFile: "docs/T-002/testhandoff.md" })
      expect(wrap).toContain("(code, documents, artifacts);\n")
      expect(wrap).toContain("handover notes. Remaining work that you do not list here")
      expect(wrap).not.toContain("loophole")
      expect(wrap).toContain("docs/T-002/testhandoff.md")
      expect(wrap).toContain("Status: continue")
      expect(wrap).not.toMatch(/\{\{|\}\}/)
    })
  })
})
