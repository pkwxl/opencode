// Render facts for the legacy planning step.
import type { LoopCtx } from "./loop-task"
import type { PhaseUnit } from "./phases"
import type { PhaseTypeEntry } from "./phases/registry"
import { promptFacts } from "./prompt-facts"

// The planning renders' facts (E2): the bypass sessions' human-questions mode
// is the stop condition's — the same rule sessionOpts applies to every bypass
// site, so a planning prompt renders the question-rule's human-answer branch
// exactly when its session would wait for the human (plan and transfer,
// plans/0101 D2, both attend).
export const planFacts = (ctx: LoopCtx) => promptFacts({ dir: ctx.directory, humanQuestions: ctx.opts.stopBefore !== undefined, intent: ctx.opts.intent })

// The phase type entry of a formulation's charter resolution (plans/0097 D1;
// keyed by type id since plans/0100 D9, the preset letter a legacy fallback).
// m mode passes none (the pack-global charter alone resolves, D10).
export const charterPhaseEntry = (ctx: LoopCtx, phase: PhaseUnit): PhaseTypeEntry | undefined => (ctx.manual ? undefined : phase.entry)
