// The Web client's WRITE surface against a fixture daemon and real runs
// (T-097, P4b): every mutation path exercised through the CLIENT'S OWN
// transport (web/api.ts, web/interactive.ts) against `startDaemon` — the
// same code the browser loads. The acceptance matrix:
//   - scope-gated routing: each write surface answers 403 naming its scope
//     for a token without it (control the units, config the config ops,
//     probe the probe) — the client's UI gating (surfaceVisible) is the
//     pure suite's pin; here the daemon's half of the same matrix holds;
//   - the confirm / clean-tree two-step: each step independently refusable
//     — the daemon answers 428/409 with its own gate field, the client's
//     answerGate adds exactly that field, and REFUSING a step (never
//     sending) leaves the target unchanged;
//   - the write operations land through the core: close and task-add reach
//     disk as the core's own artifacts (the Closed: field, the index tick,
//     the commits);
//   - the plan surface: the no-agent vocabulary refusals, and the planning
//     session spawned as a run whose questions ride the interactive channel
//     — the plan → run → tasks-land half of the centerpiece flow (the fake
//     `claude` cannot raise an agent question — the claude adapter's
//     capability table turns them off — so the answer → tasks-land half is
//     pinned on the driver's own between-tasks ask over the SAME channel,
//     queue and answer scope a planning question rides);
//   - the probe gate: disabled by default (no scope → 403), scope alone is
//     not enough (confirm → 428), confirmed probes fire once per daemon
//     rate window (the immediate second → 429 naming the reopen instant),
//     and a registry-less directory answers "nothing to probe" WITHOUT
//     consuming the window.
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { basename, join } from "node:path"
import { tmpdir } from "node:os"
import { startDaemon, type DaemonHandle } from "../src/daemon"
import { DaemonStore } from "../src/store"
import { CONFIG_DEFAULTS, CONFIG_FILE, saveProjectConfig, type ProjectConfig } from "@opencode-ai/auto-core/config"
import { renderAgentContract } from "@opencode-ai/auto-core/config-fix"
import { renderProjectBrief } from "@opencode-ai/auto-core/brief"
import { ensurePointer } from "@opencode-ai/auto-core/agents-block"
import { ensureInitGitignore } from "@opencode-ai/auto-core/gitignore"
import { establishRound } from "@opencode-ai/auto-core/phases"
import { fakeAgent, fixtureProject, gitOf, scrubbedEnv, TASK } from "./fixtures/project"
import templateConfig from "@opencode-ai/auto-core/templates/opencode.json" with { type: "file" }
import { AutoApi, ApiError } from "../web/api"
import { answerGate } from "../web/render"
import { InteractiveSession } from "../web/interactive"

process.env.XDG_CONFIG_HOME = scrubbedEnv().XDG_CONFIG_HOME

type Harness = {
  daemon: DaemonHandle
  read: string
  control: string
  answer: string
  config: string
  probe: string
  register: (dir: string) => string
}

