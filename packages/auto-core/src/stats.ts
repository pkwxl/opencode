// Cross-interruption cumulative stats (plans/STATS_PLAN.md §1): accumulated
// elapsed time and token usage breakdowns at the task/session/phase/round
// levels, persisted in the target directory `.auto/stats.json` (inside
// .gitignore, written by the driver exclusively, not on the protect list). The
// process can be kill -9'd at any moment, so stats increments are persisted to
// disk: open-segment fold + a 30s heartbeat refreshing lastWriteAt; the next
// process's load credits only the `[open.at, lastWriteAt]` depreciation
// (undercount rather than overcount, never inflated).
//
// Timing model: a single-segment state machine — `open?: { at, ai }` allows at
// most one in-progress segment; each boundary fold accumulates `[open.at, now]`
// into the three task/phase/round buckets **in parallel** (no folding child
// layers up into parents — a phase contains non-task time that a rollup would
// lose). An ai segment accumulates both aiMs/wallMs, a wall-clock segment only
// wallMs; fold clamps to [0, MAX_TICK] (clock-rollback / suspend defense).
//
// Robustness: atomic write (.tmp → rename + serialization through the write
// queue, aligned with plan.ts edit); lenient per-field parsing (mirrors
// resume.ts parseProgress, bad = missing, no throw); sessions evicted by at
// beyond 64; every write failure is caught and silenced — stats never affects
// flow or exit codes.
//
// Every public API takes `dir: string | undefined` as its first parameter;
// undefined = no-op (no heartbeat, no disk reads or writes); internally a
// lazily loaded `Map<dir, Handle>`. Two concurrent runs in the same directory
// are unsupported (the later write overwrites, skewing low rather than
// crashing) — an accepted boundary, no lock file added.
//
// The document's schema half — the types, the empty-value constructors, the
// lenient parsers and the copy/merge functions — lives in
// src/stats-schema.ts (plans/0102 D7, the src/models-schema.ts precedent:
// the two halves are separable, and a type-only importer binds no store
// code); this module is the store and the public APIs, re-exporting the
// schema's public surface so its consumers keep their single import point.
import { mkdir, realpath, rename } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { currentRound } from "./phases"
import { emitStatus } from "./run-status"
import {
  addUsage,
  CLASSIFY_BUCKET,
  copyTotals,
  emptyBucket,
  emptyDoc,
  emptyModelStat,
  emptyTierStat,
  emptyTotals,
  emptyUsage,
  MAX_TICK,
  mergeDigestStats,
  mergeModelStats,
  num,
  parseStatsDoc,
  SYNTHESIS_BUCKET,
  type Bucket,
  type DecomposeRun,
  type DigestStat,
  type DigestStats,
  type LaneStat,
  type LaneUsageDetail,
  type ModelStat,
  type SessionStat,
  type StatsDoc,
  type StatsResume,
  type TierStat,
  type Totals,
  type Usage,
} from "./stats-schema"

export {
  CLASSIFY_BUCKET,
  MAX_TICK,
  SYNTHESIS_BUCKET,
  type Bucket,
  type DecomposeRun,
  type DigestStat,
  type DigestStats,
  type LaneStat,
  type LaneUsageDetail,
  type ModelStat,
  type SessionStat,
  type StatsDoc,
  type StatsResume,
  type TierStat,
  type Totals,
  type Usage,
} from "./stats-schema"

const FILE = join(".auto", "stats.json")

// AUTO-DECISION: time reads use a module-level replaceable clock. The
// alternative was an optional now parameter on each API such as
// loadStats/fold — but fold also happens inside the heartbeat and the
// session/reading APIs, so the parameter would have to thread through every
// public API, polluting signatures, and the wiring layers would have to pass
// it along too; a module-level clock is injected in one place and takes
// effect module-wide — the parameter variant was rejected. The injection
// point is the run services' activation (useStatsClock, called by
// src/services.ts): the stats clock folded into the run's one clock, so a
// run's installed holder steers the stats timeline too, and the module-level
// Date.now default covers only the processes that never install services
// (the non-run commands).
let clock: () => number = Date.now

// Wire this module's clock to the run services' clock (src/services.ts owns
// the call; tests never call it — they install a services holder with their
// own clock).
export function useStatsClock(now: () => number) {
  clock = now
}

// ===== fold / depreciation / round rollover =====

// Segment duration clamped to [0, MAX_TICK]: negatives (clock rollback) and
// NaN go to 0, over-cap values are truncated.
function clampTick(ms: number): number {
  if (!(ms > 0)) return 0
  return Math.min(ms, MAX_TICK)
}

// Accumulate one duration into the three task/phase/round buckets in parallel;
// an ai segment also adds aiMs.
function book(doc: StatsDoc, ms: number, ai: boolean) {
  if (!ms) return
  for (const bucket of [doc.taskB, doc.phaseB, doc.roundB]) {
    bucket.wallMs += ms
    if (ai) bucket.aiMs += ms
  }
}

// Fold the open segment: post [open.at, now] and advance the anchor to now
// (the segment stays open).
// On clock rollback (now <= open.at) the anchor does not move — moving it back
// would let the next fold double-count the already-posted interval.
// An AI segment's duration also counts in parallel toward the in-progress
// session's aiMs accumulation (the thisAiMs / per-session caliber).
function fold(handle: Handle) {
  const open = handle.doc.open
  if (!open) return
  const now = clock()
  if (now <= open.at) return
  const ms = Math.min(now - open.at, MAX_TICK)
  book(handle.doc, ms, open.ai)
  if (open.ai && handle.lastKey !== undefined) {
    const session = handle.active.get(handle.lastKey)
    if (session) session.aiMs += ms
  }
  open.at = now
}

