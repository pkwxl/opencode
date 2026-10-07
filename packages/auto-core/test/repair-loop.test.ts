// The bounded repair run option (plans/0079 §4), driven through the phase
// loop on the native fake agent over real git repositories: a task report's
// Result: FAIL with budget closes the failed task and appends rework over the
// report's evidence; a held verdict gate with budget appends repair tasks over
// the gate evidence and re-verifies; the exhausted budget (and no budget at
// all) blocks exactly as before. Every verdict the driver acts on is parsed
// from a file — the fake agent only writes documents.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { appendOneTask, artifactTurns, loopFixture, promptPhaseDir, type LoopFixture } from "./fixtures/loop"
import type { FakeAgentOptions, TurnScript } from "./fixtures/agent"
import { establishRound } from "../src/phases"

const made: LoopFixture[] = []
afterEach(() => {
  for (const fixture of made.splice(0)) rmSync(fixture.dir, { recursive: true, force: true })
})

async function fixture(phases: string, turn: (dir: string) => TurnScript): Promise<LoopFixture> {
  const f = await loopFixture(phases, (dir): FakeAgentOptions => ({ turn: turn(dir) }))
  made.push(f)
  await establishRound(f.dir, { phases })
  await f.commit("round setup")
  return f
}

// The repair-loop turn script: the artifact turns (planning and handover
// distillation) plus a wrap-up turn that writes each named task's verdict —
// FAIL for the ids in `failing` (the gap list, plans/0083 D3), PASS for
// everything else — the fix-round turns (each writes one line, so every fix
// round posts its own `T-NNN fix <round>` commit), plus the accepted
// append turn. The whole-task sessions settle on the fake agent's default.
const repairTurns = (failing: ReadonlySet<string>) => (dir: string): TurnScript => {
  const fixes = new Map<string, number>()
  return (ctx) => {
    if (ctx.text.includes("You are the fix session")) {
      const id = /docs\/(T-\d+)\/gaps\.md/.exec(ctx.text)?.[1]
      if (id) {
        const n = (fixes.get(id) ?? 0) + 1
        fixes.set(id, n)
        writeFileSync(join(dir, "FIXES.md"), `${id} fix round ${n}\n`)
      }
      return undefined
    }
    if (ctx.text.includes("only performs the wrap-up")) {
    const id = /docs\/(T-\d+)\/report\.md/.exec(ctx.text)?.[1]
    if (id) {
      mkdirSync(join(dir, "docs", id), { recursive: true })
      if (failing.has(id)) {
        // The verification loop's FAIL channel (plans/0083 D2/D3): no report
        // at all — the gap list instead, its closing result line the verdict,
        // no terminator. Every verify round of the failing task rewrites it;
        // the fix-round sessions take the default turn (nothing to write).
        writeFileSync(
          join(dir, "docs", id, "gaps.md"),
          [
            `# Gaps (${id})`,
            "",
            "## Verified OK",
            "",
            "- The wrap-up session inspected the work against the task's acceptance statements.",
            "",
            "## Gaps",
            "",
            "- The acceptance gap stands: the required behavior is not delivered (src/widget.ts).",
            "",
            "Result: FAIL the acceptance gap",
            "",
          ].join("\n"),
        )
      } else {
        writeFileSync(
          join(dir, "docs", id, "report.md"),
          [
            `# Report (${id})`,
            "",
            "The wrap-up session reviewed the work against the task's acceptance statements and",
            "recorded the verification evidence: what was delivered, where it lives, and how it",
            "was checked. The modules the task touched are listed with their outcomes.",
            "",
            "Result: PASS",
            "",
            "<!-- auto: eof -->",
            "",
          ].join("\n"),
        )
      }
    }
    return undefined
  }
  if (ctx.text.includes("## Input: the task index as it stands")) {
    const phaseDir = promptPhaseDir(ctx.text)
    if (phaseDir) appendOneTask(dir, phaseDir)
    return undefined
  }
  return artifactTurns(dir)(ctx)
  }
}

