// The run-status event table's ratchets and keying checks
// (src/run-status-schema.ts, the schema-module precedent of
// src/models-schema.ts): the shipped event-type set is frozen additive-only
// — the list may grow, a name never renames or removes (the write-ratchet
// family; test/chain-writes.test.ts is the pattern) — and the vocabulary's
// identifiers must key into the two vocabularies it sits beside (the engine
// seam's RunEvent, the agent layer's AgentEvent) and into the driver's own
// records (unit model, task statuses, outcomes, stats usage, the graceful
// exit's boundaries). The disjointness of the three event-type sets is
// asserted too, by name, so a joined consumer never needs the channel to
// tell two same-named facts apart.
import { describe, expect, test } from "bun:test"
import type { AgentEvent } from "../src/agent/types"
import type { ErrorClass } from "../src/chain"
import type { ExitRequested } from "../src/exit"
import type { RunEvent } from "../src/engine/events"
import { qualifiedId, type UnitRef } from "../src/document/unit"
import type { Outcome } from "../src/opts"
import type { Usage } from "../src/stats"
import { STATUSES } from "../src/tasks"
import { join } from "node:path"
import {
  LANE_LANDING_OUTCOMES,
  RUN_STATUS_EVENT_TYPES,
  type ExitBoundary,
  type LaneLandingOutcome,
  type LaneResult,
  type RunStatusEvent,
  type RunStatusEventType,
  type RunExitCode,
  type StatusErrorClass,
  type TaskOutcome,
  type UnitStatus,
} from "../src/run-status-schema"

// ---------------------------------------------------------------------------
// The additive-only ratchet (the write-ratchet family)
// ---------------------------------------------------------------------------

// The shipped set, recorded at first ship. The list may grow — extend this
// table consciously in the same change that extends the module's; a name
// never renames or removes.
const SHIPPED: readonly RunStatusEventType[] = [
  "run-start",
  "run-end",
  "unit-transition",
  "task-start",
  "task-end",
  "subtask-start",
  "subtask-end",
  "question-raised",
  "question-answered",
  "usage-rollup",
  "failure",
  "exit-request",
  "lane-dispatch",
  "lane-exit",
  "lane-landing",
  "lane-block",
]

// What breaks when the module's table stops matching the shipped set. Both
// directions are problems: a name that vanished (renamed or removed) and a
// name that arrived unannounced (a growth that did not extend SHIPPED
// consciously).
function ratchetProblems(shipped: readonly string[], actual: readonly string[]): string[] {
  const problems: string[] = []
  for (const name of shipped) {
    if (!actual.includes(name)) problems.push(`missing: ${name} (the event-type table never renames or removes — restore it, or retire it as a conscious, reviewed change to SHIPPED)`)
  }
  for (const name of actual) {
    if (!shipped.includes(name)) problems.push(`unannounced: ${name} (a new event type extends SHIPPED in the same change)`)
  }
  return problems
}

// ---------------------------------------------------------------------------
// The compile-time keying vocabulary's seams, listed so the disjointness
// check below runs over the real type unions, not over prose. The
// `satisfies` clauses keep each list inside its union; the Exact assertions
// under it pin completeness, so a rename or a new member on the seam side
// fails this file's typecheck instead of silently weakening the check.
// ---------------------------------------------------------------------------

type Exact<T, U> = [T] extends [U] ? ([U] extends [T] ? true : never) : never

const RUN_EVENT_TYPES = ["turn-start", "input", "fx", "fx-result", "fx-reject", "settle"] as const satisfies readonly RunEvent["type"][]
const AGENT_EVENT_TYPES = ["part", "message", "question", "permission", "error", "retry", "limit", "idle"] as const satisfies readonly AgentEvent["type"][]

// The lists are exactly their unions (a drifted seam fails the typecheck).
const _runEventListed: Exact<RunEvent["type"], (typeof RUN_EVENT_TYPES)[number]> = true
const _agentEventListed: Exact<AgentEvent["type"], (typeof AGENT_EVENT_TYPES)[number]> = true

// The union and the table cannot drift (either direction fails the
// typecheck, so a member added to the type without the table — or the
// reverse — is caught where it is written).
const _tableCoversUnion: Exact<RunStatusEvent["type"], RunStatusEventType> = true

