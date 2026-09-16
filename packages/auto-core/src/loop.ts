import { createInterface } from "node:readline/promises"
import { mkdir, rm, stat } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { appendFinalTask, finalIndex, finalProposalFile, generateFinalTask, routeFinal, type FinalProposal } from "./final"
import { ExitRequested, maybeExit } from "./exit"
import { clearSticky, consumeFailback } from "./failback"
import { beginUnit, changedFiles, commitPending, commitTree, unitBaseline, unitViolations, type UnitBaseline } from "./git"
// .gitignore 条目维护已上收至叶子模块 gitignore.ts(与 reset 成对);此处
// 再导出以保持既有导入路径 @opencode-ai/auto-core/loop 不变。
import { ensureGitignore } from "./gitignore"
export { ensureGitignore } from "./gitignore"
import { extractKnowledge, priorKnowledgeDigest } from "./knowledge"
import { advanceNextTask, ensureNumbering, NEXT_TASK_FILE, taskNumber } from "./numbering"
import { startInteractive, type Interactive } from "./interactive"
import { banner, formatDuration, formatUsageLine, log, vlog } from "./log"
import type { ModeSpec } from "./mode"
import { block, countSubtasks, load, next, resetInProgress, setStatus, type Plan } from "./plan"
import {
  appendLedger,
  currentRound,
  handoverDoc,
  phaseArchive,
  phaseText,
  prevRoundDigest,
  readLedger,
  renderPlanScaffold,
  routePhase,
  validHandover,
  type Phase,
} from "./phases"
import { renderDryrun, renderPhaseHandover, renderPhasePlan, stageText } from "./prompt"
import { allowWrite, protect, reprotect, unprotect } from "./protect"
import { decisionsOf, resolveHighlight, resolvesOf } from "./resolve"
import { closeStep, openStep, peekProgress, recallProgress } from "./resume"
import type { PermissionMode, SubtaskMode } from "./opts"
import { requireArtifact, restoreTestHandoffs, runOnce, runTask } from "./runner"
import { shellProfile } from "./shell"
import { manage, type ServerHandle } from "./server"
import {
  flushStats,
  loadStats,
  statsBoot,
  statsHistory,
  statsId,
  statsPhase,
  statsTask,
  statsTotals,
  statsWaitBegin,
  statsWaitEnd,
  type StatsResume,
} from "./stats"
import { stepPause } from "./step"
import { renderText, usePromptLibrary } from "./template"
import templateAgent from "../templates/.opencode/agent/auto.md" with { type: "file" }

// AGENTS.md 的 opencode-auto 块(单一标记块,内容与幂等同步逻辑见 agents-block.ts):
// CURRENT.md 由 driver 整文件重写,块本身按当前配置渲染比对、不一致才整块替换。
// 块不强制每会话开读 CURRENT.md: 提示词已内联当前任务、子任务会话另有 context.md
// 背景摘要,无条件重读是纯开销;CURRENT.md 保留为上下文压缩后的兜底入口。
// AGENTS.md 作为 system context 每个 provider turn 现场重读,不随上下文压缩丢失;
// 它有更新时 driver 会在下一个新会话前重启 server,使新会话必定加载最新内容。
// AGENTS.md 不置只读(任务可更新它),run/init 只确保该块与当前配置渲染一致。
import { ensurePointer, renderAgentsBlock } from "./agents-block"
export { ensurePointer, renderAgentsBlock }

// Exit codes: 0 = all tasks done, 1 = usage/setup error, 2 = blocked, waiting
// for a human to resolve the issue outside the session and re-run,
// 130 = force-killed by double Ctrl+C. A blocked
// task needs no `answer`: re-running resumes it directly.

// agent 契约渲染文本: 按 verify/testByDriver 两态渲染内置模板。外壳的契约维护
// 写入与 runAll 的完整性检查共用本函数,防止写入与比对口径漂移(模板含
// {{#if}} 条件块,拿原始文本比对渲染后的文件必然不一致)。
export async function renderAgentContract(verify: boolean, testByDriver: boolean): Promise<string> {
  return renderText(await Bun.file(templateAgent).text(), { verify, testByDriver })
}

