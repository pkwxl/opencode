// The liveness concern's suite (plans/0061 §4.6: a concern suite over a fake
// TurnFx): the probe verdicts (the count, the reset on a recovered probe, the
// quiet-window exemption, the half-open judgment and its settle), the part
// cell (output ends an announced silence, a step-finish records its reason
// and resets the truncation count), the retry cell (the announced silence:
// the ⏳ line, the window, the re-announcement dedup), the idle cell (the
// truncated-output continuation: the steer, the cap, the failed-dispatch
// block, the gates that bar it) and the finalize (the interrupted close-out:
// the abort, the half-open vs stream-interruption message, the extended
// failure record). The probe's transport (probeSession over the client) is
// the sources' and the oracle's (test/turn-trace.test.ts's probe family,
// byte-pinned through watch's real install); the attempt-level exits the old
// probe suite drove (the blocked wrap, the errorClass, the abort at the
// client) are pinned by the incident suite's I1 and the trace goldens.
import { describe, expect, test } from "bun:test"
import type { AgentClient, AgentEvent, AgentRetryPolicy } from "../src/agent/types"
import type { Advice, Settle, TurnInput, TurnState } from "../src/engine/contract"
import { makeLivenessConcern, type LivenessDeps } from "../src/engine/concerns/liveness"
import { fakeTurnFx, turnContext, viewOver } from "./fixtures/turn"
import { ev, fakeAgent } from "./fixtures/agent"

const SESSION = "ses_1"
const HALF_OPEN_MSG =
  "connectivity probe failed 2 consecutive times; connection judged half-open (server unresponsive or network down, half-open network timeout)"
const STREAM_END_MSG = "event stream interrupted (no session-end event received; suspected server failure or network down)"
// The retry policy that honours Retry-After (plans/0057 §4) — the announced
// silence's gate.
const HONORS: AgentRetryPolicy = { backoffCapMs: 60_000, silenceBudgetMs: 60_000, honorsRetryAfter: true, waitsOutLimit: false }

// One concern instance per case, driven one input at a time over a recording
// fx. `own` is planted directly where a case needs prior state (a count, a
// window, a finish reason); the fake fx answers now() = 0, so the announced
// window's end and the ISO instants of the lines are fixed values.
const setup = (over: { policy?: AgentRetryPolicy; client?: AgentClient } = {}) => {
  const deps: LivenessDeps = { extended: {} }
  const concern = makeLivenessConcern(deps)
  const ctx = turnContext({
    ...(over.policy !== undefined ? { policy: over.policy } : {}),
    ...(over.client !== undefined ? { client: over.client } : {}),
  })
  const own = concern.initial(ctx)
  const fx = fakeTurnFx()
  const drive = (input: TurnInput, view: Partial<TurnState> = {}, useFx = fx): Promise<Advice> =>
    concern.handle(input, own, viewOver(view), useFx, ctx)
  const finalize = async (settle: Settle, view: Partial<TurnState> = {}): Promise<ReturnType<typeof fakeTurnFx>> => {
    const useFx = fakeTurnFx()
    await concern.finalize!(settle, own, viewOver(view), useFx, ctx)
    return useFx
  }
  return { concern, ctx, own, deps, fx, drive, finalize }
}

const probeInput = (ok: boolean, at: number): TurnInput => ({ kind: "probe", ok, at })
const retryInput = (next?: number, over: { attempt?: number } = {}): TurnInput => ({
  kind: "event",
  event: {
    type: "retry",
    session: SESSION,
    error: { message: "service unavailable" },
    ...(over.attempt !== undefined ? { attempt: over.attempt } : {}),
    ...(next !== undefined ? { next } : {}),
  } as AgentEvent,
})
const idleInput = (): TurnInput => ({ kind: "event", event: { type: "idle", session: SESSION } as AgentEvent })
const stepStart = (): AgentEvent => ({ type: "part", session: SESSION, part: { kind: "step-start", id: "pt_start" } })
const failureView = (error = ""): Partial<TurnState> => ({ failure: { error, retrying: false } })

