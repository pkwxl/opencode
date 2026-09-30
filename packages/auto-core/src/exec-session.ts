// The handover-sequence state machine for execution-type sessions
// (runExecSession): under --test-by-driver it wraps the test-handover loop,
// resuming from the interruption point per "handover-document file state ×
// commit state", with frozen-point / continuation-session forks
// (seedPinFork/seedSessionFork). Sits above session and testrun, below
// execute; **must not import runner**, and testrun must not import this module
// either (§D.2 cycle resolution).
// Split out of src/runner.ts (plans/0024-module-split-plan.md S10, pure move).

import { dirname, join } from "node:path"
import type { SessionChain, SessionResult } from "./chain"
import { consumeNote, seedFork } from "./chain-transitions"
import { archivedTestHandoff, latestHandoffSeq, testHandoffFile } from "./docpaths"
import { fileCommitted, suffixedTitle } from "./git"
import { createGitOps } from "./git-ops"
import { forgetHandover, closedHandovers, handoverSeq, handoverStage, recallHandover, saveHandover, type Handover } from "./handover"
import { log } from "./log"
import { DEFAULT_CONTEXT_LIMIT, type ClientSource, type Opts } from "./opts"
import type { RoutingFacts } from "./routing"
import type { Plan, Task } from "./tasks"
import { renderTestContinue, renderTestWrapup, type TestRunInfo } from "./prompt"
import { promptFacts } from "./prompt-facts"
import { COMMIT_CLARIFY } from "./resume-gate"
import { runSession } from "./session"
import { clientOf, forkSession, sessionAlive, sessionUsed } from "./session-api"
import {
  archiveHandoff,
  fillHandoffStatus,
  latestTestScript,
  latestTestSeq,
  restoreTestHandoffs,
  runTestScript,
  TEST_HANDOVER_ADVISORY,
  type Steer,
  type TestRun,
} from "./testrun"
import { commitBlocked } from "./unit-commit"
// The fence's registry/no-registry agent verdict (moved out of unit-commit
// with the routing fence: its no-registry guard is a routing-truthiness
// branch, so it lives in the router service's module).
import { recordedAgentOk } from "./router"
import { scriptTmpDir } from "./script"

