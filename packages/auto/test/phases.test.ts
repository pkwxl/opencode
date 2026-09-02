import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse } from "../src/plan"
import {
  appendLedger,
  archivePhaseDocs,
  archiveRound,
  currentRound,
  formatPhases,
  parsePhases,
  phaseArchive,
  phaseText,
  prevRoundDigest,
  readLedger,
  renderPlanScaffold,
  routePhase,
  snapshotDocs,
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

  test("解析完成字母,容忍空行/标题/注释", async () => {
    const dir = tempDir()
    try {
      writeLedger(
        dir,
        [
          "# 阶段台账(opencode-auto 维护;人工修订见设计文档 C.3)",
          "",
          "# 注释行同样容忍",
          "- [done] a 分析 → docs/phases/a-analysis/(交接: docs/phases/a-analysis/handover.md)",
          "",
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
})

describe("appendLedger(台账写入)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-phases-"))
  }

  test("文件缺失 → 带头部注释创建;已有台账 → 末尾追加;readLedger 往返", async () => {
    const dir = tempDir()
    try {
      await appendLedger(dir, "a")
      const text = await Bun.file(join(dir, "docs/phases.md")).text()
      expect(text).toContain("# 阶段台账")
      expect(text).toContain(`- [done] a 分析 → docs/phases/a-analysis/(交接: docs/phases/a-analysis/handover.md)`)
      expect((await readLedger(dir)).done).toEqual<Phase[]>(["a"])
      await appendLedger(dir, "d")
      expect((await readLedger(dir)).done).toEqual<Phase[]>(["a", "d"])
      const again = await Bun.file(join(dir, "docs/phases.md")).text()
      expect(again.split("- [done]").length - 1).toBe(2)
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

describe("快照与归档(F 节)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-phases-"))
  }

  async function exists(path: string) {
    return await Bun.file(path).exists()
  }

  test("快照差异归档: 新增/改动移入归档目录,前序留存物与台账/归档/agents 不动", async () => {
    const dir = tempDir()
    try {
      // 阶段开始前的 docs/ 现状
      mkdirSync(join(dir, "docs/keep", "nested"), { recursive: true })
      writeFileSync(join(dir, "docs/keep/old.md"), "旧")
      writeFileSync(join(dir, "docs/keep/nested/untouched.md"), "未改动")
      mkdirSync(join(dir, "docs/agents"), { recursive: true })
      writeFileSync(join(dir, "docs/agents/workflow.md"), "跨阶段工作流知识")
      await snapshotDocs(dir)
      // 本阶段新增/改动
      writeFileSync(join(dir, "docs/keep/new.md"), "新")
      writeFileSync(join(dir, "docs/keep/old.md"), "改动后")
      // 快照按 mtime 判定差异: 显式回拨修改时间,避免与快照同毫秒写入被偶发漏检。
      utimesSync(join(dir, "docs/keep/old.md"), 1_000, 1_000)
      mkdirSync(join(dir, "docs/analysis"), { recursive: true })
      writeFileSync(join(dir, "docs/analysis/baseline.md"), "行为基线")
      writeFileSync(join(dir, "docs/T-001.report.md"), "任务报告")
      writeFileSync(join(dir, "docs/phases.md"), "# 阶段台账\n")
      const moved = await archivePhaseDocs(dir, "a")
      expect(new Set(moved)).toEqual(new Set(["T-001.report.md", "analysis/baseline.md", "keep/new.md", "keep/old.md"]))
      expect(await exists(join(dir, "docs/phases/a-analysis/analysis/baseline.md"))).toBe(true)
      expect(await exists(join(dir, "docs/phases/a-analysis/T-001.report.md"))).toBe(true)
      expect(await exists(join(dir, "docs/phases/a-analysis/keep/old.md"))).toBe(true)
      // 前序留存物中未改动的文件保留,agents 不归档
      expect(await exists(join(dir, "docs/keep/nested/untouched.md"))).toBe(true)
      expect(await exists(join(dir, "docs/agents/workflow.md"))).toBe(true)
      expect(await exists(join(dir, "docs/phases.md"))).toBe(true)
      // 幂等: 重复调用无差异可移
      expect(await archivePhaseDocs(dir, "a")).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("快照缺失 → 退化移动 A.1 产物目录与 T-* 任务产物", async () => {
    const dir = tempDir()
    try {
      mkdirSync(join(dir, "docs/analysis"), { recursive: true })
      writeFileSync(join(dir, "docs/analysis/baseline.md"), "行为基线")
      writeFileSync(join(dir, "docs/T-001.report.md"), "任务报告")
      writeFileSync(join(dir, "docs/keep.md"), "非本阶段产物目录,退化时保留")
      const moved = await archivePhaseDocs(dir, "a")
      expect(new Set(moved)).toEqual(new Set(["T-001.report.md", "analysis/baseline.md"]))
      expect(await exists(join(dir, "docs/keep.md"))).toBe(true)
      // m 阶段退化兜底: docs/final/ 归 m
      mkdirSync(join(dir, "docs/final"), { recursive: true })
      writeFileSync(join(dir, "docs/final/audit-r1.md"), "终审报告")
      expect(await archivePhaseDocs(dir, "m")).toEqual(["final/audit-r1.md"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("归档目录与交接文档协议", () => {
  test("phaseArchive 六阶段目录名", () => {
    expect(phaseArchive("a")).toBe("docs/phases/a-analysis")
    expect(phaseArchive("d")).toBe("docs/phases/d-design")
    expect(phaseArchive("m")).toBe("docs/phases/m-migrate")
    expect(phaseArchive("t")).toBe("docs/phases/t-testing")
    expect(phaseArchive("v")).toBe("docs/phases/v-acceptance")
    expect(phaseArchive("k")).toBe("docs/phases/k-knowledge")
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

describe("续轮迁移(continue 子命令,M 节): currentRound / archiveRound / prevRoundDigest", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-phases-"))
  }

  async function exists(path: string) {
    return await Bun.file(path).exists()
  }

  function dirExists(path: string) {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false
  }

  // 伪造一轮已完成的现场: 台账 + 各阶段归档目录(交接文档)+ 知识文档残留 +
  // 轮末根 PLAN 与 docs/ 快照。
  function seedFinishedRound(dir: string) {
    mkdirSync(join(dir, "docs"), { recursive: true })
    writeFileSync(join(dir, "docs/phases.md"), "# 阶段台账\n\n- [done] a 分析 → docs/phases/a-analysis/\n- [done] m 迁移实现 → docs/phases/m-migrate/\n")
    mkdirSync(join(dir, "docs/phases/a-analysis"), { recursive: true })
    writeFileSync(join(dir, "docs/phases/a-analysis/handover.md"), "# a 分析 阶段交接\n\n## 关键决策\n- 决策甲\n")
    mkdirSync(join(dir, "docs/phases/m-migrate/migration-kb"), { recursive: true })
    writeFileSync(join(dir, "docs/phases/m-migrate/handover.md"), "# m 迁移实现 阶段交接\n\n## 关键决策\n- 迁移决策乙\n")
    writeFileSync(join(dir, "docs/phases/m-migrate/migration-kb/migration-2026.md"), "# 迁移知识\n\nAPI 映射结论。")
    mkdirSync(join(dir, "docs/migration-kb"), { recursive: true })
    writeFileSync(join(dir, "docs/migration-kb/migration-2025.md"), "# 未归档残留\n")
    writeFileSync(join(dir, "PLAN.md"), "## T-001: 轮后手工任务 [pending]\n正文\n")
    mkdirSync(join(dir, ".auto"), { recursive: true })
    writeFileSync(join(dir, ".auto/phase-snapshot.json"), "{}")
  }

  test("currentRound: 无归档 = 第 1 轮;round-<N> 取最大编号 + 1(推导式)", async () => {
    const dir = tempDir()
    try {
      expect(await currentRound(dir)).toBe(1)
      mkdirSync(join(dir, "docs/phases/round-1"), { recursive: true })
      expect(await currentRound(dir)).toBe(2)
      mkdirSync(join(dir, "docs/phases/round-3"), { recursive: true })
      expect(await currentRound(dir)).toBe(4)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("archiveRound: 台账/阶段归档/知识残留/轮末 PLAN 移入 round-1,快照清除", async () => {
    const dir = tempDir()
    try {
      seedFinishedRound(dir)
      expect(await archiveRound(dir)).toBe(1)
      expect(await exists(join(dir, "docs/phases/round-1/phases.md"))).toBe(true)
      expect(await exists(join(dir, "docs/phases/round-1/a-analysis/handover.md"))).toBe(true)
      expect(await exists(join(dir, "docs/phases/round-1/m-migrate/migration-kb/migration-2026.md"))).toBe(true)
      // 交接前中断的知识残留从 docs/ 根移入轮归档,新一轮 k 阶段可重新提取
      expect(await exists(join(dir, "docs/phases/round-1/migration-kb/migration-2025.md"))).toBe(true)
      expect(await exists(join(dir, "docs/phases/round-1/PLAN.md"))).toBe(true)
      expect(await exists(join(dir, "docs/phases.md"))).toBe(false)
      expect(await exists(join(dir, "docs/migration-kb/migration-2025.md"))).toBe(false)
      expect(await exists(join(dir, ".auto/phase-snapshot.json"))).toBe(false)
      expect(await currentRound(dir)).toBe(2)
      // 台账已随归档消失 = 空台账,routePhase 回到 plan 路由(新一轮从头规划)
      expect((await readLedger(dir)).done).toEqual([])
      // 全部移走后重复调用: 幂等,不新建空 round 目录
      expect(await archiveRound(dir)).toBe(2)
      expect(dirExists(join(dir, "docs/phases/round-2"))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("prevRoundDigest: 归档索引 + 最终交接 + 迁移知识;无轮次归档 → undefined", async () => {
    const fresh = tempDir()
    try {
      expect(await prevRoundDigest(fresh)).toBeUndefined()
    } finally {
      rmSync(fresh, { recursive: true, force: true })
    }
    const dir = tempDir()
    try {
      seedFinishedRound(dir)
      await archiveRound(dir)
      const digest = await prevRoundDigest(dir)
      expect(digest).toBeDefined()
      // 归档索引: 各阶段归档目录
      expect(digest).toContain("### 上一轮(第 1 轮)阶段归档索引")
      expect(digest).toContain("- docs/phases/round-1/a-analysis/")
      // 最终交接: 台账最后一个完成阶段(m)的 handover.md 全文
      expect(digest).toContain("### 上一轮最终交接(docs/phases/round-1/m-migrate/handover.md)")
      expect(digest).toContain("迁移决策乙")
      expect(digest).not.toContain("决策甲") // 仅注入最终交接,a 阶段交接不整篇注入
      // 迁移知识: 归档内与残留的知识文档全文都收集
      expect(digest).toContain("### 上一轮迁移知识(docs/phases/round-1/m-migrate/migration-kb/migration-2026.md)")
      expect(digest).toContain("API 映射结论。")
      expect(digest).toContain("### 上一轮迁移知识(docs/phases/round-1/migration-kb/migration-2025.md)")
      // 空白轮目录(只有 round 目录、无内容)→ undefined
      const bare = tempDir()
      try {
        mkdirSync(join(bare, "docs/phases/round-1"), { recursive: true })
        expect(await prevRoundDigest(bare)).toBeUndefined()
      } finally {
        rmSync(bare, { recursive: true, force: true })
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
