// The environment of agents and of the driver's own traffic (plans/0055 §4.2,
// §8.10, C4). An agent profile's `env` is an overlay on the driver's
// environment for that agent's processes. resolveProfileEnv turns it into the
// resolved overlay a host takes (AgentHostOptions.env) just before the host
// starts: a literal stays as the loader left it (`~` already expanded), a
// `{env:NAME}` reference takes the driver's variable, a `{file:path}`
// reference takes the file's content, and null removes the inherited variable.
//
// A resolved value may be a secret (a proxy URL with credentials). It goes
// into the overlay and from there only into the child's environment: nothing
// here logs, writes or builds a string from it. Problems and log lines name the
// variable and the reference (`HTTPS_PROXY`, `CLAUDE_B_PROXY`,
// `~/.secrets/proxy`), never a value.
//
// loopbackProxyWarning is the other half of §8.10: the driver reaches its
// managed opencode server over loopback with Bun's fetch, and Bun sends that
// traffic through a proxy the driver's own environment names unless NO_PROXY
// covers the loopback names.
import { readFile } from "node:fs/promises"
import type { AgentEnv } from "./agent/types"
import type { ProfileEnvValue, RegistryAgentProfile } from "./models-schema"

export type ResolvedProfileEnv = { env: AgentEnv } | { problems: string[] }

// Resolves a profile's env. { env: {} } for a profile without one. A
// reference that cannot be resolved (a variable unset or empty since the run
// start's reference check, a file gone or unreadable) is a problem; the host
// is then not started.
// AUTO-DECISION: a {file:path} value is the file's content with surrounding whitespace trimmed, so a trailing newline never reaches the variable (the same treatment opencode gives the same syntax in its config, packages/opencode/src/config/variable.ts, so a key file and a proxy file of one registry read alike)
// AUTO-DECISION: an empty file is an empty value, while an unset or empty {env:} variable is a problem (the run start's reference check already refuses an empty variable but never opens a file, C4; an empty file is taken as written rather than refused at the last moment)
// AUTO-DECISION: the overlay is resolved once, when the host starts, and the host keeps it for its restarts (the registry itself is read once per run, §4.1; one resolution keeps a restarted server on the environment the run started it with)
export async function resolveProfileEnv(
  profile: RegistryAgentProfile,
  source: Record<string, string | undefined> = process.env,
): Promise<ResolvedProfileEnv> {
  const env: Record<string, string | null> = {}
  const problems: string[] = []
  for (const [name, value] of profile.env ?? []) {
    const resolved = await resolveValue(value, source)
    if (typeof resolved === "object" && resolved !== null) {
      problems.push(`agent profile ${profile.name}: env ${name}: ${resolved.problem}`)
      continue
    }
    env[name] = resolved
  }
  return problems.length ? { problems } : { env }
}

async function resolveValue(
  value: ProfileEnvValue,
  source: Record<string, string | undefined>,
): Promise<string | null | { problem: string }> {
  if (value === null || typeof value === "string") return value
  if (value.kind === "env") {
    const found = source[value.name]
    if (found === undefined) return { problem: `env ${value.name} is not set` }
    return found === "" ? { problem: `env ${value.name} is empty` } : found
  }
  try {
    return (await readFile(value.path, "utf8")).trim()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return { problem: code === "ENOENT" ? `file ${value.label} does not exist` : `file ${value.label} cannot be read (${code ?? "error"})` }
  }
}

// The startup line of the profile a run's agent starts with: its name and
// adapter, then the bin and the env variable names it sets and removes.
// Values never appear, nor the server URL (it may carry user information).
export function profileLine(profile: RegistryAgentProfile): string {
  const parts: string[] = []
  if (profile.bin !== undefined) parts.push(`bin ${profile.bin}`)
  if (profile.server !== undefined) parts.push("external server")
  const env = [...(profile.env ?? [])]
  const set = env.filter(([, value]) => value !== null).map(([name]) => name)
  const removed = env.filter(([, value]) => value === null).map(([name]) => name)
  if (set.length) parts.push(`env: ${set.join(", ")}`)
  if (removed.length) parts.push(`env removed: ${removed.join(", ")}`)
  const origin = profile.layer === "implied" ? "implied" : `${profile.layer} layer`
  return `◇ agent profile ${profile.name} (${profile.adapter}, ${origin})${parts.length ? `: ${parts.join("; ")}` : ""}`
}

// The loopback names the driver's own requests may use: the managed server
// announces itself on 127.0.0.1, and localhost is the other common spelling of
// an external server on the same machine.
export const LOOPBACK_NAMES = ["127.0.0.1", "localhost"] as const

// The preflight warning of §8.10, or undefined when the driver's own loopback
// traffic goes direct. Measured on Bun 1.4.2 (2026-09-25; plans/0055 §8.10):
// Bun's fetch does not bypass loopback on its own. With HTTP_PROXY or
// http_proxy set, requests to http://127.0.0.1:<port> and
// http://localhost:<port> both go to the proxy. HTTPS_PROXY / https_proxy
// apply to https URLs only, and ALL_PROXY is not read. A non-empty no_proxy
// wins over NO_PROXY. Its comma-separated entries match a host name exactly
// (case and surrounding spaces ignored, a leading "." allowed), `*` matches
// every host, and `host:port` matches that port only. CIDR ranges (127.0.0.0/8)
// and wildcards (127.*) do not match.
// AUTO-DECISION: only the http proxy variables raise the warning (the managed server listens on http, and the measurement shows HTTPS_PROXY alone leaves http loopback direct); a port-bearing NO_PROXY entry does not count as coverage (the managed server's port is new at every spawn)
export function loopbackProxyWarning(env: Record<string, string | undefined>): string | undefined {
  const proxies = ["HTTP_PROXY", "http_proxy"].filter((name) => env[name])
  if (!proxies.length) return undefined
  const noProxyName = env.no_proxy ? "no_proxy" : "NO_PROXY"
  const entries = (env[noProxyName] ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean)
  const missing = entries.includes("*") ? [] : LOOPBACK_NAMES.filter((name) => !entries.includes(name))
  if (!missing.length) return undefined
  return (
    `⚠ ${proxies.join(" and ")} ${proxies.length > 1 ? "are" : "is"} set in the driver's environment and ${noProxyName} does not cover ${missing.join(" or ")}: ` +
    `Bun does not bypass loopback on its own, so the driver's requests to its opencode server would go through the proxy. ` +
    `Add ${missing.join(",")} to ${noProxyName}, and give an agent that needs the proxy its own through its agent profile's env in the model registry`
  )
}
