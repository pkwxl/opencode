// Document domain — the subtask-directory state protocol (M1.0,
// plans/0030-subtask-loop-entry-design.md; moved from src/subtask-state.ts in
// M2.3, plans/0045): the merged understand+decompose session writes
// docs/T-NNN/S<nn>/todo.md (scope statement + artifact list) per subtask; on
// completion DRIVER renames it to done.md inside the unit commit boundary. File
// existence is the authoritative progress fact (state grounding — checklist
// ticks in subtasks.md follow the files, never the other way around).
//
// Role model (M2.3): both files play the `artifact` role — their *content* is
// the decompose session's scope statement, shape-checked once at creation and
// carried over unchanged by the rename. The *state* is not a role: it is which
// of the pair exists, and this module is its only interpreter. The file names,
// anchors and labels come from the spec pair declared once in document/spec.ts
// (subtaskStateSpec, M1.4 D6); its paths equal the unit model's state paths
// (asserted in test/document-unit.test.ts).
//
// Activation: the protocol is active for a task iff ANY todo/done file exists
// among its subtask directories. Legacy tasks (decomposed before this protocol,
// human-written checklists, off/auto/ondemand modes) have none and keep checklist
// semantics unchanged (compatible read, plan D4).
//
// Illegal states (active protocol): both files present (ambiguous) or neither
// present (drift) for a subtask — detected at the subtask loop entry and
// surfaced as blocked for human attention.
//
// Interruption windows around the rename are absorbed by idempotency: the
// rename is skipped when done.md already exists, and runSubtask short-circuits
// to close-out when done.md is present at entry.
//
// Since M3.1 (plans/0047) the scan and the rename are the subtask level of the
// unified unit model (document/unit.ts scanUnitStates / renameUnitDone); this
// module keeps the subtask-specific activation rule and checklist merge.
//
// Dependencies (M3.5, plans/0047 §7): a subtask's id is its position — item n
// of subtasks.md is S<nn> (the decompose template's established mapping), so
// the checklist lines carry no ids. Its `Depends:` / `Touches:` fields sit at
// the top of S<nn>/todo.md (a subtask scope file has no title line), and
// selection is nextReady over the positional ids; without fields the default
// serial order is the old "first unticked item".
import { nextReady, renameUnitDone, scanUnitStates, unitProblems, type UnitDecl, type UnitRef } from "./unit"

export type SubtaskState = { index: number; todo: boolean; done: boolean }

// Positional subtask id of the 1-based item n: S01, S02, …
export const subtaskId = (n: number): string => `S${String(n).padStart(2, "0")}`

// A checklist item as dependency selection sees it.
export type DeclaredItem = { done: boolean; depends?: string[] | "none"; touches?: string[] }

const checklistDecls = (items: readonly DeclaredItem[]): UnitDecl[] =>
  items.map((item, i) => ({
    id: subtaskId(i + 1),
    ...(item.depends !== undefined ? { depends: item.depends } : {}),
    ...(item.touches !== undefined ? { touches: item.touches } : {}),
  }))

// 0-based index of the next subtask to run (nextReady over the positional
// ids); -1 = nothing ready (all done, or a dependency problem that
// checklistProblems reports).
export function nextChecklistIndex(items: readonly DeclaredItem[]): number {
  const done = new Set(items.flatMap((item, i) => (item.done ? [subtaskId(i + 1)] : [])))
  const id = nextReady(checklistDecls(items), done)
  return id === undefined ? -1 : Number(id.slice(1)) - 1
}

// Dependency problems of a task's subtasks (G4, subtask scope: S<nn> within
// the task only).
export function checklistProblems(items: readonly DeclaredItem[]): string[] {
  return unitProblems("subtask", checklistDecls(items))
}

export type SubtaskStateScan = {
  // true once any state file exists for the task's subtask range.
  active: boolean
  states: SubtaskState[]
  // Active-protocol violations: both files or neither file for a subtask.
  illegal: { index: number; kind: "both" | "neither" }[]
}

const subtaskRef = (taskId: string, k: number): UnitRef => ({ level: "subtask", id: subtaskId(k), task: taskId })

// Scans docs/T-NNN/S<nn>/ for k = 1..count and classifies each subtask.
export async function scanSubtaskStates(dir: string, taskId: string, count: number): Promise<SubtaskStateScan> {
  const scan = await scanUnitStates(
    dir,
    Array.from({ length: count }, (_, i) => subtaskRef(taskId, i + 1)),
  )
  const states: SubtaskState[] = scan.states.map((s, i) => ({
    index: i + 1,
    todo: s.state === "todo" || s.state === "both",
    done: s.state === "done" || s.state === "both",
  }))
  const active = states.some((s) => s.todo || s.done)
  const illegal: SubtaskStateScan["illegal"] = active
    ? scan.states.flatMap((s, i): SubtaskStateScan["illegal"] =>
        s.state === "both" || s.state === "neither" ? [{ index: i + 1, kind: s.state }] : [],
      )
    : []
  return { active, states, illegal }
}

// Effective done flags for the checklist: with the protocol active, done.md
// existence overrides the subtasks.md tick (files are the progress fact). Illegal
// states (reported via the scan's illegal list) degrade gracefully here:
// both → done, neither → the subtasks.md tick.
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
  await renameUnitDone(dir, subtaskRef(taskId, index))
}