// The unified entry for execution-type sessions (subtask / whole task /
// repair round): without --test-by-driver it passes straight through to
// runSession; enabled, it wraps the test-handover loop — when a session hands
// over after a test failure with the context at its cap, a new session
// continues on the continuation prompt (reading the handover document and the
// latest output first), until the session finishes naturally. The handover
// count has no hard cap; past TEST_HANDOVER_ADVISORY the AI is prompted to
// assess whether it is stuck on an unsolvable problem (it may mark the
// leftover with AUTO-FIXME and continue). subtask is the subtask number
// (passed only by subtask sessions): handover documents are named by execution
// scope (subtask level docs/<id>/S<two-digit number>/testhandoff.md), so the
// next subtask cannot misread the previous subtask's leftover handover; whole
// task / repair round use the task-level name.
export async function runExecSession(
  client: ClientSource,
  plan: Plan,
  task: Task,
  promptText: string,
  opts: Opts,
  chain: SessionChain,
  steer?: Steer,
  subtask?: number,
  unit = subtask !== undefined ? `subtask ${subtask}` : "execute",
): Promise<SessionResult> {
  if (!opts.testByDriver || opts.dryrun) return runSession(client, task, promptText, opts, chain, steer)
  const dir = opts.dir ?? plan.dir
  // The run's git service: the opts carrier the loop filled, else the
  // holderless production fallback (a minimal test literal — committing on,
  // exactly what such a literal did before the seam).
  const git = opts.git ?? createGitOps()
  const tmp = scriptTmpDir(dir)
  const handoff = testHandoffFile(task, subtask)
  // Scene restoration (interruption recovery F3): handover documents already
  // committed but absent from the worktree are restored first — the previous
  // run's stale cleanup may have deleted the in-flight document. Must precede
  // the archived-numbering scan below: the numbering must be based on the
  // restored scene, otherwise a deleted archived copy would roll the numbering
  // back and overwrite historical handovers.
  await restoreTestHandoffs(dir, task)
  // Interruption recovery (test-handover interruption recovery,
  // plans/0023-test-handover-early-design.md §I): locate where the handover
  // sequence was interrupted by "file state × commit state", then resume from
  // that position. The observables are the current testhandoff.md, the
  // archived testhandoff-<n>.md, and whether each is committed; the in-flight
  // record (.auto/handover.json) only supplies the identity facts that files
  // and commits cannot imply (the pending script, the executed result, the
  // forkable session). Files are named by execution scope; only this scope's
  // handovers are recognized.
  const record = await recallHandover(dir, task.id, handoff)
  // Observed sequence number and archive continuation number are kept separate
  // (handoverSeq): observation treats the in-flight record as authoritative
  // with the disk scan as fallback — the disk scan can be polluted by the
  // session's own writing into the archive name family, misjudging a handover
  // that never happened as closed out. Archive numbering continues across
  // sessions / runs (D4) taking the max of both sides, never restarting from 1
  // nor overwriting mis-written copies.
  const seq = handoverSeq(record, await latestHandoffSeq(dir, handoff))
  // handovers initial value = the closed-out count: while the record is not
  // closed out, record.n is the number already allocated to the in-flight
  // handover, not the closed-out count; using it directly as the base would
  // make the recovery close-out skip past it (archive numbering gap, frozen
  // point and close-out titles no longer matching).
  let handovers = closedHandovers(record, seq)
  const test: TestRun = {
    dir,
    tmp,
    handoffFile: join(dir, handoff),
    handover: opts.handoverTest === true,
    limit: opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT,
    seq: await latestTestSeq(tmp),
    task,
    unit,
    subject: chain.subject ?? task.id,
    label: subtask !== undefined ? `${task.id} S${subtask}` : task.id,
    handovers,
    startUsed: 0,
  }
  const current = await Bun.file(join(dir, handoff)).text().catch(() => undefined)
  const archivedRel = seq.observed > 0 ? archivedTestHandoff(handoff, seq.observed) : handoff
  const hasArchived = seq.observed > 0 && (await Bun.file(join(dir, archivedRel)).exists())
  const stage = handoverStage({
    record,
    current,
    currentCommitted: current !== undefined && (await fileCommitted(dir, handoff)),
    archived: hasArchived,
    archivedCommitted: hasArchived && (await fileCommitted(dir, archivedRel)),
  })
  let continuation = false
  let archived = archivedRel
  // One-shot rewrite of the first-round prompt: when the wrap-up is
  // unfinished, the session forked from the frozen point already carries this
  // execution scope's full context — what needs dispatching is the wrap-up
  // instruction itself, not another pass through the task prompt.
  let firstPrompt: string | undefined
  if (stage === "wrapup" && record) {
    // H1 wrap-up unfinished: the freeze commit already landed, and the session
    // was interrupted before finishing the handover document. Fork a new
    // session from the session state at the frozen moment to redo the wrap-up;
    // after the wrap-up it proceeds as usual through archive → commit #2 →
    // run the script.
    if (await seedPinFork(client, chain, record, `${test.label} test handover #${record.n} wrapup`, opts.routing)) {
      if (record.script) test.pending = { script: record.script, seq: record.seq ?? ++test.seq }
      test.resumeWrapup = true
      firstPrompt = renderTestWrapup(promptFacts(opts), { handoffFile: test.handoffFile })
      log(`↻ ${test.label} resume after interruption: test handover #${record.n} committed the frozen tree but wrapup is unfinished; forking from the frozen point to redo the wrapup`)
    } else {
      // The frozen session is no longer available: the wrap-up has nothing to
      // continue from; drop the in-flight record and cold-start a redo of this
      // execution scope (the freeze commit stays in history as a harmless
      // intermediate commit).
      await forgetHandover(dir)
      log(`↻ ${test.label} resume after interruption: the frozen session for test handover #${record.n} is no longer available; cold-starting this execution scope`)
    }
  } else if (stage === "commit" || stage === "test") {
    // H2 handover fully written but not closed out / H3 closed out: fill in
    // the missing steps (add the status line → archive → commit #2 → run the
    // script), then open the continuation session. closedN = the archive
    // number acknowledged this time: H3 takes the observed number, H2 — when
    // backfilling the archive — the newly continued one; the in-flight
    // record's n matches it, so what it points at is the real archived copy.
    let closedN = seq.observed
    if (stage === "commit") {
      if (!hasArchived) {
        // F2 backfill marker: the content is by construction complete
        // (committed, or carrying a status line); the missing line is added by
        // the driver — the archived copy must itself attest "this is a
        // finished handover", and it lands with commit #2.
        await fillHandoffStatus(join(dir, handoff))
        handovers++
        test.handovers = handovers
        closedN = handovers
        archived = archivedTestHandoff(handoff, closedN)
        await archiveHandoff(dir, handoff, closedN)
      } else {
        // Archived on disk but not committed: a legacy on-disk state may lack
        // the status line (archived before the status-line convention); the
        // backfill write is idempotent (left alone when a status line already
        // exists) and lands with commit #2.
        await fillHandoffStatus(join(dir, archived))
      }
      const subject = suffixedTitle(test.subject, `test handover #${closedN}`)
      const committed = await git.afterSession(dir, opts, task, { stage: `${unit} handoff-${closedN}`, subject })
      if (committed.type === "failed") return commitBlocked(subject, committed)
      log(`↻ ${test.label} resume after interruption: handover document ${archived} was fully written but not closed out; committed as backfill`)
    } else {
      log(`↻ ${test.label} resume after interruption: test handover #${closedN} closed out (${archived} archived)`)
    }
    // Script execution state (F6 revision, 2026-09-17, design document §M):
    // the frozen script's execution result is persisted with the in-flight
    // record at close-out (ran) — a local script always runs to completion
    // except on power loss / forced termination, so executed counts as
    // finished: recovery does not re-execute it and references the persisted
    // output through the record. Only "the frozen point already consumed a
    // script but the execution result is not on disk" (interrupted
    // mid-execution) re-runs; a missing record (a legacy on-disk state from
    // before this mechanism landed) falls back to the newest execution
    // snapshot under tmp/. Old-format records (neither ran nor script): a
    // script cleared at close-out already means executed — no re-run, no
    // invented result; the continuation session reads the handover document
    // and the existing output under tmp/.
    let ran = record?.ran
    if (ran) {
      test.last = ran
    } else {
      const script = record ? record.script : await latestTestScript(tmp)
      if (script) {
        log(`↻ ${test.label} resume after interruption: test script ${script} pending execution on the frozen rerun`)
        ran = await runTestScript(test, opts, script)
      }
    }
    // The continuation session was already opened and then interrupted →
    // fork from it to resume, reconnecting the context that round had
    // accumulated.
    // A session never crosses agents (plans/0055 §8.3): a record whose agent
    // is not this run's (an absent field is the default agent's) is a dead
    // anchor — the fork is refused and the scope cold-starts.
    if (
      record?.nextSession &&
      recordedAgentOk(opts.routing, record.agent) &&
      (await seedSessionFork(client, chain, record.nextSession, `${test.label} test handover #${closedN} continuation`, opts.routing ? (record.agent ?? opts.routing.runAgent) : undefined))
    ) {
      log(`↻ ${test.label} resume after interruption: the pre-interruption continuation session ${record.nextSession} is still alive; forked a copy to resume`)
      // The fork copy carries the continuation session's full context (the
      // task prompt and continuation instructions were dispatched when it was
      // opened), so resending the whole thing would only duplicate: this
      // recovery brings it the result only when a test was freshly run,
      // otherwise it converges to a single continue (same rule as recovery
      // fidelity's "a reused session's recovery note converges to a single
      // continue").
      firstPrompt =
        ran && !record?.ran
          ? renderTestContinue(promptFacts(opts), { handoffFile: archived, run: ran, stuck: handovers > TEST_HANDOVER_ADVISORY ? handovers : undefined })
          : `[DRIVER] The last run was interrupted here; resumed from a fork of the continuation session. Continue from the interruption point. ${COMMIT_CLARIFY}`
    }
    continuation = true
    await saveHandover(dir, {
      ...(record ?? { task: task.id, scope: handoff, unit, n: closedN }),
      n: closedN,
      script: undefined,
      seq: undefined,
      agent: undefined,
      pinSession: undefined,
      pinMessage: undefined,
      nextSession: undefined,
      ...(ran ? { ran } : {}),
    })
  }
  for (;;) {
    const extra = continuation
      ? `\n\n${renderTestContinue(promptFacts(opts), {
          handoffFile: archived,
          run: test.last,
          stuck: handovers > TEST_HANDOVER_ADVISORY ? handovers : undefined,
        })}`
      : ""
    const prompt = firstPrompt ?? promptText + extra
    firstPrompt = undefined
    const result = await runSession(client, task, prompt, opts, chain, steer, test)
    test.resumeWrapup = false
    // A blocked exit keeps the in-flight record: once a person resolves it
    // and the run restarts, the state machine lands back at the interrupted
    // position through it.
    if (result.type === "blocked") return result
    // The session ending naturally = this execution scope's handover loop is
    // closed, and the record is voided with it.
    if (!result.testHandover) {
      await forgetHandover(dir)
      return result
    }
    handovers++
    test.handovers = handovers
    archived = archivedTestHandoff(handoff, handovers)
    await archiveHandoff(dir, handoff, handovers)
    // Commit #2 (handover confirmation): the wrap-up's on-disk results + the
    // archived handover document are committed together. The unit is not
    // closed out yet, so no baseline is passed.
    const subject = suffixedTitle(test.subject, `test handover #${handovers}`)
    const committed = await git.afterSession(dir, opts, task, { stage: `${unit} handoff-${handovers}`, subject })
    if (committed.type === "failed") return commitBlocked(subject, committed)
    // The frozen script runs only after the handover close-out — what it
    // tests is exactly the tree of commit #2. If the script itself rewrites
    // tracked files (e.g. rustfmt apply), that stays as an uncommitted
    // delta, absorbed by the next unit's commit.
    let ran: TestRunInfo | undefined
    if (test.pending) {
      const pending = test.pending
      test.pending = undefined
      ran = await runTestScript(test, opts, pending.script, pending.seq)
    }
    // Close-out complete: the in-flight record enters the "closed out" state
    // — the pending script is consumed, the frozen anchor voided, the
    // execution result fixed into the record (ran; recovery does not
    // re-execute); the identity information left is only the continuation
    // session about to open (attempt backfills nextSession).
    await saveHandover(dir, { task: task.id, scope: handoff, unit, n: handovers, ...(ran ? { ran } : {}) })
    log(`↻ ${test.label} context limit reached; handed over as ${archived}, continuing in a new session (test handover #${handovers})`)
    continuation = true
  }
}

