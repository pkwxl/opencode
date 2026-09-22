// 提示词上下文组装层: 文案全部在 templates/prompts/*.md(共享片段见 _partials.md,
// 经 src/template.ts 渲染;目标目录 .opencode/auto/prompts/ 可覆盖),这里只负责
// 把 plan/task/运行信息组装为模板变量。render* 签名保持稳定,runner/loop
// 的调用点不感知模板机制。
import { dirname, join } from "node:path"
import type { ModeSpec } from "./mode"
import { dutiesForPhase, loadIntents, packSubsection, resolveIntent } from "./intent/load"
import type { IntentPack, IntentSection } from "./intent/types"
import { subtaskDoc, taskDoc } from "./docpaths"
import type { Plan, Status, Task } from "./tasks"
import type { ResolveItem } from "./resolve"
import type { StuckHit } from "./stuck"
import { phaseType, planDutiesPartial, REQUIRED_TYPE, type PhaseKey, type PhaseTypeEntry } from "./phases/registry"
import { autoSwitches, type TaskContextMode } from "./switches"
import { promptTemplateNames, renderTemplate, renderText, type Ctx } from "./template"

// The active intent pack (M1.2/M1.3, plans/0032+0033): the (b)-class content
// of the decompose family (split granularity criteria + per-phase duties) and
// the subtask family's closing self-check sentences lives in the pack, not in
// the core templates; the assembly point injects it as pre-rendered data
// (decomposeRule/phaseDuties/selfCheck vars). Default state = the built-in
// preset; loop-preflight calls useIntentPacks(dir) next to usePromptLibrary so
// the project overlay (.opencode/auto/intents/) applies; invalid pack files
// throw there as usage errors. Degenerate composition only (F8): one active
// pack, a same-named project file overrides the built-in wholesale.
let activeIntentPack: IntentPack = resolveIntent(loadIntents())

export function useIntentPacks(dir: string | undefined): void {
  activeIntentPack = resolveIntent(loadIntents(dir))
}

// Pack-section injection helper: address a `### <key>` subsection of the
// active pack and pre-render it with the session context (pack text may use
// the template syntax, same license as mode files); absent section/key
// yields undefined and the template guard drops the block cleanly.
function intentText(section: IntentSection, key: string, ctx: Ctx): string | undefined {
  const text = packSubsection(activeIntentPack, section, key)
  return text && renderText(text, ctx)
}

// testByDriver/handoverTest: the --test-by-driver test execution protocol (a
// run-level switch); when true the execution templates (subtask/whole) inject
// the protocol section.
// phase/contextLimit/fine: the phased flow's current phase (PhaseKey: the
// qualified id plus the type entry), the context budget baseline (tokens) and
// the fine-grained decompose switch (OPENCODE_AUTO_DECOMPOSE_FINE, wiring in
// plans/0003-fork-decompose-design.md §4.6) — the entry's decompose template is
// chosen and rendered from these (phaseName = the display name; contextBudget =
// the half-budget granularity ceiling; fine injects the fine-grained criteria).
// taskContext: the understanding digest's line-count tier
// (OPENCODE_AUTO_TASK_CONTEXT, see src/switches.ts); the understand template
// renders contextLines from it (suggested wording, not a hard cut).
type Opts = {
  mode?: ModeSpec
  testByDriver?: boolean
  handoverTest?: boolean
  phase?: PhaseKey
  contextLimit?: number
  fine?: boolean
  taskContext?: TaskContextMode
}

// 本层唯一渲染出口(所有 render* 经此调用 renderTemplate): 统一注入提问策略变量
// ask(OPENCODE_AUTO_ASK,设计文档 plans/0020-auto-resolve-design.md §E)。该变量服务
// _partials.md 的 question-rule 片段,而该片段被 23 份模板引用——逐 render 函数
// 透传 opts 会在新增模板时静默漏档,故在出口统一注入而非照搬 fine 的逐函数透传
// (fine 只服务 decompose-<phase> 一族,透传面可控)。ctx 显式给出的 ask 优先,
// 供单测直驱两档(镜像 src/step.ts:41 的 `opts.x ?? autoSwitches().x` 口径)。
//
// The same exit feeds question-rule's governance hooks (M2.1, plans/0043): the
// "who should have owned this call" catalog and the recording discipline live
// in the active pack (`## governance` / `### decisions-unattended` and
// `### decisions-ask`), pre-rendered here for the branch ask selects. The
// marker line formats stay core-owned (the driver scans for them, src/resolve.ts)
// and reach the pack text as the resolveFormat/decisionFormat variables; the
// partial keeps a literal zero-intent fallback so its tier-1 anchors hold.
export const RESOLVE_FORMAT = "`AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)`"
export const DECISION_FORMAT = "`AUTO-DECISION: <decision> (<reason>)`"

