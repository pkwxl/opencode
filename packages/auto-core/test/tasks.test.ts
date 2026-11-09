// Task store over task units (M3.4, plans/0047 §3–§4): loading a phase's
// tasks from tasks.md + docs/T-NNN/todo.md|done.md, runtime state in
// .auto/units.json, the driver's completion (rename + index tick), the
// subtask checklist from subtasks.md, and the planning-session checks.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { syncPhaseIndex, type PhaseUnit } from "../src/phases"
import { renderStatus } from "../src/status"
import {
  begin,
  block,
  doneTaskIds,
  countSubtasks,
  forkBaseFor,
  laneRecords,
  loadPlan,
  markDone,
  newTaskProblems,
  next,
  plannedTaskProblems,
  readChecklist,
  renderTaskIndex,
  renderTaskTodo,
  resetInProgress,
  resetPlanning,
  setForkBase,
  setLane,
  setParked,
  subtasks,
  syncChecklistTicks,
  takenTaskIds,
  taskBody,
  taskStatePaths,
  tickSubtask,
  unitAttempts,
  UNITS_FILE,
} from "../src/tasks"
import { seedUnits } from "./fixtures/units"

let dir: string
let phase: PhaseUnit

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "auto-tasks-"))
  ;[phase] = await syncPhaseIndex(dir, 1, "m")
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const SAMPLE = `## T-001: Build the schema [done]
Data-layer modeling.

## T-002: Implement the migration [blocked]
  - attempts: 1
Write the migration script.

## T-003: Write the API [pending]
REST endpoints.

- [x] routing
- [ ] auth
`

