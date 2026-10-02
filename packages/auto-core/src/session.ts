// The core layer of session driving: running one prompt on the session chain
// (runSession — the executor of the pure ladder decision of
// src/engine/ladder.ts: a fresh session per prompt except a resumed takeover,
// transient errors retried in a fresh
// session, server restart on network failures, the model failover ring under
// quota restriction with window clipping, and the wait-and-probe loop
// awaitRecovery, the final destination of every session fault), plus fork base
// establishment (ensureForkBase — it drives a one-off base session, which is
// session driving rather than a thin SDK wrapper, hence it sits on the same
// layer as runSession, see plans/0024-module-split-plan.md §I D9).
// Sits above attempt/watch and below runner; **must never import runner in the
// reverse direction**.
// Split out of src/runner.ts (plans/0024-module-split-plan.md S8, pure move).

import { dirname, join } from "node:path"
import type { AgentClient } from "./agent/types"
import { roleOf, type ForkBaseInfo, type SessionChain, type SessionResult, type WindowWait } from "./chain"
import { dropStaleFailed, forkSources, moveOnFork, retryOnFork, setRoute, toAgent, toBlankSession } from "./chain-transitions"
import { attempt } from "./attempt"
import { nextStep, type LadderFacts, type LadderState, type WaitCause } from "./engine/ladder"
import { RESET_HORIZON_MS } from "./classify"
import { taskDoc } from "./docpaths"
import { ExitRequested } from "./exit"
import { unitBaseline } from "./git"
import { bookedSleep } from "./hibernate"
import { ringKeyLabel } from "./keyring"
import { log } from "./log"
import { DEFAULT_CONTEXT_LIMIT, type ClientSource, type Opts } from "./opts"
import { forkAgent, jitterOf, landedAgent, probeChain, windowWake } from "./router"
import { routingOf as routingOfPure, type RoutingFacts } from "./routing"
import { services } from "./services"
import { setForkBase, forkBaseFor, type Plan, type Task } from "./tasks"
import { renderContextBase } from "./prompt"
import { promptFacts } from "./prompt-facts"
import { accountAnswered, accountOf, learnedReset, learnFailure } from "./quota-windows"
import { saveProgress } from "./resume"
import { firstLine } from "./resume-gate"
import { clientOf, contextLimitsOf, forkSession, formatClientError, formatTokens, seedForkSession, sessionAlive, sessionUsed, worktreeNote } from "./session-api"
import { AgentStartError, PROBE_PROMPT } from "./agent-pool"
import { autoSwitches, type Switches } from "./switches"
import { statsModelEvent, statsQuotaWait, statsWaitBegin, statsWaitEnd } from "./stats"
import { type Steer, type TestRun } from "./testrun"
import { strictResumeActive } from "./unit-commit"

// Fork base establishment (fork-decompose design §4.2, persistence revision
// 2026-09-18): returns the effective base, undefined = cold start. A
// digest-mode base **persists across runs once established** — setForkBase
// stores it in the runtime-state .auto/units.json forkBase under the `digest:`
// prefix, and every later run (including interruption recovery and reruns with
// subtasks left undone) validates liveness first: alive means reusing the same
// base session to keep forking, no longer unconditionally rebuilding from
// context.md; only a stale one (storage cleanup) is rebuilt through a one-off
// chain (subject `T-NNN ctxbase …`, carries no phase, writes no progress
// record; the turn is verified to leave no worktree changes, commitTree
// naturally commits nothing) — the prefix is deterministic = the full digest
// text, provider-cache friendly. Once established, the base session is only
// forked, never dispatched again, the prefix stays the full digest text, and
// reuse introduces no drift. Fallback chain: persistent digest base alive and
// reused → digest rebuild → session base (a persistent units.json field,
// liveness-checked, falls back to cold start when stale) → cold start. A
// session-mode base persists across runs, with usage rebuilt from the last
// message in messages (an approximation suffices; within the same run, when
// the base is the session on the chain, the tracked value is taken directly).
// Per agent (plans/0055 §8.4): the record is a map from
// agent profile to base, read and written for the forking chain's agent alone,
// and the digest rebuild is dispatched with the model selected for the
// `subtask` route (see the body) — so a base exists per agent, built lazily on
// the agent of the first subtask that forks on it.
export async function ensureForkBase(
  client: ClientSource,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
  switches: Switches = autoSwitches(),
): Promise<ForkBaseInfo | undefined> {
  if (!switches.fork) return undefined
  const dir = opts.dir ?? plan.dir
  // The run's routing facts, always defined: the opts' own for a run, else
  // the implicit registry over the env switches (a bare options literal).
  const routing = routingOf(opts, switches)
  // The reading agent (plans/0055 §8.4): the base the pipeline forks from
  // must live on the agent the forking subtask's chain runs on, so the
  // persisted record is read and written for that agent alone. The
  // reading agent is the chain's agent — the decompose dispatch's before
  // the first subtask, the moved-to agent after a cross-agent failover (a
  // subtask that moved to another agent forks from that agent's base,
  // building it on first use) — with the run agent standing in while the
  // chain holds no session (`forkAgent`).
  const agent = forkAgent(routing, chain)
  // A persistent digest base is told from the understand-session id (the
  // session base) by the `digest:` prefix — an unprefixed value in digest mode
  // is only the fallback for a failed rebuild and takes no part in "alive
  // means reuse". A plain string is the one-agent era's record and reads as
  // this run's (the default) agent's; a map holds only the reading agent's
  // entry (forkBaseFor).
  const forkBaseRecord = forkBaseFor(task.forkBase, agent)
  // The client the base's liveness and rebuild run on: the reading agent's
  // host (a session id is agent-local, §8.2), resolved through the pool when
  // the caller passes one.
  const baseClient = await clientOf(client, agent)
  // The base lines name the agent (the base is agent-local, §8.4).
  const onAgent = ` on agent ${agent}`
  const persistID = forkBaseRecord?.startsWith("digest:") ? forkBaseRecord.slice("digest:".length) : undefined
  if (switches.forkBase === "digest") {
    if (persistID !== undefined) {
      if (await sessionAlive(baseClient, persistID)) {
        const used = await sessionUsed(baseClient, persistID)
        log(`⑂ ${task.id} digest base reuse: session ${persistID}${onAgent} (${used === undefined ? "usage unknown" : `${formatTokens(used)} tokens`})`)
        return { id: persistID, used, agent, digest: true }
      }
      log(`↻ ${task.id} persistent digest base ${persistID}${onAgent} is stale; rebuilding from ${taskDoc(task.id, "context")}`)
    }
    const digest = (await Bun.file(join(dir, taskDoc(task.id, "context"))).text().catch(() => "")).trim()
    if (digest) {
      const subject = `${task.id} ctxbase ${task.title}`
      // The base is created with the model selected for the `subtask` route,
      // not `bypass` (§8.4): a base's value is a warm prefix (0003), and a
      // prefix cached under one model is a miss under another — the one-shot
      // chain carries the `subtask` role so the dispatch inside selects (and
      // fails over) on the subtask tier's list for the current phase type,
      // the picked entry's variant and base step included.
      const base: SessionChain = { pct: 100, used: 0, at: 0, subject, role: "subtask" }
      const result = await runSession(client, task, renderContextBase(promptFacts(opts), task, digest), opts, base)
      if (result.type === "idle" && base.id) {
        // The record names the agent the base session truly lives on (the
        // dispatch inside picked it; §8.2) — the subtask route's first usable
        // candidate's profile, which is where the forking subtask dispatches
        // too, so the prefix caches under the model that forks from it (the
        // reading agent stands in when the dispatch left no agent on the
        // chain, `landedAgent`).
        const landed = landedAgent(base, agent)
        await setForkBase(dir, task.id, `digest:${base.id}`, landed)
        // The ready line names the agent and the model (the base is
        // agent-local, §8.4, and was built for the subtask route's model).
        log(
          `⑂ ${task.id} digest base ready: session ${base.id} on agent ${landed} (model ${base.modelEntry ?? "unrouted"}, digest prefix ${formatTokens(base.used)} tokens)`,
        )
        return { id: base.id, used: base.used, agent: landed, digest: true }
      }
      log(`↻ ${task.id} digest base session not established${result.type === "blocked" ? ` (${firstLine(result.question)})` : ""}; falling back to the session base`)
    } else {
      log(`↻ ${task.id} ${taskDoc(task.id, "context")} digest missing; digest base cannot be established, falling back to the session base`)
    }
  }
  // The session base (the understand session): in digest mode a persistent
  // base reaching here must already have been ruled stale above (alive would
  // have returned by reuse), so no re-check; in session mode a leftover
  // `digest:` prefix (base mode switched mid-run) is unwrapped and checked —
  // a live digest base is equally a valid warm prefix.
  const sessionID = persistID === undefined ? forkBaseRecord : switches.forkBase === "session" ? persistID : undefined
  if (sessionID) {
    if (await sessionAlive(baseClient, sessionID)) {
      const used = sessionID === chain.id ? chain.used : await sessionUsed(baseClient, sessionID)
      log(`⑂ ${task.id} session base ready: session ${sessionID}${onAgent} (${used === undefined ? "usage unknown" : `${formatTokens(used)} tokens`})`)
      // A digest base read in session mode still holds the digest alone.
      return { id: sessionID, used, agent, ...(sessionID === persistID ? { digest: true } : {}) }
    }
    log(`↻ ${task.id} session base ${sessionID}${onAgent} is stale; falling back to cold start`)
  }
  return undefined
}

