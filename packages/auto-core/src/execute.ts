// The task execution stage: executeWhole (off/ondemand whole-task sessions) +
// the merged understand+decompose unit (ensureDecomposed; since M1.0
// understand+decompose is one single session, plans/0030) + runSubtask, one
// subtask session (with the subtask-directory state protocol todo.md→done.md).
// Sits above exec-session/session and below runner; **must not import
// runner** (§D.2).
// Split out of src/runner.ts (plans/0024-module-split-plan.md S12, pure move).

import { rm } from "node:fs/promises"
import { join } from "node:path"
import type { ForkBaseInfo, SessionChain } from "./chain"
import { docShapeProblems, EOF_MARK, shapeCheckOn } from "./doccheck"
import { taskDoc } from "./docpaths"
import { processReferenceScan } from "./document/process-refs"
import { eofScanExempt, handoffStatus } from "./document/roles"
import { checkArtifactSpecs, declaredArtifacts, decomposeArtifactSpecs, subtaskStateSpec } from "./document/spec"
import { checklistProblems, renameTodoToDone } from "./document/state"
import { runExecSession } from "./exec-session"
import { beginUnit, unitAddedLines, unitBaseline, unitChangedFiles, unitQuiet, untrackedFiles, type UnitBaseline } from "./git"
import { autobanner, log, subbanner } from "./log"
import { DEFAULT_CONTEXT_LIMIT, type ClientSource, type Opts, type UnitStop } from "./opts"
import { readChecklist, reloadTask, setForkBase, subtasks, tickSubtask, type Plan, type Task } from "./tasks"
import { handoffFile, renderDecompose, renderSubtask, renderWhole, testHandoffFile } from "./prompt"
import { peekProgress } from "./resume"
import { runSession } from "./session"
import { clientOf, formatTokens, forkEndedSession, seedForkSession } from "./session-api"
import { statsModelEvent } from "./stats"
import { autoSwitches } from "./switches"
import { handoffSteer, removeHandoffChain } from "./testrun"
import { sessionHandoverDue } from "./usage"
import { afterSession, commitBlocked, rollbackUnitState, strictResumeActive } from "./unit-commit"

