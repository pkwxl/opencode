// The disk observability surface end to end (T-090, P1e of the headless
// service evolution, auto-core plans/0067): the status read model
// (GET /projects/<p>/status) and the two SSE tails (GET /projects/<p>/log,
// GET /projects/<p>/events), served by the daemon in-process over registered
// temp directories — every fact asserted against what a run (or a planted
// file) itself wrote; the daemon writes nothing. What these cases pin:
//   - the four defensive-read caveats of the assessment (§4): torn-JSON
//     tolerance (a truncated progress.json reads as "no change / retry next
//     tick" — status 200, the file named under unparsable, never an error
//     state; the next tick recovers), newest-log discovery by listing with
//     same-second names (the second run in a second APPENDS to the one file —
//     the tail keeps following it, no rotation), re-seek on run rotation (a
//     newer log name is a new run; a shrunken journal is a new run), and
//     whole-line SSE framing with prompt flush (a partial line waits for its
//     newline; a completed line arrives within one poll);
//   - the log's prose is delivered verbatim and never parsed; the events
//     channel delivers only parseable typed journal lines (a torn line is
//     skipped, not delivered and not an error);
//   - the git verdicts: dirty/clean per worktree, nested repositories
//     included, entries as `XY <path>` relative to the project directory;
//   - lock visibility: lockStatusLine with its holder while the lock is
//     live, null when it is not;
//   - commit-is-completion (draft §五): a task's `done` verdict comes from
//     its done.md (the closing commit's rename), never from the runtime
//     state — a pending task with units.json present is not done, a done.md
//     with no units.json is;
//   - the external observer e2e (the acceptance): during a real fixture run
//     (the fake `claude` CLI) the SSE stream delivers the run's log lines
//     within a bounded latency, the poller observes the lock, the unit
//     transition (pending → in_progress → done) and the git verdicts, and a
//     planted torn progress.json never surfaces as an error;
//   - the auth matrix and the whitelist for the three routes (401/403/404).
import { describe, expect, test } from "bun:test"
import { appendFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { basename, join } from "node:path"
import { startDaemon, type DaemonHandle } from "../src/daemon"
import { newestRunLog } from "../src/observe"
import { DaemonStore } from "../src/store"
import { fakeAgent, fixtureProject, scrubbedEnv, TASK } from "./fixtures/project"

// The daemon serves the read model and the tails from this process: the
// scrubbed-env conventions of the shared fixtures must hold for anything it
// spawns.
process.env.XDG_CONFIG_HOME = scrubbedEnv().XDG_CONFIG_HOME

// —— the harness ——

type Body = Record<string, unknown>

type Harness = {
  daemon: DaemonHandle
  read: string
  control: string
  register: (dir: string) => string
  request: (method: string, path: string, token?: string, body?: unknown) => Promise<Response>
  status: (token: string, project: string) => Promise<{ status: number; body: Body }>
}

async function withObserve(fn: (h: Harness) => Promise<void>): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "auto-server-observe-"))
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
  const status = async (token: string, project: string) => {
    const response = await request("GET", `/projects/${project}/status`, token)
    return { status: response.status, body: (await response.json()) as Body }
  }
  try {
    await fn({ daemon, read, control, register: (dir) => store.register(dir).name, request, status })
  } finally {
    await daemon.stop()
    await rm(dataDir, { recursive: true, force: true })
  }
}

// —— the SSE client (a frame reader over the response body) ——

type Frame = { event: string; data: string }

// An open tail: frames accumulate as they arrive; `until` waits (bounded) for
// the frames to satisfy a predicate; `stop` aborts the fetch so the server's
// cancel() fires and its timers stop.
class Tail {
  readonly frames: Frame[] = []
  private readonly abort: AbortController
  private done: Promise<void> = Promise.resolve()

  private constructor(abort: AbortController) {
    this.abort = abort
  }

