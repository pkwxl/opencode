// Phase planning: the planning session (planPhase) and its step wrapper
// (planWithStep), plus the phase-state helpers the phase loop shares
// (phaseState, phaseTitle). Moved out of src/loop-phase.ts (plans/0053 A2) so
// the P3 planning additions, starting with the persisted planning input (A3,
// src/plan-input.ts), do not push that file past 600 lines. It is the one
// planner: m mode plans here too (A4, D12). Direction: loop-phase → loop-plan
// → loop-task; never imports loop-phase or loop.
import { join } from "node:path"
import { requireArtifact } from "./artifact"
import { projectBriefText } from "./brief"
import { maybeExit } from "./exit"
import { priorKnowledgeDigest } from "./knowledge"
import { log } from "./log"
import type { LoopCtx } from "./loop-task"
import { advanceNextTask, ensureNumbering, NEXT_TASK_FILE, taskNumber } from "./numbering"
import { phaseHandoverDoc, phaseKey, phaseLabel, phaseName, prevRoundDigest, readPhases, type PhaseState, type PhaseUnit } from "./phases"
import { plannedLines } from "./plan"
import { planInputPath, readPlanInput, savePlanInput } from "./plan-input"
import { renderImplementPlan, renderPhasePlan } from "./prompt-plan"
import { closeStep } from "./resume"
import { roundBriefText } from "./round-brief"
import { stepPause } from "./step"
import { plannedTaskProblems, qualifiedPhase, resetPlanning, takenTaskIds, taskIndexPath } from "./tasks"
import { templateRenders } from "./template"

// 阶段索引(路由已校验过;此处再读只为取完成集与前后序,缺失/非法按空处理)。
export async function phaseState(directory: string): Promise<PhaseState> {
  return (await readPhases(directory).catch(() => undefined)) ?? { round: 0, index: "", phases: [], done: new Set(), closed: new Map() }
}

// 阶段显示名(日志/提交标题): P02-design 设计
export const phaseTitle = (unit: PhaseUnit) => `${phaseLabel(unit)} ${phaseName(unit)}`

