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
import { mkdir, realpath, rename } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { currentRound } from "./phases"

// ===== schema (v:1, compact JSON on disk; plans/STATS_PLAN.md :28-43) =====

// Usage accumulated incrementally per step-finish part (collection wiring is in T-003; this module only handles storage and aggregation).
export type Usage = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cost: number
  steps: number
}

export type Totals = {
  aiMs: number
  wallMs: number
  waitMs: number
  sessions: number
  tasks: number
  usage: Usage
}

export type Bucket = Totals & { id: string; since: number }

// Per-sessionID accumulation (requirement 2: sub-session continuation); task is the owning task, at is the last-active moment (eviction order).
export type SessionStat = {
  task: string
  aiMs: number
  wallMs: number
  rounds: number
  usage: Usage
  at: number
}

export type StatsDoc = {
  v: 1
  round: number // currentRound(dir) snapshot taken at load time
  phase: string // current phase, qualified id R-NN.P<nn> (maintained by statsPhase)
  open?: { at: number; ai: boolean } // at most one in-progress segment
  lastWriteAt: number // refreshed by any write = a proxy for the previous process's moment of death
  taskB: Bucket
  phaseB: Bucket
  roundB: Bucket
  sessions: Record<string, SessionStat>
  history: { rounds: number; totals: Totals } // aggregate of rolled-out past rounds (single bounded bucket)
}

// Resume information for loadStats (returned when an old document exists,
// printed by the startup banner; plans/STATS_PLAN.md §4.6). The snapshot is
// taken after depreciation posting and before round rollover — round/phase/task
// are the positions where the previous process stopped.
export type StatsResume = {
  round: number
  phase: string
  task?: string
  taskWallMs: number
  taskAiMs: number
  lastWriteAt: number
}

// Per-segment duration cap for fold/depreciation: abnormal gaps (clock
// rollback, suspend/wake, …) are truncated to 30 minutes (undercount rather
// than overcount).
export const MAX_TICK = 30 * 60_000

const FILE = join(".auto", "stats.json")

// AUTO-DECISION: now injection uses a module-level replaceable clock
// (setStatsClock test hook). The alternative was an optional now parameter on
// each API such as loadStats/fold — but fold also happens inside the heartbeat
// and the S03/S04 session/reading APIs, so the parameter would have to thread
// through every public API, polluting signatures, and the wiring layers
// (T-002/T-003) would have to pass it along too; a module-level clock is
// injected in one place and takes effect module-wide, tests just reset it in
// afterEach — the parameter variant was rejected.
let clock: () => number = Date.now

// Replace the stats module's clock (tests inject a deterministic now); calling
// with no argument restores Date.now.
export function setStatsClock(fn?: () => number) {
  clock = fn ?? Date.now
}

// ===== empty-value constructors =====

function emptyUsage(): Usage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 }
}

function emptyTotals(): Totals {
  return { aiMs: 0, wallMs: 0, waitMs: 0, sessions: 0, tasks: 0, usage: emptyUsage() }
}

function emptyBucket(id: string, since: number): Bucket {
  return { id, since, ...emptyTotals() }
}

function emptyDoc(round: number, now: number): StatsDoc {
  return {
    v: 1,
    round,
    phase: "",
    lastWriteAt: now,
    taskB: emptyBucket("", now),
    phaseB: emptyBucket("", now),
    roundB: emptyBucket(String(round), now),
    sessions: {},
    history: { rounds: 0, totals: emptyTotals() },
  }
}

// ===== lenient parsing (mirrors resume.ts parseProgress: per-field typeof check, bad = missing) =====

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function parseUsage(raw: unknown): Usage {
  const u = (raw ?? {}) as Record<string, unknown>
  return {
    input: num(u.input),
    output: num(u.output),
    reasoning: num(u.reasoning),
    cacheRead: num(u.cacheRead),
    cacheWrite: num(u.cacheWrite),
    cost: num(u.cost),
    steps: num(u.steps),
  }
}

function parseTotals(raw: unknown): Totals {
  const t = (raw ?? {}) as Record<string, unknown>
  return {
    aiMs: num(t.aiMs),
    wallMs: num(t.wallMs),
    waitMs: num(t.waitMs),
    sessions: num(t.sessions),
    tasks: num(t.tasks),
    usage: parseUsage(t.usage),
  }
}

function parseBucket(raw: unknown, fallbackId: string): Bucket {
  const b = (raw ?? {}) as Record<string, unknown>
  return { id: str(b.id) || fallbackId, since: num(b.since), ...parseTotals(b) }
}

function parseSessions(raw: unknown): Record<string, SessionStat> {
  const sessions: Record<string, SessionStat> = {}
  if (typeof raw !== "object" || !raw) return sessions
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value !== "object" || !value) continue // skip a bad entry (lossless: already in the buckets)
    const s = value as Record<string, unknown>
    sessions[id] = {
      task: str(s.task),
      aiMs: num(s.aiMs),
      wallMs: num(s.wallMs),
      rounds: num(s.rounds),
      usage: parseUsage(s.usage),
      at: num(s.at),
    }
  }
  return sessions
}