async function withHarness(fn: (h: Harness) => Promise<void>): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "auto-server-write-data-"))
  const store = new DaemonStore(dataDir)
  const read = store.issueToken("read", "reader").token
  const control = store.issueToken("control", "controller").token
  const answer = store.issueToken("answer", "answerer").token
  const config = store.issueToken("config", "configurer").token
  const probe = store.issueToken("read,probe", "prober").token
  const daemon = await startDaemon({ dataDir, port: 0 })
  try {
    await fn({ daemon, read, control, answer, config, probe, register: (dir) => store.register(dir).name })
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

// A configured, committed, fully-initialized project in a phased mode — the
// config-op fixture (ops.test.ts's phasedProject, local to that file, rebuilt
// here for this suite's own fixtures).
async function phasedProject(prefix: string, phases: string, extra: Partial<ProjectConfig> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  const git = gitOf(dir)
  await git("init")
  await git("config", "user.email", "write@auto-server.test")
  await git("config", "user.name", "write e2e")
  await saveProjectConfig(dir, { ...CONFIG_DEFAULTS, phases, ...extra })
  await Bun.write(join(dir, ".opencode", "agent", "auto.md"), await renderAgentContract(false))
  await Bun.write(join(dir, "opencode.json"), await Bun.file(templateConfig).text())
  await Bun.write(join(dir, ".opencode", "auto", "brief.md"), renderProjectBrief())
  await ensureInitGitignore(dir)
  await establishRound(dir, { phases })
  await ensurePointer(dir, { testByDriver: false })
  await git("add", "-A")
  await git("commit", "-qm", "baseline")
  return dir
}

// The refusal an ApiError carries, as the gate helpers read it.
async function refusal(call: () => Promise<Record<string, unknown>>): Promise<ApiError> {
  try {
    await call()
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error("the daemon accepted what the test expected to refuse")
}

const linesOf = (body: Record<string, unknown>): string[] => (Array.isArray(body.lines) ? body.lines.filter((line): line is string => typeof line === "string") : [])

async function waitFor(what: string, predicate: () => boolean, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`${what} never happened`)
    await Bun.sleep(100)
  }
}

type RunView = { id: string; state: string; code: number | null; live: boolean; tail: string }

async function untilTerminal(api: AutoApi, id: string, timeoutMs = 180_000): Promise<RunView> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const run = (await api.run(id)) as RunView
    if (!run.live) return run
    if (Date.now() > deadline) throw new Error(`run ${id} never reached a terminal state: ${JSON.stringify(run)}`)
    await Bun.sleep(200)
  }
}

