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

describe("createStuckTracker (same error repeated)", () => {
  test(`same tool, same error hits only on occurrence ${STUCK_ERROR_REPEAT}; silent before that`, () => {
    const tracker = createStuckTracker()
    for (let i = 1; i < STUCK_ERROR_REPEAT; i++) expect(tracker.observe(fail())).toBeUndefined()
    const hit = tracker.observe(fail())
    expect(hit).toBeDefined()
    expect(hit).toMatchObject({ kind: "error", tool: "edit", count: STUCK_ERROR_REPEAT, level: 1 })
    expect(hit!.detail).toContain("String not found")
    expect(hit!.input).toContain("src/a.ts")
  })

  test("tweaked arguments with a byte-identical error still count (the typical weak-model shape)", () => {
    const tracker = createStuckTracker()
    tracker.observe(fail({ input: { filePath: "src/a.ts", oldString: "foo" } }))
    tracker.observe(fail({ input: { filePath: "src/a.ts", oldString: "foo " } }))
    expect(tracker.observe(fail({ input: { filePath: "src/a.ts", oldString: " foo" } }))).toMatchObject({
      kind: "error",
      count: 3,
    })
  })

  test("error texts differing only in whitespace or case count as the same error", () => {
    const tracker = createStuckTracker()
    tracker.observe(fail({ result: "String not found in file" }))
    tracker.observe(fail({ result: "String  not found\nin file" }))
    expect(tracker.observe(fail({ result: "STRING NOT FOUND IN FILE" }))).toMatchObject({ kind: "error" })
  })

  test("a different error counts as progress; not counted", () => {
    const tracker = createStuckTracker()
    expect(tracker.observe(fail({ result: "error A" }))).toBeUndefined()
    expect(tracker.observe(fail({ result: "error B" }))).toBeUndefined()
    expect(tracker.observe(fail({ result: "error C" }))).toBeUndefined()
  })

  test("different tools are tracked separately", () => {
    const tracker = createStuckTracker()
    for (const tool of ["edit", "write", "bash"]) expect(tracker.observe(fail({ tool }))).toBeUndefined()
  })
})

describe("createStuckTracker (same arguments, same result repeated)", () => {
  test(`identical arguments and output hit only on occurrence ${STUCK_SAME_REPEAT} (threshold one notch above the error one)`, () => {
    const tracker = createStuckTracker()
    for (let i = 1; i < STUCK_SAME_REPEAT; i++) expect(tracker.observe(ok())).toBeUndefined()
    expect(tracker.observe(ok())).toMatchObject({ kind: "repeat", tool: "read", count: STUCK_SAME_REPEAT, level: 1 })
  })

  test("argument key order does not affect the signature", () => {
    const tracker = createStuckTracker({ sameRepeat: 2 })
    tracker.observe(ok({ input: { filePath: "src/a.ts", limit: 20 } }))
    expect(tracker.observe(ok({ input: { limit: 20, filePath: "src/a.ts" } }))).toMatchObject({ kind: "repeat" })
  })

  test("a changed output counts as progress; not counted", () => {
    const tracker = createStuckTracker({ sameRepeat: 2 })
    tracker.observe(ok({ result: "content v1" }))
    expect(tracker.observe(ok({ result: "content v2" }))).toBeUndefined()
  })

  test("different arguments do not count (the same tool reading different files is normal work)", () => {
    const tracker = createStuckTracker({ sameRepeat: 2 })
    tracker.observe(ok({ input: { filePath: "src/a.ts" } }))
    expect(tracker.observe(ok({ input: { filePath: "src/b.ts" } }))).toBeUndefined()
  })
})

describe("createStuckTracker (hint cadence)", () => {
  test("a hit resets the count: another full round is needed before the next hint; level increments", () => {
    const tracker = createStuckTracker({ errorRepeat: 2 })
    tracker.observe(fail())
    expect(tracker.observe(fail())).toMatchObject({ level: 1 })
    expect(tracker.observe(fail())).toBeUndefined()
    expect(tracker.observe(fail())).toMatchObject({ level: 2, count: 2 })
  })

  test(`at most ${STUCK_MAX_HINTS} hints per session, silent afterwards`, () => {
    const tracker = createStuckTracker({ errorRepeat: 1 })
    const levels = Array.from({ length: STUCK_MAX_HINTS + 2 }, () => tracker.observe(fail())?.level)
    expect(levels).toEqual([...Array.from({ length: STUCK_MAX_HINTS }, (_, i) => i + 1), undefined, undefined])
  })

  test("the tracker is session-scoped: a fresh instance starts from zero", () => {
    const first = createStuckTracker({ errorRepeat: 2 })
    first.observe(fail())
    const second = createStuckTracker({ errorRepeat: 2 })
    expect(second.observe(fail())).toBeUndefined()
  })
})

describe("createStuckTracker (boundaries)", () => {
  test("no arguments and empty output do not throw; the summary is an empty string (placeholder left to template rendering)", () => {
    const tracker = createStuckTracker({ errorRepeat: 1 })
    const hit = tracker.observe({ tool: "bash", status: "error", result: "" })
    expect(hit).toMatchObject({ kind: "error", tool: "bash" })
    expect(hit!.detail).toBe("")
    expect(hit!.input).toBe("")
  })

  test("overlong arguments and output are truncated", () => {
    const tracker = createStuckTracker({ errorRepeat: 1 })
    const hit = tracker.observe(fail({ input: { text: "x".repeat(5000) }, result: "y".repeat(5000) }))
    expect(hit!.input.length).toBeLessThan(400)
    expect(hit!.detail.length).toBeLessThan(900)
    expect(hit!.detail).toContain("… (truncated)")
  })

  test("circular-reference arguments do not throw", () => {
    const tracker = createStuckTracker({ errorRepeat: 1 })
    const input: Record<string, unknown> = { name: "a" }
    input.self = input
    expect(tracker.observe(fail({ input }))).toMatchObject({ kind: "error" })
  })
})
