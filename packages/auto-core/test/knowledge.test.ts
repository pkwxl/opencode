import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { opencodeAgent } from "../src/agent/opencode/client"
import { existingDistilledDocs, existingKnowledge, existingPriorKnowledge, extractKnowledge, extractPriorKnowledge, knowledgeFile, priorKnowledgeComplete, priorKnowledgeDigest, priorKnowledgeFile } from "../src/knowledge"
import { completePhase, syncPhaseIndex } from "../src/phases"

// A round established with phases "amk": the knowledge phase is P03.
async function knowledgePhase(dir: string, round: number) {
  return (await syncPhaseIndex(dir, round, "amk")).find((unit) => unit.type === "knowledge")!
}

async function git(dir: string, ...args: string[]) {
  const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`git ${args.join(" ")} 退出码 ${code}: ${err || out}`)
  return out
}

describe("knowledgeFile / priorKnowledgeFile(输出路径)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-knowledge-"))
  }

  test("knowledgeFile = the knowledge phase's standard artifact kb.md inside its phase directory", async () => {
    const dir = tempDir()
    try {
      expect(knowledgeFile(await knowledgePhase(dir, 2))).toBe("docs/R-02/P03-knowledge/kb.md")
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

describe("existingKnowledge(本阶段幂等检查)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-knowledge-"))
  }

  test("the phase's kb.md non-empty → its path; missing / blank → undefined; legacy flat documents do not count", async () => {
    const dir = tempDir()
    try {
      const phase = await knowledgePhase(dir, 1)
      expect(await existingKnowledge(dir, phase)).toBeUndefined()
      mkdirSync(join(dir, "docs/migration-kb"), { recursive: true })
      writeFileSync(join(dir, "docs/migration-kb/R1-migration-a.md"), "旧平铺知识")
      writeFileSync(join(dir, "docs/R-01/migration-kb.md"), "字母布局期的轮内知识")
      expect(await existingKnowledge(dir, phase)).toBeUndefined()
      writeFileSync(join(dir, knowledgeFile(phase)), " \n")
      expect(await existingKnowledge(dir, phase)).toBeUndefined()
      writeFileSync(join(dir, knowledgeFile(phase)), "本轮知识")
      expect(await existingKnowledge(dir, phase)).toBe("docs/R-01/P03-knowledge/kb.md")
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

  test("旧机制轮次续跑回落: 轮次 ≥ 2 且阶段索引已有完成阶段 → 无前缀存量算本轮;尚无完成阶段(新一轮)不回落", async () => {
    const dir = tempDir()
    try {
      const prior = join(dir, "docs/prior-kb")
      mkdirSync(prior, { recursive: true })
      mkdirSync(join(dir, "docs"), { recursive: true })
      writeFileSync(join(prior, "prior-2026-09-03_14-40-52.md"), "旧机制轮次一直消费的无前缀存量")
      const units = await syncPhaseIndex(dir, 2, "am")
      // 尚无完成阶段(新一轮开工)→ 不回落,R<N>- 前缀缺失自然重新蒸馏
      expect(await existingPriorKnowledge(dir, 2)).toBeUndefined()
      // 轮已推进(阶段已完成)→ 回落接受无前缀存量: 旧判据"目录非空即跳过"
      // 使旧机制轮次从未产出本轮 R 文档,严格按前缀判定会把中断重跑拖回轮首
      await completePhase(dir, units[0]!)
      expect(await existingPriorKnowledge(dir, 2)).toBe(join("docs/prior-kb", "prior-2026-09-03_14-40-52.md"))
      // 本轮 R 前缀文档优先于回落
      writeFileSync(join(prior, "R2-prior-new.md"), "本轮文档")
      expect(await existingPriorKnowledge(dir, 2)).toBe(join("docs/prior-kb", "R2-prior-new.md"))
      // 阶段索引非法按未推进处理(严格失败属 readPhases 的直接调用方职责)
      rmSync(join(prior, "R2-prior-new.md"))
      writeFileSync(join(dir, "docs/R-02/phases.md"), "- [ ] P01 nonsense\n")
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

  test("temp-kb.md(提取中间产物,未收笔态)永不算既有产物: 旧平铺读回落跳过", async () => {
    const dir = tempDir()
    try {
      const prior = join(dir, "docs/prior-kb")
      mkdirSync(prior, { recursive: true })
      // 仅有 temp-kb.md(无 R 前缀,旧机制轮次续跑回落本可能误食): 一律跳过
      writeFileSync(join(prior, "temp-kb.md"), "半途而废的中间产物")
      expect(await existingPriorKnowledge(dir, 1)).toBeUndefined()
      await completePhase(dir, (await syncPhaseIndex(dir, 2, "am"))[0]!)
      expect(await existingPriorKnowledge(dir, 2)).toBeUndefined()
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
      // temp-kb.md(中间产物)不进蒸馏产物清单
      writeFileSync(join(dir, "docs/prior-kb", "temp-kb.md"), "未收笔的中间产物")
      expect(await existingDistilledDocs(dir, 2)).not.toContain(join("docs/prior-kb", "temp-kb.md"))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("轮次目录: 历轮 prior-kb.md、各阶段目录 handover.md 与 knowledge 阶段 kb.md 一并收集,本轮 prior-kb 排除", async () => {
    const dir = tempDir()
    try {
      await syncPhaseIndex(dir, 1, "mk")
      writeFileSync(join(dir, "docs/R-01/P02-knowledge/kb.md"), "第 1 轮知识")
      writeFileSync(join(dir, "docs/R-01/prior-kb.md"), "第 1 轮前置知识")
      writeFileSync(join(dir, "docs/R-01/P01-implement/handover.md"), "第 1 轮交接")
      writeFileSync(join(dir, "docs/R-01/P01-implement/notes.md"), "自由产物不算")
      await syncPhaseIndex(dir, 2, "mk")
      writeFileSync(join(dir, "docs/R-02/prior-kb.md"), "本轮前置知识不算")
      writeFileSync(join(dir, "docs/R-02/P02-knowledge/kb.md"), " \n") // 空文件不算
      writeFileSync(join(dir, "docs/R-02/P01-implement/handover.md"), "本轮已完成阶段的交接")
      expect(await existingDistilledDocs(dir, 2)).toEqual([
        join("docs/R-01", "P01-implement", "handover.md"),
        join("docs/R-01", "P02-knowledge", "kb.md"),
        join("docs/R-01", "prior-kb.md"),
        join("docs/R-02", "P01-implement", "handover.md"),
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
      // temp-kb.md(中间产物)不注入摘要
      writeFileSync(join(dir, "docs/prior-kb/temp-kb.md"), "未收笔的中间产物")
      expect(await priorKnowledgeDigest(dir)).not.toContain("temp-kb")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("priorKnowledgeComplete(收笔标记判定)", () => {
  test("最后一个非空行恰为「完成」→ true;空文档/无标记/标记带尾巴 → false", () => {
    expect(priorKnowledgeComplete("")).toBe(false)
    expect(priorKnowledgeComplete("  \n")).toBe(false)
    expect(priorKnowledgeComplete("完成")).toBe(true)
    expect(priorKnowledgeComplete("# 知识库\n\n正文\n\n完成")).toBe(true)
    expect(priorKnowledgeComplete("正文\n完成\n\n  \n")).toBe(true)
    expect(priorKnowledgeComplete("正文\n  完成  \n")).toBe(true)
    expect(priorKnowledgeComplete("正文,已完成。")).toBe(false)
    expect(priorKnowledgeComplete("正文\n完成。")).toBe(false)
    expect(priorKnowledgeComplete("完成\n再补一段正文")).toBe(false)
  })
})

describe("extractPriorKnowledge 完成判定(产物落盘 + 已提交;dirty 交人工)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-knowledge-"))
  }
  // 本组只覆盖不启动会话的分支(skipped/dirty),client 不会被触达。
  const client = opencodeAgent({} as OpencodeClient)

  test("产物已存在且已提交 → skipped,不产生新提交", async () => {
    const dir = tempDir()
    try {
      await git(dir, "init", "-q")
      mkdirSync(join(dir, "docs/R-01"), { recursive: true })
      writeFileSync(join(dir, "docs/R-01/prior-kb.md"), "第 1 轮前置知识\n\n完成\n")
      await git(dir, "add", "-A")
      await git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init")
      const result = await extractPriorKnowledge(client, dir, { dir })
      expect(result).toEqual({ type: "skipped", file: join("docs", "R-01", "prior-kb.md") })
      expect((await git(dir, "rev-list", "--count", "HEAD")).trim()).toBe("1")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("产物已存在但尚未提交 → 补提交后 skipped(完成判定以提交为准)", async () => {
    const dir = tempDir()
    try {
      await git(dir, "init", "-q")
      await git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
      mkdirSync(join(dir, "docs/R-01"), { recursive: true })
      writeFileSync(join(dir, "docs/R-01/prior-kb.md"), "第 1 轮前置知识\n\n完成\n")
      const result = await extractPriorKnowledge(client, dir, { dir })
      expect(result).toEqual({ type: "skipped", file: join("docs", "R-01", "prior-kb.md") })
      // 已补提交: 工作区干净,提交带 prior-knowledge 阶段标记
      expect((await git(dir, "status", "--porcelain")).trim()).toBe("")
      expect(await git(dir, "log", "-1", "--pretty=%B")).toContain("Auto-Stage: prior-knowledge")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("产物缺失但工作区有未提交改动 → dirty(不主动清理,列出改动文件)", async () => {
    const dir = tempDir()
    try {
      await git(dir, "init", "-q")
      await git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
      mkdirSync(join(dir, "docs/R-01"), { recursive: true })
      writeFileSync(join(dir, "docs/R-01/temp-kb.md"), "半途而废的中间产物")
      const result = await extractPriorKnowledge(client, dir, { dir })
      expect(result.type).toBe("dirty")
      expect((result as { files: string[] }).files).toContain(join("docs", "R-01", "temp-kb.md"))
      // 不主动清理: 现场原样保留,无任何新提交
      expect((await git(dir, "rev-list", "--count", "HEAD")).trim()).toBe("1")
      expect(await Bun.file(join(dir, "docs/R-01/temp-kb.md")).text()).toBe("半途而废的中间产物")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("extractKnowledge 完成判定(③补提交/④dirty 推广,plans/0021-commit-boundary-design.md)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-knowledge-"))
  }
  // 本组只覆盖不启动会话的分支(skipped/dirty),client 不会被触达。
  const client = opencodeAgent({} as OpencodeClient)
  // 轮首建立的阶段目录先提交(外壳在轮次目录初建后统一提交,提供干净基线)。
  async function committedKnowledgePhase(dir: string) {
    const phase = await knowledgePhase(dir, 1)
    await git(dir, "add", "-A")
    await git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "round start")
    return phase
  }

  test("③ 本轮文档已产出但尚未提交 → 补提交后 skipped(完成判定以提交为准)", async () => {
    const dir = tempDir()
    try {
      await git(dir, "init", "-q")
      await git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
      const phase = await committedKnowledgePhase(dir)
      writeFileSync(join(dir, knowledgeFile(phase)), "第 1 轮迁移知识")
      const result = await extractKnowledge(client, dir, { dir }, phase)
      expect(result).toEqual({ type: "skipped", file: "docs/R-01/P03-knowledge/kb.md" })
      expect((await git(dir, "status", "--porcelain")).trim()).toBe("")
      expect(await git(dir, "log", "-1", "--pretty=%B")).toContain("Auto-Stage: knowledge")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("④ 文档缺失但工作区有未提交改动 → dirty(半途而废现场交人工,不主动清理)", async () => {
    const dir = tempDir()
    try {
      await git(dir, "init", "-q")
      await git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
      const phase = await committedKnowledgePhase(dir)
      writeFileSync(join(dir, "src.ts"), "半途而废的产物")
      const result = await extractKnowledge(client, dir, { dir }, phase)
      expect(result.type).toBe("dirty")
      expect((result as { files: string[] }).files).toContain("src.ts")
      expect((await git(dir, "rev-list", "--count", "HEAD")).trim()).toBe("2")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("门禁关闭(--commit false)维持旧语义: 产物存在即 skipped,不查不提交", async () => {
    const dir = tempDir()
    try {
      await git(dir, "init", "-q")
      await git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
      const phase = await committedKnowledgePhase(dir)
      writeFileSync(join(dir, knowledgeFile(phase)), "第 1 轮迁移知识")
      const result = await extractKnowledge(client, dir, { dir, commit: false }, phase)
      expect(result).toEqual({ type: "skipped", file: "docs/R-01/P03-knowledge/kb.md" })
      expect((await git(dir, "rev-list", "--count", "HEAD")).trim()).toBe("2")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
