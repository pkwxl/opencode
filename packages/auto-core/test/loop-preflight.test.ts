// Preflight's cleanup of the retired task mirror (plans/0054 D4): a CURRENT.md
// an earlier release left is recognised by its fixed header and deleted, and
// the deletion rides the start gate's carryover commit; any other CURRENT.md
// belongs to the project.
// The run-start load of the model registry (plans/0055 §4.1, §4.3): a project
// layer git does not ignore, a strict failure and a broken reference each exit
// 1 naming the cause; with no registry preflight is unchanged. The operator
// layer stays out of these tests (test/preload.ts empties XDG_CONFIG_HOME).
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
  const REGISTRY = { models: { glm: { agent: "opencode", model: "zhipuai/glm-4.6" } }, tiers: { simple: ["glm"] } }
  const saved = { set: process.env.PREFLIGHT_TEST_SET_KEY, missing: process.env.PREFLIGHT_TEST_MISSING_KEY }

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
  // writable again.
  async function run(dir: string, opts: RunAllOpts = {}) {
    const ambient = Object.entries(process.env).filter(([key]) => /^OPENCODE_AUTO_/.test(key))
    for (const [key] of ambient) delete process.env[key]
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
    await Bun.write(join(dir, MODELS_FILE), JSON.stringify(REGISTRY))
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
    await Bun.write(join(dir, MODELS_FILE), JSON.stringify({ ...REGISTRY, routes: { review: "simple" } }))
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
    await Bun.write(join(dir, MODELS_FILE), JSON.stringify(REGISTRY))
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
    expect(lines).toEqual([`${LAYER}: models.glm: unknown field "aviod" (known: agent, model, wider, variant, context, avoid, only, keys)`])
  })

  test("a strict registry error exits 1 naming the field and the layer; nothing is written", async () => {
    const dir = await project({ ignored: true })
    await Bun.write(join(dir, MODELS_FILE), JSON.stringify({ ...REGISTRY, tierz: {} }))
    const { result, lines } = await run(dir)
    expect(result).toEqual({ exit: 1 })
    expect(lines).toEqual([`${LAYER}: unknown field "tierz" (known: tz, agents, models, tiers, routes, classifier)`])
    expect(await changedFiles(dir)).toEqual([])
  })

  test("a missing reference exits 1 naming the reference, never a value", async () => {
    const dir = await project({ ignored: true })
    process.env.PREFLIGHT_TEST_SET_KEY = "value-that-must-not-appear"
    delete process.env.PREFLIGHT_TEST_MISSING_KEY
    const keys = ["{env:PREFLIGHT_TEST_SET_KEY}", "{env:PREFLIGHT_TEST_MISSING_KEY}", "{file:preflight-test-missing-key}"]
    await Bun.write(join(dir, MODELS_FILE), JSON.stringify({ ...REGISTRY, models: { glm: { ...REGISTRY.models.glm, keys } } }))
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
})
