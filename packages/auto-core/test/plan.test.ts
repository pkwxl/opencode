import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  begin,
  block,
  countSubtasks,
  load,
  markDone,
  next,
  parse,
  resetInProgress,
  setForkBase,
  setStatus,
  setSubtasks,
  subtasks,
  tick,
} from "../src/plan"

const SAMPLE = `# 示例计划

前言内容应被忽略。

## T-001: 搭建 schema [done]
  - verify: bun test
  - attempts: 2
数据层建模。

## T-002: 实现迁移 [blocked]
  - verify: bun test test/migrate.test.ts
  - blocked-at: 2026-08-20
  - question: "迁移策略选 A 还是 B?"
  - answer: "选 A"
  - attempts: 1
编写迁移脚本。

## T-003: 编写 API [pending]

REST 接口。
`

describe("parse", () => {
  const plan = parse("PLAN.md", SAMPLE)

  test("解析所有任务及状态", () => {
    expect(plan.tasks.map((t) => [t.id, t.status])).toEqual([
      ["T-001", "done"],
      ["T-002", "blocked"],
      ["T-003", "pending"],
    ])
  })

  test("解析字段与正文;已退役的 verify 字段行不进 Task(plans/0044 D3)", () => {
    const task = plan.tasks[1]!
    expect("verify" in task).toBe(false)
    expect(task.attempts).toBe(1)
    expect(task.body).toBe("编写迁移脚本。")
  })

  test("无字段任务", () => {
    const task = plan.tasks[2]!
    expect(task.attempts).toBe(0)
    expect(task.body).toBe("REST 接口。")
  })

  test("next 取第一个非 done 任务", () => {
    expect(next(plan)?.id).toBe("T-002")
    expect(next(parse("p", "## T-001: a [done]\n"))).toBeUndefined()
  })

  test("重复 ID 报错", () => {
    expect(() => parse("p", "## T-001: a [pending]\n## T-001: b [pending]\n")).toThrow("duplicate task id")
  })

  test("状态标记前缺空格的标题也能解析(不被吞进上一任务正文)", () => {
    const plan = parse("p", "## T-001: a [done]\n正文。\n## T-002: b[pending]\n## T-003: c [done]\n")
    expect(plan.tasks.map((t) => [t.id, t.title, t.status])).toEqual([
      ["T-001", "a", "done"],
      ["T-002", "b", "pending"],
      ["T-003", "c", "done"],
    ])
    expect(plan.tasks[0]!.body).toBe("正文。")
    expect(next(plan)?.id).toBe("T-002")
  })

  test("countSubtasks 统计正文中的检查项", () => {
    expect(countSubtasks("步骤:\n- [x] 甲\n- [ ] 乙\n  - [X] 丙\n- 普通列表\n")).toEqual({ done: 2, total: 3 })
    expect(countSubtasks("没有检查项")).toEqual({ done: 0, total: 0 })
  })

  test("subtasks 提取检查项文本与勾选状态", () => {
    expect(subtasks("- [x] 甲 done\n- [ ] 乙 pending\n- 普通列表\n")).toEqual([
      { text: "甲 done", done: true },
      { text: "乙 pending", done: false },
    ])
    expect(subtasks("没有检查项")).toEqual([])
  })
})

