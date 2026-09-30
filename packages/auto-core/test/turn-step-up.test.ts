// The stepUp concern's suite (plans/0061 §4.6: a concern suite over a fake
// TurnFx): the message cell (the step-up at the measurement point — the
// steer, the record, the arming of the cache-claim check, the
// failure-ignored dispatch, the re-arm on the next step's point, the gates:
// no entry, a non-live tier, the top step, a steer-less agent, the figure
// read off the usage slice), the part cell (the cache-claim observation:
// the confirmation vlog, the contradiction line once per entry), the error
// and retry cells (the late step-up on an overflow class, at the top step
// nothing) and the live-slice channel (the fx's steer-model default). The
// cache-claim verdict tables at the bottom are re-homed from the model-step
// module's suite (test/model-step.test.ts): the router holds the state,
// this concern is its only consumer. The end-to-end step-up paths (the
// steer reaching the client with the next id named, steppedUp riding the
// Watch) are the trace oracle's (test/turn-trace.test.ts's step-up
// scenarios, byte-pinned through watch's real install).
import { describe, expect, test } from "bun:test"
import type { AgentEvent } from "../src/agent/types"
import type { ErrorClass, ErrorInfo } from "../src/chain"
import type { Advice, TurnInput, TurnState } from "../src/engine/contract"
import { makeStepUpConcern, type StepUpDeps } from "../src/engine/concerns/step-up"
import type { ModelEntry } from "../src/models"
import { services } from "../src/services"
import type { SteerContext } from "../src/model-step"
import { fakeTurnFx, turnContext, viewOver } from "./fixtures/turn"
import { ev, fakeAgent } from "./fixtures/agent"

const SESSION = "ses_1"

// The registry entry the suite steps through, in model-step.test.ts's shape:
// a base id on a 100k window (step-up point 52.0k) with wider steps at 200k
// (point 160.0k) and 400k.
const entry = (fields: Partial<ModelEntry> = {}): ModelEntry => ({
  name: "big",
  layer: "operator",
  agent: "opencode",
  model: "prov/base",
  wider: ["prov/wide"],
  ...fields,
})
const steerContext = (over: Partial<SteerContext> = {}): SteerContext => ({
  name: "big",
  entry: entry(),
  step: 0,
  model: "prov/base",
  label: "T-001",
  ...over,
})
const LIMITS = new Map([
  ["prov/base", 100_000],
  ["prov/wide", 200_000],
  ["prov/wider", 400_000],
])

// One concern instance per case, driven one input at a time over a recording
// fx. `classify` stubs the pattern classifier (the ctx's binding), so a case
// states the verdict the patterns return; the usage figure arrives through
// the view, exactly where the usage concern's cell wrote it.
const setup = (over: { steerContext?: SteerContext; classify?: (info: ErrorInfo) => ErrorClass; client?: ReturnType<typeof fakeAgent>["client"]; limits?: ReadonlyMap<string, number> } = {}) => {
  const deps: StepUpDeps = { live: {} }
  const concern = makeStepUpConcern(deps)
  const ctx = turnContext({
    ...(over.client !== undefined ? { client: over.client } : {}),
    ...(over.classify !== undefined ? { classify: over.classify } : {}),
    ...(over.steerContext !== undefined ? { steerContext: over.steerContext } : {}),
  })
  const own = concern.initial(ctx)
  const fx = fakeTurnFx({ limits: over.limits ?? LIMITS })
  const drive = (input: TurnInput, view: Partial<TurnState> = {}, useFx = fx): Promise<Advice> =>
    concern.handle(input, own, viewOver(view), useFx, ctx)
  // A measurement-point message input over a planted usage figure (the row's
  // earlier cell measured; the event's own contextUsed is not what the check
  // reads).
  const measure = (used: number, view: Partial<TurnState> = {}, useFx = fx): Promise<Advice> =>
    drive({ kind: "event", event: ev.message(SESSION, `m_${used}`, 1, { model: "prov/base" }) as AgentEvent }, { usage: { pct: 100, used, hinted: false, notes: new Set<number>() }, ...view }, useFx)
  // A step-finish part the cache-claim observation judges.
  const stepFinish = (cacheRead: number, cacheWrite: number): TurnInput => ({
    kind: "event",
    event: {
      type: "part",
      session: SESSION,
      part: { kind: "step-finish", id: `stp_${cacheRead}_${cacheWrite}`, reason: "stop", tokens: { input: 0, output: 0, reasoning: 0, cacheRead, cacheWrite }, cost: 0 },
    } as AgentEvent,
  })
  const failureView = (info?: ErrorInfo): Partial<TurnState> => ({ failure: { error: "", retrying: false, ...(info !== undefined ? { info } : {}) } })
  return { concern, ctx, own, deps, fx, drive, measure, stepFinish, failureView }
}

