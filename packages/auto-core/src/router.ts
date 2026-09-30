// The router service (the consolidation's services stage): the run-wide
// decision state of routing and recovery that used to live in module
// singletons — the failback holders (the phase-scoped sticky model, the
// pending /failback order and the run-time model-order override), the down
// marks of the model registry (per model, and per provider key for the
// rings), the key rings themselves (the built rings, the per-provider
// position, whether rotation is active), the usage windows last logged per
// agent client, the model-step cache-claim checks, and the failure-message
// classifier's run state (its answer cache, its in-flight calls, its call
// budget and its usage sink). One instance per
// run: `createServices` builds it into the run's holder, the composition
// root installs the holder for the run, and the test preload installs a
// fresh one before every test (so the state never leaks across test files
// — the `reset*` hooks the module singletons needed are gone with them).
//
// Who may reach it: the entry modules the services allowlist names call
// `services().router` directly (watch, attempt, session, the /failback
// handler of interactive, the composition and the agent pool). Everything
// below them receives the router as data, never through the ambient
// accessor: the routing facts carry it beside their clock (every
// registry-driven selection and resume check reads it through
// `RoutingFacts.router`), the session options carry it beside their routing
// (`Opts.router`, for the no-registry resume checks and the pipeline's
// failback boundary hooks), and the policies helpers that stayed below it
// (classify) take it as a leading parameter — the key-ring functions moved
// in as methods, leaving keyring.ts the pure library (the ring build and
// the key labels, no state). The pure decisions keep reading state as
// data, exactly as they read the clock.
//
// Construction: in the run's written order the router joins the composition
// after the switch snapshot freezes, reading the registry and the frozen
// switches. The failback holders, the marks, the logged windows and the
// step claims are registry-agnostic run state (a run without a registry
// writes no marks and never logs a step claim, byte-identical to before),
// and the key rings read the registry only at their activation — where the
// run's agent fleet starts (src/agent-pool.ts, after the holder exists,
// through `activateRings`), not at construction — so `createRouter()` takes
// no inputs and the holder may build it beside the clock, which depends on
// nothing above it either. The routing fence — the dual registry and
// no-registry halves of the routing decisions in one seam — reads the
// registry and the switches per call, never at construction: the fence
// methods take the run's routing facts (and the switches, the cap,
// whatever the site holds) as call-time arguments, so the same
// construction order stands and a holder the preload builds before a test
// parses its switches never captures a stale snapshot. The no-registry
// half behind the fence is the compatibility layer of plans/0061 §4.11:
// one seam before F2 deletes that half.
// AUTO-DECISION: createRouter() is parameterless instead of receiving the registry and the frozen switch snapshot (no state it builds consults either — the key rings read the registry at their activation, not at construction — and the boundary clears keep taking the failback scope as a call argument because the switch memo is per-parse process state that a test or the pre-freeze composition must be able to change independently of the holder, and capturing the memo at construction time would freeze a stale snapshot for every holder the preload builds before a test parses its switches).
import type { AgentClient, AgentEvent, AgentTokens, LimitScope } from "./agent/types"
import type { Boundary } from "./control-types"
import { phaseToRole, roleOf, type SessionChain, type WindowWait } from "./chain"
import { modelOfChain, type ChainRoute } from "./chain-transitions"
import { failbackApplies } from "./failback"
import { HIBERNATE_JITTER_MS } from "./hibernate"
import { buildRings, ringKeyLabel, type RingRotation } from "./keyring"
import { formatTokens, log } from "./log"
import { formatWindowState, isoInZone } from "./model-window"
import type { ModelEntry, ModelRegistry, ModelReference } from "./models-schema"
import type { PhaseKey } from "./phases/registry"
import type { Phase } from "./resume"
import { candidateKey, candidatesOf, recoveryAt, select, type Candidate, type DownMark, type SelectContext, type SelectCall } from "./select"
import type { FailbackScope, ModelRole, Switches } from "./switches"
import type { Usage } from "./stats"

// The run-time model-order override a parameterized /failback leaves behind:
// the first argument is the preferred wildcard, the rest the failover
// candidate ring.
export type FailbackOverride = { wildcard: string; fallback: string[] }

// The verdict of one cache-claim observation; undefined = no claim was
// pending, or the tokens were inconclusive (a small cacheWrite with a small
// cacheRead says nothing either way).
export type CacheClaim = "confirmed" | "contradiction"

// A parsed reply of the failure-message classifier: the class — the pattern
// classes minus `overflow`, which the context steps and the handover own and
// the classifier is never asked about — and the reset time the text named
// (epoch ms), as the reply stated it; the classifier's acceptedReset decides
// whether it may set a mark. The type lives here, beside the answer cache it
// keys, because the router must not import the classifier module: classify
// carries the Router type (the classifier holds it), so a router→classify
// edge of any kind, type-only included, would close a cycle the
// import-direction DAG check rejects. classify.ts derives its ClassifierClass
// alias from this shape.
export type ClassifierAnswer = { class: "quota" | "rate" | "auth" | "transient" | "unknown"; resetAt?: number }

// Where the classifier's token usage goes. Never into the unit's session
// totals: the classifier's session is not the watched session (the watch
// bills only its own session's steps), and it opens no stats segment. A
// per-model stats bucket for it registers through the router; until one
// does, the usage is only measured.
export type ClassifyUsageSink = (usage: Usage, entry: string) => void

