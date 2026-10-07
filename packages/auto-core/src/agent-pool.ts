// The agent pool (plans/0055 §8.1): one host per agent profile, started
// lazily on the profile's first selection, so a profile nobody selects never
// spawns. Every driver call that takes a client resolves it from the chain's
// agent (clientOf below); the Opts.server control (ServerControl) is the
// pool, whose restart/syncContext apply to the profile's host and whose
// close closes every started host at run end. The factories receive the
// profile's bin and resolved env overlay and, for opencode, the spawn config
// (the key rings' current keys as references, §4.3): two opencode profiles
// run two managed servers, each spawning with its own rings (§8.10).
//
// Without a registry layer the pool holds exactly one agent, started eagerly
// where runAll starts it, with the same `◇ agent:` line and the same startup
// order as the one-host era. With a registry layer no host starts here:
// degrade runs once over the capability intersection of every agent with a
// candidate in a list after the agent filter (§8.5, degradeAgents over the
// adapters' static capability records — known before any host starts), and
// preflight has already checked the fleet's bins (§8.7, checkAgentBins
// below).
//
// Sits below the session layer and above the agent domain (§12): it may name
// the host factories, never the loop or a session-driving module.
import type { AgentCapabilities, AgentClient, AgentEnv, AgentHost, AgentHostFactory } from "./agent/types"
import { opencodeHost, OPENCODE_CAPABILITIES } from "./agent/opencode/server"
import { claudeHost, CLAUDE_CAPABILITIES } from "./agent/claude/host"
import { agentProfileFor, chooseAgent } from "./agent-choice"
import { profileLine, resolveProfileEnv } from "./agent-env"
import { degradeAgents, permissionPreset, type FleetAgent } from "./capability"
import { log } from "./log"
import { stepValidationLines } from "./model-step"
import type { ModelEntry, ModelRegistry } from "./models-schema"
import type { ClientSource, PermissionMode, ServerControl, SubtaskMode } from "./opts"
import { dispatchAgentProfiles, routingFacts } from "./routing"
import { shellAdapter } from "./shell"
import { services } from "./services"
import { autoSwitches, clampSwitches, SWITCH_ENV, type AgentChoice } from "./switches"

// ---------------------------------------------------------------------------
// Client resolution (every driver call that takes a client) — clientOf and
// contextLimitsOf live in src/session-api.ts (the bottom of the graph this
// module may not be imported from; stepValidationLines there reaches
// session-api, so defining them here would form a runtime cycle).
// ---------------------------------------------------------------------------

// Wraps one already started host as the run's server control (`managed`, the
// no-registry single agent): every call reaches the one host, whatever the
// agent the caller names.
export function singleHost(host: AgentHost): ServerControl {
  return {
    client: async () => host.client,
    syncContext: async () => await host.syncContext(),
    restart: async (reason) => await host.restart(reason),
    ...(host.setConfig !== undefined
      ? { setConfig: (config: Readonly<Record<string, unknown>> | undefined) => host.setConfig?.(config) }
      : {}),
    contextLimits: async () => await host.client.contextLimits(),
    close: () => host.close(),
  }
}

// ---------------------------------------------------------------------------
// The pool
// ---------------------------------------------------------------------------

export type StartPoolOpts = {
  agent?: AgentChoice
  server?: string
  permission?: PermissionMode
  testByDriver?: boolean
  // The run-level derived fact "this run includes a code-producing phase"
  // (plans/0083 D9): threads into the --test-by-driver steer clamp of the
  // capability degradation; absent = the channel may run.
  codeWork?: boolean
  interactive?: boolean
  dryrun?: boolean
  // An already started host (tests); taken as is, no agent is started and no
  // profile applies to it.
  managed?: AgentHost
  // The model registry loaded at run start; undefined = none.
  registry?: ModelRegistry
  // The run's subtask mode: degradation names what auto loses on a fleet that
  // cannot fork (plans/0059 D7).
  subtask?: SubtaskMode
}

// The pool surface plus what tests read: which agent profiles' hosts started
// (in start order, the closed ones included).
export type AgentPool = ServerControl & { startedAgents(): string[] }

