// The plan command's core (plans/0053 D4–D8, D15, D23, D26, D34; the
// no-session task add lives in src/task-add.ts, plans/0058): the prelude
// that decides every route needing no AI before an agent starts, and the
// lines plan prints where it stops. The prelude runs under the run lock the
// shell holds, before runAll, so it works on the dirty tree a fresh round
// setup leaves and starts no server just to print a notice; it must never
// import the loop. The loop (loop-phase, loop-plan) prints the same stop
// lines through the helpers here, so plan says the same thing wherever it
// stops.
// Since plans/0101 D4 plan is the dispatch half of the person-bracketed
// boundary: bare plan runs the awaiting, reviewed formulation task (one
// session chain, stop on completion), and every phased state that is not
// that dispatch — the project start, the round advance, an unplanned phase,
// a boundary — refuses naming transfer, the single advance command.
//
// Pointer texts name the lifecycle commands that exist (plans/0053 D29).
import { join } from "node:path"
import { mkdir } from "node:fs/promises"
import { ensurePointer } from "./agents-block"
import { ACCEPTED_MARK } from "./document/roles"
import { analysisProblems, renderAnalysisStub, releasedRoundBriefProposal, resolveRoundPhases, roundBriefNearMissNote, type RoundPhasesResolution } from "./analysis"
import { releasedRoadmapRound } from "./roadmap"
import { briefProposal, BRIEF_FILE, installBriefProposal, projectBriefText } from "./brief"
import { ANALYSIS_DOC, roundBriefPath, roundDirName } from "./docpaths"
import { dirtyStopLines, log } from "./log"
import type { ModeSpec } from "./mode"
import { loadIntents } from "./intent/load"
import { planningInputScaffold } from "./intent/load"
import {
  clarifiedMark,
  CLARIFIED_MARK,
  currentPhase,
  currentRound,
  establishRound,
  legacyLayoutProblem,
  phaseFlowBlockedLine,
  phaseHandoverDoc,
  phaseIndexPath,
  phaseKey,
  phaseLabel,
  phaseSurveyDoc,
  phaseTailDrift,
  phaseTitle,
  readPhases,
  roundRoot,
  routePhase,
  surveyForks,
  syncPhaseIndex,
  type PhaseRoute,
  type PhaseState,
  type PhaseTailDrift,
  type PhaseUnit,
} from "./phases"
import { loadPhaseTypes } from "./phases/custom"
import { phasesProblem, resolvePhases } from "./phases/registry"
import { readPlanInput, planInputPath, type PlanInput } from "./plan-input"
import { awaitingFormulation } from "./formulate"
import { commitTree } from "./git"
import { isolateRound } from "./git-land"
import { installRoundBrief, renderRoundBrief, roundBriefText } from "./round-brief"
import { roundCloseLines, roundCloseProblems, type RoundClose } from "./round-close"
import { openStep, peekProgress } from "./resume"
import { shellProfile, surfaceOf } from "./shell"
import { autoSwitches } from "./switches"
import { executeBlockageChoices, executionLines } from "./blockage-execute"
import { addTask } from "./task-add"
import { loadPlan, qualifiedPhase, taskIndexPath, taskStatePaths, type Plan, type Task } from "./tasks"
import { adoptUnit, unitNotReady, workOrder } from "./work-order"

type PlanStop = { type: "stop"; code: number; lines: string[] }
type PlanPrelude = { type: "loop" } | PlanStop