// The router service. Method names keep the names the module singletons
// exported, so the move reads as a move.
export type Router = {
  // —— The failback holders ——
  // sticky: the cross-task failover holder of phase granularity, written by
  // switchModel only under scope=phase, cleared unconditionally at phase
  // boundaries (undefined under every other granularity, the clear is a
  // no-op).
  stickyModel(): string | undefined
  setSticky(model: string): void
  clearSticky(): void
  // The run-time model-order override left after a parameterized /failback
  // is consumed; the dispatch resolvers read it ahead of switches.model
  // (without breaking the switches-memo constancy convention).
  failbackOverride(): FailbackOverride | undefined
  // The pending /failback request (optionally redefining the model order
  // wholesale). Set by the interactive sideband; consumed at the safe
  // boundaries.
  requestFailback(order?: string[]): void
  failbackRequested(): boolean
  consumeFailback(): boolean
  // —— Down marks ——
  downMarks(): ReadonlyMap<string, DownMark>
  markModelDown(model: string, until?: number, classifier?: boolean): void
  extendModelDownMark(model: string, until: number): boolean
  clearModelDownMark(model: string): void
  modelDownMark(model: string): DownMark | undefined
  isModelDown(model: string, now: number): boolean
  markKeyDown(provider: string, key: string, until?: number): void
  extendKeyDownMark(provider: string, key: string, until: number): boolean
  keyDownMark(provider: string, key: string): DownMark | undefined
  isKeyDown(provider: string, key: string, now: number): boolean
  clearKeyDownMarks(provider: string): void
  clearDownMarks(boundary: Boundary | "session", scope: FailbackScope): void
  // —— Key rings ——
  // Activation (where the run's agent fleet starts) builds the rings from
  // the registry and records whether they rotate; every reader before it
  // answers "no ring". The methods keep the names the keyring module
  // exported, so the move reads as a move.
  activateRings(registry: ModelRegistry, external: boolean): void
  ringsActive(): boolean
  currentKey(provider: string): ModelReference | undefined
  hasActiveRing(provider: string): boolean
  ringHasUsableKey(provider: string, now: number): boolean
  ringRotation(provider: string, now: number): RingRotation | undefined
  commitRotation(rotation: RingRotation, until?: number): void
  spawnKeyConfig(): Record<string, unknown> | undefined
  ringLabel(entry: ModelEntry): string
  ringInactiveNote(): string | undefined
  clearRingMarks(provider: string): void
  markCurrentKeyDown(provider: string, until?: number): void
  // —— Logged usage windows ——
  noteWindows(client: AgentClient, event: Extract<AgentEvent, { type: "limit" }>): boolean
  // —— Model-step cache claims ——
  awaitCacheClaim(name: string, used: number): void
  observeCacheClaim(name: string, tokens: Pick<AgentTokens, "cacheRead" | "cacheWrite">): CacheClaim | undefined
  noteClaimContradiction(name: string): boolean
  // —— The failure-message classifier ——
  // The classifier's run state, keyed by the cache key the classify module
  // derives from a failure's redacted text: the answers known this run, the
  // calls in flight, the calls made against the run's budget, whether the
  // limit line was logged (once per run) and the run's usage sink. The
  // policies over this state (when to ask, how the key is derived, what a
  // reply means) stay in classify.ts and reach the state through
  // Classifier.router. `setClassifyUsageSink` keeps the name the module
  // exported, so the move reads as a move; the rest are the accessors the
  // moved state needs.
  classifierAnswerOf(key: string): ClassifierAnswer | undefined
  noteClassifierAnswer(key: string, answer: ClassifierAnswer): void
  classifierInflightOf(key: string): Promise<ClassifierAnswer | undefined> | undefined
  noteClassifierInflight(key: string, call: Promise<ClassifierAnswer | undefined>): void
  dropClassifierInflight(key: string): void
  classifierCalls(): number
  noteClassifierCall(): void
  classifierLimitNoted(): boolean
  noteClassifierLimit(): void
  setClassifyUsageSink(sink: ClassifyUsageSink | undefined): void
  classifyUsageSink(): ClassifyUsageSink | undefined
  // —— The routing fence ——
  // The dispatch target of one routing decision, both halves behind one
  // seam: under a registry (`facts` present) a fresh-prompt selection over
  // the facts — the pick's candidate key, undefined = nothing usable now;
  // without one the no-registry priority chain over `chain` (the chain's
  // failover candidate > this instance's sticky holder > the /failback
  // override > the routing table). The registry/no-registry branch is the
  // fence's to own: callers pass `opts.routing` untested; the no-registry
  // half is the compatibility layer of plans/0061 §4.11, deleted in F2.
  target(
    facts: RouteFacts | undefined,
    chain: SessionChain,
    switches: Switches,
    cap: number,
    phase: PhaseKey | undefined,
  ): string | undefined
  // The dispatch's model pair, both halves behind one seam: under a
  // registry (`facts` present) the plan's pick — the route the pure
  // planner resolved before anything was created and setRoute then
  // wrote onto the chain (`picked`, the executor passes the pick's
  // route: `target` is the model id the prompt carries, `promptModel`
  // the entry the strict-resume record keys on; the fence must not
  // re-select — the pick already read the live windows and the step
  // walk, and the chain's route fields cannot stand in because the
  // session-scope failback clear may have wiped them after the pick) —
  // without one the no-registry priority chain resolved at the
  // dispatch's slot, after that clear (both reads hold the same
  // string). The registry/no-registry branch is the fence's to own:
  // callers pass `opts.routing` untested; the no-registry half is the
  // compatibility layer of plans/0061 §4.11, deleted in F2.
  dispatchModel(
    facts: RouteFacts | undefined,
    chain: SessionChain,
    switches: Switches,
    phase: PhaseKey | undefined,
    picked: { model?: string; entry?: string } | undefined,
  ): { target: string | undefined; promptModel: string | undefined }
  // The ◈ announcement of the model a dispatch runs on, without a
  // registry: the "using model" line with its source label (the chain's
  // failover candidate, the phase-scoped sticky holder, the /failback
  // override, else the routing table), logged for every new session and
  // on a model change — a continuation of the same session and model is
  // not repeated. Logs the line itself and returns the model the caller
  // records as the chain's display memory (the caller writes the chain);
  // undefined = nothing was announced. Under a registry the planner's
  // own announce line already covered the dispatch, so the answer is
  // undefined there — the registry/no-registry branch is the fence's to
  // own: callers pass `opts.routing` untested; the no-registry half is
  // the compatibility layer of plans/0061 §4.11, deleted in F2.
  describe(
    facts: RouteFacts | undefined,
    chain: SessionChain,
    target: string | undefined,
    label: string,
    resumed: boolean,
  ): string | undefined
  // The model failover of the session loop's escalation (§7 step 2), both
  // halves behind one seam: under a registry (`facts` present) the model
  // being left — the chain's selected entry — is marked down (this
  // instance's marks) and a fresh selection picks the next usable
  // candidate of the list, waiting through `site.waitWindow` and
  // re-selecting when only the windows block (escalation step 3); without
  // one the /failback or _FALLBACK ring walk with window clipping and the
  // ladder's `tried` bookkeeping. Logs the ⇄ line itself (byte-identical
  // text on both arms) and makes the phase-scoped sticky write (no-registry
  // and scope=phase only); returns the decided failover — the model left
  // (undefined = the primary), the candidate picked, the route value the
  // caller writes through setRoute, and the cross-agent move's target
  // agent (undefined = keep the chain's context) — or undefined = no
  // candidate (the caller falls into the wait-and-probe loop). The fork
  // walk and every chain write stay with the caller; the ladder is
  // loop-local per-prompt state taken as the `site.ladder` argument and
  // mutated in place, never held. The registry/no-registry branch is the
  // fence's to own: callers pass `opts.routing` untested; the no-registry
  // half is the compatibility layer of plans/0061 §4.11, deleted in F2.
  failover(
    facts: RouteFacts | undefined,
    switches: Switches,
    site: {
      chain: SessionChain
      // The run's current phase (opts.phase): its type entry feeds the
      // selection call and the no-registry routing table.
      phase: PhaseKey | undefined
      cap: number
      // The context windows the site fetched (contextLimitsOf); the
      // failover's clipping and selection read them.
      limits: ReadonlyMap<string, number>
      ladder: FailoverLadder
      // The ⇄ and skipping lines' unit label (the task id).
      label: string
      // The short phrase naming the trigger; it goes into the log and the
      // failover note.
      why: string
      until?: number
      classified?: boolean
      // The window wait of the wait-and-reselect loop: the site's own
      // sleeper (the booked sleep on the run's clock), handed the payload
      // the fence builds.
      waitWindow: (wait: WindowWait) => Promise<void>
    },
  ): Promise<FailoverDecision | undefined>
  // The escalation's step-1 key-rotation plan (§7 step 1), the decision
  // without its I/O: under a registry, the provider of the chain's selected
  // entry when its ring is active, with the rotation that would land — or,
  // for a ring with no key left that is not down, `rotation: undefined`,
  // naming a provider whose current key still failed and must be marked
  // down before the fall-through to the model failover. undefined = no key
  // rotation applies (no registry, a chain model the registry does not
  // know, or a provider without an active ring): step 1 is a no-op and the
  // caller falls straight through to the model failover — the
  // registry-presence test that used to gate the escalation's first arm
  // lives here now. The spawn config, the host restart and the re-dispatch
  // fork stay with the caller; the commit and the marks are the router
  // methods the caller already calls. The registry/no-registry branch is
  // the fence's to own (plans/0061 §2.1 R2 / §4.11).
  keyRotation(facts: RouteFacts | undefined, chain: SessionChain): KeyRotationPlan | undefined
  // The exhaustion line of the escalation's fall-through into the
  // wait-and-probe loop, both arms behind one seam: under a registry the
  // tier list's down marks as they stand at the call — after the
  // escalation wrote its own (this instance's marks, the run's router);
  // without one the fallback candidates the ladder has tried. Byte-
  // identical text on both arms; the no-registry half is the compatibility
  // layer of plans/0061 §4.11, deleted in F2.
  exhaustionWhy(facts: RouteFacts | undefined, label: string, ladder: FailoverLadder): string
  // The down marks one failure's escalation may write (§7.1): the chain's
  // selected entry and, when its provider has an active ring, the key it
  // ran on — read before the escalation moves anything, so a classifier
  // answer still on its way can extend them to the reset it names
  // (lateReset below). The registry lookup reads the facts, the rings this
  // instance's own state (the same instance the caller's mark writes went
  // through). The registry/no-registry branch is the fence's to own:
  // callers pass `opts.routing` untested (plans/0061 §2.1 R2 / §4.11).
  downTarget(facts: RouteFacts | undefined, chain: SessionChain): DownTarget
  // A classifier answer that arrives after the turn ended (§7.1): it can
  // only set when this failure's down marks clear — each mark the
  // escalation wrote (the `target` downTarget answered, or the probe
  // candidate's model mark) and nothing cleared since then lasts until the
  // reset time instead of the scope boundary. The class it names comes too
  // late to change anything; only the ⏲ line (gated on the facts, whose
  // time zone renders the instant) says so. The mark extensions write this
  // instance's own state; the registry/no-registry branch is the fence's
  // to own: callers pass `opts.routing` untested (plans/0061 §2.1 R2 /
  // §4.11).
  lateReset(
    facts: RouteFacts | undefined,
    pending: Promise<number | undefined> | undefined,
    target: DownTarget,
    label: string,
  ): void
  // The model the chain's dispatches ran on, the way attempt records it for
  // strict resume: the selected entry under a registry, else the
  // switch-routed model string of the no-registry priority chain
  // (modelOfChain over this instance's sticky/override holders; undefined
  // = the agent's own default). The registry/no-registry branch is the
  // fence's to own: callers pass `opts.routing` untested; the no-registry
  // half is the compatibility layer of plans/0061 §4.11, deleted in F2.
  chainModel(
    facts: RouteFacts | undefined,
    chain: SessionChain,
    switches: Switches,
    phase: PhaseKey | undefined,
  ): string | undefined
  // The sleep of one wait-and-probe round, both halves behind one seam:
  // which source schedules the round — under a registry the instant the
  // down list comes back by waiting alone (select.ts recoveryAt over the
  // facts' context), without one the failure's stated reset or the
  // account's learned windows — and the model the wait is for (the chain's
  // dispatch model, the fallback cascade of the no-registry priority
  // chain). The site keeps what the fence cannot reach: the context-window
  // fetch (handed in as `loadLimits`, invoked in the registry arm only),
  // the learned-window lookup (`learned`, invoked only when the cascade
  // reaches it), and the horizon clamp with the poll fallback
  // (RESET_HORIZON_MS stays with the caller). Under a registry whose
  // recoveryAt answered nothing, neither the stated reset nor the learned
  // windows apply — the round polls; the compound conditions preserve
  // exactly that. The registry/no-registry branch is the fence's to own:
  // callers pass `opts.routing` untested; the no-registry half is the
  // compatibility layer of plans/0061 §4.11, deleted in F2.
  recoverySleep(
    facts: RouteFacts | undefined,
    switches: Switches,
    site: {
      chain: SessionChain
      phase: PhaseKey | undefined
      cap: number
      // The context windows the registry arm selects over: loaded lazily
      // (and only under a registry), cached by the caller.
      loadLimits: () => Promise<ReadonlyMap<string, number>>
      // The failure that led here (absent when selection found nothing
      // usable before any session ran); its stated reset and its account
      // feed the cascade.
      cause: { resetAt?: number; scope?: LimitScope; account?: string } | undefined
      // The learned-window lookup of the third arm (the account's spent
      // windows, fs I/O): invoked only when the cascade reaches it, with
      // the round's `now`.
      learned: (now: number) => Promise<{ resetAt: number; scope?: LimitScope; learnedAt: number } | undefined>
      // The no-registry half's timeline: the run services' clock, read
      // only without a registry (the registry arm reads the facts' clock,
      // exactly as the site's branch used to).
      now: () => number
    },
  ): Promise<RecoverySleepPlan>
  // The probe candidate of one wait-and-probe round (§6.3), both halves
  // behind one seam: under a registry the probe dispatches through
  // selection like any other — this method runs the selection (waiting
  // through `site.waitWindow` while only the windows block), then realizes
  // the mark-clearing by clearing the probe candidate's mark before the
  // dispatch (and its provider's ring marks with it), so the probe runs on
  // the first in-window candidate ignoring the marks; a successful probe
  // leaves it cleared. undefined = no registry (the probe dispatches on the
  // chain's own model) or a non-probe decision (nothing usable — the
  // caller's dispatch answers the rest). The re-mark on a failed probe
  // stays with the caller (it runs after the probe session returns). The
  // registry/no-registry branch is the fence's to own: callers pass
  // `opts.routing` untested; the no-registry half is the compatibility
  // layer of plans/0061 §4.11, deleted in F2.
  probeSelection(
    facts: RouteFacts | undefined,
    switches: Switches,
    site: {
      chain: SessionChain
      phase: PhaseKey | undefined
      cap: number
      // The context windows the selection reads: loaded lazily (and only
      // under a registry), cached by the caller.
      loadLimits: () => Promise<ReadonlyMap<string, number>>
      // The window wait of the wait loop (the site's own sleeper — the
      // booked sleep on the run's clock), handed the payload the fence
      // builds.
      waitWindow: (wait: WindowWait) => Promise<void>
    },
  ): Promise<ProbeTarget | undefined>
}

