// transfer, the single advance command (plans/0101 D2): the four shapes and
// their refusals, resolved by state. The no-session shapes — project start
// (the 0084 analysis flow re-homed), the gate-held refusal, nothing to
// advance, the round-open and roadmap-exhausted stops — drive runTransfer
// directly over a real git repository; the advance proper (the handover, the
// phase close, the construction's review stop) rides the phase loop under
// stopBefore "formulate" on the native fake agent (fixtures/loop.ts), the
// same loop runAll hands control to — the survey-gate suite walks its
// gated variant end to end.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spyOn } from "bun:test"
import type { ModelEntry, ModelRegistry, TierList } from "../src/models-schema"
import { releasedRoadmapRounds } from "../src/analysis"
import { amendPhasesHold, runTransfer } from "../src/transfer"
import { autoSwitches, setSwitchModelRegistry } from "../src/switches"
import { completePhase, establishRound, readPhases, renderPhaseTodo, type PhaseUnit } from "../src/phases"
import { renderRoundBrief } from "../src/round-brief"
import { renderTaskIndex } from "../src/tasks"
import { reportForUserPath } from "../src/docpaths"
import { EOF_MARK } from "../src/doccheck"
import type { RoutingFacts } from "../src/routing"
import { services } from "../src/services"
import { ev, type TurnScript } from "./fixtures/agent"
import { freshRepo, git } from "./fixtures/runner"
import { SYNTHESIS_MARK, appendOneTask, artifactTurns, loopFixture, synthesisTurn, taskDoc, type LoopFixture } from "./fixtures/loop"

const made: string[] = []
const fixtures: LoopFixture[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
  for (const fixture of fixtures.splice(0)) rmSync(fixture.dir, { recursive: true, force: true })
})

// Scrub the ambient OPENCODE_AUTO_* layer and capture the terminal (the
// fixtures/loop.ts convention). The switches parse is memoized per process,
// and earlier suites may leave a stale parse behind (plan.test's
// analysis-off afterEach) — the reset makes this run parse the scrubbed
// environment, the same rule every flip applies.
async function capture(run: () => Promise<number>): Promise<{ code: number; lines: string[] }> {
  const saved = Object.entries(process.env).filter(([key]) => /^OPENCODE_AUTO_/.test(key))
  for (const [key] of saved) delete process.env[key]
  setSwitchModelRegistry(undefined)
  const lines: string[] = []
  const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "))
  })
  try {
    return { code: await run(), lines }
  } finally {
    printed.mockRestore()
    for (const [key, value] of saved) if (value !== undefined) process.env[key] = value
    // An advance through runAll freezes the switch snapshot at its fleet
    // start (the run's own invariant; the run-status suite's documented
    // reset): re-parse the restored environment back to an unfrozen
    // snapshot, or a later clamp in this process throws.
    setSwitchModelRegistry(undefined)
    autoSwitches()
  }
}

async function repo(): Promise<string> {
  const dir = await freshRepo()
  made.push(dir)
  await Bun.write(join(dir, ".gitignore"), ".auto/\ntmp/\n")
  await git(dir, "add", "-A")
  await git(dir, "commit", "-qm", "setup")
  return dir
}

const ANALYSIS = (lines: string[], clarified = true) =>
  ["# Project analysis", "", "## Analysis", "", "Two modules, one risk area.", "", "## Goals", "", "Ship the port with the protocol intact.", "", "## Project brief", "", "A faithful port.", "", "## Roadmap", "", ...lines, "", ...(clarified ? ["Clarified: yes"] : []), ""].join("\n")

// Complete every phase of a round the way the handover path would leave it
// (todo.md → done.md, the index ticked), plus the round-close needs — the
// report and the filled ## Close — so the round sits at transfer's shape 4.
async function completeRound(dir: string, phases: string): Promise<void> {
  await establishRound(dir, { phases, round: 1 })
  const state = (await readPhases(dir, 1))!
  for (const unit of state.phases) {
    const todo = join(dir, unit.dir, "todo.md")
    if (!existsSync(todo)) await Bun.write(todo, renderPhaseTodo(unit))
    expect(await completePhase(dir, unit, [])).toEqual([])
  }
  await Bun.write(join(dir, reportForUserPath(1)), ["# Round report", "", "The round's account for the person.", "", EOF_MARK, ""].join("\n"))
  const brief = join(dir, "docs/R-01/round.md")
  await Bun.write(brief, renderRoundBrief(1).replace("## Close", "## Close\n\n- Everything restated into the target's own docs; nothing accepted as lost."))
  await git(dir, "add", "-A")
  await git(dir, "commit", "-qm", "round complete")
}

// A phase whose task index lists one pending task — the nothing-to-advance
// state (execute work belongs to run).
async function pendingTaskPhase(dir: string, phases: string, phase: PhaseUnit): Promise<void> {
  await establishRound(dir, { phases, round: 1 })
  const index = join(dir, phase.dir, "tasks.md")
  await Bun.write(index, `${renderTaskIndex("R-01.P01", [])}- [ ] T-001 task T-001\n`)
  await mkdirSync(join(dir, "docs/T-001"), { recursive: true })
  await Bun.write(join(dir, "docs/T-001/todo.md"), taskDoc("T-001", "R-01.P01"))
  await git(dir, "add", "-A")
  await git(dir, "commit", "-qm", "phase setup")
}

