// Synthesis grammar and legacy formulation collect regressions.
import { describe, expect, test } from "bun:test"
import { rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { phaseType, phaseTypeOfLetter } from "../src/phases/registry"
import { establishRound } from "../src/phases"
import {
  LEDGER_FRAME_SOURCE,
  LEDGER_HEADING,
  coverageProblems,
  floorDigest,
  parseCoverage,
  ledgerOf,
  ledgerSection,
  parseLedger,
  parseSynthesisReply,
  protocolFrameText,
  quoteLocates,
  renderLedger,
  renderLedgerRow,
  seededLedgerRows,
  sessionRowProblems,
  type LedgerRow,
  type LedgerSource,
} from "../src/formulate-synthesis"
import { recordTodoDigest, todoDigest } from "../src/tasks"
import type { TurnScript } from "./fixtures/agent"
import { appendOneTask, artifactTurns, loopFixture, promptPhaseDir, type LoopFixture } from "./fixtures/loop"

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

// Exercise legacy collect with a previously landed ledger. The executor
// suite covers how new synthesis replies land.
const INPUT = "Reimplement the widget from the specification alone."

async function formulationFixture(turn: (dir: string) => TurnScript, withLedger = false): Promise<LoopFixture> {
  const f = await loopFixture("m", (dir) => ({ turn: turn(dir) }))
  await establishRound(f.dir, { phases: "m" })
  await Bun.write(join(f.dir, "docs/R-01/P01-implement/plan-input.md"), `${INPUT}\n`)
  await f.commit("round setup")
  if (withLedger) {
    expect((await f.run({ stopBefore: "formulate" })).code).toBe(0)
    const path = join(f.dir, "docs/T-001/todo.md")
    const floor = await Bun.file(path).text()
    const todo = floor.replace("## Acceptance", [
      LEDGER_HEADING,
      "",
      `- O-01 | docs/R-01/P01-implement/plan-input.md | "${INPUT}" | the plan covers a specification-only reimplementation`,
      "",
      "## Acceptance",
    ].join("\n"))
    await Bun.write(path, todo)
    await f.commit("land the synthesized todo fixture")
    await recordTodoDigest(f.dir, "T-001", todoDigest(todo))
  }
  return f
}

const createTitles = (f: LoopFixture): string[] =>
  f.agent.argsOf("create").map((args) => (args[0] as { title?: string } | undefined)?.title ?? "")

describe("formulation collect", () => {
  test("the formulation collect totality-checks the coverage map: a missing map blocks the unit, the wrap-up never runs (0097 D7)", async () => {
    // The planner writes the index but no coverage
    // map (a planning turn without the fixture's coverage branch): the
    // collect names the demand and blocks — a named problem, never a silent
    // pass.
    const planNoCoverage = (dir: string): TurnScript => (ctx) => {
      if (ctx.text.includes("What this task writes (the DRIVER's format protocol)")) {
        const phaseDir = promptPhaseDir(ctx.text)
        if (phaseDir) appendOneTask(dir, phaseDir)
        return undefined
      }
      return artifactTurns(dir)(ctx)
    }
    const f = await formulationFixture(planNoCoverage, true)
    try {
      const { code, lines } = await f.run({ stopBefore: "execute" })
      expect(code).toBe(2)
      expect(lines.some((line) => line.includes("the formulation output is invalid") && line.includes("the coverage map is missing or empty"))).toBe(true)
      // The wrap-up never dispatched: the collect blocked first.
      expect(createTitles(f).some((title) => title!.includes("wrapup"))).toBe(false)
    } finally {
      await rmSync(f.dir, { recursive: true, force: true })
    }
  })

  test("a formulation session that drops the unit's own index row blocks in the collect's own voice, never a crash (0141 D2)", async () => {
    // The planner rewrites the index without the formulation task's own row —
    // the shape that used to die at the post-session reload ("task T-00N not
    // found") before the collect could name it. The guarded reload turns it
    // into the collect's blocked shape, teaching the remedy.
    const dropOwnRow = (dir: string): TurnScript => (ctx) => {
      if (ctx.text.includes("What this task writes (the DRIVER's format protocol)")) {
        const phaseDir = promptPhaseDir(ctx.text)
        const own = /# (T-\d+): Formulate /.exec(ctx.text)?.[1]
        if (phaseDir && own) {
          appendOneTask(dir, phaseDir)
          const file = join(dir, phaseDir, "tasks.md")
          const kept = readFileSync(file, "utf8").split("\n").filter((line) => !line.startsWith(`- [ ] ${own} `))
          writeFileSync(file, `${kept.join("\n").replace(/\n+$/, "\n")}`)
        }
        return undefined
      }
      return artifactTurns(dir)(ctx)
    }
    const f = await formulationFixture(dropOwnRow)
    try {
      const { code, lines } = await f.run({ stopBefore: "execute" })
      expect(code).toBe(2)
      expect(lines.some((line) => line.includes("the formulation output is invalid") && line.includes("no longer lists the formulation task"))).toBe(true)
      // The wrap-up never dispatched: the guard blocked before it.
      expect(createTitles(f).some((title) => title!.includes("wrapup"))).toBe(false)
    } finally {
      await rmSync(f.dir, { recursive: true, force: true })
    }
  })

  // The landed todo, not the session's copy (plans/0171 D6, enacting
  // S08-04): a formulation session that deletes its own todo's obligations
  // ledger once passed the collect with no coverage map at all and the
  // wrap-up judged the reduced Scope. The commit boundary now restores the
  // edit (the detection line names it), the collect reads the landed ledger,
  // and the coverage totality holds — done.md carries the ledger.
  test("a session deleting its own todo's ledger is restored at the boundary; the collect judges the landed text", async () => {
    const stripLedger = (dir: string): TurnScript => (ctx) => {
      if (ctx.text.includes("What this task writes (the DRIVER's format protocol)")) {
        const done = artifactTurns(dir)(ctx)
        const own = /# (T-\d+): Formulate /.exec(ctx.text)?.[1]
        if (own) {
          const file = join(dir, "docs", own, "todo.md")
          const text = readFileSync(file, "utf8")
          const at = text.indexOf("## Obligations ledger")
          if (at >= 0) {
            const rest = text.slice(at)
            const end = rest.indexOf("\n## ", 1)
            writeFileSync(file, `${text.slice(0, at)}${end >= 0 ? rest.slice(end + 1) : ""}`)
          }
        }
        return done
      }
      return artifactTurns(dir)(ctx)
    }
    const f = await formulationFixture(stripLedger, true)
    try {
      const { code, lines } = await f.run({ stopBefore: "execute" })
      // The strip is detected and restored; the plan proceeds on the landed
      // text (the ledger present, the coverage map checked against it).
      expect(code).toBe(0)
      expect(lines.some((line) => line.includes("a session modified") && line.includes("DRIVER-owned; restored from HEAD"))).toBe(true)
      const done = await Bun.file(join(f.dir, "docs", "T-001", "done.md")).text()
      expect(done).toContain("## Obligations ledger")
    } finally {
      await rmSync(f.dir, { recursive: true, force: true })
    }
  })

  // The digest pin's own blocked voice (plans/0171 D6): an edit the boundary
  // cannot cover (a hand-committed change past the exec commit — the
  // interruption-commit shape) meets the collect's digest check and blocks
  // with the restore remedy.
  // The driver's markers are never a planned task's to carry (plans/0171 D6,
  // enacting S08-08): a session copying `Formulate:` onto a task it planned
  // once reclassified the task as machinery. The collect names it a problem.
  test("a planned task carrying the Formulate marker is a collect problem: the marker is the driver's", async () => {
    const forgeMarker = (dir: string): TurnScript => (ctx) => {
      if (ctx.text.includes("What this task writes (the DRIVER's format protocol)")) {
        const done = artifactTurns(dir)(ctx)
        const planned = nextPlanned(dir)
        if (planned) {
          const file = join(dir, "docs", planned, "todo.md")
          const text = readFileSync(file, "utf8")
          writeFileSync(file, text.replace(/^Phase: (.+)$/m, `Phase: $1\nFormulate: $1`))
        }
        return done
      }
      return artifactTurns(dir)(ctx)
    }
    // The task artifactTurns just planned: the highest-numbered todo.md the
    // planning turn created (never the formulation unit's own).
    const nextPlanned = (dir: string): string | undefined => {
      let best: { id: string; n: number } | undefined
      for (const name of readdirSync(join(dir, "docs"))) {
        const m = /^T-(\d+)$/.exec(name)
        if (!m || !existsSync(join(dir, "docs", name, "todo.md"))) continue
        if (!best || Number(m[1]) > best.n) best = { id: name, n: Number(m[1]) }
      }
      return best?.id
    }
    const f = await formulationFixture(forgeMarker)
    try {
      const { code, lines } = await f.run({ stopBefore: "execute" })
      expect(code).toBe(2)
      expect(lines.some((line) => line.includes("carries a `Formulate:` field") && line.includes("the driver's marker of the phase's formulation unit; remove the field line"))).toBe(true)
      expect(createTitles(f).some((title) => title!.includes("wrapup"))).toBe(false)
    } finally {
      await rmSync(f.dir, { recursive: true, force: true })
    }
  })

  // The dropped row is driver-restored and the re-run re-dispatches
  // (plans/0171 D7, enacting S08-06): before the restore, the blocked
  // collect left the row-less index committed and a plain re-run executed
  // the unjudged plan through a "clean phase end" — the formulation unit
  // invisible to every later load.
  test("the row-drop block restores the row and commits it; the re-run re-dispatches the formulation over the surviving files", async () => {
    const dropOwnRow = (dir: string): TurnScript => (ctx) => {
      if (ctx.text.includes("What this task writes (the DRIVER's format protocol)")) {
        const phaseDir = promptPhaseDir(ctx.text)
        const own = /# (T-\d+): Formulate /.exec(ctx.text)?.[1]
        if (phaseDir && own) {
          appendOneTask(dir, phaseDir)
          const file = join(dir, phaseDir, "tasks.md")
          const kept = readFileSync(file, "utf8").split("\n").filter((line) => !line.startsWith(`- [ ] ${own} `))
          writeFileSync(file, `${kept.join("\n").replace(/\n+$/, "\n")}`)
        }
        return undefined
      }
      return artifactTurns(dir)(ctx)
    }
    const f = await formulationFixture(dropOwnRow)
    try {
      const first = await f.run({ stopBefore: "execute" })
      expect(first.code).toBe(2)
      expect(first.lines.some((line) => line.includes("no longer lists the formulation task"))).toBe(true)
      // The driver restored the row at the head and committed the restore as
      // its own write — the index lists the unit again.
      expect(first.lines.some((line) => line.includes("the driver restored the row at the head"))).toBe(true)
      const index = await Bun.file(join(f.dir, "docs/R-01/P01-implement/tasks.md")).text()
      expect(index).toContain("- [ ] T-001 Formulate")
      expect((await f.git("log", "--format=%s", "--", "docs/R-01/P01-implement/tasks.md")).trim()).toContain("row restore")
      // The re-run sees the unit and re-dispatches the formulation over the
      // surviving files (the session drops the row again — the same blocked
      // voice, never a silent execution of the unjudged plan).
      const second = await f.run({ stopBefore: "execute" })
      expect(second.code).toBe(2)
      expect(second.lines.some((line) => line.includes("no longer lists the formulation task"))).toBe(true)
    } finally {
      await rmSync(f.dir, { recursive: true, force: true })
    }
  })

})
