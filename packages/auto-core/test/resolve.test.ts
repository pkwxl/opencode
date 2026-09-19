import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  collectAgentResolves,
  decisionsOf,
  parseResolveLine,
  recordDecisions,
  recordResolves,
  resolveHighlight,
  resolvesOf,
  sameIssue,
  setResolveClock,
  type ResolveDoc,
  type ResolveItem,
} from "../src/resolve"

// T-004 覆盖: src/resolve.ts 全量(标记解析/台账落盘/会话收尾扫描/读回/高亮报文)。
// driver 侧采集接线(H1..H4)的用例在 T-005 的 test/runner.test.ts 追加。

async function git(dir: string, ...args: string[]) {
  const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(`git ${args.join(" ")} 退出码 ${code}: ${err || out}`)
  return out
}

function driverItem(question: string, over: Partial<ResolveItem> = {}): ResolveItem {
  return { at: 1, task: "T-001", phase: "m", round: 1, source: "driver", question, ...over }
}

function agentItem(question: string, over: Partial<ResolveItem> = {}): ResolveItem {
  return { at: 1, task: "T-001", phase: "m", round: 1, source: "agent", question, ...over }
}

describe("parseResolveLine", () => {
  test("完整三段: 问题 / 所选方案 / 理由", () => {
    expect(parseResolveLine("AUTO-RESOLVE: 是否顺带收口第三份 formatTokens -> 顺带收口 (同层依赖)")).toEqual({
      question: "是否顺带收口第三份 formatTokens",
      option: "顺带收口",
      reason: "同层依赖",
    })
  })

  test("分隔符三种写法与中文括号等价", () => {
    const arrows = ["->", "→", "=>"]
    for (const arrow of arrows) {
      expect(parseResolveLine(`AUTO-RESOLVE: 问题 ${arrow} 方案(理由)`)).toEqual({
        question: "问题",
        option: "方案",
        reason: "理由",
      })
    }
  })

  test("行内前缀(代码注释 / markdown 列表项 / 反引号包裹)同等有效", () => {
    expect(parseResolveLine("// AUTO-RESOLVE: 问题 -> 方案 (理由)")?.question).toBe("问题")
    expect(parseResolveLine("- **AUTO-RESOLVE**: 问题 -> 方案 (理由)")?.question).toBe("问题")
    expect(parseResolveLine("`AUTO-RESOLVE: 问题 -> 方案 (理由)`")).toEqual({
      question: "问题",
      option: "方案",
      reason: "理由",
    })
  })

  test("无箭头: 整行作问题、标 malformed(仍然计数)", () => {
    expect(parseResolveLine("AUTO-RESOLVE: 验收口径是否包含并发场景")).toEqual({
      question: "验收口径是否包含并发场景",
      malformed: true,
    })
  })

  test("无理由段: 保留所选方案、标 malformed", () => {
    expect(parseResolveLine("AUTO-RESOLVE: 问题 -> 方案")).toEqual({
      question: "问题",
      option: "方案",
      reason: undefined,
      malformed: true,
    })
  })

  test("无标记 / 空正文 / 纯占位样例行返回 undefined", () => {
    expect(parseResolveLine("AUTO-DECISION: 新字段叫 matched 还是 paired(不改变可见行为)")).toBeUndefined()
    expect(parseResolveLine("这行没有任何标记")).toBeUndefined()
    expect(parseResolveLine("AUTO-RESOLVE:")).toBeUndefined()
    expect(parseResolveLine("AUTO-RESOLVE: <原问题> -> <所选方案> (<理由>)")).toBeUndefined()
  })
})

describe("sameIssue", () => {
  test("归一化后全等或互为子串视为同一问题", () => {
    expect(sameIssue("是否 顺带收口?", "是否顺带收口?")).toBe(true)
    expect(sameIssue("是否顺带收口", "请问是否顺带收口第三份 formatTokens")).toBe(true)
    expect(sameIssue("折旧是否钳制", "验收口径是否含并发")).toBe(false)
  })
})

