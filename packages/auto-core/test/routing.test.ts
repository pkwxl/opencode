// The run's routing facts (plans/0055 §6): the run-start routing block
// (§6.5) over a hand-built registry, and the tier-coverage refusal of the
// run start (§6.3). The dispatch behavior these facts drive is covered by
// test/agent-fake.test.ts; the selection core itself by test/select.test.ts.
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { parseWindow } from "../src/model-window"
import type { ModelEntry, ModelRegistry, ModelRoute, RegistryAgentProfile, TierList } from "../src/models"
import { logRunRouting, routingFacts, tierCoverageProblems, type RoutingFacts } from "../src/routing"

const entry = (name: string, fields: Partial<ModelEntry> = {}): ModelEntry => ({ name, layer: "operator", agent: "opencode", ...fields })
const agents = new Map<string, RegistryAgentProfile>([
  ["opencode", { name: "opencode", layer: "operator", adapter: "opencode" }],
  ["claude", { name: "claude", layer: "operator", adapter: "claude" }],
])

const registry = (models: ModelEntry[], tiers: Partial<Record<"deep" | "simple", TierList>>, routes: [string, ModelRoute][] = []): ModelRegistry => ({
  layers: [{ name: "operator", path: "/fleet/models.json" }],
  tz: "UTC",
  agents,
  models: new Map(models.map((item) => [item.name, item])),
  tiers,
  routes: new Map(routes),
  unused: ["spare"],
})

// Friday 2026-09-25 12:00 UTC.
const NOW = Date.parse("2026-09-25T12:00:00Z")
const facts = (reg: ModelRegistry, over: Partial<RoutingFacts> = {}): RoutingFacts => ({
  registry: reg,
  agentFilter: "opencode",
  filterSource: undefined,
  defaultAgent: "opencode",
  clock: () => NOW,
  ...over,
})

describe("the run-start routing block (§6.5)", () => {
  const printed: string[] = []
  let seen = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    printed.push(args.map((arg) => String(arg)).join(" "))
  })
  afterEach(() => {
    printed.length = 0
    seen.mockRestore()
    seen = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      printed.push(args.map((arg) => String(arg)).join(" "))
    })
  })

  test("each tier with agent, window state now and ring size; routes, filter, unused and default-agent notes", () => {
    const avoid = parseWindow("mon-fri 09:00-18:00")
    if ("error" in avoid) throw new Error(avoid.error)
    const models = [
      entry("opus", { agent: "claude", model: "opus", avoid: [avoid.window], keys: [{ kind: "env", name: "KEY_A", ref: "{env:KEY_A}", label: "KEY_A" }] }),
      entry("k3", { model: "moonshotai/kimi-k3-256k" }),
      entry("glm", { model: "zhipuai/glm-4.6", layer: "project" }),
    ]
    const reg = registry(
      models,
      { deep: { tier: "deep", names: ["opus", "k3"], layer: "operator" }, simple: { tier: "simple", names: ["glm"], layer: "project" } },
      [["decompose", { key: "decompose", layer: "operator", tier: "deep" }]],
    )
    logRunRouting(facts(reg))
    expect(printed).toEqual([
      "◇ model registry: model registry, operator layer /fleet/models.json",
      // Friday 12:00 UTC sits inside opus's avoid window: the state says when
      // it opens again.
      "◇ tier deep [operator layer]: opus (claude, opens 18:00 UTC, ring 1) → k3 (opencode, open, ring 0)",
      "◇ tier simple [project layer]: glm (opencode, open, ring 0 · project layer)",
      "◇ routes in force: decompose → tier deep [operator layer]",
      "◇ agent filter: opencode: only models on opencode profiles are candidates",
      "ℹ unused models (no tier, route list or classifier names them): spare",
    ])
    // No filter in force: the block says so instead.
    printed.length = 0
    logRunRouting(facts(reg, { agentFilter: undefined }))
    expect(printed).toContain("◇ agent filter: none: models on every agent profile are candidates")
    // R6: a default agent no tier runs on gets the startup note.
    printed.length = 0
    const opencodeOnly = registry(
      [entry("k3", { model: "moonshotai/kimi-k3-256k" }), entry("glm", { model: "zhipuai/glm-4.6" })],
      { deep: { tier: "deep", names: ["k3"], layer: "operator" }, simple: { tier: "simple", names: ["glm"], layer: "operator" } },
    )
    logRunRouting(facts(opencodeOnly, { defaultAgent: "claude", agentFilter: undefined }))
    expect(printed).toContain(
      "ℹ no tier lists a model on the default agent claude (config agent): raw OPENCODE_AUTO_MODEL values and unqualified session records still use it",
    )
  })
})

describe("tier coverage of the run start (§6.3)", () => {
  const models = [entry("opus", { agent: "claude", model: "opus" }), entry("glm", { model: "zhipuai/glm-4.6" })]
  const tiers = {
    deep: { tier: "deep" as const, names: ["opus"], layer: "operator" as const },
    simple: { tier: "simple" as const, names: ["glm"], layer: "operator" as const },
  }

  test("every needed tier with a candidate after the filter passes", () => {
    expect(tierCoverageProblems(registry(models, tiers), undefined, true)).toEqual([])
    expect(tierCoverageProblems(registry(models, tiers), "opencode", false)).toEqual([])
  })

  test("the filter emptying a needed tier, an undeclared tier and an empty tier are each one refusal", () => {
    expect(tierCoverageProblems(registry(models, tiers), "claude", false)).toEqual([
      "model registry: the simple tier has no candidate left after the agent filter claude (tiers.simple: glm); every simple session of this run would have no model to dispatch on",
    ])
    expect(tierCoverageProblems(registry(models, { simple: tiers.simple }), "opencode", true)).toEqual([
      "model registry: the deep tier is not declared (tiers.deep: (empty)); every deep session of this run would have no model to dispatch on",
    ])
    expect(tierCoverageProblems(registry(models, { deep: { tier: "deep", names: [], layer: "operator" }, simple: tiers.simple }), "opencode", true)).toEqual([
      "model registry: the deep tier is declared empty (tiers.deep: (empty)); every deep session of this run would have no model to dispatch on",
    ])
  })
})

describe("routingFacts (the filter and the default agent)", () => {
  test("the default agent is the configured agent alone (R6: it is not a filter)", () => {
    const reg = registry([], {})
    const facts = routingFacts(reg, "claude")
    expect(facts.defaultAgent).toBe("claude")
    expect(facts.agentFilter).toBe("claude")
    expect(routingFacts(reg, undefined).defaultAgent).toBe("opencode")
  })
})
