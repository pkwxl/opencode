// Unified commit after a session and execution-unit rollback: proxy-answer
// marker collection, the commit gate and unit close-out check, recovery
// fidelity (strict-resume activation check / model-consistency evaluation),
// and the runner-side orchestration of the rollback to the unit baseline.
// The session close-out itself (afterSession and its marker collection)
// and the git service's two instances moved into src/git-ops.ts — the
// service's opts-free home (see that file's header); afterSession stays
// re-exported below until the callers convert to the seam.
// Design in plans/0021-commit-boundary-design.md
// and plans/0022-session-recovery-fidelity-design.md.
// Sits below the session-driving layer: must not import session/watch/runner.
// Split out of src/runner.ts (plans/0024-module-split-plan.md S3, pure move).
import { rollbackUnit, type UnitBaseline } from "./git"
import { forgetHandover } from "./handover"
import { log } from "./log"
import { DEFAULT_CONTEXT_LIMIT, type Opts, type UnitStop } from "./opts"
import { createRouter, deadSessionWhy as deadWhyOf, resumeModelEligible as eligibleOf } from "./router"
import type { Task } from "./tasks"
import { resolvesOf, type ResolveItem } from "./resolve"
import { saveProgress, type Phase, type Progress } from "./resume"
import { autoSwitches, type ModelRole, type Switches } from "./switches"

// Questions get this autonomous reply when no human answers in time (or
// --wait-answer was not given for non-permission questions); only a repeated
// question on the same issue escalates to human intervention.
// The reply text is chosen per question-policy mode (OPENCODE_AUTO_ASK,
// plans/0020-auto-resolve-design.md §G):
// Both modes state that "this question was answered on the user's behalf": a
// divergence the user should have decided is closed by the driver because nobody
// is watching, so the session knows it is deciding for the user rather than
// making an ordinary decision of its own. Off (default) requires the decision to
// be marked AUTO-RESOLVE and kept distinct from AUTO-DECISION (the ledger relies
// on the session marking it); on, the question itself is a driver event and is
// fully logged, so no marking is asked for, and the text never says AUTO-DECISION
// so the session does not keep leaving marks out of habit.
// Exported so tests drive both texts directly (a testable exit for internal
// wiring).
export function autoAnswer(ask: boolean): string {
  const head =
    "This question was answered on the user's behalf: it was the user's call, but nobody is watching, so the driver closes it for them. " +
    "Decide how to proceed on your own, and if the current stage is already finished, move straight on to the next one. "
  if (ask) {
    return (
      head +
      "This run allows questions and the driver has fully logged this answer, so you need not record it anywhere; just carry on as answered."
    )
  }
  return (
    head +
    "Record the decision: write its reasoning and the alternatives you considered (and rejected) into the relevant document (a docs/ design document or report); " +
    "mark the decision in a design document or code comment with an `AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)` line, " +
    "not as `AUTO-DECISION` — that one is only for pure implementation choices that were always yours."
  )
}

// Unified commit after a session (the AI's commit right withdrawn, see
// src/git.ts): called once every session has ended and the driver finished
// its state writes (ticks and the like), recursively committing all changes
// — git history is the audit trail of AI changes, rollback granularity =
// the session. Skipped under --commit false and dryrun. The H4 guard (the
// marker collection is unaffected by the --commit false / dryrun early
// return) holds in the moved body. Conversion crutch: the function moved
// into src/git-ops.ts (the git service's opts-free home); this re-export
// keeps every importer compiling and is removed when the callers convert
// to the seam (the run services' git member).
export { afterSession } from "./git-ops"

// afterSession gate failure → the blocked exit (unit describes this unit,
// e.g. "T-001 subtask 2"): a failed commit is not considered completion —
// the blocking reason goes into the run log, loop's interrupted path retries
// the commit once to land it, and a second failure leaves the dirty worktree
// for human attention (exit code 2).
export function commitBlocked(unit: string, commit: { type: "failed"; question: string }): { type: "blocked"; question: string } {
  return { type: "blocked", question: `${unit}: output not committed, not considered complete — ${commit.question}` }
}

// The wrap-up session's proxy-answer list (auto-resolve H7,
// plans/0020-auto-resolve-design.md §I): the proxy-answered questions the
// driver observed in this task's ledger, injected into the wrap-up prompt
// via renderWrapup, which requires report.md to carry a dedicated
// "Proxy-answered questions" section — the part the driver saw is thereby
// forced into git, the persistent record no longer relying on the session's
// own diligence. Ledger read failures are always swallowed to empty (same
// as the loop side's three pinned blocks): auditing never affects flow or
// exit codes.
export async function wrapupResolves(dir: string | undefined, taskID: string): Promise<ResolveItem[]> {
  return await resolvesOf(dir, "task", taskID).catch(() => [])
}

// —— Recovery fidelity (plans/0022-session-recovery-fidelity-design.md, OPENCODE_AUTO_STRICT_RESUME) ——

