import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServices, installServices, uninstallServices } from "../src/services"
import { taskDoc } from "../src/docpaths"
import {
  phaseCloseLines,
  phaseResolveLines,
  roundCompleteLines,
  roundResolveLines,
  taskEndLines,
  taskResolveLines,
} from "../src/conclusion"
import { recordDecisions, recordResolves, type ResolveItem } from "../src/resolve"
import {
  flushStats,
  loadStats,
  statsClassifyUsage,
  statsHistory,
  statsLaneUsage,
  statsModelEvent,
  statsPhase,
  statsQuotaWait,
  statsSessionBegin,
  statsSessionEnd,
  statsTask,
  statsWaitBegin,
  statsWaitEnd,
  type Usage,
} from "../src/stats"
import { fixedClock } from "./fixtures/clock"
import type { PhaseUnit } from "../src/phases"
import { phaseTypeOfLetter, type PhaseLetter } from "../src/phases/registry"

// A phase unit of round R-01 (qualified id R-01.<id>) for a builtin letter.
function unit(letter: PhaseLetter, id = "P01"): PhaseUnit {
  const entry = phaseTypeOfLetter(letter)
  return { round: "R-01", id, type: entry.type, entry, dir: `docs/R-01/${id}-${entry.type}` }
}

// T-006: message construction for the task three-state lines / phase close-out
// lines / round-complete lines (plans/STATS_PLAN.md §4.2/4.3/4.4) — inject a
// stats handle (loadStats + an injected clock) and drive loop.ts's three
// message builders directly, asserting copy, omission rules and guards. The
// call-site wiring inside the loop body (covered by typecheck) is not re-faked
// here with a whole runAll chain.

function usage(partial: Partial<Usage>): Usage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 1, ...partial }
}

describe("taskEndLines task-end three-state lines", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-conclusion-"))
    now = 1_000_000
    installServices(createServices({ clock: fixedClock(() => now) }))
  })

  afterEach(async () => {
    uninstallServices()
    await flushStats(dir).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  })

  test("statsId guard: unloaded or a mismatched bucket identity returns undefined (the caller falls back to the old copy)", async () => {
    // no loaded handle
    expect(await taskEndLines(dir, "T-001")).toBeUndefined()
    // the bucket identity is another task
    await loadStats(dir)
    await statsTask(dir, "T-999")
    expect(await taskEndLines(dir, "T-001")).toBeUndefined()
  })

  test("no interruption: cumulative-basis output without a \"this process\" part (this process == cumulative, copy equivalent to the status quo)", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-003")
    // Two sessions: 18m 12s AI (the wall-clock segment of 6m 19s tops it up
    // to 24m 31s).
    await statsSessionBegin(dir, "T-003")
    now += 10 * 60_000
    await statsSessionEnd(dir, "ses_1", usage({ input: 1200, output: 340, cacheRead: 28_400, cacheWrite: 3100, cost: 0.041 }))
    now += 6 * 60_000 + 19_000 // wall clock between sessions
    await statsSessionBegin(dir, "T-003")
    now += 8 * 60_000 + 12_000
    await statsSessionEnd(dir, "ses_2", usage({ input: 800, output: 100 }))
    const lines = await taskEndLines(dir, "T-003")
    expect(lines).toEqual([
      "elapsed 24m 31s (AI 18m 12s), 2 sessions",
      "tokens in 2000 / out 440 / cache-read 28.4k / cache-write 3100, hit 93.4%, cost $0.041",
    ])
  })

  test("resumed across an interruption: the cumulative includes the pre-interruption part; the \"this process\" part appears once this process ≠ cumulative", async () => {
    // First "process": graceful close-out after 18 minutes.
    await loadStats(dir)
    await statsTask(dir, "T-003")
    now += 18 * 60_000
    await flushStats(dir)
    // Second "process": resumes the same task (same id is idempotent, bucket
    // not reset) and runs 6 more minutes.
    await loadStats(dir)
    await statsTask(dir, "T-003")
    now += 6 * 60_000
    const lines = await taskEndLines(dir, "T-003")
    expect(lines?.[0]).toBe("elapsed 24m 0s (AI 0s, this process 6m 0s), 0 sessions")
  })
})

