// the main task loop (runTaskLoop): runAll's former closure turned into a
// top-level function, its captures made explicit as LoopCtx; ran accumulates
// across runTaskLoop calls (it decides whether --wait-between pauses before
// the first task of a later phase), hence a mutable field on ctx rather than
// a local.
// Beside it since plans/0068 S2: the serial isolation loop behind
// OPENCODE_AUTO_LANE_ISOLATION (one lane at a time, same selection) and the
// unit-scoped lane entry a spawned worker drives (runLaneUnit). Since S3 the
// task loop's first branch is the readiness scheduler's concurrent lane loop
// (runLaneLoop, D10's activation rule) — the loops above this module's
// imports drive the lane choreography of src/lanes.ts. Since 0069 §2.2 D5's
// merge (T-125) the three shapes share their scaffolding through the helpers
// below runTaskLoop: taskBracket (the unit-start bracket), taskBoundary (the
// task-boundary hook set) and handleLaneExit (the shared lane-exit arms).
// Split out of src/loop.ts (plans/0024-module-split-plan.md S15, pure move;
// §I D14). Does not depend on loop.ts.
import { relative } from "node:path"
import { join } from "node:path"
import { closeUnit } from "./close"
import type { Control } from "./exit"
import { parseUnitDoc } from "./document/unit"
import { subtaskStateSpec } from "./document/spec"
import { currentBranch, repoRoots, unitViolations, type GitOps, type UnitBaseline } from "./git"
import { mergeLaneUpstream } from "./git"
import { hibernatePause } from "./hibernate"
import type { Interactive } from "./interactive"
import type { RunAllOpts } from "./loop-preflight"
import { waitBetweenTasks } from "./loop-progress"
import type { PlanInput } from "./plan-input"
import { taskEndLines, taskResolveLines } from "./conclusion"
import { banner, formatDuration, log } from "./log"
import { sessionOpts } from "./opts"
import { block, loadPlan, next, requireTask, taskStatePaths, unitAttempts, type Plan, type Task } from "./tasks"
import { phaseKey, routePhase, type PhaseUnit } from "./phases"
import {
  conflictRepair,
  dispatchLane,
  laneEligible,
  laneExit,
  laneOutcome,
  lanePark,
  landLane,
  LANE_DISPATCH_CAP,
  orphanRedispatch,
  readyUnits,
  readLaneReport,
  schedulerActive,
  streamUnitOf,
  streamUnits,
  type InFlightLane,
  type LaneReport,
  type LaneRuntime,
} from "./lanes"
import { recallProgress } from "./resume"
import { emitStatus } from "./run-status"
import { runTask } from "./runner"
import type { AgentPool } from "./agent-pool"
import type { RoutingFacts } from "./routing"
import type { Router } from "./router"
import { statsTask } from "./stats"
import { autoSwitches } from "./switches"
import { shellProfile, type LaneWorker } from "./shell"
import { stepPause } from "./step"

export type LoopCtx = {
  directory: string
  opts: RunAllOpts
  // The run's agent pool (plans/0055 §8.1): one host per agent profile under
  // a registry, the one started host without one. runTask resolves each
  // dispatch's client from the chain's agent through it.
  server: AgentPool
  agentName: string
  phases: string
  // The no-phase mode (phases = "m"): the single phase P01-implement is manual —
  // no handover session, the phase stays open (plans/0047 L2), and a planning
  // session runs only on a planning input (plans/0053 D12).
  manual: boolean
  repl?: Interactive
  // the count of already-run tasks, accumulated across runTaskLoop calls
  // (§I D14): it decides whether --wait-between pauses before the first task
  // of a later phase; demoting it to a function local would zero it on every
  // call (a behavior change), hence a mutable field on ctx.
  ran: number
  // The planning input this run was given (plans/0053 D9), consumed by the
  // first planning step, which persists it to its phase's plan-input.md.
  input?: PlanInput
  // plan --append (plans/0053 D23): the input appends tasks to the phase the
  // route names now instead of planning a fresh one (m mode implies it from an
  // input on a non-empty index). Seeded from RunAllOpts.append; an append step
  // consumes ctx.input, which is what keeps the intent single-use.
  append?: boolean
  // The task ids the last planning step wrote, for plan's summary when it
  // stops after that step (plans/0053 D6).
  planned?: string[]
  // The run's registry routing facts (plans/0055 §6): the loaded registry
  // with the agent filter and the default agent, threaded into the opts every
  // session of the loop runs with; undefined = no registry, dispatch is
  // unchanged.
  routing?: RoutingFacts
  // The run's router service (the routing decision state: the failback
  // holders, the down marks), threaded beside the routing facts: the loop's
  // boundary hooks (the failback and /failback consumption points) call it,
  // and every opts literal the loop builds carries it on to the commit
  // boundary's resume checks. The loop fills it from the installed services
  // (an entry module); the pipeline below reads it only through ctx or opts.
  router: Router
  // The run's control service (the /exit request and its sleepers), threaded
  // the same way: the task boundary's /exit checkpoint below calls it, and
  // the opts literal handed to runTask carries it on to the subtask
  // boundary's checkpoint.
  control: Control
  // The run's git service (the commit-side seam), threaded the same way:
  // the loop family's unit-boundary commit calls go through it, and every
  // opts literal the loop builds carries it on to the task pipeline's
  // commit calls. The loop fills it from the installed services (an entry
  // module); the pipeline below reads it only through ctx or opts.
  git: GitOps
  // false = the run's agents cannot fork, so auto's lead runs without its
  // split clause (plans/0059 D7); set once at run start by the degradation.
  leadSplit?: false
  // The repair rounds this run has driven (plans/0079 §4): incremented as a
  // round opens, read against opts.repair (the budget). Run state only,
  // nothing persists it — an interrupted or re-run process starts a fresh
  // budget, like every other run-side width fact.
  repairs: number
}

// the main task loop: execute in turn all tasks in the current phase's task
// index (tasks.md) (subtasks/wrap-up/unified commit/progress recovery). phase
// is the current phase unit; its preset letter is passed through to runTask
// (the model-routing letter key, the decompose template choice). Returns 0 =
// all of this phase's tasks complete (the phase close-out is routed by
// runPhaseLoop), 2 = blocked/incomplete (the reason is in the run log).
// Branches before the serial path (plans/0068): the readiness scheduler's
// concurrent lane loop when D10's activation rule holds, and the serial
// isolation loop behind the rollout switch.
export async function runTaskLoop(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  // Lane isolation (plans/0068 D10/S2, OPENCODE_AUTO_LANE_ISOLATION): the
  // whole task loop runs one lane at a time — every unit in its own worktree
  // through its own worker process, landed through the merge protocol, still
  // strictly serial. Full isolation machinery, zero concurrency; the serial
  // path below is untouched.
  // AUTO-DECISION (S3, the branch order): the switch outranks the scheduler —
  // an experiment switch that pins "one lane at a time" is the more specific
  // intent than the run's --max-sessions width, so a run asking both gets
  // isolation (the switch exists precisely to force the serial lane shape).
  if (autoSwitches().laneIsolation) return runIsolationLoop(ctx, phase)
  // The readiness scheduler (plans/0068 §6.2, S3, D10): active iff
  // maxSessions ≥ 2 and the project configured a parallel level — the units
  // of the routed phase run concurrently, each isolated in its own lane.
  if (schedulerActive(ctx.opts.maxSessions, ctx.opts.parallel)) return runLaneLoop(ctx, phase)
  const { directory } = ctx
  for (;;) {
    const plan = await loadPlan(directory, phase)
    const task = next(plan)
    if (!task) {
      log("✓ all tasks complete")
      return 0
    }
    const code = await runSerialUnit(ctx, phase, plan, task)
    if (code !== 0) return code
  }
}

