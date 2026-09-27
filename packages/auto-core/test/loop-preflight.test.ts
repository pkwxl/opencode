// Preflight's cleanup of the retired task mirror (plans/0054 D4): a CURRENT.md
// an earlier release left is recognised by its fixed header and deleted, and
// the deletion rides the start gate's carryover commit; any other CURRENT.md
// belongs to the project.
// The run-start load of the model registry (plans/0055 §4.1, §4.3): a project
// layer git does not ignore, a strict failure and a broken reference each exit
// 1 naming the cause; with no registry preflight is unchanged. The operator
// layer stays out of these tests (test/preload.ts empties XDG_CONFIG_HOME).
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { ensurePointer } from "../src/agents-block"
import { renderAgentContract } from "../src/config-fix"
import { beginUnit, changedFiles } from "../src/git"
import { preflight, removeRetiredCurrent, type RunAllOpts } from "../src/loop-preflight"
import { MODELS_FILE } from "../src/models"
import { unprotect } from "../src/protect"
import { flushStats } from "../src/stats"
import { freshRepo, git } from "./fixtures/runner"

const MIRROR = "# Current task (maintained by opencode-auto, do not edit manually)\n\n## T-003: task T-003 [blocked]\n\nbody\n"

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function repo(files: Record<string, string>): Promise<string> {
  const dir = await freshRepo()
  dirs.push(dir)
  await Bun.write(join(dir, "seed.txt"), "seed\n")
  for (const [path, text] of Object.entries(files)) await Bun.write(join(dir, path), text)
  await git(dir, "add", "-A")
  await git(dir, "commit", "-qm", "seed")
  return dir
}

describe("removeRetiredCurrent (plans/0054 D4)", () => {
  test("a tracked mirror is deleted and the start gate commits the deletion as a driver write", async () => {
    const dir = await repo({ "CURRENT.md": MIRROR })
    expect(await removeRetiredCurrent(dir)).toBe(true)
    expect(await Bun.file(join(dir, "CURRENT.md")).exists()).toBe(false)
    const gate = await beginUnit(dir, {}, { id: "PLAN", title: "pre-run baseline close-out" })
    expect(gate.type).toBe("ok")
    expect(await changedFiles(dir)).toEqual([])
    expect(await git(dir, "log", "-1", "--pretty=%B")).toContain("Auto-Stage: carryover")
    expect(await git(dir, "show", "--name-status", "--pretty=format:", "HEAD")).toContain("D\tCURRENT.md")
  })

  test("an untracked mirror is deleted and leaves nothing to commit", async () => {
    const dir = await repo({})
    await Bun.write(join(dir, "CURRENT.md"), MIRROR)
    expect(await removeRetiredCurrent(dir)).toBe(true)
    expect(await changedFiles(dir)).toEqual([])
  })

  test("a CURRENT.md with any other first line is the project's and stays", async () => {
    const own = "# Current state of the port\n\nNotes the project keeps.\n"
    const dir = await repo({ "CURRENT.md": own })
    expect(await removeRetiredCurrent(dir)).toBe(false)
    expect(await Bun.file(join(dir, "CURRENT.md")).text()).toBe(own)
  })

  test("no CURRENT.md: nothing to do", async () => {
    const dir = await repo({})
    expect(await removeRetiredCurrent(dir)).toBe(false)
  })
})

