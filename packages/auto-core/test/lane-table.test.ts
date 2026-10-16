// The test-lane table (plans/0096 D3/D4, Stage 2): the intent pack's optional
// `### test-lanes` subsection — the project's declared suite table (one field
// block per suite: name, command, cost class, surfaces, exclusivity), parsed
// strictly, resolved per project, and rendered into the execution prompts
// beside the self-checks with the channel clause. Stage 3's driver-side
// extensions (the carry-forward intersection, exclusivity serialization, the
// anchor pre-gate) land in this file beside these cases.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadIntents, parseIntentFile, resolveIntent } from "../src/intent/load"
import { acceptanceSection, anchorLaneOf, laneTouches, parseLaneReceipt, parseTestLanes, testLanesProblem, type TestLane } from "../src/intent/test-lanes"
import { DEFAULT_INTENT } from "../src/intent/types"
import { taskDocPaths } from "../src/docpaths"
import { EOF_MARK } from "../src/doccheck"
import { laneReceiptDoc } from "../src/docpaths"
import { rangeChangedFiles } from "../src/git"
import { promptFacts } from "../src/prompt-facts"
import { renderFanout, renderSubtask, renderWhole, renderWrapup, type PromptFacts } from "../src/prompt"
import { laneBatches, runTestLanes } from "../src/script"
import { promptViews } from "../src/tasks"
import { plan, task } from "./fixtures/prompt"
import { freshRepo, git } from "./fixtures/runner"

// A pack whose `## quality` carries only the lane table — enough for the
// parse; the render cases below splice the section into the real built-in
// pack so the goldens' basis stays comparable.
const lanePack = (rows: string) => parseIntentFile("default", `# default\n\n## quality\n\n### test-lanes\n\n${rows}\n`)
const laneFacts = (rows: string): PromptFacts => ({ ...promptFacts(), pack: lanePack(rows) })

const ROWS = [
  "lint:",
  "Command: make lint",
  "Cost: cheap",
  "Surfaces: src/, test/",
  "Exclusive: no",
  "",
  "gate:",
  "Command: ./scripts/gate.sh full",
  "Cost: anchor",
  "Surfaces: src/, include/",
  "Exclusive: yes",
].join("\n")

