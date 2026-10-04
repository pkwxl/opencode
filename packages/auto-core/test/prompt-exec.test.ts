// Unit tests for the src/prompt.ts execution-family renders: merged understand+decompose / context base / subtask / wrap-up / repair / whole task / test execution protocol / stuck hint / dryrun.
// Split out of test/prompt.test.ts (plans/0024-module-split-plan.md S19, pure move).

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
  renderFanout,
  renderHandoffSteer,
  renderKnowledge,
  renderPriorKnowledge,
  renderSplitRejected,
  renderStuckHint,
  renderSubtask,
  renderTestContinue,
  renderTestResult,
  renderTestWrapup,
  renderUsageNoteInfo,
  renderUsageNoteWinddown,
  renderWhole,
  renderWrapup,
  type TestRunInfo,
} from "../src/prompt"
import { promptFacts } from "../src/prompt-facts"
import { subtaskOutputFile, taskDocPaths, testHandoffFile } from "../src/docpaths"
import { prerequisites, promptViews, type Plan, type Task } from "../src/tasks"
import { groundPlan, groundTask, listPlan, listTask, plan, resolveItem, task } from "./fixtures/prompt"
import { planOf } from "./fixtures/units"

// E2 render inputs: the render* functions take the facts, the plan/task views
// and the task's document paths as data. The facts build per call, so an
// intent-overlay test only points factsDir at its directory (the old
// useIntentPacks global of the pre-E2 era); the task-family shims build the views around the
// fixtures the assertions pass.
let factsDir: string | undefined
const facts = () => promptFacts({ dir: factsDir })
const docs = taskDocPaths(task.id)
const decOf = (p: Plan, t: Task, opts?: Parameters<typeof renderDecompose>[4]) => {
  const v = promptViews(p, t)
  return renderDecompose(facts(), v.plan, v.task, taskDocPaths(t.id), opts)
}
const subOf = (p: Plan, t: Task, text: string, opts?: Parameters<typeof renderSubtask>[5]) => {
  const v = promptViews(p, t)
  return renderSubtask(facts(), v.plan, v.task, taskDocPaths(t.id), text, opts)
}
const fanOf = (p: Plan, t: Task, text: string, index: number, opts: Parameters<typeof renderFanout>[6]) => {
  const v = promptViews(p, t)
  return renderFanout(facts(), v.plan, v.task, taskDocPaths(t.id), text, index, opts)
}
const wholeOf = (p: Plan, t: Task, opts?: Parameters<typeof renderWhole>[4]) => {
  const v = promptViews(p, t)
  return renderWhole(facts(), v.plan, v.task, taskDocPaths(t.id), opts)
}
const wrapOf = (p: Plan, t: Task, opts?: Parameters<typeof renderWrapup>[4]) => {
  const v = promptViews(p, t)
  return renderWrapup(facts(), v.plan, v.task, taskDocPaths(t.id), opts)
}

describe("renderDecompose", () => {
  test("merged session (M1.0): the four understand sections + the shared context index + the subtasks.md checklist + each subtask's todo.md", () => {
    const text = decOf(plan, task)
    expect(text).toContain("This session completes the task-background understanding and the subtask decomposition; it writes no implementation code")
    expect(text).toContain("docs/T-002/context.md")
    expect(text).toContain("## Relevant files and key symbols")
    expect(text).toContain("## Constraints and premises")
    expect(text).toContain("## Existing decisions and current state")
    expect(text).toContain("## Risks and unknowns")
    expect(text).toContain("docs/T-002/shared.md")
    expect(text).toContain("prefetch by reference")
    expect(text).toContain("docs/T-002/subtasks.md")
    expect(text).toContain("- [ ] <short title>: <subtask description; ends with Artifacts: <path list>>")
    expect(text).toContain("docs/T-002/S<two-digit zero-padded index>/todo.md")
    expect(text).toContain("## Scope")
    expect(text).toContain("## Artifacts")
    expect(text).toContain("modify no implementation code")
    expect(text).toContain("question tool")
    // The decompose session writes each subtask's todo.md only (0072 U-B/T-131
    // slimmed the DRIVER-ownership restatement; the block owns the rule)
    expect(text).toContain("You write each subtask's todo.md only — never done.md")
    expect(text).toContain("blocks the task and stops the run")
    expect(text).toContain("End the session as soon as the files are written")
  })

  test("the digest's suggested line count is fixed at 200 (the wording knob was retired, ruling P-2 of plans/0070)", () => {
    expect(decOf(plan, task)).toContain("aim for 200 lines or fewer")
  })

  test("D18 (plans/0068 S5): a level injects the decompose-side parallelism guidance beside the checklist; none stays byte-identical", () => {
    const plain = decOf(plan, task)
    const wide = decOf(plan, task, { parallel: "high" })
    expect(wide).toContain("Subtask parallelism (high): this project runs independent subtasks side by side")
    // The level's own subsection text (the default pack's `## parallelism` /
    // `### high`), framed onto the checklist items.
    expect(wide).toContain("Optimize for the largest number of tasks that can proceed side by side")
    expect(wide).not.toContain("## Parallelism (high)")
    // The block sits between the checklist's format example and the scope-file
    // step, so the framing reads as part of the checklist discipline.
    expect(wide.indexOf("Subtask parallelism")).toBeGreaterThan(wide.indexOf("- [ ] <short title>"))
    expect(wide.indexOf("Subtask parallelism")).toBeLessThan(wide.indexOf("Write a scope file for each subtask"))
    // Without a level the prompt keeps its exact pre-S5 bytes.
    expect(decOf(plan, task, { parallel: undefined })).toBe(plain)
    expect(plain).not.toContain("parallelism")
  })

  test("includes the already-done tasks, the current task and the state-file read-only rules; no longer restates PLAN.md blockage notes", () => {
    const text = decOf(plan, task)
    expect(text).toContain("[done] T-001: build the schema")
    expect(text).toContain("you do not need to know anything about the other tasks")
    expect(text).toContain("T-002: implement the migration")
    expect(text).toContain("Write the migration script.")
    // The blocked reason/answer is retired: no longer read out of PLAN.md into the prompt
    expect(text).not.toContain("strategy A or B?")
    expect(text).not.toContain("previously blocked")
    // 0072 U-B/T-131: the state-rule restatement retired; the block owns it
    expect(text).not.toContain("maintained by the DRIVER alone")
    // A proxy answer must record the decision process and label it AUTO-DECISION
    expect(text).toContain("must leave a record of how it was made")
    expect(text).toContain("AUTO-DECISION")
  })

  test("closed task (plans/0053 D16): the done list labels it [closed] with its reason, still under already done", () => {
    const closedPlan = {
      ...plan,
      tasks: plan.tasks.map((t) => (t.id === "T-001" ? { ...t, closed: "superseded" } : t)),
      closed: new Map([["T-001", "superseded"]]),
    }
    const text = decOf(closedPlan, closedPlan.tasks[1]!)
    const line = "- [closed] T-001: build the schema (closed without completing: superseded)"
    expect(text).toContain(line)
    expect(text).not.toContain("[done] T-001")
    expect(text.indexOf("These tasks are already done, do not redo them:")).toBeLessThan(text.indexOf(line))
    // The original fixture without closures still renders the [done] line
    expect(decOf(plan, task)).toContain("- [done] T-001: build the schema")
    expect(decOf(plan, task)).not.toContain("[closed]")
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
    const text = decOf(closedPlan, current)
    expect(text).toContain(`# T-002: implement the migration\n\n${current.body}\n\n${note("T-001", "superseded")}`)
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
    const text = decOf(closedPlan, current)
    // T-060 is a prerequisite but not closed: no note
    expect(text).toContain(`${current.body}\n\n${note("T-050", "scope dropped")}\n${note("T-001", "superseded")}`)
    expect(text).not.toContain("Prerequisite T-060")
    // T-002's only effective prerequisite is the implicit T-001; T-050 is closed but not its prerequisite
    const other = decOf(closedPlan, closedPlan.tasks[1]!)
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
    expect(decOf(closedPlan, closedPlan.tasks[2]!)).not.toContain("[DRIVER] Prerequisite")
    // The first task has no prerequisites
    expect(prerequisites(closedPlan, "T-001")).toEqual([])
    expect(decOf(closedPlan, closedPlan.tasks[0]!)).not.toContain("[DRIVER] Prerequisite")
    // No closures: the task block is the title plus the body, with nothing appended
    const text = decOf(plan, task)
    expect(text).not.toContain("[DRIVER] Prerequisite")
    expect(text).toContain(`# T-002: implement the migration\n\n${task.body}`)
    expect(text).not.toContain(`${task.body}\n\n[DRIVER]`)
  })
})