// The exit's context completion, exported so tests that render the shared
// partials directly (renderText/renderTemplate) see what every session sees.
export function promptCtx(ctx: Ctx): Ctx {
  const full: Ctx = { ask: autoSwitches().ask, resolveFormat: RESOLVE_FORMAT, decisionFormat: DECISION_FORMAT, ...ctx }
  const key = full.ask ? "decisionsAsk" : "decisionsUnattended"
  return { ...full, [key]: intentText("governance", full.ask ? "decisions-ask" : "decisions-unattended", full) }
}

function renderPrompt(name: string, ctx: Ctx): string {
  return renderTemplate(name, promptCtx(ctx))
}

// Run info of a driver-executed script, relayed to the session: out is the
// absolute path of the merged stdout+stderr file, read by the session directly
// (never truncated by tool output). timeoutReason: idle = killed by the
// no-output watchdog; max = killed after the absolute run-time cap.
export type ScriptRun = {
  script: string
  code: number
  ms: number
  timedOut: boolean
  timeoutReason?: "idle" | "max"
  out: string
}

// --test-by-driver 的单次测试执行信息(ScriptRun + 按序归档编号): driver 执行
// AI 指定的 test/ 脚本后经 steer 注入执行会话,AI 直读合并输出文件判断。
export type TestRunInfo = ScriptRun & { seq: number }

// --handover-test 的测试交接文档(相对目标目录): 上下文达到上限时(判定时点固定
// 为"AI 发起测试的那一刻",不再叠加测试失败),会话把进度与后续步骤写入该文件后
// 结束,driver 归档为 testhandoff-<n>.md 并开新会话以 continuation 提示续跑。
// 文件按执行范围命名: 子任务会话写 docs/<id>/S<两位序号>/testhandoff.md,整任务
// 会话为任务级(docs/<id>/testhandoff.md)——交接文档只对本执行范围
// 生效,防止下一子任务误读上一子任务的遗留交接。路径构造经 docpaths(目录化
// 布局的唯一构造点),导出名与签名保持稳定,runner 调用面零改动。
export function testHandoffFile(task: Task, subtask?: number): string {
  return subtask !== undefined ? subtaskDoc(task.id, subtask, "testhandoff") : taskDoc(task.id, "testhandoff")
}

// Test execution result feedback (steered into the executing session): exit code
// and output file path; the AI reads the file directly to judge.
export function renderTestResult(run: TestRunInfo): string {
  return renderPrompt("test-result", {
    seq: String(run.seq),
    script: run.script,
    code: String(run.code),
    ms: String(run.ms),
    runTimeout: run.timedOut
      ? `yes (terminated by the driver${run.timeoutReason === "max" ? ": absolute duration limit exceeded" : ": no output throughout, the watchdog judged no progress"})`
      : "no",
    out: run.out,
  })
}

// --handover-test 收尾+交接要求(steer 注入执行会话): AI 发起测试的那一刻,
// driver 已判定需要交接——提交定版、把脚本定下来,同时以本提示词要求会话把不依赖
// 测试结果的剩余工作做完落盘、写出交接文档后结束会话,测试结果交下一个会话判读。
// 措辞对测试时机保持中性("将由 driver 执行"): 顺序态在交接收口之后才跑,并发态
// (OPENCODE_AUTO_HANDOVER_CONCURRENT=on)此刻已在跑,一份文案两态都成立。
//
// 文案硬约束(测试交接前置化设计 D2): **不得出现"上下文/超限/上限/tokens"**——
// 会话一旦知道自己上下文吃紧,就会自行判定余量不足而省略本应完成的落盘工作
// (现场实证);只陈述"需要交接并切换新会话"这一事实。同样不写"不要改源码":
// 顺序态下会话收尾的改动本就会一并落进提交 #2 并被测试覆盖,说了反而提示它这是
// 个可以自由裁量的边界。
// 文档内容的清单里另有一条"本执行范围内还没做完的事": 第 1 步要求把不依赖测试
// 结果的剩余工作做完,但会话并不总能做完(它也不知道自己为什么要交接);没列出来
// 的剩余工作在交接处静默消失——新会话读不到、也不知道有,会当成已完成而永久遗漏。
// 入参只有交接文档路径——此刻测试尚未出结果,退出码/输出都还不存在。
//
// The completeness discipline is split out (M2.3, plans/0045 D9): the
// protocol — what to write, where, the status line — stays in the template;
// the two sentences that forbid leaving work undone come from the active
// pack's `## governance` / `### test-handover-finish` and
// `### test-handover-leftover`, and drop out cleanly when a pack omits them.
export function renderTestWrapup(info: { handoffFile: string }): string {
  const ctx: Ctx = { handoffFile: info.handoffFile }
  return renderPrompt("test-wrapup", {
    ...ctx,
    finishRule: intentText("governance", "test-handover-finish", ctx),
    leftoverRule: intentText("governance", "test-handover-leftover", ctx),
  })
}

