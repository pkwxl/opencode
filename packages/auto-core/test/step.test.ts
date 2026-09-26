import { describe, expect, test, afterEach, beforeEach } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough, Writable } from "node:stream"
import type { Interactive } from "../src/interactive"
import {
  flushStats,
  loadStats,
  setStatsClock,
  statsSessionBegin,
  statsSessionEnd,
  statsTask,
  statsTotals,
} from "../src/stats"
import { stepApplies, stepPause } from "../src/step"
import type { StepMode } from "../src/switches"

describe("stepApplies (inclusive granularity check)", () => {
  const cases: Array<[StepMode, Array<["phase" | "task" | "subtask", boolean]>]> = [
    ["off", [["phase", false], ["task", false], ["subtask", false]]],
    ["phase", [["phase", true], ["task", false], ["subtask", false]]],
    ["task", [["phase", true], ["task", true], ["subtask", false]]],
    ["subtask", [["phase", true], ["task", true], ["subtask", true]]],
  ]
  for (const [step, boundaries] of cases) {
    test(`step=${step}: ${boundaries.filter(([, hit]) => hit).map(([b]) => b).join("+") || "no pauses at all"}`, () => {
      for (const [boundary, hit] of boundaries) expect(stepApplies(step, boundary)).toBe(hit)
    })
  }
})

// Drive the pausing readline with injected streams; the explicit step override
// tests the IO directly (no reliance on autoSwitches' memo), and off is passed
// explicitly too, keeping the test hermetic (unaffected by ambient
// environment variables).
function setup() {
  const input = new PassThrough()
  const chunks: string[] = []
  const output = new Writable({ write: (chunk, _enc, cb) => void chunks.push(chunk.toString()) })
  return { input, io: { input, output }, written: () => chunks.join("") }
}

describe("stepPause (hard pause wait)", () => {
  test("off (default level): zero behavior, returns immediately, never touches stdin", async () => {
    const ctx = setup()
    await stepPause("subtask", "T-001 subtask 1", { io: ctx.io, step: "off" })
    expect(ctx.written()).toBe("")
  })

  test("boundary hit: waits for Enter to proceed; the prompt carries the level and label", async () => {
    const ctx = setup()
    const paused = stepPause("task", "T-001 sample task", { io: ctx.io, step: "subtask" })
    ctx.input.write("\n")
    await paused
    expect(ctx.written()).toContain("step=subtask")
    expect(ctx.written()).toContain("T-001 sample task")
  })

  test("any input line (non-empty) also proceeds", async () => {
    const ctx = setup()
    const paused = stepPause("phase", "phase m implementation handover", { io: ctx.io, step: "phase" })
    ctx.input.write("continue\n")
    await expect(paused).resolves.toBeUndefined()
  })

  test("stdin closed (pipe end): falls back to auto-proceeding, no hang", async () => {
    const ctx = setup()
    const paused = stepPause("task", "T-001 sample task", { io: ctx.io, step: "task" })
    ctx.input.end()
    await expect(paused).resolves.toBeUndefined()
  })

  test("interactive resident input line: the prompt text is passed through; an answer proceeds", async () => {
    const questions: string[] = []
    const interactive = {
      attach: () => {},
      question: async (promptText: string) => {
        questions.push(promptText)
        return ""
      },
      close: () => {},
    } as unknown as Interactive
    await stepPause("subtask", "T-001 subtask 2", { interactive, step: "subtask" })
    expect(questions).toEqual([`⏸ step pause (step=subtask): T-001 subtask 2 done, press Enter to continue: `])
    // A boundary the level does not cover (zero behavior under interactive as
    // well): task does not cover subtask.
    await stepPause("subtask", "T-001 subtask 3", { interactive, step: "task" })
    expect(questions).toHaveLength(1)
  })
})

// T-005 wiring coverage: when stepPause gets dir, the paused interval is
// deducted from total/AI elapsed via statsWaitBegin/End and recorded
// separately as waitMs (the module-level deduction criteria live in
// stats.test.ts; this only verifies the hook-point wiring).
describe("stepPause wait deduction (stats wiring)", () => {
  let dir: string
  let now: number

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "auto-step-stats-"))
    now = 100_000
    setStatsClock(() => now)
  })

  afterEach(async () => {
    setStatsClock()
    await flushStats(dir).catch(() => {})
    await rm(dir, { recursive: true, force: true })
  })

  // Wait until the prompt is actually written (readline established,
  // statsWaitBegin completed) before advancing the clock to answer, keeping
  // the wait interval entirely inside the injected clock's controlled span.
  async function untilPrompt(written: () => string) {
    for (let i = 0; i < 100 && !written().includes("press Enter to continue"); i++) {
      await new Promise((resolve) => setImmediate(resolve))
    }
  }

  test("in-session pause: the wait stays out of aiMs/wallMs and is recorded separately as waitMs; per-session wallMs includes the wait", async () => {
    const ctx = setup()
    await loadStats(dir)
    await statsTask(dir, "T-001")
    await statsSessionBegin(dir, "T-001")
    now += 3000 // AI active 3s
    const paused = stepPause("subtask", "T-001 subtask 1", { io: ctx.io, step: "subtask", dir })
    await untilPrompt(ctx.written)
    now += 4000 // human wait 4s
    ctx.input.write("\n")
    await paused
    now += 2000 // AI active again 2s
    const report = await statsSessionEnd(dir, "s1", { input: 1, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 1 })
    expect(report?.thisAiMs).toBe(5000) // 3000 + 2000; the 4000 wait excluded
    expect(report?.session.wallMs).toBe(9000) // per-session wallMs = aiMs + waitMs
    const totals = await statsTotals(dir, "task")
    expect(totals?.aiMs).toBe(5000)
    expect(totals?.wallMs).toBe(5000) // the three buckets' wallMs excludes pure human waiting
    expect(totals?.waitMs).toBe(4000)
  })

  test("the interactive path is wrapped the same way; off's zero behavior touches stats zero times", async () => {
    const interactive = {
      attach: () => {},
      question: async () => {
        now += 2500 // human wait 2.5s
        return ""
      },
      close: () => {},
    } as unknown as Interactive
    await loadStats(dir)
    await stepPause("task", "T-001 sample task", { interactive, step: "off", dir }) // off: zero behavior
    now += 1000
    await stepPause("task", "T-001 sample task", { interactive, step: "task", dir })
    const totals = await statsTotals(dir, "task")
    expect(totals?.waitMs).toBe(2500)
    expect(totals?.wallMs).toBe(1000) // the 1s off spent unpause + the 2.5s wait already deducted
  })
})