// Builds the run's router. See the module header for why this takes no
// construction inputs.
export function createRouter(): Router {
  // Single-run state (each run builds its own holder; tests get a fresh
  // instance from the preload, so no reset hook exists):
  let sticky: string | undefined
  let pending: { order?: string[] } | undefined
  let override: FailbackOverride | undefined

  // Down marks: by the model's internal name (a raw override value by its
  // model string, matching how selection reads them) and by (provider, key
  // reference) for a ring. Marks live in memory only (nothing persists); a
  // new run starts with every model eligible. The resets a failure states
  // outlive the run, as the account's learned windows, but those only time
  // the recovery wait's sleep and never become a mark. A mark may carry
  // `until`, the instant a reset time named: it lasts until that instant
  // *instead of* the scope boundary, so a boundary clear keeps it and a read
  // past the instant treats it as cleared.
  const downModels = new Map<string, DownMark>()
  const downKeys = new Map<string, Map<string, DownMark>>()

  // The key rings (the state the keyring module held as a singleton until
  // this tranche): the built rings by provider, the current position per
  // provider and whether rotation is active. `rings` is undefined before
  // the run's agent starts, and every reader then answers "no ring":
  // selection's rule 4 never excludes, nothing rotates, the startup block
  // shows declared counts only. The position never moves back — a cleared
  // key mark does not rewind it, only a failure of the current key advances
  // it (§6.4), so there is no restart churn.
  let rings: Map<string, ModelReference[]> | undefined
  let positions = new Map<string, number>()
  let active = false

  // The usage windows last logged per agent client: a `limit` event is
  // logged only when its status or a window's reset changed, so a run shows
  // a line per window and status, not one per session. It is never a
  // verdict: dispatch and the escalation do not read it.
  const windowsLogged = new WeakMap<AgentClient, string>()

  // The pending cache-claim checks of the model-step mechanism: `wider`
  // asserts the step ids share the base id's prompt cache, which the driver
  // cannot know. The first step-finish on a wider id shows whether it holds
  // — a large cacheRead confirms it, a cacheWrite of the whole prefix
  // contradicts it. The pending claim is run state (in memory, once per
  // run), so a watch instance that ends before the first step-finish does
  // not lose the check; the contradiction line fires once per entry.
  const claimPending = new Map<string, number>()
  const contradictionLogged = new Set<string>()

  // The failure-message classifier's run state (the state the classify
  // module held as a singleton until this tranche): the answers by cache
  // key, the calls in flight by cache key, the calls made and whether the
  // limit line was logged, plus the run's usage sink. One run is one
  // budget and one cache, exactly as one process was before the move; the
  // classify module keeps every policy over this state and reaches it
  // through the classifier's router.
  const classifierAnswers = new Map<string, ClassifierAnswer>()
  const classifierInflight = new Map<string, Promise<ClassifierAnswer | undefined>>()
  let classifierCallsMade = 0
  let classifierLimitLine = false
  let classifyUsageSink: ClassifyUsageSink | undefined

  // Marks at a scope boundary: the boundary clears every mark the scope
  // covers — phase clears under every scope, task under task (default) and
  // finer, and "session" is the new-session start of scope=session, which is
  // also the only scope that clears there. A mark with `until` lasts until
  // that instant instead, so it survives the clear and reads as up once the
  // instant has passed. Calling this at a boundary the scope does not cover
  // is a no-op.
  const clearDownMarks = (boundary: Boundary | "session", scope: FailbackScope): void => {
    if (!failbackApplies(scope, boundary)) return
    dropScopeCleared(downModels)
    for (const marks of downKeys.values()) dropScopeCleared(marks)
  }
  const dropScopeCleared = (marks: Map<string, DownMark>): void => {
    for (const [key, mark] of marks) if (mark.until === undefined) marks.delete(key)
  }

  // The key-mark reads and writes the ring methods share, and the ring
  // state's shared readers: methods of the returned object cannot name the
  // object itself, so everything one method calls on another goes through
  // these closures (the object exposes them verbatim).
  const markKeyDown = (provider: string, key: string, until?: number): void => {
    let marks = downKeys.get(provider)
    if (marks === undefined) {
      marks = new Map()
      downKeys.set(provider, marks)
    }
    marks.set(key, until !== undefined ? { until } : {})
  }
  const isKeyDown = (provider: string, key: string, now: number): boolean => {
    const mark = downKeys.get(provider)?.get(key)
    return mark !== undefined && (mark.until === undefined || mark.until > now)
  }
  const clearKeyDownMarks = (provider: string): void => {
    downKeys.get(provider)?.clear()
  }
  // Whether the run's rings rotate: false before activation and under an
  // external server.
  const ringsActive = (): boolean => rings !== undefined && active
  // The ring's current key of a provider, by reference; undefined when the
  // provider has no ring or the rings never activated.
  const currentKey = (provider: string): ModelReference | undefined => {
    const keys = rings?.get(provider)
    if (keys === undefined || keys.length === 0) return undefined
    return keys[(positions.get(provider) ?? 0) % keys.length]!
  }
  // The model down-mark write (the key methods' markKeyDown counterpart):
  // a mark may carry `until`, the instant a reset time named, and the
  // classifier flag that tells the ◈ line the class came from the
  // classifier. Hoisted beside the ring closures because the failover
  // fence writes a mark inside its decision; the object exposes it
  // verbatim.
  const markModelDown = (model: string, until?: number, classifier?: boolean): void => {
    downModels.set(model, { ...(until !== undefined ? { until } : {}), ...(classifier === true ? { classifier: true as const } : {}) })
  }
  // Whether the run's rings are active for this provider (the escalation's
  // step-1 gate, §7): a key failure on a ringed provider marks the key down
  // even when the ring cannot rotate — every key is down, or it holds one key
  // — so §6.2 rule 4 then keeps the provider's entries out of selection.
  // Hoisted for the keyRotation fence; the object exposes it verbatim.
  const hasActiveRing = (provider: string): boolean => rings !== undefined && active && rings.get(provider) !== undefined
  // Would a rotation land on a key? The current key will be marked down
  // (step 1 of §7), so the search starts after it and wraps, skipping every
  // key that is down; undefined = no ring, inactive rings, or the ring is
  // exhausted (every key down). Mutates nothing. Hoisted for the keyRotation
  // fence; the object exposes it verbatim.
  const ringRotation = (provider: string, now: number): RingRotation | undefined => {
    const keys = rings?.get(provider)
    if (!ringsActive() || keys === undefined || keys.length < 2) return undefined
    const from = (positions.get(provider) ?? 0) % keys.length
    for (let step = 1; step < keys.length; step++) {
      const index = (from + step) % keys.length
      if (!isKeyDown(provider, keys[index]!.ref, now))
        return {
          provider,
          from: { ref: keys[from]!, index: from, total: keys.length },
          to: { ref: keys[index]!, index, total: keys.length },
        }
    }
    return undefined
  }
  // A reset time that became known after a mark was written (the
  // classifier's answer arriving after the turn ended): an existing mark
  // lasts until that instant instead of the scope boundary. Hoisted for the
  // lateReset fence; the object exposes it verbatim.
  const extendModelDownMark = (model: string, until: number): boolean => {
    const mark = downModels.get(model)
    if (mark === undefined) return false
    downModels.set(model, { ...mark, until })
    return true
  }
  // The key-mark counterpart, same extension rule per (provider, key).
  // Hoisted for the lateReset fence; the object exposes it verbatim.
  const extendKeyDownMark = (provider: string, key: string, until: number): boolean => {
    const marks = downKeys.get(provider)
    const mark = marks?.get(key)
    if (marks === undefined || mark === undefined) return false
    marks.set(key, { ...mark, until })
    return true
  }
  // Removes one model's mark (the recovery probe's "a successful probe
  // clears that candidate's mark"; a failed probe re-marks it through the
  // caller). Hoisted for the probeSelection fence; the object exposes it
  // verbatim.
  const clearModelDownMark = (model: string): void => {
    downModels.delete(model)
  }
  // The recovery probe's ring half (§6.3): the probe candidate ignores the
  // down marks, the ring and the cap, so an exhausted ring's key marks clear
  // for the probe — the position stays where it is. Hoisted for the
  // probeSelection fence; the object exposes it verbatim.
  const clearRingMarks = (provider: string): void => {
    if (rings?.has(provider) !== true) return
    clearKeyDownMarks(provider)
  }

  return {
    stickyModel: () => sticky,
    setSticky: (model) => {
      sticky = model
    },
    // The phase-boundary clear: sticky is written only under scope=phase, a
    // no-op under every other granularity.
    clearSticky: () => {
      sticky = undefined
    },
    failbackOverride: () => override,

    // Set the /failback flag (the interactive sideband has validated the
    // argument shape): a non-empty order = redefine the model order
    // wholesale (the first is the preferred model, the rest in order the
    // failover candidate ring); empty = only reset failover state and fail
    // back to the current preferred model.
    requestFailback: (order) => {
      pending = order !== undefined && order.length > 0 ? { order } : {}
    },
    failbackRequested: () => pending !== undefined,

    // The /failback consumption point shared by the three safe boundaries
    // (right after the pause hooks): a hit resets the failover state (the
    // sticky holder + down marks), and with arguments it also redefines the
    // run-time model order. Returns whether it consumed. The chain's
    // selected entry is cleared with the raw candidate at the boundary that
    // holds the chain (the next prompt re-selects from the list) — the
    // subtask boundary calls resetRoute beside this consumption; the task
    // and phase boundaries destroy the chain with runTask before reaching
    // here, so they clear nothing.
    // AUTO-RESOLVE: does a mark with `until` survive `/failback`, as it survives a scope boundary? -> no, `/failback` clears every mark, an `until` included (the scope rules list the scope boundaries and `/failback` separately, and `until` stands in for the scope boundary; the operator's explicit command retries the primary now, so a quota reset time must not override it)
    consumeFailback: () => {
      if (pending === undefined) return false
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
    },

    // The run's model down marks by internal name; selection reads this map
    // through its context. The map is never replaced, only mutated, so a
    // held reference stays live.
    downMarks: () => downModels,
    markModelDown,
    // A reset time that became known after the mark was written (the
    // classifier's answer arriving after the turn ended): the mark now
    // lasts until that instant instead of the scope boundary. Only an
    // existing mark is changed — a mark a boundary or /failback already
    // cleared is not written again. (The hoisted closure, exposed
    // verbatim; the lateReset fence calls it.)
    extendModelDownMark,
    // Removes one model's mark (the recovery probe's "a successful probe
    // clears that candidate's mark"; a failed probe re-marks it through the
    // caller). Key marks are not touched. (The hoisted closure, exposed
    // verbatim; the probeSelection fence calls it.)
    clearModelDownMark,
    modelDownMark: (model) => downModels.get(model),
    isModelDown: (model, now) => {
      const mark = downModels.get(model)
      return mark !== undefined && (mark.until === undefined || mark.until > now)
    },

    // Key marks, per provider and key reference (the ring position itself
    // never moves back; only whether a key is down lives here). The three
    // the ring methods share are the closures above, exposed verbatim.
    markKeyDown,
    // The key-mark counterpart of extendModelDownMark: an existing key mark
    // lasts until `until`.
    extendKeyDownMark: (provider, key, until) => {
      const marks = downKeys.get(provider)
      const mark = marks?.get(key)
      if (marks === undefined || mark === undefined) return false
      marks.set(key, { ...mark, until })
      return true
    },
    keyDownMark: (provider, key) => downKeys.get(provider)?.get(key),
    isKeyDown,
    // Clears one provider's key marks: the recovery probe's ring half (the
    // probe candidate ignores the down marks and the ring). The ring
    // position lives beside the marks now and never moves back either.
    clearKeyDownMarks,
    clearDownMarks,

    // —— Key rings ——
    // Builds the run's rings from the registry and records whether they are
    // active. `external` = the opencode server is not managed by this driver
    // (--server, OPENCODE_AUTO_SERVER or the agent profile's `server`), so it
    // cannot be restarted onto another key: the rings stay declared (for the
    // startup block) but inactive. Called where the run's agent fleet starts
    // (src/agent-pool.ts), the slot the composition order reserves.
    activateRings: (registry, external) => {
      rings = buildRings(registry)
      positions = new Map()
      active = !external
    },
    ringsActive,
    // §6.2 rule 4: does this provider's key ring have a key that is not down?
    // True for every provider when the rings never activated or are inactive
    // (an external server cannot rotate, so the ring never excludes a
    // candidate), and for providers without a ring.
    ringHasUsableKey: (provider, now) => {
      const keys = rings?.get(provider)
      if (!ringsActive() || keys === undefined) return true
      return keys.some((key) => !isKeyDown(provider, key.ref, now))
    },
    hasActiveRing,
    currentKey,
    ringRotation,
    // Commits a decided rotation: the current key is marked down and the
    // position advances. The position stays where it landed afterwards — a
    // cleared mark never moves it back (§6.4). `until` is a reset time the
    // failure-message classifier read (§7.1): the key's mark lasts until then
    // instead of the scope boundary.
    commitRotation: (rotation, until) => {
      markKeyDown(rotation.provider, rotation.from.ref.ref, until)
      positions.set(rotation.provider, rotation.to.index)
    },
    // The spawn config content for the managed server's next spawn (§4.3
    // injection): every active ring's current key as the provider's apiKey
    // reference. undefined = send no config at all (no active ring), so the
    // spawn environment keeps OPENCODE_CONFIG_CONTENT = "{}" exactly as the SDK
    // spawn sends it. Only references appear here; opencode substitutes them in
    // its own process.
    spawnKeyConfig: () => {
      if (!ringsActive() || rings === undefined || rings.size === 0) return undefined
      const provider: Record<string, unknown> = {}
      for (const [id, keys] of rings) {
        const key = currentKey(id)
        if (key !== undefined) provider[id] = { options: { apiKey: key.ref } }
      }
      return { provider }
    },
    // The run-start block's ring label for a model entry (§6.5): the live
    // position by reference name when the rings are active ("1/3 ZHIPU_KEY_A"),
    // the declared key count otherwise ("3" — the fleet's shape, not a live
    // position), and "0" for an entry without a ring, as the block always did.
    ringLabel: (entry) => {
      const live = ringsActive() ? rings?.get(entry.provider ?? "") : undefined
      if (live === undefined) return String(entry.keys?.length ?? 0)
      const key = currentKey(entry.provider!)!
      return ringKeyLabel({ ref: key, index: live.indexOf(key), total: live.length })
    },
    // The startup note for inactive rings (§4.3 limits), or undefined when the
    // rings are active, never activated, or the registry declares none.
    ringInactiveNote: () => {
      if (rings === undefined || active || rings.size === 0) return undefined
      return (
        "ℹ key rings are inactive: the opencode server is external (--server, OPENCODE_AUTO_SERVER or the agent " +
        "profile's server) and cannot be restarted onto the next key; the tier lines above show declared ring sizes only"
      )
    },
    // The recovery probe's ring half (§6.3): the probe candidate ignores the
    // down marks, the ring and the cap, so an exhausted ring's key marks clear
    // for the probe — the position stays where it is — and the key the probe ran
    // on is marked down again when the probe fails (markCurrentKeyDown below).
    // (The hoisted closure, exposed verbatim; the probeSelection fence calls
    // it.)
    clearRingMarks,
    // Marks the ring's current key down without moving the position: what a
    // failed recovery probe does to the key it ran on, and what an exhausted
    // ring's escalation does before it falls through; `until` as for
    // commitRotation.
    markCurrentKeyDown: (provider, until) => {
      const key = currentKey(provider)
      if (key !== undefined) markKeyDown(provider, key.ref, until)
    },

    // Returns whether the event changed anything (and was logged): a
    // `limit` event is logged only when its status or a window's reset
    // changed against what this client last logged.
    noteWindows: (client, event) => {
      const key = [event.status, ...event.windows.map((w) => `${w.scope}@${w.resetAt}`)].join(" ")
      if (windowsLogged.get(client) === key) return false
      windowsLogged.set(client, key)
      const windows = event.windows.map(
        (w) => `${w.scope} ${w.utilization !== undefined ? `${Math.round(w.utilization * 100)}% used, ` : ""}resets ${new Date(w.resetAt).toISOString()}`,
      )
      const head = event.status === "rejected" ? "⚠ a usage window is spent" : event.status === "warning" ? "⚠ usage windows near their limit" : "ℹ usage windows"
      log(`${head} (session ${event.session})${windows.length ? `: ${windows.join("; ")}` : ""}`)
      return true
    },

    // Arm the check for `name` (the entry's internal name): the next
    // step-finish observed on the wider id is judged against `used`, the
    // context size at the moment the session stepped up.
    awaitCacheClaim: (name, used) => {
      claimPending.set(name, used)
    },
    // Judge one step-finish's tokens against the armed claim, consuming it.
    // AUTO-DECISION: "large" reads as half the prefix (cacheRead >= used/2 confirms; cacheWrite >= used/2 with cacheRead under a tenth contradicts) — the fractions only pick how sure the warning is, and a wrong either way is one log line, not a routing decision
    observeCacheClaim: (name, tokens) => {
      const used = claimPending.get(name)
      if (used === undefined) return undefined
      claimPending.delete(name)
      if (used <= 0) return undefined
      if (tokens.cacheRead >= used / 2) return "confirmed"
      if (tokens.cacheWrite >= used / 2 && tokens.cacheRead < used / 10) return "contradiction"
      return undefined
    },
    // Whether the contradiction line for `name` was already logged (once per
    // entry), and marks it logged when not.
    noteClaimContradiction: (name) => {
      if (contradictionLogged.has(name)) return false
      contradictionLogged.add(name)
      return true
    },

    // —— The failure-message classifier ——
    classifierAnswerOf: (key) => classifierAnswers.get(key),
    noteClassifierAnswer: (key, answer) => {
      classifierAnswers.set(key, answer)
    },
    classifierInflightOf: (key) => classifierInflight.get(key),
    noteClassifierInflight: (key, call) => {
      classifierInflight.set(key, call)
    },
    dropClassifierInflight: (key) => {
      classifierInflight.delete(key)
    },
    classifierCalls: () => classifierCallsMade,
    // The budget's increment sits before the call starts, exactly as the
    // module state's ordering was, so the `call N/20` vlog (which reads the
    // counter through classifierCalls) does not drift.
    noteClassifierCall: () => {
      classifierCallsMade += 1
    },
    classifierLimitNoted: () => classifierLimitLine,
    noteClassifierLimit: () => {
      classifierLimitLine = true
    },
    // The run's classifier usage sink: registered by the composition root
    // under a registry, dropped before the stats handle flushes.
    setClassifyUsageSink: (sink) => {
      classifyUsageSink = sink
    },
    classifyUsageSink: () => classifyUsageSink,

    // —— The routing fence ——
    // The dual registry/no-registry dispatch target in one seam (see the
    // type comment). The registry half reads its live state — the marks,
    // the override, the rings — through the facts' router, never through
    // this instance: that half always followed the facts. The no-registry
    // half reads this instance's holders (sticky, the /failback override) —
    // the compatibility layer behind the fence, deleted in F2
    // (plans/0061 §4.11).
    target: (facts, chain, switches, cap, phase) => {
      if (facts !== undefined) {
        const decision = select(routeContext(facts, switches, cap), {
          role: chain.role ?? phaseToRole(chain.phase) ?? "bypass",
          entry: phase?.entry,
          now: facts.clock.now(),
          continuation: false,
        })
        return decision.kind === "pick" ? candidateKey(decision.candidate) : undefined
      }
      return modelOfChain(chain, switches, phase, sticky, override)
    },
    // The dispatch's model pair (see the type comment). The registry half
    // answers the pick the executor hands in — the plan's own selection,
    // not a fresh one; the no-registry half resolves the priority chain
    // over this instance's holders, exactly where the executor's branch
    // used to stand (the sticky and the override are read at the call,
    // and nothing between the two fence calls of one dispatch can write
    // them — the dispatch slot runs synchronously between its awaits).
    dispatchModel: (facts, chain, switches, phase, picked) => {
      if (facts !== undefined) return { target: picked?.model, promptModel: picked?.entry }
      const model = modelOfChain(chain, switches, phase, sticky, override)
      return { target: model, promptModel: model }
    },
    // The no-registry ◈ line (see the type comment): the from label and
    // the repeat rule moved here from the executor's branch; the chain's
    // display memory stays the caller's write.
    describe: (facts, chain, target, label, resumed) => {
      if (facts !== undefined || target === undefined) return undefined
      if (target === chain.modelShown && resumed) return undefined
      const from =
        chain.model !== undefined
          ? "fallback candidate"
          : sticky !== undefined
            ? "fallback candidate (sticky within phase)"
            : override !== undefined
              ? "/failback override"
              : "route"
      log(`◈ ${label} using model ${target} (${from})`)
      return target
    },

    // —— The session loop's failover neighbourhood ——
    // The dual failover decision in one seam (see the type comment). The
    // registry half marks the model being left down on this instance and
    // selects over the facts (routeContext reads the facts' router — the
    // run's router, this same instance); the wait-and-reselect loop is
    // escalation step 3. The no-registry half is the fallback-ring walk the
    // session loop's own branch held, moved verbatim — the compatibility
    // layer of plans/0061 §4.11, deleted in F2.
    failover: async (facts, switches, site) => {
      const { chain, phase, cap, limits, ladder, label, why, until, classified, waitWindow } = site
      let from: string | undefined
      let to: string | undefined
      let toModel: string | undefined
      let pickAgent: string | undefined
      let ringSize = 0
      if (facts !== undefined) {
        from = chain.modelEntry
        if (from !== undefined) markModelDown(from, until, classified)
        const ctx = routeContext(facts, switches, cap, limits)
        const call = { role: roleOf(chain), entry: phase?.entry, now: facts.clock.now(), continuation: false as const }
        let decision = select(ctx, call)
        if (decision.kind === "wait") {
          // Escalation step 3 (§7): the remaining candidates are blocked
          // only by their windows — wait for the opening plus the jitter
          // instead of handing a closed window to the probe loop, then
          // select again.
          await waitWindow(waitPayload(facts, ctx, call, decision))
          decision = select(ctx, { ...call, now: facts.clock.now() })
        }
        if (decision.kind !== "pick") return undefined
        to = candidateKey(decision.candidate)
        // The model just marked down cannot be the pick; a same-name result
        // would mean an override re-listed it — refuse rather than loop.
        if (to === from) return undefined
        toModel = decision.candidate.kind === "entry" ? decision.candidate.entry.model : decision.candidate.model
        pickAgent = decision.candidate.kind === "entry" ? decision.candidate.entry.agent : facts.defaultAgent
      } else {
        const fallback = override?.fallback ?? switches.model.fallback
        // Candidates with a known window < cap are skipped with the reason
        // logged once (D.4: hitting the ceiling or the handover budget
        // right after the failover would be worse than the original
        // fault); an unknown window (absent from the map) is not filtered.
        // AUTO-DECISION: the skipping line's token figures come from log.ts's formatTokens, not session-api's (the two are verbatim twins by construction; session-api type-imports opts, whose inline Router type edge would close a type-counted cycle the import-direction DAG check rejects, so the router cannot reach it)
        for (const c of fallback) {
          if (ladder.tried.includes(c)) continue
          const limit = limits.get(c)
          if (limit !== undefined && limit < cap) {
            if (!ladder.clipped.includes(c)) {
              ladder.clipped.push(c)
              log(`⇄ ${label} skipping candidate ${c}: context window ${formatTokens(limit)} < chain requirement ${formatTokens(cap)}; switching would immediately hit the ceiling`)
            }
            continue
          }
          to = c
          break
        }
        // Candidates exhausted (all tried, or all skipped by window
        // clipping).
        if (to === undefined) return undefined
        // Record the model being left (for the log and the failover note):
        // a candidate already failed over to on the chain wins, otherwise
        // the routing primary model; without routing, from is undefined and
        // the log renders "primary model". If from happens to be a real
        // candidate string, mark it tried as well (so it is not picked
        // again). The same priority chain as the dispatch target
        // (modelOfChain: chain.model > sticky > /failback override > the
        // routing table).
        from = modelOfChain(chain, switches, phase, sticky, override)
        if (from !== undefined && !ladder.tried.includes(from)) ladder.tried.push(from)
        ladder.tried.push(to)
        toModel = to
        ringSize = fallback.length
      }
      // The route the failover picked, the value the caller writes
      // wholesale: under a registry the selection state — the internal
      // name and the base step — travels with the chain; the down marks
      // replace the phase-scoped sticky holder (§6.4), so scope=phase keeps
      // the move through the task boundaries without it. Without a registry
      // only the model string is written.
      const route: ChainRoute = facts !== undefined ? { model: toModel, entry: to, step: 0 } : { model: toModel }
      if (facts === undefined && switches.modelFailbackScope === "phase") {
        // failback scope phase: the failover stays sticky across tasks —
        // the chain is destroyed per task, so the chosen candidate is
        // carried into the phase's later tasks through the failback
        // holder, and only the phase boundary (clearSticky) resets back to
        // the preferred model. The sticky holder is this instance's own
        // state.
        sticky = to
      }
      // The ⇄ line and the cross-agent verdict share the one condition:
      // the pick runs on another agent than the chain's session (a session
      // never crosses agents).
      const move = pickAgent !== undefined && chain.agent !== undefined && pickAgent !== chain.agent
      log(
        facts !== undefined
          ? `⇄ ${label} ${why}; ${move ? `moving to agent ${pickAgent}, starting a new session there (a session never crosses agents), switching model` : "keeping chain context, switching model"} ${from ?? "primary model"} → ${to} (registry list; ${from ?? "the primary"} marked down)`
          : `⇄ ${label} ${why}; keeping chain context, switching model ${from ?? "primary model"} → ${to} (candidate ${ladder.tried.length}/${ringSize})`,
      )
      return { from, to, route, moveAgent: move ? pickAgent : undefined }
    },
    // The step-1 plan (see the type comment): the ring state this reads is
    // this instance's own — the same instance the escalation's commits and
    // marks go through. The registry-presence test is the routing branch
    // the fence owns.
    keyRotation: (facts, chain) => {
      if (facts === undefined) return undefined
      const provider = facts.registry.models.get(chain.modelEntry ?? "")?.provider
      if (provider === undefined || !hasActiveRing(provider)) return undefined
      return { provider, rotation: ringRotation(provider, facts.clock.now()) }
    },
    // The exhaustion line (see the type comment): the registry arm reads
    // this instance's marks as they stand at the call — after the
    // escalation wrote its own.
    exhaustionWhy: (facts, label, ladder) =>
      facts !== undefined
        ? `${label} and every candidate of the tier list is down (down: ${[...downModels.keys()].join(", ") || "none"})`
        : `${label} and fallback candidates exhausted (tried: ${ladder.tried.join(", ") || "none"})`,

    // —— The session loop's recovery-wait neighbourhood ——
    // The escalation's down-mark read (see the type comment): the rings are
    // this instance's own state, the provider lookup the facts' registry.
    downTarget: (facts, chain) => {
      const model = chain.modelEntry
      const provider = facts?.registry.models.get(model ?? "")?.provider
      const key = provider !== undefined && hasActiveRing(provider) ? currentKey(provider) : undefined
      return { model, provider, ...(key !== undefined ? { key: { ref: key.ref, label: key.label } } : {}) }
    },
    // The late classifier answer's mark extension (see the type comment):
    // the ⏲ line renders the reset in the registry's time zone, so its
    // guard is the routing branch the fence owns — without a registry the
    // escalation wrote no marks, nothing extends, and the line never fired.
    lateReset: (facts, pending, target, label) => {
      if (pending === undefined) return
      void pending.then((until) => {
        if (until === undefined) return
        const marked: string[] = []
        if (target.model !== undefined && extendModelDownMark(target.model, until)) marked.push(target.model)
        if (target.provider !== undefined && target.key !== undefined && extendKeyDownMark(target.provider, target.key.ref, until))
          marked.push(`provider ${target.provider} key ${target.key.label}`)
        if (marked.length && facts !== undefined)
          log(`⏲ ${label} the classifier's answer arrived after the turn ended: ${marked.join(" and ")} stay${marked.length > 1 ? "" : "s"} down until ${isoInZone(until, facts.registry.tz)}`)
      })
    },
    // The chain's dispatch model (see the type comment): the no-registry
    // half reads this instance's sticky/override holders at the call.
    chainModel: (facts, chain, switches, phase) =>
      facts !== undefined ? chain.modelEntry : modelOfChain(chain, switches, phase, sticky, override),
    // The wait-and-probe round's sleep source (see the type comment). The
    // cascade's compound conditions are the fence's load-bearing part:
    // under a registry whose recoveryAt answered nothing (`back` undefined
    // with facts present), neither the stated reset nor the learned windows
    // apply — the round polls — while without a registry both stand, and a
    // registry answer that sits in the past (`back.at <= now`) falls
    // through to them exactly the same way.
    recoverySleep: async (facts, switches, site) => {
      const { chain, phase, cap, cause, loadLimits, learned, now: fallbackNow } = site
      const now = facts !== undefined ? facts.clock.now() : fallbackNow()
      let at: number | undefined
      let reason: string | undefined
      let model: string | undefined
      let back: ReturnType<typeof recoveryAt> | undefined
      if (facts !== undefined) {
        back = recoveryAt(routeContext(facts, switches, cap, await loadLimits()), { role: roleOf(chain), entry: phase?.entry, now, continuation: false })
      }
      if (back !== undefined && back.at > now) {
        at = back.at
        model = candidateKey(back.candidate)
        reason = `${model} is usable again at ${isoInZone(at, facts!.registry.tz)}`
      } else if ((facts === undefined || back !== undefined) && cause?.resetAt !== undefined) {
        at = cause.resetAt
        reason = `${limitPhrase(cause.scope)} resets ${new Date(at).toISOString()}`
      } else if (facts === undefined || back !== undefined) {
        const record = await learned(now)
        if (record !== undefined) {
          at = record.resetAt
          reason = `${limitPhrase(record.scope)} resets ${new Date(at).toISOString()} (recorded ${new Date(record.learnedAt).toISOString()})`
        }
      }
      model ??= (facts !== undefined ? chain.modelEntry : modelOfChain(chain, switches, phase, sticky, override)) ?? chain.modelShown ?? "(agent default)"
      return { now, at, reason, model }
    },
    // The probe candidate of one round (see the type comment): the mark
    // clears write this instance's own state; the wait loop hands the site's
    // sleeper the payload the fence builds (the twin of the deleted
    // session-side windowWaitOf).
    probeSelection: async (facts, switches, site) => {
      const { chain, phase, cap, loadLimits, waitWindow } = site
      if (facts === undefined) return undefined
      const ctx = routeContext(facts, switches, cap, await loadLimits())
      const call = { role: roleOf(chain), entry: phase?.entry, now: facts.clock.now(), continuation: false as const }
      let decision = select(ctx, call)
      // A wait decision here (the marks cleared mid-loop — /failback, say —
      // and what is left is window-blocked): wait for the opening rather
      // than probe a closed window, then take the probe decision.
      while (decision.kind === "wait") {
        await waitWindow(waitPayload(facts, ctx, call, decision))
        decision = select(ctx, { ...call, now: facts.clock.now() })
      }
      if (decision.kind !== "probe") return undefined
      const model = candidateKey(decision.candidate)
      clearModelDownMark(model)
      if (decision.candidate.kind === "entry" && decision.candidate.entry.provider !== undefined) {
        const provider = decision.candidate.entry.provider
        clearRingMarks(provider)
        return { model, provider }
      }
      return { model, provider: undefined }
    },
  }
}

