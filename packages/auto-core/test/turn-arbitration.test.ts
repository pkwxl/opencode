// The arbitration table and the fx audit (plans/0061 §4.4/§4.5): the table's
// well-formedness rules (every input kind has a row, every concern appears in
// some row, the synthetic-input rows are the concurrent ones), the audit
// invariants firing as programming errors — a kernel fx after a steer in the
// same idle quiet point, a second steer there, anything but log/vlog from a
// synthetic input, a cross-slice write under frozen views — and the remainder
// layer's owned-slice set over the real install (plans/0061 §4.11: exactly
// the not-yet-extracted slices, shrinking per extraction unit, none at the
// layer's removal) plus the input kinds it still serves.
// The spine is driven with fake concerns over a fake TurnFx and a stub stream
// — everything a turn needs arrives as runTurn's arguments.
import { describe, expect, test } from "bun:test"
import type { AgentEvent } from "../src/agent/types"
import type { Advice, Concern, SliceKey, TurnContext, TurnFx, TurnState } from "../src/engine/contract"
import { makeLivenessConcern } from "../src/engine/concerns/liveness"
import { makeRecoveryConcern } from "../src/engine/concerns/recovery"
import { runTurn, slicesDelegatedTo, SLICE_KEYS, TURN_ARBITRATION, type ConcernRoster, type TurnSources } from "../src/engine/spine"
import { createServices } from "../src/services"
import { parseSwitches } from "../src/switches"
import { usageSource } from "../src/usage"
import { HANDLER_KINDS, turnConcerns, type RemainderState } from "../src/watch"
import { ev, fakeAgent } from "./fixtures/agent"

const SESSION = "ses_1"

const INPUT_KINDS = ["limit", "part", "message", "question", "permission", "error", "retry", "idle", "stream-end", "probe", "answer"] as const

// The barest legal turn context: the fake concerns below read none of it (the
// spine itself reads only sessionID and source.observe).
const turnCtx = (): TurnContext => ({
  client: fakeAgent().client,
  sessionID: SESSION,
  opts: {},
  switches: parseSwitches({}),
  policy: { backoffCapMs: 60_000, silenceBudgetMs: 60_000, honorsRetryAfter: false, waitsOutLimit: false },
  classify: () => "unknown",
  source: usageSource("events"),
  services: createServices(),
  startTime: 0,
})

// A TurnFx double: every member resolves trivially and records its name, so a
// test can assert what a concern called.
const fakeFx = (): TurnFx & { calls: string[] } => {
  const calls: string[] = []
  const rec = (name: string): void => {
    calls.push(name)
  }
  return {
    calls,
    steer: async () => (rec("steer"), true),
    replyQuestion: async () => rec("replyQuestion"),
    rejectQuestion: async () => rec("rejectQuestion"),
    replyPermission: async () => rec("replyPermission"),
    abort: async () => rec("abort"),
    askHuman: async () => (rec("askHuman"), undefined),
    contextLimits: async () => (rec("contextLimits"), new Map()),
    readText: async () => (rec("readText"), ""),
    exists: async () => (rec("exists"), false),
    commitFreeze: async () => (rec("commitFreeze"), { type: "ok" as const }),
    runTest: async () => (rec("runTest"), { script: "t", code: 0, ms: 0, timedOut: false, out: "", seq: 1 }),
    resolveTest: async () => (rec("resolveTest"), undefined),
    saveHandover: async () => rec("saveHandover"),
    statsModelEvent: async () => rec("statsModelEvent"),
    onModel: () => rec("onModel"),
    onLimit: () => rec("onLimit"),
    log: () => rec("log"),
    vlog: () => rec("vlog"),
    now: () => (rec("now"), 0),
  }
}

const PASS = async (): Promise<Advice> => "pass"

