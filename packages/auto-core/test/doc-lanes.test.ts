// Doc lanes (plans/0099): same-tree concurrency for documentation-scoped
// units — the pure predicates (docEligible, effective scope, docScheduler),
// the git seam's decorator (createDocLaneGit), the scoped evidence variants
// and the D2 byte-identical floors, all pure or double-driven like the lane
// suites' pure halves. The loop's own end-to-end cases (the concurrent
// pipelines, the admission and landing guards under overlap, the recovery
// flatten) live in test/agent-fake.test.ts per the plan's test manifest.
//
// Stage A's substrate acceptance lives here first: the serialized
// shared-state writes two concurrent runTask pipelines exercise — the index
// tick (the one read-modify-write that could lose a sibling's write) and the
// stats booking attribution (the unit id captured at dispatch, never the
// ambient bucket) — driven over the native fake agent (fixtures/agent.ts)
// with the no-commit double, the substrate's own surface without the commit
// side stage B scopes.
//
// Stage B adds the pure half: the predicates' truth tables, the decorator
// over a recording fake base (the D4 scoping and queue, the D5 relaxation,
// the D6 guard and its quarantine), and the free functions' scoped variants
// over real git repos (the manifest's repo lane).
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { tickIndexLine } from "../src/document/unit"
import { changedFiles, commitTree, unitAddedLines, unitBaseline, unitChangedFiles, unitViolations, type GitOps } from "../src/git"
import { createDocLaneGit, createGitOps, createDocLaneRegistry, noCommitGit } from "../src/git-ops"
import { docEligible, docScheduler, docScope, scopesDisjoint } from "../src/lanes"
import { loadPlan, renderTaskIndex, taskStatePaths, UNITS_FILE } from "../src/tasks"
import { flushStats } from "../src/stats"
import { runTask } from "../src/runner"
import { commitRangeText } from "../src/wrapup"
import { createServices, installServices, services, uninstallServices } from "../src/services"
import { setSwitchModelRegistry } from "../src/switches"
import { fakeAgent } from "./fixtures/agent"
import { freshRepo, git } from "./fixtures/runner"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "auto-doc-lanes-"))
  installServices(createServices())
})

afterEach(async () => {
  uninstallServices()
  await flushStats(dir).catch(() => {})
  await rm(dir, { recursive: true, force: true })
})

// Two task documents whose field blocks declare independent roots and
// disjoint docs-confined scopes — the shape the doc-lane scheduler admits.
const declaredTodo = (id: string, phase: string): string =>
  [`# ${id}: task ${id}`, `Phase: ${phase}`, "Depends: none", `Touches: docs/${id}/`, "", "## Goal", "", `task ${id} delivered.`, "", "## Scope", "", `docs/${id}/ alone.`, "", "## Acceptance", "", `task ${id}'s statements hold.`, ""].join("\n")

// A phase directory holding an index of the given ids with their documents.
async function seededPhase(ids: string[]): Promise<ReturnType<typeof loadPlan>> {
  const phaseDir = join("docs", "R-01", "P01-implement")
  await Bun.write(join(dir, phaseDir, "tasks.md"), renderTaskIndex("R-01.P01", ids.map((id) => ({ id, title: `task ${id}` }))))
  for (const id of ids) await Bun.write(join(dir, taskStatePaths(id).pending), declaredTodo(id, "R-01.P01"))
  return loadPlan(dir, { round: "R-01", id: "P01", dir: phaseDir })
}

// The scrub the loop suites use: no ambient OPENCODE_AUTO_* layer decides
// anything here, and the switch memo starts clean.
function scrub(): () => void {
  const ambient = Object.entries(process.env).filter(([key]) => key.startsWith("OPENCODE_AUTO_"))
  for (const [key] of ambient) delete process.env[key]
  setSwitchModelRegistry(undefined)
  return () => {
    for (const [key, value] of ambient) if (value !== undefined) process.env[key] = value
    setSwitchModelRegistry(undefined)
  }
}

