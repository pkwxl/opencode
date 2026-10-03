// The unit-ownership gate of a resume point, the shared recovery ladder and
// the interruption wording: whether the unit an active session belongs to
// reruns this time (deciding whether its session may be reused), the one
// reuse/rollback/fresh decision both resume-point callers run, plus rendering
// of the two texts for humans and the AI — phase description / resume note.
// Depends only on types, switches and the kernel verdicts, not on the session
// layer (the liveness probe arrives injected).
// Split out of src/runner.ts (plans/0024-module-split-plan.md S4, pure move);
// the recovery ladder merged in from runner.ts and artifact.ts (plans/0069
// §2.2 D6 / §2.3 R3, T-126).
import { HANDOVER_SECTIONS } from "./document/roles"
import { nextChecklistIndex, type DeclaredItem } from "./document/state"
import { baselineIntact } from "./git"
import type { Opts, SubtaskMode } from "./opts"
import type { Phase, Progress } from "./resume"
import { autoSwitches, type ModelRole, type Switches } from "./switches"
import { deadSessionWhy, resumeModelEligible } from "./unit-commit"

// The unit-ownership gate of a recovery point: the active record's interrupted
// session belongs to one concrete execution unit (a task-level phase /
// subtask #N); returns true — allowing its session to be reused — only when
// this run will rerun that unit. Returns false when the unit is past (checklist
// ordinal misaligned: the interruption hit the gap after a subtask's
// close-out), a config / experiment-switch change stops that unit from
// running, or the record lacks the ordinal so ownership cannot be decided (an
// old-version record) — recovery happens only when the original unit reruns,
// preventing the next unit from accidentally continuing the previous unit's
// interrupted session. ctx is precomputed by the caller from the current
// subtasks.md / file state (no file IO in this function).
export type UnitRerunCtx = {
  // Subtask mode (off/auto/true/ondemand) and the fork switch (the run
  // condition for subtask forks)
  mode: SubtaskMode
  fork: boolean
  // Current checklist items (subtasks.md); when the subtask-directory state
  // protocol is active, the done flags have been overwritten by the caller
  // from done.md existence (file existence is the progress fact, plans/0030
  // D10)
  items: (DeclaredItem & { text: string })[]
  // Checklist items already in subtasks.md (the merged understand+decompose
  // unit injects them idempotently without reopening the session)
  subtasksFileItems: number
  // Whether the wrap-up unit will run this round (config already accounted
  // for)
  wrapup: boolean
  // auto: the lead's split was taken (the checklist's state files exist), so
  // the lead's unit is over and its streams are the checklist items
  // (plans/0059 D4). Absent = no split.
  split?: boolean
}

export function unitReruns(phase: Phase | undefined, ctx: UnitRerunCtx): boolean {
  // The subtask the loop would run next (dependency order, M3.5; without
  // `Depends:` fields the first unticked item).
  const firstUnticked = nextChecklistIndex(ctx.items)
  // Ordinal ownership: the record's checklist item being exactly the current
  // first unticked one = that unit will rerun
  const atItem = (index: number | undefined) => index !== undefined && firstUnticked === index - 1
  switch (phase?.kind) {
    case "decompose":
      // The merged understand+decompose unit (M1.0, plans/0030 D2): reruns when
      // the checklist is not injected and subtasks.md has no checklist items
      // (legacy understand records are mapped to this phase by parseProgress).
      // Only the pipeline (true) has the unit: a decompose record left by a
      // run from before plans/0059 D1, when auto was the pipeline, finds no
      // unit under today's auto and starts its lead fresh.
      return ctx.mode === "true" && ctx.items.length === 0 && ctx.subtasksFileItems === 0
    case "whole":
      // off/ondemand's whole-task session and auto's lead (plans/0059 D2: a
      // whole-task session too) — unless the lead's split was taken, which
      // ends its unit: the next unit is a stream, never the lead continued.
      return ctx.mode !== "true" && ctx.split !== true
    case "subtasks":
      return atItem(phase.index)
    case "wrapup":
      return ctx.wrapup && firstUnticked === -1
    case "closeout":
      // The result-line check and the completion mark are the driver's; no
      // session belongs to this unit
      return false
    case "step":
      // Step recovery points get their ownership decided by the loop via
      // openStep; they are not reused through the task pipeline
      return true
    case undefined:
      // No phase recorded: unit ownership cannot be decided, no reuse (resume
      // takes the default flow)
      return false
  }
}

