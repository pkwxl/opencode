// The lane scheduler's pure core (plans/0068 §6.2, stage S1): the readiness
// predicate (D5) with its reduction property — one slot and an empty
// in-flight set reproduce next() exactly — the touches-everything rule, the
// free-slot clause, lane eligibility (D15), the landing-side tick sync
// (D7 step ③), the lane runtime fields (D6) and the lane report contract
// with the failure matrix (D8, §6.2). Plans and registry views are hand
// built; those cases are pure.
// Since stage S2 the file also covers the dispatch and landing choreography
// (§6.5) over real git repositories — the worktree, the scaffolding copy, the
// landing merge — with the lane launcher stubbed through the shell profile
// (no process spawn: the launcher is the seam, and the stub answers an
// already-exited worker). Stage S3 adds the loop's own cases the same way —
// the readiness scheduler at maxSessions = 2 (two lanes side by side, the
// landing-conflict protocol under both level postures, a crash re-dispatched,
// a FAIL keeping its commit) and D14's orphan recovery — plus D15's serial
// degrade over the fake agent. All of that is why the file lives in the repo
// lane of the test manifest despite its pure S1 half.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { readdirSync } from "node:fs"
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  dispatchLane,
  laneBranch,
  laneEligible,
  laneExit,
  laneOutcome,
  lanePark,
  landLane,
  LANE_DISPATCH_CAP,
  parseLaneReport,
  readyUnits,
  relayLaneOutput,
  streamUnitOf,
  streamUnits,
  syncIndexTicks,
  writeLaneReport,
  type InFlightLane,
  type LaneReport,
  type LaneRuntime,
} from "../src/lanes"
import { addStatusSink, startRunStatus, stopRunStatus } from "../src/run-status"
import type { RunStatusEvent } from "../src/run-status-schema"
import { changedFiles, commitTree, unitBaseline } from "../src/git"
import { createGitOps } from "../src/git-ops"
import { setShellProfile, type LaneWorker } from "../src/shell"
import { syncPhaseIndex, type PhaseUnit } from "../src/phases"
import { begin, clearLane, laneRecords, loadPlan, markDone, next, readChecklist, renderTaskIndex, setLane, setSplit, tickSubtask, UNITS_FILE, unitAttempts, type Plan, type Task } from "../src/tasks"
import { parseSplit, writeSplitTodos } from "../src/split"
import { renameTodoToDone } from "../src/document/state"
import { taskDoc } from "../src/docpaths"
import { seedUnits, unitsText } from "./fixtures/units"
import { ExitRequested } from "../src/exit"
import { runTaskLoop, type LoopCtx } from "../src/loop-task"
import { recoverOrphanLanes, type RunAllOpts } from "../src/loop-preflight"
import { RUN_LOCK_FILE } from "../src/lock"
import { services } from "../src/services"
import { setSwitchModelRegistry } from "../src/switches"
import { singleHost } from "../src/agent-pool"
import type { AgentHost } from "../src/agent/types"
import { fakeClient } from "./fixtures/runner"
import { EOF_MARK } from "../src/doccheck"

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
  // The choreography cases stub the lane launcher through the profile; the
  // restore names the key the tests touched (shell.test.ts's pattern).
  setShellProfile({ laneLauncher: undefined })
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
  test("setLane writes worktree and pid through the serialized chain; clearLane drops exactly them (and a stale in_progress — S5: a landed partial unit executes nowhere)", async () => {
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
    expect(JSON.parse(await unitsText(dir)).tasks["T-001"]).toEqual({ attempts: 1 })
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

  test("parses the report shape; unknown fields are ignored; the S5 split rides typed", () => {
    expect(round()).toBeDefined()
    expect(round({ extra: "ignored" })).toEqual(round())
    const withSplit = round({ split: { items: 3, baseline: [{ root: "/w", sha: "abc1234" }] } })!
    expect(withSplit).toEqual({ ...withSplit, split: { items: 3, baseline: [{ root: "/w", sha: "abc1234" }] } })
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
    // S5's split shape: a positive item count and a {root, sha} baseline.
    expect(parseLaneReport(JSON.stringify({ ...REPORT, split: { items: 0, baseline: [] } }))).toBeUndefined()
    expect(parseLaneReport(JSON.stringify({ ...REPORT, split: { items: 2 } }))).toBeUndefined()
    expect(parseLaneReport(JSON.stringify({ ...REPORT, split: { items: 2, baseline: [{ root: "/w", sha: 7 }] } }))).toBeUndefined()
    expect(parseLaneReport(JSON.stringify({ ...REPORT, split: { items: 2, baseline: [] } }))).toBeDefined()
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

// —— The dispatch and landing choreography (§6.5, stage S2) over real git ——

// git over the fixture dir, asserting exit 0.
async function git(root: string, ...args: string[]) {
  const proc = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`git ${args.join(" ")} exit code ${code}: ${err || out}`)
  return out
}

// Whether a directory exists (Bun.file targets files; a directory answers
// false — the park assertions need the real thing).
const dirExists = (path: string) => stat(path).then(() => true, () => false)

// An already-exited worker the stub launcher answers with (no process).
const stubWorker = (code = 0): LaneWorker => ({ pid: 4242, exited: Promise.resolve(code) })

// A stub worker whose exit lands only after its work does: the launcher is
// synchronous, so the unit's work in the worktree rides a promise the exit
// resolution waits on — the loop awaits the exit, and the report must exist
// by then. A failed work promise still exits (with the given code).
const workingStub = (work: Promise<unknown>, code = 0): LaneWorker => {
  let settle!: (code: number) => void
  const exited = new Promise<number>((resolve) => (settle = resolve))
  void work.then(() => settle(code), () => settle(code))
  return { pid: 4242, exited }
}

// A hand-built report of the D8 shape.
const reportOf = (unit: string, over: Partial<LaneReport> = {}): LaneReport => ({
  unit,
  phase: "R-01.P01",
  ok: true,
  result: "PASS",
  usage: { tokens: 100, wallMs: 1000 },
  sessions: 2,
  commits: ["abc1234"],
  agent: "claude",
  models: ["opus"],
  ...over,
})

// A committed project with one pending task, its scaffolding local-only
// (gitignored like init writes it): the scene a parent dispatches a lane
// from. Returns the loaded task.
async function laneProject(text = "## T-001: the widget [pending]\nBuild the widget.\n"): Promise<Task> {
  await git(dir, "init", "-q")
  const plan = await seedUnits(dir, text)
  await Bun.write(join(dir, ".gitignore"), [".auto/", "tmp/", "/.gitignore", "/.env", "/AGENTS.md", "/opencode.json", "/.opencode/auto/models.json", ""].join("\n"))
  await mkdir(join(dir, ".opencode", "agent"), { recursive: true })
  await Bun.write(join(dir, ".opencode", "agent", "auto.md"), "the agent contract\n")
  await mkdir(join(dir, ".opencode", "auto"), { recursive: true })
  await Bun.write(join(dir, ".opencode", "auto", "config.json"), "{}\n")
  await Bun.write(join(dir, "opencode.json"), "{}\n")
  await Bun.write(join(dir, "AGENTS.md"), "the agents block\n")
  await git(dir, "add", "-A")
  await git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline")
  return plan.tasks[0]!
}

describe("dispatchLane (§6.5 ①–⑤)", () => {
  test("a fresh dispatch: the worktree on the lane branch at HEAD, the scaffolding copied, the runtime fields written; laneExit drains the worker", async () => {
    const task = await laneProject()
    setShellProfile({ laneLauncher: () => stubWorker() })
    const lane = await dispatchLane(createGitOps(), dir, task)
    if (lane.type !== "spawned") throw new Error(lane.error)
    expect(lane.fresh).toBe(true)
    expect(lane.worktree).toBe(join(dir, lanePark("T-001")))
    // The checkout carries the branch's content, the copy the local-only set.
    expect(await Bun.file(join(lane.worktree, "docs", "T-001", "todo.md")).exists()).toBe(true)
    expect(await Bun.file(join(lane.worktree, "AGENTS.md")).text()).toBe("the agents block\n")
    expect(await Bun.file(join(lane.worktree, "opencode.json")).exists()).toBe(true)
    expect(await Bun.file(join(lane.worktree, ".gitignore")).text()).toContain(".auto/")
    expect(await Bun.file(join(lane.worktree, ".opencode", "agent", "auto.md")).exists()).toBe(true)
    expect((await git(lane.worktree, "rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe(laneBranch("T-001"))
    // The registry records the dispatch; attempts booked through begin.
    expect(JSON.parse(await unitsText(dir)).tasks["T-001"]).toEqual({
      status: "in_progress",
      attempts: 1,
      worktree: lanePark("T-001"),
      pid: 4242,
    })
    // The parent tree stays clean — the park is gitignored and skipped.
    expect(await changedFiles(dir)).toEqual([])
    expect(await laneExit(lane.worker)).toEqual({ code: 0, output: "" })
  })

  test("a re-dispatch reuses the recorded worktree (the crash-resume property) and books another attempt", async () => {
    const task = await laneProject()
    setShellProfile({ laneLauncher: () => stubWorker() })
    const first = await dispatchLane(createGitOps(), dir, task)
    if (first.type !== "spawned") throw new Error(first.error)
    const second = await dispatchLane(createGitOps(), dir, task)
    if (second.type !== "spawned") throw new Error(second.error)
    expect(second.fresh).toBe(false)
    expect(second.worktree).toBe(first.worktree)
    expect(JSON.parse(await unitsText(dir)).tasks["T-001"].attempts).toBe(2)
  })

  test("a park straggler without a lane record fails the dispatch naming the path", async () => {
    const task = await laneProject()
    setShellProfile({ laneLauncher: () => stubWorker() })
    const first = await dispatchLane(createGitOps(), dir, task)
    if (first.type !== "spawned") throw new Error(first.error)
    await clearLane(dir, "T-001")
    const stray = await dispatchLane(createGitOps(), dir, task)
    expect(stray.type).toBe("failed")
    if (stray.type === "failed") expect(stray.error).toContain("no lane record")
  })

  test("a record naming a missing worktree fails the dispatch", async () => {
    const task = await laneProject()
    await setLane(dir, "T-001", { worktree: lanePark("T-001"), pid: 1 })
    const gone = await dispatchLane(createGitOps(), dir, task)
    expect(gone.type).toBe("failed")
    if (gone.type === "failed") expect(gone.error).toContain("no longer exists")
  })
})

describe("landLane (D7's five steps)", () => {
  test("a landed lane: the verified branch merges with Auto-Stage: landing, the tick re-derivation commits as landing-sync, the record clears, the park tears down", async () => {
    const task = await laneProject()
    setShellProfile({ laneLauncher: () => stubWorker() })
    const lane = await dispatchLane(createGitOps(), dir, task)
    if (lane.type !== "spawned") throw new Error(lane.error)
    // The lane completes its unit the real way: the rename + tick inside its
    // own close-out commit — but the index tick is left drifted (the tick
    // alone, uncommitted) so the parent's landing-sync has a change to make.
    await markDone({ dir: lane.worktree, index: join(phase.dir, "tasks.md") }, "T-001")
    const ticked = await Bun.file(join(lane.worktree, phase.dir, "tasks.md")).text()
    await Bun.write(join(lane.worktree, phase.dir, "tasks.md"), ticked.replace("- [x] T-001", "- [ ] T-001"))
    await mkdir(join(lane.worktree, "src"), { recursive: true })
    await Bun.write(join(lane.worktree, "src", "widget.ts"), "export const widget = 1\n")
    const settled = await commitTree(lane.worktree, task, { stage: "done", subject: "T-001 done the widget" })
    expect(settled.ok).toBe(true)
    await writeLaneReport(lane.worktree, reportOf("T-001"))

    const landed = await landLane(createGitOps(), dir, phase, task, reportOf("T-001"))
    expect(landed).toEqual({ type: "landed", teardown: true })
    // The work, the done state and the re-derived tick arrived in the main tree.
    expect(await Bun.file(join(dir, "src", "widget.ts")).text()).toBe("export const widget = 1\n")
    expect(await Bun.file(join(dir, "docs", "T-001", "done.md")).exists()).toBe(true)
    expect(await Bun.file(join(dir, "docs", "T-001", "todo.md")).exists()).toBe(false)
    expect(await Bun.file(join(dir, phase.dir, "tasks.md")).text()).toContain("- [x] T-001 the widget")
    expect(await changedFiles(dir)).toEqual([])
    // The merge commit carries the landing trailers; the tick sync landed on
    // its own landing-sync commit.
    const log = await git(dir, "log", "--format=%B", "-3")
    expect(log).toContain("Auto-Stage: landing\n")
    expect(log).toContain("Auto-Stage: landing-sync\n")
    expect(log).toContain("Auto-Task: T-001")
    // The record, the worktree and the branch are gone; the usage booked.
    const units = JSON.parse(await unitsText(dir))
    expect(units.tasks["T-001"].worktree).toBeUndefined()
    expect(units.tasks["T-001"].pid).toBeUndefined()
    expect(await dirExists(join(dir, lanePark("T-001")))).toBe(false)
    expect((await git(dir, "branch", "--list", laneBranch("T-001"))).trim()).toBe("")
    const stats = JSON.parse(await Bun.file(join(dir, ".auto", "stats.json")).text())
    expect(stats.lanes["T-001"]).toEqual({ tokens: 100, wallMs: 1000, sessions: 2 })
  })

  test("a conflict: the merge aborts, the main tree is clean again, the lane's scene (worktree, branch, record) is kept", async () => {
    const task = await laneProject()
    setShellProfile({ laneLauncher: () => stubWorker() })
    const lane = await dispatchLane(createGitOps(), dir, task)
    if (lane.type !== "spawned") throw new Error(lane.error)
    // Both sides move the task document.
    await Bun.write(join(lane.worktree, "docs", "T-001", "todo.md"), "# T-001: lane side\n")
    await commitTree(lane.worktree, task, { stage: "done", subject: "T-001 done the widget" })
    await Bun.write(join(dir, "docs", "T-001", "todo.md"), "# T-001: main side\n")
    await commitTree(dir, task, { stage: "housekeeping", subject: "PLAN housekeeping sibling move" })

    const landed = await landLane(createGitOps(), dir, phase, task, reportOf("T-001"))
    expect(landed.type).toBe("conflict")
    expect(await Bun.file(join(dir, "docs", "T-001", "todo.md")).text()).toBe("# T-001: main side\n")
    expect(await changedFiles(dir)).toEqual([])
    expect(await dirExists(join(dir, lanePark("T-001")))).toBe(true)
    expect((await git(dir, "branch", "--list", laneBranch("T-001"))).trim()).toContain(laneBranch("T-001"))
    expect(JSON.parse(await unitsText(dir)).tasks["T-001"].worktree).toBe(lanePark("T-001"))
  })

  test("a foreign commit inside the lane branch blocks the landing and keeps the scene", async () => {
    const task = await laneProject()
    setShellProfile({ laneLauncher: () => stubWorker() })
    const lane = await dispatchLane(createGitOps(), dir, task)
    if (lane.type !== "spawned") throw new Error(lane.error)
    await Bun.write(join(lane.worktree, "src.ts"), "x\n")
    await git(lane.worktree, "add", "-A")
    await git(lane.worktree, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "manual commit")

    const landed = await landLane(createGitOps(), dir, phase, task, reportOf("T-001"))
    expect(landed.type).toBe("blocked")
    if (landed.type === "blocked") expect(landed.error).toContain("non-driver commit")
    expect(await changedFiles(dir)).toEqual([])
    expect(await dirExists(join(dir, lanePark("T-001")))).toBe(true)
  })
})

// —— The readiness scheduler's lane loop (§6.2, stage S3) ——

// One unit of a scheduler project: its id and title, the `Touches` its
// document declares (absent = touches everything) and `Depends: none` when it
// should be co-ready with its sibling, and the source file the fake worker
// writes for it. `lie` makes two units write the same file while declaring
// disjoint paths — D5's advisory `Touches`, surfacing as D7's landing
// conflict instead of corruption.
type SchedUnit = { id: string; title: string; touches?: string[]; root?: boolean; file: string; content?: string }

// The scaffolding every lane worktree needs (F7) — the write half of
// laneProject above, shared with the scheduler projects.
async function writeScaffolding(root: string): Promise<void> {
  await Bun.write(join(root, ".gitignore"), [".auto/", "tmp/", "/.gitignore", "/.env", "/AGENTS.md", "/opencode.json", "/.opencode/auto/models.json", ""].join("\n"))
  await mkdir(join(root, ".opencode", "agent"), { recursive: true })
  await Bun.write(join(root, ".opencode", "agent", "auto.md"), "the agent contract\n")
  await mkdir(join(root, ".opencode", "auto"), { recursive: true })
  await Bun.write(join(root, ".opencode", "auto", "config.json"), "{}\n")
  await Bun.write(join(root, "opencode.json"), "{}\n")
  await Bun.write(join(root, "AGENTS.md"), "the agents block\n")
}

// A committed scheduler project: one unit per entry, its document carrying
// the `Depends: none` / `Touches:` declarations the readiness predicate
// reads, the scaffolding local-only, everything committed at HEAD.
async function schedulerProject(units: SchedUnit[]): Promise<void> {
  await git(dir, "init", "-q")
  await Bun.write(
    join(dir, phase.dir, "tasks.md"),
    renderTaskIndex("R-01.P01", units.map((unit) => ({ id: unit.id, title: unit.title }))),
  )
  for (const unit of units) {
    await mkdir(join(dir, "docs", unit.id), { recursive: true })
    await Bun.write(
      join(dir, "docs", unit.id, "todo.md"),
      [
        `# ${unit.id}: ${unit.title}`,
        "Phase: R-01.P01",
        ...(unit.root ? [] : ["Depends: none"]),
        ...(unit.touches ? [`Touches: ${unit.touches.join(", ")}`] : []),
        "",
        "## Goal",
        "",
        `Write ${unit.file}.`,
        "",
        "## Scope",
        "",
        "src only.",
        "",
        "## Acceptance",
        "",
        "The module reads back.",
        "",
        EOF_MARK,
        "",
      ].join("\n"),
    )
  }
  await writeScaffolding(dir)
  await git(dir, "add", "-A")
  await git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline")
}

// The fake lane worker's completion of one unit in its worktree, the real
// way: the unit's source file, the done rename + tick, the done commit.
async function completeUnit(worktree: string, unit: SchedUnit): Promise<void> {
  await mkdir(dirname(join(worktree, unit.file)), { recursive: true })
  await Bun.write(join(worktree, unit.file), unit.content ?? `export const done = "${unit.id}"\n`)
  await markDone({ dir: worktree, index: join(phase.dir, "tasks.md") }, unit.id)
  const settled = await commitTree(worktree, { id: unit.id, title: unit.title }, { stage: "done", subject: `${unit.id} done ${unit.title}` })
  if (!settled.ok) throw new Error(`completing ${unit.id} in the lane failed: ${settled.failures.map((failure) => failure.error).join("; ")}`)
}

// The scheduler's loop context (the loop fixture's shape): the installed
// services' router/control (the preload installs a fresh holder per test),
// the production git ops, and a fake agent's single host — the loop itself
// drives no session (D4); the host serves D15's serial degrade.
const agentHost = (): AgentHost => {
  const client = fakeClient({})
  return { client: client.client, syncContext: async () => {}, restart: async () => false, close: () => {} }
}

function schedulerCtx(server: AgentHost, opts: Partial<RunAllOpts>): LoopCtx {
  const holder = services()
  return {
    directory: dir,
    opts: { maxSessions: 2, subtask: "off", ...opts },
    server: { ...singleHost(server), startedAgents: () => ["fake"] },
    agentName: "auto",
    phases: "m",
    manual: true,
    ran: 0,
    router: holder.router,
    control: holder.control,
    git: createGitOps(),
  }
}

// Drives the task loop the way a run would: the ambient OPENCODE_AUTO_* layer
// scrubbed (the boundary hooks read the switches) and the switch memo reset
// so this pass parses the scrubbed environment; console.log captured so a
// case can assert the loop's own lines.
async function runScheduler(ctx: LoopCtx): Promise<{ code: number; lines: string[] }> {
  const ambient = Object.entries(process.env).filter(([key]) => key.startsWith("OPENCODE_AUTO_"))
  for (const [key] of ambient) delete process.env[key]
  setSwitchModelRegistry(undefined)
  const lines: string[] = []
  const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "))
  })
  try {
    return { code: await runTaskLoop(ctx, phase), lines }
  } finally {
    printed.mockRestore()
    for (const [key, value] of ambient) if (value !== undefined) process.env[key] = value
    setSwitchModelRegistry(undefined)
  }
}

// The park entries that still exist (the teardown's counterpart).
const parkEntries = async (): Promise<string[]> => readdir(join(dir, ".auto", "worktrees")).catch(() => [])

describe("runLaneLoop (§6.2, D10 active at maxSessions = 2)", () => {
  test("two fake-agent lanes side by side: the ready batch dispatches together, both land, the phase completes", async () => {
    await schedulerProject([
      { id: "T-001", title: "the alpha module", touches: ["src/alpha/"], file: "src/alpha/alpha.ts" },
      { id: "T-002", title: "the beta module", touches: ["src/beta/"], file: "src/beta/beta.ts" },
    ])
    // The launcher records the park's state at each launch: the second lane
    // launches while the first is still in flight (both worktrees present,
    // nothing landed yet) — the side-by-side property.
    const parks: string[][] = []
    setShellProfile({
      laneLauncher: (worktree, id) => {
        parks.push(readdirSync(join(dir, ".auto", "worktrees")).sort())
        const unit = id === "T-001" ? { id: "T-001", title: "the alpha module", file: "src/alpha/alpha.ts" } : { id: "T-002", title: "the beta module", file: "src/beta/beta.ts" }
        return workingStub(completeUnit(worktree, unit).then(() => writeLaneReport(worktree, reportOf(unit.id))))
      },
    })
    const run = await runScheduler(schedulerCtx(agentHost(), { parallel: "low" }))
    if (run.code !== 0) process.stderr.write(`DEBUG
${run.lines.join("\n")}
`)
    expect(run.code).toBe(0)
    expect(run.lines).toContain("✓ all tasks complete")
    // The second launch saw the first lane's worktree still parked.
    expect(parks).toEqual([["T-001"], ["T-001", "T-002"]])
    // Both units' work arrived in the main tree, done and ticked, with two
    // landing merges; the park and the branches are gone.
    expect(await Bun.file(join(dir, "src/alpha/alpha.ts")).text()).toContain("T-001")
    expect(await Bun.file(join(dir, "src/beta/beta.ts")).text()).toContain("T-002")
    expect(await Bun.file(join(dir, "docs/T-001/done.md")).exists()).toBe(true)
    expect(await Bun.file(join(dir, "docs/T-002/done.md")).exists()).toBe(true)
    expect(await Bun.file(join(dir, phase.dir, "tasks.md")).text()).toContain("- [x] T-001 the alpha module")
    expect(await Bun.file(join(dir, phase.dir, "tasks.md")).text()).toContain("- [x] T-002 the beta module")
    const log = await git(dir, "log", "--format=%B")
    expect(log.match(/Auto-Stage: landing\n/g)?.length).toBe(2)
    expect(await parkEntries()).toEqual([])
    expect(await changedFiles(dir)).toEqual([])
    expect(JSON.parse(await unitsText(dir)).tasks["T-001"].worktree).toBeUndefined()
  })

  test("a landing conflict at low blocks immediately: exit 2, the park path named, the scene kept", async () => {
    await schedulerProject([
      { id: "T-001", title: "the alpha module", touches: ["src/alpha/"], file: "src/shared.ts", content: "export const who = \"T-001\"\n" },
      { id: "T-002", title: "the beta module", touches: ["src/beta/"], file: "src/shared.ts", content: "export const who = \"T-002\"\n" },
    ])
    const units: Record<string, SchedUnit> = {
      "T-001": { id: "T-001", title: "the alpha module", file: "src/shared.ts", content: "export const who = \"T-001\"\n" },
      "T-002": { id: "T-002", title: "the beta module", file: "src/shared.ts", content: "export const who = \"T-002\"\n" },
    }
    setShellProfile({
      laneLauncher: (worktree, unit) => workingStub(completeUnit(worktree, units[unit]!).then(() => writeLaneReport(worktree, reportOf(unit)))),
    })
    const run = await runScheduler(schedulerCtx(agentHost(), { parallel: "low" }))
    expect(run.code).toBe(2)
    // T-001 landed (index order decides the race deterministically); T-002's
    // landing hit the conflict and blocked with the park path named.
    expect(run.lines.some((line) => line.startsWith("✓ T-001 done (lane landed:"))).toBe(true)
    const conflict = run.lines.find((line) => line.includes("T-002 landing conflict"))
    expect(conflict).toBeDefined()
    expect(conflict).toContain(lanePark("T-002"))
    expect(conflict).toContain("spends no tokens on merge repair")
    expect(await Bun.file(join(dir, "src/shared.ts")).text()).toBe("export const who = \"T-001\"\n")
    expect(await changedFiles(dir)).toEqual([])
    // The blocked lane's scene is kept: worktree, branch, registry record.
    expect(await parkEntries()).toEqual(["T-002"])
    expect((await git(dir, "branch", "--list", laneBranch("T-002"))).trim()).toContain(laneBranch("T-002"))
    expect(JSON.parse(await unitsText(dir)).tasks["T-002"].worktree).toBe(lanePark("T-002"))
  })

  test("a landing conflict at medium repairs once through the merge instruction and lands; a second conflict blocks", async () => {
    await schedulerProject([
      { id: "T-001", title: "the alpha module", touches: ["src/alpha/"], file: "src/shared.ts", content: "export const who = \"T-001\"\n" },
      { id: "T-002", title: "the beta module", touches: ["src/beta/"], file: "src/shared.ts", content: "export const who = \"T-002\"\n" },
    ])
    const units: Record<string, SchedUnit> = {
      "T-001": { id: "T-001", title: "the alpha module", file: "src/shared.ts", content: "export const who = \"T-001\"\n" },
      "T-002": { id: "T-002", title: "the beta module", file: "src/shared.ts", content: "export const who = \"T-002\"\n" },
    }
    // The repair the fake worker performs: the merge the instruction names,
    // the one conflicted file resolved by hand (the session's stand-in), and
    // the merge committed with the merge-repair trailer so the landing
    // verification still sees a driver-only range.
    const repair = async (worktree: string, branch: string, unit: SchedUnit) => {
      await git(worktree, "merge", branch).catch(() => {})
      await Bun.write(join(worktree, unit.file), `export const who = "merged"\n`)
      // The merge also conflicts the phase index (adjacent ticks); the
      // resolution takes the main side — the parent re-derives the ticks at
      // landing anyway (D6), and markers must never enter the branch.
      await git(worktree, "checkout", "--ours", "--", join(phase.dir, "tasks.md"))
      await git(worktree, "add", "-A")
      await git(worktree, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", `${unit.id} merge repair ${unit.title}\n\nAuto-Task: ${unit.id}\nAuto-Stage: merge-repair\n`)
    }
    const instructions: Array<{ unit: string; merge: string } | undefined> = []
    setShellProfile({
      laneLauncher: (worktree, unit, instruction) => {
        instructions.push(instruction && { unit, merge: instruction.merge })
        return workingStub(
          (async () => {
            if (instruction !== undefined) await repair(worktree, instruction.merge, units[unit]!)
            else await completeUnit(worktree, units[unit]!)
            await writeLaneReport(worktree, reportOf(unit))
          })(),
        )
      },
    })
    const main = (await git(dir, "rev-parse", "--abbrev-ref", "HEAD")).trim()
    const run = await runScheduler(schedulerCtx(agentHost(), { parallel: "medium" }))
    expect(run.code).toBe(0)
    // The repair re-dispatch carried the merge instruction naming the main
    // branch; the repair's merge commit landed inside the lane's history.
    expect(instructions).toEqual([undefined, undefined, { unit: "T-002", merge: main }])
    expect(run.lines.some((line) => line.includes("re-dispatching the lane with the merge instruction"))).toBe(true)
    const log = await git(dir, "log", "--format=%B")
    expect(log).toContain("Auto-Stage: merge-repair")
    expect(await Bun.file(join(dir, "src/shared.ts")).text()).toBe('export const who = "merged"\n')
    expect(await Bun.file(join(dir, "docs/T-002/done.md")).exists()).toBe(true)
    expect(await parkEntries()).toEqual([])
    expect(await changedFiles(dir)).toEqual([])

    // The second conflict blocks: the same lie with a launcher that ignores
    // the instruction (the repair did not resolve anything) blocks on the
    // retry.
    const second = await mkdtemp(join(tmpdir(), "auto-lanes-s3-"))
    const previous = dir
    dir = second
    await schedulerProject([
      { id: "T-001", title: "the alpha module", touches: ["src/alpha/"], file: "src/shared.ts", content: "export const who = \"T-001\"\n" },
      { id: "T-002", title: "the beta module", touches: ["src/beta/"], file: "src/shared.ts", content: "export const who = \"T-002\"\n" },
    ])
    setShellProfile({
      laneLauncher: (worktree, unit) => workingStub(completeUnit(worktree, units[unit]!).then(() => writeLaneReport(worktree, reportOf(unit)))),
    })
    const blocked = await runScheduler(schedulerCtx(agentHost(), { parallel: "medium" }))
    expect(blocked.code).toBe(2)
    expect(blocked.lines.some((line) => line.includes("T-002 landing conflict") && line.includes("the one repair is spent"))).toBe(true)
    expect(await parkEntries()).toEqual(["T-002"])
    await rm(second, { recursive: true, force: true })
    dir = previous
  })

  test("a crash (no report) is re-dispatched in place up to the cap; the recovery lands", async () => {
    await schedulerProject([{ id: "T-001", title: "the widget", touches: ["src/"], file: "src/widget.ts" }])
    const unit: SchedUnit = { id: "T-001", title: "the widget", file: "src/widget.ts" }
    let launches = 0
    setShellProfile({
      laneLauncher: (worktree, id) => {
        launches++
        // The first launch is the crash: no work, no report, exit 137.
        if (launches === 1) return stubWorker(137)
        return workingStub(completeUnit(worktree, unit).then(() => writeLaneReport(worktree, reportOf(id))))
      },
    })
    const run = await runScheduler(schedulerCtx(agentHost(), { parallel: "low" }))
    expect(run.code).toBe(0)
    expect(run.lines.some((line) => line.includes("exited without a report (exit 137)") && line.includes("re-dispatching the lane in place"))).toBe(true)
    expect(launches).toBe(2)
    expect(await unitAttempts(dir, "T-001")).toBe(2)
    expect(await Bun.file(join(dir, "docs/T-001/done.md")).exists()).toBe(true)
    expect(await parkEntries()).toEqual([])

    // The cap: a lane that crashes every dispatch blocks naming the park
    // path once begin's attempts reach the cap.
    const capDir = await mkdtemp(join(tmpdir(), "auto-lanes-s3-"))
    const previous = dir
    dir = capDir
    await schedulerProject([{ id: "T-001", title: "the widget", touches: ["src/"], file: "src/widget.ts" }])
    let crashes = 0
    setShellProfile({
      laneLauncher: () => {
        crashes++
        return stubWorker(137)
      },
    })
    const capped = await runScheduler(schedulerCtx(agentHost(), { parallel: "low" }))
    expect(capped.code).toBe(2)
    // A fresh project: the loop dispatched three times (the cap), every
    // dispatch crashed, the third hit the cap and blocked.
    expect(crashes).toBe(3)
    expect(await unitAttempts(dir, "T-001")).toBe(LANE_DISPATCH_CAP)
    expect(capped.lines.some((line) => line.includes("the dispatch attempts cap") && line.includes(lanePark("T-001")))).toBe(true)
    expect(await parkEntries()).toEqual(["T-001"])
    await rm(capDir, { recursive: true, force: true })
    dir = previous
  })

  test("a FAIL report blocks with its committed work landed (failure keeps its commit)", async () => {
    await schedulerProject([{ id: "T-001", title: "the widget", touches: ["src/"], file: "src/broken.ts" }])
    setShellProfile({
      laneLauncher: (worktree, unit) => {
        return workingStub(
          (async () => {
            // The session's work is committed; the wrap-up's verdict is FAIL:
            // the unit is not done, the work stays.
            await mkdir(dirname(join(worktree, "src/broken.ts")), { recursive: true })
            await Bun.write(join(worktree, "src/broken.ts"), "export const broken = true\n")
            const settled = await commitTree(worktree, { id: unit, title: "the widget" }, { stage: "session", subject: `${unit} the work so far` })
            if (!settled.ok) throw new Error("commit failed")
            await writeLaneReport(worktree, reportOf(unit, { ok: false, result: "FAIL", blocked: "the task report concluded Result: FAIL" }))
          })(),
          2,
        )
      },
    })
    const run = await runScheduler(schedulerCtx(agentHost(), { parallel: "low" }))
    expect(run.code).toBe(2)
    expect(run.lines.some((line) => line.includes("T-001 blocked: its committed work landed"))).toBe(true)
    expect(run.lines.some((line) => line.includes("T-001 is blocked") && line.includes("Result: FAIL"))).toBe(true)
    // The committed work is in the main tree; the unit is blocked, not done;
    // the landed scene is torn down.
    expect(await Bun.file(join(dir, "src/broken.ts")).text()).toBe("export const broken = true\n")
    expect(await Bun.file(join(dir, "docs/T-001/done.md")).exists()).toBe(false)
    expect(JSON.parse(await unitsText(dir)).tasks["T-001"].status).toBe("blocked")
    expect(await parkEntries()).toEqual([])
    expect(await changedFiles(dir)).toEqual([])
  })

  test("an environment error (exit 1) stops scheduling and exits 1 with the relayed lines", async () => {
    await schedulerProject([{ id: "T-001", title: "the widget", touches: ["src/"], file: "src/widget.ts" }])
    setShellProfile({
      laneLauncher: (worktree, unit) =>
        workingStub(
          (async () => {
            await writeLaneReport(worktree, reportOf(unit))
          })(),
          1,
        ),
    })
    // The worker's piped output is the relay source: a stub without streams
    // relays nothing, so the case checks the exit and the stop, not the tail.
    const run = await runScheduler(schedulerCtx(agentHost(), { parallel: "low" }))
    expect(run.code).toBe(1)
    expect(run.lines.some((line) => line.includes("lane worker failed with an environment error (exit 1)"))).toBe(true)
    // Nothing lands on the environment path — the scene stays for the next
    // run's preflight recovery (the report on disk tells it to land).
    expect(await parkEntries()).toEqual(["T-001"])
    expect(await changedFiles(dir)).toEqual([])
  })

  test("a /exit seen at a landing stops scheduling, drains the other lane, then takes effect (exit 3)", async () => {
    await schedulerProject([
      { id: "T-001", title: "the alpha module", touches: ["src/alpha/"], file: "src/alpha/alpha.ts" },
      { id: "T-002", title: "the beta module", touches: ["src/beta/"], file: "src/beta/beta.ts" },
    ])
    const units: Record<string, SchedUnit> = {
      "T-001": { id: "T-001", title: "the alpha module", file: "src/alpha/alpha.ts" },
      "T-002": { id: "T-002", title: "the beta module", file: "src/beta/beta.ts" },
    }
    let launches = 0
    let control: LoopCtx["control"] | undefined
    setShellProfile({
      laneLauncher: (worktree, unit) => {
        launches++
        return workingStub(
          (async () => {
            // T-001's landing boundary sees the /exit request; T-002 is
            // still in flight and must land before it takes effect.
            if (unit === "T-001") control?.requestExit()
            await completeUnit(worktree, units[unit]!)
            await writeLaneReport(worktree, reportOf(unit))
          })(),
        )
      },
    })
    const ctx = schedulerCtx(agentHost(), { parallel: "low" })
    control = ctx.control
    let thrown: unknown
    try {
      await runScheduler(ctx)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ExitRequested)
    // The drain landed T-002 before the throw, and nothing else dispatched.
    expect(launches).toBe(2)
    expect(await Bun.file(join(dir, "docs/T-001/done.md")).exists()).toBe(true)
    expect(await Bun.file(join(dir, "docs/T-002/done.md")).exists()).toBe(true)
    expect(await parkEntries()).toEqual([])
  })

  test("D15's serial degrade: a unit touching a nested repository runs in the main tree, never as a lane", async () => {
    await schedulerProject([{ id: "T-001", title: "the vendored piece", touches: ["vendor/lib/"], file: "src/widget.ts" }])
    // The nested repository that makes the unit not lane-eligible.
    await mkdir(join(dir, "vendor", "lib"), { recursive: true })
    await git(join(dir, "vendor", "lib"), "init", "-q")
    await Bun.write(join(dir, "vendor", "lib", "README.md"), "vendored\n")
    await git(join(dir, "vendor", "lib"), "add", "-A")
    await git(join(dir, "vendor", "lib"), "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "vendored")
    await git(dir, "add", "-A")
    await git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "nested vendor")
    // The serial degrade's sessions over the scripted fake agent: the
    // whole-task turn writes the source, the wrap-up turn the passing report.
    let round = 0
    const client = fakeClient({
      events: (sid) =>
        (async function* () {
          const script = [
            async () => {
              await Bun.write(join(dir, "src", "widget.ts"), "export const widget = 1\n")
            },
            async () => {
              await Bun.write(join(dir, "docs", "T-001", "report.md"), `# T-001 report\n\n${"Delivered. ".repeat(20)}\n\nResult: PASS\n\n${EOF_MARK}\n`)
            },
          ][Math.min(round++, 1)]!
          await script()
          yield { type: "session.idle", properties: { sessionID: sid } }
        })(),
    })
    const host: AgentHost = { client: client.client, syncContext: async () => {}, restart: async () => false, close: () => {} }
    setShellProfile({
      laneLauncher: () => {
        throw new Error("no lane may be dispatched for a nested-repo unit")
      },
    })
    const run = await runScheduler(schedulerCtx(host, { parallel: "low" }))
    expect(run.code).toBe(0)
    expect(run.lines.some((line) => line.includes("cannot be isolated") && line.includes("running it serially in the main tree"))).toBe(true)
    expect(await Bun.file(join(dir, "src", "widget.ts")).text()).toBe("export const widget = 1\n")
    expect(await Bun.file(join(dir, "docs", "T-001", "done.md")).exists()).toBe(true)
    expect(await parkEntries()).toEqual([])
    expect(await changedFiles(dir)).toEqual([])
  })
})

// —— The observability surfaces (D13/§6.7, stage S4) —— //

// A worker stub whose stdout is a hand-built stream of chunks (the relay's
// input): the chunks cross line boundaries on purpose — the relay must
// reassemble, not relay fragments.
const streamOf = (chunks: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
  })

describe("relayLaneOutput (D13's prefix relay)", () => {
  test("every relayed line carries the [<unit>] prefix; empty lines drop; a final partial line still relays; the promise keeps the raw text", async () => {
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "))
    })
    try {
      const worker: LaneWorker = {
        pid: 4242,
        exited: Promise.resolve(0),
        stdout: streamOf(["first line\nsecond", " line\n\n", "tail without a newline"]),
        stderr: streamOf(["err line\r\n"]),
      }
      const output = await relayLaneOutput("T-001", worker)
      // The relayed story: both whole lines, the split line reassembled, the
      // blank line dropped, the CR stripped, the partial tail flushed. The
      // two streams interleave (live arrival order, not a fixed
      // stdout-then-stderr sequence) — the stderr line is asserted by
      // membership, the stdout story by its own order.
      expect(lines.filter((line) => !line.includes("err line"))).toEqual(["[T-001] first line", "[T-001] second line", "[T-001] tail without a newline"])
      expect(lines).toContain("[T-001] err line")
      expect(lines.every((line) => line.startsWith("[T-001] "))).toBe(true)
      // The raw text (the failure matrix's tail source) is the un-prefixed
      // stream content, stdout then stderr.
      expect(output).toBe("first line\nsecond line\n\ntail without a newlineerr line\r\n")
    } finally {
      printed.mockRestore()
    }
  })

  test("a worker without streams relays nothing and resolves empty (the stub launcher's shape)", async () => {
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "))
    })
    try {
      expect(await relayLaneOutput("T-001", stubWorker())).toBe("")
      expect(lines).toEqual([])
    } finally {
      printed.mockRestore()
    }
  })
})