// —— The routing fence (the dual registry/no-registry path in one seam) ——
// The registry/no-registry branch of every routing decision lives in this
// module: the callers pass their routing facts untested and the fence
// decides which half runs (plans/0061 §2.1 R2: one seam now, the
// no-registry half deleted in F2 — §4.11's compatibility layer). The
// fence's free functions are the stateless verdicts (no holder reads);
// `target`, `dispatchModel` and `describe` above are the dispatch-side
// holder-reading decisions as methods, `failover`, `keyRotation` and
// `exhaustionWhy` the session loop's failover neighbourhood as methods,
// and `downTarget`, `lateReset`, `chainModel`, `recoverySleep` and
// `probeSelection` its recovery-wait neighbourhood as methods (the
// instance supplies the holders and marks those decisions read and
// write), and the record-side remainder — the fork base's agent and
// role verdicts beside the record agent field — as the free functions
// below.

// The structural slice of the run's routing facts the fence reads. The
// run's RoutingFacts (src/routing.ts) satisfies it field for field; the
// fence cannot name that type: routing carries the Router type, so an
// import back — type-only included — would close a cycle the
// import-direction DAG check rejects (the same reason ClassifierAnswer
// lives in this module, beside its cache). The clock likewise appears as
// its structural `{ now }` slice, not the services' Clock: services
// imports createRouter at run time.
export type RouteFacts = {
  registry: ModelRegistry
  // §6.2 rule 1: the adapter filter; undefined = no filter.
  agentFilter: string | undefined
  // §9 R6: the project's configured agent (the default agent raw override
  // values and unqualified records use).
  defaultAgent: string
  // §8.2: the agent profile this run starts on.
  runAgent: string
  router: Router
  clock: { now(): number }
  // The window wait's jitter knob (hibernate's 0–600 s delay): the facts'
  // injected random, absent = Math.random — the run's RoutingFacts carries
  // the same optional field.
  random?: () => number
}

