// The loop side of plan (plans/0053 §8, A7): the stop condition (D6–D8) and
// the planning-step integration points the prelude tests (plan.test.ts)
// cannot reach — the loop harness of test/fixtures/loop.ts drives
// runPhaseLoop on the native fake agent over real git repositories, whose
// scripted turns write the planning and handover artifacts (F14).
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import type { FakeAgentOptions } from "./fixtures/agent"
import { loopFixture, pastMessage, taskDoc, type LoopFixture } from "./fixtures/loop"
import { readNextTask } from "../src/numbering"
import { completePhase, establishRound, type PhaseUnit } from "../src/phases"
import { saveProgress } from "../src/resume"
import { qualifiedPhase, renderTaskIndex } from "../src/tasks"

const made: LoopFixture[] = []
afterEach(() => {
  for (const fixture of made.splice(0)) rmSync(fixture.dir, { recursive: true, force: true })
})

async function fixture(phases: string, agentOptions: FakeAgentOptions = {}): Promise<LoopFixture> {
  const f = await loopFixture(phases, agentOptions)
  made.push(f)
  await establishRound(f.dir, { phases })
  await f.commit("round setup")
  return f
}

// List tasks in a phase's index, each with its unit file; done ones as done.md.
async function seedTasks(f: LoopFixture, phase: PhaseUnit, tasks: Array<[string, boolean]>) {
  const q = qualifiedPhase(phase)
  await Bun.write(join(f.dir, phase.dir, "tasks.md"), renderTaskIndex(q, tasks.map(([id, done]) => ({ id, title: `task ${id}`, done }))))
  for (const [id, done] of tasks) {
    rmSync(join(f.dir, "docs", id, done ? "todo.md" : "done.md"), { force: true })
    await Bun.write(join(f.dir, "docs", id, done ? "done.md" : "todo.md"), taskDoc(id, q))
  }
}

const has = (f: LoopFixture, path: string) => existsSync(join(f.dir, path))
const clean = async (f: LoopFixture) => expect((await f.git("status", "--porcelain")).trim()).toBe("")
const openStepGone = (f: LoopFixture) => expect(has(f, ".auto/progress.json")).toBe(false)
const planners = (f: LoopFixture) => f.agent.prompts.filter((p) => p.text.includes("You are the planner"))