// —— The shared loop scaffolding (0069 §2.2 D5's merge) —— //

// The task bracket (P2b, src/run-status.ts) every loop shape opens at its
// unit's start, with the task-switch hook point (STATS_PLAN §3) beside it:
// the banner, the shape's own dispatch line (the lead — "starting
// execution", "dispatching an isolation lane", "dispatching a lane", the
// lane worker's own), the task-start event, then the stats bucket switch —
// reset the task bucket when the id changes and clear the per-session map;
// the same id is idempotent, an interruption resuming the same task neither
// resets nor double-counts.
// AUTO-DECISION (the lane worker's site adopts the event-then-bucket order):
// runLaneUnit historically switched the bucket before emitting task-start,
// the only one of the four sites to do so; the two side effects share no
// channel (the status event goes to the emitter's sinks, the bucket switch
// to the stats store), so normalizing the order is what lets one bracket
// serve all four sites with byte-identical observable behavior.
async function taskBracket(directory: string, unit: string, title: string, lead: string, attempts: number): Promise<void> {
  banner(`${unit} ${title}`)
  log(`▶ ${unit} ${lead} (attempt ${attempts + 1})`)
  emitStatus({ type: "task-start", task: unit, title })
  await statsTask(directory, unit)
}

// The task-boundary hook set (§6.2: boundaries keep unit granularity) every
// loop shape runs after a unit's close-out:
//   - step pause (task boundary, OPENCODE_AUTO_STEP ≥ task): a hard pause
//     after the terminal commit and before the next unit, Enter lets it
//     proceed. dir is passed so the pause wait is deducted from the timing
//     stats.
//   - /exit checkpoint: the request flag lives in the run's control service
//     on ctx, as the router state beside it does.
//   - hibernate window (task boundary, OPENCODE_AUTO_HIBERNATE): after the
//     final commit, a safe spot to check "are we inside the window now"; if
//     so, sleep until window end + random delay before continuing
//     (plans/0027-hibernate-design.md).
//   - the /failback consumption point: the chain was destroyed with the
//     unit's pipeline, no chain.model to clear; apply the model-order
//     override (if any). Registry routing (plans/0055 §6.4): the chain's
//     destruction is also where the task-scope down marks clear — the marks
//     are run state, not chain state.
// exitProbe: the scheduler's drain rule — under concurrency a /exit seen at
// a landing stops dispatching and takes effect only after the last lane
// lands (maybeExit would throw mid-drain and abandon in-flight work), so
// the lane loop probes the request and records the label instead of
// checkpointing here; the drain's end performs the deferred exit.
async function taskBoundary(ctx: LoopCtx, label: string, exitProbe?: () => void): Promise<void> {
  const { directory, repl } = ctx
  await stepPause("task", label, { interactive: repl, dir: directory })
  if (exitProbe === undefined) ctx.control.maybeExit("task", label)
  else if (ctx.control.exitRequested()) exitProbe()
  await hibernatePause(`${label} boundary`, { dir: directory })
  ctx.router.clearDownMarks("task", autoSwitches().modelFailbackScope)
  ctx.router.consumeFailback()
}

// What one lane exit means for the loop that held it (§6.2's failure matrix
// in the parent's hands): land = the loop's own landing protocol proceeds
// (the report rides along); orphan = D14's protocol decides — the isolation
// loop keeps the scene for a re-run, the scheduler re-dispatches under the
// cap; stop = the loop's exit code (2 = a blocked unit, 1 = a global
// environment error).
type LaneExitAction = { kind: "land"; report: LaneReport } | { kind: "orphan" } | { kind: "stop"; code: number }

// The lane-exit handling both lane loops share (0069 D5's merge): the 0067
// bus's lane identity (§6.7) first — the exit is a parent-level structured
// event, the code beside whether a report was found (false is the orphan
// signal) and its verdict — then the failure matrix's two shared arms:
//   blocked     → failure keeps its commit: land the blocked lane's
//                 committed work, mark the unit blocked, stop scheduling
//                 and exit 2 naming the unit and its report;
//   environment → global: stop scheduling, exit 1 with the relayed lines —
//                 every line the worker printed was relayed as it arrived
//                 (D13); the tail repeats the last of them at the failure
//                 point.
// The land and orphan arms are the loops' own: the landing protocol differs
// (the isolation loop's zero-repair posture vs D21's level-derived repair)
// and so does the orphan policy (keep the scene vs the capped re-dispatch).
async function handleLaneExit(ctx: LoopCtx, phase: PhaseUnit, task: Pick<Task, "id" | "title">, exit: { code: number; output: string }, worktree: string): Promise<LaneExitAction> {
  const { directory } = ctx
  const report = await readLaneReport(worktree)
  emitStatus({ type: "lane-exit", lane: task.id, code: exit.code, report: report !== undefined, ...(report?.result !== undefined ? { result: report.result } : {}) })
  const outcome = laneOutcome(exit.code, report)
  if (outcome.kind === "blocked") {
    const landed = await landLane(ctx.git, directory, phase, task, outcome.report)
    if (landed.type === "conflict") {
      log(`⏸ ${task.id} blocked and its landing hit a conflict (the merge was aborted, the main tree is clean): ${landed.detail}. The lane scene is kept at ${lanePark(task.id)}`)
    } else if (landed.type === "blocked") {
      log(`⏸ ${task.id} blocked and its landing failed: ${landed.error}`)
    } else {
      log(`✓ ${task.id} blocked: its committed work landed (the reason is in the lane's report and log)`)
    }
    await block(directory, task.id)
    const reason = outcome.report.blocked ?? `the task report concluded Result: ${outcome.report.result ?? "FAIL"}`
    log(`⏸ ${task.id} is blocked (the reason is recorded only in this log):\n${reason}`)
    for (const line of await taskResolveLines(directory, task.id)) log(line)
    emitStatus({ type: "lane-block", lane: task.id, reason })
    emitStatus({ type: "task-end", task: task.id, outcome: "blocked", detail: reason })
    return { kind: "stop", code: 2 }
  }
  if (outcome.kind === "environment") {
    log(`⏸ ${task.id} lane worker failed with an environment error (exit ${exit.code}); scheduling stops:`)
    for (const line of exit.output.trimEnd().split("\n").slice(-15).filter(Boolean)) log(`  ${line}`)
    emitStatus({ type: "failure", message: `${task.id} lane worker environment error (exit ${exit.code})` })
    emitStatus({ type: "task-end", task: task.id, outcome: "blocked", detail: `lane worker environment error (exit ${exit.code})` })
    return { kind: "stop", code: 1 }
  }
  return outcome.kind === "land" ? { kind: "land", report: outcome.report } : { kind: "orphan" }
}

