// Planning-session prompts: phased planning (renderPhasePlan), m-mode
// planning (renderImplementPlan) and append planning (renderPhaseAppend),
// the first two rendered by planPhase (src/loop-plan.ts, plans/0053 D12) and
// the third by appendPlan (D23–D27, the wiring half landed with the template).
// Moved out of src/prompt.ts (plans/0053 A2) so the P3 planning additions do
// not grow that file; the copy stays in templates/prompts/phase-plan.md,
// implement-plan.md and phase-append.md, and rendering goes through
// prompt.ts's single exit (renderPrompt) and its intent-pack helpers.
import type { ModeSpec } from "./mode"
import type { ParallelLevel } from "./intent/types"
import { planDutiesPartial, type PhaseTypeEntry } from "./phases/registry"
import { intentText, modeText, phaseTag, renderPrompt } from "./prompt"
import type { Task } from "./tasks"
import { renderText } from "./template"

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
// trimmedPhases takes effect only for the m phase (passed by the loop when
// the effective phases were trimmed via --phases and include no standalone
// a/d phases; the template injects the "flow trimming" note — the survey
// and design phases are folded into the first batch of tasks, and the
// bottom-line safeguards are not skipped).
// numberStart is the numbering start under auto numbering
// (config.autoNumber): the .auto/next-task recorded value, which the loop
// ensures is in place via ensureNumbering before the planning session;
// defaults when disabled — numbering starts from T-001.
export function renderPhasePlan(input: {
  phase: PhaseTypeEntry
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
}): string {
  const type = input.phase
  return renderPrompt("phase-plan", {
    phase: phaseTag(type),
    phaseName: type.name,
    phaseId: input.phaseId,
    taskIndex: input.taskIndex,
    brief: input.brief?.trim() || undefined,
    round: input.round?.trim() || undefined,
    // How to plan against the brief is intent (M4.2, `## acceptance` / `### round-brief`).
    roundRules: input.round?.trim() ? intentText("acceptance", "round-brief", {}) : undefined,
    input: input.input?.trim() || undefined,
    inputPath: input.inputPath,
    handovers: input.handovers?.trim() || undefined,
    prevRound: input.prevRound?.trim() || undefined,
    modeName: input.mode?.name,
    modeInit: input.mode && modeText(input.mode.init),
    trimmedPhases: type.type === "implement" && input.trimmedPhases ? true : undefined,
    numberStart: input.numberStart === undefined ? undefined : String(input.numberStart).padStart(3, "0"),
    // The duty paragraph: a custom type's own `## plan duties` (M3.6), else the
    // type's shared partial (registry dutiesRef, M3.2), rendered through the
    // active library so overlays apply.
    planDuties: renderText(type.planDuties ?? `{{> ${planDutiesPartial(type)}}}`, {}).trimEnd(),
    ...parallelism(input.parallel),
  })
}

// Planning parallelism guidance (MP.1, plans/0046 D10/D11): the level's
// `## parallelism` intent subsection. At none, or when the pack lacks the
// subsection, both keys are undefined and the template's block renders nothing.
function parallelism(level: ParallelLevel | undefined): { parallel?: string; parallelRules?: string } {
  const rules = level ? intentText("parallelism", level, {}) : undefined
  return rules ? { parallel: level, parallelRules: rules } : {}
}

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
export function renderImplementPlan(input: {
  file?: string
  content: string
  brief?: string
  phaseId: string
  taskIndex: string
  numberStart?: number
  parallel?: ParallelLevel
}): string {
  return renderPrompt("implement-plan", {
    phaseId: input.phaseId,
    taskIndex: input.taskIndex,
    numberStart: String(input.numberStart ?? 1).padStart(3, "0"),
    fromFile: input.file !== undefined,
    filePath: input.file,
    content: input.content,
    brief: input.brief?.trim() || undefined,
    ...parallelism(input.parallel),
  })
}

// The existing-task lines of the append prompt's existingTasks slot
// (plans/0053 D27): one line per task of the current index, in index order,
// labelled by its current status; a closed task (done for scheduling, not
// delivered) carries its reason. The label is session-facing prose, not a
// protocol string. An in_progress task (transient runtime state, impossible
// at an append step — a task mid-pipeline blocks the append, D26) would show
// its own label unchanged.
export function existingTaskList(tasks: readonly Pick<Task, "id" | "title" | "status" | "closed">[]): string {
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
// (the phase naming, the duty paragraph, the round brief and the prior-phase
// handovers); an m-mode session passes none of those — as implement-plan, it
// has no duties, round or handovers — so the template drops those blocks.
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
export function renderPhaseAppend(input: {
  phase?: PhaseTypeEntry
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
  return renderPrompt("phase-append", {
    phase: type ? phaseTag(type) : undefined,
    phaseName: type?.name,
    phaseId: input.phaseId,
    taskIndex: input.taskIndex,
    numberStart: String(input.numberStart ?? 1).padStart(3, "0"),
    input: input.input.trim(),
    inputPath: input.inputPath,
    existingTasks: input.existingTasks.trim(),
    brief: input.brief?.trim() || undefined,
    round: input.round?.trim() || undefined,
    handovers: input.handovers?.trim() || undefined,
    modeName: input.mode?.name,
    modeInit: input.mode && modeText(input.mode.init),
    ...(type ? { planDuties: renderText(type.planDuties ?? `{{> ${planDutiesPartial(type)}}}`, {}).trimEnd() } : {}),
    ...parallelism(input.parallel),
  })
}
