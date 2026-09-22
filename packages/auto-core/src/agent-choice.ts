// Which coding agent a run drives, and starting it (M6.1). Precedence: the
// shell profile's agent (setShellProfile `agent`) > OPENCODE_AUTO_AGENT (an
// override for trials) > the project config's `agent` key > opencode. Both
// session entry points — runAll and the init-time implementPlan session — go
// through startAgent, so a project's agent choice holds for every session.
import type { AgentHost } from "./agent/types"
import { opencodeHost } from "./agent/opencode/server"
import { claudeHost } from "./agent/claude/host"
import { degrade, permissionPreset } from "./capability"
import { log } from "./log"
import type { PermissionMode } from "./opts"
import { shellProfile, type AgentProfile } from "./shell"
import { autoSwitches, clampSwitches, type AgentChoice } from "./switches"

// undefined = the built-in opencode adapter.
export function chooseAgent(configured: AgentChoice | undefined): AgentProfile | undefined {
  const profile = shellProfile().agent
  if (profile) return profile
  return (autoSwitches().agent ?? configured) === "claude" ? { name: "claude", host: claudeHost } : undefined
}

export type StartAgentOpts = {
  agent?: AgentChoice
  server?: string
  permission?: PermissionMode
  testByDriver?: boolean
  interactive?: boolean
  dryrun?: boolean
  // An already started host (tests); taken as is, no agent is started.
  managed?: AgentHost
}

// Starts (or takes) the host, then forces off the switches this agent cannot
// serve before the first session (MA.4, plans/0040). `error` = a configuration
// with no fallback under this agent: the caller closes the host and stops.
export async function startAgent(directory: string, opts: StartAgentOpts): Promise<{ host: AgentHost; error?: string }> {
  // The permission preset reaches only agents without permission events (MA.4).
  const agent = chooseAgent(opts.agent)
  const host =
    opts.managed ??
    (await (agent?.host ?? opencodeHost)(directory, {
      server: opts.server,
      permission: permissionPreset(opts.permission, opts.dryrun),
      log,
    }))
  if (agent) log(`◇ agent: ${agent.name}`)
  const degraded = degrade(host.client.capabilities, autoSwitches(), opts)
  for (const note of degraded.notes) log(`⚙ ${note}`)
  if (degraded.error) return { host, error: degraded.error }
  clampSwitches(degraded.switches)
  return { host }
}
