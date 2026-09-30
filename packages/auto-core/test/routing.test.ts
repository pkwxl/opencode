// The run's routing facts (plans/0055 §6): the run-start routing block
// (§6.5) over a hand-built registry, and the dispatch-coverage refusal of
// the run start (§6.3). The dispatch behavior these facts drive is covered
// by test/agent-fake.test.ts; the selection core itself by test/select.test.ts.
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { parseWindow } from "../src/model-window"
import type { ModelEntry, ModelRegistry, ModelRoute, RegistryAgentProfile, TierList } from "../src/models-schema"
import { phaseType } from "../src/phases/registry"
import { dispatchCoverageProblems, logRunRouting, routingFacts, type DispatchNeed, type RoutingFacts } from "../src/routing"
import { services } from "../src/services"
import { parseSwitches, SWITCH_ENV } from "../src/switches"
import { clockAt } from "./fixtures/clock"

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
  runAgent: "opencode",
  // The run's router (the selection context's state source): the installed
  // services' instance, so a test that marks through it is read here.
  router: services().router,
  clock: clockAt(NOW),
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

  test("active rings show the live position by reference name; an external server shows the declared size and the inactive note", () => {
    const key = (name: string) => ({ kind: "env" as const, name, ref: `{env:${name}}`, label: name })
    const models = [
      entry("glm", { model: "zhipuai/glm-4.6", provider: "zhipuai", keys: [key("ZHIPU_KEY_A"), key("ZHIPU_KEY_B"), key("ZHIPU_KEY_C")] }),
      entry("k3", { model: "moonshotai/kimi-k3-256k", provider: "moonshotai" }),
    ]
    const reg = registry(models, { deep: { tier: "deep", names: ["glm", "k3"], layer: "operator" }, simple: { tier: "simple", names: ["k3"], layer: "operator" } })
    // A managed server: the tier line names the ring's current key.
    services().router.activateRings(reg, false)
    logRunRouting(facts(reg))
    expect(printed).toContain("◇ tier deep [operator layer]: glm (opencode, open, ring 1/3 ZHIPU_KEY_A) → k3 (opencode, open, ring 0)")
    // A rotation moves the display: the position never moves back on its own.
    services().router.commitRotation(services().router.ringRotation("zhipuai", NOW)!)
    printed.length = 0
    logRunRouting(facts(reg))
    expect(printed).toContain("◇ tier deep [operator layer]: glm (opencode, open, ring 2/3 ZHIPU_KEY_B) → k3 (opencode, open, ring 0)")
    // An external server: the declared size only, plus the inactive note.
    services().router.activateRings(reg, true)
    printed.length = 0
    logRunRouting(facts(reg))
    expect(printed).toContain("◇ tier deep [operator layer]: glm (opencode, open, ring 3) → k3 (opencode, open, ring 0)")
    expect(printed.some((line) => line.startsWith("ℹ key rings are inactive:"))).toBe(true)
  })
})

describe("dispatch coverage of the run start (§6.3)", () => {
  const implement = phaseType("implement")!
  const models = [entry("opus", { agent: "claude", model: "opus" }), entry("glm", { model: "zhipuai/glm-4.6" })]
  const tiers = {
    deep: { tier: "deep" as const, names: ["opus"], layer: "operator" as const },
    simple: { tier: "simple" as const, names: ["glm"], layer: "operator" as const },
  }
  const fix = "fix the registry or the agent filter and re-run"

  test("every need with a candidate after the filter passes", () => {
    const needs: DispatchNeed[] = [{ role: "bypass" }, { role: "decompose", entry: implement }]
    expect(dispatchCoverageProblems(registry(models, tiers), undefined, needs)).toEqual([])
    // opus serves the claude filter, glm the opencode filter: each need has a
    // candidate under the filter its own tier survives.
    expect(dispatchCoverageProblems(registry(models, tiers), "claude", [{ role: "decompose", entry: implement }])).toEqual([])
    expect(dispatchCoverageProblems(registry(models, tiers), "opencode", [{ role: "bypass" }])).toEqual([])
  })

  test("the filter emptying a needed tier, an undeclared tier and an empty tier are each one refusal", () => {
    // A filter no model serves empties both tiers. glm alone would not empty
    // the bypass need: a simple tier borrows the deep list, and opus serves
    // the claude filter.
    expect(dispatchCoverageProblems(registry(models, tiers), "kimi", [{ role: "bypass" }, { role: "decompose", entry: implement }])).toEqual([
      `model registry: the simple tier has no candidate left after the agent filter kimi (tiers.simple: glm); the bypass sessions of this run would have no model to dispatch on (${fix})`,
      `model registry: the deep tier has no candidate left after the agent filter kimi (tiers.deep: opus); the decompose sessions of implement phases would have no model to dispatch on (${fix})`,
    ])
    expect(dispatchCoverageProblems(registry(models, { simple: tiers.simple }), "opencode", [{ role: "decompose", entry: implement }])).toEqual([
      `model registry: the deep tier is not declared (tiers.deep: (empty)); the decompose sessions of implement phases would have no model to dispatch on (${fix})`,
    ])
    expect(
      dispatchCoverageProblems(registry(models, { deep: { tier: "deep", names: [], layer: "operator" }, simple: tiers.simple }), "opencode", [
        { role: "decompose", entry: implement },
      ]),
    ).toEqual([
      `model registry: the deep tier is declared empty (tiers.deep: (empty)); the decompose sessions of implement phases would have no model to dispatch on (${fix})`,
    ])
  })

  test("one line per emptied list: the first need names it, later needs on the same list stay silent", () => {
    expect(dispatchCoverageProblems(registry(models, tiers), "opencode", [{ role: "bypass" }, { role: "decompose", entry: implement }, { role: "phase-plan" }])).toEqual([
      `model registry: the deep tier has no candidate left after the agent filter opencode (tiers.deep: opus); the decompose sessions of implement phases would have no model to dispatch on (${fix})`,
    ])
  })

  test("a route in force names the route: a filtered list route and an emptied tier route", () => {
    const routes: [string, ModelRoute][] = [
      ["decompose", { key: "decompose", layer: "operator", names: ["opus"] }],
      ["subtask", { key: "subtask", layer: "operator", tier: "deep" }],
    ]
    const empty = registry(models, { deep: { tier: "deep", names: [], layer: "operator" }, simple: tiers.simple }, routes)
    expect(dispatchCoverageProblems(empty, "opencode", [{ role: "decompose", entry: implement }, { role: "subtask", entry: implement }])).toEqual([
      `model registry: route decompose has no candidate left after the agent filter opencode (route decompose: opus); the decompose sessions of implement phases would have no model to dispatch on (${fix})`,
      `model registry: route subtask (the deep tier) is declared empty (route subtask: (empty)); the subtask sessions of implement phases would have no model to dispatch on (${fix})`,
    ])
  })
})

