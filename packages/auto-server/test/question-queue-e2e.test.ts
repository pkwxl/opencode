// The persistent pending-question queue end to end over a REAL worker
// (T-095, P3c): the acceptance's restart headline — a run's own between-tasks
// pause (a minutes-defined ask the run itself raises through its injected
// transport), a daemon restart while the pause is open, and the answer a NEW
// client sends to the RESTARTED daemon — journal replay redelivers, the
// orphan worker's bridge reconnects within its grace, re-raises the ask, and
// the run continues to completion exactly as the answered pause means it to
// (the second task's done.md, the confirmed-continuation line in the log).
// The fast daemon-level matrix (no subprocess) is test/question-queue.test.ts;
// the plan-session half of the unlock is test/plan-e2e.test.ts.
import { describe, expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { basename, join } from "node:path"
import { tmpdir } from "node:os"
import { liveRunLock } from "@opencode-ai/auto-core/lock"
import { startDaemon, type DaemonHandle } from "../src/daemon"
import { DaemonStore } from "../src/store"
import { fakeAgent, fixtureProject, scrubbedEnv, TASK, TASK_2 } from "./fixtures/project"
import { wsClient, type TestSocket } from "./fixtures/ws"

process.env.XDG_CONFIG_HOME = scrubbedEnv().XDG_CONFIG_HOME

type Harness = {
  daemon: DaemonHandle
  dataDir: string
  answer: string
  control: string
  read: string
  request: (method: string, path: string, token?: string, body?: unknown) => Promise<Response>
}

// One daemon over one temp data directory, with a registered project and
// the answer/control/read tokens; the fake agent's PATH is installed by the
// caller (withFakeAgent below). The daemon's port is remembered so the
// restart rebinds it — the orphan worker's transport URL names it.
async function withHarness(projectDir: string, fn: (h: Harness) => Promise<void>): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "auto-server-queue-e2e-data-"))
  const store = new DaemonStore(dataDir)
  store.register(projectDir)
  const answer = store.issueToken("answer", "answerer").token
  const control = store.issueToken("control", "controller").token
  const read = store.issueToken("read", "reader").token
  const daemon = await startDaemon({ dataDir, port: 0 })
  const request = (method: string, path: string, token?: string, body?: unknown) =>
    fetch(`${daemon.url}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) })
  try {
    await fn({ daemon, dataDir, answer, control, read, request })
  } finally {
    await daemon.stop().catch(() => {})
    await rm(dataDir, { recursive: true, force: true })
  }
}

async function withFakeAgent<T>(extra: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const agent = await fakeAgent(extra)
  const before: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(agent.env)) {
    before[key] = process.env[key]
    process.env[key] = value
  }
  try {
    return await fn()
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await agent.done()
  }
}

// The documented answer contract across the bridge gap (the refusal names
// the retry): send, read only the frames that arrived after the send, retry
// until the settle lands.
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
      if (refused !== undefined && refused.type === "error") throw new Error(`the answer was refused: ${refused.message}`)
      if (Date.now() > waited) break
      await Bun.sleep(100)
    }
    if (Date.now() > deadline) throw new Error(`the answer for ${id} never settled`)
  }
}

// The newest run log's text (the run's own audit trail — the durable half
// of the vocabulary the restarted daemon cannot observe).
async function newestLog(dir: string): Promise<string> {
  const logs = join(dir, ".auto", "logs")
  let newest = ""
  let text = ""
  for (const name of await readdir(logs).catch(() => [] as string[])) {
    if (name > newest) {
      newest = name
      text = await Bun.file(join(logs, name)).text().catch(() => "")
    }
  }
  return text
}

describe("the persistent pending-question queue end to end over a real worker", () => {
  test("a daemon restart mid-pause: journal replay redelivers to a new client, the answer completes the run", async () => {
    const dir = await fixtureProject("auto-server-queue-e2e-", undefined, 2)
    try {
      await withFakeAgent({}, async () => {
        await withHarness(dir, async (h) => {
          // The two-task run with a 1-minute between-tasks pause: the
          // pause's 60-second window is the restart's budget.
          const started = await h.request("POST", "/runs", h.control, { project: basename(dir), switches: { OPENCODE_AUTO_AGENT: "claude" }, options: { waitBetween: 1 } })
          expect(started.status).toBe(202)
          const { id } = (await started.json()) as { id: string }
          const port = h.daemon.port
          const base = h.daemon.url.replace("http", "ws")

          // The first client sees the pause the run raised (its exact typed
          // call — the prompt text an opaque payload, minutes riding the
          // frame).
          const first = wsClient(`${base}/runs/${id}/interactive?token=${h.answer}`)
          try {
            await first.opened
            const question = await first.nextOf((frame) => frame.type === "question", "the between-tasks pause", 180_000)
            expect(question).toMatchObject({
              type: "question",
              text: `⏸ pause between tasks: press Enter to start ${TASK_2} now, or wait 1m to auto-continue: `,
              minutes: 1,
            })
          } finally {
            await first.close().catch(() => {})
          }

          // —— the daemon restarts mid-pause ——
          await h.daemon.stop()
          const restarted = await startDaemon({ dataDir: h.dataDir, port })
          try {
            // A NEW client on the restarted daemon: hello names the restored
            // run, journal replay redelivers the pause, and the answer
            // returns over the wire (in the bridge gap the refusal names
            // the retry; the orphan worker reconnects within its grace and
            // re-raises the ask).
            const client = wsClient(`${base}/runs/${id}/interactive?token=${h.answer}`)
            try {
              await client.opened
              const hello = await client.nextOf((frame) => frame.type === "hello", "the restarted daemon's hello", 30_000)
              expect(hello).toMatchObject({ type: "hello", run: id, state: "restored" })
              const replayed = await client.nextOf((frame) => frame.type === "question", "the journal replay", 30_000)
              expect(replayed).toMatchObject({ type: "question", text: `⏸ pause between tasks: press Enter to start ${TASK_2} now, or wait 1m to auto-continue: `, minutes: 1 })
              if (replayed.type !== "question") throw new Error("unreachable")
              await answerUntilSettled(client, replayed.id, "")
            } finally {
              await client.close().catch(() => {})
            }

            // The answer was the confirm: the run continued into the second
            // task and completed it. The restarted daemon supervises no
            // process (the run is `restored`), so completion is observed on
            // the target's own disk — the second task's done.md, the
            // confirmed-continuation line in the run's log, and the lock
            // released when the run ended.
            const deadline = Date.now() + 180_000
            while (!(await Bun.file(join(dir, "docs", TASK_2, "done.md")).exists())) {
              if (Date.now() > deadline) throw new Error("the resumed run never completed the second task")
              await Bun.sleep(200)
            }
            expect(await Bun.file(join(dir, "docs", TASK, "done.md")).exists()).toBe(true)
            while (liveRunLock(dir) !== undefined) {
              if (Date.now() > deadline) throw new Error("the resumed run never released the run lock")
              await Bun.sleep(200)
            }
            const log = await newestLog(dir)
            expect(log).toContain(`→ confirmed, continuing ${TASK_2}`)
          } finally {
            await restarted.stop()
          }
        })
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 300_000)
})
