// The manual-driver prompt ratchet (plans/0078): prompts/ is the manual-driver
// suite — run.md (the master control), run-task / run-verify / run-fix (the
// whole-task children), run-as-subtasks / resume-subtasks (the subtask
// pipeline), plan-append, and charter (plans/0081 D13: the discussion runbook
// for a greenfield baseline, the person-facing sibling of the driver-role
// runbooks) — the runbooks a coding-agent session uses to run as the driver
// itself, treating its child sessions as workers. run.md and the run-verify
// close-out are driver-role (they own the driver-exclusive writes and the
// commit grammar); run-task / run-fix / the Stage 1–3 child prompts are
// workers (no commits, no state writes); charter is neither driver nor worker
// — it lands everything through the init/plan flags and drives nothing.
//
// The suite is prompt copy like templates/prompts/, but a separate carrier:
// no renderer assembles it, so nothing structural stops it from drifting
// from the driver's grammar — which it had (plans/0078 §1: the close-out
// used `carryover driver-state posting`, the driver's self-heal string, as
// its normal completion commit; the driver's sequence is exec → wrapup →
// done). This ratchet pins the protocol literals to the driver's own, in the
// constitution-ratchet pattern: the src anti-rot arm holds the canonical
// table against the producing code, the prompts arm holds the files to it,
// and the ruled divergences are pinned as explicit absence so reversing one
// is a conscious change that updates this file together with plans/0078.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const PROMPTS = resolve(import.meta.dir, "..", "prompts")
const SRC = resolve(import.meta.dir, "..", "src")

// The suite's pinned file set: a file added to prompts/ joins the ratchet
// consciously (this test fails until it is either listed or removed).
const FILES = ["run.md", "run-task.md", "run-verify.md", "run-fix.md", "run-as-subtasks.md", "resume-subtasks.md", "plan-append.md", "charter.md"]

const text = (name: string) => readFileSync(join(PROMPTS, name), "utf8")
const src = (name: string) => readFileSync(join(SRC, name), "utf8")

