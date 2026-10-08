// The plan command's core (plans/0053 D4–D8, D15, D23, D26, D34; the
// no-session task add lives in src/task-add.ts, plans/0058): the prelude
// that decides every route needing no AI before an agent starts, and the
// lines plan prints where it stops. The prelude runs under the run lock the
// shell holds, before runAll, so it works on the dirty tree a fresh round
// setup leaves and starts no server just to print a notice; it must never
// import the loop. The loop (loop-phase, loop-plan) prints the same stop
// lines through the helpers here, so plan says the same thing wherever it
// stops.
//
// Pointer texts name the lifecycle commands that exist (plans/0053 D29).
import { join } from "node:path"
import { mkdir } from "node:fs/promises"
import { ensurePointer } from "./agents-block"
import { analysisProblems, renderAnalysisStub, roadmapPhases } from "./analysis"
import { briefProposal, installBriefProposal, projectBriefText } from "./brief"
import { ANALYSIS_DOC, roundBriefPath, roundDirName } from "./docpaths"
import { log } from "./log"
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
  phaseIndexPath,
  phaseKey,
  phaseLabel,
  phaseTailDrift,
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
import { readPlanInput, planInputPath, type PlanInput } from "./plan-input"
import { commitTree, isolateRound } from "./git"
import { renderRoundBrief, roundBriefText } from "./round-brief"
import { roundCloseLines, roundCloseProblems, type RoundClose } from "./round-close"
import { openStep, peekProgress } from "./resume"
import { shellProfile } from "./shell"
import { autoSwitches } from "./switches"
import { executeBlockageChoices, executionLines } from "./blockage-execute"
import { addTask } from "./task-add"
import { loadPlan, qualifiedPhase, taskIndexPath, taskStatePaths, type Plan, type Task } from "./tasks"
import { adoptUnit, unitNotReady, workOrder } from "./work-order"

type PlanStop = { type: "stop"; code: number; lines: string[] }
export type PlanPrelude = { type: "loop" } | PlanStop