describe("台账落盘", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-resolve-"))
    setResolveClock(() => 1_000)
  })

  afterEach(async () => {
    setResolveClock()
    await rm(dir, { recursive: true, force: true })
  })

  async function readDoc(): Promise<ResolveDoc> {
    return JSON.parse(await Bun.file(join(dir, ".auto", "resolves.json")).text()) as ResolveDoc
  }

  test("dir === undefined 全部空转", async () => {
    await recordResolves(undefined, [driverItem("问题")])
    expect(await resolvesOf(undefined, "task", "T-001")).toEqual([])
    expect(await collectAgentResolves(undefined, { task: "T-001" })).toEqual({ resolves: 0, decisions: 0 })
  })

  test("往返: 落账后可按任务读回", async () => {
    await recordResolves(dir, [driverItem("是否顺带收口", { session: "ses_1" })])
    const doc = await readDoc()
    expect(doc.v).toBe(1)
    expect(doc.items).toHaveLength(1)
    expect(doc.items[0]).toMatchObject({ task: "T-001", source: "driver", question: "是否顺带收口", session: "ses_1" })
    expect(await resolvesOf(dir, "task", "T-001")).toHaveLength(1)
  })

  test("去重: 同一来源同一任务的同一问题两次落账只留一条,缺失字段被补齐", async () => {
    await recordResolves(dir, [agentItem("是否 顺带 收口")])
    await recordResolves(dir, [agentItem("是否顺带收口", { option: "顺带收口", reason: "同层依赖" })])
    const doc = await readDoc()
    expect(doc.items).toHaveLength(1)
    expect(doc.items[0]).toMatchObject({ option: "顺带收口", reason: "同层依赖" })
  })

  test("同一问题 driver 与 agent 两源各留一条(来源不同即不同条目)", async () => {
    await recordResolves(dir, [driverItem("是否顺带收口"), agentItem("是否顺带收口")])
    expect((await readDoc()).items).toHaveLength(2)
  })

  test("坏文件宽容: 非 JSON / 条目坏字段不 throw,从当下重开", async () => {
    await mkdir(join(dir, ".auto"), { recursive: true })
    await writeFile(join(dir, ".auto", "resolves.json"), "{ 这不是 JSON")
    await recordResolves(dir, [driverItem("问题一")])
    expect((await readDoc()).items).toHaveLength(1)

    await writeFile(
      join(dir, ".auto", "resolves.json"),
      JSON.stringify({ v: 1, items: [null, { question: 42 }, { question: "好条目", at: "坏", round: "坏" }] }),
    )
    await recordResolves(dir, [driverItem("问题二")])
    const items = (await readDoc()).items
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ question: "好条目", at: 0, round: 0, source: "driver" })
  })

  test("总量上限 512 FIFO 淘汰最旧", async () => {
    await recordResolves(
      dir,
      Array.from({ length: 520 }, (_, i) => driverItem(`问题 ${i}`)),
    )
    const items = (await readDoc()).items
    expect(items).toHaveLength(512)
    expect(items[0]!.question).toBe("问题 8")
    expect(items.at(-1)!.question).toBe("问题 519")
  })

  test("并发写: 条目不丢,且不留 .tmp 残留", async () => {
    await Promise.all([
      recordResolves(dir, [driverItem("问题一")]),
      recordResolves(dir, [driverItem("问题二")]),
      recordResolves(dir, [driverItem("问题三")]),
    ])
    expect((await readDoc()).items).toHaveLength(3)
    expect((await readdir(join(dir, ".auto"))).filter((name) => name.includes(".tmp"))).toEqual([])
  })

  test("resolvesOf 三 scope 过滤;空 id 守卫返回空", async () => {
    await recordResolves(dir, [
      driverItem("问题一", { task: "T-001", phase: "m", round: 1 }),
      driverItem("问题二", { task: "T-002", phase: "t", round: 1 }),
      driverItem("问题三", { task: "T-003", phase: "m", round: 2 }),
    ])
    expect((await resolvesOf(dir, "task", "T-002")).map((item) => item.question)).toEqual(["问题二"])
    expect((await resolvesOf(dir, "phase", "m")).map((item) => item.question)).toEqual(["问题一", "问题三"])
    expect((await resolvesOf(dir, "round", 1)).map((item) => item.question)).toEqual(["问题一", "问题二"])
    expect(await resolvesOf(dir, "phase", "")).toEqual([])
  })
})

