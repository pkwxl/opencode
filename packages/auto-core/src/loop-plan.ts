// Phase planning: the planning session (planPhase) and its step wrapper
// (planWithStep), moved out of src/loop-phase.ts (plans/0053 A2). It is the
// one planner: m mode plans here too (A4, D12). The module keeps itself
// under 600 lines. See plan-gate.ts for planning helpers and
// formulate-parts.ts for formulation source assembly.
// Direction: loop-phase → loop-plan → plan-gate/formulate-parts/loop-task.
import { dirname, join } from "node:path"
import { roundDeltaBlock } from "./assurance"
import { projectBriefText } from "./brief"
import { awaitingFormulation, constructFormulation, formulationAcceptance, formulationNumber } from "./formulate"
import { formulationParts, previewFormulationDocument } from "./formulate-parts"
import { floorDigest } from "./formulate-synthesis"
import { dirtyStopLines, log, unreadableStopLines } from "./log"
import { runSerialUnit, type LoopCtx } from "./loop-task"
import { taskNumber, taskNumberFloor } from "./numbering"
import { currentRound, phaseTitle, type PhaseUnit } from "./phases"
import { roundBriefPath } from "./docpaths"
import { plannedLines } from "./plan"
import { charterPhaseEntry, planFacts } from "./plan-gate"
import { planInputPath, readPlanInput, savePlanInput } from "./plan-input"
import { existingTaskList, renderFormulationTodo } from "./prompt-plan"
import { roundBriefText } from "./round-brief"
import { shellProfile } from "./shell"
import { stepPause } from "./step"
import { loadPlan, qualifiedPhase, taskIndexPath, taskStatePaths, unitSynthDigest } from "./tasks"
import { parseUnitDoc } from "./document/unit"