describe("the serialized substrate (plans/0099 stage A, D8)", () => {
  test("two concurrent index ticks both survive — the read-modify-write is serialized", async () => {
    const file = join(dir, "tasks.md")
    await Bun.write(file, renderTaskIndex("R-01.P01", ["T-001", "T-002", "T-003"].map((id) => ({ id, title: `task ${id}` }))))
    // Both ticks issue before either write can land: the unserialized shape
    // read the same unticked text twice and the second write dropped the
    // first tick (the lost update the queue exists to prevent).
    await Promise.all([tickIndexLine(file, "T-001"), tickIndexLine(file, "T-003")])
    const text = await Bun.file(file).text()
    expect(text).toContain("- [x] T-001")
    expect(text).toContain("- [ ] T-002")
    expect(text).toContain("- [x] T-003")
  })

  test("two concurrent runTask pipelines lose no updates — both index ticks land, the runtime entries clear, and each session's stats booking names its own unit", async () => {
    const restore = scrub()
    const agent = fakeAgent()
    try {
      const plan = await seededPhase(["T-001", "T-002"])
      const opts = { dir, wrapup: false, git: noCommitGit(), router: services().router }
      const [a, b] = await Promise.all([
        runTask(agent.client, plan, plan.tasks[0]!, opts),
        runTask(agent.client, plan, plan.tasks[1]!, opts),
      ])
      expect(a.type).toBe("completed")
      expect(b.type).toBe("completed")
      // Both state files renamed, both index ticks landed (the tick race is
      // the substrate's lost-update window).
      expect(await Bun.file(join(dir, taskStatePaths("T-001").complete)).text()).toContain("T-001")
      expect(await Bun.file(join(dir, taskStatePaths("T-002").complete)).text()).toContain("T-002")
      const index = await Bun.file(join(dir, "docs", "R-01", "P01-implement", "tasks.md")).text()
      expect(index).toContain("- [x] T-001")
      expect(index).toContain("- [x] T-002")
      // Both runtime entries dropped (markDone's updateTask writes survived
      // the sibling's begin — the units.json queue).
      const units = JSON.parse(await Bun.file(join(dir, UNITS_FILE)).text()) as { tasks: Record<string, unknown> }
      expect(units.tasks["T-001"]).toBeUndefined()
      expect(units.tasks["T-002"]).toBeUndefined()
      // The stats attribution: every per-session record names the unit whose
      // pipeline dispatched it — the booking carries the dispatch-captured
      // id, never the ambient bucket (the pre-fix shape attributed both
      // sessions to whichever unit began last).
      await flushStats(dir)
      const stats = JSON.parse(await Bun.file(join(dir, ".auto", "stats.json")).text()) as { sessions: Record<string, { task: string }> }
      const tasks = new Set(Object.values(stats.sessions).map((entry) => entry.task))
      expect(tasks.has("T-001")).toBe(true)
      expect(tasks.has("T-002")).toBe(true)
    } finally {
      restore()
    }
  })
})

// —— Stage B: the pure half ——

