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
// TurnContext from its parameters, installs the slices and the one `remainder`
// concern — every roster entry delegates to the single `handle` below, which
// routes each input to its per-kind handler (the loop body cut one kind at a
// time; the kinds not yet cut still share the remaining monolith) — and hands
// the stream to the spine (src/engine/spine.ts), which owns the
// input queue, the arbitration dispatch, the fx audit and the trip-wired
// stream wrapper. The probe timer and the classifier answer arrive as
// synthetic inputs from src/engine/sources.ts; all of the body's I/O goes
// through the production fx (src/engine/fx.ts) under the spine's audit. What
// remains here besides the body is the mapping of the spine's settle and the
// slices back into the Watch result each old exit returned.

import { join, relative } from "node:path"
import type { AgentClient, AgentError, AgentEvent } from "./agent/types"
import { agentGaveUp, classifySessionError, retryPolicyOf, statedInWording, type ErrorClass, type ErrorInfo, type Watch } from "./chain"
import { acceptedReset, askClassifier, cachedAnswer, classifierFor, describeAnswer, mergeClass, shouldAsk } from "./classify"
import { autoAnswer, commitBlocked, strictResumeActive } from "./unit-commit"
import { suffixedTitle } from "./git"
import { handoffComplete } from "./handover"
import type { Advice, Concern, InputKind, Settle, SliceKey, TurnContext, TurnFx, TurnInput, TurnState } from "./engine/contract"
import { makeTurnFx } from "./engine/fx"
import { makeTurnSources } from "./engine/sources"
import { runTurn, type ConcernRoster } from "./engine/spine"
import { formatDuration } from "./log"
import type { Opts } from "./opts"
import { renderStepUp, renderStuckHint, renderTestWrapup, renderTestResult } from "./prompt"
import { compactText, sameIssue } from "./resolve"
import { describePart, formatTokens, isApproval } from "./session-api"
import { enabledSteps, stepId, stepUpPoint, type SteerContext } from "./model-step"
import { services } from "./services"
import { STUCK_MAX_HINTS, type StuckTracker } from "./stuck"
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