// leadSplit false = the fleet cannot fork, so auto's lead runs without its
// split clause (plans/0059 D7; Degradation.leadSplit), carried to every task
// through Opts.leadSplit.
export type StartedPool =
  | { pool: AgentPool; profileName: string; error?: string; leadSplit?: false }
  | { pool?: undefined; profileName?: undefined; error: string; leadSplit?: undefined }

// A host that cannot start for a dispatch (a profile env reference that no
// longer resolves, a factory gap): the run stops (exit 1), exactly as the
// eager start would have — the attempt loop must not swallow it into its
// retry ladder. The run start's fleet resolution and preflight's checks
// catch nearly all of these before any dispatch; this is the race that slips
// between them.
export class AgentStartError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AgentStartError"
  }
}

// Starts the run's agent hosts (runAll's one entry): without a registry
// layer the one chosen agent starts eagerly, degraded by its live
// capabilities with today's wording; under a registry layer no host starts
// here — the pool starts each profile's host on its first selection, and
// degrade runs once over the capability intersection of every agent with a
// candidate in a list after the agent filter (§8.5), each note naming the
// forcing agent.
// `error` = a configuration with no fallback: the caller logs it, closes
// what started and stops. `profileName` names the run's start profile — the
// registry's pick for the chosen agent (agentProfileFor), else the chosen
// agent's own name, else `opencode` — which the routing facts carry as their
// runAgent: unqualified session records and raw override values resolve
// through it (§8.2).
export async function startPool(directory: string, opts: StartPoolOpts): Promise<StartedPool> {
  // The permission preset reaches only agents without permission events (MA.4).
  const agent = chooseAgent(opts.agent)
  if (!opts.registry || opts.managed) {
    // No registry, or a caller-supplied host: exactly the one-host era. The
    // host starts here, the `◇ agent:` line follows it, then the notes.
    const host =
      opts.managed ??
      (await (agent?.host ?? opencodeHost)(directory, { server: opts.server, permission: permissionPreset(opts.permission, opts.dryrun), log }))
    if (agent) log(`◇ agent: ${agent.name}`)
    const degraded = degradeAgents([{ caps: host.client.capabilities, label: "" }], autoSwitches(), opts, false)
    for (const note of degraded.notes) log(`⚙ ${note}`)
    const profileName = agent?.name ?? "opencode"
    if (degraded.error) return { pool: singleHostPool(host, profileName), profileName, error: degraded.error }
    clampSwitches(degraded.switches)
    return { pool: singleHostPool(host, profileName), profileName, ...(degraded.leadSplit === false ? { leadSplit: false as const } : {}) }
  }
  const registry = opts.registry
  const startProfile = agentProfileFor(registry, agent?.name)
  const profileName = startProfile?.name ?? agent?.name ?? "opencode"
  if (!startProfile) log(`◇ the model registry has no agent profile of adapter ${agent?.name ?? "opencode"}; the agent starts without one`)
  // Key rings (§4.3): one ring state per provider, activated once here. An
  // opencode host spawns with the rings' current keys as config references —
  // opencode substitutes each reference in its own process; the driver never
  // reads a value. --server and OPENCODE_AUTO_SERVER override every
  // opencode profile's server (all external: no managed spawn, no rotation,
  // the run-start block says so); otherwise the rings stay active whenever
  // any opencode profile runs a managed server, and every started host
  // spawns with the same config content (§8.10: two opencode profiles, each
  // server holding its own rings).
  const opencodeProfiles = [...registry.agents.values()].filter((profile) => profile.adapter === "opencode")
  const external =
    Boolean(opts.server || process.env[SWITCH_ENV.server]) ||
    (opencodeProfiles.length > 0 && opencodeProfiles.every((profile) => profile.server !== undefined))
  // The rings live in the run's router (this module is one of the services'
  // entry points, so it reaches the installed holder; the activation slot is
  // right here, the fleet start).
  services().router.activateRings(registry, external)
  // §8.5's fleet: every agent with a candidate in a list after the agent
  // filter. An empty fleet (no candidate in any list at all) has nothing to
  // intersect; the run's start profile stands in so a degenerate registry
  // still degrades on its one agent — preflight's coverage check reports
  // emptied lists separately.
  // The facts carry the run services' clock (one timeline for every dispatch
  // read); this module is one of the services' allowed entry points.
  const fleet = dispatchAgentProfiles(registry, routingFacts(registry, opts.agent, services().clock, services().router).agentFilter)
  const agents: FleetAgent[] = fleet.map(({ profile, names }) => ({
    caps: adapterCapabilities(profile.adapter),
    label: `${profile.adapter} (${names[0]})`,
  }))
  // The fleet's profiles — and the start profile when it is not already in —
  // resolve their env overlays here, before any host starts: a reference
  // that broke since the run start's check stops the run (exit 1), as the
  // eager start always did, instead of failing mid-run at a lazy spawn.
  const resolveTargets = new Map(fleet.map(({ profile }) => [profile.name, profile]))
  if (startProfile !== undefined) resolveTargets.set(startProfile.name, startProfile)
  const preludeEnvs = new Map<string, AgentEnv>()
  for (const profile of resolveTargets.values()) {
    const env = await resolveProfileEnv(profile)
    if ("problems" in env) return { error: env.problems.join("\n") }
    if (profile.env?.size) preludeEnvs.set(profile.name, env.env)
  }
  if (!agents.length && startProfile !== undefined) agents.push({ caps: adapterCapabilities(startProfile.adapter), label: startProfile.name })
  if (agent) log(`◇ agent: ${agent.name}`)
  const degraded = degradeAgents(agents, autoSwitches(), opts, true)
  for (const note of degraded.notes) log(`⚙ ${note}`)
  if (degraded.error) return { error: degraded.error }
  clampSwitches(degraded.switches)
  return { pool: poolOf(directory, opts, registry, profileName, preludeEnvs), profileName, ...(degraded.leadSplit === false ? { leadSplit: false as const } : {}) }
}

