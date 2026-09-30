import { ExitRequested } from "./exit"
import { startRunEvents } from "./engine/events"
import { hibernatePause } from "./hibernate"
import { startInteractive, type Interactive } from "./interactive"
import { acquireRunLock, lockLines } from "./lock"
import type { LoopCtx } from "./loop-task"
import { runPhaseLoop } from "./loop-phase"
import { log } from "./log"
import { currentRound, phaseLabel, phaseTailDrift, routePhase, type PhaseUnit } from "./phases"
import { roundDirName } from "./docpaths"
import { renderDryrun } from "./prompt"
import { promptFacts } from "./prompt-facts"
import { logRunRouting, routingFacts } from "./routing"
import { unprotect } from "./protect"
import { runOnce } from "./runner"
import type { AgentPool } from "./agent-pool"
import { startPool } from "./agent-pool"
import { installServices, uninstallServices } from "./services"
import { shellProfile } from "./shell"
import { flushStats, statsClassifyUsage } from "./stats"
import { freezeSwitches } from "./switches"
import { loadPlan } from "./tasks"

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
  const { agentName, watcher, progress, registry, services: run } = pre
  // The run's services take effect here and die with the run (the finally
  // below uninstalls them, restoring whatever was in effect before): the
  // session-driving engine and the stats module read the run's clock through
  // this holder from now on.
  installServices(run)
  // The run-events journal (plans/0061 R4/F1): rotated here, once per run
  // start — the turn engine's inputs and executed effects append to it for
  // the rest of the run, and the file holds exactly this run's entries.
  // AUTO-DECISION: the rotation call sits in loop.ts although F1's touch set
  // names only the engine files (the journal's own "rotated per run start"
  // needs the run-start hook, and this is the run's start beside the
  // services install; the shell starts nothing per run in the core, and a
  // shell-side hook would be a shell-visible surface).
  startRunEvents(directory)
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
      const pre = await routePhase(directory, { loadPlan, bin: shellProfile().bin })
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
    // stops here. Under a registry layer no host starts yet — the pool
    // starts each agent profile's host lazily on its first selection
    // (plans/0055 §8.1); a layer-less run starts the single agent exactly
    // as before (the implicit registry exists to route, not to re-shape
    // the fleet start).
    const started = await startPool(directory, { ...opts, registry })
    server = started.pool
    if (started.error !== undefined || server === undefined) {
      log(`⏸ ${started.error}`)
      return 1
    }
    // The switch snapshot freezes here, after the fleet's degradation clamp
    // and before the routing facts read the switches: from this point the
    // run's switches are read-only (a later clamp throws — the run start is
    // the one writer; a re-clamp declares its facts and re-parses instead).
    freezeSwitches()
    // The run's routing facts (plans/0055 §6): fixed once the agent choice is
    // known, held by every dispatch through Opts.routing — always defined now:
    // a layer-less run carries the implicit registry the env switches
    // synthesize, so every dispatch resolves through selection. The run-start
    // block (§6.5) prints the routing in force for a layer-backed registry;
    // the implicit one is not announced at the start (it routes — the
    // `models` command shows it).
    // runAgent is the run's start profile (§8.2): unqualified session records
    // and raw override values resolve through it, while each dispatch's chain
    // names the profile its session truly lives on. The facts carry the run
    // services' clock (the one timeline every dispatch reads).
    const routing = routingFacts(registry, opts.agent, run.clock, run.router, started.profileName)
    if (registry !== undefined) logRunRouting(routing)
    // The classifier's token booking (plans/0055 §7.1 "Stats"): the
    // failure-message classifier's one-shot sessions report their usage into
    // the stats `classify` bucket — outside the unit's session totals. The
    // sink is the run router's (the classifier reads it through its router)
    // and is dropped again in the finally below, before the stats handle
    // flushes; without a classifier list nothing reports into it, so a
    // registry without one registers harmlessly.
    run.router.setClassifyUsageSink((usage) => void statsClassifyUsage(directory, usage))
    if (opts.interactive) {
      repl = startInteractive((agent) => server!.client(agent), agentName, undefined, new Set(routing.registry.models.keys()))
      log("💬 interactive mode: Enter sends your input as an extra message to the current session (discarded when no session is active); /exit pauses at the next safe boundary, re-run to resume")
    }
    if (opts.dryrun) {
      const result = await runOnce(server, "permission preflight", renderDryrun(promptFacts({ dir: directory })), {
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
    const ctx: LoopCtx = {
      directory,
      opts,
      server: serverHandle,
      agentName,
      phases,
      manual: phases === "m",
      repl,
      ran: 0,
      input: opts.planInput,
      append: opts.append,
      routing,
      // The run's router (the installed holder's): the loop's boundary hooks
      // and every opts literal the loop builds carry it — the pipeline below
      // reads the routing decision state only through ctx or opts.
      router: run.router,
      // The run's control service (the installed holder's), threaded the
      // same way: the boundary hooks' /exit checkpoint and the sessions'
      // recovery wait read the request only through ctx or opts.
      control: run.control,
      // The run's git service (the installed holder's), threaded the same
      // way: the loop family's commit calls and every opts literal the
      // loop builds read the commit side only through ctx or opts.
      git: run.git,
      ...(started.leadSplit === false ? { leadSplit: false as const } : {}),
    }
    return await runPhaseLoop(ctx)
  } catch (error) {
    // /exit (design doc plans/0014-exit-resume-design.md): the three safe
    // boundaries (phase/task/subtask, the latter thrown up from runner.ts via
    // runTask) and the recovery wait (plans/0057 §6, thrown up from
    // runSession) land here uniformly — the run has stopped at that boundary's
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
    run.router.setClassifyUsageSink(undefined)
    // Graceful stats close-out (STATS_PLAN §1): fold the open segment, then
    // persist the closed segment and unload the handle; the next loadStats
    // reads with no depreciation left. Write failures are silent inside and
    // do not affect the exit code.
    await flushStats(directory)
    // The lifecycle of a managed handle (managed) belongs to the caller; not
    // closed here.
    if (!opts.managed) server?.close()
    await unprotect(directory)
    // The run's services die with the run, after everything above that may
    // still read the run's clock (the stats flush); a run nested in a
    // holder-using caller — a test — restores the caller's holder.
    uninstallServices()
  }
}
