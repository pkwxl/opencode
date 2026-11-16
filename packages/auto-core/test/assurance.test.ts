// The assurance family (plans/0244): S1's round-delta measurement and its
// block — the anchor derivation (the establishment commit, the prior-round
// fallback), the grouped stat, the nested-repository boundary, and the P10
// floors (nothing measured, a quiet round). S3 lands the assurance table
// (D2 — the grammar round-trip and its named load failures), the due set
// (D4 — Δ ∩ watched surface plus the cadence rows) and the cover-set check
// (D4 — the fresh/adjudicated/carried arms, the uncovered naming, the
// close-listing observation and its P10 floor).
import { describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  coverSet,
  coverSetObservation,
  deltaGroup,
  dueSet,
  measureRoundDelta,
  parseAssuranceTable,
  readAssuranceTable,
  renderCoverObservation,
  renderDeltaBlock,
  roundDeltaBlock,
  type AdjudicationReceipt,
  type CoverReceipt,
  type CoverRow,
  type RoundDelta,
} from "../src/assurance"
import { ASSURANCE_DOC } from "../src/docpaths"
import { phaseTypeOfLetter } from "../src/phases/registry"
import { renderFormulationTodo, renderPhaseAppend } from "../src/prompt-plan"
import { promptFacts } from "../src/prompt-facts"
import { formulationAcceptance } from "../src/formulate"
import { git } from "./fixtures/runner"
import { withDirFactory } from "./fixtures/dir"

const withDir = withDirFactory("auto-assurance-")
const facts = promptFacts()

async function gitRepo(dir: string) {
  await git(dir, "init", "-q")
  await git(dir, "config", "user.email", "t@example.com")
  await git(dir, "config", "user.name", "t")
}

function write(dir: string, rel: string, text: string) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true })
  writeFileSync(join(dir, rel), text)
}

async function commit(dir: string, message: string, ...paths: string[]) {
  for (const path of paths) await git(dir, "add", "--", path)
  await git(dir, "commit", "-q", "-m", message, "--", ...paths)
}

// A round established and committed the honest way: the setup (the phase
// index + brief) lands as one commit — the person's G1 review act — and the
// round's work follows after it.
async function establish(dir: string, round: number, phases = "a d m t v") {
  mkdirSync(join(dir, `docs/R-0${round}`), { recursive: true })
  writeFileSync(join(dir, `docs/R-0${round}/phases.md`), `# Round R-0${round}\n\n- P01-analysis analysis\n`)
  writeFileSync(join(dir, `docs/R-0${round}/round.md`), `# Round R-0${round}\n\n## Goal\n\nRound ${round} goal.\n`)
  await commit(dir, `R-0${round} setup (the G1 commit)`, `docs/R-0${round}/phases.md`, `docs/R-0${round}/round.md`)
}

