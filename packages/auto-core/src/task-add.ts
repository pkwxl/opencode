// Adding one task by hand — the no-session half of append planning
// (plans/0053 D23's scope): the person already knows the task, and the driver
// does what a planning session would otherwise be spawned for: allocate the
// next task number, write docs/T-NNN/todo.md in the mandatory task-document
// shape, append the index line (or create the index), drop a stale handover,
// and commit. Called from plan's prelude (src/plan.ts) under the run lock; it
// starts no session, writes no resume record, and never imports the loop or
// the session-driving layer.
//
// The task document the driver writes is deliberately minimal and honest
// about its provenance: the title doubles as the Goal, and Scope /
// Acceptance say they were left unrestricted by `plan --new-task` — nothing
// is fabricated to look planned. The stop lines after the add point the
// person at docs/T-NNN/todo.md to sharpen it before run.
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { beginUnit, commitTree } from "./git"
import { advanceNextTask, readNextTask, taskNumberFloor } from "./numbering"
import { phaseHandoverDoc, phaseLabel, phaseName, type PhaseUnit } from "./phases"
import { qualifiedPhase, renderTaskIndex, renderTaskTodo, taskIndexPath, taskStatePaths } from "./tasks"

export type AddedTask =
  | { type: "added"; id: string; index: string; handoverRemoved?: string }
  | { type: "dirty"; files: string[] }
  | { type: "failed"; question: string }

// The next task number (the id is T-NNN, zero-padded to three). Without
// autoNumber it is the deterministic floor (the highest number any index
// lists or any docs/T-* directory holds, + 1 — append planning's rule for a
// missing record, plans/0053 D25). With it, the record leads but never below
// the floor, so a hand-edited or stale record cannot collide with the disk.
// AUTO-DECISION: a missing record is never recovered here — the recovery is
// an AI session over git history and this path starts none. The floor alone
// picks the number (it is safe against everything on disk), the record is
// left missing for the next planning session to recover properly, and it is
// advanced afterwards only where it already existed or the floor proves a
// brand-new project (1), the two states where advancing writes no guess.
function nextNumber(dir: string, autoNumber: boolean): Promise<{ n: number; recordExisted: boolean }> {
  return (async () => {
    const floor = await taskNumberFloor(dir)
    const record = autoNumber ? await readNextTask(dir) : undefined
    return { n: Math.max(record ?? 0, floor), recordExisted: record !== undefined }
  })()
}

export async function addTask(dir: string, phase: PhaseUnit, title: string, opts: { autoNumber?: boolean } = {}): Promise<AddedTask> {
  const phaseText = `${phaseLabel(phase)} ${phaseName(phase)}`
  const task = { id: "PLAN", title: `task add (${phaseText})` }
  // The unit-start gate every planning-side write shares (savePlanInput's):
  // driver-state leftovers self-heal, anything else is dirty for the human.
  const gate = await beginUnit(dir, {}, task)
  if (gate.type === "dirty") return gate
  const { n, recordExisted } = await nextNumber(dir, Boolean(opts.autoNumber))
  const id = `T-${String(n).padStart(3, "0")}`
  // The stale handover (plans/0053 D25/F13) goes first, in its own commit: a
  // phase that was already distilled would archive the handover unchanged
  // while the new task runs. First — unlike appendPlan, which removes it
  // after the append unit — because this path has no resume record: a kill
  // between two commits must leave a state a plain re-run completes, and
  // removal-first means the retry cannot add the task twice. A failed
  // removal commit aborts with nothing added.
  const handover = phaseHandoverDoc(phase)
  let handoverRemoved: string | undefined
  if (await Bun.file(join(dir, handover)).exists()) {
    await rm(join(dir, handover))
    const settled = await commitTree(dir, task, { stage: "task-add", subject: `PLAN add ${id}: remove the stale handover` })
    if (!settled.ok) {
      return {
        type: "failed",
        question: `stale-handover removal commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. ` +
          `Nothing was added; the deletion is kept in the worktree — commit manually and re-run`,
      }
    }
    handoverRemoved = handover
  }
  // The task document and the index line, one commit: docs/T-NNN/todo.md
  // through the same renderer the fixtures use (title line, `Phase:` field,
  // the three sections, the eof terminator), and the index appended after
  // the existing lines without touching them — the append contract, done by
  // construction.
  const paths = taskStatePaths(id)
  await mkdir(join(dir, "docs", id), { recursive: true })
  await Bun.write(join(dir, paths.pending), renderTaskTodo({ id, title, phase: qualifiedPhase(phase), goal: title, scope: SCOPE_NOTE, acceptance: ACCEPTANCE_NOTE }))
  const index = taskIndexPath(phase)
  const indexFile = join(dir, index)
  const current = await Bun.file(indexFile).text().catch(() => undefined)
  const line = `- [ ] ${id} ${title}`
  await Bun.write(
    indexFile,
    current === undefined ? renderTaskIndex(qualifiedPhase(phase), [{ id, title }]) : current.endsWith("\n") ? `${current}${line}\n` : `${current}\n${line}\n`,
  )
  const settled = await commitTree(dir, task, { stage: "task-add", subject: `PLAN add ${id} ${title}` })
  if (!settled.ok) {
    return {
      type: "failed",
      question: `task-add commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. ` +
        `The task is left in the worktree; commit manually — a re-run would add it again`,
    }
  }
  if (opts.autoNumber && (recordExisted || n === 1)) await advanceNextTask(dir, [id])
  return { type: "added", id, index, ...(handoverRemoved !== undefined ? { handoverRemoved } : {}) }
}

// The provenance notes of a hand-added task's Scope / Acceptance sections:
// they state honestly that the person restricted neither, so nothing looks
// planned that was not (the Goal is the title itself).
const SCOPE_NOTE = "Added by `plan --new-task`: nothing restricted here — narrow it before `run` if needed."
const ACCEPTANCE_NOTE = "Added by `plan --new-task`: judged by this task's report `Result:` line — pin criteria here if needed."