// The routes the prelude decides, first match wins (plans/0053 D4; since
// plans/0101 D4 bare plan is the dispatch half of the person-bracketed
// boundary — transfer constructs the plan task and stops for review, plan
// dispatches the reviewed todo, so the phased establishment and
// round-advance rows refuse naming transfer):
//   0. phased, no established round (the analysis flow, the establishment,
//      the interrupted start, the switch off) → refuse exit 1 naming
//      transfer — the project start is transfer's shape 1 (plans/0101 D4);
//      m mode keeps the 0084 rows below it: 0a the analysis stub + the
//      AGENTS.md guidance; 0b grammar problems hold the release; 0c an
//      unreleased analysis awaits the person's `Clarified: yes`; 0d a
//      released one installs the approved brief proposal and establishes
//      R-01 (row 1's establish) — the released roadmap's line for the round
//      is its phase list (plans/0101 D5), named in the stop;
//   1. m mode, the current round is not established → (G8 of the previous
//      round) + establish, G1 lines;
//   2. the round is complete → phased: refuse exit 1 naming transfer (the
//      round close and the next opening are transfer's shapes 3/4); m mode
//      never reaches here (its single phase stays open);
//   3. the round's phase index drifted from the phases value → phased:
//      refuse exit 1 before any write naming transfer as the reshape's
//      apply (plans/0206 D2); m mode keeps the D34 uncommitted re-sync
//      (unreachable — its tail is the single phase);
//   4. the route is blocked → exit 1;
//   5. an open step record → the loop finishes it first;
//  14. --round → the assisted round-brief preparation stop: the AGENTS.md
//      round guidance (and the m-mode stub establishment never wrote);
//  15. --phase → the assisted planning-input preparation stop for the next
//      phase to plan: the AGENTS.md phase guidance with the pack's scaffold;
//   6. phased, plan or handover without --append → refuse exit 1 naming
//      transfer (nothing is constructed, or the phase is at its boundary);
//      an input's home is the phase's plan-input.md;
//   7. phased, execute without --append → an awaiting formulation task of
//      the phase the route names dispatches (the loop); the input must equal
//      the persisted plan-input.md (an input that changes what the todo
//      rendered refuses naming the transfer re-run, plans/0101 D4), and the
//      round brief must be filled (the untouched stub refuses exit 2 naming
//      the fill, plans/0101 D3); otherwise exit 1 naming run and transfer;
//   8. m mode, empty task index → input: the loop; else a notice;
//   9. m mode, tasks listed → input: the loop (an append, D23; --append implied, the flag redundant); else a notice;
//  10. phased, --append on execute or handover → the loop (an append to the phase the route names now, D23).
//  11. --new-task <title> → add one task the person names, with no session,
//      to the phase the route names now (task-add, the mechanical half of
//      append planning) and stop for review.
//  12. --export <T-NNN> → render the ready unit's standalone work order
//      (constitution preamble + the whole-task session's prompt under the
//      attended flag, src/work-order.ts) and stop, the order on stdout
//      (plans/0076 ruling 1: nothing persisted to go stale).
//  13. --adopt <T-NNN> → run the driver half for the externally-driven unit:
//      validation → test handover → ticks/rename → the unified commit
//      (src/work-order.ts adoptUnit), then stop for review. Any ready unit
//      may be taken (ruling 4), and adopt re-checks readiness — the export
//      may have aged.
// Input is refused before any write on the round-setup rows (D5, rows 1–3);
// rows 9–11 apply the progress-record guard (D26); --append without input
// is a usage error everywhere; row 11 refuses while a step is open (its
// snapshot and resume machinery must not be bypassed); rows 12–13 refuse the
// planning input and an open step alike (the step machinery owns the phase's
// index; a work order renders or closes one unit, a session never plans
// from the input under these flags); rows 14–15 share that open-step refusal
// and take no other route option (plans/0084).
export async function planPrelude(dir: string, opts: {
  phases: string
  build?: string
  scanExempt?: string[]
  isolate?: string[]
  input?: PlanInput
  append?: boolean
  newTask?: string
  autoNumber?: boolean
  // Rows 12–13 (plans/0076, T-137): the standalone work-order routes. The
  // render inputs are the config's own (mode, the test protocol's switches)
  // plus the script watchdog adopt's test handover runs under; the export
  // and the adopt are mutually exclusive (the shell checks; one route runs).
  export?: string
  adopt?: string
  // The assisted-preparation routes (plans/0084): --round points the AGENTS.md
  // guidance at the round brief of the round at hand, --phase at the planning
  // input of the next phase to plan. Mutually exclusive with each other and
  // with every other route option; the shell checks before the lock, the
  // backstops below catch other shells and direct callers.
  round?: boolean
  phase?: boolean
  // The active intent pack's name (the config's `intent` key), for --phase's
  // scaffold lookup — the prelude is config-blind by design, the shell passes
  // the one key the route needs.
  intent?: string
  mode?: ModeSpec
  testByDriver?: boolean
  handoverTest?: boolean
  idleMs?: number
  maxMs?: number
}): Promise<PlanPrelude> {
  const legacy = await legacyLayoutProblem(dir)
  if (legacy) return stop(1, [legacy])
  const { bin } = shellProfile()
  const surface = surfaceOf()
  const manual = opts.phases === "m"
  // --append without input is a usage error (D23): appending adds the tasks
  // planned from the input. The shell checks this before the lock; this
  // backstops other shells and direct callers, before any route logic.
  // --new-task (the no-session add): the shell checks the shape and the
  // mutual exclusions before the lock; this backstops other shells and
  // direct callers, before any route logic — including the append backstop,
  // so a direct --new-task --append call hears the exclusion, not the
  // append's missing-input line.
  if (opts.newTask !== undefined) {
    if (!opts.newTask.trim() || opts.newTask.includes("\n")) {
      return stop(1, [`--new-task requires a one-line task title (it becomes the index line and the task document's title); longer context goes into docs/T-NNN/todo.md after the add`])
    }
    if (opts.input || opts.append) {
      return stop(1, [
        `--new-task adds the task you name with no session; it takes no planning input and no --append — ` +
          `pass only the title (${surface.plan(dir, "--new-task \"<title>\"")}), or plan from an input instead (${surface.plan(dir, "--append -p <text> | --file <path>")})`,
      ])
    }
  }
  if (opts.append && !opts.input) {
    return stop(1, [
      `--append requires a planning input: pass one with ${surface.plan(dir, "-p <text> | --file <path>")} — appending adds the tasks planned from the input to the current phase`,
    ])
  }
  // The work-order routes (rows 12–13, plans/0076): the shell checks the
  // reference's shape and the mutual exclusions before the lock; this
  // backstops other shells and direct callers, before any route logic —
  // one route runs, and neither plans from an input nor adds a task.
  if (opts.export !== undefined && opts.adopt !== undefined) {
    return stop(1, [
      `--export and --adopt are mutually exclusive: --export renders a ready unit's work order for a standalone session, --adopt closes one out — run them one at a time (${surface.plan(dir, "--export <task id>")}, then --adopt <task id> after the session)`,
    ])
  }
  if ((opts.export !== undefined || opts.adopt !== undefined) && (opts.input || opts.append || opts.newTask !== undefined)) {
    return stop(1, [
      `--export / --adopt take only a task id: no planning input (a session never plans under them), no --append, no --new-task — pass the flag alone (${surface.plan(dir, "--export <task id> | --adopt <task id>")})`,
    ])
  }
  // The assisted-preparation backstop (plans/0084): --round and --phase are
  // mutually exclusive and take no other route option. The shell checks this
  // before the lock; this catches other shells and direct callers, before any
  // route logic — the work-order backstop's pattern.
  if (opts.round && opts.phase) {
    return stop(1, [
      `--round and --phase are mutually exclusive: --round prepares the round brief of the round at hand, --phase the planning input of the next phase to plan — run them one at a time (${surface.plan(dir, "--round | --phase")})`,
    ])
  }
  if ((opts.round || opts.phase) && (opts.input || opts.append || opts.newTask !== undefined || opts.export !== undefined || opts.adopt !== undefined)) {
    return stop(1, [
      `--round / --phase take no other option: no planning input, no --append, no --new-task, no --export / --adopt — pass the flag alone (${surface.plan(dir, "--round | --phase")})`,
    ])
  }
  const round = await currentRound(dir)
  // The switch's parse error is a usage stop here, the prelude being the
  // first switch reader on the plan path.
  let analysisOn: boolean
  try {
    analysisOn = autoSwitches().analysis
  } catch (error) {
    return stop(1, [error instanceof Error ? error.message : String(error)])
  }
  // plans/0101 D4 — bare plan is the dispatch half of the boundary: every
  // phased not-established state (the pre-round analysis of rows 0a–0d, the
  // round establishment of row 1, the interrupted round start, the analysis
  // switch off) is transfer's shape 1, and the round's opening after a
  // complete one (row 2) is transfer's shapes 3/4 — plan refuses naming
  // transfer, whatever route option rode along (the flag-specific refusals
  // of the old rows die with them: one line, one command). m mode keeps
  // today's rows below in full (D8 — no boundary vocabulary applies, and
  // transfer itself refuses m mode).
  if (!manual && !(await Bun.file(join(dir, phaseIndexPath(round))).exists())) {
    return stop(1, [transferStartLine(dir)])
  }
  // Rows 0a–0d (plans/0084), m mode only since plans/0101 D4: the pre-round
  // project analysis — the assisted first-run step that fixes the
  // engagement's goals before any round exists. Practice ruled the first
  // analysis determines the key work of the rounds that follow, so it runs
  // before R-01 opens and its roadmap decides the phases value each round
  // should be established under (the config stays constitutional — the
  // driver only advises the exact amend command).
  if (analysisOn && round === 1 && !(await roundRoot(dir, 1))) {
    // The row-1 refusals' shape (D5: input is refused before any write) on
    // the analysis rows: the flags name no round yet, so each refusal points
    // at the analysis instead of an establishment.
    if (opts.input) {
      return stop(1, [
        `no round exists yet: the project analysis comes first — run ${surface.plan(dir)} without input, work with your agent on ${ANALYSIS_DOC} (the guidance is in AGENTS.md), release it with \`${CLARIFIED_MARK}\` and commit; round R-01 opens on the re-run and takes the input`,
      ])
    }
    if (opts.newTask !== undefined) {
      return stop(1, [
        `no round exists yet: the project analysis comes first — run ${surface.plan(dir)} without --new-task; round R-01 opens on its release, and the task lands in it`,
      ])
    }
    if (opts.export !== undefined || opts.adopt !== undefined) {
      return stop(1, [
        `no round exists yet: the project analysis comes first — run ${surface.plan(dir)} without --export / --adopt; round R-01 opens on its release, and the work order lands in it`,
      ])
    }
    if (opts.phase) {
      return stop(1, [
        `no phase exists yet: the project analysis comes first — run ${surface.plan(dir)}, work with your agent on ${ANALYSIS_DOC} (the guidance is in AGENTS.md), release it with \`${CLARIFIED_MARK}\`, and round R-01 opens`,
      ])
    }
    // The walkthrough itself is shared with transfer's projectStart
    // (analysisGate): the command token and the manual flag are the only
    // differences between the two callers.
    const gate = await analysisGate(dir, "plan", { testByDriver: opts.testByDriver, manual })
    if (gate.type === "stop") return stop(gate.code, gate.lines)
    // Row 0d, the release: the approved brief proposal is installed (the
    // survey release's mechanism, D15.2 generalized), then R-01 establishes
    // like row 1 — the released roadmap's line for the round is its phase
    // list, applied and named in establish's stop (plans/0101 D5; the
    // round-start commit remains the person's veto).
    return establish(dir, 1, opts, gate.lines)
  }
  // Row 1: no docs/R-NN/, or its phase index is missing (an interrupted
  // round start, plans/0049 G6). m mode only since plans/0101 D4 — the
  // phased states refused as transfer's above.
  if (!(await Bun.file(join(dir, phaseIndexPath(round))).exists())) {
    if (opts.input) {
      return stop(1, [
        `round ${roundDirName(round)} is not established yet: run ${surface.plan(dir)} without input to establish it, commit the setup, then pass the input.`,
      ])
    }
    if (opts.newTask !== undefined) {
      return stop(1, [
        `round ${roundDirName(round)} is not established yet: run ${surface.plan(dir)} without --new-task to establish it, commit the setup, then add the task again.`,
      ])
    }
    if (opts.export !== undefined || opts.adopt !== undefined) {
      return stop(1, [
        `round ${roundDirName(round)} is not established yet: run ${surface.plan(dir)} without --export / --adopt to establish it, commit the setup, then take the work order again.`,
      ])
    }
    const lines: string[] = []
    if (round > 1) {
      const previous = await previousRoundClose(dir, round - 1, opts)
      if (previous.type === "stop") return previous
      lines.push(...previous.lines)
    }
    lines.push(...(await planningNotices(dir, undefined, opts.input, analysisOn)))
    return establish(dir, round, opts, lines)
  }
  const route = await routePhase(dir, { loadPlan, bin, phases: opts.phases ?? "m" })
  // Row 2 (plans/0101 D4): a phased complete round is transfer's — the round
  // close (shape 3) and the next round's opening (shape 4) refuse here naming
  // the advance command. m mode never gets past this guard's else (its single
  // phase stays open), the establishment body below its dead m-mode path,
  // kept for it alone.
  if (route.type === "complete") {
    if (!manual) {
      return stop(1, [
        `round ${roundDirName(round)} is complete and no plan task awaits dispatch: the round close and the next round's opening are transfer's; run: ${surface.transfer(dir)}`,
      ])
    }
    const next = roundDirName(round + 1)
    if (opts.input) {
      return stop(1, [
        `round ${roundDirName(round)} is complete and round ${next} is not established yet: ` +
          `run ${surface.plan(dir)} without input to establish it, commit the setup, then pass the input.`,
      ])
    }
    if (opts.newTask !== undefined) {
      return stop(1, [
        `round ${roundDirName(round)} is complete and round ${next} is not established yet: ` +
          `run ${surface.plan(dir)} without --new-task to establish it, commit the setup, then add the task again.`,
      ])
    }
    if (opts.export !== undefined || opts.adopt !== undefined) {
      return stop(1, [
        `round ${roundDirName(round)} is complete and round ${next} is not established yet: ` +
          `run ${surface.plan(dir)} without --export / --adopt to establish it, commit the setup, then take the work order again.`,
      ])
    }
    const close = await roundCloseProblems(dir, round, { build: opts.build, scanExempt: opts.scanExempt })
    if (close.problems.length) return stop(2, closeRefusal(dir, round, close))
    return establish(dir, round + 1, opts, roundCloseLines(close))
  }
  // The remediation executor row (plans/0082 §5 D7): after round
  // establishment and immediately before the drift re-sync row — D5's
  // rows 1–3 keep their no-write order, and this row's edits are its first
  // write. It finds the round's unexecuted `Choice:` marks and executes
  // them mechanically (one Auto-Stage: remediation commit per edit,
  // old-span literal match, the planning-input channel through its own
  // commit); the blocked step then re-composes and re-verifies from scratch
  // as the loop below runs it. A refusal that needs the person or a clean
  // tree stops with the partial state named; a stale-span rejection is
  // recorded on its document and the run continues — the step's gate fails
  // again and re-diagnoses into a fresh, executable document, so a Choice
  // never dead-ends.
  {
    const executed = await executeBlockageChoices(dir, round)
    if (executed.type === "reblocked" && !executed.stale) return stop(2, [`⏸ remediation re-blocked: ${executed.reason}`, `next: resolve what it names, then re-run: ${surface.plan(dir)}`])
    for (const line of executionLines(executed)) log(line)
  }
  // Row 3 (plans/0053 D34; the phased arm re-ruled by plans/0206 D2): the
  // phase index drifted from the phases value in force — config `phases`
  // changed after the round was established, or (since plans/0101 D5) the
  // released roadmap's line for this round moved. 0101 D4 made every phased
  // state that is not the dispatch transfer's and D6 gave the reshape one
  // apply — the advance's committed re-derivation — so the phased arm refuses
  // before any write, naming transfer as the apply (the bare re-sync was the
  // pre-0101 residue: a second writer whose uncommitted phases.md the
  // advance's own preflight then stopped on, teaching a re-run that refused
  // naming transfer). m mode keeps the D34 shape — syncPhaseIndex replaces
  // the unstarted tail, the change stays uncommitted like any round setup,
  // and the stop asks for the review — unreachable today (phaseTailDrift
  // never reports an m-mode tail, the single phase), kept for that mode's
  // own rhythm alone. The comparison value is the D5 resolution (the
  // roadmap's line over config), so a roadmap-established round is never
  // drift against config, and only a move of the ruling document reshapes
  // the tail. Input is refused before the write (plans/0053 D5): the input
  // would plan into a tail nobody has reviewed yet. A value the sync refuses
  // (dropping a completed phase, a directory that holds work) surfaces as
  // the error plannedPhaseUnits throws — the same guard the advance's
  // re-derivation meets.
  // The resolve → drift → sync sequence is shared with transfer's
  // rederiveTail (applyTailDrift); plan's D5 flag refusals ride the hook so
  // input is still refused before any write, and the uncommitted review stop
  // below stays plan's own (the m-mode arm alone).
  const driftAction = opts.input
    ? "pass the input"
    : opts.newTask !== undefined
      ? "add the task again"
      : opts.export !== undefined || opts.adopt !== undefined
        ? "take the work order again"
        : undefined
  const applied = await applyTailDrift(
    dir,
    round,
    opts.phases,
    (drift, from) =>
      manual
        ? opts.input
          ? driftRefusal(dir, drift, from, "input", "pass the input")
          : opts.newTask !== undefined
            ? driftRefusal(dir, drift, from, "--new-task", "add the task again")
            : opts.export !== undefined || opts.adopt !== undefined
              ? driftRefusal(dir, drift, from, "--export / --adopt", "take the work order again")
              : undefined
        : transferDriftRefusal(dir, drift, from, driftAction),
  )
  if (applied.type === "blocked") return stop(1, [phaseFlowBlockedLine(applied.reason)])
  if (applied.type === "refused") return stop(1, [applied.line])
  if (applied.type === "sync-failed") return stop(1, [`phase-index re-sync failed: ${applied.error}`])
  if (applied.type === "applied") return stop(0, [resyncLine(dir, applied.drift, applied.from)])
  // Row 4.
  if (route.type === "blocked") return stop(1, [phaseFlowBlockedLine(route.reason)])
  // The advisory notices (plans/0081 D11.3/D12.3): the plan route is where a
  // planning session is imminent — m mode's row 8 included (route.type is
  // "plan" there too). Phased refuses the route below (plans/0101 D4), so the
  // notices are m mode's alone there — a refusal line needs no advisories
  // ahead of it.
  if (manual && route.type === "plan") for (const line of await planningNotices(dir, route.phase, opts.input, analysisOn)) log(line)
  // Row 5: the interrupted step is finished first (plans/0018 precedence);
  // the loop decides whether the record still matches the route. A hand-add
  // must not run under an open step: its snapshot and resume machinery
  // assume they own the phase's index, so --new-task waits until the step is
  // closed out.
  if (opts.newTask !== undefined) {
    const open = await openStep(dir)
    if (open) return stop(1, [openStepRefusal(dir, open, "add the task with --new-task")])
  }
  // Rows 12–13's open-step refusal: the same reasoning as --new-task's —
  // the step's snapshot and resume machinery own the phase's index until it
  // closes, and a work order rendered or adopted under them would bypass
  // both (returning the loop here would silently ignore the flag).
  if (opts.export !== undefined || opts.adopt !== undefined) {
    const open = await openStep(dir)
    if (open) return stop(1, [openStepRefusal(dir, open, "export or adopt the unit")])
  }
  // The assisted-preparation flags' open-step refusal (plans/0084), the same
  // reasoning as --new-task's: returning the loop here would silently ignore
  // the flag, so the person hears the step first.
  if (opts.round || opts.phase) {
    const open = await openStep(dir)
    if (open) return stop(1, [openStepRefusal(dir, open, "run the preparation flag again")])
  }
  if (await openStep(dir)) return { type: "loop" }
  // Row 14 (--round, plans/0084): the assisted round-brief preparation stop.
  // The route reaching here means the round is established and not complete:
  // point the AGENTS.md guidance at its brief — writing the m-mode stub
  // establishment never wrote (round-close requires the file eventually) —
  // and stop. No session runs; the person and their agent fill the document,
  // the round-start gate (or their own review) checks it, and planning
  // proceeds on the next plan.
  if (opts.round) {
    const brief = join(dir, roundBriefPath(round))
    if (!(await Bun.file(brief).exists())) await Bun.write(brief, renderRoundBrief(round))
    const filled = (await roundBriefText(dir, round)) !== undefined
    await ensurePointer(dir, { testByDriver: opts.testByDriver, guidance: { kind: "round", round: roundDirName(round), manual } })
    // The continue pointer follows the boundary grammar (plans/0101 D4):
    // phased continues with transfer (the construct reads the filled brief
    // and stops for review), m mode with plan as before.
    const next = manual ? `${surface.plan(dir)}` : `${surface.transfer(dir)}`
    return stop(0, [
      filled
        ? `ℹ the round brief ${roundBriefPath(round)} is filled; revise it with your agent if the round's goals moved (this state's guidance is in AGENTS.md), then continue: ${next}`
        : `ℹ the round brief ${roundBriefPath(round)} is the stub: work with your agent on its goal, acceptance and release criteria (this state's guidance is in AGENTS.md), review and commit, then continue: ${next}` +
          (manual ? "" : ` — or draft it as a \`### ${roundDirName(round)}\` proposal under \`## Round briefs\` of ${ANALYSIS_DOC} and commit: the next transfer installs it verbatim`),
    ])
  }
  // Row 15 (--phase, plans/0084): the assisted planning-input preparation
  // stop. The target is the phase an input would be planned into (row 6's
  // planTarget selection, the listed refusal mirroring row 6's); the stop
  // points the AGENTS.md guidance at that phase's plan-input.md with the
  // pack's scaffold. The person and their agent write the file directly —
  // the next plan's planning session consumes it as written (readPlanInput's
  // re-entry), no new persistence channel.
  if (opts.phase) {
    if (route.type !== "plan" && route.type !== "handover") {
      // m mode's execute route and a phased execute route reach the same
      // refusal with their own pointer.
      return stop(1, [
        manual
          ? `the single phase already lists tasks; --phase prepares a planning input for a phase with none — ` +
            `add tasks with ${surface.plan(dir, "--append -p <text> | --file <path>")}, or list them by hand in ${taskIndexPath(route.phase)}`
          : `${phaseRefText(route.phase)} is past planning; --phase prepares the planning input of a phase still to plan — ` +
            `add tasks to a planned phase with ${surface.plan(dir, "--append -p <text> | --file <path>")}`,
      ])
    }
    let target: { phase: PhaseUnit; listed: boolean } | undefined
    try {
      target = manual ? { phase: route.phase, listed: false } : await planTarget(dir, route)
    } catch (error) {
      return stop(1, [phaseFlowBlockedLine(error instanceof Error ? error.message : String(error))])
    }
    if (!target) return stop(1, [`no phase is left to plan in round ${roundDirName(round)}; --phase would prepare nothing`])
    if (target.listed) {
      return stop(1, [
        `${phaseRefText(target.phase)}, the next phase to plan, already lists tasks in ${taskIndexPath(target.phase)}; --phase prepares a planning input for a phase with none`,
      ])
    }
    const inputPath = planInputPath(target.phase)
    const scaffold = planningInputScaffold(loadIntents(dir), opts.intent ?? "default")
    await ensurePointer(dir, {
      testByDriver: opts.testByDriver,
      guidance: {
        kind: "phase",
        phase: phaseKey(target.phase).id,
        inputPath,
        scaffold: scaffold ?? "(the active intent pack carries no planning-input scaffold — free-form markdown)",
        manual,
      },
    })
    const existing = await readPlanInput(dir, target.phase)
    return stop(0, [
      `ℹ prepare the planning input of ${phaseRefText(target.phase)}: ${inputPath}`,
      existing?.trim()
        ? `an input exists there already — revise it with your agent (this state's guidance is in AGENTS.md)`
        : `work with your agent on it (this state's guidance and the scaffold are in AGENTS.md); a template also prints with ${surface.plan(dir, "--scaffold")}`,
      // The consumption pointer follows the boundary grammar (plans/0101
      // D4): phased constructs through transfer (the review stop between
      // construction and dispatch), m mode plans as before.
      `when the file holds your intent, run: ${manual ? `${surface.plan(dir)} — the planning session consumes it as written` : `${surface.transfer(dir)} — its construct reads it as written and stops for review`}`,
    ])
  }
  // Row 11 (--new-task): add one task the person names, with no session, to
  // the phase the route names now — D23's targeting (never another phase,
  // including one a handover or gate holds) and D26's guard, then the
  // mechanical write (task-add) and the review stop. Covers the plan route
  // (the phase's first task, the hand-listed m-mode entry made driver-safe),
  // execute, handover and both m-mode rows alike: a task someone already
  // knows needs no planner wherever it lands.
  if (opts.newTask !== undefined) {
    if (!route.phase.entry.hasTasks) {
      return stop(1, [taskLessPhaseLine(dir, route.phase)])
    }
    const mid = await midPipelineTask(dir)
    if (mid) return stop(1, [midPipelineLine(mid)])
    const added = await addTask(dir, route.phase, opts.newTask)
    if (added.type === "dirty") {
      return stop(2, dirtyStopLines("worktree not clean before adding the task", added.files))
    }
    if (added.type === "failed") return stop(2, [`⏸ ${added.question}`])
    return stop(0, addedLines(dir, added))
  }
  // Rows 12–13 (plans/0076, T-137): the standalone work-order routes. Both
  // take any ready unit of the phase the route names now (ruling 4 — not
  // just the dependency graph's leaves; the readiness predicate re-derives
  // over the plan loaded here, so adopt never trusts the export's snapshot),
  // and both are read-from-write routes of the phase the route names now,
  // like row 11's targeting. loadPlan's throw is the state-file grammar half
  // of adopt's validation (unitProblems); the export reaches it too — a
  // unit whose documents fail the grammar has no work order to render.
  if (opts.export !== undefined || opts.adopt !== undefined) {
    const ref = opts.export ?? opts.adopt!
    let task: Task | undefined
    let plan: Plan | undefined
    try {
      plan = await loadPlan(dir, route.phase)
      task = plan.tasks.find((unit) => unit.id === ref)
      if (task) {
        const notReady = unitNotReady(plan, task)
        if (notReady) return stop(1, [`${notReady}; take a ready unit (any unit whose prerequisites are done) — list them in ${taskIndexPath(route.phase)}`])
      }
    } catch (error) {
      return stop(1, [`⏸ ${error instanceof Error ? error.message : String(error)}`])
    }
    if (!task || !plan) return stop(1, [`${ref} is not listed in ${taskIndexPath(route.phase)}; a work order is rendered for a task of the phase the route names now`])
    if (opts.export !== undefined) {
      const order = await workOrder(dir, plan, task, {
        mode: opts.mode,
        testByDriver: opts.testByDriver,
        handoverTest: opts.handoverTest,
        phase: phaseKey(route.phase),
      })
      return stop(0, [order])
    }
    const adopted = await adoptUnit(dir, plan, task, {
      scanExempt: opts.scanExempt,
      idleMs: opts.idleMs,
      maxMs: opts.maxMs,
      // The channel's gate facts, the same two the export renders into the
      // work order (plans/0206 D1): the adopt serves the test request under
      // the condition it was taught under.
      testByDriver: opts.testByDriver,
      phase: phaseKey(route.phase),
    })
    return adopted.ok ? stop(0, adopted.lines) : stop(adopted.code, adopted.lines)
  }
  if (!manual) {
    // Row 10 (plans/0053 D23): --append on the execute or handover route
    // appends to the phase the route names now — never advancing to another
    // phase, including one on the handover route whose handover exists or
    // whose gate stopped it. The D26 guard applies.
    if (opts.append && (route.type === "execute" || route.type === "handover")) {
      const mid = await midPipelineTask(dir)
      if (mid) return stop(1, [midPipelineLine(mid)])
      return { type: "loop" }
    }
    // Row 6 (plans/0101 D4): the plan and handover routes hold no dispatched
    // work — the phase is unplanned (transfer constructs its plan task and
    // stops for review) or at its boundary (transfer distills the handover,
    // closes the phase and constructs the next one's task). An input's home
    // is the phase's plan-input.md: the assisted --phase route points the
    // guidance at it, and the next transfer's construct reads it.
    if (route.type === "plan" || route.type === "handover") {
      return stop(1, [
        route.type === "plan"
          ? `nothing is constructed for ${phaseRefText(route.phase)} yet — transfer constructs its plan task and stops for your review; run: ${surface.transfer(dir)}` +
            (opts.input
              ? ` (the planning input's home is ${planInputPath(route.phase)} — write it there, or prepare it with ${surface.plan(dir, "--phase")}, commit, and the construct reads it)`
              : "")
          : `${phaseRefText(route.phase)} is at its boundary — the handover distillation, the phase close and the next plan task's construction are transfer's; run: ${surface.transfer(dir)}` +
            (opts.input ? ` (a planning input for the next phase belongs in its plan-input.md, after the advance)` : ""),
      ])
    }
    // Row 7 (plans/0101 D4): the dispatch — a reviewed formulation task of
    // the phase the route names awaits (wherever it sits in the index, beside
    // hand-added tasks too); anything else is run's execute work and
    // transfer's boundary, and plan refuses naming both.
    if (awaitingFormulation(route.plan.tasks, route.phase) === undefined) {
      const pending = route.plan.tasks.filter((task) => task.status !== "done").length
      return stop(1, [
        `no reviewed plan task awaits dispatch: ${phaseRefText(route.phase)} holds ${pending} pending task(s) — execute work for ${surface.run(dir)}; ` +
          `the boundary and the next plan task are transfer's (${surface.transfer(dir)})` +
          (opts.input ? `; a planning input adds tasks with --append, it never dispatches` : ""),
      ])
    }
    // The input-invalidation rule (plans/0101 D4 — 0053 D10's restart rule
    // on the seam): an input that changes what the todo rendered invalidates
    // it, the reconstruct is transfer's; the same text re-passed dispatches
    // as-is (a no-op restatement of the persisted file). The input is
    // refused before any write, the round-setup rows' discipline.
    if (opts.input) {
      const persisted = (await readPlanInput(dir, route.phase))?.trim()
      if (persisted === undefined || persisted !== opts.input.text.trim()) {
        return stop(1, [inputInvalidatedLine(dir, route.phase)])
      }
    }
    // The incident's guard (plans/0101 D3): no planning session dispatches
    // against an empty round brief — plan refuses (exit 2, awaiting-person)
    // while docs/R-NN/round.md is the untouched stub, naming the fill and
    // the reconstruct that absorbs it.
    if (!(await roundBriefText(dir, round))) return stop(2, stubRoundLines(dir, round))
    return { type: "loop" }
  }
  // Row 8.
  if (route.type === "plan") return opts.input ? { type: "loop" } : stop(0, emptyIndexNotice(dir, route.plan.index))
  // Row 9: input on a non-empty index is an append (D23) — implied in m mode,
  // --append accepted as redundant; the D26 guard applies.
  if (opts.input) {
    const mid = await midPipelineTask(dir)
    if (mid) return stop(1, [midPipelineLine(mid)])
    return { type: "loop" }
  }
  return stop(0, executeNotice(dir, route, true))
}

