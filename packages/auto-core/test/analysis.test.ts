// The pre-round project analysis document (plans/0084): the stub, the
// grammar checks and the roadmap's round lines, pure over text — the route
// behavior over fixtures lives in test/plan.test.ts's analysis describe.
import { describe, expect, test } from "bun:test"
import { analysisProblems, ANALYSIS_SECTIONS, renderAnalysisStub, roadmapPhases, roadmapRounds } from "../src/analysis"
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
      "The rounds above are the plan; this line is prose.",
      "",
    ].join("\n")
    expect(roadmapRounds(text)).toEqual([
      { round: 1, phases: "adm", goal: "port the core" },
      { round: 2, phases: "mt", goal: "harden and test it" },
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
    // No round line at all: the roadmap problem names the grammar.
    const none = RELEASED.split("\n").filter((line) => !/^- R-0|Key work:/.test(line)).join("\n")
    expect(analysisProblems(none, BUILTIN_PHASE_TYPES)).toEqual([
      "`## Roadmap` plans no round: one line per planned round, `- R-NN <phases> — <goal>` (for example `- R-01 adm — port the retry ladder with tests`)",
    ])
  })

  test("a missing section is a named problem", () => {
    const missing = RELEASED.split("\n## Project brief\n\nA faithful port of the core into the monorepo, tests included.\n").join("\n")
    expect(analysisProblems(missing, BUILTIN_PHASE_TYPES)).toEqual([
      "docs/analysis.md is missing its `## Project brief` section",
    ])
  })
})
