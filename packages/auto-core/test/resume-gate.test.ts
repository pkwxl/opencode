// Unit tests for src/resume-gate.ts: the recovery point's unit-ownership gate (unitReruns/phaseText) and the interruption-recovery note (resumeNote).
// Split out of test/runner.test.ts (plans/0024-module-split-plan.md S18, pure move).

import { describe, expect, test } from "bun:test"
import type { Phase } from "../src/resume"
import { phaseText, resumeNote, unitReruns, type UnitRerunCtx } from "../src/resume-gate"

describe("unitReruns (the recovery point's unit-ownership gate: reuse allowed only when the owning unit will rerun)", () => {
  const ctx = (over: Partial<UnitRerunCtx> = {}): UnitRerunCtx => ({
    mode: "true",
    fork: true,
    items: [{ text: "item one", done: true }, { text: "item two", done: false }, { text: "item three", done: false }],
    subtasksFileItems: 0,
    wrapup: true,
    ...over,
  })

  test("subtasks: reusable only when the owning index is exactly the first unticked item; already ticked (interrupted in the gap), missing index (old record), and out of bounds are all no", () => {
    expect(unitReruns({ kind: "subtasks", index: 2 }, ctx())).toBe(true)
    expect(unitReruns({ kind: "subtasks", index: 1 }, ctx())).toBe(false) // interrupted in the gap after subtask 1's close-out
    expect(unitReruns({ kind: "subtasks", index: 3 }, ctx())).toBe(false)
    expect(unitReruns({ kind: "subtasks" }, ctx())).toBe(false) // old record without an index: ownership undecidable
    expect(unitReruns({ kind: "subtasks", index: 9 }, ctx())).toBe(false)
  })

  test("subtasks (M3.5): ownership follows the dependency order, not the first unticked item", () => {
    const items = [
      { text: "one", done: true },
      { text: "two", done: false, depends: ["S03"] },
      { text: "three", done: false, depends: "none" as const },
    ]
    expect(unitReruns({ kind: "subtasks", index: 3 }, ctx({ items }))).toBe(true)
    expect(unitReruns({ kind: "subtasks", index: 2 }, ctx({ items }))).toBe(false)
  })

  test("decompose (the merged understand+decompose unit, M1.0): items already injected, or subtasks.md already having items, makes the unit skip idempotently → no reuse", () => {
    // Items not injected and subtasks.md has none → the merged unit will rerun, reuse allowed (fork switch irrelevant)
    expect(unitReruns({ kind: "decompose" }, ctx({ items: [] }))).toBe(true)
    expect(unitReruns({ kind: "decompose" }, ctx({ items: [], fork: false }))).toBe(true)
    // subtasks.md already has items → the direct-inject path; the merged session does not rerun
    expect(unitReruns({ kind: "decompose" }, ctx({ items: [], subtasksFileItems: 3 }))).toBe(false)
    // Items already present / a mode other than the true pipeline → the unit does not run
    expect(unitReruns({ kind: "decompose" }, ctx())).toBe(false)
    expect(unitReruns({ kind: "decompose" }, ctx({ items: [], mode: "off" }))).toBe(false)
    expect(unitReruns({ kind: "decompose" }, ctx({ items: [], mode: "ondemand" }))).toBe(false)
    // auto is no longer the pipeline (plans/0059 D1): a decompose record left
    // by a pre-0059 auto run owns no unit under today's auto
    expect(unitReruns({ kind: "decompose" }, ctx({ items: [], mode: "auto" }))).toBe(false)
  })

  test("whole/wrapup: mode or config making the record's unit not run → no reuse; wrapup requires all checklist items ticked", () => {
    expect(unitReruns({ kind: "whole" }, ctx({ mode: "off" }))).toBe(true)
    expect(unitReruns({ kind: "whole" }, ctx({ mode: "ondemand" }))).toBe(true)
    // auto's lead is a whole-task session (plans/0059 D2); the pipeline has none
    expect(unitReruns({ kind: "whole" }, ctx({ mode: "auto" }))).toBe(true)
    expect(unitReruns({ kind: "whole" }, ctx({ mode: "true" }))).toBe(false)
    const done = ctx({ items: [{ text: "only item", done: true }] })
    expect(unitReruns({ kind: "wrapup" }, done)).toBe(true)
    expect(unitReruns({ kind: "wrapup" }, ctx())).toBe(false) // an unticked item remains; the next unit is a subtask
    expect(unitReruns({ kind: "wrapup" }, ctx({ items: [], wrapup: false }))).toBe(false)
  })

  test("closeout: the verdict-line check and the done marking are the driver's job; no session to reuse", () => {
    expect(unitReruns({ kind: "closeout" }, ctx({ items: [{ text: "only item", done: true }] }))).toBe(false)
  })

  test("no phase (legacy session.json) leaves ownership undecidable → no reuse; step records are outside this gate", () => {
    expect(unitReruns(undefined, ctx())).toBe(false)
    expect(unitReruns({ kind: "step", step: "phase-plan", unit: "R-01.P01" }, ctx())).toBe(true)
  })

  test("phaseText's subtasks wording carries the owning index", () => {
    expect(phaseText({ kind: "subtasks", index: 2 })).toBe("per-subtask execution (interrupted at subtask 2, continuing from the first unticked item)")
    expect(phaseText({ kind: "subtasks" })).toBe("per-subtask execution (continuing from the first unticked item)")
  })

  test("phaseText's step wording in three branches (0053 D23: phase-append verbatim)", () => {
    expect(phaseText({ kind: "step", step: "phase-plan", unit: "R-01.P01" })).toBe(
      "phase planning step (phase R-01.P01, writing the task index and task documents)",
    )
    expect(phaseText({ kind: "step", step: "phase-append", unit: "R-01.P02" })).toBe(
      "task-append step (phase R-01.P02, appending to the task index)",
    )
    expect(phaseText({ kind: "step", step: "phase-handover", unit: "R-01.P01" })).toBe(
      "phase handover step (phase R-01.P01, producing the handover document)",
    )
  })
})

