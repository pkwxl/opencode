import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Interactive } from "../src/interactive"
import { subtaskProgressLine, waitBetweenTasks } from "../src/loop-progress"
import { flushStats, loadStats, setStatsClock, statsTask, statsTotals } from "../src/stats"

// T-002: loop lifecycle wiring — the progress heartbeat (trackSubtasks →
// subtaskProgressLine) switched to read the stats task bucket's accumulation;
// guard and copy assertions (the statsId guard, the "this process" part only
// when ≠ cumulative).

describe("subtaskProgressLine progress heartbeat", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-loop-"))
    now = 1_000_000
    setStatsClock(() => now)
    await Bun.write(join(dir, "docs/T-001/subtasks.md"), ["- [x] done subtask", "- [ ] pending subtask", ""].join("\n"))
  })

  afterEach(async () => {
    setStatsClock()
    await flushStats(dir).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  })

  test("statsId guard: when the bucket identity is not the current task, statsTotals is not trusted and reporting is skipped", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-999") // the bucket identity is another task
    expect(await subtaskProgressLine(dir)).toBeUndefined()
    // an unloaded handle (a directory never loadStats'd) fails the guard too
    const fresh = await mkdtemp(join(tmpdir(), "auto-loop-fresh-"))
    try {
      await Bun.write(join(fresh, "docs/T-001/subtasks.md"), await Bun.file(join(dir, "docs/T-001/subtasks.md")).text())
      expect(await subtaskProgressLine(fresh)).toBeUndefined()
    } finally {
      await rm(fresh, { recursive: true, force: true })
    }
  })

  test("guard passes: elapsed time reads the task bucket (open-segment extrapolation included); without an interruption there is no \"this process\" part", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    now += 24 * 60_000
    const line = await subtaskProgressLine(dir)
    expect(line).toContain("⏳ T-001 subtask progress 1/2")
    expect(line).toContain("elapsed 24m 0s")
    expect(line).not.toContain("this process") // this process == cumulative, omitted
    expect(line).toContain("est. remaining 24m 0s") // linear extrapolation: 1/2 done → remaining = elapsed
  })

  test("resumed across an interruption: the cumulative includes the previous process; the \"this process\" part appears once ≠ cumulative", async () => {
    // First "process": runs 18 minutes, then a graceful close-out (equivalent
    // to the depreciated booked part after a kill).
    await loadStats(dir)
    await statsTask(dir, "T-001")
    now += 18 * 60_000
    await flushStats(dir)
    // Second "process": resumes the same task (statsTask with the same id is
    // idempotent, bucket not reset) and runs 6 more minutes.
    expect(await loadStats(dir)).toBeDefined() // an old document exists → resume info
    await statsTask(dir, "T-001")
    now += 6 * 60_000
    const line = await subtaskProgressLine(dir)
    expect(line).toContain("elapsed 24m 0s (this process 6m 0s)")
    expect(line).toContain("est. remaining 24m 0s") // the extrapolation uses the cumulative basis
  })
})

// T-005 wiring coverage: waitBetweenTasks (the --wait-between pause between
// tasks) with dir given deducts the pause span from the total time via
// statsWaitBegin/End and books it alone as waitMs.
describe("waitBetweenTasks wait deduction (stats wiring)", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-loop-wait-"))
    now = 100_000
    setStatsClock(() => now)
  })

  afterEach(async () => {
    setStatsClock()
    await flushStats(dir).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  })

  // A fake resident input line: advances the injected clock before answering,
  // simulating a human wait; answer controls the enter/timeout semantics.
  function fakeRepl(answer: string | undefined, advance: number): Interactive {
    return {
      attach: () => {},
      question: async () => {
        now += advance
        return answer as string
      },
      close: () => {},
    } as unknown as Interactive
  }

  test("enter continues immediately: a 40s wait does not enter wallMs, booked alone as waitMs", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    now += 5000
    await waitBetweenTasks(5, "T-002", fakeRepl("", 40_000), dir)
    const totals = await statsTotals(dir, "task")
    expect(totals?.wallMs).toBe(5000)
    expect(totals?.waitMs).toBe(40_000)
  })

  test("timeout continues on its own (answer=undefined): deducted the same way; dir undefined means stats is never touched", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await waitBetweenTasks(5, "T-002", fakeRepl(undefined, 5 * 60_000), dir)
    expect((await statsTotals(dir, "task"))?.waitMs).toBe(5 * 60_000)
    // dir undefined: no-op, nothing loaded or written
    const fresh = await mkdtemp(join(tmpdir(), "auto-loop-wait-fresh-"))
    try {
      await waitBetweenTasks(5, "T-002", fakeRepl("", 1000))
      expect(await Bun.file(join(fresh, ".auto", "stats.json")).exists()).toBe(false)
    } finally {
      await rm(fresh, { recursive: true, force: true })
    }
  })
})
