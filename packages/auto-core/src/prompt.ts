// 提示词上下文组装层: 文案全部在 templates/prompts/*.md(共享片段见 _partials.md,
// 经 src/template.ts 渲染;目标目录 .opencode/auto/prompts/ 可覆盖),这里只负责
// 把 plan/task/运行信息组装为模板变量。render* 签名保持稳定,runner/loop/final
// 的调用点不感知模板机制。
import { dirname, join } from "node:path"
import type { ModeSpec } from "./mode"
import type { Plan, Task } from "./plan"
import { phaseText, type Phase } from "./phases"
import { renderTemplate, renderText, type Ctx } from "./template"
import { verifyTmpDir } from "./verify"

// verify: config.verify(任务级三段式验收开关)。false 时与 verify 相关的描述
// 从会话提示词中整体消失(验收机制不存在,提示词不得提及)。
// testByDriver/handoverTest: --test-by-driver 测试执行协议(与 verify 正交,
// run 级开关)。true 时执行类模板(subtask/whole/fix)注入协议段。
type Opts = { mode?: ModeSpec; verify?: boolean; testByDriver?: boolean; handoverTest?: boolean }

// 审核会话的判定文件(相对目标目录);driver 在审核会话结束后解析其结论行。
export const VERDICT_FILE = ".auto/verify.md"

// --review 质量审核会话的结论文件(相对目标目录);协议同 VERDICT_FILE,
// driver 复用同一解析逻辑读取其末行结论。
export const REVIEW_FILE = ".auto/review.md"

// 三段式 verify 的运行信息:driver 执行脚本后交判定会话。out 为 stdout 与
// stderr 合并整写的绝对路径(单文件),内容由判定会话直读,不经工具输出截断
// (这正是三段式的目的)。timeoutReason: idle = 持续无输出被看门狗终止;
// max = 超过绝对时长上限被终止。
export type VerifyRun = {
  script: string
  code: number
  ms: number
  timedOut: boolean
  timeoutReason?: "idle" | "max"
  out: string
}

// --test-by-driver 的单次测试执行信息(VerifyRun + 按序归档编号): driver 执行
// AI 指定的 test/ 脚本后经 steer 注入执行会话,AI 直读合并输出文件判断。
export type TestRunInfo = VerifyRun & { seq: number }

// --handover-test 的测试交接文档(相对目标目录): 测试失败且上下文达到上限时,
// 会话把进度与后续步骤写入该文件后结束,driver 开新会话以 continuation 提示续跑。
export function testHandoffFile(task: Task): string {
  return `docs/${task.id}.testhandoff.md`
}

// 测试执行结果反馈(steer 注入执行会话): 退出码与输出文件路径,AI 直读文件判断。
export function renderTestResult(run: TestRunInfo): string {
  return renderTemplate("test-result", {
    seq: String(run.seq),
    script: run.script,
    code: String(run.code),
    ms: String(run.ms),
    runTimeout: run.timedOut
      ? `是(已被 driver 终止${run.timeoutReason === "max" ? ":超过绝对时长上限" : ":持续无输出,看门狗判定无进度"})`
      : "否",
    out: run.out,
  })
}

// --handover-test 交接要求(steer 注入执行会话): 测试失败且上下文达到上限,
// 要求立即写交接文档并结束会话,由 driver 开新会话继续。
export function renderTestHandover(run: TestRunInfo, info: { handoffFile: string; used: number; limit: number }): string {
  return renderTemplate("test-handover", {
    code: String(run.code),
    out: run.out,
    script: run.script,
    handoffFile: info.handoffFile,
    used: String(info.used),
    limit: String(info.limit),
  })
}

// 测试交接后的新会话续跑说明(追加到执行提示词): 先读交接文档与最近一次测试
// 输出再继续。stuck 为连续交接次数超过阈值(10)时的提醒——评估是否陷入暂时
// 无法解决的问题,可经 AUTO-FIXME 标注遗留后继续。
export function renderTestContinue(input: { handoffFile: string; run?: TestRunInfo; stuck?: number }): string {
  return renderTemplate("test-continue", {
    handoffFile: input.handoffFile,
    runScript: input.run?.script,
    runCode: input.run ? String(input.run.code) : undefined,
    runOut: input.run?.out,
    stuck: input.stuck ? String(input.stuck) : undefined,
  })
}

