// The pure dispatch plan of one prompt (plans/0061 §4.7): everything a
// dispatch decides before anything is created — whether the chain's recorded
// session is taken over (resumed, the single in-chain continuation), which
// registry candidate this dispatch runs on or the blocked outcome when none
// is usable, the cross-agent move a pick on another agent forces, and
// whether a brand-new session clears the failback scope. attempt() is the
// executor: it builds the facts (the selection context is built at the seam,
// so the volatile run state — the down marks, the /failback override, the
// key rings — reaches the planner only as data), asks this function, and
// writes the chain through the named transitions of
// src/chain-transitions.ts in the order the plan records.
//
// Pure means: no I/O, no module state, no chain write. The registry, the
// selection context and the clock ride the facts; the chain is read only.
// Without a registry (no routing facts) the plan answers resumed and the
// failback flag alone — the no-registry target resolves after the session
// exists, exactly as before, and stays the executor's to compute.
import { roleOf, type SessionChain, type SessionResult } from "../chain"
import type { ChainRoute } from "../chain-transitions"
import { usableAt, formatWindowState } from "../model-window"
import { stepForUsed, stepId } from "../model-step"
import type { ModelEntry } from "../models"
import type { PhaseTypeEntry, Tier } from "../phases/registry"
import { nowOf, type RoutingFacts } from "../routing"
import { worktreeNote } from "../session-api"
import { candidatesOf, candidateKey, select, type DownMark, type SelectContext } from "../select"
import { SWITCH_ENV, type Switches } from "../switches"

// What one dispatch is decided on. `routing` and `ctx` are present iff a
// model registry drives the run: the routing facts carry the clock (nowOf)
// and the default agent, the selection context is selectContext(routing,
// switches, cap, limits) as the executor built it — the one injection point
// of the down marks, the /failback override, the key rings and the live
// context windows. `resumable` is the takeover gate's capability (the
// chain's agent can resume sessions), which only the executor can read.
// `label` is the dispatch's log label (the task id). `entry` is the current
// phase type's registry entry, a routing key.
export type DispatchFacts = {
  routing?: RoutingFacts
  ctx?: SelectContext
  switches: Switches
  resumable: boolean
  label: string
  entry?: PhaseTypeEntry
}

// The route a registry pick puts the chain on (setRoute's argument; the
// entry key and the step are always defined under a pick — a raw override
// value steps at the base 0).
export type PickRoute = { model?: string; entry: string; step: number }

// The registry pick of a dispatch: the route (the model id sent to the
// adapter, the entry's internal name — also the prompt's recorded model and
// the per-model stats key — and the context step the session starts at),
// the variant an entry's prompt carries, the entry itself for the steer
// context, the tier the stats book, the agent profile the dispatch runs on,
// and the ◈ announcement line (undefined = a continuation of the same
// session on the same model, which the terminal was already told about).
export type DispatchPick = {
  route: PickRoute
  variant: string | undefined
  entry: ModelEntry | undefined
  tier: Tier
  agent: string
  announce: string | undefined
}

// The cross-agent move a pick forces (a session never crosses agents): the
// worktree-check note the blank session on the target agent opens with, and
// the ↻ line to log when a pre-created session is being dropped.
export type AgentMove = { note: string; pendingLog: string | undefined }

// The plan attempt() executes: `resumed` (after the move cancelled it, if
// one fired), the pick or the blocked outcome of the registry selection,
// the move, and whether a create clears the failback scope.
export type DispatchPlan = {
  resumed: boolean
  pick?: DispatchPick
  blocked?: SessionResult
  move?: AgentMove
  clearsFailback: boolean
}

