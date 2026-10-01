// The driver-status emitter's suite (P2b, plans/0067 and its review): the
// seam itself (an unstarted emitter is a no-op; a started one brackets the
// run, numbers its events, feeds the registered sinks and appends the
// journal), the question lifecycle's ordering through the questions concern
// (the routing seam the emitter hangs on), the SERVICE_ENTRIES length
// ratchet (the emitter is the log.ts setter-injection family's shape, never
// a services member), and the acceptance: one fixture run observed
// end-to-end through typed events only — run-start, unit/task transitions,
// the question lifecycle pair, run-end with the correct exit code — with no
// prose parsed anywhere (the assertions read typed event objects alone).
import { describe, expect, test, spyOn } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentHost } from "../src/agent/types"
import { EOF_MARK } from "../src/doccheck"
import { runAll } from "../src/loop"
import { questionsConcern } from "../src/engine/concerns/questions"
import { addStatusSink, emitStatus, endRunStatus, RUN_STATUS_FILE, startRunStatus, stopRunStatus, type StatusSink } from "../src/run-status"
import { RUN_STATUS_EVENT_TYPES, type RunStatusEvent } from "../src/run-status-schema"
import { SERVICE_ENTRIES } from "../src/services"
import { autoSwitches, setSwitchModelRegistry } from "../src/switches"
import { defaultTurn, ev, fakeAgent, type TurnScript } from "./fixtures/agent"
import { freshRepo, git } from "./fixtures/runner"
import { seedUnits } from "./fixtures/units"
import { fakeTurnFx, turnContext, viewOver } from "./fixtures/turn"

// One recorded event: the typed object plus the sequence number the sink
// received beside it.
type Seen = { event: RunStatusEvent; seq: number }

const collector = (): { seen: Seen[]; sink: StatusSink; off: () => void } => {
  const seen: Seen[] = []
  const sink: StatusSink = (event, seq) => {
    seen.push({ event, seq })
  }
  return { seen, sink, off: addStatusSink(sink) }
}

// The journal's parsed lines.
const journalOf = (dir: string): RunStatusEvent[] =>
  readFileSync(join(dir, RUN_STATUS_FILE), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RunStatusEvent)

// —— the seam itself ——

