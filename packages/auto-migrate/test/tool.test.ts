import { describe, expect, test } from "bun:test"
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CONFIG_DEFAULTS, loadProjectConfig, saveProjectConfig } from "@opencode-ai/auto-core/config"
import { effectivePhases, parseInferOutput, prepareNextRound, readToolState } from "../src/tool"

describe("effectivePhases(生效流程: 标记固化值 → config.phases)", () => {
  test("固化值优先(须为合法流程串);非法固化值/缺失回落 config.phases", () => {
    expect(effectivePhases("mtvk", "admtvk", ["m"])).toBe("mtvk")
    expect(effectivePhases("admtvk", "mtvk", ["a", "d", "m", "t"])).toBe("admtvk")
    expect(effectivePhases("garbage", "mtvk", [])).toBe("mtvk")
    expect(effectivePhases(undefined, "admtvk", [])).toBe("admtvk")
  })

  test("台账已完成阶段必须落在流程内: 裁剪低于进度 → 钳制回完整流程", () => {
    // 固化值/配置值裁掉了台账已推进的 a/d → 不得裁剪,否则 routePhase 越界拦截
    expect(effectivePhases("mtvk", "mtvk", ["a", "d", "m", "t"])).toBe("admtvk")
    expect(effectivePhases(undefined, "mtvk", ["a"])).toBe("admtvk")
    // 正常裁剪轮续跑: 台账进度在流程内,沿用
    expect(effectivePhases(undefined, "mtvk", ["m"])).toBe("mtvk")
    expect(effectivePhases("mtvk", "admtvk", ["m", "t"])).toBe("mtvk")
  })
})

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

  test("{round:N, phases} 本轮标记原样读回(未完成)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-tool-"))
    try {
      mkdirSync(join(dir, ".auto"), { recursive: true })
      writeFileSync(join(dir, ".auto/tool.json"), JSON.stringify({ round: 2, phases: "mtvk" }))
      expect(await readToolState(dir)).toEqual({ round: 2, phases: "mtvk" })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("prepareNextRound(--next-path 轮间过渡: 轮首建立 docs/R-NN)", () => {
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

  test("完成态: 修订 source.path + 建新轮目录 R-NN + 根 PLAN.md 重指轮内 + 写本轮标记;历轮文档原地保留", async () => {
    const dir = await seedDir()
    try {
      mkdirSync(join(dir, ".auto"), { recursive: true })
      writeFileSync(join(dir, ".auto/tool.json"), JSON.stringify({ round: 1, phases: "admtvk", done: true }))
      writeFileSync(join(dir, ".auto/infer.json"), "{}")
      mkdirSync(join(dir, "docs/prior-kb"), { recursive: true })
      writeFileSync(join(dir, "docs/prior-kb/R1-prior-x.md"), "旧知识")
      mkdirSync(join(dir, "docs/phases/round-1"), { recursive: true })
      writeFileSync(join(dir, "docs/phases/round-1/PLAN.md"), "# 旧轮")
      writeFileSync(join(dir, "AGENTS.md"), "# 项目约定\n")
      expect(await prepareNextRound(dir, await loadProjectConfig(dir), "src/new.ts")).toBe(0)
      // 配置: 仅 source.path 修订,dir 与其余键不动
      expect(await loadProjectConfig(dir)).toMatchObject({ source: { dir: "legacy", path: "src/new.ts" }, destDir: "target" })
      // 历轮文档不搬移(落盘即永久): 旧平铺 prior-kb 与旧布局轮次归档原地保留
      expect(await Bun.file(join(dir, "docs/prior-kb/R1-prior-x.md")).text()).toBe("旧知识")
      expect(readdirSync(join(dir, "docs/phases/round-1"))).toEqual(["PLAN.md"])
      // 轮首建立: 旧布局 round-1 归档在 → 新一轮 = R-02;轮内 PLAN.md 为空模板,
      // 根 PLAN.md 是指向轮内的相对符号链接,AGENTS.md 快照落轮内 .bak
      expect(readdirSync(join(dir, "docs/R-02")).sort()).toEqual(["AGENTS.md.bak", "PLAN.md"])
      const roundPlan = await Bun.file(join(dir, "docs/R-02/PLAN.md")).text()
      expect(roundPlan).toContain("阶段规划会话")
      expect(roundPlan).not.toContain("## T-")
      expect(lstatSync(join(dir, "PLAN.md")).isSymbolicLink()).toBe(true)
      expect(readFileSync(join(dir, "PLAN.md"), "utf8")).toBe(roundPlan)
      expect(await Bun.file(join(dir, "docs/R-02/AGENTS.md.bak")).text()).toBe("# 项目约定\n")
      // 陈旧推断产物已清;本轮标记 = 新轮号(done 已随覆写清除)
      expect(await Bun.file(join(dir, ".auto/infer.json")).exists()).toBe(false)
      expect(await readToolState(dir)).toEqual({ round: 2 })
      // §2.2 时序: 过渡成功后(新标记已建、未 done)带参重跑被严格拒绝(进行中形态)
      const again = await prepareNextRound(dir, await loadProjectConfig(dir), "src/new.ts")
      expect((again as { error: string }).error).toContain("断点续跑")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("phases 覆盖(与 --next-path 同给的 --phases)随本轮标记固化;缺省不含 phases 键", async () => {
    const dir = await seedDir()
    try {
      mkdirSync(join(dir, ".auto"), { recursive: true })
      writeFileSync(join(dir, ".auto/tool.json"), JSON.stringify({ round: 1, done: true }))
      expect(await prepareNextRound(dir, await loadProjectConfig(dir), "src/new.ts", "mtvk")).toBe(0)
      expect(await readToolState(dir)).toEqual({ round: 1, phases: "mtvk" })
      // 新布局首轮 = R-01(无任何旧轮次目录),config.phases 不被过渡改动
      expect(lstatSync(join(dir, "docs/R-01")).isDirectory()).toBe(true)
      expect((await loadProjectConfig(dir)).phases).toBe("admtvk")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("新布局续号: R-02 完成 → 新一轮建 R-03;轮号口径 = R 系目录最大号 + 1", async () => {
    const dir = await seedDir()
    try {
      mkdirSync(join(dir, ".auto"), { recursive: true })
      writeFileSync(join(dir, ".auto/tool.json"), JSON.stringify({ round: 2, phases: "admtvk", done: true }))
      mkdirSync(join(dir, "docs/R-02"), { recursive: true })
      writeFileSync(join(dir, "docs/R-02/PLAN.md"), "# 第 2 轮\n")
      expect(await prepareNextRound(dir, await loadProjectConfig(dir), "src/new.ts")).toBe(0)
      expect(lstatSync(join(dir, "docs/R-03")).isDirectory()).toBe(true)
      expect(await readToolState(dir)).toEqual({ round: 3 })
      // 上轮轮内文档原地保留
      expect(await Bun.file(join(dir, "docs/R-02/PLAN.md")).text()).toBe("# 第 2 轮\n")
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
      // 拒绝路径零副作用: 配置与状态原样,不建轮目录
      expect(await loadProjectConfig(dir)).toMatchObject({ source: { dir: "legacy", path: "src/old.ts" } })
      expect(await readToolState(dir)).toEqual({ round: 3 })
      expect(await Bun.file(join(dir, "docs")).exists()).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("round 缺失({done:true} 无轮次号)同样成功: 轮号由 docs/ 推导(全新目录 = R-01)", async () => {
    const dir = await seedDir()
    try {
      mkdirSync(join(dir, ".auto"), { recursive: true })
      writeFileSync(join(dir, ".auto/tool.json"), JSON.stringify({ done: true }))
      mkdirSync(join(dir, "docs/prior-kb"), { recursive: true })
      writeFileSync(join(dir, "docs/prior-kb/prior-a.md"), "知识甲")
      expect(await prepareNextRound(dir, await loadProjectConfig(dir), "src/new.ts")).toBe(0)
      expect(await Bun.file(join(dir, "docs/prior-kb/prior-a.md")).text()).toBe("知识甲")
      expect(lstatSync(join(dir, "docs/R-01")).isDirectory()).toBe(true)
      expect(await readToolState(dir)).toEqual({ round: 1 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("config.source 缺失 → {error} 兜底(CLI 层已前置拦截),零写盘", async () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-next-"))
    try {
      await saveProjectConfig(dir, { ...CONFIG_DEFAULTS, mode: "migrate", phases: "admtvk", autoNumber: true })
      mkdirSync(join(dir, ".auto"), { recursive: true })
      writeFileSync(join(dir, ".auto/tool.json"), JSON.stringify({ round: 1, done: true }))
      const result = await prepareNextRound(dir, await loadProjectConfig(dir), "src/new.ts")
      expect((result as { error: string }).error).toContain("迁移源")
      expect(await readToolState(dir)).toEqual({ round: 1, done: true })
      expect((await loadProjectConfig(dir)).source).toBeUndefined()
      expect(await Bun.file(join(dir, "docs")).exists()).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
