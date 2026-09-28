// runAll's preflight (pre-run checks): prompt library loading, agent contract
// integrity check, stats loading and the progress heartbeat, driver state
// files read-only, test-handover restoration, the start clean gate,
// interruption state reset, AGENTS.md/.gitignore close-out and the
// housekeeping commit; also carries runAll's options type RunAllOpts and the
// agent contract rendering (plans/0006-phases-design.md,
// plans/0021-commit-boundary-design.md P3). Exits are handed back as { exit }
// and returned directly by runAll, no process.exit here; the exit sits before
// runAll's try, outside its finally (plans/0024-module-split-plan.md §I D13).
// Does not depend on loop.ts. Split out of src/loop.ts
// (plans/0024-module-split-plan.md S14, pure move).
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { checkAgentBins } from "./agent-pool"
import { loopbackProxyWarning } from "./agent-env"
import { ensurePointer } from "./agents-block"
import { renderAgentContract } from "./config-fix"
import { resumeBanner } from "./conclusion"
import { beginUnit, changedFiles, commitTree, fileTracked } from "./git"
import { ensureGitignore } from "./gitignore"
import { log } from "./log"
import { checkModelReferences, loadModels, type ModelRegistry } from "./models"
import { projectLayerRefusal, switchModelRegistryInfo } from "./models-describe"
import { currentRound, legacyLayoutProblem, phaseIndexPath } from "./phases"
import { roundBriefPath } from "./docpaths"
import { loadPhaseTypes } from "./phases/custom"
import { phaseType, REQUIRED_TYPE, resolvePhases, type PhaseTypeEntry } from "./phases/registry"
import { trackSubtasks, watchFiles } from "./loop-progress"
import type { ModeSpec } from "./mode"
import type { PlanInput } from "./plan-input"
import { activeIntentText, useHumanQuestions, useIntentPacks } from "./prompt"
import { CONTRACT_AGENT, type PermissionMode, type SubtaskMode } from "./opts"
import type { ParallelLevel } from "./intent/types"
import { resetInProgress } from "./tasks"
import { protect } from "./protect"
import type { AgentHost } from "./agent/types"
import { routingFacts, dispatchCoverageProblems, type DispatchNeed } from "./routing"
import { createServices, type RunServices } from "./services"
import { shellProfile } from "./shell"
import { autoSwitches, modelTypeProblems, phaseTypeRoleProblems, setSwitchModelRegistry, type AgentChoice } from "./switches"
import { loadStats } from "./stats"
import { usePromptLibrary } from "./template"
import { restoreTestHandoffs } from "./testrun"