// The execution stage for off/ondemand: off finishes the whole task in one
// session; ondemand, when a live session's context reaches 2x --context-limit,
// the driver steers in the handover hint, the session writes a handover
// document and a new session continues from it, until a natural finish or the
// handover document marks completion. Returns undefined = execution stage done.
// A handover document left over from the previous attempt is cleaned up by the
// caller (the pipeline) after its recovery determination.
export async function executeWhole(
  client: ClientSource,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
  ondemand: boolean,
): Promise<UnitStop | undefined> {
  const cap = opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT
  const dir = opts.dir ?? plan.dir
  const strict = strictResumeActive(opts)
  const planDir = plan.dir
  const readHandoff = async (): Promise<string> => Bun.file(join(planDir, taskDoc(task.id, "handoff"))).text().catch(() => "")
  // With steer=off (OPENCODE_AUTO_STEER) no handover hint is built, and the
  // post-session handover check is disabled with it (see usage.ts
  // sessionHandoverDue); off mode never builds one anyway.
  const steer = ondemand ? handoffSteer(autoSwitches().steer, cap, task) : undefined
  const subject = `${task.id} exec ${task.title}`
  chain.subject = subject
  // Interruption-recovery seeding: a stale handover document is cleared by the
  // pipeline on the non-recovery path, so the file still existing here means an
  // active recovery — handed over before the interruption. Status=done → the
  // execution stage already finished; skip the whole-task session.
  // Status=continue → open a new session on the continuation prompt to continue
  // from the handover (reusing the old session would only hit the cap again at
  // once).
  const prior = ondemand ? handoffStatus(await readHandoff()) : undefined
  if (prior === "done") {
    log(`↻ ${task.id} resume after interruption: handover document ${handoffFile(task)} marks execution complete; skipping the whole-task session`)
    return undefined
  }
  let continuation = prior === "continue"
  if (continuation) log(`↻ ${task.id} resume after interruption: handed over as ${handoffFile(task)} before the interruption; the new session continues from the handover document`)
  let feedback = ""
  let retried = false
  // Strict-resume rollback redo (tightened in 3.3 R3): one invalid handover
  // document (including a test-handover write-check failure) rolls back to the
  // unit baseline and cold-starts a redo of the unit, with no retry with
  // feedback; once only — failing again is escalated as a hidden blockage (the
  // working state is already preserved in the stash).
  let rolled = false
  const rollbackRedo = async (): Promise<UnitStop | "done" | undefined> => {
    if (!strict || !chain.baseline) return undefined
    const done = await rollbackUnitState(dir, task, "execution session", chain.baseline, { progress: await peekProgress(dir) })
    if (done.type !== "ok") return done
    continuation = false
    feedback = ""
    retried = false
    chain.id = undefined
    chain.pending = undefined
    chain.note = undefined
    chain.pct = 100
    chain.used = 0
    chain.at = 0
    // The redo is a new prompt under registry routing too (the marks keep
    // their scope-cleared meaning; the chain's entry does not carry over).
    if (opts.routing) {
      chain.model = undefined
      chain.modelEntry = undefined
      chain.modelStep = 0
    }
    return "done"
  }
  for (;;) {
    const result = await runExecSession(
      client,
      plan,
      task,
      renderWhole(plan, task, { mode: opts.mode, ondemand, continuation }) + feedback,
      opts,
      chain,
      steer,
    )
    if (result.type === "blocked") {
      // Test-handover write-check failure (strict resume): roll back and
      // cold-start the redo, once only.
      if (result.rollback && !rolled) {
        const redone = await rollbackRedo()
        if (redone === "done") {
          rolled = true
          continue
        }
        if (redone) return redone
      }
      return result
    }
    // The task-level test-handover chain is cleared whole when the execution
    // scope closes (same rule as runSubtask's subtask close-out): the archived
    // copy must be deleted even though committed — kept around for the next
    // execution in the same scope (the task reverted and re-run), the recovery
    // state machine would misjudge it as an in-flight handover already closed
    // out (no record + archived copy committed = H3). The deletion lands with
    // the unified commit below.
    if (opts.testByDriver) {
      await removeHandoffChain(planDir, taskDoc(task.id, "testhandoff"))
    }
    const committed = await afterSession(dir, opts, task, { stage: "execute", subject })
    if (committed.type === "failed") return commitBlocked(`${task.id} execution session`, committed)
    // Ending without hitting the handover threshold (2x cap) = the task
    // finished naturally in a single session; when no steer was built (off
    // mode or OPENCODE_AUTO_STEER=off) it likewise ends naturally, with no
    // handover check.
    if (!sessionHandoverDue((await clientOf(client, chain.agent)).capabilities.usage, steer, chain.used, chain.hinted)) return undefined
    const status = handoffStatus(await readHandoff())
    if (status === "done") return undefined
    if (status === "continue") {
      log(`↻ ${task.id} context reached the ${formatTokens(cap * 2)} cap; handed over as ${handoffFile(task)}, continuing in a new session`)
      continuation = true
      feedback = ""
      continue
    }
    // Handover-boundary write-check failure (strict resume): one invalid
    // attempt rolls back and cold-starts the redo.
    if (!rolled) {
      const redone = await rollbackRedo()
      if (redone === "done") {
        rolled = true
        log(`↻ ${task.id} context cap reached but no valid handover document ${handoffFile(task)} was produced; strict resume already rolled back; cold-starting this task`)
        continue
      }
      if (redone) return redone
    }
    if (retried) {
      return {
        type: "blocked",
        question:
          `session hit the context cap but failed twice to produce a valid handover document ${handoffFile(task)} (missing, or lacking a status line; hidden blockage). ` +
          `Check the file and re-run. Last agent output:\n${result.lastText.trim().slice(-2000) || "(no output)"}`,
      }
    }
    log(`↻ ${task.id} context cap reached but ${handoffFile(task)} was not produced; retrying once with feedback`)
    retried = true
    feedback =
      `\n\nThe last time you ended the session the context had reached its limit, but no valid ${handoffFile(task)} was written (missing, or lacking the \`Status: continue|done\` status line — a driver protocol string, write it verbatim). ` +
      `This is a hard requirement: write that file before ending the session.`
  }
}

