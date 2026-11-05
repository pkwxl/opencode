// clarify, the person's release command (plans/0116): the two surfaces —
// the unreleased analysis at the project start, the held survey at a phase
// boundary — each released by the command where the stops today instruct the
// hand edit, proven byte-equivalent to that edit (the gate reads the mark the
// command wrote), plus the refusal matrix (problems, bare forks, the missing
// survey, the dirty tree, nothing awaiting, already released) and the two
// dirty-tree shapes (the person's uncommitted answer folds into the release
// commit; anything beyond the target refuses). The analysis surface drives
// plain repositories (transfer.test's shapes); the survey surface rides the
// loop fixture through run's boundary stop and the advance that follows
// (survey-gate's walkthrough with the command in place of the hand edit).
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { clarifyGate } from "../src/clarify"
import { CLARIFIED_MARK, establishRound, phaseGateProblems, phaseGates, readPhases } from "../src/phases"
import { briefProposal } from "../src/brief"
import { runTransfer } from "../src/transfer"
import { autoSwitches, setSwitchModelRegistry } from "../src/switches"
import { renderTaskIndex } from "../src/tasks"
import { artifactTurns, loopFixture, taskDoc, type LoopFixture } from "./fixtures/loop"
import { freshRepo, git } from "./fixtures/runner"

const made: string[] = []
const fixtures: LoopFixture[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
  for (const fixture of fixtures.splice(0)) rmSync(fixture.dir, { recursive: true, force: true })
})

// Scrub the ambient OPENCODE_AUTO_* layer and capture the terminal around a
// core call (the fixtures' convention; commitTree logs its own commit line,
// so the capture keeps the output assertable and quiet).
async function capture<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const saved = Object.entries(process.env).filter(([key]) => /^OPENCODE_AUTO_/.test(key))
  for (const [key] of saved) delete process.env[key]
  const lines: string[] = []
  const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "))
  })
  try {
    return { result: await run(), lines }
  } finally {
    printed.mockRestore()
    for (const [key, value] of saved) if (value !== undefined) process.env[key] = value
  }
}

