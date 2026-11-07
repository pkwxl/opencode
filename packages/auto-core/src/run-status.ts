// The driver-status emitter (P2b, plans/0067 and its review — the one core
// change of the P2 phase): emission of the RunStatusEvent vocabulary
// (src/run-status-schema.ts, P2a) at the driver's narrative points. The seam
// follows the log.ts setter-injection precedent — setVerbose / setInteractive
// / setAuditLog / setInput / setLogFile — NOT the services holder: log.ts is
// deliberately a process-level module excluded from RunServices
// (src/services.ts:34-38), SERVICE_ENTRIES is an allowlist that may only
// shrink (src/services.ts:111-119), and this module never calls services()
// and never joins the list. One run per process makes a process-level module
// the right shape (one driver, one directory, one lock), exactly like log.ts,
// the stats handles and the run-events journal (src/engine/events.ts).
//
// One output, one entry point (emitStatus): the journal
// `.auto/run-status.jsonl` — the typed events appended as one JSON line per
// entry, the run-events journal's own mechanics: append-only within a run,
// rotated (truncated) once per run start (startRunStatus, called where the
// run's services install and the engine journal rotates), synchronous per
// entry (writeSync), every failure caught and silenced so recording never
// affects the run. The daemon tails this file exactly as it tails the engine
// journal, read-only, cross-process — writes into the driver's state
// directory stay driver-exclusive (the P3c question queue is daemon-owned and
// therefore lives outside it, the constitutional difference). The designed
// transport IS the file: an in-process sink seam was removed (0102's ruling
// — addStatusSink had no live subscriber and could never serve the
// cross-process daemon; a same-process consumer reads the same journal
// lines, whose 1-based position within the run is the id a reconnecting
// transport resumes after).
//
// Terminal-behavior invariant: an unstarted emitter is a no-op (the non-run
// commands, tests that drive the pipeline below runAll) — byte-identical
// behavior, the goldens the proof.
//
// AUTO-DECISION (the question seam is the questions concern, not askHuman):
// the task's scope line names "where askHuman routes
// (src/session-api.ts:364-397)". The routing of a question — human wait vs
// auto-answer fallback vs policy denial — is decided where the question event
// is handled (src/engine/concerns/questions.ts, the questions concern); the
// askHuman function is the human-wait primitive the router calls, and it
// knows neither the question text nor the request id nor the session. Emitting
// there would double-raise every agent question that waits and miss every one
// that does not (the default-switches auto-answer path never calls askHuman,
// and a fixture run under default switches produces no pair at all). The pair
// is therefore emitted at the concern, origin "agent" (every live caller
// routes an agent question or permission event; request and session join the
// agent stream). The vocabulary's origin "driver" stays reserved for driver
// prompts of their own (the P3c queue, the plan unlock).
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs"
import { join } from "node:path"
import type { RunExitCode, RunStatusEvent, UsageFigures } from "./run-status-schema"

// The journal's file, relative to the target directory (beside the engine
// journal and the stats handle, inside the driver's gitignored state
// directory).
export const RUN_STATUS_FILE = join(".auto", "run-status.jsonl")

// The journal's file descriptor, open while a run records. Undefined = not
// recording (no run started it, or starting failed — both silently no-op,
// the engine journal's own rule).
let fd: number | undefined

// The run's join key (the run's start epoch ms — the instant the run-start
// event stamped; every later event of the run echoes it). Undefined = no run
// started (the emitter is a no-op, exactly an unstarted journal).
let runAt: number | undefined
// Whether the run-end bracket already landed (endRunStatus is idempotent; a
// kill -9 leaves no run-end and the next run's startRunStatus resets this).
let ended = false
// The run's own usage totals: the figures the run-end bracket closes with
// (stats books no run bucket — the emitter totals one from the roll-ups it
// emits, each consumption counted exactly once: a session roll-up's delta —
// this booking's figures, never the resumed entry's cumulative re-counted —
// plus a lane landing's booked usage, plans/0212 D4).
let runUsage: UsageFigures = zeroUsage()

function zeroUsage(): UsageFigures {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 }
}

