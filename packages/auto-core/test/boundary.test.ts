// run's boundary stop (plans/0101 D1): the run ends at the current phase's
// clean end — before the handover distillation, the phase close, the round
// close and the next formulation, all of which are transfer's (D2) — and
// `--boundary flow` restores today's continuous crossing. Pinned over the
// phase loop on the native fake agent: the stop's lines and exit code, the
// state it leaves (no handover document, the phase unit open), the crossing
// under flow, the knowledge phase's boundary (its extraction is the phase's
// work; the distillation after it is transfer's), and the complete-route
// pointer a plain run meets on a round already closed. The stop lands only
// on the handover route — runTaskLoop returns 0 past the lane landings, so
// the route itself carries D1's clean-end guarantee; the transfer suite
// pins the mid-phase half (the boundary fires once per phase, never between
// a phase's own tasks).
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { completePhase, establishRound, readPhases } from "../src/phases"
import { appendOneTask, artifactTurns, loopFixture, promptPhaseDir, type LoopFixture } from "./fixtures/loop"
import type { FakeAgentOptions, TurnScript } from "./fixtures/agent"
import { EOF_MARK } from "../src/doccheck"

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

// The round-report self-heal's append (plans/0081 D4): the final
// task-bearing phase's completion appends one report task — the fake session
// writes it and the report (survey-gate's turn, extracted).
const reportHealTurn = (dir: string): TurnScript => (ctx) => {
  if (ctx.text.includes("## Input: the task index as it stands") && ctx.text.includes("Round report self-heal")) {
    const phaseDir = promptPhaseDir(ctx.text)
    if (phaseDir) {
      appendOneTask(dir, phaseDir)
      writeFileSync(join(dir, "docs/R-01/report-for-user.md"), ["# Round report", "", "The round's account for the person.", "", EOF_MARK, ""].join("\n"))
    }
  }
  return undefined
}

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

  test("--boundary flow crosses as today: the handover, the next phase's planning and execution, the completed round", async () => {
    const f = await fixture("mt", (dir) => ({ turn: (ctx) => reportHealTurn(dir)(ctx) ?? artifactTurns(dir)(ctx) }))
    const crossed = await f.run({ boundary: "flow" })
    expect(crossed.code).toBe(0)
    expect(crossed.lines.some((line) => line.includes("phase handover: P01-implement Implementation → P02-test Test"))).toBe(true)
    expect(crossed.lines.some((line) => line.includes("✓ all phases complete"))).toBe(true)
    expect(has(f, "docs/R-01/P01-implement/done.md")).toBe(true)
    expect(has(f, "docs/R-01/P02-test/done.md")).toBe(true)
  })

  test("a plain run on a closed round points at transfer's close (today's complete lines kept)", async () => {
    const f = await fixture("mt", (dir) => ({ turn: (ctx) => reportHealTurn(dir)(ctx) ?? artifactTurns(dir)(ctx) }))
    expect((await f.run({ boundary: "flow" })).code).toBe(0)
    const again = await f.run()
    expect(again.code).toBe(0)
    expect(again.lines.some((line) => line.includes("✓ all phases complete"))).toBe(true)
    expect(again.lines.some((line) => line.includes("next: the round is complete — close it with: opencode-auto transfer"))).toBe(true)
  })

  test("a knowledge phase's boundary: its extraction is the phase's work and runs; the distillation after it is transfer's", async () => {
    const f = await fixture("mtk", (dir) => ({ turn: (ctx) => knowledgeTurn(dir)(ctx) ?? artifactTurns(dir)(ctx) }))
    // Seed the round at its knowledge phase: the earlier phases complete
    // (their units done, the index ticked) — the k phase is current, its
    // index empty, so the run's route is the knowledge branch.
    const state = (await readPhases(f.dir, 1))!
    for (const unit of state.phases.slice(0, 2)) expect(await completePhase(f.dir, unit, [])).toEqual([])
    await f.commit("earlier phases complete")
    const stopped = await f.run()
    // The extraction session ran (the phase's work — kb.md and, the round's
    // last phase, the report too), and the run stopped at the phase's
    // boundary ahead of the k phase's handover distillation.
    expect(stopped.code).toBe(0)
    expect(has(f, "docs/R-01/P03-knowledge/kb.md")).toBe(true)
    expect(has(f, "docs/R-01/report-for-user.md")).toBe(true)
    expect(has(f, "docs/R-01/P03-knowledge/handover.md")).toBe(false)
    expect(has(f, "docs/R-01/P03-knowledge/todo.md")).toBe(true)
    expect(stopped.lines.some((line) => line.includes("✓ phase boundary: P03-knowledge Knowledge distillation complete"))).toBe(true)
    expect(stopped.lines.some((line) => line.includes("closes the phase and the round"))).toBe(true)
  })
})
