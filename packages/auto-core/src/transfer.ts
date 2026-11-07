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
// the round's unstarted tail — the person's reshape applied — and the one
// reshape channel is the roadmap line (plans/0137 retired `amend --phases`):
// the reshape and its apply are one seam. Since plans/0206 D3 the mid-phase
// refusal arm re-derives the same way ahead of its own stop, so the apply is
// the advance's in every state, never plan's uncommitted sync.
// The lock is taken here and held across the pre-checks and the loop (runAll
// re-enters it per process), the plan --force-close precedent; the
// clean-tree refusals are preflight's (the advance runs only on a committed
// state — establishment deliberately does not, its G1 stop is the point).
import { join } from "node:path"
import { ensurePointer } from "./agents-block"
import { releasedRoundBriefProposal, roundBriefNearMissNote } from "./analysis"
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
  establishedLines,
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
import { wallPrecheckFindings } from "./wall"

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
  // The sealed wall's boundary check (plans/0132 D2): post-seal the closed
  // predicate re-derives at every boundary — ahead of any session, so any
  // reopen however performed (a re-created door, a hand-added covering
  // allow) surfaces as the person's finding first; the advance itself
  // finishes the interrupted retirement at the handover below. An undeclared
  // or pre-seal wall reads nothing here (the floor).
  {
    const wallLines = await wallPrecheckFindings(directory)
    if (wallLines.length) {
      for (const line of wallLines) log(line)
      return 2
    }
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
    // The mid-phase arm re-derives first (plans/0206 D3, amending 0101 D6's
    // deferral): the tail reshape's one apply is the advance's own committed
    // rewrite wherever the state stops it, so the refusal plan and run name
    // this command for is true mid-phase too — and a mid-phase run restart
    // (run's drift stop → here) keeps its exit: the re-derivation clears the
    // drift, the refusal names run, that run starts. No drift (the common
    // mid-phase transfer) writes nothing — the arm refuses byte-identically.
    const reshaped = await rederiveTail(directory, round, opts)
    if (reshaped !== undefined) return reshaped
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

// The released round brief, installed ahead of the construction (plans/0115
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
// state, not commitment. The person moves or adds the released roadmap's
// line at a review moment (the one channel since plans/0137), and this —
// the next advance — applies the
// D5 resolution to the tail ahead of the construction: syncPhaseIndex
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
  // The commit's pathspec (plans/0207 D1, 0165-013): the sync's own write
  // surface, derived from the drift it applies — the phase index plus the
  // tail directories (the removed ones' deletions and the created ones'
  // seeds must stage; the started prefix stays out by construction). The
  // person's unrelated uncommitted work stays for preflight's clean gate,
  // which owns judging it — this commit runs ahead of that gate, so the
  // pathspec is what keeps the fold honest.
  const tailPaths = [
    phaseIndexPath(round),
    ...drift.index.slice(drift.keep).map((unit) => unit.dir),
    ...drift.planned.slice(drift.keep).map((unit) => unit.dir),
  ]
  const settled = await commitTree(
    directory,
    { id: "PLAN", title: `phase tail re-derived (${roundDirName(round)})` },
    { stage: "phase-sync", subject: `PLAN resync ${roundDirName(round)} tail to ${from} (${driftPairs(drift)})` },
    tailPaths,
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
  // The round-brief proposal channel (plans/0115 D3): a released `### R-NN`
  // proposal passes the round-start gate — the person's release was the
  // review — and the advance continues into the construction in the same
  // invocation, the install landing inside it (applyReleasedBrief) on the
  // driver's own round-start commit, which sweeps this uncommitted setup: the
  // gate's person commit is replaced by the release mark. A round.md already
  // holding content, or no proposal, keeps today's gate stop.
  if (ok && (await roundBriefText(directory, round)) === undefined && (await releasedRoundBriefProposal(directory, round)) !== undefined) {
    for (const line of before) log(line)
    // The pair through the one wording home (plans/0207 D3, 0165-188): the
    // continuation composes through establishedLines exactly as the G1 stop's
    // success arm does — no second inline spelling to drift.
    for (const line of establishedLines(round, ok, `${ok.units.map(phaseLabel).join(", ")}${sourceSuffix}`)) log(line)
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
  // A released near-miss heading naming this round (plans/0158 D3): the
  // drafted-looking subsection never installs, so the gate above is what the
  // round opens on — the line names why, while the brief is still the
  // untouched stub the proposal would have filled.
  const miss = ok && (await roundBriefText(directory, round)) === undefined ? await roundBriefNearMissNote(directory, round) : undefined
  for (const line of before) log(line)
  for (const line of lines.lines) log(line)
  if (miss) log(miss)
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
