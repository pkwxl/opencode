import { afterEach, describe, expect, test } from "bun:test"
import { ExitRequested, exitRequested, maybeExit, requestExit, resetExitRequest, sleepUnlessExit } from "../src/exit"

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

// The recovery wait's sleep as a pause boundary (plans/0057 §6, §11 item 9).
describe("sleepUnlessExit (the recovery wait's /exit boundary)", () => {
  afterEach(() => {
    resetExitRequest()
  })

  test("a sleep that runs its length resolves false", async () => {
    const began = Date.now()
    expect(await sleepUnlessExit(20)).toBe(false)
    expect(Date.now() - began).toBeGreaterThanOrEqual(15)
  })

  test("/exit during the sleep ends it at once and resolves true", async () => {
    setTimeout(requestExit, 10)
    const began = Date.now()
    expect(await sleepUnlessExit(60_000)).toBe(true)
    expect(Date.now() - began).toBeLessThan(5_000)
  })

  test("an /exit requested before the sleep resolves true without sleeping", async () => {
    requestExit()
    const slept: number[] = []
    expect(await sleepUnlessExit(60_000, async (ms) => void slept.push(ms))).toBe(true)
    expect(slept).toEqual([])
  })

  test("an injected sleep sets the length; /exit stops waiting on one that never ends", async () => {
    const slept: number[] = []
    expect(await sleepUnlessExit(1_234, async (ms) => void slept.push(ms))).toBe(false)
    expect(slept).toEqual([1_234])
    setTimeout(requestExit, 10)
    expect(await sleepUnlessExit(1_000, () => new Promise<void>(() => {}))).toBe(true)
  })

  test("the pause throws ExitRequested at the wait boundary", () => {
    const error = new ExitRequested("wait", "T-001 recovery wait")
    expect(error.boundary).toBe("wait")
    expect(error.message).toBe("/exit took effect at the T-001 recovery wait boundary")
  })
})