export async function runAll(
  directory: string,
  opts: {
    agent?: string
    server?: string
    verbose?: boolean
    waitAnswer?: number
    // 任务间暂停等待人工的分钟数(0 = 不等待);回车立即继续,超时自动继续。
    waitBetween?: number
    // --commit false: 关闭会话后统一提交(缺省启用;提交机制见 src/git.ts)。
    commit?: boolean
    subtask?: SubtaskMode
    // dryrun: 只跑一次权限预检会话并输出报告,不执行任何任务。
    dryrun?: boolean
    // 上下文预算基线(tokens;会话复用的已用量阈值为其一半),缺省由 runner 按 64k 处理。
    contextLimit?: number
    // --review 质量审核轮数上限(0 = 不启用),透传给 runTask。
    review?: number
    // --verify: 启用 driver 的任务级三段式验收(缺省不启用,任务收尾后直接标
    // done),透传给 runTask。
    verify?: boolean
    // --early: 审核会话与 driver 执行 verify 脚本并行(需 review 已启用),透传给
    // runTask;窗口时序见设计文档 F 节。
    early?: boolean
    // --permission: 权限请求的处理策略(缺省 ask-deny),透传给 runner 的会话监听。
    permission?: PermissionMode
    // --interactive: 常驻 stdin 旁路接收人工输入注入当前会话(与 --verbose 互斥,
    // 终端明细静默,日志文件保持完整记录)。
    interactive?: boolean
    // driver 托管脚本(verify 与 test)的看门狗: 持续无输出的判定窗口与绝对时长
    // 上限(毫秒),透传给 runner 的 runVerifyScript(config 的 idleTime / idleMax
    // 以分钟设定)。
    idleMs?: number
    maxMs?: number
    // --test-by-driver: 测试执行协议(与 verify 正交)——执行类会话把测试脚本写入
    // tmp/test.sh 由 driver 执行,输出反馈回会话;--handover-test: 测试失败且上下文
    // 达上限时交接新会话续跑。均透传给 runTask。
    testByDriver?: boolean
    handoverTest?: boolean
    // -m/--mode 场景模式(缺省 migrate),透传给 runTask 的提示词渲染。
    mode?: ModeSpec
    // --final-review 终审闭环的审计轮上限(0 = 不启用,含首轮 audit): 任务全部
    // 完成后按 docs/mode-final-review-design.md B/C 节推进——终审阶段是入
    // PLAN.md 的 T-F 真任务,本循环只做"生成任务 → 跑任务 → 解析报告路由"。
    finalReview?: number
    // --phases 阶段化流程(设计文档 docs/phases-design.md,来自配置): "m"(缺省)=
    // 无阶段声明,走既有单次运行路径(零改动);其余值启用阶段循环(D 节)——
    // 推导当前阶段 → 规划会话填充 PLAN.md → 主循环执行 → 交接(归档+重置+台账+
    // 提交)→ 下一阶段。--final-review 仅 m(迁移实现)阶段挂接。
    phases?: string
    // config.source 迁移源参数(可选),注入阶段规划会话。
    source?: { dir: string; path: string }
    // config.destDir 迁移目标目录(可选,相对工作目录),注入阶段规划会话——
    // driver 流程文件与迁移产出经它隔离。
    destDir?: string
    // 调用方已托管的 server 句柄(外壳的前置会话与主循环共用一个实例): 提供
    // 时不再自行 manage/close,生命周期归调用方。
    managed?: ServerHandle
    // --new-session: 中断恢复时跳过会话复用(仅放弃旧会话上下文,阶段精确重入
    // 保留),透传给 runTask。
    newSession?: boolean
    // 自动编号(config.autoNumber): 任务编号在目标目录永不重复——阶段规划会话自
    // .auto/next-task 记录续接编号,记录缺失先经 AI 恢复会话推导恢复(见
    // src/numbering.ts)。
    autoNumber?: boolean
    // --no-wrapup(config.wrapup,缺省 true): 关闭任务收尾会话,透传给 runTask。
    wrapup?: boolean
  },
): Promise<number> {
  const path = join(directory, "PLAN.md")
  if (!(await Bun.file(path).exists())) {
    log(`未找到计划文件: ${path}`)
    return 1
  }

  // 提示词库: 装载目标目录 .opencode/auto/prompts/ 覆盖(协议敏感模板做关键
  // 内容校验,失败按用法错误退出)。之后 render* 同步渲染,无需再感知目录。
  try {
    usePromptLibrary(directory)
  } catch (error) {
    log(error instanceof Error ? error.message : String(error))
    return 1
  }

  // --early 依赖 verify 脚本执行窗口;未启用 --verify 时窗口不存在,审核降级为串行。
  if (opts.early && !opts.verify) log("ℹ 未启用 --verify,--early 的并行审核窗口不存在,质量审核改为串行执行")

  // --agent 缺省取 auto 契约 agent(init 生成的自主执行契约);run 前完整性检查:
  // agent 契约文件缺失时服务端只回 UnknownError(不含根因),此处提前报出并按外壳
  // 画像提示恢复方式(src/shell.ts);与模板不一致仅警告。
  const agentName = opts.agent ?? "auto"
  const agentFile = join(directory, ".opencode/agent", `${agentName}.md`)
  const agentText = await Bun.file(agentFile).text().catch(() => undefined)
  const { program, bin, agentRecovery } = shellProfile()
  if (agentText === undefined) {
    log(`⏸ 缺少 agent 契约文件: .opencode/agent/${agentName}.md(缺失会导致下发任务失败: UnknownError)`)
    log(
      agentRecovery === "startup"
        ? `  恢复方式: 重新运行 ${program}(启动时会按模板重建默认契约),或手工补回该文件`
        : `  恢复方式: 运行 ${bin} init ${directory} 重建该文件(或手工补回),然后重新运行`,
    )
    return 1
  }
  // init 写入的是按当时 verify/testByDriver 渲染后的契约,比对须用当前配置同样
  // 渲染(与原始模板全文比对会因 {{#if}} 标记恒不一致,口径同 renderAgentContract)。
  if (agentName === "auto" && agentText !== (await renderAgentContract(Boolean(opts.verify), Boolean(opts.testByDriver)))) {
    log(
      `⚠ .opencode/agent/auto.md 与当前模板不一致(可能为旧版契约),` +
        (agentRecovery === "startup" ? `重新运行 ${program} 会按模板刷新` : `可运行 ${bin} init ${directory} 刷新`),
    )
  }

  const watcher = opts.verbose ? watchFiles(directory) : undefined
  // 统计装载(plans/STATS_PLAN.md §1): 读盘 → 折旧上一进程遗留段 → 轮次滚动 → 开
  // 本进程首段;有旧文档时打印续接横幅(§4.6)。必须先于 trackSubtasks(其心跳读
  // 数依赖已装载句柄与 statsTask 设定的桶身份)。
  const resumed = await loadStats(directory)
  if (resumed) log(resumeBanner(resumed))
  // 每 10 分钟上报当前任务的子任务进度与预计剩余时间(基于 PLAN.md 勾选状态)。
  const progress = trackSubtasks(path, directory)
  // Driver-owned files go read-only for the whole run; driver writes
  // re-apply it, and the finally below restores writability so a human can
  // edit the files (e.g. opencode.json after a permission block).
  await protect(directory)
  // 交接文档的现场复原(测试交接中断恢复 F3,docs/test-handover-early-design.md §I):
  // 必须早于启动 clean 门禁——上一次运行可能把已落账的在途交接文档删掉,那道删除
  // 本身就是脏区,门禁会在这里当场拦下整次运行。复原即消脏,随后的恢复状态机也
  // 才拿得到判定所需的文件。
  if (!opts.dryrun) await restoreTestHandoffs(directory)
  // 启动 clean 门禁(commit-boundary-design.md P3): 提交启用时要求工作区 clean——
  // 此后所有执行单元(任务/子任务/隐藏任务)依赖的信息全部由上一次提交固定。
  // 人工遗留脏区阻塞交人工(替代旧"⚠ 会被下一次提交吸纳"提示:吸纳会把人工改动
  // 混入 driver 审计轨迹,破坏提交即隔离边界);driver 独占状态文件(PLAN.md/
  // CURRENT.md)的遗留走 beginUnit 的 carryover 补提交自愈——上一次运行以非提交
  // 路径退出(如单元门禁不净直接 return 2)会留下它们的写盘,那是 driver 自己的
  // 落账、不是人工改动,拦在这里只会让下一次运行永远起不来。
  if (opts.commit !== false && !opts.dryrun) {
    const gate = await beginUnit(directory, opts, { id: "PLAN", title: "运行前基线收口" })
    if (gate.type === "dirty") {
      log("⏸ 工作区存在未提交改动,为保证执行单元以干净基线启动,请先人工处置(提交或清理)后重新运行:")
      for (const file of gate.files) log(`  ${file}`)
      return 2
    }
  }
  // 中断恢复(必须早于下方运行前基线收口提交): 上次运行被 kill/Ctrl+C 可能遗留
  // in_progress 标记(无会话在跑),重置为 pending;主循环经 next() 照样续跑,
  // attempts 保留。距中断较近时链上会话的进度记录(.auto/progress.json)使 runTask
  // 复用原会话继续。这两段写的是 driver 独占状态文件 PLAN.md——放在 housekeeping
  // 收口之前,其写盘随该次提交一并落账,首个执行单元启动时工作区本就 clean
  // (否则要么白耗一次 carryover 自愈提交,要么在阶段化布局下直接撞 clean 门禁)。
  // dryrun 不改任何状态文件,故整段跳过(与下方 dryrun 提前 return 的旧位置等价)。
  if (!opts.dryrun) {
    const stale = await resetInProgress(path)
    if (stale.length) log(`↻ 恢复中断状态: ${stale.join(", ")} 从 in_progress 重置为 pending`)
    // 精确恢复: 进度记录在验收(verify,且 --review 启用)或质量审核(review)阶段
    // 中断的任务,验收通过时已被标 done——next() 会跳过它,审核永不补跑;置回
    // in_progress 使主循环重入该任务,runTask 依记录的阶段直接续跑。
    const record = await peekProgress(directory)
    if (record?.phase && (record.phase.kind === "review" || (record.phase.kind === "verify" && (opts.review ?? 0) > 0))) {
      const fresh = await load(path)
      const pending = fresh.tasks.find((task) => task.id === record.task)
      if (pending?.status === "done") {
        await setStatus(path, pending.id, "in_progress")
        log(`↻ ${pending.id} 上次中断于${record.phase.kind === "review" ? "质量审核" : "任务级验收"}阶段(任务已标 done),置回 in_progress 补跑`)
      }
    }
  }
  // 启动会话前确保 AGENTS.md 的 opencode-auto 块与当前配置渲染一致(缺失则追加、
  // 内容与渲染不一致则整块替换、旧版/多余的带名标记块一律清理)。AGENTS.md 本身
  // 保持可写,任务可更新它的其余内容(有更新时 driver 会在新会话前重启 server)。
  const ensured = await ensurePointer(directory, { verify: opts.verify, testByDriver: opts.testByDriver })
  if (ensured.block === "inserted") log("已补写: AGENTS.md opencode-auto 块")
  if (ensured.block === "replaced") log("已刷新: AGENTS.md opencode-auto 块(与当前配置渲染不一致)")
  if (ensured.legacyRemoved) log(`已清理: AGENTS.md 中 ${ensured.legacyRemoved} 个旧版/多余 opencode-auto 标记块`)
  if (await ensureGitignore(directory)) log("已更新: .gitignore 忽略 tmp/ 与 .auto/(driver 工作目录与运行时状态)")
  // housekeeping 收口提交: ensurePointer/ensureGitignore 的补写是 driver 改动,立即
  // 落账使首个执行单元启动时工作区 clean;提交失败按环境阻塞退出 2
  // (commit-boundary-design.md P3)。dryrun 不做任何提交。
  if (opts.commit !== false && !opts.dryrun && (await changedFiles(directory)).length) {
    const settled = await commitTree(directory, { id: "PLAN", title: "运行前基线收口" }, {
      stage: "housekeeping",
      subject: "PLAN housekeeping 运行前基线收口(AGENTS.md 指针块/.gitignore/中断状态复位)",
    })
    if (!settled.ok) {
      log(`⏸ 运行前基线收口提交失败: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")},请人工处理 git 后重新运行`)
      return 2
    }
  }
  let server: ServerHandle | undefined
  // --interactive 旁路输入控制器;server 就绪后创建,finally 中关闭。
  let repl: Interactive | undefined
  // 单次 Ctrl+C 不终止(运行期间事件流/子进程可能吞掉或挂起默认退出),
  // 窗口期内连续第二次按下才强制终止:尽力恢复文件可写并关闭 server 后退出。
  let sigintAt = 0
  const onSigint = () => {
    const now = Date.now()
    if (now - sigintAt > 3000) {
      sigintAt = now
      log("⚠ 已捕获 Ctrl+C,3 秒内再次按下将强制终止运行")
      return
    }
    log("✋ 收到连续 Ctrl+C,强制终止")
    server?.close()
    void unprotect(directory).finally(() => process.exit(130))
    // 兜底:清理挂起时也要退出。
    setTimeout(() => process.exit(130), 1000).unref()
  }
  process.on("SIGINT", onSigint)
  try {
    // 阶段化流程: 台账非法为环境错误(H 节),提前于 server 启动求值一次路由,
    // 免得白白拉起服务再退出;正式路由在阶段循环内逐轮重新求值(推导式状态)。
    const phases = opts.phases ?? "m"
    if (phases !== "m") {
      const pre = await routePhase(directory, await load(path), phases)
      if (pre.type === "blocked") {
        log(`⏸ 阶段流程受阻: ${pre.reason}`)
        return 1
      }
    }
    server = opts.managed ?? (await manage(directory, opts.server))
    if (opts.interactive) {
      repl = startInteractive(server.client, agentName)
      log("💬 交互模式: 回车把输入作为额外消息发往当前会话(无活动会话时丢弃);输入 /exit 将在下一个安全边界处暂停退出,重新运行即可恢复")
    }
    if (opts.dryrun) {
      const result = await runOnce(server.client, "权限预检", renderDryrun(), {
        agent: agentName,
        dir: directory,
        verbose: opts.verbose,
        waitAnswer: opts.waitAnswer,
        dryrun: true,
        contextLimit: opts.contextLimit,
        interactive: repl,
        server,
      })
      if (result.type === "blocked") {
        log(`⏸ 预检会话受阻:\n${result.question}`)
        return 2
      }
      log(`✓ 权限预检完成,报告已写入 .auto/dryrun.md,要点:\n\n${result.lastText}`)
      return 0
    }
    let ran = 0
    // advanceFinal 闭包内引用会失去窄化,以 const 捕获已就绪的 server 句柄。
    const serverHandle = server
    // --final-review 终审闭环推进(设计文档 B.2/C): 路由纯函数依(带 final 标记的
    // 任务及其状态,终审产物 docs/T-F<k>/)决定下一步——开生成会话产出提案、提案已
    // 产出直接解析追加(C.3)、熔断/报告异常 block 对应终审任务(B.5/C.4);追加后
    // 主循环 next() 按文件顺序自然拾取,无新增持久化状态。announce 为真时
    // (next() 为空的启动挂点)先打印终审横幅;runTask 完成后的路由挂点不打印。
    // 返回 appended = 已追加任务续跑、stopped = 阻塞退出(退出码 2)、
    // idle = 无需推进(存在未完成终审任务或终审已完成)。
    const advanceFinal = async (plan: Plan, announce = false): Promise<"appended" | "stopped" | "idle"> => {
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
    const runTaskLoop = async (phase: Phase): Promise<number> => {
      const finalGate = phase === "m"
      for (;;) {
        const plan = await load(path)
        const task = next(plan)
        if (!task) {
          // --final-review: next() 为空且终审未完成 → 推进终审闭环(生成/追加下一
          // 阶段任务后续跑循环);终审完成则照常退出。
          if (finalGate && (opts.finalReview ?? 0) > 0) {
            const advanced = await advanceFinal(plan, true)
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
        if (ran > 0 && opts.waitBetween) await waitBetweenTasks(opts.waitBetween, task.id, repl, directory)
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
        ran++
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
        // /failback 消费点(task 边界): 链已随 runTask 销毁、无需清 chain.model;
        // 重置 phase 粒度 sticky holder 并应用模型序覆写(若有)。
        consumeFailback()
        // --final-review 路由挂点: runTask 完成且任务带 final 标记 → 解析阶段报告
        // 路由追加下一任务(设计文档 B.2);熔断/报告异常立即阻塞退出,追加的任务
        // 由下一次 next() 按文件顺序拾取。
        if (finalGate && (opts.finalReview ?? 0) > 0 && task.final) {
          const advanced = await advanceFinal(await load(path))
          if (advanced === "stopped") return 2
        }
      }
    }

    if (phases === "m") {
      // 非分阶段路径: 全程归 "m" 阶段桶(STATS_PLAN §3)。
      await statsPhase(directory, "m")
      return await runTaskLoop("m")
    }

    // 阶段规划会话(E 节): 旁路一次性,复用 requireArtifact 骨架,产物 = 直接编辑
    // 填充的 PLAN.md——会话被 driver 专门授权写它(临时放行写权限,其余状态文件
    // 仍只读)。伪任务 PLAN 不进任务链、不写进度记录。返回 0 = 规划完成。
    const planPhase = async (phase: Phase): Promise<number> => {
      // 自动编号(config.autoNumber): 规划会话的编号起点来自 .auto/next-task
      // 记录;记录缺失先恢复(无历史证据直接写 1,有证据开 AI 推导会话,见
      // src/numbering.ts),恢复受阻即退出 2。恢复会话本身会产生一次统一提交
      // (stage=numbering),先于规划会话。
      let numberStart: number | undefined
      if (opts.autoNumber) {
        const numbering = await ensureNumbering(serverHandle.client, directory, {
          agent: agentName,
          dir: directory,
          verbose: opts.verbose,
          waitAnswer: opts.waitAnswer,
          commit: opts.commit,
          contextLimit: opts.contextLimit,
          permission: opts.permission,
          interactive: repl,
          server: serverHandle,
          mode: opts.mode,
        })
        if (numbering.type === "dirty") {
          log(`⏸ 编号记录恢复前工作区不净,请人工处置(提交/清理)后重新运行:`)
          for (const file of numbering.files) log(`  ${file}`)
          return 2
        }
        if (numbering.type === "blocked") {
          log(`⏸ 编号记录恢复会话受阻(隐性阻塞,请检查后重新运行):\n${numbering.question}`)
          return 2
        }
        numberStart = numbering.next
      }
      const brief = await Bun.file(join(directory, ".opencode", "auto", "brief.md")).text().catch(() => undefined)
      // 前序阶段交接注入(E 节注入纪律): 只注入 handover 蒸馏产物,不注入前序
      // 原始 docs/。台账中早于当前阶段且已 done 的各阶段逐个拼接;交接文档为永久
      // 路径(新布局轮内 docs/R-NN/handovers/,旧布局 docs/handovers/R<N>-…,
      // handoverDoc 按布局解析),P2 前完成的阶段落在阶段归档目录内(读回落);
      // 缺 handover 的阶段在清单中标注"(无交接文档)"。
      const declared = [...phases] as Phase[]
      const ledger = await readLedger(directory)
      const round = await currentRound(directory)
      const handovers = (
        await Promise.all(
          declared
            .slice(0, declared.indexOf(phase))
            .filter((letter) => ledger.done.includes(letter))
            .map(async (letter) => {
              const modern = await handoverDoc(directory, round, letter)
              const text =
                (await Bun.file(join(directory, modern)).text().catch(() => undefined)) ??
                (await Bun.file(join(directory, await phaseArchive(directory, round, letter), "handover.md")).text().catch(() => undefined))
              return [`### ${letter} ${phaseText(letter)}(${modern})`, "", text?.trim() || "(无交接文档)"].join("\n")
            }),
        )
      ).join("\n\n")
      // 本轮首个规划会话的额外注入(台账为空时): ① 前置知识(外壳启动时的已有
      // 迁移结果蒸馏,docs/prior-kb/,见 src/knowledge.ts);② 上一轮结论(轮次
      // 归档存在时,phases-design.md M 节)。后续阶段照常走 handovers 蒸馏链,
      // 不重复注入。
      let prevRound: string | undefined
      if (!ledger.done.length) {
        const parts = [await priorKnowledgeDigest(directory), await prevRoundDigest(directory)].filter((part): part is string => Boolean(part?.trim()))
        prevRound = parts.length ? parts.join("\n\n") : undefined
        if (prevRound) log("ℹ 注入既有迁移结论(前置知识与上一轮归档摘录)")
      }
      log("▶ 开阶段规划会话填充 PLAN.md")
      await allowWrite(path)
      try {
        const planned = await requireArtifact(
          serverHandle.client,
          { id: "PLAN", title: `阶段规划(${phase} ${phaseText(phase)})`, status: "in_progress", attempts: 0, body: "" },
          renderPhasePlan({
            phase,
            brief,
            handovers,
            prevRound,
            source: opts.source,
            destDir: opts.destDir,
            mode: opts.mode,
            verify: opts.verify,
            finalReview: opts.finalReview,
            // 生效 phases 经 --phases 裁剪(无独立 a/d 阶段)→ m 阶段规划注入裁剪注记
            trimmedPhases: !phases.includes("a") && !phases.includes("d"),
            numberStart,
          }),
          {
            agent: agentName,
            dir: directory,
            verbose: opts.verbose,
            waitAnswer: opts.waitAnswer,
            commit: opts.commit,
            contextLimit: opts.contextLimit,
            permission: opts.permission,
            interactive: repl,
            server: serverHandle,
            mode: opts.mode,
          },
          {
            kind: "阶段规划",
            step: { step: "phase-plan", letter: phase },
            // 独立隐藏任务单元: 启动 clean 门禁 + SHA 基线 + 收口校验
            // (commit-boundary-design.md;PLAN.md 遗留由 beginUnit carryover 自愈)。
            unitStart: true,
            artifact: "已填充的 PLAN.md(至少一个任务)",
            detail: "缺失、无任务、任务格式无法解析或任务编号复用了已占用的编号",
            requirement:
              "必须直接编辑 PLAN.md,把本阶段任务按 `## T-NNN: <任务标题> [pending]` 格式写入" +
              "(至少一个;即使认为本阶段无事可做,也要写入一个说明性任务并在正文说明原因)。" +
              (numberStart === undefined
                ? ""
                : `任务编号必须自 T-${String(numberStart).padStart(3, "0")} 起连续递增——更早的编号已被历史任务占用,复用视为无效产出。`),
            commit: { stage: "phase-plan", subject: `PLAN plan ${phase} ${phaseText(phase)}` },
            reset: async () => {
              await Bun.write(path, renderPlanScaffold(opts.verify === true))
            },
            collect: async () => {
              const fresh = await load(path).catch(() => undefined)
              if (!fresh?.tasks.length) return undefined
              // 自动编号: 复用已占用编号(小于记录起点)视为无效产出,带反馈重试。
              if (numberStart !== undefined && fresh.tasks.some((task) => (taskNumber(task.id) ?? numberStart) < numberStart)) return undefined
              return fresh.tasks.length
            },
          },
        )
        if (typeof planned !== "number") {
          if (planned.type === "dirty") {
            log(`⏸ 阶段规划会话启动前工作区不净,请人工处置(提交/清理)后重新运行:`)
            for (const file of planned.files) log(`  ${file}`)
          } else {
            log(`⏸ 阶段规划会话受阻(隐性阻塞,请检查后重新运行):\n${planned.question}`)
          }
          return 2
        }
        // 自动编号: 规划成功即把编号记录推进到本次最大编号 + 1(只增不减),
        // 后续阶段/轮次的规划会话自该记录续接,编号在目标目录永不重复。
        if (numberStart !== undefined) {
          const next = await advanceNextTask(directory, (await load(path)).tasks.map((task) => task.id))
          log(`✓ 编号记录推进: 下一可用任务编号 T-${String(next).padStart(3, "0")}(${NEXT_TASK_FILE})`)
        }
        log(`✓ 阶段规划完成: PLAN.md 已填入 ${planned} 个任务`)
        // 收口: 删除本步骤的 driver 侧恢复点(产物已校验、提交与编号推进均完成)。
        // 在此之前被 kill → 记录仍 active,下次运行经 openStep 重入规划并复用会话。
        await closeStep(directory, "phase-plan", phase)
        return 0
      } finally {
        await reprotect(path)
      }
    }

    // 阶段交接(F 节,轮次专用目录方案起 docs 永不移动): ① 蒸馏会话(AI 唯一职责,
    // 旁路一次性)产出永久路径交接文档(新布局轮内 docs/R-NN/handovers/<字母>-
    // <slug>.md,driver 先建目录,落定不移动)→ ② PLAN.md 拷贝进阶段归档目录后
    // 重置空模板(归档只收过期状态文件,本阶段 docs/ 产物不动)→ ③ 台账追加 →
    // ④ 统一提交(Auto-Stage: phase-transition)。各步幂等,中断重跑自然续完
    // (C.2)。返回 0 = 交接完成,2 = 蒸馏会话隐性阻塞。
    const handoverPhase = async (phase: Phase): Promise<number> => {
      const letters = [...phases] as Phase[]
      const nextLetter = letters[letters.indexOf(phase) + 1]
      const next = nextLetter ? `${nextLetter} ${phaseText(nextLetter)}` : undefined
      const target = next ?? "流程完成"
      banner(`阶段交接: ${phase} ${phaseText(phase)} → ${target}`)
      // driver 先建 handovers/ 目录再开会话;handoverDoc 不在 protect 名单,无需 allowWrite。
      const round = await currentRound(directory)
      const handover = await handoverDoc(directory, round, phase)
      const handoverFile = join(directory, handover)
      await mkdir(dirname(handoverFile), { recursive: true })
      // 蒸馏幂等跳过 + ③ 补提交(commit-boundary-design.md P4): 交接文档已齐备
      // (四小节经 validHandover 校验)时不再重开蒸馏会话——上次中断在"蒸馏已产出、
      // driver 未收口"区间的现场直接续跑归档/台账;文档仍在未提交清单则先补提交
      // (产物落盘且已提交才算完成)。部分写就(小节不全)照常走蒸馏: reset 清文件
      // 重来,step 恢复点(openStep)仍可复用原会话续写。
      const distillTask = { id: "PLAN", title: `阶段交接蒸馏(${phase} ${phaseText(phase)})`, status: "in_progress" as const, attempts: 0, body: "" }
      const distillCommit = { stage: "phase-handover", subject: `PLAN handover ${phase} ${phaseText(phase)}` }
      if (validHandover(await Bun.file(handoverFile).text().catch(() => ""))) {
        const pending = await commitPending(directory, opts, distillTask, distillCommit, [handover])
        if (pending !== "clean") {
          if (!pending.ok) {
            log(`⏸ 交接文档补提交失败: ${pending.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")},请人工处理后重新运行`)
            return 2
          }
          log(`✓ 交接文档已产出但尚未提交,已补提交: ${handover}`)
        }
        log(`↻ 交接文档 ${handover} 已齐备,跳过蒸馏会话直接进入归档`)
      } else {
        log(`▶ 开交接蒸馏会话产出 ${handover}`)
        const distilled = await requireArtifact(
          serverHandle.client,
          distillTask,
          renderPhaseHandover({ phase, handover, next, verify: opts.verify }),
          {
            agent: agentName,
            dir: directory,
            verbose: opts.verbose,
            waitAnswer: opts.waitAnswer,
            commit: opts.commit,
            contextLimit: opts.contextLimit,
            permission: opts.permission,
            interactive: repl,
            server: serverHandle,
          },
          {
            kind: "交接蒸馏",
            step: { step: "phase-handover", letter: phase },
            // 独立隐藏任务单元: 启动 clean 门禁 + SHA 基线 + 收口校验
            // (commit-boundary-design.md;部分写就的交接文档由 reset 清理重写)。
            unitStart: true,
            artifact: `有效交接文档 ${handover}(四个必备小节齐备)`,
            detail: "缺失或小节不全",
            requirement:
              `必须把交接文档写入 ${handover},并包含标题逐字为` +
              "「## 关键决策」「## 约束与坑」「## 下一阶段必读清单」「## 产物索引」的四个小节。",
            commit: distillCommit,
            reset: () => rm(handoverFile, { force: true }),
            collect: async () => {
              const text = await Bun.file(handoverFile).text().catch(() => "")
              return validHandover(text) || undefined
            },
          },
        )
        if (distilled !== true) {
          if (distilled.type === "dirty") {
            log(`⏸ 交接蒸馏会话启动前工作区不净,请人工处置(提交/清理)后重新运行:`)
            for (const file of distilled.files) log(`  ${file}`)
          } else {
            log(`⏸ 交接蒸馏会话受阻(隐性阻塞,请检查后重新运行):\n${distilled.question}`)
          }
          return 2
        }
      }
      // 收口: 蒸馏会话(本步骤唯一的 AI 环节)已产出有效交接文档并提交,删除 driver
      // 侧恢复点。其后的归档/重置/台账为幂等的 driver 记账,中断由 runPhaseLoop 的
      // "交接中断恢复"(归档 PLAN 已在而台账缺行)兜底,不再依赖会话恢复。
      await closeStep(directory, "phase-handover", phase)
      const archivedPlan = join(directory, await phaseArchive(directory, round, phase), "PLAN.md")
      await mkdir(dirname(archivedPlan), { recursive: true })
      await Bun.write(archivedPlan, await Bun.file(path).text())
      await allowWrite(path)
      await Bun.write(path, renderPlanScaffold(opts.verify === true))
      await reprotect(path)
      log("  本阶段 PLAN.md 已归档,PLAN.md 重置为空模板")
      await appendLedger(directory, phase)
      // AGENTS.md 只校验不改写(F.2): 超 150 行在交接提交信息与终端 note 提示人工精简。
      const agentsLines = (await Bun.file(join(directory, "AGENTS.md")).text().catch(() => "")).trimEnd().split("\n").length
      const fat = agentsLines > 150 ? `AGENTS.md ${agentsLines} 行超过 150 行上限,请人工精简` : undefined
      if (fat) log(`ℹ ${fat}`)
      if (opts.commit !== false) {
        // 交接提交是阶段单元的收口落账(归档/重置/台账),提交失败 → 阻塞退出 2
        // 交人工: 台账已追加,重跑会按台账路由到下一阶段,遗留未提交改动由人工
        // 处置后继续(commit-boundary-design.md P3)。
        const settled = await commitTree(directory, { id: "PLAN", title: `阶段交接(${phase} ${phaseText(phase)})` }, {
          stage: "phase-transition",
          subject: `PLAN transition ${phase} ${phaseText(phase)} → ${target}${fat ? `(${fat})` : ""}`,
        })
        if (!settled.ok) {
          log(
            `⏸ 阶段交接提交失败: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}。` +
              `归档/台账改动保留在工作区(台账已追加),请人工提交后重新运行`,
          )
          return 2
        }
      }
      // 阶段代答汇总(auto-resolve-design.md §H-③,H6): 置顶于 ■ 收口行之前。
      for (const line of await phaseResolveLines(directory, phase)) log(line)
      // 阶段收口行(STATS_PLAN §4.3,T-006): commitTree 之后、return 0 之前——
      // 交接提交时长仍计入本阶段桶(读数实时外推,含当前开放段)。
      const closing = await phaseCloseLines(directory, phase)
      if (closing) for (const line of closing) log(line)
      return 0
    }

    // --phases 阶段循环(D.1): 推导 currentPhase → PLAN.md 空则开规划会话 → 主循环
    // 执行 → 本阶段任务全 done 交接 → 台账追加推导下一阶段;全部阶段完成退出 0。
    // 台账非法等环境错误退出 1(H 节)。--final-review 终审闭环仅 m 阶段挂接
    // (runTaskLoop 的 finalGate),其余阶段忽略并提示。
    // 步进暂停(phase 边界,OPENCODE_AUTO_STEP ≥ phase): 交接(归档+台账+提交)
    // 完成后、下一轮路由前硬暂停——最后一个阶段暂停后回车即「全部阶段已完成」退出。
    const handoverWithStep = async (phase: Phase): Promise<number> => {
      const code = await handoverPhase(phase)
      if (code !== 0) return code
      await stepPause("phase", `阶段 ${phase} ${phaseText(phase)} 交接`, { interactive: repl, dir: directory })
      maybeExit("phase", `阶段 ${phase} ${phaseText(phase)} 交接`)
      // failback 回试(phase 边界): 所有粒度都在阶段边界重置——phase 粒度的跨任务
      // sticky holder 在此清零;/failback 请求同点消费。
      clearSticky()
      consumeFailback()
      return 0
    }
    const runPhaseLoop = async (): Promise<number> => {
      if ((opts.finalReview ?? 0) > 0) {
        log("ℹ 终审闭环(--final-review)仅作用于 m(迁移实现)阶段,其余阶段完成时不进入")
      }
      for (;;) {
        const route = await routePhase(directory, await load(path), phases)
        if (route.type === "blocked") {
          log(`⏸ 阶段流程受阻: ${route.reason}`)
          return 1
        }
        if (route.type === "complete") {
          log("✓ 全部阶段已完成")
          for (const line of await roundResolveLines(directory)) log(line)
          // 轮次完成行(STATS_PLAN §4.4,T-006): 阶段数取台账 done 计数(本轮已
          // 交接阶段);历轮累计段在 history.rounds > 0 时由构造函数自行追加。
          const lines = await roundCompleteLines(directory, { phaseCount: (await readLedger(directory)).done.length })
          if (lines) for (const line of lines) log(line)
          return 0
        }
        // 阶段切换挂点(STATS_PLAN §3): 字母变化重置 phase 桶;相同字母幂等。
        // blocked 已 return、complete 即将退出,均无需切换。
        await statsPhase(directory, route.phase)
        // 会话恢复优先于文件推导路由(docs/session-resume-precedence-design.md):
        // driver 侧仍有未收口的阶段步骤恢复点(上次运行的规划/交接会话被中断、driver
        // 未完成收口)→ 重入该步骤并复用中断的会话,即使 PLAN.md/台账已让文件推导路由
        // 前进。PLAN.md 任务与交接文档是 AI 写的(或会话中断后才由 driver 补的),不能
        // 证明会话已收口;唯有 driver 的恢复点被 closeStep 删除才算收口。仅当步骤归属
        // 阶段 == 当前路由阶段且该阶段未入台账时生效: 字母不一致(人工回退/陈旧记录)
        // 让文件路由优先并告警,阶段已入台账则清除陈旧记录。
        const open = await openStep(directory)
        if (open) {
          const ledger = await readLedger(directory)
          if (ledger.done.includes(open.letter)) {
            await closeStep(directory, open.step, open.letter)
          } else if (open.letter === route.phase) {
            log(
              `↻ 会话恢复点优先: ${open.step === "phase-plan" ? "阶段规划" : "阶段交接"}会话` +
                `(${open.letter} ${phaseText(open.letter)})未收口,重入该步骤续跑`,
            )
            if (open.step === "phase-plan") {
              banner(`${open.letter} ${phaseText(open.letter)} 阶段规划`)
              const code = await planPhase(open.letter)
              if (code !== 0) return code
              continue
            }
            // 交接重入仅当文件路由也是 handover(本阶段任务全部 done): 否则(尚有
            // 未完成任务的异常态)归档+重置会丢未完成任务,让文件路由优先并告警。
            if (route.type === "handover") {
              const code = await handoverWithStep(open.letter)
              if (code !== 0) return code
              continue
            }
            log(
              `⚠ 未收口的交接恢复点(${open.letter})与当前路由(${route.type})不一致` +
                `(尚有未完成任务?),按文件推导路由继续,不重入交接以免丢失未完成任务`,
            )
          } else {
            log(
              `⚠ 未收口的阶段步骤恢复点(${open.step} ${open.letter})与当前路由阶段(${route.phase})不一致,` +
                `按文件推导路由继续(如为人工回退请忽略;否则检查 .auto/progress.json)`,
            )
          }
        }
        if (route.type === "plan") {
          // 交接中断恢复(C.2 幂等性): 归档目录内已有归档 PLAN.md 而台账未记录 =
          // 交接在"重置 PLAN.md 之后、台账追加之前"中断——补写台账并提交,不重新
          // 规划本阶段(更早中断时 PLAN.md 仍有任务,路由为 handover,完整重跑交接)。
          const interrupted =
            (await stat(join(directory, await phaseArchive(directory, await currentRound(directory), route.phase), "PLAN.md")).then(() => true, () => false)) &&
            !(await readLedger(directory)).done.includes(route.phase)
          if (interrupted) {
            log(`↻ 恢复中断: ${route.phase} ${phaseText(route.phase)} 阶段交接已归档与重置,补写台账后进入下一阶段`)
            await appendLedger(directory, route.phase)
            if (opts.commit !== false) {
              await commitTree(directory, { id: "PLAN", title: `阶段交接(${route.phase} ${phaseText(route.phase)})` }, {
                stage: "phase-transition",
                subject: `PLAN transition ${route.phase} ${phaseText(route.phase)}(中断恢复补账)`,
              })
            }
            continue
          }
          // k(知识提炼)阶段整体认领 --extract-knowledge 设计(P4): 不开规划会话、
          // 不向 PLAN.md 填任务——plan 路由直接进入知识提取旁路会话(产物为永久路径:
          // 新布局轮内 docs/R-NN/migration-kb.md,旧布局 docs/migration-kb/R<N>-…;
          // 本轮文档已产出则幂等跳过),随后照常交接。提取失败只打 ⚠ 警告、不污染
          // 退出码(迁移成功不被文档生成失败反向污染);人工在 k 阶段自行向 PLAN.md
          // 填任务时走通用 execute/handover 路由,提取挂点不触发。
          if (route.phase === "k") {
            banner("k 知识提炼: 迁移知识沉淀")
            const extracted = await extractKnowledge(serverHandle.client, directory, {
              agent: agentName,
              dir: directory,
              verbose: opts.verbose,
              waitAnswer: opts.waitAnswer,
              commit: opts.commit,
              contextLimit: opts.contextLimit,
              permission: opts.permission,
              interactive: repl,
              server: serverHandle,
              mode: opts.mode,
            })
            if (extracted.type === "ok") log(`✓ 迁移知识文档已产出: ${extracted.file}`)
            else if (extracted.type === "skipped") log(`↻ 迁移知识文档已产出(${extracted.file}),跳过提取,直接进入交接`)
            else if (extracted.type === "dirty") {
              // dirty(commit-boundary-design.md ④ 推广): 工作区不净(上次提取半途而废
              // 的现场、补提交失败或统一提交失败)必须停机交人工——照常交接会让下一个
              // 单元在不干净的基线上启动,破坏提交边界。
              log(`⏸ 迁移知识提取无法在干净基线上完成或收账,请人工处置(提交/清理)后重新运行:`)
              for (const file of extracted.files) log(`  ${file}`)
              return 2
            } else {
              log(
                `⚠ 迁移知识沉淀未完成(knowledge_extraction_error),退出码不受影响,k 阶段照常交接;` +
                  `可修复问题后按人工回退规程(删本轮台账 k 行与本轮迁移知识文档)重跑单独重试。受阻详情:\n${extracted.question}`,
              )
            }
            const code = await handoverWithStep("k")
            if (code !== 0) return code
            continue
          }
          banner(`${route.phase} ${phaseText(route.phase)} 阶段规划`)
          const code = await planPhase(route.phase)
          if (code !== 0) return code
          continue
        }
        if (route.type === "execute") {
          const code = await runTaskLoop(route.phase)
          if (code !== 0) return code
          continue
        }
        const code = await handoverWithStep(route.phase)
        if (code !== 0) return code
      }
    }
    return await runPhaseLoop()
  } catch (error) {
    // /exit(设计文档 docs/exit-resume-design.md): 三处安全边界(phase/task/
    // subtask,后者经 runTask 从 runner.ts 一路上抛)命中后在此统一落地——已停
    // 在该边界的正常收尾点(PLAN.md/CURRENT.md/.auto/progress.json 均已写好,
    // 与该处真实 crash/kill 中断的现场同构),退出码 3 区别于 2(阻塞/pending
    // 需人工介入):重新运行即可精确恢复,不需要任何人工操作。
    if (error instanceof ExitRequested) {
      log(`⏸ ${error.message},进度已保存,重新运行即可完整恢复`)
      return 3
    }
    throw error
  } finally {
    process.off("SIGINT", onSigint)
    repl?.close()
    watcher?.close()
    progress?.close()
    // 统计优雅收口(STATS_PLAN §1): fold 开放段后关段落盘并卸载句柄;下次
    // loadStats 无折旧可读。写失败内部静默,不影响退出码。
    await flushStats(directory)
    // 托管句柄(managed)的生命周期归调用方,此处不关闭。
    if (!opts.managed) server?.close()
    await unprotect(directory)
  }
}

// --wait-between: 任务完成后、下一任务开始前暂停等待人工;回车(任意输入)
// 立即继续,超时自动继续。与 runner 的 askHuman 一样转发 readline 截获的 ^C,
// 使暂停期间连续两次 Ctrl+C 同样能强制终止。
// --interactive 下改由常驻输入行接收(语义不变),避免两个 readline 争抢 stdin。
// dir 传入时等待区间经 statsWaitBegin/End 从总用时/AI 用时扣除、单记 waitMs
// (STATS_PLAN §3 三处人工等待点之一);导出供单测直驱(对齐 subtaskProgressLine)。
export async function waitBetweenTasks(minutes: number, nextID: string, repl?: Interactive, dir?: string) {
  const promptText = `⏸ 任务间暂停: 回车立即开始 ${nextID},或等待 ${minutes} 分钟自动继续: `
  await statsWaitBegin(dir, "waitBetweenTasks")
  try {
    if (repl) {
      const answer = await repl.question(promptText, minutes)
      log(answer === undefined ? `⏳ 等待超时,自动继续 ${nextID}` : `→ 人工确认,继续 ${nextID}`)
      return
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.on("SIGINT", () => process.kill(process.pid, "SIGINT"))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const answer = await Promise.race([
        rl.question(promptText),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), minutes * 60_000)
        }),
      ])
      log(answer === undefined ? `⏳ 等待超时,自动继续 ${nextID}` : `→ 人工确认,继续 ${nextID}`)
    } finally {
      clearTimeout(timer)
      rl.close()
    }
  } finally {
    await statsWaitEnd(dir)
  }
}

