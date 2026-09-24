// The append collect and its snapshot/reset cycle (plans/0053 D24): plain
// fixtures over one phase's task index and task documents — what the collect
// accepts and refuses, and what the reset restores. The session-driving side
// (appendPlan over the fake agent, the stale-handover removal) is the loop
// harness' territory (plans/0053 §8, B6).
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { appendProblems, resetAppend, snapshotAppend, type AppendSnapshot } from "../src/loop-plan"
import { syncPhaseIndex, type PhaseUnit } from "../src/phases"
import { renderTaskIndex, renderTaskTodo, takenTaskIds } from "../src/tasks"

let dir: string
let phase: PhaseUnit

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "auto-append-"))
  ;[phase] = await syncPhaseIndex(dir, 1, "m")
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

// Long enough to pass the non-trivial shape threshold (same shape as
// tasks.test.ts's planning-output fixtures).
const GOAL = "Deliver the migrated module with the same behavior as the source, documented where it differs."
const BODY = { goal: GOAL, scope: "src/a.ts and src/b.ts only", acceptance: "bun test passes" }

const writeDoc = async (id: string, extra: Partial<Parameters<typeof renderTaskTodo>[0]> = {}, done = false) => {
  await mkdir(join(dir, "docs", id), { recursive: true })
  await Bun.write(join(dir, "docs", id, done ? "done.md" : "todo.md"), renderTaskTodo({ id, title: `task ${id}`, phase: "R-01.P01", ...BODY, ...extra }))
}

// The phase's index as an appending step sees it: two existing tasks, the
// first done.
async function seedExisting() {
  await Bun.write(
    join(dir, phase.dir, "tasks.md"),
    renderTaskIndex("R-01.P01", [
      { id: "T-001", title: "task T-001", done: true },
      { id: "T-002", title: "task T-002" },
    ]),
  )
  await writeDoc("T-001", {}, true)
  await writeDoc("T-002")
}

// Rewrite the index over its current entries.
const writeIndex = async (tasks: Array<{ id: string; title?: string; done?: boolean }>) =>
  Bun.write(join(dir, phase.dir, "tasks.md"), renderTaskIndex("R-01.P01", tasks.map((t) => ({ id: t.id, title: t.title ?? `task ${t.id}`, done: t.done }))))

const beforeOf = async (snap: AppendSnapshot) => new Set([...(await takenTaskIds(dir, phase)), ...snap.entries.map((entry) => entry.id)])

describe("the append snapshot", () => {
  test("captures the index text, its entries and each existing task's state file", async () => {
    await seedExisting()
    const snap = await snapshotAppend(dir, phase)
    expect(snap.index).toBe("docs/R-01/P01-implement/tasks.md")
    expect(snap.text).toBe(await Bun.file(join(dir, phase.dir, "tasks.md")).text())
    expect(snap.entries.map((entry) => [entry.id, entry.ticked])).toEqual([["T-001", true], ["T-002", false]])
    expect(snap.files.get("T-001")).toEqual({ complete: await Bun.file(join(dir, "docs/T-001/done.md")).text() })
    expect(snap.files.get("T-002")).toEqual({ pending: await Bun.file(join(dir, "docs/T-002/todo.md")).text() })
  })
})

