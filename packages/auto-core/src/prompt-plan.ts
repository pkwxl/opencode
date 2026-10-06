// Planning-session prompts: phased planning (renderPhasePlan), m-mode
// planning (renderImplementPlan) and append planning (renderPhaseAppend),
// the first two rendered by planPhase (src/loop-plan.ts, plans/0053 D12) and
// the third by appendPlan (D23–D27, the wiring half landed with the template).
// Moved out of src/prompt.ts (plans/0053 A2) so the P3 planning additions do
// not grow that file; the copy stays in templates/prompts/phase-plan.md,
// implement-plan.md and phase-append.md, and rendering goes through
// prompt.ts's single exit (renderPrompt) and its intent-pack helpers.
// Off the driver with E2 (plans/0061 §6.3): the phase entry and the duty
// paragraph arrive as data (the caller renders the registry's duty text),
// and every render takes the PromptFacts value the caller built.
import type { ModeSpec } from "./mode"
import { dutiesForPhase } from "./intent/load"
import type { ParallelLevel } from "./intent/types"
import { reportForUserPath } from "./docpaths"
import { intentText, modeText, parallelismVars, phaseTag, renderPrompt, type PhaseEntry, type PromptFacts } from "./prompt"
import { renderText } from "./template"

// The phase-plan duty paragraph's resolution (plans/0080 §4): the custom
// type's own `## plan duties` first, then — the new tier — the active pack's
// `### <dutiesRef>` subsection under `## phase duties`, then the core shared
// partial `plan-duties-<dutiesRef>` (the partial name is the registry's
// planDutiesPartial rule, `plan-duties-` + dutiesRef; built inline so this
// layer keeps taking the structural entry instead of importing the phases
// domain). Only builtin types ever reach the pack tier — a custom type file
// always carries its own plan duties — so this is what lets a bundle re-voice
// the builtin design/implement/test duties without touching core partials.
export function planDutyText(facts: PromptFacts, entry: PhaseEntry): string {
  const own = entry.planDuties ?? dutiesForPhase(facts.pack, entry.dutiesRef)
  return renderText(own ?? `{{> plan-duties-${entry.dutiesRef}}}`, {}).trimEnd()
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

// Phase planning session (design doc plans/0006-phases-design.md §E): a
// one-shot bypass session whose artifacts = this phase's task index
// taskIndex (<phase directory>/tasks.md) + each task's docs/T-NNN/todo.md
// (M3.4, plans/0047 L3; phaseId is the phase qualified id, written into
// the task document's `Phase:` field). brief is the .opencode/auto/brief.md
// text verbatim (may be empty; the template carries a not-provided notice
// block); handovers is the pre-joined string of every prior phase's
// handover.md (assembled on the driver side; injection discipline: only
// distillation artifacts are injected, never the prior phases' raw docs/).
// prevRound is an excerpt of the previous round's migration conclusion
// (plans/0006-phases-design.md §M, assembled on the loop side: archive
// index / final handover / migration knowledge), injected only into the
// first planning session of a continued round (once the new round's round
// directory is established).
// The migration source and target are intent and reach planning through the
// brief (plans/0052 D2); there are no separate parameters.
// planDuties is the phase type's duty paragraph, pre-rendered by the caller
// (E2): a custom type's own `## plan duties`, else the type's shared
// partial (`plan-duties-<dutiesRef>`), rendered through the active library
// so overlays apply.
// trimmedPhases takes effect only for the m phase (passed by the loop when
// the effective phases were trimmed via --phases and include no standalone
// a/d phases; the template injects the "flow trimming" note — the survey
// and design phases are folded into the first batch of tasks, and the
// bottom-line safeguards are not skipped).
// numberStart is the numbering start under auto numbering
// (config.autoNumber): the .auto/next-task recorded value, which the loop
// ensures is in place via ensureNumbering before the planning session;
// defaults when disabled — numbering starts from T-001.
export function renderPhasePlan(facts: PromptFacts, input: {
  phase: PhaseEntry
  planDuties: string
  phaseId: string
  taskIndex: string
  brief?: string
  // The round brief docs/R-NN/round.md, comments stripped (plans/0049 G3).
  round?: string
  // The phase's planning input (plans/0053 D11): the text of its plan-input.md
  // and that file's path; absent = no input block.
  input?: string
  inputPath?: string
  handovers?: string
  prevRound?: string
  mode?: ModeSpec
  trimmedPhases?: boolean
  numberStart?: number
  // config.parallel (MP.1): absent = none, nothing injected.
  parallel?: ParallelLevel
  // The round report duty (plans/0081 D2): finalPhase is true when this
  // phase is the round's last task-bearing one — the template then renders
  // the report-duty partial beside the phase duties (end the task list with
  // one wrap-up task whose deliverable is the round report), and reportFile
  // names the round's report path. A round ending in a trailing task-less
  // phase (knowledge) passes neither: that side-channel session writes the
  // report as its second artifact (D6b).
  finalPhase?: boolean
  reportFile?: string
}): string {
  const type = input.phase
  return renderPrompt(facts, "phase-plan", {
    phase: phaseTag(type),
    phaseName: type.name,
    phaseId: input.phaseId,
    taskIndex: input.taskIndex,
    // The intent's declared authority order (`## guarantees` / `###
    // precedence`, plans/0080 §2): the planning prompt is exactly where the
    // human planning input meets the intent charter, so the block stating
    // which side wins belongs here first. Absent section ⇒ the template's
    // block disappears (zero-intent floor).
    precedence: intentText(facts, "guarantees", "precedence", {}),
    brief: input.brief?.trim() || undefined,
    round: input.round?.trim() || undefined,
    // How to plan against the brief is intent (M4.2, `## acceptance` / `### round-brief`).
    roundRules: input.round?.trim() ? intentText(facts, "acceptance", "round-brief", {}) : undefined,
    input: input.input?.trim() || undefined,
    inputPath: input.inputPath,
    handovers: input.handovers?.trim() || undefined,
    prevRound: input.prevRound?.trim() || undefined,
    modeName: input.mode?.name,
    modeInit: input.mode && modeText(input.mode.init),
    trimmedPhases: type.type === "implement" && input.trimmedPhases ? true : undefined,
    numberStart: input.numberStart === undefined ? undefined : String(input.numberStart).padStart(3, "0"),
    planDuties: input.planDuties,
    finalPhase: input.finalPhase || undefined,
    reportFile: input.finalPhase ? input.reportFile : undefined,
    ...parallelismVars(facts, input.parallel),
  })
}

// Planning parallelism guidance (MP.1, plans/0046 D10/D11): the level's
// `## parallelism` intent subsection — prompt.ts's shared parallelismVars
// (since plans/0068 S5 the decompose family and the whole-task split clause
// inject the same subsection). At none, or when the pack lacks the
// subsection, both keys are undefined and the template's block renders nothing.

// m-mode planning (phases = "m", plans/0053 D12; formerly the init shortcut
// --implement-file/--implement-prompt): a one-shot bypass session whose
// artifacts = the single-phase P01-implement's task index + each task's
// documents, reusing the same task-unit format conventions as
// renderPhasePlan but without the phased-flow notions of phase / round /
// handover. numberStart is the numbering start (the value before
// three-digit zero padding; default 1). The input is one of two: with
// file given, content is presented as the "plan file" (the source file's
// full text; path for the prompt to reference), otherwise as the
// "implementation prompt" (content = the prompt text verbatim).planPhase always passes the
// phase's persisted planning input as the file (plan-input.md, D11), so the
// prompt branch is unused by the core. brief is the .opencode/auto/brief.md
// text verbatim (may be empty; it lets the planning session sense the
// project intent).
export function renderImplementPlan(facts: PromptFacts, input: {
  file?: string
  content: string
  brief?: string
  phaseId: string
  taskIndex: string
  numberStart?: number
  parallel?: ParallelLevel
  // The round's number (plans/0081 D2): the no-phase implicit round's single
  // phase is final, so its planner carries the report duty like any other —
  // the round's report path is derived from it. Absent = no report duty.
  round?: number
}): string {
  return renderPrompt(facts, "implement-plan", {
    phaseId: input.phaseId,
    taskIndex: input.taskIndex,
    numberStart: String(input.numberStart ?? 1).padStart(3, "0"),
    fromFile: input.file !== undefined,
    filePath: input.file,
    content: input.content,
    brief: input.brief?.trim() || undefined,
    finalPhase: input.round !== undefined || undefined,
    reportFile: input.round !== undefined ? reportForUserPath(input.round) : undefined,
    ...parallelismVars(facts, input.parallel),
  })
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
// (the phase naming) and the pre-rendered duty paragraph (as renderPhasePlan's
// planDuties; an m-mode session passes neither — as implement-plan, it has no
// duties, round or handovers — so the template drops those blocks).
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
// render the shared blocks' absence silently, as implement-plan does.
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
    // The precedence block, same subsection as renderPhasePlan: an append
    // plans against a human input too (plan --append, or a repair round's
    // evidence), so the authority order rides along.
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
