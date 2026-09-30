// The run-services ratchets and lifecycle (the consolidation's services
// stage): the engine modules (watch, attempt, session and the pure engine
// decisions under src/engine/) read time only through the installed
// services' clock — no raw Date.now, Bun.sleep or setTimeout anywhere in
// them — plus the holder's install/uninstall lifecycle, the stats clock
// fold, the frozen switch snapshot's clamp invariant, the moved-state
// ratchets: the state a service moved in (the router's failback holders,
// down marks, logged windows, model-step cache claims, key rings and
// classifier run state; the control's /exit request and its sleepers)
// exists only as methods on the constructed service — no free-function
// delegator export anywhere else in src/, and no reset* hook for it
// anywhere — the git seam's ratchet: the strategy's free delegates (the
// commit-side functions the production instance is built over) stay
// exported only from the seam's homes, git.ts and git-ops.ts, so no
// second free entry point grows beside the holder's strategy — and the
// callers ratchet: the ambient accessor `services()`
// is called only by the modules SERVICE_ENTRIES lists (a comment-stripped
// scan over all of src; the list is the documented, shrink-only
// allowlist).
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { ExitRequested } from "../src/exit"
import { noCommitGit } from "../src/git-ops"
import { createServices, installServices, SERVICE_ENTRIES, services, uninstallServices, type RunServices } from "../src/services"
import type { ModelRegistry } from "../src/models-schema"
import { loadStats, statsTask, statsTotals } from "../src/stats"
import { autoSwitches, clampSwitches, freezeSwitches, parseSwitches, setSwitchModelRegistry } from "../src/switches"
import { manualClock } from "./fixtures/clock"

