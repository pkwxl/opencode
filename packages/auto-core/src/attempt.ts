// The executor of a single prompt dispatch: it builds the dispatch plan's
// facts (the takeover gate's capability, the live context windows, the
// selection context of the run state), asks the pure planner of
// src/engine/dispatch.ts, and executes the plan — session creation, model
// target evaluation, progress recovery-point write, stats segment close, and
// wiring in the event-stream subscription (watch) before waiting for the
// session's natural finish — writing the chain only through the named
// transitions of src/chain-transitions.ts. The proxy-answer ledger writer
// recordDriverResolves is called only by this layer, so it belongs here too.
// Every run has a registry — a layer-backed one, or the implicit registry
// the env switches synthesize where no layer exists — so this executor
// always resolves its routing facts (the loop's own for a run; the implicit
// ones for a bare options literal) and every routing decision is
// selection's.
// Sits below session.ts (whose runSession retry/failover ring calls this
// function on each pass) and calls only the layers below — watch / session-api
// / stats; **must never import session / runner back upward**.
// Split out of src/runner.ts (plans/0024-module-split-plan.md S8, pure move).

import { rm } from "node:fs/promises"
import { join, relative } from "node:path"
import type { AgentClient } from "./agent/types"
import type { SessionChain, SessionResult } from "./chain"
import {
  afterTestHandover,
  announceModel,
  bindAgent,
  consumeNote,
  consumePending,
  promote,
  resetRoute,
  restoreRetryable,
  setRoute,
  stepTo,
  toAgent,
  type ChainPrior,
} from "./chain-transitions"
import { formatClientError, formatTokens } from "./format"
import { commitTitle, unitBaseline } from "./git"
import { recallHandover, saveHandover, type Handover } from "./handover"
import { formatCost, formatDurationCompact, formatUsageLine, log, vlog } from "./log"
import { DEFAULT_CONTEXT_LIMIT, type ClientSource, type Opts } from "./opts"
import { currentRound } from "./phases"
import { accountOf, learnObserved } from "./quota-windows"
import { recordResolves, type ResolveEvent } from "./resolve"
import { forgetProgress, peekProgress, saveProgress } from "./resume"
import { routingOf, selectContext } from "./routing"
import { services } from "./services"
import { clientOf, contextLimitsOf, missingAgentHint, renameSession, zeroUsage } from "./session-api"
import { statsSessionBegin, statsSessionEnd } from "./stats"
import { createStuckTracker } from "./stuck"
import type { Switches } from "./switches"
import { type Task } from "./tasks"
import { type Steer, type TestRun } from "./testrun"
import { strictResumeActive } from "./unit-commit"
import { watch } from "./watch"
import { planDispatch } from "./engine/dispatch"

// H3's ledger writer: proxy answers observed during the round get their
// task/phase/round/session filled in, then are posted to the ledger. With no
// observations it is a no-op (reads no round number, touches no file), so the
// common "whole round without questions" path adds zero IO.
async function recordDriverResolves(opts: Opts, taskID: string, events: ResolveEvent[] | undefined): Promise<void> {
  if (!opts.dir || !events?.length) return
  const round = await currentRound(opts.dir).catch(() => 0)
  await recordResolves(
    opts.dir,
    events.map((event) => ({
      at: event.at,
      task: taskID,
      phase: opts.phase?.id ?? "",
      round,
      session: event.session,
      source: "driver" as const,
      question: event.question,
    })),
  )
}

