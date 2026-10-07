import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import type { UnitBaseline } from "./git"

// Progress record: during a run the driver persists the task pipeline's
// current phase and the session-chain session to the target directory's
// .auto/progress.json. Re-running after an application crash / forced
// termination recovers precisely from it:
// - active and the session still exists on the server → reuse that session to
//   continue (same shape as `opencode -r <session-id>`: the session history
//   persists in the server's project store, so dispatching a new prompt to the
//   original session continues with the full context and in-session progress
//   not yet on disk is not lost); the first prompt carries a "continuing after
//   an interruption" note (with per-phase next-step guidance); when a handover
//   document was already written before the interruption (ondemand handoff /
//   handover-test) there is no reuse — the old session's context is spent and
//   progress is carried by the handover document, a new session resumes from
//   it; --new-session explicitly abandons the old session (only the reuse is
//   skipped; exact phase re-entry is kept).
// - A graceful exit (blocked / reverted to pending) has the driver write a
//   summary before exiting (an active=false record; the reason sits in the run
//   log); on resume a new session continues from the summary, the old session
//   is not reused — human attention may take hours and change the environment,
//   so the old session's context is no longer trustworthy;
// - The record also carries the phase: on resume the pipeline re-enters by
//   phase (off/ondemand do not rerun the whole-task session for execution
//   phases already past, closeout skips the wrap-up, etc.).
// The record is written the moment a prompt dispatch succeeds (claiming the
// running session — a kill mid-round loses nothing) and refreshed with the
// result after the round ends; a retryable session error restores the record
// to its pre-dispatch snapshot (an abandoned copy must not displace the real
// recovery point, see plans/0015-session-error-retry-plan.md point 4 and
// plans/0018-session-resume-precedence-design.md).
// The record is deleted when the task completes. Besides the session-chain
// session, phase-level bypass steps (phase-plan/phase-handover,
// phase.kind = "step") also write a record: it stays active until the driver's
// close-out (artifact checks + commit + post-processing), so that after an
// interruption session recovery takes precedence over "deriving the route from
// the files the AI wrote" (the latter would silently skip a planning/handover
// session never closed out). One-shot no-phase bypass sessions (dryrun / the
// fork base, etc.) still write no record, to avoid polluting the recovery
// memory.

// Phase-level bypass steps (process steps closed out on the driver side, not
// task-pipeline phases): phase-plan = the phase planning session (writes the
// task index and task documents), phase-handover = the handover-distillation
// session (produces the handover document), phase-append = the append-planning
// session (plans/0053 D23: appends new tasks after the existing task index,
// model routing reuses the phase-plan role). These sessions previously wrote
// no recovery point; after an interruption the flow derived the route purely
// from the AI-written files (task units / the handover document) and silently
// skipped the session never closed out — see
// plans/0018-session-resume-precedence-design.md.
export type StepKind = "phase-plan" | "phase-handover" | "phase-append"

