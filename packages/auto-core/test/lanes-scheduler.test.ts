// The lane scheduler's pure core (plans/0068 §6.2, stage S1): the readiness
// predicate (D5) with its reduction property — one slot and an empty
// in-flight set reproduce next() exactly — the touches-everything rule, the
// free-slot clause, lane eligibility (D15), the landing-side tick sync
// (D7 step ③), the lane runtime fields (D6) and the lane report contract
// with the failure matrix (D8, §6.2). Plans and registry views are hand
// built; the file-writing cases use plain temp directories (no git, no
// spawn): the scheduler is pure.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { laneEligible, laneOutcome, parseLaneReport, readyUnits, syncIndexTicks, type InFlightLane, type LaneRuntime } from "../src/lanes"
import { syncPhaseIndex, type PhaseUnit } from "../src/phases"
import { begin, clearLane, laneRecords, next, setLane, UNITS_FILE, type Plan, type Task } from "../src/tasks"
import { seedUnits, unitsText } from "./fixtures/units"

// —— Hand-built plans ——

const task = (id: string, over: Partial<Task> = {}): Task => ({ id, title: id, status: "pending", attempts: 0, body: "", ...over })

const plan = (tasks: Task[]): Plan => ({ dir: ".", phase: "R-01.P01", index: "docs/R-01/P01-implement/tasks.md", tasks, closed: new Map() })

const doneOf = (p: Plan): Set<string> => new Set(p.tasks.filter((item) => item.status === "done").map((item) => item.id))

const NO_RUNTIME = new Map<string, LaneRuntime>()
const NO_LANES = new Map<string, InFlightLane>()
const lanes = (entries: [string, InFlightLane][]): Map<string, InFlightLane> => new Map(entries)
const ids = (picked: Task[]): string[] => picked.map((item) => item.id)

// The park path of a unit's lane, built rather than spelled out.
const parkOf = (id: string): string => join(".auto", "worktrees", id)

describe("the readiness predicate (D5)", () => {
  test("reduction property: at one slot, empty in-flight and nothing executing, readyUnits is exactly next()", () => {
    const shapes: Task[][] = [
      // G3 serial defaults: absent Depends chains the index order.
      [task("T-001"), task("T-002"), task("T-003")],
      // Explicit roots: every unit ready at once in index order.
      [task("T-001", { depends: "none" }), task("T-002", { depends: "none" }), task("T-003", { depends: "none" })],
      // Lists, backward references, touches declarations — all inert here.
      [
        task("T-001", { depends: "none", touches: ["src/a/"] }),
        task("T-002", { depends: ["T-003"], touches: ["src/b/"] }),
        task("T-003", { depends: "none", touches: ["src/a/x.ts"] }),
      ],
      [task("T-001", { depends: ["T-002", "T-003"] }), task("T-002", { depends: "none" }), task("T-003", { depends: ["T-002"] })],
      // A dependency outside the index counts as done (next()'s rule).
      [task("T-001", { depends: ["T-000"], touches: ["src/a/"] }), task("T-002", { depends: "none" })],
    ]
    for (const tasks of shapes) {
      for (let mask = 0; mask < 2 ** tasks.length; mask++) {
        const dressed = tasks.map((item, i) => (mask & (2 ** i) ? { ...item, status: "done" as const } : item))
        const p = plan(dressed)
        const picked = next(p)
        expect(ids(readyUnits(p, doneOf(p), NO_RUNTIME, NO_LANES, 1))).toEqual(picked !== undefined ? [picked.id] : [])
      }
    }
  })

  test("prerequisites gate readiness exactly as next()'s; the merged states are the done fact, not the plan's statuses", () => {
    const p = plan([
      task("T-001", { depends: "none", touches: ["src/a/"] }),
      task("T-002", { depends: ["T-001"], touches: ["src/b/"] }),
    ])
    expect(ids(readyUnits(p, new Set(), NO_RUNTIME, NO_LANES, 2))).toEqual(["T-001"])
    // T-001 landed but the plan is stale: the merged states say done.
    expect(ids(readyUnits(p, new Set(["T-001"]), NO_RUNTIME, NO_LANES, 2))).toEqual(["T-002"])
  })

  test("a unit executing somewhere — a live lane or the registry's in_progress — is not ready again", () => {
    const p = plan([
      task("T-001", { depends: "none", touches: ["src/a/"] }),
      task("T-002", { depends: "none", touches: ["src/b/"] }),
    ])
    expect(ids(readyUnits(p, new Set(), NO_RUNTIME, lanes([["T-001", { touches: ["src/a/"] }]]), 2))).toEqual(["T-002"])
    expect(ids(readyUnits(p, new Set(), new Map([["T-001", { status: "in_progress" }]]), NO_LANES, 2))).toEqual(["T-002"])
  })
})

