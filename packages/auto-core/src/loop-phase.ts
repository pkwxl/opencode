// Legacy phase routing for the remaining push planning and task loops.
import { join } from "node:path"
import { roundCompleteLines, roundResolveLines } from "./conclusion"
import { reportForUserPath, roundDirName } from "./docpaths"
import { awaitingFormulation } from "./formulate"
import { closeAuditStopLines, ensureCloseAudit, updateAssuranceBaselines } from "./close-audit"
import { banner, log } from "./log"
import { planWithStep } from "./loop-plan"
import { runTaskLoop, type LoopCtx } from "./loop-task"
import {
  phaseFlowBlockedLine,
  phaseGateProblems,
  phaseGates,
  phaseKey,
  phaseState,
  phaseTitle,
  roundIsOpen,
  routePhase,
  type PhaseUnit,
} from "./phases"
import { appendInputRetiredLine, emptyIndexNotice, executeNotice, logGateStop, openRoundEmptyLines, openRoundWrapLines, phaseBoundaryLines, retiredAppendResumeLine, roundCompleteNext } from "./plan"
import { readPlanInput } from "./plan-input"
import { roundCloseLines, roundCloseProblems } from "./round-close"
import { closeStep, openStep } from "./resume"
import { shellProfile, surfaceOf } from "./shell"
import { statsPhase } from "./stats"
import { loadPlan, resetPlanning } from "./tasks"

// Keep the historical loop-phase exports for callers of these shared boundary actions.
export { installApprovedBrief, logGateStop } from "./plan"

// Whether run's boundary-stop shape is in force (plans/0101 D1): plain run
// with --boundary not restoring the flow. A stop condition in force (plan's
// "execute", transfer's "formulate") runs its own grammar and never this
// stop; the lane worker never routes phases.
const boundaryHolds = (opts: LoopCtx["opts"]): boolean => opts.stopBefore === undefined && opts.boundary !== "flow" && opts.lane === undefined

// Run's tail since plans/0101 D1: the run ends at the current phase's clean
// end, before the handover distillation. The human gate is checked first,
// ahead of any session spending its tokens: a survey with open forks stops
// exit 2 in today's awaiting shape (F10's discipline unchanged — the person
// learns of the forks from the run itself), and the distillation waits for
// the release on the transfer side. Any other gate (verdict, acceptance) is
// the handover path's own, checked after the distillation inside transfer's
// advance — never run's.
async function boundaryStop(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const gates = phaseGates(phase, ctx.opts.acceptanceGate)
  if (gates.includes("human")) {
    const problems = await phaseGateProblems(ctx.directory, phase, ["human"])
    if (problems.length) {
      await logGateStop(ctx.directory, phase, problems, undefined)
      return 2
    }
  }
  for (const line of await phaseBoundaryLines(ctx.directory, phase)) log(line)
  return 0
}

export async function runPhaseLoop(ctx: LoopCtx): Promise<number> {
  try {
    return await phaseLoop(ctx)
  } finally {
    // plan's input backstop (plans/0053 D8): the prelude refuses an input no
    // phase would take, so this fires only where the loop stopped short of a
    // planning step (a gate, a block, a phase whose tasks were listed by hand).
    if (ctx.input) log("⚠ the planning input was not used: no planning step ran on it, so it was not saved; pass it again to a later plan")
  }
}