// Verbose mode: every 10s list files newly appearing in `git status`
// (modified, staged, or untracked), so a human watching the terminal can
// follow the agent's progress on disk.
function watchFiles(directory: string) {
  let seen = new Set<string>()
  const timer = setInterval(async () => {
    const changed = await changedFiles(directory).catch(() => [] as string[])
    const fresh = changed.filter((file) => !seen.has(file))
    seen = new Set(changed)
    if (fresh.length) vlog(`  ✎ 变更文件:\n${fresh.map((file) => `    ${file}`).join("\n")}`)
  }, 10_000)
  return { close: () => clearInterval(timer) }
}

// 每 10 分钟重读 PLAN.md,上报当前任务的子任务勾选进度与剩余时间估计(估计为
// 已完成项的线性外推,精度受该检查间隔约束)。
function trackSubtasks(path: string, directory: string) {
  const timer = setInterval(() => {
    void subtaskProgressLine(path, directory)
      .then((line) => line && log(line))
      .catch(() => {}) // 统计永不影响流程: 读数/解析异常静默,下次心跳重试
  }, 10 * 60_000)
  return { close: () => clearInterval(timer) }
}

// 进度心跳文案(plans/STATS_PLAN.md §4.5): 任务用时改读 stats 任务桶的跨中断
// 累计(含开放段实时外推),取代原内存 since——进程重启后首次外推即可信。
// 返回完整报文行;无可上报对象(无任务/无子任务)或守卫失败返回 undefined。
// 守卫 statsId === task.id: task 桶身份与当前任务一致才可信(statsTask 切换前
// 的窗口期、或未装载句柄时 statsId 为 undefined)。
// AUTO-DECISION: 守卫失败时跳过本次上报(返回 undefined),不保留内存 since 兜底。
// 备选"守卫失败退回内存计时"会在跨中断重启后的守卫真空期回到旧的外推失真问题,
// 且双口径并存使文案时而有累计、时而只有本进程,展示口径漂移;心跳 10 分钟一次,
// 跳过一次的代价远小于口径失真,否决。
export async function subtaskProgressLine(path: string, directory: string): Promise<string | undefined> {
  const plan = await load(path).catch(() => undefined)
  const task = plan && (plan.tasks.find((t) => t.status === "in_progress") ?? next(plan))
  if (!task) return undefined
  const { done, total } = countSubtasks(task.body)
  if (!total) return undefined
  if (statsId(directory) !== task.id) return undefined
  const totals = await statsTotals(directory, "task")
  const boot = await statsBoot(directory)
  if (!totals || !boot) return undefined
  const elapsed = totals.wallMs
  const estimate = done ? formatDuration((elapsed / done) * (total - done)) : "未知(尚无已完成的子任务)"
  const totalText = formatDuration(elapsed)
  const localText = formatDuration(elapsed - boot.task.wallMs)
  // "本进程"仅当 ≠ 累计时输出(未中断时两者相等,文案等价现状);按格式化结果
  // 比较,差值不足 1 秒(舍入相同)时不打。
  const local = localText === totalText ? "" : `(本进程 ${localText})`
  return `  ⏳ ${task.id} 子任务进度 ${done}/${total},累计用时 ${totalText}${local},预计剩余 ${estimate}`
}

