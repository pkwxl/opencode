// Task store over task units (M3.4, plans/0047 §3–§4): loading a phase's
// tasks from tasks.md + docs/T-NNN/todo.md|done.md, runtime state in
// .auto/units.json, the driver's completion (rename + index tick), the
// subtask checklist from subtasks.md, and the planning-session checks.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { syncPhaseIndex, type PhaseUnit } from "../src/phases"
import { renderStatus } from "../src/status"
import {
  begin,
  block,
  doneTaskIds,
  countSubtasks,
  loadPlan,
  markDone,
  newTaskProblems,
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
  taskStatePaths,
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

describe("dependencies (M3.5)", () => {
  const withFields = async (id: string, fields: string) => {
    const file = join(dir, "docs", id, "todo.md")
    const text = await Bun.file(file).text()
    const stripped = text.replace(/^(Depends|Touches):.*\n/gm, "")
    await Bun.write(file, stripped.replace("Phase: R-01.P01\n", `Phase: R-01.P01\n${fields}\n`))
  }
  const THREE = "## T-001: a [pending]\nA.\n\n## T-002: b [pending]\nB.\n\n## T-003: c [pending]\nC.\n"

  test("without Depends the order is the index order", async () => {
    expect(next(await seedUnits(dir, THREE))!.id).toBe("T-001")
  })

  test("Depends reorders selection; Touches is read", async () => {
    await seedUnits(dir, THREE)
    await withFields("T-001", "Depends: T-003")
    await withFields("T-003", "Depends: none\nTouches: src/c.ts")
    const plan = await loadPlan(dir, phase)
    expect(plan.tasks[2]).toMatchObject({ depends: "none", touches: ["src/c.ts"] })
    expect(next(plan)!.id).toBe("T-003")
  })

  test("a completed task of another phase may be named; an unknown or cyclic dependency makes the index invalid", async () => {
    await seedUnits(dir, THREE)
    await mkdir(join(dir, "docs/T-000"), { recursive: true })
    await Bun.write(join(dir, "docs/T-000/done.md"), "# T-000: earlier\n")
    expect([...(await doneTaskIds(dir))]).toEqual(["T-000"])
    await withFields("T-001", "Depends: T-000")
    expect(next(await loadPlan(dir, phase))!.id).toBe("T-001")
    await withFields("T-002", "Depends: T-009")
    await expect(loadPlan(dir, phase)).rejects.toThrow("T-002 depends on unknown T-009")
    await withFields("T-002", "Depends: T-003")
    await expect(loadPlan(dir, phase)).rejects.toThrow("dependency cycle")
  })

  test("the subtask checklist carries each S<nn>/todo.md's Depends", async () => {
    await seedUnits(dir, SAMPLE)
    await mkdir(join(dir, "docs/T-003/S01"), { recursive: true })
    await mkdir(join(dir, "docs/T-003/S02"), { recursive: true })
    await Bun.write(join(dir, "docs/T-003/S01/done.md"), "## Scope\n")
    await Bun.write(join(dir, "docs/T-003/S02/todo.md"), "Depends: none\nTouches: src/auth/\n\n## Scope\n")
    expect(await readChecklist(dir, "T-003")).toEqual([
      { text: "路由", done: true },
      { text: "鉴权", done: false, depends: "none", touches: ["src/auth/"] },
    ])
  })
})

// Add a line to a seeded task document's field block (after `Phase:`).
const withField = async (id: string, file: "todo.md" | "done.md", field: string) => {
  const path = join(dir, "docs", id, file)
  await Bun.write(path, (await Bun.file(path).text()).replace("Phase: R-01.P01\n", `Phase: R-01.P01\n${field}\n`))
}

describe("closed tasks (plans/0053 D16)", () => {
  test("an own closed task stays done and carries its reason", async () => {
    await seedUnits(dir, SAMPLE)
    await withField("T-001", "done.md", "Closed: superseded by T-002")
    const plan = await loadPlan(dir, phase)
    expect(plan.tasks[0]).toMatchObject({ id: "T-001", status: "done", closed: "superseded by T-002" })
    expect([...plan.closed]).toEqual([["T-001", "superseded by T-002"]])
    expect(plan.tasks.slice(1).some((task) => "closed" in task)).toBe(false)
  })

  test("closed external prerequisites named by Depends are read from their done.md", async () => {
    await seedUnits(dir, "## T-001: a [done]\nA.\n\n## T-002: b [pending]\nB.\n")
    await withField("T-001", "done.md", "Closed: obsolete")
    // Done tasks of another phase (not in this index): one closed, one not.
    await Bun.write(join(dir, taskStatePaths("T-050").complete), "# T-050: old\nClosed: dropped\n")
    await Bun.write(join(dir, taskStatePaths("T-051").complete), "# T-051: kept\n")
    await withField("T-002", "todo.md", "Depends: T-051, T-050, T-001")
    const plan = await loadPlan(dir, phase)
    // Own closures first, then external ones; a done external id without Closed: is absent.
    expect([...plan.closed]).toEqual([
      ["T-001", "obsolete"],
      ["T-050", "dropped"],
    ])
  })

  test("without closures the map is empty and no task has a closed key", async () => {
    const plan = await seedUnits(dir, SAMPLE)
    expect(plan.closed.size).toBe(0)
    expect(plan.tasks.some((task) => "closed" in task)).toBe(false)
  })

  test("a Closed: line in todo.md means nothing", async () => {
    await seedUnits(dir, SAMPLE)
    await withField("T-003", "todo.md", "Closed: not yet")
    const plan = await loadPlan(dir, phase)
    expect(plan.closed.size).toBe(0)
    expect(plan.tasks[2]).toMatchObject({ status: "pending" })
    expect("closed" in plan.tasks[2]!).toBe(false)
  })

  test("next treats a closed task as done", async () => {
    await seedUnits(dir, "## T-001: a [done]\nA.\n\n## T-002: b [pending]\nB.\n")
    await withField("T-001", "done.md", "Closed: dropped")
    expect(next(await loadPlan(dir, phase))!.id).toBe("T-002")
  })
})

describe("renderStatus closed marks (plans/0053 D16)", () => {
  const TASKS = "## T-001: a [done]\nA.\n\n## T-002: b [done]\nB.\n\n## T-003: c [pending]\nC.\n"

  test("without closures the lines are unchanged", async () => {
    await seedUnits(dir, TASKS)
    expect(await renderStatus(dir)).toEqual([
      "R-01 (0/1 phases done)",
      "  [▶] P01-implement",
      "      [✓] T-001 a",
      "      [✓] T-002 b",
      "      [ ] T-003 c",
    ])
  })

  test("a closed task shows ⊘; another done task keeps ✓", async () => {
    await seedUnits(dir, TASKS)
    await withField("T-001", "done.md", "Closed: superseded")
    expect(await renderStatus(dir)).toEqual([
      "R-01 (0/1 phases done)",
      "  [▶] P01-implement",
      "      [⊘] T-001 a",
      "      [✓] T-002 b",
      "      [ ] T-003 c",
    ])
  })

  test("a closed phase shows ⊘ and still counts as done", async () => {
    await seedUnits(dir, TASKS)
    const phaseDir = join(dir, phase.dir)
    const todo = await Bun.file(join(phaseDir, "todo.md")).text()
    await Bun.write(join(phaseDir, "done.md"), todo.replace("Type: implement\n", "Type: implement\nClosed: out of scope\n"))
    await rm(join(phaseDir, "todo.md"))
    expect(await renderStatus(dir)).toEqual([
      "R-01 (1/1 phases done)",
      "  [⊘] P01-implement",
      "      [✓] T-001 a",
      "      [✓] T-002 b",
      "      [ ] T-003 c",
    ])
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

  test("reports dependency problems among the planned tasks", async () => {
    await Bun.write(join(dir, phase.dir, "tasks.md"), renderTaskIndex("R-01.P01", [{ id: "T-001", title: "a" }, { id: "T-002", title: "b" }]))
    await writeTask("T-001", { depends: "T-002" })
    await writeTask("T-002", { depends: "", touches: "/etc/x" })
    const { problems } = await plannedTaskProblems(dir, phase, { before: new Set() })
    expect(problems).toContain("docs/R-01/P01-implement/tasks.md: T-002 has an empty Depends value (write `Depends: none` for no prerequisite)")
    expect(problems.some((p) => p.includes("touches an absolute path: /etc/x"))).toBe(true)
    await writeTask("T-002", { depends: "T-001" })
    expect((await plannedTaskProblems(dir, phase, { before: new Set() })).problems.some((p) => p.includes("dependency cycle: T-001 -> T-002 -> T-001"))).toBe(true)
  })

  test("the numbering start rejects lower ids", async () => {
    await Bun.write(join(dir, phase.dir, "tasks.md"), renderTaskIndex("R-01.P01", [{ id: "T-004", title: "a" }]))
    await writeTask("T-004")
    const { problems } = await plannedTaskProblems(dir, phase, { before: new Set(), numberStart: 7 })
    expect(problems[0]).toContain("below the numbering start T-007")
  })

  test("newTaskProblems(0053 D24, 自 plannedTaskProblems 拆出的单任务检查): 拒收已占编号/低于编号起点/文档不合格,合格则随附依赖声明", async () => {
    // 合格: 无问题,decl 随附(同一次读取,供整索引调用方拼依赖图)
    await writeTask("T-005", { depends: "none" })
    expect(await newTaskProblems(dir, phase, "T-005", { before: new Set() })).toEqual({
      problems: [],
      decl: { id: "T-005", depends: "none" },
    })
    // 编号已被会话前存在的任务占用 → 拒收,无 decl
    expect(await newTaskProblems(dir, phase, "T-005", { before: new Set(["T-005"]) })).toMatchObject({
      problems: ["T-005 is already used by an earlier task (docs/T-005/ existed before this planning session); pick an unused number"],
    })
    // 低于自动编号起点 → 拒收
    expect((await newTaskProblems(dir, phase, "T-005", { before: new Set(), numberStart: 8 })).problems).toEqual([
      "T-005 is below the numbering start T-008; earlier numbers are taken",
    ])
    // 文档不合格(缺 Scope 节) → spec 检查报错,无 decl
    await mkdir(join(dir, "docs/T-006"), { recursive: true })
    await Bun.write(join(dir, "docs/T-006/todo.md"), "# T-006: a\nPhase: R-01.P01\n\n## Goal\n\ng\n\n<!-- auto: eof -->\n")
    const bad = await newTaskProblems(dir, phase, "T-006", { before: new Set() })
    expect(bad.problems.some((p) => p.includes("docs/T-006/todo.md") && p.includes("## Scope"))).toBe(true)
    expect(bad.decl).toBeUndefined()
    // Phase 字段不符 → 报错但 decl 仍随附(与拆分前行为一致: 仅 spec 失败才跳过 decl)
    await writeTask("T-007", { phase: "R-09.P09" })
    const wrongPhase = await newTaskProblems(dir, phase, "T-007", { before: new Set() })
    expect(wrongPhase.problems).toEqual(["docs/T-007/todo.md must carry the field line `Phase: R-01.P01` right after its title line"])
    expect(wrongPhase.decl).toEqual({ id: "T-007" })
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