export type RunAllOpts = {
  // The coding agent (M6.1, config `agent`; absent = opencode). The shell
  // profile's agent and OPENCODE_AUTO_AGENT take precedence (src/agent-choice.ts).
  agent?: AgentChoice
  server?: string
  verbose?: boolean
  waitAnswer?: number
  // minutes to pause between tasks waiting for the human (0 = no wait); Enter
  // continues immediately, the timeout continues automatically.
  waitBetween?: number
  // --commit false: the unified commit after a session ends (on by default;
  // the commit machinery is src/git.ts).
  commit?: boolean
  subtask?: SubtaskMode
  // dryrun: run only the one permission-precheck session and print its
  // report; no task executes.
  dryrun?: boolean
  // the context budget baseline (tokens; a reused session's used-amount
  // threshold is half of it), absent = runner defaults to 64k.
  contextLimit?: number
  // --permission: the handling policy for permission requests (default
  // ask-deny), passed through to runner's session watch.
  permission?: PermissionMode
  // --interactive: a resident stdin side channel taking human input and
  // injecting it into the current session (mutually exclusive with --verbose;
  // terminal detail goes silent, the log file keeps the full record).
  interactive?: boolean
  // the watchdog of the driver-hosted scripts (tests): the no-output judgment
  // window and the absolute duration cap (milliseconds), passed through to
  // runScript (config's idleTime / idleMax are set in minutes).
  idleMs?: number
  maxMs?: number
  // --test-by-driver: the test execution protocol — execution sessions write
  // the test script to tmp/test.sh for the driver to run, and the output is
  // fed back into the session; --handover-test: on test failure with the
  // context at its limit, hand over to a new continuation session. Both are
  // passed through to runTask.
  testByDriver?: boolean
  handoverTest?: boolean
  // -m/--mode scenario mode (default migrate), passed through to runTask's
  // prompt rendering.
  mode?: ModeSpec
  // --phases (plans/0006, config): "m" (default) = the manual single phase
  // R-01/P01-implement (no planning or handover session, plans/0047 L2); any
  // other value runs the phase loop — current phase → planning session writes
  // tasks.md + task units → task loop → handover (distill + completion rename +
  // commit) → next phase.
  phases?: string
  // a server handle the caller already manages (the shell's preamble session
  // and the main loop share one instance): when provided, it is neither
  // managed nor closed here, the lifecycle belongs to the caller.
  managed?: AgentHost
  // --new-session: on interruption recovery skip session reuse (only the old
  // session's context is dropped, exact phase re-entry is kept), passed
  // through to runTask.
  newSession?: boolean
  // auto numbering (config.autoNumber): task numbers never repeat in the
  // target directory — a phase planning session continues the numbering from
  // the .auto/next-task record; a missing record is restored first through an
  // AI recovery session's inference (see src/numbering.ts).
  autoNumber?: boolean
  // --no-wrapup (config.wrapup, default true): turn off the task wrap-up
  // session, passed through to runTask.
  wrapup?: boolean
  // config.acceptanceGate: phase types gated on a human's acceptance
  // (plans/0049 G7).
  acceptanceGate?: string[]
  // config.build: the target's build command for the round-close report at the
  // complete route (plans/0049 G8).
  build?: string
  // config.parallel (MP.1, plans/0046 D8): the planning-guidance level injected
  // into the planning sessions; absent = none.
  parallel?: ParallelLevel
  // config.scanExempt (plans/0059 X2): the deliverable paths the P1 scan and
  // the terminator scan skip, at subtask close-out and at round close.
  scanExempt?: string[]
  // --max-sessions (plans/0046 D9): concurrent AI sessions. Reserved until the
  // MP.3 scheduler exists: only 1 (the default) is accepted.
  maxSessions?: number
  // plan's stop condition (plans/0053 D6): the run stops once a planning step
  // has succeeded, or where an execute route would start, and prints what to
  // review. Absent = run: the loop goes on through execution.
  stopBefore?: "execute"
  // The planning input plan hands the run (plans/0053 D9): the first planning
  // step persists it to its phase's plan-input.md and plans against it.
  planInput?: PlanInput
  // plan --append (plans/0053 D23): with planInput, the planning step appends
  // tasks to the phase the route names now instead of planning it afresh; m
  // mode implies the append from an input on a non-empty index, so the flag
  // only matters for the phased execute and handover routes.
  append?: boolean
}

// the preflight section: produces the agentName, the run's services and the
// two timer handles runAll still uses afterwards (closed in its finally);
// error exits are handed back as { exit }, timing and leftover side effects
// unchanged from before the move (see the file header).
// registry: the model registry loaded at run start (undefined = none).
// services: the run's service holder (the composition root's output;
// runAll installs it for the run).
export async function preflight(
  directory: string,
  opts: RunAllOpts,
): Promise<
  | { agentName: string; watcher?: { close(): void }; progress: { close(): void }; registry?: ModelRegistry; services: RunServices }
  | { exit: number }
