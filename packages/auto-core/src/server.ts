import { stat } from "node:fs/promises"
import { join } from "node:path"
import { createOpencodeClient, createOpencodeServer, type OpencodeClient } from "@opencode-ai/sdk/v2"
import { log } from "./log"

export type Server = {
  client: OpencodeClient
  url: string
  close: () => void
}

// runner 经此句柄管理会话服务: 新建会话前同步 AGENTS.md(有更新则重启 spawn 的
// server 再开新会话),网络类会话错误时重启换新实例后重试。
export type ServerControl = {
  syncAgents(): Promise<void>
  // 杀死当前 spawn 的 server 并启动新实例;复用外部 server 时不可重启,返回 false。
  restart(reason: string): Promise<boolean>
}

export type ServerHandle = ServerControl & {
  // 指向当前活动 server 的代理客户端——restart 换实例后,既有引用自动指向新 server。
  client: OpencodeClient
  url: string
  close: () => void
}

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
      log(`⏱ opencode 请求超时(${seconds} 秒无响应): ${request.method} ${url.pathname},已中止(疑似 server 无响应或连接积压)`)
      controller.abort(new Error(`opencode 请求超时(${seconds} 秒无响应): ${request.method} ${url.pathname}`))
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
// CLI);仅当显式给出 url(--server / OPENCODE_AUTO_SERVER)时复用外部 server、
// 不托管其生命周期。`directory` 客户端选项按请求定位项目,单个 server 可驱动
// 任意目标目录。
export async function manage(
  directory: string,
  url?: string,
  launch: {
    spawn?: (directory: string) => Promise<Server>
    connect?: (url: string, directory: string) => Promise<Server>
  } = {},
): Promise<ServerHandle> {
  const external = url ?? process.env.OPENCODE_AUTO_SERVER
  const spawn = launch.spawn ?? defaultSpawn
  const connect = launch.connect ?? defaultConnect
  let server = external ? await connect(external, directory) : await spawn(directory)
  let agents = await agentsFingerprint(directory)
  const handle: ServerHandle = {
    client: new Proxy({} as OpencodeClient, {
      get: (_target, prop) => {
        const value = Reflect.get(server.client, prop)
        return typeof value === "function" ? value.bind(server.client) : value
      },
    }),
    get url() {
      return server.url
    },
    // AGENTS.md 是 system context,更新后新会话必须看到最新内容: 指纹(mtime+size)
    // 变化即重启 server。外部 server 不受管理,仅提示。
    async syncAgents() {
      const current = await agentsFingerprint(directory)
      if (JSON.stringify(current) === JSON.stringify(agents)) return
      agents = current
      await handle.restart("AGENTS.md 已更新,重启 opencode server 后再开新会话")
    },
    async restart(reason) {
      if (external) {
        log(`⚠ ${reason};但当前复用外部 server(${external}),实例不由本工具管理,保持原实例继续`)
        return false
      }
      log(`↻ ${reason}`)
      server.close()
      server = await spawn(directory)
      agents = await agentsFingerprint(directory)
      return true
    },
    close: () => server.close(),
  }
  return handle
}

async function defaultSpawn(directory: string): Promise<Server> {
  const spawned = await createOpencodeServer({ port: 0 })
  return {
    client: createOpencodeClient({ baseUrl: spawned.url, directory, fetch: timeoutFetch() }),
    url: spawned.url,
    close: () => spawned.close(),
  }
}

async function defaultConnect(url: string, directory: string): Promise<Server> {
  const healthy = await fetch(new URL("/api/health", url)).then(
    (res) => res.ok,
    () => false,
  )
  if (!healthy) throw new Error(`opencode server 不可用: ${url}`)
  return { client: createOpencodeClient({ baseUrl: url, directory, fetch: timeoutFetch() }), url, close: () => {} }
}

// AGENTS.md 变更指纹(mtime + size);文件不存在记 null。
async function agentsFingerprint(directory: string): Promise<{ mtimeMs: number; size: number } | null> {
  return stat(join(directory, "AGENTS.md")).then(
    (info) => ({ mtimeMs: info.mtimeMs, size: info.size }),
    () => null,
  )
}