// One unit through today's serial path (the main-tree execution the task loop
// has always run, and D4's serial degrade for a unit that cannot be isolated
// — a lane-ineligible `Touches` declaration under the scheduler). Pure move
// out of runTaskLoop's body (S3): every line is the serial loop's own, in its
// order; the byte-identical floor depends on it. Returns 0 = the unit closed,
// keep scheduling; anything else = the loop's exit code.
async function runSerialUnit(ctx: LoopCtx, phase: PhaseUnit, plan: Plan, task: Task): Promise<number> {
  const { directory, opts, server: serverHandle, repl } = ctx
  // no wait before the first task; pause between tasks only when a
  // successor exists.
  if (ctx.ran > 0 && opts.waitBetween) await waitBetweenTasks(opts.waitBetween, task.id, repl, directory)
  if (task.status === "blocked") {
    log(`↻ ${task.id} was blocked previously, resuming directly (block reason in the previous run's log)`)
  }
  // the task unit commit boundary (plans/0021-commit-boundary-design.md
  // P3): the start clean gate + SHA baseline. An active progress record = a
  // resumed continuation (the worktree carries this unit's own progress,
  // handover documents included), exempt from clean while still recording
  // the baseline; after the done terminal commit the baseline drives the
  // close-out check (the commit range must be all driver commits).
  // Driver-exclusive state file leftovers self-heal through beginUnit's
  // carryover.
  let taskBaseline: UnitBaseline | undefined
  {
    const recalled = await recallProgress(directory, task.id)
    if (recalled?.active === true) {
      if (!opts.dryrun) taskBaseline = await ctx.git.unitBaseline(directory)
    } else {
      const gate = await ctx.git.beginUnit(directory, opts, task)
      if (gate.type === "dirty") {
        log(`⏸ ${task.id} worktree not clean before startup; to ensure the execution unit starts on a clean baseline, handle it manually (commit or clean) and re-run:`)
        for (const file of gate.files) log(`  ${file}`)
        emitStatus({ type: "task-end", task: task.id, outcome: "dirty", detail: gate.files.join("; ") })
        return 2
      }
      taskBaseline = gate.baseline
    }
  }
  // The task bracket (P2b, src/run-status.ts): the task unit's start — the
  // gates above passed, beginUnit recorded the baseline, and the unit
  // transition itself was booked by begin() inside runTask.
  await taskBracket(directory, task.id, task.title, "starting execution", task.attempts)
  const start = Date.now()
  const outcome = await runTask(serverHandle, plan, task, sessionOpts(ctx, { site: "task", phase: phaseKey(phase) }))
  if (outcome.type === "dirty") {
    // Unit-startup clean gate failure (runTask inner layer): no state
    // write, no sweep-up commit — the git state decision belongs to the
    // human (plans/0021-commit-boundary-design.md).
    log(`⏸ ${task.id} worktree not clean before the execution unit starts (suspected leftover from an abandoned run or manual changes); handle it manually (commit/clean) and re-run:`)
    for (const file of outcome.files) log(`  ${file}`)
    emitStatus({ type: "task-end", task: task.id, outcome: "dirty", detail: outcome.files.join("; ") })
    return 2
  }
  if (outcome.type === "blocked") {
    // The repair round (plans/0079 §4): a FAIL verdict with budget left
    // automates the person's documented rework path — closeUnit the failed
    // task (done for scheduling, the Closed: field recording the round), then
    // hand the phase loop the evidence as an append input: its append branch
    // (the same one plan --append drives) adds the repair tasks, which run in
    // index order after the remaining work and re-verify. Every judgment
    // stays the driver's — the verdict was parsed from the report, the close
    // is the driver's own mechanism, and the appended tasks are planned work.
    // Any refusal (explicit dependents without cascade, a dirty tree) or a
    // spent budget falls through to today's block.
    if (outcome.repair !== undefined && ctx.opts.stopBefore !== "execute" && (ctx.opts.repair ?? 0) > ctx.repairs) {
      ctx.repairs++
      const reason = `repair round ${ctx.repairs}: the task report concluded Result: FAIL${outcome.repair.reason ? ` (${outcome.repair.reason})` : ""}`
      const closed = await closeUnit(directory, task.id, { reason, phases: ctx.phases, acceptanceGate: ctx.opts.acceptanceGate })
      for (const line of closed.lines) log(`  ${line}`)
      if (closed.type === "closed") {
        emitStatus({ type: "task-end", task: task.id, outcome: "blocked", detail: `${reason}; a repair round appends rework tasks (${ctx.repairs}/${ctx.opts.repair})` })
        log(`↻ ${task.id}: ${reason}; the phase loop appends repair tasks over the report's evidence (round ${ctx.repairs} of ${ctx.opts.repair})`)
        ctx.input = {
          text:
            `Repair round ${ctx.repairs}: the task ${task.id} was closed — its report docs/${task.id}/report.md concluded ` +
            `Result: FAIL${outcome.repair.reason ? ` (${outcome.repair.reason})` : ""}. Read that report and the task's documents for what it ` +
            `left unfinished or broken, then append repair tasks that finish the work: cover the remaining acceptance, fix what the report found, ` +
            `and have the last task re-verify so the phase's verdict is rewritten honestly.`,
        }
        ctx.append = true
        ctx.ran++
        return 0
      }
      log(`⏸ the repair round could not close ${task.id}; blocking as usual`)
    }
    await block(directory, task.id)
    log(`⏸ ${task.id} is blocked (the reason is recorded only in this log):\n${outcome.question}`)
    // the proxy-answer highlight block (plans/0020-auto-resolve-design.md
    // §H-②, H5): pinned above the conclusion line. Printed for all three
    // states, and unaffected by the stats guard (a blocked task may equally
    // have had several questions proxy-answered already).
    for (const line of await taskResolveLines(directory, task.id)) log(line)
    // the task three-state line (STATS_PLAN §4.2, T-006): blocked also
    // prints the cumulative stats segment + the tokens line (not printed
    // when the guard fails, consistent with the pre-T-006 behavior —
    // originally only done had a stats line).
    const lines = await taskEndLines(directory, task.id)
    if (lines) {
      log(`⏸ ${task.id} blocked: ${lines[0]}`)
      for (const line of lines.slice(1)) log(line)
    }
    // Commit the interruption scene too: preserve the breakpoint (the
    // unit's in-flight work) so it can be rolled back to.
    // Commit failure (typically the unified commit rejected by the
    // environment) is only escalated to a warning — already on the way to
    // exit 2, changes stay in the worktree for manual handling. The
    // run's git seam carries the strategy: on the no-commit double the
    // ok answer keeps this warning dead.
    const settledBlocked = await ctx.git.commitTree(directory, task, { stage: "interrupted", subject: `${task.id} blocked ${task.title}` })
    if (!settledBlocked.ok) log(`⚠ interruption-scene commit failed: ${settledBlocked.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}(changes kept in the worktree, handle manually)`)
    emitStatus({ type: "task-end", task: task.id, outcome: "blocked", detail: outcome.question })
    return 2
  }
  if (outcome.type === "incomplete") {
    log(`⏸ ${task.id} incomplete, reverted to pending. Improve this task's description in docs/${task.id}/todo.md and re-run:\n${outcome.reason}`)
    for (const line of await taskResolveLines(directory, task.id)) log(line)
    const lines = await taskEndLines(directory, task.id)
    if (lines) {
      log(`⏸ ${task.id} incomplete: ${lines[0]}`)
      for (const line of lines.slice(1)) log(line)
    }
    const settledPending = await ctx.git.commitTree(directory, task, { stage: "interrupted", subject: `${task.id} pending ${task.title}` })
    if (!settledPending.ok) log(`⚠ interruption-scene commit failed: ${settledPending.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}(changes kept in the worktree, handle manually)`)
    emitStatus({ type: "task-end", task: task.id, outcome: "incomplete", detail: outcome.reason })
    return 2
  }
  {
    for (const line of await taskResolveLines(directory, task.id)) log(line)
    const lines = await taskEndLines(directory, task.id)
    if (lines) {
      log(`✓ ${task.id} done: ${lines[0]}`)
      for (const line of lines.slice(1)) log(line)
    } else {
      // Guard failure (stats not loaded / bucket identity mismatch) falls
      // back to the pre-T-006 wording.
      log(`✓ ${task.id} done (took ${formatDuration(Date.now() - start)})`)
    }
  }
  ctx.ran++
  // the terminal commit of task completion: the todo.md → done.md rename
  // and the tasks.md tick are booked here together (each session's output
  // was committed with its session; this is the close-out).
  // the completion-condition check (plans/0021-commit-boundary-design.md):
  // terminal commit failure → exit 2 for human attention (the task mark is
  // already in the worktree; after the human commits and re-runs, the next
  // task starts on a clean baseline); after the commit succeeds, the task
  // baseline drives the close-out check (the commit range must be all driver
  // commits, an external commit is an isolation break). The run's git seam
  // carries the strategy: on the no-commit double the ok answer and the
  // empty baseline keep both failure paths dead.
  const settled = await ctx.git.commitTree(directory, task, { stage: "done", subject: `${task.id} done ${task.title}` })
  if (!settled.ok) {
    log(
      `⏸ ${task.id} completed but the final unified commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. ` +
        `The task mark is still in the worktree; commit manually and re-run`,
    )
    // A close-out violation (the failure vocabulary's own row): the task's
    // work finished, but the run stops for the human — blocked, with the
    // close-out failure as both the task-end detail and the failure event.
    const failure = `${task.id} completed but the final unified commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}`
    emitStatus({ type: "failure", message: failure })
    emitStatus({ type: "task-end", task: task.id, outcome: "blocked", detail: failure })
    return 2
  }
  // The unit's work closed out (the terminal commit landed; the done.md
  // rename and the index tick were booked inside runTask's pipeline) — the
  // bracket closes before the isolation check below, which only reports.
  emitStatus({ type: "task-end", task: task.id, outcome: "completed" })
  if (taskBaseline) {
    const violations = await unitViolations(directory, taskBaseline)
    if (violations.length) {
      log(`⏸ ${task.id} unit close-out check failed (task counts as done, but the isolation boundary has been violated; investigate manually):`)
      for (const problem of violations) log(`  ${problem}`)
      emitStatus({ type: "failure", message: `${task.id} unit close-out check failed (isolation boundary violated): ${violations.join("; ")}` })
      return 2
    }
  }
  // the task-boundary hook set (step pause, /exit checkpoint, hibernate
  // window, /failback consumption — taskBoundary's own comment carries the
  // plans).
  await taskBoundary(ctx, `task ${task.id} ${task.title}`)
  return 0
}