describe("the lane-table grammar (parseTestLanes / testLanesProblem, plans/0096 D3)", () => {
  test("a pack without the section is the zero-intent floor", () => {
    expect(parseTestLanes(parseIntentFile("default", "# default\n\n## quality\n\n### decompose\n\nsplit rules.\n"))).toBeUndefined()
    // The loader's absent-section shape and the empty one agree.
    expect(parseTestLanes(parseIntentFile("default", "# default\n"))).toBeUndefined()
  })

  test("a section of comments and blanks only is the floor too", () => {
    expect(parseTestLanes(lanePack("# suites land here once the project declares them\n\n   \n"))).toBeUndefined()
  })

  test("rows parse with all five fields; comment lines between blocks are skipped", () => {
    const withComment = ROWS.replace("gate:", "# the expensive one\ngate:")
    expect(parseTestLanes(lanePack(withComment))).toEqual([
      { name: "lint", command: "make lint", cost: "cheap", surfaces: ["src/", "test/"], exclusive: false },
      { name: "gate", command: "./scripts/gate.sh full", cost: "anchor", surfaces: ["src/", "include/"], exclusive: true },
    ])
  })

  // The third cost class (plans/0098 D1): the project's full-gate regression,
  // the row the driver's background slot owns — parsed by the same grammar,
  // excluded from the wrap-up's set and the anchor resolution below. The
  // strict option (D7) is the one optional field, regression rows only.
  test("a regression-cost row parses beside its peers, its Strict option with it", () => {
    const rows = [ROWS, "", "regress:", "Command: bash test/verify_full.sh", "Cost: regression", "Surfaces: src/, include/, test/", "Exclusive: yes", "Strict: yes"].join("\n")
    const parsed = parseTestLanes(lanePack(rows))
    expect(parsed).toHaveLength(3)
    expect(parsed![2]).toEqual({ name: "regress", command: "bash test/verify_full.sh", cost: "regression", surfaces: ["src/", "include/", "test/"], exclusive: true, strict: true })
    expect(testLanesProblem(lanePack(rows))).toBeUndefined()
    // Absent Strict, or `no`, is the wave-scoped standard.
    const plain = parseTestLanes(lanePack(rows.replace("\nStrict: yes", "")))
    expect(plain![2]!.strict).toBeUndefined()
    expect(parseTestLanes(lanePack(rows.replace("Strict: yes", "Strict: no")))![2]!.strict).toBeUndefined()
    // Strict on a non-regression row and a bad value fail strictly.
    expect(() => parseTestLanes(lanePack("lint:\nCommand: x\nCost: cheap\nSurfaces: src/\nExclusive: no\nStrict: yes"))).toThrow(/Strict is a regression-row option/)
    expect(() => parseTestLanes(lanePack("regress:\nCommand: x\nCost: regression\nSurfaces: src/\nExclusive: no\nStrict: maybe"))).toThrow(/Strict must be yes or no/)
  })

  test("malformed rows fail strictly, naming the pack and the offending line", () => {
    const cases: Array<[string, RegExp]> = [
      ["lint: make lint\nCommand: make lint\nCost: cheap\nSurfaces: src/\nExclusive: no", /malformed test-lanes line: lint: make lint/],
      ["Lint:\nCommand: x\nCost: cheap\nSurfaces: src/\nExclusive: no", /malformed test-lanes line: Lint:/],
      ["Command: make lint", /malformed test-lanes line: Command: make lint/],
      ["lint:\nRunner: make lint\nCost: cheap\nSurfaces: src/\nExclusive: no", /malformed test-lanes line: Runner: make lint/],
      ["lint:\nCommand: make lint\nCost: quick\nSurfaces: src/\nExclusive: no", /suite "lint" Cost must be cheap, anchor or regression, got: quick/],
      ["lint:\nCommand: make lint\nCost: cheap\nSurfaces: src/\nExclusive: maybe", /suite "lint" Exclusive must be yes or no, got: maybe/],
      ["lint:\nCommand: \nCost: cheap\nSurfaces: src/\nExclusive: no", /suite "lint" Command must not be empty/],
      ["lint:\nCost: cheap\nSurfaces: src/\nExclusive: no", /suite "lint" is missing its Command line/],
      ["lint:\nCommand: make lint\nSurfaces: src/\nExclusive: no", /suite "lint" is missing its Cost line/],
      ["lint:\nCommand: make lint\nCost: cheap\nExclusive: no", /suite "lint" is missing its Surfaces line/],
      ["lint:\nCommand: make lint\nCost: cheap\nSurfaces: src/", /suite "lint" is missing its Exclusive line/],
      ["lint:\nCommand: make lint\nCost: cheap\nSurfaces: /abs, ../x\nExclusive: no", /no absolute paths, no \.\./],
      ["lint:\nCommand: make lint\nCost: cheap\nSurfaces: src/..\nExclusive: no", /no absolute paths, no \.\./],
      ["lint:\nCommand: make lint\nCost: cheap\nSurfaces: \nExclusive: no", /must name at least one path/],
      ["lint:\nCommand: make lint\nCommand: make lint2\nCost: cheap\nSurfaces: src/\nExclusive: no", /suite "lint" repeats its Command line/],
      [`${ROWS}\n\nlint:\nCommand: x\nCost: cheap\nSurfaces: src/\nExclusive: no`, /declares test-lanes suite "lint" twice/],
    ]
    for (const [rows, pattern] of cases) expect(() => parseTestLanes(lanePack(rows)), rows).toThrow(pattern)
  })

  test("testLanesProblem round-trips the parse, and the section addresses beside its quality siblings", () => {
    expect(testLanesProblem(lanePack(ROWS))).toBeUndefined()
    expect(testLanesProblem(lanePack("lint:\nCost: cheap\n"))).toMatch(/intent pack "default" test-lanes suite "lint" is missing its Command line/)
    expect(testLanesProblem(parseIntentFile("default", "# default\n"))).toBeUndefined()
    // Through the full file protocol the subsection sits under `## quality`
    // beside the self-check sections; both address cleanly.
    const full = parseIntentFile(
      "default",
      ["# default", "", "## quality", "", "### self-check-whole", "", "check the whole task.", "", "### test-lanes", "", ...ROWS.split("\n"), ""].join("\n"),
    )
    expect(testLanesProblem(full)).toBeUndefined()
    expect(parseTestLanes(full)).toHaveLength(2)
  })
})

