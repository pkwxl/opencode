// 提示词上下文组装层: 文案全部在 templates/prompts/*.md(共享片段见 _partials.md,
// 经 src/template.ts 渲染;目标目录 .opencode/auto/prompts/ 可覆盖),这里只负责
// 把 plan/task/运行信息组装为模板变量。render* 签名保持稳定,runner/loop/final
// 的调用点不感知模板机制。
import { dirname, join } from "node:path"
import type { ModeSpec } from "./mode"
import type { Plan, Task } from "./plan"
import { renderTemplate, type Ctx } from "./template"
import { verifyTmpDir } from "./verify"

// --commit 四档: subtask(每子任务提交,缺省)/ task(仅任务收尾提交)/
// once(整个计划完成后提交一次)/ none(从不提交)。
export type CommitMode = "subtask" | "task" | "once" | "none"

type Opts = { commit?: CommitMode; mode?: ModeSpec }

// 审核会话的判定文件(相对目标目录);driver 在审核会话结束后解析其结论行。
export const VERDICT_FILE = ".auto/verify.md"

// --review 质量审核会话的结论文件(相对目标目录);协议同 VERDICT_FILE,
// driver 复用同一解析逻辑读取其末行结论。
export const REVIEW_FILE = ".auto/review.md"

// 三段式 verify 的运行信息:driver 执行脚本后交判定会话。out/err 为整写输出的
// 绝对路径,内容由判定会话直读文件,不经工具输出截断(这正是三段式的目的)。
// timeoutReason: idle = 持续无输出被看门狗终止;max = 超过绝对时长上限被终止。
export type VerifyRun = {
  script: string
  code: number
  ms: number
  timedOut: boolean
  timeoutReason?: "idle" | "max"
  out: string
  err: string
}

// Decomposition session: read-only analysis, then write the subtask list to
// docs/<id>.subtasks.md. The driver parses it and injects the checklist into
// PLAN.md itself, so the session must not touch PLAN.md.
export function renderDecompose(plan: Plan, task: Task, opts: Opts = {}): string {
  return renderTemplate("decompose", baseCtx(plan, task, opts))
}

// Subtask session: exactly one checklist item. The session implements it and
// self-checks; ticking the checkbox is the driver's job when the session ends.
export function renderSubtask(plan: Plan, task: Task, subtask: string, opts: Opts = {}): string {
  return renderTemplate("subtask", {
    ...baseCtx(plan, task, opts),
    subtask,
    commitSubtask: opts.commit === "subtask",
    note: `${task.id} 与子任务"${subtask}"`,
  })
}

// Wrap-up session: every subtask is already ticked by the driver. Only docs,
// the sweep commit, and the output-summary report remain.
export function renderWrapup(plan: Plan, task: Task, opts: Opts & { solo?: boolean } = {}): string {
  const commit = opts.commit !== "once" && opts.commit !== "none"
  return renderTemplate("wrapup", {
    ...baseCtx(plan, task, opts),
    solo: Boolean(opts.solo),
    commit,
    stepNo: commit ? "4" : "3",
    note: `${task.id} 与任务摘要`,
  })
}

// Verify script generation session (fresh side session): translate the verify
// field's acceptance semantics into an executable script at tmp/verify.sh.
export function renderVerifyScriptGen(plan: Plan, task: Task, scriptPath: string): string {
  return renderTemplate("verify-script-gen", { ...baseCtx(plan, task), scriptPath, verifyState: verifyState(task) })
}

// Verify judge session (fresh side session): the driver already executed the
// script — the prompt injects the run info and the later-verify list; the
// session only reads files and code to reach a verdict (protocol details in
// templates/prompts/verify-judge.md).
export function renderVerifyJudge(plan: Plan, task: Task, run: VerifyRun): string {
  const later = plan.tasks.filter((item) => item.id !== task.id && item.status !== "done" && item.verify)
  return renderTemplate("verify-judge", {
    ...baseCtx(plan, task),
    verifyState: verifyState(task),
    runScript: run.script,
    runCode: String(run.code),
    runMs: String(run.ms),
    runTimeout: run.timedOut
      ? `是(已被 driver 终止${run.timeoutReason === "max" ? ":超过绝对时长上限" : ":持续无输出,看门狗判定无进度"})`
      : "否",
    runOut: run.out,
    runErr: run.err,
    replacement: join(verifyTmpDir(dirname(plan.path)), "verify.sh"),
    laterVerifyList: later.length ? later.map((item) => `   - ${item.id}: ${item.verify}`).join("\n") : "   (无)",
  })
}

// Fix round after a failed task-level review: send the gap back and resume the
// execution session chain with it.
export function renderFix(plan: Plan, task: Task, gap: string): string {
  return renderTemplate("fix", { ...baseCtx(plan, task), gap })
}

