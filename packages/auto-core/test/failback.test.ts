// Failback and the router's failback/down-mark state: the pure granularity
// helper of src/failback.ts, and the run-wide decision state the router
// service holds (the sticky holder, the pending /failback order and the
// run-time model-order override, the down marks). Every test reads the
// fresh instance the preload installed for it — the moved state has no
// reset hook, and none may reappear (test/services.test.ts).
import { describe, expect, test } from "bun:test"
import type { SessionChain } from "../src/chain"
import { resetRoute } from "../src/chain-transitions"
import { failbackApplies } from "../src/failback"
import { services } from "../src/services"

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

describe("failback (the router's state for failover, failback and /failback)", () => {
  test("sticky holder: setSticky/clearSticky read and write, default undefined", () => {
    const router = services().router
    expect(router.stickyModel()).toBeUndefined()
    router.setSticky("prov/a")
    expect(router.stickyModel()).toBe("prov/a")
    router.clearSticky()
    expect(router.stickyModel()).toBeUndefined()
  })

  test("when not requested, consumeFailback returns false and no override is set", () => {
    const router = services().router
    expect(router.consumeFailback()).toBe(false)
    expect(router.failbackOverride()).toBeUndefined()
  })

  test("/failback without arguments: on consumption the failover state clears and the boundary resets the chain's route beside it", () => {
    const router = services().router
    router.setSticky("prov/b")
    router.requestFailback()
    expect(router.failbackRequested()).toBe(true)
    expect(router.consumeFailback()).toBe(true)
    // The boundary that holds the chain (the subtask boundary) clears the
    // route beside the consumption; the router never writes chain fields
    // itself.
    const chain: SessionChain = { pct: 100, used: 0, at: 0, model: "prov/b", modelEntry: "prov/b", modelStep: 2 }
    resetRoute(chain)
    expect(chain.model).toBeUndefined()
    expect(chain.modelEntry).toBeUndefined()
    expect(chain.modelStep).toBe(0)
    expect(router.stickyModel()).toBeUndefined()
    expect(router.failbackOverride()).toBeUndefined()
    expect(router.failbackRequested()).toBe(false)
  })

  test("/failback with arguments: the first is the preferred override, the rest the failover candidate ring", () => {
    const router = services().router
    router.requestFailback(["kimi/k3", "zai/glm-5.3-flash", "zai/glm-5.3"])
    expect(router.consumeFailback()).toBe(true)
    expect(router.failbackOverride()).toEqual({ wildcard: "kimi/k3", fallback: ["zai/glm-5.3-flash", "zai/glm-5.3"] })
  })

  test("a single model given: preferred override only, empty candidate ring", () => {
    const router = services().router
    router.requestFailback(["kimi/k3"])
    expect(router.consumeFailback()).toBe(true)
    expect(router.failbackOverride()).toEqual({ wildcard: "kimi/k3", fallback: [] })
  })

  test("an empty argument list counts as no arguments (reset only)", () => {
    const router = services().router
    router.requestFailback([])
    expect(router.consumeFailback()).toBe(true)
    expect(router.failbackOverride()).toBeUndefined()
  })

  test("consecutive /failback: the later override replaces the earlier one", () => {
    const router = services().router
    router.requestFailback(["prov/a", "prov/b"])
    router.consumeFailback()
    router.requestFailback(["prov/c"])
    router.consumeFailback()
    expect(router.failbackOverride()).toEqual({ wildcard: "prov/c", fallback: [] })
  })

  test("each test's router starts fresh (the preload installs a new instance per test)", () => {
    // The previous tests consumed /failback orders and wrote the sticky
    // holder; this test's instance carries none of it.
    const router = services().router
    expect(router.stickyModel()).toBeUndefined()
    expect(router.failbackRequested()).toBe(false)
    expect(router.failbackOverride()).toBeUndefined()
  })
})

