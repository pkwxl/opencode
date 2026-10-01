// The structured driver-events channel end to end (T-092, P2b of the
// headless service evolution, auto-core plans/0067): GET
// /projects/<project>/status-events streams the typed RunStatusEvent journal
// (`.auto/run-status.jsonl`, the core emitter's own file) with event-id
// cursoring and bounded subscriber capacity — the monorepo server's SSE
// pattern (event ids, a bounded subscriber buffer), re-implemented on
// Bun.serve primitives, importing none of its code (the isolation line of
// T-086, pinned by test/isolation.test.ts). What these cases pin:
//   - the payloads are the typed events verbatim, each carrying an SSE id
//     (the line's 1-based number); a line that does not parse, or whose type
//     is not a member of the frozen vocabulary, is skipped — never an error
//     frame — and still consumes its id (a cursor never resyncs wrong);
//   - cursor resume after disconnect: ?after=<id> and the Last-Event-ID
//     header both re-read the journal from its start and skip exactly that
//     many lines — no event delivered twice, ids continuing where they left
//     off;
//   - rotation: the journal truncates per run start — a shrink re-seeks to 0
//     and restarts the ids, and a cursor that predates the rotation attaches
//     from line 1 with the reason spelled out;
//   - backpressure: a subscriber that falls more than the bounded capacity
//     behind is dropped (a `dropped` event, then the stream closes) — the
//     daemon never buffers unboundedly — and reconnects cleanly after its
//     last received id;
//   - the auth matrix and the whitelist for the route (401/403/404);
//   - the live e2e: during a real fixture run (the fake `claude` CLI) the
//     stream delivers the run's typed narrative — run-start, the task/unit
//     transitions, run-end with the mapped exit code — never prose.
import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import { appendFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startDaemon, type DaemonHandle } from "../src/daemon"
import { DaemonStore } from "../src/store"
import { fakeAgent, fixtureProject, scrubbedEnv, TASK } from "./fixtures/project"

// The daemon serves the tails from this process: the scrubbed-env
// conventions of the shared fixtures must hold for anything it spawns.
process.env.XDG_CONFIG_HOME = scrubbedEnv().XDG_CONFIG_HOME

// —— the harness ——

type Body = Record<string, unknown>

type Harness = {
  daemon: DaemonHandle
  read: string
  control: string
  register: (dir: string) => string
  request: (method: string, path: string, token?: string, body?: unknown) => Promise<Response>
}