describe("the emitter (start/bracket/journal/sinks)", () => {
  test("an unstarted emitter is a no-op: no file, no sink feed, no throw", async () => {
    const dir = await mkdtemp(join(tmpdir(), "run-status-unstarted-"))
    const { seen, off } = collector()
    try {
      expect(() => emitStatus({ type: "failure", message: "x" })).not.toThrow()
      expect(seen).toEqual([])
      expect(existsSync(join(dir, RUN_STATUS_FILE))).toBe(false)
    } finally {
      off()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("start brackets the run: run-start is event 1, end closes with the run roll-up then run-end, and both journal and sinks see the same events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "run-status-bracket-"))
    const { seen, off } = collector()
    try {
      startRunStatus(dir)
      endRunStatus(0)
      const types = seen.map((s) => s.event.type)
      expect(types).toEqual(["run-start", "usage-rollup", "run-end"])
      // The join key: the run-start's instant is the run id every later
      // event echoes, and run-end carries the code it closed with.
      const run = seen[0]!.event.run
      expect(seen[0]!.event.at).toBe(run)
      expect(seen[0]!.event).toMatchObject({ type: "run-start", directory: dir })
      expect(seen.at(-1)!.event).toEqual({ type: "run-end", run, at: seen.at(-1)!.event.at, code: 0 })
      // Sequences are 1-based and strictly increasing.
      expect(seen.map((s) => s.seq)).toEqual([1, 2, 3])
      // The journal holds exactly the same typed lines.
      expect(journalOf(dir)).toEqual(seen.map((s) => s.event))
      // endRunStatus is idempotent within a run.
      endRunStatus(1)
      expect(seen).toHaveLength(3)
    } finally {
      off()
      stopRunStatus()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a second start rotates the journal — one run's file holds exactly that run's events", async () => {
    const dir = await mkdtemp(join(tmpdir(), "run-status-rotate-"))
    const { seen, off } = collector()
    try {
      startRunStatus(dir)
      emitStatus({ type: "task-start", task: "T-001" })
      endRunStatus(0)
      startRunStatus(dir)
      expect(seen.filter((s) => s.event.type === "task-start")).toHaveLength(1)
      expect(journalOf(dir).map((event) => event.type)).toEqual(["run-start"])
      // The new run's join key is a fresh instant.
      expect(seen.at(-1)!.event.run).toBeGreaterThanOrEqual(seen[0]!.event.run)
    } finally {
      off()
      stopRunStatus()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the run roll-up totals the session roll-ups; a throwing sink is dropped, the others go on", async () => {
    const dir = await mkdtemp(join(tmpdir(), "run-status-sinks-"))
    const good = collector()
    let bad = 0
    const removeBad = addStatusSink(() => {
      bad += 1
      if (bad === 1) throw new Error("a subscriber's own error")
    })
    try {
      startRunStatus(dir)
      const usage = { input: 100, output: 20, reasoning: 0, cacheRead: 5, cacheWrite: 0, cost: 0.01, steps: 2 }
      emitStatus({ type: "usage-rollup", scope: "session", usage, session: "ses_1" })
      emitStatus({ type: "usage-rollup", scope: "session", usage, session: "ses_2" })
      endRunStatus(2)
      const rollup = good.seen.find((s) => s.event.type === "usage-rollup" && s.event.scope === "run")!
      expect(rollup.event).toMatchObject({
        type: "usage-rollup",
        scope: "run",
        usage: { input: 200, output: 40, reasoning: 0, cacheRead: 10, cacheWrite: 0, cost: 0.02, steps: 4 },
      })
      // The run-end code is the full vocabulary's word it was given.
      expect(good.seen.at(-1)!.event).toMatchObject({ type: "run-end", code: 2 })
      // The throwing sink was dropped after its first failure; the good one
      // saw everything.
      expect(bad).toBe(1)
      expect(good.seen.map((s) => s.event.type)).toEqual(["run-start", "usage-rollup", "usage-rollup", "usage-rollup", "run-end"])
      // Every journaled line is a member of the frozen vocabulary.
      for (const event of journalOf(dir)) expect(RUN_STATUS_EVENT_TYPES).toContain(event.type)
    } finally {
      removeBad()
      good.off()
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
    const { seen, off } = collector()
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
      const raised = seen.find((s) => s.event.type === "question-raised")
      const answered = seen.find((s) => s.event.type === "question-answered")
      expect(raised!.event).toMatchObject({ type: "question-raised", origin: "agent", question: "which db?", request: "q1", session: "ses_1" })
      expect(answered!.event).toMatchObject({ type: "question-answered", by: "driver", request: "q1", session: "ses_1" })
      // The lifecycle ordering: the raise precedes its settlement.
      expect(seen.findIndex((s) => s.event.type === "question-raised")).toBeLessThan(seen.findIndex((s) => s.event.type === "question-answered"))
      // Outside a run the same concern emits nothing (the emitter no-ops).
      stopRunStatus()
      await questionsConcern.handle({ kind: "event", event: ev.question("ses_1", "q2", "again?") }, questionsConcern.initial(turnContext()), viewOver({}), fakeTurnFx(), turnContext())
      expect(seen.filter((s) => s.event.type === "question-raised")).toHaveLength(1)
    } finally {
      off()
      stopRunStatus()
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a permission under --wait-answer with no human: settled by timeout; a human reply settles by human with the answer", async () => {
    const { seen, off } = collector()
    const dir = await mkdtemp(join(tmpdir(), "run-status-permission-"))
    try {
      startRunStatus(dir)
      const drive = async (human: string | undefined): Promise<void> => {
        seen.length = 0
        await questionsConcern.handle(
          { kind: "event", event: ev.permission("ses_1", "p1", "bash", "rm -rf /tmp/x") },
          questionsConcern.initial(turnContext()),
          viewOver({}),
          fakeTurnFx({ human }),
          turnContext({ opts: { waitAnswer: 5 } }),
        )
      }
      await drive(undefined)
      expect(seen.map((s) => `${s.event.type}:${(s.event as { by?: string }).by ?? ""}`).join(",")).toContain("question-answered:timeout")
      await drive("allow")
      const human = seen.find((s) => s.event.type === "question-answered")!
      expect(human.event).toMatchObject({ by: "human", answer: "allow" })
    } finally {
      off()
      stopRunStatus()
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// —— the acceptance: one fixture run observed through typed events only ——

// The wrap-up prompt names the report path; the fake agent writes the report
// the wrap-up gate reads (non-trivial above the stub threshold, terminator,
// PASS verdict).
const REPORT = [
  "# T-001 report",
  "",
  "The widget was built and read back. The session wrote the widget module, exercised it against the fake agent's scripted turn, and confirmed the read-back path works end to end without touching anything outside the task's declared scope.",
  "",
  "Result: PASS",
  "",
  EOF_MARK,
  "",
].join("\n")

// Scrub the ambient OPENCODE_AUTO_* layer around a run and capture the
// terminal (the fixtures/loop.ts convention; the deliverables doc's
// driver-environment rule).
async function withQuietConsole<T>(run: () => Promise<T>): Promise<T> {
  const saved = Object.entries(process.env).filter(([key]) => /^OPENCODE_AUTO_/.test(key))
  for (const [key] of saved) delete process.env[key]
  const printed = spyOn(console, "log").mockImplementation(() => {})
  try {
    return await run()
  } finally {
    printed.mockRestore()
    for (const [key, value] of saved) if (value !== undefined) process.env[key] = value
  }
}

describe("the subscriber e2e (one fixture run through typed events only)", () => {
  test("a run with a question: run-start, the unit/task transitions, the question pair, run-end with the code — all typed, no prose parsed", async () => {
    const dir = await freshRepo()
    const { seen, off } = collector()
    const turn: TurnScript = (ctx) => {
      if (ctx.text.includes("docs/T-001/report.md")) {
        writeFileSync(join(dir, "docs", "T-001", "report.md"), REPORT)
        return undefined
      }
      // The lead's first turn raises one question beside the default
      // settle; under default switches the driver answers it outright.
      if (ctx.n === 1) return [ev.question(ctx.session, "req_widget", "Which storage should the widget use?"), ...defaultTurn(ctx)]
      return undefined
    }
    const agent = fakeAgent({ turn })
    const host: AgentHost = { client: agent.client, syncContext: async () => {}, restart: async () => false, close: () => {} }
    await seedUnits(dir, "## T-001: the widget [pending]\nBuild the widget.\n")
    await Bun.write(join(dir, ".opencode", "agent", "auto.md"), "contract\n")
    await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "baseline")
    try {
      const code = await withQuietConsole(() => runAll(dir, { managed: host }))
      expect(code).toBe(0)
      const events = seen.map((s) => s.event)

      // The bracket: the first event opens the run on this directory, the
      // last closes it with the code the process exits with.
      expect(events[0]).toMatchObject({ type: "run-start", directory: dir })
      const run = events[0]!.run
      expect(events.at(-1)).toMatchObject({ type: "run-end", code: 0 })
      expect(events.filter((event) => event.run !== run)).toEqual([])
      // Sequences are 1..n with no gaps and no repeats.
      expect(seen.map((s) => s.seq)).toEqual(seen.map((_, i) => i + 1))

      // The task narrative: the bracket, the unit transitions (pending →
      // in_progress → done) and the completed task-end.
      expect(events).toContainEqual(expect.objectContaining({ type: "task-start", task: "T-001" }))
      expect(events).toContainEqual({ type: "unit-transition", run, at: expect.any(Number), unit: "T-001", level: "task", from: "pending", to: "in_progress" })
      expect(events).toContainEqual({ type: "unit-transition", run, at: expect.any(Number), unit: "T-001", level: "task", from: "in_progress", to: "done" })
      const taskEnd = events.find((event) => event.type === "task-end")!
      expect(taskEnd).toMatchObject({ type: "task-end", task: "T-001", outcome: "completed" })

      // The question lifecycle: raised (agent origin, the request joins the
      // agent stream) then answered by the driver — in that order.
      const raisedAt = events.findIndex((event) => event.type === "question-raised")
      const answeredAt = events.findIndex((event) => event.type === "question-answered")
      expect(raisedAt).toBeGreaterThanOrEqual(0)
      expect(answeredAt).toBeGreaterThan(raisedAt)
      expect(events[raisedAt]).toMatchObject({ type: "question-raised", origin: "agent", question: "Which storage should the widget use?", request: "req_widget" })
      expect(events[answeredAt]).toMatchObject({ type: "question-answered", by: "driver", request: "req_widget" })

      // Usage: at least one session roll-up with a session id, and the run
      // roll-up right before the run-end.
      const session = events.find((event) => event.type === "usage-rollup" && event.scope === "session")!
      expect(session).toMatchObject({ scope: "session", session: expect.any(String) })
      expect(events.at(-2)).toMatchObject({ type: "usage-rollup", scope: "run" })

      // The journal holds exactly what the subscriber saw: the daemon's
      // SSE tail reads the same stream (every line a vocabulary member).
      expect(journalOf(dir)).toEqual(events)
      for (const event of events) expect(RUN_STATUS_EVENT_TYPES).toContain(event.type)
    } finally {
      off()
      stopRunStatus()
      // The run froze the switch snapshot at its fleet start (the run's own
      // invariant); this is the first in-process test that drives a run
      // through that point, so it re-parses the facts back to an unfrozen
      // snapshot — the documented reset (test/services.test.ts's frozen-
      // snapshot pair) — or every later clamp in this process throws.
      setSwitchModelRegistry(undefined)
      autoSwitches()
      await rm(dir, { recursive: true, force: true })
    }
  }, 120_000)
})
