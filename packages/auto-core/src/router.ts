// The router service (the consolidation's services stage, first tranche):
// the run-wide decision state of routing and recovery that used to live in
// module singletons — the failback holders (the phase-scoped sticky model,
// the pending /failback order and the run-time model-order override), the
// down marks of the model registry (per model, and per provider key for the
// rings), the usage windows last logged per agent client, and the model-step
// cache-claim checks. One instance per run: `createServices` builds it into
// the run's holder, the composition root installs the holder for the run,
// and the test preload installs a fresh one before every test (so the state
// never leaks across test files — the `reset*` hooks the module singletons
// needed are gone with them).
//
// Who may reach it: the entry modules the services allowlist names call
// `services().router` directly (watch, attempt, session, the /failback
// handler of interactive, the composition and the agent pool). Everything
// below them receives the router as data, never through the ambient
// accessor: the routing facts carry it beside their clock (every
// registry-driven selection and resume check reads it through
// `RoutingFacts.router`), the session options carry it beside their routing
// (`Opts.router`, for the no-registry resume checks and the pipeline's
// failback boundary hooks), and the policies helpers (keyring, classify)
// take it as a leading parameter. The pure decisions keep reading state as
// data, exactly as they read the clock.
//
// Construction: in the run's written order the router joins the composition
// after the switch snapshot freezes, reading the registry and the frozen
// switches. This first tranche consults neither — the failback holders, the
// marks, the logged windows and the step claims are registry-agnostic run
// state (a run without a registry writes no marks and never logs a step
// claim, byte-identical to before) — so `createRouter()` takes no inputs and
// the holder may build it beside the clock, which depends on nothing above
// it either. The tranches that do read the registry and the switches (the
// key rings, the routing fence over the registry and no-registry halves)
// arrive with their own changes and take their inputs at their slots, which
// sit after the freeze in the written order.
// AUTO-DECISION: createRouter() is parameterless instead of receiving the registry and the frozen switch snapshot (none of this tranche's state consults either — the boundary clears keep taking the failback scope as a call argument because the switch memo is per-parse process state that a test or the pre-freeze composition must be able to change independently of the holder, and capturing the memo at construction time would freeze a stale snapshot for every holder the preload builds before a test parses its switches).
import type { AgentClient, AgentEvent, AgentTokens } from "./agent/types"
import type { Boundary } from "./control-types"
import { failbackApplies } from "./failback"
import { log } from "./log"
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
    // never moves back; only whether a key is down lives here).
    markKeyDown: (provider, key, until) => {
      let marks = downKeys.get(provider)
      if (marks === undefined) {
        marks = new Map()
        downKeys.set(provider, marks)
      }
      marks.set(key, until !== undefined ? { until } : {})
    },
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
    isKeyDown: (provider, key, now) => {
      const mark = downKeys.get(provider)?.get(key)
      return mark !== undefined && (mark.until === undefined || mark.until > now)
    },
    // Clears one provider's key marks: the recovery probe's ring half (the
    // probe candidate ignores the down marks and the ring). The ring
    // position itself lives in the keyring module and never moves here.
    clearKeyDownMarks: (provider) => {
      downKeys.get(provider)?.clear()
    },
    clearDownMarks,

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