describe("the run-status event table's additive-only ratchet", () => {
  test("the shipped event-type set is exactly the module's table", () => {
    expect(ratchetProblems(SHIPPED, RUN_STATUS_EVENT_TYPES)).toEqual([])
    // No doubles in the seed: a repeated name would weaken both directions.
    expect(new Set(SHIPPED).size).toBe(SHIPPED.length)
  })

  test("the ratchet bites: a planted rename fails", () => {
    const renamed = RUN_STATUS_EVENT_TYPES.map((name) => (name === "run-end" ? "run-finished" : name))
    const problems = ratchetProblems(SHIPPED, renamed)
    expect(problems.some((p) => p.startsWith("missing: run-end"))).toBe(true)
    expect(problems.some((p) => p.startsWith("unannounced: run-finished"))).toBe(true)
  })

  test("the ratchet bites: a planted removal fails", () => {
    const removed = RUN_STATUS_EVENT_TYPES.filter((name) => name !== "failure")
    expect(ratchetProblems(SHIPPED, removed).join("\n")).toContain("missing: failure")
  })

  test("every event type is constructible — the union is not vacuous", () => {
    // One sample per member; collecting their type names must reproduce the
    // table exactly (a member nobody can build would pass the ratchet while
    // carrying nothing).
    const samples: RunStatusEvent[] = [
      { type: "run-start", run: 1, at: 1, directory: "/tmp/project" },
      { type: "run-end", run: 1, at: 2, code: 0 },
      { type: "unit-transition", run: 1, at: 3, unit: "R-01.P02", level: "phase", from: "in_progress", to: "done" },
      { type: "task-start", run: 1, at: 4, task: "T-014", title: "DMA ring buffer" },
      { type: "task-end", run: 1, at: 5, task: "T-014", outcome: "completed" },
      { type: "subtask-start", run: 1, at: 6, task: "T-014", subtask: "S03" },
      { type: "subtask-end", run: 1, at: 7, task: "T-014", subtask: "S03", outcome: "blocked", detail: "the question" },
      { type: "question-raised", run: 1, at: 8, origin: "agent", question: "Which library?", request: "req_1", session: "ses_1", task: "T-014" },
      { type: "question-answered", run: 1, at: 9, by: "human", request: "req_1", session: "ses_1", answer: "zod" },
      { type: "usage-rollup", run: 1, at: 10, scope: "task", task: "T-014", usage: { input: 1, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5, cost: 0.5, steps: 6 } },
      { type: "failure", run: 1, at: 11, message: "spawn failed", class: "unknown", session: "ses_1", task: "T-014" },
      { type: "exit-request", run: 1, at: 12, boundary: "task" },
      { type: "lane-dispatch", run: 1, at: 13, lane: "T-014", worktree: join(".auto", "worktrees", "T-014"), pid: 4242 },
      { type: "lane-exit", run: 1, at: 14, lane: "T-014", code: 0, report: true, result: "PASS" },
      { type: "lane-landing", run: 1, at: 15, lane: "T-014", outcome: "landed", tokens: 1200, wallMs: 34_000, sessions: 3 },
      { type: "lane-block", run: 1, at: 16, lane: "T-015", reason: "the dispatch attempts cap (3) is hit" },
    ]
    expect(samples.map((event) => event.type).sort()).toEqual([...RUN_STATUS_EVENT_TYPES].sort())
  })
})

