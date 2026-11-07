// opencode server lifecycle (moved from src/server.ts in MA.3, design
// plans/0039): spawn or connect, restart, AGENTS.md sync, and the request
// timeout guard. `manage` returns the AgentHost the driver holds; its client
// is the AgentClient adapter over a proxy that always targets the current
// server instance. Logging is injected (`log`): a physically-placed agent
// domain file must not import the driver (import-direction rule 6).
import { displayUrl } from "../urls"
//
// The managed server is spawned here, not by the SDK's createOpencodeServer
// (plans/0055 F14): that runs the fixed command `opencode` with the driver's
// whole environment, so an agent profile's `bin` and `env` could not apply.
// spawnOpencodeServer keeps its arguments, its wait for the "listening on"
// line, its timeout and its errors, and takes the executable, the env overlay
// and the config content as inputs.
import { spawn as spawnProcess, spawnSync, type ChildProcess } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2"
import { driverVariable } from "../env"
import type { AgentEnv, AgentHost, AgentHostFactory } from "../types"
import { opencodeAgent } from "./client"

// The adapter's static capabilities, re-exported through this entry module so
// the agent pool can degrade over the capability intersection before any host
// starts (plans/0055 §8.5: lazy start means capabilities are known without
// spawning; the record is the same constant the started client reports).
// The X1 env scrub rides the same entry (plans/0157 D4): the pool's
// `<bin> --version` child is the agent's own executable and scrubs the
// driver's variables through the same predicate the adapters' env builders
// use (../env.ts) — re-exported here because the pool (driver domain) crosses
// into this domain only via its entry modules (D8).
export { OPENCODE_CAPABILITIES } from "./client"
export { scrubDriverEnv } from "../env"

// The external-server override's env name, restated from the driver's switch
// registry (src/switches.ts SWITCH_ENV.server) the way src/agent/env.ts
// restates the OPENCODE_AUTO_ prefix: an agent-domain file must not import
// the driver domain, so the name lives here a second time. The identity is
// ratcheted test-side (test/agent-env.test.ts, 0167 D3) — exported for that
// comparison alone.
export const SERVER_ENV = "OPENCODE_AUTO_SERVER"

export type Server = {
  client: OpencodeClient
  url: string
  close: () => void
}

// What a managed server is spawned with: the agent profile's executable and
// env overlay, and the config content (OPENCODE_CONFIG_CONTENT).
type SpawnInputs = {
  // absent = "opencode" on PATH.
  bin?: string
  env?: AgentEnv
  // absent = {}, as the SDK spawn sends it.
  config?: Readonly<Record<string, unknown>>
}

// AgentHost plus the server URL (opencode-specific, not part of the driver's
// interface; tests and diagnostics read it) and the spawn config content.
type OpencodeHost = AgentHost & {
  readonly url: string
  // Replaces the config content the next spawn uses; the running server
  // keeps what it was started with until restart(). Under an external server
  // nothing is spawned, so the content never applies. (Key rings rotate the
  // provider apiKey this way, plans/0055 §4.3.)
  setConfig(config: Readonly<Record<string, unknown>> | undefined): void
}

type Log = (line: string) => void

// Connection and response-header cap for ordinary requests: abort and warn
// when no response headers have arrived by the deadline, forbidding requests
// from queuing forever in the client's connection pool (a silent deadlock).
// Covers short interactions like session.create / question.reply; the clock
// stops once the headers arrive, so the long response bodies of SSE
// subscriptions are unaffected.
const REQUEST_TIMEOUT_MS = 60_000
// A synchronous prompt (POST /session/{id}/message) blocks until the whole AI
// turn ends; turn length is governed by the event stream and the --idle-*
// watchdog, not by the ordinary request timeout — only a generous absolute cap
// as a backstop.
const TURN_TIMEOUT_MS = 2 * 60 * 60_000

