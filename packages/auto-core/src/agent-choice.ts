// Which coding agent a run drives, and which of the registry's agent profiles
// its host starts with (M6.1). Precedence: the shell profile's agent
// (setShellProfile `agent`) > OPENCODE_AUTO_AGENT (an override for trials) >
// the project config's `agent` key > opencode. The session entry point,
// runAll, goes through the agent pool, so a project's agent choice holds for
// every session (m-mode planning included, which ran in its own init-time
// session until plans/0053 D12).
//
// Starting the hosts is the pool's job (src/agent-pool.ts, plans/0055 §8.1):
// this module only names the chosen adapter and the registry profile the
// run's host starts with. Without a registry the pool starts exactly the one
// agent chosen here.
import { claudeHost } from "./agent/claude/host"
import type { ModelRegistry, RegistryAgentProfile } from "./models"
import { shellProfile, type AgentProfile } from "./shell"
import { autoSwitches, type AgentChoice } from "./switches"

// undefined = the built-in opencode adapter.
export function chooseAgent(configured: AgentChoice | undefined): AgentProfile | undefined {
  const profile = shellProfile().agent
  if (profile) return profile
  return (autoSwitches().agent ?? configured) === "claude" ? { name: "claude", host: claudeHost } : undefined
}

// The registry profile a name refers to. The chosen agent (shell profile
// `agent`, OPENCODE_AUTO_AGENT, config `agent`, else opencode) names an
// adapter; among the registry's profiles of that adapter, the one whose name
// is the chosen agent's name wins, otherwise the first in registry order (the
// operator layer's order, then the project layer's additions). A registry
// without an agents section implies the profile `opencode`, which the default
// agent then takes by name. undefined = no profile of that adapter: the agent
// starts as it does without a registry.
// AUTO-DECISION: a name match first, then the first profile of the adapter in registry order (the design leaves the choice open while one agent runs per run; the name match lets an operator point the run at a profile by naming it like the adapter, and the order fallback keeps a registry whose only claude profile is `claude-b` working — the pool starts one host per selected profile, so the pick only names the run's start profile: raw override values and unqualified records resolve through it too)
export function agentProfileFor(registry: ModelRegistry, name: string | undefined): RegistryAgentProfile | undefined {
  const adapter = name ?? "opencode"
  const candidates = [...registry.agents.values()].filter((profile) => profile.adapter === adapter)
  return candidates.find((profile) => profile.name === adapter) ?? candidates[0]
}
