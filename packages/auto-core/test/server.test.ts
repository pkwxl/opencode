import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { manage, timeoutFetch, type Server } from "../src/server"

// 可注入的假 server: 记录 close 次数,client 用可区分的标记对象。
function fakeServer(url: string) {
  let closed = 0
  const server: Server = {
    client: { marker: url } as unknown as OpencodeClient,
    url,
    close: () => {
      closed++
    },
  }
  return { server, get closed() { return closed } }
}

describe("manage", () => {
  let dir: string
  // 本测试注入 spawn/connect,必须屏蔽环境里的 OPENCODE_AUTO_SERVER(否则
  // manage 会转而连接外部 server)。
  let envServer: string | undefined

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-server-"))
    envServer = process.env.OPENCODE_AUTO_SERVER
    delete process.env.OPENCODE_AUTO_SERVER
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    if (envServer !== undefined) process.env.OPENCODE_AUTO_SERVER = envServer
  })

  test("缺省 spawn 并托管;client 代理转发到当前实例", async () => {
    const first = fakeServer("http://127.0.0.1:1")
    let spawns = 0
    const handle = await manage(dir, undefined, {
      spawn: async () => {
        spawns++
        return first.server
      },
    })
    expect(spawns).toBe(1)
    expect(handle.url).toBe("http://127.0.0.1:1")
    expect((handle.client as unknown as { marker: string }).marker).toBe("http://127.0.0.1:1")
    handle.close()
    expect(first.closed).toBe(1)
  })

  test("restart 杀死旧实例并换新;既有 client 引用自动指向新实例", async () => {
    const first = fakeServer("http://127.0.0.1:1")
    const second = fakeServer("http://127.0.0.1:2")
    const spawned = [first.server, second.server]
    let index = 0
    const handle = await manage(dir, undefined, {
      spawn: async () => spawned[index++]!,
    })
    const client = handle.client
    expect(await handle.restart("测试重启")).toBe(true)
    expect(first.closed).toBe(1)
    expect(second.closed).toBe(0)
    expect(handle.url).toBe("http://127.0.0.1:2")
    expect((client as unknown as { marker: string }).marker).toBe("http://127.0.0.1:2")
  })

  test("syncAgents: AGENTS.md 更新后触发重启,未更新则不动", async () => {
    await writeFile(join(dir, "AGENTS.md"), "v1\n")
    const first = fakeServer("http://127.0.0.1:1")
    const second = fakeServer("http://127.0.0.1:2")
    const spawned = [first.server, second.server]
    let index = 0
    const handle = await manage(dir, undefined, {
      spawn: async () => spawned[index++]!,
    })
    await handle.syncAgents()
    expect(first.closed).toBe(0)
    // 等 mtime 分辨率窗口后写入新内容,确保指纹变化。
    await new Promise((resolve) => setTimeout(resolve, 10))
    await writeFile(join(dir, "AGENTS.md"), "v2\n")
    await handle.syncAgents()
    expect(first.closed).toBe(1)
    expect(second.closed).toBe(0)
  })

  test("外部 server: 复用连接,不托管生命周期、不可重启", async () => {
    const external = fakeServer("http://127.0.0.1:9")
    let spawns = 0
    let connects = 0
    const handle = await manage(dir, "http://127.0.0.1:9", {
      spawn: async () => {
        spawns++
        return external.server
      },
      connect: async (url) => {
        connects++
        return { client: external.server.client, url, close: () => {} }
      },
    })
    expect(spawns).toBe(0)
    expect(connects).toBe(1)
    expect(await handle.restart("网络故障")).toBe(false)
    expect(external.closed).toBe(0)
    handle.close()
    expect(external.closed).toBe(0)
  })
})

// ---- timeoutFetch(客户端请求超时防护: 禁止无限期排队,超时可辨识)----

// 永不主动完成的 fetch: 仅当组合信号被中止时按 abort reason 拒绝(模拟真实 fetch)。
function hangingFetch(): typeof fetch {
  return ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject((init.signal as AbortSignal).reason), { once: true })
    })) as unknown as typeof fetch
}

describe("timeoutFetch", () => {
  test("普通请求超限即中止,错误信息带「请求超时」可辨识", async () => {
    const fetch = timeoutFetch({ requestMs: 20 }, hangingFetch())
    const request = new Request("http://127.0.0.1:1/config")
    await expect(fetch(request)).rejects.toThrow("请求超时")
  })

  test("同步 prompt(POST /session/{id}/message)不按普通请求超时,走回合宽上限", async () => {
    const fetch = timeoutFetch({ requestMs: 20, turnMs: 120 }, hangingFetch())
    let settled = false
    const pending = fetch(new Request("http://127.0.0.1:1/session/ses_1/message", { method: "POST" })).catch(
      (error: unknown) => {
        settled = true
        throw error
      },
    )
    // 普通请求上限(20ms)已过仍悬挂,证明未误用普通超时
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(settled).toBe(false)
    await expect(pending).rejects.toThrow("请求超时")
  })

  test("GET 同名路径不豁免: /session/{id}/message 只对 POST 放宽", async () => {
    const fetch = timeoutFetch({ requestMs: 20, turnMs: 120 }, hangingFetch())
    const request = new Request("http://127.0.0.1:1/session/ses_1/message")
    await expect(fetch(request)).rejects.toThrow("请求超时")
  })

  test("外部 AbortSignal 透传: 请求自带信号中止时立即透传拒绝", async () => {
    const fetch = timeoutFetch({ requestMs: 60_000 }, hangingFetch())
    const controller = new AbortController()
    const pending = fetch(new Request("http://127.0.0.1:1/config"), { signal: controller.signal })
    const reason = new Error("订阅中止")
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
  })

  test("响应体阶段外部中止仍生效(SSE 长流断连的关键)", async () => {
    // 底层 fetch: 响应头立即返回,响应体悬挂,仅当 fetch 收到的信号中止时报错
    // 结束——模拟 SSE;断言响应头返回之后外部信号仍能中止响应体。
    const sseLikeFetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("data: 1\n\n"))
            init?.signal?.addEventListener("abort", () => controller.error(new Error("body-aborted")), { once: true })
          },
        })
        resolve(new Response(stream, { headers: { "content-type": "text/event-stream" } }))
      })) as unknown as typeof fetch
    const fetch = timeoutFetch({ requestMs: 60_000 }, sseLikeFetch)
    const controller = new AbortController()
    const response = await fetch(new Request("http://127.0.0.1:1/event"), { signal: controller.signal })
    const reader = response.body!.getReader()
    await reader.read()
    controller.abort()
    await expect(reader.read()).rejects.toThrow("body-aborted")
  })
})