describe("loadPlan", () => {
  test("reads the index order, state files and runtime state", async () => {
    const plan = await seedUnits(dir, SAMPLE)
    expect(plan.index).toBe("docs/R-01/P01-implement/tasks.md")
    expect(plan.phase).toBe("R-01.P01")
    expect(plan.tasks.map((t) => [t.id, t.status, t.attempts])).toEqual([
      ["T-001", "done", 0],
      ["T-002", "blocked", 1],
      ["T-003", "pending", 0],
    ])
    expect(plan.tasks[1]!.title).toBe("Implement the migration")
    expect(plan.tasks[1]!.body).toBe("Write the migration script.")
    expect(plan.tasks[1]!.phase).toBe("R-01.P01")
    expect(next(plan)!.id).toBe("T-002")
  })

  test("the checklist comes from subtasks.md, not the body", async () => {
    const plan = await seedUnits(dir, SAMPLE)
    const t3 = plan.tasks[2]!
    expect(t3.body).toBe("REST endpoints.")
    expect(t3.checklist).toEqual([
      { text: "routing", done: true },
      { text: "auth", done: false },
    ])
    expect(countSubtasks(t3.checklist)).toEqual({ done: 1, total: 2 })
  })

  test("state files win over the subtasks.md tick once the protocol is active", async () => {
    await seedUnits(dir, SAMPLE)
    await mkdir(join(dir, "docs/T-003/S01"), { recursive: true })
    await mkdir(join(dir, "docs/T-003/S02"), { recursive: true })
    await Bun.write(join(dir, "docs/T-003/S01/todo.md"), "scope\n")
    await Bun.write(join(dir, "docs/T-003/S02/done.md"), "scope\n")
    expect((await readChecklist(dir, "T-003")).map((item) => item.done)).toEqual([false, true])
  })

  test("a CRLF subtasks.md yields the real checklist, never a silent empty one (plans/0158 D1)", async () => {
    // A Windows-line-ended checklist: splitting on \n leaves a \r at each
    // line's end that `.` never matches — the pre-0158 parser returned []
    // and the pipeline silently routed the decomposed task down the
    // whole-task path with no error anywhere.
    const crlf = "- [x] routing\r\n- [ ] auth\r\n"
    expect(subtasks(crlf).map((item) => item.done)).toEqual([true, false])
    expect(subtasks(crlf).map((item) => item.text)).toEqual(["routing", "auth"])
    // readChecklist composes over the S<nn> state files as with LF.
    await seedUnits(dir, SAMPLE)
    await Bun.write(join(dir, "docs/T-003/subtasks.md"), crlf)
    await mkdir(join(dir, "docs/T-003/S02"), { recursive: true })
    await Bun.write(join(dir, "docs/T-003/S02/done.md"), "scope\n")
    const items = await readChecklist(dir, "T-003")
    expect(items.map((item) => item.text)).toEqual(["routing", "auth"])
    expect(items.map((item) => item.done)).toEqual([true, true])
  })

  test("a missing index is an empty plan", async () => {
    expect((await loadPlan(dir, phase)).tasks).toEqual([])
  })

  test("an index line without a state file, or with both, throws with guidance", async () => {
    await Bun.write(join(dir, phase.dir, "tasks.md"), renderTaskIndex("R-01.P01", [{ id: "T-001", title: "a" }]))
    await expect(loadPlan(dir, phase)).rejects.toThrow("docs/T-001/ has neither todo.md nor done.md")
    await mkdir(join(dir, "docs/T-001"), { recursive: true })
    await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001: a\n")
    await Bun.write(join(dir, "docs/T-001/done.md"), "# T-001: a\n")
    await expect(loadPlan(dir, phase)).rejects.toThrow("both todo.md and done.md")
  })

  test("a malformed index line throws", async () => {
    await Bun.write(join(dir, phase.dir, "tasks.md"), "- [ ] X-1 bad\n")
    await expect(loadPlan(dir, phase)).rejects.toThrow("is not a task id")
  })

  // The plan-recorded execution mode (plans/0075): write → parse → validate.
  // The field round-trips through renderTaskTodo and the field block (todo.md
  // and done.md alike), and an unknown value fails load with the standard
  // grammar error.
  test("Decompose round-trips on todo.md and done.md; an unknown value fails load", async () => {
    await Bun.write(join(dir, phase.dir, "tasks.md"), renderTaskIndex("R-01.P01", [{ id: "T-001", title: "a" }]))
    await mkdir(join(dir, "docs/T-001"), { recursive: true })
    const doc = renderTaskTodo({ id: "T-001", title: "a", phase: "R-01.P01", decompose: "pipeline", goal: "g", scope: "s", acceptance: "a" })
    expect(doc).toContain("Phase: R-01.P01\nDecompose: pipeline\n")
    await Bun.write(join(dir, "docs/T-001/todo.md"), doc)
    expect((await loadPlan(dir, phase)).tasks[0]!.decompose).toBe("pipeline")
    // The rename to done.md keeps the field readable.
    await Bun.write(join(dir, "docs/T-001/done.md"), renderTaskTodo({ id: "T-001", title: "a", phase: "R-01.P01", decompose: "whole", goal: "g", scope: "s", acceptance: "a" }))
    await rm(join(dir, "docs/T-001/todo.md"))
    expect((await loadPlan(dir, phase)).tasks[0]!.decompose).toBe("whole")
    // An unknown value is a load failure through the grammar check.
    await Bun.write(join(dir, "docs/T-001/done.md"), renderTaskTodo({ id: "T-001", title: "a", phase: "R-01.P01", decompose: "sideways", goal: "g", scope: "s", acceptance: "a" }))
    await expect(loadPlan(dir, phase)).rejects.toThrow('T-001 has an unknown Decompose value "sideways"')
    await expect(loadPlan(dir, phase)).rejects.toThrow("grammar problems")
  })

  // A park problem is runtime state, never a document field (0238 D6a,
  // enacting 0165-206a): the wrapper's remedy must name the park record and
  // its file (.auto/units.json) — the old wrapper taught editing todo.md's
  // `Depends:` lines, which were never wrong.
  test("a park record on an unknown id throws with the record's own remedy, never the Depends field's", async () => {
    await Bun.write(join(dir, phase.dir, "tasks.md"), renderTaskIndex("R-01.P01", [{ id: "T-001", title: "a" }]))
    await mkdir(join(dir, "docs/T-001"), { recursive: true })
    await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001: a\nPhase: R-01.P01\n\n## Goal\n\ng\n\n<!-- auto: eof -->\n")
    await mkdir(join(dir, ".auto"), { recursive: true })
    await Bun.write(join(dir, UNITS_FILE), JSON.stringify({ tasks: { "T-001": { parked: "T-009" } } }))
    const error = await loadPlan(dir, phase).then(() => undefined, (thrown: Error) => thrown)
    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toContain("T-001 parks on unknown T-009")
    // The remedy names the record and its file, and teaches the one edit.
    expect(error!.message).toContain(".auto/units.json")
    expect(error!.message).toContain('"parked"')
    expect(error!.message).not.toContain("`Depends:` in docs/T-NNN/todo.md names tasks")
    // A document-field problem beside it keeps the field remedy (the two
    // teachings split by the problem's own kind).
    await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001: a\nPhase: R-01.P01\nDepends: T-008\n\n## Goal\n\ng\n\n<!-- auto: eof -->\n")
    const mixed = await loadPlan(dir, phase).then(() => undefined, (thrown: Error) => thrown)
    expect(mixed!.message).toContain("parks on unknown T-009")
    expect(mixed!.message).toContain(".auto/units.json")
    expect(mixed!.message).toContain("`Depends:` in docs/T-NNN/todo.md names tasks")
  })

  test("taskBody normalizes CRLF once at entry — no CR byte rides the prompt body (0238 D6c, subtasks()'s precedent)", () => {
    const body = taskBody("# T-001: a\r\nPhase: R-01.P01\r\n\r\n## Goal\r\n\r\ngoal text\r\n\r\n<!-- auto: eof -->\r\n")
    expect(body).toBe("## Goal\n\ngoal text")
    expect(body.includes("\r")).toBe(false)
  })

  test("taskBody drops the title, the field block and the terminator", () => {
    expect(taskBody("# T-001: a\nPhase: R-01.P01\nDepends: none\n\n## Goal\n\ng\n\n<!-- auto: eof -->\n")).toBe("## Goal\n\ng")
    expect(taskBody(renderTaskTodo({ id: "T-002", title: "b", goal: "g", scope: "s", acceptance: "a" }))).toBe(
      "## Goal\n\ng\n\n## Scope\n\ns\n\n## Acceptance\n\na",
    )
  })

  test("taskBody strips the document's own trailing terminator, never a quoted interior one (plans/0208 D3)", () => {
    // The terminator grammar is document-level (endsWithEof reads exactly the
    // last non-empty line): the reader strips that line and no other. A
    // terminator quoted on its own line inside the body is content — the
    // format sketch the formulation todo teaches, a report restating the
    // protocol — and reaches the session's prompt (0131's 38/38 omission was
    // the sessions copying a sketch whose terminator this filter stripped).
    const quoted = [
      "# T-001: a",
      "Phase: R-01.P01",
      "",
      "## Scope",
      "",
      "the sketch to copy:",
      "",
      "## Acceptance",
      "",
      "<acceptance: what counts as done>",
      "",
      "<!-- auto: eof -->",
      "",
      "body continues after the quoted mark",
      "",
      "<!-- auto: eof -->",
      "",
    ].join("\n")
    expect(taskBody(quoted)).toBe(
      "## Scope\n\nthe sketch to copy:\n\n## Acceptance\n\n<acceptance: what counts as done>\n\n<!-- auto: eof -->\n\nbody continues after the quoted mark",
    )
    // A document whose last non-empty line is NOT the mark keeps every line:
    // nothing is stripped from a terminator-less body (the malformed space is
    // the shape check's, never the reader's).
    expect(taskBody("# T-001: a\n\nbody\n")).toBe("body")
  })

  test("the formulation todo's session-facing body carries the format sketch's terminator (plans/0208 D3, beside the goldens)", async () => {
    // The goldens pin the rendered document (terminator present); this pins
    // the body the session's prompt actually renders — loadPlan's read of the
    // todo construction writes. The sketch ends with its terminator and the
    // document ends with its own: the body keeps the first, drops the last.
    const { renderFormulationTodo } = await import("../src/prompt-plan")
    const { promptFacts } = await import("../src/prompt-facts")
    const todo = renderFormulationTodo(promptFacts(), {
      phaseId: "R-01.P01",
      taskIndex: "docs/R-01/P01-implement/tasks.md",
      numberStart: 2,
      charter: "The plan honors the specification.",
    })
    const document = renderTaskTodo({ id: "T-001", title: "Formulate the phase tasks", phase: "R-01.P01", goal: todo.goal, scope: todo.scope, acceptance: todo.acceptance })
    await Bun.write(join(dir, "docs/T-001/todo.md"), document)
    await Bun.write(join(dir, "docs/R-01/P01-implement/tasks.md"), renderTaskIndex("R-01.P01", [{ id: "T-001", title: "Formulate the phase tasks" }]))
    const body = (await loadPlan(dir, phase)).tasks[0]!.body
    // The sketch's terminator survives the read: the copied shape agrees with
    // the protocol line beside it that demands one.
    expect(body).toContain("<acceptance: what counts as done>\n\n<!-- auto: eof -->")
    // Exactly one STANDALONE terminator line — the sketch's; the document's
    // own (its last line) is still stripped. (The protocol sentence's inline
    // mention of the mark is text, not a line.)
    expect(body.split("\n").filter((line) => line.trim() === "<!-- auto: eof -->")).toHaveLength(1)
  })
})

