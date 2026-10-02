// The served Web client against a fixture daemon and a real run (T-096, P4a):
// the daemon serves the page and its script, and every surface the page
// renders is exercised through the CLIENT'S OWN modules — web/api.ts (the
// token-carrying fetch surface), web/sse.ts (the fetch-based SSE reader) and
// web/interactive.ts (the WebSocket session) are imported here and driven
// against `startDaemon` exactly as the browser drives them (the DOM wiring
// of web/main.ts is the one layer this suite cannot host; the browser-level
// verification covers it, and the pure vocabularies are pinned by
// test/web-client.test.ts). The acceptance cases:
//   - the shell is served (unauthenticated, no data in it), the whitelist
//     and the scopes come from the API, and the scope matrix holds;
//   - the status tree, the commit verdicts and the git verdicts render from
//     the read model over a REAL run (fake `claude`): before it, nothing is
//     done; after it completes, done is the commit verdict (done.md inside
//     the closing commit), never the run's own say-so;
//   - the three SSE channels deliver through the client's reader (the log's
//     prose verbatim, the engine journal's typed lines, the P2b driver
//     events with cursor ids);
//   - a pending question arrives over the client's interactive session, an
//     answer returns, and the run completes;
//   - pause (the graceful /exit) yields the paused-resumable state (exit 3)
//     and resume (a re-run with the paused run's request) completes;
//   - start refuses config keys: the daemon's 400 with the frozen refusal.
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { basename, join } from "node:path"
import { tmpdir } from "node:os"
import { startDaemon, type DaemonHandle } from "../src/daemon"
import { DaemonStore } from "../src/store"
import { fakeAgent, fixtureProject, scrubbedEnv, TASK, TASK_2 } from "./fixtures/project"
import type { WsFrame } from "../src/ws-protocol"
import { AutoApi, ApiError } from "../web/api"
import { SseTail, type SseFrame } from "../web/sse"
import { InteractiveSession } from "../web/interactive"

process.env.XDG_CONFIG_HOME = scrubbedEnv().XDG_CONFIG_HOME

type Harness = {
  daemon: DaemonHandle
  read: string
  control: string
  answer: string
  request: (method: string, path: string, token?: string, body?: unknown) => Promise<Response>
}