// The re-work bundle's survey type, as `init --intent` materializes it.
const SURVEY_TYPE = ["# Survey", "", "Gate: human", "Phase-artifacts: survey.md", "", "## plan duties", "", "Inventory-level reading only.", "", "<!-- auto: eof -->", ""].join("\n")

// A survey phase whose work is done and whose survey.md records one open
// fork — the gate-held boundary state.
async function forkedSurvey(dir: string): Promise<void> {
  await mkdirSync(join(dir, ".opencode/auto/phases"), { recursive: true })
  await Bun.write(join(dir, ".opencode/auto/phases/survey.md"), SURVEY_TYPE)
  await establishRound(dir, { phases: "survey,implement", round: 1 })
  const state = (await readPhases(dir, 1))!
  const survey = state.phases[0]!
  const index = join(dir, survey.dir, "tasks.md")
  await Bun.write(index, `${renderTaskIndex("R-01.P01", [])}- [x] T-001 task T-001\n`)
  await mkdirSync(join(dir, "docs/T-001"), { recursive: true })
  await Bun.write(join(dir, "docs/T-001/done.md"), taskDoc("T-001", "R-01.P01"))
  await Bun.write(
    join(dir, survey.dir, "survey.md"),
    ["# Survey", "", "The reference's map.", "", "Fork: scope — the journal too; Recommend: the core only.", "", "<!-- auto: eof -->", ""].join("\n"),
  )
  await git(dir, "add", "-A")
  await git(dir, "commit", "-qm", "survey done, fork open")
}

describe("transfer: m mode and the project-start shapes (plans/0101 D2 shape 1, D8)", () => {
  test("m mode refuses: the plan/run shapes stand, no boundary vocabulary applies", async () => {
    const dir = await repo()
    const out = await capture(() => runTransfer(dir, { phases: "m" }))
    expect(out.code).toBe(1)
    expect(out.lines.some((line) => line.includes("transfer applies to phased projects"))).toBe(true)
    expect(out.lines.some((line) => line.includes("execute with opencode-auto run"))).toBe(true)
  })

  test("project start with no analysis: the stub opens, the guidance attaches, the stop names transfer", async () => {
    const dir = await repo()
    const out = await capture(() => runTransfer(dir, { phases: "mt" }))
    expect(out.code).toBe(0)
    expect(existsSync(join(dir, "docs/analysis.md"))).toBe(true)
    expect(out.lines.some((line) => line.includes("the project analysis is open"))).toBe(true)
    expect(out.lines.some((line) => line.includes("re-run: opencode-auto transfer"))).toBe(true)
    expect(existsSync(join(dir, "docs/R-01"))).toBe(false)
  })

  test("an unreleased analysis awaits the person (exit 2); grammar problems hold the release", async () => {
    const dir = await repo()
    await Bun.write(join(dir, "docs/analysis.md"), ANALYSIS(["- R-01 mt — port the core"], false))
    const awaiting = await capture(() => runTransfer(dir, { phases: "mt" }))
    expect(awaiting.code).toBe(2)
    expect(awaiting.lines.some((line) => line.includes("the project analysis awaits you"))).toBe(true)
    expect(existsSync(join(dir, "docs/R-01"))).toBe(false)
    // Grammar problems are their own hold (row 0b's shape).
    await Bun.write(join(dir, "docs/analysis.md"), ["# Project analysis", "", "no sections at all", "", "Clarified: yes", ""].join("\n"))
    const problems = await capture(() => runTransfer(dir, { phases: "mt" }))
    expect(problems.code).toBe(2)
    expect(problems.lines.some((line) => line.includes("problems that hold its release"))).toBe(true)
  })

  test("a released analysis installs the approved brief and establishes R-01 under the roadmap's line, stopping at the round-start gate naming transfer", async () => {
    const dir = await repo()
    await Bun.write(join(dir, "docs/analysis.md"), ANALYSIS(["- R-01 test,implement — port the core and its tests"]))
    const out = await capture(() => runTransfer(dir, { phases: "mt" }))
    expect(out.code).toBe(0)
    // The brief proposal installed verbatim (its own commit through the tree).
    const brief = await Bun.file(join(dir, ".opencode/auto/brief.md")).text()
    expect(brief).toContain("A faithful port.")
    // The roadmap's line ruled (D5): the sourced establishment line.
    expect(out.lines.some((line) => line.includes("✓ round R-01 established: P01-test, P02-implement — phases from the roadmap of docs/analysis.md"))).toBe(true)
    expect(out.lines.some((line) => line.includes('config default was "mt"'))).toBe(true)
    // The G1 stop names transfer's rhythm, and the setup stays uncommitted.
    expect(out.lines.some((line) => line.includes("then run: opencode-auto transfer"))).toBe(true)
    expect(out.lines.some((line) => line.includes("it constructs R-01.P01 test's plan task"))).toBe(true)
    expect((await git(dir, "status", "--porcelain")).trim()).not.toBe("")
    // No construction yet: the round-start commit sits between (one advance
    // per invocation; the construct is the next invocation's).
    expect(existsSync(join(dir, "docs/R-01/P01-test/tasks.md"))).toBe(false)
  })

  test("OPENCODE_AUTO_ANALYSIS=off degrades to direct establishment from config (D8)", async () => {
    const dir = await repo()
    const out = await capture(() => {
      process.env.OPENCODE_AUTO_ANALYSIS = "off"
      return runTransfer(dir, { phases: "mt" })
    })
      expect(out.code).toBe(0)
      expect(existsSync(join(dir, "docs/analysis.md"))).toBe(false)
      expect(out.lines.some((line) => line.includes("✓ round R-01 established: P01-implement, P02-test"))).toBe(true)
    expect(out.lines.some((line) => line.includes("roadmap"))).toBe(false)
  })
})