describe("the liveness concern (probe: the verdicts of the concurrent row)", () => {
  test("a successful probe resets the failure count and stays quiet", async () => {
    const { own, fx, drive } = setup()
    own.probeFailures = 1
    await expect(drive(probeInput(true, 0))).resolves.toBe("consumed")
    expect(own.probeFailures).toBe(0)
    expect(fx.calls).toEqual([])
  })

  test("a failed probe counts toward the threshold with the ⚠ line", async () => {
    const { own, fx, drive } = setup()
    await expect(drive(probeInput(false, 0))).resolves.toBe("consumed")
    expect(own.probeFailures).toBe(1)
    expect(fx.calls).toEqual(["log"])
    expect(fx.lines).toEqual([`⚠ connectivity probe failure 1/2 (session ${SESSION}); connection suspected half-open`])
  })

  test("two consecutive failures judge the connection half-open and settle the turn interrupted (re-homed from the probe suite: the half-open judgment)", async () => {
    const { own, fx, drive } = setup()
    await expect(drive(probeInput(false, 0))).resolves.toBe("consumed")
    await expect(drive(probeInput(false, 0))).resolves.toEqual({ settle: { kind: "interrupted" } })
    expect(own.halfOpen).toBe(true)
    expect(fx.lines).toEqual([
      `⚠ connectivity probe failure 1/2 (session ${SESSION}); connection suspected half-open`,
      `⚠ connectivity probe failure 2/2 (session ${SESSION}); connection suspected half-open`,
    ])
  })

  test("a verdict landing after the judgment changes nothing (re-homed from the probe suite: recovery never aborts twice)", async () => {
    const { own, fx, drive } = setup()
    await drive(probeInput(false, 0))
    await drive(probeInput(false, 0))
    await expect(drive(probeInput(false, 0))).resolves.toBe("consumed")
    expect(own.probeFailures).toBe(2)
    expect(fx.lines).toHaveLength(2)
  })

  test("the quiet-window exemption: a failure inside the agent's announced wait is not counted, the line names the end it waits for", async () => {
    const { own, fx, drive } = setup()
    own.quietUntil = 10_000
    await expect(drive(probeInput(false, 5_000))).resolves.toBe("consumed")
    expect(own.probeFailures).toBe(0)
    expect(fx.lines).toEqual([
      `⚠ connectivity probe failed (session ${SESSION}) inside the agent's announced wait; not counted before 1970-01-01T00:00:10.000Z`,
    ])
  })

  test("at and past the announced end the probe counts again", async () => {
    const atTheEnd = setup()
    atTheEnd.own.quietUntil = 10_000
    await expect(atTheEnd.drive(probeInput(false, 10_000))).resolves.toBe("consumed")
    expect(atTheEnd.own.probeFailures).toBe(1)
    const pastTheEnd = setup()
    pastTheEnd.own.quietUntil = 10_000
    pastTheEnd.own.probeFailures = 1
    await expect(pastTheEnd.drive(probeInput(false, 10_001))).resolves.toEqual({ settle: { kind: "interrupted" } })
    expect(pastTheEnd.own.probeFailures).toBe(2)
  })
})

describe("the liveness concern (part: the silence's end and the finish reason)", () => {
  test("model output ends the announced silence; a step-start alone does not", async () => {
    const { own, drive } = setup()
    own.quietUntil = 10_000
    await expect(drive({ kind: "event", event: ev.text(SESSION, "pt_1", "the agent speaks again") })).resolves.toBe("pass")
    expect(own.quietUntil).toBeUndefined()
    own.quietUntil = 10_000
    await expect(drive({ kind: "event", event: stepStart() })).resolves.toBe("pass")
    expect(own.quietUntil).toBe(10_000)
  })

  test("a step-finish records its reason; a finish other than length resets the consecutive-truncation count", async () => {
    const { own, drive } = setup()
    own.lengthContinued = 2
    await expect(drive({ kind: "event", event: ev.step(SESSION, "stp_1", "stop") })).resolves.toBe("pass")
    expect(own.lastFinish).toBe("stop")
    expect(own.lengthContinued).toBe(0)
    own.lengthContinued = 1
    await expect(drive({ kind: "event", event: ev.step(SESSION, "stp_2", "length") })).resolves.toBe("pass")
    expect(own.lastFinish).toBe("length")
    expect(own.lengthContinued).toBe(1)
  })
})

