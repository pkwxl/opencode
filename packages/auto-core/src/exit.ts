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
// sleepers are one run-wide service instance on the services holder —
// createControl() below builds it, services.ts carries it as RunServices.control
// and the system clock's sleepUnlessExit delegates to the same instance. The
// entry modules read it through the services, and everything below them
// receives it as data beside the router.
import type { Boundary } from "./control-types"

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

// —— The control service ——
// The method names and signatures are the ones the module's former free
// functions had, so the state move reads as a move.
export type Control = {
  requestExit(): void
  exitRequested(): boolean
  sleepUnlessExit(ms: number, sleep?: (ms: number) => Promise<void>): Promise<boolean>
  maybeExit(boundary: Boundary, label: string): void
}

// One instance per run (the holder built at the run start): the request flag
// and its sleepers are the instance's own closure state, so one holder's /exit
// never leaks into another in the same process — and the test suite's fresh
// services per test start every test with the flag unset, which is why there
// is deliberately no reset method: a fresh instance is the reset.
export function createControl(): Control {
  // One-shot flag (each CLI call is its own process and its own run, so it
  // resets naturally).
  let pending = false
  // The sleeps that end on /exit (sleepUnlessExit), woken by requestExit.
  const sleepers = new Set<() => void>()
  return {
    requestExit() {
      pending = true
      for (const wake of [...sleepers]) wake()
    },
    exitRequested() {
      return pending
    },
    // A sleep that is a pause boundary: it ends early when /exit is requested
    // — at once when it already was — and resolves true if it did, false when
    // it slept its full length. sleep is injected for unit tests; an injected
    // sleep cannot be cut short, so the race stops waiting on it instead.
    async sleepUnlessExit(ms, sleep) {
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
    },
    // The checkpoint shared by the three step-mode safe boundaries, triggered
    // right after the stepPause call: a hit throws, and runAll at the top of
    // loop.ts catches it uniformly and converts it to exit code 3 (not
    // occupying Outcome's blocked/incomplete channels — those two channels
    // mean human attention is needed, which /exit does not).
    maybeExit(boundary, label) {
      if (pending) throw new ExitRequested(boundary, label)
    },
  }
}
