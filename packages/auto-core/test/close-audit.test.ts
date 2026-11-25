// The close-audit unit's lifecycle (plans/0244 D5, enacting S4): the
// constructFormulation-pattern unit the close arms build when a round's
// close-due rows lack adjudication receipts and no audit phase produces
// them — construct (the terminal phase, exactly the due rows in the
// brief), the unit's work over the executor protocol (the audit share
// landing the findings, the verify share closing the unit — the task
// loop's dispatch retired, plans/0314), commit, the red path's exit 2
// with the findings routed to the person, and the green path's baseline
// citation (the table stays the single memory — the cited cell moves
// mechanically). Both round kinds walk the whole road: the open round
// (0243 B's close arm) and the phased round (the terminal phase re-opened,
// completing again at its own boundary).
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ASSURANCE_DOC } from "../src/docpaths"
import { CONFIG_FILE } from "../src/config"
import { establishRound } from "../src/phases"
import { renderRoundBrief } from "../src/round-brief"
import { transferDeterministic } from "../src/transfer"
import { openExecutorCoordinator } from "../src/executor-coordinator"
import { readExecutorPreview } from "../src/executor-steps"
import { EOF_MARK } from "../src/doccheck"
import { captureRun } from "./fixtures/capture"
import { loopFixture, phaseHandover, taskDoc, type LoopFixture } from "./fixtures/loop"

const capture = captureRun

const fixtures: LoopFixture[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture.dir, { recursive: true, force: true })
})

const HEADER = "| id | invariant | kind | watched surface | cadence | close | baseline |"
const SEPARATOR = "| --- | --- | --- | --- | --- | --- | --- |"
const table = (rows: readonly string[]) => [`# Assurance`, ``, HEADER, SEPARATOR, ...rows].join("\n")
// The due set this suite walks: one close-due judgment row (the unit's own
// adjudication) and one accrue row (uncovered, never blocking — S3's
// observation records the accrual). Synthetic ids and paths (P16).
const S_CLOSE_DUE = "| S-20 | clean-room independence | judgment | crossing events | every-round | close-due |  |"
const S_ACCRUE = "| S-22 | interface parity | mechanical | include | every-round | accrue |  |"

const write = (dir: string, rel: string, text: string) => {
  mkdirSync(join(dir, rel, ".."), { recursive: true })
  writeFileSync(join(dir, rel), text)
}

// One completed task of the closing round, seeded by hand (the task loop
// retired, plans/0314) — the state past the round's work. The agent contract
// the close's checks read rides the work commit (the setup commit stays the
// round's G1 anchor, so the delta measures the round's work — never the
// establishment).
async function seedDoneTask(f: LoopFixture) {
  write(f.dir, join(".opencode", "agent", "auto.md"), "contract\n")
  const phase = await f.phase(0)
  write(f.dir, join(phase.dir, "tasks.md"), `# Tasks (R-01.P01)\n\n- [x] T-001 task T-001\n`)
  write(f.dir, "docs/T-001/done.md", taskDoc("T-001", "R-01.P01"))
}

