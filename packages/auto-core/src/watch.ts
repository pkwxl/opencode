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
// stuck, questions, failure, recovery, liveness; each owning its slice's
// construction) beside the one `remainder` concern that still holds the
// not-yet-extracted turn code — and hands the stream to the spine
// (src/engine/spine.ts), which owns the input queue, the arbitration
// dispatch, the fx audit and the trip-wired stream wrapper. The remainder
// serves the input kinds whose arbitration row still holds one of its cells:
// the shared `handle` answers at the row's first such cell (its cells are
// contiguous in every row), routing the input to its entry of the per-kind
// handler map — the loop body, cut one branch per input kind, minus what
// the extracted concerns own (the guard's resets and twin-idle stop, the
// transcript's echo/billing/report, the windows' limit row, the stuck hint,
// the questions' question and permission rows, the failure's error
// accumulation, the recovery's classifier consult and verdicts, the
// liveness's probe verdicts, announced silence, truncation continuation and
// interrupted close-out). The settle procedure's steps are the concerns'
// own finalize functions: the liveness concern's holds the interrupted
// close-out (aborting the orphan turn and extending the failure record),
// the recovery concern's the raised settle's abort and the final
// classification. The probe timer and the classifier answer arrive as
// synthetic inputs from src/engine/sources.ts; all of the body's I/O goes
// through the production fx (src/engine/fx.ts) under the spine's audit.
// What remains here besides the remainder is the mapping of the spine's
// settle and the slices back into the Watch result each old exit returned.

import { join, relative } from "node:path"
import type { AgentClient, AgentEvent } from "./agent/types"
import { classifySessionError, retryPolicyOf, type ErrorClass, type ErrorInfo, type Watch } from "./chain"
import { classifierFor } from "./classify"
import { commitBlocked, strictResumeActive } from "./unit-commit"
import { suffixedTitle } from "./git"
import { handoffComplete } from "./handover"
import type { Advice, Concern, InputKind, SliceKey, TurnContext, TurnFx, TurnInput, TurnState, TurnView } from "./engine/contract"
import { failureConcern } from "./engine/concerns/failure"
import { guardConcern } from "./engine/concerns/guard"
import { makeLivenessConcern } from "./engine/concerns/liveness"
import { questionsConcern } from "./engine/concerns/questions"
import { makeRecoveryConcern, resetFields } from "./engine/concerns/recovery"
import { stuckConcern } from "./engine/concerns/stuck"
import { transcriptConcern } from "./engine/concerns/transcript"
import { windowsConcern } from "./engine/concerns/windows"
import { makeTurnFx } from "./engine/fx"
import { makeTurnSources } from "./engine/sources"
import { runTurn, TURN_ARBITRATION, type ConcernRoster } from "./engine/spine"
import type { Opts } from "./opts"
import { renderStepUp, renderTestWrapup, renderTestResult } from "./prompt"
import { formatTokens } from "./session-api"
import { enabledSteps, stepId, stepUpPoint, type SteerContext } from "./model-step"
import { services } from "./services"
import type { StuckTracker } from "./stuck"
import { autoSwitches, type Switches } from "./switches"
import { fillUsageNote, steerWall, type Steer, type TestRun } from "./testrun"
import { steerDue, testHandoverDue, liveUsage, usageSource } from "./usage"

// The per-input handler map (plans/0061 §4.5): one handler per input kind the
// remainder still serves. An `event` input keys on its event's own type (the
// spine's rowOf keying), so an event handler receives its AgentEvent variant
// and a synthetic handler its probe/answer input; the view is the spine's
// read-only reach over every slice (the extracted concerns' slices are read
// through it, the remainder's own through closure aliases).
type EventInput<K extends AgentEvent["type"]> = { kind: "event"; event: Extract<AgentEvent, { type: K }> }
type KindInput<K extends InputKind> = K extends AgentEvent["type"] ? EventInput<K> : Extract<TurnInput, { kind: K }>
type KindHandler<K extends InputKind> = (input: KindInput<K>, fx: TurnFx, view: TurnView) => Promise<Advice>