describe("plan's stop condition (plans/0053 D6)", () => {
  test(
    "stops right after a planning step, with the review summary instead of the G5 pause",
    async () => {
      const f = await fixture("am")
      const { code, lines } = await f.run({ stopBefore: "execute" })
      expect(code).toBe(0)
      expect(lines).toContain("✓ planned R-01.P01 analysis: 1 task(s) in docs/R-01/P01-analysis/tasks.md")
      expect(lines).toContain(`next: review them, then run: opencode-auto run ${f.dir}`)
      // The planning step's outputs are on disk, committed, and its resume
      // point is closed; the loop stopped before the next phase's planning.
      expect(has(f, "docs/R-01/P01-analysis/tasks.md")).toBe(true)
      expect(has(f, "docs/T-001/todo.md")).toBe(true)
      await clean(f)
      openStepGone(f)
      expect(has(f, "docs/R-01/P02-implement/tasks.md")).toBe(false)
      expect(planners(f)).toHaveLength(1)
      expect(lines.some((line) => line.startsWith("⚠ the planning input was not used"))).toBe(false)
    },
  )

  test(
    "goes through a handover as run does, and stops after the next phase's planning",
    async () => {
      const f = await fixture("am")
      await seedTasks(f, await f.phase(0), [["T-001", true]])
      await f.commit("analysis tasks")
      const { code, lines } = await f.run({ stopBefore: "execute" })
      expect(code).toBe(0)
      // The handover completed: the distillation ran, the phase was archived
      // and its index line ticked; the next phase was planned and the run
      // stopped there.
      expect(has(f, "docs/R-01/P01-analysis/done.md")).toBe(true)
      expect(has(f, "docs/R-01/P01-analysis/handover.md")).toBe(true)
      expect(await Bun.file(join(f.dir, "docs/R-01/phases.md")).text()).toContain("- [x] P01")
      expect(lines).toContain("✓ planned R-01.P02 implement: 1 task(s) in docs/R-01/P02-implement/tasks.md")
      expect(f.agent.prompts.map((p) => p.text.includes("You are the handover distiller"))).toEqual([true, false])
      // No closed task: the distiller prompt carries no closed-tasks block.
      expect(f.agent.prompts[0]!.text).not.toContain("## Closed tasks")
      await clean(f)
      openStepGone(f)
    },
  )

  test(
    "an execute route this run did not plan: a notice and exit 0; a leftover input is exit 1 with the unused warning (D7)",
    async () => {
      const f = await fixture("am")
      await seedTasks(f, await f.phase(0), [["T-001", true], ["T-002", false]])
      await f.commit("analysis tasks")
      const stopped = await f.run({ stopBefore: "execute" })
      expect(stopped.code).toBe(0)
      expect(stopped.lines).toContain(`ℹ R-01.P01 analysis is planned (1 of 2 tasks pending); next: opencode-auto run ${f.dir}`)
      expect(f.agent.calls).toEqual([])
      const refused = await f.run({ stopBefore: "execute", planInput: { text: "More analysis." } })
      expect(refused.code).toBe(1)
      expect(refused.lines.some((line) => line.startsWith("⚠ the planning input was not used"))).toBe(true)
      // The input was never persisted: the stop precedes any planning step.
      expect(has(f, "docs/R-01/P01-analysis/plan-input.md")).toBe(false)
    },
  )

  test(
    "a round completed inside plan: the round-close report and the next step, no round opened (D8)",
    async () => {
      const f = await fixture("am")
      const [analysis, implement] = [await f.phase(0), await f.phase(1)]
      await seedTasks(f, analysis, [["T-001", true]])
      await completePhase(f.dir, analysis)
      await seedTasks(f, implement, [["T-002", true]])
      await completePhase(f.dir, implement)
      await f.commit("round done")
      const { code, lines } = await f.run({ stopBefore: "execute" })
      expect(code).toBe(0)
      expect(lines).toContain("✓ all phases complete")
      expect(lines.some((line) => line.includes("fill in ## Close of docs/R-01/round.md"))).toBe(true)
      expect(has(f, "docs/R-02")).toBe(false)
    },
  )
})

describe("closed phases in phase planning (plans/0053 D16)", () => {
  // Archive a phase as completePhase does; with a reason, its done.md field
  // block also carries `Closed: <reason>` (closed: done, not delivered).
  async function finishPhase(f: LoopFixture, unit: PhaseUnit, closed?: string) {
    expect(await completePhase(f.dir, unit)).toEqual([])
    if (closed === undefined) return
    const done = join(f.dir, unit.dir, "done.md")
    const text = await Bun.file(done).text()
    await Bun.write(done, text.replace(`Type: ${unit.type}\n`, `Type: ${unit.type}\nClosed: ${closed}\n`))
  }

  for (const closed of [true, false]) {
    test(
      closed
        ? "closed analysis and design phases count as trimmed: the implement planning prompt carries the note"
        : "delivered analysis and design phases: no pipeline-trimming note",
      async () => {
        const f = await fixture("adm")
        await finishPhase(f, await f.phase(0), closed ? "superseded by the upstream survey" : undefined)
        await finishPhase(f, await f.phase(1), closed ? "design reused from the previous round" : undefined)
        await f.commit("earlier phases archived")
        const implement = await f.phase(2)
        const { code, lines } = await f.run({ stopBefore: "execute" })
        expect(code).toBe(0)
        expect(lines).toContain(`✓ planned ${qualifiedPhase(implement)} implement: 1 task(s) in ${join(implement.dir, "tasks.md")}`)
        const prompts = planners(f)
        expect(prompts).toHaveLength(1)
        expect(prompts[0]!.text.includes("Pipeline-trimming note")).toBe(closed)
      },
    )
  }
})