// 测试交接后的新会话续跑说明(追加到执行提示词): 先读交接文档(归档份
// testhandoff-<n>.md)与本次测试输出再继续——判读测试结果正是本会话的首要工作。stuck 为连续交接次数超过阈值(10)时的提醒——评估是否陷入暂时
// 无法解决的问题,可经 AUTO-FIXME 标注遗留后继续。
export function renderTestContinue(input: { handoffFile: string; run?: TestRunInfo; stuck?: number }): string {
  return renderPrompt("test-continue", {
    handoffFile: input.handoffFile,
    runScript: input.run?.script,
    runCode: input.run ? String(input.run.code) : undefined,
    runOut: input.run?.out,
    stuck: input.stuck ? String(input.stuck) : undefined,
  })
}

// digest 基点会话(①′,driver 主导,fork-decompose 设计 §7): 摘要全文 + 一句
// 确认;会话结束即成为该任务全部分叉(子任务)的前缀基点。
export function renderContextBase(task: Task, digest: string): string {
  return renderPrompt("context-base", { taskId: task.id, digest })
}

// Merged understand+decomposition session (M1.0, plans/0030): read-only
// understanding (docs/<id>/context.md four sections) + shared-context
// reference index (docs/<id>/shared.md) + subtask split (docs/<id>/subtasks.md
// checklist) + one scope file per subtask (docs/<id>/S<nn>/todo.md). The
// driver reads the checklist from subtasks.md and ticks it itself.
// 模板按阶段选择: decompose-<phase>(缺省 m;粒度准则以任务描述为基准,fine
// 开启细粒度档),库中无此名回退通用 decompose。
// Intent injection (M1.2/M1.3): the granularity criteria and per-phase duties
// come from the active pack (`### decompose` under `## quality`, and the
// `### <letter>` subsection under `## phase duties`), pre-rendered with this
// ctx (fine/contextBudget/phaseName resolve inside the pack text, same
// license as mode sections) and injected as data; when the pack lacks the
// subsection the block disappears entirely (zero-intent baseline) and the
// core template keeps only role boundaries, format protocols, and eof.
export function renderDecompose(plan: Plan, task: Task, opts: Opts = {}): string {
  const ctx = baseCtx(plan, task, opts)
  const entry = phaseEntry(opts.phase)
  // A custom type's own `## decompose duties` wins; otherwise the active
  // pack's `### <dutiesRef>` subsection.
  const duties = entry.decomposeDuties ?? dutiesForPhase(activeIntentPack, entry.dutiesRef)
  return renderPrompt(decomposeTemplateName(entry, promptTemplateNames()), {
    ...ctx,
    decomposeRule: intentText("quality", "decompose", ctx),
    phaseDuties: duties && renderText(duties, ctx),
    // context.md section layout (M2.1): `## artifact spec` / `### context-digest`.
    contextDigest: intentText("artifactSpec", "context-digest", ctx),
  })
}

// decompose 模板名解析(纯函数,便于单测): 阶段类型条目 → decomposeTemplate(缺省
// implement);names 为当前生效模板名清单(promptTemplateNames()),无此名时回退通用
// decompose。
export function decomposeTemplateName(entry: PhaseTypeEntry | undefined, names: string[]): string {
  const candidate = (entry ?? phaseEntry(undefined)).decomposeTemplate
  return names.includes(candidate) ? candidate : "decompose"
}

// The current phase's type entry; outside the phase loop, implement.
function phaseEntry(phase: PhaseKey | undefined): PhaseTypeEntry {
  return phase?.entry ?? phaseType(REQUIRED_TYPE)!
}