// The input kinds the remainder still serves — those whose arbitration row
// holds a not-yet-extracted cell (limit belongs to the windows concern alone,
// question and permission to the questions concern, answer to the recovery
// concern, probe to the liveness concern, stream-end to the spine's own
// terminal). The arbitration suite derives the same set from the table and
// the install's delegation set and pins this list to it. The map cannot
// drift from the list: HandlerMap is a total record over ServedKind, so a
// missing handler is a type error and an extra one an excess-property error.
export const HANDLER_KINDS = [
  "part",
  "message",
  "error",
  "retry",
  "idle",
] as const satisfies readonly InputKind[]
type ServedKind = (typeof HANDLER_KINDS)[number]
type HandlerMap = { [K in ServedKind]: KindHandler<K> }

// The slices the remainder concern still owns (plans/0061 §4.11): the
// compatibility layer shrinks one slice per extraction unit and is gone with
// its removal. Typed as the union's source of truth — the install below and
// the cell routing both read it, so a stale entry is a type error, not a
// silent mis-route.
export const REMAINDER_KEYS = ["usage", "stepUp", "test"] as const satisfies readonly SliceKey[]
export type RemainderKey = (typeof REMAINDER_KEYS)[number]
// The remainder's slices, pre-created by watch() (the extracted concerns own
// their slices' construction in their own files): the fx's steer-model getter
// and the settle→Watch mapping close over these live objects.
export type RemainderState = { readonly [K in RemainderKey]: TurnState[K] }

// The turn's concern install: the extracted concerns from their files, the
// not-yet-extracted slices delegated to the one remainder handle. Exported
// for the arbitration suite's shrink ratchet: slicesDelegatedTo over this
// install reads exactly the not-yet-extracted set. The liveness concern's
// finalize holds the settle procedure's liveness step (the interrupted
// close-out) and the recovery concern's the raised settle's abort and the
// final classification; the procedure runs them at their first cells'
// positions (liveness in the part row before recovery in the retry row) —
// the order the recovery concern's final classification of the extended
// record rests on.
export const turnConcerns = (
  state: RemainderState,
  handle: Concern<SliceKey>["handle"],
  recovery: Concern<"recovery">,
  liveness: Concern<"liveness">,
): ConcernRoster => ({
  guard: guardConcern,
  transcript: transcriptConcern,
  windows: windowsConcern,
  stuck: stuckConcern,
  questions: questionsConcern,
  failure: failureConcern,
  recovery,
  liveness,
  usage: { name: "usage", initial: () => state.usage, handle },
  stepUp: { name: "stepUp", initial: () => state.stepUp, handle },
  test: { name: "test", initial: () => state.test, handle },
})