// runTransfer (the release's consumer) needs the switch resets around it —
// the transfer.test convention, its finally restoring the unfrozen snapshot.
async function captureAdvance(run: () => Promise<number>): Promise<{ code: number; lines: string[] }> {
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

const ANALYSIS = (clarified: boolean, roadmap = "- R-01 mt — port the core") =>
  [
    "# Project analysis",
    "",
    "## Analysis",
    "",
    "Two modules, one risk area.",
    "",
    "## Goals",
    "",
    "Ship the port with the protocol intact.",
    "",
    "Fork: scheduling — two rounds or one; Recommend: one round.",
    "",
    "## Project brief",
    "",
    "A faithful port.",
    "",
    "## Roadmap",
    "",
    roadmap,
    "",
    ...(clarified ? [CLARIFIED_MARK] : []),
    "",
  ].join("\n")

// The re-work bundle's survey type, as `init --intent` materializes it (the
// transfer.test shape).
const SURVEY_TYPE = ["# Survey", "", "Gate: human", "Phase-artifacts: survey.md", "", "## plan duties", "", "Inventory-level reading only.", "", "<!-- auto: eof -->", ""].join("\n")

// A survey phase whose work is done and whose survey.md records one open
// fork (the gate-held boundary state) — optionally without the survey
// document (the missing-survey refusal) or with a bare fork line.
async function surveyBoundary(dir: string, survey?: string[]): Promise<void> {
  await mkdirSync(join(dir, ".opencode/auto/phases"), { recursive: true })
  await Bun.write(join(dir, ".opencode/auto/phases/survey.md"), SURVEY_TYPE)
  await establishRound(dir, { phases: "survey,implement", round: 1 })
  const state = (await readPhases(dir, 1))!
  const surveyPhase = state.phases[0]!
  const index = join(dir, surveyPhase.dir, "tasks.md")
  await Bun.write(index, `${renderTaskIndex("R-01.P01", [])}- [x] T-001 task T-001\n`)
  await mkdirSync(join(dir, "docs/T-001"), { recursive: true })
  await Bun.write(join(dir, "docs/T-001/done.md"), taskDoc("T-001", "R-01.P01"))
  if (survey) await Bun.write(join(dir, surveyPhase.dir, "survey.md"), survey.join("\n"))
  await git(dir, "add", "-A")
  await git(dir, "commit", "-qm", "survey done, fork open")
}

const FORKED_SURVEY = ["# Survey", "", "The reference's map.", "", "Fork: scope — the journal too; Recommend: the core only.", "", "<!-- auto: eof -->", ""]

describe("clarify: the analysis release (plans/0116 D1/D4)", () => {
  test("writes the mark on the unreleased analysis (the review prints the roadmap and forks) and commits it; the following transfer establishes R-01", async () => {
    const dir = await repo()
    // The novice state: init's never-committed config layer beside the whole
    // analysis, uncommitted and untracked — the manual release (`git add -A`
    // at the awaiting stop) sweeps both, and the command emulates that act.
    await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ phases: "mt" }))
    await Bun.write(join(dir, ".opencode/agent/auto.md"), "contract\n")
    await Bun.write(join(dir, "docs/analysis.md"), ANALYSIS(false))
    const { result } = await capture(() => clarifyGate(dir, { phases: "mt" }))
    expect(result.type).toBe("released")
    // The review print: the roadmap line and the fork with its default.
    expect(result.lines.some((line) => line.includes("the release of docs/analysis.md puts in force, as written:"))).toBe(true)
    expect(result.lines.some((line) => line.includes("- R-01 mt — port the core"))).toBe(true)
    expect(result.lines.some((line) => line.includes("Fork: scheduling — two rounds or one; Recommend: one round."))).toBe(true)
    expect(result.lines.some((line) => line.includes("installs verbatim into .opencode/auto/brief.md"))).toBe(true)
    expect(result.lines.some((line) => line.includes("folded into the release commit: .opencode/agent/auto.md, .opencode/auto/config.json"))).toBe(true)
    // The mark landed at the document's end (no eof terminator on the
    // analysis), the release commit is the driver's own and lists its folds,
    // and the tree is clean — the whole novice state folded into the one
    // release commit.
    const text = await Bun.file(join(dir, "docs/analysis.md")).text()
    expect(text.trimEnd().endsWith(CLARIFIED_MARK)).toBe(true)
    const subjects = await git(dir, "log", "--format=%s")
    expect(subjects).toContain("PLAN clarify the analysis release (docs/analysis.md)")
    const body = await git(dir, "log", "--format=%b", "-1")
    expect(body).toContain("Auto-Stage: clarify")
    expect(body).toContain("Changes folded into this release commit:")
    expect(body).toContain("- .opencode/auto/config.json")
    expect((await git(dir, "status", "--porcelain")).trim()).toBe("")
    expect(result.lines.some((line) => line.includes("next: opencode-auto transfer"))).toBe(true)
    // The consumer: the release the hand edit would have made is in force —
    // the next transfer installs the brief and establishes R-01.
    const advance = await captureAdvance(() => runTransfer(dir, { phases: "mt" }))
    expect(advance.code).toBe(0)
    expect(advance.lines.some((line) => line.includes("✓ round R-01 established: P01-implement, P02-test — phases from the roadmap of docs/analysis.md"))).toBe(true)
  })

  test("m mode names plan as the release's consumer (transfer refuses m mode)", async () => {
    const dir = await repo()
    await Bun.write(join(dir, "docs/analysis.md"), ANALYSIS(false, "- R-01 m — port the core"))
    const { result } = await capture(() => clarifyGate(dir, { phases: "m" }))
    expect(result.type).toBe("released")
    expect(result.lines.some((line) => line.includes("next: opencode-auto plan"))).toBe(true)
  })

  test("grammar problems hold the release: nothing written, nothing committed", async () => {
    const dir = await repo()
    await Bun.write(join(dir, "docs/analysis.md"), ["# Project analysis", "", "no sections at all", ""].join("\n"))
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "the broken analysis")
    const { result } = await capture(() => clarifyGate(dir, { phases: "mt" }))
    expect(result.type).toBe("held")
    expect(result.lines.some((line) => line.includes("problems that hold its release"))).toBe(true)
    expect((await Bun.file(join(dir, "docs/analysis.md")).text()).includes(CLARIFIED_MARK)).toBe(false)
    expect((await git(dir, "log", "--format=%s")).includes("PLAN clarify")).toBe(false)
  })
})

