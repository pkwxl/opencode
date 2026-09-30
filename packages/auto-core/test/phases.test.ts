import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { roundDir } from "../src/docpaths"
import { validHandover } from "../src/document/roles"
import { loadPlan, renderTaskIndex, renderTaskTodo } from "../src/tasks"
import {
  completePhase,
  currentPhase,
  currentRound,
  doneTypes,
  establishRound,
  formatPhases,
  legacyLayoutProblem,
  nextRound,
  roundEstablishing,
  parsePhases,
  phaseAcceptanceDoc,
  phaseArtifacts,
  phaseHandoverDoc,
  phaseIndexPath,
  phaseLabel,
  plannedPhaseUnits,
  prevRoundDigest,
  readPhases,
  renderPhaseTodo,
  routePhase,
  syncPhaseIndex,
} from "../src/phases"

describe("parsePhases", () => {
  const letters = (raw: string) => parsePhases(raw)?.map((entry) => entry.letter)
  const types = (raw: string, dir?: string) => parsePhases(raw, dir)?.map((entry) => entry.type)

  test("a subsequence of admtvk containing m → returned in the given order", () => {
    expect(letters("m")).toEqual(["m"])
    expect(letters("amt")).toEqual(["a", "m", "t"])
    expect(letters("admtvk")).toEqual(["a", "d", "m", "t", "v", "k"])
    expect(letters("dmvk")).toEqual(["d", "m", "v", "k"])
  })

  test("type-id list (M3.6): any order, repeats allowed, spaces trimmed, must contain implement", () => {
    expect(types("implement")).toEqual(["implement"])
    expect(types("test,implement,test")).toEqual(["test", "implement", "test"])
    expect(types(" analysis , implement ")).toEqual(["analysis", "implement"])
    for (const raw of ["analysis,design", "implement,,test", "implement,nope", "implement,a"]) expect(parsePhases(raw)).toBeNull()
  })

  test(
    "type-id list resolves the project's custom types from dir",
    withDir(async (dir) => {
      expect(parsePhases("security-review,implement", dir)).toBeNull()
      mkdirSync(join(dir, ".opencode/auto/phases"), { recursive: true })
      writeFileSync(join(dir, ".opencode/auto/phases/security-review.md"), "# Security review\n\n## plan duties\n\nList the review tasks.\n")
      expect(types("security-review,implement", dir)).toEqual(["security-review", "implement"])
      expect(parsePhases("security-review,implement", dir)![0]!.origin).toBe("project")
    }),
  )

  test("invalid values → null (out of order / missing m / out-of-range letters / repeats / empty string)", () => {
    for (const raw of ["", "tma", "adk", "mm", "ama", "mx", "M", "amtkv ", "admtvkx"]) {
      expect(parsePhases(raw)).toBeNull()
    }
  })
})

function tempDir() {
  return mkdtempSync(join(tmpdir(), "auto-phases-"))
}

