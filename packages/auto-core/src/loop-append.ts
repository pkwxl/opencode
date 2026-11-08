// The append step (plans/0053 D23–D25; split out of src/loop-plan.ts by
// plans/0235 so that module keeps its under-600 promise): the planner that
// adds tasks to a phase whose index already lists some — the snapshot →
// reset → collect cycle (D24) over the persisted planning input, the
// stale-handover removal (D25), and the step wrapper with plan's stop
// handling (D6). Modeled on planPhase and sharing its machinery through
// src/plan-gate.ts (the plan-step gate) and src/formulate-parts.ts (the
// handover chain). Direction: loop-phase → loop-append →
// plan-gate/formulate-parts → loop-task; never imports loop-phase, loop or
// loop-plan.
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { requireArtifact } from "./artifact"
import type { BlockMapEntry } from "./blockage"
import { BRIEF_FILE, projectBriefText } from "./brief"
import { earlierHandovers } from "./formulate-parts"
import { dirtyStopLines, log, unreadableStopLines } from "./log"
import { taskNumber, taskNumberFloor } from "./numbering"
import { sessionOpts } from "./opts"
import { admissionWarn, planDuties, planFacts, verifyPlanStep } from "./plan-gate"
import { plannedLines } from "./plan"
import { planInputPath, readPlanInput, savePlanInput } from "./plan-input"
import { phaseHandoverDoc, phaseKey, phaseState, phaseTitle, type PhaseUnit } from "./phases"
import { existingTaskList, renderPhaseAppend } from "./prompt-plan"
import { closeStep } from "./resume"
import { roundBriefText } from "./round-brief"
import { stepPause } from "./step"
import { doneTaskIds, loadPlan, newTaskProblems, qualifiedPhase, takenTaskIds, taskDecl, taskIndexPath, taskStatePaths, type PlanPhase } from "./tasks"
import { isUnitId, parseIndex, unitProblems, type IndexEntry, type UnitDecl } from "./document/unit"
import type { LoopCtx } from "./loop-task"

// The earlier phases' handover sources as block-map entries (the append
// side's composition state; the same selection earlierHandovers injects).
async function earlierHandoverSources(directory: string, phase: PhaseUnit): Promise<BlockMapEntry[]> {
  const state = await phaseState(directory)
  return state.phases
    .slice(0, state.phases.findIndex((unit) => unit.id === phase.id))
    .filter((unit) => state.done.has(unit.id))
    .map((unit) => ({ block: "handover", source: phaseHandoverDoc(unit) }))
}

// What an appending session builds on, read from disk at step entry (plans/0053
// F1: the tree is clean at HEAD there — preflight guaranteed it — so disk is
// the committed state). Tasks a person committed mid-append count as existing
// on re-entry: the re-entry snapshot includes them, and only the entries after
// them are checked (D24's residual).
export type AppendSnapshot = {
  // Repository-relative path of the phase's task index.
  index: string
  // The index text as it stands at step entry.
  text: string
  entries: IndexEntry[]
  // Per existing task id: the text of the state file(s) that exist (exactly
  // one per task in a valid index); a missing key = the file was absent.
  files: Map<string, { pending?: string; complete?: string }>
}

// Read the append snapshot of a phase whose index already lists tasks.
export async function snapshotAppend(dir: string, phase: PlanPhase): Promise<AppendSnapshot> {
  const index = taskIndexPath(phase)
  const text = await Bun.file(join(dir, index)).text()
  const entries = parseIndex(text, "task").entries
  const files = new Map<string, { pending?: string; complete?: string }>()
  for (const entry of entries) {
    const paths = taskStatePaths(entry.id)
    const pending = await Bun.file(join(dir, paths.pending)).text().catch(() => undefined)
    const complete = await Bun.file(join(dir, paths.complete)).text().catch(() => undefined)
    files.set(entry.id, { ...(pending !== undefined ? { pending } : {}), ...(complete !== undefined ? { complete } : {}) })
  }
  return { index, text, entries, files }
}

