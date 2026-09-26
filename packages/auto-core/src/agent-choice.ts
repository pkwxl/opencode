// Which coding agent a run drives, and starting it (M6.1). Precedence: the
// shell profile's agent (setShellProfile `agent`) > OPENCODE_AUTO_AGENT (an
// override for trials) > the project config's `agent` key > opencode. The
// session entry point, runAll, goes through startAgent, so a project's agent
// choice holds for every session (m-mode planning included, which ran in its
// own init-time session until plans/0053 D12).
//
// Under a model registry the run's agent starts with its agent profile
// (plans/0055 §4.2, §8.1): the profile's bin, its env overlay, resolved here
// just before the host starts, and (opencode) its external server. Without a
// registry the host starts exactly as before. One host per profile, started
// lazily, is the agent pool's job; until then the run has this one agent.
//
// The profile's opencode host also spawns with the key rings' current keys
// as config references (§4.3): activateRings records the run's rings here —
// the one place that knows whether the opencode server is managed or
// external — and the spawn config goes to the host through
// AgentHostOptions.config. A caller-supplied host (`managed`) is taken as
// is, so its rings never activate and never rotate: that host's spawn
// config was its caller's to build.
import type { AgentHost, AgentHostOptions } from "./agent/types"
import { opencodeHost } from "./agent/opencode/server"
import { claudeHost } from "./agent/claude/host"
import { profileLine, resolveProfileEnv } from "./agent-env"
import { degrade, permissionPreset } from "./capability"
import { activateRings, spawnKeyConfig } from "./keyring"
import { log } from "./log"
import type { ModelRegistry, RegistryAgentProfile } from "./models"
import type { PermissionMode } from "./opts"
import { shellProfile, type AgentProfile } from "./shell"
import { autoSwitches, clampSwitches, type AgentChoice } from "./switches"

// undefined = the built-in opencode adapter.
export function chooseAgent(configured: AgentChoice | undefined): AgentProfile | undefined {
  const profile = shellProfile().agent
  if (profile) return profile
  return (autoSwitches().agent ?? configured) === "claude" ? { name: "claude", host: claudeHost } : undefined
}

// The registry profile the run's agent starts with. The chosen agent (shell
// profile, OPENCODE_AUTO_AGENT, config `agent`, else opencode) names an
// adapter; among the registry's profiles of that adapter, the one whose name
// is the chosen agent's name wins, otherwise the first in registry order (the
// operator layer's order, then the project layer's additions). A registry
// without an agents section implies the profile `opencode`, which the default
// agent then takes by name. undefined = no profile of that adapter: the agent
// starts as it does without a registry.
// AUTO-DECISION: a name match first, then the first profile of the adapter in registry order (the design leaves the choice open while one agent runs per run; the name match lets an operator point the run at a profile by naming it like the adapter, and the order fallback keeps a registry whose only claude profile is `claude-b` working — until the agent pool starts one host per profile, models on the adapter's other profiles run on this profile's host)
export function agentProfileFor(registry: ModelRegistry, agent: AgentProfile | undefined): RegistryAgentProfile | undefined {
  const name = agent?.name ?? "opencode"
  const candidates = [...registry.agents.values()].filter((profile) => profile.adapter === name)
  return candidates.find((profile) => profile.name === name) ?? candidates[0]
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
  // The model registry loaded at run start; undefined = none.
  registry?: ModelRegistry
}

// Starts (or takes) the host, then forces off the switches this agent cannot
// serve before the first session (MA.4, plans/0040). `error` = a configuration
// with no fallback under this agent: the caller closes the host, if one
// started, and stops. A profile env reference that no longer resolves stops
// the run before any host starts.
// AUTO-RESOLVE: what happens when a profile env reference that passed the run start's reference check no longer resolves when the host starts (a variable unset, a file removed in between)? -> the run stops with exit 1 naming the profile, the variable and the reference (starting the agent without the variable would send its traffic the wrong way, such as around a required proxy, which is worse than a stop the operator can fix)
export async function startAgent(
  directory: string,
  opts: StartAgentOpts,
): Promise<{ host: AgentHost; error?: string } | { host?: undefined; error: string }> {
  // The permission preset reaches only agents without permission events (MA.4).
  const agent = chooseAgent(opts.agent)
  let fromProfile: Pick<AgentHostOptions, "bin" | "env" | "server" | "config"> = {}
  if (!opts.managed && opts.registry) {
    const profile = agentProfileFor(opts.registry, agent)
    if (!profile) log(`◇ the model registry has no agent profile of adapter ${agent?.name ?? "opencode"}; the agent starts without one`)
    else {
      const resolved = await resolveProfileEnv(profile)
      if ("problems" in resolved) return { error: resolved.problems.join("\n") }
      log(profileLine(profile))
      // Key rings (plans/0055 §4.3): an opencode host spawns with the rings'
      // current keys as config references — opencode substitutes each
      // reference in its own process; the driver never reads a value. Under
      // an external server (--server, OPENCODE_AUTO_SERVER, the profile's
      // server) the rings stay inactive: no config, no rotation, and the
      // run-start routing block says so.
      let config: Record<string, unknown> | undefined
      if (profile.adapter === "opencode") {
        const external = Boolean(opts.server || process.env.OPENCODE_AUTO_SERVER || profile.server)
        activateRings(opts.registry, external)
        if (!external) config = spawnKeyConfig()
      }
      fromProfile = {
        ...(profile.bin !== undefined ? { bin: profile.bin } : {}),
        ...(profile.env?.size ? { env: resolved.env } : {}),
        // --server and OPENCODE_AUTO_SERVER override the profile's server.
        ...(profile.server !== undefined ? { server: opts.server || process.env.OPENCODE_AUTO_SERVER || profile.server } : {}),
        ...(config !== undefined ? { config } : {}),
      }
    }
  }
  const host =
    opts.managed ??
    (await (agent?.host ?? opencodeHost)(directory, {
      server: opts.server,
      permission: permissionPreset(opts.permission, opts.dryrun),
      log,
      ...fromProfile,
    }))
  if (agent) log(`◇ agent: ${agent.name}`)
  const degraded = degrade(host.client.capabilities, autoSwitches(), opts)
  for (const note of degraded.notes) log(`⚙ ${note}`)
  if (degraded.error) return { host, error: degraded.error }
  clampSwitches(degraded.switches)
  return { host }
}
