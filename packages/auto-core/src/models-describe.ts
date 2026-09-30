// The model registry as the `models` command shows it (plans/0055 §9):
// checkModels runs the run start's registry checks and returns their problems
// as data; describeModels adds the effective table, per phase type and routing
// role: the tier, the route in force and the ordered candidates, with whether
// each candidate is usable now and why not; formatModels renders the result as
// the lines a shell prints. With no layer in force the table is the implicit
// registry a run synthesizes from the env switches (0061 F2) — the command
// names it, and the probe handle stays undefined (nothing to probe). No
// agent is started and nothing is written, so the command needs no run lock.
//
// Nothing here reads a referenced value (C4). Keys and env references appear
// by reference name (`MOONSHOT_KEY_A`, `~/.secrets/zhipu-c`); a literal env
// value appears by its variable name alone.
//
// "Usable now" (§6.2), as far as it is known before a run starts:
//   1. the agent filter: the shell profile's agent, else OPENCODE_AUTO_AGENT;
//   2. the model's windows at `now` (src/model-window.ts);
//   3–4. down marks and key marks: a run keeps them in memory only, so a new
//      run starts with none;
//   5. the context window against the project cap: known here only from an
//      entry's `context` (opencode reports its windows once its server is up,
//      claude with its first turn). An unknown window is a note, never a
//      reason, as in the failover clamp, which skips only known windows.
// AUTO-DECISION: the models command's data lives in this sibling of src/models.ts rather than in it (the loader is already long, and this module needs git, the project config and the switches, which the loader must not depend on)
// AUTO-RESOLVE: is a candidate whose context window is unknown before the run usable now? -> yes, with a note (the failover clamp in src/session.ts skips a candidate only when its window is known and below the cap; an unknown window never excluded one)
import { CONFIG_DEFAULTS, CONFIG_FILE, loadProjectConfig, type ProjectConfig } from "./config"
import { resolveModel } from "./chain"
import { fileTracked, gitIgnored } from "./git"
import { candidateList } from "./model-route"
import { formatWindowState, windowState } from "./model-window"
import {
  checkModelReferences,
  implicitRegistry,
  layerLabel,
  loadModels,
  MODELS_FILE,
  ModelRegistryError,
  operatorLayerPath,
  projectLayerPath,
} from "./models"
import type {
  EntryOrigin,
  LoadModelsOptions,
  ModelEntry,
  ModelRegistry,
  ReferenceProblem,
  RegistryAgentProfile,
  RegistryLayer,
  RegistryLayerName,
  RetryOverride,
} from "./models-schema"
import { loadPhaseTypes } from "./phases/custom"
import type { PhaseTypeEntry, Tier } from "./phases/registry"
import { shellProfile } from "./shell"
import { MODEL_ROLES, parseSwitches, SWITCH_ENV, type ModelRole, type Switches, type SwitchModelRegistry } from "./switches"

// What the switches need to know about a loaded registry (plans/0055 §9 R7):
// the internal names a bare OPENCODE_AUTO_MODEL value may take, and the tier
// lists as text for the OPENCODE_AUTO_MODEL_FALLBACK refusal that names them.
// Shared by the run start (which hands it to the switches through
// setSwitchModelRegistry) and this command's own parse. undefined is not a
// value here: a caller without a registry passes nothing and the switches
// keep their no-registry grammar.
export function switchModelRegistryInfo(registry: ModelRegistry): SwitchModelRegistry {
  const tiers = (["deep", "simple"] as const)
    .map((tier) => `${tier}: ${registry.tiers[tier]?.names.join(", ") ?? "(not declared)"}`)
    .join("; ")
  return { names: new Set(registry.models.keys()), tiers }
}

export type CheckModelsOptions = Omit<LoadModelsOptions, "phaseTypes"> & {
  // The phase type ids a route key may name; default: the builtin types and
  // the project's custom types (loadPhaseTypes).
  phaseTypes?: readonly string[]
}

export type ModelsCheck = {
  // undefined: there is no registry, or it failed to load (problems say so).
  registry?: ModelRegistry
  // Each refusal of the run start, one line each and in its order: the
  // project layer's git check, the strict load, the reference check. [] = a
  // run start accepts the registry (or there is none).
  problems: string[]
  // The reference check's problems, also among `problems`.
  references: ReferenceProblem[]
}