// The pool under a registry: lazy hosts per profile, keyed by profile name.
function poolOf(
  directory: string,
  opts: StartPoolOpts,
  registry: ModelRegistry,
  fallbackProfile: string,
  preludeEnvs: Map<string, AgentEnv>,
): AgentPool {
  const hosts = new Map<string, AgentHost>()
  const envs = new Map(preludeEnvs)
  const starting = new Map<string, Promise<AgentHost>>()
  const started: string[] = []
  const hostOf = (name: string): Promise<AgentHost> => {
    const existing = hosts.get(name)
    if (existing !== undefined) return Promise.resolve(existing)
    const inflight = starting.get(name)
    if (inflight !== undefined) return inflight
    const start = (async () => {
      const profile = registry.agents.get(name)
      if (profile === undefined && name !== fallbackProfile)
        throw new AgentStartError(`agent profile ${name} is not in the model registry; no dispatch can run on it`)
      // The registry holds no profile of the chosen agent's adapter: the
      // agent starts as it does without one (no bin, no env overlay, no
      // spawn config), on the shell's own factory for that adapter.
      const chosen = chooseAgent(opts.agent)
      if (profile !== undefined) {
        if (!envs.has(name)) {
          const env = await resolveProfileEnv(profile)
          if ("problems" in env) throw new AgentStartError(env.problems.join("\n"))
          if (profile.env?.size) envs.set(name, env.env)
        }
        log(profileLine(profile))
      }
      const factory = profile !== undefined ? hostFactory(profile.adapter, chosen) : (chosen !== undefined && chosen.name === name ? chosen.host : hostFactory(name, undefined)) ?? opencodeHost
      if (factory === undefined)
        throw new AgentStartError(`agent profile ${name} names adapter ${profile?.adapter ?? name}, which no shell registered and the core does not ship`)
      // An opencode host spawns with the rings' current keys (§4.3) unless
      // its server is external; --server and OPENCODE_AUTO_SERVER override a
      // profile's server, and a profile without `server` leaves the base
      // option to the adapter (which reads OPENCODE_AUTO_SERVER itself). The
      // config content is read from the run's router at spawn time (one ring
      // state behind the installed holder).
      const adapter = profile?.adapter ?? name
      let config: Record<string, unknown> | undefined
      if (adapter === "opencode" && !opts.server && !process.env[SWITCH_ENV.server] && profile?.server === undefined)
        config = services().router.spawnKeyConfig()
      const host = await (async () => {
        try {
          return await factory(directory, {
            server: opts.server,
            permission: permissionPreset(opts.permission, opts.dryrun),
            log,
            ...(profile?.bin !== undefined ? { bin: profile.bin } : {}),
            ...(envs.has(name) ? { env: envs.get(name)! } : {}),
            ...(profile?.server !== undefined ? { server: opts.server || process.env[SWITCH_ENV.server] || profile.server } : {}),
            ...(config !== undefined ? { config } : {}),
          })
        } catch (error) {
          // A host that cannot start stops the run, exactly as the eager
          // start of the one-agent era did (its factory throw crashed the
          // run start): the retry ladder must not turn a dead server or a
          // missing CLI into hours of retries. The adapter's own message
          // travels unchanged.
          throw new AgentStartError(error instanceof Error ? error.message : String(error))
        }
      })()
      hosts.set(name, host)
      started.push(name)
      // Step validation (§4.5, §10 item 13) runs per host, once it is up:
      // its own profile's entries against its own model list (a claude
      // entry's models would always be missing from an opencode host's, and
      // lazy start leaves no earlier moment when this host's windows exist).
      for (const line of stepValidationLines(registry, await host.client.contextLimits(), name)) log(line)
      return host
    })()
    starting.set(name, start)
    start.then(
      () => starting.delete(name),
      () => starting.delete(name),
    )
    return start
  }
  return {
    async client(agent) {
      return (await hostOf(agent ?? fallbackProfile)).client
    },
    async syncContext(agent) {
      await (await hostOf(agent ?? fallbackProfile)).syncContext()
    },
    async restart(reason, agent) {
      return await (await hostOf(agent ?? fallbackProfile)).restart(reason)
    },
    // One ring state, one config content: the next spawn config reaches
    // every started host at once (a host that has not started picks the
    // current content up at its own spawn); restart (above) then applies to
    // the chain's host alone.
    setConfig(config) {
      for (const host of hosts.values()) host.setConfig?.(config)
    },
    async contextLimits() {
      const merged = new Map<string, number>()
      for (const host of hosts.values()) for (const [model, limit] of await host.client.contextLimits()) merged.set(model, limit)
      return merged
    },
    close() {
      for (const name of started) hosts.get(name)?.close()
      hosts.clear()
    },
    startedAgents: () => [...started],
  }
}

