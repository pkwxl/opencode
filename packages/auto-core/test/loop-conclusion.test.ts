import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { taskDoc } from "../src/docpaths"
import {
  phaseCloseLines,
  phaseResolveLines,
  roundCompleteLines,
  roundResolveLines,
  taskEndLines,
  taskResolveLines,
} from "../src/conclusion"
import { recordDecisions, recordResolves, type ResolveItem } from "../src/resolve"
import {
  flushStats,
  loadStats,
  setStatsClock,
  statsHistory,
  statsPhase,
  statsSessionBegin,
  statsSessionEnd,
  statsTask,
  statsWaitBegin,
  statsWaitEnd,
  type Usage,
} from "../src/stats"

// T-006: 任务三态行 / 阶段收口行 / 轮次完成行的报文构造(plans/STATS_PLAN.md
// §4.2/4.3/4.4)——注入 stats 句柄(loadStats + 注入时钟)直驱 loop.ts 的三个
// 报文构造函数,断言文案、省略规则与守卫。loop 主体的调用点接线(typecheck 覆盖)
// 不在此重复 fake 整条 runAll 链。

function usage(partial: Partial<Usage>): Usage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 1, ...partial }
}

describe("taskEndLines 任务结束三态行", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-conclusion-"))
    now = 1_000_000
    setStatsClock(() => now)
  })

  afterEach(async () => {
    setStatsClock()
    await flushStats(dir).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  })

  test("statsId 守卫: 未装载或桶身份不符返回 undefined(调用方回落旧文案)", async () => {
    // 未装载句柄
    expect(await taskEndLines(dir, "T-001")).toBeUndefined()
    // 桶身份是别的任务
    await loadStats(dir)
    await statsTask(dir, "T-999")
    expect(await taskEndLines(dir, "T-001")).toBeUndefined()
  })

  test("未中断: 累计口径输出,无“本进程”段(本进程 == 累计,文案等价现状)", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-003")
    // 两次会话: 18 分 12 秒 AI(墙钟段 6 分 19 秒补齐到 24 分 31 秒)。
    await statsSessionBegin(dir, "T-003")
    now += 10 * 60_000
    await statsSessionEnd(dir, "ses_1", usage({ input: 1200, output: 340, cacheRead: 28_400, cacheWrite: 3100, cost: 0.041 }))
    now += 6 * 60_000 + 19_000 // 会话间墙钟
    await statsSessionBegin(dir, "T-003")
    now += 8 * 60_000 + 12_000
    await statsSessionEnd(dir, "ses_2", usage({ input: 800, output: 100 }))
    const lines = await taskEndLines(dir, "T-003")
    expect(lines).toEqual([
      "elapsed 24m 31s (AI 18m 12s), 2 sessions",
      "tokens in 2000 / out 440 / cache-read 28.4k / cache-write 3100, hit 93.4%, cost $0.041",
    ])
  })

  test("跨中断续接: 累计含中断前,“本进程” ≠ 累计时输出", async () => {
    // 第一“进程”: 18 分后优雅收口。
    await loadStats(dir)
    await statsTask(dir, "T-003")
    now += 18 * 60_000
    await flushStats(dir)
    // 第二“进程”: 续跑同任务(同 id 幂等,桶不重置),再跑 6 分。
    await loadStats(dir)
    await statsTask(dir, "T-003")
    now += 6 * 60_000
    const lines = await taskEndLines(dir, "T-003")
    expect(lines?.[0]).toBe("elapsed 24m 0s (AI 0s, this process 6m 0s), 0 sessions")
  })
})

