// The named transitions of the session chain: the one home for the
// computations and (as the consolidation proceeds) the mutations of
// SessionChain, so the chain's state changes stay findable instead of being
// 160-odd field writes spread over the session-driving files (plans/0061
// §4.8). Every module below the session-driving layer may call these; nothing
// else may write a chain field (test/chain-writes.test.ts holds the write
// ratchet: a per-file count table that only goes down, reaching zero when the
// mutations have all moved here).
//
// This file starts with the two pure computations that were copied four times
// each (plans/0061 §1 F5): the fork-source list and the no-registry model
// priority chain. The mutating transitions land here together with the
// conversion of their callers; runSession's paths (the retry ladder, the model
// failover, the provider-key rotation, the recovery loop and the blank
// fallbacks) write through the six below, and the dispatch-side transitions
// arrive when their callers convert.

import { resolveModel, roleOf, type SessionChain } from "./chain"
import { failbackOverride, stickyModel } from "./failback"
import type { PhaseKey } from "./phases/registry"
import type { Switches } from "./switches"

// One candidate fork source of a retry, failover, key rotation or recovery:
// the session id, its accumulated context usage (the fork value, compared
// below), and `why` — the label the log line of the picking site names the
// source by ("failed session" / "original session").
export type ForkSource = { id: string; used: number; why: string }

// The fork sources of a chain, most valuable first — the one "keep the most
// valuable session" criterion every fork-seeding site of the driver shares
// (the retry ladder, the model failover, the provider-key rotation and the
// recovery loop): the session the prompt was dispatched to, recorded in
// chain.failed, but only when it holds content (a 0-usage session is a pure
// error stub that failed on dispatch and produced nothing), and the chain's
// original session — deduplicated when both name the same one (a non-retryable
// failure promotes the failed session to chain.id), then ordered by
// accumulated context usage descending: a timeout/stream-break fault has
// nothing to do with the session's content, and the 100k+ of verified output
// inside it is the round's most valuable asset; a caller that opened a blank
// session instead would throw it away and hit the same wall from zero again.
export function forkSources(chain: SessionChain): ForkSource[] {
  const sources: ForkSource[] = []
  if (chain.failed && chain.failed.used > 0) sources.push({ ...chain.failed, why: "failed session" })
  if (chain.id !== undefined && chain.id !== chain.failed?.id) sources.push({ id: chain.id, used: chain.used, why: "original session" })
  return sources.sort((a, b) => b.used - a.used)
}

// The model a no-registry dispatch runs on, as one priority chain: the chain's
// failover candidate > the phase-scoped sticky holder > the /failback
// wildcard override > the routing table (role > phase type id > preset letter
// > wildcard). Without a model registry this decides every dispatch target,
// the failover's "from" label and the strict-resume record's model; under a
// registry the selection core decides instead, so callers test their routing
// facts before reaching for this. `phase` is the run's current phase
// reference (its type entry feeds the routing table) while the role comes
// from the chain itself (an explicit role wins over the chain's phase, which
// wins over bypass). A resume has no live chain: its caller passes a minimal
// chain view built from the record's role and phase, so the priority chain
// starts at the sticky holder — the record predates this run's chain and no
// candidate of it can carry over. Undefined = no routing configured; the
// dispatch then sends no model key and the agent's default applies.
export function modelOfChain(chain: SessionChain, switches: Switches, phase: PhaseKey | undefined): string | undefined {
  return chain.model ?? stickyModel() ?? failbackOverride()?.wildcard ?? resolveModel(switches.model, phase?.entry, roleOf(chain))
}

// ---------------------------------------------------------------------------
// The mutating transitions. Each owns the field writes of one named chain
// state change; a caller converts by computing the decision (which candidate,
// which fork source, which note) and handing the outcome over. The field
// writes inside one transition are one synchronous state change — nothing
// observes their order.
// ---------------------------------------------------------------------------

