import { basename, join } from "node:path"
import { type ForkBaseInfo, type SessionChain, type SessionResult } from "./chain"
import { ensureDecomposed, executeWhole, runSubtask } from "./execute"
import { resumeModelEligible, resumeModelNow, rollbackUnitState, strictResumeActive, deadSessionWhy } from "./unit-commit"
import { taskDoc } from "./docpaths"
import { handoffStatus } from "./document/roles"
import { subtaskStateSpec } from "./document/spec"
import { checklistProblems, nextChecklistIndex, scanSubtaskStates } from "./document/state"
import { maybeExit } from "./exit"
import { clearDownMarks, consumeFailback, failbackApplies } from "./failback"
import { baselineIntact, removeIfUntracked, unitBaseline } from "./git"
import { hibernatePause } from "./hibernate"
import { log } from "./log"
import { type ClientSource, type Opts, type Outcome, type UnitStop } from "./opts"
import { phaseText, resumeNote, unitReruns } from "./resume-gate"
import { ensureForkBase, runSession } from "./session"
import { begin, markDone, reloadTask, type Plan, type Task } from "./tasks"
import { handoffFile } from "./prompt"
import { forgetProgress, recallProgress, saveProgress, type Phase } from "./resume"
import { clientOf, formatTokens, renameSession, sessionAlive, sessionUsage } from "./session-api"
import { statsModelEvent } from "./stats"
import { autoSwitches } from "./switches"
import { shellProfile } from "./shell"
import { stepPause } from "./step"
import { cleanTestHandoffs, restoreTestHandoffs, testHandoffExists } from "./testrun"
import { reportResult, runWrapup } from "./wrapup"

// Session-duration display uses the compact duration format: consolidated
// into formatDurationCompact in src/log.ts (STATS_PLAN §5 — T-001 hoisted it
// up; this task deletes the private copy here and imports instead).