describe("the stepUp concern (message: the step-up at the measurement point)", () => {
  test("a live figure past the base step's point steers the next id, records the reach and arms the cache claim", async () => {
    const { own, fx, measure } = setup({ steerContext: steerContext() })
    await expect(measure(60_000)).resolves.toBe("consumed")
    expect(own).toEqual({ model: "prov/wide", step: 1, reached: { step: 1, model: "prov/wide" } })
    expect(fx.lines).toEqual(["⇡ T-001 context 60.0k reached the step-up point of big (prov/base); continuing the same session on prov/wide"])
    expect(fx.steers).toHaveLength(1)
    expect(fx.steers[0]).toContain("prov/base")
    expect(fx.steers[0]).toContain("prov/wide")
  })

  test("the armed claim observes the next step-finish: a large cacheRead confirms it (the ✓ vlog)", async () => {
    const { fx, measure, drive, stepFinish } = setup({ steerContext: steerContext() })
    await measure(60_000)
    await expect(drive(stepFinish(50_000, 1_000))).resolves.toBe("pass")
    expect(fx.vlogs).toEqual(["✓ big: the wider step read 50.0k tokens from the shared prompt cache"])
  })

  test("the step-up steer's failed dispatch is ignored: the record stands, the turn continues, the claim is not armed", async () => {
    const { own, fx, measure, drive, stepFinish } = setup({ steerContext: steerContext() })
    const failing = fakeTurnFx({ steerOk: false, limits: LIMITS })
    await expect(measure(60_000, {}, failing)).resolves.toBe("consumed")
    expect(own.reached).toEqual({ step: 1, model: "prov/wide" })
    // No claim was armed (the steer never went out): the step-finish says
    // nothing.
    await expect(drive(stepFinish(50_000, 1_000))).resolves.toBe("pass")
    expect(fx.vlogs).toEqual([])
  })

  test("below the step-up point nothing fires (the base point of a 100k window is 52.0k)", async () => {
    const { own, fx, measure } = setup({ steerContext: steerContext() })
    await expect(measure(51_999)).resolves.toBe("consumed")
    expect(own).toEqual({ model: "prov/base", step: 0 })
    expect(fx.calls).toEqual(["contextLimits"])
  })

  test("the re-arm: after a step-up the next step's point governs — a second crossing steps again, the top step stops", async () => {
    const ladder = steerContext({ entry: entry({ wider: ["prov/wide", "prov/wider"] }) })
    const { own, fx, measure } = setup({ steerContext: ladder })
    await measure(60_000)
    await measure(170_000)
    expect(own).toEqual({ model: "prov/wider", step: 2, reached: { step: 2, model: "prov/wider" } })
    expect(fx.steers).toHaveLength(2)
    // The top step has no point above it: however far the figure grows,
    // nothing more fires.
    await measure(390_000)
    expect(fx.steers).toHaveLength(2)
  })

  test("the check reads the measurement's figure off the usage slice (the row's earlier cell wrote it there)", async () => {
    const { own, fx, drive } = setup({ steerContext: steerContext() })
    // The event itself carries a small contextUsed; the slice's figure is
    // the measurement's, and it is the one judged.
    await expect(drive({ kind: "event", event: ev.message(SESSION, "m_small", 1_000, { model: "prov/base" }) as AgentEvent }, { usage: { pct: 100, used: 60_000, hinted: false, notes: new Set<number>() } })).resolves.toBe("consumed")
    expect(own.step).toBe(1)
    expect(fx.steers).toHaveLength(1)
  })

  test("a non-live tier skips the check however far past the point; without an entry (or a steer context) the cell is inert", async () => {
    const reported = setup({
      steerContext: steerContext(),
      client: fakeAgent({ capabilities: { usage: "reported" } }).client,
    })
    await expect(reported.measure(60_000)).resolves.toBe("consumed")
    expect(reported.own).toEqual({ model: "prov/base", step: 0 })
    expect(reported.fx.calls).toEqual([])
    const noEntry = setup({ steerContext: steerContext({ entry: undefined }) })
    await expect(noEntry.measure(60_000)).resolves.toBe("consumed")
    expect(noEntry.own).toEqual({ model: "prov/base", step: 0 })
    const noContext = setup()
    await expect(noContext.measure(60_000)).resolves.toBe("consumed")
    expect(noContext.fx.calls).toEqual([])
  })

  test("a wider step the agent's model list does not know disables the ladder: the session stays on the base id", async () => {
    const { own, fx, measure } = setup({ steerContext: steerContext(), limits: new Map([["prov/base", 100_000]]) })
    await expect(measure(60_000)).resolves.toBe("consumed")
    expect(own).toEqual({ model: "prov/base", step: 0 })
    expect(fx.steers).toEqual([])
  })

  test("an agent that takes no mid-turn steers still records the step (the next prompt into this session names the id)", async () => {
    const { own, fx, measure } = setup({
      steerContext: steerContext(),
      client: fakeAgent({ capabilities: { steer: false } }).client,
    })
    await expect(measure(60_000)).resolves.toBe("consumed")
    expect(own).toEqual({ model: "prov/wide", step: 1, reached: { step: 1, model: "prov/wide" } })
    expect(fx.steers).toEqual([])
    expect(fx.lines).toEqual([
      "⇡ T-001 context 60.0k reached the step-up point of big (prov/base); continuing the same session on prov/wide",
      "⇡ T-001 the agent takes no mid-turn steers; the next prompt into this session names prov/wide",
    ])
  })
})

