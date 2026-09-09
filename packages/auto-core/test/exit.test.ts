import { afterEach, describe, expect, test } from "bun:test"
import { ExitRequested, exitRequested, maybeExit, requestExit, resetExitRequest } from "../src/exit"

describe("exit(/exit 请求的单进程一次性标记)", () => {
  afterEach(() => {
    resetExitRequest()
  })

  test("未置位时 exitRequested 为 false,maybeExit 不抛出", () => {
    expect(exitRequested()).toBe(false)
    expect(() => maybeExit("task", "任务 T-001 示例")).not.toThrow()
  })

  test("requestExit 后 exitRequested 为 true", () => {
    requestExit()
    expect(exitRequested()).toBe(true)
  })

  test("置位后 maybeExit 抛出 ExitRequested,携带边界与标签", () => {
    requestExit()
    let caught: unknown
    try {
      maybeExit("subtask", "T-001 子任务 2")
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ExitRequested)
    const error = caught as ExitRequested
    expect(error.boundary).toBe("subtask")
    expect(error.label).toBe("T-001 子任务 2")
    expect(error.message).toContain("T-001 子任务 2")
  })

  test("resetExitRequest 复位后 maybeExit 不再抛出", () => {
    requestExit()
    resetExitRequest()
    expect(exitRequested()).toBe(false)
    expect(() => maybeExit("phase", "阶段 m 迁移实现 交接")).not.toThrow()
  })
})
