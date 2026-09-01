import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { existingKnowledge, knowledgeFile } from "../src/knowledge"

describe("knowledgeFile(默认输出路径)", () => {
  test("docs/migration-kb/migration-<时间戳>.md,时间戳与 run 日志同款格式", () => {
    const file = knowledgeFile()
    expect(file).toMatch(/^docs\/migration-kb\/migration-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/)
  })
})

describe("existingKnowledge(幂等检查)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-knowledge-"))
  }

  test("目录缺失或为空 → undefined", async () => {
    const dir = tempDir()
    try {
      expect(await existingKnowledge(dir)).toBeUndefined()
      mkdirSync(join(dir, "docs/migration-kb"), { recursive: true })
      expect(await existingKnowledge(dir)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("存在非空 .md → 返回其相对路径;空文件与非 .md 不算;多个时取字典序首个", async () => {
    const dir = tempDir()
    try {
      const kb = join(dir, "docs/migration-kb")
      mkdirSync(kb, { recursive: true })
      writeFileSync(join(kb, "migration-b.md"), " 知识甲 ")
      writeFileSync(join(kb, "migration-a.md"), "知识乙")
      writeFileSync(join(kb, "draft.txt"), "非 md 不算")
      writeFileSync(join(kb, "migration-empty.md"), " \n")
      expect(await existingKnowledge(dir)).toBe(join("docs/migration-kb", "migration-a.md"))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
