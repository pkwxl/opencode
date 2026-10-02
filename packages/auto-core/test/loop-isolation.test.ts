// The isolation loop's own suite (plans/0068 §7 S2 / D10 — the coverage gap
// the review 0069 §3.3 found: the switch was touched only by
// switches.test.ts): runIsolationLoop, the one-lane-at-a-time task loop
// behind OPENCODE_AUTO_LANE_ISOLATION, driven through runTaskLoop the way a
// run reaches it — over real git repositories with the lane launcher
// stubbed through the shell profile (no process spawn; the stub answers an
// already-exited worker, or one whose exit lands only after its work). What
// the suite pins, from 0068's isolation contract:
//   - switch-on: every unit of the phase dispatches as an isolation lane,
//     one at a time, in the serial loop's own next() order (a second ready
//     unit waits), and the switch outranks the readiness scheduler (the S3
//     branch order: a run asking both width and isolation gets isolation);
//   - landing and re-entry: each lane lands through D7's protocol (the
//     Auto-Stage: landing merge beside the lane's own Auto-Stage: done
//     terminal commit, the landing-sync tick re-derivation, the park
//     teardown) and the loop re-enters after a landing and, on the re-run,
//     after a block;
//   - §6.2's failure matrix at one lane (the comment block above
//     runIsolationLoop): a FAIL keeps its commit and blocks (exit 2 naming
//     unit and report), an orphan keeps the scene at the park path (exit 2;
//     the re-run re-dispatches the lane in the same worktree), a landing
//     conflict blocks immediately (the D21 `low` posture — zero repairs),
//     an environment error is global (exit 1);
//   - the byte-identical floor D10 promises: a round at isolation-on
//     produces the serial path's own unit outcomes over the same project —
//     the suite fails if the isolation loop's observable behavior diverges
//     from the serial loop's.
// The serial side of the floor drives runSerialUnit over the native fake
// agent (fixtures/agent.ts, F14: no core test drives the loop with a real
// agent). The ambient OPENCODE_AUTO_* layer is scrubbed around every pass
// and the switch planted explicitly (on or off), then restored (the
// deliverables' driver-variable pattern). All of the above is why the file
// lives in the repo lane of the test manifest: it creates worktrees and
// merges over real git.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { laneBranch, lanePark, writeLaneReport, type LaneReport } from "../src/lanes"
import { changedFiles, commitTree } from "../src/git"
import { createGitOps } from "../src/git-ops"
import { setShellProfile, type LaneWorker } from "../src/shell"
import { syncPhaseIndex, type PhaseUnit } from "../src/phases"
import { markDone, renderTaskIndex, taskStatePaths, unitAttempts } from "../src/tasks"
import { taskDoc } from "../src/docpaths"
import { runTaskLoop, type LoopCtx } from "../src/loop-task"
import type { RunAllOpts } from "../src/loop-preflight"
import { services } from "../src/services"
import { SWITCH_ENV, setSwitchModelRegistry } from "../src/switches"
import { singleHost } from "../src/agent-pool"
import type { AgentHost } from "../src/agent/types"
import { fakeAgent, type FakeAgent } from "./fixtures/agent"
import { unitsText } from "./fixtures/units"
import { EOF_MARK } from "../src/doccheck"

// —— The project and worker fixtures (the lanes-scheduler shapes) ——

let dir: string
let phase: PhaseUnit

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "auto-loop-iso-"))
  ;[phase] = await syncPhaseIndex(dir, 1, "m")
})
afterEach(async () => {
  // The loop cases stub the lane launcher through the profile; the restore
  // names the key the tests touched (shell.test.ts's pattern).
  setShellProfile({ laneLauncher: undefined })
  await rm(dir, { recursive: true, force: true })
})

// git over a directory, asserting exit 0.
async function git(root: string, ...args: string[]) {
  const proc = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`git ${args.join(" ")} exit code ${code}: ${err || out}`)
  return out
}

// The park entries that still exist (the teardown's counterpart).
const parkEntries = async (root = dir): Promise<string[]> => readdir(join(root, ".auto", "worktrees")).catch(() => [])

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

// One unit of an isolation project: its id and title, the `Depends:` its
// document declares (absent = the G3 index-order default), and the source
// file the fake worker writes for it.
type IsoUnit = { id: string; title: string; file: string; content?: string; depends?: string }