async function withStatusEvents(fn: (h: Harness) => Promise<void>): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "auto-server-status-"))
  const store = new DaemonStore(dataDir)
  const read = store.issueToken("read", "reader").token
  const control = store.issueToken("control", "controller").token
  const daemon = await startDaemon({ dataDir, port: 0 })
  const request = (method: string, path: string, token?: string, body?: unknown) =>
    fetch(`${daemon.url}${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  try {
    await fn({ daemon, read, control, register: (dir) => store.register(dir).name, request })
  } finally {
    await daemon.stop()
    await rm(dataDir, { recursive: true, force: true })
  }
}

// —— the SSE client (a frame reader that also captures ids) ——

type Frame = { event: string; data: string; id?: number }

// An open stream: frames accumulate as they arrive; `until` waits (bounded)
// for the frames to satisfy a predicate; `stop` aborts the fetch so the
// server's cancel() fires and its timers stop. `open` accepts extra headers
// (the Last-Event-ID reconnect) and query text.
class Stream {
  readonly frames: Frame[] = []
  private readonly abort: AbortController
  private done: Promise<void> = Promise.resolve()
  ended = false

  private constructor(abort: AbortController) {
    this.abort = abort
  }

  static async open(url: string, token: string, headers: Record<string, string> = {}): Promise<Stream> {
    const abort = new AbortController()
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}`, ...headers }, signal: abort.signal })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    const stream = new Stream(abort)
    stream.pump(response)
    return stream
  }

  private pump(response: Response): void {
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    this.done = (async () => {
      let buffer = ""
      try {
        for (;;) {
          const { done: ended, value } = await reader.read()
          if (ended) break
          buffer += decoder.decode(value, { stream: true })
          let at: number
          while ((at = buffer.indexOf("\n\n")) >= 0) {
            const raw = buffer.slice(0, at)
            buffer = buffer.slice(at + 2)
            const event = /^event: (.+)$/m.exec(raw)?.[1]
            if (!event) continue // comment heartbeats carry no event name
            this.frames.push({ event, data: /^data: (.*)$/m.exec(raw)?.[1] ?? "", id: Number(/^id: (\d+)$/m.exec(raw)?.[1]) })
          }
        }
      } catch {
        // Aborted by stop(); the frames collected so far stand.
      }
      this.ended = true
    })()
  }

  async until(what: string, satisfied: (frames: readonly Frame[]) => boolean, timeoutMs = 10_000): Promise<readonly Frame[]> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (satisfied(this.frames)) return this.frames
      if (Date.now() > deadline) throw new Error(`the stream never delivered ${what}; frames so far: ${JSON.stringify(this.frames.slice(-6))}`)
      await Bun.sleep(25)
    }
  }

  // Waits (bounded) for the server to end the stream (the drop path closes
  // it).
  async untilEnded(timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!this.ended) {
      if (Date.now() > deadline) throw new Error(`the stream never ended; frames so far: ${JSON.stringify(this.frames.slice(-6))}`)
      await Bun.sleep(25)
    }
  }

  async stop(): Promise<void> {
    this.abort.abort()
    await this.done.catch(() => {})
  }
}

const eventsOf = (frames: readonly Frame[], event: string): string[] => frames.filter((frame) => frame.event === event).map((frame) => frame.data)
const idsOf = (frames: readonly Frame[], event: string): number[] =>
  frames.filter((frame): frame is Frame & { id: number } => frame.event === event && frame.id !== undefined).map((frame) => frame.id)

// One typed driver event as a journal line, in delivery order.
const eventLine = (n: number, type: string, extra: Record<string, unknown> = {}): string => JSON.stringify({ type, run: 1_000, at: n, ...extra })

// Appends complete lines to the journal the way the emitter does (one
// writeSync per entry; append semantics — Bun.write REPLACES and would trip
// the truncation re-seek).
async function journal(dir: string, lines: string[]): Promise<void> {
  await mkdir(join(dir, ".auto"), { recursive: true })
  for (const line of lines) await appendFile(join(dir, ".auto", "run-status.jsonl"), `${line}\n`)
}

// —— typed payloads, ids, torn/foreign lines ——