// The single-host pool (`managed`, the no-registry run): one started agent
// under the run's profile name, closed with its host.
function singleHostPool(host: AgentHost, profileName: string): AgentPool {
  return { ...singleHost(host), close: () => host.close(), startedAgents: () => [profileName] }
}

// The host factory of an adapter: for the chosen agent's own adapter, the
// shell profile's factory (a shell may have built it with its own bin — a
// profile's `bin` still wins over it, T-026's rule); otherwise the core's
// builtin (opencode, claude) or the one a shell registered (§8.8).
function hostFactory(adapter: string, chosen: ReturnType<typeof chooseAgent>): AgentHostFactory | undefined {
  if (chosen !== undefined && chosen.name === adapter) return chosen.host
  if (adapter === "opencode") return opencodeHost
  if (adapter === "claude") return claudeHost
  return shellAdapter(adapter)?.host
}

// The static capability record of an adapter (§8.5): the builtin constants,
// or the record a shell registered with its adapter. The shell profile's own
// factory for the chosen adapter does not change the record — it wraps the
// same adapter, whose capabilities are constant.
// AUTO-DECISION: capabilities come from the adapter's static record, never off a started client (lazy start means they must be known before any host exists; the builtin constants are the very values the started clients report, and a shell adapter declares its record with its factory)
function adapterCapabilities(adapter: string): AgentCapabilities {
  if (adapter === "opencode") return OPENCODE_CAPABILITIES
  if (adapter === "claude") return CLAUDE_CAPABILITIES
  return (
    shellAdapter(adapter)?.capabilities ?? {
      resume: false,
      fork: "none",
      steer: false,
      abort: false,
      question: false,
      permission: false,
      history: false,
      usage: "none",
    }
  )
}

// ---------------------------------------------------------------------------
// Preflight's bin check (§8.7)
// ---------------------------------------------------------------------------

export const BIN_CHECK_TIMEOUT_MS = 10_000