describe("dependencies (M3.5)", () => {
  const withFields = async (id: string, fields: string) => {
    const file = join(dir, "docs", id, "todo.md")
    const text = await Bun.file(file).text()
    const stripped = text.replace(/^(Depends|Touches):.*\n/gm, "")
    await Bun.write(file, stripped.replace("Phase: R-01.P01\n", `Phase: R-01.P01\n${fields}\n`))
  }
  const THREE = "## T-001: a [pending]\nA.\n\n## T-002: b [pending]\nB.\n\n## T-003: c [pending]\nC.\n"

  test("without Depends the order is the index order", async () => {
    expect(next(await seedUnits(dir, THREE))!.id).toBe("T-001")
  })

  test("Depends reorders selection; Touches is read", async () => {
    await seedUnits(dir, THREE)
    await withFields("T-001", "Depends: T-003")
    await withFields("T-003", "Depends: none\nTouches: src/c.ts")
    const plan = await loadPlan(dir, phase)
    expect(plan.tasks[2]).toMatchObject({ depends: "none", touches: ["src/c.ts"] })
    expect(next(plan)!.id).toBe("T-003")
  })

  test("a completed task of another phase may be named; an unknown or cyclic dependency makes the index invalid", async () => {
    await seedUnits(dir, THREE)
    await mkdir(join(dir, "docs/T-000"), { recursive: true })
    await Bun.write(join(dir, "docs/T-000/done.md"), "# T-000: earlier\n")
    expect([...(await doneTaskIds(dir))]).toEqual(["T-000"])
    await withFields("T-001", "Depends: T-000")
    expect(next(await loadPlan(dir, phase))!.id).toBe("T-001")
    await withFields("T-002", "Depends: T-009")
    await expect(loadPlan(dir, phase)).rejects.toThrow("T-002 depends on unknown T-009")
    await withFields("T-002", "Depends: T-003")
    await expect(loadPlan(dir, phase)).rejects.toThrow("dependency cycle")
  })

  test("the subtask checklist carries each S<nn>/todo.md's Depends", async () => {
    await seedUnits(dir, SAMPLE)
    await mkdir(join(dir, "docs/T-003/S01"), { recursive: true })
    await mkdir(join(dir, "docs/T-003/S02"), { recursive: true })
    await Bun.write(join(dir, "docs/T-003/S01/done.md"), "## Scope\n")
    await Bun.write(join(dir, "docs/T-003/S02/todo.md"), "Depends: none\nTouches: src/auth/\n\n## Scope\n")
    expect(await readChecklist(dir, "T-003")).toEqual([
      { text: "routing", done: true },
      { text: "auth", done: false, depends: "none", touches: ["src/auth/"] },
    ])
  })
})

// Add a line to a seeded task document's field block (after `Phase:`).
const withField = async (id: string, file: "todo.md" | "done.md", field: string) => {
  const path = join(dir, "docs", id, file)
  await Bun.write(path, (await Bun.file(path).text()).replace("Phase: R-01.P01\n", `Phase: R-01.P01\n${field}\n`))
}

describe("closed tasks (plans/0053 D16)", () => {
  test("an own closed task stays done and carries its reason", async () => {
    await seedUnits(dir, SAMPLE)
    await withField("T-001", "done.md", "Closed: superseded by T-002")
    const plan = await loadPlan(dir, phase)
    expect(plan.tasks[0]).toMatchObject({ id: "T-001", status: "done", closed: "superseded by T-002" })
    expect([...plan.closed]).toEqual([["T-001", "superseded by T-002"]])
    expect(plan.tasks.slice(1).some((task) => "closed" in task)).toBe(false)
  })

  test("closed external prerequisites named by Depends are read from their done.md", async () => {
    await seedUnits(dir, "## T-001: a [done]\nA.\n\n## T-002: b [pending]\nB.\n")
    await withField("T-001", "done.md", "Closed: obsolete")
    // Done tasks of another phase (not in this index): one closed, one not.
    await Bun.write(join(dir, taskStatePaths("T-050").complete), "# T-050: old\nClosed: dropped\n")
    await Bun.write(join(dir, taskStatePaths("T-051").complete), "# T-051: kept\n")
    await withField("T-002", "todo.md", "Depends: T-051, T-050, T-001")
    const plan = await loadPlan(dir, phase)
    // Own closures first, then external ones; a done external id without Closed: is absent.
    expect([...plan.closed]).toEqual([
      ["T-001", "obsolete"],
      ["T-050", "dropped"],
    ])
  })

  test("without closures the map is empty and no task has a closed key", async () => {
    const plan = await seedUnits(dir, SAMPLE)
    expect(plan.closed.size).toBe(0)
    expect(plan.tasks.some((task) => "closed" in task)).toBe(false)
  })

  test("a Closed: line in todo.md means nothing", async () => {
    await seedUnits(dir, SAMPLE)
    await withField("T-003", "todo.md", "Closed: not yet")
    const plan = await loadPlan(dir, phase)
    expect(plan.closed.size).toBe(0)
    expect(plan.tasks[2]).toMatchObject({ status: "pending" })
    expect("closed" in plan.tasks[2]!).toBe(false)
  })

  test("next treats a closed task as done", async () => {
    await seedUnits(dir, "## T-001: a [done]\nA.\n\n## T-002: b [pending]\nB.\n")
    await withField("T-001", "done.md", "Closed: dropped")
    expect(next(await loadPlan(dir, phase))!.id).toBe("T-002")
  })
})

describe("renderStatus closed marks (plans/0053 D16)", () => {
  const TASKS = "## T-001: a [done]\nA.\n\n## T-002: b [done]\nB.\n\n## T-003: c [pending]\nC.\n"

  test("without closures the lines are unchanged", async () => {
    await seedUnits(dir, TASKS)
    expect(await renderStatus(dir)).toEqual([
      "R-01 (0/1 phases done)",
      "  [▶] P01-implement",
      "      [✓] T-001 a",
      "      [✓] T-002 b",
      "      [ ] T-003 c",
    ])
  })

  test("a closed task shows ⊘; another done task keeps ✓", async () => {
    await seedUnits(dir, TASKS)
    await withField("T-001", "done.md", "Closed: superseded")
    expect(await renderStatus(dir)).toEqual([
      "R-01 (0/1 phases done)",
      "  [▶] P01-implement",
      "      [⊘] T-001 a",
      "      [✓] T-002 b",
      "      [ ] T-003 c",
    ])
  })

  test("a closed phase shows ⊘ and still counts as done", async () => {
    await seedUnits(dir, TASKS)
    const phaseDir = join(dir, phase.dir)
    const todo = await Bun.file(join(phaseDir, "todo.md")).text()
    await Bun.write(join(phaseDir, "done.md"), todo.replace("Type: implement\n", "Type: implement\nClosed: out of scope\n"))
    await rm(join(phaseDir, "todo.md"))
    expect(await renderStatus(dir)).toEqual([
      "R-01 (1/1 phases done)",
      "  [⊘] P01-implement",
      "      [✓] T-001 a",
      "      [✓] T-002 b",
      "      [ ] T-003 c",
    ])
  })
})

