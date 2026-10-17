// The stats document's schema half (plans/0102 D7, the src/models-schema.ts
// precedent): the types of the persisted v:1 document, the empty-value
// constructors, the lenient per-field parsers (mirrors resume.ts
// parseProgress, bad = missing, no throw), and the pure copy / add / merge
// functions over those shapes. Pure — the only import is the document
// domain's decompose-mode vocabulary; the loader (src/stats.ts) validates
// nothing here, it only persists what the store books, and a type-only
// importer binds no store code. The store and its public APIs stay in
// src/stats.ts, which re-exports this module's public surface so its
// consumers keep their single import point.
import { DECOMPOSE_MODES, type DecomposeMode } from "./document/unit"

// ===== schema (v:1, compact JSON on disk; plans/STATS_PLAN.md :28-43) =====
// A v:1 backward-compatible extension (plans/0055 §7.1 "Stats"): the buckets
// and the history aggregate may carry two optional sections, models/tiers
// (usage and counts per internal model name / per tier). Older documents
// without the two sections still load (lenient parsing defaults them empty);
// a document nothing books into never gains them.

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
  // bucket. Optional and absent until the first booking, so a document
  // nothing books into never gains them.
  models?: Record<string, ModelStat>
  // Usage and sessions per reasoning tier of the sessions booked above
  // (plans/0055 §10 item 12): same booking point, key = the tier the dispatch
  // was routed as. Optional for the same reason.
  tiers?: Record<string, TierStat>
  // Time slept in the wait-and-probe loop for a quota window, in ms per
  // model (plans/0057 §11 item 7): the model whose limit the wait was for —
  // an internal name under a registry, else the model the chain ran on. The
  // same wait is also in waitMs (the `recovery` wait, clamped per segment
  // like every wait); this figure is the planned sleep, unclamped, so a
  // five-hour window reads as the hours it cost. Optional and absent until
  // the first such wait, so a run without one keeps the exact shape.
  quotaWaits?: Record<string, number>
  // Knowledge-digest counters (plans/0061 R3/A7): per planning session the
  // sizes of the injected digests (estimated tokens), how often the cap
  // replaced the full text with the index form, and how many knowledge
  // phases distilled. Booked so the memory-service question — do real
  // rounds run digests near the cap? — has data. Optional and absent until
  // the first booking, so a run without digests keeps the exact shape.
  digests?: DigestStats
}

// One injected digest kind's counters: how many planning sessions received
// it and the cumulative estimated size (the same token estimate the usage
// source uses).
export type DigestStat = {
  sessions: number
  tokens: number
}

// The digest counter section of a bucket: the two digest kinds, the cap
// trips, and the knowledge phases that ran a distillation.
export type DigestStats = {
  priorKnowledge?: DigestStat
  prevRound?: DigestStat
  // Times the joined digest exceeded the cap and the planning prompt got
  // the index form instead of the full texts.
  capped?: number
  // Knowledge phases whose distillation completed (produced now or found
  // already produced).
  knowledgePhases?: number
}

// Per-model record: the usage booked for the model, how many sessions ran on
// it, and the counters that read its protocol drift (plans/0055 §10 item 3) —
// report `Result: FAIL` verdicts it wrote, stuck hints it needed, and
// shape-check re-prompts its sessions caused — plus the compensation
// counters of plans/0069 §2.4: recovery probes of the wait-and-probe loop
// that failed on it, length-cut continuation dispatches its truncated
// replies caused, and context step-ups its sessions took.
export type ModelStat = {
  usage: Usage
  sessions: number
  fails: number
  stuckHints: number
  reprompts: number
  probeFails: number
  lengthContinuations: number
  stepUps: number
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

// The bucket the formulation one-shots' tokens go to (plans/0097 D6): the
// constructor (deep-tier, six figures of input tokens on a handover-rich
// round) and the fidelity pass — outside the unit's session totals, keyed
// beside the internal model names, the classify precedent. One shared bucket
// for both one-shots (they are one pipeline; the run log and the audit name
// which ran), and the same collision edge accepted for the same reason.
export const SYNTHESIS_BUCKET = "synthesis"

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
  // Per-lane usage of the units this run landed through lanes (plans/0068
  // D7 step ④, D13): keyed by the unit id, accumulated across a unit's
  // re-dispatches. Additive and absent until the first landing, so a run
  // without lanes keeps the exact persisted shape. Since S4 the roll-up is
  // wired: `booked` marks a unit whose report carried the usage detail (the
  // figures below also folded into the phase/round buckets), and the
  // conclusion's lanes line reads the section through statsLaneRollup.
  lanes?: Record<string, LaneStat>
  // The current task's plan-recorded execution mode (plans/0075 §2.4): what
  // the runner resolved the task to run under and where the decision came
  // from — the observability input of the task-end conclusion line (the
  // falsifier evaluation reads whether the planning sessions' choices were
  // any good). One record, replaced at every runTask start; absent until the
  // first booking, so the persisted shape of a run without it is unchanged.
  decompose?: DecomposeRun
}

