import { join } from "node:path"
import { parseIndex } from "./document/unit"

// The --auto-number (config.autoNumber) task-numbering derivation: task
// numbers (T-NNN) never repeat among the target directory's surviving task
// artifacts, and the next available number is derived on demand from exactly
// those artifacts — the highest number any task index lists or any docs/T-*
// path holds, + 1. No record is kept: the former .auto/next-task record and
// its AI recovery session are retired (plans/0150, amending 0001). A derived
// number cannot be stale, cannot survive its evidence, and a fresh clone or
// fork worktree starts exactly where its own files say — a forked branch
// continues the baseline's numbering, so parallel forks assign the same
// numbers to the same logical tasks and stay comparable (the record-recovery
// session read git history across every sibling timeline of the shared
// repository and ratcheted each new fork past numbers only other forks had
// used). A number whose artifacts were deleted becomes available again: docs
// are write-once and permanent by design (0010), so deleting one is off
// protocol, and a full restart already re-issues from T-001 (the floor-1
// shortcut predates 0150; 0140 ruled downstream machinery corpus-bounded for
// re-issued ids). Under --no-auto-number (the opt-out switch) planning
// sessions get no enforced numbering start — the historical shape, unchanged.
//
// Concurrency: the derivation needs no queue — during a task loop only a
// formulation unit's collect validates new numbers (runner.ts), a phase holds
// at most one formulation unit (its first task unit), and every other
// derivation belongs to planning-time moments the phase loop owns before or
// after the loop, never beside a doc lane.

// Task-number extraction: only the T-<digits-only> form counts (final-audit
// ids like T-F are a separate derivation namespace, not part of the auto
// numbering).
export function taskNumber(id: string): number | undefined {
  const match = /^T-(\d+)$/.exec(id)
  return match ? Number(match[1]) : undefined
}

// The next available task number: scan every round's and phase's task
// indexes (docs/R-*/P*/tasks.md, M3.4) and task directories (path segments of
// docs/**/T-*/*.md — the task units' todo.md/done.md live right there), take
// the maximum number + 1; no evidence = 1. Sees only surviving files — the
// whole mechanism (0150: what is deleted is forgotten, by rule).
export async function taskNumberFloor(dir: string): Promise<number> {
  let max = 0
  const seen = (id: string) => {
    const n = taskNumber(id)
    if (n !== undefined) max = Math.max(max, n)
  }
  for await (const file of new Bun.Glob(join("docs", "R-*", "P*", "tasks.md")).scan({ cwd: dir, onlyFiles: true })) {
    const text = await Bun.file(join(dir, file)).text().catch(() => "")
    for (const entry of parseIndex(text, "task").entries) seen(entry.id)
  }
  // Directory-layout: docs/**/T-*/*.md, take the first T-<digits-only> path
  // segment (a T-F<k> anchor segment is filtered out naturally by taskNumber).
  for await (const file of new Bun.Glob(join("docs", "**", "T-*", "*.md")).scan({ cwd: dir, onlyFiles: true })) {
    for (const segment of file.split(/[\\/]/)) {
      if (/^T-\d+$/.test(segment)) {
        seen(segment)
        break
      }
    }
  }
  return max + 1
}