describe("renderStatus roadmap supersession (plans/0114 D2; divergence-only since 0136)", () => {
  const divergence = (lines: string[]) =>
    lines.some((line) => line.includes('ℹ phases (config "mt"): R-01\'s line establishes "mtv" under the roadmap of docs/analysis.md'))

  test("a covering line whose phases diverge from the config key names both values once, the line-move channel in the line", async () => {
    await seedUnits(dir, "## T-001: a [pending]\nA.\n")
    await mkdir(join(dir, ".opencode/auto"), { recursive: true })
    await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ phases: "mt" }))
    await Bun.write(join(dir, "docs/analysis.md"), ["# Project analysis", "", "- R-01 mtv — port the core", "", "Clarified: yes", ""].join("\n"))
    const lines = await renderStatus(dir)
    expect(divergence(lines)).toBe(true)
    // Exactly once — not per phase.
    expect(lines.filter((line) => line.includes("line establishes")).length).toBe(1)
  })

  test("an agreeing line is the designed state and names nothing (the 0136 field case)", async () => {
    await seedUnits(dir, "## T-001: a [pending]\nA.\n")
    await mkdir(join(dir, ".opencode/auto"), { recursive: true })
    await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ phases: "mt" }))
    await Bun.write(join(dir, "docs/analysis.md"), ["# Project analysis", "", "- R-01 mt — port the core", "", "Clarified: yes", ""].join("\n"))
    expect((await renderStatus(dir)).some((line) => line.includes("phases (config"))).toBe(false)
    // Spelling equivalence: a type-id list and its letter preset are one value.
    await Bun.write(join(dir, "docs/analysis.md"), ["# Project analysis", "", "- R-01 implement,test — port the core", "", "Clarified: yes", ""].join("\n"))
    expect((await renderStatus(dir)).some((line) => line.includes("phases (config"))).toBe(false)
  })

  test("no analysis, an unreleased one, a round it does not cover, or m mode: no line — the key is the live authority", async () => {
    await seedUnits(dir, "## T-001: a [pending]\nA.\n")
    await mkdir(join(dir, ".opencode/auto"), { recursive: true })
    await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ phases: "mt" }))
    expect(divergence(await renderStatus(dir))).toBe(false)
    await Bun.write(join(dir, "docs/analysis.md"), ["# Project analysis", "", "- R-01 mtv — port the core", ""].join("\n"))
    expect(divergence(await renderStatus(dir))).toBe(false)
    await Bun.write(join(dir, "docs/analysis.md"), ["# Project analysis", "", "- R-02 mtv — later round", "", "Clarified: yes", ""].join("\n"))
    expect(divergence(await renderStatus(dir))).toBe(false)
    await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ phases: "m" }))
    await Bun.write(join(dir, "docs/analysis.md"), ["# Project analysis", "", "- R-01 mtv — port the core", "", "Clarified: yes", ""].join("\n"))
    expect(divergence(await renderStatus(dir))).toBe(false)
  })
})

describe("renderStatus awaiting clarification (plans/0081 D14.3; the ruled condition since 0209 D3, 0165-104)", () => {
  // The re-work bundle's survey type, as `init --intent` materializes it.
  const SURVEY_TYPE = ["# Survey", "", "Gate: human", "Phase-artifacts: survey.md", "", "## plan duties", "", "Inventory-level reading only.", "", "<!-- auto: eof -->", ""].join("\n")

  // A round whose first phase is the human-gated survey with its tasks
  // seeded (each done unless named pending).
  async function surveyRound(tasks: Array<[string, boolean]>): Promise<PhaseUnit> {
    await mkdir(join(dir, ".opencode/auto/phases"), { recursive: true })
    await Bun.write(join(dir, ".opencode/auto/phases/survey.md"), SURVEY_TYPE)
    const [phase] = await syncPhaseIndex(dir, 1, "survey,implement")
    await Bun.write(
      join(dir, phase!.dir, "tasks.md"),
      renderTaskIndex("R-01.P01", tasks.map(([id, done]) => ({ id, title: `task ${id}`, done }))),
    )
    for (const [id, done] of tasks) {
      await mkdir(join(dir, "docs", id), { recursive: true })
      await Bun.write(join(dir, "docs", id, done ? "done.md" : "todo.md"), `# ${id}: task ${id}\nPhase: R-01.P01\n\nbody\n\n<!-- auto: eof -->\n`)
    }
    return phase!
  }

  const noteOf = (lines: string[]) => lines.find((line) => line.includes("awaiting your clarification"))

  test("tasks all done, the survey present with open forks: the note fires, the real dir in the release command", async () => {
    const phase = await surveyRound([["T-001", true]])
    await Bun.write(join(dir, phase.dir, "survey.md"), "# Survey\n\nThe reference's map.\n\nFork: scope — the journal too; Recommend: the core only.\n")
    const lines = await renderStatus(dir)
    const note = noteOf(lines)
    expect(note).toBeDefined()
    // The real directory renders — pre-0209 the line printed the `<dir>`
    // placeholder literally.
    expect(note).toContain(`clarify ${dir} writes and commits the line`)
    expect(note).not.toContain("<dir>")
    expect(note).toContain("resolve the Fork: lines of its survey.md")
  })

  test("a pending task keeps the note quiet — the round is not waiting on the person yet", async () => {
    await surveyRound([["T-001", true], ["T-002", false]])
    await Bun.write(join(dir, "docs/R-01/P01-survey/survey.md"), "# Survey\n\nFork: scope — the journal too; Recommend: the core only.\n")
    expect(noteOf(await renderStatus(dir))).toBeUndefined()
  })

  test("a missing survey is not the person's state: no note (the survey is the session's to write)", async () => {
    await surveyRound([["T-001", true]])
    // Tasks all done, the survey never written — pre-0209 the note fired
    // here, teaching the person to resolve forks in a document that does
    // not exist.
    expect(noteOf(await renderStatus(dir))).toBeUndefined()
  })
})

describe("renderStatus in-flight lanes section (plans/0068 D13, S4)", () => {
  test("lane registry entries open the tree with one section line per lane, worktree and pid beside the unit", async () => {
    await seedUnits(dir, "## T-001: a [pending]\nA.\n\n## T-002: b [pending]\nB.\n")
    await setLane(dir, "T-001", { worktree: join(".auto", "worktrees", "T-001"), pid: 4242 })
    await setLane(dir, "T-002", { worktree: join(".auto", "worktrees", "T-002") })
    expect(await renderStatus(dir)).toEqual([
      "lanes in flight (2):",
      `  [▶] T-001 (worktree .auto/worktrees/T-001, pid 4242)`,
      `  [▶] T-002 (worktree .auto/worktrees/T-002)`,
      "R-01 (0/1 phases done)",
      "  [▶] P01-implement",
      "      [ ] T-001 a",
      "      [ ] T-002 b",
    ])
  })

  test("no lane records: the tree is unchanged (the read model gains exactly the one section)", async () => {
    await seedUnits(dir, "## T-001: a [pending]\nA.\n")
    const lines = await renderStatus(dir)
    expect(lines[0]).toBe("R-01 (0/1 phases done)")
    expect(lines.join("\n")).not.toContain("lanes in flight")
  })
})

