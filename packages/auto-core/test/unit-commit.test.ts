// src/unit-commit.ts 的单测: refcheck 挂点门禁(gatedAutoCorrectRefs)与 afterSession 完成条件门禁。
// 拆分自 test/runner.test.ts(plans/0024-module-split-plan.md S18,纯搬运)。

import { beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearSticky, markModelDown, resetFailback } from "../src/failback"
import { commitTree, unitBaseline } from "../src/git"
import { recallHandover, saveHandover } from "../src/handover"
import { parseSwitches, SWITCH_ENV } from "../src/switches"
import { afterSession, deadSessionWhy, gatedAutoCorrectRefs, recordedAgentOk, resumeModelEligible, resumeModelNow, rollbackUnitState } from "../src/unit-commit"
import { git, freshRepo, task } from "./fixtures/runner"

// ---- refcheck 挂点门禁(refcheck-scope-design D3,OPENCODE_AUTO_REF_CHECK 缺省 off)----

describe("gatedAutoCorrectRefs(OPENCODE_AUTO_REF_CHECK 挂点门禁)", () => {
  test("off(缺省): 提交前 auto-correct 空转,目标目录零引用检查行为", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, "src/old.ts"), "code\n")
      await Bun.write(join(dir, "docs/T-001/report.md"), "见 `src/old.ts` 与 `docs/gone.md`。\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      // 提交前发生移动(rename 配对可得),但 off 时不得改写
      await Bun.spawn(["mv", join(dir, "src/old.ts"), join(dir, "src/new.ts")]).exited
      const before = await Bun.file(join(dir, "docs/T-001/report.md")).text()
      await gatedAutoCorrectRefs(dir, false)
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe(before)
      // 不扫失效引用、不产生失效清单
      expect(await Bun.file(join(dir, ".auto/invalid-refs.md")).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("on: auto-correct 按 rename 配对改写并落失效清单", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, "src/old.ts"), "code\n")
      await Bun.write(join(dir, "docs/T-001/report.md"), "见 `src/old.ts` 与 `docs/gone.md`。\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      await Bun.spawn(["mv", join(dir, "src/old.ts"), join(dir, "src/new.ts")]).exited
      await gatedAutoCorrectRefs(dir, true)
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe("见 `src/new.ts` 与 `docs/gone.md`。\n")
      expect(await Bun.file(join(dir, ".auto/invalid-refs.md")).exists()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("afterSession 完成条件门禁(plans/0021-commit-boundary-design.md)", () => {
  test("提交失败(pre-commit 拒绝)→ failed 带问题文本;门禁关闭(--commit false)→ ok", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-after-gate-"))
    try {
      await Bun.spawn(["git", "-C", dir, "init", "-q"]).exited
      await mkdir(join(dir, "hooks"))
      await writeFile(join(dir, "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 })
      await Bun.spawn(["git", "-C", dir, "config", "core.hooksPath", "hooks"]).exited
      await writeFile(join(dir, "a.txt"), "a")
      const failed = await afterSession(dir, {}, { id: "T-001", title: "示例" }, { stage: "execute", subject: "T-001 执行" })
      expect(failed.type).toBe("failed")
      if (failed.type === "failed") expect(failed.question).toContain("unified commit failed")
      const off = await afterSession(dir, { commit: false }, { id: "T-001", title: "示例" }, { stage: "execute", subject: "T-001 执行" })
      expect(off).toEqual({ type: "ok" })
      const none = await afterSession(undefined, {}, { id: "T-001", title: "示例" }, { stage: "execute", subject: "T-001 执行" })
      expect(none).toEqual({ type: "ok" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ---- rollbackUnitState(单元回滚编排)----

describe("rollbackUnitState(单元回滚编排)", () => {
  test("回滚成功即在途测试交接记录一并作废(.auto/handover.json 删除)", async () => {
    const dir = await freshRepo()
    try {
      await writeFile(join(dir, "seed.txt"), "s")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: 基线前提交" })
      const baseline = await unitBaseline(dir)
      await writeFile(join(dir, "wip.txt"), "半截工作")
      // 在途记录: 定版后收尾途中(带待跑脚本与定版锚点)。
      await saveHandover(dir, {
        task: "T-001",
        scope: "docs/T-001/testhandoff.md",
        unit: "execute",
        n: 1,
        script: join(dir, "test", "t.sh"),
        pinSession: "ses_pin",
      })
      const done = await rollbackUnitState(dir, task, "执行会话", baseline!)
      expect(done.type).toBe("ok")
      // 记录指向的定版提交与锚点属被收回的单元,不删会让重做被恢复状态机接回
      // 「继续被丢弃的交接」。
      expect(await recallHandover(dir, "T-001", "docs/T-001/testhandoff.md")).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("resumeModelNow (strict-resume model check)", () => {
  const switches = parseSwitches({ [SWITCH_ENV.model]: "implement-scan=kimi/scan,*=kimi/k2" })
  const step = { kind: "step" as const, step: "phase-plan" as const, unit: "R-01.P01" }
  // sticky / /failback overrides precede the routing table (src/failback.ts module state).
  beforeEach(() => {
    clearSticky()
    resetFailback()
  })

  test("an explicit role wins over the phase, as it does at dispatch (plans/0053 D12)", () => {
    expect(resumeModelNow({}, switches, step)).toBe("kimi/k2")
    expect(resumeModelNow({}, switches, step, "implement-scan")).toBe("kimi/scan")
  })

  // Under a registry (plans/0055 §6.2) the comparison runs on internal names:
  // the record holds the dispatched entry's internal name, and the check
  // returns the selection's pick for the same routing — the marks and windows
  // apply, the env-switch chain does not.
  test("under a registry: the pick's internal name, down marks and windows applying", () => {
    const entry = (name: string, fields: Partial<import("../src/models").ModelEntry> = {}): import("../src/models").ModelEntry => ({
      name,
      layer: "operator",
      agent: "opencode",
      ...fields,
    })
    const registry: import("../src/models").ModelRegistry = {
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
    }
    const opts: import("../src/opts").Opts = { routing }
    // A deep planning step picks the deep list's first entry.
    expect(resumeModelNow(opts, parseSwitches({}), step)).toBe("a")
    // The primary marked down: the record's "a" would mismatch the pick.
    markModelDown("a")
    expect(resumeModelNow(opts, parseSwitches({}), step)).toBe("b")
  })

  // §10 item 11 (plans/0055): under a registry the strict check compares the
  // recorded internal name and agent with eligibility replacing equality — a
  // window change that only moves the fresh pick does not roll a unit back,
  // while a model that is down or outside its windows is a dead session.
  describe("resumeModelEligible / deadSessionWhy (plans/0055 §8.3, §10 item 11)", () => {
    const entry = (name: string, fields: Partial<import("../src/models").ModelEntry> = {}): import("../src/models").ModelEntry => ({
      name,
      layer: "operator",
      agent: "opencode",
      ...fields,
    })
    // Friday 2026-09-25 12:00 UTC.
    const NOW = Date.parse("2026-09-25T12:00:00Z")
    const registryOf = (models: import("../src/models").ModelEntry[]): import("../src/models").ModelRegistry => ({
      layers: [{ name: "operator", path: "/unused/models.json" }],
      tz: "UTC",
      agents: new Map([["opencode", { name: "opencode", layer: "operator", adapter: "opencode" }]]),
      models: new Map(models.map((item) => [item.name, item])),
      tiers: { deep: { tier: "deep", names: models.map((item) => item.name), layer: "operator" }, simple: { tier: "simple", names: [], layer: "operator" } },
      routes: new Map(),
      unused: [],
    })
    const factsOf = (
      models: import("../src/models").ModelEntry[],
      clock: () => number = () => NOW,
    ): import("../src/routing").RoutingFacts => ({
      registry: registryOf(models),
      agentFilter: "opencode",
      filterSource: undefined,
      defaultAgent: "opencode",
      runAgent: "opencode",
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
      const opts: import("../src/opts").Opts = { routing: factsOf(models, () => now) }
      expect(resumeModelNow(opts, bare, step)).toBe("a")
      now = Date.parse("2026-09-25T19:00:00Z")
      expect(resumeModelNow(opts, bare, step)).toBe("x")
      expect(resumeModelEligible(opts, bare, "a", step)).toBe(true)
    })

    test("not eligible: marked down, outside its windows, or gone from the registry", async () => {
      const { parseWindow } = await import("../src/model-window")
      const parsed = parseWindow("18:00-24:00")
      if ("error" in parsed) throw new Error(parsed.error)
      const models = [entry("a", { model: "prov/a", only: [parsed.window] }), entry("b", { model: "prov/b" })]
      const opts: import("../src/opts").Opts = { routing: factsOf(models) }
      // Outside its only window at 12:00.
      expect(resumeModelEligible(opts, bare, "a", step)).toBe(false)
      expect(deadSessionWhy(opts, bare, { model: "a", phase: step })).toContain("not usable now")
      // Marked down.
      markModelDown("b")
      expect(resumeModelEligible(opts, bare, "b", step)).toBe(false)
      // Gone from the registry (a stale record of a removed entry).
      expect(resumeModelEligible(opts, bare, "gone", step)).toBe(false)
      expect(deadSessionWhy(opts, bare, { model: "gone", phase: step })).toContain("not usable now")
    })

    test("an agent other than the run's is a dead session; absent = the default agent's", () => {
      const models = [entry("a", { model: "prov/a" })]
      const opts: import("../src/opts").Opts = { routing: factsOf(models) }
      expect(recordedAgentOk("opencode", undefined)).toBe(true)
      expect(recordedAgentOk("opencode", "opencode")).toBe(true)
      expect(recordedAgentOk("opencode", "claude-b")).toBe(false)
      expect(recordedAgentOk(undefined, "claude-b")).toBe(true)
      expect(deadSessionWhy(opts, bare, { agent: "claude-b", phase: step })).toContain("lives on agent claude-b")
      expect(deadSessionWhy(opts, bare, { agent: "opencode", phase: step })).toBeUndefined()
      // Without a registry there is no verdict at all.
      expect(deadSessionWhy({}, bare, { agent: "claude-b", model: "whatever", phase: step })).toBeUndefined()
      // A record naming no model has nothing to judge: only the agent half.
      expect(deadSessionWhy(opts, bare, { phase: step })).toBeUndefined()
    })
  })
})
