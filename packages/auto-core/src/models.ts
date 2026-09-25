// Model registry (plans/0055 §4.1–§4.3): the operator's fleet of models, the
// agent profiles that run them, the reasoning tiers and routes that pick them,
// and the key rings that pay for them. This module finds the two registry
// layers, merges them one level deep, validates the merged result strictly,
// and checks the key and env references. It never reads a referenced value
// into anything it builds: a key or an env value is carried as its reference
// (`{env:NAME}`, `{file:path}`) and named by it (`ZHIPU_KEY_B`,
// `~/.secrets/zhipu-c`).
//
// Layers (§4.1):
//   - operator layer: $OPENCODE_AUTO_MODELS if set, otherwise
//     $XDG_CONFIG_HOME/<configDir>/models.json (XDG_CONFIG_HOME defaults to
//     ~/.config; configDir comes from the shell profile).
//   - project layer: .opencode/auto/models.json in the target directory.
//   A missing file is no layer, and with neither layer there is no registry:
//   loadModels returns undefined and the run stays as it is without one.
// AUTO-RESOLVE: does an explicitly set OPENCODE_AUTO_MODELS that names a missing file fail, or fall back to the XDG path? -> neither: it is no operator layer, with no fallback (a missing file is no layer, as the design states for both layers; pointing the variable at a missing path is how a test or a machine turns the operator layer off without touching the operator's file)
// AUTO-RESOLVE: is a relative XDG_CONFIG_HOME used? -> no, it is ignored and ~/.config applies (the XDG base directory specification declares relative values invalid)
//
// Merge: the project layer applies over the operator layer one level deep.
// `tz` and `classifier` are replaced whole. Each key of `agents`, `models`,
// `tiers` and `routes` replaces the operator's value for that key whole, and a
// `null` value removes the operator's entry. Nothing merges inside an entry.
// Validation runs on the merged result, so an operator entry that the project
// layer removes or replaces is never checked, and each error names the layer
// its entry came from.
// AUTO-RESOLVE: may the operator layer hold a null entry? -> yes, it removes nothing (both layers share one reader, and a project file copied to the operator location keeps loading)
// AUTO-RESOLVE: may `tz`, `classifier` or a whole section be null? -> no, only the entries of the four sections take null (the design names removal for entries only; `"classifier": []` clears the classifier list and `"tz": "UTC"` restores the default)
//
// Strict (§4.1): bad JSON, an unknown field (top level or inside an entry) or
// a bad value fails, naming the field and the layer. Unlike config.json,
// unknown fields are not ignored: a misspelled `aviod` would silently put a
// model back into its peak hours.
// AUTO-RESOLVE: does an unknown top-level field fail as well as one inside an entry? -> yes (a misspelled `tierz` would silently drop the tier lists, the same hazard as a misspelled `aviod`)
// AUTO-DECISION: every problem of the merged registry is collected, and one ModelRegistryError carries them one line each (an operator fixing the file sees all of it at once; parseWindow and checkTimeZone already return their errors as values for this)
//
// Keys and references (§4.3, C4): a key is `{env:NAME}` or `{file:path}` only,
// and a literal key is refused. No error message quotes a `keys` or `env`
// value, since either may be a secret written in the wrong place.
// AUTO-DECISION: name-keyed sections are Maps, not records (a JSON key such as `__proto__` or `constructor` can then neither set a prototype nor pass an existence check through Object.prototype)

