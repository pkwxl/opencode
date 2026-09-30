// Selection (plans/0055 §6, §14): the candidate list of a dispatch (§6.1),
// the pick of the usable candidate — a new prompt's first usable candidate
// against a continuation keeping the chain's model (§6.2) — and the decision
// when nothing is usable: the window wait, the all-down probe and the
// empty-tier error (§6.3). Everything runs over hand-built registries, fixed
// instants and injected marks, rings and windows: select is pure.
import { describe, expect, test } from "bun:test"
import { parseWindow, type ModelWindow } from "../src/model-window"
import type { ModelEntry, ModelReference, ModelRegistry, ModelRoute, RegistryAgentProfile, TierList } from "../src/models-schema"
import { phaseType, type Tier } from "../src/phases/registry"
import type { ModelPolicy } from "../src/switches"
import { candidatesOf, recoveryAt, select, type Candidate, type SelectCall, type SelectContext } from "../src/select"

// Friday 2026-09-25 12:00 UTC: inside the avoid windows the tests declare
// (00:00-13:00, 00:00-14:00) and outside the only window (00:00-08:00).
const NOW = Date.parse("2026-09-25T12:00:00Z")
const AT = (clock: string): number => Date.parse(`2026-09-25T${clock}:00Z`)

const analysis = phaseType("analysis")!
const implement = phaseType("implement")!

const window = (text: string): ModelWindow => {
  const parsed = parseWindow(text)
  if ("error" in parsed) throw new Error(parsed.error)
  return parsed.window
}

const entry = (name: string, fields: Partial<ModelEntry> = {}): ModelEntry => ({
  name,
  layer: "operator",
  agent: "opencode",
  ...fields,
})

// The fleet the tests route over: a local variation of the §4.2 example.
// opus and opus-b run on claude profiles, the rest on opencode.
const MODELS: ModelEntry[] = [
  entry("opus", { agent: "claude", model: "opus" }),
  entry("opus-b", { agent: "claude-b", model: "opus" }),
  entry("k3", { agent: "opencode", model: "moonshotai/kimi-k3-256k", wider: ["moonshotai/kimi-k3"] }),
  entry("glm", { agent: "opencode", model: "zhipuai/glm-4.6" }),
  entry("k2", { agent: "opencode", model: "moonshotai/kimi-k2" }),
]
const AGENTS: RegistryAgentProfile[] = [
  { name: "opencode", layer: "operator", adapter: "opencode" },
  { name: "claude", layer: "operator", adapter: "claude" },
  { name: "claude-b", layer: "operator", adapter: "claude" },
]
const TIERS: Partial<Record<Tier, TierList>> = {
  deep: { tier: "deep", names: ["opus", "opus-b", "k3"], layer: "operator" },
  simple: { tier: "simple", names: ["glm", "k2"], layer: "operator" },
}
const tierList = (tier: Tier, names: string[]): TierList => ({ tier, names, layer: "operator" })

type Fixture = {
  models?: ModelEntry[]
  tiers?: Partial<Record<Tier, TierList>>
  routes?: [string, ModelRoute][]
}

const registry = (f: Fixture = {}): ModelRegistry => ({
  layers: [{ name: "operator", path: "/unused/models.json" }],
  tz: "UTC",
  agents: new Map(AGENTS.map((profile) => [profile.name, profile])),
  models: new Map((f.models ?? MODELS).map((item) => [item.name, item])),
  tiers: f.tiers ?? TIERS,
  routes: new Map(f.routes ?? []),
  unused: [],
})

const NO_POLICY: ModelPolicy = { byLetter: {}, byType: {}, byRole: {}, fallback: [] }

const context = (f: Fixture = {}, over: Partial<SelectContext> = {}): SelectContext => ({
  registry: registry(f),
  cap: 64_000,
  defaultAgent: "opencode",
  policy: NO_POLICY,
  ...over,
})

// Scope-cleared down marks for the named candidates.
const marked = (...names: string[]): Map<string, { until?: number }> =>
  new Map(names.map((name): [string, { until?: number }] => [name, {}]))

const call = (over: Partial<SelectCall> = {}): SelectCall => ({ role: "whole", entry: analysis, now: NOW, ...over })