// The artifacts a completed unit leaves (both loop shapes write the same
// bytes — the floor comparison's two sides share them).
const sourceOf = (unit: IsoUnit): string => unit.content ?? `export const done = "${unit.id}"\n`
const reportText = (id: string): string => `# ${id} report\n\n${"Delivered. ".repeat(20)}\n\nResult: PASS\n\n${EOF_MARK}\n`

// The scaffolding every lane worktree needs (F7) — gitignored local-only
// state, so the worktree's own `.auto/` (the lane report included) is never
// untracked dirt at the landing verification.
async function writeScaffolding(root: string): Promise<void> {
  await Bun.write(join(root, ".gitignore"), [".auto/", "tmp/", "/.gitignore", "/.env", "/AGENTS.md", "/opencode.json", "/.opencode/auto/models.json", ""].join("\n"))
  await mkdir(join(root, ".opencode", "agent"), { recursive: true })
  await Bun.write(join(root, ".opencode", "agent", "auto.md"), "the agent contract\n")
  await mkdir(join(root, ".opencode", "auto"), { recursive: true })
  await Bun.write(join(root, ".opencode", "auto", "config.json"), "{}\n")
  await Bun.write(join(root, "opencode.json"), "{}\n")
  await Bun.write(join(root, "AGENTS.md"), "the agents block\n")
}