// The phase's formulation step (plans/0095 D1): construct the formulation
// task — the phase's first task unit, its todo the single synthesized input —
// and run it through the ordinary serial unit path (runSerialUnit: the
// whole-task session, the mechanical collect, the wrap-up verification over
// the charter-as-acceptance, the terminal commit). The bypass planning
// session, the PLAN pseudo task and the phase-plan step record retired with
// it; an interrupted formulation task resumes as any task (the recovery
// ladder), and plan's stop condition still stops after it — the completed
// plan is its review point. m mode plans on the same step (plans/0053 D12's
// rule kept: a planning input is required), the formulation task of the
// implicit P01-implement.
// Returns 0 = the formulation task completed (the phase's tasks are written
// and verified), 1 = m mode with no planning input, 2 = blocked.
async function planPhase(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const { directory, opts } = ctx
  // The phase loop routes m mode here only with an input, new or persisted;
  // checked first, so a missing one stops the step before anything is
  // written.
  if (ctx.manual && !ctx.input && !(await readPlanInput(directory, phase))?.trim()) {
    log(`⏸ nothing to plan ${phaseTitle(phase)} against: m-mode planning plans against a planning input, and ${planInputPath(phase)} is missing or empty`)
    return 1
  }
  // auto numbering (config.autoNumber): the next number is derived from the
  // surviving task artifacts at each allocation (the deterministic floor,
  // src/numbering.ts — no record, no restore session since plans/0150), so
  // nothing runs here ahead of construction.
  // The planning input (plans/0053 D9), unchanged: a new text is persisted to
  // the phase's plan-input.md and committed on its own before construction;
  // without one the step plans against the persisted file. A changed input
  // re-renders a different todo, which construction's rewrite-on-diff lands —
  // the restart channel of the bypass era, folded into idempotence.
  if (ctx.input) {
    const saved = await savePlanInput(directory, phase, ctx.input, phaseTitle(phase))
    if (saved.type === "dirty") {
      for (const line of dirtyStopLines("worktree not clean before saving the planning input", saved.files)) log(line)
      return 2
    }
    if (saved.type === "failed") {
      log(`⏸ ${saved.question}`)
      return 2
    }
    ctx.input = undefined
    if (saved.type === "saved") {
      log(`✓ planning input saved to ${planInputPath(phase)}`)
    }
  }
  const input = (await readPlanInput(directory, phase))?.trim() || undefined
  if (input) log(`ℹ planning against the persisted input ${planInputPath(phase)}`)
  // The project brief (plans/0052 D9), comments stripped: an untouched stub injects nothing.
  const brief = await projectBriefText(directory)
  const taskIndex = taskIndexPath(phase)
  const phaseId = qualifiedPhase(phase)
  const parts = ctx.manual ? undefined : await formulationParts(ctx, phase)
  const facts = planFacts(ctx)
  const charter = formulationAcceptance(facts, charterPhaseEntry(ctx, phase))
  // The standing formulation and the review-seam prefix (plans/0205 D2):
  // while the standing todo has never been dispatched (pending), every
  // other row of the index arrived through `plan --new-task` or a person's
  // commit — those rows are the formulation's fixed prefix, rendered into
  // the todo and planned around. A ran (blocked) formulation keeps a
  // row-blind prefix instead: its extra rows may be its own session's
  // never-collected output, which the re-dispatch must be free to rewrite
  // (plans/0141 D2), so the prefix reads back from the landed todo's own
  // `Prefix:` field — the rows the todo was constructed beside, never the
  // session's output. A fresh construction has no prefix (the constructor
  // only writes an empty phase).
  const standingPlan = await loadPlan(directory, phase).catch(() => undefined)
  const standing = standingPlan === undefined ? undefined : awaitingFormulation(standingPlan.tasks, phase)
  const landedText =
    standing === undefined ? undefined : await Bun.file(join(directory, taskStatePaths(standing.id).pending)).text().catch(() => undefined)
  const landedFields = landedText === undefined ? {} : parseUnitDoc(landedText).fields
  const review = standing !== undefined && standing.status === "pending"
  const prefixIds = review
    ? standingPlan!.tasks.filter((task) => task.id !== standing!.id).map((task) => task.id)
    : (landedFields.prefix ?? "").split(/[\s,]+/).filter(Boolean)
  const existingTasks = prefixIds.length && standingPlan !== undefined
    ? existingTaskList(
        standingPlan.tasks
          .filter((task) => prefixIds.includes(task.id))
          .map((task) => ({ id: task.id, title: task.title, status: task.status })),
      )
    : undefined
  // The numbering start (plans/0205 D2): past the prefix. The review state
  // takes the deterministic floor — the same derivation addTask allocates
  // from (taskNumberFloor), so the taught start and a hand-add's allocation
  // share one rule and the taught number can never be one the add already
  // took (the finding's collision, impossible by construction). A ran
  // formulation keeps max(its own number, the recorded prefix) + 1 — past
  // the person's rows, its session's rows left re-takeable. A fresh
  // construction keeps the formulation number + 1 (the floor the unit
  // itself is about to occupy, + 1 — nothing runs between the two,
  // plans/0097 D6's own premise).
  const numberStart = review
    ? await taskNumberFloor(directory)
    : standing !== undefined && prefixIds.length
      ? Math.max(taskNumber(standing.id) ?? 0, ...prefixIds.map((id) => taskNumber(id) ?? 0)) + 1
      : (await formulationNumber(directory, phase)) + 1
  // The measured delta appears in the todo but stays outside the floor digest.
  const delta = await roundDeltaBlock(directory, ctx.manual ? await currentRound(directory) : parts!.state.round)
  const baseInput = ctx.manual
    ? {
        phaseId,
        taskIndex,
        numberStart,
        brief,
        input: input!,
        inputPath: planInputPath(phase),
        mode: opts.mode,
        parallel: opts.parallel,
        maxSessions: opts.maxSessions,
        ...(delta ? { delta } : {}),
        charter,
        ...(existingTasks ? { existingTasks } : {}),
      }
    : {
        phase: phase.entry,
        phaseId,
        taskIndex,
        numberStart,
        brief,
        round: parts!.round,
        analysis: parts!.analysis,
        input,
        inputPath: planInputPath(phase),
        handovers: parts!.handovers,
        prevRound: parts!.prevRound,
        mode: opts.mode,
        // No analysis/design phase delivered in this round's index → the
        // implement phase's planning gets the pipeline-trimming note.
        trimmedPhases: parts!.trimmedPhases,
        parallel: opts.parallel,
        maxSessions: opts.maxSessions,
        testByDriver: opts.testByDriver,
        ...(delta ? { delta } : {}),
        charter,
        ...(existingTasks ? { existingTasks } : {}),
      }
  // The digest excludes the measured delta because construction itself moves
  // the tree. Including the delta would miss the digest keep on every rerun.
  const floorTodo = renderFormulationTodo(facts, baseInput)
  const digest = floorDigest(previewFormulationDocument(renderFormulationTodo(facts, { ...baseInput, delta: undefined }), phaseId, prefixIds.length ? prefixIds : undefined))
  // Keep existing synthesized todos when their floor still matches. Older
  // todos can carry the digest in the local units record.
  let keepsLandedTodo = false
  if (standing && landedText !== undefined) {
    const recorded = landedFields["floor-digest"] || await unitSynthDigest(directory, standing.id)
    keepsLandedTodo = recorded === digest
  }
  // The dispatch discipline (plans/0101 D4): plan dispatches the reviewed
  // todo exactly as constructed. A standing todo whose floor moved — an
  // input edited since the review stop, through the document or a
  // re-passed -p the prelude cannot see — is transfer's idempotent
  // reconstruct, and plan never rewrites what a person may be reviewing;
  // the refusal names the re-run (the reconstruct lands the new todo and
  // stops for review again). A fresh construction under the stop
  // condition is the loop's own continuation shape (m mode, the
  // open-step recovery), unchanged.
  if (opts.stopBefore === "execute" && !ctx.manual && standing && !keepsLandedTodo) {
    const { bin } = shellProfile()
    log(
      `⏸ the reviewed plan task of ${phaseTitle(phase)} no longer matches its inputs — an input changed since construction; ` +
        `the reconstruct is transfer's: re-run: ${bin} transfer ${directory}`,
    )
    return 1
  }
  // Construction books the floor and its review prefix. A digest hit
  // keeps the previously landed text byte for byte.
  let id: string
  if (standing && keepsLandedTodo) {
    id = standing.id
    log(`✓ the landed formulation todo of ${id} stands — the floor assembly is unchanged (plans/0097 D6)`)
  } else {
    const landed = await constructFormulation(directory, phase, floorTodo, {
      digest,
      ...(prefixIds.length ? { prefix: prefixIds } : {}),
    })
    if (landed.type === "dirty" || landed.type === "unreadable") {
      // The unreadable arm (plans/0236 D4) teaches investigation, never
      // commit/clean.
      for (const line of landed.type === "unreadable"
        ? unreadableStopLines("the repository state cannot be read before constructing the formulation task", landed.files)
        : dirtyStopLines("worktree not clean before constructing the formulation task", landed.files)) log(line)
      return 2
    }
    if (landed.type === "failed") {
      log(`⏸ ${landed.question}`)
      return 2
    }
    id = landed.id
    log(`✓ formulation task ${landed.id} ${landed.type === "constructed" ? "constructed" : "current"}: its todo is the planning session's single input (docs/${landed.id}/todo.md)`)
  }
  // transfer's review stop (plans/0101 D2/D3): construction is the
  // advance's last write — the formulation session's dispatch is plan's
  // (the reviewed todo is the seam between the two commands), so under
  // stopBefore "formulate" the step ends here, exit 0 with the todo
  // named. A rejected todo is fixed through its inputs by re-running
  // transfer: construction is idempotent rewrite-on-diff (plans/0095),
  // and the digest-keep above preserves a pending todo whose floor is
  // unchanged (plans/0097 D6). The stop names any existing prompt audit
  // and the round-brief duty: a round.md still the
  // untouched stub says so, the fill and the re-run the answer (the
  // reconstruct absorbs it; plan's dispatch refuses on a stub).
  if (opts.stopBefore === "formulate") {
    const { bin } = shellProfile()
    log(
      `⏸ review stop: the formulation todo of ${id} (docs/${id}/todo.md — driver-owned, fix its inputs, never the todo) awaits your review`,
    )
    const audit = join(dirname(phase.dir), "prompt-audit.md")
    if (await Bun.file(join(directory, audit)).exists()) {
      log(`ℹ the construction's records sit beside it in ${audit}`)
    }
    const round = await currentRound(directory)
    if (!(await roundBriefText(directory, round))) {
      log(
        `⚠ the round brief ${roundBriefPath(round)} is still the untouched stub — the todo rendered against no round goals; fill it in ` +
          `(## Goal, ## Acceptance criteria, ## Release criteria), commit, and re-run: ${bin} transfer ${directory} ` +
          `(the reconstruct absorbs it; plan refuses to dispatch while it stays a stub)`,
      )
    }
    log(
      `next: dispatch it with ${bin} plan ${directory} (the formulation session runs, the batch review follows), or fix the inputs ` +
        `(${roundBriefPath(round)}, ${planInputPath(phase)}, the project brief, the roadmap line) and re-run: ${bin} transfer ${directory}`,
    )
    return 0
  }
  // The formulation task runs as the phase's first ordinary unit — the
  // serial path by design (plans/0095 D5: a phase's only ready unit, its
  // Touches everything, ahead of everything it plans).
  const plan = await loadPlan(directory, phase)
  const task = plan.tasks.find((entry) => entry.id === id)
  if (!task) {
    log(`⏸ the constructed formulation task ${id} is not listed in ${taskIndex}; investigate and re-run`)
    return 2
  }
  const code = await runSerialUnit(ctx, phase, plan, task)
  if (code !== 0) return code
  // plan's summary lists the planned batch (the index after the
  // formulation unit) — the formulation task itself is machinery.
  const fresh = await loadPlan(directory, phase)
  ctx.planned = fresh.tasks.filter((entry) => entry.formulate === undefined).map((entry) => entry.id)
  log(`✓ phase planning complete: ${taskIndex} lists ${ctx.planned.length} task(s)`)
  return 0
}

// Phase planning plus the plan-review pause (plans/0049 G5): at
// OPENCODE_AUTO_STEP ≥ phase the run holds after the planning commit, before
// the first task, so tasks.md and the task documents can be reviewed; /exit
// takes effect at the same point. Under plan's stop condition (plans/0053 D6)
// the run ends here instead, and that stop is the review point: the summary
// replaces the pause, and the caller returns.
export async function planWithStep(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const code = await planPhase(ctx, phase)
  if (code !== 0) return code
  if (ctx.opts.stopBefore === "execute") {
    for (const line of plannedLines(ctx.directory, phase, ctx.planned ?? [], ctx.manual)) log(line)
    return 0
  }
  await stepPause("phase", `phase ${phaseTitle(phase)} planning`, { interactive: ctx.repl, dir: ctx.directory })
  // /exit checkpoint (phase boundary): the request flag lives in the run's
  // control service on ctx, as the router state does.
  ctx.control.maybeExit("phase", `phase ${phaseTitle(phase)} planning`)
  return 0
}
