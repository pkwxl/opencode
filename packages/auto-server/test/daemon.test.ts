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
import { existsSync, realpathSync, statSync } from "node:fs"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { basename, join } from "node:path"
import { hostname, tmpdir } from "node:os"
import { connectHost, evictTerminalRuns, MAX_TERMINAL_RUNS, startDaemon, terminalOf, type DaemonHandle } from "../src/daemon"
import { parseTransport } from "../src/request"
import { DaemonStore, defaultDataDir } from "../src/store"
import { fakeAgent, fixtureProject, scrubbedEnv, TASK } from "./fixtures/project"
import { wsClient } from "./fixtures/ws"

const PACKAGE_ROOT = join(import.meta.dir, "..")

// The daemon spawns worker children from its own environment (this test
// process): no ambient OPENCODE_AUTO_* reaches a worker (the daemon itself
// scrubs the layer off its spawns; every fixture run selects its agent
// through the request's switches instead) and no operator model registry is
// read — the package preload (test/preload.ts, plans/0232 D1) keeps this
// process's XDG_CONFIG_HOME at an empty temp, which the daemon's spawns keep.

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

describe("daemon: token auth (the scope matrix)", () => {
  test("health is open; every other route wants a known bearer token", async () => {
    await withHarness(async (h) => {
      // The one unauthenticated route: liveness only — and 0293's identity
      // witness rides it: `line`, the daemon's own resolution captured at
      // its start, beside `checkout`, the tool tree's live state read now.
      // The two agree while nothing has moved under the daemon (this
      // harness starts and reads inside one unchanged checkout); a
      // divergence is the source-mode staleness window, its remedy the
      // restart. From source both name the tool tree's own commit (plus
      // dirt), never a fabricated sha.
      const health = await h.request("GET", "/health")
      expect(health.status).toBe(200)
      const body = (await health.json()) as { ok: boolean; line: string; checkout: string }
      expect(body.ok).toBe(true)
      expect(body.line).toMatch(/^[0-9a-f]{7,40}(\+dirty)?$/)
      expect(body.checkout).toBe(body.line)
      // Missing header, a non-bearer header, and an unknown token are each
      // 401 — the token is the gate, not a hint. Auth precedes parsing.
      expect((await h.request("GET", "/runs")).status).toBe(401)
      const odd = await h.request("GET", "/runs", "not-a-bearer-token")
      expect(odd.status).toBe(401)
      const unknown = await h.request("GET", "/runs", "oas_nobodyknows")
      expect(unknown.status).toBe(401)
      expect(((await unknown.json()) as { error: string }).error).toContain("unknown token")
      // POST /runs is retired (plans/0282): the route answers 404 — the
      // executor route is the only run starter.
      expect((await h.request("POST", "/runs", "oas_nobodyknows")).status).toBe(404)
      // No other route exists.
      expect((await h.request("GET", "/nope", h.read)).status).toBe(404)
    })
  })
})

describe("daemon: the whitelist is absolute", () => {
})

