// The recovery concern (plans/0061 §4.5, the recovery cells of the retry and
// answer rows): the failure-message classifier's turn (plans/0055 §7.1).
// Under a registry with a classifier list, a failure the error patterns
// leave undecided is read by a classifier model beside the event stream: a
// retry the patterns class unknown (or a rate signal below its threshold)
// while the agent keeps retrying, and a session error that ends unknown.
// The ask never holds up the turn; its answer arrives as the synthetic
// answer input and, when it raises the class while the turn is still
// retrying, settles the turn exactly as the patterns do (abort, then the
// key → model → wait escalation). Answers are turn-level state of the
// recovery slice: `answer` is the latest one known for this turn's failure,
// `asked` the latest call still on its way — at the turn's end they give the
// escalation its reset time (resetAt) or the promise of one (pendingReset).
// `retrying` (the failure slice) is true from a retry event until the model
// produces output again (the agent's retry got through), so a late answer
// never aborts a turn that recovered. Without a classifier all of this
// stays unset and the turn is byte-identical to before (C2).
//
// The settle procedure's recovery steps (plans/0061 §4.4 rule 5) live here
// too: the raised settle's abort and line, and the final classification of
// a turn that ended without one (a session error that ends unknown is
// consulted now, its answer serving the next occurrence of the message and
// the reset time of any down mark the failure leads to). The classifier's
// own state — the answer cache, the calls in flight, the call budget, the
// usage sink — is the router service's; this concern holds only the
// turn-slice part.
import { agentGaveUp, type ErrorClass, type ErrorInfo, type Watch } from "../../chain"
import { acceptedReset, askClassifier, cachedAnswer, describeAnswer, mergeClass, shouldAsk } from "../../classify"
import type { ClassifierAnswer } from "../../router"
import type { Advice, Concern, Settle, TurnContext, TurnFx, TurnState } from "../contract"

// What one recovery turn needs beside its context. `answerWith` is the
// sources' answer feed: the ask's in-flight call is handed to the spine's
// queue, its resolution arriving as the synthetic answer input. `extended`
// is the settle procedure's channel for the interrupted close-out's failure
// record: the liveness concern's finalize extends the failure slice's record
// with the transport message of the interruption, and this concern's final
// classification and the result mapping read the extension through this
// cell; `error` is set exactly when the turn settled interrupted.
export type RecoveryDeps = {
  answerWith(call: Promise<ClassifierAnswer | undefined>): void
  extended: { error?: string; info?: ErrorInfo }
}

// The reset fields a settled failure carries to the escalation: a reset the
// provider or the agent stated (plans/0057 §5.3, it outranks the
// classifier's), else the accepted reset time of the known answer, or the
// answer still on its way. The stated one rides without a registry too: the
// down marks and the wait-and-probe loop's scheduled sleep (plans/0057 §6)
// read it, and it carries its scope, which the escalation and the wait line
// read (§7). The recovery slice and the failure record arrive as parameters:
// the slices are their concerns' (built inside the spine), and the
// interrupted close-out hands this the extended record, not the raw slice.
export function resetFields(recovery: Readonly<TurnState["recovery"]>, info: ErrorInfo | undefined, ctx: TurnContext): Partial<Watch> {
  const stated = acceptedReset(info, ctx.services.clock.now())
  if (stated !== undefined) return { resetAt: stated, ...(info?.scope !== undefined ? { scope: info.scope } : {}), resetSource: "stated" }
  const classifier = ctx.classifier
  if (classifier === undefined) return {}
  if (recovery.answer !== undefined) {
    const at = acceptedReset(recovery.answer, classifier.now())
    return at !== undefined ? { resetAt: at, resetSource: "classifier" } : {}
  }
  const pending = recovery.asked
  return pending !== undefined ? { pendingReset: pending.then((got) => acceptedReset(got, classifier.now())) } : {}
}

