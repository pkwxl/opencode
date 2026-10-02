import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createServices, installServices, uninstallServices } from "../src/services"
import { fixedClock } from "./fixtures/clock"
import {
  flushStats,
  loadStats,
  MAX_TICK,
  statsBoot,
  statsClassifyUsage,
  statsDigest,
  statsHistory,
  statsId,
  statsKnowledgePhase,
  statsLaneRollup,
  statsLaneUsage,
  statsModelEvent,
  statsPhase,
  statsQuotaWait,
  statsSessionBegin,
  statsSessionEnd,
  statsTask,
  statsTotals,
  statsWaitBegin,
  statsWaitEnd,
  type LaneStat,
  type StatsDoc,
  type Usage,
} from "../src/stats"
import { roundCompleteLines } from "../src/conclusion"

// A usage helper shared with the conclusion-line case (the loop-conclusion
// suite's shape).
function usage(partial: Partial<Usage>): Usage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 1, ...partial }
}

// S02 coverage: the persistence and loading loop (schema / lenient parsing /
// atomic write / depreciation / round rollover / flush). Cases for the session
// APIs (statsSessionBegin/End, wait, per-session) and the read APIs are added
// in S03/S04.

describe("stats persistence and loading", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-stats-"))
    now = 100_000
    installServices(createServices({ clock: fixedClock(() => now) }))
  })

  afterEach(async () => {
    uninstallServices()
    await rm(dir, { recursive: true, force: true })
  })

  async function readDoc(): Promise<StatsDoc> {
    return JSON.parse(await Bun.file(join(dir, ".auto", "stats.json")).text()) as StatsDoc
  }

  async function writeDoc(doc: unknown) {
    await mkdir(join(dir, ".auto"), { recursive: true })
    await Bun.write(join(dir, ".auto", "stats.json"), JSON.stringify(doc))
  }

  test("dir === undefined is all no-op", async () => {
    expect(await loadStats(undefined)).toBeUndefined()
    await flushStats(undefined)
  })

  test("first load → flush round trip: a wall-clock segment lands in all three buckets in parallel, flush closes it; a second load without depreciation does not double-count", async () => {
    expect(await loadStats(dir)).toBeUndefined() // fresh directory, no resume info
    now += 5000
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.v).toBe(1)
    expect(doc.round).toBe(1)
    expect(doc.open).toBeUndefined() // a graceful close-out leaves no open segment
    expect(doc.taskB.wallMs).toBe(5000)
    expect(doc.phaseB.wallMs).toBe(5000)
    expect(doc.roundB.wallMs).toBe(5000)
    expect(doc.taskB.aiMs).toBe(0) // wall-clock segments do not enter aiMs
    expect(doc.lastWriteAt).toBe(105_000)

    // Simulate the next process: no open segment on disk, depreciation is 0,
    // the resume info carries the accumulated values.
    now += 60_000
    const resumed = await loadStats(dir)
    expect(resumed?.round).toBe(1)
    expect(resumed?.taskWallMs).toBe(5000)
    expect(resumed?.taskAiMs).toBe(0)
    await flushStats(dir)
    const doc2 = await readDoc()
    expect(doc2.taskB.wallMs).toBe(5000) // not booked twice
  })

  test("lenient on a corrupt file: invalid JSON restarts from now; partly bad fields become missing field by field, no throw", async () => {
    await writeDoc("not-json{{{")
    expect(await loadStats(dir)).toBeUndefined()
    await flushStats(dir)
    expect((await readDoc()).v).toBe(1) // rewritten as a valid document

    await flushStats(dir) // already unloaded, no-op
    await writeDoc({
      v: "x",
      round: 1,
      phase: 3,
      lastWriteAt: "bad",
      open: { at: "bad", ai: "yes" },
      taskB: { id: 5, wallMs: "bad", usage: { input: "bad" } },
      sessions: "nope",
      history: { rounds: "bad" },
    })
    await loadStats(dir) // does not throw
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.phase).toBe("")
    expect(doc.taskB.wallMs).toBe(0)
    expect(doc.taskB.usage.input).toBe(0)
    expect(doc.sessions).toEqual({})
    expect(doc.history.rounds).toBe(0)
    expect(doc.open).toBeUndefined() // the bad open is dropped, no new segment after flush
  })

  test("depreciation: a segment left by the previous process is credited exactly [open.at, lastWriteAt]", async () => {
    await writeDoc({
      v: 1,
      round: 1,
      phase: "m",
      open: { at: 1000, ai: true },
      lastWriteAt: 5000,
      taskB: { id: "T-001" },
      phaseB: { id: "m" },
      roundB: { id: "1" },
      sessions: {},
      history: { rounds: 0 },
    })
    now = 100_000 // load time far past lastWriteAt: the excess is not credited
    const resumed = await loadStats(dir)
    expect(resumed?.task).toBe("T-001")
    expect(resumed?.phase).toBe("m")
    expect(resumed?.taskWallMs).toBe(4000)
    expect(resumed?.taskAiMs).toBe(4000) // an ai segment depreciates into aiMs too
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.taskB.wallMs).toBe(4000)
    expect(doc.phaseB.wallMs).toBe(4000)
    expect(doc.roundB.wallMs).toBe(4000)
    expect(doc.roundB.aiMs).toBe(4000)
  })

  test("MAX_TICK clamp: both depreciation and the live fold truncate to 30 minutes", async () => {
    await writeDoc({
      v: 1,
      round: 1,
      phase: "",
      open: { at: 1000, ai: false },
      lastWriteAt: 1000 + MAX_TICK + 10_000,
      taskB: {},
      phaseB: {},
      roundB: {},
      sessions: {},
      history: { rounds: 0 },
    })
    await loadStats(dir)
    await flushStats(dir)
    expect((await readDoc()).taskB.wallMs).toBe(MAX_TICK) // depreciation clamped

    // Live fold clamp: load again (the previous segment already booked
    // MAX_TICK), the clock jumps past MAX_TICK+5s in one go (wake from
    // hibernate), flush books only MAX_TICK more — exactly 2×MAX_TICK total.
    now = 1000
    await loadStats(dir)
    now += MAX_TICK + 5000
    await flushStats(dir)
    expect((await readDoc()).taskB.wallMs).toBe(2 * MAX_TICK)
  })

  test("negative values clamp to 0: clock rollback (lastWriteAt < open.at / now < open.at) books nothing", async () => {
    await writeDoc({
      v: 1,
      round: 1,
      phase: "",
      open: { at: 5000, ai: true },
      lastWriteAt: 1000,
      taskB: {},
      phaseB: {},
      roundB: {},
      sessions: {},
      history: { rounds: 0 },
    })
    await loadStats(dir)
    await flushStats(dir)
    expect((await readDoc()).taskB.wallMs).toBe(0) // negative depreciation clamps to 0

    now = 100_000
    await loadStats(dir)
    now = 50_000 // clock rollback
    await flushStats(dir)
    expect((await readDoc()).taskB.wallMs).toBe(0) // negative live fold clamps to 0
  })

  test("round rollover: a changed round number rolls roundB into history and resets; a corrupt round field only refreshes the snapshot without rolling", async () => {
    await mkdir(join(dir, "docs", "R-02"), { recursive: true }) // currentRound → 2
    await writeDoc({
      v: 1,
      round: 1,
      phase: "m",
      lastWriteAt: 90_000,
      taskB: { id: "T-003", wallMs: 45_000, aiMs: 20_000 },
      phaseB: { id: "m", wallMs: 50_000 },
      roundB: {
        id: "1",
        wallMs: 60_000,
        aiMs: 30_000,
        waitMs: 5000,
        sessions: 2,
        tasks: 1,
        usage: { input: 100, output: 40, reasoning: 10, cacheRead: 80, cacheWrite: 20, cost: 0.5, steps: 3 },
      },
      sessions: {},
      history: { rounds: 0 },
    })
    const resumed = await loadStats(dir)
    expect(resumed?.round).toBe(1) // the resume snapshot is the round where the previous process stopped
    expect(resumed?.taskWallMs).toBe(45_000)
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.round).toBe(2)
    expect(doc.history.rounds).toBe(1)
    expect(doc.history.totals.wallMs).toBe(60_000)
    expect(doc.history.totals.aiMs).toBe(30_000)
    expect(doc.history.totals.waitMs).toBe(5000)
    expect(doc.history.totals.sessions).toBe(2)
    expect(doc.history.totals.tasks).toBe(1)
    expect(doc.history.totals.usage.input).toBe(100)
    expect(doc.history.totals.usage.cost).toBe(0.5)
    expect(doc.roundB.id).toBe("2")
    expect(doc.roundB.wallMs).toBe(0) // reset (load and flush at the same instant, the new segment folds 0)
    expect(doc.taskB.wallMs).toBe(45_000) // the task/phase buckets stay (already inside roundB)
    expect(doc.phaseB.wallMs).toBe(50_000)

    // A corrupt round field (<1): no rollover, history not inflated, roundB
    // keeps its old value.
    await writeDoc({
      v: 1,
      round: 0,
      phase: "",
      lastWriteAt: 90_000,
      taskB: {},
      phaseB: {},
      roundB: { id: "?", wallMs: 60_000 },
      sessions: {},
      history: { rounds: 0 },
    })
    await loadStats(dir)
    await flushStats(dir)
    const doc2 = await readDoc()
    expect(doc2.round).toBe(2)
    expect(doc2.history.rounds).toBe(0)
    expect(doc2.roundB.wallMs).toBe(60_000)
  })

  test("concurrent writes serialize through the queue, no .tmp leftovers under .auto/", async () => {
    await loadStats(dir) // queued write #1
    await Promise.all([flushStats(dir), flushStats(dir)]) // concurrent flushes share the handle and the write chain
    const names = await readdir(join(dir, ".auto"))
    expect(names).toContain("stats.json")
    expect(names.filter((name) => name.endsWith(".tmp"))).toEqual([])
  })

  test("concurrent first loads share one promise, no double depreciation", async () => {
    await writeDoc({
      v: 1,
      round: 1,
      phase: "",
      open: { at: 1000, ai: false },
      lastWriteAt: 5000,
      taskB: { id: "T-001" },
      phaseB: {},
      roundB: {},
      sessions: {},
      history: { rounds: 0 },
    })
    await Promise.all([loadStats(dir), loadStats(dir)])
    await flushStats(dir)
    expect((await readDoc()).taskB.wallMs).toBe(4000) // depreciation booked only once
  })
})

