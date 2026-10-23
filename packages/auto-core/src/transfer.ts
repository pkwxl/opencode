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
//      R-NN's close listing (a commissioned report beside it) before
//      committing to R-NN+1 (the loop's complete route gates it, exit 2
//      naming the checks);
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
// Since plans/0101 D6 every construct path opens with the re-derivation of
// the round's unstarted tail — the person's boundary amendment applied —
// and `amend --phases` is boundary-scoped to match (amendPhasesHold, the
// shell's amend row calls it): the reshape and its apply are one seam.
// The lock is taken here and held across the pre-checks and the loop (runAll
// re-enters it per process), the plan --force-close precedent; the
// clean-tree refusals are preflight's (the advance runs only on a committed
// state — establishment deliberately does not, its G1 stop is the point).
import { join } from "node:path"
import { ensurePointer } from "./agents-block"
import { releasedRoundBriefProposal } from "./analysis"
import { ANALYSIS_DOC, roundBriefPath, roundDirName } from "./docpaths"
import { awaitingFormulation } from "./formulate"
import { commitTree } from "./git"
import { runAll } from "./loop"
import { logGateStop } from "./loop-phase"
import type { RunAllOpts } from "./loop-preflight"
import { log } from "./log"
import { acquireRunLock, lockLines } from "./lock"
import { loadIntents, planningInputScaffold } from "./intent/load"
import { planInputPath } from "./plan-input"
import { releasedRoadmapRound, releasedRoadmapRounds } from "./roadmap"
import { installRoundBrief, roundBriefText } from "./round-brief"
import {
  currentRound,
  legacyLayoutProblem,
  phaseFlowBlockedLine,
  phaseGates,
  phaseGateProblems,
  phaseIndexPath,
  phaseKey,
  phaseLabel,
  readPhases,
  roundRoot,
  routePhase,
} from "./phases"
import {
  analysisGate,
  applyTailDrift,
  driftPairs,
  establishRoundSetup,
  establishStopLines,
  nothingToAdvanceLine,
  phaseRefText,
  roadmapExhaustedLines,
  roundCloseRefusalLines,
  truncateGoal,
} from "./plan"
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
  const route = await routePhase(directory, { loadPlan, bin, phases: opts.phases ?? "m" })
  if (route.type === "blocked") {
    log(phaseFlowBlockedLine(route.reason))
    return 1
  }
  // Shape 4: the round closed — the round-close gate, then the next round
  // from the roadmap's line or the exhausted stop.
  if (route.type === "complete") return await roundOpen(directory, round, opts)
  // The construct-and-review tail (shapes 1/2/4's second invocation, and the
  // rejection channel of D3): an empty index awaits its formulation todo, an
  // awaiting formulation task awaits dispatch — either way the loop
  // constructs (idempotent rewrite-on-diff; the digest-keep holds an
  // unchanged floor) and stops at the review seam. The predicate is the
  // shared awaiting one (plans/0101 D4): the todo wherever it sits in the
  // index, beside hand-added tasks too.
  if (route.type === "plan") return await advanceToReview(directory, round, opts)
  if (route.type === "execute") {
    if (awaitingFormulation(route.plan.tasks, route.phase)) return await advanceToReview(directory, round, opts)
    log(nothingToAdvanceLine(directory, route.phase, route.plan.tasks.filter((task) => task.status !== "done").length))
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
      await logGateStop(directory, route.phase, problems, undefined)
      return 2
    }
  }
  return await advanceToReview(directory, round, opts)
}