function withDir(fn: (dir: string) => Promise<void>) {
  return async () => {
    const dir = tempDir()
    try {
      await fn(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

const read = (dir: string, rel: string) => Bun.file(join(dir, rel)).text()
const exists = (dir: string, rel: string) => Bun.file(join(dir, rel)).exists()

describe("phase index (M3.3): syncPhaseIndex / readPhases / completePhase", () => {
  test(
    "syncPhaseIndex writes phases.md plus one P<nn>-<type>/todo.md per preset letter; readPhases round-trips",
    withDir(async (dir) => {
      const units = await syncPhaseIndex(dir, 1, "amt")
      expect(units.map(phaseLabel)).toEqual(["P01-analysis", "P02-implement", "P03-test"])
      expect(units.map((unit) => unit.entry.letter)).toEqual(["a", "m", "t"])
      expect(units[1]!.dir).toBe("docs/R-01/P02-implement")
      const index = await read(dir, "docs/R-01/phases.md")
      expect(index).toContain("# Phases (R-01)")
      expect(index).toContain("- [ ] P01 analysis\n- [ ] P02 implement\n- [ ] P03 test\n")
      const todo = await read(dir, "docs/R-01/P01-analysis/todo.md")
      expect(todo).toBe(renderPhaseTodo(units[0]!))
      expect(todo.startsWith("# R-01.P01: Analysis\n\nType: analysis\n")).toBe(true)
      expect(todo.trimEnd().endsWith("<!-- auto: eof -->")).toBe(true)
      const state = (await readPhases(dir))!
      expect(state.round).toBe(1)
      expect(state.index).toBe(phaseIndexPath(1))
      expect(state.phases).toEqual(units)
      expect([...state.done]).toEqual([])
    }),
  )

  test(
    "custom and repeated types (M3.6): one directory per phase, readPhases resolves the project type",
    withDir(async (dir) => {
      mkdirSync(join(dir, ".opencode/auto/phases"), { recursive: true })
      writeFileSync(join(dir, ".opencode/auto/phases/review.md"), "# Review\n\nGate: verdict\n\n## plan duties\n\nPlan the review.\n")
      const units = await syncPhaseIndex(dir, 1, "review,implement,review")
      expect(units.map(phaseLabel)).toEqual(["P01-review", "P02-implement", "P03-review"])
      expect(await read(dir, "docs/R-01/P03-review/todo.md")).toContain("# R-01.P03: Review\n")
      const state = (await readPhases(dir))!
      expect(state.phases.map((unit) => [unit.id, unit.entry.origin, unit.entry.gates])).toEqual([
        ["P01", "project", ["verdict"]],
        ["P02", "builtin", []],
        ["P03", "project", ["verdict"]],
      ])
      await completePhase(dir, units[0]!)
      expect(doneTypes((await readPhases(dir))!)).toEqual(["review"])
      // The type file gone → the index names an unknown type and reads as invalid
      rmSync(join(dir, ".opencode/auto/phases/review.md"))
      await expect(readPhases(dir)).rejects.toThrow(/unknown phase type "review"/)
    }),
  )

  test(
    "phase Depends (M3.5): read from todo.md, reorders currentPhase, bad graphs make the index invalid",
    withDir(async (dir) => {
      const units = await syncPhaseIndex(dir, 1, "amt")
      const todo = join(dir, "docs/R-01/P01-analysis/todo.md")
      const original = await read(dir, "docs/R-01/P01-analysis/todo.md")
      writeFileSync(todo, original.replace("Type: analysis\n", "Type: analysis\nDepends: P03\n"))
      writeFileSync(join(dir, "docs/R-01/P03-test/todo.md"), renderPhaseTodo(units[2]!).replace("Type: test\n", "Type: test\nDepends: none\n"))
      const state = (await readPhases(dir))!
      expect(state.phases[0]!.depends).toEqual(["P03"])
      expect(currentPhase(state)!.id).toBe("P03")
      writeFileSync(todo, original.replace("Type: analysis\n", "Type: analysis\nDepends: P09\n"))
      await expect(readPhases(dir)).rejects.toThrow("P01 depends on unknown P09")
    }),
  )

  test(
    "no index → undefined (round never established)",
    withDir(async (dir) => {
      expect(await readPhases(dir)).toBeUndefined()
      mkdirSync(join(dir, "docs/R-01"), { recursive: true })
      expect(await readPhases(dir)).toBeUndefined()
    }),
  )

  test(
    "re-sync with the same preset is a no-op; a changed tail replaces pending phases that hold only todo.md",
    withDir(async (dir) => {
      await syncPhaseIndex(dir, 1, "amt")
      writeFileSync(join(dir, "docs/R-01/P01-analysis/findings.md"), "work\n")
      await syncPhaseIndex(dir, 1, "amt")
      expect(await read(dir, "docs/R-01/P01-analysis/findings.md")).toBe("work\n")
      await syncPhaseIndex(dir, 1, "amvk")
      expect((await readPhases(dir))!.phases.map(phaseLabel)).toEqual(["P01-analysis", "P02-implement", "P03-acceptance", "P04-knowledge"])
      expect(await exists(dir, "docs/R-01/P03-test/todo.md")).toBe(false)
      expect(await exists(dir, "docs/R-01/P04-knowledge/todo.md")).toBe(true)
      expect(await read(dir, "docs/R-01/P01-analysis/findings.md")).toBe("work\n")
    }),
  )

  test(
    "re-sync refuses to drop a completed phase or a phase directory that holds work, before touching any file",
    withDir(async (dir) => {
      const units = await syncPhaseIndex(dir, 1, "amt")
      await completePhase(dir, units[0]!)
      await expect(syncPhaseIndex(dir, 1, "mt")).rejects.toThrow(/completed phase docs\/R-01\/P01-analysis/)
      writeFileSync(join(dir, "docs/R-01/P03-test/notes.md"), "draft\n")
      await expect(syncPhaseIndex(dir, 1, "am")).rejects.toThrow(/already holds work \(notes\.md\)/)
      expect((await readPhases(dir))!.phases.map(phaseLabel)).toEqual(["P01-analysis", "P02-implement", "P03-test"])
    }),
  )

  test(
    "plannedPhaseUnits (plans/0052 D7): the units a sync would leave and the sync's refusals, without writing",
    withDir(async (dir) => {
      expect((await plannedPhaseUnits(dir, 1, "am")).map(phaseLabel)).toEqual(["P01-analysis", "P02-implement"])
      expect(existsSync(join(dir, "docs/R-01"))).toBe(false)
      const units = await syncPhaseIndex(dir, 1, "amt")
      expect((await plannedPhaseUnits(dir, 1, "amvk")).map(phaseLabel)).toEqual(["P01-analysis", "P02-implement", "P03-acceptance", "P04-knowledge"])
      expect(await plannedPhaseUnits(dir, 1, "amt")).toEqual(units)
      await completePhase(dir, units[0]!)
      await expect(plannedPhaseUnits(dir, 1, "mt")).rejects.toThrow(/completed phase docs\/R-01\/P01-analysis/)
      writeFileSync(join(dir, "docs/R-01/P03-test/notes.md"), "draft\n")
      await expect(plannedPhaseUnits(dir, 1, "am")).rejects.toThrow(/already holds work \(notes\.md\)/)
      expect((await readPhases(dir))!.phases.map(phaseLabel)).toEqual(["P01-analysis", "P02-implement", "P03-test"])
      expect(existsSync(join(dir, "docs/R-01/P04-knowledge"))).toBe(false)
    }),
  )

  test(
    "completePhase renames todo.md → done.md and ticks the index line; idempotent",
    withDir(async (dir) => {
      const units = await syncPhaseIndex(dir, 1, "amt")
      await completePhase(dir, units[1]!)
      await completePhase(dir, units[1]!)
      expect(await exists(dir, "docs/R-01/P02-implement/todo.md")).toBe(false)
      expect(await exists(dir, "docs/R-01/P02-implement/done.md")).toBe(true)
      expect(await read(dir, "docs/R-01/phases.md")).toContain("- [ ] P01 analysis\n- [x] P02 implement\n- [ ] P03 test\n")
      const state = (await readPhases(dir))!
      expect([...state.done]).toEqual(["P02"])
      expect(doneTypes(state)).toEqual(["implement"])
    }),
  )

  test(
    "files win over ticks: a ticked line without done.md is still pending",
    withDir(async (dir) => {
      await syncPhaseIndex(dir, 1, "am")
      writeFileSync(join(dir, "docs/R-01/phases.md"), (await read(dir, "docs/R-01/phases.md")).replace("- [ ] P01", "- [x] P01"))
      expect([...(await readPhases(dir))!.done]).toEqual([])
    }),
  )

  test(
    "invalid index → throw with fix-it guidance: bad line, unknown type, both / neither state files",
    withDir(async (dir) => {
      await syncPhaseIndex(dir, 1, "am")
      const index = join(dir, "docs/R-01/phases.md")
      const good = await read(dir, "docs/R-01/phases.md")
      for (const [bad, pattern] of [
        [good + "- [ ] X9 analysis\n", /"X9" is not a phase id/],
        [good + "- [ ] P03 review\n", /unknown phase type "review"/],
        ["# Phases\n", /no phases listed/],
      ] as const) {
        writeFileSync(index, bad)
        await expect(readPhases(dir)).rejects.toThrow(pattern)
      }
      writeFileSync(index, good)
      writeFileSync(join(dir, "docs/R-01/P01-analysis/done.md"), "x\n")
      await expect(readPhases(dir)).rejects.toThrow(/docs\/R-01\/P01-analysis\/ has both todo\.md and done\.md/)
      rmSync(join(dir, "docs/R-01/P01-analysis"), { recursive: true })
      await expect(readPhases(dir)).rejects.toThrow(/P01-analysis\/ has neither/)
      await expect(readPhases(dir)).rejects.toThrow(/docs\/R-01\/phases\.md/)
    }),
  )
})

describe("routePhase (phase routing, D.2)", () => {
  // The current phase's task index with one task T-001 in the given state.
  async function seedTask(dir: string, unit: { dir: string; round: string; id: string }, done: boolean) {
    writeFileSync(join(dir, unit.dir, "tasks.md"), renderTaskIndex(`${unit.round}.${unit.id}`, [{ id: "T-001", title: "task", done }]))
    mkdirSync(join(dir, "docs/T-001"), { recursive: true })
    rmSync(join(dir, "docs/T-001", done ? "todo.md" : "done.md"), { force: true })
    writeFileSync(join(dir, "docs/T-001", done ? "done.md" : "todo.md"), renderTaskTodo({ id: "T-001", title: "task" }))
  }
  // The driver-side inputs routePhase takes since 0061 E3: the task-index read
  // (tasks.ts's loadPlan) and the bin name (the shell profile's).
  const deps = { loadPlan, bin: "opencode-auto" }
  const route = async (dir: string) => {
    const r = await routePhase(dir, deps)
    return r.type === "plan" || r.type === "execute" || r.type === "handover" ? { type: r.type, phase: r.phase, tasks: r.plan.tasks.length } : r
  }

  test(
    "no task index → plan; a task not done → execute; all done → handover (the route carries the loaded plan)",
    withDir(async (dir) => {
      const [first] = await syncPhaseIndex(dir, 1, "amt")
      expect(await route(dir)).toEqual({ type: "plan", phase: first!, tasks: 0 })
      await seedTask(dir, first!, false)
      expect(await route(dir)).toEqual({ type: "execute", phase: first!, tasks: 1 })
      await seedTask(dir, first!, true)
      expect(await route(dir)).toEqual({ type: "handover", phase: first!, tasks: 1 })
    }),
  )

  test(
    "derived from done.md: completed phases advance the current phase; all done → complete",
    withDir(async (dir) => {
      const units = await syncPhaseIndex(dir, 1, "amt")
      await completePhase(dir, units[0]!)
      await completePhase(dir, units[1]!)
      expect(await route(dir)).toEqual({ type: "plan", phase: units[2]!, tasks: 0 })
      await seedTask(dir, units[2]!, false)
      expect(await route(dir)).toEqual({ type: "execute", phase: units[2]!, tasks: 1 })
      await completePhase(dir, units[2]!)
      expect(await routePhase(dir, deps)).toEqual({ type: "complete" })
    }),
  )

  test(
    "missing or invalid phase or task index → blocked (environment error with guidance)",
    withDir(async (dir) => {
      const missing = await routePhase(dir, deps)
      expect(missing).toEqual({ type: "blocked", reason: expect.stringContaining("phase index docs/R-01/phases.md is missing") })
      const [first] = await syncPhaseIndex(dir, 1, "am")
      writeFileSync(join(dir, first!.dir, "tasks.md"), "- [ ] T-001 lost\n")
      const lost = await routePhase(dir, deps)
      expect(lost).toEqual({ type: "blocked", reason: expect.stringContaining("docs/T-001/ has neither todo.md nor done.md") })
      writeFileSync(join(dir, "docs/R-01/phases.md"), "- [ ] P01 nonsense\n")
      const broken = await routePhase(dir, deps)
      expect(broken.type).toBe("blocked")
      if (broken.type === "blocked") expect(broken.reason).toContain("docs/R-01/phases.md")
    }),
  )
})

describe("formatPhases / currentPhase (the phase progress line)", () => {
  test(
    "✓ = done.md, ▶ = current, others pending",
    withDir(async (dir) => {
      const units = await syncPhaseIndex(dir, 1, "amt")
      expect(formatPhases((await readPhases(dir))!)).toBe("P01-analysis▶ P02-implement P03-test")
      await completePhase(dir, units[0]!)
      const state = (await readPhases(dir))!
      expect(formatPhases(state)).toBe("P01-analysis✓ P02-implement▶ P03-test")
      expect(currentPhase(state)).toEqual(units[1]!)
      await completePhase(dir, units[1]!)
      await completePhase(dir, units[2]!)
      const done = (await readPhases(dir))!
      expect(formatPhases(done)).toBe("P01-analysis✓ P02-implement✓ P03-test✓")
      expect(currentPhase(done)).toBeUndefined()
      expect(done.closed.size).toBe(0)
    }),
  )

  test(
    "⊘ = closed (done.md field block carries Closed:), replacing ✓; still done for scheduling",
    withDir(async (dir) => {
      const units = await syncPhaseIndex(dir, 1, "amt")
      const analysis = units[0]!
      rmSync(join(dir, analysis.dir, "todo.md"))
      const closedDoc = renderPhaseTodo(analysis).replace("Type: analysis\n", "Type: analysis\nClosed: out of scope\n")
      writeFileSync(join(dir, analysis.dir, "done.md"), closedDoc)
      const state = (await readPhases(dir))!
      expect(state.closed).toEqual(new Map([["P01", "out of scope"]]))
      expect(state.done.has("P01")).toBe(true)
      expect(formatPhases(state)).toBe("P01-analysis⊘ P02-implement▶ P03-test")
      expect(currentPhase(state)).toEqual(units[1]!)
    }),
  )
})

describe("phase directory paths", () => {
  test(
    "handover / acceptance / standard artifacts live in the phase directory",
    withDir(async (dir) => {
      const units = await syncPhaseIndex(dir, 2, "admtvk")
      const byType = (type: string) => units.find((unit) => unit.type === type)!
      expect(phaseHandoverDoc(byType("design"))).toBe("docs/R-02/P02-design/handover.md")
      expect(phaseAcceptanceDoc(byType("acceptance"))).toBe("docs/R-02/P05-acceptance/acceptance.md")
      expect(phaseArtifacts(byType("knowledge")).map((spec) => spec.path)).toEqual(["docs/R-02/P06-knowledge/kb.md"])
      expect(phaseArtifacts(byType("design")).map((spec) => spec.path)).toEqual(["docs/R-02/P02-design/design.md", "docs/R-02/P02-design/decisions.md"])
      expect(phaseArtifacts(byType("implement"))).toEqual([])
    }),
  )
})

describe("validHandover (validates the handover-distillation session's artifact; the deciding basis for the blocked handover-distillation path)", () => {
  const HANDOVER = [
    "# a Analysis phase handover",
    "",
    "## Key decisions",
    "- Decision A",
    "",
    "## Constraints and pitfalls",
    "- Pitfall B",
    "",
    "## Required reading for the next phase",
    "- docs/analysis/baseline.md: behavior baseline",
    "",
    "## Artifact index",
    "- docs/analysis/: analysis artifacts",
  ].join("\n")

  test("all four sections present (heading lines matched verbatim, leading whitespace tolerated) → valid", () => {
    expect(validHandover(HANDOVER)).toBe(true)
    expect(validHandover(HANDOVER.replace("## Key decisions", "   ## Key decisions"))).toBe(true)
  })

  test("any section missing / a heading reworded / an empty document → invalid (a missing distillation artifact takes the implicit blocked path)", () => {
    for (const bad of [
      HANDOVER.replace("## Constraints and pitfalls", "## Constraints and traps"),
      HANDOVER.replace("## Artifact index\n- docs/analysis/: analysis artifacts", ""),
      "",
    ]) {
      expect(validHandover(bad)).toBe(false)
    }
    // a subheading does not count: "### Key decisions" contains the protocol substring but is not a verbatim ## heading line
    expect(validHandover(HANDOVER.replace(/^## /gm, "### "))).toBe(false)
  })
})

describe("rounds (M section + the per-round directory scheme): currentRound / nextRound / establishRound / prevRoundDigest", () => {
  async function exists(path: string) {
    return await Bun.file(path).exists()
  }

  test("currentRound: fresh = 1; the highest R-* directory number (no +1); old docs/phases/round-<N> does not count (M3.7)", async () => {
    const dir = tempDir()
    try {
      expect(await currentRound(dir)).toBe(1)
      mkdirSync(join(dir, "docs/phases/round-3"), { recursive: true })
      expect(await currentRound(dir)).toBe(1)
      mkdirSync(join(dir, "docs/R-04"), { recursive: true })
      expect(await currentRound(dir)).toBe(4)
      mkdirSync(join(dir, "docs/R-07"), { recursive: true })
      expect(await currentRound(dir)).toBe(7)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("nextRound: current round established (index present) → current + 1; not established or interrupted mid-establishment (directory without index) = the derived current value; the old root ledger does not count as occupied (M3.7, 0049 G6)", async () => {
    const dir = tempDir()
    try {
      expect(await nextRound(dir)).toBe(1)
      mkdirSync(join(dir, "docs"), { recursive: true })
      writeFileSync(join(dir, "docs/phases.md"), "# Phase ledger\n")
      expect(await nextRound(dir)).toBe(1)
      mkdirSync(join(dir, "docs/R-01"), { recursive: true })
      expect(await roundEstablishing(dir, 1)).toBe(true)
      expect(await nextRound(dir)).toBe(1)
      writeFileSync(join(dir, "docs/R-01/phases.md"), "# Phases (R-01)\n")
      expect(await roundEstablishing(dir, 1)).toBe(false)
      expect(await nextRound(dir)).toBe(2)
      mkdirSync(join(dir, "docs/R-06"), { recursive: true })
      expect(await nextRound(dir)).toBe(6)
      writeFileSync(join(dir, "docs/R-06/phases.md"), "# Phases (R-06)\n")
      expect(await nextRound(dir)).toBe(7)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("legacyLayoutProblem: root PLAN.md / an R-NN without phase directories → usage-error wording; the new layout and an empty R-NN (the round-establishment crash window) do not count (M3.7)", async () => {
    const dir = tempDir()
    try {
      expect(await legacyLayoutProblem(dir)).toBeUndefined()
      // an empty round directory: the window where establishRound crashed between ① and ②; resume self-heals
      mkdirSync(join(dir, "docs/R-01"), { recursive: true })
      expect(await legacyLayoutProblem(dir)).toBeUndefined()
      // the new layout: phase directories inside the round directory
      await establishRound(dir, { phases: "amk" })
      expect(await legacyLayoutProblem(dir)).toBeUndefined()
      // an old per-round directory: only flat documents, no P*-<type> phase directories
      mkdirSync(join(dir, "docs/R-02"), { recursive: true })
      writeFileSync(join(dir, "docs/R-02/PLAN.md"), "# plan\n")
      const round = await legacyLayoutProblem(dir)
      expect(round).toStartWith("legacy layout: start a new project")
      expect(round).toContain("docs/R-02/ without phase directories")
      expect(round).not.toContain("R-01")
      // root PLAN.md
      writeFileSync(join(dir, "PLAN.md"), "# plan\n")
      expect(await legacyLayoutProblem(dir)).toContain("found root PLAN.md, docs/R-02/")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("runAll preflight: a legacy layout exits 1 as a usage error before any read or write (entries outside the shell are caught the same)", async () => {
    const { readdirSync } = await import("node:fs")
    const { runAll } = await import("../src/loop")
    const dir = tempDir()
    try {
      writeFileSync(join(dir, "PLAN.md"), "# plan\n")
      expect(await runAll(dir, {})).toBe(1)
      expect(readdirSync(dir)).toEqual(["PLAN.md"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("establishRound: creates the round directory + the phase index and phase directories; writes no PLAN.md (retired M3.4) and no AGENTS.md.bak (retired plans/0054 D1)", async () => {
    const dir = tempDir()
    try {
      writeFileSync(join(dir, "AGENTS.md"), "# AGENTS\n\nWorkflow entry\n")
      const result = await establishRound(dir, { phases: "amt" })
      expect(result).toEqual({ round: 1, root: roundDir(1) })
      // the phase index and phase directories are established with the round
      expect((await readPhases(dir))!.phases.map(phaseLabel)).toEqual(["P01-analysis", "P02-implement", "P03-test"])
      expect(await exists(join(dir, "docs/R-01/P03-test/todo.md"))).toBe(true)
      expect(await exists(join(dir, "PLAN.md"))).toBe(false)
      expect(await exists(join(dir, "docs/R-01/PLAN.md"))).toBe(false)
      // no round-start snapshot of AGENTS.md any more; the root file stays untouched
      expect(await exists(join(dir, "docs/R-01/AGENTS.md.bak"))).toBe(false)
      expect(await Bun.file(join(dir, "AGENTS.md")).text()).toBe("# AGENTS\n\nWorkflow entry\n")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("establishRound no-phase mode: phases = m establishes the implicit single phase R-01/P01-implement (plans/0047 L2)", async () => {
    const dir = tempDir()
    try {
      await establishRound(dir, { phases: "m" })
      expect((await readPhases(dir))!.phases.map(phaseLabel)).toEqual(["P01-implement"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("establishRound idempotent resume: phase completion state and phase directory contents are kept; an explicit round number starts a new round", async () => {
    const dir = tempDir()
    try {
      await establishRound(dir, { phases: "amt" })
      writeFileSync(join(dir, "docs/R-01/P01-analysis/tasks.md"), "- [x] T-001 done task\n")
      await completePhase(dir, (await readPhases(dir))!.phases[0]!)
      // idempotent: re-establishing the current round does not rewrite phase directories; completion state is kept
      const again = await establishRound(dir, { phases: "amt" })
      expect(doneTypes((await readPhases(dir))!)).toEqual(["analysis"])
      expect(again.round).toBe(1)
      expect(await Bun.file(join(dir, "docs/R-01/P01-analysis/tasks.md")).text()).toContain("done task")
      // a new round: explicit round number (nextRound)
      const next = await establishRound(dir, { phases: "am", round: await nextRound(dir) })
      expect(next.round).toBe(2)
      // the new round's phases are all incomplete
      expect(formatPhases((await readPhases(dir))!)).toBe("P01-analysis▶ P02-implement")
      expect(await currentRound(dir)).toBe(2)
      // the previous round's content is unaffected (what is on disk is permanent)
      expect(await Bun.file(join(dir, "docs/R-01/P01-analysis/tasks.md")).text()).toContain("done task")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("prevRoundDigest: previous round's phase directory index + last done phase's handover + knowledge phase kb.md; no previous round / blank round → undefined", async () => {
    const fresh = tempDir()
    try {
      expect(await prevRoundDigest(fresh)).toBeUndefined()
    } finally {
      rmSync(fresh, { recursive: true, force: true })
    }
    const dir = tempDir()
    try {
      // R-01, a completed round: phase index + phase directories (handover/knowledge) + done.md; R-02 established (a new round under way)
      const units = await syncPhaseIndex(dir, 1, "amk")
      writeFileSync(join(dir, "docs/R-01/P01-analysis/handover.md"), "# Analysis phase handover\n\n## Key decisions\n- Decision A\n")
      writeFileSync(join(dir, "docs/R-01/P02-implement/handover.md"), "# Implementation phase handover\n\n## Key decisions\n- Implementation decision B\n")
      writeFileSync(join(dir, "docs/R-01/P03-knowledge/kb.md"), "# Migration knowledge\n\nAPI mapping conclusions.")
      await completePhase(dir, units[0]!)
      await completePhase(dir, units[1]!)
      await syncPhaseIndex(dir, 2, "am")
      const digest = await prevRoundDigest(dir)
      expect(digest).toBeDefined()
      expect(digest).toContain("### Previous round (round 1) phase directory index (docs/R-01/)")
      expect(digest).toContain("- docs/R-01/P01-analysis/")
      expect(digest).toContain("- docs/R-01/P03-knowledge/")
      expect(digest).toContain("### Previous round final handover (docs/R-01/P02-implement/handover.md)")
      expect(digest).toContain("Implementation decision B")
      expect(digest).not.toContain("Decision A") // only the last completed phase's handover is injected
      expect(digest).toContain("### Previous round migration knowledge (docs/R-01/P03-knowledge/kb.md)")
      expect(digest).toContain("API mapping conclusions.")
      // No closures: the index lines are exactly `- <root>/<name>/`
      const index = (lines: string[]) => `(${roundDir(1)}/)\n\n${lines.map((line) => `- ${roundDir(1)}/${line}`).join("\n")}\n\n###`
      expect(digest).toContain(index(["P01-analysis/", "P02-implement/", "P03-knowledge/"]))
      // A closed phase (its done.md field block carries Closed:) gets the reason suffix; the other lines are unchanged
      writeFileSync(
        join(dir, units[0]!.dir, "done.md"),
        renderPhaseTodo(units[0]!).replace("Type: analysis\n", "Type: analysis\nClosed: out of scope\n"),
      )
      const closed = await prevRoundDigest(dir)
      expect(closed).toContain(index(["P01-analysis/ (closed: out of scope)", "P02-implement/", "P03-knowledge/"]))
      expect(closed).toContain("Implementation decision B")
      // Previous round's index unusable: directory index and knowledge as usual, handover dropped (prompt input is lenient)
      writeFileSync(join(dir, "docs/R-01/phases.md"), "garbage\n- [ ] P01 nonsense\n")
      const lenient = await prevRoundDigest(dir)
      expect(lenient).toContain("- docs/R-01/P01-analysis/")
      expect(lenient).not.toContain("(closed:")
      expect(lenient).not.toContain("final handover")
      // a bare round directory (directories only, no content) → undefined
      const bare = tempDir()
      try {
        mkdirSync(join(bare, "docs/R-01"), { recursive: true })
        mkdirSync(join(bare, "docs/R-02"), { recursive: true })
        expect(await prevRoundDigest(bare)).toBeUndefined()
      } finally {
        rmSync(bare, { recursive: true, force: true })
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