// S03 coverage: statsPhase/statsTask/statsTotals/statsId/statsBoot.
describe("stats level switching and reads", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-stats-"))
    now = 100_000
    installServices(createServices({ clock: fixedClock(() => now) }))
  })

  afterEach(async () => {
    uninstallServices()
    await rm(dir, { recursive: true, force: true })
  })

  async function readDoc(): Promise<StatsDoc> {
    return JSON.parse(await Bun.file(join(dir, ".auto", "stats.json")).text()) as StatsDoc
  }

  async function writeDoc(doc: unknown) {
    await mkdir(join(dir, ".auto"), { recursive: true })
    await Bun.write(join(dir, ".auto", "stats.json"), JSON.stringify(doc))
  }

  test("dir === undefined is all no-op", async () => {
    await statsPhase(undefined, "a")
    await statsTask(undefined, "T-001")
    expect(await statsTotals(undefined, "task")).toBeUndefined()
    expect(await statsBoot(undefined)).toBeUndefined()
    expect(statsId(undefined)).toBeUndefined()
  })

  test("the three buckets nest: one fold lands in all three in parallel, at any moment Σtask ≤ phase ≤ round", async () => {
    await loadStats(dir)
    now += 1000 // non-task time before a phase/task is named: into all three buckets (taskB id="")
    await statsPhase(dir, "a") // folds the 1000 into the old bucket, then resets phaseB
    await statsTask(dir, "T-001") // resets taskB (that 1000 stays only in phase/round)
    now += 3000
    const t1 = await statsTotals(dir, "task")
    expect(t1?.wallMs).toBe(3000)
    await statsTask(dir, "T-002") // T-001's 3000 folds into its old taskB and leaves the bucket on reset
    now += 2000
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.taskB.wallMs).toBe(2000)
    expect(doc.phaseB.wallMs).toBe(5000) // = 3000 (T-001) + 2000 (T-002)
    expect(doc.roundB.wallMs).toBe(6000) // = 1000 (non-task) + 5000
    // Σ of the task buckets (the departed T-001 + the current T-002) = phase ≤ round
    expect(3000 + doc.taskB.wallMs).toBe(doc.phaseB.wallMs)
    expect(doc.phaseB.wallMs).toBeLessThanOrEqual(doc.roundB.wallMs)
    // tasks counting: each distinct task id entered adds 1; the taskB bucket itself = 1
    expect(doc.taskB.tasks).toBe(1)
    expect(doc.phaseB.tasks).toBe(2)
    expect(doc.roundB.tasks).toBe(2)
  })

  test("phase switching resets: a different letter resets (since updated, old value leaves the bucket), the same letter is idempotent", async () => {
    await loadStats(dir)
    await statsPhase(dir, "a") // since = 100_000
    now += 2000
    await statsPhase(dir, "a") // same letter: no reset, accumulation continues
    const mid = await statsTotals(dir, "phase")
    expect(mid?.id).toBe("a")
    expect(mid?.wallMs).toBe(2000)
    expect(mid?.since).toBe(100_000)
    now += 1000
    await statsPhase(dir, "b") // reset: the fold first lands the 3000 in the old a bucket (then it leaves)
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.phase).toBe("b")
    expect(doc.phaseB.id).toBe("b")
    expect(doc.phaseB.since).toBe(103_000)
    expect(doc.phaseB.wallMs).toBe(0) // old value not kept (load and flush at the same instant, the new segment folds 0)
    expect(doc.roundB.wallMs).toBe(3000) // round does not reset with a phase switch
  })

  test("statsTask clears sessions; the same id is idempotent and does not clear (per-session survives an interruption resume)", async () => {
    await writeDoc({
      v: 1,
      round: 1,
      phase: "m",
      lastWriteAt: 90_000,
      taskB: { id: "T-001", wallMs: 5000 },
      phaseB: { id: "m" },
      roundB: { id: "1" },
      sessions: { s1: { task: "T-001", aiMs: 1, wallMs: 2, rounds: 1, usage: {}, at: 90_000 } },
      history: { rounds: 0 },
    })
    await loadStats(dir)
    await statsTask(dir, "T-001") // same id (resume after interruption): no reset, sessions kept
    await flushStats(dir)
    let doc = await readDoc()
    expect(doc.taskB.wallMs).toBe(5000) // resumed accumulation not zeroed
    expect(Object.keys(doc.sessions)).toEqual(["s1"])

    await loadStats(dir)
    await statsTask(dir, "T-002") // switch: resets taskB + clears sessions
    await flushStats(dir)
    doc = await readDoc()
    expect(doc.taskB.id).toBe("T-002")
    expect(doc.sessions).toEqual({})
    expect(doc.phaseB.tasks).toBe(1) // the same id not counted, a different id counts 1
  })

  test("live extrapolation: statsTotals advances with the injected now, mutating no state and writing nothing", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    now += 4000
    expect((await statsTotals(dir, "task"))?.wallMs).toBe(4000)
    now += 4000
    expect((await statsTotals(dir, "task"))?.wallMs).toBe(8000) // open-segment extrapolation
    await new Promise((resolve) => setTimeout(resolve, 20)) // wait for the write queue to drain
    const doc = await readDoc() // on disk still the last flushed snapshot; the extrapolation was not booked
    expect(doc.taskB.wallMs).toBe(0)
    expect(doc.lastWriteAt).toBe(100_000)
    await flushStats(dir) // one fold books the 8000; the extrapolation caused no double count
    expect((await readDoc()).taskB.wallMs).toBe(8000)
  })

  test("statsBoot: a snapshot of this process's starting point; the delta = statsTotals − snapshot; a bucket reset zeroes the snapshot", async () => {
    await writeDoc({
      v: 1,
      round: 1,
      phase: "m",
      lastWriteAt: 90_000,
      taskB: { id: "T-003", wallMs: 45_000, aiMs: 20_000 },
      phaseB: { id: "m", wallMs: 50_000 },
      roundB: { id: "1", wallMs: 60_000 },
      sessions: {},
      history: { rounds: 0 },
    })
    await loadStats(dir)
    const boot = await statsBoot(dir)
    expect(boot?.task.wallMs).toBe(45_000) // the resume snapshot carries the previous process's accumulation
    expect(boot?.round.wallMs).toBe(60_000)
    now += 5000
    const task = await statsTotals(dir, "task")
    expect(task!.wallMs - boot!.task.wallMs).toBe(5000) // this process's delta
    await statsTask(dir, "T-004") // bucket reset → boot.task zeroed, delta = the whole current bucket
    now += 1000
    const boot2 = await statsBoot(dir)
    expect(boot2?.task.wallMs).toBe(0)
    expect(boot2?.round.wallMs).toBe(60_000) // the round snapshot is unaffected by a task switch
    expect((await statsTotals(dir, "task"))?.wallMs).toBe(1000)
    await flushStats(dir)
  })

  test("statsId: a guarded read; unloaded / empty id returns undefined without triggering a load", async () => {
    expect(statsId(dir)).toBeUndefined() // not loaded
    await loadStats(dir)
    expect(statsId(dir)).toBeUndefined() // empty id
    await statsTask(dir, "T-007")
    expect(statsId(dir)).toBe("T-007")
    await flushStats(dir)
    expect(statsId(dir)).toBeUndefined() // no handle after unload
  })
})

