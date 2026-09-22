import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { roundDir } from "../src/docpaths"
import { validHandover } from "../src/document/roles"
import { renderTaskIndex, renderTaskTodo } from "../src/tasks"
import {
  completePhase,
  currentPhase,
  currentRound,
  doneTypes,
  establishRound,
  formatPhases,
  nextRound,
  parsePhases,
  phaseAcceptanceDoc,
  phaseArtifacts,
  phaseHandoverDoc,
  phaseIndexPath,
  phaseLabel,
  prevRoundDigest,
  readPhases,
  renderPhaseTodo,
  routePhase,
  syncPhaseIndex,
} from "../src/phases"

describe("parsePhases", () => {
  const letters = (raw: string) => parsePhases(raw)?.map((entry) => entry.letter)
  const types = (raw: string, dir?: string) => parsePhases(raw, dir)?.map((entry) => entry.type)

  test("admtvk 的子序列且含 m → 按给出顺序返回", () => {
    expect(letters("m")).toEqual(["m"])
    expect(letters("amt")).toEqual(["a", "m", "t"])
    expect(letters("admtvk")).toEqual(["a", "d", "m", "t", "v", "k"])
    expect(letters("dmvk")).toEqual(["d", "m", "v", "k"])
  })

  test("type-id list (M3.6): any order, repeats allowed, spaces trimmed, must contain implement", () => {
    expect(types("implement")).toEqual(["implement"])
    expect(types("test,implement,test")).toEqual(["test", "implement", "test"])
    expect(types(" analysis , implement ")).toEqual(["analysis", "implement"])
    for (const raw of ["analysis,design", "implement,,test", "implement,nope", "implement,a"]) expect(parsePhases(raw)).toBeNull()
  })

  test(
    "type-id list resolves the project's custom types from dir",
    withDir(async (dir) => {
      expect(parsePhases("security-review,implement", dir)).toBeNull()
      mkdirSync(join(dir, ".opencode/auto/phases"), { recursive: true })
      writeFileSync(join(dir, ".opencode/auto/phases/security-review.md"), "# Security review\n\n## plan duties\n\nList the review tasks.\n")
      expect(types("security-review,implement", dir)).toEqual(["security-review", "implement"])
      expect(parsePhases("security-review,implement", dir)![0]!.origin).toBe("project")
    }),
  )

  test("非法取值 → null(乱序/缺 m/越界字母/重复/空串)", () => {
    for (const raw of ["", "tma", "adk", "mm", "ama", "mx", "M", "amtkv ", "admtvkx"]) {
      expect(parsePhases(raw)).toBeNull()
    }
  })
})

function tempDir() {
  return mkdtempSync(join(tmpdir(), "auto-phases-"))
}

