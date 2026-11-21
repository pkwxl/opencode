// The lifecycle operations end to end (T-089, P1d of the headless service
// evolution, auto-core plans/0067): the daemon serves the REST surface of
// src/ops.ts in-process over registered fixture projects, and every case
// asserts the operation reached disk through the core (the artifacts the
// core's own functions write) rather than through any daemon-side write.
// What these cases pin:
//   - the config ops over the core's library functions: init's full
//     overwrite and its artifacts, amend's per-key revision with the strict
//     load naming fix, fix's rule table (dryrun = the drift gate, apply =
//     gated writes, manual findings reported), reset's plan (a filled brief
//     kept, a stub removed);
//   - the confirm / clean-tree split: two separate request fields, each
//     flipping only its own gate (428 with the question vs 409 with the file
//     list), never one bundled force;
//   - the units: close over closeUnit (the Closed: field, the tick, the
//     close commit) and task-add over addTask through planPrelude's
//     no-session route (the document, the index line, the commit);
//   - the models operation: read-only, no lock, runs beside a live run;
//     the probe is the POST route behind its own opt-in scope (P4b);
//   - the planPrelude boundary matrix: the no-agent routes served with
//     their lines and codes (round establishment, the round-close gate,
//     the drift refusal naming transfer, the refusal stops), and — since
//     the P3c unlock — the agent-planning routes spawning planning runs
//     (202 + the run resource, the task landing through the core's
//     planning step);
//   - the auth matrix per scope and the whitelist for operations;
//   - the lock rules: the config ops' 423 under a planted live holder, the
//     lock-acquiring ops' 423, and the registry's retryable 409 beside a
//     live run of this daemon (a real worker over the fake `claude`).
import { describe, expect, test } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, readdir, rename, rm, symlink } from "node:fs/promises"
import { homedir, hostname, tmpdir } from "node:os"
import { join } from "node:path"
import { startDaemon, type DaemonHandle } from "../src/daemon"
import { DaemonStore } from "../src/store"
import { CONFIG_DEFAULTS, CONFIG_FILE, saveProjectConfig } from "@opencode-ai/auto-core/config"
import { renderAgentContract } from "@opencode-ai/auto-core/config-fix"
import { ensurePointer } from "@opencode-ai/auto-core/agents-block"
import { ensureInitGitignore } from "@opencode-ai/auto-core/gitignore"
import { establishRound } from "@opencode-ai/auto-core/phases"
import { findWallCommit } from "@opencode-ai/auto-core/wall"
import { fakeAgent, fixtureProject, gitOf, TASK } from "./fixtures/project"
import templateConfig from "@opencode-ai/auto-core/templates/opencode.json" with { type: "file" }

// The daemon serves operations from this process: the hermetic base of the
// shared fixtures (the package preload, test/preload.ts — an empty config
// home, no ambient registry) must hold for anything it spawns.

type Body = Record<string, unknown>
type Answer = { status: number; body: Body }

type Harness = {
  daemon: DaemonHandle
  read: string
  control: string
  config: string
  register: (dir: string) => string
  call: (method: string, path: string, token?: string, body?: unknown) => Promise<Answer>
}

