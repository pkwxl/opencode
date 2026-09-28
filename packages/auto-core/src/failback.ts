// Failback and /failback (design document plans/0017-model-routing-design.md):
// OPENCODE_AUTO_MODEL_FAILBACK_SCOPE controls at which pipeline boundary the
// reset back to the preferred model happens after failing over to a
// candidate — inclusive granularity (the same RANK idea as step.ts): phase
// only at phase boundaries (failover stays sticky across tasks, carried by
// this module's sticky holder); task (default) = the status quo, the chain
// is destroyed per task and zeroes out naturally, no code needed; subtask
// adds the subtask boundary (clears chain.model); session fails back to
// the preferred model at every new-session start (attempt's new-session
// branch zeroes it; the migrated session forked out by failover goes the
// pending path and does not trigger it, to prevent oscillation).
//
// /failback (the standing input line of --interactive, isomorphic to /exit):
// once set it is consumed at the next safe boundary (phase/task/subtask,
// hook points as in step.ts) — throws nothing, takes no exit-code channel,
// only resets failover state; with arguments it redefines the model order
// wholesale (the first is the preferred wildcard, the rest the failover
// candidate ring), overriding switches.model at run time through this
// module's override layer (the switches memo stays constant, nothing
// changed in place).
//
// Down marks (plans/0055 §6.4): the down marks under the model registry —
// "down" recorded by the model's internal name (and by provider+key
// reference, for a later step's key rings), cleared at the
// OPENCODE_AUTO_MODEL_FAILBACK_SCOPE boundaries and /failback; a mark with
// until lives until that instant. A run without a registry writes no
// marks, and the sticky semantics hold byte for byte.
import type { Boundary } from "./control-types"
import { log } from "./log"
import type { FailbackScope } from "./switches"

// The fineness order of boundaries and granularities: the finer the value,
// the larger the rank; boundary rank ≤ granularity rank means reset (session
// has no matching Boundary — for a candidate on the chain its reset point is
// attempt's new-session branch; for the down marks below, "session" is
// scope=session's equivalent boundary: marks cleared at every new-session
// start).
const RANK: Record<FailbackScope | Boundary, number> = { phase: 1, task: 2, subtask: 3, session: 4 }

// Whether the granularity covers the boundary (pure function, for unit
// tests): inclusive — session covers every boundary, subtask covers
// subtask/task/phase, task covers task and phase (all carried naturally by
// the chain/holder lifetimes), phase covers only phase. "session" as a
// boundary is covered only by scope=session.
export function failbackApplies(scope: FailbackScope, boundary: Boundary | "session"): boolean {
  return RANK[boundary] <= RANK[scope]
}

// Single-process module state (each CLI invocation is its own process, a
// natural reset; unit tests reset through resetFailback):
// - sticky: the cross-task failover holder of phase granularity, written by
//   switchModel only under scope=phase, cleared unconditionally at phase
//   boundaries (undefined under every other granularity, the clear is a
//   no-op);
// - pending: the /failback request (optionally redefining the model order
//   wholesale);
// - override: the run-time model-order override left after a parameterized
//   /failback is consumed; attempt/switchModel read it ahead of
//   switches.model (without breaking the switches-memo constancy
//   convention).
let sticky: string | undefined
let pending: { order?: string[] } | undefined
let override: { wildcard: string; fallback: string[] } | undefined

// ---------------------------------------------------------------------------
// Down marks (plans/0055 §6.4): under a model registry, a classified failure
// marks a model down and a key failure marks a key down (the key half feeds
// the per-provider rings of a later step); selection then moves to the next
// usable candidate, and the primary returns when its mark clears. The marks
// take over from the phase-scoped `sticky` holder, which keeps its exact
// no-registry semantics: marks are written only where a registry drives the
// failover, so a run without one never touches them.
//
// Marks live in memory only (nothing persists); a new run starts with every
// model eligible. The resets a failure states do outlive the run, as the
// account's learned windows (src/quota-windows.ts, plans/0057 §8), but those
// only time the recovery wait's sleep and never become a mark. Marks are
// keyed by the model's internal name (a raw override value by its model
// string, matching how selection reads them) and by (provider, key
// reference) for a ring. A mark may carry `until`, the instant
// a reset time named: it lasts until that instant *instead of* the scope
// boundary, so a boundary clear keeps it and a read past the instant treats
// it as cleared.
// ---------------------------------------------------------------------------

// A down mark; `until` (epoch ms) is the instant a reset time named, absent
// = the mark clears at the scope boundaries. `classifier` = the class that
// wrote the mark came from the failure-message classifier (plans/0055 §7.1),
// so the ◈ line names the move `quota (classifier)` (§6.5).
export type DownMark = { until?: number; classifier?: true }

const downModels = new Map<string, DownMark>()
const downKeys = new Map<string, Map<string, DownMark>>()

// The run's model down marks by internal name; selection reads this map
// through its context. The map is never replaced, only mutated, so a held
// reference stays live.
export function downMarks(): ReadonlyMap<string, DownMark> {
  return downModels
}

export function markModelDown(model: string, until?: number, classifier?: boolean): void {
  downModels.set(model, { ...(until !== undefined ? { until } : {}), ...(classifier === true ? { classifier: true as const } : {}) })
}

// A reset time that became known after the mark was written (the
// classifier's answer arriving after the turn ended, plans/0055 §7.1): the
// mark now lasts until that instant instead of the scope boundary. Only an
// existing mark is changed — a mark a boundary or /failback already cleared
// is not written again.
export function extendModelDownMark(model: string, until: number): boolean {
  const mark = downModels.get(model)
  if (mark === undefined) return false
  downModels.set(model, { ...mark, until })
  return true
}