const stop = (code: number, lines: string[]): PlanStop => ({ type: "stop", code, lines })

// The person-facing advisory notices of a planning step (plans/0081 D11.3 /
// D12.3): one line when no project brief exists (the off-switch variant names
// why no approval will install one), one when a planning step starts with no
// input (the scaffold is one command away). Neither blocks anything, and
// neither is a question — planning proceeds by the duties and the
// default-and-record rule (D16).
async function planningNotices(dir: string, phase: PhaseUnit | undefined, input: PlanInput | undefined, analysisOn: boolean): Promise<string[]> {
  const lines: string[] = []
  if ((await projectBriefText(dir)) === undefined) {
    lines.push(
      analysisOn
        ? "ℹ no project brief yet; the project analysis's `## Project brief` proposal installs it (amend --brief the manual override) — or name the reference in this round's planning input"
        : "ℹ no project brief yet — the analysis flow is off (OPENCODE_AUTO_ANALYSIS=off), so no approved proposal installs one: seed it with `amend --brief <text>`, or name the reference in this round's planning input",
    )
  }
  if (!input && phase !== undefined && !(await readPlanInput(dir, phase))?.trim()) {
    lines.push("ℹ no planning input given; plan --scaffold prints a template to complete (opencode-auto plan <dir> --scaffold)")
  }
  return lines
}

