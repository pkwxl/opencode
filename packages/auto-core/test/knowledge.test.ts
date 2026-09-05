import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { archivePriorKnowledge, existingKnowledge, knowledgeFile } from "../src/knowledge"

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

describe("archivePriorKnowledge(轮间归档)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-knowledge-"))
  }

  test("归档落位: 全部直接条目(非空与否、是否 .md)移入 round-<N>/prior-kb/,子目录整体保持内部结构", async () => {
    const dir = tempDir()
    try {
      const prior = join(dir, "docs", "prior-kb")
      mkdirSync(prior, { recursive: true })
      writeFileSync(join(prior, "prior-a.md"), "知识甲")
      writeFileSync(join(prior, "prior-empty.md"), " \n")
      writeFileSync(join(prior, "notes.txt"), "非 md 也移")
      mkdirSync(join(prior, "sub"))
      writeFileSync(join(prior, "sub", "inner.md"), "子路径")
      const moved = await archivePriorKnowledge(dir, 2)
      expect(moved.sort()).toEqual(
        [
          join("docs", "phases", "round-2", "prior-kb", "notes.txt"),
          join("docs", "phases", "round-2", "prior-kb", "prior-a.md"),
          join("docs", "phases", "round-2", "prior-kb", "prior-empty.md"),
          join("docs", "phases", "round-2", "prior-kb", "sub"),
        ].sort(),
      )
      expect(readdirSync(prior)).toEqual([])
      expect(readFileSync(join(dir, "docs", "phases", "round-2", "prior-kb", "prior-a.md"), "utf8")).toBe("知识甲")
      expect(readFileSync(join(dir, "docs", "phases", "round-2", "prior-kb", "sub", "inner.md"), "utf8")).toBe("子路径")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("源目录缺失或为空 → 空数组 no-op,不创建归档目录", async () => {
    const dir = tempDir()
    try {
      expect(await archivePriorKnowledge(dir, 1)).toEqual([])
      mkdirSync(join(dir, "docs", "prior-kb"), { recursive: true })
      expect(await archivePriorKnowledge(dir, 1)).toEqual([])
      expect(existsSync(join(dir, "docs", "phases", "round-1"))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("重复调用幂等: 第二轮源目录已空 → no-op 不改归档内容", async () => {
    const dir = tempDir()
    try {
      const prior = join(dir, "docs", "prior-kb")
      mkdirSync(prior, { recursive: true })
      writeFileSync(join(prior, "prior-a.md"), "知识甲")
      await archivePriorKnowledge(dir, 2)
      expect(await archivePriorKnowledge(dir, 2)).toEqual([])
      expect(readFileSync(join(dir, "docs", "phases", "round-2", "prior-kb", "prior-a.md"), "utf8")).toBe("知识甲")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("显式 round 参数生效,不经 currentRound 推导(预置 round-1 时推导值应为 2)", async () => {
    const dir = tempDir()
    try {
      mkdirSync(join(dir, "docs", "phases", "round-1"), { recursive: true })
      const prior = join(dir, "docs", "prior-kb")
      mkdirSync(prior, { recursive: true })
      writeFileSync(join(prior, "prior-a.md"), "知识甲")
      await archivePriorKnowledge(dir, 5)
      expect(existsSync(join(dir, "docs", "phases", "round-5", "prior-kb", "prior-a.md"))).toBe(true)
      expect(existsSync(join(dir, "docs", "phases", "round-2"))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
