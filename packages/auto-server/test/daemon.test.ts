// The daemon end to end (T-088, P1c of the headless service evolution,
// auto-core plans/0067): startDaemon runs in-process on an ephemeral port
// (Bun.serve), the workers it spawns are real child processes over the fake
// `claude` (the shared fixture of test/fixtures/project.ts), and the store
// under test lives in a temp data directory. What these cases pin:
//   - the auth matrix per scope (401 missing/unknown, 403 insufficient,
//     the revoked token falling back to 401; /health open);
//   - the absolute whitelist (unregistered paths refused, `directory`
//     refused outright, name and registered-path both resolving, config
//     keys refused with the frozen-flag message);
//   - spawn and the exit-code vocabulary: 0/1/2 e2e over fixture runs,
//     130 through the daemon's kill (the double-SIGINT path), 3 as the
//     mapping table (no P1 producer exists headless — interactive is
//     refused by the worker, the graceful pause needs the P3 transport);
//   - the lock paths: a planted live holder → 423 with the holder line,
//     an unreadable lock → 423, a planted stale lock → the spawn proceeds
//     (the worker's own runAll performs the core's next-acquirer
//     cleanup), and the second spawn on a live run → 409, retryable;
//   - the CLI surface beside the daemon: register/unregister/projects and
//     token issue/list/revoke (the bootstrap-safe way the whitelist and
//     the tokens are managed), plus a serve smoke over a subprocess.
import { describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { basename, join } from "node:path"
import { hostname, tmpdir } from "node:os"
import { connectHost, evictTerminalRuns, MAX_TERMINAL_RUNS, startDaemon, terminalOf, type DaemonHandle } from "../src/daemon"
import { appendJournal, journalPath, type JournalEvent } from "../src/question-journal"
import { parseTransport } from "../src/request"
import { DaemonStore, defaultDataDir } from "../src/store"
import { fakeAgent, fixtureProject, scrubbedEnv, TASK } from "./fixtures/project"
import { wsClient } from "./fixtures/ws"

const PACKAGE_ROOT = join(import.meta.dir, "..")

// The daemon spawns worker children from its own environment (this test
// process): the scrubbedEnv conventions must hold for them — no ambient
// OPENCODE_AUTO_* reaches a worker (the daemon itself scrubs the layer off
// its spawns; every fixture run selects its agent through the request's
// switches instead) and no operator model registry is read (XDG_CONFIG_HOME
// points at an empty temp).
process.env.XDG_CONFIG_HOME = scrubbedEnv().XDG_CONFIG_HOME

type RunView = {
  id: string
  project: string
  directory: string
  state: string
  code: number | null
  signal: string | null
  pid: number | null
  tail: string
  live: boolean
}

type Harness = {
  daemon: DaemonHandle
  read: string
  control: string
  request: (method: string, path: string, token?: string, body?: unknown) => Promise<Response>
}

// One daemon over one temp data directory, with a read and a control token
// issued up front (the same store the CLI commands write). `launch` threads
// into startDaemon as the confinement launcher (plans/0162's --launch).
async function withHarness(fn: (h: Harness) => Promise<void>, register: string[] = [], launch?: string): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "auto-server-data-"))
  const store = new DaemonStore(dataDir)
  for (const dir of register) store.register(dir)
  const read = store.issueToken("read", "reader").token
  const control = store.issueToken("control", "controller").token
  const daemon = await startDaemon({ dataDir, port: 0, ...(launch !== undefined ? { launch } : {}) })
  const request = (method: string, path: string, token?: string, body?: unknown) =>
    fetch(`${daemon.url}${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  try {
    await fn({ daemon, read, control, request })
  } finally {
    await daemon.stop()
    await rm(dataDir, { recursive: true, force: true })
  }
}

// Polls a run until it reaches a terminal state (the lifecycle a client
// observes through GET /runs/<id>).
async function untilTerminal(h: Harness, token: string, id: string, timeoutMs = 120_000): Promise<RunView> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const run = (await (await h.request("GET", `/runs/${id}`, token)).json()) as RunView
    if (!run.live) return run
    if (Date.now() > deadline) throw new Error(`run ${id} never reached a terminal state: ${JSON.stringify(run)}`)
    await Bun.sleep(200)
  }
}

// Waits for a run to be observed running (the worker took .auto/run.lock).
async function untilRunning(h: Harness, token: string, id: string, timeoutMs = 30_000): Promise<RunView> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const run = (await (await h.request("GET", `/runs/${id}`, token)).json()) as RunView
    if (run.state === "running") return run
    if (!run.live) throw new Error(`run ${id} ended before running was observed: ${JSON.stringify(run)}`)
    if (Date.now() > deadline) throw new Error(`run ${id} was never observed running: ${JSON.stringify(run)}`)
    await Bun.sleep(100)
  }
}

// Waits until the run's engine has started its first turn (the journal
// .auto/run-events.jsonl carries its first entry). runAll installs its
// SIGINT handler ahead of the first session turn but after the lock, so
// this is the earliest point at which a kill deterministically reaches the
// handler's force-terminate path (exit 130) rather than the process's
// default SIGINT disposition (a signal death).
async function untilTurnStarted(dir: string, timeoutMs = 30_000): Promise<void> {
  const path = join(dir, ".auto", "run-events.jsonl")
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const text = await Bun.file(path).text().catch(() => "")
    if (text.trim()) return
    if (Date.now() > deadline) throw new Error("the run never recorded its first turn in .auto/run-events.jsonl")
    await Bun.sleep(100)
  }
}

// The fake `claude` must be on the DAEMON's PATH (it spawns the workers that
// spawn the agent), so the fixture's env is installed on this process for
// the duration of a run test and restored after.
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

// A lock file planted the way the core writes it.
async function plantLock(dir: string, holder: { pid: number; host?: string; command?: string }): Promise<string> {
  const path = join(dir, ".auto", "run.lock")
  await mkdir(join(dir, ".auto"), { recursive: true })
  const record = { pid: holder.pid, host: holder.host ?? hostname(), command: holder.command ?? "run", started: new Date().toISOString() }
  await Bun.write(path, `${JSON.stringify(record)}\n`)
  return path
}

describe("daemon: token auth (the scope matrix)", () => {
  test("health is open; every other route wants a known bearer token", async () => {
    await withHarness(async (h) => {
      // The one unauthenticated route: liveness only.
      expect((await h.request("GET", "/health")).status).toBe(200)
      // Missing header, a non-bearer header, and an unknown token are each
      // 401 — the token is the gate, not a hint. Auth precedes parsing.
      expect((await h.request("GET", "/runs")).status).toBe(401)
      const odd = await h.request("GET", "/runs", "not-a-bearer-token")
      expect(odd.status).toBe(401)
      const unknown = await h.request("GET", "/runs", "oas_nobodyknows")
      expect(unknown.status).toBe(401)
      expect(((await unknown.json()) as { error: string }).error).toContain("unknown token")
      const malformed = await h.request("POST", "/runs", undefined, "{not json")
      expect(malformed.status).toBe(401)
      // No other route exists.
      expect((await h.request("GET", "/nope", h.read)).status).toBe(404)
    })
  })

  test("read lists runs but cannot control; control spawns but cannot read; each 403 names the scope", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-server-auth-"))
    try {
      await withHarness(async (h) => {
        const listed = await h.request("GET", "/runs", h.read)
        expect(listed.status).toBe(200)
        expect(((await listed.json()) as { runs: unknown[] }).runs).toEqual([])
        const deniedPost = await h.request("POST", "/runs", h.read, { project: dir })
        expect(deniedPost.status).toBe(403)
        expect(((await deniedPost.json()) as { error: string }).error).toContain('requires the "control" scope')
        const deniedList = await h.request("GET", "/runs", h.control)
        expect(deniedList.status).toBe(403)
        expect(((await deniedList.json()) as { error: string }).error).toContain('requires the "read" scope')
        const deniedKill = await h.request("DELETE", "/runs/run-000001", h.read)
        expect(deniedKill.status).toBe(403)
        // The scope check precedes the run lookup: a control token killing
        // an unknown run gets the 404.
        const noRun = await h.request("DELETE", "/runs/run-000001", h.control)
        expect(noRun.status).toBe(404)
        const noSuch = await h.request("GET", "/runs/run-000001", h.read)
        expect(noSuch.status).toBe(404)
        // A registered project through the control token passes the gate
        // (what the run does is the whitelist's concern, not auth's).
        const accepted = await h.request("POST", "/runs", h.control, { project: dir })
        expect(accepted.status).toBe(202)
        await untilTerminal(h, h.read, ((await accepted.json()) as RunView).id)
      }, [dir])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  test("a revoked token falls back to 401 on the next request (the store reads per request)", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "auto-server-revoke-"))
    const daemon = await startDaemon({ dataDir, port: 0 })
    try {
      const store = new DaemonStore(dataDir)
      const { token } = store.issueToken("read", "ephemeral")
      const authed = await fetch(`${daemon.url}/runs`, { headers: { authorization: `Bearer ${token}` } })
      expect(authed.status).toBe(200)
      store.revokeToken("ephemeral")
      const revoked = await fetch(`${daemon.url}/runs`, { headers: { authorization: `Bearer ${token}` } })
      expect(revoked.status).toBe(401)
    } finally {
      await daemon.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})

describe("daemon: the whitelist is absolute", () => {
  test("a run request resolves only against the registry: unregistered paths 404, a directory field 400, name and registered path both resolve", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-server-white-"))
    try {
      await withHarness(async (h) => {
        // An unregistered path is simply not found — the daemon never
        // resolves a request path against the filesystem.
        const nope = await h.request("POST", "/runs", h.control, { project: join(dir, "sneaky") })
        expect(nope.status).toBe(404)
        const nopeBody = (await nope.json()) as { error: string }
        expect(nopeBody.error).toContain("is not a registered project")
        expect(nopeBody.error).toContain("whitelist resolves run targets only against the registry")
        // A directory field is refused with the rule itself.
        const direct = await h.request("POST", "/runs", h.control, { directory: dir })
        expect(direct.status).toBe(400)
        expect(((await direct.json()) as { error: string }).error).toContain('never "directory"')
        // Config keys — in options, at the top level, in a carrier — get
        // the same frozen refusal the worker gives, as a 400.
        const frozen = await h.request("POST", "/runs", h.control, { project: dir, options: { subtask: "auto" } })
        expect(frozen.status).toBe(400)
        expect(((await frozen.json()) as { error: string }).error).toContain("was frozen by init")
        const topLevel = await h.request("POST", "/runs", h.control, { project: dir, phases: "am" })
        expect(topLevel.status).toBe(400)
        expect(((await topLevel.json()) as { error: string }).error).toContain("was frozen by init")
        const carrier = await h.request("POST", "/runs", h.control, { project: dir, config: { mode: "migrate" } })
        expect(carrier.status).toBe(400)
        expect(((await carrier.json()) as { error: string }).error).toContain("a run request carries no config")
        // The four keys the core gained under the package (plans/0160 D2:
        // intent, treeLanes, lanes, isolate) get the same refusals — the
        // frozen-key family for the three with flags, the hand-edited family
        // for the lanes table — never the generic "not a run option".
        for (const [options, fragment] of [
          [{ intent: "cleanroom" }, "was frozen by init"],
          [{ treeLanes: "on" }, "was frozen by init"],
          [{ isolate: ["pkg"] }, "was frozen by init"],
          [{ lanes: { treeBudgetMB: 512 } }, "hand-edited"],
        ] as const) {
          const answer = await h.request("POST", "/runs", h.control, { project: dir, options: options as unknown as Record<string, unknown> })
          expect(answer.status).toBe(400)
          expect(((await answer.json()) as { error: string }).error).toContain(fragment)
        }
        // The advance surface is the transfer operation, never a run field.
        const smuggled = await h.request("POST", "/runs", h.control, { project: dir, transfer: {} })
        expect(smuggled.status).toBe(400)
        expect(((await smuggled.json()) as { error: string }).error).toContain('a run request carries no "transfer"')
        // The lane surface is the lane launcher's own channel, never a run
        // field (plans/0162).
        const laneField = await h.request("POST", "/runs", h.control, { project: dir, lane: { unit: "T-001" } })
        expect(laneField.status).toBe(400)
        expect(((await laneField.json()) as { error: string }).error).toContain('a run request carries no "lane"')
        // The shared option vocabulary answers here too (a 400, not a run
        // that dies on arrival) — width itself is served since plans/0162, so
        // the 400 here is the width pair the core itself refuses at run
        // start.
        const widthPair = await h.request("POST", "/runs", h.control, { project: dir, options: { maxSessions: 2, stopAfter: "T-001" } })
        expect(widthPair.status).toBe(400)
        expect(((await widthPair.json()) as { error: string }).error).toContain("serial-path option")
        const unknownSwitch = await h.request("POST", "/runs", h.control, { project: dir, switches: { OPENCODE_AUTO_NOPE: "on" } })
        expect(unknownSwitch.status).toBe(400)
        expect(((await unknownSwitch.json()) as { error: string }).error).toContain("is not a known switch")
        // Raw malformed JSON (the helper would stringify a plain string).
        const notJson = await fetch(`${h.daemon.url}/runs`, { method: "POST", headers: { authorization: `Bearer ${h.control}` }, body: "{not json" })
        expect(notJson.status).toBe(400)
        expect(((await notJson.json()) as { error: string }).error).toContain("not valid JSON")
        // By name and by registered absolute path: both are registry
        // matches (an empty directory; each run fails fast with
        // preflight's own exit 1 — awaited so the two never overlap). The
        // stored spelling is the canonical one (registration realpaths).
        const canonical = realpathSync(dir)
        const byName = await h.request("POST", "/runs", h.control, { project: basename(dir) })
        expect(byName.status).toBe(202)
        const started = (await byName.json()) as RunView
        expect(started.directory).toBe(canonical)
        await untilTerminal(h, h.read, started.id)
        const byPath = await h.request("POST", "/runs", h.control, { project: dir })
        expect(byPath.status).toBe(202)
        await untilTerminal(h, h.read, ((await byPath.json()) as RunView).id)
        // A path that merely points INSIDE a registered directory is not a
        // registry match — canonicalization names the project, it does not
        // widen the whitelist.
        const inside = await h.request("POST", "/runs", h.control, { project: join(dir, "sub") })
        expect(inside.status).toBe(404)
      }, [dir])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 120_000)
})

describe("daemon: the exit-code vocabulary maps onto run states", () => {
  test("the mapping table (3 included: the graceful /exit pause, the code a pause button will produce)", () => {
    expect(terminalOf(0, null)).toEqual({ state: "completed", code: 0, signal: null })
    expect(terminalOf(1, null)).toEqual({ state: "failed", code: 1, signal: null })
    expect(terminalOf(2, null)).toEqual({ state: "blocked", code: 2, signal: null })
    expect(terminalOf(3, null)).toEqual({ state: "paused", code: 3, signal: null })
    expect(terminalOf(130, null)).toEqual({ state: "killed", code: 130, signal: null })
    // A death by signal (no exit code) is a kill: crash and kill are
    // isomorphic scenes; the signal is recorded beside the state.
    expect(terminalOf(null, "SIGKILL")).toEqual({ state: "killed", code: null, signal: "SIGKILL" })
    // A code outside the core's vocabulary cannot occur from a run; it is
    // recorded verbatim under failed.
    expect(terminalOf(99, null)).toEqual({ state: "failed", code: 99, signal: null })
  })

  test("a fixture run completes: 202 with the id, starting → running → completed/0, the tail carries the worker's output, the task closes", async () => {
    const dir = await fixtureProject("auto-server-daemon-run-")
    try {
      await withFakeAgent({}, async () => {
        await withHarness(async (h) => {
          const res = await h.request("POST", "/runs", h.control, { project: basename(dir), switches: { OPENCODE_AUTO_AGENT: "claude" } })
          expect(res.status).toBe(202)
          expect(res.headers.get("location")).toMatch(/^\/runs\/run-\d+$/)
          const started = (await res.json()) as RunView
          expect(started.state).toBe("starting")
          expect(started.live).toBe(true)
          expect(started.id).toMatch(/^run-\d+$/)
          const done = await untilTerminal(h, h.read, started.id)
          expect(done.state).toBe("completed")
          expect(done.code).toBe(0)
          // The tail is the worker's own output (driver messages, stdout).
          expect(done.tail).toContain("📝 log file:")
          // The run really ran: the task closed (the unified commit is the
          // completion condition).
          expect(await Bun.file(join(dir, "docs", TASK, "done.md")).exists()).toBe(true)
          // And the run is listed.
          const listed = (await (await h.request("GET", "/runs", h.read)).json()) as { runs: RunView[] }
          expect(listed.runs.map((run) => run.id)).toContain(started.id)
        }, [dir])
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 180_000)

  test("preflight's exit 1 becomes failed/1 with its reason in the tail", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-server-empty-run-"))
    try {
      await withHarness(async (h) => {
        const res = await h.request("POST", "/runs", h.control, { project: dir })
        expect(res.status).toBe(202)
        const done = await untilTerminal(h, h.read, ((await res.json()) as RunView).id)
        expect(done.state).toBe("failed")
        expect(done.code).toBe(1)
        expect(done.tail).toContain("agent contract file missing")
      }, [dir])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  test("the unit-startup clean gate's exit 2 becomes blocked/2 (needs a human; the leftover stays)", async () => {
    // The blocked scene the daemon actually meets: a leftover from an
    // abandoned run. An untracked stray file (outside the ignore set) trips
    // the execution unit's startup clean gate — exit 2 with no state write,
    // the human's to handle and re-run.
    const dir = await fixtureProject("auto-server-blocked-")
    await Bun.write(join(dir, "stray.txt"), "leftover from an abandoned run\n")
    try {
      await withHarness(async (h) => {
        const res = await h.request("POST", "/runs", h.control, { project: basename(dir) })
        expect(res.status).toBe(202)
        const done = await untilTerminal(h, h.read, ((await res.json()) as RunView).id)
        expect(done.state).toBe("blocked")
        expect(done.code).toBe(2)
        expect(done.tail).toContain("the worktree has uncommitted changes")
        expect(done.tail).toContain("stray.txt")
        // Nothing was written into the project by the refused run.
        expect(await Bun.file(join(dir, "docs", TASK, "done.md")).exists()).toBe(false)
      }, [dir])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  test("kill (DELETE) force-terminates through the double-SIGINT path: killed/130, and the directory accepts a new run after (the resume completes)", async () => {
    const dir = await fixtureProject("auto-server-kill-")
    try {
      await withFakeAgent({ FAKE_CLAUDE_DELAY_MS: "400" }, async () => {
        await withHarness(async (h) => {
          const res = await h.request("POST", "/runs", h.control, { project: basename(dir), switches: { OPENCODE_AUTO_AGENT: "claude" } })
          const id = ((await res.json()) as RunView).id
          await untilRunning(h, h.read, id)
          // Past the first turn, the run's SIGINT handler is installed: the
          // kill reaches the force-terminate path (exit 130).
          await untilTurnStarted(dir)
          const kill = await h.request("DELETE", `/runs/${id}`, h.control)
          expect(kill.status).toBe(202)
          const dead = await untilTerminal(h, h.read, id)
          expect(dead.state).toBe("killed")
          expect(dead.code).toBe(130)
          // Killing a terminal run is a conflict.
          const again = await h.request("DELETE", `/runs/${id}`, h.control)
          expect(again.status).toBe(409)
          // The directory is free again: a new run is accepted (the kill is
          // isomorphic to a crash; the run resumes from the persisted
          // progress and completes).
          const rerun = await h.request("POST", "/runs", h.control, { project: basename(dir), switches: { OPENCODE_AUTO_AGENT: "claude" } })
          expect(rerun.status).toBe(202)
          const resumed = await untilTerminal(h, h.read, ((await rerun.json()) as RunView).id, 180_000)
          expect(resumed.state).toBe("completed")
          expect(resumed.code).toBe(0)
          expect(await Bun.file(join(dir, "docs", TASK, "done.md")).exists()).toBe(true)
        }, [dir])
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 300_000)
})

// plans/0162 — the phase-run absorb: one daemon hosts runs for many
// registered projects concurrently (one run per project at a time — the
// registry and the run lock both arbitrate per directory, so two projects
// simply run in parallel), width ≥ 2 is served (the daemon attaching no
// interactive transport to a wide run — the core's one-channel rule, the
// CLI's own width-run shape), and `serve --launch <script>` routes every
// spawned run through the operator's confinement launcher
// (`bash <script> <project-dir> -- <worker command...>`, the launcher's
// exit code the run's).
describe("daemon: concurrent projects, width, and the confinement launcher (plans/0162)", () => {
  test("two registered projects run concurrently: both live at once, both complete 0", async () => {
    const one = await fixtureProject("auto-server-par-a-")
    const two = await fixtureProject("auto-server-par-b-")
    try {
      await withFakeAgent({ FAKE_CLAUDE_DELAY_MS: "300" }, async () => {
        await withHarness(async (h) => {
          // The second POST is another DIRECTORY: no 409, no 423 — the
          // registry's one-run rule is per project, and the lock is per
          // directory.
          const a = await h.request("POST", "/runs", h.control, { project: basename(one), switches: { OPENCODE_AUTO_AGENT: "claude" } })
          const b = await h.request("POST", "/runs", h.control, { project: basename(two), switches: { OPENCODE_AUTO_AGENT: "claude" } })
          expect(a.status).toBe(202)
          expect(b.status).toBe(202)
          const idA = ((await a.json()) as RunView).id
          const idB = ((await b.json()) as RunView).id
          await untilRunning(h, h.read, idA)
          await untilRunning(h, h.read, idB)
          // The concurrency witness: at this observation both are live
          // together (the per-turn delay stretches both past the point B
          // took its lock).
          const viewA = (await (await h.request("GET", `/runs/${idA}`, h.read)).json()) as RunView
          expect(viewA.live).toBe(true)
          const doneA = await untilTerminal(h, h.read, idA)
          const doneB = await untilTerminal(h, h.read, idB)
          expect(doneA.state).toBe("completed")
          expect(doneA.code).toBe(0)
          expect(doneB.state).toBe("completed")
          expect(doneB.code).toBe(0)
          expect(await Bun.file(join(one, "docs", TASK, "done.md")).exists()).toBe(true)
          expect(await Bun.file(join(two, "docs", TASK, "done.md")).exists()).toBe(true)
        }, [one, two])
      })
    } finally {
      await rm(one, { recursive: true, force: true })
      await rm(two, { recursive: true, force: true })
    }
  }, 300_000)

  test("a wide run carries no interactive channel: the 202 names the width, the interactive endpoint 409s, the worker's banner states the question semantics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-server-wide-"))
    try {
      await withHarness(async (h) => {
        // Width is served (plans/0162, the plans/0069 §6 item 5 reserved
        // call made): the empty directory's run fails fast, but every
        // surface statement around it is observable first.
        const res = await h.request("POST", "/runs", h.control, { project: dir, options: { maxSessions: 2 } })
        expect(res.status).toBe(202)
        const body = (await res.json()) as RunView & { note?: string }
        expect(body.note ?? "").toContain("width 2")
        // The client endpoint answers the no-channel rule loudly, before
        // any upgrade could hang on a socket nothing will speak on.
        const interactive = await h.request("GET", `/runs/${body.id}/interactive?token=${h.control}`)
        expect(interactive.status).toBe(409)
        expect(((await interactive.json()) as { error: string }).error).toContain("carries no interactive channel")
        const done = await untilTerminal(h, h.read, body.id)
        expect(done.state).toBe("failed") // the empty directory's own preflight exit 1
        // The worker's own banner names the width and the degradation path;
        // no transport banner exists for this run.
        expect(done.tail).toContain("🛣 width 2:")
        expect(done.tail).not.toContain("interactive transport:")
      }, [dir])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  test("the confinement launcher: every spawn rides `bash <script> <dir> -- <cmd...>`, exit codes propagate, running is still observed", async () => {
    const dir = await fixtureProject("auto-server-launch-")
    const empty = await mkdtemp(join(tmpdir(), "auto-server-launch-empty-"))
    const scratch = await mkdtemp(join(tmpdir(), "auto-server-launch-scratch-"))
    // A fake confinement launcher: record the project argument and the
    // worker command word, then exec the command — the generic contract
    // (`<dir> -- <cmd...>`, exit code the command's own).
    const marker = join(scratch, "invocations")
    const script = join(scratch, "launch.sh")
    await Bun.write(script, [`printf '%s\\n' "$1" >> ${JSON.stringify(marker)}`, `printf '%s\\n' "$3" >> ${JSON.stringify(marker)}`, `shift 2`, `exec "$@"`, ""].join("\n"))
    try {
      await withFakeAgent({}, async () => {
        await withHarness(async (h) => {
          // A failing run first: the empty directory's preflight exit 1 must
          // survive the launcher (exec propagates it verbatim).
          const fail = await h.request("POST", "/runs", h.control, { project: empty })
          expect(fail.status).toBe(202)
          const failed = await untilTerminal(h, h.read, ((await fail.json()) as RunView).id)
          expect(failed.state).toBe("failed")
          expect(failed.code).toBe(1)
          // A completing run through the launcher: the watcher still flips
          // starting → running (under a launcher it is the lock's freshness
          // — the holder's started at or past the run's spawn instant,
          // plans/0197 D6 — not the holder pid's match with the wrapper),
          // and the run's own exit 0 is the record's.
          const run = await h.request("POST", "/runs", h.control, { project: basename(dir), switches: { OPENCODE_AUTO_AGENT: "claude" } })
          expect(run.status).toBe(202)
          const id = ((await run.json()) as RunView).id
          await untilRunning(h, h.read, id)
          const done = await untilTerminal(h, h.read, id)
          expect(done.state).toBe("completed")
          expect(done.code).toBe(0)
          expect(await Bun.file(join(dir, "docs", TASK, "done.md")).exists()).toBe(true)
        }, [dir, empty], script)
      })
      // The launcher really wrapped both spawns: one line per invocation
      // pair — the project directory and the worker command word (the
      // interpreter that starts src/index.ts), two of each, in order.
      const lines = (await Bun.file(marker).text()).trim().split("\n")
      expect(lines.filter((line) => line === realpathSync(dir)).length).toBe(1)
      expect(lines.filter((line) => line === realpathSync(empty)).length).toBe(1)
      expect(lines.filter((line) => /\/bun$/.test(line)).length).toBe(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(empty, { recursive: true, force: true })
      await rm(scratch, { recursive: true, force: true })
    }
  }, 300_000)

  test("under a launcher, a stale lock does not flip the run to running: the flip needs the lock's freshness (plans/0197 D6)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-server-launch-stale-"))
    const scratch = await mkdtemp(join(tmpdir(), "auto-server-launch-stale-scratch-"))
    // A launcher that holds the worker back for two seconds: the window in
    // which the only lock in the directory is the stale one this test
    // plants (the pre-fix watcher flipped on its mere presence — 0165-219).
    const script = join(scratch, "launch.sh")
    await Bun.write(script, ["sleep 2", "shift 2", 'exec "$@"', ""].join("\n"))
    try {
      await withHarness(async (h) => {
        // A stale lock from a minute ago: a crashed run's leftover (its pid
        // is gone, its started predates this spawn).
        const dead = Bun.spawn(["sleep", "0"])
        await dead.exited
        await mkdir(join(dir, ".auto"), { recursive: true })
        await Bun.write(
          join(dir, ".auto", "run.lock"),
          `${JSON.stringify({ pid: dead.pid, host: hostname(), command: "run", started: new Date(Date.now() - 60_000).toISOString() })}\n`,
        )
        const started = await h.request("POST", "/runs", h.control, { project: basename(dir) })
        expect(started.status).toBe(202)
        const id = ((await started.json()) as RunView).id
        // Inside the launcher's sleep the only lock present is the stale
        // one: the state must stay `starting` (the freshness floor).
        const deadline = Date.now() + 1_500
        while (Date.now() < deadline) {
          const run = (await (await h.request("GET", `/runs/${id}`, h.read)).json()) as RunView
          expect(run.state).toBe("starting")
          await Bun.sleep(100)
        }
        // The real worker's own lock (fresh) then flips it, and the empty
        // directory's preflight settles the run failed (exit 1).
        const done = await untilTerminal(h, h.read, id)
        expect(done.state).toBe("failed")
        expect(done.code).toBe(1)
      }, [dir], script)
    } finally {
      await rm(dir, { recursive: true, force: true })
      await rm(scratch, { recursive: true, force: true })
    }
  }, 60_000)
})

// The spawn carriage and the request's trust boundaries (plans/0222, the
// 0165-054/171 findings): the per-run bridge secret never rides the worker's
// argv (world-readable through /proc/<pid>/cmdline — any local user and the
// run's own agent session read it there), and the switches carrier takes
// switches only.
describe("daemon: the bridge secret's carriage and the request's trust boundaries (plans/0222)", () => {
  test("a spawned worker's argv carries no oar_ token; the secret rides the spawn environment (0165-054's repro inverted)", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "auto-server-carriage-"))
    const dir = await mkdtemp(join(tmpdir(), "auto-server-carriage-run-"))
    // A stand-in worker: dumps its argv and the token's SHAPE in the
    // environment (a boolean — the value never lands in the dump either).
    const dump = join(dataDir, "worker-facts.json")
    const standIn = join(dataDir, "stand-in.ts")
    await Bun.write(
      standIn,
      [
        `const facts = { argv: process.argv, bridgeTokenInEnv: (process.env.OPENCODE_AUTO_BRIDGE_TOKEN ?? "").startsWith("oar_") }`,
        `await Bun.write(${JSON.stringify(dump)}, JSON.stringify(facts) + "\\n")`,
        `process.exit(0)`,
        ``,
      ].join("\n"),
    )
    const store = new DaemonStore(dataDir)
    store.register(dir)
    const control = store.issueToken("control", "controller").token
    const daemon = await startDaemon({ dataDir, port: 0, worker: { command: process.execPath, prefix: [standIn] } })
    try {
      const started = await fetch(`${daemon.url}/runs`, { method: "POST", headers: { authorization: `Bearer ${control}`, "content-type": "application/json" }, body: JSON.stringify({ project: dir }) })
      expect(started.status).toBe(202)
      const id = ((await started.json()) as RunView).id
      // The handle's own views (the control token cannot read the run — the
      // scope matrix's own rule).
      const deadline = Date.now() + 30_000
      for (;;) {
        const run = daemon.runs().find((view) => view.id === id)
        if (run && !run.live) break
        if (Date.now() > deadline) throw new Error("the stand-in run never settled")
        await Bun.sleep(100)
      }
      const facts = (await (await Bun.file(dump).json())) as { argv: string[]; bridgeTokenInEnv: boolean }
      // The pin (the finding's repro inverted): no part of the worker's
      // command line carries the credential — pre-fix, the payload's
      // transport held "token":"oar_…" right here.
      const cmdline = facts.argv.join(" ")
      expect(cmdline).not.toContain("oar_")
      // The request itself still rides argv (the payload carriage is the
      // daemon's own channel for it), and the credential moved to the spawn
      // environment with the oar_ shape — moved, not dropped.
      expect(cmdline).toContain(dir)
      expect(facts.bridgeTokenInEnv).toBe(true)
    } finally {
      await daemon.stop()
      await rm(dataDir, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  test("POST /runs refuses the env-only switch names and an off-host server URL as 400s ahead of project resolution (0165-171)", async () => {
    // Validation precedes the whitelist lookup (and the spawn): a control
    // token cannot name the operator registry layer's path or an arbitrary
    // agent endpoint — pre-fix both bodies sailed past validation (the
    // unregistered project then answered 404, the names themselves
    // accepted).
    await withHarness(async (h) => {
      const models = await h.request("POST", "/runs", h.control, { project: "never-registered", switches: { OPENCODE_AUTO_MODELS: "/tmp/anything.json" } })
      expect(models.status).toBe(400)
      expect(((await models.json()) as { error: string }).error).toContain("the operator registry layer's path")
      const serverSwitch = await h.request("POST", "/runs", h.control, { project: "never-registered", switches: { OPENCODE_AUTO_SERVER: "http://203.0.113.9:4096" } })
      expect(serverSwitch.status).toBe(400)
      expect(((await serverSwitch.json()) as { error: string }).error).toContain("the external agent server URL's env form")
      const serverOption = await h.request("POST", "/runs", h.control, { project: "never-registered", options: { server: "http://203.0.113.9:4096" } })
      expect(serverOption.status).toBe(400)
      const optionError = ((await serverOption.json()) as { error: string }).error
      expect(optionError).toContain("is not loopback")
      expect(optionError).toContain("confinement launcher")
      // The floor: a live switch name is accepted by the same validator (the
      // project resolution then answers, never the switch layer).
      const live = await h.request("POST", "/runs", h.control, { project: "never-registered", switches: { OPENCODE_AUTO_AGENT: "claude" } })
      expect(live.status).toBe(404)
    })
  })
})

describe("daemon: lock conflicts (the lock is the arbiter, CLI and daemon alike)", () => {
  test("a live holder answers 423 with the holder line; an unreadable lock counts live too", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-server-live-lock-"))
    // A holder that is genuinely alive and not this process (the core's
    // pid-reuse guard treats this process's own pid on an unheld lock as a
    // dead predecessor, by design — lock.ts stale()).
    const holderProc = Bun.spawn(["sleep", "30"])
    try {
      await withHarness(async (h) => {
        await plantLock(dir, { pid: holderProc.pid, command: "run" })
        const res = await h.request("POST", "/runs", h.control, { project: dir })
        expect(res.status).toBe(423)
        const body = (await res.json()) as { error: string; holder: { pid: number; host: string } }
        // The lockStatusLine text (auto-core src/lock.ts:95).
        expect(body.error).toContain("▶ run in progress")
        expect(body.error).toContain(`pid ${holderProc.pid} on ${hostname()}`)
        expect(body.holder?.pid).toBe(holderProc.pid)
        // A lock that cannot be read counts as live: same 423, its own line.
        await Bun.write(join(dir, ".auto", "run.lock"), "not json\n")
        const unreadable = await h.request("POST", "/runs", h.control, { project: dir })
        expect(unreadable.status).toBe(423)
        expect(((await unreadable.json()) as { error: string }).error).toContain("cannot be read")
      }, [dir])
    } finally {
      holderProc.kill()
      await holderProc.exited
      await rm(dir, { recursive: true, force: true })
    }
  }, 30_000)

  test("a stale lock does not block the spawn: the worker's own acquire performs the core's cleanup, and no lock survives", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-server-stale-lock-"))
    try {
      await withHarness(async (h) => {
        // A process that is already gone: its pid names a dead holder.
        const dead = Bun.spawn(["sleep", "0"])
        await dead.exited
        const lockPath = await plantLock(dir, { pid: dead.pid })
        const res = await h.request("POST", "/runs", h.control, { project: dir })
        expect(res.status).toBe(202)
        const done = await untilTerminal(h, h.read, ((await res.json()) as RunView).id)
        expect(done.state).toBe("failed") // the empty directory's own preflight exit 1
        // The stale lock was removed by the next acquirer (the worker's
        // runAll, auto-core src/lock.ts:47-56) and its own lock died with
        // it: the daemon never touched the file.
        expect(await Bun.file(lockPath).exists()).toBe(false)
      }, [dir])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  test("the second spawn on a directory the registry shows live is refused 409, retryable; the first run is untouched", async () => {
    const dir = await fixtureProject("auto-server-second-")
    try {
      await withFakeAgent({ FAKE_CLAUDE_DELAY_MS: "400" }, async () => {
        await withHarness(async (h) => {
          const first = await h.request("POST", "/runs", h.control, { project: basename(dir), switches: { OPENCODE_AUTO_AGENT: "claude" } })
          const id = ((await first.json()) as RunView).id
          await untilRunning(h, h.read, id)
          const second = await h.request("POST", "/runs", h.control, { project: basename(dir) })
          expect(second.status).toBe(409)
          const body = (await second.json()) as { error: string; run: { id: string }; retry: string }
          expect(body.error).toContain("already active")
          expect(body.run.id).toBe(id)
          expect(body.retry).toContain("terminal")
          // The first run was untouched and completes.
          const done = await untilTerminal(h, h.read, id, 180_000)
          expect(done.state).toBe("completed")
          expect(done.code).toBe(0)
          expect(await Bun.file(join(dir, "docs", TASK, "done.md")).exists()).toBe(true)
        }, [dir])
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 300_000)
})

// The CLI surface beside the daemon: the whitelist and the tokens are
// managed out-of-band (bootstrap-safe — no chicken-and-egg over HTTP), on
// the daemon's own data directory.
describe("daemon CLI: the whitelist and token management", () => {
  const ENV_BASE: Record<string, string | undefined> = scrubbedEnv()

  async function runCli(args: string[]) {
    const proc = Bun.spawn([process.execPath, join(PACKAGE_ROOT, "src", "index.ts"), ...args], {
      cwd: PACKAGE_ROOT,
      env: ENV_BASE,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    return { code: await proc.exited, out, err }
  }

  test("register/projects/unregister round-trip over the data directory", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "auto-server-cli-"))
    const dir = await mkdtemp(join(tmpdir(), "auto-server-cli-project-"))
    try {
      const registered = await runCli(["register", dir, "--data-dir", dataDir])
      expect(registered.code, registered.err).toBe(0)
      expect(registered.out).toContain(`✓ registered "${basename(dir)}" → ${realpathSync(dir)}`)
      expect(registered.out).toContain(`{ "project": "${basename(dir)}" }`)
      const listed = await runCli(["projects", "--data-dir", dataDir])
      expect(listed.code).toBe(0)
      expect(listed.out).toContain(realpathSync(dir))
      // A duplicate registration is refused.
      const dup = await runCli(["register", dir, "--data-dir", dataDir])
      expect(dup.code).toBe(1)
      expect(dup.err).toContain("already registered")
      // A directory that does not exist is refused.
      const missing = await runCli(["register", join(dataDir, "nope"), "--data-dir", dataDir])
      expect(missing.code).toBe(1)
      expect(missing.err).toContain("not a directory")
      const removed = await runCli(["unregister", basename(dir), "--data-dir", dataDir])
      expect(removed.code).toBe(0)
      expect((await runCli(["projects", "--data-dir", dataDir])).out).toContain("no registered projects")
    } finally {
      await rm(dataDir, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("token issue/list/revoke: the plaintext is shown once, the list carries name and scopes, the store keeps only digests", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "auto-server-tokens-"))
    try {
      const issued = await runCli(["token", "issue", "--scopes", "read,control", "--name", "web", "--data-dir", dataDir])
      expect(issued.code, issued.err).toBe(0)
      expect(issued.out).toContain('✓ token "web" issued with scopes: read, control')
      const token = issued.out.split("\n").find((line) => line.startsWith("oas_"))
      expect(token).toMatch(/^oas_[A-Za-z0-9_-]{43}$/)
      const listed = await runCli(["token", "list", "--data-dir", dataDir])
      expect(listed.out).toContain("web")
      expect(listed.out).toContain("read,control")
      // The stored file carries the digest, never the token itself.
      const stored = await Bun.file(join(dataDir, "tokens.json")).text()
      expect(stored).not.toContain(token!)
      expect(stored.match(/[0-9a-f]{64}/)).not.toBeNull()
      // Usage vocabulary: unknown scope, missing --scopes, duplicate name.
      const badScope = await runCli(["token", "issue", "--scopes", "read,nonsense", "--data-dir", dataDir])
      expect(badScope.code).toBe(1)
      expect(badScope.err).toContain('unknown scope "nonsense"')
      const noScopes = await runCli(["token", "issue", "--data-dir", dataDir])
      expect(noScopes.code).toBe(1)
      expect(noScopes.err).toContain("--scopes is required")
      const dup = await runCli(["token", "issue", "--scopes", "read", "--name", "web", "--data-dir", dataDir])
      expect(dup.code).toBe(1)
      expect(dup.err).toContain("already exists")
      const revoked = await runCli(["token", "revoke", "web", "--data-dir", dataDir])
      expect(revoked.code).toBe(0)
      expect((await runCli(["token", "list", "--data-dir", dataDir])).out).toContain("no tokens")
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test("the unnamed token fallback is the first free token-N, never a collided name (plans/0197 D3)", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "auto-server-fallback-"))
    try {
      const store = new DaemonStore(dataDir)
      // The floor: an unnamed issue on an empty store is token-1, the next
      // token-2 (the base both the old length-based number and the first-
      // free derivation agree on).
      expect(store.issueToken("read").stored.name).toBe("token-1")
      expect(store.issueToken("read").stored.name).toBe("token-2")
      // A revoke frees the slot: the next unnamed issue takes token-1
      // again. The length-based number computed token-2 (length 1 + 1) and
      // the issue was refused "already exists" — a confusing refusal
      // answering an act the operator could not know was wrong.
      store.revokeToken("token-1")
      expect(store.issueToken("read").stored.name).toBe("token-1")
      // A user-named token occupies its slot by name too: with token-1,
      // token-2 and a named token-4 stored, the first free is token-3 (the
      // length-based number computed token-4 and collided).
      store.issueToken("read", "token-4")
      expect(store.issueToken("read").stored.name).toBe("token-3")
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test("serve refuses bad flags; unknown commands keep the usage refusal", async () => {
    expect((await runCli(["serve", "--port", "abc"])).code).toBe(1)
    expect((await runCli(["serve", "--nope"])).code).toBe(1)
    // The port is bounded at the flag (plans/0197 D5): an out-of-range
    // value is a usage refusal naming the range — never Bun.serve's own
    // throw past the flag loop.
    for (const bad of ["65536", "99999"]) {
      const port = await runCli(["serve", "--port", bad])
      expect(port.code, port.out).toBe(1)
      expect(port.err).toContain("--port takes the TCP port to listen on: an integer 0..65535")
    }
    const unknown = await runCli(["daemon"])
    expect(unknown.code).toBe(1)
    expect(unknown.err).toContain("usage:")
  })

  test("serve smoke: the daemon subprocess serves /health on its assigned port and gates /runs", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "auto-server-serve-"))
    const proc = Bun.spawn([process.execPath, join(PACKAGE_ROOT, "src", "index.ts"), "serve", "--port", "0", "--data-dir", dataDir], {
      cwd: PACKAGE_ROOT,
      env: ENV_BASE,
      stdout: "pipe",
      stderr: "pipe",
    })
    try {
      // The first startup line names the URL (port 0 = assigned).
      const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()
      const decoder = new TextDecoder()
      let seen = ""
      while (!/serving on http:\/\/[^\s]+/.test(seen)) {
        const { done, value } = await reader.read()
        if (done) throw new Error(`the serve process exited before its startup line: ${seen}`)
        seen += decoder.decode(value, { stream: true })
      }
      const url = /serving on (http:\/\/[^\s]+)/.exec(seen)![1]!
      const health = await fetch(`${url}/health`)
      expect(health.status).toBe(200)
      expect(((await health.json()) as { ok: boolean }).ok).toBe(true)
      // No token on /runs: the auth gate is up in the subprocess too.
      expect((await fetch(`${url}/runs`)).status).toBe(401)
      reader.cancel()
    } finally {
      proc.kill("SIGTERM")
      await proc.exited
      await rm(dataDir, { recursive: true, force: true })
    }
  }, 30_000)
})

// Isolation of the daemon's own bookkeeping from the projects: the store
// files never appear inside a target directory, and the daemon writes
// nothing into the project's .auto/ (its only .auto/ access is reading the
// lock to observe the run state).
describe("daemon: the store stays outside the projects", () => {
  test("the data directory holds the whitelist and the tokens; the registered project is left exactly as it was", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "auto-server-isolate-"))
    const dir = await mkdtemp(join(tmpdir(), "auto-server-isolate-project-"))
    try {
      const store = new DaemonStore(dataDir)
      store.register(dir)
      store.issueToken("read", "probe")
      expect(await Bun.file(join(dataDir, "projects.json")).exists()).toBe(true)
      expect(await Bun.file(join(dataDir, "tokens.json")).exists()).toBe(true)
      // realpathSync in register reads the directory; nothing is written
      // into it.
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dataDir, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the default data directory follows the XDG convention beside the operator model registry", () => {
    const home = "/home/whoever"
    expect(defaultDataDir({ XDG_CONFIG_HOME: "/xdg" }, home)).toBe(join("/xdg", "opencode-auto", "server"))
    expect(defaultDataDir({ XDG_CONFIG_HOME: "relative" }, home)).toBe(join(home, ".config", "opencode-auto", "server"))
    expect(defaultDataDir({}, home)).toBe(join(home, ".config", "opencode-auto", "server"))
  })
})

// The spawn boundary's failure shapes (plans/0223, the 0165-055/169/172
// findings): a spawn that throws settles its record and answers a named 500
// (never the `starting` wedge that 409-locked the project forever with a
// DELETE that lied), the URLs this daemon hands out format the bound host
// for a URL (an IPv6 literal bracketed, a wildcard named by its loopback —
// pre-fix the daemon wrote a transport its own worker validator refused),
// and an oversized request is a 400 before anything is registered (the
// carriage bound — the spawn rides one argv token under the kernel's
// 128 KiB per-string cap).
describe("daemon: the spawn boundary's failure shapes (plans/0223)", () => {
  test("a throwing spawn (ENOENT) settles the run failed with the cause, answers a named 500, and never wedges the project (0165-055)", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "auto-server-spawnthrow-"))
    const dir = await mkdtemp(join(tmpdir(), "auto-server-spawnthrow-run-"))
    // A worker command that does not exist: Bun.spawn throws ENOENT
    // synchronously — the finding's second throw class (a missing bash
    // under --launch lands here too, one argv element earlier).
    const store = new DaemonStore(dataDir)
    store.register(dir)
    const control = store.issueToken("control", "controller").token
    const read = store.issueToken("read", "reader").token
    const daemon = await startDaemon({ dataDir, port: 0, worker: { command: join(dataDir, "no-such-worker-binary"), prefix: [] } })
    const request = (method: string, path: string, token: string = control, body?: unknown) =>
      fetch(`${daemon.url}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) })
    try {
      // Pre-fix: Bun's generic 500 (a non-JSON "Something went wrong!")
      // over a run registered `starting` with no process behind it.
      const started = await request("POST", "/runs", control, { project: basename(dir) })
      expect(started.status).toBe(500)
      const body = (await started.json()) as { error: string; run: RunView }
      expect(body.error).toContain("the worker process could not be spawned for run run-000001")
      expect(body.error).toMatch(/enoent/i)
      expect(body.run.state).toBe("failed")
      expect(body.run.live).toBe(false)
      expect(body.run.code).toBe(null)
      // The record is observable in its settled shape, the cause in the tail.
      const view = (await (await request("GET", "/runs/run-000001", read)).json()) as RunView
      expect(view.state).toBe("failed")
      expect(view.live).toBe(false)
      expect(view.tail).toContain("the worker process could not be spawned")
      // The wedge's own assertion: the project accepts another spawn attempt
      // (pre-fix every later POST answered the 409 whose remedy could not
      // come), and the DELETE answers 409 already-terminal (pre-fix: a 202
      // "kill requested" over a record with no process, nothing changing).
      const again = await request("POST", "/runs", control, { project: basename(dir) })
      expect(again.status).toBe(500)
      expect(((await again.json()) as { error: string }).error).toContain("run run-000002")
      const killed = await request("DELETE", "/runs/run-000001", control)
      expect(killed.status).toBe(409)
      expect(((await killed.json()) as { error: string }).error).toContain("already terminal")
    } finally {
      await daemon.stop()
      await rm(dataDir, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  test("an oversized request is a 400 naming the carriage bound, and nothing is registered (0165-055's E2BIG class)", async () => {
    await withHarness(async (h) => {
      // A 70 KB switch value through a live switch name: validation passes
      // (the name is known, the value a string), and the serialized payload
      // passes the kernel's per-string cap on the way IN — the bound is what
      // refuses it, before any registry entry exists. Pre-fix this POST was
      // the finding's verbatim scene: the spawn threw E2BIG, the answer a
      // generic 500, the run wedged `starting`. The bound sits at startRun —
      // after the whitelist — so the project must be registered.
      const dir = await mkdtemp(join(tmpdir(), "auto-server-bound-"))
      try {
        await withHarness(
          async (h) => {
            const started = await h.request("POST", "/runs", h.control, { project: basename(dir), switches: { OPENCODE_AUTO_STUCK: "x".repeat(70_000) } })
            expect(started.status).toBe(400)
            const error = ((await started.json()) as { error: string }).error
            expect(error).toContain("over the 65536-byte spawn carriage")
            expect(error).toContain("128 KiB")
            expect(error).toContain("plan -p")
            // No run exists for the refused request — the registry stays empty
            // (pre-fix: one wedged `starting` run).
            const runs = (await (await h.request("GET", "/runs", h.read)).json()) as { runs: RunView[] }
            expect(runs.runs).toEqual([])
          },
          [dir],
        )
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })
  })

  test("an IPv6 bind writes a bracketed transport URL the worker's own validator accepts (0165-169)", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "auto-server-ipv6-"))
    const dir = await mkdtemp(join(tmpdir(), "auto-server-ipv6-run-"))
    // The stand-in dumps the payload token it received; the transport inside
    // is what the daemon wrote, and parseTransport (the worker's shared
    // validator) is what refused the pre-fix URL.
    const dump = join(dataDir, "worker-facts.json")
    const standIn = join(dataDir, "stand-in.ts")
    await Bun.write(
      standIn,
      [
        `const payload = process.argv.slice(2).find((token) => token.startsWith("{"))`,
        `await Bun.write(${JSON.stringify(dump)}, JSON.stringify({ payload }) + "\\n")`,
        `process.exit(0)`,
        ``,
      ].join("\n"),
    )
    const store = new DaemonStore(dataDir)
    store.register(dir)
    const control = store.issueToken("control", "controller").token
    const daemon = await startDaemon({ dataDir, port: 0, hostname: "::1", worker: { command: process.execPath, prefix: [standIn] } })
    try {
      // The handle's own URL formats the literal too (pre-fix:
      // http://::1:<port> — the serve banner printed it that way).
      expect(daemon.url).toBe(`http://[::1]:${daemon.port}`)
      const started = await fetch(`${daemon.url}/runs`, { method: "POST", headers: { authorization: `Bearer ${control}`, "content-type": "application/json" }, body: JSON.stringify({ project: basename(dir) }) })
      expect(started.status).toBe(202)
      const id = ((await started.json()) as RunView).id
      const deadline = Date.now() + 30_000
      for (;;) {
        const run = daemon.runs().find((view) => view.id === id)
        if (run && !run.live) break
        if (Date.now() > deadline) throw new Error("the stand-in run never settled")
        await Bun.sleep(100)
      }
      const facts = (await (await Bun.file(dump).json())) as { payload: string }
      const transport = (JSON.parse(facts.payload) as { transport: { run: string; url: string } }).transport
      // The pin: the URL is bracketed and the worker's own validator accepts
      // it — pre-fix the transport held ws://::1:<port>/… and parseTransport
      // refused exactly it (the finding's observed verbatim).
      expect(transport.url).toBe(`ws://[::1]:${daemon.port}/runs/${id}/worker`)
      expect(parseTransport(transport)).toEqual({ run: id, url: transport.url })
    } finally {
      await daemon.stop()
      await rm(dataDir, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  test("connectHost brackets IPv6 literals and names the wildcard binds by their loopback (the D2 unit)", () => {
    expect(connectHost("127.0.0.1")).toBe("127.0.0.1")
    expect(connectHost("localhost")).toBe("localhost")
    expect(connectHost("::1")).toBe("[::1]")
    expect(connectHost("::")).toBe("[::1]")
    expect(connectHost("0.0.0.0")).toBe("127.0.0.1")
    expect(connectHost("[::1]")).toBe("[::1]")
  })
})

// The registry's end of life (plans/0224, the 0165-168/170 findings): a
// daemon process outlives its runs, and everything it holds for a run must
// answer when the run's own evidence ends — the journal-reconstructed stub
// retires on the lock's evidence (at replay and at DELETE, never returning at
// every restart forever), the hub dies with its run (the per-run secret's
// lifetime is the run's non-terminal life exactly — a terminal run's bridge
// no longer upgrades, a forged raise is refused instead of journaled), and
// terminal records evict past a count.
describe("daemon: the registry's end of life (plans/0224)", () => {
  const SEED_SECRET = "oar_seed0000000000000000000000000000000000000000"
  const ASK = "enter your answer (Enter to confirm, no timeout and no automatic answer under plan): "

  // The previous daemon life, as the daemon itself journals it (the
  // question-queue suite's seed shape): one run, one ask still open.
  function seed(dataDir: string, directory: string, run = "run-000007"): void {
    const opened: JournalEvent = {
      v: 1,
      at: new Date().toISOString(),
      run,
      event: "opened",
      project: "proj",
      directory,
      secret: SEED_SECRET,
      started: new Date().toISOString(),
      request: { options: {}, switches: {} },
    }
    appendJournal(dataDir, opened)
    appendJournal(dataDir, { v: 1, at: new Date().toISOString(), run, event: "raised", id: "q1", text: ASK })
  }

  // A live lock planted the way the core writes it (a genuinely-live holder
  // that is not this process — the core's pid-reuse guard treats this
  // process's own pid on an unheld lock as a dead predecessor).
  async function plantLiveLock(dir: string, pid: number): Promise<void> {
    const record = { pid, host: hostname(), command: "run", started: new Date().toISOString() }
    await mkdir(join(dir, ".auto"), { recursive: true })
    await Bun.write(join(dir, ".auto", "run.lock"), `${JSON.stringify(record)}\n`)
  }

  test("a journal-pending run whose directory holds no live lock retires at the first replay — the finding's three-restart probe inverted (0165-168)", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "auto-server-retire-"))
    // The finding's shape: a directory whose worker is long gone (here: a
    // path that never existed — no lock, no process can ever reconnect).
    seed(dataDir, join(dataDir, "gone"))
    try {
      const read = new DaemonStore(dataDir).issueToken("read", "reader").token
      for (let cycle = 1; cycle <= 3; cycle++) {
        const daemon = await startDaemon({ dataDir, port: 0 })
        try {
          const listed = (await (await fetch(`${daemon.url}/runs`, { headers: { authorization: `Bearer ${read}` } })).json()) as { runs: unknown[] }
          expect(listed.runs).toEqual([])
          expect((await fetch(`${daemon.url}/runs/run-000007`, { headers: { authorization: `Bearer ${read}` } })).status).toBe(404)
          // The retire's closed settles were appended (durable), and the
          // start's own compaction folded them away — the journal is the
          // empty pending set, so no later restart can rebuild the stub.
          expect(await Bun.file(journalPath(dataDir)).text()).toBe("")
        } finally {
          await daemon.stop()
        }
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  }, 30_000)

  test("DELETE on a restored run: the live-lock floor replays byte-identically and 409s with the taught retire; the lock gone stale makes the DELETE the retire (0165-168)", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "auto-server-delete-retire-"))
    const seededDir = await mkdtemp(join(tmpdir(), "auto-server-delete-retire-dir-"))
    const holder = Bun.spawn(["sleep", "60"])
    await plantLiveLock(seededDir, holder.pid)
    seed(dataDir, seededDir, "run-000001")
    try {
      const store = new DaemonStore(dataDir)
      const answer = store.issueToken("answer", "answerer").token
      const read = store.issueToken("read", "reader").token
      const control = store.issueToken("control", "controller").token
      const daemon = await startDaemon({ dataDir, port: 0 })
      try {
        // The floor (the P3c replay path byte-identical under a live lock):
        // the stub reads `restored` and a client is replayed the question.
        const view = (await (await fetch(`${daemon.url}/runs/run-000001`, { headers: { authorization: `Bearer ${read}` } })).json()) as { state: string; live: boolean }
        expect(view).toMatchObject({ state: "restored", live: false })
        const client = wsClient(`${daemon.url.replace("http", "ws")}/runs/run-000001/interactive?token=${answer}`)
        try {
          const hello = await client.nextOf((frame) => frame.type === "hello", "the restored hello")
          expect(hello).toMatchObject({ type: "hello", run: "run-000001", state: "restored" })
          const replayed = await client.nextOf((frame) => frame.type === "question" && frame.id === "q1", "the journal replay")
          expect(replayed).toMatchObject({ type: "question", id: "q1", text: ASK })
        } finally {
          await client.close().catch(() => {})
        }
        // Under the live lock the DELETE keeps today's 409, its hint now
        // teaching the real path (the finding's old hint sent the person to
        // delete .auto/run.lock by hand — a remedy touching nothing the
        // daemon views).
        const refused = await fetch(`${daemon.url}/runs/run-000001`, { method: "DELETE", headers: { authorization: `Bearer ${control}` } })
        expect(refused.status).toBe(409)
        const body = (await refused.json()) as { error: string; hint: string; holder: { pid: number } }
        expect(body.error).toContain("not this daemon's child")
        expect(body.hint).toContain("this same DELETE retires the restored view")
        expect(body.holder?.pid).toBe(holder.pid)
        // The lock goes stale (the holder dies): the delete IS the retire —
        // 200 with the retired view and its note, the question settled
        // closed in the journal, the registry entry gone.
        holder.kill()
        await holder.exited
        const retired = await fetch(`${daemon.url}/runs/run-000001`, { method: "DELETE", headers: { authorization: `Bearer ${control}` } })
        expect(retired.status).toBe(200)
        const retiredBody = (await retired.json()) as { state: string; note: string }
        expect(retiredBody.state).toBe("restored")
        expect(retiredBody.note).toContain("retired by this delete")
        const journal = await Bun.file(journalPath(dataDir)).text()
        expect(journal).toContain('"event":"settled"')
        expect(journal).toContain('"how":"closed"')
        expect((await fetch(`${daemon.url}/runs/run-000001`, { headers: { authorization: `Bearer ${read}` } })).status).toBe(404)
        const listed = (await (await fetch(`${daemon.url}/runs`, { headers: { authorization: `Bearer ${read}` } })).json()) as { runs: unknown[] }
        expect(listed.runs).toEqual([])
        // A restart restores nothing: the pending set is empty.
        await daemon.stop()
        const restarted = await startDaemon({ dataDir, port: 0 })
        try {
          const again = (await (await fetch(`${restarted.url}/runs`, { headers: { authorization: `Bearer ${read}` } })).json()) as { runs: unknown[] }
          expect(again.runs).toEqual([])
        } finally {
          await restarted.stop()
        }
      } catch (error) {
        holder.kill()
        throw error
      } finally {
        await daemon.stop().catch(() => {})
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true })
      await rm(seededDir, { recursive: true, force: true })
    }
  }, 30_000)

  test("the hub dies with its run: a settled run's bridge secret no longer upgrades, the interactive endpoint answers the terminal 409, and a forged raise is refused (0165-170)", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "auto-server-hubdeath-"))
    const dir = await mkdtemp(join(tmpdir(), "auto-server-hubdeath-run-"))
    // A stand-in worker that outlives the bridge probe and exits cleanly:
    // the run is real (registry entry, hub, journal), its exit is observed,
    // and no real worker ever competes for the bridge latch.
    const standIn = join(dataDir, "stand-in.ts")
    await Bun.write(standIn, [`await Bun.sleep(4000)`, `process.exit(0)`, ``].join("\n"))
    const store = new DaemonStore(dataDir)
    store.register(dir)
    const control = store.issueToken("control", "controller").token
    const read = store.issueToken("read", "reader").token
    const daemon = await startDaemon({ dataDir, port: 0, worker: { command: process.execPath, prefix: [standIn] } })
    try {
      const started = await fetch(`${daemon.url}/runs`, { method: "POST", headers: { authorization: `Bearer ${control}`, "content-type": "application/json" }, body: JSON.stringify({ project: basename(dir) }) })
      expect(started.status).toBe(202)
      const id = ((await started.json()) as RunView).id
      // The per-run secret is the journal's own `opened` record (0600, the
      // daemon's data directory).
      const secret = (JSON.parse((await Bun.file(journalPath(dataDir)).text()).split("\n").find((line) => line.includes('"event":"opened"'))!) as { secret: string }).secret
      // While the run is live the secret works: this probe IS the bridge
      // (the stand-in never connects one), hello answers it.
      const bridge = wsClient(`${daemon.url.replace("http", "ws")}/runs/${id}/worker?token=${secret}`)
      try {
        const hello = await bridge.nextOf((frame) => frame.type === "hello", "the bridge hello")
        expect(hello).toMatchObject({ type: "hello", run: id, worker: true })
        // The run settles (the stand-in's exit 0 → completed).
        const deadline = Date.now() + 30_000
        for (;;) {
          const run = daemon.runs().find((view) => view.id === id)
          if (run && !run.live) break
          if (Date.now() > deadline) throw new Error("the stand-in run never settled")
          await Bun.sleep(100)
        }
        expect(daemon.runs().find((view) => view.id === id)!.state).toBe("completed")
        // The forged-raise scene refused: the still-open bridge socket
        // sends a question frame on the dead run — the hub is gone, so the
        // frame is refused by name and nothing is journaled (pre-fix the
        // raise was journaled and resurrected the run as `restored` at the
        // next restart).
        bridge.send({ type: "question", id: "forged-1", text: "a forged raise on a dead run" })
        const refused = await bridge.nextOf((frame) => frame.type === "error", "the forged raise refused")
        if (refused.type === "error") expect(refused.message).toContain("not in this daemon's registry")
        const journal = await Bun.file(journalPath(dataDir)).text()
        expect(journal).not.toContain('"event":"raised"')
        expect(journal).not.toContain("forged-1")
      } finally {
        await bridge.close().catch(() => {})
      }
      // The worker route answers the same 401 the unknown secret always
      // did — the secret that worked moments before, auth indistinguishable.
      const deadBridge = await fetch(`${daemon.url}/runs/${id}/worker?token=${secret}`)
      expect(deadBridge.status).toBe(401)
      expect(((await deadBridge.json()) as { error: string }).error).toContain("unknown run secret")
      // The interactive client endpoint states the close plainly.
      const deadClient = await fetch(`${daemon.url}/runs/${id}/interactive?token=${control}`)
      expect(deadClient.status).toBe(409)
      expect(((await deadClient.json()) as { error: string }).error).toContain("the interactive channel closed with the run")
      // The registry entry itself is observable as terminal history.
      expect((await fetch(`${daemon.url}/runs/${id}`, { headers: { authorization: `Bearer ${read}` } })).status).toBe(200)
    } finally {
      await daemon.stop()
      await rm(dataDir, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)

  test("evictTerminalRuns keeps the newest 50 terminal records by insertion order with their hubs; live and restored never count (the D2 unit)", () => {
    const runs = new Map<string, { state: string }>()
    const hubs = new Map<string, unknown>()
    // 55 terminal records in start order, then a live and a restored run.
    for (let i = 1; i <= 55; i++) {
      runs.set(`t-${String(i).padStart(2, "0")}`, { state: i % 2 === 0 ? "completed" : "failed" })
      hubs.set(`t-${String(i).padStart(2, "0")}`, { secret: `s${i}` })
    }
    runs.set("live-1", { state: "running" })
    hubs.set("live-1", { secret: "live" })
    runs.set("restored-1", { state: "restored" })
    hubs.set("restored-1", { secret: "restored" })
    evictTerminalRuns(runs, hubs)
    expect([...runs.keys()]).toEqual([...Array.from({ length: 50 }, (_, i) => `t-${String(i + 6).padStart(2, "0")}`), "live-1", "restored-1"])
    expect(hubs.has("t-05")).toBe(false)
    expect(hubs.has("t-06")).toBe(true)
    expect(runs.get("live-1")).toEqual({ state: "running" })
    expect(runs.get("restored-1")).toEqual({ state: "restored" })
    // Under the bound nothing is removed.
    const small = new Map<string, { state: string }>(Array.from({ length: MAX_TERMINAL_RUNS }, (_, i) => [`t-${i}`, { state: "blocked" }]))
    const smallHubs = new Map<string, unknown>([...small.keys()].map((id) => [id, {}]))
    evictTerminalRuns(small, smallHubs)
    expect(small.size).toBe(MAX_TERMINAL_RUNS)
    expect(smallHubs.size).toBe(MAX_TERMINAL_RUNS)
  })
})