describe("the liveness concern (retry: the announced silence)", () => {
  test("a wait beyond the agent's silence budget is announced: the ⏳ line names its end, and the window opens", async () => {
    const { own, fx, drive } = setup({ policy: HONORS })
    await expect(drive(retryInput(300_000, { attempt: 2 }))).resolves.toBe("pass")
    expect(own.quietUntil).toBe(300_000)
    expect(fx.lines).toEqual([`⏳ the agent waits 5m 0s before retrying (attempt 2) (session ${SESSION}); no events are expected until 1970-01-01T00:05:00.000Z`])
  })

  test("a re-announced wait within a second of the current window's end prints nothing; a later one re-announces", async () => {
    const { own, fx, drive } = setup({ policy: HONORS })
    await drive(retryInput(300_000))
    expect(fx.lines).toHaveLength(1)
    await expect(drive(retryInput(300_500))).resolves.toBe("pass")
    expect(own.quietUntil).toBe(300_500)
    expect(fx.lines).toHaveLength(1)
    await expect(drive(retryInput(400_000))).resolves.toBe("pass")
    expect(own.quietUntil).toBe(400_000)
    expect(fx.lines).toHaveLength(2)
  })

  test("a wait inside the budget, an agent that ignores Retry-After, or a retry without a wait: no announcement", async () => {
    const deaf = setup()
    await expect(deaf.drive(retryInput(300_000))).resolves.toBe("pass")
    expect(deaf.own.quietUntil).toBeUndefined()
    expect(deaf.fx.lines).toEqual([])
    const short = setup({ policy: HONORS })
    await expect(short.drive(retryInput(30_000))).resolves.toBe("pass")
    expect(short.own.quietUntil).toBeUndefined()
    expect(short.fx.lines).toEqual([])
    const waitless = setup({ policy: HONORS })
    await expect(waitless.drive(retryInput())).resolves.toBe("pass")
    expect(waitless.own.quietUntil).toBeUndefined()
    expect(waitless.fx.lines).toEqual([])
  })
})

describe("the liveness concern (idle: the truncated-output continuation)", () => {
  test("a length finish with no session error steers the continuation (re-homed from the probe-era suite: the resume steer)", async () => {
    const { own, fx, drive } = setup()
    own.lastFinish = "length"
    await expect(drive(idleInput(), failureView())).resolves.toBe("consumed")
    expect(own.lengthContinued).toBe(1)
    // The criterion is cleared with the steer: an idle without a new
    // step-finish cannot repeat the continuation against a stale reason.
    expect(own.lastFinish).toBeUndefined()
    expect(fx.calls).toEqual(["log", "statsModelEvent", "steer"])
    expect(fx.lines).toEqual(["⚠ session reply truncated by the output length limit (step-finish reason=length); prompting it to continue from the cut-off point (1/3)"])
    expect(fx.steers).toEqual([
      "[DRIVER] Your previous reply was cut off by the output length limit; continue the unfinished work from the cut-off point " +
        "(do not redo what is finished; split long output into several steps / tool calls so you don't hit the limit again).",
    ])
    await expect(drive(idleInput(), failureView())).resolves.toBe("pass")
    expect(fx.steers).toHaveLength(1)
  })

  test("a failed continuation dispatch settles blocked with the steer-failure question", async () => {
    const { own, drive, fx } = setup()
    own.lastFinish = "length"
    const failing = fakeTurnFx({ steerOk: false })
    await expect(drive(idleInput(), failureView(), failing)).resolves.toEqual({
      settle: { kind: "blocked", question: "steer dispatch failed (length-continuation hint); cannot continue the session, see the log." },
    })
    expect(fx.calls).toEqual([])
  })

  test("the cap: the third consecutive truncation is the last continuation, past it the idle passes on (the spine's terminal settles natural)", async () => {
    const { own, fx, drive } = setup()
    own.lastFinish = "length"
    own.lengthContinued = 2
    await expect(drive(idleInput(), failureView())).resolves.toBe("consumed")
    expect(own.lengthContinued).toBe(3)
    own.lastFinish = "length"
    await expect(drive(idleInput(), failureView())).resolves.toBe("pass")
    expect(fx.steers).toHaveLength(1)
  })

  test("no continuation without a length finish, with a session error observed, or without the steer capability", async () => {
    const plain = setup()
    plain.own.lastFinish = "stop"
    await expect(plain.drive(idleInput(), failureView())).resolves.toBe("pass")
    const errored = setup()
    errored.own.lastFinish = "length"
    await expect(errored.drive(idleInput(), failureView("internal server error"))).resolves.toBe("pass")
    const steerless = setup({ client: fakeAgent({ capabilities: { steer: false } }).client })
    steerless.own.lastFinish = "length"
    await expect(steerless.drive(idleInput(), failureView())).resolves.toBe("pass")
    expect(plain.fx.steers).toEqual([])
    expect(errored.fx.steers).toEqual([])
    expect(steerless.fx.steers).toEqual([])
  })

  test("inputs outside the cells pass through", async () => {
    const { own, drive } = setup()
    await expect(drive({ kind: "event", event: ev.message(SESSION, "msg_1", 1000) })).resolves.toBe("pass")
    await expect(drive({ kind: "answer", answer: undefined })).resolves.toBe("pass")
    await expect(drive({ kind: "stream-end" })).resolves.toBe("pass")
    expect(own).toEqual({ probeFailures: 0, halfOpen: false, lengthContinued: 0 })
  })
})

