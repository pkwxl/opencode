// Tiered parallelism (plans/0096 D8–D13, Stage 5 — the 0068 amendment): the
// pure tier machinery's suite. The probe outcomes are injectable facts (D13's
// own list: probe outcomes, sparse materialization set, cache env injection,
// budget refusal) — no test depends on the host filesystem providing CoW
// (ext4, this package's CI hosts, has none: an unprobed auto tier falls
// through to 0 exactly as a btrfs-less machine would). The config surface
// beside it (treeLanes, the lanes object) validates the way every
// constitutional key does. The end-to-end lane choreography under each tier
// lives where it always did — the scheduler's repo-lane suites
// (test/lanes-scheduler.test.ts now drives tier 2 explicitly, the stage-5
// default being tier 0's serial loop).
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  CONFIG_DEFAULTS,
  formatProjectConfig,
  loadProjectConfig,
  type ProjectConfig,
} from "../src/config"
import { laneCacheEnv, resolveTreeTier, schedulerActive, sparseSet, worktreeScheduler } from "../src/lanes"

function tempDir() {
  return mkdtempSync(join(tmpdir(), "auto-lanes-tier-"))
}

function writeConfig(dir: string, text: string) {
  mkdirSync(join(dir, ".opencode", "auto"), { recursive: true })
  writeFileSync(join(dir, ".opencode", "auto", "config.json"), text)
}

describe("resolveTreeTier (D10: the tier decision, pure over injected probe facts)", () => {
  test("off and absent are tier 0 — the default execution surface, reason naming the test lanes", () => {
    // The stored setting never carries "off" (config treeLanesOf normalizes
    // it to undefined, the parallel/none precedent) — absent is off.
    const resolved = resolveTreeTier(undefined)
    expect(resolved.tier).toBe(0)
    expect(resolved.reason).toContain("treeLanes off")
    expect(resolved.reason).toContain("process parallelism, one tree")
    expect(resolved.reason).toContain("test lanes")
  })

  test("on is tier 2 unconditionally — today's full worktree, named, no probe consulted", () => {
    const resolved = resolveTreeTier("on", { reflink: false })
    expect(resolved.tier).toBe(2)
    expect(resolved.reason).toContain("full worktree")
  })

  test("auto without probe facts reads as tier 0 (nothing was proven; the fail-safe tier is the default one)", () => {
    const resolved = resolveTreeTier("auto")
    expect(resolved.tier).toBe(0)
    expect(resolved.reason).toContain("was not probed")
  })

  test("auto without reflink capability falls through to tier 0, the reason naming the capability", () => {
    const resolved = resolveTreeTier("auto", { reflink: false })
    expect(resolved.tier).toBe(0)
    expect(resolved.reason).toContain("no reflink capability")
    // The capability is weighed before the budget: both failing names the
    // capability (the budget never mattered).
    const both = resolveTreeTier("auto", { reflink: false, treeMB: 900 }, 100)
    expect(both.tier).toBe(0)
    expect(both.reason).toContain("no reflink capability")
    expect(both.reason).not.toContain("treeBudgetMB")
  })

  test("auto with reflink and no declared budget is tier 1", () => {
    const resolved = resolveTreeTier("auto", { reflink: true })
    expect(resolved.tier).toBe(1)
    expect(resolved.reason).toContain("reflink capable")
  })

  test("budget refusal (D10's probe half): the working tree beyond the declared lanes.treeBudgetMB is tier 0, the reason naming both figures", () => {
    const refused = resolveTreeTier("auto", { reflink: true, treeMB: 2048.4 }, 1024)
    expect(refused.tier).toBe(0)
    expect(refused.reason).toContain("exceeds the declared lanes.treeBudgetMB (1024 MB)")
    expect(refused.reason).toContain("2048 MB")
    // Within budget is tier 1 with the budget note; exactly at it is within.
    const within = resolveTreeTier("auto", { reflink: true, treeMB: 1024 }, 1024)
    expect(within.tier).toBe(1)
    expect(within.reason).toContain("within the declared lanes.treeBudgetMB (1024 MB)")
  })

  test("a budget without a measured tree (a non-git environment) decides nothing — tier 1 stands", () => {
    expect(resolveTreeTier("auto", { reflink: true }, 1024).tier).toBe(1)
  })
})

