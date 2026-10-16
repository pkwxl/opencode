// The pre-round project analysis document (plans/0084): the stub, the
// grammar checks and the roadmap's round lines, pure over text — the route
// behavior over fixtures lives in test/plan.test.ts's analysis describe.
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { analysisProblems, analysisText, ANALYSIS_SECTIONS, renderAnalysisStub, roadmapPhases, roadmapRounds } from "../src/analysis"
import { clarifiedMark, surveyForks } from "../src/phases"
import { BUILTIN_PHASE_TYPES } from "../src/phases/registry"

// A released, well-formed analysis: every section holds real content, one
// open-recorded fork (answered beside, per the release recipe), a brief
// proposal and a two-round roadmap.
const RELEASED = [
  "# Project analysis",
  "",
  "## Analysis",
  "",
  "A CLI tool of three modules; the retry ladder is the risk area.",
  "",
  "## Goals",
  "",
  "Ship the port with the protocol intact.",
  "",
  "Fork: database — sqlite (recommended: zero-ops) or postgres (recommended against: ops cost).",
  "Decision: sqlite, following the recommendation.",
  "",
  "## Project brief",
  "",
  "A faithful port of the core into the monorepo, tests included.",
  "",
  "## Roadmap",
  "",
  "- R-01 adm — port the core and its tests",
  "  Key work: retry ladder, protocol strings, the commit boundary.",
  "- R-02 mtv — acceptance pass and knowledge",
  "  Key work: the audit dimensions, the kb distillation.",
  "",
  "Clarified: yes",
  "",
].join("\n")