// The selection context the fence builds from the facts — the twin of
// routing.ts's selectContext, optional `limits` included: a fence call
// that holds live context windows passes them (the failover's clipping and
// selection read them), the others select without (an unknown window never
// excluded a candidate on the no-registry path either, so the comparison
// keeps its shape). The down marks, the /failback override and the key
// rings are the live run state behind the facts' router, read exactly as
// selectContext reads them.
// AUTO-DECISION: the fence's selections carry no context windows except where the site holds them (the live limits belong to the agent a resume check never sees); an unknown window never excluded a candidate on the no-registry path either, so the comparison keeps its shape
function routeContext(facts: RouteFacts, switches: Switches, cap: number, limits?: ReadonlyMap<string, number>): SelectContext {
  return {
    registry: facts.registry,
    cap,
    agentFilter: facts.agentFilter,
    defaultAgent: facts.defaultAgent,
    policy: switches.model,
    override: facts.router.failbackOverride(),
    marks: facts.router.downMarks(),
    ringUsable: (provider, now) => facts.router.ringHasUsableKey(provider, now),
    ...(limits !== undefined ? { limits } : {}),
  }
}

// The wait payload of a wait decision (the model that opens first, its
// formatted opening and the dispatch list's tier) — the one home of the
// payload build since the recovery-wait neighbourhood fenced in: the
// failover's wait-and-reselect and the probe loop both build it here (the
// dispatch side builds its own from the list it already holds,
// src/engine/dispatch.ts).
function waitPayload(
  facts: RouteFacts,
  ctx: SelectContext,
  call: SelectCall,
  decision: { until: number; candidate: Candidate },
): WindowWait {
  return {
    until: decision.until,
    model: candidateKey(decision.candidate),
    tier: candidatesOf(ctx, call).tier,
    opens: formatWindowState({ open: false, opens: decision.until }, facts.registry.tz, call.now),
  }
}

