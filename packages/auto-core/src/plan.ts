// The plan command's core (plans/0053 D4–D8, D15): the prelude that decides
// every route needing no AI before an agent starts, and the lines plan prints
// where it stops. The prelude runs under the run lock the shell holds, before
// runAll, so it works on the dirty tree a fresh round setup leaves and starts
// no server just to print a notice; it must never import the loop. The loop
// (loop-phase, loop-plan) prints the same stop lines through the helpers here,
// so plan says the same thing wherever it stops.
//
// Pointers to commands that arrive later are left out until they exist:
// `plan --append` and `close` join the execute notice and the planned lines in
// P3b (plans/0053 B3, B5), and the phase-index drift row (3) in P3c.
import { join } from "node:path"
import { roundBriefPath, roundDirName } from "./docpaths"
import { currentPhase, currentRound, establishRound, legacyLayoutProblem, phaseIndexPath, phaseLabel, readPhases, routePhase, type PhaseRoute, type PhaseState, type PhaseUnit } from "./phases"
import type { PlanInput } from "./plan-input"
import { roundCloseLines, roundCloseProblems, type RoundClose } from "./round-close"
import { openStep } from "./resume"
import { shellProfile } from "./shell"
import { loadPlan, qualifiedPhase, taskIndexPath } from "./tasks"

type PlanStop = { type: "stop"; code: number; lines: string[] }
export type PlanPrelude = { type: "loop" } | PlanStop

// The routes the prelude decides, first match wins (plans/0053 D4; rows 3 and
// 10 arrive in P3c and P3b):
//   1. the current round is not established → (G8 of the previous round) + establish, G1 lines;
//   2. the round is complete → G8; pass = establish the next round, fail = exit 2;
//   4. the route is blocked → exit 1;
//   5. an open step record → the loop finishes it first;
//   6. phased, plan or handover → the loop (input: a phase must be left to plan it);
//   7. phased, execute → notice, exit 0 (input: exit 1);
//   8. m mode, empty task index → input: the loop; else a notice;
//   9. m mode, tasks listed → a notice (input: exit 1 until appending exists).
// Input is refused before any write on the round-setup rows (D5).
export async function planPrelude(dir: string, opts: { phases: string; build?: string; input?: PlanInput }): Promise<PlanPrelude> {
  const legacy = await legacyLayoutProblem(dir)
  if (legacy) return stop(1, [legacy])
  const { bin } = shellProfile()
  const manual = opts.phases === "m"
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
  // Row 4.
  if (route.type === "blocked") return stop(1, [`⏸ phase flow blocked: ${route.reason}`])
  // Row 5: the interrupted step is finished first (plans/0018 precedence);
  // the loop decides whether the record still matches the route.
  if (await openStep(dir)) return { type: "loop" }
  if (!manual) {
    // Row 6.
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
    return opts.input ? stop(1, [inputUnusedLine(route, false), ...executeNotice(dir, route, false)]) : stop(0, executeNotice(dir, route, false))
  }
  // Row 8.
  if (route.type === "plan") return opts.input ? { type: "loop" } : stop(0, emptyIndexNotice(dir, route.plan.index))
  // Row 9.
  return opts.input ? stop(1, [inputUnusedLine(route, true), ...executeNotice(dir, route, true)]) : stop(0, executeNotice(dir, route, true))
}

const stop = (code: number, lines: string[]): PlanStop => ({ type: "stop", code, lines })

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
// (plans/0053 D7, D15).
export function executeNotice(dir: string, route: Extract<PhaseRoute, { type: "execute" | "handover" }>, manual: boolean): string[] {
  const { bin } = shellProfile()
  const total = route.plan.tasks.length
  const pending = route.plan.tasks.filter((task) => task.status !== "done").length
  if (manual) return [`ℹ ${route.plan.index} lists ${total} task(s) (${pending} pending); next: ${bin} run ${dir}`]
  return [`ℹ ${phaseRefText(route.phase)} is planned (${pending} of ${total} tasks pending); next: ${bin} run ${dir}`]
}

// Input on a planned phase: nothing would plan it until appending exists.
function inputUnusedLine(route: Extract<PhaseRoute, { type: "execute" | "handover" }>, manual: boolean): string {
  const what = manual ? route.plan.index : phaseRefText(route.phase)
  return `${what} already lists tasks, so the planning input would not be used; appending tasks arrives with plan --append`
}

// m mode with nothing listed and no input (plans/0053 D15).
export function emptyIndexNotice(dir: string, index: string): string[] {
  const { bin } = shellProfile()
  return [`ℹ no tasks listed in ${index} yet: list them there by hand (docs/T-NNN/todo.md per task), or run: ${bin} plan ${dir} -p <text> | --file <path>`]
}

// A planning step that just ran under plan's stop condition (plans/0053 D6,
// D15): what was planned, and the review before run.
export function plannedLines(dir: string, phase: PhaseUnit, ids: readonly string[], manual: boolean): string[] {
  const { bin } = shellProfile()
  const index = taskIndexPath(phase)
  const next = `next: review them, then run: ${bin} run ${dir}`
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
