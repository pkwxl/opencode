// The turn facade (plans/0061 §4.6): watch() is the engine's entry for one
// session turn — it builds the TurnContext from its parameters, installs
// the concern roster (the eleven concerns from src/engine/concerns/, each
// owning its slice's construction), hands the stream to the spine
// (src/engine/spine.ts: the single input queue, the arbitration dispatch,
// the fx audit, the trip-wired stream wrapper and the finalize procedure),
// and maps the outcome back into the Watch result (src/engine/result.ts).
// The probe timer and the classifier answer arrive as synthetic inputs from
// src/engine/sources.ts; all of the turn's I/O goes through the production
// fx (src/engine/fx.ts) under the spine's audit. The turn's mechanisms are
// the concerns' own files'. Sits below session.ts (its attempt starts the
// subscription then awaits this function) and only calls downward into
// testrun / unit-commit / session-api and peer layers — **must never import
// session / runner back** (plans/0024-module-split-plan.md S7).

import type { AgentClient, AgentEvent } from "./agent/types"
import { classifySessionError, retryPolicyOf, type ErrorClass, type ErrorInfo, type Watch } from "./chain"
import { classifierFor } from "./classify"
import type { Concern, TurnContext, TurnState } from "./engine/contract"
import { failureConcern } from "./engine/concerns/failure"
import { guardConcern } from "./engine/concerns/guard"
import { makeLivenessConcern } from "./engine/concerns/liveness"
import { questionsConcern } from "./engine/concerns/questions"
import { makeRecoveryConcern } from "./engine/concerns/recovery"
import { makeStepUpConcern } from "./engine/concerns/step-up"
import { stuckConcern } from "./engine/concerns/stuck"
import { makeTestConcern } from "./engine/concerns/test"
import { transcriptConcern } from "./engine/concerns/transcript"
import { usageConcern } from "./engine/concerns/usage"
import { windowsConcern } from "./engine/concerns/windows"
import { makeTurnFx } from "./engine/fx"
import { settleToWatch } from "./engine/result"
import { makeTurnSources } from "./engine/sources"
import { runTurn, type ConcernRoster } from "./engine/spine"
import type { SteerContext } from "./model-step"
import type { Opts } from "./opts"
import { services } from "./services"
import type { StuckTracker } from "./stuck"
import { autoSwitches, type Switches } from "./switches"
import type { Steer, TestRun } from "./testrun"
import { usageSource } from "./usage"

// The turn's concern install: the concerns from their files, the four
// factories' products as parameters (their per-turn channels are watch()'s
// locals). Exported for the arbitration suite's removal check
// (plans/0061 §4.11): every entry holds its own concern's handle — no slice
// delegates to a shared compatibility handle (the remainder layer's shape).
export const turnConcerns = (
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
  // run's switches; defaults to the parsed OPENCODE_AUTO_* values, injected
  // for unit tests (attempt passes through the switches it itself holds).
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
  // service behind the fx's commitFreeze ride the context to the fx.
  const svcs = services()
  const startTime = svcs.clock.now()
  // The figure comes from the usage source of the adapter's tier
  // (plans/0038): the spine feeds it every event of this session, the usage
  // concern reads its used() at the measurement points and the test
  // protocol's handover decision at idle. The agent's retry policy
  // (plans/0057 §4) is the adapter's record with the registry entry's
  // override. The failure-message classifier (plans/0055 §7.1) exists under
  // a registry with a classifier list and is carried on the context;
  // without one it is undefined, nobody asks and the watch is
  // byte-identical to before (C2).
  const policy = retryPolicyOf(client.retryPolicy, steerContext?.entry?.retry)
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
    classify: (info: ErrorInfo): ErrorClass => classifySessionError(info, client.errorPatterns, policy),
    classifier: classifierFor(client, opts.routing, steerContext?.label, opts.server ? (agent) => opts.server!.client(agent) : undefined),
    source: usageSource(client.capabilities.usage),
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
  // record (the liveness concern's finalize writes the extension here, the
  // recovery concern's final classification and the result mapping read it),
  // and the test concern's channel for its blocked exits' Watch extras.
  const extended: { error?: string; info?: ErrorInfo } = {}
  const blockedExtra: { extra?: Partial<Watch> } = {}
  const concerns = turnConcerns(
    makeRecoveryConcern({ answerWith: sources.answerWith, extended }),
    makeLivenessConcern({ extended }),
    makeStepUpConcern({ live: stepUpLive }),
    makeTestConcern({ blockedExtra }),
  )
  const { settle, view } = await runTurn({ ctx, stream, concerns, fx, attach: sources.attach })
  return settleToWatch(settle, view, { extended, blockedExtra }, ctx)
}
