// Default reasoning tiers (plans/0055 §5): the tier every session gets from the
// program, derived from its routing role and the current phase type. Planning
// and understanding sessions are deep, because every later session inherits
// their mistakes. The task sessions (`whole`, `subtask`) take the phase type's
// execute tier (`PhaseTypeEntry.reasoning`). Reports, distillation, extraction
// and one-off sessions are simple.
//
// The tier is a property of the work (§3): it lives in the program (this table
// and the builtin types) and in the project (a custom type's `Reasoning:`
// field), never in the operator's model registry. An operator's registry
// routes may override it for their own machine; that happens where a model is
// selected, not here.
import { phaseType, type PhaseTypeEntry, type Tier } from "./phases/registry"
import type { ModelRole } from "./switches"

// "execute" = the phase type's execute tier. Typed over every role word, so a
// role added to MODEL_ROLES without a tier here fails the typecheck.
const ROLE_TIERS: Record<ModelRole, Tier | "execute"> = {
  // Append planning routes as phase-plan too (the phase-append step kind).
  "phase-plan": "deep",
  // m mode's planning scan.
  "implement-scan": "deep",
  // Understands the task and writes context.md and the subtask plan.
  decompose: "deep",
  whole: "execute",
  subtask: "execute",
  wrapup: "simple",
  "phase-handover": "simple",
  knowledge: "simple",
  "prior-knowledge": "simple",
  "number-recovery": "simple",
  // Confirm turns and the other one-off sessions.
  bypass: "simple",
}

// m mode runs without a phase entry: it is the implicit implement phase.
const IMPLICIT_PHASE_TYPE = "implement"

// The program-default tier of a session. `entry` is the current phase's type
// (`opts.phase?.entry`, as resolveModel takes it), undefined in m mode.
export function defaultTier(entry: PhaseTypeEntry | undefined, role: ModelRole): Tier {
  const tier = ROLE_TIERS[role]
  if (tier !== "execute") return tier
  return (entry ?? phaseType(IMPLICIT_PHASE_TYPE)!).reasoning
}
