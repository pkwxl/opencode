import { describe, expect, test } from "bun:test"
import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { roundDir } from "../src/docpaths"
import { parse } from "../src/plan"
import {
  appendLedger,
  currentRound,
  establishRound,
  formatPhases,
  handoverDoc,
  legacyHandoverDoc,
  legacyPhaseArchive,
  legacyPhaseDocsDir,
  nextRound,
  phaseDocsDir,
  parsePhases,
  phaseArchive,
  phaseText,
  prevRoundDigest,
  readLedger,
  renderPlanScaffold,
  routePhase,
  validHandover,
  type Phase,
} from "../src/phases"

describe("parsePhases", () => {
  test("admtvk 的子序列且含 m → 按给出顺序返回", () => {
    expect(parsePhases("m")).toEqual<Phase[]>(["m"])
    expect(parsePhases("amt")).toEqual<Phase[]>(["a", "m", "t"])
    expect(parsePhases("admtvk")).toEqual<Phase[]>(["a", "d", "m", "t", "v", "k"])
    expect(parsePhases("dmvk")).toEqual<Phase[]>(["d", "m", "v", "k"])
  })

  test("非法取值 → null(乱序/缺 m/越界字母/重复/空串)", () => {
    for (const raw of ["", "tma", "adk", "mm", "ama", "mx", "M", "amtkv ", "admtvkx"]) {
      expect(parsePhases(raw)).toBeNull()
    }
  })
})

test("phaseText 六阶段中文名", () => {
  expect(phaseText("a")).toBe("分析")
  expect(phaseText("d")).toBe("设计")
  expect(phaseText("m")).toBe("迁移实现")
  expect(phaseText("t")).toBe("测试")
  expect(phaseText("v")).toBe("验收")
  expect(phaseText("k")).toBe("知识提炼")
})

