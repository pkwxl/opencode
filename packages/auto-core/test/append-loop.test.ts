// The loop side of append planning (plans/0053 §8, B6): the appending step as
// the phase loop drives it — the open `phase-append` step re-entered under run
// (phased and m mode, the recorded session reused with its persisted input),
// the collect's feedback retry over a session that edits an existing line, the
// reset restoring the snapshot between the attempts, and the stale handover
// removed after a successful append (D25). The collect and reset functions
// themselves are test/append.test.ts's; the prelude rows are test/plan.test.ts's.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import type { FakeAgentOptions } from "./fixtures/agent"
import { appendTurn, badAppendTurns, loopFixture, pastMessage, taskDoc, type LoopFixture } from "./fixtures/loop"
import { unitBaseline } from "../src/git"
import { IMPLIED_MODEL } from "../src/models"
import { completePhase, establishRound, type PhaseUnit } from "../src/phases"
import { saveProgress } from "../src/resume"
import { qualifiedPhase, renderTaskIndex } from "../src/tasks"

const made: LoopFixture[] = []
afterEach(() => {
  for (const fixture of made.splice(0)) rmSync(fixture.dir, { recursive: true, force: true })
})

// The turn rides the fixture directory (the factory form), so the script that
// writes the append artifacts lands in the repository under test.
async function fixture(phases: string, agent: (dir: string) => FakeAgentOptions = () => ({})): Promise<LoopFixture> {
  const f = await loopFixture(phases, agent)
  made.push(f)
  await establishRound(f.dir, { phases })
  await f.commit("round setup")
  return f
}

// List tasks in a phase's index, each with its unit file; done ones as done.md.
// Returns the index text as seeded (the snapshot an appending step must leave
// untouched).
async function seedTasks(f: LoopFixture, phase: PhaseUnit, tasks: Array<[string, boolean]>): Promise<string> {
  const q = qualifiedPhase(phase)
  const text = renderTaskIndex(q, tasks.map(([id, done]) => ({ id, title: `task ${id}`, done })))
  await Bun.write(join(f.dir, phase.dir, "tasks.md"), text)
  for (const [id, done] of tasks) {
    rmSync(join(f.dir, "docs", id, done ? "todo.md" : "done.md"), { force: true })
    await Bun.write(join(f.dir, "docs", id, done ? "done.md" : "todo.md"), taskDoc(id, q))
  }
  return text
}

const has = (f: LoopFixture, path: string) => existsSync(join(f.dir, path))
const clean = async (f: LoopFixture) => expect((await f.git("status", "--porcelain")).trim()).toBe("")
const openStepGone = (f: LoopFixture) => expect(has(f, ".auto/progress.json")).toBe(false)
const read = async (f: LoopFixture, path: string) => Bun.file(join(f.dir, path)).text()

// Hand the analysis phase over (its one task done, completePhase's rename and
// tick), so the loop's route names the implement phase.
async function finishAnalysis(f: LoopFixture) {
  const analysis = await f.phase(0)
  await seedTasks(f, analysis, [["T-001", true]])
  expect(await completePhase(f.dir, analysis)).toEqual([])
  await f.commit("analysis done")
}

// A valid distilled handover (the four sections validHandover checks), as a
// completed distillation leaves behind.
const handoverDoc = (phaseDir: string) =>
  [
    `# Handover (${phaseDir})`,
    "",
    "## Key decisions",
    "",
    "- The fake agent distilled this phase.",
    "",
    "## Constraints and pitfalls",
    "",
    "- Nothing recorded.",
    "",
    "## Required reading for the next phase",
    "",
    "- This phase's directory holds the task units.",
    "",
    "## Artifact index",
    "",
    "- (none)",
    "",
  ].join("\n")

