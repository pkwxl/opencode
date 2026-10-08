// The survey phase and the human clarification gate (plans/0081 D14/D15),
// driven through the phase loop on the native fake agent over a real git
// repository: the survey task writes survey.md with a recorded fork, the gate
// holds the phase open awaiting the person (exit 2, done.md waits), the
// person's `Clarified: yes` releases the phase and approves the proposed
// `## Project brief` section — which the driver installs verbatim into
// .opencode/auto/brief.md in its own commit — and the round then flows into
// its implement phase, whose final-phase duty self-heals the round report.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { appendOneTask, artifactTurns, loopFixture, promptPhaseDir, type LoopFixture } from "./fixtures/loop"
import type { FakeAgentOptions, TurnScript } from "./fixtures/agent"
import { establishRound } from "../src/phases"

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

const ROUND_REPORT = ["# Round report", "", "The round's account for the person.", "", "<!-- auto: eof -->", ""].join("\n")

const wrapupReport = (id: string) =>
  [
    `# Report (${id})`,
    "",
    "The wrap-up session reviewed the work against the task's acceptance statements and",
    "recorded the verification evidence: what was delivered, where it lives, and how it",
    "was checked.",
    "",
    "Result: PASS",
    "",
    "<!-- auto: eof -->",
    "",
  ].join("\n")

// The turn script: the survey task's session writes survey.md (forked, with
// the `## Project brief` proposal); the wrap-up sessions write their reports;
// the report self-heal's append lands a report task and the report; the
// planning and handover sessions ride the artifact turns. surveyDir is a box
// the fixture fills once the round is established (the whole-task prompt
// carries no phase directory of its own). analysisBlocks records which
// planning prompts carried the approved-analysis block (plans/0085 A1: the
// survey's planner alone).
const turn = (dir: string, surveyDir: { path?: string }, analysisBlocks: string[] = []): TurnScript => (ctx) => {
  if (ctx.text.includes("## Input: approved project analysis")) {
    analysisBlocks.push(ctx.text.includes('"Survey" phase') ? "survey" : ctx.text.includes('"Implementation" phase') ? "implement" : "other")
  }
  // The wrap-up check comes first: its prompt embeds the task block too.
  if (ctx.text.includes("only performs the wrap-up")) {
    const id = /docs\/(T-\d+)\/report\.md/.exec(ctx.text)?.[1]
    if (id) {
      mkdirSync(join(dir, "docs", id), { recursive: true })
      writeFileSync(join(dir, "docs", id, "report.md"), wrapupReport(id))
    }
    return undefined
  }
  // The survey task's whole-session: its task block names T-001 (the done
  // list's `- [done] T-001:` line never matches the block form).
  if (ctx.text.includes("# T-001: task T-001\n")) {
    if (surveyDir.path !== undefined) writeFileSync(join(dir, surveyDir.path, "survey.md"), SURVEY_DOC)
    return undefined
  }
  // The round-report self-heal's append (plans/0081 D4).
  if (ctx.text.includes("## Input: the task index as it stands") && ctx.text.includes("Round report self-heal")) {
    const phaseDir = promptPhaseDir(ctx.text)
    if (phaseDir) {
      appendOneTask(dir, phaseDir)
      writeFileSync(join(dir, "docs/R-01/report-for-user.md"), ROUND_REPORT)
    }
    return undefined
  }
  return artifactTurns(dir)(ctx)
}