> {
  // Legacy layout (M3.7, plans/0047 R3): an old-layout project is a usage error
  // before anything is read or written — no compatibility read, no migration.
  const legacy = await legacyLayoutProblem(directory)
  if (legacy) {
    log(legacy)
    return { exit: 1 }
  }
  // —— The run's services (the composition root) ——
  // The holder is built here and installed by runAll for the run (uninstalled
  // in its finally). Its members construct in a written order across the run
  // start: the registry loads and feeds the switches (setSwitchModelRegistry)
  // ahead of their first parse (the validation block below); the agent fleet
  // then starts and its degradation clamp lands on the parsed switches (the
  // caller's startPool); the switch snapshot freezes right after the clamp
  // (the caller's freezeSwitches, before the routing facts below read the
  // switches); the router, control and git services — the run-wide decision
  // state that still lives in module singletons — join after the freeze,
  // each with the change that moves its state in. This point ships the
  // clock, the one time source the session-driving engine and the stats
  // module read, and the router with the tranches that have moved in (the
  // failback holders, the down marks, the logged usage windows, the
  // model-step cache claims, the key rings) — a constructed object whose
  // state reads neither the registry nor the switches at construction: the
  // key rings take their registry input at their slot, the agent-pool fleet
  // start (after the holder exists, through the router's activateRings),
  // and the routing fence tranche takes its inputs at its slot after the
  // freeze; the early build is safe because everything here depends on
  // nothing above it, and the coverage facts below already carry the clock
  // and the router.
  const run = createServices()
  // prompt library: load the target directory's .opencode/auto/prompts/
  // overrides (protocol-sensitive templates get a key-content check, failure
  // exits as a usage error). Afterwards render* renders synchronously with no
  // need to sense the directory again.
  // intent packs load at the same point (M1.2): target-directory
  // .opencode/auto/intents/ overrides/additions; an invalid intent pack file
  // is reported as a usage error from here on.
  // custom phase types (M3.6, .opencode/auto/phases/) validate at the same
  // point: an invalid type file and a phase-type key absent from
  // OPENCODE_AUTO_MODEL both exit as usage errors.
  // The model registry loads at the same point (loadRunRegistry), once per
  // run and against the phase type list with the custom types — and ahead of
  // the switches' first parse, because a registry in force changes what the
  // switches accept: OPENCODE_AUTO_MODEL values may be internal names and
  // OPENCODE_AUTO_MODEL_FALLBACK is a usage error (plans/0055 §9 R7).
  let registry: ModelRegistry | undefined
  try {
    usePromptLibrary(directory)
    useIntentPacks(directory)
    // plan's sessions (stopBefore === "execute") render question-rule's
    // human-answer branch: a person attends plan, so questions wait for the
    // human with no timeout and never get an AUTO-RESOLVE proxy answer (the
    // driver side of the same rule is Opts.humanQuestions, watch.ts).
    useHumanQuestions(opts.stopBefore === "execute")
    const loaded = loadPhaseTypes(directory)
    const custom = loaded.filter((entry) => entry.origin === "project").map((entry) => entry.type)
    const types = loaded.map((entry) => entry.type)
    registry = await loadRunRegistry(directory, types)
    setSwitchModelRegistry(registry ? switchModelRegistryInfo(registry) : undefined)
    // A dispatch the run can send with a list the agent filter emptied is a
    // usage error, never a silent wait (plans/0055 §6.3, §10 item 7).
    const facts = registry ? routingFacts(registry, opts.agent, run.clock, run.router) : undefined
    const coverage = facts ? dispatchCoverageProblems(registry!, facts.agentFilter, dispatchNeeds(opts, loaded)) : []
    // Preflight's bin check (plans/0055 §8.7): each profile a candidate list
    // references runs `<bin> --version` under its env, 10 s timeout. The
    // driver never logs in or reads credentials — an expired login surfaces
    // at runtime as an `auth`-class error. A caller-supplied host (`managed`)
    // brings its own agent; no bin of ours is checked.
    const bins = facts && !opts.managed ? await checkAgentBins(registry!, facts.agentFilter) : []
    const problems = [...phaseTypeRoleProblems(custom), ...modelTypeProblems(autoSwitches().model, types), ...coverage, ...bins]
    if (problems.length) throw new Error(problems.join("\n"))
  } catch (error) {
    log(error instanceof Error ? error.message : String(error))
    return { exit: 1 }
  }
  // The driver's own traffic (plans/0055 §8.10): it reaches a managed opencode
  // server over loopback with Bun's fetch, which does not bypass loopback on
  // its own, so a proxy in the driver's environment that NO_PROXY does not
  // steer around loopback would carry that traffic (src/agent-env.ts). Proxies
  // for agents belong on their agent profiles. A warning, never a refusal.
  // AUTO-RESOLVE: does the loopback proxy warning fire without a model registry? -> no, only under a registry with an opencode profile (a run without a registry stays byte-identical, and a registry of claude profiles alone starts no opencode server to reach)
  if (registry && [...registry.agents.values()].some((profile) => profile.adapter === "opencode")) {
    const warning = loopbackProxyWarning(process.env)
    if (warning) log(warning)
  }
  // --max-sessions is reserved (plans/0046 D9): there is no scheduler yet, so a
  // request for concurrent sessions is refused instead of silently run serially.
  if (opts.maxSessions !== undefined && opts.maxSessions !== 1) {
    log(`max sessions ${opts.maxSessions}: concurrent execution is not supported yet (only 1)`)
    return { exit: 1 }
  }
  // A project intent pack without the level's subsection injects nothing; say so
  // once rather than let the setting silently do nothing.
  if (opts.parallel && !activeIntentText("parallelism", opts.parallel)) {
    log(`⚠ parallel ${opts.parallel}: the active intent pack has no \`## parallelism\` / \`### ${opts.parallel}\` subsection; planning sessions get no parallelism guidance`)
  }

  // The agent contract written by init (CONTRACT_AGENT); pre-run integrity
  // check: with the contract file missing the server only answers UnknownError
  // (no root cause), so report it here with the shell profile's recovery hint
  // (src/shell.ts); a contract differing from the template only warns.
  const agentName = CONTRACT_AGENT
  const agentFile = join(directory, ".opencode/agent", `${agentName}.md`)
  const agentText = await Bun.file(agentFile).text().catch(() => undefined)
  const { program, bin, agentRecovery } = shellProfile()
  if (agentText === undefined) {
    log(`⏸ agent contract file missing: .opencode/agent/${agentName}.md(its absence makes task dispatch fail: UnknownError)`)
    log(
      agentRecovery === "startup"
        ? `  recovery: re-run ${program}(the default contract is rebuilt from the template at startup), or restore the file manually`
        : `  recovery: run ${bin} fix ${directory} to rebuild the file (or restore it manually), then re-run`,
    )
    return { exit: 1 }
  }
  // init writes the contract as rendered under the then-current testByDriver,
  // so the comparison must render under the current config the same way
  // (comparing against the raw template's full text would never match — the
  // {{#if}} markers — same yardstick as renderAgentContract).
  if (agentText !== (await renderAgentContract(Boolean(opts.testByDriver)))) {
    log(
      `⚠ .opencode/agent/auto.md differs from the current template (possibly a legacy contract); ` +
        (agentRecovery === "startup" ? `re-running ${program} refreshes it from the template` : `run ${bin} fix ${directory} to refresh it`),
    )
  }

  const watcher = opts.verbose ? watchFiles(directory) : undefined
  // stats loading (plans/STATS_PLAN.md §1): read disk → depreciate the
  // previous process's leftover segments → round rollover → open this
  // process's first segment; with an old document present, print the resume
  // banner (§4.6). Must run before trackSubtasks (its heartbeat readings
  // depend on the loaded handle and the bucket identity statsTask sets).
  const resumed = await loadStats(directory)
  if (resumed) log(resumeBanner(resumed))
  // every 10 minutes report the current task's subtask progress and estimated
  // remaining time (subtasks.md, state files are the authority).
  const progress = trackSubtasks(directory)
  // Driver-owned files go read-only for the whole run; driver writes
  // re-apply it, and the finally below restores writability so a human can
  // edit the files (e.g. opencode.json after a permission block).
  await protect(directory)
  // on-site restoration of handover documents (test handover interruption
  // recovery F3, plans/0023-test-handover-early-design.md §I): must precede
  // the start clean gate — the previous run may have deleted an
  // already-accounted in-flight handover document, and that deletion is
  // itself a dirty area the gate would stop the whole run on right here.
  // Restoring removes the dirt, and the recovery state machine that follows
  // also gets the files its decisions need.
  if (!opts.dryrun) await restoreTestHandoffs(directory)
  // The retired task mirror (plans/0054 D3): a CURRENT.md an earlier release
  // left behind — recognised by the header it always wrote — is removed ahead
  // of the start gate, whose carryover commits the deletion as a driver write
  // (git.ts DRIVER_STATE). Any other CURRENT.md belongs to the project.
  if (!opts.dryrun && (await removeRetiredCurrent(directory))) log("removed: CURRENT.md (task mirror retired; an earlier release wrote it)")
  // The retired reference checker's stale-reference list: a
  // .auto/invalid-refs.md an earlier release left is removed the same way
  // (see removeRetiredInvalidRefs below).
  if (!opts.dryrun && (await removeRetiredInvalidRefs(directory))) log("removed: .auto/invalid-refs.md (refcheck retired; an earlier release wrote it)")
  // the start clean gate (plans/0021-commit-boundary-design.md P3): with
  // committing enabled the worktree must be clean — everything the execution
  // units after it (task/subtask/hidden task) depend on is fixed by the
  // previous commit. A dirty area left by the human blocks and goes to the
  // human (replacing the old "⚠ will be absorbed by the next commit" notice:
  // absorbing would mix human changes into the driver's audit trail, breaking
  // the commit-as-isolation boundary); leftovers of driver-exclusive state
  // files (index ticks, unit renames) self-heal through beginUnit's carryover
  // backfill commit — the previous run exiting on a non-commit path (e.g. a
  // unit gate not clean returning 2 directly) leaves their writes behind,
  // which are the driver's own bookkeeping, not human changes, and stopping
  // here would only keep the next run from ever starting.
  if (opts.commit !== false && !opts.dryrun) {
    const gate = await beginUnit(directory, opts, { id: "PLAN", title: "pre-run baseline close-out" })
    if (gate.type === "dirty") {
      // The round-start gate (plans/0049 G1): the command that establishes
      // the round (plan; init and continue did before their round steps
      // retired) leaves the setup uncommitted on purpose — committing it is
      // the human's review of the round. Its mark is a phase index that git
      // has never seen.
      const round = await currentRound(directory)
      const index = phaseIndexPath(round)
      if (gate.files.includes(index) && !(await fileTracked(directory, index))) {
        const phased = opts.phases !== undefined && opts.phases !== "m"
        log(
          `⏸ round-start gate: the setup of round ${round} is not committed yet. Review it` +
            `${phased ? `, fill in ${roundBriefPath(round)} (goal, acceptance and release criteria)` : ""}, commit, and re-run:`,
        )
      } else {
        log("⏸ the worktree has uncommitted changes; to ensure execution units start on a clean baseline, handle them manually (commit or clean) and re-run:")
      }
      for (const file of gate.files) log(`  ${file}`)
      return { exit: 2 }
    }
  }
  // interruption recovery: the previous run, killed/Ctrl+C'd, may leave
  // in_progress marks behind (no session running); they are reset to pending,
  // and the main loop still resumes through next(), attempts kept. When close
  // enough to the interruption, the session's progress record on the chain
  // (.auto/progress.json) makes runTask reuse the original session and
  // continue. The marks are runtime state (.auto/units.json, not in git,
  // M3.4) and produce no commit. dryrun changes no state file.
  if (!opts.dryrun) {
    const stale = await resetInProgress(directory)
    if (stale.length) log(`↻ resuming interrupted state: ${stale.join(", ")} reset from in_progress to pending`)
  }
  // before the first session, ensure AGENTS.md's opencode-auto block matches
  // the current config rendering (append when missing, replace the whole block
  // when its content differs from the rendering, clean up old-version or
  // redundant named marker blocks across the board). AGENTS.md is read-only
  // during run (protect.ts), sessions never maintain it (plans/0054 D2);
  // ensurePointer unprotects and re-protects around its own writes.
  const ensured = await ensurePointer(directory, { testByDriver: opts.testByDriver })
  if (ensured.block === "inserted") log("inserted: AGENTS.md opencode-auto block")
  if (ensured.block === "replaced") log("refreshed: AGENTS.md opencode-auto block (differed from the current config rendering)")
  if (ensured.legacyRemoved) log(`cleaned: ${ensured.legacyRemoved} legacy/redundant opencode-auto marker block(s) in AGENTS.md`)
  if (await ensureGitignore(directory)) log("updated: .gitignore now ignores tmp/ and .auto/(driver working directory and runtime state)")
  // the housekeeping close-out commit: the writes ensurePointer/ensureGitignore
  // make are driver changes, booked at once so the worktree is clean when the
  // first execution unit starts; commit failure exits 2 as an environment
  // block (plans/0021-commit-boundary-design.md P3). dryrun makes no commit.
  if (opts.commit !== false && !opts.dryrun && (await changedFiles(directory)).length) {
    const settled = await commitTree(directory, { id: "PLAN", title: "pre-run baseline close-out" }, {
      stage: "housekeeping",
      subject: "PLAN housekeeping pre-run baseline close-out (AGENTS.md pointer block/.gitignore/interrupted-state reset)",
    })
    if (!settled.ok) {
      log(`⏸ pre-run baseline close-out commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}, handle git manually and re-run`)
      return { exit: 2 }
    }
  }
  return { agentName, watcher, progress, registry, services: run }
}

