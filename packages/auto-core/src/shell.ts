// Shell profile: the shell-level parameters of core messages and log-audit
// semantics (set once at shell-entry startup via setShellProfile, see
// plans/AUTO_CORE_INTEGRATION_PLAN stage two). Core code only reads the
// profile and never knows a concrete shell — the behavioral differences
// between the general shell (auto) and the simple shell (migrate) (message
// program name, agent-contract recovery guidance, log-audit semantics) are
// all parameterized through this, eliminating shell patches over
// runner/loop text.
import type { AgentCapabilities, AgentHostFactory } from "./agent/types"
import { setAuditLog } from "./log"

export type ShellProfile = {
  // The run-time program name: for the message pattern "re-run X"
  // (general shell: "opencode-auto run").
  program: string
  // The management-subcommand prefix: for the message pattern
  // "run X init <dir>" ("opencode-auto").
  bin: string
  // Recovery guidance when the agent contract is missing: "init" = hint at
  // running the init subcommand to rebuild it (general shell); "startup" =
  // the shell rebuilds the default contract from the template at every
  // startup, so the hint is simply to re-run the shell (simple shell).
  agentRecovery: "init" | "startup"
  // true = the log file always records in full (vlog exempt from the
  // verbose gate, every line timestamped), making the run log a complete
  // audit record independent of options (simple-shell semantics);
  // false = detail recorded only under --verbose.
  auditLog: boolean
  // Agent profile (MA.4, plans/0040): the coding agent this shell drives.
  // Absent = the built-in opencode adapter (loop.ts falls back to it), so a
  // shell that never sets it behaves exactly as before. What the agent can do
  // is not declared here: it comes from the host's client capabilities and the
  // driver degrades per flag at run start (src/capability.ts).
  agent?: AgentProfile
  // The directory under $XDG_CONFIG_HOME (default ~/.config) that holds the
  // operator layer of the model registry, `<configDir>/models.json`
  // (src/models.ts). OPENCODE_AUTO_MODELS overrides the whole path.
  configDir: string
}

export type AgentProfile = {
  // Display name for the startup line (e.g. "opencode", "claude").
  name: string
  // Starts or connects the agent for a run.
  host: AgentHostFactory
}

// Defaults = the general shell (auto) status quo; with no profile set,
// core messages and historical behavior are byte-for-byte identical.
const DEFAULTS: ShellProfile = {
  program: "opencode-auto run",
  bin: "opencode-auto",
  agentRecovery: "init",
  auditLog: false,
  configDir: "opencode-auto",
}

let profile: ShellProfile = DEFAULTS

// Called at shell-entry startup (partial override, merged onto the previous
// value; repeated calls are idempotent); auditLog wires the log layer.
export function setShellProfile(part: Partial<ShellProfile>): void {
  profile = { ...profile, ...part }
  setAuditLog(profile.auditLog)
}

export function shellProfile(): ShellProfile {
  return profile
}

// An agent adapter a shell registers (plans/0055 §8.8): the host factory that
// starts or connects the agent, plus the adapter's static capabilities — the
// record the pool degrades on before any host starts (§8.5: lazy start means
// capabilities must be known without spawning; the builtin adapters expose
// theirs through their entry modules, src/agent-pool.ts). Registering an
// adapter never changes a run by itself: a registry profile must name the
// adapter before anything dispatches on it.
// AUTO-DECISION: the registration carries the capabilities beside the factory instead of the pool reading them off a started client (§8.5 names "a static per-adapter capability record exposed with the factory" as the shape; a shell adapter knows what it can do before it runs, and the builtin opencode/claude records already exist as constants)
export type AgentAdapter = {
  host: AgentHostFactory
  capabilities: AgentCapabilities
  // The adapter's default executable for preflight's `<bin> --version` check
  // (§8.7); absent = the check skips the adapter's profiles unless a profile
  // declares its own `bin`.
  bin?: string
}

const adapters = new Map<string, AgentAdapter>()

// Registers an agent adapter under `name` (idempotent; the last registration
// wins, like setShellProfile). After it, the model registry's `adapter` field
// accepts `name` (src/models.ts reads registeredAdapterNames), and a profile
// naming it starts through the factory.
export function registerAgentAdapter(name: string, adapter: AgentAdapter): void {
  adapters.set(name, adapter)
}

// The adapter a shell registered under `name`; undefined for the builtins
// ("opencode", "claude"), whose factories the pool itself holds.
export function shellAdapter(name: string): AgentAdapter | undefined {
  return adapters.get(name)
}

// Every adapter name a shell registered (no builtins). The registry loader
// accepts these beside its builtin list.
export function registeredAdapterNames(): string[] {
  return [...adapters.keys()]
}

// Tests reset the registry (one Bun process runs many test files).
export function resetShellAdapters(): void {
  adapters.clear()
}