describe("appendProblems (D24)", () => {
  test("accepts a clean append and returns the appended ids", async () => {
    await seedExisting()
    const snap = await snapshotAppend(dir, phase)
    await writeIndex([{ id: "T-001", done: true }, { id: "T-002" }, { id: "T-003" }, { id: "T-004" }])
    await writeDoc("T-003")
    await writeDoc("T-004", { depends: "T-001" })
    expect(await appendProblems(dir, phase, snap, { before: await beforeOf(snap) })).toEqual({ problems: [], ids: ["T-003", "T-004"] })
  })

  test("no new entry after the snapshot prefix is refused", async () => {
    await seedExisting()
    const snap = await snapshotAppend(dir, phase)
    expect((await appendProblems(dir, phase, snap, { before: await beforeOf(snap) })).problems).toEqual([
      `${phase.dir}/tasks.md gained no new task; the append must add at least one (a line \`- [ ] T-NNN <task title>\` after the existing ones)`,
    ])
  })

  test("a missing index is refused", async () => {
    await seedExisting()
    const snap = await snapshotAppend(dir, phase)
    await rm(join(dir, phase.dir, "tasks.md"))
    expect((await appendProblems(dir, phase, snap, { before: await beforeOf(snap) })).problems).toEqual([
      `${phase.dir}/tasks.md is missing`,
    ])
  })

  test("an edited existing line (title or tick) and a replaced or removed one are refused", async () => {
    await seedExisting()
    const snap = await snapshotAppend(dir, phase)
    await writeDoc("T-003")
    // Title edited.
    await writeIndex([{ id: "T-001", done: true, title: "renamed" }, { id: "T-002" }, { id: "T-003" }])
    expect((await appendProblems(dir, phase, snap, { before: await beforeOf(snap) })).problems).toContain(
      `${phase.dir}/tasks.md line 3: the existing line of T-001 was edited; existing lines are fixed — append only`,
    )
    // Tick changed.
    await writeIndex([{ id: "T-001", done: true }, { id: "T-002", done: true }, { id: "T-003" }])
    expect((await appendProblems(dir, phase, snap, { before: await beforeOf(snap) })).problems).toContain(
      `${phase.dir}/tasks.md line 4: the existing line of T-002 was edited; existing lines are fixed — append only`,
    )
    // Reordered.
    await writeIndex([{ id: "T-002" }, { id: "T-001", done: true }, { id: "T-003" }])
    expect((await appendProblems(dir, phase, snap, { before: await beforeOf(snap) })).problems).toContain(
      `${phase.dir}/tasks.md line 3: T-002 sits where T-001 sat; existing lines are fixed — append after the last existing line, never reorder or replace`,
    )
    // Shortened: an existing line removed.
    await writeIndex([{ id: "T-001", done: true }])
    expect((await appendProblems(dir, phase, snap, { before: await beforeOf(snap) })).problems).toContain(
      `${phase.dir}/tasks.md lists 1 task(s) but held 2 before the append; existing lines are fixed — append after them, never remove one`,
    )
  })

  test("a changed existing task document and a created state file are refused", async () => {
    await seedExisting()
    const snap = await snapshotAppend(dir, phase)
    await writeDoc("T-003")
    await writeIndex([{ id: "T-001", done: true }, { id: "T-002" }, { id: "T-003" }])
    // The pending task's document edited.
    await Bun.write(join(dir, "docs/T-002/todo.md"), (await Bun.file(join(dir, "docs/T-002/todo.md")).text()).replace("## Goal", "## 目标"))
    // A done.md created next to it.
    await Bun.write(join(dir, "docs/T-002/done.md"), "# T-002: task T-002\n")
    const { problems } = await appendProblems(dir, phase, snap, { before: await beforeOf(snap) })
    expect(problems).toContain("docs/T-002/todo.md of the existing task T-002 was changed or removed; an append never edits an existing task's document")
    expect(problems).toContain("docs/T-002/done.md of the existing task T-002 is new; an append never touches an existing task's state files")
  })

  test("each appended id passes the per-task checks: taken or snapshot ids and ids below the numbering start", async () => {
    await seedExisting()
    const snap = await snapshotAppend(dir, phase)
    // T-001 is the snapshot's; T-009 is listed by another phase's index.
    await Bun.write(join(dir, "docs/R-01/P02-implement/tasks.md"), renderTaskIndex("R-01.P02", [{ id: "T-009", title: "other phase" }]))
    await writeDoc("T-009")
    await writeIndex([{ id: "T-001", done: true }, { id: "T-002" }, { id: "T-009" }])
    expect((await appendProblems(dir, phase, snap, { before: await beforeOf(snap) })).problems).toContain(
      "T-009 is already used by an earlier task (docs/T-009/ existed before this planning session); pick an unused number",
    )
    // Below the numbering start (autoNumber: the record's value).
    await writeDoc("T-003")
    await writeIndex([{ id: "T-001", done: true }, { id: "T-002" }, { id: "T-003" }])
    expect((await appendProblems(dir, phase, snap, { before: await beforeOf(snap), numberStart: 5 })).problems).toContain(
      "T-003 is below the numbering start T-005; earlier numbers are taken",
    )
  })

  test("the dependency graph of the whole index is checked, over the existing prefix too", async () => {
    await seedExisting()
    const snap = await snapshotAppend(dir, phase)
    await writeDoc("T-003", { depends: "T-999" })
    await writeIndex([{ id: "T-001", done: true }, { id: "T-002" }, { id: "T-003" }])
    expect((await appendProblems(dir, phase, snap, { before: await beforeOf(snap) })).problems).toContain(
      `${phase.dir}/tasks.md: T-003 depends on unknown T-999`,
    )
    // A new task following the last existing one implicitly (no Depends:) and
    // one naming the done first task explicitly both pass, as does the whole
    // prefix graph.
    await writeDoc("T-003", { depends: undefined })
    await writeDoc("T-004", { depends: "T-001" })
    await writeIndex([{ id: "T-001", done: true }, { id: "T-002" }, { id: "T-003" }, { id: "T-004" }])
    expect((await appendProblems(dir, phase, snap, { before: await beforeOf(snap) })).problems).toEqual([])
  })
})

