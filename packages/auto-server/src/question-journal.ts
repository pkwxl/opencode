// The persistent pending-question queue's journal (P3c, auto-core
// plans/0067 §四): the daemon-owned, append-only record of the question
// lifecycle the interactive transport carries — one run's questions raised,
// settled, and the run identity a restart needs to serve them again. It
// lives in the daemon's own data directory (src/store.ts's layout), NEVER
// under a target directory's `.auto/` (whose writes are driver-exclusive by
// constitution; the direction draft §六.2's option A is rejected on exactly
// that ground — a daemon-written `.auto/` file would be a P4+-era core
// feature, not this).
//
// The queue itself is in-memory (the per-run hubs of src/interactive-ws.ts,
// exactly P3b's shape); the journal is its rebuild aid, not the system of
// record — the durable question lifecycle is the P2b event stream the
// worker's own run writes (`.auto/run-status.jsonl`,
// question-raised/question-answered, served by the status-events channel).
// What the journal adds over that stream is the daemon's own half: the run
// id, the per-run bridge secret and the still-open asks, so a restarted
// daemon can (a) answer the orphan worker's bridge reconnect instead of
// 404ing it, and (b) redeliver the pending set to a client that connects
// after the restart — the reconnect-safe delivery of the unit.
//
// Durability model (deliberately minimal — "in-memory queue with journal
// replay", the task's own first version):
//   - opened  written once per run at spawn (before the worker can raise
//             anything): the run identity a restart reconstructs from.
//   - raised  written when the daemon first holds an ask (a re-raise after
//             a transport blip re-appends only if the hub had cleared it —
//             the fold is idempotent by id either way).
//   - settled written when a settlement is DURABLE: the worker's own
//             settled frame (its word — answered/timeout/transport/closed)
//             or the daemon's run-terminal retire. A live-socket transport
//             blip deliberately journals NOTHING: the worker may still hold
//             the ask (its reconnect re-raises it), so the loss is not a
//             settlement — only the worker's own degradation or the run's
//             end is.
//   - The journal is compacted at each daemon start down to the runs that
//     still hold open questions (their opened + open raised events), so it
//     stays the size of the pending set, not of history.
//
// A torn tail line (the crash window of an append) is skipped, not fatal —
// the journal is a rebuild aid; the records of a newer format are skipped
// the same way (forward compatibility without guessing). The file is mode
// 0600: it carries the per-run bridge secrets, daemon-local randomness that
// must not become world-readable (the store's tokens-file discipline).
// AUTO-DECISION (journaling the bridge secret): the per-run secret has to
// survive the restart for the orphan worker's reconnect to authenticate —
// refusing it (T-094's degrade) is what this unit lifts; the secret stays
// one run's bridge credential, single-machine, inside the daemon's own
// 0600 data directory.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { OpenQuestion } from "./interactive-ws"
import type { Settlement } from "./ws-protocol"

// The journal's own format version — a future conscious change bumps it and
// updates every reader here (the ws-protocol precedent); a record carrying
// an unknown version is skipped by the fold, never misread.
export const JOURNAL_VERSION = 1

// The data-directory layout: <dataDir>/questions.jsonl, beside the store's
// projects.json/tokens.json — daemon-owned state in the daemon's own place.
export const QUESTION_JOURNAL_FILE = "questions.jsonl"

export const journalPath = (dataDir: string): string => join(dataDir, QUESTION_JOURNAL_FILE)

// The request summary an `opened` record carries (the pair POST /runs
// validated): enough for a restored run's view to read like a live one's.
export type JournalRequest = { options: Record<string, unknown>; switches: Record<string, string> }

export type JournalEvent =
  | { v: number; at: string; run: string; event: "opened"; project: string; directory: string; secret: string; started: string; request: JournalRequest }
  | { v: number; at: string; run: string; event: "raised"; id: string; text: string; minutes?: number }
  | { v: number; at: string; run: string; event: "settled"; id: string; how: Settlement }

// One run's reconstructed pending state — what replay hands the daemon:
// the registry stub fields (the record's identity) and the open questions
// in arrival order.
export type RestoredRun = {
  run: string
  project: string
  directory: string
  secret: string
  started: string
  request: JournalRequest
  questions: OpenQuestion[]
}

// Append one event (best-effort by design: a journal that cannot be written
// — a read-only data directory, a full disk — degrades durability, never
// question serving; the daemon logs the failure and keeps the in-memory
// queue, which is the unit's primary shape anyway).
export function appendJournal(dataDir: string, event: JournalEvent): void {
  try {
    mkdirSync(dataDir, { recursive: true })
    appendFileSync(journalPath(dataDir), `${JSON.stringify(event)}\n`, { mode: 0o600 })
  } catch (error) {
    console.error(`the question journal under ${dataDir} could not be written:`, error)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const str = (record: Record<string, unknown>, key: string): string | undefined => (typeof record[key] === "string" ? (record[key] as string) : undefined)

// Read the journal's events. A line that does not parse, or a record this
// version does not recognize (unknown v, unknown event, a misshapen
// member), is skipped — the torn tail of a crash window and the records of
// a newer format alike. The count of skipped lines rides along so the
// caller can log it once at startup (an operator's signal, not a failure
// state).
export function readJournal(dataDir: string): { events: JournalEvent[]; skipped: number } {
  const path = journalPath(dataDir)
  if (!existsSync(path)) return { events: [], skipped: 0 }
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    return { events: [], skipped: 0 }
  }
  const events: JournalEvent[] = []
  let skipped = 0
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    const event = parseEvent(line)
    if (event === undefined) {
      skipped++
      continue
    }
    events.push(event)
  }
  return { events, skipped }
}