describe("the compile-time keying of the vocabulary", () => {
  test("every event type names its run and its instant", () => {
    // A union extends an object type only when every member does: a member
    // without `run`/`at` fails this assignment at typecheck, so the join
    // key cannot quietly fall off one event.
    const keyed: RunStatusEvent extends { run: number; at: number } ? true : never = true
    expect(keyed).toBe(true)
  })

  test("run-end carries the full exit vocabulary 0 / 1 / 2 / 3 / 130", () => {
    const codes = [0, 1, 2, 3, 130] as const
    expect(codes).toEqual([0, 1, 2, 3, 130])
    // Compile-time: each code constructs a run-end event.
    const ends: RunStatusEvent[] = codes.map((code) => ({ type: "run-end", run: 0, at: 0, code }))
    expect(ends.map((event) => (event.type === "run-end" ? event.code : -1))).toEqual([0, 1, 2, 3, 130])
    // Compile-time bite: a code outside the vocabulary does not construct
    // one (the @ts-expect-error fails the typecheck if the closure ever
    // leaks a wider code type).
    // @ts-expect-error 4 is not a run exit code
    const misuse: RunExitCode = 4
    expect(misuse as number).toBe(4)
  })

  test("session identifiers join the agent stream and the engine journal", () => {
    // The agent layer's session id and question request id flow into the
    // vocabulary unchanged, and so does the journal's turn-start session —
    // the three streams join on the same strings.
    const agentSession: Extract<AgentEvent, { type: "question" }>["session"] = "ses_1"
    const agentRequest: Extract<AgentEvent, { type: "question" }>["request"] = "req_1"
    const turnSession: Extract<RunEvent, { type: "turn-start" }>["session"] = "ses_1"
    const raised: Extract<RunStatusEvent, { type: "question-raised" }> = {
      type: "question-raised",
      run: 1,
      at: 1,
      origin: "agent",
      question: "Which library?",
      request: agentRequest,
      session: agentSession,
    }
    const joined: Extract<RunStatusEvent, { type: "question-raised" }> = { ...raised, session: turnSession }
    expect(joined.session).toBe("ses_1")
  })

  test("unit, task and outcome identifiers join the driver's own records", () => {
    // The restated tables accept the homes' values unchanged, and carry
    // exactly their words (the Exact assertions fail the typecheck when
    // either side drifts).
    const statuses: readonly UnitStatus[] = STATUSES
    const exactStatuses: Exact<(typeof STATUSES)[number], UnitStatus> = true
    expect(exactStatuses).toBe(true)
    expect(statuses).toHaveLength(4)
    const ref: UnitRef = { level: "task", id: "T-014" }
    const transition: RunStatusEvent = { type: "unit-transition", run: 1, at: 1, unit: qualifiedId(ref), level: ref.level, from: "pending", to: "in_progress" }
    const outcome: Outcome = { type: "blocked", question: "Proceed?" }
    const exactOutcomes: Exact<Outcome["type"], TaskOutcome> = true
    expect(exactOutcomes).toBe(true)
    const end: RunStatusEvent = { type: "task-end", run: 1, at: 2, task: ref.id, outcome: outcome.type, detail: outcome.question }
    expect([transition.type, end.type]).toEqual(["unit-transition", "task-end"])
  })

  test("usage figures join the stats Usage shape", () => {
    // A stats Usage value is assignable to the roll-up's figures unchanged
    // (the restatement cannot drift from the storage shape).
    const booked: Usage = { input: 1, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5, cost: 0.5, steps: 6 }
    const rollup: RunStatusEvent = { type: "usage-rollup", run: 1, at: 1, scope: "session", session: "ses_1", usage: booked }
    expect(rollup.type).toBe("usage-rollup")
  })

  test("failure classes join the session-error classifier's words", () => {
    const exactClasses: Exact<ErrorClass, StatusErrorClass> = true
    expect(exactClasses).toBe(true)
  })

  test("exit-request boundaries join the graceful-exit seam", () => {
    const boundary: ExitRequested["boundary"] = "wait"
    const exactBoundaries: Exact<ExitRequested["boundary"], ExitBoundary> = true
    expect(exactBoundaries).toBe(true)
    const request: RunStatusEvent = { type: "exit-request", run: 1, at: 1, boundary }
    expect(request.type).toBe("exit-request")
  })

  test("lane events join the lane machinery's own vocabulary (S4, plans/0068 §6.7)", () => {
    // The landing outcomes are D7's three answers, and the exit event's
    // verdict reuses the lane report's `result` words (D8: Result:
    // PASS|FAIL verbatim) — the compile-time joins pin both.
    type LaneReportResult = "PASS" | "FAIL"
    const exactResults: Exact<LaneReportResult, LaneResult> = true
    expect(exactResults).toBe(true)
    expect(LANE_LANDING_OUTCOMES).toEqual(["landed", "conflict", "blocked"])
    const outcomes: readonly LaneLandingOutcome[] = LANE_LANDING_OUTCOMES
    // Compile-time: every outcome constructs a lane-landing event, and a
    // report-less exit (the orphan signal) carries no verdict.
    const landings: RunStatusEvent[] = outcomes.map((outcome) => ({ type: "lane-landing", run: 1, at: 1, lane: "T-014", outcome }))
    expect(landings).toHaveLength(3)
    const crashed: Extract<RunStatusEvent, { type: "lane-exit" }> = { type: "lane-exit", run: 1, at: 2, lane: "T-014", code: 137, report: false }
    expect(crashed.result).toBeUndefined()
  })

  test("the three vocabularies' event-type names are pairwise disjoint", () => {
    // No fact name is shared with the engine seam or the agent layer, so a
    // consumer joining the streams never needs the channel to tell two
    // same-named facts apart (the vocabulary's `failure` exists instead of
    // an `error` for exactly this).
    const shared = (a: readonly string[], b: readonly string[]): string[] => a.filter((name) => b.includes(name))
    expect(shared(RUN_STATUS_EVENT_TYPES, RUN_EVENT_TYPES)).toEqual([])
    expect(shared(RUN_STATUS_EVENT_TYPES, AGENT_EVENT_TYPES)).toEqual([])
    expect(shared(RUN_EVENT_TYPES, AGENT_EVENT_TYPES)).toEqual([])
  })
})
