// the main task loop (runTaskLoop): runAll's former closure turned into a
// top-level function, its captures made explicit as LoopCtx; ran accumulates
// across runTaskLoop calls (it decides whether --wait-between pauses before
// the first task of a later phase), hence a mutable field on ctx rather than
// a local.
// Beside it since plans/0068 S2: the serial isolation loop behind
// OPENCODE_AUTO_LANE_ISOLATION (one lane at a time, same selection) and the
// unit-scoped lane entry a spawned worker drives (runLaneUnit) — the loops
// above this module's imports drive the lane choreography of src/lanes.ts.
// Split out of src/loop.ts (plans/0024-module-split-plan.md S15, pure move;
// §I D14). Does not depend on loop.ts.
import { join } from "node:path"
import type { Control } from "./exit"
import { unitViolations, type GitOps, type UnitBaseline } from "./git"
import { hibernatePause } from "./hibernate"
import type { Interactive } from "./interactive"
import type { RunAllOpts } from "./loop-preflight"
import { waitBetweenTasks } from "./loop-progress"
import type { PlanInput } from "./plan-input"
import { taskEndLines, taskResolveLines } from "./conclusion"
import { banner, formatDuration, log } from "./log"
import { sessionOpts } from "./opts"
import { block, loadPlan, next, requireTask, taskStatePaths } from "./tasks"
import { phaseKey, routePhase, type PhaseUnit } from "./phases"
import { dispatchLane, laneExit, laneOutcome, lanePark, landLane, readLaneReport } from "./lanes"
import { recallProgress } from "./resume"
import { emitStatus } from "./run-status"
import { runTask } from "./runner"
import type { AgentPool } from "./agent-pool"
import type { RoutingFacts } from "./routing"
import type { Router } from "./router"
import { statsTask } from "./stats"
import { autoSwitches } from "./switches"
import { shellProfile } from "./shell"
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
}

