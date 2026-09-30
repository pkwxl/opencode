// The context-steps concern (plans/0061 §4.5, the stepUp cells of the part,
// message, error and retry rows): the live half of the context steps
// (plans/0055 §4.5) — one model sold under several ids that share a prompt
// cache and differ only in context window and price — beside the pure half
// in src/model-step.ts. At a measurement point (the message row's cell,
// after the usage concern measured) a live figure past the current step's
// step-up point steers the same session onto the next step's id, records
// the reach and arms the cache-claim check (the router's run state, so a
// watch that ends before the first step-finish does not lose it); the part
// row's cell observes the armed claim at the first step-finish on the
// wider id: a large cacheRead confirms it, a whole-prefix cacheWrite
// contradicts it — the warning line once per entry. An overflow class
// below the top step (the error and retry rows' cells, reading the failure
// record the failure concern accumulated) means the agent compacted before
// the step-up steer could land: the late step-up records the next step
// with no steer, and the compacted session carries on under it.
//
// The slice's step moves one-way, up only; `model` is the id every steer
// names (the reached step's id, so a late steer cannot drop the session
// back) and `reached` the record the snapshot carries to the chain.
// Without steps — an entry carrying no `wider` (the implicit registry's
// carry none) — every cell is inert.
import { enabledSteps, stepId, stepUpPoint } from "../../model-step"
import { renderStepUp } from "../../prompt"
import { promptFacts } from "../../prompt-facts"
import { formatTokens } from "../../session-api"
import { liveUsage } from "../../usage"
import type { Advice, Concern, TurnContext, TurnFx, TurnState } from "../contract"

// The step-up itself, at the measurement point that crossed the current
// step's step-up point: steer the same session with the next step's id and
// the one-line note, record the reached step, and arm the cache-claim
// check on the wider id. Without the steer capability the note cannot be
// delivered mid-session; the step still takes effect — the chain's record
// makes the next prompt into this session name the next id (§4.5).
async function stepUp(fx: TurnFx, own: TurnState["stepUp"], ctx: TurnContext, usedNow: number): Promise<void> {
  const steerContext = ctx.steerContext
  const entry = steerContext?.entry
  if (entry === undefined || steerContext === undefined) return
  const nextId = stepId(entry, own.step + 1)
  const fromId = stepId(entry, own.step)
  if (nextId === undefined || fromId === undefined) return
  // The step is recorded before the steer goes out: the steer itself names
  // the next id (that is how the session moves), and a failed dispatch
  // still leaves the record — the next prompt into this session names the
  // id, exactly as without the steer capability.
  own.step += 1
  own.model = nextId
  own.reached = { step: own.step, model: nextId }
  fx.log(`⇡ ${steerContext.label} context ${formatTokens(usedNow)} reached the step-up point of ${steerContext.name} (${fromId}); continuing the same session on ${nextId}`)
  if (ctx.client.capabilities.steer) {
    const ok = await fx.steer(renderStepUp(promptFacts(ctx.opts), { from: fromId, next: nextId }))
    if (ok) ctx.services.router.awaitCacheClaim(steerContext.name, usedNow)
  } else {
    fx.log(`⇡ ${steerContext.label} the agent takes no mid-turn steers; the next prompt into this session names ${nextId}`)
  }
}

// Late step-up (§4.5, §7's overflow exception): the agent compacted before
// the step-up steer could land — an overflow error below the top step. No
// steer (the compaction already shrank the context); the reached step is
// recorded so the next prompt into this session names the next id. Every
// other overflow stays with the handover mechanism.
async function stepLate(fx: TurnFx, own: TurnState["stepUp"], ctx: TurnContext): Promise<void> {
  const steerContext = ctx.steerContext
  const entry = steerContext?.entry
  if (entry === undefined || steerContext === undefined) return
  const limits = await fx.contextLimits()
  if (own.step + 1 >= enabledSteps(entry, limits)) return
  const nextId = stepId(entry, own.step + 1)
  const fromId = stepId(entry, own.step)
  if (nextId === undefined || fromId === undefined) return
  fx.log(`⇡ ${steerContext.label} step-up late: the agent compacted the session (overflow on ${fromId}) before the step-up steer could land; the next prompt into this session names ${nextId}`)
  own.step += 1
  own.model = nextId
  own.reached = { step: own.step, model: nextId }
}

