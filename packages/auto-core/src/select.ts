// Selection (plans/0055 §6): the pure core of registry-driven model routing.
// For one dispatch — a session's routing role under the current phase type,
// at an instant — it answers three questions:
//   1. the candidate list (§6.1): the route in force, the session's tier, the
//      ordered candidates, and the OPENCODE_AUTO_MODEL / `/failback` overrides
//      that replace the list (§9);
//   2. the pick (§6.2): the first candidate usable now, or — for a
//      continuation of the same prompt — the chain's model while it is still
//      usable;
//   3. the decision when nothing is usable (§6.3): wait for the earliest
//      window opening, probe with the first in-window candidate, or the
//      empty-tier error.
//
// Every dispatch resolver under a registry calls this module (§12: attempt's
// target, the session failover, unit-commit's resume, the `/failback`
// override); `resolveModel` (src/chain.ts) stays the no-registry path, so a
// run without a registry is untouched. Everything here is pure over the
// loaded registry, the run state and an injected clock: the down marks, the
// key-ring predicate and the context windows are inputs, never module state,
// and no window or clock is read behind the caller's back.
//
// A candidate is a registry entry by internal name, or — when an override
// names no entry — a raw `provider/model` string that runs on the default
// agent with no window, ring or steps (§9). Tier and route lists name
// existing entries only (the loader validates that), so a raw candidate can
// only come from an override value.
import { resolveModel } from "./chain"
import { candidateList } from "./model-route"
import { nextOpening, usableAt } from "./model-window"
import type { ModelEntry, ModelRegistry, ModelRoute } from "./models"
import type { PhaseTypeEntry, Tier } from "./phases/registry"
import type { ModelPolicy, ModelRole } from "./switches"

// A down mark; `until` (epoch ms) is the instant a reset time named, absent
// = the mark clears at the failback-scope boundaries. `classifier` = the
// class that wrote the mark came from the failure-message classifier, so the
// ◈ line names the move `quota (classifier)`. The mark *state* lives in the
// router service (one map per run); the shape lives here, beside the
// SelectContext field that reads it, because the router imports this module
// (the routing fence calls selection) and a type edge back would close a
// cycle the import-direction DAG check rejects.
// AUTO-DECISION: DownMark's definition moved from src/router.ts to here (the fence in router.ts needs `select` at run time, so select.ts may no longer type-import the router — the shape sits beside its primary contract, SelectContext.marks, and the router holds the state under this imported type)
export type DownMark = { until?: number; classifier?: true }

// The run-level state of selection: everything a run fixes once and every
// dispatch shares. Built where the run starts (registry, filter, cap,
// switches) and where the live server reports its windows.
export type SelectContext = {
  registry: ModelRegistry
  // The project cap in tokens — the unit contextLimits() reports, i.e.
  // opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT, not the config's k value.
  cap: number
  // §6.2 rule 1, the agent filter: the shell profile's agent or
  // OPENCODE_AUTO_AGENT, an adapter name; undefined = no filter, models on
  // every agent profile are candidates.
  agentFilter?: string
  // The default agent (the project's configured agent, §9 R6): the agent a
  // raw override value runs on.
  defaultAgent: string
  // The OPENCODE_AUTO_MODEL policy of the run (switches.model).
  policy: ModelPolicy
  // The `/failback` runtime model-order override (the router service's
  // failbackOverride()).
  override?: { wildcard: string; fallback: string[] }
  // The run's down marks by internal name (the router service's downMarks()).
  marks?: ReadonlyMap<string, DownMark>
  // §6.2 rule 4: does this provider's key ring have a key that is not down,
  // at the dispatch's instant? The router service supplies the run's answer
  // (true for every provider without an active ring); absent = every ring
  // has one.
  ringUsable?: (provider: string, now: number) => boolean
  // Known context windows by model id, in tokens (contextLimits() data).
  limits?: ReadonlyMap<string, number>
}

