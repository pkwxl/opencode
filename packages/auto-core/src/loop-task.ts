// the main task loop (runTaskLoop): runAll's former closure turned into a
// top-level function, its captures made explicit as LoopCtx; ran accumulates
// across runTaskLoop calls (it decides whether --wait-between pauses before
// the first task of a later phase), hence a mutable field on ctx rather than
// a local.
// Split out of src/loop.ts (plans/0024-module-split-plan.md S15, pure move;
// §I D14). Does not depend on loop.ts.
import { maybeExit } from "./exit"
import { beginUnit, commitTree, unitBaseline, unitViolations, type UnitBaseline } from "./git"
import { hibernatePause } from "./hibernate"
import type { Interactive } from "./interactive"
import type { RunAllOpts } from "./loop-preflight"
import { waitBetweenTasks } from "./loop-progress"
import type { PlanInput } from "./plan-input"
import { taskEndLines, taskResolveLines } from "./conclusion"
import { banner, formatDuration, log } from "./log"
import { block, loadPlan, next } from "./tasks"
import { phaseKey, type PhaseUnit } from "./phases"
import { recallProgress } from "./resume"
import { runTask } from "./runner"
import type { AgentPool } from "./agent-pool"
import type { RoutingFacts } from "./routing"
import type { Router } from "./router"
import { statsTask } from "./stats"
import { autoSwitches } from "./switches"
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
  const { directory, opts, server: serverHandle, agentName, repl } = ctx
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
        if (opts.commit !== false && !opts.dryrun) taskBaseline = await unitBaseline(directory)
      } else {
        const gate = await beginUnit(directory, opts, task)
        if (gate.type === "dirty") {
          log(`⏸ ${task.id} worktree not clean before startup; to ensure the execution unit starts on a clean baseline, handle it manually (commit or clean) and re-run:`)
          for (const file of gate.files) log(`  ${file}`)
          return 2
        }
        taskBaseline = gate.baseline
      }
    }
    banner(`${task.id} ${task.title}`)
    log(`▶ ${task.id} starting execution (attempt ${task.attempts + 1})`)
    // the task-switch hook point (STATS_PLAN §3): reset the task bucket (when
    // the id changes) and clear the per-session map; the same id is
    // idempotent — an interruption resuming the same task neither resets nor
    // double-counts.
    await statsTask(directory, task.id)
    const start = Date.now()
    const outcome = await runTask(serverHandle, plan, task, {
      agent: agentName,
      dir: directory,
      verbose: opts.verbose,
      waitAnswer: opts.waitAnswer,
      commit: opts.commit,
      subtask: opts.subtask,
      contextLimit: opts.contextLimit,
      permission: opts.permission,
      interactive: repl,
      server: serverHandle,
      idleMs: opts.idleMs,
      maxMs: opts.maxMs,
      testByDriver: opts.testByDriver,
      handoverTest: opts.handoverTest,
      mode: opts.mode,
      newSession: opts.newSession,
      wrapup: opts.wrapup,
      scanExempt: opts.scanExempt,
      phase: phaseKey(phase),
      routing: ctx.routing,
      router: ctx.router,
      ...(ctx.leadSplit === false ? { leadSplit: false } : {}),
    })
    if (outcome.type === "dirty") {
      // Unit-startup clean gate failure (runTask inner layer): no state
      // write, no sweep-up commit — the git state decision belongs to the
      // human (plans/0021-commit-boundary-design.md).
      log(`⏸ ${task.id} worktree not clean before the execution unit starts (suspected leftover from an abandoned run or manual changes); handle it manually (commit/clean) and re-run:`)
      for (const file of outcome.files) log(`  ${file}`)
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
      // exit 2, changes stay in the worktree for manual handling.
      if (opts.commit !== false) {
        const settled = await commitTree(directory, task, { stage: "interrupted", subject: `${task.id} blocked ${task.title}` })
        if (!settled.ok) log(`⚠ interruption-scene commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}(changes kept in the worktree, handle manually)`)
      }
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
      if (opts.commit !== false) {
        const settled = await commitTree(directory, task, { stage: "interrupted", subject: `${task.id} pending ${task.title}` })
        if (!settled.ok) log(`⚠ interruption-scene commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}(changes kept in the worktree, handle manually)`)
      }
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
    // the completion-condition gate (plans/0021-commit-boundary-design.md):
    // terminal commit failure → exit 2 for human attention (the task mark is
    // already in the worktree; after the human commits and re-runs, the next
    // task starts on a clean baseline); after the commit succeeds, the task
    // baseline drives the close-out check (the commit range must be all driver
    // commits, an external commit is an isolation break).
    if (opts.commit !== false) {
      const settled = await commitTree(directory, task, { stage: "done", subject: `${task.id} done ${task.title}` })
      if (!settled.ok) {
        log(
          `⏸ ${task.id} completed but the final unified commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. ` +
            `The task mark is still in the worktree; commit manually and re-run`,
        )
        return 2
      }
      if (taskBaseline) {
        const violations = await unitViolations(directory, taskBaseline)
        if (violations.length) {
          log(`⏸ ${task.id} unit close-out check failed (task counts as done, but the isolation boundary has been violated; investigate manually):`)
          for (const problem of violations) log(`  ${problem}`)
          return 2
        }
      }
    }
    // step pause (task boundary, OPENCODE_AUTO_STEP ≥ task): a hard pause
    // after the task's terminal commit and before the next task, Enter lets
    // it proceed. dir is passed so the pause wait is deducted from the timing
    // stats.
    await stepPause("task", `task ${task.id} ${task.title}`, { interactive: repl, dir: directory })
    maybeExit("task", `task ${task.id} ${task.title}`)
    // Hibernate window (task boundary, OPENCODE_AUTO_HIBERNATE): after the
    // final commit, a safe spot to check "are we inside the window now"; if
    // so, sleep until window end + random delay before continuing
    // (plans/0027-hibernate-design.md).
    await hibernatePause(`task ${task.id} ${task.title} boundary`, { dir: directory })
    // the /failback consumption point (task boundary): the chain was
    // destroyed with runTask, no chain.model to clear; reset the phase-scope
    // sticky holder and apply the model-order override (if any). Registry
    // routing (plans/0055 §6.4): the chain's destruction is also where the
    // task-scope down marks clear — the marks are run state, not chain state.
    ctx.router.clearDownMarks("task", autoSwitches().modelFailbackScope)
    ctx.router.consumeFailback()
  }
}