// The `{{phase}}` prompt var: the preset letter of a builtin type, the type id
// of a custom one.
const phaseTag = (entry: PhaseTypeEntry): string => entry.letter ?? entry.type

// The L1 authoritative grounded-state block (session-boundary-hardening design
// §4.1): a subtask session is injected with the authoritative state the driver
// derives from the unit state (task status / fully qualified id / tick snapshot
// / declaration that prior tasks are independent), so a previous task's
// completion narrative cannot be read as this task's state — the data is
// assembled here, the wording lives in the ground-state partial of
// _partials.md. The display layer (subtasks.md) keeps the short S01 numbering;
// the fully qualified id only ever reaches the prompt (L3).
// Task status wording (while the driver runs a subtask session the task is always
// in progress; the other states are rendered faithfully for completeness).
const STATUS_TEXT: Record<Status, string> = { pending: "not started", in_progress: "in progress", blocked: "blocked", done: "done" }

// Tick snapshot: S01☑ S02☐ …, done k/n (effective done flags — the state files
// win — which is exactly the authoritative information the session cannot read).
function subtaskSnapshot(items: { done: boolean }[]): string | undefined {
  if (!items.length) return undefined
  const ticks = items.map((item, i) => `S${String(i + 1).padStart(2, "0")}${item.done ? "☑" : "☐"}`).join(" ")
  return `${ticks}, done ${items.filter((item) => item.done).length}/${items.length}`
}

