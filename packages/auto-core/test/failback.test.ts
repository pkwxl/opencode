import { afterEach, describe, expect, test } from "bun:test"
import {
  clearDownMarks,
  consumeFailback,
  downMarks,
  failbackApplies,
  failbackOverride,
  failbackRequested,
  isKeyDown,
  isModelDown,
  keyDownMark,
  markKeyDown,
  markModelDown,
  modelDownMark,
  requestFailback,
  resetFailback,
  setSticky,
  clearSticky,
  stickyModel,
} from "../src/failback"

describe("failbackApplies (inclusive granularity, the same RANK idea as step)", () => {
  test("phase covers only the phase boundary; task covers task/phase; subtask covers all; session covers all", () => {
    expect(failbackApplies("phase", "phase")).toBe(true)
    expect(failbackApplies("phase", "task")).toBe(false)
    expect(failbackApplies("phase", "subtask")).toBe(false)
    expect(failbackApplies("task", "phase")).toBe(true)
    expect(failbackApplies("task", "task")).toBe(true)
    expect(failbackApplies("task", "subtask")).toBe(false)
    expect(failbackApplies("subtask", "phase")).toBe(true)
    expect(failbackApplies("subtask", "task")).toBe(true)
    expect(failbackApplies("subtask", "subtask")).toBe(true)
    expect(failbackApplies("session", "phase")).toBe(true)
    expect(failbackApplies("session", "task")).toBe(true)
    expect(failbackApplies("session", "subtask")).toBe(true)
  })
})

describe("failback (the module state for failover, failback and /failback)", () => {
  afterEach(() => {
    resetFailback()
  })

  test("sticky holder: setSticky/clearSticky read and write, default undefined", () => {
    expect(stickyModel()).toBeUndefined()
    setSticky("prov/a")
    expect(stickyModel()).toBe("prov/a")
    clearSticky()
    expect(stickyModel()).toBeUndefined()
  })

  test("when not requested, consumeFailback returns false and the chain state is untouched", () => {
    const chain: { model?: string } = { model: "prov/b" }
    expect(consumeFailback(chain)).toBe(false)
    expect(chain.model).toBe("prov/b")
    expect(failbackOverride()).toBeUndefined()
  })

  test("/failback without arguments: on consumption the chain's failover candidate and sticky are cleared, no override set", () => {
    setSticky("prov/b")
    requestFailback()
    expect(failbackRequested()).toBe(true)
    const chain: { model?: string } = { model: "prov/b" }
    expect(consumeFailback(chain)).toBe(true)
    expect(chain.model).toBeUndefined()
    expect(stickyModel()).toBeUndefined()
    expect(failbackOverride()).toBeUndefined()
    expect(failbackRequested()).toBe(false)
  })

  test("/failback with arguments: the first is the preferred override, the rest the failover candidate ring", () => {
    requestFailback(["kimi/k3", "zai/glm-5.3-flash", "zai/glm-5.3"])
    expect(consumeFailback()).toBe(true)
    expect(failbackOverride()).toEqual({ wildcard: "kimi/k3", fallback: ["zai/glm-5.3-flash", "zai/glm-5.3"] })
  })

  test("a single model given: preferred override only, empty candidate ring", () => {
    requestFailback(["kimi/k3"])
    expect(consumeFailback()).toBe(true)
    expect(failbackOverride()).toEqual({ wildcard: "kimi/k3", fallback: [] })
  })

  test("an empty argument list counts as no arguments (reset only)", () => {
    requestFailback([])
    expect(consumeFailback()).toBe(true)
    expect(failbackOverride()).toBeUndefined()
  })

  test("consecutive /failback: the later override replaces the earlier one", () => {
    requestFailback(["prov/a", "prov/b"])
    consumeFailback()
    requestFailback(["prov/c"])
    consumeFailback()
    expect(failbackOverride()).toEqual({ wildcard: "prov/c", fallback: [] })
  })

  test("resetFailback resets all module state", () => {
    setSticky("prov/a")
    requestFailback(["prov/c"])
    consumeFailback()
    requestFailback()
    resetFailback()
    expect(stickyModel()).toBeUndefined()
    expect(failbackRequested()).toBe(false)
    expect(failbackOverride()).toBeUndefined()
  })
})