// 阶段规划会话(E 节): 旁路一次性,复用 requireArtifact 骨架,产物 = 本阶段任务索引
// <阶段目录>/tasks.md + 各任务的 docs/T-NNN/todo.md(M3.4,plans/0047 L3),collect 按
// mandatory 策略形检(plannedTaskProblems)。伪任务 PLAN 不进任务链、不写进度记录。
// m mode (ctx.manual) plans on the same step, commit stage and checks
// (plans/0053 D12), with three differences: the prompt is implement-plan over
// the persisted planning input, which m-mode planning requires (m mode has no
// round brief or handovers); the routing role is implement-scan, so existing
// routing configs stay valid; and without the numbering record the tasks are
// numbered after the highest taken id. 返回 0 = 规划完成,1 = m mode with no
// planning input.
export async function planPhase(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const { directory, opts, server: serverHandle, agentName, repl } = ctx
  // The phase loop routes m mode here only with an input, new or persisted;
  // checked first, so a missing one starts no numbering-restore session.
  if (ctx.manual && !ctx.input && !(await readPlanInput(directory, phase))?.trim()) {
    log(`⏸ nothing to plan ${phaseTitle(phase)} against: m-mode planning plans against a planning input, and ${planInputPath(phase)} is missing or empty`)
    return 1
  }
  // 自动编号(config.autoNumber): 规划会话的编号起点来自 .auto/next-task
  // 记录;记录缺失先恢复(无历史证据直接写 1,有证据开 AI 推导会话,见
  // src/numbering.ts),恢复受阻即退出 2。恢复会话本身会产生一次统一提交
  // (stage=numbering),先于规划会话。
  let numberStart: number | undefined
  if (opts.autoNumber) {
    const numbering = await ensureNumbering(serverHandle.client, directory, {
      agent: agentName,
      dir: directory,
      verbose: opts.verbose,
      waitAnswer: opts.waitAnswer,
      commit: opts.commit,
      contextLimit: opts.contextLimit,
      permission: opts.permission,
      interactive: repl,
      server: serverHandle,
      mode: opts.mode,
    })
    if (numbering.type === "dirty") {
      log(`⏸ worktree not clean before restoring the numbering record; handle it manually (commit/clean) and re-run:`)
      for (const file of numbering.files) log(`  ${file}`)
      return 2
    }
    if (numbering.type === "blocked") {
      log(`⏸ numbering-record restore session blocked (implicit block, investigate and re-run):\n${numbering.question}`)
      return 2
    }
    numberStart = numbering.next
  }
  // The planning input (plans/0053 D9): a new text is persisted to the phase's
  // plan-input.md and committed on its own before the planning unit starts;
  // without one the step plans against the persisted file, so an interrupted
  // or blocked step resumes with its input under plan and run alike. A
  // different text restarts an open step in a new session: the latest input
  // wins, and no reused session plans against a text it never saw.
  let restart: string | undefined
  if (ctx.input) {
    const saved = await savePlanInput(directory, phase, ctx.input, phaseTitle(phase))
    if (saved.type === "dirty") {
      log(`⏸ worktree not clean before saving the planning input; handle it manually (commit/clean) and re-run:`)
      for (const file of saved.files) log(`  ${file}`)
      return 2
    }
    if (saved.type === "failed") {
      log(`⏸ ${saved.question}`)
      return 2
    }
    ctx.input = undefined
    if (saved.type === "saved") {
      log(`✓ planning input saved to ${planInputPath(phase)}`)
      restart = "the planning input changed"
    }
  }
  const input = (await readPlanInput(directory, phase))?.trim() || undefined
  if (input && !restart) log(`ℹ planning against the persisted input ${planInputPath(phase)}`)
  // An optional slot, not a tier-1 marker (D11): an override that predates it
  // still loads, and would silently drop the input.
  if (!ctx.manual && input && !templateRenders("phase-plan", "input")) {
    log("⚠ the project's phase-plan template does not render {{input}}; the planning session will not see the input")
  }
  // The project brief (plans/0052 D9), comments stripped: an untouched stub injects nothing.
  const brief = await projectBriefText(directory)
  const taskIndex = taskIndexPath(phase)
  const phaseId = qualifiedPhase(phase)
  // 已占用的任务编号: 其他阶段任务索引列出的与已完成的任务(本阶段规划自身的遗留
  // 不算——中断续跑/反馈重试会再写同一批编号)。
  const taken = await takenTaskIds(directory, phase)
  const prompt = ctx.manual
    ? renderImplementPlan({
        file: planInputPath(phase),
        content: input!,
        brief,
        phaseId,
        taskIndex,
        // Without the numbering record: after the highest taken id (the former
        // init shortcut's rule, plans/0053 D12).
        numberStart: numberStart ?? Math.max(0, ...[...taken].map((id) => taskNumber(id) ?? 0)) + 1,
        parallel: opts.parallel,
      })
    : await phasePlanPrompt(ctx, phase, { brief, input, taskIndex, phaseId, numberStart })
  let problems: string[] = []
  log(`▶ starting the phase planning session to write ${taskIndex} and the task documents`)
  const planned = await requireArtifact(
    serverHandle.client,
    { id: "PLAN", title: `phase planning (${phaseTitle(phase)})`, status: "in_progress", attempts: 0, body: "" },
    prompt,
    {
      agent: agentName,
      dir: directory,
      verbose: opts.verbose,
      waitAnswer: opts.waitAnswer,
      commit: opts.commit,
      contextLimit: opts.contextLimit,
      permission: opts.permission,
      interactive: repl,
      server: serverHandle,
      mode: opts.mode,
    },
    {
      kind: "phase planning",
      step: { step: "phase-plan", unit: phaseKey(phase).id },
      restart,
      role: ctx.manual ? "implement-scan" : undefined,
      // Independent hidden task unit: entry clean gate + SHA baseline + close-out
      // check (plans/0021-commit-boundary-design.md).
      unitStart: true,
      artifact: `a valid task index ${taskIndex} with its task documents (at least one task)`,
      detail: "missing, no task, a non-compliant task document, or a task number reusing a taken number",
      get requirement() {
        return (
          `write the task index ${taskIndex} (one line per task, \`- [ ] T-NNN <task title>\`, at least one` +
          `${ctx.manual ? "" : "; even if you believe this phase has nothing to do, write one explanatory task"}) ` +
          `and each task's docs/T-NNN/todo.md (title line \`# T-NNN: <task title>\`, field line \`Phase: ${phaseId}\`, ` +
          `the three sections \`## Goal\` / \`## Scope\` / \`## Acceptance\`, last line \`<!-- auto: eof -->\`).` +
          (problems.length ? ` Problems last time: ${problems.join("; ")}.` : "")
        )
      },
      commit: { stage: "phase-plan", subject: `PLAN plan ${phaseTitle(phase)}` },
      reset: () => resetPlanning(directory, phase),
      collect: async () => {
        const checked = await plannedTaskProblems(directory, phase, { before: taken, numberStart })
        problems = checked.problems
        return problems.length ? undefined : checked.ids
      },
    },
  )
  if (!Array.isArray(planned)) {
    if (planned.type === "dirty") {
      log(`⏸ worktree not clean before starting the phase planning session; handle it manually (commit/clean) and re-run:`)
      for (const file of planned.files) log(`  ${file}`)
    } else {
      log(`⏸ phase planning session blocked (implicit block, investigate and re-run):\n${planned.question}`)
    }
    return 2
  }
  // 自动编号: 规划成功即把编号记录推进到本次最大编号 + 1(只增不减),
  // 后续阶段/轮次的规划会话自该记录续接,编号在目标目录永不重复。
  if (numberStart !== undefined) {
    const next = await advanceNextTask(directory, planned)
    log(`✓ numbering record advanced: next available task number T-${String(next).padStart(3, "0")}(${NEXT_TASK_FILE})`)
  }
  log(`✓ phase planning complete: ${taskIndex} lists ${planned.length} task(s)`)
  ctx.planned = planned
  // 收口: 删除本步骤的 driver 侧恢复点(产物已校验、提交与编号推进均完成)。
  // 在此之前被 kill → 记录仍 active,下次运行经 openStep 重入规划并复用会话。
  await closeStep(directory, "phase-plan", phaseKey(phase).id)
  return 0
}

