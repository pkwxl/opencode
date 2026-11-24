// The repair-append budget's retirement (plans/0283, pinning the standing
// behavior): a task report's Result: FAIL blocks once the fix loop is spent
// — the verdict surfaced as state, the block's question carrying the
// person's ways — and a held verdict gate stops for the human. No repair
// round ever opens, no failed task is closed by the driver, nothing is
// appended: the budget, its rounds and its shared helper are gone from the
// loop (the executor protocol's fix grant repairs verify FAILs on the pull
// path). Every verdict the driver acts on is parsed from a file — the fake
// agent only writes documents.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { artifactTurns, landPhaseHandover, loopFixture, type LoopFixture } from "./fixtures/loop"
import type { FakeAgentOptions, TurnScript } from "./fixtures/agent"
import { transferDeterministic } from "../src/transfer"
import { captureRun } from "./fixtures/capture"
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

// The FAIL-channel turn script: the artifact turns (planning and handover
// distillation) plus a wrap-up turn that writes each named task's verdict —
// FAIL for the ids in `failing` (the gap list, plans/0083 D3), PASS for
// everything else. The whole-task sessions settle on the fake agent's
// default.
const failTurns = (failing: ReadonlySet<string>) => (dir: string): TurnScript => {
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
              "### Gap 1 — the acceptance gap stands",
              "",
              "The required behavior is not delivered (src/widget.ts): do what the acceptance asks.",
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
    return artifactTurns(dir)(ctx)
  }
}

const has = (f: LoopFixture, path: string) => existsSync(join(f.dir, path))

describe("the FAIL verdict as state (plans/0283: the repair-append budget retired)", () => {
  test("a FAIL blocks once the fix loop is spent (exit 2, the task pending, the rounds named, the human's ways listed — never a repair round)", async () => {
    const f = await fixture("m", failTurns(new Set(["T-002"])))
    const { code, lines } = await f.run({ planInput: { text: "migrate the widget" } })
    expect(code).toBe(2)
    // The block message names the verdict, the stalled count and the rounds
    // spent (plans/0083 D5, the bound re-ruled by plans/0146 D3).
    expect(lines.some((line) => line.includes("the verification of T-002 concluded Result: FAIL"))).toBe(true)
    expect(lines.some((line) => line.includes("the last two fix rounds closed no gap (2 fix rounds spent, the gap list still counts 1 gap)"))).toBe(true)
    expect(lines.some((line) => line.includes("docs/T-002/gaps.md"))).toBe(true)
    // The retirement pin: no repair round ever opened, nothing appended.
    expect(lines.some((line) => line.includes("repair round"))).toBe(false)
    // Both fix rounds ran before the block (the loop precedes the ladder).
    expect((await f.git("log", "--format=%s")).split("\n").filter((line) => line.startsWith("T-002 fix "))).toHaveLength(2)
    // Not closed, not done: the state files stay pending for the human.
    expect(has(f, "docs/T-002/todo.md")).toBe(true)
    expect(has(f, "docs/T-002/done.md")).toBe(false)
    expect(has(f, "docs/T-003")).toBe(false)
  })
})

describe("the held verdict gate as state (plans/0283: the repair-append budget retired)", () => {
  test("the held gate stops for the human with the rework ways listed — never a repair round", async () => {
    const f = await fixture("mv", failTurns(new Set()))
    expect((await f.run()).code).toBe(0)
    await landPhaseHandover(f, await f.phase(0))
    const transfer = () => captureRun(() => transferDeterministic(f.dir, { phases: "mv" }))
    expect((await transfer()).code).toBe(0)
    expect((await f.run()).code).toBe(0)
    const acceptance = await f.phase(1)
    await Bun.write(join(f.dir, acceptance.dir, "verdict.md"), "# Verdict\n\nResult: FAIL two criteria unmet\n")
    await landPhaseHandover(f, acceptance)
    const { code, lines } = await transfer()
    expect(code).toBe(2)
    expect(lines.some((line) => line.includes("repair round"))).toBe(false)
    expect(lines.some((line) => line.includes("is held by its gate"))).toBe(true)
    expect(has(f, "docs/R-01/P02-acceptance/todo.md")).toBe(true)
    expect(await Bun.file(join(f.dir, "docs/R-01/P02-acceptance/verdict.md")).text()).toContain("Result: FAIL")
  })
})