// The append collect (plans/0053 D24): problems of what an appending session
// wrote onto a phase whose index already listed tasks (empty problems and the
// appended ids = accepted). The existing prefix is fixed — index lines and
// task documents alike — and only the entries after it are the session's
// output, each checked by the per-task rules (newTaskProblems, `before` =
// taken ∪ snapshot ids), with the whole index's dependency graph re-checked
// (the existing decls come from the snapshot texts, so an edited document is
// caught by the file-identity check, not silently re-validated).
export async function appendProblems(
  dir: string,
  phase: PlanPhase,
  snap: AppendSnapshot,
  opts: { before: ReadonlySet<string>; numberStart?: number },
): Promise<{ problems: string[]; ids: string[] }> {
  const index = taskIndexPath(phase)
  const text = await Bun.file(join(dir, index)).text().catch(() => undefined)
  if (text === undefined) return { problems: [`${index} is missing`], ids: [] }
  const parsed = parseIndex(text, "task")
  const problems = parsed.problems.map((problem) => `${index} ${problem}`)
  const entries = parsed.entries
  const prefix = snap.entries
  // The first *n* entries equal the snapshot's, in order, with their lines
  // unchanged (compared through the parser's view — id, title, tick — which is
  // the shape the driver guarantees; anything a session may do to an existing
  // line shows up in one of the three).
  let prefixHolds = true
  if (entries.length < prefix.length) {
    problems.push(`${index} lists ${entries.length} task(s) but held ${prefix.length} before the append; existing lines are fixed — append after them, never remove one`)
    prefixHolds = false
  } else {
    for (let i = 0; i < prefix.length; i++) {
      const was = prefix[i]!
      const now = entries[i]!
      if (now.id !== was.id) {
        problems.push(`${index} line ${now.line}: ${now.id} sits where ${was.id} sat; existing lines are fixed — append after the last existing line, never reorder or replace`)
        prefixHolds = false
        break
      }
      if (now.title !== was.title || now.ticked !== was.ticked) {
        problems.push(`${index} line ${now.line}: the existing line of ${was.id} was edited; existing lines are fixed — append only`)
        prefixHolds = false
        break
      }
    }
  }
  // At least one new entry follows the snapshot prefix.
  const fresh = prefixHolds ? entries.slice(prefix.length) : []
  if (prefixHolds && !fresh.length) {
    problems.push(`${index} gained no new task; the append must add at least one (a line \`- [ ] T-NNN <task title>\` after the existing ones)`)
  }
  // No existing task's state file changed: per snapshot id, the file that
  // existed holds exactly the snapshotted text and the other one is still
  // absent (a created done.md would both edit the set and break the index).
  for (const [id, files] of snap.files) {
    const paths = taskStatePaths(id)
    for (const key of ["pending", "complete"] as const) {
      const was = files[key]
      const now = await Bun.file(join(dir, paths[key])).text().catch(() => undefined)
      if (was === undefined && now !== undefined) {
        problems.push(`${paths[key]} of the existing task ${id} is new; an append never touches an existing task's state files`)
      } else if (was !== undefined && now !== was) {
        problems.push(`${paths[key]} of the existing task ${id} was changed or removed; an append never edits an existing task's document`)
      }
    }
  }
  // The per-task checks over the appended entries; the dependency graph of the
  // whole index runs once every entry has a decl (the prefix decls from the
  // snapshot texts, the fresh ones from the per-task read).
  const decls: UnitDecl[] = []
  let complete = prefixHolds
  for (let i = 0; i < prefix.length && complete; i++) {
    const entry = entries[i]!
    const files = snap.files.get(entry.id)
    const doc = files ? (files.pending ?? files.complete) : undefined
    if (doc === undefined) complete = false
    else decls.push(taskDecl(entry.id, doc))
  }
  for (const entry of fresh) {
    const checked = await newTaskProblems(dir, phase, entry.id, opts)
    problems.push(...checked.problems)
    if (checked.decl) decls.push(checked.decl)
    else complete = false
  }
  if (complete && decls.length === entries.length) {
    problems.push(...unitProblems("task", decls, { external: await doneTaskIds(dir) }).map((problem) => `${index}: ${problem}`))
  }
  return { problems, ids: fresh.map((entry) => entry.id).filter((id) => isUnitId("task", id)) }
}

// Restore the snapshot before each fresh attempt (plans/0053 D24): write the
// snapshot index text back, restore any changed existing task file (and remove
// a state file the snapshot does not have), and remove the task directories of
// index ids that are neither in the snapshot nor taken elsewhere — an id
// listed by another phase's index, or already done, belongs to that other
// unit, so its directory is never removed however it got listed here.
// requireArtifact skips this when a reused session resumes: the worktree is
// then the session's own progress, not stale output.
export async function resetAppend(dir: string, phase: PlanPhase, snap: AppendSnapshot): Promise<void> {
  const file = join(dir, snap.index)
  const current = await Bun.file(file).text().catch(() => undefined)
  const snapIds = new Set(snap.entries.map((entry) => entry.id))
  if (current !== undefined) {
    const taken = await takenTaskIds(dir, phase)
    for (const entry of parseIndex(current, "task").entries) {
      if (snapIds.has(entry.id) || taken.has(entry.id)) continue
      await rm(join(dir, "docs", entry.id), { recursive: true, force: true })
    }
  }
  if (current !== snap.text) await Bun.write(file, snap.text)
  for (const [id, files] of snap.files) {
    const paths = taskStatePaths(id)
    for (const key of ["pending", "complete"] as const) {
      const was = files[key]
      if (was === undefined) {
        await rm(join(dir, paths[key]), { force: true })
      } else {
        const now = await Bun.file(join(dir, paths[key])).text().catch(() => undefined)
        if (now !== was) await Bun.write(join(dir, paths[key]), was)
      }
    }
  }
}