// The phased planning prompt: phase-plan over the project brief, the planning
// input, the earlier phases' handovers, the previous round's conclusions (the
// round's first planning session only) and the round brief.
async function phasePlanPrompt(
  ctx: LoopCtx,
  phase: PhaseUnit,
  parts: { brief?: string; input?: string; taskIndex: string; phaseId: string; numberStart?: number },
): Promise<string> {
  const { directory, opts } = ctx
  // Earlier phases' handovers (injection discipline): only the distilled
  // handovers are injected, never the earlier phases' raw docs/. Each done phase
  // that precedes this one in the phase index is appended in order; the handover
  // is the permanent P<nn>-<type>/handover.md in the phase directory, and a phase
  // without one is listed as "(no handover document)".
  const state = await phaseState(directory)
  const earlier = state.phases.slice(0, state.phases.findIndex((unit) => unit.id === phase.id))
  const handovers = (
    await Promise.all(
      earlier
        .filter((unit) => state.done.has(unit.id))
        .map(async (unit) => {
          const doc = phaseHandoverDoc(unit)
          const text = await Bun.file(join(directory, doc)).text().catch(() => undefined)
          return [`### ${phaseTitle(unit)}(${doc})`, "", text?.trim() || "(no handover document)"].join("\n")
        }),
    )
  ).join("\n\n")
  // Extra injection for the round's first planning session: ① prior knowledge
  // (the shell's startup distillation of existing migration results,
  // docs/R-NN/prior-kb.md, see src/knowledge.ts); ② the previous round's
  // conclusions (when a previous round directory exists). Later phases follow the
  // handover chain and get neither again.
  // "First" = no completed phase of this round has tasks (plans/0049 G4): a
  // leading task-less knowledge phase has no planning session and must not
  // swallow the digest.
  let prevRound: string | undefined
  if (!state.phases.some((unit) => state.done.has(unit.id) && unit.entry.hasTasks)) {
    const digests = [await priorKnowledgeDigest(directory), await prevRoundDigest(directory)].filter((part): part is string => Boolean(part?.trim()))
    prevRound = digests.length ? digests.join("\n\n") : undefined
    if (prevRound) log("ℹ injecting prior migration conclusions (prior knowledge + previous round's archive excerpts)")
  }
  // The round brief docs/R-NN/round.md (plans/0049 G3): every planning session
  // plans against the round's goal and criteria; an untouched stub injects nothing.
  const round = await roundBriefText(directory, state.round)
  return renderPhasePlan({
    phase: phase.entry,
    phaseId: parts.phaseId,
    taskIndex: parts.taskIndex,
    brief: parts.brief,
    round,
    input: parts.input,
    inputPath: planInputPath(phase),
    handovers,
    prevRound,
    mode: opts.mode,
    // 本轮阶段索引无独立 analysis/design 阶段 → implement 阶段规划注入裁剪注记
    trimmedPhases: !state.phases.some((unit) => unit.type === "analysis" || unit.type === "design"),
    numberStart: parts.numberStart,
    parallel: opts.parallel,
  })
}

// Phase planning plus the plan-review pause (plans/0049 G5): at
// OPENCODE_AUTO_STEP ≥ phase the run holds after the planning commit, before
// the first task, so tasks.md and the task documents can be reviewed; /exit
// takes effect at the same point. Under plan's stop condition (plans/0053 D6)
// the run ends here instead, and that stop is the review point: the summary
// replaces the pause, and the caller returns.
export async function planWithStep(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const code = await planPhase(ctx, phase)
  if (code !== 0) return code
  if (ctx.opts.stopBefore === "execute") {
    for (const line of plannedLines(ctx.directory, phase, ctx.planned ?? [], ctx.manual)) log(line)
    return 0
  }
  await stepPause("phase", `phase ${phaseTitle(phase)} planning`, { interactive: ctx.repl, dir: ctx.directory })
  maybeExit("phase", `phase ${phaseTitle(phase)} planning`)
  return 0
}
