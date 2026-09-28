// The run's service holder (the consolidation's services stage): one
// constructed object for the run-wide decision state that today lives in
// module singletons. It carries the `Clock` — the one time source the
// session-driving engine (watch, attempt, session) and the process-level
// time keepers (the stats module) read — and the `Router` — the decision
// state of routing and recovery: the failback holders (sticky, the pending
// /failback order, the run-time model-order override), the down marks, the
// logged usage windows, the model-step cache claims and the key rings (the
// classifier's state joins the router with its own change). The remaining
// members join with the changes that move their state in: `control` (the
// /exit request and its sleepers) and `git` (the commit-side seam the
// kernel and engine call) — the placeholders are the documented absence,
// not dead fields.
//
// Construction happens at the run start (preflight), in a written order:
// the registry loads and feeds the switches (setSwitchModelRegistry) ahead
// of their first parse; the agent fleet then starts and its degradation
// clamp lands on the parsed switches; the switch snapshot freezes after the
// clamp (the run's switches are read-only from there); the router, control
// and git services read the registry and the frozen switches after the
// freeze. runAll installs the holder for the run and uninstalls it in its
// finally, so a run's services never leak into the next.
//
// One run per process is an existing invariant (one driver, one directory,
// one lock), so the holder is reached through an installed ambient instance
// rather than threaded as a parameter: the engine's positional entry points
// stay stable. The ambient accessor `services()` is allowed only in the
// modules listed in SERVICE_ENTRIES — an allowlist that may only shrink.
// Process-level file mirrors (the stats handles, the tasks queue, the
// quota-window cache, the lock, the log) stay modules by design; the holder
// wires the ones that need the clock when an instance takes effect.
import { sleepUnlessExit } from "./exit"
import { createRouter, type Router } from "./router"
import { useStatsClock } from "./stats"

// The run's one time source. `sleep` is deliberately not interruptible by
// /exit (the backoff before a retry keeps its full length); the sleeps that
// are safe /exit boundaries go through `sleepUnlessExit`, which resolves
// true when /exit cut them short. `timer` schedules `fn` after `ms` and
// returns its cancel.
export type Clock = {
  now(): number
  sleep(ms: number): Promise<void>
  sleepUnlessExit(ms: number): Promise<boolean>
  timer(ms: number, fn: () => void): () => void
}

// The services of one run. See the module header for the members that join
// later (control, git) and why they are documented absence here.
export type RunServices = {
  readonly clock: Clock
  readonly router: Router
}

// The system clock: the wall clock, Bun's non-interruptible sleep, the
// /exit-wakeable sleep and the plain timer, exactly what the call sites used
// before the holder existed — a run without an installed holder (and the
// process default) behave identically to the pre-holder code.
function systemClock(): Clock {
  return {
    now: () => Date.now(),
    sleep: (ms) => Bun.sleep(ms),
    sleepUnlessExit: (ms) => sleepUnlessExit(ms),
    timer: (ms, fn) => {
      const t = setTimeout(fn, ms)
      return () => clearTimeout(t)
    },
  }
}

// Builds a services holder. Pure construction — installing it (or falling
// back to it through `services()`) is what wires the process-level time
// keepers to its clock. `over.clock` replaces the system clock (tests steer
// time with a manual clock); `over.router` replaces the fresh router (tests
// that want a named instance beside the holder they install).
export function createServices(over: { clock?: Clock; router?: Router } = {}): RunServices {
  return { clock: over.clock ?? systemClock(), router: over.router ?? createRouter() }
}

// The modules allowed to call `services()`. The list may only shrink: a
// module leaving it means its service read moved into a constructed service.
// The ratchet that asserts the callers stay within the list lands with the
// later services units; until then the list is the documented contract.
export const SERVICE_ENTRIES = [
  "loop-preflight",
  "loop",
  "session",
  "attempt",
  "watch",
  "interactive",
  "agent-pool",
] as const

let installed: RunServices | undefined
let previous: RunServices | undefined
let fallback: RunServices | undefined
// The instance the process-level time keepers are currently wired to, so an
// activation that changes nothing rewires nothing.
let wired: RunServices | undefined

// Wires the stats module's clock (the one process-level time keeper that
// folded into the holder) to an instance's clock.
const activate = (services: RunServices): void => {
  if (wired === services) return
  wired = services
  useStatsClock(() => services.clock.now())
}

// Installs the run's services; uninstalling restores what was in effect
// before (a surrounding install, or the process default), so a run nested in
// a holder-using caller — a test — leaves the caller's holder intact.
export function installServices(services: RunServices): void {
  previous = installed
  installed = services
  activate(services)
}

export function uninstallServices(): void {
  installed = previous
  previous = undefined
  if (installed !== undefined) activate(installed)
  else wired = undefined // the next services() call wires the process default
}

// The ambient accessor: the installed instance, else a process default
// built once by createServices() (the system clock — identical to the
// pre-holder behavior for processes that never install, such as the
// non-run commands).
export function services(): RunServices {
  if (installed !== undefined) return installed
  if (fallback === undefined) {
    fallback = createServices()
    activate(fallback)
  } else activate(fallback)
  return fallback
}