describe("closed tasks in the handover distillation (plans/0053 D16)", () => {
  test(
    "the phase's closed task is listed for the distiller with its reason; delivered tasks are not",
    async () => {
      const f = await fixture("am")
      const analysis = await f.phase(0)
      await seedTasks(f, analysis, [["T-001", true], ["T-002", true]])
      const q = qualifiedPhase(analysis)
      const done = join(f.dir, "docs", "T-001", "done.md")
      await Bun.write(done, (await Bun.file(done).text()).replace(`Phase: ${q}\n`, `Phase: ${q}\nClosed: superseded\n`))
      await f.commit("analysis tasks")
      const { code } = await f.run({ stopBefore: "execute" })
      expect(code).toBe(0)
      expect(has(f, join(analysis.dir, "done.md"))).toBe(true)
      const distillers = f.agent.prompts.filter((p) => p.text.includes("You are the handover distiller"))
      expect(distillers).toHaveLength(1)
      const text = distillers[0]!.text
      const block = text.slice(text.indexOf("## Closed tasks"), text.indexOf("## Artifact"))
      expect(block).toContain("- T-001: task T-001 (closed without completing: superseded)")
      expect(block).not.toContain("T-002")
    },
  )
})

describe("m-mode planning (plans/0053 D9, D12)", () => {
  test(
    "the input is persisted on its own commit before the planning unit, and the numbering record advances",
    async () => {
      const f = await fixture("m")
      const { code, lines } = await f.run({ stopBefore: "execute", planInput: { text: "Port the retry policy." }, autoNumber: true })
      expect(code).toBe(0)
      expect(lines).toContain("✓ planning input saved to docs/R-01/P01-implement/plan-input.md")
      expect(lines).toContain("✓ numbering record advanced: next available task number T-002(.auto/next-task)")
      expect(lines).toContain("✓ planned 1 task(s) (T-001) into docs/R-01/P01-implement/tasks.md")
      expect(await Bun.file(join(f.dir, "docs/R-01/P01-implement/plan-input.md")).text()).toBe("Port the retry policy.\n")
      expect(await readNextTask(f.dir)).toBe(2)
      expect(await Bun.file(join(f.dir, "docs/R-01/P01-implement/tasks.md")).text()).toContain("- [ ] T-001")
      // Two commits after the setup: the input on its own (Auto-Stage:
      // plan-input), then the planning unit (Auto-Stage: phase-plan).
      const subjects = (await f.git("log", "--format=%s", "-2")).trim().split("\n")
      expect(subjects[0]).toBe("PLAN plan P01-implement Implementation")
      expect(subjects[1]).toBe("PLAN plan-input P01-implement Implementation")
      const bodies = await f.git("log", "--format=%B", "-2")
      expect(bodies).toContain("Auto-Stage: phase-plan")
      expect(bodies).toContain("Auto-Stage: plan-input")
      await clean(f)
      openStepGone(f)
      expect(lines.some((line) => line.startsWith("⚠ the planning input was not used"))).toBe(false)
    },
  )
})

