import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { existingDistilledDocs, existingKnowledge, existingPriorKnowledge, knowledgeFile, parsePriorVerdict, priorKnowledgeDigest, priorKnowledgeFile } from "../src/knowledge"

describe("knowledgeFile(输出路径,布局感知)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-knowledge-"))
  }

  test("新布局(轮目录已建)= 轮内固定名;旧布局 = docs/migration-kb/R<N>-migration-<时间戳>.md", async () => {
    const dir = tempDir()
    try {
      // 旧布局(存量项目无轮目录): 时间戳与 run 日志同款格式
      expect(await knowledgeFile(dir, 2)).toMatch(/^docs\/migration-kb\/R2-migration-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/)
      expect(await knowledgeFile(dir, 1)).toMatch(/^docs\/migration-kb\/R1-migration-/)
      // 新布局: docs/R-NN/migration-kb.md(轮内固定名,无时间戳)
      mkdirSync(join(dir, "docs/R-02"), { recursive: true })
      expect(await knowledgeFile(dir, 2)).toBe(join("docs", "R-02", "migration-kb.md"))
      // 其他轮次(目录未建)仍按旧布局
      expect(await knowledgeFile(dir, 1)).toMatch(/^docs\/migration-kb\/R1-migration-/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("priorKnowledgeFile: 新布局 = docs/R-NN/prior-kb.md;旧布局 = docs/prior-kb/R<N>-prior-<时间戳>.md", async () => {
    const dir = tempDir()
    try {
      expect(await priorKnowledgeFile(dir, 1)).toMatch(/^docs\/prior-kb\/R1-prior-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/)
      expect(await priorKnowledgeFile(dir, 3)).toMatch(/^docs\/prior-kb\/R3-prior-/)
      mkdirSync(join(dir, "docs/R-03"), { recursive: true })
      expect(await priorKnowledgeFile(dir, 3)).toBe(join("docs", "R-03", "prior-kb.md"))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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

  test("新布局: 轮内 migration-kb.md 非空 → 返回;缺失回落旧平铺(前缀守卫同款)", async () => {
    const dir = tempDir()
    try {
      mkdirSync(join(dir, "docs/R-02"), { recursive: true })
      // 轮内尚无知识文档,旧平铺只有前几轮产物 → undefined(必重新提取)
      mkdirSync(join(dir, "docs/migration-kb"), { recursive: true })
      writeFileSync(join(dir, "docs/migration-kb/R1-migration-a.md"), "第 1 轮知识")
      expect(await existingKnowledge(dir, 2)).toBeUndefined()
      // 轮内文档产出 → 幂等命中(优先于旧平铺)
      writeFileSync(join(dir, "docs/R-02/migration-kb.md"), "本轮知识")
      expect(await existingKnowledge(dir, 2)).toBe(join("docs", "R-02", "migration-kb.md"))
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

  test("旧机制轮次续跑回落: 轮次 ≥ 2 且台账已有完成阶段 → 无前缀存量算本轮;台账为空(新一轮)不回落", async () => {
    const dir = tempDir()
    try {
      const prior = join(dir, "docs/prior-kb")
      mkdirSync(prior, { recursive: true })
      mkdirSync(join(dir, "docs"), { recursive: true })
      writeFileSync(join(prior, "prior-2026-09-03_14-40-52.md"), "旧机制轮次一直消费的无前缀存量")
      // 台账为空(新一轮开工)→ 不回落,R<N>- 前缀缺失自然重新蒸馏
      expect(await existingPriorKnowledge(dir, 2)).toBeUndefined()
      // 轮已推进(台账有完成阶段)→ 回落接受无前缀存量: 旧判据"目录非空即跳过"
      // 使旧机制轮次从未产出本轮 R 文档,严格按前缀判定会把中断重跑拖回轮首
      writeFileSync(
        join(dir, "docs", "phases.md"),
        "# 阶段台账\n\n- [done] a 分析 → docs/phases/a-analysis/(交接: docs/phases/a-analysis/handover.md)\n",
      )
      expect(await existingPriorKnowledge(dir, 2)).toBe(join("docs/prior-kb", "prior-2026-09-03_14-40-52.md"))
      // 本轮 R 前缀文档优先于回落
      writeFileSync(join(prior, "R2-prior-new.md"), "本轮文档")
      expect(await existingPriorKnowledge(dir, 2)).toBe(join("docs/prior-kb", "R2-prior-new.md"))
      // 台账非法按未推进处理(严格失败属 readLedger 的直接调用方职责)
      rmSync(join(prior, "R2-prior-new.md"))
      writeFileSync(join(dir, "docs", "phases.md"), "垃圾行\n")
      expect(await existingPriorKnowledge(dir, 2)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("新布局结构性消除旧轮误判: R-05 轮目录已建 + 旧轮 R4-prior 存量 → 必重新蒸馏(2026-09-08 事故回归)", async () => {
    const dir = tempDir()
    try {
      // kernel-dm-stripe 事故现场: 旧轮(docs/prior-kb/R4-prior-*.md,含 simple 判定)
      // 原地保留;新轮 R-05 轮首建立(轮内 prior-kb.md 恒空)
      mkdirSync(join(dir, "docs/prior-kb"), { recursive: true })
      writeFileSync(join(dir, "docs/prior-kb/R4-prior-2026.md"), "# 第 4 轮前置知识\n\n流程建议: simple\n")
      mkdirSync(join(dir, "docs/R-05"), { recursive: true })
      expect(await existingPriorKnowledge(dir, 5)).toBeUndefined()
      // 轮内文档产出后幂等命中
      writeFileSync(join(dir, "docs/R-05/prior-kb.md"), "本轮前置知识")
      expect(await existingPriorKnowledge(dir, 5)).toBe(join("docs", "R-05", "prior-kb.md"))
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

  test("新布局: 历轮 docs/R-*/ 的 migration-kb.md/prior-kb.md/handovers/* 一并收集,本轮 prior-kb 排除", async () => {
    const dir = tempDir()
    try {
      mkdirSync(join(dir, "docs/R-01/handovers"), { recursive: true })
      writeFileSync(join(dir, "docs/R-01/migration-kb.md"), "第 1 轮知识")
      writeFileSync(join(dir, "docs/R-01/prior-kb.md"), "第 1 轮前置知识")
      writeFileSync(join(dir, "docs/R-01/handovers/m-migrate.md"), "第 1 轮交接")
      mkdirSync(join(dir, "docs/R-02"), { recursive: true })
      writeFileSync(join(dir, "docs/R-02/prior-kb.md"), "本轮前置知识不算")
      writeFileSync(join(dir, "docs/R-02/migration-kb.md"), " \n") // 空文件不算
      expect(await existingDistilledDocs(dir, 2)).toEqual([
        join("docs/R-01", "handovers", "m-migrate.md"),
        join("docs/R-01", "migration-kb.md"),
        join("docs/R-01", "prior-kb.md"),
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("priorKnowledgeDigest(前置知识摘要,双布局跨轮累积注入)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-knowledge-"))
  }

  test("历轮 docs/R-*/prior-kb.md + 旧平铺 docs/prior-kb/ 全部非空文档按路径排序拼接;无产物 → undefined", async () => {
    const dir = tempDir()
    try {
      expect(await priorKnowledgeDigest(dir)).toBeUndefined()
      mkdirSync(join(dir, "docs/R-01"), { recursive: true })
      writeFileSync(join(dir, "docs/R-01/prior-kb.md"), "第 1 轮前置知识")
      mkdirSync(join(dir, "docs/R-02"), { recursive: true })
      writeFileSync(join(dir, "docs/R-02/prior-kb.md"), "  \n") // 空文件不注入
      mkdirSync(join(dir, "docs/prior-kb"), { recursive: true })
      writeFileSync(join(dir, "docs/prior-kb/R0-prior-legacy.md"), "旧平铺前置知识")
      const digest = await priorKnowledgeDigest(dir)
      expect(digest).toContain(`### ${join("docs", "R-01", "prior-kb.md")}`)
      expect(digest).toContain("第 1 轮前置知识")
      expect(digest).toContain(`### ${join("docs", "prior-kb", "R0-prior-legacy.md")}`)
      expect(digest).toContain("旧平铺前置知识")
      expect(digest).not.toContain("R-02")
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
