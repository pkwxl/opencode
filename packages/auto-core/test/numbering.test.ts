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

  test("当前 PLAN.md / 归档 PLAN / docs 产物文件名共同取最大编号 + 1", async () => {
    const dir = await tempDir()
    try {
      await Bun.write(join(dir, "PLAN.md"), "## T-003: 当前任务 [pending]\n正文\n")
      expect(await taskNumberFloor(dir)).toBe(4)
      // 阶段归档 PLAN(docs/phases/**/PLAN.md)
      await Bun.write(join(dir, "docs/phases/m-migrate/PLAN.md"), "## T-010: 归档任务 [done]\n")
      expect(await taskNumberFloor(dir)).toBe(11)
      // docs 产物文件名(归档目录内的同样覆盖)
      await Bun.write(join(dir, "docs/T-005.subtasks.md"), "x\n")
      expect(await taskNumberFloor(dir)).toBe(11)
      await Bun.write(join(dir, "docs/phases/m-migrate/T-020.handoff.md"), "x\n")
      expect(await taskNumberFloor(dir)).toBe(21)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("PLAN 解析失败(重复编号)退化为标题行正则提取,不中断扫描", async () => {
    const dir = await tempDir()
    try {
      await Bun.write(join(dir, "PLAN.md"), "## T-008: a [pending]\n## T-008: b [pending]\n")
      expect(await taskNumberFloor(dir)).toBe(9)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("T-F 终审编号不参与下限推导", async () => {
    const dir = await tempDir()
    try {
      await Bun.write(join(dir, "docs/final/T-F1.audit.md"), "x\n")
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
