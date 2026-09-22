// Task store over task units (M3.4, plans/0047 §3–§4): loading a phase's
// tasks from tasks.md + docs/T-NNN/todo.md|done.md, runtime state in
// .auto/units.json, the driver's completion (rename + index tick), the
// subtask checklist from subtasks.md, and the planning-session checks.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { syncPhaseIndex, type PhaseUnit } from "../src/phases"
import {
  begin,
  block,
  countSubtasks,
  loadPlan,
  markDone,
  next,
  plannedTaskProblems,
  readChecklist,
  renderTaskIndex,
  renderTaskTodo,
  resetInProgress,
  resetPlanning,
  setForkBase,
  subtasks,
  takenTaskIds,
  taskBody,
  tickSubtask,
  UNITS_FILE,
} from "../src/tasks"
import { seedUnits } from "./fixtures/units"

let dir: string
let phase: PhaseUnit

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "auto-tasks-"))
  ;[phase] = await syncPhaseIndex(dir, 1, "m")
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const SAMPLE = `## T-001: 搭建 schema [done]
数据层建模。

## T-002: 实现迁移 [blocked]
  - attempts: 1
编写迁移脚本。

## T-003: 编写 API [pending]
REST 接口。

- [x] 路由
- [ ] 鉴权
`

describe("loadPlan", () => {
  test("reads the index order, state files and runtime state", async () => {
    const plan = await seedUnits(dir, SAMPLE)
    expect(plan.index).toBe("docs/R-01/P01-implement/tasks.md")
    expect(plan.phase).toBe("R-01.P01")
    expect(plan.tasks.map((t) => [t.id, t.status, t.attempts])).toEqual([
      ["T-001", "done", 0],
      ["T-002", "blocked", 1],
      ["T-003", "pending", 0],
    ])
    expect(plan.tasks[1]!.title).toBe("实现迁移")
    expect(plan.tasks[1]!.body).toBe("编写迁移脚本。")
    expect(plan.tasks[1]!.phase).toBe("R-01.P01")
    expect(next(plan)!.id).toBe("T-002")
  })

  test("the checklist comes from subtasks.md, not the body", async () => {
    const plan = await seedUnits(dir, SAMPLE)
    const t3 = plan.tasks[2]!
    expect(t3.body).toBe("REST 接口。")
    expect(t3.checklist).toEqual([
      { text: "路由", done: true },
      { text: "鉴权", done: false },
    ])
    expect(countSubtasks(t3.checklist)).toEqual({ done: 1, total: 2 })
  })

  test("state files win over the subtasks.md tick once the protocol is active", async () => {
    await seedUnits(dir, SAMPLE)
    await mkdir(join(dir, "docs/T-003/S01"), { recursive: true })
    await mkdir(join(dir, "docs/T-003/S02"), { recursive: true })
    await Bun.write(join(dir, "docs/T-003/S01/todo.md"), "scope\n")
    await Bun.write(join(dir, "docs/T-003/S02/done.md"), "scope\n")
    expect((await readChecklist(dir, "T-003")).map((item) => item.done)).toEqual([false, true])
  })

  test("a missing index is an empty plan", async () => {
    expect((await loadPlan(dir, phase)).tasks).toEqual([])
  })

  test("an index line without a state file, or with both, throws with guidance", async () => {
    await Bun.write(join(dir, phase.dir, "tasks.md"), renderTaskIndex("R-01.P01", [{ id: "T-001", title: "a" }]))
    await expect(loadPlan(dir, phase)).rejects.toThrow("docs/T-001/ has neither todo.md nor done.md")
    await mkdir(join(dir, "docs/T-001"), { recursive: true })
    await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001: a\n")
    await Bun.write(join(dir, "docs/T-001/done.md"), "# T-001: a\n")
    await expect(loadPlan(dir, phase)).rejects.toThrow("both todo.md and done.md")
  })

  test("a malformed index line throws", async () => {
    await Bun.write(join(dir, phase.dir, "tasks.md"), "- [ ] X-1 bad\n")
    await expect(loadPlan(dir, phase)).rejects.toThrow("is not a task id")
  })

  test("taskBody drops the title, the field block and the terminator", () => {
    expect(taskBody("# T-001: a\nPhase: R-01.P01\nDepends: none\n\n## Goal\n\ng\n\n<!-- auto: eof -->\n")).toBe("## Goal\n\ng")
    expect(taskBody(renderTaskTodo({ id: "T-002", title: "b", goal: "g", scope: "s", acceptance: "a" }))).toBe(
      "## Goal\n\ng\n\n## Scope\n\ns\n\n## Acceptance\n\na",
    )
  })
})

describe("runtime state (.auto/units.json)", () => {
  test("begin sets in_progress and counts attempts; resetInProgress clears only the status", async () => {
    await seedUnits(dir, SAMPLE)
    await begin(dir, "T-003")
    await begin(dir, "T-003")
    let plan = await loadPlan(dir, phase)
    expect(plan.tasks[2]).toMatchObject({ status: "in_progress", attempts: 2 })
    expect(await resetInProgress(dir)).toEqual(["T-003"])
    plan = await loadPlan(dir, phase)
    expect(plan.tasks[2]).toMatchObject({ status: "pending", attempts: 2 })
  })

  test("block records blocked; setForkBase persists the base", async () => {
    await seedUnits(dir, SAMPLE)
    await block(dir, "T-003")
    await setForkBase(dir, "T-003", "digest:ses_1")
    const t3 = (await loadPlan(dir, phase)).tasks[2]!
    expect(t3.status).toBe("blocked")
    expect(t3.forkBase).toBe("digest:ses_1")
  })

  test("an unreadable units.json degrades to defaults", async () => {
    await seedUnits(dir, SAMPLE)
    await Bun.write(join(dir, UNITS_FILE), "{broken")
    expect((await loadPlan(dir, phase)).tasks[1]).toMatchObject({ status: "pending", attempts: 0 })
  })
})