describe("the stepUp concern (part: the cache-claim observation)", () => {
  test("a whole-prefix cacheWrite contradicts the claim — the ⚠ line fires once per entry, across step-ups", async () => {
    const ladder = steerContext({ entry: entry({ wider: ["prov/wide", "prov/wider"] }) })
    const { fx, measure, drive, stepFinish } = setup({ steerContext: ladder })
    await measure(60_000)
    await drive(stepFinish(1_000, 55_000))
    await measure(170_000)
    await drive(stepFinish(5_000, 90_000))
    // The second step-up's ⇡ line fires, its contradiction does not (the
    // entry's line was already logged).
    expect(fx.lines).toEqual([
      "⇡ T-001 context 60.0k reached the step-up point of big (prov/base); continuing the same session on prov/wide",
      "⚠ big: the first step on the wider id wrote 55.0k tokens of cache and read 1000 — the wider id does not share the base id's prompt cache as the entry's wider list claims; check the provider's model ids",
      "⇡ T-001 context 170.0k reached the step-up point of big (prov/wide); continuing the same session on prov/wider",
    ])
    // Inconclusive tokens (neither half the prefix) say nothing at all.
    await measure(390_000)
    await drive(stepFinish(100, 2_000))
    expect(fx.lines).toHaveLength(3)
  })

  test("a step-finish without an armed claim, a non-step-finish part, or no steer context: nothing observed", async () => {
    const armed = setup({ steerContext: steerContext() })
    await armed.measure(60_000)
    await armed.drive(armed.stepFinish(50_000, 1_000)) // the claim is consumed
    await expect(armed.drive(armed.stepFinish(50_000, 1_000))).resolves.toBe("pass")
    expect(armed.fx.vlogs).toHaveLength(1)
    const plain = setup({ steerContext: steerContext() })
    await expect(plain.drive({ kind: "event", event: ev.text(SESSION, "t1", "a part") as AgentEvent })).resolves.toBe("pass")
    expect(plain.fx.calls).toEqual([])
    const contextless = setup()
    await expect(contextless.drive(contextless.stepFinish(50_000, 1_000))).resolves.toBe("pass")
    expect(contextless.fx.calls).toEqual([])
  })
})