describe("the disjointness and slot clauses", () => {
  const p = plan([
    task("T-001", { depends: "none", touches: ["src/a/"] }),
    task("T-002", { depends: "none", touches: ["src/b/"] }),
    task("T-003", { depends: "none", touches: ["src/c/"] }),
  ])

  test("disjoint declarations run side by side; overlapping ones do not (prefix containment included)", () => {
    expect(ids(readyUnits(p, new Set(), NO_RUNTIME, NO_LANES, 3))).toEqual(["T-001", "T-002", "T-003"])
    // A lane over src/a/x.ts holds every unit touching src/a/…
    expect(ids(readyUnits(p, new Set(), NO_RUNTIME, lanes([["T-009", { touches: ["src/a/x.ts"] }]]), 4))).toEqual(["T-002", "T-003"])
    expect(ids(readyUnits(p, new Set(), NO_RUNTIME, lanes([["T-009", { touches: ["src/a"] }]]), 4))).toEqual(["T-002", "T-003"])
    // …but not one touching a sibling segment.
    expect(ids(readyUnits(p, new Set(), NO_RUNTIME, lanes([["T-009", { touches: ["src/a2/"] }]]), 4))).toEqual(["T-001", "T-002", "T-003"])
  })

  test("a unit without a Touches declaration is never ready beside an in-flight lane", () => {
    const q = plan([
      task("T-001", { depends: "none", touches: ["src/a/"] }),
      task("T-002", { depends: "none" }),
    ])
    // T-002 declared nothing — it touches everything, so no lane may run
    // beside it…
    expect(ids(readyUnits(q, new Set(), NO_RUNTIME, lanes([["T-009", { touches: ["src/z/"] }]]), 2))).toEqual(["T-001"])
    // …and no unit may run beside a lane that declared nothing.
    expect(ids(readyUnits(q, new Set(), NO_RUNTIME, lanes([["T-009", {}]]), 2))).toEqual([])
  })

  test("the ready set is capped at the free slots; index order is the tie-break within the set", () => {
    expect(ids(readyUnits(p, new Set(), NO_RUNTIME, NO_LANES, 2))).toEqual(["T-001", "T-002"])
    expect(ids(readyUnits(p, new Set(), NO_RUNTIME, NO_LANES, 1))).toEqual(["T-001"])
    expect(readyUnits(p, new Set(), NO_RUNTIME, NO_LANES, 0)).toEqual([])
    // One lane already in flight: one of the two slots remains.
    expect(ids(readyUnits(p, new Set(), NO_RUNTIME, lanes([["T-003", { touches: ["src/c/"] }]]), 2))).toEqual(["T-001"])
    // Every slot taken: nothing is ready however disjoint it is.
    expect(readyUnits(p, new Set(), NO_RUNTIME, lanes([["T-003", { touches: ["src/c/"] }]]), 1)).toEqual([])
  })

  test("one call's admits are mutually disjoint (the batch is dispatched together)", () => {
    const q = plan([
      task("T-001", { depends: "none", touches: ["src/x/"] }),
      task("T-002", { depends: "none", touches: ["src/x/y.ts"] }),
      task("T-003", { depends: "none", touches: ["src/y/"] }),
    ])
    // T-002 overlaps T-001 and loses the slot to it; T-003 is disjoint.
    expect(ids(readyUnits(q, new Set(), NO_RUNTIME, NO_LANES, 3))).toEqual(["T-001", "T-003"])
  })
})