describe("the round delta (plans/0244 D1)", () => {
  test("the anchor is the establishment commit; the G1 setup is the frame, not the work", async () => {
    await withDir(async (dir) => {
      await gitRepo(dir)
      write(dir, "README.md", "base\n")
      await commit(dir, "initial", "README.md")
      await establish(dir, 1)
      write(dir, "src/net.ts", "export const net = 1\n")
      await commit(dir, "work 1", "src/net.ts")
      write(dir, "test/net.test.ts", "test\n")
      write(dir, "docs/T-001/todo.md", "# T-001: x\n")
      await commit(dir, "work 2", "test/net.test.ts", "docs/T-001/todo.md")
      const delta = await measureRoundDelta(dir, 1)
      expect(delta).toBeDefined()
      const root = delta!.roots[0]!
      // Two work commits; the G1 commit is the range's opening, excluded.
      expect(root.commits).toBe(2)
      expect(root.anchor).not.toBe(root.head)
      // The G1 commit introduced docs/R-01/* — the range's diff excludes it,
      // so the measured files are exactly the round's work.
      expect(root.files.map((file) => file.path).sort()).toEqual(["docs/T-001/todo.md", "src/net.ts", "test/net.test.ts"])
      expect(root.files.find((file) => file.path === "src/net.ts")).toMatchObject({ status: "A", added: 1 })
      expect(root.anchorNote).toBeUndefined()
    })()
  })

  test("the block renders the range, the grouped stat and the bounded name lists", async () => {
    await withDir(async (dir) => {
      await gitRepo(dir)
      await establish(dir, 1)
      write(dir, "src/net.ts", "1\n2\n3\n")
      write(dir, "test/net.test.ts", "t\n")
      await commit(dir, "work", "src/net.ts", "test/net.test.ts")
      const block = await roundDeltaBlock(dir, 1)
      expect(block).toBeDefined()
      expect(block).toStartWith("## Input: the round's measured delta (driver-measured)\n")
      expect(block).toContain("- the target repository: 1 commit(s) in ")
      expect(block).toContain("..")
      expect(block).toContain("code 1 file(s) (+3/−0), test 1 file(s) (+1/−0), docs 0 file(s)")
      expect(block).toContain("Changed tests (1):")
      expect(block).toContain("- test/net.test.ts")
      expect(block).toContain("Changed code files (1):")
      expect(block).toContain("- src/net.ts")
      // The block names the round it measured.
      expect(block).not.toContain("(anchor:")
    })()
  })

  test("the floors: no git history, no establishment, and a quiet round all render nothing", async () => {
    await withDir(async (dir) => {
      // No git at all.
      expect(await measureRoundDelta(dir, 1)).toBeUndefined()
      await gitRepo(dir)
      // A repository with no commits.
      expect(await measureRoundDelta(dir, 1)).toBeUndefined()
      // A round whose setup is not committed yet (pre-G1): no anchor, and
      // for R-01 no fallback exists.
      mkdirSync(join(dir, "docs/R-01"), { recursive: true })
      write(dir, "docs/R-01/phases.md", "# Round R-01\n")
      expect(await measureRoundDelta(dir, 1)).toBeUndefined()
      expect(await roundDeltaBlock(dir, 1)).toBeUndefined()
      // Established and committed, but nothing since: measured, quiet, and
      // the renderer's floor is undefined (the todo byte-identical).
      await commit(dir, "setup", "docs/R-01/phases.md")
      const delta = await measureRoundDelta(dir, 1)
      expect(delta).toBeDefined()
      expect(renderDeltaBlock(delta!)).toBeUndefined()
    })()
  })

  test("the prior-round fallback opens at the prior round's close and names itself", async () => {
    await withDir(async (dir) => {
      await gitRepo(dir)
      await establish(dir, 1)
      write(dir, "src/a.ts", "a\n")
      await commit(dir, "work 1", "src/a.ts")
      // R-01 closes: the close transition rewrites the phase index, so the
      // last commit touching it is the prior round's settling point.
      write(dir, "docs/R-01/phases.md", "# Round R-01\n\n- P01-analysis analysis ✓\n")
      await commit(dir, "R-01 close", "docs/R-01/phases.md")
      // R-02 established on disk but its setup never committed (an
      // interrupted G1 window): the anchor is not derivable, the fallback
      // opens at R-01's close.
      mkdirSync(join(dir, "docs/R-02"), { recursive: true })
      write(dir, "docs/R-02/phases.md", "# Round R-02\n")
      write(dir, "src/b.ts", "b\n")
      await commit(dir, "work 2", "src/b.ts")
      const block = await roundDeltaBlock(dir, 2)
      expect(block).toBeDefined()
      expect(block).toContain("(anchor: the range opens at the prior round's close — this round's own establishment commit is not derivable)")
      expect(block).toContain("code 1 file(s)")
    })()
  })

  test("a nested repository measures since the round opened, its paths carrying the prefix", async () => {
    await withDir(async (dir) => {
      await gitRepo(dir)
      write(dir, "README.md", "base\n")
      await commit(dir, "initial", "README.md")
      // The nested repository's pre-round history lands strictly before the
      // establishment commit (the boundary is the anchor's time; a commit
      // in the same second is over-named, the honest direction).
      const nested = join(dir, "vendor")
      mkdirSync(nested)
      await gitRepo(nested)
      write(nested, "old.ts", "old\n")
      await git(nested, "add", "--", ".")
      await git(nested, "commit", "-q", "-m", "before the round")
      // Commit timestamps are second-granular: a real second between the
      // pre-round history and the establishment keeps the boundary exact
      // (the mechanism itself over-names same-second commits — honest, but
      // not what this test pins).
      await new Promise((resolve) => setTimeout(resolve, 1100))
      await establish(dir, 1)
      // The round's work: one commit in the target, one in the nested repo.
      write(dir, "src/main.ts", "m\n")
      await commit(dir, "target work", "src/main.ts")
      write(nested, "new.ts", "n\n")
      await git(nested, "add", "--", ".")
      await git(nested, "commit", "-q", "-m", "round work")
      const delta = await measureRoundDelta(dir, 1)
      expect(delta!.roots.map((root) => root.prefix).sort()).toEqual(["", "vendor"])
      const vendor = delta!.roots.find((root) => root.prefix === "vendor")!
      expect(vendor.commits).toBe(1)
      expect(vendor.files.map((file) => file.path)).toEqual(["vendor/new.ts"])
      expect(vendor.anchorNote).toBeUndefined()
      const block = renderDeltaBlock(delta!)!
      expect(block).toContain("- the nested repository vendor: 1 commit(s) in ")
      expect(block).toContain("- vendor/new.ts")
    })()
  })

  test("the group classification is path shape only", () => {
    expect(deltaGroup("src/net.ts")).toBe("code")
    expect(deltaGroup("src/internal/deep.c")).toBe("code")
    expect(deltaGroup("docs/R-01/round.md")).toBe("docs")
    expect(deltaGroup(".opencode/auto/config.json")).toBe("docs")
    expect(deltaGroup("test/net.test.ts")).toBe("test")
    expect(deltaGroup("src/__tests__/x.ts")).toBe("test")
    expect(deltaGroup("src/spec.y.ts")).toBe("test")
    expect(deltaGroup("spec/run.ts")).toBe("test")
    expect(deltaGroup("src/a.test.tsx")).toBe("test")
    expect(deltaGroup("src/a_spec.ts")).toBe("code")
    expect(deltaGroup("src/special.ts")).toBe("code")
    expect(deltaGroup("src/test_helper.ts")).toBe("code")
  })
})