// —— Lane isolation, serial (plans/0068 §7 S2, D10) —— //

// The one-lane-at-a-time task loop behind OPENCODE_AUTO_LANE_ISOLATION: the
// same shape as the serial loop above — loadPlan → next() → one unit at a
// time — except each unit runs as a lane (a worktree in the park plus a
// spawned worker process) and lands through D7's protocol before the next
// dispatch. The parent never drives a task session (D4); the main tree stays
// clean between landings by construction, which is what the landing gate and
// the kill property stand on. The lane exit feeds §6.2's failure matrix:
//   land        → land (D7), mark done, continue scheduling;
//   blocked     → land the blocked lane's committed work (failure keeps its
//                 commit), stop scheduling, exit 2 naming the unit and report;
//   environment → global: stop scheduling, exit 1 with the relayed lines;
//   orphan      → the worker exited without a report (crash, kill): keep the
//                 scene and exit 2 naming the park path — a re-run
//                 re-dispatches the lane in the same worktree, resuming from
//                 its own progress record (D14; the preflight orphan scan and
//                 the automatic re-dispatch are S3's).
// A landing conflict blocks immediately (the D21 `low` posture — zero session
// repairs); the level-derived repair budget is S3's wiring.
// AUTO-DECISION (0069 D5's "isolation loop = lane loop with slots=1"
// suggestion, ruled off): the further collapse is rejected — the two loops
// differ in five behavior deltas a slots=1 parameterization would have to
// thread: the conflict posture (zero repairs here vs D21's level-derived
// repair in the scheduler), the orphan policy (keep the scene for a re-run
// here vs D14's capped in-place re-dispatch there), the wait-between
// placement (before dispatch here vs after each landing there), the
// blocked-resume line (only this loop logs it), and the done-log wording
// (the attempt duration here vs the completed/unit-done split there);
// holding the byte-identical floor through a five-way parameterized merge is
// not trivial, so the D5 merge stops at the shared brackets, boundary hooks
// and lane-exit handling (taskBracket/taskBoundary/handleLaneExit above).
async function runIsolationLoop(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const { directory, opts, repl } = ctx
  for (;;) {
    const plan = await loadPlan(directory, phase)
    const task = next(plan)
    if (!task) {
      log("✓ all tasks complete")
      return 0
    }
    // no wait before the first lane; pause between lanes only when a
    // successor exists (the boundary granularity is the lane, §6.2).
    if (ctx.ran > 0 && opts.waitBetween) await waitBetweenTasks(opts.waitBetween, task.id, repl, directory)
    if (task.status === "blocked") {
      log(`↻ ${task.id} was blocked previously, resuming directly (block reason in the previous run's log)`)
    }
    // The task bracket (P2b): the unit's start — dispatch's begin() booked
    // the transition inside the spawned lane; the bucket switch is the
    // parent's, so the landed report books into the right task.
    await taskBracket(directory, task.id, task.title, "dispatching an isolation lane", task.attempts)
    const start = Date.now()
    const dispatched = await dispatchLane(ctx.git, directory, task)
    if (dispatched.type === "failed") {
      log(`⏸ ${dispatched.error}`)
      emitStatus({ type: "task-end", task: task.id, outcome: "blocked", detail: dispatched.error })
      return 2
    }
    const exit = await laneExit(dispatched.worker, dispatched.output)
    const action = await handleLaneExit(ctx, phase, task, exit, dispatched.worktree)
    if (action.kind === "land") {
      const landed = await landLane(ctx.git, directory, phase, task, action.report)
      if (landed.type === "conflict") {
        log(`⏸ ${task.id} landing conflict (the merge was aborted, the main tree is clean): ${landed.detail}. The lane scene is kept at ${lanePark(task.id)}; resolve the conflict manually or re-run to retry the lane in place`)
        emitStatus({ type: "lane-block", lane: task.id, reason: `landing conflict: ${landed.detail}` })
        emitStatus({ type: "task-end", task: task.id, outcome: "blocked", detail: `landing conflict: ${landed.detail}` })
        return 2
      }
      if (landed.type === "blocked") {
        log(`⏸ ${landed.error}`)
        emitStatus({ type: "lane-block", lane: task.id, reason: landed.error })
        emitStatus({ type: "task-end", task: task.id, outcome: "blocked", detail: landed.error })
        return 2
      }
      if (!landed.teardown) log(`⚠ ${task.id} landed, but the lane's park cleanup left something behind (see the warnings above); the lane record is cleared`)
      ctx.ran++
      for (const line of await taskResolveLines(directory, task.id)) log(line)
      log(`✓ ${task.id} done (lane landed: ${action.report.sessions} session(s), took ${formatDuration(Date.now() - start)})`)
      emitStatus({ type: "task-end", task: task.id, outcome: "completed" })
      // The task boundary hooks (§6.2: boundaries keep unit granularity — a
      // step pause or /exit stops scheduling and proceeds after the landing).
      await taskBoundary(ctx, `task ${task.id} ${task.title}`)
      continue
    }
    if (action.kind === "stop") return action.code
    // orphan: no report — the worker did not control its exit.
    log(`⏸ ${task.id} lane worker exited without a report (exit ${exit.code}); the scene is kept at ${lanePark(task.id)}. Re-run to re-dispatch the lane in the same worktree — it resumes from its own progress record`)
    emitStatus({ type: "lane-block", lane: task.id, reason: `lane worker exited without a report (exit ${exit.code}); the scene is kept at ${lanePark(task.id)}` })
    emitStatus({ type: "task-end", task: task.id, outcome: "blocked", detail: `lane worker exited without a report (exit ${exit.code}); the scene is kept at ${lanePark(task.id)}` })
    return 2
  }
}

