// The run-services ratchets and lifecycle (the consolidation's services
// stage): the engine modules (watch, attempt, session and the pure engine
// decisions under src/engine/) read time only through the installed
// services' clock — no raw Date.now, Bun.sleep or setTimeout anywhere in
// them — plus the holder's install/uninstall lifecycle, the stats clock
// fold, the frozen switch snapshot's clamp invariant, and the router
// ratchets: the state the router service moved in (the failback holders,
// the down marks, the logged windows, the model-step cache claims) exists
// only as methods on the constructed router — no free-function delegator
// export anywhere else in src/, and no reset* hook for it anywhere.
// The callers-within-SERVICE_ENTRIES assertion lands with the later services
// units; the list is exported as the documented, shrink-only allowlist.
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServices, installServices, SERVICE_ENTRIES, services, uninstallServices, type RunServices } from "../src/services"
import { loadStats, statsTask, statsTotals } from "../src/stats"
import { autoSwitches, clampSwitches, freezeSwitches, parseSwitches, setSwitchModelRegistry } from "../src/switches"
import { manualClock } from "./fixtures/clock"

// ---------------------------------------------------------------------------
// The no-raw-clock ratchet
// ---------------------------------------------------------------------------

// The engine modules: the session-driving entries and every pure decision
// under src/engine/. A raw clock call here would escape the run's services —
// a steered clock must steer the whole engine, and a sleep on wall time
// blocks the run for real.
const ENGINE_DIR = join(import.meta.dir, "..", "src", "engine")
const BANNED = ["Date.now", "Bun.sleep", "setTimeout"]

function engineFiles(): string[] {
  return [
    ...["watch", "attempt", "session"].map((name) => `src/${name}.ts`),
    ...readdirSync(ENGINE_DIR)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => `src/engine/${name}`),
  ]
}