describe("an open phase-append step re-entered under run (plans/0053 D23; plans/0018 precedence)", () => {
  test(
    "phased: the recorded session is reused with its persisted input; no session is created",
    async () => {
      const f = await fixture("am", (dir) => ({ history: { ses_1: [pastMessage("ses_1")] }, turn: appendTurn(dir) }))
      await finishAnalysis(f)
      const implement = await f.phase(1)
      const seeded = await seedTasks(f, implement, [["T-002", true], ["T-003", false]])
      await Bun.write(join(f.dir, implement.dir, "plan-input.md"), "Append a fix task for the retry policy.\n")
      await f.commit("implement tasks")
      // Strict resume's default flipped to on (2026-10, ruling P-1 of
      // plans/0070): the seeded record carries the strict fields (baseline +
      // effective model) a real interrupted strict run writes, so the reuse
      // survives the strict verification.
      // AUTO-DECISION: seed the strict record shape instead of pinning the switch off (the loop fixture scrubs the ambient OPENCODE_AUTO_* layer by charter, and the promoted default is exactly the behavior under test)
      await saveProgress(f.dir, { task: "PLAN", session: "ses_1", at: 1, active: true, phase: { kind: "step", step: "phase-append", unit: "R-01.P02" }, baseline: await unitBaseline(f.dir), model: IMPLIED_MODEL })
      const { code, lines } = await f.run({ stopBefore: "execute" })
      expect(code).toBe(0)
      expect(lines).toContain("↻ session resume point takes precedence: the task appending session(P02-implement Implementation) was not closed out; re-entering that step to continue")
      expect(lines).toContain("ℹ appending against the persisted input docs/R-01/P02-implement/plan-input.md")
      expect(lines).toContain("✓ task append complete: docs/R-01/P02-implement/tasks.md gained 1 task(s)")
      // The first prompt went into the recorded session — an appending prompt
      // with the resume note of the task-appending step — and no session is
      // created. Under the promoted strict resume (default on since 2026-10,
      // ruling P-1 of plans/0070) a reused session's note is the single
      // continue sentence, not the per-step guidance.
      // AUTO-DECISION: re-pin the note expectation to the strict single-continue sentence (it is the promoted production wording for every reused session, not a weakening — the per-step guidance branch keeps its own coverage in resume-gate's tests)
      expect(f.agent.prompts).toHaveLength(1)
      expect(f.agent.prompts[0]!.session).toBe("ses_1")
      expect(f.agent.prompts[0]!.text).toContain("## Input: the task index as it stands")
      expect(f.agent.prompts[0]!.text).toContain("[DRIVER] The session was interrupted; continue the current work until this unit is complete")
      expect(f.agent.argsOf("create")).toEqual([])
      // One task appended after the existing lines; the step record is closed
      // and the tree committed.
      expect(await read(f, join(implement.dir, "tasks.md"))).toBe(`${seeded}- [ ] T-004 task T-004\n`)
      expect(has(f, "docs/T-004/todo.md")).toBe(true)
      openStepGone(f)
      await clean(f)
    },
  )

  test(
    "m mode: re-entered the same way from its persisted input, and a fresh input on the listed index is an append",
    async () => {
      const f = await fixture("m", (dir) => ({ history: { ses_1: [pastMessage("ses_1")] }, turn: appendTurn(dir) }))
      const phase = await f.phase(0)
      await seedTasks(f, phase, [["T-001", true], ["T-002", false]])
      await Bun.write(join(f.dir, phase.dir, "plan-input.md"), "Append a fix task.\n")
      await f.commit("listed tasks")
      // The strict-fields shape, same as the phased case above (strict
      // resume's default flipped to on 2026-10, ruling P-1 of plans/0070).
      await saveProgress(f.dir, { task: "PLAN", session: "ses_1", at: 1, active: true, phase: { kind: "step", step: "phase-append", unit: "R-01.P01" }, baseline: await unitBaseline(f.dir), model: IMPLIED_MODEL })
      const { code, lines } = await f.run({ stopBefore: "execute" })
      expect(code).toBe(0)
      expect(lines).toContain("↻ session resume point takes precedence: the task appending session(P01-implement Implementation) was not closed out; re-entering that step to continue")
      expect(lines).toContain("✓ planned 1 task(s) (T-003) into docs/R-01/P01-implement/tasks.md")
      expect(f.agent.prompts[0]!.session).toBe("ses_1")
      expect(f.agent.argsOf("create")).toEqual([])
      openStepGone(f)
      // A fresh input on m mode's listed index is an append without the flag
      // (D23): the loop routes it to the appending step, which consumes it.
      const appended = await f.run({ stopBefore: "execute", planInput: { text: "One more task." } })
      expect(appended.code).toBe(0)
      expect(appended.lines).toContain("✓ planning input saved to docs/R-01/P01-implement/plan-input.md")
      expect(appended.lines).toContain("✓ planned 1 task(s) (T-004) into docs/R-01/P01-implement/tasks.md")
      expect(f.agent.prompts.filter((p) => p.text.includes("## Input: the task index as it stands"))).toHaveLength(2)
      expect(await read(f, join(phase.dir, "tasks.md"))).toContain("- [ ] T-004 task T-004")
      await clean(f)
    },
  )
})

