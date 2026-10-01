// The persistent pending-question queue over the REAL daemon (T-095, P3c):
// the restart/reconnect/idempotency matrix of the unit's acceptance, driven
// end to end through the daemon's own WebSocket surface with the worker's
// REAL transport implementation (src/worker-interactive.ts) connected as the
// run's bridge from inside the test — no subprocess needed, because the
// journal's seed IS the previous daemon life: the records the daemon itself
// writes. What these cases pin:
//   - journal replay redelivers to a new client after a daemon restart: the
//     restarted daemon restores the run (state `restored`), the orphan
//     worker's bridge reconnects against the journaled secret, its
//     still-held ask is re-raised on the fresh socket, and the answer a new
//     client sends completes the ask — the run's own question() resolves;
//   - idempotency: a settled question is never re-delivered, a double or
//     stale answer is a no-op answered with a diagnostic error frame (the
//     socket stays open);
//   - the blocked degradation: an unanswered ask whose daemon never returns
//     resolves undefined within the bounded reconnect grace — never a hang;
//   - the restored run's surface: GET /runs/<id> reads `restored`/not live,
//     DELETE (kill) answers 409 naming that the worker is not this daemon's
//     child, and a wrong bridge secret is refused;
//   - the daemon writes nothing inside the registered project: the whole
//     queue flow leaves the project's tree byte-identical, and the journal
//     resolves under the daemon's data directory only.
// The ordering mirrors the real topology: the worker's bridge connects
// BEFORE it asks (a real worker builds its transport at process start and
// asks much later), so an answer can never precede the ask's registration.
// The full flow over a REAL spawned worker (a between-tasks pause answered
// across a restart, the run completing) lives in test/question-queue-e2e.test.ts.
import { describe, expect, test } from "bun:test"
import { mkdtemp, readdir, rm, stat } from "node:fs/promises"
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
// hard-wait ask still open. Seeding by hand is precise here — the format is
// the daemon's own (src/question-journal.ts, documented in docs/daemon.md).
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

type Harness = {
  daemon: DaemonHandle
  dataDir: string
  answer: string
  read: string
  control: string
  project: string
}

// One daemon over one temp data directory (a seeded journal, a registered
// project, the three tokens), on a port the restart reuses.
async function withQueue(fn: (h: Harness) => Promise<void>): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "auto-server-queue-data-"))
  seed(dataDir)
  const project = await fixtureProject("auto-server-queue-proj-")
  const store = new DaemonStore(dataDir)
  store.register(project)
  const answer = store.issueToken("answer", "answerer").token
  const read = store.issueToken("read", "reader").token
  const control = store.issueToken("control", "controller").token
  const first = await startDaemon({ dataDir, port: 0 })
  try {
    await fn({ daemon: first, dataDir, answer, read, control, project })
  } finally {
    // A test may already have stopped (and restarted over) this handle.
    await first.stop().catch(() => {})
    await rm(dataDir, { recursive: true, force: true })
    await rm(project, { recursive: true, force: true })
  }
}

const wsBase = (daemon: DaemonHandle): string => daemon.url.replace("http", "ws")
const clientUrl = (daemon: DaemonHandle, token: string): string => `${wsBase(daemon)}/runs/${RUN}/interactive?token=${token}`

// The worker's bridge, held across whatever the test does to the daemon.
const bridgeOf = (daemon: DaemonHandle) => wsInteractive({ url: `${wsBase(daemon)}/runs/${RUN}/worker`, token: SECRET })

// Wait until the daemon's hello names the bridge as connected — the real
// topology's order (bridge first, asks later), observed the only way the
// wire exposes it. Each probe is one short-lived client socket.
async function untilBridgeConnected(daemon: DaemonHandle, token: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const probe = wsClient(clientUrl(daemon, token))
    try {
      await probe.opened
      const hello = probe.frames[0]!
      if (hello.type === "hello" && hello.worker) return
    } finally {
      await probe.close().catch(() => {})
    }
    if (Date.now() > deadline) throw new Error("the worker bridge never connected")
    await Bun.sleep(100)
  }
}