// The timeout-guarded underlying fetch, injected into the SDK client
// (createOpencodeClient's config.fetch): every request is capped until the
// response headers arrive; on timeout it aborts and logs a recognizable
// warning (the error message carries the "request timed out" wording). The
// request's own signal and the timeout signal are combined via
// AbortSignal.any, so an external abort (e.g. an SSE subscription abort) stays
// effective over the whole lifecycle — including the response-body phase,
// which SSE disconnects rely on. Keeps the SDK default fetch semantics with
// Bun's built-in 300s timeout off (request.timeout = false). timeouts'
// requestMs/turnMs and underlying (the underlying fetch) are test-injection
// points; the defaults are the constants and the global fetch.
export function timeoutFetch(
  timeouts: { requestMs?: number; turnMs?: number } = {},
  underlying: typeof fetch = ((...args: Parameters<typeof fetch>) => fetch(...args)) as typeof fetch,
  log: Log = () => {},
): typeof fetch {
  const requestMs = timeouts.requestMs ?? REQUEST_TIMEOUT_MS
  const turnMs = timeouts.turnMs ?? TURN_TIMEOUT_MS
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    // Bun extension: turn off its built-in default timeout (the Request type
    // does not declare the property; written through an assertion).
    ;(request as unknown as { timeout?: number | boolean }).timeout = false
    const url = new URL(request.url)
    const syncPrompt = request.method === "POST" && /\/session\/[^/]+\/message$/.test(url.pathname)
    const timeoutMs = syncPrompt ? turnMs : requestMs
    const controller = new AbortController()
    const seconds = Math.round(timeoutMs / 1000)
    const timer = setTimeout(() => {
      log(`⏱ opencode request timed out (no response for ${seconds}s): ${request.method} ${url.pathname}, aborted (suspected unresponsive server or connection backlog)`)
      controller.abort(new Error(`opencode request timed out (no response for ${seconds}s): ${request.method} ${url.pathname}`))
    }, timeoutMs)
    timer.unref?.()
    // Combined signal: the request's own signal (Request.signal / init.signal,
    // e.g. an SSE subscription) can still abort the fetch in the response-body
    // phase; the timeout signal is effective only before the response headers
    // (cleared as soon as the clock runs out).
    const signal = AbortSignal.any([controller.signal, request.signal, ...(init?.signal ? [init.signal] : [])])
    try {
      return await underlying(request, { signal })
    } finally {
      clearTimeout(timer)
    }
  }) as unknown as typeof fetch
}

// By default spawns an `opencode serve` automatically and manages its
// lifecycle (needs the opencode CLI on PATH, or the agent profile's bin); only
// when a url is given explicitly (--server / OPENCODE_AUTO_SERVER, or the
// agent profile's server) is an external server reused without managing its
// lifecycle. The `directory` client option locates the project per request, so
// a single server can drive any target directory. bin / env / config are the
// inputs to each spawn (restart included); an external server is not spawned
// through, so the profile's bin and env have no effect on it — one explanatory
// line is logged at startup.
export async function manage(
  directory: string,
  url: string | undefined,
  options: {
    log: Log
    spawn?: (directory: string, inputs: SpawnInputs) => Promise<Server>
    connect?: (url: string, directory: string) => Promise<Server>
  } & SpawnInputs,
): Promise<OpencodeHost> {
  const { log } = options
  const external = url ?? process.env[SERVER_ENV]
  const spawn = options.spawn ?? ((dir: string, inputs: SpawnInputs) => defaultSpawn(dir, inputs, log))
  const connect = options.connect ?? ((target: string, dir: string) => defaultConnect(target, dir, log))
  let config = options.config
  // The spawn inputs are resolved per spawn, so the person-wins strip of the
  // streaming-timeout floor re-reads the target's opencode.json each time —
  // a declaration added between spawns applies at the next one.
  const inputs = async (): Promise<SpawnInputs> => ({
    bin: options.bin,
    env: options.env,
    config: await withoutDeclaredTimeouts(directory, config),
  })
  if (external) {
    const unused = [
      ...(options.bin !== undefined ? ["bin"] : []),
      ...(options.env && Object.keys(options.env).length ? [`env (${Object.keys(options.env).join(", ")})`] : []),
    ]
    if (unused.length)
      log(`⚠ the opencode server is external: the agent profile's ${unused.join(" and ")} ${unused.length > 1 ? "have" : "has"} no effect on it, since it keeps the executable and environment it was started with`)
  }
  let server = external ? await connect(external, directory) : await spawn(directory, await inputs())
  let agents = await agentsFingerprint(directory)
  // One in-flight restart (plans/0186 D2, 0165-117): a caller arriving while
  // a restart runs joins it instead of spawning beside it — under doc lanes a
  // correlated network blip puts two lanes' restartServer retries in the same
  // window, and two spawns over one project store leak a server (live,
  // unreferenced, holding its port) for the rest of the run.
  let restarting: Promise<boolean> | undefined
  // The host's close, safe against its own restart (plans/0219 D3,
  // 0165-135): close and restart were unserialized, so a close landing while
  // a restart's spawn was in flight closed the already-closed old instance
  // and the fresh one landed in `server` unclosed — live, unreferenced,
  // holding its port and ring keys until machine reboot. The flag makes the
  // close's claim ("nothing spawns after me") structural the way the agent
  // pool's own closed guard does for its starts: a restart arriving after
  // close refuses before spawning, and an in-flight restart's spawn is
  // drained the moment it resolves (never assigned). Serial-driver floor:
  // close with no restart in flight is one flag write beside today's single
  // server.close().
  let closed = false
  // Proxy SDK client always targeting the active server — after a restart
  // swaps the instance, existing references point at the new server
  // automatically.
  const sdk = new Proxy({} as OpencodeClient, {
    get: (_target, prop) => {
      const value = Reflect.get(server.client, prop)
      return typeof value === "function" ? value.bind(server.client) : value
    },
  })
  const handle: OpencodeHost = {
    client: opencodeAgent(sdk),
    get url() {
      return server.url
    },
    setConfig(next) {
      config = next
    },
    // AGENTS.md is system context: new sessions must see the latest content
    // after an update — a fingerprint (mtime+size) change restarts the server.
    // An external server is not managed; only a notice is logged.
    async syncContext() {
      const current = await agentsFingerprint(directory)
      if (JSON.stringify(current) === JSON.stringify(agents)) return
      agents = current
      await handle.restart("AGENTS.md updated, restarting opencode server before creating a new session")
    },
    // Kill the currently spawned server and start a new instance with the
    // current spawn inputs (including the config replaced by setConfig); with
    // an external server reuse, restarting is impossible and returns false —
    // as it does on a closed host (plans/0219 D3): nothing restarts after
    // the run's close.
    async restart(reason) {
      if (external) {
        log(`⚠ ${reason}; but an external server (${displayUrl(external)}) is being reused and is not managed by this tool, keeping the current instance`)
        return false
      }
      if (restarting !== undefined) {
        log(`↻ ${reason} (joining the restart already in flight)`)
        return restarting
      }
      if (closed) {
        log(`⚠ ${reason}; but the host is already closed — no server restarts after close`)
        return false
      }
      restarting = (async () => {
        log(`↻ ${reason}`)
        server.close()
        const spawned = await spawn(directory, await inputs())
        if (closed) {
          // The host closed while this restart was in flight (plans/0219 D3):
          // the fresh instance would be live and unreferenced — shut it down
          // at once, never assigning it.
          spawned.close()
          log(`⚠ the host closed while a restart was in flight; the freshly spawned opencode server was shut down`)
          return false
        }
        server = spawned
        agents = await agentsFingerprint(directory)
        return true
      })()
      try {
        return await restarting
      } finally {
        restarting = undefined
      }
    },
    close: () => {
      closed = true
      server.close()
    },
  }
  return handle
}

