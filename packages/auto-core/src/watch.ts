// Event-stream subscription and live handling for a single session: consumes the
// unified event stream (AgentEvent, MA.3 plans/0039; the opencode SSE mapping
// lives in agent/opencode/events.ts), doing terminal echo, context-usage
// tracking and handover steer insertion, stuck-loop hints, proxy-answer
// collection (AUTO-RESOLVE / AUTO-DECISION), dispatch and close-out of test
// requests, and classification/reporting of session error signals; the
// in-flight liveness probe (plans/0026-session-boundary-hardening-design.md
// D3/§4.4) probes session liveness periodically, judges a half-open connection
// on two consecutive failures, and closes out as a retryable session error.
// Sits below session.ts (its attempt starts the subscription then awaits this
// function); only calls downward into testrun / unit-commit / session-api and
// peer layers — **must never import session / runner back**.
// Split out of src/runner.ts (plans/0024-module-split-plan.md S7, pure move).
//
// The turn runs on the engine (plans/0061 §4.2–§4.4): watch() builds the
// TurnContext from its parameters, installs the concern roster — the
// extracted concerns in src/engine/concerns/ (guard, transcript, windows,
// stuck, questions, failure, recovery, liveness, usage, stepUp and the test
// protocol; each owning its slice's construction) beside the one `remainder`
// compatibility entry that no longer holds any slice — and hands the stream
// to the spine (src/engine/spine.ts), which owns the input queue, the
// arbitration dispatch, the fx audit and the trip-wired stream wrapper. The
// settle procedure's steps are the concerns' own finalize functions: the
// liveness concern's holds the interrupted close-out (aborting the orphan
// turn and extending the failure record), the recovery concern's the raised
// settle's abort and the final classification. The probe timer and the
// classifier answer arrive as synthetic inputs from src/engine/sources.ts;
// all of the body's I/O goes through the production fx (src/engine/fx.ts)
// under the spine's audit. What remains here is the mapping of the spine's
// settle and the slices back into the Watch result each old exit returned.

import type { AgentClient, AgentEvent } from "./agent/types"
import { classifySessionError, retryPolicyOf, type ErrorClass, type ErrorInfo, type Watch } from "./chain"
import { classifierFor } from "./classify"
import type { Advice, Concern, InputKind, SliceKey, TurnContext, TurnState, TurnView } from "./engine/contract"
import { failureConcern } from "./engine/concerns/failure"
import { guardConcern } from "./engine/concerns/guard"
import { makeLivenessConcern } from "./engine/concerns/liveness"
import { questionsConcern } from "./engine/concerns/questions"
import { makeRecoveryConcern, resetFields } from "./engine/concerns/recovery"
import { makeStepUpConcern } from "./engine/concerns/step-up"
import { stuckConcern } from "./engine/concerns/stuck"
import { makeTestConcern } from "./engine/concerns/test"
import { transcriptConcern } from "./engine/concerns/transcript"
import { usageConcern } from "./engine/concerns/usage"
import { windowsConcern } from "./engine/concerns/windows"
import { makeTurnFx } from "./engine/fx"
import { makeTurnSources } from "./engine/sources"
import { runTurn, type ConcernRoster } from "./engine/spine"
import type { Opts } from "./opts"
import type { SteerContext } from "./model-step"
import { services } from "./services"
import type { StuckTracker } from "./stuck"
import { autoSwitches, type Switches } from "./switches"
import type { Steer, TestRun } from "./testrun"
import { usageSource } from "./usage"

// The input kinds the remainder still serves — those whose arbitration row
// holds a not-yet-extracted cell. Every row's cells are extracted concerns'
// now, so the list is empty. The arbitration suite derives the same set from
// the table and the install's delegation set and pins this list to it.
export const HANDLER_KINDS = [] as const satisfies readonly InputKind[]

// The slices the remainder concern still owns (plans/0061 §4.11): the
// compatibility layer shrank one slice per extraction unit and owns none
// left — every slice has its named concern's file. The layer's residue (the
// empty owned-set, the shared no-op handle and the install's delegation
// seam) is what its removal unit deletes. Typed as the union's source of
// truth so a re-grown list is a type error, not a silent mis-route.
export const REMAINDER_KEYS = [] as const satisfies readonly SliceKey[]
export type RemainderKey = (typeof REMAINDER_KEYS)[number]
export type RemainderState = { readonly [K in RemainderKey]: TurnState[K] }