describe("routingFacts (the filter and the default agent)", () => {
  test("the configured agent is the default agent, never a filter (R6); the filter is the shell profile agent or OPENCODE_AUTO_AGENT alone (§9)", () => {
    const reg = registry([], {})
    // Scrub the ambient OPENCODE_AUTO_AGENT the driver exports to its
    // children (the deliverables doc's environment caveat) — the filter
    // reads it through autoSwitches.
    const ambient = process.env.OPENCODE_AUTO_AGENT
    delete process.env.OPENCODE_AUTO_AGENT
    try {
      const facts = routingFacts(reg, "claude", clockAt(0), services().router)
      expect(facts.defaultAgent).toBe("claude")
      // A configured agent no longer filters: with the agent pool,
      // candidates on every profile are selectable and `claude` only names
      // the agent raw override values and unqualified records resolve to.
      expect(facts.agentFilter).toBeUndefined()
      expect(facts.filterSource).toBeUndefined()
      expect(routingFacts(reg, undefined, clockAt(0), services().router).defaultAgent).toBe("opencode")
    } finally {
      if (ambient !== undefined) process.env.OPENCODE_AUTO_AGENT = ambient
    }
  })

  // The run agent (§8.2): the profile the pool names as its default, passed
  // by the loop from the pool's start; without it the configured agent's own
  // name is the fallback (exact whenever the profile is named like its
  // adapter, which the implied opencode profile always is).
  test("runAgent is the started profile when passed, else the configured agent's name", () => {
    const reg = registry([], {})
    expect(routingFacts(reg, undefined, clockAt(0), services().router, "claude-b").runAgent).toBe("claude-b")
    expect(routingFacts(reg, "claude", clockAt(0), services().router).runAgent).toBe("claude")
    expect(routingFacts(reg, undefined, clockAt(0), services().router).runAgent).toBe("opencode")
  })

  // No layer in force (0061 F2): the facts are built over the implicit
  // registry the env switches synthesize, so a run's routing facts are
  // always defined.
  test("registry undefined = the implicit registry over the env switches, on the agent the filter names", () => {
    const ambient = process.env.OPENCODE_AUTO_AGENT
    delete process.env.OPENCODE_AUTO_AGENT
    try {
      const facts = routingFacts(undefined, undefined, clockAt(0), services().router)
      expect(facts.registry.implicit).toBe(true)
      expect(facts.registry.layers).toEqual([])
      // An empty policy: the default entry alone, in both tiers.
      expect(facts.registry.tiers.deep?.names).toEqual(["default"])
      expect(facts.agentFilter).toBeUndefined()
      expect(facts.defaultAgent).toBe("opencode")
      // The loop hands the layer registry in when layers exist; the switches
      // the session layer injected drive the synthesis exactly as they drive
      // everything else (the runtime reader, not the ambient memo).
      const claudeFacts = routingFacts(undefined, "claude", clockAt(0), services().router, undefined, parseSwitches({ [SWITCH_ENV.agent]: "claude" }))
      expect(claudeFacts.agentFilter).toBe("claude")
      expect([...claudeFacts.registry.agents.keys()]).toEqual(["claude"])
    } finally {
      if (ambient !== undefined) process.env.OPENCODE_AUTO_AGENT = ambient
    }
  })
})