// —— The shared recovery ladder (plans/0069-system-review.md §2.2 D6 / §2.3 R3) ——
// One decision for the two resume-point callers — the task pipeline (runner's
// runTask) and the phase-step bypass sessions (requireArtifact): whether an
// interrupted session is reused, redone after a strict-resume rollback, or
// continued in a fresh session, plus the human-visible why of every non-reuse.
// The two callers deliberately differ in phase precision — the task caller
// names the recorded phase (phaseText, down to the owning subtask index), the
// step caller names its session kind (spec.kind) — so the verdicts carry no
// phase wording at all: each caller renders its own log line and applies its
// own effects (the chain takeover, the rollback's unit label, the fresh
// session's resume note or plain reset).
// AUTO-DECISION: the phase naming stays wholly caller-side rather than being
// folded into the verdicts as a label parameter (the precision difference is
// the deliberate divergence D6 named; a parameter would invite a third caller
// to pass a sloppier label where today it must choose consciously).
// The engine-side facts (session liveness/usage over the record's own agent's
// client, plans/0055 §8.2) arrive as an injected probe: this module stays
// kernel, beneath the session-driving layer (the sub-domain edge kernel →
// engine does not exist and must not).

// The usage figure a reused session's context state is measured in
// (session-api's sessionUsage shape); errorStub feeds the ladder's own
// error-stub rung below.
export type LadderUsage = { used: number; pct: number; limit?: number; errorStub: boolean }

// The liveness probe the caller injects: sessionAlive + sessionUsage over the
// recorded session, on its own agent's host (the record carries the agent; the
// caller resolves the client through its routing facts). Invoked only when the
// ladder's own candidate gate admits the record's session, so a barred record
// never pays the probe.
export type LivenessProbe = (session: string) => Promise<{ alive: boolean; usage?: LadderUsage }>

// What the ladder decided for one recalled record:
export type RecoveryVerdict =
  // External commits mixed into baseline..HEAD: no rollback (a rollback only
  // reclaims the driver's own changes), the dirty worktree goes to a human.
  | { kind: "dirty"; files: string[] }
  // The interrupted session is reused: the caller takes the takeover (its own
  // chain transitions and log line); the record's model/agent ride along for
  // the continuation's binding (plans/0055 §6.2/§8.2 — the first dispatch
  // keeps the recorded model while it is usable, on the recorded agent).
  | { kind: "reuse"; session: string; usage: LadderUsage; model?: string; agent?: string }
  // Strict resume judged the record unfaithful: the caller rolls back to the
  // record's baseline under its own unit label ("execution unit" / "<kind>
  // step") and redoes the unit cold (no resume note attached).
  | { kind: "rollback"; why: string }
  // A fresh session continues: the caller applies its own fresh-start effects
  // (the task caller attaches the resume note and may flip the record under
  // --new-session; the step caller just resets and redispatches).
  | { kind: "fresh"; why: string }

// The run's facts the ladder decides over. The task caller adds rerun and
// handedOff (its own gates above); the step caller passes only role — a
// matching step record always reruns (the step is being entered now) and no
// handover document can precede it.
export type LadderRun = {
  dir: string
  opts: Opts
  switches: Switches
  // The strict-resume gate value (strictResumeActive: switch on, records on,
  // not dryrun), precomputed by the caller — it needs it for its own anchors
  // anyway.
  strict: boolean
  // The session's explicit routing role (requireArtifact's spec.role, e.g.
  // m-mode planning's implement-scan, plans/0053 D12); absent = derived from
  // the phase.
  role?: ModelRole
  // The task caller's unit-attribution verdict (unitReruns above / the stream
  // lane's phase match): false = the record's unit will not rerun this time,
  // its session is obsolete. Default true (the step caller's shape).
  rerun?: boolean
  // The task caller's handover precedence: a handover document written before
  // the interruption carries the progress and the old session's context is
  // spent. Default false (steps have no handover documents).
  handedOff?: boolean
  probe: LivenessProbe
}