// Removes one model's mark (the recovery probe's "a successful probe clears
// that candidate's mark", §6.3; a failed probe re-marks it through the
// caller). Key marks are not touched.
export function clearModelDownMark(model: string): void {
  downModels.delete(model)
}

export function modelDownMark(model: string): DownMark | undefined {
  return downModels.get(model)
}

export function isModelDown(model: string, now: number): boolean {
  const mark = downModels.get(model)
  return mark !== undefined && (mark.until === undefined || mark.until > now)
}

// Key marks, per provider and key reference (the ring position itself never
// moves back, §4.3; only whether a key is down lives here).
export function markKeyDown(provider: string, key: string, until?: number): void {
  let marks = downKeys.get(provider)
  if (marks === undefined) {
    marks = new Map()
    downKeys.set(provider, marks)
  }
  marks.set(key, until !== undefined ? { until } : {})
}

// The key-mark counterpart of extendModelDownMark: an existing key mark
// lasts until `until`.
export function extendKeyDownMark(provider: string, key: string, until: number): boolean {
  const marks = downKeys.get(provider)
  const mark = marks?.get(key)
  if (marks === undefined || mark === undefined) return false
  marks.set(key, { ...mark, until })
  return true
}

export function keyDownMark(provider: string, key: string): DownMark | undefined {
  return downKeys.get(provider)?.get(key)
}

export function isKeyDown(provider: string, key: string, now: number): boolean {
  const mark = keyDownMark(provider, key)
  return mark !== undefined && (mark.until === undefined || mark.until > now)
}

// Clears one provider's key marks: the recovery probe's ring half (§6.3 —
// the probe candidate ignores the down marks and the ring). The ring
// position itself lives in src/keyring.ts and never moves here.
export function clearKeyDownMarks(provider: string): void {
  downKeys.get(provider)?.clear()
}

// Marks at a scope boundary (§6.4): the boundary clears every mark the scope
// covers — phase clears under every scope, task under task (default) and
// finer, and "session" is the new-session start of scope=session, which is
// also the only scope that clears there. A mark with `until` lasts until
// that instant instead, so it survives the clear and reads as up once the
// instant has passed. Calling this at a boundary the scope does not cover is
// a no-op.
export function clearDownMarks(boundary: Boundary | "session", scope: FailbackScope): void {
  if (!failbackApplies(scope, boundary)) return
  dropScopeCleared(downModels)
  for (const marks of downKeys.values()) dropScopeCleared(marks)
}

function dropScopeCleared(marks: Map<string, DownMark>): void {
  for (const [key, mark] of marks) if (mark.until === undefined) marks.delete(key)
}

// Set the /failback flag (interactive.ts has validated the argument shape):
// a non-empty order = redefine the model order wholesale (the first is the
// preferred model, the rest in order the failover candidate ring); empty =
// only reset failover state and fail back to the current preferred model.
export function requestFailback(order?: string[]): void {
  pending = order !== undefined && order.length > 0 ? { order } : {}
}

export function failbackRequested(): boolean {
  return pending !== undefined
}

export function stickyModel(): string | undefined {
  return sticky
}

export function setSticky(model: string): void {
  sticky = model
}

// The phase-boundary hook point (loop.ts, right after maybeExit): clears
// sticky unconditionally — sticky is written only under scope=phase, a
// no-op under every other granularity.
export function clearSticky(): void {
  sticky = undefined
}

export function failbackOverride(): { wildcard: string; fallback: string[] } | undefined {
  return override
}

// The /failback consumption point shared by the three safe boundaries
// (right after maybeExit; the subtask boundary passes the chain to clear
// chain.model, at the task/phase boundaries the chain is already destroyed
// with runTask and need not be passed): a hit resets the failover state
// (the chain's candidate + the sticky holder + down marks), and with
// arguments it also redefines the run-time model order. Returns whether it
// consumed.
// The chain's selected registry entry is cleared with the raw candidate
// (plans/0055 §6.4: the next prompt re-selects from the list).
// AUTO-RESOLVE: does a mark with `until` survive `/failback`, as it survives a scope boundary? -> no, `/failback` clears every mark, an `until` included (§6.4 lists the scope boundaries and `/failback` separately, and says `until` stands in for the scope boundary; the operator's explicit command retries the primary now, so a quota reset time must not override it)
export function consumeFailback(chain?: { model?: string; modelEntry?: string; modelStep?: number }): boolean {
  if (pending === undefined) return false
  if (chain) {
    chain.model = undefined
    chain.modelEntry = undefined
    chain.modelStep = 0
  }
  sticky = undefined
  downModels.clear()
  downKeys.clear()
  const order = pending.order
  pending = undefined
  if (order !== undefined) {
    override = { wildcard: order[0]!, fallback: order.slice(1) }
    log(`⇄ /failback applied: primary model redefined as ${override.wildcard}, fallback order ${override.fallback.join(", ") || "(none)"}; fallback state reset`)
  } else {
    log(`⇄ /failback applied: fallback state reset, next prompt returns to the primary model`)
  }
  return true
}

// For unit-test resets only (bun test runs several test files in one
// process, module-level state leaks across files; precedent exit.ts).
export function resetFailback(): void {
  sticky = undefined
  pending = undefined
  override = undefined
  downModels.clear()
  downKeys.clear()
}
