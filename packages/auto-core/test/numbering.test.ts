import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  advanceNextTask,
  ensureNumbering,
  NEXT_TASK_FILE,
  readNextTask,
  taskNumber,
  taskNumberFloor,
  writeNextTask,
} from "../src/numbering"

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

describe("readNextTask / writeNextTask", () => {
  test("missing file → undefined; a valid positive integer reads back (a trailing newline tolerated)", async () => {
    const dir = await tempDir()
    try {
      expect(await readNextTask(dir)).toBeUndefined()
      await writeNextTask(dir, 7)
      expect(await Bun.file(join(dir, NEXT_TASK_FILE)).text()).toBe("7\n")
      expect(await readNextTask(dir)).toBe(7)
      await Bun.write(join(dir, NEXT_TASK_FILE), "  12\n")
      expect(await readNextTask(dir)).toBe(12)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("invalid content (non-numeric / zero / negative / non-integer) → undefined, treated as missing", async () => {
    const dir = await tempDir()
    try {
      for (const text of ["abc", "0", "-2", "1.5", "", "3 4"]) {
        await Bun.write(join(dir, NEXT_TASK_FILE), text)
        expect(await readNextTask(dir)).toBeUndefined()
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("taskNumberFloor", () => {
  test("an empty directory (no historical evidence at all) → 1", async () => {
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
})

describe("advanceNextTask", () => {
  test("no record yet: writes this batch's highest number + 1", async () => {
    const dir = await tempDir()
    try {
      expect(await advanceNextTask(dir, ["T-002", "T-005"])).toBe(6)
      expect(await readNextTask(dir)).toBe(6)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("only ever increases: the record stands while this batch's numbers are below it", async () => {
    const dir = await tempDir()
    try {
      await writeNextTask(dir, 10)
      expect(await advanceNextTask(dir, ["T-003"])).toBe(10)
      expect(await readNextTask(dir)).toBe(10)
      // advances only past the existing record
      expect(await advanceNextTask(dir, ["T-010", "T-012"])).toBe(13)
      expect(await readNextTask(dir)).toBe(13)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("all non-numeric ids (T-F etc.) → the record starts at 1", async () => {
    const dir = await tempDir()
    try {
      expect(await advanceNextTask(dir, ["T-F1"])).toBe(1)
      expect(await readNextTask(dir)).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("ensureNumbering (the pure-function surface; the AI recovery-session path is covered by e2e)", () => {
  test("a record exists → used directly, no session", async () => {
    const dir = await tempDir()
    try {
      await writeNextTask(dir, 9)
      // the client is passed as null: never touched when a record exists
      const result = await ensureNumbering(undefined as never, dir, {} as never)
      expect(result).toEqual({ type: "ok", next: 9 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("no record and no historical evidence at all (floor = 1) → writes 1 directly, no session", async () => {
    const dir = await tempDir()
    try {
      const result = await ensureNumbering(undefined as never, dir, {} as never)
      expect(result).toEqual({ type: "ok", next: 1 })
      expect(await readNextTask(dir)).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
