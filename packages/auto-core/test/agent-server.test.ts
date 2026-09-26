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

// An injectable fake server: records the close count; the client's
// session.get echoes this instance's url, so a call through the AgentClient
// identifies which instance a request landed on.
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
  // This test injects spawn/connect, so OPENCODE_AUTO_SERVER must be masked
  // out of the environment (otherwise manage connects to the external server
  // instead).
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

  test("spawns and manages by default; the client (AgentClient) is proxied to the current instance", async () => {
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

  test("restart kills the old instance and swaps in a new one; existing client references point at the new instance automatically", async () => {
    const first = fakeServer("http://127.0.0.1:1")
    const second = fakeServer("http://127.0.0.1:2")
    const spawned = [first.server, second.server]
    let index = 0
    const handle = await manage(dir, undefined, {
      log,
      spawn: async () => spawned[index++]!,
    })
    const client = handle.client
    expect(await handle.restart("test restart")).toBe(true)
    expect(first.closed).toBe(1)
    expect(second.closed).toBe(0)
    expect(handle.url).toBe("http://127.0.0.1:2")
    expect(await client.get("ses_x")).toEqual({ ok: true, value: { id: "http://127.0.0.1:2" } })
  })

  test("syncContext: an AGENTS.md update triggers a restart; no update, no restart", async () => {
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
    // Wait out the mtime resolution window, then write new content so the fingerprint surely changes.
    await new Promise((resolve) => setTimeout(resolve, 10))
    await writeFile(join(dir, "AGENTS.md"), "v2\n")
    await handle.syncContext()
    expect(first.closed).toBe(1)
    expect(second.closed).toBe(0)
  })

  test("external server: the connection is reused; no lifecycle management, no restart", async () => {
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
    expect(await handle.restart("network failure")).toBe(false)
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

// ---- timeoutFetch (the client-side request timeout guard: no unbounded queuing, a recognizable timeout) ----

// A fetch that never settles on its own: rejects with the abort reason only
// when the combined signal is aborted (mimics a real fetch).
function hangingFetch(): typeof fetch {
  return ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject((init.signal as AbortSignal).reason), { once: true })
    })) as unknown as typeof fetch
}

describe("timeoutFetch", () => {
  test("a normal request aborts once over the limit; the error message carries a recognizable 'request timed out'", async () => {
    const fetch = timeoutFetch({ requestMs: 20 }, hangingFetch())
    const request = new Request("http://127.0.0.1:1/config")
    await expect(fetch(request)).rejects.toThrow("request timed out")
  })

  test("a synchronous prompt (POST /session/{id}/message) is not timed out as a normal request; it takes the wider turn limit", async () => {
    const fetch = timeoutFetch({ requestMs: 20, turnMs: 120 }, hangingFetch())
    let settled = false
    const pending = fetch(new Request("http://127.0.0.1:1/session/ses_1/message", { method: "POST" })).catch(
      (error: unknown) => {
        settled = true
        throw error
      },
    )
    // Still hanging after the normal request limit (20ms) — proof the normal timeout was not misapplied
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(settled).toBe(false)
    await expect(pending).rejects.toThrow("request timed out")
  })

  test("a GET on the same path gets no exemption: /session/{id}/message is relaxed for POST only", async () => {
    const fetch = timeoutFetch({ requestMs: 20, turnMs: 120 }, hangingFetch())
    const request = new Request("http://127.0.0.1:1/session/ses_1/message")
    await expect(fetch(request)).rejects.toThrow("request timed out")
  })

  test("an external AbortSignal passes through: a request aborted by its own signal rejects immediately", async () => {
    const fetch = timeoutFetch({ requestMs: 60_000 }, hangingFetch())
    const controller = new AbortController()
    const pending = fetch(new Request("http://127.0.0.1:1/config"), { signal: controller.signal })
    const reason = new Error("subscription aborted")
    controller.abort(reason)
    await expect(pending).rejects.toBe(reason)
  })

  test("an external abort during the response-body phase still takes effect (the key to a dropped SSE long stream)", async () => {
    // Underlying fetch: the response headers return immediately, the body
    // hangs, and it only errors out when the signal the fetch received
    // aborts — mimicking SSE; asserting that an external signal can still
    // abort the body after the headers have returned.
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
