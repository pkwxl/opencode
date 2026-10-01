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
// Two outputs, one entry point (emitStatus):
//   - the journal `.auto/run-status.jsonl`: the typed events appended as one
//     JSON line per entry, the run-events journal's own mechanics —
//     append-only within a run, rotated (truncated) once per run start
//     (startRunStatus, called where the run's services install and the engine
//     journal rotates), synchronous per entry (writeSync), every failure
//     caught and silenced so recording never affects the run. The daemon
//     tails this file exactly as it tails the engine journal (read-only —
//     writes into the driver's state directory stay driver-exclusive; the
//     P3c question queue is daemon-owned and therefore lives outside it, the
//     constitutional difference).
//   - the registered in-process sinks: same-process consumers (tests, later
//     transports) subscribe without disk. A sink receives every event of
//     every started run together with its sequence number (the event id a
//     reconnecting transport resumes from — the journal line's 1-based
//     number within the run); a throwing sink is dropped from the list and
//     the emission goes on — the narrative path must never see a subscriber's
//     error.
//
// Terminal-behavior invariant: with no sink registered and journal writing
// configured as today, an unstarted emitter is a no-op (the non-run commands,
// tests that drive the pipeline below runAll) — byte-identical behavior, the
// goldens the proof.
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

// One in-process subscriber: receives every typed event of every started run
// and the event's sequence number (1-based within the run, the journal line's
// number — the id a cursoring transport resumes after).
export type StatusSink = (event: RunStatusEvent, seq: number) => void

// The registered sinks (setter-injected like log.ts's own module state; a
// registering test or transport owns its unsubscription).
const sinks = new Set<StatusSink>()

// Registers one sink and returns its unsubscription.
export function addStatusSink(sink: StatusSink): () => void {
  sinks.add(sink)
  return () => {
    sinks.delete(sink)
  }
}

// The journal's file descriptor, open while a run records. Undefined = not
// recording (no run started it, or starting failed — both silently no-op,
// the engine journal's own rule).
let fd: number | undefined

// The run's join key (the run's start epoch ms — the instant the run-start
// event stamped; every later event of the run echoes it). Undefined = no run
// started (the emitter is a no-op, exactly an unstarted journal).
let runAt: number | undefined
// The run's event sequence (the run-start event is 1); the id a reconnecting
// subscriber resumes after.
let seq = 0
// Whether the run-end bracket already landed (endRunStatus is idempotent; a
// kill -9 leaves no run-end and the next run's startRunStatus resets this).
let ended = false
// The run's own usage totals: the figures the run-end bracket closes with
// (stats books no run bucket — the emitter totals one from the session
// roll-ups it emits, each session counted exactly once).
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
export type StatusEventInput = DistributiveOmit<RunStatusEvent, "run" | "at">

// Starts a run: rotates the journal (a fresh truncate, so each run's file
// holds exactly that run's events — one run per process, re-entry aside),
// resets the run's context and emits the run-start bracket. Never throws: a
// journal that cannot open does not exist (the run proceeds, sinks still fed
// — recording is best-effort by contract, the engine journal's rule).
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
  seq = 0
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
  seq = 0
  ended = false
  runUsage = zeroUsage()
}

// Emits one typed event: stamps run and at, numbers it, appends it to the
// journal (one JSON line, straight through) and feeds every sink. A no-op
// while no run started; a journal write failure is caught and silenced; a
// throwing sink is dropped, not propagated.
export function emitStatus(input: StatusEventInput): void {
  if (runAt === undefined) return
  publish({ ...input, run: runAt, at: Date.now() } as RunStatusEvent)
}

// The one append-and-feed path every emission shares: numbering, the journal
// write, the run-total accumulation and the sinks.
function publish(event: RunStatusEvent): void {
  seq += 1
  if (event.type === "usage-rollup" && event.scope === "session") {
    const usage = event.usage
    runUsage.input += usage.input
    runUsage.output += usage.output
    runUsage.reasoning += usage.reasoning
    runUsage.cacheRead += usage.cacheRead
    runUsage.cacheWrite += usage.cacheWrite
    runUsage.cost += usage.cost
    runUsage.steps += usage.steps
  }
  if (fd !== undefined) {
    try {
      writeSync(fd, `${JSON.stringify(event)}\n`)
    } catch {
      // Recording is best-effort by contract; nothing to restore.
    }
  }
  for (const sink of [...sinks]) {
    try {
      sink(event, seq)
    } catch {
      sinks.delete(sink)
    }
  }
}