describe("the lane loop's observability (D13/§6.7, S4)", () => {
  // Two units whose reports carry the usage detail: the booking folds into
  // the phase/round buckets and the conclusion's roll-up can claim it.
  const DETAIL = {
    usage: { input: 90, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0.01, steps: 2 },
    models: { fake: { usage: { input: 90, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0.01, steps: 2 }, sessions: 2, fails: 0, stuckHints: 0, reprompts: 0 } },
    tiers: { simple: { usage: { input: 90, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0.01, steps: 2 }, sessions: 2 } },
  }

  test("a two-lane run: every relayed line is prefixed, the lane events carry the identity, both reports' usage books", async () => {
    await schedulerProject([
      { id: "T-001", title: "the alpha module", touches: ["src/alpha/"], file: "src/alpha/alpha.ts" },
      { id: "T-002", title: "the beta module", touches: ["src/beta/"], file: "src/beta/beta.ts" },
    ])
    const units: Record<string, SchedUnit> = {
      "T-001": { id: "T-001", title: "the alpha module", file: "src/alpha/alpha.ts" },
      "T-002": { id: "T-002", title: "the beta module", file: "src/beta/beta.ts" },
    }
    const events: RunStatusEvent[] = []
    const off = addStatusSink((event) => events.push(event))
    startRunStatus(dir)
    try {
      setShellProfile({
        laneLauncher: (worktree, unit) => ({
          ...workingStub(completeUnit(worktree, units[unit]!).then(() => writeLaneReport(worktree, reportOf(unit, { detail: DETAIL })))),
          stdout: streamOf([`worker of ${unit}: line one\n`, `worker of ${unit}: line two\n`]),
          stderr: null,
        }),
      })
      const run = await runScheduler(schedulerCtx(agentHost(), { parallel: "low" }))
      expect(run.code).toBe(0)
      // The prefix relay: every worker line reached the parent prefixed with
      // its lane's id (four lines — two per lane).
      const relayed = run.lines.filter((line) => line.includes("worker of T-00"))
      expect(relayed).toHaveLength(4)
      expect(relayed.every((line) => /^\[T-00\d\] worker of T-00\d: line (one|two)$/.test(line))).toBe(true)
    } finally {
      off()
      stopRunStatus()
      setShellProfile({ laneLauncher: undefined })
    }
    // The 0067 bus's lane identity: dispatch → exit → landing per lane, in
    // dispatch order, typed facts only (no terminal text parsed).
    expect(events.filter((event) => event.type === "lane-dispatch").map((event) => (event as { lane: string }).lane)).toEqual(["T-001", "T-002"])
    for (const dispatch of events.filter((event) => event.type === "lane-dispatch")) {
      expect(dispatch).toMatchObject({ worktree: expect.stringContaining(join(".auto", "worktrees")), pid: 4242 })
      expect(dispatch).not.toHaveProperty("merge")
    }
    const exits = events.filter((event) => event.type === "lane-exit")
    expect(exits).toHaveLength(2)
    for (const exit of exits) expect(exit).toMatchObject({ code: 0, report: true, result: "PASS" })
    const landings = events.filter((event) => event.type === "lane-landing")
    expect(landings.map((landing) => (landing as { lane: string }).lane).sort()).toEqual(["T-001", "T-002"])
    for (const landing of landings) expect(landing).toMatchObject({ outcome: "landed", tokens: 100, wallMs: 1000, sessions: 2 })
    // Both reports' usage booked: the per-unit lanes entries marked booked,
    // the fold visible in the round bucket (sessions, usage, the model and
    // tier records) — never in the task bucket.
    const stats = JSON.parse(await Bun.file(join(dir, ".auto", "stats.json")).text())
    expect(stats.lanes).toEqual({
      "T-001": { tokens: 100, wallMs: 1000, sessions: 2, booked: true },
      "T-002": { tokens: 100, wallMs: 1000, sessions: 2, booked: true },
    })
    expect(stats.roundB.sessions).toBe(4)
    // Two bookings of DETAIL: the flat usage doubled, the model and tier
    // records with it.
    expect(stats.roundB.usage).toEqual({ input: 180, output: 20, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0.02, steps: 4 })
    expect(stats.roundB.models.fake).toEqual({ usage: { input: 180, output: 20, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0.02, steps: 4 }, sessions: 4, fails: 0, stuckHints: 0, reprompts: 0 })
    expect(stats.roundB.tiers.simple).toEqual({ usage: { input: 180, output: 20, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0.02, steps: 4 }, sessions: 4 })
    expect(stats.taskB.usage.input).toBe(0)
    expect(stats.taskB.models).toBeUndefined()
  })

  test("a FAIL run: the exit, the landing of the committed work and the block all carry the lane identity", async () => {
    await schedulerProject([{ id: "T-001", title: "the widget", touches: ["src/"], file: "src/broken.ts" }])
    const events: RunStatusEvent[] = []
    const off = addStatusSink((event) => events.push(event))
    startRunStatus(dir)
    try {
      setShellProfile({
        laneLauncher: (worktree, unit) =>
          workingStub(
            (async () => {
              await mkdir(dirname(join(worktree, "src/broken.ts")), { recursive: true })
              await Bun.write(join(worktree, "src/broken.ts"), "export const broken = true\n")
              const settled = await commitTree(worktree, { id: unit, title: "the widget" }, { stage: "session", subject: `${unit} the work so far` })
              if (!settled.ok) throw new Error("commit failed")
              await writeLaneReport(worktree, reportOf(unit, { ok: false, result: "FAIL", blocked: "the task report concluded Result: FAIL" }))
            })(),
            2,
          ),
      })
      const run = await runScheduler(schedulerCtx(agentHost(), { parallel: "low" }))
      expect(run.code).toBe(2)
    } finally {
      off()
      stopRunStatus()
      setShellProfile({ laneLauncher: undefined })
    }
    expect(events.filter((event) => event.type === "lane-exit")).toHaveLength(1)
    expect(events.find((event) => event.type === "lane-exit")).toMatchObject({ lane: "T-001", code: 2, report: true, result: "FAIL" })
    // Failure keeps its commit: the blocked lane's committed work lands, and
    // the block that stops the run names the lane and its reason.
    expect(events.find((event) => event.type === "lane-landing")).toMatchObject({ lane: "T-001", outcome: "landed" })
    expect(events.find((event) => event.type === "lane-block")).toMatchObject({ lane: "T-001", reason: expect.stringContaining("Result: FAIL") })
  })
})