// The route a chain dispatches on: `model` is the model id actually sent to
// the adapter (undefined for a registry entry without a model — the prompt
// then carries no model key), `entry` the internal name of the chosen entry
// (continuation detection, failover marks and strict-resume records key on
// it), `step` the context step the session reached (0 = the base step).
// Without a registry only `model` ever holds a value.
export type ChainRoute = { model?: string; entry?: string; step?: number }

// Replaces the chain's route wholesale — a route is one decision's outcome,
// not a merge, so the fields the route leaves out are cleared and `step`
// defaults to the base step. The failover's model switch writes through here
// (under a registry the selection state travels with the chain; the down
// marks replace the phase-scoped sticky holder, so scope=phase keeps the
// move through the task boundaries without it), and so does the dispatch
// pick. A no-registry caller passes the model alone: entry and step have
// never held a defined value on that path, so the wholesale clear is a no-op
// there. The sticky holder of scope=phase failback is module state, not a
// chain field, and stays the caller's call.
export function setRoute(chain: SessionChain, route: ChainRoute): void {
  chain.model = route.model
  chain.modelEntry = route.entry
  chain.modelStep = route.step ?? 0
}

// The ladder retry's fork seeding: the copy rides `pending`, the usage
// counters restart from the fork source's accumulated context, and the note
// explains the re-send to the copy (a copy ending in the error message would
// otherwise read the re-send as a repeated request). `id` is kept
// deliberately, not cleared: the chain's original session stays there as the
// untouched recovery point the next retry forks from again, and with both
// note and pending set the dispatch consumes pending first (its resumed
// check requires pending to be empty), so the original session is never
// reused by mistake.
export function retryOnFork(chain: SessionChain, forked: string, source: ForkSource, note: string): void {
  chain.pending = forked
  chain.pct = 100
  chain.used = source.used
  chain.note = note
}

// The fork seeding of the moves that cannot keep the chain's session slot —
// the model failover, the provider-key rotation and the recovery re-dispatch:
// same writes as the ladder retry plus the `id` clear. The id must be cleared
// because the forked copy takes over: a non-empty note plus a non-empty id
// would hit the dispatch's "interruption recovery (resumed) reuses the
// original session" branch and ignore pending, so the copy (which already
// holds the real accumulated messages) would never be consumed.
export function moveOnFork(chain: SessionChain, forked: string, source: ForkSource, note: string): void {
  chain.id = undefined
  retryOnFork(chain, forked, source, note)
}

// The blank-session fallback of every fork path (a failed fork, or a chain
// with no session context to inherit at all): no context travels, so the
// usage counters reset and the note is the worktree-check form — a session
// that inherited nothing must be told to check the disk state before going
// on, or it redoes half-finished work. `pending` needs no write: every
// caller arrives with it already consumed by the dispatch that just failed.
export function toBlankSession(chain: SessionChain, note: string): void {
  chain.id = undefined
  chain.pct = 100
  chain.note = note
}

// The cross-agent move (a session never crosses agents): the chain drops its
// session slots — the id/pending session and the failed-session record, whose
// fork value is unreachable from the target agent — and the next dispatch
// opens a blank session there with the worktree-check note. The agent
// binding itself is written by the dispatch that follows, not here: this
// transition only drops what cannot travel.
export function toAgent(chain: SessionChain, note: string): void {
  chain.id = undefined
  chain.pending = undefined
  chain.failed = undefined
  chain.pct = 100
  chain.note = note
}

// The in-loop cleanup of the fork-source walk: a source whose fork just
// failed is dead, and its failed-session record (when the source is the one
// it names) stops being a fork source instead of failing noisily on every
// later round. The record is otherwise kept deliberately after a fork
// seeding — see the FailedSession invariant in src/chain.ts.
export function dropStaleFailed(chain: SessionChain, id: string): void {
  if (chain.failed?.id === id) chain.failed = undefined
}
