import { describe, expect, test } from "bun:test"
import { createControl, ExitRequested } from "../src/exit"
import { services } from "../src/services"

// The preload installs fresh services before every test, so each row starts
// with an unset /exit request; the control is reached through the installed
// holder the way the run's code reaches it.
describe("exit (the one-shot per-run /exit flag)", () => {
  test("unset: exitRequested is false and maybeExit does not throw", () => {
    const control = services().control
    expect(control.exitRequested()).toBe(false)
    expect(() => control.maybeExit("task", "T-001 sample task")).not.toThrow()
  })

  test("after requestExit, exitRequested is true", () => {
    services().control.requestExit()
    expect(services().control.exitRequested()).toBe(true)
  })

  test("once set, maybeExit throws ExitRequested carrying the boundary and label", () => {
    services().control.requestExit()
    let caught: unknown
    try {
      services().control.maybeExit("subtask", "T-001 subtask 2")
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ExitRequested)
    const error = caught as ExitRequested
    expect(error.boundary).toBe("subtask")
    expect(error.label).toBe("T-001 subtask 2")
    expect(error.message).toContain("T-001 subtask 2")
  })

  test("the flag is the instance's own: a fresh control (the next run's) starts unset", () => {
    services().control.requestExit()
    const next = createControl()
    expect(next.exitRequested()).toBe(false)
    expect(() => next.maybeExit("phase", "phase m implementation handover")).not.toThrow()
  })
})

// The recovery wait's sleep as a pause boundary (plans/0057 §6, §11 item 9).
describe("sleepUnlessExit (the recovery wait's /exit boundary)", () => {
  test("a sleep that runs its length resolves false", async () => {
    const began = Date.now()
    expect(await services().control.sleepUnlessExit(20)).toBe(false)
    expect(Date.now() - began).toBeGreaterThanOrEqual(15)
  })

  test("/exit during the sleep ends it at once and resolves true", async () => {
    setTimeout(() => services().control.requestExit(), 10)
    const began = Date.now()
    expect(await services().control.sleepUnlessExit(60_000)).toBe(true)
    expect(Date.now() - began).toBeLessThan(5_000)
  })

  test("an /exit requested before the sleep resolves true without sleeping", async () => {
    services().control.requestExit()
    const slept: number[] = []
    expect(await services().control.sleepUnlessExit(60_000, async (ms) => void slept.push(ms))).toBe(true)
    expect(slept).toEqual([])
  })

  test("an injected sleep sets the length; /exit stops waiting on one that never ends", async () => {
    const slept: number[] = []
    expect(await services().control.sleepUnlessExit(1_234, async (ms) => void slept.push(ms))).toBe(false)
    expect(slept).toEqual([1_234])
    setTimeout(() => services().control.requestExit(), 10)
    expect(await services().control.sleepUnlessExit(1_000, () => new Promise<void>(() => {}))).toBe(true)
  })

  test("the pause throws ExitRequested at the wait boundary", () => {
    const error = new ExitRequested("wait", "T-001 recovery wait")
    expect(error.boundary).toBe("wait")
    expect(error.message).toBe("/exit took effect at the T-001 recovery wait boundary")
  })
})