describe("collectAgentResolves", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-resolve-scan-"))
    setResolveClock(() => 2_000)
  })

  afterEach(async () => {
    setResolveClock()
    await rm(dir, { recursive: true, force: true })
  })

  async function readItems(): Promise<ResolveItem[]> {
    const raw = await Bun.file(join(dir, ".auto", "resolves.json")).text().catch(() => undefined)
    return raw ? (JSON.parse(raw) as ResolveDoc).items : []
  }

  test("非 git 目录: 空转不报错、不落账", async () => {
    await writeFile(join(dir, "note.md"), "AUTO-RESOLVE: 问题 -> 方案 (理由)\n")
    expect(await collectAgentResolves(dir, { task: "T-001", phase: "m", round: 1 })).toEqual({
      resolves: 0,
      decisions: 0,
    })
    expect(await readItems()).toEqual([])
  })

  test("AUTO-RESOLVE 落账并带 路径:行号;AUTO-DECISION 只计数不落账", async () => {
    await git(dir, "init", "-q")
    await writeFile(
      join(dir, "note.md"),
      ["# 报告", "", "- AUTO-RESOLVE: 是否顺带收口 -> 顺带收口 (同层依赖)", "- AUTO-DECISION: 字段命名取 matched (与 schema 一致)", ""].join("\n"),
    )
    await writeFile(join(dir, "code.ts"), "// AUTO-DECISION: 用正则逐行扫描 (与 refcheck 同量级)\n")
    const counts = await collectAgentResolves(dir, { task: "T-001", phase: "m", round: 1 })
    expect(counts).toEqual({ resolves: 1, decisions: 2 })
    const items = await readItems()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      source: "agent",
      task: "T-001",
      phase: "m",
      round: 1,
      question: "是否顺带收口",
      option: "顺带收口",
      reason: "同层依赖",
      file: "note.md:3",
    })
  })

  test("二进制与超过 2MB 的文件跳过", async () => {
    await git(dir, "init", "-q")
    await Bun.write(join(dir, "blob.bin"), new Uint8Array([65, 0, 66, 67]))
    await writeFile(join(dir, "huge.md"), `AUTO-RESOLVE: 巨文件里的问题 -> 方案 (理由)\n${"x".repeat(2 * 1024 * 1024)}`)
    expect(await collectAgentResolves(dir, { task: "T-001", round: 1 })).toEqual({ resolves: 0, decisions: 0 })
    expect(await readItems()).toEqual([])
  })

  test("嵌套子仓库的变更同样被采集", async () => {
    await git(dir, "init", "-q")
    await mkdir(join(dir, "pkg"), { recursive: true })
    await git(join(dir, "pkg"), "init", "-q")
    await writeFile(join(dir, "pkg", "inner.md"), "AUTO-RESOLVE: 嵌套仓库里的问题 -> 方案 (理由)\n")
    const counts = await collectAgentResolves(dir, { task: "T-001", round: 1 })
    expect(counts.resolves).toBe(1)
    expect((await readItems())[0]).toMatchObject({ question: "嵌套仓库里的问题", file: join("pkg", "inner.md") + ":1" })
  })

  test("driver 项经 sameIssue 配对置 matched;未配对的保持未标注", async () => {
    await git(dir, "init", "-q")
    await recordResolves(dir, [
      driverItem("是否把第三份 formatTokens 一并收口?"),
      driverItem("验收口径是否包含并发场景?"),
    ])
    await writeFile(join(dir, "report.md"), "AUTO-RESOLVE: 是否把第三份 formatTokens 一并收口 -> 顺带收口 (同层依赖)\n")
    await collectAgentResolves(dir, { task: "T-001", phase: "m", round: 1 })
    const items = await readItems()
    const driver = items.filter((item) => item.source === "driver")
    expect(driver.find((item) => item.question.includes("formatTokens"))!.matched).toBe(true)
    expect(driver.find((item) => item.question.includes("并发"))!.matched).toBeUndefined()
  })
})

describe("resolveHighlight", () => {
  test("空列表返回空(没有代答就不占版面)", () => {
    expect(resolveHighlight([])).toEqual([])
    expect(resolveHighlight([driverItem("问题", { matched: true })])).toEqual([])
  })

  test("任务块: 置顶标题 + 逐条方案理由 + 标记位置 + 报告指引", () => {
    const lines = resolveHighlight([
      agentItem("是否顺带收口第三份 formatTokens", {
        option: "顺带收口",
        reason: "同层依赖,不引入反向 import",
        file: "src/prompt.ts:501",
      }),
    ])
    expect(lines[0]).toBe("⚑ 本任务自动代答了 1 个本应由你确认的问题,请重点确认:")
    expect(lines[1]).toBe("  1. 是否顺带收口第三份 formatTokens → 顺带收口(同层依赖,不引入反向 import)")
    expect(lines[2]).toBe("     src/prompt.ts:501")
    expect(lines[3]).toBe(`  完整记录见 ${join("docs", "T-001", "report.md")} 的「自动代答问题」节`)
  })

  test("未配对 driver 项与 malformed agent 项各自带 ⚠", () => {
    const lines = resolveHighlight([
      driverItem("验收口径是否包含并发场景"),
      agentItem("折旧是否同样钳制", { malformed: true }),
    ])
    expect(lines[1]).toContain("⚠ 会话未按要求写出 AUTO-RESOLVE 标记")
    expect(lines[2]).toContain("⚠ 格式不规范")
  })

  test("超过 8 条只列前 8 条,末行给出剩余条数与报告路径", () => {
    const items = Array.from({ length: 11 }, (_, i) => agentItem(`问题 ${i}`, { option: "方案", reason: "理由" }))
    const lines = resolveHighlight(items)
    expect(lines[0]).toContain("11 个")
    expect(lines).toHaveLength(1 + 8 + 1)
    expect(lines.at(-1)).toBe(`  …另有 3 条,全部见 ${join("docs", "T-001", "report.md")}`)
  })

  test("AUTO-DECISION 计数折进末行,且被截断为单行的长问题带省略号", () => {
    const long = "问".repeat(120)
    const lines = resolveHighlight([agentItem(`${long}\n换行也压平`, { option: "方案", reason: "理由" })], {
      decisions: 5,
    })
    expect(lines[1]).toContain("…")
    expect(lines[1]).not.toContain("\n")
    expect(lines.at(-1)).toBe("  另记录 AUTO-DECISION 5 条(已折叠,见任务报告)")
  })

  test("阶段/轮次汇总只给一行计数,未标注项单独点名", () => {
    const items = [
      agentItem("问题一", { option: "方案", reason: "理由" }),
      driverItem("问题二"),
      agentItem("问题三", { option: "方案", reason: "理由" }),
    ]
    expect(resolveHighlight(items, { scope: "phase", id: "m" })).toEqual([
      "⚑ 阶段 m 共自动代答 3 个待确认问题(其中 1 个未按要求标注),逐条见各任务报告",
    ])
    expect(resolveHighlight([agentItem("问题一", { option: "方案", reason: "理由" })], { scope: "round", id: 2 })).toEqual([
      "⚑ 第 2 轮共自动代答 1 个待确认问题,逐条见各任务报告",
    ])
  })
})