// Merged understand+decompose unit (M1.0, plans/0030-subtask-loop-entry-design.md):
// one session produces the task background digest (docs/<id>/context.md, four
// sections), the shared-context reference index (docs/<id>/shared.md), the
// subtask checklist (docs/<id>/subtasks.md, the task's subtask index read by
// the driver) and one scope file per subtask (docs/<id>/S<nn>/todo.md).
// All four artifact groups are hard requirements (existence + non-trivial +
// terminal eof line), feeding one retry-with-feedback loop (re-prompt via
// forkEndedSession of the just-ended session); still failing → blocked.
// On success the session id is recorded as the session-mode fork base (digest
// mode overwrites it in ensureForkBase afterwards) and everything lands in the
// "decompose" unit commit.
// Interruption recovery / compatibility read: when subtasks.md already has
// checklist items (files written by a previous decomposition, a hand-written
// checklist, or legacy decomposition output) they are used as-is with no new
// session — a checklist without todo.md state files keeps its tick semantics
// (the protocol is not active, plans/0030 D5).
export async function ensureDecomposed(
  client: ClientSource,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
): Promise<({ type: "ok" } & { task: Task }) | UnitStop> {
  if (task.checklist?.length) return { type: "ok", task }
  const dir = plan.dir
  const contextFile = join(dir, taskDoc(task.id, "context"))
  const sharedFile = join(dir, taskDoc(task.id, "shared"))
  const subtasksFile = join(dir, taskDoc(task.id, "subtasks"))
  const readDoc = async (role: "context" | "subtasks"): Promise<string> =>
    (await Bun.file(join(dir, taskDoc(task.id, role))).text().catch(() => "")).trim()
  const readRaw = async (): Promise<string> => readDoc("subtasks")
  const existing = subtasks(await readRaw())
  if (existing.length) {
    log(`↻ ${task.id} decomposition result ${subtasksFile} already exists; using its checklist directly`)
    return { type: "ok", task: await reloadTask(plan, task.id) }
  }
  let feedback = ""
  // One automatic retry with feedback: a resumed session may have done the
  // work instead of writing the files; the files are a hard requirement.
  autobanner(`${task.id} ${task.title}: task understanding + decomposition`)
  const subject = `${task.id} decompose ${task.title}`
  chain.subject = subject
  // When a shape-check / missing-artifact re-prompt is dispatched through a
  // fork of the just-ended session (revised 2026-09-18), the next round carries
  // the feedback alone — the copy already holds the full prompt and all the
  // working context, and resending the whole thing would only induce starting
  // over from scratch.
  let shapeForked = false
  for (let i = 0; ; i++) {
    // fine (OPENCODE_AUTO_DECOMPOSE_FINE=on) passes through into the decompose
    // prompt: injects the fine-grained criteria section
    // (plans/0003-fork-decompose-design.md §5.1); taskContext
    // (OPENCODE_AUTO_TASK_CONTEXT) passes through the suggested-line-count
    // wording of context.md.
    const brief = shapeForked
    shapeForked = false
    const result = await runSession(
      client,
      task,
      brief
        ? feedback.trimStart()
        : renderDecompose(plan, task, { ...opts, fine: autoSwitches().fine, taskContext: autoSwitches().taskContext }) + feedback,
      opts,
      chain,
    )
    if (result.type === "blocked") return result
    // Artifact checks (all hard): context.md/shared.md non-empty + shape
    // check; subtasks.md has checklist items + shape check; every subtask
    // directory's todo.md exists + shape check. Only this session's output is
    // checked — the "file already exists, inject directly" path above is
    // unaffected (existing files are not re-audited).
    const problems = await decomposeArtifactProblems(dir, task.id)
    if (!problems.length) {
      // The merged session is the session-mode fork base; digest mode
      // overwrites it in ensureForkBase afterwards.
      // Under a registry the record is the per-agent map (plans/0055 §8.2):
      // the merged session lives on the agent its dispatch picked, so its id
      // is stored under that agent's key and another agent's chain reads no
      // base of its own from it.
      if (chain.id) await setForkBase(dir, task.id, chain.id, opts.routing ? chain.agent : undefined)
      const fresh = await reloadTask(plan, task.id)
      const committed = await afterSession(opts.dir ?? dir, opts, task, { stage: "decompose", subject })
      if (committed.type === "failed") return commitBlocked(`${task.id} decompose session`, committed)
      return { type: "ok", task: fresh }
    }
    if (i === 1) {
      return {
        type: "blocked",
        question:
          `decompose session ended twice but its artifacts did not pass checks (${problems.join("; ")}; hidden blockage). ` +
          `Check the files and re-run. Last agent output:\n${result.lastText.trim().slice(-2000) || "(no output)"}`,
      }
    }
    feedback =
      `\n\nThe last time you ended the session, the merged understanding+decomposition artifacts did not pass checks: ${problems.join("; ")}. This is a hard requirement: ` +
      `complete ${contextFile} (the four-section understanding digest), ${sharedFile} (the shared-context reference index), ${subtasksFile} (the checklist) and every subtask's todo.md, ` +
      `and end the session only once the content is complete and closed with \`${EOF_MARK}\` alone on the last line of body text.`
    // The re-prompt continues from a fork of the session that just ended (carrying
    // all its research context); when fork is unavailable it falls back to a
    // brand-new session plus the full prompt.
    shapeForked = await forkEndedSession(client, chain, subject)
    // Per-model protocol-drift counter (plans/0055 §10 item 3): the shape-check
    // re-prompt books on the model of the session that just failed the check
    // (the chain's selected entry); undefined without a registry (C2).
    await statsModelEvent(opts.dir ?? dir, chain.modelEntry, "reprompt")
    log(`↻ ${task.id} decompose session artifacts failed checks (${problems.join("; ")}); ${shapeForked ? "forked from the original session, " : ""}retrying once with feedback`)
  }
}

