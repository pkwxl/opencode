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
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { tickIndexLine } from "../src/document/unit"
import { noCommitGit } from "../src/git-ops"
import { loadPlan, renderTaskIndex, taskStatePaths, UNITS_FILE } from "../src/tasks"
import { flushStats } from "../src/stats"
import { runTask } from "../src/runner"
import { createServices, installServices, services, uninstallServices } from "../src/services"
import { setSwitchModelRegistry } from "../src/switches"
import { fakeAgent } from "./fixtures/agent"

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
