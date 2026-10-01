// The daemon's own interactive endpoints (T-094, P3b): the auth and
// registry rules of the two WebSocket routes over the REAL startDaemon —
// the routing itself is pinned in test/ws-protocol.test.ts against the real
// handlers, and the end-to-end flows in test/interactive-e2e.test.ts; here
// it is the guard rails:
//   - the client endpoint authenticates like every route (401 missing or
//     unknown token, a token via ?token= — a browser WebSocket cannot set
//     headers — or the Authorization header) and requires one of the
//     interactive scopes at the door (403 names answer/control), a
//     non-websocket request gets the plain 400;
//   - the worker bridge authenticates with the per-run secret the spawn
//     payload carried (401 for anything else) and only for a run this
//     daemon knows (404 otherwise);
//   - an authenticated client's hello answers hello with the run's registry
//     state.
// The run under test is a real spawned worker over an empty directory (it
// dies fast at preflight with exit 1 — the registry entry and the hub live
// on, which is all these cases need).
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join, basename } from "node:path"
import { tmpdir } from "node:os"
import { startDaemon, type DaemonHandle } from "../src/daemon"
import { DaemonStore } from "../src/store"
import { scrubbedEnv } from "./fixtures/project"
import { wsClient } from "./fixtures/ws"

process.env.XDG_CONFIG_HOME = scrubbedEnv().XDG_CONFIG_HOME

type Harness = {
  daemon: DaemonHandle
  answer: string
  control: string
  read: string
  runId: string
  request: (method: string, path: string, token?: string) => Promise<Response>
}

// One daemon, one fast-dying run (an empty directory: preflight's own exit
// 1), and the three tokens of the scope matrix.
async function withHarness(fn: (h: Harness) => Promise<void>): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "auto-server-ws-data-"))
  const dir = await mkdtemp(join(tmpdir(), "auto-server-ws-"))
  try {
    const store = new DaemonStore(dataDir)
    store.register(dir)
    const answer = store.issueToken("answer", "answerer").token
    const control = store.issueToken("control", "controller").token
    const read = store.issueToken("read", "reader").token
    const daemon = await startDaemon({ dataDir, port: 0 })
    const request = (method: string, path: string, token?: string, body?: unknown) =>
      fetch(`${daemon.url}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const started = await request("POST", "/runs", control, { project: basename(dir) })
    const runId = ((await started.json()) as { id: string }).id
    // Wait the run out so the terminal entry is what the sockets see.
    const deadline = Date.now() + 60_000
    for (;;) {
      const run = (await (await request("GET", `/runs/${runId}`, read)).json()) as { live: boolean }
      if (!run.live) break
      if (Date.now() > deadline) throw new Error("the probe run never settled")
      await Bun.sleep(100)
    }
    try {
      await fn({ daemon, answer, control, read, runId, request })
    } finally {
      await daemon.stop()
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true })
    await rm(dir, { recursive: true, force: true })
  }
}

describe("the daemon's interactive endpoints: auth, scopes and the registry", () => {
  test("the client endpoint: 401 without a token or with an unknown one, 403 for a token with neither interactive scope, 400 for a non-websocket request", async () => {
    await withHarness(async (h) => {
      const base = `/runs/${h.runId}/interactive`
      // Auth precedes everything, including the websocket check — a probe
      // or a misrouted client learns its fate without a handshake.
      expect((await h.request("GET", base)).status).toBe(401)
      const unknown = await fetch(`${h.daemon.url}${base}?token=oas_nobodyknows`)
      expect(unknown.status).toBe(401)
      // A read-only token knows the surface but may not enter it.
      const reader = await h.request("GET", base, h.read)
      expect(reader.status).toBe(403)
      expect(((await reader.json()) as { error: string }).error).toContain('"answer" or "control" scope')
      // An interactive token on a plain GET (no upgrade): the endpoint
      // says what it is.
      const plain = await h.request("GET", base, h.answer)
      expect(plain.status).toBe(400)
      expect(((await plain.json()) as { error: string }).error).toContain("WebSocket endpoint")
      // The query-string token form is the browser's route in.
      const query = await fetch(`${h.daemon.url}${base}?token=${h.control}`)
      expect(query.status).toBe(400)
      // An unknown run is 404 for both roles, auth or not.
      expect((await h.request("GET", "/runs/run-999999/interactive", h.answer)).status).toBe(404)
      expect((await h.request("GET", "/runs/run-999999/worker")).status).toBe(404)
    })
  }, 90_000)

  test("the worker bridge: only the per-run secret passes; a real client's hello carries the run state; a wrong-secret websocket connect is refused", async () => {
    await withHarness(async (h) => {
      // The secret is daemon-held; anything else is 401 (the operator
      // tokens included — a bridge socket is one run's, not an operator's).
      expect((await h.request("GET", `/runs/${h.runId}/worker`)).status).toBe(401)
      const operator = await fetch(`${h.daemon.url}/runs/${h.runId}/worker?token=${h.control}`)
      expect(operator.status).toBe(401)
      const wrong = await fetch(`${h.daemon.url}/runs/${h.runId}/worker?token=oar_wrong`)
      expect(wrong.status).toBe(401)
      // The connect a client actually makes: hello names the run and its
      // registry state (the probe run settled failed/1; no bridge — the
      // empty directory's worker never built one).
      const base = `${h.daemon.url.replace("http", "ws")}/runs/${h.runId}/interactive`
      const client = wsClient(`${base}?token=${h.answer}`)
      try {
        await client.opened
        const hello = client.frames[0]!
        expect(hello).toMatchObject({ type: "hello", run: h.runId, state: "failed", worker: false })
        // A control frame with no bridge connected is refused, not lost —
        // from a client of the control tier (the answer-tier client would
        // be refused on the scope alone).
        const controller = wsClient(`${base}?token=${h.control}`)
        await controller.opened
        controller.send({ type: "control", action: "exit" })
        const error = await controller.nextOf((frame) => frame.type === "error", "the missing-bridge refusal")
        if (error.type === "error") expect(error.message).toContain("worker bridge is not connected")
        await controller.close()
        // A refused upgrade surfaces as a failed connect on the client side.
        const refused = wsClient(`${h.daemon.url.replace("http", "ws")}/runs/${h.runId}/worker?token=oar_wrong`)
        await expect(refused.opened).rejects.toThrow(/refused/)
      } finally {
        await client.close().catch(() => {})
      }
    })
  }, 90_000)
})
