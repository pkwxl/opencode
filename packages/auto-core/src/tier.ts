// Default reasoning tiers (plans/0055 §5): the tier every session gets from the
// program, derived from its routing role and the current phase type. Planning
// and understanding sessions are deep, because every later session inherits
// their mistakes. The task sessions (`whole`, `subtask`) take the phase type's
// execute tier (`PhaseTypeEntry.reasoning`). Reports, distillation, extraction
// and one-off sessions are simple.
//
// The tier is a property of the work (§3): it lives in the program (the
// session-role registry's descriptors and the builtin phase types) and in the
// project (a custom type's `Reasoning:` field), never in the operator's model
// registry. An operator's registry routes may override it for their own
// machine; that happens where a model is selected, not here.
import { phaseType, type PhaseTypeEntry, type Tier } from "./phases/registry"
import { roleTiers } from "./roles/registry"
import type { ModelRole } from "./switches"

// The role table of §5 reads from the session-role registry
// (src/roles/registry.ts): each work kind's descriptor declares the tier its
// routing words take — planning and understanding deep, the task sessions
// "execute", reports/distillation/extraction simple — and the fallback
// constant covers `bypass` (confirm turns and the other one-off sessions).
// Total over MODEL_ROLES by construction: a role word added without a
// descriptor home fails loudly at this table's build (roleTiers throws
// naming the word), not silently here.
const ROLE_TIERS: Record<ModelRole, Tier | "execute"> = roleTiers()

// m mode runs without a phase entry: it is the implicit implement phase.
const IMPLICIT_PHASE_TYPE = "implement"

// The program-default tier of a session. `entry` is the current phase's type
// (`opts.phase?.entry`, as resolveModel takes it), undefined in m mode.
export function defaultTier(entry: PhaseTypeEntry | undefined, role: ModelRole): Tier {
  const tier = ROLE_TIERS[role]
  if (tier !== "execute") return tier
  return (entry ?? phaseType(IMPLICIT_PHASE_TYPE)!).reasoning
}