describe("renderStatus item titles (plans/0065 F3)", () => {
  test("checklist items print the 60-char-capped display title: a long item is cut with an ellipsis, a description colon and an Artifacts tail are stripped", async () => {
    // A single physical item line carrying scope prose and the declaration —
    // the T-066 decompose shape that dumped whole paragraphs into the tree.
    const long = "survey the artifact declaration pitfalls found across every subsystem"
    const tailed = "short: the wrapped scope text that continues on the next line Artifacts: docs/T-001/S01/record.md, docs/T-001/S02/record.md"
    await seedUnits(dir, `## T-001: a [in_progress]\nA.\n\n- [ ] ${long}\n- [ ] ${tailed}\n`)
    expect(await renderStatus(dir)).toEqual([
      "R-01 (0/1 phases done)",
      "  [▶] P01-implement",
      "      [▶] T-001 a [subtasks 0/2]",
      "          [ ] S01 survey the artifact declaration pitfalls found across every…",
      "          [ ] S02 short",
    ])
  })
})

describe("runtime state (.auto/units.json)", () => {
  test("begin sets in_progress and counts attempts; resetInProgress clears only the status", async () => {
    await seedUnits(dir, SAMPLE)
    await begin(dir, "T-003")
    await begin(dir, "T-003")
    let plan = await loadPlan(dir, phase)
    expect(plan.tasks[2]).toMatchObject({ status: "in_progress", attempts: 2 })
    expect(await resetInProgress(dir)).toEqual(["T-003"])
    plan = await loadPlan(dir, phase)
    expect(plan.tasks[2]).toMatchObject({ status: "pending", attempts: 2 })
  })

  test("block records blocked; setForkBase persists the base", async () => {
    await seedUnits(dir, SAMPLE)
    await block(dir, "T-003")
    await setForkBase(dir, "T-003", "digest:ses_1")
    const t3 = (await loadPlan(dir, phase)).tasks[2]!
    expect(t3.status).toBe("blocked")
    expect(t3.forkBase).toBe("digest:ses_1")
  })

  // The fork base per agent (plans/0055 §8.2, §8.4): under a registry the
  // persisted record is a map from agent profile to base; a plain string is
  // the one-agent era's record and reads as the run's (the default) agent's.
  // Without an agent setForkBase keeps the plain string, byte-identical to
  // the old shape.
  test("setForkBase with an agent writes the per-agent map and keeps the other agents' entries", async () => {
    await seedUnits(dir, SAMPLE)
    await setForkBase(dir, "T-003", "digest:ses_op", "opencode")
    await setForkBase(dir, "T-003", "digest:ses_cl", "claude-b")
    expect((await loadPlan(dir, phase)).tasks[2]!.forkBase).toEqual({ opencode: "digest:ses_op", "claude-b": "digest:ses_cl" })
    // Rewriting one agent's base keeps the other's entry (a base per agent).
    await setForkBase(dir, "T-003", "digest:ses_op2", "opencode")
    expect((await loadPlan(dir, phase)).tasks[2]!.forkBase).toEqual({ opencode: "digest:ses_op2", "claude-b": "digest:ses_cl" })
    // The stored shape is the map itself.
    expect(JSON.parse(await Bun.file(join(dir, UNITS_FILE)).text()).tasks["T-003"].forkBase).toEqual({
      opencode: "digest:ses_op2",
      "claude-b": "digest:ses_cl",
    })
  })

  test("setForkBase without an agent keeps the plain string (the no-registry shape is unchanged)", async () => {
    await seedUnits(dir, SAMPLE)
    await setForkBase(dir, "T-003", "digest:ses_1")
    expect(JSON.parse(await Bun.file(join(dir, UNITS_FILE)).text()).tasks["T-003"].forkBase).toBe("digest:ses_1")
  })

  test("forkBaseFor: a plain string is the run's (default) agent's; a map holds only the reading agent's entry", async () => {
    await seedUnits(dir, SAMPLE)
    // One-agent era record: a plain string reads for the run's agent (the
    // sole reader until the agent pool; forkBaseFor cannot tell which agent a
    // pre-binding string belonged to, and by construction its reader is the
    // one agent that ran then).
    await setForkBase(dir, "T-003", "digest:ses_old")
    const task = (await loadPlan(dir, phase)).tasks[2]!
    expect(forkBaseFor(task.forkBase, "opencode")).toBe("digest:ses_old")
    expect(forkBaseFor(task.forkBase, "claude-b")).toBe("digest:ses_old")
    // A map: only the reading agent's entry applies.
    await setForkBase(dir, "T-003", "digest:ses_cl", "claude-b")
    const mapped = (await loadPlan(dir, phase)).tasks[2]!.forkBase
    expect(forkBaseFor(mapped, "claude-b")).toBe("digest:ses_cl")
    expect(forkBaseFor(mapped, "opencode")).toBeUndefined()
    // A map read without an agent (no registry) owns nothing: the base is
    // rebuilt rather than guessed.
    expect(forkBaseFor(mapped, undefined)).toBeUndefined()
    expect(forkBaseFor(undefined, "opencode")).toBeUndefined()
  })

  test("a map with non-string values degrades: only the string entries load; garbage drops to no base", async () => {
    await seedUnits(dir, SAMPLE)
    await mkdir(join(dir, ".auto"), { recursive: true })
    await Bun.write(join(dir, UNITS_FILE), JSON.stringify({ tasks: { "T-003": { forkBase: { opencode: "digest:ses_1", "claude-b": 7 } } } }))
    expect((await loadPlan(dir, phase)).tasks[2]!.forkBase).toEqual({ opencode: "digest:ses_1" })
    await Bun.write(join(dir, UNITS_FILE), JSON.stringify({ tasks: { "T-003": { forkBase: ["digest:ses_1"] } } }))
    expect((await loadPlan(dir, phase)).tasks[2]!.forkBase).toBeUndefined()
  })

  test("an unreadable units.json degrades to defaults", async () => {
    await seedUnits(dir, SAMPLE)
    await Bun.write(join(dir, UNITS_FILE), "{broken")
    expect((await loadPlan(dir, phase)).tasks[1]).toMatchObject({ status: "pending", attempts: 0 })
  })

  // plans/0236 D1 (0165-042): the two fields every consumer once read raw.
  test("a hand-edited runtime \"done\" and a string attempts read as pending/0 — done stays done.md's alone (0047 R1), and begin books a number, never \"71\"", async () => {
    await seedUnits(dir, SAMPLE)
    await mkdir(join(dir, ".auto"), { recursive: true })
    // T-002's blocked entry kept as the seed wrote it; T-003's is the
    // hand-edit under test.
    await Bun.write(join(dir, UNITS_FILE), JSON.stringify({ tasks: { "T-002": { status: "blocked", attempts: 1 }, "T-003": { status: "done", attempts: "7" } } }))
    // T-003's unit file is todo.md: the runtime "done" cannot close it —
    // the task runs, its dependents wait for the real thing.
    const plan = await loadPlan(dir, phase)
    expect(plan.tasks[2]).toMatchObject({ status: "pending", attempts: 0 })
    // The well-formed sibling keeps its live word (identity on valid input).
    expect(plan.tasks[1]).toMatchObject({ status: "blocked", attempts: 1 })
    expect(await unitAttempts(dir, "T-003")).toBe(0)
    await begin(dir, "T-003")
    const after = (await loadPlan(dir, phase)).tasks[2]!
    expect(after).toMatchObject({ status: "in_progress" })
    expect(after.attempts).toBe(1)
    expect(typeof after.attempts).toBe("number")
    // The sanitized shape persisted: the next read sees the healed entry
    // (the well-formed sibling untouched).
    expect(JSON.parse(await Bun.file(join(dir, UNITS_FILE)).text())).toEqual({
      tasks: { "T-002": { status: "blocked", attempts: 1 }, "T-003": { status: "in_progress", attempts: 1 } },
    })
  })

  // plans/0236 D2 (0165-151): the parse failure names itself and the next
  // write preserves the evidence instead of silently replacing it.
  test("an unparseable units.json notes one ⚠ line and the next write moves the corrupt bytes aside — the lane records survive for hand recovery", async () => {
    await seedUnits(dir, SAMPLE)
    await setLane(dir, "T-003", { worktree: join(".auto", "worktrees", "T-003"), pid: 4242 })
    await setParked(dir, "T-002", "T-001")
    const corrupt = await Bun.file(join(dir, UNITS_FILE)).text()
    await Bun.write(join(dir, UNITS_FILE), `${corrupt},,`)
    const lines: string[] = []
    const printed = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(" "))
    })
    try {
      // The read degrades: no lane record, no park (the safe defaults).
      expect(await laneRecords(dir)).toEqual([])
      expect((await loadPlan(dir, phase)).tasks[1]!.parked).toBeUndefined()
      // One ⚠ names the file and what its loss means — once, not per read.
      await loadPlan(dir, phase)
      await unitAttempts(dir, "T-001")
      const warnings = lines.filter((line) => line.includes("is unparseable and reads as empty"))
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain("lane records, parks and split points are lost")
      expect(warnings[0]).toContain("units.json.corrupt-<timestamp>")
    } finally {
      printed.mockRestore()
    }
    // The next write starts fresh — and the corrupt bytes survive beside it.
    await begin(dir, "T-003")
    expect(JSON.parse(await Bun.file(join(dir, UNITS_FILE)).text())).toEqual({ tasks: { "T-003": { status: "in_progress", attempts: 1 } } })
    const aside = Array.from(new Bun.Glob(".auto/units.json.corrupt-*").scanSync({ cwd: dir }))
    expect(aside).toHaveLength(1)
    expect(await Bun.file(join(dir, aside[0]!)).text()).toBe(`${corrupt},,`)
  })
})

