// transfer, the single advance command (plans/0101 D2) — the person brackets
// every boundary, the documents decide, the driver applies. One advance per
// invocation, resolved by state:
//   1. project start (no round): the 0084 rows 0/0a–0d re-homed — the
//      analysis stub and its AGENTS.md guidance, the release gate, the
//      approved brief's install, R-01's establishment under the roadmap's
//      line (D5) — stopping at the round-start gate (the setup stays
//      uncommitted; committing it is the person's review, G1);
//   2. phase boundary (the current phase complete): the human gate checked
//      first — a survey with open forks refuses exit 2 ahead of any session,
//      the release act stays writing `Clarified: yes` — then, through the
//      loop under stopBefore "formulate" (runAll), the handover
//      distillation, the phase close (installApprovedBrief on a released
//      survey — what today's run re-entry did, absorbed), and the next
//      phase's formulation todo constructed and stopped for review (D3);
//   3. round close: the same invocation, when the closed phase was the
//      round's last, additionally performs the round close and stops there —
//      the full stop between rounds is the person's natural moment with
//      R-NN's report before committing to R-NN+1 (the loop's complete
//      route gates it, exit 2 naming the checks);
//   4. round open (the round closed): the roadmap's next line applied (D5)
//      — a released roadmap that plans lines governs the sequence's end, so
//      the round past its last line meets the roadmap-exhausted stop naming
//      the extend-the-document channel, never a silent config round —
//      establishing and stopping at G1; the construction is the following
//      invocation's (the round-start commit sits between, as in shape 1).
// The refusals between: m mode keeps today's shape entirely (D8 — plan and
// run, no boundary vocabulary applies), nothing to advance (the phase still
// holds pending work — run's), and the gate-held stop. Exit codes: the
// review, round-open and exhausted stops 0; the gate-held and
// nothing-to-advance refusals 2; usage and state errors 1.
// The lock is taken here and held across the pre-checks and the loop (runAll
// re-enters it per process), the plan --force-close precedent; the
// clean-tree refusals are preflight's (the advance runs only on a committed
// state — establishment deliberately does not, its G1 stop is the point).
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { ensurePointer } from "./agents-block"
import { analysisProblems, releasedRoadmapRounds, renderAnalysisStub } from "./analysis"
import { briefProposal, installBriefProposal } from "./brief"
import { ANALYSIS_DOC, roundBriefPath, roundDirName } from "./docpaths"
import { isFormulation } from "./formulate"
import { commitTree } from "./git"
import { runAll } from "./loop"
import { logGateStop } from "./loop-phase"
import type { RunAllOpts } from "./loop-preflight"
import { log } from "./log"
import { acquireRunLock, lockLines } from "./lock"
import {
  CLARIFIED_MARK,
  clarifiedMark,
  currentRound,
  legacyLayoutProblem,
  phaseGates,
  phaseGateProblems,
  phaseIndexPath,
  phaseLabel,
  roundRoot,
  routePhase,
  surveyForks,
} from "./phases"
import { loadPhaseTypes } from "./phases/custom"
import { establishRoundSetup, phaseRefText, truncateGoal } from "./plan"
import { roundCloseLines, roundCloseProblems } from "./round-close"
import { shellProfile } from "./shell"
import { autoSwitches } from "./switches"
import { loadPlan } from "./tasks"

// The shell's entry: the run lock ("transfer", re-entered by the runAll the
// advance delegates to), then the state-resolved advance.
export async function runTransfer(directory: string, opts: RunAllOpts): Promise<number> {
  const lock = acquireRunLock(directory, "transfer")
  if (!lock.ok) {
    for (const line of lockLines(directory, lock.holder)) log(line)
    return 1
  }
  try {
    return await transferAdvance(directory, opts)
  } finally {
    lock.release()
  }
}