// The verdict-gate variant: every wrap-up passes, and each distillation of
// the acceptance phase writes the phase verdict beside the handover — FAIL on
// the first distillation, PASS after the repair round's tasks re-verified.
const gateTurns = () => (dir: string): TurnScript => {
  let distills = 0
  return (ctx) => {
    if (ctx.text.includes("You are the handover distiller")) {
      artifactTurns(dir)(ctx)
      const m = /docs\/(R-\d+\/P\d+-acceptance)\/handover\.md/.exec(ctx.text)
      if (m) {
        distills++
        writeFileSync(join(dir, "docs", m[1]!, "verdict.md"), distills < 2 ? "# Verdict\n\nResult: FAIL two criteria unmet\n" : "# Verdict\n\nResult: PASS\n")
      }
      return undefined
    }
    if (ctx.text.includes("only performs the wrap-up")) {
      const id = /docs\/(T-\d+)\/report\.md/.exec(ctx.text)?.[1]
      if (id) {
        mkdirSync(join(dir, "docs", id), { recursive: true })
        writeFileSync(
          join(dir, "docs", id, "report.md"),
          [
            `# Report (${id})`,
            "",
            "The wrap-up session reviewed the work against the task's acceptance statements and",
            "recorded the verification evidence: what was delivered, where it lives, and how it",
            "was checked. The modules the task touched are listed with their outcomes.",
            "",
            "Result: PASS",
            "",
            "<!-- auto: eof -->",
            "",
          ].join("\n"),
        )
      }
      return undefined
    }
    // The round-report self-heal's append (plans/0081 D4): the appended task
    // is the round's report task, and its session writes the report.
    if (ctx.text.includes("## Input: the task index as it stands") && ctx.text.includes("Round report self-heal")) {
      const phaseDir = promptPhaseDir(ctx.text)
      if (phaseDir) {
        appendOneTask(dir, phaseDir)
        writeFileSync(join(dir, phaseDir.split("/").slice(0, 2).join("/"), "report-for-user.md"), "# Round report\n\nThe round's account for the person.\n\n<!-- auto: eof -->\n")
      }
      return undefined
    }
    if (ctx.text.includes("## Input: the task index as it stands")) {
      const phaseDir = promptPhaseDir(ctx.text)
      if (phaseDir) appendOneTask(dir, phaseDir)
      return undefined
    }
    return artifactTurns(dir)(ctx)
  }
}

const has = (f: LoopFixture, path: string) => existsSync(join(f.dir, path))