// Depreciate the segment left over by the previous process: only
// [open.at, lastWriteAt] is credited (lastWriteAt = a proxy for the moment of
// death, undercount rather than overcount).
// AUTO-DECISION: depreciation goes through the same MAX_TICK clamp (clampTick).
// The plan (:47) does not explicitly say whether depreciation is clamped, but
// under the "undercount rather than overcount" principle clamping everything is
// safest: with an abnormal lastWriteAt (an absurd value leniently parsed out of
// a bad file), leaving it unclamped would inflate the numbers by hours in one
// shot; the alternative "depreciation unclamped, only fold clamped" would widen
// the impact of bad data, rejected. Depreciation does not reach per-session
// (the open segment carries no sessionID, nothing to attribute to) — the same
// accepted undercounting trade-off.
function depreciate(doc: StatsDoc) {
  const open = doc.open
  if (!open) return
  book(doc, clampTick(doc.lastWriteAt - open.at), open.ai)
  doc.open = undefined
}

// Roll roundB into history (past-rounds aggregate, single bounded bucket); the
// task/phase buckets stay untouched — with the three buckets accumulating in
// parallel, roundB already contains everything, nothing is lost; task/phase are
// reset by the next statsTask/statsPhase. The per-model and per-tier sections
// roll with the flat fields, so the history aggregate stays consistent with
// its own usage totals.
function rollHistory(doc: StatsDoc) {
  const totals = doc.history.totals
  totals.aiMs += doc.roundB.aiMs
  totals.wallMs += doc.roundB.wallMs
  totals.waitMs += doc.roundB.waitMs
  totals.sessions += doc.roundB.sessions
  totals.tasks += doc.roundB.tasks
  for (const key of Object.keys(totals.usage) as (keyof Usage)[]) {
    totals.usage[key] += doc.roundB.usage[key]
  }
  mergeModelStats(totals, doc.roundB)
  mergeDigestStats(totals, doc.roundB)
  doc.history.rounds += 1
}

// ===== atomic write + write queue =====

// In-session in-progress state (not persisted): statsSessionBegin associates
// the current task and zeroes the accumulators; every fold of an AI segment
// counts its duration in parallel toward aiMs (the thisAiMs / per-session
// caliber), in-session human wait counts toward waitMs (per-session wallMs =
// aiMs + waitMs, distinct from the three buckets' "wallMs excludes pure human
// wait" caliber). kill -9 loses the unposted in-session accumulators (the three
// buckets still get credit up to lastWriteAt through depreciation; per-session
// has no attribution, so it undercounts — the same trade-off as depreciation
// not reaching per-session).
type ActiveSession = {
  task: string
  aiMs: number
  waitMs: number
}

type Handle = {
  doc: StatsDoc
  // This process's starting-point snapshot (statsBoot): a copy of the three
  // buckets' Totals at loadStats time (after depreciation + round rollover);
  // when a bucket is reset within this process (a statsTask/statsPhase switch)
  // the matching snapshot zeroes with it, keeping "this process's increment =
  // statsTotals − statsBoot" always aligned with the current bucket identity.
  // Not persisted.
  boot: { task: Totals; phase: Totals; round: Totals }
  writing: Promise<void> // write-queue tail; all disk writes (heartbeat/event/flush) serialize through this chain
  // The in-progress AI sessions (plans/0099 D8, doc lanes), keyed by the unit
  // id their begin named — the one-key era's single slot generalized so a
  // sibling pipeline's begin no longer displaces this unit's accumulators.
  // lastKey is the unit whose begin opened the currently-open segment: fold
  // credits its accumulator (the union caliber the header documents — with
  // overlapping sessions only the segment holder's per-session figure grows,
  // the others undercount).
  active: Map<string, ActiveSession>
  lastKey?: string
  // Human-wait nesting depth counter: depth 0→1 closes the segment (after the
  // fold open=undefined; neither wall clock nor AI grows); when it returns to
  // zero, waitMs is posted alone into the three buckets and the segment reopens
  // (the ai flag restored to its pre-close value). Nesting dedup: overlapping
  // waits such as --early parallel sessions are counted once (plan :52). Hence
  // the hierarchical buckets' aiMs semantics = "wall-clock time with AI active"
  // (the union of wall-clock intervals where any session's AI segment is open),
  // not the sum of the sessions' AI durations — with overlapping parallel
  // sessions, hierarchical aiMs ≤ Σ session aiMs, which is expected, not
  // undercounting.
  wait: { depth: number; start: number; ai: boolean }
  timer?: ReturnType<typeof setInterval> // 30s heartbeat while a session runs (fold + persist, unref)
}