// Runs one task through the pipeline; the driver owns all state writes (the
// todo.md → done.md renames, index ticks, .auto/), sessions never make them.
// --subtask auto (default): decompose (when subtasks.md has no checklist) →
// one session per subtask (driver ticks on trust) → wrap-up → closeout.
// --subtask off: a single whole-task session → wrap-up → closeout.
// --subtask ondemand: like off, but the session manages its own context budget
// (plans/0056): the driver steers milestone usage notices in, the session
// decides when to hand over and writes docs/<id>/handoff.md, and a fresh
// session continues from it; the driver's hard-wall hint (2x
// --context-limit, raised to a quarter of a large model window and clamped to
// 80% of it) is the last resort.
// Closeout reads the result line of the task report (docs/<id>/report.md):
// `Result: FAIL` blocks the task and stops the run; PASS or no result line
// marks the task done. There is no driver-run acceptance, audit or final
// review — checking is planned work (acceptance tasks, the v phase).
// All execution sessions of a task share one chain: the next session reuses
// the previous one when its context usage ended below REUSE_BELOW, its used
// tokens below 50% of contextLimit (default 32k) and it went idle within
// REUSE_IDLE_MS (default 5 minutes), otherwise a fresh session is created.
// There is no task mirror (CURRENT.md retired, plans/0054 D3): every prompt
// inlines the task, docs/T-NNN/todo.md and subtasks.md hold its content and
// progress, and a blocked/incomplete exit is reported in the run log while
// .auto/progress.json keeps the phase the next run's resume note is built from.
// Interruption recovery (.auto/progress.json): the driver persists the current
// phase at every pipeline boundary and the execution-chain session as active
// while a session is in flight. On re-run: an active record with a live
// session resumes that session (unsummarized in-flight work — equivalent to
// `opencode -r <session-id>`), unless a handoff document was written before
// the interruption (the old session's context was exhausted and the handoff
// carries the state — a fresh session continues from it) or --new-session was
// given (skip reuse only; the recorded phase still re-enters the pipeline
// precisely). Anything else starts a fresh session guided by the recorded
// phase (graceful exits leave a summarized record with active=false); the
// phase also re-enters the pipeline precisely — off/ondemand past the
// execution phase never re-run the whole-task session, a closeout record
// skips the wrap-up. Network-failure blockades keep the active record (the
// session is in-flight and unsummarized); every other blocked/incomplete exit
// finalizes the summary and drops reuse eligibility.
// Session reuse is gated by unit attribution (unitReruns): the interrupted
// session belongs to one concrete execution unit (pipeline stage / subtask #N)
// and is resumed only when that unit will actually rerun — a unit already
// passed, disabled by config/switches, or unattributable (legacy record
// without index) seals the record and starts a fresh session, so the next
// unit never inherits a stranger's session.
// Permission requests follow --permission (default
// ask-deny): auto-allow grants immediately; ask-* wait for a human (per
// --wait-answer) and time out into auto-allow / auto-deny (session
// continues) / abort+block (ask-fail). Blocking happens on a repeated
// question on the same issue, exhausted transient session errors, a FAIL
// result line, or an ask-fail permission timeout.
export async function runTask(
  client: ClientSource,
  plan: Plan,
  task: Task,
  opts: Opts,
): Promise<Outcome> {
  // Experiment switches (the OPENCODE_AUTO_* environment-variable layer,
  // plans/0003-fork-decompose-design.md §4.6): parsed once at the entry
  // point (memo) — an illegal value throws its Chinese error message here
  // (exit code 1 on the CLI side); non-default combinations go into the
  // startup log (the default combination is silent, verbose shows the full
  // set); fork/forkBase are consumed by the fork pipeline, this layer only
  // parses and wires them into the existing mechanisms (fine/steer); the
  // failback granularity is consumed at the subtask boundary.
  const switches = autoSwitches()
  const dir = opts.dir ?? plan.dir
  await begin(dir, task.id)
  const mode = opts.subtask ?? "auto"
  const chain: SessionChain = { pct: 100, used: 0, at: Date.now() }
  // Strict resume (plans/0022-session-recovery-fidelity-design.md): when on,
  // records carry the unit baseline / effective model, verified on resume;
  // when fidelity cannot be guaranteed, roll back and re-run. The task-level
  // baseline is taken here (no commit between here and loop's beginUnit, so
  // the same HEAD; the path that exempts a resumed run from the clean gate
  // applies the same way) — the subtask/pipeline-stage boundaries refresh it
  // to a nearer unit baseline via runSubtask/persistStage.
  const strict = strictResumeActive(opts, switches)
  if (strict) chain.baseline = await unitBaseline(dir)
  // Interruption recovery (progress record): a session interrupted mid-way
  // and unsummarized (active) that still exists on the server → reuse the
  // original session to continue (isomorphic to `opencode -r`, context not
  // lost); a summarized record from a graceful exit, a session no longer
  // available, or --new-session explicitly giving it up → a fresh session. In
  // both cases the first prompt carries the "[DRIVER] continuing after an
  // interruption" note (with next-step guidance per phase).
  // Handover files take precedence over session reuse: when the session
  // already wrote a handover document before the interruption (ondemand/auto
  // subtask handoff.md or --handover-test's testhandoff.md), the old session's
  // context is exhausted and the document carries the progress — a fresh
  // session continues from the handover (executeWhole/runSubtask/runExecSession
  // seed the continuation from the file).
  // Strict resume: rolledBack = already rolled back to the unit baseline at
  // resume (a fresh session cold-starts the redo, no resume note attached).
  let rolledBack = false
  const recalled = await recallProgress(dir, task.id)
  if (recalled) {
    chain.phase = recalled.phase
    // Unit attribution gate (unitReruns): the interrupted session belongs to
    // one concrete execution unit (a task-level pipeline stage / subtask #N /
    // fix checklist item #N), and its session may be reused only when this
    // run will re-run that unit; otherwise (the unit already passed, a
    // config/switch change stopped it from executing, or a legacy record
    // lacking the index so attribution is undecidable) the record flips to
    // the summarized state and a fresh session starts — preventing the
    // previous unit's interrupted session from being mistakenly continued
    // once the run has entered the next unit.
    let rerun = true
    if (recalled.active === true) {
      // Checklist items come from subtasks.md, `done` is the value that
      // counts (when the state files are active, done.md's existence is the
      // progress fact and the tick is only the display track — plans/0030
      // D10).
      const fresh = await reloadTask(plan, task.id)
      const items = fresh.checklist ?? []
      rerun = unitReruns(recalled.phase, {
        mode,
        fork: switches.fork,
        items,
        subtasksFileItems: items.length,
        wrapup: opts.wrapup ?? true,
      })
      if (!rerun) {
        await saveProgress(dir, { ...recalled, active: false })
        recalled.active = false
      }
    }
    const handoffRaw =
      mode !== "off" ? await Bun.file(join(dir, taskDoc(task.id, "handoff"))).text().catch(() => undefined) : undefined
    const handedOff =
      recalled.active === true && (handoffRaw !== undefined || (opts.handoverTest === true && (await testHandoffExists(dir, task))))
    // Strict resume (plans/0022-session-recovery-fidelity-design.md 3.3): a
    // handover document present but without a valid status line (low quality)
    // → R3 fires — roll back and re-run, do not continue from the document; a
    // baseline must be on record for a rollback to be possible.
    const handoffInvalid =
      strict &&
      recalled.active === true &&
      rerun &&
      handoffRaw !== undefined &&
      handoffStatus(handoffRaw) === undefined &&
      recalled.baseline !== undefined
    // Strict resume: a legacy record without a baseline (written before the
    // switch was enabled) cannot be strictly verified; treated as not
    // reusable.
    const legacyRecord = strict && recalled.baseline === undefined
    // §8.3 (plans/0055 §8.2): the dead-session verdict under a registry — a
    // recorded session is resumed only if its agent is this run's and its
    // recorded model is usable now; otherwise it is a dead session and the
    // resume takes the existing new-session path (strict resume: the rollback
    // path). Without a registry there is no verdict (undefined).
    const dead = deadSessionWhy(opts, switches, recalled)
    // The recorded session's liveness runs on its own agent's host (§8.2:
    // the record carries it; absent = the run's start profile, the shape
    // every pre-binding record reads as), resolved through the pool when the
    // caller passed one.
    const recalledClient = await clientOf(client, opts.routing ? (recalled.agent ?? opts.routing.runAgent) : undefined)
    const alive =
      !handedOff && !opts.newSession && recalled.active && recalled.session && !legacyRecord && (await sessionAlive(recalledClient, recalled.session))
    // Inherit the interrupted session's real context usage (rebuilt from the
    // last assistant message): the seed used to be a 0/0 placeholder to
    // guarantee the first prompt always reused, at the cost of the post-resume
    // log and the chain's later reuse decisions all working off fake values;
    // first-round reuse is now guaranteed by attempt's `resumed` criterion, so
    // only the real values are taken here (for an agent without readable
    // history, the figure an /exit inside the recovery wait recorded).
    const usage = alive ? await sessionUsage(recalledClient, recalled.session!, recalled.used) : undefined
    // Belt and braces (plans/0015-session-error-retry-plan.md item 5): a
    // legacy progress.json may record a session that only ever took one error
    // and never produced real content (leftover of the old "retry means a
    // blank-slate session" logic: the whole session has not a single completed
    // assistant turn, only the error stub). With the item 3/4 fixes in place
    // such records should in theory no longer appear; this is only a backstop
    // for old files generated before that rework went live. Note the criterion
    // must not look at the last line alone: a long session that died on a
    // non-retryable error (exactly what items 3/4 deliberately preserve) also
    // ends on an error stub — the criterion lives in sessionUsage's basis
    // scan.
    const errorStub = usage !== undefined && usage.used === 0 && usage.errorStub
    // Strict verification and rollback (3.1 ③④ + 3.3): applies only to
    // records that are active, will re-run, were not handed over, and have a
    // baseline on record; after the rollback the record flips to the
    // summarized state (reusing the existing "not a resumed run" semantics —
    // pipeline cleans up the stale handover document and the next unit starts
    // from a clean baseline), a fresh session cold-starts the redo with no
    // resume note attached.
    if (handoffInvalid) {
      const done = await rollbackUnitState(dir, task, "execution unit (invalid handover document)", recalled.baseline!, { progress: recalled })
      if (done.type !== "ok") return done
      rolledBack = true
      recalled.active = false
      log(`↻ ${task.id} resume after interruption: handover document ${handoffFile(task)} exists but has no valid status line; strict resume judged unfaithful, rolled back and re-running`)
    } else if (strict && recalled.active === true && rerun && !handedOff && recalled.baseline) {
      const drift = await baselineIntact(dir, recalled.baseline)
      if (drift.length) {
        // External commits mixed in: no rollback (a rollback only reclaims
        // the driver's own changes inside the unit); the dirty outcome goes to
        // a human.
        return { type: "dirty", files: drift }
      }
      const modelNow = resumeModelNow(opts, switches, recalled.phase)
      // §10 item 11 (plans/0055): under a registry the recorded internal name
      // and agent are judged by eligibility — the recorded model must still be
      // usable now, so a window change that only moves the fresh pick does not
      // roll the unit back; without a registry the raw-string comparison is
      // unchanged.
      const modelOk =
        opts.routing !== undefined
          ? recalled.model !== undefined && resumeModelEligible(opts, switches, recalled.model, recalled.phase)
          : recalled.model !== undefined && recalled.model === modelNow
      if (dead !== undefined || !(alive && usage && !errorStub) || opts.newSession || !modelOk) {
        const why = opts.newSession
          ? "--new-session specified"
          : dead !== undefined
            ? `${dead}; the recorded session is dead`
            : !(alive && usage)
              ? "original session not reusable"
              : errorStub
                ? "original session only hit an error, no real output"
                : recalled.model === undefined
                  ? "no effective model recorded (an old record from before strict resume)"
                  : opts.routing !== undefined
                    ? `the recorded model ${recalled.model} is not usable now`
                    : `model mismatch (recorded ${recalled.model}, current ${modelNow ?? "no routing configured"})`
        const done = await rollbackUnitState(dir, task, "execution unit", recalled.baseline!, { progress: recalled })
        if (done.type !== "ok") return done
        rolledBack = true
        recalled.active = false
        log(`↻ ${task.id} resume after interruption: ${phaseText(recalled.phase)}(${why}); strict resume judged unfaithful, rolled back to the unit baseline and redone`)
      }
    }
    if (!rolledBack) {
      if (dead === undefined && alive && usage && !errorStub) {
        chain.id = recalled.session!
        chain.pct = usage.pct
        chain.used = usage.used
        // The reuse decision was made here; the chain's later 5-minute reuse
        // rule counts from this moment.
        chain.at = Date.now()
        chain.note = resumeNote(recalled.phase, true, strict)
        // Session-agent binding and the continuation's model (plans/0055 §8.2,
        // §6.2): the resumed session stays bound to the run's agent and — a
        // registry record naming its model — the first dispatch continues on
        // that model while it is still usable (selection keeps the chain's
        // entry on a continuation), instead of a fresh pick moving the live
        // session's model.
        if (opts.routing) {
          // The resumed session stays on the agent its record names (§8.3:
          // absent = the run's start profile, the pre-binding shape).
          chain.agent = recalled.agent ?? opts.routing.runAgent
          if (recalled.model !== undefined) {
            chain.modelEntry = recalled.model
            chain.model = opts.routing.registry.models.get(recalled.model)?.model
          }
        }
        log(
          `↻ ${task.id} resume after interruption: ${phaseText(recalled.phase)}, reusing the interrupted session ${recalled.session} to continue (context intact, ` +
            `${formatTokens(usage.used)} used${usage.limit ? `/${formatTokens(usage.limit)} tokens, ${usage.pct}%` : " tokens, limit unknown"})`,
        )
      } else {
        // --new-session explicitly gives up the old session: flip the record
        // to the summarized state right away, so that when this run is
        // interrupted at a sessionless stage, the next run does not mistakenly
        // reuse an old session out of step with the advanced phase.
        if (opts.newSession && recalled.active) {
          await saveProgress(dir, { ...recalled, active: false })
        }
        chain.note = resumeNote(recalled.phase, false, strict)
        const why = !rerun
          ? "the interrupted session's execution unit will not re-run this time (already done or no longer executing); its resume point is obsolete, starting a new session to continue"
          : handedOff
            ? "a handover document was written before the interruption; starting a new session to continue from the handover"
            : opts.newSession
              ? "--new-session specified; starting a new session to continue"
              : legacyRecord
                ? "the legacy record predates strict resume and has no unit baseline, so strict verification is impossible; starting a new session to continue"
                : dead !== undefined
                  ? `${dead}; the recorded session is dead, starting a new session to continue`
                  : errorStub
                    ? "the original session only hit an error with no real output; starting a new session to continue"
                    : "the original session is not reusable; starting a new session to continue"
        log(`↻ ${task.id} resume after interruption: ${phaseText(recalled.phase)}(${why})`)
      }
    }
  }
  // A strict-resume rollback may have changed the task's files on disk.
  task = await reloadTask(plan, task.id)
  // Phase persistence: every pipeline boundary advances the record
  // (active=false, summarized state); attempt refreshes it to active=true
  // (mid-way state) when the execution-chain session starts/ends — an
  // interruption at that moment reuses the session as "unsummarized".
  // Under strict resume the chain's unit baseline is refreshed in step: the
  // rollback anchor tightens along the pipeline boundaries (with
  // baseline..HEAD holding only driver commits, a nearer baseline verifies the
  // same as a farther one, and the rollback radius shrinks).
  const persistStage = async (phase: Phase) => {
    chain.phase = phase
    if (strict) chain.baseline = await unitBaseline(dir)
    if (opts.dir && task.id.startsWith("T-")) {
      await saveProgress(opts.dir, {
        task: task.id,
        session: chain.id,
        at: Date.now(),
        active: false,
        phase,
        // The session's agent rides along when a session is named (§8.2,
        // under a registry only; attempt keeps chain.agent current).
        ...(opts.routing && chain.id !== undefined && chain.agent !== undefined ? { agent: chain.agent } : {}),
      })
    }
  }
  const outcome = await pipeline(recalled?.phase)
  if (outcome.type === "completed") {
    // Terminal-state rename: the chain's last session title points at the
    // done label (same wording as the loop's terminal-state commit).
    await renameSession(await clientOf(client, chain.agent), chain, `${task.id} done ${task.title}`)
    await forgetProgress(dir)
    return outcome
  }
  // On a non-completed outcome (blocked / revert to pending) the current
  // progress is finalized (the reason is in the run log; the phase stays in
  // the progress record, and the next run builds the resume prompt from it).
  // Session-error outcomes (network retries exhausted) keep the active record
  // for resume reuse (a mid-way session cannot be summarized); every other
  // outcome clears reuse eligibility (the progress is summarized, human
  // attention may take long and change the environment, the old session's
  // context is untrustworthy), while the phase info is kept for precise
  // re-entry. The session title is renamed to the interruption state in step
  // (same wording as the loop's boundary commit).
  task = await reloadTask(plan, task.id)
  await renameSession(await clientOf(client, chain.agent), chain, `${task.id} ${outcome.type === "incomplete" ? "pending" : "blocked"} ${task.title}`)
  if (!(outcome.type === "blocked" && outcome.question.startsWith("session error: "))) {
    await persistStage(chain.phase ?? (mode === "auto" ? { kind: "decompose" } : { kind: "whole" }))
  }
  return outcome

  // Task pipeline (a closure holding client/plan/task/opts/chain): resume is
  // the stage marker from the recovery record, used for precise re-entry.
  async function pipeline(resume?: Phase): Promise<Outcome> {
    // On-site restoration of handover documents (test-handover interruption
    // recovery F3): must be unconditional and earlier than any execution
    // unit's clean gate — the previous run's stale cleanup may have deleted an
    // in-flight handover document already recorded in a commit; that deletion
    // is itself a dirty area, and the gate would block on the spot. Restoring
    // it clears the dirt.
    if (opts.testByDriver) await restoreTestHandoffs(dir, task)
    // Precise phase re-entry: the record shows the pipeline advanced to
    // wrap-up or beyond → off/ondemand skip the execution phase (the
    // whole-task session is not re-run; auto's decompose/subtask loops are
    // idempotent anyway, no special case needed).
    const resumed = resume?.kind
    // Fork base (fork-decompose design §4.2): established only in auto mode
    // with fork=on; the digest mode's persistent base (.auto/units.json's
    // forkBase, `digest:` prefix) is reused while alive and rebuilt from
    // context.md only once invalid; session mode reuses/verifies the fork-base
    // field; on failure it degrades along the fallback chain (digest →
    // session → cold start); undefined = cold start.
    // Under a registry the resolution waits for the subtask loop below: the
    // base is per agent (plans/0055 §8.4), so each subtask resolves the base
    // of the agent its chain currently runs on instead of one base serving
    // every subtask of the run.
    let fork: ForkBaseInfo | undefined
    if (mode === "auto") {
      const sw = autoSwitches()
      // Merged understand + decompose session (M1.0, plans/0030): entered
      // when subtasks.md has no checklist items (tasks that already have
      // items — hand-written or left over from an earlier decomposition — are
      // skipped); one session produces context.md + shared.md + subtasks.md +
      // each subtask's todo.md; when subtasks.md already has items
      // (interruption recovery / old-version leftovers) they are injected
      // directly, idempotently. After the session succeeds the driver records
      // the fork-base (in session mode that is the final base; in digest mode
      // the base-confirmation session overwrites it afterwards).
      await persistStage({ kind: "decompose" })
      const decomposed = await ensureDecomposed(client, plan, task, opts, chain)
      if (decomposed.type !== "ok") return decomposed
      task = decomposed.task
      // ①′ (digest) / base verification (session) — every subtask afterwards
      // forks from the same base (with fork=off, fork stays undefined, zero
      // behavioral difference from the status quo). Without a
      // registry this single resolution after decompose is the unchanged
      // one-agent era behavior (C2); under a registry it is the subtask
      // loop's job (see the comment at `let fork`), so nothing resolves
      // here.
      fork = sw.fork && !opts.routing ? await ensureForkBase(client, plan, task, opts, chain, sw) : undefined
      // Stale cleanup of subtask handover documents (mirrors the ondemand
      // semantics): a non-resumed run clears the previous attempt's
      // leftovers; a resumed run (active record) keeps them for the subtask
      // session to continue from the handover. Only the copy git does not
      // track is deleted (same as F4): a tracked handoff.md necessarily
      // belongs to an execution unit that has not closed out (when the unit
      // closes out, the deletion is recorded with the commit and it vanishes
      // from disk and HEAD together; checklist items run in order, so an
      // unclosed unit is necessarily the first unticked item) — keep it for
      // the re-running subtask to continue from the handover; deleting it
      // unconditionally would only create a dirty area, stop the next unit's
      // clean gate and loop "human recovery → delete again → block again"
      // (the same kind of incident as T-028).
      if (recalled?.active !== true) {
        await removeIfUntracked(dir, handoffFile(task))
        // Same for --handover-test's test handover documents (task-level and
        // subtask-level cleared together): runExecSession's handover loop
        // closes within one runTask call, so leftovers across calls are stale
        // state; auto mode never enters the whole-task branch, so the cleanup
        // must be covered here — otherwise the next subtask misreads a stale
        // handover and continues from it.
        if (opts.testByDriver) await cleanTestHandoffs(dir, task)
      }
    } else if (resumed !== "wrapup" && resumed !== "closeout") {
      // Only a non-resumed run clears the previous attempt's leftover
      // handover document; on resume it is kept (it holds the interrupted
      // session's progress summary, and executeWhole decides whether to
      // continue from its `Status:` line). Again only the copy git does not
      // track is deleted (same reason as the auto branch: a tracked one is
      // the in-flight state of an unclosed unit, and deleting it is itself a
      // dirty area).
      if (mode === "ondemand" && recalled?.active !== true) {
        await removeIfUntracked(dir, handoffFile(task))
      }
      // Same for --handover-test's test handover documents: a non-resumed run
      // clears the previous attempt's leftovers (task-level and subtask-level
      // cleared together; a resumed run (active record) keeps them for the
      // continuing session to consume).
      if (opts.testByDriver && recalled?.active !== true) {
        await cleanTestHandoffs(dir, task)
      }
      await persistStage({ kind: "whole" })
      const blocked = await executeWhole(client, plan, task, opts, chain, mode === "ondemand")
      if (blocked) return blocked
      task = await reloadTask(plan, task.id)
    }

    // closeout resume: the wrap-up already finished before the interruption
    // (or the record is a legacy verify/review one, which only ever followed
    // wrap-up) — only the result check and completion remain.
    if (resume?.kind !== "closeout") {
      await persistStage({ kind: "subtasks" })
      // In auto mode this is where the decomposed checklist items run;
      // off/ondemand modes only have the items hand-written in subtasks.md.
      for (;;) {
        const items = task.checklist ?? []
        // Subtask-directory state protocol (M1.0, plans/0030): when the
        // protocol is active (any todo/done file exists), done.md's existence
        // overrides the tick as the progress fact (a `done` in items is the
        // value that counts); an illegal state (both present / both missing)
        // blocks for a human as soon as detected.
        const scan = await scanSubtaskStates(dir, task.id, items.length)
        if (scan.illegal.length) {
          return {
            type: "blocked",
            question:
              `${task.id} subtask state files are illegal (${scan.illegal
                .map((v) => {
                  // State-file names come from the spec data (M1.4): the
                  // message follows the protocol declaration, not literals.
                  const spec = subtaskStateSpec(task.id, v.index)
                  const pending = basename(spec.pending.path)
                  const complete = basename(spec.complete.path)
                  return `S${String(v.index).padStart(2, "0")}: ${v.kind === "both" ? `both ${pending} and ${complete} exist` : `neither ${pending} nor ${complete} exists`}`
                })
                .join("; ")}). Resolve the docs/${task.id}/S<nn>/ state files manually and re-run.`,
          }
        }
        // Dependency order (M3.5, plans/0047 G5): the next ready subtask by the
        // `Depends:` fields of the S<nn>/todo.md files (none = the first
        // unticked item); a bad graph blocks for a human fix.
        const graph = checklistProblems(items)
        if (graph.length) {
          return {
            type: "blocked",
            question: `${task.id} subtask dependencies are invalid (${graph.join("; ")}). Fix the \`Depends:\` lines in docs/${task.id}/S<nn>/todo.md manually and re-run.`,
          }
        }
        const index = nextChecklistIndex(items)
        if (index === -1) break
        // The progress record tags the owning subtask (1-based index):
        // written with the record as soon as attempt dispatches
        // successfully; on resume, the unit attribution gate (unitReruns)
        // reuses its session only when that subtask will re-run.
        const loopPhase: Phase = { kind: "subtasks" }
        chain.phase = { ...loopPhase, index: index + 1 }
        // Resumed-run determination (the active record belongs exactly to
        // this checklist item): the worktree's dirty areas at the
        // interruption scene are this unit's own progress, and runSubtask's
        // startup clean gate is exempt accordingly
        // (plans/0021-commit-boundary-design.md).
        const recalledPhase = recalled?.active === true ? recalled.phase : undefined
        const resumeUnit = recalledPhase?.kind === "subtasks" && recalledPhase.index === index + 1
        // Per-agent fork base (plans/0055 §8.4): each subtask resolves the
        // base of the agent its chain currently runs on — reusing it while
        // alive, building it lazily on the first subtask that forks on that
        // agent (the subtask route's pick lands the build on the agent the
        // subtask itself will dispatch on), and leaving the other agents'
        // entries untouched. A subtask that moved to another agent forks from
        // that agent's base, building it on first use. The reload at the loop
        // tail keeps the record fresh; without a registry the one base
        // resolved after decompose serves every subtask, exactly as before
        // (C2).
        if (opts.routing && switches.fork) fork = await ensureForkBase(client, plan, task, opts, chain, switches)
        const blocked = await runSubtask(client, plan, task, items[index].text, index + 1, opts, chain, fork, resumeUnit)
        if (blocked) return blocked
        // The post-tick mirror refresh already happened inside runSubtask
        // before the unified commit; here the task is only re-read.
        task = await reloadTask(plan, task.id)
        // The subtask has closed out (tick + unified commit): the progress
        // record refreshes to the summarized state (active=false, index
        // stripped) — an interruption during a subtask gap (step-mode pause /
        // failback handling) no longer leaves the previous unit's session
        // "mid-way unsummarized", so on resume the next unit does not
        // mistakenly continue it.
        await persistStage(loopPhase)
        // Step-mode pause (subtask boundary, OPENCODE_AUTO_STEP=subtask): a
        // hard pause after the checklist item's tick and unified commit are
        // done, before the next item.
        // dir is passed so the pause wait is deducted from the time stats
        // (STATS_PLAN §3).
        await stepPause("subtask", `${task.id} subtask ${index + 1}`, { interactive: opts.interactive, dir })
        maybeExit("subtask", `${task.id} subtask ${index + 1}`)
        // Hibernate window (subtask boundary, OPENCODE_AUTO_HIBERNATE): a safe
        // spot to check after check-off + unified commit; sleep until wake
        // inside the window before continuing (plans/0027-hibernate-design.md).
        await hibernatePause(`${task.id} subtask ${index + 1} boundary`, { dir })
        // failback retry (OPENCODE_AUTO_MODEL_FALLBACK_SCOPE): at
        // subtask/session granularity the subtask boundary clears the chain's
        // failover candidates and the next subtask fails back to the
        // preferred model (task granularity is naturally covered by the chain
        // being destroyed per task); /failback requests are consumed at the
        // same point (and may redefine the model order wholesale). Registry routing
        // (plans/0055 §6.4): the same boundary clears the down marks the scope
        // covers, and the chain's selected entry with the raw candidate.
        if (failbackApplies(switches.modelFailbackScope, "subtask")) {
          chain.model = undefined
          chain.modelEntry = undefined
          chain.modelStep = 0
        }
        clearDownMarks("subtask", switches.modelFailbackScope)
        consumeFailback(chain)
      }
      // Wrap-up session: skipped entirely when config.wrapup=false
      // (--no-wrapup, default true). The report.md existence + shape-check
      // gates live inside runWrapup (session-boundary-hardening §4.5 D5, S3b).
      if (opts.wrapup ?? true) {
        await persistStage({ kind: "wrapup" })
        const stopped = await runWrapup(client, plan, task, opts, chain, { solo: mode !== "auto", label: "wrapup session" })
        if (stopped) return stopped
      }
    }
    // Result line of the task report (FAIL stops the run): the report and the
    // work are already committed by the wrap-up session, so a FAIL only has
    // to block — the loop's blocked path marks it blocked and commits the
    // interruption scene. A person then decides: `close` accepts the result
    // (the Closed: field records why); `plan --force-close … --append -p`
    // replaces the task with a better one; listing fix tasks before it in
    // tasks.md gets the gap fixed first (a hand-added checklist item is
    // illegal subtask state in auto mode, so fixes are planned as tasks).
    // The phase is rewound to wrapup, so re-running the task itself only
    // re-runs the wrap-up, which rewrites the result line. No report or no
    // result line = no stop.
    await persistStage({ kind: "closeout" })
    const result = await reportResult(dir, task)
    if (result?.type === "fail") {
      // Per-model protocol-drift counter (plans/0055 §10 item 3): the FAIL
      // verdict was written by the wrap-up session, whose selected entry the
      // chain still holds. Undefined without a registry; the counter then
      // books nothing (C2).
      await statsModelEvent(dir, chain.modelEntry, "fail")
      const { bin } = shellProfile()
      chain.phase = { kind: "wrapup" }
      return {
        type: "blocked",
        question:
          `the task report concluded Result: FAIL${result.reason ? ` (${result.reason})` : ""}. The report and the work are committed; ` +
          `accept the result with ${bin} close ${task.id} --reason <text>; ` +
          `or replace the task with ${bin} plan --force-close ${task.id} --reason <text> --append -p <what to do instead>; ` +
          `or list fix tasks before it in ${plan.index} by hand; then re-run.`,
      }
    }
    await markDone(plan, task.id)
    return { type: "completed" }
  }
}

// --dryrun's single standalone session: belongs to no task, enters no chain,
// and makes no post-session commit (the preflight changes nothing in the
// worktree).
export async function runOnce(
  client: ClientSource,
  title: string,
  promptText: string,
  opts: Opts,
): Promise<SessionResult> {
  return runSession(client, pseudoTask("AUTO", title), promptText, opts, { pct: 100, used: 0, at: 0 })
}

function pseudoTask(id: string, title: string): Task {
  return { id, title, status: "in_progress", attempts: 0, body: "" }
}
