// 终审闭环推进(advanceFinal)与主任务循环(runTaskLoop): runAll 原闭包转顶层函数,
// 捕获量显式化为 LoopCtx;ran 跨 runTaskLoop 调用累积(决定 --wait-between 是否在后续
// 阶段首个任务前暂停),故作可变字段进 ctx 而非降为局部。
// 拆分自 src/loop.ts(docs/module-split-plan.md S15,纯搬运;§I D14)。不依赖 loop.ts。
import { appendFinalTask, finalIndex, finalProposalFile, generateFinalTask, routeFinal, type FinalProposal } from "./final"
import { maybeExit } from "./exit"
import { consumeFailback } from "./failback"
import { beginUnit, commitTree, unitBaseline, unitViolations, type UnitBaseline } from "./git"
import { hibernatePause } from "./hibernate"
import type { Interactive } from "./interactive"
import type { RunAllOpts } from "./loop-preflight"
import { waitBetweenTasks } from "./loop-progress"
import { roundCompleteLines, roundResolveLines, taskEndLines, taskResolveLines } from "./conclusion"
import { banner, formatDuration, log } from "./log"
import { block, load, next, type Plan } from "./plan"
import type { Phase } from "./phases"
import { stageText } from "./prompt"
import { recallProgress } from "./resume"
import { runTask } from "./runner"
import type { ServerHandle } from "./server"
import { statsTask } from "./stats"
import { stepPause } from "./step"

export type LoopCtx = {
  directory: string
  path: string
  opts: RunAllOpts
  server: ServerHandle
  agentName: string
  phases: string
  repl?: Interactive
  // runTaskLoop 跨调用累积的已跑任务数(§I D14): 决定 --wait-between 是否在后续阶段
  // 首个任务前暂停,降为函数局部会每次清零(行为改动),故作可变字段进 ctx。
  ran: number
}

// --final-review 终审闭环推进(设计文档 B.2/C): 路由纯函数依(带 final 标记的
// 任务及其状态,终审产物 docs/T-F<k>/)决定下一步——开生成会话产出提案、提案已
// 产出直接解析追加(C.3)、熔断/报告异常 block 对应终审任务(B.5/C.4);追加后
// 主循环 next() 按文件顺序自然拾取,无新增持久化状态。announce 为真时
// (next() 为空的启动挂点)先打印终审横幅;runTask 完成后的路由挂点不打印。
// 返回 appended = 已追加任务续跑、stopped = 阻塞退出(退出码 2)、
// idle = 无需推进(存在未完成终审任务或终审已完成)。
async function advanceFinal(ctx: LoopCtx, plan: Plan, announce = false): Promise<"appended" | "stopped" | "idle"> {
  const { directory, path, opts, server: serverHandle, agentName, repl } = ctx
  const route = await routeFinal(directory, plan, opts.finalReview ?? 0)
  if (route.type === "wait" || route.type === "complete") return "idle"
  if (route.type === "block") {
    await block(path, route.task)
    log(`⏸ ${route.task} 已阻塞(原因见本条,不再写入 PLAN.md):\n${route.question}`)
    return "stopped"
  }
  if (announce) banner("全部任务完成,进入终审闭环")
  const append = async (proposal: FinalProposal) => {
    const id = await appendFinalTask(path, plan, route.stage, route.round, proposal)
    // 追加是 driver 状态写入(PLAN.md),立即统一提交——下一个执行单元(终审
    // 任务)的启动 clean 门禁据此成立;提交同时清扫"追加前中断"遗留的未提交
    // 提案文件(③ 补账语义,commit-boundary-design.md P3)。失败 → stopped 交人工。
    if (opts.commit !== false && !opts.dryrun) {
      const settled = await commitTree(directory, { id: "PLAN", title: `终审任务追加(${stageText(route.stage)} 第 ${route.round} 轮)` }, {
        stage: "final-plan",
        subject: `PLAN final-plan 追加终审任务 ${id}`,
      })
      if (!settled.ok) {
        log(`⏸ 终审任务 ${id} 已追加但提交失败: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}。请人工提交后重新运行`)
        return "stopped" as const
      }
    }
    log(`✓ 已追加终审任务 ${id}「${stageText(route.stage)}」,主循环继续执行`)
    return "appended" as const
  }
  if (route.type === "append") {
    log(`↻ 终审提案 ${finalProposalFile(route.stage, route.round, finalIndex(plan))} 已产出(追加前中断),直接解析追加`)
    return append(route.proposal)
  }
  log(`▶ 终审闭环: 开生成会话规划「${stageText(route.stage)}」任务(第 ${route.round} 轮)`)
  const generated = await generateFinalTask(serverHandle.client, plan, route.stage, route.round, route.prior, {
    agent: agentName,
    dir: directory,
    verbose: opts.verbose,
    waitAnswer: opts.waitAnswer,
    contextLimit: opts.contextLimit,
    permission: opts.permission,
    interactive: repl,
    server: serverHandle,
    mode: opts.mode,
  })
  if (generated.type === "dirty") {
    log(`⏸ 终审任务生成会话启动前工作区不净,请人工处置(提交/清理)后重新运行:`)
    for (const file of generated.files) log(`  ${file}`)
    return "stopped"
  }
  if (generated.type === "blocked") {
    log(`⏸ 终审任务生成会话受阻(隐性阻塞,请检查后重新运行):\n${generated.question}`)
    return "stopped"
  }
  return append(generated.proposal)
}