// —— Orphan recovery (D14, at the next parent run's preflight) —— //

// A crashed lane's scene: the worktree on the lane branch holding the unit's
// committed done work, the registry entry naming a pid, and no lane report
// (the worker died before any controlled exit). Returns the scene's pid (the
// dead worker the record names).
async function crashScene(unit: SchedUnit, pid: number, report?: LaneReport): Promise<void> {
  const park = join(dir, lanePark(unit.id))
  const added = await createGitOps().addWorktree(dir, park, laneBranch(unit.id))
  if (!added.ok) throw new Error(added.error)
  // The scaffolding a real dispatch copies in (the report written later under
  // .auto/ must be ignored dirt, not a landing violation).
  await writeScaffolding(park)
  await completeUnit(park, unit)
  if (report) await writeLaneReport(park, report)
  await begin(dir, unit.id)
  await setLane(dir, unit.id, { worktree: lanePark(unit.id), pid })
}

// A pid that is certainly dead: a process spawned and reaped for the purpose.
async function deadPid(): Promise<number> {
  const proc = Bun.spawn(["true"])
  await proc.exited
  return proc.pid!
}

describe("recoverOrphanLanes (D14)", () => {
  test("a dead pid with a worktree present is re-dispatched in place and lands; the run continues", async () => {
    await schedulerProject([{ id: "T-001", title: "the widget", touches: ["src/"], file: "src/widget.ts" }])
    await crashScene({ id: "T-001", title: "the widget", file: "src/widget.ts" }, await deadPid())
    // The re-dispatched worker sees a complete unit: it answers with the
    // report of the finished work (the real entry's short-circuit).
    setShellProfile({
      laneLauncher: (worktree, unit) => workingStub(writeLaneReport(worktree, reportOf(unit))),
    })
    const code = await recoverOrphanLanes(createGitOps(), dir)
    expect(code).toBeUndefined()
    expect(await Bun.file(join(dir, "docs/T-001/done.md")).exists()).toBe(true)
    expect(await Bun.file(join(dir, "src/widget.ts")).text()).toContain("T-001")
    expect(await Bun.file(join(dir, phase.dir, "tasks.md")).text()).toContain("- [x] T-001 the widget")
    expect(await parkEntries()).toEqual([])
    expect(await unitAttempts(dir, "T-001")).toBe(2)
    expect(await changedFiles(dir)).toEqual([])
    setShellProfile({ laneLauncher: undefined })
  })

  test("a live pid is awaited then landed (the cattle property)", async () => {
    await schedulerProject([{ id: "T-001", title: "the widget", touches: ["src/"], file: "src/widget.ts" }])
    // A live worker that already wrote its report and exits on its own: the
    // recovery awaits the pid, then lands the report.
    const worker = Bun.spawn(["sleep", "1"])
    await crashScene({ id: "T-001", title: "the widget", file: "src/widget.ts" }, worker.pid!, reportOf("T-001"))
    const started = Date.now()
    const code = await recoverOrphanLanes(createGitOps(), dir)
    expect(code).toBeUndefined()
    // The await really waited for the worker's exit.
    expect(Date.now() - started).toBeGreaterThanOrEqual(900)
    expect(await Bun.file(join(dir, "docs/T-001/done.md")).exists()).toBe(true)
    expect(await parkEntries()).toEqual([])
    await worker.exited
  })

  test("the attempts cap blocks naming the park path", async () => {
    await schedulerProject([{ id: "T-001", title: "the widget", touches: ["src/"], file: "src/widget.ts" }])
    await crashScene({ id: "T-001", title: "the widget", file: "src/widget.ts" }, await deadPid())
    // The unit's attempts already sit at the cap (three dispatches booked).
    while ((await unitAttempts(dir, "T-001")) < LANE_DISPATCH_CAP) await begin(dir, "T-001")
    setShellProfile({
      laneLauncher: () => stubWorker(137),
    })
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "))
    })
    let code: number | undefined
    try {
      code = await recoverOrphanLanes(createGitOps(), dir)
    } finally {
      printed.mockRestore()
    }
    expect(code).toBe(2)
    expect(lines.some((line) => line.includes("dispatch attempts cap") && line.includes(lanePark("T-001")))).toBe(true)
    expect(await parkEntries()).toEqual(["T-001"])
    setShellProfile({ laneLauncher: undefined })
  })

  test("a record naming a missing worktree blocks", async () => {
    await schedulerProject([{ id: "T-001", title: "the widget", touches: ["src/"], file: "src/widget.ts" }])
    await begin(dir, "T-001")
    await setLane(dir, "T-001", { worktree: lanePark("T-001"), pid: await deadPid() })
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "))
    })
    let code: number | undefined
    try {
      code = await recoverOrphanLanes(createGitOps(), dir)
    } finally {
      printed.mockRestore()
    }
    expect(code).toBe(2)
    expect(lines.some((line) => line.includes("no longer exists"))).toBe(true)
  })

  test("park stragglers with no registry entry are pruned; one holding a live run lock is left alone", async () => {
    await schedulerProject([{ id: "T-001", title: "the widget", touches: ["src/"], file: "src/widget.ts" }])
    // A straggler git knows about (the dispatch died between the worktree's
    // creation and the registry write)…
    const stray = join(dir, lanePark("T-009"))
    const added = await createGitOps().addWorktree(dir, stray, laneBranch("T-009"))
    expect(added.ok).toBe(true)
    // …and one that only exists as a directory holding a live run lock.
    const locked = join(dir, lanePark("T-010"))
    await mkdir(join(locked, ".auto"), { recursive: true })
    const worker = Bun.spawn(["sleep", "2"])
    await writeFile(join(locked, RUN_LOCK_FILE), `${JSON.stringify({ pid: worker.pid, host: hostname(), command: "run", started: new Date().toISOString() })}\n`)
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "))
    })
    let code: number | undefined
    try {
      code = await recoverOrphanLanes(createGitOps(), dir)
    } finally {
      printed.mockRestore()
    }
    expect(code).toBeUndefined()
    expect(await dirExists(stray)).toBe(false)
    expect((await git(dir, "branch", "--list", laneBranch("T-009"))).trim()).toBe("")
    expect(lines.some((line) => line.includes("removed: the park straggler"))).toBe(true)
    expect(await dirExists(locked)).toBe(true)
    expect(lines.some((line) => line.includes("leaving it alone"))).toBe(true)
    await worker.exited
  })
})