// .tmp → rename aligned with plan.ts edit; stats.json is not on the protect
// list, no allowWrite/reprotect needed. Failures propagate up, silenced by
// queueWrite's catch.
async function atomicWrite(dir: string, text: string) {
  const auto = join(dir, ".auto")
  await mkdir(auto, { recursive: true })
  const file = join(auto, "stats.json")
  const target = await realpath(file).catch(() => file)
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.tmp`)
  await Bun.write(tmp, text)
  await rename(tmp, target)
}

// Enqueue one disk write: the snapshot is serialized at enqueue time (that
// point-in-time is what persists; later in-memory changes do not affect
// already-queued writes), lastWriteAt refreshes with it; write failures are
// caught and silenced (stats never affects flow or exit codes).
function queueWrite(dir: string, handle: Handle) {
  handle.doc.lastWriteAt = clock()
  const text = JSON.stringify(handle.doc)
  handle.writing = handle.writing.then(() => atomicWrite(dir, text)).catch(() => {})
}

// ===== loading (loadStats / flushStats) =====

const handles = new Map<string, Handle>()
const loading = new Map<string, Promise<Loaded>>()

type Loaded = { handle: Handle; resumed?: StatsResume }

// Lazy loading: an already-loaded directory returns directly; concurrent first loads share one promise.
function ensure(dir: string): Promise<Loaded> {
  const existing = handles.get(dir)
  if (existing) return Promise.resolve({ handle: existing })
  const pending = loading.get(dir)
  if (pending) return pending
  const created = load(dir).finally(() => loading.delete(dir))
  loading.set(dir, created)
  return created
}

async function load(dir: string): Promise<Loaded> {
  const now = clock()
  const raw = await Bun.file(join(dir, FILE)).text().catch(() => undefined)
  const parsed = raw ? parseStatsDoc(raw) : undefined
  const round = await currentRound(dir).catch(() => 1)
  let resumed: StatsResume | undefined
  let doc: StatsDoc
  if (parsed) {
    doc = parsed
    // Depreciate the segment left over by the previous process (only [open.at, lastWriteAt] is credited).
    depreciate(doc)
    // Resume snapshot: after depreciation, before round rollover (presenting where the previous process stopped).
    resumed = {
      round: doc.round,
      phase: doc.phase,
      task: doc.taskB.id || undefined,
      taskWallMs: doc.taskB.wallMs,
      taskAiMs: doc.taskB.aiMs,
      lastWriteAt: doc.lastWriteAt,
    }
    // Round number changed: roundB rolls into history and resets. A corrupt
    // round field (<1) is treated as missing — only the snapshot refreshes, no
    // rollover, avoiding inflating history.rounds with an empty round.
    if (doc.round >= 1 && round !== doc.round) {
      rollHistory(doc)
      doc.roundB = emptyBucket(String(round), now)
    }
    doc.round = round
  } else {
    // Corrupt/missing = start over from now (a machine change or a wiped .auto takes the same path; stats is not the source of truth).
    doc = emptyDoc(round, now)
  }
  // Open this process's first segment (wall-clock, ai=false; the session segment is switched in by statsSessionBegin).
  doc.open = { at: now, ai: false }
  doc.lastWriteAt = now
  const handle: Handle = {
    doc,
    boot: { task: copyTotals(doc.taskB), phase: copyTotals(doc.phaseB), round: copyTotals(doc.roundB) },
    writing: Promise.resolve(),
    active: new Map(),
    wait: { depth: 0, start: 0, ai: false },
  }
  handles.set(dir, handle)
  queueWrite(dir, handle)
  return { handle, resumed }
}

// Called at runAll startup: read disk (corrupt/missing = start over from now)
// → depreciate → round rollover → open this process's first segment. Returns
// printable resume information when an old document exists; a brand-new
// directory, a repeat call (no double depreciation) or dir === undefined
// returns undefined.
export async function loadStats(dir: string | undefined): Promise<StatsResume | undefined> {
  if (!dir) return undefined
  if (handles.has(dir)) return undefined
  return (await ensure(dir)).resumed
}

// Graceful close-out in runAll's finally: fold the open segment, then close it
// and persist (the document keeps no open, so the next process loads with
// nothing to depreciate), and unload the handle (a later loadStats reads from
// disk again). No-op without a handle or when dir === undefined.
export async function flushStats(dir: string | undefined): Promise<void> {
  if (!dir) return
  if (!handles.has(dir) && !loading.has(dir)) return
  const { handle } = await ensure(dir)
  stopHeartbeat(handle)
  handle.active.clear()
  handle.lastKey = undefined
  fold(handle)
  handle.doc.open = undefined
  queueWrite(dir, handle)
  await handle.writing
  handles.delete(dir)
}

// ===== hierarchy switching and readings (statsPhase/statsTask/statsTotals/statsId/statsBoot) =====

// Real-time extrapolation for readings: the open segment's [open.at, now]
// unposted part is counted into a **copy** that is returned (same clamp as
// fold), without modifying doc or persisting — the display layer can read the
// current value at any moment, the state machine is unaffected.
function extrapolate(doc: StatsDoc, bucket: Bucket): Bucket {
  const copy: Bucket = { id: bucket.id, since: bucket.since, ...copyTotals(bucket) }
  const open = doc.open
  if (open) {
    const now = clock()
    if (now > open.at) {
      const ms = Math.min(now - open.at, MAX_TICK)
      copy.wallMs += ms
      if (open.ai) copy.aiMs += ms
    }
  }
  return copy
}

// Phase switch (runPhaseLoop after routePhase / the non-phased "m" run): fold
// the current segment into the old bucket, then, when the phase id changes,
// reset phaseB (id = the qualified phase id R-NN.P<nn>, since = now) and
// persist; the same id is idempotent (no reset, keeps accumulating). The id is
// per phase unit, not per type (M3.6: a type may repeat within a round).
// boot.phase resets with the bucket, keeping "this process's increment" aligned.
export async function statsPhase(dir: string | undefined, phase: string): Promise<void> {
  if (!dir) return
  const { handle } = await ensure(dir)
  fold(handle)
  if (handle.doc.phaseB.id === phase) return
  handle.doc.phase = phase
  handle.doc.phaseB = emptyBucket(phase, clock())
  handle.boot.phase = emptyTotals()
  queueWrite(dir, handle)
}

// Task switch (at runTaskLoop's task banner): after the fold, when the id
// changes reset taskB and clear the sessions map (plan :49; before the clear
// the aggregate is already in the three buckets — losing per-session display
// history is an accepted trade-off) and persist; same id is idempotent —
// resuming the same task after an interruption does not reset, does not
// double-count, and keeps the per-session continuation.
// AUTO-DECISION: the tasks count = +1 on entering a different task id
// (including this process's first entry), accumulated in the phase/round
// buckets (the "N tasks in the phase / N tasks in this round" message caliber);
// after taskB resets it is set to 1, meaning this bucket covers the one current
// task. The alternative "count at task completion" was rejected: the moment of
// completion (does blocked/incomplete count too?) is an ambiguous caliber,
// while "entry" semantics are simple and idempotent across interruptions (same
// id not counted twice).
export async function statsTask(dir: string | undefined, id: string): Promise<void> {
  if (!dir) return
  const { handle } = await ensure(dir)
  fold(handle)
  if (handle.doc.taskB.id === id) return
  handle.doc.taskB = emptyBucket(id, clock())
  handle.doc.taskB.tasks = 1
  handle.doc.phaseB.tasks += 1
  handle.doc.roundB.tasks += 1
  handle.doc.sessions = {}
  handle.boot.task = emptyTotals()
  queueWrite(dir, handle)
}

type StatsScope = "task" | "phase" | "round"

// Reading: returns a copy of the bucket's accumulations + real-time
// extrapolation of the open segment (the unposted segment counted instantly,
// no state change, no disk write). dir === undefined returns undefined.
export async function statsTotals(
  dir: string | undefined,
  scope: StatsScope,
): Promise<Bucket | undefined> {
  if (!dir) return undefined
  const { handle } = await ensure(dir)
  const bucket = scope === "task" ? handle.doc.taskB : scope === "phase" ? handle.doc.phaseB : handle.doc.roundB
  return extrapolate(handle.doc, bucket)
}

// The current taskB.id (trackSubtasks guard: statsTotals is trusted only when
// statsId === task.id; consumed by T-002).
// AUTO-DECISION: synchronous and does not trigger lazy loading — a guard
// reading must be side-effect-free; unloaded/empty id returning undefined is
// the guard failing, which is the correct semantics. Triggering a load (disk
// read + write) for a guard reading would instead introduce unnecessary IO and
// state-timing concerns, rejected.
export function statsId(dir: string | undefined): string | undefined {
  if (!dir) return undefined
  return handles.get(dir)?.doc.taskB.id || undefined
}

// This process's starting-point snapshot (at loadStats time, after
// depreciation + round rollover; a bucket's matching snapshot zeroes when the
// bucket resets within this process). "accumulated X (this process Y)" caliber:
// this process's increment = the same-named field delta of
// statsTotals(scope) − statsBoot(scope). Returns a deep copy; caller-side
// changes do not affect internal state.
export async function statsBoot(
  dir: string | undefined,
): Promise<{ task: Totals; phase: Totals; round: Totals } | undefined> {
  if (!dir) return undefined
  const { handle } = await ensure(dir)
  return { task: copyTotals(handle.boot.task), phase: copyTotals(handle.boot.phase), round: copyTotals(handle.boot.round) }
}

// Past-rounds aggregate reading (the cross-round cumulative segment of T-006's
// round-complete line): a copy of history (rounds = the number of rolled-out
// rounds, totals = the past-rounds sum, excluding this round's roundB). The
// caller omits the cross-round segment when rounds = 0.
export async function statsHistory(
  dir: string | undefined,
): Promise<{ rounds: number; totals: Totals } | undefined> {
  if (!dir) return undefined
  const { handle } = await ensure(dir)
  return { rounds: handle.doc.history.rounds, totals: copyTotals(handle.doc.history.totals) }
}

// ===== sessions and waits (statsSessionBegin/End, statsWaitBegin/End) =====

// Heartbeat period while a session runs: fold + persist, bounding the kill -9
// loss to ≤ ~30s (depreciation credits only up to lastWriteAt).
const HEARTBEAT_MS = 30_000

// Sessions eviction cap: beyond 64 the oldest are evicted by at (last-active
// moment) (the aggregate is already in the three buckets, lossless).
const MAX_SESSIONS = 64

function startHeartbeat(dir: string, handle: Handle) {
  if (handle.timer) return // already ticking (nested/parallel sessions share one)
  handle.timer = setInterval(() => {
    fold(handle)
    queueWrite(dir, handle)
  }, HEARTBEAT_MS)
  handle.timer.unref() // does not block process exit
}

function stopHeartbeat(handle: Handle) {
  if (handle.timer) clearInterval(handle.timer)
  handle.timer = undefined
}

// Before prompt dispatch (runner attempt): fold the current segment, then open
// an AI segment, associate the current task, and start the 30s heartbeat
// (fold + persist, unref).
// AUTO-DECISION: no disk write at begin — the first heartbeat right after
// (≤30s) persists the fold result, and the kill -9 loss stays bounded by the
// heartbeat period; the alternative "queueWrite at begin" only narrows the
// window by a few seconds while adding one disk write per session, rejected.
// A session already in progress at begin (parallel, or an unpaired end on an
// abnormal path): the same unit's own in-memory accumulators are abandoned
// (already posted losslessly to the three buckets; per-session undercounts),
// and the new session accumulates from zero. A sibling unit's accumulators
// (plans/0099 D8) are not touched — the map keeps them until their own end.
export async function statsSessionBegin(dir: string | undefined, taskID: string): Promise<void> {
  if (!dir) return
  const { handle } = await ensure(dir)
  fold(handle)
  handle.active.set(taskID, { task: taskID, aiMs: 0, waitMs: 0 })
  handle.lastKey = taskID
  handle.doc.open = { at: clock(), ai: true }
  startHeartbeat(dir, handle)
}

// The printable report of statsSessionEnd (the ◉ session-end line, consumed by
// T-003/T-004): thisAiMs = this session's AI duration; session = that
// sessionID's cross-interruption accumulation (this one included);
// task/phase/round = copies of the three buckets' current accumulations (same
// caliber as statsTotals).
type StatsSessionReport = {
  thisAiMs: number
  session: SessionStat
  task: Bucket
  phase: Bucket
  round: Bucket
}

// End of a session round (including error/blocked/abnormal paths — all 8
// runner returns carry it): fold, post usage into the four layers (the
// task/phase/round buckets + per-session), sessions count +1, close the AI
// segment and reopen a wall-clock segment, stop the heartbeat, persist, and
// return the printable report. Without a paired begin (a fallback for dispatch
// failures and similar abnormal paths) thisAiMs = 0, while usage and the
// sessions/rounds counts still record — the consumption really happened, do
// not drop it.
// model/tier (passed in by attempt over the registry in force — layered or
// implicit, plans/0055 §7.1 "Stats"): the candidate key — an internal name,
// or the raw
// `provider/model` string of an override value — plus this dispatch's tier;
// when given, usage and sessions are booked in parallel per model and per
// tier into the three buckets (the same booking point as the buckets' own
// usage, one cumulative criterion across interruptions). Not given: no
// models/tiers sections are created (every run books over its registry; this
// corner is the direct caller's alone).
// task (plans/0099 D8, doc lanes): the unit id captured at dispatch — the
// booking attributes to it, never to the ambient "current bucket". Under
// concurrency the task bucket flips between sibling units; a booking whose
// task names a unit the bucket does not hold books phase/round + per-session
// only, skipping the sibling's bucket (the statsLaneUsage precedent: never
// fold into a task bucket that is not the unit's own). An empty task bucket
// (no statsTask yet — the bypass pseudo tasks' case) keeps today's booking:
// the serial floor is unchanged.
export async function statsSessionEnd(
  dir: string | undefined,
  sessionID: string,
  usage: Usage,
  model?: string,
  tier?: string,
  task?: string,
): Promise<StatsSessionReport | undefined> {
  if (!dir) return undefined
  const { handle } = await ensure(dir)
  fold(handle)
  stopHeartbeat(handle)
  const key = task ?? handle.lastKey
  const active = key !== undefined ? handle.active.get(key) : undefined
  if (key !== undefined) handle.active.delete(key)
  const doc = handle.doc
  // The sibling-bucket test: book into taskB only when the bucket holds this
  // session's unit (or nothing at all — the pre-statsTask bypass shape).
  const ownBucket = key === undefined || doc.taskB.id === key || doc.taskB.id === ""
  const now = clock()
  // Close the AI segment and reopen a wall-clock segment; if currently inside
  // a human wait (the segment is already closed), waitEnd does the reopening —
  // wait.ai flips back to false so what resumes after the wait is a wall-clock
  // segment, not the ended session's AI segment.
  if (handle.wait.depth === 0) doc.open = { at: now, ai: false }
  else handle.wait.ai = false
  for (const bucket of ownBucket ? [doc.taskB, doc.phaseB, doc.roundB] : [doc.phaseB, doc.roundB]) {
    bucket.sessions += 1
    addUsage(bucket.usage, usage)
    if (model !== undefined) {
      const stat = ((bucket.models ??= {})[model] ??= emptyModelStat())
      addUsage(stat.usage, usage)
      stat.sessions += 1
    }
    if (tier !== undefined) {
      const stat = ((bucket.tiers ??= {})[tier] ??= emptyTierStat())
      addUsage(stat.usage, usage)
      stat.sessions += 1
    }
  }
  // Per-session continuation: the same sessionID accumulates rounds/aiMs/usage
  // across interruptions (fork continuation); task follows this begin's
  // association (defaulting to the old value / the current taskB.id).
  const entry = doc.sessions[sessionID] ?? {
    task: "",
    aiMs: 0,
    wallMs: 0,
    rounds: 0,
    usage: emptyUsage(),
    at: 0,
  }
  entry.task = active?.task ?? (entry.task || doc.taskB.id)
  entry.aiMs += active?.aiMs ?? 0
  entry.wallMs += (active?.aiMs ?? 0) + (active?.waitMs ?? 0)
  entry.rounds += 1
  addUsage(entry.usage, usage)
  entry.at = now
  doc.sessions[sessionID] = entry
  evictSessions(doc)
  queueWrite(dir, handle)
  // The session's usage roll-up (P2b, src/run-status.ts): the stats seam —
  // every session end (all 8 runner returns book through here) pushes the
  // session's accumulated figures as one typed event; this file stays the
  // durable numbers, the event is the same shape as a push. Outside a run
  // (a bare statsSessionEnd in a test) the emitter is a no-op.
  emitStatus({ type: "usage-rollup", scope: "session", usage: { ...entry.usage }, session: sessionID, ...(entry.task ? { task: entry.task } : {}) })
  return {
    thisAiMs: active?.aiMs ?? 0,
    session: { ...entry, usage: { ...entry.usage } },
    task: extrapolate(doc, doc.taskB),
    phase: extrapolate(doc, doc.phaseB),
    round: extrapolate(doc, doc.roundB),
  }
}

// Protocol-drift counting (plans/0055 §10 item 3): the report `Result: FAIL`
// verdict a session of some model wrote (fail), the stuck-loop hints it
// received (stuck), the shape-check re-prompts it triggered (reprompt).
// The same parallel three-bucket criterion as usage — the count lands in the
// three buckets of the task/phase/round the event happened in, accumulating
// in the document across interruptions. An absent model is a no-op and
// creates no models section.
// The event was already judged by the caller at its observation point; this
// only stores it.
// AUTO-DECISION: the counts go to the three buckets in parallel (task/phase/
// round each +1), not a single "round bucket only" criterion — the three
// buckets are this module's standing parallel accumulation model (phase time
// including non-task time is not folded either), a single-layer criterion
// would leave "how often this model drifted in this task" unreadable; the
// three copies are bounded and self-consistent.
//
// The compensation counters of plans/0069 §2.4 (0064 T1's quarterly cost
// audit judged blind without them): a recovery probe of the wait-and-probe
// loop that failed on the model (probe), a length-cut continuation dispatch
// its truncated reply caused (continuation), and a context step-up one of
// its sessions took (stepup) — the same shape, the same criterion, recorded
// at each mechanism's production site beside the decision that already
// fired. Counting is all this does: the prune-order judgment (truncation
// continuation → step-up → liveness) belongs to the future quarterly audit.
// AUTO-DECISION: the kind literals name the mechanism class, the ModelStat
// fields the counted event (probe → probeFails, continuation →
// lengthContinuations, stepup → stepUps), both in the existing one-word
// caliber of fail/stuck/reprompt (the kind is a call-site word, the field a
// stats-document key; two-word kinds would read as a new vocabulary where
// three more members of the existing one fit).
export type ModelEventKind = "fail" | "stuck" | "reprompt" | "probe" | "continuation" | "stepup"

export async function statsModelEvent(
  dir: string | undefined,
  model: string | undefined,
  kind: ModelEventKind,
): Promise<void> {
  if (!dir || model === undefined) return
  const { handle } = await ensure(dir)
  for (const bucket of [handle.doc.taskB, handle.doc.phaseB, handle.doc.roundB]) {
    const stat = ((bucket.models ??= {})[model] ??= emptyModelStat())
    if (kind === "fail") stat.fails += 1
    else if (kind === "stuck") stat.stuckHints += 1
    else if (kind === "reprompt") stat.reprompts += 1
    else if (kind === "probe") stat.probeFails += 1
    else if (kind === "continuation") stat.lengthContinuations += 1
    else stat.stepUps += 1
  }
  queueWrite(dir, handle)
}

// The lane report's usage booking (plans/0068 D7 landing step ④, D13, S4):
// the parent books each landed lane's figures into its run stats under the
// unit id — the durable per-lane record (a re-dispatched unit's later report
// accumulates into the same entry) — and, when the report carries the usage
// detail, folds that detail into the phase and round buckets so the
// conclusion's tokens line and the per-model/per-tier lines keep working
// under the scheduler: the run's real cost is the lanes' (the parent drives
// no task session while lanes are in flight, D4), and a roll-up that left
// them out would report a parallel round as its planning sessions alone.
// AUTO-DECISION (the detail folds into phaseB and roundB, never taskB): at
// landing time the parent's task bucket holds whichever unit the last
// dispatch switched it to — with lanes in flight that is not necessarily the
// landed unit — and the parent's task segment is its own sessions' caliber
// (taskEndLines guards on it); a landed lane's figures belong to the run's
// roll-up, and the lane's own task-granular story stays in the worktree's
// discarded document by contract (D6).
// AUTO-DECISION (wall time never folds): the buckets' wallMs/aiMs are the
// parent process's own clock, and lanes overlap — summing lane walls into
// them would inflate the run's duration (§10's hazard). Lane time stays a
// per-lane segment (wallMs per unit below), and the conclusion's time lines
// mean parent-wall, noted there.
export async function statsLaneUsage(
  dir: string | undefined,
  unit: string,
  usage: { tokens: number; wallMs: number; sessions: number; detail?: LaneUsageDetail },
): Promise<void> {
  if (!dir) return
  const { handle } = await ensure(dir)
  const entry = ((handle.doc.lanes ??= {})[unit] ??= { tokens: 0, wallMs: 0, sessions: 0 })
  entry.tokens += num(usage.tokens)
  entry.wallMs += num(usage.wallMs)
  entry.sessions += num(usage.sessions)
  if (usage.detail !== undefined) entry.booked = true
  const detail = usage.detail
  if (detail !== undefined) {
    for (const bucket of [handle.doc.phaseB, handle.doc.roundB]) {
      addUsage(bucket.usage, detail.usage)
      bucket.sessions += num(usage.sessions)
      for (const [name, stat] of Object.entries(detail.models ?? {})) {
        const target = ((bucket.models ??= {})[name] ??= emptyModelStat())
        addUsage(target.usage, stat.usage)
        target.sessions += num(stat.sessions)
        target.fails += num(stat.fails)
        target.stuckHints += num(stat.stuckHints)
        target.reprompts += num(stat.reprompts)
        target.probeFails += num(stat.probeFails)
        target.lengthContinuations += num(stat.lengthContinuations)
        target.stepUps += num(stat.stepUps)
      }
      for (const [name, stat] of Object.entries(detail.tiers ?? {})) {
        const target = ((bucket.tiers ??= {})[name] ??= emptyTierStat())
        addUsage(target.usage, stat.usage)
        target.sessions += num(stat.sessions)
      }
    }
  }
  queueWrite(dir, handle)
}

// The lanes section's roll-up for the conclusion (plans/0068 D13, S4): how
// many lanes landed, their summed sessions and tokens, the summed lane wall
// (an overlap sum, never a duration), and whether every landed report
// carried the usage detail — the claim "the totals above include the lanes"
// holds exactly then. Undefined without a lanes section: a run without
// lanes keeps the conclusion's exact prior shape.
export type LaneRollup = { lanes: number; sessions: number; tokens: number; wallMs: number; booked: boolean }

export async function statsLaneRollup(dir: string | undefined): Promise<LaneRollup | undefined> {
  if (!dir) return undefined
  const { handle } = await ensure(dir)
  const entries = Object.values(handle.doc.lanes ?? {})
  if (!entries.length) return undefined
  const sum = (pick: (entry: LaneStat) => number): number => entries.reduce((total, entry) => total + pick(entry), 0)
  return {
    lanes: entries.length,
    sessions: sum((entry) => entry.sessions),
    tokens: sum((entry) => entry.tokens),
    wallMs: sum((entry) => entry.wallMs),
    booked: entries.every((entry) => entry.booked === true),
  }
}

// ===== the plan-recorded execution mode (plans/0075 §2.4) =====

// Books the current task's resolved execution mode (runTask's mode
// resolution, src/runner.ts resolveDecompose): one record per task, replaced
// wholesale — a re-run or resumed dispatch of the same task re-books the same
// deterministic resolution, and the next task's booking retires the previous
// one. Lazy-loaded like the other writers when no handle exists.
export async function statsDecomposeRun(dir: string | undefined, run: DecomposeRun): Promise<void> {
  if (!dir) return
  const { handle } = await ensure(dir)
  handle.doc.decompose = run
  queueWrite(dir, handle)
}

// Reads the execution-mode record of one task: the record itself when its task
// matches, undefined otherwise (no record, another task's, or a leniently
// dropped bad one). Like statsTotals this lazily loads; taskEndLines calls it
// only after its statsId guard passed, so the handle is already present.
export async function statsDecomposeOf(dir: string | undefined, task: string): Promise<DecomposeRun | undefined> {
  if (!dir) return undefined
  const { handle } = await ensure(dir)
  const run = handle.doc.decompose
  return run?.task === task ? run : undefined
}

// The two pipeline-overhead bookings' shared shape (the classify and
// synthesis wrappers below): the named bucket key's per-model record in each
// of the three buckets gains the usage and one session — outside the
// unit-session totals, displayed beside the internal model names.
// Lazy-loaded like the other APIs when no handle exists.
async function bucketUsage(dir: string | undefined, bucketName: string, usage: Usage): Promise<void> {
  if (!dir) return
  const { handle } = await ensure(dir)
  for (const bucket of [handle.doc.taskB, handle.doc.phaseB, handle.doc.roundB]) {
    const stat = ((bucket.models ??= {})[bucketName] ??= emptyModelStat())
    addUsage(stat.usage, usage)
    stat.sessions += 1
  }
  queueWrite(dir, handle)
}

// The failure-message classifier's token booking (plans/0055 §7.1 "Stats"):
// recorded into each of the three buckets' `classify` bucket — outside the
// unit-session totals (not into the buckets' usage/sessions, not into
// per-session), displayed beside the internal model names. The classifier's
// one-shot session counts as a session (it is indeed a session, just one that
// belongs to no unit). Lazy-loaded like the other APIs when no handle exists.
export async function statsClassifyUsage(dir: string | undefined, usage: Usage): Promise<void> {
  await bucketUsage(dir, CLASSIFY_BUCKET, usage)
}

// The formulation one-shots' token booking (plans/0097 D6): the constructor
// and the fidelity pass, through the router's synthesis sink — same shape as
// the classify booking, its own bucket so the two pipelines' overhead stay
// readable apart in the per-model lines.
export async function statsSynthesisUsage(dir: string | undefined, usage: Usage): Promise<void> {
  await bucketUsage(dir, SYNTHESIS_BUCKET, usage)
}

// A wait-and-probe sleep spent on a quota window (plans/0057 §11 item 7):
// ms is added to the model's figure in the three buckets, beside the
// `recovery` wait the same sleep books through statsWaitBegin/End. The model
// key is the caller's (an internal name, else the model string the chain ran
// on). Unclamped: the caller passes the sleep it planned, or the part it
// slept before an /exit cut it short, never a clock difference a suspend
// could inflate. Lazy-loaded like the other APIs when no handle exists.
export async function statsQuotaWait(dir: string | undefined, model: string, ms: number): Promise<void> {
  if (!dir || !(ms > 0)) return
  const { handle } = await ensure(dir)
  for (const bucket of [handle.doc.taskB, handle.doc.phaseB, handle.doc.roundB]) {
    const waits = (bucket.quotaWaits ??= {})
    waits[model] = (waits[model] ?? 0) + ms
  }
  queueWrite(dir, handle)
}

// Knowledge-digest sizes per planning session (plans/0061 R3/A7): the
// estimated token sizes of the digests this planning session was injected
// with — priorKnowledge for the prior rounds' prior knowledge, prevRound for
// the previous round's conclusions — plus capped = the joined digest exceeded
// the cap and the prompt got the index form instead (the sizes stay the full
// digest's, which is the data the cap question needs). The same parallel
// three-bucket criterion as the other optional sections; nothing to book (no
// digest present, cap not tripped) writes nothing and creates no section, so
// a run without digests persists the exact prior shape.
export async function statsDigest(
  dir: string | undefined,
  sizes: { priorKnowledge?: number; prevRound?: number; capped?: boolean },
): Promise<void> {
  if (!dir) return
  const priorKnowledge = sizes.priorKnowledge !== undefined && sizes.priorKnowledge > 0 ? sizes.priorKnowledge : undefined
  const prevRound = sizes.prevRound !== undefined && sizes.prevRound > 0 ? sizes.prevRound : undefined
  if (priorKnowledge === undefined && prevRound === undefined && !sizes.capped) return
  const { handle } = await ensure(dir)
  for (const bucket of [handle.doc.taskB, handle.doc.phaseB, handle.doc.roundB]) {
    const digests = (bucket.digests ??= {})
    if (priorKnowledge !== undefined) {
      const stat = (digests.priorKnowledge ??= { sessions: 0, tokens: 0 })
      stat.sessions += 1
      stat.tokens += priorKnowledge
    }
    if (prevRound !== undefined) {
      const stat = (digests.prevRound ??= { sessions: 0, tokens: 0 })
      stat.sessions += 1
      stat.tokens += prevRound
    }
    if (sizes.capped) digests.capped = (digests.capped ?? 0) + 1
  }
  queueWrite(dir, handle)
}

// A knowledge phase's distillation completed (plans/0061 R3/A7: knowledge-
// phase use): booked when the k phase produced its document or found it
// already produced, so the count says how much knowledge machinery a round
// actually ran. Lazy-loaded like the other APIs when no handle exists.
export async function statsKnowledgePhase(dir: string | undefined): Promise<void> {
  if (!dir) return
  const { handle } = await ensure(dir)
  for (const bucket of [handle.doc.taskB, handle.doc.phaseB, handle.doc.roundB]) {
    const digests = (bucket.digests ??= {})
    digests.knowledgePhases = (digests.knowledgePhases ?? 0) + 1
  }
  queueWrite(dir, handle)
}

// Over the cap, evict the oldest by ascending at (eviction is lossless: the
// aggregate is already in the three buckets; losing per-session display
// history is an accepted trade-off, see the risks section of context.md).
function evictSessions(doc: StatsDoc) {
  const ids = Object.keys(doc.sessions)
  if (ids.length <= MAX_SESSIONS) return
  ids.sort((a, b) => doc.sessions[a].at - doc.sessions[b].at)
  for (const id of ids.slice(0, ids.length - MAX_SESSIONS)) delete doc.sessions[id]
}

// Human/planned wait begins: nesting depth +1; the outermost level folds the
// current segment then closes it (during the wait neither aiMs nor wallMs
// grows — total time excludes pure human wait, plan :14/:52) and persists.
// reason is currently unconsumed (the plan reserved it in the signature for
// future audit/vlog); its value is one of the existing wait kinds:
//   human waits — "askHuman" (in-session question), "waitBetweenTasks"
//   (--wait-between), "stepPause:<boundary>" (step-mode pause);
//   planned waits — "hibernate" (hibernate window, plans/0027), "recovery"
//   (wait-and-probe loop, plans/0015), "window" (model window wait,
//   plans/0055 §6.3 — when every candidate lies outside its window, sleep
//   until the earliest opening time plus hibernation jitter).
export async function statsWaitBegin(dir: string | undefined, reason?: string): Promise<void> {
  if (!dir) return
  const { handle } = await ensure(dir)
  handle.wait.depth += 1
  if (handle.wait.depth > 1) return // nested: overlapping waits are counted once
  fold(handle)
  handle.wait.ai = handle.doc.open?.ai ?? false
  handle.wait.start = clock()
  handle.doc.open = undefined
  queueWrite(dir, handle)
}

// Human wait ends: when the depth returns to zero, waitMs is posted alone into
// the three buckets (clamped by clampTick; inside a session it also counts
// toward per-session wallMs), the segment reopens with the pre-close ai flag,
// and the state is persisted. No-op without a paired begin.
export async function statsWaitEnd(dir: string | undefined): Promise<void> {
  if (!dir) return
  const { handle } = await ensure(dir)
  if (handle.wait.depth === 0) return
  handle.wait.depth -= 1
  if (handle.wait.depth > 0) return
  const now = clock()
  const ms = clampTick(now - handle.wait.start)
  if (ms) {
    for (const bucket of [handle.doc.taskB, handle.doc.phaseB, handle.doc.roundB]) {
      bucket.waitMs += ms
    }
    if (handle.lastKey !== undefined) {
      const session = handle.active.get(handle.lastKey)
      if (session) session.waitMs += ms
    }
  }
  handle.doc.open = { at: now, ai: handle.wait.ai }
  queueWrite(dir, handle)
}
