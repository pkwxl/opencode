// /exit graceful exit (design document plans/0014-exit-resume-design.md): the
// --interactive resident input line sets the flag when it recognizes /exit;
// the three existing step-mode safe boundaries (phase/task/subtask, hook
// points as in step.ts) are probed one by one, and the first hit throws
// ExitRequested at that safe landing point — by then the task unit files and
// .auto/progress.json have already been written by that boundary's own
// regular close-out (a scene fully isomorphic to a real crash/kill
// interruption at the same spot), so no extra save action is needed; the next
// run resumes precisely from the persisted progress.
// The wait-and-probe loop's sleep is a fourth boundary (plans/0057 §6, §11
// item 9): no session is active there, and a known multi-hour wait is when an
// operator most wants to stop cleanly. requestExit wakes it at once
// (sleepUnlessExit); the loop records the session its recovery would have
// continued before it throws.
import type { Boundary } from "./control-types"

// One-shot flag per process (each CLI call is its own process, so it resets
// naturally).
let pending = false

// The sleeps that end on /exit (sleepUnlessExit), woken by requestExit.
const sleepers = new Set<() => void>()

export function requestExit(): void {
  pending = true
  for (const wake of [...sleepers]) wake()
}

export function exitRequested(): boolean {
  return pending
}

// For unit-test resets only (bun test runs many test files in one process;
// module-level state lingers across files).
export function resetExitRequest(): void {
  pending = false
}

// A sleep that is a pause boundary: it ends early when /exit is requested —
// at once when it already was — and resolves true if it did, false when it
// slept its full length. sleep is injected for unit tests; an injected sleep
// cannot be cut short, so the race stops waiting on it instead.
export async function sleepUnlessExit(ms: number, sleep?: (ms: number) => Promise<void>): Promise<boolean> {
  if (pending) return true
  let timer: ReturnType<typeof setTimeout> | undefined
  let wake = () => {}
  const exited = new Promise<boolean>((resolve) => {
    wake = () => resolve(true)
    sleepers.add(wake)
  })
  const slept =
    sleep !== undefined
      ? sleep(ms).then(() => false)
      : new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), ms)
        })
  try {
    return await Promise.race([slept, exited])
  } finally {
    clearTimeout(timer)
    sleepers.delete(wake)
  }
}

// The boundary an /exit took effect at: a step-mode boundary, or the
// wait-and-probe loop's sleep ("wait").
export class ExitRequested extends Error {
  constructor(
    readonly boundary: Boundary | "wait",
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
