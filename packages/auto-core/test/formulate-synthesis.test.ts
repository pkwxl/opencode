// Synthesis grammar regressions (the push collect's half retired with the
// task loop, plans/0314 — the executor's settlement pins live in
// executor-formulate.test.ts).
import { describe, expect, test } from "bun:test"
import { phaseType, phaseTypeOfLetter } from "../src/phases/registry"
import { LEDGER_FRAME_SOURCE, LEDGER_HEADING, coverageProblems, floorDigest, parseCoverage, ledgerOf, ledgerSection, parseLedger, parseSynthesisReply, protocolFrameText, quoteLocates, renderLedger, renderLedgerRow, seededLedgerRows, sessionRowProblems, type LedgerRow, type LedgerSource } from "../src/formulate-synthesis"

// —— the pure half ——

describe("the obligation ledger grammar (0097 D2)", () => {
  const O = `- O-01 | round.md | "error semantics preserved for the parser" | the plan's tests exercise parser error paths and record observed evidence`
  const C = `- C-01 | plan-input.md vs analysis.md | "input asks a rewrite" / "analysis settles it as stable" | analysis wins (authority order); the plan records the deviation, never silent`

  test("O and C rows parse into their fields; blank lines and comments pass through", () => {
    const { rows, problems } = parseLedger([O, "", "# a comment", C].join("\n"))
    expect(problems).toEqual([])
    expect(rows).toEqual([
      { kind: "O", n: 1, source: "round.md", quotes: ["error semantics preserved for the parser"], text: "the plan's tests exercise parser error paths and record observed evidence" },
      { kind: "C", n: 1, source: "plan-input.md vs analysis.md", quotes: ["input asks a rewrite", "analysis settles it as stable"], text: "analysis wins (authority order); the plan records the deviation, never silent" },
    ])
  })

  test("malformed rows, duplicates and sequence breaks are named problems", () => {
    const bad = ["- O-01 | round.md | no quotes here | text", "- O-02 | round.md | \"q\" | t", "- O-02 | round.md | \"q\" | t", "- O-04 | round.md | \"q\" | t"].join("\n")
    const { problems } = parseLedger(bad)
    expect(problems.some((problem) => problem.includes("does not parse"))).toBe(true)
    expect(problems.some((problem) => problem.includes("duplicate row id O-02"))).toBe(true)
    expect(problems.some((problem) => problem.includes("O-04 sits where O-03 belongs"))).toBe(true)
  })

  test("`from` pins the first id of each kind (the landed ledger opens at 01; a session's rows continue past the seeds)", () => {
    expect(parseLedger(`- O-03 | round.md | "q" | t`, { O: 3, C: 1 }).problems).toEqual([])
    expect(parseLedger(`- O-03 | round.md | "q" | t`).problems).toEqual([])
    expect(parseLedger(`- O-03 | round.md | "q" | t`, { O: 1, C: 1 }).problems.some((p) => p.includes("O-03 sits where O-01 belongs"))).toBe(true)
  })

  test("renderLedger round-trips through parseLedger", () => {
    const rows: LedgerRow[] = [
      { kind: "O", n: 1, source: "phase duties", quotes: ["test-report.md"], text: "the phase's test report is delivered" },
      { kind: "C", n: 1, source: "a.md vs b.md", quotes: ["qa", "qb"], text: "b wins; record the deviation" },
    ]
    expect(parseLedger(renderLedger(rows))).toEqual({ rows, problems: [] })
    expect(renderLedgerRow(rows[0]!)).toBe('- O-01 | phase duties | "test-report.md" | the phase\'s test report is delivered')
  })

  test("ledgerSection/ledgerOf read the section back out of a todo body (absent on the floor)", () => {
    const body = ["## Goal", "", "G.", "", "## Scope", "", "Frame text.", "", LEDGER_HEADING, "", "The driver introduces these rows.", O, C, "The driver states the boundaries here.", "", "## Acceptance", "", "A."].join("\n")
    const section = ledgerSection(body)
    expect(section).toContain('- O-01 | round.md | "error semantics preserved for the parser"')
    expect(section).not.toContain("## Acceptance")
    expect(ledgerOf(body)!.problems).toEqual([])
    expect(ledgerSection("## Scope\n\nNo ledger here.")).toBeUndefined()
  })
})

