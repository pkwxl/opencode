import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DEFAULTS, loadProjectConfig, saveProjectConfig } from "@opencode-ai/auto-core/config"
import { existingPriorKnowledge, priorKnowledgeDigest, priorKnowledgeFile } from "@opencode-ai/auto-core/knowledge"
import { needsSceneCleanup, parseInferOutput, prepareNextRound, readToolState } from "../src/tool"

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

  test("{round:N} 本轮标记原样读回(未完成)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tool-"))
    try {
      mkdirSync(join(dir, ".auto"), { recursive: true })
      writeFileSync(join(dir, ".auto/tool.json"), JSON.stringify({ round: 2 }))
      expect(await readToolState(dir)).toEqual({ round: 2 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("needsSceneCleanup(现场清理判定)", () => {
  test("标记未建立 + 别人的遗留(台账有完成阶段 / 现场有内容)→ 清理", () => {
    expect(needsSceneCleanup(false, ["a", "d", "m", "t", "v", "k"], false)).toBe(true)
    expect(needsSceneCleanup(false, ["a"], false)).toBe(true)
    expect(needsSceneCleanup(false, [], true)).toBe(true)
  })

  test("台账无法解析(undefined)视为别人的内容 → 清理", () => {
    expect(needsSceneCleanup(false, undefined, false)).toBe(true)
  })

  test("标记未建立 + 空现场(全新项目)→ 不清理", () => {
    expect(needsSceneCleanup(false, [], false)).toBe(false)
  })

  test("标记已建立 = 本轮在跑 → 永不清理(中断续跑)", () => {
    expect(needsSceneCleanup(true, ["a"], true)).toBe(false)
    expect(needsSceneCleanup(true, undefined, true)).toBe(false)
    expect(needsSceneCleanup(true, [], false)).toBe(false)
  })
})

describe("prepareNextRound(--next-path 轮间过渡)", () => {
  // 捏造完成态前的基线: 已固化配置(含迁移源)+ 空白目录,由各用例补状态文件。
  async function seedDir() {
    const dir = mkdtempSync(join(tmpdir(), "auto-next-"))
    await saveProjectConfig(dir, {
      ...CONFIG_DEFAULTS,
      mode: "migrate",
      phases: "admtvk",
      autoNumber: true,
      source: { dir: "legacy", path: "src/old.ts" },
      destDir: "target",
    })
    return dir
  }

  test("完成态: 修订 source.path + 归档 prior-kb 到 state.round 轮 + 清推断产物与标记", async () => {
    const dir = await seedDir()
    try {
      mkdirSync(join(dir, ".auto"), { recursive: true })
      writeFileSync(join(dir, ".auto/tool.json"), JSON.stringify({ round: 2, done: true }))
      writeFileSync(join(dir, ".auto/infer.json"), "{}")
      mkdirSync(join(dir, "docs/prior-kb"), { recursive: true })
      writeFileSync(join(dir, "docs/prior-kb/prior-x.md"), "旧知识")
      mkdirSync(join(dir, "docs/phases/round-1"), { recursive: true })
      writeFileSync(join(dir, "docs/phases/round-1/PLAN.md"), "# 旧轮")
      expect(await prepareNextRound(dir, await loadProjectConfig(dir), "src/new.ts")).toBe(0)
      // 配置: 仅 source.path 修订,dir 与其余键不动
      expect(await loadProjectConfig(dir)).toMatchObject({ source: { dir: "legacy", path: "src/new.ts" }, destDir: "target" })
      // prior 文档落位 state.round(2)轮,源目录清空 → 跳过检查必然放行重新蒸馏
      expect(await Bun.file(join(dir, "docs/phases/round-2/prior-kb/prior-x.md")).text()).toBe("旧知识")
      expect(readdirSync(join(dir, "docs/prior-kb"))).toEqual([])
      // 陈旧推断产物与 done 标记已清
      expect(await Bun.file(join(dir, ".auto/infer.json")).exists()).toBe(false)
      expect(await Bun.file(join(dir, ".auto/tool.json")).exists()).toBe(false)
      // §2.2 时序: 过渡成功后(done 标记已删、新标记未建)重跑被严格拒绝
      const again = await prepareNextRound(dir, await loadProjectConfig(dir), "src/new.ts")
      expect((again as { error: string }).error).toContain("先完成一次完整迁移")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("非完成态(无 tool.json / {round} 进行中)→ {error},不做任何写盘", async () => {
    const dir = await seedDir()
    try {
      // 无标记: 前一形态报文
      const none = await prepareNextRound(dir, await loadProjectConfig(dir), "src/new.ts")
      expect((none as { error: string }).error).toContain("先完成一次完整迁移")
      // 本轮进行中: 续跑指引形态报文
      mkdirSync(join(dir, ".auto"), { recursive: true })
      writeFileSync(join(dir, ".auto/tool.json"), JSON.stringify({ round: 3 }))
      const ongoing = await prepareNextRound(dir, await loadProjectConfig(dir), "src/new.ts")
      expect((ongoing as { error: string }).error).toContain("断点续跑")
      // 拒绝路径零副作用: 配置与状态原样
      expect(await loadProjectConfig(dir)).toMatchObject({ source: { dir: "legacy", path: "src/old.ts" } })
      expect(await readToolState(dir)).toEqual({ round: 3 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("round 缺失回落 currentRound: {done:true} 且无轮次归档 → 归档到 round-1/prior-kb/", async () => {
    const dir = await seedDir()
    try {
      mkdirSync(join(dir, ".auto"), { recursive: true })
      writeFileSync(join(dir, ".auto/tool.json"), JSON.stringify({ done: true }))
      mkdirSync(join(dir, "docs/prior-kb"), { recursive: true })
      writeFileSync(join(dir, "docs/prior-kb/prior-a.md"), "知识甲")
      expect(await prepareNextRound(dir, await loadProjectConfig(dir), "src/new.ts")).toBe(0)
      expect(await Bun.file(join(dir, "docs/phases/round-1/prior-kb/prior-a.md")).text()).toBe("知识甲")
      expect(await Bun.file(join(dir, ".auto/tool.json")).exists()).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("config.source 缺失 → {error} 兜底(CLI 层已前置拦截)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-next-"))
    try {
      await saveProjectConfig(dir, { ...CONFIG_DEFAULTS, mode: "migrate", phases: "admtvk", autoNumber: true })
      mkdirSync(join(dir, ".auto"), { recursive: true })
      writeFileSync(join(dir, ".auto/tool.json"), JSON.stringify({ round: 1, done: true }))
      const result = await prepareNextRound(dir, await loadProjectConfig(dir), "src/new.ts")
      expect((result as { error: string }).error).toContain("迁移源")
      expect(await readToolState(dir)).toEqual({ round: 1, done: true })
      expect((await loadProjectConfig(dir)).source).toBeUndefined()
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
