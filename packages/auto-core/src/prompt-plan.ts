// Planning-side prompts: the formulation task's single-input todo
// (renderFormulationTodo, plans/0095 — phased and m-mode planning unified as
// the phase's first task unit) and append planning (renderPhaseAppend, the
// --append half, plans/0053 D23–D27, unchanged by 0095). The former planning
// templates (phase-plan.md / implement-plan.md) retired with their renderers:
// the composed block stack became the formulation todo's Scope, assembled
// here as data. Rendering of the surviving prompt surfaces goes through
// prompt.ts's single exit (renderPrompt) and its intent-pack helpers.
// Off the driver with E2 (plans/0061 §6.3): the phase entry and the duty
// paragraph arrive as data (the caller renders the registry's duty text),
// and every render takes the PromptFacts value the caller built.
import type { ModeSpec } from "./mode"
import { dutiesForPhase } from "./intent/load"
import { guaranteeViolation, parseGuaranteeAsserts, PromptGuaranteeError } from "./intent/guarantees"
import type { ParallelLevel } from "./intent/types"
import { intentText, modeText, parallelismVars, phaseTag, renderPrompt, type PhaseEntry, type PromptFacts } from "./prompt"
import { renderText, type Ctx } from "./template"

// The phase-plan duty paragraph's resolution (plans/0080 §4): the custom
// type's own `## plan duties` first, then — the new tier — the active pack's
// `### <dutiesRef>` subsection under `## phase duties`, then the core shared
// partial `plan-duties-<dutiesRef>` (the partial name is the registry's
// planDutiesPartial rule, `plan-duties-` + dutiesRef; built inline so this
// layer keeps taking the structural entry instead of importing the phases
// domain). Only builtin types ever reach the pack tier — a custom type file
// always carries its own plan duties — so this is what lets a bundle re-voice
// the builtin design/implement/test duties without touching core partials.
// The ctx (plans/0095 D4): the planning renders used to pass an empty one,
// which rendered a pack's `{{phaseName}}` as empty parens and silently
// dropped its `{{#if testByDriver}}` line; callers now thread the two facts
// the pack texts reference, and the empty default keeps older callers whole.
export function planDutyText(facts: PromptFacts, entry: PhaseEntry, ctx: Ctx = {}): string {
  const own = entry.planDuties ?? dutiesForPhase(facts.pack, entry.dutiesRef)
  return renderText(own ?? `{{> plan-duties-${entry.dutiesRef}}}`, ctx).trimEnd()
}

// The repair round's discipline (plans/0080 §6): the active pack's `##
// governance` / `### repair` text, appended to the repair append's input —
// the boundary that keeps a repair from re-architecting (fix the named
// finding, minimal change, regression check, re-run the verification).
// Absent section ⇒ undefined and the input stays as the core composes it
// (the zero-intent floor; before 0080 the section existed with no consumer
// at all).
export function repairDutiesText(facts: PromptFacts): string | undefined {
  return intentText(facts, "governance", "repair", {})
}

// Join an optional intent paragraph onto a driver-composed input text: a
// leading blank line and a framing clause when present, nothing at all when
// absent (the zero-intent floor keeps the input byte-identical).
export function withIntentParagraph(text: string | undefined): string {
  return text === undefined ? "" : `\n\nRepair discipline (the project's intent declares it):\n${text}`
}

// The task fields the append prompt's existing-task lines read (the task
// store's Task satisfies the shape structurally).
export type ExistingTask = { id: string; title: string; status: string; closed?: string }

// The existing-task lines of the append prompt's existingTasks slot
// (plans/0053 D27): one line per task of the current index, in index order,
// labelled by its current status; a closed task (done for scheduling, not
// delivered) carries its reason. The label is session-facing prose, not a
// protocol string. An in_progress task (transient runtime state, impossible
// at an append step — a task mid-pipeline blocks the append, D26) would show
// its own label unchanged.
export function existingTaskList(tasks: readonly ExistingTask[]): string {
  return tasks
    .map((task) =>
      task.closed !== undefined
        ? `- [closed] ${task.id}: ${task.title} (closed without completing: ${task.closed})`
        : `- [${task.status}] ${task.id}: ${task.title}`,
    )
    .join("\n")
}