// T-006 追加: 逐任务 AUTO-DECISION 计数(高亮块末行的折叠数字)。行级明细仍不落账,
// 落的只是每个任务一个整数。
describe("AUTO-DECISION 计数", () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-resolve-count-"))
    setResolveClock(() => 2_000)
  })

  afterEach(async () => {
    setResolveClock()
    await rm(dir, { recursive: true, force: true })
  })

  test("逐任务累加、互不串台;dir/任务缺省或计数非正时空转", async () => {
    await recordDecisions(dir, "T-001", 2)
    await recordDecisions(dir, "T-001", 3)
    await recordDecisions(dir, "T-002", 1)
    expect(await decisionsOf(dir, "T-001")).toBe(5)
    expect(await decisionsOf(dir, "T-002")).toBe(1)
    expect(await decisionsOf(dir, "T-003")).toBe(0)
    await recordDecisions(dir, "T-001", 0)
    await recordDecisions(dir, "", 4)
    await recordDecisions(undefined, "T-001", 4)
    expect(await decisionsOf(dir, "T-001")).toBe(5)
    expect(await decisionsOf(undefined, "T-001")).toBe(0)
  })

  test("扫描把计数与标记落进同一次写", async () => {
    await git(dir, "init", "-q")
    await writeFile(
      join(dir, "report.md"),
      [
        "AUTO-RESOLVE: 是否收窄范围 -> 不收窄 (计划已写死)",
        "AUTO-DECISION: 新字段命名 matched (与 schema 注释同词)",
        "AUTO-DECISION: 扫描按行正则 (与 refcheck 同量级)",
      ].join("\n"),
    )
    expect(await collectAgentResolves(dir, { task: "T-007", phase: "m", round: 1 })).toEqual({
      resolves: 1,
      decisions: 2,
    })
    expect(await decisionsOf(dir, "T-007")).toBe(2)
    expect((await resolvesOf(dir, "task", "T-007")).map((item) => item.question)).toEqual(["是否收窄范围"])
    // 二次扫描(同一批改动仍未提交)累加计数,标记侧由去重键吸收——`--commit false`
    // 下计数偏大是已接受边界(plans/0020-auto-resolve-design.md §K)。
    await collectAgentResolves(dir, { task: "T-007", phase: "m", round: 1 })
    expect(await decisionsOf(dir, "T-007")).toBe(4)
    expect(await resolvesOf(dir, "task", "T-007")).toHaveLength(1)
  })

  test("坏计数宽容: 非对象/负值/非数值逐键跳过,不影响 items 读回", async () => {
    await mkdir(join(dir, ".auto"), { recursive: true })
    await Bun.write(
      join(dir, ".auto", "resolves.json"),
      JSON.stringify({
        v: 1,
        items: [agentItem("问题", { option: "方案", reason: "理由" })],
        decisions: { "T-001": -3, "T-002": "五", "T-003": 4.7, "": 9 },
      }),
    )
    expect(await decisionsOf(dir, "T-001")).toBe(0)
    expect(await decisionsOf(dir, "T-002")).toBe(0)
    expect(await decisionsOf(dir, "T-003")).toBe(4)
    expect(await resolvesOf(dir, "task", "T-001")).toHaveLength(1)
  })
})
