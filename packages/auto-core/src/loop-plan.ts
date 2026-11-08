// Phase planning: the planning session (planPhase) and its step wrapper
// (planWithStep), moved out of src/loop-phase.ts (plans/0053 A2). It is the
// one planner: m mode plans here too (A4, D12). The module keeps itself
// under 600 lines — the size promise its header has carried since 0053 A2,
// honored by plans/0235's split: the append step lives in src/loop-append.ts
// (plans/0053 D23–D25), the plan-step gate both planning sessions pass in
// src/plan-gate.ts (plans/0080 §5), the formulation composition state in
// src/formulate-parts.ts (plans/0097 D3). Direction: loop-phase → loop-plan
// → plan-gate/formulate-parts/loop-task; never imports loop-phase, loop or
// loop-append.
import { dirname, join } from "node:path"
import type { BlockMapEntry } from "./blockage"
import { BRIEF_FILE, projectBriefText } from "./brief"
import { awaitingFormulation, constructFormulation, formulationAcceptance, formulationNumber, standingFormulation } from "./formulate"
import { floorBlocks, formulationParts, previewFormulationDocument, readFormulationSources } from "./formulate-parts"
import { floorDigest, protocolFrameText, renderLedger, synthesizeFormulation, type LedgerSource } from "./formulate-synthesis"
import { PromptGuaranteeError, resolvedVerifyPlan, verifyPlanCharterText } from "./intent/guarantees"
import { dirtyStopLines, log, unreadableStopLines } from "./log"
import { runSerialUnit, type LoopCtx } from "./loop-task"
import { taskNumber, taskNumberFloor } from "./numbering"
import { REQUIRED_TYPE, phaseType } from "./phases/registry"
import { currentRound, phaseKey, phaseTitle, type PhaseUnit } from "./phases"
import { ANALYSIS_DOC, roundBriefPath } from "./docpaths"
import { plannedLines } from "./plan"
import { admissionWarn, charterPhaseEntry, planDuties, planFacts, recordSynthesisAudit, verifyPlanStep } from "./plan-gate"
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
  const { directory, opts, server: serverHandle } = ctx
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
    const text = ctx.input.text
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
      // The admission warn (plans/0082 §10 D14b): the same charter check over
      // the person's text, warn-and-record, never refuse.
      await admissionWarn(ctx, phase, text, `formulation ${phaseKey(phase).id}`)
    }
  }
  let input = (await readPlanInput(directory, phase))?.trim() || undefined
  if (input) log(`ℹ planning against the persisted input ${planInputPath(phase)}`)
  // The project brief (plans/0052 D9), comments stripped: an untouched stub injects nothing.
  let brief = await projectBriefText(directory)
  const taskIndex = taskIndexPath(phase)
  const phaseId = qualifiedPhase(phase)
  // The phase's composition state (plans/0097 D3): the phased gathering —
  // handovers (per document, for the synthesis source list), the
  // first-planning-session digest block, the round brief, the approved
  // analysis, the final-phase report duty — read once; both the floor and
  // the synthesis compose from the same parts. m mode has none of it.
  // (The split, plans/0208 D2: the booking half — the digest texts, the cap
  // decision, the one statsDigest booking — plus the driver-exclusive phase
  // state and its trimmedPhases derivation stay an entry-time read; the
  // side-effect-free sources the remediation executor can rewrite are
  // freshened per pass below.)
  const parts = ctx.manual ? undefined : await formulationParts(ctx, phase)
  // The remediable sources re-read before every compose pass (plans/0156
  // D4, its captured set corrected by plans/0208 D2): the remediation
  // executor can rewrite the planning input (its planning-input channel,
  // src/blockage-execute.ts), the brief (its protect-passing write), and
  // every process document its channel table passes — the round brief, the
  // analysis, the handovers — and the design contract — "remediate" = the
  // step re-composes and re-verifies from scratch (D7) — makes the second
  // pass verify what landed, never the text the first pass read.
  // Everything else the loop reads is machinery no remediation rewrites and
  // stays captured (the digest half's booking, the phase state, the task
  // index path, the phase, the entry-held standing predicate below).
  const freshen = async (): Promise<void> => {
    input = (await readPlanInput(directory, phase))?.trim() || undefined
    brief = await projectBriefText(directory)
    if (parts !== undefined) Object.assign(parts, await readFormulationSources(directory, phase, parts.state))
  }
  // Whether a formulation todo already stands (plans/0101 D4): the dispatch
  // discipline below keys on it — a standing todo whose floor moved is
  // transfer's reconstruct, never plan's rewrite — read ahead of the compose
  // loop so the remediate passes cannot change the answer.
  const standingAtEntry = (await standingFormulation(directory, phase)) !== undefined
  // The compose-and-verify loop (plans/0082 §5 D7 / §6 D9, retargeted by
  // 0095 D4): the assembled formulation todo — the exact document
  // construction is about to write — meets the intent charter here, where
  // the human planning input, the brief and the duties all sit in one text.
  // Blocked (2) = the verdict or a fail-closed verifier stopped the step
  // before anything landed; "remediate" = the interactive fast path executed
  // an approved option inline, and the step re-composes and re-verifies from
  // scratch (bounded at two inline remediations — the diagnosis gate's own
  // suspension holds the third).
  // Since plans/0097 the compose step is the synthesis pipeline's home: a
  // resolved charter (D1) and the switch on run the constructor session over
  // the evidential sources (D3), validate mechanically (D4) and land either
  // the synthesized Scope (frame + Sources brief + obligations ledger) or —
  // loudly, audit first — the Stage-1 deterministic floor. Idempotence (D6)
  // keys on the floor assembly's digest: a pending formulation whose
  // recorded digest still matches keeps its landed todo (no churn from
  // constructor nondeterminism); a changed floor re-runs the pipeline.
  const compose = async (): Promise<
    { todo: { goal: string; scope: string; acceptance: string }; document: string; blocks: BlockMapEntry[]; audit: string[]; digest: string; landed: boolean; id?: string }
  > => {
    await freshen()
    const charter = formulationAcceptance(planFacts(ctx), charterPhaseEntry(ctx, phase))
    const facts = planFacts(ctx)
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
          charter,
          ...(existingTasks ? { existingTasks } : {}),
        }
    // The floor always composes first: it is the digest's input, the
    // fallback, and (charter-less) the whole story. Its guarantee gate
    // throws here — a floor that violates the pack's asserts is a human
    // problem (exit 2 at the run boundary), exactly as before 0097. The
    // preview carries the prefix field (plans/0205 D2) so the digest moves
    // with an add — never the Floor-Digest value itself (the digest of
    // itself); that field construction renders beside the todo it describes.
    const floorTodo = renderFormulationTodo(facts, baseInput)
    const floorDocument = previewFormulationDocument(floorTodo, phaseId, prefixIds.length ? prefixIds : undefined)
    const digest = floorDigest(floorDocument)
    // The digest-keep (plans/0097 D6, widened by plans/0101 D4 to the
    // standing predicate — the todo keeps its place beside hand-added tasks;
    // the digest's home moved into the landed todo's own `Floor-Digest:`
    // field by plans/0205 D3): a standing todo whose recorded digest still
    // matches keeps its landed text (no churn from constructor
    // nondeterminism); a changed floor re-runs the pipeline. The field first
    // — committed with the todo it describes, durable across fresh clones
    // and fork worktrees — the .auto/units.json record the pre-0205
    // fallback; both absent (a fresh clone of a pre-0205 todo) misses and
    // the reconstruct lands the field. transfer --resynthesize
    // (plans/0101 D3) bypasses the keep — the rejected synthesized ledger is
    // re-voiced, construction's rewrite-on-diff landing the new todo for
    // review (a one-shot force: the floor digest is unchanged, so the next
    // plain transfer keeps whatever lands).
    if (standing && !opts.resynthesize && landedText !== undefined) {
      const field = landedFields["floor-digest"]
      const recorded = field ? field : await unitSynthDigest(directory, standing.id)
      if (recorded === digest) {
        return {
          todo: floorTodo,
          document: landedText,
          blocks: [{ block: "formulation todo", source: "the landed synthesis (floor assembly unchanged, plans/0097 D6)" }],
          audit: [],
          digest,
          landed: true,
          id: standing.id,
        }
      }
    }
    const phaseEntryOf = charterPhaseEntry(ctx, phase)
    const resolved = resolvedVerifyPlan(facts.pack, phaseEntryOf)
    if (verifyPlanCharterText(resolved) === undefined) {
      return { todo: floorTodo, document: floorDocument, blocks: floorBlocks(phase, input, brief, taskIndex, parts), audit: [], digest, landed: false }
    }
    // The synthesis source list (D3's evidential sources) and its health
    // findings (the crux: a missing must-exist source is named, never
    // silent). The frame blocks (planning input, mode, precedence, duties)
    // are never sources — the brief re-voices evidence, not protocol.
    const sources: LedgerSource[] = []
    const missing: string[] = []
    if (brief) sources.push({ name: BRIEF_FILE, text: brief })
    else missing.push(BRIEF_FILE)
    if (ctx.manual) {
      sources.push({ name: planInputPath(phase), text: input! })
    } else {
      if (parts!.round) sources.push({ name: roundBriefPath(parts!.state.round), text: parts!.round })
      else missing.push(roundBriefPath(parts!.state.round))
      if (parts!.analysis !== undefined) sources.push({ name: ANALYSIS_DOC, text: parts!.analysis })
      else if (phase.entry.gates.includes("human")) missing.push(ANALYSIS_DOC)
      if (input) sources.push({ name: planInputPath(phase), text: input })
      for (const handover of parts!.handoverDocs) sources.push({ name: handover.path, text: handover.text })
      missing.push(...parts!.missingHandovers)
      if (parts!.prevRound) sources.push({ name: "prior-round digest", text: parts!.prevRound })
      else if (parts!.prevRoundExpected) missing.push("prior-round digest")
    }
    const entry = ctx.manual ? phaseType(REQUIRED_TYPE)! : phase.entry
    const outcome = await synthesizeFormulation({
      pool: ctx.server,
      routing: ctx.routing,
      facts,
      phaseEntry: phaseEntryOf,
      entry,
      phaseStep: phaseKey(phase).id,
      sources,
      missing,
      duties: ctx.manual ? "" : planDuties(ctx, phase.entry),
      // The composed-Scope guarantee check (D4.3): an assert miss over the
      // synthesized document is a retry cause, never exit 2 — the validator
      // renders the candidate and reports the violation back to the session.
      validate: (candidateBrief, rows) => {
        try {
          renderFormulationTodo(facts, {
            ...baseInput,
            synthesis: {
              brief: candidateBrief,
              ledger: renderLedger(rows),
              ...(missing.length ? { missing } : {}),
              protocol: protocolFrameText(entry),
            },
          })
          return []
        } catch (error) {
          if (error instanceof PromptGuaranteeError) return [error.message]
          throw error
        }
      },
    })
    if (outcome.kind === "off") {
      log(`ℹ formulation synthesis off: ${outcome.reason}`)
      return { todo: floorTodo, document: floorDocument, blocks: floorBlocks(phase, input, brief, taskIndex, parts), audit: [], digest, landed: false }
    }
    if (outcome.kind === "fallback") {
      log(`⚠ formulation synthesis fell back to the Stage-1 deterministic floor: ${outcome.reason} (this round's docs/R-NN/prompt-audit.md carries the record)`)
      return { todo: floorTodo, document: floorDocument, blocks: floorBlocks(phase, input, brief, taskIndex, parts), audit: outcome.audit, digest, landed: false }
    }
    const todo = renderFormulationTodo(facts, {
      ...baseInput,
      synthesis: {
        brief: outcome.brief,
        ledger: renderLedger(outcome.rows),
        ...(missing.length ? { missing } : {}),
        protocol: protocolFrameText(entry),
      },
    })
    return {
      todo,
      document: previewFormulationDocument(todo, phaseId),
      blocks: [
        { block: "formulation todo (synthesized)", source: "the driver frame + the constructor session's brief and ledger (plans/0097)" },
        { block: "sources brief", source: "the constructor session, under the charter" },
        { block: "obligations ledger", source: "the DRIVER's seeded protocol rows + the constructor session's rows" },
        ...floorBlocks(phase, input, brief, taskIndex, parts),
      ],
      audit: outcome.audit,
      digest,
      landed: false,
    }
  }
  let verified: number | "remediate" = 0
  for (let pass = 0; ; pass++) {
    const composed = await compose()
    // The synthesis audit entries (D6): committed pre-construction (stage
    // prompt-audit), the same wall-document discipline the verifier's
    // verdict gets — what the constructor claimed, and every fallback.
    if (composed.audit.length && !(await recordSynthesisAudit(ctx, phase, composed.audit))) return 2
    verified = await verifyPlanStep(ctx, phase, `formulation ${phaseKey(phase).id}`, composed.document, composed.blocks)
    if (verified !== "remediate") {
      if (verified !== 0) return verified
      // The dispatch discipline (plans/0101 D4): plan dispatches the reviewed
      // todo exactly as constructed. A standing todo whose floor moved — an
      // input edited since the review stop, through the document or a
      // re-passed -p the prelude cannot see — is transfer's idempotent
      // reconstruct, and plan never rewrites what a person may be reviewing;
      // the refusal names the re-run (the reconstruct lands the new todo and
      // stops for review again). A fresh construction under the stop
      // condition is the loop's own continuation shape (m mode, the
      // open-step recovery), unchanged.
      if (opts.stopBefore === "execute" && !ctx.manual && standingAtEntry && !composed.landed) {
        const { bin } = shellProfile()
        log(
          `⏸ the reviewed plan task of ${phaseTitle(phase)} no longer matches its inputs — an input changed since construction; ` +
            `the reconstruct is transfer's: re-run: ${bin} transfer ${directory}`,
        )
        return 1
      }
      // Construction (plans/0095 D1): land the verified document as the
      // phase's first task unit — idempotent, so the remediate loop's final
      // composition is the one that lands. The digest-hit re-entry (D6)
      // skips construction: the landed todo stands, byte for byte, and its
      // recorded digest already matches. The construction record
      // (plans/0205 D2/D3): the floor digest and the prefix ids travel into
      // the todo's own field block — the prefix derived from the preview's
      // field (the one source the floor already rendered), the digest the
      // keep compares; the .auto/units.json record write retired with the
      // field (D3).
      let id: string
      if (composed.landed && composed.id !== undefined) {
        id = composed.id
        log(`✓ the landed formulation todo of ${id} stands — the floor assembly is unchanged (plans/0097 D6)`)
      } else {
        const prefix = parseUnitDoc(composed.document).fields.prefix?.split(/[\s,]+/).filter(Boolean)
        const landed = await constructFormulation(directory, phase, composed.todo, {
          digest: composed.digest,
          ...(prefix?.length ? { prefix } : {}),
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
      // unchanged (plans/0097 D6). The stop's output (D3) names the records
      // beside the todo — the round's prompt-audit.md, where the plan-verify
      // verdict and the synthesis:/fidelity:/FALLBACK lines of the
      // construction live — and the round-brief duty: a round.md still the
      // untouched stub says so, the fill and the re-run the answer (the
      // reconstruct absorbs it; plan's dispatch refuses on a stub).
      if (opts.stopBefore === "formulate") {
        const { bin } = shellProfile()
        log(
          `⏸ review stop: the formulation todo of ${id} (docs/${id}/todo.md — driver-owned, fix its inputs, never the todo) awaits your review`,
        )
        const audit = join(dirname(phase.dir), "prompt-audit.md")
        if (await Bun.file(join(directory, audit)).exists()) {
          log(`ℹ the construction's records sit beside it in ${audit} (the plan-verify verdict; the synthesis:/fidelity: entries and any FALLBACK of the constructor)`)
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
    if (pass >= 1) {
      log("⏸ the step re-blocked after two inline remediations; stopping — the diagnosis gate suspends further attempts")
      return 2
    }
  }
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