// The routes the prelude decides, first match wins (plans/0053 D4):
//   0. no rounds exist and the analysis switch is on (plans/0084) → the
//      pre-round project analysis: 0a the stub + the AGENTS.md analysis
//      guidance; 0b grammar problems hold the release; 0c an unreleased
//      analysis awaits the person's `Clarified: yes`; 0d a released one
//      installs the approved brief proposal and establishes R-01 (row 1's
//      establish, with the roadmap's phases advice riding in its stop) —
//      OPENCODE_AUTO_ANALYSIS=off falls through to row 1 directly;
//   1. the current round is not established → (G8 of the previous round) + establish, G1 lines;
//   2. the round is complete → G8; pass = establish the next round, fail = exit 2;
//   3. the round's phase index drifted from the phases value → re-sync the
//      unstarted tail (uncommitted), stop for review;
//   4. the route is blocked → exit 1;
//   5. an open step record → the loop finishes it first;
//  14. --round → the assisted round-brief preparation stop: the AGENTS.md
//      round guidance (and the m-mode stub establishment never wrote);
//  15. --phase → the assisted planning-input preparation stop for the next
//      phase to plan: the AGENTS.md phase guidance with the pack's scaffold;
//   6. phased, plan or handover without --append → the loop (input: a phase must be left to plan it);
//   7. phased, execute without --append → notice, exit 0 (input: exit 1);
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
          `pass only the title (${bin} plan ${dir} --new-task "<title>"), or plan from an input instead (${bin} plan ${dir} --append -p <text> | --file <path>)`,
      ])
    }
  }
  if (opts.append && !opts.input) {
    return stop(1, [
      `--append requires a planning input: pass one with ${bin} plan ${dir} -p <text> | --file <path> — appending adds the tasks planned from the input to the current phase`,
    ])
  }
  // The work-order routes (rows 12–13, plans/0076): the shell checks the
  // reference's shape and the mutual exclusions before the lock; this
  // backstops other shells and direct callers, before any route logic —
  // one route runs, and neither plans from an input nor adds a task.
  if (opts.export !== undefined && opts.adopt !== undefined) {
    return stop(1, [
      `--export and --adopt are mutually exclusive: --export renders a ready unit's work order for a standalone session, --adopt closes one out — run them one at a time (${bin} plan ${dir} --export <task id>, then --adopt <task id> after the session)`,
    ])
  }
  if ((opts.export !== undefined || opts.adopt !== undefined) && (opts.input || opts.append || opts.newTask !== undefined)) {
    return stop(1, [
      `--export / --adopt take only a task id: no planning input (a session never plans under them), no --append, no --new-task — pass the flag alone (${bin} plan ${dir} --export <task id> | --adopt <task id>)`,
    ])
  }
  // The assisted-preparation backstop (plans/0084): --round and --phase are
  // mutually exclusive and take no other route option. The shell checks this
  // before the lock; this catches other shells and direct callers, before any
  // route logic — the work-order backstop's pattern.
  if (opts.round && opts.phase) {
    return stop(1, [
      `--round and --phase are mutually exclusive: --round prepares the round brief of the round at hand, --phase the planning input of the next phase to plan — run them one at a time (${bin} plan ${dir} --round | --phase)`,
    ])
  }
  if ((opts.round || opts.phase) && (opts.input || opts.append || opts.newTask !== undefined || opts.export !== undefined || opts.adopt !== undefined)) {
    return stop(1, [
      `--round / --phase take no other option: no planning input, no --append, no --new-task, no --export / --adopt — pass the flag alone (${bin} plan ${dir} --round | --phase)`,
    ])
  }
  const round = await currentRound(dir)
  // Rows 0a–0d (plans/0084): the pre-round project analysis — the assisted
  // first-run step that fixes the engagement's goals before any round exists.
  // Practice ruled the first analysis determines the key work of the rounds
  // that follow, so it runs before R-01 opens and its roadmap decides the
  // phases value each round should be established under (the config stays
  // constitutional — the driver only advises the exact amend command). The
  // switch's parse error is a usage stop here, the prelude being the first
  // switch reader on the plan path.
  let analysisOn: boolean
  try {
    analysisOn = autoSwitches().analysis
  } catch (error) {
    return stop(1, [error instanceof Error ? error.message : String(error)])
  }
  if (analysisOn && round === 1 && !(await roundRoot(dir, 1))) {
    // The row-1 refusals' shape (D5: input is refused before any write) on
    // the analysis rows: the flags name no round yet, so each refusal points
    // at the analysis instead of an establishment.
    if (opts.input) {
      return stop(1, [
        `no round exists yet: the project analysis comes first — run ${bin} plan ${dir} without input, work with your agent on ${ANALYSIS_DOC} (the guidance is in AGENTS.md), release it with \`${CLARIFIED_MARK}\` and commit; round R-01 opens on the re-run and takes the input`,
      ])
    }
    if (opts.newTask !== undefined) {
      return stop(1, [
        `no round exists yet: the project analysis comes first — run ${bin} plan ${dir} without --new-task; round R-01 opens on its release, and the task lands in it`,
      ])
    }
    if (opts.export !== undefined || opts.adopt !== undefined) {
      return stop(1, [
        `no round exists yet: the project analysis comes first — run ${bin} plan ${dir} without --export / --adopt; round R-01 opens on its release, and the work order lands in it`,
      ])
    }
    if (opts.phase) {
      return stop(1, [
        `no phase exists yet: the project analysis comes first — run ${bin} plan ${dir}, work with your agent on ${ANALYSIS_DOC} (the guidance is in AGENTS.md), release it with \`${CLARIFIED_MARK}\`, and round R-01 opens`,
      ])
    }
    const raw = await Bun.file(join(dir, ANALYSIS_DOC)).text().catch(() => undefined)
    if (raw === undefined) {
      await mkdir(join(dir, "docs"), { recursive: true })
      await Bun.write(join(dir, ANALYSIS_DOC), renderAnalysisStub())
      await ensurePointer(dir, { testByDriver: opts.testByDriver, guidance: { kind: "analysis" } })
      return stop(0, [
        `✓ the project analysis is open: ${ANALYSIS_DOC} written (a stub with section hints)`,
        `next: work with your coding agent on ${ANALYSIS_DOC} — the analysis, the goals, one \`Fork:\` line per open decision, the project-brief proposal and the multi-round roadmap; this state's guidance is in AGENTS.md`,
        `then add the line \`${CLARIFIED_MARK}\`, commit, and re-run: ${bin} plan ${dir} — the approved brief is installed and round R-01 opens`,
      ])
    }
    let types: ReturnType<typeof loadPhaseTypes>
    try {
      types = loadPhaseTypes(dir)
    } catch (error) {
      return stop(1, [`⏸ ${error instanceof Error ? error.message : String(error)}`])
    }
    const problems = analysisProblems(raw, types)
    if (problems.length) {
      await ensurePointer(dir, { testByDriver: opts.testByDriver, guidance: { kind: "analysis" } })
      return stop(2, [
        `⏸ ${ANALYSIS_DOC} has problems that hold its release:`,
        ...problems.map((problem) => `  ${problem}`),
        `fix them with your agent (this state's guidance is in AGENTS.md), commit, then re-run: ${bin} plan ${dir}`,
      ])
    }
    if (!clarifiedMark(raw)) {
      await ensurePointer(dir, { testByDriver: opts.testByDriver, guidance: { kind: "analysis" } })
      const forks = surveyForks(raw)
      return stop(2, [
        `⏸ the project analysis awaits you: review ${ANALYSIS_DOC}` +
          (forks > 0 ? `, resolve its ${forks} open Fork: line(s) (append your answers beside them)` : "") +
          `, then add the line \`${CLARIFIED_MARK}\` and commit`,
        `then re-run: ${bin} plan ${dir} — the approved \`## Project brief\` proposal is installed and round R-01 opens`,
      ])
    }
    // Row 0d, the release: install the approved brief proposal (the survey
    // release's mechanism, D15.2 generalized), then establish R-01 like row
    // 1 — the roadmap's phases advice rides in establish's stop, advisory:
    // the person amends before committing the setup, or diverges on purpose.
    const lines: string[] = []
    const proposal = briefProposal(raw)
    if (proposal !== undefined) lines.push(...(await installBriefProposal(dir, ANALYSIS_DOC, proposal, commitTree)))
    return establish(dir, 1, opts, lines)
  }
  // Row 1: no docs/R-NN/, or its phase index is missing (an interrupted
  // round start, plans/0049 G6).
  if (!(await Bun.file(join(dir, phaseIndexPath(round))).exists())) {
    if (opts.input) {
      return stop(1, [
        `round ${roundDirName(round)} is not established yet: run ${bin} plan ${dir} without input to establish it, commit the setup, then pass the input.`,
      ])
    }
    if (opts.newTask !== undefined) {
      return stop(1, [
        `round ${roundDirName(round)} is not established yet: run ${bin} plan ${dir} without --new-task to establish it, commit the setup, then add the task again.`,
      ])
    }
    if (opts.export !== undefined || opts.adopt !== undefined) {
      return stop(1, [
        `round ${roundDirName(round)} is not established yet: run ${bin} plan ${dir} without --export / --adopt to establish it, commit the setup, then take the work order again.`,
      ])
    }
    const lines: string[] = []
    if (round > 1) {
      const previous = await previousRoundClose(dir, round - 1, opts)
      if (previous.type === "stop") return previous
      lines.push(...previous.lines)
    }
    lines.push(...(await planningNotices(dir, undefined, opts.input)))
    return establish(dir, round, opts, lines)
  }
  const route = await routePhase(dir, { loadPlan, bin })
  // Row 2: m mode never gets here (its single phase stays open).
  if (route.type === "complete") {
    const next = roundDirName(round + 1)
    if (opts.input) {
      return stop(1, [
        `round ${roundDirName(round)} is complete and round ${next} is not established yet: ` +
          `run ${bin} plan ${dir} without input to establish it, commit the setup, then pass the input.`,
      ])
    }
    if (opts.newTask !== undefined) {
      return stop(1, [
        `round ${roundDirName(round)} is complete and round ${next} is not established yet: ` +
          `run ${bin} plan ${dir} without --new-task to establish it, commit the setup, then add the task again.`,
      ])
    }
    if (opts.export !== undefined || opts.adopt !== undefined) {
      return stop(1, [
        `round ${roundDirName(round)} is complete and round ${next} is not established yet: ` +
          `run ${bin} plan ${dir} without --export / --adopt to establish it, commit the setup, then take the work order again.`,
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
    if (executed.type === "reblocked" && !executed.stale) return stop(2, [`⏸ remediation re-blocked: ${executed.reason}`, `next: resolve what it names, then re-run: ${bin} plan ${dir}`])
    for (const line of executionLines(executed)) log(line)
  }
  // Row 3 (plans/0053 D34): the phase index drifted from the phases value —
  // config `phases` changed after the round was established. plan owns the
  // re-sync (run refuses to, Q4): syncPhaseIndex replaces the unstarted tail,
  // the change stays uncommitted like any round setup, and the stop asks for
  // the review. Input is refused before the write (D5): the input would plan
  // into a tail nobody has reviewed yet. A value the sync refuses (dropping a
  // completed phase, a directory that holds work) surfaces as the error
  // plannedPhaseUnits throws.
  let drift: PhaseTailDrift | undefined
  try {
    drift = await phaseTailDrift(dir, round, opts.phases)
  } catch (error) {
    return stop(1, [`⏸ phase flow blocked: ${error instanceof Error ? error.message : String(error)}`])
  }
  if (drift) {
    if (opts.input) return stop(1, [driftInputLine(dir, drift)])
    if (opts.newTask !== undefined) return stop(1, [driftNewTaskLine(dir, drift)])
    if (opts.export !== undefined || opts.adopt !== undefined) return stop(1, [driftOrderLine(dir, drift)])
    try {
      await syncPhaseIndex(dir, round, opts.phases)
    } catch (error) {
      return stop(1, [`phase-index re-sync failed: ${error instanceof Error ? error.message : String(error)}`])
    }
    return stop(0, [resyncLine(dir, drift)])
  }
  // Row 4.
  if (route.type === "blocked") return stop(1, [`⏸ phase flow blocked: ${route.reason}`])
  // The advisory notices (plans/0081 D11.3/D12.3): the plan route is where a
  // planning session is imminent — m mode's row 8 included (route.type is
  // "plan" there too).
  if (route.type === "plan") for (const line of await planningNotices(dir, route.phase, opts.input)) log(line)
  // Row 5: the interrupted step is finished first (plans/0018 precedence);
  // the loop decides whether the record still matches the route. A hand-add
  // must not run under an open step: its snapshot and resume machinery
  // assume they own the phase's index, so --new-task waits until the step is
  // closed out.
  if (opts.newTask !== undefined) {
    const open = await openStep(dir)
    if (open) return stop(1, [openStepNewTaskLine(dir, open)])
  }
  // Rows 12–13's open-step refusal: the same reasoning as --new-task's —
  // the step's snapshot and resume machinery own the phase's index until it
  // closes, and a work order rendered or adopted under them would bypass
  // both (returning the loop here would silently ignore the flag).
  if (opts.export !== undefined || opts.adopt !== undefined) {
    const open = await openStep(dir)
    if (open) return stop(1, [openStepOrderLine(dir, open)])
  }
  // The assisted-preparation flags' open-step refusal (plans/0084), the same
  // reasoning as --new-task's: returning the loop here would silently ignore
  // the flag, so the person hears the step first.
  if (opts.round || opts.phase) {
    const open = await openStep(dir)
    if (open) return stop(1, [openStepAssistLine(dir, open)])
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
    await ensurePointer(dir, { testByDriver: opts.testByDriver, guidance: { kind: "round", round: roundDirName(round) } })
    return stop(0, [
      filled
        ? `ℹ the round brief ${roundBriefPath(round)} is filled; revise it with your agent if the round's goals moved (this state's guidance is in AGENTS.md), then continue: ${bin} plan ${dir}`
        : `ℹ the round brief ${roundBriefPath(round)} is the stub: work with your agent on its goal, acceptance and release criteria (this state's guidance is in AGENTS.md), review and commit, then continue: ${bin} plan ${dir}`,
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
            `add tasks with ${bin} plan ${dir} --append -p <text> | --file <path>, or list them by hand in ${taskIndexPath(route.phase)}`
          : `${phaseRefText(route.phase)} is past planning; --phase prepares the planning input of a phase still to plan — ` +
            `add tasks to a planned phase with ${bin} plan ${dir} --append -p <text> | --file <path>`,
      ])
    }
    let target: { phase: PhaseUnit; listed: boolean } | undefined
    try {
      target = manual ? { phase: route.phase, listed: false } : await planTarget(dir, route)
    } catch (error) {
      return stop(1, [`⏸ phase flow blocked: ${error instanceof Error ? error.message : String(error)}`])
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
      },
    })
    const existing = await readPlanInput(dir, target.phase)
    return stop(0, [
      `ℹ prepare the planning input of ${phaseRefText(target.phase)}: ${inputPath}`,
      existing?.trim()
        ? `an input exists there already — revise it with your agent (this state's guidance is in AGENTS.md)`
        : `work with your agent on it (this state's guidance and the scaffold are in AGENTS.md); a template also prints with ${bin} plan ${dir} --scaffold`,
      `when the file holds your intent, run: ${bin} plan ${dir} — the planning session consumes it as written`,
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
    const added = await addTask(dir, route.phase, opts.newTask, { autoNumber: opts.autoNumber })
    if (added.type === "dirty") {
      return stop(2, [`⏸ worktree not clean before adding the task; handle it manually (commit/clean) and re-run:`, ...added.files.map((file) => `  ${file}`)])
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
    const adopted = await adoptUnit(dir, plan, task, { scanExempt: opts.scanExempt, idleMs: opts.idleMs, maxMs: opts.maxMs })
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
    // Row 6 (the plan route plans the phase normally; --append is redundant
    // there — an empty index has nothing to append to).
    if (route.type === "plan" || route.type === "handover") {
      if (!opts.input) return { type: "loop" }
      let target: { phase: PhaseUnit; listed: boolean } | undefined
      try {
        target = await planTarget(dir, route)
      } catch (error) {
        return stop(1, [`⏸ phase flow blocked: ${error instanceof Error ? error.message : String(error)}`])
      }
      if (!target) return stop(1, [`no phase is left to plan in round ${roundDirName(round)}; the planning input would not be used`])
      if (target.listed) {
        return stop(1, [
          `${phaseRefText(target.phase)}, the next phase to plan, already lists tasks in ${taskIndexPath(target.phase)}; the planning input would not be used`,
        ])
      }
      return { type: "loop" }
    }
    // Row 7 (D7): exit 0 without input keeps `plan && run` usable; input on
    // a planned phase is a real mistake.
    return opts.input ? stop(1, [inputUnusedLine(dir, route), ...executeNotice(dir, route, false)]) : stop(0, executeNotice(dir, route, false))
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
// D12.3): one line when no project brief exists (the survey phase will
// propose one; the seed is optional), one when a planning step starts with no
// input (the scaffold is one command away). Neither blocks anything, and
// neither is a question — planning proceeds by the duties and the
// default-and-record rule (D16).
async function planningNotices(dir: string, phase: PhaseUnit | undefined, input: PlanInput | undefined): Promise<string[]> {
  const lines: string[] = []
  if ((await projectBriefText(dir)) === undefined) {
    lines.push(
      "ℹ no project brief yet; the survey phase will propose one — seed it optionally with init --brief <one line>, or name the reference in this round's planning input",
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
  let state: PhaseState | undefined
  try {
    state = await readPhases(dir, round)
  } catch (error) {
    return stop(1, [`⏸ phase flow blocked: ${error instanceof Error ? error.message : String(error)}`])
  }
  const pending = state && currentPhase(state)
  if (!state || pending) {
    return stop(1, [
      `${join("docs", roundDirName(round + 1))}/ exists without its phase index, but round ${roundDirName(round)} is not complete ` +
        `(${state ? `pending: ${state.phases.filter((unit) => !state.done.has(unit.id)).map(phaseLabel).join(", ")}` : `${phaseIndexPath(round)} is missing`}); ` +
        `finish it with ${bin} run ${dir}, or remove the empty round directory`,
    ])
  }
  const close = await roundCloseProblems(dir, round, { build: gate.build, scanExempt: gate.scanExempt })
  if (close.problems.length) return stop(2, closeRefusal(dir, round, close))
  return { type: "pass", lines: roundCloseLines(close) }
}

// G8 failed: the next round waits for the human work the checks name, hence
// exit 2 (plans/0053 D4; continue exited 1).
function closeRefusal(dir: string, round: number, close: RoundClose): string[] {
  const { bin } = shellProfile()
  return [
    `⏸ round ${roundDirName(round)} does not pass its round-close checks, so round ${roundDirName(round + 1)} cannot open yet`,
    ...roundCloseLines(close),
    `next: fix them, commit, then re-run: ${bin} plan ${dir}`,
  ]
}

// The re-sync line's drift pairs (row 3, D34): each position of the unstarted
// tail as old → new; a position only the value fills shows the added phase,
// one only the index filled the dropped phase.
function driftPairs(drift: PhaseTailDrift): string {
  const current = drift.index.slice(drift.keep)
  const planned = drift.planned.slice(drift.keep)
  const pairs = planned.map((unit, i) => (current[i] ? `${phaseLabel(current[i]!)} → ${phaseLabel(unit)}` : `+ ${phaseLabel(unit)}`))
  for (const dropped of current.slice(planned.length)) pairs.push(`${phaseLabel(dropped)} dropped`)
  return pairs.join(", ")
}

// Row 3's stop line (D34): what the re-sync changed, then the same
// review-and-commit gate a round setup stops at.
function resyncLine(dir: string, drift: PhaseTailDrift): string {
  const { bin } = shellProfile()
  return (
    `✓ phase index of round ${roundDirName(drift.round)} re-synced to config phases (${driftPairs(drift)}); ` +
    `review ${phaseIndexPath(drift.round)}, commit, then re-run: ${bin} plan ${dir}`
  )
}

// Row 3's input refusal (D5): the re-synced tail must be reviewed and
// committed before anything plans into it.
function driftInputLine(dir: string, drift: PhaseTailDrift): string {
  const { bin } = shellProfile()
  return (
    `the phase index of round ${roundDirName(drift.round)} differs from config phases: ` +
    `run ${bin} plan ${dir} without input to re-sync it, commit the change, then pass the input.`
  )
}

// Row 3's --new-task refusal: same gate, adapted tail — the re-synced tail
// must be reviewed and committed before a task lands in its phases.
function driftNewTaskLine(dir: string, drift: PhaseTailDrift): string {
  const { bin } = shellProfile()
  return (
    `the phase index of round ${roundDirName(drift.round)} differs from config phases: ` +
    `run ${bin} plan ${dir} without --new-task to re-sync it, commit the change, then add the task again.`
  )
}

// Row 3's work-order refusal: same gate — the re-synced tail must be
// reviewed and committed before a unit of its phases is rendered or adopted.
function driftOrderLine(dir: string, drift: PhaseTailDrift): string {
  const { bin } = shellProfile()
  return (
    `the phase index of round ${roundDirName(drift.round)} differs from config phases: ` +
    `run ${bin} plan ${dir} without --export / --adopt to re-sync it, commit the change, then take the work order again.`
  )
}

// Row 11's open-step refusal: the step's snapshot and resume machinery own
// the phase's index until closeStep; a hand-add under them would bypass both.
function openStepNewTaskLine(dir: string, open: { step: string; unit: string }): string {
  const { bin } = shellProfile()
  const name = open.step === "phase-plan" ? "phase planning" : open.step === "phase-append" ? "task appending" : "phase handover"
  return (
    `the ${name} step of ${open.unit} was interrupted and is not closed out; ` +
    `finish it first (run: ${bin} plan ${dir}), then add the task with --new-task`
  )
}

// The assisted-preparation flags' open-step refusal (plans/0084), rows 14–15:
// returning the loop under the flags would silently ignore them, so the step
// is named instead.
function openStepAssistLine(dir: string, open: { step: string; unit: string }): string {
  const { bin } = shellProfile()
  const name = open.step === "phase-plan" ? "phase planning" : open.step === "phase-append" ? "task appending" : "phase handover"
  return (
    `the ${name} step of ${open.unit} was interrupted and is not closed out; ` +
    `finish it first (run: ${bin} plan ${dir}), then run the preparation flag again`
  )
}

// Rows 12–13's open-step refusal (plans/0076): the same ownership as
// --new-task's — the step owns the phase's index until it closes, and a work
// order rendered or adopted under it would read or close a moving index.
function openStepOrderLine(dir: string, open: { step: string; unit: string }): string {
  const { bin } = shellProfile()
  const name = open.step === "phase-plan" ? "phase planning" : open.step === "phase-append" ? "task appending" : "phase handover"
  return (
    `the ${name} step of ${open.unit} was interrupted and is not closed out; ` +
    `finish it first (run: ${bin} plan ${dir}), then export or adopt the unit`
  )
}

// Row 11's task-less-phase refusal: only the knowledge type gets here (its
// route distills knowledge instead of planning tasks).
function taskLessPhaseLine(dir: string, phase: PhaseUnit): string {
  const { bin } = shellProfile()
  return (
    `${phaseRefText(phase)} holds no tasks (its type, ${phase.type}, distills knowledge instead); ` +
    `--new-task adds a task to a phase that runs them — advance through it with ${bin} run ${dir}`
  )
}

// Row 11's success lines: what was written where, and the review point. The
// document is deliberately minimal, so the review line names it.
function addedLines(dir: string, added: { id: string; index: string; handoverRemoved?: string }): string[] {
  const { bin } = shellProfile()
  return [
    `✓ task ${added.id} added to ${added.index} (no session: --new-task writes it directly)`,
    ...(added.handoverRemoved !== undefined
      ? [`✓ stale handover removed: ${added.handoverRemoved} (the phase is distilled again after the task)`]
      : []),
    `next: review it (sharpen the Goal / Scope / Acceptance of docs/${added.id}/todo.md if needed), then run: ${bin} run ${dir}`,
  ]
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
// Since plans/0084 the stop also renders the AGENTS.md round-preparation
// guidance (the assisted half of this gate) and, when a released analysis's
// roadmap recommends a different phases value for this round, the exact
// amend command — advisory, never blocking: the person follows it before
// committing the setup (the re-run re-establishes under the new value) or
// diverges on purpose.
async function establish(dir: string, round: number, opts: { phases: string; isolate?: string[]; testByDriver?: boolean }, before: string[]): Promise<PlanPrelude> {
  const { bin } = shellProfile()
  const name = roundDirName(round)
  const phases = opts.phases
  const branch = `auto/${name}`
  let isolated: string[] = []
  if (opts.isolate?.length) {
    const result = await isolateRound(dir, opts.isolate, branch)
    if (result.type === "dirty") {
      return stop(2, [
        ...before,
        `⏸ round ${name} cannot open yet: a repository designated by config isolate is not clean, and branch isolation requires clean repositories; ` +
          `handle it manually (commit/clean) and re-run:`,
        ...result.repos.flatMap(({ rel, files }) => [`  ${rel}:`, ...files.map((file) => `    ${file}`)]),
      ])
    }
    if (result.type === "failed") {
      return stop(1, [...before, `branch isolation failed, nothing was written: ${result.error}; fix the repository and re-run: ${bin} plan ${dir}`])
    }
    isolated = result.isolated
  }
  let state: PhaseState | undefined
  try {
    await establishRound(dir, { phases, round })
    state = await readPhases(dir, round)
  } catch (error) {
    return stop(1, [...before, `round establishment failed: ${error instanceof Error ? error.message : String(error)}`])
  }
  const units = state!.phases
  // The isolation line rides both G1 shapes: the round's commits land on the
  // round branch, the original branch never moves.
  const isolatedLine = isolated.length ? [`✓ branch isolation: ${isolated.join(", ")} on ${branch} (the driver's commits land there; the original branch stays untouched)`] : []
  const advice = await roadmapAdvice(dir, round, phases)
  await ensurePointer(dir, { testByDriver: opts.testByDriver, guidance: { kind: "round", round: name } })
  const guideLine = `ℹ AGENTS.md carries this state's preparation guidance for your coding agent (the round brief's sections, and where their content comes from)`
  if (phases === "m") {
    return stop(0, [
      ...before,
      `✓ round ${name} established: single phase ${phaseLabel(units[0]!)}`,
      ...isolatedLine,
      ...(advice ? [advice] : []),
      `next (round-start gate): review the setup and commit it; then list tasks in ${taskIndexPath(units[0]!)} by hand, ` +
        `or run: ${bin} plan ${dir} -p <text> | --file <path>`,
      guideLine,
    ])
  }
  return stop(0, [
    ...before,
    `✓ round ${name} established: ${units.map(phaseLabel).join(", ")}`,
    ...isolatedLine,
    ...(advice ? [advice] : []),
    `next (round-start gate): review the round setup, fill in ${roundBriefPath(round)} (goal, acceptance and release criteria), and commit it; ` +
      `then run: ${bin} plan ${dir} to plan ${phaseRefText(units[0]!)} (or run to plan and execute)`,
    guideLine,
  ])
}

// The roadmap's phases advice for one round (plans/0084): the released
// analysis's `## Roadmap` recommends a phases value for this round; when it
// differs from the config's, the establish stop names the exact amend
// command. Advisory by construction — no released analysis, no line; a
// matching recommendation, no line; the person diverging on purpose simply
// commits the setup as established.
async function roadmapAdvice(dir: string, round: number, phases: string): Promise<string | undefined> {
  const { bin } = shellProfile()
  const raw = await Bun.file(join(dir, ANALYSIS_DOC)).text().catch(() => undefined)
  if (raw === undefined) return undefined
  const recommended = roadmapPhases(raw, round)
  if (recommended === undefined || recommended === phases) return undefined
  return `ℹ the roadmap of ${ANALYSIS_DOC} recommends phases "${recommended}" for this round, config has "${phases}"; to follow it run ${bin} amend ${dir} --phases ${recommended} before committing the setup, then ${bin} plan ${dir} again`
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
  const total = route.plan.tasks.length
  const pending = route.plan.tasks.filter((task) => task.status !== "done").length
  // In m mode input on a non-empty index is an append already (D23), so the
  // pointer is plan's plain input form.
  if (manual) {
    return [`ℹ ${route.plan.index} lists ${total} task(s) (${pending} pending); next: ${bin} run ${dir}, or add tasks with ${bin} plan ${dir} -p <text> | --file <path>`]
  }
  return [
    `ℹ ${phaseRefText(route.phase)} is planned (${pending} of ${total} tasks pending); next: ${bin} run ${dir} ` +
      `— or add tasks with ${bin} plan ${dir} --append -p <text>, or close units with ${bin} close <ref>`,
  ]
}

// Input on a planned phase without --append (row 7): nothing would plan it —
// appending is what the input is for.
function inputUnusedLine(dir: string, route: Extract<PhaseRoute<Plan>, { type: "execute" | "handover" }>): string {
  const { bin } = shellProfile()
  return (
    `${phaseRefText(route.phase)} already lists tasks, so the planning input would not be used; ` +
    `add tasks with ${bin} plan ${dir} --append -p <text> | --file <path>`
  )
}

// m mode with nothing listed and no input (plans/0053 D15).
export function emptyIndexNotice(dir: string, index: string): string[] {
  const { bin } = shellProfile()
  return [`ℹ no tasks listed in ${index} yet: list them there by hand (docs/T-NNN/todo.md per task), or run: ${bin} plan ${dir} -p <text> | --file <path>`]
}

// A planning step that just ran under plan's stop condition (plans/0053 D6,
// D15): what was planned, and the review before run. Phased, the review can
// also edit lines, close a task, or append more (m mode's index is edited by
// hand and its tasks close the same way, so its line stays plain).
export function plannedLines(dir: string, phase: PhaseUnit, ids: readonly string[], manual: boolean): string[] {
  const { bin } = shellProfile()
  const index = taskIndexPath(phase)
  const next = manual
    ? `next: review them, then run: ${bin} run ${dir}`
    : `next: review them (edit, close, or plan --append), then run: ${bin} run ${dir}`
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
  return `next: fill in ## Close of ${roundBriefPath(round)}, commit, then run ${bin} plan ${dir} to open round ${roundDirName(round + 1)}`
}