describe("phaseCloseLines 阶段收口行", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-phase-"))
    now = 1_000_000
    setStatsClock(() => now)
    await loadStats(dir)
  })

  afterEach(async () => {
    setStatsClock()
    await flushStats(dir).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  })

  test("全量口径: 总用时(含规划/交接/提交;AI,人工等待),任务 N 个 / 会话 M 次 + tokens 行", async () => {
    await statsPhase(dir, "t")
    // 两个任务(statsTask 各计 1)、三次会话(含旁路,同归 phase 桶)、一次人工等待。
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 20 * 60_000
    await statsSessionEnd(dir, "ses_1", usage({ input: 5000, output: 1200, cacheRead: 90_000, cost: 0.31 }))
    await statsTask(dir, "T-002")
    await statsSessionBegin(dir, "T-002")
    now += 21 * 60_000
    await statsSessionEnd(dir, "ses_2", usage({ input: 4000, output: 800 }))
    await statsWaitBegin(dir, "stepPause:phase")
    now += 3 * 60_000
    await statsWaitEnd(dir)
    // 交接蒸馏旁路会话(伪任务 PLAN)。
    await statsSessionBegin(dir, "PLAN")
    now += 60_000
    await statsSessionEnd(dir, "ses_3", usage({ output: 200 }))
    now += 8 * 60_000 // 归档/台账/提交等 driver 墙钟
    // 总用时 50 分 = 20+21+1(AI 段)+ 8(driver 墙钟);3 分人工等待从总用时扣除、
    // 单记 waitMs(STATS_PLAN 已确认口径: 总用时排除纯人工等待)。
    const lines = await phaseCloseLines(dir, "t")
    expect(lines).toEqual([
      "■ phase t 测试 closed: total 50m 0s (incl. plan/handover/commit; AI 42m 0s, human wait 3m 0s), 2 tasks / 3 sessions",
      "tokens in 9000 / out 2200 / cache-read 90.0k / cache-write 0, hit 90.9%, cost $0.31",
    ])
  })

  test("省略与守卫: waitMs=0 省略人工等待段;桶 id 不符(已切换阶段)返回 undefined", async () => {
    await statsPhase(dir, "t")
    await statsTask(dir, "T-001")
    now += 5 * 60_000
    const lines = await phaseCloseLines(dir, "t")
    expect(lines?.[0]).toBe("■ phase t 测试 closed: total 5m 0s (incl. plan/handover/commit; AI 0s), 1 tasks / 0 sessions")
    expect(lines?.[0]).not.toContain("human wait")
    // 切换到下一阶段后,旧字母的收口行不再可信(桶已重置)
    await statsPhase(dir, "v")
    expect(await phaseCloseLines(dir, "t")).toBeUndefined()
  })
})

describe("roundCompleteLines 轮次完成行", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-round-"))
    now = 1_000_000
    setStatsClock(() => now)
  })

  afterEach(async () => {
    setStatsClock()
    await flushStats(dir).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  })

  test("本轮汇总: phaseCount 提供时带阶段段,缺省省略;history.rounds=0 无历轮段", async () => {
    await loadStats(dir)
    await statsPhase(dir, "m")
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 30 * 60_000
    await statsSessionEnd(dir, "ses_1", usage({ input: 2000, output: 500, cacheRead: 18_000, cost: 0.12 }))
    now += 22 * 60_000
    // 分阶段路径(阶段数由调用方从台账读)
    const phased = await roundCompleteLines(dir, { phaseCount: 6 })
    expect(phased).toEqual([
      "■ round 1 complete: total 52m 0s (AI 30m 0s), 6 phases / 1 tasks / 1 sessions",
      "tokens in 2000 / out 500 / cache-read 18.0k / cache-write 0, hit 90.0%, cost $0.12",
    ])
    // 非分阶段路径(m 阶段汇总,无阶段段)
    const plain = await roundCompleteLines(dir)
    expect(plain?.[0]).toBe("■ round 1 complete: total 52m 0s (AI 30m 0s), 1 tasks / 1 sessions")
    expect(plain).toHaveLength(2)
  })

  test("历轮累计: 轮次滚动进 history 后追加两行历轮段", async () => {
    // 第 1 轮: 40 分,1 任务 2 会话。
    await loadStats(dir)
    await statsPhase(dir, "m")
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 30 * 60_000
    await statsSessionEnd(dir, "ses_1", usage({ input: 1000, output: 200, cost: 0.1 }))
    await statsSessionBegin(dir, "T-001")
    now += 10 * 60_000
    await statsSessionEnd(dir, "ses_2", usage({ input: 1000, output: 200, cost: 0.1 }))
    await flushStats(dir)
    // 进入第 2 轮(docs/R-02 存在 → currentRound = 2):装载时第 1 轮滚进 history。
    await mkdir(join(dir, "docs", "R-02"), { recursive: true })
    await loadStats(dir)
    expect((await statsHistory(dir))?.rounds).toBe(1)
    // 第 2 轮: 20 分,1 任务 1 会话。
    await statsPhase(dir, "m")
    await statsTask(dir, "T-002")
    await statsSessionBegin(dir, "T-002")
    now += 20 * 60_000
    await statsSessionEnd(dir, "ses_3", usage({ input: 500, output: 100, cost: 0.05 }))
    const lines = await roundCompleteLines(dir, { phaseCount: 5 })
    expect(lines).toEqual([
      "■ round 2 complete: total 20m 0s (AI 20m 0s), 5 phases / 1 tasks / 1 sessions",
      "tokens in 500 / out 100 / cache-read 0 / cache-write 0, hit 0.0%, cost $0.05",
      "  cumulative (1 rounds): total 40m 0s (AI 40m 0s), 1 tasks / 2 sessions",
      "  cumulative tokens in 2000 / out 400 / cache-read 0 / cache-write 0, hit 0.0%, cost $0.2",
    ])
  })

  test("dir 缺省/未装载: 空转返回 undefined,不落盘", async () => {
    expect(await roundCompleteLines(undefined)).toBeUndefined()
    expect(await taskEndLines(undefined, "T-001")).toBeUndefined()
    expect(await phaseCloseLines(undefined, "m")).toBeUndefined()
    expect(await Bun.file(join(dir, ".auto", "stats.json")).exists()).toBe(false)
  })
})