describe("repair (task level, m mode)", () => {
  test("a FAIL verdict with budget: the loop exhausts, the failed task is closed with the round recorded, the appended task re-verifies, the run completes", async () => {
    const f = await fixture("m", repairTurns(new Set(["T-001"])))
    const { code, lines } = await f.run({ repair: 1, planInput: { text: "migrate the widget" } })
    expect(code).toBe(0)
    // The verification loop ran first (plans/0083): two fix rounds, each
    // committed with the `T-001 fix <round>` subject and stage execute.
    const subjects = await f.git("log", "--format=%s")
    expect(subjects.split("\n").filter((line) => line.startsWith("T-001 fix "))).toHaveLength(2)
    // Then the repair round: close (the Closed: field names it), append, re-run.
    expect(lines.some((line) => line.includes("repair round 1: the task report concluded"))).toBe(true)
    const closed = await Bun.file(join(f.dir, "docs/T-001/done.md")).text()
    expect(closed).toContain("Closed: repair round 1: the task report concluded Result: FAIL")
    expect(has(f, "docs/T-002/done.md")).toBe(true)
    expect((await Bun.file(join(f.dir, "docs/T-002/report.md")).text())).toContain("Result: PASS")
    expect(await f.git("log", "--format=%s")).toContain("T-001 close")
    expect(lines).toContain("✓ all tasks complete")
    // The tree is clean: the close and append commits settled everything.
    expect((await f.git("status", "--porcelain")).trim()).toBe("")
  })

  test("no budget: the FAIL blocks once the fix loop is spent (exit 2, the task pending, the rounds named, the human's ways listed)", async () => {
    const f = await fixture("m", repairTurns(new Set(["T-001"])))
    const { code, lines } = await f.run({ planInput: { text: "migrate the widget" } })
    expect(code).toBe(2)
    // The block message names the verdict and the rounds spent (plans/0083 D5).
    expect(lines.some((line) => line.includes("the verification of T-001 concluded Result: FAIL"))).toBe(true)
    expect(lines.some((line) => line.includes("2 fix rounds already ran (the budget is 2)"))).toBe(true)
    expect(lines.some((line) => line.includes("docs/T-001/gaps.md"))).toBe(true)
    expect(lines.some((line) => line.includes("repair round"))).toBe(false)
    // Both fix rounds ran before the block (the loop precedes the ladder).
    expect((await f.git("log", "--format=%s")).split("\n").filter((line) => line.startsWith("T-001 fix "))).toHaveLength(2)
    // Not closed, not done: the state files stay pending for the human.
    expect(has(f, "docs/T-001/todo.md")).toBe(true)
    expect(has(f, "docs/T-001/done.md")).toBe(false)
    expect(has(f, "docs/T-002")).toBe(false)
  })

  test("an exhausted budget blocks: the second FAIL has no round left", async () => {
    const f = await fixture("m", repairTurns(new Set(["T-001", "T-002"])))
    const { code, lines } = await f.run({ repair: 1, planInput: { text: "migrate the widget" } })
    expect(code).toBe(2)
    // The first FAIL consumed the round (T-001 closed, T-002 appended); the
    // second FAIL (T-002's own verification) blocks — the budget is spent.
    expect(lines.some((line) => line.includes("repair round 1: the task report concluded"))).toBe(true)
    expect(await Bun.file(join(f.dir, "docs/T-001/done.md")).text()).toContain("Closed: repair round 1")
    expect(has(f, "docs/T-002/todo.md")).toBe(true)
    expect(lines.some((line) => line.includes("the verification of T-002 concluded Result: FAIL"))).toBe(true)
  })
})

describe("repair (phase level: a held verdict gate)", () => {
  test("a FAIL verdict with budget appends repair tasks, re-verifies, and the phase closes on the rewritten verdict", async () => {
    const f = await fixture("mv", gateTurns())
    const { code, lines } = await f.run({ repair: 1 })
    expect(code).toBe(0)
    expect(lines.some((line) => line.includes("repair round 1/1") && line.includes("verdict gate"))).toBe(true)
    // The acceptance phase distilled twice: the first verdict (FAIL) held the
    // gate, the repair round appended a task, and the second verdict passed.
    expect(await Bun.file(join(f.dir, "docs/R-01/P02-acceptance/verdict.md")).text()).toContain("Result: PASS")
    expect(has(f, "docs/R-01/P02-acceptance/done.md")).toBe(true)
    // The repair round's appended task ran in the acceptance phase.
    expect(has(f, "docs/T-002/done.md")).toBe(true)
    expect(lines).toContain("✓ all phases complete")
    expect((await f.git("status", "--porcelain")).trim()).toBe("")
  })

  test("no budget: the held gate stops for the human with the rework ways listed", async () => {
    const f = await fixture("mv", gateTurns())
    const { code, lines } = await f.run()
    expect(code).toBe(2)
    expect(lines.some((line) => line.includes("repair round"))).toBe(false)
    expect(lines.some((line) => line.includes("is held by its gate"))).toBe(true)
    expect(has(f, "docs/R-01/P02-acceptance/todo.md")).toBe(true)
    expect(await Bun.file(join(f.dir, "docs/R-01/P02-acceptance/verdict.md")).text()).toContain("Result: FAIL")
  })
})
