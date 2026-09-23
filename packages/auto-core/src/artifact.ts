// The generic skeleton of a bypass session that "must produce a file"
// (requireArtifact): dispatch → collect the artifact → missing: retry once with
// feedback → still missing: stop as an implicit block. It also runs the resume
// point of phase-level bypass steps (spec.step) and the commit boundary of
// independent hidden task units (spec.unitStart). Consumed by
// implement/numbering/knowledge/loop; kept in its own file so they need not pull
// in the whole runner. Sits above session; **must not import runner**.
// Split out of src/runner.ts (plans/0024-module-split-plan.md S9, pure move).

import type { AgentClient } from "./agent/types"
import type { SessionChain } from "./chain"
import { baselineIntact, beginUnit, unitBaseline, type UnitBaseline } from "./git"
import { log } from "./log"
import type { Opts, UnitStop } from "./opts"
import type { Task } from "./tasks"
import { recallProgress, saveProgress, type Phase, type StepKind } from "./resume"
import { resumeNote } from "./resume-gate"
import { runSession } from "./session"
import { formatTokens, sessionAlive, sessionUsage } from "./session-api"
import { autoSwitches, type ModelRole, type Switches } from "./switches"
import { afterSession, commitBlocked, resumeModelNow, rollbackUnitState, strictResumeActive } from "./unit-commit"