// —— Stream lanes (plans/0068 S5: D3 stage 2, D19, §6.8) —— //

// A two-stream split of T-001, the second waiting for the first (a dependent
// stream's lane starts only after its sibling landed), and the independent
// two-stream shape (both co-dispatched, the wrap-up left to the closing lane).
const DEPENDENT_SPLIT = [
  "- [ ] alpha: the alpha module in src/alpha.ts, verify it by reading it back Depends: none Artifacts: src/alpha.ts",
  "- [ ] beta: the beta module in src/beta.ts on alpha, verify it by reading it back Depends: S01 Artifacts: src/beta.ts",
  "",
].join("\n")
const INDEPENDENT_SPLIT = [
  "- [ ] alpha: the alpha module in src/alpha.ts, verify it by reading it back Depends: none Artifacts: src/alpha.ts",
  "- [ ] beta: the beta module in src/beta.ts beside it, verify it by reading it back Depends: none Artifacts: src/beta.ts",
  "",
].join("\n")

// The lead's landing shape: the checklist, the scope files and the lead's own
// work committed, the split recorded in the given tree's registry (the real
// lead lane writes all of this inside its worktree; a hand-built scene writes
// it wherever the caller points — the main tree for the pure cases, the lead
// worktree for the loop's).
async function takeSplit(root: string, text: string, task: { id: string; title: string }, work = true): Promise<{ items: number; baseline: { root: string; sha: string }[] }> {
  const items = parseSplit(text)
  await writeSplitTodos(root, task.id, items)
  await Bun.write(join(root, taskDoc(task.id, "subtasks")), text)
  if (work) {
    await mkdir(join(root, "src"), { recursive: true })
    await Bun.write(join(root, "src", "shared.ts"), "export const shared = 1\n")
  }
  const settled = await commitTree(root, task, { stage: "execute", subject: `${task.id} exec ${task.title}` })
  if (!settled.ok) throw new Error(`the lead's exec commit failed: ${settled.failures.map((failure) => failure.error).join("; ")}`)
  // The split point: every repository's HEAD right after the lead's commit,
  // recorded in this tree's own registry (execute.ts's own order).
  const baseline = await unitBaseline(root)
  await setSplit(root, task.id, baseline)
  return { items: items.length, baseline }
}

