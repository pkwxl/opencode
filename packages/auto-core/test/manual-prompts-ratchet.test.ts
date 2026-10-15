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
const FILES = ["run.md", "run-task.md", "run-verify.md", "run-fix.md", "run-handover.md", "run-plan.md", "run-as-subtasks.md", "resume-subtasks.md", "plan-append.md", "charter.md"]

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
    // The phase-transfer grammar (plans/0088, amended by plans/0095): the
    // handover distill, the transition close-out and the formulation
    // construction commits, stated by their producers in loop-phase.ts /
    // formulate.ts.
    expect(src("loop-phase.ts")).toContain("`PLAN handover ${phaseTitle(phase)}`")
    expect(src("loop-phase.ts")).toContain('stage: "phase-handover"')
    expect(src("loop-phase.ts")).toContain("`PLAN transition ${phaseTitle(phase)} → ${target}`")
    expect(src("loop-phase.ts")).toContain('stage: "phase-transition"')
    expect(src("formulate.ts")).toContain("`PLAN formulate ${phaseText(phase)}`")
    expect(src("formulate.ts")).toContain('stage: "phase-formulate"')
  })

  test("the commit grammar: the master control's share commits, then the close-out's wrapup → done", () => {
    // plans/0087: every task/fix session's share lands as its own commit at
    // the session's end — the master control's write (the driver's unified
    // commit after a session; its fix rounds land the same way, `<id> fix
    // <n> <title>`). The verification's close-out therefore starts from a
    // landed range: it validates the range holds only the unit's own
    // commits, then makes the report commit (wrapup) and the state-writes
    // commit (done) — the exec grammar lives in run.md's share-commit rule.
    const run = text("run.md")
    for (const literal of ["<task id> exec <task title>", "<task id> fix <round> <task title>", "Auto-Task: <task id>", "Auto-Stage: execute"]) {
      expect(run, "run.md").toContain(literal)
    }
    // plans/0094: a share landed at a handover carries the share ordinal in
    // its subject — ` [<k>]`, one past the unit's landed shares of the same
    // role and round, so the log distinguishes sessions — and the
    // verification's range check accepts the optional tail. The handover
    // itself rides the share commit (committed content, a precise revert
    // point; only the gap list stays a disk transient), its deletion a
    // completion write in the close-out's done commit.
    for (const literal of ["<task id> exec <task title> [<k>]", "<task id> fix <round> <task title> [<k>]"]) {
      expect(run, "run.md").toContain(literal)
    }
    expect(run, "run.md").toContain("rides the share commit")
    expect(text("run-verify.md")).toContain("the deletion is a completion write")
    const verify = text("run-verify.md")
    expect(verify, "run-verify.md").toContain("share ordinal ` [<k>]`")
    for (const literal of ["<task id> wrapup <task title>", "<task id> done <task title>", "Auto-Task: <task id>"]) {
      expect(verify, literal).toContain(literal)
    }
    const order = ["Auto-Stage: wrapup", "Auto-Stage: done"].map((stage) => verify.indexOf(stage))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect(order, "the close-out commits appear in the driver's order").toEqual([...order].sort((a, b) => a - b))
    // The verification names the exec grammar only to validate the range
    // (check 1); its own commits are the wrapup and done passes alone, so
    // no execute-stage commit block exists in its close-out.
    expect(verify.indexOf("Auto-Stage: execute")).toBeLessThan(verify.indexOf("## The verdict"))
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

  test("the run modes: window, sprint and pace, one phrase in the hand-over (plans/0089)", () => {
    // Person-directed, chosen per invocation — no second file, no fill-ins
    // in run.md: `mode: window <HH:MM–HH:MM> [tz]` parks launches inside
    // the window (ongoing children finish); `mode: sprint <minutes>` walls
    // the whole run below the platform's task kill (a 3-hour kill →
    // sprint 175, the gap to the kill itself the landing margin), child
    // budgets the runway itself (wall − now, no second margin — relaunch
    // while ≥10 minutes remain) so the run hands off at the wall and ends
    // properly before the kill; `mode: pace <minutes>` pauses between
    // child sessions — the person's throttle against a rolling 5-hour
    // usage cap, waited in polled short steps, composable with window
    // alone: its waits apply outside the window (inside it launches are
    // blocked anyway), slowing the token burn of the working stretches
    // (`pace` never rides with `sprint`: a wall-bounded run spends
    // its runway on work, not on waiting).
    // All share the park/resume rules that
    // override the begun-task boundary refusal, resuming off 0087's
    // committed shares.
    const run = text("run.md")
    expect(run).toContain("`mode: window <HH:MM–HH:MM> [tz]`")
    expect(run).toContain("`mode: sprint <minutes>`")
    expect(run).toContain("`sprint 175`")
    expect(run).toContain("`mode: pace <minutes>`")
    expect(run).toContain("`mode: window <HH:MM–HH:MM> [tz] pace 20`")
    expect(run).toContain("re-derive the task's baseline as the parent of its first `T-NNN` share commit")
  })

  test("the facility-keyed launch: background-first for every run, foreground only forced (plans/0092)", () => {
    // No run of this suite is attended in the watching sense — the person
    // hands the file over and returns for the hand-overs and reports — so
    // 0090's attendance keying never paid its foreground preference while
    // its cost (the ~10-minute quiet kill) was paid by every plain run,
    // and the one case it marked for background-first (a sprint on its
    // native idle-task host) had no background facility at all. The
    // policy: launch background-first wherever the host has a background
    // facility; foreground only on a host without one (the idle-task
    // session), where a killed child relaunches foreground with the
    // continue line plus the quiet-child nudge — the companions' polling
    // discipline the child's only shield, the sprint wall the bound.
    const run = text("run.md")
    expect(run).toContain("Launch children background-first")
    expect(run).toContain("nobody watches a child's live transcript")
    expect(run).toContain("forces every child foreground")
    expect(run).toContain("poll your log in short steps — never sit waiting on a long command")
  })

  test("the phase boundary is a stop by default; `phases: all` lifts it (plans/0091)", () => {
    // One phase per hand-over: the master control ends the run at every
    // phase boundary — the phase closed and landed, the report naming
    // the review it waits for (the handover document, its OPEN decisions
    // above all, the task reports) — and the person continues by handing
    // the file over again; the restart takes the next not-closed phase
    // through the ordinary boundary check, the loop's step 0 planning an
    // unplanned one. The hand-over phrase `phases: all` lifts the stop
    // for the whole run, riding beside the mode phrases and named in the
    // report like a mode line so the person's restart repeats it.
    const run = text("run.md")
    expect(run).toContain("`phases: all`")
    expect(run).toContain("one phase per hand-over")
    expect(run).toContain("Stop at the phase boundary — the default")
    expect(run).toContain("only under `phases: all`")
    expect(run).toContain("the `phases: all` phrase when it rode")
  })

  test("the phase-transfer companions carry the driver's phase grammar (plans/0088)", () => {
    // The handover child mirrors the driver's handoverPhase: the distiller
    // session's four-section handover document (templates/prompts/
    // phase-handover.md), then completePhase (the phase todo.md → done.md
    // rename + the phases.md tick) and the two commits — PLAN handover
    // (stage phase-handover) and PLAN transition (stage phase-transition).
    // The planning child mirrors the driver's phase-plan session: the task
    // index and the taskTodoSpec documents; its output lands as the
    // master control's PLAN plan commit (stage phase-plan), the worker
    // itself never committing.
    const handover = text("run-handover.md")
    for (const literal of [
      "PLAN handover <phase id> <phase name>",
      "PLAN transition <phase id> <phase name> → <next target>",
      "Auto-Task: PLAN",
      "Auto-Stage: phase-handover",
      "Auto-Stage: phase-transition",
      "## Key decisions",
      "## Constraints and pitfalls",
      "## Required reading for the next phase",
      "## Artifact index",
    ]) {
      expect(handover, "run-handover.md").toContain(literal)
    }
    // The task-document spec is the driver's taskTodoSpec, verbatim.
    const plan = text("run-plan.md")
    for (const literal of ["`# T-NNN: <task title>`", "`Phase: R-NN.P<nn>`", "`## Goal`", "`## Scope`", "`## Acceptance`", "- [ ] T-NNN <task title>", "plan-input.md"]) {
      expect(plan, "run-plan.md").toContain(literal)
    }
    // The formulation construction commit is the master control's alone
    // (plans/0095); the child's own share lands as the task grammar's exec.
    for (const literal of ["PLAN formulate <phase id> <phase name>", "Auto-Stage: phase-formulate", "`<task id> exec <title>`"]) {
      expect(text("run.md"), "run.md").toContain(literal)
    }
  })

  test("the gap channel is gaps.md; the handover channel is the driver's own handoff.md", () => {
    // The verification gap list lives in `docs/T-NNN/gaps.md` — the driver's
    // own verification loop uses the same path since plans/0083 (D3), and the
    // manual suite keeps it. The session handover lives in
    // `docs/T-NNN/handoff.md`, ending with the driver's own status line:
    // plans/0078 §3 deliberately offered no Status protocol to worker
    // prompts, and the handover upgrade (plans/0086) reversed that ruling
    // consciously — the suite's task and fix children now hand over at work
    // boundaries (the implementation→testing boundary, a test type) or when
    // their session budget (`<session budget>`, 60 minutes by default) runs
    // out, mirroring the driver's ondemand handover channel (src/docpaths.ts
    // handoffFile — the status line parsed by the driver, the file removed
    // at completion and close, src/close.ts removing handoff and gaps
    // together). Verification children still hand over never: their verdict
    // plus close-out is atomic, so the Status literals stay out of
    // run-verify.
    expect(text("run-verify.md")).toContain("`docs/<task id>/gaps.md`")
    expect(text("run-fix.md")).toContain("`docs/<task id>/gaps.md`")
    expect(text("run.md")).toContain("`docs/T-NNN/gaps.md`")
    expect(text("run-task.md")).toContain("`docs/<task id>/handoff.md`")
    expect(text("run-fix.md")).toContain("`docs/<task id>/handoff.md`")
    for (const name of ["run-task.md", "run-fix.md"]) {
      expect(text(name), name).toContain("`Status: continue`")
      expect(text(name), name).toContain("`Status: done`")
      expect(text(name), name).toContain("`<session budget>`")
    }
    // plans/0096 D2 widens the task child's status grammar to the
    // three-word form — the park line names its blocker on the line
    // itself ("pending" was ruled out: it already means todo.md-present
    // in the readiness vocabulary). The fix child keeps the two-word
    // grammar; the master control reads the same line (the loop's step 4
    // and the readiness rules) and its missing-status feedback carries
    // the widened grammar (pinned in the 0096 test below).
    expect(text("run-task.md"), "run-task.md").toContain("`Status: park <blocker task id>`")
    expect(text("run.md")).toContain("`Status: park <blocker task id>`")
    // The close-out clears both channels (the gap list from disk, the riding
    // handover through a committed completion write), and the master control
    // carries the budget default.
    expect(text("run-verify.md")).toContain("`docs/<task id>/handoff.md`")
    expect(text("run.md")).toContain("60 minutes")
    // The reversal's boundary: the verification child writes no handover of
    // its own, and the subtask pipeline / charter stay outside the channel.
    expect(text("run-verify.md")).not.toContain("`Status: continue`")
    expect(text("run-verify.md")).not.toContain("`Status: done`")
    for (const name of ["run-as-subtasks.md", "resume-subtasks.md", "plan-append.md", "charter.md"]) {
      expect(text(name), name).not.toContain("handoff.md")
      expect(text(name), name).not.toContain("`Status: continue`")
    }
  })

  test("the test lanes and the dependency park (plans/0096)", () => {
    // D1: the testing phase runs the project's suites as parallel lanes —
    // background processes the task session itself launches and judges,
    // planned per project into docs/T-NNN/testplan.md (each suite's exact
    // command through the project's own runner — the plan derives from the
    // project's actual suites, nothing hardcoded —, its log path, its
    // verdict line, the code surfaces it exercises, its cost class),
    // launched cheap-first with the one expensive anchor held back until
    // the cheap tier greens, carried forward while no later fix touches a
    // lane's surfaces, receipted in docs/T-NNN/testhands/<lane id>.md (the
    // acceptance anchor's green receipt the evidence the verification
    // session checks), and handed over at lane-set boundaries only —
    // 0086's per-test-type boundary retired into it. Lanes are processes
    // inside the task session, not child sessions: the one-at-a-time rule
    // over child sessions stands.
    // D2: the dependency park — the handover's status line gains
    // `Status: park <blocker task id>`, the blocker named on the
    // machine-parsed line itself ("pending" ruled out: it already means
    // todo.md-present in the readiness vocabulary). The master control
    // validates the blocker, lands the parked handoff as its own park
    // commit (`<task id> park <task title>`, `Auto-Stage: park`, the
    // blocker's `Depends:` amendment riding it — the park is not a share,
    // the ordinal counts shares alone), counts the parked task done for
    // its successors, and flips the line back to `Status: continue` at
    // the pick after the blocker closes. The verification's check 1
    // accepts the task's own park commits (protocol state) and other
    // tasks' commits that landed between its shares while it sat in the
    // park.
    const run = text("run.md")
    const task = text("run-task.md")
    const verify = text("run-verify.md")
    // D1: the lane protocol's paths (both files name them) and the
    // lanes-are-processes sentence on the one-at-a-time rule.
    for (const doc of [run, task]) {
      expect(doc).toContain("`docs/T-NNN/testplan.md`")
      expect(doc).toContain("`docs/T-NNN/testhands/`")
    }
    expect(run).toContain("parallel lanes are processes, not child sessions")
    // D2: the park grammar — the worker's status line (pinned again in the
    // widened status-grammar check above) and the master control's widened
    // missing-status feedback.
    expect(task).toContain("`Status: park <blocker task id>`")
    expect(run).toContain("`Status: continue|done|park <task id>`")
    // The park commit's grammar, stated by both driver-role files.
    for (const doc of [run, verify]) {
      expect(doc).toContain("<task id> park <task title>")
      expect(doc).toContain("Auto-Stage: park")
    }
    // The verification's widened range shapes: the park commits are
    // protocol state outside check 3's diff, the other tasks' commits out
    // of unit entirely.
    expect(verify).toContain("excluded from check 3's diff")
    expect(verify).toContain("while it sat in the park")
  })
})