describe("the stepUp concern (error and retry: the late step-up)", () => {
  const OVERFLOW: ErrorInfo = { message: "ContextOverflowError: prompt exceeds the window" }

  test("an overflow session error below the top step records the late step-up with no steer (the compacted session continues)", async () => {
    const { own, fx, drive, failureView } = setup({ steerContext: steerContext(), classify: () => "overflow" })
    await expect(drive({ kind: "event", event: ev.error(SESSION, { name: "ContextOverflowError", message: "prompt exceeds the window" }) as AgentEvent }, failureView(OVERFLOW))).resolves.toBe("consumed")
    expect(own).toEqual({ model: "prov/wide", step: 1, reached: { step: 1, model: "prov/wide" } })
    expect(fx.lines).toEqual(["⇡ T-001 step-up late: the agent compacted the session (overflow on prov/base) before the step-up steer could land; the next prompt into this session names prov/wide"])
    expect(fx.steers).toEqual([])
  })

  test("every other class leaves the steps alone (the handover mechanism keeps the overflow above the top step)", async () => {
    const { own, fx, drive, failureView } = setup({ steerContext: steerContext(), classify: () => "transient" })
    await expect(drive({ kind: "event", event: ev.error(SESSION, { message: "internal server error" }) as AgentEvent }, failureView(OVERFLOW))).resolves.toBe("consumed")
    expect(own).toEqual({ model: "prov/base", step: 0 })
    expect(fx.calls).toEqual([])
  })

  test("the retry surface takes the same late step-up and passes the row on (the liveness and transcript cells follow)", async () => {
    const { own, fx, drive, failureView } = setup({ steerContext: steerContext(), classify: () => "overflow" })
    await expect(
      drive({ kind: "event", event: { type: "retry", session: SESSION, id: "r1", attempt: 1, error: { message: "context overflow: the request overflowed before compaction" } } as AgentEvent }, failureView(OVERFLOW)),
    ).resolves.toBe("pass")
    expect(own.reached).toEqual({ step: 1, model: "prov/wide" })
    expect(fx.lines).toHaveLength(1)
  })

  test("at the top step (or without an entry) the late step-up does nothing", async () => {
    const top = setup({ steerContext: steerContext(), classify: () => "overflow" })
    top.own.step = 1
    top.own.model = "prov/wide"
    await expect(top.drive({ kind: "event", event: ev.error(SESSION, { message: "overflow" }) as AgentEvent }, top.failureView(OVERFLOW))).resolves.toBe("consumed")
    expect(top.own.reached).toBeUndefined()
    expect(top.fx.calls).toEqual(["contextLimits"])
    const contextless = setup({ classify: () => "overflow" })
    await expect(contextless.drive({ kind: "event", event: ev.error(SESSION, { message: "overflow" }) as AgentEvent }, contextless.failureView(OVERFLOW))).resolves.toBe("consumed")
    expect(contextless.fx.calls).toEqual([])
  })
})

describe("the stepUp concern (the live-slice channel to the fx's steer default)", () => {
  test("initial parks the built slice in the cell, and a step-up updates it (the fx's steer-model getter reads it)", async () => {
    const { deps, own, measure } = setup({ steerContext: steerContext() })
    expect(deps.live.slice).toBe(own)
    expect(deps.live.slice?.model).toBe("prov/base")
    await measure(60_000)
    expect(deps.live.slice?.model).toBe("prov/wide")
  })
})

// The cache-claim verdicts (re-homed from test/model-step.test.ts when the
// concern was extracted): the router holds the run state — armed at the
// step-up, judged at the first step-finish — and this concern is its only
// consumer. The pure half of the context steps (the point, the walk, the
// resume rule, the startup validation) stays in the model-step suite:
// engine/dispatch reads it too.
describe("the cache-claim check (re-homed from the model-step suite)", () => {
  test("a large cacheRead confirms, a whole-prefix cacheWrite contradicts, inconclusive tokens say nothing", () => {
    const router = services().router
    router.awaitCacheClaim("k3", 60_000)
    expect(router.observeCacheClaim("k3", { cacheRead: 50_000, cacheWrite: 1_000 })).toBe("confirmed")
    // The claim is consumed by its first step-finish; re-arming re-checks.
    expect(router.observeCacheClaim("k3", { cacheRead: 0, cacheWrite: 0 })).toBeUndefined()
    router.awaitCacheClaim("k3", 60_000)
    expect(router.observeCacheClaim("k3", { cacheRead: 0, cacheWrite: 55_000 })).toBe("contradiction")
    router.awaitCacheClaim("k3", 60_000)
    expect(router.observeCacheClaim("k3", { cacheRead: 100, cacheWrite: 2_000 })).toBeUndefined()
    // A zero figure at the step-up (nothing measured) is never judged.
    router.awaitCacheClaim("k3", 0)
    expect(router.observeCacheClaim("k3", { cacheRead: 0, cacheWrite: 0 })).toBeUndefined()
  })

  test("the contradiction line is noted once per entry", () => {
    const router = services().router
    expect(router.noteClaimContradiction("k3")).toBe(true)
    expect(router.noteClaimContradiction("k3")).toBe(false)
    expect(router.noteClaimContradiction("other")).toBe(true)
  })
})
