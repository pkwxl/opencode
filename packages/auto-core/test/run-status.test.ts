// The driver-status emitter's suite (P2b, plans/0067 and its review): the
// seam itself (an unstarted emitter is a no-op; a started one brackets the
// run and appends the journal — observed through the journal itself, the
// daemon's own transport), the question lifecycle's ordering through the
// questions concern (the routing seam the emitter hangs on), the
// SERVICE_ENTRIES length ratchet (the emitter is the log.ts
// setter-injection family's shape, never a services member). The journal's
// end-to-end acceptance — one whole run's typed events, no prose parsed —
// rode the push loop's run and retired with it (plans/0314); no live path
// writes a run bracket today (auto-server's observe routes still read the
// journal — plans/0256's standing journals decision).
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { questionsConcern } from "../src/engine/concerns/questions"
import { emitStatus, endRunStatus, RUN_STATUS_FILE, startRunStatus, stopRunStatus } from "../src/run-status"
import { RUN_STATUS_EVENT_TYPES, type RunStatusEvent } from "../src/run-status-schema"
import { SERVICE_ENTRIES } from "../src/services"
import { defaultTurn, ev } from "./fixtures/agent"
import { fakeTurnFx, turnContext, viewOver } from "./fixtures/turn"

// The journal's parsed lines (the observation channel — the same stream the
// daemon's SSE tail reads; a line's 1-based position is its id).
const journalOf = (dir: string): RunStatusEvent[] =>
  readFileSync(join(dir, RUN_STATUS_FILE), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RunStatusEvent)

// —— the seam itself ——

