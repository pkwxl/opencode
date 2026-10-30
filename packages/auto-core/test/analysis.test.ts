// The pre-round project analysis document (plans/0084): the stub, the
// grammar checks and the roadmap's round lines, pure over text — the route
// behavior over fixtures lives in test/plan.test.ts's analysis describe.
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  analysisProblems,
  analysisText,
  ANALYSIS_SECTIONS,
  renderAnalysisStub,
  releasedRoundBriefProposal,
  resolveRoundPhases,
  roundBriefNearMisses,
  roundBriefNearMissNote,
  roundBriefProposals,
} from "../src/analysis"
import { clarifiedMark, surveyForks } from "../src/phases"
import { BUILTIN_PHASE_TYPES } from "../src/phases/registry"
import { releasedRoadmapRound, roadmapPhases, roadmapRounds } from "../src/roadmap"

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

  test("a CRLF roadmap parses and the release scan stays quiet — one grammar, one view (plans/0158 D1)", () => {
    // A Windows-line-ended document: splitting on \n leaves a \r at each
    // line's end that `.` never matches — the pre-0158 reader found no
    // rounds while the near-miss scan flagged every well-formed line. Both
    // readers now share the CRLF-normalized view: the rounds parse and the
    // release holds nothing.
    const crlf = RELEASED.replaceAll("\n", "\r\n")
    expect(roadmapRounds(crlf)).toEqual([
      { round: 1, phases: "adm", goal: "port the core and its tests" },
      { round: 2, phases: "mtv", goal: "acceptance pass and knowledge" },
    ])
    expect(analysisProblems(crlf, BUILTIN_PHASE_TYPES)).toEqual([])
    expect(clarifiedMark(crlf)).toBe(true)
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
      "`## Roadmap` plans no round: one line per planned round, `- R-NN <phases> — <goal>` exactly — nothing else between the round id and the dash (bold markers or a parenthetical there breaks the parse; a round's detail goes under the line as prose); <phases> is the round's phases value — a letter preset over admtvk containing m, or comma-separated type ids from the known types (analysis, design, implement, test, acceptance, knowledge), at least one of them implement — for example `- R-01 adm — port the retry ladder with tests` or `- R-01 analysis,implement — port the core and tests`",
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

  test("resolveRoundPhases: the released line wins, the fallback carries no roadmap, unreleased never rules, m mode never consults (plans/0101 D5)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "analysis-resolve-"))
    try {
      mkdirSync(join(dir, "docs"), { recursive: true })
      // No document: config's value, no roadmap riding along.
      expect(await resolveRoundPhases(dir, 1, "am")).toEqual({ phases: "am" })
      // A filled but unreleased roadmap is not the person's decision yet.
      await Bun.write(join(dir, "docs/analysis.md"), RELEASED.replace("\nClarified: yes", ""))
      expect(await resolveRoundPhases(dir, 1, "am")).toEqual({ phases: "am" })
      expect(await releasedRoadmapRound(dir, 1)).toBeUndefined()
      // Released: the line for the round wins over the fallback, and rides
      // along for the sourced stop line; a round beyond the lines falls back.
      await Bun.write(join(dir, "docs/analysis.md"), RELEASED)
      expect(await resolveRoundPhases(dir, 1, "am")).toEqual({
        phases: "adm",
        roadmap: { round: 1, phases: "adm", goal: "port the core and its tests" },
      })
      expect(await resolveRoundPhases(dir, 3, "am")).toEqual({ phases: "am" })
      expect((await releasedRoadmapRound(dir, 2))?.phases).toBe("mtv")
      // m mode has no phased roadmap: whatever the document plans, the
      // fallback stands (the guard lives in the resolution itself).
      await Bun.write(join(dir, "docs/analysis.md"), RELEASED.replace("- R-01 adm —", "- R-01 amt —"))
      expect(await resolveRoundPhases(dir, 1, "m")).toEqual({ phases: "m" })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("the round-brief proposals (plans/0115)", () => {
  const WITH_BRIEFS = [
    RELEASED.replace("\nClarified: yes", ""),
    "## Round briefs",
    "",
    "### R-01",
    "",
    "Port the retry ladder and the protocol strings with their tests.",
    "",
    "- Acceptance: the e2e suite passes on the ported core.",
    "",
    "### R-02",
    "",
    "The acceptance pass and the knowledge distillation.",
    "",
  ].join("\n")

  test("the section is optional and its subsections parse with bodies to the next heading; comments strip", () => {
    // No section: the floor — nothing parsed, no problems from it.
    expect(roundBriefProposals(RELEASED).size).toBe(0)
    expect(roundBriefNearMisses(RELEASED)).toEqual([])
    expect(analysisProblems(RELEASED, BUILTIN_PHASE_TYPES)).toEqual([])
    // With it: each subsection's body runs to the next `###`/`##` heading.
    const briefs = roundBriefProposals(WITH_BRIEFS)
    expect(briefs.get(1)).toBe("Port the retry ladder and the protocol strings with their tests.\n\n- Acceptance: the e2e suite passes on the ported core.")
    expect(briefs.get(2)).toBe("The acceptance pass and the knowledge distillation.")
    // Unpadded ids parse, the roadmap's rule; a commented-out subsection is
    // not content.
    const unpadded = WITH_BRIEFS.replace("### R-02", "### R-2").replace("### R-01", "<!-- ### R-09 -->\n### R-1")
    const parsed = roundBriefProposals(unpadded)
    expect(parsed.get(1)).toContain("retry ladder")
    expect(parsed.get(2)).toContain("acceptance pass")
    expect(parsed.has(9)).toBe(false)
  })

  test("an empty subsection and a near-miss heading are named problems — only when the section is present", () => {
    const empty = WITH_BRIEFS.replace("The acceptance pass and the knowledge distillation.\n", "")
    expect(analysisProblems(empty, BUILTIN_PHASE_TYPES)).toEqual([
      "round-brief proposals that hold no content: `### R-02` — fill each with that round's brief (goal, acceptance and release criteria) or remove it; an empty proposal installs nothing",
    ])
    // Near-misses: a level-4 heading or a suffix on the line reads as drafted
    // and never matches its round.
    const near = WITH_BRIEFS.replace("### R-02", "#### R-02").replace("### R-01", "### R-01 — the port round")
    expect(roundBriefNearMisses(near)).toEqual(["### R-01 — the port round", "#### R-02"])
    const problems = analysisProblems(near, BUILTIN_PHASE_TYPES)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain("round-brief proposal headings that do not parse")
    expect(problems[0]).toContain("`### R-01 — the port round`; `#### R-02`")
    // The stub's hint section is comments only: no subsections, no problems.
    expect(roundBriefProposals(renderAnalysisStub()).size).toBe(0)
    expect(analysisProblems(renderAnalysisStub(), BUILTIN_PHASE_TYPES).some((problem) => problem.includes("round-brief"))).toBe(false)
  })

  test("the stub teaches the channel; a well-formed section passes the grammar checks", () => {
    const stub = renderAnalysisStub()
    expect(stub).toContain("## Round briefs")
    expect(stub).toContain("installs the round's proposal verbatim when the round opens")
    expect(analysisProblems(WITH_BRIEFS.replace("\nClarified: yes", "") + "\nClarified: yes\n", BUILTIN_PHASE_TYPES)).toEqual([])
  })

  test("releasedRoundBriefProposal: released only, empty never installs, the floor is undefined", async () => {
    const dir = mkdtempSync(join(tmpdir(), "analysis-briefs-"))
    try {
      mkdirSync(join(dir, "docs"), { recursive: true })
      // No document, or unreleased: never the person's decision yet.
      expect(await releasedRoundBriefProposal(dir, 1)).toBeUndefined()
      await Bun.write(join(dir, "docs/analysis.md"), WITH_BRIEFS)
      expect(await releasedRoundBriefProposal(dir, 1)).toBeUndefined()
      // Released: the round's proposal body; an empty subsection and a
      // round without one stay undefined.
      await Bun.write(join(dir, "docs/analysis.md"), WITH_BRIEFS + "\nClarified: yes\n")
      expect(await releasedRoundBriefProposal(dir, 1)).toContain("retry ladder")
      expect(await releasedRoundBriefProposal(dir, 2)).toContain("acceptance pass")
      expect(await releasedRoundBriefProposal(dir, 3)).toBeUndefined()
      const empty = WITH_BRIEFS.replace("The acceptance pass and the knowledge distillation.\n", "") + "\nClarified: yes\n"
      await Bun.write(join(dir, "docs/analysis.md"), empty)
      expect(await releasedRoundBriefProposal(dir, 2)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // Plans/0158 D3: the living-governance shape — a valid subsection released
  // long ago, a near-miss heading drafted into the released document later.
  // The release-time near-miss scan never re-runs, so the extractor alone
  // holds the line: the near-miss heading terminates the subsection it
  // follows, its body never riding verbatim into that round's installed
  // brief.
  test("a near-miss heading after a released subsection terminates it — its body never rides into the earlier round's brief (plans/0158 D3)", async () => {
    const doc = `${WITH_BRIEFS}#### R-03 notes\n\nDrafted later; reads as a brief for R-03.\n`
    const briefs = roundBriefProposals(doc)
    expect(briefs.get(2)).toBe("The acceptance pass and the knowledge distillation.")
    expect(briefs.has(3)).toBe(false)
    expect(roundBriefNearMisses(doc)).toEqual(["#### R-03 notes"])
    // The release-time scan still names it where it runs (the project start).
    expect(analysisProblems(doc, BUILTIN_PHASE_TYPES).some((problem) => problem.includes("#### R-03 notes"))).toBe(true)
    // The install path composes: released, R-02's proposal carries no trace
    // of the near-miss body, R-03 installs nothing.
    const dir = mkdtempSync(join(tmpdir(), "analysis-nearmiss-"))
    try {
      mkdirSync(join(dir, "docs"), { recursive: true })
      await Bun.write(join(dir, "docs/analysis.md"), `${doc}\nClarified: yes\n`)
      const r02 = await releasedRoundBriefProposal(dir, 2)
      expect(r02).toContain("acceptance pass")
      expect(r02).not.toContain("Drafted later")
      expect(await releasedRoundBriefProposal(dir, 3)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("roundBriefNearMissNote names a released near-miss heading at the round it would have opened (plans/0158 D3)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "analysis-note-"))
    try {
      mkdirSync(join(dir, "docs"), { recursive: true })
      const doc = `${WITH_BRIEFS}#### R-03 notes\n\nDrafted later.\n`
      // Unreleased: never the person's decision yet, no note.
      await Bun.write(join(dir, "docs/analysis.md"), doc)
      expect(await roundBriefNearMissNote(dir, 3)).toBeUndefined()
      await Bun.write(join(dir, "docs/analysis.md"), `${doc}\nClarified: yes\n`)
      const note = await roundBriefNearMissNote(dir, 3)
      expect(note).toContain("#### R-03 notes")
      expect(note).toContain("R-03")
      expect(note).toContain("`### R-NN`")
      // A round the near-miss headings do not name stays quiet (their own
      // opens would name them), and no document at all is the floor.
      expect(await roundBriefNearMissNote(dir, 1)).toBeUndefined()
      rmSync(join(dir, "docs/analysis.md"))
      expect(await roundBriefNearMissNote(dir, 3)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