// The bin preflight, one line per failing profile: each profile a candidate
// list references runs `<bin> --version` under the profile's resolved env,
// 10 s timeout. The driver never logs in and never reads credentials (C4):
// an expired login surfaces at runtime as an `auth`-class error, which marks
// the model down and fails over. [] = every bin runs.
// A profile without `bin` runs the adapter's default executable; a
// shell-registered adapter that declares none is skipped (nothing names what
// to run — the adapter's first host start reports the same gap a missing CLI
// would).
// AUTO-DECISION: only failure to run and exit 0 is checked, not the printed version (`--version` is the one flag every coding CLI answers uniformly, and agreeing on a version scheme is the operator's, not the driver's, business)
export async function checkAgentBins(
  registry: ModelRegistry,
  agentFilter: string | undefined,
  opts: { timeoutMs?: number } = {},
): Promise<string[]> {
  const problems: string[] = []
  for (const { profile } of dispatchAgentProfiles(registry, agentFilter)) {
    const bin = profile.bin ?? defaultBin(profile.adapter)
    if (bin === undefined) continue
    const env = await resolveProfileEnv(profile)
    if ("problems" in env) {
      problems.push(...env.problems)
      continue
    }
    const failed = await runVersionCheck(bin, env.env, opts.timeoutMs ?? BIN_CHECK_TIMEOUT_MS)
    if (failed !== undefined)
      problems.push(`agent profile ${profile.name} (adapter ${profile.adapter}): \`${bin} --version\` ${failed}; fix the executable or the profile's bin and re-run`)
  }
  return problems
}

function runVersionCheck(bin: string, overlay: AgentEnv, timeoutMs: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof Bun.spawn>
    try {
      child = Bun.spawn([bin, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        ...(Object.keys(overlay).length ? { env: childEnv(overlay) } : {}),
      })
    } catch (error) {
      resolve(error instanceof Error ? error.message : String(error))
      return
    }
    const timer = setTimeout(() => {
      child.kill()
      resolve(`timed out after ${timeoutMs}ms`)
    }, timeoutMs)
    child.exited.then(
      (code) => {
        clearTimeout(timer)
        resolve(code === 0 ? undefined : `exited ${code}`)
      },
      (error) => {
        clearTimeout(timer)
        resolve(error instanceof Error ? error.message : String(error))
      },
    )
  })
}

// The driver's environment overlaid by a resolved profile env (null removes
// an inherited variable) — the environment the profile's processes run
// under. The opencode spawn builds the same shape itself (serverEnv,
// src/agent/opencode/server.ts); claude's manager does the same with its
// session-variable removal on top.
function childEnv(overlay: AgentEnv): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const [name, value] of Object.entries(overlay)) {
    if (value === null) delete env[name]
    else env[name] = value
  }
  return env
}

function defaultBin(adapter: string): string | undefined {
  if (adapter === "opencode") return "opencode"
  if (adapter === "claude") return "claude"
  return shellAdapter(adapter)?.bin
}

// ---------------------------------------------------------------------------
// The models command's probe (§9)
// ---------------------------------------------------------------------------

// The service-availability probe prompt — the single home of the literal
// (D11, plans/0069 §2.2, which found it verbatim here and in session.ts's
// wait-and-probe loop): a minimal payload that only needs one real provider
// round trip to tell whether service is back. Never probe with the
// interrupted session (a probe turn in a real session pollutes its context,
// and a forked probe burns the full prefix on every wait round, which only
// makes a quota squeeze worse), so both senders dispatch it in a throwaway
// one-shot turn — session's awaitRecovery through attempt, the models
// command's probe through its own pool below.
export const PROBE_PROMPT = "[DRIVER] Service availability probe: reply with just ok and do nothing else."

// A probe waits for one short turn; 60 s covers a slow first model load
// while still failing a wedged provider within the operator's patience.
export const PROBE_TIMEOUT_MS = 60_000

export type ModelProbe = { name: string; agent: string; ok: boolean; line: string }