// The documented client contract for an answer in the bridge gap: the
// refusal names the retry, so the helper retries until the settle lands
// (reading only the frames that arrived after each send, so accumulated
// refusals never mask it), surfacing any other refusal verbatim.
async function answerUntilSettled(client: TestSocket, id: string, text: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const before = client.frames.length
    client.send({ type: "answer", id, text })
    const waited = Date.now() + 2_000
    for (;;) {
      const fresh = client.frames.slice(before)
      if (fresh.some((frame) => frame.type === "settled" && frame.id === id)) return
      const refused = fresh.find((frame) => frame.type === "error" && !frame.message.includes("worker bridge is not connected"))
      if (refused !== undefined) {
        if (refused.type === "error") throw new Error(`the answer was refused: ${refused.message}`)
      }
      if (Date.now() > waited) break
      await Bun.sleep(100)
    }
    if (Date.now() > deadline) throw new Error(`the answer for ${id} never settled`)
  }
}

// The project tree as a snapshot (path → [size, mtime]) — what "the daemon
// wrote nothing inside the target" is asserted over.
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

describe("the persistent pending-question queue over the real daemon", () => {
  test("journal replay redelivers to a new client after a restart; the answer completes the still-held ask; idempotency throughout", async () => {
    await withQueue(async (h) => {
      const before = await snapshot(h.project)
      // The restored surface: the seeded run reads `restored` (not live,
      // never terminal), kill answers 409 naming the unsupervised child,
      // and only the journaled secret passes the bridge door.
      const view = (await (await fetch(`${h.daemon.url}/runs/${RUN}`, { headers: { authorization: `Bearer ${h.read}` } })).json()) as { state: string; live: boolean }
      expect(view).toMatchObject({ state: "restored", live: false })
      const kill = await fetch(`${h.daemon.url}/runs/${RUN}`, { method: "DELETE", headers: { authorization: `Bearer ${h.control}` } })
      expect(kill.status).toBe(409)
      expect(((await kill.json()) as { error: string }).error).toContain("not this daemon's child")
      expect((await fetch(`${h.daemon.url}/runs/${RUN}/worker?token=oar_wrong`)).status).toBe(401)

      // The orphan worker's bridge connects against the journaled secret
      // FIRST (the real topology), then holds its still-blocking ask — the
      // same id the journal seeded (the transport's counter is per worker).
      const bridge = bridgeOf(h.daemon)
      const watcher = wsClient(clientUrl(h.daemon, h.answer))
      try {
        await watcher.opened
        await untilBridgeConnected(h.daemon, h.answer)
        const ask = bridge.question(ASK)
        const question = await watcher.nextOf((frame) => frame.type === "question" && frame.id === "q1", "the ask fanned out", 30_000)
        expect(question).toMatchObject({ type: "question", id: "q1", text: ASK })
        expect("minutes" in question).toBe(false)

        // —— the daemon restarts mid-question ——
        const port = h.daemon.port
        await h.daemon.stop()
        const restarted = await startDaemon({ dataDir: h.dataDir, port })
        try {
          // A NEW client connects to the restarted daemon: journal replay
          // redelivers the pending set (hello names the restored state).
          const client = wsClient(clientUrl(restarted, h.answer))
          try {
            await client.opened
            const hello = await client.nextOf((frame) => frame.type === "hello", "the restarted daemon's hello", 30_000)
            expect(hello).toMatchObject({ type: "hello", run: RUN, state: "restored" })
            const replayed = await client.nextOf((frame) => frame.type === "question" && frame.id === "q1", "the journal replay", 30_000)
            expect(replayed).toMatchObject({ type: "question", id: "q1", text: ASK })

            // The answer returns over the wire: the worker's ask — held
            // across the restart by the reconnect grace and re-raised on
            // the fresh socket — resolves with the answer text. (In the
            // bridge gap the refusal names the retry; the helper follows
            // the documented contract.)
            await answerUntilSettled(client, "q1", "sqlite, the embedded one")
            await expect(ask).resolves.toBe("sqlite, the embedded one")

            // Idempotency: a settled question is never re-delivered, and a
            // double or stale answer is a no-op with a diagnostic (the
            // socket stays open throughout).
            client.send({ type: "answer", id: "q1", text: "again" })
            const twice = await client.nextOf((frame) => frame.type === "error" && frame.message.includes("q1"), "the double-answer diagnostic")
            if (twice.type === "error") expect(twice.message).toContain("no open question q1")
            client.send({ type: "answer", id: "q9", text: "?" })
            const stale = await client.nextOf((frame) => frame.type === "error" && frame.message.includes("q9"), "the stale-answer diagnostic")
            if (stale.type === "error") expect(stale.message).toContain("no open question q9")
            expect(client.ws.readyState).toBe(WebSocket.OPEN)
            const late = wsClient(clientUrl(restarted, h.answer))
            await late.opened
            expect(late.frames.filter((frame) => frame.type === "question")).toEqual([])
            await late.close()
          } finally {
            await client.close().catch(() => {})
          }
        } finally {
          await restarted.stop()
        }
      } finally {
        await watcher.close().catch(() => {})
        bridge.close()
      }

      // The journal recorded the durable settlement (the worker's own
      // word, appended by daemon #2 when the settle frame arrived) —
      // reading it BEFORE any further start, which would compact the now
      // empty pending set away.
      const journaled = await Bun.file(journalPath(h.dataDir)).text()
      expect(journaled).toContain('"event":"settled"')
      expect(journaled).toContain('"how":"answered"')

      // A third daemon start replays nothing: the pending set is empty,
      // history does not survive — the run is not in the registry, and the
      // start's compaction rewrote the journal down to (nothing).
      const third = await startDaemon({ dataDir: h.dataDir, port: 0 })
      try {
        const runs = (await (await fetch(`${third.url}/runs`, { headers: { authorization: `Bearer ${h.read}` } })).json()) as { runs: { id: string }[] }
        expect(runs.runs.filter((run) => run.id === RUN)).toEqual([])
        expect(await Bun.file(journalPath(h.dataDir)).text()).toBe("")
      } finally {
        await third.stop()
      }

      // The daemon wrote nothing inside the registered project: the whole
      // queue flow (bridge, clients, restart, replay, answer) left the
      // project tree untouched, and the journal resolves under the daemon's
      // own data directory — never inside a target's `.auto/`.
      expect(await snapshot(h.project)).toEqual(before)
      const journal = journalPath(h.dataDir)
      expect(journal.startsWith(h.dataDir)).toBe(true)
      expect(journal.startsWith(h.project)).toBe(false)
    })
  }, 90_000)

  test("the blocked degradation: an ask whose daemon never returns resolves undefined within the reconnect grace — never a hang", async () => {
    await withQueue(async (h) => {
      const bridge = bridgeOf(h.daemon)
      try {
        await untilBridgeConnected(h.daemon, h.answer)
        const ask = bridge.question(ASK)
        const started = Date.now()
        // The daemon goes away and never comes back: the ask is held across
        // the loss for the reconnect grace (5 s), then degrades — the run
        // reaches its own exit vocabulary (under humanQuestions the core
        // maps the undefined answer to blocked/exit 2, its own pinned
        // behavior) in a bounded window.
        await h.daemon.stop()
        await expect(ask).resolves.toBeUndefined()
        const elapsed = Date.now() - started
        expect(elapsed).toBeGreaterThanOrEqual(4_000)
        expect(elapsed).toBeLessThan(15_000)
      } finally {
        bridge.close()
      }
    })
  }, 60_000)
})
