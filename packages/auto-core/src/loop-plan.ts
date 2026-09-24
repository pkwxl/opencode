// Phase planning: the planning session (planPhase) and its step wrapper
// (planWithStep), the appending session (appendPlan, appendWithStep) with its
// snapshot → reset → collect cycle, plus the phase-state helpers the phase
// loop shares (phaseState, phaseTitle). Moved out of src/loop-phase.ts
// (plans/0053 A2) so the P3 planning additions, starting with the persisted
// planning input (A3, src/plan-input.ts), do not push that file past 600
// lines. It is the one planner: m mode plans here too (A4, D12), and m mode
// appends on the same append step (D23). Direction: loop-phase → loop-plan
// → loop-task; never imports loop-phase or loop.
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { requireArtifact } from "./artifact"
import { projectBriefText } from "./brief"
import { maybeExit } from "./exit"
import { commitTree } from "./git"
import { priorKnowledgeDigest } from "./knowledge"
import { log } from "./log"
import type { LoopCtx } from "./loop-task"
import { advanceNextTask, ensureNumbering, NEXT_TASK_FILE, taskNumber } from "./numbering"
import { phaseHandoverDoc, phaseKey, phaseLabel, phaseName, prevRoundDigest, readPhases, type PhaseState, type PhaseUnit } from "./phases"
import { plannedLines } from "./plan"
import { planInputPath, readPlanInput, savePlanInput } from "./plan-input"
import { existingTaskList, renderImplementPlan, renderPhaseAppend, renderPhasePlan } from "./prompt-plan"
import { closeStep } from "./resume"
import { roundBriefText } from "./round-brief"
import { stepPause } from "./step"
import {
  doneTaskIds,
  loadPlan,
  newTaskProblems,
  plannedTaskProblems,
  qualifiedPhase,
  resetPlanning,
  takenTaskIds,
  taskDecl,
  taskIndexPath,
  taskStatePaths,
  type PlanPhase,
} from "./tasks"
import { templateRenders } from "./template"
import { isUnitId, parseIndex, unitProblems, type IndexEntry, type UnitDecl } from "./document/unit"

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
  const state = await phaseState(directory)
  // Earlier phases' handovers (injection discipline): only the distilled
  // handovers are injected, never the earlier phases' raw docs/. Each done phase
  // that precedes this one in the phase index is appended in order; the handover
  // is the permanent P<nn>-<type>/handover.md in the phase directory, and a phase
  // without one is listed as "(no handover document)".
  const handovers = await earlierHandovers(directory, phase, state)
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
    // No analysis/design phase delivered in this round's index → the implement
    // phase's planning gets the pipeline-trimming note. A closed analysis/design
    // phase (plans/0053 D16: done for scheduling, not delivered) counts as absent.
    trimmedPhases: !state.phases.some((unit) => (unit.type === "analysis" || unit.type === "design") && !state.closed.has(unit.id)),
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

// —— Append planning (plans/0053 D23–D25) ——

