// The legacy loop stops at the phase boundary. Executor distill and transfer
// handle the handover and transition.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { completePhase, establishRound, readPhases } from "../src/phases"
import { appendOneTask, artifactTurns, loopFixture, phaseHandover, type LoopFixture } from "./fixtures/loop"
import type { FakeAgentOptions, TurnScript } from "./fixtures/agent"
import { EOF_MARK } from "../src/doccheck"
import { CONFIG_FILE } from "../src/config"
import { openExecutorCoordinator } from "../src/executor-coordinator"
import { transferDeterministic } from "../src/transfer"
import { captureRun } from "./fixtures/capture"
import { saveProgress } from "../src/resume"

const made: LoopFixture[] = []
afterEach(() => {
  for (const fixture of made.splice(0)) rmSync(fixture.dir, { recursive: true, force: true })
})

async function fixture(phases: string, agentOptions: FakeAgentOptions | ((dir: string) => FakeAgentOptions) = {}): Promise<LoopFixture> {
  const f = await loopFixture(phases, agentOptions)
  made.push(f)
  await establishRound(f.dir, { phases, round: 1 })
  await f.commit("round setup")
  return f
}

const has = (f: LoopFixture, path: string) => existsSync(join(f.dir, path))

// The knowledge-extraction turn: the session's prompt names the phase's kb.md
// (and the round report when the knowledge phase is the round's last) — write
// both, then take the default turn.
const knowledgeTurn = (dir: string): TurnScript => (ctx) => {
  const kb = /(docs\/R-\d+\/P\d+-knowledge\/kb\.md)/.exec(ctx.text)?.[1]
  if (kb) {
    mkdirSync(join(dir, kb.slice(0, kb.lastIndexOf("/"))), { recursive: true })
    writeFileSync(join(dir, kb), ["# Knowledge", "", "The distilled map.", "", EOF_MARK, ""].join("\n"))
    const report = /docs\/(R-\d+\/report-for-user\.md)/.exec(ctx.text)?.[1]
    if (report) writeFileSync(join(dir, "docs", report), ["# Round report", "", "The round's account for the person.", "", EOF_MARK, ""].join("\n"))
  }
  return undefined
}

test("the phase loop preserves a retired append record and its partial task", async () => {
  const f = await fixture("m")
  const phase = await f.phase(0)
  await Bun.write(join(f.dir, phase.dir, "tasks.md"), "# Tasks\n")
  const task = appendOneTask(f.dir, phase.dir)
  const record = Bun.file(join(f.dir, ".auto/progress.json"))
  const todo = Bun.file(join(f.dir, "docs", task, "todo.md"))
  await saveProgress(f.dir, { task: "PLAN", session: "interrupted", at: 1, active: true, phase: { kind: "step", step: "phase-append", unit: "R-01.P01" } })
  const before = await record.text()
  const partial = await todo.text()

  const stopped = await f.run()
  expect(stopped.code).toBe(2)
  expect(stopped.lines.join("\n")).toContain("the task appending step of R-01.P01 was interrupted and the session is retired")
  expect(await record.text()).toBe(before)
  expect(await todo.text()).toBe(partial)
})