// The appending session (plans/0053 D23–D25): the planner that adds tasks to
// a phase whose index already lists some, over the persisted planning input
// (an append always has one: --append without input is refused up front, and
// this backstop catches a deleted plan-input.md). Modeled on planPhase and
// sharing its machinery — the numbering derivation, the input commit, the
// step resume point — with the snapshot → reset → collect cycle in place of
// the fresh planning output check. Returns 0 = append complete, 1 = no
// planning input, 2 = blocked.
// AUTO-DECISION: no spec.role is declared (either mode) — phaseToRole already
// maps the phase-append step to the phase-plan model role (D23/F6), and the
// append template is new surface, so no legacy implement-scan routing applies
// to it; declaring one would only fork the mapping.
export async function appendPlan(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const { directory, opts, server: serverHandle } = ctx
  // Appending plans against a planning input, checked first so a missing one
  // stops the step before anything is written (the prelude and the shell
  // check this first; this backstops other shells and a deleted input file).
  if (!ctx.input && !(await readPlanInput(directory, phase))?.trim()) {
    log(`⏸ nothing to append ${phaseTitle(phase)} against: appending plans against a planning input, and ${planInputPath(phase)} is missing or empty`)
    return 1
  }
  // auto numbering: same derivation as planPhase — the append numbering
  // start is the deterministic floor over the surviving files (plans/0150),
  // never a persisted record; without autoNumber it stays undefined (the
  // historical shape, unchanged).
  const numberStart: number | undefined = opts.autoNumber ? await taskNumberFloor(directory) : undefined
  // The planning input (D9), exactly as in planPhase: a new text is persisted
  // and committed before the unit starts; a different text restarts an open
  // step in a new session, so no reused session plans against a text it never
  // saw. An append overwrites the phase's file — the latest input wins.
  let restart: string | undefined
  if (ctx.input) {
    const text = ctx.input.text
    const saved = await savePlanInput(directory, phase, ctx.input, phaseTitle(phase))
    if (saved.type === "dirty") {
      for (const line of dirtyStopLines("worktree not clean before saving the planning input", saved.files)) log(line)
      return 2
    }
    if (saved.type === "failed") {
      log(`⏸ ${saved.question}`)
      return 2
    }
    ctx.input = undefined
    if (saved.type === "saved") {
      log(`✓ planning input saved to ${planInputPath(phase)}`)
      restart = "the planning input changed"
      // The admission warn (plans/0082 §10 D14b): the same charter check over
      // the person's text, warn-and-record, never refuse.
      await admissionWarn(ctx, phase, text, `phase-append ${phaseKey(phase).id}`)
    }
  }
  let input = (await readPlanInput(directory, phase))?.trim() || undefined
  if (input && !restart) log(`ℹ appending against the persisted input ${planInputPath(phase)}`)
  // The append builds on an index that lists tasks; a re-entered step whose
  // index has gone missing (deleted by hand between runs) is an anomaly to
  // surface, not an empty snapshot to append onto.
  const taskIndex = taskIndexPath(phase)
  if (!(await Bun.file(join(directory, taskIndex)).exists())) {
    log(`⏸ ${taskIndex} is missing: the task-append step of ${phaseTitle(phase)} has no task index to append to (deleted by hand?); restore it or list tasks there, then re-run`)
    return 1
  }
  // The snapshot (D24): taken at step entry from disk, which preflight's clean
  // gate left at HEAD. On re-entry it includes whatever was committed meanwhile
  // (D24's residual), so a person's mid-append commit counts as existing work.
  const snap = await snapshotAppend(directory, phase)
  const plan = await loadPlan(directory, phase)
  // taken numbers = other phases' indexes and done tasks ∪ this phase's
  // existing entries (D24); without auto numbering, the prompt's numbering
  // start is the highest number among them + 1 (D25: the highest taken or
  // listed id + 1).
  // AUTO-DECISION: the collect enforces the numbering start only under
  // autoNumber, exactly as planPhase does — without it only collisions with
  // taken or listed ids are refused, so a gap id the session picks below the
  // prompt's start stays acceptable, as in planning.
  const taken = await takenTaskIds(directory, phase)
  const before = new Set([...taken, ...snap.entries.map((entry) => entry.id)])
  const listed = Math.max(0, ...[...before].map((id) => taskNumber(id) ?? 0)) + 1
  const promptStart = numberStart ?? listed
  // The project brief, comments stripped: an untouched stub injects nothing.
  let brief = await projectBriefText(directory)
  const phaseId = qualifiedPhase(phase)
  // The compose-and-verify loop (the append side of plans/0082 §5 D7 / §6
  // D9): an append plans against a human input too — plan --append or a
  // repair round's evidence — so its composed prompt is verified the same
  // way before its session runs; "remediate" re-composes and re-verifies.
  // The remediable sources re-read before every compose pass (plans/0156
  // D4, planPhase's freshen): the remediation executor can rewrite the
  // planning input and the brief between two passes, and the re-verification
  // must judge what landed. The handover sources phaseAppendPrompt gathers
  // are already read fresh inside each call; the task snapshot (D24) is
  // entry state no remediation rewrites.
  const freshen = async (): Promise<void> => {
    input = (await readPlanInput(directory, phase))?.trim() || undefined
    brief = await projectBriefText(directory)
  }
  const compose = async (): Promise<{ prompt: string; blocks: BlockMapEntry[] }> => {
    await freshen()
    const prompt = ctx.manual
      ? renderPhaseAppend(planFacts(ctx), {
          phaseId,
          taskIndex,
          numberStart: promptStart,
          input: input!,
          inputPath: planInputPath(phase),
          existingTasks: existingTaskList(plan.tasks),
          brief,
          parallel: opts.parallel,
          maxSessions: opts.maxSessions,
        })
      : await phaseAppendPrompt(ctx, phase, { brief, input: input!, taskIndex, phaseId, numberStart: promptStart, existingTasks: existingTaskList(plan.tasks) })
    const blocks: BlockMapEntry[] = [
      { block: "template", source: "the phase-append template" },
      { block: "phase duties", source: "the active pack's phase-duties section" },
      { block: "brief", source: brief ? BRIEF_FILE : `${BRIEF_FILE} (absent)` },
      { block: "planning input", source: planInputPath(phase) },
      { block: "task index", source: taskIndex },
      ...(await earlierHandoverSources(directory, phase)),
    ]
    return { prompt, blocks }
  }
  let prompt = ""
  let verified: number | "remediate" = 0
  for (let pass = 0; ; pass++) {
    const composed = await compose()
    prompt = composed.prompt
    verified = await verifyPlanStep(ctx, phase, `phase-append ${phaseKey(phase).id}`, prompt, composed.blocks)
    if (verified !== "remediate") break
    if (pass >= 1) {
      log("⏸ the step re-blocked after two inline remediations; stopping — the diagnosis gate suspends further attempts")
      return 2
    }
  }
  if (verified !== 0) return verified
  let problems: string[] = []
  log(`▶ starting the task-append session to append to ${taskIndex}`)
  const appended = await requireArtifact(
    serverHandle,
    { id: "PLAN", title: `phase append (${phaseTitle(phase)})`, status: "in_progress", attempts: 0, body: "" },
    prompt,
    sessionOpts(ctx, { site: "phase-append" }),
    {
      kind: "task appending",
      step: { step: "phase-append", unit: phaseKey(phase).id },
      restart,
      // Independent hidden task unit: entry clean gate + SHA baseline + close-out
      // check (plans/0021-commit-boundary-design.md).
      unitStart: true,
      artifact: `new task lines appended to ${taskIndex} with their task documents (at least one new task)`,
      detail: "no new task, an existing line or task document changed, or a task number reusing a taken number",
      get requirement() {
        return (
          `append new task lines after the existing ones of ${taskIndex} (one per task, \`- [ ] T-NNN <task title>\`, at least one) ` +
          `and each new task's docs/T-NNN/todo.md (title line \`# T-NNN: <task title>\`, field line \`Phase: ${phaseId}\`, ` +
          `the three sections \`## Goal\` / \`## Scope\` / \`## Acceptance\`, last line \`<!-- auto: eof -->\`), ` +
          `without changing any existing index line or task document.` +
          (problems.length ? ` Problems last time: ${problems.join("; ")}.` : "")
        )
      },
      commit: { stage: "phase-append", subject: `PLAN append ${phaseTitle(phase)}` },
      reset: () => resetAppend(directory, phase, snap),
      collect: async () => {
        const checked = await appendProblems(directory, phase, snap, { before, numberStart })
        problems = checked.problems
        return problems.length ? undefined : checked.ids
      },
    },
  )
  if (!Array.isArray(appended)) {
    if (appended.type === "dirty" || appended.type === "unreadable") {
      // The unreadable arm (plans/0236 D4) teaches investigation, never
      // commit/clean.
      for (const line of appended.type === "unreadable"
        ? unreadableStopLines("the repository state cannot be read before starting the task-append session", appended.files)
        : dirtyStopLines("worktree not clean before starting the task-append session", appended.files)) log(line)
    } else {
      log(`⏸ task-append session blocked (implicit block, investigate and re-run):\n${appended.question}`)
    }
    return 2
  }
  log(`✓ task append complete: ${taskIndex} gained ${appended.length} task(s)`)
  ctx.planned = appended
  // Stale handover (plans/0053 D25/F13): a phase that was already distilled
  // has a handover.md that predates the appended tasks — the phase is
  // distilled again after they run, so the stale document goes now, in its own
  // commit; acceptance.md and verdict.md stay (the next distillation redrafts
  // the first, the new tasks may rewrite the second).
  const handover = phaseHandoverDoc(phase)
  if (await Bun.file(join(directory, handover)).exists()) {
    await rm(join(directory, handover))
    // The run's git seam carries the strategy: on the no-commit double the
    // ok answer keeps the failure branch dead (the removal itself still
    // happens, as the rename does in the prior-knowledge close-out).
    const settled = await ctx.git.commitTree(directory, { id: "PLAN", title: `phase append (${phaseTitle(phase)})` }, {
      stage: "phase-append",
      subject: `PLAN append ${phaseTitle(phase)}: remove the stale handover`,
    })
    if (!settled.ok) {
      log(
        `⏸ stale-handover removal commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. ` +
          `The deletion is kept in the worktree; commit manually and re-run (the append step re-enters idempotently)`,
      )
      return 2
    }
    log(`✓ stale handover removed: ${handover} (the phase is distilled again after the appended tasks)`)
  }
  // close-out: delete this step's driver-side resume point, the last step
  // (D25) — killed before this → the record is still active, and the next run
  // re-enters the append through openStep (idempotent). Known residual: if
  // the kill lands after the append unit's commit and before the close-out,
  // the re-entry snapshot already contains the committed appended tasks, and
  // the redo appends another batch (a residual the design accepts; plan stops
  // for human review, the duplication is visible and editable).
  await closeStep(directory, "phase-append", phaseKey(phase).id)
  return 0
}

