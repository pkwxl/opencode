// --stop-after (plans/0128): the task whose completion ends this run — the
// retry's guardrail in a fork environment. Pinned over the phase loop on the
// native fake agent: the post-unit stop (the target closes, the run ends
// before the remaining tasks and the handover, exit 0, the phase open), the
// already-complete target's immediate stop, the typo guard (a target outside
// the routed phase's index is a usage error, never a silent never-stop), the
// serial-path confinement (the scheduler/doc-lane shapes refuse the
// combination outright), the stop-before-handover discriminator on a phased
// run (the boundary stop's lines stay absent — the run ended earlier), and
// the continuation (a later plain run finishes the phase, the early stop
// leaving nothing broken).
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { establishRound } from "../src/phases"
import { renderTaskIndex } from "../src/tasks"
import { appendOneTask, artifactTurns, loopFixture, taskDoc, type LoopFixture } from "./fixtures/loop"
import type { FakeAgentOptions, TurnScript } from "./fixtures/agent"

const made: LoopFixture[] = []
afterEach(() => {
  for (const fixture of made.splice(0)) rmSync(fixture.dir, { recursive: true, force: true })
})

async function fixture(phases: string, turn?: (dir: string) => TurnScript): Promise<LoopFixture> {
  const f = await loopFixture(phases, (dir): FakeAgentOptions => (turn ? { turn: turn(dir) } : {}))
  made.push(f)
  await establishRound(f.dir, { phases, round: 1 })
  await f.commit("round setup")
  return f
}

// m mode with two pending tasks seeded by hand (no planning runs; the route
// is execute, the serial loop the whole story).
const M_PHASE = "docs/R-01/P01-implement"

async function seedTasks(f: LoopFixture, ids: readonly string[], done: ReadonlySet<string> = new Set()): Promise<void> {
  const phaseDir = join(f.dir, M_PHASE)
  mkdirSync(phaseDir, { recursive: true })
  writeFileSync(
    join(phaseDir, "tasks.md"),
    renderTaskIndex("R-01.P01", ids.map((id) => ({ id, title: `task ${id}`, done: done.has(id) }))),
  )
  for (const id of ids) {
    mkdirSync(join(f.dir, "docs", id), { recursive: true })
    writeFileSync(join(f.dir, "docs", id, done.has(id) ? "done.md" : "todo.md"), taskDoc(id, "R-01.P01"))
  }
  await f.commit("seeded tasks")
}

describe("--stop-after (plans/0128: the run's task stop)", () => {
  test("the target closes and the run ends there — exit 0, the remaining task pending, the phase open, the tree clean", async () => {
    const f = await fixture("m")
    await seedTasks(f, ["T-001", "T-002"])
    const stopped = await f.run({ stopAfter: "T-001" })
    expect(stopped.code).toBe(0)
    expect(stopped.lines).toContain("■ stopped after T-001 task T-001 as requested (--stop-after); the phase's remaining tasks and its handover stay for the next run")
    // T-001 done and committed; T-002 never ran; the m-mode wrap lines stay
    // absent (the run ended at the stop, not at the phase's own end).
    expect(existsSync(join(f.dir, "docs/T-001/done.md"))).toBe(true)
    expect(existsSync(join(f.dir, "docs/T-002/todo.md"))).toBe(true)
    expect(existsSync(join(f.dir, "docs/T-002/done.md"))).toBe(false)
    expect(stopped.lines.some((line) => line.includes("✓ all tasks complete"))).toBe(false)
    expect((await f.git("status", "--porcelain")).trim()).toBe("")
  })

  test("a later plain run finishes the phase — the early stop left nothing broken", async () => {
    const f = await fixture("m")
    await seedTasks(f, ["T-001", "T-002"])
    expect((await f.run({ stopAfter: "T-001" })).code).toBe(0)
    const finished = await f.run()
    expect(finished.code).toBe(0)
    expect(finished.lines.some((line) => line.includes("✓ T-002 done"))).toBe(true)
    expect(finished.lines.some((line) => line.includes("✓ all tasks complete"))).toBe(true)
    expect(existsSync(join(f.dir, "docs/T-002/done.md"))).toBe(true)
  })

  test("an already-complete target stops at once — nothing runs before it", async () => {
    const f = await fixture("m")
    await seedTasks(f, ["T-001", "T-002"], new Set(["T-001"]))
    const stopped = await f.run({ stopAfter: "T-001" })
    expect(stopped.code).toBe(0)
    expect(stopped.lines).toContain("■ T-001 is already complete — nothing runs before the stop target (--stop-after)")
    expect(existsSync(join(f.dir, "docs/T-002/todo.md"))).toBe(true)
    expect(stopped.lines.some((line) => line.includes("T-002") && line.includes("done"))).toBe(false)
  })

  test("a target outside the routed phase's index is a usage error (the typo guard), nothing runs", async () => {
    const f = await fixture("m")
    await seedTasks(f, ["T-001", "T-002"])
    const refused = await f.run({ stopAfter: "T-099" })
    expect(refused.code).toBe(1)
    expect(refused.lines).toContain("⏸ --stop-after T-099: not a task of the routed phase's index — a stop target must name a task this run can complete")
    expect(existsSync(join(f.dir, "docs/T-001/todo.md"))).toBe(true)
  })

  test("the serial-path confinement: --max-sessions 2 (the doc-lane shape at tier 0) refuses the combination outright", async () => {
    const f = await fixture("m")
    await seedTasks(f, ["T-001", "T-002"])
    const refused = await f.run({ stopAfter: "T-001", maxSessions: 2 })
    expect(refused.code).toBe(1)
    expect(refused.lines.some((line) => line.includes("--stop-after is a serial-path option"))).toBe(true)
    expect(existsSync(join(f.dir, "docs/T-001/todo.md"))).toBe(true)
  })

  test("on a phased run the stop lands before the boundary stop's own lines (the run ended a task early, not at the phase's clean end)", async () => {
    const f = await fixture("mt")
    // The planning step runs the formulation task T-001 and appends T-002;
    // the execute loop then runs T-002 — the stop target — and the run ends
    // before the handover route the boundary stop prints at.
    const stopped = await f.run({ stopAfter: "T-002" })
    expect(stopped.code).toBe(0)
    expect(stopped.lines.some((line) => line.includes("■ stopped after T-002 task T-002 as requested (--stop-after)"))).toBe(true)
    expect(stopped.lines.some((line) => line.includes("✓ phase boundary:"))).toBe(false)
    expect(existsSync(join(f.dir, "docs/R-01/P01-implement/handover.md"))).toBe(false)
    expect(existsSync(join(f.dir, "docs/T-002/done.md"))).toBe(true)
    expect((await f.git("status", "--porcelain")).trim()).toBe("")
  })

  test("the report self-heal's appended task is a stop target like any other (the index check reads the live index)", async () => {
    const f = await fixture("m", (dir) => (ctx) => artifactTurns(dir)(ctx))
    // Seed one task; a planning-driven append would complicate the numbering,
    // so the target is the seeded one and the stop is the same post-unit
    // check over the live plan.
    await seedTasks(f, ["T-001"])
    appendOneTask(f.dir, M_PHASE)
    await f.commit("appended task")
    const stopped = await f.run({ stopAfter: "T-001" })
    expect(stopped.code).toBe(0)
    expect(stopped.lines.some((line) => line.includes("■ stopped after T-001 task T-001 as requested (--stop-after)"))).toBe(true)
    expect(existsSync(join(f.dir, "docs/T-002/todo.md"))).toBe(true)
  })
})