// The name a decision's candidate carries: the internal name of an entry, or
// the model string of a raw override value.
const nameOf = (candidate: Candidate): string => (candidate.kind === "entry" ? candidate.name : candidate.model)
const picked = (result: ReturnType<typeof select>): string | undefined =>
  result.kind === "pick" || result.kind === "wait" || result.kind === "probe" ? nameOf(result.candidate) : undefined

describe("the candidate list (§6.1)", () => {
  test("a route tier beats the default tier; a role route beats the type route; a route list replaces the tier's list", () => {
    const typeRoute: [string, ModelRoute][] = [["implement", { key: "implement", layer: "operator", tier: "deep" }]]
    const bothRoutes: [string, ModelRoute][] = [
      ...typeRoute,
      ["whole", { key: "whole", layer: "operator", names: ["k2"] }],
    ]
    // The implement type's execute tier is simple, but the type route makes
    // it deep: a whole session picks opus, not glm.
    expect(picked(select(context({ routes: typeRoute }), call({ entry: implement })))).toBe("opus")
    // The role route beats the type route and its list replaces the tier's.
    expect(picked(select(context({ routes: bothRoutes }), { role: "whole", entry: implement, now: NOW }))).toBe("k2")
  })

  test("an OPENCODE_AUTO_MODEL value replaces the list: an internal name, or a raw provider/model on the default agent", () => {
    const env = context({}, { policy: { ...NO_POLICY, byRole: { decompose: "glm" } } })
    expect(candidatesOf(env, call({ role: "decompose" })).override).toBe("env")
    expect(picked(select(env, call({ role: "decompose" })))).toBe("glm")
    const raw = context({}, { policy: { ...NO_POLICY, byRole: { decompose: "prov/raw-model" } } })
    const result = select(raw, call({ role: "decompose" }))
    expect(result).toMatchObject({ kind: "pick", via: "list" })
    if (result.kind === "pick") expect(result.candidate).toEqual({ kind: "raw", model: "prov/raw-model" })
  })

  test("the /failback order replaces every list; the env switch wins between the two", () => {
    const fb = context({}, { override: { wildcard: "k2", fallback: ["k3"] } })
    expect(candidatesOf(fb, call()).override).toBe("failback")
    expect(picked(select(fb, call()))).toBe("k2")
    // k2 down walks the override's own order, not the tier's.
    const walked = context({}, { override: { wildcard: "k2", fallback: ["k3"] }, marks: marked("k2") })
    expect(picked(select(walked, call()))).toBe("k3")
    const both = context({}, {
      override: { wildcard: "k2", fallback: ["k3"] },
      policy: { ...NO_POLICY, byRole: { whole: "glm" } },
    })
    expect(picked(select(both, call()))).toBe("glm")
  })

  test("a simple session's list continues down the deep list without repeating a model", () => {
    const ctx = context()
    expect(candidatesOf(ctx, call({ entry: implement })).candidates.map(nameOf)).toEqual([
      "glm",
      "k2",
      "opus",
      "opus-b",
      "k3",
    ])
  })
})

describe("borrowing (R3)", () => {
  test("a simple session continues down the deep list when its own list is down", () => {
    const ctx = context({}, { marks: marked("glm", "k2") })
    // implement's execute tier is simple: [glm, k2] then the borrowed deep
    // list, so the pick reaches opus.
    expect(picked(select(ctx, call({ entry: implement })))).toBe("opus")
  })

  test("a deep session never borrows a simple model: all deep down is the probe decision, not a simple pick", () => {
    const ctx = context({}, { marks: marked("opus", "opus-b", "k3") })
    const result = select(ctx, call())
    expect(result.kind).toBe("probe")
    expect(picked(result)).toBe("opus")
  })
})