// Frozen-point fork (F5): fork a new session out of the recorded frozen
// session's state at the frozen moment, to redo an interrupted handover
// wrap-up. The server's fork semantics are "copy the messages **before**
// target", so the anchor is the message **after** the last one observed at the
// freeze; when it cannot be obtained (messages already pruned, or the anchor
// is the last one) the whole session is forked — the wrap-up prompt is
// dispatched again, the session does the wrap-up at most twice, and nothing
// is lost.
// routing is the run's routing facts (undefined = no registry): a session
// never crosses agents (plans/0055 §8.3), so a record whose agent is not one
// this run dispatches on (an absent field is the run's start profile's) is a
// dead anchor — no fork, the caller cold-starts the scope. The fork runs on
// the record's agent's host, and the chain's binding follows the fork.
export async function seedPinFork(client: ClientSource, chain: SessionChain, record: Handover, subject: string, routing?: RoutingFacts): Promise<boolean> {
  if (!record.pinSession || !recordedAgentOk(routing, record.agent)) return false
  const agent = routing ? (record.agent ?? routing.runAgent) : undefined
  const anchorClient = await clientOf(client, agent)
  if (!(await sessionAlive(anchorClient, record.pinSession))) return false
  let anchor: string | undefined
  // No readable history (MA.4): no anchor, whole-session fork (the fallback below).
  if (record.pinMessage && anchorClient.capabilities.history) {
    const got = await anchorClient.messages(record.pinSession)
    const list = got.ok ? got.value : []
    const at = list.findIndex((message) => message.id === record.pinMessage)
    anchor = at >= 0 ? list[at + 1]?.id : undefined
  }
  const forked = await forkSession(anchorClient, record.pinSession, subject, anchor)
  if (!forked) return false
  // The forked prefix's usage cannot be measured cheaply, so it is zeroed:
  // attempt already zeroes test.startUsed for non-reused sessions, and the
  // chain's later reuse decisions are overwritten by real usage once this
  // round ends. The wrap-up instruction is self-contained; no recovery note
  // is layered on top (that is for cold-start sessions to read).
  seedFork(chain, forked, { used: 0, agent })
  consumeNote(chain)
  return true
}

// Fork a whole still-alive session (F5, reconnecting its context when the
// continuation session was interrupted); returns false when unavailable, and
// the caller continues with a cold start.
async function seedSessionFork(client: ClientSource, chain: SessionChain, session: string, subject: string, agent?: string): Promise<boolean> {
  const sessionClient = await clientOf(client, agent)
  if (!(await sessionAlive(sessionClient, session))) return false
  const forked = await forkSession(sessionClient, session, subject)
  if (!forked) return false
  // Unknown (no readable history, MA.4) counts as 0 here, as a failed read does.
  seedFork(chain, forked, { used: (await sessionUsed(sessionClient, session).catch(() => 0)) ?? 0, agent })
  return true
}
