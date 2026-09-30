// The run-events journal (plans/0061 R4/F1): the append-only writer behind
// `.auto/run-events.jsonl`, one typed JSON line per entry. RunEvent is the
// two-part record R4 rules: the **input log** at the engine's I/O seam —
// turn inputs, `TurnFx` results and clock readings, in order, the basis for
// replay (decisions are outputs and cannot serve) — and the **decision
// events** — the effects the spine executes (every fx call with its
// arguments) and the settle that ended each turn. The spine appends the
// inputs and the settles (src/engine/spine.ts), the production fx appends
// its calls and results (src/engine/fx.ts); the file is rotated once per
// run start (`startRunEvents`, called where the run's services install) and
// lives inside the gitignored `.auto/` beside the other state files.
//
// A process module by design, like log.ts and the stats handles: it mirrors
// one file of the one directory the process's single run owns (one driver,
// one directory, one lock), and recording must never affect the run — an
// unstarted journal is a no-op (tests and the non-run commands), and every
// write failure is caught and silenced, exactly the stats module's rule.
// The journal is written straight through (writeSync per entry), so a
// kill -9'd process leaves a complete log up to its last recorded effect.
//
// `stats.ts` is not a fold over these events (R4's explicit ruling): the
// journal records the turn engine's seam, not the run's bookings.
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs"
import { join } from "node:path"
import type { Settle, TurnFx, TurnInput } from "./contract"

// The journal's file, relative to the target directory (beside stats.json
// and the run lock, inside the gitignored `.auto/`).
export const RUN_EVENTS_FILE = join(".auto", "run-events.jsonl")

// The fx members that appear in the journal: every member of the contract's
// fx surface, the executed effects being exactly its calls.
export type RunFxMember = keyof TurnFx

// One journal line. The entry types, in the order a turn produces them:
// - `turn-start` opens a turn (the spine, once per runTurn) and carries the
//   session id and the turn's start timestamp — the clock reading the
//   snapshot's duration later reads — so a reader (and the replay fixture)
//   can split the file into turns;
// - `input` is one dispatched input (external or synthetic), in dispatch
//   order — the input log's turn-input half (a probe's `at` stamp is a
//   clock reading carried in the input);
// - `fx` is one fx call with its arguments — the executed effect, the
//   decision-event half;
// - `fx-result` / `fx-reject` close an `fx` with what the call answered
//   (a clock reading for `now`, the limits map for `contextLimits`) or the
//   rejection it raised. The pure sink members (log, vlog, onModel,
//   onLimit) record no result: they answer void and decide nothing. Any
//   `input` entries between an `fx` and its result were dispatched while
//   the call was in flight — the spine's rule 2, and the interleaving a
//   replay must reproduce;
// - `settle` is the settle that ended the turn, recorded before the
//   finalize procedure's effects follow as further `fx` entries.
export type RunEvent =
  | { type: "turn-start"; session: string; start: number }
  | { type: "input"; origin: "external" | "synthetic"; input: TurnInput }
  | { type: "fx"; member: RunFxMember; args: unknown[] }
  | { type: "fx-result"; value: unknown }
  | { type: "fx-reject"; error: string }
  | { type: "settle"; settle: Settle }

// The fx members whose answers journal no result entry (SINK_MEMBERS answer
// void and decide nothing; every other member is answered): the replay
// fixture serves the recorded answers of exactly the others.
export const FX_SINK_MEMBERS: readonly RunFxMember[] = ["log", "vlog", "onModel", "onLimit"]

// JSON has no Map: the one Map-valued answer (contextLimits) is encoded as
// an entry list and decoded back by the replay fixture. Applied uniformly
// to arguments and answers so the journal round-trips.
export function encodeRunValue(value: unknown): unknown {
  if (value instanceof Map) return { $map: [...value.entries()] }
  return value
}

export function decodeRunValue(value: unknown): unknown {
  if (value !== null && typeof value === "object" && Array.isArray((value as { $map?: unknown[] }).$map)) {
    return new Map((value as { $map: [string, unknown][] }).$map)
  }
  return value
}

// The journal's file descriptor, open while a run records. Undefined = not
// recording (no run started it, or starting failed — both silently no-op).
let fd: number | undefined

// Starts the journal for a run: rotates the file (a fresh truncate, so each
// run's log holds exactly that run's entries — one run per process) and
// opens it for appending. Never throws: a journal that cannot start does
// not exist, and the run proceeds unrecorded.
export function startRunEvents(directory: string): void {
  try {
    mkdirSync(join(directory, ".auto"), { recursive: true })
    const next = openSync(join(directory, RUN_EVENTS_FILE), "w")
    if (fd !== undefined) closeSync(fd)
    fd = next
  } catch {
    fd = undefined
  }
}

// Stops recording (the replay fixture's boundary between its recorded run
// and its replayed one; a run itself records to process end, like log.ts).
export function stopRunEvents(): void {
  if (fd !== undefined) closeSync(fd)
  fd = undefined
}

// Appends one entry as a single JSON line. A no-op while no run started the
// journal; a write failure is caught and silenced — the journal never
// affects the turn that records it.
export function recordRunEvent(entry: RunEvent): void {
  if (fd === undefined) return
  try {
    writeSync(fd, `${JSON.stringify(entry)}\n`)
  } catch {
    // Recording is best-effort by contract; nothing to restore.
  }
}