describe("the pure predicates (plans/0099 stage B, D1/D2)", () => {
  test("docEligible: the three clauses — declared, docs-confined, whole-task", () => {
    expect(docEligible({ touches: ["docs/T-001/"] })).toBe(true)
    expect(docEligible({ touches: ["docs/T-064/mapping-table.md"] })).toBe(true)
    expect(docEligible({ touches: ["docs/T-001/", "docs/shared/glossary.md"] })).toBe(true)
    // Clause 1: absent/empty Touches means "touches everything" (G3's
    // fail-safe) and is never eligible.
    expect(docEligible({})).toBe(false)
    expect(docEligible({ touches: [] })).toBe(false)
    // Clause 2: everything must lie under docs/ — one source path disqualifies
    // (a nested-repo root such as vendor/lib/ is outside docs/ by
    // construction, the same boundary the contention itself draws).
    expect(docEligible({ touches: ["src/dma/"] })).toBe(false)
    expect(docEligible({ touches: ["docs/T-001/", "src/dma/"] })).toBe(false)
    expect(docEligible({ touches: ["vendor/lib/"] })).toBe(false)
    // Clause 3: whole-task only — pipeline units and split streams keep the
    // tier ≥ 1 story, the serial degrade under doc-lane mode.
    expect(docEligible({ touches: ["docs/T-001/"], decompose: "whole" })).toBe(true)
    expect(docEligible({ touches: ["docs/T-001/"], decompose: "pipeline" })).toBe(false)
    expect(docEligible({ touches: ["docs/T-001/"], decompose: "split" })).toBe(false)
  })

  test("docScope: the declared Touches plus the own docs/T-NNN/ directory, always", () => {
    // dm-glm's T-070 shape: a task declaring only a shared document still
    // writes its own report — the own directory belongs to the scope.
    expect(docScope({ id: "T-070", touches: ["docs/T-064/mapping-table.md"] })).toEqual(["docs/T-064/mapping-table.md", "docs/T-070/"])
    expect(docScope({ id: "T-001", touches: ["docs/T-001/"] })).toEqual(["docs/T-001/"])
    // a parent declaration already covers the own directory
    expect(docScope({ id: "T-001", touches: ["docs/"] })).toEqual(["docs/"])
    expect(docScope({ id: "T-001", touches: ["docs/T-001/a.md", "docs/T-064/mapping-table.md"] })).toEqual([
      "docs/T-001/a.md",
      "docs/T-064/mapping-table.md",
      "docs/T-001/",
    ])
  })

  test("scopesDisjoint: the admission comparison over effective scopes", () => {
    expect(scopesDisjoint(["docs/T-001/"], ["docs/T-002/"])).toBe(true)
    // The case the raw touches comparison of readyUnits would miss: a
    // declaration reaching the sibling's own directory.
    expect(scopesDisjoint(["docs/T-064/mapping-table.md", "docs/T-070/"], ["docs/T-064/"])).toBe(false)
    expect(scopesDisjoint(["docs/"], ["docs/T-001/"])).toBe(false)
  })

  // The truth table is the machine half of D2's floors; the observable-stream
  // halves (the switch off, a phase with no eligible units → the serial
  // loop's stream) are stage C's integration cases over the loop.
  test("docScheduler: the tier-0-only placement over the scheduler activation rule", () => {
    expect(docScheduler(2, "low", 0)).toBe(true)
    expect(docScheduler(3, "high", 0)).toBe(true)
    expect(docScheduler(2, "low", undefined)).toBe(true)
    expect(docScheduler(1, "low", 0)).toBe(false)
    expect(docScheduler(2, undefined, 0)).toBe(false)
    expect(docScheduler(2, "low", 1)).toBe(false)
    expect(docScheduler(2, "low", 2)).toBe(false)
  })

  test("commitRangeText: the doc unit's path-limited range; an absent scope keeps today's string", () => {
    const baseline = [{ root: dir, sha: "abc1234" }]
    expect(commitRangeText(dir, baseline)).toBe("abc1234..HEAD")
    expect(commitRangeText(dir, baseline, ["docs/T-001/"])).toBe("abc1234..HEAD -- docs/T-001/")
    expect(commitRangeText(dir, baseline, ["docs/T-001/", "docs/T-064/mapping-table.md"])).toBe("abc1234..HEAD -- docs/T-001/ docs/T-064/mapping-table.md")
    expect(commitRangeText(dir, [])).toBe(undefined)
  })
})

// A recording fake base for the decorator: changedFiles answers a
// configurable list (the dirt each test stages), commitTree captures its
// call and can be held open (the serialization probe below), and the
// members the decorator never reroutes answer inertly.
function fakeBase(staged: () => Promise<string[]> = async () => []) {
  const calls: { method: string; args: unknown[] }[] = []
  let gate: Promise<void> | undefined
  const base: GitOps = {
    records: true,
    commitTree: async (_dir, task, info, paths) => {
      calls.push({ method: "commitTree", args: [task.id, info.stage, info.subject, paths] })
      if (gate) await gate
      return { ok: true, failures: [] }
    },
    beginUnit: async () => {
      calls.push({ method: "beginUnit", args: [] })
      return { type: "ok", baseline: [] }
    },
    commitPending: async () => "clean",
    afterSession: async () => ({ type: "ok" }),
    unitBaseline: async () => [],
    changedFiles: async () => staged(),
    addWorktree: async () => ({ ok: true }),
    removeWorktree: async () => ({ ok: true }),
    pruneWorktrees: async () => ({ ok: true }),
    landBranch: async () => ({ type: "ok" }),
  }
  return {
    base,
    calls,
    hold: () => {
      let release!: () => void
      gate = new Promise<void>((resolve) => (release = resolve))
      return release
    },
  }
}