describe("status-events: typed payloads with event ids", () => {
  test("each delivered event carries its line number as the SSE id; torn and out-of-vocabulary lines are skipped but consume ids", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-server-status-typed-"))
    await journal(dir, [
      eventLine(1, "run-start", { directory: dir }),
      eventLine(2, "unit-transition", { unit: "T-001", level: "task", from: "pending", to: "in_progress" }),
      `{"type":"run-start","run":1` // torn mid-write
      ,
      eventLine(4, "not-a-vocabulary-word"),
      eventLine(5, "run-end", { code: 0 }),
    ])
    try {
      await withStatusEvents(async (h) => {
        const project = h.register(dir)
        const stream = await Stream.open(`${h.daemon.url}/projects/${project}/status-events`, h.read)
        try {
          await stream.until("the run bracket", (frames) => eventsOf(frames, "status-event").some((data) => data.includes("run-end")))
          const delivered = eventsOf(stream.frames, "status-event")
          expect(delivered).toEqual([eventLine(1, "run-start", { directory: dir }), eventLine(2, "unit-transition", { unit: "T-001", level: "task", from: "pending", to: "in_progress" }), eventLine(5, "run-end", { code: 0 })])
          // The ids are the line numbers: the torn line (3) and the foreign
          // line (4) were skipped, and run-end still carries id 5.
          expect(idsOf(stream.frames, "status-event")).toEqual([1, 2, 5])
          expect(stream.frames.filter((frame) => frame.event === "dropped")).toEqual([])
        } finally {
          await stream.stop()
        }
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 20_000)

  test("a directory with no journal yet idles without error and picks the first events up when a run writes them", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-server-status-empty-"))
    try {
      await withStatusEvents(async (h) => {
        const project = h.register(dir)
        const stream = await Stream.open(`${h.daemon.url}/projects/${project}/status-events`, h.read)
        try {
          await stream.until("the attach frame", (frames) => frames.some((frame) => frame.event === "tail"))
          await Bun.sleep(300)
          expect(eventsOf(stream.frames, "status-event")).toEqual([]) // nothing to tail, no error frame
          await journal(dir, [eventLine(1, "run-start", { directory: dir })])
          await stream.until("the first event", (frames) => eventsOf(stream.frames, "status-event").length === 1)
          expect(idsOf(stream.frames, "status-event")).toEqual([1])
        } finally {
          await stream.stop()
        }
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 20_000)
})

// —— cursor resume after disconnect ——

describe("status-events: cursor resume", () => {
  test("?after=<id> and Last-Event-ID both resume exactly after the cursor — no event delivered twice", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-server-status-cursor-"))
    const lines = Array.from({ length: 6 }, (_, i) => eventLine(i + 1, "usage-rollup", { scope: "session", usage: { input: i + 1 } }))
    await journal(dir, lines)
    try {
      await withStatusEvents(async (h) => {
        const project = h.register(dir)
        // The first subscriber sees all six, then disconnects after 4.
        const first = await Stream.open(`${h.daemon.url}/projects/${project}/status-events`, h.read)
        try {
          await first.until("all six events", (frames) => eventsOf(frames, "status-event").length === 6)
          expect(idsOf(first.frames, "status-event")).toEqual([1, 2, 3, 4, 5, 6])
        } finally {
          await first.stop()
        }
        // The query-parameter cursor: only events 5 and 6 follow, ids intact.
        const resumed = await Stream.open(`${h.daemon.url}/projects/${project}/status-events?after=4`, h.read)
        try {
          await resumed.until("the resumed tail", (frames) => eventsOf(frames, "status-event").length === 2)
          expect(eventsOf(resumed.frames, "status-event")).toEqual(lines.slice(4))
          expect(idsOf(resumed.frames, "status-event")).toEqual([5, 6])
          expect(eventsOf(resumed.frames, "tail")).toEqual([JSON.stringify({ file: ".auto/run-status.jsonl", from: 5, reason: "resumed" })])
        } finally {
          await resumed.stop()
        }
        // The SSE reconnect standard: the Last-Event-ID header does the same.
        const reconnected = await Stream.open(`${h.daemon.url}/projects/${project}/status-events`, h.read, { "last-event-id": "2" })
        try {
          await reconnected.until("the reconnect's events", (frames) => eventsOf(frames, "status-event").length === 4)
          expect(idsOf(reconnected.frames, "status-event")).toEqual([3, 4, 5, 6])
        } finally {
          await reconnected.stop()
        }
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)

  test("a cursor beyond the file's lines predates a rotation: the stream starts over at line 1 and says so", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-server-status-stale-"))
    await journal(dir, [eventLine(1, "run-start", { directory: dir }), eventLine(2, "run-end", { code: 0 })])
    try {
      await withStatusEvents(async (h) => {
        const project = h.register(dir)
        const stale = await Stream.open(`${h.daemon.url}/projects/${project}/status-events?after=9`, h.read)
        try {
          await stale.until("the stale cursor's events", (frames) => eventsOf(frames, "status-event").length === 2)
          expect(eventsOf(stale.frames, "tail")).toEqual([JSON.stringify({ file: ".auto/run-status.jsonl", from: 1, reason: "truncated" })])
          expect(idsOf(stale.frames, "status-event")).toEqual([1, 2])
        } finally {
          await stale.stop()
        }
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 20_000)

  test("a mid-stream rotation (a new run truncates the journal) re-seeks to 0 and restarts the ids", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-server-status-rotate-"))
    await journal(dir, [eventLine(1, "run-start", { directory: dir, run: 111 }), eventLine(2, "task-end", { task: "T-001", outcome: "completed" })])
    try {
      await withStatusEvents(async (h) => {
        const project = h.register(dir)
        const stream = await Stream.open(`${h.daemon.url}/projects/${project}/status-events`, h.read)
        try {
          await stream.until("run one's events", (frames) => eventsOf(frames, "status-event").length === 2)
          // A new run truncates the journal and writes its own bracket.
          await Bun.write(join(dir, ".auto", "run-status.jsonl"), `${eventLine(1, "run-start", { directory: dir, run: 222 })}\n`)
          await stream.until("run two's opening", (frames) => frames.some((frame) => frame.data.includes('"run":222')))
          expect(eventsOf(stream.frames, "tail").at(-1)).toBe(JSON.stringify({ file: ".auto/run-status.jsonl", from: 1, reason: "truncated" }))
          // Run one's events were delivered exactly once each, and the new
          // run's event carries id 1 again — the restart the reason names.
          expect(idsOf(stream.frames, "status-event")).toEqual([1, 2, 1])
        } finally {
          await stream.stop()
        }
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 20_000)
})

// —— backpressure: the bounded subscriber capacity ——

describe("status-events: backpressure (a burst-drained subscriber is dropped, then resumes)", () => {
  test("a subscriber whose connection cannot drain a burst larger than the capacity is dropped with a dropped frame; a reconnect resumes after its last id", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-server-status-slow-"))
    try {
      await withStatusEvents(async (h) => {
        const project = h.register(dir)
        // The slow subscriber over a RAW socket (a fetch client's runtime
        // buffers the body eagerly and hides the backpressure): it takes the
        // response and never applies flow control of its own — a Web client
        // whose tab went quiet. What the socket received accumulates below;
        // the frames it did not drain are the daemon's queue.
        const received: string[] = []
        const socket = await Bun.connect({
          hostname: h.daemon.hostname,
          port: h.daemon.port,
          socket: {
            data(_socket, chunk: Uint8Array) {
              received.push(new TextDecoder().decode(chunk))
            },
            open(socket) {
              socket.write(`GET /projects/${encodeURIComponent(project)}/status-events HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${h.read}\r\n\r\n`)
            },
          },
        })
        try {
          // A burst far beyond the capacity and every buffer between the
          // stream and the socket: the producer's tick enqueues frames
          // faster than the connection drains them, and the queue depth
          // crosses the bounded capacity — the drop the cap exists for (the
          // monorepo server's bounded subscriber buffer drops the same way).
          await Bun.sleep(300)
          const fat = "x".repeat(4096)
          await journal(dir, Array.from({ length: 6000 }, (_, i) => eventLine(i + 1, "failure", { message: fat })))
          const deadline = Date.now() + 20_000
          while (Date.now() < deadline && !received.join("").includes("event: dropped")) await Bun.sleep(100)
          const text = received.join("")
          expect(text).toContain("event: dropped")
          expect(text).toContain("text/event-stream")
          // The dropped subscriber reconnects after the id it did consume
          // and resumes: the journal is the durable history, the cursor the
          // id of the last event it saw.
          const seen = [...text.matchAll(/id: (\d+)/g)].map((m) => Number(m[1]))
          expect(seen.length).toBeGreaterThan(0)
          const last = Math.max(...seen)
          const resumed = await Stream.open(`${h.daemon.url}/projects/${project}/status-events?after=${last}`, h.read)
          try {
            await resumed.until("the resumed delivery", (frames) => idsOf(frames, "status-event").length > 0)
            expect(Math.min(...idsOf(resumed.frames, "status-event"))).toBe(last + 1)
            expect(resumed.frames.some((frame) => frame.event === "dropped")).toBe(false)
          } finally {
            await resumed.stop()
          }
        } finally {
          socket.end()
        }
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

// —— the auth matrix and the whitelist ——

describe("status-events: auth and the whitelist", () => {
  test("401 without a token, 403 without read, 404 unregistered; GET-only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-server-status-auth-"))
    try {
      await withStatusEvents(async (h) => {
        const project = h.register(dir)
        expect((await h.request("GET", `/projects/${project}/status-events`)).status).toBe(401)
        expect((await h.request("GET", `/projects/${project}/status-events`, h.control)).status).toBe(403)
        expect((await h.request("GET", `/projects/nope/status-events`, h.read)).status).toBe(404)
        expect((await h.request("POST", `/projects/${project}/status-events`, h.read, {})).status).toBe(404)
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 20_000)
})

// —— the live e2e: a real fixture run through the typed stream ——

describe("status-events: the live fixture run", () => {
  test("during a run the stream delivers the typed narrative — run-start, the unit transitions, run-end with the exit code — never prose", async () => {
    const dir = await fixtureProject("auto-server-status-run-")
    const agent = await fakeAgent()
    const before: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(agent.env)) {
      before[key] = process.env[key]
      process.env[key] = value
    }
    try {
      await withStatusEvents(async (h) => {
        const project = h.register(dir)
        // The subscriber is connected BEFORE the run starts: it watches the
        // whole narrative the way an outside client would.
        const stream = await Stream.open(`${h.daemon.url}/projects/${project}/status-events`, h.read)
        try {
          const started = await h.request("POST", "/runs", h.control, { project, switches: { OPENCODE_AUTO_AGENT: "claude" } })
          expect(started.status).toBe(202)
          const id = ((await started.json()) as Body).id as string
          const typed = (frame: Frame): Record<string, unknown> | undefined => {
            try {
              return JSON.parse(frame.data) as Record<string, unknown>
            } catch {
              return undefined
            }
          }
          // The narrative, as typed events only: the bracket, the task
          // transitions, the bracket's close with the exit code the run
          // registry itself maps (completed = 0).
          await stream.until("run-end", (frames) => eventsOf(frames, "status-event").some((data) => data.includes('"run-end"')), 180_000)
          const events = stream.frames.filter((frame) => frame.event === "status-event").map(typed)
          const types = events.map((event) => event?.type)
          expect(types[0]).toBe("run-start")
          expect(types.at(-1)).toBe("run-end")
          expect(types).toContain("task-start")
          expect(types).toContain("unit-transition")
          expect(types).toContain("usage-rollup")
          // The worker resolves the registry's path physically (the macOS
          // /var → /private/var symlink); the bracket names that directory.
          expect(events[0]).toMatchObject({ type: "run-start", directory: await realpath(dir) })
          const transitions = events.filter((event) => event?.type === "unit-transition")
          expect(transitions.some((event) => event?.unit === TASK && event.to === "in_progress")).toBe(true)
          expect(transitions.some((event) => event?.unit === TASK && event.to === "done")).toBe(true)
          expect(events.at(-1)).toMatchObject({ type: "run-end", code: 0 })
          // Every event of the run names the same run, and every delivered
          // frame carries an id (the cursor a reconnect resumes after).
          const run = events[0]!.run
          expect(events.every((event) => event?.run === run)).toBe(true)
          const ids = idsOf(stream.frames, "status-event")
          expect(new Set(ids).size).toBe(ids.length)
          expect(ids[0]).toBe(1)
          // The registry agrees: the run completed with code 0.
          const view = (await (await h.request("GET", `/runs/${id}`, h.read)).json()) as Body
          expect(view.state).toBe("completed")
          expect(view.code).toBe(0)
        } finally {
          await stream.stop()
        }
      })
    } finally {
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      await agent.done()
      await rm(dir, { recursive: true, force: true })
    }
  }, 300_000)
})