// the main task loop: execute in turn all tasks in the current phase's task
// index (tasks.md) (subtasks/wrap-up/unified commit/progress recovery). phase
// is the current phase unit; its preset letter is passed through to runTask
// (the model-routing letter key, the decompose template choice). Returns 0 =
// all of this phase's tasks complete (the phase close-out is routed by
// runPhaseLoop), 2 = blocked/incomplete (the reason is in the run log).
export async function runTaskLoop(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  // Lane isolation (plans/0068 D10/S2, OPENCODE_AUTO_LANE_ISOLATION): the
  // whole task loop runs one lane at a time — every unit in its own worktree
  // through its own worker process, landed through the merge protocol, still
  // strictly serial. Full isolation machinery, zero concurrency; the serial
  // path below is untouched.
  if (autoSwitches().laneIsolation) return runIsolationLoop(ctx, phase)
  const { directory, opts, server: serverHandle, repl } = ctx
  for (;;) {
    const plan = await loadPlan(directory, phase)
    const task = next(plan)
    if (!task) {
      log("✓ all tasks complete")
      return 0
    }
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
    banner(`${task.id} ${task.title}`)
    log(`▶ ${task.id} starting execution (attempt ${task.attempts + 1})`)
    // The task bracket (P2b, src/run-status.ts): the task unit's start — the
    // gates above passed, beginUnit recorded the baseline, and the unit
    // transition itself was booked by begin() inside runTask.
    emitStatus({ type: "task-start", task: task.id, title: task.title })
    // the task-switch hook point (STATS_PLAN §3): reset the task bucket (when
    // the id changes) and clear the per-session map; the same id is
    // idempotent — an interruption resuming the same task neither resets nor
    // double-counts.
    await statsTask(directory, task.id)
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
        log(lines[1])
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
        log(lines[1])
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
        log(lines[1])
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
    // step pause (task boundary, OPENCODE_AUTO_STEP ≥ task): a hard pause
    // after the task's terminal commit and before the next task, Enter lets
    // it proceed. dir is passed so the pause wait is deducted from the timing
    // stats.
    await stepPause("task", `task ${task.id} ${task.title}`, { interactive: repl, dir: directory })
    // /exit checkpoint (task boundary): the request flag lives in the run's
    // control service on ctx, as the router state beside it does.
    ctx.control.maybeExit("task", `task ${task.id} ${task.title}`)
    // Hibernate window (task boundary, OPENCODE_AUTO_HIBERNATE): after the
    // final commit, a safe spot to check "are we inside the window now"; if
    // so, sleep until window end + random delay before continuing
    // (plans/0027-hibernate-design.md).
    await hibernatePause(`task ${task.id} ${task.title} boundary`, { dir: directory })
    // the /failback consumption point (task boundary): the chain was
    // destroyed with runTask, no chain.model to clear; apply the model-order
    // override (if any). Registry routing (plans/0055 §6.4): the chain's
    // destruction is also where the task-scope down marks clear — the marks
    // are run state, not chain state.
    ctx.router.clearDownMarks("task", autoSwitches().modelFailbackScope)
    ctx.router.consumeFailback()
  }
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
    banner(`${task.id} ${task.title}`)
    log(`▶ ${task.id} dispatching an isolation lane (attempt ${task.attempts + 1})`)
    // The task bracket (P2b): the unit's start — dispatch's begin() booked
    // the transition inside the spawned lane; the bucket switch is the
    // parent's, so the landed report books into the right task.
    emitStatus({ type: "task-start", task: task.id, title: task.title })
    await statsTask(directory, task.id)
    const start = Date.now()
    const dispatched = await dispatchLane(ctx.git, directory, task)
    if (dispatched.type === "failed") {
      log(`⏸ ${dispatched.error}`)
      emitStatus({ type: "task-end", task: task.id, outcome: "blocked", detail: dispatched.error })
      return 2
    }
    const exit = await laneExit(dispatched.worker)
    const report = await readLaneReport(dispatched.worktree)
    const outcome = laneOutcome(exit.code, report)
    if (outcome.kind === "land") {
      const landed = await landLane(ctx.git, directory, phase, task, outcome.report)
      if (landed.type === "conflict") {
        log(`⏸ ${task.id} landing conflict (the merge was aborted, the main tree is clean): ${landed.detail}. The lane scene is kept at ${lanePark(task.id)}; resolve the conflict manually or re-run to retry the lane in place`)
        emitStatus({ type: "task-end", task: task.id, outcome: "blocked", detail: `landing conflict: ${landed.detail}` })
        return 2
      }
      if (landed.type === "blocked") {
        log(`⏸ ${landed.error}`)
        emitStatus({ type: "task-end", task: task.id, outcome: "blocked", detail: landed.error })
        return 2
      }
      if (!landed.teardown) log(`⚠ ${task.id} landed, but the lane's park cleanup left something behind (see the warnings above); the lane record is cleared`)
      ctx.ran++
      for (const line of await taskResolveLines(directory, task.id)) log(line)
      log(`✓ ${task.id} done (lane landed: ${outcome.report.sessions} session(s), took ${formatDuration(Date.now() - start)})`)
      emitStatus({ type: "task-end", task: task.id, outcome: "completed" })
      // The task boundary hooks (§6.2: boundaries keep unit granularity — a
      // step pause or /exit stops scheduling and proceeds after the landing).
      await stepPause("task", `task ${task.id} ${task.title}`, { interactive: repl, dir: directory })
      ctx.control.maybeExit("task", `task ${task.id} ${task.title}`)
      await hibernatePause(`task ${task.id} ${task.title} boundary`, { dir: directory })
      ctx.router.clearDownMarks("task", autoSwitches().modelFailbackScope)
      ctx.router.consumeFailback()
      continue
    }
    if (outcome.kind === "blocked") {
      // Failure keeps its commit: land the blocked lane's committed work,
      // then stop scheduling and exit 2 naming the unit and its report.
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
      emitStatus({ type: "task-end", task: task.id, outcome: "blocked", detail: reason })
      return 2
    }
    if (outcome.kind === "environment") {
      // Environment errors are global: stop scheduling, exit 1 with the
      // relayed lines (D13's relay arrives with S4; the tail of the worker's
      // own output carries the reason meanwhile).
      log(`⏸ ${task.id} lane worker failed with an environment error (exit ${exit.code}); scheduling stops:`)
      for (const line of exit.output.trimEnd().split("\n").slice(-15).filter(Boolean)) log(`  ${line}`)
      emitStatus({ type: "failure", message: `${task.id} lane worker environment error (exit ${exit.code})` })
      emitStatus({ type: "task-end", task: task.id, outcome: "blocked", detail: `lane worker environment error (exit ${exit.code})` })
      return 1
    }
    // orphan: no report — the worker did not control its exit.
    log(`⏸ ${task.id} lane worker exited without a report (exit ${exit.code}); the scene is kept at ${lanePark(task.id)}. Re-run to re-dispatch the lane in the same worktree — it resumes from its own progress record`)
    emitStatus({ type: "task-end", task: task.id, outcome: "blocked", detail: `lane worker exited without a report (exit ${exit.code}); the scene is kept at ${lanePark(task.id)}` })
    return 2
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
// Every return is a controlled exit; the lane report is the caller's to
// write (runLaneWorker).
export async function runLaneUnit(ctx: LoopCtx): Promise<number> {
  const { directory, opts, server: serverHandle } = ctx
  const unit = opts.lane!.unit
  // A re-dispatched lane whose unit already completed in an earlier attempt
  // (killed between the unit's terminal commit and the parent's landing):
  // nothing to run — the report lands the finished work.
  if (await Bun.file(join(directory, taskStatePaths(unit).complete)).exists()) {
    log(`↻ ${unit} is already complete in this worktree; the lane has nothing to run`)
    return 0
  }
  const route = await routePhase(directory, { loadPlan, bin: shellProfile().bin })
  if (route.type !== "execute") {
    log(`⏸ lane worker: the worktree routes to ${route.type}, so the unit ${unit} cannot run here; re-dispatch it from the parent`)
    return 1
  }
  const plan = await loadPlan(directory, route.phase)
  const task = plan.tasks.find((entry) => entry.id === unit)
  if (!task) {
    log(`⏸ lane worker: ${plan.index} does not list ${unit}; re-dispatch it from the parent`)
    return 1
  }
  banner(`${task.id} ${task.title}`)
  log(`▶ ${task.id} lane worker: running the unit (attempt ${task.attempts + 1})`)
  await statsTask(directory, task.id)
  emitStatus({ type: "task-start", task: task.id, title: task.title })
  const taskBaseline = await ctx.git.unitBaseline(directory)
  const outcome = await runTask(serverHandle, plan, task, sessionOpts(ctx, { site: "task", phase: phaseKey(route.phase) }))
  if (outcome.type === "dirty") {
    log(`⏸ ${task.id} worktree not clean before the execution unit starts; handle it manually (commit/clean) and re-run:`)
    for (const file of outcome.files) log(`  ${file}`)
    emitStatus({ type: "task-end", task: task.id, outcome: "dirty", detail: outcome.files.join("; ") })
    return 2
  }
  if (outcome.type === "blocked" || outcome.type === "incomplete") {
    const reason = outcome.type === "blocked" ? outcome.question : outcome.reason
    if (outcome.type === "blocked") await block(directory, task.id)
    log(`⏸ ${task.id} ${outcome.type === "blocked" ? "is blocked (the reason is recorded only in this log)" : "incomplete, reverted to pending"}:\n${reason}`)
    for (const line of await taskResolveLines(directory, task.id)) log(line)
    const settled = await ctx.git.commitTree(directory, task, { stage: "interrupted", subject: `${task.id} ${outcome.type === "blocked" ? "blocked" : "pending"} ${task.title}` })
    if (!settled.ok) log(`⚠ interruption-scene commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}(changes kept in the worktree, handle manually)`)
    emitStatus({ type: "task-end", task: task.id, outcome: outcome.type, detail: reason })
    return 2
  }
  // completed: the terminal commit and the close-out check (the serial loop's
  // tail, over this worktree).
  for (const line of await taskResolveLines(directory, task.id)) log(line)
  const lines = await taskEndLines(directory, task.id)
  if (lines) {
    log(`✓ ${task.id} done: ${lines[0]}`)
    log(lines[1])
  } else {
    log(`✓ ${task.id} done`)
  }
  const settled = await ctx.git.commitTree(directory, task, { stage: "done", subject: `${task.id} done ${task.title}` })
  if (!settled.ok) {
    const failure = `${task.id} completed but the final unified commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}`
    log(`⏸ ${failure}. The task mark is still in the worktree; commit manually and re-run`)
    emitStatus({ type: "failure", message: failure })
    emitStatus({ type: "task-end", task: task.id, outcome: "blocked", detail: failure })
    return 2
  }
  emitStatus({ type: "task-end", task: task.id, outcome: "completed" })
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
