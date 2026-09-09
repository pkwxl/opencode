// 提示词上下文组装层: 文案全部在 templates/prompts/*.md(共享片段见 _partials.md,
// 经 src/template.ts 渲染;目标目录 .opencode/auto/prompts/ 可覆盖),这里只负责
// 把 plan/task/运行信息组装为模板变量。render* 签名保持稳定,runner/loop/final
// 的调用点不感知模板机制。
import { dirname, join } from "node:path"
import type { ModeSpec } from "./mode"
import { finalDoc, subtaskDoc, taskDoc } from "./docpaths"
import { subtasks, type Plan, type Task } from "./plan"
import type { StuckHit } from "./stuck"
import { phaseText, type Phase } from "./phases"
import { promptTemplateNames, renderTemplate, renderText, type Ctx } from "./template"
import { verifyTmpDir } from "./verify"

// verify: config.verify(任务级三段式验收开关)。false 时与 verify 相关的描述
// 从会话提示词中整体消失(验收机制不存在,提示词不得提及)。
// testByDriver/handoverTest: --test-by-driver 测试执行协议(与 verify 正交,
// run 级开关)。true 时执行类模板(subtask/whole/fix)注入协议段。
// phase/contextLimit/fine: 阶段化流程的当前阶段字母、上下文预算基线(tokens)与
// 细粒度分解开关(OPENCODE_AUTO_DECOMPOSE_FINE,开关层接线见
// fork-decompose-design.md §4.6)——分解模板 decompose-<phase> 据此选择与渲染
// (phaseName 注入阶段名;contextBudget = 半预算的粒度上限描述;fine 注入
// 细粒度准则段)。
type Opts = {
  mode?: ModeSpec
  verify?: boolean
  testByDriver?: boolean
  handoverTest?: boolean
  phase?: Phase
  contextLimit?: number
  fine?: boolean
}

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
// 文件按执行范围命名: 子任务会话写 docs/<id>/S<两位序号>/testhandoff.md,整任务
// 会话与验收修复轮为任务级(docs/<id>/testhandoff.md)——交接文档只对本执行范围
// 生效,防止下一子任务误读上一子任务的遗留交接。路径构造经 docpaths(目录化
// 布局的唯一构造点),导出名与签名保持稳定,runner 调用面零改动。
export function testHandoffFile(task: Task, subtask?: number): string {
  return subtask !== undefined ? subtaskDoc(task.id, subtask, "testhandoff") : taskDoc(task.id, "testhandoff")
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

// 理解会话(fork 三段式 ①,fork-decompose 设计 §6): 只读理解 + 预算内选读 +
// 写 docs/<id>/context.md 四节摘要;摘要同时是磁盘态兜底(fork 失败冷启动输入、
// wrapup/后续任务低成本引用)与 digest 模式的基点原料(逐字注入基点会话)。
export function renderUnderstand(plan: Plan, task: Task, opts: Opts = {}): string {
  return renderTemplate("understand", baseCtx(plan, task, opts))
}

// digest 基点会话(①′,driver 主导,fork-decompose 设计 §7): 摘要全文 + 一句
// 确认;会话结束即成为该任务全部分叉(decompose/子任务)的前缀基点。
export function renderContextBase(task: Task, digest: string): string {
  return renderTemplate("context-base", { taskId: task.id, digest })
}

// Decomposition session: read-only analysis, then write the subtask list to
// docs/<id>/subtasks.md. The driver parses it and injects the checklist into
// PLAN.md itself, so the session must not touch PLAN.md.
// 模板按阶段选择: decompose-<phase>(缺省 m;粒度准则以任务描述为基准,fine
// 开启细粒度档),库中无此名回退通用 decompose。
export function renderDecompose(plan: Plan, task: Task, opts: Opts = {}): string {
  return renderTemplate(decomposeTemplateName(opts.phase, promptTemplateNames()), baseCtx(plan, task, opts))
}

// decompose 模板名解析(纯函数,便于单测): 阶段字母 → decompose-<phase>(缺省
// m);names 为当前生效模板名清单(promptTemplateNames()),无此名时回退通用
// decompose。
export function decomposeTemplateName(phase: Phase | undefined, names: string[]): string {
  const candidate = `decompose-${phase ?? "m"}`
  return names.includes(candidate) ? candidate : "decompose"
}

// Subtask session: exactly one checklist item. The session implements it and
// self-checks; ticking the checkbox is the driver's job when the session ends
// (会话后的统一提交同样由 driver 执行,见 src/git.ts)。
// handoff-steer 同样适用于子任务会话: 上下文达到 2x contextLimit 时 driver
// 插入交接提示,会话把进度写入 docs/<id>/handoff.md 后由新会话续跑;
// continuation 表示此前会话因上下文限制中断,需先读交接文档继续。
// index/subtaskList/outputFile/warm(fork 三段式流水线,fork-decompose 设计
// §8): 注入全量检查项列表与「你本次只负责其中的第 N 项」、文档类产出的独立
// 落盘文件(driver 机械命名)、warm=会话从分叉基点继承了任务背景上下文(冷启动
// 则提示先读 context.md 摘要)。缺省时由任务正文检查项推导 index/列表/产出文件
// (与 runner 子任务循环同口径),旧调用不传参仍渲染完整提示词。
export function renderSubtask(
  plan: Plan,
  task: Task,
  subtask: string,
  opts: Opts & { continuation?: boolean; index?: number; subtaskList?: string; outputFile?: string; warm?: boolean } = {},
): string {
  const items = subtasks(task.body)
  const at = opts.index !== undefined ? opts.index - 1 : items.findIndex((item) => !item.done && item.text === subtask)
  const index = at >= 0 ? String(at + 1) : undefined
  return renderTemplate("subtask", {
    // index 的推导值回灌 baseCtx: 测试交接文档命名(测试协议段)与本处注入的
    // 「第 N 项」同源,缺省推导(旧调用不传 index)时同样落子任务级目录命名。
    ...baseCtx(plan, task, { ...opts, index: index !== undefined ? Number(index) : undefined }),
    subtask,
    continuation: Boolean(opts.continuation),
    handoffFile: handoffFile(task),
    index,
    subtaskList: opts.subtaskList ?? (items.length ? items.map((item, i) => `${i + 1}. ${item.text}`).join("\n") : undefined),
    outputFile: opts.outputFile ?? (index !== undefined ? subtaskOutputFile(task, at + 1) : undefined),
    warm: Boolean(opts.warm),
  })
}

// 子任务产物文件(相对目标目录): 文档/分析/设计类子任务的独立落盘文件,driver
// 机械命名(两位递增,避免 slug 清洗歧义),标题写在文件首行;代码类产出直接落
// 源码树,不重复落文档(fork-decompose 设计 §4.7)。构造经 docpaths 目录化。
export function subtaskOutputFile(task: Task, index: number): string {
  return subtaskDoc(task.id, index, "index")
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
// self-contained fix checklist items in docs/<id>/fix.md.
export function renderReviewFix(plan: Plan, task: Task, gap: string, opts: Opts = {}): string {
  return renderTemplate("review-fix", { ...baseCtx(plan, task, opts), gap })
}

// --final-review 终审四阶段(audit → remediate → validate → finalize,
// validate 差距回退 audit,设计文档 B.2)。
export type FinalStage = "audit" | "remediate" | "validate" | "finalize"

// --final-review 终审任务生成会话(旁路一次性,复用 requireArtifact 骨架);四阶段
// 的职责与报告产出要求以条件段内联在 templates/prompts/final-task.md。
export function renderFinalTask(plan: Plan, stage: FinalStage, round: number, prior: string, mode?: ModeSpec): string {
  // 终审产物按产出任务锚定(stable-refs P1-D1): 本会话产出的提案与后续报告都
  // 落即将追加的 T-F<k> 任务自己的目录(k = finalIndex 同口径,函数内推导——
  // 为避免 prompt↔final 循环依赖在此内联计数,构造经 docpaths 的 finalDoc)。
  const index = plan.tasks.filter((task) => task.final).length + 1
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
    finalTask: `T-F${index}`,
    proposalFile: finalDoc(index, `plan-${stage}-r${round}.md`),
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
// 最终交接/迁移知识),仅续轮(新一轮轮目录建立后)的新一轮首个规划会话注入。
// source/destDir 为迁移参数(相对工作目录,会话 cwd 即工作目录,相对路径直接可用)。
// finalReview 仅 m 阶段且启用时生效(模板提示任务排布预留终审空间),其余阶段忽略。
// trimmedPhases 仅 m 阶段生效(生效 phases 经 --phases 裁剪、不含独立 a/d 阶段时由
// loop 传入,模板注入「流程裁剪注记」——勘察设计并入首批任务,底线保障不省)。
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
  trimmedPhases?: boolean
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
    trimmedPhases: phase === "m" && input.trimmedPhases ? true : undefined,
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
// PLAN.md 与 docs/ 产物,蒸馏出永久路径交接文档(四个必备小节协议在模板内联)。
// handover = handoverDoc(dir, round, phase)(src/phases.ts,新布局轮内
// docs/R-NN/handovers/<字母>-<slug>.md,旧布局 docs/handovers/R<N>-<字母>-<slug>.md);
// next 为下一阶段"字母 中文名"或 undefined(k 阶段无下一阶段,仍写 handover 供后续查阅)。
export function renderPhaseHandover(input: { phase: Phase; handover: string; next?: string; verify?: boolean }): string {
  return renderTemplate("phase-handover", {
    phase: input.phase,
    phaseName: phaseText(input.phase),
    handover: input.handover,
    next: input.next,
    verify: input.verify,
  })
}

// k(知识提炼)阶段的知识提取会话(phases-design.md P4,整体认领
// fixme-knowledge-design.md §D.3): 旁路一次性,通读阶段台账与各阶段交接文档
// (本轮轮次目录 docs/R-NN/ 内),蒸馏出最终验证过的迁移知识文档(永久路径:
// 新布局轮内 migration-kb.md,旧布局 docs/migration-kb/R<N>-…)。file 为输出路径
// (相对目标目录);mode.exec 作场景背景注入(复用 ModeSpec 现有字段,不新增注册表面)。
export function renderKnowledge(input: { file: string; mode?: ModeSpec }): string {
  return renderTemplate("knowledge", {
    file: input.file,
    ...modeCtx(input.mode),
  })
}

// 前置知识提取会话(外壳的二次迁移编排,src/knowledge.ts extractPriorKnowledge):
// 旁路一次性,通读已有迁移结果(不限于此前轮次——docs/ 全树、历轮轮次目录
// docs/R-NN/、旧布局阶段/轮次归档、产出代码与 git 历史),蒸馏出前置知识文档
// (新布局轮内 docs/R-NN/prior-kb.md,旧布局 docs/prior-kb/R<N>-…),作为二次迁移
// 与参数推断的输入。file 为输出路径(相对目标目录);brief 为项目意图原文(可空);
// distilled 为已有蒸馏产物路径清单(knowledge.ts existingDistilledDocs,非空时模板注入
// 引用化条件段: 已覆盖的知识点只引用不复述,蒸馏精力聚焦新对象的差分增量)。
export function renderPriorKnowledge(input: { file: string; brief?: string; mode?: ModeSpec; distilled?: string[] }): string {
  const distilled = input.distilled?.filter(Boolean) ?? []
  return renderTemplate("prior-knowledge", {
    file: input.file,
    brief: input.brief?.trim() || undefined,
    distilled: distilled.length ? distilled.map((path) => `- ${path}`).join("\n") : undefined,
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
// 构造经 docpaths(任务目录化布局),读点回落由 runner 经 resolveTaskDoc 处理。
export function handoffFile(task: Task): string {
  return taskDoc(task.id, "handoff")
}

// driver 在会话进行中(上下文达到交接阈值,2x contextLimit)插入的交接提示
// (ondemand 整任务会话与 auto 子任务会话)。
// v2 prompt 默认 steer,在下一个 provider turn 边界进入会话。
export function renderHandoffSteer(task: Task): string {
  return renderTemplate("handoff-steer", { handoffFile: handoffFile(task) })
}

// 死循环提示(driver 在会话进行中检测到重复动作后经 steer 注入,src/stuck.ts):
// level 决定提示的力度——1 换思路、2 先写诊断再动手、3 停止重试并收尾(会话内
// 最多三次)。与交接 steer 同为 steer 注入,二者互不影响。
export function renderStuckHint(hit: StuckHit): string {
  return renderTemplate("stuck-hint", {
    tool: hit.tool,
    count: String(hit.count),
    level: String(hit.level),
    input: hit.input || "(无参数)",
    detail: hit.detail || "(空)",
    repeatError: hit.kind === "error",
    level1: hit.level === 1,
    level2: hit.level === 2,
    level3: hit.level >= 3,
  })
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
// 共享片段与任务块所需的变量;phase/phaseName 缺省 m(单阶段流程,与
// renderDecompose 的模板选择一致),contextBudget/fine 供分解粒度准则段
// (decompose-rule)使用。
// 上下文预算基线缺省与 runner 的 DEFAULT_CONTEXT_LIMIT 一致(64k tokens);本地
// 声明避免 prompt 层反向依赖 runner。formatTokens 与 runner 日志同口径。
const DEFAULT_CONTEXT_LIMIT = 64_000

function formatTokens(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function baseCtx(plan: Plan, task: Task, opts: Opts & { index?: number } = {}): Ctx {
  const phase = opts.phase ?? "m"
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
    // 测试交接文档按执行范围命名: index(仅 renderSubtask 传入,子任务序号)存在
    // 时落子任务级目录(docs/<id>/S<kk>/testhandoff.md),整任务/修复轮为任务级命名。
    testHandoffFile: opts.testByDriver ? testHandoffFile(task, opts.index) : undefined,
    phase,
    phaseName: phaseText(phase),
    contextBudget: formatTokens((opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT) / 2),
    fine: Boolean(opts.fine),
  }
}

function modeText(text: string, opts: Opts): string {
  return renderText(text, { verify: Boolean(opts.verify) })
}

// verify 字段在提示词中的两种形态: `是"<原文字段>"` 或 `未声明`。
function verifyState(task: Task): string {
  return task.verify ? `是"${task.verify}"` : "未声明"
}