describe("lane eligibility (D15)", () => {
  const roots = [join("vendor", "ext-lib")]

  test("a declared path under — or covering — a nested-repo root is not lane-eligible", () => {
    expect(laneEligible({ touches: [join("src", "a/")] }, roots)).toBe(true)
    expect(laneEligible({ touches: [join("vendor", "ext-lib", "src", "x.ts")] }, roots)).toBe(false)
    expect(laneEligible({ touches: [join("vendor", "ext-lib/")] }, roots)).toBe(false)
    // The declared parent covers the nested root as surely as a path in it.
    expect(laneEligible({ touches: [join("vendor/")] }, roots)).toBe(false)
    expect(laneEligible({ touches: [join("vendor", "other/")] }, roots)).toBe(true)
  })

  test("no declaration, or no nested roots: eligible (the landing check is the backstop)", () => {
    expect(laneEligible({}, roots)).toBe(true)
    expect(laneEligible({ touches: [join("src", "a/")] }, [])).toBe(true)
  })
})

// —— The file-writing helpers (plain temp directories) ——

let dir: string
let phase: PhaseUnit

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "auto-lanes-"))
  ;[phase] = await syncPhaseIndex(dir, 1, "m")
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("syncIndexTicks (D7 step ③)", () => {
  test("re-derives the ticks from the state files in both directions, member lines only", async () => {
    await seedUnits(dir, "## T-001: a [done]\nA.\n\n## T-002: b [pending]\nB.\n")
    const file = join(dir, phase.dir, "tasks.md")
    // Drift both directions, with a prose line and a nested non-member line
    // that must survive untouched.
    await Bun.write(file, `# Tasks (R-01.P01)\n\n- [ ] T-001 a\n- [x] T-002 b\n\nprose stays\n  - [ ] T-001 indented is not a member\n`)
    expect(await syncIndexTicks(dir, phase)).toEqual(["T-001", "T-002"])
    expect(await Bun.file(file).text()).toBe(`# Tasks (R-01.P01)\n\n- [x] T-001 a\n- [ ] T-002 b\n\nprose stays\n  - [ ] T-001 indented is not a member\n`)
    // Idempotent: a second pass changes and writes nothing.
    expect(await syncIndexTicks(dir, phase)).toEqual([])
  })

  test("a missing index is a no-op", async () => {
    expect(await syncIndexTicks(dir, { round: "R-01", id: "P02", dir: join("docs", "R-01", "P02-m") })).toEqual([])
  })
})

describe("the lane runtime fields (D6; 0051 D3)", () => {
  test("setLane writes worktree and pid through the serialized chain; clearLane drops exactly them", async () => {
    await begin(dir, "T-001")
    await setLane(dir, "T-001", { worktree: parkOf("T-001"), pid: 4242 })
    expect(JSON.parse(await unitsText(dir)).tasks["T-001"]).toEqual({
      status: "in_progress",
      attempts: 1,
      worktree: parkOf("T-001"),
      pid: 4242,
    })
    expect(await laneRecords(dir)).toEqual([{ unit: "T-001", worktree: parkOf("T-001"), pid: 4242 }])
    await clearLane(dir, "T-001")
    expect(JSON.parse(await unitsText(dir)).tasks["T-001"]).toEqual({ status: "in_progress", attempts: 1 })
    expect(await laneRecords(dir)).toEqual([])
  })

  test("setLane without a pid records only the worktree; a hand-edited registry degrades safely on read", async () => {
    await setLane(dir, "T-002", { worktree: parkOf("T-002") })
    expect(await laneRecords(dir)).toEqual([{ unit: "T-002", worktree: parkOf("T-002") }])
    await Bun.write(join(dir, UNITS_FILE), JSON.stringify({ tasks: { "T-003": { worktree: 7 }, "T-004": { worktree: parkOf("T-004"), pid: "x" } } }))
    expect(await laneRecords(dir)).toEqual([{ unit: "T-004", worktree: parkOf("T-004") }])
  })
})

