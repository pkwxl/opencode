// The unit-ownership gate of a resume point and the interruption wording:
// whether the unit an active session belongs to reruns this time (deciding
// whether its session may be reused), plus rendering of the two texts for
// humans and the AI — phase description / resume note. Depends only on types
// and switches, not on the session layer.
// Split out of src/runner.ts (plans/0024-module-split-plan.md S4, pure move).
import { HANDOVER_SECTIONS } from "./document/roles"
import { nextChecklistIndex, type DeclaredItem } from "./document/state"
import type { SubtaskMode } from "./opts"
import type { Phase } from "./resume"
import { autoSwitches } from "./switches"

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