// The phased appending prompt: phase-append over the project brief, the
// planning input, the earlier phases' handovers and the round brief (the
// existing tasks and the phase naming come with the shared template).
async function phaseAppendPrompt(
  ctx: LoopCtx,
  phase: PhaseUnit,
  parts: { brief?: string; input: string; taskIndex: string; phaseId: string; numberStart: number; existingTasks: string },
): Promise<string> {
  const { directory, opts } = ctx
  const state = await phaseState(directory)
  return renderPhaseAppend(planFacts(ctx), {
    phase: phase.entry,
    planDuties: planDuties(ctx, phase.entry),
    phaseId: parts.phaseId,
    taskIndex: parts.taskIndex,
    numberStart: parts.numberStart,
    input: parts.input,
    inputPath: planInputPath(phase),
    existingTasks: parts.existingTasks,
    brief: parts.brief,
    round: await roundBriefText(directory, state.round),
    handovers: await earlierHandovers(directory, phase, state),
    mode: opts.mode,
    parallel: opts.parallel,
    maxSessions: opts.maxSessions,
  })
}

// Task appending plus the same stop handling as planWithStep (plans/0053 D6):
// under plan's stop condition the summary — over the appended ids — is the
// review point; under run the G5 pause applies as after a planning step.
export async function appendWithStep(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const code = await appendPlan(ctx, phase)
  if (code !== 0) return code
  if (ctx.opts.stopBefore === "execute") {
    for (const line of plannedLines(ctx.directory, phase, ctx.planned ?? [], ctx.manual)) log(line)
    return 0
  }
  await stepPause("phase", `phase ${phaseTitle(phase)} append`, { interactive: ctx.repl, dir: ctx.directory })
  // /exit checkpoint (phase boundary): the request flag lives in the run's
  // control service on ctx, as the router state does.
  ctx.control.maybeExit("phase", `phase ${phaseTitle(phase)} append`)
  return 0
}
