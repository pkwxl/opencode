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
// A v:1 backward-compatible extension (plans/0055 §7.1 "Stats"): the buckets
// and the history aggregate may carry two optional sections, models/tiers
// (usage and counts per internal model name / per tier). Older documents
// without the two sections still load (lenient parsing defaults them empty);
// runs without a registry never write them, the shape stays byte-identical
// (C2).

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
  // Usage and sessions per internal model name, and per protocol-drift
  // counter, booked beside the bucket's own usage (plans/0055 §7.1 "Stats",
  // §10 item 12). A raw `provider/model` override value is keyed by its raw
  // string; the failure-message classifier's tokens sit in the `classify`
  // bucket. Optional and absent until the first booking, so a run without a
  // model registry persists the exact pre-registry shape (C2: byte-identical).
  models?: Record<string, ModelStat>
  // Usage and sessions per reasoning tier of the sessions booked above
  // (plans/0055 §10 item 12): same booking point, key = the tier the dispatch
  // was routed as. Optional for the same C2 reason.
  tiers?: Record<string, TierStat>
  // Time slept in the wait-and-probe loop for a quota window, in ms per
  // model (plans/0057 §11 item 7): the model whose limit the wait was for —
  // an internal name under a registry, else the model the chain ran on. The
  // same wait is also in waitMs (the `recovery` wait, clamped per segment
  // like every wait); this figure is the planned sleep, unclamped, so a
  // five-hour window reads as the hours it cost. Optional and absent until
  // the first such wait, so a run without one keeps the exact shape.
  quotaWaits?: Record<string, number>
}

// Per-model record: the usage booked for the model, how many sessions ran on
// it, and the counters that read its protocol drift (plans/0055 §10 item 3) —
// report `Result: FAIL` verdicts it wrote, stuck hints it needed, and
// shape-check re-prompts its sessions caused.
export type ModelStat = {
  usage: Usage
  sessions: number
  fails: number
  stuckHints: number
  reprompts: number
}

// Per-tier record: the usage and session count of every session routed as
// that tier, so the savings of tier routing can be measured.
export type TierStat = {
  usage: Usage
  sessions: number
}

// The bucket the failure-message classifier's tokens go to (plans/0055 §7.1
// "Stats"): outside the unit's session totals, keyed beside the internal
// model names.
// AUTO-DECISION: one shared `classify` bucket, not one per classifier entry
// (the conclusion's per-model lines exist to compare the fleet's cost and
// drift; the classifier is overhead of the run's error handling, and operators
// rotate the classifier entry without caring which one answered). The
// collision edge — an internal model literally named `classify` would share
// the bucket — is accepted: the name is a plausible classifier name anyway,
// and separating them would complicate every reader for an edge no registry
// in practice hits.
export const CLASSIFY_BUCKET = "classify"

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
    models: parseModelStats(t.models),
    tiers: parseTierStats(t.tiers),
    quotaWaits: parseQuotaWaits(t.quotaWaits),
  }
}

// Quota-window waits per model, leniently (bad entry skipped); an absent or
// empty section returns undefined (the C2 shape).
function parseQuotaWaits(raw: unknown): Record<string, number> | undefined {
  if (typeof raw !== "object" || !raw) return undefined
  const waits: Record<string, number> = {}
  for (const [name, value] of Object.entries(raw)) {
    const ms = num(value)
    if (ms > 0) waits[name] = ms
  }
  return Object.keys(waits).length ? waits : undefined
}

// Per-model records, leniently (mirror parseUsage: bad = missing, never
// throws). An absent or empty section returns undefined, keeping the persisted
// shape of an un-routed run byte-identical on load→write round trips (C2).
function parseModelStats(raw: unknown): Record<string, ModelStat> | undefined {
  if (typeof raw !== "object" || !raw) return undefined
  const models: Record<string, ModelStat> = {}
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value !== "object" || !value) continue // bad entry skipped
    const m = value as Record<string, unknown>
    models[name] = {
      usage: parseUsage(m.usage),
      sessions: num(m.sessions),
      fails: num(m.fails),
      stuckHints: num(m.stuckHints),
      reprompts: num(m.reprompts),
    }
  }
  return Object.keys(models).length ? models : undefined
}

