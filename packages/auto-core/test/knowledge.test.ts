import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { existingDistilledDocs, existingKnowledge, existingPriorKnowledge, knowledgeFile, parsePriorVerdict, priorKnowledgeFile } from "../src/knowledge"

describe("knowledgeFile(输出路径,轮次前缀)", () => {
  test("docs/migration-kb/R<N>-migration-<时间戳>.md,时间戳与 run 日志同款格式", () => {
    expect(knowledgeFile(2)).toMatch(/^docs\/migration-kb\/R2-migration-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/)
    expect(knowledgeFile(1)).toMatch(/^docs\/migration-kb\/R1-migration-/)
  })

  test("priorKnowledgeFile: docs/prior-kb/R<N>-prior-<时间戳>.md(与 migration-kb 分离)", () => {
    expect(priorKnowledgeFile(1)).toMatch(/^docs\/prior-kb\/R1-prior-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/)
    expect(priorKnowledgeFile(3)).toMatch(/^docs\/prior-kb\/R3-prior-/)
  })
})

describe("existingKnowledge(本轮幂等检查,R<N>- 前缀守卫)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-knowledge-"))
  }

  test("目录缺失或为空 → undefined", async () => {
    const dir = tempDir()
    try {
      expect(await existingKnowledge(dir, 1)).toBeUndefined()
      mkdirSync(join(dir, "docs/migration-kb"), { recursive: true })
      expect(await existingKnowledge(dir, 1)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("本轮 R<round>- 前缀非空 .md → 返回;前几轮 R<M>- 不算;空文件与非 .md 不算", async () => {
    const dir = tempDir()
    try {
      const kb = join(dir, "docs/migration-kb")
      mkdirSync(kb, { recursive: true })
      writeFileSync(join(kb, "R1-migration-a.md"), "第 1 轮知识")
      writeFileSync(join(kb, "R2-migration-b.md"), " 知识乙 ")
      writeFileSync(join(kb, "R2-migration-empty.md"), " \n")
      writeFileSync(join(kb, "draft.txt"), "非 md 不算")
      expect(await existingKnowledge(dir, 1)).toBe(join("docs/migration-kb", "R1-migration-a.md"))
      expect(await existingKnowledge(dir, 2)).toBe(join("docs/migration-kb", "R2-migration-b.md"))
      expect(await existingKnowledge(dir, 3)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("第 1 轮读回落: 无 R 前缀存量(P2 前布局)视为本轮产物;本轮前缀优先", async () => {
    const dir = tempDir()
    try {
      const kb = join(dir, "docs/migration-kb")
      mkdirSync(kb, { recursive: true })
      writeFileSync(join(kb, "migration-legacy.md"), "P2 前存量")
      expect(await existingKnowledge(dir, 1)).toBe(join("docs/migration-kb", "migration-legacy.md"))
      // 轮次 ≥ 2 时无前缀存量不再算本轮(它属于更早的轮次)
      expect(await existingKnowledge(dir, 2)).toBeUndefined()
      // 本轮前缀文档优先于读回落
      writeFileSync(join(kb, "R1-migration-new.md"), "本轮知识")
      expect(await existingKnowledge(dir, 1)).toBe(join("docs/migration-kb", "R1-migration-new.md"))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("existingPriorKnowledge(本轮幂等检查,与 existingKnowledge 同一守卫)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-knowledge-"))
  }

  test("本轮 R<round>-prior 前缀非空 .md → 返回;前几轮与无前缀存量(轮次 ≥ 2)不算", async () => {
    const dir = tempDir()
    try {
      const prior = join(dir, "docs/prior-kb")
      mkdirSync(prior, { recursive: true })
      writeFileSync(join(prior, "R1-prior-a.md"), "第 1 轮前置知识")
      writeFileSync(join(prior, "R2-prior-empty.md"), " \n")
      expect(await existingPriorKnowledge(dir, 2)).toBeUndefined()
      writeFileSync(join(prior, "R2-prior-b.md"), "第 2 轮前置知识")
      expect(await existingPriorKnowledge(dir, 2)).toBe(join("docs/prior-kb", "R2-prior-b.md"))
      expect(await existingPriorKnowledge(dir, 1)).toBe(join("docs/prior-kb", "R1-prior-a.md"))
      // 目录缺失 → undefined
      const bare = tempDir()
      try {
        expect(await existingPriorKnowledge(bare, 1)).toBeUndefined()
      } finally {
        rmSync(bare, { recursive: true, force: true })
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("existingDistilledDocs(已有蒸馏产物清单,提取会话引用化输入)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-knowledge-"))
  }

  test("收集 migration-kb/handovers/历轮 prior-kb 的非空 .md,排除本轮前缀;目录缺失 → 空数组", async () => {
    const dir = tempDir()
    try {
      expect(await existingDistilledDocs(dir, 2)).toEqual([])
      mkdirSync(join(dir, "docs/migration-kb"), { recursive: true })
      mkdirSync(join(dir, "docs/handovers"), { recursive: true })
      mkdirSync(join(dir, "docs/prior-kb"), { recursive: true })
      writeFileSync(join(dir, "docs/migration-kb", "R1-migration-a.md"), "上一轮知识")
      writeFileSync(join(dir, "docs/migration-kb", "R1-migration-empty.md"), " \n")
      writeFileSync(join(dir, "docs/migration-kb", "notes.txt"), "非 md 不算")
      writeFileSync(join(dir, "docs/handovers", "R1-m-migrate.md"), "上一轮交接")
      writeFileSync(join(dir, "docs/prior-kb", "R1-prior-old.md"), "旧前置知识")
      writeFileSync(join(dir, "docs/prior-kb", "R2-prior-current.md"), "本轮文档不算")
      expect(await existingDistilledDocs(dir, 2)).toEqual([
        join("docs/handovers", "R1-m-migrate.md"),
        join("docs/migration-kb", "R1-migration-a.md"),
        join("docs/prior-kb", "R1-prior-old.md"),
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("parsePriorVerdict(复杂度评估协议判读)", () => {
  test("simple/full、半角与全角冒号、取首个匹配行", () => {
    expect(parsePriorVerdict("# 迁移知识库\n\n## 复杂度评估\n\n流程建议: simple\n\n依据: 微小增量")).toBe("simple")
    expect(parsePriorVerdict("流程建议: full")).toBe("full")
    expect(parsePriorVerdict("流程建议：simple")).toBe("simple")
    expect(parsePriorVerdict("x\n流程建议: simple\ny\n流程建议: full")).toBe("simple")
  })

  test("缺失、占位未填、非法值 → undefined(调用方按完整流程处理)", () => {
    expect(parsePriorVerdict("")).toBeUndefined()
    expect(parsePriorVerdict("## 复杂度评估\n\n流程建议: <full|simple>")).toBeUndefined()
    expect(parsePriorVerdict("流程建议: SIMPLE")).toBeUndefined()
    expect(parsePriorVerdict("流程建议: simple(微小增量)")).toBeUndefined()
    expect(parsePriorVerdict("建议: simple")).toBeUndefined()
  })
})
