// A taskless phase's boundary (the knowledge type since plans/0283 retired
// its extraction): the phase holds no task index and no session work of its
// own — its handover is the executor's distill grant, claimable without a
// task index, and the close is the person's transfer.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { completePhase, establishRound, readPhases } from "../src/phases"
import { loopFixture, phaseHandover, type LoopFixture } from "./fixtures/loop"
import { CONFIG_FILE } from "../src/config"
import { openExecutorCoordinator } from "../src/executor-coordinator"
import { transferDeterministic } from "../src/transfer"
import { captureRun } from "./fixtures/capture"

const made: LoopFixture[] = []
afterEach(() => {
  for (const fixture of made.splice(0)) rmSync(fixture.dir, { recursive: true, force: true })
})

async function fixture(phases: string): Promise<LoopFixture> {
  const f = await loopFixture(phases)
  made.push(f)
  await establishRound(f.dir, { phases, round: 1 })
  await f.commit("round setup")
  return f
}

const has = (f: LoopFixture, path: string) => existsSync(join(f.dir, path))

describe("a taskless phase's boundary", () => {
  test("a knowledge phase claims distill without a task index; the landed handover closes the phase and the round at transfer", async () => {
    const f = await fixture("mtk")
    // The round at its knowledge phase: the earlier phases complete (their
    // units done, the index ticked), the k phase current, its index empty —
    // no session produces one (the knowledge extraction retired, plans/0283).
    const state = (await readPhases(f.dir, 1))!
    for (const unit of state.phases.slice(0, 2)) expect(await completePhase(f.dir, unit, [])).toEqual([])
    await f.commit("earlier phases complete")
    // The project config the executor coordinator requires (init's write).
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