async function transferAdvance(directory: string, opts: RunAllOpts): Promise<number> {
  const { bin } = shellProfile()
  // m mode keeps today's shape entirely (plans/0101 D8): the single implicit
  // phase, the formulation riding run, the planning input the person's lever
  // — no boundary vocabulary applies, so transfer refuses rather than
  // pretending one.
  if ((opts.phases ?? "m") === "m") {
    log(
      `⏸ transfer applies to phased projects: this one runs m mode (the single implicit phase), whose planning and execution keep their shapes — ` +
        `plan with ${bin} plan ${directory} -p <text> | --file <path>, execute with ${bin} run ${directory}`,
    )
    return 1
  }
  const legacy = await legacyLayoutProblem(directory)
  if (legacy) {
    log(legacy)
    return 1
  }
  const round = await currentRound(directory)
  // Shape 1: no established round — the assisted analysis flow, or a direct
  // / resumed establishment (the switch off, a later round, an interrupted
  // round start).
  if (!(await Bun.file(join(directory, phaseIndexPath(round))).exists())) return await projectStart(directory, round, opts)
  const route = await routePhase(directory, { loadPlan, bin })
  if (route.type === "blocked") {
    log(`⏸ phase flow blocked: ${route.reason}`)
    return 1
  }
  // Shape 4: the round closed — the round-close gate, then the next round
  // from the roadmap's line or the exhausted stop.
  if (route.type === "complete") return await roundOpen(directory, round, opts)
  // The construct-and-review tail (shapes 1/2/4's second invocation, and the
  // rejection channel of D3): an empty index awaits its formulation todo, a
  // pending formulation task awaits dispatch — either way the loop
  // constructs (idempotent rewrite-on-diff; the digest-keep holds an
  // unchanged floor) and stops at the review seam.
  if (route.type === "plan") return await advanceToReview(directory, opts)
  if (route.type === "execute") {
    const remaining = route.plan.tasks.filter((task) => task.status !== "done")
    if (remaining.length && remaining.every((task) => isFormulation(task, route.phase))) return await advanceToReview(directory, opts)
    log(
      `⏸ nothing to advance: ${phaseRefText(route.phase)} still holds ${remaining.length} pending task(s) — ` +
        `execute them first: ${bin} run ${directory}; the boundary follows their completion`,
    )
    return 2
  }
  // Shape 2/3: the phase boundary. The human gate first (D2): a survey with
  // open forks refuses exit 2 ahead of any session — no tokens spent before
  // the person's decision — naming survey.md, the forks and the release
  // line; the release's other halves (installApprovedBrief, the completePhase
  // re-check) run inside the advance the next invocation performs.
  const gates = phaseGates(route.phase, opts.acceptanceGate)
  if (gates.includes("human")) {
    const problems = await phaseGateProblems(directory, route.phase, ["human"])
    if (problems.length) {
      logGateStop(directory, route.phase, problems, undefined)
      return 2
    }
  }
  return await advanceToReview(directory, opts)
}

// The advance proper (shapes 2/3's sessions and every construction): the
// loop under stopBefore "formulate" — the handover distillation, the phase
// close, the round close at the complete route all run inside it, and it
// stops at the construction's review seam inside the planning step
// (loop-plan's stop, D3's output), never dispatching a task session.
// preflight's gates apply unchanged (the clean tree above all: the advance
// runs only on a committed state).
async function advanceToReview(directory: string, opts: RunAllOpts): Promise<number> {
  return await runAll(directory, { ...opts, stopBefore: "formulate" })
}

