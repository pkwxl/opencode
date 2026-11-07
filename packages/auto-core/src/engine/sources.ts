// The turn's synthetic-input sources (plans/0061 §4.2/§4.4 — the single-queue
// requirement): the two producers that feed the spine queue's synthetic
// inputs, built once per turn from the turn's context. Both sources only
// emit; every decision about an emission — the probe verdict's counting,
// quiet-window exemption and half-open judgment, the answer's class raising —
// is the handling concern's, reachable through the arbitration table's
// concurrent rows even while an fx call is in flight.
//
// - The probe timer (the liveness probe's machinery, formerly watch's
//   scheduleProbe): every idleMs (ten minutes by default) a probeSession call
//   on its independent short-timeout connection, the verdict emitted as a
//   `{ kind: "probe", ok, streamAlive, at }` input, `at` stamped at the
//   verdict's arrival off the services clock. The `ok` leg is the fresh
//   connection's (0026 D3's original question — does the server answer); the
//   `streamAlive` leg (plans/0187 D1) is the turn's own stream's — the pulse
//   wrapper below stamps every delivery (a heartbeat or any event), and under
//   a declared pulse capability and an interval at least three beats wide the
//   tick asks whether anything arrived within the interval less one beat's
//   grace: a live stream beats unconditionally (the server ticks the
//   heartbeat whatever the agent is doing), so silence that long on an
//   answering server is the half-open shape 0026 §1.3 measured. Without the
//   capability, or on a narrower interval, the leg is undefined and the
//   verdict is today's fresh-connection-only one. The timer re-arms only
//   after a verdict was emitted, so at most one probe is in flight; the
//   cleanup the wrapper's finally runs stops it for good (the old
//   probeActive/cancelProbe pair — a late resolution of an in-flight probe
//   emits, the spine's emit drops it, and no further timer is scheduled).
// - The classifier answer (the old `ask`/`onAnswer` link): the turn's body
//   asks the classifier itself — the ask is the recovery slice's business,
//   the `asked` record is turn state — and hands the in-flight promise to
//   answerWith; its resolution is emitted as `{ kind: "answer", answer }`,
//   a no-answer resolution included (dropping it is the handler's rule, the
//   old onAnswer early-return). An answer resolving after the wrapper
//   finished never reaches a concern: the spine's emit drops it (the old
//   `consuming` guard). askClassifier never rejects, so the observed promise
//   needs no catch.
import type { AgentEvent } from "../agent/types"
import type { ClassifierAnswer } from "../router"
import { probeSession } from "../session-api"
import type { TurnContext, TurnInput } from "./contract"
import type { TurnSources } from "./spine"

// The probe interval's default (moved from watch, where it sat beside the
// machinery): idleTime's own default, so an unset idleMs changes nothing.
const PROBE_INTERVAL_MS = 10 * 60_000

// The stream leg arms only on an interval at least this many beats wide
// (plans/0187 D1): a live stream provably delivers several beats inside such
// a window, while a shorter interval (a test's milliseconds) could not
// distinguish a slow beat from a dead connection — there the leg stays off
// and the probe keeps its fresh-connection-only verdict.
const PULSE_WINDOW_BEATS = 3

// Wraps the turn's stream with the pulse observer: every event the stream
// delivers — a heartbeat (consumed here, never yielded: it belongs to no
// session and no row dispatches it) or any session event — stamps the pulse,
// initialized at the turn's start so a stream dead from the first moment goes
// stale by the first tick. `pulse()` answers the stamp (ms off the services
// clock); the probe tick reads it. Transparent to the spine otherwise: the
// wrapper yields everything it does not consume and propagates return().
export function pulseWrapper(stream: AsyncIterable<AgentEvent>, now: () => number): { stream: AsyncIterable<AgentEvent>; pulse: () => number } {
  let last = now()
  const observed = (async function* () {
    for await (const event of stream) {
      last = now()
      if (event.type === "heartbeat") continue
      yield event
    }
  })()
  return { stream: observed, pulse: () => last }
}

// The two sources of one turn, as watch hands them out: `attach` is the
// spine's source hook (starts the probe timer, captures the emission point,
// answers the cleanup), `answerWith` is the classifier-answer source's feed.
type TurnSourceSet = {
  attach: TurnSources
  answerWith(call: Promise<ClassifierAnswer | undefined>): void
}

export function makeTurnSources(ctx: TurnContext, pulse?: () => number): TurnSourceSet {
  const clock = ctx.services.clock
  let emitAnswer: ((input: TurnInput) => void) | undefined
  const attach: TurnSources = (emit) => {
    emitAnswer = emit
    // The probe timer: one probe in flight at a time (the timer re-arms only
    // after its verdict was emitted), active until the cleanup runs. A
    // verdict that judges half-open settles the turn through the concurrent
    // row; the re-armed timer is then cancelled by this cleanup before its
    // interval (minutes) could elapse, exactly where the old body's
    // `halfOpen` early-return stopped the chain.
    let active = true
    let cancel: (() => void) | undefined
    const interval = (): number => ctx.opts.idleMs ?? PROBE_INTERVAL_MS
    const schedule = (): void => {
      cancel = clock.timer(interval(), () => {
        cancel = undefined
        void (async () => {
          const ok = await probeSession(ctx.client, ctx.sessionID)
          if (!active) return
          // The stream leg (plans/0187 D1): only when the adapter's stream
          // pulses and the interval is wide enough to hold PULSE_WINDOW_BEATS
          // beats — one beat's grace below the full interval, so a stream
          // that delivered anything in the window passes and one silent for
          // the whole interval (less that grace) fails. `undefined` = not
          // assessed: the liveness cell treats it as alive (today's rule).
          const beat = ctx.client.capabilities.heartbeat
          const width = interval()
          const streamAlive =
            pulse !== undefined && beat !== undefined && width >= PULSE_WINDOW_BEATS * beat
              ? clock.now() - pulse() <= width - beat
              : undefined
          emit({ kind: "probe", ok, ...(streamAlive !== undefined ? { streamAlive } : {}), at: clock.now() })
          schedule()
        })()
      })
    }
    schedule()
    return () => {
      active = false
      if (cancel !== undefined) cancel()
    }
  }
  const answerWith = (call: Promise<ClassifierAnswer | undefined>): void => {
    const emit = emitAnswer
    // The spine attaches the sources before the first input is dispatched,
    // and only a handler asks the classifier — an unattached answerWith is a
    // programming error.
    if (emit === undefined) throw new Error("turn engine sources: answerWith before the sources were attached")
    void call.then((answer) => emit({ kind: "answer", answer }))
  }
  return { attach, answerWith }
}