describe("preflight: the model registry at run start (plans/0055 §4.1, §4.3)", () => {
  const LAYER = `model registry, project layer ${MODELS_FILE}`
  // glm on both tiers: the needs of every m-mode run (bypass, the lead or
  // whole-task sessions, wrapup — simple; under subtask: true the decompose
  // sessions of its implicit implement phase — deep) all pass the default
  // opencode filter.
  const REGISTRY = { models: { glm: { agent: "opencode", model: "zhipuai/glm-4.6" } }, tiers: { deep: ["glm"], simple: ["glm"] } }
  const saved = { set: process.env.PREFLIGHT_TEST_SET_KEY, missing: process.env.PREFLIGHT_TEST_MISSING_KEY }

  // §8.7 runs every dispatched profile's `<bin> --version`; the registry the
  // tests write carries the opencode profile with a fake bin so a passing
  // preflight does not depend on a real opencode install being on the
  // machine's PATH (Bun.spawn resolves PATH from the process start, so a fake
  // prepended to process.env.PATH would not be seen).
  let fakeBin = ""
  beforeAll(async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-preflight-bin-"))
    fakeBin = join(dir, "opencode-bin")
    await Bun.write(fakeBin, "#!/bin/sh\nexit 0\n")
    await chmod(fakeBin, 0o755)
  })
  afterAll(async () => {
    if (fakeBin) await rm(dirname(fakeBin), { recursive: true, force: true })
  })

  // The registry every test writes: REGISTRY plus the profile the bin check
  // dispatches (the profile keeps the name "opencode", so the agent-filter
  // and routing assertions see the same names as the implied profile).
  const registry = () => ({ ...REGISTRY, agents: { opencode: { adapter: "opencode", bin: fakeBin } } })

  afterEach(() => {
    for (const [key, value] of [["PREFLIGHT_TEST_SET_KEY", saved.set], ["PREFLIGHT_TEST_MISSING_KEY", saved.missing]] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  // An initialized, committed project whose preflight has nothing to write:
  // the agent contract, the AGENTS.md block and the driver .gitignore entries
  // are in place. `ignored` adds the project layer's entry init writes.
  async function project(opts: { ignored?: boolean } = {}): Promise<string> {
    const dir = await freshRepo()
    dirs.push(dir)
    await Bun.write(join(dir, ".gitignore"), `tmp/\n.auto/\n${opts.ignored ? "/.opencode/auto/models.json\n" : ""}`)
    await Bun.write(join(dir, ".opencode/agent/auto.md"), await renderAgentContract(false))
    await ensurePointer(dir)
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "init")
    return dir
  }

  // preflight with its log lines captured and the ambient OPENCODE_AUTO_*
  // switch layer scrubbed (its startup line would otherwise join the lines); a
  // passing preflight's handles are closed and the files it protected made
  // writable again. The ambient proxy variables are scrubbed too (a machine
  // with a proxy and no NO_PROXY would add the loopback warning to a
  // registry's lines); `env` sets variables for the one call.
  async function run(dir: string, opts: RunAllOpts = {}, env: Record<string, string> = {}) {
    const ambient = Object.entries(process.env).filter(([key]) => /^OPENCODE_AUTO_|^(https?|all|no)_proxy$/i.test(key))
    for (const [key] of ambient) delete process.env[key]
    Object.assign(process.env, env)
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "))
    })
    try {
      const result = await preflight(dir, opts)
      if (!("exit" in result)) {
        result.progress.close()
        result.watcher?.close()
      }
      return { result, lines }
    } finally {
      printed.mockRestore()
      for (const key of Object.keys(env)) delete process.env[key]
      for (const [key, value] of ambient) if (value !== undefined) process.env[key] = value
      await unprotect(dir)
      await flushStats(dir)
    }
  }

  test("no registry: preflight passes as before, logs nothing about one and holds none", async () => {
    const dir = await project()
    const { result, lines } = await run(dir)
    expect("exit" in result).toBe(false)
    if ("exit" in result) return
    expect(result.registry).toBeUndefined()
    expect(lines).toEqual([])
    expect(await changedFiles(dir)).toEqual([])
  })

  test("an ignored, valid project layer is loaded once and held on the result; nothing else changes", async () => {
    const dir = await project({ ignored: true })
    await Bun.write(join(dir, MODELS_FILE), JSON.stringify(registry()))
    const { result, lines } = await run(dir)
    expect("exit" in result).toBe(false)
    if ("exit" in result) return
    expect(result.registry?.layers.map((layer) => layer.name)).toEqual(["project"])
    expect([...result.registry!.models.keys()]).toEqual(["glm"])
    expect(lines).toEqual([])
    expect(await changedFiles(dir)).toEqual([])
  })

  test("route keys may name the project's custom phase types", async () => {
    const dir = await project({ ignored: true })
    await Bun.write(join(dir, ".opencode/auto/phases/review.md"), "# Review\n\n## plan duties\n\nPlan the review.\n")
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "custom type")
    await Bun.write(join(dir, MODELS_FILE), JSON.stringify({ ...registry(), routes: { review: "simple" } }))
    const { result } = await run(dir)
    expect("exit" in result).toBe(false)
    if ("exit" in result) return
    expect(result.registry?.routes.get("review")).toMatchObject({ tier: "simple" })
  })

  test("a project layer git does not ignore exits 1 and names fix, before its content is read", async () => {
    const dir = await project()
    await Bun.write(join(dir, MODELS_FILE), "{ not json")
    const { result, lines } = await run(dir)
    expect(result).toEqual({ exit: 1 })
    expect(lines).toEqual([
      `${LAYER}: git does not ignore it, so the unified commit would commit it; run opencode-auto fix ${dir} to add its .gitignore entry, then re-run`,
    ])
  })

  test("a tracked project layer exits 1 even with the entry: it must be untracked, then fix", async () => {
    const dir = await project({ ignored: true })
    await Bun.write(join(dir, MODELS_FILE), JSON.stringify(registry()))
    await git(dir, "add", "-f", MODELS_FILE)
    await git(dir, "commit", "-qm", "tracked layer")
    const { result, lines } = await run(dir)
    expect(result).toEqual({ exit: 1 })
    expect(lines).toEqual([
      `${LAYER}: git tracks it, so the unified commit would commit it; untrack it (git -C ${dir} rm --cached ${MODELS_FILE}), run opencode-auto fix ${dir} to add its .gitignore entry if it lacks one, then re-run`,
    ])
  })

  test("outside a git work tree the ignore check does not apply", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-preflight-"))
    dirs.push(dir)
    await Bun.write(join(dir, MODELS_FILE), JSON.stringify({ models: { glm: { agent: "opencode", aviod: [] } } }))
    const { result, lines } = await run(dir)
    expect(result).toEqual({ exit: 1 })
    expect(lines).toEqual([`${LAYER}: models.glm: unknown field "aviod" (known: agent, model, wider, variant, context, avoid, only, keys, retry)`])
  })

  test("a strict registry error exits 1 naming the field and the layer; nothing is written", async () => {
    const dir = await project({ ignored: true })
    await Bun.write(join(dir, MODELS_FILE), JSON.stringify({ ...registry(), tierz: {} }))
    const { result, lines } = await run(dir)
    expect(result).toEqual({ exit: 1 })
    expect(lines).toEqual([`${LAYER}: unknown field "tierz" (known: tz, agents, models, tiers, routes, classifier)`])
    expect(await changedFiles(dir)).toEqual([])
  })

  test("the loopback proxy warning (§8.10): under a registry with an opencode profile, when NO_PROXY misses a loopback name", async () => {
    const dir = await project({ ignored: true })
    await Bun.write(join(dir, MODELS_FILE), JSON.stringify(registry()))
    const warned = await run(dir, {}, { HTTP_PROXY: "http://user:secret@proxy:3128", NO_PROXY: "127.0.0.1" })
    expect("exit" in warned.result).toBe(false)
    expect(warned.lines).toEqual([
      "⚠ HTTP_PROXY is set in the driver's environment and NO_PROXY does not cover localhost: " +
        "Bun does not bypass loopback on its own, so the driver's requests to its opencode server would go through the proxy. " +
        "Add localhost to NO_PROXY, and give an agent that needs the proxy its own through its agent profile's env in the model registry",
    ])
    // Later preflights on the same project also print the stats resume banner.
    const warnings = async (env: Record<string, string>) => (await run(dir, {}, env)).lines.filter((line) => line.startsWith("⚠"))
    expect(await warnings({ HTTP_PROXY: "http://proxy:3128", no_proxy: "localhost,127.0.0.1" })).toEqual([])
    // A registry of claude profiles alone starts no opencode server to reach.
    await Bun.write(join(dir, MODELS_FILE), JSON.stringify({ agents: { claude: { adapter: "claude" } }, models: { opus: { agent: "claude", model: "opus" } }, tiers: { deep: ["opus"] } }))
    expect(await warnings({ HTTP_PROXY: "http://proxy:3128" })).toEqual([])
  })

  test("no registry: no proxy warning, whatever the environment (the run stays as it was)", async () => {
    const dir = await project()
    const { result, lines } = await run(dir, {}, { HTTP_PROXY: "http://proxy:3128" })
    expect("exit" in result).toBe(false)
    expect(lines).toEqual([])
  })

  test("a missing reference exits 1 naming the reference, never a value", async () => {
    const dir = await project({ ignored: true })
    process.env.PREFLIGHT_TEST_SET_KEY = "value-that-must-not-appear"
    delete process.env.PREFLIGHT_TEST_MISSING_KEY
    const keys = ["{env:PREFLIGHT_TEST_SET_KEY}", "{env:PREFLIGHT_TEST_MISSING_KEY}", "{file:preflight-test-missing-key}"]
    await Bun.write(join(dir, MODELS_FILE), JSON.stringify({ ...registry(), models: { glm: { ...REGISTRY.models.glm, keys } } }))
    const { result, lines } = await run(dir)
    expect(result).toEqual({ exit: 1 })
    expect(lines).toEqual([
      [
        `${LAYER}: models.glm.keys[1]: env PREFLIGHT_TEST_MISSING_KEY is not set`,
        `${LAYER}: models.glm.keys[2]: file preflight-test-missing-key does not exist`,
      ].join("\n"),
    ])
    expect(lines.join("\n")).not.toContain("value-that-must-not-appear")
  })

  // Selection's run-start refusals (plans/0055 §6.3, §9 R7): a dispatch the
  // run can send whose list the agent filter empties never becomes a silent
  // wait, and under a registry the model switches take their registry
  // meanings — an internal-name OPENCODE_AUTO_MODEL value parses, an unknown
  // bare name and OPENCODE_AUTO_MODEL_FALLBACK are usage errors.
  test("a needed tier the agent filter empties exits 1 naming the tier, the role and the filter", async () => {
    const dir = await project({ ignored: true })
    await Bun.write(join(dir, MODELS_FILE), JSON.stringify(registry()))
    // The pipeline (subtask: true) needs both tiers: its decompose sessions are deep.
    const { result, lines } = await run(dir, { subtask: "true" }, { OPENCODE_AUTO_AGENT: "claude" })
    expect(result).toEqual({ exit: 1 })
    const fix = "fix the registry or the agent filter and re-run"
    expect(lines).toEqual([
      "⚙ experimental switches (OPENCODE_AUTO_* env vars, this run only): OPENCODE_AUTO_AGENT=claude",
      [
        `model registry: the simple tier has no candidate left after the agent filter claude (tiers.simple: glm); the bypass sessions of this run would have no model to dispatch on (${fix})`,
        `model registry: the deep tier has no candidate left after the agent filter claude (tiers.deep: glm); the decompose sessions of implement phases would have no model to dispatch on (${fix})`,
      ].join("\n"),
    ])
  })

  test("the deep tier is needed by a phased run's planning sessions and by m mode's decompose sessions under subtask: true; auto, ondemand and off need none", async () => {
    const dir = await project({ ignored: true })
    await Bun.write(join(dir, MODELS_FILE), JSON.stringify({ ...registry(), tiers: { simple: ["glm"] } }))
    const fix = "fix the registry or the agent filter and re-run"
    const phased = await run(dir, { phases: "md" })
    expect(phased.result).toEqual({ exit: 1 })
    expect(phased.lines).toEqual([
      `model registry: the deep tier is not declared (tiers.deep: (empty)); the phase-plan sessions of this run would have no model to dispatch on (${fix})`,
    ])
    // m mode's implicit implement phase dispatches deep decompose sessions
    // under the pipeline (subtask: true).
    const pipeline = await run(dir, { subtask: "true" })
    expect(pipeline.result).toEqual({ exit: 1 })
    expect(pipeline.lines).toEqual([
      `model registry: the deep tier is not declared (tiers.deep: (empty)); the decompose sessions of implement phases would have no model to dispatch on (${fix})`,
    ])
    // With whole-task sessions instead — auto's lead (the default, plans/0059
    // D2), ondemand and off — no role of the phase needs the deep tier, and
    // the run starts.
    for (const subtask of [undefined, "auto", "ondemand", "off"] as const) {
      const whole = await run(dir, { subtask })
      expect("exit" in whole.result).toBe(false)
    }
  })

  test("OPENCODE_AUTO_MODEL takes internal names under a registry; an unknown name and _FALLBACK are usage errors", async () => {
    const dir = await project({ ignored: true })
    await Bun.write(join(dir, MODELS_FILE), JSON.stringify(registry()))
    const routed = await run(dir, {}, { OPENCODE_AUTO_MODEL: "glm" })
    expect("exit" in routed.result).toBe(false)
    expect(routed.lines).toEqual(["⚙ experimental switches (OPENCODE_AUTO_* env vars, this run only): OPENCODE_AUTO_MODEL=*=glm"])
    const unknown = await run(dir, {}, { OPENCODE_AUTO_MODEL: "opus" })
    expect(unknown.result).toEqual({ exit: 1 })
    expect(unknown.lines).toEqual([
      'env OPENCODE_AUTO_MODEL invalid value: "opus" (under a model registry a value is an internal model name or provider/model with a slash; known internal names: glm)',
    ])
    const ring = await run(dir, {}, { OPENCODE_AUTO_MODEL_FALLBACK: "kimi/k2" })
    expect(ring.result).toEqual({ exit: 1 })
    expect(ring.lines).toEqual([
      "env OPENCODE_AUTO_MODEL_FALLBACK is not used under a model registry: the tier lists are the failover order (deep: glm; simple: glm)",
    ])
  })
})
