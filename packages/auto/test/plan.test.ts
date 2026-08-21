import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  appendSubtask,
  begin,
  block,
  countSubtasks,
  load,
  markDone,
  next,
  parse,
  setStatus,
  setSubtasks,
  subtasks,
  subtaskVerify,
  tick,
  verifyCommand,
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

  test("解析字段与正文", () => {
    const task = plan.tasks[1]!
    expect(task.verify).toBe("bun test test/migrate.test.ts")
    expect(task.question).toBe("迁移策略选 A 还是 B?")
    expect(task.answer).toBe("选 A")
    expect(task.attempts).toBe(1)
    expect(task.body).toBe("编写迁移脚本。")
  })

  test("无字段任务", () => {
    const task = plan.tasks[2]!
    expect(task.verify).toBeUndefined()
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

  test("block 写入问题并清除旧 answer", async () => {
    await block(path, "T-002", "新的问题?\n第二行")
    const task = (await load(path)).tasks[1]!
    expect(task.status).toBe("blocked")
    expect(task.question).toBe("新的问题? 第二行")
    expect(task.answer).toBeUndefined()
    expect(task.attempts).toBe(1)
    // 其它字段与其它任务不受影响
    expect(task.verify).toBe("bun test test/migrate.test.ts")
    expect((await load(path)).tasks[0]!.status).toBe("done")
  })

  test("含引号的问题可往返", async () => {
    await block(path, "T-003", '选择 "A" 还是 "B"?')
    expect((await load(path)).tasks[2]!.question).toBe('选择 "A" 还是 "B"?')
  })

  test("setStatus 保留字段与正文", async () => {
    await setStatus(path, "T-002", "done")
    const task = (await load(path)).tasks[1]!
    expect(task.status).toBe("done")
    expect(task.body).toBe("编写迁移脚本。")
    expect(task.question).toBe("迁移策略选 A 还是 B?")
  })

  test("操作不存在的任务报错", async () => {
    expect(setStatus(path, "T-999", "done")).rejects.toThrow("not found")
  })

  test("setSubtasks 注入检查项并保留正文描述", async () => {
    await setSubtasks(path, "T-003", ["实现路由 (verify: `bun test`)", "编写文档 (verify: `bun typecheck`)"])
    const task = (await load(path)).tasks[2]!
    expect(task.body).toBe(
      "REST 接口。\n\n- [ ] 实现路由 (verify: `bun test`)\n- [ ] 编写文档 (verify: `bun typecheck`)",
    )
  })

  test("setSubtasks 替换已有检查项(含已勾选)", async () => {
    await setSubtasks(path, "T-003", ["旧项 (verify: `bun test`)"])
    await tick(path, "T-003", "旧项 (verify: `bun test`)")
    await setSubtasks(path, "T-003", ["新项 (verify: `bun test`)"])
    const task = (await load(path)).tasks[2]!
    expect(subtasks(task.body)).toEqual([{ text: "新项 (verify: `bun test`)", done: false }])
  })

  test("tick 勾选指定检查项,其他项不受影响", async () => {
    await setSubtasks(path, "T-003", ["甲 (verify: `bun test`)", "乙 (verify: `bun test`)"])
    await tick(path, "T-003", "甲 (verify: `bun test`)")
    expect(subtasks((await load(path)).tasks[2]!.body)).toEqual([
      { text: "甲 (verify: `bun test`)", done: true },
      { text: "乙 (verify: `bun test`)", done: false },
    ])
    // 重复勾选或勾选不存在的项报错
    expect(tick(path, "T-003", "甲 (verify: `bun test`)")).rejects.toThrow("no unticked subtask")
    expect(tick(path, "T-003", "丙")).rejects.toThrow("no unticked subtask")
  })

  test("appendSubtask 追加修复子任务", async () => {
    await setSubtasks(path, "T-003", ["甲 (verify: `bun test`)"])
    await appendSubtask(path, "T-003", "修复验收失败 (verify: `bun test`)")
    expect(subtasks((await load(path)).tasks[2]!.body).map((item) => item.text)).toEqual([
      "甲 (verify: `bun test`)",
      "修复验收失败 (verify: `bun test`)",
    ])
  })

  test("markDone 标 done 并按有无 verified 写/清字段", async () => {
    await markDone(path, "T-003", "bun test")
    const done = (await load(path)).tasks[2]!
    expect(done.status).toBe("done")
    expect(done.verified).toBe("bun test")
    // 无命令的路径清除 verified,不残留旧记录
    await markDone(path, "T-001")
    const cleared = (await load(path)).tasks[0]!
    expect(cleared.status).toBe("done")
    expect(cleared.verified).toBeUndefined()
    expect(cleared.verify).toBe("bun test")
  })
})

describe("verify 命令提取", () => {
  test("subtaskVerify 提取检查项尾部的 verify 命令", () => {
    expect(subtaskVerify("实现路由 (verify: `bun test test/api.test.ts`)")).toBe("bun test test/api.test.ts")
    expect(subtaskVerify("实现路由")).toBeUndefined()
    expect(subtaskVerify("实现路由 (verify: `bun test`) 后面还有字")).toBeUndefined()
  })

  test("verifyCommand 只认 command: 前缀", () => {
    const task = (id: string, verify?: string) =>
      parse("p", `## ${id}: t [pending]\n${verify ? `  - verify: ${verify}\n` : ""}正文。\n`).tasks[0]!
    expect(verifyCommand(task("T-1", "command: bun test"))).toBe("bun test")
    expect(verifyCommand(task("T-2", " bun test 应通过"))).toBeUndefined()
    expect(verifyCommand(task("T-3"))).toBeUndefined()
  })
})