describe("the append collect's feedback retry and the snapshot reset (plans/0053 D24)", () => {
  test(
    "a session that edits an existing line and document is retried with the problems, after the snapshot was restored",
    async () => {
      const f = await fixture("am", (dir) => ({ turn: badAppendTurns(dir) }))
      await finishAnalysis(f)
      const implement = await f.phase(1)
      const seeded = await seedTasks(f, implement, [["T-002", true], ["T-003", false]])
      await f.commit("implement tasks")
      const seededDoc = await read(f, "docs/T-003/todo.md")
      const { code, lines } = await f.run({ stopBefore: "execute", planInput: { text: "Add a fix task." }, append: true })
      expect(code).toBe(0)
      // The first session's output was refused and retried once with feedback.
      expect(lines).toContain(
        "↻ PLAN task appending session did not produce new task lines appended to docs/R-01/P02-implement/tasks.md with their task documents (at least one new task); retrying once with feedback",
      )
      // The retry requirement carries the collect's problems: the edited
      // existing line and the changed existing document.
      expect(f.agent.prompts).toHaveLength(2)
      const retry = f.agent.prompts[1]!.text
      expect(retry).toContain("Problems last time:")
      expect(retry).toContain("docs/R-01/P02-implement/tasks.md line 3: the existing line of T-002 was edited; existing lines are fixed — append only")
      expect(retry).toContain("docs/T-003/todo.md of the existing task T-003 was changed or removed; an append never edits an existing task's document")
      // The reset restored the snapshot before the retry: the index is the
      // seeded text plus exactly the appended line, the existing task's
      // document is byte-identical, and the failed attempt's task directory
      // (its stray file included) was removed and rebuilt by the good turn.
      expect(await read(f, join(implement.dir, "tasks.md"))).toBe(`${seeded}- [ ] T-004 task T-004\n`)
      expect(await read(f, "docs/T-003/todo.md")).toBe(seededDoc)
      expect(has(f, "docs/T-004/stray.md")).toBe(false)
      expect(await read(f, "docs/T-004/todo.md")).toBe(taskDoc("T-004", "R-01.P02"))
      expect(lines).toContain("✓ task append complete: docs/R-01/P02-implement/tasks.md gained 1 task(s)")
      openStepGone(f)
      await clean(f)
    },
  )
})

describe("the stale handover removed after a successful append (plans/0053 D25/F13)", () => {
  test(
    "a distilled phase that gains tasks loses its handover in its own commit; acceptance.md and verdict.md stay",
    async () => {
      const f = await fixture("am", (dir) => ({ turn: appendTurn(dir) }))
      const analysis = await f.phase(0)
      const seeded = await seedTasks(f, analysis, [["T-001", true]])
      // The phase was distilled (a valid handover) but not completed: its
      // tasks are done, so the route is handover — and the append targets it.
      await Bun.write(join(f.dir, analysis.dir, "handover.md"), handoverDoc(analysis.dir))
      await Bun.write(join(f.dir, analysis.dir, "acceptance.md"), "# Acceptance\n\nDraft awaiting the reviewer.\n")
      await Bun.write(join(f.dir, analysis.dir, "verdict.md"), "# Verdict\n\nResult: PASS\n")
      await f.commit("analysis distilled")
      const { code, lines } = await f.run({ stopBefore: "execute", planInput: { text: "Rework the survey." }, append: true })
      expect(code).toBe(0)
      expect(lines).toContain("✓ task append complete: docs/R-01/P01-analysis/tasks.md gained 1 task(s)")
      expect(lines).toContain("✓ stale handover removed: docs/R-01/P01-analysis/handover.md (the phase is distilled again after the appended tasks)")
      expect(lines).toContain("✓ planned R-01.P01 analysis: 1 task(s) in docs/R-01/P01-analysis/tasks.md")
      // Only the appending session ran: no distiller prompt, no completion.
      expect(f.agent.prompts.map((p) => p.text.includes("You are the handover distiller"))).toEqual([false])
      expect(has(f, join(analysis.dir, "done.md"))).toBe(false)
      // The removal is its own commit after the append unit, and the phase's
      // other distilled artifacts are kept.
      expect(has(f, join(analysis.dir, "handover.md"))).toBe(false)
      expect(has(f, join(analysis.dir, "acceptance.md"))).toBe(true)
      expect(has(f, join(analysis.dir, "verdict.md"))).toBe(true)
      const subjects = (await f.git("log", "--format=%s", "-3")).trim().split("\n")
      expect(subjects).toEqual([
        "PLAN append P01-analysis Analysis: remove the stale handover",
        "PLAN append P01-analysis Analysis",
        "PLAN plan-input P01-analysis Analysis",
      ])
      expect(await f.git("log", "--format=%B", "-3")).toContain("Auto-Stage: phase-append")
      // The appended task follows the snapshot prefix unchanged.
      expect(await read(f, join(analysis.dir, "tasks.md"))).toBe(`${seeded}- [ ] T-002 task T-002\n`)
      openStepGone(f)
      await clean(f)
    },
  )
})
