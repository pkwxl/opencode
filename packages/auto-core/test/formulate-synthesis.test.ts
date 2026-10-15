// Formulation synthesis (plans/0097 D2–D6): the obligation ledger's grammar
// and mechanical validation (quote anchoring, source vocabulary, the seeded
// protocol rows), the constructor reply's strict parse, the floor digest,
// and the loop-level ladder — the synthesized todo landing beside its audit
// line, the fallback to the Stage-1 floor on an unparsable constructor, the
// switch's emergency exit, and the digest-keyed idempotence (a pending
// formulation whose floor assembly is unchanged keeps its landed todo, no
// constructor re-run).
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { ModelEntry, ModelRegistry, TierList } from "../src/models-schema"
import { phaseType, phaseTypeOfLetter } from "../src/phases/registry"
import { establishRound } from "../src/phases"
import {
  LEDGER_FRAME_SOURCE,
  LEDGER_HEADING,
  floorDigest,
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
import { clampSwitches } from "../src/switches"
import { services } from "../src/services"
import type { RoutingFacts } from "../src/routing"
import { ev, type TurnScript } from "./fixtures/agent"
import { SYNTHESIS_MARK, artifactTurns, loopFixture, synthesisTurn, type LoopFixture } from "./fixtures/loop"

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
    const body = ["## Goal", "", "G.", "", "## Scope", "", "Frame text.", "", LEDGER_HEADING, "", O, C, "", "## Acceptance", "", "A."].join("\n")
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

  test("the seeded protocol rows quote fragments of the frame's protocol line", () => {
    const entry = phaseType("acceptance")!
    const line = protocolFrameText(entry, true, "docs/R-01/report-for-user.md")
    const rows = seededLedgerRows(entry, true, "docs/R-01/report-for-user.md")
    // acceptance: the phase verdict document + the final-phase report duty.
    expect(rows.map((row) => row.quotes[0])).toEqual(["verdict.md", "verification.md", "Result: PASS", "Round user report"])
    for (const row of rows) {
      expect(quoteLocates(row.quotes[0]!, line)).toBe(true)
      expect(row.source).toBe(LEDGER_FRAME_SOURCE)
    }
    // A type with no artifacts, no verdict gate and no final phase seeds nothing.
    expect(seededLedgerRows(phaseTypeOfLetter("m"), false)).toEqual([])
    expect(protocolFrameText(phaseTypeOfLetter("m"), false)).toBe("")
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

// —— the loop-level ladder ——

// The registry the routing carries: a deep-tier entry the constructor's
// planning route picks, a free classifier entry the verifier would use.
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
  },
  agentFilter: "opencode",
  filterSource: undefined,
  defaultAgent: "opencode",
  runAgent: "opencode",
  router: services().router,
  clock: services().clock,
})

// The pack: a charter (the synthesis and the verifier activate) plus the
// result-line discipline (the wrap-up writes verdicts, so the loop fixture's
// wrap-up branch produces reports).
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
const INPUT = "Reimplement the widget from the specification alone."
const SYNTH_TITLE = "auto: formulation synthesis"
const FIDELITY_TITLE = "auto: formulation fidelity check"
const VERIFY_MARK = "You read one prompt that a planning step"
const FIDELITY_MARK = "You judge the fidelity of one synthesis"

// The fidelity check's scripted verdict (D5): pass by default; the fail-path
// test scripts its own.
const fidelityTurn = (verdict: string): TurnScript => (ctx) => {
  if (!ctx.text.includes(FIDELITY_MARK)) return undefined
  return [ev.text(ctx.session, `fid_${ctx.n}`, verdict), ev.idle(ctx.session)]
}

// The formulation unit's document text, whatever its state file is (a
// completed unit's todo.md was renamed to done.md).
const unitDoc = async (dir: string, id: string): Promise<string> => {
  for (const name of ["done.md", "todo.md"]) {
    const text = await Bun.file(join(dir, "docs", id, name)).text().catch(() => undefined)
    if (text !== undefined) return text
  }
  throw new Error(`no state file of ${id}`)
}

