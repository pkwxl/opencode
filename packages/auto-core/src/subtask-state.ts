// Subtask-directory state protocol (M1.0, plans/0030-subtask-loop-entry-design.md):
// the merged understand+decompose session writes docs/T-NNN/S<nn>/todo.md (scope
// statement + artifact list) per subtask; on completion DRIVER renames it to
// done.md inside the unit commit boundary. File existence is the authoritative
// progress fact (state grounding — checklist ticks in PLAN.md follow the files,
// never the other way around).
//
// Spec-driven since M1.4 (plans/0034 D6): the protocol's state semantics,
// existence checks and illegal-state detection all consume the state-file spec
// pair declared once in document/spec.ts (subtaskStateSpec) — this module holds
// the protocol logic, the file names/anchors/labels live in the spec data.
//
// Activation: the protocol is active for a task iff ANY todo/done file exists
// among its subtask directories. Legacy tasks (decomposed before this protocol,
// human-written checklists, off/ondemand modes) have none and keep checklist
// semantics unchanged (compatible read, plan D4).
//
// Illegal states (active protocol): both files present (ambiguous) or neither
// present (drift) for a subtask — detected at the subtask loop entry and
// surfaced as blocked for human attention.
//
// Interruption windows around the rename are absorbed by idempotency: the
// rename is skipped when done.md already exists, and runSubtask short-circuits
// to close-out when done.md is present at entry.
import { mkdir, rename } from "node:fs/promises"
import { dirname, join } from "node:path"
import { EOF_MARK } from "./doccheck"
import { SUBTASK_TODO_SECTIONS, subtaskStateSpec } from "./document/spec"

export type SubtaskState = { index: number; todo: boolean; done: boolean }

export type SubtaskStateScan = {
  // true once any state file exists for the task's subtask range.
  active: boolean
  states: SubtaskState[]
  // Active-protocol violations: both files or neither file for a subtask.
  illegal: { index: number; kind: "both" | "neither" }[]
}

const exists = async (dir: string, rel: string): Promise<boolean> => Bun.file(join(dir, rel)).exists()

// Scans docs/T-NNN/S<nn>/ for k = 1..count and classifies each subtask.
export async function scanSubtaskStates(dir: string, taskId: string, count: number): Promise<SubtaskStateScan> {
  const states: SubtaskState[] = []
  for (let k = 1; k <= count; k++) {
    const spec = subtaskStateSpec(taskId, k)
    states.push({
      index: k,
      todo: await exists(dir, spec.pending.path),
      done: await exists(dir, spec.complete.path),
    })
  }
  const active = states.some((s) => s.todo || s.done)
  const illegal: SubtaskStateScan["illegal"] = active
    ? states.flatMap((s): SubtaskStateScan["illegal"] =>
        s.todo && s.done ? [{ index: s.index, kind: "both" }] : !s.todo && !s.done ? [{ index: s.index, kind: "neither" }] : [],
      )
    : []
  return { active, states, illegal }
}

// Effective done flags for the checklist: with the protocol active, done.md
// existence overrides the PLAN.md tick (files are the progress fact). Illegal
// states (reported via the scan's illegal list) degrade gracefully here:
// both → done, neither → the PLAN.md tick.
export function effectiveDone(scan: SubtaskStateScan, items: { done: boolean }[]): boolean[] {
  if (!scan.active) return items.map((item) => item.done)
  return items.map((item, i) => {
    const s = scan.states[i]
    if (!s) return item.done
    return s.done || (s.todo ? false : item.done)
  })
}

// DRIVER close-out rename (idempotent): todo.md → done.md. Skipped silently
// when the protocol is inactive for this subtask (no todo.md) or the rename
// already landed (done.md present — interruption between rename and commit).
export async function renameTodoToDone(dir: string, taskId: string, index: number): Promise<void> {
  const spec = subtaskStateSpec(taskId, index)
  const todo = join(dir, spec.pending.path)
  const done = join(dir, spec.complete.path)
  if (!(await Bun.file(todo).exists()) || (await Bun.file(done).exists())) return
  await rename(todo, done)
}