export async function recoveryLadder(record: Progress, run: LadderRun): Promise<RecoveryVerdict> {
  const rerun = run.rerun ?? true
  const handedOff = run.handedOff ?? false
  // A legacy record (written before the switch was enabled) has no unit
  // baseline, so strict verification is impossible; treated as not reusable.
  const legacyRecord = run.strict && record.baseline === undefined
  // §8.3 (plans/0055 §8.2): the dead-session verdict — a recorded session is
  // resumed only if its agent is one this run can dispatch on and its recorded
  // model is usable now; otherwise it is dead and the ladder redoes the unit
  // (under strict resume, the rollback path). Returns the reason for the log
  // line; undefined = no verdict (a record that names nothing to check).
  const dead = deadSessionWhy(run.opts, run.switches, record, run.role)
  // The candidate gate: everything that bars the probe itself — an already
  // summarized record (a graceful exit's summary is never reused), the
  // --new-session give-up, the handover precedence, a legacy record, or no
  // session on the record at all (a stage/step persisted before the first
  // dispatch).
  const barred = record.active !== true || run.opts.newSession === true || handedOff || legacyRecord || !record.session
  const session = barred ? undefined : record.session
  const probed = session !== undefined ? await run.probe(session) : { alive: false }
  const alive = session !== undefined && probed.alive
  // Inherit the interrupted session's real context usage (rebuilt from the
  // last assistant message, or the figure an /exit inside the recovery wait
  // recorded — the record's `used`).
  const usage = alive ? probed.usage : undefined
  // Belt and braces (plans/0015-session-error-retry-plan.md item 5): a legacy
  // record may name a session that only ever took one error and never produced
  // real content — never reused. The criterion lives in sessionUsage's basis
  // scan, not the last line alone.
  const errorStub = usage !== undefined && usage.used === 0 && usage.errorStub
  const usable = alive && usage !== undefined && !errorStub
  if (run.strict && record.active === true && rerun && !handedOff && record.baseline !== undefined) {
    // Strict verification and rollback (plans/0022 3.1 ③④): applies to active
    // records that will re-run, were not handed over, and carry a baseline.
    // External commits mixed in: no rollback, the dirty outcome goes to a
    // human.
    const drift = await baselineIntact(run.dir, record.baseline)
    if (drift.length) return { kind: "dirty", files: drift }
    // §10 item 11 (plans/0055): the recorded model is judged by eligibility —
    // a window change that only moves the fresh pick does not roll a unit
    // back; a model marked down, outside its windows, excluded by the agent
    // filter or gone from the registry is not.
    // AUTO-DECISION: both callers used to compute resumeModelNow beside this
    // check and never read it (the pre-item-11 equality check's leftover);
    // the merge drops the dead computation instead of carrying it into the
    // shared home (rejected: keeping it — a value no branch reads is noise
    // beside the verdict that replaced it).
    const modelOk = record.model !== undefined && resumeModelEligible(run.opts, run.switches, record.model, record.phase, run.role)
    if (dead === undefined && usable && modelOk) {
      return { kind: "reuse", session: session!, usage: usage!, model: record.model, agent: record.agent }
    }
    // The strict rollback's why. The wordings are the shared protocol; every
    // collapse the merge performed is judged here:
    const why = run.opts.newSession === true
      ? // AUTO-DECISION: collapsed the task caller's "--new-session specified"
        // with the step caller's "--new-session given" into the latter (the
        // same fact stated twice drifted apart; rejected: "specified" — the
        // flag name carries the meaning, the verb adds nothing either way).
        "--new-session given"
      : dead !== undefined
        ? `${dead}; the recorded session is dead`
        : !(alive && usage !== undefined)
          ? // AUTO-DECISION: collapsed the task caller's "original session not
            // reusable" with the step caller's "the original session is not
            // reusable" into the article-full form (rejected: the clipped
            // form — the run log is the human's only thread through a
            // 3-a.m. recovery).
            "the original session is not reusable"
          : errorStub
            ? ERROR_STUB_WHY
            : record.model === undefined
              ? // AUTO-DECISION: collapsed the task caller's "no effective
                // model recorded (an old record from before strict resume)"
                // with the step caller's "the record has no effective model
                // (an old record from before strict resume)" into the latter
                // (same fact; the subject "the record" matches the sibling
                // rungs' grammar).
                "the record has no effective model (an old record from before strict resume)"
              : `the recorded model ${record.model} is not usable now`
    return { kind: "rollback", why }
  }
  if (dead === undefined && usable && !legacyRecord) {
    return { kind: "reuse", session: session!, usage: usage!, model: record.model, agent: record.agent }
  }
  // The fresh session's why (the cause; each caller's log template appends its
  // own action sentence — the task caller's "starting a new session to
  // continue", the step caller's "redoing this step in a new session").
  // AUTO-DECISION: the two task-caller-only rungs (obsolete unit, handover
  // precedence) stay rungs of the one shared ladder that only the task
  // caller's facts can reach (rerun=false / handedOff=true) rather than
  // living in the task caller as a pre-ladder check (they are rungs of the
  // same decision — where else the session is not reused — and hoisting them
  // out would re-create the private ladder copy D6 deleted).
  // AUTO-DECISION: the no-session rung ("the record has no session") now
  // applies to both callers — the task caller previously folded a sessionless
  // record into the generic "not reusable" default (rejected: keeping the
  // fold — a stage persisted before the first dispatch is a distinct,
  // diagnosable state and the step caller already said so precisely).
  const why = !rerun
    ? "the interrupted session's execution unit will not re-run this time (already done or no longer executing); its resume point is obsolete"
    : handedOff
      ? "a handover document was written before the interruption and carries the progress"
      : run.opts.newSession === true
        ? "--new-session given"
        : !record.session
          ? "the record has no session"
          : legacyRecord
            ? // AUTO-DECISION: collapsed the task caller's "the legacy record
              // predates strict resume and has no unit baseline, so strict
              // verification is impossible" with the step caller's "an old
              // record from before strict resume has no unit baseline and
              // cannot be checked strictly" into the latter (same fact; the
              // step caller's form states what the record is, not what the
              // code once called it).
              "an old record from before strict resume has no unit baseline and cannot be checked strictly"
            : dead !== undefined
              ? `${dead}; the recorded session is dead`
              : errorStub
                ? ERROR_STUB_WHY
                : "the original session is not reusable"
  return { kind: "fresh", why }
}

