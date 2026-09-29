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
// stuck, questions; each owning its slice's construction) beside the one
// `remainder` concern that still holds the not-yet-extracted turn code — and
// hands the stream to the spine (src/engine/spine.ts), which owns the input
// queue, the arbitration dispatch, the fx audit and the trip-wired stream
// wrapper. The remainder serves the input kinds whose arbitration row still
// holds one of its cells: the shared `handle` answers at the row's first such
// cell (its cells are contiguous in every row), routing the input to its
// entry of the per-kind handler map — the loop body, cut one branch per input
// kind, minus what the extracted concerns own (the guard's resets and
// twin-idle stop, the transcript's echo/billing/report, the windows' limit
// row, the stuck hint, the questions' question and permission rows). The
// probe timer and the classifier answer arrive as synthetic inputs from
// src/engine/sources.ts; all of the body's I/O goes through the production fx
// (src/engine/fx.ts) under the spine's audit. What remains here besides the
// remainder is the mapping of the spine's settle and the slices back into the
// Watch result each old exit returned.

import { join, relative } from "node:path"
import type { AgentClient, AgentError, AgentEvent } from "./agent/types"
import { agentGaveUp, classifySessionError, retryPolicyOf, statedInWording, type ErrorClass, type ErrorInfo, type Watch } from "./chain"
import { acceptedReset, askClassifier, cachedAnswer, classifierFor, describeAnswer, mergeClass, shouldAsk } from "./classify"
import { commitBlocked, strictResumeActive } from "./unit-commit"
import { suffixedTitle } from "./git"
import { handoffComplete } from "./handover"
import type { Advice, Concern, InputKind, Settle, SliceKey, TurnContext, TurnFx, TurnInput, TurnState, TurnView } from "./engine/contract"
import { guardConcern } from "./engine/concerns/guard"
import { questionsConcern } from "./engine/concerns/questions"
import { stuckConcern } from "./engine/concerns/stuck"
import { transcriptConcern } from "./engine/concerns/transcript"
import { windowsConcern } from "./engine/concerns/windows"
import { makeTurnFx } from "./engine/fx"
import { makeTurnSources } from "./engine/sources"
import { runTurn, TURN_ARBITRATION, type ConcernRoster } from "./engine/spine"
import { formatDuration } from "./log"
import type { Opts } from "./opts"
import { renderStepUp, renderTestWrapup, renderTestResult } from "./prompt"
import { formatTokens } from "./session-api"
import { enabledSteps, stepId, stepUpPoint, type SteerContext } from "./model-step"
import { services } from "./services"
import type { StuckTracker } from "./stuck"
import { autoSwitches, type Switches } from "./switches"
import { fillUsageNote, steerWall, type Steer, type TestRun } from "./testrun"
import { steerDue, testHandoverDue, liveUsage, usageSource } from "./usage"

// Liveness probe parameters (plans/0026-session-boundary-hardening-design.md
// D3): the interval defaults to reusing idleTime (10 minutes, same key and
// same default as the script watchdog, config.idleTime — the timer itself
// lives in src/engine/sources.ts now); **2 consecutive** failures are required
// before judging half-open — to rule out misjudging transient server jitter
// (GC pauses and the like). The short per-probe timeout (30 seconds) is
// session-api's PROBE_TIMEOUT_MS.
const PROBE_MAX_FAILURES = 2

// Truncated-output continuation (2026-09-18, kernel-spi-nor T-030 S13 field
// case): the last step-finish ending with reason length = the model reply was
// truncated by the output limit (cut mid reasoning stream) while the server
// goes idle as usual — this is not a natural finish, the session's work is
// clearly unfinished. A short "continue from the cut-off point" steer lets the
// same session carry on (not one bit of context lost), instead of closing out
// as a natural finish to run shape checks/ticks and then opening a blank
// session that re-reads everything. Consecutive truncations are capped at 3
// (keeping the degenerate form — a single over-long message — from spinning);
// past the cap it still closes out as a natural finish, caught by the existing
// artifact shape-check loop; a step finishing with a reason other than length
// (work back to normal after continuation) resets the count.
const LENGTH_CONTINUE_MAX = 3