// Whether strict resume is active: the switch on and the commit gate in
// place (--commit true and not dryrun). With the gate off, records carry no
// baseline/model fields and the check and rollback both idle entirely
// (byte-for-byte equal to the status quo). switches defaults to the parsed
// OPENCODE_AUTO_* value; injected for unit tests.
export function strictResumeActive(opts: Opts, switches: Switches = autoSwitches()): boolean {
  return switches.strictResume && opts.commit !== false && !opts.dryrun
}

// The model-consistency evaluation at resume (design 3.1 ④): the target a
// reused session's recorded model is judged against — the same routing
// decision the next dispatch takes, computed through the router service's
// routing fence (src/router.ts: under a registry a fresh selection over the
// routing facts, whose pick's internal name the record holds; without one
// the priority chain over the record's role and phase — a resume has no
// live chain, so those stand in for one, and modelOfChain's priority chain
// starts at the sticky holder — reading the router's holders). Returning
// undefined = no model routing currently configured (the record has nothing
// to hold either then; the check treats it as a mismatch). role is the
// session's explicit routing role (requireArtifact's spec.role, such as
// m-mode planning's implement-scan, plans/0053 D12); absent = derived from
// the phase. The holderless router fallback is exact: a run object that
// never knew routing state (a minimal test literal) reads every holder as
// unset, exactly as the optional chain read undefined before the fence.
export function resumeModelNow(opts: Opts, switches: Switches, phase: Phase | undefined, role?: ModelRole): string | undefined {
  return (opts.router ?? createRouter()).target(
    opts.routing,
    { pct: 100, used: 0, at: 0, role, phase },
    switches,
    opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT,
    opts.phase,
  )
}

// —— Session-agent binding of persisted records (plans/0055 §8.2, §8.3) ——
// The dual-path verdicts of this section live behind the routing fence in
// src/router.ts (recordedAgentOk, resumeModelEligible, deadSessionWhy):
// their no-registry guards are routing-truthiness branches. The exported
// helper signatures here stay stable — runner, artifact and exec-session
// call them with the session options — so each body is one fence call
// unwrapping opts (the facts pass through untested; the cap is the unit
// context limit the fence's selections ask with).

// The §10 item 11 eligibility of a strict resume under a registry
// (eligibility replaces equality — a window change that only moves the
// fresh pick does not roll a unit back); without a registry the fence
// answers false and the callers keep the raw-string comparison.
export function resumeModelEligible(opts: Opts, switches: Switches, recorded: string, phase?: Phase, role?: ModelRole): boolean {
  return eligibleOf(opts.routing, switches, opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT, opts.phase, recorded, phase, role)
}

// The §8.3 dead-session verdict of a resume record: a recorded session is
// resumed only if its agent is one this run can dispatch on and its
// recorded model is usable now; otherwise the session is dead and the
// resume takes the existing path of a new session with the resume note
// (under strict resume, the rollback path). Returns the reason for the
// log line; undefined = no verdict (without a registry, or a record that
// names nothing to check — a non-strict record carries no model, and
// eligibility then has nothing to judge).
export function deadSessionWhy(
  opts: Opts,
  switches: Switches,
  record: { agent?: string; model?: string; phase?: Phase },
  role?: ModelRole,
): string | undefined {
  return deadWhyOf(opts.routing, switches, opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT, opts.phase, record, role)
}

// The runner-side orchestration of the rollback protocol (design 3.3):
// rollbackUnit (stash preservation + soft reset retracting the driver
// commits) → the progress record to the summary state (baseline/model
// cleared) → the log records where the work went (the stash) and how to
// retrieve it. A failed rollback returns dirty (the decision over git state
// belongs to the human); on success the caller redoes this unit from a cold
// start (no resumeNote attached).
export async function rollbackUnitState(
  dir: string,
  task: Task,
  unit: string,
  baseline: UnitBaseline,
  extra: { progress?: Progress } = {},
): Promise<{ type: "ok" } | UnitStop> {
  const rolled = await rollbackUnit(dir, baseline, { task: task.id, unit })
  if (!rolled.ok) {
    return { type: "dirty", files: rolled.failures.map((failure) => `${failure.rel}: ${failure.error}`) }
  }
  // The in-flight test-handover record is voided together with the unit
  // rollback: the frozen commit and frozen anchor it points at belong to the
  // retracted unit; left in place, the redo would be picked up by the
  // recovery state machine as "continue the discarded handover" (redo the
  // wrap-up forked from the frozen point, run the freeze script against the
  // rolled-back tree) instead of redoing the whole unit from the baseline.
  await forgetHandover(dir)
  if (extra.progress) {
    await saveProgress(dir, { ...extra.progress, active: false, baseline: undefined, model: undefined })
  }
  log(
    `↻ ${task.id} ${unit} rolled back to unit baseline (stash ×${rolled.stashes}` +
      `${rolled.resets.length ? `, reset ${rolled.resets.join(", ")}` : ""}` +
      `${rolled.skipped.length ? `; stash only, no reset: ${rolled.skipped.join(", ")}` : ""}), re-running this unit from a clean baseline with a new session; ` +
      `the rolled-back work is kept in git stash (message prefix auto-rollback: git stash list, git stash show -p)`,
  )
  return { type: "ok" }
}