async function withOps(fn: (h: Harness) => Promise<void>): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "auto-server-ops-"))
  const store = new DaemonStore(dataDir)
  const read = store.issueToken("read", "reader").token
  const control = store.issueToken("control", "controller").token
  const config = store.issueToken("config", "configurer").token
  const daemon = await startDaemon({ dataDir, port: 0 })
  const call = async (method: string, path: string, token?: string, body?: unknown): Promise<Answer> => {
    const response = await fetch(`${daemon.url}${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, body: (await response.json()) as Body }
  }
  try {
    await fn({
      daemon,
      read,
      control,
      config,
      register: (dir: string) => store.register(dir).name,
      call,
    })
  } finally {
    await daemon.stop()
    await rm(dataDir, { recursive: true, force: true })
  }
}

// One empty git repository that can commit (the init prerequisite).
async function gitBlank(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  const git = gitOf(dir)
  await git("init")
  await git("config", "user.email", "ops@auto-server.test")
  await git("config", "user.name", "ops e2e")
  return dir
}

// A configured, committed, fully-initialized project in a phased mode (the
// round established, nothing done): the plan-boundary and config-op fixture —
// every artifact init itself writes, so a clean fixture has no fix findings.
// The config partial merges over the defaults (e.g. agent: "claude" for the
// suites that spawn a planning run over the fake agent).
async function phasedProject(prefix: string, phases: string, config: Partial<import("@opencode-ai/auto-core/config").ProjectConfig> = {}): Promise<string> {
  const dir = await gitBlank(prefix)
  await saveProjectConfig(dir, { ...CONFIG_DEFAULTS, phases, ...config })
  await mkdir(join(dir, ".opencode", "agent"), { recursive: true })
  await Bun.write(join(dir, ".opencode", "agent", "auto.md"), await renderAgentContract(false))
  await Bun.write(join(dir, "opencode.json"), await Bun.file(templateConfig).text())
  // No brief: init never writes one (plans/0133 D9 retired the seed), and a
  // missing brief is no finding — the analysis flow owns the start.
  await ensureInitGitignore(dir)
  await establishRound(dir, { phases })
  await ensurePointer(dir, { testByDriver: false })
  await gitOf(dir)("add", "-A")
  await gitOf(dir)("commit", "-qm", "baseline")
  return dir
}

// Marks one phase of the current round done: the state-file rename plus the
// index tick (what the driver's own close-out does), committed.
async function phaseDone(dir: string, phaseDir: string): Promise<void> {
  await rename(join(dir, "docs", "R-01", phaseDir, "todo.md"), join(dir, "docs", "R-01", phaseDir, "done.md"))
  const index = join(dir, "docs", "R-01", "phases.md")
  const text = await Bun.file(index).text()
  if (!text.includes("- [ ]")) throw new Error(`no open phase line found in ${index}`)
  await Bun.write(index, text.replace("- [ ]", "- [x]"))
  const git = gitOf(dir)
  await git("add", "-A")
  await git("commit", "-qm", `phase ${phaseDir} done`)
}

// The round brief's ## Close section, filled (the restatement listing the
// round-close gate requires).
async function closeListed(dir: string): Promise<void> {
  await Bun.write(
    join(dir, "docs", "R-01", "round.md"),
    ["# Round R-01", "", "## Goal", "", "- the fixture round.", "", "## Close", "", "- every decision restated into the target's own docs; none accepted as lost.", ""].join("\n"),
  )
  const git = gitOf(dir)
  await git("add", "-A")
  await git("commit", "-qm", "round brief close listed")
}

// A lock file planted the way the core writes it, held by a REAL other
// process (a sleeping child): a live holder — this test process's own pid
// would read stale, since the daemon serves the operations in-process.
async function plantLiveLock(dir: string): Promise<() => Promise<void>> {
  const holder = Bun.spawn(["sleep", "30"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
  await mkdir(join(dir, ".auto"), { recursive: true })
  await Bun.write(
    join(dir, ".auto", "run.lock"),
    `${JSON.stringify({ pid: holder.pid, host: hostname(), command: "run", started: new Date().toISOString() })}\n`,
  )
  return async () => {
    holder.kill()
    await holder.exited
  }
}

const linesOf = (body: Body): string[] => (body.lines as string[]) ?? []
const has = (body: Body, text: string): boolean => linesOf(body).some((line) => line.includes(text))

// Polls a spawned operation run to its terminal state (the plan unlock
// test's inline loop, named for the transfer suite's reuse).
async function untilRunSettles(h: Harness, id: string, timeoutMs = 120_000): Promise<{ state: string; code: number | null; tail: string }> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const run = (await (await fetch(`${h.daemon.url}/runs/${id}`, { headers: { authorization: `Bearer ${h.read}` } })).json()) as {
      state: string
      code: number | null
      tail: string
      live: boolean
    }
    if (!run.live) return run
    if (Date.now() > deadline) throw new Error(`run ${id} never settled: ${JSON.stringify(run)}`)
    await Bun.sleep(200)
  }
}

describe("the lifecycle operations (P1d)", () => {
  test("the whitelist and scopes gate the operations: 404 unregistered, 401 without a token, 403 naming the scope, read serving models", async () => {
    await withOps(async (h) => {
      const dir = await gitBlank("auto-ops-unreg-")
      const name = h.register(dir)
      expect((await h.call("POST", `/projects/${name}/init`, h.config)).status).toBe(200)
      // unregistered
      const unknown = await h.call("POST", "/projects/no-such-project/init", h.config, {})
      expect(unknown.status).toBe(404)
      expect(String(unknown.body.error)).toContain("not a registered project")
      // unknown op segment
      expect((await h.call("POST", `/projects/${name}/bogus`, h.config, {})).status).toBe(404)
      // auth
      expect((await h.call("POST", `/projects/${name}/init`)).status).toBe(401)
      const wrongScope = await h.call("POST", `/projects/${name}/init`, h.control, {})
      expect(wrongScope.status).toBe(403)
      expect(String(wrongScope.body.error)).toContain('"config" scope')
      const closeDenied = await h.call("POST", `/projects/${name}/close`, h.config, { ref: TASK, reason: "x" })
      expect(closeDenied.status).toBe(403)
      expect(String(closeDenied.body.error)).toContain('"control" scope')
      expect((await h.call("GET", `/projects/${name}/models`, h.read)).status).toBe(200)
      await rm(dir, { recursive: true, force: true })
    })
  })

  test("init freezes the config layer over the core's writers: config.json, the contract, the AGENTS.md block, opencode.json, the ignore set — and no brief (the analysis flow owns the start)", async () => {
    await withOps(async (h) => {
      const dir = await gitBlank("auto-ops-init-")
      const name = h.register(dir)
      const answer = await h.call("POST", `/projects/${name}/init`, h.config, { config: { phases: "am", contextLimit: 32 } })
      expect(answer.status).toBe(200)
      expect(answer.body.code).toBe(0)
      expect(has(answer.body, "created: opencode.json")).toBe(true)
      expect(has(answer.body, `created: ${join(".opencode", "agent", "auto.md")}`)).toBe(true)
      expect(has(answer.body, "appended: AGENTS.md opencode-auto block")).toBe(true)
      // The closing pointer is the rounds' opening command (plans/0101 D4):
      // transfer on a phased project, naming the assisted analysis — and
      // since plans/0133 init writes no brief at all.
      expect(has(answer.body, "opens the assisted project analysis")).toBe(true)
      expect(has(answer.body, `/projects/${name}/transfer`)).toBe(true)
      expect(has(answer.body, "never a project brief")).toBe(true)
      const stored = JSON.parse(await Bun.file(join(dir, CONFIG_FILE)).text())
      expect(stored.phases).toBe("am")
      expect(stored.contextLimit).toBe(32)
      expect(stored.mode).toBe("migrate")
      expect(await Bun.file(join(dir, ".opencode", "auto", "brief.md")).exists()).toBe(false)
      expect(await Bun.file(join(dir, "opencode.json")).exists()).toBe(true)
      expect((await Bun.file(join(dir, "AGENTS.md")).text()).includes("<!-- opencode-auto:start -->")).toBe(true)
      expect(await Bun.file(join(dir, ".gitignore")).text()).toContain(".auto/")
      // init writes no rounds: docs/ is untouched (transfer establishes rounds)
      expect(await Bun.file(join(dir, "docs", "R-01", "phases.md")).exists()).toBe(false)
      expect(answer.body.project).toBe(name)
      expect(String(answer.body.directory)).toBe(realpathSync(dir))
      await rm(dir, { recursive: true, force: true })
    })
  })

  test("the shared sequence's git halves run on this shell too: 0073's bootstrap, 0122/0147's root-symlink stamps, 0138's ignore-set closing line (plans/0193 D4)", async () => {
    await withOps(async (h) => {
      // The bootstrap (0073 / 0165-056's S29-04): a registered target inside
      // no work tree is bootstrapped by the operation itself — the CLI's own
      // ruling, no --no-git escape. Pre-fix the operation answered 200 on a
      // plain directory (no repository), and every run after it completed
      // with no commit anywhere — no unified commit, no rollback anchor.
      const plain = await mkdtemp(join(tmpdir(), "auto-ops-nogit-"))
      const plainName = h.register(plain)
      const gitEnv = { GIT_AUTHOR_NAME: "ops e2e", GIT_AUTHOR_EMAIL: "ops@auto-server.test", GIT_COMMITTER_NAME: "ops e2e", GIT_COMMITTER_EMAIL: "ops@auto-server.test" }
      const held = { ...process.env }
      Object.assign(process.env, gitEnv)
      try {
        const bootstrapped = await h.call("POST", `/projects/${plainName}/init`, h.config, { config: { phases: "m" } })
        expect(bootstrapped.status).toBe(200)
        expect(has(bootstrapped.body, "initialized git repository")).toBe(true)
        expect(await Bun.file(join(plain, ".git", "HEAD")).exists()).toBe(true)
      } finally {
        for (const key of Object.keys(gitEnv)) delete process.env[key]
        Object.assign(process.env, held)
        await rm(plain, { recursive: true, force: true })
      }
      // The stamps (0122/0147 / S30-02): a root symlink to a reference —
      // init stamps the allow + the edit deny exactly as the CLI's (pre-fix
      // the two shells' init outputs differed and sessions could not read
      // the reference until someone ran fix).
      const dir = await gitBlank("auto-ops-stamps-")
      const corpus = await mkdtemp(join(tmpdir(), "auto-ops-corpus-"))
      await symlink(corpus, join(dir, "linux"))
      const name = h.register(dir)
      const stamped = await h.call("POST", `/projects/${name}/init`, h.config, {})
      expect(stamped.status).toBe(200)
      expect(has(stamped.body, "stamped: opencode.json the root-symlink read-only stamps")).toBe(true)
      const permission = JSON.parse(await Bun.file(join(dir, "opencode.json")).text()).permission
      expect(permission.external_directory[`${realpathSync(corpus)}/**`]).toBe("allow")
      // 0138's committed-surfaces closing line on this shell too (the
      // lockstep miss the mirror dropped).
      expect(has(stamped.body, "the file itself and opencode.json are committed project surfaces — commit them with the config layer")).toBe(true)
      await rm(dir, { recursive: true, force: true })
      await rm(corpus, { recursive: true, force: true })
    })
  })

  test("the confirm / clean-tree split: two separate fields, each flipping only its own gate", async () => {
    await withOps(async (h) => {
      const dir = await phasedProject("auto-ops-gates-", "am")
      const name = h.register(dir)
      const configBefore = await Bun.file(join(dir, CONFIG_FILE)).text()
      // ① unconfirmed overwrite on a clean tree → 428, the question included
      const unconfirmed = await h.call("POST", `/projects/${name}/init`, h.config, {})
      expect(unconfirmed.status).toBe(428)
      expect(unconfirmed.body.gate).toBe("confirm")
      expect(String(unconfirmed.body.question)).toContain("fully overwrite")
      expect(await Bun.file(join(dir, CONFIG_FILE)).text()).toBe(configBefore)
      // an explicit false is the same declined answer
      expect((await h.call("POST", `/projects/${name}/init`, h.config, { confirm: false })).status).toBe(428)
      // ② confirm alone on a dirty tree → the clean-tree gate answers 409
      await Bun.write(join(dir, "dirt.txt"), "uncommitted\n")
      const dirty = await h.call("POST", `/projects/${name}/init`, h.config, { confirm: true })
      expect(dirty.status).toBe(409)
      expect(dirty.body.gate).toBe("cleanTree")
      expect(String(dirty.body.error)).toContain("requires a clean worktree")
      expect(await Bun.file(join(dir, CONFIG_FILE)).text()).toBe(configBefore)
      // ③ cleanTree alone (no confirm) on a dirty tree → the confirm gate still asks
      const treeSkipped = await h.call("POST", `/projects/${name}/init`, h.config, { cleanTree: true })
      expect(treeSkipped.status).toBe(428)
      expect(treeSkipped.body.gate).toBe("confirm")
      // ④ both fields → the overwrite runs on the dirty tree (the -f
      // equivalent); the stateless overwrite resets ungiven keys to the
      // defaults (phases am → m) — one init yields a determined state
      const forced = await h.call("POST", `/projects/${name}/init`, h.config, { confirm: true, cleanTree: true })
      expect(forced.status).toBe(200)
      const stored = JSON.parse(await Bun.file(join(dir, CONFIG_FILE)).text())
      expect(stored.contextLimit).toBe(CONFIG_DEFAULTS.contextLimit)
      expect(stored.phases).toBe("m")
      await rm(dir, { recursive: true, force: true })
    })
  })

  test("init's full overwrite tolerates retired keys (reported, then dropped) and its prefix guard refuses a phases change that drops completed work", async () => {
    await withOps(async (h) => {
      const dir = await phasedProject("auto-ops-overwrite-", "am")
      const name = h.register(dir)
      await Bun.write(join(dir, CONFIG_FILE), `${JSON.stringify({ ...CONFIG_DEFAULTS, phases: "am", commit: false }, null, 2)}\n`)
      const answer = await h.call("POST", `/projects/${name}/init`, h.config, { confirm: true, cleanTree: true })
      expect(answer.status).toBe(200)
      expect(has(answer.body, "full overwrite drops the retired key commit")).toBe(true)
      expect(JSON.parse(await Bun.file(join(dir, CONFIG_FILE)).text()).commit).toBeUndefined()
      // the retirement: config.phases on amend is refused before any value
      // validation (plans/0193 D4 / 0165-056/S30-01 — the CLI's own 0137
      // ruling, no longer bypassable through the API; pre-fix this request
      // reached the prefix guard, the reshape channel live on amend). A
      // retired key's value is never judged: an invalid value meets the
      // same retirement refusal, not the value-validation error.
      await phaseDone(dir, "P01-analysis")
      const retired = await h.call("POST", `/projects/${name}/amend`, h.config, { config: { phases: "m" } })
      expect(retired.status).toBe(400)
      expect(String(retired.body.error)).toContain("config.phases is retired on amend")
      expect(String(retired.body.error)).toContain("- R-NN <phases> — <goal>` line in docs/analysis.md")
      const retiredBad = await h.call("POST", `/projects/${name}/amend`, h.config, { config: { phases: "not-a-preset" } })
      expect(retiredBad.status).toBe(400)
      expect(String(retiredBad.body.error)).toContain("config.phases is retired on amend")
      expect(String(retiredBad.body.error)).not.toContain("config.phases is invalid")
      // the guard: P01 done, a phases value that would drop it is refused
      // before any write — through init, the one command whose phases key is
      // live (the stateless full overwrite)
      const guard = await h.call("POST", `/projects/${name}/init`, h.config, { config: { phases: "m" } })
      expect(guard.status).toBe(409)
      expect(String(guard.body.error)).toContain("mid-round phases change must keep the current round's completed phases")
      // the config keeps the value the earlier overwrite wrote ("m" — the stateless
      // overwrite's own reset); the refused amend changed nothing
      expect(JSON.parse(await Bun.file(join(dir, CONFIG_FILE)).text()).phases).toBe("m")
      await rm(dir, { recursive: true, force: true })
    })
  })

  test("init's request vocabulary: unknown fields, hand-edited keys, kebab spellings and bad values are 400s naming the rule", async () => {
    await withOps(async (h) => {
      const dir = await gitBlank("auto-ops-badinit-")
      const name = h.register(dir)
      for (const [config, fragment] of [
        [{ bogus: 1 }, "not a constitutional key"],
        [{ acceptanceGate: ["implement"] }, "no flag"],
        [{ "context-limit": 32 }, "camelCase"],
        [{ contextLimit: 0 }, "positive integer"],
        [{ agent: "cursor" }, "opencode|claude"],
        [{ subtask: "sometimes" }, "off|auto|true|ondemand"],
        [{ idleTime: 999 }, "1..120"],
        [{ phases: "xyz" }, "invalid"],
        [{ scanExempt: ["/abs"] }, "absolute"],
      ] as const) {
        const answer = await h.call("POST", `/projects/${name}/init`, h.config, { config })
        expect(answer.status).toBe(400)
        expect(String(answer.body.error)).toContain(fragment)
      }
      expect((await h.call("POST", `/projects/${name}/init`, h.config, { force: true })).status).toBe(400)
      // the JSON boolean true is the file's own alias for subtask "true"
      expect((await h.call("POST", `/projects/${name}/init`, h.config, { config: { subtask: true } })).status).toBe(200)
      await rm(dir, { recursive: true, force: true })
    })
  })

  test("amend revises one key and keeps the rest; it refuses without a key, without config.json, with the gate fields, and names fix on a strict failure", async () => {
    await withOps(async (h) => {
      const dir = await phasedProject("auto-ops-amend-", "am")
      const name = h.register(dir)
      const amended = await h.call("POST", `/projects/${name}/amend`, h.config, { config: { contextLimit: 128, testByDriver: true, handoverTest: true } })
      expect(amended.status).toBe(200)
      expect(has(amended.body, "✓ amended (contextLimit, testByDriver, handoverTest)")).toBe(true)
      const stored = JSON.parse(await Bun.file(join(dir, CONFIG_FILE)).text())
      expect(stored.contextLimit).toBe(128)
      expect(stored.mode).toBe("migrate")
      expect(stored.testByDriver).toBe(true)
      // no key → 400
      expect((await h.call("POST", `/projects/${name}/amend`, h.config, { config: {} })).status).toBe(400)
      // amend takes no gates: it discards no key
      const gated = await h.call("POST", `/projects/${name}/amend`, h.config, { config: { wrapup: false }, confirm: true })
      expect(gated.status).toBe(400)
      expect(String(gated.body.error)).toContain("no overwrite confirmation to answer")
      // handoverTest without testByDriver (effective values) is refused
      const dependent = await h.call("POST", `/projects/${name}/amend`, h.config, { config: { testByDriver: false } })
      expect(dependent.status).toBe(409)
      expect(String(dependent.body.error)).toContain("requires config.testByDriver")
      // a broken config loads strictly nowhere: the refusal names fix
      await Bun.write(join(dir, CONFIG_FILE), `${JSON.stringify({ ...CONFIG_DEFAULTS, phases: "am", commit: false }, null, 2)}\n`)
      const strict = await h.call("POST", `/projects/${name}/amend`, h.config, { config: { contextLimit: 64 } })
      expect(strict.status).toBe(409)
      expect(String(strict.body.error)).toContain("commit: false is retired")
      expect(linesOf(strict.body).some((line) => line.startsWith("fix: "))).toBe(true)
      // nothing to amend on an uninitialized directory
      const blank = await gitBlank("auto-ops-noconfig-")
      const blankName = h.register(blank)
      const nothing = await h.call("POST", `/projects/${blankName}/amend`, h.config, { config: { contextLimit: 64 } })
      expect(nothing.status).toBe(409)
      expect(String(nothing.body.error)).toContain("nothing to amend")
      await rm(dir, { recursive: true, force: true })
      await rm(blank, { recursive: true, force: true })
    })
  })

  test("fix: the drift gate (dryrun) lists findings with the CLI's exit 1, the apply is gated, and manual findings report a person", async () => {
    await withOps(async (h) => {
      const dir = await phasedProject("auto-ops-fix-", "am")
      const name = h.register(dir)
      // clean → 200, nothing to fix
      expect((await h.call("POST", `/projects/${name}/fix`, h.config, { dryrun: true })).status).toBe(200)
      // plant drift: a retired key the rule table drops (committed, so the
      // apply's gates see the clean tree the CLI's would)
      const git = gitOf(dir)
      await Bun.write(join(dir, CONFIG_FILE), `${JSON.stringify({ ...CONFIG_DEFAULTS, phases: "am", verify: true }, null, 2)}\n`)
      await git("add", "-A")
      await git("commit", "-qm", "plant the retired key")
      const dry = await h.call("POST", `/projects/${name}/fix`, h.config, { dryrun: true })
      expect(dry.status).toBe(409)
      expect(dry.body.code).toBe(1)
      expect(has(dry.body, "fix: .opencode/auto/config.json: verify: true is retired")).toBe(true)
      expect(has(dry.body, "dryrun: nothing was changed")).toBe(true)
      expect(JSON.parse(await Bun.file(join(dir, CONFIG_FILE)).text()).verify).toBe(true)
      // the apply answers the two gates like init
      expect((await h.call("POST", `/projects/${name}/fix`, h.config, {})).status).toBe(428)
      const applied = await h.call("POST", `/projects/${name}/fix`, h.config, { confirm: true })
      expect(applied.status).toBe(200)
      expect(has(applied.body, "fixed: .opencode/auto/config.json: drop the key")).toBe(true)
      expect(JSON.parse(await Bun.file(join(dir, CONFIG_FILE)).text()).verify).toBeUndefined()
      // manual-only: a config that does not parse is a person's finding, never guessed
      await Bun.write(join(dir, CONFIG_FILE), "{ not json")
      await git("add", "-A")
      await git("commit", "-qm", "break the config")
      const manualDry = await h.call("POST", `/projects/${name}/fix`, h.config, { dryrun: true })
      expect(manualDry.status).toBe(409)
      expect(has(manualDry.body, "manual: .opencode/auto/config.json: not valid JSON")).toBe(true)
      const manualApply = await h.call("POST", `/projects/${name}/fix`, h.config, { confirm: true })
      expect(manualApply.status).toBe(409)
      expect(has(manualApply.body, "finding(s) need a person")).toBe(true)
      expect(await Bun.file(join(dir, CONFIG_FILE)).text()).toBe("{ not json")
      // uninitialized
      const blank = await gitBlank("auto-ops-fixblank-")
      const blankName = h.register(blank)
      const nothing = await h.call("POST", `/projects/${blankName}/fix`, h.config, { dryrun: true })
      expect(nothing.status).toBe(409)
      expect(String(nothing.body.error)).toContain("nothing to fix")
      await rm(dir, { recursive: true, force: true })
      await rm(blank, { recursive: true, force: true })
    })
  })

  test("reset: the plan is answered before the gates apply it; a filled brief is kept, and docs/ is never touched", async () => {
    await withOps(async (h) => {
      const dir = await phasedProject("auto-ops-reset-", "am")
      const name = h.register(dir)
      await Bun.write(join(dir, ".opencode", "auto", "brief.md"), "# Project brief\n\n## Goal\n\nThe human's own intent.\n")
      const git = gitOf(dir)
      await git("add", "-A")
      await git("commit", "-qm", "the filled brief")
      const unconfirmed = await h.call("POST", `/projects/${name}/reset`, h.config, {})
      expect(unconfirmed.status).toBe(428)
      expect(String(unconfirmed.body.question)).toContain("will be deleted/restored")
      const entries = unconfirmed.body.plan as { path: string; action: string; reason?: string }[]
      const brief = entries.find((entry) => entry.path === join(".opencode", "auto", "brief.md"))
      expect(brief?.action).toBe("keep")
      // The stub-remove rule retired with the stub model (plans/0133): a
      // brief on disk is an installed proposal or the person's amend write —
      // the core's own keep reason names both and leaves removal to the hand.
      expect(brief?.reason).toContain("installed approved proposal")
      expect(await Bun.file(join(dir, CONFIG_FILE)).exists()).toBe(true)
      const applied = await h.call("POST", `/projects/${name}/reset`, h.config, { confirm: true })
      expect(applied.status).toBe(200)
      expect(has(applied.body, "restored to the uninitialized state")).toBe(true)
      expect(await Bun.file(join(dir, CONFIG_FILE)).exists()).toBe(false)
      expect(await Bun.file(join(dir, ".opencode", "agent", "auto.md")).exists()).toBe(false)
      expect(await Bun.file(join(dir, ".opencode", "auto", "brief.md")).text()).toContain("The human's own intent")
      // a driver-written AGENTS.md is down to the empty shell after the strip,
      // so reset removes it whole (a human's prose around the block survives)
      expect(await Bun.file(join(dir, "AGENTS.md")).exists()).toBe(false)
      // the rounds and their documents are the work of humans and AI, not init's output
      expect(await Bun.file(join(dir, "docs", "R-01", "phases.md")).exists()).toBe(true)
      // a second reset answers the clean-tree gate: reset never commits, the
      // diff is left for review (the CLI's own rule)
      const second = await h.call("POST", `/projects/${name}/reset`, h.config, { confirm: true })
      expect(second.status).toBe(409)
      expect(second.body.gate).toBe("cleanTree")
      await rm(dir, { recursive: true, force: true })
    })
  })

  test("close over closeUnit: the Closed: field, the ticked index, the close commit — and the shape refusals before any read", async () => {
    await withOps(async (h) => {
      const dir = await fixtureProject("auto-ops-close-", {})
      const name = h.register(dir)
      const closed = await h.call("POST", `/projects/${name}/close`, h.control, { ref: TASK, reason: "superseded by the rewrite" })
      expect(closed.status).toBe(200)
      expect(closed.body.code).toBe(0)
      const done = await Bun.file(join(dir, "docs", TASK, "done.md")).text()
      expect(done).toContain("Closed: superseded by the rewrite")
      expect(await Bun.file(join(dir, "docs", TASK, "todo.md")).exists()).toBe(false)
      expect((await Bun.file(join(dir, "docs", "R-01", "P01-implement", "tasks.md")).text())).toContain(`- [x] ${TASK}`)
      const log = await gitOf(dir)("log", "--format=%s%n%b", "-3")
      expect(log).toContain("Auto-Stage: force-close")
      expect(log).toContain("superseded by the rewrite")
      // the explicit ref and the reason are the confirmation: no confirm field exists
      expect((await h.call("POST", `/projects/${name}/close`, h.control, { ref: TASK, reason: "x", confirm: true })).status).toBe(400)
      for (const [body, fragment] of [
        [{ reason: "x" }, "requires"],
        [{ ref: "T-1", reason: "x" }, "not a unit reference"],
        [{ ref: TASK }, "requires"],
        [{ ref: TASK, reason: "  " }, "non-empty"],
        [{ ref: TASK, reason: "two\nlines" }, "one line"],
        [{ ref: TASK, reason: "x", changes: "rebase" }, '"commit"|"stash"'],
      ] as const) {
        const answer = await h.call("POST", `/projects/${name}/close`, h.control, body)
        expect(answer.status).toBe(400)
        expect(String(answer.body.error)).toContain(fragment)
      }
      // a done unit and an unknown one are closeUnit's own refusals
      const again = await h.call("POST", `/projects/${name}/close`, h.control, { ref: TASK, reason: "again" })
      expect(again.status).toBe(409)
      expect(String(again.body.error)).toContain("already closed")
      const unknown = await h.call("POST", `/projects/${name}/close`, h.control, { ref: "T-099", reason: "x" })
      expect(unknown.status).toBe(409)
      expect(String(unknown.body.error)).toContain("not listed in any phase index")
      // an unconfigured directory has nothing to close into
      const blank = await gitBlank("auto-ops-closeblank-")
      const blankName = h.register(blank)
      const nothing = await h.call("POST", `/projects/${blankName}/close`, h.control, { ref: TASK, reason: "x" })
      expect(nothing.status).toBe(409)
      expect(String(nothing.body.error)).toContain("nothing to close")
      await rm(dir, { recursive: true, force: true })
      await rm(blank, { recursive: true, force: true })
    })
  })

  test("task-add over addTask: the document, the index line and the commit land through the core; the guard chain is planPrelude's own", async () => {
    await withOps(async (h) => {
      const dir = await fixtureProject("auto-ops-task-", {})
      const name = h.register(dir)
      const added = await h.call("POST", `/projects/${name}/tasks`, h.control, { title: "the second widget" })
      expect(added.status).toBe(200)
      expect(has(added.body, "✓ task T-002 added")).toBe(true)
      expect(has(added.body, "no session")).toBe(true)
      const todo = await Bun.file(join(dir, "docs", "T-002", "todo.md")).text()
      expect(todo).toContain("# T-002: the second widget")
      expect(todo).toContain("Added by `plan --new-task`")
      expect((await Bun.file(join(dir, "docs", "R-01", "P01-implement", "tasks.md")).text())).toContain("- [ ] T-002 the second widget")
      expect(await gitOf(dir)("log", "--format=%s", "-2")).toContain("PLAN add T-002 the second widget")
      // shape refusals
      for (const [body, fragment] of [
        [{}, "one-line task title"],
        [{ title: "two\nlines" }, "one line"],
        [{ title: "x", bogus: 1 }, "unknown task-add field"],
      ] as const) {
        const answer = await h.call("POST", `/projects/${name}/tasks`, h.control, body)
        expect(answer.status).toBe(400)
        expect(String(answer.body.error)).toContain(fragment)
      }
      // the guard chain: a configured directory with no round established is planPrelude's own refusal
      const unestablished = await gitBlank("auto-ops-taskround-")
      await saveProjectConfig(unestablished, { ...CONFIG_DEFAULTS })
      const unName = h.register(unestablished)
      const refused = await h.call("POST", `/projects/${unName}/tasks`, h.control, { title: "too early" })
      expect(refused.status).toBe(409)
      // The m-mode pre-round guard is the analysis flow's (plans/0084): the
      // core's own refusal names it and the opening command.
      expect(String(refused.body.error)).toContain("no round exists yet: the project analysis comes first")
      await rm(dir, { recursive: true, force: true })
      await rm(unestablished, { recursive: true, force: true })
    })
  })

  test("the planPrelude boundary matrix — the surviving no-agent routes are served, the boundary routes refuse naming transfer", async () => {
    await withOps(async (h) => {
      // The project start (row 0, plans/0101 D4): a phased project with no
      // round established refuses — the analysis, the establishment and the
      // first plan task's construction are the transfer operation's, and
      // the core's own refusal names it through the surface seam (the
      // subcommand itself is retired, plans/0283).
      const dir = await phasedProject("auto-ops-establish-", "am")
      await rm(join(dir, "docs"), { recursive: true, force: true })
      await gitOf(dir)("add", "-A")
      await gitOf(dir)("commit", "-qm", "drop the round")
      const name = h.register(dir)
      const refusedStart = await h.call("POST", `/projects/${name}/plan`, h.control)
      expect(refusedStart.status).toBe(409)
      expect(refusedStart.body.code).toBe(1)
      expect(has(refusedStart.body, "is transfer's")).toBe(true)
      expect(has(refusedStart.body, "the transfer operation (POST /projects/<p>/transfer)")).toBe(true)
      expect(await Bun.file(join(dir, "docs", "R-01", "phases.md")).exists()).toBe(false)
      // Re-establish through the core (the fixture's own writer — the
      // daemon-side establishment flow is the transfer operation's, below),
      // committed as the clean baseline the drift case needs.
      await establishRound(dir, { phases: "am" })
      await gitOf(dir)("add", "-A")
      await gitOf(dir)("commit", "-qm", "re-establish the round")
      // the m-mode notices (rows 8 and 9) are served, not refused
      const manual = await fixtureProject("auto-ops-mplan-", {})
      const manualName = h.register(manual)
      const listed = await h.call("POST", `/projects/${manualName}/plan`, h.control)
      expect(listed.status).toBe(200)
      expect(has(listed.body, "lists 1 task(s) (1 pending)")).toBe(true)
      // The served surface (plans/0193 D3 / 0165-056's S30-04): the next-act
      // line names this shell's true channels — the daemon's run and plan
      // protocol — never `opencode-auto-server run <dir>`, the subcommand
      // this binary refuses with its usage error (the run operation itself
      // retired with POST /runs, plans/0282; execute grants run the phase).
      expect(has(listed.body, "the executor protocol (POST /projects/<p>/executor/claim — execute grants)")).toBe(true)
      expect(has(listed.body, "the plan operation (POST /projects/<p>/plan)")).toBe(true)
      expect(has(listed.body, "opencode-auto-server run")).toBe(false)
      await rm(join(manual, "docs", "R-01", "P01-implement", "tasks.md"))
      const empty = await h.call("POST", `/projects/${manualName}/plan`, h.control)
      expect(empty.status).toBe(200)
      expect(has(empty.body, "no tasks listed")).toBe(true)
      // the drift refusal (row 3, 0206 D2): a mid-round phases reshape rides
      // its one channel — the released roadmap line (0137; the amend key is
      // retired, plans/0193 D4) — and plan refuses before any write naming
      // transfer as the reshape's apply; the committed re-derivation is the
      // advance's alone (the CLI mirror of this row: packages/auto's
      // phase-index-drift describe)
      await Bun.write(
        join(dir, "docs", "analysis.md"),
        "# Project analysis\n\nClarified: yes\n\n## Roadmap\n\n- R-01 adm — widen the round with a design phase\n",
      )
      await gitOf(dir)("add", "-A")
      await gitOf(dir)("commit", "-qm", "reshape R-01 by its roadmap line")
      const established = await Bun.file(join(dir, "docs", "R-01", "phases.md")).text()
      const refusedDrift = await h.call("POST", `/projects/${name}/plan`, h.control)
      expect(refusedDrift.status).toBe(409)
      expect(refusedDrift.body.code).toBe(1)
      expect(has(refusedDrift.body, "the phase index of round R-01 differs from the roadmap of docs/analysis.md")).toBe(true)
      expect(has(refusedDrift.body, "transfer re-derives the unstarted tail on its own commit")).toBe(true)
      expect(has(refusedDrift.body, "the transfer operation (POST /projects/<p>/transfer)")).toBe(true)
      // nothing written: the index keeps its established shape byte-for-byte
      // and no widened-phase directory or moved open-todo seed appears
      expect(await Bun.file(join(dir, "docs", "R-01", "phases.md")).text()).toBe(established)
      expect(await Bun.file(join(dir, "docs", "R-01", "P02-design", "todo.md")).exists()).toBe(false)
      expect(await Bun.file(join(dir, "docs", "R-01", "P03-implement", "todo.md")).exists()).toBe(false)
      expect(await Bun.file(join(dir, "docs", "R-01", "P02-implement", "todo.md")).exists()).toBe(true)
      // row 2 (plans/0101 D4): a phased COMPLETE round is transfer's too —
      // the round close and the next round's opening refuse here naming the
      // advance command (the round-close gate itself runs inside transfer).
      const closing = await phasedProject("auto-ops-roundclose-", "am")
      const closingName = h.register(closing)
      await phaseDone(closing, "P01-analysis")
      await phaseDone(closing, "P02-implement")
      const complete = await h.call("POST", `/projects/${closingName}/plan`, h.control)
      expect(complete.status).toBe(409)
      expect(complete.body.code).toBe(1)
      expect(has(complete.body, "complete and no plan task awaits dispatch")).toBe(true)
      expect(has(complete.body, "the transfer operation (POST /projects/<p>/transfer)")).toBe(true)
      expect(await Bun.file(join(closing, "docs", "R-02", "phases.md")).exists()).toBe(false)
      // an unconfigured directory refuses outright (the CLI's own rule)
      const blank = await gitBlank("auto-ops-planblank-")
      const blankName = h.register(blank)
      const nothing = await h.call("POST", `/projects/${blankName}/plan`, h.control)
      expect(nothing.status).toBe(409)
      expect(String(nothing.body.error)).toContain("nothing to plan")
      for (const d of [dir, manual, closing, blank]) await rm(d, { recursive: true, force: true })
    })
  })

  test("the plan unlock (P3c) — the agent-planning routes spawn planning runs; the request fields are the planning surface", async () => {
    await withOps(async (h) => {
      // The field vocabulary first (no spawn): input takes the text itself,
      // append rides an input, the CLI's local-file and flag spellings get
      // their pointers, newTask stays the task-add operation.
      const dir = await phasedProject("auto-ops-loop-", "am")
      const name = h.register(dir)
      expect((await h.call("POST", `/projects/${name}/plan`, h.control, { prompt: "plan this" })).status).toBe(400)
      expect((await h.call("POST", `/projects/${name}/plan`, h.control, { file: "/tmp/input.txt" })).status).toBe(400)
      // 0283: the append field is retired — the task-append session no
      // longer runs; the refusal teaches task-add and re-formulation.
      const bareAppend = await h.call("POST", `/projects/${name}/plan`, h.control, { append: true })
      expect(bareAppend.status).toBe(400)
      expect(String(bareAppend.body.error)).toContain("append\" is retired (plans/0283)")
      expect(String(bareAppend.body.error)).toContain("one task at a time")
      expect(String(bareAppend.body.error)).toContain("/tasks")
      const appendWithInput = await h.call("POST", `/projects/${name}/plan`, h.control, { append: true, input: "some input" })
      expect(appendWithInput.status).toBe(400)
      expect(String(appendWithInput.body.error)).toContain("append\" is retired (plans/0283)")
      const badInput = await h.call("POST", `/projects/${name}/plan`, h.control, { input: { text: "nested" } })
      expect(badInput.status).toBe(400)
      expect(String(badInput.body.error)).toContain('"input" takes the planning input text')
      const newTask = await h.call("POST", `/projects/${name}/plan`, h.control, { newTask: "a task" })
      expect(newTask.status).toBe(400)
      expect(String(newTask.body.error)).toContain("task-add operation")
      expect((await h.call("POST", `/projects/${name}/plan`, h.control, { bogus: 1 })).status).toBe(400)
      // 0282: the loop route answers the protocol teaching — the planning
      // session is pull-only work (the formulate grant), never a spawned
      // run; the input the request carried is refused by the prelude's
      // stops or persisted by nothing (this op spawns nothing).
      const loop = await h.call("POST", `/projects/${name}/plan`, h.control, { input: "plan this" })
      expect([200, 409]).toContain(loop.status)
      const loopBody = loop.body as { error?: string; lines?: string[] }
      expect(String(loopBody.error ?? loopBody.lines?.[0] ?? "").toLowerCase()).toContain("plan")
    })
  })

  // The 0135 info class through the API (plans/0160 D3): informational notes
  // are the recorded state, never drift — the dryrun answers the success
  // shape (the CLI's exit 0), and an apply with nothing fixable claims no
  // repair.
  test("fix: informational notes never gate — the dryrun is the success shape, the apply claims no repair", async () => {
    await withOps(async (h) => {
      const dir = await phasedProject("auto-ops-info-", "am")
      const name = h.register(dir)
      // A released roadmap whose R-01 line establishes a phases value that
      // diverges from the config key: the supersession note (info) is then
      // the layer's only finding.
      await Bun.write(
        join(dir, "docs", "analysis.md"),
        ["# Project analysis", "", "## Analysis", "", "- one widget.", "", "## Goals", "", "- migrate it.", "", "## Project brief", "", "- goal: migrated.", "", "## Roadmap", "", "- R-01 adm — migrate the widget", "", "Clarified: yes", ""].join("\n"),
      )
      const git = gitOf(dir)
      await git("add", "-A")
      await git("commit", "-qm", "the released roadmap diverges from the config key")
      const dry = await h.call("POST", `/projects/${name}/fix`, h.config, { dryrun: true })
      expect(dry.status).toBe(200)
      expect(dry.body.code).toBe(0)
      expect(has(dry.body, "config-layer notes")).toBe(true)
      expect(has(dry.body, "nothing to repair")).toBe(true)
      expect(((dry.body.findings as { class: string }[]) ?? []).every((finding) => finding.class === "info")).toBe(true)
      // the apply: no fixable finding, so no gate is asked and no repair
      // claimed — the honest result over an unchanged file
      const applied = await h.call("POST", `/projects/${name}/fix`, h.config, {})
      expect(applied.status).toBe(200)
      expect(has(applied.body, "\u2713 nothing to fix: the note(s) above are informational")).toBe(true)
      expect(has(applied.body, "repaired")).toBe(false)
      expect(JSON.parse(await Bun.file(join(dir, CONFIG_FILE)).text()).phases).toBe("am")
      await rm(dir, { recursive: true, force: true })
    })
  })

  // The transfer operation (the plans/0101 absorb): the advance command as a
  // spawned run — the whole state resolution inside the core's runTransfer
  // (no prelude seam to split), the run's own exit vocabulary mapping the
  // outcome. The project-start flow here is the headless phased start the
  // plan refusal unblocks: the analysis stub, the person's release, R-01's
  // establishment at the round-start gate.
  test("the transfer operation — the request shape, m mode's refusal, the nothing-to-advance stop, and the headless phased start through the analysis release", async () => {
    await withOps(async (h) => {
      // The person's analysis fill (the release-ready document): every
      // section carrying real content and one parsing roadmap line — the
      // release gate's own grammar (comments never count as content).
      const releasedAnalysis = [
        "# Project analysis",
        "",
        "## Analysis",
        "",
        "- one widget to migrate; the tree is small and self-contained.",
        "",
        "## Goals",
        "",
        "- migrate the widget to the new stack.",
        "",
        "## Project brief",
        "",
        "- goal: the widget migrated; the deliverable stands alone.",
        "",
        "## Roadmap",
        "",
        "- R-01 am — migrate the widget",
        "",
        "Clarified: yes",
        "",
      ].join("\n")
      // The field vocabulary first (no spawn): resynthesize is the one
      // field, everything else state-resolved.
      const dir = await phasedProject("auto-ops-xfer-", "am")
      const name = h.register(dir)
      for (const [body, fragment] of [
        [{ bogus: 1 }, "unknown transfer field"],
        [{ resynthesize: "yes" }, "resynthesize takes true|false"],
      ] as const) {
        const answer = await h.call("POST", `/projects/${name}/transfer`, h.control, body)
        expect(answer.status).toBe(400)
        expect(String(answer.body.error)).toContain(fragment)
      }
      // an unconfigured directory has nothing to advance
      const blank = await gitBlank("auto-ops-xferblank-")
      const blankName = h.register(blank)
      const nothing = await h.call("POST", `/projects/${blankName}/transfer`, h.control)
      expect(nothing.status).toBe(409)
      expect(String(nothing.body.error)).toContain("nothing to transfer")
      // m mode: the advance refuses — the deterministic op answers the
      // refused outcome (the core's own line; no session, no spawn).
      const manual = await fixtureProject("auto-ops-xferm-", {})
      const manualName = h.register(manual)
      const mStarted = await h.call("POST", `/projects/${manualName}/transfer`, h.control)
      expect(mStarted.status).toBe(409)
      expect(String(mStarted.body.error)).toContain("the advance held")
      // the fixture's established round with an empty task index: the
      // deterministic advance CONSTRUCTS the phase's formulation floor and
      // stops at the review seam — the exit-0 shape (the construction the
      // driver's own, the synthesize/formulate grants the follow-ups).
      const pending = await h.call("POST", `/projects/${name}/transfer`, h.control)
      expect(pending.status).toBe(200)
      expect((pending.body.lines as string[])[0]).toContain("the advance completed its apply and stopped")
      const index = (await readdir(join(dir, "docs", "R-01"), { recursive: true })).filter((entry) => String(entry).endsWith("tasks.md"))
      expect(index.length).toBeGreaterThan(0)
      // the headless phased start: drop the round, transfer opens the
      // analysis (the stub written uncommitted for the person).
      const start = await phasedProject("auto-ops-xferstart-", "am")
      await rm(join(start, "docs"), { recursive: true, force: true })
      await gitOf(start)("add", "-A")
      await gitOf(start)("commit", "-qm", "drop the round")
      const startName = h.register(start)
      const opened = await h.call("POST", `/projects/${startName}/transfer`, h.control)
      expect([200, 409]).toContain(opened.status)
      expect(await Bun.file(join(start, "docs", "analysis.md")).exists()).toBe(true)
      // the person fills and releases (their document, their commit — or the
      // deterministic clarify op, the release act's one command)
      await Bun.write(join(start, "docs", "analysis.md"), releasedAnalysis)
      const git = gitOf(start)
      await git("add", "-A")
      await git("commit", "-qm", "the person releases the analysis")
      const established = await h.call("POST", `/projects/${startName}/transfer`, h.control)
      expect([200, 409]).toContain(established.status)
      expect(await Bun.file(join(start, "docs", "R-01", "phases.md")).exists()).toBe(true)
      for (const d of [dir, manual, blank, start]) await rm(d, { recursive: true, force: true })
    })
  }, 240_000)

  // The intent threading (plans/0288, 0286 F1's fix): the operation's
  // deterministic opts carried every config key except `intent`, so the
  // advance's pack-dependent halves read the built-in default pack on any
  // intent-bearing project — the field's wall-admission finding ("no
  // instrument", the igb boundary) reproduced here end to end: the sealing
  // phase's advance holds on the missing regression-cost lane row while the
  // project's own materialized pack declares it, and the wall closes once
  // the key rides. The plan and task-add literals share the shape (their
  // prelude arms have no reachable intent consumer today — the audit's
  // latent half; the key rides for the day one grows).
  test("the transfer operation threads the project's intent — the wall's admission reads the materialized pack, not the default", async () => {
    await withOps(async (h) => {
      // The wall-project shape (auto-core test/wall.test.ts's fixture): a
      // sealing phase type, a corpus behind a tracked root symlink with the
      // stamped allow, the phase's artifacts done, a valid handover — plus
      // this ruling's own ingredient: the lane pack materialized under the
      // project's OWN intent name (config intent "site-pack"), never the
      // default overlay, so the default-pack read is the measured defect.
      const dir = await gitBlank("auto-ops-intent-")
      const corpus = await mkdtemp(join(homedir(), "auto-ops-intent-corpus-"))
      await Bun.write(join(corpus, "timer.c"), "void tick(void) {}\n")
      await Bun.write(join(dir, ".gitignore"), ".auto/\ntmp/\nopencode.json\n")
      await mkdir(join(dir, ".opencode", "auto", "phases"), { recursive: true })
      await Bun.write(join(dir, ".opencode", "auto", "phases", "spec-read.md"), [
        "# Spec read", "", "Wall: seal linux", "Phase-artifacts: spec-notes.md", "Task-artifacts: notes.md", "", "## plan duties", "", "Read the reference, distill the notes.", "", "<!-- auto: eof -->", "",
      ].join("\n"))
      await mkdir(join(dir, ".opencode", "auto", "intents"), { recursive: true })
      await Bun.write(join(dir, ".opencode", "auto", "intents", "site-pack.md"), [
        "# site-pack", "", "## quality", "", "### test-lanes", "", "divergence:", "Command: true", "Cost: regression", "Surfaces: .", "Exclusive: no", "",
      ].join("\n"))
      await saveProjectConfig(dir, { ...CONFIG_DEFAULTS, phases: "spec-read,implement", intent: "site-pack" })
      await Bun.write(join(dir, "opencode.json"), JSON.stringify({ permission: { external_directory: { [`${corpus}/**`]: "allow" } } }, null, 2) + "\n")
      await symlink(corpus, join(dir, "linux"))
      await establishRound(dir, { phases: "spec-read,implement" })
      const phase = join("docs", "R-01", "P01-spec-read")
      await Bun.write(join(dir, phase, "spec-notes.md"), "# Spec notes\n\nBehavior only.\n\n<!-- auto: eof -->\n")
      await Bun.write(join(dir, phase, "tasks.md"), "# Tasks\n\n- [x] T-001 read the timer\n")
      await Bun.write(join(dir, phase, "handover.md"), [
        "# Handover (R-01.P01)", "", "## Key decisions", "", "- behavior only.", "", "## Constraints and pitfalls", "", "- none.", "", "## Required reading for the next phase", "", "- spec-notes.md", "", "## Artifact index", "", "- spec-notes.md", "",
      ].join("\n"))
      await mkdir(join(dir, "docs", "T-001"), { recursive: true })
      await Bun.write(join(dir, "docs", "T-001", "done.md"), "# T-001 read the timer\n\nPhase: R-01.P01\n\n## Goal\n\nRead the timer.\n\n## Scope\n\nThe spec notes.\n\n## Acceptance\n\nThe notes exist.\n")
      await Bun.write(join(dir, "docs", "T-001", "notes.md"), "# Notes (T-001)\n\nContracts at the boundary.\n\n<!-- auto: eof -->\n")
      const git = gitOf(dir)
      await git("add", "-A")
      await git("commit", "-qm", "the spec room's work, door standing")
      const name = h.register(dir)
      const advanced = await h.call("POST", `/projects/${name}/transfer`, h.control)
      // The wall closed: the admission found the project's own lane row
      // (green at the tree about to go clean), the door is gone and the
      // allow retired to the deny — the pre-fix shape held the boundary on
      // the default pack's missing instrument instead (the door standing).
      expect([200, 409]).toContain(advanced.status)
      expect(existsSync(join(dir, "linux"))).toBe(false)
      expect(JSON.parse(await Bun.file(join(dir, "opencode.json")).text()).permission.external_directory).toEqual({ [`${corpus}/**`]: "deny" })
      expect(await findWallCommit(dir)).toBeDefined()
      await rm(corpus, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    })
  }, 240_000)

  // The reconcile operation (plans/0287, 0285's person-terminus): the
  // executor ledger's dead-letter reconciliation over the coordinator — the
  // automatic sweep (a person-completed unit's expired unbooked lease) and
  // the honest answers (nothing to do, no lease on the unit, the request
  // vocabulary, the scope, the lock family's 423).
  test("the reconcile operation — the automatic sweep books a person-completed unit's dead lease; the field vocabulary, scope and lock answers", async () => {
    await withOps(async (h) => {
      const dir = await phasedProject("auto-ops-reconcile-", "implement")
      // One person-completed unit (the done rename and the tick, the 0274
      // amendment class) and one open unit behind it.
      const plan = join("docs", "R-01", "P01-implement")
      await mkdir(join(dir, plan), { recursive: true })
      await Bun.write(join(dir, plan, "tasks.md"), "# Tasks\n\n- [x] T-001 First\n- [ ] T-002 Second\n")
      await mkdir(join(dir, "docs", "T-001"), { recursive: true })
      await mkdir(join(dir, "docs", "T-002"), { recursive: true })
      await Bun.write(join(dir, "docs", "T-001", "done.md"), "# First\n\n## Goal\n\nDone by the person.\n")
      await Bun.write(join(dir, "docs", "T-002", "todo.md"), "# Second\n\n## Goal\n\nOpen work.\n")
      const git = gitOf(dir)
      await git("add", "-A")
      await git("-c", "user.name=Person", "-c", "user.email=person@example.invalid", "commit", "-qm", "person: complete T-001")
      // The dead lease: an expired execute grant over the completed unit,
      // never booked — the field shape of plans/0285.
      const ledger = join(dir, ".auto", "executor-progress.json")
      await mkdir(join(dir, ".auto"), { recursive: true })
      const base = (await git("rev-parse", "HEAD")).trim()
      await Bun.write(ledger, JSON.stringify([{
        grant: { id: "T-001 exec 1", kind: "execute", unit: "T-001", title: "First", prompt: "", lease: "dead-lease", attempt: 1, workspace: dir, deadline: 1, budget: 60 },
        holder: { token: "worker", channel: "work" },
        base,
        issued: 1,
      }]))
      const name = h.register(dir)
      // The field vocabulary and the scope.
      expect((await h.call("POST", `/projects/${name}/reconcile`, h.control, { task: "T-001" })).status).toBe(400)
      expect((await h.call("POST", `/projects/${name}/reconcile`, h.control, { unit: 7 })).status).toBe(400)
      expect((await h.call("POST", `/projects/${name}/reconcile`, h.read, {})).status).toBe(403)
      // The automatic sweep books the dead letter with the finding line
      // (every op's head sweeps — this is the first op to open the
      // coordinator).
      const swept = await h.call("POST", `/projects/${name}/reconcile`, h.control, {})
      expect(swept.status).toBe(200)
      expect(JSON.stringify(swept.body)).toContain("reconciled the dead lease T-001 exec 1 on T-001")
      expect(JSON.stringify(swept.body)).toContain("the person's completion")
      // The honest no-lease answer for an unleased unit.
      const none = await h.call("POST", `/projects/${name}/reconcile`, h.control, { unit: "T-002" })
      expect(none.status).toBe(200)
      expect(JSON.stringify(none.body)).toContain("no lease stands on T-002")
      const entries = JSON.parse(await Bun.file(ledger).text()) as { booking?: { receipt?: { kind: string; by: string } } }[]
      expect(entries[0]!.booking?.receipt).toEqual({ kind: "reconciled", by: "person-completion" })
      // Idempotent: the second sweep answers nothing-to-do.
      const again = await h.call("POST", `/projects/${name}/reconcile`, h.control, {})
      expect(again.status).toBe(200)
      expect(JSON.stringify(again.body)).toContain("nothing to reconcile")
      // The lock family's answer beside a live holder.
      const releaseHolder = await plantLiveLock(dir)
      try {
        const held = await h.call("POST", `/projects/${name}/reconcile`, h.control, {})
        expect(held.status).toBe(423)
        expect(String(held.body.error)).toContain("holds the run lock")
      } finally {
        await releaseHolder()
        await rm(dir, { recursive: true, force: true })
      }
    })
  })

  test("models: read-only, no lock, the table's own exit vocabulary; the probe is the POST route (P4b)", async () => {
    await withOps(async (h) => {
      const dir = await fixtureProject("auto-ops-models-", {})
      const name = h.register(dir)
      const table = await h.call("GET", `/projects/${name}/models`, h.read)
      expect(table.status).toBe(200)
      expect(table.body.code).toBe(0)
      expect(table.body.problems).toEqual([])
      expect(has(table.body, "model registry: implicit")).toBe(true)
      expect(String(table.body.operatorPath)).toContain("models.json")
      // the probe is its own POST route behind its own scope — not a query
      // parameter on the free table
      const query = await h.call("GET", `/projects/${name}/models?probe=1`, h.read)
      expect(query.status).toBe(400)
      expect(String(query.body.error)).toContain("the POST route")
      expect((await h.call("GET", `/projects/${name}/models?bogus=1`, h.read)).status).toBe(400)
      // the probe's scope tier: read does not carry it, and no default token
      // set does — the gate is the scope itself
      const probeDenied = await h.call("POST", `/projects/${name}/models`, h.read, { probe: true, confirm: true })
      expect(probeDenied.status).toBe(403)
      expect(String(probeDenied.body.error)).toContain('"probe" scope')
      // a broken project layer is a problem a run start would refuse → the CLI's exit 1
      await Bun.write(join(dir, ".opencode", "auto", "models.json"), "{ not json")
      const broken = await h.call("GET", `/projects/${name}/models`, h.read)
      expect(broken.status).toBe(409)
      expect(broken.body.code).toBe(1)
      expect((broken.body.problems as string[]).some((problem) => problem.includes("models.json"))).toBe(true)
      await rm(dir, { recursive: true, force: true })
    })
  })

  test("the lock rules: the config ops refuse under a planted live holder, the lock-acquiring ops answer 423, and the read-only halves run beside it", async () => {
    await withOps(async (h) => {
      const dir = await fixtureProject("auto-ops-locked-", {})
      // complete the config layer the way init does (the ignore set's local-only
      // entries included), so the drift gate is clean; no brief — init writes
      // none (plans/0133), and a missing brief is no finding
      await Bun.write(join(dir, "opencode.json"), await Bun.file(templateConfig).text())
      await ensurePointer(dir, { testByDriver: false })
      await ensureInitGitignore(dir)
      const git = gitOf(dir)
      await git("add", "-A")
      await git("commit", "-qm", "config layer complete")
      const name = h.register(dir)
      const releaseHolder = await plantLiveLock(dir)
      try {
        for (const [op, token, body] of [
          ["init", h.config, {}],
          ["amend", h.config, { config: { contextLimit: 48 } }],
          ["reset", h.config, { confirm: true }],
          ["fix", h.config, { confirm: true }],
        ] as const) {
          const answer = await h.call("POST", `/projects/${name}/${op}`, token, body)
          expect(answer.status).toBe(423)
          expect(String(answer.body.error)).toContain("holds the run lock")
        }
        for (const [op, body] of [
          ["close", { ref: TASK, reason: "x" }],
          ["tasks", { title: "x" }],
          ["plan", {}],
          ["reconcile", {}],
        ] as const) {
          const answer = await h.call("POST", `/projects/${name}/${op}`, h.control, body)
          expect(answer.status).toBe(423)
          expect(String(answer.body.error)).toContain("holds the run lock")
        }
        // beside the live holder: the read-only halves (the CLI's own skip list)
        expect((await h.call("POST", `/projects/${name}/fix`, h.config, { dryrun: true })).status).toBe(200)
        expect((await h.call("GET", `/projects/${name}/models`, h.read)).status).toBe(200)
      } finally {
        await releaseHolder()
        await rm(dir, { recursive: true, force: true })
      }
    })
  })

  test("the operations write nothing of the driver's own state: no .auto/ writes, no unit renames, no index ticks outside the core", async () => {
    await withOps(async (h) => {
      const dir = await fixtureProject("auto-ops-writes-", {})
      const name = h.register(dir)
      const init = await h.call("POST", `/projects/${name}/init`, h.config, { confirm: true, cleanTree: true })
      expect(init.status).toBe(200)
      // init never commits either (the diff is left for review); the close
      // that follows holds the same clean-tree rule the CLI's does
      const git = gitOf(dir)
      await git("add", "-A")
      await git("commit", "-qm", "the init overwrite")
      const closed = await h.call("POST", `/projects/${name}/close`, h.control, { ref: TASK, reason: "checking writes" })
      expect(closed.status).toBe(200)
      // .auto/ holds no lock of this operation (the core released it)
      const auto = await readdir(join(dir, ".auto")).catch(() => [] as string[])
      expect(auto.filter((entry) => entry === "run.lock")).toEqual([])
      // the only todo.md → done.md rename and index tick are the core's (closeUnit's own)
      expect(await Bun.file(join(dir, "docs", TASK, "done.md")).exists()).toBe(true)
      await rm(dir, { recursive: true, force: true })
    })
  })
})

// The acceptance grep, as a test: no module of this package writes into a
// target directory's `.auto/`, `docs/` unit state or an index file — the
// operations reach disk only through the core's functions.
describe("the write boundary of the operations (constitutional)", () => {
  test("the package's own source holds no direct write into .auto/, docs/ or an index file of a target directory", async () => {
    const src = join(import.meta.dir, "..", "src")
    const offenders: string[] = []
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) await walk(path)
        else if (/\.ts$/.test(entry.name)) {
          const text = await Bun.file(path).text()
          for (const match of text.matchAll(/Bun\.write\(/g)) {
            const line = text.slice(0, match.index ?? 0).split("\n").length
            const around = text.slice(match.index ?? 0, (match.index ?? 0) + 160)
            if (/\.auto|docs|phases\.md|tasks\.md|done\.md|todo\.md/.test(around)) offenders.push(`${path.replace(src + "/", "")}:${line}: ${around.split("\n")[0]}`)
          }
        }
      }
    }
    await walk(src)
    expect(offenders.join("\n")).toBe("")
  })
})