// The advance proper (shapes 2/3's sessions and every construction): the
// unstarted-tail re-derivation first (plans/0101 D6 — the boundary's apply,
// the person's amendment or the moved roadmap line), then the loop under
// stopBefore "formulate" — the handover distillation, the phase close, the
// round close at the complete route all run inside it, and it stops at the
// construction's review seam inside the planning step (loop-plan's stop,
// D3's output), never dispatching a task session. preflight's gates apply
// unchanged (the clean tree above all: the advance runs only on a committed
// state — which is why the re-derivation commits its own rewrite).
async function advanceToReview(directory: string, round: number, opts: RunAllOpts): Promise<number> {
  const stop = await rederiveTail(directory, round, opts)
  if (stop !== undefined) return stop
  await applyReleasedBrief(directory, round)
  return await runAll(directory, { ...opts, stopBefore: "formulate" })
}

// The released round brief, installed ahead of the construction (plans/0104
// D3): whenever the round's brief is still the untouched stub and the
// released analysis carries an `### R-NN` proposal, the advance installs it
// verbatim on its own `round-start` commit — the boundary's apply seam beside
// rederiveTail. This is the held gate's later path (the person drafts the
// proposal into the living document between rounds, commits, and the next
// advance applies it) and the establishment continuation's install site in
// one; the commit sweeps the uncommitted round setup when it runs there. A
// round brief already on disk — the person's hand or a prior install —
// stands, and no proposal is the common floor: both quiet. The install's own
// failure lines log themselves; a failed commit leaves the tree dirty for
// preflight's round-start gate, which names the channel too.
async function applyReleasedBrief(directory: string, round: number): Promise<void> {
  if ((await roundBriefText(directory, round)) !== undefined) return
  const proposal = await releasedRoundBriefProposal(directory, round)
  if (proposal === undefined) return
  const done = await installRoundBrief(directory, round, ANALYSIS_DOC, proposal, commitTree)
  for (const line of done.lines) log(line)
}

// The unstarted-tail re-derivation (plans/0101 D6): a round's phases.md tail
// — every phase with no directory work and no planning yet — is reshaping
// state, not commitment. The person amends --phases (or moves the released
// roadmap's line) at a review moment, and this — the next advance — applies
// the D5 resolution to the tail ahead of the construction: syncPhaseIndex
// replaces the unstarted tail, its own guards carrying the immutability (a
// completed phase or a directory holding work throws — started planning
// holds tasks.md and survives by that alone), and the rewrite lands on the
// driver's own commit, unlike plan's uncommitted re-sync shape: the advance
// needs a committed state, and the construction that follows builds on the
// rewritten index in the same invocation. Returns the exit code when the
// advance must stop, undefined when it may proceed (no drift is the common
// case — the value in force and the index agree).
async function rederiveTail(directory: string, round: number, opts: RunAllOpts): Promise<number | undefined> {
  // The resolve → drift → sync sequence is shared with plan's row 3
  // (applyTailDrift); transfer passes no refusal hook — the advance applies
  // the person's amendment unconditionally — and commits the rewrite itself.
  const applied = await applyTailDrift(directory, round, opts.phases!)
  if (applied.type === "blocked") {
    log(phaseFlowBlockedLine(applied.reason))
    return 1
  }
  if (applied.type === "clean") return undefined
  if (applied.type === "sync-failed") {
    log(`⏸ the unstarted tail cannot be re-derived: ${applied.error}`)
    return 1
  }
  if (applied.type === "refused") return 1 // unreachable: no refusal hook rode along
  const { drift, from } = applied
  const settled = await commitTree(
    directory,
    { id: "PLAN", title: `phase tail re-derived (${roundDirName(round)})` },
    { stage: "phase-sync", subject: `PLAN resync ${roundDirName(round)} tail to ${from} (${driftPairs(drift)})` },
  )
  if (!settled.ok) {
    log(
      `⏸ the re-derived tail could not be committed (${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}). ` +
        `The rewritten ${phaseIndexPath(round)} is kept in the worktree; commit it manually and re-run`,
    )
    return 2
  }
  log(
    `✓ unstarted tail of round ${roundDirName(round)} re-derived to ${from} (${driftPairs(drift)}); ` +
      `started phases are untouched, the rewrite the driver's own commit`,
  )
  return undefined
}