import { accessSync, constants, statSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { checkTimeZone, DEFAULT_WINDOW_TZ, parseWindow, type ModelWindow } from "./model-window"
import { PHASE_LETTERS, TIERS, type Tier } from "./phases/registry"
import { shellProfile } from "./shell"
import { MODEL_ROLES, SWITCH_ENV, type AgentChoice } from "./switches"

// The project layer, relative to the target directory.
export const MODELS_FILE = join(".opencode", "auto", "models.json")

// The adapters the core ships. A shell that registers another adapter passes
// the extended list to loadModels.
export const BUILTIN_ADAPTERS: readonly AgentChoice[] = ["opencode", "claude"]

// The implied agent profile of a registry without one.
export const IMPLIED_AGENT = "opencode"

// The tier words are declared with the phase types (a tier is a property of
// the work, not of the fleet); the registry keys its tier lists by them.
export { TIERS, type Tier }

export type RegistryLayerName = "operator" | "project"

// A loaded layer: which one, and its file (absolute).
export type RegistryLayer = { name: RegistryLayerName; path: string }

// Where an entry comes from. "implied" is the opencode profile of a registry
// that declares no agent profile.
export type EntryOrigin = RegistryLayerName | "implied"

// A reference to a value held elsewhere. `ref` is the reference text an agent
// substitutes itself (opencode reads `{env:…}` / `{file:…}` in its config);
// a file reference is normalized to its absolute path there. `label` is what
// logs and messages show: the variable name, or the path as written.
export type ModelReference =
  | { kind: "env"; name: string; ref: string; label: string }
  | { kind: "file"; path: string; ref: string; label: string }

// A profile env value: a literal (`~` expanded), a reference the driver
// resolves at spawn, or null, which removes an inherited variable.
export type ProfileEnvValue = string | ModelReference | null

// An agent profile (`agents.<name>`, §4.2).
export type RegistryAgentProfile = {
  name: string
  layer: EntryOrigin
  // "opencode", "claude", or an adapter a shell registered.
  adapter: string
  // The executable, `~` expanded; absent = the adapter's own.
  bin?: string
  env?: Map<string, ProfileEnvValue>
  // An external opencode server URL (opencode profiles only).
  server?: string
}

// A model entry (`models.<internal name>`, §4.2). Structurally a WindowSpec
// of src/model-window.ts (`avoid` / `only`).
export type ModelEntry = {
  name: string
  layer: RegistryLayerName
  // The agent profile that runs it.
  agent: string
  // The adapter's model id; absent = the agent's own default model.
  model?: string
  // opencode entries: the provider of `model` (the part before the first `/`),
  // which owns the key ring (§4.3).
  provider?: string
  // Context steps: model ids that continue a session once it outgrows the
  // current id's window (opencode only, §4.5).
  wider?: string[]
  variant?: string
  // The context window of `model` in k tokens.
  context?: number
  avoid?: ModelWindow[]
  only?: ModelWindow[]
  // The key ring as references (opencode only, §4.3).
  keys?: ModelReference[]
}

export type TierList = { tier: Tier; names: string[]; layer: RegistryLayerName }

// A route (`routes.<key>`): a role word, a phase type id or a preset letter,
// mapped to a tier or to an ordered list of internal names.
export type ModelRoute = { key: string; layer: RegistryLayerName } & ({ tier: Tier } | { names: string[] })

export type ModelRegistry = {
  // The layers that exist, operator first.
  layers: RegistryLayer[]
  // Canonical IANA spelling; DEFAULT_WINDOW_TZ when no layer sets it.
  tz: string
  tzLayer?: RegistryLayerName
  agents: Map<string, RegistryAgentProfile>
  models: Map<string, ModelEntry>
  tiers: Partial<Record<Tier, TierList>>
  routes: Map<string, ModelRoute>
  classifier?: { names: string[]; layer: RegistryLayerName }
  // Notes, not errors: models that no tier, route list or classifier names.
  unused: string[]
}

export type LoadModelsOptions = {
  // Phase type ids a route key may name: the builtin types and the project's
  // custom types.
  phaseTypes: readonly string[]
  // The adapters a profile may name; default BUILTIN_ADAPTERS.
  adapters?: readonly string[]
  // Where OPENCODE_AUTO_MODELS and XDG_CONFIG_HOME are read; default process.env.
  env?: Record<string, string | undefined>
  // The home directory `~` expands to; default os.homedir().
  home?: string
  // The directory under XDG_CONFIG_HOME; default the shell profile's configDir.
  configDir?: string
}

export class ModelRegistryError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join("\n"))
    this.name = "ModelRegistryError"
  }
}

