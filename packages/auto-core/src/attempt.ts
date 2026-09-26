// The executor of a single prompt dispatch: session-reuse decision and creation,
// model target evaluation and dispatch, progress recovery-point write, stats
// segment close, and wiring in the event-stream subscription (watch) before
// waiting for the session's natural finish; the proxy-answer ledger writer
// recordDriverResolves is called only by this layer, so it belongs here too.
// Sits below session.ts (whose runSession retry/failover ring calls this
// function on each pass) and calls only the layers below — watch / session-api
// / stats; **must never import session / runner back upward**.
// Split out of src/runner.ts (plans/0024-module-split-plan.md S8, pure move).

import { rm } from "node:fs/promises"
import { join, relative } from "node:path"
import type { AgentClient } from "./agent/types"
import { resolveModel, roleOf, REUSE_BELOW, REUSE_IDLE_MINUTES, type SessionChain, type SessionResult } from "./chain"
import { clearDownMarks, failbackOverride, isModelDown, stickyModel } from "./failback"
import { commitTitle, unitBaseline } from "./git"
import { recallHandover, saveHandover, type Handover } from "./handover"
import { formatCost, formatDurationCompact, formatUsageLine, log, vlog } from "./log"
import { formatWindowState, usableAt } from "./model-window"
import type { ModelRegistry } from "./models"
import { DEFAULT_CONTEXT_LIMIT, type Opts } from "./opts"
import { currentRound } from "./phases"
import { candidateKey, nowOf, selectContext } from "./routing"
import { candidatesOf, select } from "./select"
import { stepForUsed, stepId } from "./model-step"
import type { ModelEntry } from "./models"
import { type Task } from "./tasks"
import { handoffFile } from "./prompt"
import { recordResolves, type ResolveEvent } from "./resolve"
import { forgetProgress, peekProgress, saveProgress } from "./resume"
import { formatClientError, formatTokens, missingAgentHint, renameSession, zeroUsage } from "./session-api"
import { statsSessionBegin, statsSessionEnd } from "./stats"
import { createStuckTracker } from "./stuck"
import { SWITCH_ENV, type Switches } from "./switches"
import { type Steer, type TestRun } from "./testrun"
import { strictResumeActive } from "./unit-commit"
import { reuseAllowed } from "./usage"
import { watch } from "./watch"

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

// A move's reason for the registry ◈ line (plans/0055 §6.5): the previously
// shown model read against the registry at the dispatch's instant — outside
// its windows ("window"), still marked down ("quota", standing for the
// classified quota/auth/rate failures; key rings are a later step), or an
// entry that is usable again, meaning the list changed underneath it (a
// /failback or a scope boundary cleared its mark: "failback"). undefined =
// no move, or a raw value with nothing attributable to say.
function moveReason(registry: ModelRegistry, previous: string | undefined, now: number): string | undefined {
  if (previous === undefined) return undefined
  const entry = registry.models.get(previous)
  if (entry !== undefined && !usableAt(entry, registry.tz, now)) return "window"
  if (isModelDown(previous, now)) return "quota"
  return entry !== undefined ? "failback" : undefined
}


