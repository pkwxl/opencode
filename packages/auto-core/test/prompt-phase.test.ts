// Unit tests for the phase-family renders of src/prompt.ts + src/prompt-plan.ts: phase planning / phase handover / knowledge extraction / number recovery / m-mode planning.
// Split out of test/prompt.test.ts (plans/0024-module-split-plan.md S19, pure move).

import { describe, expect, test } from "bun:test"
import { renderKnowledge, renderNumberRecovery, renderPhaseHandover, renderPriorKnowledge } from "../src/prompt"
import { existingTaskList, renderImplementPlan, renderPhaseAppend, renderPhasePlan } from "../src/prompt-plan"
import { promptFacts } from "../src/prompt-facts"
import { usePromptLibrary, renderText } from "../src/template"
import { migrate, plan } from "./fixtures/prompt"
import { parsePhaseTypeFile } from "../src/phases/custom"
import { phaseTypeOfLetter as L, planDutiesPartial, type PhaseTypeEntry } from "../src/phases/registry"

// E2 render inputs: every render takes the facts (default globals), and the
// planning renders take their phase's duty paragraph pre-rendered (the
// registry's own data through the active library — loop-plan's helper,
// replicated for the fixture).
const facts = promptFacts()
const duties = (entry: PhaseTypeEntry) => renderText(entry.planDuties ?? `{{> ${planDutiesPartial(entry)}}}`, {}).trimEnd()

// The unit coordinates every planning render needs (M3.4); tests vary the rest.
const phasePlan = (input: Omit<Parameters<typeof renderPhasePlan>[1], "phaseId" | "taskIndex" | "planDuties"> & { phase: PhaseTypeEntry }) =>
  renderPhasePlan(facts, { phaseId: "R-01.P02", taskIndex: "docs/R-01/P02-implement/tasks.md", planDuties: duties(input.phase), ...input })
const implementPlan = (input: Omit<Parameters<typeof renderImplementPlan>[1], "phaseId" | "taskIndex">) =>
  renderImplementPlan(facts, { phaseId: "R-01.P01", taskIndex: "docs/R-01/P01-implement/tasks.md", ...input })