// Internal names of models and agent profiles. No `/`, so a name never reads
// as a raw provider/model string.
// AUTO-RESOLVE: do agent profile names follow the internal-name pattern too? -> yes (they appear beside model names in logs such as `claude:opus` and will be persisted with session ids; one rule for every name the registry defines)
const NAME = /^[a-z][a-z0-9.-]*$/
// AUTO-RESOLVE: which env variable names are accepted (profile env keys, {env:NAME})? -> the portable shell names [A-Za-z_][A-Za-z0-9_]* (anything else cannot be exported from a shell and is almost certainly a typo)
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const ENV_REF = /^\{env:([^}]*)\}$/
const FILE_REF = /^\{file:([^}]*)\}$/
const REF_START = /\{(?:env|file):/

const TOP_FIELDS = ["tz", "agents", "models", "tiers", "routes", "classifier"]
const SECTIONS = ["agents", "models", "tiers", "routes"] as const
type Section = (typeof SECTIONS)[number]
const PROFILE_FIELDS = ["adapter", "bin", "env", "server"]
const MODEL_FIELDS = ["agent", "model", "wider", "variant", "context", "avoid", "only", "keys"]
const REFERENCE_HINT = "{env:NAME} or {file:path}"

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

type LocateOptions = Pick<LoadModelsOptions, "env" | "home" | "configDir">

// The operator layer's path (whether or not the file exists).
export function operatorLayerPath(options: LocateOptions = {}): string {
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const explicit = env[SWITCH_ENV.models]
  if (explicit) return resolve(expandHome(explicit, home))
  const xdg = env.XDG_CONFIG_HOME
  const base = xdg && isAbsolute(xdg) ? xdg : join(home, ".config")
  return join(base, options.configDir ?? shellProfile().configDir, "models.json")
}

export function projectLayerPath(dir: string): string {
  return resolve(dir, MODELS_FILE)
}

// Reads, merges and validates both layers. undefined = neither layer exists
// (no registry). Throws ModelRegistryError on any strict failure.
export async function loadModels(dir: string, options: LoadModelsOptions): Promise<ModelRegistry | undefined> {
  const problems: string[] = []
  const sources: { layer: RegistryLayer; text: string }[] = []
  for (const layer of [
    { name: "operator", path: operatorLayerPath(options) },
    { name: "project", path: projectLayerPath(dir) },
  ] satisfies RegistryLayer[]) {
    const text = await readLayer(layer, problems)
    if (text !== undefined) sources.push({ layer, text })
  }
  if (problems.length) throw new ModelRegistryError(problems)
  if (!sources.length) return undefined
  return buildRegistry(sources, options)
}

async function readLayer(layer: RegistryLayer, problems: string[]): Promise<string | undefined> {
  try {
    return await readFile(layer.path, "utf8")
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT" || code === "ENOTDIR") return undefined
    problems.push(`${layerLabel(layer)}: cannot be read (${code ?? String(error)})`)
    return undefined
  }
}

// How messages name a layer: "model registry, project layer
// .opencode/auto/models.json" (the operator layer by its absolute path).
export function layerLabel(layer: RegistryLayer): string {
  return `model registry, ${layer.name} layer ${layer.name === "project" ? MODELS_FILE : layer.path}`
}

function expandHome(path: string, home: string): string {
  if (path === "~") return home
  return path.startsWith("~/") ? join(home, path.slice(2)) : path
}

// ---------------------------------------------------------------------------
// Parse and merge
// ---------------------------------------------------------------------------

// A raw value placed in the merged result, with the layer it came from.
type Placed = { value: unknown; layer: RegistryLayer }

type Merged = {
  top: Map<string, Placed>
  sections: Record<Section, Map<string, Placed>>
  // Entries a null removed, by section: the name and the removing layer (for
  // the hint on a reference to a removed entry).
  removed: Record<Section, Map<string, RegistryLayerName>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Drops the tokens a JSON parser quotes back: an unquoted key pasted into the
// file would otherwise reach the error message (C4).
// AUTO-DECISION: a bad-JSON error keeps the parser's message without its double-quoted fragments (Bun quotes the offending identifier, which may be part of a secret)
function parserMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text
    .replace(/"[^"]*"/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function buildRegistry(sources: { layer: RegistryLayer; text: string }[], options: LoadModelsOptions): ModelRegistry {
  const problems: string[] = []
  const merged: Merged = {
    top: new Map(),
    sections: { agents: new Map(), models: new Map(), tiers: new Map(), routes: new Map() },
    removed: { agents: new Map(), models: new Map(), tiers: new Map(), routes: new Map() },
  }
  for (const { layer, text } of sources) {
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch (error) {
      problems.push(`${layerLabel(layer)}: not valid JSON (${parserMessage(error)})`)
      continue
    }
    if (!isRecord(raw)) {
      problems.push(`${layerLabel(layer)}: must be a JSON object`)
      continue
    }
    for (const [key, value] of Object.entries(raw)) {
      if (!TOP_FIELDS.includes(key)) {
        problems.push(`${layerLabel(layer)}: unknown field ${JSON.stringify(key)} (known: ${TOP_FIELDS.join(", ")})`)
        continue
      }
      if (!(SECTIONS as readonly string[]).includes(key)) {
        merged.top.set(key, { value, layer })
        continue
      }
      const section = key as Section
      if (!isRecord(value)) {
        problems.push(`${layerLabel(layer)}: ${section} must be an object`)
        continue
      }
      for (const [name, entry] of Object.entries(value)) {
        if (entry === null) {
          merged.sections[section].delete(name)
          merged.removed[section].set(name, layer.name)
        } else {
          merged.sections[section].set(name, { value: entry, layer })
          merged.removed[section].delete(name)
        }
      }
    }
  }
  if (problems.length) throw new ModelRegistryError(problems)
  return new Validator(
    merged,
    options,
    sources.map((source) => source.layer),
  ).run()
}

// ---------------------------------------------------------------------------
// Validation of the merged result
// ---------------------------------------------------------------------------

class Validator {
  private readonly problems: string[] = []
  private readonly adapters: readonly string[]
  private readonly home: string

  constructor(
    private readonly merged: Merged,
    private readonly options: LoadModelsOptions,
    private readonly layers: RegistryLayer[],
  ) {
    this.adapters = options.adapters ?? BUILTIN_ADAPTERS
    this.home = options.home ?? homedir()
  }

  private fail(layer: RegistryLayer, field: string, message: string): void {
    this.problems.push(`${layerLabel(layer)}: ${field}: ${message}`)
  }

  run(): ModelRegistry {
    const agents = this.agents()
    const models = this.models(agents)
    const tz = this.tz()
    const tiers = this.tiers(models)
    const routes = this.routes(models)
    const classifier = this.classifier(models, agents)
    this.rings(models)
    if (this.problems.length) throw new ModelRegistryError(this.problems)
    const used = new Set<string>([
      ...Object.values(tiers).flatMap((list) => list.names),
      ...[...routes.values()].flatMap((route) => ("names" in route ? route.names : [])),
      ...(classifier?.names ?? []),
    ])
    return {
      layers: this.layers,
      ...tz,
      agents,
      models,
      tiers,
      routes,
      ...(classifier ? { classifier } : {}),
      // AUTO-RESOLVE: is a model that only a route list names unused? -> no, a route list uses it (the design's note predates route lists naming models; calling a routed model unused would be false)
      unused: [...models.keys()].filter((name) => !used.has(name)),
    }
  }

  private field(section: string, name: string): string {
    return `${section}.${NAME.test(name) ? name : JSON.stringify(name)}`
  }

  // The hint for a name that no entry of a section holds.
  private missing(section: Section, name: string, known: Iterable<string>): string {
    const by = this.merged.removed[section].get(name)
    if (by !== undefined) return `${JSON.stringify(name)} was removed by the ${by} layer`
    const list = [...known]
    return `${JSON.stringify(name)} is not defined (${list.length ? `defined: ${list.join(", ")}` : `no ${section} are defined`})`
  }

  private tz(): { tz: string; tzLayer?: RegistryLayerName } {
    const placed = this.merged.top.get("tz")
    if (placed === undefined) return { tz: DEFAULT_WINDOW_TZ }
    if (typeof placed.value !== "string") {
      this.fail(placed.layer, "tz", `must be an IANA time zone name (default ${DEFAULT_WINDOW_TZ})`)
      return { tz: DEFAULT_WINDOW_TZ }
    }
    const checked = checkTimeZone(placed.value)
    if ("error" in checked) {
      this.fail(placed.layer, "tz", checked.error)
      return { tz: DEFAULT_WINDOW_TZ }
    }
    return { tz: checked.tz, tzLayer: placed.layer.name }
  }

  private unknownFields(layer: RegistryLayer, where: string, entry: Record<string, unknown>, known: string[]): void {
    for (const key of Object.keys(entry)) {
      if (!known.includes(key))
        this.fail(layer, where, `unknown field ${JSON.stringify(key)} (known: ${known.join(", ")})`)
    }
  }

  private name(layer: RegistryLayer, where: string, name: string): void {
    if (!NAME.test(name))
      this.fail(
        layer,
        where,
        `the name must match ${NAME.source} (a lowercase letter, then lowercase letters, digits, "." or "-")`,
      )
  }

  // Profiles keep their name even when a field is bad, so a model naming the
  // profile gets no second error for it. `adapter` stays empty when it is bad.
  private agents(): Map<string, RegistryAgentProfile> {
    const agents = new Map<string, RegistryAgentProfile>()
    const section = this.merged.sections.agents
    // AUTO-RESOLVE: does a merged agents section left empty (every profile removed by null, or `"agents": {}`) imply the opencode profile? -> yes, the same as no section (a registry with no profile has no other way to run a model)
    if (!section.size) {
      agents.set(IMPLIED_AGENT, { name: IMPLIED_AGENT, layer: "implied", adapter: "opencode" })
      return agents
    }
    for (const [name, { value, layer }] of section) {
      const where = this.field("agents", name)
      this.name(layer, where, name)
      const profile: RegistryAgentProfile = { name, layer: layer.name, adapter: "" }
      agents.set(name, profile)
      if (!isRecord(value)) {
        this.fail(layer, where, "must be an object with an adapter (or null to remove the entry)")
        continue
      }
      this.unknownFields(layer, where, value, PROFILE_FIELDS)
      const adapter = value.adapter
      if (typeof adapter !== "string" || !this.adapters.includes(adapter)) {
        const shown = typeof adapter === "string" ? `${JSON.stringify(adapter)} is unknown` : "is required"
        this.fail(layer, `${where}.adapter`, `${shown} (known adapters: ${this.adapters.join(", ")})`)
      } else profile.adapter = adapter
      if (value.bin !== undefined) {
        if (typeof value.bin !== "string" || !value.bin)
          this.fail(layer, `${where}.bin`, "must be a non-empty string (an executable name or path)")
        // AUTO-RESOLVE: does `~` expand in `bin`? -> yes (the design expands `~` in registry paths; a bin under the home directory is the common case for a second install)
        else profile.bin = expandHome(value.bin, this.home)
      }
      if (value.env !== undefined) profile.env = this.profileEnv(layer, `${where}.env`, value.env)
      if (value.server !== undefined) {
        if (profile.adapter && profile.adapter !== "opencode") {
          this.fail(layer, `${where}.server`, `is allowed only on opencode profiles (adapter here: ${profile.adapter})`)
        } else if (!serverUrl(value.server)) {
          // AUTO-RESOLVE: what does `server` accept? -> an http or https URL (what --server and OPENCODE_AUTO_SERVER are given; anything else cannot be reached by the SDK client)
          this.fail(layer, `${where}.server`, "must be an http or https URL of a running opencode server")
        } else profile.server = value.server as string
      }
    }
    return agents
  }

  private profileEnv(layer: RegistryLayer, where: string, raw: unknown): Map<string, ProfileEnvValue> | undefined {
    if (!isRecord(raw)) {
      this.fail(layer, where, "must be an object of variable names to values")
      return undefined
    }
    const env = new Map<string, ProfileEnvValue>()
    for (const [name, value] of Object.entries(raw)) {
      const at = `${where}.${name}`
      if (!ENV_NAME.test(name)) {
        this.fail(
          layer,
          where,
          `${JSON.stringify(name)} is not a variable name (letters, digits and "_", not starting with a digit)`,
        )
        continue
      }
      if (value === null) {
        env.set(name, null)
        continue
      }
      if (typeof value !== "string") {
        this.fail(layer, at, `must be a string, ${REFERENCE_HINT}, or null to remove the inherited variable`)
        continue
      }
      if (REF_START.test(value)) {
        const ref = this.reference(layer, at, value)
        if (ref) env.set(name, ref)
        continue
      }
      env.set(name, expandHome(value, this.home))
    }
    return env
  }

  // A `{env:NAME}` / `{file:path}` value. The value is never quoted back: it
  // sits where a secret may have been written by mistake.
  // AUTO-RESOLVE: may a value embed a reference inside a longer string (`http://{env:USER}@proxy`)? -> no, a reference is the whole value (the design defines a value as a literal or a reference; an embedded one would reach the process as literal text)
  private reference(layer: RegistryLayer, where: string, value: string): ModelReference | undefined {
    const env = ENV_REF.exec(value)
    if (env) {
      const name = env[1]!
      if (ENV_NAME.test(name)) return { kind: "env", name, ref: `{env:${name}}`, label: name }
      this.fail(
        layer,
        where,
        'the {env:NAME} reference does not name a variable (letters, digits and "_", not starting with a digit)',
      )
      return undefined
    }
    const file = FILE_REF.exec(value)
    if (file && file[1]!.trim()) {
      const written = file[1]!
      const expanded = expandHome(written, this.home)
      const path = isAbsolute(expanded) ? expanded : resolve(dirname(layer.path), expanded)
      return { kind: "file", path, ref: `{file:${path}}`, label: written }
    }
    this.fail(layer, where, `is not a reference: write the whole value as ${REFERENCE_HINT}`)
    return undefined
  }

  private models(agents: Map<string, RegistryAgentProfile>): Map<string, ModelEntry> {
    const models = new Map<string, ModelEntry>()
    for (const [name, { value, layer }] of this.merged.sections.models) {
      const where = this.field("models", name)
      this.name(layer, where, name)
      const entry: ModelEntry = { name, layer: layer.name, agent: "" }
      models.set(name, entry)
      if (!isRecord(value)) {
        this.fail(layer, where, "must be an object with an agent (or null to remove the entry)")
        continue
      }
      this.unknownFields(layer, where, value, MODEL_FIELDS)
      const agentName = value.agent
      let adapter: string | undefined
      if (typeof agentName !== "string")
        this.fail(layer, `${where}.agent`, "is required: the agent profile that runs the model")
      else {
        entry.agent = agentName
        const profile = agents.get(agentName)
        if (profile === undefined)
          this.fail(
            layer,
            `${where}.agent`,
            `names no agent profile: ${this.missing("agents", agentName, agents.keys())}`,
          )
        else adapter = profile.adapter || undefined
      }
      // Adapter-bound rules run only when the adapter is known; a bad profile
      // has its own error.
      const onlyOpencode = (field: string) => {
        if (adapter !== undefined && adapter !== "opencode") {
          this.fail(
            layer,
            `${where}.${field}`,
            `is allowed only on opencode profiles in this version (agent ${agentName} has adapter ${adapter})`,
          )
          return false
        }
        return true
      }
      if (value.model !== undefined) {
        if (typeof value.model !== "string" || !value.model)
          this.fail(layer, `${where}.model`, "must be a non-empty model id")
        else {
          entry.model = value.model
          // AUTO-RESOLVE: must an opencode entry's model be provider/model? -> yes (opencode takes provider/model per prompt, and the key ring and the context steps are keyed by the provider)
          if (adapter === "opencode") {
            const slash = value.model.indexOf("/")
            if (slash <= 0 || slash === value.model.length - 1)
              this.fail(
                layer,
                `${where}.model`,
                `${JSON.stringify(value.model)} is not provider/model (opencode model ids name their provider)`,
              )
            else entry.provider = value.model.slice(0, slash)
          }
        }
      }
      const noModel = (field: string) => {
        if (value.model !== undefined) return false
        this.fail(
          layer,
          `${where}.${field}`,
          "needs model: an entry without model runs on the agent's default model, which has no keys, variant or wider",
        )
        return true
      }
      if (value.wider !== undefined && !noModel("wider") && onlyOpencode("wider"))
        entry.wider = this.wider(layer, `${where}.wider`, value.wider, entry)
      if (value.variant !== undefined && !noModel("variant")) {
        // AUTO-RESOLVE: which adapters reject `variant`? -> claude only (the design rejects it on claude in v1; an adapter a shell registers declares its own limits when registration lands)
        if (adapter === "claude")
          this.fail(
            layer,
            `${where}.variant`,
            "is not supported on claude profiles in this version (claude -p has no verified per-turn variant)",
          )
        else if (typeof value.variant !== "string" || !value.variant)
          this.fail(layer, `${where}.variant`, "must be a non-empty variant name")
        else entry.variant = value.variant
      }
      if (value.context !== undefined) {
        if (typeof value.context !== "number" || !Number.isFinite(value.context) || value.context <= 0) {
          this.fail(layer, `${where}.context`, "must be a positive number of k tokens (e.g. 256 for a 256k window)")
        } else entry.context = value.context
      }
      if (value.avoid !== undefined && value.only !== undefined) {
        this.fail(
          layer,
          where,
          "avoid and only are mutually exclusive (avoid: unusable inside the windows; only: usable only inside them)",
        )
      } else {
        if (value.avoid !== undefined) entry.avoid = this.windows(layer, `${where}.avoid`, value.avoid, true)
        if (value.only !== undefined) entry.only = this.windows(layer, `${where}.only`, value.only, false)
      }
      if (value.keys !== undefined && !noModel("keys") && onlyOpencode("keys"))
        entry.keys = this.keys(layer, `${where}.keys`, value.keys)
    }
    return models
  }

  // A list of distinct non-empty strings; undefined (with an error) otherwise.
  private strings(
    layer: RegistryLayer,
    where: string,
    raw: unknown,
    what: string,
    allowEmpty: boolean,
  ): string[] | undefined {
    if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string" || !item)) {
      this.fail(layer, where, `must be a list of ${what}`)
      return undefined
    }
    if (!allowEmpty && !raw.length) {
      this.fail(layer, where, `must list at least one of ${what} (leave the field out for none)`)
      return undefined
    }
    const twice = raw.find((item, index) => raw.indexOf(item) !== index)
    if (twice !== undefined) {
      this.fail(layer, where, `lists ${JSON.stringify(twice)} twice`)
      return undefined
    }
    return raw as string[]
  }

  // AUTO-RESOLVE: are empty lists accepted? -> `avoid: []`, a tier list and `classifier: []` are (they mean none, and a project layer clears the operator's list with one); `only: []`, `wider: []`, `keys: []` and a route list are refused (a model that never opens, a step or ring of nothing, and a route to nothing are mistakes, not settings)
  // AUTO-RESOLVE: may a list name the same item twice? -> no (a window, step, key or model listed twice is a copy-paste slip; order-bearing lists would read ambiguously)
  private windows(layer: RegistryLayer, where: string, raw: unknown, allowEmpty: boolean): ModelWindow[] | undefined {
    const texts = this.strings(layer, where, raw, `windows such as "mon-fri 09:00-18:00"`, allowEmpty)
    if (texts === undefined) return undefined
    const windows: ModelWindow[] = []
    texts.forEach((text, index) => {
      const parsed = parseWindow(text)
      if ("error" in parsed) this.fail(layer, `${where}[${index}]`, parsed.error)
      else windows.push(parsed.window)
    })
    return windows
  }

  private wider(layer: RegistryLayer, where: string, raw: unknown, entry: ModelEntry): string[] | undefined {
    const steps = this.strings(layer, where, raw, "model ids on the entry's provider", false)
    if (steps === undefined || entry.provider === undefined) return steps
    steps.forEach((step, index) => {
      if (step === entry.model)
        this.fail(
          layer,
          `${where}[${index}]`,
          `repeats the entry's model ${JSON.stringify(step)}; a step is a wider-window id`,
        )
      else if (!step.startsWith(`${entry.provider}/`) || step.length === entry.provider!.length + 1) {
        this.fail(
          layer,
          `${where}[${index}]`,
          `${JSON.stringify(step)} is not on the entry's provider ${entry.provider} (steps share one cache, so one provider)`,
        )
      }
    })
    return steps
  }

  private keys(layer: RegistryLayer, where: string, raw: unknown): ModelReference[] | undefined {
    if (!Array.isArray(raw) || !raw.length) {
      this.fail(layer, where, `must be a non-empty list of references (${REFERENCE_HINT})`)
      return undefined
    }
    const keys: ModelReference[] = []
    raw.forEach((item, index) => {
      const at = `${where}[${index}]`
      if (typeof item !== "string" || !REF_START.test(item)) {
        this.fail(
          layer,
          at,
          `a literal key is refused: keys are references only (${REFERENCE_HINT}); the value is not shown`,
        )
        return
      }
      const ref = this.reference(layer, at, item)
      if (ref === undefined) return
      if (keys.some((key) => key.ref === ref.ref)) this.fail(layer, at, `repeats the reference ${ref.label}`)
      else keys.push(ref)
    })
    return keys
  }

  // A list of existing model names.
  private names(
    layer: RegistryLayer,
    where: string,
    raw: unknown,
    models: Map<string, ModelEntry>,
    allowEmpty: boolean,
  ): string[] | undefined {
    const names = this.strings(layer, where, raw, "model names", allowEmpty)
    if (names === undefined) return undefined
    for (const name of names) {
      if (!models.has(name)) this.fail(layer, where, `names no model: ${this.missing("models", name, models.keys())}`)
    }
    return names
  }

  private tiers(models: Map<string, ModelEntry>): Partial<Record<Tier, TierList>> {
    const tiers: Partial<Record<Tier, TierList>> = {}
    for (const [key, { value, layer }] of this.merged.sections.tiers) {
      const where = this.field("tiers", key)
      if (!(TIERS as readonly string[]).includes(key)) {
        this.fail(layer, where, `is not a tier (tiers: ${TIERS.join(", ")})`)
        continue
      }
      const names = this.names(layer, where, value, models, true)
      if (names !== undefined) tiers[key as Tier] = { tier: key as Tier, names, layer: layer.name }
    }
    return tiers
  }

  private routes(models: Map<string, ModelEntry>): Map<string, ModelRoute> {
    const routes = new Map<string, ModelRoute>()
    const types = this.options.phaseTypes
    const vocabulary: readonly string[] = [...MODEL_ROLES, ...types, ...PHASE_LETTERS]
    for (const [key, { value, layer }] of this.merged.sections.routes) {
      const where = this.field("routes", key)
      if (key === "*") {
        this.fail(layer, where, "* is not a route key: the tier lists already are the default")
        continue
      }
      if (!vocabulary.includes(key)) {
        this.fail(
          layer,
          where,
          `is not a role word (${MODEL_ROLES.join(", ")}), a phase type id (${types.join(", ")}) or a preset letter (${PHASE_LETTERS.join(", ")})`,
        )
        continue
      }
      if (typeof value === "string") {
        if ((TIERS as readonly string[]).includes(value))
          routes.set(key, { key, layer: layer.name, tier: value as Tier })
        else
          this.fail(
            layer,
            where,
            `${JSON.stringify(value)} is not a tier (${TIERS.join(", ")}); a list of models is written as ["${value}"]`,
          )
        continue
      }
      const names = this.names(layer, where, value, models, false)
      if (names !== undefined) routes.set(key, { key, layer: layer.name, names })
    }
    return routes
  }

  private classifier(
    models: Map<string, ModelEntry>,
    agents: Map<string, RegistryAgentProfile>,
  ): ModelRegistry["classifier"] {
    const placed = this.merged.top.get("classifier")
    if (placed === undefined) return undefined
    const names = this.names(placed.layer, "classifier", placed.value, models, true)
    if (names === undefined) return undefined
    for (const name of names) {
      const adapter = agents.get(models.get(name)?.agent ?? "")?.adapter
      if (adapter && adapter !== "opencode") {
        this.fail(
          placed.layer,
          "classifier",
          `${JSON.stringify(name)} runs on adapter ${adapter}; classifiers run on opencode profiles only in this version (a claude session cannot yet run without tools)`,
        )
      }
    }
    return { names, layer: placed.layer.name }
  }

  // Entries on one provider declare the same ring or none (§4.3).
  // AUTO-RESOLVE: is the ring compared per provider across all opencode profiles, or per profile and provider? -> per provider across all profiles (the design's rule as written; it is the stricter one, so a later per-server relaxation cannot break a registry that loads today)
  private rings(models: Map<string, ModelEntry>): void {
    const first = new Map<string, ModelEntry>()
    for (const entry of models.values()) {
      if (entry.keys === undefined || entry.provider === undefined) continue
      const holder = first.get(entry.provider)
      if (holder === undefined) {
        first.set(entry.provider, entry)
        continue
      }
      const same =
        holder.keys!.length === entry.keys.length &&
        holder.keys!.every((key, index) => key.ref === entry.keys![index]!.ref)
      if (!same) {
        this.fail(
          this.layerOf(entry.layer),
          `${this.field("models", entry.name)}.keys`,
          `differs from the ring of ${this.field("models", holder.name)} (${holder.layer} layer) on provider ${entry.provider}; entries on one provider declare the same ring, in the same order, or none`,
        )
      }
    }
  }

  private layerOf(name: RegistryLayerName): RegistryLayer {
    return this.layers.find((layer) => layer.name === name)!
  }
}

