// The worker entry end to end (T-087, P1b of the headless service evolution,
// auto-core plans/0067): the entry runs as a subprocess — stdin closed, the
// way a daemon-spawned child is — over a fixture project with the fake
// `claude` on PATH (test/fixtures/fake-claude.ts, the packages/auto B6/C5
// fixture convention: no provider credentials, the ambient OPENCODE_AUTO_*
// layer scrubbed so the subprocess's switches are exactly what the request
// carries). What these cases pin is the shell flow around the core, not the
// core itself: the audit log file the worker starts itself (the shell duty
// without which there is nothing to observe from the outside), runAll's exit
// code propagating verbatim, the frozen-config refusal (the API-side
// equivalent of the CLI's refuseFrozenFlags), the usage vocabulary of the
// run request, and the second worker's refusal on a locked directory.
// The fixture helpers live in test/fixtures/project.ts (shared with the
// daemon suite since P1c).
import { describe, expect, test } from "bun:test"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fakeAgent, fixtureProject, gitOf, scrubbedEnv, TASK } from "./fixtures/project"

const PACKAGE_ROOT = join(import.meta.dir, "..")

// The subprocess never inherits this test process's driver environment (a
// hibernate window would make every run sleep, a model policy would
// reroute), and it must not read the operator's model registry either
// ($OPENCODE_AUTO_MODELS or $XDG_CONFIG_HOME/opencode-auto/models.json), so
// XDG_CONFIG_HOME points at an empty directory — the packages/auto e2e
// CLI_ENV_BASE pattern. The per-run switches the requests below carry are
// applied by the worker itself, which is the thing under test.
const ENV_BASE: Record<string, string | undefined> = scrubbedEnv()

type WorkerResult = { code: number; out: string; err: string }