async function fixture(analysisBlocks: string[] = []): Promise<LoopFixture> {
  const surveyDir: { path?: string } = {}
  const f = await loopFixture("survey,implement", (dir): FakeAgentOptions => ({ turn: turn(dir, surveyDir, analysisBlocks) }))
  made.push(f)
  await mkdirSync(join(f.dir, ".opencode/auto/phases"), { recursive: true })
  await Bun.write(join(f.dir, ".opencode/auto/phases/survey.md"), SURVEY_TYPE)
  await establishRound(f.dir, { phases: "survey,implement" })
  // A released project analysis (plans/0085 A1): the survey phase's planning
  // session must read it; no other planning session gets it.
  await mkdirSync(join(f.dir, "docs"), { recursive: true })
  await Bun.write(
    join(f.dir, "docs/analysis.md"),
    ["# Project analysis", "", "## Analysis", "", "Two modules, one risk area.", "", "## Goals", "", "Ship the port with the protocol intact.", "", "## Project brief", "", "A faithful port.", "", "## Roadmap", "", "- R-01 survey,implement — port the core", "", "Clarified: yes", ""].join("\n"),
  )
  surveyDir.path = (await f.phase(0)).dir
  await f.commit("round setup")
  return f
}

describe("the survey phase and the human clarification gate (plans/0081 D14/D15)", () => {
  test("a recorded fork holds the phase awaiting the person; Clarified: yes releases it and installs the approved brief", async () => {
    const analysisBlocks: string[] = []
    const f = await fixture(analysisBlocks)
    // The survey task's session wrote survey.md with one open fork: the
    // handover distills, then the gate holds (exit 2, done.md waits).
    const held = await f.run()
    expect(held.code).toBe(2)
    expect(held.lines.some((line) => line.includes("P01-survey Survey awaits your clarification"))).toBe(true)
    expect(held.lines.some((line) => line.includes("records 1 open Fork: line(s)"))).toBe(true)
    expect(held.lines.some((line) => line.includes("add `Clarified: yes` to release the phase"))).toBe(true)
    // The release accepts the recorded defaults (plans/0085 A3): the stop
    // says so, and the fork carries its `Recommend:` clause.
    expect(held.lines.some((line) => line.includes("it accepts every line's `Recommend:` default"))).toBe(true)
    expect(held.lines.some((line) => line.includes("without a `Recommend:` default"))).toBe(false)
    expect(existsSync(join(f.dir, "docs/R-01/P01-survey/todo.md"))).toBe(true)
    expect(existsSync(join(f.dir, ".opencode/auto/brief.md"))).toBe(false)
    // The person's release: the release line beside the fork, committed like
    // any hand edit.
    const survey = join(f.dir, "docs/R-01/P01-survey/survey.md")
    writeFileSync(survey, (await Bun.file(survey).text()).replace("<!-- auto: eof -->", "Clarified: yes\n\n<!-- auto: eof -->"))
    await f.commit("clarify the survey")
    const released = await f.run()
    expect(released.code).toBe(0)
    expect(existsSync(join(f.dir, "docs/R-01/P01-survey/done.md"))).toBe(true)
    // The approved `## Project brief` section is installed verbatim, in its
    // own commit (D15.2; the install names its source document since
    // plans/0084 generalized it beyond the survey).
    const brief = await Bun.file(join(f.dir, ".opencode/auto/brief.md")).text()
    expect(brief).toContain("a clean-room reimplementation of the core")
    expect(brief).toContain("rule separation")
    expect(brief).not.toContain("Fork:")
    expect(await f.git("log", "--format=%s")).toContain("PLAN brief install the approved project brief (from docs/R-01/P01-survey/survey.md)")
    // The round completed and its report stands (the final m phase's
    // self-healed report task): the conclusion names the report path.
    expect(released.lines.some((line) => line.includes("✓ all phases complete"))).toBe(true)
    expect(released.lines.some((line) => line.includes("round report for the person: docs/R-01/report-for-user.md"))).toBe(true)
    expect(existsSync(join(f.dir, "docs/R-01/report-for-user.md"))).toBe(true)
    expect((await f.git("status", "--porcelain")).trim()).toBe("")
    // The approved analysis reached the survey's planning session alone
    // (plans/0085 A1): the human-gated phase reads the person's settled
    // decisions; the implement phase that followed did not.
    expect(analysisBlocks).toEqual(["survey"])
  })
})
