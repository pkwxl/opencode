import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { manage, type Server } from "../src/server"

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
