import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  finalDir,
  finalDoc,
  legacySubtaskArtifact,
  legacySubtaskTestHandoff,
  legacyTaskDoc,
  migrateLegacyDocs,
  resolveSubtaskDoc,
  resolveTaskDoc,
  subtaskDir,
  subtaskDoc,
  taskDir,
  taskDoc,
} from "../src/docpaths"

function tempDir() {
  return mkdtemp(join(tmpdir(), "auto-docpaths-"))
}

async function write(dir: string, rel: string, text = "x\n") {
  await mkdir(dirname(join(dir, rel)), { recursive: true })
  await Bun.write(join(dir, rel), text)
}

describe("新布局构造器", () => {
  test("taskDir/taskDoc: docs/T-003 与角色文件名", () => {
    expect(taskDir("T-003")).toBe(join("docs", "T-003"))
    expect(taskDoc("T-003", "context")).toBe(join("docs", "T-003", "context.md"))
    expect(taskDoc("T-012", "testhandoff")).toBe(join("docs", "T-012", "testhandoff.md"))
  })

  test("subtaskDir/subtaskDoc: 两位零填充,三位自然进位", () => {
    expect(subtaskDir("T-003", 2)).toBe(join("docs", "T-003", "S02"))
    expect(subtaskDir("T-003", 12)).toBe(join("docs", "T-003", "S12"))
    expect(subtaskDir("T-003", 123)).toBe(join("docs", "T-003", "S123"))
    expect(subtaskDoc("T-003", 4, "index")).toBe(join("docs", "T-003", "S04", "index.md"))
    expect(subtaskDoc("T-003", 2, "testhandoff")).toBe(join("docs", "T-003", "S02", "testhandoff.md"))
  })

  test("finalDir/finalDoc: 终审锚定目录", () => {
    expect(finalDir(1)).toBe(join("docs", "T-F1"))
    expect(finalDoc(1, "audit-r1.md")).toBe(join("docs", "T-F1", "audit-r1.md"))
    expect(finalDoc(3, "plan-audit-r2.md")).toBe(join("docs", "T-F3", "plan-audit-r2.md"))
  })
})

describe("旧平铺布局构造器", () => {
  test("legacyTaskDoc/legacySubtaskTestHandoff/legacySubtaskArtifact", () => {
    expect(legacyTaskDoc("T-003", "context")).toBe(join("docs", "T-003.context.md"))
    expect(legacyTaskDoc("T-003", "handoff")).toBe(join("docs", "T-003.handoff.md"))
    expect(legacySubtaskTestHandoff("T-003", 2)).toBe(join("docs", "T-003-S2.testhandoff.md"))
    expect(legacySubtaskArtifact("T-003", 4)).toBe(join("docs", "T-003", "S04.md"))
  })
})

