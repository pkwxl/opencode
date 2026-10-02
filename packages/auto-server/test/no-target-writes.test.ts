// The daemon-writes constitution, made permanent (T-098): the daemon writes
// NOTHING inside a registered target directory — `.auto/` above all (its
// writes are driver-exclusive, the direction draft §五), the config layer and
// `docs/` unit state included for every surface that is not itself a driver
// act. The P3c queue test held this for the queue flow alone
// (test/question-queue.test.ts's closing snapshot); this suite generalizes it
// over the daemon's whole non-driver surface:
//   - the static and read surfaces: /health, the Web client shell, /session,
//     /projects, /runs, the run resource;
//   - the observability surface: the polled status read model (over planted,
//     deliberately torn `.auto/` state — defensive parsing must read, never
//     repair), the SSE log/events tails and the cursoring status-events
//     stream (they read journals the driver wrote; a tail re-seek is a read
//     position, never a file change);
//   - the read-only operations: the models table, fix dryrun;
//   - the refusal paths that would write if they could: POST /runs under a
//     live lock (423), an unconfirmed init (428), a shape-refused close (400),
//     the restored run's kill (409);
//   - the interactive transport: journal replay to a new client, an answer
//     over the wire, the worker bridge — whose daemon-side writes (the
//     question journal) live in the daemon's own data directory only.
// The driver-act operations (init/amend/fix/reset/close/task-add/plan) reach
// disk only through the core's functions — the same functions the CLI shell
// calls — and are pinned to that by their own suites (test/ops.test.ts,
// test/web-write-serve.test.ts read the core's own artifacts back); what THIS
// suite pins is that everything the daemon does on its own behalf leaves the
// target byte-identical.
import { describe, expect, test } from "bun:test"
import { appendFile, mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises"
import { hostname } from "node:os"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { startDaemon, type DaemonHandle } from "../src/daemon"
import { appendJournal, journalPath, type JournalEvent } from "../src/question-journal"
import { DaemonStore } from "../src/store"
import { wsInteractive } from "../src/worker-interactive"
import { fixtureProject, scrubbedEnv } from "./fixtures/project"
import { wsClient, type TestSocket } from "./fixtures/ws"

process.env.XDG_CONFIG_HOME = scrubbedEnv().XDG_CONFIG_HOME

const RUN = "run-000001"
const SECRET = "oar_seed0000000000000000000000000000000000000000"
const ASK = "enter your answer (Enter to confirm, no timeout and no automatic answer under plan): "

// The previous daemon life, as the daemon itself journals it: one run, one
// hard-wait ask still open (the seed of test/question-queue.test.ts — the
// replay path this guard drives needs a pending question to redeliver).
function seed(dataDir: string): void {
  const opened: JournalEvent = {
    v: 1,
    at: new Date().toISOString(),
    run: RUN,
    event: "opened",
    project: "proj",
    directory: "/tmp/seeded",
    secret: SECRET,
    started: new Date().toISOString(),
    request: { options: {}, switches: {} },
  }
  appendJournal(dataDir, opened)
  appendJournal(dataDir, { v: 1, at: new Date().toISOString(), run: RUN, event: "raised", id: "q1", text: ASK })
}

// The project tree as a snapshot (path → [size, mtime]) — what "the daemon
// wrote nothing inside the target" is asserted over (the question-queue
// suite's own helper, generalized here).
async function snapshot(dir: string): Promise<Map<string, [number, number]>> {
  const out = new Map<string, [number, number]>()
  const walk = async (rel: string): Promise<void> => {
    for (const name of await readdir(join(dir, rel), { withFileTypes: true })) {
      const child = join(rel, name.name)
      if (name.isDirectory()) await walk(child)
      else {
        const info = await stat(join(dir, child))
        out.set(child, [info.size, info.mtimeMs])
      }
    }
  }
  await walk("")
  return out
}

type Frame = { event: string; data: string }

// One SSE stream over fetch (the observe suite's shape): reads frames until
// `stop` aborts the request.
class Stream {
  readonly frames: Frame[] = []
  private readonly abort: AbortController
  private done: Promise<void> = Promise.resolve()

  private constructor(abort: AbortController) {
    this.abort = abort
  }

  static async open(url: string, token: string): Promise<Stream> {
    const abort = new AbortController()
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: abort.signal })
    expect(response.status).toBe(200)
    const stream = new Stream(abort)
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    stream.done = (async () => {
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
            if (event) stream.frames.push({ event, data: /^data: (.*)$/m.exec(raw)?.[1] ?? "" })
          }
        }
      } catch {
        // stop() aborted the fetch; the frames collected stand.
      }
    })()
    return stream
  }

  async until(what: string, satisfied: (frames: readonly Frame[]) => boolean, timeoutMs = 10_000): Promise<readonly Frame[]> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (satisfied(this.frames)) return this.frames
      if (Date.now() > deadline) throw new Error(`the stream never delivered ${what}; frames so far: ${JSON.stringify(this.frames)}`)
      await Bun.sleep(25)
    }
  }

  async stop(): Promise<void> {
    this.abort.abort()
    await this.done.catch(() => {})
  }
}

