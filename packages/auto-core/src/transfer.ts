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
//      invocation's (the round-start commit sits between, as in shape 1);
//   5. open round (plans/0243 B, the current round established `open` by its
//      roadmap line): no boundary exists — pending work or an empty index
//      refuses teaching the open channels (run / --new-task), and the
//      person's filled `## Close` is the close intent: the round-close
//      checks gate it, the completion rename and the transition commit land
//      it (no distillation), and the stop is the close listing — the next
//      invocation is the ordinary shape 4.
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
import { closeAuditStopLines, ensureCloseAudit, updateAssuranceBaselines } from "./close-audit"
import { releasedRoundBriefProposal, roundBriefNearMissNote } from "./analysis"
import { ANALYSIS_DOC, roundBriefPath, roundDirName } from "./docpaths"
import { awaitingFormulation } from "./formulate"
import { constructPhaseFloor } from "./executor-steps"
import { changedFiles, commitTree } from "./git"
import { runAll } from "./loop"
import { installApprovedBrief, logGateStop } from "./loop-phase"
import type { RunAllOpts } from "./loop-preflight"
import { log } from "./log"
import { acquireRunLock, lockLines } from "./lock"
import { loadIntents, planningInputScaffold } from "./intent/load"
import { planInputPath } from "./plan-input"
import { releasedRoadmapRound, releasedRoadmapRounds } from "./roadmap"
import { closeSection, installRoundBrief, openRoundBriefUntouched, renderOpenRoundBrief, roundBriefText } from "./round-brief"
import {
  completePhase,
  currentRound,
  legacyLayoutProblem,
  phaseFlowBlockedLine,
  phaseGates,
  phaseGateProblems,
  phaseHandoverDoc,
  phaseIndexPath,
  phaseKey,
  phaseLabel,
  phaseTitle,
  readPhases,
  roundIsOpen,
  roundRoot,
  routePhase,
  type PhaseRoute,
  type PhaseUnit,
} from "./phases"
import {
  analysisGate,
  applyTailDrift,
  driftPairs,
  establishedLines,
  establishRoundSetup,
  establishStopLines,
  nothingToAdvanceLine,
  openRoundHeldLines,
  phaseRefText,
  roadmapExhaustedLines,
  roundCloseRefusalLines,
  truncateGoal,
} from "./plan"
import { roundCloseLines, roundCloseProblems } from "./round-close"
import { closeStep } from "./resume"
import { shellProfile, surfaceOf } from "./shell"
import { autoSwitches } from "./switches"
import { loadPlan, type Plan } from "./tasks"
import { validHandover } from "./document/roles"
import { wallBoundary, wallPrecheckFindings, type WallCtx } from "./wall"

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

// The deterministic advance (plans/0282, the pull-only world's transfer op):
// the same state resolution under the same lock, the advance's one session
// dispatch replaced by the apply — git and document writes only. The session
// work it declines rides the executor protocol as grants (the distillation
// as distill, the construction's re-voicing as synthesize, the planning
// session as formulate, the phase's tasks as execute/verify/fix); the person
// brackets every boundary exactly as before, their acts the document writes
// and this operation. Zero agent processes are spawned — the daemon-side
// posture 0279 rules.
export async function transferDeterministic(directory: string, opts: RunAllOpts): Promise<number> {
  const lock = acquireRunLock(directory, "transfer")
  if (!lock.ok) {
    for (const line of lockLines(directory, lock.holder)) log(line)
    return 1
  }
  try {
    return await transferAdvance(directory, opts, true)
  } finally {
    lock.release()
  }
}