// What one step-up turn needs beside its context. `live` is the fx's
// steer-model channel: the production fx is built before the spine creates
// the slices, and its steer default (this slice's model field — the
// reached step's id) must see a mid-turn step-up; `initial` parks the
// slice it builds in the cell, and watch wires the fx's getter over it.
export type StepUpDeps = {
  live: { slice?: TurnState["stepUp"] }
}

// One concern instance per turn (a factory, not a module constant): the
// steer-model cell is per-turn wiring, shared with the fx watch builds.
export const makeStepUpConcern = (deps: StepUpDeps): Concern<"stepUp"> => ({
  name: "stepUp",
  initial: (ctx): TurnState["stepUp"] => {
    const slice: TurnState["stepUp"] = { model: ctx.steerContext?.model, step: ctx.steerContext?.step ?? 0 }
    deps.live.slice = slice
    return slice
  },
  handle: async (input, own, view, fx, ctx): Promise<Advice> => {
    if (input.kind !== "event") return "pass"
    const steerContext = ctx.steerContext
    // The part row's stepUp cell. Cache-claim check (§4.5): `wider` asserts
    // the step ids share the base id's prompt cache; the first step-finish
    // after a step-up shows whether it holds (a large cacheRead confirms
    // it, a cacheWrite of the whole prefix contradicts it). The
    // contradiction line fires once per entry.
    if (input.event.type === "part") {
      const part = input.event.part
      if (part.kind === "step-finish" && steerContext?.entry !== undefined) {
        const router = ctx.services.router
        const verdict = router.observeCacheClaim(steerContext.name, part.tokens)
        if (verdict === "confirmed") {
          fx.vlog(`✓ ${steerContext.name}: the wider step read ${formatTokens(part.tokens.cacheRead)} tokens from the shared prompt cache`)
        } else if (verdict === "contradiction" && router.noteClaimContradiction(steerContext.name)) {
          fx.log(
            `⚠ ${steerContext.name}: the first step on the wider id wrote ${formatTokens(part.tokens.cacheWrite)} tokens of cache and read ${formatTokens(part.tokens.cacheRead)} — ` +
              `the wider id does not share the base id's prompt cache as the entry's wider list claims; check the provider's model ids`,
          )
        }
      }
      // The transcript and stuck cells follow; this cell never stops the
      // input.
      return "pass"
    }
    // The message row's stepUp cell (the row's last). The usage concern's
    // cell before this measured the point and wrote its figure on the usage
    // slice; the check reads it there, not off the source — the
    // measurement's own figure is what the step-up point is judged against,
    // and a notice steer the same measurement sent grows an estimated
    // source's running figure past it.
    if (input.event.type === "message") {
      if (steerContext?.entry === undefined || !liveUsage(ctx.client.capabilities.usage)) return "consumed"
      const entry = steerContext.entry
      const now = view.usage.used
      const limits = await fx.contextLimits()
      // The condition itself is the re-arm: after a step-up the next step's
      // point sits above the current figure, so the next steer happens at
      // its own boundary.
      if (own.step + 1 < enabledSteps(entry, limits)) {
        const window = limits.get(stepId(entry, own.step)!)
        if (window !== undefined && now >= stepUpPoint(window)) await stepUp(fx, own, ctx, now)
      }
      return "consumed"
    }
    // The error row's stepUp cell (the row's last). The failure concern's
    // cell before it accumulated the error into the info; this cell only
    // reads the folded record. Late step-up (§4.5, §7): an overflow below
    // the top step means the agent compacted before the step-up steer could
    // land — record the next step and go on observing (the compacted
    // session continues).
    if (input.event.type === "error") {
      if (ctx.classify(view.failure.info ?? {}) === "overflow") await stepLate(fx, own, ctx)
      return "consumed"
    }
    // The retry row's stepUp cell: the same overflow read from the retry
    // surface (the agent retried the request that overflowed before
    // compacting); the late step-up applies here exactly as at the
    // session-error row above.
    // AUTO-DECISION: the read is the patterns' own classification, not a verdict channelled from the recovery cell (the consult's verdict is overflow exactly when the patterns' read is — an answer never raises to overflow, the reply's class union has none — so re-deriving the pattern read needs no channel and no second consult).
    if (input.event.type === "retry") {
      if (ctx.classify(view.failure.info ?? {}) === "overflow") await stepLate(fx, own, ctx)
      // The liveness and transcript cells follow with the announced silence
      // and the deduplicated retry vlog.
      return "pass"
    }
    return "pass"
  },
})