export async function attempt(
  client: ClientSource,
  task: Task,
  promptText: string,
  opts: Opts,
  chain: SessionChain,
  steer: Steer | undefined,
  test: TestRun | undefined,
  switches: Switches,
): Promise<SessionResult> {
  // Test-run protocol: clear the pending test script left by the previous
  // session / previous run (presence means a request; a stale request from an
  // interruption-recovery or retry scenario must not be injected into this
  // session; archived history tmp/test.<n>.sh is kept).
  if (test) await rm(join(test.tmp, "test.sh"), { force: true })
  const cap = opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT
  // The run's clock (the installed services' clock): every time read of this
  // dispatch goes through it.
  const clock = services().clock
  // The run's router (the installed services' router): the session-scope
  // failback clear is run-wide decision state this dispatch writes.
  const router = services().router
  const clockNow = (): number => clock.now()
  // The chain's own agent decides the takeover gate's capability (the chain's
  // session lives on it); a chain without a session — and without a pending
  // fork — has none yet and needs no host for it (the gate only reads
  // capabilities when a session exists).
  const resumable = chain.id !== undefined || chain.pending !== undefined ? (await clientOf(client, chain.agent)).capabilities.resume : true
  // Session-scope failback (§6.4): a brand-new session starts from the
  // preferred model — the marks clear before the plan's selection (the pick
  // then returns the primary at the session's first prompt, as the scope
  // promises) and the chain's route resets with them. A resumed takeover and
  // a consumed fork keep their state: the migrated session a failover forked
  // out goes the pending path and must not oscillate back.
  const takeover = resumable && chain.id !== undefined && chain.note !== undefined && chain.pending === undefined
  if (!takeover && chain.pending === undefined && switches.modelFailbackScope === "session") {
    resetRoute(chain)
    router.clearDownMarks("session", switches.modelFailbackScope)
  }
  // The run's routing facts, always defined: the loop's own for a run, else
  // the implicit registry over the env switches on this dispatch's reads of
  // the installed services' clock and router (a bare options literal that
  // never knew routing) — routing.ts's routingOf, the fallback's one home
  // (D9, plans/0069 §2.2).
  const routing = routingOf(opts, switches, clock, router)
  // Registry selection runs before anything is created (plans/0055 §8.3): a
  // session never crosses agents, so the pick decides whose host serves the
  // dispatch — the client the session is created on, the host syncContext
  // reaches and the chain's agent all come from it. The selection context is
  // the seam the volatile run state (down marks, the /failback override, the
  // key rings, the live windows) enters the pure planner through.
  const limits = await contextLimitsOf(client)
  const plan = planDispatch(chain, {
    routing,
    ctx: selectContext(routing, switches, cap, limits),
    resumable,
    label: task.id,
    entry: opts.phase?.entry,
  })
  if (plan.blocked !== undefined) return plan.blocked
  const pick = plan.pick
  // This dispatch's model, from the plan's pick (resolved before anything
  // was created; promptModel is the pick's key, the strict-resume record's
  // model). Assigned at the dispatch's slot below; nothing reads either
  // variable before that point.
  let promptModel: string | undefined
  let target: string | undefined
  const promptVariant = pick?.variant
  // The watch's steer context (§4.5): the picked candidate's key, its
  // entry (when the pick is one) and the step the dispatch names — all from
  // the plan.
  const steerKey = pick?.route.entry
  const steerEntry = pick?.entry
  const steerStep = pick?.route.step
  // The agent profile this dispatch's session lives on (§8.3): the pick's
  // entry profile, the default agent for a raw override value.
  const pickAgent = pick?.agent
  // The per-model/per-tier stats keys of this dispatch (plans/0055 §7.1
  // "Stats"): the pick's candidate key (an internal name, or the raw
  // `provider/model` string of an override value) and the tier the session
  // was routed as — booked whatever the registry's origin (a layer-less run
  // books the implicit registry's names).
  // AUTO-DECISION: a raw override value books the underlying tier too, not
  // only the models map (the ◈ line shows that tier beside the raw value, so
  // the tier summary and the display read the same dispatch the same way;
  // keying the models map alone would leave the tier summary blind to every
  // overridden session).
  const statsModel = pick?.route.entry
  const statsTier = pick?.tier
  // The plan's chain writes, in its recorded order: the route the pick put
  // the dispatch on, the ◈ announcement of the model (a continuation of the
  // same session and model is not repeated), then the cross-agent move —
  // whose toAgent drops the chain's session slots and cancels the takeover
  // (the plan's resumed already accounts for it).
  if (pick !== undefined) {
    setRoute(chain, pick.route)
    if (pick.announce !== undefined) {
      log(pick.announce)
      announceModel(chain, pick.route.entry)
    }
  }
  if (plan.move !== undefined) {
    if (plan.move.pendingLog !== undefined) log(plan.move.pendingLog)
    toAgent(chain, plan.move.note)
  }
  const resumed = plan.resumed
  // The fallback value of the test-handover criterion (D1): a resumed
  // (recovery-takeover) session starts out carrying the chain's already-used
  // tokens, so a test request arriving before the first message.updated must
  // still be judged correctly; a fork and a brand-new session reset it to
  // zero — chain.used is the previous session's leftover, and copying it
  // would make a small just-started session falsely test over-limit on its
  // first test and burn a handover for nothing.
  if (test) test.startUsed = resumed ? chain.used : 0
  // A pre-created fork session (what seedForkSession forked from the base
  // point) outranks create when no takeover is due; consuming clears it — by
  // a transient-error retry pending is already clear, so the flow falls back
  // to the create path naturally (design §4.3).
  const forked = resumed ? undefined : chain.pending
  consumePending(chain)
  // The client this dispatch runs on (§8.1): the pick's agent, the chain's
  // for a consumed fork or a takeover (the same agent the pick kept).
  const dispatchClient: AgentClient = await clientOf(client, pickAgent ?? (resumed || forked !== undefined ? chain.agent : undefined))
  // Sync AGENTS.md before a new session: with an update, restart the server
  // before opening the new session so it loads the latest system context
  // (AGENTS.md is re-read live on every provider turn; the restart backstops
  // cached cases). A forked session was already synced before seedForkSession
  // forked it.
  if (!resumed && !forked) await opts.server?.syncContext(pickAgent ?? chain.agent)
  // Explicit title: a new session is named directly with this phase's commit
  // title (a short label, e.g. `T-001 S2 write schema`); a session without a
  // commit title (dryrun etc.) falls back to `[auto] <task>`; a forked
  // session was already renamed by forkSession and does not go through
  // create.
  const session = resumed || forked ? undefined : await dispatchClient.create({ title: chain.subject ? commitTitle(chain.subject) : `[auto] ${task.id} ${task.title}` })
  if (session && !session.ok) return { type: "blocked", question: `session creation failed: ${formatClientError(session.error)}` }
  const sessionID = forked ?? session?.value.id ?? chain.id!
  // Session-agent binding (plans/0055 §8.2): the chain's session lives on
  // the agent profile this dispatch picked — the pick's entry profile, the
  // default agent for a raw override value (the agent pool runs one host per
  // profile, §8.1, so the session truly lives on it). Every way a chain
  // acquires a session funnels through this line — a create, a consumed fork
  // (pending, seeded by the retry / failover / recovery paths or a fork
  // base), and a resumed takeover (chain.id from the record, which runTask
  // restored from the record's own agent) — so the binding is written here
  // once per dispatch, before any record goes to disk. The pick exists on
  // every dispatch (a blocked selection returned above) — every registry,
  // the implicit one included, names the profile its pick runs on.
  if (pick !== undefined) bindAgent(chain, pick.agent)
  // Interactive bypass: human input goes to this session from here on (wrap-up
  // and other bypass sessions override it the same way); the sideband
  // resolves the client per session from the chain's agent (§8.1). The
  // attach agent is the pick's entry profile.
  opts.interactive?.attach(sessionID, pickAgent)
  // Test-handover interruption recovery (§I): the continuation session opened
  // after the handover close-out is claimed here — when it is itself
  // interrupted, the next run forks from it to pick the context back up. The
  // pre-freeze session (the record still carries the pending script and the
  // freeze anchor) is not claimed; recovery from that state forks at the
  // freeze point.
  // The claim likewise follows "write on dispatch + restore on failure":
  // written at the start (a mid-run kill still has an anchor), but when the
  // session ends on a 0-token retryable error it is restored to the pre-claim
  // record — a pure error stub is unfit as a recovery anchor, otherwise in a
  // consecutive-quota-failure incident the last 0-token stub would displace
  // the continuation session that actually has content (2026-09-17 virtio
  // T-005: the 41.3k session's nextSession was overwritten by retry 3's
  // 0-token stub), and the restart could only fork an empty shell. The same
  // line as the chain.failed replacement invariant.
  let handoverClaimPrior: Handover | undefined
  if (test && opts.dir) {
    const inflight = await recallHandover(opts.dir, task.id, relative(test.dir, test.handoffFile))
    if (inflight && inflight.script === undefined && inflight.pinSession === undefined && inflight.nextSession !== sessionID) {
      handoverClaimPrior = inflight
      // The claimed continuation session carries its agent (plans/0055 §8.2):
      // the claim is this dispatch's session, on the agent it was created on.
      await saveHandover(opts.dir, { ...inflight, nextSession: sessionID, ...(chain.agent !== undefined ? { agent: chain.agent } : {}) })
    }
  }
  // Progress record: a session carrying a phase (the execution chain + a
  // phase-step bypass) writes an active record, from which an interrupted app
  // resumes precisely; a phase-less bypass session (dryrun / fork base etc.)
  // writes none, to avoid polluting the recovery memory.
  // plans/0018-session-resume-precedence-design.md: persist the claim of the
  // running session as soon as dispatch succeeds (previously written only
  // after the round ended, so a kill mid-round lost the claim); a retryable
  // error restores the record to its pre-dispatch snapshot so an abandoned
  // fork copy does not displace the real recovery point (keeping the
  // protection of point 4 of plans/0015-session-error-retry-plan.md, reworked
  // as "write on dispatch + restore on failure").
  // This prompt's effective model (backfilled after target evaluation; the
  // remember write uses it for the strict-resume record).
  const remember = async () => {
    if (opts.dir && chain.phase) {
      await saveProgress(opts.dir, {
        task: task.id,
        session: sessionID,
        at: clockNow(),
        active: true,
        phase: chain.phase,
        // Strict resume (plans/0022-session-recovery-fidelity-design.md 3.1):
        // the active record carries the unit baseline and this prompt's
        // effective model (checked at recovery; with no routing configured for
        // model there is no string to record, and under strict resume such a
        // record counts as non-reusable). When the baseline lacks a thread,
        // the current HEAD backs it up (the window starts now).
        ...(strictResumeActive(opts, switches)
          ? { baseline: chain.baseline ?? (await unitBaseline(opts.dir)), model: promptModel }
          : {}),
        // The session's agent profile (plans/0055 §8.2): present whenever
        // the chain holds its session's agent (every dispatch binds one —
        // the implicit registry's profile for a layer-less run); absent for
        // a pre-binding record whose chain never dispatched.
        ...(chain.agent !== undefined ? { agent: chain.agent } : {}),
      })
    }
  }
  // The progress.json snapshot from before dispatch: restored on a retryable
  // error, preventing an abandoned copy from displacing the real recovery
  // point.
  const prior = opts.dir && chain.phase ? await peekProgress(opts.dir) : undefined

  // The SSE subscription follows this session's lifetime: subscribe with an
  // AbortSignal passed in, and whether the end is a normal finish, an early
  // return on dispatch failure, or an abnormal exit, finally aborts the
  // subscription immediately, dropping the underlying connection and
  // releasing the client connection quota — previously nobody closed the
  // subscription, GC was relied on; over long runs the SSE long connections
  // of finished sessions kept piling up, and after filling the client
  // concurrency pool (Bun default 256) every later request queued forever
  // inside the pool with no timeout error, manifesting as a silent hang.
  const sse = new AbortController()
  // The sync POST's abort signal (H7): when watch's verdict of a half-open
  // connection / broken stream or the like returns before the hung POST does,
  // abort is chained — the POST is voided immediately instead of hanging
  // until TURN_TIMEOUT (2h), and the retry ladder starts at the probe's
  // verdict moment (~2×idleTime).
  const post = new AbortController()
  // Idempotent guard of the stats segment close (STATS_PLAN §2, T-003): the
  // normal path closes the segment after awaiting watching; paths that never
  // reach the normal close (dispatch failure, exception, ...) are backstopped
  // by finally — the AI segment never hangs.
  let booked = false
  // Stuck-loop tracker (session level, see src/stuck.ts): not built when the
  // switch is off; a dryrun preflight session never gets one — it probes
  // permissions precisely by being refused over and over, so repeated errors
  // are its normal shape, not a stuck loop.
  const stuck = switches.stuck && !opts.dryrun ? createStuckTracker() : undefined
  try {
    const events = await dispatchClient.events(sse.signal)
    // The dispatch's model pair: the plan's pick, resolved before anything
    // was created (plans/0055 §6 — the pick also names the agent whose host
    // serves the dispatch, §8.3, and this answers the pick's route rather
    // than re-selecting). An undefined target sends no model key: the picked
    // entry runs on the agent's own default model (the implicit registry's
    // `default` entry, or an entry declared without a model).
    const models = router.dispatchModel(pick?.route)
    target = models.target
    promptModel = models.promptModel
    // The actually-used model reaches the terminal (frontend-visible): when
    // the pick gives an explicit target, dispatch locks that model and the
    // report names its source directly; without one (target undefined) the
    // report no longer guesses the server default (a session sticking to a
    // model etc. would distort the guess) — instead watch observes this
    // session's first message carrying a model (the user message carries the
    // server's actual resolution) and then reports the real effective model.
    // Every new session (created / forked) reports one line, and so does a
    // model change against the previous prompt; a continuation prompt on the
    // same session and model (a resumed takeover) is not repeated. Whatever
    // the source, the decision whether the prompt carries a model key is
    // unchanged (invariant F unbroken). The named-model ◈ line is the plan's
    // own announce (logged where the pick's chain writes run, above); the
    // server-resolved form below is the watch's observation.
    // When the liveness probe's verdict — a half-open connection or the like
    // ending the session (session-boundary-hardening §4.4) — returns before
    // the hung POST does: drop the stream early, releasing the SSE reader and
    // the connection quota, and chain-abort the POST (the race below no
    // longer waits for it, going straight into this result's session-error
    // close-out). Repeated aborts of an already-aborted subscription are
    // harmless; the normal-finish path sees no effect here.
    let watchFailed = false
    const watching = watch(
      dispatchClient,
      sessionID,
      events,
      opts,
      steer,
      test,
      stuck,
      switches,
      target === undefined
        ? (model) => {
            if (model !== chain.modelShown || !resumed) {
              log(`◈ ${task.id} using model ${model} (server resolved)`)
              announceModel(chain, model)
            }
          }
        : undefined,
      // Registry steers name their model (§4.5): the watch carries the entry's
      // steps (the same session steps up in place) and the id every steer
      // names — the reached step. steerKey is the pick's entry; an entry
      // without steps (the implicit registry's, say) passes the plain
      // context and steers stay model-less, exactly as before.
      steerKey !== undefined ? { name: steerKey, label: task.id, ...(steerEntry !== undefined ? { entry: steerEntry } : {}), ...(steerStep !== undefined ? { step: steerStep } : {}), ...(target !== undefined ? { model: target } : {}) } : undefined,
      // A changed usage-window observation is recorded for the account the
      // chain dispatches on (plans/0057 §8), read when the event arrives.
      // The facts go in as a value (the account the routing names, or none):
      // a carry, not a branch.
      (event) => void learnObserved(opts.dir, accountOf(chain, routing), event, clockNow()),
    ).then((w) => {
      if (w.error) {
        watchFailed = true
        sse.abort()
        post.abort()
      }
      return w
    })

    // One-shot notes (interruption recovery etc.) ride the first prompt to
    // the AI and are cleared once used.
    const note = chain.note
    consumeNote(chain)
    // Stats wiring (STATS_PLAN §2, T-003): open the AI segment and associate
    // the task before the prompt is dispatched. Bypass sessions (pseudo tasks
    // PLAN/AUTO; recovery-point precedent in resume.ts) are recorded the same
    // way — when statsTask has no current task set, usage/sessions still land
    // in the phase+round buckets.
    await statsSessionBegin(opts.dir, task.id)
    // Dispatch races the event stream (H7): when the sync POST hangs on a
    // half-open connection and never returns, watch's probe verdict comes
    // back first — if watch returns with an error first, the sentinel null
    // takes over (the POST is already voided by post.abort() above), skips
    // waiting for the POST and goes straight into the session-error close-out
    // of watching below; with no watch error, the POST's own result passes
    // through. After losing the race, prompting's late result has no consumer
    // (dispatch never rejects, 0037 D2, so nothing to catch).
    const prompting = dispatchClient.prompt(
      {
        session: sessionID,
        agent: opts.agent,
        ...(target ? { model: target } : {}),
        ...(promptVariant !== undefined ? { variant: promptVariant } : {}),
        text: note ? `${promptText}\n\n${note}` : promptText,
      },
      post.signal,
    )
    const prompt = await Promise.race([prompting, watching.then((w) => (w.error ? null : prompting))])
    // When the POST was abort-chained because watch found an error, its error
    // is merely the abort echo; the real error is in watching — skip the
    // dispatch-failure branch and the claim, handled by the session-error
    // close-out below (the retryable branch restores the progress record to
    // the pre-dispatch snapshot).
    const dispatchEcho = watchFailed
    if (prompt !== null && !prompt.ok && !dispatchEcho) {
      // Failed at dispatch: the just-claimed nextSession is an empty session
      // that received nothing, unfit as a recovery anchor — restore the
      // pre-claim record (the same line as the 0-token error-stub restore
      // below).
      if (handoverClaimPrior && opts.dir) await saveHandover(opts.dir, handoverClaimPrior)
      await remember()
      return { type: "blocked", question: `task dispatch failed: ${formatClientError(prompt.error)}${await missingAgentHint(opts)}` }
    }
    // Claim the running session as soon as dispatch succeeds: if the process
    // is killed / Ctrl+C'd at this moment, progress.json points at this
    // session and the next run reuses it (the core of precise recovery — a
    // mid-round session is not lost). After the round ends it is refreshed or
    // restored per the result (see the retryable-error branch below).
    if (prompt !== null && !dispatchEcho) await remember()

    const result = await watching
    // A session that stepped up in place (§4.5) keeps its step on the chain:
    // the continuation prompt and every later steer name the id it runs on.
    // Not restored on retryable errors — the retry's fork inherits the
    // context, so it inherits the step too.
    if (result.steppedUp !== undefined) stepTo(chain, result.steppedUp.step, result.steppedUp.model)
    // Segment-close booking (T-003): usage lands in the task/phase/round
    // buckets + per-session; the report is consumed by the ◉ session-ended
    // two lines below (cumulative elapsed / rounds / cumulative cost,
    // STATS_PLAN §4.1). Under a registry the same point also books per model
    // and per tier (0055 §7.1): one booking point, one cross-interruption
    // cumulative criterion.
    const report = await statsSessionEnd(opts.dir, sessionID, result.usage ?? zeroUsage(), statsModel, statsTier)
    booked = true
    // Proxy-answer posting (auto-resolve H3): closes the segment together
    // with statsSessionEnd — the watch side observes only the question text
    // and the session id; the bucket identity (task/phase/round number) is
    // filled in here. Pseudo tasks of bypass sessions (PLAN/AUTO) are
    // recorded the same way, the same line as stats. Write failures stay
    // silent inside the module and do not affect the round's outcome.
    await recordDriverResolves(opts, task.id, result.resolves)
    // The chain's original state from before this round started: a retryable
    // session error must restore to this (rather than stay on the session
    // that just failed this round), so that the next retry forks again from
    // the untouched original session. The failed-session record rides along:
    // the restore re-derives it per the replacement invariant.
    const chainPrior: ChainPrior = { id: chain.id, used: chain.used, at: chain.at, hinted: chain.hinted, wall: chain.wall, failed: chain.failed }
    // The promotion itself (also clearing the previous failure's
    // failed-session record — its purpose ended with this dispatch
    // surviving): the ◉ lines below read the promoted counters.
    promote(chain, sessionID, result, clockNow())
    // ◉ The two session-ended lines (STATS_PLAN §4.1, T-004): printed
    // unconditionally — every session that goes through attempt (phase
    // planning / handover distillation and other bypasses included; reused
    // sessions print too) outputs them uniformly; line 1 context and elapsed,
    // line 2 the token breakdown. Omission rules: a single round
    // (session.rounds ≤ 1) omits the "(cumulative …)"; reasoning=0 omits the
    // reasoning item; cost=0 omits the cost; a hit-rate denominator of 0
    // shows — (the formatCacheHit policy). report is undefined only when dir
    // is missing; it is treated as a single round, elapsed falling back to
    // watch's durationMs. Dispatch failure returns early above and never
    // reaches here.
    // AUTO-DECISION: line 1's elapsed takes report.thisAiMs (pure AI-time
    // measure) rather than the old line's watch durationMs (which includes
    // human waiting inside the session) — only on the same basis as the
    // "cumulative" (session.aiMs cumulative) in the same line is it
    // comparable, and it matches the established policy that AI elapsed
    // excludes askHuman hangs; the old behavior survives only via the
    // fallback when there is no stats directory (dir undefined).
    // AUTO-DECISION: the reasoning item is inserted between "out" and
    // "cache-read" (/ reasoning N) — the plan draft gave no example placement
    // for reasoning>0, so take the position matching the Usage breakdown's
    // declaration order (input/output/reasoning/cacheRead/cacheWrite); the
    // alternative "append at line end" would split the adjacent cache-read /
    // cache-write pair, rejected.
    // AUTO-DECISION: when this round's cost=0 but the cross-round cumulative
    // is >0, the whole item is still omitted per "cost=0 omits the cost" (no
    // isolated "(cumulative $X)") — an isolated cumulative without this
    // round's base reads misleadingly, and the established omission rule is
    // followed to the letter; the alternative "omit this round, keep the
    // cumulative" clashes with the rule's wording, rejected.
    const usage = result.usage ?? zeroUsage()
    const rounds = report?.session.rounds ?? 1
    const since = rounds > 1 ? ` (cumulative ${formatDurationCompact(report!.session.aiMs)} / ${rounds} rounds)` : ""
    log(
      `◉ session ended: context ${chain.pct}% (${formatTokens(chain.used)}${result.limit ? `/${formatTokens(result.limit)} tokens` : " tokens"}), ` +
        `elapsed ${formatDurationCompact(report?.thisAiMs ?? result.durationMs ?? 0)}${since}`,
    )
    // Line 2 reuses log.ts's formatUsageLine (T-006 close-out; the
    // task/phase/round conclusion lines share the format); the session's
    // cross-round cumulative cost is appended as a suffix (only when this
    // round's cost is shown and it crosses rounds; see the AUTO-DECISION
    // above: cost=0 omits the whole item, no isolated "(cumulative $X)").
    const cost = formatCost(usage.cost)
    const costSince = cost && rounds > 1 ? formatCost(report!.session.usage.cost) : undefined
    log(formatUsageLine(usage) + (costSince ? ` (cumulative ${costSince})` : ""))
    // Progress rename: a resumed session's title stays at the old phase; at
    // the end it is renamed to this phase's commit title, so the title prefix
    // always reflects the session's latest progress (`T-001 S1 …` → `T-001
    // S2 …` → `T-001 wrapup …`); a new session was named at creation and
    // needs no repeat.
    if (resumed && chain.subject) await renameSession(dispatchClient, chain, chain.subject)
    // A retryable session error (plans/0015-session-error-retry-plan.md): a
    // half-failed state — the chain state and progress.json are both restored
    // to the original session / record from before this round's dispatch, the
    // abandoned fork copy does not displace the real recovery point, and
    // runSession's retry loop forks again from the original session.
    // Non-retryable session errors, non-session-error blocks, and success all
    // "promote": chain.id lands on the session actually used this round and
    // progress.json is refreshed (when the session has ended but the phase
    // has not advanced, stay active — an interruption at that moment reuses
    // this session and continues as "mid-way, not yet summarized", no time
    // window; recovery only checks whether the session is alive; the
    // subtask-interval window is actively closed out into the summarized
    // state by the pipeline via persistStage after tick + commit). The sole
    // exception is a test-handover finish — the session ends on a handover
    // document and the task is already done, so no claim (see the branch
    // below).
    if (result.error && result.retryable !== false) {
      // Chain state restored, but the failed session itself is left to the
      // retry ring as the preferred fork source (see FailedSession; the
      // replacement invariant — a 0-token pure-error stub keeps the prior
      // content-bearing record, a failure with used > 0 displaces normally —
      // lives in the transition, which reads the prior snapshot).
      restoreRetryable(chain, chainPrior, { id: sessionID, used: result.used })
      // A 0-token stub also withdraws the claim on handover.json's nextSession
      // (the recovery anchor goes back to the previous content-bearing
      // continuation session); a failure with used > 0 keeps the claim — that
      // session is a strict superset of the old anchor.
      if (result.used === 0 && handoverClaimPrior && opts.dir) await saveHandover(opts.dir, handoverClaimPrior)
      if (opts.dir && chain.phase) {
        if (prior) await saveProgress(opts.dir, prior)
        else await forgetProgress(opts.dir)
      }
    } else {
      // The failed-session record is already cleared — promote wrote the
      // clear on the way in (only the retryable branch above returns through
      // restoreRetryable, never here).
      // The 0-token restore applies to non-retryable errors too (§J.3 only
      // covers completing the retryable branch): an error stub that dies on
      // its first dispatch (nothing in the session but one user message, no
      // output at all) is unfit as a recovery anchor.
      if (result.error && result.used === 0 && handoverClaimPrior && opts.dir) await saveHandover(opts.dir, handoverClaimPrior)
      // A test-handover finish (testhandoff.md written with `Status:
      // continue`): the session's task is thereby complete, and the session
      // is discarded together with its role as a restart-reuse / retry-fork
      // anchor — the chain id is cleared (if the continuation session later
      // errors, the retry fork source is left with the continuation lineage
      // chain.failed only, never forking back into the pre-freeze old session
      // whose context is exhausted); progress moves in sync to the "no
      // session in flight" state: session dropped (the next run has no
      // session to reuse; recovery reconnects via .auto/handover.json's
      // nextSession / freeze anchor to the session **after** the handover),
      // active kept (the unit is still in flight: the recovery continuation's
      // clean exemption and the handover-document retention depend on it).
      // The previous behavior was to remember()-claim the frozen session as
      // usual — when the continuation session then hit a retryable error, that
      // stale claim was restored into progress.json, and a later run after
      // the process exited reused / forked into the pre-handover session
      // (fixed 2026-09-16).
      if (result.testHandover) {
        afterTestHandover(chain)
        if (opts.dir && chain.phase) {
          await saveProgress(opts.dir, { task: task.id, session: undefined, at: clockNow(), active: true, phase: chain.phase })
        }
      } else {
        await remember()
      }
    }
    if (result.blocked) {
      // A strict-resume test-handover write-check failure (3.3): folded into
      // a rollback flag and raised, on which the unit's owner
      // (executeWhole/runSubtask) rolls back and redoes; a caller without a
      // baseline treats it as an ordinary block.
      return result.testHandoverInvalid ? { ...result.blocked, rollback: true } : result.blocked
    }
    // The classifier's fields ride along only when it spoke (plans/0055
    // §7.1): its raised class, the reset time the escalation's down marks
    // last until, or the answer still on its way; a stated reset rides with
    // its scope (plans/0057 §7).
    if (result.error)
      return {
        type: "blocked",
        question: `session error: ${result.error}`,
        retryable: result.retryable,
        errorClass: result.errorClass,
        ...(result.classified ? { classified: true } : {}),
        ...(result.resetAt !== undefined ? { resetAt: result.resetAt } : {}),
        ...(result.scope !== undefined ? { scope: result.scope } : {}),
        ...(result.resetSource !== undefined ? { resetSource: result.resetSource } : {}),
        ...(result.pendingReset !== undefined ? { pendingReset: result.pendingReset } : {}),
      }
    return { type: "idle", lastText: result.lastText, testHandover: result.testHandover }
  } finally {
    // Stats backstop (T-003): paths that never reached the normal segment
    // close (dispatch failure, exception, ...) close the segment too — with
    // no paired begin, thisAiMs=0 and a zero usage are still recorded
    // (stats.ts's standing semantics: only consumption that actually
    // happened is recorded, nothing invented). The model/tier keys are
    // carried the same way (the session was indeed dispatched to that model;
    // a 0-usage session count is also part of the protocol-drift criterion).
    if (!booked) await statsSessionEnd(opts.dir, sessionID, zeroUsage(), statsModel, statsTier)
    // Explicit stream drop: the abort signal cancels the SSE underlying
    // reader and exits its reconnect loop, releasing the connection quota
    // immediately (aborting an already-finished subscription is harmless);
    // the POST signal is the backstop — dispatches still in flight on
    // abnormal-exit paths are voided too.
    sse.abort()
    post.abort()
    vlog(`▪ unsubscribed from the event stream of session ${sessionID}`)
  }
}