function serverUrl(value: unknown): boolean {
  if (typeof value !== "string") return false
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Reference check
// ---------------------------------------------------------------------------

// One broken reference. `message` names the field, the layer and the reference
// (`ZHIPU_KEY_B`, `~/.secrets/zhipu-c`), never a value.
export type ReferenceProblem = { field: string; layer: EntryOrigin; label: string; message: string }

// Checks every reference of the registry (keys, profile env): a variable is
// set and non-empty, a file exists and is readable. Neither value is read into
// the result. [] = all good.
// AUTO-DECISION: a file reference is checked with stat and access, never opened (C4: the check must not hold the value; readability is what opencode and the spawn need)
export function checkModelReferences(
  registry: ModelRegistry,
  env: Record<string, string | undefined> = process.env,
): ReferenceProblem[] {
  const problems: ReferenceProblem[] = []
  const label = (layer: EntryOrigin): string => {
    const found = registry.layers.find((item) => item.name === layer)
    return found ? layerLabel(found) : `model registry, ${layer} profile`
  }
  const check = (field: string, layer: EntryOrigin, ref: ModelReference): void => {
    const problem = referenceProblem(ref, env)
    if (problem) problems.push({ field, layer, label: ref.label, message: `${label(layer)}: ${field}: ${problem}` })
  }
  for (const profile of registry.agents.values()) {
    for (const [name, value] of profile.env ?? []) {
      if (value !== null && typeof value !== "string") check(`agents.${profile.name}.env.${name}`, profile.layer, value)
    }
  }
  for (const entry of registry.models.values()) {
    entry.keys?.forEach((key, index) => check(`models.${entry.name}.keys[${index}]`, entry.layer, key))
  }
  return problems
}

function referenceProblem(ref: ModelReference, env: Record<string, string | undefined>): string | undefined {
  if (ref.kind === "env") {
    const value = env[ref.name]
    if (value === undefined) return `env ${ref.name} is not set`
    return value === "" ? `env ${ref.name} is empty` : undefined
  }
  try {
    if (!statSync(ref.path).isFile()) return `file ${ref.label} is not a regular file`
    accessSync(ref.path, constants.R_OK)
    return undefined
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? `file ${ref.label} does not exist`
      : `file ${ref.label} is not readable`
  }
}