const one = { title: "task one" }

describe("the git seam's doc-lane decorator (plans/0099 stage B, D4–D6)", () => {
  test("an empty registry is a pass-through: the commit delegates with no pathspec", async () => {
    const fake = fakeBase()
    const laneGit = createDocLaneGit(fake.base, createDocLaneRegistry())
    await laneGit.commitTree(dir, { id: "T-001", ...one }, { stage: "execute", subject: "T-001 exec task one" })
    expect(fake.calls).toEqual([{ method: "commitTree", args: ["T-001", "execute", "T-001 exec task one", undefined] }])
  })

  test("the empty-registry gate keeps today's semantics: clean passes, driver-state dirt self-heals, other dirt blocks", async () => {
    let dirty: string[] = []
    const fake = fakeBase(async () => dirty)
    const laneGit = createDocLaneGit(fake.base, createDocLaneRegistry())
    expect(await laneGit.beginUnit(dir, {}, { id: "T-001", ...one })).toEqual({ type: "ok", baseline: [] })
    // the heal routes through the queue, unscoped (byte-identical delegation)
    dirty = ["docs/R-01/P01-implement/tasks.md"]
    expect(await laneGit.beginUnit(dir, {}, { id: "T-001", ...one })).toEqual({ type: "ok", baseline: [] })
    expect(fake.calls.filter((call) => call.method === "commitTree")).toEqual([
      { method: "commitTree", args: ["T-001", "carryover", "T-001 carryover driver-state posting", undefined] },
    ])
    dirty = ["src/human.txt"]
    expect(await laneGit.beginUnit(dir, {}, { id: "T-001", ...one })).toEqual({ type: "dirty", files: ["src/human.txt"] })
  })

  test("the start gate tolerates exactly the other live doc units' scopes (D5)", async () => {
    let dirty: string[] = []
    const fake = fakeBase(async () => dirty)
    const registry = createDocLaneRegistry()
    registry.live.set("T-002", ["docs/T-002/"])
    const laneGit = createDocLaneGit(fake.base, registry)
    // sibling in-flight dirt alone: tolerated, baseline recorded as usual
    dirty = ["docs/T-002/b.md"]
    expect(await laneGit.beginUnit(dir, {}, { id: "T-001", ...one })).toEqual({ type: "ok", baseline: [] })
    // a stray beside it: the stray alone names the block (the relaxation is
    // exactly as wide as the in-flight set and no wider)
    dirty = ["docs/T-002/b.md", "src/human.txt"]
    expect(await laneGit.beginUnit(dir, {}, { id: "T-001", ...one })).toEqual({ type: "dirty", files: ["src/human.txt"] })
    // driver-state dirt beside it: the heal commits everything except the
    // live scope — never sweeping the sibling's in-flight work
    dirty = ["docs/T-002/b.md", "docs/R-01/P01-implement/tasks.md"]
    expect(await laneGit.beginUnit(dir, {}, { id: "T-001", ...one })).toEqual({ type: "ok", baseline: [] })
    expect(fake.calls.filter((call) => call.method === "commitTree")).toEqual([
      { method: "commitTree", args: ["T-001", "carryover", "T-001 carryover driver-state posting", [".", ":(exclude)docs/T-002/"]] },
    ])
  })

  test("a live doc unit's commit adds its effective scope plus the dirty driver state; every other commit excludes the live scopes (D4)", async () => {
    let dirty: string[] = []
    const fake = fakeBase(async () => dirty)
    const registry = createDocLaneRegistry()
    registry.live.set("T-001", ["docs/T-001/"])
    registry.live.set("T-002", ["docs/T-002/"])
    const laneGit = createDocLaneGit(fake.base, registry)
    // The unit's own close-out shape (dm-glm's measured `T-NNN done` commit):
    // scope writes beside the phase-index tick — the tick is a driver write
    // outside every scope and rides the unit's own commit.
    dirty = ["docs/T-001/todo.md", "docs/R-01/P01-implement/tasks.md"]
    await laneGit.commitTree(dir, { id: "T-001", ...one }, { stage: "done", subject: "T-001 done task one" })
    expect(fake.calls.at(-1)).toEqual({
      method: "commitTree",
      args: ["T-001", "done", "T-001 done task one", ["docs/T-001/", "docs/R-01/P01-implement/tasks.md"]],
    })
    // A non-live caller (the serial degrade's unit, a janitorial commit) adds
    // everything except the live scopes — with none in flight it would be
    // today's plain sweep.
    dirty = ["docs/T-009/x.md"]
    await laneGit.commitTree(dir, { id: "T-009", title: "task nine" }, { stage: "interrupted", subject: "T-009 pending task nine" })
    expect(fake.calls.at(-1)).toEqual({
      method: "commitTree",
      args: ["T-009", "interrupted", "T-009 pending task nine", [".", ":(exclude)docs/T-001/", ":(exclude)docs/T-002/"]],
    })
  })

  test("commit-shaped calls funnel through one awaited queue — commit-at-a-time (D4)", async () => {
    const fake = fakeBase()
    const registry = createDocLaneRegistry()
    registry.live.set("T-001", ["docs/T-001/"])
    registry.live.set("T-002", ["docs/T-002/"])
    const laneGit = createDocLaneGit(fake.base, registry)
    const release = fake.hold()
    const first = laneGit.commitTree(dir, { id: "T-001", ...one }, { stage: "execute", subject: "a" })
    const second = laneGit.commitTree(dir, { id: "T-002", title: "task two" }, { stage: "execute", subject: "b" })
    await Bun.sleep(20)
    // The second commit waits: exactly one call reached the base, still open.
    expect(fake.calls.filter((call) => call.method === "commitTree").length).toBe(1)
    release()
    await Promise.all([first, second])
    expect(fake.calls.filter((call) => call.method === "commitTree").length).toBe(2)
  })

  test("the landing guard blocks a stray write, quarantines it, and the sibling lands around it (D6)", async () => {
    const dirty = ["docs/T-001/a.md", "docs/T-002/b.md", "src/foo.ts"]
    const fake = fakeBase(async () => dirty)
    const registry = createDocLaneRegistry()
    registry.live.set("T-001", ["docs/T-001/"])
    registry.live.set("T-002", ["docs/T-002/"])
    const laneGit = createDocLaneGit(fake.base, registry)
    const blocked = await laneGit.commitTree(dir, { id: "T-001", ...one }, { stage: "execute", subject: "T-001 exec task one" })
    expect(blocked.ok).toBe(false)
    expect(blocked.failures[0]!.error).toContain("src/foo.ts")
    expect([...registry.quarantine]).toEqual(["src/foo.ts"])
    // No commit reached the base for the blocked unit; the sibling's landing
    // tolerates exactly the quarantined path and adds its own scope alone
    // (the stray survives for the human).
    expect(fake.calls.filter((call) => call.method === "commitTree")).toEqual([])
    const landed = await laneGit.commitTree(dir, { id: "T-002", title: "task two" }, { stage: "execute", subject: "T-002 exec task two" })
    expect(landed.ok).toBe(true)
    expect(fake.calls.at(-1)).toEqual({ method: "commitTree", args: ["T-002", "execute", "T-002 exec task two", ["docs/T-002/"]] })
  })

  test("commitPending keeps its named-files rule and routes the backfill through the queued, scoped core (D4)", async () => {
    const dirty = ["docs/T-001/report.md"]
    const fake = fakeBase(async () => dirty)
    const registry = createDocLaneRegistry()
    registry.live.set("T-001", ["docs/T-001/"])
    const laneGit = createDocLaneGit(fake.base, registry)
    expect(await laneGit.commitPending(dir, {}, { id: "T-001", ...one }, { stage: "wrapup", subject: "s" }, ["docs/T-001/gaps.md"])).toBe("clean")
    expect(fake.calls).toEqual([])
    const committed = await laneGit.commitPending(dir, {}, { id: "T-001", ...one }, { stage: "wrapup", subject: "s" }, ["docs/T-001/report.md"])
    expect(committed).toEqual({ ok: true, failures: [] })
    expect(fake.calls).toEqual([{ method: "commitTree", args: ["T-001", "wrapup", "s", ["docs/T-001/"]] }])
  })

  test("afterSession's failed question names the guard's stray writes (the exit-2 message's source)", async () => {
    const dirty = ["src/foo.ts"]
    const fake = fakeBase(async () => dirty)
    const registry = createDocLaneRegistry()
    registry.live.set("T-001", ["docs/T-001/"])
    const laneGit = createDocLaneGit(fake.base, registry)
    const failed = await laneGit.afterSession(dir, {}, { id: "T-001", ...one }, { stage: "execute", subject: "s" })
    expect(failed).toEqual({ type: "failed", question: expect.stringContaining("src/foo.ts") })
  })
})

