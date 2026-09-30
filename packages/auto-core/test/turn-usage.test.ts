// The usage concern's suite (plans/0061 §4.6: a concern suite over a fake
// TurnFx): the message row's measurement cell — the measurement itself (the
// figure off the usage source, the window off fx.contextLimits, the vlog
// line, the no-model and unknown-model window rules, the unknown figure
// consuming the row), the hard wall (the one hint steer, the bands spent
// with it, the wall owning the measurement point so the row stops before
// the stepUp cell, the once-only latch, the failed dispatch's blocked
// settle), the milestone notices (the highest newly crossed band, the
// figure slots filled at send time, the failed dispatch's blocked settle)
// and the non-live tiers. The steerWall and fillUsageNote tables at the
// bottom are re-homed from the testrun module's suite
// (test/testrun.test.ts): their functions' only consumer is this concern.
// The dual-steer measurement point (a notice, then a step-up in one
// breath) and the end-to-end wall/notice exits are the trace oracle's
// (test/turn-trace.test.ts's message family, byte-pinned through watch's
// real install).
import { describe, expect, test } from "bun:test"
import type { AgentEvent, UsageTier } from "../src/agent/types"
import type { Advice, TurnInput, TurnState } from "../src/engine/contract"
import { usageConcern } from "../src/engine/concerns/usage"
import { steerWall, fillUsageNote, type Steer } from "../src/testrun"
import { usageSource, type UsageSource } from "../src/usage"
import { fakeTurnFx, turnContext, viewOver } from "./fixtures/turn"
import { ev, fakeAgent } from "./fixtures/agent"

const SESSION = "ses_1"
// The fake agent's own model id, the default of ev.message's messages.
const MODEL = "fake/model-1"

// The windows the fx double answers: the fake model on 100k, a second known
// id on 200k.
const LIMITS = new Map([
  [MODEL, 100_000],
  ["prov/other", 200_000],
])

// The ondemand handover steer of the wall/notice cases: a 2×64k budget
// against the 100.0k window gives the 80.0k effective wall (steerWall
// clamps the budget to 80% of the window), so the 0.5 band sits at 40.0k
// and the 0.85 band at 68.0k — the figures of the trace oracle's message
// family, with the literal slots fillUsageNote resolves at send time.
const usageSteer = (over: Partial<Steer> = {}): Steer => ({
  limit: 128_000,
  text: "[DRIVER] wall hint: write the handover document",
  notes: [
    { at: 0.5, text: "note-info used={{used}} pct={{pct}} wall={{wall}}" },
    { at: 0.85, text: "note-winddown used={{used}} pct={{pct}} wall={{wall}}" },
  ],
  ...over,
})

// One concern instance per case, driven one input at a time over a
// recording fx. The measurement events go through the source first (the
// spine observes every event of the session before the row runs), so a
// case's figure is the one the source would hold; the client carries the
// same tier the source is built from (watch builds one off the other, and
// the wall's live-figure rule reads the client's).
const setup = (over: { steer?: Steer; tier?: UsageTier } = {}) => {
  const tier = over.tier ?? "events"
  const source: UsageSource = usageSource(tier)
  const ctx = turnContext({
    source,
    client: fakeAgent({ capabilities: { usage: tier } }).client,
    ...(over.steer !== undefined ? { steer: over.steer } : {}),
  })
  const own = usageConcern.initial(ctx)
  const fx = fakeTurnFx({ limits: LIMITS })
  const drive = (input: TurnInput, view: Partial<TurnState> = {}, useFx = fx): Promise<Advice> =>
    usageConcern.handle(input, own, viewOver(view), useFx, ctx)
  // A measurement-point input: a completed assistant message whose figure
  // the source has taken in.
  const measure = (used: number | undefined, model?: string, useFx = fx): Promise<Advice> => {
    const event = ev.message(SESSION, `m_${used ?? "none"}_${model ?? "none"}`, used, model !== undefined ? { model } : undefined)
    source.observe(event)
    return drive({ kind: "event", event }, {}, useFx)
  }
  return { ctx, own, fx, drive, measure }
}

const partInput = (): TurnInput => ({ kind: "event", event: ev.text(SESSION, "t1", "a part") as AgentEvent })
const errorInput = (): TurnInput => ({ kind: "event", event: ev.error(SESSION, { message: "boom" }) as AgentEvent })
const retryInput = (): TurnInput => ({ kind: "event", event: { type: "retry", session: SESSION, error: { message: "boom" } } as AgentEvent })
const idleInput = (): TurnInput => ({ kind: "event", event: ev.idle(SESSION) as AgentEvent })

