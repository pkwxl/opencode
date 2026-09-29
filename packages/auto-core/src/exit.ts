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
// This module is also the control service's home: the request and its
// sleepers are one run-wide service instance on the services holder (the
// Control type and createControl() at the file's end) — see the bridge
// note there for how the state and the free functions coexist while the
// callers convert.
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

// —— The control service ——
// This module is the service's home (the way router.ts is the router's):
// createControl() builds the run's instance, the holder in services.ts
// carries it as RunServices.control and the system clock's sleepUnlessExit
// delegates to the same instance. The entry modules read it through the
// services, and everything below them receives it as data beside the
// router — those carrier reads land with the caller conversion.
//
// The methods keep the names and signatures of the free functions above,
// so the move reads as a move.
export type Control = {
  requestExit(): void
  exitRequested(): boolean
  sleepUnlessExit(ms: number, sleep?: (ms: number) => Promise<void>): Promise<boolean>
  maybeExit(boundary: Boundary, label: string): void
}

// AUTO-DECISION: createControl() delegates to the module-level free functions instead of closing over its own state (the in-unit conversion crutch: every caller still on the free functions — the /exit handler, the boundary sites, the tests — must stay green while the callers convert slice by slice, and a second flag would let instance and free-function reads diverge). The state moves into the closure and the free functions — with the test reset hook — are deleted in this unit's last slice, which also removes this bridge.
export function createControl(): Control {
  return {
    requestExit,
    exitRequested,
    sleepUnlessExit,
    maybeExit,
  }
}
