import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { existingPriorKnowledge, priorKnowledgeDigest, priorKnowledgeFile } from "../src/knowledge"
import { parseInferOutput, readToolState } from "../src/tool"

describe("parseInferOutput(参数推断产物协议)", () => {
  test("成功形态: 三键齐备的合法相对路径", () => {
    expect(parseInferOutput(`{"sourceDir":"legacy","sourcePath":"src/mod.ts","destDir":"target"}`)).toEqual({
      sourceDir: "legacy",
      sourcePath: "src/mod.ts",
      destDir: "target",
    })
  })

  test("blocked 形态: 非空原因为合法产物", () => {
    expect(parseInferOutput(`{"blocked":"找不到源系统"}`)).toEqual({ blocked: "找不到源系统" })
    expect(parseInferOutput(`{"blocked":"  "}`)).toBeUndefined()
    expect(parseInferOutput(`{"blocked":42}`)).toBeUndefined()
  })

  test("非法 JSON / 缺键 / 空值 → undefined(未产出)", () => {
    expect(parseInferOutput("")).toBeUndefined()
    expect(parseInferOutput("not json")).toBeUndefined()
    expect(parseInferOutput("[]")).toBeUndefined()
    expect(parseInferOutput(`{"sourceDir":"legacy"}`)).toBeUndefined()
    expect(parseInferOutput(`{"sourceDir":"legacy","sourcePath":"","destDir":"target"}`)).toBeUndefined()
  })

  test("绝对路径与 .. 逃逸拒绝", () => {
    expect(parseInferOutput(`{"sourceDir":"/abs","sourcePath":"x","destDir":"y"}`)).toBeUndefined()
    expect(parseInferOutput(`{"sourceDir":"legacy","sourcePath":"../x","destDir":"y"}`)).toBeUndefined()
    expect(parseInferOutput(`{"sourceDir":"legacy","sourcePath":"x","destDir":"a/../b"}`)).toBeUndefined()
  })
})

describe("readToolState(完成标记)", () => {
  test("文件缺失或坏 JSON → 未完成", async () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tool-"))
    try {
      expect(await readToolState(dir)).toEqual({})
      mkdirSync(join(dir, ".auto"), { recursive: true })
      writeFileSync(join(dir, ".auto/tool.json"), "not json")
      expect(await readToolState(dir)).toEqual({})
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("{done:true} 原样读回", async () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tool-"))
    try {
      mkdirSync(join(dir, ".auto"), { recursive: true })
      writeFileSync(join(dir, ".auto/tool.json"), JSON.stringify({ done: true }))
      expect(await readToolState(dir)).toEqual({ done: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("prior-kb(前置知识提取)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-prior-"))
  }

  test("priorKnowledgeFile: docs/prior-kb/prior-<时间戳>.md(与 k 阶段 migration-kb 分离)", () => {
    expect(priorKnowledgeFile()).toMatch(/^docs\/prior-kb\/prior-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/)
  })

  test("existingPriorKnowledge: 非空 .md 存在即返回;空文件/非 md 不算", async () => {
    const dir = tempDir()
    try {
      expect(await existingPriorKnowledge(dir)).toBeUndefined()
      const kb = join(dir, "docs/prior-kb")
      mkdirSync(kb, { recursive: true })
      writeFileSync(join(kb, "prior-empty.md"), " \n")
      expect(await existingPriorKnowledge(dir)).toBeUndefined()
      writeFileSync(join(kb, "prior-a.md"), "知识")
      expect(await existingPriorKnowledge(dir)).toBe(join("docs/prior-kb", "prior-a.md"))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("priorKnowledgeDigest: 全部非空文档按文件名拼接;无产物 → undefined", async () => {
    const dir = tempDir()
    try {
      expect(await priorKnowledgeDigest(dir)).toBeUndefined()
      const kb = join(dir, "docs/prior-kb")
      mkdirSync(kb, { recursive: true })
      writeFileSync(join(kb, "prior-b.md"), "乙")
      writeFileSync(join(kb, "prior-a.md"), "甲")
      writeFileSync(join(kb, "note.txt"), "不算")
      const digest = await priorKnowledgeDigest(dir)
      expect(digest).toContain("### docs/prior-kb/prior-a.md")
      expect(digest).toContain("### docs/prior-kb/prior-b.md")
      expect(digest!.indexOf("甲")).toBeLessThan(digest!.indexOf("乙"))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