describe("the usage concern (message: the measurement)", () => {
  test("a message naming a model with a known window measures used/limit/pct and vlogs the line, fetching the limits once", async () => {
    const { own, fx, measure } = setup()
    await expect(measure(60_000, MODEL)).resolves.toBe("pass")
    expect(own).toEqual({ pct: 60, used: 60_000, limit: 100_000, hinted: false, notes: new Set<number>() })
    expect(fx.calls).toEqual(["contextLimits", "vlog"])
    expect(fx.vlogs).toEqual(["  context: 60.0k/100.0k tokens (60%)"])
    // No ondemand steer: the wall and the bands are not even computed, and
    // the row passes on to the stepUp cell.
    expect(fx.steers).toEqual([])
  })

  test("a message naming an unknown model id loses the window: limit undefined, pct records 100, the line carries no /… and no (%)", async () => {
    const { own, fx, measure } = setup()
    await expect(measure(2000, "prov/unknown")).resolves.toBe("pass")
    expect(own).toEqual({ pct: 100, used: 2000, limit: undefined, hinted: false, notes: new Set<number>() })
    expect(fx.vlogs).toEqual(["  context: 2000 tokens"])
  })

  test("a message naming no model at all runs under the window already in effect", async () => {
    const { own, fx, measure } = setup()
    await measure(1000, MODEL)
    await expect(measure(2000, undefined)).resolves.toBe("pass")
    expect(own.limit).toBe(100_000)
    expect(own.pct).toBe(2)
    expect(fx.vlogs).toEqual(["  context: 1000/100.0k tokens (1%)", "  context: 2000/100.0k tokens (2%)"])
  })

  test("an unknown figure (none measured yet) changes nothing: consumed, no fetch, no line — the row stops before the stepUp cell", async () => {
    const { own, fx, measure } = setup()
    await expect(measure(undefined, MODEL)).resolves.toBe("consumed")
    expect(own).toEqual({ pct: 100, used: 0, hinted: false, notes: new Set<number>() })
    expect(fx.calls).toEqual([])
  })

  test("inputs outside the message row pass through untouched", async () => {
    const { own, drive } = setup()
    for (const input of [partInput(), errorInput(), retryInput(), idleInput(), { kind: "stream-end" } as TurnInput, { kind: "probe", ok: true, at: 0 } as TurnInput, { kind: "answer", answer: undefined } as TurnInput]) {
      await expect(drive(input)).resolves.toBe("pass")
    }
    expect(own).toEqual({ pct: 100, used: 0, hinted: false, notes: new Set<number>() })
  })
})

describe("the usage concern (message: the hard wall)", () => {
  test("a measurement at the wall steers the handover hint once, spends every band with it and owns the measurement point (the row stops; the stepUp cell never runs)", async () => {
    const { own, fx, measure } = setup({ steer: usageSteer() })
    await expect(measure(80_000, MODEL)).resolves.toBe("consumed")
    expect(own.hinted).toBe(true)
    expect(own.wall).toBe(80_000)
    expect([...own.notes].sort()).toEqual([0.5, 0.85])
    expect(fx.lines).toEqual(["⚠ context used 80.0k tokens reached the wall 80.0k; inserting the handover hint"])
    expect(fx.steers).toEqual(["[DRIVER] wall hint: write the handover document"])
  })

  test("the wall steer's failed dispatch settles blocked with the fixed question, the hint still recorded as sent", async () => {
    const { own, fx, measure } = setup({ steer: usageSteer() })
    const failing = fakeTurnFx({ steerOk: false, limits: LIMITS })
    await expect(measure(80_000, MODEL, failing)).resolves.toEqual({
      settle: { kind: "blocked", question: "steer dispatch failed (handover hint); cannot continue the session, see the log." },
    })
    expect(own.hinted).toBe(true)
    expect(fx.calls).toEqual([])
  })

  test("the wall fires only once: a later measurement past the wall sends nothing again and passes the row on", async () => {
    const { own, fx, measure } = setup({ steer: usageSteer() })
    await measure(80_000, MODEL)
    await expect(measure(90_000, MODEL)).resolves.toBe("pass")
    expect(fx.steers).toHaveLength(1)
    expect(own.wall).toBe(80_000)
  })

  test("a jump crossing the wall and both bands sends only the wall steer (the wall supersedes the bands)", async () => {
    const { own, fx, measure } = setup({ steer: usageSteer() })
    await measure(30_000, MODEL)
    await expect(measure(90_000, MODEL)).resolves.toBe("consumed")
    expect(fx.steers).toEqual(["[DRIVER] wall hint: write the handover document"])
    expect([...own.notes].sort()).toEqual([0.5, 0.85])
  })

  test("a non-live tier never hits the wall however far past it (the wall needs a live figure; the notices still steer on the turn-end figure)", async () => {
    // A reported tier learns the figure only at turn end (plans/0038), so
    // the wall's in-turn trigger is off — the bands are not tier-gated, and
    // the turn-end figure is a figure: the highest crossed band steers.
    const { own, fx, measure } = setup({ steer: usageSteer(), tier: "reported" })
    await expect(measure(200_000, MODEL)).resolves.toBe("pass")
    expect(own.hinted).toBe(false)
    expect(own.wall).toBe(80_000)
    expect(fx.steers).toEqual(["note-winddown used=200.0k pct=250 wall=80.0k"])
  })

  test("an unknown window keeps the 2×cap budget as the wall (no clamp without a figure to clamp to)", async () => {
    const { own, fx, measure } = setup({ steer: usageSteer() })
    await measure(2000, "prov/unknown")
    expect(own.wall).toBe(128_000)
    // Below the budget and below every band: nothing fired.
    expect(fx.steers).toEqual([])
  })
})