describe("the mechanical validation (0097 D4)", () => {
  const sources: LedgerSource[] = [
    { name: "round.md", text: "The round must keep error semantics preserved for the parser\nand the fixture format stable." },
    { name: "plan-input.md", text: "Rewrite the config layer wholesale this round." },
  ]

  test("quoteLocates: exact first, whitespace-normalized second, paraphrase never", () => {
    expect(quoteLocates("error semantics preserved for the parser", sources[0]!.text)).toBe(true)
    expect(quoteLocates("error semantics preserved for the parser and the fixture", sources[0]!.text)).toBe(true)
    expect(quoteLocates("error semantics are kept for the parser", sources[0]!.text)).toBe(false)
  })

  test("sessionRowProblems: unknown sources, frame-source rows and unlocating quotes are named", () => {
    const rows: LedgerRow[] = [
      { kind: "O", n: 3, source: "round.md", quotes: ["error semantics preserved for the parser"], text: "t" },
      { kind: "O", n: 4, source: "unknown.md", quotes: ["q"], text: "t" },
      { kind: "O", n: 5, source: LEDGER_FRAME_SOURCE, quotes: ["test-report.md"], text: "t" },
      { kind: "O", n: 6, source: "round.md", quotes: ["a demand the round never makes"], text: "t" },
      { kind: "C", n: 1, source: "round.md vs plan-input.md", quotes: ["error semantics preserved for the parser", "Rewrite the config layer wholesale this round."], text: "r" },
      { kind: "C", n: 2, source: "round.md", quotes: ["q", "q"], text: "r" },
    ]
    const problems = sessionRowProblems(rows, sources)
    expect(problems.some((p) => p.includes('names the source "unknown.md"'))).toBe(true)
    expect(problems.some((p) => p.includes("protocol rows are the DRIVER's own"))).toBe(true)
    expect(problems.some((p) => p.includes("does not locate in round.md"))).toBe(true)
    expect(problems.some((p) => p.includes('must be "<source A> vs <source B>"'))).toBe(true)
    expect(problems.filter((p) => p.includes("O-03") || p.includes("C-01"))).toEqual([])
  })

  test("the seeded protocol rows quote fragments of the frame's protocol line (the report duty retired, plans/0109 D2)", () => {
    const entry = phaseType("acceptance")!
    const line = protocolFrameText(entry)
    const rows = seededLedgerRows(entry)
    // acceptance: the phase verdict document + the verification task artifact.
    expect(rows.map((row) => row.quotes[0])).toEqual(["verdict.md", "verification.md", "Result: PASS"])
    for (const row of rows) {
      expect(quoteLocates(row.quotes[0]!, line)).toBe(true)
      expect(row.source).toBe(LEDGER_FRAME_SOURCE)
    }
    // A type with no artifacts and no verdict gate seeds nothing.
    expect(seededLedgerRows(phaseTypeOfLetter("m"))).toEqual([])
    expect(protocolFrameText(phaseTypeOfLetter("m"))).toBe("")
  })
})

