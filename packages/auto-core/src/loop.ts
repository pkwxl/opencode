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
  // Hibernate window startup check (OPENCODE_AUTO_HIBERNATE, D4): when starting
  // inside the window, sleep until window end + random delay before continuing,
  // so the first execution unit isn't wasted; dryrun permission preflight is
  // exempt (not a token-spending path).
  if (!opts.dryrun) await hibernatePause("startup", { dir: directory })
  let server: ServerHandle | undefined
  // --interactive sideband input controller; created once the server is ready,
  // closed in finally.
  let repl: Interactive | undefined
  // A single Ctrl+C does not terminate (the event stream/subprocesses may
  // swallow or hang the default exit during a run); a second press within the
  // window force-terminates: best-effort restore file writability, close the
  // server, exit.
  let sigintAt = 0
  const onSigint = () => {
    const now = Date.now()
    if (now - sigintAt > 3000) {
      sigintAt = now
      log("⚠ Ctrl+C captured; press again within 3s to force-terminate the run")
      return
    }
    log("✋ consecutive Ctrl+C, force-terminating")
    server?.close()
    void unprotect(directory).finally(() => process.exit(130))
    // Backstop: exit even if cleanup hangs.
    setTimeout(() => process.exit(130), 1000).unref()
  }
  process.on("SIGINT", onSigint)
  try {
    // Phased flow: an invalid ledger is an environment error (section H); route
    // once ahead of server startup so we don't bring the service up just to
    // exit; the real routing is re-evaluated per round inside the phase loop
    // (derived state).
    const phases = opts.phases ?? "m"
    if (phases !== "m") {
      const pre = await routePhase(directory, await load(path), phases)
      if (pre.type === "blocked") {
        log(`⏸ phase flow blocked: ${pre.reason}`)
        return 1
      }
    }
    server = opts.managed ?? (await manage(directory, opts.server))
    if (opts.interactive) {
      repl = startInteractive(server.client, agentName)
      log("💬 interactive mode: Enter sends your input as an extra message to the current session (discarded when no session is active); /exit pauses at the next safe boundary, re-run to resume")
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
        log(`⏸ preflight session blocked:\n${result.question}`)
        return 2
      }
      log(`✓ permission preflight complete; report written to .auto/dryrun.md, highlights:\n\n${result.lastText}`)
      return 0
    }
    // The advanceFinal closure would lose narrowing; capture the ready server
    // handle as const.
    const serverHandle = server
    const ctx: LoopCtx = { directory, path, opts, server: serverHandle, agentName, phases, repl, ran: 0 }

    if (phases === "m") {
      // Non-phased path: attribute the whole run to the "m" phase bucket
      // (STATS_PLAN §3).
      await statsPhase(directory, "m")
      return await runTaskLoop(ctx, "m")
    }

    return await runPhaseLoop(ctx)
  } catch (error) {
    // /exit (design doc plans/0014-exit-resume-design.md): the three safe
    // boundaries (phase/task/subtask, the latter thrown up from runner.ts via
    // runTask) land here uniformly — the run has stopped at that boundary's
    // normal wrap-up point (PLAN.md/CURRENT.md/.auto/progress.json all
    // written, isomorphic to a real crash/kill interruption at the same spot);
    // exit code 3 differs from 2 (blocked/pending, needs manual action):
    // re-running resumes precisely with no manual operation.
    if (error instanceof ExitRequested) {
      log(`⏸ ${error.message}, progress saved, re-run to resume fully`)
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
