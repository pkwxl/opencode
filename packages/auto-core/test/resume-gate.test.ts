// Unit tests for src/resume-gate.ts: the recovery point's unit-ownership gate (unitReruns/phaseText), the shared recovery ladder (recoveryLadder — the one reuse/rollback/fresh decision both resume callers run, plans/0069 §2.2 D6), and the interruption-recovery note (resumeNote).
// Split out of test/runner.test.ts (plans/0024-module-split-plan.md S18, pure move).

import { describe, expect, test } from "bun:test"
import type { Opts } from "../src/opts"
import type { Phase, Progress } from "../src/resume"
import { phaseText, recoveryLadder, resumeNote, unitReruns, type LadderRun, type LivenessProbe, type UnitRerunCtx } from "../src/resume-gate"
import { parseSwitches, SWITCH_ENV } from "../src/switches"

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
    // A split the lead's guard took ends the lead's unit (plans/0059 D4): the
    // record's session is the lead's, and the next unit is a stream.
    expect(unitReruns({ kind: "whole" }, ctx({ mode: "auto", split: true }))).toBe(false)
    expect(unitReruns({ kind: "subtasks", index: 2 }, ctx({ mode: "auto", split: true }))).toBe(true)
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

// ---- The shared recovery ladder (plans/0069 §2.2 D6 / §2.3 R3): the one ----
// ---- decision the task caller (runner) and the step caller              ----
// ---- (requireArtifact) both run. The verdicts carry no phase wording — ----
// ---- each caller renders its own precision (the task caller phaseText, ----
// ---- the step caller its session kind), pinned by the caller drives in  ----
// ---- test/resume.test.ts. The dirty arm (drift since the baseline       ----
// ---- needs a real repository) is covered through the step caller by     ----
// ---- test/artifact.test.ts's strict suite.                              ----