// The dispatches this run can send (plans/0055 §6.3): every role its
// reachable phase types dispatch, plus the run-level roles no phase owns.
// The reachable types are the configured phases (custom types included,
// resolved against the loaded type list); "m" is the implicit implement
// phase. Per type with tasks: the task sessions take the type's execute tier
// (`whole` outside the true subtask mode — auto's lead is a whole-task
// session, plans/0059 D2 —, `subtask` in every mode — a checklist a person
// wrote dispatches too —, and the merged understand/decompose session in the
// true mode, the planned pipeline), and the wrap-up session runs unless
// wrapup is off; a type without tasks runs its own knowledge session.
// Run-level: the bypass one-offs in every mode (confirm turns, context-base
// rebuilds, the dryrun precheck), the phased loop's planning and handover
// sessions, and m mode's planning scan. number-recovery (a rare recovery
// path inside a run) and prior-knowledge (shell-orchestrated outside runAll)
// stay off the list: both are simple sessions, so the bypass need keeps
// their tier covered.
// AUTO-RESOLVE: does the default m mode need the deep tier? -> only under subtask: true, through the decompose sessions of its implicit implement phase (the pipeline runs the merged understand/decompose session, a deep role of that phase; §6.3 makes an emptied needed list a preflight error rather than a mid-run wait, and the previous trigger — deep only when the run plans or scans — would leave those dispatches waiting silently). The default subtask mode auto runs a lead whole-task session instead (plans/0059 D2, §11: the lead takes the whole role's tier), so like off and ondemand it takes the implement type's execute tier and the default m mode needs no deep tier unless it plans or scans.
function dispatchNeeds(opts: RunAllOpts, types: readonly PhaseTypeEntry[]): DispatchNeed[] {
  // An invalid phases value fails at its own validation (config load, the
  // loop's routing); the coverage check stays total on the implicit type.
  const entries = resolvePhases(opts.phases ?? "m", types) ?? [phaseType(REQUIRED_TYPE)!]
  const phased = opts.phases !== undefined && opts.phases !== "m"
  const needs: DispatchNeed[] = [{ role: "bypass" }]
  if (phased) needs.push({ role: "phase-plan" }, { role: "phase-handover" })
  else if (opts.planInput !== undefined) needs.push({ role: "implement-scan" })
  for (const entry of entries) {
    if (!entry.hasTasks) {
      needs.push({ role: "knowledge", entry })
      continue
    }
    if ((opts.subtask ?? "auto") === "true") needs.push({ role: "decompose", entry })
    else needs.push({ role: "whole", entry })
    needs.push({ role: "subtask", entry })
    if (opts.wrapup !== false) needs.push({ role: "wrapup", entry })
  }
  return needs
}

