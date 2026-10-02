// The effort's cross-stack close-out e2e (T-098): one unbroken pass driving
// one sample project entirely through the service's API surface — REST, SSE
// facts where relevant, and the WebSocket interactive transport — never the
// CLI shell (packages/auto stays the untouched reference; the only git the
// test runs is the person's own review-and-commit of what the API wrote, the
// same act the round-start and init gates ask a person for). The flow, in
// order: register (the whitelist) → a run on the unconfigured directory
// (failed/1, the vocabulary's environment error) → the init operation →
// plan without input (the round-start gate) → plan with input (the planning
// session spawned as a run, completed/0) → task-add → close a unit → the
// blocked/2 scene (a stray file trips the execution unit's clean gate) →
// run → kill (killed/130) → run → the graceful /exit pause (paused/3, the
// control channel) → run (the precise resume) → the between-tasks question
// answered from the pending queue over WS → completed/0 → the status tree.
// The whole exit-code vocabulary (0/1/2/3/130) is observed from the API's
// own run resources, and the closing read asserts the tree the core renders.
//
// AUTO-RESOLVE (the plan step's question): the fake `claude` cannot raise an
// agent question — the claude adapter's capability table turns them off
// (`question: false`, auto-core src/agent/claude/client.ts:38; AskUserQuestion
// is disallowed by the contract) — and no core change may alter that, the
// limitation T-095's plan e2e and T-097's served write suite documented the
// same way. What this flow pins instead: the planning run IS spawned with its
// interactive channel attached (the session frame observed over the bridge —
// the channel a plan question takes), and the question/answer over WS rides
// the run's own between-tasks pause on the same transport, answered by a
// client that connected AFTER the ask was raised (the pending queue's
// redelivery path). A real planning question rides exactly that transport
// and queue, so the composed chain is covered end to end modulo the asker.
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { basename, join } from "node:path"
import { tmpdir } from "node:os"
import { CONFIG_FILE } from "@opencode-ai/auto-core/config"
import { startDaemon, type DaemonHandle } from "../src/daemon"
import { journalPath } from "../src/question-journal"
import { DaemonStore } from "../src/store"
import { fakeAgent, gitOf, scrubbedEnv } from "./fixtures/project"
import { wsClient } from "./fixtures/ws"

process.env.XDG_CONFIG_HOME = scrubbedEnv().XDG_CONFIG_HOME

type RunView = { id: string; state: string; code: number | null; signal: string | null; tail: string; live: boolean }

type Harness = {
  daemon: DaemonHandle
  dataDir: string
  name: string
  directory: string
  read: string
  control: string
  answer: string
  config: string
  request: (method: string, path: string, token?: string, body?: unknown) => Promise<Response>
}

// The sample project a person would point the daemon at: a git repository
// with a usable identity and nothing else — no config, no round, no tasks.
// Everything the flow writes, it writes through the API (and the driver the
// API spawns), never through the CLI shell.
async function sampleProject(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  const git = gitOf(dir)
  await git("init")
  await git("config", "user.email", "e2e@auto-server.test")
  await git("config", "user.name", "service e2e")
  return dir
}

// One daemon over one temp data directory: the sample project registered on
// its whitelist, the four scope tokens issued, everything driven over HTTP
// and WS from there.
async function withHarness(projectDir: string, fn: (h: Harness) => Promise<void>): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "auto-server-service-e2e-data-"))
  const store = new DaemonStore(dataDir)
  const registered = store.register(projectDir)
  const read = store.issueToken("read", "reader").token
  const control = store.issueToken("control", "controller").token
  const answer = store.issueToken("answer", "answerer").token
  const config = store.issueToken("config", "configurer").token
  const daemon = await startDaemon({ dataDir, port: 0 })
  const request = (method: string, path: string, token?: string, body?: unknown) =>
    fetch(`${daemon.url}${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  try {
    await fn({ daemon, dataDir, name: registered.name, directory: registered.directory, read, control, answer, config, request })
  } finally {
    await daemon.stop()
    await rm(dataDir, { recursive: true, force: true })
  }
}

// The fake `claude` on the daemon's PATH, with the two knobs the mid-run
// control scenes need: the per-turn delay stretches the run so a kill or an
// /exit lands while it is live, and the large lead context keeps the task in
// the split path, whose subtask boundaries are the safe landing points the
// graceful pause takes effect at (the interactive e2e's knob set).
async function withFakeAgent<T>(fn: () => Promise<T>): Promise<T> {
  const agent = await fakeAgent({ FAKE_CLAUDE_DELAY_MS: "400", FAKE_CLAUDE_LEAD_CONTEXT: "160000" })
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

// The lifecycle a client observes through GET /runs/<id>.
async function untilTerminal(h: Harness, id: string, timeoutMs = 180_000): Promise<RunView> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const run = (await (await h.request("GET", `/runs/${id}`, h.read)).json()) as RunView
    if (!run.live) return run
    if (Date.now() > deadline) throw new Error(`run ${id} never reached a terminal state: ${JSON.stringify(run)}`)
    await Bun.sleep(200)
  }
}

// Waits until the run attaches its interactive channel to a session — the
// transport's own run-liveness marker (a session exists ⇒ the run's services
// holder is installed, and the SIGINT handler ahead of it), so a control
// frame or a kill from here on reaches a run that can take it. Returns the
// open client (the caller closes it).
async function untilSessionAttached(h: Harness, id: string, timeoutMs = 120_000): Promise<ReturnType<typeof wsClient>> {
  const client = wsClient(`${h.daemon.url.replace("http", "ws")}/runs/${id}/interactive?token=${h.answer}`)
  try {
    await client.nextOf((frame) => frame.type === "session", `run ${id}'s first session attach`, timeoutMs)
  } catch (error) {
    await client.close().catch(() => {})
    throw error
  }
  return client
}