// —— The lane report and the failure matrix (D8, §6.2) ——

const REPORT = {
  unit: "T-001",
  phase: "R-01.P01",
  ok: true,
  result: "PASS",
  usage: { tokens: 1200, wallMs: 34_000 },
  sessions: 3,
  commits: ["abc1234"],
  agent: "claude",
  models: ["opus"],
}

describe("parseLaneReport (D8)", () => {
  // Parse the canonical report with overrides, so the equality sides share
  // the parser's own type.
  const round = (over: Record<string, unknown> = {}): ReturnType<typeof parseLaneReport> => parseLaneReport(JSON.stringify({ ...REPORT, ...over }))

  test("parses the report shape; unknown fields are ignored; split rides through opaquely", () => {
    expect(round()).toBeDefined()
    expect(round({ extra: "ignored" })).toEqual(round())
    const withSplit = round({ split: { items: 3 } })!
    expect(withSplit).toEqual({ ...withSplit, split: { items: 3 } })
  })

  test("a record that does not carry the contract is not a report (the orphan signal)", () => {
    expect(parseLaneReport("not json")).toBeUndefined()
    expect(parseLaneReport(JSON.stringify({ unit: "T-001" }))).toBeUndefined()
    expect(parseLaneReport(JSON.stringify({ ...REPORT, usage: "x" }))).toBeUndefined()
    expect(parseLaneReport(JSON.stringify({ ...REPORT, sessions: -1 }))).toBeUndefined()
    expect(parseLaneReport(JSON.stringify({ ...REPORT, commits: [7] }))).toBeUndefined()
    expect(parseLaneReport(JSON.stringify({ ...REPORT, result: "MAYBE" }))).toBeUndefined()
    expect(parseLaneReport(JSON.stringify({ ...REPORT, blocked: 2 }))).toBeUndefined()
    expect(parseLaneReport(JSON.stringify({ ...REPORT, split: [] }))).toBeUndefined()
  })
})

describe("the failure matrix (§6.2)", () => {
  const okReport = parseLaneReport(JSON.stringify(REPORT))!
  const failReport = parseLaneReport(JSON.stringify({ ...REPORT, ok: false, result: "FAIL" }))!
  const blockedReport = parseLaneReport(JSON.stringify({ ...REPORT, ok: false, blocked: "the park path" }))!

  const cases: Array<[number, typeof okReport | undefined, "land" | "blocked" | "environment" | "orphan", string]> = [
    [0, okReport, "land", "exit 0 with an ok report lands"],
    [2, failReport, "blocked", "exit 2 with a FAIL report blocks"],
    [2, blockedReport, "blocked", "exit 2 with a blocked report blocks"],
    [1, okReport, "environment", "exit 1 is the global environment error"],
    [1, failReport, "environment", "exit 1 stays the environment error whatever the report says"],
    [0, undefined, "orphan", "exit 0 without a report is an orphan"],
    [1, undefined, "orphan", "exit 1 without a report is an orphan (no controlled exit writes none)"],
    [137, undefined, "orphan", "a crash code without a report is an orphan"],
    [0, parseLaneReport(JSON.stringify({ ...REPORT, ok: false })), "blocked", "exit 0 with a failing report blocks, never lands"],
    [2, okReport, "blocked", "exit 2 with a clean report blocks"],
  ]
  for (const [code, report, kind, label] of cases) {
    test(label, () => {
      expect(laneOutcome(code, report).kind).toBe(kind)
    })
  }

  test("the land and blocked outcomes carry the report; the orphan outcome carries nothing", () => {
    expect(laneOutcome(0, okReport)).toEqual({ kind: "land", report: okReport })
    expect(laneOutcome(2, blockedReport)).toEqual({ kind: "blocked", report: blockedReport })
    expect(laneOutcome(1, okReport)).toEqual({ kind: "environment", report: okReport })
    expect(laneOutcome(137, undefined)).toEqual({ kind: "orphan" })
  })
})