describe("phaseCloseLines phase close-out lines", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-phase-"))
    now = 1_000_000
    installServices(createServices({ clock: fixedClock(() => now) }))
    await loadStats(dir)
  })

  afterEach(async () => {
    uninstallServices()
    await flushStats(dir).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  })

  test("full basis: total time (incl. plan/handover/commit; AI, human wait), N tasks / M sessions + tokens line", async () => {
    await statsPhase(dir, "R-01.P01")
    // Two tasks (statsTask counts 1 each), three sessions (the bypass one
    // included, all into the phase bucket), one human wait.
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 20 * 60_000
    await statsSessionEnd(dir, "ses_1", usage({ input: 5000, output: 1200, cacheRead: 90_000, cost: 0.31 }))
    await statsTask(dir, "T-002")
    await statsSessionBegin(dir, "T-002")
    now += 21 * 60_000
    await statsSessionEnd(dir, "ses_2", usage({ input: 4000, output: 800 }))
    await statsWaitBegin(dir, "stepPause:phase")
    now += 3 * 60_000
    await statsWaitEnd(dir)
    // Handover-distillation bypass session (pseudo task PLAN).
    await statsSessionBegin(dir, "PLAN")
    now += 60_000
    await statsSessionEnd(dir, "ses_3", usage({ output: 200 }))
    now += 8 * 60_000 // driver wall clock for archive/ledger/commit and the like
    // Total 50m = 20+21+1 (AI segments) + 8 (driver wall clock); the 3m human
    // wait is deducted from the total and booked alone as waitMs (basis
    // confirmed in STATS_PLAN: the total excludes pure human waits).
    const lines = await phaseCloseLines(dir, unit("t"))
    expect(lines).toEqual([
      "■ phase P01-test Testing closed: total 50m 0s (incl. plan/handover/commit; AI 42m 0s, human wait 3m 0s), 2 tasks / 3 sessions",
      "tokens in 9000 / out 2200 / cache-read 90.0k / cache-write 0, hit 90.9%, cost $0.31",
    ])
  })

  test("omission and guard: waitMs=0 omits the human-wait part; a mismatched bucket id (phase already switched) returns undefined", async () => {
    await statsPhase(dir, "R-01.P01")
    await statsTask(dir, "T-001")
    now += 5 * 60_000
    const lines = await phaseCloseLines(dir, unit("t"))
    expect(lines?.[0]).toBe("■ phase P01-test Testing closed: total 5m 0s (incl. plan/handover/commit; AI 0s), 1 tasks / 0 sessions")
    expect(lines?.[0]).not.toContain("human wait")
    // After switching to the next phase the old phase's close line is no longer trustworthy (bucket reset)
    await statsPhase(dir, "R-01.P02")
    expect(await phaseCloseLines(dir, unit("t"))).toBeUndefined()
  })
})

