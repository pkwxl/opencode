// Closing units (plans/0053 D17–D21, the core half of design step B2): the
// deterministic driver core behind the shell's `close` command. A closed unit
// is done for scheduling but not delivered: `Closed: <reason>` goes in as the
// last line of the unit's field block, the todo.md → done.md rename and index
// tick follow, and a closed phase gets a driver-written mechanical handover
// instead of a distillation session — its gates are skipped and recorded,
// never passed (completePhase is bypassed on purpose, so 0049 G7's single
// choke point for *passing* gates stays intact).
//
// Every refusal (a malformed ref, a subtask, the m-mode phase, another round,
// a done or already-closed unit, an explicit dependent without cascade, a
// dirty tree, a failed stash) happens before any write. The close commit
// (Auto-Task: <ref>, Auto-Stage: force-close) carries a body listing what was
// closed, and the unit close-out check runs against it. Outside git the files
// are written and no commit is made.
//
// AUTO-DECISION (options/result shape; the design pins only the option names
// and leaves the refinement open): closeUnit takes
// { reason, cascade?, changes?, phases, acceptanceGate } and returns
// { type, lines } with type "closed" (exit 0), "refused" (exit 1 — usage,
// blocked or dirty) or "failed" (exit 2 — the close commit or the close-out
// check). `lines` is the complete printable output, so the shell command is a
// thin wrapper and the core is testable without one. The rejected alternative
// — logging from the core and returning only a code — would leave the shell
// unable to order or suppress its own output.
// AUTO-DECISION (stash scope): under changes: "stash" every change of every
// repository root is stashed, driver-state leftovers included — the design's
// literal command has no carve-out, and git stash cannot exclude individual
// tracked files cleanly. The leftovers then live in the stash instead of the
// close commit, which is what asking for a stash says.
import { readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { removeCurrent } from "./current"
import { roundDirName, taskDoc } from "./docpaths"
import { validHandover } from "./document/roles"
import { parseIndex, renameUnitDone, unitStatePaths, type UnitRef } from "./document/unit"
import { changedFiles, commitTree, driverStateFile, headSha, repoRoots, stashTree, unitBaseline, unitViolations } from "./git"
import { forgetHandover, peekHandover } from "./handover"
import {
  currentRound,
  legacyLayoutProblem,
  PHASE_INDEX_NAME,
  phaseGates,
  phaseHandoverDoc,
  phaseRef,
  readPhases,
  type PhaseState,
  type PhaseUnit,
} from "./phases"
import type { PhaseGate } from "./phases/registry"
import { forgetProgress, peekProgress } from "./resume"
import { shellProfile } from "./shell"
import { forgetUnits, loadPlan, qualifiedPhase, tickIndexLine, type Plan, type Task } from "./tasks"
import { removeHandoffChain } from "./testrun"

// How a dirty worktree is handled (plans/0053 D20): "commit" folds the
// changes into the close commit (listed in its body); "stash" stashes every
// root first. Absent, anything beyond driver-state leftovers is refused.
export type CloseChanges = "commit" | "stash"

export type CloseOptions = {
  // The `Closed:` value and the commit subject's tail; required, one line.
  reason: string
  // Close explicit dependents too, repeating to a fixpoint (D17).
  cascade?: boolean
  changes?: CloseChanges
  // The project's phases value (config `phases`); "m" refuses round and
  // phase targets (the single phase of m mode never closes).
  phases: string
  // Config `acceptanceGate`, for the gates a closed phase records as skipped.
  acceptanceGate?: readonly string[]
}

export type CloseResult = { type: "closed" | "refused" | "failed"; lines: string[] }

// One task of the closing set: its close reason (a cascaded task carries the
// unit it was cascaded from) and the task index that ticks it.
type ClosingTask = { id: string; title: string; reason: string; cascadeFrom?: string; index: string }

// One phase of the closing set: the unit, its loaded plan (for the mechanical
// handover's done/closed split) and the open tasks closed with it. A task
// target uses no ClosingPhase — the phase stays open when only its task
// closes.
type ClosingPhase = { unit: PhaseUnit; plan: Plan; tasks: ClosingTask[] }

const taskRef = (id: string): UnitRef => ({ level: "task", id })

export async function closeUnit(dir: string, ref: string, opts: CloseOptions): Promise<CloseResult> {
  const refused = (lines: string[]): CloseResult => ({ type: "refused", lines })
  const reason = opts.reason.trim()
  if (!reason) return refused(["the close reason is required and must be a non-empty single line"])
  if (reason.includes("\n")) return refused(["the close reason must be one line (it is the Closed: value and the commit subject's tail)"])
  const legacy = await legacyLayoutProblem(dir)
  if (legacy) return refused([legacy])

  // —— Target parsing (D17) ——
  const subtask = /^(T-\d+)\.S\d+$/.exec(ref)
  if (subtask) return refused([`${ref}: subtasks are not closed on their own; close the task ${subtask[1]} instead`])
  // Canonical shapes only (like the id shapes of document/unit.ts): R-01,
  // R-01.P02, T-005 — a padded ref never names another unit by accident.
  const roundMatch = /^R-(\d{2,})$/.exec(ref)
  const phaseMatch = /^R-(\d{2,})\.(P\d{2,})$/.exec(ref)
  const taskMatch = /^T-\d{3,}$/.exec(ref)
  if (!roundMatch && !phaseMatch && !taskMatch) {
    return refused([`${ref}: not a unit reference; expected a round R-NN, a phase R-NN.P<nn> or a task T-NNN`])
  }
  const manual = opts.phases === "m"
  // In m mode any round/phase ref is the never-closing single phase or a
  // unit of another round; one message covers both (the design names
  // R-01 / R-01.P01, the only current-round shapes m mode can have).
  if (manual && !taskMatch) {
    return refused([`${ref}: the single phase of m mode never closes; close tasks instead`])
  }
  const round = await currentRound(dir)
  if ((roundMatch || phaseMatch) && Number((roundMatch ?? phaseMatch)![1]) !== round) {
    return refused([`${ref} belongs to another round; the current round is ${roundDirName(round)}`])
  }

  let state: PhaseState | undefined
  try {
    state = await readPhases(dir, round)
  } catch (error) {
    return refused([`⏸ phase flow blocked: ${error instanceof Error ? error.message : String(error)}`])
  }
  if (!state && !taskMatch) {
    return refused([`round ${roundDirName(round)} is not established (${join("docs", roundDirName(round), PHASE_INDEX_NAME)} is missing); nothing to close`])
  }

  // —— The closing set (D17–D18) ——
  const closingPhases: ClosingPhase[] = []
  let closingTasks: ClosingTask[]
  let ownerPlan: Plan | undefined
  if (taskMatch) {
    const id = ref
    let owner: { unit: PhaseUnit; plan: Plan } | undefined
    for (const unit of state?.phases ?? []) {
      let plan: Plan
      try {
        plan = await loadPlan(dir, unit)
      } catch (error) {
        return refused([`⏸ phase flow blocked: ${error instanceof Error ? error.message : String(error)}`])
      }
      if (plan.tasks.some((task) => task.id === id)) {
        owner = { unit, plan }
        break
      }
    }
    if (!owner) {
      const elsewhere = await listedRound(dir, id, round)
      return refused([
        elsewhere
          ? `${id} is a task of round ${elsewhere}, not the current round ${roundDirName(round)}`
          : `${id} is not listed in any phase index of round ${roundDirName(round)}`,
      ])
    }
    ownerPlan = owner.plan
    const target = owner.plan.tasks.find((task) => task.id === id)!
    if (target.status === "done") {
      return refused([target.closed !== undefined ? `${id} is already closed: ${target.closed}` : `${id} is already done`])
    }
    const set = taskClosingSet(owner.plan, id, opts)
    if (!("tasks" in set)) return set
    closingTasks = set.tasks
  } else if (phaseMatch) {
    const unit = state?.phases.find((item) => item.id === phaseMatch[2])
    if (!unit) return refused([`${ref} is not a phase of round ${roundDirName(round)} (see ${state?.index})`])
    if (state!.done.has(unit.id)) {
      const closed = state!.closed.get(unit.id)
      return refused([closed !== undefined ? `${ref} is already closed: ${closed}` : `${ref} is already done`])
    }
    let plan: Plan
    try {
      plan = await loadPlan(dir, unit)
    } catch (error) {
      return refused([`⏸ phase flow blocked: ${error instanceof Error ? error.message : String(error)}`])
    }
    closingPhases.push({ unit, plan, tasks: openTasks(plan, reason) })
    closingTasks = [...closingPhases.flatMap((phase) => phase.tasks)]
  } else {
    // A round closes through its open phases (D18) and then counts as
    // complete; the round-close checks apply unchanged when the next round
    // opens.
    if (state && state.phases.every((unit) => state!.done.has(unit.id))) {
      return refused([`${ref} is already complete (every phase is done)`])
    }
    for (const unit of state?.phases ?? []) {
      if (state!.done.has(unit.id)) continue
      let plan: Plan
      try {
        plan = await loadPlan(dir, unit)
      } catch (error) {
        return refused([`⏸ phase flow blocked: ${error instanceof Error ? error.message : String(error)}`])
      }
      closingPhases.push({ unit, plan, tasks: openTasks(plan, reason) })
    }
    closingTasks = [...closingPhases.flatMap((phase) => phase.tasks)]
  }

  // —— Dirty tree (D20): driver-state leftovers fold into the close commit
  // without asking; anything else needs a change option. ——
  const dirty = await changedFiles(dir)
  const leftovers = dirty.filter((file) => driverStateFile(file))
  const other = dirty.filter((file) => !driverStateFile(file))
  if (other.length && opts.changes !== "commit" && opts.changes !== "stash") {
    return refused([
      "⏸ the worktree has changes beyond the driver's own state files; commit or stash them first, or pass a change option:",
      ...other.map((file) => `  ${file}`),
    ])
  }
  const stashLines: string[] = []
  if (opts.changes === "stash" && dirty.length) {
    const stashed = await stashTree(dir, `opencode-auto close ${ref} ${new Date().toISOString()}`)
    if (stashed.failures.length) {
      return refused(stashed.failures.map((failure) => `⏸ git stash failed (${failure.rel}): ${failure.error}; nothing was closed`))
    }
    stashLines.push(...stashed.stashes.map((stash) => `${stash.rel}: ${stash.line}`))
  }

  // —— Writes (D18): tasks first, then phases in index order. ——
  for (const task of closingTasks) {
    await insertClosedField(join(dir, unitStatePaths(taskRef(task.id)).pending), task.reason)
    await renameUnitDone(dir, taskRef(task.id))
    await tickIndexLine(join(dir, task.index), task.id)
  }
  const handovers: string[] = []
  for (const phase of closingPhases) {
    await insertClosedField(join(dir, unitStatePaths(phaseRef(phase.unit)).pending), reason)
    const handover = phaseHandoverDoc(phase.unit)
    const existing = await Bun.file(join(dir, handover)).text().catch(() => "")
    // A valid handover (the phase was distilled, then a gate held it) is
    // kept; an invalid partial one (an interrupted distillation) is replaced.
    if (!validHandover(existing)) {
      await Bun.write(join(dir, handover), await mechanicalHandover(phase, reason, phaseGates(phase.unit, opts.acceptanceGate), dir))
      handovers.push(handover)
    }
    await renameUnitDone(dir, phaseRef(phase.unit))
    await tickIndexLine(join(dir, "docs", phase.unit.round, PHASE_INDEX_NAME), phase.unit.id)
  }

  // —— Records of closed units cleared (D19); .auto/next-task untouched. ——
  await clearRecords(dir, closingTasks, new Set(closingPhases.map((phase) => qualifiedPhase(phase.unit))))

  // —— The close commit and its check (D21) ——
  // Under "stash" everything dirty went to the stash, leftovers included, so
  // nothing folds into the commit; otherwise the driver-state leftovers fold
  // silently, and "commit" folds the human changes too (listed in the body).
  const folded = opts.changes === "stash" ? [] : [...leftovers, ...(opts.changes === "commit" ? other : [])]
  const body = closeBody(
    closingTasks,
    closingPhases.map((phase) => ({ ref: qualifiedPhase(phase.unit), gates: phaseGates(phase.unit, opts.acceptanceGate) })),
    folded,
    stashLines,
  )
  const lines: string[] = []
  for (const task of closingTasks) {
    // A cascaded task's reason already carries its "(cascade from …)" mark.
    lines.push(`✓ closed ${task.id}: ${task.reason}`)
  }
  for (const stash of stashLines) lines.push(`↻ stashed changes (${stash})`)
  for (const phase of closingPhases) {
    lines.push(`✓ closed ${qualifiedPhase(phase.unit)} ${phase.unit.type}: ${reason}`)
  }
  for (const handover of handovers) lines.push(`ℹ mechanical handover written: ${handover}`)
  if (ownerPlan) {
    for (const note of implicitDependentNotes(ownerPlan, new Set(closingTasks.map((task) => task.id)))) lines.push(note)
  }
  if (roundMatch) lines.push(`✓ round ${roundDirName(round)} counts as complete (its open phases were closed above)`)
  lines.push("⚠ closed units skip the unit-close reference scan; the whole-tree scan at round close still applies")

  if (!(await repoRoots(dir)).length) {
    lines.push("ℹ not a git repository: the closing changes are written but not committed")
    return { type: "closed", lines }
  }
  const baseline = await unitBaseline(dir)
  const committed = await commitTree(dir, { id: ref, title: `${ref} closed: ${reason}` }, { stage: "force-close", subject: `${ref} closed: ${reason}`, body })
  if (!committed.ok) {
    return {
      type: "failed",
      lines: [
        ...lines,
        `⏸ the close commit failed: ${committed.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. ` +
          `The units are already marked closed in the worktree; commit the closing changes (or revert them) manually, then re-run`,
      ],
    }
  }
  const violations = await unitViolations(dir, baseline)
  if (violations.length) {
    return { type: "failed", lines: [...lines, `⏸ the close commit landed but the close-out check failed: ${violations.join("; ")}`] }
  }
  const { bin } = shellProfile()
  lines.push(`to undo before anything else runs: git revert ${await headSha(dir)}`)
  lines.push(`next: ${bin} run ${dir} to continue, or ${bin} plan ${dir}`)
  return { type: "closed", lines }
}

// The open tasks of a phase being closed with it (D18).
function openTasks(plan: Plan, reason: string): ClosingTask[] {
  return plan.tasks
    .filter((task) => task.status !== "done")
    .map((task) => ({ id: task.id, title: task.title, reason, index: plan.index }))
}

// The closing set of a task target (D17): the task, plus — with cascade —
// every open task of the same index whose explicit `Depends:` list names a
// closing unit, repeated to a fixpoint. Without cascade, each such dependent
// refuses the close. Only the target's own index can hold them: a later
// phase's tasks do not exist yet, and `Depends:` may name a task of another
// phase only once that task is done.
function taskClosingSet(plan: Plan, id: string, opts: CloseOptions): { tasks: ClosingTask[] } | { type: "refused"; lines: string[] } {
  const reason = opts.reason.trim()
  const inSet = new Set([id])
  const cascadeFrom = new Map<string, string>()
  const dependentOf = (task: Task): string | undefined =>
    Array.isArray(task.depends) ? task.depends.find((dep) => inSet.has(dep)) : undefined
  if (opts.cascade) {
    for (let changed = true; changed; ) {
      changed = false
      for (const task of plan.tasks) {
        if (task.status === "done" || inSet.has(task.id)) continue
        const hit = dependentOf(task)
        if (hit) {
          inSet.add(task.id)
          cascadeFrom.set(task.id, hit)
          changed = true
        }
      }
    }
  } else {
    const blockers: string[] = []
    for (const task of plan.tasks) {
      if (task.status === "done" || inSet.has(task.id)) continue
      const hit = dependentOf(task)
      if (hit) blockers.push(`${task.id} depends on ${hit} (Depends:); pass --cascade to close it too, or change its Depends: first`)
    }
    if (blockers.length) return { type: "refused", lines: blockers }
  }
  return {
    tasks: plan.tasks
      .filter((task) => inSet.has(task.id))
      .map((task) => ({
        id: task.id,
        title: task.title,
        reason: cascadeFrom.has(task.id) ? `${reason} (cascade from ${cascadeFrom.get(task.id)})` : reason,
        index: plan.index,
        ...(cascadeFrom.has(task.id) ? { cascadeFrom: cascadeFrom.get(task.id)! } : {}),
      })),
  }
}

// A missing `Depends:` means the previous sibling (G3), so the index entry
// right after a closed task is its implicit dependent: satisfied (D17), but
// named in the output so nobody assumes the prerequisite was delivered.
function implicitDependentNotes(plan: Plan, closed: Set<string>): string[] {
  const notes: string[] = []
  plan.tasks.forEach((task, i) => {
    if (!closed.has(task.id)) return
    const next = plan.tasks[i + 1]
    if (!next || next.depends !== undefined || next.status === "done" || closed.has(next.id)) return
    notes.push(`ℹ ${next.id} has no Depends: field, so its prerequisite ${task.id} counts as satisfied; do not assume ${task.id}'s deliverables exist`)
  })
  return notes
}

// The round whose task index lists the id, other than the current round
// (undefined when no other round lists it).
async function listedRound(dir: string, id: string, round: number): Promise<string | undefined> {
  for await (const file of new Bun.Glob(join("docs", "R-*", "P*", "tasks.md")).scan({ cwd: dir, onlyFiles: true })) {
    const roundName = file.split(/[\\/]/)[1]!
    if (roundName === roundDirName(round)) continue
    const text = await Bun.file(join(dir, file)).text().catch(() => "")
    if (parseIndex(text, "task").entries.some((entry) => entry.id === id)) return roundName
  }
  return undefined
}

// Insert `Closed: <reason>` as the last line of the unit document's field
// block; with no field block it goes after the title line and its blank
// lines, which makes it the block (D18). The scan mirrors parseUnitDoc
// (document/unit.ts).
async function insertClosedField(file: string, reason: string): Promise<void> {
  const lines = (await Bun.file(file).text()).split("\n")
  let i = 0
  if (/^#\s/.test(lines[0]?.trim() ?? "")) {
    i = 1
    while (i < lines.length && lines[i]!.trim() === "") i++
  }
  while (i < lines.length && /^[A-Za-z][A-Za-z-]*:/.test(lines[i]!.trim())) i++
  lines.splice(i, 0, `Closed: ${reason}`)
  await Bun.write(file, lines.join("\n"))
}

// The driver-written handover of a closed phase (D18): driver text, not an
// overridable template, with the four mandatory sections so validHandover
// passes and the phase directory keeps its archive shape. A distillation
// session must not run for a closed phase — it would have to pass the very
// gates the closure skips.
// AUTO-DECISION: no eof terminator — the handoff role carries its own
// final-state contract (the four sections) and is exempt from the eof scan
// (document/roles.ts), so the terminator would be pure noise; driver-written
// state files (the indexes, CURRENT.md) never carry one either.
async function mechanicalHandover(phase: ClosingPhase, reason: string, gates: readonly PhaseGate[], dir: string): Promise<string> {
  const closedIds = new Set(phase.tasks.map((task) => task.id))
  const done = phase.plan.tasks.filter((task) => task.status === "done" && !closedIds.has(task.id))
  const closed = phase.tasks
  const bullets = (items: string[]): string => (items.length ? items : ["- (none)"]).join("\n")
  const reports: string[] = []
  for (const task of done) {
    if (await Bun.file(join(dir, taskDoc(task.id, "report"))).exists()) reports.push(`- docs/${task.id}/report.md`)
  }
  return [
    `# Handover (${qualifiedPhase(phase.unit)} ${phase.unit.type}) — closed, not completed`,
    "",
    `Driver-written mechanical handover: this phase was closed with reason "${reason}" instead of`,
    "completing. No distillation session ran; the phase gates below were skipped, not checked.",
    "",
    "## Key decisions",
    "",
    bullets([
      `- The phase was closed, not completed. Reason: ${reason}.`,
      ...done.map((task) => `- Done task ${task.id}: ${task.title}`),
      ...closed.map((task) => `- Closed task ${task.id}: ${task.title} — closed without completing: ${task.reason}`),
    ]),
    "",
    "## Constraints and pitfalls",
    "",
    bullets([
      ...closed.map((task) => `- Closed task ${task.id} did not deliver its acceptance criteria; do not assume its deliverables exist.`),
      `- The phase's gates were skipped, not checked: ${gates.length ? gates.join(", ") : "(none)"}.`,
    ]),
    "",
    "## Required reading for the next phase",
    "",
    bullets(
      phase.plan.tasks.map((task) => {
        const closing = phase.tasks.find((item) => item.id === task.id)
        return closing ? `- docs/${task.id}/ (closed: ${closing.reason})` : `- docs/${task.id}/ (done)`
      }),
    ),
    "",
    "## Artifact index",
    "",
    bullets(reports),
    "",
  ].join("\n")
}

// The close commit's body (D21): every unit closed (cascade marked), each
// phase's skipped gates, and the folded files or stash names.
function closeBody(
  tasks: readonly ClosingTask[],
  phases: readonly { ref: string; gates: readonly PhaseGate[] }[],
  folded: readonly string[],
  stashes: readonly string[],
): string {
  const parts: string[] = ["Units closed:"]
  for (const task of tasks) parts.push(`- ${task.id}${task.cascadeFrom ? ` (cascade from ${task.cascadeFrom})` : ""}`)
  for (const phase of phases) {
    parts.push(`- ${phase.ref} (gates skipped: ${phase.gates.length ? phase.gates.join(", ") : "none"})`)
  }
  if (folded.length) {
    parts.push("", "Changes folded into this commit:")
    for (const file of folded) parts.push(`- ${file}`)
  }
  if (stashes.length) {
    parts.push("", "Changes stashed before closing:")
    for (const stash of stashes) parts.push(`- ${stash}`)
  }
  return parts.join("\n")
}

// Clear the resumable records of the closed units only (D19): these records
// resume their own unit, and closing another unit does not change what that
// unit's session knows. .auto/next-task is untouched (closed ids are never
// reused).
async function clearRecords(dir: string, tasks: readonly ClosingTask[], closedPhases: ReadonlySet<string>): Promise<void> {
  const ids = tasks.map((task) => task.id)

  await forgetUnits(dir, ids)

  const progress = await peekProgress(dir)
  if (progress) {
    const stepUnit = progress.phase?.kind === "step" ? progress.phase.unit : undefined
    if (ids.includes(progress.task) || (stepUnit !== undefined && closedPhases.has(stepUnit))) {
      await forgetProgress(dir)
    }
  }

  for (const id of ids) {
    if (await peekHandover(dir, id)) {
      await forgetHandover(dir)
      break
    }
  }

  // The session handover and the test-handover chains of the closed tasks,
  // task and subtask level, removed the way task completion removes them; the
  // deletions of the tracked files land in the close commit.
  for (const id of ids) {
    await rm(join(dir, taskDoc(id, "handoff")), { force: true })
    await removeHandoffChain(dir, taskDoc(id, "testhandoff"))
    const entries = await readdir(join(dir, "docs", id), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isDirectory() && /^S\d{2,}$/.test(entry.name)) {
        await removeHandoffChain(dir, join("docs", id, entry.name, "testhandoff.md"))
      }
    }
  }

  // CURRENT.md names its task on the third line (`## T-NNN: <title> […]`).
  const current = await Bun.file(join(dir, "CURRENT.md")).text().catch(() => undefined)
  if (current !== undefined) {
    const named = /^## (T-\d+):/.exec(current.split("\n")[2] ?? "")?.[1]
    if (named !== undefined && ids.includes(named)) await removeCurrent(dir)
  }
}
