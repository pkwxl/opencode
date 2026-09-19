import { join } from "node:path"
import { ExitRequested } from "./exit"
import { hibernatePause } from "./hibernate"
// .gitignore 条目维护已上收至叶子模块 gitignore.ts(与 reset 成对);此处
// 再导出以保持既有导入路径 @opencode-ai/auto-core/loop 不变。
export { ensureGitignore } from "./gitignore"
import { startInteractive, type Interactive } from "./interactive"
import { runTaskLoop, type LoopCtx } from "./loop-task"
import { runPhaseLoop } from "./loop-phase"
import { log } from "./log"
import { load } from "./plan"
import { routePhase } from "./phases"
import { renderDryrun } from "./prompt"
import { unprotect } from "./protect"
import { runOnce } from "./runner"
import { manage, type ServerHandle } from "./server"
import { flushStats, statsPhase } from "./stats"

// AGENTS.md 的 opencode-auto 块(单一标记块,内容与幂等同步逻辑见 agents-block.ts):
// CURRENT.md 由 driver 整文件重写,块本身按当前配置渲染比对、不一致才整块替换。
// 块不强制每会话开读 CURRENT.md: 提示词已内联当前任务、子任务会话另有 context.md
// 背景摘要,无条件重读是纯开销;CURRENT.md 保留为上下文压缩后的兜底入口。
// AGENTS.md 作为 system context 每个 provider turn 现场重读,不随上下文压缩丢失;
// 它有更新时 driver 会在下一个新会话前重启 server,使新会话必定加载最新内容。
// AGENTS.md 不置只读(任务可更新它),run/init 只确保该块与当前配置渲染一致。
import { ensurePointer, renderAgentsBlock } from "./agents-block"
export { ensurePointer, renderAgentsBlock }

// agent 契约渲染与 RunAllOpts 随预检段下沉至 loop-preflight.ts;此处再导出以保持
// 既有导入路径 @opencode-ai/auto-core/loop 不变(migrate 壳取 renderAgentContract)。
import { preflight, type RunAllOpts } from "./loop-preflight"
export { renderAgentContract, type RunAllOpts } from "./loop-preflight"

// Exit codes: 0 = all tasks done, 1 = usage/setup error, 2 = blocked, waiting
// for a human to resolve the issue outside the session and re-run,
// 130 = force-killed by double Ctrl+C. A blocked
// task needs no `answer`: re-running resumes it directly.

export async function runAll(directory: string, opts: RunAllOpts): Promise<number> {
  const path = join(directory, "PLAN.md")
  const pre = await preflight(directory, path, opts)
  if ("exit" in pre) return pre.exit
  const { agentName, watcher, progress } = pre
  // 休眠窗口启动检查(OPENCODE_AUTO_HIBERNATE,D4): 启动即处于窗口内则先睡到窗口
  // 结束 + 随机延迟再继续,避免白做首个执行单元;dryrun 权限预检豁免(非烧钱路径)。
  if (!opts.dryrun) await hibernatePause("启动", { dir: directory })
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
    // advanceFinal 闭包内引用会失去窄化,以 const 捕获已就绪的 server 句柄。
    const serverHandle = server
    const ctx: LoopCtx = { directory, path, opts, server: serverHandle, agentName, phases, repl, ran: 0 }

    if (phases === "m") {
      // 非分阶段路径: 全程归 "m" 阶段桶(STATS_PLAN §3)。
      await statsPhase(directory, "m")
      return await runTaskLoop(ctx, "m")
    }

    return await runPhaseLoop(ctx)
  } catch (error) {
    // /exit(设计文档 plans/0014-exit-resume-design.md): 三处安全边界(phase/task/
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
