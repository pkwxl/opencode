// The task execution stage: executeWhole (off/auto/ondemand whole-task
// sessions; auto's is its lead, which may split the rest of the task,
// plans/0059 D2–D4) +
// the merged understand+decompose unit (ensureDecomposed; since M1.0
// understand+decompose is one single session, plans/0030) + runSubtask, one
// subtask session (with the subtask-directory state protocol todo.md→done.md;
// a stream of the lead's split forks the lead, plans/0059 D5).
// Sits above exec-session/session and below runner; **must not import
// runner** (§D.2).
// Split out of src/runner.ts (plans/0024-module-split-plan.md S12, pure move).

import { rm } from "node:fs/promises"
import { join } from "node:path"
import type { ForkBaseInfo, SessionChain } from "./chain"
import { anchorBaseline, coldStart, consumeNote, nameSubject, resetRoute } from "./chain-transitions"
import { docShapeProblems, EOF_MARK, shapeCheckOn } from "./doccheck"
import { handoffFile, subtaskDoc, taskDoc, taskDocPaths, testHandoffFile } from "./docpaths"
import { processReferenceScan } from "./document/process-refs"
import { eofScanExempt, handoffStatus } from "./document/roles"
import { checkArtifactSpecs, declaredArtifacts, decomposeArtifactSpecs, directoryArtifactSpecs, subtaskStateSpec } from "./document/spec"
import { checklistPrerequisites, checklistProblems, renameTodoToDone, subtaskId } from "./document/state"
import { runExecSession } from "./exec-session"
import { headText, removeIfUntracked, unitAddedLines, unitChangedFiles, unitQuiet, untrackedFiles, type UnitBaseline } from "./git"
import { gitOf } from "./git-ops"
import { autobanner, log, subbanner } from "./log"
import { DEFAULT_CONTEXT_LIMIT, type ClientSource, type Opts, type UnitStop } from "./opts"
import { checklistTitle, forkBaseFor, promptViews, readChecklist, reloadTask, setForkBase, setSplit, subtasks, tickSubtask, type Plan, type Task } from "./tasks"
import { renderDecompose, renderFanout, renderSplitRejected, renderSubtask, renderWhole } from "./prompt"
import { promptFacts } from "./prompt-facts"
import { peekProgress } from "./resume"
import { emitStatus } from "./run-status"
import { sessionRole } from "./roles/registry"
import { routingOf, runSession } from "./session"
import { clientOf, forkEndedSession, formatTokens, seedForkSession, sessionAlive, sessionUsed } from "./session-api"
import { parseSplit, splitProblems, splitStateFile, writeSplitTodos } from "./split"
import { statsModelEvent } from "./stats"
import { autoSwitches } from "./switches"
import { handoffSteer, removeHandoffChain } from "./testrun"
import { liveUsage, sessionHandoverDue, splitUsageReached } from "./usage"
import { commitBlocked, rollbackUnitState, strictResumeActive } from "./unit-commit"