describe("driver completion", () => {
  test("markDone renames todo.md, ticks the index line and drops the runtime entry; idempotent", async () => {
    const plan = await seedUnits(dir, SAMPLE)
    await begin(dir, "T-003")
    await markDone(plan, "T-003")
    await markDone(plan, "T-003")
    expect(await Bun.file(join(dir, "docs/T-003/todo.md")).exists()).toBe(false)
    expect(await Bun.file(join(dir, "docs/T-003/done.md")).exists()).toBe(true)
    expect(await Bun.file(join(dir, plan.index)).text()).toContain("- [x] T-003 编写 API")
    const t3 = (await loadPlan(dir, phase)).tasks[2]!
    expect(t3).toMatchObject({ status: "done", attempts: 0 })
  })

  test("tickSubtask ticks the n-th checklist line of subtasks.md", async () => {
    await seedUnits(dir, SAMPLE)
    await tickSubtask(dir, "T-003", 2)
    await tickSubtask(dir, "T-003", 2)
    expect(subtasks(await Bun.file(join(dir, "docs/T-003/subtasks.md")).text()).map((item) => item.done)).toEqual([true, true])
  })
})

describe("planning output", () => {
  // Long enough to pass the non-trivial shape threshold.
  const GOAL = "Deliver the migrated module with the same behavior as the source, documented where it differs."
  const writeTask = async (id: string, extra: Partial<Parameters<typeof renderTaskTodo>[0]> = {}) => {
    await mkdir(join(dir, "docs", id), { recursive: true })
    await Bun.write(join(dir, "docs", id, "todo.md"), renderTaskTodo({ id, title: id, phase: "R-01.P01", goal: GOAL, scope: "src/a.ts and src/b.ts only", acceptance: "bun test passes", ...extra }))
  }

  test("accepts an index with complete task documents", async () => {
    await Bun.write(join(dir, phase.dir, "tasks.md"), renderTaskIndex("R-01.P01", [{ id: "T-001", title: "a" }, { id: "T-002", title: "b" }]))
    await writeTask("T-001")
    await writeTask("T-002")
    expect(await plannedTaskProblems(dir, phase, { before: new Set() })).toEqual({ problems: [], ids: ["T-001", "T-002"] })
  })

  test("reports a missing index, an empty index, missing sections, a wrong Phase field and taken ids", async () => {
    expect((await plannedTaskProblems(dir, phase, { before: new Set() })).problems[0]).toContain("tasks.md is missing")
    await Bun.write(join(dir, phase.dir, "tasks.md"), "# Tasks\n")
    expect((await plannedTaskProblems(dir, phase, { before: new Set() })).problems[0]).toContain("lists no task")
    await Bun.write(join(dir, phase.dir, "tasks.md"), renderTaskIndex("R-01.P01", [{ id: "T-001", title: "a" }, { id: "T-002", title: "b" }, { id: "T-003", title: "c" }]))
    await mkdir(join(dir, "docs/T-001"), { recursive: true })
    await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001: a\nPhase: R-01.P01\n\n## Goal\n\ng\n\n<!-- auto: eof -->\n")
    await writeTask("T-002", { phase: "R-09.P09" })
    await writeTask("T-003")
    const { problems } = await plannedTaskProblems(dir, phase, { before: new Set(["T-003"]) })
    expect(problems.some((p) => p.includes("docs/T-001/todo.md") && p.includes("## Scope"))).toBe(true)
    expect(problems.some((p) => p.includes("docs/T-002/todo.md must carry the field line `Phase: R-01.P01`"))).toBe(true)
    expect(problems.some((p) => p.startsWith("T-003 is already used"))).toBe(true)
  })

  test("the numbering start rejects lower ids", async () => {
    await Bun.write(join(dir, phase.dir, "tasks.md"), renderTaskIndex("R-01.P01", [{ id: "T-004", title: "a" }]))
    await writeTask("T-004")
    const { problems } = await plannedTaskProblems(dir, phase, { before: new Set(), numberStart: 7 })
    expect(problems[0]).toContain("below the numbering start T-007")
  })

  test("taken ids = other phases' indexes and completed tasks; resetPlanning clears only this phase's own output", async () => {
    const [p1, p2] = await syncPhaseIndex(dir, 1, "adm")
    await Bun.write(join(dir, p1!.dir, "tasks.md"), renderTaskIndex("R-01.P01", [{ id: "T-001", title: "a" }]))
    await mkdir(join(dir, "docs/T-001"), { recursive: true })
    await Bun.write(join(dir, "docs/T-001/done.md"), "# T-001: a\n")
    await mkdir(join(dir, "docs/T-009"), { recursive: true })
    await Bun.write(join(dir, "docs/T-009/done.md"), "# T-009: stray done\n")
    await Bun.write(join(dir, p2!.dir, "tasks.md"), renderTaskIndex("R-01.P02", [{ id: "T-001", title: "reused" }, { id: "T-002", title: "b" }]))
    await writeTask("T-002")
    expect([...(await takenTaskIds(dir, p2!))].sort()).toEqual(["T-001", "T-009"])
    await resetPlanning(dir, p2!)
    expect(await Bun.file(join(dir, p2!.dir, "tasks.md")).exists()).toBe(false)
    expect(await Bun.file(join(dir, "docs/T-002/todo.md")).exists()).toBe(false)
    expect(await Bun.file(join(dir, "docs/T-001/done.md")).exists()).toBe(true)
  })
})