describe("the delta block's prompt slots (plans/0244 D1)", () => {
  const base = {
    brief: "Project intent (fixed input).",
    phaseId: "R-01.P01",
    taskIndex: "docs/R-01/P01-implement/tasks.md",
    numberStart: 2,
    charter: formulationAcceptance(facts),
  }
  const block =
    "## Input: the round's measured delta (driver-measured)\n\n- the target repository: 1 commit(s) in abc1234..def5678 — code 1 file(s) (+2/−0), test 0 file(s), docs 0 file(s)\n\nChanged code files (1):\n- src/net.ts\n"

  test("the formulation todo splices the block and stays byte-identical without one", () => {
    const floor = renderFormulationTodo(facts, { ...base, input: "Prompt." })
    const withDelta = renderFormulationTodo(facts, { ...base, input: "Prompt.", delta: block })
    expect(withDelta.scope).toContain(block.trimEnd())
    expect(withDelta.scope).not.toBe(floor.scope)
    // The P10 floor: no delta (or a blank one) renders the document exactly.
    expect(renderFormulationTodo(facts, { ...base, input: "Prompt.", delta: undefined }).scope).toBe(floor.scope)
    expect(renderFormulationTodo(facts, { ...base, input: "Prompt.", delta: "  \n" }).scope).toBe(floor.scope)
  })

  test("the synthesis shape carries the block too — measurement, not an evidential source", () => {
    const synthesis = { brief: "Sources brief.", ledger: "- [O-1] an obligation", protocol: "the seeded rows" }
    const floor = renderFormulationTodo(facts, { ...base, phase: phaseTypeOfLetter("m"), synthesis })
    const withDelta = renderFormulationTodo(facts, { ...base, phase: phaseTypeOfLetter("m"), synthesis, delta: block })
    expect(withDelta.scope).toContain("the target repository: 1 commit(s)")
    expect(withDelta.scope).toContain("Sources brief.")
    expect(floor.scope).not.toContain("measured delta")
  })

  test("the append prompt splices the block and stays byte-identical without one", () => {
    const base2 = {
      phaseId: "R-01.P01",
      taskIndex: "docs/R-01/P01-implement/tasks.md",
      numberStart: 3,
      input: "More work.",
      inputPath: "docs/R-01/P01-implement/plan-input.md",
      existingTasks: "- [pending] T-002: there",
      brief: "Project intent (fixed input).",
    }
    const floor = renderPhaseAppend(facts, base2)
    expect(renderPhaseAppend(facts, { ...base2, delta: block })).toContain(block.trimEnd())
    expect(renderPhaseAppend(facts, { ...base2, delta: undefined })).toBe(floor)
    expect(renderPhaseAppend(facts, { ...base2, delta: " " })).toBe(floor)
    expect(floor).not.toContain("measured delta")
  })
})

// —— S3: the table (D2), the due set and the cover set (D4) ——

const HEADER = "| id | invariant | kind | watched surface | cadence | close | baseline |"
const SEPARATOR = "| --- | --- | --- | --- | --- | --- | --- |"

// A well-formed table over every vocabulary arm; rows are pipe lines.
const table = (rows: readonly string[]) => [`# Assurance`, ``, HEADER, SEPARATOR, ...rows].join("\n")
const row = (id: string, invariant: string, kind: string, surface: string, cadence: string, close: string, baseline = "") =>
  `| ${id} | ${invariant} | ${kind} | ${surface} | ${cadence} | ${close} | ${baseline} |`

// The D2 example's shape (synthetic ids and paths — no real project, P16).
const FULL_TABLE = table([
  row("S-03", "MUST coverage", "judgment", "catalog Required rows' paths", "on-reach", "accrue", "R-06 audit @abc1234 (T-258/*)"),
  row("S-06", "suite green at close", "mechanical", "src, test", "every-round", "blocks", "receipts T-287/*"),
  row("S-08", "clean-room independence", "judgment", "crossing events, similarity flags", "every-round", "close-due", "R-07 audit @def5678"),
  row("S-11", "interface parity", "mechanical", "include", "periodic: weekly", "accrue", ""),
])

// A synthetic round delta over the target repository (the unit tests never
// touch git — the computations are pure over the measured shape).
const deltaOf = (paths: readonly string[], head = "def5678"): RoundDelta => ({
  round: 1,
  roots: [{ label: "the target repository", prefix: "", anchor: "abc1234", head, commits: paths.length, files: paths.map((path) => ({ path, status: "M", added: 1, removed: 0 })) }],
})