// One line → one event; undefined = not a record of this format.
function parseEvent(line: string): JournalEvent | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  if (parsed.v !== JOURNAL_VERSION) return undefined
  const run = str(parsed, "run")
  const at = str(parsed, "at")
  if (run === undefined || at === undefined) return undefined
  if (parsed.event === "opened") {
    const project = str(parsed, "project")
    const directory = str(parsed, "directory")
    const secret = str(parsed, "secret")
    const started = str(parsed, "started")
    const request = parsed.request
    if (project === undefined || directory === undefined || secret === undefined || started === undefined || !isRecord(request)) return undefined
    const switches: Record<string, string> = {}
    if (isRecord(request.switches)) {
      for (const [name, value] of Object.entries(request.switches)) {
        if (typeof value !== "string") return undefined
        switches[name] = value
      }
    } else return undefined
    if (!isRecord(request.options)) return undefined
    return { v: JOURNAL_VERSION, at, run, event: "opened", project, directory, secret, started, request: { options: request.options, switches } }
  }
  if (parsed.event === "raised") {
    const id = str(parsed, "id")
    const text = str(parsed, "text")
    if (id === undefined || text === undefined) return undefined
    const minutes = parsed.minutes
    if (minutes !== undefined && (typeof minutes !== "number" || !Number.isFinite(minutes))) return undefined
    return { v: JOURNAL_VERSION, at, run, event: "raised", id, text, ...(minutes !== undefined ? { minutes } : {}) }
  }
  if (parsed.event === "settled") {
    const id = str(parsed, "id")
    const how = str(parsed, "how")
    if (id === undefined || how === undefined) return undefined
    return { v: JOURNAL_VERSION, at, run, event: "settled", id, how: how as Settlement }
  }
  return undefined
}

// Fold the events into the runs a restart reconstructs: per run, the
// identity of its (last) `opened`, its questions keyed by id in arrival
// order (`raised` sets — a re-raise is the same ask again; `settled`
// deletes). A run survives the fold iff it was opened and still holds at
// least one open question — run history does not survive a restart (P1's
// own decision, unchanged); only the pending set does.
export function foldJournal(events: readonly JournalEvent[]): Map<string, RestoredRun> {
  const restored = new Map<string, RestoredRun>()
  const order = new Map<string, string[]>()
  for (const event of events) {
    if (event.event === "opened") {
      restored.set(event.run, { run: event.run, project: event.project, directory: event.directory, secret: event.secret, started: event.started, request: event.request, questions: [] })
      order.set(event.run, [])
      continue
    }
    const run = restored.get(event.run)
    if (run === undefined) continue
    const ids = order.get(event.run)!
    const questions = new Map(run.questions.map((question) => [question.id, question]))
    if (event.event === "raised") {
      if (!ids.includes(event.id)) ids.push(event.id)
      questions.set(event.id, { id: event.id, text: event.text, ...(event.minutes !== undefined ? { minutes: event.minutes } : {}), at: new Date(event.at).getTime() })
    } else {
      questions.delete(event.id)
      const at = ids.indexOf(event.id)
      if (at >= 0) ids.splice(at, 1)
    }
    run.questions = ids.map((id) => questions.get(id)!).filter((question) => question !== undefined)
  }
  for (const [run, entry] of [...restored]) if (!entry.questions.length) restored.delete(run)
  return restored
}

// Compact the journal at daemon start: rewrite (atomic temp + rename, the
// store's own state-file pattern) keeping only the events of the runs the
// fold reconstructed — the pending set, never history. Best-effort like the
// append (a compaction that cannot write leaves the journal as it was; the
// next start folds it again).
export function compactJournal(dataDir: string, events: readonly JournalEvent[], restored: Map<string, RestoredRun>): void {
  const kept: JournalEvent[] = []
  const seen = new Map<string, Set<string>>()
  for (const event of events) {
    if (!restored.has(event.run)) continue
    if (event.event === "opened") {
      kept.push(event)
      continue
    }
    if (event.event === "raised") {
      // Keep only the raises whose id is still open (the last one wins the
      // fold; the earlier duplicates of a re-raise add nothing).
      const open = restored.get(event.run)!.questions.some((question) => question.id === event.id)
      if (!open) continue
      const raised = seen.get(event.run) ?? new Set<string>()
      if (raised.has(event.id)) continue
      raised.add(event.id)
      seen.set(event.run, raised)
      kept.push(event)
    }
    // settled events of surviving runs are all folded away by construction.
  }
  try {
    mkdirSync(dataDir, { recursive: true })
    const path = journalPath(dataDir)
    const tmp = `${path}.${process.pid}.tmp`
    writeFileSync(tmp, kept.map((event) => `${JSON.stringify(event)}\n`).join(""), { mode: 0o600 })
    renameSync(tmp, path)
  } catch (error) {
    console.error(`the question journal under ${dataDir} could not be compacted:`, error)
  }
}

// The highest run number a journal's run ids reach, so a restarted daemon
// never reissues a live run's id (the counter's own floor).
export function journalRunFloor(events: readonly JournalEvent[]): number {
  let floor = 0
  for (const event of events) {
    const match = /^run-(\d+)$/.exec(event.run)
    if (match) floor = Math.max(floor, Number(match[1]))
  }
  return floor
}