// The progress-record guard of rows 9–10 (plans/0053 D26): an append step
// writes its own resume record, and .auto/progress.json holds one record (F2)
// — appending while a task is mid-pipeline would overwrite the task's resume
// point. A record naming a task whose done.md does not exist (active or
// summary, this phase or another) stops the prelude; a step record (task
// PLAN) is the step machinery's own and no task's resume point, and a
// leftover record of a done task is inert. New tasks go after a blocked task
// anyway, and next resumes blocked tasks first, so an append cannot help it.
async function midPipelineTask(dir: string): Promise<string | undefined> {
  const record = await peekProgress(dir)
  if (!record || record.phase?.kind === "step" || !/^T-\d+$/.test(record.task)) return undefined
  return (await Bun.file(join(dir, taskStatePaths(record.task).complete)).exists()) ? undefined : record.task
}

const midPipelineLine = (id: string): string => `${id} is mid-pipeline (its resume point is in .auto/progress.json); finish it with run, or close it, before appending`

// The previous round's round-close check (plans/0049 G8), re-run when an
// interrupted round start is resumed: the round must be complete and pass it,
// as when the start began.
async function previousRoundClose(dir: string, round: number, gate: { build?: string; scanExempt?: string[] }): Promise<{ type: "pass"; lines: string[] } | PlanStop> {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  let state: PhaseState | undefined
  try {
    state = await readPhases(dir, round)
  } catch (error) {
    return stop(1, [phaseFlowBlockedLine(error instanceof Error ? error.message : String(error))])
  }
  const pending = state && currentPhase(state)
  if (!state || pending) {
    return stop(1, [
      `${join("docs", roundDirName(round + 1))}/ exists without its phase index, but round ${roundDirName(round)} is not complete ` +
        `(${state ? `pending: ${state.phases.filter((unit) => !state.done.has(unit.id)).map(phaseLabel).join(", ")}` : `${phaseIndexPath(round)} is missing`}); ` +
        `finish it with ${surface.run(dir)}, or remove the empty round directory`,
    ])
  }
  const close = await roundCloseProblems(dir, round, { build: gate.build, scanExempt: gate.scanExempt })
  if (close.problems.length) return stop(2, closeRefusal(dir, round, close))
  return { type: "pass", lines: roundCloseLines(close) }
}

