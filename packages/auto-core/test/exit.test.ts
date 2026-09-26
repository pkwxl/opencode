import { afterEach, describe, expect, test } from "bun:test"
import { ExitRequested, exitRequested, maybeExit, requestExit, resetExitRequest } from "../src/exit"

describe("exit (the one-shot in-process /exit flag)", () => {
  afterEach(() => {
    resetExitRequest()
  })

  test("unset: exitRequested is false and maybeExit does not throw", () => {
    expect(exitRequested()).toBe(false)
    expect(() => maybeExit("task", "T-001 sample task")).not.toThrow()
  })

  test("after requestExit, exitRequested is true", () => {
    requestExit()
    expect(exitRequested()).toBe(true)
  })

  test("once set, maybeExit throws ExitRequested carrying the boundary and label", () => {
    requestExit()
    let caught: unknown
    try {
      maybeExit("subtask", "T-001 subtask 2")
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ExitRequested)
    const error = caught as ExitRequested
    expect(error.boundary).toBe("subtask")
    expect(error.label).toBe("T-001 subtask 2")
    expect(error.message).toContain("T-001 subtask 2")
  })

  test("after resetExitRequest, maybeExit no longer throws", () => {
    requestExit()
    resetExitRequest()
    expect(exitRequested()).toBe(false)
    expect(() => maybeExit("phase", "phase m implementation handover")).not.toThrow()
  })
})