// One dispatch: the routing inputs, the instant, and the chain's model when
// the dispatch continues the same prompt.
export type SelectCall = {
  role: ModelRole
  // The current phase type (`opts.phase?.entry`); undefined in m mode.
  entry?: PhaseTypeEntry
  // The instant of the dispatch, epoch ms.
  now: number
  // The chain's current model for a continuation: an internal name, one of
  // the entry's step model ids, or a raw provider/model string.
  current?: string
  // §6.2: a continuation of the same prompt — a retry, a fork after a
  // failure, the wait loop's re-dispatch, a strict resume — keeps the
  // chain's model while it is still usable; a new prompt takes the first
  // usable candidate in list order.
  continuation?: boolean
}

// One candidate of a dispatch's list.
export type Candidate =
  | { kind: "entry"; name: string; entry: ModelEntry }
  | { kind: "raw"; model: string }

// The candidate list of a dispatch after the overrides (§6.1), as
// selection walks it and as the run-start block logs it.
export type SelectList = {
  tier: Tier
  // The route in force; undefined = the program default tier.
  route?: ModelRoute
  // Which override replaced the tier's or route's list (§9).
  override?: "env" | "failback"
  candidates: Candidate[]
}

// The decision of one dispatch (§6.2, §6.3): dispatch on the picked
// candidate, wait for a window to open, probe for recovery, or refuse an
// empty tier.
export type Selection =
  | { kind: "pick"; candidate: Candidate; via: "list" | "continuation" }
  // Wait until `until` (epoch ms) — the earliest opening among the
  // candidates that are not down — for the window of `candidate`.
  | { kind: "wait"; until: number; candidate: Candidate }
  // Every candidate is down: the wait-and-probe loop probes `candidate`.
  | { kind: "probe"; candidate: Candidate }
  // No candidate is left after the agent filter: a preflight-style refusal
  // (exit 1 where a run start checks it), never a silent wait.
  | { kind: "empty" } & EmptyTier

// What an empty candidate list should say (§6.3): the tier or route that had
// no candidate, which override replaced the list if one did, and the agent
// filter that emptied it.
export type EmptyTier = {
  tier: Tier
  // The key of the route in force, when one is.
  route?: string
  override?: "env" | "failback"
  // The agent filter that left no candidate, when one is in force.
  filter?: string
}

// The candidate list of a dispatch (§6.1): route, tier and list from
// src/model-route.ts (lines 1–3), then the overrides of §9 — an
// OPENCODE_AUTO_MODEL match for (role, phase type) replaces the list, and so
// does the `/failback` order; the env switch wins between the two, as it
// does on the no-registry path.
// AUTO-DECISION: a `/failback` order value resolves through the same internal-name-or-raw rule as an OPENCODE_AUTO_MODEL value, although the design names internal names for it (one rule for every override value keeps this module total; the interactive input check owns refusing unknown names)
export function candidatesOf(ctx: SelectContext, call: SelectCall): SelectList {
  const list = candidateList(ctx.registry, call.entry, call.role)
  const env = resolveModel(ctx.policy, call.entry, call.role)
  const overridden =
    env !== undefined ? ("env" as const) : ctx.override !== undefined ? ("failback" as const) : undefined
  const names =
    env !== undefined
      ? [env]
      : ctx.override !== undefined
        ? [ctx.override.wildcard, ...ctx.override.fallback]
        : list.names
  return {
    tier: list.tier,
    ...(list.route ? { route: list.route } : {}),
    ...(overridden ? { override: overridden } : {}),
    candidates: names.map((name) => candidateOf(ctx, name)),
  }
}

function candidateOf(ctx: SelectContext, name: string): Candidate {
  const entry = ctx.registry.models.get(name)
  return entry !== undefined ? { kind: "entry", name, entry } : { kind: "raw", model: name }
}

// The key a candidate is known by: the internal name of an entry, or the
// model string of a raw override value — the form the down marks, the
// strict-resume record and the chain's selected-entry field all use.
export function candidateKey(candidate: Candidate): string {
  return candidate.kind === "entry" ? candidate.name : candidate.model
}

