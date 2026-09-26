// Shell profile: the shell-level parameters of core messages and log-audit
// semantics (set once at shell-entry startup via setShellProfile, see
// plans/AUTO_CORE_INTEGRATION_PLAN stage two). Core code only reads the
// profile and never knows a concrete shell — the behavioral differences
// between the general shell (auto) and the simple shell (migrate) (message
// program name, agent-contract recovery guidance, log-audit semantics) are
// all parameterized through this, eliminating shell patches over
// runner/loop text.
import type { AgentHostFactory } from "./agent/types"
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