describe("worktreeScheduler (D9/D10: the tier-qualified activation predicate)", () => {
  test("the stage-5 default: schedulerActive with tier 0 runs the serial task loop, not the lane loop", () => {
    expect(schedulerActive(2, "low")).toBe(true)
    expect(worktreeScheduler(2, "low", 0)).toBe(false)
    expect(worktreeScheduler(2, "low", undefined)).toBe(false)
  })

  test("tiers 1 and 2 keep the scheduler; every other activation rule of D10 is unchanged", () => {
    expect(worktreeScheduler(2, "low", 1)).toBe(true)
    expect(worktreeScheduler(2, "low", 2)).toBe(true)
    expect(worktreeScheduler(2, "high", 2)).toBe(true)
    // The rule's own halves still gate: no level, or maxSessions 1, is off
    // at every tier — the byte-identical floor.
    expect(worktreeScheduler(2, undefined, 2)).toBe(false)
    expect(worktreeScheduler(1, "low", 2)).toBe(false)
    expect(worktreeScheduler(undefined, "low", 2)).toBe(false)
  })
})

describe("sparseSet (D9: the tier-1 cone over Touches and the floor)", () => {
  test("a unit that declares nothing (or an empty set) touches everything: no sparse materialization, the full worktree", () => {
    expect(sparseSet(undefined, ["docs"])).toBeUndefined()
    expect(sparseSet([], ["docs"])).toBeUndefined()
  })

  test("the union of the unit's Touches (directories as themselves, files as their parents — the field's own grammar) and the floor", () => {
    expect(sparseSet(["src/alpha/", "include/dma.h"], ["docs", "tools"])).toEqual(["docs", "include", "src/alpha", "tools"])
  })

  test("the builtin floor rides along: docs is in every tier-1 lane's cone whatever the unit declares", () => {
    expect(sparseSet(["src/dma/"], ["docs"])).toEqual(["docs", "src/dma"])
  })

  test("nested declarations collapse onto the containing directory (a directory inside another kept directory adds nothing to the cone)", () => {
    expect(sparseSet(["src/", "src/dma/", "src/dma/io.c"], ["docs"])).toEqual(["docs", "src"])
  })

  test("separators normalize: backslashes and ./ spellings join the cone", () => {
    expect(sparseSet([".\\src\\dma\\", "./lib/"], ["docs"])).toEqual(["docs", "lib", "src/dma"])
  })
})

describe("laneCacheEnv (D9/D11: the declared cache homes, never a guessed safety)", () => {
  const rules = [
    { env: "CCACHE_DIR", shared: true },
    { env: "CARGO_TARGET_DIR", shared: false },
  ]

  test("a shared-safe home points every lane at one path under the main tree's .auto/cache/", () => {
    const home = "/proj"
    const first = laneCacheEnv(rules, home, "/proj/.auto/worktrees/T-001")
    const second = laneCacheEnv(rules, home, "/proj/.auto/worktrees/T-002")
    expect(first.CCACHE_DIR).toBe(join("/proj", ".auto", "cache", "ccache_dir"))
    expect(first.CCACHE_DIR).toBe(second.CCACHE_DIR)
  })

  test("a serializing home points each lane at its own worktree's state (cargo's target dir locks, so it is per-lane)", () => {
    const first = laneCacheEnv(rules, "/proj", "/proj/.auto/worktrees/T-001")
    const second = laneCacheEnv(rules, "/proj", "/proj/.auto/worktrees/T-002")
    expect(first.CARGO_TARGET_DIR).toBe(join("/proj/.auto/worktrees/T-001", ".auto", "cache", "cargo_target_dir"))
    expect(second.CARGO_TARGET_DIR).toBe(join("/proj/.auto/worktrees/T-002", ".auto", "cache", "cargo_target_dir"))
    expect(first.CARGO_TARGET_DIR).not.toBe(second.CARGO_TARGET_DIR)
  })

  test("nothing declared injects nothing", () => {
    expect(laneCacheEnv(undefined, "/proj", "/wt")).toEqual({})
    expect(laneCacheEnv([], "/proj", "/wt")).toEqual({})
  })
})