// A one-ring registry for the router-freshness pair's ring rows: one
// opencode entry on provider `zhipuai` with a two-key ring.
const ringRegistry = (): ModelRegistry => ({
  layers: [{ name: "operator", path: "/unused/models.json" }],
  tz: "UTC",
  agents: new Map([["opencode", { name: "opencode", layer: "operator", adapter: "opencode" }]]),
  models: new Map([
    [
      "glm",
      {
        name: "glm",
        layer: "operator",
        agent: "opencode",
        model: "zhipuai/glm-4.6",
        provider: "zhipuai",
        keys: [
          { kind: "env", name: "ZHIPU_KEY_A", ref: "{env:ZHIPU_KEY_A}", label: "ZHIPU_KEY_A" },
          { kind: "env", name: "ZHIPU_KEY_B", ref: "{env:ZHIPU_KEY_B}", label: "ZHIPU_KEY_B" },
        ],
      },
    ],
  ]),
  tiers: {},
  routes: new Map(),
  unused: [],
})

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
    // pool. This pins the seed; the callers ratchet below holds every real
    // `services()` caller inside this exact shape.
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
    // …the key rings too: activate them over a one-ring registry.
    router.activateRings(ringRegistry(), false)
    expect(router.ringsActive()).toBe(true)
    expect(router.hasActiveRing("zhipuai")).toBe(true)
    // …and the classifier's run state: an answer, a budget call, the
    // limit line's flag and the usage sink.
    router.noteClassifierAnswer("k", { class: "quota" })
    router.noteClassifierCall()
    router.noteClassifierLimit()
    router.setClassifyUsageSink(() => {})
    expect(router.classifierCalls()).toBe(1)
    expect(router.classifierAnswerOf("k")).toEqual({ class: "quota" })
    expect(router.classifierLimitNoted()).toBe(true)
    expect(router.classifyUsageSink()).toBeDefined()
  })

  test("…and the next test's router carries none of it", () => {
    // …and the preload's install before this test gave a fresh instance:
    // the moved state has no reset hook because none is needed.
    const router = services().router
    expect(router.stickyModel()).toBeUndefined()
    expect(router.failbackRequested()).toBe(false)
    expect(router.downMarks().size).toBe(0)
    // The rings never activated on this instance: every read answers
    // "no ring", exactly as before the run's agent starts.
    expect(router.ringsActive()).toBe(false)
    expect(router.hasActiveRing("zhipuai")).toBe(false)
    expect(router.spawnKeyConfig()).toBeUndefined()
    // The classifier's run state is fresh too: no answers, no budget
    // spent, the limit line not yet said, no sink.
    expect(router.classifierAnswerOf("k")).toBeUndefined()
    expect(router.classifierInflightOf("k")).toBeUndefined()
    expect(router.classifierCalls()).toBe(0)
    expect(router.classifierLimitNoted()).toBe(false)
    expect(router.classifyUsageSink()).toBeUndefined()
  })

  test("the fresh holder extends to the control: an /exit one test requests never leaks to the next", () => {
    // The pair's writer, control side: request the graceful exit through
    // this test's instance and read it back — the flag is set and the
    // boundary checkpoint throws (the state the deleted resetExitRequest
    // hook used to clear between tests).
    const control = services().control
    control.requestExit()
    expect(control.exitRequested()).toBe(true)
    expect(() => control.maybeExit("task", "task T-001 the title")).toThrow(ExitRequested)
  })

  test("…and the next test's control starts with the /exit flag unset", () => {
    // The preload's install before this test gave a fresh instance, so the
    // previous test's request is gone with that instance: the flag has no
    // reset method because none is needed — a fresh instance is the reset.
    const control = services().control
    expect(control.exitRequested()).toBe(false)
    expect(() => control.maybeExit("task", "task T-001 the title")).not.toThrow()
  })

  test("the git override carries the no-commit double, and the holder after it is the production commit side again", () => {
    // The strategy seam has no reset hook because none is needed: the
    // double is a whole instance a test installs through createServices'
    // override slot (the engine then reads committing-off answers through
    // services().git), and the surrounding fresh holder — the preload's
    // for the next test, restored here by the uninstall — builds the
    // production delegation again. Committing off never leaks across
    // tests, the same fresh-instance isolation the moved state above gets.
    const double = noCommitGit()
    installServices(createServices({ git: double }))
    expect(services().git).toBe(double)
    expect(services().git.records).toBe(false)
    uninstallServices()
    expect(services().git).not.toBe(double)
    expect(services().git.records).toBe(true)
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
// The moved-state ratchets: state that moved into a constructed service
// exists only there
// ---------------------------------------------------------------------------

// Every free function that moved into the router (its method names). A
// `export function <name>` anywhere outside router.ts would be a delegator
// over the moved singleton — the conversion crutch the unit that moves
// state may use while it converts callers, and must delete in the same
// unit. The key-ring block is the ring tranche: the functions keyring.ts
// exported before its state moved in. The classifier block is the
// classifier-state tranche: `setClassifyUsageSink` keeps the module
// export's name, the rest are the key-level accessors over the state
// (the answer cache, the in-flight calls, the budget, the limit line's
// once flag and the sink) that classify.ts held as module variables.
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
  "activateRings",
  "ringsActive",
  "currentKey",
  "hasActiveRing",
  "ringHasUsableKey",
  "ringRotation",
  "commitRotation",
  "spawnKeyConfig",
  "ringLabel",
  "ringInactiveNote",
  "clearRingMarks",
  "markCurrentKeyDown",
  "noteWindows",
  "awaitCacheClaim",
  "observeCacheClaim",
  "noteClaimContradiction",
  "classifierAnswerOf",
  "noteClassifierAnswer",
  "classifierInflightOf",
  "noteClassifierInflight",
  "dropClassifierInflight",
  "classifierCalls",
  "noteClassifierCall",
  "classifierLimitNoted",
  "noteClassifierLimit",
  "setClassifyUsageSink",
  "classifyUsageSink",
] as const

// Every free function that moved into the control service (its method
// names): the /exit request, its read, the wakeable sleep and the boundary
// throw. A `export function <name>` anywhere outside exit.ts would be the
// same crutch over the moved state. (`sleepUnlessExit` also stays a Clock
// member by design: the clock's object-literal member is not an `export
// function` declaration, so the scan does not target it.)
const MOVED_TO_CONTROL = ["requestExit", "exitRequested", "sleepUnlessExit", "maybeExit"] as const

// The git seam's free delegates — the production instance's backing
// functions, the one service surface that is a switchable strategy rather
// than moved state. Nothing moved: the free exports stay where they always
// lived, because callers outside any run's services (the close command,
// the recovery paths) keep calling the git.ts five directly, and the
// production instance is pure delegation over them. The ratchet guarding
// them is therefore the delegator scan below, not MOVED_STATE_MODULES: a
// `export function <name>` outside the seam's homes would be a second
// free entry point beside the holder's strategy, letting a caller skip
// the instance a test replaced with the double. afterSession's home is
// git-ops.ts, beside the two factories and the marker collection its
// no-commit arm shares with the production body.
const GIT_SEAM_IN_GIT = ["commitTree", "unitBaseline", "beginUnit", "commitPending", "changedFiles"] as const
const GIT_SEAM_IN_GIT_OPS = ["afterSession"] as const

// The modules whose state moved (fully or in part) into a constructed
// service: a `reset*` export in one of them (or in a service's own home,
// router.ts / exit.ts) would be a reset hook for the moved state, which
// the per-test fresh holder replaces. The git seam's homes (git.ts,
// git-ops.ts) are deliberately absent: no module state moved there — the
// seam is a switchable strategy over free functions, the double replaces
// the instance whole, and the fresh holder per test is the only reset the
// strategy needs (the git override row in the holder describe above pins
// that the production side is back with the next holder).
const MOVED_STATE_MODULES = ["router", "failback", "model-step", "watch", "keyring", "classify", "exit"]

// Every src module, recursively — the moved-state and callers scans have
// no directory exemptions (engine/ and agent/ are scanned like every flat
// file); each scan's own filter (the service home, the module list, the
// allowlist) does the narrowing.
function srcFiles(): string[] {
  const root = join(import.meta.dir, "..", "src")
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name.endsWith(".ts")) files.push(`src/${relative(root, p).replaceAll("\\", "/")}`)
    }
  }
  walk(root)
  return files
}