describe("renderPhasePlan (phase planning session, section E)", () => {
  test("injects brief / the mode preamble and the task-unit format protocol; writes only the task index and task documents", () => {
    const text = phasePlan({
      phase: L("a"),
      brief: "migrate legacy to bun",
      mode: migrate,
    })
    expect(text).toContain("\"Analysis\" phase (a)")
    expect(text).toContain("migrate legacy to bun")
    expect(text).toContain("scenario-mode preamble (migrate)")
    // a-phase duties (task-anchored document placement) and the first-batch survey requirements
    expect(text).toContain("Document placement is anchored to tasks")
    expect(text).toContain("behaviour baseline")
    expect(text).toContain("first batch of tasks")
    // Task-unit format protocol (protocol-sensitive markers, M3.4): task-document title line, Phase field, three sections and index lines
    for (const marker of ["# T-NNN: <task title>", "Phase: R-01.P02", "## Goal", "## Scope", "## Acceptance", "- [ ] T-NNN <task title>", "<!-- auto: eof -->"]) {
      expect(text).toContain(marker)
    }
    expect(text).not.toContain("- verify:")
    expect(text).not.toContain("PLAN.md")
    // This session writes only the task index and task documents (0072
    // U-B/T-131 slimmed the constraint to the role-scoped write list: the
    // state-file, chmod and commit restatements are the constitution's — the
    // contract and the AGENTS.md block carry them, the prompt no longer does)
    expect(text).toContain("This session writes only the task index docs/R-01/P02-implement/tasks.md and each task's docs/T-NNN/todo.md — never done.md")
    expect(text).toContain("every other file, and every state file, is outside this session's write scope")
    expect(text).not.toContain("CURRENT.md")
    expect(text).not.toContain("chmod")
    expect(text).not.toContain("git commit")
    expect(text).toContain("AUTO-DECISION")
    expect(text).not.toContain("final-review reminder")
  })

  test("brief missing → the not-provided paragraph; per-phase duties inject conditionally (task anchoring; k is the permanent-path knowledge document)", () => {
    const missing = phasePlan({ phase: L("d") })
    expect(missing).toContain("Not provided (brief.md missing or empty)")
    expect(missing).toContain("module design")
    expect(missing).not.toContain("behaviour baseline")
    expect(phasePlan({ phase: L("m") })).toContain("code migration and rework")
    expect(phasePlan({ phase: L("t") })).toContain("regression coverage")
    expect(phasePlan({ phase: L("v") })).toContain("overall acceptance")
    expect(phasePlan({ phase: L("k") })).toContain("docs/R-NN/P<nn>-knowledge/kb.md")
  })

  test("planning input (plans/0053 D11): its block follows the round brief and precedes the mode preamble; absent or blank, nothing renders", () => {
    const inputPath = "docs/R-01/P02-implement/plan-input.md"
    const text = phasePlan({ phase: L("m"), round: "Goal: ship the parser.", input: "Port the lexer first.\n", inputPath, mode: migrate })
    expect(text).toContain(`## Input: planning input (${inputPath})\n\nThe person who started this planning step asked for the following.`)
    expect(text).toContain("within\nthe phase duties below.\n\nPort the lexer first.\n\n## Input: scenario-mode preamble (migrate)")
    expect(text.indexOf("## Input: round brief")).toBeLessThan(text.indexOf("## Input: planning input"))
    expect(text.indexOf("## Input: planning input")).toBeLessThan(text.indexOf("## Phase duties"))
    for (const input of [undefined, " \n"]) {
      expect(phasePlan({ phase: L("m"), input, inputPath })).not.toContain("planning input")
    }
  })

  test("handovers two states: with prior handovers the list is injected (naming the permanent handover.md path inside the phase directory); without them the whole block disappears", () => {
    const text = phasePlan({
      phase: L("m"),
      handovers: "### P01-analysis Analysis (docs/R-01/P01-analysis/handover.md)\n\n- Decision A: chose X",
    })
    expect(text).toContain("prior-phase handovers")
    expect(text).toContain("sole channel")
    expect(text).toContain("P<nn>-<type>/handover.md")
    expect(text).toContain("### P01-analysis Analysis (docs/R-01/P01-analysis/handover.md)")
    expect(text).toContain("- Decision A: chose X")
    // First phase has no prior handovers: the handover block disappears entirely
    expect(phasePlan({ phase: L("a") })).not.toContain("prior-phase handovers")
  })

  test("prevRound two states: the continuation-round conclusions block appears / disappears (only the first planning session of a new round receives it from the loop)", () => {
    const text = phasePlan({
      phase: L("a"),
      prevRound: "### Previous round (round 1) phase directory index (docs/R-01/)\n\n- docs/R-01/P01-implement/",
    })
    expect(text).toContain("prior-round migration conclusions (continuation round)")
    expect(text).toContain("fuller agreement")
    expect(text).toContain("do not redo finished work")
    expect(text).toContain("permanent path")
    expect(text).toContain("- docs/R-01/P01-implement/")
    // Not a continuation round (no prevRound): the conclusions block disappears entirely
    expect(phasePlan({ phase: L("a") })).not.toContain("prior-round migration conclusions")
  })

  test("m phase injects the pipeline-trimming note via trimmedPhases (--phases trimming → the survey-design work merges into the first batch of tasks, the safety-net floor is not skipped); the default and the other phases lack it", () => {
    const m = phasePlan({ phase: L("m"), trimmedPhases: true })
    expect(m).toContain("Pipeline-trimming note")
    expect(m).toContain("trimmed via --phases")
    expect(m).toContain("first batch of tasks")
    expect(m).toContain("baseline-safety-net items")
    // The default (full pipeline) does not inject; non-m phases do not inject even when passed (the gate is inside the function)
    expect(phasePlan({ phase: L("m") })).not.toContain("Pipeline-trimming note")
    expect(phasePlan({ phase: L("a"), trimmedPhases: true })).not.toContain("Pipeline-trimming note")
  })

  test("migration parameters are retired (plans/0052 D2): no parameter sections, and the missing-brief note does not mention them", () => {
    const bare = phasePlan({ phase: L("m") })
    expect(bare).not.toContain("migration-source")
    expect(bare).not.toContain("migration-target")
    expect(bare).toContain("Not provided (brief.md missing or empty). Proceed by the phase duties")
  })

  test("no verify field or acceptance-execution-right wording (verify retired, m phase)", () => {
    const text = phasePlan({ phase: L("m") })
    expect(text).not.toContain("verify")
    expect(text).not.toContain("验收")
  })

  test("numberStart two states: the auto-numbering start is injected / the default starts from T-001", () => {
    const text = phasePlan({ phase: L("m"), numberStart: 4 })
    expect(text).toContain("Task numbers increment continuously from T-004")
    expect(text).toContain("must not be reused")
    expect(text).not.toContain("Task numbers increment continuously from T-001")
    // Auto numbering off (default): the historical wording stays
    const bare = phasePlan({ phase: L("m") })
    expect(bare).toContain("Task numbers increment continuously from T-001")
    expect(bare).not.toContain("must not reuse")
  })

  test("representative parameter combinations render with no leftover template tags", () => {
    for (const text of [
      phasePlan({ phase: L("a") }),
      phasePlan({ phase: L("m"), brief: "intent", handovers: "### a Analysis (x)\n\n- decision", mode: migrate, numberStart: 12 }),
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
    expect(renderPhaseHandover(facts, { phase: custom, handover: "docs/R-01/P02-security-review/handover.md" })).toContain("Security review")
  })
})

describe("renderImplementPlan (m-mode planning, plans/0053 D12)", () => {
  test("file given: rendered as the \"plan file\", injecting the path and full text; the task format protocol and authorization wording match phase-plan", () => {
    // planPhase passes the phase's persisted planning input as the file (D11).
    const text = implementPlan({ file: "docs/R-01/P01-implement/plan-input.md", content: "Do A first, then B" })
    expect(text).toContain("## Input: plan file (docs/R-01/P01-implement/plan-input.md)")
    expect(text).toContain("Do A first, then B")
    expect(text).not.toContain("## Input: implementation prompt")
    expect(text).toContain("# T-NNN: <task title>")
    expect(text).toContain("Phase: R-01.P01")
    expect(text).toContain("docs/R-01/P01-implement/tasks.md")
    expect(text).toContain("Task numbers increment continuously from T-001")
    expect(text).not.toContain("- verify:")
    expect(text).not.toContain("PLAN.md")
    // 0072 U-B/T-131: the chmod / commit restatements folded out of the
    // planner prompts (the contract and the block own them)
    expect(text).toContain("every other file, and every state file, is outside this session's write scope")
    expect(text).not.toContain("chmod")
    expect(text).toContain("AUTO-DECISION")
  })

  test("file not given: the same content renders as the \"implementation prompt\"", () => {
    const text = implementPlan({ content: "implement a login page" })
    expect(text).toContain("## Input: implementation prompt")
    expect(text).toContain("implement a login page")
    expect(text).not.toContain("## Input: plan file")
  })

  test("brief two states: given, the project-intent paragraph is injected; missing/blank, the whole block disappears", () => {
    const withBrief = implementPlan({ content: "x", brief: "migrate legacy to bun" })
    expect(withBrief).toContain("## Input: project intent (.opencode/auto/brief.md)")
    expect(withBrief).toContain("migrate legacy to bun")
    expect(implementPlan({ content: "x" })).not.toContain("## Input: project intent")
    expect(implementPlan({ content: "x", brief: "   " })).not.toContain("## Input: project intent")
  })

  test("no verify field or acceptance-execution-right wording (verify retired)", () => {
    const text = implementPlan({ content: "x" })
    expect(text).not.toContain("verify")
    expect(text).not.toContain("验收")
  })

  test("representative parameter combinations render with no leftover template tags", () => {
    for (const text of [
      implementPlan({ content: "the prompt" }),
      implementPlan({ file: "docs/rough.md", content: "the full plan text", brief: "intent" }),
    ]) {
      expect(text).not.toMatch(/\{\{|\}\}/)
    }
  })
})

describe("existingTaskList / renderPhaseAppend (append planning session, 0053 D23/D27)", () => {
  const phaseAppend = (input: Omit<Parameters<typeof renderPhaseAppend>[1], "phaseId" | "taskIndex" | "input" | "inputPath" | "existingTasks" | "planDuties"> & { phase?: PhaseTypeEntry }) =>
    renderPhaseAppend(facts, {
      planDuties: input.phase ? duties(input.phase) : undefined,
      phaseId: "R-01.P02",
      taskIndex: "docs/R-01/P02-implement/tasks.md",
      input: "Fill in the lexical fallback first.",
      inputPath: "docs/R-01/P02-implement/plan-input.md",
      existingTasks: "- [done] T-004: migrate the parser\n- [pending] T-005: wire up the pipeline",
      ...input,
    })

  test("existingTaskList: one line per task with a status label; closed carries its reason (0053 D27/D16 wording)", () => {
    expect(
      existingTaskList([
        { id: "T-004", title: "migrate the parser", status: "done" },
        { id: "T-005", title: "wire up the pipeline", status: "pending" },
        { id: "T-006", title: "fix the cache", status: "blocked" },
        { id: "T-007", title: "the old approach", status: "done", closed: "superseded by T-009" },
      ]),
    ).toBe(
      "- [done] T-004: migrate the parser\n" +
        "- [pending] T-005: wire up the pipeline\n" +
        "- [blocked] T-006: fix the cache\n" +
        "- [closed] T-007: the old approach (closed without completing: superseded by T-009)",
    )
  })

  test("phased: phase signature / existing-task list / planning input / duties paragraph and task-unit format protocol all present", () => {
    const text = phaseAppend({
      phase: L("m"),
      brief: "migrate legacy to bun",
      handovers: "### P01-analysis Analysis (docs/R-01/P01-analysis/handover.md)\n\n- Decision A: chose X",
      mode: migrate,
      numberStart: 6,
    })
    expect(text).toContain("\"Implementation\" phase (m)")
    expect(text).toContain("this phase's tasks are already planned")
    // The existing-task list (the anchor of the append contract) and the append discipline
    expect(text).toContain("## Input: the task index as it stands (docs/R-01/P02-implement/tasks.md)")
    expect(text).toContain("- [done] T-004: migrate the parser")
    expect(text).toContain("appended after them, never before or between them")
    // The planning input is a mandatory block (0053 D23: --append with no input is a usage error)
    expect(text).toContain("## Input: planning input (docs/R-01/P02-implement/plan-input.md)")
    expect(text).toContain("Fill in the lexical fallback first.")
    expect(text).toContain("scenario-mode preamble (migrate)")
    expect(text).toContain("prior-phase handovers")
    expect(text).toContain("code migration and rework")
    // Task-unit format protocol (tier-1 markers) and the append wording
    for (const marker of ["# T-NNN: <task title>", "Phase: R-01.P02", "## Goal", "## Scope", "## Acceptance", "- [ ] T-NNN <task title>", "<!-- auto: eof -->"]) {
      expect(text).toContain(marker)
    }
    expect(text).toContain("appended after the last existing line")
    expect(text).toContain("Task numbers increment continuously from T-006")
    expect(text).toContain("never edit, reorder or renumber an existing index line")
    // Depends seam guidance: default Depends = the line above; the first new task depends on the last existing task by default
    expect(text).toContain("the first new task")
    expect(text).toContain("without the field depends on the last existing task")
    expect(text).toContain("write `Depends:` explicitly")
    expect(text).toContain("The append must add at least one new task")
    expect(text).toContain("AUTO-DECISION")
  })

  test("m mode: no phase signature / duties / round handover, implement-plan tone; the mandatory slots remain", () => {
    const text = renderPhaseAppend(facts, {
      phaseId: "R-01.P01",
      taskIndex: "docs/R-01/P01-implement/tasks.md",
      input: "Migrate one more module.",
      inputPath: "docs/R-01/P01-implement/plan-input.md",
      existingTasks: "- [done] T-001: scaffolding",
      numberStart: 2,
    })
    expect(text).toContain("You are the planner for this implementation plan")
    expect(text).toContain("- [done] T-001: scaffolding")
    expect(text).toContain("Migrate one more module.")
    expect(text).toContain("Task numbers increment continuously from T-002")
    // m mode has no duties paragraph (same as implement-plan): no phase signature or duties wording; the round/handover blocks do not render
    expect(text).not.toContain("\"Implementation\" phase")
    expect(text).not.toContain("Phase duties and artifact conventions")
    expect(text).not.toContain("prior-phase handovers")
    expect(text).not.toContain("round brief")
    for (const marker of ["# T-NNN: <task title>", "Phase: R-01.P01", "- [ ] T-NNN <task title>", "<!-- auto: eof -->"]) {
      expect(text).toContain(marker)
    }
  })

  test("representative parameter combinations render with no leftover template tags", () => {
    for (const text of [
      phaseAppend({ phase: L("a"), numberStart: 12 }),
      phaseAppend({ phase: L("m"), brief: "intent", handovers: "### a Analysis (x)\n\n- decision", mode: migrate, parallel: "high" }),
      renderPhaseAppend(facts, {
        phaseId: "R-01.P01",
        taskIndex: "docs/R-01/P01-implement/tasks.md",
        input: "x",
        inputPath: "docs/R-01/P01-implement/plan-input.md",
        existingTasks: "- [pending] T-001: A",
        parallel: "medium",
      }),
    ]) {
      expect(text).not.toMatch(/\{\{|\}\}/)
    }
  })
})

describe("renderNumberRecovery (number recovery session)", () => {
  test("injects the floor and the evidence checklist; the hard output protocol points at .auto/next-task", () => {
    // The template library may have been overridden by another case in the same process; reset to built-ins only
    usePromptLibrary(undefined)
    const text = renderNumberRecovery(facts, { floor: 5 })
    // Protocol-sensitive markers: what the DRIVER parses out of the session's output
    expect(text).toContain(".auto/next-task")
    // The floor is injected (raw and zero-padded forms)
    expect(text).toContain("= 5")
    expect(text).toContain("T-005")
    expect(text).toContain("must not be smaller than this")
    // The evidence checklist covers git history (to find numbers whose artifacts were deleted) and every phase's task index
    expect(text).toContain("git log --oneline")
    expect(text).toContain("tasks.md")
    expect(text).not.toContain("PLAN")
    // Hard output protocol: the content is only a positive integer not smaller than the floor
    expect(text).toContain("positive integer")
    expect(text).toContain("write nothing else")
    expect(text).toContain("only file this session may write is .auto/next-task")
    expect(text).not.toMatch(/\{\{|\}\}/)
  })
})

describe("renderPhaseHandover (phase handover distillation session, F.1)", () => {
  test("injects the phase / the handover permanent path / the four-section protocol and the only-writable-file constraint", () => {
    const text = renderPhaseHandover(facts, { phase: L("a"), handover: "docs/R-01/P01-analysis/handover.md", next: "m Implementation" })
    expect(text).toContain("\"Analysis\" phase (a)")
    expect(text).toContain("handover distiller")
    expect(text).toContain("docs/R-01/P01-analysis/handover.md")
    for (const section of ["## Key decisions", "## Constraints and pitfalls", "## Required reading for the next phase", "## Artifact index"]) {
      expect(text).toContain(section)
    }
    expect(text).toContain("The next phase is \"m Implementation\"")
    expect(text).toContain("only file this session may write is docs/R-01/P01-analysis/handover.md")
    expect(text).toContain("Distill only")
    expect(text).toContain("do not modify any")
    expect(text).toContain("AUTO-DECISION")
    // 0072 U-B/T-131: the state-file / commit restatements folded out; the
    // write-scope line carries the constraint alone
    expect(text).toContain("every other file, and every state file, is outside this session's write scope")
    expect(text).not.toContain("git commit")
  })

  test("k phase with no next phase: for-later-reference wording; still demands the four sections", () => {
    const text = renderPhaseHandover(facts, { phase: L("k"), handover: "docs/R-01/P03-knowledge/handover.md" })
    expect(text).toContain("no next phase")
    expect(text).toContain("later rounds and")
    for (const section of ["## Key decisions", "## Constraints and pitfalls", "## Required reading for the next phase", "## Artifact index"]) {
      expect(text).toContain(section)
    }
    // Fallback wording for phases without a task list (k): no task index is expected; distillation goes by this phase's kb.md artifacts
    expect(text).toContain("no task index tasks.md — that is\nexpected")
    expect(text).not.toContain("CURRENT.md")
    expect(text).toContain("this phase directory's kb.md")
    expect(text).toContain("skip")
    // With a next phase there is no close-out wording
    const withNext = renderPhaseHandover(facts, { phase: L("a"), handover: "docs/R-01/P01-analysis/handover.md", next: "m Implementation" })
    expect(withNext).not.toContain("no next phase")
    expect(withNext).not.toContain("kb.md")
  })

  test("no verified field wording (verify retired)", () => {
    expect(renderPhaseHandover(facts, { phase: L("m"), handover: "docs/R-01/P02-implement/handover.md" })).not.toContain("verified")
  })

  test("representative parameter combinations render with no leftover template tags", () => {
    for (const text of [
      renderPhaseHandover(facts, { phase: L("a"), handover: "docs/R-01/P01-analysis/handover.md", next: "m Implementation" }),
      renderPhaseHandover(facts, { phase: L("k"), handover: "docs/R-01/P03-knowledge/handover.md" }),
      renderPhaseHandover(facts, {
        phase: L("m"),
        handover: "phase/handover.md",
        closedTasks: [{ id: "T-006", title: "Port the parser", reason: "superseded" }],
      }),
    ]) {
      expect(text).not.toMatch(/\{\{|\}\}/)
    }
  })

  test("closed tasks (plans/0053 D16): listed with reasons, recorded as not delivered", () => {
    const base = { phase: L("m"), handover: "phase/handover.md", next: "P03-test Testing" }
    const text = renderPhaseHandover(facts, {
      ...base,
      closedTasks: [
        { id: "T-006", title: "Port the parser", reason: "superseded by T-007" },
        { id: "T-008", title: "Tune the cache", reason: "out of scope" },
      ],
    })
    expect(text).toContain(
      "## Closed tasks\n\n" +
        "These tasks of this phase were closed without completing: they count as done for scheduling, but their deliverables\n",
    )
    expect(text).toContain(
      "- T-006: Port the parser (closed without completing: superseded by T-007)\n" +
        "- T-008: Tune the cache (closed without completing: out of scope)\n\n## Artifact\n",
    )
    expect(text).toContain('Record each one in "Key decisions" as not delivered, with its reason')
    expect(text).toContain("do not present its\ndeliverables as available")
    // The block sits between the input list and the artifact protocol; the four mandatory sections stay.
    expect(text.indexOf("## Input (read-only)")).toBeLessThan(text.indexOf("## Closed tasks"))
    expect(text.indexOf("## Closed tasks")).toBeLessThan(text.indexOf("## Artifact\n"))
    for (const section of ["## Key decisions", "## Constraints and pitfalls", "## Required reading for the next phase", "## Artifact index"]) {
      expect(text).toContain(section)
    }

    // No closures (key absent or empty list): nothing renders, byte-identical to the render without the key.
    const plain = renderPhaseHandover(facts, base)
    expect(plain).not.toContain("## Closed tasks")
    expect(plain).not.toContain("closed without completing")
    expect(plain).toContain("phases.md).\n\n## Artifact\n")
    expect(renderPhaseHandover(facts, { ...base, closedTasks: [] })).toBe(plain)
    expect(renderPhaseHandover(facts, { ...base, closedTasks: undefined })).toBe(plain)
  })
})

describe("renderKnowledge (k-phase knowledge extraction session, P4 claims --extract-knowledge)", () => {
  const FILE = "docs/R-01/P03-knowledge/kb.md"

  test("injects the output path, source list and section skeleton; read-only analysis, the only writable file is the output path", () => {
    const text = renderKnowledge(facts, { file: FILE })
    expect(text).toContain(FILE)
    // Source pointers (the phase index inside this round's directory and each phase directory's handover document; the phase directories also hold the PLAN snapshot)
    expect(text).toContain("docs/R-NN/phases.md")
    expect(text).toContain("docs/R-NN/P<nn>-<type>/handover.md")
    expect(text).toContain("docs/R-NN/P<nn>-<type>/")
    expect(text).toContain("git log")
    // Section skeleton (this repository's take on spec §13; Design Deviations instead sources AUTO-DECISION)
    for (const section of ["## Migration summary", "## API and type mapping", "## Implementation patterns", "## Pitfalls and edge cases", "## Reusable rules", "## Design deviations and key decisions", "## Verification evidence", "## References"]) {
      expect(text).toContain(section)
    }
    expect(text).toContain("AUTO-DECISION")
    // Quality constraints (spec §14)
    expect(text).toContain("Final state first")
    expect(text).toContain("Deduplicate")
    expect(text).toContain("Do not copy session dialogue")
    expect(text).toContain("verifiable anchor")
    expect(text).toContain('labelled "rejected"')
    expect(text).toContain("the only file you may write this time is " + FILE)
    // 0072 U-B/T-131: the state-rule restatement (state files / commits)
    // retired from the prompt; the AGENTS.md block owns both wordings
    expect(text).not.toContain("maintained by the DRIVER")
    expect(text).not.toContain("git commit")
    expect(text).toContain("Distil only")
  })

  test("injects the mode.exec scenario background; without a mode the whole block disappears", () => {
    const text = renderKnowledge(facts, { file: FILE, mode: migrate })
    expect(text).toContain("Scenario mode notes (migrate)")
    expect(text).toContain("Migration/upgrade mode notes")
    expect(renderKnowledge(facts, { file: FILE })).not.toContain("Scenario mode notes")
  })

  test("renders with no leftover template tags", () => {
    for (const text of [renderKnowledge(facts, { file: FILE }), renderKnowledge(facts, { file: FILE, mode: migrate })]) {
      expect(text).not.toMatch(/\{\{|\}\}/)
    }
  })
})

describe("renderPriorKnowledge (prior knowledge extraction session)", () => {
  test("referencing two states: a non-empty distilled list injects the list and the no-restating demand; empty/default, the whole block disappears (same behavior as full distillation)", () => {
    usePromptLibrary(undefined)
    const withList = renderPriorKnowledge(facts, {
      file: "docs/prior-kb/R2-prior-x.md",
      brief: "intent",
      distilled: ["docs/R-01/P02-implement/handover.md", "docs/R-01/P03-knowledge/kb.md"],
    })
    expect(withList).toContain("## Input: existing distilled artifacts (reference, do not restate)")
    expect(withList).toContain("must not be restated in this")
    expect(withList).toContain("- docs/R-01/P02-implement/handover.md")
    expect(withList).toContain("- docs/R-01/P03-knowledge/kb.md")
    // Referencing's same constraint: already-covered knowledge points are replaced by a one-line reference instead of an excerpt
    expect(withList).toContain("a one-line reference (`see <path>: <one sentence>`)")
    const bare = renderPriorKnowledge(facts, { file: "docs/prior-kb/R1-prior-x.md" })
    expect(bare).not.toContain("## Input: existing distilled artifacts")
    expect(bare).not.toContain("must not be restated")
    expect(renderPriorKnowledge(facts, { file: "docs/prior-kb/R1-prior-x.md", distilled: [] })).not.toContain("## Input: existing distilled artifacts")
  })

  test("closing-marker protocol: the intermediate-artifact path note + a final \"DONE\" alone on its own line + never written before everything is complete", () => {
    usePromptLibrary(undefined)
    const text = renderPriorKnowledge(facts, { file: "docs/R-01/temp-kb.md" })
    expect(text).toContain("intermediate artifact path")
    expect(text).toContain("put the line `DONE` on a line of its own at the very end of the document")
    expect(text).toContain("DRIVER-parsed protocol string: write it verbatim, do not translate it")
    expect(text).toContain("never write that line before every section is complete")
    expect(text).toContain("promote the file to the official prior-knowledge document")
  })
})
