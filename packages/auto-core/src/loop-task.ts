// 主任务循环(runTaskLoop): runAll 原闭包转顶层函数,
// 捕获量显式化为 LoopCtx;ran 跨 runTaskLoop 调用累积(决定 --wait-between 是否在后续
// 阶段首个任务前暂停),故作可变字段进 ctx 而非降为局部。
// 拆分自 src/loop.ts(plans/0024-module-split-plan.md S15,纯搬运;§I D14)。不依赖 loop.ts。
import { maybeExit } from "./exit"
import { clearDownMarks, consumeFailback } from "./failback"
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
import type { AgentHost } from "./agent/types"
import type { RoutingFacts } from "./routing"
import { statsTask } from "./stats"
import { autoSwitches } from "./switches"
import { stepPause } from "./step"

export type LoopCtx = {
  directory: string
  opts: RunAllOpts
  server: AgentHost
  agentName: string
  phases: string
  // The no-phase mode (phases = "m"): the single phase P01-implement is manual —
  // no handover session, the phase stays open (plans/0047 L2), and a planning
  // session runs only on a planning input (plans/0053 D12).
  manual: boolean
  repl?: Interactive
  // runTaskLoop 跨调用累积的已跑任务数(§I D14): 决定 --wait-between 是否在后续阶段
  // 首个任务前暂停,降为函数局部会每次清零(行为改动),故作可变字段进 ctx。
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
}

// 主任务循环: 依次执行当前阶段任务索引(tasks.md)中的全部任务(子任务/收尾/
// 统一提交/进度恢复)。phase 为当前阶段单元,其预置字母透传 runTask(模型路由字母
// 键、分解模板选择)。返回 0 = 本阶段任务全部完成(阶段收口由 runPhaseLoop 路由),
// 2 = 阻塞/未完成(原因在运行日志)。
export async function runTaskLoop(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const { directory, opts, server: serverHandle, agentName, repl } = ctx
  for (;;) {
    const plan = await loadPlan(directory, phase)
    const task = next(plan)
    if (!task) {
      log("✓ all tasks complete")
      return 0
    }
    // 首个任务不等待;仅当存在后继任务时在任务之间暂停。
    if (ctx.ran > 0 && opts.waitBetween) await waitBetweenTasks(opts.waitBetween, task.id, repl, directory)
    if (task.status === "blocked") {
      log(`↻ ${task.id} was blocked previously, resuming directly (block reason in the previous run's log)`)
    }
    // 任务单元提交边界(plans/0021-commit-boundary-design.md P3): 启动 clean 门禁 + SHA
    // 基线。active 进度记录 = 恢复续跑(工作区承载本单元自身进度,含交接文档)
    // 豁免 clean、仍记基线;done 终态提交后凭基线做收口校验(提交区间须全为
    // driver 提交)。driver 独占状态文件遗留由 beginUnit 以 carryover 自愈。
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
    // 任务切换挂点(STATS_PLAN §3): 重置 task 桶(id 变化时)、清空 per-session
    // 映射;同 id 幂等——中断续跑同任务不重置、不重复计数。
    await statsTask(directory, task.id)
    const start = Date.now()
    const outcome = await runTask(serverHandle.client, plan, task, {
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
      phase: phaseKey(phase),
      routing: ctx.routing,
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
      // 代答高亮块(plans/0020-auto-resolve-design.md §H-②,H5): 置顶于结论行之前。三态
      // 一律打印,且不受统计守卫影响(阻塞任务同样可能已被代答了若干问题)。
      for (const line of await taskResolveLines(directory, task.id)) log(line)
      // 任务三态行(STATS_PLAN §4.2,T-006): blocked 同样输出累计统计段 +
      // tokens 行(守卫失败时不打印,与 T-006 前行为一致——原本只有 done 有统计行)。
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
    // 任务完成的终态提交: todo.md → done.md 改名与 tasks.md 勾选在此一并落账
    // (各会话产出已随会话提交,这里是收口)。
    // 完成条件门禁(plans/0021-commit-boundary-design.md): 终态提交失败 → 退出 2 交人工
    // (任务标记已在工作区,人工提交后重跑,下一任务以干净基线启动);提交成功
    // 后凭任务基线做收口校验(提交区间须全为 driver 提交,外部提交即隔离破坏)。
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
    // 步进暂停(task 边界,OPENCODE_AUTO_STEP ≥ task): 任务终态提交后、下一任务
    // 前硬暂停,回车放行。dir 传入使暂停等待从用时统计扣除。
    await stepPause("task", `task ${task.id} ${task.title}`, { interactive: repl, dir: directory })
    maybeExit("task", `task ${task.id} ${task.title}`)
    // Hibernate window (task boundary, OPENCODE_AUTO_HIBERNATE): after the
    // final commit, a safe spot to check "are we inside the window now"; if
    // so, sleep until window end + random delay before continuing
    // (plans/0027-hibernate-design.md).
    await hibernatePause(`task ${task.id} ${task.title} boundary`, { dir: directory })
    // /failback 消费点(task 边界): 链已随 runTask 销毁、无需清 chain.model;
    // 重置 phase 粒度 sticky holder 并应用模型序覆写(若有)。Registry routing
    // (plans/0055 §6.4): the chain's destruction is also where the task-scope
    // down marks clear — the marks are run state, not chain state.
    clearDownMarks("task", autoSwitches().modelFailbackScope)
    consumeFailback()
  }
}