// One worker child process (one run per process is the unit under test).
// `arg` is the raw request token the worker receives (undefined = the
// no-argument usage-error form).
function spawnWorker(arg: string | undefined, env: Record<string, string> = {}) {
  const proc = Bun.spawn([process.execPath, join(PACKAGE_ROOT, "src", "index.ts"), "worker", ...(arg === undefined ? [] : [arg])], {
    cwd: PACKAGE_ROOT,
    env: { ...ENV_BASE, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const done = (async (): Promise<WorkerResult> => {
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    const code = await proc.exited
    return { code, out, err }
  })()
  return { proc, done }
}

async function runWorker(request: unknown, env: Record<string, string> = {}): Promise<WorkerResult> {
  return spawnWorker(JSON.stringify(request), env).done
}

describe("worker: a fixture run is a fully-formed shell run, observable on disk", () => {
  test("the run completes with exit 0, the audit log exists and carries the run's lines, the per-run switch reaches the core", async () => {
    const dir = await fixtureProject("auto-server-run-")
    const agent = await fakeAgent()
    try {
      const run = await runWorker({ directory: dir, switches: { OPENCODE_AUTO_AGENT: "claude" } }, agent.env)
      expect(run.code, `${run.out}\n${run.err}`).toBe(0)
      expect(run.err).toBe("")
      // The shell duty: the worker itself started the log file, and the run's
      // first logged line names it (the CLI's startRunLog shape).
      expect(run.out).toContain("📝 log file:")
      const logs = (await readdir(join(dir, ".auto", "logs"))).filter((name) => /^run-.*\.log$/.test(name))
      expect(logs.length).toBeGreaterThan(0)
      const text = await Bun.file(join(dir, ".auto", "logs", logs[0]!)).text()
      // The audit log records in full (auditLog true in the profile): the
      // banner's config summary and the switch the request carried — the
      // outside can read what the run was before tailing it.
      expect(text).toContain("⚙ project config (.opencode/auto/config.json)")
      expect(text).toContain("OPENCODE_AUTO_AGENT=claude")
      // The run really ran: the task closed (the report with its result line,
      // the todo → done rename riding the run's commits) and the tree is left
      // clean — the unified commit is the completion condition.
      expect(await Bun.file(join(dir, "docs", TASK, "done.md")).exists()).toBe(true)
      expect(await Bun.file(join(dir, "docs", TASK, "report.md")).text()).toContain("Result: PASS")
      expect(await Bun.file(join(dir, "src/alpha.ts")).text()).toContain("lead")
      expect((await gitOf(dir)("status", "--porcelain")).trim()).toBe("")
    } finally {
      await agent.done()
      await rm(dir, { recursive: true, force: true })
    }
  }, 120_000)

  test("runAll's own exit code propagates verbatim: a directory without the agent contract stops with exit 1 after the log started", async () => {
    // An empty directory passes every gate before the contract check; the
    // missing contract is preflight's exit 1 — runAll's code, not the
    // worker's own vocabulary. The log file exists (it starts ahead of the
    // gates, as the CLI's does), and the driver message goes to stdout.
    const dir = await mkdtemp(join(tmpdir(), "auto-server-empty-"))
    try {
      const run = await runWorker({ directory: dir })
      expect(run.code).toBe(1)
      expect(run.out).toContain("agent contract file missing")
      expect(run.out).toContain("📝 log file:")
      expect(run.err).toBe("")
      const logs = (await readdir(join(dir, ".auto", "logs"))).filter((name) => /^run-.*\.log$/.test(name))
      expect(logs.length).toBeGreaterThan(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

describe("worker: the run request's usage vocabulary", () => {
  // Every refusal here fires before any write: no lock, no log file, no
  // .auto/ at all.
  test("a request carrying config keys is refused with the frozen-flag message, in both spellings, and nothing is written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-server-frozen-"))
    try {
      const frozen = [
        { subtask: "auto" },
        { contextLimit: 128 },
        { "context-limit": 64 },
        { mode: "migrate" },
        { "idle-time": 10 },
        { wrapup: false },
      ]
      for (const options of frozen) {
        const run = await runWorker({ directory: dir, options })
        expect(run.code, JSON.stringify(options)).toBe(1)
        expect(run.err).toContain("was frozen by init")
        expect(run.err).toContain(".opencode/auto/config.json")
        expect(run.err).toContain("opencode-auto amend <dir>")
      }
      // The on/off pairs keep the CLI's paired revision hints
      const numbering = await runWorker({ directory: dir, options: { autoNumber: false } })
      expect(numbering.err).toContain("--auto-number (use --no-auto-number to turn off)")
      const wrapup = await runWorker({ directory: dir, options: { wrapup: false } })
      expect(wrapup.err).toContain("--wrapup (use --no-wrapup to turn off)")
      // A config key at the top level of the request, and a dedicated config
      // carrier, get the same refusal family
      const topLevel = await runWorker({ directory: dir, phases: "am" })
      expect(topLevel.code).toBe(1)
      expect(topLevel.err).toContain("was frozen by init")
      const carrier = await runWorker({ directory: dir, config: { subtask: "auto" } })
      expect(carrier.code).toBe(1)
      expect(carrier.err).toContain("a run request carries no config")
      // Refused before any write
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("malformed requests and unknown or invalid fields are usage errors on stderr, exit 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-server-usage-"))
    try {
      const cases: [string, unknown, RegExp][] = [
        ["a non-object document", [dir], /must be a JSON object/],
        ["missing directory", { options: {} }, /requires "directory"/],
        ["unknown request field", { directory: dir, run: true }, /unknown request field "run"/],
        ["unknown option", { directory: dir, options: { wait: 1 } }, /options\.wait is not a run option/],
        ["interactive", { directory: dir, options: { interactive: true } }, /options\.interactive is refused/],
        ["bad permission", { directory: dir, options: { permission: "yolo" } }, /options\.permission takes/],
        ["waitAnswer out of range", { directory: dir, options: { waitAnswer: 90 } }, /options\.waitAnswer takes an integer 0\.\.60/],
        ["maxSessions not yet", { directory: dir, options: { maxSessions: 2 } }, /concurrent execution is not supported yet/],
        ["maxSessions not an integer", { directory: dir, options: { maxSessions: 1.5 } }, /options\.maxSessions takes a positive integer/],
        ["verbose not a boolean", { directory: dir, options: { verbose: "yes" } }, /options\.verbose takes true\|false/],
        ["unknown switch", { directory: dir, switches: { OPENCODE_AUTO_NOPE: "on" } }, /is not a known switch/],
        ["switch name without the prefix", { directory: dir, switches: { STEP: "task" } }, /OPENCODE_AUTO_\*/],
        ["switch value not a string", { directory: dir, switches: { OPENCODE_AUTO_STEP: 1 } }, /takes a string value/],
        // The plan payload (P3c, daemon-written — the plan operation's loop
        // route): the vocabulary the entry enforces on its own half.
        ["plan not an object", { directory: dir, plan: "soon" }, /plan must be an object/],
        ["unknown plan field", { directory: dir, plan: { force: true } }, /plan\.force is not a plan field/],
        ["plan input not text", { directory: dir, plan: { input: { text: "nested" } } }, /plan\.input takes the planning input text/],
        ["plan append without input", { directory: dir, plan: { append: true } }, /plan\.append rides a planning input/],
        ["plan append not a boolean", { directory: dir, plan: { input: "x", append: "yes" } }, /plan\.append takes true\|false/],
      ]
      for (const [name, request, pattern] of cases) {
        const run = await runWorker(request)
        expect(run.code, name).toBe(1)
        expect(run.err, name).toMatch(pattern)
      }
      // A token that is not JSON at all, and no argument at all, are the two
      // usage forms (spawned raw — the object helper would re-quote them)
      const notJson = await spawnWorker("plain text").done
      expect(notJson.code).toBe(1)
      expect(notJson.err).toContain("not valid JSON")
      const none = await spawnWorker(undefined).done
      expect(none.code).toBe(1)
      expect(none.err).toContain("takes exactly one argument")
      // A retired switch name passes validation and the core answers with
      // its own notice at run start (passed through, never refused here)
      const retired = await runWorker({ directory: dir, switches: { OPENCODE_AUTO_REUSE_SESSION: "on" } })
      expect(retired.code).toBe(1)
      expect(retired.err).not.toContain("is not a known switch")
      expect(retired.out).toContain("OPENCODE_AUTO_REUSE_SESSION is retired")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("worker: one driver per directory (the run lock arrives via runAll)", () => {
  test("a second worker on a directory whose lock a live worker holds refuses with the holder lines, exit 1; the first run finishes 0", async () => {
    const dir = await fixtureProject("auto-server-lock-")
    // The per-turn delay stretches the first worker's run so the second
    // spawn lands inside its lock window (the fixture's T-087 extension).
    const agent = await fakeAgent({ FAKE_CLAUDE_DELAY_MS: "500" })
    try {
      const first = spawnWorker(JSON.stringify({ directory: dir, switches: { OPENCODE_AUTO_AGENT: "claude" } }), agent.env)
      // Wait for the first worker to take .auto/run.lock (runAll acquires it
      // before anything else).
      const lockPath = join(dir, ".auto", "run.lock")
      const deadline = Date.now() + 30_000
      while (!(await Bun.file(lockPath).exists())) {
        if (Date.now() > deadline) throw new Error("the first worker never took the run lock")
        await Bun.sleep(50)
      }
      // The second worker on the same directory: the refusal is runAll's own
      // (the worker never works around it) — the holder lines name this
      // shell's bin, and the exit code is runAll's 1.
      const second = await runWorker({ directory: dir }, agent.env)
      expect(second.code).toBe(1)
      expect(second.out).toContain("another opencode-auto-server process holds the run lock of")
      expect(second.out).toMatch(/pid \d+ on /)
      // The first worker was untouched by the refusal and completes
      const done = await first.done
      expect(done.code, `${done.out}\n${done.err}`).toBe(0)
      expect(await Bun.file(join(dir, "docs", TASK, "done.md")).exists()).toBe(true)
      // The refused worker leaves no lock behind (the lock was never its to
      // hold) and the first worker's lock died with its process.
      expect(await Bun.file(lockPath).exists()).toBe(false)
    } finally {
      await agent.done()
      await rm(dir, { recursive: true, force: true })
    }
  }, 180_000)
})