// The first not-yet-extracted cell of an input kind's arbitration row. The
// remainder's cells are contiguous in every row, so the kind's handler —
// which runs their statements in today's order — answers for the whole
// segment there; the later cells are covered by that one run and pass.
const firstRemainderCell = (kind: InputKind): RemainderKey | undefined => {
  const cell = TURN_ARBITRATION[kind].find((row) => (REMAINDER_KEYS as readonly SliceKey[]).includes(row.concern))
  return cell?.concern as RemainderKey | undefined
}

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
  // behind the services' back. The router holds the run-wide decision state
  // (the logged usage windows and the model-step cache-claim checks); the git
  // service sits behind the fx's commitFreeze.
  const svcs = services()
  const clock = svcs.clock
  const router = svcs.router
  // Session start timestamp, for computing duration.
  const startTime = clock.now()
  // The figure comes from the usage source of the adapter's tier (plans/0038):
  // the spine feeds it every event of this session (the old loop's
  // source.observe), the body reads its used() at the measurement points.
  const tier = client.capabilities.usage
  const source = usageSource(tier)
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

  // The not-yet-extracted slices (plans/0061 §4.3/§4.11), pre-created here so
  // the fx's steer-model getter and the settle→Watch mapping below hold the
  // same live objects the roster's initials hand back; the body reads and
  // writes them through these aliases exactly where the locals stood. The
  // extracted concerns' slices (guard, transcript, windows, stuck, questions,
  // failure, recovery, liveness) are built by their own initials inside the
  // spine and read through the view.
  const remainderState: RemainderState = {
    usage: { pct: 100, used: 0, hinted: false, notes: new Set<number>() },
    stepUp: { model: steerContext?.model, step: steerContext?.step ?? 0 },
    test: { handover: false, asked: test?.resumeWrapup === true, retried: false },
  }
  const { usage, test: testState } = remainderState
  // The context-step slice (the old steerModel/stepNow/reached locals).
  const steps = remainderState.stepUp

  const sources = makeTurnSources(ctx)
  const fx = makeTurnFx({ ctx, steerModel: () => steps.model, onModel, onLimit })

  // The settle procedure's channel for the interrupted close-out's failure
  // record (both concerns' deps name the discipline): the liveness concern's
  // finalize writes the extension here, the recovery concern's final
  // classification and the settle→Watch mapping read it.
  const extended: { error?: string; info?: ErrorInfo } = {}
  const recovery = makeRecoveryConcern({ answerWith: sources.answerWith, extended })
  const liveness = makeLivenessConcern({ extended })
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
  // The snapshot extras a blocked settle carries: the handler records them
  // beside the settle it returns (the settle itself names only the question),
  // and the mapping below spreads them into the snapshot — which old exit
  // added testHandover / testHandoverInvalid is a property of the exit, not
  // of the input kind.
  let blockedExtra: Partial<Watch> | undefined
  const blockedAdvice = (question: string, extra?: Partial<Watch>): Advice => {
    blockedExtra = { blocked: { type: "blocked", question }, ...(extra ?? {}) }
    return { settle: { kind: "blocked", question } }
  }

  // —— Context steps (plans/0055 §4.5) ——
  // The step-up itself, at the measurement point that crossed the current
  // step's step-up point: steer the same session with the next step's id and
  // the one-line note, record the reached step, and arm the cache-claim
  // check on the wider id. Without the steer capability the note cannot be
  // delivered mid-session; the step still takes effect — the chain's record
  // makes the next prompt into this session name the next id (§4.5). The
  // slice's step moves one-way, up only; reached records the change and the
  // snapshot carries it to attempt for writing back to the chain.
  const stepUp = async (fx: TurnFx, usedNow: number): Promise<void> => {
    const entry = steerContext?.entry
    if (entry === undefined || steerContext === undefined) return
    const nextId = stepId(entry, steps.step + 1)
    const fromId = stepId(entry, steps.step)
    if (nextId === undefined || fromId === undefined) return
    // The step is recorded before the steer goes out: the steer itself names
    // the next id (that is how the session moves), and a failed dispatch
    // still leaves the record — the next prompt into this session names the
    // id, exactly as without the steer capability.
    steps.step += 1
    steps.model = nextId
    steps.reached = { step: steps.step, model: nextId }
    fx.log(`⇡ ${steerContext.label} context ${formatTokens(usedNow)} reached the step-up point of ${steerContext.name} (${fromId}); continuing the same session on ${nextId}`)
    if (client.capabilities.steer) {
      const ok = await fx.steer(renderStepUp({ from: fromId, next: nextId }))
      if (ok) router.awaitCacheClaim(steerContext.name, usedNow)
    } else {
      fx.log(`⇡ ${steerContext.label} the agent takes no mid-turn steers; the next prompt into this session names ${nextId}`)
    }
  }
  // Late step-up (§4.5, §7's overflow exception): the agent compacted before
  // the step-up steer could land — an overflow error below the top step. No
  // steer (the compaction already shrank the context); the reached step is
  // recorded so the next prompt into this session names the next id. Every
  // other overflow stays with the handover mechanism.
  const stepLate = async (fx: TurnFx): Promise<void> => {
    const entry = steerContext?.entry
    if (entry === undefined || steerContext === undefined) return
    const limits = await fx.contextLimits()
    if (steps.step + 1 >= enabledSteps(entry, limits)) return
    const nextId = stepId(entry, steps.step + 1)
    const fromId = stepId(entry, steps.step)
    if (nextId === undefined || fromId === undefined) return
    fx.log(`⇡ ${steerContext.label} step-up late: the agent compacted the session (overflow on ${fromId}) before the step-up steer could land; the next prompt into this session names ${nextId}`)
    steps.step += 1
    steps.model = nextId
    steps.reached = { step: steps.step, model: nextId }
  }
  // --test-by-driver test execution protocol: when the session goes idle,
  // check tmp/test.sh (the request marker, holding a script path under test/
  // or an inline script) → run that script → steer the result back into this
  // session and keep observing; --handover-test switches, when a test fails
  // and used reaches the cap, to asking for a handover document, and the
  // session ends normally once the document is ready (the test slice's
  // handover flag). The kernel calls (the freeze pin, the pending-script
  // resolution, the test execution) all precede their path's single steer —
  // the audit's idle quiet point never trips on this protocol.
  const handleIdleTest = async (fx: TurnFx, view: TurnView): Promise<{ type: "continue" } | { type: "break" } | { type: "blocked"; question: string } | { type: "invalid" }> => {
    // The handover request is out: verify the handover document is finished
    // (F1, last line `Status: continue|done`). The criterion was tightened
    // from "non-empty" to the status line so interruption recovery can tell
    // "the session finished writing" from "a half-written file left by a
    // driver that died mid-write" — the latter must redo the wrap-up, not be
    // taken downstream as a completed handover.
    if (testState.asked) {
      const doc = await fx.readText(test!.handoffFile).catch(() => "")
      if (handoffComplete(doc, false)) {
        testState.handover = true
        return { type: "break" }
      }
      // Handover-boundary write-verify
      // (plans/0022-session-recovery-fidelity-design.md 3.3, strict resume):
      // one invalid document decides it, no more steer-to-backfill retries —
      // "completion is never judged by agent self-report" applies to the
      // handover document too (the S07 phantom-file evidence), and the
      // discovery moment is exactly the handover boundary.
      if (strictResumeActive(opts, switches)) {
        return { type: "invalid" }
      }
      if (testState.retried) {
        return {
          type: "blocked",
          question:
            `the test-handover session failed twice to produce a valid ${test!.handoffFile} (missing, or lacking a \`Status: continue|done\` status line; hidden blockage). ` +
            `Check the file and re-run. Last agent output:\n${view.transcript.lastText.trim().slice(-2000) || "(no output)"}`,
        }
      }
      testState.retried = true
      const ok = await fx.steer(
        `You ended the session last time without writing a valid ${test!.handoffFile} (missing, or lacking the \`Status: continue|done\` status line). This is a hard requirement: ` +
          `write the progress, key decisions, failing-test context and next steps into that file, put the status line on the last line, and only then end the session.`,
      )
      if (!ok) return { type: "blocked", question: `steer dispatch failed (asking to backfill ${test!.handoffFile}); cannot continue the session, see the log.` }
      return { type: "continue" }
    }
    const pending = join(test!.tmp, "test.sh")
    if (!(await fx.exists(pending))) return { type: "break" }
    // The handover decision happens at this moment (D1), before execution —
    // the criterion is already decoupled from test outcome. On a hit the
    // driver first commits the freeze to pin the script down, then dispatches
    // the wrap-up + handover instruction; the test itself runs only after
    // the handover close-out, facing exactly the close-out commit's tree.
    const now = source.used()
    if (testHandoverDue(test!, now)) {
      testState.asked = true
      const n = test!.handovers + 1
      fx.log(
        `⚠ ${test!.label} context used ${formatTokens(now !== undefined && now > 0 ? now : test!.startUsed)} tokens reached the ${formatTokens(test!.limit)} cap; ` +
          `after the frozen commit, hand over first and then run the tests; asking for a handover document before switching to a new session`,
      )
      // Commit #1 (the freeze): pins the script under test and the sources.
      // The session is idle at this moment (this function is driven by the
      // idle event), no half-written files exist — the only safe mid-session
      // commit point; it goes through the git service's afterSession rather
      // than a bare commitTree so proxy-answer collection and reference
      // corrections land inside the freeze — corrections change files and
      // must precede the test start for all three to be the same snapshot.
      // The unit is not yet closed out, so no baseline is passed.
      const pin = await fx.commitFreeze(n)
      if (pin.type === "failed") {
        const pinSubject = suffixedTitle(test!.subject, `test handover #${n} freeze`)
        return { type: "blocked", question: commitBlocked(pinSubject, pin).question }
      }
      // Only consume the request marker and pin the script down; execution
      // is deferred until after the handover wrap-up (runExecSession's
      // test.pending), so the wrap-up period has no concurrent writes at all
      // and the test faces exactly the close-out commit's tree.
      test!.pending = await fx.resolveTest()
      // In-flight handover record (interruption recovery §I): this moment —
      // freeze committed, wrap-up not yet started — is the only correct time
      // to record it: the pending script was just consumed (the marker is
      // gone, a re-run can never read it again), and the session anchor has
      // not yet been buried under the wrap-up messages.
      await fx.saveHandover({
        task: test!.task.id,
        scope: relative(test!.dir, test!.handoffFile),
        unit: test!.unit,
        n,
        script: test!.pending?.script,
        seq: test!.pending?.seq,
        // The pinned session's agent profile (plans/0055 §8.2), under a
        // registry only; absent = the default agent's, as every pre-binding
        // record reads.
        ...(opts.routing ? { agent: opts.routing.runAgent } : {}),
        pinSession: sessionID,
        pinMessage: view.transcript.lastMessage,
      })
      const ok = await fx.steer(renderTestWrapup({ handoffFile: test!.handoffFile }))
      if (!ok) return { type: "blocked", question: "steer dispatch failed (test-handover request); cannot continue the session, see the log." }
      // The wrap-up request is in effect; seed resumeWrapup:
      // the test slice's asked flag is state of this watch instance, and when
      // a mid-wrap-up session error is forked onward by runSession's retry
      // ring / failover ring, the new attempt builds a new watch instance —
      // without this flag the new instance would misjudge "wrap-up finished"
      // as a natural finish and the handover loop would be lost (the pinned
      // script never runs, the handover document is never archived). The
      // same seeding for cross-process interruption lives in exec-session's
      // H1 branch; runExecSession clears it after every runSession return,
      // once closed out.
      test!.resumeWrapup = true
      return { type: "continue" }
    }
    // Archive (a protocol marker whose presence is the request, removed after
    // execution so it can be requested again) → execute → feed back.
    const run = await fx.runTest()
    const ok = await fx.steer(renderTestResult(run))
    if (!ok) return { type: "blocked", question: "steer dispatch failed (test result feedback); cannot continue the session, see the log." }
    return { type: "continue" }
  }

  // —— The remainder's per-input handlers (plans/0061 §4.5): the loop body,
  // cut into one handler per input kind the remainder still serves. Each
  // handler reproduces its old branch's statements — minus what the extracted
  // concerns own (the guard's resets and twin-idle stop, the transcript's
  // echo/billing/report, the windows' limit row, the stuck hint, the
  // questions' question and permission rows, the failure's error
  // accumulation, the recovery's classifier consult and verdicts, the
  // liveness's probe verdicts, announced silence and truncation
  // continuation) — in its arbitration row's order, and reads/writes its own
  // slices through the closure aliases exactly where the branch did; other
  // concerns' slices are read through the view. The handler runs at the row's
  // first remainder cell and answers for the whole contiguous segment. ——
  const handlers: HandlerMap = {
    // The two synthetic-input rows are the concurrent ones, and both are
    // extracted concerns' alone: the probe verdict is the liveness concern's
    // (src/engine/concerns/liveness.ts — the counter, the quiet-window
    // exemption and the half-open judgment; the timer and the probeSession
    // call are the sources'), the classifier's answer the recovery concern's
    // (the answer is recorded there and, while the turn still retries an
    // undecided failure, raises the class as a held settle that preempts the
    // event wait). They run beside an in-flight fx call, so slice writes and
    // log/vlog only — the audit's (c); a settle returned there is held to
    // the next boundary.
    // —— Event inputs: one event of the agent's stream. The session filter
    // and the usage source's observe are the spine's (they preceded every
    // branch of the old loop). ——
    // A part of the agent's output (row: guard → failure → liveness → stepUp
    // → transcript → stuck; the failure and liveness cells are the concerns',
    // the remainder owns the stepUp cell — the cache-claim check).
    part: async (input, fx) => {
      const part = input.event.part
      // The liveness concern's cell before this segment cleared any
      // announced silence (the agent produced output again) and recorded a
      // step-finish's reason. Cache-claim check (§4.5): `wider` asserts the
      // step ids share the base id's prompt cache; the first step-finish
      // after a step-up shows whether it holds (a large cacheRead confirms
      // it, a cacheWrite of the whole prefix contradicts it). The
      // contradiction line fires once per entry.
      if (part.kind === "step-finish" && steerContext?.entry !== undefined) {
        const verdict = router.observeCacheClaim(steerContext.name, part.tokens)
        if (verdict === "confirmed") {
          fx.vlog(`✓ ${steerContext.name}: the wider step read ${formatTokens(part.tokens.cacheRead)} tokens from the shared prompt cache`)
        } else if (verdict === "contradiction" && router.noteClaimContradiction(steerContext.name)) {
          fx.log(
            `⚠ ${steerContext.name}: the first step on the wider id wrote ${formatTokens(part.tokens.cacheWrite)} tokens of cache and read ${formatTokens(part.tokens.cacheRead)} — ` +
              `the wider id does not share the base id's prompt cache as the entry's wider list claims; check the provider's model ids`,
          )
        }
      }
      // The transcript concern's cell follows (the billing dedup, the echo
      // and the fresh flag), then the stuck concern's — this segment never
      // stops the input, so the row carries on.
      return "pass"
    },
    // A message of the session (row: guard → transcript → usage → stepUp;
    // the remainder owns the last two cells). The transcript concern's cell
    // before it stopped everything but a new completed assistant message.
    message: async (input, fx) => {
      const info = input.event.message
      // Measurement point: the usage source already took this message in
      // (events/reported: its own figure; estimated: the running estimate).
      // An unknown figure (none, or none measured yet) changes nothing.
      const now = source.used()
      if (now === undefined) return "consumed"
      const limits = await fx.contextLimits()
      usage.used = now
      // A message that names no model (claude's synthetic API-error message,
      // plans/0057 F21) ran under the window already in effect.
      usage.limit = info.model !== undefined ? limits.get(info.model) : usage.limit
      usage.pct = usage.limit ? Math.round((usage.used / usage.limit) * 100) : 100
      fx.vlog(`  context: ${formatTokens(usage.used)}${usage.limit ? `/${formatTokens(usage.limit)}` : ""} tokens${usage.limit ? ` (${usage.pct}%)` : ""}`)
      if (steer) {
        // Effective wall (plans/0056, plans/0059 D6): the 2×cap budget, raised
        // to a quarter of a large model window and clamped to 80% of any
        // window — the hard-wall hint must leave room to write the handover
        // document. Recomputed per measurement, so a mid-session model step-up
        // widens it naturally.
        const wall = steerWall(steer.limit, usage.limit)
        usage.wall = wall
        if (!usage.hinted && steerDue(tier, now, wall)) {
          // The hard wall supersedes the notice bands (a jump may cross both):
          // one steer, and the bands count as spent.
          usage.hinted = true
          for (const note of steer.notes) usage.notes.add(note.at)
          fx.log(`⚠ context used ${formatTokens(usage.used)} tokens reached the wall ${formatTokens(wall)}; inserting the handover hint`)
          const ok = await fx.steer(steer.text)
          if (!ok) return blockedAdvice("steer dispatch failed (handover hint); cannot continue the session, see the log.")
          // The handover hint owns this measurement point: the session is being
          // wound down by the project's cap, so a step-up steer in the same
          // breath would only confuse it. A session that keeps working past the
          // hint steps up at a later measurement (hinted stays true).
          // AUTO-RESOLVE: when one measurement crosses both the wall and a step-up point, which steer goes out? -> the handover hint (the wall is the operator's policy for ending the session, and the design keeps the two mechanisms independent without ordering them; a session that survives the hint still steps up at its next measurement)
          return "consumed"
        }
        // Milestone usage notices (plans/0056): informational steers, the
        // session decides when to hand over. One steer per measurement point —
        // the highest band newly crossed; lower bands crossed by the same jump
        // are spent with it. Notices do not suppress the step-up check below.
        let fire: Steer["notes"][number] | undefined
        for (const note of steer.notes) {
          if (now < note.at * wall) break
          if (!usage.notes.has(note.at)) fire = note
        }
        if (fire) {
          for (const note of steer.notes) if (note.at <= fire.at) usage.notes.add(note.at)
          fx.log(`• context used ${formatTokens(usage.used)} tokens (${Math.round((usage.used / wall) * 100)}% of the wall ${formatTokens(wall)}); steering a usage notice`)
          const ok = await fx.steer(fillUsageNote(fire.text, now, wall))
          if (!ok) return blockedAdvice("steer dispatch failed (usage notice); cannot continue the session, see the log.")
        }
      }
      // Context steps (§4.5): a live figure that crossed the current step's
      // step-up point steps the same session up in place — steer the next
      // step's id, keep it for the rest of the session. The condition itself
      // is the re-arm: after a step-up the next step's point sits above the
      // current figure, so the next steer happens at its own boundary.
      if (steerContext?.entry !== undefined && liveUsage(tier)) {
        const entry = steerContext.entry
        if (steps.step + 1 < enabledSteps(entry, limits)) {
          const window = limits.get(stepId(entry, steps.step)!)
          if (window !== undefined && now >= stepUpPoint(window)) await stepUp(fx, now)
        }
      }
      return "consumed"
    },
    // A question or permission of the session is the questions concern's row
    // alone (src/engine/concerns/questions.ts): every question path (the
    // plan-session human policy, --wait-answer with its fallback auto-answer,
    // the default permission-question block, the dryrun preflight) and every
    // permission mode (the dryrun deny, auto-allow, the ask-* triad).
    // A session error (row: guard → failure → stepUp; the failure cell is
    // the concern's, the remainder owns the last cell).
    error: async (input, fx, view) => {
      // The failure concern's cell before this segment accumulated the error
      // text, the retryable pessimism and the ErrorInfo (the limit statement
      // laid over); this cell only reads the folded info.
      // Late step-up (§4.5, §7): an overflow below the top step means the
      // agent compacted before the step-up steer could land — record the
      // next step and go on observing (the compacted session continues).
      if (classify(view.failure.info ?? {}) === "overflow") await stepLate(fx)
      return "consumed"
    },
    // A request retry (row: guard → failure → recovery → stepUp → liveness →
    // transcript; the failure, recovery and liveness cells are the concerns'
    // — the failure concern accumulated the signal into the info, the
    // recovery concern consulted the classifier and settled the turn for the
    // classes that cure only by moving, the liveness concern opens the
    // announced-silence window — the remainder owns the stepUp cell). B.4
    // the two signals unified / D.2 trigger surfaces 2 and 3, 0037 D4: the
    // server itself is retrying a failed provider request. The id-carrying
    // form comes from a retry part (self-contained structured ApiError), the
    // id-less form from session.status retry (message/attempt/next, next
    // being the wait until the next attempt — turning "still 40 minutes to
    // wait" into an active decision; old servers may lack fields). The
    // classes that observe on reach this segment: overflow/transient/unknown
    // accumulate without settling, and observation continues (not treated as
    // idle).
    retry: async (_input, fx, view) => {
      // The same overflow read from the retry surface (the agent retried the
      // request that overflowed before compacting): the late step-up applies
      // here exactly as at the session-error handler above.
      // AUTO-DECISION: the read is the patterns' own classification, not a verdict channelled from the recovery cell (the consult's verdict is overflow exactly when the patterns' read is — an answer never raises to overflow, the reply's class union has none — so re-deriving the pattern read needs no channel and no second consult).
      if (classify(view.failure.info ?? {}) === "overflow") await stepLate(fx)
      // The liveness concern's cell follows with the announced silence, then
      // the transcript concern's with the deduplicated retry vlog.
      return "pass"
    },
    // The session gone idle (row: guard → test → liveness → the spine's own
    // natural terminal; the remainder owns the test cell). The guard
    // concern's cell before it stopped the second idle of a twin.
    idle: async (_input, fx, view) => {
      // Test execution protocol: idle first settles any pending test request
      // (execute + steer the result / handover request) before ending; the
      // session is only truly over when there is no pending test request and
      // no unfinished handover request. Every protocol path that steers or
      // settles stops the input here; "break" (nothing pending, or the
      // handover document complete) passes the row on to the liveness cell.
      if (test) {
        const handled = await handleIdleTest(fx, view)
        if (handled.type === "continue") return "consumed"
        if (handled.type === "blocked") return blockedAdvice(handled.question, { testHandover: testState.handover })
        if (handled.type === "invalid") {
          const question =
            `test handover document ${test.handoffFile} missing or empty (strict resume: the boundary write-verify failed; no more backfill retries; ` +
            `this unit will roll back to its baseline and redo). Last agent output:\n${view.transcript.lastText.trim().slice(-2000) || "(no output)"}`
          blockedExtra = { blocked: { type: "blocked", question }, testHandoverInvalid: true }
          return { settle: { kind: "blocked", question, invalid: true } }
        }
      }
      // The liveness concern's cell follows: the truncation continuation, or
      // a pass that lets the spine's own idle terminal settle the turn
      // naturally.
      return "pass"
    },
  }

  // The remainder concern's dispatch (plans/0061 §4.11): the not-yet-extracted
  // roster entries share this one handle. The spine hands it each of its cells
  // in the row's order; the remainder answers at the row's FIRST such cell —
  // its cells are contiguous in every row, and the kind's handler runs their
  // statements in today's order there — and passes at its later cells, which
  // that one run already covered.
  const handle: Concern<SliceKey>["handle"] = async (input, own, view, fx): Promise<Advice> => {
    const key: InputKind = input.kind === "event" ? input.event.type : input.kind
    const first = firstRemainderCell(key)
    if (first === undefined || own !== remainderState[first]) return "pass"
    // The map's construction pairs each key with its payload type, which the
    // union-typed lookup cannot show; the dispatch casts once, here.
    const handler = handlers[key as ServedKind] as (input: TurnInput, fx: TurnFx, view: TurnView) => Promise<Advice>
    return handler(input, fx, view)
  }

  const { settle, view } = await runTurn({ ctx, stream, concerns: turnConcerns(remainderState, handle, recovery, liveness), fx, attach: sources.attach })

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
  // dispatch) carry it in the settle itself, while the remainder's blocked
  // exits record their extras (testHandover, testHandoverInvalid) beside the
  // settle through blockedAdvice — the side channel, when set, is the whole
  // extra.
  const errorText = extended.error ?? view.failure.error
  const failureInfo = extended.error !== undefined ? extended.info : view.failure.info
  if (settle.kind === "blocked") return snapshot(view, blockedExtra ?? { blocked: { type: "blocked", question: settle.question } })
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
    testHandover: testState.handover,
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
