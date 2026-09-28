// The router service (the consolidation's services stage): the run-wide
// decision state of routing and recovery that used to live in module
// singletons — the failback holders (the phase-scoped sticky model, the
// pending /failback order and the run-time model-order override), the down
// marks of the model registry (per model, and per provider key for the
// rings), the key rings themselves (the built rings, the per-provider
// position, whether rotation is active), the usage windows last logged per
// agent client, and the model-step cache-claim checks. One instance per
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
// nothing above it either. The remaining tranche that reads the registry
// and the switches at construction (the routing fence over the registry and
// no-registry halves) arrives with its own change and takes its inputs at
// its slot, which sits after the freeze in the written order.
// AUTO-DECISION: createRouter() is parameterless instead of receiving the registry and the frozen switch snapshot (no state it builds consults either — the key rings read the registry at their activation, not at construction — and the boundary clears keep taking the failback scope as a call argument because the switch memo is per-parse process state that a test or the pre-freeze composition must be able to change independently of the holder, and capturing the memo at construction time would freeze a stale snapshot for every holder the preload builds before a test parses its switches).
import type { AgentClient, AgentEvent, AgentTokens } from "./agent/types"
import type { Boundary } from "./control-types"
import { failbackApplies } from "./failback"
import { buildRings, ringKeyLabel, type RingRotation } from "./keyring"
import { log } from "./log"
import type { ModelEntry, ModelRegistry, ModelReference } from "./models"
import type { FailbackScope } from "./switches"

// The run-time model-order override a parameterized /failback leaves behind:
// the first argument is the preferred wildcard, the rest the failover
// candidate ring.
export type FailbackOverride = { wildcard: string; fallback: string[] }

// A down mark; `until` (epoch ms) is the instant a reset time named, absent
// = the mark clears at the scope boundaries. `classifier` = the class that
// wrote the mark came from the failure-message classifier, so the ◈ line
// names the move `quota (classifier)`.
export type DownMark = { until?: number; classifier?: true }

// The verdict of one cache-claim observation; undefined = no claim was
// pending, or the tokens were inconclusive (a small cacheWrite with a small
// cacheRead says nothing either way).
export type CacheClaim = "confirmed" | "contradiction"

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
    markModelDown: (model, until, classifier) => {
      downModels.set(model, { ...(until !== undefined ? { until } : {}), ...(classifier === true ? { classifier: true as const } : {}) })
    },
    // A reset time that became known after the mark was written (the
    // classifier's answer arriving after the turn ended): the mark now
    // lasts until that instant instead of the scope boundary. Only an
    // existing mark is changed — a mark a boundary or /failback already
    // cleared is not written again.
    extendModelDownMark: (model, until) => {
      const mark = downModels.get(model)
      if (mark === undefined) return false
      downModels.set(model, { ...mark, until })
      return true
    },
    // Removes one model's mark (the recovery probe's "a successful probe
    // clears that candidate's mark"; a failed probe re-marks it through the
    // caller). Key marks are not touched.
    clearModelDownMark: (model) => {
      downModels.delete(model)
    },
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
    // Whether the run's rings are active for this provider (the escalation's
    // step-1 gate, §7): a key failure on a ringed provider marks the key down
    // even when the ring cannot rotate — every key is down, or it holds one key
    // — so §6.2 rule 4 then keeps the provider's entries out of selection.
    hasActiveRing: (provider) => rings !== undefined && active && rings.get(provider) !== undefined,
    currentKey,
    // Would a rotation land on a key? The current key will be marked down
    // (step 1 of §7), so the search starts after it and wraps, skipping every
    // key that is down; undefined = no ring, inactive rings, or the ring is
    // exhausted (every key down). Mutates nothing.
    ringRotation: (provider, now) => {
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
    },
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
    clearRingMarks: (provider) => {
      if (rings?.has(provider) !== true) return
      clearKeyDownMarks(provider)
    },
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
  }
}
