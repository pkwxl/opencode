// The formulation task's construction (plans/0095): the charter-as-acceptance
// assembly, the on-disk state machine (none / pending / foreign), the
// idempotent landing (rewrite-on-diff, never in flight), the commit grammar
// (PLAN formulate, stage phase-formulate), and the recognition the loop, the
// runner's collect and closeUnit share.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { syncPhaseIndex, type PhaseUnit } from "../src/phases"
import { phaseType } from "../src/phases/registry"
import { constructFormulation, formulationAcceptance, formulationNumber, formulationState, formulateTitle, isFormulation } from "../src/formulate"
import { loadPlan, renderTaskIndex, taskIndexPath } from "../src/tasks"
import { promptFacts } from "../src/prompt-facts"
import { freshRepo, git } from "./fixtures/runner"

let dir: string
let phase: PhaseUnit

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "auto-formulate-"))
  ;[phase] = await syncPhaseIndex(dir, 1, "m")
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const BODY = {
  goal: "Formulate the implementation work's complete task plan.",
  scope: "This document is the single input of this formulation task (fixture).",
  acceptance: formulationAcceptance(promptFacts()),
}

describe("the charter-as-acceptance (plans/0095 D2)", () => {
  test("the generic core states the checkable plan-quality bar", () => {
    const text = formulationAcceptance(promptFacts())
    expect(text).toContain("is covered by some planned task's scope, or explicitly deferred with the reason recorded")
    expect(text).toContain("verify by inspecting the work")
    expect(text).toContain("executable from its own document plus docs/ alone")
    expect(text).toContain("AUTO-RESOLVE / AUTO-DECISION")
    expect(text).not.toContain("verify-plan")
  })

  test("a pack's verify-plan charter is appended verbatim when declared", async () => {
    const overlay = join(dir, ".opencode", "auto", "intents")
    mkdirSync(overlay, { recursive: true })
    writeFileSync(
      join(overlay, "default.md"),
      "# default\n\n## guarantees\n\n### verify-plan\n\nCHARTER-SENTENCE the plan must serve.\n",
    )
    const text = formulationAcceptance(promptFacts({ dir }))
    expect(text).toContain("The project's intent charter binds this plan in addition")
    expect(text).toContain("CHARTER-SENTENCE the plan must serve.")
    expect(text.indexOf("verify by inspecting the work")).toBeLessThan(text.indexOf("CHARTER-SENTENCE"))
  })

  // The per-phase charter channel (plans/0097 D1): the resolved charter —
  // global + the phase key's own refinement — rides the acceptance.
  test("a phase's own verify-plan-<key> charter refines the global one (0097 D1)", async () => {
    const overlay = join(dir, ".opencode", "auto", "intents")
    mkdirSync(overlay, { recursive: true })
    writeFileSync(
      join(overlay, "default.md"),
      [
        "# default",
        "",
        "## guarantees",
        "",
        "### verify-plan",
        "",
        "GLOBAL-CHARTER-SENTENCE.",
        "",
        "### verify-plan-t",
        "",
        "TEST-CHARTER-SENTENCE the test plan must establish.",
        "",
      ].join("\n"),
    )
    const facts = promptFacts({ dir })
    // No phase entry: the global charter alone (m mode's resolution, D10).
    const manual = formulationAcceptance(facts)
    expect(manual).toContain("GLOBAL-CHARTER-SENTENCE.")
    expect(manual).not.toContain("TEST-CHARTER-SENTENCE")
    // The test phase's entry resolves both, global first under its lead-in —
    // the letter key is the legacy spelling resolution still honors (0100 D9).
    const test = formulationAcceptance(facts, phaseType("test"))
    expect(test).toContain("GLOBAL-CHARTER-SENTENCE.")
    expect(test).toContain("The phase's own plan charter (verify-plan-t)")
    expect(test).toContain("TEST-CHARTER-SENTENCE the test plan must establish.")
    expect(test.indexOf("GLOBAL-CHARTER-SENTENCE.")).toBeLessThan(test.indexOf("TEST-CHARTER-SENTENCE"))
    // An entry the pack does not declare a charter for keeps the global-only
    // acceptance — a pack declaring only verify-plan-t is floor everywhere else.
    const other = formulationAcceptance(facts, phaseType("implement"))
    expect(other).toContain("GLOBAL-CHARTER-SENTENCE.")
    expect(other).not.toContain("TEST-CHARTER-SENTENCE")
    // A pack declaring only the phase charter: the phase resolves it, every
    // other phase (and m mode) keeps the bare generic core.
    writeFileSync(
      join(overlay, "default.md"),
      "# default\n\n## guarantees\n\n### verify-plan-t\n\nTEST-CHARTER-SENTENCE only.\n",
    )
    const fresh = promptFacts({ dir })
    expect(formulationAcceptance(fresh, phaseType("test"))).toContain("TEST-CHARTER-SENTENCE only.")
    expect(formulationAcceptance(fresh, phaseType("implement"))).not.toContain("TEST-CHARTER-SENTENCE")
    expect(formulationAcceptance(fresh)).not.toContain("The project's intent charter binds")
  })
})

