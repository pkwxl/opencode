// Unified commit after a session and execution-unit rollback: proxy-answer
// marker collection, the commit gate and unit close-out check, recovery
// fidelity (strict-resume activation check / model-consistency evaluation),
// and the runner-side orchestration of the rollback to the unit baseline.
// The session close-out itself (afterSession and its marker collection)
// and the git service's two instances live in src/git-ops.ts — the
// service's opts-free home (see that file's header); the callers reach it
// through the run's git service (the seam on the services holder or the
// Opts.git carrier).
// Design in plans/0021-commit-boundary-design.md
// and plans/0022-session-recovery-fidelity-design.md.
// Sits below the session-driving layer: must not import session/watch/runner.
// Split out of src/runner.ts (plans/0024-module-split-plan.md S3, pure move).
import { rollbackUnit, type UnitBaseline } from "./git"
import { gitOf } from "./git-ops"
import { forgetHandover } from "./handover"
import { log } from "./log"
import { DEFAULT_CONTEXT_LIMIT, type Opts, type UnitStop } from "./opts"
import { implicitRegistry } from "./models"
import { createRouter, deadSessionWhy as deadWhyOf, resumeModelEligible as eligibleOf, type RouteFacts } from "./router"
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

// Whether strict resume is active: the switch on, the run's git service
// recording (git-ops.ts gitOf resolves the opts carrier, else the
// holderless production instance; the no-commit double answers false,
// keeping the record fields unwritten — the commit gate's former off
// path), and not dryrun. With records off, records carry no baseline/model
// fields and the check and rollback both idle entirely (byte-for-byte
// equal to the status quo). switches defaults to the parsed
// OPENCODE_AUTO_* value; injected for unit tests.
export function strictResumeActive(opts: Opts, switches: Switches = autoSwitches()): boolean {
  return switches.strictResume && gitOf(opts).records && !opts.dryrun
}

// The routing facts of a session-options literal: the opts' own for a run,
// else the implicit registry over the given switch snapshot (the holderless
// corner — a minimal test literal that never knew routing; the facts read
// the opts' router carrier when it has one, else a fresh holderless router,
// exactly the fallback the resume checks kept for the router alone).
function factsOf(opts: Opts, switches: Switches): RouteFacts {
  const agent = switches.agent ?? "opencode"
  return (
    opts.routing ?? {
      registry: implicitRegistry(agent, switches.model),
      agentFilter: switches.agent,
      defaultAgent: agent,
      runAgent: agent,
      router: opts.router ?? createRouter(),
      clock: { now: () => Date.now() },
    }
  )
}

// The model-consistency evaluation at resume (design 3.1 ④): the target a
// reused session's recorded model is judged against — the same routing
// decision the next dispatch takes, a fresh selection over the routing
// facts, whose pick's internal name the record holds (a resume has no live
// chain, so a minimal view over the record's role and phase stands in for
// one). Returning undefined = no candidate usable now (the check treats it
// as a mismatch). role is the session's explicit routing role
// (requireArtifact's spec.role, such as m-mode planning's implement-scan,
// plans/0053 D12); absent = derived from the phase.
export function resumeModelNow(opts: Opts, switches: Switches, phase: Phase | undefined, role?: ModelRole): string | undefined {
  const facts = factsOf(opts, switches)
  return facts.router.target(facts, { pct: 100, used: 0, at: 0, role, phase }, switches, opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT, opts.phase)
}

// —— Session-agent binding of persisted records (plans/0055 §8.2, §8.3) ——
// The verdicts of this section live in src/router.ts (recordedAgentOk,
// resumeModelEligible, deadSessionWhy). The exported helper signatures here
// stay stable — runner, artifact and exec-session call them with the session
// options — so each body is one verdict call unwrapping opts (the cap is
// the unit context limit the selections ask with).

// The §10 item 11 eligibility of a strict resume (eligibility replaces
// equality — a window change that only moves the fresh pick does not roll a
// unit back).
export function resumeModelEligible(opts: Opts, switches: Switches, recorded: string, phase?: Phase, role?: ModelRole): boolean {
  return eligibleOf(factsOf(opts, switches), switches, opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT, opts.phase, recorded, phase, role)
}

// The §8.3 dead-session verdict of a resume record: a recorded session is
// resumed only if its agent is one this run can dispatch on and its
// recorded model is usable now; otherwise the session is dead and the
// resume takes the existing path of a new session with the resume note
// (under strict resume, the rollback path). Returns the reason for the
// log line; undefined = no verdict (a record that names nothing to check —
// a non-strict record carries no model, and eligibility then has nothing
// to judge).
export function deadSessionWhy(
  opts: Opts,
  switches: Switches,
  record: { agent?: string; model?: string; phase?: Phase },
  role?: ModelRole,
): string | undefined {
  return deadWhyOf(factsOf(opts, switches), switches, opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT, opts.phase, record, role)
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