describe("the usage concern (message: the milestone notices)", () => {
  test("crossing the first band steers its notice with the figure slots filled at send time, and the row passes on (notices do not suppress the stepUp cell)", async () => {
    const { own, fx, measure } = setup({ steer: usageSteer() })
    await measure(30_000, MODEL)
    await expect(measure(50_000, MODEL)).resolves.toBe("pass")
    expect([...own.notes]).toEqual([0.5])
    expect(fx.lines).toEqual(["• context used 50.0k tokens (63% of the wall 80.0k); steering a usage notice"])
    expect(fx.steers).toEqual(["note-info used=50.0k pct=63 wall=80.0k"])
  })

  test("a jump crossing two bands sends only the highest; the lower counts as spent with it", async () => {
    const { own, fx, measure } = setup({ steer: usageSteer() })
    await measure(30_000, MODEL)
    await expect(measure(70_000, MODEL)).resolves.toBe("pass")
    expect(fx.steers).toEqual(["note-winddown used=70.0k pct=88 wall=80.0k"])
    expect([...own.notes].sort()).toEqual([0.5, 0.85])
    // A later measurement between the spent bands sends nothing.
    await expect(measure(75_000, MODEL)).resolves.toBe("pass")
    expect(fx.steers).toHaveLength(1)
  })

  test("the notice steer's failed dispatch settles blocked with the fixed question", async () => {
    const { own, fx, measure } = setup({ steer: usageSteer() })
    const failing = fakeTurnFx({ steerOk: false, limits: LIMITS })
    await expect(measure(45_000, MODEL, failing)).resolves.toEqual({
      settle: { kind: "blocked", question: "steer dispatch failed (usage notice); cannot continue the session, see the log." },
    })
    expect(own.hinted).toBe(false)
    expect(fx.calls).toEqual([])
  })

  test("below every band a measurement sends nothing", async () => {
    const { fx, measure } = setup({ steer: usageSteer() })
    await expect(measure(39_999, MODEL)).resolves.toBe("pass")
    expect(fx.steers).toEqual([])
  })
})

// The wall and the note-text policies, re-homed from test/testrun.test.ts
// when the concern was extracted: testrun.ts holds the construction, the
// concern holds every call site. handoffSteer itself (the steer's
// construction from the task) is execute's, and stays there.
describe("the usage concern's policies (re-homed from the testrun suite)", () => {
  test("steerWall: the budget clamped to 80% of the window when that is smaller; an unknown window keeps the budget", () => {
    expect(steerWall(128_000, undefined)).toBe(128_000)
    expect(steerWall(128_000, 200_000)).toBe(128_000)
    expect(steerWall(128_000, 100_000)).toBe(80_000)
  })

  // min(max(2×cap, window/4), 80% of the window) (plans/0059 D6).
  test("steerWall: a large window raises the wall to a quarter of it; up to 512k at the default cap nothing changes", () => {
    // The default cap (64k → a 128k budget) over the windows in use.
    const table: [number, number][] = [
      [100_000, 80_000],
      [128_000, 102_400],
      [200_000, 128_000],
      [512_000, 128_000],
      [1_000_000, 250_000],
      [2_000_000, 500_000],
    ]
    for (const [window, wall] of table) expect(steerWall(128_000, window)).toBe(wall)
    // The floor lifts a small budget on any window it undercuts; the ceiling
    // still wins over both.
    expect(steerWall(64_000, 400_000)).toBe(100_000)
    expect(steerWall(500, 100_000)).toBe(25_000)
    expect(steerWall(2_000_000, 1_000_000)).toBe(800_000)
    // A budget above the floor is kept as it is.
    expect(steerWall(300_000, 1_000_000)).toBe(300_000)
    // An unknown window: the budget, whatever its size.
    expect(steerWall(500, undefined)).toBe(500)
  })

  test("fillUsageNote: the figure slots become the formatted figures", () => {
    const text = fillUsageNote("[DRIVER] context: {{used}} — {{pct}}% of the budget (wall {{wall}})", 60_000, 80_000)
    expect(text).toBe("[DRIVER] context: 60.0k — 75% of the budget (wall 80.0k)")
  })
})