// S04 coverage: statsSessionBegin/End, statsWaitBegin/End, per-session resume,
// eviction.
describe("stats sessions and waits", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-stats-"))
    now = 100_000
    installServices(createServices({ clock: fixedClock(() => now) }))
  })

  afterEach(async () => {
    uninstallServices()
    await rm(dir, { recursive: true, force: true })
  })

  async function readDoc(): Promise<StatsDoc> {
    return JSON.parse(await Bun.file(join(dir, ".auto", "stats.json")).text()) as StatsDoc
  }

  function usage(input: number): Usage {
    return { input, output: 10, reasoning: 5, cacheRead: 90, cacheWrite: 20, cost: 0.01, steps: 2 }
  }

  test("dir === undefined is all no-op", async () => {
    await statsSessionBegin(undefined, "T-001")
    expect(await statsSessionEnd(undefined, "s1", usage(100))).toBeUndefined()
    await statsWaitBegin(undefined, "askHuman")
    await statsWaitEnd(undefined)
  })

  test("session loop: the ai segment lands in aiMs, usage in all four layers, the report carries the totals, the wall-clock segment resumes after the end", async () => {
    await loadStats(dir)
    now += 2000 // wall clock before the session (driver work): into wallMs only
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 5000
    const report = await statsSessionEnd(dir, "s1", usage(100))
    expect(report?.thisAiMs).toBe(5000)
    expect(report?.session.task).toBe("T-001")
    expect(report?.session.aiMs).toBe(5000)
    expect(report?.session.wallMs).toBe(5000) // no wait: wallMs = aiMs
    expect(report?.session.rounds).toBe(1)
    expect(report?.session.usage.input).toBe(100)
    expect(report?.session.at).toBe(107_000)
    expect(report?.task.aiMs).toBe(5000)
    expect(report?.phase.wallMs).toBe(7000) // 2000 wall clock + 5000 AI
    expect(report?.round.usage.cacheRead).toBe(90)

    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.open).toBeUndefined() // flush closes the segment
    expect(doc.taskB.wallMs).toBe(5000) // the pre-session 2000 left the bucket on the statsTask reset (kept in phase/round)
    expect(doc.taskB.aiMs).toBe(5000)
    expect(doc.phaseB.wallMs).toBe(7000)
    expect(doc.phaseB.aiMs).toBe(5000)
    expect(doc.roundB.aiMs).toBe(5000)
    expect(doc.taskB.sessions).toBe(1)
    expect(doc.phaseB.sessions).toBe(1)
    expect(doc.roundB.sessions).toBe(1)
    expect(doc.taskB.usage).toEqual(usage(100))
    expect(doc.roundB.usage.steps).toBe(2)

    // The wall-clock segment resumes after the session ends: duration still
    // enters wallMs but aiMs no longer grows.
    await loadStats(dir)
    now += 3000
    const t = await statsTotals(dir, "task")
    expect(t?.wallMs).toBe(8000) // 5000 + 3000
    expect(t?.aiMs).toBe(5000)
    await flushStats(dir)
  })

  test("wait deduction: during a wait neither aiMs nor wallMs grows, waitMs is booked alone; nested waits dedupe to one", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 3000
    await statsWaitBegin(dir, "askHuman") // closes the ai segment
    now += 2000
    await statsWaitBegin(dir, "nested") // nested: still the same wait
    now += 1000
    await statsWaitEnd(dir) // depth 2→1: still waiting
    now += 1000
    expect((await statsTotals(dir, "task"))?.aiMs).toBe(3000) // no extrapolation while waiting
    await statsWaitEnd(dir) // depth zero: the 4000 wait is booked, the ai segment reopens
    now += 4000
    const report = await statsSessionEnd(dir, "s1", usage(50))
    expect(report?.thisAiMs).toBe(7000) // 3000 + 4000, the wait not counted
    expect(report?.session.wallMs).toBe(11_000) // per-session wallMs includes the wait
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.taskB.aiMs).toBe(7000)
    expect(doc.taskB.wallMs).toBe(7000) // the three buckets' wallMs excludes pure human waits
    expect(doc.taskB.waitMs).toBe(4000)
    expect(doc.phaseB.waitMs).toBe(4000)
    expect(doc.roundB.waitMs).toBe(4000)
  })

  test("closing and reopening a segment during a wait keeps the ai flag: after an in-session wait ends, AI duration keeps accumulating", async () => {
    await loadStats(dir)
    await statsSessionBegin(dir, "T-001")
    now += 1000
    await statsWaitBegin(dir)
    now += 500
    await statsWaitEnd(dir)
    now += 1000
    const report = await statsSessionEnd(dir, "s1", usage(1))
    expect(report?.thisAiMs).toBe(2000) // the two AI segments around the wait joined
    await flushStats(dir)
  })

  test("waitEnd without a paired begin is a no-op; a wait outside a session (stepPause) enters the three buckets but not per-session", async () => {
    await loadStats(dir)
    await statsWaitEnd(dir) // unpaired: does not blow up
    now += 1000
    await statsWaitBegin(dir, "stepPause") // a wait outside a session (wall-clock segment)
    now += 2000
    await statsWaitEnd(dir)
    now += 1000
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.taskB.waitMs).toBe(2000)
    expect(doc.taskB.wallMs).toBe(2000) // 1000 of wall clock on each side of the wait
    expect(doc.sessions).toEqual({})
  })

  // The window wait kind (plans/0055 §6.3): a dispatch whose candidates are
  // all outside their windows books its sleep as a `window` wait — the same
  // caliber as every planned wait (excluded from aiMs/wallMs, recorded as
  // waitMs alone).
  test("the window wait kind books like every planned wait: excluded from wallMs, recorded as waitMs", async () => {
    await loadStats(dir)
    now += 1000
    await statsWaitBegin(dir, "window")
    now += 2000
    await statsWaitEnd(dir)
    now += 1000
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.taskB.waitMs).toBe(2000)
    expect(doc.taskB.wallMs).toBe(2000)
    expect(doc.taskB.aiMs).toBe(0)
  })

  test("per-session resumes across loads: a second session with the same sessionID accumulates rounds/aiMs/usage", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 5000
    await statsSessionEnd(dir, "s1", usage(100))
    await flushStats(dir)

    now += 60_000 // simulate a process restart
    await loadStats(dir)
    await statsTask(dir, "T-001") // same id is idempotent: the sessions map is kept
    await statsSessionBegin(dir, "T-001")
    now += 3000
    const report = await statsSessionEnd(dir, "s1", usage(50))
    expect(report?.thisAiMs).toBe(3000) // this one
    expect(report?.session.aiMs).toBe(8000) // accumulated across the interruption
    expect(report?.session.rounds).toBe(2)
    expect(report?.session.usage.input).toBe(150)
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.sessions.s1.rounds).toBe(2)
    expect(doc.sessions.s1.at).toBe(168_000)
  })

  test("beyond 64 sessions the oldest is evicted by at, aggregates lossless", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    for (let i = 0; i < 65; i++) {
      await statsSessionBegin(dir, "T-001")
      now += 1000
      await statsSessionEnd(dir, `s${i}`, usage(1))
    }
    await flushStats(dir)
    const doc = await readDoc()
    expect(Object.keys(doc.sessions)).toHaveLength(64)
    expect(doc.sessions.s0).toBeUndefined() // the oldest evicted
    expect(doc.sessions.s64).toBeDefined()
    expect(doc.taskB.sessions).toBe(65) // aggregates unaffected
    expect(doc.taskB.usage.input).toBe(65)
  })

  test("statsSessionEnd without a paired begin (an anomaly fallback): usage still booked, thisAiMs = 0", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    now += 1000
    const report = await statsSessionEnd(dir, "sX", usage(7))
    expect(report?.thisAiMs).toBe(0)
    expect(report?.session.task).toBe("T-001") // falls back to the current taskB.id
    expect(report?.session.rounds).toBe(1)
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.taskB.sessions).toBe(1)
    expect(doc.taskB.usage.input).toBe(7)
    expect(doc.taskB.aiMs).toBe(0) // wall-clock segment: no AI booked
    expect(doc.taskB.wallMs).toBe(1000)
  })
})

