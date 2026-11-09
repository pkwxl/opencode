// Unit tests for src/unit-commit.ts: the afterSession completion-condition
// gate, the strict-resume model checks and the unit rollback orchestration.
// Split out of test/runner.test.ts (plans/0024-module-split-plan.md S18, pure
// move).

import { beforeEach, describe, expect, test } from "bun:test"
import { clockAt, fixedClock } from "./fixtures/clock"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { commitTree, unitBaseline } from "../src/git"
import { afterSession, noCommitGit } from "../src/git-ops"
import { recallHandover, saveHandover } from "../src/handover"
import { parseSwitches, SWITCH_ENV } from "../src/switches"
import { deadSessionWhy, resumeModelEligible, resumeModelNow, rollbackUnitState } from "../src/unit-commit"
// The agent verdict lives behind the routing fence in the router's module
// (its no-registry guard is a routing-truthiness branch).
import { recordedAgentOk } from "../src/router"
import { services } from "../src/services"
import { freshRepo, task } from "./fixtures/runner"

describe("afterSession completion-condition gate (plans/0021-commit-boundary-design.md)", () => {
  test("a commit failure (pre-commit rejects) → failed with the problem text; the no-commit double → ok", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-after-gate-"))
    try {
      await Bun.spawn(["git", "-C", dir, "init", "-q"]).exited
      await mkdir(join(dir, "hooks"))
      await writeFile(join(dir, "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 })
      await Bun.spawn(["git", "-C", dir, "config", "core.hooksPath", "hooks"]).exited
      await writeFile(join(dir, "a.txt"), "a")
      const failed = await afterSession(dir, {}, { id: "T-001", title: "sample" }, { stage: "execute", subject: "T-001 execute" })
      expect(failed.type).toBe("failed")
      if (failed.type === "failed") expect(failed.question).toContain("unified commit failed")
      const off = await noCommitGit().afterSession(dir, {}, { id: "T-001", title: "sample" }, { stage: "execute", subject: "T-001 execute" })
      expect(off).toEqual({ type: "ok" })
      const none = await afterSession(undefined, {}, { id: "T-001", title: "sample" }, { stage: "execute", subject: "T-001 execute" })
      expect(none).toEqual({ type: "ok" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ---- rollbackUnitState (unit rollback orchestration) ----

describe("rollbackUnitState (unit rollback orchestration)", () => {
  test("a successful rollback also voids the in-flight test-handover record (.auto/handover.json deleted)", async () => {
    const dir = await freshRepo()
    try {
      await writeFile(join(dir, "seed.txt"), "s")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: pre-baseline commit" })
      const baseline = await unitBaseline(dir)
      await writeFile(join(dir, "wip.txt"), "half-finished work")
      // The in-flight record: midway between the freeze and the wrap-up (with
      // the script still to run and the freeze anchor).
      await saveHandover(dir, {
        task: "T-001",
        scope: "docs/T-001/testhandoff.md",
        unit: "execute",
        n: 1,
        script: join(dir, "test", "t.sh"),
        pinSession: "ses_pin",
      })
      const done = await rollbackUnitState(dir, task, "execute session", baseline!)
      expect(done.type).toBe("ok")
      // The freeze commit and anchor the record points at belong to the
      // reclaimed unit; left in place, the redo would be picked up by the
      // recovery state machine as "continue the discarded handover".
      expect(await recallHandover(dir, "T-001", "docs/T-001/testhandoff.md")).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // plans/0237 D1 (0165-019): the sibling guard at this one home — the
  // rollback is refused BEFORE any git call while sibling doc lanes' state
  // is in the tree, never the tree-wide stash-and-reset sweep.
  test("a rollback with live sibling scopes is refused before any git call — nothing stashed, nothing reset, the sibling's dirt intact (plans/0237 D1)", async () => {
    const dir = await freshRepo()
    try {
      await writeFile(join(dir, "seed.txt"), "s")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: pre-baseline commit" })
      const baseline = await unitBaseline(dir)
      // This unit's half-work beside a sibling lane's in-flight file.
      await mkdir(join(dir, "docs", "T-001"), { recursive: true })
      await mkdir(join(dir, "docs", "T-002"), { recursive: true })
      await writeFile(join(dir, "docs", "T-001", "wip.md"), "half-finished work")
      await writeFile(join(dir, "docs", "T-002", "inflight.md"), "the sibling lane's in-flight work")
      const refused = await rollbackUnitState(dir, task, "execution session", baseline!, { siblingScopes: ["docs/T-002/"] })
      expect(refused).toEqual({
        type: "blocked",
        question:
          "T-001 execution session: strict resume would roll the unit back to its baseline, but sibling doc lanes' state is in the tree (docs/T-002/); " +
          "a rollback is tree-wide and would sweep it. Handle the sibling state (commit or clean it) and re-run serially (--max-sessions 1) so the rollback can proceed safely",
      })
      // Nothing was touched: no stash, no reset, both units' dirt intact.
      const stashes = await new Response(Bun.spawn(["git", "-C", dir, "stash", "list"]).stdout).text()
      expect(stashes).toBe("")
      expect(await Bun.file(join(dir, "docs", "T-001", "wip.md")).text()).toBe("half-finished work")
      expect(await Bun.file(join(dir, "docs", "T-002", "inflight.md")).text()).toBe("the sibling lane's in-flight work")
      // Without the fact the rollback runs as before (the P10 floor).
      const done = await rollbackUnitState(dir, task, "execution session", baseline!)
      expect(done.type).toBe("ok")
      const after = await new Response(Bun.spawn(["git", "-C", dir, "stash", "list"]).stdout).text()
      expect(after).toContain("auto-rollback")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("resumeModelNow (strict-resume model check)", () => {
  const switches = parseSwitches({ [SWITCH_ENV.model]: "implement-scan=kimi/scan,*=kimi/k2" })
  const step = { kind: "step" as const, step: "phase-plan" as const, unit: "R-01.P01" }

  test("an explicit role wins over the phase, as it does at dispatch (plans/0053 D12)", () => {
    expect(resumeModelNow({}, switches, step)).toBe("kimi/k2")
    expect(resumeModelNow({}, switches, step, "implement-scan")).toBe("kimi/scan")
  })

  // Under a registry (plans/0055 §6.2) the comparison runs on internal names:
  // the record holds the dispatched entry's internal name, and the check
  // returns the selection's pick for the same routing — the marks and windows
  // apply, the env-switch chain does not.
  test("under a registry: the pick's internal name, down marks and windows applying", () => {
    const entry = (name: string, fields: Partial<import("../src/models-schema").ModelEntry> = {}): import("../src/models-schema").ModelEntry => ({
      name,
      layer: "operator",
      agent: "opencode",
      ...fields,
    })
    const registry: import("../src/models-schema").ModelRegistry = {
      layers: [{ name: "operator", path: "/unused/models.json" }],
      tz: "UTC",
      agents: new Map([["opencode", { name: "opencode", layer: "operator", adapter: "opencode" }]]),
      models: new Map([entry("a", { model: "prov/a" }), entry("b", { model: "prov/b" })].map((item) => [item.name, item])),
      tiers: { deep: { tier: "deep", names: ["a", "b"], layer: "operator" }, simple: { tier: "simple", names: ["b"], layer: "operator" } },
      routes: new Map(),
      unused: [],
    }
    const routing: import("../src/routing").RoutingFacts = {
      registry,
      agentFilter: "opencode",
      filterSource: undefined,
      defaultAgent: "opencode",
      runAgent: "opencode",
      router: services().router,
      clock: clockAt(0),
    }
    const opts: import("../src/opts").Opts = { routing }
    // A deep planning step picks the deep list's first entry.
    expect(resumeModelNow(opts, parseSwitches({}), step)).toBe("a")
    // The primary marked down: the record's "a" would mismatch the pick.
    services().router.markModelDown("a")
    expect(resumeModelNow(opts, parseSwitches({}), step)).toBe("b")
  })

  // §10 item 11 (plans/0055): under a registry the strict check compares the
  // recorded internal name and agent with eligibility replacing equality — a
  // window change that only moves the fresh pick does not roll a unit back,
  // while a model that is down or outside its windows is a dead session.
  describe("resumeModelEligible / deadSessionWhy (plans/0055 §8.3, §10 item 11)", () => {
    const entry = (name: string, fields: Partial<import("../src/models-schema").ModelEntry> = {}): import("../src/models-schema").ModelEntry => ({
      name,
      layer: "operator",
      agent: "opencode",
      ...fields,
    })
    // Friday 2026-09-25 12:00 UTC.
    const NOW = Date.parse("2026-09-25T12:00:00Z")
    const registryOf = (models: import("../src/models-schema").ModelEntry[]): import("../src/models-schema").ModelRegistry => ({
      layers: [{ name: "operator", path: "/unused/models.json" }],
      tz: "UTC",
      agents: new Map([["opencode", { name: "opencode", layer: "operator", adapter: "opencode" }]]),
      models: new Map(models.map((item) => [item.name, item])),
      tiers: { deep: { tier: "deep", names: models.map((item) => item.name), layer: "operator" }, simple: { tier: "simple", names: [], layer: "operator" } },
      routes: new Map(),
      unused: [],
    })
    const factsOf = (
      models: import("../src/models-schema").ModelEntry[],
      clock: import("../src/services").Clock = clockAt(NOW),
    ): import("../src/routing").RoutingFacts => ({
      registry: registryOf(models),
      agentFilter: "opencode",
      filterSource: undefined,
      defaultAgent: "opencode",
      runAgent: "opencode",
      router: services().router,
      clock,
    })
    const bare = parseSwitches({})
    const step = { kind: "step" as const, step: "phase-plan" as const, unit: "R-01.P01" }

    test("eligibility replaces equality: a usable recorded model stays eligible although it is not the fresh pick", () => {
      const models = [entry("a", { model: "prov/a" }), entry("b", { model: "prov/b" })]
      const opts: import("../src/opts").Opts = { routing: factsOf(models) }
      // The fresh pick is "a"; a record of the second entry "b" would fail the
      // old equality comparison — by eligibility "b" is still usable, so the
      // unit is not rolled back and the resumed session keeps "b".
      expect(resumeModelNow(opts, bare, step)).toBe("a")
      expect(resumeModelEligible(opts, bare, "b", step)).toBe(true)
      expect(deadSessionWhy(opts, bare, { model: "b", phase: step })).toBeUndefined()
    })

    test("a window change alone does not roll a unit back: the pick moved, the recorded model is still usable", async () => {
      // "x" opens only in the evening, so at 12:00 the pick of [x, a] is "a";
      // by 19:00 x's window has opened and the fresh pick moves to "x". The
      // record ("a", dispatched while x was closed) stays eligible: only the
      // pick moved, "a" itself is unchanged and usable.
      const { parseWindow } = await import("../src/model-window")
      const parsed = parseWindow("18:00-24:00")
      if ("error" in parsed) throw new Error(parsed.error)
      const models = [entry("x", { model: "prov/x", only: [parsed.window] }), entry("a", { model: "prov/a" })]
      let now = NOW
      const opts: import("../src/opts").Opts = { routing: factsOf(models, fixedClock(() => now)) }
      expect(resumeModelNow(opts, bare, step)).toBe("a")
      now = Date.parse("2026-09-25T19:00:00Z")
      expect(resumeModelNow(opts, bare, step)).toBe("x")
      expect(resumeModelEligible(opts, bare, "a", step)).toBe(true)
    })

    test("a recorded model blocked only by its window is eligible-with-wait, not a dead session (plans/0219 D2, 0165-129)", async () => {
      // The finding's scene: a run killed (or /exit-ed) while its recorded
      // model's `only` window was open — at the re-run instant the model is
      // outside its window, but the window reopens at a known instant: a
      // schedule is not evidence of death, the session's context is kept
      // (P20) and its next dispatch waits for the opening or fails over per
      // §6.2's own law. Fresh internal names — the process-wide router's down
      // marks survive across tests.
      const { parseWindow } = await import("../src/model-window")
      const parsed = parseWindow("18:00-24:00")
      if ("error" in parsed) throw new Error(parsed.error)
      // One candidate: the redo's own dispatch would wait for the same
      // opening — a rollback (or a fresh session) buys nothing but a stash.
      const alone: import("../src/opts").Opts = { routing: factsOf([entry("w", { model: "prov/w", only: [parsed.window] })]) }
      expect(resumeModelEligible(alone, bare, "w", step)).toBe(true)
      expect(deadSessionWhy(alone, bare, { model: "w", phase: step })).toBeUndefined()
      // With another model usable now the session is still kept: eligibility
      // judges the session's life, and the next dispatch's pick (the failover
      // to "other") is §6.2's own law, unchanged.
      const withOther: import("../src/opts").Opts = {
        routing: factsOf([entry("w", { model: "prov/w", only: [parsed.window] }), entry("other", { model: "prov/other" })]),
      }
      expect(resumeModelEligible(withOther, bare, "w", step)).toBe(true)
      expect(deadSessionWhy(withOther, bare, { model: "w", phase: step })).toBeUndefined()
    })

    test("not eligible: marked down, or gone from the registry (the shapes the dead verdict keeps — 0219 D2 re-pointed §10 item 11's old outside-its-windows arm)", async () => {
      const { parseWindow } = await import("../src/model-window")
      const parsed = parseWindow("18:00-24:00")
      if ("error" in parsed) throw new Error(parsed.error)
      const models = [entry("a", { model: "prov/a", only: [parsed.window] }), entry("b", { model: "prov/b" })]
      const opts: import("../src/opts").Opts = { routing: factsOf(models) }
      // Marked down: failure evidence the window cannot cure — "a" is
      // outside its window too, and the mark is what keeps it dead.
      services().router.markModelDown("b")
      expect(resumeModelEligible(opts, bare, "b", step)).toBe(false)
      services().router.markModelDown("a")
      expect(resumeModelEligible(opts, bare, "a", step)).toBe(false)
      expect(deadSessionWhy(opts, bare, { model: "a", phase: step })).toContain("not usable now")
      // Gone from the registry (a stale record of a removed entry).
      expect(resumeModelEligible(opts, bare, "gone", step)).toBe(false)
      expect(deadSessionWhy(opts, bare, { model: "gone", phase: step })).toContain("not usable now")
    })

    test("an agent this run cannot dispatch on is a dead session; absent = the run's start profile", () => {
      const models = [entry("a", { model: "prov/a" })]
      const routing = factsOf(models)
      const opts: import("../src/opts").Opts = { routing }
      expect(recordedAgentOk(routing, undefined)).toBe(true)
      expect(recordedAgentOk(routing, "opencode")).toBe(true)
      // No registry profile of that name at all.
      expect(recordedAgentOk(routing, "claude-b")).toBe(false)
      expect(deadSessionWhy(opts, bare, { agent: "claude-b", phase: step })).toContain("lives on agent claude-b")
      expect(deadSessionWhy(opts, bare, { agent: "opencode", phase: step })).toBeUndefined()
      // A record naming no model has nothing to judge: only the agent half.
      expect(deadSessionWhy(opts, bare, { phase: step })).toBeUndefined()
    })

    test("a session whose agent the filter excludes is dead, although the registry knows the profile (§8.3)", () => {
      // A fleet of two adapters with the filter narrowed to opencode: the
      // claude profile is known but never dispatchable, so its records are
      // dead; without a filter both agents serve the run.
      const models = [entry("a", { model: "prov/a" })]
      const registry = {
        ...registryOf(models),
        agents: new Map([
          ["opencode", { name: "opencode", layer: "operator" as const, adapter: "opencode" }],
          ["claude-b", { name: "claude-b", layer: "operator" as const, adapter: "claude" }],
        ]),
      }
      const filtered = factsOf(models)
      filtered.registry = registry
      const open: typeof filtered = { ...filtered, agentFilter: undefined, filterSource: undefined }
      expect(recordedAgentOk(filtered, "claude-b")).toBe(false)
      expect(deadSessionWhy({ routing: filtered }, bare, { agent: "claude-b", phase: step })).toContain("agent filter opencode")
      expect(recordedAgentOk(open, "claude-b")).toBe(true)
      expect(deadSessionWhy({ routing: open }, bare, { agent: "claude-b", phase: step })).toBeUndefined()
    })
  })
})