describe("the formulation state (plans/0095 D1/D4)", () => {
  test("none: a missing or empty index; foreign: other work listed", async () => {
    expect(await formulationState(dir, phase)).toEqual({ type: "none" })
    await Bun.write(join(dir, taskIndexPath(phase)), renderTaskIndex("R-01.P01", []))
    expect(await formulationState(dir, phase)).toEqual({ type: "none" })
    // Another task listed (hand-added, its document beside it so the index
    // loads): the constructor has no business here.
    const other = join(dir, "docs", "T-004")
    mkdirSync(other, { recursive: true })
    await Bun.write(join(other, "todo.md"), "# T-004: task T-004\nPhase: R-01.P01\n\n## Goal\n\nG.\n\n## Scope\n\nS.\n\n## Acceptance\n\nA.\n\n<!-- auto: eof -->\n")
    await Bun.write(join(dir, taskIndexPath(phase)), renderTaskIndex("R-01.P01", [{ id: "T-004", title: "task T-004" }]))
    expect(await formulationState(dir, phase)).toEqual({ type: "foreign" })
  })

  test("pending: the formulation unit alone, with its runtime status", async () => {
    const landed = await constructFormulation(dir, phase, BODY)
    expect(landed.type).toBe("constructed")
    expect(await formulationState(dir, phase)).toEqual({ type: "pending", id: "T-001", inProgress: false })
    // Mark the unit in_progress the way begin() does.
    const { begin } = await import("../src/tasks")
    await begin(dir, "T-001")
    expect(await formulationState(dir, phase)).toEqual({ type: "pending", id: "T-001", inProgress: true })
  })

  test("the number preview matches the allocation (a pending unit keeps its id)", async () => {
    expect(await formulationNumber(dir, phase, false)).toBe(1)
    const landed = await constructFormulation(dir, phase, BODY)
    expect(landed.type).toBe("constructed")
    if (landed.type === "constructed") expect(landed.numberStart).toBe(2)
    expect(await formulationNumber(dir, phase, false)).toBe(1)
  })
})

describe("the construction landing (plans/0095 D1)", () => {
  let repo: string
  beforeEach(async () => {
    repo = await freshRepo()
    ;[phase] = await syncPhaseIndex(repo, 1, "m")
    await git(repo, "add", "-A")
    await git(repo, "commit", "-qm", "setup")
  })
  afterEach(async () => {
    await rm(repo, { recursive: true, force: true })
  })

  test("fresh: the todo's shape and grammar, the index's first line, the PLAN formulate commit", async () => {
    const landed = await constructFormulation(repo, phase, BODY, { autoNumber: false })
    expect(landed).toEqual({ type: "constructed", id: "T-001", numberStart: 2 })
    if (landed.type !== "constructed") throw new Error("unreachable")
    const todo = await Bun.file(join(repo, "docs/T-001/todo.md")).text()
    expect(todo).toContain("# T-001: Formulate the Implementation tasks")
    for (const field of ["Phase: R-01.P01", "Formulate: R-01.P01", "Decompose: whole", "Depends: none"]) {
      expect(todo).toContain(field)
    }
    expect(todo).toContain("## Goal\n\n" + BODY.goal)
    expect(todo).toContain("## Scope\n\n" + BODY.scope)
    expect(todo).toContain("## Acceptance\n\n" + BODY.acceptance)
    expect(await Bun.file(join(repo, taskIndexPath(phase))).text()).toContain("- [ ] T-001 Formulate the Implementation tasks")
    const subject = (await git(repo, "log", "--format=%s", "-1")).trim()
    expect(subject).toBe("PLAN formulate P01-implement Implementation")
    const body = await git(repo, "log", "--format=%B", "-1")
    expect(body).toContain("Auto-Stage: phase-formulate")
    // Recognition: the loaded task carries the formulate field.
    const plan = await loadPlan(repo, phase)
    expect(isFormulation(plan.tasks[0]!, phase)).toBe(true)
    expect(formulateTitle(phase)).toBe("Formulate the Implementation tasks")
  })

  test("idempotent: an unchanged body re-lands nothing; a changed body rewrites in its own commit", async () => {
    const first = await constructFormulation(repo, phase, BODY, { autoNumber: false })
    if (first.type !== "constructed") throw new Error(`expected constructed, got ${first.type}`)
    const again = await constructFormulation(repo, phase, BODY, { autoNumber: false })
    expect(again).toEqual({ type: "current", id: first.id, numberStart: 2 })
    expect((await git(repo, "rev-list", "--count", "HEAD")).trim()).toBe("2")
    const changed = await constructFormulation(repo, phase, { ...BODY, scope: BODY.scope + "\n\nAn amended source list." }, { autoNumber: false })
    expect(changed).toEqual({ type: "current", id: first.id, numberStart: 2 })
    expect(await Bun.file(join(repo, "docs/T-001/todo.md")).text()).toContain("An amended source list.")
    expect((await git(repo, "rev-list", "--count", "HEAD")).trim()).toBe("3")
    expect((await git(repo, "log", "--format=%s", "-1")).trim()).toBe("PLAN formulate P01-implement Implementation")
  })

  test("in flight: a formulation unit already in_progress is never rewritten", async () => {
    await constructFormulation(repo, phase, BODY, { autoNumber: false })
    const { begin } = await import("../src/tasks")
    await begin(repo, "T-001")
    const refused = await constructFormulation(repo, phase, { ...BODY, scope: "a changed scope" }, { autoNumber: false })
    expect(refused.type).toBe("failed")
    expect(refused.type === "failed" && refused.question).toContain("already in progress")
    expect(await Bun.file(join(repo, "docs/T-001/todo.md")).text()).toContain(BODY.scope)
  })

  test("foreign: the constructor refuses a phase whose index lists other work", async () => {
    await Bun.write(join(repo, taskIndexPath(phase)), renderTaskIndex("R-01.P01", [{ id: "T-009", title: "hand-listed" }]))
    const refused = await constructFormulation(repo, phase, BODY, { autoNumber: false })
    expect(refused.type).toBe("failed")
    expect(existsSync(join(repo, "docs/T-001"))).toBe(false)
  })
})