// Per-model and per-tier usage, the `classify` bucket and the protocol-drift
// counters (plans/0055 §7.1 "Stats", §10 items 3 and 12): booked beside the
// bucket's own usage at the same session-booking point, persisted
// backward-compatibly (absent sections = no model data, the pre-registry
// shape) and cumulative across interruptions like the flat fields.
describe("stats per-model / per-tier / classify buckets", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-stats-models-"))
    now = 100_000
    installServices(createServices({ clock: fixedClock(() => now) }))
  })

  afterEach(async () => {
    uninstallServices()
    await rm(dir, { recursive: true, force: true })
  })

  async function readDoc(): Promise<StatsDoc> {
    return JSON.parse(await Bun.file(join(dir, ".auto", "stats.json")).text()) as StatsDoc
  }

  async function writeDoc(doc: unknown) {
    await mkdir(join(dir, ".auto"), { recursive: true })
    await Bun.write(join(dir, ".auto", "stats.json"), JSON.stringify(doc))
  }

  function usage(input: number): Usage {
    return { input, output: 10, reasoning: 5, cacheRead: 90, cacheWrite: 20, cost: 0.01, steps: 2 }
  }

  test("dir/model undefined: no-ops that write nothing", async () => {
    await statsModelEvent(undefined, "glm", "fail")
    await statsModelEvent(dir, undefined, "fail")
    await statsClassifyUsage(undefined, usage(1))
    expect(await Bun.file(join(dir, ".auto", "stats.json")).exists()).toBe(false)
  })

  test("session booking by model and tier: parallel into the three buckets, report carries them", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 5000
    const report = await statsSessionEnd(dir, "s1", usage(100), "glm", "simple")
    expect(report?.task.models?.glm?.sessions).toBe(1)
    expect(report?.task.models?.glm?.usage.input).toBe(100)
    expect(report?.phase.tiers?.simple?.sessions).toBe(1)
    expect(report?.round.tiers?.simple?.usage.input).toBe(100)
    await flushStats(dir)
    const doc = await readDoc()
    for (const bucket of [doc.taskB, doc.phaseB, doc.roundB]) {
      expect(bucket.models?.glm?.usage.input).toBe(100)
      expect(bucket.models?.glm?.usage.steps).toBe(2)
      expect(bucket.models?.glm?.sessions).toBe(1)
      expect(bucket.tiers?.simple?.usage.input).toBe(100)
      expect(bucket.tiers?.simple?.sessions).toBe(1)
    }
  })

  test("a session without model/tier persists the pre-registry shape (C2)", async () => {
    await loadStats(dir)
    await statsSessionBegin(dir, "T-001")
    now += 1000
    await statsSessionEnd(dir, "s1", usage(10))
    await statsModelEvent(dir, undefined, "fail")
    await flushStats(dir)
    const text = await Bun.file(join(dir, ".auto", "stats.json")).text()
    expect(text).not.toContain('"models"')
    expect(text).not.toContain('"tiers"')
  })

  test("a raw provider/model override value keys by its raw string", async () => {
    await loadStats(dir)
    await statsSessionBegin(dir, "T-001")
    now += 1000
    await statsSessionEnd(dir, "s1", usage(7), "zhipuai/glm-4.6", "deep")
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.roundB.models?.["zhipuai/glm-4.6"]?.usage.input).toBe(7)
    expect(doc.roundB.tiers?.deep?.sessions).toBe(1)
  })

  test("the classify bucket: classifier tokens outside the unit's session totals", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await statsClassifyUsage(dir, usage(42))
    await flushStats(dir)
    const doc = await readDoc()
    for (const bucket of [doc.taskB, doc.phaseB, doc.roundB]) {
      expect(bucket.models?.classify?.usage.input).toBe(42)
      expect(bucket.models?.classify?.sessions).toBe(1)
      expect(bucket.usage.input).toBe(0) // never in the bucket's own totals
      expect(bucket.sessions).toBe(0)
    }
    expect(doc.sessions).toEqual({}) // and never in a per-session record
  })

  test("protocol-drift counters: fail / stuck / reprompt land on the model record in all three buckets", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await statsModelEvent(dir, "glm", "fail")
    await statsModelEvent(dir, "glm", "stuck")
    await statsModelEvent(dir, "glm", "stuck")
    await statsModelEvent(dir, "glm", "reprompt")
    const totals = await statsTotals(dir, "task")
    expect(totals?.models?.glm).toMatchObject({ fails: 1, stuckHints: 2, reprompts: 1, sessions: 0 })
    await statsModelEvent(dir, "opus", "fail")
    await flushStats(dir)
    const doc = await readDoc()
    for (const bucket of [doc.taskB, doc.phaseB, doc.roundB]) {
      expect(bucket.models?.glm?.fails).toBe(1)
      expect(bucket.models?.opus?.fails).toBe(1)
      expect(bucket.models?.opus?.usage.input).toBe(0)
    }
  })

  test("compensation counters: probe / continuation / stepup land on the model record in all three buckets (plans/0069 §2.4)", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await statsModelEvent(dir, "glm", "probe")
    await statsModelEvent(dir, "glm", "probe")
    await statsModelEvent(dir, "glm", "continuation")
    await statsModelEvent(dir, "opus", "stepup")
    const totals = await statsTotals(dir, "task")
    expect(totals?.models?.glm).toMatchObject({ probeFails: 2, lengthContinuations: 1, stepUps: 0, fails: 0, stuckHints: 0, reprompts: 0, sessions: 0 })
    expect(totals?.models?.opus).toMatchObject({ stepUps: 1, probeFails: 0, lengthContinuations: 0 })
    await flushStats(dir)
    const doc = await readDoc()
    for (const bucket of [doc.taskB, doc.phaseB, doc.roundB]) {
      expect(bucket.models?.glm?.probeFails).toBe(2)
      expect(bucket.models?.glm?.lengthContinuations).toBe(1)
      expect(bucket.models?.glm?.stepUps).toBe(0)
      expect(bucket.models?.opus?.stepUps).toBe(1)
      expect(bucket.models?.opus?.probeFails).toBe(0)
    }
  })

  test("an older stats file loads; the new sections default empty and booking then works", async () => {
    // A pre-registry v:1 document: no models/tiers anywhere, a hand-written
    // task bucket and history aggregate.
    await writeDoc({
      v: 1,
      round: 1,
      phase: "m",
      lastWriteAt: 90_000,
      taskB: { id: "T-001", wallMs: 5000 },
      phaseB: { id: "m", wallMs: 5000 },
      roundB: { id: "1", wallMs: 5000, usage: { input: 40 } },
      sessions: {},
      history: { rounds: 1, totals: { wallMs: 60_000, usage: { input: 30 } } },
    })
    await loadStats(dir)
    const totals = await statsTotals(dir, "task")
    expect(totals?.models).toBeUndefined()
    expect(totals?.tiers).toBeUndefined()
    expect(totals?.usage.input).toBe(0)
    expect((await statsHistory(dir))?.totals.models).toBeUndefined()
    // booking then works on top of the loaded document
    await statsSessionBegin(dir, "T-001")
    now += 1000
    await statsSessionEnd(dir, "s1", usage(5), "glm", "simple")
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.roundB.usage.input).toBe(45) // 40 loaded + 5 booked
    expect(doc.roundB.models?.glm?.usage.input).toBe(5)
    expect(doc.roundB.tiers?.simple?.sessions).toBe(1)
  })

  test("corrupt model sections parse leniently: bad entries drop, the flat fields survive", async () => {
    await writeDoc({
      v: 1,
      round: 1,
      phase: "m",
      lastWriteAt: 90_000,
      taskB: { id: "T-001", wallMs: 5000, models: "nope", tiers: { deep: "nope", simple: { usage: { input: "bad" } } } },
      phaseB: { id: "m" },
      roundB: { id: "1", models: { glm: { usage: { input: 9 }, sessions: "bad", fails: 2, junk: true } } },
      sessions: {},
      history: { rounds: 0 },
    })
    await loadStats(dir)
    const task = await statsTotals(dir, "task")
    expect(task?.models).toBeUndefined() // a non-object section drops whole
    expect(task?.tiers?.simple?.usage.input).toBe(0) // a bad entry keeps its shell
    expect(task?.tiers?.deep).toBeUndefined()
    expect(task?.wallMs).toBe(5000)
    const round = await statsTotals(dir, "round")
    expect(round?.models?.glm?.usage.input).toBe(9) // unknown fields ignored
    expect(round?.models?.glm?.sessions).toBe(0) // bad counter = missing
    expect(round?.models?.glm?.fails).toBe(2)
  })

  test("cross-interruption cumulation: usage, sessions and counters accumulate over reloads", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 5000
    await statsSessionEnd(dir, "s1", usage(100), "glm", "simple")
    await statsModelEvent(dir, "glm", "fail")
    await statsClassifyUsage(dir, usage(10))
    await flushStats(dir)

    // Simulate a process restart: same task resumed, one more session on the
    // same model, each counter up one more.
    now += 60_000
    await loadStats(dir)
    await statsTask(dir, "T-001") // same id is idempotent
    await statsSessionBegin(dir, "T-001")
    now += 3000
    await statsSessionEnd(dir, "s2", usage(50), "glm", "simple")
    await statsModelEvent(dir, "glm", "fail")
    await statsClassifyUsage(dir, usage(5))
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.taskB.models?.glm?.sessions).toBe(2)
    expect(doc.taskB.models?.glm?.usage.input).toBe(150)
    expect(doc.taskB.models?.glm?.fails).toBe(2)
    expect(doc.taskB.models?.classify?.usage.input).toBe(15)
    expect(doc.taskB.models?.classify?.sessions).toBe(2)
    expect(doc.taskB.tiers?.simple?.sessions).toBe(2)
    expect(doc.taskB.usage.input).toBe(150) // classify stays outside the flat totals
    expect(doc.taskB.sessions).toBe(2)
  })

  test("round rollover merges the model and tier sections into history", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 5000
    await statsSessionEnd(dir, "s1", usage(100), "glm", "simple")
    await statsModelEvent(dir, "glm", "fail")
    await statsClassifyUsage(dir, usage(10))
    await flushStats(dir)

    // Enter round 2: on load round 1 rolls into history (models/tiers join the
    // aggregate).
    await mkdir(join(dir, "docs", "R-02"), { recursive: true })
    await loadStats(dir)
    const history = await statsHistory(dir)
    expect(history?.rounds).toBe(1)
    expect(history?.totals.models?.glm?.usage.input).toBe(100)
    expect(history?.totals.models?.glm?.sessions).toBe(1)
    expect(history?.totals.models?.glm?.fails).toBe(1)
    expect(history?.totals.models?.classify?.usage.input).toBe(10)
    expect(history?.totals.tiers?.simple?.sessions).toBe(1)
    await flushStats(dir)
    const doc = await readDoc()
    expect(doc.history.totals.models?.glm?.usage.input).toBe(100)
    expect(doc.roundB.models).toBeUndefined() // the new round starts empty (C2 shape)
    expect(doc.roundB.tiers).toBeUndefined()
  })
})