// The wait-and-probe loop's probe prompt is agent-pool.ts's PROBE_PROMPT —
// the single home of the literal (D11, plans/0069 §2.2; the models command's
// probe there and awaitRecovery below send the same payload), whose comment
// carries the probe's contract (one real provider round trip, never inside
// the interrupted session).

// One-off note when the same prompt is re-sent after a retry or recovery
// (carried to the AI with the next prompt via chain.note, cleared once used). Two
// forms, keyed on whether the session taking over carries this attempt's context:
// ① full context (a fork of the failed session itself): the copy ends with the
//    original error message, so a repeated prompt needs a word of explanation or
//    the AI treats the re-send as a repeated request and starts over (same motive
//    as awaitRecovery's note);
// ② partial context (blank new session / re-seeded from the base / a fork of the
//    chain's original session / a cross-agent move, plans/0055 §8.3): the
//    attempt's partial output on disk is not in the new session's context, so the
//    AI must check the worktree before going on, or it redoes half-finished work,
//    duplicating appended output and re-running finished steps (same wording as
//    the cross-run resumeNote: check the disk state, do not redo).
const retryNote = worktreeNote

// The routing facts of a session-options literal, injected with this
// module's services reads: the pure fallback (the implicit-registry literal,
// D9 of plans/0069 §2.2) lives in routing.ts and takes the timeline and the
// routing state as parameters — this wrapper is the services entry the
// session-driving callers below the loop (runner, execute, artifact,
// exec-session) resolve through, so they never read the ambient holder
// themselves; the switches argument is the snapshot the caller drives
// everything else with.
export function routingOf(opts: Pick<Opts, "routing" | "router">, switches: Switches): RoutingFacts {
  return routingOfPure(opts, switches, services().clock, opts.router ?? services().router)
}