describe("the web write surface (scope-gated routing)", () => {
  test("every mutation path answers 403 naming its scope for a token without it; the read surface stays open", async () => {
    const dir = await fixtureProject("auto-write-scopes-", {})
    try {
      await withHarness(async (h) => {
        const name = h.register(dir)
        const readApi = new AutoApi(h.daemon.url, h.read)
        const controlApi = new AutoApi(h.daemon.url, h.control)
        const configApi = new AutoApi(h.daemon.url, h.config)
        // read: nothing write-shaped answers
        for (const refusalCase of [
          () => readApi.closeUnit(name, { ref: TASK, reason: "x" }),
          () => readApi.addTask(name, { title: "x" }),
          () => readApi.plan(name, { input: "x" }),
          () => readApi.init(name, { config: {} }),
          () => readApi.amend(name, { config: { contextLimit: 32 } }),
          () => readApi.fix(name, {}),
          () => readApi.reset(name, {}),
          () => readApi.probeModels(name),
        ]) {
          const error = await refusal(refusalCase)
          expect(error.status).toBe(403)
          expect(error.message).toContain("scope")
        }
        // control opens the units but not the config ops nor the probe
        for (const error of [await refusal(() => controlApi.init(name, { config: {} })), await refusal(() => controlApi.amend(name, { config: {} })), await refusal(() => controlApi.fix(name, {})), await refusal(() => controlApi.reset(name, {})), await refusal(() => controlApi.probeModels(name))]) {
          expect(error.status).toBe(403)
        }
        expect((await refusal(() => controlApi.init(name, { config: {} }))).message).toContain('"config" scope')
        expect((await refusal(() => controlApi.probeModels(name))).message).toContain('"probe" scope')
        // config opens the config ops but not the units
        expect((await refusal(() => configApi.closeUnit(name, { ref: TASK, reason: "x" }))).message).toContain('"control" scope')
        expect((await refusal(() => configApi.probeModels(name))).message).toContain('"probe" scope')
        // the read surface stays open under read: the models table
        const table = await readApi.models(name)
        expect(linesOf(table).join("\n")).toContain("model registry")
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("the web write surface (the confirm / clean-tree two-step)", () => {
  test("each step is independently refusable: the unanswered gate refuses with its own field, and only its own answer flips it", async () => {
    const dir = await phasedProject("auto-write-gates-", "am")
    try {
      await withHarness(async (h) => {
        const name = h.register(dir)
        const api = new AutoApi(h.daemon.url, h.config)
        const base = { config: { phases: "m" } }
        const before = await Bun.file(join(dir, CONFIG_FILE)).text()
        // ① no gate fields: the confirm gate asks (428, the question included)
        const unconfirmed = await refusal(() => api.init(name, base))
        expect(unconfirmed.status).toBe(428)
        expect(unconfirmed.body.gate).toBe("confirm")
        expect(String(unconfirmed.body.question)).toContain("fully overwrite")
        expect(await Bun.file(join(dir, CONFIG_FILE)).text()).toBe(before)
        // refusing the step = never sending it: nothing changed (pinned by
        // the read-back above and after every step below)
        // ② confirm alone on a dirty tree: the clean-tree gate answers 409
        await Bun.write(join(dir, "dirt.txt"), "uncommitted\n")
        const dirty = await refusal(() => api.init(name, answerGate(base, "confirm")))
        expect(dirty.status).toBe(409)
        expect(dirty.body.gate).toBe("cleanTree")
        expect(String(dirty.body.error)).toContain("requires a clean worktree")
        expect(await Bun.file(join(dir, CONFIG_FILE)).text()).toBe(before)
        // ③ cleanTree alone (the confirm step refused): the confirm gate still asks
        const treeAlone = await refusal(() => api.init(name, answerGate(base, "cleanTree")))
        expect(treeAlone.status).toBe(428)
        expect(treeAlone.body.gate).toBe("confirm")
        expect(await Bun.file(join(dir, CONFIG_FILE)).text()).toBe(before)
        // ④ both steps answered, each by its own field: the overwrite runs
        const applied = await api.init(name, answerGate(answerGate(base, "cleanTree"), "confirm"))
        expect(applied.code).toBe(0)
        expect(JSON.parse(await Bun.file(join(dir, CONFIG_FILE)).text()).phases).toBe("m")
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("fix: the dryrun pre-view lists its findings without writing; the apply walks the same two steps", async () => {
    const dir = await phasedProject("auto-write-fix-", "am")
    try {
      await withHarness(async (h) => {
        const name = h.register(dir)
        const api = new AutoApi(h.daemon.url, h.config)
        // plant drift: a retired key the rule table drops (committed, so the
        // apply's clean-tree gate passes)
        const git = gitOf(dir)
        await Bun.write(join(dir, CONFIG_FILE), `${JSON.stringify({ ...CONFIG_DEFAULTS, phases: "am", verify: true }, null, 2)}\n`)
        await git("add", "-A")
        await git("commit", "-qm", "plant the retired key")
        // the pre-view: findings with the CLI's exit 1, nothing changed
        const dry = await refusal(() => api.fix(name, { dryrun: true }))
        expect(dry.status).toBe(409)
        expect(dry.body.code).toBe(1)
        expect(linesOf(dry.body).join("\n")).toContain("verify: true is retired")
        expect(linesOf(dry.body).join("\n")).toContain("dryrun: nothing was changed")
        expect(JSON.parse(await Bun.file(join(dir, CONFIG_FILE)).text()).verify).toBe(true)
        // the apply: the confirm step first (the tree is clean)
        const unconfirmed = await refusal(() => api.fix(name, {}))
        expect(unconfirmed.status).toBe(428)
        expect(unconfirmed.body.gate).toBe("confirm")
        expect(JSON.parse(await Bun.file(join(dir, CONFIG_FILE)).text()).verify).toBe(true)
        const applied = await api.fix(name, answerGate({}, "confirm"))
        expect(applied.code).toBe(0)
        expect(JSON.parse(await Bun.file(join(dir, CONFIG_FILE)).text()).verify).toBeUndefined()
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("reset: the plan rides the refusal; one confirm applies it (a filled brief is kept)", async () => {
    const dir = await phasedProject("auto-write-reset-", "am")
    try {
      await withHarness(async (h) => {
        const name = h.register(dir)
        const api = new AutoApi(h.daemon.url, h.config)
        await Bun.write(join(dir, ".opencode", "auto", "brief.md"), "# Project brief\n\n## Goal\n\nThe human's own intent.\n")
        await gitOf(dir)("add", "-A")
        await gitOf(dir)("commit", "-qm", "the filled brief")
        const unconfirmed = await refusal(() => api.reset(name, {}))
        expect(unconfirmed.status).toBe(428)
        expect(String(unconfirmed.body.question)).toContain("will be deleted/restored")
        expect((unconfirmed.body.plan as { path: string; action: string }[]).find((entry) => entry.path === join(".opencode", "auto", "brief.md"))?.action).toBe("keep")
        expect(await Bun.file(join(dir, CONFIG_FILE)).exists()).toBe(true)
        const applied = await api.reset(name, answerGate({}, "confirm"))
        expect(applied.code).toBe(0)
        expect(await Bun.file(join(dir, CONFIG_FILE)).exists()).toBe(false)
        expect(await Bun.file(join(dir, ".opencode", "auto", "brief.md")).text()).toContain("The human's own intent")
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("the web write surface (units land through the core)", () => {
  test("task-add writes the document, the index line and the commit; close records the Closed: field and ticks the index", async () => {
    const dir = await fixtureProject("auto-write-units-", {})
    try {
      await withHarness(async (h) => {
        const name = h.register(dir)
        const api = new AutoApi(h.daemon.url, h.control)
        const added = await api.addTask(name, { title: "the second widget" })
        expect(added.code).toBe(0)
        expect(linesOf(added).join("\n")).toContain("✓ task T-002 added")
        const todo = await Bun.file(join(dir, "docs", "T-002", "todo.md")).text()
        expect(todo).toContain("# T-002: the second widget")
        expect(await Bun.file(join(dir, "docs", "R-01", "P01-implement", "tasks.md")).text()).toContain("- [ ] T-002 the second widget")
        expect(await gitOf(dir)("log", "--format=%s", "-2")).toContain("PLAN add T-002 the second widget")
        const closed = await api.closeUnit(name, { ref: TASK, reason: "superseded by the rewrite" })
        expect(closed.code).toBe(0)
        const done = await Bun.file(join(dir, "docs", TASK, "done.md")).text()
        expect(done).toContain("Closed: superseded by the rewrite")
        expect(await Bun.file(join(dir, "docs", TASK, "todo.md")).exists()).toBe(false)
        expect(await Bun.file(join(dir, "docs", "R-01", "P01-implement", "tasks.md")).text()).toContain(`- [x] ${TASK}`)
        const log = await gitOf(dir)("log", "--format=%s%n%b", "-3")
        expect(log).toContain("Auto-Stage: force-close")
        expect(log).toContain("superseded by the rewrite")
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("the web write surface (the plan flow and the question centerpiece)", () => {
  test("plan spawns the planning session as a run over the client's write path: the channel a question rides is attached, and the tasks land", async () => {
    // The m-mode project with an empty index and a planning input — the
    // planning session lands one task and exits 0 (ops.test.ts's loop case,
    // driven here through the client's own plan method).
    const dir = await phasedProject("auto-write-plan-", "m", { agent: "claude" })
    try {
      // The turns are stretched so the run is still live when the client
      // attaches its interactive channel (the queue a planning question
      // rides) — the planning session itself needs only its first turn.
      await withFakeAgent({ FAKE_CLAUDE_DELAY_MS: "400" }, async () => {
        await withHarness(async (h) => {
          const name = h.register(dir)
          const controlApi = new AutoApi(h.daemon.url, h.control)
          const answerApi = new AutoApi(h.daemon.url, h.answer)
          // the field vocabulary (the daemon's own refusals)
          expect((await refusal(() => controlApi.plan(name, { prompt: "x" } as unknown as { input: string }))).status).toBe(400)
          expect((await refusal(() => controlApi.plan(name, { append: true }))).status).toBe(400)
          // the planning session: 202 with the run resource
          const started = await controlApi.plan(name, { input: "plan the widget migration" })
          expect(String(started.id)).toMatch(/^run-/)
          expect(String(started.interactive)).toBe(`/runs/${started.id}/interactive`)
          const id = String(started.id)
          // The run's interactive channel — the queue a planning question
          // rides — is attached: the client connects, and (reconnecting
          // while the young run's bridge is still coming up, the same
          // reconnect-safe path an operator's blip takes) observes the
          // worker bridge connected in the hello.
          let sawWorker = false
          const readApi = new AutoApi(h.daemon.url, h.read)
          for (let attempt = 0; attempt < 20 && !sawWorker; attempt++) {
            let worker = false
            const session = new InteractiveSession(answerApi.interactiveUrl(id), {
              onHello: (frame) => {
                worker = frame.worker === true
              },
            })
            session.connect()
            await Bun.sleep(300)
            await session.close()
            sawWorker = sawWorker || worker
            if (!(await readApi.run(id)).live) break
          }
          expect(sawWorker).toBe(true)
          // the run completes and the task lands through the core's planning step
          const done = await untilTerminal(readApi, id)
          expect(done.state, done.tail).toBe("completed")
          expect(done.code).toBe(0)
          const index = await Bun.file(join(dir, "docs", "R-01", "P01-implement", "tasks.md")).text()
          expect(index).toMatch(/- \[ \] T-\d{3} task T-\d{3}/)
        })
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 240_000)

  test("answering the question a run waits on lands the tasks (the between-tasks ask over the same channel, queue and answer scope a planning question rides)", async () => {
    const dir = await fixtureProject("auto-write-answer-", undefined, 2)
    try {
      await withFakeAgent({}, async () => {
        await withHarness(async (h) => {
          const readApi = new AutoApi(h.daemon.url, h.read)
          const controlApi = new AutoApi(h.daemon.url, h.control)
          const answerApi = new AutoApi(h.daemon.url, h.answer)
          const project = h.register(dir)
          const started = await controlApi.startRun(project, { waitBetween: 1 }, { OPENCODE_AUTO_AGENT: "claude" })
          const session = new InteractiveSession(answerApi.interactiveUrl(started.id), {})
          session.connect()
          try {
            await waitFor("the between-tasks question", () => session.pending.length > 0, 120_000)
            const question = session.pending[0]!
            expect(question.minutes).toBe(1)
            session.answer(question.id, "")
            await waitFor("the answered settle", () => !session.pending.some((entry) => entry.id === question.id))
          } finally {
            await session.close()
          }
          const done = await untilTerminal(readApi, started.id)
          expect(done.state, done.tail).toBe("completed")
          // the tasks landed: done is the commit verdict (done.md inside the
          // closing commit), never the run's own say-so
          expect(await Bun.file(join(dir, "docs", "T-001", "done.md")).exists()).toBe(true)
          expect(await Bun.file(join(dir, "docs", "T-002", "done.md")).exists()).toBe(true)
          const after = await readApi.status(project)
          expect(after.verdicts.tasks.every((task) => task.done)).toBe(true)
        })
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 300_000)
})

describe("the web write surface (the probe gate: scope + confirmation + rate limit)", () => {
  test("no scope → 403; scope without confirm → 428; a registry-less directory answers nothing-to-probe WITHOUT consuming the window; a confirmed probe fires once per window", async () => {
    // Fixture A: no model registry — the honest "nothing to probe", free.
    const bare = await fixtureProject("auto-write-probe-bare-", {})
    // Fixture B: a project layer naming one claude-adapter model. The
    // profile's bin names the fake `claude` BY ABSOLUTE PATH: the daemon
    // serves the probe in-process, where a bare `claude` would resolve
    // against whatever this machine has installed (the probe's session
    // spawn and its startup version check must agree — the registry's own
    // per-profile bin is exactly the operator's per-machine choice).
    const agent = await fakeAgent()
    const fakeBin = join(agent.env.PATH!.split(":")[0]!, "claude")
    const fleet = await fixtureProject("auto-write-probe-fleet-", {})
    const modelsFile = join(fleet, ".opencode", "auto", "models.json")
    await Bun.write(modelsFile, `${JSON.stringify({ agents: { fake: { adapter: "claude", bin: fakeBin } }, models: { "probe-model": { agent: "fake", model: "provider/probe-model" } }, tiers: { deep: ["probe-model"], simple: ["probe-model"] } }, null, 2)}\n`)
    await Bun.write(join(fleet, ".gitignore"), `${await Bun.file(join(fleet, ".gitignore")).text()}/.opencode/auto/models.json\n`)
    const before: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(agent.env)) {
      before[key] = process.env[key]
      process.env[key] = value
    }
    try {
      await withHarness(async (h) => {
        const bareName = h.register(bare)
        const fleetName = h.register(fleet)
        const probeApi = new AutoApi(h.daemon.url, h.probe)
        const controlApi = new AutoApi(h.daemon.url, h.control)
        const readApi = new AutoApi(h.daemon.url, h.read)
        // the scope gate: a control token (the strongest default tier)
        // cannot probe — the probe scope is its own opt-in
        const noScope = await refusal(() => controlApi.probeModels(fleetName))
        expect(noScope.status).toBe(403)
        expect(noScope.message).toContain('"probe" scope')
        // the confirmation gate: scope alone is not enough (the raw POST
        // without the confirm field — the shape a stray script would send)
        const unconfirmed = await fetch(`${h.daemon.url}/projects/${encodeURIComponent(fleetName)}/models`, {
          method: "POST",
          headers: { authorization: `Bearer ${h.probe}`, "content-type": "application/json" },
          body: JSON.stringify({ probe: true }),
        })
        expect(unconfirmed.status).toBe(428)
        const unconfirmedBody = (await unconfirmed.json()) as Record<string, unknown>
        expect(unconfirmedBody.gate).toBe("confirm")
        expect(String(unconfirmedBody.question)).toContain("spends real tokens")
        // nothing-to-probe is free: it does not consume the rate window
        const nothing = await probeApi.probeModels(bareName)
        expect(linesOf(nothing).join("\n")).toContain("nothing to probe")
        // the fire: scope + explicit confirm, under the rate limit — the
        // fake agent answers the probe's one turn
        const fired = await probeApi.probeModels(fleetName)
        const probes = fired.probes as { name: string; agent: string; ok: boolean; line: string }[]
        expect(probes).toHaveLength(1)
        expect(probes[0]!.name).toBe("probe-model")
        expect(probes[0]!.ok).toBe(true)
        expect(probes[0]!.line).toContain("ok — done")
        expect(linesOf(fired).join("\n")).toContain("◇ probe probe-model (fake): ok — done")
        // the rate limit: the immediate second, confirmed again, is refused
        // with the reopen instant — never fired twice in one window
        const second = await refusal(() => probeApi.probeModels(fleetName))
        expect(second.status).toBe(429)
        expect(second.body.gate).toBe("probeRate")
        expect(String(second.body.retryAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
        // the table stays free beside the rate limit (and runs beside it)
        const table = await readApi.models(fleetName)
        expect(linesOf(table).join("\n")).toContain("probe-model")
      })
    } finally {
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      await agent.done()
      await rm(bare, { recursive: true, force: true })
      await rm(fleet, { recursive: true, force: true })
    }
  }, 240_000)
})
