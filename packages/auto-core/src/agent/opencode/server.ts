// opencode server lifecycle (moved from src/server.ts in MA.3, design
// plans/0039): spawn or connect, restart, AGENTS.md sync, and the request
// timeout guard. `manage` returns the AgentHost the driver holds; its client
// is the AgentClient adapter over a proxy that always targets the current
// server instance. Logging is injected (`log`): a physically-placed agent
// domain file must not import the driver (import-direction rule 6).
//
// The managed server is spawned here, not by the SDK's createOpencodeServer
// (plans/0055 F14): that runs the fixed command `opencode` with the driver's
// whole environment, so an agent profile's `bin` and `env` could not apply.
// spawnOpencodeServer keeps its arguments, its wait for the "listening on"
// line, its timeout and its errors, and takes the executable, the env overlay
// and the config content as inputs.
import { spawn as spawnProcess, spawnSync, type ChildProcess } from "node:child_process"
import { stat } from "node:fs/promises"
import { join } from "node:path"
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2"
import type { AgentEnv, AgentHost, AgentHostFactory } from "../types"
import { opencodeAgent } from "./client"

// The adapter's static capabilities, re-exported through this entry module so
// the agent pool can degrade over the capability intersection before any host
// starts (plans/0055 §8.5: lazy start means capabilities are known without
// spawning; the record is the same constant the started client reports).
export { OPENCODE_CAPABILITIES } from "./client"

export type Server = {
  client: OpencodeClient
  url: string
  close: () => void
}

// What a managed server is spawned with: the agent profile's executable and
// env overlay, and the config content (OPENCODE_CONFIG_CONTENT).
export type SpawnInputs = {
  // absent = "opencode" on PATH.
  bin?: string
  env?: AgentEnv
  // absent = {}, as the SDK spawn sends it.
  config?: Readonly<Record<string, unknown>>
}

// AgentHost plus the server URL (opencode-specific, not part of the driver's
// interface; tests and diagnostics read it) and the spawn config content.
export type OpencodeHost = AgentHost & {
  readonly url: string
  // Replaces the config content the next spawn uses; the running server
  // keeps what it was started with until restart(). Under an external server
  // nothing is spawned, so the content never applies. (Key rings rotate the
  // provider apiKey this way, plans/0055 §4.3.)
  setConfig(config: Readonly<Record<string, unknown>> | undefined): void
}

type Log = (line: string) => void

// 普通请求的连接与响应头上限: 到点未取得响应头即中止并告警,禁止请求在客户端
// 连接池无限排队(无声死锁)。覆盖 session.create / question.reply 等短交互;
// 响应头到达后计时即止,SSE 订阅的长响应体不受影响。
const REQUEST_TIMEOUT_MS = 60_000
// 同步 prompt(POST /session/{id}/message)阻塞到整个 AI 回合结束,回合时长由
// 事件流与 --idle-* 看门狗管束,不按普通请求超时,仅设宽裕的绝对上限兜底。
const TURN_TIMEOUT_MS = 2 * 60 * 60_000

// 带超时防护的底层 fetch,注入 SDK 客户端(createOpencodeClient 的 config.fetch):
// 每个请求在响应头到达前受上限约束,超时中止并 log 可辨识告警(错误 message 带
// 「请求超时」字样)。请求自带信号与超时信号经 AbortSignal.any 组合,外部中止
// (如 SSE 订阅 abort)在全生命周期有效——含响应体阶段,SSE 断连依赖于此。沿用
// SDK 缺省 fetch 的语义关闭 Bun 内建 300s 超时(request.timeout = false)。timeouts
// 的 requestMs/turnMs 与 underlying(底层 fetch)供测试注入,缺省用常量与全局 fetch。
export function timeoutFetch(
  timeouts: { requestMs?: number; turnMs?: number } = {},
  underlying: typeof fetch = ((...args: Parameters<typeof fetch>) => fetch(...args)) as typeof fetch,
  log: Log = () => {},
): typeof fetch {
  const requestMs = timeouts.requestMs ?? REQUEST_TIMEOUT_MS
  const turnMs = timeouts.turnMs ?? TURN_TIMEOUT_MS
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    // Bun 扩展: 关闭其内建缺省超时(Request 类型未声明该属性,经断言写入)。
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
    // 组合信号: 请求自带信号(Request.signal / init.signal,如 SSE 订阅)在响应体
    // 阶段仍能中止 fetch;超时信号仅在响应头前生效(计时到头即清)。
    const signal = AbortSignal.any([controller.signal, request.signal, ...(init?.signal ? [init.signal] : [])])
    try {
      return await underlying(request, { signal })
    } finally {
      clearTimeout(timer)
    }
  }) as unknown as typeof fetch
}