// The earlier phases' distilled handovers in index order, one block per done
// phase that precedes `phase` (the injection discipline: only distilled
// handovers, never the earlier phases' raw docs/). Shared by the planning and
// appending prompts, so both sessions see the same chain.
async function earlierHandovers(directory: string, phase: PhaseUnit, state: PhaseState): Promise<string> {
  const earlier = state.phases.slice(0, state.phases.findIndex((unit) => unit.id === phase.id))
  return (
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
}

// What an appending session builds on, read from disk at step entry (plans/0053
// F1: the tree is clean at HEAD there — preflight guaranteed it — so disk is
// the committed state). Tasks a person committed mid-append count as existing
// on re-entry: the re-entry snapshot includes them, and only the entries after
// them are checked (D24's residual).
export type AppendSnapshot = {
  // Repository-relative path of the phase's task index.
  index: string
  // The index text as it stands at step entry.
  text: string
  entries: IndexEntry[]
  // Per existing task id: the text of the state file(s) that exist (exactly
  // one per task in a valid index); a missing key = the file was absent.
  files: Map<string, { pending?: string; complete?: string }>
}

// Read the append snapshot of a phase whose index already lists tasks.
export async function snapshotAppend(dir: string, phase: PlanPhase): Promise<AppendSnapshot> {
  const index = taskIndexPath(phase)
  const text = await Bun.file(join(dir, index)).text()
  const entries = parseIndex(text, "task").entries
  const files = new Map<string, { pending?: string; complete?: string }>()
  for (const entry of entries) {
    const paths = taskStatePaths(entry.id)
    const pending = await Bun.file(join(dir, paths.pending)).text().catch(() => undefined)
    const complete = await Bun.file(join(dir, paths.complete)).text().catch(() => undefined)
    files.set(entry.id, { ...(pending !== undefined ? { pending } : {}), ...(complete !== undefined ? { complete } : {}) })
  }
  return { index, text, entries, files }
}

// The append collect (plans/0053 D24): problems of what an appending session
// wrote onto a phase whose index already listed tasks (empty problems and the
// appended ids = accepted). The existing prefix is fixed — index lines and
// task documents alike — and only the entries after it are the session's
// output, each checked by the per-task rules (newTaskProblems, `before` =
// taken ∪ snapshot ids), with the whole index's dependency graph re-checked
// (the existing decls come from the snapshot texts, so an edited document is
// caught by the file-identity check, not silently re-validated).
export async function appendProblems(
  dir: string,
  phase: PlanPhase,
  snap: AppendSnapshot,
  opts: { before: ReadonlySet<string>; numberStart?: number },
): Promise<{ problems: string[]; ids: string[] }> {
  const index = taskIndexPath(phase)
  const text = await Bun.file(join(dir, index)).text().catch(() => undefined)
  if (text === undefined) return { problems: [`${index} is missing`], ids: [] }
  const parsed = parseIndex(text, "task")
  const problems = parsed.problems.map((problem) => `${index} ${problem}`)
  const entries = parsed.entries
  const prefix = snap.entries
  // The first *n* entries equal the snapshot's, in order, with their lines
  // unchanged (compared through the parser's view — id, title, tick — which is
  // the shape the driver guarantees; anything a session may do to an existing
  // line shows up in one of the three).
  let prefixHolds = true
  if (entries.length < prefix.length) {
    problems.push(`${index} lists ${entries.length} task(s) but held ${prefix.length} before the append; existing lines are fixed — append after them, never remove one`)
    prefixHolds = false
  } else {
    for (let i = 0; i < prefix.length; i++) {
      const was = prefix[i]!
      const now = entries[i]!
      if (now.id !== was.id) {
        problems.push(`${index} line ${now.line}: ${now.id} sits where ${was.id} sat; existing lines are fixed — append after the last existing line, never reorder or replace`)
        prefixHolds = false
        break
      }
      if (now.title !== was.title || now.ticked !== was.ticked) {
        problems.push(`${index} line ${now.line}: the existing line of ${was.id} was edited; existing lines are fixed — append only`)
        prefixHolds = false
        break
      }
    }
  }
  // At least one new entry follows the snapshot prefix.
  const fresh = prefixHolds ? entries.slice(prefix.length) : []
  if (prefixHolds && !fresh.length) {
    problems.push(`${index} gained no new task; the append must add at least one (a line \`- [ ] T-NNN <task title>\` after the existing ones)`)
  }
  // No existing task's state file changed: per snapshot id, the file that
  // existed holds exactly the snapshotted text and the other one is still
  // absent (a created done.md would both edit the set and break the index).
  for (const [id, files] of snap.files) {
    const paths = taskStatePaths(id)
    for (const key of ["pending", "complete"] as const) {
      const was = files[key]
      const now = await Bun.file(join(dir, paths[key])).text().catch(() => undefined)
      if (was === undefined && now !== undefined) {
        problems.push(`${paths[key]} of the existing task ${id} is new; an append never touches an existing task's state files`)
      } else if (was !== undefined && now !== was) {
        problems.push(`${paths[key]} of the existing task ${id} was changed or removed; an append never edits an existing task's document`)
      }
    }
  }
  // The per-task checks over the appended entries; the dependency graph of the
  // whole index runs once every entry has a decl (the prefix decls from the
  // snapshot texts, the fresh ones from the per-task read).
  const decls: UnitDecl[] = []
  let complete = prefixHolds
  for (let i = 0; i < prefix.length && complete; i++) {
    const entry = entries[i]!
    const files = snap.files.get(entry.id)
    const doc = files ? (files.pending ?? files.complete) : undefined
    if (doc === undefined) complete = false
    else decls.push(taskDecl(entry.id, doc))
  }
  for (const entry of fresh) {
    const checked = await newTaskProblems(dir, phase, entry.id, opts)
    problems.push(...checked.problems)
    if (checked.decl) decls.push(checked.decl)
    else complete = false
  }
  if (complete && decls.length === entries.length) {
    problems.push(...unitProblems("task", decls, { external: await doneTaskIds(dir) }).map((problem) => `${index}: ${problem}`))
  }
  return { problems, ids: fresh.map((entry) => entry.id).filter((id) => isUnitId("task", id)) }
}

// Restore the snapshot before each fresh attempt (plans/0053 D24): write the
// snapshot index text back, restore any changed existing task file (and remove
// a state file the snapshot does not have), and remove the task directories of
// index ids that are neither in the snapshot nor taken elsewhere — an id
// listed by another phase's index, or already done, belongs to that other
// unit, so its directory is never removed however it got listed here.
// requireArtifact skips this when a reused session resumes: the worktree is
// then the session's own progress, not stale output.
export async function resetAppend(dir: string, phase: PlanPhase, snap: AppendSnapshot): Promise<void> {
  const file = join(dir, snap.index)
  const current = await Bun.file(file).text().catch(() => undefined)
  const snapIds = new Set(snap.entries.map((entry) => entry.id))
  if (current !== undefined) {
    const taken = await takenTaskIds(dir, phase)
    for (const entry of parseIndex(current, "task").entries) {
      if (snapIds.has(entry.id) || taken.has(entry.id)) continue
      await rm(join(dir, "docs", entry.id), { recursive: true, force: true })
    }
  }
  if (current !== snap.text) await Bun.write(file, snap.text)
  for (const [id, files] of snap.files) {
    const paths = taskStatePaths(id)
    for (const key of ["pending", "complete"] as const) {
      const was = files[key]
      if (was === undefined) {
        await rm(join(dir, paths[key]), { force: true })
      } else {
        const now = await Bun.file(join(dir, paths[key])).text().catch(() => undefined)
        if (now !== was) await Bun.write(join(dir, paths[key]), was)
      }
    }
  }
}

// The appending session (plans/0053 D23–D25): the planner that adds tasks to
// a phase whose index already lists some, over the persisted planning input
// (an append always has one: --append without input is refused up front, and
// this backstop catches a deleted plan-input.md). Modeled on planPhase and
// sharing its machinery — the numbering record, the input commit, the step
// resume point — with the snapshot → reset → collect cycle in place of the
// fresh planning output check. 返回 0 = 追加完成,1 = 无规划输入,2 = 阻塞。
// AUTO-DECISION: no spec.role is declared (either mode) — phaseToRole already
// maps the phase-append step to the phase-plan model role (D23/F6), and the
// append template is new surface, so no legacy implement-scan routing applies
// to it; declaring one would only fork the mapping.
export async function appendPlan(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const { directory, opts, server: serverHandle, agentName, repl } = ctx
  // Appending plans against a planning input, checked first so a missing one
  // starts no numbering-restore session (the prelude and the shell check this
  // first; this backstops other shells and a deleted input file).
  if (!ctx.input && !(await readPlanInput(directory, phase))?.trim()) {
    log(`⏸ nothing to append ${phaseTitle(phase)} against: appending plans against a planning input, and ${planInputPath(phase)} is missing or empty`)
    return 1
  }
  // 自动编号: 与 planPhase 相同(记录缺失先恢复,恢复受阻即退出 2)。
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
  // The planning input (D9), exactly as in planPhase: a new text is persisted
  // and committed before the unit starts; a different text restarts an open
  // step in a new session, so no reused session plans against a text it never
  // saw. An append overwrites the phase's file — the latest input wins.
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
  if (input && !restart) log(`ℹ appending against the persisted input ${planInputPath(phase)}`)
  // The append builds on an index that lists tasks; a re-entered step whose
  // index has gone missing (deleted by hand between runs) is an anomaly to
  // surface, not an empty snapshot to append onto.
  const taskIndex = taskIndexPath(phase)
  if (!(await Bun.file(join(directory, taskIndex)).exists())) {
    log(`⏸ ${taskIndex} is missing: the task-append step of ${phaseTitle(phase)} has no task index to append to (deleted by hand?); restore it or list tasks there, then re-run`)
    return 1
  }
  // The snapshot (D24): taken at step entry from disk, which preflight's clean
  // gate left at HEAD. On re-entry it includes whatever was committed meanwhile
  // (D24's residual), so a person's mid-append commit counts as existing work.
  const snap = await snapshotAppend(directory, phase)
  const plan = await loadPlan(directory, phase)
  // 已占用编号 = 其他阶段索引与已完成任务 ∪ 本阶段既有条目(D24);无自动编号时,
  // 提示词编号起点取其中最大编号 + 1(D25: the highest taken or listed id + 1)。
  // AUTO-DECISION: the collect enforces the numbering start only under
  // autoNumber (the record's value), exactly as planPhase does — without the
  // record only collisions with taken or listed ids are refused, so a gap id
  // the session picks below the prompt's start stays acceptable, as in planning.
  const taken = await takenTaskIds(directory, phase)
  const before = new Set([...taken, ...snap.entries.map((entry) => entry.id)])
  const listed = Math.max(0, ...[...before].map((id) => taskNumber(id) ?? 0)) + 1
  const promptStart = numberStart ?? listed
  // The project brief, comments stripped: an untouched stub injects nothing.
  const brief = await projectBriefText(directory)
  const phaseId = qualifiedPhase(phase)
  const prompt = ctx.manual
    ? renderPhaseAppend({
        phaseId,
        taskIndex,
        numberStart: promptStart,
        input: input!,
        inputPath: planInputPath(phase),
        existingTasks: existingTaskList(plan.tasks),
        brief,
        parallel: opts.parallel,
      })
    : await phaseAppendPrompt(ctx, phase, { brief, input: input!, taskIndex, phaseId, numberStart: promptStart, existingTasks: existingTaskList(plan.tasks) })
  let problems: string[] = []
  log(`▶ starting the task-append session to append to ${taskIndex}`)
  const appended = await requireArtifact(
    serverHandle.client,
    { id: "PLAN", title: `phase append (${phaseTitle(phase)})`, status: "in_progress", attempts: 0, body: "" },
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
      kind: "task appending",
      step: { step: "phase-append", unit: phaseKey(phase).id },
      restart,
      // Independent hidden task unit: entry clean gate + SHA baseline + close-out
      // check (plans/0021-commit-boundary-design.md).
      unitStart: true,
      artifact: `new task lines appended to ${taskIndex} with their task documents (at least one new task)`,
      detail: "no new task, an existing line or task document changed, or a task number reusing a taken number",
      get requirement() {
        return (
          `append new task lines after the existing ones of ${taskIndex} (one per task, \`- [ ] T-NNN <task title>\`, at least one) ` +
          `and each new task's docs/T-NNN/todo.md (title line \`# T-NNN: <task title>\`, field line \`Phase: ${phaseId}\`, ` +
          `the three sections \`## Goal\` / \`## Scope\` / \`## Acceptance\`, last line \`<!-- auto: eof -->\`), ` +
          `without changing any existing index line or task document.` +
          (problems.length ? ` Problems last time: ${problems.join("; ")}.` : "")
        )
      },
      commit: { stage: "phase-append", subject: `PLAN append ${phaseTitle(phase)}` },
      reset: () => resetAppend(directory, phase, snap),
      collect: async () => {
        const checked = await appendProblems(directory, phase, snap, { before, numberStart })
        problems = checked.problems
        return problems.length ? undefined : checked.ids
      },
    },
  )
  if (!Array.isArray(appended)) {
    if (appended.type === "dirty") {
      log(`⏸ worktree not clean before starting the task-append session; handle it manually (commit/clean) and re-run:`)
      for (const file of appended.files) log(`  ${file}`)
    } else {
      log(`⏸ task-append session blocked (implicit block, investigate and re-run):\n${appended.question}`)
    }
    return 2
  }
  // 自动编号: 追加成功即推进编号记录到本次最大新编号 + 1(只增不减)。
  if (numberStart !== undefined) {
    const next = await advanceNextTask(directory, appended)
    log(`✓ numbering record advanced: next available task number T-${String(next).padStart(3, "0")}(${NEXT_TASK_FILE})`)
  }
  log(`✓ task append complete: ${taskIndex} gained ${appended.length} task(s)`)
  ctx.planned = appended
  // Stale handover (plans/0053 D25/F13): a phase that was already distilled
  // has a handover.md that predates the appended tasks — the phase is
  // distilled again after they run, so the stale document goes now, in its own
  // commit; acceptance.md and verdict.md stay (the next distillation redrafts
  // the first, the new tasks may rewrite the second).
  const handover = phaseHandoverDoc(phase)
  if (await Bun.file(join(directory, handover)).exists()) {
    await rm(join(directory, handover))
    if (opts.commit !== false) {
      const settled = await commitTree(directory, { id: "PLAN", title: `phase append (${phaseTitle(phase)})` }, {
        stage: "phase-append",
        subject: `PLAN append ${phaseTitle(phase)}: remove the stale handover`,
      })
      if (!settled.ok) {
        log(
          `⏸ stale-handover removal commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. ` +
            `The deletion is kept in the worktree; commit manually and re-run (the append step re-enters idempotently)`,
        )
        return 2
      }
    }
    log(`✓ stale handover removed: ${handover} (the phase is distilled again after the appended tasks)`)
  }
  // 收口: 删除本步骤的 driver 侧恢复点,最后一步(D25)——在此之前被 kill →
  // 记录仍 active,下次运行经 openStep 重入追加(幂等)。已知残余: 若 kill 落在
  // 追加单元提交之后、收口之前,重入的快照已含已提交的追加任务,重做会再追加
  // 一批(设计接受的残余;plan 停下来供人审阅,重复可见可改)。
  await closeStep(directory, "phase-append", phaseKey(phase).id)
  return 0
}