// Artifact problem list of the merged understand+decompose session (empty =
// pass; spec-driven since M1.4): the four artifact groups (context.md /
// shared.md / subtasks.md / per-subtask todo.md) are declared as a spec table
// (document/spec.ts decomposeArtifactSpecs) and the mechanical checks
// (non-empty + shape + the todo.md protocol section anchors) all run through
// the generic checker — no per-document logic here. Checklist parseability
// stays a driver-side check (it is the driver's own injection input,
// plans/0034 D9): reported when the file has content but no parseable items.
// Problem lines carry concrete paths and feed the retry feedback verbatim.
async function decomposeArtifactProblems(dir: string, taskId: string): Promise<string[]> {
  const raw = (await Bun.file(join(dir, taskDoc(taskId, "subtasks"))).text().catch(() => "")).trim()
  const items = subtasks(raw)
  const { problems } = await checkArtifactSpecs(decomposeArtifactSpecs(taskId, items.length), { dir, policy: "mandatory" })
  if (raw && !items.length) problems.push(`${taskDoc(taskId, "subtasks")} has no checklist items`)
  // Subtask dependency graph (M3.5, plans/0047 G6): the `Depends:` / `Touches:`
  // fields at the top of the S<nn>/todo.md files, S<nn> = checklist item n.
  if (items.length) {
    for (const problem of checklistProblems(await readChecklist(dir, taskId))) problems.push(`docs/${taskId}/S<nn>/todo.md: ${problem}`)
  }
  return problems
}