// 启动续接横幅(plans/STATS_PLAN.md §4.6): 快照取自折旧入账之后、轮次滚动之前,
// round/phase/task 均为上一进程停下时的位置;task 缺失(上一进程停在非任务段
// 或桶 id 损坏)省略任务段。
function resumeBanner(resumed: StatsResume): string {
  const parts = [`第 ${resumed.round} 轮`]
  if (resumed.phase) parts.push(`${resumed.phase} 阶段`)
  if (resumed.task) {
    parts.push(`${resumed.task} 已累计 ${formatDuration(resumed.taskWallMs)}(AI ${formatDuration(resumed.taskAiMs)})`)
  }
  const at = new Date(resumed.lastWriteAt).toTimeString().slice(0, 5)
  return `↻ 统计续接: ${parts.join(" / ")},上次进程止于 ${at}`
}

// ===== 代答高亮块(docs/auto-resolve-design.md §H,H5/H6)=====
// 三处置顶块与下面三处结论行一一配对: 高亮先打、结论行后打(§H-② 的版面顺序——
// 用户先看见"系统替我做了什么主",再看统计)。构造与 log 分离的理由同结论行: 文案
// 可单测直驱(test/loop-conclusion.test.ts),loop 主体只负责 log。
// 三者一律返回数组(空数组 = 没有代答,不占任何版面),与结论行的 undefined 语义
// 刻意不同: 结论行的 undefined 表示"守卫失败、读数不可信",调用方要回落旧文案;
// 高亮块没有守卫失败这一态——台账读不到就是没有代答。
// 台账读失败(损坏/权限)一律吞成空: 审计永不影响流程与退出码。

