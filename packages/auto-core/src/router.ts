// The router service (the consolidation's services stage): the run-wide
// decision state of routing and recovery that used to live in module
// singletons — the failback holders (the pending /failback order and the
// run-time model-order override), the down marks of the model registry (per
// model, and per provider key for the rings), the key rings themselves (the
// built rings, the per-provider position, whether rotation is active), the
// usage windows last logged per agent client, the model-step cache-claim
// checks, and the failure-message classifier's run state (its answer cache,
// its in-flight calls, its call budget and its usage sink). One instance per
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
// (`Opts.router`, for the pipeline's failback boundary hooks), and the
// policies helpers that stayed below it (classify) take it as a leading
// parameter — the key-ring functions moved in as methods, leaving keyring.ts
// the pure library (the ring build and the key labels, no state). The pure
// decisions keep reading state as data, exactly as they read the clock.
//
// Construction: in the run's written order the router joins the composition
// after the switch snapshot freezes, reading the registry and the frozen
// switches. The failback holders, the marks, the logged windows and the
// step claims are registry-agnostic run state, and the key rings read the
// registry only at their activation — where the run's agent fleet starts
// (src/agent-pool.ts, after the holder exists, through `activateRings`),
// not at construction — so `createRouter()` takes no inputs and the holder
// may build it beside the clock, which depends on nothing above it either.
// The routing decisions read the registry and the switches per call, never
// at construction: the methods take the run's routing facts (and the
// switches, the cap, whatever the site holds) as call-time arguments, so
// the same construction order stands and a holder the preload builds before
// a test parses its switches never captures a stale snapshot. Every run has
// a registry (a layer-backed one, or the implicit registry the env switches
// synthesize where no layer exists — 0061 F2), so the facts are always
// defined and the routing path is single.
// AUTO-DECISION: createRouter() is parameterless instead of receiving the registry and the frozen switch snapshot (no state it builds consults either — the key rings read the registry at their activation, not at construction — and the boundary clears keep taking the failback scope as a call argument because the switch memo is per-parse process state that a test or the pre-freeze composition must be able to change independently of the holder, and capturing the memo at construction time would freeze a stale snapshot for every holder the preload builds before a test parses its switches).
import type { AgentClient, AgentEvent, AgentTokens, LimitScope } from "./agent/types"
import type { Boundary } from "./control-types"
import { phaseToRole, roleOf, type SessionChain, type WindowWait } from "./chain"
import type { ChainRoute } from "./chain-transitions"
import { failbackApplies } from "./failback"
import { HIBERNATE_JITTER_MS } from "./hibernate"
import { buildRings, registryProviders, ringKeyLabel, type RingRotation, type RingWalk } from "./keyring"
import { log } from "./log"
import { formatWindowState, isoInZone } from "./model-window"
import type { ModelEntry, ModelRegistry, ModelReference } from "./models-schema"
import type { PhaseKey } from "./phases/registry"
import type { Phase } from "./resume"
import { candidateKey, candidatesOf, recoveryAt, select, selectContextOf, type Candidate, type DownMark, type SelectContext, type SelectCall } from "./select"
import type { FailbackScope, ModelRole, Switches } from "./switches"
import type { Usage } from "./stats"

// The run-time model-order override a parameterized /failback leaves behind:
// the first argument is the preferred wildcard, the rest the failover
// candidate ring.
type FailbackOverride = { wildcard: string; fallback: string[] }

// The verdict of one cache-claim observation; undefined = no claim was
// pending, or the tokens were inconclusive (a small cacheWrite with a small
// cacheRead says nothing either way).
type CacheClaim = "confirmed" | "contradiction"

