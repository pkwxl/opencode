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

import { join, relative } from "node:path"
import type { AgentClient, AgentError, AgentEvent } from "./agent/types"
import { agentGaveUp, classifySessionError, retryPolicyOf, statedInWording, type ErrorClass, type ErrorInfo, type Watch } from "./chain"
import { acceptedReset, askClassifier, cachedAnswer, classifierFor, describeAnswer, mergeClass, shouldAsk, type ClassifierAnswer } from "./classify"
import { afterSession, autoAnswer, commitBlocked, strictResumeActive } from "./unit-commit"
import { suffixedTitle } from "./git"
import { handoffComplete, saveHandover } from "./handover"
import { formatDuration, log, vlog } from "./log"
import type { Opts } from "./opts"
import { handoffFile, renderStepUp, renderStuckHint, renderTestWrapup, renderTestResult } from "./prompt"
import { compactText, sameIssue, type ResolveEvent } from "./resolve"
import { askHuman, describePart, formatClientError, formatTokens, isApproval, probeSession } from "./session-api"
import { enabledSteps, stepId, stepUpPoint, type SteerContext } from "./model-step"
import { services } from "./services"
import { statsModelEvent, type Usage } from "./stats"
import { STUCK_MAX_HINTS, type StuckTracker } from "./stuck"
import { autoSwitches, type Switches } from "./switches"
import { executeTest, fillUsageNote, resolveTestScript, steerWall, type Steer, type TestRun } from "./testrun"
import { steerDue, testHandoverDue, liveUsage, usageSource } from "./usage"