describe("transfer: the phase-boundary refusals (plans/0101 D2)", () => {
  test("a survey with open forks refuses ahead of any session, naming survey.md, the forks and the release line", async () => {
    const dir = await repo()
    await forkedSurvey(dir)
    const out = await capture(() => runTransfer(dir, { phases: "survey,implement" }))
    expect(out.code).toBe(2)
    expect(out.lines.some((line) => line.includes("P01-survey Survey awaits your clarification"))).toBe(true)
    expect(out.lines.some((line) => line.includes("records 1 open Fork: line(s)"))).toBe(true)
    expect(out.lines.some((line) => line.includes("add `Clarified: yes` to release the phase"))).toBe(true)
    // No session ran: the handover document does not exist, the phase waits.
    expect(existsSync(join(dir, "docs/R-01/P01-survey/handover.md"))).toBe(false)
    expect(existsSync(join(dir, "docs/R-01/P01-survey/todo.md"))).toBe(true)
  })

  test("pending execute work refuses: nothing to advance, the answer names run", async () => {
    const dir = await repo()
    const state = await (async () => {
      await establishRound(dir, { phases: "implement", round: 1 })
      return (await readPhases(dir, 1))!
    })()
    await pendingTaskPhase(dir, "implement", state.phases[0]!)
    const out = await capture(() => runTransfer(dir, { phases: "implement" }))
    expect(out.code).toBe(2)
    expect(out.lines.some((line) => line.includes("nothing to advance: R-01.P01 implement still holds 1 pending task(s)"))).toBe(true)
    expect(out.lines.some((line) => line.includes("execute them first: opencode-auto run"))).toBe(true)
  })
})

describe("transfer: the round-open shape (plans/0101 D2 shape 4, D5)", () => {
  test("a closed round opens the next under the roadmap's line; a line-less roadmap is exhausted, a roadmap-less project falls back to config", async () => {
    // The roadmap names R-02: its line establishes.
    const dir = await repo()
    await Bun.write(join(dir, "docs/analysis.md"), ANALYSIS(["- R-01 mt — port the core", "- R-02 m — harden the port"]))
    await completeRound(dir, "mt")
    const out = await capture(() => runTransfer(dir, { phases: "mt" }))
    expect(out.code).toBe(0)
    expect(existsSync(join(dir, "docs/R-02/phases.md"))).toBe(true)
    expect(out.lines.some((line) => line.includes("✓ round R-02 established: P01-implement — phases from the roadmap of docs/analysis.md (R-02 line \"harden the port\"; config default was \"mt\")"))).toBe(true)
    expect(out.lines.some((line) => line.includes("then run: opencode-auto transfer"))).toBe(true)

    // The roadmap ends at R-01: the exhausted stop names the extend channel.
    const done = await repo()
    await Bun.write(join(done, "docs/analysis.md"), ANALYSIS(["- R-01 mt — port the core"]))
    await completeRound(done, "mt")
    const exhausted = await capture(() => runTransfer(done, { phases: "mt" }))
    expect(exhausted.code).toBe(0)
    expect(exhausted.lines.some((line) => line.includes("holds no line for round R-02"))).toBe(true)
    expect(exhausted.lines.some((line) => line.includes("extend ## Roadmap"))).toBe(true)
    expect(existsSync(join(done, "docs/R-02"))).toBe(false)
    expect(await releasedRoadmapRounds(done)).toBeDefined()

    // No analysis at all: config `phases` governs the next round (D5's
    // fallback), today's behavior.
    const configFlow = await repo()
    await completeRound(configFlow, "mt")
    const fallback = await capture(() => runTransfer(configFlow, { phases: "mtv" }))
    expect(fallback.code).toBe(0)
    expect(fallback.lines.some((line) => line.includes("✓ round R-02 established: P01-implement, P02-test, P03-acceptance"))).toBe(true)
  })

  test("the round-close checks gate the opening (exit 2 naming them, the ## Close fill the answer)", async () => {
    const dir = await repo()
    await completeRound(dir, "mt")
    // Unfill the close listing: the checks must hold R-02.
    const brief = join(dir, "docs/R-01/round.md")
    await Bun.write(brief, renderRoundBrief(1))
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "unfill the close listing")
    const out = await capture(() => runTransfer(dir, { phases: "mt" }))
    expect(out.code).toBe(2)
    expect(out.lines.some((line) => line.includes("does not pass its round-close checks, so round R-02 cannot open yet"))).toBe(true)
    expect(out.lines.some((line) => line.includes("close listing"))).toBe(true)
    expect(existsSync(join(dir, "docs/R-02"))).toBe(false)
  })
})