describe("readLedger(阶段台账 docs/phases.md)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-phases-"))
  }

  function writeLedger(dir: string, text: string) {
    mkdirSync(join(dir, "docs"), { recursive: true })
    writeFileSync(join(dir, "docs", "phases.md"), text)
  }

  test("文件缺失 → 空台账(流程尚未开始)", async () => {
    const dir = tempDir()
    try {
      expect(await readLedger(dir)).toEqual({ done: [] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("解析完成字母,容忍空行/标题/注释;新旧两种交接指针形态均命中", async () => {
    const dir = tempDir()
    try {
      writeLedger(
        dir,
        [
          "# 阶段台账(opencode-auto 维护;人工修订见设计文档 C.3)",
          "",
          "# 注释行同样容忍",
          "- [done] a 分析 → docs/phases/a-analysis/(交接: docs/handovers/R1-a-analysis.md)",
          "",
          // P2 前旧行: 交接指针指向归档目录内 handover.md
          "- [done] d 设计 → docs/phases/d-design/(交接: docs/phases/d-design/handover.md)",
        ].join("\n"),
      )
      expect((await readLedger(dir)).done).toEqual<Phase[]>(["a", "d"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("协议行无法解析 / 字母越界 / 重复 → throw 给人工修订指引", async () => {
    const dir = tempDir()
    try {
      const bad = [
        "- [done] a", // 缺名称与归档目录
        "- [done] x 设计 → docs/phases/x-design/", // 字母越界
        "- [in-progress] m 迁移 → docs/phases/m-migrate/", // 未知状态
        "随便一行",
      ]
      for (const line of bad) {
        writeLedger(dir, line + "\n")
        await expect(readLedger(dir)).rejects.toThrow(/docs\/phases\.md/)
      }
      writeLedger(dir, "- [done] a 分析 → docs/phases/a-analysis/\n- [done] a 分析 → docs/phases/a-analysis/\n")
      await expect(readLedger(dir)).rejects.toThrow(/重复|无法解析/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  test("新布局: 轮目录存在时台账读轮内 docs/R-NN/phases.md,根旧台账不再是本轮状态", async () => {
    const dir = tempDir()
    try {
      // 旧布局根台账(存量读回落源,原地保留)
      writeLedger(dir, "- [done] a 分析 → docs/phases/a-analysis/\n")
      expect((await readLedger(dir)).done).toEqual<Phase[]>(["a"])
      // 轮首建立 R-01 后: 本轮台账 = 轮内 phases.md(缺失 = 空台账,不回落根旧台账)
      mkdirSync(join(dir, "docs/R-01"), { recursive: true })
      expect(await readLedger(dir)).toEqual({ done: [] })
      writeFileSync(join(dir, "docs/R-01/phases.md"), "# 阶段台账\n\n- [done] m 迁移实现 → docs/R-01/m-migrate/\n")
      expect((await readLedger(dir)).done).toEqual<Phase[]>(["m"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("appendLedger(台账写入)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-phases-"))
  }

  test("文件缺失 → 带头部注释创建;已有台账 → 末尾追加(交接指针 = 本轮永久路径);readLedger 往返", async () => {
    const dir = tempDir()
    try {
      await appendLedger(dir, "a")
      const text = await Bun.file(join(dir, "docs/phases.md")).text()
      expect(text).toContain("# 阶段台账")
      expect(text).toContain(`- [done] a 分析 → docs/phases/a-analysis/(交接: ${legacyHandoverDoc(1, "a")})`)
      expect((await readLedger(dir)).done).toEqual<Phase[]>(["a"])
      await appendLedger(dir, "d")
      expect((await readLedger(dir)).done).toEqual<Phase[]>(["a", "d"])
      const again = await Bun.file(join(dir, "docs/phases.md")).text()
      expect(again.split("- [done]").length - 1).toBe(2)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("新布局: 写入轮内 docs/R-NN/phases.md,行内归档目录与交接指针同为轮内路径", async () => {
    const dir = tempDir()
    try {
      await establishRound(dir)
      await appendLedger(dir, "a")
      const text = await Bun.file(join(dir, "docs/R-01/phases.md")).text()
      expect(text).toContain("- [done] a 分析 → docs/R-01/a-analysis/(交接: docs/R-01/handovers/a-analysis.md)")
      // 根旧台账不被触碰
      expect(await Bun.file(join(dir, "docs/phases.md")).exists()).toBe(false)
      expect((await readLedger(dir)).done).toEqual<Phase[]>(["a"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("查重幂等: 已记录的阶段重复追加为 no-op", async () => {
    const dir = tempDir()
    try {
      await appendLedger(dir, "m")
      await appendLedger(dir, "m")
      expect((await readLedger(dir)).done).toEqual<Phase[]>(["m"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("routePhase(阶段路由,D.2)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-phases-"))
  }

  function planOf(text: string) {
    return parse("PLAN.md", text)
  }

  const EMPTY = "# 实施计划\n"
  const PENDING = "## T-001: 任务 [pending]\n正文\n"
  const DONE = "## T-001: 任务 [done]\n正文\n"

  test("PLAN 空 → plan;有未完成任务 → execute;全 done → handover", async () => {
    const dir = tempDir()
    try {
      expect(await routePhase(dir, planOf(EMPTY), "amt")).toEqual({ type: "plan", phase: "a" })
      expect(await routePhase(dir, planOf(PENDING), "amt")).toEqual({ type: "execute", phase: "a" })
      expect(await routePhase(dir, planOf(DONE), "amt")).toEqual({ type: "handover", phase: "a" })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("台账推导: 前序已完成 → 当前阶段推进;全部完成 → complete", async () => {
    const dir = tempDir()
    try {
      writeLedgerText(dir, ["- [done] a 分析 → docs/phases/a-analysis/", "- [done] m 迁移实现 → docs/phases/m-migrate/"].join("\n") + "\n")
      expect(await routePhase(dir, planOf(EMPTY), "amt")).toEqual({ type: "plan", phase: "t" })
      expect(await routePhase(dir, planOf(PENDING), "amt")).toEqual({ type: "execute", phase: "t" })
      writeLedgerText(dir, ["- [done] a 分析 → docs/phases/a-analysis/", "- [done] m 迁移实现 → docs/phases/m-migrate/", "- [done] t 测试 → docs/phases/t-testing/"].join("\n") + "\n")
      expect(await routePhase(dir, planOf(EMPTY), "amt")).toEqual({ type: "complete" })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("台账行非法 / 含 phases 外字母 → blocked(环境错误,报文给人工修订指引)", async () => {
    const dir = tempDir()
    try {
      writeLedgerText(dir, "随便一行\n")
      const broken = await routePhase(dir, planOf(EMPTY), "amt")
      expect(broken.type).toBe("blocked")
      if (broken.type === "blocked") expect(broken.reason).toContain("docs/phases.md")
      // phases "amt" 而台账记录了 k → blocked
      writeLedgerText(dir, "- [done] k 知识提炼 → docs/phases/k-knowledge/\n")
      const outside = await routePhase(dir, planOf(EMPTY), "amt")
      expect(outside.type).toBe("blocked")
      if (outside.type === "blocked") expect(outside.reason).toContain("k")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function writeLedgerText(dir: string, text: string) {
    mkdirSync(join(dir, "docs"), { recursive: true })
    writeFileSync(join(dir, "docs/phases.md"), text)
  }
})

describe("formatPhases(阶段进度行)", () => {
  test("✓=台账已记录,▶=当前阶段,其余=未开始", () => {
    expect(formatPhases("amt", [])).toBe("a▶ m t")
    expect(formatPhases("amt", ["a"])).toBe("a✓ m▶ t")
    expect(formatPhases("amt", ["a", "m", "t"])).toBe("a✓ m✓ t✓")
    expect(formatPhases("admtvk", ["a", "d"])).toBe("a✓ d✓ m▶ t v k")
    expect(formatPhases("m", [])).toBe("m▶")
  })
})

describe("阶段空模板(renderPlanScaffold)", () => {
  test("不含任何任务(routePhase 据此推导 plan 路由),verify 条件渲染", () => {
    for (const verify of [true, false]) {
      const text = renderPlanScaffold(verify)
      expect(parse("PLAN.md", text).tasks).toEqual([])
      expect(text).not.toMatch(/\{\{|\}\}/)
    }
    expect(renderPlanScaffold(true)).toContain("verify 字段")
    expect(renderPlanScaffold(false)).not.toContain("verify")
  })
})

describe("归档目录与交接文档协议(布局感知: docs/R-NN/ 存在 = 轮内路径,否则旧布局读回落)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-phases-"))
  }

  test("phaseArchive 六阶段目录名(旧布局 docs/phases/<字母>-<slug>/)", async () => {
    const dir = tempDir()
    try {
      expect(await phaseArchive(dir, 1, "a")).toBe("docs/phases/a-analysis")
      expect(await phaseArchive(dir, 1, "d")).toBe("docs/phases/d-design")
      expect(await phaseArchive(dir, 1, "m")).toBe("docs/phases/m-migrate")
      expect(await phaseArchive(dir, 1, "t")).toBe("docs/phases/t-testing")
      expect(await phaseArchive(dir, 1, "v")).toBe("docs/phases/v-acceptance")
      expect(await phaseArchive(dir, 1, "k")).toBe("docs/phases/k-knowledge")
      expect(legacyPhaseArchive("m")).toBe("docs/phases/m-migrate")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("handoverDoc/phaseDocsDir 旧布局: docs/handovers/R<N>-<字母>-<slug>.md 与 docs/phase-docs/R<N>-<字母>-<slug>/", async () => {
    const dir = tempDir()
    try {
      expect(await handoverDoc(dir, 1, "a")).toBe("docs/handovers/R1-a-analysis.md")
      expect(await handoverDoc(dir, 2, "m")).toBe("docs/handovers/R2-m-migrate.md")
      expect(await handoverDoc(dir, 12, "k")).toBe("docs/handovers/R12-k-knowledge.md")
      expect(legacyHandoverDoc(3, "t")).toBe("docs/handovers/R3-t-testing.md")
      expect(await phaseDocsDir(dir, 1, "a")).toBe("docs/phase-docs/R1-a-analysis")
      expect(await phaseDocsDir(dir, 12, "k")).toBe("docs/phase-docs/R12-k-knowledge")
      expect(legacyPhaseDocsDir(3, "m")).toBe("docs/phase-docs/R3-m-migrate")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("新布局(轮目录已建): 轮内路径,文件名去 R<N>- 前缀", async () => {
    const dir = tempDir()
    try {
      mkdirSync(join(dir, "docs/R-02"), { recursive: true })
      expect(await phaseArchive(dir, 2, "a")).toBe("docs/R-02/a-analysis")
      expect(await handoverDoc(dir, 2, "m")).toBe("docs/R-02/handovers/m-migrate.md")
      expect(await phaseDocsDir(dir, 2, "k")).toBe("docs/R-02/phase-docs/k-knowledge")
      // 其他轮次(目录未建)仍按旧布局解析——混合项目逐轮独立
      expect(await handoverDoc(dir, 1, "a")).toBe("docs/handovers/R1-a-analysis.md")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("validHandover(蒸馏会话产物校验,交接蒸馏受阻路径的判定依据)", () => {
  const HANDOVER = [
    "# a 分析 阶段交接",
    "",
    "## 关键决策",
    "- 决策甲",
    "",
    "## 约束与坑",
    "- 坑乙",
    "",
    "## 下一阶段必读清单",
    "- docs/analysis/baseline.md: 行为基线",
    "",
    "## 产物索引",
    "- docs/analysis/: 分析产物",
  ].join("\n")

  test("四小节齐备(标题行逐字匹配,容忍行首空白)→ 有效", () => {
    expect(validHandover(HANDOVER)).toBe(true)
    expect(validHandover(HANDOVER.replace("## 关键决策", "   ## 关键决策"))).toBe(true)
  })

  test("缺任一小节 / 标题被改写 / 空文档 → 无效(蒸馏产物缺失走隐性阻塞)", () => {
    for (const bad of [
      HANDOVER.replace("## 约束与坑", "## 约束与陷阱"),
      HANDOVER.replace("## 产物索引\n- docs/analysis/: 分析产物", ""),
      "",
    ]) {
      expect(validHandover(bad)).toBe(false)
    }
    // 次级标题不算数: "### 关键决策"包含协议子串但不是逐字的 ## 标题行
    expect(validHandover(HANDOVER.replace(/^## /gm, "### "))).toBe(false)
  })
})

describe("轮次(M 节 + 轮次专用目录方案): currentRound / nextRound / establishRound / prevRoundDigest", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-phases-"))
  }

  async function exists(path: string) {
    return await Bun.file(path).exists()
  }

  function isLink(path: string) {
    return lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() ?? false
  }

  // 伪造旧布局一轮已完成的现场: 根台账(交接指针指向 handovers/)+ 阶段归档
  // 目录(仅 PLAN 快照)+ 永久交接文档 + 永久知识文档 + 轮末根 PLAN 与根 AGENTS.md。
  function seedFinishedLegacyRound(dir: string) {
    mkdirSync(join(dir, "docs"), { recursive: true })
    writeFileSync(
      join(dir, "docs/phases.md"),
      `# 阶段台账\n\n- [done] a 分析 → docs/phases/a-analysis/(交接: ${legacyHandoverDoc(1, "a")})\n- [done] m 迁移实现 → docs/phases/m-migrate/(交接: ${legacyHandoverDoc(1, "m")})\n`,
    )
    mkdirSync(join(dir, "docs/handovers"), { recursive: true })
    writeFileSync(join(dir, "docs/handovers/R1-a-analysis.md"), "# a 分析 阶段交接\n\n## 关键决策\n- 决策甲\n")
    writeFileSync(join(dir, "docs/handovers/R1-m-migrate.md"), "# m 迁移实现 阶段交接\n\n## 关键决策\n- 迁移决策乙\n")
    mkdirSync(join(dir, "docs/phases/a-analysis"), { recursive: true })
    writeFileSync(join(dir, "docs/phases/a-analysis/PLAN.md"), "# 阶段计划 a\n")
    mkdirSync(join(dir, "docs/phases/m-migrate"), { recursive: true })
    writeFileSync(join(dir, "docs/phases/m-migrate/PLAN.md"), "# 阶段计划 m\n")
    mkdirSync(join(dir, "docs/migration-kb"), { recursive: true })
    writeFileSync(join(dir, "docs/migration-kb/R1-migration-2026.md"), "# 迁移知识\n\nAPI 映射结论。")
    writeFileSync(join(dir, "PLAN.md"), "## T-001: 轮后手工任务 [pending]\n正文\n")
    writeFileSync(join(dir, "AGENTS.md"), "# AGENTS\n\n工作流入口\n")
  }

  test("currentRound: 全新 = 1;R 系目录最大号(无 +1);无 R 系回落旧语义 round-<N> + 1;混合自然续号", async () => {
    const dir = tempDir()
    try {
      expect(await currentRound(dir)).toBe(1)
      mkdirSync(join(dir, "docs/phases/round-1"), { recursive: true })
      expect(await currentRound(dir)).toBe(2)
      mkdirSync(join(dir, "docs/phases/round-3"), { recursive: true })
      expect(await currentRound(dir)).toBe(4)
      // 混合项目: 旧 round-1..3 归档 + 新 R-04 → R 系优先,当前轮 = 4(无 +1)
      mkdirSync(join(dir, "docs/R-04"), { recursive: true })
      expect(await currentRound(dir)).toBe(4)
      mkdirSync(join(dir, "docs/R-07"), { recursive: true })
      expect(await currentRound(dir)).toBe(7)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("nextRound: 轮次占用判定(R 系目录 / 旧布局根台账)→ 当前轮 + 1;皆无 = 当前推导值", async () => {
    const dir = tempDir()
    try {
      expect(await nextRound(dir)).toBe(1)
      // 旧布局: round-1..4 归档(台账已随归档搬离)→ 第 5 轮
      for (const n of [1, 2, 3, 4]) mkdirSync(join(dir, `docs/phases/round-${n}`), { recursive: true })
      expect(await nextRound(dir)).toBe(5)
      // 旧布局本轮已开工(根台账存在)→ 下一轮
      writeFileSync(join(dir, "docs/phases.md"), "# 阶段台账\n\n- [done] a 分析 → docs/phases/a-analysis/\n")
      expect(await currentRound(dir)).toBe(5)
      expect(await nextRound(dir)).toBe(6)
      // 新布局: R-06 已建 → 第 7 轮
      mkdirSync(join(dir, "docs/R-06"), { recursive: true })
      expect(await nextRound(dir)).toBe(7)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("establishRound: 建轮目录 + 轮内 PLAN 空模板 + 根符号链接 + AGENTS.md.bak 快照", async () => {
    const dir = tempDir()
    try {
      writeFileSync(join(dir, "AGENTS.md"), "# AGENTS\n\n工作流入口\n")
      const result = await establishRound(dir, { verify: true })
      expect(result).toEqual({ round: 1, root: roundDir(1), linked: true })
      // 轮内 PLAN.md 为空模板(无任务),根 PLAN.md 是指向它的相对符号链接
      expect(parse("PLAN.md", await Bun.file(join(dir, "docs/R-01/PLAN.md")).text()).tasks).toEqual([])
      expect(isLink(join(dir, "PLAN.md"))).toBe(true)
      expect(readlinkSync(join(dir, "PLAN.md"))).toBe(join("docs", "R-01", "PLAN.md"))
      // 经链接读写落轮内(单一事实源)
      writeFileSync(join(dir, "PLAN.md"), "## T-001: 任务 [pending]\n正文\n")
      expect(await Bun.file(join(dir, "docs/R-01/PLAN.md")).text()).toContain("T-001")
      // AGENTS.md 快照改名 .bak(不当指令加载),根文件保留
      expect(await Bun.file(join(dir, "docs/R-01/AGENTS.md.bak")).text()).toContain("工作流入口")
      expect(await exists(join(dir, "AGENTS.md"))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("establishRound 模式互切: 根既有普通 PLAN.md 内容拷贝为 R-01/PLAN.md 初值后根改链接", async () => {
    const dir = tempDir()
    try {
      writeFileSync(join(dir, "PLAN.md"), "## T-003: 人工任务 [pending]\n正文\n")
      const result = await establishRound(dir)
      expect(result.round).toBe(1)
      expect(await Bun.file(join(dir, "docs/R-01/PLAN.md")).text()).toContain("T-003")
      expect(isLink(join(dir, "PLAN.md"))).toBe(true)
      expect(parse("PLAN.md", await Bun.file(join(dir, "PLAN.md")).text()).tasks[0]!.id).toBe("T-003")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("establishRound 幂等续跑: 轮目录已存在不重写既有内容,链接重建;显式轮号开新一轮", async () => {
    const dir = tempDir()
    try {
      await establishRound(dir)
      writeFileSync(join(dir, "docs/R-01/PLAN.md"), "## T-001: 已填任务 [pending]\n")
      // 幂等: 重复建立当前轮不重写轮内 PLAN
      const again = await establishRound(dir)
      expect(again.round).toBe(1)
      expect(await Bun.file(join(dir, "docs/R-01/PLAN.md")).text()).toContain("已填任务")
      expect(isLink(join(dir, "PLAN.md"))).toBe(true)
      // 新一轮: 显式轮号(nextRound)
      const next = await establishRound(dir, { round: await nextRound(dir) })
      expect(next.round).toBe(2)
      expect(readlinkSync(join(dir, "PLAN.md"))).toBe(join("docs", "R-02", "PLAN.md"))
      expect(await currentRound(dir)).toBe(2)
      // 上一轮内容不受影响(落盘即永久)
      expect(await Bun.file(join(dir, "docs/R-01/PLAN.md")).text()).toContain("已填任务")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("prevRoundDigest(新布局): 轮内归档索引 + 最终交接 + 轮内 migration-kb.md;空白轮 → undefined", async () => {
    const fresh = tempDir()
    try {
      expect(await prevRoundDigest(fresh)).toBeUndefined()
    } finally {
      rmSync(fresh, { recursive: true, force: true })
    }
    const dir = tempDir()
    try {
      // R-01 完成的轮: 轮内台账/阶段归档/交接/知识;R-02 已建(新一轮开工)
      mkdirSync(join(dir, "docs/R-01/a-analysis"), { recursive: true })
      mkdirSync(join(dir, "docs/R-01/m-migrate"), { recursive: true })
      mkdirSync(join(dir, "docs/R-01/handovers"), { recursive: true })
      writeFileSync(join(dir, "docs/R-01/phases.md"), "# 阶段台账\n\n- [done] a 分析 → docs/R-01/a-analysis/\n- [done] m 迁移实现 → docs/R-01/m-migrate/\n")
      writeFileSync(join(dir, "docs/R-01/handovers/a-analysis.md"), "# a 分析 阶段交接\n\n## 关键决策\n- 决策甲\n")
      writeFileSync(join(dir, "docs/R-01/handovers/m-migrate.md"), "# m 迁移实现 阶段交接\n\n## 关键决策\n- 迁移决策乙\n")
      writeFileSync(join(dir, "docs/R-01/migration-kb.md"), "# 迁移知识\n\nAPI 映射结论。")
      mkdirSync(join(dir, "docs/R-02"), { recursive: true })
      const digest = await prevRoundDigest(dir)
      expect(digest).toBeDefined()
      expect(digest).toContain("### 上一轮(第 1 轮)阶段归档索引(docs/R-01/)")
      expect(digest).toContain("- docs/R-01/a-analysis/")
      expect(digest).toContain("### 上一轮最终交接(docs/R-01/handovers/m-migrate.md)")
      expect(digest).toContain("迁移决策乙")
      expect(digest).not.toContain("决策甲") // 仅注入最终交接
      expect(digest).toContain("### 上一轮迁移知识(docs/R-01/migration-kb.md)")
      expect(digest).toContain("API 映射结论。")
      // 空白轮目录(只有目录、无内容)→ undefined
      const bare = tempDir()
      try {
        mkdirSync(join(bare, "docs/R-01"), { recursive: true })
        mkdirSync(join(bare, "docs/R-02"), { recursive: true })
        expect(await prevRoundDigest(bare)).toBeUndefined()
      } finally {
        rmSync(bare, { recursive: true, force: true })
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("prevRoundDigest(旧布局读回落): 归档索引 + 最终交接(永久路径)+ R<N>- 前缀知识", async () => {
    const dir = tempDir()
    try {
      seedFinishedLegacyRound(dir)
      // 旧布局轮末: 台账/阶段归档/PLAN 已在 docs/phases/round-1/(旧机制归档动作的结果)
      mkdirSync(join(dir, "docs/phases/round-1"), { recursive: true })
      for (const name of ["phases.md", "a-analysis", "m-migrate"]) {
        const from = join(dir, name === "phases.md" ? "docs/phases.md" : join("docs/phases", name))
        const to = join(dir, "docs/phases/round-1", name)
        renameSync(from, to)
      }
      rmSync(join(dir, "PLAN.md"))
      const digest = await prevRoundDigest(dir)
      expect(digest).toBeDefined()
      // 归档索引: 各阶段归档目录
      expect(digest).toContain("### 上一轮(第 1 轮)阶段归档索引")
      expect(digest).toContain("- docs/phases/round-1/a-analysis/")
      // 最终交接: 台账最后一个完成阶段(m)的交接文档全文,自永久路径读取
      expect(digest).toContain("### 上一轮最终交接(docs/handovers/R1-m-migrate.md)")
      expect(digest).toContain("迁移决策乙")
      expect(digest).not.toContain("决策甲") // 仅注入最终交接,a 阶段交接不整篇注入
      // 迁移知识: 永久路径的 R1- 前缀文档全文
      expect(digest).toContain("### 上一轮迁移知识(docs/migration-kb/R1-migration-2026.md)")
      expect(digest).toContain("API 映射结论。")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("prevRoundDigest 混合布局: 当前轮 R-02(新),上一轮 round-1(旧归档)照常摘录", async () => {
    const dir = tempDir()
    try {
      seedFinishedLegacyRound(dir)
      mkdirSync(join(dir, "docs/phases/round-1"), { recursive: true })
      for (const name of ["phases.md", "a-analysis", "m-migrate"]) {
        const from = join(dir, name === "phases.md" ? "docs/phases.md" : join("docs/phases", name))
        renameSync(from, join(dir, "docs/phases/round-1", name))
      }
      rmSync(join(dir, "PLAN.md"))
      mkdirSync(join(dir, "docs/R-02"), { recursive: true })
      expect(await currentRound(dir)).toBe(2)
      const digest = await prevRoundDigest(dir)
      expect(digest).toContain("### 上一轮(第 1 轮)阶段归档索引(docs/phases/round-1/)")
      expect(digest).toContain("迁移决策乙")
      expect(digest).toContain("API 映射结论。")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("prevRoundDigest 知识收集按前缀筛选: 只收 R<prev>- 与无前缀存量,前几轮 R<M>- 不收", async () => {
    const dir = tempDir()
    try {
      mkdirSync(join(dir, "docs/phases/round-1"), { recursive: true })
      mkdirSync(join(dir, "docs/phases/round-2"), { recursive: true })
      mkdirSync(join(dir, "docs/phases/round-3"), { recursive: true })
      writeFileSync(join(dir, "docs/phases/round-3/phases.md"), "# 台账\n\n- [done] m 迁移实现 → docs/phases/m-migrate/\n")
      mkdirSync(join(dir, "docs/migration-kb"), { recursive: true })
      writeFileSync(join(dir, "docs/migration-kb/R1-migration-a.md"), "# 第 1 轮知识\n\n旧轮结论。")
      writeFileSync(join(dir, "docs/migration-kb/R3-migration-b.md"), "# 第 3 轮知识\n\n本轮结论。")
      writeFileSync(join(dir, "docs/migration-kb/migration-legacy.md"), "# 无前缀存量\n\n宽松归入上一轮。")
      writeFileSync(join(dir, "docs/migration-kb/notes.txt"), "非 md 不算")
      const digest = await prevRoundDigest(dir)
      expect(digest).toContain("### 上一轮迁移知识(docs/migration-kb/R3-migration-b.md)")
      expect(digest).toContain("本轮结论。")
      expect(digest).toContain("### 上一轮迁移知识(docs/migration-kb/migration-legacy.md)")
      expect(digest).not.toContain("R1-migration-a.md")
      expect(digest).not.toContain("旧轮结论。")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("prevRoundDigest 读回落(P2 前布局): 交接与知识在轮归档目录内仍可收集", async () => {
    const dir = tempDir()
    try {
      // P2 前完成的一轮: handover.md 与 migration-kb/ 都在归档目录内
      mkdirSync(join(dir, "docs/phases/round-1/m-migrate/migration-kb"), { recursive: true })
      writeFileSync(join(dir, "docs/phases/round-1/phases.md"), "# 台账\n\n- [done] a 分析 → docs/phases/a-analysis/\n- [done] m 迁移实现 → docs/phases/m-migrate/\n")
      writeFileSync(join(dir, "docs/phases/round-1/m-migrate/handover.md"), "# m 迁移实现 阶段交接\n\n## 关键决策\n- 归档内交接结论\n")
      writeFileSync(join(dir, "docs/phases/round-1/m-migrate/migration-kb/migration-2026.md"), "# 迁移知识\n\n归档内知识结论。")
      const digest = await prevRoundDigest(dir)
      expect(digest).toContain("### 上一轮最终交接(docs/handovers/R1-m-migrate.md)")
      expect(digest).toContain("归档内交接结论")
      expect(digest).toContain("### 上一轮迁移知识(docs/phases/round-1/m-migrate/migration-kb/migration-2026.md)")
      expect(digest).toContain("归档内知识结论。")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