async function withHarness(projectDir: string, fn: (h: Harness) => Promise<void>): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "auto-server-web-data-"))
  const store = new DaemonStore(dataDir)
  store.register(projectDir)
  const read = store.issueToken("read", "reader").token
  const control = store.issueToken("control", "controller").token
  const answer = store.issueToken("answer", "answerer").token
  const daemon = await startDaemon({ dataDir, port: 0 })
  const request = (method: string, path: string, token?: string, body?: unknown) =>
    fetch(`${daemon.url}${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  try {
    await fn({ daemon, read, control, answer, request })
  } finally {
    await daemon.stop()
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

type RunView = { id: string; state: string; code: number | null; live: boolean; tail: string; project: string; request?: { options: Record<string, unknown>; switches: Record<string, string> } }

async function untilTerminal(api: AutoApi, id: string, timeoutMs = 180_000): Promise<RunView> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const run = await api.run(id)
    if (!run.live) return run as RunView
    if (Date.now() > deadline) throw new Error(`run ${id} never reached a terminal state: ${JSON.stringify(run)}`)
    await Bun.sleep(200)
  }
}

async function untilRunning(dir: string, api: AutoApi, id: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const run = await api.run(id)
    if (!run.live) throw new Error(`run ${id} ended before running was observed: ${JSON.stringify(run)}`)
    const journal = await Bun.file(join(dir, ".auto", "run-events.jsonl")).text().catch(() => "")
    if (run.state === "running" && journal.trim()) return
    if (Date.now() > deadline) throw new Error(`run ${id} was never observed running with a first turn`)
    await Bun.sleep(100)
  }
}

// A session whose received frames are observable after the fact (the class
// takes its callbacks at construction; the waits below poll the recorder).
type Recorded = {
  session: InteractiveSession
  hello: () => (WsFrame & { type: "hello" }) | undefined
  controlDone: () => { action: string; applied: boolean; reason?: string } | undefined
  settled: () => { id: string; how: string }[]
  errors: () => string[]
}

function recorded(url: string): Recorded {
  let helloFrame: (WsFrame & { type: "hello" }) | undefined
  let done: { action: string; applied: boolean; reason?: string } | undefined
  const settledList: { id: string; how: string }[] = []
  const errorList: string[] = []
  const session = new InteractiveSession(url, {
    onHello: (frame) => {
      helloFrame = frame
    },
    onControlDone: (action, applied, reason) => {
      done = { action, applied, reason }
    },
    onSettled: (id, how) => {
      settledList.push({ id, how })
    },
    onError: (message) => {
      errorList.push(message)
    },
  })
  return {
    session,
    hello: () => helloFrame,
    controlDone: () => done,
    settled: () => settledList,
    errors: () => errorList,
  }
}

async function waitFor(what: string, predicate: () => boolean, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`${what} never happened`)
    await Bun.sleep(100)
  }
}

// Collects frames from one opened tail until `enough` says stop (then the
// tail is stopped — its abort tears the fetch down, the page's own switch
// path).
async function collectFrames(open: (signal: AbortSignal) => Promise<Response>, enough: (frames: SseFrame[]) => boolean, timeoutMs = 30_000): Promise<SseFrame[]> {
  const frames: SseFrame[] = []
  const tail = new SseTail(open, { onFrame: (frame) => frames.push(frame) })
  tail.start()
  const deadline = Date.now() + timeoutMs
  while (!enough(frames)) {
    if (Date.now() > deadline) {
      tail.stop()
      throw new Error(`the stream never delivered enough (frames so far: ${frames.map((frame) => frame.event).join(", ") || "none"})`)
    }
    await Bun.sleep(100)
  }
  tail.stop()
  return frames
}

describe("the served web client (the shell, the scopes, the whitelist)", () => {
  test("the page and script are served without a token; the whitelist and the scopes come from the API; the scope matrix holds", async () => {
    const dir = await fixtureProject("auto-server-web-shell-")
    try {
      await withHarness(dir, async (h) => {
        // The shell carries no data — it is the login form itself; every
        // route it calls after the token is token-guarded.
        const page = await h.request("GET", "/")
        expect(page.status).toBe(200)
        expect(page.headers.get("content-type")).toContain("text/html")
        expect(await page.text()).toContain('<script src="/app.js"></script>')
        const script = await h.request("GET", "/app.js")
        expect(script.status).toBe(200)
        expect(script.headers.get("content-type")).toContain("text/javascript")

        // The client's scope source: typed, per token.
        const readApi = new AutoApi(h.daemon.url, h.read)
        expect((await readApi.session()).scopes).toEqual(["read"])
        const controlApi = new AutoApi(h.daemon.url, h.control)
        expect((await controlApi.session()).scopes).toEqual(["control"])
        const unknown = new AutoApi(h.daemon.url, "oas_nobody")
        await expect(unknown.session()).rejects.toMatchObject({ status: 401 } as Partial<ApiError>)

        // The whitelist (the project list) under the read scope.
        const projects = await readApi.projects()
        expect(projects.map((project) => project.name)).toEqual([basename(dir)])
        expect(projects[0]!.directory).toBe(realpathSync(dir))
        await expect(controlApi.projects()).rejects.toMatchObject({ status: 403 } as Partial<ApiError>)
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("the served web client (the read surface over a real run)", () => {
  test("the status tree, commit verdicts, git and the three SSE channels render from the API; a question over the client's session completes the run", async () => {
    const dir = await fixtureProject("auto-server-web-read-", undefined, 2)
    try {
      await withFakeAgent({}, async () => {
        await withHarness(dir, async (h) => {
          const api = new AutoApi(h.daemon.url, h.read)
          const controlApi = new AutoApi(h.daemon.url, h.control)
          const answerApi = new AutoApi(h.daemon.url, h.answer)
          const project = basename(dir)

          // Before any run: the tree renders (the core's own lines, served
          // verbatim), nothing is done, the worktree is clean.
          const before = await api.status(project)
          expect(before.status.join("\n")).toContain("R-01 (0/1 phases done)")
          expect(before.verdicts.tasks.map((task) => [task.id, task.done])).toEqual([
            [TASK, false],
            [TASK_2, false],
          ])
          expect(before.git.clean).toBe(true)

          // A real two-task run: the between-tasks pause arrives over the
          // client's own interactive session (the pending-question view the
          // page renders), the answer returns, the run completes.
          const started = await controlApi.startRun(project, { waitBetween: 1 }, { OPENCODE_AUTO_AGENT: "claude" })
          expect(started.live).toBe(true)
          const rec = recorded(answerApi.interactiveUrl(started.id))
          rec.session.connect()
          try {
            await waitFor("the between-tasks pause to arrive", () => rec.session.pending.length > 0, 120_000)
            // The question text is an opaque payload: compared as the exact
            // string the run handed its channel, never prose parsed back.
            expect(rec.session.pending[0]!.text).toBe(`⏸ pause between tasks: press Enter to start ${TASK_2} now, or wait 1m to auto-continue: `)
            expect(rec.session.pending[0]!.minutes).toBe(1)
            const questionId = rec.session.pending[0]!.id
            rec.session.answer(questionId, "")
            await waitFor("the answered settle", () => rec.settled().some((entry) => entry.id === questionId && entry.how === "answered"))
            await waitFor("the question to leave the pending view", () => !rec.session.pending.some((question) => question.id === questionId))
          } finally {
            await rec.session.close()
          }
          const done = await untilTerminal(api, started.id)
          expect(done.state, done.tail).toBe("completed")

          // The read model after: done is the commit verdict (done.md inside
          // the closing commit), the tree's own marks for the tasks, git
          // clean. The PHASE stays current (its close is the handover flow's
          // own step, not a task run's) — the tree says so honestly.
          const after = await api.status(project)
          expect(after.verdicts.tasks.every((task) => task.done)).toBe(true)
          expect(await Bun.file(join(dir, "docs", TASK, "done.md")).exists()).toBe(true)
          expect(await Bun.file(join(dir, "docs", TASK_2, "done.md")).exists()).toBe(true)
          expect(after.status.join("\n")).toContain(`[✓] ${TASK} the widget`)
          expect(after.status.join("\n")).toContain(`[✓] ${TASK_2} the second widget`)
          expect(after.git.clean).toBe(true)
          expect(after.logFile).toMatch(/^run-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.log$/)

          // The SSE channels, through the client's own reader. The log: the
          // attaching frame first, then the discovered-file frame (the newest
          // run log, by listing), then whole lines arrive — prose, delivered
          // verbatim (the test never looks inside them: delivery is the
          // contract, parsing is the sin).
          const logFrames = await collectFrames((signal) => api.openLog(project, signal), (frames) => frames.filter((frame) => frame.event === "line").length >= 5)
          const logTails = logFrames.filter((frame) => frame.event === "tail").map((frame) => frame.data)
          expect(logTails[0]).toContain('"reason":"attaching"')
          expect(logTails.some((data) => data.includes('"reason":"start"'))).toBe(true)
          expect(logTails.join("\n")).toMatch(/run-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.log/)
          expect(logFrames.filter((frame) => frame.event === "line").length).toBeGreaterThan(0)

          // The engine journal: typed lines, verbatim JSON.
          const engineFrames = await collectFrames((signal) => api.openEvents(project, signal), (frames) => frames.filter((frame) => frame.event === "run-event").length >= 3)
          for (const frame of engineFrames.filter((entry) => entry.event === "run-event")) {
            expect(typeof (JSON.parse(frame.data) as { type: string }).type).toBe("string")
          }

          // The typed driver events (P2b): ids present and non-decreasing,
          // payloads of the frozen vocabulary — the run bracket among them
          // (a typed correlation, never prose).
          const statusFrames = await collectFrames((signal) => api.openStatusEvents(project, 0, signal), (frames) => frames.filter((frame) => frame.event === "status-event").length >= 3)
          const eventFrames = statusFrames.filter((frame) => frame.event === "status-event")
          const ids = eventFrames.map((frame) => frame.id)
          expect(ids).toEqual([...ids].sort((a, b) => (a ?? 0) - (b ?? 0)))
          expect(eventFrames.every((frame) => frame.id !== undefined)).toBe(true)
          expect(eventFrames.map((frame) => (JSON.parse(frame.data) as { type: string }).type)).toContain("run-start")
        })
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 300_000)

  test("start refuses config keys with the frozen refusal (the daemon side of the UI-enforced boundary)", async () => {
    const dir = await fixtureProject("auto-server-web-refuse-")
    try {
      await withHarness(dir, async (h) => {
        const controlApi = new AutoApi(h.daemon.url, h.control)
        const project = basename(dir)
        // A constitutional config key in options: 400, the frozen refusal.
        try {
          await controlApi.startRun(project, { mode: "m" } as Record<string, unknown>)
          throw new Error("the daemon accepted a config key on a run")
        } catch (error) {
          expect(error).toBeInstanceOf(ApiError)
          expect((error as ApiError).status).toBe(400)
          expect((error as ApiError).message).toContain("was frozen by init")
        }
        // A config key disguised as a switch: the registry refuses it too.
        try {
          await controlApi.startRun(project, undefined, { OPENCODE_AUTO_NOT_A_SWITCH: "1" })
          throw new Error("the daemon accepted an unknown switch")
        } catch (error) {
          expect(error).toBeInstanceOf(ApiError)
          expect((error as ApiError).status).toBe(400)
          expect((error as ApiError).message).toContain("not a known switch")
        }
        // And the read scope cannot start anything.
        await expect(new AutoApi(h.daemon.url, h.read).startRun(project)).rejects.toMatchObject({ status: 403 } as Partial<ApiError>)
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("the served web client (pause and resume)", () => {
  test("the graceful /exit over the client's session yields paused-resumable; a re-run with the same request resumes to completion", async () => {
    const dir = await fixtureProject("auto-server-web-pause-")
    try {
      // The split must be taken and the turns stretched, so the control
      // frame lands inside the run (interactive-e2e's own knobs).
      await withFakeAgent({ FAKE_CLAUDE_DELAY_MS: "400", FAKE_CLAUDE_LEAD_CONTEXT: "160000" }, async () => {
        await withHarness(dir, async (h) => {
          const api = new AutoApi(h.daemon.url, h.read)
          const controlApi = new AutoApi(h.daemon.url, h.control)
          const project = basename(dir)
          const started = await controlApi.startRun(project, undefined, { OPENCODE_AUTO_AGENT: "claude" })
          await untilRunning(dir, api, started.id)

          // The pause: the graceful /exit over the interactive session — the
          // client's own control path, the vocabulary's exit 3.
          const rec = recorded(controlApi.interactiveUrl(started.id))
          rec.session.connect()
          try {
            await waitFor("the bridge hello", () => rec.hello()?.worker === true, 30_000)
            expect(rec.hello()).toMatchObject({ type: "hello", run: started.id })
            rec.session.requestExit()
            await waitFor("the control outcome", () => rec.controlDone()?.applied === true, 30_000)
            expect(rec.controlDone()).toMatchObject({ action: "exit", applied: true })
          } finally {
            await rec.session.close()
          }
          const paused = await untilTerminal(api, started.id)
          expect(paused.state, paused.tail).toBe("paused")
          expect(paused.code).toBe(3)
          expect(paused.request?.switches).toEqual({ OPENCODE_AUTO_AGENT: "claude" })

          // The resume: a plain re-run of the same project with the paused
          // run's own request — the vocabulary's precise-resume promise.
          const resumed = await controlApi.startRun(project, paused.request?.options, paused.request?.switches)
          const done = await untilTerminal(api, resumed.id)
          expect(done.state, done.tail).toBe("completed")
          expect(await Bun.file(join(dir, "docs", TASK, "done.md")).exists()).toBe(true)
        })
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 300_000)
})
