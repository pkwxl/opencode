import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readdir, rm, stat, utimes } from "node:fs/promises"
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
      expect(await migrateLegacyDocs(dir)).toEqual({ moved: [], rewritten: [], skipped: [] })
      await mkdir(join(dir, "docs"), { recursive: true })
      expect(await migrateLegacyDocs(dir)).toEqual({ moved: [], rewritten: [], skipped: [] })
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

  test("轮次归档提升: 任务文档/伴生 S 产物/交接变体/知识库/阶段产物/项目文档各归其位", async () => {
    const dir = await tempDir()
    try {
      await write(dir, "docs/phases/round-3/m-migrate/T-021.context.md")
      await write(dir, "docs/phases/round-3/m-migrate/T-021/S01.md")
      await write(dir, "docs/phases/round-3/m-migrate/T-021/S02.gate.md")
      // 交接双源: 旧 T-NNN.handover.md 命名变体(更旧)与 handover.md(最新)
      await write(dir, "docs/phases/round-3/m-migrate/T-026.handover.md", "旧交接\n")
      await write(dir, "docs/phases/round-3/m-migrate/handover.md", "最新交接\n")
      const older = new Date(Date.now() - 60_000)
      await utimes(join(dir, "docs/phases/round-3/m-migrate/T-026.handover.md"), older, older)
      await write(dir, "docs/phases/round-3/k-knowledge/migration-kb/migration-2026-09-07_03-51-43.md")
      await write(dir, "docs/phases/round-3/a-analysis/analysis/r3-baseline.md")
      await write(dir, "docs/phases/round-3/a-analysis/PLAN.md", "过期状态\n")
      await write(dir, "docs/phases/round-3/phases.md", "台账\n")
      await write(dir, "docs/phases/round-2/m-migrate/005-dm-crate-skeleton.md")
      await write(dir, "docs/phases/round-1/m-migrate/final/audit-r1.md")
      // 预建空任务目录 → 空目录不算冲突,落位
      await mkdir(join(dir, "docs/T-021"), { recursive: true })

      const { moved } = await migrateLegacyDocs(dir)
      expect([...moved].sort()).toEqual(
        [
          join("docs", "T-021", "context.md"),
          join("docs", "T-021", "S01", "index.md"),
          join("docs", "T-021", "S02", "gate.md"),
          join("docs", "handovers", "R3-m-migrate.md"),
          join("docs", "migration-kb", "R3-migration-2026-09-07_03-51-43.md"),
          join("docs", "phase-docs", "R3-a-analysis", "r3-baseline.md"),
          join("docs", "005-dm-crate-skeleton.md"),
          join("docs", "T-F1", "audit-r1.md"),
        ].sort(),
      )
      expect(await Bun.file(join(dir, "docs/T-021/context.md")).exists()).toBe(true)
      expect(await Bun.file(join(dir, "docs/T-021/S01/index.md")).exists()).toBe(true)
      expect(await Bun.file(join(dir, "docs/T-021/S02/gate.md")).exists()).toBe(true)
      // 最新交接占领 docs/handovers/,旧命名变体原地保留
      expect(await Bun.file(join(dir, "docs/handovers/R3-m-migrate.md")).text()).toBe("最新交接\n")
      expect(await Bun.file(join(dir, "docs/phases/round-3/m-migrate/T-026.handover.md")).text()).toBe("旧交接\n")
      // 过期状态(R5)与归档目录本身不动
      expect(await Bun.file(join(dir, "docs/phases/round-3/a-analysis/PLAN.md")).text()).toBe("过期状态\n")
      expect(await Bun.file(join(dir, "docs/phases/round-3/phases.md")).text()).toBe("台账\n")
      expect((await stat(join(dir, "docs/phases/round-3/m-migrate"))).isDirectory()).toBe(true)
      // 幂等
      expect((await migrateLegacyDocs(dir)).moved).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("轮次归档跨轮同编号冲突: mtime 最新版归位,旧轮版本原地保留;旧归档引用被改写", async () => {
    const dir = await tempDir()
    try {
      await write(dir, "docs/phases/round-1/m-migrate/T-005.report.md", "第 1 轮版\n")
      await write(dir, "docs/phases/round-2/a-analysis/T-005.report.md", "第 2 轮版\n")
      const older = new Date(Date.now() - 60_000)
      await utimes(join(dir, "docs/phases/round-1/m-migrate/T-005.report.md"), older, older)
      await write(dir, "docs/handovers/R2-a-analysis.md", "交接见 `docs/phases/round-1/m-migrate/T-005.report.md`。\n")
      const { moved } = await migrateLegacyDocs(dir)
      expect(moved).toEqual([join("docs", "T-005", "report.md")])
      expect(await Bun.file(join(dir, "docs/T-005/report.md")).text()).toBe("第 2 轮版\n")
      // 旧轮版本原地保留
      expect(await Bun.file(join(dir, "docs/phases/round-1/m-migrate/T-005.report.md")).text()).toBe("第 1 轮版\n")
      // 活文档中的旧归档引用被改写为提升后的永久路径
      expect(await Bun.file(join(dir, "docs/handovers/R2-a-analysis.md")).text()).toBe(
        "交接见 `docs/T-005/report.md`。\n",
      )
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
      expect(second).toEqual({ moved: [], rewritten: [], skipped: [] })
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

  test("冲突裁决: 同目标双源 mtime 最新优先占领空闲位,落选者原地保留不移动", async () => {
    const dir = await tempDir()
    try {
      await write(dir, "docs/final-audit.md", "旧源\n")
      await write(dir, "docs/final/final-audit.md", "新源\n")
      const older = new Date(Date.now() - 60_000)
      await utimes(join(dir, "docs/final-audit.md"), older, older)
      const { moved } = await migrateLegacyDocs(dir)
      expect(moved).toEqual([join("docs", "T-F1", "final-audit.md")])
      expect(await Bun.file(join(dir, "docs/T-F1/final-audit.md")).text()).toBe("新源\n")
      // 落选者(更旧)原地保留,不移动不删除
      expect(await Bun.file(join(dir, "docs/final-audit.md")).text()).toBe("旧源\n")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("冲突跳过登记 .auto/migrate-skips.md: skipped 键稳定,清单全量重写内容不变(仅首次警告)", async () => {
    const dir = await tempDir()
    try {
      await write(dir, "docs/T-001.report.md", "新源\n")
      await mkdir(join(dir, "docs/phases/round-1/m-migrate"), { recursive: true })
      await write(dir, "docs/phases/round-1/m-migrate/T-001.report.md", "旧源\n")
      const first = await migrateLegacyDocs(dir)
      expect(first.skipped).toEqual(["docs/phases/round-1/m-migrate/T-001.report.md"])
      const registry = await Bun.file(join(dir, ".auto/migrate-skips.md")).text()
      expect(registry).toContain("- docs/T-001/report.md ← docs/phases/round-1/m-migrate/T-001.report.md")
      // 复跑: 跳过键不变,清单重写后逐字稳定(警告去重由 recordOnce 键集合保证)
      const second = await migrateLegacyDocs(dir)
      expect(second.skipped).toEqual(first.skipped)
      expect(await Bun.file(join(dir, ".auto/migrate-skips.md")).text()).toBe(registry)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("同 mtime 决序: 路径字典序先手占领,确定性", async () => {
    const dir = await tempDir()
    try {
      await write(dir, "docs/final-audit.md", "平铺版\n")
      await write(dir, "docs/final/final-audit.md", "目录版\n")
      const same = new Date()
      await utimes(join(dir, "docs/final-audit.md"), same, same)
      await utimes(join(dir, "docs/final/final-audit.md"), same, same)
      const { moved } = await migrateLegacyDocs(dir)
      expect(moved).toEqual([join("docs", "T-F1", "final-audit.md")])
      // "docs/final-audit.md" < "docs/final/final-audit.md"(- < /)→ 平铺版先手
      expect(await Bun.file(join(dir, "docs/T-F1/final-audit.md")).text()).toBe("平铺版\n")
      expect(await Bun.file(join(dir, "docs/final/final-audit.md")).text()).toBe("目录版\n")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("空目录不算冲突: 目标位为空目录腾位落位;非空目录按冲突跳过", async () => {
    const dir = await tempDir()
    try {
      // 目标位是空目录 → 不算冲突,删除空目录后落位
      await write(dir, "docs/T-003.context.md", "旧内容\n")
      await mkdir(join(dir, "docs/T-003/context.md"), { recursive: true })
      const { moved } = await migrateLegacyDocs(dir)
      expect(moved).toEqual([join("docs", "T-003", "context.md")])
      expect(await Bun.file(join(dir, "docs/T-003/context.md")).text()).toBe("旧内容\n")
      // 目标位是非空目录 → 冲突,不移动
      await write(dir, "docs/T-004.report.md", "旧内容\n")
      await mkdir(join(dir, "docs/T-004/report.md"), { recursive: true })
      await Bun.write(join(dir, "docs/T-004/report.md/inner.txt"), "x")
      const second = await migrateLegacyDocs(dir)
      expect(second.moved).toEqual([])
      expect(await readdir(join(dir, "docs/T-004/report.md"))).toEqual(["inner.txt"])
      expect(await Bun.file(join(dir, "docs/T-004.report.md")).text()).toBe("旧内容\n")
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
