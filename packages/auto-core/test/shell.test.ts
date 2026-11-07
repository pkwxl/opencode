// The shell profile module (src/shell.ts): the profile setter's idempotence,
// the agent-adapter registration point (plans/0055 §8.8,
// registerAgentAdapter) and the default lane launcher's self-invocation
// derivation (plans/0213 D1, finding 0165-011 — the compiled binary's
// vector) — what a shell registers, what the registry loader accepts through
// it, what the pool finds for the adapter's host, and how the launcher
// re-invokes the process's own CLI in both process shapes.
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentAdapter } from "../src/shell"
import { loadModels } from "../src/models"
import { defaultLaneLauncher, registerAgentAdapter, registeredAdapterNames, resetShellAdapters, selfInvoke, setShellProfile, shellAdapter, shellProfile } from "../src/shell"

// A minimal registration: the host factory is never called here.
const adapter = (over: Partial<AgentAdapter> = {}): AgentAdapter => ({
  host: (async () => undefined) as never,
  capabilities: { resume: true, fork: "none", steer: false, abort: false, question: false, permission: false, history: false, usage: "none" },
  ...over,
})

// setShellProfile merges over the current profile, so the restore names the
// keys the tests touched (an auditLog left on would stamp every later log
// line with a timestamp).
afterEach(() => {
  resetShellAdapters()
  setShellProfile({ program: "opencode-auto run", auditLog: false })
})

describe("setShellProfile", () => {
  test("partial updates merge idempotently over the defaults", () => {
    expect(shellProfile().program).toBe("opencode-auto run")
    setShellProfile({ program: "migrate run", auditLog: true })
    setShellProfile({ program: "migrate run" })
    const profile = shellProfile()
    expect(profile.program).toBe("migrate run")
    expect(profile.auditLog).toBe(true)
    expect(profile.configDir).toBe("opencode-auto")
  })
})

describe("selfInvoke / defaultLaneLauncher: the self-invocation vector of both process shapes (plans/0213 D1, 0165-011)", () => {
  test("selfInvoke derives the vector from the process shape: a real entry re-runs it, the compiled or absent entry is the binary itself", () => {
    // The source layout (`bun src/index.ts`, a bundle under `bun dist/x.js`):
    // the entry path is spawnable — today's vector exactly (the P10 floor).
    expect(selfInvoke("src/index.ts")).toEqual({ command: process.execPath, prefix: ["src/index.ts"] })
    expect(selfInvoke("/work/auto/src/index.ts")).toEqual({ command: process.execPath, prefix: ["/work/auto/src/index.ts"] })
    // The compiled shape (`bun build --compile`): argv[1] is Bun's virtual
    // embedded entry — spawning it hands the child a misparsed command (the
    // shipped binary answers "'…' is not a command", exit 1), so the binary
    // re-invokes itself, the hidden subcommand straight after the command
    // word.
    expect(selfInvoke("/$bunfs/root/opencode-auto")).toEqual({ command: process.execPath, prefix: [] })
    expect(selfInvoke("/$bunfs/root/dist/opencode-auto-bun-linux-x64")).toEqual({ command: process.execPath, prefix: [] })
    // No entry at all: the only self that surely exists is the binary.
    expect(selfInvoke(undefined)).toEqual({ command: process.execPath, prefix: [] })
  })

  test("the launcher spawns the derived vector: no $bunfs component under the compiled shape, today's argv under the source layout", () => {
    const spawns: Array<{ args: string[]; env?: Record<string, string> }> = []
    const printed = spyOn(Bun, "spawn").mockImplementation(((args: string[], options?: { env?: Record<string, string> }) => {
      spawns.push({ args, ...(options?.env !== undefined ? { env: options.env } : {}) })
      return { exited: Promise.resolve(0) } as ReturnType<typeof Bun.spawn>
    }) as unknown as typeof Bun.spawn)
    const argv = process.argv
    try {
      process.argv = [process.execPath, "/$bunfs/root/opencode-auto", "run"]
      defaultLaneLauncher("/tmp/wt", "T-001")
      process.argv = [process.execPath, "/work/auto/src/index.ts", "run"]
      defaultLaneLauncher("/tmp/wt", "T-001", { merge: "main" }, { XDG_CACHE_HOME: "/c" })
    } finally {
      process.argv = argv
      printed.mockRestore()
    }
    // The compiled shape: [execPath, "_lane", …] — the pre-fix vector put
    // "/$bunfs/root/opencode-auto" between the two and the child read it as
    // its command, the finding's repro verbatim.
    expect(spawns[0]!.args).toEqual([process.execPath, "_lane", "/tmp/wt", "--unit", "T-001"])
    expect(spawns[0]!.env).toBeUndefined()
    // The source layout: today's vector exactly (the floor), the merge
    // instruction riding along and the cache env merged over the inherited
    // environment.
    expect(spawns[1]!.args).toEqual([process.execPath, "/work/auto/src/index.ts", "_lane", "/tmp/wt", "--unit", "T-001", "--merge", "main"])
    expect(spawns[1]!.env).toEqual({ ...process.env, XDG_CACHE_HOME: "/c" })
  })
})

describe("registerAgentAdapter (§8.8)", () => {
  test("registers an adapter under its name; the last registration wins; reset clears", () => {
    registerAgentAdapter("kimi", adapter())
    registerAgentAdapter("kimi", adapter({ bin: "second-cli" }))
    expect(registeredAdapterNames()).toEqual(["kimi"])
    expect(shellAdapter("kimi")?.bin).toBe("second-cli")
    expect(shellAdapter("opencode")).toBeUndefined()
    resetShellAdapters()
    expect(registeredAdapterNames()).toEqual([])
  })

  test("the registry loader accepts a registered adapter name by default, beside the builtins", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-shell-"))
    try {
      registerAgentAdapter("kimi", adapter())
      const file = join(dir, "models.json")
      await writeFile(file, JSON.stringify({ agents: { k: { adapter: "kimi" } }, models: { k1: { agent: "k", model: "prov/k" } }, tiers: { deep: ["k1"], simple: ["k1"] } }))
      const loaded = await loadModels(dir, { phaseTypes: ["implement"], env: { OPENCODE_AUTO_MODELS: file, XDG_CONFIG_HOME: undefined } })
      expect(loaded?.agents.get("k")?.adapter).toBe("kimi")
      // An unregistered name stays a strict failure that lists the known
      // adapters — the registered one included.
      await writeFile(file, JSON.stringify({ agents: { q: { adapter: "qoder" } } }))
      let failed: unknown
      try {
        await loadModels(dir, { phaseTypes: ["implement"], env: { OPENCODE_AUTO_MODELS: file, XDG_CONFIG_HOME: undefined } })
      } catch (error) {
        failed = error
      }
      expect(failed instanceof Error ? failed.message : String(failed)).toContain('"qoder" is unknown (known adapters: opencode, claude, kimi)')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