describe("the pick (§6.2)", () => {
  test("a new prompt takes the first usable candidate in list order", () => {
    expect(picked(select(context(), call()))).toBe("opus")
    expect(picked(select(context({}, { marks: marked("opus") }), call()))).toBe("opus-b")
  })

  test("the primary returns when its window reopens", () => {
    const models = MODELS.map((item) => (item.name === "opus" ? { ...item, avoid: [window("00:00-13:00")] } : item))
    const ctx = context({ models })
    // 12:00 is inside opus's avoid window: the second candidate runs.
    expect(picked(select(ctx, call({ now: AT("12:00") })))).toBe("opus-b")
    // At 13:00 the window has reopened: the primary is back, with no state
    // beyond the list order and the clock.
    expect(picked(select(ctx, call({ now: AT("13:00") })))).toBe("opus")
  })

  test("a continuation keeps the chain's model — internal name or reached step — while it is still usable", () => {
    const ctx = context()
    expect(select(ctx, call({ current: "k3", continuation: true }))).toMatchObject({ kind: "pick", via: "continuation" })
    expect(picked(select(ctx, call({ current: "k3", continuation: true })))).toBe("k3")
    // The step the session reached names the same entry.
    expect(picked(select(ctx, call({ current: "moonshotai/kimi-k3", continuation: true })))).toBe("k3")
    // A raw current keeps the raw candidate.
    const raw = context({}, { policy: { ...NO_POLICY, byRole: { whole: "prov/raw" } } })
    expect(select(raw, call({ current: "prov/raw", continuation: true }))).toMatchObject({
      kind: "pick",
      via: "continuation",
    })
  })

  test("a continuation whose model is no longer usable falls back to the list", () => {
    const down = context({}, { marks: marked("k3") })
    expect(select(down, call({ current: "k3", continuation: true }))).toMatchObject({ kind: "pick", via: "list" })
    expect(picked(select(down, call({ current: "k3", continuation: true })))).toBe("opus")
    // A current that is not in the list at all (an override replaced it).
    const gone = context({}, { policy: { ...NO_POLICY, byRole: { whole: "glm" } } })
    expect(picked(select(gone, call({ current: "k3", continuation: true })))).toBe("glm")
    // A new prompt ignores the chain's model entirely.
    expect(picked(select(context(), call({ current: "k3" })))).toBe("opus")
  })

  test("the agent filter keeps only the models on its adapter; a raw value runs on the default agent", () => {
    const claude = context({}, { agentFilter: "claude" })
    expect(picked(select(claude, call()))).toBe("opus")
    // k3 is on opencode: filtered out of the pick and of the probe alike —
    // an unfiltered probe would take the unmarked, in-window k3.
    const claudeDown = context({}, { agentFilter: "claude", marks: marked("opus", "opus-b") })
    expect(select(claudeDown, call())).toMatchObject({ kind: "probe" })
    expect(picked(select(claudeDown, call()))).toBe("opus")
    const opencode = context({}, { agentFilter: "opencode" })
    expect(picked(select(opencode, call()))).toBe("k3")
    // A raw value passes only when the filter matches the default agent.
    const raw = context({}, { policy: { ...NO_POLICY, byRole: { whole: "prov/raw" } } })
    expect(picked(select(raw, call()))).toBe("prov/raw")
    const filtered = context({}, {
      agentFilter: "claude",
      policy: { ...NO_POLICY, byRole: { whole: "prov/raw" } },
    })
    expect(select(filtered, call())).toMatchObject({ kind: "empty", override: "env", filter: "claude" })
  })
})