// G8 failed: the next round waits for the human work the checks name, hence
// exit 2 (plans/0053 D4; continue exited 1).
function closeRefusal(dir: string, round: number, close: RoundClose): string[] {
  return roundCloseRefusalLines(dir, round, round + 1, close, "plan")
}

// The re-sync line's drift pairs (row 3, D34): each position of the unstarted
// tail as old → new; a position only the value fills shows the added phase,
// one only the index filled the dropped phase. Shared with transfer's
// boundary re-derivation (plans/0101 D6) — the same vocabulary for the same
// reshape, whichever command applies it.
export function driftPairs(drift: PhaseTailDrift): string {
  const current = drift.index.slice(drift.keep)
  const planned = drift.planned.slice(drift.keep)
  const pairs = planned.map((unit, i) => (current[i] ? `${phaseLabel(current[i]!)} → ${phaseLabel(unit)}` : `+ ${phaseLabel(unit)}`))
  for (const dropped of current.slice(planned.length)) pairs.push(`${phaseLabel(dropped)} dropped`)
  return pairs.join(", ")
}

// Row 3's stop line (D34 — the m-mode arm alone since plans/0206 D2, phased
// refusing naming transfer): what the re-sync changed, then the same
// review-and-commit gate a round setup stops at. `from` names the authority
// re-synced to — config phases, or the roadmap line that moved (plans/0101
// D5).
function resyncLine(dir: string, drift: PhaseTailDrift, from: string): string {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  return (
    `✓ phase index of round ${roundDirName(drift.round)} re-synced to ${from} (${driftPairs(drift)}); ` +
    `review ${phaseIndexPath(drift.round)}, commit, then re-run: ${surface.plan(dir)}`
  )
}

// Row 3's phased refusal (plans/0101 D4/D6, enacted by plans/0206 D2): the
// reshape's apply is the advance's — transfer re-derives the unstarted tail
// on its own committed rewrite — so plan refuses before any write (the
// uncommitted re-sync left phases.md dirty for the advance's preflight and
// taught a re-run that refused naming transfer). `action` is the channel's
// own resumption once the advance has re-derived (and, at a boundary,
// constructed); absent for the bare run, whose next step is the advance
// itself.
function transferDriftRefusal(dir: string, drift: PhaseTailDrift, from: string, action?: string): string {
  const surface = surfaceOf()
  return (
    `the phase index of round ${roundDirName(drift.round)} differs from ${from}: transfer re-derives the unstarted tail on its own commit` +
    (action !== undefined ? ` (run: ${surface.transfer(dir)}), then ${action}.` : ` — run: ${surface.transfer(dir)}`)
  )
}

// Row 3's drift refusals (D5 — the m-mode arm's ladder since plans/0206 D2,
// unreachable today beside it): the re-synced tail must be reviewed and
// committed before anything plans into it — one gate, three channels.
// `flag` names the input form this route refuses (the person re-runs plan
// without it to re-sync), `action` the channel's own resumption once the
// change is committed.
function driftRefusal(dir: string, drift: PhaseTailDrift, from: string, flag: string, action: string): string {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  return (
    `the phase index of round ${roundDirName(drift.round)} differs from ${from}: ` +
    `run ${surface.plan(dir)} without ${flag} to re-sync it, commit the change, then ${action}.`
  )
}

// The open-step refusals (row 5's hand-add, rows 12–13's work orders,
// rows 14–15's preparation flags): the step's snapshot and resume machinery
// own the phase's index until closeStep, and anything rendered or added
// under them would bypass both — returning the loop would silently ignore
// the flag, so the step is named and finished first; `tail` is the
// channel's own resumption after it.
function openStepRefusal(dir: string, open: { step: string; unit: string }, tail: string): string {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  const name = open.step === "phase-plan" ? "phase planning" : open.step === "phase-append" ? "task appending" : "phase handover"
  return (
    `the ${name} step of ${open.unit} was interrupted and is not closed out; ` +
    `finish it first (run: ${surface.plan(dir)}), then ${tail}`
  )
}

// Row 11's task-less-phase refusal: only the knowledge type gets here (its
// route distills knowledge instead of planning tasks).
function taskLessPhaseLine(dir: string, phase: PhaseUnit): string {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  return (
    `${phaseRefText(phase)} holds no tasks (its type, ${phase.type}, distills knowledge instead); ` +
    `--new-task adds a task to a phase that runs them — advance through it with ${surface.run(dir)}`
  )
}

// Row 11's success lines: what was written where, and the review point. The
// document is deliberately minimal, so the review line names it.
function addedLines(dir: string, added: { id: string; index: string; handoverRemoved?: string }): string[] {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  return [
    `✓ task ${added.id} added to ${added.index} (no session: --new-task writes it directly)`,
    ...(added.handoverRemoved !== undefined
      ? [`✓ stale handover removed: ${added.handoverRemoved} (the phase is distilled again after the task)`]
      : []),
    `next: review it (sharpen the Goal / Scope / Acceptance of docs/${added.id}/todo.md if needed), then run: ${surface.run(dir)}`,
  ]
}

// The mechanical half of round establishment — extracted for plans/0101 D2,
// transfer being the second caller: branch isolation, the roadmap line's
// strict validation (D5), the establishment write and the AGENTS.md
// round-preparation pointer. No lines of its own: every stop outcome carries
// what the caller needs to render its own (plan's G1 stop names plan's
// rhythm, transfer's names the construct-and-review one). The establishment
// stays uncommitted for the round-start gate either way — committing it is
// the person's review of the round.
type EstablishSetup =
  | { type: "dirty"; repos: { rel: string; files: string[] }[] }
  | { type: "failed"; error: string }
  | { type: "invalid"; problem: string }
  | { type: "error"; error: string }
  | { type: "ok"; round: number; state: PhaseState; units: PhaseUnit[]; isolated: string[]; resolved: RoundPhasesResolution; branch: string }

export async function establishRoundSetup(
  dir: string,
  round: number,
  opts: { phases: string; isolate?: string[]; testByDriver?: boolean },
): Promise<EstablishSetup> {
  const name = roundDirName(round)
  const resolved = await resolveRoundPhases(dir, round, opts.phases)
  const phases = resolved.phases
  const branch = `auto/${name}`
  let isolated: string[] = []
  if (opts.isolate?.length) {
    const result = await isolateRound(dir, opts.isolate, branch)
    if (result.type === "dirty") return { type: "dirty", repos: result.repos }
    if (result.type === "failed") return { type: "failed", error: result.error }
    isolated = result.isolated
  }
  // A roadmap line whose types the pack no longer ships fails strictly here,
  // through the ordinary establishment validation, naming the line (D5): the
  // release checked it against the types of its day, and this is where the
  // changed pack meets the released document.
  if (resolved.roadmap) {
    try {
      const types = loadPhaseTypes(dir)
      if (resolvePhases(phases, types) === null) {
        return { type: "invalid", problem: `the roadmap of ${ANALYSIS_DOC} plans ${name} with "${phases}", which this project cannot establish: ${phasesProblem(phases, types)}` }
      }
    } catch {
      // a broken custom-type table surfaces through establishRound's own path below
    }
  }
  let state: PhaseState | undefined
  try {
    await establishRound(dir, { phases, round })
    state = await readPhases(dir, round)
  } catch (error) {
    return { type: "error", error: error instanceof Error ? error.message : String(error) }
  }
  await ensurePointer(dir, { testByDriver: opts.testByDriver, guidance: { kind: "round", round: name, manual: opts.phases === "m" } })
  return { type: "ok", round, state: state!, units: state!.phases, isolated, resolved, branch }
}