// Liveness probe parameters (plans/0026-session-boundary-hardening-design.md
// D3): the interval defaults to reusing idleTime (10 minutes, same key and
// same default as the script watchdog, config.idleTime); **2 consecutive**
// failures are required before judging half-open — to rule out misjudging
// transient server jitter (GC pauses and the like). The short per-probe
// timeout (30 seconds) is session-api's PROBE_TIMEOUT_MS.
const PROBE_INTERVAL_MS = 10 * 60_000
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
   let lastText = ""
   let error = ""
  // Whether the session error is retryable (plans/0015-session-error-retry-
  // plan.md): only ApiError carries isRetryable; the other error types lack
  // the field and default to retryable (undefined).
   let retryable: boolean | undefined = undefined
  // Structured error accumulator (plans/0017-model-routing-design.md D.2): the
  // three trigger surfaces (session.error, retry part, session.status retry)
  // incrementally merge message/statusCode/isRetryable/responseBody
  // (+attempt/next), feeding classification and riding the error result
  // upward; undefined means no structured error signal was received this turn.
   let errorInfo: ErrorInfo | undefined = undefined
    // Context percentage and used amount are always tracked (the input to
    // the usage-driven decisions and the chain's end record); without a
    // limit the percentage records 100.
   // The figure comes from the usage source of the adapter's tier (plans/0038):
   // `used` mirrors it at each measurement point (a completed assistant
   // message) and stays 0 while it is unknown, as before MA.3.
    const tier = client.capabilities.usage
    const source = usageSource(tier)
    let pct = 100
    let used = 0
    let limit: number | undefined = undefined
   // The run's clock (the installed services' clock): every time read and
   // every timer of this watch goes through it — a run on a steered clock
   // observes a steered timeline, and the engine never reads the wall clock
   // behind the services' back.
   const clock = services().clock
   // The run's router (the installed services' router): the logged usage
   // windows and the model-step cache-claim checks are run-wide decision
   // state — the dedup map and the pending claims survive a watch that ends
   // before the first step-finish, exactly as they did as module state.
   const router = services().router
   // Session start timestamp, for computing duration.
   const startTime = clock.now()
  // Token increment accumulation (STATS_PLAN §2, T-003): each step-finish part
  // accumulates deduplicated by part.id (SSE re-sends of the same part's
  // update events are not double-counted); cross-session crosstalk is excluded
  // by the sessionID guard inside the event loop.
  const usage: Usage = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 }
  const billedSteps = new Set<string>()
  // This turn's proxy-answer observations (auto-resolve H1): only "fallback
  // auto answers made without a human reply" make the list — under
  // --wait-answer a real human reply is a real person's decision, and the
  // dryrun preflight only probes permissions; neither is a proxy answer.
  const resolves: ResolveEvent[] = []
  // Turn snapshot (STATS_PLAN §2): every return exit of watch carries
  // durationMs + usage + resolves uniformly, including the early-settling
  // error/blocked exits — consumption and proxy answers really happened, they
  // are not lost. extra holds the fields that differ per exit.
   const snapshot = (extra?: Partial<Watch>): Watch => ({
     lastText,
     pct,
     used,
     limit,
     durationMs: clock.now() - startTime,
     usage,
     resolves,
    ...(steerSent ? { hinted: true } : {}),
    ...(wall !== undefined ? { wall } : {}),
    ...(reached !== undefined ? { steppedUp: reached } : {}),
    ...extra,
  })
  // The steer is inserted at most once per session.
  let steerSent = false
  // The effective wall of the last measurement (with a steer only).
  let wall: number | undefined
  // Usage-note bands already spent (keyed by the band's `at` fraction, plans/
  // 0056): each band steers at most once; a jump crossing several bands sends
  // only the highest, and the hard wall spends them all.
  const noteSent = new Set<number>()
  // Context steps and steer naming (plans/0055 §4.5): under the registry every
  // steer names the model id the session currently runs — i.e. the id of the
  // reached step, so a late steer cannot drop the session back to the base
  // step; the step-up mechanism itself lifts the same session to the next step
  // in place at the measurement point (the message branch below). stepNow is
  // one-way, up only; reached records the change and snapshot carries it to
  // attempt for writing back to the chain. Without a registry (or an entry
  // without model) steerModel stays undefined, steers carry no model key,
  // byte-for-byte equivalent to the status quo.
  let steerModel: string | undefined = steerContext?.model
  let stepNow = steerContext?.step ?? 0
  let reached: { step: number; model: string } | undefined
  // The agent's retry policy (plans/0057 §4): the adapter's record with the
  // registry entry's override. Every pattern verdict below reads the rate
  // threshold from it — a rate signal is the rate class once the agent gave
  // up curing it by itself (chain.ts agentGaveUp).
  const policy = retryPolicyOf(client.retryPolicy, steerContext?.entry?.retry)
  const classify = (info: ErrorInfo): ErrorClass => classifySessionError(info, client.errorPatterns, policy)
  // An announced silence (§4.2): the end of the wait the agent's last retry
  // signal named, when that wait is longer than the policy's silence budget.
  // Until then the liveness probe counts no failure; model output ends it.
  let quietUntil: number | undefined
  // —— The failure-message classifier (plans/0055 §7.1) ——
  // Under a registry with a classifier list, a failure the patterns leave
  // undecided is read by a classifier model beside the event stream: a
  // retry the patterns class unknown (or a rate signal below its threshold)
  // while the agent keeps retrying, and a session error that ends unknown.
  // The call never holds up this loop; its answer, when it raises the class
  // while the turn is still retrying, settles the turn exactly as the
  // patterns do (abort, then the key → model → wait escalation). Answers are
  // turn-level: `answer` is the latest one known for this turn's failure,
  // `asked` the latest call still on its way — at the turn's end they give
  // the escalation its reset time (resetAt) or the promise of one
  // (pendingReset). `retrying` is true from a retry event until the model
  // produces output again (the agent's retry got through), so a late answer
  // never aborts a turn that recovered. Without a classifier all of this
  // stays unset and the watch is byte-identical to before (C2).
   const classifier = classifierFor(client, opts.routing, steerContext?.label, opts.server ? (agent) => opts.server!.client(agent) : undefined)
   let retrying = false
   let consuming = true
   let answer: ClassifierAnswer | undefined
   let asked: Promise<ClassifierAnswer | undefined> | undefined
   let raised: ErrorClass | undefined
   // The reset fields a settled failure carries to the escalation: a reset the
   // provider or the agent stated (plans/0057 §5.3, it outranks the
   // classifier's), else the accepted reset time of the known answer, or the
   // answer still on its way. The stated one rides without a registry too: the
   // down marks and the wait-and-probe loop's scheduled sleep (plans/0057 §6)
   // read it, and it carries its scope, which the escalation and the wait line
   // read (§7).
   const resetFields = (): Partial<Watch> => {
     const stated = acceptedReset(errorInfo, clock.now())
    if (stated !== undefined) return { resetAt: stated, ...(errorInfo?.scope !== undefined ? { scope: errorInfo.scope } : {}), resetSource: "stated" }
    if (classifier === undefined) return {}
    if (answer !== undefined) {
      const at = acceptedReset(answer, classifier.now())
      return at !== undefined ? { resetAt: at, resetSource: "classifier" } : {}
    }
    const pending = asked
    return pending !== undefined ? { pendingReset: pending.then((got) => acceptedReset(got, classifier.now())) } : {}
  }
  // An answer arriving beside the stream: raise the class of the running
  // turn if it is still retrying on an undecided failure, and wake the event
  // loop (the same preemption the half-open probe uses) to settle it.
  const onAnswer = (got: ClassifierAnswer | undefined): void => {
    if (got === undefined || !consuming) return
    answer = got
    if (!retrying || errorInfo === undefined || raised !== undefined) return
    const cls = classify(errorInfo)
    if (!shouldAsk("retry", errorInfo, cls, client.errorPatterns)) return
    const merged = mergeClass(cls, got.class, errorInfo, policy)
    if (merged !== "quota" && merged !== "auth" && merged !== "rate") return
    raised = merged
    trip()
  }
  const ask = (info: ErrorInfo): void => {
    const call = classifier !== undefined ? askClassifier(classifier, info) : undefined
    if (call === undefined) return
    asked = call
    void call.then(onAnswer)
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
    const known = cachedAnswer(info) ?? answer
    if (known === undefined) {
      if (asked === undefined) ask(info)
      return { cls, classified: false }
    }
    answer = known
    const merged = mergeClass(cls, known.class, info, policy)
    return { cls: merged, classified: merged !== cls }
  }
  const raisedLine = (cls: ErrorClass): void => {
    if (classifier === undefined || answer === undefined) return
    const label = steerContext?.label ? `${steerContext.label} ` : ""
    log(`⚖ ${label}the classifier reads the failure as ${describeAnswer(answer, classifier.registry.tz, classifier.now())}; settling the turn as ${cls}`)
  }
  // Questions already auto-answered (a repeat of the same question still
  // blocks and halts).
  const autoAnswered: string[] = []
  // --test-by-driver test execution protocol state: when the session goes
  // idle, check tmp/test.sh (the request marker, holding a script path under
  // test/ or an inline script) → run that script → steer the result back into
  // this session and keep observing; --handover-test switches, when a test
  // fails and used reaches the cap, to asking for a handover document, and the
  // session ends normally once the document is ready (testHandover).
  let testHandover = false
  let testHandoverAsked = test?.resumeWrapup === true
  let testHandoverRetried = false
  // The last message id observed in this session's event stream (test-handover
  // interruption recovery §I): recorded into the in-flight handover record at
  // the freeze moment, so an interruption before the wrap-up finishes can fork
  // a new session from the frozen point to redo the wrap-up. Pure observation,
  // no extra request is sent.
  let lastMessage: string | undefined
  // Whether the actually-used model has been reported (onModel fires at most
  // once per watch).
  let modelReported = false
  // At a turn's end the server emits two idle events in a row (session.status
  // idle + session.idle); after a steer is dispatched via promptAsync (which
  // returns immediately), the second idle arrives before the steer turn
  // starts, and handling it would misjudge the session as finished and break
  // early. After one idle is handled, further idles are ignored until a new
  // session event appears in this session (a new turn starting) re-arms
  // acceptance.
  let idleHandled = false
  // Set only when the session settles normally through an idle event; a stream
  // that exhausts without receiving idle (SSE interruption: server crash or
  // network down) is handled as a session error, not a normal finish —
  // otherwise the driver would mistick subtasks and push the pipeline forward
  // treating an interrupted session as completed.
  let settled = false
  // Steer dispatch uses promptAsync (returns once dispatched): the v2
  // synchronous /message endpoint blocks until the whole turn it started ends,
  // and awaiting it synchronously inside the event loop would deadlock the
  // loop (events piling up, questions/permissions left unanswered). A failed
  // dispatch logs and returns false; the caller treats it as an implicit
  // block instead of silently waiting on.
  // Under the registry the steer names steerModel (the reached step's id,
  // §4.5 "steers name their model"); without a registry it carries no model
  // key, byte-for-byte as the status quo.
  const steerText = async (text: string): Promise<boolean> => {
    source.prompt(text)
    const sent = await client.promptAsync({ session: sessionID, text, ...(steerModel !== undefined ? { model: steerModel } : {}) })
    if (sent.ok) return true
    log(`⚠ steer dispatch failed: ${formatClientError(sent.error)}`)
    return false
  }
  // —— Context steps (plans/0055 §4.5) ——
  // The step-up itself, at the measurement point that crossed the current
  // step's step-up point: steer the same session with the next step's id and
  // the one-line note, record the reached step, and arm the cache-claim
  // check on the wider id. Without the steer capability the note cannot be
  // delivered mid-session; the step still takes effect — the chain's record
  // makes the next prompt into this session name the next id (§4.5).
  const stepUp = async (usedNow: number): Promise<void> => {
    const entry = steerContext?.entry
    if (entry === undefined || steerContext === undefined) return
    const nextId = stepId(entry, stepNow + 1)
    const fromId = stepId(entry, stepNow)
    if (nextId === undefined || fromId === undefined) return
    // The step is recorded before the steer goes out: the steer itself names
    // the next id (that is how the session moves), and a failed dispatch
    // still leaves the record — the next prompt into this session names the
    // id, exactly as without the steer capability.
    stepNow += 1
    steerModel = nextId
    reached = { step: stepNow, model: nextId }
    log(`⇡ ${steerContext.label} context ${formatTokens(usedNow)} reached the step-up point of ${steerContext.name} (${fromId}); continuing the same session on ${nextId}`)
    if (client.capabilities.steer) {
      const ok = await steerText(renderStepUp({ from: fromId, next: nextId }))
      if (ok) router.awaitCacheClaim(steerContext.name, usedNow)
    } else {
      log(`⇡ ${steerContext.label} the agent takes no mid-turn steers; the next prompt into this session names ${nextId}`)
    }
  }
  // Late step-up (§4.5, §7's overflow exception): the agent compacted before
  // the step-up steer could land — an overflow error below the top step. No
  // steer (the compaction already shrank the context); the reached step is
  // recorded so the next prompt into this session names the next id. Every
  // other overflow stays with the handover mechanism.
  const stepLate = async (): Promise<void> => {
    const entry = steerContext?.entry
    if (entry === undefined || steerContext === undefined) return
    limits ??= await client.contextLimits()
    if (stepNow + 1 >= enabledSteps(entry, limits)) return
    const nextId = stepId(entry, stepNow + 1)
    const fromId = stepId(entry, stepNow)
    if (nextId === undefined || fromId === undefined) return
    log(`⇡ ${steerContext.label} step-up late: the agent compacted the session (overflow on ${fromId}) before the step-up steer could land; the next prompt into this session names ${nextId}`)
    stepNow += 1
    steerModel = nextId
    reached = { step: stepNow, model: nextId }
  }
  const handleIdleTest = async (): Promise<{ type: "continue" } | { type: "break" } | { type: "blocked"; question: string } | { type: "invalid" }> => {
    // The handover request is out: verify the handover document is finished
    // (F1, last line `Status: continue|done`). The criterion was tightened
    // from "non-empty" to the status line so interruption recovery can tell
    // "the session finished writing" from "a half-written file left by a
    // driver that died mid-write" — the latter must redo the wrap-up, not be
    // taken downstream as a completed handover.
    if (testHandoverAsked) {
      const doc = await Bun.file(test!.handoffFile).text().catch(() => "")
      if (handoffComplete(doc, false)) {
        testHandover = true
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
      if (testHandoverRetried) {
        return {
          type: "blocked",
          question:
            `the test-handover session failed twice to produce a valid ${test!.handoffFile} (missing, or lacking a \`Status: continue|done\` status line; hidden blockage). ` +
            `Check the file and re-run. Last agent output:\n${lastText.trim().slice(-2000) || "(no output)"}`,
        }
      }
      testHandoverRetried = true
      const ok = await steerText(
        `You ended the session last time without writing a valid ${test!.handoffFile} (missing, or lacking the \`Status: continue|done\` status line). This is a hard requirement: ` +
          `write the progress, key decisions, failing-test context and next steps into that file, put the status line on the last line, and only then end the session.`,
      )
      if (!ok) return { type: "blocked", question: `steer dispatch failed (asking to backfill ${test!.handoffFile}); cannot continue the session, see the log.` }
      return { type: "continue" }
    }
    const pending = join(test!.tmp, "test.sh")
    if (!(await Bun.file(pending).exists())) return { type: "break" }
    // The handover decision happens at this moment (D1), before execution —
    // the criterion is already decoupled from test outcome. On a hit the
    // driver first commits the freeze to pin the script down, then dispatches
    // the wrap-up + handover instruction; the test itself runs only after
    // the handover close-out, facing exactly the close-out commit's tree.
    const now = source.used()
    if (testHandoverDue(test!, now)) {
      testHandoverAsked = true
      const n = test!.handovers + 1
      log(
        `⚠ ${test!.label} context used ${formatTokens(now !== undefined && now > 0 ? now : test!.startUsed)} tokens reached the ${formatTokens(test!.limit)} cap; ` +
          `after the frozen commit, hand over first and then run the tests; asking for a handover document before switching to a new session`,
      )
      // Commit #1 (the freeze): pins the script under test and the sources.
      // The session is idle at this moment (this function is driven by the
      // idle event), no half-written files exist — the only safe mid-session
      // commit point; it goes through afterSession rather than a bare
      // commitTree so proxy-answer collection and reference corrections land
      // inside the freeze — corrections change files and must precede the
      // test start for all three to be the same snapshot. The unit is not yet
      // closed out, so no baseline is passed.
      const pinSubject = suffixedTitle(test!.subject, `test handover #${n} freeze`)
      const pin = await afterSession(test!.dir, opts, test!.task, { stage: `${test!.unit} handoff-${n}-pin`, subject: pinSubject })
      if (pin.type === "failed") {
        return { type: "blocked", question: commitBlocked(pinSubject, pin).question }
      }
      // Only consume the request marker and pin the script down; execution
      // is deferred until after the handover wrap-up (runExecSession's
      // test.pending), so the wrap-up period has no concurrent writes at all
      // and the test faces exactly the close-out commit's tree.
      test!.pending = await resolveTestScript(test!)
      // In-flight handover record (interruption recovery §I): this moment —
      // freeze committed, wrap-up not yet started — is the only correct time
      // to record it: the pending script was just consumed (the marker is
      // gone, a re-run can never read it again), and the session anchor has
      // not yet been buried under the wrap-up messages.
      await saveHandover(test!.dir, {
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
        pinMessage: lastMessage,
      })
      const ok = await steerText(renderTestWrapup({ handoffFile: test!.handoffFile }))
      if (!ok) return { type: "blocked", question: "steer dispatch failed (test-handover request); cannot continue the session, see the log." }
      // The wrap-up request is in effect; seed resumeWrapup:
      // testHandoverAsked is state of this watch instance, and when a
      // mid-wrap-up session error is forked onward by runSession's retry ring
      // / failover ring, the new attempt builds a new watch instance — without
      // this flag the new instance would misjudge "wrap-up finished" as a
      // natural finish and the handover loop would be lost (the pinned script
      // never runs, the handover document is never archived). The same seeding
      // for cross-process interruption lives in exec-session's H1 branch;
      // runExecSession clears it after every runSession return, once closed
      // out.
      test!.resumeWrapup = true
      return { type: "continue" }
    }
    // Archive (a protocol marker whose presence is the request, removed after
    // execution so it can be requested again) → execute → feed back.
    const run = await executeTest(test!, opts)
    const ok = await steerText(renderTestResult(run))
    if (!ok) return { type: "blocked", question: "steer dispatch failed (test result feedback); cannot continue the session, see the log." }
    return { type: "continue" }
  }
  // Recorded parts and messages, so repeated update events for the same part
  // are not output twice.
  const seen = new Set<string>()
  // The finish reason of this session's most recent step-finish (the
  // truncation-continuation criterion, see LENGTH_CONTINUE_MAX):
  // "length" = the reply was truncated by the output limit. Continuation is
  // disabled once a session.error has been observed — the error path (retry
  // ladder / failover ring) takes precedence and does not contend with
  // truncation continuation for the session.
  let lastFinish: string | undefined
  let lengthContinued = 0
  // Model context limits (model string → window), fetched on first need.
  let limits: ReadonlyMap<string, number> | undefined
  // In-flight liveness probe (D3/§4.4): while watching, every idleTime, over
  // an independent short-timeout connection, GET the session metadata;
  // PROBE_MAX_FAILURES consecutive failures judge half-open — log, trip
  // preempts the event wait, and at close-out the session is aborted and
  // returned as a retryable session error (classified transient, riding the
  // existing retry ladder and failover ring; a new connection forks onward).
  // A successful probe resets the count. attempt starts this function before
  // dispatching the prompt, so the probe covers the in-flight POST window;
  // the timer is cleaned up in the generator's finally below, on every exit.
  let probeFailures = 0
  let halfOpen = false
  // Probe-chain active flag: after watch closes out (the generator's
  // finally), a late callback of an in-flight probe must not schedule another
  // timer.
  let probeActive = true
  let cancelProbe: (() => void) | undefined
  // Preempts the event wait when the probe judges half-open: in the half-open
  // case no more events ever arrive on the stream, and a for-await over the
  // original stream would block forever on next(), leaving the probe result
  // with no way to take effect — hence the stream is wrapped in an iterator
  // that races the trip.
  let trip!: () => void
  const tripped = new Promise<void>((resolve) => (trip = resolve))
  const scheduleProbe = () => {
    cancelProbe = clock.timer(opts.idleMs ?? PROBE_INTERVAL_MS, () => {
      cancelProbe = undefined
      void (async () => {
        const ok = await probeSession(client, sessionID)
        if (!probeActive || halfOpen) return
        if (ok) {
          probeFailures = 0
        } else if (quietUntil !== undefined && clock.now() < quietUntil) {
          // The agent announced this silence (§4.2): the verdict waits for
          // the end it named.
          log(`⚠ connectivity probe failed (session ${sessionID}) inside the agent's announced wait; not counted before ${new Date(quietUntil).toISOString()}`)
        } else {
          probeFailures += 1
          log(`⚠ connectivity probe failure ${probeFailures}/${PROBE_MAX_FAILURES} (session ${sessionID}); connection suspected half-open`)
          if (probeFailures >= PROBE_MAX_FAILURES) {
            halfOpen = true
            trip()
            return
          }
        }
        scheduleProbe()
      })()
    })
  }
  scheduleProbe()
  const raced = (async function* () {
    const inner = stream[Symbol.asyncIterator]()
    try {
      for (;;) {
        const step = await Promise.race([inner.next(), tripped.then((): IteratorResult<AgentEvent> => ({ done: true, value: undefined }))])
        if (step.done) return
        yield step.value
      }
    } finally {
      probeActive = false
      consuming = false
      if (cancelProbe !== undefined) cancelProbe()
      // This generator can only be suspended at a yield, closed out by the
      // consumer (a return enters finally immediately), so cleanup has no
      // delay. At the half-open preemption exit the inner iterator holds a
      // suspended next() (the old connection never resolves), and return()
      // would queue behind it and wait forever too — skip it, attempt's
      // sse.abort() cancels the underlying reader to close out; at the other
      // exits there is no suspended next(), return() drives the inner finally
      // (releasing the reader lock), matching a bare for-await.
      // A classifier answer settling the retrying turn preempts the same way
      // (the stream is live, its next event may be minutes away): skipped too.
      if (!halfOpen && raised === undefined) await inner.return?.().catch(() => {})
    }
  })()
  for await (const event of raced) {
    // A classifier answer raised the class while events kept queueing: stop
    // here and settle below, as the preemption would have.
    if (raised !== undefined) break
    if (event.session !== sessionID) continue
    source.observe(event)
    // The account's usage windows (plans/0057 §5.2): logged and recorded (§8)
    // when they change, nothing else — not a turn event, so the twin-idle
    // guard is untouched.
    if (event.type === "limit") {
      if (router.noteWindows(client, event)) onLimit?.(event)
      continue
    }
    if (event.type === "part") {
      const part = event.part
      idleHandled = false
      // Model output after a retry: the agent's retry got through, so a late
      // classifier answer no longer settles this turn, an announced silence
      // is over, and what was stated about the limit no longer applies — a
      // later failure of this watch must not carry its reset into a down mark.
      if (part.kind !== "step-start") {
        retrying = false
        quietUntil = undefined
        const stated = errorInfo as ErrorInfo | undefined
        if (stated !== undefined && LIMIT_KEYS.some((key) => stated[key] !== undefined)) {
          const { resetAt: _reset, scope: _scope, retryAfterMs: _wait, limitReason: _reason, ...rest } = stated
          errorInfo = rest
        }
      }
      // step-finish increment accumulation (T-003, the one basis that neither
      // duplicates nor misses): re-sends of the same part are not counted
      // twice.
      if (part.kind === "step-finish") {
        // Truncation-continuation criterion (unrelated to the billing
        // dedup; re-sent events overwriting the same value is harmless): a
        // finish other than length (work back to normal after continuation)
        // resets the consecutive-truncation count.
        lastFinish = part.reason
        if (part.reason !== "length") lengthContinued = 0
        // Cache-claim check (§4.5): `wider` asserts the step ids share the
        // base id's prompt cache; the first step-finish after a step-up shows
        // whether it holds (a large cacheRead confirms it, a cacheWrite of
        // the whole prefix contradicts it). The contradiction line fires
        // once per entry.
        if (steerContext?.entry !== undefined) {
          const verdict = router.observeCacheClaim(steerContext.name, part.tokens)
          if (verdict === "confirmed") {
            vlog(`✓ ${steerContext.name}: the wider step read ${formatTokens(part.tokens.cacheRead)} tokens from the shared prompt cache`)
          } else if (verdict === "contradiction" && router.noteClaimContradiction(steerContext.name)) {
            log(
              `⚠ ${steerContext.name}: the first step on the wider id wrote ${formatTokens(part.tokens.cacheWrite)} tokens of cache and read ${formatTokens(part.tokens.cacheRead)} — ` +
                `the wider id does not share the base id's prompt cache as the entry's wider list claims; check the provider's model ids`,
            )
          }
        }
        if (!billedSteps.has(part.id)) {
          billedSteps.add(part.id)
          usage.input += part.tokens.input
          usage.output += part.tokens.output
          usage.reasoning += part.tokens.reasoning
          usage.cacheRead += part.tokens.cacheRead
          usage.cacheWrite += part.tokens.cacheWrite
          usage.cost += part.cost
          usage.steps += 1
        }
      }
      if (part.kind === "text") {
        if (part.final) {
          lastText = part.text
          vlog(part.text)
        }
        continue
      }
      const line = describePart(part)
      if (line && !seen.has(part.id)) {
        seen.add(part.id)
        vlog(line)
        // Stuck-loop detection (src/stuck.ts): each tool call's terminal state
        // is fed to the detector; recognizing "the same action repeated with
        // unchanged results" injects a hint via steer, helping weaker models
        // break out of the spin. Hint only, the session is not aborted; a
        // failed dispatch was already logged by steerText, observation
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
            log(
              `⚠ repetitive action detected: ${hit.tool} has ${hit.count} consecutive ${hit.kind === "error" ? "identical errors" : "identical calls with identical results"}; ` +
                `inserting a hint (level ${hit.level}/${STUCK_MAX_HINTS})`,
            )
            await statsModelEvent(opts.dir, steerContext?.name, "stuck")
            await steerText(renderStuckHint(hit))
          }
        }
      }
      continue
    }
    if (event.type === "message") {
      const info = event.message
      idleHandled = false
      lastMessage = info.id
      // Actually-used model report (each watch reports only the first
      // message carrying a model): a user message's model is the model the
      // server resolved in effect for this turn; an assistant message's model
      // is the same, as fallback.
      if (info.model !== undefined && !modelReported) {
        modelReported = true
        onModel?.(info.model)
      }
      if (info.role !== "assistant" || !info.completed || seen.has(info.id)) continue
      seen.add(info.id)
      // Measurement point: the usage source already took this message in
      // (events/reported: its own figure; estimated: the running estimate).
      // An unknown figure (none, or none measured yet) changes nothing.
      const now = source.used()
      if (now === undefined) continue
      limits ??= await client.contextLimits()
      used = now
      // A message that names no model (claude's synthetic API-error message,
      // plans/0057 F21) ran under the window already in effect.
      limit = info.model !== undefined ? limits.get(info.model) : limit
      pct = limit ? Math.round((used / limit) * 100) : 100
      vlog(`  context: ${formatTokens(used)}${limit ? `/${formatTokens(limit)}` : ""} tokens${limit ? ` (${pct}%)` : ""}`)
      if (steer) {
        // Effective wall (plans/0056, plans/0059 D6): the 2×cap budget, raised
        // to a quarter of a large model window and clamped to 80% of any
        // window — the hard-wall hint must leave room to write the handover
        // document. Recomputed per measurement, so a mid-session model step-up
        // widens it naturally.
        wall = steerWall(steer.limit, limit)
        if (!steerSent && steerDue(tier, now, wall)) {
          // The hard wall supersedes the notice bands (a jump may cross both):
          // one steer, and the bands count as spent.
          steerSent = true
          for (const note of steer.notes) noteSent.add(note.at)
          log(`⚠ context used ${formatTokens(used)} tokens reached the wall ${formatTokens(wall)}; inserting the handover hint`)
          const ok = await steerText(steer.text)
          if (!ok) {
            return snapshot({
              blocked: { type: "blocked", question: "steer dispatch failed (handover hint); cannot continue the session, see the log." },
            })
          }
          // The handover hint owns this measurement point: the session is being
          // wound down by the project's cap, so a step-up steer in the same
          // breath would only confuse it. A session that keeps working past the
          // hint steps up at a later measurement (steerSent stays true).
          // AUTO-RESOLVE: when one measurement crosses both the wall and a step-up point, which steer goes out? -> the handover hint (the wall is the operator's policy for ending the session, and the design keeps the two mechanisms independent without ordering them; a session that survives the hint still steps up at its next measurement)
          continue
        }
        // Milestone usage notices (plans/0056): informational steers, the
        // session decides when to hand over. One steer per measurement point —
        // the highest band newly crossed; lower bands crossed by the same jump
        // are spent with it. Notices do not suppress the step-up check below.
        let fire: Steer["notes"][number] | undefined
        for (const note of steer.notes) {
          if (now < note.at * wall) break
          if (!noteSent.has(note.at)) fire = note
        }
        if (fire) {
          for (const note of steer.notes) if (note.at <= fire.at) noteSent.add(note.at)
          log(`• context used ${formatTokens(used)} tokens (${Math.round((used / wall) * 100)}% of the wall ${formatTokens(wall)}); steering a usage notice`)
          const ok = await steerText(fillUsageNote(fire.text, now, wall))
          if (!ok) {
            return snapshot({
              blocked: { type: "blocked", question: "steer dispatch failed (usage notice); cannot continue the session, see the log." },
            })
          }
        }
      }
      // Context steps (§4.5): a live figure that crossed the current step's
      // step-up point steps the same session up in place — steer the next
      // step's id, keep it for the rest of the session. The condition itself
      // is the re-arm: after a step-up the next step's point sits above the
      // current figure, so the next steer happens at its own boundary.
      if (steerContext?.entry !== undefined && liveUsage(tier)) {
        const entry = steerContext.entry
        if (stepNow + 1 < enabledSteps(entry, limits)) {
          const window = limits.get(stepId(entry, stepNow)!)
          if (window !== undefined && now >= stepUpPoint(window)) await stepUp(now)
        }
      }
      continue
    }
    if (event.type === "question") {
      const text = event.questions.join("\n")
      // The dryrun preflight session auto-answers everything, never blocking
      // on a question.
      const permission = opts.dryrun ? false : /\bpermission\b/i.test(text)
      const repeated = autoAnswered.some((prev) => sameIssue(prev, text))
      // plan's sessions (opts.humanQuestions): a non-permission question is a
      // decision for the human — plan runs for human review before execution,
      // and the driver waits for the human answer with no timeout (-i's
      // resident input line or stdin) and never proxy-answers (no
      // AUTO-RESOLVE); only an unanswerable human (closed input channel) or a
      // repeat of the same question blocks, handing it to the human.
      if (!opts.dryrun && opts.humanQuestions && !permission) {
        if (!repeated) {
          autoAnswered.push(text)
          log(`❓ received a non-permission question (waiting for your answer; plan never proxy-answers):\n${text}`)
          const human = await askHuman(undefined, "no timeout and no automatic answer under plan", opts.interactive, opts.dir)
          if (human) {
            log(`→ human answer: ${human}`)
            await client.replyQuestion(event.request, event.questions.map(() => [human]))
            continue
          }
        }
        await client.rejectQuestion(event.request)
        await client.abort(sessionID)
        return snapshot({
          blocked: {
            type: "blocked",
            question: repeated
              ? `asked again about the same question after the human's answer; handle it manually outside the session, then re-run:\n${text}`
              : `the session asked for a human decision, but no answer could be received (the input channel is closed); answer it outside the session, then re-run:\n${text}`,
          },
        })
      }
      // With --wait-answer both permission and non-permission questions first
      // wait for a human reply; on timeout both fall back to autoAnswer and
      // the AI decides autonomously and continues; only a permission question
      // under the default (no --wait-answer) blocks outright (unattended, the
      // driver cannot decide authorization in the human's stead).
      if (!repeated && (!permission || waitAnswer > 0)) {
        autoAnswered.push(text)
        log(`❓ received a ${permission ? "permission" : "non-permission"} question:\n${text}`)
        const human = waitAnswer > 0 ? await askHuman(waitAnswer, "auto-answered on timeout", opts.interactive, opts.dir) : undefined
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
        if (human) log(`→ human answer: ${human}`)
        else if (opts.dryrun) log(`→ auto answer: ${fallback}`)
        else {
          resolves.push({ at: clock.now(), question: text, session: sessionID })
          log(`⚑ auto-answer (AUTO-RESOLVE) #${resolves.length}: ${compactText(text)}`)
          log(`  → answered; ${ask ? "the driver recorded it in full; this mode does not require the session to label it separately" : "asking the session to label the decision with AUTO-RESOLVE"}`)
          vlog(`  answer content: ${fallback}`)
        }
        await client.replyQuestion(event.request, event.questions.map(() => [reply]))
        continue
      }
      await client.rejectQuestion(event.request)
      await client.abort(sessionID)
      return snapshot({
        blocked: {
          type: "blocked",
          question: permission ? text : `asked again about the same question after auto-answer; handle it manually outside the session, then re-run:\n${text}`,
        },
      })
    }
    if (event.type === "permission") {
      // dryrun preflight: auto-deny without interrupting the session, so the
      // AI records the blocked item and goes on probing the next one.
      if (opts.dryrun) {
        log(`🔐 preflight probe denied (recorded in the report): ${event.permission} (${event.patterns.join(", ")})`)
        await client.replyPermission(event.request, "reject")
        continue
      }
      const desc = `${event.permission} (${event.patterns.join(", ")})`
      const mode = opts.permission ?? "ask-deny"
      // auto-allow: no waiting for a human, auto-approve immediately
      // ("always" lets this request through).
      if (mode === "auto-allow") {
        log(`🔐 permission request received; auto-allowed via --permission auto-allow: ${desc}`)
        await client.replyPermission(event.request, "always")
        continue
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
        log(`🔐 permission request received: ${desc}`)
        human = await askHuman(
          waitAnswer,
          `enter allow/yes/y to approve; any other answer denies the permission and continues; on timeout handled as --permission ${mode}`,
          opts.interactive,
          opts.dir,
        )
      } else {
        log(`🔐 permission request received (--wait-answer unset, not waiting for a human; handled as --permission ${mode}): ${desc}`)
      }
      if (human && isApproval(human)) {
        log(`→ human allowed: ${human} (always)`)
        await client.replyPermission(event.request, "always")
        continue
      }
      if (human) {
        log(`→ human denied: ${human} (permission denied; the AI continues without it)`)
        await client.replyPermission(event.request, "reject")
        continue
      }
      if (mode === "ask-allow") {
        log(`→ wait timed out; --permission ask-allow auto-allowed: ${desc}`)
        await client.replyPermission(event.request, "always")
        continue
      }
      await client.replyPermission(event.request, "reject")
      if (mode === "ask-deny") {
        log(`→ wait timed out; --permission ask-deny auto-denied (the AI continues without it): ${desc}`)
        continue
      }
      // ask-fail: deny and exit the run (blocked halt, the question recorded
      // in the run log).
      await client.abort(sessionID)
      return snapshot({
        blocked: {
          type: "blocked",
          question: `permission request unanswered (--permission ask-fail): ${desc}. Allow it in the permission rules of the target directory's opencode.json, then re-run.`,
        },
      })
    }
    if (event.type === "error") {
      const e = event.error
      idleHandled = false
      const errName = e.name ?? ""
      const detail = e.message ?? errName
      error = error ? `${error}\n${detail}` : detail
      // Pessimistic reading: once any session error explicitly carries
      // isRetryable:false (account-level rate limiting and the like, where a
      // re-dispatch or a fresh session fails the same way), the whole turn is
      // judged non-retryable and never retracted by later events.
      if (e.isRetryable === false) retryable = false
      // D.2 trigger surface 1: beyond message/retryable, carry the structured
      // fields into errorInfo for classification and reporting (Watch gained
      // errorInfo?, as retryable? did before it — the same kind of
      // precedent). **No control-flow change** — this path never settles
      // early for a failover; it only lets the existing error paths carry the
      // classification up and downstream. The error name (APIError/
      // ProviderAuthError/ContextOverflowError/…) is folded into message so
      // the classifier can recognize the name-keyed classes like overflow/auth
      // (design D.1; the name table is supplied by the adapter).
      const classifyMsg = detail.toLowerCase().includes(errName.toLowerCase()) ? detail : `${errName} ${detail}`
      const prev = errorInfo as ErrorInfo | undefined
      errorInfo = withLimit(
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
      if (classify(errorInfo) === "overflow") await stepLate()
      continue
    }
    // retry (B.4 the two signals unified / D.2 trigger surfaces 2 and 3,
    // 0037 D4): the server itself is retrying a failed provider request. The
    // id-carrying form comes from a retry part (self-contained structured
    // ApiError), the id-less form from session.status retry
    // (message/attempt/next, next being the wait until the next attempt —
    // turning "still 40 minutes to wait" into an active decision; old
    // servers may lack fields). Accumulate errorInfo first, then feed the
    // classifier; a quota/auth/rate hit settles this turn early — the
    // still-running old turn on the server must be aborted before returning
    // (the same technique as the stream-interruption cleanup), otherwise it
    // would modify files concurrently with the session forked next (D.2);
    // overflow/transient/unknown only accumulate without settling, and
    // observation continues (not treated as idle).
    if (event.type === "retry") {
      const e = event.error
      idleHandled = false
      retrying = true
      // A retry means the agent works through a failure again (a later turn
      // of this watch, say): an earlier turn's end is not this signal's.
      const { terminal: _ended, ...before } = errorInfo ?? {}
      errorInfo = withLimit(
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
      // and its answer settles the turn from onAnswer while it still retries.
      const { cls, classified } = consult("retry", errorInfo, classify(errorInfo))
      // A per-minute cap the agent is still backing off from (plans/0057 §7):
      // its own retrying cures it, so the turn does not settle before the
      // agent gave up — quota wording on a refused request included. (A rate
      // class already waits for agentGaveUp.)
      const perMinute = (errorInfo.scope === "request" || errorInfo.scope === "token") && !agentGaveUp(errorInfo, policy)
      if ((cls === "quota" && !perMinute) || cls === "auth" || cls === "rate") {
        await client.abort(sessionID)
        const msg = errorInfo.message ?? error
        error = error ? `${error}\n${msg}` : msg
        if (classified) raisedLine(cls)
        return snapshot({
          error: msg,
          // Only isRetryable:false (e.g. insufficient_quota) passes
          // non-retryable down; for the other failover-eligible errors a new
          // session is still pointless but a different model may help — left
          // to P4 (retryable stays undefined).
          retryable: errorInfo.isRetryable === false ? false : undefined,
          errorInfo,
          errorClass: cls,
          failover: true,
          ...(classified ? { classified: true } : {}),
          ...resetFields(),
        })
      }
      // The same overflow read from the retry surface (the agent retried the
      // request that overflowed before compacting): the late step-up applies
      // here exactly as at the session.error surface above.
      if (cls === "overflow") await stepLate()
      // An announced silence (§4.2): the agent honours a wait longer than its
      // silence budget and says nothing more until it is over. The line names
      // its end; the liveness probe counts no failure before it.
      if (policy.honorsRetryAfter && event.next !== undefined && event.next > policy.silenceBudgetMs) {
        const until = clock.now() + event.next
        if (quietUntil === undefined || Math.abs(until - quietUntil) >= 1000) {
          log(
            `⏳ the agent waits ${formatDuration(event.next)} before retrying${event.attempt !== undefined ? ` (attempt ${event.attempt})` : ""} (session ${sessionID}); ` +
              `no events are expected until ${new Date(until).toISOString()}`,
          )
        }
        quietUntil = until
      }
      if (event.id !== undefined && !seen.has(event.id)) {
        seen.add(event.id)
        vlog(`  ↻ request retry (attempt ${event.attempt})`)
      }
      continue
    }
    if (event.type === "idle") {
      // Twin-idle dedup: one turn end settles only once (see the idleHandled
      // comment).
      if (idleHandled) continue
      idleHandled = true
      // Test execution protocol: idle first settles any pending test request
      // (execute + steer the result / handover request) before ending; the
      // session is only truly over when there is no pending test request and
      // no unfinished handover request.
      if (test) {
        const handled = await handleIdleTest()
        if (handled.type === "continue") continue
        if (handled.type === "blocked") {
          return snapshot({ blocked: { type: "blocked", question: handled.question }, testHandover })
        }
        if (handled.type === "invalid") {
          return snapshot({
            blocked: {
              type: "blocked",
              question:
                `test handover document ${test.handoffFile} missing or empty (strict resume: the boundary write-verify failed; no more backfill retries; ` +
                `this unit will roll back to its baseline and redo). Last agent output:\n${lastText.trim().slice(-2000) || "(no output)"}`,
            },
            testHandoverInvalid: true,
          })
        }
      }
      // Truncated-output continuation (LENGTH_CONTINUE_MAX): with the last
      // step finishing on length and no session error observed, the session's
      // work is unfinished — a short "continue from the cut-off point" steer
      // lets the same session carry on instead of closing out as a natural
      // finish. Twin-idle dedup (idleHandled) and the steer-turn interplay
      // are the same as the handover/test steer paths.
      // An agent that takes no further messages (MA.4: steer off) cannot be
      // told to continue; the truncated turn ends as if the cap were used up.
      if (lastFinish === "length" && !error && lengthContinued < LENGTH_CONTINUE_MAX && client.capabilities.steer) {
        lengthContinued++
        // The continuation turn's own step-finish would refresh lastFinish;
        // clear it first after the steer, so the corner case of a new turn
        // with no step-finish cannot repeat the continuation against a stale
        // criterion (the cap bounds it, at most MAX idle spins).
        lastFinish = undefined
        log(`⚠ session reply truncated by the output length limit (step-finish reason=length); prompting it to continue from the cut-off point (${lengthContinued}/${LENGTH_CONTINUE_MAX})`)
        const ok = await steerText(
          "[DRIVER] Your previous reply was cut off by the output length limit; continue the unfinished work from the cut-off point " +
            "(do not redo what is finished; split long output into several steps / tool calls so you don't hit the limit again).",
        )
        if (!ok) return snapshot({ blocked: { type: "blocked", question: "steer dispatch failed (length-continuation hint); cannot continue the session, see the log." } })
        continue
      }
      settled = true
      break
    }
  }
  // A classifier answer raised the class of the retrying turn (plans/0055
  // §7.1): settle it exactly as the retry branch settles a pattern verdict —
  // abort the running turn first, then hand the class to the escalation.
  if (raised !== undefined) {
    await client.abort(sessionID)
    const msg = errorInfo?.message ?? error
    error = error ? `${error}\n${msg}` : msg
    raisedLine(raised)
    return snapshot({
      error: msg,
      retryable: errorInfo?.isRetryable === false ? false : undefined,
      errorInfo,
      errorClass: raised,
      failover: true,
      classified: true,
      ...resetFields(),
    })
  }
  if (!settled) {
    // Stream-interruption / half-open close-out: abort the orphan turn that
    // may still be running on the server, avoiding concurrent file writes
    // with the retried new session (abort is harmless to a finished session;
    // with the network already down the call fails silently). The session
    // error goes through attempt's wrapping onto the retry/blocked paths, the
    // progress record stays active, and the next run reuses this session to
    // continue.
    await client.abort(sessionID)
    // The probe-judged half-open (D3) and the SSE interruption get distinct
    // messages; the half-open message carries network/timeout criteria for
    // classifySessionError to file as transient — transport-layer faults ride
    // the existing retry ladder and failover ring, no model switch; errorInfo
    // is attached in sync so the classification and the upward report have
    // grounds.
    const msg = halfOpen
      ? `connectivity probe failed ${PROBE_MAX_FAILURES} consecutive times; connection judged half-open (server unresponsive or network down, half-open network timeout)`
      : "event stream interrupted (no session-end event received; suspected server failure or network down)"
    error = error ? `${error}\n${msg}` : msg
    if (halfOpen) errorInfo = { ...(errorInfo ?? {}), message: errorInfo?.message ? `${errorInfo.message}\n${msg}` : msg }
  }
  // A session error that ends unknown (plans/0055 §7.1): a cached answer
  // raises its class; otherwise the classifier is asked now, and its answer
  // serves the next occurrence of the message and the reset time of any
  // down mark this failure leads to. Only provider text is asked about — a
  // bare transport loss has no errorInfo and stays unknown.
  let finalClass: ErrorClass | undefined
  let finalClassified = false
  if (error) {
    const verdict = classify(errorInfo ?? {})
    const consulted = errorInfo !== undefined ? consult("error", errorInfo, verdict) : { cls: verdict, classified: false }
    finalClass = consulted.cls
    finalClassified = consulted.classified
    if (finalClassified) raisedLine(finalClass)
  }
  return snapshot({
    error,
    testHandover,
    retryable,
    // Only when there really is a session error does the classification ride
    // up and downstream (no control-flow change); a normal finish carries
    // neither key, byte-for-byte equivalent to the status quo. errorInfo may
    // be empty (e.g. a pure stream interruption) → classified unknown from
    // the empty input.
    ...(error ? { errorInfo, errorClass: finalClass, ...(finalClassified ? { classified: true } : {}), ...resetFields() } : {}),
  })
}