function parseStatsDoc(raw: string): StatsDoc | undefined {
  try {
    const p = JSON.parse(raw) as Record<string, unknown>
    if (typeof p !== "object" || !p) return undefined
    const open = p.open as Record<string, unknown> | undefined
    const history = (p.history ?? {}) as Record<string, unknown>
    return {
      v: 1,
      round: num(p.round),
      phase: str(p.phase),
      open: num(open?.at) > 0 ? { at: num(open?.at), ai: open?.ai === true } : undefined,
      lastWriteAt: num(p.lastWriteAt),
      taskB: parseBucket(p.taskB, ""),
      phaseB: parseBucket(p.phaseB, ""),
      roundB: parseBucket(p.roundB, ""),
      sessions: parseSessions(p.sessions),
      history: { rounds: num(history.rounds), totals: parseTotals(history.totals) },
    }
  } catch {
    return undefined
  }
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
  if (open.ai && handle.session) handle.session.aiMs += ms
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
// reset by the next statsTask/statsPhase.
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
  session?: ActiveSession // the in-progress AI session (maintained by statsSessionBegin/End)
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
  handle.session = undefined
  fold(handle)
  handle.doc.open = undefined
  queueWrite(dir, handle)
  await handle.writing
  handles.delete(dir)
}

// ===== hierarchy switching and readings (statsPhase/statsTask/statsTotals/statsId/statsBoot) =====

function copyTotals(t: Totals): Totals {
  return {
    aiMs: t.aiMs,
    wallMs: t.wallMs,
    waitMs: t.waitMs,
    sessions: t.sessions,
    tasks: t.tasks,
    usage: { ...t.usage },
  }
}

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

export type StatsScope = "task" | "phase" | "round"

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

function addUsage(target: Usage, delta: Usage) {
  target.input += num(delta.input)
  target.output += num(delta.output)
  target.reasoning += num(delta.reasoning)
  target.cacheRead += num(delta.cacheRead)
  target.cacheWrite += num(delta.cacheWrite)
  target.cost += num(delta.cost)
  target.steps += num(delta.steps)
}

// Before prompt dispatch (runner attempt): fold the current segment, then open
// an AI segment, associate the current task, and start the 30s heartbeat
// (fold + persist, unref).
// AUTO-DECISION: no disk write at begin — the first heartbeat right after
// (≤30s) persists the fold result, and the kill -9 loss stays bounded by the
// heartbeat period; the alternative "queueWrite at begin" only narrows the
// window by a few seconds while adding one disk write per session, rejected.
// A session already in progress at begin (parallel, or an unpaired end on an
// abnormal path): the old session's in-memory accumulators are abandoned
// (already posted losslessly to the three buckets; per-session undercounts),
// and the new session accumulates from zero.
export async function statsSessionBegin(dir: string | undefined, taskID: string): Promise<void> {
  if (!dir) return
  const { handle } = await ensure(dir)
  fold(handle)
  handle.session = { task: taskID, aiMs: 0, waitMs: 0 }
  handle.doc.open = { at: clock(), ai: true }
  startHeartbeat(dir, handle)
}

// The printable report of statsSessionEnd (the ◉ session-end line, consumed by
// T-003/T-004): thisAiMs = this session's AI duration; session = that
// sessionID's cross-interruption accumulation (this one included);
// task/phase/round = copies of the three buckets' current accumulations (same
// caliber as statsTotals).
export type StatsSessionReport = {
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
export async function statsSessionEnd(
  dir: string | undefined,
  sessionID: string,
  usage: Usage,
): Promise<StatsSessionReport | undefined> {
  if (!dir) return undefined
  const { handle } = await ensure(dir)
  fold(handle)
  stopHeartbeat(handle)
  const active = handle.session
  handle.session = undefined
  const doc = handle.doc
  const now = clock()
  // Close the AI segment and reopen a wall-clock segment; if currently inside
  // a human wait (the segment is already closed), waitEnd does the reopening —
  // wait.ai flips back to false so what resumes after the wait is a wall-clock
  // segment, not the ended session's AI segment.
  if (handle.wait.depth === 0) doc.open = { at: now, ai: false }
  else handle.wait.ai = false
  for (const bucket of [doc.taskB, doc.phaseB, doc.roundB]) {
    bucket.sessions += 1
    addUsage(bucket.usage, usage)
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
  return {
    thisAiMs: active?.aiMs ?? 0,
    session: { ...entry, usage: { ...entry.usage } },
    task: extrapolate(doc, doc.taskB),
    phase: extrapolate(doc, doc.phaseB),
    round: extrapolate(doc, doc.roundB),
  }
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
    if (handle.session) handle.session.waitMs += ms
  }
  handle.doc.open = { at: now, ai: handle.wait.ai }
  queueWrite(dir, handle)
}