// The unit's work over the executor protocol (the audit suite's own
// lifecycle, executor-audit.test.ts): the brief names the unit and its due
// rows; the audit share lands the findings document — one section per due
// row the todo carries, the verdict this test chooses — and the verify
// share closes the unit on a passing report (the report the push pipeline's
// wrap-up session wrote).
async function auditUnit(f: LoopFixture, unit: string, result: "PASS" | "FAIL"): Promise<string> {
  const preview = await readExecutorPreview(f.dir)
  if (preview.kind !== "audit") throw new Error(JSON.stringify(preview))
  expect(preview.unit).toBe(unit)
  // The brief carried the due rows the unit's todo carries, verbatim (the
  // unit scales with the due set — nothing standing).
  const todo = readFileSync(join(f.dir, "docs", unit, "todo.md"), "utf8")
  const rows = [...todo.matchAll(/^- (S-\d+) \(/gm)].map((match) => match[1]!)
  expect(rows.length).toBeGreaterThan(0)
  for (const row of rows) expect(preview.prompt).toContain(`- ${row} (`)
  const coordinator = await openExecutorCoordinator(f.dir)
  try {
    // The audit share: claimed on the clean tree, the findings written
    // inside the lease — one section per due row, the verdict this test
    // chooses — and landed.
    const auditor = { token: "auditor", channel: "solo" }
    const grant = await coordinator.claim(auditor, unit, "audit")
    if (grant.kind !== "audit") throw new Error(JSON.stringify(grant))
    expect(grant.findings).toBe(preview.findings)
    await Bun.write(
      join(f.dir, grant.findings),
      [
        `# Findings (${unit})`,
        "",
        ...rows.map((row) => [`## ${row} — the adjudicated row`, "", "The round's delta raises nothing on this surface; the invariant holds first-hand.", ""].join("\n")),
        result === "PASS" ? "Result: PASS" : "Result: FAIL the row does not hold at the closing tree",
        "",
      ].join("\n"),
    )
    expect(await coordinator.report(auditor, grant.id, grant.lease, "ended")).toMatchObject({ kind: "landed" })
    // The verify share closes the unit on a passing report (the report the
    // push pipeline's wrap-up session wrote).
    const verifier = { token: "verifier", channel: "verify" }
    const verify = await coordinator.claim(verifier)
    if (verify.kind !== "verify") throw new Error(JSON.stringify(verify))
    await Bun.write(
      join(f.dir, "docs", unit, "report.md"),
      [
        `# Verification (${unit})`,
        "",
        "The findings document carries one section per due row, its verdict line last, and the adjudication cites what it examined.",
        "",
        "Result: PASS",
        "",
        EOF_MARK,
        "",
      ].join("\n"),
    )
    expect(await coordinator.report(verifier, verify.id, verify.lease, "ended")).toMatchObject({ kind: "landed", verdict: "pass" })
  } finally {
    await coordinator.close()
  }
  return preview.prompt
}

async function fillClose(f: LoopFixture) {
  const brief = join(f.dir, "docs/R-01/round.md")
  const text = readFileSync(brief, "utf8")
  writeFileSync(brief, `${text.split("## Close")[0]!}## Close\n\n- The round's work is restated in the target's own docs; nothing accepted as lost.\n`)
}

describe("the close-audit unit (plans/0244 D5, S4)", () => {
  test("the open round's road: the close arm constructs the unit, its audit share adjudicates green, the baselines cite, the close lands", async () => {
    const f = await loopFixture("implement")
    fixtures.push(f)
    await establishRound(f.dir, { phases: "implement", open: { goal: "absorb fixes" } })
    // The project config the executor coordinator requires (init's write).
    await Bun.write(join(f.dir, CONFIG_FILE), JSON.stringify({ phases: "implement", subtask: "off" }))
    await f.commit("round setup")
    await seedDoneTask(f)
    await fillClose(f)
    write(f.dir, ASSURANCE_DOC, table([S_CLOSE_DUE, S_ACCRUE]))
    await f.commit("task done, close intent, the table declared")
    // transfer: the open close arm refuses on the uncovered close-due row,
    // constructing the unit first (0243 D4's amendment).
    const refused = await capture(() => transferDeterministic(f.dir, { phases: "implement" }))
    expect(refused.code).toBe(2)
    expect(refused.lines.some((line) => line.includes("round R-01 does not pass its round-close checks, so the open round cannot close yet — nothing was closed"))).toBe(true)
    expect(refused.lines.some((line) => line.includes("✗ assurance cover set: S-20 (clean-room independence) is due at this close and uncovered"))).toBe(true)
    expect(refused.lines.some((line) => line.includes("✓ close-audit unit T-002 constructed in docs/R-01/P01-implement"))).toBe(true)
    // The constructed todo: the prompt copy (the registered template), the
    // due rows and only them, the delta, the findings path and the verdict
    // grammar — the unit's single input over the executor protocol.
    const todo = readFileSync(join(f.dir, "docs/T-002/todo.md"), "utf8")
    expect(todo).toContain("Close-audit: R-01")
    expect(todo).toContain("Decompose: whole")
    expect(todo).toContain("- S-20 (clean-room independence) — watched surface: crossing events; cadence: every-round; close: close-due")
    expect(todo).not.toContain("S-22 (interface parity)")
    expect(todo).toContain("docs/T-002/findings.md")
    expect(todo).toContain("`Result: PASS`")
    expect(todo).toContain("the round's measured delta (driver-measured)")
    // The unit's work: the audit share lands the findings, the verify share
    // closes the unit — the accrue row riding uncovered all the way.
    const brief = await auditUnit(f, "T-002", "PASS")
    expect(existsSync(join(f.dir, "docs/T-002/findings.md"))).toBe(true)
    expect(existsSync(join(f.dir, "docs/T-002/done.md"))).toBe(true)
    expect(readFileSync(join(f.dir, "docs/T-002/report.md"), "utf8")).toContain("Result: PASS")
    // The accrue row never reached the brief (the unit scales with the due
    // set — nothing standing).
    expect(brief).not.toContain("S-22")
    // transfer again: the findings adjudicate the row, the baseline citation
    // lands on its own commit, the open close completes.
    const closed = await capture(() => transferDeterministic(f.dir, { phases: "implement" }))
    expect(closed.code).toBe(0)
    expect(closed.lines.some((line) => line.includes("✓ open round R-01 closed"))).toBe(true)
    expect(closed.lines.some((line) => line.startsWith("✓ assurance baseline of S-20 cited to R-01 audit @"))).toBe(true)
    // The table stays the single memory: the cited cell moved, mechanically.
    const cited = readFileSync(join(f.dir, ASSURANCE_DOC), "utf8")
    const cell = /\| S-20 \|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\| (R-01 audit @[0-9a-f]+) \|/.exec(cited)
    expect(cell?.[1]).toBeDefined()
    expect(cited).toContain(S_ACCRUE)
    const subjects = (await f.git("log", "--format=%s")).split("\n")
    expect(subjects).toContain("PLAN close-audit baselines R-01")
    expect((await f.git("status", "--porcelain")).trim()).toBe("")
    // The following invocation is the ordinary shape 4 (no roadmap — the
    // config fallback opens R-02); the citation is idempotent (cited cells
    // write nothing, no second commit).
    const next = await capture(() => transferDeterministic(f.dir, { phases: "implement" }))
    expect(next.code).toBe(0)
    expect(next.lines.some((line) => line.includes("✓ round R-02 established"))).toBe(true)
    expect(next.lines.some((line) => line.includes("assurance baseline of S-20"))).toBe(false)
    expect(readFileSync(join(f.dir, ASSURANCE_DOC), "utf8")).toBe(cited)
  })

  test("the red path: a FAIL adjudication never covers — exit 2 with the findings routed to the person, never an in-round repair", async () => {
    const f = await loopFixture("implement")
    fixtures.push(f)
    await establishRound(f.dir, { phases: "implement", open: { goal: "absorb fixes" } })
    // The project config the executor coordinator requires (init's write).
    await Bun.write(join(f.dir, CONFIG_FILE), JSON.stringify({ phases: "implement", subtask: "off" }))
    await f.commit("round setup")
    await seedDoneTask(f)
    await fillClose(f)
    write(f.dir, ASSURANCE_DOC, table([S_CLOSE_DUE]))
    await f.commit("task done, close intent, the table declared")
    expect((await capture(() => transferDeterministic(f.dir, { phases: "implement" }))).code).toBe(2)
    // The unit's work lands and the unit completes (its own work verified —
    // the report passes), but the FINDINGS' verdict is the row's
    // adjudication: a FAIL is a finding for the person, routed at the close.
    await auditUnit(f, "T-002", "FAIL")
    expect(existsSync(join(f.dir, "docs/T-002/done.md"))).toBe(true)
    expect(readFileSync(join(f.dir, "docs/T-002/findings.md"), "utf8")).toContain("Result: FAIL")
    expect(existsSync(join(f.dir, "docs/T-002/done.md"))).toBe(true)
    const held = await capture(() => transferDeterministic(f.dir, { phases: "implement" }))
    expect(held.code).toBe(2)
    expect(held.lines.some((line) => line.includes("round R-01 does not pass its round-close checks, so the open round cannot close yet — nothing was closed"))).toBe(true)
    expect(
      held.lines.some(
        (line) =>
          line.includes("✗ assurance cover set: S-20 (clean-room independence) is due at this close and uncovered") &&
          line.includes("the close-audit unit T-002 already ran — its findings document is the adjudication to read (a FAIL is a finding for the person, never repaired in-round)"),
      ),
    ).toBe(true)
    // No second unit over the standing one, and no repair session ran after
    // the findings (the red path's discipline).
    expect(existsSync(join(f.dir, "docs/T-003"))).toBe(false)
    expect(existsSync(join(f.dir, "docs/R-01/P01-implement/done.md"))).toBe(false)
  })

  test("the phased round's road: the terminal phase re-opened, the unit executed, the phase completing again at its own boundary, the advance landing the close", async () => {
    const f = await loopFixture("implement")
    fixtures.push(f)
    await establishRound(f.dir, { phases: "implement" })
    // The project config the executor coordinator requires (init's write).
    await Bun.write(join(f.dir, CONFIG_FILE), JSON.stringify({ phases: "implement", subtask: "off" }))
    await f.commit("round setup")
    await seedDoneTask(f)
    write(f.dir, "docs/R-01/round.md", renderRoundBrief(1).replace("## Close", "## Close\n\n- Everything restated into the target's own docs; nothing accepted as lost."))
    write(f.dir, ASSURANCE_DOC, table([S_CLOSE_DUE, S_ACCRUE]))
    const phase = await f.phase(0)
    write(f.dir, join(phase.dir, "handover.md"), phaseHandover(phase.dir))
    await f.commit("phase done, the table declared")
    // Transfer closes the phase, then the uncovered row requires a
    // close-audit unit in the re-opened terminal phase.
    const refused = await capture(() => transferDeterministic(f.dir, { phases: "implement" }))
    expect(refused.code).toBe(2)
    expect(refused.lines.some((line) => line.includes("✓ close-audit unit T-002 constructed in docs/R-01/P01-implement"))).toBe(true)
    expect(refused.lines.some((line) => line.includes("the terminal phase P01-implement Implementation re-opened for it"))).toBe(true)
    expect(readFileSync(join(f.dir, "docs/R-01/phases.md"), "utf8").trimEnd().endsWith("- [ ] P01 implement")).toBe(true)
    // The unit's work lands over the executor protocol; the distillation
    // and the completion belong to the advance.
    await auditUnit(f, "T-002", "PASS")
    expect(readFileSync(join(f.dir, "docs/T-002/findings.md"), "utf8")).toContain("Result: PASS")
    expect(existsSync(join(f.dir, "docs/T-002/done.md"))).toBe(true)
    write(f.dir, join(phase.dir, "handover.md"), phaseHandover(phase.dir))
    await f.commit("distill audited phase")
    // Transfer applies the second handover, closes the phase, and cites the
    // adjudication in the assurance baseline.
    const closed = await capture(() => transferDeterministic(f.dir, { phases: "implement" }))
    expect(closed.code).toBe(0)
    expect(readFileSync(join(f.dir, "docs/R-01/phases.md"), "utf8").trimEnd().endsWith("- [x] P01 implement")).toBe(true)
    expect(existsSync(join(f.dir, "docs/R-01/P01-implement/handover.md"))).toBe(true)
    expect(closed.lines.some((line) => line.includes("✓ round close checks passed"))).toBe(true)
    expect(closed.lines.some((line) => line.startsWith("✓ assurance baseline of S-20 cited to R-01 audit @"))).toBe(true)
    expect(closed.lines.some((line) => line.includes("next: review round R-01's close"))).toBe(true)
    expect((await f.git("status", "--porcelain")).trim()).toBe("")
    // The no-table floor beside the whole road: the same phased state with
    // no docs/assurance.md closes with no unit, no citation — today's bytes.
    const bare = await loopFixture("implement")
    fixtures.push(bare)
    await establishRound(bare.dir, { phases: "implement" })
    await bare.commit("round setup")
    await seedDoneTask(bare)
    write(bare.dir, "docs/R-01/round.md", renderRoundBrief(1).replace("## Close", "## Close\n\n- Everything restated; nothing lost."))
    write(bare.dir, join(phase.dir, "handover.md"), phaseHandover(phase.dir))
    await bare.commit("phase done")
    const plain = await capture(() => transferDeterministic(bare.dir, { phases: "implement" }))
    expect(plain.code).toBe(0)
    expect(plain.lines.some((line) => line.includes("close-audit"))).toBe(false)
    expect(plain.lines.some((line) => line.includes("assurance"))).toBe(false)
  })

  test("a round carrying an audit phase constructs no unit — the remedy names the audit phase's findings (D5's shape key)", async () => {
    const f = await loopFixture("implement,audit")
    fixtures.push(f)
    // The audit type: a custom phase whose Task-artifacts declare the
    // findings document — the audit artifact grammar's own name, the data
    // the predicate reads (P16: no type id in code).
    write(
      f.dir,
      join(".opencode", "auto", "phases", "audit.md"),
      ["# Spec audit", "", "Task-artifacts: findings.md", "", "## plan duties", "", "Audit the dimensions.", "", "<!-- auto: eof -->", ""].join("\n"),
    )
    await establishRound(f.dir, { phases: "implement,audit" })
    // The project config the executor coordinator requires (init's write).
    await Bun.write(join(f.dir, CONFIG_FILE), JSON.stringify({ phases: "implement,audit", subtask: "off" }))
    await f.commit("round setup")
    write(f.dir, join(".opencode", "agent", "auto.md"), "contract\n")
    const implement = await f.phase(0)
    const audit = await f.phase(1)
    write(f.dir, join(implement.dir, "tasks.md"), `# Tasks (R-01.P01)\n\n- [x] T-001 task T-001\n`)
    write(f.dir, join(audit.dir, "tasks.md"), `# Tasks (R-01.P02)\n\n- [x] T-002 task T-002\n`)
    write(f.dir, "docs/T-001/done.md", taskDoc("T-001", "R-01.P01"))
    write(f.dir, "docs/T-002/done.md", taskDoc("T-002", "R-01.P02"))
    write(f.dir, "docs/R-01/round.md", renderRoundBrief(1).replace("## Close", "## Close\n\n- Everything restated; nothing lost."))
    write(f.dir, ASSURANCE_DOC, table([S_CLOSE_DUE]))
    for (const phase of [implement, audit]) write(f.dir, join(phase.dir, "handover.md"), phaseHandover(phase.dir))
    await f.commit("phases done, the table declared")
    const refused = await capture(() => transferDeterministic(f.dir, { phases: "implement,audit" }))
    expect(refused.code).toBe(2)
    // No unit: the round's audit phase is the findings' producer, and the
    // refusal teaches exactly that.
    expect(
      refused.lines.some(
        (line) =>
          line.includes("✗ assurance cover set: S-20 (clean-room independence) is due at this close and uncovered") &&
          line.endsWith("an adjudication receipt (an audit findings document naming S-20 with Result: PASS) covers it; the round's audit phase produces the findings"),
      ),
    ).toBe(true)
    expect(refused.lines.some((line) => line.includes("close-audit unit"))).toBe(false)
    expect(existsSync(join(f.dir, "docs/T-003"))).toBe(false)
  })

  test("the Close-audit marker is the driver's — a planned task carrying it is a collect problem (the 0171 D6 guard's twin)", async () => {
    const f = await loopFixture("implement")
    fixtures.push(f)
    await establishRound(f.dir, { phases: "implement" })
    const phase = await f.phase(0)
    write(f.dir, "docs/T-001/todo.md", taskDoc("T-001", "R-01.P01").replace(/^Phase: (.+)$/m, `Phase: $1\nClose-audit: R-01`))
    const { newTaskProblems } = await import("../src/tasks")
    const checked = await newTaskProblems(f.dir, { round: "R-01", id: "P01", dir: phase.dir }, "T-001", { before: new Set() })
    expect(checked.problems.some((problem) => problem.includes("carries a `Close-audit:` field") && problem.includes("the driver's marker of the round's close-audit unit (plans/0244 D5); remove the field line"))).toBe(true)
  })
})