async function transferAdvance(directory: string, opts: RunAllOpts, deterministic = false): Promise<number> {
  const { bin } = shellProfile()
  // m mode keeps today's shape entirely (plans/0101 D8): the single implicit
  // phase, the formulation riding run, the planning input the person's lever
  // — no boundary vocabulary applies, so transfer refuses rather than
  // pretending one.
  if ((opts.phases ?? "m") === "m") {
    const surface = surfaceOf()
    log(
      `⏸ transfer applies to phased projects: this one runs m mode (the single implicit phase), whose planning and execution keep their shapes — ` +
        `plan with ${surface.plan(directory, "-p <text> | --file <path>")}, execute with ${surface.run(directory)}`,
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
  // The open-round intercept (plans/0243 B, 0101 D2's fifth shape): an open
  // round has no phase boundary to advance — its single implicit implement
  // phase stays open, absorbing tasks, until the person closes it. Work
  // pending (or nothing listed) is run's and --new-task's; the person's
  // close intent is the filled `## Close` restatement of round.md, and the
  // close arm below lands it. The completed round (a close that already
  // landed) falls past here to the round-open shape.
  if (route.type !== "complete" && (await roundIsOpen(directory))) return await openRoundAdvance(directory, round, route, opts)
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
  if (route.type === "plan") return await (deterministic ? advanceDeterministic : advanceToReview)(directory, round, opts)
  if (route.type === "execute") {
    if (awaitingFormulation(route.plan.tasks, route.phase)) return await (deterministic ? advanceDeterministic : advanceToReview)(directory, round, opts)
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
  return await (deterministic ? advanceDeterministic : advanceToReview)(directory, round, opts)
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

// The deterministic advance's boundary walk (plans/0282): the same prefix
// as advanceToReview — the tail re-derivation, the released brief's install
// — then the boundary resolved from the documents alone, every session the
// push advance ran replaced by its protocol grant or its stop:
//   - pending tasks: the phase's work is the executor protocol's (execute
//     grants) — the honest stop naming the claim surface;
//   - an invalid or missing handover: the distillation is the distill
//     grant's — the stop names it (the landed share composing with this
//     walk's apply on the next invocation, 0277's own shape C.2);
//   - a valid handover: the apply — the resume point closed, the gates and
//     the wall read-only first, the survey's approved brief installed, the
//     completion rename, the transition commit — then the walk continues to
//     the next boundary (the next phase's floor constructed and stopped for
//     review, or the round close at the complete route).
// The construction's synthesis enhancement and the charter verifier are
// deliberately not run (the synthesize grant and the executor's verify
// share own them, 0281's rulings); the floor lands through the standing
// construction path and the stop is the person's review exactly as the
// push advance's was.
async function advanceDeterministic(directory: string, round: number, opts: RunAllOpts): Promise<number> {
  const { bin } = shellProfile()
  const stop = await rederiveTail(directory, round, opts)
  if (stop !== undefined) return stop
  await applyReleasedBrief(directory, round)
  for (;;) {
    const route = await routePhase(directory, { loadPlan, bin, phases: opts.phases ?? "m" })
    if (route.type === "blocked") {
      log(phaseFlowBlockedLine(route.reason))
      return 1
    }
    if (route.type === "complete") return await roundCloseDeterministic(directory, round, opts)
    if (route.type === "plan") {
      // An empty index (or the open-round shape's fresh index): the floor
      // construction is this invocation's product — construct and stop for
      // review, the protocol's synthesize/formulate grants the follow-ups.
      return await constructAndStopDeterministic(directory, route.phase)
    }
    if (awaitingFormulation(route.plan.tasks, route.phase)) {
      // The standing formulation unit: its todo is the review object (a
      // re-construct composes the current floor, idempotent rewrite-on-diff
      // under the digest-keep), the dispatch the protocol's formulate
      // grant's.
      return await constructAndStopDeterministic(directory, route.phase)
    }
    if (route.plan.tasks.some((task) => task.status !== "done")) {
      log(
        `⏸ the phase still holds pending work — its tasks are claimable over the executor protocol (POST /projects/<project>/executor/claim); ` +
          `the boundary advances on the next ${bin}-server transfer once the phase completes`,
      )
      return 2
    }
    // The completion boundary: the human gate first (no tokens, the person's
    // document act), then the handover, then the apply.
    const gates = phaseGates(route.phase, opts.acceptanceGate)
    if (gates.includes("human")) {
      const problems = await phaseGateProblems(directory, route.phase, ["human"])
      if (problems.length) {
        await logGateStop(directory, route.phase, problems, undefined)
        return 2
      }
    }
    const handover = phaseHandoverDoc(route.phase)
    const handoverText = await Bun.file(join(directory, handover)).text().catch(() => "")
    if (!validHandover(handoverText)) {
      log(
        `⏸ the handover distillation ${handover} is missing or incomplete — claimable distill work over the executor protocol ` +
          `(claim with kind \"distill\"); the advance completes on the next transfer once it lands`,
      )
      return 2
    }
    const applied = await applyBoundaryDeterministic(directory, opts, route.phase, gates)
    if (typeof applied === "number") return applied
    // "continue": the phase completed and committed — the walk re-routes.
  }
}

// The boundary's apply (plans/0282): the loop's own deterministic tail —
// the resume point closed, the gates and the wall read-only, the approved
// brief installed, the completion rename, the transition commit. The loop's
// session arms (the regression repair append, the verdict repair round) are
// the stops the pull-only world rules: a held gate names the receipts and
// the person's ways, never an appended session. Returns "continue" when the
// phase completed and the walk should re-route.
async function applyBoundaryDeterministic(
  directory: string,
  opts: RunAllOpts,
  phase: PhaseUnit,
  gates: ReturnType<typeof phaseGates>,
): Promise<number | "continue"> {
  const state = await readPhases(directory)
  const phases = state?.phases ?? []
  const next = phases[phases.findIndex((unit) => unit.id === phase.id) + 1]
  const target = next ? phaseTitle(next) : "flow complete"
  await closeStep(directory, "phase-handover", phaseKey(phase).id)
  const gateProblems = await phaseGateProblems(directory, phase, gates)
  if (gateProblems.length === 0) {
    // The wall ctx threads the advance's own intent (plans/0288, 0286 F1's
    // fix): the admission instrument reads the project's pack through it —
    // the loop's own site passes the run's full ctx, and the deterministic
    // apply's minimal ctx here dropped the key, so the boundary held on
    // "no instrument" on any intent-bearing project even with the op
    // threading it. The remaining optional keys (idleMs and friends) stay
    // the lane runner's own defaults, the pre-change floor.
    const wallCtx: WallCtx = { directory, git: { commitTree }, opts: { stopBefore: "formulate", intent: opts.intent } }
    const wallLines = await wallBoundary(wallCtx, phase)
    if (wallLines.length) {
      for (const line of wallLines) log(line)
      return 2
    }
  }
  if (gates.includes("human")) await installApprovedBrief({ directory, git: { commitTree } }, phase)
  const gated = await completePhase(directory, phase, gates)
  if (gated.length) {
    await logGateStop(directory, phase, gated, undefined)
    return 2
  }
  const settled = await commitTree(directory, { id: "PLAN", title: `phase handover (${phaseTitle(phase)})` }, {
    stage: "phase-transition",
    subject: `PLAN transition ${phaseTitle(phase)} → ${target}`,
  })
  if (!settled.ok) {
    log(
      `⏸ phase handover commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. ` +
        `The completion changes are kept in the worktree (the phase is already marked done); commit manually and re-run`,
    )
    return 2
  }
  return "continue"
}

// The construction-and-review stop (plans/0282): the floor todo constructed
// through the standing path, the stop the person's review — the push
// advance's own review-stop shape, the synthesis and the planning session
// named as the protocol grants they now are.
async function constructAndStopDeterministic(directory: string, phase: PhaseUnit): Promise<number> {
  const landed = await constructPhaseFloor(directory, phase)
  if (landed.type === "dirty" || landed.type === "unreadable") {
    log(`⏸ the repository state cannot host the formulation construction: ${landed.files.join(", ")}`)
    return 2
  }
  if (landed.type === "failed") {
    log(`⏸ ${landed.question}`)
    return 2
  }
  log(`✓ formulation task ${landed.id} ${landed.type === "constructed" ? "constructed" : "current"}: its todo is the review object (docs/${landed.id}/todo.md — driver-owned, fix its inputs, never the todo)`)
  log(
    "next: the construction's re-voicing is claimable synthesize work over the executor protocol (claim with kind \"synthesize\") when a charter " +
      "declares one, the planning session claimable formulate work (kind \"formulate\") — or fix the inputs and re-run the transfer to reconstruct",
  )
  return 0
}

// The round close (plans/0282): the loop's complete-route stopBefore-formulate
// arm — the close-audit construction, the round-close checks gating the stop,
// the baselines committed — the deterministic whole of it.
async function roundCloseDeterministic(directory: string, round: number, opts: RunAllOpts): Promise<number> {
  const { bin } = shellProfile()
  const audit = await ensureCloseAudit(directory, round)
  for (const line of closeAuditStopLines(audit)) log(line)
  const close = await roundCloseProblems(directory, round, { build: opts.build, scanExempt: opts.scanExempt })
  if (audit.type === "constructed") {
    const gated = await roundCloseProblems(directory, round, { build: opts.build, scanExempt: opts.scanExempt })
    if (gated.problems.length) {
      log(`⏸ round ${roundDirName(round)} does not pass its round-close checks, so it cannot close yet — fix them, commit, then re-run the transfer`)
      for (const line of roundCloseLines(gated, "transfer")) log(line)
      return 2
    }
  } else if (close.problems.length) {
    log(`⏸ round ${roundDirName(round)} does not pass its round-close checks — fix them, commit, then re-run the transfer`)
    for (const line of roundCloseLines(close, "transfer")) log(line)
    return 2
  }
  for (const line of await updateAssuranceBaselines(directory, round)) log(line)
  for (const line of roundCloseLines(close)) log(line)
  log(`next: review round ${roundDirName(round)}'s close (its round.md \`## Close\` listing), then open the next round with the transfer op`)
  return 0
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

// The open round's advance (plans/0243 B, the intercept's resolved-by-state
// body): an open round has no phase boundary — pending work or an empty
// index teaches the open channels (exit 2, nothing advanced); the person's
// filled `## Close` is the close intent, honored in every state (a close
// over pending tasks is refused naming run and `close`, never a silent
// fold; a close over an empty index is the honest withdrawal of the line).
async function openRoundAdvance(
  directory: string,
  round: number,
  route: Exclude<PhaseRoute<Plan>, { type: "complete" } | { type: "blocked" }>,
  opts: RunAllOpts,
): Promise<number> {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  const pending = route.type === "execute" ? route.plan.tasks.filter((task) => task.status !== "done").length : 0
  // The close intent: the filled `## Close` restatement — the same section
  // the round-close gate reads below (the seed's hint comments strip to
  // nothing, so an untouched close is not intent).
  const brief = await Bun.file(join(directory, roundBriefPath(round))).text().catch(() => undefined)
  const closing = brief !== undefined && (closeSection(brief) ?? "") !== ""
  if (route.type === "execute") {
    if (closing) {
      log(
        `⏸ open round ${roundDirName(round)} still holds ${pending} pending task(s) and does not close on them: ` +
          `execute them with: ${surface.run(directory)} — or close the ones that will not run (${bin} close <ref> ${directory} --reason <text>), then re-run: ${surface.transfer(directory)}`,
      )
      return 2
    }
    for (const line of await openRoundHeldLines(directory, pending)) log(line)
    return 2
  }
  if (route.type === "plan" && !closing) {
    for (const line of await openRoundHeldLines(directory, 0)) log(line)
    return 2
  }
  return await openRoundClose(directory, round, route.phase, opts)
}

// The open round's close arm (plans/0243 B, its D4 amendment by plans/0244):
// the round-close checks gate the close (the build, the restatement listing,
// the assurance cover set beside them); their refusal is the person's
// fix — nothing closed yet. A non-empty close-due set without receipts
// constructs the close-audit unit BEFORE the close may land (plans/0244 D5),
// so the refusal that follows teaches its execution. Then the completion
// rename and the transition commit land the close, and the stop is the close
// listing — the same review moment a phased round's close is. No handover
// distills (the open round's phases never distill; its record is the task
// documents, the brief and the commits), and the commit's pathspec is the
// close's own write surface — the index tick and the phase directory
// (plans/0207 D1's discipline) — so the person's unrelated dirt stays for
// the clean gate that owns judging it. The green cover set's baseline
// citations (plans/0244 D5: the table stays the single memory) land on their
// own commit ahead of the transition, every kill point re-derivable.
async function openRoundClose(directory: string, round: number, phase: PhaseUnit, opts: RunAllOpts): Promise<number> {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  for (const line of closeAuditStopLines(await ensureCloseAudit(directory, round))) log(line)
  const close = await roundCloseProblems(directory, round, { build: opts.build, scanExempt: opts.scanExempt })
  if (close.problems.length) {
    log(`⏸ round ${roundDirName(round)} does not pass its round-close checks, so the open round cannot close yet — nothing was closed`)
    for (const line of roundCloseLines(close, "transfer")) log(line)
    log(`next: fix them, commit, then re-run: ${surface.transfer(directory)}`)
    return 2
  }
  // Green cover set ⇒ the table's memory updates before the close proceeds
  // (plans/0244 D5): each adjudicated row's baseline cell cited to its
  // findings document's introducing commit, the update's own pathspec
  // commit — idempotent, so every kill point below re-derives.
  for (const line of await updateAssuranceBaselines(directory, round)) log(line)
  // The phase's own gates (an acceptanceGate config covering implement is
  // honored): read-only ahead of the rename, like the handover path's
  // pre-check; completePhase's own re-check is the choke point either way.
  const gates = phaseGates(phase, opts.acceptanceGate)
  const problems = gates.length ? await phaseGateProblems(directory, phase, gates) : []
  if (problems.length) {
    await logGateStop(directory, phase, problems, undefined)
    return 2
  }
  const gated = await completePhase(directory, phase, gates)
  if (gated.length) {
    await logGateStop(directory, phase, gated, undefined)
    return 2
  }
  const settled = await commitTree(
    directory,
    { id: "PLAN", title: `round close (${roundDirName(round)})` },
    { stage: "phase-transition", subject: `PLAN close ${roundDirName(round)} (${phaseTitle(phase)}, open round)` },
    [phaseIndexPath(round), phase.dir],
  )
  if (!settled.ok) {
    log(
      `⏸ the open round's close commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. ` +
        `The completion changes are kept in the worktree (the phase is already marked done); commit manually and re-run`,
    )
    return 2
  }
  for (const line of roundCloseLines(close)) log(line)
  log(`✓ open round ${roundDirName(round)} closed`)
  log(`next: open the next round with: ${surface.transfer(directory)}`)
  return 0
}

// An open round's interrupted close (plans/0243 B): the completion rename
// landed, its transition commit did not — the driver's own leftover, settled
// here on the close's own pathspec exactly like the clean gate's
// driver-state self-heal, so every kill point of the open close re-derives
// (the round-close checks below then run over a committed tree).
async function settleOpenClose(directory: string, round: number): Promise<void> {
  const state = await readPhases(directory, round).catch(() => undefined)
  if (!state?.open || !state.phases.every((unit) => state.done.has(unit.id))) return
  const surface = [phaseIndexPath(round), ...state.phases.map((unit) => unit.dir)]
  const norm = (file: string) => file.replaceAll("\\", "/")
  const dirt = (await changedFiles(directory)).filter((file) => surface.some((path) => norm(file) === path || norm(file).startsWith(`${path}/`)))
  if (!dirt.length) return
  const settled = await commitTree(
    directory,
    { id: "PLAN", title: `round close (${roundDirName(round)})` },
    { stage: "phase-transition", subject: `PLAN close ${roundDirName(round)} (open round — interrupted close settled)` },
    surface,
  )
  if (settled.ok) log(`✓ the interrupted close of open round ${roundDirName(round)} settled on its own commit (the completion rename had landed without its commit)`)
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
// An open round (plans/0243 B) stops on its own rhythm: the brief is
// pre-seeded from the roadmap line's goal (the review edits or accepts it),
// a released proposal installs over the seed at the establishment itself
// (the m-mode precedent — no construction exists for the advance's seam to
// carry the install), and the next step is the open channels, never a
// construction.
async function establishStop(directory: string, round: number, opts: RunAllOpts, before: string[]): Promise<number> {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  const setup = await establishRoundSetup(directory, round, { phases: opts.phases!, isolate: opts.isolate, testByDriver: opts.testByDriver })
  const ok = setup.type === "ok" ? setup : undefined
  const name = roundDirName(round)
  // An open round's establishment carries the seed's goal (the resolved
  // line's).
  const openGoal = ok?.resolved.kind === "open" && ok.resolved.roadmap ? ok.resolved.roadmap.goal : undefined
  // The D5 sourced suffix (plans/0101 D5): a roadmap-established round names
  // the line that ruled, beside the config default it displaced. An open
  // line names its kind — the phases it establishes are the kind's
  // definition, not an ordinary phases value.
  const sourceSuffix = ok?.resolved.roadmap
    ? openGoal !== undefined
      ? ` — open round from the roadmap of ${ANALYSIS_DOC} (${name} line "${truncateGoal(openGoal)}"; the kind establishes its single implement phase; config default was "${opts.phases}")`
      : ` — phases from the roadmap of ${ANALYSIS_DOC} (${name} line "${truncateGoal(ok.resolved.roadmap.goal)}"; config default was "${opts.phases}")`
    : ""
  // The round-brief proposal channel (plans/0115 D3): a released `### R-NN`
  // proposal passes the round-start gate — the person's release was the
  // review. For a phased round the advance continues into the construction
  // in the same invocation, the install landing inside it
  // (applyReleasedBrief) on the driver's own round-start commit, which
  // sweeps this uncommitted setup: the gate's person commit is replaced by
  // the release mark. For an open round the proposal beats the seed and
  // installs here (no construction exists to carry it), the stop teaching
  // the open channels. A round.md already holding content, or no proposal,
  // keeps today's gate stop.
  const proposal = ok ? await releasedRoundBriefProposal(directory, round) : undefined
  const seedUntouched = ok && openGoal !== undefined ? await openRoundBriefUntouched(directory, round, openGoal) : false
  if (ok && proposal !== undefined && ((await roundBriefText(directory, round)) === undefined || seedUntouched)) {
    for (const line of before) log(line)
    // The pair through the one wording home (plans/0207 D3, 0165-188): the
    // continuation composes through establishedLines exactly as the G1 stop's
    // success arm does — no second inline spelling to drift.
    for (const line of establishedLines(round, ok, `${ok.units.map(phaseLabel).join(", ")}${sourceSuffix}`)) log(line)
    if (openGoal !== undefined) {
      // The open round's proposal install (plans/0243 B): here at the
      // establishment, plan's m-mode arm the precedent — the round-start
      // commit sweeps this uncommitted setup, and the seed rendering rides
      // along so the never-clobber guard reads the pre-seeded file as the
      // driver's own untouched write, not the person's content.
      const done = await installRoundBrief(directory, round, ANALYSIS_DOC, proposal, commitTree, { seed: renderOpenRoundBrief(round, openGoal) })
      for (const line of done.lines) log(line)
      log(
        `ℹ the released \`${roundDirName(round)}\` round-brief proposal of ${ANALYSIS_DOC} installs verbatim over the seed — the round-start gate passes (your release was its review); ` +
          `revise the brief in place any time, every planning session reads the current file`,
      )
      log(
        `next: the round is open — add tasks with: ${surface.tasks(directory, "--new-task \"<title>\"")} (one at a time), ` +
          `execute them with: ${surface.run(directory)}; close the round by filling the ## Close of ${roundBriefPath(round)}, committing, and re-running: ${surface.transfer(directory)}`,
      )
      return 0
    }
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
      ? openGoal !== undefined
        ? `next (round-start gate): review the round setup and the pre-seeded ${roundBriefPath(round)} (its ## Goal carries the roadmap line's goal — revise or accept it), and commit it; ` +
          `then add tasks with: ${surface.tasks(directory, "--new-task \"<title>\"")} (one at a time), execute them with: ${surface.run(directory)} — ` +
          `the round stays open until you fill its ## Close and re-run: ${surface.transfer(directory)}`
        : `next (round-start gate): review the round setup, fill in ${roundBriefPath(round)} (goal, acceptance and release criteria), and commit it; ` +
          `then run: ${surface.transfer(directory)} — it constructs ${phaseRefText(ok.units[0]!)}'s plan task and stops for your review (the formulate grant dispatches it, execute grants run the phase)`
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
  // An open round's interrupted close settles first (plans/0243 B): the
  // checks below read a committed state.
  await settleOpenClose(directory, round)
  const close = await roundCloseProblems(directory, round, { build: opts.build, scanExempt: opts.scanExempt })
  if (close.problems.length) {
    for (const line of roundCloseRefusalLines(directory, round, round + 1, close, "transfer")) log(line)
    return 2
  }
  // The green cover set's baseline citations (plans/0244 D5) — the close
  // arms' own update, fired here too so a kill between a close and its
  // citation re-derives (idempotent: cited cells write nothing).
  for (const line of await updateAssuranceBaselines(directory, round)) log(line)
  const roadmap = await releasedRoadmapRounds(directory)
  if (roadmap !== undefined && !roadmap.some((entry) => entry.round === round + 1)) {
    for (const line of roadmapExhaustedLines(directory, round)) log(line)
    return 0
  }
  return establishStop(directory, round + 1, opts, roundCloseLines(close))
}