describe("edit", () => {
  let dir: string
  let path: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-plan-"))
    path = join(dir, "PLAN.md")
    await Bun.write(path, SAMPLE)
  })

  afterEach(() => rm(dir, { recursive: true, force: true }))

  test("begin 置为 in_progress 并累加 attempts", async () => {
    await begin(path, "T-003")
    const task = (await load(path)).tasks[2]!
    expect(task.status).toBe("in_progress")
    expect(task.attempts).toBe(1)
    await begin(path, "T-003")
    expect((await load(path)).tasks[2]!.attempts).toBe(2)
  })

  test("resetInProgress 重置中断遗留的 in_progress,保留字段", async () => {
    await begin(path, "T-003")
    const reset = await resetInProgress(path)
    expect(reset).toEqual(["T-003"])
    const task = (await load(path)).tasks[2]!
    expect(task.status).toBe("pending")
    expect(task.attempts).toBe(1)
    // 无 in_progress 时为 no-op;blocked/done 不受影响
    expect(await resetInProgress(path)).toEqual([])
    const plan = await load(path)
    expect(plan.tasks[0]!.status).toBe("done")
    expect(plan.tasks[1]!.status).toBe("blocked")
  })

  test("block 只改状态,并清除存量的 question/answer/blocked-at 三行", async () => {
    await block(path, "T-002")
    const task = (await load(path)).tasks[1]!
    expect(task.status).toBe("blocked")
    expect(task.attempts).toBe(1)
    // 阻塞原因不再写进 PLAN.md,存量三行一并清除
    const text = await Bun.file(path).text()
    expect(text).not.toContain("question:")
    expect(text).not.toContain("answer:")
    expect(text).not.toContain("blocked-at:")
    // 其它字段(含遗留的 verify 行)与其它任务不受影响
    expect(text).toContain("  - verify: bun test test/migrate.test.ts")
    expect((await load(path)).tasks[0]!.status).toBe("done")
  })

  test("setStatus 保留字段与正文", async () => {
    await setStatus(path, "T-002", "done")
    const task = (await load(path)).tasks[1]!
    expect(task.status).toBe("done")
    expect(task.body).toBe("编写迁移脚本。")
    expect(await Bun.file(path).text()).toContain("  - verify: bun test test/migrate.test.ts")
  })

  test("操作不存在的任务报错", async () => {
    expect(setStatus(path, "T-999", "done")).rejects.toThrow("not found")
  })

  test("setSubtasks 注入检查项并保留正文描述", async () => {
    await setSubtasks(path, "T-003", ["实现路由", "编写文档"])
    const task = (await load(path)).tasks[2]!
    expect(task.body).toBe("REST 接口。\n\n- [ ] 实现路由\n- [ ] 编写文档")
  })

  test("setSubtasks 替换已有检查项(含已勾选)", async () => {
    await setSubtasks(path, "T-003", ["旧项"])
    await tick(path, "T-003", "旧项")
    await setSubtasks(path, "T-003", ["新项"])
    const task = (await load(path)).tasks[2]!
    expect(subtasks(task.body)).toEqual([{ text: "新项", done: false }])
  })

  test("tick 勾选指定检查项,其他项不受影响", async () => {
    await setSubtasks(path, "T-003", ["甲", "乙"])
    await tick(path, "T-003", "甲")
    expect(subtasks((await load(path)).tasks[2]!.body)).toEqual([
      { text: "甲", done: true },
      { text: "乙", done: false },
    ])
    // 重复勾选或勾选不存在的项报错
    expect(tick(path, "T-003", "甲")).rejects.toThrow("no unticked subtask")
    expect(tick(path, "T-003", "丙")).rejects.toThrow("no unticked subtask")
  })

  test("markDone 只改状态;遗留的 verify/verified 字段行原样保留(plans/0044 D3)", async () => {
    await Bun.write(path, "## T-001: a [pending]\n  - verify: bun test\n  - verified: bun test\n正文。\n")
    await markDone(path, "T-001")
    const text = await Bun.file(path).text()
    expect(text).toBe("## T-001: a [done]\n  - verify: bun test\n  - verified: bun test\n正文。\n")
  })
})

describe("遗留字段与终审编号(plans/0044 D3/D4)", () => {
  let dir: string
  let path: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-plan-legacy-"))
    path = join(dir, "PLAN.md")
    await Bun.write(path, SAMPLE)
  })

  afterEach(() => rm(dir, { recursive: true, force: true }))

  test("未完成的 T-F<k> 终审任务按普通任务解析与执行;final 字段行经 begin/markDone 原样保留", async () => {
    await Bun.write(path, "## T-001: a [done]\n正文。\n\n## T-F1: 终审审计(第 1 轮) [pending]\n  - final: audit@1\n审计。\n")
    const plan = await load(path)
    expect(next(plan)?.id).toBe("T-F1")
    expect("final" in plan.tasks[1]!).toBe(false)
    await begin(path, "T-F1")
    await markDone(path, "T-F1")
    const text = await Bun.file(path).text()
    expect(text).toContain("## T-F1: 终审审计(第 1 轮) [done]\n  - final: audit@1\n  - attempts: 1\n")
  })

  test("edit 重写时未知字段行同样保留", async () => {
    await Bun.write(path, "## T-009: x [pending]\n  - note: 自定义\n正文。\n")
    await setStatus(path, "T-009", "done")
    const text = await Bun.file(path).text()
    expect(text).toContain("  - note: 自定义")
    expect(text).toContain("[done]")
  })
})

describe("fork-base 字段(fork 分解流水线)", () => {
  let dir: string
  let path: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-plan-fork-"))
    path = join(dir, "PLAN.md")
    await Bun.write(path, SAMPLE)
  })

  afterEach(() => rm(dir, { recursive: true, force: true }))

  test("parse 解析 fork-base 字段;缺省为 undefined", () => {
    expect(parse("p", "## T-001: a [pending]\n  - fork-base: ses_x\n正文。\n").tasks[0]!.forkBase).toBe("ses_x")
    expect(parse("p", "## T-001: a [pending]\n正文。\n").tasks[0]!.forkBase).toBeUndefined()
  })

  test("setForkBase 写入字段;覆写更新;与其他字段往返保留", async () => {
    await setForkBase(path, "T-003", "ses_understand")
    let task = (await load(path)).tasks[2]!
    expect(task.forkBase).toBe("ses_understand")
    expect(task.status).toBe("pending")
    // digest 模式每次运行重建基点 → 覆写
    await setForkBase(path, "T-003", "ses_ctxbase")
    task = (await load(path)).tasks[2]!
    expect(task.forkBase).toBe("ses_ctxbase")
    // 其他 driver 写入(状态/勾选)不丢字段
    await setStatus(path, "T-003", "in_progress")
    await begin(path, "T-003")
    task = (await load(path)).tasks[2]!
    expect(task.forkBase).toBe("ses_ctxbase")
    expect(task.attempts).toBe(1)
    expect((await Bun.file(path).text())).toContain("  - fork-base: ses_ctxbase")
  })
})