// The phased appending prompt: phase-append over the project brief, the
// planning input, the earlier phases' handovers and the round brief (the
// existing tasks and the phase naming come with the shared template).
async function phaseAppendPrompt(
  ctx: LoopCtx,
  phase: PhaseUnit,
  parts: { brief?: string; input: string; taskIndex: string; phaseId: string; numberStart: number; existingTasks: string },
): Promise<string> {
  const { directory, opts } = ctx
  const state = await phaseState(directory)
  return renderPhaseAppend({
    phase: phase.entry,
    phaseId: parts.phaseId,
    taskIndex: parts.taskIndex,
    numberStart: parts.numberStart,
    input: parts.input,
    inputPath: planInputPath(phase),
    existingTasks: parts.existingTasks,
    brief: parts.brief,
    round: await roundBriefText(directory, state.round),
    handovers: await earlierHandovers(directory, phase, state),
    mode: opts.mode,
    parallel: opts.parallel,
  })
}

// Task appending plus the same stop handling as planWithStep (plans/0053 D6):
// under plan's stop condition the summary — over the appended ids — is the
// review point; under run the G5 pause applies as after a planning step.
export async function appendWithStep(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const code = await appendPlan(ctx, phase)
  if (code !== 0) return code
  if (ctx.opts.stopBefore === "execute") {
    for (const line of plannedLines(ctx.directory, phase, ctx.planned ?? [], ctx.manual)) log(line)
    return 0
  }
  await stepPause("phase", `phase ${phaseTitle(phase)} append`, { interactive: ctx.repl, dir: ctx.directory })
  maybeExit("phase", `phase ${phaseTitle(phase)} append`)
  return 0
}
