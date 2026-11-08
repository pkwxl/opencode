// The plan-step gate both planning sessions pass (plans/0080 §5; split out
// of src/loop-plan.ts by plans/0235 so that module keeps its under-600
// promise): before a planning or append session runs, its composed prompt is
// judged against the active pack's verify-plan charter (verifyPlanStep) and
// the verdict recorded in the round's prompt-audit.md; the planning input's
// admission warn (plans/0082 §10 D14b) and the synthesis audit entries'
// write (plans/0097 D6) commit through the same wall-document discipline;
// the render facts both planning halves share (planFacts, planDuties,
// charterPhaseEntry) live here too. Direction: loop-plan/loop-append →
// plan-gate → prompt-verify; never imports the loops.
import { dirname, join } from "node:path"
import { openBlockage, type BlockageSite } from "./blockage-diagnose"
import type { BlockMapEntry } from "./blockage"
import type { LoopCtx } from "./loop-task"
import { log } from "./log"
import { sessionOpts } from "./opts"
import { phaseKey, type PhaseUnit } from "./phases"
import type { PhaseTypeEntry } from "./phases/registry"
import { planInputPath } from "./plan-input"
import { promptFacts } from "./prompt-facts"
import { planDutyText } from "./prompt-plan"
import { appendAudit, checkTextAgainstCharter, verifyAuditEntry, verifyPlanPrompt } from "./prompt-verify"

// The planning renders' facts (E2): the bypass sessions' human-questions mode
// is the stop condition's — the same rule sessionOpts applies to every bypass
// site, so a planning prompt renders the question-rule's human-answer branch
// exactly when its session would wait for the human (plan and transfer,
// plans/0101 D2, both attend).
export const planFacts = (ctx: LoopCtx) => promptFacts({ dir: ctx.directory, humanQuestions: ctx.opts.stopBefore !== undefined, intent: ctx.opts.intent })

// A phase type's duty paragraph for the append prompt (E2): prompt-plan's
// planDutyText — the type's own `## plan duties` (custom types), then — the
// pack tier, plans/0080 §4 — the active pack's `### <dutiesRef>` under `##
// phase duties`, then the core shared partial, rendered through the active
// library so overlays apply. The ctx (plans/0095 D4) threads the two facts
// the pack texts reference, fixing the empty-paren / dropped-conditional
// render of the empty-ctx era.
export const planDuties = (ctx: LoopCtx, entry: PhaseUnit["entry"]): string =>
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
// The phase type entry of a formulation's charter resolution (plans/0097 D1;
// keyed by type id since plans/0100 D9, the preset letter a legacy fallback).
// m mode passes none (the pack-global charter alone resolves, D10).
export const charterPhaseEntry = (ctx: LoopCtx, phase: PhaseUnit): PhaseTypeEntry | undefined => (ctx.manual ? undefined : phase.entry)

export async function verifyPlanStep(ctx: LoopCtx, phase: PhaseUnit, step: string, prompt: string, blocks: readonly BlockMapEntry[]): Promise<number | "remediate"> {
  const outcome = await verifyPlanPrompt({ pool: ctx.server, routing: ctx.routing, facts: planFacts(ctx), step, prompt, entry: charterPhaseEntry(ctx, phase) })
  if (outcome.kind === "inactive") return 0
  const audit = join(dirname(phase.dir), "prompt-audit.md")
  // The previous text feeds the block site's auditTail below (the dossier's
  // state snapshot reads the pre-append verdict lines); appendAudit re-reads
  // the same unchanged file for the write.
  const previous = await Bun.file(join(ctx.directory, audit)).text().catch(() => "")
  // The audit write commits on its own ahead of the session it documents: the
  // planning unit's entry clean gate demands a clean tree, so an uncommitted
  // wall document would block the very step it records (Auto-DECISION: a
  // dedicated prompt-audit commit, the savePlanInput pattern, instead of
  // riding the session's unified commit — §5's "written before the session"
  // stays true in git order, and the record survives a session that never
  // runs; found by the §7 session-driving coverage, T-141).
  if (
    !(await appendAudit(
      ctx.directory,
      audit,
      verifyAuditEntry(step, outcome),
      ctx.git.commitTree,
      `plan verification (${step})`,
      step,
      (failures) => `⏸ prompt-audit commit failed: ${failures}. The record is kept in the worktree; commit manually and re-run`,
    ))
  ) {
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
// judges the composed whole. A check that could not judge renders as
// unjudged (plans/0208 D1): one honest line and a FAILED-shaped audit entry,
// no conflict recorded — a WARN is a real flag's alone.
export async function admissionWarn(ctx: LoopCtx, phase: PhaseUnit, text: string, step: string): Promise<void> {
  const check = await checkTextAgainstCharter({
    server: ctx.server,
    routing: ctx.routing,
    dir: ctx.directory,
    intent: ctx.opts.intent,
    label: `the planning input admitted to ${planInputPath(phase)}`,
    text,
  })
  if (check.kind === "failed") {
    log(
      `⚠ the planning input could not be judged against the intent charter (${planInputPath(phase)}): ${check.reason} — ` +
        `no conflict recorded (the run proceeds, and the composition-time gate still judges the composed whole)`,
    )
    const audit = join(dirname(phase.dir), "prompt-audit.md")
    const stamp = new Date().toISOString()
    await appendAudit(
      ctx.directory,
      audit,
      `- ${stamp} admission ${step}: FAILED — the planning input could not be judged: ${check.reason}; no conflict recorded`,
      ctx.git.commitTree,
      `plan admission unjudged (${step})`,
      `admission unjudged ${step}`,
      (failures) => `⚠ the admission record could not be committed: ${failures}; commit ${audit} manually`,
    )
    return
  }
  if (check.kind !== "flagged") return
  log(`⚠ the planning input conflicts with the intent charter (${planInputPath(phase)}): the charter-consistent reading in force is "${check.reading}" — the run proceeds, and the composition-time gate still judges the composed whole`)
  const audit = join(dirname(phase.dir), "prompt-audit.md")
  const stamp = new Date().toISOString()
  await appendAudit(
    ctx.directory,
    audit,
    `- ${stamp} admission ${step}: WARN — the planning input conflicts with the charter; in force: ${check.reading}`,
    ctx.git.commitTree,
    `plan admission warn (${step})`,
    `admission warn ${step}`,
    (failures) => `⚠ the admission-warn record could not be committed: ${failures}; commit ${audit} manually`,
  )
}

// The synthesis audit entries' write (plans/0097 D6): appended to the round's
// prompt-audit.md and committed on its own ahead of construction (stage
// prompt-audit, the verifier's discipline — the record survives a session
// that never runs, and the planning unit's clean gate finds a committed
// tree). false = the commit failed; the caller blocks (the entry clean gate
// would refuse the uncommitted wall document anyway).
export async function recordSynthesisAudit(ctx: LoopCtx, phase: PhaseUnit, lines: readonly string[]): Promise<boolean> {
  return appendAudit(
    ctx.directory,
    join(dirname(phase.dir), "prompt-audit.md"),
    lines.join("\n"),
    ctx.git.commitTree,
    `formulation synthesis (${phaseKey(phase).id})`,
    `synthesis ${phaseKey(phase).id}`,
    (failures) => `⏸ synthesis-audit commit failed: ${failures}. The record is kept in the worktree; commit manually and re-run`,
  )
}
