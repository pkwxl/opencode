// Unified commit after a session and execution-unit rollback: proxy-answer
// marker collection, the commit gate and unit close-out check, the refcheck
// hook-point gate, recovery fidelity (strict-resume activation check /
// model-consistency evaluation), and the runner-side orchestration of the
// rollback to the unit baseline. Design in plans/0021-commit-boundary-design.md
// and plans/0022-session-recovery-fidelity-design.md.
// Sits below the session-driving layer: must not import session/watch/runner.
// Split out of src/runner.ts (plans/0024-module-split-plan.md S3, pure move).
import { phaseToRole, resolveModel } from "./chain"
import { failbackOverride, stickyModel } from "./failback"
import { commitTree, rollbackUnit, unitViolations, type UnitBaseline } from "./git"
import { forgetHandover } from "./handover"
import { log, vlog } from "./log"
import { DEFAULT_CONTEXT_LIMIT, type Opts, type SessionCommit, type UnitStop } from "./opts"
import { currentRound } from "./phases"
import { candidateKey, nowOf, selectContext, type RoutingFacts } from "./routing"
import { select } from "./select"
import type { Task } from "./tasks"
import { autoCorrectRefs } from "./refcheck"
import { collectAgentResolves, resolvesOf, type ResolveItem } from "./resolve"
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
// Exported so tests drive both texts directly (same pattern as
// gatedAutoCorrectRefs: a testable exit for internal wiring).
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
// the session. Skipped under --commit false and dryrun.
// Before the commit, auto-corrects references (stable-refs P4, D6 first
// layer): rename pairs mechanically rewrite live-document references +
// broken-reference ⚠ log (the rewrites land in this same unified commit, no
// separate commit). Gated by OPENCODE_AUTO_REF_CHECK (refcheck-scope-design
// D3, default off = no-op). Exported for unit tests (H4 guard: collection is
// unaffected by the --commit false / dryrun early return).
export async function afterSession(
  dir: string | undefined,
  opts: Opts,
  task: { id: string; title: string },
  info: { stage: string; subject: string },
  baseline?: UnitBaseline,
): Promise<SessionCommit> {
  if (!dir) return { type: "ok" }
  // Proxy-answer marker collection (auto-resolve H4,
  // plans/0020-auto-resolve-design.md §G): hoisted **before** the
  // commit/dryrun early return — collection is auditing and must not depend
  // on the commit switch; in the on mode it degrades to a backstop (the
  // driver already logged everything on the event side), but markers the
  // session wrote voluntarily are still collected. Scans this session's
  // uncommitted changed files: AUTO-RESOLVE lands in the ledger,
  // AUTO-DECISION only returns a count.
  await collectSessionMarks(dir, opts, task, info.stage)
  if (opts.commit === false || opts.dryrun) return { type: "ok" }
  await gatedAutoCorrectRefs(dir, autoSwitches().refCheck)
  const result = await commitTree(dir, task, info)
  if (!result.ok) {
    return {
      type: "failed",
      question: `unified commit failed: ${result.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. Changes are left in the worktree; please handle git manually and re-run.`,
    }
  }
  if (baseline) {
    const violations = await unitViolations(dir, baseline)
    if (violations.length) return { type: "failed", question: `unit close-out check failed: ${violations.join("; ")}` }
  }
  return { type: "ok" }
}

// afterSession gate failure → the blocked exit (unit describes this unit,
// e.g. "T-001 subtask 2"): a failed commit is not considered completion —
// the blocking reason goes into the run log, loop's interrupted path retries
// the commit once to land it, and a second failure leaves the dirty worktree
// for human attention (exit code 2).
export function commitBlocked(unit: string, commit: { type: "failed"; question: string }): { type: "blocked"; question: string } {
  return { type: "blocked", question: `${unit}: output not committed, not considered complete — ${commit.question}` }
}