const receipt = (over: { head?: string; decides?: string[]; verdict?: "green" | "red"; path?: string } = {}): CoverReceipt => ({
  path: over.path ?? "docs/T-001/testhands/lint.md",
  lane: "lint",
  verdict: over.verdict ?? "green",
  tree: [{ root: ".", base: "abc1234", head: over.head ?? "def5678" }],
  decides: over.decides ?? ["src", "test"],
})

describe("the assurance table (plans/0244 D2)", () => {
  test("a well-formed table round-trips: both vocabularies, the schedule, the baseline", () => {
    const rows = parseAssuranceTable(FULL_TABLE)
    expect(rows.map((entry) => entry.id)).toEqual(["S-03", "S-06", "S-08", "S-11"])
    expect(rows[0]).toMatchObject({ kind: "judgment", paths: [], facts: ["catalog Required rows' paths"], cadence: "on-reach", close: "accrue", baseline: "R-06 audit @abc1234 (T-258/*)" })
    expect(rows[1]).toMatchObject({ kind: "mechanical", paths: ["src", "test"], facts: [], cadence: "every-round", close: "blocks" })
    expect(rows[2]).toMatchObject({ facts: ["crossing events", "similarity flags"], close: "close-due" })
    expect(rows[3]).toMatchObject({ cadence: "periodic", schedule: "weekly", paths: ["include"], baseline: "" })
    // Prose rides free around the table; the cells keep their raw text.
    expect(rows[1]!.surface).toBe("src, test")
  })

  test("load failures name the row and the problem — never a crash (P12/P13)", () => {
    const cases: [string, string][] = [
      [table([row("S-01", "x", "logical", "src", "on-reach", "blocks")]), `row "S-01": kind must be judgment or mechanical, got: logical`],
      [table([row("S-01", "x", "mechanical", "src", "monthly", "blocks")]), `row "S-01": cadence must be on-reach, every-round, person-forced or periodic, got: monthly`],
      [table([row("S-01", "x", "mechanical", "src", "every-round: daily", "blocks")]), `row "S-01": only a periodic row carries schedule text after its cadence, got: every-round: daily`],
      [table([row("S-01", "x", "mechanical", "src", "on-reach", "waives")]), `row "S-01": close must be blocks, accrue or close-due, got: waives`],
      [table([row("S-01", "x", "mechanical", "src", "on-reach", "blocks"), row("S-01", "x", "mechanical", "test", "on-reach", "blocks")]), `the table declares row "S-01" twice`],
      [table(["| S-01 | x | mechanical | src | on-reach | blocks |"]), `row "S-01" carries 6 cell(s), exactly 7 required`],
      [table([row("S-01", "x", "mechanical", "/abs/path", "on-reach", "blocks")]), `row "S-01": a watched-surface path token must be target-relative (no absolute paths, no ..), got: /abs/path`],
      [table([row("S-01", "x", "mechanical", "../escape", "on-reach", "blocks")]), `row "S-01": a watched-surface path token must be target-relative (no absolute paths, no ..), got: ../escape`],
      [table([row("S-01", "x", "mechanical", "src,", "on-reach", "blocks")]), `row "S-01": the watched surface must name at least one token`],
      [`| id | invariant | kind | surface | cadence | close | baseline |\n${SEPARATOR}\n${row("S-01", "x", "mechanical", "src", "on-reach", "blocks")}`, "the table's header must be exactly"],
      [`${HEADER}\n| not | a | separator | row | at | all | here |\n${row("S-01", "x", "mechanical", "src", "on-reach", "blocks")}`, "the table's second line must be the markdown separator row"],
    ]
    for (const [text, problem] of cases) expect(() => parseAssuranceTable(text)).toThrow(problem)
  })

  test("absent file or no table is the floor, never an error (P10)", async () => {
    await withDir(async (dir) => {
      expect(await readAssuranceTable(dir)).toBeUndefined()
      write(dir, ASSURANCE_DOC, "# Notes\n\nNo table yet, only prose.\n")
      expect(await readAssuranceTable(dir)).toBeUndefined()
      write(dir, ASSURANCE_DOC, FULL_TABLE)
      const rows = await readAssuranceTable(dir)
      expect(rows!.map((entry) => entry.id)).toEqual(["S-03", "S-06", "S-08", "S-11"])
    })()
  })
})