// Decomposition session: read-only analysis, then write the subtask list to
// docs/<id>.subtasks.md. The driver parses it and injects the checklist into
// PLAN.md itself, so the session must not touch PLAN.md.
export function renderDecompose(plan: Plan, task: Task, opts: Opts = {}): string {
  return renderTemplate("decompose", baseCtx(plan, task, opts))
}

// Subtask session: exactly one checklist item. The session implements it and
// self-checks; ticking the checkbox is the driver's job when the session ends
// (会话后的统一提交同样由 driver 执行,见 src/git.ts)。
// handoff-steer 同样适用于子任务会话: 上下文达到 2x contextLimit 时 driver
// 插入交接提示,会话把进度写入 docs/<id>.handoff.md 后由新会话续跑;
// continuation 表示此前会话因上下文限制中断,需先读交接文档继续。
export function renderSubtask(plan: Plan, task: Task, subtask: string, opts: Opts & { continuation?: boolean } = {}): string {
  return renderTemplate("subtask", {
    ...baseCtx(plan, task, opts),
    subtask,
    continuation: Boolean(opts.continuation),
    handoffFile: handoffFile(task),
  })
}

// Wrap-up session: every subtask is already ticked by the driver. Only docs
// and the output-summary report remain.
export function renderWrapup(plan: Plan, task: Task, opts: Opts & { solo?: boolean } = {}): string {
  return renderTemplate("wrapup", {
    ...baseCtx(plan, task, opts),
    solo: Boolean(opts.solo),
  })
}

// Verify script generation session (fresh side session): translate the verify
// field's acceptance semantics into an executable script at tmp/verify.sh.
export function renderVerifyScriptGen(plan: Plan, task: Task, scriptPath: string, opts: Opts = {}): string {
  return renderTemplate("verify-script-gen", { ...baseCtx(plan, task, opts), scriptPath, verifyState: verifyState(task) })
}

// Verify judge session (fresh side session): the driver already executed the
// script — the prompt injects the run info and the later-verify list; the
// session only reads files and code to reach a verdict (protocol details in
// templates/prompts/verify-judge.md).
export function renderVerifyJudge(plan: Plan, task: Task, run: VerifyRun, opts: Opts = {}): string {
  const later = plan.tasks.filter((item) => item.id !== task.id && item.status !== "done" && item.verify)
  return renderTemplate("verify-judge", {
    ...baseCtx(plan, task, opts),
    verifyState: verifyState(task),
    runScript: run.script,
    runCode: String(run.code),
    runMs: String(run.ms),
    runTimeout: run.timedOut
      ? `是(已被 driver 终止${run.timeoutReason === "max" ? ":超过绝对时长上限" : ":持续无输出,看门狗判定无进度"})`
      : "否",
    runOut: run.out,
    replacement: join(verifyTmpDir(dirname(plan.path)), "verify.sh"),
    laterVerifyList: later.length ? later.map((item) => `   - ${item.id}: ${item.verify}`).join("\n") : "   (无)",
  })
}

// Fix round after a failed task-level review: send the gap back and resume the
// execution session chain with it.
export function renderFix(plan: Plan, task: Task, gap: string, opts: Opts = {}): string {
  return renderTemplate("fix", { ...baseCtx(plan, task, opts), gap })
}

// --review quality-audit session (fresh side session); variants for final and
// early live in templates/prompts/review.md.
export function renderReview(plan: Plan, task: Task, opts: Opts & { final: boolean; early?: boolean }): string {
  return renderTemplate("review", {
    ...baseCtx(plan, task, opts),
    final: opts.final,
    early: Boolean(opts.early),
    scriptPath: join(verifyTmpDir(dirname(plan.path)), "verify.sh"),
  })
}

// --review fix-planning session (fresh side session): turn the audit gap into
// self-contained fix checklist items in docs/<id>.fix.md.
export function renderReviewFix(plan: Plan, task: Task, gap: string, opts: Opts = {}): string {
  return renderTemplate("review-fix", { ...baseCtx(plan, task, opts), gap })
}

// --final-review 终审四阶段(audit → remediate → validate → finalize,
// validate 差距回退 audit,设计文档 B.2)。
export type FinalStage = "audit" | "remediate" | "validate" | "finalize"