// The H4 collector: counts go only into the verbose log (vlog), never the
// terminal — AUTO-DECISION never competes with AUTO-RESOLVE for layout space
// (§H-④), while "the scan really ran, and how many markers it saw" stays
// traceable evidence. This task's highlight block is constructed on the loop
// side from the ledger (T-006); no terminal line is printed here. Ledger
// write failures are fully silent and collection itself must not affect
// flow or exit code either, hence one catch swallowing everything.
async function collectSessionMarks(
  dir: string,
  opts: Opts,
  task: { id: string },
  stage: string,
): Promise<void> {
  const found = await collectAgentResolves(dir, {
    task: task.id,
    phase: opts.phase?.id ?? "",
    round: await currentRound(dir).catch(() => 0),
  }).catch(() => undefined)
  if (!found) return
  if (found.resolves) vlog(`⚑ ${task.id} ${stage}: collected ${found.resolves} AUTO-RESOLVE marker(s)`)
  if (found.decisions) vlog(`ℹ ${task.id} ${stage}: recorded ${found.decisions} AUTO-DECISION entries`)
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

// The refcheck hook-point gate (refcheck-scope-design D3,
// OPENCODE_AUTO_REF_CHECK defaults to off): off makes the pre-commit
// auto-correct idle — zero reference-check behavior in the target directory;
// the check subcommand's reference-scan section is gated the same way in
// check.ts; the script/fix-refs.ts manual script bypasses the gate (a human
// executing it explicitly is equivalent to enabling it explicitly). Exported
// for unit tests (parseSwitches pure-function injection).
export async function gatedAutoCorrectRefs(dir: string, on: boolean): Promise<void> {
  if (on) await autoCorrectRefs(dir)
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

// The model-consistency evaluation at resume (design 3.1 ④): the same
// priority chain attempt uses to compute the target for a reused session
// (the chain's failover candidates do not exist at resume, so it takes
// sticky > the /failback override > the routing table). Returning undefined
// = no model routing currently configured (the record has nothing to hold
// either then; the check treats it as a mismatch).
// role is the session's explicit routing role (requireArtifact's spec.role,
// such as m-mode planning's implement-scan, plans/0053 D12). The dispatch
// routed by it, since an explicit role wins over the phase (roleOf), so the
// check must derive the same role; absent = derived from the phase.
// Under a model registry (plans/0055 §6.2, §10 item 11) the comparison runs
// on internal names: the record holds the dispatched entry's internal name
// (attempt writes it), and this returns the selection's pick for the same
// routing — a fresh-prompt selection, the same shape the next dispatch takes.
// The strict check itself no longer uses this pick under a registry: with the
// session-agent binding in place it compares the recorded internal name and
// agent by eligibility (resumeModelEligible / deadSessionWhy below), so a
// window change alone does not roll a unit back; without a registry the
// raw-string comparison against this value is unchanged.
// AUTO-DECISION: the registry path selects with no context windows (the live limits belong to the agent this function never sees); an unknown window never excluded a candidate on the no-registry path either, so the comparison keeps its shape
export function resumeModelNow(opts: Opts, switches: Switches, phase: Phase | undefined, role?: ModelRole): string | undefined {
  if (opts.routing) {
    const decision = select(selectContext(opts.routing, switches, opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT), {
      role: role ?? phaseToRole(phase) ?? "bypass",
      entry: opts.phase?.entry,
      now: nowOf(opts.routing),
      continuation: false,
    })
    return decision.kind === "pick" ? candidateKey(decision.candidate) : undefined
  }
  return stickyModel() ?? failbackOverride()?.wildcard ?? resolveModel(switches.model, opts.phase?.entry, role ?? phaseToRole(phase) ?? "bypass")
}

// —— Session-agent binding of persisted records (plans/0055 §8.2, §8.3) ——

// Does a recorded session id belong to an agent this run can dispatch on?
// `routing` undefined = no registry (no verdict, every record passes). Under
// a registry the recorded agent (absent = the run's start profile, the shape
// every pre-binding record reads as) must name a profile the registry knows
// — or be the run's start agent itself, which may run profile-less when the
// registry holds no profile of the chosen adapter — and its adapter must
// pass the agent filter: session ids are agent-local (F3), and a filtered-out
// agent's model is never a candidate, so its sessions are never resumed nor
// forked (plans/0055 §8.3).
export function recordedAgentOk(routing: RoutingFacts | undefined, recorded: string | undefined): boolean {
  if (routing === undefined) return true
  const agent = recorded ?? routing.runAgent
  const adapter =
    routing.registry.agents.get(agent)?.adapter ??
    (agent === routing.runAgent ? (routing.agentFilter ?? routing.defaultAgent) : undefined)
  return adapter !== undefined && (routing.agentFilter === undefined || adapter === routing.agentFilter)
}

// The §10 item 11 eligibility of a strict resume under a registry: the
// recorded internal name is judged by eligibility, not equality. Selection is
// asked exactly as the dispatch a resumed session takes — a continuation over
// the recorded model (§6.2 keeps the chain's model while it is usable) — and
// the recorded model must be what it keeps. So a window change that only
// moves the fresh pick (an earlier candidate's window reopening), a reordered
// list or a returned primary does not roll a unit back; a model that is
// marked down, outside its windows, excluded by the agent filter or gone from
// the registry is not eligible. Without a registry the callers keep the
// raw-string comparison (this helper answers false; it is not for them).
export function resumeModelEligible(opts: Opts, switches: Switches, recorded: string, phase?: Phase, role?: ModelRole): boolean {
  const facts = opts.routing
  if (facts === undefined) return false
  const decision = select(selectContext(facts, switches, opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT), {
    role: role ?? phaseToRole(phase) ?? "bypass",
    entry: opts.phase?.entry,
    now: nowOf(facts),
    continuation: true,
    current: recorded,
  })
  return decision.kind === "pick" && candidateKey(decision.candidate) === recorded
}

// The §8.3 dead-session verdict of a resume record under a registry: a
// recorded session is resumed only if its agent is one this run can dispatch
// on and its recorded model is usable now; otherwise the session is dead and
// the resume takes the existing path of a new session with the resume note
// (under strict resume, the rollback path). Returns the reason for the log
// line; undefined = no verdict (without a registry, or a record that names
// nothing to check — a non-strict record carries no model, and eligibility
// then has nothing to judge).
export function deadSessionWhy(
  opts: Opts,
  switches: Switches,
  record: { agent?: string; model?: string; phase?: Phase },
  role?: ModelRole,
): string | undefined {
  const routing = opts.routing
  if (routing === undefined) return undefined
  if (!recordedAgentOk(routing, record.agent)) {
    return `the recorded session lives on agent ${record.agent ?? routing.runAgent}, which this run does not dispatch on${routing.agentFilter ? ` (agent filter ${routing.agentFilter})` : " (no such agent profile)"}`
  }
  if (record.model !== undefined && !resumeModelEligible(opts, switches, record.model, record.phase, role)) {
    return `the recorded session's model ${record.model} is not usable now`
  }
  return undefined
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