// 主任务循环: 依次执行 PLAN.md 中全部任务(子任务/verify/review/统一提交/
// 进度恢复零改动)。phase 为当前阶段字母(缺省单次运行取 "m"): ① finalGate
// —— --final-review 终审闭环的挂接门控,阶段化流程下仅 m(迁移实现)阶段挂接
// (G 节);② 透传 runTask,v(验收)阶段任务据此豁免任务级验收与 --review
// (phases-design.md D.3)。返回 0 = 全部完成,2 = 阻塞/未完成(问题已写入
// PLAN.md)。
export async function runTaskLoop(ctx: LoopCtx, phase: Phase): Promise<number> {
  const { directory, path, opts, server: serverHandle, agentName, phases, repl } = ctx
  const finalGate = phase === "m"
  for (;;) {
    const plan = await load(path)
    const task = next(plan)
    if (!task) {
      // --final-review: next() 为空且终审未完成 → 推进终审闭环(生成/追加下一
      // 阶段任务后续跑循环);终审完成则照常退出。
      if (finalGate && (opts.finalReview ?? 0) > 0) {
        const advanced = await advanceFinal(ctx, plan, true)
        if (advanced === "stopped") return 2
        if (advanced === "appended") continue
      }
      log("✓ 全部任务已完成")
      // 非分阶段路径的轮次完成行(STATS_PLAN §4.4,T-006): 阶段桶恒为 "m" 伪
      // 阶段,省略阶段段。分阶段路径由 runPhaseLoop 的 complete 路由统一打印,
      // 此处(phases !== "m" 时 runTaskLoop 只是单阶段执行)不重复。
      if (phases === "m") {
        // 轮次代答汇总(auto-resolve-design.md §H-③,H6): 置顶于 ■ 轮次行之前。
        for (const line of await roundResolveLines(directory)) log(line)
        const lines = await roundCompleteLines(directory)
        if (lines) for (const line of lines) log(line)
      }
      return 0
    }
    // 首个任务不等待;仅当存在后继任务时在任务之间暂停。
    if (ctx.ran > 0 && opts.waitBetween) await waitBetweenTasks(opts.waitBetween, task.id, repl, directory)
    if (task.status === "blocked") {
      log(`↻ ${task.id} 此前被阻塞,直接续跑(阻塞原因见上次运行日志)`)
    }
    // 任务单元提交边界(commit-boundary-design.md P3): 启动 clean 门禁 + SHA
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
          log(`⏸ ${task.id} 启动前工作区不净,为保证执行单元以干净基线启动,请人工处置(提交或清理)后重新运行:`)
          for (const file of gate.files) log(`  ${file}`)
          return 2
        }
        taskBaseline = gate.baseline
      }
    }
    banner(`${task.id} ${task.title}`)
    log(`▶ ${task.id} 开始执行(第 ${task.attempts + 1} 次尝试)`)
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
      review: opts.review,
      early: opts.early,
      verify: opts.verify,
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
      phase,
    })
    if (outcome.type === "dirty") {
      // 单元启动 clean 门禁失败(runTask 内层): 不写 PLAN.md、不做清扫提交——
      // git 状态的决定权在人工(commit-boundary-design.md)。
      log(`⏸ ${task.id} 执行单元启动前工作区不净(疑似上次半途而废的现场或人工改动),请人工处置(提交/清理)后重新运行:`)
      for (const file of outcome.files) log(`  ${file}`)
      return 2
    }
    if (outcome.type === "blocked") {
      await block(path, task.id)
      log(`⏸ ${task.id} 已阻塞(原因见本条,不再写入 PLAN.md):\n${outcome.question}`)
      // 代答高亮块(auto-resolve-design.md §H-②,H5): 置顶于结论行之前。三态
      // 一律打印,且不受统计守卫影响(阻塞任务同样可能已被代答了若干问题)。
      for (const line of await taskResolveLines(directory, task.id)) log(line)
      // 任务三态行(STATS_PLAN §4.2,T-006): blocked 同样输出累计统计段 +
      // tokens 行(守卫失败时不打印,与 T-006 前行为一致——原本只有 done 有统计行)。
      const lines = await taskEndLines(directory, task.id)
      if (lines) {
        log(`⏸ ${task.id} 阻塞: ${lines[0]}`)
        log(lines[1])
      }
      // 中断现场也提交: 保存断点(阻塞问题、CURRENT.md 中断备注),支持回滚到断点。
      // 提交失败(典型: 统一提交被环境拒绝)仅升级告警——已处在退出 2 的路上,
      // 改动保留在工作区待人工处置。
      if (opts.commit !== false) {
        const settled = await commitTree(directory, task, { stage: "interrupted", subject: `${task.id} blocked ${task.title}` })
        if (!settled.ok) log(`⚠ 中断现场提交失败: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}(改动保留在工作区,请人工处理)`)
      }
      return 2
    }
    if (outcome.type === "incomplete") {
      log(`⏸ ${task.id} 未完成,已回退为 pending。请改进 PLAN.md 中该任务的描述后重新运行:\n${outcome.reason}`)
      for (const line of await taskResolveLines(directory, task.id)) log(line)
      const lines = await taskEndLines(directory, task.id)
      if (lines) {
        log(`⏸ ${task.id} 未完成: ${lines[0]}`)
        log(lines[1])
      }
      if (opts.commit !== false) {
        const settled = await commitTree(directory, task, { stage: "interrupted", subject: `${task.id} pending ${task.title}` })
        if (!settled.ok) log(`⚠ 中断现场提交失败: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}(改动保留在工作区,请人工处理)`)
      }
      return 2
    }
    {
      for (const line of await taskResolveLines(directory, task.id)) log(line)
      const lines = await taskEndLines(directory, task.id)
      if (lines) {
        log(`✓ ${task.id} 完成: ${lines[0]}`)
        log(lines[1])
      } else {
        // 守卫失败(统计未装载/桶身份不符)回落 T-006 前旧文案。
        log(`✓ ${task.id} 完成(用时 ${formatDuration(Date.now() - start)})`)
      }
    }
    ctx.ran++
    // 任务完成的终态提交: PLAN.md 的 [done]/verified 与 CURRENT.md 的删除在此
    // 一并落账(各会话产出已随会话提交,这里是收口);终审路由追加的下一任务
    // 改动归入其生成/执行会话的提交。
    // 完成条件门禁(commit-boundary-design.md): 终态提交失败 → 退出 2 交人工
    // (任务标记已在工作区,人工提交后重跑,下一任务以干净基线启动);提交成功
    // 后凭任务基线做收口校验(提交区间须全为 driver 提交,外部提交即隔离破坏)。
    if (opts.commit !== false) {
      const settled = await commitTree(directory, task, { stage: "done", subject: `${task.id} done ${task.title}` })
      if (!settled.ok) {
        log(
          `⏸ ${task.id} 已完成但终态统一提交失败: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}。` +
            `任务标记仍在工作区,请人工提交后重新运行`,
        )
        return 2
      }
      if (taskBaseline) {
        const violations = await unitViolations(directory, taskBaseline)
        if (violations.length) {
          log(`⏸ ${task.id} 单元收口校验未通过(任务按已完成计,但隔离边界已被破坏,请人工核查):`)
          for (const problem of violations) log(`  ${problem}`)
          return 2
        }
      }
    }
    // 步进暂停(task 边界,OPENCODE_AUTO_STEP ≥ task): 任务终态提交后、终审
    // 路由与下一任务前硬暂停,回车放行。dir 传入使暂停等待从用时统计扣除。
    await stepPause("task", `任务 ${task.id} ${task.title}`, { interactive: repl, dir: directory })
    maybeExit("task", `任务 ${task.id} ${task.title}`)
    // 休眠窗口(task 边界,OPENCODE_AUTO_HIBERNATE): 终态提交完成后的安全落点检查
    // 「现在是否在窗口内」,在内则睡到窗口结束 + 随机延迟再继续(docs/hibernate-design.md)。
    await hibernatePause(`任务 ${task.id} ${task.title} 边界`, { dir: directory })
    // /failback 消费点(task 边界): 链已随 runTask 销毁、无需清 chain.model;
    // 重置 phase 粒度 sticky holder 并应用模型序覆写(若有)。
    consumeFailback()
    // --final-review 路由挂点: runTask 完成且任务带 final 标记 → 解析阶段报告
    // 路由追加下一任务(设计文档 B.2);熔断/报告异常立即阻塞退出,追加的任务
    // 由下一次 next() 按文件顺序拾取。
    if (finalGate && (opts.finalReview ?? 0) > 0 && task.final) {
      const advanced = await advanceFinal(ctx, await load(path))
      if (advanced === "stopped") return 2
    }
  }
}
