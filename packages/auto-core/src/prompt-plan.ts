// Planning-session prompts: the phase planning session (renderPhasePlan) and
// the m-mode plan generation session (renderImplementPlan). Moved out of
// src/prompt.ts (plans/0053 A2) so the P3 planning additions do not grow that
// file; the copy stays in templates/prompts/phase-plan.md and
// implement-plan.md, and rendering goes through prompt.ts's single exit
// (renderPrompt) and its intent-pack helpers.
import type { ModeSpec } from "./mode"
import type { ParallelLevel } from "./intent/types"
import { planDutiesPartial, type PhaseTypeEntry } from "./phases/registry"
import { intentText, modeText, phaseTag, renderPrompt } from "./prompt"
import { renderText } from "./template"

// 阶段规划会话(设计文档 plans/0006-phases-design.md E 节): 旁路一次性,产物 = 本阶段任务
// 索引 taskIndex(<阶段目录>/tasks.md)+ 各任务的 docs/T-NNN/todo.md(M3.4,plans/0047
// L3;phaseId 为阶段限定编号,写入任务文档的 `Phase:` 字段)。brief 为 .opencode/auto/brief.md 原文
// (可空,模板含未提供提示段);handovers 为各前序阶段 handover.md 的预拼接字符串
// (driver 侧组装,注入纪律: 只注入蒸馏产物、不注入前序原始 docs/)。
// prevRound 为上一轮迁移结论摘录(plans/0006-phases-design.md M 节,loop 侧组装: 归档索引/
// 最终交接/迁移知识),仅续轮(新一轮轮目录建立后)的新一轮首个规划会话注入。
// The migration source and target are intent and reach planning through the
// brief (plans/0052 D2); there are no separate parameters.
// trimmedPhases 仅 m 阶段生效(生效 phases 经 --phases 裁剪、不含独立 a/d 阶段时由
// loop 传入,模板注入「流程裁剪注记」——勘察设计并入首批任务,底线保障不省)。
// numberStart 为自动编号(config.autoNumber)下的编号起点(.auto/next-task 记录值,
// 由 loop 在规划会话前经 ensureNumbering 确保就位),未启用时缺省——编号自 T-001 起。
export function renderPhasePlan(input: {
  phase: PhaseTypeEntry
  phaseId: string
  taskIndex: string
  brief?: string
  // The round brief docs/R-NN/round.md, comments stripped (plans/0049 G3).
  round?: string
  // The phase's planning input (plans/0053 D11): the text of its plan-input.md
  // and that file's path; absent = no input block.
  input?: string
  inputPath?: string
  handovers?: string
  prevRound?: string
  mode?: ModeSpec
  trimmedPhases?: boolean
  numberStart?: number
  // config.parallel (MP.1): absent = none, nothing injected.
  parallel?: ParallelLevel
}): string {
  const type = input.phase
  return renderPrompt("phase-plan", {
    phase: phaseTag(type),
    phaseName: type.name,
    phaseId: input.phaseId,
    taskIndex: input.taskIndex,
    brief: input.brief?.trim() || undefined,
    round: input.round?.trim() || undefined,
    // How to plan against the brief is intent (M4.2, `## acceptance` / `### round-brief`).
    roundRules: input.round?.trim() ? intentText("acceptance", "round-brief", {}) : undefined,
    input: input.input?.trim() || undefined,
    inputPath: input.inputPath,
    handovers: input.handovers?.trim() || undefined,
    prevRound: input.prevRound?.trim() || undefined,
    modeName: input.mode?.name,
    modeInit: input.mode && modeText(input.mode.init),
    trimmedPhases: type.type === "implement" && input.trimmedPhases ? true : undefined,
    numberStart: input.numberStart === undefined ? undefined : String(input.numberStart).padStart(3, "0"),
    // The duty paragraph: a custom type's own `## plan duties` (M3.6), else the
    // type's shared partial (registry dutiesRef, M3.2), rendered through the
    // active library so overlays apply.
    planDuties: renderText(type.planDuties ?? `{{> ${planDutiesPartial(type)}}}`, {}).trimEnd(),
    ...parallelism(input.parallel),
  })
}

// Planning parallelism guidance (MP.1, plans/0046 D10/D11): the level's
// `## parallelism` intent subsection. At none, or when the pack lacks the
// subsection, both keys are undefined and the template's block renders nothing.
function parallelism(level: ParallelLevel | undefined): { parallel?: string; parallelRules?: string } {
  const rules = level ? intentText("parallelism", level, {}) : undefined
  return rules ? { parallel: level, parallelRules: rules } : {}
}

// 计划生成会话(packages/auto 的 init 快捷模式 --implement-file/--implement-prompt):
// 旁路一次性,产物 = 单阶段 P01-implement 的任务索引 + 各任务文档,复用与
// renderPhasePlan 同款任务单元格式约定,但不含阶段/轮次/交接等阶段化流程概念——
// 该快捷模式仅用于 phases = "m" 项目(调用方校验)。numberStart 为编号起点(三位
// 零填充前的数值;缺省 1)。输入二选一: file 给出时按
// 「计划文件」呈现 content(源文件全文,path 供报文引用),否则按「实施提示词」
// 呈现(content = 提示词原文);brief 为 .opencode/auto/brief.md 原文(可空,与
// -p/--prompt 同给时一并注入,供规划会话感知项目意图)。
export function renderImplementPlan(input: {
  file?: string
  content: string
  brief?: string
  phaseId: string
  taskIndex: string
  numberStart?: number
  parallel?: ParallelLevel
}): string {
  return renderPrompt("implement-plan", {
    phaseId: input.phaseId,
    taskIndex: input.taskIndex,
    numberStart: String(input.numberStart ?? 1).padStart(3, "0"),
    fromFile: input.file !== undefined,
    filePath: input.file,
    content: input.content,
    brief: input.brief?.trim() || undefined,
    ...parallelism(input.parallel),
  })
}