describe("roundCompleteLines round-complete lines", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-round-"))
    now = 1_000_000
    installServices(createServices({ clock: fixedClock(() => now) }))
  })

  afterEach(async () => {
    uninstallServices()
    await flushStats(dir).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  })

  test("this round's summary: the phase part appears when phaseCount is given and is omitted by default; history.rounds=0 means no prior-rounds part", async () => {
    await loadStats(dir)
    await statsPhase(dir, "m")
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 30 * 60_000
    await statsSessionEnd(dir, "ses_1", usage({ input: 2000, output: 500, cacheRead: 18_000, cost: 0.12 }))
    now += 22 * 60_000
    // Phased path (the caller reads the phase count from its records)
    const phased = await roundCompleteLines(dir, { phaseCount: 6 })
    expect(phased).toEqual([
      "■ round 1 complete: total 52m 0s (AI 30m 0s), 6 phases / 1 tasks / 1 sessions",
      "tokens in 2000 / out 500 / cache-read 18.0k / cache-write 0, hit 90.0%, cost $0.12",
    ])
    // Non-phased path (the m-phase summary, no phase part)
    const plain = await roundCompleteLines(dir)
    expect(plain?.[0]).toBe("■ round 1 complete: total 52m 0s (AI 30m 0s), 1 tasks / 1 sessions")
    expect(plain).toHaveLength(2)
  })

  test("cumulative over prior rounds: once a round rolls into history, two prior-rounds lines are appended", async () => {
    // Round 1: 40m, 1 task, 2 sessions.
    await loadStats(dir)
    await statsPhase(dir, "m")
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 30 * 60_000
    await statsSessionEnd(dir, "ses_1", usage({ input: 1000, output: 200, cost: 0.1 }))
    await statsSessionBegin(dir, "T-001")
    now += 10 * 60_000
    await statsSessionEnd(dir, "ses_2", usage({ input: 1000, output: 200, cost: 0.1 }))
    await flushStats(dir)
    // Enter round 2 (docs/R-02 exists → currentRound = 2): on load round 1
    // rolls into history.
    await mkdir(join(dir, "docs", "R-02"), { recursive: true })
    await loadStats(dir)
    expect((await statsHistory(dir))?.rounds).toBe(1)
    // Round 2: 20m, 1 task, 1 session.
    await statsPhase(dir, "m")
    await statsTask(dir, "T-002")
    await statsSessionBegin(dir, "T-002")
    now += 20 * 60_000
    await statsSessionEnd(dir, "ses_3", usage({ input: 500, output: 100, cost: 0.05 }))
    const lines = await roundCompleteLines(dir, { phaseCount: 5 })
    expect(lines).toEqual([
      "■ round 2 complete: total 20m 0s (AI 20m 0s), 5 phases / 1 tasks / 1 sessions",
      "tokens in 500 / out 100 / cache-read 0 / cache-write 0, hit 0.0%, cost $0.05",
      "  cumulative (1 rounds): total 40m 0s (AI 40m 0s), 1 tasks / 2 sessions",
      "  cumulative tokens in 2000 / out 400 / cache-read 0 / cache-write 0, hit 0.0%, cost $0.2",
    ])
  })

  test("dir undefined / not loaded: no-op returns undefined, nothing written", async () => {
    expect(await roundCompleteLines(undefined)).toBeUndefined()
    expect(await taskEndLines(undefined, "T-001")).toBeUndefined()
    expect(await phaseCloseLines(undefined, unit("m"))).toBeUndefined()
    expect(await Bun.file(join(dir, ".auto", "stats.json")).exists()).toBe(false)
  })
})

// Per-model lines of the round-complete block (plans/0055 §7.1 "Stats", §10
// item 12): with model data booked alongside the sessions the block
// gains one line per model — usage, sessions and the protocol-drift counters
// of §10 item 3 — plus the per-tier summary. Without model data the block
// stays at its two lines.
describe("roundCompleteLines per-model lines", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-round-models-"))
    now = 1_000_000
    installServices(createServices({ clock: fixedClock(() => now) }))
  })

  afterEach(async () => {
    uninstallServices()
    await flushStats(dir).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  })

  test("per-model lines and the per-tier summary under model data", async () => {
    await loadStats(dir)
    await statsPhase(dir, "m")
    await statsTask(dir, "T-001")
    // Two routed sessions (a simple and a deep one), one FAIL verdict, one
    // stuck hint, two shape re-prompts on glm, and one classifier call.
    await statsSessionBegin(dir, "T-001")
    now += 30 * 60_000
    await statsSessionEnd(dir, "ses_1", usage({ input: 2000, output: 500, cacheRead: 18_000, cost: 0.12 }), "glm", "simple")
    await statsSessionBegin(dir, "T-001")
    now += 10 * 60_000
    await statsSessionEnd(dir, "ses_2", usage({ input: 1000, output: 200, cost: 0.08 }), "opus", "deep")
    await statsModelEvent(dir, "glm", "fail")
    await statsModelEvent(dir, "glm", "stuck")
    await statsModelEvent(dir, "glm", "reprompt")
    await statsModelEvent(dir, "glm", "reprompt")
    await statsClassifyUsage(dir, usage({ input: 300, output: 20 }))
    now += 2 * 60_000
    const lines = await roundCompleteLines(dir)
    expect(lines).toEqual([
      "■ round 1 complete: total 42m 0s (AI 40m 0s), 1 tasks / 2 sessions",
      "tokens in 3000 / out 700 / cache-read 18.0k / cache-write 0, hit 85.7%, cost $0.2",
      "  model classify: 1 sessions, tokens in 300 / out 20 / cache-read 0 / cache-write 0, hit 0.0%",
      "  model glm: 1 sessions, tokens in 2000 / out 500 / cache-read 18.0k / cache-write 0, hit 90.0%, cost $0.12, 1 FAIL verdict, 1 stuck hint, 2 shape re-prompts",
      "  model opus: 1 sessions, tokens in 1000 / out 200 / cache-read 0 / cache-write 0, hit 0.0%, cost $0.08",
      "  tiers: deep 1 sessions, tokens in 1000 / out 200 / cache-read 0 / cache-write 0, hit 0.0%, cost $0.08; simple 1 sessions, tokens in 2000 / out 500 / cache-read 18.0k / cache-write 0, hit 90.0%, cost $0.12",
    ])
  })

  test("counters at zero omit their items; a model without counters stays on one line", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 5 * 60_000
    await statsSessionEnd(dir, "ses_1", usage({ input: 100, output: 30 }), "glm", "simple")
    const lines = await roundCompleteLines(dir)
    expect(lines?.[2]).toBe("  model glm: 1 sessions, tokens in 100 / out 30 / cache-read 0 / cache-write 0, hit 0.0%")
    expect(lines?.[3]).toBe("  tiers: simple 1 sessions, tokens in 100 / out 30 / cache-read 0 / cache-write 0, hit 0.0%")
    expect(lines).toHaveLength(4)
  })

  test("time lost to quota windows: one line, names sorted, the figure unclamped where the wait segment clamps (plans/0057 §11 item 7)", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 5 * 60_000
    await statsSessionEnd(dir, "ses_1", usage({ input: 100, output: 30 }))
    // A recovery wait slept to a five-hour window's reset: the generic wait
    // segment clamps at MAX_TICK, the quota figure keeps the planned sleep.
    await statsWaitBegin(dir, "recovery")
    now += 3 * 3_600_000 + 5 * 60_000
    await statsWaitEnd(dir)
    await statsQuotaWait(dir, "fake/model-1", 3 * 3_600_000 + 5 * 60_000)
    await statsQuotaWait(dir, "glm", 90_000)
    const lines = await roundCompleteLines(dir)
    expect(lines?.[0]).toContain("human wait 30m 0s")
    expect(lines?.[2]).toBe("  time lost to quota windows: fake/model-1 3h 5m; glm 1m 30s")
    expect(lines).toHaveLength(3)
  })

  test("no model data: the block stays at its two lines", async () => {
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 30 * 60_000
    await statsSessionEnd(dir, "ses_1", usage({ input: 2000, output: 500, cacheRead: 18_000, cost: 0.12 }))
    const lines = await roundCompleteLines(dir)
    expect(lines).toEqual([
      "■ round 1 complete: total 30m 0s (AI 30m 0s), 1 tasks / 1 sessions",
      "tokens in 2000 / out 500 / cache-read 18.0k / cache-write 0, hit 90.0%, cost $0.12",
    ])
  })
})