describe("the service-surface ratchets (moved state and the git seam's delegates exist only in their homes)", () => {
  test("no free-function delegator export of a service name outside its service's home", () => {
    // The homes: router.ts for the routing tranches, exit.ts for the
    // control, git.ts and git-ops.ts for the commit seam's delegates. A
    // delegator export anywhere else in src/ would let a caller keep the
    // free-function shape over what is now the service's state — or, for
    // the git seam, over the run's strategy: a second free entry point
    // beside the instance the holder carries (which a test may have
    // replaced with the no-commit double).
    const scans: Array<{ home: string; names: readonly string[] }> = [
      { home: "src/router.ts", names: MOVED_TO_ROUTER },
      { home: "src/exit.ts", names: MOVED_TO_CONTROL },
      { home: "src/git.ts", names: GIT_SEAM_IN_GIT },
      { home: "src/git-ops.ts", names: GIT_SEAM_IN_GIT_OPS },
    ]
    const problems: string[] = []
    for (const file of srcFiles()) {
      const text = readFileSync(join(import.meta.dir, "..", file), "utf8")
      for (const { home, names } of scans) {
        if (file === home) continue
        for (const name of names) if (new RegExp(`export (async )?function ${name}\\b`).test(text)) problems.push(`${file}: ${name}`)
      }
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

  test("keyring.ts holds only the pure ring library", () => {
    // The ring state's old home shrinks to the ring build and the key
    // label; a new export there is a conscious edit to this pin, not a
    // silent accretion (the state itself is the router's now).
    const text = readFileSync(join(import.meta.dir, "..", "src", "keyring.ts"), "utf8")
    const exported = [...text.matchAll(/export (?:async )?function (\w*)/g)].map((m) => m[1])
    expect(exported).toEqual(["buildRings", "ringKeyLabel"])
  })

  test("exit.ts holds only the control service's factory", () => {
    // The /exit state's old home shrinks to the service's construction
    // surface: the factory is the one function export (the `Control` type
    // and the `ExitRequested` class stay as the type/throw exports the
    // loop, the session and the tests import); a new function export there
    // is a conscious edit to this pin, not a silent accretion.
    const text = readFileSync(join(import.meta.dir, "..", "src", "exit.ts"), "utf8")
    const exported = [...text.matchAll(/export (?:async )?function (\w*)/g)].map((m) => m[1])
    expect(exported).toEqual(["createControl"])
  })

  test("the ratchets bite: the patterns match crafted violations and every list tracks its service's real surface", () => {
    // The source scans above pass on a clean tree, which says nothing about
    // a pattern that stopped matching anything. So: the same patterns must
    // catch the violations they were written for (a delegator export of a
    // moved or seam name, a reset* hook in a moved-state module)…
    const delegator = `export function ${MOVED_TO_ROUTER[0]}(router: unknown): void {}`
    expect(new RegExp(`export (async )?function ${MOVED_TO_ROUTER[0]}\\b`).test(delegator)).toBe(true)
    expect(new RegExp(`export (async )?function ${MOVED_TO_CONTROL[0]}\\b`).test(`export function ${MOVED_TO_CONTROL[0]}(): void {}`)).toBe(true)
    // …one per git home too: an out-of-home commitTree (sync, the shape a
    // wrapper would take) and an out-of-home afterSession (async, as the
    // real one is declared)…
    expect(new RegExp(`export (async )?function ${GIT_SEAM_IN_GIT[0]}\\b`).test(`export function ${GIT_SEAM_IN_GIT[0]}(dir: string): void {}`)).toBe(true)
    expect(new RegExp(`export (async )?function ${GIT_SEAM_IN_GIT_OPS[0]}\\b`).test(`export async function ${GIT_SEAM_IN_GIT_OPS[0]}(): void {}`)).toBe(true)
    expect([...`export function resetExitRequest(): void {}`.matchAll(/export (async )?function (reset\w*)/g)].map((m) => m[2])).toEqual([
      "resetExitRequest",
    ])
    // …and every list tracks its service's real surface: every name is a
    // method of the constructed service, so the delegator scan covers
    // methods that exist, and a renamed one fails here rather than
    // scanning for a name nothing owns.
    const router = services().router as unknown as Record<string, unknown>
    for (const name of MOVED_TO_ROUTER) expect(typeof router[name]).toBe("function")
    const control = services().control as unknown as Record<string, unknown>
    for (const name of MOVED_TO_CONTROL) expect(typeof control[name]).toBe("function")
    // …the git lists against both instances of the seam: every name is a
    // method of the production delegation the holder carries and of the
    // no-commit double the tests install (the strategy marker `records`
    // is a boolean, not a method — pinned as such, true committing on,
    // false the double).
    const gitNames = [...GIT_SEAM_IN_GIT, ...GIT_SEAM_IN_GIT_OPS]
    const git = services().git as unknown as Record<string, unknown>
    for (const name of gitNames) expect(typeof git[name]).toBe("function")
    expect(git.records).toBe(true)
    const double = noCommitGit() as unknown as Record<string, unknown>
    for (const name of gitNames) expect(typeof double[name]).toBe("function")
    expect(double.records).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// The callers ratchet: the ambient accessor only inside the allowlist
// ---------------------------------------------------------------------------

// Removes // and /* */ comments, string-aware: a `//` inside a quoted or
// template string is text (a URL is not a comment), plain string bodies
// are dropped (a "services()" between quotes is not a call) and template
// bodies are kept (their ${…} interpolations are code). Hand-rolled
// because the scan's one question is exactly "is this mention code?" — a
// raw regex over the source cannot tell router.ts's header prose
// (`services().router` in a comment) from session.ts's binding block.
function stripComments(text: string): string {
  let out = ""
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    if (c === "/" && text[i + 1] === "/") {
      // A line comment: gone to the end of its line.
      while (i < text.length && text[i] !== "\n") i++
    } else if (c === "/" && text[i + 1] === "*") {
      // A block comment: gone to its close.
      i += 2
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++
      i += 2
    } else if (c === '"' || c === "'" || c === "`") {
      // A quoted region, consumed whole so its slashes are text: plain
      // strings leave only their quotes, template bodies stay.
      const quote = c
      const keep = quote === "`"
      i++
      while (i < text.length) {
        if (text[i] === "\\") {
          if (keep) out += text[i]! + (text[i + 1] ?? "")
          i += 2
          continue
        }
        if (text[i] === quote) break
        if (keep) out += text[i]
        i++
      }
      i++
    } else {
      out += c
      i++
    }
  }
  return out
}

// The scan's question, as a pure function so the bite rows can feed it
// crafted files: which of these modules call the ambient accessor? The
// holder's own constructors (createServices, installServices…) do not
// match — the word boundary sits inside their longer names.
function servicesCallers(entries: Array<{ module: string; text: string }>): string[] {
  return entries.filter((e) => /\bservices\s*\(\s*\)/.test(stripComments(e.text))).map((e) => e.module)
}

describe("the services() callers ratchet (the ambient accessor only inside the allowlist)", () => {
  test("every services() caller in src/ is a module SERVICE_ENTRIES lists", () => {
    // src/services.ts itself is exempt (the accessor's home). The list may
    // only shrink: a module leaving it means its service read moved into a
    // constructed service it receives as data.
    const entries = srcFiles()
      .filter((file) => file !== "src/services.ts")
      .map((file) => ({ module: file.replace(/^src\//, "").replace(/\.ts$/, ""), text: readFileSync(join(import.meta.dir, "..", file), "utf8") }))
    const callers = servicesCallers(entries)
    // The scan reads real sources: the engine's entry modules do call the
    // accessor today, so a clean pass means the allowlist holds, not that
    // nothing matched.
    expect(callers.length).toBeGreaterThanOrEqual(1)
    const outside = callers.filter((m) => !(SERVICE_ENTRIES as readonly string[]).includes(m))
    expect(outside.join(", ")).toBe("")
  })

  test("the scan reads real sources (a clean pass is never vacuous)", () => {
    // router.ts's header names `services().router` in prose: raw, the file
    // would read as a caller; comment-stripped, it is not — so the clean
    // pass above proves the stripping really ran, not that the pattern
    // matches nothing. If the prose moves, move this witness with it.
    const raw = readFileSync(join(import.meta.dir, "..", "src", "router.ts"), "utf8")
    expect(/\bservices\s*\(\s*\)/.test(raw)).toBe(true)
    expect(/\bservices\s*\(\s*\)/.test(stripComments(raw))).toBe(false)
  })

  test("the callers scan bites and does not flag prose: crafted files prove both", () => {
    // A real call in an out-of-list module is the violation the ratchet
    // exists for…
    expect(servicesCallers([{ module: "router", text: `const control = services().control` }])).toEqual(["router"])
    // …prose is not a caller, in either comment shape…
    expect(servicesCallers([{ module: "router", text: `// the entries call services().router directly\nexport const a = 1` }])).toEqual([])
    expect(servicesCallers([{ module: "router", text: `/* services().router in a block comment */ export const a = 1` }])).toEqual([])
    // …neither is a string body, nor a `//` inside one swallowing the code
    // after it (the URL row: naive stripping would eat the real call)…
    expect(servicesCallers([{ module: "router", text: `const s = "services()"` }])).toEqual([])
    expect(servicesCallers([{ module: "session", text: `const u = "https://example.com/x"; const clock = services().clock` }])).toEqual(["session"])
    // …nor the holder's own constructors, and an allowlisted module's call
    // is seen exactly because the list holds it…
    expect(servicesCallers([{ module: "router", text: `installServices(createServices())` }])).toEqual([])
    expect(servicesCallers([{ module: "session", text: `const clock = services().clock` }])).toEqual(["session"])
    // …while a template interpolation is code and counts as a call.
    expect(servicesCallers([{ module: "router", text: "log(`${services().clock.now()}`)" }])).toEqual(["router"])
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