// The registry checks of a run start, as data: the project layer must be
// ignored by git, both layers must load strictly, and every reference must
// resolve. Unlike the run start, a project layer that git would commit does not
// stop the load, so its content problems are listed too.
// AUTO-RESOLVE: does checkModels stop at a project layer git would commit, as the run start does? -> no, it lists the refusal and goes on to load the layer (a read-only check gains nothing by hiding the content problems the operator must fix next; the run start keeps its order)
export async function checkModels(dir: string, options: CheckModelsOptions = {}): Promise<ModelsCheck> {
  let phaseTypes = options.phaseTypes
  if (phaseTypes === undefined) {
    try {
      phaseTypes = loadPhaseTypes(dir).map((entry) => entry.type)
    } catch (error) {
      return { problems: [errorText(error)], references: [] }
    }
  }
  const problems: string[] = []
  const refusal = await projectLayerRefusal(dir)
  if (refusal) problems.push(refusal)
  let registry: ModelRegistry | undefined
  try {
    registry = await loadModels(dir, { ...options, phaseTypes })
  } catch (error) {
    if (!(error instanceof ModelRegistryError)) throw error
    return { problems: [...problems, ...error.problems], references: [] }
  }
  if (registry === undefined) return { problems, references: [] }
  const references = checkModelReferences(registry, options.env ?? process.env)
  return { registry, problems: [...problems, ...references.map((problem) => problem.message)], references }
}