describe("daemon: lock conflicts (the lock is the arbiter, CLI and daemon alike)", () => {

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

  test("token issue --out: the credential direct to a fresh 0600 file, stdout carrying the status lines alone (plans/0268)", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "auto-server-token-out-"))
    try {
      const out = join(dataDir, "web.token")
      const issued = await runCli(["token", "issue", "--scopes", "read,control", "--name", "web", "--out", out, "--data-dir", dataDir])
      expect(issued.code, issued.err).toBe(0)
      // stdout is exactly the two status lines — the credential never
      // among them, so a transcript, log or captured pipe cannot grab it
      // and no script must pick a line out of the mix (0264-06's shape).
      expect(issued.out).toBe(`✓ token "web" issued with scopes: read, control\nthe token is shown once; the store (${join(dataDir, "tokens.json")}) keeps only its digest\n`)
      // The file carries exactly the credential bytes and the newline the
      // shown-once line itself would terminate — nothing else (no wrapper
      // to make every consumer parse), and the store verifies those very
      // bytes as the minted token.
      const text = await Bun.file(out).text()
      expect(text).toMatch(/^oas_[A-Za-z0-9_-]{43}\n$/)
      expect(new DaemonStore(dataDir).verifyToken(text.trim())).toEqual(["read", "control"])
      expect(statSync(out).mode & 0o777, "the credential file is 0600").toBe(0o600)
      // The floor (P10): without --out the same mint prints the credential
      // between the two status lines, byte-identical to the pre-0268 mix.
      const shown = await runCli(["token", "issue", "--scopes", "read", "--name", "shown", "--data-dir", dataDir])
      expect(shown.code, shown.err).toBe(0)
      const lines = shown.out.split("\n")
      expect(lines[0]).toBe('✓ token "shown" issued with scopes: read')
      expect(lines[1]).toMatch(/^oas_[A-Za-z0-9_-]{43}$/)
      expect(lines[2]).toBe(`the token is shown once; the store (${join(dataDir, "tokens.json")}) keeps only its digest`)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test("token issue --out refusals: missing parent, unwritable parent, existing target — the credential never printed, nothing orphaned (plans/0268)", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "auto-server-token-out-refuse-"))
    try {
      // A missing parent is refused naming the directory and teaching that
      // the flag never creates it — and nothing is minted (the pre-flight
      // precedes the store's write, so no orphan digest either).
      const missing = await runCli(["token", "issue", "--scopes", "read", "--out", join(dataDir, "no-such-dir", "t.token"), "--data-dir", dataDir])
      expect(missing.code).toBe(1)
      expect(missing.err).toContain(join(dataDir, "no-such-dir"))
      expect(missing.err).toContain("never creates directories")
      expect(missing.out).not.toMatch(/^oas_/)
      expect((await runCli(["token", "list", "--data-dir", dataDir])).out).toContain("no tokens")
      // A parent that is not a directory (a file in the path) and one that
      // is not writable: both refused naming the location.
      const blocker = join(dataDir, "blocker")
      await Bun.write(blocker, "not a directory\n")
      const notDir = await runCli(["token", "issue", "--scopes", "read", "--out", join(blocker, "t.token"), "--data-dir", dataDir])
      expect(notDir.code).toBe(1)
      expect(notDir.err).toContain("is not a directory")
      expect(notDir.out).not.toMatch(/^oas_/)
      const roDir = join(dataDir, "ro")
      await mkdir(roDir, { mode: 0o500 })
      const ro = await runCli(["token", "issue", "--scopes", "read", "--out", join(roDir, "t.token"), "--data-dir", dataDir])
      expect(ro.code).toBe(1)
      expect(ro.err).toContain(roDir)
      expect(ro.err).toContain("not writable")
      expect(ro.out).not.toMatch(/^oas_/)
      expect(existsSync(join(roDir, "t.token"))).toBe(false)
      // An existing target is never clobbered — the bytes survive, the
      // credential never printed.
      const existing = join(dataDir, "existing.token")
      await Bun.write(existing, "precious\n")
      const clash = await runCli(["token", "issue", "--scopes", "read", "--out", existing, "--data-dir", dataDir])
      expect(clash.code).toBe(1)
      expect(clash.err).toContain("refuses to overwrite")
      expect(clash.err).toContain(existing)
      expect(await Bun.file(existing).text()).toBe("precious\n")
      expect(clash.out).not.toMatch(/^oas_/)
      // A mint refusal under a valid --out leaves no empty file behind
      // (the exclusive write follows the mint, never precedes it).
      const fresh = join(dataDir, "fresh.token")
      const badScope = await runCli(["token", "issue", "--scopes", "read,nonsense", "--out", fresh, "--data-dir", dataDir])
      expect(badScope.code).toBe(1)
      expect(badScope.err).toContain('unknown scope "nonsense"')
      expect(existsSync(fresh)).toBe(false)
      // The valueless flag is the usage teaching.
      const valueless = await runCli(["token", "issue", "--scopes", "read", "--out", "--data-dir", dataDir])
      expect(valueless.code).toBe(1)
      expect(valueless.err).toContain("--out takes a file path")
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
      // The banner's identity half (0270, its source-mode line widened
      // 0293): the parenthetical names the resolved line — a stamped build
      // its commit, a source subprocess the tool tree's own commit plus
      // dirt, `dev` alone when git cannot name the tree.
      expect(/\(build (?:[0-9a-f]{7,40}(?:\+dirty)?|dev)\)/.test(seen)).toBe(true)
      const health = await fetch(`${url}/health`)
      expect(health.status).toBe(200)
      const body = (await health.json()) as { ok: boolean; line: string; checkout: string }
      expect(body.ok).toBe(true)
      expect(body.line).toMatch(/^[0-9a-f]{7,40}(\+dirty)?$/)
      expect(body.checkout).toBe(body.line)
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
})