describe("per-project overlay resolution (the table is versioned in the pack)", () => {
  const dir = () => {
    const d = mkdtempSync(join(tmpdir(), "auto-lanes-"))
    mkdirSync(join(d, ".opencode", "auto", "intents"), { recursive: true })
    return d
  }

  test("a project pack declaring its suites resolves as the active pack; sessions and driver read the same parse", () => {
    const d = dir()
    try {
      writeFileSync(join(d, ".opencode", "auto", "intents", `${DEFAULT_INTENT}.md`), `# default\n\n## quality\n\n### test-lanes\n\n${ROWS}\n`)
      const pack = resolveIntent(loadIntents(d))
      expect(parseTestLanes(pack)).toEqual([
        { name: "lint", command: "make lint", cost: "cheap", surfaces: ["src/", "test/"], exclusive: false },
        { name: "gate", command: "./scripts/gate.sh full", cost: "anchor", surfaces: ["src/", "include/"], exclusive: true },
      ])
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })

  test("a malformed project table surfaces through testLanesProblem (the preflight check's input)", () => {
    const d = dir()
    try {
      writeFileSync(join(d, ".opencode", "auto", "intents", `${DEFAULT_INTENT}.md`), `# default\n\n## quality\n\n### test-lanes\n\nlint:\nCost: cheap\nSurfaces: src/\nExclusive: no\n`)
      expect(testLanesProblem(resolveIntent(loadIntents(d)))).toMatch(/suite "lint" is missing its Command line/)
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  })
})

describe("session-side rendering (plans/0096 D4 — no driver machinery)", () => {
  const views = promptViews(plan, task)
  const docs = taskDocPaths(task.id)
  const lanes = laneFacts(ROWS)
  const plain = promptFacts()

  test("the whole-task prompt carries the lane protocol and the table beside the self-check constraint", () => {
    const text = renderWhole(lanes, views.plan, views.task, docs, { ondemand: true, budget: true, testByDriver: true })
    expect(text).toContain("Test lanes (this project's suites")
    expect(text).toContain("docs/T-002/testplan.md")
    expect(text).toContain("docs/T-002/testhands/<lane id>.md")
    expect(text).toContain("LANE_RC=$? >> <log>")
    expect(text).toContain("Never end a session with a lane process in flight")
    // The joined table rows carry every field: name, command, cost class,
    // surfaces, exclusivity.
    expect(text).toContain("- lint (cheap): `make lint` — surfaces: src/, test/")
    expect(text).toContain("- gate (anchor, exclusive): `./scripts/gate.sh full` — surfaces: src/, include/")
    expect(text).not.toMatch(/\{\{|\}\}/)
  })

  test("the channel clause renders only when both the lane table and the driver channel are in play", () => {
    const withChannel = renderWhole(lanes, views.plan, views.task, docs, { ondemand: true, testByDriver: true })
    expect(withChannel).toContain("your lanes run only what the task's acceptance names beyond that channel")
    expect(withChannel).toContain("never both channels running the anchor")
    const withoutChannel = renderWhole(lanes, views.plan, views.task, docs, { ondemand: true })
    expect(withoutChannel).toContain("Test lanes (this project's suites")
    expect(withoutChannel).not.toContain("both channels running the anchor")
    // A lane table without the driver channel switch renders no test-protocol
    // block either — the channels never blur.
    expect(withoutChannel).not.toContain("Test execution protocol")
  })

  test("the subtask and stream prompts carry the protocol beside their Verification line", () => {
    const subtask = renderSubtask(lanes, views.plan, views.task, docs, "write the execution logic", { index: 2, testByDriver: true })
    expect(subtask.indexOf("Test lanes")).toBeGreaterThan(subtask.indexOf("Verification: run the checks that target this subtask's own changes"))
    expect(subtask).toContain("docs/T-002/testplan.md")
    expect(subtask).toContain("never both channels running the anchor")
    const stream = renderFanout(lanes, views.plan, views.task, docs, "write the execution logic: src/exec.ts Depends: S01 Artifacts: src/exec.ts", 2, { siblings: ["S01 write the schema part (done)"] })
    expect(stream.indexOf("Test lanes")).toBeGreaterThan(stream.indexOf("Verification: run the checks that target this stream's own changes"))
    expect(stream).toContain("docs/T-002/testhands/")
    // The stream render carries no driver channel (fanout never renders the
    // test protocol), so no channel clause.
    expect(stream).not.toContain("both channels running the anchor")
  })

  test("the wrap-up charter accepts inspected receipts only under a lane table (0083's principle: judged, never re-run)", () => {
    // The charter's verify item rides the pack's result-line subsection
    // (0083 D6), so the clause's pack carries both sections.
    const wrapLanes: PromptFacts = {
      ...plain,
      pack: parseIntentFile("default", `# default\n\n## quality\n\n### test-lanes\n\n${ROWS}\n\n## acceptance\n\n### result-line\n\nWrite the line when this task asked you to check work.\n`),
    }
    const withLanes = renderWrapup(wrapLanes, views.plan, views.task, docs, {})
    expect(withLanes).toContain("a green lane receipt under docs/T-002/testhands/ counts as evidence of such a run — inspect the receipt, never re-run its lane")
    for (const text of [renderWrapup(plain, views.plan, views.task, docs, {}), renderWrapup(plain, views.plan, views.task, docs, { solo: true })]) {
      expect(text).not.toContain("testhands")
      expect(text).not.toContain("receipt")
    }
  })

  test("the floor: without the pack section every execution render stays free of the lane anchors", () => {
    for (const text of [
      renderWhole(plain, views.plan, views.task, docs, { ondemand: true, budget: true, adaptive: true, testByDriver: true }),
      renderSubtask(plain, views.plan, views.task, docs, "write the execution logic", { index: 2, testByDriver: true }),
      renderFanout(plain, views.plan, views.task, docs, "write the execution logic", 2, { siblings: ["S01 write the schema part (done)"] }),
    ]) {
      expect(text).not.toContain("Test lanes")
      expect(text).not.toContain("testplan.md")
      expect(text).not.toContain("testhands")
    }
  })
})

// —— Stage 3, the driver's half (plans/0096 D5) ——

// A receipt as the driver writes it (script.ts writeLaneReceipt): the three
// machine fields plus the times, the log path, the terminator.
const receipt = (over: Record<string, string> = {}) =>
  [
    "# Lane lint",
    "",
    `Lane: ${over.lane ?? "lint"}`,
    `Heads: ${over.heads ?? ".=abc1234"}`,
    "Start: 2026-10-15T10:00:00.000Z",
    `End: ${over.end ?? "2026-10-15T10:03:12.123Z"}`,
    `Verdict: ${over.verdict ?? "green"}`,
    ...(over.carried ? [`Carried: ${over.carried}`] : []),
    ...(over.carried ? [] : [`Log: ${over.log ?? "/tmp/opencode/T-001-lint-1.log"}`]),
    "",
    ...(over.verdict === "red" ? ["```", "the failure region's ends", "```", ""] : []),
    EOF_MARK,
    "",
  ].join("\n")

describe("the receipt parse (parseLaneReceipt — the driver reads its own receipts and the sessions' alike)", () => {
  test("parses the three machine fields; heads split per repository", () => {
    expect(parseLaneReceipt(receipt())).toEqual({
      lane: "lint",
      heads: [{ root: ".", sha: "abc1234" }],
      verdict: "green",
      end: "2026-10-15T10:03:12.123Z",
    })
    const nested = parseLaneReceipt(receipt({ heads: ".=abc1234; sub/deep=def9" }))
    expect(nested?.heads).toEqual([
      { root: ".", sha: "abc1234" },
      { root: "sub/deep", sha: "def9" },
    ])
  })

  test("a red receipt parses red; an empty Heads value parses headless (carry refuses it later)", () => {
    expect(parseLaneReceipt(receipt({ verdict: "red" }))?.verdict).toBe("red")
    expect(parseLaneReceipt(receipt({ heads: "" }))?.heads).toEqual([])
  })

  test("unparsable receipts are absent: a lane without a readable green receipt re-runs", () => {
    expect(parseLaneReceipt("prose the session wrote with no fields\n")).toBeUndefined()
    expect(parseLaneReceipt(receipt({ verdict: "yellow" }))).toBeUndefined()
    expect(parseLaneReceipt(receipt({ heads: "no-sha-here" }))).toBeUndefined()
    expect(parseLaneReceipt("Lane: lint\nHeads: .=abc1234\nVerdict: green")).toEqual({
      lane: "lint",
      heads: [{ root: ".", sha: "abc1234" }],
      verdict: "green",
    })
  })
})

describe("carry-forward's intersection (laneTouches — the Touches discipline)", () => {
  test("a directory surface contains every path inside it; file surfaces match themselves only", () => {
    expect(laneTouches(["src/"], ["src/a.ts", "README.md"])).toBe(true)
    expect(laneTouches(["src/"], ["test/a.ts"])).toBe(false)
    expect(laneTouches(["src/dma/"], ["src/dma/x/y.c"])).toBe(true)
    expect(laneTouches(["src/dma/"], ["src/other/x.c"])).toBe(false)
    expect(laneTouches(["src/a.ts"], ["src/a.ts"])).toBe(true)
    expect(laneTouches(["src/a.ts"], ["src/b.ts"])).toBe(false)
    expect(laneTouches(["src/"], [])).toBe(false)
  })
})

describe("the anchor resolution (acceptanceSection / anchorLaneOf — the smallest honest rule)", () => {
  const lanes: TestLane[] = [
    { name: "lint", command: "make lint", cost: "cheap", surfaces: ["src/"], exclusive: false },
    { name: "gate", command: "./gate.sh", cost: "anchor", surfaces: ["src/"], exclusive: true },
  ]
  const body = (acceptance: string) => ["## Goal", "", "g", "", "## Scope", "", "s", "", "## Acceptance", "", acceptance, ""].join("\n")

  test("the section the acceptance names is extracted to the next heading", () => {
    expect(acceptanceSection(body("The gate lane is green."))).toBe("The gate lane is green.")
    expect(acceptanceSection(`${body("The gate lane is green.")}## After\nmore\n`)).toBe("The gate lane is green.")
    expect(acceptanceSection("## Goal\n\ng\n\n## Scope\n\ns\n")).toBe("")
  })

  test("exactly one name in the acceptance resolves the anchor — a cheap row named wins over the cost fallback", () => {
    expect(anchorLaneOf("The gate lane is green over the migrated widget.", lanes)).toBe(lanes[1])
    expect(anchorLaneOf("The lint lane and the gate lane must both pass.", lanes)).toBeUndefined()
    // Word boundaries: a longer word embedding the name does not name it, so
    // the fallback decides (exactly one anchor-cost row → it).
    expect(anchorLaneOf("the relint step is green", lanes)).toBe(lanes[1])
  })

  test("no name falls back to the table's anchor-cost rows when exactly one exists, else no pre-gate", () => {
    expect(anchorLaneOf("The acceptance criteria pass.", lanes)).toBe(lanes[1])
    const two: TestLane[] = [lanes[0]!, lanes[1]!, { name: "gate2", command: "./gate2.sh", cost: "anchor", surfaces: ["src/"], exclusive: false }]
    expect(anchorLaneOf("The acceptance criteria pass.", two)).toBeUndefined()
    const cheapOnly: TestLane[] = [lanes[0]!]
    expect(anchorLaneOf("The acceptance criteria pass.", cheapOnly)).toBeUndefined()
  })

  test("a regression-cost row never resolves the anchor (plans/0098 D1) — named or as the fallback", () => {
    const withRegression: TestLane[] = [lanes[0]!, { name: "regress", command: "bash test/verify_full.sh", cost: "regression", surfaces: ["src/"], exclusive: true }]
    // The regression row is the only non-cheap row and is even named — still
    // no anchor: it never runs per task, so it cannot pre-gate one.
    expect(anchorLaneOf("The regress lane is green at the phase's final tree.", withRegression)).toBeUndefined()
    expect(anchorLaneOf("The acceptance criteria pass.", withRegression)).toBeUndefined()
    // Beside a real anchor row, naming the regression row alone leaves the
    // anchor-cost fallback to decide.
    const both: TestLane[] = [...withRegression, lanes[1]!]
    expect(anchorLaneOf("The regress receipt is round-scoped evidence.", both)).toBe(lanes[1])
  })
})

describe("exclusivity serialization (laneBatches — the set's schedule)", () => {
  const lane = (name: string, exclusive: boolean): TestLane => ({ name, command: name, cost: "cheap", surfaces: ["src/"], exclusive })

  test("the non-exclusive lanes share one concurrent batch, each exclusive lane then runs alone in table order", () => {
    expect(laneBatches([lane("x", true), lane("y", false), lane("z", false)])).toEqual([
      [lane("y", false), lane("z", false)],
      [lane("x", true)],
    ])
    expect(laneBatches([lane("a", true), lane("b", true)])).toEqual([[lane("a", true)], [lane("b", true)]])
    expect(laneBatches([lane("y", false)])).toEqual([[lane("y", false)]])
    expect(laneBatches([])).toEqual([])
  })
})

describe("runTestLanes (the driver-run lane set over real repositories)", () => {
  // Lane factories over a marker file outside the repository (the tree stays
  // exactly what the receipts' recorded HEADs vouch for) and a private log
  // directory (production writes /tmp/opencode; tests stay self-contained).
  const markers = () => {
    const scratch = mkdtempSync(join(tmpdir(), "auto-lane-marks-"))
    return { scratch, file: join(scratch, "marks.txt") }
  }
  const lane = (over: Partial<TestLane> & { name: string }): TestLane => ({
    command: `echo ${over.name} >> <mark>`,
    cost: "cheap",
    surfaces: ["src/"],
    exclusive: false,
    ...over,
  })
  const withMark = (lanes: TestLane[], file: string): TestLane[] => lanes.map((l) => ({ ...l, command: l.command.replace("<mark>", file) }))
  const marks = async (file: string) => (await Bun.file(file).text().catch(() => "")).split("\n").filter(Boolean)
  const clean = (paths: string[]) => {
    for (const path of paths) rmSync(path, { recursive: true, force: true })
  }

  test("cheap lanes run as parallel processes, the anchor once they green; receipts land and parse back", async () => {
    const dir = await freshRepo()
    const logDir = mkdtempSync(join(tmpdir(), "auto-lane-logs-"))
    const { scratch, file } = markers()
    try {
      writeFileSync(join(dir, "src.ts"), "// baseline\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      const lanes = withMark([lane({ name: "lint" }), lane({ name: "fmt" }), lane({ name: "gate", cost: "anchor" })], file)
      const result = await runTestLanes(dir, "T-001", lanes, { logDir })
      expect(result.violation).toBeUndefined()
      expect(result.runs.map((run) => [run.lane, run.verdict])).toEqual([
        ["lint", "green"],
        ["fmt", "green"],
        ["gate", "green"],
      ])
      // The anchor launched only once the cheap tier greened: its marker
      // follows both cheap markers.
      const seen = await marks(file)
      expect(seen.filter((m) => m === "lint" || m === "fmt")).toHaveLength(2)
      expect(seen.indexOf("gate")).toBe(2)
      // Receipts: the partial's format, the recorded HEADs at the frozen
      // tree, the terminator — and parseLaneReceipt reads them back.
      const head = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      for (const name of ["lint", "fmt", "gate"]) {
        const text = await Bun.file(join(dir, laneReceiptDoc("T-001", name))).text()
        expect(text.trimEnd().endsWith(EOF_MARK)).toBe(true)
        const parsed = parseLaneReceipt(text)
        expect(parsed?.lane).toBe(name)
        expect(parsed?.verdict).toBe("green")
        expect(parsed?.heads).toEqual([{ root: ".", sha: head }])
        expect(parsed?.end).toBeTruthy()
      }
      expect(result.runs.every((run) => run.log.startsWith(logDir))).toBe(true)
    } finally {
      clean([dir, scratch, logDir])
    }
  })

  test("carry-forward over the recorded HEADs: a surface intersect re-runs, an untouched lane carries — across tasks", async () => {
    const dir = await freshRepo()
    const logDir = mkdtempSync(join(tmpdir(), "auto-lane-logs-"))
    const { scratch, file } = markers()
    try {
      mkdirSync(join(dir, "src"), { recursive: true })
      mkdirSync(join(dir, "include"), { recursive: true })
      writeFileSync(join(dir, "src", "a.ts"), "// a\n")
      writeFileSync(join(dir, "include", "i.h"), "// i\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      const table = () => withMark([lane({ name: "lint", surfaces: ["src/"] }), lane({ name: "hdr", surfaces: ["include/"] })], file)
      // T-001 establishes the green receipts; committing them advances HEAD
      // (the receipts' recorded tree is the pre-run one).
      const first = await runTestLanes(dir, "T-001", table(), { logDir })
      expect(first.runs.every((run) => run.verdict === "green" && !run.carried)).toBe(true)
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "T-001 receipts")
      // T-002: the include/ tree moved — lint carries from T-001's receipt
      // (no launch), hdr re-runs.
      writeFileSync(join(dir, "include", "i.h"), "// i changed\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "header change")
      const second = await runTestLanes(dir, "T-002", table(), { logDir })
      expect(second.runs.find((run) => run.lane === "lint")).toMatchObject({ verdict: "green", carried: laneReceiptDoc("T-001", "lint") })
      expect(second.runs.find((run) => run.lane === "hdr")?.carried).toBeUndefined()
      // The carry receipt records the current tree and names its source.
      const carryText = await Bun.file(join(dir, laneReceiptDoc("T-002", "lint"))).text()
      expect(carryText).toContain(`Carried: ${laneReceiptDoc("T-001", "lint")}`)
      const head = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      expect(parseLaneReceipt(carryText)?.heads).toEqual([{ root: ".", sha: head }])
      // T-003: the src/ tree moved — lint re-runs; hdr carries from its
      // newest green receipt (T-002's own run).
      writeFileSync(join(dir, "src", "a.ts"), "// a changed\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "source change")
      const third = await runTestLanes(dir, "T-003", table(), { logDir })
      expect(third.runs.find((run) => run.lane === "lint")?.carried).toBeUndefined()
      expect(third.runs.find((run) => run.lane === "hdr")?.carried).toBe(laneReceiptDoc("T-002", "hdr"))
      const seen = await marks(file)
      expect(seen.filter((m) => m === "lint")).toHaveLength(2)
      expect(seen.filter((m) => m === "hdr")).toHaveLength(2)
    } finally {
      clean([dir, scratch, logDir])
    }
  })

  test("a red cheap lane withholds the anchor (cheap-first); its red receipt carries the bounded evidence", async () => {
    const dir = await freshRepo()
    const logDir = mkdtempSync(join(tmpdir(), "auto-lane-logs-"))
    const { scratch, file } = markers()
    try {
      writeFileSync(join(dir, "src.ts"), "// baseline\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      const lanes = [
        { name: "lint", command: "echo 'the widget fails lint' >&2; exit 2", cost: "cheap" as const, surfaces: ["src/"], exclusive: false },
        lane({ name: "gate", cost: "anchor" }),
      ]
      const result = await runTestLanes(dir, "T-001", withMark(lanes, file), { logDir })
      expect(result.runs).toHaveLength(1)
      expect(result.runs[0]).toMatchObject({ lane: "lint", verdict: "red", code: 2 })
      // The anchor never launched: no marker, no receipt.
      expect(await marks(file)).toEqual([])
      expect(existsSync(join(dir, laneReceiptDoc("T-001", "gate")))).toBe(false)
      const text = await Bun.file(join(dir, laneReceiptDoc("T-001", "lint"))).text()
      expect(parseLaneReceipt(text)?.verdict).toBe("red")
      expect(text).toContain("the widget fails lint")
      expect(text).toContain("Log: ")
      expect(text.trimEnd().endsWith(EOF_MARK)).toBe(true)
    } finally {
      clean([dir, scratch, logDir])
    }
  })

  test("an exclusive lane runs alone: it launches only after the whole shared batch exited", async () => {
    const dir = await freshRepo()
    const logDir = mkdtempSync(join(tmpdir(), "auto-lane-logs-"))
    const { scratch, file } = markers()
    try {
      await git(dir, "commit", "--allow-empty", "-qm", "init")
      const lanes = withMark(
        [
          { name: "wide", command: `echo wide-start >> ${file}; sleep 0.2; echo wide-end >> ${file}`, cost: "cheap" as const, surfaces: ["src/"], exclusive: false },
          lane({ name: "solo", exclusive: true }),
        ],
        file,
      )
      const result = await runTestLanes(dir, "T-001", lanes, { logDir })
      expect(result.runs.every((run) => run.verdict === "green")).toBe(true)
      // The schedule's visible effect: the shared batch's end marker precedes
      // the exclusive lane's — nothing else in flight while it runs.
      const seen = await marks(file)
      expect(seen[seen.length - 1]).toBe("solo")
      expect(seen.indexOf("wide-end")).toBeLessThan(seen.indexOf("solo"))
    } finally {
      clean([dir, scratch, logDir])
    }
  })

  test("the set-level stash guard: tracked mutations restored after every lane exited, a moved HEAD reported", async () => {
    const dir = await freshRepo()
    const logDir = mkdtempSync(join(tmpdir(), "auto-lane-logs-"))
    try {
      writeFileSync(join(dir, "src.ts"), "// baseline\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      const mutate: TestLane[] = [{ name: "mut", command: "echo broken >> src.ts", cost: "cheap", surfaces: ["src/"], exclusive: false }]
      const restored = await runTestLanes(dir, "T-001", mutate, { logDir })
      expect(restored.violation).toEqual({ kind: "tracked", restored: ["src.ts"], unrestorable: [] })
      expect(await Bun.file(join(dir, "src.ts")).text()).toBe("// baseline\n")
      // A lane that moves HEAD: the corrupted-baseline family, no auto-undo.
      const commit: TestLane[] = [{ name: "sneaky", command: "git commit --allow-empty -qm sneaky", cost: "cheap", surfaces: ["src/"], exclusive: false }]
      const moved = await runTestLanes(dir, "T-001", commit, { logDir })
      expect(moved.violation?.kind).toBe("head")
    } finally {
      clean([dir, logDir])
    }
  })

  test("the watchdog kills a silent lane as red (the runScript discipline over the set)", async () => {
    const dir = await freshRepo()
    const logDir = mkdtempSync(join(tmpdir(), "auto-lane-logs-"))
    try {
      await git(dir, "commit", "--allow-empty", "-qm", "init")
      const hang: TestLane[] = [{ name: "hang", command: "sleep 5", cost: "cheap", surfaces: ["src/"], exclusive: false }]
      const result = await runTestLanes(dir, "T-001", hang, { logDir, idleMs: 150, pollMs: 30 })
      expect(result.runs[0]).toMatchObject({ lane: "hang", verdict: "red", code: 124, timedOut: true, timeoutReason: "idle" })
      const text = await Bun.file(join(dir, laneReceiptDoc("T-001", "hang"))).text()
      expect(text).toContain("killed by the watchdog")
    } finally {
      clean([dir, logDir])
    }
  })

  // The two-level pass's set-side half (plans/0098 D1): a regression-cost row
  // is the background slot's, never the wrap-up set's — filtered before any
  // launch, no receipt, no marker, the carry search untouched.
  test("a regression-cost row is filtered out of the wrap-up's lane set", async () => {
    const dir = await freshRepo()
    const logDir = mkdtempSync(join(tmpdir(), "auto-lane-logs-"))
    const { scratch, file } = markers()
    try {
      await git(dir, "commit", "--allow-empty", "-qm", "init")
      const lanes = withMark(
        [
          lane({ name: "lint" }),
          lane({ name: "regress", cost: "regression", command: "echo regress-ran >> <mark>; exit 0" }),
        ],
        file,
      )
      const result = await runTestLanes(dir, "T-001", lanes, { logDir })
      expect(result.runs.map((run) => run.lane)).toEqual(["lint"])
      expect(await marks(file)).toEqual(["lint"])
      expect(existsSync(join(dir, laneReceiptDoc("T-001", "regress")))).toBe(false)
    } finally {
      clean([dir, scratch, logDir])
    }
  })
})

describe("rangeChangedFiles (the recorded-HEADs diff carry reads)", () => {
  test("empty heads are unreadable (a headless receipt never carries); an unknown sha is unreadable too", async () => {
    const dir = await freshRepo()
    try {
      writeFileSync(join(dir, "a.ts"), "a\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      expect(await rangeChangedFiles(dir, [])).toBeUndefined()
      expect(await rangeChangedFiles(dir, [{ root: ".", sha: "deadbee" }])).toBeUndefined()
      const head = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      expect(await rangeChangedFiles(dir, [{ root: ".", sha: head }])).toEqual([])
      writeFileSync(join(dir, "b.ts"), "b\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "b")
      expect(await rangeChangedFiles(dir, [{ root: ".", sha: head }])).toEqual(["b.ts"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