describe("driver completion", () => {
  test("markDone renames todo.md, ticks the index line and drops the runtime entry; idempotent", async () => {
    const plan = await seedUnits(dir, SAMPLE)
    await begin(dir, "T-003")
    await markDone(plan, "T-003")
    await markDone(plan, "T-003")
    expect(await Bun.file(join(dir, "docs/T-003/todo.md")).exists()).toBe(false)
    expect(await Bun.file(join(dir, "docs/T-003/done.md")).exists()).toBe(true)
    expect(await Bun.file(join(dir, plan.index)).text()).toContain("- [x] T-003 Write the API")
    const t3 = (await loadPlan(dir, phase)).tasks[2]!
    expect(t3).toMatchObject({ status: "done", attempts: 0 })
  })

  test("tickSubtask ticks the n-th checklist line of subtasks.md", async () => {
    await seedUnits(dir, SAMPLE)
    await tickSubtask(dir, "T-003", 2)
    await tickSubtask(dir, "T-003", 2)
    expect(subtasks(await Bun.file(join(dir, "docs/T-003/subtasks.md")).text()).map((item) => item.done)).toEqual([true, true])
  })

  // Plans/0158: the lanes tick re-derivation (lanes.ts calls it at landing
  // over adjacent ticks no textual merge survives) gets its first direct
  // home — the fixture drives the parser, the state scan and the writer the
  // lane landing composes.
  test("syncChecklistTicks re-derives every tick from the S<nn> state files over a stale checklist", async () => {
    await seedUnits(dir, SAMPLE)
    await mkdir(join(dir, "docs/T-003/S01"), { recursive: true })
    await mkdir(join(dir, "docs/T-003/S02"), { recursive: true })
    await Bun.write(join(dir, "docs/T-003/S01/done.md"), "scope\n")
    await Bun.write(join(dir, "docs/T-003/S02/todo.md"), "scope\n")
    // Two lanes ticked adjacently and landed without a textual merge: the
    // checklist ticks are the stale view (both flipped), the state files
    // the progress fact (S01 done, S02 open).
    await Bun.write(join(dir, "docs/T-003/subtasks.md"), "- [ ] routing\n- [x] auth\n")
    expect(await syncChecklistTicks(dir, "T-003")).toEqual(["S01", "S02"])
    const text = await Bun.file(join(dir, "docs/T-003/subtasks.md")).text()
    expect(text).toBe("- [x] routing\n- [ ] auth\n")
    expect(subtasks(text).map((item) => item.done)).toEqual([true, false])
    // Idempotent: a second pass over the re-derived truth changes nothing.
    expect(await syncChecklistTicks(dir, "T-003")).toEqual([])
    // A task without a checklist (or without state files) changes nothing.
    expect(await syncChecklistTicks(dir, "T-001")).toEqual([])
  })
})

