// The shell profile module (src/shell.ts): the profile setter's idempotence,
// the agent-adapter registration point (plans/0055 §8.8,
// registerAgentAdapter) and the lane launcher seam's retirement posture
// (plans/0283: the default launcher is gone with the push lane workers — no
// default spawns, a host-registered launcher is the only source) — what a
// shell registers, what the registry loader accepts through it, and what the
// pool finds for the adapter's host.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentAdapter } from "../src/shell"
import { loadModels } from "../src/models"
import { registerAgentAdapter, registeredAdapterNames, resetShellAdapters, setShellProfile, shellAdapter, shellProfile } from "../src/shell"

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

describe("the lane launcher seam (plans/0283: the push lane workers retired)", () => {
  test("the default profile registers no launcher — the core spawns no lane workers; a host registration is the only source", () => {
    // The default launcher (the `_lane` self-invocation, plans/0213 D1) is
    // retired with the push lane workers: `defaultLaneLauncher` and its
    // `selfInvoke` derivation no longer exist as exports (the import at
    // this file's head pins that compile-level), and the default profile
    // carries no `laneLauncher` — a dispatch without a host-registered
    // launcher refuses loudly in src/lanes.ts, never spawns.
    expect(shellProfile().laneLauncher).toBeUndefined()
    const worker = { exited: Promise.resolve(0) }
    setShellProfile({ laneLauncher: () => worker })
    expect(shellProfile().laneLauncher!("/tmp/wt", "T-001")).toBe(worker)
    setShellProfile({ laneLauncher: undefined })
    expect(shellProfile().laneLauncher).toBeUndefined()
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
