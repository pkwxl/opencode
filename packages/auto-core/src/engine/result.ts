// The turn's result mapping (plans/0061 §4.3/§4.6): the second half of the
// turn facade — shaping the spine's outcome (the settle that ended the turn
// and the final view over the slices) into the Watch result each exit of
// the pre-engine watch body returned. Pure shaping over its arguments: the
// effects that must precede it (the close-out aborts, the final
// classification) are the settle procedure's finalize steps and have
// already run inside the spine; what reaches this module are the outcome,
// the two cross-cutting channels the concerns' deps declare, and the
// context (whose services clock the snapshot's duration and the reset
// fields' horizon read).
import type { ErrorInfo, Watch } from "../chain"
import { resetFields } from "./concerns/recovery"
import type { Settle, TurnContext, TurnView } from "./contract"

// The channels the mapping reads beside the outcome — the same cells the
// concerns' deps declare (their writer is a concern's handler or finalize,
// their first reader the recovery concern's final classification):
// `extended` holds the interrupted close-out's failure record (`error` is
// set exactly when the turn settled interrupted), `blockedExtra` the test
// protocol's blocked-exit Watch extras.
export type ResultChannels = {
  extended: { error?: string; info?: ErrorInfo }
  blockedExtra: { extra?: Partial<Watch> }
}

// Turn snapshot (STATS_PLAN §2): every exit of watch carries durationMs +
// usage + resolves uniformly, including the early-settling error/blocked
// exits — consumption and proxy answers really happened, they are not lost.
// extra holds the fields that differ per exit. Rebuilt from the final view
// over the slices: same keys, same conditionals as the old closure over
// locals.
const snapshot = (ctx: TurnContext, view: TurnView, extra?: Partial<Watch>): Watch => ({
  lastText: view.transcript.lastText,
  pct: view.usage.pct,
  used: view.usage.used,
  limit: view.usage.limit,
  durationMs: ctx.services.clock.now() - ctx.startTime,
  usage: view.transcript.usage,
  resolves: view.questions.resolves,
  ...(view.usage.hinted ? { hinted: true } : {}),
  ...(view.usage.wall !== undefined ? { wall: view.usage.wall } : {}),
  ...(view.stepUp.reached !== undefined ? { steppedUp: view.stepUp.reached } : {}),
  ...extra,
})

// A blocked settle's question is the Watch blocked field's only varying
// content: the blocked exits carry it in the settle itself, while the test
// protocol's blocked exits record their extras (testHandover,
// testHandoverInvalid) beside the settle through the channel above — the
// cell, when set, is the whole extra.
export function settleToWatch(settle: Settle, view: TurnView, channels: ResultChannels, ctx: TurnContext): Watch {
  const errorText = channels.extended.error ?? view.failure.error
  const failureInfo = channels.extended.error !== undefined ? channels.extended.info : view.failure.info
  if (settle.kind === "blocked") return snapshot(ctx, view, channels.blockedExtra.extra ?? { blocked: { type: "blocked", question: settle.question } })
  if (settle.kind === "error") {
    const msg = failureInfo?.message ?? errorText
    return snapshot(ctx, view, {
      error: msg,
      retryable: failureInfo?.isRetryable === false ? false : undefined,
      errorInfo: failureInfo,
      errorClass: settle.cls,
      failover: true,
      ...(settle.classified ? { classified: true } : {}),
      ...resetFields(view.recovery, failureInfo, ctx),
    })
  }
  return snapshot(ctx, view, {
    error: errorText,
    testHandover: view.test.handover,
    retryable: view.failure.retryable,
    // Only when there really is a session error does the classification ride
    // up and downstream (no control-flow change); a normal finish carries
    // neither key, byte-for-byte equivalent to the status quo. The info may
    // be empty (e.g. a pure stream interruption) → classified unknown from
    // the empty input. The final classification is the recovery concern's
    // finalize work (present exactly when the close-out had grounds — an
    // error text — under the same gate this spread reads it).
    ...(errorText
      ? {
          errorInfo: failureInfo,
          ...(view.recovery.final !== undefined
            ? { errorClass: view.recovery.final.cls, ...(view.recovery.final.classified ? { classified: true } : {}) }
            : {}),
          ...resetFields(view.recovery, failureInfo, ctx),
        }
      : {}),
  })
}