describe("recoveryLadder (the shared reuse/rollback/fresh decision)", () => {
  // Routing over the implicit registry (the record's model is its wildcard
  // entry, so eligibility holds; an unknown name is not usable).
  const STRICT = parseSwitches({ [SWITCH_ENV.strictResume]: "on", [SWITCH_ENV.model]: "*=kimi/k2" })
  const LOOSE = parseSwitches({ [SWITCH_ENV.strictResume]: "off", [SWITCH_ENV.model]: "*=kimi/k2" })

  const healthy: LivenessProbe = async () => ({ alive: true, usage: { used: 5000, pct: 8, limit: 60_000, errorStub: false } })
  const gone: LivenessProbe = async () => ({ alive: false })
  const stub: LivenessProbe = async () => ({ alive: true, usage: { used: 0, pct: 100, errorStub: true } })

  const record = (over: Partial<Progress> = {}): Progress => ({
    task: "T-001",
    session: "ses_old",
    at: 1,
    active: true,
    phase: { kind: "step", step: "phase-plan", unit: "R-01.P01" },
    ...over,
  })
  // dir is only read by the baseline check; the empty baseline (a unit that
  // started with no commits) keeps it pure — no git, no spawn.
  const run = (over: Partial<LadderRun> & { probe: LivenessProbe }): LadderRun => ({
    dir: ".",
    opts: {} as Opts,
    switches: LOOSE,
    strict: false,
    ...over,
  })

  test("non-strict: a live usable record with a usable model reuses its session, carrying the continuation's model/agent", async () => {
    const verdict = await recoveryLadder(record({ model: "kimi/k2", agent: "opencode" }), run({ probe: healthy }))
    expect(verdict).toEqual({ kind: "reuse", session: "ses_old", usage: { used: 5000, pct: 8, limit: 60_000, errorStub: false }, model: "kimi/k2", agent: "opencode" })
  })

  test("strict: intact baseline + usable session + eligible model → reuse", async () => {
    const verdict = await recoveryLadder(record({ model: "kimi/k2", baseline: [] }), run({ switches: STRICT, strict: true, probe: healthy }))
    expect(verdict.kind).toBe("reuse")
  })

  test("strict: --new-session → rollback naming the flag (the collapsed string both callers share)", async () => {
    const verdict = await recoveryLadder(record({ model: "kimi/k2", baseline: [] }), run({ opts: { newSession: true } as Opts, switches: STRICT, strict: true, probe: healthy }))
    expect(verdict).toEqual({ kind: "rollback", why: "--new-session given" })
  })

  test("strict: a dead session (recorded model not usable now) → rollback quoting the dead verdict", async () => {
    const verdict = await recoveryLadder(record({ model: "kimi/old", baseline: [] }), run({ switches: STRICT, strict: true, probe: healthy }))
    expect(verdict).toEqual({
      kind: "rollback",
      why: "the recorded session's model kimi/old is not usable now; the recorded session is dead",
    })
  })

  test("strict: an error-stub session → rollback with the finer error-stub rung (the step caller's strict branch previously folded it into not-reusable)", async () => {
    const verdict = await recoveryLadder(record({ model: "kimi/k2", baseline: [] }), run({ switches: STRICT, strict: true, probe: stub }))
    expect(verdict).toEqual({ kind: "rollback", why: "the original session only took an error and produced nothing real" })
  })

  test("strict: a record with no effective model → rollback naming the missing model", async () => {
    const verdict = await recoveryLadder(record({ baseline: [] }), run({ switches: STRICT, strict: true, probe: healthy }))
    expect(verdict).toEqual({ kind: "rollback", why: "the record has no effective model (an old record from before strict resume)" })
  })

  test("strict: a legacy record without a baseline → fresh, never reused or rolled back", async () => {
    const verdict = await recoveryLadder(record(), run({ switches: STRICT, strict: true, probe: healthy }))
    expect(verdict).toEqual({ kind: "fresh", why: "an old record from before strict resume has no unit baseline and cannot be checked strictly" })
  })

  test("the task caller's own rungs: an obsolete unit (rerun=false, the caller already flipped the record summarized) and a handover document (handedOff) are fresh causes only its facts reach — and the probe is never paid", async () => {
    let probed = 0
    const counting: LivenessProbe = async (session) => {
      probed++
      return await healthy(session)
    }
    const obsolete = await recoveryLadder(record({ active: false }), run({ rerun: false, probe: counting }))
    expect(obsolete).toEqual({
      kind: "fresh",
      why: "the interrupted session's execution unit will not re-run this time (already done or no longer executing); its resume point is obsolete",
    })
    const handed = await recoveryLadder(record(), run({ handedOff: true, probe: counting }))
    expect(handed).toEqual({ kind: "fresh", why: "a handover document was written before the interruption and carries the progress" })
    expect(probed).toBe(0)
  })

  test("non-strict: --new-session → fresh naming the flag, without probing", async () => {
    let probed = 0
    const verdict = await recoveryLadder(record(), run({ opts: { newSession: true } as Opts, probe: async (session) => ((probed++), await healthy(session)) }))
    expect(verdict).toEqual({ kind: "fresh", why: "--new-session given" })
    expect(probed).toBe(0)
  })

  test("non-strict: an active record with no session (a stage persisted before the first dispatch) → fresh naming the missing session — the rung the task caller previously folded into the generic default", async () => {
    let probed = 0
    const verdict = await recoveryLadder(record({ session: undefined }), run({ probe: async (session) => ((probed++), await healthy(session)) }))
    expect(verdict).toEqual({ kind: "fresh", why: "the record has no session" })
    expect(probed).toBe(0)
  })

  test("non-strict: a dead probe → fresh with the generic default; an error-stub probe → fresh with the shared error-stub string", async () => {
    expect(await recoveryLadder(record(), run({ probe: gone }))).toEqual({ kind: "fresh", why: "the original session is not reusable" })
    expect(await recoveryLadder(record(), run({ probe: stub }))).toEqual({ kind: "fresh", why: "the original session only took an error and produced nothing real" })
  })

  test("a summarized record (active=false, a graceful exit's summary) never probes and never reuses", async () => {
    let probed = 0
    const verdict = await recoveryLadder(record({ active: false, model: "kimi/k2" }), run({ probe: async (session) => ((probed++), await healthy(session)) }))
    expect(verdict).toEqual({ kind: "fresh", why: "the original session is not reusable" })
    expect(probed).toBe(0)
  })
})
