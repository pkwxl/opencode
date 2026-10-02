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
//     the drift re-sync, the refusal stops), and — since the P3c unlock —
//     the agent-planning routes spawning planning runs (202 + the run
//     resource, the task landing through the core's planning step);
//   - the auth matrix per scope and the whitelist for operations;
//   - the lock rules: the config ops' 423 under a planted live holder, the
//     lock-acquiring ops' 423, and the registry's retryable 409 beside a
//     live run of this daemon (a real worker over the fake `claude`).
import { describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"
import { startDaemon, type DaemonHandle } from "../src/daemon"
import { DaemonStore } from "../src/store"
import { CONFIG_DEFAULTS, CONFIG_FILE, saveProjectConfig } from "@opencode-ai/auto-core/config"
import { renderAgentContract } from "@opencode-ai/auto-core/config-fix"
import { renderProjectBrief } from "@opencode-ai/auto-core/brief"
import { ensurePointer } from "@opencode-ai/auto-core/agents-block"
import { ensureInitGitignore } from "@opencode-ai/auto-core/gitignore"
import { establishRound } from "@opencode-ai/auto-core/phases"
import { fakeAgent, fixtureProject, gitOf, scrubbedEnv, TASK } from "./fixtures/project"
import templateConfig from "@opencode-ai/auto-core/templates/opencode.json" with { type: "file" }

// The daemon serves operations from this process: the scrubbed-env
// conventions of the shared fixtures must hold for anything it spawns.
process.env.XDG_CONFIG_HOME = scrubbedEnv().XDG_CONFIG_HOME

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
  await Bun.write(join(dir, ".opencode", "auto", "brief.md"), renderProjectBrief())
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

  test("init freezes the config layer over the core's writers: config.json, the brief stub, the contract, the AGENTS.md block, opencode.json, the ignore set", async () => {
    await withOps(async (h) => {
      const dir = await gitBlank("auto-ops-init-")
      const name = h.register(dir)
      const answer = await h.call("POST", `/projects/${name}/init`, h.config, { config: { phases: "am", contextLimit: 32 } })
      expect(answer.status).toBe(200)
      expect(answer.body.code).toBe(0)
      expect(has(answer.body, "created: opencode.json")).toBe(true)
      expect(has(answer.body, `created: ${join(".opencode", "agent", "auto.md")}`)).toBe(true)
      expect(has(answer.body, "appended: AGENTS.md opencode-auto block")).toBe(true)
      expect(has(answer.body, "establishes round R-01")).toBe(true)
      const stored = JSON.parse(await Bun.file(join(dir, CONFIG_FILE)).text())
      expect(stored.phases).toBe("am")
      expect(stored.contextLimit).toBe(32)
      expect(stored.mode).toBe("migrate")
      expect(await Bun.file(join(dir, ".opencode", "auto", "brief.md")).exists()).toBe(true)
      expect(await Bun.file(join(dir, "opencode.json")).exists()).toBe(true)
      expect((await Bun.file(join(dir, "AGENTS.md")).text()).includes("<!-- opencode-auto:start -->")).toBe(true)
      expect(await Bun.file(join(dir, ".gitignore")).text()).toContain(".auto/")
      // init writes no rounds: docs/ is untouched (plan establishes rounds)
      expect(await Bun.file(join(dir, "docs", "R-01", "phases.md")).exists()).toBe(false)
      expect(answer.body.project).toBe(name)
      expect(String(answer.body.directory)).toBe(realpathSync(dir))
      await rm(dir, { recursive: true, force: true })
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
      // the guard: P01 done, a phases value that would drop it is refused before any write
      await phaseDone(dir, "P01-analysis")
      const guard = await h.call("POST", `/projects/${name}/amend`, h.config, { config: { phases: "m" } })
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

  test("reset: the plan is answered before the gates apply it; a filled brief is kept, a stub removed, and docs/ is never touched", async () => {
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
      expect(brief?.reason).toContain("filled in")
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
      expect(String(refused.body.error)).toContain("round R-01 is not established yet")
      await rm(dir, { recursive: true, force: true })
      await rm(unestablished, { recursive: true, force: true })
    })
  })

  test("the planPrelude boundary matrix — the no-agent routes are served with their lines and codes", async () => {
    await withOps(async (h) => {
      // round establishment (row 1): a phased project init never configured rounds for
      const dir = await phasedProject("auto-ops-establish-", "am")
      await rm(join(dir, "docs"), { recursive: true, force: true })
      await gitOf(dir)("add", "-A")
      await gitOf(dir)("commit", "-qm", "drop the round")
      const name = h.register(dir)
      const established = await h.call("POST", `/projects/${name}/plan`, h.control)
      expect(established.status).toBe(200)
      expect(established.body.code).toBe(0)
      expect(has(established.body, "✓ round R-01 established: P01-analysis, P02-implement")).toBe(true)
      expect(has(established.body, "round-start gate")).toBe(true)
      expect(await Bun.file(join(dir, "docs", "R-01", "phases.md")).exists()).toBe(true)
      // the m-mode notices (rows 8 and 9) are served, not refused
      const manual = await fixtureProject("auto-ops-mplan-", {})
      const manualName = h.register(manual)
      const listed = await h.call("POST", `/projects/${manualName}/plan`, h.control)
      expect(listed.status).toBe(200)
      expect(has(listed.body, "lists 1 task(s) (1 pending)")).toBe(true)
      await rm(join(manual, "docs", "R-01", "P01-implement", "tasks.md"))
      const empty = await h.call("POST", `/projects/${manualName}/plan`, h.control)
      expect(empty.status).toBe(200)
      expect(has(empty.body, "no tasks listed")).toBe(true)
      // the drift re-sync (row 3): a mid-round phases change surfaces as a drift plan reconciles
      const amended = await h.call("POST", `/projects/${name}/amend`, h.config, { config: { phases: "adm" } })
      expect(amended.status).toBe(200)
      const resynced = await h.call("POST", `/projects/${name}/plan`, h.control)
      expect(resynced.status).toBe(200)
      expect(has(resynced.body, "phase index of round R-01 re-synced")).toBe(true)
      expect(has(resynced.body, "P02-design")).toBe(true)
      const index = await Bun.file(join(dir, "docs", "R-01", "phases.md")).text()
      expect(index).toContain("P03 implement")
      expect(await Bun.file(join(dir, "docs", "R-01", "P03-implement", "todo.md")).exists()).toBe(true)
      expect(await Bun.file(join(dir, "docs", "R-01", "P02-implement", "todo.md")).exists()).toBe(false)
      // the round-close gate (row 2): a failing check is the stop-2 refusal, a passing one opens the next round
      const closing = await phasedProject("auto-ops-roundclose-", "am")
      const closingName = h.register(closing)
      await phaseDone(closing, "P01-analysis")
      await phaseDone(closing, "P02-implement")
      const failed = await h.call("POST", `/projects/${closingName}/plan`, h.control)
      expect(failed.status).toBe(409)
      expect(failed.body.code).toBe(2)
      expect(has(failed.body, "does not pass its round-close checks")).toBe(true)
      expect(has(failed.body, "round R-02 cannot open yet")).toBe(true)
      await closeListed(closing)
      const passed = await h.call("POST", `/projects/${closingName}/plan`, h.control)
      expect(passed.status).toBe(200)
      expect(has(passed.body, "✓ round close checks passed")).toBe(true)
      expect(has(passed.body, "✓ round R-02 established")).toBe(true)
      expect(await Bun.file(join(closing, "docs", "R-02", "phases.md")).exists()).toBe(true)
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
      const bareAppend = await h.call("POST", `/projects/${name}/plan`, h.control, { append: true })
      expect(bareAppend.status).toBe(400)
      expect(String(bareAppend.body.error)).toContain("append")
      expect(String(bareAppend.body.error)).toContain("input")
      const badInput = await h.call("POST", `/projects/${name}/plan`, h.control, { input: { text: "nested" } })
      expect(badInput.status).toBe(400)
      expect(String(badInput.body.error)).toContain('"input" takes the planning input text')
      const newTask = await h.call("POST", `/projects/${name}/plan`, h.control, { newTask: "a task" })
      expect(newTask.status).toBe(400)
      expect(String(newTask.body.error)).toContain("task-add operation")
      expect((await h.call("POST", `/projects/${name}/plan`, h.control, { bogus: 1 })).status).toBe(400)
      // The loop route now spawns the planning session as a run (P1's 501
      // is lifted): a real worker over the fake `claude`, the m-mode
      // project with an empty index and a planning input — the planning
      // session lands the task and the run completes with the plan exit 0.
      const manual = await phasedProject("auto-ops-mspawn-", "m", { agent: "claude" })
      await Bun.write(join(manual, "docs", "R-01", "P01-implement", "tasks.md"), "# Tasks\n")
      await gitOf(manual)("add", "-A")
      await gitOf(manual)("commit", "-qm", "empty the index")
      const manualName = h.register(manual)
      const agent = await fakeAgent()
      const before: Record<string, string | undefined> = {}
      for (const [key, value] of Object.entries(agent.env)) {
        before[key] = process.env[key]
        process.env[key] = value
      }
      try {
        const started = await h.call("POST", `/projects/${manualName}/plan`, h.control, { input: "plan the widget migration" })
      expect(started.status).toBe(202)
      expect(String(started.body.id)).toMatch(/^run-/)
      expect(String(started.body.interactive)).toBe(`/runs/${started.body.id}/interactive`)
      expect(has(started.body, "planning session started as run"))
      // The spawned planning run reaches the plan stop condition: exit 0,
      // the task landed in the phase's index through the core's planning
      // step (the fake agent writes exactly one).
      const id = String(started.body.id)
      const deadline = Date.now() + 120_000
      for (;;) {
        const run = (await (await fetch(`${h.daemon.url}/runs/${id}`, { headers: { authorization: `Bearer ${h.read}` } })).json()) as { state: string; code: number | null; live: boolean; tail: string }
        if (!run.live) {
          expect(run.state, run.tail).toBe("completed")
          expect(run.code).toBe(0)
          break
        }
        if (Date.now() > deadline) throw new Error(`the planning run never settled: ${JSON.stringify(run)}`)
        await Bun.sleep(200)
      }
      const index = await Bun.file(join(manual, "docs", "R-01", "P01-implement", "tasks.md")).text()
      expect(index).toMatch(/- \[ \] T-\d{3} task T-\d{3}/)
      } finally {
        for (const [key, value] of Object.entries(before)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
        await agent.done()
      }
      await rm(dir, { recursive: true, force: true })
      await rm(manual, { recursive: true, force: true })
    })
  }, 180_000)

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
      // entries included), so the drift gate is clean
      await Bun.write(join(dir, "opencode.json"), await Bun.file(templateConfig).text())
      await Bun.write(join(dir, ".opencode", "auto", "brief.md"), renderProjectBrief())
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

  test("beside a live run of this daemon the write operations answer 409 retryable, naming the run", async () => {
    await withOps(async (h) => {
      const agent = await fakeAgent({ FAKE_CLAUDE_DELAY_MS: "700", FAKE_CLAUDE_LEAD_CONTEXT: "90000" })
      const before: Record<string, string | undefined> = {}
      for (const [key, value] of Object.entries(agent.env)) {
        before[key] = process.env[key]
        process.env[key] = value
      }
      let dir: string | undefined
      try {
        dir = await fixtureProject("auto-ops-liverun-", {})
        // complete the config layer the way init does, so the drift gate is clean
        await Bun.write(join(dir, "opencode.json"), await Bun.file(templateConfig).text())
        await Bun.write(join(dir, ".opencode", "auto", "brief.md"), renderProjectBrief())
        await ensurePointer(dir, { testByDriver: false })
        await ensureInitGitignore(dir)
        const git = gitOf(dir)
        await git("add", "-A")
        await git("commit", "-qm", "config layer complete")
        const name = h.register(dir)
        const spawn = await fetch(`${h.daemon.url}/runs`, {
          method: "POST",
          headers: { authorization: `Bearer ${h.control}`, "content-type": "application/json" },
          body: JSON.stringify({ project: name, switches: { OPENCODE_AUTO_AGENT: "claude" } }),
        })
        expect(spawn.status).toBe(202)
        const { id } = (await spawn.json()) as { id: string }
        // wait until the worker holds the lock
        for (let at = 0; ; at++) {
          const run = (await (await fetch(`${h.daemon.url}/runs/${id}`, { headers: { authorization: `Bearer ${h.read}` } })).json()) as { state: string }
          if (run.state === "running") break
          if (at > 300) throw new Error("the run was never observed running")
          await Bun.sleep(100)
        }
        const refused = await h.call("POST", `/projects/${name}/init`, h.config, {})
        expect(refused.status).toBe(409)
        expect(String(refused.body.error)).toContain("a run is already active")
        expect((refused.body.run as { id: string }).id).toBe(id)
        expect(String(refused.body.retry)).toContain("terminal state")
        // the read-only halves run beside it: models answers 200, and the fix
        // dryrun answers the drift gate's own verdict (its findings' 409 or
        // the clean 200) — never the registry's refusal, never the lock's
        expect((await h.call("GET", `/projects/${name}/models`, h.read)).status).toBe(200)
        const dry = await h.call("POST", `/projects/${name}/fix`, h.config, { dryrun: true })
        expect([200, 409]).toContain(dry.status)
        expect(String(dry.body.error ?? "")).not.toContain("a run is already active")
        expect(String(dry.body.error ?? "")).not.toContain("run lock")
        for (let at = 0; ; at++) {
          const run = (await (await fetch(`${h.daemon.url}/runs/${id}`, { headers: { authorization: `Bearer ${h.read}` } })).json()) as { live: boolean; state: string }
          if (!run.live) break
          if (at > 900) throw new Error(`the run never settled: ${run.state}`)
          await Bun.sleep(200)
        }
      } finally {
        for (const [key, value] of Object.entries(before)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
        await agent.done()
        if (dir) await rm(dir, { recursive: true, force: true })
      }
    })
  }, 180_000)

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