describe("streamUnits (D3 stage 2, §6.8)", () => {
  const unit = (id: string, title: string, over: Partial<Task> = {}): Task => ({ id, title, status: "pending", attempts: 0, body: "", ...over })

  test("derives the streams of a taken split: qualified ids, resolved depends, touches from the artifacts, done flags from the state files", async () => {
    await schedulerProject([{ id: "T-001", title: "the widget", touches: ["src/"], file: "src/widget.ts" }])
    const plan = await loadPlan(dir, phase)
    await takeSplit(dir, DEPENDENT_SPLIT, plan.tasks[0]!)
    const fresh = await loadPlan(dir, phase)
    expect(await streamUnits(dir, fresh.tasks[0]!)).toEqual([
      { id: "T-001.S01", title: "alpha", status: "pending", attempts: 0, body: "", depends: "none", touches: ["src/alpha.ts"], checklist: [] },
      { id: "T-001.S02", title: "beta", status: "pending", attempts: 0, body: "", depends: ["T-001.S01"], touches: ["src/beta.ts"], checklist: [] },
    ])
    // A landed stream drops out of the pending set by its done flag (the
    // state file, not the tick): S01 done → only S02 remains schedulable.
    await renameTodoToDone(dir, "T-001", 1)
    await tickSubtask(dir, "T-001", 1)
    const landed = await loadPlan(dir, phase)
    const units = (await streamUnits(dir, landed.tasks[0]!))!
    expect(units.map((item) => [item.id, item.status])).toEqual([
      ["T-001.S01", "done"],
      ["T-001.S02", "pending"],
    ])
    // The grammar helper round-trips the ids the loop parses back apart.
    expect(streamUnitOf("T-001.S02")).toEqual({ task: "T-001", index: 2 })
    expect(streamUnitOf("T-001")).toBeUndefined()
  })

  test("no split record, or no state protocol: the task stays whole (undefined)", async () => {
    await schedulerProject([{ id: "T-001", title: "the widget", touches: ["src/"], file: "src/widget.ts" }])
    const plan = await loadPlan(dir, phase)
    const task = plan.tasks[0]!
    // A checklist without the record (a true-mode decomposition or a
    // hand-written checklist) is not a stream fan-out.
    await writeSplitTodos(dir, "T-001", parseSplit(DEPENDENT_SPLIT))
    await Bun.write(join(dir, taskDoc("T-001", "subtasks")), DEPENDENT_SPLIT)
    const withFiles = await loadPlan(dir, phase)
    expect(await streamUnits(dir, withFiles.tasks[0]!)).toBeUndefined()
    // The record without the state files (nothing taken yet) likewise.
    await setSplit(dir, "T-001", await unitBaseline(dir))
    expect(await streamUnits(dir, task)).toBeUndefined()
  })
})