// The per-input handler map (plans/0061 §4.5): one handler per input kind.
// An `event` input keys on its event's own type (the spine's rowOf keying),
// so an event handler receives its AgentEvent variant and a synthetic
// handler its probe/answer/stream-end input. The keys are optional while
// the cut proceeds; with every key present the map is a total record and
// "every input kind has exactly one handler" is a compile-time fact.
type EventInput<K extends AgentEvent["type"]> = { kind: "event"; event: Extract<AgentEvent, { type: K }> }
type KindInput<K extends InputKind> = K extends AgentEvent["type"] ? EventInput<K> : Extract<TurnInput, { kind: K }>
type KindHandler<K extends InputKind> = (input: KindInput<K>, fx: TurnFx) => Promise<Advice>
type HandlerMap = { [K in InputKind]?: KindHandler<K> }

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
  const waitAnswer = opts.waitAnswer ?? 0
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

  // The turn's slices (plans/0061 §4.3): what used to be the body's turn-
  // lifetime locals, grouped by the concern that will own them. The remainder
  // install owns all eleven, so the body below reads and writes them through
  // these aliases exactly where the locals stood. The slices are created here
  // (not inside the roster's initials) so the fx's steer-model getter and the
  // result mapping can hold the same live objects.
  const state: TurnState = {
    guard: { idleHandled: false },
    transcript: {
      lastText: "",
      seen: new Set<string>(),
      billed: new Set<string>(),
      usage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 },
      modelReported: false,
    },
    windows: {},
    stuck: {},
    questions: { autoAnswered: [], resolves: [] },
    failure: { error: "", retrying: false },
    recovery: {},
    liveness: { probeFailures: 0, halfOpen: false, lengthContinued: 0 },
    usage: { pct: 100, used: 0, hinted: false, notes: new Set<number>() },
    stepUp: { model: steerContext?.model, step: steerContext?.step ?? 0 },
    test: { handover: false, asked: test?.resumeWrapup === true, retried: false },
  }
  const { guard, transcript, questions, failure, recovery, liveness, usage, test: testState } = state
  // The token accumulator (the old `usage` local) and the context-step slice
  // (the old steerModel/stepNow/reached locals).
  const tokens = transcript.usage
  const steps = state.stepUp

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
  // extra holds the fields that differ per exit. Rebuilt from the slices:
  // same keys, same conditionals as the old closure over locals.
  const snapshot = (extra?: Partial<Watch>): Watch => ({
    lastText: transcript.lastText,
    pct: usage.pct,
    used: usage.used,
    limit: usage.limit,
    durationMs: clock.now() - startTime,
    usage: tokens,
    resolves: questions.resolves,
    ...(usage.hinted ? { hinted: true } : {}),
    ...(usage.wall !== undefined ? { wall: usage.wall } : {}),
    ...(steps.reached !== undefined ? { steppedUp: steps.reached } : {}),
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
  const handleIdleTest = async (fx: TurnFx): Promise<{ type: "continue" } | { type: "break" } | { type: "blocked"; question: string } | { type: "invalid" }> => {
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
            `Check the file and re-run. Last agent output:\n${transcript.lastText.trim().slice(-2000) || "(no output)"}`,
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
        pinMessage: transcript.lastMessage,
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

  // —— The per-input handlers (plans/0061 §4.5): the loop body, cut one
  // branch at a time into one handler per input kind. Each handler
  // reproduces its old branch's statements in its arbitration row's order
  // and reads/writes the slices through the closure aliases exactly where
  // the branch did; a kind with no entry yet falls through to the monolith
  // below (the cut's temporary compatibility layer, gone once the map is
  // total). ——
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
    // An empty row: no cell dispatches it, the spine's own terminal settles
    // an exhausted stream interrupted. The entry stands so the finished map
    // is total over every input kind.
    "stream-end": async () => "pass",
    // The account's usage windows (plans/0057 §5.2): logged and recorded (§8)
    // when they change, nothing else — not a turn event, so the twin-idle
    // guard is untouched.
    limit: async (input, fx) => {
      if (router.noteWindows(client, input.event)) fx.onLimit(input.event)
      return "consumed"
    },
    // —— Event inputs: one event of the agent's stream. ——
    // A part of the agent's output (row: guard → failure → liveness → stepUp
    // → transcript → stuck).
    part: async (input, fx) => {
      const part = input.event.part
      guard.idleHandled = false
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
      // step-finish increment accumulation (T-003, the one basis that neither
      // duplicates nor misses): re-sends of the same part are not counted
      // twice.
      if (part.kind === "step-finish") {
        // Truncation-continuation criterion (unrelated to the billing
        // dedup; re-sent events overwriting the same value is harmless): a
        // finish other than length (work back to normal after continuation)
        // resets the consecutive-truncation count.
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
        if (!transcript.billed.has(part.id)) {
          transcript.billed.add(part.id)
          tokens.input += part.tokens.input
          tokens.output += part.tokens.output
          tokens.reasoning += part.tokens.reasoning
          tokens.cacheRead += part.tokens.cacheRead
          tokens.cacheWrite += part.tokens.cacheWrite
          tokens.cost += part.cost
          tokens.steps += 1
        }
      }
      if (part.kind === "text") {
        if (part.final) {
          transcript.lastText = part.text
          fx.vlog(part.text)
        }
        return "consumed"
      }
      const line = describePart(part)
      if (line && !transcript.seen.has(part.id)) {
        transcript.seen.add(part.id)
        fx.vlog(line)
        // Stuck-loop detection (src/stuck.ts): each tool call's terminal state
        // is fed to the detector; recognizing "the same action repeated with
        // unchanged results" injects a hint via steer, helping weaker models
        // break out of the spin. Hint only, the session is not aborted; a
        // failed dispatch was already logged by the fx's steer, observation
        // continues as usual. Under a registry the hint also counts into the
        // model's stuck-hint counter (the protocol-drift criterion of 0055
        // §10 item 3); without one steerContext is undefined and
        // statsModelEvent is a no-op (C2).
        if (stuck && part.kind === "tool" && (part.status === "completed" || part.status === "error")) {
          const hit = stuck.observe({
            tool: part.tool,
            input: part.input,
            status: part.status,
            result: (part.status === "error" ? part.error : part.output) ?? "",
          })
          if (hit) {
            fx.log(
              `⚠ repetitive action detected: ${hit.tool} has ${hit.count} consecutive ${hit.kind === "error" ? "identical errors" : "identical calls with identical results"}; ` +
                `inserting a hint (level ${hit.level}/${STUCK_MAX_HINTS})`,
            )
            await fx.statsModelEvent("stuck")
            await fx.steer(renderStuckHint(hit))
          }
        }
      }
      return "consumed"
    },
    // A message of the session (row: guard → transcript → usage → stepUp).
    message: async (input, fx) => {
      const info = input.event.message
      guard.idleHandled = false
      transcript.lastMessage = info.id
      // Actually-used model report (each watch reports only the first
      // message carrying a model): a user message's model is the model the
      // server resolved in effect for this turn; an assistant message's model
      // is the same, as fallback.
      if (info.model !== undefined && !transcript.modelReported) {
        transcript.modelReported = true
        fx.onModel(info.model)
      }
      if (info.role !== "assistant" || !info.completed || transcript.seen.has(info.id)) return "consumed"
      transcript.seen.add(info.id)
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
  }

  // The not-yet-cut remainder of the body: the branches whose kinds have no
  // map entry yet, in their old shape. It shrinks as the cut moves branches
  // into the map and is deleted once the map is total. One call still
  // handles one input from its first table cell (every roster entry
  // delegates to the dispatching handle below), so the advice it returns
  // decides the input: "consumed" is the old body's `continue`, a settle is
  // one of the old early exits, and the natural idle finish names the
  // spine's own terminal settle directly (the row running out would produce
  // the same settle — with every cell delegating to the same handle, the
  // explicit form saves re-entering the body for the remaining cells).
  // AUTO-DECISION: the natural idle finish returns { settle: { kind: "natural" } } from the first cell instead of passing the row through to the spine's own terminal — identical outcome (the row's later cells dispatch to this same handle), no per-input bookkeeping needed.
  const monolith = async (input: { kind: "event"; event: AgentEvent }, fx: TurnFx): Promise<Advice> => {
    // —— External inputs: one event of the agent's stream. The session
    // filter and the usage source's observe are the spine's (they preceded
    // every branch of the old loop). ——
    const event = input.event
    if (event.type === "question") {
      const text = event.questions.join("\n")
      // The dryrun preflight session auto-answers everything, never blocking
      // on a question.
      const permission = opts.dryrun ? false : /\bpermission\b/i.test(text)
      const repeated = questions.autoAnswered.some((prev) => sameIssue(prev, text))
      // plan's sessions (opts.humanQuestions): a non-permission question is a
      // decision for the human — plan runs for human review before execution,
      // and the driver waits for the human answer with no timeout (-i's
      // resident input line or stdin) and never proxy-answers (no
      // AUTO-RESOLVE); only an unanswerable human (closed input channel) or a
      // repeat of the same question blocks, handing it to the human.
      if (!opts.dryrun && opts.humanQuestions && !permission) {
        if (!repeated) {
          questions.autoAnswered.push(text)
          fx.log(`❓ received a non-permission question (waiting for your answer; plan never proxy-answers):\n${text}`)
          const human = await fx.askHuman(undefined, "no timeout and no automatic answer under plan")
          if (human) {
            fx.log(`→ human answer: ${human}`)
            await fx.replyQuestion(event.request, event.questions.map(() => [human]))
            return "consumed"
          }
        }
        await fx.rejectQuestion(event.request)
        await fx.abort()
        return blockedAdvice(
          repeated
            ? `asked again about the same question after the human's answer; handle it manually outside the session, then re-run:\n${text}`
            : `the session asked for a human decision, but no answer could be received (the input channel is closed); answer it outside the session, then re-run:\n${text}`,
        )
      }
      // With --wait-answer both permission and non-permission questions first
      // wait for a human reply; on timeout both fall back to autoAnswer and
      // the AI decides autonomously and continues; only a permission question
      // under the default (no --wait-answer) blocks outright (unattended, the
      // driver cannot decide authorization in the human's stead).
      if (!repeated && (!permission || waitAnswer > 0)) {
        questions.autoAnswered.push(text)
        fx.log(`❓ received a ${permission ? "permission" : "non-permission"} question:\n${text}`)
        const human = waitAnswer > 0 ? await fx.askHuman(waitAnswer, "auto-answered on timeout") : undefined
        const ask = autoSwitches().ask
        const fallback = autoAnswer(ask)
        const reply = human ?? fallback
        // Proxy-answer observation (auto-resolve H1,
        // plans/0020-auto-resolve-design.md §G/§H-①): only fallback auto
        // answers count — a human reply is a real person's decision, and the
        // dryrun preflight produces no engineering decisions. On fallback the
        // old single-line `→ auto answer: <long text>` form is replaced by a
        // two-line highlighted one (the full answer text demoted to verbose
        // logging), making "the driver decided for the user" visible at a
        // glance and countable afterwards in the session log.
        if (human) fx.log(`→ human answer: ${human}`)
        else if (opts.dryrun) fx.log(`→ auto answer: ${fallback}`)
        else {
          questions.resolves.push({ at: clock.now(), question: text, session: sessionID })
          fx.log(`⚑ auto-answer (AUTO-RESOLVE) #${questions.resolves.length}: ${compactText(text)}`)
          fx.log(`  → answered; ${ask ? "the driver recorded it in full; this mode does not require the session to label it separately" : "asking the session to label the decision with AUTO-RESOLVE"}`)
          fx.vlog(`  answer content: ${fallback}`)
        }
        await fx.replyQuestion(event.request, event.questions.map(() => [reply]))
        return "consumed"
      }
      await fx.rejectQuestion(event.request)
      await fx.abort()
      return blockedAdvice(permission ? text : `asked again about the same question after auto-answer; handle it manually outside the session, then re-run:\n${text}`)
    }
    if (event.type === "permission") {
      // dryrun preflight: auto-deny without interrupting the session, so the
      // AI records the blocked item and goes on probing the next one.
      if (opts.dryrun) {
        fx.log(`🔐 preflight probe denied (recorded in the report): ${event.permission} (${event.patterns.join(", ")})`)
        await fx.replyPermission(event.request, "reject")
        return "consumed"
      }
      const desc = `${event.permission} (${event.patterns.join(", ")})`
      const mode = opts.permission ?? "ask-deny"
      // auto-allow: no waiting for a human, auto-approve immediately
      // ("always" lets this request through).
      if (mode === "auto-allow") {
        fx.log(`🔐 permission request received; auto-allowed via --permission auto-allow: ${desc}`)
        await fx.replyPermission(event.request, "always")
        return "consumed"
      }
      // ask-*: first wait for a human (--wait-answer minutes; unset means no
      // wait, i.e. treated as a timeout). An answer of allow/yes/y and the
      // like confirms the authorization ("always" lets it through); any other
      // explicit answer denies the permission without interrupting the
      // session, and the AI works around it and continues; on timeout the
      // mode's fallback applies — ask-allow auto-approves, ask-deny
      // auto-denies but the session continues, ask-fail denies and exits the
      // run.
      let human: string | undefined
      if (waitAnswer > 0) {
        fx.log(`🔐 permission request received: ${desc}`)
        human = await fx.askHuman(
          waitAnswer,
          `enter allow/yes/y to approve; any other answer denies the permission and continues; on timeout handled as --permission ${mode}`,
        )
      } else {
        fx.log(`🔐 permission request received (--wait-answer unset, not waiting for a human; handled as --permission ${mode}): ${desc}`)
      }
      if (human && isApproval(human)) {
        fx.log(`→ human allowed: ${human} (always)`)
        await fx.replyPermission(event.request, "always")
        return "consumed"
      }
      if (human) {
        fx.log(`→ human denied: ${human} (permission denied; the AI continues without it)`)
        await fx.replyPermission(event.request, "reject")
        return "consumed"
      }
      if (mode === "ask-allow") {
        fx.log(`→ wait timed out; --permission ask-allow auto-allowed: ${desc}`)
        await fx.replyPermission(event.request, "always")
        return "consumed"
      }
      await fx.replyPermission(event.request, "reject")
      if (mode === "ask-deny") {
        fx.log(`→ wait timed out; --permission ask-deny auto-denied (the AI continues without it): ${desc}`)
        return "consumed"
      }
      // ask-fail: deny and exit the run (blocked halt, the question recorded
      // in the run log).
      await fx.abort()
      return blockedAdvice(`permission request unanswered (--permission ask-fail): ${desc}. Allow it in the permission rules of the target directory's opencode.json, then re-run.`)
    }
    if (event.type === "error") {
      const e = event.error
      guard.idleHandled = false
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
    }
    // retry (B.4 the two signals unified / D.2 trigger surfaces 2 and 3,
    // 0037 D4): the server itself is retrying a failed provider request. The
    // id-carrying form comes from a retry part (self-contained structured
    // ApiError), the id-less form from session.status retry
    // (message/attempt/next, next being the wait until the next attempt —
    // turning "still 40 minutes to wait" into an active decision; old
    // servers may lack fields). Accumulate the failure slice's info first,
    // then feed the classifier; a quota/auth/rate hit settles this turn
    // early — the still-running old turn on the server must be aborted
    // before returning (the same technique as the stream-interruption
    // cleanup), otherwise it would modify files concurrently with the
    // session forked next (D.2); overflow/transient/unknown only accumulate
    // without settling, and observation continues (not treated as idle).
    if (event.type === "retry") {
      const e = event.error
      guard.idleHandled = false
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
      // here exactly as at the session.error surface above.
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
      if (event.id !== undefined && !transcript.seen.has(event.id)) {
        transcript.seen.add(event.id)
        fx.vlog(`  ↻ request retry (attempt ${event.attempt})`)
      }
      return "consumed"
    }
    // event.type === "idle"
    // Twin-idle dedup: one turn end settles only once. At a turn's end the
    // server emits two idle events in a row (session.status idle +
    // session.idle); after a steer is dispatched via promptAsync (which
    // returns immediately), the second idle arrives before the steer turn
    // starts, and handling it would misjudge the session as finished and
    // settle early. After one idle is handled, further idles are ignored
    // until a new session event appears in this session (a new turn
    // starting) re-arms acceptance.
    if (guard.idleHandled) return "consumed"
    guard.idleHandled = true
    // Test execution protocol: idle first settles any pending test request
    // (execute + steer the result / handover request) before ending; the
    // session is only truly over when there is no pending test request and
    // no unfinished handover request.
    if (test) {
      const handled = await handleIdleTest(fx)
      if (handled.type === "continue") return "consumed"
      if (handled.type === "blocked") return blockedAdvice(handled.question, { testHandover: testState.handover })
      if (handled.type === "invalid") {
        const question =
          `test handover document ${test.handoffFile} missing or empty (strict resume: the boundary write-verify failed; no more backfill retries; ` +
          `this unit will roll back to its baseline and redo). Last agent output:\n${transcript.lastText.trim().slice(-2000) || "(no output)"}`
        blockedExtra = { blocked: { type: "blocked", question }, testHandoverInvalid: true }
        return { settle: { kind: "blocked", question, invalid: true } }
      }
    }
    // Truncated-output continuation (LENGTH_CONTINUE_MAX): with the last
    // step finishing on length and no session error observed, the session's
    // work is unfinished — a short "continue from the cut-off point" steer
    // lets the same session carry on instead of closing out as a natural
    // finish. Twin-idle dedup (the guard slice) and the steer-turn interplay
    // are the same as the handover/test steer paths.
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
    return { settle: { kind: "natural" } }
  }

  // The remainder concern's dispatch (plans/0061 §4.11): every roster entry
  // delegates to this one handle, which routes the input to its per-kind
  // handler. A kind with no map entry yet falls back to the monolith — the
  // cut's temporary compatibility layer, gone once the map is total.
  const handle: Concern<SliceKey>["handle"] = async (input, _own, _view, fx): Promise<Advice> => {
    const key: InputKind = input.kind === "event" ? input.event.type : input.kind
    // The map's construction pairs each key with its payload type, which the
    // union-typed lookup cannot show; the dispatch casts once, here.
    const handler = handlers[key] as ((input: TurnInput, fx: TurnFx) => Promise<Advice>) | undefined
    if (handler !== undefined) return handler(input, fx)
    // Every kind still without a map entry is an event kind, so the
    // fallback's input always carries an event.
    return monolith(input as { kind: "event"; event: AgentEvent }, fx)
  }

  // The remainder install (plans/0061 §4.11, the D1 compatibility layer):
  // one concern holds the whole uncut body and owns every slice — each
  // roster entry hands its pre-created slice back and delegates to the
  // shared handle, so `slicesDelegatedTo` reads the full eleven until the
  // extraction units swap entries for real concerns.
  const concerns: ConcernRoster = {
    guard: { name: "guard", initial: () => state.guard, handle },
    transcript: { name: "transcript", initial: () => state.transcript, handle },
    windows: { name: "windows", initial: () => state.windows, handle },
    stuck: { name: "stuck", initial: () => state.stuck, handle },
    questions: { name: "questions", initial: () => state.questions, handle },
    failure: { name: "failure", initial: () => state.failure, handle },
    recovery: { name: "recovery", initial: () => state.recovery, handle },
    liveness: { name: "liveness", initial: () => state.liveness, handle },
    usage: { name: "usage", initial: () => state.usage, handle },
    stepUp: { name: "stepUp", initial: () => state.stepUp, handle },
    test: { name: "test", initial: () => state.test, handle },
  }

  const { settle } = await runTurn({ ctx, stream, concerns, fx, attach: sources.attach })

  // —— Mapping the settle back to the Watch result each old exit returned ——
  // The early blocked/error settles made their effects inside the handler
  // (their aborts precede the wrapper's close-out there, as they did inside
  // the old loop); what remains is shaping the snapshot.
  if (settle.kind === "blocked") return snapshot(blockedExtra)
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
    return snapshot({
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
  return snapshot({
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
