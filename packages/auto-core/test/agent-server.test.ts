import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createOpencodeServer, type OpencodeClient } from "@opencode-ai/sdk/v2"
import { manage, opencodeHost, serverEnv, spawnOpencodeServer, timeoutFetch, type Server } from "../src/agent/opencode/server"

// src/agent/opencode/server.ts (moved from src/server.ts in MA.3): server
// lifecycle behind AgentHost, and the request timeout guard. Since the model
// registry (plans/0055 F14) the driver spawns `opencode serve` itself, so an
// agent profile's bin, env overlay and the spawn config content apply.

const log = () => {}

// 可注入的假 server: 记录 close 次数;client 的 session.get 回显本实例 url,经
// AgentClient 调用即可辨认请求落到了哪个实例。
function fakeServer(url: string) {
  let closed = 0
  const server: Server = {
    client: { session: { get: async () => ({ data: { id: url } }) } } as unknown as OpencodeClient,
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

  test("缺省 spawn 并托管;client(AgentClient)经代理转发到当前实例", async () => {
    const first = fakeServer("http://127.0.0.1:1")
    let spawns = 0
    const handle = await manage(dir, undefined, {
      log,
      spawn: async () => {
        spawns++
        return first.server
      },
    })
    expect(spawns).toBe(1)
    expect(handle.url).toBe("http://127.0.0.1:1")
    expect(await handle.client.get("ses_x")).toEqual({ ok: true, value: { id: "http://127.0.0.1:1" } })
    handle.close()
    expect(first.closed).toBe(1)
  })

  test("restart 杀死旧实例并换新;既有 client 引用自动指向新实例", async () => {
    const first = fakeServer("http://127.0.0.1:1")
    const second = fakeServer("http://127.0.0.1:2")
    const spawned = [first.server, second.server]
    let index = 0
    const handle = await manage(dir, undefined, {
      log,
      spawn: async () => spawned[index++]!,
    })
    const client = handle.client
    expect(await handle.restart("测试重启")).toBe(true)
    expect(first.closed).toBe(1)
    expect(second.closed).toBe(0)
    expect(handle.url).toBe("http://127.0.0.1:2")
    expect(await client.get("ses_x")).toEqual({ ok: true, value: { id: "http://127.0.0.1:2" } })
  })

  test("syncContext: AGENTS.md 更新后触发重启,未更新则不动", async () => {
    await writeFile(join(dir, "AGENTS.md"), "v1\n")
    const first = fakeServer("http://127.0.0.1:1")
    const second = fakeServer("http://127.0.0.1:2")
    const spawned = [first.server, second.server]
    let index = 0
    const handle = await manage(dir, undefined, {
      log,
      spawn: async () => spawned[index++]!,
    })
    await handle.syncContext()
    expect(first.closed).toBe(0)
    // 等 mtime 分辨率窗口后写入新内容,确保指纹变化。
    await new Promise((resolve) => setTimeout(resolve, 10))
    await writeFile(join(dir, "AGENTS.md"), "v2\n")
    await handle.syncContext()
    expect(first.closed).toBe(1)
    expect(second.closed).toBe(0)
  })

  test("外部 server: 复用连接,不托管生命周期、不可重启", async () => {
    const external = fakeServer("http://127.0.0.1:9")
    let spawns = 0
    let connects = 0
    const handle = await manage(dir, "http://127.0.0.1:9", {
      log,
      spawn: async () => {
        spawns++
        return external.server
      },
      connect: async (url: string) => {
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

// ---- the driver's own `opencode serve` spawn (plans/0055 F14) ----

// Fake `opencode` executables in a temporary directory put first on PATH. Each
// start records its arguments and environment (numbered per start); the
// normal one then prints the SDK's listening line and stays up until killed.
// Other names misbehave the ways the spawn must report.
async function fakeOpencode(): Promise<{ dir: string; record(n: number): Promise<{ args: string[]; env: Map<string, string> }>; starts(): Promise<number> }> {
  const dir = await mkdtemp(join(tmpdir(), "auto-fake-opencode-"))
  const recording = [
    "#!/bin/sh",
    'here=$(dirname "$0")',
    'n=$(cat "$here/count" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$here/count"',
    'printf "%s\\n" "$@" > "$here/start.$n.args"',
    'env > "$here/start.$n.env"',
  ]
  const scripts: Record<string, string[]> = {
    opencode: [...recording, 'echo "some startup noise"', 'echo "opencode server listening on http://127.0.0.1:4$n"', "exec sleep 30"],
    "opencode-b": [...recording, 'echo "opencode server listening on http://127.0.0.1:5$n"', "exec sleep 30"],
    "opencode-exits": [...recording, 'echo "config error: bad provider" >&2', "exit 3"],
    "opencode-silent": [...recording, "exec sleep 30"],
    "opencode-garbled": [...recording, 'echo "opencode server listening nowhere"', "exec sleep 30"],
  }
  for (const [name, lines] of Object.entries(scripts)) {
    await writeFile(join(dir, name), `${lines.join("\n")}\n`)
    await chmod(join(dir, name), 0o755)
  }
  return {
    dir,
    async record(n) {
      const args = (await readFile(join(dir, `start.${n}.args`), "utf8")).split("\n").filter(Boolean)
      const env = new Map<string, string>()
      for (const line of (await readFile(join(dir, `start.${n}.env`), "utf8")).split("\n")) {
        const at = line.indexOf("=")
        if (at > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(line.slice(0, at))) env.set(line.slice(0, at), line.slice(at + 1))
      }
      return { args, env }
    },
    async starts() {
      return Number((await readFile(join(dir, "count"), "utf8").catch(() => "0")).trim())
    },
  }
}

describe("spawnOpencodeServer: the driver's own opencode serve", () => {
  let fake: Awaited<ReturnType<typeof fakeOpencode>>
  const saved = { PATH: process.env.PATH, OPENCODE_CONFIG_CONTENT: process.env.OPENCODE_CONFIG_CONTENT, AUTO_TEST_DROP: process.env.AUTO_TEST_DROP, AUTO_TEST_KEEP: process.env.AUTO_TEST_KEEP }
  const running: { close(): void }[] = []

  beforeEach(async () => {
    fake = await fakeOpencode()
    process.env.PATH = `${fake.dir}:${saved.PATH}`
  })

  afterEach(async () => {
    for (const server of running.splice(0)) server.close()
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(fake.dir, { recursive: true, force: true })
  })

  const started = async (options: Parameters<typeof spawnOpencodeServer>[0]) => {
    const server = await spawnOpencodeServer(options)
    running.push(server)
    return server
  }

  test("without a profile it starts exactly what the SDK spawn starts: same executable, arguments and environment", async () => {
    process.env.OPENCODE_CONFIG_CONTENT = '{"from":"the operator environment"}'
    const sdk = await createOpencodeServer({ port: 0 })
    running.push(sdk)
    const own = await started({ port: 0 })
    expect(sdk.url).toBe("http://127.0.0.1:41")
    expect(own.url).toBe("http://127.0.0.1:42")
    const [theirs, ours] = [await fake.record(1), await fake.record(2)]
    expect(ours.args).toEqual(theirs.args)
    expect(ours.args).toEqual(["serve", "--hostname=127.0.0.1", "--port=0"])
    expect(ours.env.get("OPENCODE_CONFIG_CONTENT")).toBe("{}")
    // The shell adds its own bookkeeping variables (PWD, SHLVL, _); the rest is identical.
    const shell = new Set(["PWD", "OLDPWD", "SHLVL", "_"])
    const strip = (env: Map<string, string>) => [...env].filter(([key]) => !shell.has(key)).sort(([a], [b]) => a.localeCompare(b))
    expect(strip(ours.env)).toEqual(strip(theirs.env))
  })

  test("the profile's bin, the env overlay (null removes an inherited variable) and the config content", async () => {
    process.env.AUTO_TEST_DROP = "inherited"
    process.env.AUTO_TEST_KEEP = "inherited"
    const config = { logLevel: "DEBUG", provider: { zhipuai: { options: { apiKey: "{env:ZHIPU_KEY_B}" } } } }
    const server = await started({
      bin: join(fake.dir, "opencode-b"),
      env: { AUTO_TEST_SET: "from the profile", AUTO_TEST_DROP: null, OPENCODE_CONFIG_CONTENT: "the overlay cannot set this" },
      config,
      port: 0,
    })
    expect(server.url).toBe("http://127.0.0.1:51")
    const { args, env } = await fake.record(1)
    expect(args).toEqual(["serve", "--hostname=127.0.0.1", "--port=0", "--log-level=DEBUG"])
    expect(env.get("AUTO_TEST_SET")).toBe("from the profile")
    expect(env.has("AUTO_TEST_DROP")).toBe(false)
    expect(env.get("AUTO_TEST_KEEP")).toBe("inherited")
    expect(env.get("OPENCODE_CONFIG_CONTENT")).toBe(JSON.stringify(config))
  })

  test("serverEnv: the driver's environment, the overlay, then OPENCODE_CONFIG_CONTENT", () => {
    expect(serverEnv(undefined, {}, { A: "1", OPENCODE_CONFIG_CONTENT: "x" })).toEqual({ A: "1", OPENCODE_CONFIG_CONTENT: "{}" })
    expect(serverEnv({ A: null, B: "2" }, { k: 1 }, { A: "1", C: "3" })).toEqual({ B: "2", C: "3", OPENCODE_CONFIG_CONTENT: '{"k":1}' })
  })

  test("the SDK's errors: an exit before the listening line, a timeout, an unparsable line, a missing executable", async () => {
    await expect(started({ bin: "opencode-exits", port: 0 })).rejects.toThrow("Server exited with code 3\nServer output: config error: bad provider\n")
    await expect(started({ bin: "opencode-silent", port: 0, timeout: 200 })).rejects.toThrow("Timeout waiting for server to start after 200ms")
    await expect(started({ bin: "opencode-garbled", port: 0 })).rejects.toThrow("Failed to parse server url from output: opencode server listening nowhere")
    await expect(started({ bin: join(fake.dir, "no-such-opencode"), port: 0 })).rejects.toMatchObject({ code: "ENOENT" })
  })

  test("manage: restart re-spawns with the current content; setConfig replaces it for the next spawn", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-server-"))
    const envServer = process.env.OPENCODE_AUTO_SERVER
    delete process.env.OPENCODE_AUTO_SERVER
    try {
      const handle = await manage(dir, undefined, { log, env: { AUTO_TEST_SET: "profile" }, config: { key: "A" } })
      running.push(handle)
      expect(handle.url).toBe("http://127.0.0.1:41")
      expect(await handle.restart("same content")).toBe(true)
      handle.setConfig({ key: "B" })
      expect(await handle.restart("key ring moved")).toBe(true)
      expect(handle.url).toBe("http://127.0.0.1:43")
      const contents = await Promise.all([1, 2, 3].map(async (n) => (await fake.record(n)).env.get("OPENCODE_CONFIG_CONTENT")))
      expect(contents).toEqual(['{"key":"A"}', '{"key":"A"}', '{"key":"B"}'])
      expect((await fake.record(3)).env.get("AUTO_TEST_SET")).toBe("profile")
    } finally {
      if (envServer !== undefined) process.env.OPENCODE_AUTO_SERVER = envServer
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an external server: nothing is spawned, and the log notes that the profile's bin and env have no effect", async () => {
    const lines: string[] = []
    const external = fakeServer("http://127.0.0.1:9")
    const handle = await manage("/work", "http://127.0.0.1:9", {
      log: (line) => lines.push(line),
      bin: join(fake.dir, "opencode-b"),
      env: { HTTPS_PROXY: "http://user:secret@proxy:3128", NO_PROXY: null },
      connect: async (url) => ({ client: external.server.client, url, close: () => {} }),
    })
    expect(await fake.starts()).toBe(0)
    expect(lines).toEqual([
      "⚠ the opencode server is external: the agent profile's bin and env (HTTPS_PROXY, NO_PROXY) have no effect on it, since it keeps the executable and environment it was started with",
    ])
    expect(lines.join("\n")).not.toContain("secret")
    handle.setConfig({ ignored: true })
    expect(await handle.restart("key ring moved")).toBe(false)
    expect(await fake.starts()).toBe(0)
  })

  test("opencodeHost hands the host options' bin, env and config to the spawn", async () => {
    const envServer = process.env.OPENCODE_AUTO_SERVER
    delete process.env.OPENCODE_AUTO_SERVER
    try {
      const host = await opencodeHost("/work", { permission: "deny", log, bin: "opencode-b", env: { AUTO_TEST_SET: "x" }, config: { k: 2 } })
      running.push(host)
      const { env } = await fake.record(1)
      expect(env.get("AUTO_TEST_SET")).toBe("x")
      expect(env.get("OPENCODE_CONFIG_CONTENT")).toBe('{"k":2}')
      expect((host as unknown as { url: string }).url).toBe("http://127.0.0.1:51")
    } finally {
      if (envServer !== undefined) process.env.OPENCODE_AUTO_SERVER = envServer
    }
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
    await expect(fetch(request)).rejects.toThrow("request timed out")
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
    await expect(pending).rejects.toThrow("request timed out")
  })

  test("GET 同名路径不豁免: /session/{id}/message 只对 POST 放宽", async () => {
    const fetch = timeoutFetch({ requestMs: 20, turnMs: 120 }, hangingFetch())
    const request = new Request("http://127.0.0.1:1/session/ses_1/message")
    await expect(fetch(request)).rejects.toThrow("request timed out")
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