// The model registry at run start (plans/0055 §4.1, §4.3): both layers read
// once, strictly, and held by the run (runAll puts it on the loop context);
// the driver never writes or locks them. undefined = no registry, and then
// nothing is logged and nothing changes. Every refusal throws, and preflight
// logs it and exits 1, like a bad config:
//   - a project layer that git does not ignore, checked before its content is
//     read: the unified commit would commit it. The line names fix, which
//     adds the .gitignore entry init writes; a tracked layer must be
//     untracked first, since ignore rules skip tracked files;
//   - a strict load failure (ModelRegistryError: one line per problem, each
//     naming its layer and field);
//   - a broken reference: a variable unset or empty, a file missing or
//     unreadable. Each line names the field, the layer and the reference,
//     never a value.
// The refusal of a project layer that git would commit is shared with the
// models command (projectLayerRefusal, src/models-describe.ts), so both name
// the same fix.
// AUTO-DECISION: preflight calls the shared projectLayerRefusal instead of its own copy of the check, and keeps its own load and reference steps (the refusal line stays byte-identical, and preflight still stops before reading an unignored layer's content)
// AUTO-DECISION: the load sits in preflight's validation block with the prompt library and the phase types, so it runs inside the run lock, before the start gate and every write, and under dryrun too (a bad registry then fails plan, run and a dryrun alike, and the custom phase types are already loaded there)
// AUTO-DECISION: the registry rides the preflight result into the loop context instead of RunAllOpts (the options are the caller's input; the registry is state the run derives from disk once)
async function loadRunRegistry(directory: string, phaseTypes: readonly string[]): Promise<ModelRegistry | undefined> {
  const refusal = await projectLayerRefusal(directory)
  if (refusal) throw new Error(refusal)
  const registry = await loadModels(directory, { phaseTypes })
  if (!registry) return undefined
  const broken = checkModelReferences(registry)
  if (broken.length) throw new Error(broken.map((problem) => problem.message).join("\n"))
  return registry
}

// The first line of every CURRENT.md the driver wrote before the mirror
// retired (plans/0054 D3).
const RETIRED_CURRENT_HEADER = "# Current task (maintained by opencode-auto, do not edit manually)"

// Removes the root CURRENT.md when it is the retired task mirror; returns
// whether it did. A file with any other first line is the project's own.
export async function removeRetiredCurrent(dir: string): Promise<boolean> {
  const file = join(dir, "CURRENT.md")
  const text = await Bun.file(file).text().catch(() => undefined)
  if (text?.split("\n")[0] !== RETIRED_CURRENT_HEADER) return false
  await rm(file, { force: true })
  return true
}

// Removes the retired reference checker's stale-reference list
// (.auto/invalid-refs.md) when an earlier release left one; returns whether
// it did. Unlike CURRENT.md there is no header check — the file lives inside
// the driver's own gitignored state directory, so any instance of it is
// ours — and the deletion rides no commit (.auto/ never enters git).
export async function removeRetiredInvalidRefs(dir: string): Promise<boolean> {
  const file = join(dir, ".auto", "invalid-refs.md")
  if (!(await Bun.file(file).exists())) return false
  await rm(file, { force: true })
  return true
}
