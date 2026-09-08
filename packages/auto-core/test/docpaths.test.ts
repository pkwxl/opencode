import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  finalDir,
  finalDoc,
  legacySubtaskArtifact,
  legacySubtaskTestHandoff,
  legacyTaskDoc,
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