describe("manual-driver prompt ratchet", () => {
  test("the suite's file set is exactly the pinned one", () => {
    expect(readdirSync(PROMPTS).sort()).toEqual([...FILES].sort())
  })

  test("the src side of the grammar table still holds (anti-rot)", () => {
    // The driver's commit grammar, stated by its producers: src/execute.ts
    // (the exec subject and the execute/decompose/subtask stages),
    // src/wrapup.ts (wrapup), src/loop-task.ts (the done settle — "the
    // terminal commit of task completion"), src/git.ts (the Auto-Stage
    // trailer and the carryover self-heal). If one of these fails, the
    // driver's grammar changed: update prompts/ in the same change — that
    // drift is what this ratchet exists to catch.
    expect(src("execute.ts")).toContain("`${task.id} exec ${task.title}`")
    expect(src("execute.ts")).toContain('stage: "execute"')
    expect(src("execute.ts")).toContain("stage: `subtask ${index}`")
    expect(src("execute.ts")).toContain('stage: "decompose"')
    expect(src("wrapup.ts")).toContain("`${task.id} wrapup ${task.title}`")
    expect(src("wrapup.ts")).toContain('stage: "wrapup"')
    expect(src("loop-task.ts")).toContain("`${task.id} done ${task.title}`")
    expect(src("loop-task.ts")).toContain('stage: "done"')
    expect(src("git.ts")).toContain("`${task.id} carryover driver-state posting`")
    expect(src("git.ts")).toContain('stage: "carryover"')
    expect(src("git.ts")).toContain("Auto-Stage: ${stage}")
  })

  test("the close-out is the driver's sequence: exec → wrapup → done", () => {
    const verify = text("run-verify.md")
    for (const literal of ["<task id> exec <task title>", "<task id> wrapup <task title>", "<task id> done <task title>", "Auto-Task: <task id>"]) {
      expect(verify, literal).toContain(literal)
    }
    const order = ["Auto-Stage: execute", "Auto-Stage: wrapup", "Auto-Stage: done"].map((stage) => verify.indexOf(stage))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect(order, "the completion commits appear in the driver's order").toEqual([...order].sort((a, b) => a - b))
  })

  test("carryover is the self-heal string only — never the close-out", () => {
    // plans/0078 §1's fix: `T-NNN carryover driver-state posting` is how the
    // driver self-heals uncommitted driver-state leftovers (src/git.ts
    // beginUnit), not its completion commit. resume-subtasks keeps it
    // exactly there — reconstructing an interrupted run's uncommitted state
    // writes is the self-heal's own case.
    for (const name of ["run.md", "run-verify.md", "run-as-subtasks.md"]) expect(text(name), name).not.toContain("carryover")
    const resume = text("resume-subtasks.md")
    expect(resume).toContain("`T-NNN carryover driver-state posting`")
    expect(resume).toContain("Auto-Stage `carryover`")
  })

  test("protocol strings: terminator, verdicts, result lines, record markers", () => {
    for (const name of FILES) expect(text(name), name).toContain("<!-- auto: eof -->")
    for (const name of ["run.md", "run-verify.md"]) {
      expect(text(name), name).toContain("`Verification: PASS`")
      expect(text(name), name).toContain("`Verification: INCOMPLETE`")
    }
    // The result line carries wrapup.md's protocol wording. run-verify's
    // report is written only after every hard check passed, so it states
    // the PASS form alone; the pipeline wrap-up children can write FAIL.
    expect(text("run-verify.md"), "run-verify.md").toContain("`Result: PASS`")
    for (const name of ["run-as-subtasks.md", "resume-subtasks.md"]) {
      expect(text(name), name).toContain("`Result: PASS`")
      expect(text(name), name).toContain("`Result: FAIL <one-sentence reason>`")
    }
    // The record duty, verbatim from question-rule's unattended branch.
    for (const name of ["run-task.md", "run-fix.md", "run-as-subtasks.md", "resume-subtasks.md"]) {
      expect(text(name), name).toContain("`AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)`")
      expect(text(name), name).toContain("`AUTO-DECISION: <decision> (<reason>)`")
    }
  })

  test("the trailer grammar and the stage vocabulary", () => {
    for (const name of ["run-as-subtasks.md", "resume-subtasks.md"]) {
      expect(text(name), name).toContain("Auto-Task: T-NNN")
      expect(text(name), name).toContain("Auto-Stage: <stage>")
      for (const stage of ["Auto-Stage `decompose`", "Auto-Stage `subtask <n>`", "Auto-Stage `wrapup`", "Auto-Stage `done`"]) {
        expect(text(name), name).toContain(stage)
      }
    }
  })

  test("the P1 process-path list is verbatim", () => {
    for (const name of ["run-verify.md", "run-as-subtasks.md", "resume-subtasks.md"]) {
      expect(text(name), name).toContain("`docs/T-*`, `docs/R-*`, `docs/phases/`, `PLAN.md`, `.auto/`")
    }
  })

  // charter.md's cross-references (plans/0081 D13): the command shapes the
  // chartering session lands the baseline through must be the driver's own —
  // the brief seed (D11), the scaffold flow (D12) and the planning input —
  // so the prompt cannot drift from the CLI that exists.
  test("charter lands the baseline through the driver's own flags (plans/0081 D13)", () => {
    const charter = text("charter.md")
    expect(charter).toContain("init <dir> --brief")
    expect(charter).toContain("plan <dir> --scaffold")
    expect(charter).toContain("plan <dir> --file <path>")
    // The brief's four constants (D11.4) and the scaffold's shape are named,
    // not paraphrased away.
    for (const literal of ["goal", "source/reference", "target", "the constraints every round must respect"]) {
      expect(charter, literal).toContain(literal)
    }
    expect(charter).toContain("in scope")
    expect(charter).toContain("out of scope")
    // The stated difference from re-work names the survey (D14.4's
    // cross-link) and the negotiate-vs-distill distinction.
    expect(charter).toContain("survey")
    expect(charter).toContain("negotiated")
    expect(charter).toContain("distilled")
    // Nothing is driven: the chartering session runs no run/plan of its own
    // beyond naming the commands the person runs.
    expect(charter).not.toContain("opencode-auto run <dir>")
  })

  test("plan-append carries the Decompose field (plans/0075)", () => {
    const append = text("plan-append.md")
    expect(append).toContain("Decompose: <split | whole | pipeline>")
    for (const value of ["`Decompose: split`", "`Decompose: whole`", "`Decompose: pipeline`"]) expect(append, value).toContain(value)
  })

  test("the test-protocol config keys are refused, not ignored", () => {
    for (const name of ["run.md", "run-as-subtasks.md", "resume-subtasks.md"]) {
      expect(text(name), name).toContain("`testByDriver`")
      expect(text(name), name).toContain("`handoverTest`")
    }
  })

  test("the ruled divergences stay explicit (plans/0078 §3)", () => {
    // handoff.md is this suite's verification gap-list channel — the
    // driver's own use of that path (the context-budget handover ending
    // Status: continue|done) is deliberately not offered here, so no worker
    // prompt carries a Status protocol. Reversing either ruling means
    // updating this test together with prompts/ and plans/0078.
    expect(text("run-verify.md")).toContain("`docs/<task id>/handoff.md`")
    for (const name of ["run-task.md", "run-fix.md"]) {
      expect(text(name), name).not.toContain("Status: continue")
      expect(text(name), name).not.toContain("Status: done")
    }
  })
})