// Sends the recovery probe prompt to each listed model (every entry a tier
// list, route list or the classifier names — an unused entry is not listed)
// through a pool of its own, and answers one line per model for the shell to
// print. It is opt-in because it costs tokens.
// AUTO-DECISION: the probe runs every listed entry regardless of the agent filter and the windows (the table already names why a model is not a candidate now; --probe asks the orthogonal question — does the model answer at all — and silently probing less than the table shows would read as a healthy fleet)
// AUTO-DECISION: a probe that fails is a finding printed per model, not a command error (the command's exit code stays the registry's own: 0 with a registry the run start accepts, 1 with problems it would refuse)
export async function probeModels(
  registry: ModelRegistry,
  directory: string,
  opts: { server?: string; timeoutMs?: number } = {},
): Promise<ModelProbe[]> {
  const listed = new Set<string>()
  for (const list of Object.values(registry.tiers)) for (const name of list?.names ?? []) listed.add(name)
  for (const route of registry.routes.values()) if ("names" in route) for (const name of route.names) listed.add(name)
  for (const name of registry.classifier?.names ?? []) listed.add(name)
  const entries = [...listed].flatMap((name) => {
    const entry = registry.models.get(name)
    return entry !== undefined ? [entry] : []
  })
  const pool = await startPool(directory, { registry, server: opts.server })
  if (pool.pool === undefined)
    return entries.map((entry) => ({ name: entry.name, agent: entry.agent, ok: false, line: `failed — ${pool.error!.split("\n")[0]}` }))
  try {
    const results: ModelProbe[] = []
    for (const entry of entries) results.push(await probeOne(pool.pool, entry, opts.timeoutMs ?? PROBE_TIMEOUT_MS))
    return results
  } finally {
    pool.pool.close()
  }
}

// One probe: a one-shot session on the entry's agent, titled for the
// diagnostic, prompted on the entry's model and variant, read until the turn
// ends or the timeout aborts it. The reply's first line is the answer; an
// error, a timeout or a host-start problem names what happened.
async function probeOne(pool: ServerControl, entry: ModelEntry, timeoutMs: number): Promise<ModelProbe> {
  const base = { name: entry.name, agent: entry.agent }
  let client: AgentClient
  try {
    client = await pool.client(entry.agent)
  } catch (error) {
    return { ...base, ok: false, line: `failed — ${errorText(error)}` }
  }
  const created = await client.create({ title: "auto: model probe" })
  if (!created.ok) return { ...base, ok: false, line: `failed — ${errorText(created.error)}` }
  const session = created.value.id
  const stop = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    stop.abort()
  }, timeoutMs)
  const halted = new Promise<IteratorResult<never>>((resolve) => {
    const done = () => resolve({ done: true, value: undefined })
    if (stop.signal.aborted) done()
    else stop.signal.addEventListener("abort", done, { once: true })
  })
  let failure: string | undefined
  let reply = ""
  let settled = false
  try {
    const events = await client.events(stop.signal)
    void client
      .prompt(
        {
          session,
          text: PROBE_PROMPT,
          ...(entry.model !== undefined ? { model: entry.model } : {}),
          ...(entry.variant !== undefined ? { variant: entry.variant } : {}),
        },
        stop.signal,
      )
      .then((sent) => {
        if (sent.ok || stop.signal.aborted) return
        failure = errorText(sent.error)
        stop.abort()
      })
    const inner = events[Symbol.asyncIterator]()
    for (;;) {
      const step = await Promise.race([inner.next(), halted])
      if (step.done) break
      const event = step.value
      if (event.session !== session) continue
      if (event.type === "part" && event.part.kind === "text" && event.part.final) reply = event.part.text
      else if (event.type === "error") failure = [event.error.name, event.error.message].filter(Boolean).join(" ") || "the turn failed"
      else if (event.type === "question") await client.rejectQuestion(event.request)
      else if (event.type === "permission") await client.replyPermission(event.request, "reject")
      else if (event.type === "idle") {
        settled = true
        break
      }
    }
  } finally {
    clearTimeout(timer)
    if (!settled) {
      stop.abort()
      await client.abort(session).catch(() => {})
    }
  }
  if (settled && failure === undefined)
    return { ...base, ok: true, line: `ok — ${reply.trim().split("\n")[0]!.slice(0, 120) || "(empty reply)"}` }
  if (timedOut) return { ...base, ok: false, line: `timed out after ${Math.round(timeoutMs / 1000)}s` }
  return { ...base, ok: false, line: `failed — ${(failure ?? "the session ended without an answer").split("\n")[0]!.slice(0, 160)}` }
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : JSON.stringify(error)).split("\n")[0]!.slice(0, 160)
}