describe("the planning input and the open step (plans/0053 D9, D12; plans/0018 precedence)", () => {
  test(
    "a changed input restarts an open planning step in a new session: the latest input wins",
    async () => {
      const f = await fixture("m")
      await Bun.write(join(f.dir, "docs/R-01/P01-implement/plan-input.md"), "old input\n")
      await f.commit("planning input")
      // ses_stale is outside the fake agent's id space, so a prompt landing on
      // a fresh session can never be confused with a reuse of the record's.
      await saveProgress(f.dir, { task: "PLAN", session: "ses_stale", at: 1, active: true, phase: { kind: "step", step: "phase-plan", unit: "R-01.P01" } })
      const { code, lines } = await f.run({ stopBefore: "execute", planInput: { text: "new input" } })
      expect(code).toBe(0)
      expect(lines).toContain("↻ PLAN phase planning step restarting in a new session (the planning input changed)")
      expect(lines).toContain("✓ planning input saved to docs/R-01/P01-implement/plan-input.md")
      expect(await Bun.file(join(f.dir, "docs/R-01/P01-implement/plan-input.md")).text()).toBe("new input\n")
      // The recorded session was never probed and never prompted; the step
      // started afresh in a new session.
      expect(f.agent.argsOf("get").flat()).not.toContain("ses_stale")
      expect(f.agent.prompts.map((p) => p.session)).not.toContain("ses_stale")
      expect(f.agent.argsOf("create")).toHaveLength(1)
      openStepGone(f)
    },
  )

  test(
    "an open phase-plan step is re-entered under run, reusing the recorded session (phased)",
    async () => {
      const f = await fixture("am", { history: { ses_1: [pastMessage("ses_1")] } })
      await Bun.write(join(f.dir, "docs/R-01/P01-analysis/plan-input.md"), "Plan the analysis.\n")
      await f.commit("planning input")
      await saveProgress(f.dir, { task: "PLAN", session: "ses_1", at: 1, active: true, phase: { kind: "step", step: "phase-plan", unit: "R-01.P01" } })
      const { code, lines } = await f.run({ stopBefore: "execute" })
      expect(code).toBe(0)
      expect(lines).toContain("↻ session resume point takes precedence: the phase planning session(P01-analysis Analysis) was not closed out; re-entering that step to continue")
      expect(lines).toContain("ℹ planning against the persisted input docs/R-01/P01-analysis/plan-input.md")
      expect(lines).toContain("✓ planned R-01.P01 analysis: 1 task(s) in docs/R-01/P01-analysis/tasks.md")
      // The first prompt went into the recorded session; no session was created.
      expect(f.agent.prompts[0]!.session).toBe("ses_1")
      expect(f.agent.argsOf("create")).toEqual([])
      expect(has(f, "docs/R-01/P01-analysis/tasks.md")).toBe(true)
      openStepGone(f)
      await clean(f)
    },
  )

  test(
    "an open phase-plan step is re-entered in m mode from its persisted input",
    async () => {
      const f = await fixture("m", { history: { ses_1: [pastMessage("ses_1")] } })
      await Bun.write(join(f.dir, "docs/R-01/P01-implement/plan-input.md"), "Port the retry policy.\n")
      await f.commit("planning input")
      await saveProgress(f.dir, { task: "PLAN", session: "ses_1", at: 1, active: true, phase: { kind: "step", step: "phase-plan", unit: "R-01.P01" } })
      const { code, lines } = await f.run({ stopBefore: "execute" })
      expect(code).toBe(0)
      expect(lines).toContain("✓ planned 1 task(s) (T-001) into docs/R-01/P01-implement/tasks.md")
      expect(f.agent.prompts[0]!.session).toBe("ses_1")
      expect(f.agent.argsOf("create")).toEqual([])
      openStepGone(f)
    },
  )

  test(
    "an m-mode open planning step without input is closed with a warning; file routing continues",
    async () => {
      const f = await fixture("m")
      await saveProgress(f.dir, { task: "PLAN", at: 1, active: true, phase: { kind: "step", step: "phase-plan", unit: "R-01.P01" } })
      const { code, lines } = await f.run({ stopBefore: "execute" })
      expect(code).toBe(0)
      expect(lines).toContain(
        "⚠ unclosed m-mode planning resume point (R-01.P01) has no planning input (docs/R-01/P01-implement/plan-input.md) to plan against; " +
          "closing it and continuing with the file-derived route",
      )
      expect(
        lines.find((line) => line.startsWith("ℹ no tasks listed in docs/R-01/P01-implement/tasks.md yet")),
      ).toBeTruthy()
      expect(f.agent.calls).toEqual([])
      openStepGone(f)
    },
  )
})
