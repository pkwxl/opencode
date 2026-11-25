// The survey phase and the human clarification gate (plans/0081 D14/D15) at
// the person's advance: the survey boundary is seeded by hand — the phase's
// work done, its survey document recording a fork (the task loop that walked
// there retired, plans/0314) — and every act is the pull path's. The gate
// holds the phase open awaiting the person (transfer exits 2, done.md
// waits), the person's `Clarified: yes` releases the phase and approves the
// proposed `## Project brief` section — which the advance installs verbatim
// into .opencode/auto/brief.md in its own commit — and the round then
// advances into its implement phase.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { donePhase, finishPhaseWork, landPhaseHandover, loopFixture, type LoopFixture } from "./fixtures/loop"
import { captureRun } from "./fixtures/capture"
import { establishRound } from "../src/phases"
import { transferDeterministic } from "../src/transfer"

const made: LoopFixture[] = []
afterEach(() => {
  for (const fixture of made.splice(0)) rmSync(fixture.dir, { recursive: true, force: true })
})

// The re-work bundle's survey type, as `init --intent` materializes it.
const SURVEY_TYPE = ["# Survey", "", "Gate: human", "Phase-artifacts: survey.md", "", "## plan duties", "", "Inventory-level reading only.", "", "<!-- auto: eof -->", ""].join("\n")

const SURVEY_DOC = [
  "# Survey (docs/R-01/P01-survey/survey.md)",
  "",
  "The reference's map: two subsystem areas, ~2k lines.",
  "",
  "Fork: scope — the journal too reshapes R-02's schedule; Recommend: the core only.",
  "",
  "## Project brief",
  "",
  "The goal in the target's own terms: a clean-room reimplementation of the core.",
  "Reference location: ./linux, rule separation (its paths quarantined).",
  "Target: ./ext4x.",
  "Constraints that bind every round: the platform boundary is the printed interface alone.",
  "",
  "<!-- auto: eof -->",
  "",
].join("\n")

// The survey boundary state: the round established under a released project
// analysis whose roadmap line covers it (the tail re-derivation's authority),
// the survey phase's work done — its formulation unit and the survey task —
// and the survey document that task wrote.
async function fixture(surveyDoc: string = SURVEY_DOC): Promise<LoopFixture> {
  const f = await loopFixture("survey,implement")
  made.push(f)
  await mkdirSync(join(f.dir, ".opencode/auto/phases"), { recursive: true })
  await Bun.write(join(f.dir, ".opencode/auto/phases/survey.md"), SURVEY_TYPE)
  await establishRound(f.dir, { phases: "survey,implement" })
  await mkdirSync(join(f.dir, "docs"), { recursive: true })
  await Bun.write(
    join(f.dir, "docs/analysis.md"),
    ["# Project analysis", "", "## Analysis", "", "Two modules, one risk area.", "", "## Goals", "", "Ship the port with the protocol intact.", "", "## Project brief", "", "A faithful port.", "", "## Roadmap", "", "- R-01 survey,implement — port the core", "", "Clarified: yes", ""].join("\n"),
  )
  await f.commit("round setup")
  const survey = await f.phase(0)
  await donePhase(f, survey, ["T-001", "T-002"])
  await Bun.write(join(f.dir, survey.dir, "survey.md"), surveyDoc)
  await f.commit("survey done, fork open")
  return f
}

// The person's release mark, written before the eof terminator and committed
// like any hand edit.
async function clarify(f: LoopFixture): Promise<void> {
  const survey = join(f.dir, "docs/R-01/P01-survey/survey.md")
  writeFileSync(survey, (await Bun.file(survey).text()).replace("<!-- auto: eof -->", "Clarified: yes\n\n<!-- auto: eof -->"))
  await f.commit("clarify the survey")
}

