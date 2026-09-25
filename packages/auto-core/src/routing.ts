// The run's dispatch routing under a model registry (plans/0055 §6, §9): the
// facts every registry-driven dispatch shares, fixed once at run start — the
// loaded registry, the agent filter (§6.2 rule 1: the shell profile's agent
// or OPENCODE_AUTO_AGENT) and the default agent (§9 R6: the project's
// configured agent, the one raw override values and unqualified session
// records use). Selection itself stays pure in src/select.ts; this module
// injects the run state around it (the down marks, the /failback override,
// the context windows) and owns the run-start routing block (§6.5) and the
// tier-coverage refusal of the run start (§6.3).
//
// Without a registry nothing here runs: the dispatch resolvers keep their
// env-switch path (resolveModel, src/chain.ts), byte for byte.
import { downMarks, failbackOverride } from "./failback"
import { log } from "./log"
import { formatWindowState, windowState } from "./model-window"
import { layerLabel, type ModelRegistry } from "./models"
import { candidateKey, select, type Candidate, type SelectContext } from "./select"
import { shellProfile } from "./shell"
import { autoSwitches, SWITCH_ENV, type AgentChoice, type Switches } from "./switches"

// The run-level facts of registry routing. `clock` is the injected instant
// source (tests steer it past window boundaries); absent = the machine clock.
export type RoutingFacts = {
  registry: ModelRegistry
  // §6.2 rule 1: the adapter name only models on matching profiles pass;
  // undefined = no filter, every profile's models are candidates.
  agentFilter: string | undefined
  // Where the filter came from, for the run-start block ("shell profile" or
  // the OPENCODE_AUTO_AGENT switch); undefined with the filter.
  filterSource: string | undefined
  // §9 R6: the project's configured agent — the default agent raw override
  // values run on and unqualified session records belong to.
  defaultAgent: string
  clock?: () => number
}

// The routing facts of a run: the agent filter follows the same precedence
// the agent start uses (shell profile > OPENCODE_AUTO_AGENT > the configured
// agent, src/agent-choice.ts), the default agent is the configured agent
// alone (R6: it is not a filter, so a single-agent fleet keeps working).
// AUTO-DECISION: while the run still has one agent, the filter falls back to the configured agent (the run cannot dispatch a model on an adapter it never started, so cross-adapter candidates are refused already at selection); when the agent pool runs one host per profile, the filter narrows to the shell profile's agent and OPENCODE_AUTO_AGENT, as ruled, and the configured agent keeps only its default-agent role
export function routingFacts(registry: ModelRegistry, configuredAgent: AgentChoice | undefined): RoutingFacts {
  const profile = shellProfile().agent?.name
  const env = autoSwitches().agent
  return {
    registry,
    agentFilter: profile ?? env ?? configuredAgent ?? "opencode",
    filterSource: profile ? "shell profile" : env ? "OPENCODE_AUTO_AGENT" : undefined,
    defaultAgent: configuredAgent ?? "opencode",
  }
}

// The instant of a dispatch: the injected clock when the facts carry one,
// else the machine clock.
export function nowOf(facts: RoutingFacts): number {
  return facts.clock?.() ?? Date.now()
}

// The selection context of one dispatch: the run facts plus the volatile run
// state (the policy of OPENCODE_AUTO_MODEL, the /failback override, the down
// marks) and the live context windows when the caller has them. The marks map
// is the live module map (never replaced), the override is read per call.
export function selectContext(
  facts: RoutingFacts,
  switches: Switches,
  cap: number,
  limits?: ReadonlyMap<string, number>,
): SelectContext {
  return {
    registry: facts.registry,
    cap,
    agentFilter: facts.agentFilter,
    defaultAgent: facts.defaultAgent,
    policy: switches.model,
    override: failbackOverride(),
    marks: downMarks(),
    ...(limits !== undefined ? { limits } : {}),
  }
}

