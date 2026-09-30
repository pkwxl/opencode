// The dispatch plan (plans/0061 §4.7): what a dispatch decides before
// anything is created — the recorded-session takeover (resumed, the single
// in-chain continuation), the registry pick or its blocked outcome (empty
// tier, window wait, probe loop), the cross-agent move a pick forces, and
// whether a brand-new session clears the failback scope. One row per plan
// case, over hand-built registries, fixed instants and injected facts: the
// planner is pure, the chain is an input, and the executor (attempt) owns
// every write.
import { describe, expect, test } from "bun:test"
import { implicitRegistry } from "../src/models"
import { parseWindow, type ModelWindow } from "../src/model-window"
import type { ModelEntry, ModelRegistry, RegistryAgentProfile, TierList } from "../src/models-schema"
import type { SessionChain } from "../src/chain"
import { selectContext, type RoutingFacts } from "../src/routing"
import { services } from "../src/services"
import { clockAt } from "./fixtures/clock"
import { parseSwitches, SWITCH_ENV } from "../src/switches"
import { worktreeNote } from "../src/session-api"
import { planDispatch, type DispatchFacts } from "../src/engine/dispatch"

// Friday 2026-09-25 12:00 UTC: inside every avoid window the tests declare.
const NOW = Date.parse("2026-09-25T12:00:00Z")
const AT = (clock: string): number => Date.parse(`2026-09-25T${clock}:00Z`)

const DEFAULTS = parseSwitches({})
const fresh = (): SessionChain => ({ pct: 100, used: 0, at: 0 })

const window = (text: string): ModelWindow => {
  const parsed = parseWindow(text)
  if ("error" in parsed) throw new Error(parsed.error)
  return parsed.window
}

const entry = (name: string, fields: Partial<ModelEntry> = {}): ModelEntry => ({
  name,
  layer: "operator",
  agent: "a",
  ...fields,
})

const AGENTS: RegistryAgentProfile[] = [
  { name: "a", layer: "operator", adapter: "opencode" },
  { name: "b", layer: "operator", adapter: "opencode" },
]

const registry = (models: ModelEntry[], tiers?: Partial<Record<string, TierList>>): ModelRegistry => ({
  layers: [{ name: "operator", path: "/unused/models.json" }],
  tz: "UTC",
  agents: new Map(AGENTS.map((profile) => [profile.name, profile])),
  models: new Map(models.map((item) => [item.name, item])),
  tiers: tiers ?? ({ simple: { tier: "simple", names: models.map((item) => item.name), layer: "operator" } } as Partial<Record<string, TierList>>),
  routes: new Map(),
  unused: [],
})

// The routing facts of a run, with the clock pinned to the fixture instant;
// the selection context is built through the production seam, so the down
// marks and the /failback override enter exactly as the executor passes them.
const factsOf = (reg: ModelRegistry, over: Partial<RoutingFacts> = {}): RoutingFacts => ({
  registry: reg,
  agentFilter: undefined,
  filterSource: undefined,
  defaultAgent: "opencode",
  runAgent: "opencode",
  // The run's router (the selection context's marks and override source):
  // the installed services' instance, read per call so a test's marks land.
  router: services().router,
  clock: clockAt(NOW),
  ...over,
})

// The test's dispatch facts; `limits` is not a plan fact but the selection
// context's window map, threaded to the production seam below. reg undefined
// = no layers: the facts of the implicit registry the env switches
// synthesize, exactly what a layer-less run dispatches on.
const plan = (chain: SessionChain, reg: ModelRegistry | undefined, over: Partial<DispatchFacts> & { limits?: ReadonlyMap<string, number> } = {}) => {
  const { limits, ...rest } = over
  const facts = factsOf(reg ?? implicitRegistry("opencode", DEFAULTS.model))
  return planDispatch(chain, {
    routing: facts,
    ctx: selectContext(facts, DEFAULTS, 64_000, limits),
    resumable: true,
    label: "T-001",
    ...rest,
  })
}

