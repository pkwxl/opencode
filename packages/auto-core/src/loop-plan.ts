// Phase planning: the planning session (planPhase) and its step wrapper
// (planWithStep), the appending session (appendPlan, appendWithStep) with its
// snapshot → reset → collect cycle, plus the phase-state helpers the phase
// loop shares (phaseState, phaseTitle). Moved out of src/loop-phase.ts
// (plans/0053 A2) so the P3 planning additions, starting with the persisted
// planning input (A3, src/plan-input.ts), do not push that file past 600
// lines. It is the one planner: m mode plans here too (A4, D12), and m mode
// appends on the same append step (D23). Direction: loop-phase → loop-plan
// → loop-task; never imports loop-phase or loop.
import { rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { analysisText } from "./analysis"
import { requireArtifact } from "./artifact"
import { openBlockage, type BlockageSite } from "./blockage-diagnose"
import type { BlockMapEntry } from "./blockage"
import { BRIEF_FILE, projectBriefText } from "./brief"
import { floorDigest, protocolFrameText, renderLedger, synthesizeFormulation, type LedgerSource } from "./formulate-synthesis"
import { constructFormulation, formulationAcceptance, formulationNumber, formulationState } from "./formulate"
import { PromptGuaranteeError, resolvedVerifyPlan, verifyPlanCharterText } from "./intent/guarantees"
import { digestIndexEntries, priorKnowledgeDigest, renderDigestIndex } from "./knowledge"
import { formatTokens, log } from "./log"
import { runSerialUnit, type LoopCtx } from "./loop-task"
import { advanceNextTask, ensureNumbering, NEXT_TASK_FILE, taskNumber } from "./numbering"
import { REQUIRED_TYPE, phaseType } from "./phases/registry"
import { currentRound, phaseHandoverDoc, phaseKey, phaseLabel, phaseName, prevRoundDigest, readPhases, type PhaseState, type PhaseUnit } from "./phases"
import { ANALYSIS_DOC, reportForUserPath, roundBriefPath } from "./docpaths"
import { plannedLines } from "./plan"
import { planInputPath, readPlanInput, savePlanInput } from "./plan-input"
import { existingTaskList, planDutyText, renderFormulationTodo, renderPhaseAppend } from "./prompt-plan"
import { checkTextAgainstCharter, verifyAuditEntry, verifyPlanPrompt } from "./prompt-verify"
import { phaseTag } from "./prompt"
import { promptFacts } from "./prompt-facts"
import { closeStep } from "./resume"
import { roundBriefText } from "./round-brief"
import { statsDigest } from "./stats"
import { stepPause } from "./step"
import { estimateTokens } from "./usage"
import { DEFAULT_CONTEXT_LIMIT, sessionOpts } from "./opts"
import {
  doneTaskIds,
  loadPlan,
  newTaskProblems,
  qualifiedPhase,
  recordSynthDigest,
  renderTaskTodo,
  takenTaskIds,
  taskDecl,
  taskIndexPath,
  taskStatePaths,
  unitSynthDigest,
  type PlanPhase,
} from "./tasks"
import { isUnitId, parseIndex, unitProblems, type IndexEntry, type UnitDecl } from "./document/unit"

// the phase index (routing already validated it; re-read here only for the
// done set and the order, missing/invalid treated as empty).
export async function phaseState(directory: string): Promise<PhaseState> {
  return (await readPhases(directory).catch(() => undefined)) ?? { round: 0, index: "", phases: [], done: new Set(), closed: new Map() }
}

// the phase display name (logs/commit titles): P02-design Design
export const phaseTitle = (unit: PhaseUnit) => `${phaseLabel(unit)} ${phaseName(unit)}`

// The planning renders' facts (E2): the bypass sessions' human-questions mode
// is plan's stop condition — the same rule sessionOpts applies to every
// bypass site, so a planning prompt renders the question-rule's human-answer
// branch exactly when its session would wait for the human.
const planFacts = (ctx: LoopCtx) => promptFacts({ dir: ctx.directory, humanQuestions: ctx.opts.stopBefore === "execute", intent: ctx.opts.intent })

// A phase type's duty paragraph for the append prompt (E2): prompt-plan's
// planDutyText — the type's own `## plan duties` (custom types), then — the
// pack tier, plans/0080 §4 — the active pack's `### <dutiesRef>` under `##
// phase duties`, then the core shared partial, rendered through the active
// library so overlays apply. The ctx (plans/0095 D4) threads the two facts
// the pack texts reference, fixing the empty-paren / dropped-conditional
// render of the empty-ctx era.
const planDuties = (ctx: LoopCtx, entry: PhaseUnit["entry"]): string =>
  planDutyText(planFacts(ctx), entry, { phaseName: entry.name, ...(ctx.opts.testByDriver ? { testByDriver: true } : {}) })

// The plan-step consistency gate (plans/0080 §5): before a planning or append
// session runs, its composed prompt is judged against the active pack's
// verify-plan charter and the verdict recorded in the round's prompt-audit.md
// (written here, ahead of the session, so the step's own commit carries it —
// the wall documentation a clean-room defense wants). Returns 0 = proceed
// (consistent, inactive, or a skip the mechanical layers still cover), 2 =
// blocked for the human: an inconsistent prompt quotes the evidence, a
// verifier that cannot answer fails closed after its retry. The two block
// branches (INCONSISTENT, FAILED) are covered block sites (plans/0082 §7
// D10 v1): the dossier assembles and the honest block line names located
// files (D2), then — the remediation switch on — the diagnosis session
// writes the blockage document the person answers with one `Choice:` line.
// "remediate" = the interactive fast path executed an approved option inline
// (D9): the caller re-composes and re-verifies from scratch (D7).
// The phase key of a formulation's charter resolution (plans/0097 D1): the
// phaseTag vocabulary — a builtin letter or a custom type id. m mode passes
// none (the pack-global charter alone resolves, D10).
const charterPhaseKey = (ctx: LoopCtx, phase: PhaseUnit): string | undefined => (ctx.manual ? undefined : phaseTag(phase.entry))

async function verifyPlanStep(ctx: LoopCtx, phase: PhaseUnit, step: string, prompt: string, blocks: readonly BlockMapEntry[]): Promise<number | "remediate"> {
  const outcome = await verifyPlanPrompt({ pool: ctx.server, routing: ctx.routing, facts: planFacts(ctx), step, prompt, phase: charterPhaseKey(ctx, phase) })
  if (outcome.kind === "inactive") return 0
  const audit = join(dirname(phase.dir), "prompt-audit.md")
  const previous = await Bun.file(join(ctx.directory, audit)).text().catch(() => "")
  await Bun.write(
    join(ctx.directory, audit),
    `${previous.trim() ? `${previous.trimEnd()}\n` : "# Prompt-audit record (plans/0080 §5): every plan-step consistency verdict of this round\n\n"}${verifyAuditEntry(step, outcome)}\n`,
  )
  // The audit write commits on its own ahead of the session it documents: the
  // planning unit's entry clean gate demands a clean tree, so an uncommitted
  // wall document would block the very step it records (Auto-DECISION: a
  // dedicated prompt-audit commit, the savePlanInput pattern, instead of
  // riding the session's unified commit — §5's "written before the session"
  // stays true in git order, and the record survives a session that never
  // runs; found by the §7 session-driving coverage, T-141).
  const settled = await ctx.git.commitTree(ctx.directory, { id: "PLAN", title: `plan verification (${step})` }, { stage: "prompt-audit", subject: `PLAN prompt-audit ${step}` })
  if (!settled.ok) {
    log(`⏸ prompt-audit commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. The record is kept in the worktree; commit manually and re-run`)
    return 2
  }
  if (outcome.kind === "skipped") {
    log(`ℹ plan verification skipped: ${outcome.reason}`)
    return 0
  }
  if (outcome.kind === "consistent") {
    log(`✓ plan verification: the ${step} prompt is consistent with the intent charter (${audit})`)
    return 0
  }
  // The covered block branches (plans/0082 §7 D10 v1): dossier + honest
  // block line + (switch on) the diagnosis and its document.
  const evidence = outcome.kind === "inconsistent" ? outcome.evidence : outcome.reason
  const site: BlockageSite = {
    directory: ctx.directory,
    gate: "plan-verify",
    step,
    verdict: outcome.kind === "inconsistent" ? `INCONSISTENT — ${outcome.evidence}` : `FAILED — ${outcome.reason}`,
    evidence,
    blockMap: blocks,
    auditTail: auditTail(previous),
    intro:
      outcome.kind === "inconsistent"
        ? `⏸ plan verification found the ${step} prompt inconsistent with the intent charter: ${outcome.evidence}`
        : `⏸ plan verification could not judge the ${step} prompt: ${outcome.reason}`,
    next: outcome.kind === "inconsistent"
      ? "  rewrite the located file, or amend the intent — the driver never rewrites your words"
      : "  fix the verifier's model and re-run — fail-closed, plans/0080 §5",
  }
  const result = await openBlockage(site, { server: ctx.server, opts: sessionOpts(ctx, { site: "diagnosis" }), ...(ctx.repl ? { repl: ctx.repl } : {}) })
  for (const line of result.lines) log(line)
  if (result.status === "remediated") return "remediate"
  // The static tail the block always carried, kept after the honest lines.
  if (outcome.kind === "inconsistent") log(`  The verdict is recorded in ${audit}. ${result.file ? `Answer ${result.file} with one \`Choice:\` line, or r` : "R"}ewrite the conflicting input, or amend the intent — the driver never rewrites your words`)
  else log(`  The failure is recorded in ${audit} — fail-closed, fix the verifier's model and re-run`)
  return 2
}

// The audit's last verdict lines (the dossier's state snapshot reads them).
function auditTail(auditText: string): string[] {
  return auditText.trimEnd().split("\n").slice(-5).map((line) => line.trim()).filter(Boolean)
}

// The planning input's admission warn (plans/0082 §10 D14b): the same
// charter-check call over the person's text at admission — warn-and-record,
// never refuse. Their words are theirs; the composition-time gate still
// judges the composed whole.
async function admissionWarn(ctx: LoopCtx, phase: PhaseUnit, text: string, step: string): Promise<void> {
  const check = await checkTextAgainstCharter({
    server: ctx.server,
    routing: ctx.routing,
    dir: ctx.directory,
    intent: ctx.opts.intent,
    label: `the planning input admitted to ${planInputPath(phase)}`,
    text,
  })
  if (check.kind !== "flagged") return
  log(`⚠ the planning input conflicts with the intent charter (${planInputPath(phase)}): the charter-consistent reading in force is "${check.reading}" — the run proceeds, and the composition-time gate still judges the composed whole`)
  const audit = join(dirname(phase.dir), "prompt-audit.md")
  const previous = await Bun.file(join(ctx.directory, audit)).text().catch(() => "")
  const stamp = new Date().toISOString()
  await Bun.write(
    join(ctx.directory, audit),
    `${previous.trim() ? `${previous.trimEnd()}\n` : "# Prompt-audit record (plans/0080 §5): every plan-step consistency verdict of this round\n\n"}- ${stamp} admission ${step}: WARN — the planning input conflicts with the charter; in force: ${check.reading}\n`,
  )
  const settled = await ctx.git.commitTree(ctx.directory, { id: "PLAN", title: `plan admission warn (${step})` }, { stage: "prompt-audit", subject: `PLAN prompt-audit admission warn ${step}` })
  if (!settled.ok) {
    log(`⚠ the admission-warn record could not be committed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}; commit ${audit} manually`)
  }
}

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
export async function planPhase(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const { directory, opts, server: serverHandle } = ctx
  // The phase loop routes m mode here only with an input, new or persisted;
  // checked first, so a missing one starts no numbering-restore session.
  if (ctx.manual && !ctx.input && !(await readPlanInput(directory, phase))?.trim()) {
    log(`⏸ nothing to plan ${phaseTitle(phase)} against: m-mode planning plans against a planning input, and ${planInputPath(phase)} is missing or empty`)
    return 1
  }
  // auto numbering (config.autoNumber): the record must exist before
  // construction allocates the formulation number; a missing record is
  // restored first (no historical evidence writes 1 directly, with evidence
  // an AI inference session opens, see src/numbering.ts), and a blocked
  // restore exits 2. The restore session itself produces one unified commit
  // (stage=numbering), ahead of construction.
  if (opts.autoNumber) {
    const numbering = await ensureNumbering(serverHandle, directory, sessionOpts(ctx, { site: "plan-numbering" }))
    if (numbering.type === "dirty") {
      log(`⏸ worktree not clean before restoring the numbering record; handle it manually (commit/clean) and re-run:`)
      for (const file of numbering.files) log(`  ${file}`)
      return 2
    }
    if (numbering.type === "blocked") {
      log(`⏸ numbering-record restore session blocked (implicit block, investigate and re-run):\n${numbering.question}`)
      return 2
    }
  }
  // The planning input (plans/0053 D9), unchanged: a new text is persisted to
  // the phase's plan-input.md and committed on its own before construction;
  // without one the step plans against the persisted file. A changed input
  // re-renders a different todo, which construction's rewrite-on-diff lands —
  // the restart channel of the bypass era, folded into idempotence.
  if (ctx.input) {
    const text = ctx.input.text
    const saved = await savePlanInput(directory, phase, ctx.input, phaseTitle(phase))
    if (saved.type === "dirty") {
      log(`⏸ worktree not clean before saving the planning input; handle it manually (commit/clean) and re-run:`)
      for (const file of saved.files) log(`  ${file}`)
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
  const input = (await readPlanInput(directory, phase))?.trim() || undefined
  if (input) log(`ℹ planning against the persisted input ${planInputPath(phase)}`)
  // The project brief (plans/0052 D9), comments stripped: an untouched stub injects nothing.
  const brief = await projectBriefText(directory)
  const taskIndex = taskIndexPath(phase)
  const phaseId = qualifiedPhase(phase)
  // The phase's composition state (plans/0097 D3): the phased gathering —
  // handovers (per document, for the synthesis source list), the
  // first-planning-session digest block, the round brief, the approved
  // analysis, the final-phase report duty — read once; both the floor and
  // the synthesis compose from the same parts. m mode has none of it.
  const parts = ctx.manual ? undefined : await formulationParts(ctx, phase)
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
    const charter = formulationAcceptance(planFacts(ctx), charterPhaseKey(ctx, phase))
    const n = await formulationNumber(directory, phase, Boolean(opts.autoNumber))
    const facts = planFacts(ctx)
    const baseInput = ctx.manual
      ? {
          phaseId,
          taskIndex,
          numberStart: n + 1,
          brief,
          input: input!,
          inputPath: planInputPath(phase),
          mode: opts.mode,
          parallel: opts.parallel,
          // The no-phase implicit round's single phase is the round's final one
          // (plans/0081 D2): its formulation carries the report duty.
          finalPhase: true as const,
          reportFile: reportForUserPath(await currentRound(directory)),
          charter,
        }
      : {
          phase: phase.entry,
          phaseId,
          taskIndex,
          numberStart: n + 1,
          brief,
          round: parts!.round,
          analysis: parts!.analysis,
          input,
          inputPath: planInputPath(phase),
          handovers: parts!.handovers,
          prevRound: parts!.prevRound,
          mode: opts.mode,
          ...(parts!.finalPhase ? { finalPhase: true as const, reportFile: parts!.reportFile } : {}),
          // No analysis/design phase delivered in this round's index → the
          // implement phase's planning gets the pipeline-trimming note.
          trimmedPhases: parts!.trimmedPhases,
          parallel: opts.parallel,
          testByDriver: opts.testByDriver,
          charter,
        }
    // The floor always composes first: it is the digest's input, the
    // fallback, and (charter-less) the whole story. Its guarantee gate
    // throws here — a floor that violates the pack's asserts is a human
    // problem (exit 2 at the run boundary), exactly as before 0097.
    const floorTodo = renderFormulationTodo(facts, baseInput)
    const floorDocument = previewFormulationDocument(floorTodo, phaseId)
    const digest = floorDigest(floorDocument)
    const state = await formulationState(directory, phase)
    if (state.type === "pending" && !state.inProgress && (await unitSynthDigest(directory, state.id)) === digest) {
      const landedText = await Bun.file(join(directory, taskStatePaths(state.id).pending)).text()
      return {
        todo: floorTodo,
        document: landedText,
        blocks: [{ block: "formulation todo", source: "the landed synthesis (floor assembly unchanged, plans/0097 D6)" }],
        audit: [],
        digest,
        landed: true,
        id: state.id,
      }
    }
    const phaseKeyOf = charterPhaseKey(ctx, phase)
    const resolved = resolvedVerifyPlan(facts.pack, phaseKeyOf)
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
    const finalPhase = ctx.manual || parts!.finalPhase
    const reportFile = ctx.manual ? reportForUserPath(await currentRound(directory)) : parts!.reportFile
    const outcome = await synthesizeFormulation({
      pool: ctx.server,
      routing: ctx.routing,
      facts,
      phaseKey: phaseKeyOf,
      entry,
      phaseStep: phaseKey(phase).id,
      finalPhase,
      ...(reportFile !== undefined ? { reportFile } : {}),
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
              protocol: protocolFrameText(entry, finalPhase, reportFile),
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
      log(`⚠ formulation synthesis fell back to the Stage-1 deterministic floor: ${outcome.reason} (the round report's needs-attention section carries it)`)
      return { todo: floorTodo, document: floorDocument, blocks: floorBlocks(phase, input, brief, taskIndex, parts), audit: outcome.audit, digest, landed: false }
    }
    const todo = renderFormulationTodo(facts, {
      ...baseInput,
      synthesis: {
        brief: outcome.brief,
        ledger: renderLedger(outcome.rows),
        ...(missing.length ? { missing } : {}),
        protocol: protocolFrameText(entry, finalPhase, reportFile),
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
      // Construction (plans/0095 D1): land the verified document as the
      // phase's first task unit — idempotent, so the remediate loop's final
      // composition is the one that lands. The digest-hit re-entry (D6)
      // skips construction: the landed todo stands, byte for byte, and its
      // recorded digest already matches.
      let id: string
      if (composed.landed && composed.id !== undefined) {
        id = composed.id
        log(`✓ the landed formulation todo of ${id} stands — the floor assembly is unchanged (plans/0097 D6)`)
      } else {
        const landed = await constructFormulation(directory, phase, composed.todo, { autoNumber: opts.autoNumber })
        if (landed.type === "dirty") {
          log(`⏸ worktree not clean before constructing the formulation task; handle it manually (commit/clean) and re-run:`)
          for (const file of landed.files) log(`  ${file}`)
          return 2
        }
        if (landed.type === "failed") {
          log(`⏸ ${landed.question}`)
          return 2
        }
        await recordSynthDigest(directory, landed.id, composed.digest)
        id = landed.id
        log(`✓ formulation task ${landed.id} ${landed.type === "constructed" ? "constructed" : "current"}: its todo is the planning session's single input (docs/${landed.id}/todo.md)`)
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

// The verify-time preview of the formulation document (plans/0095 D4): the
// exact todo construction writes, with the placeholder id the number
// allocation fills at landing — the charter-judging content is identical.
function previewFormulationDocument(todo: { goal: string; scope: string; acceptance: string }, phaseId: string): string {
  return renderTaskTodo({ id: "T-NNN", title: "Formulate the phase tasks", phase: phaseId, formulate: phaseId, decompose: "whole", depends: "none", goal: todo.goal, scope: todo.scope, acceptance: todo.acceptance })
}

// The phased formulation's composition state (the former phasePlanPrompt's
// gathering, plans/0095 D1; split from the render by plans/0097 D3 so the
// synthesis pipeline reads the same parts as the floor): the earlier phases'
// handovers (the joined text for the floor, per document for the synthesis
// source list), the first-planning-session prior-round digest, the round
// brief, the approved analysis (human-gated phases), the final-phase report
// duty and the pipeline-trimming note. The per-source health findings (the
// missing handover documents, the expected-but-absent digest) ride along —
// the crux's "never silence" rule.
export type FormulationParts = {
  state: PhaseState
  handovers: string
  handoverDocs: { path: string; text: string }[]
  missingHandovers: string[]
  prevRound: string | undefined
  prevRoundExpected: boolean
  round: string | undefined
  analysis: string | undefined
  finalPhase: boolean
  reportFile: string | undefined
  trimmedPhases: boolean
}

async function formulationParts(ctx: LoopCtx, phase: PhaseUnit): Promise<FormulationParts> {
  const { directory, opts } = ctx
  const state = await phaseState(directory)
  // Earlier phases' handovers (injection discipline): only the distilled
  // handovers are injected, never the earlier phases' raw docs/. Each done phase
  // that precedes this one in the phase index is appended in order; the handover
  // is the permanent P<nn>-<type>/handover.md in the phase directory, and a phase
  // without one is listed as "(no handover document)".
  const handovers = await earlierHandovers(directory, phase, state)
  const earlier = state.phases
    .slice(0, state.phases.findIndex((unit) => unit.id === phase.id))
    .filter((unit) => state.done.has(unit.id))
  const handoverDocs: { path: string; text: string }[] = []
  const missingHandovers: string[] = []
  for (const unit of earlier) {
    const path = phaseHandoverDoc(unit)
    const text = await Bun.file(join(directory, path)).text().catch(() => undefined)
    if (text?.trim()) handoverDocs.push({ path, text })
    else missingHandovers.push(path)
  }
  // Extra injection for the round's first planning session: ① prior knowledge
  // (the shell's startup distillation of existing migration results,
  // docs/R-NN/prior-kb.md, see src/knowledge.ts); ② the previous round's
  // conclusions (when a previous round directory exists). Later phases follow
  // the handover chain and get neither again.
  // "First" = no completed phase of this round has tasks (plans/0049 G4): a
  // leading task-less knowledge phase has no planning session and must not
  // swallow the digest.
  // The digest cap: above a quarter of the run's context limit (estimated by
  // the same token estimate the usage source uses), the prompt gets the index
  // form instead of the full texts — the path and size of each knowledge
  // document and handover, the session opening what it needs. The sizes are
  // booked per planning session either way, so the memory-service question
  // has its data.
  let prevRound: string | undefined
  let prevRoundExpected = false
  if (!state.phases.some((unit) => state.done.has(unit.id) && unit.entry.hasTasks)) {
    const prior = (await priorKnowledgeDigest(directory))?.trim() || undefined
    const prev = (await prevRoundDigest(directory))?.trim() || undefined
    prevRoundExpected = state.round > 1 && prev === undefined
    const segments = [prior, prev].filter((part): part is string => part !== undefined)
    const joined = segments.length ? segments.join("\n\n") : undefined
    const cap = (opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT) / 4
    const total = joined === undefined ? 0 : estimateTokens(joined)
    const capped = joined !== undefined && total > cap
    prevRound = capped ? renderDigestIndex(await digestIndexEntries(directory), { total, cap }) : joined
    if (prevRound) {
      log(
        capped
          ? `ℹ prior migration conclusions exceed the digest cap (${formatTokens(total)} tokens > ${formatTokens(cap)}); injecting the index form instead — the session opens what it needs`
          : "ℹ injecting prior migration conclusions (prior knowledge + previous round's archive excerpts)",
      )
    }
    await statsDigest(directory, {
      priorKnowledge: prior === undefined ? undefined : estimateTokens(prior),
      prevRound: prev === undefined ? undefined : estimateTokens(prev),
      capped,
    })
  }
  // The round brief docs/R-NN/round.md (plans/0049 G3): every planning session
  // plans against the round's goal and criteria; an untouched stub injects nothing.
  const round = await roundBriefText(directory, state.round)
  // The approved project analysis (plans/0085 A1): the survey phase's
  // formulation — the one that raises decisions — reads the person's
  // settled decisions directly, so what the analysis settles is never
  // re-raised as a fork. Human-gated phases only.
  const analysis = phase.entry.gates.includes("human") ? await analysisText(directory) : undefined
  // The round report duty (plans/0081 D2): this phase is final when it is the
  // round's last and lays out tasks — its formulation ends the index with the
  // wrap-up task whose deliverable is docs/R-NN/report-for-user.md. A round
  // ending in a trailing task-less phase (knowledge) renders nothing here:
  // that side-channel session writes the report as its second artifact
  // (D6b, knowledge.ts).
  const last = state.phases.at(-1)
  const finalPhase = last !== undefined && last.id === phase.id && phase.entry.hasTasks
  return {
    state,
    handovers,
    handoverDocs,
    missingHandovers,
    prevRound,
    prevRoundExpected,
    round,
    analysis,
    finalPhase,
    reportFile: finalPhase ? reportForUserPath(state.round) : undefined,
    // No analysis/design phase delivered in this round's index → the
    // implement phase's planning gets the pipeline-trimming note. A closed
    // analysis/design phase (plans/0053 D16: done for scheduling, not
    // delivered) counts as absent.
    trimmedPhases: !state.phases.some((unit) => (unit.type === "analysis" || unit.type === "design") && !state.closed.has(unit.id)),
  }
}

// The floor's block map (plans/0082 §2 D1): each block of the assembled todo
// and its source path, from the composition state itself — never a guess
// read back out of the rendered text. The synthesized shape prepends its own
// blocks ahead of these.
function floorBlocks(phase: PhaseUnit, input: string | undefined, brief: string | undefined, taskIndex: string, parts: FormulationParts | undefined): BlockMapEntry[] {
  const manual = parts === undefined
  return [
    { block: "formulation todo", source: "the deterministic assembly (plans/0095)" },
    ...(manual ? [] : [{ block: "phase duties", source: "the active pack's phase-duties section" }]),
    { block: "brief", source: brief ? BRIEF_FILE : `${BRIEF_FILE} (absent)` },
    ...(manual
      ? []
      : [
          { block: "round brief", source: roundBriefPath(parts!.state.round) },
          ...(parts!.analysis !== undefined ? [{ block: "analysis", source: ANALYSIS_DOC }] : []),
          ...parts!.handoverDocs.map((doc) => ({ block: "handover", source: doc.path })),
          ...(parts!.prevRound !== undefined ? [{ block: "previous round digest", source: "the prior-knowledge and previous-round documents" }] : []),
        ]),
    { block: "planning input", source: input ? planInputPath(phase) : `${planInputPath(phase)} (absent)` },
    { block: "task index", source: taskIndex },
    { block: "mode notes", source: "the active mode file" },
  ]
}

// The synthesis audit entries' write (plans/0097 D6): appended to the round's
// prompt-audit.md and committed on its own ahead of construction (stage
// prompt-audit, the verifier's discipline — the record survives a session
// that never runs, and the planning unit's clean gate finds a committed
// tree). false = the commit failed; the caller blocks (the entry clean gate
// would refuse the uncommitted wall document anyway).
async function recordSynthesisAudit(ctx: LoopCtx, phase: PhaseUnit, lines: readonly string[]): Promise<boolean> {
  const audit = join(dirname(phase.dir), "prompt-audit.md")
  const previous = await Bun.file(join(ctx.directory, audit)).text().catch(() => "")
  await Bun.write(
    join(ctx.directory, audit),
    `${previous.trim() ? `${previous.trimEnd()}\n` : "# Prompt-audit record (plans/0080 §5): every plan-step consistency verdict of this round\n\n"}${lines.join("\n")}\n`,
  )
  const settled = await ctx.git.commitTree(ctx.directory, { id: "PLAN", title: `formulation synthesis (${phaseKey(phase).id})` }, { stage: "prompt-audit", subject: `PLAN prompt-audit synthesis ${phaseKey(phase).id}` })
  if (settled.ok) return true
  log(`⏸ synthesis-audit commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. The record is kept in the worktree; commit manually and re-run`)
  return false
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

// —— Append planning (plans/0053 D23–D25) ——

// The earlier phases' distilled handovers in index order, one block per done
// phase that precedes `phase` (the injection discipline: only distilled
// handovers, never the earlier phases' raw docs/). Shared by the planning and
// appending prompts, so both sessions see the same chain.
async function earlierHandovers(directory: string, phase: PhaseUnit, state: PhaseState): Promise<string> {
  const earlier = state.phases.slice(0, state.phases.findIndex((unit) => unit.id === phase.id))
  return (
    await Promise.all(
      earlier
        .filter((unit) => state.done.has(unit.id))
        .map(async (unit) => {
          const doc = phaseHandoverDoc(unit)
          const text = await Bun.file(join(directory, doc)).text().catch(() => undefined)
          return [`### ${phaseTitle(unit)}(${doc})`, "", text?.trim() || "(no handover document)"].join("\n")
        }),
    )
  ).join("\n\n")
}

// The earlier phases' handover sources as block-map entries (the append
// side's composition state; the same selection earlierHandovers injects).
async function earlierHandoverSources(directory: string, phase: PhaseUnit): Promise<BlockMapEntry[]> {
  const state = await phaseState(directory)
  return state.phases
    .slice(0, state.phases.findIndex((unit) => unit.id === phase.id))
    .filter((unit) => state.done.has(unit.id))
    .map((unit) => ({ block: "handover", source: phaseHandoverDoc(unit) }))
}

// What an appending session builds on, read from disk at step entry (plans/0053
// F1: the tree is clean at HEAD there — preflight guaranteed it — so disk is
// the committed state). Tasks a person committed mid-append count as existing
// on re-entry: the re-entry snapshot includes them, and only the entries after
// them are checked (D24's residual).
export type AppendSnapshot = {
  // Repository-relative path of the phase's task index.
  index: string
  // The index text as it stands at step entry.
  text: string
  entries: IndexEntry[]
  // Per existing task id: the text of the state file(s) that exist (exactly
  // one per task in a valid index); a missing key = the file was absent.
  files: Map<string, { pending?: string; complete?: string }>
}

// Read the append snapshot of a phase whose index already lists tasks.
export async function snapshotAppend(dir: string, phase: PlanPhase): Promise<AppendSnapshot> {
  const index = taskIndexPath(phase)
  const text = await Bun.file(join(dir, index)).text()
  const entries = parseIndex(text, "task").entries
  const files = new Map<string, { pending?: string; complete?: string }>()
  for (const entry of entries) {
    const paths = taskStatePaths(entry.id)
    const pending = await Bun.file(join(dir, paths.pending)).text().catch(() => undefined)
    const complete = await Bun.file(join(dir, paths.complete)).text().catch(() => undefined)
    files.set(entry.id, { ...(pending !== undefined ? { pending } : {}), ...(complete !== undefined ? { complete } : {}) })
  }
  return { index, text, entries, files }
}

// The append collect (plans/0053 D24): problems of what an appending session
// wrote onto a phase whose index already listed tasks (empty problems and the
// appended ids = accepted). The existing prefix is fixed — index lines and
// task documents alike — and only the entries after it are the session's
// output, each checked by the per-task rules (newTaskProblems, `before` =
// taken ∪ snapshot ids), with the whole index's dependency graph re-checked
// (the existing decls come from the snapshot texts, so an edited document is
// caught by the file-identity check, not silently re-validated).
export async function appendProblems(
  dir: string,
  phase: PlanPhase,
  snap: AppendSnapshot,
  opts: { before: ReadonlySet<string>; numberStart?: number },
): Promise<{ problems: string[]; ids: string[] }> {
  const index = taskIndexPath(phase)
  const text = await Bun.file(join(dir, index)).text().catch(() => undefined)
  if (text === undefined) return { problems: [`${index} is missing`], ids: [] }
  const parsed = parseIndex(text, "task")
  const problems = parsed.problems.map((problem) => `${index} ${problem}`)
  const entries = parsed.entries
  const prefix = snap.entries
  // The first *n* entries equal the snapshot's, in order, with their lines
  // unchanged (compared through the parser's view — id, title, tick — which is
  // the shape the driver guarantees; anything a session may do to an existing
  // line shows up in one of the three).
  let prefixHolds = true
  if (entries.length < prefix.length) {
    problems.push(`${index} lists ${entries.length} task(s) but held ${prefix.length} before the append; existing lines are fixed — append after them, never remove one`)
    prefixHolds = false
  } else {
    for (let i = 0; i < prefix.length; i++) {
      const was = prefix[i]!
      const now = entries[i]!
      if (now.id !== was.id) {
        problems.push(`${index} line ${now.line}: ${now.id} sits where ${was.id} sat; existing lines are fixed — append after the last existing line, never reorder or replace`)
        prefixHolds = false
        break
      }
      if (now.title !== was.title || now.ticked !== was.ticked) {
        problems.push(`${index} line ${now.line}: the existing line of ${was.id} was edited; existing lines are fixed — append only`)
        prefixHolds = false
        break
      }
    }
  }
  // At least one new entry follows the snapshot prefix.
  const fresh = prefixHolds ? entries.slice(prefix.length) : []
  if (prefixHolds && !fresh.length) {
    problems.push(`${index} gained no new task; the append must add at least one (a line \`- [ ] T-NNN <task title>\` after the existing ones)`)
  }
  // No existing task's state file changed: per snapshot id, the file that
  // existed holds exactly the snapshotted text and the other one is still
  // absent (a created done.md would both edit the set and break the index).
  for (const [id, files] of snap.files) {
    const paths = taskStatePaths(id)
    for (const key of ["pending", "complete"] as const) {
      const was = files[key]
      const now = await Bun.file(join(dir, paths[key])).text().catch(() => undefined)
      if (was === undefined && now !== undefined) {
        problems.push(`${paths[key]} of the existing task ${id} is new; an append never touches an existing task's state files`)
      } else if (was !== undefined && now !== was) {
        problems.push(`${paths[key]} of the existing task ${id} was changed or removed; an append never edits an existing task's document`)
      }
    }
  }
  // The per-task checks over the appended entries; the dependency graph of the
  // whole index runs once every entry has a decl (the prefix decls from the
  // snapshot texts, the fresh ones from the per-task read).
  const decls: UnitDecl[] = []
  let complete = prefixHolds
  for (let i = 0; i < prefix.length && complete; i++) {
    const entry = entries[i]!
    const files = snap.files.get(entry.id)
    const doc = files ? (files.pending ?? files.complete) : undefined
    if (doc === undefined) complete = false
    else decls.push(taskDecl(entry.id, doc))
  }
  for (const entry of fresh) {
    const checked = await newTaskProblems(dir, phase, entry.id, opts)
    problems.push(...checked.problems)
    if (checked.decl) decls.push(checked.decl)
    else complete = false
  }
  if (complete && decls.length === entries.length) {
    problems.push(...unitProblems("task", decls, { external: await doneTaskIds(dir) }).map((problem) => `${index}: ${problem}`))
  }
  return { problems, ids: fresh.map((entry) => entry.id).filter((id) => isUnitId("task", id)) }
}

// Restore the snapshot before each fresh attempt (plans/0053 D24): write the
// snapshot index text back, restore any changed existing task file (and remove
// a state file the snapshot does not have), and remove the task directories of
// index ids that are neither in the snapshot nor taken elsewhere — an id
// listed by another phase's index, or already done, belongs to that other
// unit, so its directory is never removed however it got listed here.
// requireArtifact skips this when a reused session resumes: the worktree is
// then the session's own progress, not stale output.
export async function resetAppend(dir: string, phase: PlanPhase, snap: AppendSnapshot): Promise<void> {
  const file = join(dir, snap.index)
  const current = await Bun.file(file).text().catch(() => undefined)
  const snapIds = new Set(snap.entries.map((entry) => entry.id))
  if (current !== undefined) {
    const taken = await takenTaskIds(dir, phase)
    for (const entry of parseIndex(current, "task").entries) {
      if (snapIds.has(entry.id) || taken.has(entry.id)) continue
      await rm(join(dir, "docs", entry.id), { recursive: true, force: true })
    }
  }
  if (current !== snap.text) await Bun.write(file, snap.text)
  for (const [id, files] of snap.files) {
    const paths = taskStatePaths(id)
    for (const key of ["pending", "complete"] as const) {
      const was = files[key]
      if (was === undefined) {
        await rm(join(dir, paths[key]), { force: true })
      } else {
        const now = await Bun.file(join(dir, paths[key])).text().catch(() => undefined)
        if (now !== was) await Bun.write(join(dir, paths[key]), was)
      }
    }
  }
}

// The appending session (plans/0053 D23–D25): the planner that adds tasks to
// a phase whose index already lists some, over the persisted planning input
// (an append always has one: --append without input is refused up front, and
// this backstop catches a deleted plan-input.md). Modeled on planPhase and
// sharing its machinery — the numbering record, the input commit, the step
// resume point — with the snapshot → reset → collect cycle in place of the
// fresh planning output check. Returns 0 = append complete, 1 = no planning
// input, 2 = blocked.
// AUTO-DECISION: no spec.role is declared (either mode) — phaseToRole already
// maps the phase-append step to the phase-plan model role (D23/F6), and the
// append template is new surface, so no legacy implement-scan routing applies
// to it; declaring one would only fork the mapping.
export async function appendPlan(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const { directory, opts, server: serverHandle } = ctx
  // Appending plans against a planning input, checked first so a missing one
  // starts no numbering-restore session (the prelude and the shell check this
  // first; this backstops other shells and a deleted input file).
  if (!ctx.input && !(await readPlanInput(directory, phase))?.trim()) {
    log(`⏸ nothing to append ${phaseTitle(phase)} against: appending plans against a planning input, and ${planInputPath(phase)} is missing or empty`)
    return 1
  }
  // auto numbering: same as planPhase (a missing record is restored first, a
  // blocked restore exits 2).
  let numberStart: number | undefined
  if (opts.autoNumber) {
    const numbering = await ensureNumbering(serverHandle, directory, sessionOpts(ctx, { site: "append-numbering" }))
    if (numbering.type === "dirty") {
      log(`⏸ worktree not clean before restoring the numbering record; handle it manually (commit/clean) and re-run:`)
      for (const file of numbering.files) log(`  ${file}`)
      return 2
    }
    if (numbering.type === "blocked") {
      log(`⏸ numbering-record restore session blocked (implicit block, investigate and re-run):\n${numbering.question}`)
      return 2
    }
    numberStart = numbering.next
  }
  // The planning input (D9), exactly as in planPhase: a new text is persisted
  // and committed before the unit starts; a different text restarts an open
  // step in a new session, so no reused session plans against a text it never
  // saw. An append overwrites the phase's file — the latest input wins.
  let restart: string | undefined
  if (ctx.input) {
    const text = ctx.input.text
    const saved = await savePlanInput(directory, phase, ctx.input, phaseTitle(phase))
    if (saved.type === "dirty") {
      log(`⏸ worktree not clean before saving the planning input; handle it manually (commit/clean) and re-run:`)
      for (const file of saved.files) log(`  ${file}`)
      return 2
    }
    if (saved.type === "failed") {
      log(`⏸ ${saved.question}`)
      return 2
    }
    ctx.input = undefined
    if (saved.type === "saved") {
      log(`✓ planning input saved to ${planInputPath(phase)}`)
      restart = "the planning input changed"
      // The admission warn (plans/0082 §10 D14b): the same charter check over
      // the person's text, warn-and-record, never refuse.
      await admissionWarn(ctx, phase, text, `phase-append ${phaseKey(phase).id}`)
    }
  }
  const input = (await readPlanInput(directory, phase))?.trim() || undefined
  if (input && !restart) log(`ℹ appending against the persisted input ${planInputPath(phase)}`)
  // The append builds on an index that lists tasks; a re-entered step whose
  // index has gone missing (deleted by hand between runs) is an anomaly to
  // surface, not an empty snapshot to append onto.
  const taskIndex = taskIndexPath(phase)
  if (!(await Bun.file(join(directory, taskIndex)).exists())) {
    log(`⏸ ${taskIndex} is missing: the task-append step of ${phaseTitle(phase)} has no task index to append to (deleted by hand?); restore it or list tasks there, then re-run`)
    return 1
  }
  // The snapshot (D24): taken at step entry from disk, which preflight's clean
  // gate left at HEAD. On re-entry it includes whatever was committed meanwhile
  // (D24's residual), so a person's mid-append commit counts as existing work.
  const snap = await snapshotAppend(directory, phase)
  const plan = await loadPlan(directory, phase)
  // taken numbers = other phases' indexes and done tasks ∪ this phase's
  // existing entries (D24); without auto numbering, the prompt's numbering
  // start is the highest number among them + 1 (D25: the highest taken or
  // listed id + 1).
  // AUTO-DECISION: the collect enforces the numbering start only under
  // autoNumber (the record's value), exactly as planPhase does — without the
  // record only collisions with taken or listed ids are refused, so a gap id
  // the session picks below the prompt's start stays acceptable, as in planning.
  const taken = await takenTaskIds(directory, phase)
  const before = new Set([...taken, ...snap.entries.map((entry) => entry.id)])
  const listed = Math.max(0, ...[...before].map((id) => taskNumber(id) ?? 0)) + 1
  const promptStart = numberStart ?? listed
  // The project brief, comments stripped: an untouched stub injects nothing.
  const brief = await projectBriefText(directory)
  const phaseId = qualifiedPhase(phase)
  // The compose-and-verify loop (the append side of plans/0082 §5 D7 / §6
  // D9): an append plans against a human input too — plan --append or a
  // repair round's evidence — so its composed prompt is verified the same
  // way before its session runs; "remediate" re-composes and re-verifies.
  const compose = async (): Promise<{ prompt: string; blocks: BlockMapEntry[] }> => {
    const prompt = ctx.manual
      ? renderPhaseAppend(planFacts(ctx), {
          phaseId,
          taskIndex,
          numberStart: promptStart,
          input: input!,
          inputPath: planInputPath(phase),
          existingTasks: existingTaskList(plan.tasks),
          brief,
          parallel: opts.parallel,
        })
      : await phaseAppendPrompt(ctx, phase, { brief, input: input!, taskIndex, phaseId, numberStart: promptStart, existingTasks: existingTaskList(plan.tasks) })
    const blocks: BlockMapEntry[] = [
      { block: "template", source: "the phase-append template" },
      { block: "phase duties", source: "the active pack's phase-duties section" },
      { block: "brief", source: brief ? BRIEF_FILE : `${BRIEF_FILE} (absent)` },
      { block: "planning input", source: planInputPath(phase) },
      { block: "task index", source: taskIndex },
      ...(await earlierHandoverSources(directory, phase)),
    ]
    return { prompt, blocks }
  }
  let prompt = ""
  let verified: number | "remediate" = 0
  for (let pass = 0; ; pass++) {
    const composed = await compose()
    prompt = composed.prompt
    verified = await verifyPlanStep(ctx, phase, `phase-append ${phaseKey(phase).id}`, prompt, composed.blocks)
    if (verified !== "remediate") break
    if (pass >= 1) {
      log("⏸ the step re-blocked after two inline remediations; stopping — the diagnosis gate suspends further attempts")
      return 2
    }
  }
  if (verified !== 0) return verified
  let problems: string[] = []
  log(`▶ starting the task-append session to append to ${taskIndex}`)
  const appended = await requireArtifact(
    serverHandle,
    { id: "PLAN", title: `phase append (${phaseTitle(phase)})`, status: "in_progress", attempts: 0, body: "" },
    prompt,
    sessionOpts(ctx, { site: "phase-append" }),
    {
      kind: "task appending",
      step: { step: "phase-append", unit: phaseKey(phase).id },
      restart,
      // Independent hidden task unit: entry clean gate + SHA baseline + close-out
      // check (plans/0021-commit-boundary-design.md).
      unitStart: true,
      artifact: `new task lines appended to ${taskIndex} with their task documents (at least one new task)`,
      detail: "no new task, an existing line or task document changed, or a task number reusing a taken number",
      get requirement() {
        return (
          `append new task lines after the existing ones of ${taskIndex} (one per task, \`- [ ] T-NNN <task title>\`, at least one) ` +
          `and each new task's docs/T-NNN/todo.md (title line \`# T-NNN: <task title>\`, field line \`Phase: ${phaseId}\`, ` +
          `the three sections \`## Goal\` / \`## Scope\` / \`## Acceptance\`, last line \`<!-- auto: eof -->\`), ` +
          `without changing any existing index line or task document.` +
          (problems.length ? ` Problems last time: ${problems.join("; ")}.` : "")
        )
      },
      commit: { stage: "phase-append", subject: `PLAN append ${phaseTitle(phase)}` },
      reset: () => resetAppend(directory, phase, snap),
      collect: async () => {
        const checked = await appendProblems(directory, phase, snap, { before, numberStart })
        problems = checked.problems
        return problems.length ? undefined : checked.ids
      },
    },
  )
  if (!Array.isArray(appended)) {
    if (appended.type === "dirty") {
      log(`⏸ worktree not clean before starting the task-append session; handle it manually (commit/clean) and re-run:`)
      for (const file of appended.files) log(`  ${file}`)
    } else {
      log(`⏸ task-append session blocked (implicit block, investigate and re-run):\n${appended.question}`)
    }
    return 2
  }
  // auto numbering: on append success the numbering record advances to this
  // run's highest new number + 1 (only ever increases).
  if (numberStart !== undefined) {
    const next = await advanceNextTask(directory, appended)
    log(`✓ numbering record advanced: next available task number T-${String(next).padStart(3, "0")}(${NEXT_TASK_FILE})`)
  }
  log(`✓ task append complete: ${taskIndex} gained ${appended.length} task(s)`)
  ctx.planned = appended
  // Stale handover (plans/0053 D25/F13): a phase that was already distilled
  // has a handover.md that predates the appended tasks — the phase is
  // distilled again after they run, so the stale document goes now, in its own
  // commit; acceptance.md and verdict.md stay (the next distillation redrafts
  // the first, the new tasks may rewrite the second).
  const handover = phaseHandoverDoc(phase)
  if (await Bun.file(join(directory, handover)).exists()) {
    await rm(join(directory, handover))
    // The run's git seam carries the strategy: on the no-commit double the
    // ok answer keeps the failure branch dead (the removal itself still
    // happens, as the rename does in the prior-knowledge close-out).
    const settled = await ctx.git.commitTree(directory, { id: "PLAN", title: `phase append (${phaseTitle(phase)})` }, {
      stage: "phase-append",
      subject: `PLAN append ${phaseTitle(phase)}: remove the stale handover`,
    })
    if (!settled.ok) {
      log(
        `⏸ stale-handover removal commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. ` +
          `The deletion is kept in the worktree; commit manually and re-run (the append step re-enters idempotently)`,
      )
      return 2
    }
    log(`✓ stale handover removed: ${handover} (the phase is distilled again after the appended tasks)`)
  }
  // close-out: delete this step's driver-side resume point, the last step
  // (D25) — killed before this → the record is still active, and the next run
  // re-enters the append through openStep (idempotent). Known residual: if
  // the kill lands after the append unit's commit and before the close-out,
  // the re-entry snapshot already contains the committed appended tasks, and
  // the redo appends another batch (a residual the design accepts; plan stops
  // for human review, the duplication is visible and editable).
  await closeStep(directory, "phase-append", phaseKey(phase).id)
  return 0
}

// The phased appending prompt: phase-append over the project brief, the
// planning input, the earlier phases' handovers and the round brief (the
// existing tasks and the phase naming come with the shared template).
async function phaseAppendPrompt(
  ctx: LoopCtx,
  phase: PhaseUnit,
  parts: { brief?: string; input: string; taskIndex: string; phaseId: string; numberStart: number; existingTasks: string },
): Promise<string> {
  const { directory, opts } = ctx
  const state = await phaseState(directory)
  return renderPhaseAppend(planFacts(ctx), {
    phase: phase.entry,
    planDuties: planDuties(ctx, phase.entry),
    phaseId: parts.phaseId,
    taskIndex: parts.taskIndex,
    numberStart: parts.numberStart,
    input: parts.input,
    inputPath: planInputPath(phase),
    existingTasks: parts.existingTasks,
    brief: parts.brief,
    round: await roundBriefText(directory, state.round),
    handovers: await earlierHandovers(directory, phase, state),
    mode: opts.mode,
    parallel: opts.parallel,
  })
}

// Task appending plus the same stop handling as planWithStep (plans/0053 D6):
// under plan's stop condition the summary — over the appended ids — is the
// review point; under run the G5 pause applies as after a planning step.
export async function appendWithStep(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const code = await appendPlan(ctx, phase)
  if (code !== 0) return code
  if (ctx.opts.stopBefore === "execute") {
    for (const line of plannedLines(ctx.directory, phase, ctx.planned ?? [], ctx.manual)) log(line)
    return 0
  }
  await stepPause("phase", `phase ${phaseTitle(phase)} append`, { interactive: ctx.repl, dir: ctx.directory })
  // /exit checkpoint (phase boundary): the request flag lives in the run's
  // control service on ctx, as the router state does.
  ctx.control.maybeExit("phase", `phase ${phaseTitle(phase)} append`)
  return 0
}