// ===== 代答高亮块(plans/0020-auto-resolve-design.md §H,T-006 的 H5/H6)=====
// 台账经 recordResolves/recordDecisions 直接播种(不走 runner 接线,那是 T-005 的
// 覆盖面),断言三个构造函数的置顶块文案、driver↔agent 合并、折叠计数与空转。
describe("代答高亮块 taskResolveLines / phaseResolveLines / roundResolveLines", () => {
  let dir: string

  const item = (partial: Partial<ResolveItem> & { question: string }): ResolveItem => ({
    at: 1_000_000,
    task: "T-001",
    phase: "m",
    round: 1,
    source: "agent",
    ...partial,
  })

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-resolve-lines-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("无代答: 三处一律返回空数组,不占版面", async () => {
    expect(await taskResolveLines(dir, "T-001")).toEqual([])
    expect(await phaseResolveLines(dir, "m")).toEqual([])
    expect(await roundResolveLines(dir)).toEqual([])
  })

  test("dir 缺省: 空转返回空数组,不落盘", async () => {
    expect(await taskResolveLines(undefined, "T-001")).toEqual([])
    expect(await phaseResolveLines(undefined, "m")).toEqual([])
    expect(await roundResolveLines(undefined)).toEqual([])
    expect(await Bun.file(join(dir, ".auto", "resolves.json")).exists()).toBe(false)
  })

  test("任务置顶块: 逐条列出 + 标记位置 + 完整记录指引", async () => {
    await recordResolves(dir, [
      item({
        question: "是否把 prompt.ts 的第三份 formatTokens 一并收口",
        option: "顺带收口",
        reason: "同层依赖,不引入反向 import",
        file: "src/prompt.ts:501",
      }),
      item({ question: "折旧入账是否同样过 MAX_TICK 钳制", option: "同样钳制", reason: "宁少不多" }),
    ])
    expect(await taskResolveLines(dir, "T-001")).toEqual([
      "⚑ this task auto-answered 2 questions that should have been confirmed by you; please review:",
      "  1. 是否把 prompt.ts 的第三份 formatTokens 一并收口 → 顺带收口(同层依赖,不引入反向 import)",
      "     src/prompt.ts:501",
      "  2. 折旧入账是否同样过 MAX_TICK 钳制 → 同样钳制(宁少不多)",
      `  full record in the "Proxy-answered questions" section of ${taskDoc("T-001", "report")}`,
    ])
  })

  test("未配对的 driver 项带 ⚠ 点名;已配对的被信息更全的 agent 项取代", async () => {
    await recordResolves(dir, [
      item({ source: "driver", question: "验收口径是否包含并发场景", session: "ses_1" }),
      item({ source: "driver", question: "折旧入账是否同样过 MAX_TICK 钳制", session: "ses_1", matched: true }),
      item({ question: "折旧入账是否同样过 MAX_TICK 钳制", option: "同样钳制", reason: "宁少不多" }),
    ])
    const lines = await taskResolveLines(dir, "T-001")
    expect(lines[0]).toBe("⚑ this task auto-answered 2 questions that should have been confirmed by you; please review:")
    expect(lines[1]).toBe("  1. 验收口径是否包含并发场景  ⚠ session did not write the AUTO-RESOLVE marker as required")
    expect(lines[2]).toBe("  2. 折旧入账是否同样过 MAX_TICK 钳制 → 同样钳制(宁少不多)")
  })

  test("AUTO-DECISION 计数折进末行;无代答时整块为空(计数不上终端)", async () => {
    await recordDecisions(dir, "T-001", 2)
    await recordDecisions(dir, "T-001", 3)
    // 只有 AUTO-DECISION、没有代答 → 空块(计数在会话收尾已进 vlog,§H-④)。
    expect(await taskResolveLines(dir, "T-001")).toEqual([])
    await recordResolves(dir, [item({ question: "是否收窄本任务范围", option: "不收窄", reason: "计划已写死" })])
    const lines = await taskResolveLines(dir, "T-001")
    expect(lines.at(-1)).toBe("  plus 5 AUTO-DECISION entries (folded, see task report)")
  })

  test("超 8 条截断为前 8 条 + 另有 N 条", async () => {
    await recordResolves(
      dir,
      Array.from({ length: 10 }, (_, i) => item({ question: `问题 ${i + 1}`, option: "方案", reason: "理由" })),
    )
    const lines = await taskResolveLines(dir, "T-001")
    expect(lines[1]).toBe("  1. 问题 1 → 方案(理由)")
    expect(lines[8]).toBe("  8. 问题 8 → 方案(理由)")
    expect(lines.at(-1)).toBe(`  …and 2 more, all in ${taskDoc("T-001", "report")}`)
  })

  test("阶段/轮次汇总: 只给计数与未标注数,不展示 AUTO-DECISION", async () => {
    await recordResolves(dir, [
      item({ task: "T-001", question: "问题甲", option: "方案", reason: "理由" }),
      item({ task: "T-002", question: "问题乙", option: "方案", reason: "理由" }),
      item({ task: "T-002", source: "driver", question: "问题丙" }),
    ])
    await recordDecisions(dir, "T-001", 9)
    expect(await phaseResolveLines(dir, "m")).toEqual([
      "⚑ phase m: 3 questions awaiting confirmation were auto-answered (1 not marked as required); see task reports for details",
    ])
    // 轮号取 currentRound 现查: 无 docs/R-NN 目录时为第 1 轮,与落账侧同源。
    expect(await roundResolveLines(dir)).toEqual([
      "⚑ round 1: 3 questions awaiting confirmation were auto-answered (1 not marked as required); see task reports for details",
    ])
  })

  test("桶身份过滤: 别的任务/阶段/轮次的条目不串台", async () => {
    await recordResolves(dir, [
      item({ task: "T-001", phase: "m", round: 1, question: "本桶问题", option: "方案", reason: "理由" }),
      item({ task: "T-002", phase: "t", round: 2, question: "别桶问题", option: "方案", reason: "理由" }),
    ])
    expect(await taskResolveLines(dir, "T-002")).toHaveLength(3)
    expect((await phaseResolveLines(dir, "m"))[0]).toContain("1 questions awaiting confirmation were auto-answered")
    expect((await roundResolveLines(dir))[0]).toContain("1 questions awaiting confirmation were auto-answered")
  })

  test("台账损坏: 吞成空块,不影响流程", async () => {
    await mkdir(join(dir, ".auto"), { recursive: true })
    await Bun.write(join(dir, ".auto", "resolves.json"), "{ 坏文件")
    expect(await taskResolveLines(dir, "T-001")).toEqual([])
    expect(await phaseResolveLines(dir, "m")).toEqual([])
    expect(await roundResolveLines(dir)).toEqual([])
  })
})