// The boundary-scoped `amend --phases` guard (plans/0101 D6): the unstarted
// tail reshapes at the advance's review moments, so the shell's amend row
// refuses the key mid-phase — the current phase holding pending execute work
// with no formulation awaiting review, the one state that is not a review
// moment (the same predicate as the nothing-to-advance refusal above).
// Ahead of every other guard, the coverage refusal (plans/0103 D3): the
// round this amendment would shape — the live round, or the next one when
// the live round is complete, the same target the shell's prefix guard
// judges — never reads the config value when the released roadmap covers it
// (the D5 resolution: its line is the phase list), so the write is inert at
// any phase state and is refused outright naming the round's own channel
// (0101 D5's precedence note retired by it — the note accepted the inert
// write). A target the roadmap does not cover keeps the key as its live
// establishment authority and stays quiet. undefined = the amendment may
// proceed; m mode never consults the roadmap (D8 — no boundary vocabulary
// applies). A state the router cannot read stays quiet: the amendment's own
// guards judge it.
export async function amendPhasesHold(directory: string, phases: string): Promise<string | undefined> {
  if (phases === "m") return undefined
  const { bin } = shellProfile()
  const round = await currentRound(directory)
  const state = await readPhases(directory, round).catch(() => undefined)
  const complete = state !== undefined && state.phases.length > 0 && state.phases.every((unit) => state.done.has(unit.id))
  const target = complete ? round + 1 : round
  const covered = await releasedRoadmapRound(directory, target)
  if (covered !== undefined) {
    return (
      `--phases cannot shape ${roundDirName(target)}: the released roadmap of ${ANALYSIS_DOC} covers the round — its line is the phase list the round establishes under, and a config value alone never re-shapes a round the roadmap covers. ` +
      `Reshape the round's unstarted tail by moving its \`${roundDirName(target)} <phases> — <goal>\` line in ${ANALYSIS_DOC}; the next ${bin} transfer ${directory} applies it before constructing`
    )
  }
  if (state === undefined) return undefined
  const route = await routePhase(directory, { loadPlan, bin, phases }).catch(() => undefined)
  if (route === undefined || route.type !== "execute" || awaitingFormulation(route.plan.tasks, route.phase)) return undefined
  const pending = route.plan.tasks.filter((task) => task.status !== "done").length
  return (
    `--phases cannot change mid-phase: ${phaseRefText(route.phase)} holds ${pending} pending task(s) — the round's unstarted tail reshapes at a phase boundary; ` +
    `finish the phase with ${bin} run ${directory} (or close it), amend, and the next ${bin} transfer ${directory} applies the value before constructing`
  )
}