describe("the dispatch plan", () => {
  // The probe row writes the live down-mark map through the production seam;
  // every row plans over a clean failback state.

  test("resumed: a recorded session with a note is taken over; every other prompt opens a fresh session", () => {
    const chain: SessionChain = { ...fresh(), id: "ses_9", note: "[DRIVER] continuation after interruption" }
    expect(plan(chain, undefined).resumed).toBe(true)
    // The takeover gate's capability (the chain's agent cannot resume) vetoes it.
    const noResume = plan(chain, undefined, { resumable: false })
    expect(noResume.resumed).toBe(false)
    // A one-shot note still pending on a pre-created fork is not a takeover:
    // the dispatch consumes the fork first.
    expect(plan({ ...chain, pending: "ses_7" }, undefined).resumed).toBe(false)
    expect(plan({ ...fresh(), id: "ses_9" }, undefined).resumed).toBe(false)
    // Over the implicit registry (no layers) the plan always picks: the
    // entry without a model, whose prompt carries no model key, and no
    // blocked outcome, no move.
    const implicit = plan(chain, undefined)
    expect(implicit.pick?.route).toEqual({ entry: "default", step: 0 })
    expect(implicit.blocked).toBeUndefined()
    expect(implicit.move).toBeUndefined()
  })

  test("registry pick: the first usable candidate of the role's tier, with its route, variant, agent and ◈ line", () => {
    const reg = registry([entry("s1", { model: "prov/s", variant: "think" }), entry("d1", { agent: "b", model: "prov/d" })])
    const outcome = plan(fresh(), reg)
    expect(outcome.blocked).toBeUndefined()
    expect(outcome.move).toBeUndefined()
    expect(outcome.resumed).toBe(false)
    expect(outcome.pick).toEqual({
      route: { model: "prov/s", entry: "s1", step: 0 },
      variant: "think",
      entry: reg.models.get("s1"),
      tier: "simple",
      agent: "a",
      announce: `◈ T-001 using model s1 [simple · a:prov/s] (route bypass)`,
    })
    // The plan decides without writing: the chain is an input, and the
    // executor owns every field write.
    const chain = fresh()
    const before = structuredClone(chain)
    plan(chain, reg)
    expect(chain).toEqual(before)
  })

  test("a resumed takeover under a registry keeps the chain's entry and recomputes the step from the rebuilt context", () => {
    const w1 = entry("w1", { model: "prov/w", wider: ["prov/ww"] })
    const reg = registry([w1])
    const chain: SessionChain = { ...fresh(), id: "ses_9", note: "continue", modelEntry: "w1", modelShown: "w1", agent: "a", used: 150_000 }
    const outcome = plan(chain, reg, { limits: new Map([
      ["prov/w", 100_000],
      ["prov/ww", 200_000],
    ]) })
    // §4.5's resume rule: the step comes from the context size rebuilt from
    // the session's history, and the prompt names the reached step's id.
    expect(outcome.resumed).toBe(true)
    expect(outcome.pick?.route).toEqual({ model: "prov/ww", entry: "w1", step: 1 })
    // A continuation of the same session on the same model is not announced.
    expect(outcome.pick?.announce).toBeUndefined()
  })

  test("blocked empty: the agent filter empties the list", () => {
    const reg = registry([entry("s1", { model: "prov/s" })])
    const facts = factsOf(reg, { agentFilter: "claude" })
    const outcome = planDispatch(fresh(), {
      routing: facts,
      ctx: selectContext(facts, DEFAULTS, 64_000),
      resumable: true,
      label: "T-001",
    })
    expect(outcome.pick).toBeUndefined()
    expect(outcome.blocked).toEqual({
      type: "blocked",
      question: "model registry: no candidate is left for this session's routing (the simple list, agent filter claude); fix the registry or the filter and re-run",
    })
  })

  test("blocked wait: every candidate outside its windows, the earliest opening carried", () => {
    const reg = registry([
      entry("e1", { model: "prov/1", avoid: [window("00:00-13:00")] }),
      entry("e2", { model: "prov/2", avoid: [window("00:00-12:30")] }),
    ])
    const outcome = plan(fresh(), reg)
    expect(outcome.pick).toBeUndefined()
    expect(outcome.blocked).toEqual({
      type: "blocked",
      question: "no usable model candidate now: every candidate of the simple list is outside its windows; waiting for the earliest opening",
      noModel: true,
      windowWait: { until: AT("12:30"), model: "e2", tier: "simple", opens: "opens 12:30 UTC" },
    })
  })

  test("blocked probe: every candidate down", () => {
    const reg = registry([entry("e1", { model: "prov/1" }), entry("e2", { model: "prov/2" })])
    services().router.markModelDown("e1")
    services().router.markModelDown("e2")
    const outcome = plan(fresh(), reg)
    expect(outcome.pick).toBeUndefined()
    expect(outcome.blocked).toEqual({
      type: "blocked",
      question: "no usable model candidate: every candidate of the simple list is down or outside its windows; entering the wait-and-probe loop",
      noModel: true,
    })
  })

  test("agent move: a pick on another agent drops the pending session with the ↻ line and a worktree-check note, and cancels a takeover", () => {
    const reg = registry([entry("s1", { model: "prov/s" }), entry("d1", { agent: "b", model: "prov/d" })])
    // A pre-created fork on the chain's agent cannot travel to the pick's
    // agent: it is dropped, and the blank session there is told to check the
    // worktree first.
    const withFork: SessionChain = { ...fresh(), agent: "b", pending: "ses_7" }
    const outcome = plan(withFork, reg)
    expect(outcome.move).toEqual({
      note: worktreeNote("The dispatch moved to agent a (a session never crosses agents) and did not inherit the earlier session's context"),
      pendingLog: "↻ T-001 the pre-created session ses_7 lives on agent b; the dispatch moved to a, so a new session opens there",
    })
    expect(outcome.resumed).toBe(false)
    // A takeover due on the chain's session moves the same way (only new
    // prompts move; the session itself is not moved) — no fork to report.
    const takeover: SessionChain = { ...fresh(), agent: "b", id: "ses_9", note: "continue" }
    const moved = plan(takeover, reg)
    expect(moved.move).toEqual({
      note: worktreeNote("The dispatch moved to agent a (a session never crosses agents) and did not inherit the earlier session's context"),
      pendingLog: undefined,
    })
    expect(moved.resumed).toBe(false)
    // The pick's own agent never moves anything.
    expect(plan({ ...fresh(), agent: "a", pending: "ses_7" }, reg).move).toBeUndefined()
  })

})