describe("the scoped variants over real git (plans/0099 stage B, D4/D7)", () => {
  test("commitTree's add pathspec: own scope, everything-minus-live-scopes, and today's whole sweep", async () => {
    const repo = await freshRepo()
    try {
      await Bun.write(join(repo, "docs/T-001/a.md"), "a\n")
      await Bun.write(join(repo, "docs/T-002/b.md"), "b\n")
      await git(repo, "add", "-A")
      await git(repo, "commit", "-qm", "seed")
      // Own scope: only the unit's file lands, the sibling scope stays dirty.
      await Bun.write(join(repo, "docs/T-001/a.md"), "a2\n")
      await Bun.write(join(repo, "docs/T-002/b.md"), "b2\n")
      expect(await commitTree(repo, { id: "T-001", ...one }, { stage: "execute", subject: "T-001 exec task one" }, ["docs/T-001/"])).toEqual({ ok: true, failures: [] })
      expect(await changedFiles(repo)).toEqual(["docs/T-002/b.md"])
      expect(await git(repo, "show", "--name-only", "--pretty=format:", "HEAD")).toContain("docs/T-001/a.md")
      expect(await git(repo, "log", "-1", "--pretty=%B")).toContain("Auto-Stage: execute")
      // Everything except the live scope: the caller's dirt lands, the
      // excluded scope is never swept.
      await Bun.write(join(repo, "docs/T-001/a.md"), "a3\n")
      await Bun.write(join(repo, "docs/T-002/b.md"), "b3\n")
      expect(await commitTree(repo, { id: "T-009", title: "task nine" }, { stage: "interrupted", subject: "T-009 pending task nine" }, [".", ":(exclude)docs/T-001/"])).toEqual({ ok: true, failures: [] })
      expect(await changedFiles(repo)).toEqual(["docs/T-001/a.md"])
      // No pathspec: today's whole sweep (the byte-identical floor).
      expect(await commitTree(repo, { id: "T-009", title: "task nine" }, { stage: "interrupted", subject: "T-009 pending task nine" })).toEqual({ ok: true, failures: [] })
      expect(await changedFiles(repo)).toEqual([])
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  test("unitViolations' exclude: sibling-scope dirt is tolerated; an empty list is the absent parameter", async () => {
    const repo = await freshRepo()
    try {
      await Bun.write(join(repo, "docs/T-002/b.md"), "b\n")
      await git(repo, "add", "-A")
      await git(repo, "commit", "-qm", "seed")
      const baseline = await unitBaseline(repo)
      await Bun.write(join(repo, "docs/T-002/b.md"), "b2\n")
      const plain = await unitViolations(repo, baseline)
      expect(plain.length).toBe(1)
      expect(plain[0]).toContain("docs/T-002/b.md")
      expect(await unitViolations(repo, baseline, ["docs/T-002/"])).toEqual([])
      expect(await unitViolations(repo, baseline, [])).toEqual(plain)
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  test("unitChangedFiles / unitAddedLines: the scope pathspec keeps attribution inside the unit", async () => {
    const repo = await freshRepo()
    try {
      await Bun.write(join(repo, "docs/T-001/a.md"), "a\n")
      await Bun.write(join(repo, "docs/T-002/b.md"), "b\n")
      await git(repo, "add", "-A")
      await git(repo, "commit", "-qm", "seed")
      const baseline = await unitBaseline(repo)
      await Bun.write(join(repo, "docs/T-001/a.md"), "a2\nnew line T-001\n")
      await Bun.write(join(repo, "docs/T-002/b.md"), "b2\nnew line T-002\n")
      await Bun.write(join(repo, "docs/T-001/new.md"), "fresh T-001\n")
      await Bun.write(join(repo, "docs/T-002/new.md"), "fresh T-002\n")
      const full = await unitChangedFiles(repo, baseline)
      expect([...full].sort()).toEqual(["docs/T-001/a.md", "docs/T-001/new.md", "docs/T-002/b.md", "docs/T-002/new.md"])
      // The absent and undefined parameters are the same whole-subtree question.
      expect(await unitChangedFiles(repo, baseline, undefined)).toEqual(full)
      const scoped = await unitChangedFiles(repo, baseline, ["docs/T-001/"])
      expect([...scoped].sort()).toEqual(["docs/T-001/a.md", "docs/T-001/new.md"])
      const lines = await unitAddedLines(repo, baseline, ["docs/T-001/"])
      expect([...lines.keys()].sort()).toEqual(["docs/T-001/a.md", "docs/T-001/new.md"])
      expect(lines.get("docs/T-001/a.md")!.map((line) => line.text)).toContain("new line T-001")
      const allLines = await unitAddedLines(repo, baseline)
      expect([...allLines.keys()].sort()).toEqual([...full].sort())
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  test("the decorator over the production base: the close-out tick rides the unit's own commit, a stray quarantines", async () => {
    const repo = await freshRepo()
    try {
      await Bun.write(join(repo, "docs/T-001/todo.md"), "seed\n")
      await git(repo, "add", "-A")
      await git(repo, "commit", "-qm", "seed")
      const registry = createDocLaneRegistry()
      registry.live.set("T-001", docScope({ id: "T-001", touches: ["docs/T-001/"] }))
      const laneGit = createDocLaneGit(createGitOps(), registry)
      // The close-out shape: the done rename inside the scope beside the
      // phase-index tick (a driver write outside every scope).
      await Bun.write(join(repo, "docs/T-001/todo.md"), "done\n")
      await Bun.write(join(repo, "docs/R-01/P01-implement/tasks.md"), "- [x] T-001 task one\n")
      expect(await laneGit.commitTree(repo, { id: "T-001", ...one }, { stage: "done", subject: "T-001 done task one" })).toEqual({ ok: true, failures: [] })
      expect(await changedFiles(repo)).toEqual([])
      const landedNames = await git(repo, "show", "--name-only", "--pretty=format:", "HEAD")
      expect(landedNames).toContain("docs/T-001/todo.md")
      expect(landedNames).toContain("docs/R-01/P01-implement/tasks.md")
      // A session writing past its declaration: the guard fails naming the
      // file, the quarantine holds it, the tree keeps it for the human.
      await Bun.write(join(repo, "src/foo.ts"), "stray\n")
      const blocked = await laneGit.commitTree(repo, { id: "T-001", ...one }, { stage: "wrapup", subject: "T-001 wrapup task one" })
      expect(blocked.ok).toBe(false)
      expect(blocked.failures[0]!.error).toContain("src/foo.ts")
      expect([...registry.quarantine]).toEqual(["src/foo.ts"])
      expect(await changedFiles(repo)).toEqual(["src/foo.ts"])
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })
})
