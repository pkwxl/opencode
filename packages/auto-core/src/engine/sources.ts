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
//   `{ kind: "probe", ok, at }` input, `at` stamped at the verdict's arrival
//   off the services clock. The timer re-arms only after a verdict was
//   emitted, so at most one probe is in flight; the cleanup the wrapper's
//   finally runs stops it for good (the old probeActive/cancelProbe pair —
//   a late resolution of an in-flight probe emits, the spine's emit drops it,
//   and no further timer is scheduled).
// - The classifier answer (the old `ask`/`onAnswer` link): the turn's body
//   asks the classifier itself — the ask is the recovery slice's business,
//   the `asked` record is turn state — and hands the in-flight promise to
//   answerWith; its resolution is emitted as `{ kind: "answer", answer }`,
//   a no-answer resolution included (dropping it is the handler's rule, the
//   old onAnswer early-return). An answer resolving after the wrapper
//   finished never reaches a concern: the spine's emit drops it (the old
//   `consuming` guard). askClassifier never rejects, so the observed promise
//   needs no catch.
import type { ClassifierAnswer } from "../router"
import { probeSession } from "../session-api"
import type { TurnContext, TurnInput } from "./contract"
import type { TurnSources } from "./spine"

// The probe interval's default (moved from watch, where it sat beside the
// machinery): idleTime's own default, so an unset idleMs changes nothing.
const PROBE_INTERVAL_MS = 10 * 60_000

// The two sources of one turn, as watch hands them out: `attach` is the
// spine's source hook (starts the probe timer, captures the emission point,
// answers the cleanup), `answerWith` is the classifier-answer source's feed.
export type TurnSourceSet = {
  attach: TurnSources
  answerWith(call: Promise<ClassifierAnswer | undefined>): void
}

export function makeTurnSources(ctx: TurnContext): TurnSourceSet {
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
    const schedule = (): void => {
      cancel = clock.timer(ctx.opts.idleMs ?? PROBE_INTERVAL_MS, () => {
        cancel = undefined
        void (async () => {
          const ok = await probeSession(ctx.client, ctx.sessionID)
          if (!active) return
          emit({ kind: "probe", ok, at: clock.now() })
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