// 任务置顶块(H5): 打在 ✓/⏸ 结论行之前。AUTO-DECISION 计数经 decisionsOf 折进末行
// (§H-④),没有代答时整块为空、该计数也随之不上终端(它在会话收尾已进 vlog)。
export async function taskResolveLines(directory: string | undefined, taskID: string): Promise<string[]> {
  const items = await resolvesOf(directory, "task", taskID).catch(() => [])
  if (!items.length) return []
  const decisions = await decisionsOf(directory, taskID).catch(() => 0)
  return resolveHighlight(items, { scope: "task", id: taskID, decisions })
}

// 阶段置顶块(H6): 打在 ■ 阶段收口行之前,只给计数(逐条已在各任务结束时展示过)。
export async function phaseResolveLines(directory: string | undefined, letter: Phase): Promise<string[]> {
  const items = await resolvesOf(directory, "phase", letter).catch(() => [])
  return resolveHighlight(items, { scope: "phase", id: letter })
}

// 轮次置顶块(H6): 打在 ■ 轮次完成行之前。轮号取 currentRound 现查——落账侧
// (runner 的 collectSessionMarks/recordDriverResolves)用的就是同一来源,两侧同源
// 才不会错桶;失败取 0,与落账侧的 catch 回落一致。
export async function roundResolveLines(directory: string | undefined): Promise<string[]> {
  if (!directory) return []
  const round = await currentRound(directory).catch(() => 0)
  const items = await resolvesOf(directory, "round", round).catch(() => [])
  return resolveHighlight(items, { scope: "round", id: round })
}