describe("the emitter (start/bracket/journal)", () => {
  test("an unstarted emitter is a no-op: no file, no throw", async () => {
    const dir = await mkdtemp(join(tmpdir(), "run-status-unstarted-"))
    try {
      expect(() => emitStatus({ type: "failure", message: "x" })).not.toThrow()
      expect(existsSync(join(dir, RUN_STATUS_FILE))).toBe(false)
    } finally {
      stopRunStatus()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("start brackets the run: run-start is line 1, end closes with the run roll-up then run-end", async () => {
    const dir = await mkdtemp(join(tmpdir(), "run-status-bracket-"))
    try {
      startRunStatus(dir)
      endRunStatus(0)
      const events = journalOf(dir)
      expect(events.map((event) => event.type)).toEqual(["run-start", "usage-rollup", "run-end"])
      // The join key: the run-start's instant is the run id every later
      // event echoes, and run-end carries the code it closed with.
      const run = events[0]!.run
      expect(events[0]!.at).toBe(run)
      expect(events[0]).toMatchObject({ type: "run-start", directory: dir })
      expect(events.at(-1)).toEqual({ type: "run-end", run, at: events.at(-1)!.at, code: 0 })
      // endRunStatus is idempotent within a run.
      endRunStatus(1)
      expect(journalOf(dir)).toHaveLength(3)
    } finally {
      stopRunStatus()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a second start rotates the journal — one run's file holds exactly that run's events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "run-status-rotate-"))
    try {
      startRunStatus(dir)
      emitStatus({ type: "task-start", task: "T-001" })
      endRunStatus(0)
      const first = journalOf(dir)
      expect(first.filter((event) => event.type === "task-start")).toHaveLength(1)
      startRunStatus(dir)
      const events = journalOf(dir)
      expect(events.map((event) => event.type)).toEqual(["run-start"])
      // The new run's join key is a fresh instant.
      expect(events.at(-1)!.run).toBeGreaterThanOrEqual(first[0]!.run)
    } finally {
      stopRunStatus()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the run roll-up totals the session roll-ups; every journaled line is a vocabulary member", async () => {
    const dir = await mkdtemp(join(tmpdir(), "run-status-rollup-"))
    try {
      startRunStatus(dir)
      const usage = { input: 100, output: 20, reasoning: 0, cacheRead: 5, cacheWrite: 0, cost: 0.01, steps: 2 }
      emitStatus({ type: "usage-rollup", scope: "session", usage, session: "ses_1" })
      emitStatus({ type: "usage-rollup", scope: "session", usage, session: "ses_2" })
      endRunStatus(2)
      const events = journalOf(dir)
      const rollup = events.find((event) => event.type === "usage-rollup" && event.scope === "run")!
      expect(rollup).toMatchObject({
        type: "usage-rollup",
        scope: "run",
        usage: { input: 200, output: 40, reasoning: 0, cacheRead: 10, cacheWrite: 0, cost: 0.02, steps: 4 },
      })
      // The run-end code is the full vocabulary's word it was given.
      expect(events.at(-1)).toMatchObject({ type: "run-end", code: 2 })
      expect(events.map((event) => event.type)).toEqual(["run-start", "usage-rollup", "usage-rollup", "usage-rollup", "run-end"])
      for (const event of events) expect(RUN_STATUS_EVENT_TYPES).toContain(event.type)
    } finally {
      stopRunStatus()
      await rm(dir, { recursive: true, force: true })
    }
  })

  // plans/0212 D4 (0165-124): the run total counts each consumption exactly
  // once — a session roll-up's delta (never the resumed entry's cumulative
  // re-counted) plus a lane landing's booked usage (the detail the landing
  // site folded into the stats buckets; no new event type, no new scope
  // word — the finding's own route).
  test("the run total counts deltas and booked lane landings — each consumption exactly once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "run-status-total-"))
    try {
      startRunStatus(dir)
      const cumulative = { input: 140, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 3 }
      const delta = { input: 40, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 1 }
      emitStatus({ type: "usage-rollup", scope: "session", usage: cumulative, delta, session: "ses_1" })
      const laneUsage = { input: 90, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0.01, steps: 2 }
      emitStatus({ type: "lane-landing", lane: "T-001", outcome: "landed", tokens: 100, wallMs: 1000, sessions: 2, usage: laneUsage })
      endRunStatus(0)
      const events = journalOf(dir)
      const run = events.find((event) => event.type === "usage-rollup" && event.scope === "run")!
      // 40 (this booking's delta) + 90 (the booked lane) — never 140 (the
      // cumulative a resumed session re-carries) and never the lane omitted.
      expect(run).toMatchObject({ type: "usage-rollup", scope: "run", usage: { input: 130, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0.01, steps: 3 } })
      // The journal lines keep their reader meanings: the cumulative beside
      // the delta, the landing's breakdown beside its headline figures.
      expect(events.find((event) => event.type === "usage-rollup" && event.scope === "session")).toMatchObject({ usage: cumulative, delta })
      expect(events.find((event) => event.type === "lane-landing")).toMatchObject({ usage: laneUsage })
    } finally {
      stopRunStatus()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("SERVICE_ENTRIES did not grow (the emitter is the log.ts family, never a services member)", () => {
    // The seed of the consolidation's services stage, still the list's
    // ceiling: this unit adds a driver-wide seam WITHOUT joining the holder
    // — setter injection like log.ts, so the allowlist may only shrink.
    expect(SERVICE_ENTRIES.length).toBeLessThanOrEqual(7)
  })
})

// —— the question lifecycle through the routing seam ——

describe("the question lifecycle events (the questions concern routes them)", () => {
  test("an agent question under default switches: raised then answered by the driver, in order, correlatable with the agent stream", async () => {
    const dir = await mkdtemp(join(tmpdir(), "run-status-question-"))
    try {
      startRunStatus(dir)
      const own = questionsConcern.initial(turnContext())
      const ctx = turnContext()
      const fx = fakeTurnFx()
      const advice = await questionsConcern.handle(
        { kind: "event", event: ev.question("ses_1", "q1", "which db?") },
        own,
        viewOver({}),
        fx,
        ctx,
      )
      expect(advice).toBe("consumed")
      // No human waited (default switches): the driver answered outright.
      expect(fx.humanAsks).toEqual([])
      const seen = journalOf(dir)
      const raised = seen.find((event) => event.type === "question-raised")
      const answered = seen.find((event) => event.type === "question-answered")
      expect(raised).toMatchObject({ type: "question-raised", origin: "agent", question: "which db?", request: "q1", session: "ses_1" })
      expect(answered).toMatchObject({ type: "question-answered", by: "driver", request: "q1", session: "ses_1" })
      // The lifecycle ordering: the raise precedes its settlement.
      expect(seen.findIndex((event) => event.type === "question-raised")).toBeLessThan(seen.findIndex((event) => event.type === "question-answered"))
      // Outside a run the same concern emits nothing (the emitter no-ops).
      stopRunStatus()
      await questionsConcern.handle({ kind: "event", event: ev.question("ses_1", "q2", "again?") }, questionsConcern.initial(turnContext()), viewOver({}), fakeTurnFx(), turnContext())
      expect(journalOf(dir).filter((event) => event.type === "question-raised")).toHaveLength(1)
    } finally {
      stopRunStatus()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a permission under --wait-answer with no human: settled by timeout; a human reply settles by human with the answer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "run-status-permission-"))
    // Each drive's events alone: the journal lines past the previous
    // drive's (the file is append-only within the run).
    const eventsOf = async (human: string | undefined): Promise<RunStatusEvent[]> => {
      const before = journalOf(dir).length
      await questionsConcern.handle(
        { kind: "event", event: ev.permission("ses_1", "p1", "bash", "rm -rf /tmp/x") },
        questionsConcern.initial(turnContext()),
        viewOver({}),
        fakeTurnFx({ human }),
        turnContext({ opts: { waitAnswer: 5 } }),
      )
      return journalOf(dir).slice(before)
    }
    try {
      startRunStatus(dir)
      const timedOut = await eventsOf(undefined)
      expect(timedOut.map((event) => `${event.type}:${(event as { by?: string }).by ?? ""}`).join(",")).toContain("question-answered:timeout")
      const human = (await eventsOf("allow")).find((event) => event.type === "question-answered")!
      expect(human).toMatchObject({ by: "human", answer: "allow" })
    } finally {
      stopRunStatus()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