function withDir(fn: (dir: string) => Promise<void>) {
  return async () => {
    const dir = tempDir()
    try {
      await fn(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

const read = (dir: string, rel: string) => Bun.file(join(dir, rel)).text()
const exists = (dir: string, rel: string) => Bun.file(join(dir, rel)).exists()

describe("phase index (M3.3): syncPhaseIndex / readPhases / completePhase", () => {
  test(
    "syncPhaseIndex writes phases.md plus one P<nn>-<type>/todo.md per preset letter; readPhases round-trips",
    withDir(async (dir) => {
      const units = await syncPhaseIndex(dir, 1, "amt")
      expect(units.map(phaseLabel)).toEqual(["P01-analysis", "P02-implement", "P03-test"])
      expect(units.map((unit) => unit.entry.letter)).toEqual(["a", "m", "t"])
      expect(units[1]!.dir).toBe("docs/R-01/P02-implement")
      const index = await read(dir, "docs/R-01/phases.md")
      expect(index).toContain("# Phases (R-01)")
      expect(index).toContain("- [ ] P01 analysis\n- [ ] P02 implement\n- [ ] P03 test\n")
      const todo = await read(dir, "docs/R-01/P01-analysis/todo.md")
      expect(todo).toBe(renderPhaseTodo(units[0]!))
      expect(todo.startsWith("# R-01.P01: 分析\n\nType: analysis\n")).toBe(true)
      expect(todo.trimEnd().endsWith("<!-- auto: eof -->")).toBe(true)
      const state = (await readPhases(dir))!
      expect(state.round).toBe(1)
      expect(state.index).toBe(phaseIndexPath(1))
      expect(state.phases).toEqual(units)
      expect([...state.done]).toEqual([])
    }),
  )

  test(
    "custom and repeated types (M3.6): one directory per phase, readPhases resolves the project type",
    withDir(async (dir) => {
      mkdirSync(join(dir, ".opencode/auto/phases"), { recursive: true })
      writeFileSync(join(dir, ".opencode/auto/phases/review.md"), "# Review\n\nGate: verdict\n\n## plan duties\n\nPlan the review.\n")
      const units = await syncPhaseIndex(dir, 1, "review,implement,review")
      expect(units.map(phaseLabel)).toEqual(["P01-review", "P02-implement", "P03-review"])
      expect(await read(dir, "docs/R-01/P03-review/todo.md")).toContain("# R-01.P03: Review\n")
      const state = (await readPhases(dir))!
      expect(state.phases.map((unit) => [unit.id, unit.entry.origin, unit.entry.gate])).toEqual([
        ["P01", "project", "verdict"],
        ["P02", "builtin", "none"],
        ["P03", "project", "verdict"],
      ])
      await completePhase(dir, units[0]!)
      expect(doneTypes((await readPhases(dir))!)).toEqual(["review"])
      // The type file gone → the index names an unknown type and reads as invalid
      rmSync(join(dir, ".opencode/auto/phases/review.md"))
      await expect(readPhases(dir)).rejects.toThrow(/unknown phase type "review"/)
    }),
  )

  test(
    "phase Depends (M3.5): read from todo.md, reorders currentPhase, bad graphs make the index invalid",
    withDir(async (dir) => {
      const units = await syncPhaseIndex(dir, 1, "amt")
      const todo = join(dir, "docs/R-01/P01-analysis/todo.md")
      const original = await read(dir, "docs/R-01/P01-analysis/todo.md")
      writeFileSync(todo, original.replace("Type: analysis\n", "Type: analysis\nDepends: P03\n"))
      writeFileSync(join(dir, "docs/R-01/P03-test/todo.md"), renderPhaseTodo(units[2]!).replace("Type: test\n", "Type: test\nDepends: none\n"))
      const state = (await readPhases(dir))!
      expect(state.phases[0]!.depends).toEqual(["P03"])
      expect(currentPhase(state)!.id).toBe("P03")
      writeFileSync(todo, original.replace("Type: analysis\n", "Type: analysis\nDepends: P09\n"))
      await expect(readPhases(dir)).rejects.toThrow("P01 depends on unknown P09")
    }),
  )

  test(
    "no index → undefined (round never established)",
    withDir(async (dir) => {
      expect(await readPhases(dir)).toBeUndefined()
      mkdirSync(join(dir, "docs/R-01"), { recursive: true })
      expect(await readPhases(dir)).toBeUndefined()
    }),
  )

  test(
    "re-sync with the same preset is a no-op; a changed tail replaces pending phases that hold only todo.md",
    withDir(async (dir) => {
      await syncPhaseIndex(dir, 1, "amt")
      writeFileSync(join(dir, "docs/R-01/P01-analysis/findings.md"), "work\n")
      await syncPhaseIndex(dir, 1, "amt")
      expect(await read(dir, "docs/R-01/P01-analysis/findings.md")).toBe("work\n")
      await syncPhaseIndex(dir, 1, "amvk")
      expect((await readPhases(dir))!.phases.map(phaseLabel)).toEqual(["P01-analysis", "P02-implement", "P03-acceptance", "P04-knowledge"])
      expect(await exists(dir, "docs/R-01/P03-test/todo.md")).toBe(false)
      expect(await exists(dir, "docs/R-01/P04-knowledge/todo.md")).toBe(true)
      expect(await read(dir, "docs/R-01/P01-analysis/findings.md")).toBe("work\n")
    }),
  )

  test(
    "re-sync refuses to drop a completed phase or a phase directory that holds work, before touching any file",
    withDir(async (dir) => {
      const units = await syncPhaseIndex(dir, 1, "amt")
      await completePhase(dir, units[0]!)
      await expect(syncPhaseIndex(dir, 1, "mt")).rejects.toThrow(/completed phase docs\/R-01\/P01-analysis/)
      writeFileSync(join(dir, "docs/R-01/P03-test/notes.md"), "draft\n")
      await expect(syncPhaseIndex(dir, 1, "am")).rejects.toThrow(/already holds work \(notes\.md\)/)
      expect((await readPhases(dir))!.phases.map(phaseLabel)).toEqual(["P01-analysis", "P02-implement", "P03-test"])
    }),
  )

  test(
    "completePhase renames todo.md → done.md and ticks the index line; idempotent",
    withDir(async (dir) => {
      const units = await syncPhaseIndex(dir, 1, "amt")
      await completePhase(dir, units[1]!)
      await completePhase(dir, units[1]!)
      expect(await exists(dir, "docs/R-01/P02-implement/todo.md")).toBe(false)
      expect(await exists(dir, "docs/R-01/P02-implement/done.md")).toBe(true)
      expect(await read(dir, "docs/R-01/phases.md")).toContain("- [ ] P01 analysis\n- [x] P02 implement\n- [ ] P03 test\n")
      const state = (await readPhases(dir))!
      expect([...state.done]).toEqual(["P02"])
      expect(doneTypes(state)).toEqual(["implement"])
    }),
  )

  test(
    "files win over ticks: a ticked line without done.md is still pending",
    withDir(async (dir) => {
      await syncPhaseIndex(dir, 1, "am")
      writeFileSync(join(dir, "docs/R-01/phases.md"), (await read(dir, "docs/R-01/phases.md")).replace("- [ ] P01", "- [x] P01"))
      expect([...(await readPhases(dir))!.done]).toEqual([])
    }),
  )

  test(
    "invalid index → throw with fix-it guidance: bad line, unknown type, both / neither state files",
    withDir(async (dir) => {
      await syncPhaseIndex(dir, 1, "am")
      const index = join(dir, "docs/R-01/phases.md")
      const good = await read(dir, "docs/R-01/phases.md")
      for (const [bad, pattern] of [
        [good + "- [ ] X9 analysis\n", /"X9" is not a phase id/],
        [good + "- [ ] P03 review\n", /unknown phase type "review"/],
        ["# Phases\n", /no phases listed/],
      ] as const) {
        writeFileSync(index, bad)
        await expect(readPhases(dir)).rejects.toThrow(pattern)
      }
      writeFileSync(index, good)
      writeFileSync(join(dir, "docs/R-01/P01-analysis/done.md"), "x\n")
      await expect(readPhases(dir)).rejects.toThrow(/docs\/R-01\/P01-analysis\/ has both todo\.md and done\.md/)
      rmSync(join(dir, "docs/R-01/P01-analysis"), { recursive: true })
      await expect(readPhases(dir)).rejects.toThrow(/P01-analysis\/ has neither/)
      await expect(readPhases(dir)).rejects.toThrow(/docs\/R-01\/phases\.md/)
    }),
  )
})

describe("routePhase(阶段路由,D.2)", () => {
  // The current phase's task index with one task T-001 in the given state.
  async function seedTask(dir: string, unit: { dir: string; round: string; id: string }, done: boolean) {
    writeFileSync(join(dir, unit.dir, "tasks.md"), renderTaskIndex(`${unit.round}.${unit.id}`, [{ id: "T-001", title: "任务", done }]))
    mkdirSync(join(dir, "docs/T-001"), { recursive: true })
    rmSync(join(dir, "docs/T-001", done ? "todo.md" : "done.md"), { force: true })
    writeFileSync(join(dir, "docs/T-001", done ? "done.md" : "todo.md"), renderTaskTodo({ id: "T-001", title: "任务" }))
  }
  const route = async (dir: string) => {
    const r = await routePhase(dir)
    return r.type === "plan" || r.type === "execute" || r.type === "handover" ? { type: r.type, phase: r.phase, tasks: r.plan.tasks.length } : r
  }

  test(
    "no task index → plan; a task not done → execute; all done → handover (the route carries the loaded plan)",
    withDir(async (dir) => {
      const [first] = await syncPhaseIndex(dir, 1, "amt")
      expect(await route(dir)).toEqual({ type: "plan", phase: first!, tasks: 0 })
      await seedTask(dir, first!, false)
      expect(await route(dir)).toEqual({ type: "execute", phase: first!, tasks: 1 })
      await seedTask(dir, first!, true)
      expect(await route(dir)).toEqual({ type: "handover", phase: first!, tasks: 1 })
    }),
  )

  test(
    "derived from done.md: completed phases advance the current phase; all done → complete",
    withDir(async (dir) => {
      const units = await syncPhaseIndex(dir, 1, "amt")
      await completePhase(dir, units[0]!)
      await completePhase(dir, units[1]!)
      expect(await route(dir)).toEqual({ type: "plan", phase: units[2]!, tasks: 0 })
      await seedTask(dir, units[2]!, false)
      expect(await route(dir)).toEqual({ type: "execute", phase: units[2]!, tasks: 1 })
      await completePhase(dir, units[2]!)
      expect(await routePhase(dir)).toEqual({ type: "complete" })
    }),
  )

  test(
    "missing or invalid phase or task index → blocked (environment error with guidance)",
    withDir(async (dir) => {
      const missing = await routePhase(dir)
      expect(missing).toEqual({ type: "blocked", reason: expect.stringContaining("phase index docs/R-01/phases.md is missing") })
      const [first] = await syncPhaseIndex(dir, 1, "am")
      writeFileSync(join(dir, first!.dir, "tasks.md"), "- [ ] T-001 lost\n")
      const lost = await routePhase(dir)
      expect(lost).toEqual({ type: "blocked", reason: expect.stringContaining("docs/T-001/ has neither todo.md nor done.md") })
      writeFileSync(join(dir, "docs/R-01/phases.md"), "- [ ] P01 nonsense\n")
      const broken = await routePhase(dir)
      expect(broken.type).toBe("blocked")
      if (broken.type === "blocked") expect(broken.reason).toContain("docs/R-01/phases.md")
    }),
  )
})

describe("formatPhases / currentPhase(阶段进度行)", () => {
  test(
    "✓ = done.md, ▶ = current, others pending",
    withDir(async (dir) => {
      const units = await syncPhaseIndex(dir, 1, "amt")
      expect(formatPhases((await readPhases(dir))!)).toBe("P01-analysis▶ P02-implement P03-test")
      await completePhase(dir, units[0]!)
      const state = (await readPhases(dir))!
      expect(formatPhases(state)).toBe("P01-analysis✓ P02-implement▶ P03-test")
      expect(currentPhase(state)).toEqual(units[1]!)
      await completePhase(dir, units[1]!)
      await completePhase(dir, units[2]!)
      const done = (await readPhases(dir))!
      expect(formatPhases(done)).toBe("P01-analysis✓ P02-implement✓ P03-test✓")
      expect(currentPhase(done)).toBeUndefined()
    }),
  )
})

describe("phase directory paths", () => {
  test(
    "handover / acceptance / standard artifacts live in the phase directory",
    withDir(async (dir) => {
      const units = await syncPhaseIndex(dir, 2, "admtvk")
      const byType = (type: string) => units.find((unit) => unit.type === type)!
      expect(phaseHandoverDoc(byType("design"))).toBe("docs/R-02/P02-design/handover.md")
      expect(phaseAcceptanceDoc(byType("acceptance"))).toBe("docs/R-02/P05-acceptance/acceptance.md")
      expect(phaseArtifacts(byType("knowledge")).map((spec) => spec.path)).toEqual(["docs/R-02/P06-knowledge/kb.md"])
      expect(phaseArtifacts(byType("design")).map((spec) => spec.path)).toEqual(["docs/R-02/P02-design/design.md", "docs/R-02/P02-design/decisions.md"])
      expect(phaseArtifacts(byType("implement"))).toEqual([])
    }),
  )
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
  async function exists(path: string) {
    return await Bun.file(path).exists()
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

  test("establishRound: 建轮目录 + 阶段索引与阶段目录 + AGENTS.md.bak 快照;不写 PLAN.md(M3.4 退役)", async () => {
    const dir = tempDir()
    try {
      writeFileSync(join(dir, "AGENTS.md"), "# AGENTS\n\n工作流入口\n")
      const result = await establishRound(dir, { phases: "amt" })
      expect(result).toEqual({ round: 1, root: roundDir(1) })
      // 阶段索引与阶段目录随轮首建立
      expect((await readPhases(dir))!.phases.map(phaseLabel)).toEqual(["P01-analysis", "P02-implement", "P03-test"])
      expect(await exists(join(dir, "docs/R-01/P03-test/todo.md"))).toBe(true)
      expect(await exists(join(dir, "PLAN.md"))).toBe(false)
      expect(await exists(join(dir, "docs/R-01/PLAN.md"))).toBe(false)
      // AGENTS.md 快照改名 .bak(不当指令加载),根文件保留
      expect(await Bun.file(join(dir, "docs/R-01/AGENTS.md.bak")).text()).toContain("工作流入口")
      expect(await exists(join(dir, "AGENTS.md"))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("establishRound 无阶段模式: phases = m 建隐式单阶段 R-01/P01-implement(plans/0047 L2)", async () => {
    const dir = tempDir()
    try {
      await establishRound(dir, { phases: "m" })
      expect((await readPhases(dir))!.phases.map(phaseLabel)).toEqual(["P01-implement"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("establishRound 幂等续跑: 阶段完成态与阶段目录内容保留;显式轮号开新一轮", async () => {
    const dir = tempDir()
    try {
      await establishRound(dir, { phases: "amt" })
      writeFileSync(join(dir, "docs/R-01/P01-analysis/tasks.md"), "- [x] T-001 已完成任务\n")
      await completePhase(dir, (await readPhases(dir))!.phases[0]!)
      // 幂等: 重复建立当前轮不重写阶段目录,阶段完成态保留
      const again = await establishRound(dir, { phases: "amt" })
      expect(doneTypes((await readPhases(dir))!)).toEqual(["analysis"])
      expect(again.round).toBe(1)
      expect(await Bun.file(join(dir, "docs/R-01/P01-analysis/tasks.md")).text()).toContain("已完成任务")
      // 新一轮: 显式轮号(nextRound)
      const next = await establishRound(dir, { phases: "am", round: await nextRound(dir) })
      expect(next.round).toBe(2)
      // 新一轮阶段全未完成
      expect(formatPhases((await readPhases(dir))!)).toBe("P01-analysis▶ P02-implement")
      expect(await currentRound(dir)).toBe(2)
      // 上一轮内容不受影响(落盘即永久)
      expect(await Bun.file(join(dir, "docs/R-01/P01-analysis/tasks.md")).text()).toContain("已完成任务")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("prevRoundDigest: 上一轮阶段目录索引 + 最后完成阶段的交接 + knowledge 阶段 kb.md;无上一轮/空白轮 → undefined", async () => {
    const fresh = tempDir()
    try {
      expect(await prevRoundDigest(fresh)).toBeUndefined()
    } finally {
      rmSync(fresh, { recursive: true, force: true })
    }
    const dir = tempDir()
    try {
      // R-01 完成的轮: 阶段索引 + 阶段目录(交接/知识)+ done.md;R-02 已建(新一轮开工)
      const units = await syncPhaseIndex(dir, 1, "amk")
      writeFileSync(join(dir, "docs/R-01/P01-analysis/handover.md"), "# 分析 阶段交接\n\n## 关键决策\n- 决策甲\n")
      writeFileSync(join(dir, "docs/R-01/P02-implement/handover.md"), "# 迁移实现 阶段交接\n\n## 关键决策\n- 迁移决策乙\n")
      writeFileSync(join(dir, "docs/R-01/P03-knowledge/kb.md"), "# 迁移知识\n\nAPI 映射结论。")
      await completePhase(dir, units[0]!)
      await completePhase(dir, units[1]!)
      await syncPhaseIndex(dir, 2, "am")
      const digest = await prevRoundDigest(dir)
      expect(digest).toBeDefined()
      expect(digest).toContain("### 上一轮(第 1 轮)阶段目录索引(docs/R-01/)")
      expect(digest).toContain("- docs/R-01/P01-analysis/")
      expect(digest).toContain("- docs/R-01/P03-knowledge/")
      expect(digest).toContain("### 上一轮最终交接(docs/R-01/P02-implement/handover.md)")
      expect(digest).toContain("迁移决策乙")
      expect(digest).not.toContain("决策甲") // 仅注入最后完成阶段的交接
      expect(digest).toContain("### 上一轮迁移知识(docs/R-01/P03-knowledge/kb.md)")
      expect(digest).toContain("API 映射结论。")
      // 上一轮索引不可用: 目录索引与知识照常,交接省略(提示词输入从宽)
      writeFileSync(join(dir, "docs/R-01/phases.md"), "垃圾\n- [ ] P01 nonsense\n")
      const lenient = await prevRoundDigest(dir)
      expect(lenient).toContain("- docs/R-01/P01-analysis/")
      expect(lenient).not.toContain("最终交接")
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
})
