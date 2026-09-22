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
  test("仅认 T-<纯数字>;T-F 终审编号与其他形态不参与", () => {
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
  test("文件缺失 → undefined;合法正整数读回(可带换行)", async () => {
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

  test("非法内容(非数字/零/负数/非整数)→ undefined 视同缺失", async () => {
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
  test("空目录(无任何历史证据)→ 1", async () => {
    const dir = await tempDir()
    try {
      expect(await taskNumberFloor(dir)).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("各阶段任务索引 tasks.md 与任务目录共同取最大编号 + 1(M3.4)", async () => {
    const dir = await tempDir()
    try {
      // 任务单元: 目录 docs/T-NNN/ 内的 todo.md / done.md
      await Bun.write(join(dir, "docs/T-003/todo.md"), "# T-003: 当前任务\n")
      expect(await taskNumberFloor(dir)).toBe(4)
      // 任务索引列出而任务目录已不在(被人工移除)的编号同样占用
      await Bun.write(join(dir, "docs/R-01/P02-implement/tasks.md"), "- [x] T-010 已完成任务\n")
      expect(await taskNumberFloor(dir)).toBe(11)
      // 上一轮的任务索引同样覆盖;坏行不中断扫描
      await Bun.write(join(dir, "docs/R-02/P01-analysis/tasks.md"), "- [ ] bad line\n- [ ] T-015 下一轮任务\n")
      expect(await taskNumberFloor(dir)).toBe(16)
      // docs 产物文件名(旧平铺,M3.7 前兼容)
      await Bun.write(join(dir, "docs/phases/m-migrate/T-020.handoff.md"), "x\n")
      expect(await taskNumberFloor(dir)).toBe(21)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("目录化布局产物: docs/**/T-*/*.md 取首个 T-<纯数字> 路径段(归档内同样覆盖)", async () => {
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

  test("旧平铺与目录化并存: 双布局共同取最大编号", async () => {
    const dir = await tempDir()
    try {
      await Bun.write(join(dir, "docs/T-002.subtasks.md"), "x\n")
      await Bun.write(join(dir, "docs/T-007/context.md"), "x\n")
      expect(await taskNumberFloor(dir)).toBe(8)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("T-F 终审编号不参与下限推导(双布局)", async () => {
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
  test("无记录时写入本次最大编号 + 1", async () => {
    const dir = await tempDir()
    try {
      expect(await advanceNextTask(dir, ["T-002", "T-005"])).toBe(6)
      expect(await readNextTask(dir)).toBe(6)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("只增不减: 本次编号小于既有记录时记录不动", async () => {
    const dir = await tempDir()
    try {
      await writeNextTask(dir, 10)
      expect(await advanceNextTask(dir, ["T-003"])).toBe(10)
      expect(await readNextTask(dir)).toBe(10)
      // 超过既有记录才推进
      expect(await advanceNextTask(dir, ["T-010", "T-012"])).toBe(13)
      expect(await readNextTask(dir)).toBe(13)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("全部为非数字编号(T-F 等)时按 1 起记", async () => {
    const dir = await tempDir()
    try {
      expect(await advanceNextTask(dir, ["T-F1"])).toBe(1)
      expect(await readNextTask(dir)).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("ensureNumbering(纯函数面;AI 恢复会话路径由 e2e 覆盖)", () => {
  test("记录存在 → 直接使用,不开会话", async () => {
    const dir = await tempDir()
    try {
      await writeNextTask(dir, 9)
      // client 传空值: 记录存在时不会触碰
      const result = await ensureNumbering(undefined as never, dir, {} as never)
      expect(result).toEqual({ type: "ok", next: 9 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("记录缺失且无任何历史证据(floor = 1)→ 直接写 1,不开会话", async () => {
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
