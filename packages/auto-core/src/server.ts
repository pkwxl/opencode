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
    client: createOpencodeClient({ baseUrl: spawned.url, directory }),
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
  return { client: createOpencodeClient({ baseUrl: url, directory }), url, close: () => {} }
}

// AGENTS.md 变更指纹(mtime + size);文件不存在记 null。
async function agentsFingerprint(directory: string): Promise<{ mtimeMs: number; size: number } | null> {
  return stat(join(directory, "AGENTS.md")).then(
    (info) => ({ mtimeMs: info.mtimeMs, size: info.size }),
    () => null,
  )
}