describe("resolveTaskDoc 读回落(D4 三态)", () => {
  test("新路径存在 → 新", async () => {
    const dir = await tempDir()
    try {
      await Bun.write(join(dir, "docs", "T-003", "context.md"), "新\n")
      expect(await resolveTaskDoc(dir, "T-003", "context")).toBe(join("docs", "T-003", "context.md"))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("新缺失而旧存在 → 旧", async () => {
    const dir = await tempDir()
    try {
      await Bun.write(join(dir, "docs", "T-003.context.md"), "旧\n")
      expect(await resolveTaskDoc(dir, "T-003", "context")).toBe(join("docs", "T-003.context.md"))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("都不在 → 新(读空)", async () => {
    const dir = await tempDir()
    try {
      expect(await resolveTaskDoc(dir, "T-003", "context")).toBe(join("docs", "T-003", "context.md"))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("新旧都在 → 优先新", async () => {
    const dir = await tempDir()
    try {
      await Bun.write(join(dir, "docs", "T-003.context.md"), "旧\n")
      await Bun.write(join(dir, "docs", "T-003", "handoff.md"), "新\n")
      expect(await resolveTaskDoc(dir, "T-003", "handoff")).toBe(join("docs", "T-003", "handoff.md"))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("resolveSubtaskDoc 读回落", () => {
  test("index: 任务目录内旧产物名回落", async () => {
    const dir = await tempDir()
    try {
      await Bun.write(join(dir, "docs", "T-003", "S04.md"), "旧\n")
      expect(await resolveSubtaskDoc(dir, "T-003", 4, "index")).toBe(join("docs", "T-003", "S04.md"))
      await Bun.write(join(dir, "docs", "T-003", "S04", "index.md"), "新\n")
      expect(await resolveSubtaskDoc(dir, "T-003", 4, "index")).toBe(join("docs", "T-003", "S04", "index.md"))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("testhandoff: 顶层旧平铺名回落", async () => {
    const dir = await tempDir()
    try {
      await Bun.write(join(dir, "docs", "T-003-S2.testhandoff.md"), "旧\n")
      expect(await resolveSubtaskDoc(dir, "T-003", 2, "testhandoff")).toBe(join("docs", "T-003-S2.testhandoff.md"))
      expect(await resolveSubtaskDoc(dir, "T-003", 5, "testhandoff")).toBe(join("docs", "T-003", "S05", "testhandoff.md"))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("migrateLegacyDocs 存量迁移", () => {
  test("docs/ 缺失 → 空结果;无旧文件 → 空结果", async () => {
    const dir = await tempDir()
    try {
      expect(await migrateLegacyDocs(dir)).toEqual({ moved: [], rewritten: [] })
      await mkdir(join(dir, "docs"), { recursive: true })
      expect(await migrateLegacyDocs(dir)).toEqual({ moved: [], rewritten: [] })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("平铺任务文档 → 目录化;-S2 → S02/testhandoff;S04.md → S04/index.md", async () => {
    const dir = await tempDir()
    try {
      await write(dir, "docs/T-003.context.md")
      await write(dir, "docs/T-003.subtasks.md")
      await write(dir, "docs/T-010.handoff.md")
      await write(dir, "docs/T-003-S2.testhandoff.md")
      await write(dir, "docs/T-003/S04.md")
      const { moved, rewritten } = await migrateLegacyDocs(dir)
      expect([...moved].sort()).toEqual(
        [
          join("docs", "T-003", "context.md"),
          join("docs", "T-003", "subtasks.md"),
          join("docs", "T-010", "handoff.md"),
          join("docs", "T-003", "S02", "testhandoff.md"),
          join("docs", "T-003", "S04", "index.md"),
        ].sort(),
      )
      expect(rewritten).toEqual([])
      expect(await Bun.file(join(dir, "docs", "T-003", "context.md")).exists()).toBe(true)
      expect(await Bun.file(join(dir, "docs", "T-003.context.md")).exists()).toBe(false)
      expect(await Bun.file(join(dir, "docs", "T-003-S2.testhandoff.md")).exists()).toBe(false)
      expect(await Bun.file(join(dir, "docs", "T-003", "S04.md")).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("终审旧路径 → docs/T-F1/(final-audit.md 文件名不变;final/ 搬空后删空目录)", async () => {
    const dir = await tempDir()
    try {
      await write(dir, "docs/final-audit.md")
      await write(dir, "docs/final/plan-audit-r1.md")
      await write(dir, "docs/final/audit-r1.md")
      const { moved } = await migrateLegacyDocs(dir)
      expect([...moved].sort()).toEqual(
        [
          join("docs", "T-F1", "final-audit.md"),
          join("docs", "T-F1", "plan-audit-r1.md"),
          join("docs", "T-F1", "audit-r1.md"),
        ].sort(),
      )
      expect(await Bun.file(join(dir, "docs", "T-F1", "final-audit.md")).exists()).toBe(true)
      expect(await Bun.file(join(dir, "docs", "final")).exists().catch(() => false)).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("活文档引用改写: 反引号/链接/词边界;围栏与标记行豁免;docs/phases/ 排除", async () => {
    const dir = await tempDir()
    try {
      await write(
        dir,
        "docs/T-005/report.md",
        [
          "详见 `docs/T-003.context.md` 与 [分解](docs/T-003.subtasks.md)。",
          "`docs/T-003.context.md` 已归档,不改写。",
          "```",
          "docs/T-003.context.md",
          "```",
          "子任务产物 `docs/T-003/S04.md`,交接 `docs/T-003-S2.testhandoff.md`。",
          "终审见 `docs/final-audit.md` 与 `docs/final/audit-r1.md`。",
          "编号 `docs/T-11.context.md` 不误配 `docs/T-1.context.md` 之外的词。",
        ].join("\n") + "\n",
      )
      await write(dir, "docs/phases/m-migrate/handover.md", "归档内引用 `docs/T-003.context.md` 不改写。\n")
      const { moved, rewritten } = await migrateLegacyDocs(dir)
      expect(moved).toEqual([])
      expect(rewritten).toEqual([join("docs", "T-005", "report.md")])
      const text = await Bun.file(join(dir, "docs", "T-005", "report.md")).text()
      expect(text).toContain("`docs/T-003/context.md` 与 [分解](docs/T-003/subtasks.md)")
      expect(text).toContain("`docs/T-003.context.md` 已归档")
      expect(text.split("```")[1]).toContain("docs/T-003.context.md")
      expect(text).toContain("`docs/T-003/S04/index.md`")
      expect(text).toContain("`docs/T-003/S02/testhandoff.md`")
      expect(text).toContain("`docs/T-F1/final-audit.md`")
      expect(text).toContain("`docs/T-F1/audit-r1.md`")
      expect(text).toContain("`docs/T-11/context.md` 不误配 `docs/T-1/context.md`")
      expect(await Bun.file(join(dir, "docs/phases/m-migrate/handover.md")).text()).toContain("docs/T-003.context.md")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("幂等: 二跑 no-op(搬移与改写均不再发生)", async () => {
    const dir = await tempDir()
    try {
      await write(dir, "docs/T-003.context.md")
      await write(dir, "docs/T-005/report.md", "引用 `docs/T-003.context.md`。\n")
      const first = await migrateLegacyDocs(dir)
      expect(first.moved).toEqual([join("docs", "T-003", "context.md")])
      expect(first.rewritten).toEqual([join("docs", "T-005", "report.md")])
      const second = await migrateLegacyDocs(dir)
      expect(second).toEqual({ moved: [], rewritten: [] })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("冲突: 目标新路径已存在 → 保留新文件跳过搬移(P1-D3)", async () => {
    const dir = await tempDir()
    try {
      await write(dir, "docs/T-003.context.md", "旧内容\n")
      await write(dir, "docs/T-003/context.md", "新内容\n")
      const { moved } = await migrateLegacyDocs(dir)
      expect(moved).toEqual([])
      expect(await Bun.file(join(dir, "docs/T-003/context.md")).text()).toBe("新内容\n")
      expect(await Bun.file(join(dir, "docs/T-003.context.md")).exists()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("崩溃恢复语义: 搬移后、改写前中断 → 仅残留旧引用记号也改写(P1-D4)", async () => {
    const dir = await tempDir()
    try {
      // 模拟搬移已完成(文件已在新路径)但活文档引用尚未改写的中间态。
      await write(dir, "docs/T-003/context.md")
      await write(dir, "docs/T-005/report.md", "引用 `docs/T-003.context.md`。\n")
      const { moved, rewritten } = await migrateLegacyDocs(dir)
      expect(moved).toEqual([])
      expect(rewritten).toEqual([join("docs", "T-005", "report.md")])
      expect(await Bun.file(join(dir, "docs/T-005/report.md")).text()).toContain("docs/T-003/context.md")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