// The decision of one dispatch (§6.2, §6.3). The walk, in order:
//   1. the agent filter leaves the candidates (§6.2 rule 1); none left is
//      the empty-tier error;
//   2. a continuation keeps the chain's model while it is still usable
//      (§6.2) — the prompt is not moved to another model merely because a
//      better one reappeared mid-prompt;
//   3. a new prompt takes the first candidate usable now (rules 2–5), so
//      the primary returns automatically when its window reopens or its
//      down mark clears;
//   4. nothing usable: wait for the earliest opening among the candidates
//      that are not down and blocked only by their windows; with none to
//      wait for, every candidate is down and the probe loop takes over.
// AUTO-DECISION: the empty-tier check applies to every list source — a tier, a route, and either override — not only to tier lists (an override that points the sessions it matches at a candidate the agent filter excludes is just as empty, and silently waiting on it would hide the mistake)
export function select(ctx: SelectContext, call: SelectCall): Selection {
  const list = candidatesOf(ctx, call)
  const inPlay = list.candidates.filter((candidate) => passesFilter(ctx, candidate))
  if (!inPlay.length)
    return {
      kind: "empty",
      tier: list.tier,
      ...(list.route ? { route: list.route.key } : {}),
      ...(list.override ? { override: list.override } : {}),
      ...(ctx.agentFilter !== undefined ? { filter: ctx.agentFilter } : {}),
    }
  if (call.continuation === true && call.current !== undefined) {
    const kept = inPlay.find((candidate) => holds(candidate, call.current!))
    if (kept !== undefined && !faultsOf(ctx, call, kept).some(Boolean)) {
      return { kind: "pick", candidate: kept, via: "continuation" }
    }
  }
  const usable = inPlay.find((candidate) => !faultsOf(ctx, call, candidate).some(Boolean))
  if (usable !== undefined) return { kind: "pick", candidate: usable, via: "list" }
  // Nothing usable (§6.3): a candidate that is not down (rules 3–4) and
  // passes the cap (rule 5), blocked only by its window, opens later — wait
  // for the earliest such opening.
  let opening: { at: number; candidate: Candidate } | undefined
  for (const candidate of inPlay) {
    if (candidate.kind !== "entry") continue
    const [outside, down, ring, small] = faultsOf(ctx, call, candidate)
    if (!outside || down || ring || small) continue
    const at = nextOpening([candidate.entry], ctx.registry.tz, call.now)
    if (at !== undefined && (opening === undefined || at < opening.at)) opening = { at, candidate }
  }
  if (opening !== undefined) return { kind: "wait", until: opening.at, candidate: opening.candidate }
  // Every candidate is down (or nothing ever opens): the wait-and-probe
  // loop. The probe uses the first candidate inside its window, ignoring
  // the down marks.
  // AUTO-DECISION: the probe candidate still passes the agent filter and is inside its window, and ignores the down marks, the ring and the cap — a candidate the filter excludes can never be dispatched, and a probe prompt is tiny, so the cap would keep a recoverable model from ever being probed; when no candidate is inside its window, the first filtered candidate stands in, because the probe loop waits between probes anyway and a model that never opens is the documented backstop case (§10 item 7)
  const inWindow = inPlay.find((candidate) => !faultsOf(ctx, call, candidate)[0])
  return { kind: "probe", candidate: inWindow ?? inPlay[0]! }
}

// The earliest instant a list with nothing usable becomes usable again by
// waiting alone, and the candidate usable then (plans/0057 §6): the
// wait-and-probe loop sleeps to it instead of polling. A candidate in play
// comes back when its down mark's `until` has passed and its window is open —
// the next opening at or after that instant; one below the cap never comes
// back by waiting and is passed over, as is one whose window never opens.
// undefined when no such instant is known: a candidate is down with no end
// (a mark without `until`, or a ring with no usable key — when a ring's keys
// come back is not an input here), so only a probe can tell when it
// recovers, and the loop keeps its polled interval — or nothing ever comes
// back.
// AUTO-DECISION: one candidate down with no known end withholds the instant for the whole list, rather than the soonest known instant being taken anyway (the loop's probe is the only way such a candidate returns, and sleeping past the polled interval to another candidate's reset would stop probing it — the scheduled wait may only lengthen a sleep where every way back has an instant)
export function recoveryAt(ctx: SelectContext, call: SelectCall): { at: number; candidate: Candidate } | undefined {
  let soonest: { at: number; candidate: Candidate } | undefined
  for (const candidate of candidatesOf(ctx, call).candidates.filter((item) => passesFilter(ctx, item))) {
    const [, down, ring, small] = faultsOf(ctx, call, candidate)
    if (small) continue
    if (ring) return undefined
    let at = call.now
    if (down) {
      const until = ctx.marks?.get(candidateKey(candidate))?.until
      if (until === undefined) return undefined
      at = until
    }
    if (candidate.kind === "entry") {
      const opens = nextOpening([candidate.entry], ctx.registry.tz, at)
      if (opens === undefined) continue
      at = opens
    }
    if (soonest === undefined || at < soonest.at) soonest = { at, candidate }
  }
  return soonest
}