// Down marks (plans/0055 §6.4): the registry-era replacement of the sticky
// holder — per model (and per provider key, for the rings of a later step),
// cleared at the failback scope boundaries and by /failback, an `until` mark
// lasting until its instant instead.
describe("down marks (§6.4)", () => {
  const NOW = Date.parse("2026-09-25T12:00:00Z")

  afterEach(() => {
    resetFailback()
  })

  test("markModelDown / modelDownMark / isModelDown: down now, with or without an until", () => {
    expect(isModelDown("k3", NOW)).toBe(false)
    markModelDown("k3")
    expect(modelDownMark("k3")).toEqual({})
    expect(isModelDown("k3", NOW)).toBe(true)
    markModelDown("glm", NOW + 3_600_000)
    expect(modelDownMark("glm")).toEqual({ until: NOW + 3_600_000 })
    expect(isModelDown("glm", NOW)).toBe(true)
    // At the instant itself the mark has cleared.
    expect(isModelDown("glm", NOW + 3_600_000)).toBe(false)
    expect(downMarks().get("k3")).toEqual({})
  })

  test("key marks are held per provider and key reference", () => {
    markKeyDown("moonshotai", "{env:MOONSHOT_KEY_A}")
    markKeyDown("moonshotai", "{env:MOONSHOT_KEY_B}", NOW + 1_000)
    markKeyDown("zhipuai", "{env:ZHIPU_KEY_A}")
    expect(keyDownMark("moonshotai", "{env:MOONSHOT_KEY_A}")).toEqual({})
    expect(isKeyDown("moonshotai", "{env:MOONSHOT_KEY_A}", NOW)).toBe(true)
    expect(isKeyDown("moonshotai", "{env:MOONSHOT_KEY_B}", NOW + 1_000)).toBe(false)
    expect(isKeyDown("zhipuai", "{env:ZHIPU_KEY_A}", NOW)).toBe(true)
    expect(keyDownMark("moonshotai", "{env:ZHIPU_KEY_A}")).toBeUndefined()
  })

  test("marks clear at the boundaries their scope covers; an until mark survives and expires by its instant", () => {
    // phase clears under every scope; task under task (default) and finer;
    // subtask under subtask/session; session only under session.
    const cases: Array<{ boundary: "phase" | "task" | "subtask" | "session"; scope: "phase" | "task" | "subtask" | "session"; clears: boolean }> = [
      { boundary: "phase", scope: "phase", clears: true },
      { boundary: "phase", scope: "task", clears: true },
      { boundary: "task", scope: "phase", clears: false },
      { boundary: "task", scope: "task", clears: true },
      { boundary: "task", scope: "subtask", clears: true },
      { boundary: "subtask", scope: "task", clears: false },
      { boundary: "subtask", scope: "subtask", clears: true },
      { boundary: "session", scope: "subtask", clears: false },
      { boundary: "session", scope: "session", clears: true },
    ]
    for (const { boundary, scope, clears } of cases) {
      markModelDown("k3")
      markModelDown("opus", NOW + 3_600_000)
      markKeyDown("moonshotai", "{env:MOONSHOT_KEY_A}")
      clearDownMarks(boundary, scope)
      expect({ boundary, scope, cleared: !isModelDown("k3", NOW) }).toEqual({ boundary, scope, cleared: clears })
      // An until mark survives every boundary clear and reads as cleared
      // once its instant passes.
      expect(isModelDown("opus", NOW)).toBe(true)
      expect(isModelDown("opus", NOW + 3_600_000)).toBe(false)
      expect(isKeyDown("moonshotai", "{env:MOONSHOT_KEY_A}", NOW)).toBe(!clears)
    }
  })

  test("consumeFailback clears every mark, an until included; a boundary without a request does not", () => {
    markModelDown("k3")
    markModelDown("opus", NOW + 3_600_000)
    markKeyDown("moonshotai", "{env:MOONSHOT_KEY_A}", NOW + 3_600_000)
    // A consumed boundary with no /failback pending leaves the marks alone.
    expect(consumeFailback()).toBe(false)
    expect(isModelDown("k3", NOW)).toBe(true)
    requestFailback()
    expect(consumeFailback()).toBe(true)
    expect(isModelDown("k3", NOW)).toBe(false)
    expect(isModelDown("opus", NOW)).toBe(false)
    expect(isKeyDown("moonshotai", "{env:MOONSHOT_KEY_A}", NOW)).toBe(false)
  })

  test("resetFailback clears the marks too", () => {
    markModelDown("k3")
    markKeyDown("moonshotai", "{env:MOONSHOT_KEY_A}")
    resetFailback()
    expect(downMarks().size).toBe(0)
    expect(keyDownMark("moonshotai", "{env:MOONSHOT_KEY_A}")).toBeUndefined()
  })

  test("the sticky holder and the marks are independent state", () => {
    markModelDown("k3")
    setSticky("prov/a")
    clearSticky()
    expect(stickyModel()).toBeUndefined()
    expect(isModelDown("k3", NOW)).toBe(true)
  })
})