// --final-review 终审任务生成会话(旁路一次性,复用 requireArtifact 骨架);四阶段
// 的职责与报告产出要求以条件段内联在 templates/prompts/final-task.md。
export function renderFinalTask(plan: Plan, stage: FinalStage, round: number, prior: string, mode?: ModeSpec): string {
  // 终审任务强制跳过任务级验收: verify 恒为 false(state-rule 的 verified 字段
  // 表述不出现;模式文本同经渲染,可自带条件段)。
  const emphasis = stage === "remediate" ? undefined : mode && modeText(mode.final[stage], {})
  return renderTemplate("final-task", {
    doneList: doneList(plan),
    prior,
    emphasis,
    modeName: mode?.name,
    verify: false,
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

// 阶段规划会话(设计文档 phases-design.md E 节): 旁路一次性,产物 = 直接编辑填充
// 的 PLAN.md(会话被 driver 专门授权写它)。brief 为 .opencode/auto/brief.md 原文
// (可空,模板含未提供提示段);handovers 为各前序阶段 handover.md 的预拼接字符串
// (driver 侧组装,注入纪律: 只注入蒸馏产物、不注入前序原始 docs/)。
// prevRound 为上一轮迁移结论摘录(phases-design.md M 节,loop 侧组装: 归档索引/
// 最终交接/迁移知识),仅续轮(主程序现场清理归档既有轮次后)的新一轮首个规划会话注入。
// source/destDir 为迁移参数(相对工作目录,会话 cwd 即工作目录,相对路径直接可用)。
// finalReview 仅 m 阶段且启用时生效(模板提示任务排布预留终审空间),其余阶段忽略。
// numberStart 为自动编号(config.autoNumber)下的编号起点(.auto/next-task 记录值,
// 由 loop 在规划会话前经 ensureNumbering 确保就位),未启用时缺省——编号自 T-001 起。
export function renderPhasePlan(input: {
  phase: Phase
  brief?: string
  handovers?: string
  prevRound?: string
  source?: { dir: string; path: string }
  destDir?: string
  mode?: ModeSpec
  verify?: boolean
  finalReview?: number
  numberStart?: number
}): string {
  const { phase } = input
  return renderTemplate("phase-plan", {
    phase,
    phaseName: phaseText(phase),
    brief: input.brief?.trim() || undefined,
    handovers: input.handovers?.trim() || undefined,
    prevRound: input.prevRound?.trim() || undefined,
    sourceDir: input.source?.dir,
    sourcePath: input.source?.path,
    destDir: input.destDir,
    modeName: input.mode?.name,
    modeInit: input.mode && modeText(input.mode.init, { verify: input.verify }),
    verify: input.verify,
    finalReview: phase === "m" && input.finalReview ? String(input.finalReview) : undefined,
    numberStart: input.numberStart === undefined ? undefined : String(input.numberStart).padStart(3, "0"),
    phaseA: phase === "a",
    phaseD: phase === "d",
    phaseM: phase === "m",
    phaseT: phase === "t",
    phaseV: phase === "v",
    phaseK: phase === "k",
  })
}

// 自动编号(config.autoNumber)的编号记录恢复会话(src/numbering.ts): 旁路一次性,
// 产物 = AI 写入的 .auto/next-task(单个正整数)。floor 为 driver 确定性扫描的
// 已用编号下限,作模板输入与 driver 侧 collect 校验共用同一数值。
export function renderNumberRecovery(input: { floor: number }): string {
  return renderTemplate("number-recovery", {
    floor: String(input.floor),
    floorPadded: String(input.floor).padStart(3, "0"),
  })
}

// 阶段交接蒸馏会话(设计文档 phases-design.md F.1 步骤 1): 旁路一次性,通读本阶段
// PLAN.md 与 docs/ 产物,蒸馏出归档目录下的 handover.md(四个必备小节协议在模板
// 内联)。archive = phaseArchive(phase);next 为下一阶段"字母 中文名"或 undefined
// (k 阶段无下一阶段,仍写 handover 供人工归档)。
export function renderPhaseHandover(input: { phase: Phase; archive: string; next?: string; verify?: boolean }): string {
  return renderTemplate("phase-handover", {
    phase: input.phase,
    phaseName: phaseText(input.phase),
    archive: input.archive,
    next: input.next,
    verify: input.verify,
  })
}

// k(知识提炼)阶段的知识提取会话(phases-design.md P4,整体认领
// fixme-knowledge-design.md §D.3): 旁路一次性,通读阶段台账与各阶段归档产物,
// 蒸馏出最终验证过的迁移知识文档。file 为输出路径(相对目标目录);mode.exec
// 作场景背景注入(复用 ModeSpec 现有字段,不新增注册表面)。
export function renderKnowledge(input: { file: string; mode?: ModeSpec }): string {
  return renderTemplate("knowledge", {
    file: input.file,
    ...modeCtx(input.mode),
  })
}

// 前置知识提取会话(外壳的二次迁移编排,src/knowledge.ts extractPriorKnowledge):
// 旁路一次性,通读已有迁移结果(不限于此前轮次——docs/ 全树、阶段/轮次归档、产出
// 代码与 git 历史),蒸馏出 docs/prior-kb/ 下的知识文档,作为二次迁移与参数推断
// 的输入。file 为输出路径(相对目标目录);brief 为项目意图原文(可空)。
export function renderPriorKnowledge(input: { file: string; brief?: string; mode?: ModeSpec }): string {
  return renderTemplate("prior-knowledge", {
    file: input.file,
    brief: input.brief?.trim() || undefined,
    ...modeCtx(input.mode),
  })
}

// 参数推断会话(外壳的二次迁移编排): config.source/destDir 缺失时,依据前置知识
// 产物与目录勘察推断迁移源/目标,结论以 JSON 协议整写 file(.auto/infer.json;
// {"sourceDir","sourcePath","destDir"} 或 {"blocked": 原因}),driver 校验后仅采纳
// 缺失键。priorKb 为 prior-kb 文档路径清单(预拼接,会话直读);known 为已固化
// 参数的人类可读描述(预拼接,可空)。
export function renderInferSource(input: { file: string; brief?: string; priorKb?: string; known?: string }): string {
  return renderTemplate("infer-source", {
    file: input.file,
    brief: input.brief?.trim() || undefined,
    priorKb: input.priorKb?.trim() || undefined,
    known: input.known?.trim() || undefined,
  })
}

// 交接文档(相对目标目录): ondemand 整任务会话与 auto 子任务会话共用——driver 在
// 上下文达到 2x --context-limit 时插入交接提示,会话把进度写入该文件,末行
// `状态: 继续|完成` 由 driver 解析。子任务场景的状态以该子任务是否完成计。
export function handoffFile(task: Task): string {
  return `docs/${task.id}.handoff.md`
}

// driver 在会话进行中(上下文达到交接阈值,2x contextLimit)插入的交接提示
// (ondemand 整任务会话与 auto 子任务会话)。
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
    handoffFile: handoffFile(task),
  })
}