describe("the due set (plans/0244 D4)", () => {
  const table2 = parseAssuranceTable(FULL_TABLE)

  test("on-reach rows are due exactly on intersection; the touched paths ride along", () => {
    const onReach = parseAssuranceTable(
      table([
        row("S-60", "code hygiene", "mechanical", "src", "on-reach", "blocks"),
        row("S-61", "deep notes", "judgment", "docs/deep", "on-reach", "accrue"),
        row("S-62", "vendored corner", "mechanical", "vendor", "on-reach", "blocks"),
      ]),
    )
    expect(dueSet(onReach, {})).toEqual([])
    expect(dueSet(onReach, { delta: deltaOf(["other.ts"]) })).toEqual([])
    // Prefix shapes: a directory token contains every path inside it.
    expect(dueSet(onReach, { delta: deltaOf(["src/a.ts", "src/deep/b.ts"]) }).map((entry) => entry.row.id)).toEqual(["S-60"])
    expect(dueSet(onReach, { delta: deltaOf(["docs/deep/one.md"]) }).map((entry) => entry.row.id)).toEqual(["S-61"])
    const due = dueSet(onReach, { delta: deltaOf(["src/a.ts", "docs/deep/one.md"]) })
    expect(due.find((entry) => entry.row.id === "S-60")!.touched).toEqual(["src/a.ts"])
    expect(due.find((entry) => entry.row.id === "S-61")!.touched).toEqual(["docs/deep/one.md"])
  })

  test("a quiet round leaves only the cadence rows; every-round is always due", () => {
    // Of FULL_TABLE only S-06/S-08 (every-round) and S-11 (periodic, the
    // predicate absent — conservatively due) survive a quiet round.
    expect(dueSet(table2, {}).map((entry) => entry.row.id)).toEqual(["S-06", "S-08", "S-11"])
    expect(dueSet(table2, { delta: deltaOf([]) }).map((entry) => entry.row.id)).toEqual(["S-06", "S-08", "S-11"])
    // A path delta reaches S-06's watched paths and S-11's include/; the
    // fact-phrase rows stay cadence-due only.
    expect(dueSet(table2, { delta: deltaOf(["src/net.ts", "include/if.h"]) }).map((entry) => entry.row.id)).toEqual(["S-06", "S-08", "S-11"])
  })

  test("person-forced rows are due when the person's force mark stands (the close arm's input)", () => {
    const rows = parseAssuranceTable(table([row("S-20", "forced check", "mechanical", "src", "person-forced", "blocks")]))
    expect(dueSet(rows, { forced: [] })).toEqual([])
    expect(dueSet(rows, { forced: ["S-20"] }).map((entry) => entry.row.id)).toEqual(["S-20"])
    expect(dueSet(rows, { forced: ["S-99"] })).toEqual([])
  })

  test("periodic rows are due by the predicate input; an unreadable schedule dues them (P12)", () => {
    const rows = parseAssuranceTable(table([row("S-30", "weekly sweep", "mechanical", "src", "periodic: weekly", "accrue")]))
    expect(dueSet(rows, { periodic: () => false })).toEqual([])
    expect(dueSet(rows, { periodic: () => true }).map((entry) => entry.row.id)).toEqual(["S-30"])
    // The predicate absent = the condition stands unread: dirty, the row dues.
    expect(dueSet(rows).map((entry) => entry.row.id)).toEqual(["S-30"])
  })

  test("process facts reach independence rows by substring", () => {
    // S-03 watches "catalog Required rows' paths" — a fact phrase a measured
    // fact carries verbatim as a substring.
    const due = dueSet(table2, { delta: deltaOf([]), facts: ["the catalog Required rows' paths were re-read at T-004"] })
    expect(due.map((entry) => entry.row.id)).toEqual(["S-03", "S-06", "S-08", "S-11"])
    // A quiet fact vocabulary reaches nothing on its own.
    expect(dueSet(table2, { delta: deltaOf([]), facts: ["the lanes were green"] }).some((entry) => entry.row.id === "S-03")).toBe(false)
  })

  test("a nested repository's prefixed paths are target-relative in the intersection", () => {
    const vendored = parseAssuranceTable(table([row("S-62", "vendored corner", "mechanical", "vendor", "on-reach", "blocks")]))
    const nested: RoundDelta = {
      round: 1,
      roots: [
        { label: "the target repository", prefix: "", anchor: "abc1234", head: "def5678", commits: 0, files: [] },
        { label: "the nested repository vendor", prefix: "vendor", anchor: "0000000", head: "beef0000", commits: 1, files: [{ path: "vendor/src/one.ts", status: "A", added: 2, removed: 0 }] },
      ],
    }
    const due = dueSet(vendored, { delta: nested })
    expect(due.map((entry) => entry.row.id)).toEqual(["S-62"])
    expect(due[0]!.touched).toEqual(["vendor/src/one.ts"])
  })
})