// Phase markers of the task pipeline:
// - decompose: the true-mode phase (the pipeline, the auto mode before
//   plans/0059 D1) merging the understand and decompose
//   sessions (understand+decompose merged into one since M1.0, see
//   plans/0030-subtask-loop-entry-design.md; artifacts = context.md +
//   shared.md + subtasks.md + each subtask's todo.md, checklist not yet
//   injected). Legacy "understand" records are mapped to this phase when
//   parseProgress reads them (compatibility read).
// - whole: the off/auto/ondemand-mode whole-task single-session execution
//   phase (auto's lead, plans/0059 D2)
// - subtasks: the per-subtask session phase (continues from the first unticked
//   item); index = the owning subtask's 1-based ordinal, carried only by the
//   active record of a subtask session (interim / summary-state records do not
//   carry it)
// - wrapup: the wrap-up session phase — the verification session since
//   plans/0083 (D1/D7: one session does verify + report); round = the fix
//   rounds this task has already spent (a round counts once it opens, so a
//   resumed run never re-runs a spent fix round; absent = none yet). The
//   kind stays "wrapup" for resume compatibility with pre-0083 records.
// - closeout: the wrap-up is finished, only the task report result-line check
//   and the completion mark remain (no session); on resume the wrap-up is
//   skipped. Retired verify/review records (D13; both only ever appeared after
//   the wrap-up) are mapped to this phase when read
// - step: a phase-level bypass step (phase-plan/phase-handover/phase-append);
//   unit is the owning phase's qualified id R-NN.P<nn> (before M3.6 a preset
//   letter; old records lack unit, match no phase, and the loop warns then
//   continues by file-derived routing);
//   the record stays active until the driver's close-out, so that after an
//   interruption session recovery takes precedence over file-derived routing
//
// Unit-ownership gate (runner.unitReruns): an active record's session belongs
// to one concrete execution unit (a task-level phase / subtask #N); on resume
// its session may be reused only when this run will rerun that unit. When the
// unit is past, a config/switch change stops it from running, or the record
// lacks the ordinal so ownership cannot be decided (an old-version record),
// the record turns into the summary state and a new session opens — recovery
// happens only when the original unit reruns; the next unit must not continue
// the previous unit's interrupted session by mistake.
export type Phase =
  | { kind: "decompose" }
  | { kind: "whole" }
  | { kind: "subtasks"; index?: number }
  | { kind: "wrapup"; round?: number }
  | { kind: "closeout" }
  | { kind: "step"; step: StepKind; unit: string }

export type Progress = {
  task: string
  // The session-chain session id; kept after a graceful exit for diagnosis,
  // but active=false means it is never reused again. The test-handover finish
  // writes the "no session in flight" state (active=true with session
  // missing): the session that handed over the handover document has finished
  // its task and must not be reused on restart; resume picks the session after
  // the handover back up via .auto/handover.json (attempt's testHandover
  // branch).
  session?: string
  at: number
  // true = the session stopped mid-way with no summary (kill / crash / network
  // failure); on resume it is reused if still alive.
  active: boolean
  phase?: Phase
  // Unit baseline (per-repository HEAD short SHA,
  // plans/0022-session-recovery-fidelity-design.md 3.1 ③): with strict resume
  // (OPENCODE_AUTO_STRICT_RESUME) on, attempt writes it alongside the active
  // record; on resume it verifies each repository's HEAD == the baseline, or
  // that every commit in baseline..HEAD carries the Auto-Stage trailer; missing
  // in old records / with the switch off → not reusable under strict resume
  // (rollback or a new session).
  baseline?: UnitBaseline
  // The effective model (provider/model string, 3.1 ④): the actual model
  // resolved when the prompt was dispatched; on resume, a mismatch against the
  // current config's resolution → no reuse (continuing a session on a
  // different model = behavior drift). With model routing unconfigured there
  // is no string to record; under strict resume that likewise counts as not
  // reusable.
  model?: string
  // The agent profile the recorded session lives on (plans/0055 §8.2): session
  // ids are agent-local, so the record carries its agent next to the id.
  // Written only under a model registry (without one there is no agent notion
  // and the files stay byte-identical); an absent field means the default
  // agent's session, so every record written before the binding stays valid.
  // AUTO-DECISION: any registry writes the field, even a single-agent one (the registry's presence is the switch; keying the shape on the profile count would flip records the moment an operator adds a profile nobody dispatches on, and the read side accepts both shapes forever anyway)
  agent?: string
  // The recorded session's context figure (tokens), written only by an /exit
  // inside the recovery wait (plans/0057 §6): the resume reads it when the
  // agent keeps no readable history to rebuild the figure from (the claude
  // adapter), so the continuation does not start from 0. Absent everywhere
  // else, so every other record keeps its shape.
  used?: number
}

const FILE = join(".auto", "progress.json")

export async function saveProgress(dir: string, progress: Progress) {
  await mkdir(join(dir, ".auto"), { recursive: true })
  await Bun.write(join(dir, FILE), JSON.stringify(progress))
}

// Deleted as soon as the task completes (completed under any Outcome); force
// makes the missing case harmless too.
export async function forgetProgress(dir: string) {
  await rm(join(dir, FILE), { force: true })
}