// The streaming-timeout floor the spawn config sets for every registry
// provider (plans/0127): headerTimeout and chunkTimeout, in milliseconds.
// The managed server's own defaults measure 300s — a long single-shot
// generation (a task's one-call document write) structurally outlasts them,
// and every such step died as a transient error, re-forked, and burned hours
// at zero output (the 2026-10-26 cleanroom T-020 incident: 4h14m on one
// task, ~415.9k tokens re-read per retry). 20 minutes covers the measured
// latency class of these replies while staying a bounded wait on a dead
// endpoint (the retry ladder and the key rotation ride the same errors). The
// floor is a default, never an override: the adapter drops a key the
// target's opencode.json declares, so an explicit person value wins.
export const STREAM_TIMEOUT_FLOOR_MS = 1_200_000

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
  markKeyDown(provider: string, key: string, until: number): void
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
  commitRotation(rotation: RingRotation, until: number): void
  // The new-session walk (plans/0163 D2): the order-first search with the
  // current key included, landing on the first key that carries a mark
  // whose instant has passed — a recovered earlier key (a key with no mark
  // never triggers one; the probe's clear leaves that shape and its
  // session must test the current key). undefined = nothing to do — no
  // recovered earlier key, the recovered key already current, no ring,
  // inactive rings, or every key still held. commitWalk moves the position
  // alone (the from key did not fail — no mark is written); the caller
  // restarts the managed server onto the landed key.
  ringWalk(provider: string, now: number): RingWalk | undefined
  commitWalk(walk: RingWalk): void
  // The owed re-key of a /failback rewind (plans/0178 D4, 0165-057/S16-01):
  // consumeFailback rewinds every ring's position but cannot restart the
  // running managed server itself (the router owns positions, not hosts) —
  // the owed flag is the pending act the next new session's pre-first-call
  // moment applies (a serial, safe boundary; the walk's own path). Consumed
  // only by the path that restarts.
  rekeyOwed(): boolean
  consumeRekeyOwed(): void
  // The managed server's spawn config content: the active rings' current
  // keys as apiKey references, plus the streaming-timeout floor for every
  // registry provider (plans/0127); undefined sends no config at all.
  spawnKeyConfig(): Record<string, unknown> | undefined
  ringLabel(entry: ModelEntry): string
  ringInactiveNote(): string | undefined
  clearRingMarks(provider: string): void
  markCurrentKeyDown(provider: string, until: number): void
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
  // The formulation one-shots' usage sink (plans/0097 D6): the constructor
  // and the fidelity pass book their tokens through it into the stats
  // `synthesis` bucket — outside the unit-session totals, the classify
  // precedent; the entry name is dropped by the wiring, which books into one
  // bucket. Until a run registers one, the usage is only measured.
  setSynthesisUsageSink(sink: ClassifyUsageSink | undefined): void
  synthesisUsageSink(): ClassifyUsageSink | undefined
  // —— The routing decisions ——
  // The dispatch target of one routing decision: a fresh-prompt selection
  // over the facts — the pick's candidate key, undefined = nothing usable
  // now.
  target(
    facts: RouteFacts,
    chain: SessionChain,
    switches: Switches,
    cap: number,
    phase: PhaseKey | undefined,
  ): string | undefined
  // The dispatch's model pair: the plan's pick — the route the pure
  // planner resolved before anything was created and setRoute then wrote
  // onto the chain (`picked`, the executor passes the pick's route:
  // `target` is the model id the prompt carries, `promptModel` the entry
  // the strict-resume record keys on; the pick already read the live
  // windows and the step walk, and the chain's route fields cannot stand
  // in because the session-scope failback clear may have wiped them after
  // the pick).
  dispatchModel(picked: { model?: string; entry?: string } | undefined): { target: string | undefined; promptModel: string | undefined }
  // The model failover of the session loop's escalation (§7 step 2): the
  // model being left — the chain's selected entry — is marked down (this
  // instance's marks) and a fresh selection picks the next usable
  // candidate of the list, waiting through `site.waitWindow` and
  // re-selecting when only the windows block (escalation step 3). Logs the
  // ⇄ line itself and returns the decided failover — the model left
  // (undefined = the primary), the candidate picked, the route value the
  // caller writes through setRoute, and the cross-agent move's target
  // agent (undefined = keep the chain's context) — or undefined = no
  // candidate (the caller falls into the wait-and-probe loop). The fork
  // walk and every chain write stay with the caller; the ladder is
  // loop-local per-prompt state the caller owns.
  failover(
    facts: RouteFacts,
    switches: Switches,
    site: {
      chain: SessionChain
      // The run's current phase (opts.phase): its type entry feeds the
      // selection call.
      phase: PhaseKey | undefined
      cap: number
      // The context windows the site fetched (contextLimitsOf); the
      // failover's clipping and selection read them.
      limits: ReadonlyMap<string, number>
      // The ⇄ line's unit label (the task id).
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
  // without its I/O: the provider of the chain's selected entry when its
  // ring is active, with the decided key search (order-first, plans/0144
  // D2) — `rotation.to` present when it lands, undefined when the ring
  // refuses (every other key held; a single-key ring), either way naming
  // the current key so the caller can apply it through commitRotation (a
  // refusal unconditionally, a landing after its host precondition). undefined = no
  // key rotation applies (a chain model the registry does not know, or a
  // provider without an active ring): step 1 is a no-op and the caller
  // falls straight through to the model failover. The spawn config, the
  // host restart and the re-dispatch fork stay with the caller; the commit
  // and the key state are the router methods the caller already calls.
  keyRotation(facts: RouteFacts, chain: SessionChain): KeyRotationPlan | undefined
  // The exhaustion line of the escalation's fall-through into the
  // wait-and-probe loop: the tier list's down marks as they stand at the
  // call — after the escalation wrote its own (this instance's marks, the
  // run's router).
  exhaustionWhy(facts: RouteFacts, label: string): string
  // The down marks one failure's escalation may write (§7.1): the chain's
  // selected entry and, when its provider has an active ring, the key it
  // ran on — read before the escalation moves anything, so a classifier
  // answer still on its way can extend them to the reset it names
  // (lateReset below). The registry lookup reads the facts, the rings this
  // instance's own state (the same instance the caller's mark writes went
  // through).
  downTarget(facts: RouteFacts, chain: SessionChain): DownTarget
  // A classifier answer that arrives after the turn ended (§7.1): it can
  // only set when this failure's down marks clear — each mark the
  // escalation wrote (the `target` downTarget answered, or the probe
  // candidate's model mark) and nothing cleared since then lasts until the
  // reset time instead of the scope boundary. The class it names comes too
  // late to change anything; only the ⏲ line (gated on the facts, whose
  // time zone renders the instant) says so. The mark extensions write this
  // instance's own state.
  lateReset(
    facts: RouteFacts,
    pending: Promise<number | undefined> | undefined,
    target: DownTarget,
    label: string,
  ): void
  // The sleep of one wait-and-probe round: which source schedules the
  // round — the instant the down list comes back by waiting alone
  // (select.ts recoveryAt over the facts' context), with a stated reset or
  // the account's learned windows standing in when a registry answer sits
  // in the past — and the model the wait is for (the chain's dispatch
  // entry). The site keeps what the fence cannot reach: the context-window
  // fetch (handed in as `loadLimits`), the learned-window lookup
  // (`learned`, invoked only when the cascade reaches it), and the horizon
  // clamp with the poll fallback (RESET_HORIZON_MS stays with the caller).
  // Under a registry whose recoveryAt answered nothing, neither the stated
  // reset nor the learned windows apply — the round polls.
  recoverySleep(
    facts: RouteFacts,
    switches: Switches,
    site: {
      chain: SessionChain
      phase: PhaseKey | undefined
      cap: number
      // The context windows the selection reads: loaded lazily, cached by
      // the caller.
      loadLimits: () => Promise<ReadonlyMap<string, number>>
      // The failure that led here (absent when selection found nothing
      // usable before any session ran); its stated reset and its account
      // feed the cascade.
      cause: { resetAt?: number; scope?: LimitScope; account?: string } | undefined
      // The learned-window lookup of the third arm (the account's spent
      // windows, fs I/O): invoked only when the cascade reaches it, with
      // the round's `now`.
      learned: (now: number) => Promise<{ resetAt: number; scope?: LimitScope; learnedAt: number } | undefined>
    },
  ): Promise<RecoverySleepPlan>
  // The probe candidate of one wait-and-probe round (§6.3): the probe
  // dispatches through selection like any other — this method runs the
  // selection (waiting through `site.waitWindow` while only the windows
  // block), then realizes the mark-clearing by clearing the probe
  // candidate's mark before the dispatch (and its provider's key state,
  // flags and `until` marks alike, with it), so the probe runs on the
  // first in-window candidate ignoring the marks; a successful probe
  // leaves it cleared. undefined = a non-probe decision (nothing usable —
  // the caller's dispatch answers the rest). The re-mark on a failed
  // probe stays with the caller (it runs after the probe session
  // returns).
  probeSelection(
    facts: RouteFacts,
    switches: Switches,
    site: {
      chain: SessionChain
      phase: PhaseKey | undefined
      cap: number
      // The context windows the selection reads: loaded lazily, cached by
      // the caller.
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
  let pending: { order?: string[] } | undefined
  // The /failback rewind's owed re-key (plans/0178 D4): set when
  // consumeFailback rewound active rings, consumed by the walk moment that
  // re-keys the managed server.
  let failbackRekeyOwed = false
  let override: FailbackOverride | undefined

  // Model down marks: by the model's internal name (a raw override value by
  // its model string, matching how selection reads them). Marks live in
  // memory only (nothing persists); a new run starts with every model
  // eligible. The resets a failure states outlive the run, as the account's
  // learned windows, but those only time the recovery wait's sleep and
  // never become a mark. A mark may carry `until`, the instant a reset time
  // named: it lasts until that instant *instead of* the scope boundary, so
  // a boundary clear keeps it and a read past the instant treats it as
  // cleared.
  const downModels = new Map<string, DownMark>()

  // The key state of the rings: one mark per (provider, key reference),
  // always carrying an `until` — a stated reset held to its instant
  // (provider state the driver measured, plans/0144 D1's evidence half), a
  // failure that stated no reset held UNSTATED_KEY_HOLD_MS (plans/0163 D1:
  // the one-shot skip flag replaced by a short hold, so the new-session
  // walk re-checks the key at the first session after it). Key state never
  // clears at a boundary (a mark is duration state, not boundary state);
  // the failback-scope clears never touch it. It lives in memory only; a
  // new run starts with every key eligible.
  const downKeys = new Map<string, Map<string, DownMark>>()

  // The key rings (the state the keyring module held as a singleton until
  // this tranche): the built rings by provider, the current position per
  // provider and whether rotation is active. `rings` is undefined before
  // the run's agent starts, and every reader then answers "no ring":
  // selection's rule 4 never excludes, nothing rotates, the startup block
  // shows declared counts only. The position moves only when a search
  // lands — §6.4's restart-churn floor — and both searches are order-first
  // (a rotation since plans/0144 D2, the new-session walk since plans/0163
  // D2, which restarts onto the earliest key whose hold has passed), and
  // /failback rewinds every position to 0 (0144 D3).
  let rings: Map<string, ModelReference[]> | undefined
  let providers: Set<string> | undefined
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
  let synthesisUsageSink: ClassifyUsageSink | undefined

  // Marks at a scope boundary: the boundary clears every model mark the
  // scope covers — phase clears under every scope, task under task
  // (default) and finer, and "session" is the new-session start of
  // scope=session, which is also the only scope that clears there. A model
  // mark with `until` lasts until that instant instead, so it survives the
  // clear and reads as up once the instant has passed. Key state never
  // participates (plans/0144 D1, 0163 D1): a key mark is duration state
  // and survives every boundary. Calling this at a boundary the scope
  // does not cover is a no-op.
  const clearDownMarks = (boundary: Boundary | "session", scope: FailbackScope): void => {
    if (!failbackApplies(scope, boundary)) return
    dropScopeCleared(downModels)
  }
  const dropScopeCleared = (marks: Map<string, DownMark>): void => {
    for (const [key, mark] of marks) if (mark.until === undefined) marks.delete(key)
  }

  // The key-state writes and reads the ring methods share, and the ring
  // state's shared readers: methods of the returned object cannot name the
  // object itself, so everything one method calls on another goes through
  // these closures (the object exposes them verbatim).
  // The key-mark write: the caller states the duration — a stated reset to
  // its instant, an unstated failure the five-minute hold (plans/0163 D1)
  // — so every mark carries `until`.
  const markKeyDown = (provider: string, key: string, until: number): void => {
    let marks = downKeys.get(provider)
    if (marks === undefined) {
      marks = new Map()
      downKeys.set(provider, marks)
    }
    marks.set(key, { until })
  }
  // A key is excluded while its mark's instant has not passed (a search
  // skips it; rule 4 counts it out).
  const isKeyDown = (provider: string, key: string, now: number): boolean => {
    const until = downKeys.get(provider)?.get(key)?.until
    return until !== undefined && until > now
  }
  // Clears one provider's key marks: the recovery probe's ring half
  // (§6.3) and /failback.
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
  // The ring's key search (§7 step 1; order-first since plans/0144 D2, the
  // hold marks of plans/0163 D1): it starts at declared index 0 and
  // considers every key except the current one, landing on the first whose
  // mark has passed — the earliest key the run holds no evidence against,
  // so a recovered earlier key is re-preferred the moment a rotation fires
  // at all (a rotation is a restart whichever key it lands on, so landing
  // earlier costs nothing). undefined = no ring, inactive rings, or the
  // rings never activated; a real ring always answers, with `to` undefined
  // when it refuses to land (every other key held; a single-key ring
  // always refuses). Mutates nothing. Hoisted for the keyRotation fence;
  // the object exposes it verbatim.
  const ringRotation = (provider: string, now: number): RingRotation | undefined => {
    const keys = rings?.get(provider)
    if (!ringsActive() || keys === undefined) return undefined
    const from = (positions.get(provider) ?? 0) % keys.length
    for (let index = 0; index < keys.length; index++) {
      if (index === from) continue
      if (!isKeyDown(provider, keys[index]!.ref, now)) {
        return {
          provider,
          from: { ref: keys[from]!, index: from, total: keys.length },
          to: { ref: keys[index]!, index, total: keys.length },
        }
      }
    }
    return { provider, from: { ref: keys[from]!, index: from, total: keys.length } }
  }
  // The new-session walk (plans/0163 D2, its bound restored by plans/0178
  // D1, 0165-057/S17-01): the order-first search over the keys BEFORE the
  // current position, landing on the first that carries a mark whose
  // instant has passed — nothing failed, so nothing is rotated away from;
  // the walk only ever re-preferences a recovered earlier key (the
  // maintainer's "every new session tries the keys in order"), never walks
  // forward off a healthy current key onto a later key whose hold passed
  // (the exhausted-ring shape the unbounded scan produced: a restart-and-
  // fail cycle per hold for the length of the later key's window). A key
  // with no mark never triggers one: the ring landed on it or started at
  // it, and the probe's clear (§6.3) leaves exactly that shape — the
  // probe's session must test the current key, not walk. undefined = no
  // recovered earlier key (the common case — no restart), no ring, or
  // inactive rings (a held-everything ring answers undefined too: the
  // session proceeds on the current key and the escalation ladder owns
  // that case). Mutates nothing. The object exposes it verbatim; the
  // session start (src/attempt.ts) decides, then commits and restarts.
  const ringWalk = (provider: string, now: number): RingWalk | undefined => {
    const keys = rings?.get(provider)
    if (!ringsActive() || keys === undefined) return undefined
    const from = (positions.get(provider) ?? 0) % keys.length
    const marks = downKeys.get(provider)
    for (let index = 0; index < from; index++) {
      const mark = marks?.get(keys[index]!.ref)
      if (mark?.until === undefined || mark.until > now) continue
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
  // down marks, the ring and the cap, so the provider's key state — skip
  // flags and `until` marks alike — clears for the probe while the
  // position stays where it is. Hoisted for the probeSelection fence; the
  // object exposes it verbatim.
  const clearRingMarks = (provider: string): void => {
    if (rings?.has(provider) !== true) return
    clearKeyDownMarks(provider)
  }

  return {
    // The run-time model-order override left after a parameterized
    // /failback is consumed; the dispatch resolvers read it ahead of the
    // registry's lists (without breaking the switches-memo constancy
    // convention).
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
    // down marks), and with arguments it also redefines the run-time model
    // order. Plans/0144 D3: the operator's command is the person's reset
    // signal — the key rings rewind with it (all key state cleared, an
    // `until` included, and every position back to the first key), so the
    // next dispatch runs on key 1 in declared order. Returns whether it
    // consumed. The chain's selected entry is
    // cleared with the raw candidate at the boundary that holds the chain
    // (the next prompt re-selects from the list) — the subtask boundary
    // calls resetRoute beside this consumption; the task and phase
    // boundaries destroy the chain with runTask before reaching here, so
    // they clear nothing.
    // AUTO-RESOLVE: does a mark with `until` survive `/failback`, as it survives a scope boundary? -> no, `/failback` clears every mark, an `until` included (the scope rules list the scope boundaries and `/failback` separately, and `until` stands in for the scope boundary; the operator's explicit command retries the primary now, so a quota reset time must not override it)
    consumeFailback: () => {
      if (pending === undefined) return false
      downModels.clear()
      downKeys.clear()
      positions = new Map()
      const order = pending.order
      pending = undefined
      const rewound = ringsActive() && rings !== undefined && rings.size > 0
      if (rewound) failbackRekeyOwed = true
      const rewind = rewound ? "; key rings rewound to their first key" : ""
      if (order !== undefined) {
        override = { wildcard: order[0]!, fallback: order.slice(1) }
        log(`⇄ /failback applied: primary model redefined as ${override.wildcard}, fallback order ${override.fallback.join(", ") || "(none)"}; fallback state reset${rewind}`)
      } else {
        log(`⇄ /failback applied: fallback state reset, next prompt returns to the primary model${rewind}`)
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

    // Key state, per provider and key reference (the ring position itself
    // moves only when a search lands; which keys are excluded lives here).
    // markKeyDown writes a mark that always carries `until`: a stated
    // reset held to its instant, an unstated failure held the five-minute
    // hold (plans/0163 D1 — the caller computes the instant).
    markKeyDown,
    // The key-state counterpart of extendModelDownMark (the hoisted
    // closure, exposed verbatim; the lateReset fence calls it): an
    // existing mark lasts until the new instant — the same failure's reset
    // stated late. No state at all reads false, as before (no
    // resurrection).
    extendKeyDownMark,
    // The key-mark reader; isKeyDown reads the instant.
    keyDownMark: (provider, key) => downKeys.get(provider)?.get(key),
    isKeyDown,
    // Clears one provider's key state, both kinds: the recovery probe's
    // ring half (the probe candidate ignores the down marks and the ring).
    // The ring position lives beside the state and never moves.
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
      providers = registryProviders(registry)
      positions = new Map()
      active = !external
    },
    ringsActive,
    // §6.2 rule 4: does this provider's key ring have a key that is not
    // held (its mark's instant not yet passed)? An exhausted ring — every
    // key held — keeps the provider's entries out of
    // selection. True for every provider when the rings never activated or
    // are inactive (an external server cannot rotate, so the ring never
    // excludes a candidate), and for providers without a ring.
    ringHasUsableKey: (provider, now) => {
      const keys = rings?.get(provider)
      if (!ringsActive() || keys === undefined) return true
      return keys.some((key) => !isKeyDown(provider, key.ref, now))
    },
    hasActiveRing,
    currentKey,
    ringRotation,
    ringWalk,
    // The new-session walk's commit (plans/0163 D2): the position moves to
    // the landed key and nothing else — the from key did not fail, so no
    // mark is written; the caller writes the spawn config and restarts the
    // managed server before the session's first call.
    commitWalk: (walk) => {
      positions.set(walk.provider, walk.to.index)
    },
    rekeyOwed: () => failbackRekeyOwed,
    consumeRekeyOwed: () => {
      failbackRekeyOwed = false
    },
    // Applies a decided search (§7 step 1): the from key's failure is
    // written — the caller's `until`, a stated reset held to its instant,
    // an unstated failure held the five-minute hold (plans/0163 D1) — and
    // the position moves only when the search landed (a refusal applies
    // the mark alone). The position stays where it landed afterwards —
    // only a landing search moves it (§6.4's floor) — and both later
    // searches start at declared order.
    commitRotation: (rotation, until) => {
      markKeyDown(rotation.provider, rotation.from.ref.ref, until)
      if (rotation.to !== undefined) positions.set(rotation.provider, rotation.to.index)
    },
    // The spawn config content for the managed server's next spawn (§4.3
    // injection): every registry provider's entry — the active ring's current
    // key as the provider's apiKey reference where one exists, and the
    // streaming-timeout floor for every provider the registry names (ringed
    // or not; plans/0127 — the server-side defaults measured at 300s abort
    // the driver's long single-shot generations, and the adapter strips a
    // key the target's opencode.json declares, so an explicit person value
    // still wins). undefined = send no config at all (no registry provider,
    // or an external server), so the spawn environment keeps
    // OPENCODE_CONFIG_CONTENT = "{}" exactly as the SDK spawn sends it.
    // Only references appear here; opencode substitutes them in its own
    // process.
    spawnKeyConfig: () => {
      if (!ringsActive() || providers === undefined || providers.size === 0) return undefined
      const provider: Record<string, unknown> = {}
      for (const id of providers) {
        const key = currentKey(id)
        provider[id] = {
          options: {
            ...(key !== undefined ? { apiKey: key.ref } : {}),
            headerTimeout: STREAM_TIMEOUT_FLOOR_MS,
            chunkTimeout: STREAM_TIMEOUT_FLOOR_MS,
          },
        }
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
    // commitRotation (a stated reset to its instant, an unstated failure the
    // five-minute hold).
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
    // The formulation one-shots' sink, same lifecycle.
    setSynthesisUsageSink: (sink) => {
      synthesisUsageSink = sink
    },
    synthesisUsageSink: () => synthesisUsageSink,

    // —— The routing decisions ——
    // The dispatch target (see the type comment): a fresh selection over
    // the facts, whose live state — the marks, the override, the rings —
    // reads through the facts' router.
    target: (facts, chain, switches, cap, phase) => {
      const decision = select(routeContext(facts, switches, cap), {
        role: chain.role ?? phaseToRole(chain.phase) ?? "bypass",
        entry: phase?.entry,
        now: facts.clock.now(),
        continuation: false,
      })
      return decision.kind === "pick" ? candidateKey(decision.candidate) : undefined
    },
    // The dispatch's model pair (see the type comment): the pick the
    // executor hands in — the plan's own selection, not a fresh one.
    dispatchModel: (picked) => ({ target: picked?.model, promptModel: picked?.entry }),

    // —— The session loop's failover neighbourhood ——
    // The failover decision (see the type comment): the model being left is
    // marked down on this instance and the selection runs over the facts
    // (routeContext reads the facts' router — the run's router, this same
    // instance); the wait-and-reselect loop is escalation step 3.
    failover: async (facts, switches, site) => {
      const { chain, phase, cap, limits, label, why, until, classified, waitWindow } = site
      // The model being left: the chain's selected entry, with the display
      // memory standing in when the session-scope failback clear already
      // wiped the route fields of the session that just failed (the clear
      // runs at the create, before the failure — without the fallback the
      // model would never be marked and the "switch" could re-pick it).
      const from = chain.modelEntry ?? chain.modelShown
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
      const to = candidateKey(decision.candidate)
      // The model just marked down cannot be the pick; a same-name result
      // would mean an override re-listed it — refuse rather than loop.
      if (to === from) return undefined
      const toModel = decision.candidate.kind === "entry" ? decision.candidate.entry.model : decision.candidate.model
      const pickAgent = decision.candidate.kind === "entry" ? decision.candidate.entry.agent : facts.defaultAgent
      // The route the failover picked, the value the caller writes
      // wholesale: the selection state — the internal name and the base
      // step — travels with the chain; the down marks replace the
      // phase-scoped sticky holder of the retired env-switch path (§6.4),
      // so scope=phase keeps the move through the task boundaries without
      // one.
      const route: ChainRoute = { model: toModel, entry: to, step: 0 }
      // The ⇄ line and the cross-agent verdict share the one condition:
      // the pick runs on another agent than the chain's session (a session
      // never crosses agents).
      const move = pickAgent !== undefined && chain.agent !== undefined && pickAgent !== chain.agent
      log(
        `⇄ ${label} ${why}; ${move ? `moving to agent ${pickAgent}, starting a new session there (a session never crosses agents), switching model` : "keeping chain context, switching model"} ${from ?? "primary model"} → ${to} (registry list; ${from ?? "the primary"} marked down)`,
      )
      return { from, to, route, moveAgent: move ? pickAgent : undefined }
    },
    // The step-1 plan (see the type comment): the ring state this reads is
    // this instance's own — the same instance the escalation's commits and
    // marks go through. An active ring always answers a search (a
    // single-key ring by refusing to land), so the rotation is present
    // whenever the provider gates pass.
    keyRotation: (facts, chain) => {
      const provider = facts.registry.models.get(chain.modelEntry ?? "")?.provider
      if (provider === undefined || !hasActiveRing(provider)) return undefined
      return { provider, rotation: ringRotation(provider, facts.clock.now())! }
    },
    // The exhaustion line (see the type comment): reads this instance's
    // marks as they stand at the call — after the escalation wrote its
    // own.
    exhaustionWhy: (facts, label) =>
      `${label} and every candidate of the tier list is down (down: ${[...downModels.keys()].join(", ") || "none"})`,

    // —— The session loop's recovery-wait neighbourhood ——
    // The escalation's down-mark read (see the type comment): the rings are
    // this instance's own state, the provider lookup the facts' registry.
    downTarget: (facts, chain) => {
      const model = chain.modelEntry
      const provider = facts.registry.models.get(model ?? "")?.provider
      const key = provider !== undefined && hasActiveRing(provider) ? currentKey(provider) : undefined
      return { model, provider, ...(key !== undefined ? { key: { ref: key.ref, label: key.label } } : {}) }
    },
    // The late classifier answer's mark extension (see the type comment):
    // the ⏲ line renders the reset in the registry's time zone.
    lateReset: (facts, pending, target, label) => {
      if (pending === undefined) return
      void pending.then((until) => {
        if (until === undefined) return
        const marked: string[] = []
        if (target.model !== undefined && extendModelDownMark(target.model, until)) marked.push(target.model)
        if (target.provider !== undefined && target.key !== undefined && extendKeyDownMark(target.provider, target.key.ref, until))
          marked.push(`provider ${target.provider} key ${target.key.label}`)
        if (marked.length)
          log(`⏲ ${label} the classifier's answer arrived after the turn ended: ${marked.join(" and ")} stay${marked.length > 1 ? "" : "s"} down until ${isoInZone(until, facts.registry.tz)}`)
      })
    },
    // The wait-and-probe round's sleep source (see the type comment). The
    // cascade's compound conditions are the load-bearing part: under a
    // layer-backed registry a recoveryAt that answered nothing (`back`
    // undefined) leaves the round polling — neither the stated reset nor the
    // learned windows apply — while an answer that sits in the past
    // (`back.at <= now`) falls through to them. The implicit registry keeps
    // the env path's cascade (a stated reset, else the learned windows):
    // its single agent has no other candidate to wait for, so the account's
    // recorded windows are the only schedule it has.
    recoverySleep: async (facts, switches, site) => {
      const { chain, phase, cap, cause, loadLimits, learned } = site
      const now = facts.clock.now()
      let at: number | undefined
      let reason: string | undefined
      let model: string | undefined
      const back = recoveryAt(routeContext(facts, switches, cap, await loadLimits()), { role: roleOf(chain), entry: phase?.entry, now, continuation: false })
      const statedApplies = back !== undefined || facts.registry.implicit === true
      if (back !== undefined && back.at > now) {
        at = back.at
        model = candidateKey(back.candidate)
        reason = `${model} is usable again at ${isoInZone(at, facts.registry.tz)}`
      } else if (statedApplies && cause?.resetAt !== undefined) {
        at = cause.resetAt
        reason = `${limitPhrase(cause.scope)} resets ${new Date(at).toISOString()}`
      } else if (statedApplies) {
        const record = await learned(now)
        if (record !== undefined) {
          at = record.resetAt
          reason = `${limitPhrase(record.scope)} resets ${new Date(at).toISOString()} (recorded ${new Date(record.learnedAt).toISOString()})`
        }
      }
      model ??= chain.modelEntry ?? chain.modelShown ?? "(agent default)"
      return { now, at, reason, model }
    },
    // The probe candidate of one round (see the type comment): the mark
    // clears write this instance's own state; the wait loop hands the site's
    // sleeper the payload the fence builds.
    probeSelection: async (facts, switches, site) => {
      const { chain, phase, cap, loadLimits, waitWindow } = site
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

// —— The routing verdicts (the stateless half of the routing decisions) ——
// Every registry/no-registry branch of the routing decisions used to live
// in this module behind one seam (the consolidation's fence); with the
// implicit registry every run has a registry, so the seam is gone and what
// remains is the registry decision alone. The free functions are the
// stateless verdicts (no holder reads); `target`, `dispatchModel` and the
// failover, key-rotation, exhaustion and recovery decisions above are the
// holder-reading ones as methods (the instance supplies the holders and
// marks those decisions read and write), and the record-side remainder —
// the fork base's agent and role verdicts — as the free functions below.

// The structural slice of the run's routing facts the decisions read. The
// run's RoutingFacts (src/routing.ts) satisfies it field for field; this
// module cannot name that type: routing carries the Router type, so an
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

// The selection context the routing decisions build from the facts — the
// router-side wrapper of select.ts's selectContextOf (routing.ts's
// selectContext is the other wrapper; the build itself lives below both, in
// select.ts), optional `limits` included: a call that holds live context
// windows passes them (the failover's clipping and selection read them), the
// others select without. The down marks, the /failback override and the key
// rings are the live run state behind the facts' router, read exactly as
// selectContext reads them.
// AUTO-DECISION: the decisions' selections carry no context windows except where the site holds them (the live limits belong to the agent a resume check never sees); an unknown window never excluded a candidate on the retired env-switch path either, so the comparison keeps its shape
function routeContext(facts: RouteFacts, switches: Switches, cap: number, limits?: ReadonlyMap<string, number>): SelectContext {
  return selectContextOf(facts, switches, cap, limits)
}

// The wait payload of a wait decision (the model that opens first, its
// formatted opening and the dispatch list's tier) — the one home of the
// payload build since the recovery-wait decisions moved in: the failover's
// wait-and-reselect and the probe loop both build it here (the dispatch
// side builds its own from the list it already holds,
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
// The recorded agent (absent = the run's start profile, the shape every
// pre-binding record reads as) must name a profile the registry knows — or
// be the run's start agent itself, which may run profile-less when the
// registry holds no profile of the chosen adapter — and its adapter must
// pass the agent filter: session ids are agent-local, and a filtered-out
// agent's model is never a candidate, so its sessions are never resumed
// nor forked (plans/0055 §8.3). Moved from src/unit-commit.ts when the
// branch moved here.
export function recordedAgentOk(facts: RouteFacts, recorded: string | undefined): boolean {
  const agent = recorded ?? facts.runAgent
  const adapter =
    facts.registry.agents.get(agent)?.adapter ??
    (agent === facts.runAgent ? (facts.agentFilter ?? facts.defaultAgent) : undefined)
  return adapter !== undefined && (facts.agentFilter === undefined || adapter === facts.agentFilter)
}

// The §10 item 11 eligibility of a strict resume: the recorded internal
// name is judged by eligibility, not equality. Selection is asked exactly
// as the dispatch a resumed session takes — a continuation over the
// recorded model (§6.2 keeps the chain's model while it is usable) — and
// the recorded model must be what it keeps. So a window change that only
// moves the fresh pick (an earlier candidate's window reopening), a
// reordered list or a returned primary does not roll a unit back; a model
// that is marked down, outside its windows, excluded by the agent filter
// or gone from the registry is not eligible. Moved from src/unit-commit.ts
// when the branch moved here.
export function resumeModelEligible(
  facts: RouteFacts,
  switches: Switches,
  cap: number,
  phaseKey: PhaseKey | undefined,
  recorded: string,
  phase?: Phase,
  role?: ModelRole,
): boolean {
  const decision = select(routeContext(facts, switches, cap), {
    role: role ?? phaseToRole(phase) ?? "bypass",
    entry: phaseKey?.entry,
    now: facts.clock.now(),
    continuation: true,
    current: recorded,
  })
  return decision.kind === "pick" && candidateKey(decision.candidate) === recorded
}

// The §8.3 dead-session verdict of a resume record: a recorded session is
// resumed only if its agent is one this run can dispatch on and its
// recorded model is usable now; otherwise the session is dead and the
// resume takes the existing path of a new session with the resume note
// (under strict resume, the rollback path). Returns the reason for the
// log line; undefined = no verdict (a record that names nothing to check —
// a non-strict record carries no model, and eligibility then has nothing
// to judge). Moved from src/unit-commit.ts when the branch moved here.
export function deadSessionWhy(
  facts: RouteFacts,
  switches: Switches,
  cap: number,
  phaseKey: PhaseKey | undefined,
  record: { agent?: string; model?: string; phase?: Phase },
  role?: ModelRole,
): string | undefined {
  if (!recordedAgentOk(facts, record.agent)) {
    return `the recorded session lives on agent ${record.agent ?? facts.runAgent}, which this run does not dispatch on${facts.agentFilter ? ` (agent filter ${facts.agentFilter})` : " (no such agent profile)"}`
  }
  if (record.model !== undefined && !resumeModelEligible(facts, switches, cap, phaseKey, record.model, record.phase, role)) {
    return `the recorded session's model ${record.model} is not usable now`
  }
  return undefined
}

// The hibernate jitter of a scheduled sleep (0–600 s on top of the
// instant, so drivers sharing an account do not all wake the same
// second): the facts' injected random, absent = Math.random.
export function jitterOf(facts: RouteFacts): number {
  return (facts.random ?? Math.random)() * HIBERNATE_JITTER_MS
}

// The wake computation of the window wait (§6.3): the interval to sleep
// (the distance to the opening, clamped at zero, plus the jitter) and the
// instant the wait line announces. The facts' clock is the timeline. The
// ⏸/→ lines and the booked sleep stay with the caller (session I/O on the
// services clock).
export function windowWake(facts: RouteFacts, wait: WindowWait): { sleep: number; wakeAt: Date } {
  const now = facts.clock.now()
  const sleep = Math.max(0, wait.until - now) + jitterOf(facts)
  return { sleep, wakeAt: new Date(now + sleep) }
}

// The chain of one recovery probe: a fresh one-off view that carries the
// role only — no phase, no progress record, the real chain's recovery
// point untouched (the probe's own dispatch selects the probed model).
export function probeChain(chain: SessionChain): SessionChain {
  return { pct: 100, used: 0, at: 0, role: roleOf(chain) }
}

// The agent whose fork-base record a forking chain reads and writes
// (plans/0055 §8.4): the base the pipeline forks from must live on the
// agent the forking subtask's chain runs on, so the persisted record is
// per agent — the chain's agent (the decompose dispatch's before the
// first subtask, the moved-to agent after a cross-agent failover: a
// subtask that moved to another agent forks from that agent's base,
// building it on first use), with the facts' runAgent standing in while
// the chain holds no session.
export function forkAgent(facts: RouteFacts, chain: SessionChain): string {
  return chain.agent ?? facts.runAgent
}

// The agent the fork-base record names as truly holding the built base
// session (plans/0055 §8.2): the rebuild chain's landed agent (the
// dispatch inside picked it — the subtask route's first usable
// candidate's profile, which is where the forking subtask dispatches too,
// so the prefix caches under the model that forks from it), with the
// reading agent (forkAgent's answer) standing in when the dispatch left
// no agent on the chain.
export function landedAgent(base: SessionChain, agent: string): string {
  return base.agent ?? agent
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

// One decided model failover (the answer of `failover`): the model being
// left (`from`, undefined = the primary — the log renders "primary model"),
// the candidate picked (`to`: a registry entry's internal name, or the
// ring's model string without one), the route value the caller writes
// through setRoute (the selection state travels with the chain: model id +
// internal entry + a reset step), and the cross-agent move's target agent
// (undefined = keep the chain's context, a fork of the failed session).
type FailoverDecision = {
  from: string | undefined
  to: string
  route: ChainRoute
  moveAgent: string | undefined
}

// The escalation's step-1 key-rotation plan (the answer of `keyRotation`):
// the provider whose ring moves, and the decided key search — which lands
// (`to`) on the first eligible key of declared order, or refuses (`to`
// undefined: every other key held, a single-key ring) while still naming
// the current key; the caller applies either shape through commitRotation,
// the refusal unconditionally and the landing after its host precondition.
type KeyRotationPlan = { provider: string; rotation: RingRotation }

// The down marks one failure's escalation may write (the answer of
// `downTarget`, fed to `lateReset`): the chain's selected entry, and the
// key it ran on when its provider has an active ring — the `{ model }`
// subset is what the probe loop's late classifier answer extends.
type DownTarget = { model?: string; provider?: string; key?: { ref: string; label: string } }

// The sleep source of one wait-and-probe round (the answer of
// `recoverySleep`): the round's `now` (the timeline the horizon clamp and
// the wake math share), the instant slept to (undefined = poll for
// recoveryWait), the reason the ⏳ line renders and the model the wait is
// for (the quota-window figure's key).
type RecoverySleepPlan = { now: number; at: number | undefined; reason: string | undefined; model: string }

// The probe candidate of one wait-and-probe round (the answer of
// `probeSelection`): the candidate's key (its model mark was cleared for
// the probe and is re-marked on failure), and the provider whose ring
// marks cleared with it (its current key is re-marked on failure;
// undefined for a raw candidate or a ringless entry).
type ProbeTarget = { model: string; provider: string | undefined }