// Append planning (plans/0053 D23/D27): the planner that adds tasks to a
// phase whose index already lists some, rendered from the shared
// phase-append template by both modes. Phased sessions pass the phase entry
// (the phase naming) and the pre-rendered duty paragraph (as renderPhasePlan
// formerly did; an m-mode session passes neither — as implement-plan, it has
// no duties, round or handovers — so the template drops those blocks).
// input/inputPath are required (append always plans against a planning
// input: --append without input is a usage error, D23), and existingTasks is
// the pre-joined line list of the index as it stands (existingTaskList).
// numberStart is the append numbering start (from the .auto/next-task record
// under autoNumber, otherwise the highest taken or listed id + 1, D25); it
// always exists in practice, hence the single unconditional numbering clause.
// AUTO-DECISION: the mode split lives entirely in optional slots — a two-branch
// intro on {{#if phase}}, the whole duties section (placement paragraph and
// planDuties together) behind {{#if planDuties}}, no phase-plan-style
// "brief not provided" fallback, and one unconditional numbering clause instead
// of phase-plan's two branches (the append start is always computed; the
// fallback branch would name T-001 under an index that already lists it).
// The rejected alternative was two separate templates per mode, which D27
// rules out; per-block negative fallbacks were dropped because m mode must
// render the shared blocks' absence silently, as implement-plan did.
export function renderPhaseAppend(facts: PromptFacts, input: {
  phase?: PhaseEntry
  planDuties?: string
  phaseId: string
  taskIndex: string
  numberStart?: number
  input: string
  inputPath: string
  existingTasks: string
  brief?: string
  // The round brief docs/R-NN/round.md, comments stripped (plans/0049 G3).
  round?: string
  handovers?: string
  mode?: ModeSpec
  parallel?: ParallelLevel
}): string {
  const type = input.phase
  return renderPrompt(facts, "phase-append", {
    phase: type ? phaseTag(type) : undefined,
    phaseName: type?.name,
    phaseId: input.phaseId,
    taskIndex: input.taskIndex,
    // The precedence block, same subsection as the formulation todo: an
    // append plans against a human input too (plan --append, or a repair
    // round's evidence), so the authority order rides along.
    precedence: intentText(facts, "guarantees", "precedence", {}),
    numberStart: String(input.numberStart ?? 1).padStart(3, "0"),
    input: input.input.trim(),
    inputPath: input.inputPath,
    existingTasks: input.existingTasks.trim(),
    brief: input.brief?.trim() || undefined,
    round: input.round?.trim() || undefined,
    handovers: input.handovers?.trim() || undefined,
    modeName: input.mode?.name,
    modeInit: input.mode && modeText(input.mode.init),
    planDuties: input.planDuties,
    ...parallelismVars(facts, input.parallel),
  })
}