// --dryrun: 权限预检会话,报告写入 .auto/dryrun.md。
export function renderDryrun(): string {
  return renderTemplate("dryrun", {})
}

// 模式注记上下文(baseCtx 的模式部分,独立导出): 旁路一次性会话(knowledge 等)
// 与外壳自写的 render* 函数共用同口径的模式变量组装,壳层不必改 prompt.ts。
// 模式文本先经模板引擎渲染(模式文件可用 {{#if verify}} 条件段)再作为变量注入;
// 不传模式时三个变量均为 undefined(模板条件段整体消失)。
export function modeCtx(mode?: ModeSpec, opts: { verify?: boolean } = {}): Ctx {
  return {
    modeName: mode?.name,
    modeInit: mode && modeText(mode.init, opts),
    modeExec: mode && modeText(mode.exec, opts),
  }
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
    ...modeCtx(opts.mode, opts),
    taskId: task.id,
    taskBlock: `# ${task.id}: ${task.title}\n\n${task.body}`,
    doneList: doneList(plan),
    blockedAnswered: Boolean(task.question && task.answer),
    blockedUnanswered: Boolean(task.question && !task.answer),
    question: task.question ?? "",
    answer: task.answer ?? "",
    verify: opts.verify,
    testByDriver: Boolean(opts.testByDriver),
    handoverTest: Boolean(opts.handoverTest),
    testHandoffFile: opts.testByDriver ? testHandoffFile(task) : undefined,
  }
}

function modeText(text: string, opts: Opts): string {
  return renderText(text, { verify: Boolean(opts.verify) })
}

// verify 字段在提示词中的两种形态: `是"<原文字段>"` 或 `未声明`。
function verifyState(task: Task): string {
  return task.verify ? `是"${task.verify}"` : "未声明"
}
