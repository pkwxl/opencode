import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  archivedTestHandoff,
  latestHandoffSeq,
  legacyPriorKnowledgeDoc,
  legacySubtaskArtifact,
  legacySubtaskTestHandoff,
  legacyTaskDoc,
  priorKnowledgeDoc,
  resolveSubtaskDoc,
  resolveTaskDoc,
  roundDir,
  roundDirName,
  subtaskDir,
  subtaskDoc,
  tempPriorKnowledgeDoc,
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
})

describe("轮次专用目录与轮内知识文档(新布局,R-NN 两位零填充自然进位)", () => {
  test("roundDirName/roundDir: docs/R-01,自然进位 R-99 → R-100", () => {
    expect(roundDirName(1)).toBe("R-01")
    expect(roundDirName(12)).toBe("R-12")
    expect(roundDirName(100)).toBe("R-100")
    expect(roundDir(3)).toBe(join("docs", "R-03"))
  })

  test("priorKnowledgeDoc: 轮内固定名(原时间戳名取消;k 阶段知识文档改为阶段目录内 kb.md,见 phases.test)", () => {
    expect(priorKnowledgeDoc(5)).toBe(join("docs", "R-05", "prior-kb.md"))
  })

  test("tempPriorKnowledgeDoc: 中间产物与正式产物同目录(新布局轮内/旧平铺)", () => {
    expect(tempPriorKnowledgeDoc(priorKnowledgeDoc(5))).toBe(join("docs", "R-05", "temp-kb.md"))
    expect(tempPriorKnowledgeDoc(legacyPriorKnowledgeDoc(1, "2026-09-07_01-02-03"))).toBe(join("docs", "prior-kb", "temp-kb.md"))
  })

  test("legacyPriorKnowledgeDoc: 旧平铺形态(读回落常量化)", () => {
    expect(legacyPriorKnowledgeDoc(1, "2026-09-07_01-02-03")).toBe(join("docs", "prior-kb", "R1-prior-2026-09-07_01-02-03.md"))
  })
})

describe("旧平铺布局构造器", () => {  test("legacyTaskDoc/legacySubtaskTestHandoff/legacySubtaskArtifact", () => {
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


describe("测试交接文档的归档份", () => {
  test("归档名: 去 .md 缀 -<n>.md,目录化与旧平铺两种形态同规则", () => {
    expect(archivedTestHandoff(subtaskDoc("T-003", 2, "testhandoff"), 1)).toBe(join("docs", "T-003", "S02", "testhandoff-1.md"))
    expect(archivedTestHandoff(taskDoc("T-003", "testhandoff"), 12)).toBe(join("docs", "T-003", "testhandoff-12.md"))
    expect(archivedTestHandoff(legacySubtaskTestHandoff("T-003", 2), 3)).toBe(join("docs", "T-003-S2.testhandoff-3.md"))
  })

  test("编号接续: 扫同目录取最大;空目录为 0;当前份与同目录他文件不误计", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-handoff-"))
    try {
      const handoff = subtaskDoc("T-003", 2, "testhandoff")
      expect(await latestHandoffSeq(dir, handoff)).toBe(0)
      await Bun.write(join(dir, handoff), "当前份\n")
      await Bun.write(join(dir, subtaskDoc("T-003", 2, "index")), "产物\n")
      expect(await latestHandoffSeq(dir, handoff)).toBe(0)
      await Bun.write(join(dir, archivedTestHandoff(handoff, 1)), "第一次\n")
      await Bun.write(join(dir, archivedTestHandoff(handoff, 2)), "第二次\n")
      expect(await latestHandoffSeq(dir, handoff)).toBe(2)
      // 自然进位到两位数,按数值而非字典序取最大。
      await Bun.write(join(dir, archivedTestHandoff(handoff, 10)), "第十次\n")
      expect(await latestHandoffSeq(dir, handoff)).toBe(10)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("编号接续只认本执行范围: 任务级归档不算进子任务级", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-handoff-"))
    try {
      await Bun.write(join(dir, archivedTestHandoff(taskDoc("T-003", "testhandoff"), 4)), "任务级\n")
      expect(await latestHandoffSeq(dir, taskDoc("T-003", "testhandoff"))).toBe(4)
      expect(await latestHandoffSeq(dir, subtaskDoc("T-003", 2, "testhandoff"))).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
