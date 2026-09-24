// The plan command's core (plans/0053 D4–D8, D15, D23, D26, D34): the prelude
// that decides every route needing no AI before an agent starts, and the lines
// plan prints where it stops. The prelude runs under the run lock the shell
// holds, before runAll, so it works on the dirty tree a fresh round setup
// leaves and starts no server just to print a notice; it must never import the
// loop. The loop (loop-phase, loop-plan) prints the same stop lines through the
// helpers here, so plan says the same thing wherever it stops.
//
// Pointer texts name the lifecycle commands that exist (plans/0053 D29).
import { join } from "node:path"
import { roundBriefPath, roundDirName } from "./docpaths"
import {
  currentPhase,
  currentRound,
  establishRound,
  legacyLayoutProblem,
  phaseIndexPath,
  phaseLabel,
  phaseTailDrift,
  readPhases,
  routePhase,
  syncPhaseIndex,
  type PhaseRoute,
  type PhaseState,
  type PhaseTailDrift,
  type PhaseUnit,
} from "./phases"
import type { PlanInput } from "./plan-input"
import { roundCloseLines, roundCloseProblems, type RoundClose } from "./round-close"
import { openStep, peekProgress } from "./resume"
import { shellProfile } from "./shell"
import { loadPlan, qualifiedPhase, taskIndexPath, taskStatePaths } from "./tasks"

type PlanStop = { type: "stop"; code: number; lines: string[] }
export type PlanPrelude = { type: "loop" } | PlanStop

// The routes the prelude decides, first match wins (plans/0053 D4):
//   1. the current round is not established → (G8 of the previous round) + establish, G1 lines;
//   2. the round is complete → G8; pass = establish the next round, fail = exit 2;
//   3. the round's phase index drifted from the phases value → re-sync the
//      unstarted tail (uncommitted), stop for review;
//   4. the route is blocked → exit 1;
//   5. an open step record → the loop finishes it first;
//   6. phased, plan or handover without --append → the loop (input: a phase must be left to plan it);
//   7. phased, execute without --append → notice, exit 0 (input: exit 1);
//   8. m mode, empty task index → input: the loop; else a notice;
//   9. m mode, tasks listed → input: the loop (an append, D23; --append implied, the flag redundant); else a notice;
//  10. phased, --append on execute or handover → the loop (an append to the phase the route names now, D23).
// Input is refused before any write on the round-setup rows (D5, rows 1–3);
// rows 9 and 10 apply the progress-record guard (D26); --append without input
// is a usage error everywhere.
export async function planPrelude(dir: string, opts: { phases: string; build?: string; input?: PlanInput; append?: boolean }): Promise<PlanPrelude> {
  const legacy = await legacyLayoutProblem(dir)
  if (legacy) return stop(1, [legacy])
  const { bin } = shellProfile()
  const manual = opts.phases === "m"
  // --append without input is a usage error (D23): appending adds the tasks
  // planned from the input. The shell checks this before the lock; this
  // backstops other shells and direct callers, before any route logic.
  if (opts.append && !opts.input) {
    return stop(1, [
      `--append requires a planning input: pass one with ${bin} plan ${dir} -p <text> | --file <path> — appending adds the tasks planned from the input to the current phase`,
    ])
  }
  const round = await currentRound(dir)
  // Row 1: no docs/R-NN/, or its phase index is missing (an interrupted
  // round start, plans/0049 G6).
  if (!(await Bun.file(join(dir, phaseIndexPath(round))).exists())) {
    if (opts.input) {
      return stop(1, [
        `round ${roundDirName(round)} is not established yet: run ${bin} plan ${dir} without input to establish it, commit the setup, then pass the input.`,
      ])
    }
    const lines: string[] = []
    if (round > 1) {
      const previous = await previousRoundClose(dir, round - 1, opts.build)
      if (previous.type === "stop") return previous
      lines.push(...previous.lines)
    }
    return establish(dir, round, opts.phases, lines)
  }
  const route = await routePhase(dir)
  // Row 2: m mode never gets here (its single phase stays open).
  if (route.type === "complete") {
    const next = roundDirName(round + 1)
    if (opts.input) {
      return stop(1, [
        `round ${roundDirName(round)} is complete and round ${next} is not established yet: ` +
          `run ${bin} plan ${dir} without input to establish it, commit the setup, then pass the input.`,
      ])
    }
    const close = await roundCloseProblems(dir, round, { build: opts.build })
    if (close.problems.length) return stop(2, closeRefusal(dir, round, close))
    return establish(dir, round + 1, opts.phases, roundCloseLines(close))
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
    try {
      await syncPhaseIndex(dir, round, opts.phases)
    } catch (error) {
      return stop(1, [`phase-index re-sync failed: ${error instanceof Error ? error.message : String(error)}`])
    }
    return stop(0, [resyncLine(dir, drift)])
  }
  // Row 4.
  if (route.type === "blocked") return stop(1, [`⏸ phase flow blocked: ${route.reason}`])
  // Row 5: the interrupted step is finished first (plans/0018 precedence);
  // the loop decides whether the record still matches the route.
  if (await openStep(dir)) return { type: "loop" }
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
async function previousRoundClose(dir: string, round: number, build: string | undefined): Promise<{ type: "pass"; lines: string[] } | PlanStop> {
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
  const close = await roundCloseProblems(dir, round, { build })
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

// Establish a round (no AI, left uncommitted for the round-start gate G1)
// and print the G1 lines (plans/0053 D15).
async function establish(dir: string, round: number, phases: string, before: string[]): Promise<PlanPrelude> {
  const { bin } = shellProfile()
  let state: PhaseState | undefined
  try {
    await establishRound(dir, { phases, round })
    state = await readPhases(dir, round)
  } catch (error) {
    return stop(1, [...before, `round establishment failed: ${error instanceof Error ? error.message : String(error)}`])
  }
  const units = state!.phases
  const name = roundDirName(round)
  if (phases === "m") {
    return stop(0, [
      ...before,
      `✓ round ${name} established: single phase ${phaseLabel(units[0]!)}`,
      `next (round-start gate): review the setup and commit it; then list tasks in ${taskIndexPath(units[0]!)} by hand, ` +
        `or run: ${bin} plan ${dir} -p <text> | --file <path>`,
    ])
  }
  return stop(0, [
    ...before,
    `✓ round ${name} established: ${units.map(phaseLabel).join(", ")}`,
    `next (round-start gate): review the round setup, fill in ${roundBriefPath(round)} (goal, acceptance and release criteria), and commit it; ` +
      `then run: ${bin} plan ${dir} to plan ${phaseRefText(units[0]!)} (or run to plan and execute)`,
  ])
}

// The phase a planning input would be planned into on a phased plan or
// handover route: the current phase when it plans tasks, otherwise the first
// phase the loop reaches after handing it over, passing task-less
// (knowledge) phases the way the loop does. listed = its task index already
// lists tasks, so the loop would stop on its execute route instead.
async function planTarget(dir: string, route: Extract<PhaseRoute, { type: "plan" | "handover" }>): Promise<{ phase: PhaseUnit; listed: boolean } | undefined> {
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
export function executeNotice(dir: string, route: Extract<PhaseRoute, { type: "execute" | "handover" }>, manual: boolean): string[] {
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
function inputUnusedLine(dir: string, route: Extract<PhaseRoute, { type: "execute" | "handover" }>): string {
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