// The per-task execution-mode record (plans/0075 §2.4): `mode` = the subtask
// mode the task actually ran under (the opts.subtask vocabulary after the
// field's mapping); `from` = where the decision came from — the task
// document's Decompose field, auto's adaptive fallback (no field), or a hard
// --subtask override; `field` = the task's recorded field value when one is
// present; `downgraded` = the field said split but the fleet cannot fork
// (Opts.leadSplit === false), so it ran as one whole-task session.
// AUTO-DECISION: the mode words are restated here (opts.ts SUBTASK_MODES is
// the frozen --subtask vocabulary) instead of imported — stats sits below
// opts in the graph and the import-direction cycle check counts type edges,
// so not even the type may cross; the words are constitutional and change
// with a plan, at which point this restatement changes with them.
type SubtaskModeWord = "off" | "auto" | "true" | "ondemand"
const SUBTASK_WORDS: readonly SubtaskModeWord[] = ["off", "auto", "true", "ondemand"]

export type DecomposeRun = {
  task: string
  mode: SubtaskModeWord
  from: "field" | "fallback" | "override"
  field?: DecomposeMode
  downgraded?: boolean
}

// One landed lane's booked figures: the report's usage (a single token
// figure — the sum of the lane's own task bucket's usage fields) and its
// session count. `booked` (S4): the report carried the usage detail, so the
// figures also folded into the parent's phase/round buckets — the
// conclusion's "inside the totals" claim reads it.
export type LaneStat = { tokens: number; wallMs: number; sessions: number; booked?: boolean }

// The usage detail a lane report carries beside its headline figures since
// S4 (plans/0068 D13): the lane's own task bucket's usage breakdown and its
// per-model / per-tier sections — the shapes this module already keeps,
// restated on the report so the parent can book them without reading the
// worktree's discarded stats document. Absent on a report an older shape
// wrote; the booking then stays at the per-unit lanes entry.
export type LaneUsageDetail = {
  usage: Usage
  models?: Record<string, ModelStat>
  tiers?: Record<string, TierStat>
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

// ===== empty-value constructors =====

export function emptyUsage(): Usage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 }
}

export function emptyTotals(): Totals {
  return { aiMs: 0, wallMs: 0, waitMs: 0, sessions: 0, tasks: 0, usage: emptyUsage() }
}

export function emptyBucket(id: string, since: number): Bucket {
  return { id, since, ...emptyTotals() }
}

export function emptyDoc(round: number, now: number): StatsDoc {
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

export function emptyModelStat(): ModelStat {
  return { usage: emptyUsage(), sessions: 0, fails: 0, stuckHints: 0, reprompts: 0, probeFails: 0, lengthContinuations: 0, stepUps: 0 }
}

export function emptyTierStat(): TierStat {
  return { usage: emptyUsage(), sessions: 0 }
}

// ===== lenient parsing (mirrors resume.ts parseProgress: per-field typeof check, bad = missing) =====

export function num(value: unknown): number {
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
    digests: parseDigestStats(t.digests),
  }
}

// Digest counters, leniently (mirror parseQuotaWaits: bad fields read as
// missing, never throws). An absent or empty section returns undefined,
// keeping the persisted shape of a run without digests byte-identical on
// load→write round trips.
function parseDigestStat(raw: unknown): DigestStat | undefined {
  if (typeof raw !== "object" || !raw) return undefined
  const s = raw as Record<string, unknown>
  const sessions = num(s.sessions)
  const tokens = num(s.tokens)
  return sessions > 0 || tokens > 0 ? { sessions, tokens } : undefined
}

function parseDigestStats(raw: unknown): DigestStats | undefined {
  if (typeof raw !== "object" || !raw) return undefined
  const d = raw as Record<string, unknown>
  const priorKnowledge = parseDigestStat(d.priorKnowledge)
  const prevRound = parseDigestStat(d.prevRound)
  const capped = num(d.capped)
  const knowledgePhases = num(d.knowledgePhases)
  const digests: DigestStats = {
    ...(priorKnowledge ? { priorKnowledge } : {}),
    ...(prevRound ? { prevRound } : {}),
    ...(capped > 0 ? { capped } : {}),
    ...(knowledgePhases > 0 ? { knowledgePhases } : {}),
  }
  return Object.keys(digests).length ? digests : undefined
}

// Quota-window waits per model, leniently (bad entry skipped); an absent or
// empty section returns undefined, keeping the section out of the persisted
// shape.
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
// shape of a document without model data byte-identical on load→write round
// trips.
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
      probeFails: num(m.probeFails),
      lengthContinuations: num(m.lengthContinuations),
      stepUps: num(m.stepUps),
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