// —— The readiness scheduler (plans/0068 §6.2, stage S3) —— //

// One lane the scheduler holds in flight: the unit's task, the spawned
// worker, the worktree it runs in, and the prefix relay's full-text promise
// (D13) — attached at dispatch, several lanes share the loop's attention,
// and a stream nobody reads until the exit would deadlock the worker on a
// full pipe; the relay's incremental read is the drain, and every line it
// reads reaches the parent's log prefixed as it arrives.
type LiveLane = { task: Task; worker: LaneWorker; output: Promise<string>; worktree: string }

// The task loop behind D10's activation rule (maxSessions ≥ 2 and a parallel
// level): load plan → ready set (D5) → dispatch up to the slots → await any
// exit → land (serialized; this single-threaded await is the mutex) → the
// boundary hooks at each landing → repeat until the phase's schedulable units
// are done. Every execution unit goes through a lane (D4, uniform lanes): the
// parent drives no task session of its own while lanes are in flight — the
// one exception is D15's serial degrade (a unit whose declared `Touches`
// reach a nested-repo root cannot be isolated and runs in the main tree
// through today's path, alone, after all lanes have drained).
// §6.2's failure matrix at each exit:
//   land        → land (D7), mark done, continue scheduling;
//   blocked     → land the blocked lane's committed work (failure keeps its
//                 commit), stop scheduling, exit 2 naming the unit and report;
//   environment → global: stop scheduling, exit 1 with the relayed lines;
//   orphan      → the worker exited without a report (crash, kill; the pid is
//                 dead — this run held the exit): re-dispatch in place,
//                 resuming through its own progress record, up to the attempts
//                 cap (D14); the cap or an unownable scene blocks naming the
//                 park path.
// A landing conflict is level-derived (D21): `low` blocks immediately with
// the park path named; `medium`/`high` re-dispatch the lane once with D7's
// merge instruction and a second conflict blocks.
// Boundaries keep unit granularity: a step pause or a /exit stops scheduling
// and drains — the /exit takes effect (throws) only after the last lane
// landed, so in-flight work is never abandoned by the boundary itself.
// Phases serialize (D20): this loop drains completely before it returns, and
// the phase loop routes nothing of the next phase until it does.
async function runLaneLoop(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const { directory, opts, repl } = ctx
  const slots = Math.max(1, opts.maxSessions ?? 1)
  const inFlight = new Map<string, LiveLane>()
  // The units that used their one merge repair (D21's budget, per unit per
  // scheduler run — a re-run starts with a fresh budget).
  const repaired = new Set<string>()
  // false = no new lanes are dispatched (a block, an environment error, a
  // step pause or /exit, a dispatch failure): the in-flight lanes drain.
  let scheduling = true
  // The run's terminal stop once set (the first failure wins; later ones are
  // logged but do not move the exit code) — returned after the drain.
  let stop: number | undefined
  // The /exit label the drain ends at: set when the request is seen at a
  // landing boundary; thrown (maybeExit) after the last lane lands.
  let exitLabel: string | undefined
  // D15's nested-repo roots, repository-relative — the lane-eligibility test.
  const nestedRoots = (await repoRoots(directory)).filter((root) => root !== directory).map((root) => relative(directory, root))

  // S5 (D3 stage 2, §6.8): the schedulable set with taken splits expanded —
  // a task whose lead's split was taken contributes its stream units
  // (T-NNN.S<nn>) while any stream is pending; with every stream done the
  // task itself returns as the closing lane (the pipeline tail: wrap-up +
  // close-out). A task without a split record stays whole, exactly as
  // before. The expansion also collects each stream's seed — the owning
  // task's split record, planted into the fresh lane worktree at dispatch —
  // and the done flags of finished streams, which the readiness predicate
  // reads through the merged states.
  const seeds = new Map<string, { task: string; split: UnitBaseline }>()
  const expandStreams = async (plan: Plan): Promise<Task[]> => {
    seeds.clear()
    const out: Task[] = []
    for (const unit of plan.tasks) {
      if (unit.status === "done") {
        out.push(unit)
        continue
      }
      const streams = await streamUnits(directory, unit)
      if (streams === undefined) {
        out.push(unit)
        continue
      }
      if (unit.split !== undefined) for (const stream of streams) seeds.set(stream.id, { task: unit.id, split: unit.split })
      out.push(...(streams.some((stream) => stream.status !== "done") ? streams : [unit]))
    }
    return out
  }

  // The ready set of one pass over the reloaded plan (D5's predicate with the
  // current in-flight lanes): done = the merged unit states (a landed
  // stream's done.md included, through the expansion), runtime = the
  // registry's executing entries.
  const readyNow = async (inFlightLanes: ReadonlyMap<string, InFlightLane>): Promise<Task[]> => {
    const plan = await loadPlan(directory, phase)
    const units = await expandStreams(plan)
    const states = new Set(units.filter((unit) => unit.status === "done").map((unit) => unit.id))
    const runtime = new Map<string, LaneRuntime>()
    for (const task of plan.tasks) if (task.status === "in_progress") runtime.set(task.id, { status: "in_progress" })
    return readyUnits({ ...plan, tasks: units }, states, runtime, inFlightLanes, slots)
  }

  // Dispatch one lane for a ready unit: the bracket lines, the bookkeeping
  // and the spawn. Returns false when the dispatch failed (the caller stops
  // scheduling and exits 2 naming the error). A stream unit's dispatch seeds
  // its fresh worktree with the owning task's split record (S5).
  const dispatch = async (task: Task): Promise<boolean> => {
    await taskBracket(directory, task.id, task.title, "dispatching a lane", task.attempts)
    const dispatched = await dispatchLane(ctx.git, directory, task, undefined, seeds.get(task.id))
    if (dispatched.type === "failed") {
      log(`⏸ ${dispatched.error}`)
      emitStatus({ type: "task-end", task: task.id, outcome: "blocked", detail: dispatched.error })
      return false
    }
    inFlight.set(task.id, { task, worker: dispatched.worker, worktree: dispatched.worktree, output: dispatched.output })
    return true
  }

  // The landing of one exited lane (the land outcome). Returns true when the
  // run may keep scheduling (the lane landed, or the one repair re-dispatched
  // it); false when the run must stop (exit 2 — the landing conflict blocked,
  // the landing itself failed, or the repair's dispatch failed).
  const land = async (lane: LiveLane, report: LaneReport): Promise<boolean> => {
    const task = lane.task
    const landed = await landLane(ctx.git, directory, phase, task, report)
    if (landed.type === "conflict") {
      if (stop === undefined && conflictRepair(opts.parallel) && !repaired.has(task.id)) {
        // D21's one repair (medium/high): re-dispatch the lane with D7's
        // merge instruction — the worker merges the parent's current main
        // branch into the lane branch and exits normally; landing retries.
        // The scene the conflict kept is exactly the re-dispatch's reuse.
        const main = await currentBranch(directory)
        if (main === undefined) {
          log(`⏸ ${task.id} landing conflict (the merge was aborted, the main tree is clean): ${landed.detail}. The main tree's HEAD is detached, so no merge instruction can name a branch; the lane scene is kept at ${lanePark(task.id)} for manual repair`)
          emitStatus({ type: "task-end", task: task.id, outcome: "blocked", detail: `landing conflict: ${landed.detail}` })
          return false
        }
        repaired.add(task.id)
        log(`↻ ${task.id} landing conflict (the merge was aborted, the main tree is clean): ${landed.detail} — the parallel level ${opts.parallel} allows one repair; re-dispatching the lane with the merge instruction (merge ${main} into the lane branch, resolve, exit normally)`)
        const again = await dispatchLane(ctx.git, directory, task, { merge: main })
        if (again.type === "failed") {
          log(`⏸ ${again.error}`)
          emitStatus({ type: "task-end", task: task.id, outcome: "blocked", detail: again.error })
          return false
        }
        inFlight.set(task.id, { task, worker: again.worker, worktree: again.worktree, output: again.output })
        return true
      }
      // `low`, the budget spent, or already stopping: block with the park
      // path named (D21 — zero further repairs).
      const budget = conflictRepair(opts.parallel) ? `the one repair is spent` : `the parallel level ${opts.parallel ?? "none"} spends no tokens on merge repair`
      log(`⏸ ${task.id} landing conflict (the merge was aborted, the main tree is clean): ${landed.detail}; ${budget}. The lane scene is kept at ${lanePark(task.id)}; resolve it manually in the park worktree or re-run to retry the lane in place`)
      emitStatus({ type: "lane-block", lane: task.id, reason: `landing conflict: ${landed.detail} (${budget})` })
      emitStatus({ type: "task-end", task: task.id, outcome: "blocked", detail: `landing conflict: ${landed.detail}` })
      return false
    }
    if (landed.type === "blocked") {
      log(`⏸ ${landed.error}`)
      emitStatus({ type: "lane-block", lane: task.id, reason: landed.error })
      emitStatus({ type: "task-end", task: task.id, outcome: "blocked", detail: landed.error })
      return false
    }
    if (!landed.teardown) log(`⚠ ${task.id} landed, but the lane's park cleanup left something behind (see the warnings above); the lane record is cleared`)
    // S5: a landed lane may close its unit without completing the task — a
    // lead that stopped at its taken split, one stream of a split. The
    // merged state decides (the owning task's done.md); the bracket's task
    // stays open until the closing lane's own landing completes it.
    const owner = streamUnitOf(task.id)?.task ?? task.id
    const completed = await Bun.file(join(directory, taskStatePaths(owner).complete)).exists()
    const firstLanding = ctx.ran === 0
    ctx.ran++
    for (const line of await taskResolveLines(directory, owner)) log(line)
    if (completed) {
      log(`✓ ${task.id} done (lane landed: ${report.sessions} session(s))`)
      emitStatus({ type: "task-end", task: task.id, outcome: "completed" })
    } else {
      log(`✓ ${task.id} landed (lane unit closed; the task continues in its other lanes — ${report.sessions} session(s))`)
      emitStatus({ type: "task-end", task: task.id, outcome: "unit-done" })
    }
    // The boundary hooks at each landing (§6.2: unit granularity — a step
    // pause or /exit stops scheduling and drains, then proceeds): the probe
    // form of the /exit checkpoint — the request seen here stops dispatching
    // and takes effect after the last lane lands (taskBoundary's comment).
    await taskBoundary(ctx, `task ${task.id} ${task.title}`, () => {
      scheduling = false
      exitLabel = `task ${task.id} ${task.title}`
    })
    // --wait-between pauses between landings (D11's parent-side surfaces:
    // the lane boundary is the landing) — never before the first, mirroring
    // the isolation loop's between-lanes pause.
    // AUTO-DECISION (wired here rather than left to S4): D11 lists the pause
    // among the surfaces that REMAIN under concurrency, so leaving it
    // silently dead under maxSessions ≥ 2 would contradict the ruling; S4's
    // boundary item stays about the relay/observability around it.
    if (!firstLanding && opts.waitBetween) await waitBetweenTasks(opts.waitBetween, task.id, repl, directory)
    return true
  }

  for (;;) {
    // Fill the free slots: dispatch the ready, lane-eligible units (D5's
    // order — index; the batch is mutually disjoint).
    if (scheduling && inFlight.size < slots) {
      const lanes = new Map<string, InFlightLane>()
      for (const lane of inFlight.values()) lanes.set(lane.task.id, { touches: lane.task.touches })
      for (const task of (await readyNow(lanes)).filter((unit) => laneEligible(unit, nestedRoots))) {
        if (inFlight.size >= slots) break
        if (!(await dispatch(task))) {
          scheduling = false
          stop = 2
          break
        }
      }
    }
    // Nothing in flight: the drain is done (or never started) — return, run
    // the serial degrade, or the phase is complete.
    if (inFlight.size === 0) {
      if (stop !== undefined || exitLabel !== undefined) {
        // A /exit seen at a landing takes effect here, after the drain —
        // maybeExit throws (runAll maps it to exit 3); scheduling had
        // already stopped at the landing that saw the request.
        if (exitLabel !== undefined) ctx.control.maybeExit("task", exitLabel)
        return stop ?? 0
      }
      const plan = await loadPlan(directory, phase)
      const task = next(plan)
      if (!task) {
        log("✓ all tasks complete")
        return 0
      }
      // D4's serial degrade: with the slots free and nothing lane-eligible
      // ready, the ready units are exactly the not-isolable ones (a declared
      // `Touches` reach under a nested-repo root, D15). The first runs in the
      // main tree through today's path — alone, after all lanes drained. A
      // not-isolable STREAM degrades as its whole task (the remaining
      // streams run in-lane, serially, exactly the serial world's path).
      const units = await expandStreams(plan)
      const states = new Set(units.filter((unit) => unit.status === "done").map((unit) => unit.id))
      const ineligible = readyUnits({ ...plan, tasks: units }, states, new Map(), new Map(), 1).find((unit) => !laneEligible(unit, nestedRoots))
      const serial = ineligible === undefined ? undefined : plan.tasks.find((entry) => entry.id === (streamUnitOf(ineligible.id)?.task ?? ineligible.id))
      if (serial === undefined) {
        // Unreachable with a checked graph and nothing executing: every
        // not-done unit has an unmet dependency forever. Stop rather than
        // spin.
        log(`⏸ ${task.id} is not ready and nothing is executing; the dependency graph cannot progress — fix the task index manually and re-run`)
        emitStatus({ type: "task-end", task: task.id, outcome: "blocked", detail: "not ready with nothing executing" })
        return 2
      }
      log(`▶ ${serial.id} cannot be isolated (its declared Touches reach a nested repository); running it serially in the main tree after the lanes drained (D15)`)
      const code = await runSerialUnit(ctx, phase, plan, serial)
      if (code !== 0) return code
      continue
    }
    // Await any lane's exit (raced; the relay's drain is already running).
    const first = await Promise.race([...inFlight.values()].map((lane) => lane.worker.exited.then((code) => ({ lane, code }))))
    inFlight.delete(first.lane.task.id)
    const exit = { code: typeof first.code === "number" ? first.code : 137, output: await first.lane.output }
    const action = await handleLaneExit(ctx, phase, first.lane.task, exit, first.lane.worktree)
    if (action.kind === "land") {
      if (!(await land(first.lane, action.report))) {
        scheduling = false
        if (stop === undefined) stop = 2
      }
      continue
    }
    if (action.kind === "stop") {
      scheduling = false
      if (stop === undefined) stop = action.code
      continue
    }
    // orphan: the worker exited without a report (crash, kill). The pid is
    // dead — this run held the exit. D14: the shared re-dispatch decision
    // (lanes.ts orphanRedispatch — the same rule preflight's recovery
    // re-dispatches under) says "again" while the attempts stay under the
    // cap and the drain is not already stopping; the re-dispatch resumes
    // through its own progress record, and a "keep" keeps the scene and
    // blocks naming the park path.
    const unit = first.lane.task
    const again = orphanRedispatch(await unitAttempts(directory, unit.id), stop === undefined)
    if (again.type === "again") {
      log(`↻ ${unit.id} lane worker exited without a report (exit ${exit.code}); re-dispatching the lane in place — it resumes from its own progress record (attempt ${again.attempt} of ${LANE_DISPATCH_CAP})`)
      const dispatched = await dispatchLane(ctx.git, directory, unit)
      if (dispatched.type === "failed") {
        log(`⏸ ${dispatched.error}`)
        emitStatus({ type: "task-end", task: unit.id, outcome: "blocked", detail: dispatched.error })
        scheduling = false
        stop = 2
      } else {
        inFlight.set(unit.id, { task: unit, worker: dispatched.worker, worktree: dispatched.worktree, output: dispatched.output })
      }
      continue
    }
    const why = again.why
    log(`⏸ ${unit.id} lane worker exited without a report (exit ${exit.code}) and ${why}; the scene is kept at ${lanePark(unit.id)}`)
    emitStatus({ type: "lane-block", lane: unit.id, reason: `lane worker exited without a report (exit ${exit.code}) and ${why}; the scene is kept at ${lanePark(unit.id)}` })
    emitStatus({ type: "task-end", task: unit.id, outcome: "blocked", detail: `lane worker exited without a report (exit ${exit.code}); the scene is kept at ${lanePark(unit.id)}` })
    scheduling = false
    if (stop === undefined) stop = 2
  }
}

