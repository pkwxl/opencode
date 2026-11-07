// runAll's preflight (pre-run checks): prompt library loading, agent contract
// integrity check, stats loading and the progress heartbeat, driver state
// files read-only, test-handover restoration, the remediation executor row
// (plans/0172 D2 — run's half of the blockage protocol's "next run/plan
// executes" promise), the start clean gate,
// the scheduler's usage gate (interactive input under concurrency,
// plans/0068 D11) and its no-level teaching note (plans/0125 D4), orphan
// lane recovery (D14), interruption state reset, AGENTS.md/.gitignore
// close-out and the housekeeping commit; also carries runAll's options type
// RunAllOpts and the agent contract rendering (plans/0006-phases-design.md,
// plans/0021-commit-boundary-design.md P3). Exits are handed back as { exit }
// and returned directly by runAll, no process.exit here; the exit sits before
// runAll's try, outside its finally (plans/0024-module-split-plan.md §I D13).
// Does not depend on loop.ts. Split out of src/loop.ts
// (plans/0024-module-split-plan.md S14, pure move).
import { mkdir, readdir, rm } from "node:fs/promises"
import { hostname } from "node:os"
import { join } from "node:path"
import { checkAgentBins } from "./agent-pool"
import { loopbackProxyWarning } from "./agent-env"
import { ensurePointer } from "./agents-block"
import { provenanceComparison } from "./bundle"
import { executeBlockageChoices, executionLines } from "./blockage-execute"
import { renderAgentContract } from "./config-fix"
import { resumeBanner } from "./conclusion"
import { fileTracked, hookReports, type GitOps } from "./git"
import { deleteBranch, probeReflink, workingTreeMB } from "./git-worktree"
import { ensureGitignore } from "./gitignore"
import type { InteractiveOption } from "./interactive"
import {
  dispatchLane,
  docEligible,
  docScheduler,
  laneExit,
  laneOutcome,
  lanePark,
  landLane,
  LANE_DISPATCH_CAP,
  orphanRedispatch,
  pidAlive,
  readLaneReport,
  resolveLaneBranch,
  resolveTreeTier,
  schedulerActive,
  worktreeScheduler,
  type LaneReport,
  type TierProbe,
  type TreeTier,
} from "./lanes"
import { liveRunLock } from "./lock"
import { log } from "./log"
import { leftoverIsolationLines } from "./land"
import { releasedRoundBriefProposal, resolveRoundPhases } from "./analysis"
import { checkModelReferences, loadModels } from "./models"
import type { ModelRegistry } from "./models-schema"
import { projectLayerRefusal, switchModelRegistryInfo } from "./models-describe"
import { phaseKey, readPhases, currentPhase, currentRound, legacyLayoutProblem, phaseIndexPath } from "./phases"
import { ANALYSIS_DOC, roundBriefPath, roundDirName } from "./docpaths"
import { roundBriefText } from "./round-brief"
import { loadPhaseTypes } from "./phases/custom"
import { phaseType, REQUIRED_TYPE, resolvePhases, type PhaseTypeEntry } from "./phases/registry"
import { trackSubtasks, watchFiles } from "./loop-progress"
import type { ModeSpec } from "./mode"
import type { PlanInput } from "./plan-input"
import type { ProjectConfig } from "./config"
import { promptFacts } from "./prompt-facts"
import type { PromptFacts } from "./prompt"
import { CONTRACT_AGENT, type PermissionMode, type SubtaskMode } from "./opts"
import { packSubsection } from "./intent/load"
import { guaranteesProblem } from "./intent/guarantees"
import { provenanceNoticeLine } from "./provenance"
import { testLanesProblem } from "./intent/test-lanes"
import type { LanesConfig, ParallelLevel } from "./intent/types"
import { block, laneRecords, loadPlan, resetInProgress, unitAttempts } from "./tasks"
import { recoverRegression } from "./regression"
import { protect } from "./protect"
import { peekProgress } from "./resume"
import { findWallCommit, wallDeclared } from "./wall"
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
  // --interactive (the io/Interactive seam, the headless direction's P3a):
  // true = a resident stdin side channel taking human input and injecting it
  // into the current session (mutually exclusive with --verbose; terminal
  // detail goes silent, the log file keeps the full record), byte-identical
  // to before; an injected Interactive implementation (attach/question/close,
  // src/control-types.ts) or an io { input, output } factory replaces the
  // terminal sideband — the run routes every human interaction it owns
  // (askHuman's wait, the between-tasks pause, the step pauses) through it as
  // typed calls, the surface the headless transport (P3b) bridges over,
  // never a prompt-prose scraping channel (src/interactive.ts resolves the
  // shapes; the banner stays the sideband's own).
  interactive?: InteractiveOption
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
  // The active intent pack's name (plans/0079 §2: config `intent`, frozen by
  // init — often a materialized intent bundle's pack). The name rides the
  // session options to the render facts; the pack itself loads per render
  // call. Absent = the built-in default pack.
  intent?: string
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
  // auto numbering (config.autoNumber): task numbers never repeat among the
  // target directory's task artifacts — a planning session continues from
  // the deterministic floor over those artifacts (see src/numbering.ts,
  // plans/0150; no record, no restore session).
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
  // into the planning sessions; absent = none. It never gates execution
  // (plans/0125 D1 amending 0068 D10 — width alone activates the scheduler)
  // and derives the landing-conflict response (D21): the level is how deeply
  // planning works to make tasks independent, and how much merge repair a
  // worktree-lane conflict may spend. Which machinery executes concurrently
  // is the execution tier below, never the level.
  parallel?: ParallelLevel
  // config.treeLanes (plans/0096 D10, the 0068 amendment): the execution tier
  // — absent (off, the default) = Tier 0, process parallelism in one tree (no
  // worktree lanes; the D5 test lanes still run); auto = the probe below
  // decides between Tier 0 and Tier 1's sparse CoW worktree lanes; on =
  // Tier 2, today's full worktree. The probe runs here, once, and its result
  // rides the preflight return into the loop context (the registry's
  // precedent: state the run derives from disk, never a re-derivation per
  // site).
  treeLanes?: import("./intent/types").TreeLanesSetting
  // config.lanes (plans/0096 D9): the tier-1 knobs the project declared —
  // cache homes (injected into lane workers), the working-tree budget the
  // probe weighs, the sparse floor. Read here (the probe's budget) and by the
  // dispatches (the materialization facts); a lane worker carries them
  // unused, like every other config fact.
  lanes?: LanesConfig
  // config.scanExempt (plans/0059 X2): the deliverable paths the P1 scan and
  // the terminator scan skip, at subtask close-out and at round close.
  scanExempt?: string[]
  // config.isolate (plans/0074, U-L2): the nested repositories under branch
  // isolation. The run itself needs it for one report only: preflight warns
  // about leftover auto/R-NN branches of abandoned rounds (recoverable
  // state, §4) — the round's own isolation happened at establishment, and
  // every commit-side mechanism works on whatever branch is checked out.
  isolate?: string[]
  // --max-sessions (plans/0046 D9; live since plans/0068 S3, D10; activation
  // decoupled by plans/0125 D1): the concurrent AI sessions of the task loop
  // — the scheduler's slot count, width alone activating it (≥ 2; whatever
  // the parallel level). At 1 (the default) nothing changes for any project
  // whatever the level — the serial floor.
  maxSessions?: number
  // --repair (plans/0079 §4): the bounded repair budget of this run — how
  // many automatic repair rounds a FAIL verdict (a task report's Result line)
  // or a held verdict gate may drive before blocking for the human, modeled
  // on the bounded-recovery precedents (/exit, failover). Absent/0 = today's
  // behavior: the first FAIL blocks (exit 2). Run-side width, never a config
  // key; in force on the serial path and the doc lanes at tier 0 (plans/0099
  // D3 carries the repair round into the doc loop's finishBlocked), never
  // under worktree lanes or branch isolation (a repair round appends into
  // the index the lanes schedule from) and never under a stop condition —
  // plan and transfer carry no budget, and since plans/0101 D1 the verdict
  // gates they meet sit past run's boundary stop.
  repair?: number
  // --stop-after (plans/0128): the task id whose completion ends this run —
  // the retry's guardrail in a fork environment, usable anywhere the serial
  // loop runs. Run-side width, never a config key, never persisted; refused
  // under the lane scheduler and the doc lanes (a stop mid-flight would
  // strand in-flight work) — the serial path alone, a tighter confinement
  // than --repair's (the doc loop repairs but cannot stop mid-drain).
  stopAfter?: string
  // plan's stop condition (plans/0053 D6): the run stops once a planning step
  // has succeeded, or where an execute route would start, and prints what to
  // review. Absent = run: the loop goes on through execution. "formulate"
  // (plans/0101 D2) is transfer's stop point: the loop advances boundaries
  // (the handover, the phase close, the round close) but stops after a
  // formulation todo is constructed, before the session is dispatched — the
  // review seam between construction and dispatch.
  stopBefore?: "execute" | "formulate"
  // --boundary (plans/0101 D1): run's phase-boundary shape, a run-side width
  // in the 0079 §4 precedent — never a config key, and deliberately no
  // OPENCODE_AUTO_* switch (the boundary shape is interaction grammar, not an
  // experiment). "stop" (the default, also the reading of absent): the run
  // ends at the current phase's clean end — every unit done, lanes and doc
  // lanes landed — before the handover distillation; the stop names transfer,
  // the advance command that owns everything after it. "flow": today's
  // continuous crossing. Meaningful to plain run only — under a stopBefore
  // (plan, transfer) the loop follows its own stop condition and ignores it.
  boundary?: "stop" | "flow"
  // transfer --resynthesize (plans/0101 D3): bypass the digest-keep of a
  // standing formulation todo — the synthesis pipeline re-voices the sources
  // and construction's rewrite-on-diff lands the new todo for review. A
  // one-shot force for the rejected-synthesized-ledger case: the floor digest
  // is unchanged, so the next plain transfer keeps whatever lands. transfer's
  // alone (the shell refuses the flag on every other command).
  resynthesize?: boolean
  // The planning input plan hands the run (plans/0053 D9): the first planning
  // step persists it to its phase's plan-input.md and plans against it.
  planInput?: PlanInput
  // plan --append (plans/0053 D23): with planInput, the planning step appends
  // tasks to the phase the route names now instead of planning it afresh; m
  // mode implies the append from an input on a non-empty index, so the flag
  // only matters for the phased execute and handover routes.
  append?: boolean
  // The unit-scoped lane entry (plans/0068 §6.3, D2): internal, never
  // constitutional — set only by a lane launcher (the shell's `_lane`
  // subcommand or a host's own worker entry), never by a person's CLI. With
  // it set, runAll is a lane worker: the worktree's own run lock (the lock is
  // per-directory, unchanged), a preflight scoped to the worktree (below),
  // then loadPlan → the named unit → runTask unchanged, and the lane report
  // written at every controlled exit. `merge` (S3, D7's conflict path) rides
  // only a conflict repair's re-dispatch: the parent's current main branch
  // the lane merges into its branch before running the unit.
  lane?: { unit: string; merge?: string }
}