// Runs one subtask session, then ticks the checklist item on trust: the
// session self-checks its own work; the whole task is accounted for by the
// wrap-up report and its result line.
// handoff-steer applies to subtask sessions too (same mechanism as the
// ondemand whole-task session, sharing docs/<id>/handoff.md): when a live
// session's used context reaches 2x --context-limit the driver steers in the
// handover hint, the session writes the handover document (last line
// `Status: continue|done`, counted by whether this subtask is done), then a
// new session continues from the handover, until a natural finish or the
// handover document marks completion; once the subtask is done the handover
// document is cleared and the next subtask starts counting anew. Experiment
// switch OPENCODE_AUTO_STEER=off disables the mechanism (no handover hint
// injected, no post-session handover check; a natural finish ends it).
export async function runSubtask(
  client: ClientSource,
  plan: Plan,
  task: Task,
  text: string,
  index: number,
  opts: Opts,
  chain: SessionChain,
  base?: ForkBaseInfo,
  // Resumed continuation of this subtask (the active progress record belongs
  // to this unit): exempt from the startup clean gate — the worktree's dirty
  // area is this unit's own progress (handover document included), committed
  // together at close-out (plans/0021-commit-boundary-design.md).
  resumeUnit = false,
): Promise<UnitStop | undefined> {
  subbanner(`${task.id} subtask ${index}: ${text.length > 50 ? `${text.slice(0, 50)}…` : text}`)
  const subject = `${task.id} S${index} ${text}`
  chain.subject = subject
  // Registry routing (plans/0055 §6.2): a new subtask is a new prompt — its
  // first dispatch selects from the list instead of continuing the task's
  // current entry (a failover within the task persists through the down
  // marks, which survive subtask boundaries under the task scope, so a
  // spent quota still skips its model; a window that reopened returns to
  // the primary, as a new prompt should). Without a registry the chain's
  // candidate keeps its exact task-scoped meaning.
  if (opts.routing) {
    chain.model = undefined
    chain.modelEntry = undefined
    chain.modelStep = 0
  }
  const dir = opts.dir ?? plan.dir
  // Subtask unit commit boundary: startup clean gate + SHA baseline (close-out
  // verifies the commit range is all driver commits); driver-exclusive
  // state-file leftovers self-heal through the carryover inside beginUnit. The
  // baseline also goes onto the chain (strict resume: carried by the active
  // record, the rollback anchor).
  let baseline: UnitBaseline | undefined
  if (resumeUnit) {
    if (opts.commit !== false && !opts.dryrun) baseline = await unitBaseline(dir)
  } else {
    const gate = await beginUnit(dir, opts, task)
    if (gate.type === "dirty") return { type: "dirty", files: gate.files }
    baseline = gate.baseline
  }
  chain.baseline = baseline
  const strict = strictResumeActive(opts)
  const cap = opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT
  // With steer=off (OPENCODE_AUTO_STEER) no handover hint is built, and the
  // post-session handover check is disabled with it (see usage.ts
  // sessionHandoverDue); --handover-test's test handover is a separate
  // mechanism and is unaffected.
  const steer = handoffSteer(autoSwitches().steer, cap, task)
  const planDir = plan.dir
  const readHandoff = async (): Promise<string> => Bun.file(join(planDir, taskDoc(task.id, "handoff"))).text().catch(() => "")
  // Subtask-directory state protocol (M1.0, plans/0030 D8): done.md already
  // existing = this subtask already closed out (including the recovery board
  // where the interruption landed exactly between the rename and the unified
  // commit) — skip the session and go straight to close-out (tick + commit).
  // File existence is the progress fact, not session narrative. State-file
  // paths come from the spec data (document/spec.ts subtaskStateSpec, M1.4).
  const stateSpec = subtaskStateSpec(task.id, index)
  const stateDone = await Bun.file(join(planDir, stateSpec.complete.path)).exists()
  // Interruption-recovery seeding: a stale handover document is cleared by the
  // pipeline on the non-recovery path, so the file still existing here with
  // status=done → the subtask was already finished by a handover session
  // before the interruption; tick it directly. Status=continue → open a new
  // session on the continuation prompt to continue from the handover (reusing
  // the old session would only hit the cap again at once).
  const prior = stateDone ? undefined : handoffStatus(await readHandoff())
  if (stateDone) {
    log(`↻ ${task.id} subtask ${index}: ${stateSpec.complete.path} already exists; skipping the session and closing out directly`)
  } else if (prior === "done") {
    log(`↻ ${task.id} resume after interruption: handover document ${handoffFile(task)} marks the subtask complete; checking it off directly`)
  } else {
    let continuation = prior === "continue"
    if (continuation) log(`↻ ${task.id} resume after interruption: handed over as ${handoffFile(task)} before the interruption; the new session continues the subtask from the handover document`)
    // ③ A subtask's first session forks from the fork base (the same fork
    // point as the decompose session — fork first, render after, which the
    // warm/cold background section chooses by); no reuse across subtasks
    // (enforced by the seed chain), while handover continuation and
    // retry-with-feedback keep the chain's existing mechanisms. No base /
    // fork failure → brand-new session + cold-start prompt (reads context.md).
    let warm = await seedForkSession(client, opts, chain, base, subject)
    let feedback = ""
    let retried = false
    // Re-prompt count for the artifact shape check (D2): counted separately
    // from the handover-document feedback's retried — each of the two loops is
    // limited to one, neither eating into the other's retry budget.
    let shapeRetried = false
    // When a shape-check re-prompt is dispatched through a fork of the
    // just-ended session (revised 2026-09-18), the next round carries the
    // feedback alone — the copy already holds the full prompt and all the
    // working context, and resending the whole thing would only induce
    // starting over from scratch.
    let shapeForked = false
    // Strict-resume rollback redo (tightened in 3.3 R3): one invalid handover
    // document (including a test-handover write-check failure) rolls back to
    // the subtask baseline and cold-starts a redo, with no retry with
    // feedback; once only — failing again is escalated as a hidden blockage
    // (the working state is already preserved in the stash).
    let rolled = false
    const rollbackRedo = async (): Promise<UnitStop | "done" | undefined> => {
      if (!strict || !baseline) return undefined
      const done = await rollbackUnitState(dir, task, `subtask ${index}`, baseline, { progress: await peekProgress(dir) })
      if (done.type !== "ok") return done
      continuation = false
      feedback = ""
      retried = false
      chain.id = undefined
      chain.pending = undefined
      chain.note = undefined
      chain.pct = 100
      chain.used = 0
      chain.at = 0
      // The redo is a new prompt under registry routing too.
      if (opts.routing) {
        chain.model = undefined
        chain.modelEntry = undefined
        chain.modelStep = 0
      }
      // The cold-start redo forks from the base again (the same shape as the
      // subtask's first session, recovering the warm prefix).
      warm = await seedForkSession(client, opts, chain, base, subject)
      return "done"
    }
    for (;;) {
      const brief = shapeForked
      shapeForked = false
      const result = await runExecSession(
        client,
        plan,
        task,
        brief ? feedback.trimStart() : renderSubtask(plan, task, text, { ...opts, continuation, index, warm }) + feedback,
        opts,
        chain,
        steer,
        index,
      )
      if (result.type === "blocked") {
        // Test-handover write-check failure (strict resume): roll back and
        // cold-start the redo, once only.
        if (result.rollback && !rolled) {
          const redone = await rollbackRedo()
          if (redone === "done") {
            rolled = true
            continue
          }
          if (redone) return redone
        }
        return result
      }
      // Ending without hitting the handover threshold (2x cap) = the subtask
      // session finished naturally. Completion is never judged by agent
      // self-report: the artifact shape check runs first (D2/D4/D6,
      // session-boundary-hardening §4.3/§4.6) — zero-write / missing declared
      // artifacts / document truncation (including the whole-change scan); any
      // hit means no tick and no advance (the verdict-layer gap of the T-068
      // S01 incident), one re-prompt with feedback, still failing → blocked
      // for a human. Not enabled under dryrun / commit gate off / non-git; a
      // session ending in a test handover is exempt (its completion criterion
      // is in testhandoff.md). With steer=off no handover hint is built — a
      // natural finish ends it and no handover document is demanded;
      // otherwise a session that ended naturally but over the usage cap would
      // be wrongly demanded to write a handover document after the fact. An
      // over-cap ending is left to the provider-side compression / cap errors,
      // which go through the existing "session error" path (retry in a new
      // session); disk progress and the unified commit are unaffected.
      if (!sessionHandoverDue((await clientOf(client, chain.agent)).capabilities.usage, steer, chain.used, chain.hinted)) {
        if (baseline && shapeCheckOn(opts, baseline, Boolean(result.testHandover))) {
          const problems = await subtaskArtifactProblems(dir, text, baseline)
          if (problems.length) {
            if (shapeRetried) {
              return {
                type: "blocked",
                question:
                  `subtask session ended naturally but the artifact shape check failed (hidden blockage): ${problems.join("; ")}. ` +
                  `Check the artifacts and re-run. Last agent output:\n${result.lastText.trim().slice(-2000) || "(no output)"}`,
              }
            }
            shapeRetried = true
            feedback = shapeFeedback(task, index, problems)
            // The re-prompt continues from a fork of the just-ended session
            // (revised 2026-09-18): the copy carries all of that session's
            // working context, and the next round dispatches the feedback
            // alone; when fork is unavailable (the session is already gone) it
            // falls back to a brand-new session + the full prompt + feedback.
            shapeForked = await forkEndedSession(client, chain, subject)
            // Per-model protocol-drift counter (plans/0055 §10 item 3): booked on
            // the model of the session that failed the artifact shape check;
            // undefined without a registry (C2).
            await statsModelEvent(dir, chain.modelEntry, "reprompt")
            log(`↻ ${task.id} subtask ${index} ended naturally but the artifact shape check failed; ${shapeForked ? "forked from the original session, " : ""}re-prompting once with feedback`)
            continue
          }
        }
        break
      }
      const status = handoffStatus(await readHandoff())
      if (status === "done") break
      // Before handover continuation / retry with feedback, commit this
      // session's output first (the next session continues from a committed
      // worktree).
      const committed = await afterSession(dir, opts, task, { stage: `subtask ${index}`, subject })
      if (committed.type === "failed") return commitBlocked(`${task.id} subtask ${index}`, committed)
      if (status === "continue") {
        log(`↻ ${task.id} subtask ${index} context reached the ${formatTokens(cap * 2)} cap; handed over as ${handoffFile(task)}, continuing in a new session`)
        continuation = true
        feedback = ""
        continue
      }
      // Handover-boundary write-check failure (strict resume): one invalid
      // attempt rolls back and cold-starts the redo.
      if (!rolled) {
        const redone = await rollbackRedo()
        if (redone === "done") {
          rolled = true
          log(`↻ ${task.id} subtask ${index} context cap reached but no valid handover document ${handoffFile(task)} was produced; strict resume already rolled back; cold-starting`)
          continue
        }
        if (redone) return redone
      }
      if (retried) {
        return {
          type: "blocked",
          question:
            `subtask session hit the context cap but failed twice to produce a valid handover document ${handoffFile(task)} (missing, or lacking a status line; hidden blockage). ` +
            `Check the file and re-run. Last agent output:\n${result.lastText.trim().slice(-2000) || "(no output)"}`,
        }
      }
      log(`↻ ${task.id} subtask ${index} context cap reached but ${handoffFile(task)} was not produced; retrying once with feedback`)
      retried = true
      feedback =
        `\n\nThe last time you ended the session the context had reached its limit, but no valid ${handoffFile(task)} was written (missing, or lacking the \`Status: continue|done\` status line — a driver protocol string, write it verbatim). ` +
        `This is a hard requirement: write that file before ending the session.`
    }
  }
  // Subtask done: clear the handover documents (the ondemand handover and the
  // test handover — the next subtask starts counting anew; the test handover
  // is named per subtask, so this removes this subtask's file; the driver's
  // tick is recorded by the unified commit that follows).
  await rm(join(planDir, handoffFile(task)), { force: true })
  await removeHandoffChain(planDir, testHandoffFile(task, index))
  // Subtask-directory state protocol close-out (plans/0030 D7): the DRIVER
  // renames todo.md to done.md inside the commit boundary — on-disk file
  // existence is the progress fact; idempotent (no todo.md when the protocol
  // is not active, or done.md already existing after the interruption landed
  // past the rename — both skip).
  await renameTodoToDone(planDir, task.id, index)
  await tickSubtask(planDir, task.id, index)
  // The subtask commit subject omits the task title (task id + subtask number
  // + subtask title locate it already).
  // Unit close-out: the commit range is verified against the baseline — a
  // tick not yet committed does not count as done.
  const committed = await afterSession(dir, opts, task, { stage: `subtask ${index}`, subject }, baseline)
  if (committed.type === "failed") return commitBlocked(`${task.id} subtask ${index}`, committed)
  log(`  ✓ ${text.slice(0, 60)}`)
  return undefined
}