// One stub concern per slice: the slice's initial value, a handler that
// passes unless the test overrides it.
const roster = (over: Partial<{ [K in SliceKey]: Concern<K>["handle"] }> = {}): ConcernRoster => ({
  guard: { name: "guard", initial: () => ({ idleHandled: false }), handle: over.guard ?? PASS },
  transcript: {
    name: "transcript",
    initial: () => ({ lastText: "", seen: new Set(), billed: new Set(), usage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 }, modelReported: false }),
    handle: over.transcript ?? PASS,
  },
  windows: { name: "windows", initial: () => ({}), handle: over.windows ?? PASS },
  stuck: { name: "stuck", initial: () => ({}), handle: over.stuck ?? PASS },
  questions: { name: "questions", initial: () => ({ autoAnswered: [], resolves: [] }), handle: over.questions ?? PASS },
  failure: { name: "failure", initial: () => ({ error: "", retrying: false }), handle: over.failure ?? PASS },
  recovery: { name: "recovery", initial: () => ({}), handle: over.recovery ?? PASS },
  liveness: { name: "liveness", initial: () => ({ probeFailures: 0, halfOpen: false, lengthContinued: 0 }), handle: over.liveness ?? PASS },
  usage: { name: "usage", initial: () => ({ pct: 0, used: 0, hinted: false, notes: new Set() }), handle: over.usage ?? PASS },
  stepUp: { name: "stepUp", initial: () => ({ step: 0 }), handle: over.stepUp ?? PASS },
  test: { name: "test", initial: () => ({ handover: false, asked: false, retried: false }), handle: over.test ?? PASS },
})

// The remainder install's roster shape (plans/0061 §4.11): every entry
// delegates to the one shared handle, except the slices already extracted.
const delegatedRoster = (handle: Concern<SliceKey>["handle"], extracted: SliceKey[] = []): ConcernRoster => {
  const base = roster()
  const entries = SLICE_KEYS.map((key) => [key, extracted.includes(key) ? base[key] : { ...base[key], handle }])
  return Object.fromEntries(entries) as ConcernRoster
}

const streamOf = (events: AgentEvent[]): AsyncIterable<AgentEvent> =>
  (async function* () {
    for (const event of events) yield event
  })()

const turn = (concerns: ConcernRoster, opts: { events?: AgentEvent[]; fx?: TurnFx; attach?: TurnSources; freezeViews?: boolean } = {}) =>
  runTurn({
    ctx: turnCtx(),
    stream: streamOf(opts.events ?? [ev.idle(SESSION)]),
    concerns,
    fx: opts.fx ?? fakeFx(),
    attach: opts.attach,
    freezeViews: opts.freezeViews,
  })

const isIdle = (input: Parameters<Concern<SliceKey>["handle"]>[0]): boolean => input.kind === "event" && input.event.type === "idle"

describe("the arbitration table", () => {
  test("every input kind has a row, and there are no others", () => {
    expect(Object.keys(TURN_ARBITRATION).sort()).toEqual([...INPUT_KINDS].sort())
    for (const kind of INPUT_KINDS) expect(Array.isArray(TURN_ARBITRATION[kind])).toBe(true)
  })

  test("every concern appears in some row", () => {
    const placed = new Set(Object.values(TURN_ARBITRATION).flatMap((row) => row.map((cell) => cell.concern)))
    expect([...placed].sort()).toEqual([...SLICE_KEYS].sort())
  })

  test("the synthetic-input rows are the concurrent ones: liveness for probes, recovery for answers", () => {
    expect(TURN_ARBITRATION.probe).toEqual([{ concern: "liveness", concurrent: true }])
    expect(TURN_ARBITRATION.answer).toEqual([{ concern: "recovery", concurrent: true }])
  })
})

