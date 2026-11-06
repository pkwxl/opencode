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
    expect(src("execute.ts")).toContain("`${task.id} exec ${shortTitle(task.title)}`")
    expect(src("execute.ts")).toContain('stage: "execute"')
    expect(src("execute.ts")).toContain("stage: `subtask ${index}`")
    expect(src("execute.ts")).toContain('stage: "decompose"')
    expect(src("wrapup.ts")).toContain("`${task.id} wrapup ${shortTitle(task.title)}`")
    // plans/0148: the fix round commits per session, the subject carrying the
    // round and the session ordinal (`fix <round>.<session>`), derived from
    // the log so a resumed round continues the numbering.
    expect(src("wrapup.ts")).toContain("`${task.id} fix ${round}.${ordinal} ${shortTitle(task.title)}`")
    expect(src("wrapup.ts")).toContain('stage: "wrapup"')
    expect(src("loop-task.ts")).toContain("`${task.id} done ${shortTitle(task.title)}`")
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
    for (const literal of ["<task id> exec <short title>", "<task id> fix <round>.<session> <short title>", "Auto-Task: <task id>", "Auto-Stage: execute"]) {
      expect(run, "run.md").toContain(literal)
    }
    // plans/0094: a share landed at a handover carries the share ordinal in
    // its subject — ` [<k>]`, one past the unit's landed shares of the same
    // role and round, so the log distinguishes sessions — and the
    // verification's range check accepts the optional tail. The handover
    // itself rides the share commit (committed content, a precise revert
    // point; only the gap list stays a disk transient), its deletion a
    // completion write in the close-out's done commit.
    for (const literal of ["<task id> exec <short title> [<k>]", "<task id> fix <round>.<session> <short title>"]) {
      expect(run, "run.md").toContain(literal)
    }
    expect(run, "run.md").toContain("rides the share commit")
    expect(text("run-verify.md")).toContain("the deletion is a completion write")
    const verify = text("run-verify.md")
    expect(verify, "run-verify.md").toContain("share ordinal ` [<k>]`")
    for (const literal of ["<task id> wrapup <short title>", "<task id> done <short title>", "Auto-Task: <task id>"]) {
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

  test("the Auto-Nested alignment lines ride the enclosing repository's driver commits", () => {
    // The driver's unified commit (src/git.ts message/nestedHeads) reads the
    // current HEAD of every nested repository when the enclosing repository
    // commits — one `Auto-Nested: <rel> @ <short sha>` trailer line per
    // repository, the just-landed SHA where it committed this pass, the
    // baseline where it did not — so any commit of the enclosing repository
    // aligns cross-repository state (the fork command's reconstruction
    // anchor, src/fork.ts). The manual suite's commit-making roles each
    // teach the same grammar in their own file (every companion is a
    // separate session that never sees run.md): the master control's
    // share/park/fix/phase commits, the verification close-out, the handover
    // close-out and the subtask pipeline's driver cycles — the nested
    // repositories' own commits carrying the two trailers alone. Found as
    // field evidence (P19): the aster-mig cleanroom baseline run's log
    // carries the line on every commit of the enclosing repository —
    // exec/fix/wrapup/done alike — while the suite taught none of it.
    expect(src("git.ts")).toContain("`Auto-Nested: ${repo.rel} @ ${repo.sha}`")
    for (const name of ["run.md", "run-verify.md", "run-handover.md", "run-as-subtasks.md", "resume-subtasks.md"]) {
      expect(text(name), name).toContain("`Auto-Nested: <nested repository path> @ <its short HEAD sha>`")
    }
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
    // plans/0101 D2/D4: the phased project start is transfer's — a phased
    // not-established state refuses plan outright, whatever route option
    // rode along — and the analysis flow precedes any planning input, so
    // the charter's landing names the advance command and the mode split.
    expect(charter).toContain("transfer <dir>")
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

  test("the run modes: window, sprint and pace, one phrase in the hand-over (plans/0089; window re-ruled by plans/0117)", () => {
    // Person-directed, chosen per invocation — no second file, no fill-ins
    // in run.md: `mode: window <HH:MM–HH:MM>` is the working period (0117
    // D5, re-ruled from 0089's prohibited stretch): local times, a range
    // may span midnight, launches only inside it, every launch sized to
    // the runway the end leaves (a task/fix child's budget the smaller of
    // the default and the runway; ≥10 minutes of runway to launch a
    // task/fix child, ≥15 for a verification/handover/planning child),
    // the end a soft deadline the wrap-up alone may overrun slightly —
    // new work never starts past it, and before the start the session
    // holds polling or ends with a restart-at-the-start report.
    // `mode: sprint <minutes>` walls
    // the whole run below the platform's task kill (a 3-hour kill →
    // sprint 175, the gap to the kill itself the landing margin), child
    // budgets the runway itself (wall − now, no second margin — relaunch
    // while ≥10 minutes remain) so the run hands off at the wall and ends
    // properly before the kill; `mode: pace <minutes>` pauses between
    // child sessions — the person's throttle against a rolling 5-hour
    // usage cap, waited in polled short steps, composable with window
    // alone: its waits apply inside the window (outside it no launch
    // happens anyway), slowing the token burn of the working stretches
    // (`pace` never rides with `sprint` or `single`: a wall-bounded run
    // spends its runway on work, not on waiting).
    // All share the park/resume rules that
    // override the begun-task boundary refusal, resuming off 0087's
    // committed shares.
    const run = text("run.md")
    expect(run).toContain("`mode: window <HH:MM–HH:MM>`")
    expect(run).toContain("the working period")
    expect(run).toContain("times in this machine's local time")
    expect(run).toContain("end is a soft deadline")
    expect(run).toContain("`mode: sprint <minutes>`")
    expect(run).toContain("sprint 175")
    expect(run).toContain("`mode: pace <minutes>`")
    expect(run).toContain("`mode: window <HH:MM–HH:MM> pace 20`")
    expect(run).toContain("re-derive the task's baseline as the parent of its first `T-NNN` share commit")
  })

  test("the single-session mode: `mode: single <minutes>` folds every role into the one session (plans/0117)", () => {
    // Some providers disallow child sessions outright — the delegated
    // design rests on a facility they withhold. `mode: single <minutes>`
    // names that shape: no child of any role is ever launched; this one
    // session takes every role itself (master control, task, fix,
    // verification, handover, planning), reading each companion as the
    // rulebook of the role it holds — the companions' worker rules bind
    // unchanged, their session-boundary rules (a child's budget, a
    // child's final reply) read against the whole session. `<minutes>`
    // is the wall — the one-hour child budget's whole-session
    // replacement, set below the platform's kill (a 3-hour kill →
    // single 175, sprint's arithmetic), the gap the wrap-up's room:
    // settle the lanes, write the handoff, land the share, Finish — the
    // wrap-up completes inside the gap even past the wall, and never let
    // the platform kill the session mid-flight; context is the wall's
    // twin, a voluntary cut the same way at any moment. Git is identical
    // to the delegated run: one commit per role share at each role
    // boundary, the same grammar and order — which makes verification
    // self-verification (run-verify's checks and close-out by the same
    // session), the loss of fresh eyes named in the report, the default
    // phase-boundary stop the person's bracket. `parallel: <n>` never
    // rides with it (a wave needs child sessions — both phrases are a
    // stop and report), `window` alone composes (the working period
    // gates the session's own work starts), and the park/resume restart
    // re-keys one way: the successor takes the identified role up itself.
    const run = text("run.md")
    expect(run).toContain("`mode: single <minutes>`")
    expect(run).toContain("no child session of any role is ever launched")
    expect(run).toContain("the one-hour child budget's whole-session replacement")
    expect(run).toContain("`single 175`")
    expect(run).toContain("work, never the wrap-up: finish the step in flight")
    expect(run).toContain("never let the\nplatform kill this session mid-flight")
    expect(run).toContain("commit per role share at each role boundary")
    expect(run).toContain("verification becomes self-verification")
    expect(run).toContain("the verifications ran in the session that did the work")
    expect(run).toContain("a wave needs child sessions")
    expect(run).toContain("rides with `window` alone")
    expect(run).toContain("the whole design rests on one of the two")
    // The clock rule hardened in place after the 0117 field incident: a run
    // whose accumulated time estimate drifted an hour ahead overrode forty
    // correct `date` readings as "a lagging container clock" and stopped
    // 80 minutes before its wall. The wall is read, never remembered: the
    // printed `date` output alone decides the runway, computed in the open
    // from the recorded start, and a disagreement between estimate and
    // reading resolves for the reading — there is no second clock.
    expect(run).toContain("let the printed reading alone decide it")
    expect(run).toContain("start + <minutes> − the printed now")
    expect(run).toContain("the output wins unconditionally")
    expect(run).toContain("there is no second clock to reconcile it against")
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

  test("the notification wait: a running child's output is never read (plans/0118)", () => {
    // The field incident: a plain serial run on a notification-delivering
    // host — the master launched its task child background-first as 0092
    // rules and then kept fetching the running child's live output instead
    // of waiting for the completion notification. Three inductions in the
    // copy caused it: the loop said "When it ends" without naming the
    // wait's mechanism (the completion notification appeared once, as a
    // labeling rationale, never as the wait); the mid-flight quiet nudge
    // ("has been quiet past ~10 minutes") could only be discharged by
    // watching the transcript; and the budget wall's "without ending" left
    // the master to improvise how it knows. The ruling: the completion
    // notification is the wait — a running child's transcript is never
    // fetched, tailed or polled for quietness, progress or liveness (the
    // transcript is the child's context; no mechanical check reads it; a
    // background child cannot be quiet-killed, so silence endangers
    // nothing); a clock that must be held (the budget wall, a mode's
    // gates) reads `date` in the pace idiom's short sleep steps, never the
    // child's output; the budget wall keys on clock arithmetic alone (the
    // recorded launch time plus the budget the master itself filled); the
    // mid-flight quiet nudge is retired — no nudge is ever sent to a
    // running background child, the wall the sole backstop, while 0090
    // D2's relaunch-time nudge on the forced-foreground host stands
    // verbatim; and where a host's wait call blocks on the child yet
    // returns its output, the final reply alone is the intake — the
    // verdict line plus the mechanical checks, as the context rule says.
    const run = text("run.md")
    expect(run).toContain("The wait is the completion notification, never the child's live output")
    expect(run).toContain("Never fetch, tail or poll a running child's transcript")
    expect(run).toContain("hold it the pace idiom's way")
    expect(run).toContain("a fact of clock arithmetic")
    expect(run).toContain("no mid-flight nudge is ever sent")
    expect(run).toContain("the completion notification of the background launch, the call's return of a")
    // The loop's step 3 and the context rule carry the cross-ties: the
    // step names the wait's two shapes, the context rule names the
    // prohibition against the transcript channel.
    expect(run).toContain("(the launching section's wait)")
    expect(run).toContain("never through a running child's transcript")
    // The retired mid-flight nudge stays retired: the "still there?" shape
    // must not return (the relaunch-time nudge string, pinned in the 0092
    // test above, is the survivor).
    expect(run).not.toContain("still there?")
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

  test("the human gate is conditional on the recorded forks — zero forks hands over ungated (plans/0081 D14.3)", () => {
    // The field incident (the aster-mig R-05 round): the phase-transfer step
    // had stated the survey gate unconditionally since plans/0088 — "its
    // survey.md must carry a whole-line `Clarified: yes`" — so a zero-fork
    // survey (the `Forks: none` small posture) stopped the manual run for a
    // release the gate never required, while the person's `clarify` answered
    // "nothing awaits" — a hold no command could release. The gate is the
    // driver's own conditional check (src/phases.ts phaseGateProblems: a
    // missing survey is always a problem; at least one `Fork:` line holds
    // for `Clarified: yes`; zero forks completes the phase like an ungated
    // one): the hold rides the recorded forks, never the phase type alone.
    const run = text("run.md")
    expect(run).toContain("a missing survey is a gate problem")
    expect(run).toContain("holds for the person only when it records at least one")
    expect(run).toContain("`Forks: none`")
    expect(run).toContain("completes the phase like an ungated one")
    expect(run).toContain("no `Clarified:` line is needed")
    // The unconditional form must not return: the gate never demands a
    // `Clarified:` line a zero-fork survey has nothing to release.
    expect(run).not.toContain("must carry a whole-line")
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

  test("the phase-close holds: the regression lanes and the sealed reference wall (plans/0098; 0121; 0132)", () => {
    // 0098's driver mechanism ("the suite can adopt the two-level
    // vocabulary when a person-driven round needs it") and 0132's wall ("a
    // suite copy waits for its consumer") were both deferred until a real
    // manual consumer arrived — the cleanroom rounds are it, and the suite
    // now carries both halves at the phase close, before the handover child
    // runs. The regression hold: every `Cost: regression` row of the pack's
    // `### test-lanes` table green at exactly the tree about to close (the
    // receipt's `Heads:` line against the HEADs read now; a stale lane runs
    // at the close, one at a time, receipted under docs/R-NN/regression/
    // and landed as the driver's PLAN regression commit; red holds the
    // phase, the receipt and its log the person's input) — 0121's
    // divergence lane rides this generic rule, its driver-side moments the
    // phase closes. The wall: a `Wall:` field on a phase type document
    // declares it; post-wall the record (the `Auto-Stage: wall` commit) has
    // its `Wall-door:` doors absent and its `Wall-sealed:` paths frozen (a
    // driver commit touching them a violation, a person commit the one
    // recorded exception), the lane hold the close's admission; pre-wall at
    // or after the sealing phase the wall is open and NEVER closed by the
    // suite — the person's advance seals it (the driver's transfer), the
    // open wall named in the report. The task side holds the split: a
    // regression row is never a task session's lane.
    const run = text("run.md")
    const task = text("run-task.md")
    for (const literal of [
      "`Cost: regression`",
      "`.opencode/auto/intents/<intent>.md`",
      "`docs/R-NN/regression/`",
      "`Heads:`",
      "`Verdict: green`",
      "`Verdict: red`",
      "PLAN regression R-NN",
      "Auto-Stage: regression",
      "`Wall:`",
      "`Auto-Stage: wall`",
      "`Wall-door: <name> -> <target>`",
      "`Wall-sealed:`",
      "green-at-the-current-tree",
    ]) {
      expect(run, "run.md").toContain(literal)
    }
    // 0158 D5: the manual master's regression lanes name the lane-log dir
    // seam too — the same 0151 wording, both files of the manual twin.
    expect(run, "run.md").toContain("the lane-log dir (/tmp/opencode/ by default)")
    // The wall is never closed by the suite — the person's advance act.
    expect(run, "run.md").toContain("this suite never closes it")
    expect(run, "run.md").toContain("the driver's `transfer`")
    // The task/master split: regression rows are the driver's alone.
    expect(task, "run-task.md").toContain("A `Cost: regression` row is never one of your lanes")
    // plans/0177 D2 (0165-052): a row declaring an Evidence channel keeps
    // its raw log out of the manual receipt — the verdict from the wrapper's
    // exit-code line alone, the failure region from the channel file.
    expect(run, "run.md").toContain("declared `Evidence:` file")
    expect(run, "run.md").toContain("read no other line of the log")
    // The P16 line: the holds speak the field/lane grammar alone, never an
    // intent family's vocabulary.
    expect(run, "run.md").not.toContain("cleanroom")
    expect(task, "run-task.md").not.toContain("cleanroom")
    expect(run, "run.md").not.toContain("divergence")
  })

  test("the approved brief installs at the handover close-out (plans/0081 D15.2)", () => {
    // The suite once declined the release's other half ("this suite does
    // not replicate that write") — with the survey's brief now the carrier
    // of the settled constants every later phase plans from (the cleanroom
    // methodology rides it), a manual run that never installed it would
    // plan each later phase against the stale seed. The handover child —
    // the driver's completion role — installs the released survey's
    // `## Project brief` section verbatim (an equal brief writes nothing; a
    // survey without the section installs nothing) as its own commit
    // between the completion writes and the transition, the driver's own
    // installApprovedBrief grammar, and the master control's outcome check
    // accepts the third commit.
    const handover = text("run-handover.md")
    for (const literal of [
      "`Gate: human`",
      "`## Project brief`",
      "`.opencode/auto/brief.md`",
      "PLAN brief install the approved project brief (from <phase dir>/survey.md)",
      "Auto-Stage: brief-install",
      "installs nothing",
    ]) {
      expect(handover, "run-handover.md").toContain(literal)
    }
    const run = text("run.md")
    expect(run, "run.md").toContain("the approved brief's install")
    expect(run, "run.md").toContain("PLAN brief install the approved project brief")
    // The retired non-replication stance must not return.
    expect(run, "run.md").not.toContain("this suite does not replicate that write")
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
    // 0158 D5 — the 0151 lockstep completion: the manual twin names the
    // lane-log dir as the seam it is (/tmp/opencode/ the default; manual
    // children inherit the person's environment, so the
    // OPENCODE_AUTO_LANE_LOG_DIR redirect must stay prescribable), the
    // driver channel's (_partials.md) exact wording.
    expect(task).toContain("under the lane-log dir (/tmp/opencode/ by default)")
    // D2: the park grammar — the worker's status line (pinned again in the
    // widened status-grammar check above) and the master control's widened
    // missing-status feedback.
    expect(task).toContain("`Status: park <blocker task id>`")
    expect(run).toContain("`Status: continue|done|park <task id>`")
    // The park commit's grammar, stated by both driver-role files.
    for (const doc of [run, verify]) {
      expect(doc).toContain("<task id> park <short title>")
      expect(doc).toContain("Auto-Stage: park")
    }
    // The verification's widened range shapes: the park commits are
    // protocol state outside check 3's diff, the other tasks' commits out
    // of unit entirely.
    expect(verify).toContain("excluded from check 3's diff")
    expect(verify).toContain("while it sat in the park")
  })

  test("the parallel wave: `parallel: <n>` overlays the serial loop (plans/0104)", () => {
    // The manual twin of the driver's doc lanes (0099) for the doc-work
    // phases — analysis, design, acceptance above all: the hand-over
    // line's `parallel: <n>` waves independent documentation-scoped
    // task/fix children in this same tree (no worktrees, no landing
    // machinery — the master control stays the sole git writer and the
    // sole ticker of the index), while the unnamed run keeps the serial
    // loop exactly as written — the floor. Admission rides the
    // declaration, fail-safe: whole-task, a non-empty `Touches:` with
    // every entry under `docs/`, effective scopes (`Touches` ∪ the own
    // `docs/T-NNN/`, implied when unlisted) pairwise disjoint — an
    // undeclared, code-touching or overlapping task runs alone. The
    // deltas over the loop: shares land scoped to the ended task's
    // effective scope (a full-tree add would absorb a live sibling's
    // writes), one verification at a time (its close-out ticks the
    // shared index) with the master's git writes never overlapping a
    // verification's flight, parks deferring to the drain, the
    // verification's path-limited diff and generalized interleaving,
    // and run-plan's `Depends:`/`Touches:` declaration discipline on
    // doc tasks — the declaration is what the wave admits on.
    const run = text("run.md")
    expect(run).toContain("`parallel: <n>`")
    expect(run).toContain("the serial floor")
    expect(run).toContain("effective scope")
    expect(run).toContain("non-empty `Touches:` field")
    expect(run).toContain("limited to its task's effective scope")
    expect(run).toContain("never beside another verification")
    expect(run).toContain("defers to the drain")
    expect(run).toContain("uncommitted content")
    expect(run).toContain("spanning several task scopes")
    expect(run).toContain("a task or fix child's prompt carries the parallel line")
    expect(run).toContain("the `phases: all` phrase when it rode, the `parallel: <n>` phrase likewise")
    // The wave-scheduling amendment over 0104's verification clause: the
    // width's peak is <n> task/fix children plus at most one verification,
    // stated overtly so the person sizes <n> for the brief <n>+1; a pending
    // verification launches before any new task child (a facility refusal
    // narrows the wave for a task, never blocks the verification — completion
    // evidence rides on it); verifications ending together queue
    // one-at-a-time and drain fully at the wave's tail; the freed task slot
    // refills beside the verification; and an ended task's scope awaiting its
    // deferred landing is tolerated residue, not a stop.
    expect(run).toContain("plus at most one verification child beside them")
    expect(run).toContain("sizing it for the brief <n>+1 peak a verification adds")
    expect(run).toContain("a pending verification launches before any new task child")
    expect(run).toContain("queue their verifications")
    expect(run).toContain("the freed slot then refills with the next admitted ready task")
    expect(run).toContain("an ended task's scope whose landing waits out a verification's flight")
    // The 0096 clarifier keeps its role for the serial default.
    expect(run).toContain("parallel lanes are processes, not child sessions")
    for (const name of ["run-task.md", "run-fix.md"]) {
      expect(text(name), name).toContain("your writes stay inside your task's declared scope")
    }
    expect(text("run-task.md"), "run-task.md").toContain("does not decompose")
    const verify = text("run-verify.md")
    expect(verify).toContain("while it sat in the park or ran beside its siblings in a parallel wave")
    expect(verify).toContain("limit the diff to the unit's own scope")
    expect(verify).toContain("never a sibling's path")
    const plan = text("run-plan.md")
    expect(plan).toContain("`Touches:`")
    expect(plan).toContain("the declarations are what the master control's parallel wave admits on")
  })

  test("report.md is the verification's alone — a task deliverable never lives there (plans/0120)", () => {
    // The field incident (the aster-mig cleanroom round): the audit tasks'
    // deliverable was named `docs/T-NNN/report.md`, so the task session and
    // the verification child became two writers of one file — the exec
    // commits created the reports (316/439 lines of audit findings), the
    // wrapup commits then appended (+112) or revised (+212/−46) them — and
    // with no deliverable path distinct from the implied own directory
    // there was nothing to declare in `Touches:`, so the wave never formed.
    // The ruling: `report.md` is the verification's wrap-up report alone
    // (the verdict's durable record — a Result line authored by the work
    // session would be self-report), one writer per file; a task's
    // deliverable carries its own name, the phase duty text naming its
    // conventions (the cleanroom audit phase's findings.md, pinned by its
    // own bundle file — this ratchet holds the suite copy alone). Pinned on
    // all three copy sites: the planner, the worker, the append planner.
    expect(text("run-plan.md")).toContain("`docs/T-NNN/report.md` is a reserved name")
    expect(text("run-task.md")).toContain("One name in that directory is reserved")
    expect(text("plan-append.md")).toContain("the verification's wrap-up report, reserved")
    // 0124 D3: the handover survey's read-side enumeration names the report
    // as the verification's, never as a task-artifact example.
    const runHandover = text("run-handover.md").replaceAll("\n", " ").replace(/  +/g, " ")
    expect(runHandover).toContain("plus the task's own artifacts and the verification's report.md")
    expect(runHandover).not.toContain("artifacts such as report.md")
  })
})