// The error-stub why, one string for both branches and both callers.
// AUTO-DECISION: collapsed three drifted wordings — the task caller's strict
// "original session only hit an error, no real output", its non-strict "the
// original session only hit an error with no real output", and the step
// caller's non-strict "the original session only took an error and produced
// nothing real" — into the last (the most explicit about what "error stub"
// means); the rung itself is now shared by the step caller's strict branch
// too, which previously folded it into "not reusable" (rejected: keeping the
// fold — the finer rung is the diagnosis a human needs to distinguish "the
// session died on a network blip before doing anything" from "the session is
// gone").
const ERROR_STUB_WHY = "the original session only took an error and produced nothing real"

// Human-readable description of a phase (resume logs).
export function phaseText(phase: Phase | undefined): string {
  switch (phase?.kind) {
    case undefined:
      return "no phase recorded (default flow)"
    case "decompose":
      return "task understanding and decomposition (context.md/shared.md/subtasks.md and the subtask todo.md files; checklist not yet injected)"
    case "whole":
      return "whole-task single-session execution"
    case "subtasks":
      return `per-subtask execution (${phase.index !== undefined ? `interrupted at subtask ${phase.index}, ` : ""}continuing from the first unticked item)`
    case "wrapup":
      return "wrap-up (docs report and commit)"
    case "closeout":
      return "wrap-up finished (task report result line to check and completion to record)"
    case "step":
      if (phase.step === "phase-plan") {
        return `phase planning step (phase ${phase.unit}, writing the task index and task documents)`
      }
      if (phase.step === "phase-append") {
        return `task-append step (phase ${phase.unit}, appending to the task index)`
      }
      return `phase handover step (phase ${phase.unit}, producing the handover document)`
  }
}

