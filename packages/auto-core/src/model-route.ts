// Candidate lists of the model registry (plans/0055 §6.1): for a session's
// routing role and the current phase type, the route in force, the session's
// tier and the ordered internal names of the models it may run on. Pure over a
// loaded registry and before any usability check (windows, agent filter, down
// marks, context windows): the `models` command shows these lists, and
// selection picks from the same lists.
//
//   route = routes[role] ?? routes[type] ?? routes[letter]
//   tier  = the route's tier when it names one, else defaultTier (src/tier.ts)
//   list  = the route's list when it is one, else the tier's list; a simple
//           tier continues down the deep list (borrowing, R3), and a deep tier
//           never borrows a simple model
//
// The OPENCODE_AUTO_MODEL and `/failback` overrides replace the list where a
// dispatch resolves its model (§6.1 line 4); they are not part of this helper.
import type { ModelRegistry, ModelRoute } from "./models"
import type { PhaseTypeEntry, Tier } from "./phases/registry"
import { MODEL_ROLES, type ModelRole } from "./switches"
import { defaultTier } from "./tier"

export type CandidateList = {
  tier: Tier
  // The route in force; undefined = the program default tier.
  route?: ModelRoute
  // Internal model names in the order selection tries them.
  names: string[]
  // How many leading names are the session's own list; the rest are borrowed
  // from the deep list (a simple tier only).
  own: number
}

// The route of a session: its role word first, then its phase type id, then
// the type's preset letter (the OPENCODE_AUTO_MODEL key precedence). `entry`
// is the current phase type (`opts.phase?.entry`); without one only the role
// routes.
// AUTO-RESOLVE: does a route keyed by a word that is both a role and a builtin type id (`knowledge`) also route that phase type? -> no, it routes the role only, and the type is routed by its letter (`k`), exactly as an OPENCODE_AUTO_MODEL key reads a role word as the role (the registry's routes take the same key vocabulary and precedence, so the two must not read one key differently)
export function routeFor(
  routes: ReadonlyMap<string, ModelRoute>,
  entry: PhaseTypeEntry | undefined,
  role: ModelRole,
): ModelRoute | undefined {
  const byRole = routes.get(role)
  if (byRole !== undefined || entry === undefined) return byRole
  const byType = ROLE_WORDS.includes(entry.type) ? undefined : routes.get(entry.type)
  return byType ?? (entry.letter === undefined ? undefined : routes.get(entry.letter))
}

const ROLE_WORDS: readonly string[] = MODEL_ROLES

// The candidate list of a session (§6.1 lines 1–3).
// AUTO-DECISION: a model on both tier lists is not borrowed a second time (the simple list already holds it at its earlier position, and a second entry would only make selection test the same model twice)
export function candidateList(
  registry: Pick<ModelRegistry, "routes" | "tiers">,
  entry: PhaseTypeEntry | undefined,
  role: ModelRole,
): CandidateList {
  const route = routeFor(registry.routes, entry, role)
  const tier = route !== undefined && "tier" in route ? route.tier : defaultTier(entry, role)
  if (route !== undefined && "names" in route) return { tier, route, names: [...route.names], own: route.names.length }
  const own = registry.tiers[tier]?.names ?? []
  const borrowed = tier === "simple" ? (registry.tiers.deep?.names ?? []).filter((name) => !own.includes(name)) : []
  return { tier, ...(route ? { route } : {}), names: [...own, ...borrowed], own: own.length }
}