// —— The 0101 rendering helpers (plans/0102, the complexity-5 dedup) ——
// plan's rows and transfer's shapes used to maintain twin renderings of the
// same outcomes — identical by discipline, not by construction. The four
// helpers below are the shared vocabulary: the command token
// ("plan" | "transfer") and each caller's own line compositions are the only
// interpolations, so every stop stays byte-identical to the twins they
// replaced (plan.test.ts and transfer.test.ts pin them).
// plans/0105 D3 widened the family: the loop-owned and transfer-owned stop
// lines that were log()-composed inline (logGateStop's gate stop, the
// boundary stop, transfer's nothing-to-advance refusal and roadmap-exhausted
// stop, analysisGate's three analysis stops) gained lines-returning twins
// here too, so the person-proxy brief (src/driver-helper.ts — deliberately
// below the loop, like this module) renders the same bytes the terminal
// prints. The loop-side originals print through these; a brief that could
// disagree with the terminal is worse than none.

// The held-phase gate stop (plans/0049 G7; the lines-returning twin of
// loop-phase's logGateStop, verbatim): the awaiting clarification shape, the
// acceptance shape, or the held-gate shape, with the person's ways on —
// sign, rework through an append, or close without the gate — as commands.
export async function gateStopLines(directory: string, phase: PhaseUnit, problems: readonly string[], acceptance: string | undefined): Promise<string[]> {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  const awaiting = problems.every((problem) => problem.startsWith("clarification:"))
  const waiting = problems.every((problem) => problem.startsWith("acceptance:"))
  const lines = [`⏸ phase ${phaseTitle(phase)} ${awaiting ? "awaits your clarification" : waiting ? "awaits acceptance" : "is held by its gate"}:`]
  for (const problem of problems) lines.push(`  ${problem}`)
  const handover = phaseHandoverDoc(phase)
  if (awaiting) {
    // The human gate (plans/0081 D14.3): a designed awaiting-person pause, the
    // acceptance gate's control point — done.md waits, and the person's
    // release simultaneously approves the proposed project brief (D15.2).
    // The next phase's planning input is named by its home (plans/0101 D4):
    // `plan --file` on this route is refused ("after the advance"), so the
    // pointer stays on the phase's plan-input.md, which the next transfer
    // construct reads. Human gates are phased-only, so no mode branch.
    const survey = phaseSurveyDoc(phase)
    lines.push(
      `  to release: review ${survey}, resolve the recorded forks — each carries a \`Recommend:\` default; \`${CLARIFIED_MARK}\` accepts them all (append your answers beside any line you override; the next phase's planning input is its \`plan-input.md\` — write it there; the next \`transfer\` construct reads it)`,
    )
    lines.push(
      `  then release it: ${bin} clarify ${directory} — it writes the \`${CLARIFIED_MARK}\` line to ${survey} and commits it (or add the line, commit, re-run yourself); ` +
        `the phase completes and the approved \`## Project brief\` section is installed`,
    )
    // The reshape channel (plans/0101 D6; the authority branch retired by
    // plans/0137 — the roadmap line the one channel, `amend --phases`
    // retired): the survey's findings are the round's best evidence of what
    // it should still do — where they contradict its unstarted phases, this
    // held boundary is the designed reshape moment (the findings in hand),
    // and the next transfer applies the moved or added line to the tail
    // before constructing (started phases untouched; a round the roadmap
    // does not cover becomes covered the moment its line exists).
    lines.push(
      `  to reshape the round from the findings: move or add its \`${phase.round} <phases> — <goal>\` line in ${ANALYSIS_DOC} — the round's unstarted phases re-derive when ${surface.transfer(directory)} next constructs (the line is the round's phase authority; the config phases value is init-stamped machinery, never the reshape channel)`,
    )
  }
  if (acceptance) {
    lines.push(`  to accept: review ${handover} and ${acceptance}, add the line \`${ACCEPTED_MARK}\` to ${acceptance}, commit, re-run`)
  }
  lines.push(
    `  to rework: ${acceptance ? `write your notes in ${acceptance}, ` : ""}append fix tasks with ${surface.plan(directory, "--append -p <text>")} ` +
      `(the stale handover is removed and distilled again after them)`,
  )
  lines.push(`  to close the phase without its gate: ${bin} close ${phaseKey(phase).id} ${directory} --reason <text>`)
  return lines
}

// The phase-boundary stop (plans/0101 D1; the dir-based twin of loop-phase's
// boundaryStopLines, verbatim): the phase's planned work is done at a clean
// end, and everything after is transfer's — the stop names the command, and
// the round close too when the phase just finished was the round's last.
// The phase-closed variant (plans/0189 D1, 0165-008): a phase already closed
// on disk — a handover an interrupted advance's re-entry finished (0101 D1)
// — stops with the truth: the distillation and the close are done, and
// transfer's next act is the construction. Derived from the phase's done
// state, so the loop's stop and the person-proxy brief render the same
// bytes.
export async function phaseBoundaryLines(directory: string, phase: PhaseUnit): Promise<string[]> {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  const state = await readPhases(directory).catch(() => undefined)
  const last = state?.phases.at(-1)?.id === phase.id
  if (state?.done.has(phase.id)) {
    return [
      `✓ phase boundary: ${phaseTitle(phase)} complete and closed — the handover was distilled and the phase committed (an interrupted advance's re-entry finished it, plans/0101 D1)`,
      `next: ${surface.transfer(directory)} — it constructs the next phase's plan task for your review${last ? " and closes the round (stopping with its close for your review)" : ""}`,
    ]
  }
  return [
    `✓ phase boundary: ${phaseTitle(phase)} complete at a clean phase end — every unit closed, the lanes landed; run executes the planned work of the current phase and stops here (plans/0101 D1)`,
    `next: ${surface.transfer(directory)} — it distills the handover, closes the phase${last ? " and the round (stopping with its close for your review)" : ""}, ` +
      `and constructs the next phase's plan task for your review`,
  ]
}

// Transfer's nothing-to-advance refusal (plans/0101 D2; the lines-returning
// twin of the inline log() in transferAdvance, verbatim): pending execute
// work is run's, the boundary follows its completion.
export function nothingToAdvanceLine(directory: string, phase: PhaseUnit, pending: number): string {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  return (
    `⏸ nothing to advance: ${phaseRefText(phase)} still holds ${pending} pending task(s) — ` +
    `execute them first: ${surface.run(directory)}; the boundary follows their completion`
  )
}

// Transfer's roadmap-exhausted stop (plans/0101 D2 shape 4; the
// lines-returning twin of the inline log() pair in roundOpen, verbatim): the
// released roadmap governs the sequence's end — the extend-the-document
// channel, never a silent config round.
export function roadmapExhaustedLines(directory: string, round: number): string[] {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  return [
    `✓ round ${roundDirName(round)} is closed, and the roadmap of ${ANALYSIS_DOC} holds no line for round ${roundDirName(round + 1)} — the planned work of the roadmap is done`,
    `next: extend ## Roadmap of ${ANALYSIS_DOC} with the next round's line (\`- ${roundDirName(round + 1)} <phases> — <goal>\`, its phases value the round establishes under), ` +
      `commit, then re-run: ${surface.transfer(directory)}`,
  ]
}

// The establishment stop lines (plan's establish and transfer's
// establishStop): every rendering of establishRoundSetup's outcome — the
// dirty-repo refusal, the branch-isolation failure, the roadmap validation
// problem, the plain error, and the G1 success block — with the two
// caller-specific renderings passed in: `established` is the phase text of
// the ✓ line (plan's m mode names the single phase; transfer lists the
// phases with the roadmap source suffix) and `next` is the caller's own
// rhythm line (plan's dispatch, transfer's construct-and-review), placed
// between the isolation line and the guidance line as both callers print
// it. The failure arms ignore both.
export function establishStopLines(
  dir: string,
  round: number,
  setup: EstablishSetup,
  command: "plan" | "transfer",
  established: string,
  next: string,
): { code: number; lines: string[] } {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  const name = roundDirName(round)
  if (setup.type === "dirty") {
    return {
      code: 2,
      lines: [
        `⏸ round ${name} cannot open yet: a repository designated by config isolate is not clean, and branch isolation requires clean repositories; ` +
          `handle it manually (commit/clean) and re-run:`,
        ...setup.repos.flatMap(({ rel, files }) => [`  ${rel}:`, ...files.map((file) => `    ${file}`)]),
      ],
    }
  }
  if (setup.type === "failed") {
    return { code: 1, lines: [`branch isolation failed, nothing was written: ${setup.error}; fix the repository and re-run: ${command === "plan" ? surface.plan(dir) : surface.transfer(dir)}`] }
  }
  if (setup.type === "invalid") {
    return { code: 1, lines: [`⏸ ${setup.problem}; fix the roadmap line (or the phase types it names), then re-run: ${command === "plan" ? surface.plan(dir) : surface.transfer(dir)}`] }
  }
  if (setup.type === "error") {
    return { code: 1, lines: [`round establishment failed: ${setup.error}`] }
  }
  const { isolated, branch } = setup
  // The isolation line rides both G1 shapes: the round's commits land on the
  // round branch, the original branch never moves.
  return {
    code: 0,
    lines: [
      `✓ round ${name} established: ${established}`,
      ...(isolated.length ? [`✓ branch isolation: ${isolated.join(", ")} on ${branch} (the driver's commits land there; the original branch stays untouched)`] : []),
      next,
      `ℹ AGENTS.md carries this state's preparation guidance for your coding agent (the round brief's sections, and where their content comes from)`,
    ],
  }
}