function parseTierStats(raw: unknown): Record<string, TierStat> | undefined {
  if (typeof raw !== "object" || !raw) return undefined
  const tiers: Record<string, TierStat> = {}
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value !== "object" || !value) continue
    const t = value as Record<string, unknown>
    tiers[name] = { usage: parseUsage(t.usage), sessions: num(t.sessions) }
  }
  return Object.keys(tiers).length ? tiers : undefined
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
  doc.history.rounds += 1
}

// ===== per-model / per-tier booking (plans/0055 §7.1 "Stats", §10 items 3/12) =====

function emptyModelStat(): ModelStat {
  return { usage: emptyUsage(), sessions: 0, fails: 0, stuckHints: 0, reprompts: 0 }
}

function emptyTierStat(): TierStat {
  return { usage: emptyUsage(), sessions: 0 }
}

// Sum one bucket's per-model/per-tier sections and its quota-window waits
// into an aggregate Totals (history at round rollover): creates the sections
// lazily, so an aggregate
// that received no model data stays without them (C2 shape).
function mergeModelStats(into: Totals, from: Totals) {
  for (const [name, stat] of Object.entries(from.models ?? {})) {
    const target = ((into.models ??= {})[name] ??= emptyModelStat())
    addUsage(target.usage, stat.usage)
    target.sessions += stat.sessions
    target.fails += stat.fails
    target.stuckHints += stat.stuckHints
    target.reprompts += stat.reprompts
  }
  for (const [name, stat] of Object.entries(from.tiers ?? {})) {
    const target = ((into.tiers ??= {})[name] ??= emptyTierStat())
    addUsage(target.usage, stat.usage)
    target.sessions += stat.sessions
  }
  for (const [name, ms] of Object.entries(from.quotaWaits ?? {})) {
    const waits = (into.quotaWaits ??= {})
    waits[name] = (waits[name] ?? 0) + ms
  }
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
    ...(t.models !== undefined ? { models: copyModelStats(t.models) } : {}),
    ...(t.tiers !== undefined ? { tiers: copyTierStats(t.tiers) } : {}),
    ...(t.quotaWaits !== undefined ? { quotaWaits: { ...t.quotaWaits } } : {}),
  }
}

function copyModelStats(models: Record<string, ModelStat>): Record<string, ModelStat> {
  const out: Record<string, ModelStat> = {}
  for (const [name, stat] of Object.entries(models)) out[name] = { ...stat, usage: { ...stat.usage } }
  return out
}

function copyTierStats(tiers: Record<string, TierStat>): Record<string, TierStat> {
  const out: Record<string, TierStat> = {}
  for (const [name, stat] of Object.entries(tiers)) out[name] = { ...stat, usage: { ...stat.usage } }
  return out
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
// model/tier (passed in by attempt under a registry, plans/0055 §7.1
// "Stats"): the candidate key — an internal name, or the raw
// `provider/model` string of an override value — plus this dispatch's tier;
// when given, usage and sessions are booked in parallel per model and per
// tier into the three buckets (the same booking point as the buckets' own
// usage, one cumulative criterion across interruptions). Defaulted (no
// registry): no models/tiers sections are created, the persisted shape stays
// byte-identical (C2).
export async function statsSessionEnd(
  dir: string | undefined,
  sessionID: string,
  usage: Usage,
  model?: string,
  tier?: string,
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
// in the document across interruptions. A defaulted model (no registry, no
// chosen entry on the chain) is a no-op and creates no models section (C2).
// The event was already judged by the caller at its observation point; this
// only stores it.
// AUTO-DECISION: the counts go to the three buckets in parallel (task/phase/
// round each +1), not a single "round bucket only" criterion — the three
// buckets are this module's standing parallel accumulation model (phase time
// including non-task time is not folded either), a single-layer criterion
// would leave "how often this model drifted in this task" unreadable; the
// three copies are bounded and self-consistent.
export type ModelEventKind = "fail" | "stuck" | "reprompt"

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
    else stat.reprompts += 1
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
  if (!dir) return
  const { handle } = await ensure(dir)
  for (const bucket of [handle.doc.taskB, handle.doc.phaseB, handle.doc.roundB]) {
    const stat = ((bucket.models ??= {})[CLASSIFY_BUCKET] ??= emptyModelStat())
    addUsage(stat.usage, usage)
    stat.sessions += 1
  }
  queueWrite(dir, handle)
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