// --review quality-audit session (fresh side session); variants for final and
// early live in templates/prompts/review.md.
export function renderReview(plan: Plan, task: Task, opts: { final: boolean; early?: boolean }): string {
  return renderTemplate("review", {
    ...baseCtx(plan, task),
    final: opts.final,
    early: Boolean(opts.early),
    scriptPath: join(verifyTmpDir(dirname(plan.path)), "verify.sh"),
  })
}

// --review fix-planning session (fresh side session): turn the audit gap into
// self-contained fix checklist items in docs/<id>.fix.md.
export function renderReviewFix(plan: Plan, task: Task, gap: string): string {
  return renderTemplate("review-fix", { ...baseCtx(plan, task), gap })
}

// --final-review 终审四阶段(audit → remediate → validate → finalize,
// validate 差距回退 audit,设计文档 B.2)。
export type FinalStage = "audit" | "remediate" | "validate" | "finalize"

// --final-review 终审任务生成会话(旁路一次性,复用 requireArtifact 骨架);四阶段
// 的职责与报告产出要求以条件段内联在 templates/prompts/final-task.md。
export function renderFinalTask(plan: Plan, stage: FinalStage, round: number, prior: string, mode?: ModeSpec): string {
  const emphasis = stage === "remediate" ? undefined : mode?.final[stage]
  return renderTemplate("final-task", {
    doneList: doneList(plan),
    prior,
    emphasis,
    modeName: mode?.name,
    round: String(round),
    stageName: stageText(stage),
    proposalFile: `docs/final/plan-${stage}-r${round}.md`,
    reaudit: stage === "audit" && round >= 2,
    stageAudit: stage === "audit",
    stageRemediate: stage === "remediate",
    stageValidate: stage === "validate",
    stageFinalize: stage === "finalize",
  })
}

// 终审四阶段的中文名(横幅/标题/提示词共用,loop 与 final 的日志亦用)。
export function stageText(stage: FinalStage): string {
  switch (stage) {
    case "audit":
      return "终审审计"
    case "remediate":
      return "修复"
    case "validate":
      return "回归验证"
    case "finalize":
      return "终审收尾"
  }
}

// ondemand 模式的交接文档(相对目标目录);driver 在上下文达到 --context-limit
// 时插入交接提示,会话把进度写入该文件,末行 `状态: 继续|完成` 由 driver 解析。
export function handoffFile(task: Task): string {
  return `docs/${task.id}.handoff.md`
}

// ondemand 模式: driver 在会话进行中(上下文达到上限时)插入的交接提示。
// v2 prompt 默认 steer,在下一个 provider turn 边界进入会话。
export function renderHandoffSteer(task: Task): string {
  return renderTemplate("handoff-steer", { handoffFile: handoffFile(task) })
}

// --subtask off/ondemand: 单会话完成整个任务(不做子任务分解)。ondemand 额外附带
// 交接条款;continuation 表示此前会话因上下文限制中断,需先读交接文档继续。
export function renderWhole(
  plan: Plan,
  task: Task,
  opts: Opts & { ondemand?: boolean; continuation?: boolean } = {},
): string {
  return renderTemplate("whole", {
    ...baseCtx(plan, task, opts),
    ondemand: Boolean(opts.ondemand),
    continuation: Boolean(opts.continuation),
    commitSubtask: opts.commit === "subtask",
    handoffFile: handoffFile(task),
    note: `${task.id} 与任务摘要`,
  })
}

// --dryrun: 权限预检会话,报告写入 .auto/dryrun.md。
export function renderDryrun(): string {
  return renderTemplate("dryrun", {})
}

// --commit once: 整个计划完成后的唯一一次提交会话(全新会话,不进任何链)。
export function renderCommitAll(plan: Plan): string {
  return renderTemplate("commit-all", { doneList: doneList(plan), note: "整个计划完成" })
}

// init --prompt: 初始化规划会话,按用户需求填充 PLAN.md,不实施。
export function renderInit(promptText: string, mode?: ModeSpec): string {
  return renderTemplate("init", { promptText, modeName: mode?.name, modeInit: mode?.init })
}

function doneList(plan: Plan): string {
  return plan.tasks
    .filter((t) => t.status === "done")
    .map((t) => `- [done] ${t.id}: ${t.title}`)
    .join("\n")
}

// 公共上下文: head(done 清单)/blocked(阻塞问答)/mode-section(模式注记)三个
// 共享片段与任务块所需的变量。
function baseCtx(plan: Plan, task: Task, opts: Opts = {}): Ctx {
  return {
    taskId: task.id,
    taskBlock: `# ${task.id}: ${task.title}\n\n${task.body}`,
    doneList: doneList(plan),
    blockedAnswered: Boolean(task.question && task.answer),
    blockedUnanswered: Boolean(task.question && !task.answer),
    question: task.question ?? "",
    answer: task.answer ?? "",
    modeName: opts.mode?.name,
    modeInit: opts.mode?.init,
    modeExec: opts.mode?.exec,
  }
}

// verify 字段在提示词中的两种形态: `是"<原文字段>"` 或 `未声明`。
function verifyState(task: Task): string {
  return task.verify ? `是"${task.verify}"` : "未声明"
}