async function defaultSpawn(directory: string, inputs: SpawnInputs, log: Log): Promise<Server> {
  const spawned = await spawnOpencodeServer({ ...inputs, port: 0 })
  return {
    client: createOpencodeClient({ baseUrl: spawned.url, directory, fetch: timeoutFetch({}, undefined, log) }),
    url: spawned.url,
    close: () => spawned.close(),
  }
}

// The built-in agent (MA.4, plans/0040): what a shell gets when its profile
// names no other. opencode answers permission requests through events, so the
// preset is not needed here.
export const opencodeHost: AgentHostFactory = (directory, options) =>
  manage(directory, options.server, { log: options.log, bin: options.bin, env: options.env, config: options.config })

// The external server's health probe bound (plans/0218 D3, 0165-202): the
// managed spawn fails loudly after 5 s; an external --server host that never
// answers gets the same scale instead of riding the fetch default (~300 s).
const CONNECT_HEALTH_TIMEOUT_MS = 5000

export async function defaultConnect(url: string, directory: string, log: Log, healthTimeoutMs = CONNECT_HEALTH_TIMEOUT_MS): Promise<Server> {
  let timedOut = false
  const healthy = await fetch(new URL("/api/health", url), { signal: AbortSignal.timeout(healthTimeoutMs) }).then(
    (res) => res.ok,
    (error: unknown) => {
      timedOut = error instanceof DOMException && error.name === "TimeoutError"
      return false
    },
  )
  if (!healthy)
    throw new Error(`opencode server unavailable: ${url}${timedOut ? ` (health check timed out after ${Math.round(healthTimeoutMs / 1000)}s — is the host reachable?)` : ""}`)
  return { client: createOpencodeClient({ baseUrl: url, directory, fetch: timeoutFetch({}, undefined, log) }), url, close: () => {} }
}

// The SDK's defaults (packages/sdk/js/src/v2/server.ts createOpencodeServer).
const SERVE_HOSTNAME = "127.0.0.1"
const SERVE_START_TIMEOUT_MS = 5000