// The analysis-flow walkthrough (plan's rows 0a–0c and transfer's
// projectStart, plans/0084): the stub write with its AGENTS.md guidance, the
// grammar-problems hold, the awaits-you shape, and the Clarified release
// installing the approved brief proposal — the command token and the
// guidance's manual flag are the only differences between the two callers,
// whose flag-specific pre-refusals stay caller-side. The release returns the
// install's lines for the caller to carry into its establishment stop.
// The three stop shapes compose through the exported lines helpers below
// (plans/0105 D3: the person-proxy brief renders the same bytes without the
// write side).
type AnalysisGateOutcome = { type: "stop"; code: number; lines: string[] } | { type: "released"; lines: string[] }

// The just-opened stop: the stub written, the walkthrough, the release.
export function analysisOpenedLines(dir: string, command: "plan" | "transfer"): string[] {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  return [
    `✓ the project analysis is open: ${ANALYSIS_DOC} written (a stub with section hints)`,
    `next: work with your coding agent on ${ANALYSIS_DOC} — the analysis, the goals, one \`Fork:\` line per open decision, the project-brief proposal and the multi-round roadmap; this state's guidance is in AGENTS.md`,
    `then release it: ${bin} clarify ${dir} writes the \`${CLARIFIED_MARK}\` line and commits it (or add the line and commit yourself), and re-run: ${command === "plan" ? surface.plan(dir) : surface.transfer(dir)} — the approved brief is installed and round R-01 opens`,
  ]
}

// The grammar-problems hold: what holds the release, and the fix channel.
export function analysisHeldLines(dir: string, command: "plan" | "transfer", problems: readonly string[]): string[] {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  return [
    `⏸ ${ANALYSIS_DOC} has problems that hold its release:`,
    ...problems.map((problem) => `  ${problem}`),
    `fix them with your agent (this state's guidance is in AGENTS.md), commit, then re-run: ${command === "plan" ? surface.plan(dir) : surface.transfer(dir)}`,
  ]
}

// The awaits-you shape: the review, the forks, the release line.
export function analysisAwaitingLines(dir: string, command: "plan" | "transfer", forks: number): string[] {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  return [
    `⏸ the project analysis awaits you: review ${ANALYSIS_DOC}` +
      (forks > 0 ? `, resolve its ${forks} open Fork: line(s) (append your answers beside them)` : "") +
      `, then release it — ${bin} clarify ${dir} writes the \`${CLARIFIED_MARK}\` line and commits it (or add the line and commit yourself)`,
    `then re-run: ${command === "plan" ? surface.plan(dir) : surface.transfer(dir)} — the approved \`## Project brief\` proposal is installed and round R-01 opens`,
  ]
}

// The order notice (plans/0133 D7), appended to every unreleased-analysis
// stop shape: a brief already on disk while the analysis is not yet
// released — the aster-mig features census the field case (three projects
// prepared brief-first, no analysis). The analysis comes first, and its
// approved `## Project brief` proposal replaces the whole brief on release;
// the stop says so at the moment the person acts from it, naming the rescue
// (carry the disk brief's content into the section). Empty when no brief is
// on disk — the seed-free start keeps its byte-identical floor.
export async function analysisOrderLines(dir: string): Promise<string[]> {
  if ((await projectBriefText(dir)) === undefined) return []
  return [
    `ℹ a project brief is already on disk (${BRIEF_FILE}); the analysis still comes first — the approved \`## Project brief\` section of ${ANALYSIS_DOC} replaces the whole brief on release, so carry the disk brief's content into that section (or restore it with \`amend --brief\` afterwards)`,
  ]
}

export async function analysisGate(
  dir: string,
  command: "plan" | "transfer",
  opts: { testByDriver?: boolean; manual: boolean },
): Promise<AnalysisGateOutcome> {
  const raw = await Bun.file(join(dir, ANALYSIS_DOC)).text().catch(() => undefined)
  if (raw === undefined) {
    await mkdir(join(dir, "docs"), { recursive: true })
    await Bun.write(join(dir, ANALYSIS_DOC), renderAnalysisStub())
    await ensurePointer(dir, { testByDriver: opts.testByDriver, guidance: { kind: "analysis", manual: opts.manual } })
    return { type: "stop", code: 0, lines: [...analysisOpenedLines(dir, command), ...(await analysisOrderLines(dir))] }
  }
  let types: ReturnType<typeof loadPhaseTypes>
  try {
    types = loadPhaseTypes(dir)
  } catch (error) {
    return { type: "stop", code: 1, lines: [`⏸ ${error instanceof Error ? error.message : String(error)}`] }
  }
  const problems = analysisProblems(raw, types)
  if (problems.length) {
    await ensurePointer(dir, { testByDriver: opts.testByDriver, guidance: { kind: "analysis", manual: opts.manual } })
    return { type: "stop", code: 2, lines: [...analysisHeldLines(dir, command, problems), ...(await analysisOrderLines(dir))] }
  }
  if (!clarifiedMark(raw)) {
    await ensurePointer(dir, { testByDriver: opts.testByDriver, guidance: { kind: "analysis", manual: opts.manual } })
    return { type: "stop", code: 2, lines: [...analysisAwaitingLines(dir, command, surveyForks(raw)), ...(await analysisOrderLines(dir))] }
  }
  // The release (row 0d's shape): the approved brief proposal installs
  // verbatim (the survey release's mechanism, D15.2 generalized); the caller
  // establishes R-01 under the roadmap's line (plans/0101 D5 — the
  // round-start commit remains the person's veto).
  const proposal = briefProposal(raw)
  const lines: string[] = []
  if (proposal !== undefined) lines.push(...(await installBriefProposal(dir, ANALYSIS_DOC, proposal, commitTree)))
  return { type: "released", lines }
}

// The round-close refusal (plan's closeRefusal and transfer's two arms): the
// closed round's checks block the next round's opening; `command` names the
// re-run. plan renders closed=round/open=round+1; transfer's projectStart
// arm closes round-1 to open round, its roundOpen arm round to round+1.
export function roundCloseRefusalLines(dir: string, closed: number, open: number, close: RoundClose, command: "plan" | "transfer"): string[] {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  return [
    `⏸ round ${roundDirName(closed)} does not pass its round-close checks, so round ${roundDirName(open)} cannot open yet`,
    ...roundCloseLines(close, command),
    `next: fix them, commit, then re-run: ${command === "plan" ? surface.plan(dir) : surface.transfer(dir)}`,
  ]
}

// The drift-apply sequence (plan's row-3 re-sync and transfer's rederiveTail,
// plans/0053 D34 / 0101 D6): resolve the authority, read the unstarted-tail
// drift, and — when one exists and no refusal intervened — sync the index to
// it. The optional `refuse` hook is plan's D5 discipline (input is refused
// before the write; transfer applies unconditionally); it receives the drift
// and the authority text (`from`) the refusal lines and both callers' own
// stop lines name. What follows a successful sync stays caller-side: plan's
// uncommitted review stop, transfer's committed phase-sync.
type ApplyTailDrift =
  | { type: "blocked"; reason: string } // phaseTailDrift threw — the phase-flow-blocked line
  | { type: "clean" } // no drift, the common case
  | { type: "refused"; line: string } // the refuse hook answered
  | { type: "sync-failed"; error: string } // syncPhaseIndex threw — the caller words it
  | { type: "applied"; drift: PhaseTailDrift; from: string }

export async function applyTailDrift(
  dir: string,
  round: number,
  phases: string,
  refuse?: (drift: PhaseTailDrift, from: string) => string | undefined,
): Promise<ApplyTailDrift> {
  const authority = await resolveRoundPhases(dir, round, phases)
  const from = authority.roadmap ? `the roadmap of ${ANALYSIS_DOC}` : "config phases"
  let drift: PhaseTailDrift | undefined
  try {
    drift = await phaseTailDrift(dir, round, authority.phases)
  } catch (error) {
    return { type: "blocked", reason: error instanceof Error ? error.message : String(error) }
  }
  if (!drift) return { type: "clean" }
  const refusal = refuse?.(drift, from)
  if (refusal !== undefined) return { type: "refused", line: refusal }
  try {
    await syncPhaseIndex(dir, round, authority.phases)
  } catch (error) {
    return { type: "sync-failed", error: error instanceof Error ? error.message : String(error) }
  }
  return { type: "applied", drift, from }
}