describe("transfer: the advance through the loop (stopBefore \"formulate\", plans/0101 D2 shapes 2/3)", () => {
  test("the boundary advance runs end to end through runAll's preflight: the lock re-entered, the distillation session, the close, the review stop", async () => {
    // The managed-host shape of run-status's subscriber suite: runAll runs
    // its full preflight over the caller's fake host, so this pins the
    // runTransfer → runAll wiring the loop-fixture cases sit beside (the
    // lock re-entry, the clean-tree gate, the drift check) — one advance of
    // a seeded boundary state.
    const { fakeAgent } = await import("./fixtures/agent")
    const dir = await repo()
    await Bun.write(join(dir, ".opencode/agent/auto.md"), "contract\n")
    await establishRound(dir, { phases: "mt", round: 1 })
    // P01 at its boundary: its one task done and committed.
    const state = (await readPhases(dir, 1))!
    await Bun.write(join(dir, state.phases[0]!.dir, "tasks.md"), "- [x] T-001 task T-001\n")
    await mkdirSync(join(dir, "docs/T-001"), { recursive: true })
    await Bun.write(join(dir, "docs/T-001/done.md"), taskDoc("T-001", "R-01.P01"))
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "phase done")
    const agent = fakeAgent({ turn: artifactTurns(dir) })
    const host = { client: agent.client, syncContext: async () => {}, restart: async () => false, close: () => {} }
    const out = await capture(() => runTransfer(dir, { managed: host, phases: "mt" }))
    expect(out.code).toBe(0)
    expect(existsSync(join(dir, "docs/R-01/P01-implement/handover.md"))).toBe(true)
    expect(existsSync(join(dir, "docs/R-01/P01-implement/done.md"))).toBe(true)
    expect(out.lines.some((line) => line.includes("review stop: the formulation todo of"))).toBe(true)
    expect((await git(dir, "status", "--porcelain")).trim()).toBe("")
  })

  test("the boundary advance distills, closes the phase and constructs the next plan task, stopping at the review seam — one advance per invocation", async () => {
    const f = await loopFixture("mt")
    fixtures.push(f)
    await establishRound(f.dir, { phases: "mt", round: 1 })
    await f.commit("round setup")
    // run executes P01's work and stops at its boundary (D1).
    const stopped = await f.run()
    expect(stopped.code).toBe(0)
    expect(stopped.lines.some((line) => line.includes("✓ phase boundary: P01-implement Implementation complete"))).toBe(true)
    expect(existsSync(join(f.dir, "docs/R-01/P01-implement/handover.md"))).toBe(false)
    // The advance: the distillation session runs, the phase closes, P02's
    // plan task is constructed and reviewed — not dispatched.
    const advanced = await f.run({ stopBefore: "formulate" })
    expect(advanced.code).toBe(0)
    expect(existsSync(join(f.dir, "docs/R-01/P01-implement/handover.md"))).toBe(true)
    expect(existsSync(join(f.dir, "docs/R-01/P01-implement/done.md"))).toBe(true)
    const implement = (await f.phase(1)).dir
    const index = (await Bun.file(join(f.dir, implement, "tasks.md")).text()).trim().split("\n")
    expect(index.filter((line) => /^\- \[ \] T-\d+/.test(line))).toHaveLength(1)
    expect(advanced.lines.some((line) => line.includes("review stop: the formulation todo of"))).toBe(true)
    expect(advanced.lines.some((line) => line.includes("dispatch it with opencode-auto plan"))).toBe(true)
    // One advance per invocation, and the re-run is the reconstruct channel
    // (D3): the digest-keep holds the landed todo, the same review stop
    // answers, nothing is dispatched.
    const again = await f.run({ stopBefore: "formulate" })
    expect(again.code).toBe(0)
    expect(again.lines.some((line) => line.includes("the landed formulation todo of"))).toBe(true)
    expect(again.lines.some((line) => line.includes("review stop: the formulation todo of"))).toBe(true)
    const after = (await Bun.file(join(f.dir, implement, "tasks.md")).text()).trim().split("\n")
    expect(after).toEqual(index)
    // plan dispatches the reviewed task (the stop condition's formulation
    // route); run then executes the phase and stops at the round's last
    // boundary.
    const dispatched = await f.run({ stopBefore: "execute" })
    expect(dispatched.code).toBe(0)
    expect(dispatched.lines.some((line) => line.includes("✓ phase planning complete"))).toBe(true)
    // A second planned task rides the phase: run executes both, and the
    // boundary stop lands once, at the phase's clean end (never mid-phase).
    appendOneTask(f.dir, implement)
    await f.commit("add a second task")
    const executed = await f.run()
    expect(executed.code).toBe(0)
    expect(executed.lines.filter((line) => line.includes("✓ phase boundary"))).toHaveLength(1)
    expect(existsSync(join(f.dir, "docs/R-01/P02-test/todo.md"))).toBe(true)
  })
})