// Time lost to quota windows (plans/0057 §11 item 7): a per-model figure in
// each bucket, beside the generic waitMs the wait also books.
describe("stats quota-window waits", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-stats-quota-"))
    now = 100_000
    installServices(createServices({ clock: fixedClock(() => now) }))
  })

  afterEach(async () => {
    uninstallServices()
    await rm(dir, { recursive: true, force: true })
  })

  async function readDoc(): Promise<StatsDoc> {
    return JSON.parse(await Bun.file(join(dir, ".auto", "stats.json")).text()) as StatsDoc
  }

  test("no dir, or nothing slept: no-ops that write nothing", async () => {
    await statsQuotaWait(undefined, "glm", 1000)
    await statsQuotaWait(dir, "glm", 0)
    await statsQuotaWait(dir, "glm", -5)
    expect(await Bun.file(join(dir, ".auto", "stats.json")).exists()).toBe(false)
  })

  test("booked per model into the three buckets, unclamped; absent until one is booked", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await flushStats(dir)
    expect(await Bun.file(join(dir, ".auto", "stats.json")).text()).not.toContain('"quotaWaits"')
    // Three hours is past MAX_TICK: the figure is the planned sleep as is.
    await statsQuotaWait(dir, "glm", 3 * 3_600_000)
    await statsQuotaWait(dir, "glm", 60_000)
    await statsQuotaWait(dir, "opus", 1000)
    await flushStats(dir)
    const doc = await readDoc()
    for (const bucket of [doc.taskB, doc.phaseB, doc.roundB]) {
      expect(bucket.quotaWaits).toEqual({ glm: 3 * 3_600_000 + 60_000, opus: 1000 })
    }
    expect((await statsTotals(dir, "round"))?.quotaWaits?.glm).toBe(3 * 3_600_000 + 60_000)
  })

  test("a bad figure parses as missing; round rollover merges the figures into history", async () => {
    await mkdir(join(dir, ".auto"), { recursive: true })
    await Bun.write(
      join(dir, ".auto", "stats.json"),
      JSON.stringify({
        v: 1,
        round: 1,
        phase: "m",
        lastWriteAt: 90_000,
        taskB: { id: "T-001", quotaWaits: "nope" },
        phaseB: { id: "m" },
        roundB: { id: "1", quotaWaits: { glm: 5000, bad: "x", negative: -1 } },
        sessions: {},
        history: { rounds: 1, totals: { quotaWaits: { glm: 1000 } } },
      }),
    )
    await loadStats(dir)
    expect((await statsTotals(dir, "task"))?.quotaWaits).toBeUndefined()
    expect((await statsTotals(dir, "round"))?.quotaWaits).toEqual({ glm: 5000 })
    await flushStats(dir)
    await mkdir(join(dir, "docs", "R-02"), { recursive: true })
    await loadStats(dir)
    expect((await statsHistory(dir))?.totals.quotaWaits).toEqual({ glm: 6000 })
    await flushStats(dir)
    expect((await readDoc()).roundB.quotaWaits).toBeUndefined()
  })
})