describe("the survey phase and the human clarification gate (plans/0081 D14/D15; the boundary rhythm of plans/0101 D1/D2)", () => {
  test("a recorded fork holds the phase at the advance; Clarified: yes releases it and the advance installs the approved brief; the round then closes on its listing", async () => {
    const f = await fixture()
    const survey = await f.phase(0)
    const held = await captureRun(() => transferDeterministic(f.dir, { phases: "survey,implement" }))
    expect(held.code).toBe(2)
    // The human gate is checked first (D2): exit 2, done.md waits, and the
    // stop names the release line — no tokens spent before the person's
    // decision.
    expect(held.lines.some((line) => line.includes("P01-survey Survey awaits your clarification"))).toBe(true)
    expect(held.lines.some((line) => line.includes("records 1 open Fork: line(s)"))).toBe(true)
    expect(held.lines.some((line) => line.includes("add `Clarified: yes` to release the phase"))).toBe(true)
    // The install promise rides the proposal (plans/0207 D3): this survey
    // carries a `## Project brief` section, so the release line promises the
    // install — the byte-identical floor of the conditional clause.
    expect(held.lines.some((line) => line.includes("the phase completes and the approved `## Project brief` section is installed"))).toBe(true)
    // The release accepts the recorded defaults (plans/0085 A3): the stop
    // says so, and the fork carries its `Recommend:` clause.
    expect(held.lines.some((line) => line.includes("it accepts every line's `Recommend:` default"))).toBe(true)
    expect(held.lines.some((line) => line.includes("without a `Recommend:` default"))).toBe(false)
    expect(existsSync(join(f.dir, survey.dir, "todo.md"))).toBe(true)
    expect(existsSync(join(f.dir, survey.dir, "handover.md"))).toBe(false)
    expect(existsSync(join(f.dir, ".opencode/auto/brief.md"))).toBe(false)
    await clarify(f)
    // The advance: the gate re-check, the release's install — it closes the
    // phase and constructs the next phase's plan task, stopping at the
    // review seam.
    await landPhaseHandover(f, survey)
    const advanced = await captureRun(() => transferDeterministic(f.dir, { phases: "survey,implement" }))
    expect(advanced.code).toBe(0)
    expect(existsSync(join(f.dir, survey.dir, "done.md"))).toBe(true)
    // The approved `## Project brief` section is installed verbatim, in its
    // own commit (D15.2; the install names its source document since
    // plans/0084 generalized it beyond the survey).
    const brief = await Bun.file(join(f.dir, ".opencode/auto/brief.md")).text()
    expect(brief).toContain("a clean-room reimplementation of the core")
    expect(brief).toContain("rule separation")
    expect(brief).not.toContain("Fork:")
    expect(await f.git("log", "--format=%s")).toContain("PLAN brief install the approved project brief (from docs/R-01/P01-survey/survey.md)")
    // The next phase's plan task stands constructed and reviewed.
    const implement = await f.phase(1)
    const index = (await Bun.file(join(f.dir, implement.dir, "tasks.md")).text()).trim().split("\n")
    expect(index.filter((line) => /^\- \[ \] T-\d+/.test(line))).toHaveLength(1)
    expect(advanced.lines.some((line) => line.includes("its todo is the review object"))).toBe(true)
    // The implement phase's work stands done at the round's last boundary —
    // its handover landed by the distill grant's counterpart here.
    await finishPhaseWork(f, implement)
    await landPhaseHandover(f, implement)
    // The closing advance refuses while the round's own restatement listing
    // is an unfilled stub (G8's close listing — the person's act); the
    // listing alone is the round's remaining work (the round-close-then-stop
    // split, plans/0101 D2 shape 3).
    const unfilled = await captureRun(() => transferDeterministic(f.dir, { phases: "survey,implement" }))
    expect(unfilled.code).toBe(2)
    expect(unfilled.lines.some((line) => line.includes("does not pass its round-close checks"))).toBe(true)
    expect(unfilled.lines.some((line) => line.includes("close listing"))).toBe(true)
    // The round user report was never written and never demanded (plans/0109
    // D1 — the report is optional).
    expect(existsSync(join(f.dir, "docs/R-01/report-for-user.md"))).toBe(false)
    const roundDoc = join(f.dir, "docs/R-01/round.md")
    writeFileSync(roundDoc, (await Bun.file(roundDoc).text()).replace("## Close", "## Close\n\n- The survey's fork decision is restated in the project brief; nothing accepted as lost."))
    await f.commit("fill the round's close listing")
    const closed = await captureRun(() => transferDeterministic(f.dir, { phases: "survey,implement" }))
    expect(closed.code).toBe(0)
    expect(existsSync(join(f.dir, implement.dir, "done.md"))).toBe(true)
    expect(closed.lines.some((line) => line.includes("roadmap") && line.includes("R-02"))).toBe(true)
    expect(existsSync(join(f.dir, "docs/R-01/report-for-user.md"))).toBe(false)
    expect((await f.git("status", "--porcelain")).trim()).toBe("")
  })

  // plans/0236 D6 (0165-072): the approved brief installs AHEAD of the
  // completion rename — observed mid-flight at the install's own commit, the
  // one moment the kill window lived around. Before the fix the rename had
  // already happened when the brief landed, and a kill between the two lost
  // the install for good (the phase read done, no other path installs a
  // survey proposal).
  test("the released survey installs the approved brief while the phase is still pending — the kill window between install and rename closed", async () => {
    const f = await fixture()
    await clarify(f)
    const survey = await f.phase(0)
    await landPhaseHandover(f, survey)
    const released = await captureRun(() => transferDeterministic(f.dir, { phases: "survey,implement" }))
    expect(released.code).toBe(0)
    const commits = (await f.git("log", "--format=%H %s")).split("\n")
    const install = commits.findIndex((line) => line.includes("PLAN brief install the approved project brief"))
    const transition = commits.findIndex((line) => line.includes("PLAN transition P01-survey Survey"))
    expect(transition).toBeGreaterThanOrEqual(0)
    expect(install).toBeGreaterThan(transition)
    const tree = await f.git("ls-tree", "-r", "--name-only", commits[install]!.split(" ")[0]!, "docs/R-01/P01-survey")
    expect(tree).toContain("docs/R-01/P01-survey/todo.md")
    expect(tree.split("\n")).not.toContain("docs/R-01/P01-survey/done.md")
    expect(existsSync(join(f.dir, "docs/R-01/P01-survey/done.md"))).toBe(true)
    expect((await f.git("status", "--porcelain")).trim()).toBe("")
  })

  test("the held boundary is the designed amendment moment: the stop names the reshape channel, and the released advance re-derives the tail (plans/0101 D6)", async () => {
    const f = await fixture()
    const survey = await f.phase(0)
    // The gate holds at the advance: the awaiting lines name the reshape
    // channel beside the release — the survey's findings in hand, F10's
    // evidence mechanically acted on. The channel is the authority's
    // (plans/0114 D3): this round is roadmap-covered, so the stop names
    // moving the roadmap's line — the config amend wording never reaches a
    // covered round.
    const held = await captureRun(() => transferDeterministic(f.dir, { phases: "survey,implement" }))
    expect(held.code).toBe(2)
    expect(held.lines.some((line) => line.includes("to reshape the round from the findings: move or add its `R-01 <phases> — <goal>` line in docs/analysis.md"))).toBe(true)
    expect(held.lines.some((line) => line.includes("the config phases value is init-stamped machinery"))).toBe(true)
    expect(held.lines.some((line) => line.includes("--phases <value>"))).toBe(false)
    // The held boundary admits the reshape: the person moves the released
    // roadmap's line — the authority for the round's tail — and releases the
    // survey (`amend --phases` itself retired by plans/0137, the line the
    // one channel).
    const analysis = join(f.dir, "docs/analysis.md")
    writeFileSync(analysis, (await Bun.file(analysis).text()).replace("- R-01 survey,implement —", "- R-01 survey,implement,test —"))
    await clarify(f)
    // Land the distill output before applying the released boundary.
    await landPhaseHandover(f, survey)
    const advanced = await captureRun(() => transferDeterministic(f.dir, { phases: "survey,implement" }))
    expect(advanced.code).toBe(0)
    expect(advanced.lines.some((line) => line.includes("✓ unstarted tail of round R-01 re-derived to the roadmap of docs/analysis.md (+ P03-test)"))).toBe(true)
    expect(await Bun.file(join(f.dir, "docs/R-01/phases.md")).text()).toContain("P03 test")
    expect(await f.git("log", "--format=%s")).toContain("PLAN resync R-01 tail to the roadmap of docs/analysis.md (+ P03-test)")
    expect(existsSync(join(f.dir, survey.dir, "done.md"))).toBe(true)
    expect(advanced.lines.some((line) => line.includes("its todo is the review object"))).toBe(true)
    expect((await f.git("status", "--porcelain")).trim()).toBe("")
  })
})