// ===== T-006 结论行报文(plans/STATS_PLAN.md §4.2/4.3/4.4)=====
// 三处结论行(任务三态/阶段收口/轮次完成)统一在这里构造,loop 主体只负责 log。
// tokens 行与 T-004 ◉ 会话结束行 2 共用 log.ts 的 formatUsageLine,格式不漂移。

// 任务结束三态行的统计段(done/blocked/incomplete 共用,§4.2): 返回
// [`用时 W(AI A[,其中本进程 P]),会话 N 次`, tokens 行] 两件套,由调用方拼状态
// 前缀(✓ 完成 / ⏸ 阻塞 / ⏸ 未完成)。桶为任务桶跨中断累计(含中断前)。守卫
// statsId === taskID(与 subtaskProgressLine 同一理由:桶身份不符时读数不可信),
// 守卫失败返回 undefined,调用方回落 T-006 前的旧文案(done)或不打印(blocked/
// incomplete 原本就无统计行)。
// AUTO-DECISION: "本进程"取墙钟差(wallMs − boot.task.wallMs)。草案"其中本进程"
// 紧邻 AI 一词,有 AI 子集读法;但 T-002 进度心跳行(本文件 subtaskProgressLine)
// 已把"本进程"确立为同一任务桶的墙钟口径,同一措辞跨报文行必须同义,且主语
// "用时"本身是墙钟——备选"AI 子集"会造成心跳行与结论行同词异义,否决。按格式
// 化结果比较,差值不足 1 秒(舍入相同)时不打(与心跳行同手法)。
export async function taskEndLines(directory: string | undefined, taskID: string): Promise<string[] | undefined> {
  if (statsId(directory) !== taskID) return undefined
  const totals = await statsTotals(directory, "task")
  const boot = await statsBoot(directory)
  if (!totals || !boot) return undefined
  const wall = formatDuration(totals.wallMs)
  const local = formatDuration(totals.wallMs - boot.task.wallMs)
  const since = local === wall ? "" : `,其中本进程 ${local}`
  return [
    `用时 ${wall}(AI ${formatDuration(totals.aiMs)}${since}),会话 ${totals.sessions} 次`,
    formatUsageLine(totals.usage),
  ]
}