describe("the project analysis document (plans/0084)", () => {
  test("the stub carries every required section as comment-only hints", () => {
    const stub = renderAnalysisStub()
    for (const heading of ANALYSIS_SECTIONS) expect(stub).toContain(`\n${heading}\n`)
    // Comment-only sections hold no content: the stub is never releasable.
    expect(analysisProblems(stub, BUILTIN_PHASE_TYPES).length).toBe(ANALYSIS_SECTIONS.length + 1)
    // The hints teach the round line as machine grammar, and a hint line
    // itself never parses as a round (placeholders, not digits and ids).
    expect(stub).toContain("machine-parsed")
    expect(roadmapRounds(stub)).toEqual([])
  })

  test("a released document passes the grammar checks and parses into rounds", () => {
    expect(analysisProblems(RELEASED, BUILTIN_PHASE_TYPES)).toEqual([])
    expect(roadmapRounds(RELEASED)).toEqual([
      { round: 1, phases: "adm", goal: "port the core and its tests" },
      { round: 2, phases: "mtv", goal: "acceptance pass and knowledge" },
    ])
    expect(roadmapPhases(RELEASED, 1)).toBe("adm")
    expect(roadmapPhases(RELEASED, 2)).toBe("mtv")
    expect(roadmapPhases(RELEASED, 3)).toBeUndefined()
    // The release facts are the survey gate's own grammar (phases.ts).
    expect(surveyForks(RELEASED)).toBe(1)
    expect(clarifiedMark(RELEASED)).toBe(true)
  })

  test("the roadmap line grammar: the em dash and the ASCII -- both separate, prose is ignored", () => {
    const text = [
      "## Roadmap",
      "",
      "- R-01 adm — port the core",
      "- R-02 mt -- harden and test it",
      "- R-03 analysis, implement — spaced ids are the amend grammar and normalize",
      "The rounds above are the plan; this line is prose.",
      "",
    ].join("\n")
    expect(roadmapRounds(text)).toEqual([
      { round: 1, phases: "adm", goal: "port the core" },
      { round: 2, phases: "mt", goal: "harden and test it" },
      { round: 3, phases: "analysis,implement", goal: "spaced ids are the amend grammar and normalize" },
    ])
  })

  test("a decorated bullet reads like the format but never parses (the incident shape)", () => {
    // Bold markers or a parenthetical between the number and the dash look
    // right to a writer and still fail the machine parse — the shape the
    // guidance and the gate message both name so a session can fix by itself.
    const decorated = ["- **R-01 adm — port the retry ladder with tests**", "- **R-02 (import; gated) — hash utils**: adopt the closed crates."].join("\n")
    expect(roadmapRounds(decorated)).toEqual([])
    expect(roadmapPhases(decorated, 1)).toBeUndefined()
  })

  test("the plans-no-round problem names the document's own non-parsing bullets (the incident)", () => {
    // In a real environment the tool's message is the only standard within
    // reach — it must diagnose the document's lines, not just state the rule.
    const decorated = RELEASED.replace("- R-01 adm — port the core and its tests", "- **R-01 adm — port the core and its tests**").replace(
      "- R-02 mtv — acceptance pass and knowledge",
      "- **R-02 mtv — acceptance pass and knowledge**",
    )
    const problems = analysisProblems(decorated, BUILTIN_PHASE_TYPES)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(
      "do not parse: - **R-01 adm — port the core and its tests**; - **R-02 mtv — acceptance pass and knowledge**",
    )
  })

  test("a round-like bullet that does not parse is named even when other rounds parse", () => {
    // A passing roadmap with a decorated leftover is silently lossy: the
    // bullet's round looks planned but carries no phases advice.
    const mixed = RELEASED.replace("- R-02 mtv — acceptance pass and knowledge", "- **R-02 mtv — acceptance pass and knowledge**")
    expect(analysisProblems(mixed, BUILTIN_PHASE_TYPES)).toEqual([
      "rounds that look planned but do not parse (each planned round is one line `- R-NN <phases> — <goal>`, nothing else between the round id and the dash; a non-parsing bullet's round gets no phases advice): - **R-02 mtv — acceptance pass and knowledge**",
    ])
  })

  test("a roadmap line with an invalid phases value is a named problem, and a roadmapless document says so", () => {
    const bad = RELEASED.replace("- R-02 mtv — acceptance pass and knowledge", "- R-02 tz — acceptance pass")
    expect(analysisProblems(bad, BUILTIN_PHASE_TYPES)).toEqual([
      'the roadmap line `R-02 tz` is not a phases value (a letter preset over admtvk, or a comma-separated type-id list; known types: analysis, design, implement, test, acceptance, knowledge)',
    ])
    // A comma-separated type-id list is legal roadmap grammar too.
    const listed = RELEASED.replace("- R-01 adm — port the core and its tests", "- R-01 analysis,implement — port the core and its tests")
    expect(analysisProblems(listed, BUILTIN_PHASE_TYPES)).toEqual([])
    expect(roadmapPhases(listed, 1)).toBe("analysis,implement")
    // No round line at all: the roadmap problem names the grammar, the
    // phases vocabulary (the second problem's known-types list reachable
    // only after a line parses — here it is up front), and both examples.
    const none = RELEASED.split("\n").filter((line) => !/^- R-0|Key work:/.test(line)).join("\n")
    expect(analysisProblems(none, BUILTIN_PHASE_TYPES)).toEqual([
      "`## Roadmap` plans no round: one line per planned round, `- R-NN <phases> — <goal>` exactly — nothing else between the round id and the dash (bold markers or a parenthetical there breaks the parse; a round's detail goes under the line as prose); <phases> is the round's `amend --phases` value — a letter preset over admtvk containing m, or comma-separated type ids from the known types (analysis, design, implement, test, acceptance, knowledge), at least one of them implement — for example `- R-01 adm — port the retry ladder with tests` or `- R-01 analysis,implement — port the core and tests`",
    ])
  })

  test("a missing section is a named problem", () => {
    const missing = RELEASED.split("\n## Project brief\n\nA faithful port of the core into the monorepo, tests included.\n").join("\n")
    expect(analysisProblems(missing, BUILTIN_PHASE_TYPES)).toEqual([
      "docs/analysis.md is missing its `## Project brief` section",
    ])
  })

  test("analysisText: the released text as the survey's planning input; missing or comment-only stays undefined (plans/0085 A1)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "analysis-text-"))
    try {
      // No file: nothing to inject.
      expect(await analysisText(dir)).toBeUndefined()
      // The untouched stub injects nothing (comment-only, the brief's rule).
      mkdirSync(join(dir, "docs"), { recursive: true })
      await Bun.write(join(dir, "docs/analysis.md"), renderAnalysisStub())
      expect(await analysisText(dir)).toBeUndefined()
      // A released analysis injects its text, comments stripped.
      await Bun.write(join(dir, "docs/analysis.md"), RELEASED + "\n<!-- a trailing note -->\n")
      const text = await analysisText(dir)
      expect(text).toContain("Ship the port with the protocol intact.")
      expect(text).toContain("- R-01 adm — port the core and its tests")
      expect(text).not.toContain("<!--")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