describe("renderDecompose (per-phase templates decompose-<phase>)", () => {
  const phaseCases: Array<[PhaseLetter, string, string]> = [
    ["a", "Analysis", "Split by problem/open question/subsystem/risk surface"],
    ["d", "Design", "Split by design concern"],
    ["m", "Implementation", "Vertical thin slices first"],
    ["t", "Testing", "Split by test surface / scenario family"],
    ["v", "Acceptance", "Split by acceptance dimension"],
    ["k", "Knowledge distillation", "Split by knowledge artifact"],
  ]

  test("each phase renders: injects the phase name and that phase's splitting-criteria paragraph", () => {
    for (const [phase, name, rule] of phaseCases) {
      const text = decOf(plan, task, { phase: key(phase) })
      expect(text).toContain(`The current phase is ${name}`)
      expect(text).toContain(rule)
      // The shared granularity-criteria paragraph (decompose-rule) and the checklist protocol
      expect(text).toContain("Decomposition granularity criteria")
      expect(text).toContain("measured against the task description")
      expect(text).toContain("- [ ]")
    }
  })

  test("custom type (M3.6): the phase-generic body with the file's decompose duties, or none", () => {
    const withDuties = parsePhaseTypeFile("security-review", "# Security review\n\n## plan duties\n\nx\n\n## decompose duties\n\nSplit by attack surface.\n")
    const text = decOf(plan, task, { phase: { id: "R-01.P02", entry: withDuties } })
    expect(text).toContain("The current phase is Security review")
    expect(text).toContain("Split by attack surface.")
    expect(text).not.toContain("Vertical thin slices first")
    expect(text).toContain("- [ ]")
    const bare = parsePhaseTypeFile("review", "# Review\n\n## plan duties\n\nx\n")
    const plain = decOf(plan, task, { phase: { id: "R-01.P02", entry: bare } })
    expect(plain).toContain("The current phase is Review")
    expect(plain).not.toContain("Vertical thin slices first")
    expect(plain).not.toMatch(/\{\{|\}\}/)
  })

  test("m default: decompose-m is chosen when no phase is passed", () => {
    const text = decOf(plan, task)
    expect(text).toContain("The current phase is Implementation")
    expect(text).toContain("Vertical thin slices first")
  })

  test("fine two states: the fine-grained paragraph appears/disappears with the switch; contextBudget injects the half budget", () => {
    const off = decOf(plan, task, { contextLimit: 100_000 })
    expect(off).toContain("on the order of 50.0k tokens")
    expect(off).not.toContain("Fine-grained mode")
    const on = decOf(plan, task, { fine: true })
    expect(on).toContain("Fine-grained mode")
    expect(on).toContain("prefer finer over coarser")
    expect(on).toContain("on the order of 32.0k tokens")
  })

  test("fallback: with no decompose-<phase> in the library, fall back to the generic decompose (the default looks the name up by m)", () => {
    expect(decomposeTemplateName(phaseTypeOfLetter("m"), ["decompose"])).toBe("decompose")
    expect(decomposeTemplateName(phaseTypeOfLetter("m"), ["decompose"])).toBe("decompose")
    expect(decomposeTemplateName(phaseTypeOfLetter("v"), ["decompose", "decompose-v"])).toBe("decompose-v")
    expect(decomposeTemplateName(phaseTypeOfLetter("m"), ["decompose", "decompose-m"])).toBe("decompose-m")
  })

  test("target-directory override decompose-m.md: missing the checklist-protocol lines fails naming the file; keeping them makes it take effect", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-prompt-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "prompts")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "decompose-m.md"), "Custom decompose prompt that lost the checklist protocol")
      expect(() => usePromptLibrary(dir)).toThrow(/decompose-m\.md is missing required protocol content/)
      expect(() => usePromptLibrary(dir)).toThrow(/- \[ \]/)
      writeFileSync(join(overlay, "decompose-m.md"), "Custom decompose prompt keeping the protocol: - [ ] items, artifacts context.md and each todo.md")
      usePromptLibrary(dir)
      expect(decOf(plan, task)).toBe("Custom decompose prompt keeping the protocol: - [ ] items, artifacts context.md and each todo.md")
      // Phase templates not overridden still come from the built-ins
      expect(decOf(plan, task, { phase: key("a") })).toContain("Split by problem/open question/subsystem/risk surface")
    } finally {
      usePromptLibrary(undefined)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("intent packs externalized (M1.2): a project override of the default pack replaces the decompose intent; the facts load it", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-intent-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "intents")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(
        join(overlay, "default.md"),
        "# default\n\n## quality\n\n### decompose\n\nCUSTOM-RULE {{contextBudget}}\n\n## phase duties\n\n### m Implementation\n\nCUSTOM-DUTIES {{phaseName}}\n",
      )
      factsDir = dir
      const text = decOf(plan, task)
      expect(text).toContain("CUSTOM-RULE 32.0k")
      expect(text).toContain("CUSTOM-DUTIES Implementation")
      // Whole-pack replacement (no merging): the built-in criteria disappear
      expect(text).not.toContain("Decomposition granularity criteria")
      expect(text).not.toContain("Vertical thin slices first")
    } finally {
      factsDir = undefined
      rmSync(dir, { recursive: true, force: true })
    }
    // After the reset the built-in pack takes effect again
    expect(decOf(plan, task)).toContain("Vertical thin slices first")
  })

  test("zero-intent baseline: an empty default pack override drops the criteria paragraph entirely; the core protocol stays", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-intent-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "intents")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "default.md"), "# default\n\n## quality\n\n## phase duties\n")
      factsDir = dir
      const text = decOf(plan, task)
      expect(text).not.toContain("Decomposition granularity criteria")
      expect(text).not.toContain("Splitting and artifact criteria for this phase (Implementation)")
      // The core template still carries the role boundary and the format protocol
      expect(text).toContain("This session completes the task-background understanding and the subtask decomposition; it writes no implementation code")
      expect(text).toContain("- [ ] <short title>: <subtask description; ends with Artifacts: <path list>>")
      expect(text).not.toMatch(/\{\{|\}\}/)
    } finally {
      factsDir = undefined
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("renderSubtask/renderWhole closing self-check sentence intent externalization (M1.3)", () => {
  const subtask = "write the schema part of the migration script"

  test("built-in pack: the subtask and whole-task templates each inject the self-check sentence for their own scope", () => {
    expect(subOf(plan, task, subtask)).toContain("check for yourself whether this subtask is genuinely complete")
    expect(wholeOf(plan, task)).toContain("once the whole task is complete, check for yourself whether it is genuinely complete")
    // The two sentences differ: the subtask sentence carries no "once the whole task is complete" prefix, the whole-task sentence no "this subtask"
    expect(subOf(plan, task, subtask)).not.toContain("once the whole task is complete, check for yourself")
    expect(wholeOf(plan, task)).not.toContain("whether this subtask is genuinely complete")
  })

  test("a project override of the default pack replaces the self-check sentence; the facts load it", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-intent-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "intents")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(
        join(overlay, "default.md"),
        "# default\n\n## quality\n\n### self-check-subtask\n\nCUSTOM-SUBTASK-CHECK\n\n### self-check-whole\n\nCUSTOM-WHOLE-CHECK\n",
      )
      factsDir = dir
      const sub = subOf(plan, task, subtask)
      expect(sub).toContain("CUSTOM-SUBTASK-CHECK")
      expect(sub).not.toContain("check for yourself whether this subtask is genuinely complete")
      // The core protocol is unaffected: the wrap-up step stays
      expect(sub).toContain("you may add to the content of docs/ but not modify it")
      const whole = wholeOf(plan, task)
      expect(whole).toContain("CUSTOM-WHOLE-CHECK")
      expect(whole).not.toContain("once the whole task is complete, check for yourself whether it is genuinely complete")
    } finally {
      factsDir = undefined
      rmSync(dir, { recursive: true, force: true })
    }
    expect(subOf(plan, task, subtask)).toContain("check for yourself whether this subtask is genuinely complete")
  })

  test("zero-intent baseline: an empty default pack override drops the self-check line entirely; the core protocol stays with no residue", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-intent-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "intents")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "default.md"), "# default\n\n## quality\n")
      factsDir = dir
      const sub = subOf(plan, task, subtask)
      expect(sub).not.toContain("check for yourself")
      // The wrap-up step stays (items b/c keep their existing numbering, the numbering trade-off of 0032 D4)
      expect(sub).toContain("3. Close-out:")
      expect(sub).toContain("you may add to the content of docs/ but not modify it")
      const whole = wholeOf(plan, task)
      expect(whole).not.toContain("check for yourself")
      expect(whole).toContain("Constraints:")
      for (const text of [sub, whole]) {
        expect(text).not.toMatch(/\{\{|\}\}/)
        expect(text).not.toMatch(/\n\n\n/)
      }
    } finally {
      factsDir = undefined
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("renderSubtask output-placement intent externalization (M1.4, artifact spec section)", () => {
  const subtask = "write the execution logic"

  test("built-in pack: with an output-file slot (index given or derived) the convention paragraph is injected; without one the whole paragraph disappears", () => {
    const withFile = subOf(listPlan, listTask, subtask, { index: 2 })
    expect(withFile).toContain("Artifact placement convention")
    expect(withFile).toContain("write it into docs/T-004/S02/index.md (a standalone file, title on the first line, not merged into another document)")
    expect(withFile).toContain("code artifacts go directly into the source tree")
    const noFile = subOf(plan, task, "write the migration script")
    expect(noFile).not.toContain("Artifact placement convention")
  })

  test("a project override of the default pack replaces the convention paragraph; the facts load it; pack text may use template variables", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-intent-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "intents")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "default.md"), "# default\n\n## artifact spec\n\n### subtask-output\n\nCUSTOM-CONVENTION write into {{outputFile}}\n")
      factsDir = dir
      const text = subOf(listPlan, listTask, subtask, { index: 2 })
      expect(text).toContain("CUSTOM-CONVENTION write into docs/T-004/S02/index.md")
      // Whole-pack replacement (no merging): the built-in convention disappears
      expect(text).not.toContain("Artifact placement convention")
    } finally {
      factsDir = undefined
      rmSync(dir, { recursive: true, force: true })
    }
    // After the reset the built-in pack takes effect again
    expect(subOf(listPlan, listTask, subtask, { index: 2 })).toContain("Artifact placement convention")
  })

  test("zero-intent baseline: an empty default pack override drops the convention paragraph; the core protocol stays with no residue", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-intent-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "intents")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "default.md"), "# default\n")
      factsDir = dir
      const text = subOf(listPlan, listTask, subtask, { index: 2 })
      expect(text).not.toContain("Artifact placement convention")
      // The core protocol is unaffected: the scope pointer and the completion
      // decision stay (the tier-1 surface does not vanish with the intent
      // pack); the state-rule restatement retired with 0072 U-B/T-131.
      expect(text).toContain("This subtask's scope declaration is in docs/T-004/S02/todo.md")
      expect(text).toContain("The completion decision for this subtask — whether it is done — is the DRIVER's")
      expect(text).toContain("Constraints:")
      expect(text).not.toMatch(/\{\{|\}\}/)
      expect(text).not.toMatch(/\n\n\n/)
    } finally {
      factsDir = undefined
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("renderContextBase (fork pipeline ①′ digest base session)", () => {
  test("the digest is injected verbatim in full + one acknowledgement sentence + no reading, no writing, no expanding", () => {
    const digest = "## Relevant files and key symbols\n- src/x.ts: data model\n\n## Constraints and premises\n- read-only target directory"
    const text = renderContextBase(facts(), task, digest)
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
  const subtask = "write the schema part of the migration script"

  test("does exactly one subtask and self-checks; no task-level acceptance or verify wording (verify retired)", () => {
    const text = subOf(plan, task, subtask)
    expect(text).toContain(subtask)
    expect(text).toContain("Complete this one subtask strictly")
    expect(text).toContain("check for yourself whether this subtask is genuinely complete")
    expect(text).toContain("you may add to the content of docs/ but not modify it")
    expect(text).toContain("T-002: implement the migration")
    // 0072 U-B/T-131: the state-rule restatement retired; the role-specific
    // completion-decision sentence survives, the DRIVER-ownership wording
    // (the block's) does not reach the prompt.
    expect(text).toContain("The completion decision for this subtask — whether it is done — is the DRIVER's")
    expect(text).not.toContain("maintained by the DRIVER alone")
    expect(text).not.toContain("change it to `- [x]`")
    expect(text).not.toContain("verify")
    expect(text).not.toContain("acceptance")
    expect(text).not.toContain("the verified field")
  })

  test("no in-session commit demand: the prohibition lives in the constitution, the prompt no longer restates it", () => {
    const text = subOf(plan, task, subtask)
    expect(text).not.toContain("commit all uncommitted changes")
    // 0072 U-B/T-131: state-rule retired; ground-state's "git commit
    // records" (a keep) is the only remaining mention.
    expect(text).not.toContain("any other commit command")
    expect(text).not.toContain("do not make them yourself")
  })

  test("no context-handover protocol (ondemand-only, plans/0056); continuation still demands reading the handover document first", () => {
    const text = subOf(plan, task, subtask)
    expect(text).not.toContain("[DRIVER] This session's context")
    expect(text).not.toContain("First read docs/T-002/handoff.md")
    const cont = subOf(plan, task, subtask, { continuation: true })
    expect(cont).toContain("First read docs/T-002/handoff.md")
    expect(cont).toContain("then carry on from there")
  })

  test("test-by-DRIVER: the protocol's operational extras are injected (the principle itself is the constitution's); when not enabled the whole block disappears", () => {
    const on = subOf(plan, task, subtask, { testByDriver: true })
    expect(on).toContain("Test execution protocol (--test-by-driver)")
    expect(on).toContain("tmp/test.sh")
    // 0072 U-B/T-131 (K6): only the operational extras stayed — the wait
    // rhythm and the re-run mechanics; the principle's wording (which
    // commands, why, how to request a run) is the AGENTS.md block's.
    expect(on).toContain("after writing the script path into tmp/test.sh, end your turn to wait")
    expect(on).toContain("write the same script path into tmp/test.sh once more to re-run it")
    expect(on).not.toContain("or similar commands directly inside the session")
    expect(on).not.toContain("write the command as a script into the test/ directory")
    // handover-test adds the handover-document note
    const handover = subOf(plan, task, subtask, { testByDriver: true, handoverTest: true })
    expect(handover).toContain("docs/T-002/testhandoff.md")
    expect(handover).toContain("so that a new session can interpret the test result and continue")
    // When not enabled neither the protocol nor the handover wording appears
    const off = subOf(plan, task, subtask)
    expect(off).not.toContain("Test execution protocol")
    expect(off).not.toContain("tmp/test.sh")
    expect(off).not.toContain("the established handover rhythm")
  })

  test("the test handover document is named inside the subtask-level directory: the next subtask cannot misread the previous subtask's leftover handover", () => {
    const handover = subOf(listPlan, listTask, "write the execution logic", { index: 2, testByDriver: true, handoverTest: true })
    expect(handover).toContain("docs/T-004/S02/testhandoff.md")
    expect(handover).not.toContain("docs/T-004/testhandoff.md")
    // Default index derivation (located by the body's checklist item) likewise lands in the subtask-level directory
    const derived = subOf(listPlan, listTask, "write the docs", { testByDriver: true, handoverTest: true })
    expect(derived).toContain("docs/T-004/S03/testhandoff.md")
    // A task without a checklist (old shape, single subtask) keeps task-level naming
    expect(subOf(plan, task, subtask, { testByDriver: true, handoverTest: true })).toContain("docs/T-002/testhandoff.md")
  })
})

describe("renderSubtask (subtask list / output file / background paragraph, fork pipeline injection)", () => {
  test("injects the checklist list (numbered in order, by title) and \"item N\"; the output file is zero-padded to two digits", () => {
    const text = subOf(listPlan, listTask, "write the execution logic", { index: 2 })
    expect(text).toContain("The subtask list of this task, by title (executed in order; the other items belong to other sessions, do not touch them)")
    expect(text).toContain("1. write the schema part\n2. write the execution logic\n3. write the docs")
    expect(text).toContain("You are responsible for item 2 of that list only")
    expect(text).toContain("- [ ] write the execution logic")
    // Output convention: document-type outputs go into a standalone file mechanically named by the DRIVER
    expect(text).toContain("Artifact placement convention")
    expect(text).toContain("write it into docs/T-004/S02/index.md (a standalone file, title on the first line, not merged into another document)")
    expect(text).toContain("code artifacts go directly into the source tree")
  })

  test("default derivation: without an index, the same-named item is located by the body's checklist", () => {
    const text = subOf(listPlan, listTask, "write the docs")
    expect(text).toContain("You are responsible for item 3 of that list only")
    expect(text).toContain("write it into docs/T-004/S03/index.md")
  })

  test("the list names every item by its title only; the session's own item follows in full (plans/0059 T1)", () => {
    const long = planOf(
      `## T-004: forked execution [pending]
Whole-task description.

- [x] schema: the schema part in src/schema.ts, with its migration and seed data Artifacts: src/schema.ts
- [ ] execution: the execution logic over the schema in src/exec.ts, verified by its test Artifacts: src/exec.ts
- [ ] docs: the README section on the new command Artifacts: README.md
`,
    )
    const item = long.tasks[0]!.checklist![1]!.text
    const text = subOf(long, long.tasks[0]!, item, { index: 2 })
    expect(text).toContain("1. schema\n2. execution\n3. docs\n")
    expect(text).toContain(`You are responsible for item 2 of that list only:\n\n- [ ] ${item}\n`)
    // No other item's description reaches the prompt.
    expect(text).not.toContain("with its migration and seed data")
    expect(text).not.toContain("the README section on the new command")
  })

  test("verification: targeted checks for every item; the last one (every other item done) also runs the task's full acceptance verification once (plans/0059 T5/T6)", () => {
    const middle = subOf(listPlan, listTask, "write the execution logic", { index: 2 })
    expect(middle).toContain("Verification: run the checks that target this subtask's own changes (its tests, the typecheck or build of what it touched), not the full suite.")
    expect(middle).not.toContain("This is the last subtask")
    // Item 3 with item 2 still open is not the last; with item 2 done it is.
    expect(subOf(listPlan, listTask, "write the docs", { index: 3 })).not.toContain("This is the last subtask")
    const done = planOf(
      `## T-004: forked execution [pending]
Whole-task description.

- [x] write the schema part
- [x] write the execution logic
- [ ] write the docs
`,
    )
    const last = subOf(done, done.tasks[0]!, "write the docs", { index: 3 })
    expect(last).toContain("This is the last subtask: once it is done, run the task's full acceptance verification once, for the whole task, and fix what it finds.")
    // The caller's own answer wins over the derived one.
    expect(subOf(listPlan, listTask, "write the execution logic", { index: 2, last: true })).toContain("This is the last subtask")
    // A task without a checklist has no position to judge.
    expect(subOf(plan, task, "write the migration script")).not.toContain("This is the last subtask")
  })

  test("background paragraph under the digest base: the digest is in context, the files the understanding stage read are not (plans/0059 T2)", () => {
    const text = subOf(listPlan, listTask, "write the docs", { index: 3, warm: true, digest: true })
    expect(text).toContain("This session has inherited the task-background digest: the text of docs/T-004/context.md is already in context, so do not re-read it. The files the understanding stage read are not in this context — read the ones this subtask needs.")
    expect(text).not.toContain("loaded content")
    // The digest flag means nothing without a fork: a cold start reads context.md first.
    expect(subOf(listPlan, listTask, "write the docs", { index: 3, digest: true })).toContain("If docs/T-004/context.md exists, read it first")
  })

  test("background paragraph warm two states: inherited context means no re-reading / a cold start reads the context.md digest first", () => {
    const warm = subOf(listPlan, listTask, "write the docs", { index: 3, warm: true })
    expect(warm).toContain("This session has inherited the task-background context (the understanding stage's digest and loaded content), so do not re-read files that are already in context")
    expect(warm).toContain("if background is still missing, read the docs/T-004/context.md digest")
    expect(warm).not.toContain("read it first to learn the task background")
    const cold = subOf(listPlan, listTask, "write the docs", { index: 3 })
    expect(cold).toContain("If docs/T-004/context.md exists, read it first to learn the task background before starting (if it does not exist, read the source yourself as needed)")
    expect(cold).not.toContain("inherited the task-background context")
  })

  test("task without a checklist (old shape): rendered as a single item; the list and the output-convention paragraph do not appear", () => {
    const text = subOf(plan, task, "write the migration script")
    expect(text).toContain("You are responsible for this single subtask of the task only")
    expect(text).not.toContain("The subtask list of this task")
    expect(text).not.toContain("Artifact placement convention")
  })

  test("subtaskOutputFile: two-digit incrementing names (past two digits it naturally carries)", () => {
    expect(subtaskOutputFile(task, 1)).toBe("docs/T-002/S01/index.md")
    expect(subtaskOutputFile(task, 9)).toBe("docs/T-002/S09/index.md")
    expect(subtaskOutputFile(task, 12)).toBe("docs/T-002/S12/index.md")
    expect(subtaskOutputFile(task, 123)).toBe("docs/T-002/S123/index.md")
  })
})

describe("renderSubtask (L1 authoritative state grounding + L3 fully qualified ids, session-boundary-hardening §4.1)", () => {
  test("grounding block injection: current task status + fully qualified id + tick snapshot + preceding-tasks independence declaration", () => {
    const text = subOf(groundPlan, groundTask, "current subtask one", { index: 1 })
    expect(text).toContain("Authoritative DRIVER ledger state")
    expect(text).toContain("Current task: T-002 \"current task\", status: in progress")
    expect(text).toContain("Fully qualified id of this subtask: T-002.S01")
    expect(text).toContain("S01☐ S02☐ S03☐, done 0/3")
    expect(text).toContain("ticks are maintained by the DRIVER once each subtask session ends")
    expect(text).toContain("The previously completed tasks T-001 are independent of this task")
    expect(text).toContain("say nothing about this task's progress")
    expect(text).toContain("may be consulted only as a format/precedent reference")
    // The grounding block sits right after the head and before the task block (the session sees the authoritative state before the task body)
    expect(text.indexOf("Authoritative DRIVER ledger state")).toBeGreaterThan(text.indexOf("do not carry them out."))
    expect(text.indexOf("Authoritative DRIVER ledger state")).toBeLessThan(text.indexOf("# T-002: current task"))
  })

  test("the tick snapshot reflects the ledger's ticks: S numbers and the fully qualified id are two-digit zero-padded, done k/n counts faithfully", () => {
    const text = subOf(listPlan, listTask, "write the execution logic", { index: 2 })
    expect(text).toContain("S01☑ S02☐ S03☐, done 1/3")
    expect(text).toContain("Fully qualified id of this subtask: T-004.S02")
  })

  test("number-collision misread guard: the preceding task's tick state is not injected; the declaration says outright that other tasks' S numbers are unrelated to this one", () => {
    const text = subOf(groundPlan, groundTask, "current subtask one", { index: 1 })
    expect(text).toContain("S-numbers appearing in other tasks' documents or commit records belong to those tasks and are unrelated to this one")
    expect(text).not.toContain("S01☑")
    // What this guards against is reading T-001's "S01 done" as this task's state
    expect(text).toContain("never infer whether this task is done from other tasks' documents, handovers or git commit records")
  })

  test("task without a checklist (old shape): no id or snapshot line; the status line and the declaration are still injected", () => {
    const text = subOf(plan, task, "write the migration script")
    expect(text).toContain("Current task: T-002 \"implement the migration\", status: blocked")
    expect(text).not.toContain("Fully qualified id")
    expect(text).not.toContain("Subtask tick snapshot")
    // The preceding declaration is still present (the plan fixture has T-001 done)
    expect(text).toContain("The previously completed tasks T-001")
  })

  test("no preceding done tasks: the preceding declaration disappears entirely", () => {
    const text = subOf(listPlan, listTask, "write the execution logic", { index: 2 })
    expect(text).not.toContain("The previously completed tasks")
  })
})

describe("renderWrapup", () => {
  test("wrap-up only: docs, report.md; no marking done, no committing", () => {
    const text = wrapOf(plan, task)
    expect(text).toContain("All subtasks of this task were completed one by one in earlier sessions; do not redo them")
    expect(text).toContain("docs/T-002/report.md")
    expect(text).not.toContain("git commit all uncommitted changes")
    // 0072 U-B/T-131: the state-rule restatement retired — the status line
    // (role-specific) stays, the commit/state-file principles (the block's)
    // no longer reach the render.
    expect(text).toContain("The task status is recorded by the DRIVER in one pass after the session ends")
    expect(text).not.toContain("any other commit command")
    expect(text).not.toContain("change the current task's status mark to [done]")
  })

  test("wrap-up: the task status is recorded by the DRIVER; the result-line protocol (Result: PASS|FAIL) lands in report.md; writing discipline comes from the intent pack", () => {
    const text = wrapOf(plan, task)
    expect(text).toContain("The task status is recorded by the DRIVER in one pass after the session ends")
    expect(text).toContain("`Result: PASS` or `Result: FAIL <one-sentence reason>`")
    expect(text).toContain(`last line of body text of docs/${task.id}/report.md`)
    // (b)-class discipline comes from the built-in intent pack ## acceptance / ### result-line
    expect(text).toContain("Never write PASS for a check you did not run or observe")
    expect(text).not.toContain("verified")
    expect(text).not.toContain("结论: 通过")
  })

  test("zero-intent baseline: without ### result-line the result-line instruction disappears entirely (never halts over a verdict)", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-intent-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "intents")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "default.md"), "# default\n\n## acceptance\n")
      factsDir = dir
      const text = wrapOf(plan, task)
      expect(text).not.toContain("Result:")
      expect(text).toContain("The task status is recorded by the DRIVER in one pass after the session ends")
      expect(text).not.toMatch(/\{\{|\}\}/)
    } finally {
      factsDir = undefined
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("solo mode (off/ondemand) does not mention subtasks", () => {
    expect(wrapOf(plan, task, { solo: true })).toContain("The implementation of this task was completed in earlier sessions")
    expect(wrapOf(plan, task, { solo: true })).not.toContain("All subtasks")
    expect(wrapOf(plan, task)).toContain("All subtasks of this task were completed one by one")
  })

  test("indexed report (auto mode): one line per subtask referencing artifact paths, no copying artifact content", () => {
    const text = wrapOf(plan, task)
    expect(text).toContain("an indexed report")
    expect(text).toContain("one line per subtask")
    expect(text).toContain("docs/T-002/S<NN>/index.md or code location")
    expect(text).toContain("do not copy or rewrite the content of the subtask artifacts")
    expect(text).toContain("overall conclusion and open issues, so that later sessions")
  })

  test("solo mode keeps the summary-style report, without the indexed protocol", () => {
    const text = wrapOf(plan, task, { solo: true })
    expect(text).not.toContain("indexed")
    expect(text).toContain("a summary of the output (what changed, key decisions and open items),\n   so that later sessions")
    expect(text).not.toContain("S<NN>")
  })

  // Wrap-up closed loop H7 (plans/0020-auto-resolve-design.md §I): the proxy-answer list the
  // DRIVER observed is injected into the wrap-up prompt, requiring report.md to carry a
  // standalone "Proxy-answered questions" section.
  test("with no proxy answers (default / empty list) the proxy-answer block disappears entirely", () => {
    for (const text of [wrapOf(plan, task), wrapOf(plan, task, { resolves: [] })]) {
      expect(text).not.toContain("auto-answered")
      expect(text).not.toContain("Proxy-answered")
      expect(text).not.toContain("AUTO-RESOLVE")
      expect(text).not.toContain("resolveList")
    }
  })

  test("with proxy answers each original question is listed, and report.md is required to carry a standalone Proxy-answered questions section", () => {
    const text = wrapOf(plan, task, { resolves: [resolveItem("Should the third formatTokens copy be closed out as well?")] })
    expect(text).toContain("the DRIVER auto-answered the following questions that you should have asked the user")
    expect(text).toContain("   - Should the third formatTokens copy be closed out as well?")
    expect(text).toContain('In docs/T-002/report.md give these their own section, "Proxy-answered questions"')
    expect(text).toContain("AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)")
    expect(text).toContain("Every item above must appear")
    // Placed after the three fixed wrap-up requirements and before "Do not end the session before all of the above is done"
    expect(text.indexOf("auto-answered")).toBeGreaterThan(text.indexOf("report.md:"))
    expect(text.indexOf("auto-answered")).toBeLessThan(text.indexOf("Do not end the session before all of the above is done"))
  })

  test("the list carries DRIVER-source items only (agent-source ones are already labeled by the session itself); unpaired ones come first", () => {
    const text = wrapOf(plan, task, {
      resolves: [
        { ...resolveItem("the paired question"), matched: true },
        { ...resolveItem("one the session itself labeled"), source: "agent", option: "option A", reason: "rationale" },
        resolveItem("the unpaired question"),
      ],
    })
    expect(text).not.toContain("one the session itself labeled")
    expect(text.indexOf("the unpaired question")).toBeLessThan(text.indexOf("the paired question"))
  })

  test("multi-line questions are squeezed to one line; empty questions take no slot", () => {
    const text = wrapOf(plan, task, {
      resolves: [resolveItem("Book depreciation\ninto the same   cap?"), resolveItem("   ")],
    })
    expect(text).toContain("   - Book depreciation into the same cap?")
    expect(text).not.toContain("   - \n")
  })
})

describe("renderWhole", () => {
  test("off mode: one session completes the whole task, without the handover clause", () => {
    const text = wholeOf(plan, task)
    expect(text).toContain("You are responsible for the whole task this time, completed within a single session, without decomposing it into subtasks")
    expect(text).toContain("T-002: implement the migration")
    expect(text).not.toContain("handoff.md")
    expect(text).not.toContain("git commit all uncommitted changes")
  })

  test("ondemand mode: the context-budget protocol rides on the steer (budget), without it no protocol; continuation demands reading the handover document first", () => {
    const text = wholeOf(plan, task, { ondemand: true, budget: true })
    expect(text).toContain("docs/T-002/handoff.md")
    expect(text).toContain("Context-budget protocol")
    expect(text).toContain("[DRIVER] This session's context has reached the wall")
    // The protocol block rides on budget (the steer built), not on ondemand
    // itself: with OPENCODE_AUTO_STEER=off the session gets no protocol.
    expect(wholeOf(plan, task, { ondemand: true })).not.toContain("Context-budget protocol")
    expect(text).not.toContain("First read docs/T-002/handoff.md")
    const cont = wholeOf(plan, task, { ondemand: true, budget: true, continuation: true })
    expect(cont).toContain("First read docs/T-002/handoff.md")
    expect(cont).toContain("then carry on from there")
  })

  test("auto's lead (adaptive): the split clause with its three criteria and the line format, in place of the single-session sentence", () => {
    const text = wholeOf(plan, task, { ondemand: true, budget: true, adaptive: true })
    expect(text).toContain("You are the lead session of this task")
    expect(text).not.toContain("without decomposing it into subtasks")
    expect(text).toContain("Split rule (adaptive decomposition)")
    expect(text).toContain("(a) the remaining work is 2 to 5 streams that each change their own files")
    expect(text).toContain("(b) each stream is substantial")
    expect(text).toContain("(c) the DRIVER's first `[DRIVER] context: …` notice")
    expect(text).toContain("write docs/T-002/subtasks.md with one checklist line per stream")
    expect(text).toContain("- [ ] <title>: <what to do, where, and how to verify it> Depends: S01 Artifacts: <file paths>")
    expect(text).toContain("without writing docs/T-002/handoff.md or any S<nn>/todo.md")
    // The clause follows the context-budget protocol it builds on.
    expect(text.indexOf("Split rule")).toBeGreaterThan(text.indexOf("Context-budget protocol"))
    // Without the flag (ondemand, off, a lead after a rejected split) the
    // prompt is the single-session one, byte for byte.
    expect(wholeOf(plan, task, { ondemand: true, budget: true, adaptive: false })).toBe(wholeOf(plan, task, { ondemand: true, budget: true }))
    expect(wholeOf(plan, task, { ondemand: true, budget: true })).not.toContain("Split rule")
  })

  test("D18 (plans/0068 S5): a level injects the split clause's parallelism guidance; without one the prompt is byte-identical", () => {
    const plain = wholeOf(plan, task, { ondemand: true, budget: true, adaptive: true })
    const wide = wholeOf(plan, task, { ondemand: true, budget: true, adaptive: true, parallel: "medium" })
    expect(wide).toContain("The streams run side by side under this project's parallel level medium")
    // The level's own subsection text (the default pack's `## parallelism` /
    // `### medium`) rides inside the clause, framed onto the streams.
    expect(wide).toContain("Prefer arrangements whose tasks are independent of each other")
    expect(wide.indexOf("parallel level medium")).toBeGreaterThan(wide.indexOf("Split rule"))
    expect(wide.indexOf("parallel level medium")).toBeLessThan(wide.indexOf("Before splitting"))
    // None (or the serial run that never carried the level): the clause keeps
    // its exact pre-S5 bytes.
    expect(wholeOf(plan, task, { ondemand: true, budget: true, adaptive: true, parallel: undefined })).toBe(plain)
    expect(plain).not.toContain("parallel level")
  })

  test("the rejected split's note: the reason, the removed checklist, no second split; the fresh-session fallback adds the committed earlier work", () => {
    const note = renderSplitRejected(facts(), docs, "1 item, where a split takes 2 to 5 streams")
    expect(note).toStartWith("[DRIVER] The split was not taken: 1 item, where a split takes 2 to 5 streams.")
    expect(note).toContain("docs/T-002/subtasks.md has been removed")
    expect(note).toContain("Finish the task in this session and do not split it again")
    expect(note).not.toContain("git log")
    expect(renderSplitRejected(facts(), docs, "why", true)).toContain("its changes are committed: check git log and git diff")
  })

  test("the usage notices carry the figure slots and the handover path; the wind-down band carries the status protocol", () => {
    const info = renderUsageNoteInfo(facts(), docs)
    expect(info).toContain("{{used}}")
    expect(info).toContain("{{pct}}")
    expect(info).toContain("{{wall}}")
    expect(info).toContain("docs/T-002/handoff.md")
    const winddown = renderUsageNoteWinddown(facts(), docs)
    expect(winddown).toContain("{{used}}")
    expect(winddown).toContain("docs/T-002/handoff.md")
    expect(winddown).toContain("Status: continue")
    expect(winddown).toContain("Status: done")
  })

  test("no in-session commit demand (the commit principle travels in the AGENTS.md constitution, not the prompt)", () => {
    expect(wholeOf(plan, task)).not.toContain("git commit all uncommitted changes")
    // 0072 U-B/T-131: the state-rule partial (which restated the commit and
    // state-file principles into 14 templates) retired — the block owns both
    // wordings and the rendered prompt carries no restatement of either.
    // (whole's ground-state names "git commit records" as a thing not to
    // infer progress from — a keep, not a restatement.)
    expect(wholeOf(plan, task)).not.toContain("any other commit command")
    expect(wholeOf(plan, task)).not.toContain("do not make them yourself")
  })

  test("the handover steer demands the status line be written", () => {
    const steer = renderHandoffSteer(facts(), docs)
    expect(steer).toContain("docs/T-002/handoff.md")
    expect(steer).toContain("Status: continue")
    expect(steer).toContain("Status: done")
  })

  test("test-by-DRIVER: the test execution protocol is injected (can coexist with the ondemand context-budget protocol)", () => {
    const text = wholeOf(plan, task, { ondemand: true, budget: true, testByDriver: true, handoverTest: true })
    expect(text).toContain("Test execution protocol (--test-by-driver)")
    expect(text).toContain("tmp/test.sh")
    expect(text).toContain("docs/T-002/handoff.md")
    expect(text).toContain("docs/T-002/testhandoff.md")
    expect(wholeOf(plan, task)).not.toContain("Test execution protocol")
  })
})

describe("renderFanout and the stream's full prompt (plans/0059 D5)", () => {
  const line = "write the execution logic: src/exec.ts, verify with its test Depends: S01 Artifacts: src/exec.ts"
  const siblings = ["S01 write the schema part (done)", "S03 write the docs"]

  test("the delta a fork of the lead gets: the item line in full, the siblings by title, no task block or rules", () => {
    const text = fanOf(listPlan, listTask, line, 2, { siblings })
    expect(text).toStartWith("[DRIVER] Your split was taken")
    expect(text).toContain("it runs stream T-004.S02, nothing else")
    expect(text).toContain(`- [ ] ${line}`)
    expect(text).toContain("- S01 write the schema part (done)\n- S03 write the docs")
    // The fork holds the task and its rules: the delta restates neither.
    expect(text).not.toContain("Whole-task description.")
    expect(text).not.toContain("Constraints:")
    // No per-item record for code; the terminator discipline the lead never saw.
    expect(text).toContain("write no docs/T-004/S02/index.md for code changes")
    expect(text).toContain("<!-- auto: eof -->")
    expect(text).toContain("Do not change docs/T-004/subtasks.md")
    expect(text).toContain("check for yourself whether this subtask is genuinely complete")
  })

  test("the files changed since the split replace the do-not-re-read sentence; the last stream runs the full acceptance verification", () => {
    const quiet = fanOf(listPlan, listTask, line, 2, { siblings })
    expect(quiet).toContain("Do not re-read what you already read")
    expect(quiet).not.toContain("Since the split")
    expect(quiet).toContain("not the full suite")
    expect(quiet).not.toContain("This is the last stream")
    const changed = fanOf(listPlan, listTask, line, 2, { siblings, changed: ["src/schema.ts", "test/schema.test.ts"], last: true })
    expect(changed).toContain("Since the split, the streams that ran before this one changed these files")
    expect(changed).toContain("- src/schema.ts\n- test/schema.test.ts")
    expect(changed).not.toContain("Do not re-read what you already read")
    expect(changed).toContain("This is the last stream: once it is done, run the task's full acceptance verification once")
    // An empty list reads as none.
    expect(fanOf(listPlan, listTask, line, 2, { siblings, changed: [] })).toBe(quiet)
  })

  test("budget carries the stream's handover protocol; the test handover names the stream's own document", () => {
    const text = fanOf(listPlan, listTask, line, 2, { siblings, budget: true, testByDriver: true, handoverTest: true })
    expect(text).toContain("the prefix it inherited counts")
    expect(text).toContain("write docs/T-004/handoff.md (overwriting it) for this stream alone")
    expect(text).toContain("`Status: continue` (stream incomplete) or `Status: done` (stream fully done)")
    expect(text).toContain("this stream's document is docs/T-004/S02/testhandoff.md")
    const plain = fanOf(listPlan, listTask, line, 2, { siblings })
    expect(plain).not.toContain("Status: continue")
    expect(plain).not.toContain("testhandoff")
  })

  test("the cold delta a stream lane gets (plans/0068 S5/D19): the task block, the scope file, the per-stream handoff — and no fork wording", () => {
    const cold = fanOf(listPlan, listTask, line, 2, {
      siblings,
      changed: ["src/schema.ts"],
      budget: true,
      cold: true,
      scope: "Depends: S01\nTouches: src/exec.ts\n\n## Scope\n\nwrite the execution logic\n\n## Artifacts\n\n- src/exec.ts\n",
      handoff: "docs/T-004/S02/handoff.md",
    })
    // The cold opening: a fresh lane session, not a fork of the lead.
    expect(cold).toStartWith("[DRIVER] Your split was taken")
    expect(cold).toContain("a fresh session that forks nothing")
    expect(cold).toContain("it runs stream T-004.S02, nothing else")
    expect(cold).not.toContain("each in a fork of you")
    // The task and the stream's own scope file ride in full — the session
    // inherited nothing.
    expect(cold).toContain("The task (its document is docs/T-004/todo.md):")
    expect(cold).toContain("Whole-task description.")
    expect(cold).toContain("Your stream's scope file (docs/T-004/S02/todo.md) in full:")
    expect(cold).toContain("## Scope\n\nwrite the execution logic")
    // The handover protocol names the per-stream document, and the budget
    // sentence drops the inherited-prefix clause.
    expect(cold).toContain("write docs/T-004/S02/handoff.md (overwriting it) for this stream alone")
    expect(cold).not.toContain("the prefix it inherited counts")
    // A fresh session carries the question rule the fork inherited.
    expect(cold).toContain("question tool")
    // The shared delta parts stay: the item, the siblings, the changed files.
    expect(cold).toContain(`- [ ] ${line}`)
    expect(cold).toContain("- S01 write the schema part (done)")
    expect(cold).toContain("- src/schema.ts")
  })

  test("the cold delta without changed files tells a fresh session to read what it needs, not to skip re-reading", () => {
    const quiet = fanOf(listPlan, listTask, line, 2, { siblings, cold: true, scope: "" })
    expect(quiet).toContain("read what this stream needs fresh")
    expect(quiet).not.toContain("Do not re-read what you already read")
    expect(quiet).not.toContain("Since the split")
  })

  test("the full subtask prompt carries the context-budget protocol only with budget; without it the prompt is unchanged", () => {
    const text = subOf(listPlan, listTask, "write the execution logic", { index: 2, budget: true })
    expect(text).toContain("Context-budget protocol (this session manages its own context)")
    expect(text).toContain("write into docs/T-004/handoff.md (overwriting it) what a brand-new session continuing this subtask from that file alone needs")
    expect(text).toContain("`Status: continue` (subtask incomplete) or `Status: done` (subtask fully done)")
    const plain = subOf(listPlan, listTask, "write the execution logic", { index: 2 })
    expect(plain).not.toContain("Context-budget protocol")
    expect(subOf(listPlan, listTask, "write the execution logic", { index: 2, budget: false })).toBe(plain)
  })
})

describe("Test execution protocol (--test-by-driver)", () => {
  const run: TestRunInfo = {
    seq: 3,
    script: "/tmp/pkg/test/build.sh",
    code: 1,
    ms: 1234,
    timedOut: false,
    out: "/tmp/pkg/tmp/test.3.out",
  }

  test("testHandoffFile paths are named separately from the ondemand handoff; subtask-level directories (two-digit zero-padded)", () => {
    expect(testHandoffFile(task)).toBe("docs/T-002/testhandoff.md")
    expect(testHandoffFile(task)).not.toBe("docs/T-002/handoff.md")
    expect(testHandoffFile(task, 2)).toBe("docs/T-002/S02/testhandoff.md")
    expect(testHandoffFile(task, 12)).toBe("docs/T-002/S12/testhandoff.md")
    expect(testHandoffFile(task, 123)).toBe("docs/T-002/S123/testhandoff.md")
  })

  test("result feedback: exit code / duration / script and output paths; demands judging by reading the file directly and states how to request another run", () => {
    const text = renderTestResult(facts(), run)
    expect(text).toContain("run number 3")
    expect(text).toContain("/tmp/pkg/test/build.sh")
    expect(text).toContain("Exit code: 1")
    expect(text).toContain("1234ms")
    expect(text).toContain("/tmp/pkg/tmp/test.3.out")
    expect(text).toContain("judge by reading the file directly")
    expect(text).toContain("write the same script path into tmp/test.sh once more")
    const timeout = renderTestResult(facts(), { ...run, timedOut: true, timeoutReason: "idle" })
    expect(timeout).toContain("no output throughout")
  })

  test("wrap-up + handover requirements: persist the remaining work not dependent on the test + the handover document is mandatory", () => {
    const text = renderTestWrapup(facts(), { handoffFile: "/tmp/pkg/docs/T-002/testhandoff.md" })
    // Neutral about test timing: the test runs after the handover close-out, and the session does not need to know when.
    expect(text).toContain("will be run by the DRIVER")
    expect(text).not.toContain("in parallel")
    expect(text).toContain("not dependent on this test run's result")
    // Unfinished items must travel with the handover: otherwise the new session has no way to know, treats them as done, and they are permanently missed
    expect(text).toContain("what is still unfinished in this execution scope")
    expect(text).toContain("/tmp/pkg/docs/T-002/testhandoff.md")
    expect(text).toContain("End the session as soon as the file is written")
    // The status line (interruption recovery F1): with it the DRIVER tells apart "written completely" from "a half file left behind because the DRIVER died mid-write"
    expect(text).toContain("Status: continue")
    // The test result is always judged by the next session; there is always work after the handover — the test handover has no "done" state
    // (handoff.md does: its handover is only advisory; with the work finished no handover happens naturally)
    expect(text).not.toContain("Status: done")
  })

  // Hard copy constraints (test-handover front-loading design D2): the wrap-up prompt must not let the session know "the context is running low"
  // — field evidence shows that once a session knows, it judges the remaining budget insufficient on its own and skips disk work it should
  // have finished; it also does not say "do not modify source" (in the sequential mode the wrap-up changes land in commit #2 anyway and are covered by the test).
  test("the wrap-up prompt must contain no context/limit wording, nor do the no-source-modification ban's job", () => {
    const text = renderTestWrapup(facts(), { handoffFile: "docs/T-002/testhandoff.md" })
    for (const banned of ["context", "limit", "cap", "token", "Token", "do not modify", "do not change"]) {
      expect(text).not.toContain(banned)
    }
  })

  test("continuation note: read the handover document and the latest output first; past the threshold of consecutive handovers it prompts an AUTO-FIXME review", () => {
    const plain = renderTestContinue(facts(), { handoffFile: "docs/T-002/testhandoff.md", run })
    expect(plain).toContain("docs/T-002/testhandoff.md")
    expect(plain).toContain("/tmp/pkg/tmp/test.3.out")
    expect(plain).toContain("tmp/test.sh")
    expect(plain).not.toContain("AUTO-FIXME")
    const stuck = renderTestContinue(facts(), { handoffFile: "docs/T-002/testhandoff.md", run, stuck: 11 })
    expect(stuck).toContain("has now happened 11 times in a row")
    expect(stuck).toContain("AUTO-FIXME")
    // Without run info the latest-test paragraph is omitted; it still renders
    const bare = renderTestContinue(facts(), { handoffFile: "docs/T-002/testhandoff.md" })
    expect(bare).toContain("docs/T-002/testhandoff.md")
    expect(bare).not.toContain("test.3.out")
    expect(bare).not.toMatch(/\{\{|\}\}/)
  })
})

describe("renderStuckHint (stuck-loop hint)", () => {
  const errorHit = {
    kind: "error" as const,
    tool: "edit",
    count: 3,
    level: 1,
    input: '{"filePath":"src/a.ts"}',
    detail: "String not found in file",
  }

  test("repeated same error: says it is the same error, listing the tool / arguments / error text", () => {
    const text = renderStuckHint(facts(), errorHit)
    expect(text).toContain("Loop detected")
    expect(text).toContain("edit")
    expect(text).toContain("has now failed 3 times with exactly the same error")
    expect(text).toContain("src/a.ts")
    expect(text).toContain("String not found in file")
    expect(text).toContain("Error:")
    expect(text).not.toContain("returned exactly the same result")
  })

  test("repeated same arguments, same result: worded differently, labeling the output rather than the error", () => {
    const text = renderStuckHint(facts(), { ...errorHit, kind: "repeat", tool: "read", count: 4, detail: "file contents" })
    expect(text).toContain("has now returned exactly the same result 4 times for the same arguments")
    expect(text).toContain("Output:")
    expect(text).not.toContain("with exactly the same error")
  })

  test("three-level escalation: change approach → write a diagnosis first → stop retrying and wrap up", () => {
    const first = renderStuckHint(facts(), errorHit)
    expect(first).toContain("Stop and check your premises before acting again")
    expect(first).not.toContain("AUTO-FIXME")
    const second = renderStuckHint(facts(), { ...errorHit, level: 2 })
    expect(second).toContain("This is reminder number 2")
    expect(second).toContain("which approaches you have already tried")
    expect(second).not.toContain("AUTO-FIXME")
    const third = renderStuckHint(facts(), { ...errorHit, level: 3 })
    expect(third).toContain("This is the last reminder")
    expect(third).toContain("AUTO-FIXME")
    expect(third).toContain("end this session")
    expect(third).not.toContain("Stop and check your premises before acting again")
  })

  test("empty arguments / empty output have placeholders; the render leaves no tags behind", () => {
    const text = renderStuckHint(facts(), { ...errorHit, input: "", detail: "" })
    expect(text).toContain("(no arguments)")
    expect(text).toContain("(empty)")
    expect(text).not.toMatch(/\{\{|\}\}/)
  })
})

describe("renderDryrun", () => {
  test("permission pre-check: lists out-of-grant accesses and probes each read-only; the report goes to .auto/dryrun.md", () => {
    const text = renderDryrun(facts())
    expect(text).toContain("permission pre-check")
    expect(text).toContain("opencode.json")
    expect(text).toContain("read-only probes")
    expect(text).toContain(".auto/dryrun.md")
    expect(text).toContain("do not modify any implementation code")
  })
})

describe("intent externalization, understand/wrap-up/knowledge family (M2.1)", () => {
  const stuck = { kind: "repeat" as const, tool: "bash", count: 3, level: 2, input: "ls", detail: "x" }
  const driverResolve = resolveItem("strategy A or B?")

  function withPack(text: string, fn: () => void) {
    const dir = mkdtempSync(join(tmpdir(), "auto-intent-"))
    try {
      const overlay = join(dir, ".opencode", "auto", "intents")
      mkdirSync(overlay, { recursive: true })
      writeFileSync(join(overlay, "default.md"), text)
      factsDir = dir
      fn()
    } finally {
      factsDir = undefined
      rmSync(dir, { recursive: true, force: true })
    }
  }

  test("built-in pack: every moved segment reaches its session", () => {
    expect(decOf(plan, task)).toContain("in four sections:")
    const wrapup = wrapOf(plan, task, { resolves: [driverResolve] })
    expect(wrapup).toContain("an indexed report")
    expect(wrapup).toContain("Every item above must appear; also list any other proxy decisions you identified on your own")
    expect(wrapOf(plan, task, { solo: true })).toContain("a summary of the output (what changed, key decisions and open items),\n   so that later sessions")
    expect(renderKnowledge(facts(), { file: "kb.md" })).toContain("## Quality constraints (hard requirements)\n\n1. Final state first")
    expect(renderPriorKnowledge(facts(), { file: "kb.md" })).toContain("deduplicate across documents")
    expect(renderStuckHint(facts(), stuck)).toContain("still going in circles. Write these three things out")
    expect(renderStuckHint(facts(), { ...stuck, level: 1 })).not.toContain("Write these three things out")
    // The AGENTS.md block carries no maintenance rules any more (plans/0054 D2).
    expect(renderAgentsBlock()).not.toContain("maintenance rules")
  })

  test("the AGENTS.md block's reference paragraphs promise no checking (the reference checker is retired)", () => {
    const block = renderAgentsBlock()
    // Paragraph 2: the @<sha> version marker is described without the retired
    // line-number-exemption clause.
    expect(block).toContain("meaning that range is valid only for that historical revision)")
    expect(block).not.toContain("exempt from line-number checking")
    // Paragraph 3: the DRIVER neither checks nor rewrites references; the
    // retired subcommand and the exemption markers are not named.
    expect(block).toContain(
      "3. Checking: DRIVER neither checks nor rewrites references. Confirm that a path exists before you write it, and keep the references your task touches valid — that is part of the task's own work and of its acceptance.",
    )
    expect(block).not.toContain("full scan of all live documents")
    expect(block).not.toContain("deleted/archived/historical")
    // The wrap-up report no longer restates the conventions (0072 U-B/T-131,
    // K10): the instruction points at the AGENTS.md block, whose paragraph 3
    // (pinned above) carries the no-checking statement alone.
    for (const text of [wrapOf(plan, task), wrapOf(plan, task, { solo: true, resolves: [driverResolve] })]) {
      expect(text).toContain("follows the directory's reference conventions as the AGENTS.md block states them")
      expect(text).not.toContain("DRIVER does not check references afterwards")
      expect(text).not.toContain("DRIVER's reference check")
      expect(text).not.toContain("carry a marker yourself")
    }
  })

  test("zero-intent baseline: an empty pack drops each segment cleanly, core protocol stays", () => {
    withPack("# default\n", () => {
      const decompose = decOf(plan, task)
      expect(decompose).not.toContain("four sections")
      expect(decompose).toContain("docs/T-002/context.md\n   Keep it compact")
      const wrapup = wrapOf(plan, task, { resolves: [driverResolve] })
      expect(wrapup).not.toContain("an indexed report")
      expect(wrapup).toContain("docs/T-002/report.md: so that later sessions")
      expect(wrapup).toContain("Every item above must appear.")
      expect(wrapOf(plan, task, { solo: true })).toContain("report.md:\n   so that later sessions")
      const knowledge = renderKnowledge(facts(), { file: "kb.md" })
      expect(knowledge).not.toContain("Quality constraints")
      expect(knowledge).toMatch(/`>\n\n## Steps/)
      expect(renderPriorKnowledge(facts(), { file: "kb.md" })).not.toContain("Quality constraints")
      const hint = renderStuckHint(facts(), stuck)
      expect(hint).toContain("still going in circles.\n")
      expect(hint).not.toContain("Write these three things out")
      const block = renderAgentsBlock()
      expect(block).not.toContain("maintenance rules")
      expect(block).toContain("Summary principle")
      // question-rule falls back to the core minimum: protocol + marker formats
      const subtask = subOf(plan, task, "write the schema part of the migration script")
      expect(subtask).not.toContain("The call should have been the user's")
      expect(subtask).toContain("AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)")
      for (const text of [decompose, wrapup, knowledge, hint, subtask]) expect(text).not.toMatch(/\{\{|\}\}/)
    })
  })

  test("a project pack replaces the governance catalog; marker formats stay core-owned", () => {
    withPack(
      "# default\n\n## governance\n\n### decisions-unattended\n\n   CUSTOM-CATALOG: mark user-owned calls with {{resolveFormat}}.\n\n### agents-maintenance\n\nCUSTOM-MAINT\n",
      () => {
        const subtask = subOf(plan, task, "write the schema part of the migration script")
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
      factsDir = dir
      fn()
    } finally {
      factsDir = undefined
      rmSync(dir, { recursive: true, force: true })
    }
  }

  test("built-in pack: the P1 discipline reaches subtask and whole sessions; test-wrapup keeps its wording", () => {
    for (const text of [subOf(plan, task, "write the schema part of the migration script"), wholeOf(plan, task)]) {
      expect(text).toContain("Process documents are the DRIVER's record of this long-running work")
      expect(text).toContain("each line must carry its own question, decision and reason and never point at a process document")
    }
    const wrap = renderTestWrapup(facts(), { handoffFile: "docs/T-002/testhandoff.md" })
    expect(wrap).toContain("(code, documents, artifacts) — do not omit any of it because a handover is due")
    expect(wrap).toContain("handover notes. This is not a loophole for omitting work — what step 1 says to finish must still be finished; remaining work that you do not list here")
  })

  test("zero-intent baseline: the discipline drops out, the handover protocol stays", () => {
    withPack("# default\n", () => {
      expect(subOf(plan, task, "write the schema part of the migration script")).not.toContain("Process documents are")
      expect(wholeOf(plan, task)).not.toContain("Process documents are")
      const wrap = renderTestWrapup(facts(), { handoffFile: "docs/T-002/testhandoff.md" })
      expect(wrap).toContain("(code, documents, artifacts);\n")
      expect(wrap).toContain("handover notes. Remaining work that you do not list here")
      expect(wrap).not.toContain("loophole")
      expect(wrap).toContain("docs/T-002/testhandoff.md")
      expect(wrap).toContain("Status: continue")
      expect(wrap).not.toMatch(/\{\{|\}\}/)
    })
  })
})