// Shape 1 (plans/0101 D2): the 0084 rows 0/0a–0d re-homed from plan — today's
// shapes and exit semantics as they move, the stop lines naming transfer's
// rhythm. OPENCODE_AUTO_ANALYSIS=off degrades to direct establishment from
// config, no analysis machinery (D8).
async function projectStart(directory: string, round: number, opts: RunAllOpts): Promise<number> {
  const { bin } = shellProfile()
  let analysisOn: boolean
  try {
    analysisOn = autoSwitches().analysis
  } catch (error) {
    log(error instanceof Error ? error.message : String(error))
    return 1
  }
  if (analysisOn && round === 1 && !(await roundRoot(directory, 1))) {
    const raw = await Bun.file(join(directory, ANALYSIS_DOC)).text().catch(() => undefined)
    if (raw === undefined) {
      await mkdir(join(directory, "docs"), { recursive: true })
      await Bun.write(join(directory, ANALYSIS_DOC), renderAnalysisStub())
      await ensurePointer(directory, { testByDriver: opts.testByDriver, guidance: { kind: "analysis" } })
      log(`✓ the project analysis is open: ${ANALYSIS_DOC} written (a stub with section hints)`)
      log(`next: work with your coding agent on ${ANALYSIS_DOC} — the analysis, the goals, one \`Fork:\` line per open decision, the project-brief proposal and the multi-round roadmap; this state's guidance is in AGENTS.md`)
      log(`then add the line \`${CLARIFIED_MARK}\`, commit, and re-run: ${bin} transfer ${directory} — the approved brief is installed and round R-01 opens`)
      return 0
    }
    let types: ReturnType<typeof loadPhaseTypes>
    try {
      types = loadPhaseTypes(directory)
    } catch (error) {
      log(`⏸ ${error instanceof Error ? error.message : String(error)}`)
      return 1
    }
    const problems = analysisProblems(raw, types)
    if (problems.length) {
      await ensurePointer(directory, { testByDriver: opts.testByDriver, guidance: { kind: "analysis" } })
      log(`⏸ ${ANALYSIS_DOC} has problems that hold its release:`)
      for (const problem of problems) log(`  ${problem}`)
      log(`fix them with your agent (this state's guidance is in AGENTS.md), commit, then re-run: ${bin} transfer ${directory}`)
      return 2
    }
    if (!clarifiedMark(raw)) {
      await ensurePointer(directory, { testByDriver: opts.testByDriver, guidance: { kind: "analysis" } })
      const forks = surveyForks(raw)
      log(
        `⏸ the project analysis awaits you: review ${ANALYSIS_DOC}` +
          (forks > 0 ? `, resolve its ${forks} open Fork: line(s) (append your answers beside them)` : "") +
          `, then add the line \`${CLARIFIED_MARK}\` and commit`,
      )
      log(`then re-run: ${bin} transfer ${directory} — the approved \`## Project brief\` proposal is installed and round R-01 opens`)
      return 2
    }
    // The release (row 0d's shape): the approved brief proposal installs
    // verbatim, then R-01 establishes under the D5 resolution — the sourced
    // G1 stop names the line that ruled.
    const proposal = briefProposal(raw)
    if (proposal !== undefined) for (const line of await installBriefProposal(directory, ANALYSIS_DOC, proposal, commitTree)) log(line)
    return establishStop(directory, 1, opts, [])
  }
  // The switch off, a later round, or an interrupted establishment (row 1's
  // shape): the previous round's round-close check, then the establishment.
  if (round > 1) {
    const close = await roundCloseProblems(directory, round - 1, { build: opts.build, scanExempt: opts.scanExempt })
    if (close.problems.length) {
      log(`⏸ round ${roundDirName(round - 1)} does not pass its round-close checks, so round ${roundDirName(round)} cannot open yet`)
      for (const line of roundCloseLines(close)) log(line)
      log(`next: fix them, commit, then re-run: ${bin} transfer ${directory}`)
      return 2
    }
  }
  return establishStop(directory, round, opts, [])
}

