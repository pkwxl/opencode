// The close-audit unit's lifecycle (plans/0244 D5, enacting S4): the
// constructFormulation-pattern unit the close arms build when a round's
// close-due rows lack adjudication receipts and no audit phase produces
// them — construct (the terminal phase, exactly the due rows in the
// prompt), dispatch through the ordinary session pipeline (the loop
// fixture's fake agent, the same machinery `run` hands control to),
// verify (the `Result:` read, the wrap-up), commit, the red path's exit 2
// with the findings routed to the person, and the green path's baseline
// citation (the table stays the single memory — the cited cell moves
// mechanically). Both round kinds walk the whole road: the open round
// (0243 B's close arm) and the phased round (the terminal phase re-opened,
// completing again at its own boundary).
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ASSURANCE_DOC } from "../src/docpaths"
import { establishRound } from "../src/phases"
import { renderRoundBrief } from "../src/round-brief"
import { runTransfer } from "../src/transfer"
import { fakeAgent, type TurnScript } from "./fixtures/agent"
import { captureRun } from "./fixtures/capture"
import { artifactTurns, loopFixture, taskDoc, type LoopFixture } from "./fixtures/loop"

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

// The close-audit session's turn: the whole-task prompt over the unit's todo
// opens with the template's framing; the turn writes the findings document
// the prompt names — one section per due row it carries, the verdict the
// test chooses — then the composed artifactTurns take the wrap-up report.
const closeAuditTurn =
  (dir: string, result: "PASS" | "FAIL"): TurnScript =>
  (ctx) => {
    if (!ctx.text.includes("close-due assurance rows")) return undefined
    const id = /docs\/(T-\d{3})\/findings\.md/.exec(ctx.text)?.[1]
    const rows = [...ctx.text.matchAll(/^- (S-\d+) \(/gm)].map((match) => match[1]!)
    if (!id || !rows.length) return undefined
    write(
      dir,
      join("docs", id, "findings.md"),
      [
        `# Findings (${id})`,
        "",
        ...rows.map((row) => [`## ${row} — the adjudicated row`, "", `The round's delta raises nothing on this surface; the invariant holds first-hand.`, ""].join("\n")),
        result === "PASS" ? "Result: PASS" : "Result: FAIL the row does not hold at the closing tree",
        "",
      ].join("\n"),
    )
    return undefined
  }

// The completed unit's close-out the wrap-up path performs (the report the
// verification session writes rides artifactTurns); seeded here as one done
// task of the closing round, the state past a first fix's run. The agent
// contract the advance's full preflight demands rides the work commit (the
// setup commit stays the round's G1 anchor, so the delta measures the
// round's work — never the establishment).
async function seedDoneTask(f: LoopFixture) {
  write(f.dir, join(".opencode", "agent", "auto.md"), "contract\n")
  const phase = await f.phase(0)
  write(f.dir, join(phase.dir, "tasks.md"), `# Tasks (R-01.P01)\n\n- [x] T-001 task T-001\n`)
  write(f.dir, "docs/T-001/done.md", taskDoc("T-001", "R-01.P01"))
}

async function fillClose(f: LoopFixture) {
  const brief = join(f.dir, "docs/R-01/round.md")
  const text = readFileSync(brief, "utf8")
  writeFileSync(brief, `${text.split("## Close")[0]!}## Close\n\n- The round's work is restated in the target's own docs; nothing accepted as lost.\n`)
}

describe("the close-audit unit (plans/0244 D5, S4)", () => {
  test("the open round's road: the close arm constructs the unit, run executes it through the ordinary pipeline, the green findings adjudicate, the baselines cite, the close lands", async () => {
    const f = await loopFixture("implement", (dir) => ({ turn: (ctx) => closeAuditTurn(dir, "PASS")(ctx) ?? artifactTurns(dir)(ctx)! }))
    fixtures.push(f)
    await establishRound(f.dir, { phases: "implement", open: { goal: "absorb fixes" } })
    await f.commit("round setup")
    await seedDoneTask(f)
    await fillClose(f)
    write(f.dir, ASSURANCE_DOC, table([S_CLOSE_DUE, S_ACCRUE]))
    await f.commit("task done, close intent, the table declared")
    // transfer: the open close arm refuses on the uncovered close-due row,
    // constructing the unit first (0243 D4's amendment).
    const refused = await capture(() => runTransfer(f.dir, { phases: "implement" }))
    expect(refused.code).toBe(2)
    expect(refused.lines.some((line) => line.includes("round R-01 does not pass its round-close checks, so the open round cannot close yet — nothing was closed"))).toBe(true)
    expect(refused.lines.some((line) => line.includes("✗ assurance cover set: S-20 (clean-room independence) is due at this close and uncovered"))).toBe(true)
    expect(refused.lines.some((line) => line.includes("✓ close-audit unit T-002 constructed in docs/R-01/P01-implement"))).toBe(true)
    // The constructed todo: the prompt copy (the registered template), the
    // due rows and only them, the delta, the findings path and the verdict
    // grammar — the ordinary whole-task session's single input.
    const todo = readFileSync(join(f.dir, "docs/T-002/todo.md"), "utf8")
    expect(todo).toContain("Close-audit: R-01")
    expect(todo).toContain("Decompose: whole")
    expect(todo).toContain("- S-20 (clean-room independence) — watched surface: crossing events; cadence: every-round; close: close-due")
    expect(todo).not.toContain("S-22 (interface parity)")
    expect(todo).toContain("docs/T-002/findings.md")
    expect(todo).toContain("`Result: PASS`")
    expect(todo).toContain("the round's measured delta (driver-measured)")
    // run (the ordinary pipeline): the close-audit session runs, the
    // findings land, the wrap-up verifies, the close-out commits — the
    // accrue row riding uncovered all the way.
    const ran = await f.run()
    expect(ran.code).toBe(0)
    expect(existsSync(join(f.dir, "docs/T-002/findings.md"))).toBe(true)
    expect(existsSync(join(f.dir, "docs/T-002/done.md"))).toBe(true)
    expect(readFileSync(join(f.dir, "docs/T-002/report.md"), "utf8")).toContain("Result: PASS")
    // The session's prompt carried the due rows verbatim (the unit scales
    // with the due set — nothing standing).
    const auditPrompt = f.agent.prompts.find((prompt) => prompt.text.includes("close-due assurance rows"))
    expect(auditPrompt?.text).toContain("- S-20 (clean-room independence)")
    expect(auditPrompt?.text).not.toContain("S-22")
    // transfer again: the findings adjudicate the row, the baseline citation
    // lands on its own commit, the open close completes.
    const closed = await capture(() => runTransfer(f.dir, { phases: "implement" }))
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
    const next = await capture(() => runTransfer(f.dir, { phases: "implement" }))
    expect(next.code).toBe(0)
    expect(next.lines.some((line) => line.includes("✓ round R-02 established"))).toBe(true)
    expect(next.lines.some((line) => line.includes("assurance baseline of S-20"))).toBe(false)
    expect(readFileSync(join(f.dir, ASSURANCE_DOC), "utf8")).toBe(cited)
  })

  test("the red path: a FAIL adjudication never covers — exit 2 with the findings routed to the person, never an in-round repair", async () => {
    const f = await loopFixture("implement", (dir) => ({ turn: (ctx) => closeAuditTurn(dir, "FAIL")(ctx) ?? artifactTurns(dir)(ctx)! }))
    fixtures.push(f)
    await establishRound(f.dir, { phases: "implement", open: { goal: "absorb fixes" } })
    await f.commit("round setup")
    await seedDoneTask(f)
    await fillClose(f)
    write(f.dir, ASSURANCE_DOC, table([S_CLOSE_DUE]))
    await f.commit("task done, close intent, the table declared")
    expect((await capture(() => runTransfer(f.dir, { phases: "implement" }))).code).toBe(2)
    // The unit runs and completes (its own work verified — the report
    // passes), but the FINDINGS' verdict is the row's adjudication: a FAIL
    // is a finding for the person, routed at the close.
    const ran = await f.run()
    expect(ran.code).toBe(0)
    expect(readFileSync(join(f.dir, "docs/T-002/findings.md"), "utf8")).toContain("Result: FAIL")
    expect(existsSync(join(f.dir, "docs/T-002/done.md"))).toBe(true)
    const held = await capture(() => runTransfer(f.dir, { phases: "implement" }))
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
    const f = await loopFixture("implement", (dir) => ({ turn: (ctx) => closeAuditTurn(dir, "PASS")(ctx) ?? artifactTurns(dir)(ctx)! }))
    fixtures.push(f)
    await establishRound(f.dir, { phases: "implement" })
    await f.commit("round setup")
    await seedDoneTask(f)
    write(f.dir, "docs/R-01/round.md", renderRoundBrief(1).replace("## Close", "## Close\n\n- Everything restated into the target's own docs; nothing accepted as lost."))
    write(f.dir, ASSURANCE_DOC, table([S_CLOSE_DUE, S_ACCRUE]))
    await f.commit("phase done, the table declared")
    const host = { client: f.agent.client, syncContext: async () => {}, restart: async () => false, close: () => {} }
    // The advance (transfer's close arm inside the loop): the distillation
    // closes the phase, the checks find the uncovered close-due row, the
    // unit is constructed in the re-opened terminal phase, exit 2.
    const refused = await capture(() => runTransfer(f.dir, { managed: host, phases: "implement" }))
    expect(refused.code).toBe(2)
    expect(refused.lines.some((line) => line.includes("✓ close-audit unit T-002 constructed in docs/R-01/P01-implement"))).toBe(true)
    expect(refused.lines.some((line) => line.includes("the terminal phase P01-implement Implementation re-opened for it"))).toBe(true)
    expect(readFileSync(join(f.dir, "docs/R-01/phases.md"), "utf8").trimEnd().endsWith("- [ ] P01 implement")).toBe(true)
    // run: the ordinary pipeline executes the unit and stops at the phase
    // boundary (plans/0101 D1 — the distillation and the completion belong
    // to the advance); the unit's findings and close-out have landed.
    const ran = await f.run()
    expect(ran.code).toBe(0)
    expect(readFileSync(join(f.dir, "docs/T-002/findings.md"), "utf8")).toContain("Result: PASS")
    expect(existsSync(join(f.dir, "docs/T-002/done.md"))).toBe(true)
    // The next advance lands the close: the phase completes again at its own
    // boundary (the distillation re-runs, the index re-ticks), the
    // adjudication covers, the baseline cited, the review stop the person's
    // close moment.
    const closed = await capture(() => runTransfer(f.dir, { managed: host, phases: "implement" }))
    expect(closed.code).toBe(0)
    expect(readFileSync(join(f.dir, "docs/R-01/phases.md"), "utf8").trimEnd().endsWith("- [x] P01 implement")).toBe(true)
    expect(existsSync(join(f.dir, "docs/R-01/P01-implement/handover.md"))).toBe(true)
    expect(closed.lines.some((line) => line.includes("✓ round close checks passed"))).toBe(true)
    expect(closed.lines.some((line) => line.startsWith("✓ assurance baseline of S-20 cited to R-01 audit @"))).toBe(true)
    expect(closed.lines.some((line) => line.includes("next: review round R-01's close"))).toBe(true)
    expect((await f.git("status", "--porcelain")).trim()).toBe("")
    // The no-table floor beside the whole road: the same phased state with
    // no docs/assurance.md closes with no unit, no citation — today's bytes.
    const bare = await loopFixture("implement", (dir) => ({ turn: artifactTurns(dir) }))
    fixtures.push(bare)
    await establishRound(bare.dir, { phases: "implement" })
    await bare.commit("round setup")
    await seedDoneTask(bare)
    write(bare.dir, "docs/R-01/round.md", renderRoundBrief(1).replace("## Close", "## Close\n\n- Everything restated; nothing lost."))
    await bare.commit("phase done")
    const plain = await capture(() => runTransfer(bare.dir, { managed: { client: bare.agent.client, syncContext: async () => {}, restart: async () => false, close: () => {} }, phases: "implement" }))
    expect(plain.code).toBe(0)
    expect(plain.lines.some((line) => line.includes("close-audit"))).toBe(false)
    expect(plain.lines.some((line) => line.includes("assurance"))).toBe(false)
  })

  test("a round carrying an audit phase constructs no unit — the remedy names the audit phase's findings (D5's shape key)", async () => {
    const f = await loopFixture("implement,audit", (dir) => ({ turn: artifactTurns(dir) }))
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
    await f.commit("phases done, the table declared")
    const host = { client: f.agent.client, syncContext: async () => {}, restart: async () => false, close: () => {} }
    const refused = await capture(() => runTransfer(f.dir, { managed: host, phases: "implement,audit" }))
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