export function parseStatsDoc(raw: string): StatsDoc | undefined {
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
      lanes: parseLaneStats(p.lanes),
      decompose: parseDecomposeRun(p.decompose),
    }
  } catch {
    return undefined
  }
}

// The execution-mode record, leniently (the parseLaneStats mirror): a bad
// record reads as missing — the conclusion line it feeds is observability, and
// a corrupted entry must never weigh more than its absence. The enum fields
// survive only with a legal value.
function parseDecomposeRun(raw: unknown): DecomposeRun | undefined {
  if (typeof raw !== "object" || !raw) return undefined
  const r = raw as Record<string, unknown>
  const task = str(r.task)
  const mode = str(r.mode)
  const from = str(r.from)
  if (!task || !SUBTASK_WORDS.includes(mode as SubtaskModeWord) || !["field", "fallback", "override"].includes(from)) return undefined
  const field = str(r.field)
  return {
    task,
    mode: mode as SubtaskModeWord,
    from: from as DecomposeRun["from"],
    ...(DECOMPOSE_MODES.includes(field as DecomposeMode) ? { field: field as DecomposeMode } : {}),
    ...(r.downgraded === true ? { downgraded: true } : {}),
  }
}

// Lane records, leniently (the parseSessions mirror): a bad entry reads as
// missing fields, an absent or empty section stays absent. `booked` survives
// a round trip only when true (the S4 marker of a detail-bearing report).
function parseLaneStats(raw: unknown): Record<string, LaneStat> | undefined {
  if (typeof raw !== "object" || !raw) return undefined
  const lanes: Record<string, LaneStat> = {}
  for (const [unit, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "object" || !value) continue
    const entry = value as Record<string, unknown>
    lanes[unit] = { tokens: num(entry.tokens), wallMs: num(entry.wallMs), sessions: num(entry.sessions), ...(entry.booked === true ? { booked: true } : {}) }
  }
  return Object.keys(lanes).length ? lanes : undefined
}

// ===== pure aggregation over the shapes =====

// Add one usage delta onto a target (lenient per field: a NaN or non-number
// delta field adds 0 — the store's booking points feed parsed or in-memory
// values alike).
export function addUsage(target: Usage, delta: Usage) {
  target.input += num(delta.input)
  target.output += num(delta.output)
  target.reasoning += num(delta.reasoning)
  target.cacheRead += num(delta.cacheRead)
  target.cacheWrite += num(delta.cacheWrite)
  target.cost += num(delta.cost)
  target.steps += num(delta.steps)
}

// ===== copy functions =====

export function copyTotals(t: Totals): Totals {
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
    ...(t.digests !== undefined ? { digests: copyDigestStats(t.digests) } : {}),
  }
}

function copyDigestStats(digests: DigestStats): DigestStats {
  return {
    ...(digests.priorKnowledge ? { priorKnowledge: { ...digests.priorKnowledge } } : {}),
    ...(digests.prevRound ? { prevRound: { ...digests.prevRound } } : {}),
    ...(digests.capped !== undefined ? { capped: digests.capped } : {}),
    ...(digests.knowledgePhases !== undefined ? { knowledgePhases: digests.knowledgePhases } : {}),
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

// ===== merge functions (history aggregation at round rollover) =====

// Sum one bucket's per-model/per-tier sections and its quota-window waits
// into an aggregate Totals (history at round rollover): creates the sections
// lazily, so an aggregate
// that received no model data stays without them.
export function mergeModelStats(into: Totals, from: Totals) {
  for (const [name, stat] of Object.entries(from.models ?? {})) {
    const target = ((into.models ??= {})[name] ??= emptyModelStat())
    addUsage(target.usage, stat.usage)
    target.sessions += stat.sessions
    target.fails += stat.fails
    target.stuckHints += stat.stuckHints
    target.reprompts += stat.reprompts
    target.probeFails += stat.probeFails
    target.lengthContinuations += stat.lengthContinuations
    target.stepUps += stat.stepUps
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

// Sum one bucket's digest counters into an aggregate Totals (history at round
// rollover): creates the section lazily, so an aggregate that received no
// digest data stays without it (the same shape rule as the model sections).
export function mergeDigestStats(into: Totals, from: Totals) {
  if (!from.digests) return
  const digests = (into.digests ??= {})
  for (const key of ["priorKnowledge", "prevRound"] as const) {
    const stat = from.digests[key]
    if (!stat) continue
    const target = (digests[key] ??= { sessions: 0, tokens: 0 })
    target.sessions += stat.sessions
    target.tokens += stat.tokens
  }
  if (from.digests.capped) digests.capped = (digests.capped ?? 0) + from.digests.capped
  if (from.digests.knowledgePhases) digests.knowledgePhases = (digests.knowledgePhases ?? 0) + from.digests.knowledgePhases
}