// The turn's concern install: the extracted concerns from their files. The
// `state`/`handle` parameters are the remainder layer's residue — no entry
// delegates to the handle anymore, and the removal unit collapses them.
// Exported for the arbitration suite's shrink ratchet: slicesDelegatedTo
// over this install reads exactly the not-yet-extracted set (empty). The
// liveness concern's finalize holds the settle procedure's liveness step
// (the interrupted close-out) and the recovery concern's the raised settle's
// abort and the final classification; the procedure runs them at their first
// cells' positions (liveness in the part row before recovery in the retry
// row) — the order the recovery concern's final classification of the
// extended record rests on.
export const turnConcerns = (
  _state: RemainderState,
  handle: Concern<SliceKey>["handle"],
  recovery: Concern<"recovery">,
  liveness: Concern<"liveness">,
  stepUp: Concern<"stepUp">,
  test: Concern<"test">,
): ConcernRoster => ({
  guard: guardConcern,
  transcript: transcriptConcern,
  windows: windowsConcern,
  stuck: stuckConcern,
  questions: questionsConcern,
  failure: failureConcern,
  recovery,
  liveness,
  usage: usageConcern,
  stepUp,
  test,
})

export async function watch(
  client: AgentClient,
  sessionID: string,
  stream: AsyncIterable<AgentEvent>,
  opts: Opts,
  steer?: Steer,
  test?: TestRun,
  stuck?: StuckTracker,
  // The strict-resume gate (the handover-boundary write-verify) takes this
  // run's switches; defaults to the parsed OPENCODE_AUTO_* values, injected for
  // unit tests (attempt passes through the switches it itself holds).
  switches: Switches = autoSwitches(),
  // Observation callback for the actually-used model: fires once when the
  // first message carrying a model arrives in this session's event stream
  // (a user message carries the model the server actually resolved), from
  // which attempt announces the model really in effect.
  onModel?: (model: string) => void,
  // Steer context under the registry (plans/0055 §4.5): the context steps of
  // the entry the session runs in, and the model id a steer must name. Without
  // a registry (the default) everything stays as before — steers carry no
  // model key, byte-for-byte equivalent to the status quo (C2).
  steerContext?: SteerContext,
  // A usage-window observation that changed (the `limit` event, plans/0057
  // §5.2): attempt records it for the chain's account (§8).
  onLimit?: (event: Extract<AgentEvent, { type: "limit" }>) => void,
): Promise<Watch> {
  // The run's services (the installed holder): every time read and every
  // timer of this turn goes through its clock — a run on a steered clock
  // observes a steered timeline, and the engine never reads the wall clock
  // behind the services' back. The router (the logged usage windows, the
  // classifier's cache, the model-step cache-claim checks) and the git
  // service behind the fx's commitFreeze ride the context to the concerns
  // and the fx.
  const svcs = services()
  const clock = svcs.clock
  // Session start timestamp, for computing durationMs.
  const startTime = clock.now()
  // The figure comes from the usage source of the adapter's tier (plans/0038):
  // the spine feeds it every event of this session (the old loop's
  // source.observe), the usage concern reads its used() at the measurement
  // points and the test protocol's handover decision at idle.
  const source = usageSource(client.capabilities.usage)
  // The agent's retry policy (plans/0057 §4): the adapter's record with the
  // registry entry's override. Every pattern verdict below reads the rate
  // threshold from it — a rate signal is the rate class once the agent gave
  // up curing it by itself (chain.ts agentGaveUp).
  const policy = retryPolicyOf(client.retryPolicy, steerContext?.entry?.retry)
  const classify = (info: ErrorInfo): ErrorClass => classifySessionError(info, client.errorPatterns, policy)
  // —— The failure-message classifier (plans/0055 §7.1) ——
  // The turn's handle: under a registry with a classifier list it is built
  // here and carried on the context; without one it is undefined, nobody
  // asks and the watch is byte-identical to before (C2). Everything the
  // classifier does inside the turn — the consult, the pattern verdicts,
  // the raised settle, the final classification, the reset fields — is the
  // recovery concern's (src/engine/concerns/recovery.ts, its slice
  // `answer`/`asked`/`raised`/`final`).
  const classifier = classifierFor(client, opts.routing, steerContext?.label, opts.server ? (agent) => opts.server!.client(agent) : undefined)

  const ctx: TurnContext = {
    client,
    sessionID,
    opts,
    steer,
    test,
    stuck,
    switches,
    steerContext,
    policy,
    classify,
    classifier,
    source,
    services: svcs,
    startTime,
  }

  // The stepUp concern's live-slice cell: the fx's steer default (the
  // reached context step's id, the stepUp slice's model field) is wired over
  // it below — the fx is built before the spine creates the slices, and the
  // concern's initial parks the slice it builds in the cell.
  const stepUpLive: { slice?: TurnState["stepUp"] } = {}
  const sources = makeTurnSources(ctx)
  const fx = makeTurnFx({ ctx, steerModel: () => stepUpLive.slice?.model, onModel, onLimit })

  // The settle procedure's channel for the interrupted close-out's failure
  // record (both concerns' deps name the discipline): the liveness concern's
  // finalize writes the extension here, the recovery concern's final
  // classification and the settle→Watch mapping read it.
  const extended: { error?: string; info?: ErrorInfo } = {}
  const recovery = makeRecoveryConcern({ answerWith: sources.answerWith, extended })
  const liveness = makeLivenessConcern({ extended })
  const stepUp = makeStepUpConcern({ live: stepUpLive })
  // The test concern's channel for its blocked exits' Watch extras (the same
  // discipline): the concern records testHandover / testHandoverInvalid
  // beside the settle it returns, and the mapping below spreads the cell —
  // when set, it is the whole extra.
  const blockedExtra: { extra?: Partial<Watch> } = {}
  const testProtocol = makeTestConcern({ blockedExtra })
  // The remainder layer's residue: with every slice extracted, its shared
  // handle passes every input and no roster entry delegates to it.
  const handle: Concern<SliceKey>["handle"] = async (): Promise<Advice> => "pass"
  // Turn snapshot (STATS_PLAN §2): every exit of watch carries durationMs +
  // usage + resolves uniformly, including the early-settling error/blocked
  // exits — consumption and proxy answers really happened, they are not lost.
  // extra holds the fields that differ per exit. Rebuilt from the final view
  // over the slices: same keys, same conditionals as the old closure over
  // locals.
  const snapshot = (view: TurnView, extra?: Partial<Watch>): Watch => ({
    lastText: view.transcript.lastText,
    pct: view.usage.pct,
    used: view.usage.used,
    limit: view.usage.limit,
    durationMs: clock.now() - startTime,
    usage: view.transcript.usage,
    resolves: view.questions.resolves,
    ...(view.usage.hinted ? { hinted: true } : {}),
    ...(view.usage.wall !== undefined ? { wall: view.usage.wall } : {}),
    ...(view.stepUp.reached !== undefined ? { steppedUp: view.stepUp.reached } : {}),
    ...extra,
  })

  const { settle, view } = await runTurn({ ctx, stream, concerns: turnConcerns({}, handle, recovery, liveness, stepUp, testProtocol), fx, attach: sources.attach })

  // —— Mapping the settle back to the Watch result each old exit returned ——
  // The settle procedure's steps already ran inside the spine (its finalize
  // procedure): the liveness concern's finalize (the interrupted close-out)
  // aborted the orphan turn and extended the failure record — the extension
  // is read through the same cell the recovery concern's final classification
  // read — and the recovery concern finalized the raised settle's abort and
  // the final classification (its slice's `final`). What remains here is
  // shaping the snapshot. A blocked settle's question is the Watch blocked
  // field's only varying content: the extracted concerns' blocked exits (the
  // questions concern's blocks, the liveness concern's failed continuation
  // dispatch) carry it in the settle itself, while the test concern's blocked
  // exits record their extras (testHandover, testHandoverInvalid) beside the
  // settle through the cell above — the cell, when set, is the whole extra.
  const errorText = extended.error ?? view.failure.error
  const failureInfo = extended.error !== undefined ? extended.info : view.failure.info
  if (settle.kind === "blocked") return snapshot(view, blockedExtra.extra ?? { blocked: { type: "blocked", question: settle.question } })
  if (settle.kind === "error") {
    const msg = failureInfo?.message ?? errorText
    return snapshot(view, {
      error: msg,
      retryable: failureInfo?.isRetryable === false ? false : undefined,
      errorInfo: failureInfo,
      errorClass: settle.cls,
      failover: true,
      ...(settle.classified ? { classified: true } : {}),
      ...resetFields(view.recovery, failureInfo, ctx),
    })
  }
  return snapshot(view, {
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