// 阶段收口行(§4.3,handoverPhase 末尾 commitTree 之后): [`■ 阶段 t 测试验证 收口:
// 总用时 W(含规划/交接/提交;AI A[,人工等待 Z]),任务 T 个 / 会话 S 次`, tokens 行]。
// 阶段桶含规划/交接蒸馏等旁路会话(旁路归 phase+round 桶,见 stats.ts 接线注释),
// 与"含规划/交接/提交"文案对应。守卫桶 id === letter(字母不符 = 桶已被后续阶段
// 重置,不打印)。
// AUTO-DECISION: 人工等待段仅 waitMs > 0 时输出(轮次行同理)——与费用/思考项的
// 0 省略规则同风格,"人工等待 0 秒"是纯噪声;草案示例(waitMs = 3 分)未覆盖 0
// 情形,按既有省略惯例处理。
export async function phaseCloseLines(directory: string | undefined, letter: Phase): Promise<string[] | undefined> {
  const totals = await statsTotals(directory, "phase")
  if (!totals || totals.id !== letter) return undefined
  const wait = totals.waitMs ? `,人工等待 ${formatDuration(totals.waitMs)}` : ""
  return [
    `■ 阶段 ${letter} ${phaseText(letter)} 收口: 总用时 ${formatDuration(totals.wallMs)}` +
      `(含规划/交接/提交;AI ${formatDuration(totals.aiMs)}${wait}),任务 ${totals.tasks} 个 / 会话 ${totals.sessions} 次`,
    formatUsageLine(totals.usage),
  ]
}