describe("the no-raw-clock ratchet (the engine reads time only through the services)", () => {
  test("no raw Date.now, Bun.sleep or setTimeout in watch, attempt, session or engine/*", () => {
    const files = engineFiles()
    expect(files.length).toBeGreaterThanOrEqual(5) // watch/attempt/session + the engine decisions
    const problems: string[] = []
    for (const file of files) {
      const text = readFileSync(join(import.meta.dir, "..", file), "utf8")
      for (const token of BANNED) if (text.includes(token)) problems.push(`${file}: ${token}`)
    }
    expect(problems.join("\n")).toBe("")
  })

  test("the scan reads real sources (a clean pass is never vacuous)", () => {
    // A module outside the engine does sleep on Bun.sleep today; the scan's
    // file reads see such tokens, so the clean pass above means the engine
    // is clean, not that nothing was read.
    const hibernate = readFileSync(join(import.meta.dir, "..", "src", "hibernate.ts"), "utf8")
    expect(hibernate.includes("Bun.sleep")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The holder's lifecycle
// ---------------------------------------------------------------------------

describe("the services holder", () => {
  test("SERVICE_ENTRIES is the documented seed and may only shrink", () => {
    // The start list of the consolidation: the composition root, the loop,
    // the session-driving entries, the interactive sideband and the agent
    // pool. This pins the seed; the callers assertion lands with the later
    // services units and holds this exact shape against the source.
    expect([...SERVICE_ENTRIES]).toEqual(["loop-preflight", "loop", "session", "attempt", "watch", "interactive", "agent-pool"])
  })

  test("services() returns the installed instance, else a stable process default", () => {
    const before = services()
    const holder: RunServices = createServices()
    installServices(holder)
    expect(services()).toBe(holder)
    uninstallServices()
    expect(services()).toBe(before)
    // The default is built once, not per call.
    expect(services()).toBe(before)
  })

  test("uninstalling a nested install restores the surrounding holder", () => {
    const outer = createServices()
    installServices(outer)
    const inner = createServices()
    installServices(inner)
    expect(services()).toBe(inner)
    uninstallServices()
    expect(services()).toBe(outer)
    uninstallServices()
    expect(services()).not.toBe(outer)
  })

  test("a fresh holder from the preload is in effect for every test", () => {
    // The preload installed a fresh createServices() before this test; its
    // clock is a live system clock (the same readings the pre-holder code
    // took), and it is not some earlier test's steered holder.
    const now = services().clock.now()
    expect(typeof now).toBe("number")
    expect(Number.isFinite(now)).toBe(true)
  })

  test("the fresh holder extends to the router: state one test writes never leaks to the next", () => {
    // The pair's writer: mark through this test's instance…
    const router = services().router
    router.setSticky("prov/a")
    router.requestFailback()
    router.markModelDown("k3")
    expect(router.stickyModel()).toBe("prov/a")
    expect(router.failbackRequested()).toBe(true)
    expect(router.isModelDown("k3", 0)).toBe(true)
  })

  test("…and the next test's router carries none of it", () => {
    // …and the preload's install before this test gave a fresh instance:
    // the moved state has no reset hook because none is needed.
    const router = services().router
    expect(router.stickyModel()).toBeUndefined()
    expect(router.failbackRequested()).toBe(false)
    expect(router.downMarks().size).toBe(0)
  })

  test("the stats clock follows the installed holder (the fold)", async () => {
    // stats is a process-level module; its timeline is the run's one clock.
    // Book a task bucket on a manual clock and read the bucket's anchor and
    // the extrapolated open segment back.
    const dir = await mkdtemp(join(tmpdir(), "auto-services-"))
    try {
      const mc = manualClock(1_000_000)
      installServices(createServices({ clock: mc.clock }))
      await loadStats(dir)
      await statsTask(dir, "T-001")
      const totals = await statsTotals(dir, "task")
      expect(totals?.id).toBe("T-001")
      // The bucket anchored at the manual instant, not the wall clock.
      expect(totals?.since).toBe(1_000_000)
      mc.advance(5_000)
      // The extrapolated open segment grows on the steered timeline alone.
      expect((await statsTotals(dir, "task"))!.wallMs).toBe(5_000)
    } finally {
      uninstallServices()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// The router ratchets: the state that moved into the router service exists
// only there
// ---------------------------------------------------------------------------

// Every free function that moved into the router (its method names). A
// `export function <name>` anywhere outside router.ts would be a delegator
// over the moved singleton — the conversion crutch the unit that moves
// state may use while it converts callers, and must delete in the same
// unit.
const MOVED_TO_ROUTER = [
  "stickyModel",
  "setSticky",
  "clearSticky",
  "failbackOverride",
  "requestFailback",
  "failbackRequested",
  "consumeFailback",
  "downMarks",
  "markModelDown",
  "extendModelDownMark",
  "clearModelDownMark",
  "modelDownMark",
  "isModelDown",
  "markKeyDown",
  "extendKeyDownMark",
  "keyDownMark",
  "isKeyDown",
  "clearKeyDownMarks",
  "clearDownMarks",
  "noteWindows",
  "awaitCacheClaim",
  "observeCacheClaim",
  "noteClaimContradiction",
] as const

// The modules whose state moved (fully or in part) into the router: a
// `reset*` export in one of them (or in router.ts itself) would be a reset
// hook for the moved state, which the per-test fresh holder replaces.
const MOVED_STATE_MODULES = ["router", "failback", "model-step", "watch"]

function srcFiles(): string[] {
  const files = readdirSync(join(import.meta.dir, "..", "src"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `src/${name}`)
  for (const dir of readdirSync(join(import.meta.dir, "..", "src")).filter((name) => statSync(join(import.meta.dir, "..", "src", name)).isDirectory())) {
    if (dir === "engine" || dir === "agent") continue // no state moved from there
    for (const name of readdirSync(join(import.meta.dir, "..", "src", dir)).filter((name) => name.endsWith(".ts")))
      files.push(`src/${dir}/${name}`)
  }
  return files
}

describe("the router ratchets (the moved state exists only as the service)", () => {
  test("no free-function delegator export of a moved name outside router.ts", () => {
    const problems: string[] = []
    for (const file of srcFiles()) {
      if (file === "src/router.ts") continue
      const text = readFileSync(join(import.meta.dir, "..", file), "utf8")
      for (const name of MOVED_TO_ROUTER) if (new RegExp(`export (async )?function ${name}\\b`).test(text)) problems.push(`${file}: ${name}`)
    }
    expect(problems.join("\n")).toBe("")
  })

  test("no reset* export for the moved state (a fresh holder per test replaces the hook)", () => {
    const problems: string[] = []
    for (const file of srcFiles()) {
      const module = file.replace(/^src\//, "").replace(/\.ts$/, "")
      if (!MOVED_STATE_MODULES.includes(module)) continue
      const text = readFileSync(join(import.meta.dir, "..", file), "utf8")
      for (const m of text.matchAll(/export (async )?function (reset\w*)/g)) problems.push(`${file}: ${m[2]}`)
    }
    expect(problems.join("\n")).toBe("")
  })

  test("failback.ts holds only the pure granularity helper", () => {
    // The moved state's old home shrinks to failbackApplies; a new export
    // there is a conscious edit to this pin, not a silent accretion.
    const text = readFileSync(join(import.meta.dir, "..", "src", "failback.ts"), "utf8")
    const exported = [...text.matchAll(/export (?:async )?function (\w*)/g)].map((m) => m[1])
    expect(exported).toEqual(["failbackApplies"])
  })
})

// ---------------------------------------------------------------------------
// The frozen switch snapshot
// ---------------------------------------------------------------------------

describe("the frozen switch snapshot", () => {
  test("freezing after the clamp: a later clamp throws, a re-parse builds a fresh snapshot", () => {
    // The run start clamps exactly once, at the agent fleet's start, and
    // freezes right after; anything clamping again is a programming error,
    // not a silent no-op.
    setSwitchModelRegistry(undefined)
    autoSwitches()
    freezeSwitches()
    expect(Object.isFrozen(autoSwitches())).toBe(true)
    expect(() => clampSwitches({ fork: false })).toThrow()
    // Declaring the facts again re-parses: the fresh snapshot is unfrozen
    // and carries the environment as it stands now.
    setSwitchModelRegistry(undefined)
    expect(Object.isFrozen(autoSwitches())).toBe(false)
    expect(autoSwitches().fork).toBe(parseSwitches({}).fork)
  })
})