// The generic "bypass session must produce a file" skeleton (design doc A.4):
// when a session ends with its artifact missing or invalid, retry once with
// feedback; a second failure stops as an implicit block (a human investigates
// and re-runs to resume). Shared by phase planning, handover distillation,
// knowledge extraction and the other bypass sessions; collect returning
// undefined means that session produced no valid artifact. spec.commit declares
// the unified commit of this session kind (committed as soon as the session ends).
//
// spec.step (phase-level bypass steps, plans/0018-session-resume-precedence-design.md):
// declared only by phase planning / handover distillation sessions. When set:
// ① the session chain carries the step phase, and attempt writes the active
// record once the prompt is dispatched (claiming the running session, so a kill
// mid-turn loses nothing); ② on entry, an active record of the same step (the
// last run was interrupted before the driver closed it) → resume: reuse the
// original session when it is alive and not an error stub (keeping the artifact
// state, no reset), otherwise redo the step in a new session (reset as usual);
// spec.restart skips the resume and starts the step afresh;
// ③ the caller closes the step (deletes the record) via closeStep once its
// post-processing is done — requireArtifact itself does not delete it, so a
// kill between "artifact validated" and "post-processing (numbering / index /
// commit) finished" does not lose the step claim.
//
// spec.unitStart (plans/0021-commit-boundary-design.md P2): declares an
// independent hidden task unit (phase planning / handover distillation /
// knowledge extraction / prior knowledge / numbering recovery). When set:
// ① entry runs the clean gate via beginUnit and records the SHA baseline (a
// resume that reuses the original session is exempt from clean — the dirty area
// is this unit's own artifact state — but still records the baseline);
// ② a spec.commit failure → blocked (no feedback retry: reopening a session
// cannot fix a git fault), and after the commit the unit close-out check runs
// (every commit in the range must be a driver commit).
export async function requireArtifact<T>(
  client: AgentClient,
  task: Task,
  promptText: string,
  opts: Opts,
  spec: {
    // Session kind, for logs and block messages (e.g. "phase planning").
    kind: string
    // Artifact description (e.g. `a valid task index ${taskIndex}`).
    artifact: string
    // Why the artifact counts as missing, appended to the block message (e.g. "missing or empty").
    detail?: string
    // The hard requirement restated in the retry feedback.
    requirement: string
    // Clears stale artifacts before each session, so an old file is never taken for this session's output.
    reset?: () => Promise<void>
    // Collects the artifact after the session ends.
    collect: () => Promise<T | undefined>
    // The unified commit after the session (stage trailer and subject; absent = no commit).
    commit?: { stage: string; subject: string }
    // Independent hidden task unit (entry clean gate + SHA baseline + close-out check; see the header comment).
    unitStart?: boolean
    // Phase-level bypass step identity (declared only by phase planning / handover
    // distillation); when set, the driver-side resume point and session reuse are on
    // (see the header comment).
    step?: { step: StepKind; unit: string }
    // Start the step afresh even when its resume record is open, naming why
    // (plans/0053 D9: the planning input changed, so the recorded session
    // planned against another text). The record is replaced as for a fresh
    // step: no session reuse and, under strict resume, no rollback — the
    // rollback would reset past the input commit made just before this call.
    restart?: string
    // Session role (model-routing key, plans/0017-model-routing-design.md C.1): one-shot
    // bypass sessions declare it (e.g. knowledge / number-recovery); undefined →
    // roleOf falls to bypass. Phase-step sessions with spec.step need not declare it
    // (roleOf derives it from the step variant).
    role?: ModelRole
  },
  // Defaults to the parsed OPENCODE_AUTO_* values; passed through to runSession
  // (the same injection point, so tests can collapse the retry ladder to zero wait).
  switches: Switches = autoSwitches(),
): Promise<T | UnitStop> {
  const stepPhase: Phase | undefined = spec.step ? { kind: "step", step: spec.step.step, unit: spec.step.unit } : undefined
  // Phase-step resume: the last run was interrupted in this step (driver did not
  // close it) and the original session is still reusable → the first prompt goes
  // into the original session (keeping the artifact state); otherwise treat it as
  // a fresh step (reset + new session).
  // Strict resume (OPENCODE_AUTO_STRICT_RESUME): check the unit baseline and the
  // effective model before reuse (plans/0022-session-recovery-fidelity-design.md 3.1);
  // when fidelity cannot be kept, roll back to the baseline and redo as a fresh
  // step — foreign commits mixed in go straight to dirty for a human (git untouched).
  const strict = strictResumeActive(opts, switches)
  let resumedSession: string | undefined
  let resumedUsage: { used: number; pct: number; limit?: number } | undefined
  if (stepPhase && opts.dir) {
    const recalled = await recallProgress(opts.dir, task.id)
    const openRecord =
      recalled?.active === true &&
      recalled.phase?.kind === "step" &&
      recalled.phase.step === spec.step!.step &&
      recalled.phase.unit === spec.step!.unit
    if (openRecord && spec.restart) log(`↻ ${task.id} ${spec.kind} step restarting in a new session (${spec.restart})`)
    const sameStep = openRecord && !spec.restart
    if (sameStep) {
      const candidate = !opts.newSession ? recalled!.session : undefined
      const alive = candidate !== undefined ? await sessionAlive(client, candidate) : false
      const usage = alive ? await sessionUsage(client, candidate!) : undefined
      // An error stub (the whole session produced nothing real) is never reused — the same double check as runTask's cross-process resume.
      const usable = alive && usage && !(usage.used === 0 && usage.errorStub)
      const legacyRecord = strict && recalled!.baseline === undefined
      if (strict && recalled!.baseline) {
        const drift = await baselineIntact(opts.dir, recalled!.baseline)
        if (drift.length) return { type: "dirty", files: drift }
        const modelNow = resumeModelNow(opts, switches, recalled!.phase)
        if (usable && !legacyRecord && recalled!.model !== undefined && recalled!.model === modelNow) {
          resumedSession = candidate
          resumedUsage = usage
          log(
            `↻ ${task.id} ${spec.kind} session resuming the interruption point, reusing session ${candidate} (context intact, ` +
              `${formatTokens(usage.used)}${usage.limit ? `/${formatTokens(usage.limit)} tokens, ${usage.pct}%` : " tokens"} used)`,
          )
        } else {
          const why = opts.newSession
            ? "--new-session given"
            : !usable
              ? "the original session is not reusable"
              : recalled!.model === undefined
                ? "the record has no effective model (an old record from before strict resume)"
                : `model mismatch (recorded ${recalled!.model}, now ${modelNow ?? "no routing configured"})`
          const done = await rollbackUnitState(opts.dir, task, `${spec.kind} step`, recalled!.baseline, { progress: recalled })
          if (done.type !== "ok") return done
          log(`↻ ${task.id} ${spec.kind} session resuming the interruption point (${why}; strict resume rolled back, redoing this step)`)
        }
      } else if (usable && !legacyRecord) {
        resumedSession = candidate
        resumedUsage = usage
        log(
          `↻ ${task.id} ${spec.kind} session resuming the interruption point, reusing session ${candidate} (context intact, ` +
            `${formatTokens(usage.used)}${usage.limit ? `/${formatTokens(usage.limit)} tokens, ${usage.pct}%` : " tokens"} used)`,
        )
      } else {
        const why = opts.newSession
          ? "--new-session given"
          : candidate === undefined
            ? "the record has no session"
            : legacyRecord
              ? "an old record from before strict resume has no unit baseline and cannot be checked strictly"
              : alive
                ? "the original session only took an error and produced nothing real"
                : "the original session is not reusable"
        log(`↻ ${task.id} ${spec.kind} session resuming the interruption point (${why}; redoing this step in a new session)`)
      }
    } else {
      // A fresh step (or a record of another step): write an active resume point
      // with no session yet, so attempt's pre-dispatch snapshot (prior) is never
      // empty — restoring after a retryable session error keeps the step claim
      // instead of deleting the record, which avoids "retryable errors exhausted →
      // no record → the next run skips this step on a half-written artifact". The
      // session id is filled in by remember when the first prompt is dispatched.
      await saveProgress(opts.dir, { task: task.id, session: undefined, at: Date.now(), active: true, phase: stepPhase })
    }
  }
  let feedback = ""
  // Commit boundary of an independent hidden task unit (spec.unitStart,
  // plans/0021-commit-boundary-design.md P2): a resume reusing the original session
  // (resumedSession) is exempt from the clean check — the dirty area is this unit's
  // own artifact state; a fresh entry requires clean (driver-owned state file
  // leftovers self-heal). Both record the SHA baseline.
  let baseline: UnitBaseline | undefined
  if (spec.unitStart && opts.dir && opts.commit !== false && !opts.dryrun) {
    if (resumedSession) {
      baseline = await unitBaseline(opts.dir)
    } else {
      const gate = await beginUnit(opts.dir, opts, task)
      if (gate.type === "dirty") return { type: "dirty", files: gate.files }
      baseline = gate.baseline
    }
  }
  for (let i = 0; ; i++) {
    // A resume reusing the original session keeps the artifact state (the last
    // session may have written part of it; a reset would destroy that); every
    // other case (fresh step, feedback retry) resets as usual, so a stale file is
    // never taken for this session's output.
    const resume = i === 0 && resumedSession !== undefined
    if (!resume) await spec.reset?.()
    const chain: SessionChain = {
      pct: resume ? resumedUsage!.pct : 100,
      used: resume ? resumedUsage!.used : 0,
      at: resume ? Date.now() : 0,
      subject: spec.commit?.subject,
      phase: stepPhase,
      role: spec.role,
      // The unit baseline rides on the chain (strict resume: attempt records it with the active record).
      baseline,
    }
    if (resume) {
      // attempt's resumed test (a session on the chain and a pending note) sends
      // the first prompt into the original session regardless of the reuse switch
      // and threshold; the note is cleared once used.
      chain.id = resumedSession
      chain.note = resumeNote(stepPhase, true, strict)
    }
    const result = await runSession(client, task, promptText + feedback, opts, chain, undefined, undefined, switches)
    if (result.type === "blocked") return result
    if (spec.commit) {
      const committed = await afterSession(opts.dir, opts, task, spec.commit, baseline)
      if (committed.type === "failed") return commitBlocked(`${task.id} ${spec.kind} session`, committed)
    }
    const value = await spec.collect()
    if (value !== undefined) return value
    if (i === 1) {
      return {
        type: "blocked",
        question:
          `The ${spec.kind} session ended twice without producing ${spec.artifact}${spec.detail ? ` (${spec.detail})` : ""} (implicit block). ` +
          `Investigate and re-run. Last output of the ${spec.kind} session:\n${result.lastText.trim().slice(-2000) || "(no output)"}`,
      }
    }
    log(`↻ ${task.id} ${spec.kind} session did not produce ${spec.artifact}; retrying once with feedback`)
    feedback = `\n\nThe last time you ended the session, ${spec.artifact} was not produced. This is a hard requirement: ${spec.requirement}`
    // The feedback retry no longer reuses the original session (it ended its turn
    // without a valid artifact): clear the resume marks, so the next round resets
    // the artifact and opens a new session.
    resumedSession = undefined
    resumedUsage = undefined
  }
}