describe("planning output", () => {
  // Long enough to pass the non-trivial shape threshold.
  const GOAL = "Deliver the migrated module with the same behavior as the source, documented where it differs."
  const writeTask = async (id: string, extra: Partial<Parameters<typeof renderTaskTodo>[0]> = {}) => {
    await mkdir(join(dir, "docs", id), { recursive: true })
    await Bun.write(join(dir, "docs", id, "todo.md"), renderTaskTodo({ id, title: id, phase: "R-01.P01", goal: GOAL, scope: "src/a.ts and src/b.ts only", acceptance: "bun test passes", ...extra }))
  }

  test("accepts an index with complete task documents", async () => {
    await Bun.write(join(dir, phase.dir, "tasks.md"), renderTaskIndex("R-01.P01", [{ id: "T-001", title: "a" }, { id: "T-002", title: "b" }]))
    await writeTask("T-001")
    await writeTask("T-002")
    expect(await plannedTaskProblems(dir, phase, { before: new Set() })).toEqual({ problems: [], ids: ["T-001", "T-002"] })
  })

  test("reports a missing index, an empty index, missing sections, a wrong Phase field and taken ids", async () => {
    expect((await plannedTaskProblems(dir, phase, { before: new Set() })).problems[0]).toContain("tasks.md is missing")
    await Bun.write(join(dir, phase.dir, "tasks.md"), "# Tasks\n")
    expect((await plannedTaskProblems(dir, phase, { before: new Set() })).problems[0]).toContain("lists no task")
    await Bun.write(join(dir, phase.dir, "tasks.md"), renderTaskIndex("R-01.P01", [{ id: "T-001", title: "a" }, { id: "T-002", title: "b" }, { id: "T-003", title: "c" }]))
    await mkdir(join(dir, "docs/T-001"), { recursive: true })
    await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001: a\nPhase: R-01.P01\n\n## Goal\n\ng\n\n<!-- auto: eof -->\n")
    await writeTask("T-002", { phase: "R-09.P09" })
    await writeTask("T-003")
    const { problems } = await plannedTaskProblems(dir, phase, { before: new Set(["T-003"]) })
    expect(problems.some((p) => p.includes("docs/T-001/todo.md") && p.includes("## Scope"))).toBe(true)
    expect(problems.some((p) => p.includes("docs/T-002/todo.md must carry the field line `Phase: R-01.P01`"))).toBe(true)
    expect(problems.some((p) => p.startsWith("T-003 is already used"))).toBe(true)
  })

  test("reports dependency problems among the planned tasks", async () => {
    await Bun.write(join(dir, phase.dir, "tasks.md"), renderTaskIndex("R-01.P01", [{ id: "T-001", title: "a" }, { id: "T-002", title: "b" }]))
    await writeTask("T-001", { depends: "T-002" })
    await writeTask("T-002", { depends: "", touches: "/etc/x" })
    const { problems } = await plannedTaskProblems(dir, phase, { before: new Set() })
    expect(problems).toContain("docs/R-01/P01-implement/tasks.md: T-002 has an empty Depends value (write `Depends: none` for no prerequisite)")
    expect(problems.some((p) => p.includes("touches an absolute path: /etc/x"))).toBe(true)
    await writeTask("T-002", { depends: "T-001" })
    expect((await plannedTaskProblems(dir, phase, { before: new Set() })).problems.some((p) => p.includes("dependency cycle: T-001 -> T-002 -> T-001"))).toBe(true)
  })

  // The planning collect validates the Decompose value set too (plans/0075):
  // the session hears the problem line as retry feedback, and a valid field
  // rides the decl (newTaskProblems → taskDecl) into the graph check.
  test("the Decompose field: a valid value passes and rides the decl; an unknown value is reported", async () => {
    await Bun.write(join(dir, phase.dir, "tasks.md"), renderTaskIndex("R-01.P01", [{ id: "T-001", title: "a" }]))
    await writeTask("T-001", { decompose: "split" })
    expect(await newTaskProblems(dir, phase, "T-001", { before: new Set() })).toEqual({
      problems: [],
      decl: { id: "T-001", decompose: "split" },
    })
    expect(await plannedTaskProblems(dir, phase, { before: new Set() })).toEqual({ problems: [], ids: ["T-001"] })
    await writeTask("T-001", { decompose: "sometimes" })
    expect((await plannedTaskProblems(dir, phase, { before: new Set() })).problems).toContain(
      "docs/R-01/P01-implement/tasks.md: T-001 has an unknown Decompose value \"sometimes\" (write split, whole, pipeline, or omit the field)",
    )
  })

  test("the numbering start rejects lower ids", async () => {
    await Bun.write(join(dir, phase.dir, "tasks.md"), renderTaskIndex("R-01.P01", [{ id: "T-004", title: "a" }]))
    await writeTask("T-004")
    const { problems } = await plannedTaskProblems(dir, phase, { before: new Set(), numberStart: 7 })
    expect(problems[0]).toContain("below the numbering start T-007")
  })

  test("newTaskProblems (0053 D24, the single-task check split out of plannedTaskProblems): rejects taken ids / ids below the numbering start / substandard documents; a valid one carries its dependency declaration", async () => {
    // valid: no problems, the decl is attached (same single read, for whole-index callers to assemble the dependency graph)
    await writeTask("T-005", { depends: "none" })
    expect(await newTaskProblems(dir, phase, "T-005", { before: new Set() })).toEqual({
      problems: [],
      decl: { id: "T-005", depends: "none" },
    })
    // the number is taken by a task that existed before the session → rejected, no decl
    expect(await newTaskProblems(dir, phase, "T-005", { before: new Set(["T-005"]) })).toMatchObject({
      problems: ["T-005 is already used by an earlier task (docs/T-005/ existed before this planning session); pick an unused number"],
    })
    // below the auto-numbering start → rejected
    expect((await newTaskProblems(dir, phase, "T-005", { before: new Set(), numberStart: 8 })).problems).toEqual([
      "T-005 is below the numbering start T-008; earlier numbers are taken",
    ])
    // a substandard document (missing the Scope section) → the spec check reports, no decl
    await mkdir(join(dir, "docs/T-006"), { recursive: true })
    await Bun.write(join(dir, "docs/T-006/todo.md"), "# T-006: a\nPhase: R-01.P01\n\n## Goal\n\ng\n\n<!-- auto: eof -->\n")
    const bad = await newTaskProblems(dir, phase, "T-006", { before: new Set() })
    expect(bad.problems.some((p) => p.includes("docs/T-006/todo.md") && p.includes("## Scope"))).toBe(true)
    expect(bad.decl).toBeUndefined()
    // wrong Phase field → reported but the decl is still attached (same behavior as before the split: only a spec failure skips the decl)
    await writeTask("T-007", { phase: "R-09.P09" })
    const wrongPhase = await newTaskProblems(dir, phase, "T-007", { before: new Set() })
    expect(wrongPhase.problems).toEqual(["docs/T-007/todo.md must carry the field line `Phase: R-01.P01` right after its title line"])
    expect(wrongPhase.decl).toEqual({ id: "T-007" })
  })

  // The field block's near-miss scan (ruling 0228 D2, enacting 0165-152 /
  // S21-04): a blank line, a comment or a near-miss colon form between the
  // title and the body silently ended the block — a planned task's declared
  // Depends/Touches/Decompose/Artifacts vanished with no problem line
  // (Depends fell to the previous sibling, the marker guards of 0171 D6 /
  // 0205 D2 covered only what parsed). The collect now reports the line.
  test("near-miss field-block shapes are planning problems with the contiguity remedy (0228 D2)", async () => {
    // a blank line between fields: Depends sat outside the block, silently dropped
    await mkdir(join(dir, "docs/T-010"), { recursive: true })
    await Bun.write(
      join(dir, "docs/T-010/todo.md"),
      "# T-010: a\nPhase: R-01.P01\n\nDepends: none\n\n## Goal\n\ng\n\n## Scope\n\nsrc/a.ts only\n\n## Acceptance\n\nbun test passes\n\n<!-- auto: eof -->\n",
    )
    const blank = await newTaskProblems(dir, phase, "T-010", { before: new Set() })
    expect(blank.problems).toContain(
      "docs/T-010/todo.md line 4 names the field `Depends:` outside the field block (a blank line, a comment or a near-miss colon form ended the block early) — keep the field lines contiguous right after the title line",
    )
    // the decl still rides (only a spec failure withholds it) — the graph
    // check consumes the parsed fields while the retry feedback fixes the doc
    expect(blank.decl).toEqual({ id: "T-010" })
    // a `Closed:` in near-miss shape: the marker guard's outside-block arm
    await mkdir(join(dir, "docs/T-011"), { recursive: true })
    await Bun.write(
      join(dir, "docs/T-011/todo.md"),
      "# T-011: a\nPhase: R-01.P01\n\n**Closed:** superseded\n\n## Goal\n\ng\n\n## Scope\n\nsrc/a.ts only\n\n## Acceptance\n\nbun test passes\n\n<!-- auto: eof -->\n",
    )
    const closed = await newTaskProblems(dir, phase, "T-011", { before: new Set() })
    expect(closed.problems).toContain(
      "docs/T-011/todo.md line 4 names the field `Closed:` outside the field block (a blank line, a comment or a near-miss colon form ended the block early) — keep the field lines contiguous right after the title line",
    )
    // a repeated key: last-wins is no longer silent
    await mkdir(join(dir, "docs/T-012"), { recursive: true })
    await Bun.write(
      join(dir, "docs/T-012/todo.md"),
      "# T-012: a\nPhase: R-01.P01\nDepends: T-003\nDepends: none\n\n## Goal\n\ng\n\n## Scope\n\nsrc/a.ts only\n\n## Acceptance\n\nbun test passes\n\n<!-- auto: eof -->\n",
    )
    const dup = await newTaskProblems(dir, phase, "T-012", { before: new Set() })
    expect(dup.problems).toContain("docs/T-012/todo.md line 3's `depends:` is repeated at line 4 — the later line silently replaced the earlier; declare each field once")
    // the colon tolerance's floor: the fullwidth form in block position parses
    // (no problem, the field read) — same behavior as `Depends: none`
    await mkdir(join(dir, "docs/T-013"), { recursive: true })
    await Bun.write(
      join(dir, "docs/T-013/todo.md"),
      "# T-013: a\nPhase: R-01.P01\nDepends： none\n\n## Goal\n\ng\n\n## Scope\n\nsrc/a.ts only\n\n## Acceptance\n\nbun test passes\n\n<!-- auto: eof -->\n",
    )
    const fullwidth = await newTaskProblems(dir, phase, "T-013", { before: new Set() })
    expect(fullwidth.problems).toEqual([])
    expect(fullwidth.decl).toEqual({ id: "T-013", depends: "none" })
  })

  test("taken ids = other phases' indexes and completed tasks; resetPlanning clears only this phase's own output", async () => {
    const [p1, p2] = await syncPhaseIndex(dir, 1, "adm")
    await Bun.write(join(dir, p1!.dir, "tasks.md"), renderTaskIndex("R-01.P01", [{ id: "T-001", title: "a" }]))
    await mkdir(join(dir, "docs/T-001"), { recursive: true })
    await Bun.write(join(dir, "docs/T-001/done.md"), "# T-001: a\n")
    await mkdir(join(dir, "docs/T-009"), { recursive: true })
    await Bun.write(join(dir, "docs/T-009/done.md"), "# T-009: stray done\n")
    await Bun.write(join(dir, p2!.dir, "tasks.md"), renderTaskIndex("R-01.P02", [{ id: "T-001", title: "reused" }, { id: "T-002", title: "b" }]))
    await writeTask("T-002")
    expect([...(await takenTaskIds(dir, p2!))].sort()).toEqual(["T-001", "T-009"])
    await resetPlanning(dir, p2!)
    expect(await Bun.file(join(dir, p2!.dir, "tasks.md")).exists()).toBe(false)
    expect(await Bun.file(join(dir, "docs/T-002/todo.md")).exists()).toBe(false)
    expect(await Bun.file(join(dir, "docs/T-001/done.md")).exists()).toBe(true)
  })
})