// Inline list of previously completed task ids (same source as head's doneList;
// the grounded-state declaration line inlines ids only and does not restate the
// title list, avoiding duplication with head's completed list).
function doneIds(plan: Plan): string | undefined {
  const ids = plan.tasks.filter((item) => item.status === "done").map((item) => item.id)
  return ids.length ? ids.join(", ") : undefined
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
// 则提示先读 context.md 摘要)。缺省时由任务检查项(subtasks.md)推导 index/列表/产出文件
// (与 runner 子任务循环同口径),旧调用不传参仍渲染完整提示词。
export function renderSubtask(
  plan: Plan,
  task: Task,
  subtask: string,
  opts: Opts & { continuation?: boolean; index?: number; subtaskList?: string; outputFile?: string; warm?: boolean } = {},
): string {
  const items = task.checklist ?? []
  const at = opts.index !== undefined ? opts.index - 1 : items.findIndex((item) => !item.done && item.text === subtask)
  const index = at >= 0 ? String(at + 1) : undefined
  const ctx = baseCtx(plan, task, { ...opts, index: index !== undefined ? Number(index) : undefined })
  const outputFile = opts.outputFile ?? (index !== undefined ? subtaskOutputFile(task, at + 1) : undefined)
  return renderPrompt("subtask", {
    // index 的推导值回灌 baseCtx: 测试交接文档命名(测试协议段)与本处注入的
    // 「第 N 项」同源,缺省推导(旧调用不传 index)时同样落子任务级目录命名。
    ...ctx,
    subtask,
    continuation: Boolean(opts.continuation),
    handoffFile: handoffFile(task),
    // Closing self-check sentence (M1.3): (b)-class quality intent from the
    // active pack's `## quality` / `### self-check-subtask`; the guard drops
    // the wrap-up item cleanly when the pack omits it (zero-intent baseline).
    selfCheck: intentText("quality", "self-check-subtask", ctx),
    // Output-placement convention (M1.4, plans/0034 D7/D8): (b)-class artifact
    // convention from the active pack's `## artifact spec` / `### subtask-output`,
    // pre-rendered with the output-file slot (the convention text references
    // {{outputFile}}). Injected only when the slot exists (index given or
    // derived); a pack omitting the subsection drops the block cleanly.
    artifactConvention: outputFile ? intentText("artifactSpec", "subtask-output", { ...ctx, outputFile }) : undefined,
    // P1 discipline (M2.3, plans/0045): the deliverable must not reference
    // process documents — `## governance` / `### process-references`; the
    // DRIVER's prohibition scan at close-out is the mechanical side.
    processRefs: intentText("governance", "process-references", ctx),
    // L1 接地块变量(ground-state 片段): 台账权威状态随每个子任务会话注入;
    // qualifiedId 仅在编号可知时给出(无检查项的旧形态任务没有 S 编号)。
    taskTitle: task.title,
    taskStatusText: STATUS_TEXT[task.status],
    qualifiedId: index !== undefined ? `${task.id}.S${index.padStart(2, "0")}` : undefined,
    subtaskSnapshot: subtaskSnapshot(items),
    doneIds: doneIds(plan),
    index,
    subtaskList: opts.subtaskList ?? (items.length ? items.map((item, i) => `${i + 1}. ${item.text}`).join("\n") : undefined),
    outputFile,
    // 子任务目录状态协议(M1.0): 分解期写定的范围声明文件;旧形态任务无此文件,
    // 模板按「如存在」措辞条件化。
    todoFile: index !== undefined ? subtaskDoc(task.id, Number(index), "todo") : undefined,
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
// resolves(收尾闭环 H7,plans/0020-auto-resolve-design.md §I): driver 本任务观测到的代答
// 清单,注入后要求 report.md 单列「Proxy-answered questions」一节——持久审计轨迹由此不再依赖会话
// 自觉标注,driver 看见的那部分被强制写进 git。本层是同步纯函数(prompt.ts 只做数据
// 组装),清单由调用点(runner 的两处收尾)先 resolvesOf 读台账再传入。
// Intent injection (M2.1, plans/0043): the report's content form comes from
// `## artifact spec` (`### report-indexed` for the subtask form, `### report-solo`
// for the single-session form), and the audit's scope beyond the driver-listed
// items (which session-identified proxy calls also belong in the section) from
// `## governance` / `### wrapup-audit`. The driver-listed items and their
// "every one must appear" demand stay core: they are the persistent audit trail.
export function renderWrapup(plan: Plan, task: Task, opts: Opts & { solo?: boolean; resolves?: ResolveItem[] } = {}): string {
  const ctx = baseCtx(plan, task, opts)
  return renderPrompt("wrapup", {
    ...ctx,
    solo: Boolean(opts.solo),
    resolveList: resolveList(opts.resolves),
    reportForm: intentText("artifactSpec", opts.solo ? "report-solo" : "report-indexed", ctx),
    auditScope: intentText("governance", "wrapup-audit", ctx),
    // Result-line discipline (plans/0044 §3.1): when to write the line and what
    // counts as FAIL is intent (`## acceptance` / `### result-line`); the literal
    // and its placement stay core. A pack without the subsection drops the
    // whole instruction — no result line, the run never stops on a verdict.
    resultRule: intentText("acceptance", "result-line", ctx),
  })
}

// 代答清单的预拼接(模板语法刻意不做循环,清单类数据由调用方拼成字符串,见
// src/template.ts 头注释)。只列 driver 源: agent 源是会话自己已经标注过的,再报一遍
// 徒增噪声。未配对 agent 标记的排在前(§I 的"优先列未找到配对的"),它们正是最可能在
// 报告里缺席的那些。不截断条数、不截断正文——提示词要求"上面每一条都必须出现",丢条目
// 会与该要求自相矛盾;只把提问原文的换行压成单行,否则多行提问会把清单结构冲散。
function resolveList(items: ResolveItem[] | undefined): string | undefined {
  const driver = (items ?? []).filter((item) => item.source === "driver")
  const lines = [...driver.filter((item) => !item.matched), ...driver.filter((item) => item.matched)]
    .map((item) => item.question.replace(/\s+/g, " ").trim())
    .filter((question) => question.length > 0)
    .map((question) => `   - ${question}`)
  return lines.length ? lines.join("\n") : undefined
}

// 阶段规划会话(设计文档 plans/0006-phases-design.md E 节): 旁路一次性,产物 = 本阶段任务
// 索引 taskIndex(<阶段目录>/tasks.md)+ 各任务的 docs/T-NNN/todo.md(M3.4,plans/0047
// L3;phaseId 为阶段限定编号,写入任务文档的 `Phase:` 字段)。brief 为 .opencode/auto/brief.md 原文
// (可空,模板含未提供提示段);handovers 为各前序阶段 handover.md 的预拼接字符串
// (driver 侧组装,注入纪律: 只注入蒸馏产物、不注入前序原始 docs/)。
// prevRound 为上一轮迁移结论摘录(plans/0006-phases-design.md M 节,loop 侧组装: 归档索引/
// 最终交接/迁移知识),仅续轮(新一轮轮目录建立后)的新一轮首个规划会话注入。
// source/destDir 为迁移参数(相对工作目录,会话 cwd 即工作目录,相对路径直接可用)。
// trimmedPhases 仅 m 阶段生效(生效 phases 经 --phases 裁剪、不含独立 a/d 阶段时由
// loop 传入,模板注入「流程裁剪注记」——勘察设计并入首批任务,底线保障不省)。
// numberStart 为自动编号(config.autoNumber)下的编号起点(.auto/next-task 记录值,
// 由 loop 在规划会话前经 ensureNumbering 确保就位),未启用时缺省——编号自 T-001 起。
export function renderPhasePlan(input: {
  phase: PhaseTypeEntry
  phaseId: string
  taskIndex: string
  brief?: string
  handovers?: string
  prevRound?: string
  source?: { dir: string; path: string }
  destDir?: string
  mode?: ModeSpec
  trimmedPhases?: boolean
  numberStart?: number
}): string {
  const type = input.phase
  return renderPrompt("phase-plan", {
    phase: phaseTag(type),
    phaseName: type.name,
    phaseId: input.phaseId,
    taskIndex: input.taskIndex,
    brief: input.brief?.trim() || undefined,
    handovers: input.handovers?.trim() || undefined,
    prevRound: input.prevRound?.trim() || undefined,
    sourceDir: input.source?.dir,
    sourcePath: input.source?.path,
    destDir: input.destDir,
    modeName: input.mode?.name,
    modeInit: input.mode && modeText(input.mode.init),
    trimmedPhases: type.type === "implement" && input.trimmedPhases ? true : undefined,
    numberStart: input.numberStart === undefined ? undefined : String(input.numberStart).padStart(3, "0"),
    // The duty paragraph: a custom type's own `## plan duties` (M3.6), else the
    // type's shared partial (registry dutiesRef, M3.2), rendered through the
    // active library so overlays apply.
    planDuties: renderText(type.planDuties ?? `{{> ${planDutiesPartial(type)}}}`, {}).trimEnd(),
  })
}

// 计划生成会话(packages/auto 的 init 快捷模式 --implement-file/--implement-prompt):
// 旁路一次性,产物 = 单阶段 P01-implement 的任务索引 + 各任务文档,复用与
// renderPhasePlan 同款任务单元格式约定,但不含阶段/轮次/交接等阶段化流程概念——
// 该快捷模式仅用于 phases = "m" 项目(调用方校验)。numberStart 为编号起点(三位
// 零填充前的数值;缺省 1)。输入二选一: file 给出时按
// 「计划文件」呈现 content(源文件全文,path 供报文引用),否则按「实施提示词」
// 呈现(content = 提示词原文);brief 为 .opencode/auto/brief.md 原文(可空,与
// -p/--prompt 同给时一并注入,供规划会话感知项目意图)。
export function renderImplementPlan(input: { file?: string; content: string; brief?: string; phaseId: string; taskIndex: string; numberStart?: number }): string {
  return renderPrompt("implement-plan", {
    phaseId: input.phaseId,
    taskIndex: input.taskIndex,
    numberStart: String(input.numberStart ?? 1).padStart(3, "0"),
    fromFile: input.file !== undefined,
    filePath: input.file,
    content: input.content,
    brief: input.brief?.trim() || undefined,
  })
}

// 自动编号(config.autoNumber)的编号记录恢复会话(src/numbering.ts): 旁路一次性,
// 产物 = AI 写入的 .auto/next-task(单个正整数)。floor 为 driver 确定性扫描的
// 已用编号下限,作模板输入与 driver 侧 collect 校验共用同一数值。
export function renderNumberRecovery(input: { floor: number }): string {
  return renderPrompt("number-recovery", {
    floor: String(input.floor),
    floorPadded: String(input.floor).padStart(3, "0"),
  })
}

// 阶段交接蒸馏会话(设计文档 plans/0006-phases-design.md F.1 步骤 1): 旁路一次性,通读本阶段
// PLAN.md 与 docs/ 产物,蒸馏出永久路径交接文档(四个必备小节协议在模板内联)。
// handover = phaseHandoverDoc(unit)(src/phases.ts,阶段目录内
// docs/R-NN/P<nn>-<type>/handover.md);next 为下一阶段"P<nn>-<type> 中文名"或
// undefined(最后一个阶段无下一阶段,仍写 handover 供后续查阅)。
export function renderPhaseHandover(input: { phase: PhaseTypeEntry; handover: string; next?: string }): string {
  return renderPrompt("phase-handover", {
    phase: phaseTag(input.phase),
    phaseName: input.phase.name,
    handover: input.handover,
    next: input.next,
  })
}

// k(知识提炼)阶段的知识提取会话(plans/0006-phases-design.md P4,整体认领
// plans/0002-fixme-knowledge-design.md §D.3): 旁路一次性,通读阶段索引与各阶段交接文档
// (本轮轮次目录 docs/R-NN/ 内),蒸馏出最终验证过的迁移知识文档(永久路径:
// knowledge 阶段目录内 kb.md)。file 为输出路径
// (相对目标目录);mode.exec 作场景背景注入(复用 ModeSpec 现有字段,不新增注册表面)。
// The quality hard constraints (M2.1) come from `## quality` / `### knowledge`.
export function renderKnowledge(input: { file: string; mode?: ModeSpec }): string {
  const ctx = { file: input.file, ...modeCtx(input.mode) }
  return renderPrompt("knowledge", { ...ctx, qualityRules: intentText("quality", "knowledge", ctx) })
}

// 前置知识提取会话(外壳的二次迁移编排,src/knowledge.ts extractPriorKnowledge):
// 旁路一次性,通读已有迁移结果(不限于此前轮次——docs/ 全树、历轮轮次目录
// docs/R-NN/、旧布局阶段/轮次归档、产出代码与 git 历史),蒸馏出前置知识文档
// (新布局轮内 docs/R-NN/prior-kb.md,旧布局 docs/prior-kb/R<N>-…),作为二次迁移
// 与参数推断的输入。file 为中间产物 temp-kb.md 的输出路径(相对目标目录;收笔
// 标记经 driver 确认后才改名转正,完成判定协议见 knowledge.ts);brief 为项目意图
// 原文(可空);distilled 为已有蒸馏产物路径清单(knowledge.ts existingDistilledDocs,
// 非空时模板注入引用化条件段: 已覆盖的知识点只引用不复述,蒸馏精力聚焦新对象的
// 差分增量)。
// The quality hard constraints (M2.1) come from `## quality` / `### prior-knowledge`.
export function renderPriorKnowledge(input: { file: string; brief?: string; mode?: ModeSpec; distilled?: string[] }): string {
  const distilled = input.distilled?.filter(Boolean) ?? []
  const ctx = {
    file: input.file,
    brief: input.brief?.trim() || undefined,
    distilled: distilled.length ? distilled.map((path) => `- ${path}`).join("\n") : undefined,
    ...modeCtx(input.mode),
  }
  return renderPrompt("prior-knowledge", { ...ctx, qualityRules: intentText("quality", "prior-knowledge", ctx) })
}

// 参数推断会话(外壳的二次迁移编排): config.source/destDir 缺失时,依据前置知识
// 产物与目录勘察推断迁移源/目标,结论以 JSON 协议整写 file(.auto/infer.json;
// {"sourceDir","sourcePath","destDir"} 或 {"blocked": 原因}),driver 校验后仅采纳
// 缺失键。priorKb 为 prior-kb 文档路径清单(预拼接,会话直读);known 为已固化
// 参数的人类可读描述(预拼接,可空)。
export function renderInferSource(input: { file: string; brief?: string; priorKb?: string; known?: string }): string {
  return renderPrompt("infer-source", {
    file: input.file,
    brief: input.brief?.trim() || undefined,
    priorKb: input.priorKb?.trim() || undefined,
    known: input.known?.trim() || undefined,
  })
}

// 交接文档(相对目标目录): ondemand 整任务会话与 auto 子任务会话共用——driver 在
// 上下文达到 2x --context-limit 时插入交接提示,会话把进度写入该文件,末行
// `Status: continue|done` 由 driver 解析。子任务场景的状态以该子任务是否完成计。
// 构造经 docpaths(任务目录化布局),读点回落由 runner 经 resolveTaskDoc 处理。
export function handoffFile(task: Task): string {
  return taskDoc(task.id, "handoff")
}

// driver 在会话进行中(上下文达到交接阈值,2x contextLimit)插入的交接提示
// (ondemand 整任务会话与 auto 子任务会话)。
// v2 prompt 默认 steer,在下一个 provider turn 边界进入会话。
export function renderHandoffSteer(task: Task): string {
  return renderPrompt("handoff-steer", { handoffFile: handoffFile(task) })
}

// Stuck-loop hint (steered into a running session when the driver detects
// repeated actions, src/stuck.ts): level sets the force of the hint — 1 switch
// approach, 2 write the diagnosis before acting, 3 stop retrying and close out
// (at most three per session). Injected by steer like the handover steer; the
// two do not interfere.
// The level-2 reflection discipline (M2.1) comes from `## quality` /
// `### stuck-reflection`; the reminder framing stays core.
export function renderStuckHint(hit: StuckHit): string {
  const ctx: Ctx = {
    tool: hit.tool,
    count: String(hit.count),
    level: String(hit.level),
    input: hit.input || "(no arguments)",
    detail: hit.detail || "(empty)",
    repeatError: hit.kind === "error",
    level1: hit.level === 1,
    level2: hit.level === 2,
    level3: hit.level >= 3,
  }
  return renderPrompt("stuck-hint", { ...ctx, reflection: hit.level === 2 ? intentText("quality", "stuck-reflection", ctx) : undefined })
}

// Raw (unrendered) subsection of the active intent pack, for consumers outside
// the prompt templates — the AGENTS.md block's maintenance rules (M2.1,
// `## governance` / `### agents-maintenance`).
export function activeIntentText(section: IntentSection, key: string): string | undefined {
  return packSubsection(activeIntentPack, section, key)
}

// --subtask off/ondemand: 单会话完成整个任务(不做子任务分解)。ondemand 额外附带
// 交接条款;continuation 表示此前会话因上下文限制中断,需先读交接文档继续。
export function renderWhole(
  plan: Plan,
  task: Task,
  opts: Opts & { ondemand?: boolean; continuation?: boolean } = {},
): string {
  const ctx = baseCtx(plan, task, opts)
  return renderPrompt("whole", {
    ...ctx,
    ondemand: Boolean(opts.ondemand),
    continuation: Boolean(opts.continuation),
    handoffFile: handoffFile(task),
    // Closing self-check sentence (M1.3, same as renderSubtask but keyed to
    // the whole-task scope): `## quality` / `### self-check-whole`.
    selfCheck: intentText("quality", "self-check-whole", ctx),
    // P1 discipline (M2.3), same subsection as renderSubtask.
    processRefs: intentText("governance", "process-references", ctx),
  })
}

// --dryrun: 权限预检会话,报告写入 .auto/dryrun.md。
export function renderDryrun(): string {
  return renderPrompt("dryrun", {})
}

// 模式注记上下文(baseCtx 的模式部分,独立导出): 旁路一次性会话(knowledge 等)
// 与外壳自写的 render* 函数共用同口径的模式变量组装,壳层不必改 prompt.ts。
// 模式文本先经模板引擎渲染再作为变量注入;不传模式时三个变量均为 undefined
// (模板条件段整体消失)。
export function modeCtx(mode?: ModeSpec): Ctx {
  return {
    modeName: mode?.name,
    modeInit: mode && modeText(mode.init),
    modeExec: mode && modeText(mode.exec),
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

// 理解摘要建议行数档位(OPENCODE_AUTO_TASK_CONTEXT,开关层见 src/switches.ts):
// off 为现状(200,与改动前的硬编码措辞一致);small/medium/large 逐档放宽。
// 仅改变提示词里的"建议行数"措辞——ensureDecomposed 只校验 context.md 非空,
// 不按行数截断或拒收,调大档位不改变任何校验行为。
const TASK_CONTEXT_LINES: Record<TaskContextMode, number> = { off: 200, small: 300, medium: 400, large: 500 }

function baseCtx(plan: Plan, task: Task, opts: Opts & { index?: number } = {}): Ctx {
  const entry = phaseEntry(opts.phase)
  return {
    ...modeCtx(opts.mode),
    taskId: task.id,
    taskBlock: `# ${task.id}: ${task.title}\n\n${task.body}`,
    doneList: doneList(plan),
    testByDriver: Boolean(opts.testByDriver),
    handoverTest: Boolean(opts.handoverTest),
    // 测试交接文档按执行范围命名: index(仅 renderSubtask 传入,子任务序号)存在
    // 时落子任务级目录(docs/<id>/S<kk>/testhandoff.md),整任务为任务级命名。
    testHandoffFile: opts.testByDriver ? testHandoffFile(task, opts.index) : undefined,
    phase: phaseTag(entry),
    phaseName: entry.name,
    contextBudget: formatTokens((opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT) / 2),
    fine: Boolean(opts.fine),
    contextLines: String(TASK_CONTEXT_LINES[opts.taskContext ?? "off"]),
  }
}

function modeText(text: string): string {
  return renderText(text, {})
}