describe("the config surface (D10: treeLanes and the lanes object, the constitutional pattern)", () => {
  test("treeLanes absent and off load the same (the parallel/none precedent); auto and on read back", async () => {
    const dir = tempDir()
    try {
      writeConfig(dir, "{}")
      expect((await loadProjectConfig(dir)).treeLanes).toBeUndefined()
      writeConfig(dir, JSON.stringify({ treeLanes: "off" }))
      expect((await loadProjectConfig(dir)).treeLanes).toBeUndefined()
      writeConfig(dir, JSON.stringify({ treeLanes: "auto" }))
      expect((await loadProjectConfig(dir)).treeLanes).toBe("auto")
      writeConfig(dir, JSON.stringify({ treeLanes: "on" }))
      expect((await loadProjectConfig(dir)).treeLanes).toBe("on")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a bad treeLanes value fails strictly, the message naming the domain", async () => {
    const dir = tempDir()
    try {
      writeConfig(dir, JSON.stringify({ treeLanes: "worktrees" }))
      await expect(loadProjectConfig(dir)).rejects.toThrow('treeLanes must be off|auto|on')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("the lanes object loads its three knobs; an empty object is nothing declared", async () => {
    const dir = tempDir()
    try {
      writeConfig(
        dir,
        JSON.stringify({
          lanes: {
            caches: [
              { env: "CCACHE_DIR", shared: true },
              { env: "CARGO_TARGET_DIR", shared: false },
            ],
            treeBudgetMB: 4096,
            sparseFloor: ["tools", "proto"],
          },
        }),
      )
      const lanes = (await loadProjectConfig(dir)).lanes
      expect(lanes).toEqual({
        caches: [
          { env: "CCACHE_DIR", shared: true },
          { env: "CARGO_TARGET_DIR", shared: false },
        ],
        treeBudgetMB: 4096,
        sparseFloor: ["tools", "proto"],
      })
      writeConfig(dir, JSON.stringify({ lanes: {} }))
      expect((await loadProjectConfig(dir)).lanes).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("every malformed lanes shape fails strictly: a non-object, a bad cache rule, a duplicate env, a bad budget, a bad floor path", async () => {
    const dir = tempDir()
    try {
      for (const [text, fragment] of [
        [JSON.stringify({ lanes: [] }), "lanes must be an object"],
        [JSON.stringify({ lanes: { caches: [] } }), "non-empty array"],
        [JSON.stringify({ lanes: { caches: [{ env: "ccache dir", shared: true }] } }), "environment variable name"],
        [JSON.stringify({ lanes: { caches: [{ env: "CCACHE_DIR", shared: "yes" }] } }), "shared must be true|false"],
        [JSON.stringify({ lanes: { caches: [{ env: "A", shared: true }, { env: "A", shared: false }] } }), "lists A twice"],
        [JSON.stringify({ lanes: { treeBudgetMB: 0 } }), "treeBudgetMB must be a positive integer"],
        [JSON.stringify({ lanes: { treeBudgetMB: 1.5 } }), "treeBudgetMB must be a positive integer"],
        [JSON.stringify({ lanes: { sparseFloor: ["/abs"] } }), "sparseFloor"],
        [JSON.stringify({ lanes: { sparseFloor: ["a", "a"] } }), "lists a path twice"],
      ] as const) {
        writeConfig(dir, text)
        await expect(loadProjectConfig(dir)).rejects.toThrow(fragment)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("the summary line stays byte-identical without the keys and names the tier when set (the preflight line's sibling surface)", () => {
    const base: ProjectConfig = { ...CONFIG_DEFAULTS }
    expect(formatProjectConfig(base)).not.toContain("tree-lanes")
    expect(formatProjectConfig({ ...base, treeLanes: "on" })).toContain("· tree-lanes on")
    // The defaults table carries no tier keys: init writes none without the flag.
    expect(CONFIG_DEFAULTS.treeLanes).toBeUndefined()
    expect(CONFIG_DEFAULTS.lanes).toBeUndefined()
  })
})