describe("renderStatus review-seam note (plans/0101 D3/D4)", () => {
  test("the current phase's standing plan task reads as awaiting your review; a done one does not", async () => {
    // The driver-constructed formulation task: the Formulate field naming the
    // owning phase, pending in the index.
    await Bun.write(
      join(dir, phase.dir, "tasks.md"),
      renderTaskIndex("R-01.P01", [{ id: "T-001", title: "Formulate the Implementation tasks", done: false }]),
    )
    await mkdir(join(dir, "docs", "T-001"), { recursive: true })
    await Bun.write(
      join(dir, "docs/T-001/todo.md"),
      "# T-001: Formulate the Implementation tasks\nPhase: R-01.P01\nFormulate: R-01.P01\n\nbody\n\n<!-- auto: eof -->\n",
    )
    expect(await renderStatus(dir)).toEqual([
      "R-01 (0/1 phases done)",
      "  [▶] P01-implement (plan task awaiting your review — dispatch with `plan`, or fix the todo's inputs and re-run `transfer`)",
      "      [ ] T-001 Formulate the Implementation tasks",
    ])
    // Dispatched and done: the note goes quiet (the phase routes on).
    await Bun.write(
      join(dir, phase.dir, "tasks.md"),
      renderTaskIndex("R-01.P01", [{ id: "T-001", title: "Formulate the Implementation tasks", done: true }]),
    )
    await rename(join(dir, "docs/T-001/todo.md"), join(dir, "docs/T-001/done.md"))
    expect(await renderStatus(dir)).toEqual([
      "R-01 (0/1 phases done)",
      "  [▶] P01-implement",
      "      [✓] T-001 Formulate the Implementation tasks",
    ])
  })
})