// Spawns `<bin> serve` and resolves with its URL once it prints the "opencode
// server listening on <url>" line — createOpencodeServer of the SDK
// (packages/sdk/js/src/v2/server.ts) with the executable and the environment
// as inputs. Same arguments (serve --hostname --port, plus --log-level when
// the config sets logLevel), same environment (the driver's, now without the
// driver's own variables and overlaid by the profile env, then
// OPENCODE_CONFIG_CONTENT = the config's JSON, see serverEnv), same
// timeout and the same errors: the timeout, an unparsable listening line, an
// exit before it (with the process output), and a spawn error (ENOENT for a
// missing executable) as is.
// AUTO-DECISION: node:child_process spawn stands in for the SDK's cross-spawn (cross-spawn is not an auto-core dependency, and on POSIX it hands the same command, arguments and options to child_process.spawn unchanged; its Windows .cmd shim lookup is not reproduced, as no other spawn of the driver does it either)
// AUTO-DECISION: once the URL is known, output is still drained but no longer collected (the SDK keeps appending stderr to its buffer for the server's whole life; draining without collecting keeps the pipe from filling without that growth)
export async function spawnOpencodeServer(
  options: SpawnInputs & { hostname?: string; port?: number; timeout?: number },
): Promise<{ url: string; close(): void }> {
  const hostname = options.hostname ?? SERVE_HOSTNAME
  const port = options.port ?? 4096
  const timeout = options.timeout ?? SERVE_START_TIMEOUT_MS
  const config = options.config ?? {}
  const args = ["serve", `--hostname=${hostname}`, `--port=${port}`]
  if (config.logLevel) args.push(`--log-level=${config.logLevel}`)
  const proc = spawnProcess(options.bin ?? "opencode", args, { env: serverEnv(options.env, config) })
  const url = await new Promise<string>((resolve, reject) => {
    const id = setTimeout(() => {
      stop(proc)
      reject(new Error(`Timeout waiting for server to start after ${timeout}ms`))
    }, timeout)
    let output = ""
    let resolved = false
    proc.stdout?.on("data", (chunk) => {
      if (resolved) return
      output += chunk.toString()
      for (const line of output.split("\n")) {
        if (!line.startsWith("opencode server listening")) continue
        const match = line.match(/on\s+(https?:\/\/[^\s]+)/)
        if (!match) {
          stop(proc)
          clearTimeout(id)
          reject(new Error(`Failed to parse server url from output: ${line}`))
          return
        }
        clearTimeout(id)
        resolved = true
        resolve(match[1]!)
        return
      }
    })
    proc.stderr?.on("data", (chunk) => {
      if (!resolved) output += chunk.toString()
    })
    proc.on("exit", (code) => {
      clearTimeout(id)
      // A started server's later exit — the normal close() at run end — arms
      // nothing: the promise is settled, and a fresh grace timer here would
      // only pin the event loop for its 100 ms (plans/0157 D5).
      if (resolved) return
      // The exit event can land before the pipe delivers the process's last
      // chunks (an early-exiting server's error lines arrive just ahead of
      // EOF, and under load the exit notification wins the race): hold the
      // rejection back until both output streams have closed, so the message
      // carries the whole output the contract names — bounded by a short
      // grace, as a detached grandchild holding the pipe must never hang the
      // error path. The grace's handle is kept: cleared when the streams'
      // close wins the race, and unref'd so even the losing branch never
      // pins the process for its duration.
      const closed = (stream: ChildProcess["stdout"]) =>
        !stream || stream.destroyed || stream.readableEnded
          ? Promise.resolve()
          : new Promise<void>((resolve) => stream.once("close", resolve))
      let graceTimer: ReturnType<typeof setTimeout> | undefined
      const grace = new Promise<void>((resolve) => {
        graceTimer = setTimeout(resolve, 100)
        graceTimer.unref?.()
      })
      void Promise.race([Promise.all([closed(proc.stdout), closed(proc.stderr)]), grace]).then(() => {
        if (graceTimer !== undefined) clearTimeout(graceTimer)
        let msg = `Server exited with code ${code}`
        if (output.trim()) msg += `\nServer output: ${output}`
        reject(new Error(msg))
      })
    })
    proc.on("error", (error) => {
      clearTimeout(id)
      reject(error)
    })
  })
  return { url, close: () => stop(proc) }
}