// The config-threading half of a shell's runAll options (plans/0193 D1): every
// constitutional key the config freezes, mapped into RunAllOpts the one way —
// one home for the threading both shells' `runOptions` builders mirrored (the
// plans/0160 absorb's own words: "a dropped key is a silently different run").
// The per-run halves (session flags vs request options, the transport's
// interactive channel, a plan payload's stop/input/append, run's widths) stay
// each shell's — they spread this object and add theirs.
export function configRunOptions(config: ProjectConfig, mode: ModeSpec): RunAllOpts {
  return {
    agent: config.agent,
    subtask: config.subtask,
    contextLimit: config.contextLimit * 1000,
    idleMs: config.idleTime * 60_000,
    maxMs: config.idleMax > 0 ? config.idleMax * 60_000 : undefined,
    mode,
    intent: config.intent,
    phases: config.phases,
    testByDriver: config.testByDriver,
    handoverTest: config.handoverTest,
    autoNumber: config.autoNumber,
    wrapup: config.wrapup,
    acceptanceGate: config.acceptanceGate,
    build: config.build,
    parallel: config.parallel,
    treeLanes: config.treeLanes,
    lanes: config.lanes,
    scanExempt: config.scanExempt,
    isolate: config.isolate,
  }
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
  | { agentName: string; watcher?: { close(): void }; progress: { close(): void }; registry?: ModelRegistry; services: RunServices; treeTier: TreeTier }
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
  // switches); the git service joins as a constructed member beside the
  // rest — a switchable strategy over the free commit functions rather than
  // moved singleton state (the production instance delegates; a test's
  // holder installs the no-commit double through createServices). This
  // point ships the clock, the one
  // time source the session-driving engine and the stats module read; the
  // router with the tranches that have moved in (the failback holders, the
  // down marks, the logged usage windows, the model-step cache claims, the
  // key rings); the control service — the /exit request and its
  // sleepers; and the git service. All are constructed services
  // whose state reads neither the registry nor the switches at
  // construction: the key rings take their registry input at their slot,
  // the agent-pool fleet start (after the holder exists, through the
  // router's activateRings), the routing fence tranche takes its inputs at
  // its slot after the freeze, the git service is pure delegation whose
  // functions take everything as call arguments, and control is one flag
  // with nothing to read; the early build is safe because everything here
  // depends on nothing above it, and the coverage facts below already carry
  // the clock and the router.
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
  // The project's custom phase type ids, filled inside the load block below
  // and read by the guarantees grammar check after it (the per-phase charter
  // keys' suffix vocabulary, plans/0097 D1).
  let customTypes: string[] = []
  // The prompt globals load and validate inside the block below (E2): the
  // render facts are built per render call by the callers
  // (src/prompt-facts.ts); preflight builds one itself so an invalid intent
  // pack still exits here as a usage error, and the parallelism check below
  // reads the same pack. Its humanQuestions flag is the stop condition's —
  // a person attends plan (stopBefore "execute") and transfer (plans/0101
  // D2, "formulate"), so those runs' sessions' questions wait for the human
  // with no timeout and never get an AUTO-RESOLVE proxy answer (the driver
  // side of the same rule is Opts.humanQuestions, watch.ts).
  let renderFacts: PromptFacts | undefined
  try {
    usePromptLibrary(directory)
    renderFacts = promptFacts({ dir: directory, humanQuestions: opts.stopBefore !== undefined, intent: opts.intent })
    const loaded = loadPhaseTypes(directory)
    const custom = loaded.filter((entry) => entry.origin === "project").map((entry) => entry.type)
    customTypes = custom
    const types = loaded.map((entry) => entry.type)
    registry = await loadRunRegistry(directory, types)
    setSwitchModelRegistry(registry ? switchModelRegistryInfo(registry) : undefined)
    // The layer-backed fleet checks run only when layers exist: a layer-less
    // run routes on the implicit registry (the env switches synthesize it)
    // and starts the single agent exactly as it always did — its coverage is
    // the implicit registry's own never-empty lists, and its bins are the
    // one agent the fleet start itself resolves. A dispatch the run can send
    // with a list the agent filter emptied is a usage error, never a silent
    // wait (plans/0055 §6.3, §10 item 7).
    const facts = registry !== undefined ? routingFacts(registry, opts.agent, run.clock, run.router) : undefined
    // The coverage judges the phases value in force for the current round
    // (plans/0101 D5: the released roadmap's line over config) — the run's
    // dispatches follow the round as established, not the config fallback.
    const authority = await resolveRoundPhases(directory, await currentRound(directory), opts.phases ?? "m")
    const coverage = facts !== undefined ? dispatchCoverageProblems(registry!, facts.agentFilter, dispatchNeeds(opts, loaded, authority.phases)) : []
    // Preflight's bin check (plans/0055 §8.7): each profile a candidate list
    // references runs `<bin> --version` under its env, 10 s timeout. The
    // driver never logs in and never reads credentials — an expired login
    // surfaces at runtime as an `auth`-class error. A caller-supplied host (`managed`)
    // brings its own agent; no bin of ours is checked. A profile that only
    // ever connects (its own `server`, or the run-wide --server override over
    // opencode profiles) demands no local binary (plans/0157 D3).
    const bins = facts !== undefined && !opts.managed ? await checkAgentBins(registry!, facts.agentFilter, { server: opts.server }) : []
    const problems = [...phaseTypeRoleProblems(custom), ...modelTypeProblems(autoSwitches().model, types), ...coverage, ...bins]
    if (problems.length) throw new Error(problems.join("\n"))
  } catch (error) {
    log(error instanceof Error ? error.message : String(error))
    return { exit: 1 }
  }
  // The guarantees contract's grammar (plans/0080 §2; the per-phase charter
  // family's key grammar, plans/0097 D1): a pack that declares `### asserts`
  // with malformed lines, or a `### verify-plan-<key>` whose suffix names no
  // phase, fails here as a usage error, ahead of any render — the same
  // load-style strictness the pack file itself gets.
  {
    const problem = guaranteesProblem(renderFacts!.pack, customTypes)
    if (problem !== undefined) {
      log(problem)
      return { exit: 1 }
    }
  }
  // The test-lane table's grammar (plans/0096 D3): a pack that declares
  // `### test-lanes` with malformed rows fails the same way — the table is
  // per-project, so the strict failure is what keeps a typo'd suite row from
  // rendering half-parsed into every execution prompt.
  {
    const problem = testLanesProblem(renderFacts!.pack)
    if (problem !== undefined) {
      log(problem)
      return { exit: 1 }
    }
  }
  // The active pack's provenance (plans/0079 §2, the moment 0031 froze
  // IntentSource for): the config's intent key names the pack, the log says
  // which surface supplied it — a project file (a materialized intent
  // bundle's pack among them) or the built-in.
  if (opts.intent !== undefined) {
    const project = await Bun.file(join(directory, ".opencode", "auto", "intents", `${opts.intent}.md`)).exists()
    log(`ℹ intent pack ${opts.intent} (${project ? "project" : "builtin"})`)
  }
  // The bundle provenance clause (plans/0100 D3): one line naming the
  // direction and the headings delta when any materialized file is stale
  // against the running binary's bundle (or the binary predates the pack).
  // Detection only — a stale pack still loads and still runs; `sync` is the
  // write side, and no exit code moves on this line.
  {
    const comparison = await provenanceComparison(directory)
    const notice = comparison === undefined ? undefined : provenanceNoticeLine(comparison)
    if (notice !== undefined) log(notice)
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
  // The target's git hooks, surfaced once at run start (plans/0173 D4,
  // 0165-142): the person's commit policy runs on the driver's commits too
  // (the ruling — no bypass), and the driver's own variables are scrubbed
  // from the hooks' environment (0059 X1's door closed). Detection only,
  // read-only, hence under dryrun as well; a repository with no hooks
  // (the ordinary target) stays silent — the floor.
  for (const line of await hookReports(directory)) log(line)
  // A no-level width is legal and taught, never refused (plans/0125 D4,
  // amending 0068 D10/S3's usage error; the teaching reworded by plans/0126
  // D5 to the two-lane model): the declarations are the admission (P17 —
  // level-independent since D5), doc phases' planning arranging them at this
  // width (the pack's `## doc-parallelism` teaching), code tasks running
  // concurrently only under the --tree-lanes tiers. One teaching line (P8:
  // detection records, the person decides), never a gate. A lane worker
  // never sees it (it carries no maxSessions), and width 1 never does (the
  // floor).
  if (opts.maxSessions !== undefined && opts.maxSessions !== 1 && opts.parallel === undefined) {
    log(`ℹ max sessions ${opts.maxSessions} with no parallel level: documentation-scoped tasks run side by side as their declared Depends/Touches allow — doc phases' planning arranges the declarations at this width; a level (init --parallel low|medium|high) adds code-phase planning depth, code tasks running concurrently only under --tree-lanes`)
  }
  // Interactive input refuses under concurrency (plans/0068 D11, v1): one
  // human cannot steer N sessions, and the sideband holds exactly one
  // attached session. Parent-side human surfaces that remain: the plan-phase
  // question wait (planning never overlaps lanes), --step (pauses at lane
  // boundaries in the parent), --wait-between (pauses between landings).
  if ((opts.maxSessions ?? 1) >= 2) {
    if (opts.interactive) {
      log(`--interactive with max sessions ${opts.maxSessions}: one human cannot steer ${opts.maxSessions} concurrent sessions; drop --interactive or run with --max-sessions 1`)
      return { exit: 1 }
    }
    if (opts.waitAnswer !== undefined && opts.waitAnswer > 0) {
      log(`--wait-answer ${opts.waitAnswer} with max sessions ${opts.maxSessions}: one human cannot answer ${opts.maxSessions} concurrent sessions; drop --wait-answer or run with --max-sessions 1`)
      return { exit: 1 }
    }
  }
  // A project intent pack without the level's subsection injects nothing; say so
  // once rather than let the setting silently do nothing.
  if (opts.parallel && (!renderFacts || !packSubsection(renderFacts.pack, "parallelism", opts.parallel))) {
    log(`⚠ parallel ${opts.parallel}: the active intent pack has no \`## parallelism\` / \`### ${opts.parallel}\` subsection; planning sessions get no parallelism guidance`)
  }
  // The width-keyed doc-concurrency teaching (plans/0126 D1): a pack without
  // the `## doc-parallelism` section leaves doc phases' planning unarranged
  // at width — the same say-so-once discipline as the level's warning above.
  if ((opts.maxSessions ?? 1) >= 2 && (!renderFacts || renderFacts.pack.docParallelism === undefined)) {
    log(`⚠ max sessions ${opts.maxSessions}: the active intent pack has no \`## doc-parallelism\` section; doc phases' planning gets no same-tree concurrency guidance`)
  }
  // The execution tier in force (plans/0096 D10, the 0068 amendment): computed
  // once here — the probe is preflight's ("preflight probes"), the pure
  // decision is lanes.ts's resolveTreeTier over the probed facts — logged with
  // its reason, and returned for the loop context so every worktree-lane site
  // consults the same answer instead of re-interpreting treeLanes. The tier
  // matters wherever the worktree machinery could engage: under the scheduler
  // activation rule it decides between the lane loop and the serial task loop
  // (Tier 0's "process parallelism, one tree" — the test lanes of D5 are the
  // parallelism), and beneath the isolation switch it still picks the tier-1
  // materialization (the switch forces the machinery serially under every
  // tier). A lane worker re-enters preflight but owns no tier of its own: it
  // skips the probe and the line (the parent that dispatched it decided).
  // dryrun probes nothing — it writes no state, and it runs no unit anyway.
  let treeTier: TreeTier = 0
  if (!opts.lane && (schedulerActive(opts.maxSessions) || autoSwitches().laneIsolation)) {
    const probe = !opts.dryrun && opts.treeLanes === "auto" ? await probeTierFacts(directory, opts.lanes) : undefined
    const resolved = resolveTreeTier(opts.treeLanes, probe, opts.lanes?.treeBudgetMB)
    treeTier = resolved.tier
    // The doc-lane note (plans/0099 D12): the doc scheduler's branch will
    // run — tier 0's task parallelism, documentation-scoped units as
    // concurrent in-process pipelines in this tree. The isolation switch
    // outranks the branch (it pins full isolation, serially), and the kill
    // switch removes the branch rather than the note.
    const docNote =
      autoSwitches().docLanes && !autoSwitches().laneIsolation && docScheduler(opts.maxSessions, resolved.tier)
        ? "; doc lanes on — documentation-scoped units run concurrently in this tree"
        : ""
    log(`ℹ parallel execution: tier ${resolved.tier} — ${resolved.reason}${docNote}`)
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
  // edit the files (e.g. opencode.json after a permission block). Beside
  // them, the sealed reference wall's declared set (plans/0132 D4): the
  // vetted channel frozen at the wall commit — read-only for the run like
  // the driver's own files; an undeclared or never-closed wall contributes
  // nothing (the floor, re-derived from git at every run start).
  await protect(directory, wallDeclared(directory) ? ((await findWallCommit(directory))?.sealed ?? []) : [])
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
  // The retired auto-numbering record: a .auto/next-task an earlier release
  // wrote is removed the same way (see removeRetiredNumberingRecord below)
  // — the number is derived from the surviving files since plans/0150, so
  // the stale record reads as nothing.
  if (!opts.dryrun && (await removeRetiredNumberingRecord(directory))) log("removed: .auto/next-task (numbering record retired; an earlier release wrote it)")
  // The remediation executor row (plans/0172 D2, 0165-025): the blockage
  // document's protocol promises "The next `run`/`plan` executes" — this row
  // is run's half. It runs before the start clean gate so the person's
  // uncommitted `Choice:` line is committed (the executor's own answer
  // commit) instead of being refused as dirt by the gate below; a non-stale
  // reblock exits 2 exactly as plan's prelude row does. Skipped by lane
  // workers (the parent's row runs ahead of every dispatch; the worker's
  // copy carries the executed marks) and by dryrun (no writes). A project
  // without blockage documents — the ordinary run — finds nothing pending
  // and logs nothing (the byte-identical floor).
  if (!opts.dryrun && !opts.lane) {
    const executed = await executeBlockageChoices(directory, await currentRound(directory))
    if (executed.type === "reblocked" && !executed.stale) {
      log(`⏸ remediation re-blocked: ${executed.reason}`)
      log(`next: resolve what it names, then re-run: ${bin} run ${directory}`)
      progress.close()
      watcher?.close()
      return { exit: 2 }
    }
    for (const line of executionLines(executed)) log(line)
  }
  // the start clean gate (plans/0021-commit-boundary-design.md P3): the
  // worktree must be clean — everything the execution units after it
  // (task/subtask/hidden task) depend on is fixed by the previous commit. A
  // dirty area left by the human blocks and goes to the human (replacing the
  // old "⚠ will be absorbed by the next commit" notice: absorbing would mix
  // human changes into the driver's audit trail, breaking the
  // commit-as-isolation boundary); leftovers of driver-exclusive state files
  // (index ticks, unit renames) self-heal through beginUnit's carryover
  // backfill commit — the previous run exiting on a non-commit path (e.g. a
  // unit gate not clean returning 2 directly) leaves their writes behind,
  // which are the driver's own bookkeeping, not human changes, and stopping
  // here would only keep the next run from ever starting. The gate reads the
  // holder preflight itself built (the composition root's git member —
  // production here; a test wanting the off path installs the double on a
  // holder of its own).
  // The interrupted-unit exemption (plans/0149): an active progress record —
  // a unit the last process left mid-flight (a kill, a crash, an /exit inside
  // the recovery wait) — makes the uncommitted changes that unit's resumable
  // progress, the same exemption the unit-start gates grant it
  // (src/loop-task.ts): the resumed unit's close absorbs them with its
  // unified commit, and the person's interface stays run → /exit → re-run —
  // a manual git commit between the exit and the re-run is a driver need,
  // never the person's job. An active record cannot coexist with the
  // round-start case below (a dispatch implies that run's own gate passed
  // the round setup's commit), so the exemption takes the whole dirty
  // verdict. The housekeeping close-out further down skips with it: its
  // sweep would fold the interrupted unit's batch into a PLAN commit.
  let exemptResume = false
  if (!opts.dryrun) {
    const gate = await run.git.beginUnit(directory, opts, { id: "PLAN", title: "pre-run baseline close-out" })
    if (gate.type === "dirty") {
      const interrupted = await peekProgress(directory)
      if (interrupted?.active === true) {
        exemptResume = true
        log(`↻ ${interrupted.task} was interrupted mid-flight: the worktree's uncommitted changes are that unit's resumable progress, exempt from the start clean gate (the resumed unit's close commits them, or a strict-resume rollback stashes them and names the stash — git stash list shows where)`)
      } else {
        // The round-start gate (plans/0049 G1): the command that establishes
        // the round (plan; init and continue did before their round steps
        // retired) leaves the setup uncommitted on purpose — committing it is
        // the human's review of the round. Its mark is a phase index that git
        // has never seen.
        const round = await currentRound(directory)
        const index = phaseIndexPath(round)
        if (gate.files.includes(index) && !(await fileTracked(directory, index))) {
          const phased = opts.phases !== undefined && opts.phases !== "m"
          // The proposal channel's shortcut (plans/0115): with a released
          // `### R-NN` round-brief proposal waiting and the brief still the
          // stub, committing the setup is all this gate asks — the next
          // transfer installs the proposal verbatim ahead of the construct.
          const proposal = phased && (await roundBriefText(directory, round)) === undefined ? await releasedRoundBriefProposal(directory, round) : undefined
          log(
            `⏸ round-start gate: the setup of round ${round} is not committed yet. Review it` +
              `${phased ? `, fill in ${roundBriefPath(round)} (goal, acceptance and release criteria)` : ""}, commit, and re-run:` +
              (proposal !== undefined
                ? ` (a released \`### R-${String(round).padStart(2, "0")}\` round-brief proposal of ${ANALYSIS_DOC} waits — committing the setup is enough, the next transfer installs it verbatim)`
                : ""),
          )
        } else {
          log("⏸ the worktree has uncommitted changes; to ensure execution units start on a clean baseline, handle them manually (commit or clean) and re-run:")
        }
        for (const file of gate.files) log(`  ${file}`)
        progress.close()
        watcher?.close()
        return { exit: 2 }
      }
    }
  }
  // Branch-isolation leftovers (plans/0074 §4, U-L2): round branches of
  // earlier rounds that still hold unlanded work — recoverable state, not
  // corruption, so a warning naming the addresses (land by hand / remove),
  // never a block: the run continues on the live round branch. A lane worker
  // skips it — the parent owns the main tree's report. Read-only, hence
  // under dryrun too.
  if (!opts.lane && opts.isolate?.length) {
    for (const line of await leftoverIsolationLines(directory, opts.isolate, `auto/${roundDirName(await currentRound(directory))}`)) log(line)
  }
  // Orphan recovery (plans/0068 D14, S3): the registry's lane entries of a
  // killed parent run — a live worker is awaited then landed (the cattle
  // property: they finish; nothing of a lane's work is lost), a dead one
  // re-dispatched in place, resuming through its own progress record, up to
  // the attempts cap — and the park's stragglers pruned after the liveness
  // checks. This is the scheduler's preflight step: it runs for exactly the
  // runs whose loop schedules lanes (plans/0096 D10: schedulerActive AND a
  // worktree tier — at Tier 0 nothing here runs, the byte-identical floor of
  // a maxSessions = 1 run), and a lane worker (opts.lane) owns no lanes of
  // its own. A leftover scene under Tier 0 therefore waits for a worktree
  // tier run or the person — the same story a maxSessions = 1 run has always
  // told; the park is inert (gitignored), and resetInProgress below frees the
  // orphaned unit for the serial loop without touching the scene.
  if (!opts.dryrun && !opts.lane && worktreeScheduler(opts.maxSessions, treeTier)) {
    const recovered = await recoverOrphanLanes(run.git, directory)
    if (recovered !== undefined) {
      progress.close()
      watcher?.close()
      return { exit: recovered }
    }
  }
  // The regression lane's orphan (plans/0098 D4): a background copy or its
  // in-flight marker the previous parent run left behind. Unlike the lane
  // scenes above, the background copy exists at every tier (the serial Tier 0
  // loop launches it too), so its recovery runs for every parent run — the
  // copy is disposable (no receipt landed, the lane re-runs at the next
  // boundary), nothing is re-dispatched. A lane worker (opts.lane) owns no
  // background run of its own; dryrun changes no state.
  if (!opts.dryrun && !opts.lane) await recoverRegression(directory)
  // interruption recovery: the previous run, killed/Ctrl+C'd, may leave
  // in_progress marks behind (no session running); they are reset to pending,
  // and the main loop still resumes through next(), attempts kept. When close
  // enough to the interruption, the session's progress record on the chain
  // (.auto/progress.json) makes runTask reuse the original session and
  // continue. The marks are runtime state (.auto/units.json, not in git,
  // M3.4) and produce no commit. dryrun changes no state file.
  // The doc scheduler's own leftovers are kept (plans/0156 D1): preflight
  // once reset every mark before the loop was entered, so the doc-lane
  // recovery flatten (plans/0099 D10) never saw a real cross-run leftover —
  // its designed protections (sibling scopes for the start gates, the
  // rollback refusal) were silently disarmed. The keep-set is exactly the
  // marks the flatten reads — the current phase's doc-eligible in_progress
  // units — computed only when this run dispatches the doc scheduler (the
  // branch's own predicate; a lane worker never runs the doc loop, a
  // serial run has no flatten to feed). If the run stops before the doc
  // loop is reached, the kept marks persist to the next run — the same
  // recovery shape, one run later.
  const docKeep = new Set<string>()
  if (!opts.dryrun && !opts.lane && autoSwitches().docLanes && !autoSwitches().laneIsolation && docScheduler(opts.maxSessions, treeTier)) {
    const state = await readPhases(directory).catch(() => undefined)
    const phase = state ? currentPhase(state) : undefined
    if (phase) {
      const plan = await loadPlan(directory, phase).catch(() => undefined)
      if (plan) for (const unit of plan.tasks) if (unit.status === "in_progress" && docEligible(unit)) docKeep.add(unit.id)
    }
  }
  if (!opts.dryrun) {
    const stale = await resetInProgress(directory, docKeep)
    if (stale.length) log(`↻ resuming interrupted state: ${stale.join(", ")} reset from in_progress to pending`)
    if (docKeep.size) log(`↻ doc-lane recovery: ${[...docKeep].join(", ")} kept in_progress for the doc loop's recovery flatten (plans/0099 D10)`)
  }
  // before the first session, ensure AGENTS.md's opencode-auto block matches
  // the current config rendering (append when missing, replace the whole block
  // when its content differs from the rendering, clean up old-version or
  // redundant named marker blocks across the board). AGENTS.md is read-only
  // during run (protect.ts), sessions never maintain it (plans/0054 D2);
  // ensurePointer unprotects and re-protects around its own writes.
  // A lane worker (opts.lane) skips this and the gitignore write below: its
  // worktree received both by the scaffolding copy (§6.5 ③ — already correct
  // by copy), and the parent owns the main tree's housekeeping (D6).
  if (!opts.lane) {
    const ensured = await ensurePointer(directory, { testByDriver: opts.testByDriver })
    if (ensured.block === "inserted") log("inserted: AGENTS.md opencode-auto block")
    if (ensured.block === "replaced") log("refreshed: AGENTS.md opencode-auto block (differed from the current config rendering)")
    if (ensured.legacyRemoved) log(`cleaned: ${ensured.legacyRemoved} legacy/redundant opencode-auto marker block(s) in AGENTS.md`)
    if (await ensureGitignore(directory)) log("updated: .gitignore now ignores tmp/ and .auto/(driver working directory and runtime state)")
  }
  // the housekeeping close-out commit: the writes ensurePointer/ensureGitignore
  // make are driver changes, booked at once so the worktree is clean when the
  // first execution unit starts; commit failure exits 2 as an environment
  // block (plans/0021-commit-boundary-design.md P3). dryrun makes no commit
  // (the seam's changedFiles read is real here — preflight built the
  // production holder, whose dirty list decides whether anything posts).
  // The interrupted-unit exemption skips it (plans/0149): the sweep would
  // absorb the resumed unit's uncommitted batch into a PLAN commit; the
  // driver's own run-start writes ride the resumed unit's close with it.
  if (!opts.dryrun && !exemptResume && (await run.git.changedFiles(directory)).length) {
    const settled = await run.git.commitTree(directory, { id: "PLAN", title: "pre-run baseline close-out" }, {
      stage: "housekeeping",
      subject: "PLAN housekeeping pre-run baseline close-out (AGENTS.md pointer block/.gitignore/interrupted-state reset)",
    })
    if (!settled.ok) {
      log(`⏸ pre-run baseline close-out commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}, handle git manually and re-run`)
      progress.close()
      watcher?.close()
      return { exit: 2 }
    }
  }
  return { agentName, watcher, progress, registry, services: run, treeTier }
}

// The dispatches this run can send (plans/0055 §6.3): every role its
// reachable phase types dispatch, plus the run-level roles no phase owns.
// The reachable types are the phases value in force for the current round —
// the D5 resolution passed by the caller (the roadmap's line, else the
// configured phases; custom types included, resolved against the loaded
// type list); "m" is the implicit implement phase. Per type with tasks: the
// task sessions take the type's execute tier (`whole` outside the true
// subtask mode — auto's lead is a whole-task session, plans/0059 D2 —,
// `subtask` in every mode — a checklist a person wrote dispatches too —,
// and the merged understand/decompose session in the true mode, the planned
// pipeline), and the wrap-up session runs unless
// wrapup is off; a type without tasks runs its own knowledge session.
// Run-level: the bypass one-offs in every mode (confirm turns, context-base
// rebuilds, the dryrun precheck), the phased loop's planning and handover
// sessions, and m mode's planning scan. prior-knowledge
// (shell-orchestrated outside runAll) stays off the list: a simple session,
// so the bypass need keeps its tier covered.
// AUTO-RESOLVE: does the default m mode need the deep tier? -> only under subtask: true, through the decompose sessions of its implicit implement phase (the pipeline runs the merged understand/decompose session, a deep role of that phase; §6.3 makes an emptied needed list a preflight error rather than a mid-run wait, and the previous trigger — deep only when the run plans or scans — would leave those dispatches waiting silently). The default subtask mode auto runs a lead whole-task session instead (plans/0059 D2, §11: the lead takes the whole role's tier), so like off and ondemand it takes the implement type's execute tier and the default m mode needs no deep tier unless it plans or scans.
function dispatchNeeds(opts: RunAllOpts, types: readonly PhaseTypeEntry[], phases: string): DispatchNeed[] {
  // An invalid phases value fails at its own validation (config load, the
  // loop's routing); the coverage check stays total on the implicit type.
  const entries = resolvePhases(phases, types) ?? [phaseType(REQUIRED_TYPE)!]
  const phased = phases !== "m"
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

// Removes the retired auto-numbering record (.auto/next-task) when an
// earlier release left one; returns whether it did. Same shape as
// removeRetiredInvalidRefs: the file lives inside the driver's own
// gitignored state directory, so any instance of it is ours, and the
// deletion rides no commit (plans/0150 — the next number is derived from
// the surviving files; the record reads as nothing).
export async function removeRetiredNumberingRecord(dir: string): Promise<boolean> {
  const file = join(dir, ".auto", "next-task")
  if (!(await Bun.file(file).exists())) return false
  await rm(file, { force: true })
  return true
}

// —— The tier probe (plans/0096 D10, Stage 5) —— //

// The probe facts of one run: whether this filesystem can reflink (the CoW
// capability tier 1 is built on — btrfs/XFS; hardlink farms and overlayfs are
// rejected outright by the plan, D9, so no capability means no tier 1), and
// the working tree's size — weighed only when a budget is declared, since
// the walk is the probe's one nontrivial cost. The facts are injected into
// the pure decision (lanes.ts resolveTreeTier) and never guessed: a test
// states an outcome the host filesystem cannot provide.
async function probeTierFacts(dir: string, lanes: LanesConfig | undefined): Promise<TierProbe> {
  return {
    reflink: await probeReflink(dir),
    ...(lanes?.treeBudgetMB !== undefined ? { treeMB: await workingTreeMB(dir) } : {}),
  }
}

// —— Orphan recovery (plans/0068 D14, stage S3; the report-first and identity
// reads restated by plans/0210 D4/D5) ——

// The orphan wait's cadence (0210 D5): the poll keeps D14's 500 ms; the
// notice repeats every 10 s, naming the pid and the manual way out — the
// person is the terminal of every bounded wait (P20's tension clause).
const ORPHAN_POLL_MS = 500
const ORPHAN_NOTICE_MS = 10_000

// The next parent run's preflight scan of the lane registry, ahead of any
// scheduling of its own: for every registry entry left by a killed parent —
//   - the worktree's report is read first, whatever the pid says: a written
//     report is the worker's controlled exit (0068 D8's own letter — the
//     report's ABSENCE is the orphan signal), landed or blocked on its
//     verdict; a dead pid never overrides one (0210 D4 — the old pid-keyed
//     read decided every controlled exit of a dead worker as a crash and
//     re-ran finished units);
//   - a report-less scene with a live pid is awaited then landed: the
//     workers are cattle, they finish, and the lane's committed work is
//     never lost — but only once the worktree's own run lock identifies the
//     recorded pid (this host, the same number; 0210 D5 — a bare pid probe
//     cannot tell the lane worker from a recycled pid after a restart or a
//     scene copied from another host, and an unidentified live pid is one ⚠
//     line and the crashed posture, never an unbounded hang); the wait
//     repeats its notice line so its terminal is always the person;
//   - a dead or unidentified pid with no report is re-dispatched — the
//     worker re-runs the same unit in the same worktree, resuming precisely
//     through its own progress record — up to the attempts cap, after which
//     the scene blocks naming the park path;
//   - a scene the recovery cannot own (a missing worktree, an unresolvable
//     phase) blocks the same way.
// After the records, the park's stragglers — worktree directories with no
// registry entry — are pruned (`git worktree prune` + directory removal after
// the same liveness reading: a straggler holding a live run lock is a worker
// whose registry write never landed, and it is left alone).
// Returns undefined when the run may continue (every lane recovered or none
// existed), or the exit code it must take instead (2: a scene blocked naming
// the park path; 1 never — an environment error inside one recovery worker
// surfaces as that worker's blocked report).
export async function recoverOrphanLanes(gitOps: GitOps, dir: string): Promise<number | undefined> {
  const records = await laneRecords(dir)
  for (const record of records) {
    const park = join(dir, record.worktree)
    if (!(await Bun.file(join(park, ".git")).exists())) {
      log(`⏸ the lane record of ${record.unit} names ${record.worktree}, which no longer exists; remove the record (.auto/units.json) or restore the worktree and re-run`)
      return 2
    }
    let report = await readLaneReport(park)
    if (report === undefined && record.pid !== undefined && pidAlive(record.pid)) {
      // The identity read (0210 D5): the worktree's own run lock — host, pid
      // namespace, start time, 0183 D4's one liveness identity — must name
      // the recorded pid on this host. An unreadable lock counts as live
      // (conservative, P12, the same reading lockLines makes).
      const holder = liveRunLock(park)
      if (holder === "unreadable" || (holder !== undefined && holder.pid === record.pid && holder.host === hostname())) {
        log(`↻ ${record.unit} a lane worker of the previous run is still executing in ${record.worktree} (pid ${record.pid}); awaiting its exit, then landing it`)
        for (let waited = 0; pidAlive(record.pid!); waited += ORPHAN_POLL_MS) {
          if (waited > 0 && waited % ORPHAN_NOTICE_MS === 0) log(`ℹ still awaiting the lane worker of ${record.unit} (pid ${record.pid}); if no lane worker is running, remove its record in .auto/units.json and re-run`)
          await Bun.sleep(ORPHAN_POLL_MS)
        }
        report = await readLaneReport(park)
        if (report === undefined) log(`⚠ the awaited worker of ${record.unit} exited without a report; treating its scene as a crashed lane and re-dispatching it in place`)
      } else {
        log(`⚠ ${record.unit} a live pid ${record.pid} is recorded, but the worktree's run lock does not name it on this host (a reused pid after a restart, or a scene from another host); treating the lane as crashed`)
      }
    }
    // A dead worker (or an awaited one that crashed on its way out): the
    // re-dispatch loop, resumed through the worktree's own progress record,
    // gated by lanes.ts's orphanRedispatch decision (D14's shared rule —
    // the scheduler's loop re-dispatches under the same cap; recovery here
    // always schedules, so a "keep" is always the cap).
    while (report === undefined) {
      if (orphanRedispatch(await unitAttempts(dir, record.unit)).type === "keep") {
        // The inspection hint names the branch git holds (plans/0191 D5):
        // the scene may sit on a pre-realpath-digest spelling of its lane
        // branch, and the person reading this line needs the branch that
        // exists.
        const branch = await resolveLaneBranch(dir, record.unit, park)
        log(`⏸ ${record.unit} hit its dispatch attempts cap (${LANE_DISPATCH_CAP}) without completing; the scene is kept at ${lanePark(record.unit)} — inspect it manually (the lane branch ${branch} holds the last attempt's commits) and re-run after fixing it`)
        return 2
      }
      const dispatched = await dispatchLane(gitOps, dir, { id: record.unit, title: record.unit })
      if (dispatched.type === "failed") {
        log(`⏸ ${dispatched.error}`)
        return 2
      }
      // The dispatch attached D13's prefix relay: the recovery worker's
      // output reaches this run's terminal and log as it arrives (the events
      // beside it stay unwritten — the run-status bracket opens only after
      // preflight, so a recovered lane's story is the log's).
      const exit = await laneExit(dispatched.worker, dispatched.output)
      report = await readLaneReport(dispatched.worktree)
      if (report === undefined) log(`⚠ the re-dispatched worker of ${record.unit} exited without a report (exit ${exit.code}); trying again while the attempts cap allows`)
    }
    const outcome = laneOutcome(report.ok ? 0 : 2, report)
    if (outcome.kind === "land") {
      const landed = await landRecovered(gitOps, dir, record.unit, report)
      if (landed !== undefined) return landed
      log(`✓ ${record.unit} recovered: the orphaned lane landed (a worker of the previous run finished it)`)
      continue
    }
    // blocked (an environment error is indistinguishable from the report
    // alone and lands the same conservative way): land the committed work,
    // block the unit, exit 2 naming the report.
    const landed = await landRecovered(gitOps, dir, record.unit, report)
    await block(dir, record.unit)
    const reason = report.blocked ?? `the lane report concluded Result: ${report.result ?? "FAIL"}`
    log(`⏸ ${record.unit} is blocked after its recovery (the reason is recorded only in this log):\n${reason}`)
    return landed !== undefined ? landed : 2
  }
  await pruneLaneStragglers(gitOps, dir, records)
  return undefined
}

// Land one recovered lane's report (D7's five steps over the phase the
// report names). Returns undefined when the landing succeeded, or exit 2 —
// the scene stays named for the human.
async function landRecovered(gitOps: GitOps, dir: string, unit: string, report: LaneReport): Promise<number | undefined> {
  const state = await readPhases(dir)
  const phase = state?.phases.find((entry) => phaseKey(entry).id === report.phase)
  if (phase === undefined) {
    log(`⏸ the lane report of ${unit} names phase ${report.phase || "(none)"}, which the phase index does not hold; the scene is kept at ${lanePark(unit)} for manual landing`)
    return 2
  }
  const planPhase = { round: phase.round, id: phase.id, dir: phase.dir }
  const plan = await loadPlan(dir, planPhase).catch(() => undefined)
  const task = plan?.tasks.find((entry) => entry.id === unit) ?? { id: unit, title: unit }
  const landed = await landLane(gitOps, dir, planPhase, task, report)
  if (landed.type === "conflict") {
    log(`⏸ landing the recovered lane of ${unit} hit a conflict (the merge was aborted, the main tree is clean): ${landed.detail}. The lane scene is kept at ${lanePark(unit)}; resolve it manually or re-run to retry the lane in place`)
    return 2
  }
  if (landed.type === "blocked") {
    log(`⏸ landing the recovered lane of ${unit} failed: ${landed.error}`)
    return 2
  }
  if (!landed.teardown) log(`⚠ ${unit} recovered and landed, but the lane's park cleanup left something behind (see the warnings above); the lane record is cleared`)
  return undefined
}

// Prune the park's stragglers (D14): worktree directories with no registry
// entry — the leftovers of a dispatch interrupted between the worktree's
// creation and the runtime-field write, or of a hand-cleared registry. Each
// is checked for a live run lock first (a worker mid-flight there must not be
// pruned); then its directory is removed, git's worktree metadata pruned
// (ahead of the branch deletion — git refuses -D on a branch a registered
// worktree still checks out), and the lane branch deleted (a straggler's
// branch would block the unit's next `worktree add -b`).
async function pruneLaneStragglers(gitOps: GitOps, dir: string, records: readonly { unit: string }[]): Promise<void> {
  const known = new Set(records.map((record) => record.unit))
  const parkRoot = join(dir, ".auto", "worktrees")
  const prunedDirs: string[] = []
  for (const entry of await readdir(parkRoot, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || known.has(entry.name)) continue
    const worktree = join(parkRoot, entry.name)
    const holder = liveRunLock(worktree)
    if (holder !== undefined && holder !== "unreadable") {
      log(`⚠ the park holds ${join(".auto", "worktrees", entry.name)} with no lane record while a live run lock names pid ${holder.pid}; leaving it alone — re-run once it exits`)
      continue
    }
    if (holder === "unreadable") {
      log(`⚠ the park holds ${join(".auto", "worktrees", entry.name)} with no lane record and an unreadable run lock; leaving it alone — inspect it manually`)
      continue
    }
    await rm(worktree, { recursive: true, force: true })
    prunedDirs.push(entry.name)
  }
  if (prunedDirs.length) {
    const pruned = await gitOps.pruneWorktrees(dir)
    if (!pruned.ok) log(`⚠ git worktree prune failed: ${pruned.error}`)
    for (const name of prunedDirs) {
      // The ladder without a worktree to ask (plans/0191 D5): the grammar's
      // name, else the single stranded spelling of the unit's lane branch —
      // a straggler created before the digest keyed the realpath hashes the
      // spelling, and the prune exists so the unit's next `worktree add -b`
      // does not meet it.
      const branch = await resolveLaneBranch(dir, name)
      const deleted = await deleteBranch(dir, branch)
      if (!deleted.ok) log(`⚠ deleting the straggler's lane branch ${branch} failed: ${deleted.error}`)
      log(`removed: the park straggler ${join(".auto", "worktrees", name)} (a worktree with no lane record)`)
    }
  }
}