// Drop a unit's blocked mark from the runtime record, so the next run
// re-enters the planning step instead of resuming the blocked task directly.
const unblock = async (dir: string, id: string): Promise<void> => {
  const file = join(dir, ".auto", "units.json")
  const units = JSON.parse(await Bun.file(file).text()) as { tasks: Record<string, Record<string, unknown>> }
  if (units.tasks[id] !== undefined) delete units.tasks[id]!.status
  await Bun.write(file, `${JSON.stringify(units, null, 2)}\n`)
  await rmSync(join(dir, ".auto", "progress.json"), { force: true })
}

// The verifier's scripted reply: the composed document is judged consistent,
// so the ladder under test is the synthesis side alone.
const verifyYes: TurnScript = (ctx) => {
  if (!ctx.text.includes(VERIFY_MARK)) return undefined
  return [ev.text(ctx.session, `vrf_${ctx.n}`, "Consistent: yes"), ev.idle(ctx.session)]
}

// The titles of every create() call the fake agent saw.
const createTitles = (f: LoopFixture): string[] =>
  f.agent.argsOf("create").map((args) => (args[0] as { title?: string } | undefined)?.title ?? "")

// A fixture like the verifier suite's: m mode, a charter pack committed ahead
// of the round, the plan input persisted, routing with a planning-route entry.
async function synthesisFixture(turn: (dir: string) => TurnScript, fidelity = "Fidelity: pass"): Promise<LoopFixture> {
  const f = await loopFixture("m", (dir): { turn: TurnScript } => ({ turn: (ctx) => verifyYes(ctx) ?? fidelityTurn(fidelity)(ctx) ?? turn(dir)(ctx) }))
  await mkdirSync(join(f.dir, ".opencode", "auto", "intents"), { recursive: true })
  await writeFileSync(join(f.dir, ".opencode", "auto", "intents", "verify.md"), CHARTER_PACK)
  await establishRound(f.dir, { phases: "m" })
  await Bun.write(join(f.dir, "docs", "R-01", "P01-implement", "plan-input.md"), `${INPUT}\n`)
  await f.commit("round setup")
  return f
}

// The constructor's scripted reply quotes the plan file as it stands when
// the session runs (a changed input changes the quote).
const constructorTurn: TurnScript = (ctx) => {
  const input = /### (docs\/R-01\/P01-implement\/plan-input\.md)\n\n([^\n]+)/.exec(ctx.text)?.[2]?.trim()
  if (input === undefined) return undefined
  return synthesisTurn("The widget is reimplemented from the specification alone.", [
    `- O-02 | docs/R-01/P01-implement/plan-input.md | "${input}" | the plan's tasks cover the specification-only reimplementation`,
  ])(ctx)
}

let envSaved: [string, string | undefined][] = []
beforeEach(() => {
  envSaved = Object.entries(process.env).filter(([key]) => key.startsWith("OPENCODE_AUTO_"))
  for (const [key] of envSaved) delete process.env[key]
})
afterEach(() => {
  for (const [key, value] of envSaved) if (value !== undefined) process.env[key] = value
})