// ===== Proxy-answer highlight blocks (plans/0020-auto-resolve-design.md §H,
// T-006's H5/H6) =====
// The ledger is seeded directly via recordResolves/recordDecisions (no runner
// wiring — that is T-005's coverage), asserting the three builders' highlight
// copy, driver↔agent merging, folded counts and no-ops.
describe("proxy-answer highlight blocks taskResolveLines / phaseResolveLines / roundResolveLines", () => {
  let dir: string

  const item = (partial: Partial<ResolveItem> & { question: string }): ResolveItem => ({
    at: 1_000_000,
    task: "T-001",
    phase: "R-01.P01",
    round: 1,
    source: "agent",
    ...partial,
  })

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-resolve-lines-"))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("no proxy answers: all three return an empty array, taking no space", async () => {
    expect(await taskResolveLines(dir, "T-001")).toEqual([])
    expect(await phaseResolveLines(dir, unit("m"))).toEqual([])
    expect(await roundResolveLines(dir)).toEqual([])
  })

  test("dir undefined: no-op returns an empty array, nothing written", async () => {
    expect(await taskResolveLines(undefined, "T-001")).toEqual([])
    expect(await phaseResolveLines(undefined, unit("m"))).toEqual([])
    expect(await roundResolveLines(undefined)).toEqual([])
    expect(await Bun.file(join(dir, ".auto", "resolves.json")).exists()).toBe(false)
  })

  test("task highlight block: per-item listing + marker location + full-record pointer", async () => {
    await recordResolves(dir, [
      item({
        question: "should the third formatTokens copy in prompt.ts be folded in too",
        option: "fold it in",
        reason: "same layer, no reverse import",
        file: "src/prompt.ts:501",
      }),
      item({ question: "is depreciation booking also clamped by MAX_TICK", option: "clamped the same way", reason: "undercount rather than overcount" }),
    ])
    expect(await taskResolveLines(dir, "T-001")).toEqual([
      "⚑ this task auto-answered 2 questions that should have been confirmed by you; please review:",
      "  1. should the third formatTokens copy in prompt.ts be folded in too → fold it in(same layer, no reverse import)",
      "     src/prompt.ts:501",
      "  2. is depreciation booking also clamped by MAX_TICK → clamped the same way(undercount rather than overcount)",
      `  full record in the "Proxy-answered questions" section of ${taskDoc("T-001", "report")}`,
    ])
  })

  test("unpaired driver items are called out with ⚠; paired ones are replaced by the fuller agent item", async () => {
    await recordResolves(dir, [
      item({ source: "driver", question: "does the acceptance basis include concurrency", session: "ses_1" }),
      item({ source: "driver", question: "is depreciation booking also clamped by MAX_TICK", session: "ses_1", matched: true }),
      item({ question: "is depreciation booking also clamped by MAX_TICK", option: "clamped the same way", reason: "undercount rather than overcount" }),
    ])
    const lines = await taskResolveLines(dir, "T-001")
    expect(lines[0]).toBe("⚑ this task auto-answered 2 questions that should have been confirmed by you; please review:")
    expect(lines[1]).toBe("  1. does the acceptance basis include concurrency  ⚠ session did not write the AUTO-RESOLVE marker as required")
    expect(lines[2]).toBe("  2. is depreciation booking also clamped by MAX_TICK → clamped the same way(undercount rather than overcount)")
  })

  test("the AUTO-DECISION count folds into the last line; with no proxy answers the whole block is empty (the count never reaches the terminal)", async () => {
    await recordDecisions(dir, "T-001", 2)
    await recordDecisions(dir, "T-001", 3)
    // Only AUTO-DECISION and no proxy answers → an empty block (the count
    // already went to the vlog at session close-out, §H-④).
    expect(await taskResolveLines(dir, "T-001")).toEqual([])
    await recordResolves(dir, [item({ question: "should this task's scope be narrowed", option: "no", reason: "the plan already fixes it" })])
    const lines = await taskResolveLines(dir, "T-001")
    expect(lines.at(-1)).toBe("  plus 5 AUTO-DECISION entries (folded, see task report)")
  })

  test("over 8 items truncates to the first 8 + N more", async () => {
    await recordResolves(
      dir,
      Array.from({ length: 10 }, (_, i) => item({ question: `question ${i + 1}`, option: "option", reason: "reason" })),
    )
    const lines = await taskResolveLines(dir, "T-001")
    expect(lines[1]).toBe("  1. question 1 → option(reason)")
    expect(lines[8]).toBe("  8. question 8 → option(reason)")
    expect(lines.at(-1)).toBe(`  …and 2 more, all in ${taskDoc("T-001", "report")}`)
  })

  test("phase/round summaries: counts and the unmarked count only, AUTO-DECISION not shown", async () => {
    await recordResolves(dir, [
      item({ task: "T-001", question: "question A", option: "option", reason: "reason" }),
      item({ task: "T-002", question: "question B", option: "option", reason: "reason" }),
      item({ task: "T-002", source: "driver", question: "question C" }),
    ])
    await recordDecisions(dir, "T-001", 9)
    expect(await phaseResolveLines(dir, unit("m"))).toEqual([
      "⚑ phase P01-implement: 3 questions awaiting confirmation were auto-answered (1 not marked as required); see task reports for details",
    ])
    // The round number is looked up from currentRound on the spot: with no
    // docs/R-NN directory it is round 1, same source as the recording side.
    expect(await roundResolveLines(dir)).toEqual([
      "⚑ round 1: 3 questions awaiting confirmation were auto-answered (1 not marked as required); see task reports for details",
    ])
  })

  test("bucket-identity filtering: items of other tasks/phases/rounds do not cross-talk", async () => {
    await recordResolves(dir, [
      item({ task: "T-001", phase: "R-01.P01", round: 1, question: "this bucket's question", option: "option", reason: "reason" }),
      item({ task: "T-002", phase: "R-02.P01", round: 2, question: "another bucket's question", option: "option", reason: "reason" }),
    ])
    expect(await taskResolveLines(dir, "T-002")).toHaveLength(3)
    expect((await phaseResolveLines(dir, unit("m")))[0]).toContain("1 questions awaiting confirmation were auto-answered")
    expect((await roundResolveLines(dir))[0]).toContain("1 questions awaiting confirmation were auto-answered")
  })

  test("corrupt ledger: swallowed into an empty block, flow unaffected", async () => {
    await mkdir(join(dir, ".auto"), { recursive: true })
    await Bun.write(join(dir, ".auto", "resolves.json"), "{ corrupt file")
    expect(await taskResolveLines(dir, "T-001")).toEqual([])
    expect(await phaseResolveLines(dir, unit("m"))).toEqual([])
    expect(await roundResolveLines(dir)).toEqual([])
  })
})

