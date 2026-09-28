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
// conversion of their callers: runSession's paths (the retry ladder, the model
// failover, the provider-key rotation, the recovery loop and the blank
// fallbacks), the dispatch side (the executor is attempt, over the pure
// dispatch plan of src/engine/dispatch.ts), and the pipeline side (the stage,
// subject and baseline bookkeeping of runner/execute/wrapup, the
// interruption-recovery takeover and the pre-created fork seedings) — with
// those converted, every chain mutation in the driver lives here.

import { resolveModel, roleOf, type FailedSession, type SessionChain, type Watch } from "./chain"
import { type UnitBaseline } from "./git"
import type { PhaseKey } from "./phases/registry"
import { type Phase } from "./resume"
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
// wins over bypass). `sticky` and `override` are the router service's
// failback holders, passed in as data by the caller (the entries read them
// from the installed services; the strict-resume checks read them from the
// session options' router) — the pure transition reaches no run state behind
// its arguments. A resume has no live chain: its caller passes a minimal
// chain view built from the record's role and phase, so the priority chain
// starts at the sticky holder — the record predates this run's chain and no
// candidate of it can carry over. Undefined = no routing configured; the
// dispatch then sends no model key and the agent's default applies.
// AUTO-DECISION: the override arrives under its structural type ({ wildcard, fallback } — what the router's failbackOverride() returns) instead of importing the Router type (the transition stays a pure function over data; naming the service type would couple the chain's vocabulary to the services for two fields it reads through one accessor's result)
export function modelOfChain(
  chain: SessionChain,
  switches: Switches,
  phase: PhaseKey | undefined,
  sticky: string | undefined,
  override: { wildcard: string; fallback: string[] } | undefined,
): string | undefined {
  return chain.model ?? sticky ?? override?.wildcard ?? resolveModel(switches.model, phase?.entry, roleOf(chain))
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

// ---------------------------------------------------------------------------
// The dispatch-side transitions (the executor is attempt, over the pure
// dispatch plan of src/engine/dispatch.ts): consuming the pre-created fork,
// binding the session's agent, the session-scope failback reset, the step a
// session reached, and the three ends of a dispatch — promote, retryable
// restore, test-handover discard.
// ---------------------------------------------------------------------------

// Consumes the chain's pre-created fork session: the dispatch takes it over
// (or, when it moved the dispatch to another agent, has already dropped it
// through toAgent above). Clearing on every dispatch is what makes a stale
// request from an interruption-recovery or retry scenario disappear: by a
// transient-error retry pending is already clear, so the flow falls back to
// the create path naturally.
export function consumePending(chain: SessionChain): void {
  chain.pending = undefined
}

// Binds the chain's session to the agent profile this dispatch picked (a
// session never crosses agents, and the pool runs one host per profile):
// every way a chain acquires a session — a create, a consumed fork, a
// resumed takeover — funnels through the dispatch, so the binding is written
// once per dispatch, before any record goes to disk. Only under a registry;
// without one there is no agent notion and the call is not made.
export function bindAgent(chain: SessionChain, agent: string): void {
  chain.agent = agent
}

// Clears the chain's route — the empty route of setRoute: the next prompt
// re-selects instead of continuing the chain's entry. Every boundary with
// that meaning writes through here: the session-scope failback boundary
// (OPENCODE_AUTO_MODEL_FAILBACK_SCOPE=session — every brand-new session
// start fails back to the preferred model; the caller clears the down marks
// at the same boundary), the coarser scopes' subtask-boundary failback and
// the /failback order consumed beside it, a new subtask's first prompt (its
// own decision — the down marks survive subtask boundaries under the task
// scope, so a spent quota still skips its model), and the strict-resume
// rollback's cold redo (the redo is a new prompt; the chain's entry does not
// carry over). A resumed takeover and a consumed fork never pass here — the
// migrated session forked out by a failover enters via pending, and clearing
// at its dispatch would immediately undo the failover into oscillation.
export function resetRoute(chain: SessionChain): void {
  setRoute(chain, {})
}

// The context step a session reached by stepping up in place (the steer and
// the late step-up of a watch): the continuation prompt and every later
// steer name the step's model id. Not restored on retryable errors — the
// retry's fork inherits the context, so it inherits the step too.
export function stepTo(chain: SessionChain, step: number, model: string): void {
  chain.modelStep = step
  chain.model = model
}

// The chain state from before a dispatch, as promote leaves it and a
// retryable error returns to (see restoreRetryable).
export type ChainPrior = { id?: string; used: number; at: number; hinted?: boolean; wall?: number; failed?: FailedSession }

// Promotes the just-run session to the chain's session: the usage counters
// take the session's figures, `at` the end instant, and the failed-session
// record of the previous failure is cleared — its purpose (the retry's fork
// source) ended with this dispatch surviving. Runs before the retryable
// verdict is known; a retryable error then returns the chain to `prior`
// through restoreRetryable, which re-derives the failed-session record from
// the prior snapshot, so the early clear is unobservable on that path too
// (nothing between the two transitions reads the record).
export function promote(chain: SessionChain, id: string, watch: Pick<Watch, "pct" | "used" | "hinted" | "wall">, at: number): void {
  chain.id = id
  chain.pct = watch.pct
  chain.used = watch.used
  chain.at = at
  chain.hinted = watch.hinted === true
  chain.wall = watch.wall
  chain.failed = undefined
}

// A retryable session error's half-rollback: the chain returns to the state
// from before the dispatch — the original session stays there as the
// untouched recovery point the next retry forks from again — and the failed
// session is recorded per the replacement invariant (src/chain.ts's
// FailedSession): only a failure that holds content (used > 0) or that meets
// no existing record replaces it; a 0-token pure-error stub must not
// displace the still-valid content-bearing record (2026-09-17 field fix: a
// 41.3k session's fork source was overwritten by retry 3's stub, and later
// retries degenerated into cold-seeding from the base point).
export function restoreRetryable(chain: SessionChain, prior: ChainPrior, failed: FailedSession): void {
  chain.id = prior.id
  chain.used = prior.used
  chain.at = prior.at
  chain.hinted = prior.hinted
  chain.wall = prior.wall
  chain.failed = failed.used > 0 || prior.failed === undefined ? failed : prior.failed
}

// A test-handover finish (the session ended on a handover document, so the
// task is done): the session is discarded together with its roles as a
// restart-reuse and retry-fork anchor — the id clears so a later
// continuation error never forks back into the pre-freeze session whose
// context is exhausted. The failed record clears with it (promote already
// cleared it on this path; the write is idempotent and keeps the transition
// self-contained).
export function afterTestHandover(chain: SessionChain): void {
  chain.id = undefined
  chain.failed = undefined
}

// ---------------------------------------------------------------------------
// The pipeline-side transitions: the stage, subject and baseline bookkeeping
// of the task pipeline (runner, execute, wrapup), the interruption-recovery
// takeover, and the pre-created fork seedings of the session APIs.
// ---------------------------------------------------------------------------

// Names the chain's commit title — the short-label scheme's current unit
// (`T-NNN <label> <title>`): every pipeline stage sets it when it starts
// (the whole-task execution, the merged decompose, a subtask, the wrap-up),
// and the terminal-state rename keeps it in step with the session list's
// titles, so the sessions stay aligned with git history and task progress.
export function nameSubject(chain: SessionChain, subject: string): void {
  chain.subject = subject
}

// The pipeline boundary's phase bookkeeping: the chain now runs this phase —
// adopted from a recalled progress record at the task entry (undefined = the
// record names none; the chain runs none), advanced at every stage
// persistence, tagged with the owning subtask's index, or rewound to wrapup
// when a FAIL verdict blocks the run. The routing role is derived from it
// (roleOf) and the execution chain's sessions write their progress records
// with it.
export function enterPhase(chain: SessionChain, phase: Phase | undefined): void {
  chain.phase = phase
}

// Sets the chain's rollback anchor — the current execution unit's SHA
// baseline (strict recovery): taken at the task entry and refreshed at the
// stage boundaries and the subtask gate, recorded beside the active progress
// record; a resumed run verifies against it and rolls back to it. The value
// may be undefined (the commit gates are off); the write is unconditional,
// exactly as the boundary sites were.
export function anchorBaseline(chain: SessionChain, baseline: UnitBaseline | undefined): void {
  chain.baseline = baseline
}

// Interruption recovery's takeover: the interrupted session becomes the
// chain's session again (attempt's resumed criterion then sends the first
// prompt into it regardless of the reuse switch), the usage counters seed
// from the session's measured tail so the chain's later decisions work off
// real figures, `at` stamps the moment the figures were taken (the chain's
// `at` rides the snapshot a retryable error restores to), and the one-shot
// note explains the continuation to the session. The continuation's agent
// and route are the caller's composition: bindAgent for the agent the
// record names, setRoute for the recorded model the first dispatch keeps
// while it is still usable.
export function resumeSession(chain: SessionChain, session: string, usage: { pct: number; used: number }, at: number, note: string): void {
  chain.id = session
  chain.pct = usage.pct
  chain.used = usage.used
  chain.at = at
  chain.note = note
}

// Attaches a one-shot note for the next dispatch's first prompt to carry out
// (the set side of consumeNote below). Interruption recovery's fresh-session
// branch uses it: no session is taken over, but the first prompt still
// carries the resume note. Every fork-shaped note (a retry, a failover, a
// blank fallback, an agent move) rides its own transition instead.
export function attachNote(chain: SessionChain, note: string): void {
  chain.note = note
}

// Resets the chain to its fresh-session shape: the session slots clear (the
// chain's session and any pre-created fork copy) and the usage counters
// restart. The fork guard's refusal (a base too full or unreadable) takes
// this path, and the strict-resume rollback's cold redo composes it with
// consumeNote and resetRoute.
export function coldStart(chain: SessionChain): void {
  chain.id = undefined
  chain.pending = undefined
  chain.pct = 100
  chain.used = 0
  chain.at = 0
}

// The seed of a pre-created fork: the copy rides `pending` for the next
// dispatch to consume, and the chain's session slot clears for it (a
// non-empty id would hit the dispatch's resumed-reuse branch and ignore
// pending). With a seed record the usage counters restart from the forked
// prefix's figure, the agent binding follows the fork (a session never
// crosses agents) and the fork-base pointers record the provenance a later
// re-seed forks from; `forked` undefined (the fork call failed) still seeds
// the pointers and the counters at zero, the shape the caller's cold-start
// fallback continues from. Without a seed (a fork of the chain's own
// just-ended session) the counters stay as they are: the ended session's
// figures are the copy's figures, and the dispatch refreshes them with
// measured values once the round ends.
export type ForkSeed = { used: number; agent?: string; base?: { id: string; lead?: boolean } }
export function seedFork(chain: SessionChain, forked: string | undefined, seed?: ForkSeed): void {
  chain.id = undefined
  chain.pending = forked
  if (seed) {
    if (seed.agent !== undefined) chain.agent = seed.agent
    chain.pct = 100
    chain.used = seed.used
    chain.at = 0
    if (seed.base) {
      chain.forkBase = seed.base.id
      chain.forkLead = seed.base.lead || undefined
    }
  }
}

// Records the model the terminal was last told a session runs on (the ◈
// line's memory): every new session announces one, a continuation prompt on
// the same session and model does not. Memory-only, never persisted; the
// quota-window account also reads it when the chain carries no model.
// AUTO-DECISION: this and consumeNote below sit outside the transition
// table the consolidation ruled (display memory and a one-shot clear, not
// named there) — but the write ratchet holds attempt.ts at zero chain
// writes, so the three announcement writes and the note clear need their
// one-meaning homes like every other chain field (rejected: folding the
// announcement into setRoute, which session.ts's failover shares and which
// must not touch display state, and clearing the note inside consumePending,
// which would move the clear off the prompt and lose it on early exits).
export function announceModel(chain: SessionChain, model: string): void {
  chain.modelShown = model
}

// Clears the one-shot note after it rode the first prompt out (interruption
// recovery's remark and every other one-shot note). The clear happens at the
// prompt, not at the dispatch's start, so an early exit — a failed session
// create, a dispatch that never ran — keeps the note for the next dispatch.
export function consumeNote(chain: SessionChain): void {
  chain.note = undefined
}
