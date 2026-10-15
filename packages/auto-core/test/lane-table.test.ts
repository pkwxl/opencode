// The test-lane table (plans/0096 D3/D4, Stage 2): the intent pack's optional
// `### test-lanes` subsection — the project's declared suite table (one field
// block per suite: name, command, cost class, surfaces, exclusivity), parsed
// strictly, resolved per project, and rendered into the execution prompts
// beside the self-checks with the channel clause. Stage 3's driver-side
// extensions (the carry-forward intersection, exclusivity serialization, the
// anchor pre-gate) land in this file beside these cases.
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadIntents, parseIntentFile, resolveIntent } from "../src/intent/load"
import { parseTestLanes, testLanesProblem } from "../src/intent/test-lanes"
import { DEFAULT_INTENT } from "../src/intent/types"
import { taskDocPaths } from "../src/docpaths"
import { promptFacts } from "../src/prompt-facts"
import { renderFanout, renderSubtask, renderWhole, renderWrapup, type PromptFacts } from "../src/prompt"
import { promptViews } from "../src/tasks"
import { plan, task } from "./fixtures/prompt"

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

  test("malformed rows fail strictly, naming the pack and the offending line", () => {
    const cases: Array<[string, RegExp]> = [
      ["lint: make lint\nCommand: make lint\nCost: cheap\nSurfaces: src/\nExclusive: no", /malformed test-lanes line: lint: make lint/],
      ["Lint:\nCommand: x\nCost: cheap\nSurfaces: src/\nExclusive: no", /malformed test-lanes line: Lint:/],
      ["Command: make lint", /malformed test-lanes line: Command: make lint/],
      ["lint:\nRunner: make lint\nCost: cheap\nSurfaces: src/\nExclusive: no", /malformed test-lanes line: Runner: make lint/],
      ["lint:\nCommand: make lint\nCost: quick\nSurfaces: src/\nExclusive: no", /suite "lint" Cost must be cheap or anchor, got: quick/],
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