describe("the daemon writes nothing inside a registered target (the P3c snapshot, generalized)", () => {
  test("every non-driver surface leaves the project byte-identical; the daemon's own writes stay in its data dir", async () => {
    const project = await fixtureProject("auto-server-writes-")
    const dataDir = await mkdtemp(join(tmpdir(), "auto-server-writes-data-"))
    seed(dataDir)
    // A genuinely-live lock holder (not this process): every lock read the
    // daemon makes probes the pid and must never repair or remove the file.
    const holderProc = Bun.spawn(["sleep", "60"])
    const daemon = await startDaemon({ dataDir, port: 0 })
    try {
      const store = daemon.store
      store.register(project)
      const read = store.issueToken("read", "reader").token
      const control = store.issueToken("control", "controller").token
      const config = store.issueToken("config", "configurer").token
      const answer = store.issueToken("answer", "answerer").token
      const name = (await readdir(project)).length >= 0 ? store.listProjects()[0]!.name : "proj"
      const request = (method: string, path: string, token?: string, body?: unknown) =>
        fetch(`${daemon.url}${path}`, {
          method,
          headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
          body: body === undefined ? undefined : JSON.stringify(body),
        })

      // The driver's own `.auto/` state, planted the way a real run leaves
      // it: a live lock, a torn progress file (the defensive-parse path must
      // report, never rewrite), committed journals the tails follow.
      await mkdir(join(project, ".auto", "logs"), { recursive: true })
      const lock = { pid: holderProc.pid, host: hostname(), command: "run", started: new Date().toISOString() }
      await Bun.write(join(project, ".auto", "run.lock"), `${JSON.stringify(lock)}\n`)
      await Bun.write(join(project, ".auto", "progress.json"), `{"task":"T-001","step":{"kind":"task"`) // torn mid-write
      await appendFile(join(project, ".auto", "logs", "run-2026-10-01_00-00-00.log"), "▶ run starts\n■ T-001 session begins\n")
      await appendFile(join(project, ".auto", "run-events.jsonl"), `${JSON.stringify({ type: "turn-start", at: 1 })}\n`)
      await appendFile(join(project, ".auto", "run-status.jsonl"), `${JSON.stringify({ type: "run-start", run: 1, at: 1 })}\n${JSON.stringify({ type: "run-end", run: 1, at: 2, code: 0 })}\n`)
      const before = await snapshot(project)

      // —— the static and read surfaces ——
      expect((await request("GET", "/health")).status).toBe(200)
      expect((await request("GET", "/")).status).toBe(200)
      expect((await request("GET", "/app.js")).status).toBe(200)
      expect((await (await request("GET", "/session", read)).json()).scopes).toContain("read")
      expect(((await (await request("GET", "/projects", read)).json()) as { projects: { name: string }[] }).projects.map((entry) => entry.name)).toEqual([name])
      const runs = (await (await request("GET", "/runs", read)).json()) as { runs: { id: string; state: string }[] }
      expect(runs.runs.map((run) => run.id)).toEqual([RUN])
      const restored = (await (await request("GET", `/runs/${RUN}`, read)).json()) as { state: string }
      expect(restored.state).toBe("restored")

      // —— the refusal paths that would write if they could ——
      const spawn = await request("POST", "/runs", control, { project: name })
      expect(spawn.status).toBe(423) // the live lock: read, refused, never repaired
      const kill = await request("DELETE", `/runs/${RUN}`, control)
      expect(kill.status).toBe(409) // restored: not this daemon's child
      const unconfirmed = await request("POST", `/projects/${name}/init`, config, { config: { phases: "m" } })
      expect(unconfirmed.status).toBe(423) // the lock refusal fires ahead of the gates (-f never overrode it)
      expect(((await unconfirmed.json()) as { error: string }).error).toContain("holds the run lock")
      const malformed = await request("POST", `/projects/${name}/close`, control, { ref: "nope", reason: "x" })
      expect(malformed.status).toBe(400) // request-shape refusal before any read

      // —— the observability surface over the planted state ——
      const status = (await (await request("GET", `/projects/${name}/status`, read)).json()) as {
        lock: { statusLine: string } | null
        unparsable: string[]
        status: string[]
      }
      expect(status.lock?.statusLine).toContain("run in progress")
      expect(status.unparsable).toEqual([join(".auto", "progress.json")]) // reported, not repaired
      expect(status.status.length).toBeGreaterThan(0)
      const log = await Stream.open(`${daemon.url}/projects/${name}/log`, read)
      try {
        await log.until("the run log's lines", (frames) => frames.some((frame) => frame.data.includes("T-001 session begins")))
      } finally {
        await log.stop()
      }
      const events = await Stream.open(`${daemon.url}/projects/${name}/events`, read)
      try {
        await events.until("the engine journal's entries", (frames) => frames.some((frame) => frame.event === "run-event"))
      } finally {
        await events.stop()
      }
      const statusEvents = await Stream.open(`${daemon.url}/projects/${name}/status-events?after=0`, read)
      try {
        await statusEvents.until("the typed driver events", (frames) => frames.filter((frame) => frame.event === "status-event").length === 2)
      } finally {
        await statusEvents.stop()
      }

      // —— the read-only operations ——
      expect((await request("GET", `/projects/${name}/models`, read)).status).toBe(200)
      const dryrun = await request("POST", `/projects/${name}/fix`, config, { dryrun: true })
      expect([200, 409]).toContain(dryrun.status) // findings or clean: either way nothing written

      // —— the interactive transport: replay, answer, bridge ——
      const bridge = wsInteractive({ url: `${daemon.url.replace("http", "ws")}/runs/${RUN}/worker`, token: SECRET })
      const client = wsClient(`${daemon.url.replace("http", "ws")}/runs/${RUN}/interactive?token=${answer}`)
      try {
        await client.opened
        const hello = await client.nextOf((frame) => frame.type === "hello", "the restored hello")
        expect(hello).toMatchObject({ type: "hello", run: RUN, state: "restored" })
        const replayed = await client.nextOf((frame) => frame.type === "question" && frame.id === "q1", "the journal replay")
        expect(replayed).toMatchObject({ type: "question", id: "q1", text: ASK })
        // The worker's ask (held over the bridge), answered over the wire —
        // the daemon's half of that answer is a journal line in ITS data dir.
        const ask = bridge.question(ASK)
        const deadline = Date.now() + 20_000
        for (;;) {
          const sends = client.frames.length
          client.send({ type: "answer", id: "q1", text: "the answer" })
          const waited = Date.now() + 2_000
          for (;;) {
            if (client.frames.slice(sends).some((frame) => frame.type === "settled" && frame.id === "q1")) break
            if (Date.now() > waited) break
            await Bun.sleep(100)
          }
          const settled = client.frames.some((frame) => frame.type === "settled" && frame.id === "q1")
          if (settled) break
          if (Date.now() > deadline) throw new Error("the answer for q1 never settled")
        }
        await expect(ask).resolves.toBe("the answer")
      } finally {
        await client.close().catch(() => {})
        bridge.close()
      }

      // —— the constitution, asserted ——
      // The whole flow above left the registered project byte-identical: no
      // `.auto/` write (not the lock it kept probing, not the torn progress
      // it kept reporting, not the journals it kept tailing), no config
      // rewrite, no docs/ change.
      expect(await snapshot(project)).toEqual(before)
      // And the daemon's own writes resolved under its data directory only:
      // the question journal (and, through the same store, the whitelist and
      // the token digests) — never inside a target's `.auto/`.
      const journal = journalPath(dataDir)
      expect(journal.startsWith(dataDir)).toBe(true)
      expect(journal.startsWith(project)).toBe(false)
      expect(await Bun.file(journal).text()).toContain('"how":"answered"')
    } finally {
      holderProc.kill()
      await daemon.stop()
      await rm(dataDir, { recursive: true, force: true })
      await rm(project, { recursive: true, force: true })
    }
  }, 60_000)
})