describe("runLaneLoop with a taken split (S5, D19)", () => {
  test("the lead lane lands its split; the dependent stream lanes run from the split baseline; the last stream's lane runs the wrap-up and closes the task", async () => {
    await schedulerProject([{ id: "T-001", title: "the widget", root: true, file: "src/widget.ts" }])
    const launches: string[] = []
    const seeded: Record<string, unknown> = {}
    let wrappedIn: string | undefined
    setShellProfile({
      laneLauncher: (worktree, unit) => {
        launches.push(unit)
        const stream = streamUnitOf(unit)
        return workingStub(
          (async () => {
            if (stream === undefined) {
              // The lead: the split taken and committed, the record in its
              // own registry, the report carrying it (the real lane worker's
              // lead-stop shape — its unit closes, the task goes on).
              const split = await takeSplit(worktree, DEPENDENT_SPLIT, { id: "T-001", title: "the widget" })
              await writeLaneReport(worktree, reportOf("T-001", { split }))
              return
            }
            // A stream lane: the seeded split record (re-rooted onto this
            // worktree) is its own registry's first fact.
            seeded[unit] = JSON.parse(await Bun.file(join(worktree, UNITS_FILE)).text()).tasks["T-001"]?.split
            const file = stream.index === 1 ? "src/alpha.ts" : "src/beta.ts"
            await mkdir(dirname(join(worktree, file)), { recursive: true })
            await Bun.write(join(worktree, file), `export const done = "${unit}"\n`)
            await renameTodoToDone(worktree, "T-001", stream.index)
            await tickSubtask(worktree, "T-001", stream.index)
            const settled = await commitTree(worktree, { id: "T-001", title: "the widget" }, { stage: `subtask ${stream.index}`, subject: `T-001 S${stream.index} the widget` })
            if (!settled.ok) throw new Error("the stream's commit failed")
            // The last stream (every sibling done in this worktree's own
            // merged view) runs the wrap-up and the close-out in its lane.
            const items = await readChecklist(worktree, "T-001")
            if (items.every((item) => item.done)) {
              wrappedIn = unit
              await Bun.write(join(worktree, taskDoc("T-001", "report")), `# T-001 report\n\n${"Delivered. ".repeat(20)}\n\nResult: PASS\n\n${EOF_MARK}\n`)
              await markDone({ dir: worktree, index: join(phase.dir, "tasks.md") }, "T-001")
              const closed = await commitTree(worktree, { id: "T-001", title: "the widget" }, { stage: "done", subject: "T-001 done the widget" })
              if (!closed.ok) throw new Error("the close-out commit failed")
            }
            await writeLaneReport(worktree, reportOf(unit))
          })(),
        )
      },
    })
    const run = await runScheduler(schedulerCtx(agentHost(), { parallel: "low" }))
    if (run.code !== 0) process.stderr.write(`DEBUG\n${run.lines.join("\n")}\n`)
    expect(run.code).toBe(0)
    // The scheduling story: the lead lane first (the task unit), its landing
    // expands the split — S02 waits for S01, so the streams run one after
    // the other, each its own lane unit, and no task lane re-runs between
    // them (the task is suppressed while a stream is pending).
    expect(launches).toEqual(["T-001", "T-001.S01", "T-001.S02"])
    expect(run.lines.some((line) => line.includes("T-001 landed (lane unit closed; the task continues in its other lanes"))).toBe(true)
    // The split record travelled: the lead worktree's registry died at
    // teardown, the parent re-persisted it at landing (re-rooted onto the
    // main tree), and every stream's fresh worktree was seeded with it
    // (re-rooted again onto that worktree) before its spawn.
    const parent = JSON.parse(await unitsText(dir)).tasks["T-001"].split
    expect(parent.map((line: { root: string }) => line.root)).toEqual([dir])
    for (const unit of ["T-001.S01", "T-001.S02"]) {
      expect((seeded[unit] as { root: string }[]).map((line) => line.root)).toEqual([join(dir, lanePark(unit))])
    }
    // The last stream's lane ran the wrap-up and closed the task.
    expect(wrappedIn).toBe("T-001.S02")
    // The end state: both streams' work landed, the checklist and the task
    // closed, the index ticked, the park torn down, the tree clean.
    expect(await Bun.file(join(dir, "src", "alpha.ts")).text()).toContain("T-001.S01")
    expect(await Bun.file(join(dir, "src", "beta.ts")).text()).toContain("T-001.S02")
    expect(await Bun.file(join(dir, "docs", "T-001", "S01", "done.md")).exists()).toBe(true)
    expect(await Bun.file(join(dir, "docs", "T-001", "S02", "done.md")).exists()).toBe(true)
    expect(await Bun.file(join(dir, "docs", "T-001", "done.md")).exists()).toBe(true)
    expect(await Bun.file(join(dir, taskDoc("T-001", "report"))).text()).toContain("Result: PASS")
    expect(await Bun.file(join(dir, phase.dir, "tasks.md")).text()).toContain("- [x] T-001 the widget")
    expect(await parkEntries()).toEqual([])
    expect(await changedFiles(dir)).toEqual([])
    expect((await git(dir, "branch", "--list", "auto-lane/T-001*")).trim()).toBe("")
  })

  test("co-dispatched streams (none last at its own start) leave the wrap-up to the closing lane after the drain", async () => {
    await schedulerProject([{ id: "T-001", title: "the widget", root: true, file: "src/widget.ts" }])
    const launches: string[] = []
    const streamsInFlightTogether: string[][] = []
    let wrappedIn: string | undefined
    setShellProfile({
      laneLauncher: (worktree, unit) => {
        launches.push(unit)
        if (unit === "T-001.S02") streamsInFlightTogether.push(readdirSync(join(dir, ".auto", "worktrees")).sort())
        const stream = streamUnitOf(unit)
        return workingStub(
          (async () => {
            if (stream === undefined) {
              const first = !await Bun.file(join(worktree, taskDoc("T-001", "subtasks"))).exists()
              if (first) {
                const split = await takeSplit(worktree, INDEPENDENT_SPLIT, { id: "T-001", title: "the widget" })
                await writeLaneReport(worktree, reportOf("T-001", { split }))
                return
              }
              // The closing lane: every stream done, the task unit returns as
              // the pipeline tail — the wrap-up and the close-out, nothing
              // else (the shape the lead's re-entry takes after the drain).
              wrappedIn = unit
              await Bun.write(join(worktree, taskDoc("T-001", "report")), `# T-001 report\n\n${"Delivered. ".repeat(20)}\n\nResult: PASS\n\n${EOF_MARK}\n`)
              await markDone({ dir: worktree, index: join(phase.dir, "tasks.md") }, "T-001")
              const closed = await commitTree(worktree, { id: "T-001", title: "the widget" }, { stage: "done", subject: "T-001 done the widget" })
              if (!closed.ok) throw new Error("the close-out commit failed")
              await writeLaneReport(worktree, reportOf(unit))
              return
            }
            const file = stream.index === 1 ? "src/alpha.ts" : "src/beta.ts"
            await mkdir(dirname(join(worktree, file)), { recursive: true })
            await Bun.write(join(worktree, file), `export const done = "${unit}"\n`)
            await renameTodoToDone(worktree, "T-001", stream.index)
            await tickSubtask(worktree, "T-001", stream.index)
            const settled = await commitTree(worktree, { id: "T-001", title: "the widget" }, { stage: `subtask ${stream.index}`, subject: `T-001 S${stream.index} the widget` })
            if (!settled.ok) throw new Error("the stream's commit failed")
            await writeLaneReport(worktree, reportOf(unit))
          })(),
        )
      },
    })
    const run = await runScheduler(schedulerCtx(agentHost(), { parallel: "low" }))
    if (run.code !== 0) process.stderr.write(`DEBUG\n${run.lines.join("\n")}\n`)
    expect(run.code).toBe(0)
    // The lead first, both streams side by side (co-dispatched — S02's launch
    // saw S01's worktree still parked), then the closing lane after the
    // drain; the wrap-up ran there, not in either stream.
    expect(launches[0]).toBe("T-001")
    expect(launches.slice(1, 3).sort()).toEqual(["T-001.S01", "T-001.S02"])
    expect(launches[3]).toBe("T-001")
    expect(streamsInFlightTogether).toEqual([["T-001.S01", "T-001.S02"]])
    expect(wrappedIn).toBe("T-001")
    expect(await Bun.file(join(dir, "docs", "T-001", "done.md")).exists()).toBe(true)
    expect(await Bun.file(join(dir, phase.dir, "tasks.md")).text()).toContain("- [x] T-001 the widget")
    expect(await parkEntries()).toEqual([])
    expect(await changedFiles(dir)).toEqual([])
  })
})