// The formulation task's single-input todo (plans/0095 D1): the deterministic
// assembly of exactly the blocks the retired phase-plan / implement-plan
// templates stacked, as the task document's three sections. The Scope is the
// whole composed planning brief — project brief, round brief + round rules,
// approved analysis (human-gated phases), planning input, mode preamble,
// precedence, prior-phase handovers, prior-round conclusions, phase duties +
// artifact conventions + report duty, parallelism — followed by the
// task-writing protocol skeleton moved verbatim from phase-plan.md; the
// formulation session (an ordinary whole-task session) reads this document
// as its only planning input, the wrapper adds the execution protocol.
// m mode (no phase entry) renders the slimmer framing: no
// round/analysis/handover/prevRound blocks, the input presented as the plan
// file, and the report duty always (the implicit round's single phase is
// final — plans/0053 D12's rule carried over). numberStart is the first
// number the session's own tasks may take (the formulation number + 1).
// charter is the Acceptance text (formulate.ts formulationAcceptance): the
// generic plan-quality core plus the resolved charters when declared — the
// wrap-up session judges it by inspection of the unit's commit range.
//
// The synthesis shape (plans/0097 D3): when `synthesis` is present — the
// constructor session ran under a declared charter and passed the mechanical
// validation — the evidential source blocks (project brief, round brief,
// analysis, handovers, prevRound) are replaced by the session's Sources
// brief and the obligation ledger (seeded rows + session rows, pre-rendered
// by formulate-synthesis), while every protocol-bearing block (planning
// input, mode preamble, authority order, duties + report duty + protocol
// line, parallelism, the format skeleton, the Constraints) stays
// driver-owned and verbatim — which is also where the assert literals live,
// so the guarantee gate keeps holding by construction. The caller catches
// the gate's throw for this shape and treats it as a retry cause (D4.3),
// never exit 2.
export function renderFormulationTodo(facts: PromptFacts, input: {
  // Absent in m mode (the implicit P01-implement still formulates, without
  // the phased-flow blocks).
  phase?: PhaseEntry
  phaseId: string
  taskIndex: string
  numberStart: number
  brief?: string
  round?: string
  analysis?: string
  input?: string
  inputPath?: string
  handovers?: string
  prevRound?: string
  mode?: ModeSpec
  trimmedPhases?: boolean
  parallel?: ParallelLevel
  finalPhase?: boolean
  reportFile?: string
  testByDriver?: boolean
  charter: string
  // The synthesis payload (plans/0097 D3): brief = the constructor's
  // re-voiced sources, ledger = the pre-rendered rows (seeded + session),
  // missing = the expected-but-absent source names (the source-health note),
  // protocol = the pre-rendered protocol line (formulate-synthesis
  // protocolFrameText — the seeded rows' quotes locate in it; the caller
  // holds the registry entry this layer does not).
  synthesis?: { brief: string; ledger: string; missing?: string[]; protocol?: string }
}): { goal: string; scope: string; acceptance: string } {
  const manual = input.phase === undefined
  const synth = input.synthesis
  // The input blocks' blank-normalization (the retired renderer's caller-side
  // trims, folded in): a blank text renders nothing.
  const briefText = input.brief?.trim() || undefined
  const analysisText = input.analysis?.trim() || undefined
  const inputText = input.input?.trim() || undefined
  const parts: string[] = []
  parts.push(
    synth
      ? [
          "This document is the single input of this formulation task: the DRIVER assembled the frame below from the project's committed",
          "sources, and the constructor session — run under the project's intent charter — re-voiced the evidential sources into the Sources",
          "brief and the obligations ledger that follow. Plan from the brief, the ledger, the planning input and the repository; the sources",
          "stay the authority beneath the brief. Where two of them disagree, the authority order (when present below) says which wins, and a",
          "conflict row of the ledger records what the plan must carry — never a silent resolution.",
        ].join("\n")
      : "This document is the single input of this formulation task: the DRIVER assembled everything below from the project's committed sources when it created the task, and nothing else is injected into your session. Plan from these sources — the repository and the project's artifacts, never invention; where two of them disagree, the authority order (when present below) says which wins.",
  )
  if (synth === undefined) {
    if (briefText !== undefined) {
      parts.push(["## Input: project intent (.opencode/auto/brief.md)", "", briefText, ""].join("\n"))
    } else if (!manual) {
      parts.push(
        [
          "## Input: project intent",
          "",
          "Not provided (no project brief yet; .opencode/auto/brief.md is missing or empty). The survey phase of a re-work",
          "round will propose one — seed it optionally with `init --brief <one line>` (what the project is, where the",
          "reference lives, where the deliverable goes), or name the reference in this round's planning input.",
          "",
        ].join("\n"),
      )
    }
    if (input.round) {
      const rules = intentText(facts, "acceptance", "round-brief", {})
      parts.push(
        ["## Input: round brief (this round's round.md)", "", "The human's statement of what this round is for. Plan this phase's tasks toward its goal and criteria.", "", input.round.trim(), ...(rules ? ["", rules.trim()] : []), ""].join("\n"),
      )
    }
    if (analysisText !== undefined) {
      parts.push(
        [
          "## Input: approved project analysis (docs/analysis.md)",
          "",
          "The person's approved pre-round decisions — the goals, the constraints, the roadmap of rounds. What this analysis",
          "settles is settled: carry its decisions forward, never re-raise them as open questions; a decision its goals,",
          "constraints or roadmap implies is decided the same way, with the derivation recorded.",
          "",
          analysisText,
          "",
        ].join("\n"),
      )
    }
  }
  if (inputText !== undefined) {
    parts.push(
      manual
        ? ["## Input: plan file (" + (input.inputPath ?? "plan-input.md") + ")", "", inputText, ""].join("\n")
        : [
            `## Input: planning input (${input.inputPath ?? "plan-input.md"})`,
            "",
            "The person who started this planning step asked for the following. Plan this phase's tasks to cover it, within",
            "the phase duties below.",
            "",
            inputText,
            "",
          ].join("\n"),
    )
  }
  if (input.mode) {
    parts.push(["## Input: scenario-mode preamble (" + input.mode.name + ")", "", modeText(input.mode.init).trim(), ""].join("\n"))
  }
  const precedence = intentText(facts, "guarantees", "precedence", {})
  if (precedence) {
    parts.push(
      [
        "## Authority order (intent guarantees)",
        "",
        "Where any part of this document — the planning input, the sources brief, the ledger, the phase duties — conflicts with the intent charter above, the charter wins. A conflict is never resolved by silently following the lower-order text.",
        "",
        precedence.trim(),
        "",
      ].join("\n"),
    )
  }
  if (synth !== undefined) {
    parts.push(
      [
        "## Sources brief (constructor session, under the charter)",
        "",
        ...(synth.missing?.length
          ? [`Source health: the following expected sources are absent — ${synth.missing.join(", ")} — plan for their absence, never inventing their content.`, ""]
          : []),
        "The constructor session re-voiced the evidential sources (project brief, round brief, analysis, prior-phase handovers,",
        "prior-round conclusions — whichever this formulation had) organized as the charter directs, quoting load-bearing lines.",
        "",
        synth.brief.trim(),
        "",
        "## Obligations ledger",
        "",
        "The enumerated, quoted list of what the sources demand of this plan. Every row is an obligation a planned task covers or",
        "explicitly defers (reason recorded in that task's document), or a conflict the plan records per the authority order — the",
        "wrap-up verification judges this plan row by row, and the coverage map maps every row to its task.",
        "",
        synth.ledger.trim(),
        "",
        "Boundaries: the ledger enumerates what the sources name — it cannot invent requirements, and nothing here widens the",
        "project's charter. The repository survey remains this session's own first duty (protocol item 1 below). The seeded",
        "protocol rows (source `phase duties`) are the DRIVER's own; this round's obligations are the ledger's, the standing bar",
        "is the charter's.",
        "",
      ].join("\n"),
    )
  } else {
    if (input.handovers) {
      parts.push(
        [
          "## Input: prior-phase handovers",
          "",
          "The handover-distillation documents of each prior phase (at this round's phase directories'",
          "P<nn>-<type>/handover.md, a permanent path) — the sole channel of cross-phase memory, replacing the prior",
          "phases' raw docs/ (do not read those when planning; pull detail via each handover's artifact index):",
          "",
          input.handovers.trim(),
          "",
        ].join("\n"),
      )
    }
    if (input.prevRound) {
      parts.push(
        [
          "## Input: prior-round conclusions (continuation round)",
          "",
          "This project has already run a full phased round of work, and this is a continuation round: build on the existing",
          "results to bring them into fuller agreement with what the project is for — prioritise gaps and misses left over",
          "from the prior round, do not redo finished work. An excerpt of the prior round's conclusions follows",
          "(each prior phase's task index tasks.md lives inside its own phase directory under the prior round's docs/R-NN/,",
          "a permanent path; pull detail via the index as needed):",
          "",
          input.prevRound.trim(),
          "",
        ].join("\n"),
      )
    }
  }
  if (!manual) {
    const duties = planDutyText(facts, input.phase!, { phaseName: input.phase!.name, ...(input.testByDriver ? { testByDriver: true } : {}) })
    parts.push(
      [
        "## Phase duties and artifact conventions",
        "",
        "Document placement is anchored to tasks: each task's document artifacts go into its task directory docs/T-NNN/",
        "(subtask artifacts included, at docs/T-NNN/S<two-digit index>/index.md); once a path is created it is permanent and",
        "does not move with the phase/round.",
        "",
        duties,
        ...(synth?.protocol ? ["", `Protocol obligations this plan carries regardless (the DRIVER seeds these ledger rows itself): ${synth.protocol}.`] : []),
        "",
        ...(input.finalPhase ? [renderText("{{> report-duty}}", { reportFile: input.reportFile }).trim(), ""] : []),
        ...(input.trimmedPhases && input.phase?.type === "implement"
          ? [
              "Pipeline-trimming note: this round's pipeline was trimmed via --phases with no separate analysis/design phase — fold",
              "the necessary survey and design points into this phase's first batch of tasks. The baseline-safety-net items (the",
              "before baseline, the guard/flip/exclude/per-batch-update checklist, AUTO-TODO reconciliation, tallies, etc.) must not",
              "be dropped because of pipeline trimming.",
              "",
            ]
          : []),
      ].join("\n"),
    )
  }
  // m mode's report duty (the implicit round's single phase is final,
  // plans/0053 D12's rule carried over): no duties section to sit beside, so
  // it renders as its own block ahead of the protocol. The synthesis shape's
  // protocol line (the caller's — the implicit implement entry's seeded
  // rows) rides ahead of it.
  if (manual && input.finalPhase) {
    if (synth?.protocol) parts.push(`Protocol obligations this plan carries regardless (the DRIVER seeds these ledger rows itself): ${synth.protocol}.\n`)
    parts.push(renderText("{{> report-duty}}", { reportFile: input.reportFile }).trim() + "\n")
  }
  const { parallel, parallelRules } = parallelismVars(facts, input.parallel)
  if (parallelRules) {
    parts.push(
      [
        `## Parallelism (${parallel})`,
        "",
        "A task whose dependencies are done runs side by side with any other task whose `Touches:` paths it does not",
        "overlap — plan for that as follows:",
        "",
        parallelRules.trim(),
        "",
      ].join("\n"),
    )
  }
  const numberStart = String(input.numberStart).padStart(3, "0")
  parts.push(
    [
      "## What this task writes (the DRIVER's format protocol)",
      "",
      "1. Do a read-only survey of the target directory's current state, the relevant source code and existing docs/ content;",
      "2. Write all of this phase's tasks as task units in execution order — one task document per task, plus one line in",
      "   this phase's task index:",
      "   - Task document docs/T-NNN/todo.md (one directory per task), format:",
      "",
      "# T-NNN: <task title>",
      `Phase: ${input.phaseId}`,
      "",
      "## Goal",
      "<goal: what this task delivers>",
      "",
      "## Scope",
      "<scope: modules/files involved, key constraints and necessary context — self-contained, executable from this and docs/ alone>",
      "",
      "## Acceptance",
      "<acceptance: what counts as done>",
      "",
      "<!-- auto: eof -->",
      "",
      `   - Task index ${input.taskIndex}, one line per task in execution order:`,
      "",
      "- [ ] T-NNN <task title>",
      "",
      "   The title line, the `Phase:` field line, the three section headings, the index line and the closing terminator are",
      "   parsed by the DRIVER — write them verbatim as above, do not translate or rephrase them;",
      `   ${renderText("{{> task-depends}}", {}).trim().replaceAll("\n", "\n   ")}`,
      `   ${renderText("{{> task-decompose}}", {}).trim().replaceAll("\n", "\n   ")}`,
      `3. Task numbers increment continuously from T-${numberStart} (auto-numbering: numbers never repeat within the target directory; earlier numbers are already taken by historical tasks and must not be reused);`,
      "   each task is one independently deliverable outcome; do not hand-write subtask checklist items",
      "   (whether and how a task is split is decided at execution time);",
      "4. End the session immediately once planning is done and the task index and all task documents are written.",
      "",
      "## Constraints",
      "",
      `1. This session writes only the task index ${input.taskIndex} and each task's docs/T-NNN/todo.md — never done.md;`,
      "   every other file, and every state file, is outside this session's write scope.",
      "2. The task index must have at least one task: even if you conclude this phase has nothing to do, write one",
      "   explanatory task and state the reason in its task document; producing no valid task causes a blocked shutdown.",
      "",
      renderText("{{> doc-layout}}", {}).trim(),
    ].join("\n"),
  )
  const scope = parts.join("\n").replaceAll(/\n{3,}/g, "\n\n").trim()
  // The guarantees gate, renderPrompt's contract carried onto the todo
  // assembly (plans/0095 D4): the retired phase-plan template's asserts keep
  // their meaning — the assembled Scope is the planning prompt now — keyed
  // by the same template name and phase tag, so a pack's pinned literals
  // hold exactly as before.
  const asserts = parseGuaranteeAsserts(facts.pack)
  if (asserts !== undefined) {
    const violation = guaranteeViolation(facts.pack, asserts, "phase-plan", input.phase ? phaseTag(input.phase) : undefined, scope)
    if (violation !== undefined) throw new PromptGuaranteeError(violation)
  }
  const goal = manual
    ? `Formulate the implementation work's complete task plan — the task index ${input.taskIndex} plus every task's document docs/T-NNN/todo.md — as a verifiable path to what it must deliver; the Acceptance below states the bar the plan must meet.`
    : `Formulate the "${input.phase!.name}" phase's complete task plan — the task index ${input.taskIndex} plus every task's document docs/T-NNN/todo.md — as a verifiable path to what this phase must deliver; the Acceptance below states the bar the plan must meet.`
  return { goal, scope, acceptance: input.charter }
}