// The registry's end of life (plans/0224, the 0165-168/170 findings): a
// daemon process outlives its runs, and everything it holds for a run must
// answer when the run's own evidence ends — the journal-reconstructed stub
// retires on the lock's evidence (at replay and at DELETE, never returning at
// every restart forever), the hub dies with its run (the per-run secret's
// lifetime is the run's non-terminal life exactly — a terminal run's bridge
// no longer upgrades, a forged raise is refused instead of journaled), and
// terminal records evict past a count.

// The lifecycle's removal conditions (plans/0284): the store's own
// live-refusal — the shared condition the DELETE route and the CLI's
// unregister both meet — holds the entry beside a run lock this daemon did
// not spawn (another host's or a hand-run process), teaching the stop; the
// route answers 404 for the unknown name; past both the entry goes.
describe("the project lifecycle over REST (plans/0284)", () => {
  test("DELETE /projects/<project>: the store's live-lock refusal teaches the stop; 404 for the unknown; the delete lands past both", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "auto-server-data-"))
    const store = new DaemonStore(dataDir)
    const projects = store.issueToken("projects", "lifecycle").token
    const read = store.issueToken("read", "reader").token
    const directory = await fixtureProject("auto-server-lifecycle-", { subtask: "off" })
    const registered = store.register(directory)
    const daemon = await startDaemon({ dataDir, port: 0 })
    const remove = () => fetch(`${daemon.url}/projects/${encodeURIComponent(registered.name)}`, { method: "DELETE", headers: { authorization: `Bearer ${projects}` } })
    try {
      expect((await fetch(`${daemon.url}/projects/${encodeURIComponent(registered.name)}`, { method: "DELETE" })).status).toBe(401)
      expect((await fetch(`${daemon.url}/projects/${encodeURIComponent(registered.name)}`, { method: "DELETE", headers: { authorization: `Bearer ${read}` } })).status).toBe(403)
      expect((await fetch(`${daemon.url}/projects/no-such-project`, { method: "DELETE", headers: { authorization: `Bearer ${projects}` } })).status).toBe(404)
      // The planted lock: a driver this daemon does not know holds the
      // directory — the shared condition refuses with the stop taught.
      const holder = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 60000)"], { stdout: "ignore", stderr: "ignore" })
      await Bun.write(join(directory, ".auto", "run.lock"), `${JSON.stringify({ pid: holder.pid, holder: "foreign", started: new Date().toISOString() })}\n`)
      try {
        const refused = await remove()
        expect(refused.status).toBe(409)
        const body = (await refused.json()) as { error: string }
        expect(body.error).toContain("live driver")
        expect(body.error).toContain("DELETE /runs/<id>")
      } finally {
        process.kill(holder.pid!, "SIGKILL")
        await rm(join(directory, ".auto", "run.lock"), { force: true })
      }
      const deleted = await remove()
      expect(deleted.status).toBe(200)
      expect(await deleted.json()).toMatchObject({ removed: { name: registered.name } })
      const whitelist = (await (await fetch(`${daemon.url}/projects`, { headers: { authorization: `Bearer ${read}` } })).json()) as { projects: Array<{ name: string }> }
      expect(whitelist.projects.map((entry) => entry.name)).toEqual([])
    } finally {
      await daemon.stop()
      await rm(dataDir, { recursive: true, force: true })
      await rm(directory, { recursive: true, force: true })
    }
  })
})