export async function attempt(
  client: AgentClient,
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
  // A session taken over by interruption recovery (the chain has a session and
  // a recovery note waiting to be injected): the first prompt goes into the
  // original session unconditionally — recovery semantics is exactly "continue
  // the session that was interrupted", unconstrained by the reuse switch and
  // thresholds (the same criterion as seedForkSession's "recovery continuation
  // outranks forking"). The note is cleared once used, and the chain then
  // returns to the normal reuse rules. It yields when a forked session
  // (pending) is present: runSession's retry ring hangs both note (the retry
  // explanation) and pending (the failed session's copy) and deliberately
  // leaves chain.id set (the next retry forks from the original session
  // again); what takes over at that moment is the copy, not a reuse of the
  // original session.
  // Without resumable sessions (MA.4) the chain's session never takes another
  // prompt: recovery and reuse both open a new one.
  const resumable = client.capabilities.resume
  const resumed = resumable && chain.id !== undefined && chain.note !== undefined && chain.pending === undefined
  // In-chain reuse is governed by OPENCODE_AUTO_REUSE_SESSION (default off):
  // with it off every prompt in the task opens a new session and the
  // thresholds (context share / usage / idle) take no part in the decision.
  const reuseSession = switches.reuseSession
  const reuse = resumable && chain.id !== undefined && (resumed || (reuseSession && reuseAllowed(chain, cap, Date.now())))
  // The fallback value of the test-handover criterion (D1): a reused or
  // recovery-takeover session starts out carrying the chain's already-used
  // tokens, so a test request arriving before the first message.updated must
  // still be judged correctly; a fork and a brand-new session reset it to
  // zero — chain.used is the previous session's leftover, and copying it
  // would make a small just-started session falsely test over-limit on its
  // first test and burn a handover for nothing.
  if (test) test.startUsed = reuse ? chain.used : 0
  // Reuse by recovery takeover is already covered by runTask's recovery log
  // (including the inherited context usage); not printed again.
  if (reuse && !resumed) {
    log(`♻ session reused (context ${chain.pct}%, used ${formatTokens(chain.used)} tokens, ended ${Math.round((Date.now() - chain.at) / 1000)}s ago)`)
  }
  if (!reuse && chain.id !== undefined) {
    const reason = !resumable
      ? `the agent cannot resume sessions`
      : !reuseSession
        ? `session reuse disabled (${SWITCH_ENV.reuseSession}=off, default)`
        : chain.pct >= REUSE_BELOW
          ? `context share ${chain.pct}% reached the ${REUSE_BELOW}% threshold`
          : chain.used >= cap / 2
            ? `used ${formatTokens(chain.used)} tokens reached the ${formatTokens(cap / 2)} cap (reuse threshold)`
            : `more than ${REUSE_IDLE_MINUTES} minutes since the last session ended (context stale)`
    // Reuse-off is the default shape (every session on the chain hits it), so
    // it goes to the detail log only; with reuse enabled the no-reuse reason
    // is decision material and reaches the terminal as usual.
    if (reuseSession) log(`▷ ${reason}; starting a new session`)
    else vlog(`▷ ${reason}; starting a new session`)
  }
  // A pre-created fork session (what seedForkSession forked from the base
  // point) outranks create when !reuse; consuming clears it — by a
  // transient-error retry pending is already clear, so the flow falls back to
  // the create path naturally (design §4.3).
  const forked = reuse ? undefined : chain.pending
  chain.pending = undefined
  // Sync AGENTS.md before a new session: with an update, restart the server
  // before opening the new session so it loads the latest system context
  // (AGENTS.md is re-read live on every provider turn; the restart backstops
  // cached cases). A forked session was already synced before seedForkSession
  // forked it.
  if (!reuse && !forked) await opts.server?.syncContext()
  // Explicit title: a new session is named directly with this phase's commit
  // title (a short label, e.g. `T-001 S2 write schema`); a session without a
  // commit title (dryrun etc.) falls back to `[auto] <task>`; a forked
  // session was already renamed by forkSession and does not go through
  // create.
  const session = reuse || forked ? undefined : await client.create({ title: chain.subject ? commitTitle(chain.subject) : `[auto] ${task.id} ${task.title}` })
  if (session && !session.ok) return { type: "blocked", question: `session creation failed: ${formatClientError(session.error)}` }
  // failback granularity session (OPENCODE_AUTO_MODEL_FAILBACK_SCOPE): every
  // brand-new session start clears the chain's failover candidate and fails
  // back to the preferred model. Create path only (session reuse and a
  // consumed fork leave it alone) — the migrated session forked out by a
  // failover enters via pending, and clearing here would immediately undo the
  // failover into oscillation.
  // Registry routing: the same boundary clears the down marks (§6.4) and the
  // chain's selected entry, so the new session re-selects from the list.
  if (session !== undefined && switches.modelFailbackScope === "session") {
    chain.model = undefined
    chain.modelEntry = undefined
    chain.modelStep = 0
    clearDownMarks("session", switches.modelFailbackScope)
  }
  const sessionID = forked ?? session?.value.id ?? chain.id!
  // Interactive bypass: human input goes to this session from here on (wrap-up
  // and other bypass sessions override it the same way).
  opts.interactive?.attach(sessionID)
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
      await saveHandover(opts.dir, { ...inflight, nextSession: sessionID })
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
  let promptModel: string | undefined
  const remember = async () => {
    if (opts.dir && chain.phase) {
      await saveProgress(opts.dir, {
        task: task.id,
        session: sessionID,
        at: Date.now(),
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
    const events = await client.events(sse.signal)
    // This session's model. Under a model registry (plans/0055 §6) selection
    // decides it: the candidate list of the session's role and phase type,
    // the overrides of §9, and — for a continuation of the same prompt (a
    // retry, a fork after a failure, the recovery loop's re-dispatch, a
    // strict resume; reuse or a consumed pending fork here) — the chain's
    // entry while it is still usable. The pick names the prompt's model and
    // variant; nothing usable returns with noModel for runSession to act on
    // (§6.3: wait for the earliest window opening, or probe in the
    // wait-and-probe loop), and an emptied list is a blocked refusal.
    // Without a registry (plans/0017 C.3/E) the env-switch chain applies,
    // byte for byte as before: chain fallback candidate > phase-scoped
    // sticky > /failback runtime override > the routing table (role > phase
    // type id > preset letter > wildcard, resolveModel). An undefined target
    // sends no model key: with both variables unset and no override the whole
    // chain stays undefined, byte-identical to the unrouted call (not
    // model: undefined).
    const override = failbackOverride()
    let target: string | undefined
    let promptVariant: string | undefined
    // The watch's steer context under a registry (§4.5): the picked
    // candidate's key, its entry (when the pick is one) and the step the
    // dispatch names — set with target below, undefined without a registry.
    let steerKey: string | undefined
    let steerEntry: ModelEntry | undefined
    let steerStep: number | undefined
    if (opts.routing) {
      const facts = opts.routing
      const limits = await client.contextLimits()
      const ctx = selectContext(facts, switches, cap, limits)
      const list = candidatesOf(ctx, { role: roleOf(chain), entry: opts.phase?.entry, now: nowOf(facts) })
      const decision = select(ctx, {
        role: roleOf(chain),
        entry: opts.phase?.entry,
        now: nowOf(facts),
        current: chain.modelEntry,
        continuation: reuse || forked !== undefined,
      })
      if (decision.kind === "empty") {
        const detail = `${list.override ? `the ${list.override} override` : `the ${list.tier} list`}${list.route ? ` (route ${list.route.key})` : ""}`
        if (handoverClaimPrior && opts.dir) await saveHandover(opts.dir, handoverClaimPrior)
        return {
          type: "blocked",
          question: `model registry: no candidate is left for this session's routing (${detail}, agent filter ${facts.agentFilter ?? "none"}); fix the registry or the filter and re-run`,
        }
      }
      if (decision.kind === "wait") {
        // §6.3's wait: nothing is usable now, but a candidate that is not
        // down opens later through its window. No session content exists to
        // probe, so runSession sleeps inside the unit until the earliest
        // opening plus hibernate's jitter and this loop dispatches again
        // (the re-selection reads the advanced clock; a suspend that wakes
        // past a short window simply waits for its next opening).
        if (handoverClaimPrior && opts.dir) await saveHandover(opts.dir, handoverClaimPrior)
        return {
          type: "blocked",
          question: `no usable model candidate now: every candidate of ${list.override ? `the ${list.override} override` : `the ${list.tier} list`} is outside its windows; waiting for the earliest opening`,
          noModel: true,
          windowWait: {
            until: decision.until,
            model: candidateKey(decision.candidate),
            tier: list.tier,
            opens: formatWindowState({ open: false, opens: decision.until }, facts.registry.tz, nowOf(facts)),
          },
        }
      }
      if (decision.kind === "probe") {
        if (handoverClaimPrior && opts.dir) await saveHandover(opts.dir, handoverClaimPrior)
        return {
          type: "blocked",
          question: `no usable model candidate: every candidate of ${list.override ? `the ${list.override} override` : `the ${list.tier} list`} is down or outside its windows; entering the wait-and-probe loop`,
          noModel: true,
        }
      }
      const picked = decision.candidate
      // Session lifetime of a step (§4.5): a continuation of the same session
      // keeps the step it reached (the chain's field, written by the watch
      // that stepped up); a resumed takeover recomputes it from the context
      // size rebuilt from the session's history (chain.used, nothing
      // persisted); every other dispatch — a new prompt, the session after a
      // handover, a failover onto this entry — starts at the base step.
      let step = 0
      if (picked.kind === "entry" && (decision.via === "continuation" || resumed)) {
        step = resumed ? stepForUsed(picked.entry, limits, chain.used) : (chain.modelStep ?? 0)
      }
      const entryOf = picked.kind === "entry" ? picked.entry : undefined
      target = picked.kind === "entry" ? (stepId(picked.entry, step) ?? picked.entry.model) : picked.model
      promptVariant = entryOf !== undefined ? entryOf.variant : undefined
      const key = candidateKey(picked)
      chain.modelEntry = key
      chain.model = target
      chain.modelStep = entryOf !== undefined ? step : 0
      promptModel = key
      steerKey = key
      steerEntry = entryOf
      steerStep = entryOf !== undefined ? step : 0
      // ◈ display (§6.5): the internal name with the tier, the agent and
      // model behind it, and what routed the dispatch; a move names its
      // reason — window, quota (the classified failures) or failback. Key
      // rings are a later step. Like the no-registry line: every new session
      // shows one, a reused session only on a change.
      const bracket =
        picked.kind === "entry" ? `${picked.entry.agent}:${picked.entry.model ?? "default"}` : `${facts.defaultAgent}:${picked.model}`
      const routePart =
        list.override === "env"
          ? `override ${SWITCH_ENV.model}`
          : list.override === "failback"
            ? "override /failback"
            : `route ${list.route?.key ?? roleOf(chain)}`
      const previous = chain.modelShown !== undefined && chain.modelShown !== key ? chain.modelShown : undefined
      const reason = moveReason(facts.registry, previous, nowOf(facts))
      if (key !== chain.modelShown || !reuse) {
        log(`◈ ${task.id} using model ${key} [${list.tier} · ${bracket}] (${routePart}${reason ? `; ${reason}` : ""})`)
        chain.modelShown = key
      }
    } else {
      target = chain.model ?? stickyModel() ?? override?.wildcard ?? resolveModel(switches.model, opts.phase?.entry, roleOf(chain))
      promptModel = target
    }
    // The actually-used model reaches the terminal (frontend-visible): when
    // routing / failover gives an explicit target, dispatch locks that model
    // and the report names its source directly; without routing (target
    // undefined) the report no longer guesses the server default (a session
    // sticking to a model etc. would distort the guess) — instead watch
    // observes this session's first message carrying a model (the user
    // message carries the server's actual resolution) and then reports the
    // real effective model. Every new session (created / forked, i.e. !reuse)
    // reports one line, and so does a model change against the previous
    // prompt; a continuation prompt on the same session and model (reuse /
    // recovery takeover) is not repeated. Whatever the source, the decision
    // whether the prompt carries a model key is unchanged (invariant F
    // unbroken).
    if (!opts.routing && target !== undefined) {
      const from =
        chain.model !== undefined
          ? "fallback candidate"
          : stickyModel() !== undefined
            ? "fallback candidate (sticky within phase)"
            : override !== undefined
              ? "/failback override"
              : "route"
      if (target !== chain.modelShown || !reuse) {
        log(`◈ ${task.id} using model ${target} (${from})`)
        chain.modelShown = target
      }
    }
    // When the liveness probe's verdict — a half-open connection or the like
    // ending the session (session-boundary-hardening §4.4) — returns before
    // the hung POST does: drop the stream early, releasing the SSE reader and
    // the connection quota, and chain-abort the POST (the race below no
    // longer waits for it, going straight into this result's session-error
    // close-out). Repeated aborts of an already-aborted subscription are
    // harmless; the normal-finish path sees no effect here.
    let watchFailed = false
    const watching = watch(
      client,
      sessionID,
      events,
      opts,
      steer,
      test,
      stuck,
      switches,
      target === undefined
        ? (model) => {
            if (model !== chain.modelShown || !reuse) {
              log(`◈ ${task.id} using model ${model} (server resolved)`)
              chain.modelShown = model
            }
          }
        : undefined,
      // Registry steers name their model (§4.5): the watch carries the entry's
      // steps (the same session steps up in place) and the id every steer
      // names — the reached step. Without a registry nothing is passed and
      // steers stay exactly as they are (C2).
      opts.routing && steerKey !== undefined ? { name: steerKey, label: task.id, ...(steerEntry !== undefined ? { entry: steerEntry } : {}), ...(steerStep !== undefined ? { step: steerStep } : {}), ...(target !== undefined ? { model: target } : {}) } : undefined,
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
    chain.note = undefined
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
    const prompting = client.prompt(
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
    if (result.steppedUp !== undefined) {
      chain.modelStep = result.steppedUp.step
      chain.model = result.steppedUp.model
    }
    // The unified close-out of handover-period tests in the concurrent mode
    // (OPENCODE_AUTO_HANDOVER_CONCURRENT=on): watch is started and this waits
    // for it to settle — natural finish, session error, SSE broken stream,
    // every path passes here, so the test process never hangs across
    // sessions. The result lands on test.last for the new session's
    // continuation prompt to cite. In the sequential mode (default) this is
    // always a no-op; the test is run by runExecSession after commit #2.
    if (test?.running) {
      await test.running.catch(() => {})
      test.running = undefined
    }
    // Segment-close booking (T-003): usage lands in the task/phase/round
    // buckets + per-session; the report is consumed by the ◉ session-ended
    // two lines below (cumulative elapsed / rounds / cumulative cost,
    // STATS_PLAN §4.1).
    const report = await statsSessionEnd(opts.dir, sessionID, result.usage ?? zeroUsage())
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
    // the untouched original session.
    const previousId = chain.id
    const previousUsed = chain.used
    const previousAt = chain.at
    const previousHinted = chain.hinted
    chain.id = sessionID
    chain.pct = result.pct
    chain.used = result.used
    chain.at = Date.now()
    chain.hinted = result.hinted === true
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
    // Progress rename: a reused session's title stays at the old phase; at
    // the end it is renamed to this phase's commit title, so the title prefix
    // always reflects the session's latest progress (`T-001 S1 …` → `T-001
    // S2 …` → `T-001 wrapup …`); a new session was named at creation and
    // needs no repeat.
    if (reuse && chain.subject) await renameSession(client, chain, chain.subject)
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
      chain.id = previousId
      chain.used = previousUsed
      chain.at = previousAt
      chain.hinted = previousHinted
      // Chain state restored, but the failed session itself is left to the
      // retry ring as the preferred fork source (see FailedSession).
      // A 0-token failure is a pure error stub (failed at dispatch, ran
      // nothing out) and does not displace the still-valid content-bearing
      // record on the chain — otherwise the next retry would lose the most
      // valuable fork source (2026-09-17 field incident: a 41.3k failed
      // session was displaced by its own 0-token fork copy, and later retries
      // degenerated into cold-seeding from the base point); a failure with
      // used > 0 is a strict superset of the old record (the fork copy
      // carried the old prefix and ran out new content), so it displaces
      // normally.
      if (result.used > 0 || chain.failed === undefined) chain.failed = { id: sessionID, used: result.used }
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
      chain.failed = undefined
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
        chain.id = undefined
        if (opts.dir && chain.phase) {
          await saveProgress(opts.dir, { task: task.id, session: undefined, at: Date.now(), active: true, phase: chain.phase })
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
    if (result.error)
      return { type: "blocked", question: `session error: ${result.error}`, retryable: result.retryable, errorClass: result.errorClass, failover: result.failover }
    return { type: "idle", lastText: result.lastText, testHandover: result.testHandover }
  } finally {
    // Stats backstop (T-003): paths that never reached the normal segment
    // close (dispatch failure, exception, ...) close the segment too — with
    // no paired begin, thisAiMs=0 and a zero usage are still recorded
    // (stats.ts's standing semantics: only consumption that actually
    // happened is recorded, nothing invented).
    if (!booked) await statsSessionEnd(opts.dir, sessionID, zeroUsage())
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