// Does a recorded session id belong to an agent this run can dispatch on?
// `facts` undefined = no registry (no verdict, every record passes). Under
// a registry the recorded agent (absent = the run's start profile, the
// shape every pre-binding record reads as) must name a profile the registry
// knows — or be the run's start agent itself, which may run profile-less
// when the registry holds no profile of the chosen adapter — and its
// adapter must pass the agent filter: session ids are agent-local, and a
// filtered-out agent's model is never a candidate, so its sessions are
// never resumed nor forked (plans/0055 §8.3). Moved from src/unit-commit.ts
// behind the fence: its no-registry guard is a routing-truthiness branch.
export function recordedAgentOk(facts: RouteFacts | undefined, recorded: string | undefined): boolean {
  if (facts === undefined) return true
  const agent = recorded ?? facts.runAgent
  const adapter =
    facts.registry.agents.get(agent)?.adapter ??
    (agent === facts.runAgent ? (facts.agentFilter ?? facts.defaultAgent) : undefined)
  return adapter !== undefined && (facts.agentFilter === undefined || adapter === facts.agentFilter)
}

// The §10 item 11 eligibility of a strict resume under a registry (moved
// from src/unit-commit.ts behind the fence): the recorded internal name is
// judged by eligibility, not equality. Selection is asked exactly as the
// dispatch a resumed session takes — a continuation over the recorded
// model (§6.2 keeps the chain's model while it is usable) — and the
// recorded model must be what it keeps. So a window change that only moves
// the fresh pick (an earlier candidate's window reopening), a reordered
// list or a returned primary does not roll a unit back; a model that is
// marked down, outside its windows, excluded by the agent filter or gone
// from the registry is not eligible. Without a registry there is no
// verdict (false; the callers keep the raw-string comparison).
export function resumeModelEligible(
  facts: RouteFacts | undefined,
  switches: Switches,
  cap: number,
  phaseKey: PhaseKey | undefined,
  recorded: string,
  phase?: Phase,
  role?: ModelRole,
): boolean {
  if (facts === undefined) return false
  const decision = select(routeContext(facts, switches, cap), {
    role: role ?? phaseToRole(phase) ?? "bypass",
    entry: phaseKey?.entry,
    now: facts.clock.now(),
    continuation: true,
    current: recorded,
  })
  return decision.kind === "pick" && candidateKey(decision.candidate) === recorded
}