// The managed server's environment: the driver's minus the driver's own
// OPENCODE_AUTO_* variables (plans/0059 X1, ../env.ts — the server's tools and
// shells inherit what it has), overlaid by the profile env (null removes an
// inherited variable), then OPENCODE_CONFIG_CONTENT, which the driver owns: it
// replaces whatever the operator's environment or the overlay holds, as the
// SDK spawn always did. A driver variable the config content names by an
// `{env:NAME}` reference (a key ring's key) stays: the server substitutes the
// reference from its own environment. Exported for tests.
// AUTO-DECISION: a driver-prefixed variable referenced by the spawn config stays in the server's environment (the driver itself built that reference from a registry key, which passed the run start's reference check against the driver's environment, so dropping it would leave the server an empty key; an operator could re-set it through the profile overlay but has no way to know it is needed)
export function serverEnv(
  overlay: AgentEnv | undefined,
  config: Readonly<Record<string, unknown>>,
  base: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const content = JSON.stringify(config)
  const referenced = new Set([...content.matchAll(/\{env:([^}]*)\}/g)].map((match) => match[1]!))
  const env: Record<string, string | undefined> = {}
  for (const [name, value] of Object.entries(base)) if (!driverVariable(name) || referenced.has(name)) env[name] = value
  for (const [name, value] of Object.entries(overlay ?? {})) {
    if (value === null) delete env[name]
    else env[name] = value
  }
  env.OPENCODE_CONFIG_CONTENT = content
  return env
}

// Stops the server process: the SDK's stop (packages/sdk/js/src/process.ts),
// with taskkill for the process tree on Windows.
function stop(proc: ChildProcess): void {
  if (proc.exitCode !== null || proc.signalCode !== null) return
  if (process.platform === "win32" && proc.pid) {
    const out = spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true })
    if (!out.error && out.status === 0) return
  }
  proc.kill()
}

// AGENTS.md change fingerprint (mtime + size); a missing file records null.
async function agentsFingerprint(directory: string): Promise<{ mtimeMs: number; size: number } | null> {
  return stat(join(directory, "AGENTS.md")).then(
    (info) => ({ mtimeMs: info.mtimeMs, size: info.size }),
    () => null,
  )
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// The streaming-timeout floor's person-wins half (plans/0127): the spawn
// config content is sent as OPENCODE_CONFIG_CONTENT, which the server merges
// after the project's config files — so a floor key the driver set would
// override a value the person declared in the target's opencode.json. The
// declaration wins: at spawn time every declared timeout key (any value,
// `false` included) is removed from the content copy the driver built. Only
// the two timeout keys are touched — the apiKey references and everything
// else pass through untouched; a config without a `provider` record and an
// undefined config return unchanged. Exported for tests.
export async function withoutDeclaredTimeouts(
  directory: string,
  config: Readonly<Record<string, unknown>> | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (config === undefined) return undefined
  const provider = config["provider"]
  if (!isRecord(provider)) return config
  const declared = await declaredProviderOptions(directory)
  if (declared === undefined) return config
  let next: Record<string, unknown> | undefined
  for (const [id, entry] of Object.entries(provider)) {
    const floor = isRecord(entry) ? entry["options"] : undefined
    if (!isRecord(floor)) continue
    if (!("headerTimeout" in floor || "chunkTimeout" in floor)) continue
    const options = declared[id]
    if (options === undefined || !("headerTimeout" in options || "chunkTimeout" in options)) continue
    const kept: Record<string, unknown> = { ...floor }
    if ("headerTimeout" in options) delete kept["headerTimeout"]
    if ("chunkTimeout" in options) delete kept["chunkTimeout"]
    next ??= { ...config, provider: { ...provider } }
    ;(next["provider"] as Record<string, unknown>)[id] = Object.keys(kept).length > 0 ? { options: kept } : {}
  }
  return next ?? config
}

// The provider options the target's opencode.json / opencode.jsonc declare.
// JSON only — a jsonc body with comments fails JSON.parse and reads as
// undeclared (the floor then applies); the first file that parses as an
// object wins, and a provider entry without an options record contributes
// nothing. Both files missing or unreadable is undefined.
async function declaredProviderOptions(directory: string): Promise<Record<string, Record<string, unknown>> | undefined> {
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    const text = await readFile(join(directory, name), "utf8").catch(() => undefined)
    if (text === undefined) continue
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      continue
    }
    if (!isRecord(value)) continue
    const provider = value["provider"]
    if (!isRecord(provider)) return {}
    const options: Record<string, Record<string, unknown>> = {}
    for (const [id, entry] of Object.entries(provider)) {
      if (isRecord(entry) && isRecord(entry["options"])) options[id] = entry["options"]
    }
    return options
  }
  return undefined
}
