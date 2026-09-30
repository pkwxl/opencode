// Context steps (plans/0055 §4.5): the step-up point, the step walk over
// the live windows, the resume rule (the step a context size puts a session
// on) and the startup validation that disables unknown or non-growing
// steps. Pure over a hand-built entry and a limits map — the live half (the
// steer, the late step-up and the cache-claim observation) is the stepUp
// concern's (src/engine/concerns/step-up.ts, its suite
// test/turn-step-up.test.ts), and the cache-claim verdict tables are
// re-homed there with it: the router holds the run state, and the concern
// is its only consumer.
import { describe, expect, test } from "bun:test"
import {
  enabledSteps,
  stepForUsed,
  stepId,
  stepIds,
  stepUpPoint,
  stepValidationLines,
  STEP_UP_RESERVE_MIN,
} from "../src/model-step"
import type { ModelEntry, ModelRegistry } from "../src/models"

const entry = (fields: Partial<ModelEntry> = {}): ModelEntry => ({ name: "k3", layer: "operator", agent: "opencode", model: "prov/k3-256k", wider: ["prov/k3"], ...fields })

const registry = (models: ModelEntry[], agents: [string, string][] = [["opencode", "opencode"]]): ModelRegistry => ({
  layers: [{ name: "operator", path: "/unused/models.json" }],
  tz: "UTC",
  agents: new Map(agents.map(([name, adapter]) => [name, { name, layer: "operator", adapter }])),
  models: new Map(models.map((item) => [item.name, item])),
  tiers: {},
  routes: new Map(),
  unused: [],
})

describe("the step-up point (§4.5)", () => {
  test("window minus max(48k, window/5): 204.8k for a 256k step, the flat 48k for smaller windows", () => {
    expect(STEP_UP_RESERVE_MIN).toBe(48_000)
    expect(stepUpPoint(256_000)).toBe(204_800)
    expect(stepUpPoint(240_000)).toBe(192_000)
    // window/5 below 48k: the flat reserve wins, and a window smaller than
    // the reserve has its point below zero (such a session steps up at once).
    expect(stepUpPoint(100_000)).toBe(52_000)
    expect(stepUpPoint(60_000)).toBe(12_000)
    expect(stepUpPoint(50_000)).toBe(2_000)
    expect(stepUpPoint(40_000)).toBe(-8_000)
  })
})

describe("the step walk over the live windows", () => {
  const ladder = entry({ wider: ["prov/k3", "prov/k3-1m"] })
  const limits = new Map([
    ["prov/k3-256k", 256_000],
    ["prov/k3", 400_000],
    ["prov/k3-1m", 1_000_000],
  ])

  test("stepIds/stepId: base first, index 0 is the base, no model is no ids", () => {
    expect(stepIds(ladder)).toEqual(["prov/k3-256k", "prov/k3", "prov/k3-1m"])
    expect(stepId(ladder, 0)).toBe("prov/k3-256k")
    expect(stepId(ladder, 2)).toBe("prov/k3-1m")
    expect(stepId(entry({ model: undefined, wider: undefined }), 0)).toBeUndefined()
  })

  test("strictly larger windows keep every step; an entry without steps is the base alone", () => {
    expect(enabledSteps(ladder, limits)).toBe(3)
    expect(enabledSteps(entry({ wider: undefined }), limits)).toBe(1)
  })

  test("an unknown step window disables the steps from it upward", () => {
    const partial = new Map([
      ["prov/k3-256k", 256_000],
      ["prov/k3", 400_000],
    ])
    expect(enabledSteps(ladder, partial)).toBe(2)
    // An unknown base window disables every step: nothing can be compared.
    const noBase = new Map([
      ["prov/k3", 400_000],
      ["prov/k3-1m", 1_000_000],
    ])
    expect(enabledSteps(ladder, noBase)).toBe(1)
  })

  test("a step not larger than the one below disables the steps from it upward", () => {
    const flat = new Map([
      ["prov/k3-256k", 256_000],
      ["prov/k3", 256_000],
      ["prov/k3-1m", 1_000_000],
    ])
    expect(enabledSteps(ladder, flat)).toBe(1)
    const dip = new Map([
      ["prov/k3-256k", 256_000],
      ["prov/k3", 400_000],
      ["prov/k3-1m", 350_000],
    ])
    expect(enabledSteps(ladder, dip)).toBe(2)
  })

  test("stepForUsed: the first step whose point is not yet reached, within the enabled steps", () => {
    // Base point 204.8k, second point 400k − 80k = 320k, top has no point.
    expect(stepForUsed(ladder, limits, 1_000)).toBe(0)
    expect(stepForUsed(ladder, limits, 204_800)).toBe(1)
    expect(stepForUsed(ladder, limits, 320_000)).toBe(2)
    expect(stepForUsed(ladder, limits, 5_000_000)).toBe(2)
    // A disabled ladder never leaves the base, however large the context.
    expect(stepForUsed(ladder, new Map(), 5_000_000)).toBe(0)
  })
})

describe("the startup validation (§4.5, §10 item 13)", () => {
  test("a healthy ladder over known windows says nothing", () => {
    expect(
      stepValidationLines(registry([entry()]), new Map([
        ["prov/k3-256k", 256_000],
        ["prov/k3", 400_000],
      ])),
    ).toEqual([])
  })

  test("a model id missing from the limits is a warning, never an error", () => {
    // The base id is missing while the wider id is known: the warning for
    // the missing id, and the step above it cannot be compared with the
    // unknown window below, so the steps disable from it upward.
    expect(stepValidationLines(registry([entry()]), new Map([["prov/k3", 400_000]]))).toEqual([
      `⚠ model registry: k3: model id prov/k3-256k has no known context window (the agent's model list does not name it); its window is unknown for this run`,
      `⚠ model registry: k3: step prov/k3 cannot be compared with the unknown window of the step below; the steps from it upward are disabled, a session of this entry stays on prov/k3-256k`,
    ])
  })

  test("an unknown or non-growing step disables the steps from it upward, naming where the session stays", () => {
    expect(stepValidationLines(registry([entry()]), new Map([["prov/k3-256k", 256_000]]))).toEqual([
      `⚠ model registry: k3: model id prov/k3 has no known context window (the agent's model list does not name it); its window is unknown for this run`,
      `⚠ model registry: k3: step prov/k3 has no known context window; the steps from it upward are disabled, a session of this entry stays on prov/k3-256k`,
    ])
    expect(
      stepValidationLines(
        registry([entry()]),
        new Map([
          ["prov/k3-256k", 256_000],
          ["prov/k3", 250_000],
        ]),
      ),
    ).toEqual([`⚠ model registry: k3: step prov/k3 window 250.0k is not larger than 256.0k below; the steps from it upward are disabled, a session of this entry stays on prov/k3-256k`])
  })

  test("only opencode-adapter entries are checked (another agent's windows are its own)", () => {
    const claude = entry({ name: "opus", agent: "claude", model: "opus", wider: ["opus-1m"] })
    expect(stepValidationLines(registry([claude]), new Map())).toEqual([])
  })
})