// The survey's person marks (plans/0169, findings 0165-001/0165-002): the
// install is gated by the person's release mark, the gate holds wherever a
// person decision is pending (a proposed brief with zero forks, a near-miss
// fork line), and the mark counts only as the person's own whole line or
// inside their trailing `## Release` section — a session's indented or
// fenced example is never the person's release.
describe("the survey's person marks (plans/0169)", () => {
  const ZERO_FORK_PROPOSAL = SURVEY_DOC.replace("Fork: scope — the journal too reshapes R-02's schedule; Recommend: the core only.\n\n", "")

  test("a zero-fork survey proposing a brief holds for the person; unmarked, nothing installs (0165-001)", async () => {
    const f = await fixture(ZERO_FORK_PROPOSAL)
    const survey = await f.phase(0)
    const held = await captureRun(() => transferDeterministic(f.dir, { phases: "survey,implement" }))
    expect(held.code).toBe(2)
    expect(held.lines.some((line) => line.includes("proposes a `## Project brief` — awaiting the person"))).toBe(true)
    expect(existsSync(join(f.dir, ".opencode/auto/brief.md"))).toBe(false)
    // The person's release installs the proposal (the legacy whole-line
    // shape the person hand-writes).
    await clarify(f)
    await landPhaseHandover(f, survey)
    const advanced = await captureRun(() => transferDeterministic(f.dir, { phases: "survey,implement" }))
    expect(advanced.code).toBe(0)
    const brief = await Bun.file(join(f.dir, ".opencode/auto/brief.md")).text()
    expect(brief).toContain("a clean-room reimplementation of the core")
  })

  test("near-miss fork lines hold the gate — a decision line the scan cannot read never passes unread (0165-001)", async () => {
    const nearMiss = SURVEY_DOC.replace(
      "Fork: scope — the journal too reshapes R-02's schedule; Recommend: the core only.",
      "1. Fork: scope — the journal too reshapes R-02's schedule; Recommend: the core only.",
    )
    const f = await fixture(nearMiss)
    const held = await captureRun(() => transferDeterministic(f.dir, { phases: "survey,implement" }))
    expect(held.code).toBe(2)
    expect(held.lines.some((line) => line.includes("carries 1 near-miss Fork line(s)"))).toBe(true)
    expect(existsSync(join(f.dir, ".opencode/auto/brief.md"))).toBe(false)
  })

  test("a session's indented example mark never releases; the person's `## Release` region does (0165-002)", async () => {
    const forged = SURVEY_DOC.replace(
      "<!-- auto: eof -->",
      "To release, the person writes:\n\n    Clarified: yes\n\n<!-- auto: eof -->",
    )
    const f = await fixture(forged)
    const survey = await f.phase(0)
    const held = await captureRun(() => transferDeterministic(f.dir, { phases: "survey,implement" }))
    // Still held: the indented example is not the person's release.
    expect(held.code).toBe(2)
    expect(held.lines.some((line) => line.includes("records 1 open Fork: line(s)"))).toBe(true)
    expect(existsSync(join(f.dir, ".opencode/auto/brief.md"))).toBe(false)
    // The person's region releases it (the forward channel clarify writes).
    const doc = join(f.dir, survey.dir, "survey.md")
    writeFileSync(doc, (await Bun.file(doc).text()).replace("<!-- auto: eof -->", "## Release\n\nClarified: yes\n\n<!-- auto: eof -->"))
    await f.commit("clarify the survey")
    await landPhaseHandover(f, survey)
    const advanced = await captureRun(() => transferDeterministic(f.dir, { phases: "survey,implement" }))
    expect(advanced.code).toBe(0)
    const brief = await Bun.file(join(f.dir, ".opencode/auto/brief.md")).text()
    expect(brief).toContain("a clean-room reimplementation of the core")
  })
})
