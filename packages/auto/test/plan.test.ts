import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { begin, block, countSubtasks, load, next, parse, setStatus } from "../src/plan"

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
})