// 缺省自动 spawn 一个 `opencode serve` 并托管其生命周期(需 PATH 上有 opencode
// CLI,或 agent profile 的 bin);仅当显式给出 url(--server / OPENCODE_AUTO_SERVER,
// 或 agent profile 的 server)时复用外部 server、不托管其生命周期。`directory`
// 客户端选项按请求定位项目,单个 server 可驱动任意目标目录。bin / env / config
// 是每次 spawn(含 restart)的输入;外部 server 不经 spawn,profile 的 bin 与 env
// 对其无效,启动时记一行说明。
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
  const external = url ?? process.env.OPENCODE_AUTO_SERVER
  const spawn = options.spawn ?? ((dir: string, inputs: SpawnInputs) => defaultSpawn(dir, inputs, log))
  const connect = options.connect ?? ((target: string, dir: string) => defaultConnect(target, dir, log))
  let config = options.config
  const inputs = (): SpawnInputs => ({ bin: options.bin, env: options.env, config })
  if (external) {
    const unused = [
      ...(options.bin !== undefined ? ["bin"] : []),
      ...(options.env && Object.keys(options.env).length ? [`env (${Object.keys(options.env).join(", ")})`] : []),
    ]
    if (unused.length)
      log(`⚠ the opencode server is external: the agent profile's ${unused.join(" and ")} ${unused.length > 1 ? "have" : "has"} no effect on it, since it keeps the executable and environment it was started with`)
  }
  let server = external ? await connect(external, directory) : await spawn(directory, inputs())
  let agents = await agentsFingerprint(directory)
  // 指向当前活动 server 的代理 SDK 客户端——restart 换实例后,既有引用自动指向新 server。
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
    // AGENTS.md 是 system context,更新后新会话必须看到最新内容: 指纹(mtime+size)
    // 变化即重启 server。外部 server 不受管理,仅提示。
    async syncContext() {
      const current = await agentsFingerprint(directory)
      if (JSON.stringify(current) === JSON.stringify(agents)) return
      agents = current
      await handle.restart("AGENTS.md updated, restarting opencode server before creating a new session")
    },
    // 杀死当前 spawn 的 server 并以当前 spawn 输入(含 setConfig 替换后的 config)
    // 启动新实例;复用外部 server 时不可重启,返回 false。
    async restart(reason) {
      if (external) {
        log(`⚠ ${reason}; but an external server (${external}) is being reused and is not managed by this tool, keeping the current instance`)
        return false
      }
      log(`↻ ${reason}`)
      server.close()
      server = await spawn(directory, inputs())
      agents = await agentsFingerprint(directory)
      return true
    },
    close: () => server.close(),
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

async function defaultConnect(url: string, directory: string, log: Log): Promise<Server> {
  const healthy = await fetch(new URL("/api/health", url)).then(
    (res) => res.ok,
    () => false,
  )
  if (!healthy) throw new Error(`opencode server unavailable: ${url}`)
  return { client: createOpencodeClient({ baseUrl: url, directory, fetch: timeoutFetch({}, undefined, log) }), url, close: () => {} }
}

// The SDK's defaults (packages/sdk/js/src/v2/server.ts createOpencodeServer).
const SERVE_HOSTNAME = "127.0.0.1"
const SERVE_START_TIMEOUT_MS = 5000

// Spawns `<bin> serve` and resolves with its URL once it prints the "opencode
// server listening on <url>" line — createOpencodeServer of the SDK
// (packages/sdk/js/src/v2/server.ts) with the executable and the environment
// as inputs. Same arguments (serve --hostname --port, plus --log-level when
// the config sets logLevel), same environment (the driver's, now overlaid by
// the profile env, then OPENCODE_CONFIG_CONTENT = the config's JSON), same
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
      let msg = `Server exited with code ${code}`
      if (output.trim()) msg += `\nServer output: ${output}`
      reject(new Error(msg))
    })
    proc.on("error", (error) => {
      clearTimeout(id)
      reject(error)
    })
  })
  return { url, close: () => stop(proc) }
}

// The managed server's environment: the driver's, overlaid by the profile env
// (null removes an inherited variable), then OPENCODE_CONFIG_CONTENT, which
// the driver owns: it replaces whatever the operator's environment or the
// overlay holds, as the SDK spawn always did. Exported for tests.
export function serverEnv(
  overlay: AgentEnv | undefined,
  config: Readonly<Record<string, unknown>>,
  base: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const env = { ...base }
  for (const [name, value] of Object.entries(overlay ?? {})) {
    if (value === null) delete env[name]
    else env[name] = value
  }
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config)
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

// AGENTS.md 变更指纹(mtime + size);文件不存在记 null。
async function agentsFingerprint(directory: string): Promise<{ mtimeMs: number; size: number } | null> {
  return stat(join(directory, "AGENTS.md")).then(
    (info) => ({ mtimeMs: info.mtimeMs, size: info.size }),
    () => null,
  )
}