describe("the cover set (plans/0244 D4)", () => {
  const table3 = parseAssuranceTable(FULL_TABLE)
  const due = dueSet(table3, { delta: deltaOf(["src/net.ts", "test/net.test.ts"]) })
  const byId = (rows: readonly CoverRow[]) => Object.fromEntries(rows.map((entry) => [entry.due.row.id, entry]))

  test("fresh — a green receipt at the closing tree whose Decides covers the watched paths", () => {
    const cover = byId(coverSet(due, { delta: deltaOf(["src/net.ts", "test/net.test.ts"]), receipts: [receipt()] }))
    expect(cover["S-06"]!.state).toBe("fresh")
    expect(cover["S-06"]!.cover).toBe("lint (docs/T-001/testhands/lint.md)")
    // A receipt deciding one file never covers a watched directory (the
    // one-directional containment); the row falls through to uncovered —
    // its surface is this round's Δ, so no baseline carries it.
    const narrow = byId(coverSet(due, { delta: deltaOf(["src/net.ts", "test/net.test.ts"]), receipts: [receipt({ decides: ["src/one.ts"] })] }))
    expect(narrow["S-06"]!.state).toBe("uncovered")
  })

  test("nothing stale, red, headless or delta-less is fresh (P12: no-reuse)", () => {
    // A no-baseline row: only a fresh receipt can ever cover it.
    const bare = parseAssuranceTable(table([row("S-50", "suite green", "mechanical", "src", "every-round", "blocks")]))
    const dueBare = dueSet(bare, { delta: deltaOf(["src/net.ts"]) })
    const delta = deltaOf(["src/net.ts"])
    for (const receipts of [
      [receipt({ head: "abc1230" })], // a tree the round has already moved past
      [receipt({ verdict: "red" })],
      [{ ...receipt(), tree: [] }],
    ]) {
      expect(byId(coverSet(dueBare, { delta, receipts }))["S-50"]!.state).toBe("uncovered")
    }
    // No measurement at all: freshness is unjudgeable, never assumed.
    expect(byId(coverSet(dueSet(bare, {}), {}))["S-50"]!.state).toBe("uncovered")
  })

  test("adjudicated — a passing adjudication receipt names the judgment row (the S4/S5-fed parameter)", () => {
    const pass: AdjudicationReceipt = { doc: "docs/T-296/findings.md", rows: ["S-08"], result: "PASS" }
    const cover = byId(coverSet(dueSet(table3, {}), { adjudications: [pass] }))
    expect(cover["S-08"]!.state).toBe("adjudicated")
    expect(cover["S-08"]!.cover).toBe("docs/T-296/findings.md")
    // A FAIL never adjudicates; its row stays uncovered — the reached fact
    // phrases bar its baseline from carrying the failure away.
    const reached = ["similarity flags raised at T-004"] as const
    const failed = byId(coverSet(dueSet(table3, { facts: reached }), { facts: reached, adjudications: [{ doc: "docs/T-295/findings.md", rows: ["S-08"], result: "FAIL" }] }))
    expect(failed["S-08"]!.state).toBe("uncovered")
    // The mechanical row ignores adjudications — kind-keyed, the plan's
    // letter; its surface is Δ here, so nothing else covers it either.
    const mechanical = byId(coverSet(dueSet(table3, { delta: deltaOf(["src/x.ts"]) }), { delta: deltaOf(["src/x.ts"]), adjudications: [{ doc: "docs/T-001/findings.md", rows: ["S-06"], result: "PASS" }] }))
    expect(mechanical["S-06"]!.state).toBe("uncovered")
  })

  test("carried — a cited baseline plus the disjointness argument (Δ misses the surface)", () => {
    // S-08 watches fact phrases; a path delta misses it entirely, and its
    // baseline is cited — carried, the argument mechanical.
    const quiet = byId(coverSet(dueSet(table3, { delta: deltaOf(["src/net.ts"]) }), { delta: deltaOf(["src/net.ts"]) }))
    expect(quiet["S-08"]!.state).toBe("carried")
    expect(quiet["S-08"]!.cover).toBe("R-07 audit @def5678")
    // S-06's surface IS this Δ: the citation cannot stand over a touched
    // watched surface, and with no receipt the row is uncovered.
    expect(quiet["S-06"]!.state).toBe("uncovered")
    // A fact that reaches the watched phrases bars the carry the same way.
    const reached = byId(coverSet(dueSet(table3, { delta: deltaOf([]), facts: ["similarity flags raised"] }), { delta: deltaOf([]), facts: ["similarity flags raised"] }))
    expect(reached["S-08"]!.state).toBe("uncovered")
    // S-11 cites no baseline: no carry basis, whatever the delta.
    expect(quiet["S-11"]!.state).toBe("uncovered")
  })

  test("the observation renders the states, the accrual record and the remedies (P8; no stage names)", () => {
    const rows = coverSet(dueSet(table3, { delta: deltaOf(["include/if.h"]) }), { delta: deltaOf(["include/if.h"]), receipts: [receipt({ decides: ["include"] }), receipt()] })
    const lines = renderCoverObservation(rows)
    expect(lines[0]).toBe("assurance cover set — 3 row(s) due at this close under docs/assurance.md (observations of the cover set; the blocking refusals render at the close gate's stop):")
    expect(lines).toContain("S-06 (suite green at close): fresh — the green receipt lint (docs/T-001/testhands/lint.md) stands at the closing tree and decides its watched surface")
    expect(lines).toContain("S-08 (clean-room independence): carried — this round's delta misses its watched surface, the cited baseline (R-07 audit @def5678) stands")
    expect(lines).toContain("S-11 (interface parity): accrues, fresh — the green receipt lint (docs/T-001/testhands/lint.md) stands at the closing tree and decides its watched surface")
    const uncovered = renderCoverObservation(coverSet(dueSet(table3, { delta: deltaOf(["src/x.ts"]), facts: ["similarity flags raised"] }), { delta: deltaOf(["src/x.ts"]), facts: ["similarity flags raised"] }))
    expect(uncovered).toContain("S-06 (suite green at close): uncovered — a green lane receipt at the closing tree deciding src, test covers it")
    expect(uncovered).toContain("S-08 (clean-room independence): uncovered — an adjudication receipt (an audit findings document naming S-08 with Result: PASS) covers it")
    expect(uncovered).toContain("S-11 (interface parity): accrues, uncovered — a green lane receipt at the closing tree deciding include covers it; the next round that reaches its surface pays it")
    expect(uncovered.some((line) => line.includes("S4") || line.includes("stage"))).toBe(false)
  })
})