// The §8.3 dead-session verdict of a resume record under a registry (moved
// from src/unit-commit.ts behind the fence): a recorded session is resumed
// only if its agent is one this run can dispatch on and its recorded model
// is usable now; otherwise the session is dead and the resume takes the
// existing path of a new session with the resume note (under strict
// resume, the rollback path). Returns the reason for the log line;
// undefined = no verdict (without a registry, or a record that names
// nothing to check — a non-strict record carries no model, and
// eligibility then has nothing to judge).
export function deadSessionWhy(
  facts: RouteFacts | undefined,
  switches: Switches,
  cap: number,
  phaseKey: PhaseKey | undefined,
  record: { agent?: string; model?: string; phase?: Phase },
  role?: ModelRole,
): string | undefined {
  if (facts === undefined) return undefined
  if (!recordedAgentOk(facts, record.agent)) {
    return `the recorded session lives on agent ${record.agent ?? facts.runAgent}, which this run does not dispatch on${facts.agentFilter ? ` (agent filter ${facts.agentFilter})` : " (no such agent profile)"}`
  }
  if (record.model !== undefined && !resumeModelEligible(facts, switches, cap, phaseKey, record.model, record.phase, role)) {
    return `the recorded session's model ${record.model} is not usable now`
  }
  return undefined
}