// The execution stage for off/auto/ondemand: off finishes the whole task in
// one session; ondemand and auto's lead (`ondemand` is true for both), when a
// live session's context reaches 2x --context-limit, the driver steers in the
// handover hint, the session writes a handover document and a new session
// continues from it, until a natural finish or the handover document marks
// completion. Returns undefined = execution stage done.
// A handover document left over from the previous attempt is cleaned up by the
// caller (the pipeline) after its recovery determination.
// `lead` = auto's lead (plans/0059 D2–D4): the prompt carries the split
// clause, and a session that ends having written subtasks.md is judged by the
// driver's split guard before its work is committed —
//   - taken: the driver writes each line's S<nn>/todo.md, the lead's work,
//     the checklist and the scope files are committed as the task's
//     execution unit (`T-NNN exec`), the lead is recorded as the streams'
//     fork base and the commit as the split point (Task.split), and the
//     caller's subtask loop runs the streams, each a fork of the lead
//     (runSubtask's fan-out, plans/0059 D5);
//   - not taken: subtasks.md is removed, the lead's work is committed, and a
//     fork of the lead is told why and finishes the task. That continuation
//     and every session after it carry no split clause (one rejection at
//     most), and a subtasks.md one of them writes is ignored and removed.
// The clause needs the steer (its criterion (c) is the first usage notice),
// agents that can fork (the streams are forks of the lead; the run start
// says so in opts.leadSplit, plans/0059 D7) and a task whose checklist is not
// written yet: a checklist committed before the stage (written by hand) keeps
// ondemand's path, and runs after the lead as it does there. Without the
// clause auto's lead is exactly ondemand's session.
export async function executeWhole(
  client: ClientSource,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
  ondemand: boolean,
  lead = false,
): Promise<UnitStop | undefined> {
  const cap = opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT
  const dir = opts.dir ?? plan.dir
  // The run's git service (git-ops.ts gitOf, the seam's one resolution
  // point: the opts carrier the loop filled, else the holderless production
  // fallback).
  const git = gitOf(opts)
  const strict = strictResumeActive(opts)
  const planDir = plan.dir
  const readHandoff = async (): Promise<string> => Bun.file(join(planDir, taskDoc(task.id, "handoff"))).text().catch(() => "")
  // Ondemand context management (plans/0056): with OPENCODE_AUTO_STEER on the
  // session gets usage notices and may hand itself over at a natural boundary
  // (a fresh handoff document is honored whatever the figure); the hard-wall
  // hint fires at the effective wall in watch (testrun.ts steerWall: 2×cap,
  // raised to a quarter of a large window, clamped to 80% of it). With the
  // switch off none of it exists — no notices, no hint, the post-session
  // handover check disabled with it (see usage.ts sessionHandoverDue) and a
  // spontaneously written document ignored; off mode never builds one anyway.
  // The role's usage policy (the whole descriptor's handover flag) declares
  // the protocol exists for whole-task sessions at all; the mode (ondemand,
  // auto's lead) is the per-call condition that builds it.
  const usage = sessionRole("whole").usage
  const steer = usage.handover && ondemand ? handoffSteer(autoSwitches().steer, cap, task) : undefined
  const subject = `${task.id} exec ${task.title}`
  nameSubject(chain, subject)
  // The lead's split. The checklist the stage starts from is the committed
  // copy: one the lead of an interrupted run left uncommitted is that lead's
  // own split, still to be judged (a resumed run is the only one the clean
  // gate lets start with it). Without a commit to read (no git) it is the copy
  // on disk.
  // AUTO-DECISION: the starting checklist is read from HEAD, falling back to the disk only without a commit (the copy on disk at the stage's start would make a killed lead's uncommitted split look written by hand on the resumed run, and nothing else lets a task start with an uncommitted checklist past the clean gate)
  // AUTO-RESOLVE: does auto's lead get the split clause when the task already has a committed checklist? -> no, the lead runs as ondemand's session and the checklist runs after it (a checklist a person wrote is a split already decided; judging it by the lead's guard could remove it, and a second split on top would run two plans)
  // AUTO-RESOLVE: does auto's lead get the split clause without usage notices (OPENCODE_AUTO_STEER=off)? -> no, it runs as ondemand's session (criterion (c) is the first usage notice, which never arrives; 0059 D7 rules the same for an agent without mid-turn steer, and the run start already turns the steer off for one)
  // AUTO-DECISION: an agent that cannot fork is known from the run start's fleet-wide degradation (opts.leadSplit), not from the lead's own client (under a model registry the streams may dispatch on any agent of the fleet, and reading a client here would start a host the lead may never use; the steer half of D7 is run-wide in the same way)
  const subtasksRel = taskDoc(task.id, "subtasks")
  const readSubtasks = async (): Promise<string> => Bun.file(join(planDir, subtasksRel)).text().catch(() => "")
  const clause = lead && steer !== undefined && opts.leadSplit !== false
  const checklistBase = clause ? ((await headText(planDir, subtasksRel)) ?? (await readSubtasks())) : ""
  const splitOffered = clause && subtasks(checklistBase).length === 0
  if (clause && !splitOffered) {
    log(`• ${task.id} ${subtasksRel} already holds a checklist; the lead runs without its split clause, and the checklist runs after it`)
  }
  // open = the clause is offered; rejected = one split was not taken, so no
  // later session of this stage gets the clause, and a checklist it writes is
  // removed; none = not auto's lead with the clause at all.
  let split: "open" | "rejected" | "none" = splitOffered ? "open" : "none"
  // A lead that starts makes a split record of an earlier attempt stale: its
  // streams are gone from the checklist (or the lead would not run), and a
  // checklist this stage leaves without a split taken is no fan-out.
  if (lead && task.split !== undefined) await setSplit(planDir, task.id, undefined)
  // Puts subtasks.md back as the stage found it, with any S<nn>/todo.md the
  // lead wrote against the clause (the driver writes those).
  const dropSplit = async (count: number) => {
    if (checklistBase) await Bun.write(join(planDir, subtasksRel), checklistBase)
    else await rm(join(planDir, subtasksRel), { force: true })
    for (let i = 1; i <= count; i++) await removeIfUntracked(planDir, subtaskDoc(task.id, i, "todo"))
  }
  // A checklist the session wrote that nobody judged yet (the lead's own when
  // open, a new one after a rejection); its items when there is one.
  const unjudged = async () => {
    if (split === "none") return []
    const raw = await readSubtasks()
    return raw !== checklistBase ? parseSplit(raw) : []
  }
  // The guard (plans/0059 D4) over the checklist a session just left: taken
  // (the scope files written, a handover document of the lead removed — the
  // streams must not read it as their own), rejected with the reasons, or
  // nothing to judge.
  const judgeSplit = async (): Promise<{ type: "taken"; count: number; used?: number } | { type: "rejected"; reason: string } | undefined> => {
    const items = await unjudged()
    if (!items.length) return undefined
    if (split === "rejected") {
      await dropSplit(items.length)
      log(`↻ ${task.id} ${subtasksRel} was written again after the rejected split; ignored and removed`)
      return undefined
    }
    const reasons = splitProblems(items)
    // The usage condition: the lead's final figure against the wall of its
    // last measurement (the 2×cap budget where none was taken). The
    // mechanism itself is the whole role's split-guard flag (the registry);
    // the lead is the only whole session judged by it.
    // AUTO-DECISION: the wall is the session's own last measured wall (SessionChain.wall), the budget without one (it is the wall the lead's notices were measured against, so the guard and criterion (c) read the same figure; recomputing it here would need the model window)
    const wall = chain.wall ?? steer!.limit
    const tier = (await clientOf(client, chain.agent)).capabilities.usage
    if (usage.splitGuard && !splitUsageReached(tier, chain.used, wall)) {
      reasons.push(`the lead's context (${formatTokens(chain.used)} tokens) is under half the wall (${formatTokens(wall)}), where finishing in this session is cheaper`)
    }
    if (reasons.length) {
      await dropSplit(items.length)
      split = "rejected"
      return { type: "rejected", reason: reasons.join("; ") }
    }
    await writeSplitTodos(planDir, task.id, items)
    await rm(join(planDir, handoffFile(task)), { force: true })
    // The lead's figure goes with the split record where the guard measured
    // it (tasks.ts Task.leadUsed): the streams' fork guard reads it once the
    // lead's own session can no longer tell its size.
    return { type: "taken", count: items.length, ...(liveUsage(tier) ? { used: chain.used } : {}) }
  }
  // Interruption-recovery seeding: a stale handover document is cleared by the
  // pipeline on the non-recovery path, so the file still existing here means an
  // active recovery — handed over before the interruption. Status=done → the
  // execution stage already finished; skip the whole-task session.
  // Status=continue → open a new session on the continuation prompt to continue
  // from the handover (reusing the old session would only hit the cap again at
  // once).
  const priorText = ondemand ? await readHandoff() : ""
  const prior = ondemand ? handoffStatus(priorText) : undefined
  if (prior === "done") {
    log(`↻ ${task.id} resume after interruption: handover document ${handoffFile(task)} marks execution complete; skipping the whole-task session`)
    return undefined
  }
  let continuation = prior === "continue"
  // The rejected split's note goes alone into a fork of the lead (it holds the
  // task and all its work); forked marks that dispatch.
  let forked = false
  // The handoff text the current dispatch was seeded with (recovery doc, or
  // the document a previous session of this run handed over and the
  // continuation prompt reads): a post-session document differing from it was
  // written by the session that just ended — the self-decided handover signal.
  // A document equal to it is stale (the session ended without touching it).
  let consumed = priorText
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
    consumed = ""
    forked = false
    split = splitOffered ? "open" : "none"
    // The cold restart: the chain drops its session state and the one-shot
    // note; the redo is a new prompt under registry routing too (the marks
    // keep their scope-cleared meaning; the chain's entry does not carry
    // over).
    coldStart(chain)
    consumeNote(chain)
    resetRoute(chain)
    return "done"
  }
  for (;;) {
    const brief = forked
    forked = false
    const views = promptViews(plan, task)
    const result = await runExecSession(
      client,
      plan,
      task,
      brief
        ? feedback.trimStart()
        : renderWhole(promptFacts(opts), views.plan, views.task, taskDocPaths(task.id), { mode: opts.mode, ondemand, continuation, budget: steer !== undefined, adaptive: split === "open", parallel: opts.parallel }) + feedback,
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
      // A session stopped before its split was judged: the checklist goes, or
      // the interruption commit would keep it and the next run would read it
      // as one written by hand. A lead that still splits writes it again.
      // AUTO-DECISION: a blocked lead's unjudged split is removed rather than judged or kept (judging needs the session to continue, which a blocked one cannot; kept, the loop's interruption commit would turn it into a committed checklist that the next run offers no guard for)
      const left = await unjudged()
      if (left.length) {
        await dropSplit(left.length)
        log(`↻ ${task.id} the session stopped before ${subtasksRel} was judged; the unjudged split was removed`)
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
    // The lead's split is judged before the commit, so the commit holds its
    // outcome: the lead's work with the checklist and the scope files when
    // taken, the lead's work alone when not.
    const verdict = await judgeSplit()
    // A taken split's streams fork the lead (plans/0059 D5): the session that
    // wrote the split is their fork base, per agent under a registry like
    // every base (plans/0055 §8.4). Recorded before the commit, so a split
    // whose commit landed names its base.
    if (verdict?.type === "taken" && chain.id) await setForkBase(planDir, task.id, chain.id, chain.agent)
    const committed = await git.afterSession(dir, opts, task, { stage: "execute", subject })
    if (committed.type === "failed") return commitBlocked(`${task.id} execution session`, committed)
    if (verdict?.type === "taken") {
      // The split point: every repository's HEAD right after the lead's
      // commit (none where nothing commits). The files a stream's
      // prerequisites change are read against it, and the record marks the
      // checklist as the lead's streams.
      await setSplit(planDir, task.id, !opts.dryrun ? await git.unitBaseline(dir) : [], verdict.used)
      // S5 (plans/0068 D19): under the scheduler the streams run as lanes of
      // their own — cold starts, no fork of the lead (its agent server dies
      // with its process); the task pipeline stops at the split (runner's
      // lead stop). Everywhere else they fork the lead, as they always did.
      const asLanes = opts.lane !== undefined && opts.parallel !== undefined && !autoSwitches().laneIsolation
      log(`↳ ${task.id} the lead split the remaining work into ${verdict.count} streams (${Array.from({ length: verdict.count }, (_, i) => subtaskId(i + 1)).join(", ")}); they run next, ${asLanes ? "each as a lane of its own" : "each a fork of the lead"}`)
      return undefined
    }
    if (verdict?.type === "rejected") {
      // A handover document the lead left is not this round's signal: the
      // fork continues in the lead's own context.
      consumed = await readHandoff()
      // AUTO-DECISION: without a fork (the lead's session is gone, or the fork call failed) the rejected lead continues in a new session with the full whole-task prompt, no clause, plus the note (the shape-check re-prompts' fallback; an agent that cannot fork never gets the clause, plans/0059 D7)
      forked = await forkEndedSession(client, chain, subject)
      feedback = `${forked ? "" : "\n\n"}${renderSplitRejected(promptFacts(opts), taskDocPaths(task.id), verdict.reason, !forked)}`
      retried = false
      log(`↻ ${task.id} the lead's split was not taken (${verdict.reason}); ${forked ? "a fork of the lead" : "a new session"} finishes the task`)
      continue
    }
    // Ending without hitting the handover threshold (2x cap, or the effective
    // wall where a large window raised it above that) = the task
    // finished naturally in a single session; when no steer was built (off
    // mode or OPENCODE_AUTO_STEER=off) it likewise ends naturally, with no
    // handover check. A fresh handoff document (differing from what this
    // dispatch was seeded with) is honored whatever the figure — the session
    // handed itself over at a natural boundary of its own choosing (plans/
    // 0056); only with the steer built, an off-switch run ignores it.
    const doc = await readHandoff()
    const due = sessionHandoverDue((await clientOf(client, chain.agent)).capabilities.usage, steer, chain.used, chain.hinted, chain.wall)
    const fresh = steer !== undefined && doc !== "" && doc !== consumed
    if (!due && !fresh) return undefined
    const status = handoffStatus(doc)
    if (status === "done") return undefined
    if (status === "continue") {
      log(
        due
          ? `↻ ${task.id} context reached the handover wall; handed over as ${handoffFile(task)}, continuing in a new session`
          : `↻ ${task.id} session handed itself over as ${handoffFile(task)}; continuing in a new session`,
      )
      consumed = doc
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
        log(`↻ ${task.id} handover due but no valid handover document ${handoffFile(task)} was produced; strict resume already rolled back; cold-starting this task`)
        continue
      }
      if (redone) return redone
    }
    if (retried) {
      return {
        type: "blocked",
        question:
          `session ended with a handover due but failed twice to produce a valid handover document ${handoffFile(task)} (missing, or lacking a status line; hidden blockage). ` +
          `Check the file and re-run. Last agent output:\n${result.lastText.trim().slice(-2000) || "(no output)"}`,
      }
    }
    log(`↻ ${task.id} handover due but ${handoffFile(task)} was not validly produced; retrying once with feedback`)
    retried = true
    feedback =
      `\n\nThe last time you ended the session a handover was due, but no valid ${handoffFile(task)} was written (missing, or lacking the \`Status: continue|done\` status line — a driver protocol string, write it verbatim). ` +
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
  // The run's git service (git-ops.ts gitOf, the seam's one resolution
  // point).
  const git = gitOf(opts)
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
  nameSubject(chain, subject)
  // When a shape-check / missing-artifact re-prompt is dispatched through a
  // fork of the just-ended session (revised 2026-09-18), the next round carries
  // the feedback alone — the copy already holds the full prompt and all the
  // working context, and resending the whole thing would only induce starting
  // over from scratch.
  let shapeForked = false
  for (let i = 0; ; i++) {
    // fine (OPENCODE_AUTO_DECOMPOSE_FINE=on) passes through into the decompose
    // prompt: injects the fine-grained criteria section
    // (plans/0003-fork-decompose-design.md §5.1).
    const brief = shapeForked
    shapeForked = false
    const views = promptViews(plan, task)
    const result = await runSession(
      client,
      task,
      brief
        ? feedback.trimStart()
        : renderDecompose(promptFacts(opts), views.plan, views.task, taskDocPaths(task.id), { ...opts, fine: autoSwitches().fine }) + feedback,
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
      if (chain.id) await setForkBase(dir, task.id, chain.id, chain.agent)
      const fresh = await reloadTask(plan, task.id)
      const committed = await git.afterSession(opts.dir ?? dir, opts, task, { stage: "decompose", subject })
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
    // (the chain's selected entry).
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
  // Unsatisfiable declarations (plans/0065 F2): a declared path ending in `/`
  // names a directory, and the artifact existence check is a file check — the
  // declaration can never pass, and a subtask running under it would block
  // hidden at its close-out. Rejected here instead: the planning session
  // hears the problem line and retries within the session.
  for (const [i, item] of items.entries()) {
    for (const spec of directoryArtifactSpecs(item.text)) {
      problems.push(`${taskDoc(taskId, "subtasks")} item ${i + 1} declares the directory ${spec.path} as an artifact; declare the concrete files inside it instead (a directory can never pass the artifact existence check)`)
    }
  }
  // Subtask dependency graph (M3.5, plans/0047 G6): the `Depends:` / `Touches:`
  // fields at the top of the S<nn>/todo.md files, S<nn> = checklist item n.
  if (items.length) {
    for (const problem of checklistProblems(await readChecklist(dir, taskId))) problems.push(`docs/${taskId}/S<nn>/todo.md: ${problem}`)
  }
  return problems
}

// The fork base of a stream of auto's taken split (plans/0059 D5): the lead
// session recorded when the split was taken, read for the chain's agent under
// a registry (a session is agent-local, plans/0055 §8.2). A lead that is gone
// leaves the stream a new session with the full subtask prompt. The
// pipeline's fork switches (OPENCODE_AUTO_FORK / _FORK_BASE) govern true
// alone (0059 D1) and are not read here; an agent that cannot fork falls to
// the same new session inside seedForkSession.
// AUTO-RESOLVE: does OPENCODE_AUTO_FORK=off (or _FORK_BASE) stop auto's streams from forking the lead? -> no (the design rules that the pipeline's fork switches govern true alone; forking the lead is what auto's split is, and a stream without a fork still runs, in a new session)
export async function leadForkBase(client: ClientSource, task: Task, opts: Opts, chain: SessionChain): Promise<ForkBaseInfo | undefined> {
  const agent = chain.agent ?? routingOf(opts, autoSwitches()).runAgent
  const id = forkBaseFor(task.forkBase, agent)
  // A digest base is the planned pipeline's, never a lead.
  if (id === undefined || id.startsWith("digest:")) return undefined
  const baseClient = await clientOf(client, agent)
  const onAgent = agent !== undefined ? ` on agent ${agent}` : ""
  if (!(await sessionAlive(baseClient, id))) {
    log(`↻ ${task.id} the lead session ${id}${onAgent} is gone; the stream starts in a new session`)
    return undefined
  }
  // The lead's size: the chain's own figure while the chain still holds the
  // lead, else the session's history, else the figure recorded with the split
  // (an agent with no readable history, tasks.ts Task.leadUsed).
  const used = id === chain.id ? chain.used : ((await sessionUsed(baseClient, id)) ?? task.leadUsed)
  log(`⑂ ${task.id} lead base: session ${id}${onAgent} (${used === undefined ? "usage unknown" : `${formatTokens(used)} tokens`})`)
  return { id, used, lead: true, ...(agent !== undefined ? { agent } : {}) }
}

// Runs one subtask session, then ticks the checklist item on trust: the
// session self-checks its own work; the whole task is accounted for by the
// wrap-up report and its result line.
// No context handover for the planned pipeline's subtasks: the session
// handover mechanism is ondemand's (plans/0056 — this wiring was retired with
// it); such a session that runs past the usage cap is left to the
// provider-side compression / cap errors, which go through the existing
// "session error" path. The interruption-recovery seeding below still reads a
// handover document left by a run of an earlier release, and the close-out
// still clears such leftovers.
// `split` = the item is a stream of auto's taken split (plans/0059 D5; the
// split point, Task.split). Such a stream:
//   - forks the lead (base, from leadForkBase) and gets the short delta of
//     fanout.md alone — the fork holds the task, its rules and the lead's
//     understanding; the delta names the files changed since the split when
//     the stream has prerequisites, and asks the last stream for the task's
//     full acceptance verification;
//   - runs under the usage protocol, as the lead did: its prefix starts
//     large, so it gets the notices and the hard-wall hint, and may hand
//     itself over through handoff.md. A handover continues the stream in a
//     new session from that document (the full subtask prompt, scoped to the
//     stream), inside the same unit — one commit at its close-out;
//   - without a fork (the lead gone, an agent that cannot fork) or resumed
//     after an interruption, gets the full subtask prompt with the protocol.
// `laneStream` (plans/0068 S5, D19) = the stream is a lane unit of its own
// (T-NNN.S<nn>, scheduled side by side by the parent): it never forks the
// lead — the lead's agent server belonged to the lead's process and is gone
// — so its first session is a cold start carrying the enriched fanout delta
// (the task block and its own scope file in full), and its handover runs
// through the per-stream document docs/T-NNN/S<nn>/handoff.md (side-by-side
// streams share no handoff file). The in-lane serial path (one lane or one
// process running its own streams after the lead's split) passes nothing and
// keeps today's behavior byte for byte.
// The unit state protocol, the commit boundary and the shape check are the
// same for every subtask.
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
  split?: UnitBaseline,
  laneStream = false,
): Promise<UnitStop | undefined> {
  subbanner(`${task.id} subtask ${index}: ${text.length > 50 ? `${text.slice(0, 50)}…` : text}`)
  const subject = `${task.id} S${index} ${text}`
  nameSubject(chain, subject)
  // Registry routing (plans/0055 §6.2): a new subtask is a new prompt — its
  // first dispatch selects from the list instead of continuing the task's
  // current entry (a failover within the task persists through the down
  // marks, which survive subtask boundaries under the task scope, so a
  // spent quota still skips its model; a window that reopened returns to
  // the primary, as a new prompt should). Without a registry the chain's
  // candidate keeps its exact task-scoped meaning.
  resetRoute(chain)
  const dir = opts.dir ?? plan.dir
  // The run's git service (git-ops.ts gitOf, the seam's one resolution
  // point).
  const git = gitOf(opts)
  // Subtask unit commit boundary: startup clean gate + SHA baseline (close-out
  // verifies the commit range is all driver commits); driver-exclusive
  // state-file leftovers self-heal through the carryover inside beginUnit. The
  // baseline also goes onto the chain (strict resume: carried by the active
  // record, the rollback anchor).
  let baseline: UnitBaseline | undefined
  if (resumeUnit) {
    if (!opts.dryrun) baseline = await git.unitBaseline(dir)
  } else {
    const gate = await git.beginUnit(dir, opts, task)
    if (gate.type === "dirty") return { type: "dirty", files: gate.files }
    baseline = gate.baseline
  }
  anchorBaseline(chain, baseline)
  const strict = strictResumeActive(opts)
  const planDir = plan.dir
  // A stream of the lead's split runs under the usage protocol (the lead's
  // own steer: notices at 50%/85% of the wall, the hard-wall hint); none with
  // OPENCODE_AUTO_STEER=off, which leaves the stream without a handover, as
  // it leaves every session. A lane stream hands over through its own
  // per-stream document (plans/0068 S5: side-by-side streams share no
  // handoff file — the deferral that had them all share the task's one
  // handoff.md retired with stream lanes); the in-lane serial stream keeps
  // the task-level file, as it always did.
  const streamHandoff = laneStream ? subtaskDoc(task.id, index, "handoff") : handoffFile(task)
  const readHandoff = async (): Promise<string> => Bun.file(join(planDir, streamHandoff)).text().catch(() => "")
  // The role's usage policy (the subtask descriptor's handover flag)
  // declares the protocol exists for subtask sessions; a stream of a taken
  // split is the per-call condition that builds it (the planned pipeline's
  // subtasks never do, plans/0056 D1).
  const usage = sessionRole("subtask").usage
  const steer = split && usage.handover ? handoffSteer(autoSwitches().steer, opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT, task, laneStream ? index : undefined) : undefined
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
  const priorText = stateDone ? "" : await readHandoff()
  const prior = stateDone ? undefined : handoffStatus(priorText)
  if (stateDone) {
    log(`↻ ${task.id} subtask ${index}: ${stateSpec.complete.path} already exists; skipping the session and closing out directly`)
  } else if (prior === "done") {
    log(`↻ ${task.id} resume after interruption: handover document ${handoffFile(task)} marks the subtask complete; checking it off directly`)
  } else {
    let continuation = prior === "continue"
    if (continuation) log(`↻ ${task.id} resume after interruption: handed over as ${handoffFile(task)} before the interruption; the new session continues the subtask from the handover document`)
    // The session the interruption recovery reuses (it holds a resume note):
    // seedForkSession keeps it instead of forking.
    const resumed = chain.id !== undefined && chain.note !== undefined
    // ③ A subtask's first session forks from the fork base (the same fork
    // point as the decompose session — fork first, render after, which the
    // warm/cold background section chooses by); no reuse across subtasks
    // (enforced by the seed chain), while a recovery continuation keeps the
    // chain's existing mechanisms. No base /
    // fork failure → brand-new session + cold-start prompt (reads context.md).
    // A stream continuing from its handover document starts in a new session
    // instead: forking the lead again would put it back at the lead's size.
    // AUTO-DECISION: a stream's handover continuation is a new session without a fork (the design's "fresh session from its handoff.md"; a new fork of the lead would restart at the lead's size, at or above half the wall, and hand over again soon)
    let warm = split && continuation ? false : await seedForkSession(client, opts, chain, base, subject)
    // A lane stream never forks (plans/0068 D19): the lead's agent server
    // belonged to the lead's process and is gone, and the cold start is the
    // design — the delta is enriched to be the whole prompt instead.
    if (laneStream) warm = false
    // A stream in a fresh fork of the lead: the delta prompt alone. A session
    // the recovery resumed gets the full prompt instead.
    // AUTO-DECISION: a stream's session resumed after an interruption gets the full subtask prompt, not the delta (the resumed session may be a new session the stream started in without a fork, which the delta would leave without the task; the full prompt is right for a fork too)
    // A lane stream's first session carries the delta too — the cold one,
    // with the task and the stream's scope file in full (S5).
    let forked = split !== undefined && !resumed && (warm || laneStream)
    // The delta's changing parts, read once the fork is made: the other
    // streams by title, the files changed since the split for a stream whose
    // prerequisites ran, and whether this is the last stream.
    // AUTO-DECISION: the changed-files list is every file changed since the split (tracked diffs and untracked files across the nested repositories, deletions left out, as the shape check reads them) minus the driver's checklist ticks and S<nn> state files, and a stream without prerequisites gets none (the fork holds the tree as it was at the split; an independent stream's files are disjoint from what ran before it by the guard)
    // AUTO-DECISION: a sibling line carries its done state beside the title (one word per line, and it tells the stream which siblings' work is already in the tree it forks into)
    const fanout = async () => {
      const items = task.checklist ?? []
      const prerequisites = checklistPrerequisites(items, index)
      const changed =
        split?.length && prerequisites.length
          ? [...(await unitChangedFiles(dir, split))].filter((rel) => !splitStateFile(task.id, rel)).sort()
          : []
      return {
        siblings: items.flatMap((item, i) => (i + 1 === index ? [] : [`${subtaskId(i + 1)} ${checklistTitle(item.text)}${item.done ? " (done)" : ""}`])),
        changed,
        last: items.every((item, i) => item.done || i + 1 === index),
        // The cold delta's own two: the stream's scope file in full (the
        // fork-less session has read nothing; the file holds the scope and
        // the artifacts) — read once here, passed through below.
        scope: await Bun.file(join(planDir, subtaskDoc(task.id, index, "todo"))).text().catch(() => ""),
      }
    }
    const delta = forked ? await fanout() : undefined
    const prompt = (): string => {
      const views = promptViews(plan, task)
      const docs = taskDocPaths(task.id)
      return forked && delta
        ? renderFanout(promptFacts(opts), views.plan, views.task, docs, text, index, {
            ...opts,
            ...delta,
            cold: laneStream,
            handoff: laneStream ? subtaskDoc(task.id, index, "handoff") : docs.handoff,
            budget: steer !== undefined,
          })
        : renderSubtask(promptFacts(opts), views.plan, views.task, docs, text, {
            ...opts,
            continuation,
            index,
            warm: split ? false : warm,
            digest: Boolean(base?.digest),
            budget: steer !== undefined,
            ...(laneStream ? { handoff: subtaskDoc(task.id, index, "handoff") } : {}),
          })
    }
    let feedback = ""
    // Re-prompt count for the artifact shape check (D2): one re-prompt with
    // feedback per subtask, then blocked for a human.
    let shapeRetried = false
    // When a re-prompt (the shape check's, or a stream's missing handover
    // document) is dispatched through a fork of the just-ended session
    // (revised 2026-09-18), the next round carries the feedback alone — the
    // copy already holds the full prompt and all the working context, and
    // resending the whole thing would only induce starting over from scratch.
    let briefFork = false
    // A stream's handover (plans/0059 D5, the ondemand loop of executeWhole):
    // consumed = the handover text the current session was seeded with (a
    // document differing from it was written by the session that just ended);
    // handoverRetried = the one re-prompt for a handover due without a valid
    // document was spent.
    let consumed = priorText
    let handoverRetried = false
    // Strict-resume rollback redo (tightened in 3.3 R3): one test-handover
    // write-check failure rolls back to
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
      consumed = ""
      handoverRetried = false
      // The cold restart: the chain drops its session state and the one-shot
      // note; the redo is a new prompt under registry routing too.
      coldStart(chain)
      consumeNote(chain)
      resetRoute(chain)
      // The cold-start redo forks from the base again (the same shape as the
      // subtask's first session, recovering the warm prefix); a lane stream
      // stays fork-less and takes the cold delta again (D19).
      warm = await seedForkSession(client, opts, chain, base, subject)
      if (laneStream) warm = false
      forked = split !== undefined && (warm || laneStream) && delta !== undefined
      return "done"
    }
    for (;;) {
      const brief = briefFork
      briefFork = false
      const result = await runExecSession(client, plan, task, brief ? feedback.trimStart() : prompt() + feedback, opts, chain, steer, index)
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
      // A stream's handover (only with the steer built): the ondemand loop's
      // reading of executeWhole — a handover due by the figure (or the hint),
      // or a fresh document the session wrote at a boundary of its choosing.
      // Status continue → a new session continues the stream from the
      // document; done → the stream is finished, judged below as a natural
      // end; no valid document → one re-prompt through a fork of the ended
      // session (it holds what the document needs), then blocked.
      if (steer) {
        const doc = await readHandoff()
        const due = sessionHandoverDue((await clientOf(client, chain.agent)).capabilities.usage, steer, chain.used, chain.hinted, chain.wall)
        const fresh = doc !== "" && doc !== consumed
        if (due || fresh) {
          const status = handoffStatus(doc)
          if (status === "continue") {
            log(
              due
                ? `↻ ${task.id} subtask ${index} context reached the handover wall; handed over as ${handoffFile(task)}, continuing in a new session`
                : `↻ ${task.id} subtask ${index} session handed itself over as ${handoffFile(task)}; continuing in a new session`,
            )
            consumed = doc
            continuation = true
            forked = false
            feedback = ""
            continue
          }
          if (status !== "done") {
            if (!rolled) {
              const redone = await rollbackRedo()
              if (redone === "done") {
                rolled = true
                log(`↻ ${task.id} subtask ${index} handover due but no valid handover document ${handoffFile(task)} was produced; strict resume already rolled back; cold-starting this subtask`)
                continue
              }
              if (redone) return redone
            }
            if (handoverRetried) {
              return {
                type: "blocked",
                question:
                  `subtask ${index} ended with a handover due but failed twice to produce a valid handover document ${handoffFile(task)} (missing, or lacking a status line; hidden blockage). ` +
                  `Check the file and re-run. Last agent output:\n${result.lastText.trim().slice(-2000) || "(no output)"}`,
              }
            }
            handoverRetried = true
            // AUTO-DECISION: a stream's missing handover document is demanded in a fork of the ended session with the feedback alone (it holds what the document must say; executeWhole's retry sends the full prompt to a new session, which cannot know it), and a new session with the full prompt only without a fork
            feedback =
              `\n\nThe last time you ended the session a handover was due, but no valid ${handoffFile(task)} was written (missing, or lacking the \`Status: continue|done\` status line — a driver protocol string, write it verbatim). ` +
              `This is a hard requirement: write that file for this subtask before ending the session.`
            briefFork = await forkEndedSession(client, chain, subject)
            log(`↻ ${task.id} subtask ${index} handover due but ${handoffFile(task)} was not validly produced; ${briefFork ? "forked from the ended session, " : ""}retrying once with feedback`)
            continue
          }
        }
      }
      // Ending = the subtask session finished naturally (the planned
      // pipeline's subtasks have no context handover, plans/0056; a session
      // over the usage cap hits the provider-side compression / cap errors
      // and goes through the existing "session error" path — retry in a new
      // session — with disk progress and the unified commit unaffected; a
      // stream of the lead's split got here past its handover check above).
      // Completion is never
      // judged by agent self-report: the artifact shape check runs first
      // (D2/D4/D6, session-boundary-hardening §4.3/§4.6) — zero-write /
      // missing declared artifacts / document truncation (including the
      // whole-change scan); any hit means no tick and no advance (the
      // verdict-layer gap of the T-068 S01 incident), one re-prompt with
      // feedback, still failing → blocked for a human. Not enabled under
      // dryrun / commit gate off / non-git; a session ending in a test
      // handover is exempt (its completion criterion is in testhandoff.md).
      if (baseline && shapeCheckOn(opts, baseline, Boolean(result.testHandover))) {
        // The item text re-read fresh from the checklist right before the
        // shape check (plans/0065 F1): a declaration the subtask session fixed
        // mid-run is judged by the fixed text, not the dispatch-time snapshot
        // (the task is otherwise reloaded only after a successful close-out,
        // so a blocked run kept seeing the stale item — the T-066 S01/S02
        // incidents). The shape check reads only; the tick/idempotency
        // invariant is unaffected. A checklist no longer holding this item
        // falls back to the dispatch-time snapshot.
        const item = (await readChecklist(planDir, task.id))[index - 1]
        const problems = await subtaskArtifactProblems(dir, item?.text ?? text, baseline, opts.scanExempt)
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
          briefFork = await forkEndedSession(client, chain, subject)
          // Per-model protocol-drift counter (plans/0055 §10 item 3): booked on
          // the model of the session that failed the artifact shape check.
          await statsModelEvent(dir, chain.modelEntry, "reprompt")
          log(`↻ ${task.id} subtask ${index} ended naturally but the artifact shape check failed; ${briefFork ? "forked from the original session, " : ""}re-prompting once with feedback`)
          continue
        }
      }
      break
    }
  }
  // Subtask done: clear the handover documents (the ondemand handover and the
  // test handover — the next subtask starts counting anew; the test handover
  // is named per subtask, so this removes this subtask's file; the driver's
  // tick is recorded by the unified commit that follows). A lane stream's
  // handover document is its own per-stream file (S5); the serial in-lane
  // stream keeps clearing the task-level one.
  await rm(join(planDir, streamHandoff), { force: true })
  await removeHandoffChain(planDir, testHandoffFile(task, index))
  // Subtask-directory state protocol close-out (plans/0030 D7): the DRIVER
  // renames todo.md to done.md inside the commit boundary — on-disk file
  // existence is the progress fact; idempotent (no todo.md when the protocol
  // is not active, or done.md already existing after the interruption landed
  // past the rename — both skip).
  await renameTodoToDone(planDir, task.id, index)
  await tickSubtask(planDir, task.id, index)
  // The subtask's unit transition (P2b, src/run-status.ts): the rename above
  // is the fact (files are the progress state); this is the push of the same
  // fact. The qualified id is the task id plus S<nn>, and a subtask that ran
  // reads as having been in_progress (the state protocol records no runtime
  // status per subtask — the file pair is its whole state).
  emitStatus({ type: "unit-transition", unit: `${task.id}.${subtaskId(index)}`, level: "subtask", from: "in_progress", to: "done" })
  // The subtask commit subject omits the task title (task id + subtask number
  // + subtask title locate it already).
  // Unit close-out: the commit range is verified against the baseline — a
  // tick not yet committed does not count as done.
  const committed = await git.afterSession(dir, opts, task, { stage: `subtask ${index}`, subject }, baseline)
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
// "natural end" is never completion. `exempt` = the project's scan
// exemptions (config scanExempt, plans/0059 X2): deliverable paths both ⑤ and
// ⑥ skip, where terminator-free Markdown or process-shaped strings are
// content.
async function subtaskArtifactProblems(dir: string, text: string, baseline: UnitBaseline, exempt?: readonly string[]): Promise<string[]> {
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
    if (!rel.toLowerCase().endsWith(".md") || shaped.has(rel) || eofScanExempt(rel, exempt)) continue
    const content = await Bun.file(join(dir, rel)).text().catch(() => "")
    problems.push(...docShapeProblems(content, rel))
  }
  const refs = processReferenceScan(await unitAddedLines(dir, baseline), exempt)
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