// Knowledge-digest counters (plans/0061 R3/A7): per planning session the
// estimated sizes of the injected digests, the cap trips, and knowledge-phase
// use — booked into the three buckets like the other optional sections, with
// the same absent-until-booked shape rule. The round conclusion's digest line
// (src/conclusion.ts) is covered here too: it is the counters' only reader.
describe("stats digest counters", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-stats-digest-"))
    now = 100_000
    installServices(createServices({ clock: fixedClock(() => now) }))
  })

  afterEach(async () => {
    uninstallServices()
    await rm(dir, { recursive: true, force: true })
  })

  async function readDoc(): Promise<StatsDoc> {
    return JSON.parse(await Bun.file(join(dir, ".auto", "stats.json")).text()) as StatsDoc
  }

  test("no dir, or nothing to book: no-ops that write nothing", async () => {
    await statsDigest(undefined, { priorKnowledge: 1000, prevRound: 2000, capped: true })
    await statsKnowledgePhase(undefined)
    await statsDigest(dir, {})
    await statsDigest(dir, { priorKnowledge: 0, prevRound: -5 })
    expect(await Bun.file(join(dir, ".auto", "stats.json")).exists()).toBe(false)
  })

  test("booked per digest kind into the three buckets; absent until booked; a size below 1 still counts the session-free cap", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await flushStats(dir)
    expect(await Bun.file(join(dir, ".auto", "stats.json")).text()).not.toContain('"digests"')
    await statsDigest(dir, { priorKnowledge: 12_000, prevRound: 41_000 })
    await statsDigest(dir, { priorKnowledge: 3_000, capped: true })
    await statsKnowledgePhase(dir)
    await statsKnowledgePhase(dir)
    await flushStats(dir)
    const doc = await readDoc()
    for (const bucket of [doc.taskB, doc.phaseB, doc.roundB]) {
      expect(bucket.digests).toEqual({
        priorKnowledge: { sessions: 2, tokens: 15_000 },
        prevRound: { sessions: 1, tokens: 41_000 },
        capped: 1,
        knowledgePhases: 2,
      })
    }
    expect((await statsTotals(dir, "round"))?.digests?.capped).toBe(1)
  })

  test("a capped digest alone (both sizes absent) books the cap counter", async () => {
    await loadStats(dir)
    await statsDigest(dir, { capped: true })
    await flushStats(dir)
    expect((await readDoc()).roundB.digests).toEqual({ capped: 1 })
  })

  test("a bad section parses as missing per field; round rollover merges the counters into history", async () => {
    await mkdir(join(dir, ".auto"), { recursive: true })
    await Bun.write(
      join(dir, ".auto", "stats.json"),
      JSON.stringify({
        v: 1,
        round: 1,
        phase: "m",
        lastWriteAt: 90_000,
        taskB: { id: "T-001", digests: "nope" },
        phaseB: { id: "m" },
        roundB: { id: "1", digests: { priorKnowledge: { sessions: 2, tokens: 900 }, prevRound: "bad", capped: 0, knowledgePhases: 1 } },
        sessions: {},
        history: { rounds: 1, totals: { digests: { prevRound: { sessions: 1, tokens: 400 }, capped: 2 } } },
      }),
    )
    await loadStats(dir)
    expect((await statsTotals(dir, "task"))?.digests).toBeUndefined()
    expect((await statsTotals(dir, "round"))?.digests).toEqual({ priorKnowledge: { sessions: 2, tokens: 900 }, knowledgePhases: 1 })
    await flushStats(dir)
    await mkdir(join(dir, "docs", "R-02"), { recursive: true })
    await loadStats(dir)
    expect((await statsHistory(dir))?.totals.digests).toEqual({
      priorKnowledge: { sessions: 2, tokens: 900 },
      prevRound: { sessions: 1, tokens: 400 },
      capped: 2,
      knowledgePhases: 1,
    })
    await flushStats(dir)
    expect((await readDoc()).roundB.digests).toBeUndefined()
  })

  test("the round conclusion gains one digest line only when a counter is non-zero", async () => {
    // No digest data: the block keeps its shape (byte-identical to the
    // pre-A7 conclusion).
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 5 * 60_000
    await statsSessionEnd(dir, "ses_1", usage({ input: 100, output: 30 }))
    const plain = await roundCompleteLines(dir)
    expect(plain).toHaveLength(2)
    expect(plain?.[0]).toBe("■ round 1 complete: total 5m 0s (AI 5m 0s), 1 tasks / 1 sessions")
    // Counters booked: one line after the tokens line, only the non-zero
    // parts, singular/plural like the model counters.
    await statsDigest(dir, { priorKnowledge: 12_000, prevRound: 41_000, capped: true })
    await statsKnowledgePhase(dir)
    const lines = await roundCompleteLines(dir)
    expect(lines?.[2]).toBe("  digests: prior knowledge 1 session / 12.0k tokens, previous round 1 session / 41.0k tokens, 1 capped, 1 knowledge phase")
    expect(lines).toHaveLength(3)
    // Only one kind booked: the absent one omits its part.
    await loadStats(join(dir, "empty"))
    await statsDigest(join(dir, "empty"), { prevRound: 41_000 })
    const one = await roundCompleteLines(join(dir, "empty"))
    expect(one?.[2]).toBe("  digests: previous round 1 session / 41.0k tokens")
  })
})

