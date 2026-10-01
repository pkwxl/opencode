// The interactive transport end to end (T-094, P3b of the headless
// direction, auto-core plans/0067 §四): a real daemon, a real worker child
// over the fake `claude` CLI, and a real WebSocket client — the acceptance
// cases of the unit:
//   - a question raised inside a run reaches a WS client as a typed frame
//     (the between-tasks pause of a two-task --wait-between run), an answer
//     returns over the wire, and the run proceeds to completion;
//   - /exit over the control channel produces the graceful exit 3 with
//     progress persisted, and a re-run resumes precisely to completion
//     (kill/130 stays available beside it — daemon.test.ts's kill case);
//   - /failback reaches the router (the receipt line, and the boundary's
//     own "applied" line in the run's log).
// Everything rides the typed versioned protocol (src/ws-protocol.ts); no
// assertion parses prompt prose for state — the question's text is checked
// as an exact opaque payload, the same string the run handed its channel.
import { describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { basename, join } from "node:path"
import { tmpdir } from "node:os"
import { mkdtemp } from "node:fs/promises"
import { startDaemon, type DaemonHandle } from "../src/daemon"
import { DaemonStore } from "../src/store"
import { fakeAgent, fixtureProject, scrubbedEnv, TASK, TASK_2 } from "./fixtures/project"
import { wsClient } from "./fixtures/ws"

process.env.XDG_CONFIG_HOME = scrubbedEnv().XDG_CONFIG_HOME

type Harness = {
  daemon: DaemonHandle
  answer: string
  control: string
  read: string
  request: (method: string, path: string, token?: string, body?: unknown) => Promise<Response>
}

// One daemon over one temp data directory, with a registered project and
// the answer/control/read tokens; the fake agent's PATH is installed by the
// caller (withFakeAgent below).
async function withHarness(projectDir: string, fn: (h: Harness) => Promise<void>): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "auto-server-e2e-data-"))
  const store = new DaemonStore(dataDir)
  store.register(projectDir)
  const answer = store.issueToken("answer", "answerer").token
  const control = store.issueToken("control", "controller").token
  const read = store.issueToken("read", "reader").token
  const daemon = await startDaemon({ dataDir, port: 0 })
  const request = (method: string, path: string, token?: string, body?: unknown) =>
    fetch(`${daemon.url}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) })
  try {
    await fn({ daemon, answer, control, read, request })
  } finally {
    await daemon.stop()
    await rm(dataDir, { recursive: true, force: true })
  }
}

// The fake `claude` on the daemon's PATH (it spawns the workers that spawn
// the agent), restored after — daemon.test.ts's withFakeAgent shape.
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

type RunView = { id: string; state: string; code: number | null; live: boolean; tail: string }

async function untilTerminal(h: Harness, id: string, timeoutMs = 180_000): Promise<RunView> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const run = (await (await h.request("GET", `/runs/${id}`, h.read)).json()) as RunView
    if (!run.live) return run
    if (Date.now() > deadline) throw new Error(`run ${id} never reached a terminal state: ${JSON.stringify(run)}`)
    await Bun.sleep(200)
  }
}

// Waits for the run to hold the lock and its engine to have started the
// first turn (the journal's first entry) — by then the worker's bridge is
// connected and its channel attached to a live session, so an answer or a
// control frame rides a run that can take it.
async function untilRunning(dir: string, h: Harness, id: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const run = (await (await h.request("GET", `/runs/${id}`, h.read)).json()) as RunView
    if (!run.live) throw new Error(`run ${id} ended before running was observed: ${JSON.stringify(run)}`)
    const journal = await Bun.file(join(dir, ".auto", "run-events.jsonl")).text().catch(() => "")
    if (run.state === "running" && journal.trim()) return
    if (Date.now() > deadline) throw new Error(`run ${id} was never observed running with a first turn`)
    await Bun.sleep(100)
  }
}

const wsBase = (h: Harness): string => h.daemon.url.replace("http", "ws")

describe("the interactive transport end to end over the fake claude CLI", () => {
  test("a question raised in the run reaches a WS client; the answer returns; the run proceeds to completion", async () => {
    const dir = await fixtureProject("auto-server-ask-e2e-", undefined, 2)
    try {
      await withFakeAgent({}, async () => {
        await withHarness(dir, async (h) => {
          // The two-task run with a 1-minute between-tasks pause: the
          // client connects before the pause arrives (the endpoint is the
          // daemon's own — it exists from the spawn).
          const started = await h.request("POST", "/runs", h.control, { project: basename(dir), switches: { OPENCODE_AUTO_AGENT: "claude" }, options: { waitBetween: 1 } })
          expect(started.status).toBe(202)
          const { id } = (await started.json()) as { id: string }
          const client = wsClient(`${wsBase(h)}/runs/${id}/interactive?token=${h.answer}`)
          try {
            const hello = await client.nextOf((frame) => frame.type === "hello", "the connect hello", 30_000)
            expect(hello).toMatchObject({ type: "hello", run: id })

            // The pause between the tasks, as the typed call the run made:
            // the exact prompt text and the run's minutes riding the frame
            // (never prose parsed back — the payload is compared as the
            // opaque string the run handed its channel).
            const question = await client.nextOf((frame) => frame.type === "question", "the between-tasks pause", 120_000)
            expect(question).toMatchObject({
              type: "question",
              text: `⏸ pause between tasks: press Enter to start ${TASK_2} now, or wait 1m to auto-continue: `,
              minutes: 1,
            })
            if (question.type !== "question") throw new Error("unreachable")
            client.send({ type: "answer", id: question.id, text: "" })
            await client.nextOf((frame) => frame.type === "settled" && frame.id === question.id, "the settled frame", 30_000)

            // The answer was the confirm: the run continued into the second
            // task and completed it — the exit code the daemon maps.
            const done = await untilTerminal(h, id)
            expect(done.state, done.tail).toBe("completed")
            expect(done.code).toBe(0)
            expect(done.tail).toContain(`→ confirmed, continuing ${TASK_2}`)
            expect(await Bun.file(join(dir, "docs", TASK, "done.md")).exists()).toBe(true)
            expect(await Bun.file(join(dir, "docs", TASK_2, "done.md")).exists()).toBe(true)
          } finally {
            await client.close().catch(() => {})
          }
        })
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 300_000)

  test("/exit over the control channel yields the graceful exit 3 with progress persisted; the re-run resumes precisely to completion", async () => {
    const dir = await fixtureProject("auto-server-exit-e2e-")
    try {
      // The lead's split must be taken (a large lead context keeps the task
      // out of the fork-everything path, fake-claude's FAKE_CLAUDE_LEAD_
      // CONTEXT knob), so the run owns subtask boundaries mid-task — the
      // safe landing points /exit takes effect at; the per-turn delay
      // stretches the window the control frame lands inside.
      await withFakeAgent({ FAKE_CLAUDE_DELAY_MS: "400", FAKE_CLAUDE_LEAD_CONTEXT: "160000" }, async () => {
        await withHarness(dir, async (h) => {
          const started = await h.request("POST", "/runs", h.control, { project: basename(dir), switches: { OPENCODE_AUTO_AGENT: "claude" } })
          const { id } = (await started.json()) as { id: string }
          await untilRunning(dir, h, id)
          const client = wsClient(`${wsBase(h)}/runs/${id}/interactive?token=${h.control}`)
          try {
            await client.nextOf((frame) => frame.type === "hello" && frame.worker, "the bridge is connected", 30_000)
            client.send({ type: "control", action: "exit" })
            const outcome = await client.nextOf((frame) => frame.type === "control-done", "the control outcome", 30_000)
            expect(outcome).toMatchObject({ type: "control-done", action: "exit", applied: true })

            // The graceful pause: exit 3, the run's own /exit line in the
            // log, and the progress record persisted for the precise resume
            // (the task is mid-flight: in_progress, not done).
            const paused = await untilTerminal(h, id)
            expect(paused.state, paused.tail).toBe("paused")
            expect(paused.code).toBe(3)
            expect(paused.tail).toContain("/exit received over the transport")
            expect(paused.tail).toContain("progress saved, re-run to resume fully")
            expect(await Bun.file(join(dir, ".auto", "progress.json")).exists()).toBe(true)
            const units = JSON.parse(await Bun.file(join(dir, ".auto", "units.json")).text()) as { tasks: Record<string, { status?: string }> }
            expect(units.tasks[TASK]?.status).toBe("in_progress")
            expect(await Bun.file(join(dir, "docs", TASK, "done.md")).exists()).toBe(false)
          } finally {
            await client.close().catch(() => {})
          }

          // The precise resume: no manual operation, a plain re-run of the
          // same project continues from the persisted progress and
          // completes (the vocabulary's own promise for exit 3).
          const rerun = await h.request("POST", "/runs", h.control, { project: basename(dir), switches: { OPENCODE_AUTO_AGENT: "claude" } })
          expect(rerun.status).toBe(202)
          const resumed = await untilTerminal(h, ((await rerun.json()) as { id: string }).id)
          expect(resumed.state, resumed.tail).toBe("completed")
          expect(resumed.code).toBe(0)
          expect(await Bun.file(join(dir, "docs", TASK, "done.md")).exists()).toBe(true)
        })
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 300_000)

  test("/failback reaches the router: the receipt line, the boundary's applied line, and the run continues to completion", async () => {
    const dir = await fixtureProject("auto-server-failback-e2e-")
    try {
      await withFakeAgent({}, async () => {
        await withHarness(dir, async (h) => {
          const started = await h.request("POST", "/runs", h.control, { project: basename(dir), switches: { OPENCODE_AUTO_AGENT: "claude" } })
          const { id } = (await started.json()) as { id: string }
          await untilRunning(dir, h, id)
          const client = wsClient(`${wsBase(h)}/runs/${id}/interactive?token=${h.control}`)
          try {
            await client.nextOf((frame) => frame.type === "hello" && frame.worker, "the bridge is connected", 30_000)
            // The plain failback (no model order): the pending order the
            // safe boundaries consume — the router's own "applied" line is
            // the boundary's voice in the run's log.
            client.send({ type: "control", action: "failback" })
            const outcome = await client.nextOf((frame) => frame.type === "control-done", "the control outcome", 30_000)
            expect(outcome).toMatchObject({ type: "control-done", action: "failback", applied: true })
            const done = await untilTerminal(h, id)
            expect(done.state, done.tail).toBe("completed")
            expect(done.code).toBe(0)
            expect(done.tail).toContain("⇄ /failback received over the transport")
            expect(done.tail).toContain("⇄ /failback applied: fallback state reset")
            expect(await Bun.file(join(dir, "docs", TASK, "done.md")).exists()).toBe(true)
          } finally {
            await client.close().catch(() => {})
          }
        })
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 300_000)
})
