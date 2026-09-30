// The model registry's schema half (plans/0055 §4.1–§4.3; split from the
// loader by 0061 E4, ruling R14 — the two halves are separable, and the
// loader's 932 lines were past one reading): the types of a loaded registry
// and its layers, and the tables that declare what a registry file may say —
// the field names of the top level and of each kind of entry, the grammar of
// internal names, variable names and references, the adapters the core
// ships, the implied profile of a registry without one, and the tier words
// (declared with the phase types, where a tier belongs). The loader
// (src/models.ts) finds, reads, merges and validates the layers against this
// vocabulary and checks the references; nothing here reads a file, merges a
// layer or judges a value, so a type-only importer binds no loader code.
// AUTO-DECISION: name-keyed sections are Maps, not records (a JSON key such as `__proto__` or `constructor` can then neither set a prototype nor pass an existence check through Object.prototype)

import type { AgentRetryPolicy } from "./agent/types"
import type { ModelWindow } from "./model-window"
import { TIERS, type Tier } from "./phases/registry"
import type { AgentChoice } from "./switches"

// The tier words are declared with the phase types (a tier is a property of
// the work, not of the fleet); the registry keys its tier lists by them.
export { TIERS, type Tier }

// The adapters the core ships. A shell that registers another adapter passes
// the extended list to loadModels; the default accepts every registered name
// beside these (registerAgentAdapter, src/shell.ts, plans/0055 §8.8).
export const BUILTIN_ADAPTERS: readonly AgentChoice[] = ["opencode", "claude"]

// The implied agent profile of a registry without one.
export const IMPLIED_AGENT = "opencode"

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
  // Fields of the agent's retry policy this entry overrides (plans/0057 §11
  // item 3): what its profile's environment or its provider changes about
  // the adapter's record, laid over it field by field (chain.ts retryPolicyOf).
  retry?: RetryOverride
}

// A model entry's `retry` (plans/0057 §4, §11 item 3): any fields of the
// agent's retry policy.
export type RetryOverride = Partial<AgentRetryPolicy>

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
  // The adapters a profile may name; default BUILTIN_ADAPTERS plus every
  // adapter a shell registered (§8.8).
  adapters?: readonly string[]
  // Where OPENCODE_AUTO_MODELS and XDG_CONFIG_HOME are read; default process.env.
  env?: Record<string, string | undefined>
  // The home directory `~` expands to; default os.homedir().
  home?: string
  // The directory under XDG_CONFIG_HOME; default the shell profile's configDir.
  configDir?: string
}

// Internal names of models and agent profiles. No `/`, so a name never reads
// as a raw provider/model string.
// AUTO-RESOLVE: do agent profile names follow the internal-name pattern too? -> yes (they appear beside model names in logs such as `claude:opus` and will be persisted with session ids; one rule for every name the registry defines)
export const NAME = /^[a-z][a-z0-9.-]*$/
// AUTO-RESOLVE: which env variable names are accepted (profile env keys, {env:NAME})? -> the portable shell names [A-Za-z_][A-Za-z0-9_]* (anything else cannot be exported from a shell and is almost certainly a typo)
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
export const ENV_REF = /^\{env:([^}]*)\}$/
export const FILE_REF = /^\{file:([^}]*)\}$/
export const REF_START = /\{(?:env|file):/

// The schema tables the loader merges and validates against: the top-level
// fields a layer file may name, the four name-keyed sections whose entries
// merge one level deep, and the fields an entry of each kind may carry (an
// unknown field anywhere fails under the strict rule the loader states).
export const TOP_FIELDS = ["tz", "agents", "models", "tiers", "routes", "classifier"]
export const SECTIONS = ["agents", "models", "tiers", "routes"] as const
export type Section = (typeof SECTIONS)[number]
export const PROFILE_FIELDS = ["adapter", "bin", "env", "server"]
export const MODEL_FIELDS = ["agent", "model", "wider", "variant", "context", "avoid", "only", "keys", "retry"]
export const RETRY_FIELDS = ["maxAttempts", "backoffCapMs", "honorsRetryAfter", "waitsOutLimit", "silenceBudgetMs"]
export const REFERENCE_HINT = "{env:NAME} or {file:path}"

// One broken reference. `message` names the field, the layer and the reference
// (`ZHIPU_KEY_B`, `~/.secrets/zhipu-c`), never a value.
export type ReferenceProblem = { field: string; layer: EntryOrigin; label: string; message: string }
