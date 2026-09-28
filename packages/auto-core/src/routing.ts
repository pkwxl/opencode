// The run's dispatch routing under a model registry (plans/0055 §6, §9): the
// facts every registry-driven dispatch shares, fixed once at run start — the
// loaded registry, the agent filter (§6.2 rule 1: the shell profile's agent
// or OPENCODE_AUTO_AGENT) and the default agent (§9 R6: the project's
// configured agent, the one raw override values and unqualified session
// records use). Selection itself stays pure in src/select.ts; this module
// injects the run state around it (the down marks, the /failback override,
// the context windows) and owns the run-start routing block (§6.5) and the
// dispatch-coverage refusal of the run start (§6.3).
//
// Without a registry nothing here runs: the dispatch resolvers keep their
// env-switch path (resolveModel, src/chain.ts), byte for byte.
import { ringHasUsableKey, ringInactiveNote, ringLabel } from "./keyring"
import { log } from "./log"
import { candidateList } from "./model-route"
import { formatWindowState, windowState } from "./model-window"
import { layerLabel, type ModelRegistry, type RegistryAgentProfile } from "./models"
import type { PhaseTypeEntry } from "./phases/registry"
import type { Router } from "./router"
import { candidateKey, select, type Candidate, type SelectContext } from "./select"
import type { Clock } from "./services"
import { shellProfile } from "./shell"
import { autoSwitches, SWITCH_ENV, type AgentChoice, type ModelRole, type Switches } from "./switches"

// The run-level facts of registry routing. `clock` is the run's one clock,
// carried as data: the pure dispatch decision (src/engine/dispatch.ts) and
// every selection site read time through the facts and must not reach the
// run's services, so the composition root (preflight, the loop, the agent
// pool) fills the field from the installed services' clock — the facts and
// the engine share one timeline. `random` is the window wait's jitter knob
// (hibernate's 0–600 s delay); absent = Math.random.
// AUTO-DECISION: the wait's random rides RoutingFacts beside the clock instead of new runSession parameters (the facts are already the one injection point tests use to steer selection, and the wait is the only consumer — new signatures on runSession would spread test knobs through every caller). The wait's clock and sleep folded into the run services' clock: the sleeps go through the services the engine reads, and the facts carry only the clock as data.
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
  // §8.2: the agent profile this run starts on — the profile the pool names
  // as its default (agentProfileFor of the chosen agent; the chosen agent's
  // own name when the registry has no profile of its adapter). A dispatch
  // may still land on any profile the selection picks (§8.1: one host per
  // profile, started lazily); this name is what an unqualified record and a
  // raw override value resolve to.
  runAgent: string
  // The run's router service (the routing decision state: the /failback
  // override, the down marks, the key marks the ring predicate reads):
  // carried beside the clock as the handle the selection context injects —
  // the pure selection code and this module must not reach the ambient
  // services, so the composition (an entry module) fills the field from the
  // installed holder, and tests pin their own instance the same way they pin
  // the clock. The facts themselves stay fixed once built; the router is the
  // run's live state behind the reference.
  router: Router
  clock: Clock
  random?: () => number
}

// The routing facts of a run: the agent filter follows the same precedence
// the agent choice uses minus the configured agent (shell profile >
// OPENCODE_AUTO_AGENT, src/agent-choice.ts) — under a registry the filter is
// only those two (§9 R6: the project's configured agent is the default agent
// raw override values and unqualified records use, never a filter, so a
// single-agent fleet keeps working on a project initialized with
// `--agent claude`). The default agent is the configured agent alone.
// runAgent is the profile the run's host starts with, passed by the loop
// from the pool's start (the one place that picks the profile); the
// fallback (the configured agent's own name) is exact whenever the profile is
// named like its adapter, which the implied `opencode` profile always is —
// callers that never started an agent (the coverage check, tests) may rely on
// it. clock and router are the run services' clock and router, passed by the
// caller (the module must not reach the run's services itself); they ride the
// facts so the pure dispatch decision reads the same timeline and the same
// routing state the engine runs on.
// AUTO-DECISION: the filter names an adapter, never a profile (the filter values — the shell profile's agent and OPENCODE_AUTO_AGENT — name adapters by the agent-choice rule, and every profile of that adapter passes; a profile-name filter would silently empty every list when no profile bears the name, which §6.3 already reports better at its own layer)
export function routingFacts(
  registry: ModelRegistry,
  configuredAgent: AgentChoice | undefined,
  clock: Clock,
  router: Router,
  runAgent?: string,
): RoutingFacts {
  const profile = shellProfile().agent?.name
  const env = autoSwitches().agent
  return {
    registry,
    agentFilter: profile ?? env,
    filterSource: profile ? "shell profile" : env ? "OPENCODE_AUTO_AGENT" : undefined,
    defaultAgent: configuredAgent ?? "opencode",
    runAgent: runAgent ?? configuredAgent ?? "opencode",
    router,
    clock,
  }
}

// The instant of a dispatch: the facts' clock (the run services' clock the
// composition filled in).
export function nowOf(facts: RoutingFacts): number {
  return facts.clock.now()
}

// The selection context of one dispatch: the run facts plus the volatile run
// state (the policy of OPENCODE_AUTO_MODEL, the /failback override, the down
// marks, the key rings' usable-key predicate) and the live context windows
// when the caller has them. The marks map and the rings are live run state
// behind the facts' router (never replaced), the override is read per call.
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
    override: facts.router.failbackOverride(),
    marks: facts.router.downMarks(),
    ringUsable: (provider, now) => ringHasUsableKey(facts.router, provider, now),
    ...(limits !== undefined ? { limits } : {}),
  }
}