// The lane report's usage booking and the roll-up reader (plans/0068 D13,
// stage S4): a landed lane's figures book into the per-unit lanes section —
// the durable per-lane segments — and, when the report carried the usage
// detail, fold into the phase and round buckets so the conclusion's tokens
// line and per-model/per-tier lines keep working under the scheduler. Wall
// time never folds (lanes overlap; the buckets' clock is the parent's own),
// and the task bucket is never touched (the parent's task segment is its
// own sessions' caliber, and the landed unit is not necessarily the bucket's
// current id).
describe("stats lane usage booking (plans/0068 D13, S4)", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-stats-lane-"))
    now = 100_000
    installServices(createServices({ clock: fixedClock(() => now) }))
    await loadStats(dir)
  })

  afterEach(async () => {
    uninstallServices()
    await flushStats(dir).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  })

  // The document as it persists: the write queue drains through flushStats
  // (the clock is fixed and never advances here, so the flush's segment fold
  // books zero wall time — the wall assertions below stay exact).
  async function readDoc(): Promise<StatsDoc> {
    await flushStats(dir)
    return JSON.parse(await Bun.file(join(dir, ".auto", "stats.json")).text()) as StatsDoc
  }

  test("without detail: the per-unit lanes entry only, the buckets untouched, the roll-up unbooked", async () => {
    await statsTask(dir, "T-001")
    await statsLaneUsage(dir, "T-001", { tokens: 1200, wallMs: 34_000, sessions: 3 })
    const doc = await readDoc()
    expect(doc.lanes).toEqual<Record<string, LaneStat>>({ "T-001": { tokens: 1200, wallMs: 34_000, sessions: 3 } })
    expect(doc.taskB.usage.input).toBe(0)
    expect(doc.phaseB.usage.input).toBe(0)
    expect(doc.phaseB.sessions).toBe(0)
    expect(doc.roundB.usage.input).toBe(0)
    expect(await statsLaneRollup(dir)).toEqual({ lanes: 1, sessions: 3, tokens: 1200, wallMs: 34_000, booked: false })
  })

  test("with detail: the usage, sessions and per-model/per-tier sections fold into phase and round — never the task bucket, never wall time", async () => {
    await statsTask(dir, "T-001")
    await statsLaneUsage(dir, "T-001", {
      tokens: 1500,
      wallMs: 34_000,
      sessions: 2,
      detail: {
        usage: usage({ input: 1000, output: 500, cacheRead: 200, cost: 0.02 }),
        models: { glm: { usage: usage({ input: 1000, output: 500, cacheRead: 200, cost: 0.02 }), sessions: 2, fails: 1, stuckHints: 0, reprompts: 2, probeFails: 1, lengthContinuations: 0, stepUps: 3 } },
        tiers: { simple: { usage: usage({ input: 1000, output: 500, cacheRead: 200, cost: 0.02 }), sessions: 2 } },
      },
    })
    const doc = await readDoc()
    // The lanes entry carries the detail marker.
    expect(doc.lanes).toEqual<Record<string, LaneStat>>({ "T-001": { tokens: 1500, wallMs: 34_000, sessions: 2, booked: true } })
    // The task bucket is the parent's own segment: untouched.
    expect(doc.taskB.usage.input).toBe(0)
    expect(doc.taskB.sessions).toBe(0)
    expect(doc.taskB.models).toBeUndefined()
    // Phase and round gained the flat figures, the model record with its
    // drift counters, and the tier record — in parallel, as ever.
    for (const bucket of [doc.phaseB, doc.roundB]) {
      expect(bucket.usage).toEqual(usage({ input: 1000, output: 500, cacheRead: 200, cost: 0.02 }))
      expect(bucket.sessions).toBe(2)
      expect(bucket.models).toEqual({ glm: { usage: usage({ input: 1000, output: 500, cacheRead: 200, cost: 0.02 }), sessions: 2, fails: 1, stuckHints: 0, reprompts: 2, probeFails: 1, lengthContinuations: 0, stepUps: 3 } })
      expect(bucket.tiers).toEqual({ simple: { usage: usage({ input: 1000, output: 500, cacheRead: 200, cost: 0.02 }), sessions: 2 } })
      // Wall time never folds: the lane's 34s is a segment of the lanes
      // entry, not a duration of the parent's clock.
      expect(bucket.wallMs).toBe(0)
      expect(bucket.aiMs).toBe(0)
    }
    expect(await statsLaneRollup(dir)).toEqual({ lanes: 1, sessions: 2, tokens: 1500, wallMs: 34_000, booked: true })
  })

  test("a re-dispatched unit accumulates into the same entry; two lanes sum in the roll-up; the persisted shape survives a round trip", async () => {
    await statsLaneUsage(dir, "T-001", { tokens: 100, wallMs: 1000, sessions: 1 })
    await statsLaneUsage(dir, "T-001", { tokens: 50, wallMs: 500, sessions: 1 })
    await statsLaneUsage(dir, "T-002", { tokens: 70, wallMs: 700, sessions: 2, detail: { usage: usage({ input: 70 }) } })
    expect((await readDoc()).lanes).toEqual<Record<string, LaneStat>>({
      "T-001": { tokens: 150, wallMs: 1500, sessions: 2 },
      "T-002": { tokens: 70, wallMs: 700, sessions: 2, booked: true },
    })
    // A mixed roll-up (one report without detail) makes no "inside the
    // totals" claim — only every entry booked does.
    expect(await statsLaneRollup(dir)).toEqual({ lanes: 2, sessions: 4, tokens: 220, wallMs: 2200, booked: false })
    await flushStats(dir)
    await loadStats(dir)
    expect((await readDoc()).lanes?.["T-002"]).toEqual<LaneStat>({ tokens: 70, wallMs: 700, sessions: 2, booked: true })
  })

  test("no lanes section: the roll-up reader answers undefined (the conclusion keeps its shape)", async () => {
    expect(await statsLaneRollup(dir)).toBeUndefined()
    expect((await readDoc()).lanes).toBeUndefined()
  })
})