// The agent field of a record the dispatch side persists (the handover
// claim's continuation session, the progress record of a running
// session): the field is present iff a registry drives the run and the
// chain names its agent — absent = the default agent's, so pre-binding
// records read correctly and a no-registry run writes byte-identical
// files. A stateless verdict of the fence (no holder reads): callers
// spread the result into their record literal and pass `opts.routing`
// untested; the no-registry `{}` half is the compatibility layer of
// plans/0061 §4.11, deleted in F2.
export function agentField(facts: RouteFacts | undefined, agent: string | undefined): { agent?: string } {
  return facts !== undefined && agent !== undefined ? { agent } : {}
}

// The hibernate jitter of a scheduled sleep (0–600 s on top of the
// instant, so drivers sharing an account do not all wake the same
// second): the facts' injected random under a registry, Math.random
// without one. A stateless verdict of the fence (the knob the window
// wait's and the recovery sleep's tails draw); the `facts?.random` read is
// the routing branch the fence owns.
export function jitterOf(facts: RouteFacts | undefined): number {
  return (facts?.random ?? Math.random)() * HIBERNATE_JITTER_MS
}

// The wake computation of the window wait (§6.3): the interval to sleep
// (the distance to the opening, clamped at zero, plus the jitter) and the
// instant the wait line announces. The registry arm reads the facts'
// clock, exactly as the site's asserted read used to; the no-registry arm
// never runs (a WindowWait exists only where selection produced one, and
// selection is registry-only machinery) — it answers over the run clock
// the site hands in, the compatibility half F2 deletes. Stateless, hence
// a free function; the ⏸/→ lines and the booked sleep stay with the
// caller (session I/O on the services clock).
export function windowWake(facts: RouteFacts | undefined, wait: WindowWait, fallbackNow: () => number): { sleep: number; wakeAt: Date } {
  const now = facts !== undefined ? facts.clock.now() : fallbackNow()
  const sleep = Math.max(0, wait.until - now) + jitterOf(facts)
  return { sleep, wakeAt: new Date(now + sleep) }
}

// The chain of one recovery probe: a fresh one-off view that copies the
// real chain's model only without a registry (what is probed is exactly
// the model the run will continue on; under a registry the probe's own
// dispatch selects, so the view carries the role and nothing else — no
// phase, no progress record, the real chain's recovery point untouched).
// Stateless verdict of the fence; callers pass `opts.routing` untested.
export function probeChain(facts: RouteFacts | undefined, chain: SessionChain): SessionChain {
  return { pct: 100, used: 0, at: 0, ...(facts !== undefined ? {} : { model: chain.model }), role: roleOf(chain) }
}

// The chain whose model fields name the account a recovery probe ran on:
// the probe chain itself under a registry (the probe's dispatch wrote the
// probed entry onto it), the interrupted chain without one (the probe
// copied its model). Answers the chain view accountOf reads; stateless
// verdict of the fence, callers pass `opts.routing` untested.
export function probeAccountChain(
  facts: RouteFacts | undefined,
  probe: SessionChain,
  chain: SessionChain,
): Pick<SessionChain, "model" | "modelEntry" | "modelShown"> {
  return facts !== undefined ? probe : chain
}

// Whether a registry drives the run — the boolean the pure ladder
// decision's facts carry (the registry flag of LadderFacts). The
// truthiness test is the fence's to own; callers pass `opts.routing`
// untested.
export function registryDriven(facts: RouteFacts | undefined): boolean {
  return facts !== undefined
}

// The agent whose fork-base record a forking chain reads and writes
// (plans/0055 §8.4): the base the pipeline forks from must live on the
// agent the forking subtask's chain runs on, so the persisted record is
// per agent — under a registry that is the chain's agent (the decompose
// dispatch's before the first subtask, the moved-to agent after a
// cross-agent failover: a subtask that moved to another agent forks from
// that agent's base, building it on first use), with the facts' runAgent
// standing in while the chain holds no session. undefined = no registry,
// where the plain-string record of the one-agent era applies as-is and
// setForkBase keeps the old shape — the no-registry half is the
// compatibility layer of plans/0061 §4.11, deleted in F2. A stateless
// verdict (facts reads alone, no holder state); callers pass
// `opts.routing` untested.
export function forkAgent(facts: RouteFacts | undefined, chain: SessionChain): string | undefined {
  return facts !== undefined ? (chain.agent ?? facts.runAgent) : undefined
}

// The role of the fork base's one-off rebuild chain (plans/0055 §8.4): a
// base's value is a warm prefix (plans/0003), and a prefix cached under
// one model is a miss under another, so the chain carries the `subtask`
// role and the dispatch inside selects (and fails over) on the subtask
// tier's list — the picked entry's variant and base step included.
// Without a registry the field stays absent and the bypass routing of
// the one-agent era applies unchanged (plans/0055 C2) — the compatibility
// half of the fence (plans/0061 §4.11), deleted in F2. Callers spread
// the verdict into the chain literal, `opts.routing` passed untested.
export function forkBaseRole(facts: RouteFacts | undefined): { role?: ModelRole } {
  return facts !== undefined ? { role: "subtask" } : {}
}

// The agent the fork-base record names as truly holding the built base
// session (plans/0055 §8.2): under a registry it is the rebuild chain's
// landed agent (the dispatch inside picked it — the subtask route's
// first usable candidate's profile, which is where the forking subtask
// dispatches too, so the prefix caches under the model that forks from
// it), with the reading agent (forkAgent's answer) standing in when the
// dispatch left no agent on the chain; with one agent a run this is
// always the reading agent. undefined = no registry, where the record
// keeps the old shape — the compatibility half of the fence
// (plans/0061 §4.11), deleted in F2. A stateless verdict; callers pass
// `opts.routing` untested.
export function landedAgent(facts: RouteFacts | undefined, base: SessionChain, agent: string | undefined): string | undefined {
  return facts !== undefined ? (base.agent ?? agent) : undefined
}

// The limits a reset instant reads as on the wait line (plans/0057 §7).
function limitPhrase(scope: LimitScope | undefined): string {
  switch (scope) {
    case "5h":
      return "the five-hour usage window"
    case "7d":
      return "the weekly usage window"
    case "day":
      return "the daily usage window"
    case "request":
    case "token":
      return "the per-minute limit"
    default:
      return "the limit"
  }
}

// The failover fence's slice of the session loop's ladder bookkeeping: the
// candidate strings this chain has already tried (ordered, for the
// exhaustion line and the dedup on re-selection) and those skipped because
// their context window falls short (for the same). A structural slice of
// the loop's LadderState, taken as data exactly like the chain view and
// the sticky/override holders elsewhere in the fence: the ladder is
// loop-local, per-prompt state the fence mutates through the argument
// (never holds), so naming the engine's type would couple the service to
// the decision module its caller executes for no gain.
export type FailoverLadder = { tried: string[]; clipped: string[] }

// One decided model failover (the answer of `failover`): the model being
// left (`from`, undefined = the primary — the log renders "primary model"),
// the candidate picked (`to`: a registry entry's internal name, or the
// ring's model string without one), the route value the caller writes
// through setRoute (under a registry the selection state travels with the
// chain: model id + internal entry + a reset step; without one the model
// string alone), and the cross-agent move's target agent (undefined = keep
// the chain's context, a fork of the failed session).
export type FailoverDecision = {
  from: string | undefined
  to: string
  route: ChainRoute
  moveAgent: string | undefined
}

// The escalation's step-1 key-rotation plan (the answer of `keyRotation`):
// the provider whose ring moves, and the rotation that would land — or
// undefined for a ring with no key left that is not down, whose current
// key still failed and must be marked down before the fall-through to the
// model failover.
export type KeyRotationPlan = { provider: string; rotation: RingRotation | undefined }

// The down marks one failure's escalation may write (the answer of
// `downTarget`, fed to `lateReset`): the chain's selected entry, and the
// key it ran on when its provider has an active ring — the `{ model }`
// subset is what the probe loop's late classifier answer extends.
export type DownTarget = { model?: string; provider?: string; key?: { ref: string; label: string } }

// The sleep source of one wait-and-probe round (the answer of
// `recoverySleep`): the round's `now` (the timeline the horizon clamp and
// the wake math share), the instant slept to (undefined = poll for
// recoveryWait), the reason the ⏳ line renders and the model the wait is
// for (the quota-window figure's key).
export type RecoverySleepPlan = { now: number; at: number | undefined; reason: string | undefined; model: string }

// The probe candidate of one wait-and-probe round (the answer of
// `probeSelection`): the candidate's key (its model mark was cleared for
// the probe and is re-marked on failure), and the provider whose ring
// marks cleared with it (its current key is re-marked on failure;
// undefined for a raw candidate or a ringless entry).
export type ProbeTarget = { model: string; provider: string | undefined }
