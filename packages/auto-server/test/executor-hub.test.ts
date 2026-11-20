import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runExecutorHub, serveGrant } from "../src/executor-hub"

const grant = () => ({
  kind: "execute" as const, id: "T-001 exec 1", lease: "test-lease", deadline: Date.now() + 400,
  prompt: "leased brief", workspace: import.meta.dir,
})
const pair = { step: "T-001 exec 1", lease: "test-lease" }
const sleeper = ["sh", "-c", "sleep 10"]

test("a long-running child receives its brief while the hub renews the issued pair", async () => {
  const calls: string[] = []
  await serveGrant(grant(), ["sh", "-c", 'test "$(cat)" = "leased brief" && sleep 0.55'], async (route, body) => {
    calls.push(route)
    if (route === "heartbeat") {
      expect(body).toEqual({ leases: [pair] })
      return { protocol: 1, menu: { claimable: [], leases: [{ ...pair, kind: "execute", deadline: Date.now() + 400 }] } }
    }
    expect(body).toEqual({ ...pair, outcome: "ended" })
    return { protocol: 1 }
  }, new AbortController().signal)
  expect(calls.slice(0, -1)).toContain("heartbeat")
  expect(calls.at(-1)).toBe("report")
})

test("shutdown and launch failure give back a grant whose child never started", async () => {
  const calls: string[] = []
  const request = async (route: string, body: object) => {
    expect(body).toEqual(pair)
    calls.push(route)
    return { protocol: 1 }
  }
  await serveGrant(grant(), sleeper, request, AbortSignal.abort())
  await expect(serveGrant(grant(), ["/nonexistent-executor-child"], request, new AbortController().signal)).rejects.toThrow()
  expect(calls).toEqual(["release", "release"])
})

for (const reason of ["shutdown", "missing pair", "cap", "hung renewal"] as const) {
  test(`${reason} stops a running child before reporting failed`, async () => {
    const issued = grant()
    const shutdown = new AbortController()
    const calls: string[] = []
    const run = serveGrant(issued, sleeper, async (route, body, signal) => {
      calls.push(route)
      if (route === "heartbeat") {
        if (reason === "hung renewal") {
          await new Promise((_, reject) => signal!.addEventListener("abort", () => reject(signal!.reason), { once: true }))
        }
        const lease = reason === "missing pair" ? "replaced" : pair.lease
        return { protocol: 1, menu: { claimable: [], leases: [{ ...pair, lease, kind: issued.kind, deadline: issued.deadline }] } }
      }
      expect(body).toEqual({ ...pair, outcome: "failed" })
      return { protocol: 1 }
    }, shutdown.signal)
    if (reason === "shutdown") {
      shutdown.abort()
      await run
      expect(calls).toEqual(["report"])
    } else {
      await expect(run).rejects.toThrow()
      expect(calls).toEqual(["heartbeat", "report"])
    }
  })
}

for (const interrupt of ["claim", "child"] as const) {
  test(`SIGTERM during ${interrupt} retries settlement on the claiming channel`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "executor-hub-"))
    const calls: { route: string; body: Record<string, unknown>; authorization: string | null }[] = []
    let childStopped = false
    let hub: ReturnType<typeof Bun.spawn>
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      async fetch(req) {
        const route = new URL(req.url).pathname.split("/").at(-1)!
        if (route === "session") return Response.json({ scopes: ["executor"] })
        const body = await req.json()
        calls.push({ route, body, authorization: req.headers.get("authorization") })
        let payload
        if (route === "ready") {
          payload = { menu: { claimable: [{ unit: "T-001", kinds: ["execute"] }], leases: [] } }
        } else if (route === "claim") {
          if (interrupt === "claim") {
            hub.kill("SIGTERM")
            await Bun.sleep(30)
          }
          payload = { step: { ...grant(), workspace: dir, deadline: Date.now() + 1000 } }
        } else if (route === "heartbeat") {
          hub.kill("SIGTERM")
          payload = { menu: { leases: [{ ...pair, deadline: Date.now() + 1000 }] } }
        } else {
          if (route === "report") {
            const pid = Number(await readFile(join(dir, "pid"), "utf8"))
            try {
              process.kill(pid, 0)
            } catch (error) {
              childStopped = (error as NodeJS.ErrnoException).code === "ESRCH"
            }
          }
          if (calls.filter(c => c.route === route).length === 1) return new Response(null, { status: 503 })
          payload = { step: { kind: "done" } }
        }
        return Response.json({ protocol: 1, ...payload })
      },
    })
    try {
      const connection = join(dir, "connection.json")
      await Bun.write(connection, JSON.stringify({ url: server.url.href, token: "test" }))
      hub = Bun.spawn([process.execPath, join(import.meta.dir, "../src/index.ts"), "executor-hub", connection,
        "proj", "lane", "execute", "sh", "-c", 'echo "$$" > pid && exec sleep 10'], { stdout: "ignore" })
      expect(await hub.exited).toBe(0)
      expect(calls.map(c => c.route)).toEqual(interrupt === "claim"
        ? ["ready", "claim", "release", "release"] : ["ready", "claim", "heartbeat", "report", "report"])
      expect(calls[1].body).toEqual({ channel: "lane", role: "worker", task: "T-001", kind: "execute" })
      expect(calls.every(c => c.authorization === "Bearer test" && c.body.channel === "lane")).toBe(true)
      expect(calls.at(-1)?.body).toEqual({ channel: "lane", ...pair, ...(interrupt === "child" && { outcome: "failed" }) })
      expect(calls.at(-1)).toEqual(calls.at(-2))
      if (interrupt === "child") expect(childStopped).toBe(true)
    } finally {
      await server.stop(true)
      await rm(dir, { recursive: true, force: true })
    }
  })
}

test("a successor checks authority and recovers a live grant only after orphan cleanup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "executor-hub-"))
  const calls: string[] = []
  let scopes = ["executor", "person-questions"]
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(req) {
      const route = new URL(req.url).pathname.split("/").at(-1)!
      calls.push(route)
      if (route === "session") return Response.json({ scopes })
      const issued = grant()
      if (route === "ready") return Response.json({ protocol: 1, menu: {
        leases: [{ ...pair, kind: issued.kind, deadline: issued.deadline }], claimable: [],
      } })
      if (route === "claim") return Response.json({ protocol: 1, step: issued })
      return Response.json({ protocol: 1, step: { kind: "done" } })
    },
  })
  try {
    const connection = join(dir, "connection.json")
    await Bun.write(connection, JSON.stringify({ url: server.url.href, token: "test" }))
    const args = [connection, "project", "lane", "execute", "true"]
    await expect(runExecutorHub(args)).rejects.toThrow("without person scope")
    expect(calls.splice(0)).toEqual(["session"])
    scopes = ["executor"]
    await expect(runExecutorHub(args)).rejects.toThrow("Stop any orphaned child")
    expect(calls.splice(0)).toEqual(["session", "ready"])
    await runExecutorHub(["--resume", ...args])
    expect(calls).toEqual(["session", "ready", "claim", "report"])
  } finally {
    await server.stop(true)
    await rm(dir, { recursive: true, force: true })
  }
})