describe("the liveness concern (finalize: the interrupted close-out)", () => {
  test("a half-open close-out aborts the orphan turn and extends the record with the half-open message (re-homed from the probe suite)", async () => {
    const { own, deps, drive, finalize } = setup()
    await drive(probeInput(false, 0))
    await drive(probeInput(false, 0))
    const out = await finalize({ kind: "interrupted" }, failureView())
    expect(out.calls).toEqual(["abort"])
    expect(deps.extended.error).toBe(HALF_OPEN_MSG)
    // No failure info stood: the message becomes the record's message, the
    // grounds the final classification reads (the patterns file it as
    // transient on the network/timeout wording).
    expect(deps.extended.info).toEqual({ message: HALF_OPEN_MSG })
    expect(own.halfOpen).toBe(true)
  })

  test("a prior failure record is extended, not replaced", async () => {
    const { own, deps, finalize } = setup()
    own.halfOpen = true
    const prior = { error: "earlier session error", retrying: false, info: { message: "earlier session error", statusCode: 500 } }
    const out = await finalize({ kind: "interrupted" }, { failure: prior })
    expect(out.calls).toEqual(["abort"])
    expect(deps.extended.error).toBe(`earlier session error\n${HALF_OPEN_MSG}`)
    expect(deps.extended.info).toEqual({ ...prior.info, message: `earlier session error\n${HALF_OPEN_MSG}` })
  })

  test("a bare stream interruption keeps the failure info as it stands", async () => {
    const bare = setup()
    const out = await bare.finalize({ kind: "interrupted" }, failureView())
    expect(out.calls).toEqual(["abort"])
    expect(bare.deps.extended.error).toBe(STREAM_END_MSG)
    expect(bare.deps.extended.info).toBeUndefined()
    const withInfo = setup()
    await withInfo.finalize({ kind: "interrupted" }, { failure: { error: "", retrying: false, info: { message: "earlier session error" } } })
    expect(withInfo.deps.extended.info).toEqual({ message: "earlier session error" })
  })

  test("every other settle runs nothing: no abort, no extension", async () => {
    for (const settle of [{ kind: "natural" } as Settle, { kind: "blocked", question: "q" } as Settle, { kind: "error", cls: "quota", classified: false } as Settle]) {
      const { deps, finalize } = setup()
      const out = await finalize(settle, failureView())
      expect(out.calls).toEqual([])
      expect(deps.extended.error).toBeUndefined()
      expect(deps.extended.info).toBeUndefined()
    }
  })
})
