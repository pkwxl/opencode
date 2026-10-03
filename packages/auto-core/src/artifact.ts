// The generic skeleton of a bypass session that "must produce a file"
// (requireArtifact): dispatch → collect the artifact → missing: retry once with
// feedback → still missing: stop as an implicit block. It also runs the resume
// point of phase-level bypass steps (spec.step) and the commit boundary of
// independent hidden task units (spec.unitStart). Consumed by
// numbering/knowledge/loop; kept in its own file so they need not pull
// in the whole runner. Sits above session; **must not import runner**.
// Split out of src/runner.ts (plans/0024-module-split-plan.md S9, pure move).

import type { SessionChain } from "./chain"
import { bindAgent, resumeSession, setRoute } from "./chain-transitions"
import { formatTokens } from "./format"
import type { UnitBaseline } from "./git"
import { gitOf } from "./git-ops"
import { log } from "./log"
import type { ClientSource, Opts, UnitStop } from "./opts"
import type { Task } from "./tasks"
import { recallProgress, saveProgress, type Phase, type StepKind } from "./resume"
import { recoveryLadder, resumeNote } from "./resume-gate"
import { routingOf, runSession } from "./session"
import { clientOf, sessionAlive, sessionUsage } from "./session-api"
import { autoSwitches, type ModelRole, type Switches } from "./switches"
import { commitBlocked, rollbackUnitState, strictResumeActive } from "./unit-commit"

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
  client: ClientSource,
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
    // (roleOf derives it from the step variant); one that does (m-mode planning,
    // implement-scan, plans/0053 D12) is routed by it, and strict resume checks
    // the recorded model under the same role.
    role?: ModelRole
  },
  // Defaults to the parsed OPENCODE_AUTO_* values; passed through to runSession
  // (the same injection point, so tests can collapse the retry ladder to zero wait).
  switches: Switches = autoSwitches(),
): Promise<T | UnitStop> {
  const stepPhase: Phase | undefined = spec.step ? { kind: "step", step: spec.step.step, unit: spec.step.unit } : undefined
  // The run's git service (git-ops.ts gitOf, the seam's one resolution
  // point: the opts carrier the loop filled, else the holderless production
  // fallback).
  const git = gitOf(opts)
  // Phase-step resume: the last run was interrupted in this step (driver did not
  // close it) and the original session is still reusable → the first prompt goes
  // into the original session (keeping the artifact state); otherwise treat it as
  // a fresh step (reset + new session). The reuse/rollback/fresh decision itself
  // is the shared recovery ladder (resume-gate.ts, plans/0069 §2.2 D6): this step
  // caller passes its role and its liveness probe; a matching step record always
  // reruns (the step is being entered now) and no handover document can precede
  // it, so the task caller's rerun/handedOff rungs stay out of reach. Strict
  // resume (OPENCODE_AUTO_STRICT_RESUME): check the unit baseline and the
  // effective model before reuse (plans/0022-session-recovery-fidelity-design.md
  // 3.1); when fidelity cannot be kept, roll back to the baseline and redo as a
  // fresh step — foreign commits mixed in go straight to dirty for a human (git
  // untouched).
  const strict = strictResumeActive(opts, switches)
  let resumedSession: string | undefined
  let resumedUsage: { used: number; pct: number; limit?: number } | undefined
  // The recorded model of a resumed step under a registry (§6.2 continuation:
  // the first dispatch keeps it while it is usable), and the agent the
  // recorded session lives on (§8.2).
  let resumedModel: string | undefined
  let resumedAgent: string | undefined
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
      // The recorded session's liveness runs on its own agent's host (§8.2:
      // the record carries it; absent = the run's start profile), resolved
      // through the routing facts (always defined — the implicit registry
      // where no layer exists).
      const recalledClient = await clientOf(client, recalled!.agent ?? routingOf(opts, switches).runAgent)
      const verdict = await recoveryLadder(recalled!, {
        dir: opts.dir,
        opts,
        switches,
        strict,
        role: spec.role,
        probe: async (session) => {
          const alive = await sessionAlive(recalledClient, session)
          return { alive, usage: alive ? await sessionUsage(recalledClient, session, recalled!.used) : undefined }
        },
      })
      if (verdict.kind === "dirty") return { type: "dirty", files: verdict.files }
      if (verdict.kind === "reuse") {
        resumedSession = verdict.session
        resumedUsage = verdict.usage
        resumedModel = verdict.model
        resumedAgent = verdict.agent
        log(
          `↻ ${task.id} ${spec.kind} session resuming the interruption point, reusing session ${verdict.session} (context intact, ` +
            `${formatTokens(verdict.usage.used)}${verdict.usage.limit ? `/${formatTokens(verdict.usage.limit)} tokens, ${verdict.usage.pct}%` : " tokens"} used)`,
        )
      } else if (verdict.kind === "rollback") {
        // Strict resume judged the step unfaithful: roll back to the unit
        // baseline and redo cold (plans/0053 D9's restart carries the same
        // no-rollback shape for a changed planning input).
        const done = await rollbackUnitState(opts.dir, task, `${spec.kind} step`, recalled!.baseline!, { progress: recalled })
        if (done.type !== "ok") return done
        log(`↻ ${task.id} ${spec.kind} session resuming the interruption point (${verdict.why}; strict resume rolled back, redoing this step)`)
      } else {
        log(`↻ ${task.id} ${spec.kind} session resuming the interruption point (${verdict.why}; redoing this step in a new session)`)
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
  if (spec.unitStart && opts.dir && !opts.dryrun) {
    if (resumedSession) {
      baseline = await git.unitBaseline(opts.dir)
    } else {
      const gate = await git.beginUnit(opts.dir, opts, task)
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
    const resumedAt = resume ? Date.now() : 0
    const chain: SessionChain = {
      pct: resume ? resumedUsage!.pct : 100,
      used: resume ? resumedUsage!.used : 0,
      at: resumedAt,
      subject: spec.commit?.subject,
      phase: stepPhase,
      role: spec.role,
      // The unit baseline rides on the chain (strict resume: attempt records it with the active record).
      baseline,
    }
    if (resume) {
      // attempt's resumed test (a session on the chain and a pending note) sends
      // the first prompt into the original session regardless of the reuse switch
      // and threshold; the note is cleared once used. The takeover repeats the
      // constructor's pct/used/at values, so the chain state is bit-identical.
      resumeSession(chain, resumedSession!, resumedUsage!, resumedAt, resumeNote(stepPhase, true, strict))
      // Session-agent binding and the continuation's model (plans/0055 §8.2,
      // §6.2): the resumed session stays on the agent its record names and —
      // a record naming its model — the first dispatch continues on that
      // model while it is still usable, instead of a fresh pick moving the
      // live session's model.
      const routing = routingOf(opts, switches)
      bindAgent(chain, resumedAgent ?? routing.runAgent)
      if (resumedModel !== undefined) setRoute(chain, { entry: resumedModel, model: routing.registry.models.get(resumedModel)?.model })
    }
    const result = await runSession(client, task, promptText + feedback, opts, chain, undefined, undefined, switches)
    if (result.type === "blocked") return result
    if (spec.commit) {
      const committed = await git.afterSession(opts.dir, opts, task, spec.commit, baseline)
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