// Runs one prompt on the session chain (a fresh session per prompt, except a
// resumed takeover of the recorded session). Transient
// provider failures (session.error, e.g. malformed reasoning content from a
// gateway) are retried in a fresh session; network/server failures
// (Internal network failure / Network error etc.) additionally restart the
// spawned opencode server before the retry; non-retryable failures (quota
// etc.) and ladder exhaustion fall into the recovery wait-probe loop instead
// of blocking — a session fault never terminates the run.
// Runs one prompt on the session chain (a resumed takeover or a new session,
// error retry with server restart, the wait-and-probe loop); exported for
// reuse by bypass sessions. test is the --test-by-driver protocol state
// (passed in only by execution sessions via runExecSession; bypass sessions
// leave it out, so the protocol stays inactive); switches defaults to the
// parsed OPENCODE_AUTO_* values (the experiment switches), injected for unit
// tests.
export async function runSession(
  client: ClientSource,
  task: Task,
  promptText: string,
  opts: Opts,
  chain: SessionChain,
  steer?: Steer,
  test?: TestRun,
  switches: Switches = autoSwitches(),
): Promise<SessionResult> {
  // The client of the chain's session (plans/0055 §8.1), resolved per use:
  // a failover may move the chain to another agent between iterations, and
  // every fork, liveness check and rename below belongs to the agent the
  // session lives on. A plain client source resolves to itself.
  const chainClient = () => clientOf(client, chain.agent)
  // The run's clock (the installed services' clock): every time read and
  // every sleep of this loop goes through it; the routing facts carry the
  // same clock as data for the pure decision code (nowOf).
  const clock = services().clock
  const clockNow = (): number => clock.now()
  // The run's router (the installed services' router): the failback holders,
  // the down marks and the key marks are run-wide decision state this loop
  // writes and reads; the routing facts carry the same router as data for
  // the pure selection code (selectContext).
  const router = services().router
  // The run's control service (the installed services' control): the /exit
  // request the wait-and-probe loop below checks at each round's head; the
  // clock's sleepUnlessExit delegates to the same instance, so the wait's
  // sleep and the head check see one request.
  const control = services().control
  // The run's routing facts, always defined: the loop's own for a run, else
  // the implicit registry over the env switches on the installed services'
  // clock and router (a bare options literal that never knew routing).
  const routing = routingOf(opts, switches)
  // Quota-failover candidate tracking (design D.3/D.4): shared across the
  // whole session chain — each model candidate gets its own full round of the
  // retry ladder (the ladder's counter resets to 1 when the candidate
  // switches), the total cap = candidate count × ladder length, and the
  // failover count and the ladder count stay separate so neither masks the
  // other. The bookkeeping is one LadderState object (src/engine/ladder.ts):
  // `i`, the next retry's ordinal, `tried`, the candidate strings this chain
  // has already tried (ordered, for the exhaustion message and dedup on
  // re-selection), and `clipped`, candidates skipped because their context
  // window falls short (for the exhaustion message and dedup logging). The
  // pure decision reads it; the executor paths below (switchModel, the retry
  // dispatch, awaitRecovery's fresh round) are its only writers. limits
  // lazily fetches contextLimits once and caches it (the failover decision
  // only reads context windows, tolerating an empty map).
  const cap = opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT
  const ladder: LadderState = { i: 1, tried: [], clipped: [] }
  let limits: ReadonlyMap<string, number> | undefined
  // The retry ladder (OPENCODE_AUTO_RETRY_WAITS, default 0,1,2,4,8): each
  // element of waits is the minutes to wait before that retry, and the element
  // count is the retry-count cap. The first retry is immediate — transient
  // jitter really does recover on the very next turn (the DB holds an instance
  // of "attempt 1 killed after 300s of silence, attempt 2 succeeded"); after
  // that the backoff scales in minutes.
  //
  // Why the backoff starts at minutes instead of doubling from seconds:
  // backoff is not itself a recovery mechanism. On each failure opencode's
  // inner layer has already spent 6×300s timeouts + 2+4+8+16+30s backoff ≈
  // 1860s (measured 1862s); stacking a second-scale curve on top from the
  // outer layer would be a rounding fraction of that and changes nothing about
  // the next request's fate. Minute-scale waiting has exactly one purpose:
  // "outlasting a stretch of upstream degradation"; the way out once the
  // ladder is exhausted is the wait-and-probe loop below (since 2026-09-16;
  // before that a human ruling) — quota/rate-limit recovery windows are
  // hour-scaled, extra attempts do not help, waiting is all there is.
  const waits = switches.retryWaits
  let i = 1
  // The common action of a candidate failover (shared by the two trigger
  // faces: the quota-failover branch below and the fallback after ladder
  // exhaustion): pick the next usable candidate, switch the chain's route,
  // attach a one-off failover note, fork a copy that carries the context
  // along, and reset the ladder counter to 1 (this candidate gets its own
  // full ladder round).
  // Returns true on a successful switch (the caller continues); returns false
  // on candidate exhaustion (the caller falls into the wait-and-probe loop).
  // why is a short phrase naming the trigger; it goes into the log and the failover note.
  // The current model is marked down and selection picks the next usable
  // candidate of the list in force (plans/0055 §7 step 2) — the registry's
  // tier lists, or the /failback override's ring while it replaces them; on
  // this run's single agent the move is a fork copy, the chain's model, the
  // failover note and the ladder reset. Key rotation (step 1, above) runs
  // before this.
  // `until` is a reset time the failure-message classifier read (§7.1): the
  // model's down mark lasts until then instead of the scope boundary;
  // `classified` records that the class came from the classifier, so the ◈
  // line names the move "quota (classifier)" (§6.5).
  const switchModel = async (why: string, until?: number, classified?: boolean): Promise<boolean> => {
    limits ??= await contextLimitsOf(client)
    // The failover decision — the candidate choice (a fresh selection over
    // the list in force), the route value, the ⇄ line and the cross-agent
    // verdict — is the router's; the ladder is this loop's own per-prompt
    // bookkeeping and stays here.
    const decision = await router.failover(routing, switches, {
      chain,
      phase: opts.phase,
      cap,
      limits,
      label: task.id,
      why,
      until,
      classified,
      waitWindow: waitForWindow,
    })
    if (decision === undefined) return false
    // The route the failover picked, written wholesale (setRoute): the
    // selection state — the internal name and the base step — travels with
    // the chain; the down marks keep the move through the task boundaries
    // under scope=phase (§6.4).
    setRoute(chain, decision.route)
    // This candidate gets its own full round of the retry ladder.
    ladder.i = 1
    // Cross-agent move (§7 step 2 / §8.3): the pick runs on another agent
    // than the chain's session, and a session never crosses agents — no
    // fork, no reuse. The chain drops its session and the next dispatch
    // opens a blank one on the target agent with the worktree-check note,
    // today's "blank new session" path. The failed-session record is
    // dropped with it: its fork value is unreachable from the new agent, so
    // it stops being a fork source instead of failing noisily on the next
    // retry.
    if (decision.moveAgent !== undefined) {
      toAgent(
        chain,
        retryNote(`Switched model to continue (${why}), moving to agent ${decision.moveAgent}; the new session did not inherit the earlier session's context`),
      )
      return true
    }
    // Context travels along (design D.3/D.4): fork clones the messages one by
    // one and carries only messages, not the agent/model/permissions, so
    // continuing on a switched model needs no context rebuild. The fork source
    // uses the same "keep the most valuable session" criterion as the retry
    // ring: the failed session itself (counted only with usage > 0; 0 usage is
    // a pure error stub) and the chain's original session, taking the one with
    // more accumulated usage. The two trigger faces leave the chain in
    // different shapes, and this one criterion covers both: for the
    // non-retryable classes (quota/auth/rate) attempt has already promoted the
    // session to chain.id with chain.failed empty, so the pick is chain.id
    // (behavior unchanged from before the rework); when a retryable class
    // falls back here after exhausting the ladder, attempt has restored
    // chain.id to the original session from before the dispatch and the one
    // actually holding the context is chain.failed — ignoring it would throw
    // away 100k+ of output and open a blank session. A successful fork
    // continues from the copy; when none is usable it falls back to a
    // brand-new session — the switch still takes effect, only the context is
    // not inherited.
    // "The session this prompt was dispatched to": recorded in chain.failed
    // for retryable classes, already promoted to chain.id by attempt for
    // non-retryable ones — picking it means the context is complete, carrying
    // only the model-switch note; picking the chain's original session means
    // this attempt's partial output is not in the copy, so the worktree-check
    // note is required (see retryNote).
    const failedID = chain.failed?.id ?? chain.id
    // The shared "keep the most valuable session" criterion (forkSources):
    // the failed session above the chain's original session, by accumulated
    // context; a 0-token error stub never qualifies.
    // chain.failed is deliberately kept after the fork seeding (not cleared):
    // if the copy dies at 0 tokens (a run of consecutive quota failures),
    // attempt's guard will not replace it with the error stub, and the next
    // retry can still fork again from this most valuable session; once the copy
    // succeeds, attempt's close-out clears it. Dead records whose fork has gone
    // stale are cleaned up here in passing, so later rounds do not keep forking
    // a dead session.
    const sources = forkSources(chain)
    for (const source of sources) {
      const forked = await forkSession(await chainClient(), source.id, chain.subject ?? `${task.id} failover`)
      if (forked === undefined) {
        dropStaleFailed(chain, source.id)
        continue
      }
      // One-off failover note: carried to the AI with the next prompt via attempt's
      // note mechanism and cleared once used, telling the new model to keep the
      // earlier output formats and protocol (same idea as the stuck hint's weak-model
      // backstop); a fork of the original session (no context from this attempt)
      // gets the worktree-check form instead.
      moveOnFork(
        chain,
        forked,
        source,
        source.id === failedID
          ? `[DRIVER] Switched model to continue (${why}); keep the output formats and protocol used earlier in this session.`
          : retryNote(`Switched model to continue (${why}), but this session did not inherit this attempt's context.`),
      )
      return true
    }
    if (sources.length) log(`↻ failover fork copies failed; the switch still takes effect, falling back to a blank new session (no context inherited)`)
    else log(`↻ no session context on the chain to inherit; the switch still takes effect, starting a blank new session`)
    // Falling back to a blank new session leaves no context at all: "keep what was
    // used earlier" would mislead a session with nothing earlier, so the note
    // becomes the worktree-check form (the worktree may hold this attempt's output).
    toBlankSession(chain, retryNote(`Switched model to continue (${why}), but this session did not inherit the earlier session's context.`))
    return true
  }
  // Escalation step 1 (plans/0055 §7): a quota/auth/rate failure whose model
  // runs on a provider with a key ring moves the ring first — mark the
  // current key down, write the next key into the spawn config, restart the
  // managed server, then re-dispatch the *same* model from a fork of the
  // failed session (the retry path's source choice and note). An auth error
  // counts here because a revoked key looks like one. Only when no key is
  // left that is not down (no ring, inactive rings, an exhausted ring, no
  // host that can take a new spawn config) does the caller fall through to
  // the model failover of step 2 — which then marks the model down and lets
  // selection's ring predicate (§6.2 rule 4) skip every entry on the
  // exhausted provider.
  // AUTO-RESOLVE: the design says the re-dispatch's "source choice and note are those of the retry path" — may the note keep the retry path's literal "transient session error" wording? -> no, the two note forms and the mechanism are the retry path's, but the lead names the key failure ("failed on this provider's key (…) retried on the next key of the ring") (a quota-failed fork told about a transient error would misread the tail message it carries; the forms explain a repeated prompt alike, so only the lead changes)
  // `until` as for switchModel: the failed key's mark lasts until the reset
  // time the classifier read.
  const rotateProviderKey = async (why: string, until?: number): Promise<boolean> => {
    // The step-1 decision is the router's: the plan names the provider and
    // the rotation that would land, or an exhausted ring whose current key
    // still failed. The I/O — the spawn config, the host restart, the
    // re-dispatch fork — stays here.
    const plan = router.keyRotation(routing, chain)
    if (plan === undefined) return false
    if (plan.rotation === undefined) {
      // No key is left that is not down (an exhausted or single-key ring):
      // the current key failed all the same, so it is marked down before the
      // fall-through, and §6.2 rule 4 keeps every entry on this provider out
      // of the selection that follows.
      // AUTO-DECISION: the current key is marked down even when no rotation can land (the design's step 1 words the marking as part of a rotation, but an unmarked current key would leave the ring reading usable while its key just failed with quota, and the failover would be able to re-pick the same dead key the moment the model mark clears)
      router.markCurrentKeyDown(plan.provider, until)
      return false
    }
    // Rotation restarts the chain's host (§8.1: the pool applies restart to
    // the chain's agent), and its setConfig reaches every started host at
    // once (one ring state, one spawn config).
    const host = opts.server
    if (host === undefined || host.setConfig === undefined) return false
    const from = ringKeyLabel(plan.rotation.from)
    const to = ringKeyLabel(plan.rotation.to)
    router.commitRotation(plan.rotation, until)
    host.setConfig(router.spawnKeyConfig())
    const restarted = await host.restart(`${why}; rotating the provider ${plan.provider} key ring to key ${to}`, chain.agent)
    log(
      `⇄ ${task.id} ${why}; provider ${plan.provider} key ${from} marked down, continuing the same model on key ${to}` +
        (restarted ? "" : " (the managed server could not be restarted; the new key applies at its next spawn)"),
    )
    // The re-dispatch rides a fork of the failed session — the same source
    // choice as the retry ladder and switchModel (forkSources: the failed
    // session itself above the chain's original session, by accumulated
    // context; a 0-token error stub never qualifies), so the turn's context
    // survives the restart (F8: sessions persist across a managed server
    // restart).
    const failedID = chain.failed?.id ?? chain.id
    const sources = forkSources(chain)
    for (const source of sources) {
      const forked = await forkSession(await chainClient(), source.id, chain.subject ?? `${task.id} key rotation`)
      if (forked === undefined) {
        dropStaleFailed(chain, source.id)
        continue
      }
      log(`↻ ${task.id} ${why}; re-dispatching the same model from a forked copy of the ${source.why} ${source.id} (${formatTokens(source.used)} tokens)`)
      moveOnFork(
        chain,
        forked,
        source,
        source.id === failedID
          ? `[DRIVER] The previous dispatch failed on this provider's key (${why}) and is being retried on the next key of the ring; continue with what this task asks.`
          : retryNote(`The previous dispatch failed on this provider's key (${why}) and is being retried on the next key of the ring, but this session did not inherit this attempt's context.`),
      )
      return true
    }
    if (sources.length) log(`↻ key rotation fork copies failed; the rotation still takes effect, re-dispatching in a blank new session (no context inherited)`)
    else log(`↻ no session context on the chain to inherit; the rotation still takes effect, re-dispatching in a blank new session`)
    toBlankSession(chain, retryNote(`The previous dispatch failed on this provider's key (${why}) and is being retried on the next key of the ring, but the earlier session's context could not be inherited.`))
    return true
  }
  // The down marks one failure's escalation may write (plans/0055 §7.1)
  // and the late classifier answer's extension of them both are the
  // router's: the registry lookup, the ring reads and the ⏲ line (with its
  // registry time zone). The mark writes themselves go through the router
  // methods, as before.
  const downTarget = () => router.downTarget(routing, chain)
  const lateReset = (pending: Promise<number | undefined> | undefined, target: ReturnType<typeof downTarget>): void => {
    router.lateReset(routing, pending, target, task.id)
  }
  // The window wait (plans/0055 §6.3): every candidate is blocked only by
  // its windows and one that is not down opens later. The dispatch sleeps
  // inside the unit before dispatching, as the recovery wait does: one wait
  // line naming the model and its opening, the interval booked as a `window`
  // wait (excluded from aiMs/wallMs, recorded as waitMs), and hibernate's
  // random delay of 0–600 s on top of the opening (plans/0027 D3, shared
  // through HIBERNATE_JITTER_MS and the booked sleep), so drivers sharing an
  // account do not all dispatch at the same moment. A double Ctrl+C
  // force-quits it through runAll's process-level SIGINT handler (130), like
  // every long wait. After the wake the loop selects again on the machine
  // clock (the facts' injected clock in tests): a suspend only wakes late,
  // and a wake past a short window simply waits for its next opening — the
  // wait never exits on its own (§10 item 7).
  // AUTO-DECISION: the wait decision is honored at every selection site — the dispatch target (attempt returns the facts, this loop sleeps), the failover (switchModel below) and the probe loop (awaitRecovery below) wait and re-select in place — instead of only at the dispatch (a failover onto a window-blocked list or a probe round after the marks clear would otherwise burn wait-and-probe rounds against a closed window; the wait line keeps the designed text and adds hibernate's resuming/force-quit hint, which §6.3's force-quit promise asks to be visible)
  // The wake computation (the facts' clock, the jitter knob) is the
  // router's `windowWake`, so the lines and the booked sleep are the
  // site's whole remaining body.
  const waitForWindow = async (wait: WindowWait): Promise<void> => {
    const { sleep, wakeAt } = windowWake(routing, wait)
    log(
      `⏸ ${task.id} ${roleOf(chain)} waits for a ${wait.tier} model: ${wait.model} ${wait.opens}` +
        `, resuming around ${wakeAt.toISOString()} (local ${wakeAt.toLocaleString()}, includes random delay); press Ctrl+C twice to force-quit`,
    )
    await bookedSleep("window", sleep, { dir: opts.dir, sleep: (ms) => clock.sleep(ms) })
    log(`→ window wait over: continuing after ${wait.model} opened`)
  }
  // The model the chain's dispatches ran on, the way attempt records it for
  // strict resume: the selected entry (undefined = the agent's own default
  // model).
  const chainModel = (): string | undefined => chain.modelEntry
  // The sleep of one wait-and-probe round (plans/0057 §6): until the known
  // instant plus hibernate's random delay of 0–600 s (drivers sharing an
  // account do not all probe the same second after a reset), else the
  // polled interval — OPENCODE_AUTO_RECOVERY_WAIT, now the interval used
  // when no instant is known. Under a registry the instant is when the down
  // list comes back by waiting alone (select.ts recoveryAt: the down marks'
  // `until`s — which hold the resets the escalation and the probes wrote —
  // and the windows; unknown when a mark has no end, so the loop polls);
  // without one it is the reset the last failure stated. A registry
  // candidate usable now explains no wait: the loop is here for a failure
  // the marks do not record (a non-retryable error of no escalation class,
  // a probe that failed on a candidate selection picked as usable), so the
  // failure's own reset applies there too, else the poll — never a
  // jitter-only round. A reset beyond the horizon (RESET_HORIZON_MS) is not
  // scheduled. `model` is the model the wait is for, the key of the
  // quota-window figure.
  // Where the failure's own reset would apply but it states none — a
  // failure of unknown wording, a probe that errored on its own — the
  // account's learned windows stand in (src/quota-windows.ts, plans/0057 §8):
  // the latest reset among its spent windows, this run's or an earlier
  // one's, so a probe that cannot succeed before it is not sent. The line
  // says when that reset was recorded.
  const planSleep = async (cause: WaitCause | undefined): Promise<{ ms: number; wake?: Date; reason?: string; model: string }> => {
    // The sleep-source cascade (which instant the round sleeps to and why)
    // is the router's `recoverySleep`, with this loop's own I/O handed in
    // as callbacks: the context-window fetch (cached in `limits`) and the
    // learned-window lookup (with the account the failure or the chain
    // names). The horizon clamp and the poll fallback stay here
    // (RESET_HORIZON_MS is the learned-window policy, not a routing
    // decision), as does the jitter draw on the scheduled tail.
    const sleep = await router.recoverySleep(routing, switches, {
      chain,
      phase: opts.phase,
      cap,
      loadLimits: async () => (limits ??= await contextLimitsOf(client)),
      cause,
      learned: (now) => learnedReset(opts.dir, cause?.account ?? accountOf(chain, routing), now),
    })
    if (sleep.at === undefined || sleep.at - sleep.now > RESET_HORIZON_MS) return { ms: switches.recoveryWait * 60_000, model: sleep.model }
    const ms = Math.max(0, sleep.at - sleep.now) + jitterOf(routing)
    return { ms, wake: new Date(sleep.now + ms), reason: sleep.reason, model: sleep.model }
  }
  // /exit inside the wait (plans/0057 §6, §11 item 9): no session is active,
  // so the wait is a safe boundary. The pause keeps what the recovery would
  // have continued on success — the most valuable fork source and its
  // figure — in the progress record the re-run's recovery reads (written as
  // attempt writes it at a dispatch, with the figure for an agent that keeps
  // no history; the agent field is the fence's `agentField` verdict, the
  // facts passed untested), then throws to runAll (exit 3). A chain without
  // a phase is a one-off session that writes no record, and a chain without
  // a session has nothing to keep; the line says so.
  const pauseForExit = async (): Promise<never> => {
    const best = forkSources(chain)[0]
    let kept: string
    if (best === undefined) kept = "no session holds this attempt's context, so the re-run starts it in a new session"
    else if (!opts.dir || !chain.phase) kept = `the ${best.why} ${best.id} is a one-off session with no progress record, so the re-run starts it anew`
    else {
      await saveProgress(opts.dir, {
        task: task.id,
        session: best.id,
        at: clockNow(),
        active: true,
        phase: chain.phase,
        ...(strictResumeActive(opts, switches) ? { baseline: chain.baseline ?? (await unitBaseline(opts.dir)), model: chainModel() } : {}),
        ...(chain.agent !== undefined ? { agent: chain.agent } : {}),
        used: best.used,
      })
      kept = `the re-run resumes the ${best.why} ${best.id} (${formatTokens(best.used)} tokens)`
    }
    log(`⏸ ${task.id} /exit inside the recovery wait: ${kept}`)
    throw new ExitRequested("wait", `${task.id} recovery wait`)
  }
  // The wait-and-probe loop (strategy of 2026-09-16): the final destination of
  // every session fault — no longer a blocking exit; it waits indefinitely,
  // each round sleeping until a known reset (plans/0057 §6, planSleep above)
  // or for recoveryWait (default 30 minutes) and then dispatching a tiny
  // probe prompt through a **fresh temporary clean session** to tell whether
  // service has recovered; once recovered it forks the interrupted session
  // (same "keep the most valuable session" criterion as the retry ring: the
  // failed session itself > the chain's original session; 0-usage pure error
  // stubs never enter the candidates) and continues from the copy; a failed
  // fork falls back to a blank new session re-sending the full prompt, and the
  // ladder counter starts a fresh round. This way, whatever quota restriction
  // it faces, the program waits until the quota recovers and then continues;
  // during the wait /exit pauses the run (pauseForExit above) and a double
  // Ctrl+C force-quits through runAll's process-level SIGINT handler (130).
  // The probe chain carries no phase (writes no progress record, leaves the
  // real chain's recovery point untouched) but copies the real chain's
  // model/role — what is probed is exactly the model the run will continue on
  // after recovery; quota is metered per model/account, so probing another
  // model says nothing. A probe session failing on its own (stream
  // subscription dropped, etc.) likewise counts as not recovered: keep
  // waiting.
  // Under a registry (§6.3) the probe dispatches through selection like any
  // other: the probe candidate is the first one inside its window, ignoring
  // the down marks, so its mark is cleared for the probe and re-marked when
  // the probe fails — a successful probe leaves it cleared, which is exactly
  // "a successful probe clears that candidate's mark", and the re-dispatch
  // that follows picks it as the first usable candidate. A window-blocked
  // list (the wait decision) never gets here: it waits on the window below
  // instead of burning probe rounds against a closed window.
  // AUTO-DECISION: the probe realizes the mark-clearing by clearing the probe candidate's mark before the dispatch and re-marking it on a failed probe, instead of bypassing selection with a dictated model (selection then picks the cleared candidate deterministically — it is the first in-window one — and no dispatch path exists that skips the windows or the marks)
  // `cause` is the failure that led here (absent when selection found
  // nothing usable before any session ran); each failed probe replaces it.
  const awaitRecovery = async (why: string, cause?: WaitCause): Promise<void> => {
    for (;;) {
      if (control.exitRequested()) await pauseForExit()
      const sleep = await planSleep(cause)
      const quit = opts.interactive ? "type /exit to pause the run here, or press Ctrl+C twice to force exit" : "press Ctrl+C twice to force exit"
      log(
        sleep.wake !== undefined
          ? `⏳ ${task.id} ${why}; ${sleep.reason}, sleeping until about ${sleep.wake.toISOString()} (local ${sleep.wake.toLocaleString()}, includes random delay), then probing service recovery with a fresh temporary session (${quit})`
          : `⏳ ${task.id} ${why}; waiting ${switches.recoveryWait} minutes, then probing service recovery with a fresh temporary session (${quit})`,
      )
      // The wait can run to hours: deducted from the session and AI timings
      // and booked separately as waitMs (same treatment as askHuman,
      // STATS_PLAN §2/§3); the probe session's own timings are booked as
      // usual. A wait for a limit — scheduled to its reset, or after a quota
      // or rate failure — is also booked per model as time lost to quota
      // windows (plans/0057 §11 item 7): the planned sleep, or the part slept
      // before /exit cut it short.
      const began = clockNow()
      let paused: boolean
      await statsWaitBegin(opts.dir, "recovery")
      try {
        paused = await clock.sleepUnlessExit(sleep.ms)
      } finally {
        await statsWaitEnd(opts.dir)
      }
      if (sleep.wake !== undefined || cause?.errorClass === "quota" || cause?.errorClass === "rate")
        await statsQuotaWait(opts.dir, sleep.model, paused ? Math.min(sleep.ms, Math.max(0, clockNow() - began)) : sleep.ms)
      if (paused) await pauseForExit()
      // The probe candidate's provider, when its ring kept the candidate
      // unusable: the probe ignores the ring (§6.3), so the ring's key marks
      // clear for the probe and the key it ran on is re-marked on failure —
      // the same clear-and-re-mark the model mark gets, and the position
      // never moves.
      // AUTO-DECISION: the probe's ring half re-marks only the current key on failure, not every cleared mark (the probe ran on the current key alone; the earlier keys' marks would have cleared at the same boundaries anyway, and a wrapped rotation onto them later is the §6.4 semantics a boundary clear already has)
      // The selection itself (the wait-and-reselect loop and the clear half
      // of the mark dance) is the router's `probeSelection`, with this
      // loop's limits fetch and window sleeper handed in as callbacks; the
      // re-mark on a failed probe runs below, after the probe session
      // returns.
      const probePick = await router.probeSelection(routing, switches, {
        chain,
        phase: opts.phase,
        cap,
        loadLimits: async () => (limits ??= await contextLimitsOf(client)),
        waitWindow: waitForWindow,
      })
      const probed = probePick?.model
      const probedProvider = probePick?.provider
      const probe: SessionChain = probeChain(chain)
      let ping: SessionResult
      try {
        // The probe chain carries no agent on purpose (§8.1): attempt's own
        // selection picks the just-cleared probe candidate, so the pool
        // starts and uses that candidate's host — the model being probed,
        // whatever agent runs it.
        ping = await attempt(client, task, PROBE_PROMPT, opts, probe, undefined, undefined, switches)
      } catch (error) {
        if (error instanceof AgentStartError) throw error
        if (probed !== undefined) router.markModelDown(probed)
        if (probedProvider !== undefined) router.markCurrentKeyDown(probedProvider)
        // The probe-failure compensation counter (plans/0069 §2.4): one per
        // failed probe round, on the model it probed; an absent probed is a
        // no-op.
        await statsModelEvent(opts.dir, probed, "probe")
        log(`⏳ ${task.id} probe session itself errored (${formatClientError(error)}); service not recovered, continuing to wait`)
        // It says nothing of the limit: the account's learned windows (§8)
        // decide the next sleep, else the poll.
        cause = cause?.account !== undefined ? { account: cause.account } : undefined
        continue
      }
      // The account the probe ran on: the probed candidate's (the probe's
      // own dispatch wrote the entry onto the probe chain).
      const probeAccount = accountOf(probe, routing)
      if (ping.type !== "idle") {
        await learnFailure(opts.dir, probeAccount, ping, clockNow())
        cause = { ...ping, account: probeAccount }
        // A reset time the classifier read from the probe's failure sets
        // when the re-written marks clear (§7.1), as on the escalation.
        if (probed !== undefined) router.markModelDown(probed, ping.resetAt, ping.classified)
        if (probedProvider !== undefined) router.markCurrentKeyDown(probedProvider, ping.resetAt)
        if (probed !== undefined) lateReset(ping.pendingReset, { model: probed })
        // The probe-failure compensation counter (plans/0069 §2.4), the same
        // one line as an errored probe round above.
        await statsModelEvent(opts.dir, probed, "probe")
        log(`⏳ ${task.id} probe session still failing (${firstLine(ping.question)}); continuing to wait`)
        continue
      }
      await accountAnswered(opts.dir, probeAccount, clockNow())
      const sources = forkSources(chain)
      // "The session this prompt was dispatched to": promoted to chain.id by
      // attempt for the non-retryable classes, recorded in chain.failed for
      // the retryable ones — picking it means the context is complete,
      // carrying only the recovery note; picking the original session / a
      // blank session means this attempt's partial output is not in the
      // context, so the worktree-check note is required (see retryNote).
      // chain.failed is deliberately kept after the fork seeding (same
      // invariant as the retry ladder, see below): when the copy dies at 0
      // tokens the record is not replaced, and the recovery re-send can still
      // fork again from it.
      const failedID = chain.failed?.id ?? chain.id
      let seeded = false
      for (const source of sources) {
        const forked = await forkSession(await chainClient(), source.id, chain.subject ?? `${task.id} recovery`)
        if (forked === undefined) {
          dropStaleFailed(chain, source.id)
          continue
        }
        log(`↻ ${task.id} service recovered; re-dispatching the task from a forked copy of the ${source.why} ${source.id} (${formatTokens(source.used)} tokens)`)
        // One-off recovery note: the forked copy ends with the original error
        // message, so a repeated prompt needs a word of explanation or the AI treats
        // it as a repeated request; a fork of the original session (no context from
        // this attempt) gets the worktree-check form instead.
        moveOnFork(
          chain,
          forked,
          source,
          source.id === failedID
            ? "[DRIVER] The previous dispatch was interrupted by a service/quota failure; service has recovered, so continue with what this task asks."
            : retryNote("The previous dispatch was interrupted by a service/quota failure; service has recovered, but this session did not inherit this attempt's context."),
        )
        seeded = true
        break
      }
      if (!seeded) {
        if (sources.length) log(`↻ ${task.id} service recovered, but all forked copies of the interrupted session failed; falling back to a blank new session to re-dispatch the task`)
        // A blank new session knows nothing of this attempt's output; the re-send
        // must carry the worktree-check note.
        toBlankSession(chain, retryNote("The previous dispatch was interrupted by a service/quota failure; service has recovered, but the earlier session's context could not be inherited."))
      }
      // Service is back: the ladder starts a fresh round for the re-dispatch.
      ladder.i = 1
      return
    }
  }
  // The retry step's fork seeding: keep the most valuable session, then fork
  // from it — the candidates are the just-failed session itself and the
  // chain's original session (attempt() has restored chain.id to the original
  // session from before the dispatch; in a reuse round the two are the same
  // one, deduplicated into a single try), value measured as "accumulated
  // context usage", take the largest, and on a failed fork fall to the next
  // best; when none is usable, fall back in turn to the fork base (a warm
  // prefix, see the forkBase branch below) and a blank new session.
  //
  // Why the failed session comes first: timeout/stream-break faults have
  // nothing to do with the session's content (a provider-side stall), and
  // the 100k+ of verified output in that session is this round's most
  // valuable asset — opening a blank session equals throwing it away and
  // hitting the same wall from zero; plans/0015-session-error-retry-plan.md
  // fact baseline item 4 records such a counterexample, "worse than not
  // reusing at all". The cost is a copy whose tail carries that 0-token
  // error message, with the retry prompt landing after it; a failed session
  // with used = 0 is a pure error stub (it failed on dispatch and produced
  // nothing), holds nothing worth protecting, and does not enter the
  // candidates (keeping the original design's criterion).
  //
  // Always fork a copy rather than reuse directly: the original session is
  // untouched and discarded on failure, and the recovery point remains the
  // original session (progress's restore logic untouched, see attempt()'s
  // retryable branch). Nor is seedForkSession's "cold start once usage
  // reaches cap/2" guard placed here — that guard protects a new subtask
  // from lugging an oversized prefix, while a retry is the same prompt
  // living on; the prefix is large precisely because much work was done.
  //
  // "The session this prompt was dispatched to" = chain.failed (for
  // retryable classes attempt has restored the chain state and recorded it):
  // picking it means the context is complete, and the re-send needs only one
  // line of explanation; picking the chain's original session, the base, or
  // a blank session means this attempt's partial output already on disk is
  // not in the context, so the worktree-check note is required (see
  // retryNote).
  const seedRetry = async (nth: number, question: string): Promise<void> => {
    const failedID = chain.failed?.id ?? chain.id
    // The shared source list of forkSources — the "keep the most valuable
    // session" criterion documented above, as one sorted list.
    // chain.failed is deliberately kept after the fork seeding (not cleared):
    // if the copy dies at 0 tokens (a run of consecutive quota failures,
    // 2026-09-17 virtio T-005), attempt's guard will not replace it with the
    // error stub, and the next retry can still fork again from this most
    // valuable session; once the copy produces content (used > 0), it is a
    // strict superset and replaces the record normally, cleared by attempt's
    // close-out on success. Dead records whose fork has gone stale are cleaned
    // up here in passing.
    const sources = forkSources(chain)
    let seeded = false
    for (const source of sources) {
      const forked = await forkSession(await chainClient(), source.id, chain.subject ?? `${task.id} retry`)
      if (forked === undefined) {
        dropStaleFailed(chain, source.id)
        continue
      }
      log(`↻ ${task.id} transient session error; retrying from a forked copy of the ${source.why} ${source.id} (${formatTokens(source.used)} tokens) (${nth}/${waits.length}):\n${question}`)
      // One-off retry note: the copy ends with the error message, so a repeated
      // prompt needs a word of explanation or the AI treats the re-send as a repeated
      // request (same motive as awaitRecovery's note). retryOnFork keeps the
      // original session in chain.id (the next retry forks from it again); with
      // both note and pending set, attempt consumes pending first (the resumed
      // check requires pending to be empty), so the original session is never
      // reused by mistake.
      retryOnFork(
        chain,
        forked,
        source,
        source.id === failedID
          ? "[DRIVER] The previous dispatch was interrupted by a transient session error and is being retried now; continue with what this task asks."
          : retryNote("The previous dispatch was interrupted by a transient session error and is being retried now, but this session did not inherit this attempt's context."),
      )
      seeded = true
      break
    }
    if (seeded) return
    if (sources.length) log(`↻ fork retry copy failed; falling back to the fork base / a blank new session`)
    // No session to fork (the subtask's very first message failed, the chain
    // was empty to begin with) but the base is still alive: re-seed from the
    // base, recovering at least the free warm prefix instead of a pure cold
    // start — same semantics as the fork three-step's "each item forks anew
    // from the base" (fork-decompose design §4.3). The base prefix holds only
    // the task background; this attempt's context is not in it, so the re-send
    // must carry the worktree-check note. A stale base falls back to a blank
    // new session.
    if (chain.id === undefined && chain.forkBase !== undefined && (await sessionAlive(await chainClient(), chain.forkBase))) {
      const base: ForkBaseInfo = { id: chain.forkBase, used: await sessionUsed(await chainClient(), chain.forkBase), ...(chain.forkLead ? { lead: true } : {}) }
      if (await seedForkSession(client, opts, chain, base, chain.subject ?? `${task.id} retry`)) {
        log(`↻ ${task.id} transient session error; no session on the chain to fork, re-seeded from the base for retry (${nth}/${waits.length}):\n${question}`)
        // The re-seeded retry completes through the same transition: the
        // forked session is the one the seeding put on pending and the base
        // is its source, so retryOnFork repeats the seeding's own
        // pending/pct/used values (identical outcome) while attaching the
        // worktree-check re-send note — the one write no transition owns
        // alone.
        // AUTO-DECISION: the base re-seed's one-off note goes through
        // retryOnFork over the just-seeded fork rather than a note-only
        // transition (the seeded session is this retry's fork and the base
        // its source, and the repeated writes carry the seeding's own
        // values, so the chain state is unchanged; a note-only transition
        // would be vocabulary beyond the transitions table this conversion
        // follows, and folding the note into the seeding helper would touch
        // a file whose own chain writes are a later conversion's to make).
        retryOnFork(
          chain,
          chain.pending!,
          { id: base.id, used: base.used ?? 0, why: "fork base" },
          retryNote("The previous dispatch was interrupted by a transient session error and is being retried now, but this session did not inherit this attempt's context."),
        )
        return
      }
    }
    log(`↻ ${task.id} transient session error; retrying with a new session (${nth}/${waits.length}):\n${question}`)
    // The retry keeps the "switch to a new session" semantics and never
    // reuses the errored session; a blank session knows nothing of this
    // attempt's output, so the re-send must carry the worktree-check note —
    // otherwise the new session redoes the half-finished work from scratch.
    toBlankSession(chain, retryNote("The previous dispatch was interrupted by a transient session error and is being retried now, but this session did not inherit the earlier session's context."))
  }
  // The loop itself is only the executor of the pure ladder decision
  // (src/engine/ladder.ts): every dispatch's outcome is handed to nextStep
  // with the facts the decision cannot read itself (the routing facts'
  // presence, the ladder's waits, the managed server, the account a failure
  // books against), and the step it answers is executed below with today's
  // side effects in their places.
  for (;;) {
    let result: SessionResult
    try {
      result = await attempt(client, task, promptText, opts, chain, steer, test, switches)
    } catch (error) {
      // A host that cannot start (§8.1: a profile env reference that broke
      // since the run start) stops the run, exactly as the eager start would
      // have — the retry ladder must not turn a broken profile into hours of
      // retries. Everything else a session throws (event stream drops,
      // request timeouts) stays a session fault and enters the recovery
      // machinery below.
      if (error instanceof AgentStartError) throw error
      // A session fault does not exit: exceptions thrown by SDK calls (event
      // stream subscription dropped, request timed out and aborted, etc.)
      // enter the retry/wait mechanisms through the same channel as returned
      // errors — apart from a double Ctrl+C, no session fault ever terminates
      // the run.
      result = { type: "blocked", question: `session error: ${formatClientError(error)}` }
    }
    const account = accountOf(chain, routing)
    // The facts carry only what varies between dispatches (0069 §2.2 D2):
    // the ladder's waits, the managed server and the booking account —
    // every run has a registry since the implicit registry (0061 F2), so
    // the candidate table needs no flag.
    const facts: LadderFacts = {
      waits,
      server: opts.server !== undefined,
      account,
    }
    const step = nextStep(result, ladder, facts)
    switch (step.kind) {
      // A turn that went through clears its account's spent windows
      // (plans/0057 §8): whatever an entry said, the account answers now.
      // An in-session blocked question needs a human reply and was never a
      // fault — it returns without booking.
      case "return":
        if (step.result.type !== "blocked") await accountAnswered(opts.dir, account, clockNow())
        return step.result
      // A waitable window sleeps inside the unit until the opening plus the
      // jitter, then the loop selects and dispatches again.
      case "window-wait":
        await waitForWindow(step.wait)
        continue
      // The wait-and-probe loop, the final destination of every session
      // fault (and of a no-model exhaustion, with no cause). A recover with
      // a cause answers a session fault, so it books the failure first; the
      // no-model recover carries no cause (no session ran) and books
      // nothing.
      case "recover":
        if (step.cause !== undefined && result.type === "blocked") await learnFailure(opts.dir, account, result, clockNow())
        await awaitRecovery(step.why, step.cause)
        continue
      // The three fault steps share one booking: a session fault records
      // its stated windows before the step's own effects (plans/0057 §8) —
      // a reset that outlives the process, booked for the account the
      // failure ran on, read before the escalation moves the chain. The
      // blocked guard holds by nextStep's contract (these kinds answer a
      // fault face, which only a blocked result carries) and only types
      // the reads of the result's failure fields below.
      // AUTO-DECISION: the booking hangs on the step kinds (the fault set
      // is exactly escalate, after-ladder, retry and the recover-with-a-
      // cause below) instead of a fault flag on Step — the kinds state the
      // invariant where the booking happens, and a flag would be
      // vocabulary on every step for one call's wiring.
      case "escalate":
      case "after-ladder":
      case "retry":
        if (result.type !== "blocked") continue
        await learnFailure(opts.dir, account, result, clockNow())
        if (step.kind === "escalate") {
          // The escalation is key → model → wait (plans/0055 §7): a ringed
          // provider rotates to its next key first (rotateProviderKey), the
          // model failover (switchModel, step 2) follows only when no key
          // is left, and the wait-and-probe loop takes what neither can
          // move — the order is the invariant. The registry-presence test
          // that used to gate step 1 lives behind the fence now: without a
          // registry the rotation plan is undefined and step 1 falls
          // straight through to the model failover. The down marks are read
          // before the escalation moves anything (downTarget), so a
          // classifier answer still on its way can extend them to the reset
          // it names (lateReset).
          const target = downTarget()
          const moved =
            (await rotateProviderKey(step.label, step.until)) ||
            (await switchModel(step.label, step.until, step.classified))
          lateReset(result.pendingReset, target)
          if (moved) continue
          // Candidates exhausted (candidates and primary all quota-restricted /
          // unusable): no longer a blocking exit — the wait-and-probe loop waits
          // for the quota to recover, probing with the currently effective model
          // in the meantime, and after recovery continues from a fork of the
          // interrupted session. The message (the fence's rendering) names the
          // marks and candidates as they stand now, after the escalation wrote
          // its own.
          await awaitRecovery(router.exhaustionWhy(routing, step.label), step.cause)
          continue
        }
        // Ladder exhausted: the failover candidates are tried first (switching
        // provider is the only lever outside the ladder not yet tried); when
        // those are exhausted too (or none configured — the decision then
        // answers recover directly), the wait-and-probe loop takes over, every
        // interval until service recovers, then continuing from a fork of the
        // interrupted session with the ladder restarted. Waiting inside the
        // process keeps the session alive and still forkable — a blocking exit
        // would instead throw away the very session the ladder rounds just
        // preserved.
        // Scope: runTask creates the chain per task, chain.model resets with
        // it, and the next task automatically starts again from the preferred
        // model; a finer/coarser failback granularity is consumed at the
        // boundary hook points by OPENCODE_AUTO_MODEL_FAILBACK_SCOPE (see
        // src/failback.ts).
        if (step.kind === "after-ladder") {
          if (await switchModel("retry ladder exhausted")) continue
          await awaitRecovery(step.why, step.cause)
          continue
        }
        // The backoff before this retry. The counter advances before the
        // action (this dispatch writes it from the step's ordinal), a
        // network/service failure restarts the managed server before the
        // retry goes out, and the fork-seeding paths share the ordinal as the
        // log ordinal. The sleep goes through the run services' clock and is
        // deliberately not interruptible by /exit — only the wait-and-probe
        // loop's sleeps are /exit boundaries.
        ladder.i = step.nth + 1
        if (step.restartServer && opts.server) {
          await opts.server.restart("session error is a network/service failure; restarting the opencode server and retrying with a new session", chain.agent)
        }
        if (step.waitMinutes > 0) {
          log(`⏳ ${task.id} transient session error; waiting ${step.waitMinutes} minutes before retrying (${step.nth}/${waits.length}):\n${firstLine(result.question)}`)
          await clock.sleep(step.waitMinutes * 60_000)
        }
        await seedRetry(step.nth, result.question)
        continue
    }
    // Exhaustiveness: every Step kind is dispatched above.
    step satisfies never
  }
}