// Omit that distributes over a union (a naked type parameter distributes; a
// concrete union would collapse into one Omit over the merged keys).
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

// What a call site passes: the narrative fields of one event — the emitter
// stamps the join key (`run`) and the instant (`at`) itself, so no call site
// can stamp a foreign run or clock. (Each union member loses exactly its
// run/at pair; the discriminant stays, so a literal call site narrows.)
type StatusEventInput = DistributiveOmit<RunStatusEvent, "run" | "at">

// Starts a run: rotates the journal (a fresh truncate, so each run's file
// holds exactly that run's events — one run per process, re-entry aside),
// resets the run's context and emits the run-start bracket. Never throws: a
// journal that cannot open does not exist (the run proceeds without
// recording — it is best-effort by contract, the engine journal's rule).
export function startRunStatus(directory: string): void {
  try {
    mkdirSync(join(directory, ".auto"), { recursive: true })
    const next = openSync(join(directory, RUN_STATUS_FILE), "w")
    if (fd !== undefined) closeSync(fd)
    fd = next
  } catch {
    fd = undefined
  }
  runAt = Date.now()
  ended = false
  runUsage = zeroUsage()
  // The bracket's own stamp: the run-start's instant IS the run id every
  // later event echoes (one Date.now, one instant).
  publish({ type: "run-start", run: runAt, at: runAt, directory })
}

// Closes the run's bracket: the run-total usage roll-up (scope "run", the
// figures the bracket closes with) then the run-end event carrying the exit
// code. Idempotent within a run; a no-op without one (a kill -9 leaves no
// run-end — the stale lock and the missing bracket are that story, and the
// next run's startRunStatus opens a new one). After the bracket closed, the
// emitter is inert: no run is current, so a stray emission after the run
// (a late settle in another test of the same process) is a no-op instead of
// an event stamped with a dead run's id.
export function endRunStatus(code: RunExitCode): void {
  if (runAt === undefined || ended) return
  emitStatus({ type: "usage-rollup", scope: "run", usage: runUsage })
  emitStatus({ type: "run-end", code })
  ended = true
  runAt = undefined
}

// Stops recording and forgets the run (the test boundary between one
// recorded run and the next, stopRunEvents' shape; a run itself records to
// process end, like log.ts).
export function stopRunStatus(): void {
  if (fd !== undefined) closeSync(fd)
  fd = undefined
  runAt = undefined
  ended = false
  runUsage = zeroUsage()
}

// Emits one typed event: stamps run and at, appends it to the journal (one
// JSON line, straight through). A no-op while no run started; a journal
// write failure is caught and silenced.
export function emitStatus(input: StatusEventInput): void {
  if (runAt === undefined) return
  publish({ ...input, run: runAt, at: Date.now() } as RunStatusEvent)
}

// The one append path every emission shares: the journal write and the
// run-total accumulation.
function addFigures(target: UsageFigures, add: UsageFigures) {
  target.input += add.input
  target.output += add.output
  target.reasoning += add.reasoning
  target.cacheRead += add.cacheRead
  target.cacheWrite += add.cacheWrite
  target.cost += add.cost
  target.steps += add.steps
}

function publish(event: RunStatusEvent): void {
  // The run total counts each consumption exactly once (plans/0212 D4): a
  // session roll-up contributes its `delta` when the stats seam handed one
  // (this booking's figures — the cumulative `usage` a resumed session
  // carries already counted in the run that booked it), its whole `usage`
  // otherwise (a direct emitter's own shape); a lane landing contributes
  // the booked detail's breakdown (emitted exactly where the booking ran —
  // a lane-less run emits none).
  if (event.type === "usage-rollup" && event.scope === "session") {
    addFigures(runUsage, event.delta ?? event.usage)
  }
  if (event.type === "lane-landing" && event.usage !== undefined) {
    addFigures(runUsage, event.usage)
  }
  if (fd !== undefined) {
    try {
      writeSync(fd, `${JSON.stringify(event)}\n`)
    } catch {
      // Recording is best-effort by contract; nothing to restore.
    }
  }
}