// Down marks (plans/0055 §6.4): the registry-era replacement of the sticky
// holder — per model (and per provider key, for the rings of a later step),
// cleared at the failback scope boundaries and by /failback, an `until` mark
// lasting until its instant instead.
describe("down marks (§6.4)", () => {
  const NOW = Date.parse("2026-09-25T12:00:00Z")

  test("markModelDown / modelDownMark / isModelDown: down now, with or without an until", () => {
    const router = services().router
    expect(router.isModelDown("k3", NOW)).toBe(false)
    router.markModelDown("k3")
    expect(router.modelDownMark("k3")).toEqual({})
    expect(router.isModelDown("k3", NOW)).toBe(true)
    router.markModelDown("glm", NOW + 3_600_000)
    expect(router.modelDownMark("glm")).toEqual({ until: NOW + 3_600_000 })
    expect(router.isModelDown("glm", NOW)).toBe(true)
    // At the instant itself the mark has cleared.
    expect(router.isModelDown("glm", NOW + 3_600_000)).toBe(false)
    expect(router.downMarks().get("k3")).toEqual({})
  })

  test("key marks are held per provider and key reference", () => {
    const router = services().router
    router.markKeyDown("moonshotai", "{env:MOONSHOT_KEY_A}")
    router.markKeyDown("moonshotai", "{env:MOONSHOT_KEY_B}", NOW + 1_000)
    router.markKeyDown("zhipuai", "{env:ZHIPU_KEY_A}")
    expect(router.keyDownMark("moonshotai", "{env:MOONSHOT_KEY_A}")).toEqual({})
    expect(router.isKeyDown("moonshotai", "{env:MOONSHOT_KEY_A}", NOW)).toBe(true)
    expect(router.isKeyDown("moonshotai", "{env:MOONSHOT_KEY_B}", NOW + 1_000)).toBe(false)
    expect(router.isKeyDown("zhipuai", "{env:ZHIPU_KEY_A}", NOW)).toBe(true)
    expect(router.keyDownMark("moonshotai", "{env:ZHIPU_KEY_A}")).toBeUndefined()
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
    const router = services().router
    for (const { boundary, scope, clears } of cases) {
      router.markModelDown("k3")
      router.markModelDown("opus", NOW + 3_600_000)
      router.markKeyDown("moonshotai", "{env:MOONSHOT_KEY_A}")
      router.clearDownMarks(boundary, scope)
      expect({ boundary, scope, cleared: !router.isModelDown("k3", NOW) }).toEqual({ boundary, scope, cleared: clears })
      // An until mark survives every boundary clear and reads as cleared
      // once its instant passes.
      expect(router.isModelDown("opus", NOW)).toBe(true)
      expect(router.isModelDown("opus", NOW + 3_600_000)).toBe(false)
      expect(router.isKeyDown("moonshotai", "{env:MOONSHOT_KEY_A}", NOW)).toBe(!clears)
    }
  })

  test("consumeFailback clears every mark, an until included; a boundary without a request does not", () => {
    const router = services().router
    router.markModelDown("k3")
    router.markModelDown("opus", NOW + 3_600_000)
    router.markKeyDown("moonshotai", "{env:MOONSHOT_KEY_A}", NOW + 3_600_000)
    // A consumed boundary with no /failback pending leaves the marks alone.
    expect(router.consumeFailback()).toBe(false)
    expect(router.isModelDown("k3", NOW)).toBe(true)
    router.requestFailback()
    expect(router.consumeFailback()).toBe(true)
    expect(router.isModelDown("k3", NOW)).toBe(false)
    expect(router.isModelDown("opus", NOW)).toBe(false)
    expect(router.isKeyDown("moonshotai", "{env:MOONSHOT_KEY_A}", NOW)).toBe(false)
  })

  test("the sticky holder and the marks are independent state", () => {
    const router = services().router
    router.markModelDown("k3")
    router.setSticky("prov/a")
    router.clearSticky()
    expect(router.stickyModel()).toBeUndefined()
    expect(router.isModelDown("k3", NOW)).toBe(true)
  })
})