// §6.2 rule 1: the agent filter keeps only the models on its adapter; a raw
// value runs on the default agent (§9 R6), so the filter reads that agent's
// name for it.
function passesFilter(ctx: SelectContext, candidate: Candidate): boolean {
  if (ctx.agentFilter === undefined) return true
  const adapter = candidate.kind === "entry" ? ctx.registry.agents.get(candidate.entry.agent)?.adapter : ctx.defaultAgent
  return adapter === ctx.agentFilter
}

// Does the candidate hold the chain's current model? An entry is held by its
// internal name or by any of its step model ids — a session that stepped up
// carries the wider step's id (§4.5), and a continuation keeps the entry.
function holds(candidate: Candidate, current: string): boolean {
  return candidate.kind === "entry"
    ? candidate.name === current || candidate.entry.model === current || (candidate.entry.wider?.includes(current) ?? false)
    : candidate.model === current
}

// The four faults of §6.2 rules 2–5, in rule order: [outside its windows,
// marked down, ring has no usable key, known window below the cap]. A
// candidate is usable now when none holds.
function faultsOf(ctx: SelectContext, call: SelectCall, candidate: Candidate): [boolean, boolean, boolean, boolean] {
  const known = contextWindow(ctx, candidate)
  return [
    candidate.kind === "entry" && !usableAt(candidate.entry, ctx.registry.tz, call.now),
    isDown(ctx, candidate, call.now),
    candidate.kind === "entry" &&
      candidate.entry.keys !== undefined &&
      candidate.entry.provider !== undefined &&
      ctx.ringUsable !== undefined &&
      !ctx.ringUsable(candidate.entry.provider, call.now),
    known !== undefined && known < ctx.cap,
  ]
}

// Rule 3: a down mark, keyed by the internal name (a raw override value by
// its model string, so a marked-down raw value fails over like an entry). A
// mark with `until` lasts until that instant and reads as cleared at it.
// AUTO-DECISION: raw override values share the model mark store, keyed by their model string (one store keeps the marks total, and a raw value that failed classified then steps aside exactly like an entry)
function isDown(ctx: SelectContext, candidate: Candidate, now: number): boolean {
  const mark = ctx.marks?.get(candidate.kind === "entry" ? candidate.name : candidate.model)
  return mark !== undefined && (mark.until === undefined || mark.until > now)
}

// Rule 5: the known context window in tokens, or undefined when unknown. An
// unknown window never excludes a candidate, matching the failover clamp of
// src/session.ts, which skips a candidate only when its window is known and
// below the cap. For an entry with steps this is the top step's window
// (§4.5); an entry without `model` runs on the agent's default model, whose
// window is not known here.
// AUTO-DECISION: a stepped entry reads only the top step's window from the live limits; the entry's `context` names the base step and is not read for it (the models command settled the same reading — an unknown top-step window is a note, never an exclusion)
function contextWindow(ctx: SelectContext, candidate: Candidate): number | undefined {
  if (candidate.kind === "raw") return ctx.limits?.get(candidate.model)
  const { entry } = candidate
  if (entry.wider !== undefined && entry.wider.length > 0) return ctx.limits?.get(entry.wider.at(-1)!)
  if (entry.model === undefined) return undefined
  const live = ctx.limits?.get(entry.model)
  return live !== undefined ? live : entry.context !== undefined ? entry.context * 1000 : undefined
}
