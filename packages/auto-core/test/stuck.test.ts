import { describe, expect, test } from "bun:test"
import { createStuckTracker, STUCK_ERROR_REPEAT, STUCK_MAX_HINTS, STUCK_SAME_REPEAT, type StuckCall } from "../src/stuck"

const fail = (over: Partial<StuckCall> = {}): StuckCall => ({
  tool: "edit",
  input: { filePath: "src/a.ts", oldString: "foo" },
  status: "error",
  result: "String not found in file",
  ...over,
})

const ok = (over: Partial<StuckCall> = {}): StuckCall => ({
  tool: "read",
  input: { filePath: "src/a.ts" },
  status: "completed",
  result: "1: export const a = 1",
  ...over,
})

describe("createStuckTracker(同报错重复)", () => {
  test(`同一工具同一报错第 ${STUCK_ERROR_REPEAT} 次才命中,之前静默`, () => {
    const tracker = createStuckTracker()
    for (let i = 1; i < STUCK_ERROR_REPEAT; i++) expect(tracker.observe(fail())).toBeUndefined()
    const hit = tracker.observe(fail())
    expect(hit).toBeDefined()
    expect(hit).toMatchObject({ kind: "error", tool: "edit", count: STUCK_ERROR_REPEAT, level: 1 })
    expect(hit!.detail).toContain("String not found")
    expect(hit!.input).toContain("src/a.ts")
  })

  test("参数微调但报错一字不差同样计数(弱模型典型形态)", () => {
    const tracker = createStuckTracker()
    tracker.observe(fail({ input: { filePath: "src/a.ts", oldString: "foo" } }))
    tracker.observe(fail({ input: { filePath: "src/a.ts", oldString: "foo " } }))
    expect(tracker.observe(fail({ input: { filePath: "src/a.ts", oldString: " foo" } }))).toMatchObject({
      kind: "error",
      count: 3,
    })
  })

  test("报错文本仅排版/大小写不同视为同一个报错", () => {
    const tracker = createStuckTracker()
    tracker.observe(fail({ result: "String not found in file" }))
    tracker.observe(fail({ result: "String  not found\nin file" }))
    expect(tracker.observe(fail({ result: "STRING NOT FOUND IN FILE" }))).toMatchObject({ kind: "error" })
  })

  test("报错不同视为有进展,不计数", () => {
    const tracker = createStuckTracker()
    expect(tracker.observe(fail({ result: "错误 A" }))).toBeUndefined()
    expect(tracker.observe(fail({ result: "错误 B" }))).toBeUndefined()
    expect(tracker.observe(fail({ result: "错误 C" }))).toBeUndefined()
  })

  test("不同工具各记各的", () => {
    const tracker = createStuckTracker()
    for (const tool of ["edit", "write", "bash"]) expect(tracker.observe(fail({ tool }))).toBeUndefined()
  })
})

describe("createStuckTracker(同参同果重复)", () => {
  test(`参数与输出都相同第 ${STUCK_SAME_REPEAT} 次才命中(阈值高于报错一档)`, () => {
    const tracker = createStuckTracker()
    for (let i = 1; i < STUCK_SAME_REPEAT; i++) expect(tracker.observe(ok())).toBeUndefined()
    expect(tracker.observe(ok())).toMatchObject({ kind: "repeat", tool: "read", count: STUCK_SAME_REPEAT, level: 1 })
  })

  test("参数键序不影响签名", () => {
    const tracker = createStuckTracker({ sameRepeat: 2 })
    tracker.observe(ok({ input: { filePath: "src/a.ts", limit: 20 } }))
    expect(tracker.observe(ok({ input: { limit: 20, filePath: "src/a.ts" } }))).toMatchObject({ kind: "repeat" })
  })

  test("输出有变化即视为有进展,不计数", () => {
    const tracker = createStuckTracker({ sameRepeat: 2 })
    tracker.observe(ok({ result: "第一版内容" }))
    expect(tracker.observe(ok({ result: "第二版内容" }))).toBeUndefined()
  })

  test("参数不同不计数(同一工具读不同文件是正常工作)", () => {
    const tracker = createStuckTracker({ sameRepeat: 2 })
    tracker.observe(ok({ input: { filePath: "src/a.ts" } }))
    expect(tracker.observe(ok({ input: { filePath: "src/b.ts" } }))).toBeUndefined()
  })
})

describe("createStuckTracker(提示节奏)", () => {
  test("命中后计数清零: 需再犯满一轮才再次提示,level 递增", () => {
    const tracker = createStuckTracker({ errorRepeat: 2 })
    tracker.observe(fail())
    expect(tracker.observe(fail())).toMatchObject({ level: 1 })
    expect(tracker.observe(fail())).toBeUndefined()
    expect(tracker.observe(fail())).toMatchObject({ level: 2, count: 2 })
  })

  test(`每会话最多 ${STUCK_MAX_HINTS} 次提示,之后静默`, () => {
    const tracker = createStuckTracker({ errorRepeat: 1 })
    const levels = Array.from({ length: STUCK_MAX_HINTS + 2 }, () => tracker.observe(fail())?.level)
    expect(levels).toEqual([...Array.from({ length: STUCK_MAX_HINTS }, (_, i) => i + 1), undefined, undefined])
  })

  test("检测器是会话级的: 新实例从零起算", () => {
    const first = createStuckTracker({ errorRepeat: 2 })
    first.observe(fail())
    const second = createStuckTracker({ errorRepeat: 2 })
    expect(second.observe(fail())).toBeUndefined()
  })
})

describe("createStuckTracker(边界)", () => {
  test("无参数与空输出不报错,摘要为空串(交模板渲染占位)", () => {
    const tracker = createStuckTracker({ errorRepeat: 1 })
    const hit = tracker.observe({ tool: "bash", status: "error", result: "" })
    expect(hit).toMatchObject({ kind: "error", tool: "bash" })
    expect(hit!.detail).toBe("")
    expect(hit!.input).toBe("")
  })

  test("超长参数与输出截断", () => {
    const tracker = createStuckTracker({ errorRepeat: 1 })
    const hit = tracker.observe(fail({ input: { text: "x".repeat(5000) }, result: "y".repeat(5000) }))
    expect(hit!.input.length).toBeLessThan(400)
    expect(hit!.detail.length).toBeLessThan(900)
    expect(hit!.detail).toContain("已截断")
  })

  test("循环引用的参数不抛异常", () => {
    const tracker = createStuckTracker({ errorRepeat: 1 })
    const input: Record<string, unknown> = { name: "a" }
    input.self = input
    expect(tracker.observe(fail({ input }))).toMatchObject({ kind: "error" })
  })
})