describe("the fx audit", () => {
  test("(a) a kernel fx call after a steer in the same idle quiet point throws", async () => {
    const concerns = roster({
      test: async (input, _own, _view, fx) => {
        if (!isIdle(input)) return "pass"
        await fx.steer("continue")
        await fx.runTest()
        return "consumed"
      },
    })
    await expect(turn(concerns)).rejects.toThrow("turn engine audit: kernel fx.runTest after a steer in the same idle quiet point")
  })

  test("(b) a second steer in the same idle quiet point throws", async () => {
    const concerns = roster({
      test: async (input, _own, _view, fx) => {
        if (!isIdle(input)) return "pass"
        await fx.steer("one")
        await fx.steer("two")
        return "consumed"
      },
    })
    await expect(turn(concerns)).rejects.toThrow("turn engine audit: a second steer in the same idle quiet point")
  })

  test("the quiet point resets with the next idle input: a steer at one idle, a kernel call at the next, is legal", async () => {
    const fx = fakeFx()
    let first = true
    const concerns = roster({
      test: async (input, _own, _view, fx) => {
        if (!isIdle(input)) return "pass"
        if (first) {
          first = false
          await fx.steer("continue")
          return "consumed"
        }
        await fx.runTest()
        await fx.steer("results")
        return "consumed"
      },
    })
    await turn(concerns, { events: [ev.idle(SESSION), ev.idle(SESSION)], fx })
    expect(fx.calls).toEqual(["steer", "runTest", "steer"])
  })

  test("the quiet point is idle-only: two steers at one message input are legal (the measurement point)", async () => {
    const fx = fakeFx()
    const concerns = roster({
      usage: async (input, _own, _view, fx) => {
        if (input.kind === "event" && input.event.type === "message") await fx.steer("notice")
        return "pass"
      },
      stepUp: async (input, _own, _view, fx) => {
        if (input.kind === "event" && input.event.type === "message") await fx.steer("step up")
        return "pass"
      },
    })
    await turn(concerns, { events: [ev.message(SESSION, "msg_1"), ev.idle(SESSION)], fx })
    expect(fx.calls).toEqual(["steer", "steer"])
  })

  test("the steer-placement rule: a concern that steers before test at idle and lets the row run on must throw", async () => {
    const fx = fakeFx()
    const concerns = roster({
      // Deliberately wrong (plans/0061 §4.5): a concern that may steer at
      // idle is placed after test, or stops the input when it steers — this
      // one does neither.
      guard: async (input, _own, _view, fx) => {
        if (isIdle(input)) await fx.steer("too early")
        return "pass"
      },
      test: async (input, _own, _view, fx) => {
        if (!isIdle(input)) return "pass"
        await fx.runTest()
        return "consumed"
      },
    })
    await expect(turn(concerns, { fx })).rejects.toThrow("turn engine audit: kernel fx.runTest after a steer in the same idle quiet point")
  })

  test("(c) an fx call other than log/vlog from a synthetic input throws", async () => {
    let caught: string | undefined
    const concerns = roster({
      liveness: async (input, _own, _view, fx) => {
        if (input.kind !== "probe") return "pass"
        fx.log("probe verdict") // log and vlog are the only fx a synthetic handler may call
        fx.vlog("probe verdict")
        // The audit throw would reject the emission chain (an unhandled
        // rejection, as loud as the programming error it is); caught here to
        // assert the message.
        try {
          await fx.abort()
        } catch (e) {
          caught = (e as Error).message
        }
        return "pass"
      },
    })
    const attach: TurnSources = (emit) => {
      emit({ kind: "probe", ok: false, at: 0 })
    }
    await turn(concerns, { attach })
    await new Promise((resolve) => setTimeout(resolve, 0)) // flush the emission chain
    expect(caught).toBe("turn engine audit: fx.abort called while handling a synthetic input (only log/vlog are allowed there)")
  })

  test("(d) a write outside the handler's own slice throws under frozen views", async () => {
    const concerns = roster({
      guard: async (input, _own, view) => {
        if (isIdle(input)) {
          ;(view.transcript as { lastText: string }).lastText = "tampered"
          return "consumed"
        }
        return "pass"
      },
    })
    await expect(turn(concerns, { freezeViews: true })).rejects.toThrow(/read.?only/i)
  })

  test("(d) the handler's own slice stays writable through the view under frozen views", async () => {
    const concerns = roster({
      guard: async (input, own, view) => {
        if (isIdle(input)) {
          // The view's own slice is the live state object: the readonly is
          // type-level only for the other slices.
          ;(view.guard as { idleHandled: boolean }).idleHandled = true
          own.idleHandled = true
          return "consumed"
        }
        return "pass"
      },
    })
    const outcome = await turn(concerns, { freezeViews: true })
    expect(outcome.view.guard.idleHandled).toBe(true)
  })
})

describe("the queue discipline's terminal settles", () => {
  test("an idle whose row runs out settles naturally (the spine's own terminal)", async () => {
    const outcome = await turn(roster())
    expect(outcome.settle).toEqual({ kind: "natural" })
  })

  test("a consumed idle stops the input with no settle — the turn continues (today's steer-and-continue paths)", async () => {
    const outcome = await turn(roster({ guard: async () => "consumed" }))
    // The idle was consumed, so no natural settle; the stream then
    // exhausted without another idle: interrupted.
    expect(outcome.settle).toEqual({ kind: "interrupted" })
  })
})