// A failure's limit statement (AgentError's limit fields, plans/0057 §5) laid
// over the turn's record: the latest statement stands, and a stated reset
// replaces the earlier reset together with its scope.
function withLimit(info: ErrorInfo, e: AgentError): ErrorInfo {
  const { resetAt, scope, ...rest } = info
  const reset = e.resetAt !== undefined || e.scope !== undefined ? { resetAt: e.resetAt, scope: e.scope } : { resetAt, scope }
  return {
    ...rest,
    ...(reset.resetAt !== undefined ? { resetAt: reset.resetAt } : {}),
    ...(reset.scope !== undefined ? { scope: reset.scope } : {}),
    ...(e.retryAfterMs !== undefined ? { retryAfterMs: e.retryAfterMs } : {}),
    ...(e.limitReason !== undefined ? { limitReason: e.limitReason } : {}),
  }
}

// A failure's own words beneath its structured limit fields (plans/0057
// S4a): a reset the provider states in a known wording (chain.ts
// statedInWording) counts as stated when the event states no limit of its
// own — a header- or stream-stated one outranks it.
function withWording(e: AgentError, now: number): AgentError {
  if (e.resetAt !== undefined || e.scope !== undefined) return e
  const stated = statedInWording(`${e.message ?? ""}\n${e.responseBody ?? ""}`, now)
  return stated !== undefined ? { ...e, ...stated } : e
}

const LIMIT_KEYS = ["resetAt", "scope", "retryAfterMs", "limitReason"] as const

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
// question and permission to the questions concern, stream-end to the spine's
// own terminal). The arbitration suite derives the same set from the table and
// the install's delegation set and pins this list to it. The map cannot drift
// from the list: HandlerMap is a total record over ServedKind, so a missing
// handler is a type error and an extra one an excess-property error.
export const HANDLER_KINDS = [
  "part",
  "message",
  "error",
  "retry",
  "idle",
  "probe",
  "answer",
] as const satisfies readonly InputKind[]
type ServedKind = (typeof HANDLER_KINDS)[number]
type HandlerMap = { [K in ServedKind]: KindHandler<K> }

// The slices the remainder concern still owns (plans/0061 §4.11): the
// compatibility layer shrinks one slice per extraction unit and is gone with
// its removal. Typed as the union's source of truth — the install below and
// the cell routing both read it, so a stale entry is a type error, not a
// silent mis-route.
export const REMAINDER_KEYS = ["failure", "recovery", "liveness", "usage", "stepUp", "test"] as const satisfies readonly SliceKey[]
export type RemainderKey = (typeof REMAINDER_KEYS)[number]
// The remainder's slices, pre-created by watch() (the extracted concerns own
// their slices' construction in their own files): the fx's steer-model getter
// and the settle→Watch mapping close over these live objects.
export type RemainderState = { readonly [K in RemainderKey]: TurnState[K] }