// A committed isolation project: one unit per entry, its document carrying
// the `Depends:` declaration next()'s selection reads, the scaffolding
// local-only, everything committed at HEAD.
async function isoProject(root: string, phaseUnit: PhaseUnit, units: IsoUnit[]): Promise<void> {
  await git(root, "init", "-q")
  await Bun.write(join(root, phaseUnit.dir, "tasks.md"), renderTaskIndex("R-01.P01", units.map((unit) => ({ id: unit.id, title: unit.title }))))
  for (const unit of units) {
    await mkdir(join(root, dirname(taskStatePaths(unit.id).pending)), { recursive: true })
    await Bun.write(
      join(root, taskStatePaths(unit.id).pending),
      [
        `# ${unit.id}: ${unit.title}`,
        "Phase: R-01.P01",
        ...(unit.depends !== undefined ? [`Depends: ${unit.depends}`] : []),
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
  await writeScaffolding(root)
  await git(root, "add", "-A")
  await git(root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "baseline")
}

// The fake lane worker's completion of one unit in its worktree, the real
// way: the unit's source file and report, the done rename + tick, the done
// commit — the same close-out the serial path's pipeline performs. With
// `driftTick` the index tick is restored to HEAD's unticked text before the
// commit (the D7 landed-lane construction), so the parent's landing-sync is
// what re-derives the tick in the main tree.
async function completeLane(worktree: string, phaseUnit: PhaseUnit, unit: IsoUnit, driftTick = false): Promise<void> {
  await mkdir(dirname(join(worktree, unit.file)), { recursive: true })
  await Bun.write(join(worktree, unit.file), sourceOf(unit))
  await Bun.write(join(worktree, taskDoc(unit.id, "report")), reportText(unit.id))
  await markDone({ dir: worktree, index: join(phaseUnit.dir, "tasks.md") }, unit.id)
  if (driftTick) {
    const file = join(worktree, phaseUnit.dir, "tasks.md")
    const ticked = await Bun.file(file).text()
    await Bun.write(file, ticked.replace(`- [x] ${unit.id}`, `- [ ] ${unit.id}`))
  }
  const settled = await commitTree(worktree, { id: unit.id, title: unit.title }, { stage: "done", subject: `${unit.id} done ${unit.title}` })
  if (!settled.ok) throw new Error(`completing ${unit.id} in the lane failed: ${settled.failures.map((failure) => failure.error).join("; ")}`)
}

// The host of a fake agent (the parent drives no session under isolation —
// D4 — so the stub host serves any path that would ask for one).
const hostOf = (agent: FakeAgent): AgentHost => ({ client: agent.client, syncContext: async () => {}, restart: async () => false, close: () => {} })

// The isolation loop's context (the loop fixture's shape): the installed
// services' router/control, the production git ops, and a fake agent's
// single host.
function isoCtx(root: string, server: AgentHost, opts: Partial<RunAllOpts> = {}): LoopCtx {
  const holder = services()
  return {
    directory: root,
    opts: { subtask: "off", ...opts },
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

// Drives the task loop the way a run would: the ambient OPENCODE_AUTO_*
// layer scrubbed, the isolation switch planted explicitly (on or off — the
// suite never depends on which ambient layer the driver exported), and the
// switch memo reset so this pass parses the planted environment; console.log
// captured so a case can assert the loop's own lines.
async function drive(ctx: LoopCtx, phaseUnit: PhaseUnit, isolation: boolean): Promise<{ code: number; lines: string[] }> {
  const ambient = Object.entries(process.env).filter(([key]) => key.startsWith("OPENCODE_AUTO_"))
  for (const [key] of ambient) delete process.env[key]
  process.env[SWITCH_ENV.laneIsolation] = isolation ? "on" : "off"
  setSwitchModelRegistry(undefined)
  const lines: string[] = []
  const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "))
  })
  try {
    return { code: await runTaskLoop(ctx, phaseUnit), lines }
  } finally {
    printed.mockRestore()
    delete process.env[SWITCH_ENV.laneIsolation]
    for (const [key, value] of ambient) if (value !== undefined) process.env[key] = value
    setSwitchModelRegistry(undefined)
  }
}

// A launcher stub that completes every unit it is handed (the happy-path
// worker), recording each launch's unit id and the park's state at that
// moment — the one-lane-at-a-time property's observation point.
function completingLauncher(units: Record<string, IsoUnit>, phaseUnit: PhaseUnit, driftTick = false) {
  const launches: string[] = []
  const parks: string[][] = []
  setShellProfile({
    laneLauncher: (worktree, unit) => {
      launches.push(unit)
      parks.push([...readdirSync(join(worktree, ".."))].sort())
      return workingStub(completeLane(worktree, phaseUnit, units[unit]!, driftTick).then(() => writeLaneReport(worktree, reportOf(unit))))
    },
  })
  return { launches, parks }
}

// —— One lane at a time, the serial selection (D10/S2) —— //

describe("runIsolationLoop (plans/0068 S2, OPENCODE_AUTO_LANE_ISOLATION)", () => {
  test("switch-on: one lane at a time in the serial loop's own next() order; each lands and the loop re-enters until the phase completes", async () => {
    // T-003 is co-ready from the start (a root unit) yet never runs beside
    // another lane; T-001 gates on the later T-002, so the dispatch order is
    // next()'s (T-002, T-001, T-003), not the index's.
    const units: Record<string, IsoUnit> = {
      "T-001": { id: "T-001", title: "the alpha module", file: "src/alpha.ts", depends: "T-002" },
      "T-002": { id: "T-002", title: "the beta module", file: "src/beta.ts", depends: "none" },
      "T-003": { id: "T-003", title: "the gamma module", file: "src/gamma.ts", depends: "none" },
    }
    await isoProject(dir, phase, Object.values(units))
    const { launches, parks } = completingLauncher(units, phase)
    const run = await drive(isoCtx(dir, hostOf(fakeAgent({}))), phase, true)
    expect(run.code).toBe(0)
    expect(run.lines).toContain("✓ all tasks complete")
    // The dispatch wording and the selection: the isolation lane line, in
    // next()'s order, one launch per unit.
    expect(launches).toEqual(["T-002", "T-001", "T-003"])
    for (const id of launches) expect(run.lines).toContain(`▶ ${id} dispatching an isolation lane (attempt 1)`)
    // One lane at a time: every launch saw exactly its own worktree parked
    // (the previous lane had landed and torn down; the co-ready T-003
    // waited through both).
    expect(parks).toEqual([["T-002"], ["T-001"], ["T-003"]])
    // All three units' work arrived in the main tree, done and ticked.
    for (const unit of Object.values(units)) {
      expect(await Bun.file(join(dir, unit.file)).text()).toBe(sourceOf(unit))
      expect(await Bun.file(join(dir, taskStatePaths(unit.id).complete)).exists()).toBe(true)
      expect(await Bun.file(join(dir, taskStatePaths(unit.id).pending)).exists()).toBe(false)
      expect(await Bun.file(join(dir, phase.dir, "tasks.md")).text()).toContain(`- [x] ${unit.id} ${unit.title}`)
    }
    // The landing's commit shape: each lane's own Auto-Stage: done terminal
    // commit (the serial close-out's stage, arrived through the merge)
    // beside one Auto-Stage: landing merge per unit, Auto-Task named.
    const log = await git(dir, "log", "--format=%B")
    expect(log.match(/Auto-Stage: landing\n/g)?.length).toBe(3)
    expect(log).toContain("Auto-Stage: done")
    expect(log).toContain("Auto-Task: T-002")
    // The park and the branches are gone; the runtime fields cleared; the
    // main tree is clean.
    expect(await parkEntries()).toEqual([])
    for (const id of launches) expect((await git(dir, "branch", "--list", laneBranch(id))).trim()).toBe("")
    expect(JSON.parse(await unitsText(dir)).tasks["T-001"].worktree).toBeUndefined()
    expect(await changedFiles(dir)).toEqual([])
  })

  test("a drifted tick lands through the landing-sync re-derivation (D7 step ③), then the loop re-enters and finishes the phase", async () => {
    const units: Record<string, IsoUnit> = {
      "T-001": { id: "T-001", title: "the alpha module", file: "src/alpha.ts", depends: "none" },
      "T-002": { id: "T-002", title: "the beta module", file: "src/beta.ts", depends: "none" },
    }
    await isoProject(dir, phase, Object.values(units))
    // Every lane commits its index line unticked (HEAD's text), so nothing
    // but the done state rides the merge — the parent's landing-sync commit
    // is what ticks the main tree's index.
    const { launches } = completingLauncher(units, phase, true)
    const run = await drive(isoCtx(dir, hostOf(fakeAgent({}))), phase, true)
    expect(run.code).toBe(0)
    expect(launches).toEqual(["T-001", "T-002"])
    const log = await git(dir, "log", "--format=%B")
    expect(log.match(/Auto-Stage: landing-sync\n/g)?.length).toBe(2)
    for (const unit of Object.values(units)) expect(await Bun.file(join(dir, phase.dir, "tasks.md")).text()).toContain(`- [x] ${unit.id} ${unit.title}`)
    expect(await parkEntries()).toEqual([])
    expect(await changedFiles(dir)).toEqual([])
  })

  test("the switch outranks the scheduler (the S3 branch order): isolation-on at maxSessions = 2 under a level still runs one lane at a time", async () => {
    // Two co-ready disjoint units — exactly the plan that dispatches side by
    // side under the readiness scheduler — asked together with the switch.
    const units: Record<string, IsoUnit> = {
      "T-001": { id: "T-001", title: "the alpha module", file: "src/alpha.ts", depends: "none" },
      "T-002": { id: "T-002", title: "the beta module", file: "src/beta.ts", depends: "none" },
    }
    await isoProject(dir, phase, Object.values(units))
    const { parks } = completingLauncher(units, phase)
    const run = await drive(isoCtx(dir, hostOf(fakeAgent({})), { maxSessions: 2, parallel: "low" }), phase, true)
    expect(run.code).toBe(0)
    // Never two worktrees parked at once: the second lane launched only
    // after the first landed — the isolation shape, not the scheduler's.
    expect(parks).toEqual([["T-001"], ["T-002"]])
    expect(run.lines.filter((line) => line.includes("dispatching an isolation lane"))).toHaveLength(2)
  })
})

// —— §6.2's failure matrix at one lane (the loop's comment contract) —— //

describe("the isolation loop's failure matrix (§6.2)", () => {
  test("a FAIL report lands its committed work, blocks the unit and exits 2; scheduling stops (the co-ready unit is never dispatched)", async () => {
    const units: Record<string, IsoUnit> = {
      "T-001": { id: "T-001", title: "the widget", file: "src/broken.ts", depends: "none" },
      "T-002": { id: "T-002", title: "the other widget", file: "src/other.ts", depends: "none" },
    }
    await isoProject(dir, phase, Object.values(units))
    const launches: string[] = []
    setShellProfile({
      laneLauncher: (worktree, unit) => {
        launches.push(unit)
        return workingStub(
          (async () => {
            // The session's work is committed; the wrap-up's verdict is
            // FAIL: the unit is not done, the work stays (failure keeps its
            // commit).
            const broken = units[unit]!
            await mkdir(dirname(join(worktree, broken.file)), { recursive: true })
            await Bun.write(join(worktree, broken.file), 'export const broken = true\n')
            const settled = await commitTree(worktree, { id: unit, title: broken.title }, { stage: "session", subject: `${unit} the work so far` })
            if (!settled.ok) throw new Error("commit failed")
            await writeLaneReport(worktree, reportOf(unit, { ok: false, result: "FAIL", blocked: "the task report concluded Result: FAIL" }))
          })(),
          2,
        )
      },
    })
    const run = await drive(isoCtx(dir, hostOf(fakeAgent({}))), phase, true)
    expect(run.code).toBe(2)
    expect(run.lines.some((line) => line.includes("T-001 blocked: its committed work landed"))).toBe(true)
    expect(run.lines.some((line) => line.includes("T-001 is blocked") && line.includes("Result: FAIL"))).toBe(true)
    // The committed work is in the main tree; the unit is blocked, not done;
    // the landed scene is torn down; the tree is clean.
    expect(await Bun.file(join(dir, "src/broken.ts")).text()).toBe("export const broken = true\n")
    expect(await Bun.file(join(dir, taskStatePaths("T-001").complete)).exists()).toBe(false)
    expect(JSON.parse(await unitsText(dir)).tasks["T-001"].status).toBe("blocked")
    expect(await parkEntries()).toEqual([])
    expect(await changedFiles(dir)).toEqual([])
    // Scheduling stopped at the block: the co-ready T-002 never dispatched.
    expect(launches).toEqual(["T-001"])
  })

  test("the re-run re-enters after the block: the resume line, a second attempt, the landing, the phase completes", async () => {
    const units: Record<string, IsoUnit> = {
      "T-001": { id: "T-001", title: "the widget", file: "src/widget.ts", depends: "none" },
      "T-002": { id: "T-002", title: "the other widget", file: "src/other.ts", depends: "none" },
    }
    await isoProject(dir, phase, Object.values(units))
    setShellProfile({
      laneLauncher: (worktree, unit) =>
        workingStub(
          (async () => {
            await writeLaneReport(worktree, reportOf(unit, { ok: false, result: "FAIL", blocked: "the task report concluded Result: FAIL" }))
          })(),
          2,
        ),
    })
    const first = await drive(isoCtx(dir, hostOf(fakeAgent({}))), phase, true)
    expect(first.code).toBe(2)
    expect(JSON.parse(await unitsText(dir)).tasks["T-001"].status).toBe("blocked")
    // The re-run: the blocked unit is a candidate like a pending one —
    // resumed directly, one more attempt, and this time it lands.
    const { launches } = completingLauncher(units, phase)
    const second = await drive(isoCtx(dir, hostOf(fakeAgent({}))), phase, true)
    expect(second.code).toBe(0)
    expect(second.lines).toContain("↻ T-001 was blocked previously, resuming directly (block reason in the previous run's log)")
    expect(launches).toEqual(["T-001", "T-002"])
    expect(await unitAttempts(dir, "T-001")).toBe(2)
    for (const unit of Object.values(units)) expect(await Bun.file(join(dir, taskStatePaths(unit.id).complete)).exists()).toBe(true)
    expect(await parkEntries()).toEqual([])
  })

  test("an orphan (no report): the scene is kept at the park path, exit 2, nothing lands; the re-run re-dispatches the lane in the same worktree and it lands", async () => {
    const units: Record<string, IsoUnit> = { "T-001": { id: "T-001", title: "the widget", file: "src/widget.ts", depends: "none" } }
    await isoProject(dir, phase, Object.values(units))
    // The crash: no work, no report, exit 137 — the worker did not control
    // its exit.
    setShellProfile({ laneLauncher: () => stubWorker(137) })
    const first = await drive(isoCtx(dir, hostOf(fakeAgent({}))), phase, true)
    expect(first.code).toBe(2)
    const orphan = first.lines.find((line) => line.includes("exited without a report (exit 137)"))
    expect(orphan).toBeDefined()
    expect(orphan).toContain(lanePark("T-001"))
    expect(orphan).toContain("Re-run to re-dispatch the lane in the same worktree")
    // The scene is kept: worktree, branch, registry record — and nothing
    // landed in the main tree.
    expect(await parkEntries()).toEqual(["T-001"])
    expect((await git(dir, "branch", "--list", laneBranch("T-001"))).trim()).toContain(laneBranch("T-001"))
    expect(JSON.parse(await unitsText(dir)).tasks["T-001"].worktree).toBe(lanePark("T-001"))
    expect(await Bun.file(join(dir, "src/widget.ts")).exists()).toBe(false)
    expect(await changedFiles(dir)).toEqual([])
    // The re-run re-dispatches in place (the crash-resume property): the
    // same worktree, a second attempt, the landing.
    const { launches } = completingLauncher(units, phase)
    const second = await drive(isoCtx(dir, hostOf(fakeAgent({}))), phase, true)
    expect(second.code).toBe(0)
    expect(launches).toEqual(["T-001"])
    expect(second.lines.some((line) => line.includes("re-dispatching its lane in the existing worktree") && line.includes(lanePark("T-001")))).toBe(true)
    expect(await unitAttempts(dir, "T-001")).toBe(2)
    expect(await Bun.file(join(dir, taskStatePaths("T-001").complete)).exists()).toBe(true)
    expect(await parkEntries()).toEqual([])
  })

  test("a landing conflict blocks immediately (the low posture, zero repairs): exit 2, the scene kept, the main tree clean", async () => {
    const units: Record<string, IsoUnit> = { "T-001": { id: "T-001", title: "the widget", file: "src/widget.ts", depends: "none" } }
    await isoProject(dir, phase, Object.values(units))
    setShellProfile({
      laneLauncher: (worktree, unit) =>
        workingStub(
          (async () => {
            // Both sides move the task document while the lane is in
            // flight: the main tree's own housekeeping commit beside the
            // lane's version (a commit before the dispatch would be the
            // lane's base and merge cleanly — no divergence).
            await Bun.write(join(dir, taskStatePaths(unit).pending), "# T-001: main side\n")
            const main = await commitTree(dir, { id: unit, title: "the widget" }, { stage: "housekeeping", subject: "PLAN housekeeping sibling move" })
            if (!main.ok) throw new Error("main-side commit failed")
            await Bun.write(join(worktree, taskStatePaths(unit).pending), "# T-001: lane side\n")
            const settled = await commitTree(worktree, { id: unit, title: "the widget" }, { stage: "done", subject: `${unit} done the widget` })
            if (!settled.ok) throw new Error("commit failed")
            await writeLaneReport(worktree, reportOf(unit))
          })(),
        ),
    })
    const run = await drive(isoCtx(dir, hostOf(fakeAgent({}))), phase, true)
    expect(run.code).toBe(2)
    const conflict = run.lines.find((line) => line.includes("T-001 landing conflict"))
    expect(conflict).toBeDefined()
    expect(conflict).toContain(lanePark("T-001"))
    expect(conflict).toContain("resolve the conflict manually or re-run to retry the lane in place")
    // The merge aborted: the main tree keeps its own side, clean; the lane's
    // scene (worktree, branch, record) is kept for the manual resolution.
    expect(await Bun.file(join(dir, taskStatePaths("T-001").pending)).text()).toBe("# T-001: main side\n")
    expect(await changedFiles(dir)).toEqual([])
    expect(await parkEntries()).toEqual(["T-001"])
    expect((await git(dir, "branch", "--list", laneBranch("T-001"))).trim()).toContain(laneBranch("T-001"))
    expect(JSON.parse(await unitsText(dir)).tasks["T-001"].worktree).toBe(lanePark("T-001"))
  })

  test("an environment error (exit 1) is global: exit 1, nothing lands, the scene stays for the next run's recovery", async () => {
    const units: Record<string, IsoUnit> = { "T-001": { id: "T-001", title: "the widget", file: "src/widget.ts", depends: "none" } }
    await isoProject(dir, phase, Object.values(units))
    setShellProfile({
      laneLauncher: (worktree, unit) =>
        workingStub(
          (async () => {
            await writeLaneReport(worktree, reportOf(unit))
          })(),
          1,
        ),
    })
    const run = await drive(isoCtx(dir, hostOf(fakeAgent({}))), phase, true)
    expect(run.code).toBe(1)
    expect(run.lines.some((line) => line.includes("lane worker failed with an environment error (exit 1)"))).toBe(true)
    // Nothing lands on the environment path — the scene stays for the next
    // run's preflight recovery (the report on disk tells it to land).
    expect(await parkEntries()).toEqual(["T-001"])
    expect(await Bun.file(join(dir, taskStatePaths("T-001").complete)).exists()).toBe(false)
    expect(await changedFiles(dir)).toEqual([])
  })
})

// —— The byte-identical floor (D10) —— //

describe("the byte-identical floor (D10)", () => {
  // The unit-level outcomes of a round over a project (the e2e's outcomes
  // shape: D10 promises the same outcomes, not the same logs — the commit
  // topology is the landing protocol's own).
  const outcomes = async (root: string, phaseUnit: PhaseUnit, units: IsoUnit[]) => {
    const read = (path: string) => Bun.file(join(root, path)).text().catch(() => "missing")
    return {
      sources: await Promise.all(units.map((unit) => read(unit.file))),
      reports: await Promise.all(units.map((unit) => read(taskDoc(unit.id, "report")))),
      done: await Promise.all(units.map((unit) => Bun.file(join(root, taskStatePaths(unit.id).complete)).exists())),
      pendingGone: (await Promise.all(units.map((unit) => Bun.file(join(root, taskStatePaths(unit.id).pending)).exists()))).every((exists) => !exists),
      index: await read(join(phaseUnit.dir, "tasks.md")),
      clean: (await git(root, "status", "--porcelain")).trim() === "",
    }
  }

  test("a round at isolation-on produces the serial path's own unit outcomes over the same project; the serial path dispatches no lane", async () => {
    const units: IsoUnit[] = [
      { id: "T-001", title: "the alpha module", file: "src/alpha.ts", depends: "none" },
      { id: "T-002", title: "the beta module", file: "src/beta.ts", depends: "none" },
    ]
    // The serial side: the switch off at one session (no scheduler), the
    // fake agent's turns writing each unit's artifacts — the implement
    // session the source file, the wrap-up session the passing report (the
    // incident-regression scenario's shape). The launcher must never fire.
    await isoProject(dir, phase, units)
    let lanes = 0
    setShellProfile({
      laneLauncher: () => {
        lanes++
        throw new Error("no lane may be dispatched on the serial path at one session")
      },
    })
    // One artifact action per prompted turn, in chain order (a unit's
    // implement session then its wrap-up), the queue's tail repeating should
    // a session ever re-prompt — the scriptedClient rule.
    let step = 0
    const actions = units.flatMap((unit) => [
      () => {
        mkdirSync(dirname(join(dir, unit.file)), { recursive: true })
        writeFileSync(join(dir, unit.file), sourceOf(unit))
      },
      () => writeFileSync(join(dir, taskDoc(unit.id, "report")), reportText(unit.id)),
    ])
    const serialAgent = fakeAgent({
      turn: () => {
        actions[Math.min(step++, actions.length - 1)]!()
        return undefined
      },
    })
    const serial = await drive(isoCtx(dir, hostOf(serialAgent)), phase, false)
    expect(serial.code, serial.lines.join("\n")).toBe(0)
    expect(lanes).toBe(0)
    expect(await parkEntries()).toEqual([])
    expect(serial.lines).toContain("✓ all tasks complete")

    // The isolation side: a fresh copy of the same project, the switch on,
    // the launcher completing each unit in its lane the way the sessions
    // would (the same artifact bytes).
    const isoRoot = await mkdtemp(join(tmpdir(), "auto-loop-iso-floor-"))
    try {
      const [isoPhase] = await syncPhaseIndex(isoRoot, 1, "m")
      await isoProject(isoRoot, isoPhase, units)
      const byId: Record<string, IsoUnit> = Object.fromEntries(units.map((unit) => [unit.id, unit]))
      setShellProfile({
        laneLauncher: (worktree, unit) => workingStub(completeLane(worktree, isoPhase, byId[unit]!).then(() => writeLaneReport(worktree, reportOf(unit)))),
      })
      const isolated = await drive(isoCtx(isoRoot, hostOf(fakeAgent({}))), isoPhase, true)
      expect(isolated.code, isolated.lines.join("\n")).toBe(0)
      expect(await outcomes(dir, phase, units)).toEqual(await outcomes(isoRoot, isoPhase, units))
    } finally {
      await rm(isoRoot, { recursive: true, force: true })
    }
  })
})
