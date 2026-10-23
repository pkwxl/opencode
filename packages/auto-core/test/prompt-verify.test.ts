// The plan verifier's routing and activation surface (plans/0080 §5 as
// amended by plans/0113): the verifier's model comes from the registry's
// deep planning route — the `phase-plan` candidate list walked with the
// classifierEntry discipline — never from the `classifier` route (the
// fleet's recurring fail-closed timeouts lived there), and the switch
// defaults off, its skip reason naming the switch and the default. The
// reply parser's pins live in charter-clamp.test.ts (both directions).
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { planningRouteEntry, verifyPlanPrompt } from "../src/prompt-verify"
import { clampSwitches } from "../src/switches"
import { promptFacts } from "../src/prompt-facts"
import type { RoutingFacts } from "../src/routing"
import { services } from "../src/services"
import type { ModelEntry, ModelRegistry, ModelRoute, TierList } from "../src/models-schema"
import type { AgentPool } from "../src/agent-pool"

const entry = (name: string, fields: Partial<ModelEntry> = {}): ModelEntry => ({ name, layer: "operator", agent: "opencode", model: `prov/${name}`, ...fields })

const registryOf = (input: { deep?: string[]; classifier?: string[]; phasePlanRoute?: string[] } = {}): ModelRegistry => ({
  layers: [{ name: "operator", path: "/unused/models.json" }],
  tz: "UTC",
  agents: new Map([["opencode", { name: "opencode", layer: "operator", adapter: "opencode" }]]),
  models: new Map(
    [...(input.deep ?? []), ...(input.classifier ?? []), ...(input.phasePlanRoute ?? [])].map((name) => [name, entry(name)]),
  ),
  tiers: { deep: { tier: "deep", names: input.deep ?? [], layer: "operator" } as TierList },
  routes: input.phasePlanRoute
    ? (new Map([["phase-plan", { key: "phase-plan", layer: "operator", names: input.phasePlanRoute } as ModelRoute]]) as ModelRegistry["routes"])
    : new Map(),
  unused: [],
  classifier: { names: input.classifier ?? [], layer: "operator" },
})

const routingOf = (registry: ModelRegistry): RoutingFacts => ({
  registry,
  agentFilter: "opencode",
  filterSource: undefined,
  defaultAgent: "opencode",
  runAgent: "opencode",
  router: services().router,
  clock: services().clock,
})

describe("planningRouteEntry (plans/0113: the deep planning route, not the classifier)", () => {
  const now = Date.parse("2026-10-22T12:00:00Z")

  test("picks the deep tier's first entry while the classifier route names a different model", () => {
    const routing = routingOf(registryOf({ deep: ["deep-model"], classifier: ["flash-model"] }))
    expect(planningRouteEntry(routing, undefined, now)).toMatchObject({ name: "deep-model" })
  })

  test("a phase-plan route override replaces the tier list (the operator's dedicated verifier model)", () => {
    const routing = routingOf(registryOf({ deep: ["deep-model"], phasePlanRoute: ["verifier-model"] }))
    expect(planningRouteEntry(routing, undefined, now)).toMatchObject({ name: "verifier-model" })
  })

  test("the agent filter skips entries on other adapters; only a classifier route or an empty deep tier yields undefined", () => {
    const flash = entry("flash-model")
    flash.agent = "claude"
    const claudeOnly = routingOf({
      ...registryOf({ deep: ["deep-model"] }),
      models: new Map([["deep-model", flash]]),
    })
    expect(planningRouteEntry(claudeOnly, undefined, now)).toBeUndefined()
    expect(planningRouteEntry(routingOf(registryOf({ classifier: ["flash-model"] })), undefined, now)).toBeUndefined()
  })
})

describe("verifyPlanPrompt's activation surface (the switch default and the skip reasons)", () => {
  const CHARTER_PACK = "# verify\n\n## guarantees\n\n### verify-plan\n\nThe charter bar the plan must serve.\n"
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-prompt-verify-"))
    await mkdir(join(dir, ".opencode", "auto", "intents"), { recursive: true })
    await writeFile(join(dir, ".opencode", "auto", "intents", "verify.md"), CHARTER_PACK)
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("the switch off (the default since plans/0113) skips naming the switch — the pool is never reached", async () => {
    clampSwitches({ planVerify: false })
    try {
      const facts = promptFacts({ dir, intent: "verify" })
      const outcome = await verifyPlanPrompt({ pool: undefined as unknown as AgentPool, routing: routingOf(registryOf({ deep: ["deep-model"] })), facts, step: "formulation R-01.P01", prompt: "THE PROMPT" })
      expect(outcome).toMatchObject({ kind: "skipped" })
      expect(outcome.kind === "skipped" && outcome.reason).toContain("OPENCODE_AUTO_PLAN_VERIFY=off — the semantic check is off (the default since plans/0113")
    } finally {
      clampSwitches({ planVerify: false })
    }
  })

  test("no routing skips naming the planning-route entry", async () => {
    clampSwitches({ planVerify: true })
    try {
      const facts = promptFacts({ dir, intent: "verify" })
      const outcome = await verifyPlanPrompt({ pool: undefined as unknown as AgentPool, routing: undefined, facts, step: "formulation R-01.P01", prompt: "THE PROMPT" })
      expect(outcome.kind === "skipped" && outcome.reason).toContain("no planning-route entry to run the verifier on")
    } finally {
      clampSwitches({ planVerify: false })
    }
  })

  test("a registry with only a classifier route (no usable planning-route entry) skips naming it", async () => {
    clampSwitches({ planVerify: true })
    try {
      const facts = promptFacts({ dir, intent: "verify" })
      const outcome = await verifyPlanPrompt({ pool: undefined as unknown as AgentPool, routing: routingOf(registryOf({ classifier: ["flash-model"] })), facts, step: "formulation R-01.P01", prompt: "THE PROMPT" })
      expect(outcome.kind === "skipped" && outcome.reason).toContain("no usable planning-route entry")
    } finally {
      clampSwitches({ planVerify: false })
    }
  })
})