// —— Subtask artifact shape checks (D2/D4/D6, session-boundary-hardening §4.3/§4.6;
// spec-driven since M1.4) ——

// Check list: ① zero disk writes (the worktree is unchanged relative to the
// unit baseline — beginUnit guarantees a clean baseline, so an unmoved HEAD
// with no dirty area means this unit wrote nothing); ②③④ declared artifacts
// run through the generic spec checker (document/spec.ts, "declared" policy):
// existence per declared path, non-trivial + terminal eof for .md files new
// (untracked) in this unit, and declared section anchors; ⑤ the whole-unit eof
// scan — every .md in the unit's git changes (new or modified, incl. undeclared
// side documents and copies already committed at a handover boundary) must be
// non-trivial + end with the terminator; exemptions derive from document roles
// (document/roles.ts eofScanExempt); ⑥ the P1 prohibition scan (M2.3,
// plans/0045) — lines the unit added to deliverable files must not reference
// process documents (document/process-refs.ts; bare task ids are logged as
// warnings only). All criteria are deterministic: a zero-write or truncated
// "natural end" is never completion.
async function subtaskArtifactProblems(dir: string, text: string, baseline: UnitBaseline): Promise<string[]> {
  const problems: string[] = []
  if (await unitQuiet(dir, baseline)) problems.push("no changes relative to the unit baseline (zero disk writes)")
  const fresh = await untrackedFiles(dir)
  const declared = await checkArtifactSpecs(declaredArtifacts(text), { dir, policy: "declared", fresh })
  problems.push(...declared.problems)
  // ③ Shape-checked paths are skipped by the ⑤ scan (one path never forms two
  // cases).
  const shaped = new Set(declared.shaped)
  // ⑤ complements ②: existence catches "what should be there is missing"
  // (uncreated files are invisible to the git scan), the whole-unit scan
  // catches "what was written was not finished"; a modified document whose
  // terminator is no longer the last line fails too (the "appended after the
  // terminator" truncation shape), and the re-prompt feedback directs
  // restoring the terminal terminator.
  for (const rel of await unitChangedFiles(dir, baseline)) {
    if (!rel.toLowerCase().endsWith(".md") || shaped.has(rel) || eofScanExempt(rel)) continue
    const content = await Bun.file(join(dir, rel)).text().catch(() => "")
    problems.push(...docShapeProblems(content, rel))
  }
  const refs = processReferenceScan(await unitAddedLines(dir, baseline))
  for (const warning of refs.warnings) log(`  ⚠ ${warning}`)
  problems.push(...refs.problems)
  return problems
}

// D2 feedback wording: restates the L1 authoritative state (the tick snapshot) and cites each failing item, pointing straight at the misjudgment —
// a previous task's completion narrative is not this task's state (the T-068 S01
// incident shape).
function shapeFeedback(task: Task, index: number, problems: string[]): string {
  const items = task.checklist ?? []
  const done = items.filter((item) => item.done).length
  const sid = `S${String(index).padStart(2, "0")}`
  return (
    `\n\nYou ended the session last time, but this subtask's (${task.id}.${sid}) artifacts did not pass the shape check, so it must not be treated as complete:\n` +
    `${problems.map((problem) => `- ${problem}`).join("\n")}\n` +
    `Authoritative state: task ${task.id} "${task.title}" is in progress, subtask ticks ${done}/${items.length}, ${sid} is not ticked yet; ` +
    `completion narratives in previous tasks or in other documents say nothing about this task's progress — do not judge this subtask complete on that basis. ` +
    `Actually complete this subtask and write its artifacts to disk: every declared artifact file must exist; Markdown documents created or modified in this unit must be complete in content ` +
    `and closed with \`${EOF_MARK}\` alone on the last line of body text before you end the session (when modifying an existing document, the terminator must likewise stay on the last line).`
  )
}