// The lanes roll-up line of the round-complete block (plans/0068 D13, S4,
// §10): a round that landed lanes gains one line after the tokens line — the
// lane count, their summed sessions and tokens with the claim that names
// where they sit (inside the totals when every report carried the usage
// detail), the summed lane wall, and the parent-wall note the design asks
// for. Without lanes the block keeps its exact prior shape.
describe("roundCompleteLines lanes roll-up (plans/0068 D13, S4)", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-round-lanes-"))
    now = 1_000_000
    installServices(createServices({ clock: fixedClock(() => now) }))
    await loadStats(dir)
  })

  afterEach(async () => {
    uninstallServices()
    await flushStats(dir).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  })

  test("a landed lane with detail: the roll-up line follows the tokens line, claims the totals include it, and notes parent-wall", async () => {
    await statsPhase(dir, "m")
    await statsTask(dir, "T-001")
    // The parent's own session: 5 minutes, on glm.
    await statsSessionBegin(dir, "T-001")
    now += 5 * 60_000
    await statsSessionEnd(dir, "ses_1", usage({ input: 1000, output: 200, cost: 0.05 }), "glm", "simple")
    // The landed lane's report: 3 minutes of lane wall, 2 sessions on opus,
    // booked with its usage detail (the dispatch's statsTask switched the
    // task bucket to the lane's unit — the landing books the phase/round
    // roll-up, and the lane wall is a segment, never bucket time).
    await statsTask(dir, "T-002")
    await statsLaneUsage(dir, "T-002", {
      tokens: 900,
      wallMs: 3 * 60_000,
      sessions: 2,
      detail: {
        usage: usage({ input: 700, output: 200, cost: 0.03 }),
        models: { opus: { usage: usage({ input: 700, output: 200, cost: 0.03 }), sessions: 2, fails: 0, stuckHints: 0, reprompts: 0 } },
        tiers: { simple: { usage: usage({ input: 700, output: 200, cost: 0.03 }), sessions: 2 } },
      },
    })
    const lines = await roundCompleteLines(dir)
    expect(lines).toEqual([
      // The lane's 2 sessions ride the round total; its 3 minutes do not —
      // the time lines mean parent-wall.
      "■ round 1 complete: total 5m 0s (AI 5m 0s), 2 tasks / 3 sessions",
      "tokens in 1700 / out 400 / cache-read 0 / cache-write 0, hit 0.0%, cost $0.08",
      "  lanes: 1 landed / 2 sessions / 900 tokens (booked into the totals above); lane wall 3m 0s summed — lanes overlap, the time lines mean parent-wall",
      "  model glm: 1 sessions, tokens in 1000 / out 200 / cache-read 0 / cache-write 0, hit 0.0%, cost $0.05",
      "  model opus: 2 sessions, tokens in 700 / out 200 / cache-read 0 / cache-write 0, hit 0.0%, cost $0.03",
      "  tiers: simple 3 sessions, tokens in 1700 / out 400 / cache-read 0 / cache-write 0, hit 0.0%, cost $0.08",
    ])
  })

  test("a landed lane without detail (an older-shaped report): the line makes no totals claim; one lane session reads singular", async () => {
    await statsTask(dir, "T-001")
    await statsLaneUsage(dir, "T-001", { tokens: 1200, wallMs: 90_000, sessions: 1 })
    const lines = await roundCompleteLines(dir)
    expect(lines?.[2]).toBe("  lanes: 1 landed / 1 session / 1200 tokens; lane wall 1m 30s summed — lanes overlap, the time lines mean parent-wall")
    expect(lines).toHaveLength(3)
  })

  test("no lanes: the block keeps its exact prior shape", async () => {
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 30_000
    await statsSessionEnd(dir, "ses_1", usage({ input: 100, output: 30 }))
    const lines = await roundCompleteLines(dir)
    expect(lines).toHaveLength(2)
    expect(lines?.[1]).not.toContain("lanes:")
  })
})
