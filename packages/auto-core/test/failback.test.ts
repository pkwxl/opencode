import { afterEach, describe, expect, test } from "bun:test"
import {
  consumeFailback,
  failbackApplies,
  failbackOverride,
  failbackRequested,
  requestFailback,
  resetFailback,
  setSticky,
  clearSticky,
  stickyModel,
} from "../src/failback"

describe("failbackApplies(包含式粒度,与 step 同一 RANK 思路)", () => {
  test("phase 只覆盖 phase 边界;task 覆盖 task/phase;subtask 全覆盖;session 全覆盖", () => {
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

describe("failback(降级回试与 /failback 的模块态)", () => {
  afterEach(() => {
    resetFailback()
  })

  test("sticky holder: setSticky/clearSticky 读写,缺省 undefined", () => {
    expect(stickyModel()).toBeUndefined()
    setSticky("prov/a")
    expect(stickyModel()).toBe("prov/a")
    clearSticky()
    expect(stickyModel()).toBeUndefined()
  })

  test("未置位时 consumeFailback 返回 false,链状态不动", () => {
    const chain: { model?: string } = { model: "prov/b" }
    expect(consumeFailback(chain)).toBe(false)
    expect(chain.model).toBe("prov/b")
    expect(failbackOverride()).toBeUndefined()
  })

  test("无参 /failback: 消费后清链上降级候选与 sticky,不设覆写", () => {
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

  test("带参 /failback: 首个为首选覆写、其余为降级候选环", () => {
    requestFailback(["kimi/k3", "zai/glm-5.3-flash", "zai/glm-5.3"])
    expect(consumeFailback()).toBe(true)
    expect(failbackOverride()).toEqual({ wildcard: "kimi/k3", fallback: ["zai/glm-5.3-flash", "zai/glm-5.3"] })
  })

  test("带参仅一个模型: 首选覆写,候选环为空", () => {
    requestFailback(["kimi/k3"])
    expect(consumeFailback()).toBe(true)
    expect(failbackOverride()).toEqual({ wildcard: "kimi/k3", fallback: [] })
  })

  test("空参数表视同无参(仅重置)", () => {
    requestFailback([])
    expect(consumeFailback()).toBe(true)
    expect(failbackOverride()).toBeUndefined()
  })

  test("连续 /failback: 后一次覆写覆盖前一次", () => {
    requestFailback(["prov/a", "prov/b"])
    consumeFailback()
    requestFailback(["prov/c"])
    consumeFailback()
    expect(failbackOverride()).toEqual({ wildcard: "prov/c", fallback: [] })
  })

  test("resetFailback 复位全部模块态", () => {
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
