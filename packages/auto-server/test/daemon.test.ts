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
import { startDaemon, terminalOf, type DaemonHandle } from "../src/daemon"
import { DaemonStore, defaultDataDir } from "../src/store"
import { fakeAgent, fixtureProject, scrubbedEnv, TASK } from "./fixtures/project"

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
// issued up front (the same store the CLI commands write).
async function withHarness(fn: (h: Harness) => Promise<void>, register: string[] = []): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "auto-server-data-"))
  const store = new DaemonStore(dataDir)
  for (const dir of register) store.register(dir)
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
        // The shared option vocabulary answers here too (a 400, not a run
        // that dies on arrival).
        const badOption = await h.request("POST", "/runs", h.control, { project: dir, options: { maxSessions: 2 } })
        expect(badOption.status).toBe(400)
        expect(((await badOption.json()) as { error: string }).error).toContain("concurrent execution is not supported yet")
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

  test("serve refuses bad flags; unknown commands keep the usage refusal", async () => {
    expect((await runCli(["serve", "--port", "abc"])).code).toBe(1)
    expect((await runCli(["serve", "--nope"])).code).toBe(1)
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