// The turn's concern install: the extracted concerns from their files, the
// not-yet-extracted slices delegated to the one remainder handle. Exported
// for the arbitration suite's shrink ratchet: slicesDelegatedTo over this
// install reads exactly the not-yet-extracted set.
export const turnConcerns = (state: RemainderState, handle: Concern<SliceKey>["handle"]): ConcernRoster => ({
  guard: guardConcern,
  transcript: transcriptConcern,
  windows: windowsConcern,
  stuck: stuckConcern,
  questions: questionsConcern,
  failure: { name: "failure", initial: () => state.failure, handle },
  recovery: { name: "recovery", initial: () => state.recovery, handle },
  liveness: { name: "liveness", initial: () => state.liveness, handle },
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
  // Under a registry with a classifier list, a failure the patterns leave
  // undecided is read by a classifier model beside the event stream: a
  // retry the patterns class unknown (or a rate signal below its threshold)
  // while the agent keeps retrying, and a session error that ends unknown.
  // The ask never holds up the turn; its answer arrives as a synthetic input
  // (the sources' answerWith link) and, when it raises the class while the
  // turn is still retrying, settles the turn exactly as the patterns do
  // (abort, then the key → model → wait escalation). Answers are turn-level
  // state of the recovery slice: `answer` is the latest one known for this
  // turn's failure, `asked` the latest call still on its way — at the turn's
  // end they give the escalation its reset time (resetAt) or the promise of
  // one (pendingReset). `retrying` (the failure slice) is true from a retry
  // event until the model produces output again (the agent's retry got
  // through), so a late answer never aborts a turn that recovered. Without a
  // classifier all of this stays unset and the watch is byte-identical to
  // before (C2).
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
  // extracted concerns' slices (guard, transcript, windows, stuck, questions)
  // are built by their own initials inside the spine and read through the
  // view.
  const remainderState: RemainderState = {
    failure: { error: "", retrying: false },
    recovery: {},
    liveness: { probeFailures: 0, halfOpen: false, lengthContinued: 0 },
    usage: { pct: 100, used: 0, hinted: false, notes: new Set<number>() },
    stepUp: { model: steerContext?.model, step: steerContext?.step ?? 0 },
    test: { handover: false, asked: test?.resumeWrapup === true, retried: false },
  }
  const { failure, recovery, liveness, usage, test: testState } = remainderState
  // The context-step slice (the old steerModel/stepNow/reached locals).
  const steps = remainderState.stepUp

  const sources = makeTurnSources(ctx)
  const fx = makeTurnFx({ ctx, steerModel: () => steps.model, onModel, onLimit })

  // An answer arriving beside the stream asks the classifier through the
  // sources' link: the in-flight call is recorded on the recovery slice and
  // its resolution comes back as a synthetic `answer` input. One call per
  // failing turn (see consult).
  const ask = (info: ErrorInfo): void => {
    const call = classifier !== undefined ? askClassifier(classifier, info) : undefined
    if (call === undefined) return
    recovery.asked = call
    sources.answerWith(call)
  }
  // The pattern verdict of an undecided failure, raised by a known answer:
  // the cached answer about the same message (an earlier call), else this
  // turn's own answer. Without one the classifier is asked — once per turn:
  // a later undecided signal of the same turn (the next retry, the session
  // error that ends it, whose message folds in the retries') waits for that
  // call instead of starting another — and the verdict stands.
  // AUTO-DECISION: one classifier call per failing turn, and the turn's answer covers every undecided signal of that turn (the retries and the closing session error of one turn are one failing request whose wording drifts — the closing error even repeats the retry messages — so a call per distinct message would spend the run's 20-call budget on one failure)
  const consult = (surface: "retry" | "error", info: ErrorInfo, cls: ErrorClass): { cls: ErrorClass; classified: boolean } => {
    if (classifier === undefined || !shouldAsk(surface, info, cls, client.errorPatterns)) return { cls, classified: false }
    // The cache's owner is the classifier's router (the routing facts carry
    // it), which is also where this turn's own ask writes.
    const known = cachedAnswer(classifier.router, info) ?? recovery.answer
    if (known === undefined) {
      if (recovery.asked === undefined) ask(info)
      return { cls, classified: false }
    }
    recovery.answer = known
    const merged = mergeClass(cls, known.class, info, policy)
    return { cls: merged, classified: merged !== cls }
  }
  const raisedLine = (cls: ErrorClass): void => {
    if (classifier === undefined || recovery.answer === undefined) return
    const label = steerContext?.label ? `${steerContext.label} ` : ""
    fx.log(`⚖ ${label}the classifier reads the failure as ${describeAnswer(recovery.answer, classifier.registry.tz, classifier.now())}; settling the turn as ${cls}`)
  }
  // The reset fields a settled failure carries to the escalation: a reset the
  // provider or the agent stated (plans/0057 §5.3, it outranks the
  // classifier's), else the accepted reset time of the known answer, or the
  // answer still on its way. The stated one rides without a registry too: the
  // down marks and the wait-and-probe loop's scheduled sleep (plans/0057 §6)
  // read it, and it carries its scope, which the escalation and the wait line
  // read (§7).
  const resetFields = (): Partial<Watch> => {
    const stated = acceptedReset(failure.info, clock.now())
    if (stated !== undefined) return { resetAt: stated, ...(failure.info?.scope !== undefined ? { scope: failure.info.scope } : {}), resetSource: "stated" }
    if (classifier === undefined) return {}
    if (recovery.answer !== undefined) {
      const at = acceptedReset(recovery.answer, classifier.now())
      return at !== undefined ? { resetAt: at, resetSource: "classifier" } : {}
    }
    const pending = recovery.asked
    return pending !== undefined ? { pendingReset: pending.then((got) => acceptedReset(got, classifier.now())) } : {}
  }
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
  // The settle object the answer handler returned when it raised the class,
  // so the mapping can tell "the turn was settled by the raise" (abort still
  // owed) apart from "a raise landed beside an early error settle that
  // already aborted" (the old body returned the early snapshot and never
  // consulted the raise).
  let raisedSettle: Settle | undefined

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
  // questions' question and permission rows) — in its arbitration row's
  // order, and reads/writes its own slices through the closure aliases
  // exactly where the branch did; other concerns' slices are read through
  // the view. The handler runs at the row's first remainder cell and answers
  // for the whole contiguous segment. ——
  const handlers: HandlerMap = {
    // —— Synthetic inputs (their rows are the concurrent ones: they run
    // beside an in-flight fx call, so slice writes and log/vlog only — the
    // audit's (c); a settle returned here is held to the next boundary). ——
    // The liveness probe's verdict (the old scheduleProbe callback; the
    // timer and the probeSession call are the sources'). A successful probe
    // resets the count; PROBE_MAX_FAILURES consecutive failures judge
    // half-open and settle the turn, which the close-out returns as a
    // retryable session error (classified transient, riding the existing
    // retry ladder and failover ring; a new connection forks onward). The
    // halfOpen guard is the old callback's early return: a verdict landing
    // after the judgment changes nothing more.
    probe: async (input, fx) => {
      if (liveness.halfOpen) return "consumed"
      if (input.ok) {
        liveness.probeFailures = 0
      } else if (liveness.quietUntil !== undefined && input.at < liveness.quietUntil) {
        // The agent announced this silence (§4.2): the verdict waits for the
        // end it named.
        fx.log(`⚠ connectivity probe failed (session ${sessionID}) inside the agent's announced wait; not counted before ${new Date(liveness.quietUntil).toISOString()}`)
      } else {
        liveness.probeFailures += 1
        fx.log(`⚠ connectivity probe failure ${liveness.probeFailures}/${PROBE_MAX_FAILURES} (session ${sessionID}); connection suspected half-open`)
        if (liveness.probeFailures >= PROBE_MAX_FAILURES) {
          liveness.halfOpen = true
          return { settle: { kind: "interrupted" } }
        }
      }
      return "consumed"
    },
    // The classifier's answer (the old onAnswer link): raise the class of
    // the running turn if it is still retrying on an undecided failure; the
    // held settle preempts the event wait (the same preemption the half-open
    // probe uses). A resolution past the wrapper's finish never reaches here
    // (the spine drops it — the old `consuming` guard), and a no-answer
    // resolution is dropped here (the old early return). The settle's object
    // identity is load-bearing: the settle→Watch mapping compares the
    // outcome against `raisedSettle` by identity, so the object stored there
    // is the one this handler returns.
    answer: async (input) => {
      const got = input.answer
      if (got === undefined) return "consumed"
      recovery.answer = got
      if (!failure.retrying || failure.info === undefined || recovery.raised !== undefined) return "consumed"
      const cls = classify(failure.info)
      if (!shouldAsk("retry", failure.info, cls, client.errorPatterns)) return "consumed"
      const merged = mergeClass(cls, got.class, failure.info, policy)
      if (merged !== "quota" && merged !== "auth" && merged !== "rate") return "consumed"
      recovery.raised = merged
      raisedSettle = { kind: "error", cls: merged, classified: true }
      return { settle: raisedSettle }
    },
    // —— Event inputs: one event of the agent's stream. The session filter
    // and the usage source's observe are the spine's (they preceded every
    // branch of the old loop). ——
    // A part of the agent's output (row: guard → failure → liveness → stepUp
    // → transcript → stuck; the remainder owns the middle three cells).
    part: async (input, fx) => {
      const part = input.event.part
      // Model output after a retry: the agent's retry got through, so a late
      // classifier answer no longer settles this turn, an announced silence
      // is over, and what was stated about the limit no longer applies — a
      // later failure of this watch must not carry its reset into a down mark.
      if (part.kind !== "step-start") {
        failure.retrying = false
        const stated = failure.info as ErrorInfo | undefined
        if (stated !== undefined && LIMIT_KEYS.some((key) => stated[key] !== undefined)) {
          const { resetAt: _reset, scope: _scope, retryAfterMs: _wait, limitReason: _reason, ...rest } = stated
          failure.info = rest
        }
        liveness.quietUntil = undefined
      }
      // step-finish increment accumulation (the transcript concern's cell,
      // after this segment) is unrelated to the truncation-continuation
      // criterion and the cache-claim check here: a finish other than length
      // (work back to normal after continuation) resets the consecutive-
      // truncation count.
      if (part.kind === "step-finish") {
        liveness.lastFinish = part.reason
        if (part.reason !== "length") liveness.lengthContinued = 0
        // Cache-claim check (§4.5): `wider` asserts the step ids share the
        // base id's prompt cache; the first step-finish after a step-up shows
        // whether it holds (a large cacheRead confirms it, a cacheWrite of
        // the whole prefix contradicts it). The contradiction line fires
        // once per entry.
        if (steerContext?.entry !== undefined) {
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
    // A session error (row: guard → failure → stepUp; the remainder owns the
    // last two cells).
    error: async (input, fx) => {
      const e = input.event.error
      const errName = e.name ?? ""
      const detail = e.message ?? errName
      failure.error = failure.error ? `${failure.error}\n${detail}` : detail
      // Pessimistic reading: once any session error explicitly carries
      // isRetryable:false (account-level rate limiting and the like, where a
      // re-dispatch or a fresh session fails the same way), the whole turn is
      // judged non-retryable and never retracted by later events.
      if (e.isRetryable === false) failure.retryable = false
      // D.2 trigger surface 1: beyond message/retryable, carry the structured
      // fields into the failure slice's info for classification and reporting
      // (Watch gained errorInfo?, as retryable? did before it — the same kind
      // of precedent). **No control-flow change** — this path never settles
      // early for a failover; it only lets the existing error paths carry the
      // classification up and downstream. The error name (APIError/
      // ProviderAuthError/ContextOverflowError/…) is folded into message so
      // the classifier can recognize the name-keyed classes like overflow/auth
      // (design D.1; the name table is supplied by the adapter).
      const classifyMsg = detail.toLowerCase().includes(errName.toLowerCase()) ? detail : `${errName} ${detail}`
      const prev = failure.info as ErrorInfo | undefined
      failure.info = withLimit(
        {
          ...(prev ?? {}),
          message: prev?.message ? `${prev.message}\n${classifyMsg}` : classifyMsg,
          ...(e.statusCode !== undefined ? { statusCode: e.statusCode } : {}),
          ...(e.responseBody !== undefined ? { responseBody: e.responseBody } : {}),
          ...(e.isRetryable !== undefined ? { isRetryable: e.isRetryable } : {}),
          // The agent's turn failed: it stopped retrying (plans/0057 §4.1).
          terminal: true,
        },
        withWording(e, clock.now()),
      )
      // Late step-up (§4.5, §7): an overflow below the top step means the
      // agent compacted before the step-up steer could land — record the
      // next step and go on observing (the compacted session continues).
      if (classify(failure.info) === "overflow") await stepLate(fx)
      return "consumed"
    },
    // A request retry (row: guard → failure → recovery → stepUp → liveness →
    // transcript; the remainder owns the middle four cells). B.4 the two
    // signals unified / D.2 trigger surfaces 2 and 3, 0037 D4: the server
    // itself is retrying a failed provider request. The id-carrying form
    // comes from a retry part (self-contained structured ApiError), the
    // id-less form from session.status retry (message/attempt/next, next
    // being the wait until the next attempt — turning "still 40 minutes to
    // wait" into an active decision; old servers may lack fields). Accumulate
    // the failure slice's info first, then feed the classifier; a quota/auth/
    // rate hit settles this turn early — the still-running old turn on the
    // server must be aborted before returning (the same technique as the
    // stream-interruption cleanup), otherwise it would modify files
    // concurrently with the session forked next (D.2); overflow/transient/
    // unknown only accumulate without settling, and observation continues
    // (not treated as idle).
    retry: async (input, fx) => {
      const event = input.event
      const e = event.error
      failure.retrying = true
      // A retry means the agent works through a failure again (a later turn
      // of this watch, say): an earlier turn's end is not this signal's.
      const { terminal: _ended, ...before } = failure.info ?? {}
      failure.info = withLimit(
        {
          ...before,
          ...(e.message !== undefined ? { message: e.message } : {}),
          ...(e.statusCode !== undefined ? { statusCode: e.statusCode } : {}),
          ...(e.isRetryable !== undefined ? { isRetryable: e.isRetryable } : {}),
          ...(e.responseBody !== undefined ? { responseBody: e.responseBody } : {}),
          ...(event.attempt !== undefined ? { attempt: event.attempt } : {}),
          ...(event.next !== undefined ? { next: event.next } : {}),
        },
        withWording(e, clock.now()),
      )
      // Undecided by the patterns (plans/0055 §7.1): a cached answer raises
      // the class now; otherwise the classifier is asked beside the stream
      // and its answer settles the turn from the answer input while it still
      // retries.
      const { cls, classified } = consult("retry", failure.info, classify(failure.info))
      // A per-minute cap the agent is still backing off from (plans/0057 §7):
      // its own retrying cures it, so the turn does not settle before the
      // agent gave up — quota wording on a refused request included. (A rate
      // class already waits for agentGaveUp.)
      const perMinute = (failure.info.scope === "request" || failure.info.scope === "token") && !agentGaveUp(failure.info, policy)
      if ((cls === "quota" && !perMinute) || cls === "auth" || cls === "rate") {
        await fx.abort()
        const msg = failure.info.message ?? failure.error
        failure.error = failure.error ? `${failure.error}\n${msg}` : msg
        if (classified) raisedLine(cls)
        // Only isRetryable:false (e.g. insufficient_quota) passes
        // non-retryable down; for the other failover-eligible errors a new
        // session is still pointless but a different model may help — left
        // to P4 (the mapping keeps retryable undefined then).
        return { settle: { kind: "error", cls, classified } }
      }
      // The same overflow read from the retry surface (the agent retried the
      // request that overflowed before compacting): the late step-up applies
      // here exactly as at the session-error handler above.
      if (cls === "overflow") await stepLate(fx)
      // An announced silence (§4.2): the agent honours a wait longer than its
      // silence budget and says nothing more until it is over. The line names
      // its end; the liveness probe counts no failure before it.
      if (policy.honorsRetryAfter && event.next !== undefined && event.next > policy.silenceBudgetMs) {
        const until = clock.now() + event.next
        if (liveness.quietUntil === undefined || Math.abs(until - liveness.quietUntil) >= 1000) {
          fx.log(
            `⏳ the agent waits ${formatDuration(event.next)} before retrying${event.attempt !== undefined ? ` (attempt ${event.attempt})` : ""} (session ${sessionID}); ` +
              `no events are expected until ${new Date(until).toISOString()}`,
          )
        }
        liveness.quietUntil = until
      }
      // The transcript concern's cell follows with the deduplicated retry
      // vlog and ends the input.
      return "pass"
    },
    // The session gone idle (row: guard → test → liveness → the natural
    // settle; the remainder owns the test and liveness cells). The guard
    // concern's cell before it stopped the second idle of a twin.
    idle: async (_input, fx, view) => {
      // Test execution protocol: idle first settles any pending test request
      // (execute + steer the result / handover request) before ending; the
      // session is only truly over when there is no pending test request and
      // no unfinished handover request.
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
      // Truncated-output continuation (LENGTH_CONTINUE_MAX): with the last
      // step finishing on length and no session error observed, the session's
      // work is unfinished — a short "continue from the cut-off point" steer
      // lets the same session carry on instead of closing out as a natural
      // finish. Twin-idle dedup (the guard concern's cell) and the steer-turn
      // interplay are the same as the handover/test steer paths.
      // An agent that takes no further messages (MA.4: steer off) cannot be
      // told to continue; the truncated turn ends as if the cap were used up.
      if (liveness.lastFinish === "length" && !failure.error && liveness.lengthContinued < LENGTH_CONTINUE_MAX && client.capabilities.steer) {
        liveness.lengthContinued++
        // The continuation turn's own step-finish would refresh lastFinish;
        // clear it first after the steer, so the corner case of a new turn
        // with no step-finish cannot repeat the continuation against a stale
        // criterion (the cap bounds it, at most MAX idle spins).
        liveness.lastFinish = undefined
        fx.log(`⚠ session reply truncated by the output length limit (step-finish reason=length); prompting it to continue from the cut-off point (${liveness.lengthContinued}/${LENGTH_CONTINUE_MAX})`)
        const ok = await fx.steer(
          "[DRIVER] Your previous reply was cut off by the output length limit; continue the unfinished work from the cut-off point " +
            "(do not redo what is finished; split long output into several steps / tool calls so you don't hit the limit again).",
        )
        if (!ok) return blockedAdvice("steer dispatch failed (length-continuation hint); cannot continue the session, see the log.")
        return "consumed"
      }
      // AUTO-DECISION: the natural idle finish returns { settle: { kind: "natural" } } from this segment instead of passing the row through to the spine's own idle terminal — identical outcome, no per-input bookkeeping needed.
      return { settle: { kind: "natural" } }
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

  const { settle, view } = await runTurn({ ctx, stream, concerns: turnConcerns(remainderState, handle), fx, attach: sources.attach })

  // —— Mapping the settle back to the Watch result each old exit returned ——
  // The early blocked/error settles made their effects inside the handler
  // (their aborts precede the wrapper's close-out there, as they did inside
  // the old loop); what remains is shaping the snapshot. A blocked settle's
  // question is the Watch blocked field's only varying content: the extracted
  // concerns' blocked exits (the questions concern's blocks) carry it in the
  // settle itself, while the remainder's blocked exits record their extras
  // (testHandover, testHandoverInvalid) beside the settle through
  // blockedAdvice — the side channel, when set, is the whole extra.
  if (settle.kind === "blocked") return snapshot(view, blockedExtra ?? { blocked: { type: "blocked", question: settle.question } })
  if (settle.kind === "error") {
    // The raised settle (a classifier answer raised the class of the
    // retrying turn, plans/0055 §7.1): the synthetic answer handler may not
    // abort (the audit's (c)), so the abort of the still-running old turn
    // lands here — exactly where the old body's post-loop raised path made
    // it, after the stream wrapper's close-out. Settle identity, not the
    // slice's raised flag: a raise that landed beside an early error settle
    // was never consulted by the old body either (its in-loop return won).
    if (settle === raisedSettle) {
      await fx.abort()
      raisedLine(settle.cls)
    }
    const msg = failure.info?.message ?? failure.error
    return snapshot(view, {
      error: msg,
      retryable: failure.info?.isRetryable === false ? false : undefined,
      errorInfo: failure.info,
      errorClass: settle.cls,
      failover: true,
      ...(settle.classified ? { classified: true } : {}),
      ...resetFields(),
    })
  }
  if (settle.kind === "interrupted") {
    // Stream-interruption / half-open close-out: abort the orphan turn that
    // may still be running on the server, avoiding concurrent file writes
    // with the retried new session (abort is harmless to a finished session;
    // with the network already down the call fails silently). The session
    // error goes through attempt's wrapping onto the retry/blocked paths, the
    // progress record stays active, and the next run reuses this session to
    // continue.
    await fx.abort()
    // The probe-judged half-open (D3) and the SSE interruption get distinct
    // messages; the half-open message carries network/timeout criteria for
    // classifySessionError to file as transient — transport-layer faults ride
    // the existing retry ladder and failover ring, no model switch; the
    // failure slice's info is extended in sync so the classification and the
    // upward report have grounds.
    const msg = liveness.halfOpen
      ? `connectivity probe failed ${PROBE_MAX_FAILURES} consecutive times; connection judged half-open (server unresponsive or network down, half-open network timeout)`
      : "event stream interrupted (no session-end event received; suspected server failure or network down)"
    failure.error = failure.error ? `${failure.error}\n${msg}` : msg
    if (liveness.halfOpen) failure.info = { ...(failure.info ?? {}), message: failure.info?.message ? `${failure.info.message}\n${msg}` : msg }
  }
  // A session error that ends unknown (plans/0055 §7.1): a cached answer
  // raises its class; otherwise the classifier is asked now, and its answer
  // serves the next occurrence of the message and the reset time of any
  // down mark this failure leads to. Only provider text is asked about — a
  // bare transport loss has no errorInfo and stays unknown.
  let finalClass: ErrorClass | undefined
  let finalClassified = false
  if (failure.error) {
    const verdict = classify(failure.info ?? {})
    const consulted = failure.info !== undefined ? consult("error", failure.info, verdict) : { cls: verdict, classified: false }
    finalClass = consulted.cls
    finalClassified = consulted.classified
    if (finalClassified) raisedLine(finalClass)
  }
  return snapshot(view, {
    error: failure.error,
    testHandover: testState.handover,
    retryable: failure.retryable,
    // Only when there really is a session error does the classification ride
    // up and downstream (no control-flow change); a normal finish carries
    // neither key, byte-for-byte equivalent to the status quo. The info may
    // be empty (e.g. a pure stream interruption) → classified unknown from
    // the empty input.
    ...(failure.error ? { errorInfo: failure.info, errorClass: finalClass, ...(finalClassified ? { classified: true } : {}), ...resetFields() } : {}),
  })
}
