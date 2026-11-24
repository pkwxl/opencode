// Helpers for the planning step (split out of
// src/loop-plan.ts by plans/0235): the render facts (planFacts, planDuties),
// the formulation charter's phase entry (charterPhaseEntry) and the
// synthesis audit entries' write (plans/0097 D6) — the wall-document
// discipline the round's prompt-audit.md commits through. The charter
// verifier gate (plans/0080 §5) and the planning input's admission warn
// (plans/0082 §10 D14b) are retired (plans/0283): the planning setup
// is deterministic, no verifier session ahead of them — the guarantees'
// mechanical asserts and the settlement's checks judge what the sessions
// compose. Direction: loop-plan → plan-gate → prompt-verify
// (appendAudit); never imports the loops.
import { dirname, join } from "node:path"
import type { LoopCtx } from "./loop-task"
import { phaseKey, type PhaseUnit } from "./phases"
import type { PhaseTypeEntry } from "./phases/registry"
import { planInputPath } from "./plan-input"
import { promptFacts } from "./prompt-facts"
import { planDutyText } from "./prompt-plan"
import { appendAudit } from "./prompt-verify"

// The planning renders' facts (E2): the bypass sessions' human-questions mode
// is the stop condition's — the same rule sessionOpts applies to every bypass
// site, so a planning prompt renders the question-rule's human-answer branch
// exactly when its session would wait for the human (plan and transfer,
// plans/0101 D2, both attend).
export const planFacts = (ctx: LoopCtx) => promptFacts({ dir: ctx.directory, humanQuestions: ctx.opts.stopBefore !== undefined, intent: ctx.opts.intent })

// A phase type's duty paragraph for formulation (E2): prompt-plan's
// planDutyText — the type's own `## plan duties` (custom types), then — the
// pack tier, plans/0080 §4 — the active pack's `### <dutiesRef>` under `##
// phase duties`, then the core shared partial, rendered through the active
// library so overlays apply. The ctx (plans/0095 D4) threads the two facts
// the pack texts reference, fixing the empty-paren / dropped-conditional
// render of the empty-ctx era; the measured-delta block (plans/0244 D7) keys the t/v duty copy's `{{#if delta}}` clauses, absent keeps
// the paragraph's pre-0244 bytes (the P10 floor).
export const planDuties = (ctx: LoopCtx, entry: PhaseUnit["entry"], delta?: boolean): string =>
  planDutyText(planFacts(ctx), entry, { phaseName: entry.name, ...(ctx.opts.testByDriver ? { testByDriver: true } : {}), ...(delta ? { delta: true } : {}) })

// The phase type entry of a formulation's charter resolution (plans/0097 D1;
// keyed by type id since plans/0100 D9, the preset letter a legacy fallback).
// m mode passes none (the pack-global charter alone resolves, D10).
export const charterPhaseEntry = (ctx: LoopCtx, phase: PhaseUnit): PhaseTypeEntry | undefined => (ctx.manual ? undefined : phase.entry)

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