describe("the remainder layer's owned slices", () => {
  // The not-yet-extracted slices' initial values, as the real install reads
  // them (turnConcerns hands the objects back through the roster's
  // initials). The recovery and liveness concerns are the real factories
  // over inert deps — the ratchet reads handle identity, which each
  // factory's own handle provides.
  const remainderState = (): RemainderState => ({
    usage: { pct: 0, used: 0, hinted: false, notes: new Set<number>() },
    stepUp: { step: 0 },
    test: { handover: false, asked: false, retried: false },
  })
  const recoveryConcern = (): Concern<"recovery"> => makeRecoveryConcern({ answerWith: () => {}, extended: {} })
  const livenessConcern = (): Concern<"liveness"> => makeLivenessConcern({ extended: {} })

  test("the install delegates exactly the not-yet-extracted slices to the one remainder handle (the shrink ratchet)", () => {
    // The real install (watch's turnConcerns): guard, transcript, windows,
    // stuck, questions, failure, recovery and liveness hold their own
    // concerns; the three not-yet-extracted slices share the one remainder
    // handle. Each extraction unit shrinks this list, and the layer's
    // removal empties it.
    const handle: Concern<SliceKey>["handle"] = async () => "consumed"
    expect(slicesDelegatedTo(turnConcerns(remainderState(), handle, recoveryConcern(), livenessConcern()), handle)).toEqual([
      "usage",
      "stepUp",
      "test",
    ])
  })

  test("the remainder serves exactly the input kinds whose row still holds a not-yet-extracted cell", () => {
    // HANDLER_KINDS is the remainder handler map's keys' runtime mirror (the
    // map itself is a watch() local — its handlers close over the turn's
    // state); pinned here against the table and the install's delegation set,
    // not a hand-written list — limit belongs to the windows concern alone,
    // question and permission to the questions concern, answer to the
    // recovery concern, probe to the liveness concern, stream-end to the
    // spine's own terminal. That the dispatch reaches each handler is pinned
    // by the turn-trace suite's roster case, which fires every arbitration
    // cell through watch's real install.
    const handle: Concern<SliceKey>["handle"] = async () => "consumed"
    const remainder = new Set(slicesDelegatedTo(turnConcerns(remainderState(), handle, recoveryConcern(), livenessConcern()), handle))
    // The cast is the assertion's own claim: the table-derived kinds are the
    // kinds the remainder serves (the equality below checks it at runtime).
    const served = INPUT_KINDS.filter((kind) => TURN_ARBITRATION[kind].some((cell) => remainder.has(cell.concern))) as (typeof HANDLER_KINDS)[number][]
    expect([...HANDLER_KINDS].sort()).toEqual([...served].sort())
    expect(new Set(HANDLER_KINDS).size).toBe(HANDLER_KINDS.length)
  })

  test("extraction shrinks the delegated set monotonically to none (the removal check's endpoint run backwards)", () => {
    const handle: Concern<SliceKey>["handle"] = async () => "consumed"
    const one = delegatedRoster(handle, ["test"])
    expect(slicesDelegatedTo(one, handle)).toEqual(SLICE_KEYS.filter((key) => key !== "test"))
    const all = delegatedRoster(handle, [...SLICE_KEYS])
    expect(slicesDelegatedTo(all, handle)).toEqual([])
  })

  test("a finalize function shared across the delegated entries runs once (the remainder close-out's single execution)", async () => {
    let runs = 0
    const handle: Concern<SliceKey>["handle"] = async () => "consumed"
    const finalize = (async () => {
      runs += 1
    }) as Concern<SliceKey>["finalize"]
    const base = delegatedRoster(handle)
    const install = Object.fromEntries(SLICE_KEYS.map((key) => [key, { ...base[key], finalize }])) as ConcernRoster
    await turn(install)
    expect(runs).toBe(1)
  })

  test("the finalize procedure runs each concern's finalize at its first cell's position — liveness (part row) before recovery (retry row)", async () => {
    // The order the settle procedure's steps rest on: the interrupted
    // close-out (liveness) extends the failure record before the recovery
    // concern's final classification reads it, which first-cell order gives
    // because liveness first appears in the part row and recovery in the
    // retry row. Each finalize also receives the settle that ended the turn.
    const order: string[] = []
    const settles: unknown[] = []
    const base = roster()
    const install: ConcernRoster = {
      ...base,
      liveness: {
        ...base.liveness,
        finalize: async (settle) => {
          settles.push(settle)
          order.push("liveness")
        },
      },
      recovery: {
        ...base.recovery,
        finalize: async (settle) => {
          settles.push(settle)
          order.push("recovery")
        },
      },
    }
    const outcome = await turn(install)
    expect(order).toEqual(["liveness", "recovery"])
    expect(settles).toEqual([outcome.settle, outcome.settle])
  })
})