// One concern instance per turn (a factory, not a module constant): the
// answer feed and the interrupted close-out's cell are per-turn wiring, and
// the raised settle's identity is per-turn state beside the slice.
export const makeRecoveryConcern = (deps: RecoveryDeps): Concern<"recovery"> => {
  // The settle object the answer handler returned when it raised the class,
  // so the finalize can tell "the turn was settled by the raise" (abort
  // still owed) apart from "a raise landed beside an early error settle
  // that already aborted" (the old body returned the early snapshot and
  // never consulted the raise). Settle identity, not the slice's raised
  // flag: a raise that landed beside an early settle was never consulted,
  // and a flag read would mis-route that race into the raised path (a
  // duplicate abort, an extra line). The channel stays beside the settle
  // protocol, not on the slice — the slice shapes are the contract's.
  let raisedSettle: Extract<Settle, { kind: "error" }> | undefined

  // An answer arriving beside the stream asks the classifier through the
  // sources' link: the in-flight call is recorded on the recovery slice and
  // its resolution comes back as a synthetic answer input.
  const ask = (info: ErrorInfo, own: TurnState["recovery"], ctx: TurnContext): void => {
    const call = ctx.classifier !== undefined ? askClassifier(ctx.classifier, info) : undefined
    if (call === undefined) return
    own.asked = call
    deps.answerWith(call)
  }

  // The pattern verdict of an undecided failure, raised by a known answer:
  // the cached answer about the same message (an earlier call), else this
  // turn's own answer. Without one the classifier is asked — once per turn:
  // a later undecided signal of the same turn (the next retry, the session
  // error that ends it, whose message folds in the retries') waits for that
  // call instead of starting another — and the verdict stands.
  // AUTO-DECISION: one classifier call per failing turn, and the turn's answer covers every undecided signal of that turn (the retries and the closing session error of one turn are one failing request whose wording drifts — the closing error even repeats the retry messages — so a call per distinct message would spend the run's 20-call budget on one failure)
  const consult = (
    surface: "retry" | "error",
    info: ErrorInfo,
    cls: ErrorClass,
    own: TurnState["recovery"],
    ctx: TurnContext,
  ): { cls: ErrorClass; classified: boolean } => {
    const classifier = ctx.classifier
    if (classifier === undefined || !shouldAsk(surface, info, cls, ctx.client.errorPatterns)) return { cls, classified: false }
    // The cache's owner is the classifier's router (the routing facts carry
    // it), which is also where this turn's own ask writes.
    const known = cachedAnswer(classifier.router, info) ?? own.answer
    if (known === undefined) {
      if (own.asked === undefined) ask(info, own, ctx)
      return { cls, classified: false }
    }
    own.answer = known
    const merged = mergeClass(cls, known.class, info, ctx.policy)
    return { cls: merged, classified: merged !== cls }
  }

  // The ⚖ line of a raised class: what the classifier read, and the class
  // the turn settles as.
  const raisedLine = (own: TurnState["recovery"], cls: ErrorClass, ctx: TurnContext, fx: TurnFx): void => {
    const classifier = ctx.classifier
    if (classifier === undefined || own.answer === undefined) return
    const label = ctx.steerContext?.label ? `${ctx.steerContext.label} ` : ""
    fx.log(`⚖ ${label}the classifier reads the failure as ${describeAnswer(own.answer, classifier.registry.tz, classifier.now())}; settling the turn as ${cls}`)
  }

  return {
    name: "recovery",
    initial: (): TurnState["recovery"] => ({}),
    handle: async (input, own, view, fx, ctx): Promise<Advice> => {
      // The answer row (concurrent): the classifier's reply, handled even
      // while an fx call is in flight — the audit restricts a synthetic
      // handler to its own slice's writes and log/vlog, and this cell makes
      // no fx call at all. Record the answer, then raise the class of the
      // running turn if it is still retrying on an undecided failure; the
      // held settle preempts the event wait (the same preemption the
      // half-open probe uses). A resolution past the wrapper's finish never
      // reaches here (the spine drops it), and a no-answer resolution is
      // dropped here. The settle's object identity is load-bearing: the
      // finalize compares the outcome against `raisedSettle` by identity, so
      // the object stored there is the one this cell returns.
      if (input.kind === "answer") {
        const got = input.answer
        if (got === undefined) return "consumed"
        own.answer = got
        if (!view.failure.retrying || view.failure.info === undefined || own.raised !== undefined) return "consumed"
        const cls = ctx.classify(view.failure.info)
        if (!shouldAsk("retry", view.failure.info, cls, ctx.client.errorPatterns)) return "consumed"
        const merged = mergeClass(cls, got.class, view.failure.info, ctx.policy)
        if (merged !== "quota" && merged !== "auth" && merged !== "rate") return "consumed"
        own.raised = merged
        raisedSettle = { kind: "error", cls: merged, classified: true }
        return { settle: raisedSettle }
      }
      if (input.kind !== "event" || input.event.type !== "retry") return "pass"
      // The retry row's recovery cell. The failure concern's cell before it
      // set retrying and accumulated the signal into the info (its own
      // message replacing the earlier one, the limit statement laid over);
      // this cell reads the record it left. (The `?? {}` is the type's
      // default: a retry input always leaves a defined info behind.)
      const info = view.failure.info ?? {}
      // Undecided by the patterns (plans/0055 §7.1): a cached answer raises
      // the class now; otherwise the classifier is asked beside the stream
      // and its answer settles the turn from the answer input while it still
      // retries.
      const { cls, classified } = consult("retry", info, ctx.classify(info), own, ctx)
      // A per-minute cap the agent is still backing off from (plans/0057 §7):
      // its own retrying cures it, so the turn does not settle before the
      // agent gave up — quota wording on a refused request included. (A rate
      // class already waits for agentGaveUp.)
      const perMinute = (info.scope === "request" || info.scope === "token") && !agentGaveUp(info, ctx.policy)
      if ((cls === "quota" && !perMinute) || cls === "auth" || cls === "rate") {
        // The still-running old turn on the server must be aborted before
        // returning (the same technique as the stream-interruption cleanup),
        // otherwise it would modify files concurrently with the session
        // forked next (D.2); overflow/transient/unknown only accumulate
        // without settling, and observation continues (not treated as idle).
        // Only isRetryable:false (e.g. insufficient_quota) passes
        // non-retryable down; for the other failover-eligible errors a new
        // session is still pointless but a different model may help — left
        // to P4 (the mapping keeps retryable undefined then).
        await fx.abort()
        if (classified) raisedLine(own, cls, ctx, fx)
        return { settle: { kind: "error", cls, classified } }
      }
      // Every other class observes on: the row continues (the step-up and
      // liveness cells, then the transcript's deduplicated retry vlog).
      return "pass"
    },
    finalize: async (settle, own, view, fx, ctx): Promise<void> => {
      // The raised settle's close-out (plans/0055 §7.1): the answer handler
      // may not abort (the audit bars every fx but log/vlog on a synthetic
      // input), so the abort of the still-running old turn lands here —
      // after the stream wrapper's close-out, exactly where the old body's
      // post-loop raised path made it.
      if (settle === raisedSettle) {
        await fx.abort()
        raisedLine(own, settle.cls, ctx, fx)
      }
      // The final classification belongs to the turns that ended without
      // one of their own: an error settle carries the verdict its handler
      // returned, and a blocked one is not a failure report at all.
      if (settle.kind === "error" || settle.kind === "blocked") return
      // The failure record this close-out reads: the interrupted close-out's
      // extension when the turn settled interrupted (the liveness step of
      // the settle procedure extended it before this finalize ran — a pure
      // transport loss still classifies, from the extended text's gate),
      // else the failure slice as the failure concern left it.
      const extended = deps.extended.error !== undefined ? deps.extended : undefined
      const errorText = extended?.error ?? view.failure.error
      if (!errorText) return
      const failureInfo = extended !== undefined ? extended.info : view.failure.info
      const verdict = ctx.classify(failureInfo ?? {})
      const consulted = failureInfo !== undefined ? consult("error", failureInfo, verdict, own, ctx) : { cls: verdict, classified: false }
      own.final = { cls: consulted.cls, classified: consulted.classified }
      if (consulted.classified) raisedLine(own, consulted.cls, ctx, fx)
    },
  }
}
