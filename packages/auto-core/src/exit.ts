// /exit graceful exit (design document plans/0014-exit-resume-design.md): the
// --interactive resident input line sets the flag when it recognizes /exit;
// the three existing step-mode safe boundaries (phase/task/subtask, hook
// points as in step.ts) are probed one by one, and the first hit throws
// ExitRequested at that safe landing point — by then the task unit files and
// .auto/progress.json have already been written by that boundary's own
// regular close-out (a scene fully isomorphic to a real crash/kill
// interruption at the same spot), so no extra save action is needed; the next
// run resumes precisely from the persisted progress.
import type { Boundary } from "./step"

// One-shot flag per process (each CLI call is its own process, so it resets
// naturally).
let pending = false

export function requestExit(): void {
  pending = true
}

export function exitRequested(): boolean {
  return pending
}

// For unit-test resets only (bun test runs many test files in one process;
// module-level state lingers across files).
export function resetExitRequest(): void {
  pending = false
}

export class ExitRequested extends Error {
  constructor(
    readonly boundary: Boundary,
    readonly label: string,
  ) {
    super(`/exit took effect at the ${label} boundary`)
  }
}

// The checkpoint shared by the three step-mode safe boundaries, triggered
// right after the stepPause call: a hit throws, and runAll at the top of
// loop.ts catches it uniformly and converts it to exit code 3 (not occupying
// Outcome's blocked/incomplete channels — those two channels mean human
// attention is needed, which /exit does not).
export function maybeExit(boundary: Boundary, label: string): void {
  if (pending) throw new ExitRequested(boundary, label)
}