describe("clarify: the survey release (plans/0116 D1/D4)", () => {
  test("the held boundary: the mark lands before the eof terminator, the gate passes, and the advance completes the phase with the brief installed", async () => {
    // The survey-gate walkthrough with the command in place of the hand
    // edit: run stops at the held boundary, clarify releases, the advance
    // completes the phase and installs the approved brief.
    const f = await loopFixture("survey,implement", (dir) => ({
      turn: (ctx) => {
        if (ctx.text.includes("only performs the wrap-up")) {
          const id = /docs\/(T-\d+)\/report\.md/.exec(ctx.text)?.[1]
          if (id) {
            mkdirSync(join(dir, "docs", id), { recursive: true })
            writeFileSync(
              join(dir, "docs", id, "report.md"),
              [
                `# Report (${id})`,
                "",
                "- every acceptance criterion: met (the fake agent inspected the unit's work).",
                "",
                "## Overall conclusion",
                "",
                "Done.",
                "",
                "Result: PASS",
                "",
                "<!-- auto: eof -->",
                "",
              ].join("\n"),
            )
          }
          return undefined
        }
        if (ctx.text.includes("# T-002: task T-002\n")) {
          const surveyDir = join(dir, "docs/R-01/P01-survey")
          mkdirSync(surveyDir, { recursive: true })
          writeFileSync(
            join(surveyDir, "survey.md"),
            [
              "# Survey (docs/R-01/P01-survey/survey.md)",
              "",
              "Fork: scope — the journal too reshapes R-02's schedule; Recommend: the core only.",
              "",
              "## Project brief",
              "",
              "A clean-room reimplementation of the core.",
              "",
              "<!-- auto: eof -->",
              "",
            ].join("\n"),
          )
          return undefined
        }
        return artifactTurns(dir)(ctx)
      },
    }))
    fixtures.push(f)
    await mkdirSync(join(f.dir, ".opencode/auto/phases"), { recursive: true })
    await Bun.write(join(f.dir, ".opencode/auto/phases/survey.md"), SURVEY_TYPE)
    await establishRound(f.dir, { phases: "survey,implement" })
    await mkdirSync(join(f.dir, "docs"), { recursive: true })
    await Bun.write(
      join(f.dir, "docs/analysis.md"),
      ["# Project analysis", "", "## Analysis", "", "Two modules.", "", "## Goals", "", "Ship it.", "", "## Project brief", "", "A faithful port.", "", "## Roadmap", "", "- R-01 survey,implement — port the core", "", `${CLARIFIED_MARK}`, ""].join("\n"),
    )
    await f.commit("round setup")
    const held = await f.run()
    expect(held.code).toBe(2)
    expect(held.lines.some((line) => line.includes("P01-survey Survey awaits your clarification"))).toBe(true)
    // The stop teaches the command (D7).
    expect(held.lines.some((line) => line.includes("then release it: opencode-auto clarify"))).toBe(true)
    // The release: the fork and its default printed for review, the mark
    // written before the terminator, the driver's own commit.
    const { result } = await capture(() => clarifyGate(f.dir, { phases: "survey,implement" }))
    expect(result.type).toBe("released")
    expect(result.lines.some((line) => line.includes("the release of docs/R-01/P01-survey/survey.md accepts every recorded default:"))).toBe(true)
    expect(result.lines.some((line) => line.includes("Fork: scope — the journal too reshapes R-02's schedule; Recommend: the core only."))).toBe(true)
    const surveyText = await Bun.file(join(f.dir, "docs/R-01/P01-survey/survey.md")).text()
    expect(surveyText.trimEnd().endsWith("<!-- auto: eof -->")).toBe(true)
    expect(surveyText.includes(CLARIFIED_MARK)).toBe(true)
    expect(await git(f.dir, "log", "--format=%s")).toContain("PLAN clarify R-01.P01 survey (release the recorded forks)")
    expect((await git(f.dir, "status", "--porcelain")).trim()).toBe("")
    // Byte-equivalence at the gate: the same problems pass that the hand
    // edit clears, and the brief proposal is in force for the install.
    const state = (await readPhases(f.dir, 1))!
    expect(await phaseGateProblems(f.dir, state.phases[0]!, phaseGates(state.phases[0]!, []))).toEqual([])
    expect(briefProposal(surveyText)).toContain("clean-room reimplementation")
    // The advance completes the phase and installs the approved brief.
    const advanced = await f.run({ stopBefore: "formulate" })
    expect(advanced.code).toBe(0)
    expect(existsSync(join(f.dir, "docs/R-01/P01-survey/done.md"))).toBe(true)
    expect(await Bun.file(join(f.dir, ".opencode/auto/brief.md")).text()).toContain("clean-room reimplementation")
  })

  test("the person's uncommitted answer beside the fork rides the release commit; changes beyond the survey refuse", async () => {
    const dir = await repo()
    await surveyBoundary(dir, FORKED_SURVEY)
    // The answer written beside the fork line, not yet committed — the
    // release commit carries it with the mark (one commit, content and
    // signature).
    const surveyPath = join(dir, "docs/R-01/P01-survey/survey.md")
    writeFileSync(surveyPath, (await Bun.file(surveyPath).text()).replace("Recommend: the core only.", "Recommend: the core only. Answer: the core only, the journal moves to R-02."))
    const folded = (await capture(() => clarifyGate(dir, { phases: "survey,implement" }))).result
    expect(folded.type).toBe("released")
    const head = await git(dir, "show", "--format=", "-1")
    expect(head).toContain("Answer: the core only, the journal moves to R-02.")
    expect(head).toContain(CLARIFIED_MARK)

    // Beyond the target: an unrelated uncommitted file refuses, nothing
    // written, the file named.
    const other = await repo()
    await surveyBoundary(other, FORKED_SURVEY)
    await Bun.write(join(other, "NOTES.md"), "unrelated\n")
    const refused = (await capture(() => clarifyGate(other, { phases: "survey,implement" }))).result
    expect(refused.type).toBe("held")
    expect(refused.lines.some((line) => line.includes("changes beyond docs/R-01/P01-survey/survey.md"))).toBe(true)
    expect(refused.lines).toContain("  NOTES.md")
    expect((await Bun.file(join(other, "docs/R-01/P01-survey/survey.md")).text()).includes(CLARIFIED_MARK)).toBe(false)
  })

  test("the refusal matrix: bare forks, the missing survey, already released, pending tasks, nothing awaiting", async () => {
    // A Fork: line without its Recommend: default (plans/0085 A3): the
    // person decides from consequences plus one default, so the release
    // refuses until the agent adds it.
    const bare = await repo()
    await surveyBoundary(bare, ["# Survey", "", "Fork: scope — the journal too.", "", "<!-- auto: eof -->", ""])
    const bareOut = (await capture(() => clarifyGate(bare, { phases: "survey,implement" }))).result
    expect(bareOut.type).toBe("held")
    expect(bareOut.lines.some((line) => line.includes("without a `Recommend:` default"))).toBe(true)

    // The missing survey: a gate problem, not a clarification awaiting.
    const missing = await repo()
    await surveyBoundary(missing)
    const missingOut = (await capture(() => clarifyGate(missing, { phases: "survey,implement" }))).result
    expect(missingOut.type).toBe("held")
    expect(missingOut.lines.some((line) => line.includes("is missing — the survey must exist"))).toBe(true)

    // Already released: the phase completes on the next advance, named.
    const released = await repo()
    await surveyBoundary(released, FORKED_SURVEY)
    const releasedSurvey = join(released, "docs/R-01/P01-survey/survey.md")
    writeFileSync(releasedSurvey, (await Bun.file(releasedSurvey).text()).replace("<!-- auto: eof -->", `${CLARIFIED_MARK}\n\n<!-- auto: eof -->`))
    await git(released, "add", "-A")
    await git(released, "commit", "-qm", "hand-released")
    const alreadyOut = (await capture(() => clarifyGate(released, { phases: "survey,implement" }))).result
    expect(alreadyOut.type).toBe("held")
    expect(alreadyOut.lines.some((line) => line.includes("already released — the phase completes on the next advance: opencode-auto transfer"))).toBe(true)

    // Pending execute work: the gate follows the phase's completion.
    const pending = await repo()
    await mkdirSync(join(pending, ".opencode/auto/phases"), { recursive: true })
    await Bun.write(join(pending, ".opencode/auto/phases/survey.md"), SURVEY_TYPE)
    await establishRound(pending, { phases: "survey,implement", round: 1 })
    const pendingState = (await readPhases(pending, 1))!
    const index = join(pending, pendingState.phases[0]!.dir, "tasks.md")
    await Bun.write(index, `${renderTaskIndex("R-01.P01", [])}- [ ] T-001 task T-001\n`)
    await mkdirSync(join(pending, "docs/T-001"), { recursive: true })
    await Bun.write(join(pending, "docs/T-001/todo.md"), taskDoc("T-001", "R-01.P01"))
    await git(pending, "add", "-A")
    await git(pending, "commit", "-qm", "phase setup")
    const pendingOut = (await capture(() => clarifyGate(pending, { phases: "survey,implement" }))).result
    expect(pendingOut.type).toBe("held")
    expect(pendingOut.lines.some((line) => line.includes("still holds 1 pending task(s)"))).toBe(true)
    expect(pendingOut.lines.some((line) => line.includes("execute them first: opencode-auto run"))).toBe(true)

    // A near-miss fork line (plans/0169 D3): the release accepts exactly the
    // strict grammar's defaults, so a decision line the scan cannot read
    // refuses until normalized — never silently skipped.
    const nearMiss = await repo()
    await surveyBoundary(nearMiss, ["# Survey", "", "The reference's map.", "", "1. Fork: scope — the journal too; Recommend: the core only.", "", "<!-- auto: eof -->", ""])
    const nearMissOut = (await capture(() => clarifyGate(nearMiss, { phases: "survey,implement" }))).result
    expect(nearMissOut.type).toBe("held")
    expect(nearMissOut.lines.some((line) => line.includes("carries 1 near-miss Fork line(s)"))).toBe(true)
    expect(nearMissOut.lines.some((line) => line.includes("normalize them to start with `Fork:`"))).toBe(true)
    // Nothing awaiting at all: the general refusal names the two moments.
    const empty = await repo()
    const emptyOut = (await capture(() => clarifyGate(empty, { phases: "mt" }))).result
    expect(emptyOut.type).toBe("held")
    expect(emptyOut.lines.some((line) => line.includes("nothing awaits your clarification"))).toBe(true)
    expect(emptyOut.lines.some((line) => line.includes("releases exactly two moments"))).toBe(true)
  })
})

  test("a zero-fork survey proposing a brief is a release moment too (plans/0169 D3): the command writes the region and the gate passes", async () => {
    const dir = await repo()
    await surveyBoundary(dir, [
      "# Survey",
      "",
      "The reference's map.",
      "",
      "## Project brief",
      "",
      "A clean-room reimplementation of the core.",
      "",
      "<!-- auto: eof -->",
      "",
    ])
    const out = (await capture(() => clarifyGate(dir, { phases: "survey,implement" }))).result
    expect(out.type).toBe("released")
    expect(out.lines.some((line) => line.includes("approves the proposed `## Project brief`"))).toBe(true)
    // The forward channel (plans/0169 D1): the command writes the trailing
    // `## Release` region, the mark inside it — and the gate reads it.
    const written = await Bun.file(join(dir, "docs/R-01/P01-survey/survey.md")).text()
    expect(written).toContain("## Release\n\nClarified: yes\n\n<!-- auto: eof -->")
    const state = (await readPhases(dir, 1))!
    expect(await phaseGateProblems(dir, state.phases[0]!, phaseGates(state.phases[0]!))).toEqual([])
  })