// —— The lane entry (plans/0068 §6.3) —— //

// The unit-scoped run a lane worker drives (runAll with opts.lane set, called
// from loop.ts once the services are installed): the worktree's own routing
// finds the phase, the named unit runs through the existing runTask
// unchanged, and the close-out mirrors the serial loop's — the terminal
// commit, the close-out check over this run's baseline, the interruption
// scene on the blocked/incomplete paths. The human boundaries (step pause,
// hibernate, wait-between) stay parent-side: a lane boundary is the parent's
// lane boundary (§6.2), and a /exit inside a lane ends that lane (D12).
// A repair re-dispatch (opts.lane.merge, D7's conflict path) first merges the
// named parent branch into the lane branch — one of the lane's own commits,
// trailer-bearing — ahead of everything else (the repair's unit is typically
// already complete, and the landing retry needs the merged branch whatever
// the unit runs); a conflict the driver cannot merge aborts clean and blocks
// the lane naming it (the semantic resolution a session would perform over
// the conflicted tree is future wiring; inventing an automatic resolution is
// exactly what D21 rejects).
// Every return is a controlled exit; the lane report is the caller's to
// write (runLaneWorker).
export async function runLaneUnit(ctx: LoopCtx): Promise<number> {
  const { directory, opts, server: serverHandle } = ctx
  const unit = opts.lane!.unit
  const instruction = opts.lane!.merge
  // S5 (D3 stage 2, §6.8): a stream unit `T-NNN.S<nn>` scopes the whole
  // entry to that one checklist item — the task pipeline runs it through
  // opts.stream (the single-subtask path, D19's cold start), the plan lookup
  // and the stats bucket key by the unit id while the pipeline itself works
  // on the owning task. A task unit (a lead, a closing lane) runs unchanged.
  const stream = streamUnitOf(unit)
  // D7's merge instruction (a conflict repair's re-dispatch only), ahead of
  // the routing and the already-complete short-circuit below: the repair
  // exists for the landing, and the landing needs the merged branch whether
  // or not the unit still has work. The title is read straight off the unit
  // document — before routing there is no plan to read it from, and the
  // commit subject is the merge's only use of it.
  if (instruction !== undefined) {
    const doc =
      (await Bun.file(join(directory, taskStatePaths(unit).complete)).text().catch(() => undefined)) ??
      (await Bun.file(join(directory, taskStatePaths(unit).pending)).text().catch(() => ""))
    const merged = await mergeLaneUpstream(directory, instruction, { id: unit, title: parseUnitDoc(doc).title || unit })
    if (merged.type === "conflict") {
      log(`⏸ ${unit} the repair merge of ${instruction} into the lane branch conflicts (${merged.detail}); the merge was aborted, the worktree is clean — the lane cannot resolve the conflict on its own`)
      emitStatus({ type: "task-end", task: unit, outcome: "blocked", detail: `repair merge conflict with ${instruction}: ${merged.detail}` })
      return 2
    }
    if (merged.type === "failed") {
      log(`⏸ ${unit} the repair merge of ${instruction} into the lane branch failed: ${merged.error}`)
      emitStatus({ type: "task-end", task: unit, outcome: "blocked", detail: `repair merge with ${instruction} failed: ${merged.error}` })
      return 2
    }
    log(`✓ ${unit} merged ${instruction} into the lane branch (the repair of the landing conflict)`)
  }
  // A re-dispatched lane whose unit already completed in an earlier attempt
  // (killed between the unit's terminal commit and the parent's landing):
  // nothing to run — the report lands the finished work. A stream's state
  // file is the fact (a last stream whose wrap-up was interrupted lands the
  // same way: the closing lane takes the tail).
  if (stream !== undefined) {
    if (await Bun.file(join(directory, subtaskStateSpec(stream.task, stream.index).complete.path)).exists()) {
      log(`↻ ${unit} is already complete in this worktree; the lane has nothing to run`)
      return 0
    }
  } else if (await Bun.file(join(directory, taskStatePaths(unit).complete)).exists()) {
    log(`↻ ${unit} is already complete in this worktree; the lane has nothing to run`)
    return 0
  }
  const route = await routePhase(directory, { loadPlan, bin: shellProfile().bin })
  if (route.type !== "execute") {
    log(`⏸ lane worker: the worktree routes to ${route.type}, so the unit ${unit} cannot run here; re-dispatch it from the parent`)
    return 1
  }
  const plan = await loadPlan(directory, route.phase)
  const task = plan.tasks.find((entry) => entry.id === (stream?.task ?? unit))
  if (!task) {
    log(`⏸ lane worker: ${plan.index} does not list ${stream?.task ?? unit}; re-dispatch it from the parent`)
    return 1
  }
  // The task bracket (P2b): the lane worker's own unit start (the
  // event-then-bucket order, taskBracket's AUTO-DECISION above).
  await taskBracket(directory, unit, task.title, `lane worker: running the ${stream !== undefined ? "stream" : "unit"}`, task.attempts)
  const taskBaseline = await ctx.git.unitBaseline(directory)
  const outcome = await runTask(serverHandle, plan, task, sessionOpts(ctx, { site: "task", phase: phaseKey(route.phase), ...(stream !== undefined ? { stream: stream.index } : {}) }))
  if (outcome.type === "dirty") {
    log(`⏸ ${unit} worktree not clean before the execution unit starts; handle it manually (commit/clean) and re-run:`)
    for (const file of outcome.files) log(`  ${file}`)
    emitStatus({ type: "task-end", task: unit, outcome: "dirty", detail: outcome.files.join("; ") })
    return 2
  }
  if (outcome.type === "blocked" || outcome.type === "incomplete") {
    const reason = outcome.type === "blocked" ? outcome.question : outcome.reason
    if (outcome.type === "blocked") await block(directory, unit)
    log(`⏸ ${unit} ${outcome.type === "blocked" ? "is blocked (the reason is recorded only in this log)" : "incomplete, reverted to pending"}:\n${reason}`)
    for (const line of await taskResolveLines(directory, task.id)) log(line)
    const settled = await ctx.git.commitTree(directory, task, { stage: "interrupted", subject: `${unit} ${outcome.type === "blocked" ? "blocked" : "pending"} ${task.title}` })
    if (!settled.ok) log(`⚠ interruption-scene commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}(changes kept in the worktree, handle manually)`)
    emitStatus({ type: "task-end", task: unit, outcome: outcome.type, detail: reason })
    return 2
  }
  if (outcome.type === "unit-done") {
    // S5: the lane's unit closed without completing the task — a lead that
    // stopped at its taken split, one stream of a split. Its work is
    // committed (the lead's exec commit, the subtask close-out), the report
    // lands it, and the task goes on in other lanes; only the close-out
    // check remains, over this worktree.
    log(`✓ ${unit} closed (the task continues in its other lanes)`)
    if (taskBaseline.length) {
      const violations = await unitViolations(directory, taskBaseline)
      if (violations.length) {
        log(`⏸ ${unit} unit close-out check failed (the lane landed, but the isolation boundary has been violated; investigate manually):`)
        for (const problem of violations) log(`  ${problem}`)
        emitStatus({ type: "failure", message: `${unit} unit close-out check failed (isolation boundary violated): ${violations.join("; ")}` })
        return 2
      }
    }
    return 0
  }
  // completed: the terminal commit and the close-out check (the serial loop's
  // tail, over this worktree).
  for (const line of await taskResolveLines(directory, task.id)) log(line)
  const lines = await taskEndLines(directory, task.id)
  if (lines) {
    log(`✓ ${task.id} done: ${lines[0]}`)
    for (const line of lines.slice(1)) log(line)
  } else {
    log(`✓ ${task.id} done`)
  }
  const settled = await ctx.git.commitTree(directory, task, { stage: "done", subject: `${task.id} done ${task.title}` })
  if (!settled.ok) {
    const failure = `${task.id} completed but the final unified commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}`
    log(`⏸ ${failure}. The task mark is still in the worktree; commit manually and re-run`)
    emitStatus({ type: "failure", message: failure })
    emitStatus({ type: "task-end", task: unit, outcome: "blocked", detail: failure })
    return 2
  }
  emitStatus({ type: "task-end", task: unit, outcome: "completed" })
  if (taskBaseline.length) {
    const violations = await unitViolations(directory, taskBaseline)
    if (violations.length) {
      log(`⏸ ${task.id} unit close-out check failed (task counts as done, but the isolation boundary has been violated; investigate manually):`)
      for (const problem of violations) log(`  ${problem}`)
      emitStatus({ type: "failure", message: `${task.id} unit close-out check failed (isolation boundary violated): ${violations.join("; ")}` })
      return 2
    }
  }
  // A /exit the lane's sessions requested ends the lane here (D12).
  ctx.control.maybeExit("task", `task ${task.id} ${task.title}`)
  return 0
}