// 轮次完成行(§4.4): 本轮 [`■ 第 N 轮完成: 总用时 W(AI A[,人工等待 Z]),[阶段 P / ]
// 任务 T / 会话 S`, tokens 行];phaseCount 仅分阶段路径提供(台账 done 计数 = 本轮
// 已交接阶段数),非分阶段路径省略阶段段(全程恒为 "m" 一个伪阶段,计数无信息)。
// history.rounds > 0 时追加两行历轮累计段(缩进两格,"历轮"前缀区别于本轮行)。
// 轮号取 roundB.id(loadStats 以 currentRound 快照建立并随轮次滚动重置);损坏缺失
// 时回落 currentRound 现查。
// AUTO-DECISION: 历轮累计单列两行,不并入本轮数字——计划只写"tokens 行含 history
// 历累计,rounds=0 省略历轮部分",未给并入格式;并入会把命中率/费用混成跨轮加权
// 值且破坏主行"本轮"语义。备选"并入主行加(累计…)"否决。
export async function roundCompleteLines(
  directory: string | undefined,
  opts?: { phaseCount?: number },
): Promise<string[] | undefined> {
  const totals = await statsTotals(directory, "round")
  if (!totals) return undefined
  // totals 非空即 directory 已定义(statsTotals 对 undefined 空转返回 undefined)。
  const round = Number(totals.id) || (await currentRound(directory as string).catch(() => 1))
  const wait = totals.waitMs ? `,人工等待 ${formatDuration(totals.waitMs)}` : ""
  const phasesPart = opts?.phaseCount !== undefined ? `阶段 ${opts.phaseCount} / ` : ""
  const lines = [
    `■ 第 ${round} 轮完成: 总用时 ${formatDuration(totals.wallMs)}(AI ${formatDuration(totals.aiMs)}${wait}),` +
      `${phasesPart}任务 ${totals.tasks} / 会话 ${totals.sessions}`,
    formatUsageLine(totals.usage),
  ]
  const history = await statsHistory(directory)
  if (history && history.rounds > 0) {
    const h = history.totals
    const hwait = h.waitMs ? `,人工等待 ${formatDuration(h.waitMs)}` : ""
    lines.push(
      `  历轮累计(${history.rounds} 轮): 总用时 ${formatDuration(h.wallMs)}(AI ${formatDuration(h.aiMs)}${hwait}),` +
        `任务 ${h.tasks} / 会话 ${h.sessions}`,
      `  历轮 ${formatUsageLine(h.usage)}`,
    )
  }
  return lines
}