// Registry selection runs before anything is created (plans/0055 §8.3): a
// session never crosses agents, so the pick decides whose host serves the
// dispatch — the client the session is created on, the host syncContext
// reaches and the chain's agent all come from it.
export function planDispatch(chain: SessionChain, facts: DispatchFacts): DispatchPlan {
  // The single in-chain continuation is a resumed takeover: the chain holds
  // a recorded session and a one-shot note awaits injection (interruption
  // recovery). Every other prompt opens a fresh session.
  let resumed = facts.resumable && chain.id !== undefined && chain.note !== undefined && chain.pending === undefined
  const plan: DispatchPlan = { resumed, clearsFailback: facts.switches.modelFailbackScope === "session" }
  if (facts.routing === undefined || facts.ctx === undefined) return plan
  const { routing, ctx, label } = facts
  const role = roleOf(chain)
  const list = candidatesOf(ctx, { role, entry: facts.entry, now: nowOf(routing) })
  const decision = select(ctx, {
    role,
    entry: facts.entry,
    now: nowOf(routing),
    current: chain.modelEntry,
    continuation: resumed || chain.pending !== undefined,
  })
  if (decision.kind === "empty") {
    const detail = `${list.override ? `the ${list.override} override` : `the ${list.tier} list`}${list.route ? ` (route ${list.route.key})` : ""}`
    plan.blocked = {
      type: "blocked",
      question: `model registry: no candidate is left for this session's routing (${detail}, agent filter ${routing.agentFilter ?? "none"}); fix the registry or the filter and re-run`,
    }
    return plan
  }
  if (decision.kind === "wait") {
    // §6.3's wait: nothing is usable now, but a candidate that is not down
    // opens later through its window. No session content exists to probe,
    // so the ladder sleeps inside the unit until the earliest opening plus
    // hibernate's jitter and dispatches again (the re-selection reads the
    // advanced clock; a suspend that wakes past a short window simply waits
    // for its next opening).
    plan.blocked = {
      type: "blocked",
      question: `no usable model candidate now: every candidate of ${list.override ? `the ${list.override} override` : `the ${list.tier} list`} is outside its windows; waiting for the earliest opening`,
      noModel: true,
      windowWait: {
        until: decision.until,
        model: candidateKey(decision.candidate),
        tier: list.tier,
        opens: formatWindowState({ open: false, opens: decision.until }, routing.registry.tz, nowOf(routing)),
      },
    }
    return plan
  }
  if (decision.kind === "probe") {
    plan.blocked = {
      type: "blocked",
      question: `no usable model candidate: every candidate of ${list.override ? `the ${list.override} override` : `the ${list.tier} list`} is down or outside its windows; entering the wait-and-probe loop`,
      noModel: true,
    }
    return plan
  }
  const picked = decision.candidate
  // Session lifetime of a step (§4.5): a continuation of the same session
  // keeps the step it reached (the chain's field, written by the watch
  // that stepped up); a resumed takeover recomputes it from the context
  // size rebuilt from the session's history (chain.used, nothing
  // persisted); every other dispatch — a new prompt, the session after a
  // handover, a failover onto this entry — starts at the base step.
  let step = 0
  if (picked.kind === "entry" && (decision.via === "continuation" || resumed)) {
    step = resumed ? stepForUsed(picked.entry, ctx.limits ?? EMPTY_LIMITS, chain.used) : (chain.modelStep ?? 0)
  }
  const entryOf = picked.kind === "entry" ? picked.entry : undefined
  const target = picked.kind === "entry" ? (stepId(picked.entry, step) ?? picked.entry.model) : picked.model
  const key = candidateKey(picked)
  const pickAgent = picked.kind === "entry" ? picked.entry.agent : routing.defaultAgent
  // ◈ display (§6.5): the internal name with the tier, the agent and
  // model behind it, and what routed the dispatch; a move names its
  // reason — window, quota (the classified failures) or failback. Key
  // rings are a later step. Like the no-registry line: every new session
  // shows one, a resumed takeover only on a change.
  const bracket = picked.kind === "entry" ? `${picked.entry.agent}:${picked.entry.model ?? "default"}` : `${routing.defaultAgent}:${picked.model}`
  const routePart =
    list.override === "env"
      ? `override ${SWITCH_ENV.model}`
      : list.override === "failback"
        ? "override /failback"
        : `route ${list.route?.key ?? roleOf(chain)}`
  const previous = chain.modelShown !== undefined && chain.modelShown !== key ? chain.modelShown : undefined
  const reason = moveReason(ctx, routing, previous)
  const announce =
    key !== chain.modelShown || !resumed
      ? `◈ ${label} using model ${key} [${list.tier} · ${bracket}] (${routePart}${reason ? `; ${reason}` : ""})`
      : undefined
  // §8.3: a session never crosses agents. A pick on another agent than
  // the chain's live session (or its pre-created fork) cannot take this
  // prompt: the id/pending session is left behind and the dispatch opens
  // a blank session with the worktree-check note — both for a failover
  // (switchModel writes this state itself) and for a takeover whose
  // model died under it (§6.2 continuity ties move only new prompts, so
  // the session itself is not moved).
  let move: AgentMove | undefined
  if (chain.agent !== undefined && chain.agent !== pickAgent && (chain.pending !== undefined || resumed)) {
    move = {
      note: worktreeNote(`The dispatch moved to agent ${pickAgent} (a session never crosses agents) and did not inherit the earlier session's context`),
      pendingLog:
        chain.pending !== undefined
          ? `↻ ${label} the pre-created session ${chain.pending} lives on agent ${chain.agent}; the dispatch moved to ${pickAgent}, so a new session opens there`
          : undefined,
    }
    resumed = false
  }
  plan.resumed = resumed
  plan.pick = {
    route: { ...(target !== undefined ? { model: target } : {}), entry: key, step: entryOf !== undefined ? step : 0 },
    variant: entryOf !== undefined ? entryOf.variant : undefined,
    entry: entryOf,
    tier: list.tier,
    agent: pickAgent,
    announce,
  }
  plan.move = move
  return plan
}

const EMPTY_LIMITS: ReadonlyMap<string, number> = new Map()

// A move's reason for the registry ◈ line (plans/0055 §6.5): the previously
// shown model read against the registry at the dispatch's instant — outside
// its windows ("window"), still marked down ("quota", standing for the
// classified quota/auth/rate failures; "quota (classifier)" when the class
// that wrote the mark came from the failure-message classifier, §7.1), or an
// entry that is usable again, meaning the list changed underneath it (a
// /failback or a scope boundary cleared its mark: "failback"). undefined =
// no move, or a raw value with nothing attributable to say. A key-ring
// rotation keeps the model, so it never shows here. The marks are read
// through the selection context (the live down-mark map, injected by the
// executor), never as module state.
function moveReason(ctx: SelectContext, routing: RoutingFacts, previous: string | undefined): string | undefined {
  if (previous === undefined) return undefined
  const entry = ctx.registry.models.get(previous)
  const now = nowOf(routing)
  if (entry !== undefined && !usableAt(entry, ctx.registry.tz, now)) return "window"
  const mark: DownMark | undefined = ctx.marks?.get(previous)
  if (mark !== undefined && (mark.until === undefined || mark.until > now)) return mark.classifier ? "quota (classifier)" : "quota"
  return entry !== undefined ? "failback" : undefined
}