describe("nothing usable (§6.3)", () => {
  const avoiding = (texts: Record<string, string>): ModelEntry[] =>
    MODELS.map((item) => (texts[item.name] ? { ...item, avoid: [window(texts[item.name]!)] } : item))

  test("the wait decision: the earliest opening among the candidates that are not down", () => {
    const ctx = context({ models: avoiding({ opus: "00:00-13:00", "opus-b": "00:00-14:00" }) }, { marks: marked("k3") })
    const result = select(ctx, call())
    expect(result).toMatchObject({ kind: "wait", until: AT("13:00") })
    expect(picked(result)).toBe("opus")
  })

  test("a candidate blocked only by its cap is not waited for: it never opens into usability", () => {
    const models = MODELS.map((item) => {
      if (item.name === "opus") return { ...item, avoid: [window("00:00-13:00")] }
      if (item.name === "opus-b") return { ...item, context: 32 }
      return item
    })
    // opus's window opens at 13:00; opus-b's known 32k window is below the
    // cap, so it is never a thing to wait for.
    expect(select(context({ models }, { marks: marked("k3") }), call())).toMatchObject({
      kind: "wait",
      until: AT("13:00"),
    })
    // With opus marked down too, no candidate opens: the probe loop.
    expect(select(context({ models }, { marks: marked("k3", "opus") }), call())).toMatchObject({ kind: "probe" })
  })

  test("the all-down probe uses the first candidate inside its window, ignoring the marks", () => {
    const ctx = context({}, { marks: marked("opus", "opus-b", "k3") })
    expect(select(ctx, call())).toMatchObject({ kind: "probe" })
    expect(picked(select(ctx, call()))).toBe("opus")
    // opus outside its window: the probe takes the next candidate that is
    // inside its own.
    const outOfWindow = context(
      { models: avoiding({ opus: "00:00-13:00" }) },
      { marks: marked("opus", "opus-b", "k3") },
    )
    expect(picked(select(outOfWindow, call()))).toBe("opus-b")
  })

  test("an until mark is down before its instant and cleared at it", () => {
    const ctx = context({}, { marks: new Map([["opus", { until: AT("13:00") }]]) })
    expect(picked(select(ctx, call({ now: AT("12:59") })))).toBe("opus-b")
    expect(picked(select(ctx, call({ now: AT("13:00") })))).toBe("opus")
  })

  test("a ring with no usable key excludes the entry; an entry without a ring ignores the predicate", () => {
    const key: ModelReference = { kind: "env", name: "MOONSHOT_KEY_A", ref: "{env:MOONSHOT_KEY_A}", label: "MOONSHOT_KEY_A" }
    const ringed = entry("k3", {
      agent: "opencode",
      model: "moonshotai/kimi-k3-256k",
      provider: "moonshotai",
      keys: [key],
    })
    const models = MODELS.map((item) => (item.name === "k3" ? ringed : item))
    const tiers = { deep: tierList("deep", ["k3", "opus"]), simple: TIERS.simple! }
    // k3's provider ring has no usable key: the walk skips it for opus.
    expect(picked(select(context({ models, tiers }, { ringUsable: () => false }), call()))).toBe("opus")
    expect(picked(select(context({ models, tiers }, { ringUsable: () => true }), call()))).toBe("k3")
    // k3 without a declared ring ignores the predicate entirely.
    expect(picked(select(context({ tiers }, { ringUsable: () => false }), call()))).toBe("k3")
  })

  test("the empty-tier error: an empty tier, or a list the agent filter empties", () => {
    // The deep tier declared empty: a deep session has no candidate.
    const emptyDeep = context({ tiers: { ...TIERS, deep: tierList("deep", []) } })
    expect(select(emptyDeep, call())).toEqual({ kind: "empty", tier: "deep" })
    // A tier that is not declared at all is the same emptiness.
    const undeclared = context({ tiers: { simple: TIERS.simple! } })
    expect(select(undeclared, call())).toEqual({ kind: "empty", tier: "deep" })
    // Every deep candidate on an opencode profile: the claude filter empties
    // the list, and the error names the filter.
    const opencodeDeep = context(
      { tiers: { deep: tierList("deep", ["k3"]), simple: TIERS.simple! } },
      { agentFilter: "claude" },
    )
    expect(select(opencodeDeep, call())).toEqual({ kind: "empty", tier: "deep", filter: "claude" })
    // The error names the route in force.
    const routed = context(
      {
        tiers: { deep: tierList("deep", ["k3"]), simple: TIERS.simple! },
        routes: [["whole", { key: "whole", layer: "operator", names: ["glm"] }]],
      },
      { agentFilter: "claude" },
    )
    expect(select(routed, call())).toEqual({ kind: "empty", tier: "deep", route: "whole", filter: "claude" })
  })
})