// Shapes 1/4's stop: the establishment itself is establishRoundSetup (shared
// with plan's row machinery); transfer renders its own G1 lines — the
// round-start commit is the person's review, and the command that follows it
// is transfer (the construction and its review stop), not plan's dispatch.
async function establishStop(directory: string, round: number, opts: RunAllOpts, before: string[]): Promise<number> {
  const { bin } = shellProfile()
  const name = roundDirName(round)
  const setup = await establishRoundSetup(directory, round, { phases: opts.phases!, isolate: opts.isolate, testByDriver: opts.testByDriver })
  if (setup.type === "dirty") {
    for (const line of before) log(line)
    log(
      `⏸ round ${name} cannot open yet: a repository designated by config isolate is not clean, and branch isolation requires clean repositories; ` +
        `handle it manually (commit/clean) and re-run:`,
    )
    for (const { rel, files } of setup.repos) {
      log(`  ${rel}:`)
      for (const file of files) log(`    ${file}`)
    }
    return 2
  }
  if (setup.type === "failed") {
    for (const line of before) log(line)
    log(`branch isolation failed, nothing was written: ${setup.error}; fix the repository and re-run: ${bin} transfer ${directory}`)
    return 1
  }
  if (setup.type === "invalid") {
    for (const line of before) log(line)
    log(`⏸ ${setup.problem}; fix the roadmap line (or the phase types it names), then re-run: ${bin} transfer ${directory}`)
    return 1
  }
  if (setup.type === "error") {
    for (const line of before) log(line)
    log(`round establishment failed: ${setup.error}`)
    return 1
  }
  const { units, isolated, resolved, branch } = setup
  const sourceSuffix = resolved.roadmap ? ` — phases from the roadmap of ${ANALYSIS_DOC} (${name} line "${truncateGoal(resolved.roadmap.goal)}"; config default was "${opts.phases}")` : ""
  for (const line of before) log(line)
  log(`✓ round ${name} established: ${units.map(phaseLabel).join(", ")}${sourceSuffix}`)
  if (isolated.length) log(`✓ branch isolation: ${isolated.join(", ")} on ${branch} (the driver's commits land there; the original branch stays untouched)`)
  log(
    `next (round-start gate): review the round setup, fill in ${roundBriefPath(round)} (goal, acceptance and release criteria), and commit it; ` +
      `then run: ${bin} transfer ${directory} — it constructs ${phaseRefText(units[0]!)}'s plan task and stops for your review (plan dispatches it, run executes the phase)`,
  )
  log(`ℹ AGENTS.md carries this state's preparation guidance for your coding agent (the round brief's sections, and where their content comes from)`)
  return 0
}

// Shape 4 (plans/0101 D2): the round closed. The round-close checks gate the
// next round's opening (exit 2 naming them, plan row 2's shape), and the
// released roadmap governs the sequence's end — the round past its last line
// meets the exhausted stop naming the extend-the-document channel (0084 D3's
// documents-are-the-interface rule, holding to the end), never a silent
// config round; a project with no released roadmap keeps falling back to
// config `phases` (D5), today's behavior.
async function roundOpen(directory: string, round: number, opts: RunAllOpts): Promise<number> {
  const { bin } = shellProfile()
  const close = await roundCloseProblems(directory, round, { build: opts.build, scanExempt: opts.scanExempt })
  if (close.problems.length) {
    log(`⏸ round ${roundDirName(round)} does not pass its round-close checks, so round ${roundDirName(round + 1)} cannot open yet`)
    for (const line of roundCloseLines(close)) log(line)
    log(`next: fix them, commit, then re-run: ${bin} transfer ${directory}`)
    return 2
  }
  const roadmap = await releasedRoadmapRounds(directory)
  if (roadmap !== undefined && !roadmap.some((entry) => entry.round === round + 1)) {
    log(`✓ round ${roundDirName(round)} is closed, and the roadmap of ${ANALYSIS_DOC} holds no line for round ${roundDirName(round + 1)} — the planned work of the roadmap is done`)
    log(
      `next: extend ## Roadmap of ${ANALYSIS_DOC} with the next round's line (\`- ${roundDirName(round + 1)} <phases> — <goal>\`, its phases value the round establishes under), ` +
        `commit, then re-run: ${bin} transfer ${directory}`,
    )
    return 0
  }
  return establishStop(directory, round + 1, opts, roundCloseLines(close))
}