  static async open(url: string, token: string): Promise<Tail> {
    const abort = new AbortController()
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: abort.signal })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    const tail = new Tail(abort)
    tail.pump(response)
    return tail
  }

  // Reads the response body forever, parsing SSE frames (`event:` + `data:`;
  // comment heartbeats and blank separators carry no event name and drop out).
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
            if (event) this.frames.push({ event, data: /^data: (.*)$/m.exec(raw)?.[1] ?? "" })
          }
        }
      } catch {
        // Aborted by stop(); the frames collected so far stand.
      }
    })()
  }

  // Waits until the collected frames satisfy the predicate; returns them.
  async until(what: string, satisfied: (frames: readonly Frame[]) => boolean, timeoutMs = 10_000): Promise<readonly Frame[]> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (satisfied(this.frames)) return this.frames
      if (Date.now() > deadline) throw new Error(`the tail never delivered ${what}; frames so far: ${JSON.stringify(this.frames)}`)
      await Bun.sleep(25)
    }
  }

  async stop(): Promise<void> {
    this.abort.abort()
    await this.done.catch(() => {})
  }
}

// The SSE frames of one event name, in arrival order.
const eventsOf = (frames: readonly Frame[], event: string): string[] => frames.filter((frame) => frame.event === event).map((frame) => frame.data)

// Appends bytes to a log file the way the core's writeSync-per-entry audit
// log does (append semantics, never a whole-file rewrite: Bun.write REPLACES,
// which would shrink the file under the tailer and trip the truncation
// re-seek — not the scene these helpers stage).
async function logRaw(dir: string, name: string, text: string): Promise<void> {
  await mkdir(join(dir, ".auto", "logs"), { recursive: true })
  await appendFile(join(dir, ".auto", "logs", name), text)
}

// One complete line, flushed straight through (the audit log's own shape).
const logLine = (dir: string, name: string, line: string): Promise<void> => logRaw(dir, name, `${line}\n`)

// Raw bytes with no trailing newline (a line still being written).
const logPartial = (dir: string, name: string, text: string): Promise<void> => logRaw(dir, name, text)

// A lock file planted the way the core writes it (a live holder: this test
// process's own pid is held by a spawned child, which the pid probe sees).
async function plantLiveLock(dir: string, pid: number): Promise<void> {
  const record = { pid, host: hostname(), command: "run", started: new Date().toISOString() }
  await Bun.write(join(dir, ".auto", "run.lock"), `${JSON.stringify(record)}\n`, { createPath: true })
}

// —— newest-file discovery (caveat 3: discover by listing, never construct) ——

