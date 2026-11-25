// The repair-append budget's retirement (plans/0283, pinning the standing
// behavior): a held verdict gate stops for the human — no repair round ever
// opens, nothing is appended: the budget, its rounds and their shared helper
// are gone from the pull path (the executor protocol's fix grant repairs
// verify FAILs on the pull path; the wrapup fix loop inside a task's
// verification retired with that loop, plans/0314). The phase states the
// task loop walked to are seeded by hand; every act under test is the
// person's transfer.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { donePhase, finishPhaseWork, landPhaseHandover, loopFixture, type LoopFixture } from "./fixtures/loop"
import { transferDeterministic } from "../src/transfer"
import { captureRun } from "./fixtures/capture"
import { establishRound } from "../src/phases"

const made: LoopFixture[] = []
afterEach(() => {
  for (const fixture of made.splice(0)) rmSync(fixture.dir, { recursive: true, force: true })
})

async function fixture(phases: string): Promise<LoopFixture> {
  const f = await loopFixture(phases)
  made.push(f)
  await establishRound(f.dir, { phases })
  await f.commit("round setup")
  return f
}

const has = (f: LoopFixture, path: string) => existsSync(join(f.dir, path))

describe("the held verdict gate as state (plans/0283: the repair-append budget retired)", () => {
  test("the held gate stops for the human with the rework ways listed — never a repair round", async () => {
    const f = await fixture("mv")
    const transfer = () => captureRun(() => transferDeterministic(f.dir, { phases: "mv" }))
    // The implement phase's work done at its boundary, its handover landed;
    // the advance closes the phase and constructs the acceptance phase's
    // plan task.
    const implement = await f.phase(0)
    await donePhase(f, implement, ["T-001", "T-002"])
    await landPhaseHandover(f, implement)
    expect((await transfer()).code).toBe(0)
    // The acceptance phase's work done; its verdict document concludes
    // FAIL: the person's gate.
    const acceptance = await f.phase(1)
    await finishPhaseWork(f, acceptance)
    await Bun.write(join(f.dir, acceptance.dir, "verdict.md"), "# Verdict\n\nResult: FAIL two criteria unmet\n")
    await landPhaseHandover(f, acceptance)
    const { code, lines } = await transfer()
    expect(code).toBe(2)
    expect(lines.some((line) => line.includes("repair round"))).toBe(false)
    expect(lines.some((line) => line.includes("is held by its gate"))).toBe(true)
    expect(has(f, "docs/R-01/P02-acceptance/todo.md")).toBe(true)
    expect(await Bun.file(join(f.dir, "docs/R-01/P02-acceptance/verdict.md")).text()).toContain("Result: FAIL")
  })
})
