// The unit-ownership gate of a resume point and the interruption wording:
// whether the unit an active session belongs to reruns this time (deciding
// whether its session may be reused), plus rendering of the three texts for
// humans and the AI — phase description / resume note / CURRENT.md interruption
// remark. Depends only on types and switches, not on the session layer.
// Split out of src/runner.ts (plans/0024-module-split-plan.md S4, pure move).
import { HANDOVER_SECTIONS } from "./document/roles"
import { nextChecklistIndex, type DeclaredItem } from "./document/state"
import type { Outcome } from "./opts"
import type { Phase } from "./resume"
import { shellProfile } from "./shell"
import { autoSwitches } from "./switches"

// 恢复点的单元归属门禁: active 记录的中断会话属于某个具体执行单元(任务级
// 阶段/子任务#N),仅当本次运行将重跑该单元时返回 true(允许
// 复用其会话)。单元已过(检查项序号错位:中断发生在子任务收口后的间歇)、
// 配置/实验开关变更使该单元不再执行、或记录缺失序号无法判定归属(老版本
// 记录)时返回 false——恢复只发生在原单元重跑时,防下一单元误续上一单元的
// 中断会话。ctx 由调用方按当前 subtasks.md/文件状态预计算(文件 IO 不进本函数)。
export type UnitRerunCtx = {
  // 子任务模式(auto/off/ondemand)与 fork 开关(子任务分叉的运行条件)
  mode: "auto" | "off" | "ondemand"
  fork: boolean
  // 当前检查项(subtasks.md);子任务目录状态协议激活时
  // done 旗标已被调用方按 done.md 存在性覆盖(文件存在性即进度事实,plans/0030 D10)
  items: (DeclaredItem & { text: string })[]
  // subtasks.md 已有检查项(合并理解与分解单元将幂等直注,不重开会话)
  subtasksFileItems: number
  // 收尾单元本轮是否会跑(配置已计入)
  wrapup: boolean
}

export function unitReruns(phase: Phase | undefined, ctx: UnitRerunCtx): boolean {
  // The subtask the loop would run next (dependency order, M3.5; without
  // `Depends:` fields the first unticked item).
  const firstUnticked = nextChecklistIndex(ctx.items)
  // 序号归属: 记录的检查项恰为当前首个未勾选项 = 该单元将重跑
  const atItem = (index: number | undefined) => index !== undefined && firstUnticked === index - 1
  switch (phase?.kind) {
    case "decompose":
      // 合并理解与分解单元(M1.0,plans/0030 D2): 检查项未注入且 subtasks.md 无
      // 检查项时重跑(旧版 understand 记录经 parseProgress 映射为本阶段)
      return ctx.mode === "auto" && ctx.items.length === 0 && ctx.subtasksFileItems === 0
    case "whole":
      return ctx.mode !== "auto"
    case "subtasks":
      return atItem(phase.index)
    case "wrapup":
      return ctx.wrapup && firstUnticked === -1
    case "closeout":
      // 结论行检查与完成标记由 driver 承担,没有归属本单元的会话
      return false
    case "step":
      // step 恢复点由 loop 经 openStep 判定归属,不经任务流水线复用
      return true
    case undefined:
      // 无阶段记录: 无法判定单元归属,不复用(恢复走默认流程)
      return false
  }
}
// Human-readable description of a phase (shared by resume logs and the
// CURRENT.md interruption remark).
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
      return phase.step === "phase-plan"
        ? `phase planning step (phase ${phase.unit}, writing the task index and task documents)`
        : `phase handover step (phase ${phase.unit}, producing the handover document)`
  }
}

// The "[DRIVER] continuing after an interruption" note injected with the first
// prompt on resume: step-specific guidance per recorded phase, so the AI does
// not redo finished work.
// Under strict resume (OPENCODE_AUTO_STRICT_RESUME=on) a reused session (R1/R2)
// gets a single continue line (plans/0022-session-recovery-fidelity-design.md 3.2):
// field evidence shows a resumed session locates itself from the disk anyway
// (CURRENT.md → git status → first unticked item), so the phase guidance is
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
    `First read CURRENT.md for the current task and progress, and check the actual worktree state with git status / git diff. ${COMMIT_CLARIFY} ` +
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
      return phase.step === "phase-plan"
        ? `You are in the phase planning step: first read this phase's task index tasks.md and the task documents written so far (the last session may have written some tasks), complete or correct this phase's tasks on that basis without repeating an existing task number, then end the session. `
        : `You are in the phase handover step: first read the handover document as it stands (the last session may have written part of it), complete the four mandatory sections (${HANDOVER_SECTIONS.join(" / ")}) without redoing finished parts, then end the session. `
  }
}

// The CURRENT.md interruption remark (written when a non-completion outcome
// keeps the file): exit reason, phase snapshot and how to resume; when the next
// run rebuilds the mirror, its gist reaches the AI through the resume prompt
// (resumeNote).
export function interruptionRemark(outcome: Outcome, phase: Phase | undefined): string {
  const why =
    outcome.type === "blocked"
      ? `blocked: ${firstLine(outcome.question)}`
      : outcome.type === "incomplete"
        ? `incomplete, back to pending: ${firstLine(outcome.reason)}`
        : `done`
  return [
    `## Interruption remark (opencode-auto)`,
    ``,
    `- Exited at: ${new Date().toISOString()}`,
    `- Exit reason: ${why}`,
    `- Interrupted phase: ${phaseText(phase)}`,
    `- How to resume: handle the reason above and re-run ${shellProfile().program}; the DRIVER continues exactly from the interrupted phase, and the gist of this remark reaches the AI with the resume prompt.`,
  ].join("\n")
}

export function firstLine(text: string): string {
  return text.split("\n")[0]!.slice(0, 200)
}