// §6.3's run-start refusal: a tier the run's sessions need that has no
// candidate left after the agent filter never becomes a silent wait. The
// check reads the tier lists only (windows, marks and rings change during a
// run); a route or override that empties a list surfaces at its dispatch.
// AUTO-DECISION: the needed tiers are simple (bypass and wrap-up sessions exist in every mode) plus deep when the run plans or scans (a phased run, or m mode with a planning input); route lists and override values are not checked (which routes a run dispatches depends on its config, and an override that names a filtered-out model is a per-session mistake the dispatch itself refuses)
export function tierCoverageProblems(registry: ModelRegistry, agentFilter: string | undefined, deepNeeded: boolean): string[] {
  const passes = (name: string): boolean => {
    if (agentFilter === undefined) return true
    const entry = registry.models.get(name)
    const adapter = entry !== undefined ? registry.agents.get(entry.agent)?.adapter : undefined
    return adapter === agentFilter
  }
  const problems: string[] = []
  for (const tier of deepNeeded ? (["deep", "simple"] as const) : (["simple"] as const)) {
    const list = registry.tiers[tier]
    const names = list?.names ?? []
    if (!names.some(passes)) {
      const what = list === undefined ? "is not declared" : names.length ? `has no candidate left after the agent filter ${agentFilter}` : "is declared empty"
      problems.push(
        `model registry: the ${tier} tier ${what} (tiers.${tier}: ${names.join(", ") || "(empty)"}); ` +
          `every ${tier} session of this run would have no model to dispatch on`,
      )
    }
  }
  return problems
}

// The run-start routing block (§6.5): each tier's list with every model's
// agent, window state now and key-ring size, the routes in force, the agent
// filter, the project-layer marks and the unused-model notes — and the R6
// note when no tier uses the default agent.
// AUTO-DECISION: the ring is shown as the entry's declared key count (the references the registry validates); key rotation itself is a later step, so the count is the fleet's shape, not a live position
export function logRunRouting(facts: RoutingFacts): void {
  const { registry } = facts
  const now = nowOf(facts)
  log(`◇ model registry: ${registry.layers.map((layer) => layerLabel(layer)).join(" · ")}`)
  for (const tier of ["deep", "simple"] as const) {
    const list = registry.tiers[tier]
    const label = `◇ tier ${tier}${list ? ` [${list.layer} layer]` : ""}:`
    if (list === undefined) {
      log(`${label} (not declared)`)
      continue
    }
    const shown = list.names.map((name) => {
      const entry = registry.models.get(name)
      if (entry === undefined) return name
      const state = formatWindowState(windowState(entry, registry.tz, now), registry.tz, now)
      const ring = entry.keys?.length ?? 0
      const project = entry.layer === "project" ? " · project layer" : ""
      return `${name} (${entry.agent}, ${state}, ring ${ring}${project})`
    })
    log(`${label} ${shown.join(" → ") || "(empty)"}`)
  }
  if (registry.routes.size) {
    const routes = [...registry.routes.values()].map((route) =>
      `${route.key} → ${"tier" in route ? `tier ${route.tier}` : `models ${route.names.join(", ")}`} [${route.layer} layer]`,
    )
    log(`◇ routes in force: ${routes.join(" · ")}`)
  } else log("◇ routes in force: none (the default tiers route)")
  log(
    facts.agentFilter !== undefined
      ? `◇ agent filter: ${facts.agentFilter}${facts.filterSource ? ` (${facts.filterSource})` : ""}: only models on ${facts.agentFilter} profiles are candidates`
      : "◇ agent filter: none: models on every agent profile are candidates",
  )
  // R6: the default agent is not a filter — say so when no tier runs on it.
  const usesDefault = [...Object.values(registry.tiers)].some((list) =>
    list.names.some((name) => registry.agents.get(registry.models.get(name)?.agent ?? "")?.adapter === facts.defaultAgent),
  )
  if (!usesDefault)
    log(`ℹ no tier lists a model on the default agent ${facts.defaultAgent} (config agent): raw ${SWITCH_ENV.model} values and unqualified session records still use it`)
  if (registry.unused.length)
    log(`ℹ unused models (no tier, route list or classifier names them): ${registry.unused.join(", ")}`)
  if (registry.classifier) log(`◇ classifier: [${registry.classifier.layer} layer] ${registry.classifier.names.join(", ") || "(empty)"}`)
}

// Re-exported for the dispatch resolvers: the key a candidate is known by
// (the internal name of an entry, the model string of a raw override value).
export { candidateKey, type Candidate }