describe("observe: newest run-log discovery", () => {
  test("the newest stamp-bearing name wins; junk names never tail", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-server-discover-"))
    try {
      expect(newestRunLog(dir)).toBeUndefined() // no .auto/logs yet
      const logs = join(dir, ".auto", "logs")
      await mkdir(logs, { recursive: true })
      await Bun.write(join(logs, "notes.txt"), "a person's notes\n")
      await Bun.write(join(logs, "run-.log"), "no stamp\n")
      await Bun.write(join(logs, "run-2026-09-30_23-59-59.log"), "older\n")
      await Bun.write(join(logs, "run-2026-10-01_10-00-00.log.123.tmp"), "a writer's temp file\n")
      await Bun.write(join(logs, "run-2026-10-01_10-00-00.log"), "newest\n")
      // Discovered by listing and name order (the ISO-to-seconds stamp is
      // monotonic); the temp file and the unstamped names never match.
      expect(newestRunLog(dir)).toBe("run-2026-10-01_10-00-00.log")
      await Bun.write(join(logs, "run-2026-10-01_10-00-01.log"), "newest still\n")
      expect(newestRunLog(dir)).toBe("run-2026-10-01_10-00-01.log")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 10_000)
})

// —— the status read model ——

describe("observe: the status read model", () => {
  test("torn progress.json is 'no change / retry next tick' — 200, named under unparsable, never an error; the next tick recovers", async () => {
    const dir = await fixtureProject("auto-server-torn-")
    try {
      await Bun.write(join(dir, ".auto", "progress.json"), '{"task":"T-001","ph')
      await withObserve(async (h) => {
        const project = h.register(dir)
        const torn = await h.status(h.read, project)
        expect(torn.status).toBe(200)
        expect(torn.body).not.toHaveProperty("error")
        expect(torn.body.unparsable).toEqual([".auto/progress.json"])
        expect((torn.body.state as Body).progress).toBeNull()
        // The atomic writers' absent files are absent, not torn.
        expect((torn.body.state as Body).units).toBeNull()
        expect(torn.body.unparsable).not.toContain(".auto/units.json")
        // The writer settles: the very next poll sees the whole record.
        await Bun.write(join(dir, ".auto", "progress.json"), '{"task":"T-001","session":"s","at":1,"active":true}')
        const healed = await h.status(h.read, project)
        expect(healed.status).toBe(200)
        expect(healed.body.unparsable).toEqual([])
        expect((healed.body.state as Body).progress).toMatchObject({ task: TASK, session: "s", active: true })
        // The lock and the log file of the moment are surfaced beside it.
        expect(healed.body.lock).toBeNull()
        expect(healed.body.logFile).toBeNull()
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)

  test("a live lock surfaces lockStatusLine with its holder; the commit verdicts come from done.md, never the runtime state", async () => {
    const dir = await fixtureProject("auto-server-verdicts-")
    const holder = Bun.spawn(["sleep", "30"])
    try {
      await plantLiveLock(dir, holder.pid)
      // A pending task the runtime state knows about (attempts recorded):
      // the verdict stays open — commit-is-completion.
      await Bun.write(join(dir, ".auto", "units.json"), JSON.stringify({ tasks: { [TASK]: { attempts: 2, status: "in_progress" } } }))
      await withObserve(async (h) => {
        const project = h.register(dir)
        const first = await h.status(h.read, project)
        expect(first.status).toBe(200)
        // Lock visibility: the lockStatusLine holder text (auto-core
        // src/lock.ts:95) with the holder record.
        const lock = first.body.lock as Body
        expect(lock.statusLine).toContain("▶ run in progress")
        expect(lock.statusLine).toContain(`pid ${holder.pid} on ${hostname()}`)
        expect((lock.holder as Body).pid).toBe(holder.pid)
        // The git verdict: the planted lock and runtime state are gitignored
        // (.auto/), so the worktree reads clean.
        expect((first.body.git as Body).clean).toBe(true)
        // The tree: the task runs (in_progress from the runtime state), the
        // phase is open, and the DONE verdict is false — attempts and
        // in_progress are runtime facts, not completion.
        const verdicts = first.body.verdicts as Body
        expect(verdicts.worktree).toBe("clean")
        const task = (verdicts.tasks as Body[]).find((entry) => entry.id === TASK)!
        expect(task.status).toBe("in_progress")
        expect(task.done).toBe(false)
        expect((verdicts.phases as Body[]).find((phase) => phase.id === "R-01.P01")!.current).toBe(true)
        // The core's rendered tree carries the same moment (▶ marks).
        expect((first.body.status as string[]).some((line) => line.includes(`[▶] ${TASK}`))).toBe(true)
        // The closing commit's rename is the verdict: done.md with the
        // runtime entry dropped (what markDone leaves) reads done.
        await rename(join(dir, "docs", TASK, "todo.md"), join(dir, "docs", TASK, "done.md"))
        await Bun.write(join(dir, ".auto", "units.json"), JSON.stringify({ tasks: {} }))
        const settled = await h.status(h.read, project)
        const done = ((settled.body.verdicts as Body).tasks as Body[]).find((entry) => entry.id === TASK)!
        expect(done.done).toBe(true)
        expect(done.status).toBe("done")
        expect((settled.body.status as string[]).some((line) => line.includes(`[✓] ${TASK}`))).toBe(true)
      })
    } finally {
      holder.kill()
      await holder.exited
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)

  test("git verdicts: dirty/clean per worktree, nested repositories included, entries XY + project-relative", async () => {
    const dir = await fixtureProject("auto-server-git-")
    try {
      await withObserve(async (h) => {
        const project = h.register(dir)
        const clean = await h.status(h.read, project)
        expect((clean.body.git as Body).clean).toBe(true)
        expect((clean.body.git as Body).worktrees).toHaveLength(1)
        // A stray untracked file (what an abandoned run leaves) reads dirty
        // with its porcelain entry.
        await Bun.write(join(dir, "stray.txt"), "leftover\n")
        const dirty = await h.status(h.read, project)
        const git = dirty.body.git as Body
        expect(git.clean).toBe(false)
        expect((dirty.body.verdicts as Body).worktree).toBe("dirty")
        expect((git.worktrees as Body[])[0]!.changed).toContain("?? stray.txt")
        // A nested repository is its own worktree verdict: dirty inside,
        // while the outer tree's collapsed `?? nested/` entry stays skipped
        // (the core's own rule — the inner repository lists its own files).
        await mkdir(join(dir, "nested"))
        const init = Bun.spawn(["git", "-C", join(dir, "nested"), "init"], { stdout: "ignore", stderr: "ignore" })
        expect(await init.exited).toBe(0)
        await Bun.write(join(dir, "nested", "inner.txt"), "uncommitted\n")
        const nested = await h.status(h.read, project)
        const worktrees = ((nested.body.git as Body).worktrees as Body[]).map((worktree): Body => ({ ...worktree, root: basename(String(worktree.root)) }))
        expect(worktrees).toHaveLength(2)
        const inner = worktrees.find((worktree) => worktree.root === "nested")!
        expect(inner.clean).toBe(false)
        // Entries are project-relative (the core's own convention), so the
        // nested repository's file carries its directory: nested/inner.txt.
        expect(inner.changed).toContain("?? nested/inner.txt")
        const outer = worktrees.find((worktree) => worktree.root === basename(dir))!
        expect(outer.changed).not.toContain("?? nested/")
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)

  test("auth and the whitelist: 401 without a token, 403 without read, 404 unregistered; status is GET-only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-server-observe-auth-"))
    try {
      await withObserve(async (h) => {
        const project = h.register(dir)
        for (const route of ["status", "log", "events"]) {
          expect((await h.request("GET", `/projects/${project}/${route}`)).status).toBe(401)
          expect((await h.request("GET", `/projects/${project}/${route}`, h.control)).status).toBe(403)
          expect((await h.request("GET", `/projects/nope/${route}`, h.read)).status).toBe(404)
          expect((await h.request("POST", `/projects/${project}/${route}`, h.read, {})).status).toBe(404)
        }
        expect((await h.request("GET", `/projects/${project}/status`, h.read)).status).toBe(200)
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 20_000)
})

// —— the SSE log tail ——

describe("observe: the SSE log tail (framing, flush, rotation)", () => {
  test("whole lines from the file's start, prompt flush, partial lines wait for their newline, rotation re-seeks, same-second appends follow", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-server-tail-log-"))
    try {
      await logLine(dir, "run-2026-10-01_10-00-00.log", "[10:00:00] run one opens")
      await withObserve(async (h) => {
        const project = h.register(dir)
        const tail = await Tail.open(`${h.daemon.url}/projects/${project}/log`, h.read)
        try {
          // Attaching names nothing; discovery answers with the newest file
          // and its whole content follows (a per-run log is read from its
          // beginning — the client sees the run it came to watch).
          await tail.until("the first run's line", (frames) => eventsOf(frames, "line").includes("[10:00:00] run one opens"))
          const attached = eventsOf(tail.frames, "tail")
          expect(attached.at(-1)).toBe(JSON.stringify({ file: "run-2026-10-01_10-00-00.log", from: 0, reason: "start" }))
          // Prompt flush: a whole line lands within a bounded latency of its
          // write (the poll is 100 ms; the bound leaves the runner slack).
          const wrote = Date.now()
          await logLine(dir, "run-2026-10-01_10-00-00.log", "[10:00:01] second line")
          await tail.until("the appended line", (frames) => eventsOf(frames, "line").includes("[10:00:01] second line"))
          expect(Date.now() - wrote).toBeLessThan(5_000)
          // Whole-line framing: a partial line (no newline yet) is held...
          await logPartial(dir, "run-2026-10-01_10-00-00.log", "[10:00:02] partial")
          await Bun.sleep(600)
          expect(eventsOf(tail.frames, "line")).not.toContain("[10:00:02] partial")
          // ...until its newline arrives, delivered as one line.
          await logPartial(dir, "run-2026-10-01_10-00-00.log", " tail\n")
          await tail.until("the completed line", (frames) => eventsOf(tail.frames, "line").includes("[10:00:02] partial tail"))
          // Same-second second run: the core opens the SAME name to append
          // (one run per directory makes the name collide into one file) —
          // no rotation, the lines keep following in order.
          await logLine(dir, "run-2026-10-01_10-00-00.log", "[10:00:00] run two appends in the same second")
          await tail.until("the same-second run's line", (frames) => eventsOf(frames, "line").some((line) => line.includes("run two appends in the same second")))
          expect(eventsOf(tail.frames, "tail").filter((data) => data.includes("rotated"))).toEqual([])
          // Rotation: a NEWER name is a new run — the tail re-seeks to the
          // new file's start and never delivers the old file again.
          await logLine(dir, "run-2026-10-01_10-00-05.log", "[10:00:05] run three opens")
          await tail.until("the rotation and the new run's line", (frames) => eventsOf(frames, "line").some((line) => line.includes("run three opens")))
          expect(eventsOf(tail.frames, "tail").at(-1)).toBe(JSON.stringify({ file: "run-2026-10-01_10-00-05.log", from: 0, reason: "rotated" }))
          const delivered = eventsOf(tail.frames, "line").length
          await logLine(dir, "run-2026-10-01_10-00-00.log", "[10:00:06] the old file is not followed anymore")
          await Bun.sleep(600)
          expect(eventsOf(tail.frames, "line").length).toBe(delivered)
          // No line was ever delivered twice (ticks never overlap — the
          // compiled-binary smoke once duplicated an appended line).
          const lines = eventsOf(tail.frames, "line")
          expect(new Set(lines).size).toBe(lines.length)
        } finally {
          await tail.stop()
        }
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)

  test("a directory with no run log yet idles without error and picks the first file up when a run writes it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-server-tail-empty-"))
    try {
      await withObserve(async (h) => {
        const project = h.register(dir)
        const tail = await Tail.open(`${h.daemon.url}/projects/${project}/log`, h.read)
        try {
          await tail.until("the attaching frame", (frames) => frames.some((frame) => frame.event === "tail"))
          expect(eventsOf(tail.frames, "tail")).toEqual([JSON.stringify({ file: null, reason: "attaching" })])
          await Bun.sleep(300)
          expect(eventsOf(tail.frames, "line")).toEqual([]) // nothing to tail, no error frame
          await logLine(dir, "run-2026-10-01_11-00-00.log", "[11:00:00] the first run opens")
          await tail.until("the first file", (frames) => eventsOf(frames, "line").includes("[11:00:00] the first run opens"))
          expect(eventsOf(tail.frames, "tail").at(-1)).toBe(JSON.stringify({ file: "run-2026-10-01_11-00-00.log", from: 0, reason: "start" }))
        } finally {
          await tail.stop()
        }
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 20_000)
})

// —— the SSE events tail ——

describe("observe: the SSE events tail (structured payloads, truncation re-seek)", () => {
  test("typed journal lines as structured payloads, torn lines skipped, truncation at a new run re-seeks to 0", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-server-tail-events-"))
    const journal = join(dir, ".auto", "run-events.jsonl")
    const turnStart = JSON.stringify({ type: "turn-start", session: "s1", start: 1 })
    const settle = JSON.stringify({ type: "settle", settle: { reason: "idle" } })
    try {
      await Bun.write(journal, `${turnStart}\n${settle}\n`)
      await withObserve(async (h) => {
        const project = h.register(dir)
        const tail = await Tail.open(`${h.daemon.url}/projects/${project}/events`, h.read)
        try {
          // The journal is delivered verbatim as structured payloads, from
          // the file's start.
          await tail.until("both entries of run one", (frames) => eventsOf(frames, "run-event").length >= 2)
          expect(eventsOf(tail.frames, "run-event")).toEqual([turnStart, settle])
          // A torn line (mid-write) is never delivered — not as an event,
          // not as an error frame. (Appended, never rewritten: a rewrite
          // would shrink the file and trip the truncation re-seek.)
          await appendFile(journal, '{"type":"input","orig')
          await Bun.sleep(600)
          expect(eventsOf(tail.frames, "run-event")).toEqual([turnStart, settle])
          expect(tail.frames.filter((frame) => frame.event !== "run-event" && frame.event !== "tail")).toEqual([])
          // The line completes: delivered whole.
          await appendFile(journal, 'in":"external","input":{"text":"go"}}\n')
          const input = JSON.stringify({ type: "input", origin: "external", input: { text: "go" } })
          await tail.until("the completed torn line", (frames) => eventsOf(frames, "run-event").includes(input))
          // A new run TRUNCATES the journal (auto-core src/engine/events.ts
          // startRunEvents): the shrink re-seeks to 0 and only the new run's
          // entries follow — the old run's entries are not re-delivered.
          await Bun.write(journal, `${JSON.stringify({ type: "turn-start", session: "s2", start: 2 })}\n`)
          const second = JSON.stringify({ type: "turn-start", session: "s2", start: 2 })
          await tail.until("run two's entry", (frames) => eventsOf(frames, "run-event").includes(second))
          const all = tail.frames
          const truncatedAt = all.findIndex((frame) => frame.data.includes("truncated"))
          expect(truncatedAt).toBeGreaterThanOrEqual(0)
          // Run one's entries were delivered exactly once (their own moment),
          // and nothing after the truncation frame mentions them — the re-seek
          // re-read the NEW run's file, not the old journal.
          expect(all.slice(0, truncatedAt).filter((frame) => frame.data.includes("s1"))).toHaveLength(1)
          expect(all.slice(truncatedAt).filter((frame) => frame.data.includes("s1"))).toEqual([])
          expect(eventsOf(tail.frames, "tail").at(-1)).toBe(JSON.stringify({ file: ".auto/run-events.jsonl", from: 0, reason: "truncated" }))
        } finally {
          await tail.stop()
        }
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)
})

// —— the external observer e2e (the acceptance) ——

describe("observe: the external observer e2e (a fixture run watched from the outside)", () => {
  test("during a run the SSE tail delivers log lines in bounded latency, the poller sees the lock, the unit transition and the git verdicts, and a torn progress.json never errors", async () => {
    const dir = await fixtureProject("auto-server-observer-")
    // The planted torn record: the run's own resume read is tolerant (the
    // core parses defensively too) and the observer must be equally blind to
    // it — never an error state.
    await Bun.write(join(dir, ".auto", "progress.json"), '{"task":"' + TASK + '","ph')
    try {
      const agent = await fakeAgent({ FAKE_CLAUDE_DELAY_MS: "300" })
      const before: Record<string, string | undefined> = {}
      for (const [key, value] of Object.entries(agent.env)) {
        before[key] = process.env[key]
        process.env[key] = value
      }
      try {
        await withObserve(async (h) => {
          const project = h.register(dir)
          // The observer is connected BEFORE the run starts: it watches the
          // whole lifecycle the way an outside client would.
          const tail = await Tail.open(`${h.daemon.url}/projects/${project}/log`, h.read)
          try {
            // The torn record reads as no-change, named, never an error.
            const torn = await h.status(h.read, project)
            expect(torn.status).toBe(200)
            expect(torn.body.unparsable).toContain(".auto/progress.json")
            // The run starts.
            const started = await h.request("POST", "/runs", h.control, { project, switches: { OPENCODE_AUTO_AGENT: "claude" } })
            expect(started.status).toBe(202)
            const id = ((await started.json()) as Body).id as string
            // Bounded latency end to end: the run's first banner line (the
            // log-file line the worker writes at startup) reaches the stream
            // promptly — well inside any human-noticeable bound.
            const began = Date.now()
            await tail.until("the run's opening lines", (frames) => eventsOf(frames, "line").some((line) => line.includes("log file:")), 60_000)
            expect(Date.now() - began).toBeLessThan(30_000)
            // The poller, meanwhile, watches the read model: the lock, the
            // unit transition, the git verdicts — every poll 200, a torn or
            // absent state file never an error.
            const deadline = Date.now() + 120_000
            let sawLock = false
            let sawInProgress = false
            let sawDirty = false
            let terminal: Body | undefined
            for (;;) {
              const polled = await h.status(h.read, project)
              expect(polled.status).toBe(200)
              expect(polled.body).not.toHaveProperty("error")
              if (polled.body.lock !== null) sawLock = true
              const task = ((polled.body.verdicts as Body).tasks as Body[]).find((entry) => entry.id === TASK)
              if (task?.status === "in_progress") sawInProgress = true
              if ((polled.body.git as Body).clean === false) sawDirty = true
              const run = (await (await h.request("GET", `/runs/${id}`, h.read)).json()) as Body
              if (run.live !== true) {
                terminal = run
                break
              }
              if (Date.now() > deadline) throw new Error(`the run never ended: ${JSON.stringify(run)}`)
              await Bun.sleep(150)
            }
            expect((terminal as Body).state, `the observed run ended ${JSON.stringify(terminal)}; its tail:\n${String((terminal as Body).tail).slice(-2500)}`).toBe("completed")
            expect((terminal as Body).code).toBe(0)
            expect(sawLock).toBe(true)
            expect(sawInProgress).toBe(true) // pending → in_progress → done
            expect(sawDirty).toBe(true) // the agent's writes, before the closing commit
            // After the run: the commit verdicts settled — done from done.md
            // (the closing commit's rename), the worktree clean again, the
            // lock gone, the progress record deleted at completion.
            const settled = await h.status(h.read, project)
            expect(settled.status).toBe(200)
            expect(settled.body.unparsable).toEqual([])
            expect(settled.body.lock).toBeNull()
            expect((settled.body.git as Body).clean).toBe(true)
            const task = ((settled.body.verdicts as Body).tasks as Body[]).find((entry) => entry.id === TASK)!
            expect(task.done).toBe(true)
            expect(task.status).toBe("done")
            expect((settled.body.state as Body).progress).toBeNull()
            expect((settled.body.status as string[]).some((line) => line.includes(`[✓] ${TASK}`))).toBe(true)
            // The log file the tail followed is the run's, named in the
            // model, and the stream carried the run's own lines throughout —
            // exactly one tail target from nothing (attaching) to the run's
            // own file (start): one run, one rotation-free follow.
            expect(settled.body.logFile).toMatch(/^run-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.log$/)
            await tail.until("the run's completion lines", (frames) => eventsOf(frames, "line").some((line) => line.includes(TASK)), 30_000)
            expect(eventsOf(tail.frames, "line").length).toBeGreaterThan(5)
            expect(eventsOf(tail.frames, "tail")).toEqual([
              JSON.stringify({ file: null, reason: "attaching" }),
              JSON.stringify({ file: settled.body.logFile, from: 0, reason: "start" }),
            ])
          } finally {
            await tail.stop()
          }
        })
      } finally {
        for (const [key, value] of Object.entries(before)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
        await agent.done()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 300_000)
})