describe("the constructor session and the degradation ladder (0097 D3/D4/D6)", () => {
  test("a good constructor reply lands the synthesized todo and its audit line; the ledger rides the single input", async () => {
    const f = await synthesisFixture((dir) => (ctx) => constructorTurn(ctx) ?? artifactTurns(dir)(ctx)!)
    try {
      const { code, lines } = await f.run({ intent: "verify", routing: routing() })
      expect(code).toBe(0)
      // The composed chain: constructor → fidelity check → verifier →
      // formulation session; the todo on disk carries the frame + brief +
      // ledger, and the audit names the charters, the rationale and the
      // fidelity verdict.
      const todo = await unitDoc(f.dir, "T-001")
      expect(todo).toContain("## Sources brief (constructor session, under the charter)")
      expect(todo).toContain(LEDGER_HEADING)
      expect(todo).toContain(`- O-01 | ${LEDGER_FRAME_SOURCE} | "Round user report" |`)
      expect(todo).toContain(`- O-02 | docs/R-01/P01-implement/plan-input.md | "${INPUT}" |`)
      const audit = await Bun.file(join(f.dir, "docs", "R-01", "prompt-audit.md")).text()
      expect(audit).toMatch(/formulation R-01\.P01 synthesis: charters \[verify-plan\] on a — the sources demand a specification-only reimplementation — source health: \.opencode\/auto\/brief\.md absent/)
      expect(audit).toMatch(/formulation R-01\.P01 fidelity: pass/)
      expect(lines.some((line) => line.includes("✓ formulation synthesis: the constructor a re-voiced"))).toBe(true)
      // The synthesized document is committed: the phase-formulate commit
      // carries it (the audit's prompt-audit commit ahead of it).
      const log = await f.git("log", "--format=%s", "--", "docs/T-001/todo.md")
      expect(log).toContain("PLAN formulate P01-implement Implementation")
    } finally {
      await rmSync(f.dir, { recursive: true, force: true })
    }
  })

  test("an unparsable constructor falls back to the floor after its one retry: FALLBACK audit line, no ledger in the todo, the run completes", async () => {
    const f = await synthesisFixture((dir) => (ctx) => artifactTurns(dir)(ctx)!)
    try {
      const { code, lines } = await f.run({ intent: "verify", routing: routing() })
      expect(code).toBe(0)
      // Two constructor attempts (the default turn's reply never parses),
      // then the floor.
      const titles = createTitles(f)
      expect(titles.filter((title) => title === SYNTH_TITLE)).toHaveLength(2)
      expect(lines.some((line) => line.includes("formulation synthesis fell back to the Stage-1 deterministic floor"))).toBe(true)
      const todo = await unitDoc(f.dir, "T-001")
      expect(todo).not.toContain(LEDGER_HEADING)
      expect(todo).toContain("## Input: plan file (docs/R-01/P01-implement/plan-input.md)")
      const audit = await Bun.file(join(f.dir, "docs", "R-01", "prompt-audit.md")).text()
      expect(audit).toMatch(/formulation R-01\.P01 synthesis: FALLBACK — [^]*\(after one retry/)
    } finally {
      await rmSync(f.dir, { recursive: true, force: true })
    }
  })

  test("a fidelity fail retries the constructor once with the evidence, then the ladder: FAIL audit line, the floor", async () => {
    // The constructor's replies are mechanically valid, the fidelity check
    // keeps failing on the same dropped demand: one constructor retry under
    // the evidence, then the floor with the fidelity FAIL recorded ahead of
    // the FALLBACK line.
    const f = await synthesisFixture((dir) => (ctx) => constructorTurn(ctx) ?? artifactTurns(dir)(ctx)!, "Fidelity: fail — the fixture-format constraint the round brief names is dropped")
    try {
      const { code, lines } = await f.run({ intent: "verify", routing: routing() })
      expect(code).toBe(0)
      // The constructor ran its two attempts (the fidelity evidence feeding
      // the second), the fidelity check judged both, then the floor.
      expect(createTitles(f).filter((title) => title === SYNTH_TITLE)).toHaveLength(2)
      expect(createTitles(f).filter((title) => title === FIDELITY_TITLE)).toHaveLength(2)
      expect(lines.some((line) => line.includes("formulation synthesis fell back to the Stage-1 deterministic floor: the fidelity check failed"))).toBe(true)
      const audit = await Bun.file(join(f.dir, "docs", "R-01", "prompt-audit.md")).text()
      expect(audit).toMatch(/formulation R-01\.P01 fidelity: FAIL — the fixture-format constraint the round brief names is dropped/)
      expect(audit.indexOf("fidelity: FAIL")).toBeLessThan(audit.indexOf("synthesis: FALLBACK"))
      expect(await unitDoc(f.dir, "T-001")).not.toContain(LEDGER_HEADING)
    } finally {
      await rmSync(f.dir, { recursive: true, force: true })
    }
  })

  test("OPENCODE_AUTO_SYNTHESIS=off forces the floor: no constructor session, no audit entry, the charter still rides the Acceptance", async () => {
    clampSwitches({ synthesis: false })
    const f = await synthesisFixture((dir) => (ctx) => artifactTurns(dir)(ctx)!)
    try {
      const { code, lines } = await f.run({ intent: "verify", routing: routing() })
      expect(code).toBe(0)
      expect(createTitles(f)).not.toContain(SYNTH_TITLE)
      expect(lines.some((line) => line.includes("formulation synthesis off: OPENCODE_AUTO_SYNTHESIS=off"))).toBe(true)
      const todo = await unitDoc(f.dir, "T-001")
      expect(todo).not.toContain(LEDGER_HEADING)
      expect(todo).toContain("The project's intent charter binds this plan in addition")
      expect(await Bun.file(join(f.dir, "docs", "R-01", "prompt-audit.md")).text()).not.toContain("synthesis:")
    } finally {
      clampSwitches({ synthesis: true })
      await rmSync(f.dir, { recursive: true, force: true })
    }
  })

  test("no routing degrades loudly: the FALLBACK audit line names it, the floor carries the charter", async () => {
    const f = await synthesisFixture((dir) => (ctx) => artifactTurns(dir)(ctx)!)
    try {
      const { code } = await f.run({ intent: "verify" })
      expect(code).toBe(0)
      expect(createTitles(f)).not.toContain(SYNTH_TITLE)
      const audit = await Bun.file(join(f.dir, "docs", "R-01", "prompt-audit.md")).text()
      expect(audit).toMatch(/synthesis: FALLBACK — no model registry routing/)
      expect(await unitDoc(f.dir, "T-001")).not.toContain(LEDGER_HEADING)
    } finally {
      await rmSync(f.dir, { recursive: true, force: true })
    }
  })

  test("digest idempotence: a pending formulation whose floor is unchanged keeps its landed todo — no constructor re-run, byte-identical", async () => {
    // First run: the constructor succeeds, the formulation session writes
    // nothing (the default turn) — the collect blocks, the task stays
    // pending, the todo and its digest stay on disk.
    // The formulation session (the whole-task session over the todo) writes
    // nothing: the default turn's reply produces no index, the collect
    // blocks, the task stays pending with its landed todo and digest.
    const f = await synthesisFixture(() => constructorTurn)
    try {
      const first = await f.run({ intent: "verify", routing: routing(), stopBefore: "execute" })
      expect(first.code).toBe(2)
      // The unit stays pending: its todo (synthesized) and digest are on
      // disk, no done.md.
      const todo = await unitDoc(f.dir, "T-001")
      expect(todo).toContain(LEDGER_HEADING)
      expect(existsSync(join(f.dir, "docs", "T-001", "done.md"))).toBe(false)

      // Second run over the same tree (the blocked mark cleared, the way a
      // person re-running plan enters): the floor assembly is unchanged, so
      // the landed synthesized todo stands — no constructor session, no
      // rewrite — the verifier and the formulation session run again.
      await unblock(f.dir, "T-001")
      const constructorsBefore = createTitles(f).filter((title) => title === SYNTH_TITLE).length
      const second = await f.run({ intent: "verify", routing: routing(), stopBefore: "execute" })
      expect(second.code).toBe(2)
      expect(createTitles(f).filter((title) => title === SYNTH_TITLE)).toHaveLength(constructorsBefore)
      expect(second.lines.some((line) => line.includes("the landed formulation todo of T-001 stands"))).toBe(true)
      expect(await unitDoc(f.dir, "T-001")).toBe(todo)
    } finally {
      await rmSync(f.dir, { recursive: true, force: true })
    }
  })

  test("a changed floor re-runs the pipeline: a changed planning input re-synthesizes", async () => {
    const f = await synthesisFixture(() => constructorTurn)
    try {
      const first = await f.run({ intent: "verify", routing: routing(), stopBefore: "execute" })
      expect(first.code).toBe(2)
      const constructorsBefore = createTitles(f).filter((title) => title === SYNTH_TITLE).length
      expect(constructorsBefore).toBeGreaterThan(0)
      // The input changes: the floor digest changes, the full pipeline runs
      // again over the pending unit (construction's rewrite-on-diff lands
      // the new todo).
      await Bun.write(join(f.dir, "docs", "R-01", "P01-implement", "plan-input.md"), "Reimplement the widget and its fixtures from the specification alone.\n")
      await f.commit("input changed")
      await unblock(f.dir, "T-001")
      const second = await f.run({ intent: "verify", routing: routing(), stopBefore: "execute" })
      expect(second.code).toBe(2)
      expect(createTitles(f).filter((title) => title === SYNTH_TITLE)).toHaveLength(constructorsBefore + 1)
      expect(second.lines.some((line) => line.includes("the landed formulation todo of T-001 stands"))).toBe(false)
    } finally {
      await rmSync(f.dir, { recursive: true, force: true })
    }
  })
})