// Shape 1 (plans/0101 D2): the 0084 rows 0/0a–0d re-homed from plan — today's
// shapes and exit semantics as they move, the stop lines naming transfer's
// rhythm. OPENCODE_AUTO_ANALYSIS=off degrades to direct establishment from
// config, no analysis machinery (D8).
async function projectStart(directory: string, round: number, opts: RunAllOpts): Promise<number> {
  let analysisOn: boolean
  try {
    analysisOn = autoSwitches().analysis
  } catch (error) {
    log(error instanceof Error ? error.message : String(error))
    return 1
  }
  if (analysisOn && round === 1 && !(await roundRoot(directory, 1))) {
    // The walkthrough itself is shared with plan's rows 0a–0d (analysisGate):
    // the command token and the manual flag are the only differences.
    const gate = await analysisGate(directory, "transfer", { testByDriver: opts.testByDriver, manual: false })
    if (gate.type === "stop") {
      for (const line of gate.lines) log(line)
      return gate.code
    }
    // The release (row 0d's shape): the approved brief proposal installed,
    // R-01 establishes under the D5 resolution — the sourced G1 stop names
    // the line that ruled.
    return establishStop(directory, 1, opts, gate.lines)
  }
  // The switch off, a later round, or an interrupted establishment (row 1's
  // shape): the previous round's round-close check, then the establishment.
  if (round > 1) {
    const close = await roundCloseProblems(directory, round - 1, { build: opts.build, scanExempt: opts.scanExempt })
    if (close.problems.length) {
      for (const line of roundCloseRefusalLines(directory, round - 1, round, close, "transfer")) log(line)
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
  const setup = await establishRoundSetup(directory, round, { phases: opts.phases!, isolate: opts.isolate, testByDriver: opts.testByDriver })
  const ok = setup.type === "ok" ? setup : undefined
  const name = roundDirName(round)
  // The D5 sourced suffix (plans/0101 D5): a roadmap-established round names
  // the line that ruled, beside the config default it displaced.
  const sourceSuffix = ok?.resolved.roadmap ? ` — phases from the roadmap of ${ANALYSIS_DOC} (${name} line "${truncateGoal(ok.resolved.roadmap.goal)}"; config default was "${opts.phases}")` : ""
  // The round-brief proposal channel (plans/0104 D3): a released `### R-NN`
  // proposal passes the round-start gate — the person's release was the
  // review — and the advance continues into the construction in the same
  // invocation, the install landing inside it (applyReleasedBrief) on the
  // driver's own round-start commit, which sweeps this uncommitted setup: the
  // gate's person commit is replaced by the release mark. A round.md already
  // holding content, or no proposal, keeps today's gate stop.
  if (ok && (await roundBriefText(directory, round)) === undefined && (await releasedRoundBriefProposal(directory, round)) !== undefined) {
    for (const line of before) log(line)
    log(`✓ round ${name} established: ${ok.units.map(phaseLabel).join(", ")}${sourceSuffix}`)
    if (ok.isolated.length) log(`✓ branch isolation: ${ok.isolated.join(", ")} on ${ok.branch} (the driver's commits land there; the original branch stays untouched)`)
    log(
      `ℹ the released \`${roundDirName(round)}\` round-brief proposal of ${ANALYSIS_DOC} installs verbatim — the round-start gate passes (your release was its review); ` +
        `revise the brief in place any time, every planning session reads the current file`,
    )
    // The guidance flips to the phase-preparation state (the states flip at
    // command boundaries, and this continuation crosses one): the round
    // brief's step is past, and the document of the moment is the phase's
    // planning input — the todo's other person-owned input.
    const scaffold = planningInputScaffold(loadIntents(directory), opts.intent ?? "default")
    await ensurePointer(directory, {
      testByDriver: opts.testByDriver,
      guidance: {
        kind: "phase",
        phase: phaseKey(ok.units[0]!).id,
        inputPath: planInputPath(ok.units[0]!),
        scaffold: scaffold ?? "(the active intent pack carries no planning-input scaffold — free-form markdown)",
        manual: false,
      },
    })
    return await advanceToReview(directory, round, opts)
  }
  const lines = establishStopLines(
    directory,
    round,
    setup,
    "transfer",
    ok ? `${ok.units.map(phaseLabel).join(", ")}${sourceSuffix}` : "",
    ok
      ? `next (round-start gate): review the round setup, fill in ${roundBriefPath(round)} (goal, acceptance and release criteria), and commit it; ` +
        `then run: ${bin} transfer ${directory} — it constructs ${phaseRefText(ok.units[0]!)}'s plan task and stops for your review (plan dispatches it, run executes the phase)`
      : "",
  )
  for (const line of before) log(line)
  for (const line of lines.lines) log(line)
  return lines.code
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
    for (const line of roundCloseRefusalLines(directory, round, round + 1, close, "transfer")) log(line)
    return 2
  }
  const roadmap = await releasedRoadmapRounds(directory)
  if (roadmap !== undefined && !roadmap.some((entry) => entry.round === round + 1)) {
    for (const line of roadmapExhaustedLines(directory, round)) log(line)
    return 0
  }
  return establishStop(directory, round + 1, opts, roundCloseLines(close))
}