// ---- Recovery fidelity (plans/0022-session-recovery-fidelity-design.md 3.2/3.1/3.3) ----

describe("resumeNote (interruption-recovery note)", () => {
  const subtasks: Phase = { kind: "subtasks", index: 2 }
  const planStep: Phase = { kind: "step", step: "phase-plan", unit: "R-01.P01" }
  const ONE_LINE =
    "[DRIVER] The session was interrupted; continue the current work until this unit is complete. Changes written before the interruption that are no longer in the worktree were committed to Git by the DRIVER — check with git log, do not redo them."

  test("strict-resume gate in place + reusing the original session → collapses to the one-line continue (3.2), with the commit-semantics clarification attached", () => {
    expect(resumeNote(subtasks, true, true)).toBe(ONE_LINE)
    expect(resumeNote(planStep, true, true)).toBe(ONE_LINE)
    expect(resumeNote(undefined, true, true)).toBe(ONE_LINE)
  })

  test("gate not in place (default off / dryrun) → the reuse path keeps the existing per-phase guidance", () => {
    const note = resumeNote(subtasks, true, false)
    expect(note).not.toBe(ONE_LINE)
    expect(note).toContain("You are continuing in the original, interrupted session.")
    expect(note).toContain("first unfinished item")
  })

  test("the non-reuse path (continuation from a summary state) always gives per-phase guidance, unaffected by strict resume", () => {
    const note = resumeNote(subtasks, false, true)
    expect(note).toContain("Part of the work may already be done.")
    expect(note).toContain("first unfinished item")
    const step = resumeNote({ kind: "step", step: "phase-handover", unit: "R-01.P01" }, false, true)
    expect(step).toContain("phase handover step")
    expect(step).toContain("four mandatory sections")
  })

  test("the phase-append step's recovery guidance (0053 D23 verbatim): read the current index first, complete the appended tasks after the existing lines", () => {
    const appendStep: Phase = { kind: "step", step: "phase-append", unit: "R-01.P02" }
    const note = resumeNote(appendStep, false, true)
    expect(note).toContain(
      "You are in the task-appending step: first read this phase's task index tasks.md as it stands (the last session may have appended some tasks), " +
        "complete the appended tasks after the existing lines without changing existing lines or task documents and without reusing a task number, then end the session.",
    )
    // The shared step skeleton: check the actual worktree state, the commit-semantics clarification, and "never commit yourself"
    expect(note).toContain("Check the actual worktree state with git status / git diff.")
    expect(note).toContain("do not mean the changes were lost")
    expect(note).toContain("you never commit yourself")
    // Reuse + strict-resume gate in place → collapses to the one-line continue like the other phases
    expect(resumeNote(appendStep, true, true)).toBe(
      "[DRIVER] The session was interrupted; continue the current work until this unit is complete. Changes written before the interruption that are no longer in the worktree were committed to Git by the DRIVER — check with git log, do not redo them.",
    )
  })

  test("commit-semantics clarification: every path that is not the one-line continue states \"unfamiliar commits / a clean worktree ≠ changes lost\"", () => {
    // During interruption recovery the AI reconciles the state with git; commits
    // made by the driver's unified commit (freeze/handover/unit close-out) or by
    // human handling get misread as lost changes and redone — the clarification
    // sentence must be present (2026-09-17).
    for (const note of [
      resumeNote(subtasks, true, false),
      resumeNote(subtasks, false, false),
      resumeNote({ kind: "step", step: "phase-plan", unit: "R-01.P01" }, true, false),
    ]) {
      expect(note).toContain("do not mean the changes were lost")
      expect(note).toContain("committed to Git by the DRIVER")
    }
  })
})