describe("run's boundary stop (plans/0101 D1)", () => {
  test("the run ends at the phase's clean end, exit 0, naming transfer — no distillation, no close, no next formulation", async () => {
    const f = await fixture("mt")
    const stopped = await f.run()
    expect(stopped.code).toBe(0)
    expect(stopped.lines.some((line) => line.includes("✓ phase boundary: P01-implement Implementation complete at a clean phase end"))).toBe(true)
    expect(stopped.lines.some((line) => line.includes("next: opencode-auto transfer"))).toBe(true)
    // The stop precedes the handover (D1): the distillation never ran, the
    // phase unit stays open, the next phase was never planned.
    expect(has(f, "docs/R-01/P01-implement/handover.md")).toBe(false)
    expect(has(f, "docs/R-01/P01-implement/todo.md")).toBe(true)
    expect(has(f, "docs/R-01/P02-test/tasks.md")).toBe(false)
    expect((await f.git("status", "--porcelain")).trim()).toBe("")
  })

  test("flow stops at the boundary without a handover session or next phase planning", async () => {
    const f = await fixture("mt")
    const stopped = await f.run({ boundary: "flow" })
    expect(stopped.code).toBe(0)
    expect(stopped.lines.some((line) => line.includes('an executor "distill" grant'))).toBe(true)
    expect(has(f, "docs/R-01/P01-implement/handover.md")).toBe(false)
    expect(has(f, "docs/R-01/P01-implement/done.md")).toBe(false)
    expect(has(f, "docs/R-01/P02-test/tasks.md")).toBe(false)
    expect(f.agent.prompts.some(({ text }) => text.includes("You are the handover distiller"))).toBe(false)
  })

  test("a plain run on a closed round points at transfer's close (today's complete lines kept)", async () => {
    const f = await fixture("mt")
    for (const phase of (await readPhases(f.dir, 1))!.phases) expect(await completePhase(f.dir, phase, [])).toEqual([])
    await f.commit("phases complete")
    const again = await f.run()
    expect(again.code).toBe(0)
    expect(again.lines.some((line) => line.includes("✓ all phases complete"))).toBe(true)
    expect(again.lines.some((line) => line.includes("next: the round is complete — close it with: opencode-auto transfer"))).toBe(true)
  })

  test("m mode's complete route points at plan's next round, never transfer (transfer refuses m mode)", async () => {
    const f = await fixture("m")
    // m mode's single phase never completes through the flow (no handover);
    // seeded done, the route a hand-finished round meets — the same
    // boundaryHolds shape, branched to plan's pointer.
    const state = (await readPhases(f.dir, 1))!
    expect(await completePhase(f.dir, state.phases[0]!, [])).toEqual([])
    await f.commit("phase complete")
    const again = await f.run()
    expect(again.code).toBe(0)
    expect(again.lines.some((line) => line.includes("✓ all phases complete"))).toBe(true)
    expect(again.lines.some((line) => line.includes(`next: fill in ## Close of docs/R-01/round.md, commit, then run opencode-auto plan ${f.dir} to open round R-02`))).toBe(true)
    expect(again.lines.some((line) => line.includes("close it with: opencode-auto transfer"))).toBe(false)
  })

  test("a knowledge phase's boundary: no session runs (the knowledge extraction retired, plans/0283); the route goes straight to the boundary stop, the distillation transfer's", async () => {
    const f = await fixture("mtk", (dir) => ({ turn: (ctx) => knowledgeTurn(dir)(ctx) ?? artifactTurns(dir)(ctx) }))
    // Seed the round at its knowledge phase: the earlier phases complete
    // (their units done, the index ticked) — the k phase is current, its
    // index empty, so the run's route is the knowledge branch.
    const state = (await readPhases(f.dir, 1))!
    for (const unit of state.phases.slice(0, 2)) expect(await completePhase(f.dir, unit, [])).toEqual([])
    await f.commit("earlier phases complete")
    const stopped = await f.run()
    // The knowledge extraction is retired (plans/0283, confirming 0277's
    // residual): a task-less phase runs no session — the knowledge-capable
    // turn script above never fires, no kb.md is produced, and the run
    // stops at the phase's boundary ahead of the k phase's handover
    // distillation with its own banner naming the retirement.
    expect(stopped.code).toBe(0)
    expect(stopped.lines.some((line) => line.includes("P03-knowledge Knowledge distillation phase: no session (the knowledge extraction retired, plans/0283)"))).toBe(true)
    expect(has(f, "docs/R-01/P03-knowledge/kb.md")).toBe(false)
    expect(has(f, "docs/R-01/report-for-user.md")).toBe(false)
    expect(has(f, "docs/R-01/P03-knowledge/handover.md")).toBe(false)
    expect(has(f, "docs/R-01/P03-knowledge/todo.md")).toBe(true)
    expect(stopped.lines.some((line) => line.includes("✓ phase boundary: P03-knowledge Knowledge distillation complete"))).toBe(true)
    expect(stopped.lines.some((line) => line.includes("closes the phase and the round"))).toBe(true)

    await Bun.write(join(f.dir, CONFIG_FILE), JSON.stringify({ phases: "mtk", subtask: "off" }))
    await f.commit("executor configuration")
    const waiting = await captureRun(() => transferDeterministic(f.dir, { phases: "mtk" }))
    expect(waiting.code).toBe(2)
    expect(waiting.lines.join("\n")).toContain('claim with kind "distill"')
    expect(has(f, "docs/R-01/P03-knowledge/tasks.md")).toBe(false)
    const coordinator = await openExecutorCoordinator(f.dir)
    try {
      const holder = { token: "distiller", channel: "solo" }
      const grant = await coordinator.claim(holder)
      if (grant.kind !== "distill") throw new Error(JSON.stringify(grant))
      expect(grant.unit).toBe("R-01.P03")
      await Bun.write(join(f.dir, grant.handover), phaseHandover("docs/R-01/P03-knowledge"))
      expect(await coordinator.report(holder, grant.id, grant.lease, "ended")).toMatchObject({ kind: "landed" })
    } finally {
      await coordinator.close()
    }
    const advanced = await captureRun(() => transferDeterministic(f.dir, { phases: "mtk" }))
    expect(advanced.lines.join("\n")).toContain("close listing")
    expect(has(f, "docs/R-01/P03-knowledge/done.md")).toBe(true)
  })
})
