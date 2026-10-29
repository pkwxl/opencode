import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { taskNumber, taskNumberFloor } from "../src/numbering"

function tempDir() {
  return mkdtemp(join(tmpdir(), "auto-numbering-"))
}

describe("taskNumber", () => {
  test("only T-<digits> counts; T-F final-review ids and other shapes do not", () => {
    expect(taskNumber("T-001")).toBe(1)
    expect(taskNumber("T-42")).toBe(42)
    expect(taskNumber("T-F1")).toBeUndefined()
    expect(taskNumber("T-F12")).toBeUndefined()
    expect(taskNumber("T-")).toBeUndefined()
    expect(taskNumber("T-1x")).toBeUndefined()
    expect(taskNumber("xT-1")).toBeUndefined()
    expect(taskNumber("T-1 ")).toBeUndefined()
    expect(taskNumber("")).toBeUndefined()
  })
})

describe("taskNumberFloor (the whole derivation, plans/0150 — no record, no recovery)", () => {
  test("an empty directory (no evidence at all) → 1", async () => {
    const dir = await tempDir()
    try {
      expect(await taskNumberFloor(dir)).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("every phase's task index tasks.md and the task directories together give the highest number + 1 (M3.4)", async () => {
    const dir = await tempDir()
    try {
      // task units: todo.md / done.md inside the directory docs/T-NNN/
      await Bun.write(join(dir, "docs/T-003/todo.md"), "# T-003: current task\n")
      expect(await taskNumberFloor(dir)).toBe(4)
      // a number listed in a task index whose task directory is gone (removed by hand) is occupied too
      await Bun.write(join(dir, "docs/R-01/P02-implement/tasks.md"), "- [x] T-010 done task\n")
      expect(await taskNumberFloor(dir)).toBe(11)
      // a previous round's task index is covered too; a bad line does not stop the scan
      await Bun.write(join(dir, "docs/R-02/P01-analysis/tasks.md"), "- [ ] bad line\n- [ ] T-015 next-round task\n")
      expect(await taskNumberFloor(dir)).toBe(16)
      // old flat artifact file names no longer occupy numbers (retired M3.7)
      await Bun.write(join(dir, "docs/T-020.handoff.md"), "x\n")
      expect(await taskNumberFloor(dir)).toBe(16)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("directory-layout artifacts: docs/**/T-*/*.md take the first T-<digits> path segment (archives covered too)", async () => {
    const dir = await tempDir()
    try {
      await Bun.write(join(dir, "docs/T-003/context.md"), "x\n")
      expect(await taskNumberFloor(dir)).toBe(4)
      await Bun.write(join(dir, "docs/phases/m-migrate/T-012/report.md"), "x\n")
      expect(await taskNumberFloor(dir)).toBe(13)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("old flat and directory layouts coexisting: both layouts together give the highest number", async () => {
    const dir = await tempDir()
    try {
      await Bun.write(join(dir, "docs/T-002.subtasks.md"), "x\n")
      await Bun.write(join(dir, "docs/T-007/context.md"), "x\n")
      expect(await taskNumberFloor(dir)).toBe(8)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("T-F final-review ids do not take part in deriving the floor (both layouts)", async () => {
    const dir = await tempDir()
    try {
      await Bun.write(join(dir, "docs/final/T-F1.audit.md"), "x\n")
      await Bun.write(join(dir, "docs/T-F2/audit-r1.md"), "x\n")
      expect(await taskNumberFloor(dir)).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("nothing is written: the derivation reads only (a fork-shaped tree continues its own lineage's numbers)", async () => {
    const dir = await tempDir()
    try {
      // Two sibling lineages' numbers live only in git (other branches of a
      // shared repository); the derivation over this directory's files never
      // sees them, and no record file appears.
      await Bun.write(join(dir, "docs/T-004/todo.md"), "# T-004: baseline tip\n")
      expect(await taskNumberFloor(dir)).toBe(5)
      expect(await Bun.file(join(dir, ".auto/next-task")).exists()).toBe(false)
      expect(await taskNumberFloor(dir)).toBe(5)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