describe("the coverage map and its totality check (0097 D7)", () => {
  const ledger = parseLedger(['- O-01 | round.md | "error semantics preserved" | t', '- C-01 | a.md vs b.md | "q" / "q" | r'].join("\n"), { O: 1, C: 1 })

  test("parseCoverage: the three row forms, with notes; malformed lines named", () => {
    const text = ["# Coverage (T-001)", "", "- O-01 -> T-012 (the parser error-path suite)", "- O-02 -> deferred(blocked on the fixture infra gap, reason in T-018)", "- C-01 -> conflict-recorded(T-018 records the deviation)", "junk line"].join("\n")
    const { rows, problems } = parseCoverage(text)
    expect(rows).toEqual([
      { row: "O-01", target: "T-012", note: "the parser error-path suite" },
      { row: "O-02", target: "deferred", note: "blocked on the fixture infra gap, reason in T-018" },
      { row: "C-01", target: "conflict-recorded", note: "T-018 records the deviation" },
    ])
    expect(problems.some((problem) => problem.includes("does not parse"))).toBe(true)
  })

  test("coverageProblems: totality — every row exactly once, mapped ids listed, deferrals reasoned", () => {
    // The happy path: both rows mapped, the id listed.
    expect(coverageProblems(ledger, "- O-01 -> T-002 (covers it)\n- C-01 -> conflict-recorded (recorded)", ["T-001", "T-002"])).toEqual([])
    // Missing map, duplicate mapping, unknown target, bare deferral.
    expect(coverageProblems(ledger, "", ["T-001"]).some((p) => p.includes("the coverage map is missing or empty"))).toBe(true)
    const problems = coverageProblems(ledger, "- O-01 -> T-009 (x)\n- O-01 -> T-009 (x)\n- C-01 -> deferred()", ["T-001"])
    expect(problems.some((p) => p.includes("row O-01 is mapped 2 times"))).toBe(true)
    expect(problems.some((p) => p.includes("maps O-01 to T-009, which the task index does not list"))).toBe(true)
    expect(problems.some((p) => p.includes("the deferral of C-01 carries no reason"))).toBe(true)
    // An unmapped row is named by its id.
    expect(coverageProblems(ledger, "- O-01 -> T-002 (x)", ["T-001", "T-002"]).some((p) => p.includes("ledger row C-01 is not mapped"))).toBe(true)
    // A row id the ledger does not carry is named.
    expect(coverageProblems(ledger, "- O-01 -> T-002 (x)\n- C-01 -> conflict-recorded (x)\n- C-09 -> T-002 (x)", ["T-001", "T-002"]).some((p) => p.includes("maps C-09, which the ledger does not carry"))).toBe(true)
  })
})

describe("the constructor reply's strict parse (0097 D3)", () => {
  const good = ["prelude noise", "<<<SOURCES-BRIEF", "The brief.", "SOURCES-BRIEF>>>", "<<<LEDGER", '- O-03 | round.md | "q" | t', "LEDGER>>>", "Rationale: one line", "trailing noise"].join("\n")

  test("the delimited blocks and the last Rationale line parse", () => {
    const parsed = parseSynthesisReply(good)
    if (!("parsed" in parsed)) throw new Error("unreachable")
    expect(parsed.parsed.brief).toBe("The brief.")
    expect(parsed.parsed.ledgerBody).toBe('- O-03 | round.md | "q" | t')
    expect(parsed.parsed.rationale).toBe("one line")
  })

  test("missing blocks or the closing line are named problems", () => {
    for (const [text, marker] of [
      ["<<<LEDGER\nrows\nLEDGER>>>\nRationale: r", "SOURCES-BRIEF"],
      ["<<<SOURCES-BRIEF\nb\nSOURCES-BRIEF>>>", "Rationale"],
    ] as const) {
      const parsed = parseSynthesisReply(text)
      if (!("problems" in parsed)) throw new Error("expected problems")
      expect(parsed.problems.some((problem) => problem.includes(marker))).toBe(true)
    }
  })
})

describe("the floor digest (0097 D6)", () => {
  test("stable for the same document, different on any change", () => {
    const one = floorDigest("the floor document")
    expect(floorDigest("the floor document")).toBe(one)
    expect(floorDigest("the floor document changed")).not.toBe(one)
    expect(one).toMatch(/^[0-9a-f]{16}$/)
  })
})