// Waits until the daemon's question journal holds a `raised` record for the
// run — the moment the ask is IN the pending queue, before any client has
// seen it (the next client's delivery is then the queue's redelivery).
async function untilQuestionQueued(h: Harness, id: string, timeoutMs = 180_000): Promise<void> {
  const path = journalPath(h.dataDir)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const text = await Bun.file(path).text().catch(() => "")
    if (text.includes(`"run":"${id}"`) && text.includes('"event":"raised"')) return
    if (Date.now() > deadline) throw new Error(`run ${id} never raised a question into the pending queue`)
    await Bun.sleep(100)
  }
}

describe("the service end to end: one project, one daemon, the whole vocabulary", () => {
  test("register → failed/1 → init → plan (round gate, planning run) → task-add → close → blocked/2 → killed/130 → paused/3 → resume → question answered from the queue → completed/0 → the status tree", async () => {
    const dir = await sampleProject("auto-server-service-e2e-")
    const git = gitOf(dir)
    try {
      await withFakeAgent(async () => {
        await withHarness(dir, async (h) => {
          // —— the whitelist ——
          const listed = (await (await h.request("GET", "/projects", h.read)).json()) as { projects: { name: string; directory: string }[] }
          expect(listed.projects.map((project) => `${project.name} ${project.directory}`)).toEqual([`${h.name} ${h.directory}`])

          // —— the vocabulary's environment error: a run on the unconfigured
          // directory fails (preflight's agent-contract check), observed from
          // the API as failed/1 with the reason in the tail.
          const premature = await h.request("POST", "/runs", h.control, { project: h.name })
          expect(premature.status).toBe(202)
          const failedRun = await untilTerminal(h, ((await premature.json()) as RunView).id)
          expect(failedRun.state, failedRun.tail).toBe("failed")
          expect(failedRun.code).toBe(1)
          expect(failedRun.tail).toContain("agent contract file missing")

          // —— the init operation (the config scope): the constitutional
          // config frozen over the API — a phased project on the claude
          // agent, exactly the knobs the flow needs.
          const initialized = await h.request("POST", `/projects/${h.name}/init`, h.config, { config: { phases: "implement", agent: "claude" } })
          expect(initialized.status).toBe(200)
          const initBody = (await initialized.json()) as { code: number; lines: string[]; config: string }
          expect(initBody.code).toBe(0)
          expect(initBody.config).toContain("phases implement")
          expect(initBody.config).toContain("agent claude")
          expect(await Bun.file(join(dir, CONFIG_FILE)).exists()).toBe(true)
          expect(await Bun.file(join(dir, ".opencode", "agent", "auto.md")).exists()).toBe(true)
          expect(await Bun.file(join(dir, ".opencode", "auto", "brief.md")).exists()).toBe(true)
          // The person's review-and-commit of what init wrote (the same act
          // the CLI flow asks for; the API wrote, the person commits).
          await git("add", "-A")
          await git("commit", "-qm", "init over the API")

          // —— plan without input: the no-agent route that establishes the
          // round, stopping at the round-start gate for the review.
          const established = await h.request("POST", `/projects/${h.name}/plan`, h.control, {})
          expect(established.status).toBe(200)
          const establishedBody = (await established.json()) as { code: number; lines: string[] }
          expect(establishedBody.code).toBe(0)
          expect(establishedBody.lines.join("\n")).toContain("✓ round R-01 established: P01-implement")
          expect(establishedBody.lines.join("\n")).toContain("next (round-start gate): review the round setup")
          expect(await Bun.file(join(dir, "docs", "R-01", "phases.md")).exists()).toBe(true)
          expect(await Bun.file(join(dir, "docs", "R-01", "P01-implement", "todo.md")).exists()).toBe(true)
          await git("add", "-A")
          await git("commit", "-qm", "round R-01 established over the API")

          // —— plan with input: the agent-planning route spawns the planning
          // session as a run; its interactive channel is live (the session
          // frame over the bridge — the channel a plan question takes), and
          // the run ends 0 with the task landed by the core's planning step.
          const planned = await h.request("POST", `/projects/${h.name}/plan`, h.control, { input: "plan the widget migration: one task, src only" })
          expect(planned.status).toBe(202)
          const planningRun = (await planned.json()) as RunView & { interactive: string }
          const planningId = planningRun.id
          expect(planningRun.interactive).toBe(`/runs/${planningId}/interactive`)
          const watcher = wsClient(`${h.daemon.url.replace("http", "ws")}/runs/${planningId}/interactive?token=${h.answer}`)
          try {
            const session = await watcher.nextOf((frame) => frame.type === "session", "the planning session's attach over the bridge", 180_000)
            expect(session).toMatchObject({ type: "session", session: expect.any(String) })
          } finally {
            await watcher.close().catch(() => {})
          }
          const planned0 = await untilTerminal(h, planningId)
          expect(planned0.state, planned0.tail).toBe("completed")
          expect(planned0.code).toBe(0)
          expect(planned0.tail).toContain("✓ planned R-01.P01 implement: 1 task(s) in docs/R-01/P01-implement/tasks.md")
          const index = await Bun.file(join(dir, "docs", "R-01", "P01-implement", "tasks.md")).text()
          expect(index).toMatch(/- \[ \] T-001 task T-001/)
          expect(await Bun.file(join(dir, "docs", "R-01", "P01-implement", "plan-input.md")).text()).toContain("plan the widget migration")

          // —— task-add (the control scope): two more tasks, one to run, one
          // to close — the units operations over the API.
          for (const title of ["the second widget", "the third widget"]) {
            const added = await h.request("POST", `/projects/${h.name}/tasks`, h.control, { title })
            expect(added.status).toBe(200)
            expect(((await added.json()) as { code: number; lines: string[] }).lines.join("\n")).toContain("✓ task T-00")
          }

          // —— close a unit: the explicit ref and the one-line reason are the
          // confirmation; the Closed: field, the rename and the close commit
          // are the core's own (never a daemon-side write).
          const closed = await h.request("POST", `/projects/${h.name}/close`, h.control, { ref: "T-003", reason: "delivered out of band" })
          expect(closed.status).toBe(200)
          const closedBody = (await closed.json()) as { code: number; lines: string[] }
          expect(closedBody.code).toBe(0)
          const third = await Bun.file(join(dir, "docs", "T-003", "done.md")).text()
          expect(third).toContain("Closed: delivered out of band")
          expect(await git("log", "--format=%s", "-3")).toContain("T-003 closed: delivered out of band")

          // —— the vocabulary's blocked: a stray file trips the execution
          // unit's startup clean gate — exit 2, nothing written by the
          // refused run, the human's to handle.
          await Bun.write(join(dir, "stray.txt"), "leftover from an abandoned run\n")
          const blocked = await h.request("POST", "/runs", h.control, { project: h.name, options: { waitBetween: 1 } })
          expect(blocked.status).toBe(202)
          const blockedRun = await untilTerminal(h, ((await blocked.json()) as RunView).id)
          expect(blockedRun.state, blockedRun.tail).toBe("blocked")
          expect(blockedRun.code).toBe(2)
          expect(blockedRun.tail).toContain("the worktree has uncommitted changes")
          expect(blockedRun.tail).toContain("stray.txt")
          await rm(join(dir, "stray.txt"))

          // —— the vocabulary's killed: the double-SIGINT force-terminate
          // over DELETE, past the first session attach so the run's own
          // handler produces the 130 exit (the session frame is the
          // transport's run-liveness marker — the handler sits ahead of it).
          const killed = await h.request("POST", "/runs", h.control, { project: h.name, options: { waitBetween: 1 } })
          const killedId = ((await killed.json()) as RunView).id
          const killWatcher = await untilSessionAttached(h, killedId)
          await killWatcher.close().catch(() => {})
          expect((await h.request("DELETE", `/runs/${killedId}`, h.control)).status).toBe(202)
          const killedRun = await untilTerminal(h, killedId)
          expect(killedRun.state, killedRun.tail).toBe("killed")
          expect(killedRun.code, `signal=${killedRun.signal} tail=${killedRun.tail.slice(-400)}`).toBe(130)

          // —— the vocabulary's paused: the graceful /exit over the control
          // channel — progress persisted, the task mid-flight, exit 3.
          const paused = await h.request("POST", "/runs", h.control, { project: h.name, options: { waitBetween: 1 } })
          const pausedId = ((await paused.json()) as RunView).id
          const liveness = await untilSessionAttached(h, pausedId)
          await liveness.close().catch(() => {})
          const controller = wsClient(`${h.daemon.url.replace("http", "ws")}/runs/${pausedId}/interactive?token=${h.control}`)
          try {
            await controller.nextOf((frame) => frame.type === "hello" && frame.worker, "the bridge is connected", 30_000)
            controller.send({ type: "control", action: "exit" })
            const outcome = await controller.nextOf((frame) => frame.type === "control-done", "the control outcome", 30_000)
            expect(outcome).toMatchObject({ type: "control-done", action: "exit", applied: true })
          } finally {
            await controller.close().catch(() => {})
          }
          const pausedRun = await untilTerminal(h, pausedId)
          expect(pausedRun.state, pausedRun.tail).toBe("paused")
          expect(pausedRun.code).toBe(3)
          expect(pausedRun.tail).toContain("/exit received over the transport")
          expect(pausedRun.tail).toContain("progress saved, re-run to resume fully")
          expect(await Bun.file(join(dir, ".auto", "progress.json")).exists()).toBe(true)

          // —— the precise resume: a plain re-run continues from the
          // persisted progress; its between-tasks pause is answered from the
          // PENDING QUEUE by a client that connects after the ask was
          // journaled (the queue's redelivery), and the run completes.
          const resumed = await h.request("POST", "/runs", h.control, { project: h.name, options: { waitBetween: 1 } })
          expect(resumed.status).toBe(202)
          const resumedId = ((await resumed.json()) as RunView).id
          await untilQuestionQueued(h, resumedId)
          const answerer = wsClient(`${h.daemon.url.replace("http", "ws")}/runs/${resumedId}/interactive?token=${h.answer}`)
          try {
            const replayed = await answerer.nextOf((frame) => frame.type === "question", "the pending question redelivered to the connecting client", 30_000)
            expect(replayed).toMatchObject({
              type: "question",
              text: "⏸ pause between tasks: press Enter to start T-002 now, or wait 1m to auto-continue: ",
              minutes: 1,
            })
            if (replayed.type !== "question") throw new Error("unreachable")
            answerer.send({ type: "answer", id: replayed.id, text: "" })
            await answerer.nextOf((frame) => frame.type === "settled" && frame.id === replayed.id, "the settled frame", 30_000)
          } finally {
            await answerer.close().catch(() => {})
          }
          const done = await untilTerminal(h, resumedId, 240_000)
          expect(done.state, done.tail).toBe("completed")
          expect(done.code).toBe(0)
          expect(done.tail).toContain("→ confirmed, continuing T-002")
          expect(await Bun.file(join(dir, "docs", "T-001", "done.md")).exists()).toBe(true)
          expect(await Bun.file(join(dir, "docs", "T-002", "done.md")).exists()).toBe(true)

          // —— the whole vocabulary, observed from the API: every code of
          // 0/1/2/3/130 sits in the daemon's run list as its mapped state.
          const all = (await (await h.request("GET", "/runs", h.read)).json()) as { runs: RunView[] }
          const pairs = new Set(all.runs.filter((run) => !run.live).map((run) => `${run.state}/${run.code}`))
          for (const pair of ["completed/0", "failed/1", "blocked/2", "paused/3", "killed/130"]) {
            expect(pairs.has(pair), `the run list must show ${pair} (has: ${[...pairs].join(", ")})`).toBe(true)
          }

          // —— the status tree (the read scope): the core's own renderer over
          // the API, the closed unit marked, the verdicts from the commits.
          const status = (await (await h.request("GET", `/projects/${h.name}/status`, h.read)).json()) as {
            status: string[]
            verdicts: { tasks: { id: string; done: boolean; closed: string | null }[]; worktree: string }
            git: { clean: boolean }
            lock: unknown
          }
          const tree = status.status.join("\n")
          expect(tree).toContain("R-01 (1/1 phases done)")
          expect(tree).toContain("[✓] P01-implement")
          expect(tree).toContain("[✓] T-001 task T-001")
          expect(tree).toContain("[✓] T-002 the second widget")
          expect(tree).toContain("[⊘] T-003 the third widget")
          const thirdVerdict = status.verdicts.tasks.find((task) => task.id === "T-003")
          expect(thirdVerdict).toMatchObject({ done: true, closed: "delivered out of band" })
          expect(status.git.clean).toBe(true)
          expect(status.verdicts.worktree).toBe("clean")
          expect(status.lock).toBeNull()
        })
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 600_000)
})