describe("resetAppend (D24)", () => {
  test("restores the snapshot: index text, changed existing files, stray state files and new task directories", async () => {
    await seedExisting()
    const snap = await snapshotAppend(dir, phase)
    const indexFile = join(dir, phase.dir, "tasks.md")
    const pending = await Bun.file(join(dir, "docs/T-002/todo.md")).text()
    // A failed attempt's leftovers: a rewritten index, an edited existing
    // document, a created done.md and two new task directories.
    await writeIndex([{ id: "T-001", done: true, title: "renamed" }, { id: "T-002", done: true }, { id: "T-003" }, { id: "T-004" }])
    await Bun.write(join(dir, "docs/T-002/todo.md"), pending.replace("## Goal", "## 目标"))
    await Bun.write(join(dir, "docs/T-002/done.md"), "# T-002: task T-002\n")
    await writeDoc("T-003")
    await writeDoc("T-004")
    await resetAppend(dir, phase, snap)
    expect(await Bun.file(indexFile).text()).toBe(snap.text)
    expect(await Bun.file(join(dir, "docs/T-002/todo.md")).text()).toBe(pending)
    expect(existsSync(join(dir, "docs/T-002/done.md"))).toBe(false)
    expect(existsSync(join(dir, "docs/T-003"))).toBe(false)
    expect(existsSync(join(dir, "docs/T-004"))).toBe(false)
    expect(existsSync(join(dir, "docs/T-001/done.md"))).toBe(true)
  })

  test("never removes a task directory taken elsewhere, and rewrites a deleted index", async () => {
    await seedExisting()
    const snap = await snapshotAppend(dir, phase)
    // T-009 belongs to another phase's index; the failed attempt listed it here.
    await Bun.write(join(dir, "docs/R-01/P02-implement/tasks.md"), renderTaskIndex("R-01.P02", [{ id: "T-009", title: "other phase" }]))
    await writeDoc("T-009")
    await writeIndex([{ id: "T-001", done: true }, { id: "T-002" }, { id: "T-009" }])
    await resetAppend(dir, phase, snap)
    expect(await Bun.file(join(dir, phase.dir, "tasks.md")).text()).toBe(snap.text)
    expect(existsSync(join(dir, "docs/T-009/todo.md"))).toBe(true)
    // A deleted index comes back verbatim.
    await rm(join(dir, phase.dir, "tasks.md"))
    await resetAppend(dir, phase, snap)
    expect(await Bun.file(join(dir, phase.dir, "tasks.md")).text()).toBe(snap.text)
  })
})