// Establish a round (no AI, left uncommitted for the round-start gate G1)
// and print the G1 lines (plans/0053 D15). Branch isolation (plans/0074 §2.2)
// happens here — the natural point where round-scoped state is created: each
// repository the config's isolate key designates is switched onto the round
// branch auto/R-NN before anything is written, so a dirty designated
// repository blocks (exit 2, the same class as the run-start clean gate)
// naming the repo and its paths with no write done, and a git failure also
// stops with the round unwritten — the re-run's idempotent isolation finishes
// what a crash between the branch switches and establishRound left.
// AUTO-DECISION (ordering): the whole isolation — dirty check and branch
// switch — runs before establishRound, not after it. Afterward a git failure
// would leave the phase index written (the round routes on, isolation never
// re-runs, later commits silently land on the original branch); before it, a
// failure or block leaves no round state and the re-run retries everything,
// and a crash between the two leaves only content-neutral branches (a branch
// at HEAD changes no file), which the idempotent skips finish.
// Establishment through plan is m-mode-only since plans/0101 D4 — every
// phased not-established state is transfer's shape 1 (refused before any
// write), so resolveRoundPhases always short-circuits "m" here and the
// phased D5 rendering (the roadmap's sourced line, config `phases` the
// fallback) lives in transfer.ts's establishStop — both renderings compose
// through establishStopLines below, the shared outcome vocabulary (the
// caller's next line and the established text are the only interpolations).
// Since plans/0084 the stop also renders the AGENTS.md round-preparation
// guidance (the assisted half of this gate).
async function establish(dir: string, round: number, opts: { phases: string; isolate?: string[]; testByDriver?: boolean }, before: string[]): Promise<PlanPrelude> {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  const setup = await establishRoundSetup(dir, round, opts)
  const ok = setup.type === "ok" ? setup : undefined
  // The round-brief proposal channel (plans/0115 D3): m mode installs at
  // its own establishment — no construct step exists here for the advance's
  // apply seam to carry it. The driver's round-start commit sweeps the
  // setup, and the stop names the input step instead of the gate fill. The
  // hand-written brief wins: an existing round.md is never overwritten.
  let proposalNext: string | undefined
  if (ok && ok.resolved.phases === "m" && (await roundBriefText(dir, round)) === undefined) {
    const proposal = await releasedRoundBriefProposal(dir, round)
    if (proposal !== undefined) {
      const done = await installRoundBrief(dir, round, ANALYSIS_DOC, proposal, commitTree)
      before = [...before, ...done.lines]
      proposalNext = `next: the round brief is your released proposal, installed and committed — plan the round with: ${surface.plan(dir, "-p <text> | --file <path>")}`
    } else {
      // A released near-miss heading naming this round (plans/0158 D3): the
      // drafted-looking subsection never installs, so the round-start gate
      // below is what the round opens on — the line names why.
      const miss = await roundBriefNearMissNote(dir, round)
      if (miss) before = [...before, miss]
    }
  }
  // m mode only (the phased establishment is transfer's, above): the
  // single-phase rendering, no roadmap source suffix.
  const lines = establishStopLines(
    dir,
    round,
    setup,
    "plan",
    ok ? `single phase ${phaseLabel(ok.units[0]!)}` : "",
    ok
      ? (proposalNext ??
        `next (round-start gate): review the setup and commit it; then list tasks in ${taskIndexPath(ok.units[0]!)} by hand, ` +
          `or run: ${surface.plan(dir, "-p <text> | --file <path>")}`)
      : "",
  )
  return stop(lines.code, [...before, ...lines.lines])
}

// A roadmap line's goal as the sourced line's round class: capped so a long
// goal cannot swallow the stop line. Shared with transfer's establish stop
// (plans/0101 D2).
export function truncateGoal(goal: string): string {
  return goal.length > 60 ? `${goal.slice(0, 60)}…` : goal
}

// The phase a planning input would be planned into on a phased plan or
// handover route: the current phase when it plans tasks, otherwise the first
// phase the loop reaches after handing it over, passing task-less
// (knowledge) phases the way the loop does. listed = its task index already
// lists tasks, so the loop would stop on its execute route instead.
async function planTarget(dir: string, route: Extract<PhaseRoute<Plan>, { type: "plan" | "handover" }>): Promise<{ phase: PhaseUnit; listed: boolean } | undefined> {
  if (route.type === "plan" && route.phase.entry.hasTasks) return { phase: route.phase, listed: false }
  const state = (await readPhases(dir))!
  const done = new Set([...state.done, route.phase.id])
  for (;;) {
    const phase = currentPhase({ phases: state.phases, done })
    if (!phase) return undefined
    if (phase.entry.hasTasks) return { phase, listed: (await loadPlan(dir, phase)).tasks.length > 0 }
    done.add(phase.id)
  }
}

// R-01.P02 implement
export const phaseRefText = (phase: PhaseUnit): string => `${qualifiedPhase(phase)} ${phase.type}`

// A route with tasks left or all done: what plan says instead of planning
// (plans/0053 D7, D15). The pointers name the lifecycle commands a person
// can go on with: run the phase, add more tasks (an append on a planned
// index), or close units that will not run.
export function executeNotice(dir: string, route: Extract<PhaseRoute<Plan>, { type: "execute" | "handover" }>, manual: boolean): string[] {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  const total = route.plan.tasks.length
  const pending = route.plan.tasks.filter((task) => task.status !== "done").length
  // In m mode input on a non-empty index is an append already (D23), so the
  // pointer is plan's plain input form.
  if (manual) {
    return [`ℹ ${route.plan.index} lists ${total} task(s) (${pending} pending); next: ${surface.run(dir)}, or add tasks with ${surface.plan(dir, "-p <text> | --file <path>")}`]
  }
  return [
    `ℹ ${phaseRefText(route.phase)} is planned (${pending} of ${total} tasks pending); next: ${surface.run(dir)} ` +
      `— or add tasks with ${surface.plan(dir, "--append -p <text>")}, or close units with ${bin} close <ref>`,
  ]
}

// Input on a planned phase without --append (row 7's old refusal) retired
// with plans/0101 D4's narrowing: the execute route now either dispatches the
// awaiting formulation task or refuses naming run and transfer, the input
// clause riding the refusal.

// The phased not-established refusal (plans/0101 D4): every project-start
// shape — the analysis flow, the establishment, the interrupted round start —
// is transfer's, one line naming the advance command.
function transferStartLine(dir: string): string {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  return (
    `no plan task awaits dispatch and no round is established: the project start — the analysis, the round establishment, ` +
    `the first plan task's construction — is transfer's; run: ${surface.transfer(dir)}`
  )
}

// The input-invalidation refusal (plans/0101 D4, 0053 D10's restart rule on
// the seam): an input that changes what the reviewed todo rendered
// invalidates it — the reconstruct is transfer's, and the refusal names the
// input's home (the phase's plan-input.md, the assisted --phase route's
// target) where the text belongs.
function inputInvalidatedLine(dir: string, phase: PhaseUnit): string {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  return (
    `the planning input changes what the reviewed plan task rendered — an input that changes after construction invalidates the todo: ` +
    `write it into ${planInputPath(phase)} (or prepare it with ${surface.plan(dir, "--phase")}), commit, and re-run: ${surface.transfer(dir)} — ` +
    `its idempotent reconstruct absorbs the input and stops for review again (the same text re-passed dispatches as-is)`
  )
}

// The stub-round refusal (plans/0101 D3, the incident's guard): plan refuses
// — exit 2, awaiting-person — while the round brief is the untouched stub; no
// planning session dispatches against an empty round brief. The fill and the
// transfer re-run are the answer (the reconstruct absorbs the filled brief;
// --round re-points the guidance at the document), or — since plans/0115 —
// the proposal channel: release an `### R-NN` subsection under `## Round
// briefs` of docs/analysis.md and commit, and the next transfer installs it
// verbatim ahead of the construct.
function stubRoundLines(dir: string, round: number): string[] {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  return [
    `⏸ the round brief ${roundBriefPath(round)} is still the untouched stub: no planning session dispatches against an empty round brief`,
    `next: fill it in (## Goal, ## Acceptance criteria, ## Release criteria — ${surface.plan(dir, "--round")} points the AGENTS.md guidance at it), commit, ` +
      `then re-run: ${surface.transfer(dir)} — its idempotent reconstruct absorbs the filled brief and stops for review again; ` +
      `or draft it as a \`### ${roundDirName(round)}\` proposal under \`## Round briefs\` of ${ANALYSIS_DOC}, commit — the next ${surface.transfer(dir)} installs it verbatim`,
  ]
}

// m mode with nothing listed and no input (plans/0053 D15).
export function emptyIndexNotice(dir: string, index: string): string[] {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  return [`ℹ no tasks listed in ${index} yet: list them there by hand (docs/T-NNN/todo.md per task), or run: ${surface.plan(dir, "-p <text> | --file <path>")}`]
}

// A planning step that just ran under plan's stop condition (plans/0053 D6,
// D15): what was planned, and the review before run. Phased, the review can
// also edit lines, close a task, or append more (m mode's index is edited by
// hand and its tasks close the same way, so its line stays plain).
export function plannedLines(dir: string, phase: PhaseUnit, ids: readonly string[], manual: boolean): string[] {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  const index = taskIndexPath(phase)
  const next = manual
    ? `next: review them, then run: ${surface.run(dir)}`
    : `next: review them (edit, close, or plan --append), then run: ${surface.run(dir)}`
  if (manual) {
    const span = ids.length > 1 ? `${ids[0]}…${ids[ids.length - 1]}` : (ids[0] ?? "")
    return [`✓ planned ${ids.length} task(s) (${span}) into ${index}`, next]
  }
  return [`✓ planned ${phaseRefText(phase)}: ${ids.length} task(s) in ${index}`, next]
}

// The round completed inside plan (plans/0053 D8): its ## Close cannot be
// filled in yet, so the next round opens on the next plan.
export function roundCompleteNext(dir: string, round: number): string {
  const { bin } = shellProfile()
  const surface = surfaceOf()
  return `next: fill in ## Close of ${roundBriefPath(round)}, commit, then run ${surface.plan(dir)} to open round ${roundDirName(round + 1)}`
}