// The "[DRIVER] continuing after an interruption" note injected with the first
// prompt on resume: step-specific guidance per recorded phase, so the AI does
// not redo finished work.
// Under strict resume (OPENCODE_AUTO_STRICT_RESUME=on) a reused session (R1/R2)
// gets a single continue line (plans/0022-session-recovery-fidelity-design.md 3.2):
// field evidence shows a resumed session locates itself from the disk anyway
// (git status → first unticked item), so the phase guidance is
// redundant; per-step guidance stays in the handover/state files, not in the
// resume prompt. Non-reuse paths (cold start after rollback carries no note; a
// graceful-exit summary resume) keep the existing guidance.
// strictResume is the caller's **gate value** (strictResumeActive: switch on and
// the commit gate in place), not the bare switch — with the gate off (dryrun)
// there is no unit baseline and no rollback fallback, so the premise of the
// single continue line (unfaithful → roll back and rerun) does not hold and the
// multi-line guidance stays (design §4.1 ①/⑥).
// Defaults to the parsed OPENCODE_AUTO_* value; injectable for tests.
// Commit-semantics clarification (2026-09-17): a resumed session checking the
// disk with git misreads "the worktree is cleaner than expected / git log shows
// unfamiliar commits" as lost changes and redoes them — changes written before
// the interruption may still sit uncommitted in the worktree (a unit interrupted
// midway), or may already be committed by the driver (freeze / handover / unit
// close-out) or by a human (the clean gate of the rerun after an interruption
// requires the human to handle the dirty area). Both forms are normal: continue
// from the disk state, do not redo.
export const COMMIT_CLARIFY =
  `Changes written before the interruption may still be uncommitted in the worktree, or may already have been committed to Git by the DRIVER (or by a human) — ` +
  `unfamiliar commits in git log or a worktree cleaner than expected do not mean the changes were lost.`

export function resumeNote(phase: Phase | undefined, reused: boolean, strictResume = autoSwitches().strictResume): string {
  if (reused && strictResume) {
    return `[DRIVER] The session was interrupted; continue the current work until this unit is complete. Changes written before the interruption that are no longer in the worktree were committed to Git by the DRIVER — check with git log, do not redo them.`
  }
  const next = nextStepText(phase)
  if (phase?.kind === "step") {
    return (
      `[DRIVER] The earlier run of this phase step stopped because the application was interrupted. ` +
      (reused ? `You are continuing in the original, interrupted session. ` : `Part of the work may already be done. `) +
      `Check the actual worktree state with git status / git diff. ${COMMIT_CLARIFY} ` +
      `${next}Commits are the DRIVER's job, you never commit yourself; do not redo finished work.`
    )
  }
  return (
    `[DRIVER] The earlier run of this task (or one of its subtasks) stopped because the application was interrupted. ` +
    (reused ? `You are continuing in the original, interrupted session. ` : `Part of the work may already be done. `) +
    `Check the actual worktree state with git status / git diff. ${COMMIT_CLARIFY} ` +
    `${next}Commits are the DRIVER's job, you never commit yourself; do not redo finished work.`
  )
}

function nextStepText(phase: Phase | undefined): string {
  switch (phase?.kind) {
    case undefined:
      return ""
    case "decompose":
      return `You are in task understanding and decomposition: the checklist is not written yet; the artifacts are context.md, shared.md, subtasks.md and each subtask directory's todo.md (fill in what is missing; do not redo what exists and is still accurate). `
    case "whole":
      return `You are in whole-task single-session execution. `
    case "subtasks":
      return `You are in per-subtask execution: continue from the first unfinished item of the subtasks.md checklist. `
    case "wrapup":
      return `Every checklist item is done; you are in wrap-up (update the docs/ report and commit). `
    case "closeout":
      return `Wrap-up is finished; only the DRIVER's completion record remains. `
    case "step":
      if (phase.step === "phase-plan") {
        return `You are in the phase planning step: first read this phase's task index tasks.md and the task documents written so far (the last session may have written some tasks), complete or correct this phase's tasks on that basis without repeating an existing task number, then end the session. `
      }
      if (phase.step === "phase-append") {
        return (
          `You are in the task-appending step: first read this phase's task index tasks.md as it stands (the last session may have appended some tasks), ` +
          `complete the appended tasks after the existing lines without changing existing lines or task documents and without reusing a task number, then end the session. `
        )
      }
      return `You are in the phase handover step: first read the handover document as it stands (the last session may have written part of it), complete the four mandatory sections (${HANDOVER_SECTIONS.join(" / ")}) without redoing finished parts, then end the session. `
  }
}

export function firstLine(text: string): string {
  return text.split("\n")[0]!.slice(0, 200)
}