// Reads the progress record belonging to the task (does not verify the
// session liveness — that verdict sits in runner). Returns undefined on a task
// mismatch, a missing file, or a corrupt one.
export async function recallProgress(dir: string, task: string): Promise<Progress | undefined> {
  const record = await readProgress(dir)
  if (!record || record.task !== task) return undefined
  return record
}

// Reads the current progress record (regardless of task).
export async function peekProgress(dir: string): Promise<Progress | undefined> {
  return readProgress(dir)
}

// The recovery point of a phase step not yet closed out: when the record is an
// active step variant, returns its step identity and session (for the loop to
// let session recovery take precedence over file-derived routing, see
// plans/0018-session-resume-precedence-design.md); returns undefined for a
// non-step record, a closed-out one (active=false), or no record.
export async function openStep(dir: string): Promise<{ step: StepKind; unit: string; session?: string } | undefined> {
  const record = await peekProgress(dir)
  if (record?.active && record.phase?.kind === "step") {
    return { step: record.phase.step, unit: record.phase.unit, session: record.session }
  }
  return undefined
}

// Close-out of a phase step: deletes it only when the current record is
// exactly this step (the driver has finished artifact checks / commit /
// post-processing; the recovery point is no longer needed). Leaves it
// untouched on a mismatch (already overwritten by a task record, etc.), to
// avoid clearing the wrong one.
export async function closeStep(dir: string, step: StepKind, unit: string): Promise<void> {
  const record = await peekProgress(dir)
  if (record?.phase?.kind === "step" && record.phase.step === step && record.phase.unit === unit) {
    await forgetProgress(dir)
  }
}

async function readProgress(dir: string): Promise<Progress | undefined> {
  const raw = await Bun.file(join(dir, FILE)).text().catch(() => undefined)
  return raw ? parseProgress(raw) : undefined
}

// The wrapup phase's fix-round count (plans/0083 D7): kept only when it is a
// non-negative finite number, dropped otherwise (a corrupt or hand-edited
// record re-enters with zero rounds spent — conservative for the budget:
// re-running a verify round is always safe, skipping a spent fix round
// never re-books it).
function sanitizePhaseRound(phase: Phase | undefined): Phase | undefined {
  if (phase?.kind !== "wrapup" || phase.round === undefined) return phase
  return typeof phase.round === "number" && Number.isFinite(phase.round) && phase.round >= 0
    ? phase
    : { kind: "wrapup" }
}

function parseProgress(raw: string): Progress | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<Progress>
    if (typeof parsed.task !== "string") return undefined
    // Legacy "understand" records (pre-M1.0 split understand/decompose sessions)
    // re-enter the merged understand+decompose unit (plans/0030 D2). Legacy
    // "verify"/"review" records (retired, plans/0044 D5) only ever followed the
    // wrap-up, so they re-enter at closeout: no wrap-up rerun, straight to the
    // result check and the done commit.
    const rawKind: unknown = parsed.phase?.kind
    const phase =
      typeof rawKind !== "string"
        ? undefined
        : rawKind === "understand"
          ? ({ kind: "decompose" } satisfies Phase)
          : rawKind === "verify" || rawKind === "review"
            ? ({ kind: "closeout" } satisfies Phase)
            : sanitizePhaseRound(parsed.phase)
    return {
      task: parsed.task,
      session: typeof parsed.session === "string" ? parsed.session : undefined,
      at: typeof parsed.at === "number" ? parsed.at : 0,
      active: parsed.active === true,
      phase,
      baseline: Array.isArray(parsed.baseline)
        ? parsed.baseline.filter(
            (line): line is { root: string; sha: string } => typeof line?.root === "string" && typeof line?.sha === "string",
          )
        : undefined,
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      // The session's agent profile (§8.2): absent = the default agent's.
      agent: typeof parsed.agent === "string" ? parsed.agent : undefined,
      used: typeof parsed.used === "number" && Number.isFinite(parsed.used) && parsed.used >= 0 ? parsed.used : undefined,
    }
  } catch {
    return undefined
  }
}
