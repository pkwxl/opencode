// The plan unlock end to end over a REAL planning run (T-095, P3c): the
// plan operation's agent-planning route spawns the session as a run —
// stopBefore === "execute" (humanQuestions armed the way the CLI arms them,
// auto-core src/opts.ts:346/:179-185), the planning input persisted by the
// planning step, the tasks landing in the phase's index through the core's
// own planning step, and the run's interactive transport live (the bridge
// connects, the session attach rides it) — the channel a plan question
// would take.
// AUTO-RESOLVE (the e2e's question): the fake `claude` agent cannot raise an
// agent question — the claude adapter's own capability table turns them off
// (`question: false`, auto-core src/agent/claude/client.ts:38; AskUserQuestion
// is disallowed by the contract) — and no core change may alter that. The
// hard-wait question flow a plan session would raise is therefore pinned at
// the same transport the planning session rides: the restart/degradation
// matrix of test/question-queue.test.ts drives a hard-wait ask
// (minutes === undefined, exactly askHuman's humanQuestions shape) through
// the same queue, journal and bridge, answered and degraded; the core's own
// mapping of the answered/degraded ask into the session (replyQuestion /
// the blocked settle, exit 2) is pinned core-side (auto-core
// test/turn-questions.test.ts). What THIS file pins is everything else the
// unlock promises: the spawn, the stop condition, the input, the landing,
// the vocabulary, the transport attached to the planning session.
import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { basename, join } from "node:path"
import { tmpdir } from "node:os"
import { renderAgentContract } from "@opencode-ai/auto-core/config-fix"
import { CONFIG_DEFAULTS, saveProjectConfig } from "@opencode-ai/auto-core/config"
import { ensureInitGitignore } from "@opencode-ai/auto-core/gitignore"
import { establishRound } from "@opencode-ai/auto-core/phases"
import { startDaemon, type DaemonHandle } from "../src/daemon"
import { DaemonStore } from "../src/store"
import { fakeAgent, gitOf, scrubbedEnv } from "./fixtures/project"
import { wsClient } from "./fixtures/ws"

process.env.XDG_CONFIG_HOME = scrubbedEnv().XDG_CONFIG_HOME

type Harness = {
  daemon: DaemonHandle
  control: string
  read: string
  answer: string
  call: (method: string, path: string, token?: string, body?: unknown) => Promise<{ status: number; body: Record<string, unknown> }>
}

async function withHarness(projectDir: string, fn: (h: Harness) => Promise<void>): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "auto-server-plan-e2e-data-"))
  const store = new DaemonStore(dataDir)
  store.register(projectDir)
  const control = store.issueToken("control", "controller").token
  const read = store.issueToken("read", "reader").token
  const answer = store.issueToken("answer", "answerer").token
  const daemon = await startDaemon({ dataDir, port: 0 })
  const call = async (method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> => {
    const response = await fetch(`${daemon.url}${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, body: (await response.json()) as Record<string, unknown> }
  }
  try {
    await fn({ daemon, control, read, answer, call })
  } finally {
    await daemon.stop()
    await rm(dataDir, { recursive: true, force: true })
  }
}

// A phased one-implement-phase project (the round established, the index
// empty, nothing done): the plan route — the fixture shape the planning
// session writes into. The agent is the fake `claude` (the config's frozen
// agent key, exactly how a real project would pin it).
async function phasedEmptyProject(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  const git = gitOf(dir)
  await git("init")
  await git("config", "user.email", "plan@auto-server.test")
  await git("config", "user.name", "plan e2e")
  await saveProjectConfig(dir, { ...CONFIG_DEFAULTS, phases: "implement", agent: "claude" })
  await mkdir(join(dir, ".opencode", "agent"), { recursive: true })
  await Bun.write(join(dir, ".opencode", "agent", "auto.md"), await renderAgentContract(false))
  await ensureInitGitignore(dir)
  await establishRound(dir, { phases: "implement" })
  await git("add", "-A")
  await git("commit", "-qm", "baseline")
  return dir
}

async function withFakeAgent<T>(fn: () => Promise<T>): Promise<T> {
  const agent = await fakeAgent()
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
    const run = (await (await fetch(`${h.daemon.url}/runs/${id}`, { headers: { authorization: `Bearer ${h.read}` } })).json()) as RunView
    if (!run.live) return run
    if (Date.now() > deadline) throw new Error(`run ${id} never reached a terminal state: ${JSON.stringify(run)}`)
    await Bun.sleep(200)
  }
}

describe("the plan unlock end to end over a real planning run", () => {
  test("POST plan spawns the planning session: input persisted, the task lands in the phase index, the transport live, exit 0", async () => {
    const dir = await phasedEmptyProject("auto-server-plan-e2e-")
    try {
      await withFakeAgent(async () => {
        await withHarness(dir, async (h) => {
          const name = basename(dir)
          const started = await h.call("POST", `/projects/${name}/plan`, h.control, { input: "plan the widget migration: one task, src only" })
          expect(started.status).toBe(202)
          const id = String(started.body.id)
          expect(id).toMatch(/^run-/)
          expect(String(started.body.interactive)).toBe(`/runs/${id}/interactive`)
          expect((started.body.lines as string[] | undefined)?.some((line) => line.includes("planning session started as run"))).toBe(true)

          // The planning run's interactive transport is live: the session
          // frame is the worker's own voice (it rides the bridge — the
          // channel a plan question takes; never prose parsed for state),
          // and a client connecting after it sees the bridge in its hello.
          const client = wsClient(`${h.daemon.url.replace("http", "ws")}/runs/${id}/interactive?token=${h.answer}`)
          try {
            await client.opened
            const session = await client.nextOf((frame) => frame.type === "session", "the planning session's attach over the bridge", 180_000)
            expect(session).toMatchObject({ type: "session", session: expect.any(String) })
            const second = wsClient(`${h.daemon.url.replace("http", "ws")}/runs/${id}/interactive?token=${h.answer}`)
            try {
              await second.opened
              const hello = await second.nextOf((frame) => frame.type === "hello", "the second client's hello", 30_000)
              expect(hello).toMatchObject({ type: "hello", run: id, worker: true })
            } finally {
              await second.close().catch(() => {})
            }
          } finally {
            await client.close().catch(() => {})
          }

          // The plan stop condition: the run ends once the planning step
          // succeeded — exit 0 through the vocabulary, the stopBefore banner
          // and the planned-lines summary in its tail.
          const done = await untilTerminal(h, id)
          expect(done.state, done.tail).toBe("completed")
          expect(done.code).toBe(0)
          expect(done.tail).toContain("⏸ planning run: the run stops once a planning step has succeeded")
          expect(done.tail).toContain("✓ planned R-01.P01 implement: 1 task(s) in docs/R-01/P01-implement/tasks.md")

          // The task landed through the core's planning step: the phase's
          // index lists it, its document exists, and the planning input was
          // persisted to the phase's plan-input.md.
          const index = await Bun.file(join(dir, "docs", "R-01", "P01-implement", "tasks.md")).text()
          expect(index).toMatch(/- \[ \] T-\d{3} task T-\d{3}/)
          const input = await Bun.file(join(dir, "docs", "R-01", "P01-implement", "plan-input.md")).text()
          expect(input).toContain("plan the widget migration")
        })
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 300_000)
})