// One dispatch the run can send (plans/0055 §6.3): a routing role under the
// phase type in force when it runs (undefined = a run-level role no phase
// owns). The coverage check reads the need's candidate list, so an operator's
// route that empties a role's list is caught like an emptied tier.
export type DispatchNeed = { role: ModelRole; entry?: PhaseTypeEntry }

// §6.3's run-start refusal, per dispatch: for every need the run can send,
// the candidate list (the route in force, the tier's list with borrowing)
// must hold at least one candidate the agent filter keeps — a list left empty
// by the filter is a usage error, never a silent wait. One line per empty
// list (the first need that hits it is named), naming the tier or route, the
// role or phase type and the filter. The check reads the lists only: windows,
// down marks and key rings change during a run, and a list that empties only
// through them waits or probes at its dispatch. The OPENCODE_AUTO_MODEL and
// /failback overrides replace a list per dispatch and are not checked either
// (a value naming a filtered-out model is a per-session refusal the dispatch
// itself raises).
// AUTO-DECISION: the refusal is per (role, phase type) need instead of per tier, and one line names one representative need (the fix is the same for every consumer of the emptied list, and a line per need would repeat the same tier for every phase type of a phased run)
export function dispatchCoverageProblems(
  registry: ModelRegistry,
  agentFilter: string | undefined,
  needs: readonly DispatchNeed[],
): string[] {
  const passes = (name: string): boolean => {
    if (agentFilter === undefined) return true
    const entry = registry.models.get(name)
    const adapter = entry !== undefined ? registry.agents.get(entry.agent)?.adapter : undefined
    return adapter === agentFilter
  }
  const problems: string[] = []
  const reported = new Set<string>()
  for (const need of needs) {
    const list = candidateList(registry, need.entry, need.role)
    if (list.names.some(passes)) continue
    // One line per emptied list source (the tier, or the route in force).
    const source = list.route !== undefined ? `route ${list.route.key}` : `tier ${list.tier}`
    if (reported.has(source)) continue
    reported.add(source)
    const who =
      need.entry === undefined
        ? `the ${need.role} sessions of this run`
        : `the ${need.role} sessions of ${need.entry.type} phases`
    const fix = "fix the registry or the agent filter and re-run"
    if (list.route === undefined) {
      const declared = registry.tiers[list.tier]
      const names = declared?.names ?? []
      const state =
        declared === undefined
          ? "is not declared"
          : names.length
            ? `has no candidate left after the agent filter ${agentFilter}`
            : "is declared empty"
      problems.push(
        `model registry: the ${list.tier} tier ${state} (tiers.${list.tier}: ${names.join(", ") || "(empty)"}); ` +
          `${who} would have no model to dispatch on (${fix})`,
      )
    } else {
      const state = list.names.length ? `has no candidate left after the agent filter ${agentFilter}` : "is declared empty"
      const via = "names" in list.route ? "" : ` (the ${list.tier} tier)`
      problems.push(
        `model registry: route ${list.route.key}${via} ${state} (route ${list.route.key}: ${list.names.join(", ") || "(empty)"}); ` +
          `${who} would have no model to dispatch on (${fix})`,
      )
    }
  }
  return problems
}

// The agent profiles a run can dispatch on (§8.5, §8.7): every profile with a
// candidate in some list — the tier lists and the route name lists — after
// the agent filter. The capability intersection degrades over these, and
// preflight checks their bins; a profile no list names never enters (it never
// starts either, §8.1). Each entry carries the internal names that put the
// profile in the set, registry order, for the notes that name the forcing
// agent (`claude (opus)`).
// AUTO-DECISION: the classifier list does not widen the set (the classifier's one-shot session runs on the sessions' agents' capabilities — the intersection already covers what a dispatch needs — and v1 accepts opencode classifiers only, whose profiles the tiers usually name anyway; pulling a classifier-only profile into the intersection would turn off run-wide switches for a session the run's own dispatches never take)
export function dispatchAgentProfiles(
  registry: ModelRegistry,
  agentFilter: string | undefined,
): { profile: RegistryAgentProfile; names: string[] }[] {
  const byProfile = new Map<string, string[]>()
  const add = (name: string): void => {
    const entry = registry.models.get(name)
    if (entry === undefined) return
    if (agentFilter !== undefined && registry.agents.get(entry.agent)?.adapter !== agentFilter) return
    const names = byProfile.get(entry.agent) ?? []
    if (!names.includes(name)) names.push(name)
    byProfile.set(entry.agent, names)
  }
  for (const list of Object.values(registry.tiers)) for (const name of list?.names ?? []) add(name)
  for (const route of registry.routes.values()) if ("names" in route) for (const name of route.names) add(name)
  return [...registry.agents.values()].flatMap((profile) => {
    const names = byProfile.get(profile.name)
    return names ? [{ profile, names }] : []
  })
}

// The run-start routing block (§6.5): each tier's list with every model's// agent, window state now and key-ring state (the live position by
// reference name while the rings are active, the declared size otherwise),
// the routes in force, the agent filter, the project-layer marks and the
// unused-model notes — and the R6 note when no tier uses the default agent.
// AUTO-DECISION: before the run's agent starts (unit tests of the block),
// the ring shows the entry's declared key count — the references the
// registry validates — because no live position exists yet; under an
// external server the same shape is shown, plus the inactive note below
// (keyring.ts owns both labels)
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
      const project = entry.layer === "project" ? " · project layer" : ""
      return `${name} (${entry.agent}, ${state}, ring ${ringLabel(entry)}${project})`
    })
    log(`${label} ${shown.join(" → ") || "(empty)"}`)
  }
  const inactive = ringInactiveNote()
  if (inactive !== undefined) log(inactive)
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