// The reviewed plan task's seam (plans/0101 D3/D4): the strict roadmap-line
// failure transfer's establishment meets (the D5 pin plan's phased rows used
// to carry), the review stop's output — the records beside the todo, the
// round-brief duty of a stub round.md — and --resynthesize bypassing the
// digest keep of a standing synthesized todo.
describe("transfer: the review gate and the rejected-edit channel (plans/0101 D3)", () => {
  test("a released roadmap line the project cannot establish fails exit 1 naming the line (D5)", async () => {
    const dir = await repo()
    await Bun.write(
      join(dir, "docs/analysis.md"),
      ANALYSIS(["- R-01 analysis,nonexistent,implement — port the core"]),
    )
    // The interrupted-start shape (the release gate checked the line against
    // the types of its day; the pack since stopped shipping one — the round
    // directory exists, the index is the missing piece): establishment meets
    // the line here, past the analysis branch.
    mkdirSync(join(dir, "docs/R-01"), { recursive: true })
    const out = await capture(() => runTransfer(dir, { phases: "am" }))
    expect(out.code).toBe(1)
    expect(out.lines.some((line) => line.includes('the roadmap of docs/analysis.md plans R-01 with "analysis,nonexistent,implement"'))).toBe(true)
    expect(out.lines.some((line) => line.includes("unknown phase type(s) nonexistent"))).toBe(true)
    expect(existsSync(join(dir, "docs/R-01/phases.md"))).toBe(false)
  })

  test("the review stop names the round-brief duty of a stub round.md; the fill and the re-run reconstruct on it (the walkthrough's step)", async () => {
    const f = await loopFixture("mt")
    fixtures.push(f)
    await establishRound(f.dir, { phases: "mt" })
    await f.commit("round setup")
    // run executes P01 and stops at its boundary (D1); the advance
    // constructs P02's plan task — round.md still the stub the whole way.
    expect((await f.run()).code).toBe(0)
    const advanced = await f.run({ stopBefore: "formulate" })
    expect(advanced.code).toBe(0)
    expect(advanced.lines.some((line) => line.includes("review stop: the formulation todo of"))).toBe(true)
    expect(advanced.lines.some((line) => line.includes("driver-owned, fix its inputs, never the todo"))).toBe(true)
    // The duty (D3): the stop says round.md is still the untouched stub,
    // names the fill and the transfer re-run whose reconstruct absorbs it.
    expect(advanced.lines.some((line) => line.includes("⚠ the round brief docs/R-01/round.md is still the untouched stub"))).toBe(true)
    expect(advanced.lines.some((line) => line.includes("plan refuses to dispatch while it stays a stub"))).toBe(true)
    // The audit pointer: this round holds no prompt-audit.md (the
    // charter-less construct writes no records), so the records line stays
    // quiet beside the todo — the --resynthesize case below pins the other
    // half (a synthesis run writes the audit, the stop names it).
    expect(existsSync(join(f.dir, "docs/R-01/prompt-audit.md"))).toBe(false)
    expect(advanced.lines.some((line) => line.includes("the construction's records sit beside it"))).toBe(false)
    // The person fills the round brief: the reconstruct absorbs it — the
    // todo re-renders (a new floor), the duty line goes quiet.
    writeFileSync(
      join(f.dir, "docs/R-01/round.md"),
      renderRoundBrief(1).replace("## Goal", "## Goal\n\nPort the core; the journal deferred."),
    )
    await f.commit("fill the round brief")
    const reconstructed = await f.run({ stopBefore: "formulate" })
    expect(reconstructed.code).toBe(0)
    expect(reconstructed.lines.some((line) => line.includes("the landed formulation todo of"))).toBe(false)
    expect(reconstructed.lines.some((line) => line.includes("review stop: the formulation todo of"))).toBe(true)
    expect(reconstructed.lines.some((line) => line.includes("is still the untouched stub"))).toBe(false)
    // The re-rendered todo carries the filled brief's goal (the construct
    // reads round.md), its id the index's pending formulation line.
    const index = (await Bun.file(join(f.dir, "docs/R-01/P02-test/tasks.md")).text()).trim().split("\n")
    const pending = index.filter((line) => /^- \[ \] T-\d+/.test(line))
    expect(pending).toHaveLength(1)
    const id = /^- \[ \] (T-\d+)/.exec(pending[0]!)![1]!
    const todo = await Bun.file(join(f.dir, "docs", id, "todo.md")).text()
    expect(todo).toContain("Port the core; the journal deferred.")
    // plan dispatches the reviewed task (the loop's formulation route).
    expect((await f.run({ stopBefore: "execute" })).code).toBe(0)
  })

  // The charter pack (the synthesis suite's): a verify-plan charter makes the
  // construct run the constructor session, so the digest keep and its
  // --resynthesize bypass are observable as sessions and todo bytes.
  const CHARTER_PACK = [
    "# verify",
    "",
    "## acceptance",
    "",
    "### result-line",
    "",
    "Write it in every report: `Result: PASS` means every acceptance criterion was observed to pass.",
    "",
    "## guarantees",
    "",
    "### verify-plan",
    "",
    "The charter bar the plan must serve.",
    "",
  ].join("\n")

  const entry = (name: string): ModelEntry => ({ name, layer: "operator", agent: "opencode", model: `prov/${name}` })
  const routing = (): RoutingFacts => ({
    registry: {
      layers: [{ name: "operator", path: "/unused/models.json" }],
      tz: "UTC",
      agents: new Map([["opencode", { name: "opencode", layer: "operator", adapter: "opencode" }]]),
      models: new Map([entry("a"), entry("free")].map((item) => [item.name, item])),
      tiers: { deep: { tier: "deep", names: ["a"], layer: "operator" } as TierList },
      routes: new Map(),
      unused: [],
      classifier: { names: ["free"], layer: "operator" },
    } as ModelRegistry,
    agentFilter: "opencode",
    filterSource: undefined,
    defaultAgent: "opencode",
    runAgent: "opencode",
    router: services().router,
    clock: services().clock,
  })

  const VERIFY_MARK = "You read one prompt that a planning step"
  const FIDELITY_MARK = "You judge the fidelity of one synthesis"
  const verifyYes: TurnScript = (ctx) => {
    if (!ctx.text.includes(VERIFY_MARK)) return undefined
    return [ev.text(ctx.session, `vrf_${ctx.n}`, "Consistent: yes"), ev.step(ctx.session, `vrfstp_${ctx.n}`), ev.idle(ctx.session)]
  }
  const fidelityPass: TurnScript = (ctx) => {
    if (!ctx.text.includes(FIDELITY_MARK)) return undefined
    return [ev.text(ctx.session, `fid_${ctx.n}`, "Fidelity: pass"), ev.step(ctx.session, `fidstp_${ctx.n}`), ev.idle(ctx.session)]
  }

  // The constructor turn: one obligation row per source section the prompt
  // carries, quoting its first line (the content-tolerant locate's happy
  // path), the ids continuing at the prompt's own nextId.
  const constructorOf = (brief: () => string): TurnScript => (ctx) => {
    if (!ctx.text.includes(SYNTHESIS_MARK)) return undefined
    const start = Number(/continue the O sequence at O-(\d+)/.exec(ctx.text)?.[1] ?? "2")
    const rows: string[] = []
    for (const match of ctx.text.matchAll(/^### (\S+\.md)\n\n([^\n]+)/gm)) {
      rows.push(`- O-${String(start + rows.length).padStart(2, "0")} | ${match[1]} | "${match[2]!.trim()}" | the plan's tasks cover it`)
    }
    return synthesisTurn(brief(), rows)(ctx)
  }

  test("--resynthesize bypasses the digest keep: the constructor re-voices, the new todo lands for review", async () => {
    const brief = { text: "The round's goals, re-voiced under the charter." }
    const f = await loopFixture("mt", (dir) => ({
      turn: (ctx) => verifyYes(ctx) ?? fidelityPass(ctx) ?? constructorOf(() => brief.text)(ctx) ?? artifactTurns(dir)(ctx)!,
    }))
    fixtures.push(f)
    await mkdirSync(join(f.dir, ".opencode", "auto", "intents"), { recursive: true })
    await Bun.write(join(f.dir, ".opencode/auto/intents/verify.md"), CHARTER_PACK)
    await establishRound(f.dir, { phases: "mt" })
    writeFileSync(join(f.dir, "docs/R-01/round.md"), renderRoundBrief(1).replace("## Goal", "## Goal\n\nPort the core with the protocol intact."))
    await f.commit("round setup")
    // The construct runs the synthesis pipeline: the constructor session
    // re-voices, the synthesized todo lands, the review stop answers.
    const first = await f.run({ stopBefore: "formulate", intent: "verify", routing: routing() })
    expect(first.code).toBe(0)
    expect(first.lines.some((line) => line.includes("✓ formulation synthesis: the constructor"))).toBe(true)
    const todo = await Bun.file(join(f.dir, "docs/T-001/todo.md")).text()
    expect(todo).toContain(brief.text)
    // The synthesis wrote the round's audit record: the review stop names it
    // beside the todo (D3's output — the verdicts and the synthesis:/
    // fidelity: entries live there).
    expect(first.lines.some((line) => line.includes("ℹ the construction's records sit beside it in docs/R-01/prompt-audit.md"))).toBe(true)
    expect((await Bun.file(join(f.dir, "docs/R-01/prompt-audit.md")).text()).includes("synthesis:")).toBe(true)
    // The plain re-run digest-keeps (plans/0097 D6): no constructor session,
    // the todo byte-identical — the no-person-edit-channel discipline (the
    // todo is driver-owned, whatever stands is what construction landed).
    const constructorsBefore = f.agent.prompts.filter((prompt) => prompt.text.includes(SYNTHESIS_MARK)).length
    const again = await f.run({ stopBefore: "formulate", intent: "verify", routing: routing() })
    expect(again.code).toBe(0)
    expect(again.lines.some((line) => line.includes("the landed formulation todo of T-001 stands"))).toBe(true)
    expect(f.agent.prompts.filter((prompt) => prompt.text.includes(SYNTHESIS_MARK))).toHaveLength(constructorsBefore)
    expect(await Bun.file(join(f.dir, "docs/T-001/todo.md")).text()).toBe(todo)
    // --resynthesize (plans/0101 D3): the keep bypassed — the constructor
    // session runs again, the new brief lands through the rewrite-on-diff.
    brief.text = "A sharper re-voicing of the same sources."
    const resynthesized = await f.run({ stopBefore: "formulate", intent: "verify", routing: routing(), resynthesize: true })
    expect(resynthesized.code).toBe(0)
    expect(resynthesized.lines.some((line) => line.includes("the landed formulation todo of"))).toBe(false)
    expect(resynthesized.lines.some((line) => line.includes("✓ formulation synthesis: the constructor"))).toBe(true)
    expect(f.agent.prompts.filter((prompt) => prompt.text.includes(SYNTHESIS_MARK))).toHaveLength(constructorsBefore + 1)
    const after = await Bun.file(join(f.dir, "docs/T-001/todo.md")).text()
    expect(after).toContain("A sharper re-voicing")
    expect(after).not.toBe(todo)
    // A one-shot force: the next plain re-run keeps whatever landed.
    const settled = await f.run({ stopBefore: "formulate", intent: "verify", routing: routing() })
    expect(settled.lines.some((line) => line.includes("the landed formulation todo of T-001 stands"))).toBe(true)
    expect(await Bun.file(join(f.dir, "docs/T-001/todo.md")).text()).toBe(after)
  })
})

// The re-derivable tail (plans/0101 D6): a round's phases.md tail — every
// phase with no directory work and no planning yet — is reshaping state the
// person amends at a review moment and the next advance applies ahead of the
// construction, on the driver's own commit; started and ticked phases are
// immutable (the sync's guards); and `amend --phases` is boundary-scoped to
// match (amendPhasesHold, the shell's amend row calls it).
describe("transfer: the re-derivable tail (plans/0101 D6)", () => {
  test("the boundary advance re-derives the unstarted tail before constructing: the amended value applies on the driver's own commit, the ticked prefix untouched", async () => {
    const f = await loopFixture("mt")
    fixtures.push(f)
    await Bun.write(join(f.dir, ".opencode/agent/auto.md"), "contract\n")
    await establishRound(f.dir, { phases: "mt", round: 1 })
    await f.commit("round setup")
    // run executes P01's work and stops at its boundary (D1) — the review
    // moment the person amends at (the shell's amend wrote the new config
    // value; the hold admitted it here).
    expect((await f.run()).code).toBe(0)
    const host = { client: f.agent.client, syncContext: async () => {}, restart: async () => false, close: () => {} }
    // The advance under the amended value ("mv": the tail's test phase
    // becomes acceptance): the re-derivation replaces the unstarted tail,
    // commits the rewrite on its own commit, and the construction that
    // follows builds on the rewritten index in the same invocation.
    const advanced = await capture(() => runTransfer(f.dir, { managed: host, phases: "mv" }))
    expect(advanced.code).toBe(0)
    expect(advanced.lines.some((line) => line.includes("✓ unstarted tail of round R-01 re-derived to config phases (P02-test → P02-acceptance)"))).toBe(true)
    expect(advanced.lines.some((line) => line.includes("started phases are untouched, the rewrite the driver's own commit"))).toBe(true)
    expect(await Bun.file(join(f.dir, "docs/R-01/phases.md")).text()).toContain("- [x] P01 implement\n- [ ] P02 acceptance\n")
    expect(existsSync(join(f.dir, "docs/R-01/P02-test"))).toBe(false)
    expect(existsSync(join(f.dir, "docs/R-01/P02-acceptance/tasks.md"))).toBe(true)
    expect(advanced.lines.some((line) => line.includes("review stop: the formulation todo of"))).toBe(true)
    expect(await f.git("log", "--format=%s")).toContain("PLAN resync R-01 tail to config phases (P02-test → P02-acceptance)")
    expect((await f.git("status", "--porcelain")).trim()).toBe("")
    // The plain re-run under the same value keeps the landed todo (the
    // digest-keep, plans/0097 D6): no re-derivation — the index and the
    // value agree — and no new construction.
    const kept = await capture(() => runTransfer(f.dir, { managed: host, phases: "mv" }))
    expect(kept.code).toBe(0)
    expect(kept.lines.some((line) => line.includes("re-derived"))).toBe(false)
    expect(kept.lines.some((line) => line.includes("the landed formulation todo of"))).toBe(true)
    // The review stop admits a further amendment (the hold's predicate: the
    // standing formulation), and the next advance extends the tail past the
    // ticked prefix — the floor's report duty moving to the round's new last
    // phase, the construction re-rendering for review.
    expect(await amendPhasesHold(f.dir, "mvk")).toBeUndefined()
    const extended = await capture(() => runTransfer(f.dir, { managed: host, phases: "mvk" }))
    expect(extended.code).toBe(0)
    expect(extended.lines.some((line) => line.includes("✓ unstarted tail of round R-01 re-derived to config phases (+ P03-knowledge)"))).toBe(true)
    expect(await Bun.file(join(f.dir, "docs/R-01/phases.md")).text()).toContain("- [x] P01 implement\n- [ ] P02 acceptance\n- [ ] P03 knowledge\n")
    expect(extended.lines.some((line) => line.includes("review stop: the formulation todo of"))).toBe(true)
    expect((await f.git("status", "--porcelain")).trim()).toBe("")
  })

  test("mid-phase nothing reshapes: the advance refuses without re-deriving, and amendPhasesHold scopes the amendment to review moments", async () => {
    const dir = await repo()
    const state = await (async () => {
      await establishRound(dir, { phases: "implement", round: 1 })
      return (await readPhases(dir, 1))!
    })()
    await pendingTaskPhase(dir, "implement", state.phases[0]!)
    // A reshaping value arriving mid-phase (a moved roadmap line — the
    // person's document has no hold): the advance still refuses without
    // applying it — the reshape is the boundary's, the index untouched.
    const out = await capture(() => runTransfer(dir, { phases: "implement,analysis" }))
    expect(out.code).toBe(2)
    expect(out.lines.some((line) => line.includes("nothing to advance: R-01.P01 implement still holds 1 pending task(s)"))).toBe(true)
    expect(out.lines.some((line) => line.includes("re-derived"))).toBe(false)
    expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).not.toContain("analysis")
    // The hold (the shell's amend row calls it): mid-phase the amendment is
    // refused naming the boundary channel...
    const hold = await amendPhasesHold(dir, "implement,analysis")
    expect(hold).toContain("--phases cannot change mid-phase: R-01.P01 implement holds 1 pending task(s)")
    expect(hold).toContain("the round's unstarted tail reshapes at a phase boundary")
    expect(hold).toContain("finish the phase with opencode-auto run")
    expect(hold).toContain("applies the value before constructing")
    // ...while every review moment admits it: no round yet, a complete round
    // (the value applies to the next round the roadmap else config governs),
    // a held survey boundary (the designed first use) — and m mode never
    // consults it (D8).
    const fresh = await repo()
    expect(await amendPhasesHold(fresh, "amt")).toBeUndefined()
    const complete = await repo()
    await completeRound(complete, "mt")
    expect(await amendPhasesHold(complete, "mtv")).toBeUndefined()
    const held = await repo()
    await forkedSurvey(held)
    expect(await amendPhasesHold(held, "survey,implement,analysis")).toBeUndefined()
    expect(await amendPhasesHold(dir, "m")).toBeUndefined()
  })

  test("started and ticked phases are immutable: a moved roadmap line that would drop them fails naming them, nothing written", async () => {
    // P01 ticked the way the handover path leaves it, P02's planning started
    // (its task done, the handover route) — both guards of the sync surface
    // through the re-derivation, the released roadmap line the moved
    // authority (the person's document, no hold on it).
    const dir = await repo()
    await Bun.write(join(dir, "docs/analysis.md"), ANALYSIS(["- R-01 mt — port the core"]))
    await establishRound(dir, { phases: "mt", round: 1 })
    const state = (await readPhases(dir, 1))!
    await Bun.write(join(dir, state.phases[0]!.dir, "tasks.md"), "- [x] T-001 task T-001\n")
    await mkdirSync(join(dir, "docs/T-001"), { recursive: true })
    await Bun.write(join(dir, "docs/T-001/done.md"), taskDoc("T-001", "R-01.P01"))
    expect(await completePhase(dir, state.phases[0]!, [])).toEqual([])
    await Bun.write(join(dir, state.phases[1]!.dir, "tasks.md"), "- [x] T-002 task T-002\n")
    await mkdirSync(join(dir, "docs/T-002"), { recursive: true })
    await Bun.write(join(dir, "docs/T-002/done.md"), taskDoc("T-002", "R-01.P02"))
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "P01 closed, P02 done")
    // The moved line drops the ticked P01: refused (the sync's guard), the
    // index untouched.
    await Bun.write(join(dir, "docs/analysis.md"), ANALYSIS(["- R-01 test,implement — port the core"]))
    const dropped = await capture(() => runTransfer(dir, { phases: "mt" }))
    expect(dropped.code).toBe(1)
    expect(dropped.lines.some((line) => line.includes('phase flow blocked: phases "test,implement" would drop the completed phase docs/R-01/P01-implement/'))).toBe(true)
    expect(await Bun.file(join(dir, "docs/R-01/phases.md")).text()).toContain("- [x] P01 implement")
    // A line that keeps the prefix but drops the started P02 (its directory
    // holds work — the task index planning wrote): refused the same way, the
    // refusal surfacing through the drift check's own guards.
    await Bun.write(join(dir, "docs/analysis.md"), ANALYSIS(["- R-01 implement,analysis — port the core"]))
    const started = await capture(() => runTransfer(dir, { phases: "mt" }))
    expect(started.code).toBe(1)
    expect(started.lines.some((line) => line.includes('phase flow blocked: phases "implement,analysis" would drop docs/R-01/P02-test/'))).toBe(true)
    expect(started.lines.some((line) => line.includes("it already holds work (tasks.md)"))).toBe(true)
    expect(existsSync(join(dir, "docs/R-01/P02-test"))).toBe(true)
  })
})