// The run start's refusal of a project layer that the unified commit would
// commit, or undefined. It is checked before the layer's content is read and
// does not depend on it. The line names fix, which adds the .gitignore entry
// init writes; a tracked layer must be untracked first, since ignore rules skip
// tracked files. Outside a git work tree nothing commits the layer, so there is
// no refusal.
// AUTO-RESOLVE: when a project layer is both unignored and malformed, which refusal is shown? -> the ignore refusal, checked before the content is read (it does not depend on the content, and a layer the unified commit would take is refused even while it does not parse)
// AUTO-RESOLVE: a tracked project layer passes no ignore rule even with init's entry, and fix cannot untrack it: refuse it with fix's line alone? -> a line of its own that names the untrack command and fix (fix alone would leave the refusal in place)
export async function projectLayerRefusal(directory: string): Promise<string | undefined> {
  const project = projectLayerPath(directory)
  if (!(await Bun.file(project).exists()) || (await gitIgnored(directory, MODELS_FILE)) !== false) return undefined
  const { bin } = shellProfile()
  const label = layerLabel({ name: "project", path: project })
  const fix = `run ${bin} fix ${directory} to add its .gitignore entry`
  return (await fileTracked(directory, MODELS_FILE))
    ? `${label}: git tracks it, so the unified commit would commit it; untrack it (git -C ${directory} rm --cached ${MODELS_FILE}), ${fix} if it lacks one, then re-run`
    : `${label}: git does not ignore it, so the unified commit would commit it; ${fix}, then re-run`
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export type DescribeModelsOptions = Omit<CheckModelsOptions, "phaseTypes"> & {
  // The phase types the table lists; default: the builtin types and the
  // project's custom types (loadPhaseTypes).
  phaseTypes?: readonly PhaseTypeEntry[]
}

export type ModelsDescription = {
  // The operator layer's path, whether or not the file exists (the "no model
  // registry" line names it).
  operatorPath: string
  // The run-start refusals (checkModels), plus a bad OPENCODE_AUTO_* switch,
  // which fails a run start too. [] = a run start accepts the registry.
  problems: string[]
  // Things worth knowing that refuse nothing, one line each.
  notes: string[]
  // The effective table: a loaded layer-backed registry's, or with no layer
  // the implicit registry's (0061 F2). Absent only when problems stopped the
  // description — a layer load failure or a phase-types failure, and
  // layer-less any problem at all (the implicit table shows only with an
  // empty problem list).
  table?: ModelTable
  // The loaded layer-backed registry only — undefined for the implicit one,
  // so the opt-in probe (plans/0055 §9 --probe), which starts agents, keeps
  // its "nothing to probe" answer there; everything else here reads the
  // table only.
  registry?: ModelRegistry
}

export type AgentFilter = { agent: string; source: string }

// A profile env variable, by name: a literal value, a reference (its name), or
// a removal of the inherited variable. Never the value.
export type EnvName = { name: string } & (
  | { kind: "literal" }
  | { kind: "removed" }
  | { kind: "env" | "file"; reference: string }
)

export type AgentRow = {
  name: string
  layer: EntryOrigin
  adapter: string
  bin?: string
  // Without the user information a URL may carry.
  server?: string
  env: EnvName[]
}

// A candidate's state now. `reasons` says why it is not usable ([] = usable);
// `notes` are facts that do not make it unusable.
export type CandidateState = { usable: boolean; reasons: string[]; notes: string[] }

export type ModelRow = {
  name: string
  layer: EntryOrigin
  agent: string
  adapter: string
  // `model` then each `wider` id; [] = the agent's default model.
  steps: string[]
  variant?: string
  // k tokens.
  context?: number
  windows?: { kind: "avoid" | "only"; texts: string[] }
  // The window state phrase now (entries with windows only).
  window?: string
  // The key ring of the entry's provider, when it has one.
  ring?: { provider: string; size: number }
  // The entry's retry-policy override (plans/0057 §11 item 3), as written.
  retry?: RetryOverride
  state: CandidateState
}

export type RingRow = {
  provider: string
  // Reference names in ring order.
  keys: string[]
  // Every entry on the provider shares the ring.
  models: string[]
}

export type RouteRow = {
  role: ModelRole
  tier: Tier
  // The route in force; absent = the program default tier.
  route?: { key: string; layer: EntryOrigin; kind: "tier" | "list" }
  candidates: { name: string; usable: boolean }[]
  // How many leading candidates are the session's own list; the rest are
  // borrowed from the deep list.
  own: number
  // The OPENCODE_AUTO_MODEL value that replaces the list for this session.
  override?: OverrideRow
}

// An OPENCODE_AUTO_MODEL value: an internal name, or a raw provider/model
// string that runs on the default agent without window, ring or steps (§9).
export type OverrideRow = { value: string; model?: string; state: CandidateState }

export type TypeRows = {
  type: string
  letter?: string
  origin: "builtin" | "project"
  reasoning: Tier
  rows: RouteRow[]
}

export type ModelTable = {
  now: number
  tz: string
  tzLayer?: RegistryLayerName
  layers: RegistryLayer[]
  filter?: AgentFilter
  // The project cap in tokens (config contextLimit).
  cap: number
  // The project's configured agent: the default agent under a registry (R6).
  defaultAgent: string
  // The raw OPENCODE_AUTO_MODEL text, when set.
  override?: string
  agents: AgentRow[]
  models: ModelRow[]
  rings: RingRow[]
  tiers: { tier: Tier; names: string[]; layer: EntryOrigin }[]
  routes: { key: string; layer: EntryOrigin; tier?: Tier; names?: string[] }[]
  classifier?: { names: string[]; layer: RegistryLayerName }
  unused: string[]
  types: TypeRows[]
}

// The effective table of the registry at instant now (epoch ms), from disk
// and the environment, without starting any agent.
// AUTO-RESOLVE: does the agent filter (shell profile agent / OPENCODE_AUTO_AGENT, whose values are adapter names) match a registry profile by its name or by its adapter? -> by its adapter (two logins of one agent are two profiles on one adapter, and OPENCODE_AUTO_AGENT=claude means both)
// AUTO-RESOLVE: does an invalid project config fail the models command? -> no, it is a note and the config defaults apply (the registry does not depend on the config, and status treats a bad config the same way; run and plan still refuse it)
// AUTO-RESOLVE: does a bad OPENCODE_AUTO_* switch fail the models command? -> it is a problem (exit 1, as it fails a run start), and the table is still built as if no switch were set (the registry itself loaded, and its table is what the operator came for)
// AUTO-RESOLVE: which roles does the table show for each phase type? -> every role word, with the roles that resolve alike on one line (which roles a phase dispatches depends on the project's config, and a route may name any role word, so leaving some out could hide a route in force)
export async function describeModels(
  dir: string,
  now: number,
  options: DescribeModelsOptions = {},
): Promise<ModelsDescription> {
  const env = options.env ?? process.env
  const operatorPath = operatorLayerPath(options)
  let types = options.phaseTypes
  if (types === undefined) {
    try {
      types = loadPhaseTypes(dir)
    } catch (error) {
      return { operatorPath, problems: [errorText(error)], notes: [] }
    }
  }
  const check = await checkModels(dir, { ...options, phaseTypes: types.map((entry) => entry.type) })
  const problems = [...check.problems]
  const notes: string[] = []
  let switches: Switches | undefined
  try {
    switches = parseSwitches(env, check.registry !== undefined ? switchModelRegistryInfo(check.registry) : undefined)
  } catch (error) {
    problems.push(`${errorText(error)} (the table below ignores the OPENCODE_AUTO_* switches)`)
  }
  let config: ProjectConfig = CONFIG_DEFAULTS
  try {
    config = await loadProjectConfig(dir)
  } catch (error) {
    notes.push(
      `project config (${CONFIG_FILE}) is invalid, so its defaults apply here (context limit ${CONFIG_DEFAULTS.contextLimit}k, agent opencode): ${errorText(error)}`,
    )
  }
  const profileAgent = shellProfile().agent?.name
  // A run without layers routes on the implicit registry (0061 F2): when the
  // layers load nothing and nothing refused, the table shows what a run will
  // synthesize from the env switches — the `models` command names it — and
  // `registry` (the probe handle) stays undefined, so --probe keeps its
  // "nothing to probe" answer (the implicit entries are unverified strings,
  // not a fleet to spend tokens on). The env override column keeps quiet
  // there: the policy IS the registry's routes, so no list is replaced.
  // AUTO-DECISION: the implicit table appears only with an empty problem list (a load refusal is the operator's finding and keeps the refusal form; showing a synthesized fleet beside a broken layer would read as a way around the break)
  const implicit =
    check.registry === undefined && !problems.length
      ? implicitRegistry(profileAgent ?? switches?.agent ?? config.agent ?? "opencode", switches?.model ?? { byLetter: {}, byType: {}, byRole: {}, fallback: [] })
      : undefined
  const registry: ModelRegistry | undefined = check.registry ?? implicit
  if (registry === undefined) return { operatorPath, problems, notes }
  const tableSwitches = implicit !== undefined ? undefined : switches
  const filter: AgentFilter | undefined = profileAgent
    ? { agent: profileAgent, source: "shell profile" }
    : switches?.agent
      ? { agent: switches.agent, source: SWITCH_ENV.agent }
      : undefined
  const cap = config.contextLimit * 1000
  const defaultAgent = config.agent ?? "opencode"
  const ctx: StateContext = { registry, now, filter, cap, defaultAgent }
  const models = [...registry.models.values()].map((entry) => modelRow(entry, ctx))
  const states = new Map(models.map((row) => [row.name, row.state]))
  const rings = ringRows(registry)
  for (const row of models) {
    const entry = registry.models.get(row.name)!
    const ring = rings.find((item) => item.provider === entry.provider)
    if (ring) row.ring = { provider: ring.provider, size: ring.keys.length }
  }
  const overrideText = env[SWITCH_ENV.model] || undefined
  return {
    operatorPath,
    problems,
    notes,
    ...(check.registry !== undefined ? { registry: check.registry } : {}),
    table: {
      now,
      tz: registry.tz,
      ...(registry.tzLayer ? { tzLayer: registry.tzLayer } : {}),
      layers: registry.layers,
      ...(filter ? { filter } : {}),
      cap,
      defaultAgent,
      ...(tableSwitches && overrideText ? { override: overrideText } : {}),
      agents: [...registry.agents.values()].map(agentRow),
      models,
      rings,
      tiers: Object.values(registry.tiers).map(({ tier, names, layer }) => ({ tier, names, layer })),
      routes: [...registry.routes.values()].map((route) => ({
        key: route.key,
        layer: route.layer,
        ...("tier" in route ? { tier: route.tier } : { names: route.names }),
      })),
      ...(registry.classifier ? { classifier: registry.classifier } : {}),
      unused: registry.unused,
      types: types.map((entry) => ({
        type: entry.type,
        ...(entry.letter ? { letter: entry.letter } : {}),
        origin: entry.origin,
        reasoning: entry.reasoning,
        rows: MODEL_ROLES.map((role) => routeRow(entry, role, ctx, states, tableSwitches)),
      })),
    },
  }
}

type StateContext = {
  registry: ModelRegistry
  now: number
  filter?: AgentFilter
  cap: number
  defaultAgent: string
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function agentRow(profile: RegistryAgentProfile): AgentRow {
  const env: EnvName[] = [...(profile.env ?? [])].map(([name, value]) =>
    value === null
      ? { name, kind: "removed" }
      : typeof value === "string"
        ? { name, kind: "literal" }
        : { name, kind: value.kind, reference: value.label },
  )
  return {
    name: profile.name,
    layer: profile.layer,
    adapter: profile.adapter,
    ...(profile.bin ? { bin: profile.bin } : {}),
    ...(profile.server ? { server: withoutUserInfo(profile.server) } : {}),
    env,
  }
}

// AUTO-DECISION: a profile server URL is shown without its user information (a URL may carry a password, and C4 keeps secrets out of everything the driver prints; a URL without one is shown as written)
function withoutUserInfo(server: string): string {
  const url = new URL(server)
  if (!url.username && !url.password) return server
  url.username = ""
  url.password = ""
  return url.toString()
}

function modelRow(entry: ModelEntry, ctx: StateContext): ModelRow {
  const adapter = ctx.registry.agents.get(entry.agent)?.adapter ?? ""
  const state = candidateState(adapter, ctx)
  const windows = entry.avoid ? "avoid" : entry.only ? "only" : undefined
  let window: string | undefined
  if (windows !== undefined) {
    const now = windowState(entry, ctx.registry.tz, ctx.now)
    window = formatWindowState(now, ctx.registry.tz, ctx.now)
    if (!now.open) state.reasons.push(`outside its windows (${now.opens === undefined ? "it never opens" : window})`)
  }
  const unknownUntil = adapter === "opencode" ? "the server starts" : "the agent reports it"
  if (entry.wider?.length)
    state.notes.push(`the context window of its top step ${entry.wider.at(-1)} is unknown until ${unknownUntil}`)
  else if (entry.context === undefined) state.notes.push(`its context window is unknown until ${unknownUntil}`)
  else if (entry.context * 1000 < ctx.cap)
    state.reasons.push(`its context window ${entry.context}k is below the project cap ${ctx.cap / 1000}k`)
  state.usable = !state.reasons.length
  return {
    name: entry.name,
    layer: entry.layer,
    agent: entry.agent,
    adapter,
    steps: entry.model === undefined ? [] : [entry.model, ...(entry.wider ?? [])],
    ...(entry.variant ? { variant: entry.variant } : {}),
    ...(entry.context !== undefined ? { context: entry.context } : {}),
    ...(entry.retry !== undefined ? { retry: entry.retry } : {}),
    ...(windows ? { windows: { kind: windows, texts: (entry[windows] ?? []).map((item) => item.text) } } : {}),
    ...(window !== undefined ? { window } : {}),
    state,
  }
}

// The agent filter's part of a candidate's state.
function candidateState(adapter: string, ctx: StateContext): CandidateState {
  const reasons =
    ctx.filter && adapter !== ctx.filter.agent
      ? [`filtered out by the agent filter ${ctx.filter.agent} (${ctx.filter.source})`]
      : []
  return { usable: !reasons.length, reasons, notes: [] }
}

// One ring per provider, in the order entries declare them.
function ringRows(registry: ModelRegistry): RingRow[] {
  const rings: RingRow[] = []
  for (const entry of registry.models.values()) {
    if (entry.keys === undefined || entry.provider === undefined) continue
    if (rings.some((ring) => ring.provider === entry.provider)) continue
    rings.push({ provider: entry.provider, keys: entry.keys.map((key) => key.label), models: [] })
  }
  for (const entry of registry.models.values()) {
    rings.find((ring) => ring.provider === entry.provider)?.models.push(entry.name)
  }
  return rings
}

function routeRow(
  entry: PhaseTypeEntry,
  role: ModelRole,
  ctx: StateContext,
  states: Map<string, CandidateState>,
  switches: Switches | undefined,
): RouteRow {
  const list = candidateList(ctx.registry, entry, role)
  const value = switches ? resolveModel(switches.model, entry, role) : undefined
  return {
    role,
    tier: list.tier,
    ...(list.route
      ? { route: { key: list.route.key, layer: list.route.layer, kind: "tier" in list.route ? "tier" : "list" } }
      : {}),
    candidates: list.names.map((name) => ({ name, usable: states.get(name)!.usable })),
    own: list.own,
    ...(value !== undefined ? { override: overrideRow(value, ctx, states) } : {}),
  }
}

function overrideRow(value: string, ctx: StateContext, states: Map<string, CandidateState>): OverrideRow {
  const named = states.get(value)
  if (named) return { value, model: value, state: named }
  const state = candidateState(ctx.defaultAgent, ctx)
  state.notes.push(`a raw provider/model on the default agent ${ctx.defaultAgent}, without window, ring or steps`)
  return { value, state }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// The lines a shell prints for a description: one line without a registry,
// the problems when the registry does not load, and otherwise the table
// followed by any problems.
// AUTO-DECISION: the rendering is a core function next to the data, not shell code (every shell prints the same table, and the core tests pin its wording; the shell only prints the lines, as it does renderStatus's)
export function formatModels(description: ModelsDescription): string[] {
  const { table, problems, notes } = description
  if (table === undefined) return [...problems.map((line) => `⚠ ${line}`), refusedLine(problems)]
  const lines: string[] = []
  const mark = (layer: EntryOrigin) => `[${layer}]`
  // An empty layer list is the implicit registry: no file was read, a run
  // synthesizes it from the env switches (0061 F2).
  lines.push(
    table.layers.length
      ? `model registry: ${table.layers.map((layer) => `${layer.name} layer ${layerPath(layer)}`).join(" · ")}`
      : `model registry: implicit — no layer file (${description.operatorPath} nor ${MODELS_FILE}); a run synthesizes it from ${SWITCH_ENV.model} / ${SWITCH_ENV.modelFallback}`,
  )
  lines.push(`now: ${wallClock(table.tz, table.now)} (tz ${table.tzLayer ? `from the ${table.tzLayer} layer` : "default"})`)
  lines.push(
    table.filter
      ? `agent filter: ${table.filter.agent} (${table.filter.source}): only models on ${table.filter.agent} profiles are candidates`
      : "agent filter: none: models on every agent profile are candidates",
  )
  lines.push(`project cap: ${table.cap / 1000}k context · default agent: ${table.defaultAgent}`)
  if (table.override)
    lines.push(`override: ${SWITCH_ENV.model}=${table.override} replaces the candidate list of the sessions it matches`)
  for (const note of notes) lines.push(`ℹ ${note}`)

  lines.push("agent profiles:")
  const agentWidth = width(table.agents.map((agent) => agent.name))
  for (const agent of table.agents) {
    const parts = [`adapter ${agent.adapter}`]
    if (agent.bin) parts.push(`bin ${agent.bin}`)
    if (agent.server) parts.push(`server ${agent.server}`)
    if (agent.env.length) parts.push(`env ${agent.env.map(envText).join(", ")}`)
    lines.push(`  ${agent.name.padEnd(agentWidth)}  ${mark(agent.layer)}  ${parts.join(" · ")}`)
  }

  lines.push("models:")
  const modelWidth = width(table.models.map((model) => model.name))
  for (const model of table.models) {
    const parts = [`agent ${model.agent} (${model.adapter})`]
    parts.push(
      model.steps.length === 0
        ? "the agent's default model"
        : model.steps.length === 1
          ? `model ${model.steps[0]}`
          : `steps ${model.steps.join(" → ")}`,
    )
    if (model.variant) parts.push(`variant ${model.variant}`)
    if (model.context !== undefined) parts.push(`context ${model.context}k`)
    if (model.windows) parts.push(`${model.windows.kind} ${model.windows.texts.join(", ") || "(none)"}`)
    if (model.ring) parts.push(`ring ${model.ring.provider} (${keyCount(model.ring.size)})`)
    if (model.retry)
      parts.push(`retry ${Object.entries(model.retry).map(([field, value]) => `${field} ${value}`).join(", ")}`)
    lines.push(`  ${model.name.padEnd(modelWidth)}  ${mark(model.layer)}  ${parts.join(" · ")}`)
    const now = [model.state.usable ? "✓ usable now" : `✗ not usable now: ${model.state.reasons.join("; ")}`]
    if (model.window !== undefined && model.state.usable) now.push(`window ${model.window}`)
    now.push(...model.state.notes)
    lines.push(`  ${"".padEnd(modelWidth)}  ${now.join(" · ")}`)
  }

  if (table.rings.length) {
    lines.push("key rings (one per provider, shared by its models):")
    const ringWidth = width(table.rings.map((ring) => ring.provider))
    for (const ring of table.rings)
      lines.push(
        `  ${ring.provider.padEnd(ringWidth)}  ${keyCount(ring.keys.length)}: ${ring.keys.join(", ")} · models ${ring.models.join(", ")}`,
      )
  }

  lines.push("tiers:")
  for (const tier of ["deep", "simple"] as const) {
    const list = table.tiers.find((item) => item.tier === tier)
    lines.push(
      list
        ? `  ${tier.padEnd(6)}  ${mark(list.layer)}  ${list.names.join(", ") || "(empty)"}`
        : `  ${tier.padEnd(6)}  (not declared)`,
    )
  }
  if (table.routes.length) {
    lines.push("routes:")
    const routeWidth = width(table.routes.map((route) => route.key))
    for (const route of table.routes)
      lines.push(
        `  ${route.key.padEnd(routeWidth)}  ${mark(route.layer)}  ${route.tier ? `tier ${route.tier}` : `models ${route.names!.join(", ")}`}`,
      )
  } else lines.push("routes: none")
  lines.push(
    table.classifier
      ? `classifier: ${mark(table.classifier.layer)}  ${table.classifier.names.join(", ") || "(empty)"}`
      : "classifier: none",
  )
  if (table.unused.length)
    lines.push(`ℹ unused models (no tier, route list or classifier names them): ${table.unused.join(", ")}`)

  lines.push('routing per phase type and role (✓ usable now, ✗ not; after "|": borrowed from the deep list):')
  for (const type of table.types) {
    lines.push(
      `  ${type.type}${type.letter ? ` (${type.letter})` : ""} · ${type.origin} · execute tier ${type.reasoning}`,
    )
    // Roles that resolve alike share one line, in role order.
    const groups = new Map<string, ModelRole[]>()
    for (const row of type.rows) {
      const text = routeText(row)
      groups.set(text, [...(groups.get(text) ?? []), row.role])
    }
    for (const [text, roles] of groups) lines.push(`    ${roles.join(", ")}: ${text}`)
  }

  if (problems.length) {
    for (const line of problems) lines.push(`⚠ ${line}`)
    lines.push(refusedLine(problems))
  }
  return lines
}

function refusedLine(problems: string[]): string {
  return `${problems.length} problem(s): run and plan refuse to start until they are fixed (exit 1)`
}

function layerPath(layer: RegistryLayer): string {
  return layer.name === "project" ? MODELS_FILE : layer.path
}

function width(names: string[]): number {
  return Math.max(0, ...names.map((name) => name.length))
}

function keyCount(size: number): string {
  return `${size} key${size === 1 ? "" : "s"}`
}

function envText(env: EnvName): string {
  if (env.kind === "literal") return `${env.name} (literal)`
  if (env.kind === "removed") return `${env.name} (removed)`
  return `${env.name} (${env.kind} ${env.reference})`
}

function routeText(row: RouteRow): string {
  if (row.override) {
    const { value, state } = row.override
    const detail = [...state.reasons, ...state.notes]
    return `override ${SWITCH_ENV.model} → ${value} ${state.usable ? "✓" : "✗"}${detail.length ? ` (${detail.join("; ")})` : ""}`
  }
  const label = !row.route
    ? row.tier
    : row.route.kind === "tier"
      ? `${row.tier} · route ${row.route.key} [${row.route.layer}]`
      : `route ${row.route.key} [${row.route.layer}]`
  if (!row.candidates.length) return `${label} → no candidate`
  const text = (items: RouteRow["candidates"]) =>
    items.map((item) => `${item.name} ${item.usable ? "✓" : "✗"}`).join(" · ")
  const own = text(row.candidates.slice(0, row.own))
  const borrowed = text(row.candidates.slice(row.own))
  return `${label} → ${[own || "(none)", ...(borrowed ? [borrowed] : [])].join(" | ")}`
}

// `2026-09-25 fri 14:03 Asia/Shanghai`.
function wallClock(tz: string, at: number): string {
  const parts: Record<string, string> = {}
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
  for (const part of format.formatToParts(at)) parts[part.type] = part.value
  return `${parts.year}-${parts.month}-${parts.day} ${parts.weekday!.toLowerCase()} ${parts.hour}:${parts.minute} ${tz}`
}