describe("the recovery instant (plans/0057 §6)", () => {
  const until = (marks: Record<string, string>): Map<string, { until?: number }> =>
    new Map(Object.entries(marks).map(([name, clock]): [string, { until?: number }] => [name, { until: AT(clock) }]))
  const at = (result: ReturnType<typeof recoveryAt>): [number, string] | undefined =>
    result === undefined ? undefined : [result.at, nameOf(result.candidate)]

  test("the soonest known end among the down candidates; a usable candidate is usable now", () => {
    const ctx = context({}, { marks: until({ opus: "15:00", "opus-b": "13:00", k3: "14:00" }) })
    expect(at(recoveryAt(ctx, call()))).toEqual([AT("13:00"), "opus-b"])
    // k3 not marked: usable now, so the instant is now.
    const open = context({}, { marks: until({ opus: "15:00", "opus-b": "13:00" }) })
    expect(at(recoveryAt(open, call()))).toEqual([NOW, "k3"])
  })

  test("any down candidate without a known end leaves the instant unknown: the wait polls", () => {
    const marks = until({ opus: "13:00", k3: "14:00" })
    marks.set("opus-b", {})
    expect(recoveryAt(context({}, { marks }), call())).toBeUndefined()
  })

  test("a ring with no usable key leaves the instant unknown; a cap-excluded candidate is not waited for", () => {
    const key: ModelReference = { kind: "env", name: "MOONSHOT_KEY_A", ref: "{env:MOONSHOT_KEY_A}", label: "MOONSHOT_KEY_A" }
    const ringed = MODELS.map((item) =>
      item.name === "k3" ? { ...item, provider: "moonshotai", keys: [key] } : item,
    )
    const marks = until({ opus: "15:00", "opus-b": "13:00" })
    expect(recoveryAt(context({ models: ringed }, { marks, ringUsable: () => false }), call())).toBeUndefined()
    expect(at(recoveryAt(context({ models: ringed }, { marks, ringUsable: () => true }), call()))).toEqual([NOW, "k3"])
    // opus-b's known 32k window is below the cap: its sooner end is ignored.
    const small = MODELS.map((item) => (item.name === "opus-b" ? { ...item, context: 32 } : item))
    const all = until({ opus: "15:00", "opus-b": "12:30", k3: "14:00" })
    expect(at(recoveryAt(context({ models: small }, { marks: all }), call()))).toEqual([AT("14:00"), "k3"])
  })

  test("an end inside a closed window moves to the window's next opening", () => {
    const models = MODELS.map((item) => (item.name === "opus" ? { ...item, avoid: [window("00:00-13:00")] } : item))
    const marks = until({ opus: "12:30", "opus-b": "14:00", k3: "15:00" })
    expect(at(recoveryAt(context({ models }, { marks }), call()))).toEqual([AT("13:00"), "opus"])
    // Not down but outside its window: usable at the opening.
    const open = until({ "opus-b": "14:00", k3: "15:00" })
    expect(at(recoveryAt(context({ models }, { marks: open }), call()))).toEqual([AT("13:00"), "opus"])
  })
})

describe("the context clamp (§6.2 rule 5)", () => {
  const fleet = (deep: string[]): Fixture => ({
    models: MODELS,
    tiers: { deep: tierList("deep", deep), simple: TIERS.simple! },
  })

  test("a known window below the cap skips the candidate; an unknown window never excludes it", () => {
    // k3's top step moonshotai/kimi-k3 is known at 60k, below the 64k cap.
    const small = context(fleet(["k3", "k2"]), { limits: new Map([["moonshotai/kimi-k3", 60_000]]) })
    expect(picked(select(small, call()))).toBe("k2")
    // The top step unknown: k3 is not excluded, and the base step's window
    // is not read for a stepped entry.
    const unknown = context(fleet(["k3", "k2"]), { limits: new Map([["moonshotai/kimi-k3-256k", 60_000]]) })
    expect(picked(select(unknown, call()))).toBe("k3")
  })

  test("the entry's context is the fallback for a model without steps, and the live window wins over it", () => {
    const models = [...MODELS, entry("small", { model: "prov/small", context: 32 })]
    const stepped: Fixture = { models, tiers: { deep: tierList("deep", ["small", "k2"]), simple: TIERS.simple! } }
    expect(picked(select(context(stepped), call()))).toBe("k2")
    const lifted = context(stepped, { limits: new Map([["prov/small", 100_000]]) })
    expect(picked(select(lifted, call()))).toBe("small")
  })

  test("a raw value is clamped by the live window of its model id", () => {
    const ctx = context(
      {},
      { policy: { ...NO_POLICY, byRole: { whole: "prov/raw" } }, limits: new Map([["prov/raw", 10_000]]) },
    )
    expect(select(ctx, call())).toMatchObject({ kind: "probe" })
    expect(picked(select(ctx, call()))).toBe("prov/raw")
  })

  test("an entry without model runs on the agent's default model: its window is unknown here", () => {
    const models = [...MODELS, entry("default")]
    const result = select(context({ models, tiers: { deep: tierList("deep", ["default"]), simple: TIERS.simple! } }), call())
    expect(result).toMatchObject({ kind: "pick" })
    if (result.kind === "pick") expect(result.candidate).toMatchObject({ kind: "entry", name: "default" })
  })
})
