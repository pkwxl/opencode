import { ExitRequested } from "./exit"
import { hibernatePause } from "./hibernate"
import { startInteractive, type Interactive } from "./interactive"
import { acquireRunLock, lockLines } from "./lock"
import type { LoopCtx } from "./loop-task"
import { runPhaseLoop } from "./loop-phase"
import { log } from "./log"
import { currentRound, phaseLabel, phaseTailDrift, routePhase, type PhaseUnit } from "./phases"
import { roundDirName } from "./docpaths"
import { renderDryrun } from "./prompt"
import { setClassifyUsageSink } from "./classify"
import { logRunRouting, routingFacts } from "./routing"
import { unprotect } from "./protect"
import { runOnce } from "./runner"
import type { AgentPool } from "./agent-pool"
import { startPool } from "./agent-pool"
import { shellProfile } from "./shell"
import { flushStats, statsClassifyUsage } from "./stats"

// RunAllOpts is runAll's signature; the preflight segment owns it.
import { preflight, type RunAllOpts } from "./loop-preflight"
export type { RunAllOpts }

// Exit codes: 0 = all tasks done, 1 = usage/setup error, 2 = blocked, waiting
// for a human to resolve the issue outside the session and re-run,
// 130 = force-killed by double Ctrl+C. A blocked
// task needs no `answer`: re-running resumes it directly.

export async function runAll(directory: string, opts: RunAllOpts): Promise<number> {
  // The run lock (plans/0053 D3): taken before preflight's first write and held
  // to the end, so no second process runs or rewrites the config here
  // meanwhile; a caller already holding it re-enters. preflight's exits sit
  // outside runLocked's try/finally (plans/0024 §I D13), hence this one of its
  // own.
  const lock = acquireRunLock(directory, "run")
  if (!lock.ok) {
    for (const line of lockLines(directory, lock.holder)) log(line)
    return 1
  }
  try {
    return await runLocked(directory, opts)
  } finally {
    lock.release()
  }
}

async function runLocked(directory: string, opts: RunAllOpts): Promise<number> {
  const pre = await preflight(directory, opts)
  if ("exit" in pre) return pre.exit
  const { agentName, watcher, progress, registry } = pre
  // Hibernate window startup check (OPENCODE_AUTO_HIBERNATE, D4): when starting
  // inside the window, sleep until window end + random delay before continuing,
  // so the first execution unit isn't wasted; dryrun permission preflight is
  // exempt (not a token-spending path).
  if (!opts.dryrun) await hibernatePause("startup", { dir: directory })
  let server: AgentPool | undefined
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
    // A missing or invalid phase or task index is an environment error
    // (section H); route once ahead of server startup so we don't bring the
    // service up just to exit; the real routing is re-evaluated per round
    // inside the phase loop (derived state). The no-phase mode ("m") is the
    // manual single phase R-01/P01-implement and routes the same way.
    const phases = opts.phases ?? "m"
    if (!opts.dryrun) {
      const pre = await routePhase(directory)
      if (pre.type === "blocked") {
        log(`⏸ phase flow blocked: ${pre.reason}`)
        return 1
      }
      // A phase-index drift (plans/0053 D34): the phases value (config
      // `phases`) changed after the round was established, so the index's
      // unstarted tail no longer matches it. run does not re-sync (Q4): the
      // sync is a lifecycle step, and lifecycle belongs to plan — a silent
      // re-sync here would start work on a phase list nobody reviewed. A
      // value the sync would refuse (dropping a completed phase, a directory
      // that holds work) stops the same way, with plannedPhaseUnits's own
      // error.
      const { bin } = shellProfile()
      const sides = (units: readonly PhaseUnit[]) => units.map(phaseLabel).join(", ")
      try {
        const drift = await phaseTailDrift(directory, await currentRound(directory), phases)
        if (drift) {
          log(
            `⏸ the phase index of round ${roundDirName(drift.round)} (${sides(drift.index)}) differs from config phases (${sides(drift.planned)}): ` +
              `run ${bin} plan ${directory} to re-sync its unstarted phases`,
          )
          return 1
        }
      } catch (error) {
        log(`⏸ phase flow blocked: ${error instanceof Error ? error.message : String(error)}`)
        return 1
      }
    }
    // Start the run's agent hosts (src/agent-pool.ts) and degrade the
    // switches the fleet cannot serve; a configuration with no fallback
    // stops here. Under a model registry no host starts yet — the pool
    // starts each agent profile's host lazily on its first selection
    // (plans/0055 §8.1); without one this starts the single agent exactly
    // as before (C2).
    const started = await startPool(directory, { ...opts, registry })
    server = started.pool
    if (started.error !== undefined || server === undefined) {
      log(`⏸ ${started.error}`)
      return 1
    }
    // The run's routing facts (plans/0055 §6): fixed once the agent choice is
    // known, held by every dispatch through Opts.routing. The run-start block
    // (§6.5) prints the routing in force; without a registry nothing changes.
    // runAgent is the run's start profile (§8.2): unqualified session records
    // and raw override values resolve through it, while each dispatch's chain
    // names the profile its session truly lives on.
    const routing = registry ? routingFacts(registry, opts.agent, started.profileName) : undefined
    if (routing) logRunRouting(routing)
    // The classifier's token booking (plans/0055 §7.1 "Stats"): under a
    // registry the failure-message classifier's one-shot sessions report their
    // usage into the stats `classify` bucket — outside the unit's session
    // totals. The sink is dropped again in the finally below, before the stats
    // handle flushes; without a registry no classifier exists, so nothing is
    // registered and the run stays byte-identical (C2).
    if (routing) setClassifyUsageSink((usage) => void statsClassifyUsage(directory, usage))
    if (opts.interactive) {
      repl = startInteractive((agent) => server!.client(agent), agentName, undefined, routing ? new Set(routing.registry.models.keys()) : undefined)
      log("💬 interactive mode: Enter sends your input as an extra message to the current session (discarded when no session is active); /exit pauses at the next safe boundary, re-run to resume")
    }
    if (opts.dryrun) {
      const result = await runOnce(server, "permission preflight", renderDryrun(), {
        agent: agentName,
        dir: directory,
        verbose: opts.verbose,
        waitAnswer: opts.waitAnswer,
        dryrun: true,
        contextLimit: opts.contextLimit,
        interactive: repl,
        server,
        routing,
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
    const ctx: LoopCtx = { directory, opts, server: serverHandle, agentName, phases, manual: phases === "m", repl, ran: 0, input: opts.planInput, append: opts.append, routing }
    return await runPhaseLoop(ctx)
  } catch (error) {
    // /exit (design doc plans/0014-exit-resume-design.md): the three safe
    // boundaries (phase/task/subtask, the latter thrown up from runner.ts via
    // runTask) land here uniformly — the run has stopped at that boundary's
    // normal wrap-up point (unit state files and .auto/progress.json all
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
    // Drop the classifier's usage sink before the stats handle flushes, so a
    // late answer cannot book into a re-loaded handle after the run's end.
    setClassifyUsageSink(undefined)
    // 统计优雅收口(STATS_PLAN §1): fold 开放段后关段落盘并卸载句柄;下次
    // loadStats 无折旧可读。写失败内部静默,不影响退出码。
    await flushStats(directory)
    // 托管句柄(managed)的生命周期归调用方,此处不关闭。
    if (!opts.managed) server?.close()
    await unprotect(directory)
  }
}