async function phaseLoop(ctx: LoopCtx): Promise<number> {
  const { directory, opts } = ctx
  for (;;) {
    const route = await routePhase(directory, { loadPlan, bin: shellProfile().bin, phases: ctx.phases })
    if (route.type === "blocked") {
      log(phaseFlowBlockedLine(route.reason))
      return 1
    }
    if (route.type === "complete") {
      log("✓ all phases complete")
      for (const line of await roundResolveLines(directory)) log(line)
      // the round-complete line (plans/0019 §F, T-006): the phase count is
      // the phase index's done count (this round's already-handed-over
      // phases); the cumulative across-rounds segment is appended by the
      // constructor itself when history.rounds > 0.
      const state = await phaseState(directory)
      const lines = await roundCompleteLines(directory, { phaseCount: state.done.size })
      if (lines) for (const line of lines) log(line)
      // Round-close report (plans/0049 G8, anchor a): the checks the next
      // round's start enforces, reported on every complete run; the exit code
      // is unaffected — for run and plan. transfer (plans/0101 D2 shape 3)
      // is the one command that performs the round close: the checks gate
      // its stop (exit 2 naming them), and the passing stop is the person's
      // moment with the round's close before the next round opens. The
      // formulate stop is transfer's advance alone (its only caller), so the
      // close-audit construction (plans/0244 D5) rides this branch: a
      // non-empty close-due set without receipts constructs the unit before
      // the close may land, the refusal teaching its execution; the green
      // cover set's baseline citations (the table stays the single memory)
      // land on their own commit before the stop.
      const { bin } = shellProfile()
      const close = await roundCloseProblems(directory, state.round, { build: opts.build, scanExempt: opts.scanExempt })
      if (opts.stopBefore === "formulate") {
        const audit = await ensureCloseAudit(directory, state.round)
        for (const line of closeAuditStopLines(audit)) log(line)
        const gated = audit.type === "constructed" ? await roundCloseProblems(directory, state.round, { build: opts.build, scanExempt: opts.scanExempt }) : close
        if (gated.problems.length) {
          log(`⏸ round ${roundDirName(state.round)} does not pass its round-close checks, so it cannot close yet — fix them, commit, then re-run: ${bin} transfer ${directory}`)
          for (const line of roundCloseLines(gated, "transfer")) log(line)
          return 2
        }
        for (const line of await updateAssuranceBaselines(directory, state.round)) log(line)
        for (const line of roundCloseLines(gated)) log(line)
        // The close listing is the review act; a report names itself only
        // when one was written (plans/0109 D5 — the report is optional).
        const reportText = (await Bun.file(join(directory, reportForUserPath(state.round))).text().catch(() => "")).trim()
        log(
          `next: review round ${roundDirName(state.round)}'s close (its round.md \`## Close\` listing${reportText ? `, its report ${reportForUserPath(state.round)}` : ""}), ` +
            `then open the next round with: ${bin} transfer ${directory}`,
        )
        return 0
      }
      for (const line of roundCloseLines(close)) log(line)
      // plan does not open the next round here (plans/0053 D8): the round's
      // ## Close cannot be filled in yet, so the round-close checks would fail.
      if (opts.stopBefore === "execute") log(roundCompleteNext(directory, state.round))
      else if (boundaryHolds(opts)) {
        // m mode keeps plan's next-round pointer (plans/0101 D8: transfer
        // refuses m mode, and the next round opens on the next plan) — the
        // same helper the stopBefore arm above prints.
        if (ctx.manual) log(roundCompleteNext(directory, state.round))
        else log(`next: the round is complete — close it with: ${bin} transfer ${directory}`)
      }
      return 0
    }
    // the phase-switch hook point (plans/0019 §E): a change of the
    // phase-qualified id resets the phase bucket; the same id is idempotent.
    // blocked has already returned and complete is about to exit, neither
    // needs the switch.
    await statsPhase(directory, phaseKey(route.phase).id)
    // Keep a retired handover record available for deterministic transfer.
    const open = await openStep(directory)
    if (open?.step === "phase-append") {
      log(retiredAppendResumeLine(open.unit))
      return 2
    }
    if (open?.step === "phase-plan") {
      const state = await phaseState(directory)
      const owner = state.phases.find((unit) => phaseKey(unit).id === open.unit)
      await closeStep(directory, open.step, open.unit)
      if (!owner || !state.done.has(owner.id)) {
        log(`↻ unclosed planning resume point (${open.unit}) predates the formulation task (plans/0095); closing it and clearing its partial output — the phase plans again as its first task unit`)
        if (owner) await resetPlanning(directory, owner)
      }
    } else if (open?.step === "phase-handover") {
      log(`⏸ interrupted handover ${open.unit} needs review. Recover it with ${surfaceOf().transfer(directory)}.`)
      return 2
    }
    const openRound = !ctx.manual && (await roundIsOpen(directory))
    if (ctx.input !== undefined && (openRound || (ctx.manual && route.type !== "plan"))) {
      log(appendInputRetiredLine(directory))
      ctx.input = undefined
      return 1
    }
    // An open round (plans/0243 B) rides m mode's never-closing semantics
    // scoped to the round kind: no formulation constructs, no handover, no
    // boundary stop. With the index empty the run teaches the open channels;
    // with every task done it wraps up — exit 0, the phase stays open — and
    // the person's channels are absorbing more work or closing at ## Close.
    // The execute route (pending work) falls through to the task loop below
    // like any phase's.
    if (openRound && route.type !== "execute") {
      if (route.type === "plan") {
        for (const line of await openRoundEmptyLines(directory, route.plan.index)) log(line)
        return 0
      }
      log("✓ all tasks complete")
      // the round proxy-answer summary (m mode's wrap-up arm prints it too):
      // pinned above the open-round notice.
      for (const line of await roundResolveLines(directory)) log(line)
      for (const line of await openRoundWrapLines(directory)) log(line)
      return 0
    }
    // manual mode (no phases): with no task to run it wraps up — an empty
    // task index prompts a fill-in, all tasks complete prints the
    // round-complete line; both exit 0 with the phase left incomplete. A
    // planning input this run was handed (ctx.input), or one the phase
    // already holds persisted, is the exception: m mode then plans as a
    // phase does (plans/0053 D12 — the persisted-input half is plans/0095's
    // routing unification; before it only an open step reached the planner).
    if (ctx.manual && route.type !== "execute" && !(route.type === "plan" && (ctx.input || (await readPlanInput(directory, route.phase))?.trim()))) {
      if (route.type === "plan") {
        for (const line of emptyIndexNotice(directory, route.plan.index)) log(line)
        return 0
      }
      log("✓ all tasks complete")
      // the round proxy-answer summary (plans/0020-auto-resolve-design.md
      // §H-③, H6): pinned above the ■ round line.
      for (const line of await roundResolveLines(directory)) log(line)
      // the round-complete line on the unphased path (plans/0019 §F,
      // T-006): the phase bucket is always the "m" pseudo phase, so the phase
      // segment is omitted.
      const lines = await roundCompleteLines(directory)
      if (lines) for (const line of lines) log(line)
      return 0
    }
    if (route.type === "plan") {
      // The retired knowledge phase has no session work.
      if (!route.phase.entry.hasTasks) {
        banner(`${phaseTitle(route.phase)} phase: no session (the knowledge extraction retired, plans/0283)`)
        return await boundaryStop(ctx, route.phase)
      }
      banner(`${phaseTitle(route.phase)} phase planning`)
      const code = await planWithStep(ctx, route.phase)
      // A stop condition in force (plans/0053 D6; transfer's, plans/0101
      // D2/D3): a planning step that succeeded is where the command stops —
      // plan after the formulation session, transfer at the construction's
      // review stop inside it.
      if (code !== 0 || opts.stopBefore !== undefined) return code
      continue
    }
    if (route.type === "execute") {
      // A stop condition in force (plans/0053 D6, D7): an execute route this
      // run did not plan (planning stops the run itself), e.g. a next phase
      // whose tasks were listed by hand. The one exception (plans/0095 D4):
      // a phase whose remaining work holds its formulation task is still
      // planning — plan dispatches the reviewed todo (finishing what it
      // started: an interrupted formulation runs to completion here, the
      // task-pipeline re-entry of the former openStep precedence), and
      // transfer (plans/0101 D2) re-enters the same step for the idempotent
      // reconstruct, ending at its review stop. The predicate is the shared
      // awaiting one (plans/0101 D4): wherever the todo sits in the index —
      // beside hand-added tasks too — it is the dispatch's target.
      if (opts.stopBefore !== undefined) {
        if (awaitingFormulation(route.plan.tasks, route.phase) !== undefined) {
          banner(`${phaseTitle(route.phase)} phase planning`)
          return await planWithStep(ctx, route.phase)
        }
        if (opts.stopBefore === "execute") {
          for (const line of executeNotice(directory, route, ctx.manual)) log(line)
          return ctx.input ? 1 : 0
        }
        // transfer's backstop — its own pre-check refuses this state before
        // runAll starts: execute work pending belongs to run.
        for (const line of executeNotice(directory, route, ctx.manual)) log(line)
        log(`⏸ transfer does not execute tasks — run: ${shellProfile().bin} run ${directory}`)
        return 2
      }
      const code = await runTaskLoop(ctx, route.phase)
      // --stop-after (plans/0128): the target task closed — the run ends
      // here, before the phase close-out runTaskLoop's plain 0 would route.
      if (code !== 0 || ctx.stopAfterDone) return code
      continue
    }
    return await boundaryStop(ctx, route.phase)
  }
}