describe("the cover-set observation at close (plans/0244 D4, S3)", () => {
  const ROWS = table([
    row("S-06", "suite green at close", "mechanical", "src, test", "every-round", "blocks", ""),
    // No baseline cited: nothing can carry it, and no adjudication writer
    // names rows yet — the honest uncovered, the parameter S4/S5 feeds.
    row("S-08", "clean-room independence", "judgment", "crossing events, similarity flags", "every-round", "close-due", ""),
  ])

  // One green lane receipt at the repo's current HEAD (the D3 fields),
  // landed the way the lane runners land one: through a receipt janitor
  // commit (plans/0171 D2 — the provenance witness S4 added to the
  // composition reads the Auto-Stage trailer).
  async function writeReceipt(dir: string, decides: string) {
    const head = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
    write(
      dir,
      "docs/T-001/testhands/lint.md",
      ["# Lane lint", "", "Lane: lint", `Heads: .=${head}`, `Tree: .=${head}..${head}`, "Start: 2026-11-16T00:00:00.000Z", "End: 2026-11-16T00:00:01.000Z", "Verdict: green", `Decides: ${decides}`, "Log: /tmp/opencode/lint.log", ""].join("\n"),
    )
    await janitorCommit(dir, "docs/T-001/testhands/lint.md")
  }

  // The receipt janitor commit (the 0171 D2 trailer family the witness reads).
  async function janitorCommit(dir: string, ...paths: string[]) {
    for (const path of paths) await git(dir, "add", "--", path)
    await git(dir, "commit", "-q", "-m", `T-001 testhands receipts (lint)\n\nAuto-Stage: testhands`, "--", ...paths)
  }

  test("the composition measures the delta, gathers the receipts and renders the states", async () => {
    await withDir(async (dir) => {
      await gitRepo(dir)
      write(dir, "README.md", "base\n")
      await commit(dir, "initial", "README.md")
      await establish(dir, 1)
      write(dir, "src/net.ts", "export const net = 1\n")
      await commit(dir, "work", "src/net.ts")
      write(dir, ASSURANCE_DOC, ROWS)
      await writeReceipt(dir, "src, test")
      const lines = await coverSetObservation(dir, 1)
      expect(lines).toBeDefined()
      expect(lines![0]).toBe("assurance cover set — 2 row(s) due at this close under docs/assurance.md (observations of the cover set; the blocking refusals render at the close gate's stop):")
      expect(lines).toContain("S-06 (suite green at close): fresh — the green receipt lint (docs/T-001/testhands/lint.md) stands at the closing tree and decides its watched surface")
      expect(lines).toContain("S-08 (clean-room independence): uncovered — an adjudication receipt (an audit findings document naming S-08 with Result: PASS) covers it")
      // A stale receipt (the tree moved past it) never covers: one more
      // commit, and the mechanical row flips to uncovered with its remedy.
      write(dir, "src/late.ts", "late\n")
      await commit(dir, "late work", "src/late.ts")
      const stale = await coverSetObservation(dir, 1)
      expect(stale).toContain("S-06 (suite green at close): uncovered — a green lane receipt at the closing tree deciding src, test covers it")
    })()
  })

  test("the provenance witness: an unprovenanced receipt does not cover (S4; 0171 D2, P12 toward no-reuse)", async () => {
    await withDir(async (dir) => {
      await gitRepo(dir)
      write(dir, "README.md", "base\n")
      await commit(dir, "initial", "README.md")
      await establish(dir, 1)
      write(dir, "src/net.ts", "export const net = 1\n")
      await commit(dir, "work", "src/net.ts")
      write(dir, ASSURANCE_DOC, ROWS)
      const head = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      const receipt = ["# Lane lint", "", "Lane: lint", `Heads: .=${head}`, `Tree: .=${head}..${head}`, "Start: 2026-11-16T00:00:00.000Z", "End: 2026-11-16T00:00:01.000Z", "Verdict: green", "Decides: src, test", "Log: /tmp/opencode/lint.log", ""].join("\n")
      // Dirty in the tree (a session wrote it, no janitor commit landed):
      write(dir, "docs/T-001/testhands/lint.md", receipt)
      let lines = await coverSetObservation(dir, 1)
      expect(lines).toContain("S-06 (suite green at close): uncovered — a green lane receipt at the closing tree deciding src, test covers it")
      // Committed, but by the person (no Auto-Stage trailer at all): location
      // is not provenance — still no cover.
      await commit(dir, "a person commits the receipt", "docs/T-001/testhands/lint.md")
      lines = await coverSetObservation(dir, 1)
      expect(lines).toContain("S-06 (suite green at close): uncovered — a green lane receipt at the closing tree deciding src, test covers it")
      // Riding a non-janitor driver commit (a session's unified commit shape)
      // is the same rejection: only the trailer family carries.
      write(dir, "docs/T-001/testhands/lint.md", `${receipt}\n(a session-forged edit)\n`)
      await git(dir, "add", "--", "docs/T-001/testhands/lint.md")
      await git(dir, "commit", "-q", "-m", "T-001 wrapup\n\nAuto-Stage: wrapup", "--", "docs/T-001/testhands/lint.md")
      lines = await coverSetObservation(dir, 1)
      expect(lines).toContain("S-06 (suite green at close): uncovered — a green lane receipt at the closing tree deciding src, test covers it")
    })()
  })

  test("the adjudication reading: a findings document naming the row with Result: PASS adjudicates (S4's real feed)", async () => {
    await withDir(async (dir) => {
      await gitRepo(dir)
      write(dir, "README.md", "base\n")
      await commit(dir, "initial", "README.md")
      await establish(dir, 1)
      write(dir, "src/net.ts", "export const net = 1\n")
      await commit(dir, "work", "src/net.ts")
      write(dir, ASSURANCE_DOC, ROWS)
      // The close-audit unit's own receipt: a findings document that names
      // the row id and concludes the verdict.
      write(dir, "docs/T-095/findings.md", ["# Findings (T-095)", "", "## S-08 — clean-room independence", "", "The round's delta touches no crossing event; the invariant holds.", "", "Result: PASS", ""].join("\n"))
      await commit(dir, "the close-audit findings", "docs/T-095/findings.md")
      const lines = await coverSetObservation(dir, 1)
      expect(lines).toContain("S-08 (clean-room independence): adjudicated — docs/T-095/findings.md carries Result: PASS for it")
      // A FAIL never adjudicates; a document that names no row id names
      // nothing (the row-naming linkage is data, P7).
      write(dir, "docs/T-095/findings.md", ["# Findings (T-095)", "", "## S-08 — clean-room independence", "", "A crossing event went unjustified.", "", "Result: FAIL the crossing at T-004 is unjustified", ""].join("\n"))
      write(dir, "docs/T-096/findings.md", ["# Findings (T-096)", "", "Some other dimension's audit.", "", "Result: PASS", ""].join("\n"))
      await commit(dir, "a failing adjudication, an unnamed one", "docs/T-095/findings.md", "docs/T-096/findings.md")
      const failed = await coverSetObservation(dir, 1)
      expect(failed).toContain("S-08 (clean-room independence): uncovered — an adjudication receipt (an audit findings document naming S-08 with Result: PASS) covers it")
    })()
  })

  test("a malformed table renders its named problem — fail loud, never a crash (P12)", async () => {
    await withDir(async (dir) => {
      await gitRepo(dir)
      write(dir, ASSURANCE_DOC, table([row("S-01", "x", "mechanical", "src", "someday", "blocks")]))
      const lines = await coverSetObservation(dir, 1)
      expect(lines).toEqual([
        `⚠ the assurance table does not parse: ${ASSURANCE_DOC}: row "S-01": cadence must be on-reach, every-round, person-forced or periodic, got: someday — fix the row it names; the cover-set records render once the table loads`,
      ])
    })()
  })

  test("the floor: no table renders nothing, whatever the round measured (P10)", async () => {
    await withDir(async (dir) => {
      await gitRepo(dir)
      await establish(dir, 1)
      write(dir, "src/net.ts", "n\n")
      await commit(dir, "work", "src/net.ts")
      expect(await coverSetObservation(dir, 1)).toBeUndefined()
      // A table whose rows are never due renders nothing either (the gate
      // is a no-op over an empty due set).
      write(dir, ASSURANCE_DOC, table([row("S-40", "quiet corner", "mechanical", "corner", "on-reach", "blocks")]))
      expect(await coverSetObservation(dir, 1)).toBeUndefined()
      rmSync(join(dir, ASSURANCE_DOC))
      expect(await coverSetObservation(dir, 1)).toBeUndefined()
    })()
  })
})
