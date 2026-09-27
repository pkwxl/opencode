// The no-session task add (plans/0058): what addTask writes — the task
// document, the index line (appended after existing lines, or a fresh index),
// the numbering choice, the stale-handover removal and the commits — over
// plain fixtures (no git: commitTree is a no-op there) and git fixtures where
// a commit is asserted. The prelude rows that route --new-task (targeting,
// guards, stop lines) are plan.test.ts's.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { addTask } from "../src/task-add"
import { readNextTask, writeNextTask } from "../src/numbering"
import { syncPhaseIndex, type PhaseUnit } from "../src/phases"
import { renderTaskIndex, renderTaskTodo, taskStatePaths } from "../src/tasks"

let dir: string
let phase: PhaseUnit

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "auto-task-add-"))
  ;[phase] = await syncPhaseIndex(dir, 1, "m")
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const TITLE = "Harden the retry policy against provider throttling"

const seed = async (ids: string[]) => {
  await Bun.write(
    join(dir, phase.dir, "tasks.md"),
    renderTaskIndex("R-01.P01", ids.map((id) => ({ id, title: `task ${id}` }))),
  )
  for (const id of ids) {
    await Bun.write(
      join(dir, taskStatePaths(id).pending),
      renderTaskTodo({ id, title: `task ${id}`, phase: "R-01.P01", goal: "g", scope: "s", acceptance: "a" }),
    )
  }
}

describe("addTask: what lands on disk", () => {
  test("creates the index and writes a conforming task document when the phase has none", async () => {
    const result = await addTask(dir, phase, TITLE)
    expect(result).toEqual({ type: "added", id: "T-001", index: "docs/R-01/P01-implement/tasks.md" })
    expect(await Bun.file(join(dir, phase.dir, "tasks.md")).text()).toBe(renderTaskIndex("R-01.P01", [{ id: "T-001", title: TITLE }]))
    const doc = await Bun.file(join(dir, "docs/T-001/todo.md")).text()
    expect(doc.startsWith(`# T-001: ${TITLE}\nPhase: R-01.P01\n`)).toBe(true)
    for (const section of ["## Goal", "## Scope", "## Acceptance"]) expect(doc).toContain(`\n${section}\n`)
    // The title doubles as the Goal; Scope / Acceptance state honestly that
    // the person restricted neither.
    expect(doc).toContain(`## Goal\n\n${TITLE}\n`)
    expect(doc).toContain("Added by `plan --new-task`")
    expect(doc.trimEnd().split("\n").at(-1)).toBe("<!-- auto: eof -->")
  })

  test("appends after the existing lines without touching them or their documents", async () => {
    await seed(["T-001", "T-002"])
    const before = await Bun.file(join(dir, phase.dir, "tasks.md")).text()
    const docBefore = await Bun.file(join(dir, "docs/T-001/todo.md")).text()
    const result = await addTask(dir, phase, TITLE)
    expect(result.type === "added" && result.id).toBe("T-003")
    expect(await Bun.file(join(dir, phase.dir, "tasks.md")).text()).toBe(`${before}- [ ] T-003 ${TITLE}\n`)
    expect(await Bun.file(join(dir, "docs/T-001/todo.md")).text()).toBe(docBefore)
  })
})

describe("addTask: the numbering choice", () => {
  test("without autoNumber: the highest listed or existing number + 1", async () => {
    await seed(["T-001", "T-002"])
    expect(resultId(await addTask(dir, phase, TITLE))).toBe("T-003")
    // A task directory nobody lists still takes its number.
    await Bun.write(join(dir, taskStatePaths("T-007").pending), "# T-007\n")
    expect(resultId(await addTask(dir, phase, TITLE))).toBe("T-008")
    expect(await readNextTask(dir)).toBeUndefined()
  })

  test("with autoNumber: the record leads never below the floor, and advances afterwards", async () => {
    await seed(["T-001", "T-002"])
    await writeNextTask(dir, 5)
    expect(resultId(await addTask(dir, phase, TITLE, { autoNumber: true }))).toBe("T-005")
    expect(await readNextTask(dir)).toBe(6)
    // A record below the disk evidence never collides: the floor wins.
    await writeNextTask(dir, 2)
    expect(resultId(await addTask(dir, phase, TITLE, { autoNumber: true }))).toBe("T-006")
    expect(await readNextTask(dir)).toBe(7)
  })

  test("with autoNumber and a missing record: used at the floor, created only for a brand-new project", async () => {
    await seed(["T-001", "T-002"])
    expect(resultId(await addTask(dir, phase, TITLE, { autoNumber: true }))).toBe("T-003")
    expect(await readNextTask(dir)).toBeUndefined()
    // A fresh project (floor 1): the record is advanced, as ensureNumbering
    // would have written it directly.
    const fresh = await mkdtemp(join(tmpdir(), "auto-task-add-"))
    try {
      const [p] = await syncPhaseIndex(fresh, 1, "m")
      expect(resultId(await addTask(fresh, p!, TITLE, { autoNumber: true }))).toBe("T-001")
      expect(await readNextTask(fresh)).toBe(2)
    } finally {
      await rm(fresh, { recursive: true, force: true })
    }
  })
})

const resultId = (result: Awaited<ReturnType<typeof addTask>>): string => {
  expect(result.type).toBe("added")
  return (result as { id: string }).id
}

// —— git fixtures: the commits ——

async function git(dir: string, ...args: string[]) {
  const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`git ${args.join(" ")} exited ${code}: ${err}`)
  return out
}

async function commitAll(dir: string) {
  await git(dir, "init", "-q")
  await git(dir, "config", "user.email", "t@example.com")
  await git(dir, "config", "user.name", "t")
  await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
  await git(dir, "add", "-A")
  await git(dir, "commit", "-qm", "setup")
}

describe("addTask: commits (git)", () => {
  test("one task-add commit; a stale handover is removed first, in its own commit", async () => {
    await commitAll(dir)
    await seed(["T-001"])
    await Bun.write(join(dir, phase.dir, "handover.md"), "# Handover\n\n## Summary\n\ndone\n")
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "phase distilled")
    const result = await addTask(dir, phase, TITLE)
    expect(result).toMatchObject({ type: "added", id: "T-002", handoverRemoved: "docs/R-01/P01-implement/handover.md" })
    expect(await Bun.file(join(dir, phase.dir, "handover.md")).exists()).toBe(false)
    // Removal before the add: a kill between the two commits leaves a state
    // a plain re-run completes (retry cannot add the task twice).
    const subjects = (await git(dir, "log", "--format=%s")).trim().split("\n")
    expect(subjects).toEqual([`PLAN add T-002 ${TITLE}`, "PLAN add T-002: remove the stale handover", "phase distilled", "setup"])
    for (const subject of subjects.slice(0, 2)) {
      expect(await git(dir, "log", "--format=%B", "--grep", subject, "-1")).toContain("Auto-Stage: task-add")
    }
    expect(await git(dir, "status", "--porcelain")).toBe("")
  })

  test("a dirty worktree is refused with the dirty files", async () => {
    await commitAll(dir)
    await Bun.write(join(dir, "unrelated.txt"), "dirty\n")
    const result = await addTask(dir, phase, TITLE)
    expect(result).toEqual({ type: "dirty", files: ["unrelated.txt"] })
    expect(await Bun.file(join(dir, phase.dir, "tasks.md")).exists()).toBe(false)
  })
})
