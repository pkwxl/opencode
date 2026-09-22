// 阶段循环(--phases): 阶段规划会话(planPhase)、阶段交接(handoverPhase + 步进包装
// handoverWithStep)与阶段路由主循环(runPhaseLoop),runAll 原闭包转顶层函数,捕获量
// 显式化为 LoopCtx(定义在 ./loop-task)。
// 拆分自 src/loop.ts(plans/0024-module-split-plan.md S16,纯搬运)。不依赖 loop.ts。
import { mkdir, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { requireArtifact } from "./artifact"
import { phaseCloseLines, phaseResolveLines, roundCompleteLines, roundResolveLines } from "./conclusion"
import { HANDOVER_SECTIONS, validHandover } from "./document/roles"
import { maybeExit } from "./exit"
import { clearSticky, consumeFailback } from "./failback"
import { commitPending, commitTree } from "./git"
import { hibernatePause } from "./hibernate"
import { extractKnowledge, priorKnowledgeDigest } from "./knowledge"
import { banner, log } from "./log"
import { runTaskLoop, type LoopCtx } from "./loop-task"
import { advanceNextTask, ensureNumbering, NEXT_TASK_FILE } from "./numbering"
import {
  completePhase,
  phaseHandoverDoc,
  phaseKey,
  phaseLabel,
  phaseName,
  prevRoundDigest,
  readPhases,
  routePhase,
  type PhaseState,
  type PhaseUnit,
} from "./phases"
import { renderPhaseHandover, renderPhasePlan } from "./prompt"
import { plannedTaskProblems, qualifiedPhase, resetPlanning, takenTaskIds, taskIndexPath } from "./tasks"
import { closeStep, openStep } from "./resume"
import { statsPhase } from "./stats"
import { stepPause } from "./step"

// 阶段索引(路由已校验过;此处再读只为取完成集与前后序,缺失/非法按空处理)。
async function phaseState(directory: string): Promise<PhaseState> {
  return (await readPhases(directory).catch(() => undefined)) ?? { round: 0, index: "", phases: [], done: new Set() }
}

// 阶段显示名(日志/提交标题): P02-design 设计
const phaseTitle = (unit: PhaseUnit) => `${phaseLabel(unit)} ${phaseName(unit)}`

// 阶段规划会话(E 节): 旁路一次性,复用 requireArtifact 骨架,产物 = 本阶段任务索引
// <阶段目录>/tasks.md + 各任务的 docs/T-NNN/todo.md(M3.4,plans/0047 L3),collect 按
// mandatory 策略形检(plannedTaskProblems)。伪任务 PLAN 不进任务链、不写进度记录。
// 返回 0 = 规划完成。
export async function planPhase(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const { directory, opts, server: serverHandle, agentName, repl } = ctx
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
  const brief = await Bun.file(join(directory, ".opencode", "auto", "brief.md")).text().catch(() => undefined)
  // 前序阶段交接注入(E 节注入纪律): 只注入 handover 蒸馏产物,不注入前序
  // 原始 docs/。阶段索引中早于当前阶段且已 done 的各阶段逐个拼接;交接文档为
  // 阶段目录内的永久路径 P<nn>-<type>/handover.md;缺 handover 的阶段在清单中
  // 标注"(无交接文档)"。
  const state = await phaseState(directory)
  const earlier = state.phases.slice(0, state.phases.findIndex((unit) => unit.id === phase.id))
  const handovers = (
    await Promise.all(
      earlier
        .filter((unit) => state.done.has(unit.id))
        .map(async (unit) => {
          const doc = phaseHandoverDoc(unit)
          const text = await Bun.file(join(directory, doc)).text().catch(() => undefined)
          return [`### ${phaseTitle(unit)}(${doc})`, "", text?.trim() || "(无交接文档)"].join("\n")
        }),
    )
  ).join("\n\n")
  // 本轮首个规划会话的额外注入(本轮尚无完成阶段时): ① 前置知识(外壳启动时的已有
  // 迁移结果蒸馏,docs/R-NN/prior-kb.md,见 src/knowledge.ts);② 上一轮结论(上一轮
  // 轮次目录存在时,plans/0006-phases-design.md M 节)。后续阶段照常走 handovers 蒸馏链,
  // 不重复注入。
  let prevRound: string | undefined
  if (!state.done.size) {
    const parts = [await priorKnowledgeDigest(directory), await prevRoundDigest(directory)].filter((part): part is string => Boolean(part?.trim()))
    prevRound = parts.length ? parts.join("\n\n") : undefined
    if (prevRound) log("ℹ injecting prior migration conclusions (prior knowledge + previous round's archive excerpts)")
  }
  const taskIndex = taskIndexPath(phase)
  const phaseId = qualifiedPhase(phase)
  // 已占用的任务编号: 其他阶段任务索引列出的与已完成的任务(本阶段规划自身的遗留
  // 不算——中断续跑/反馈重试会再写同一批编号)。
  const taken = await takenTaskIds(directory, phase)
  let problems: string[] = []
  log(`▶ starting the phase planning session to write ${taskIndex} and the task documents`)
  const planned = await requireArtifact(
    serverHandle.client,
    { id: "PLAN", title: `phase planning (${phaseTitle(phase)})`, status: "in_progress", attempts: 0, body: "" },
    renderPhasePlan({
      phase: phase.entry,
      phaseId,
      taskIndex,
      brief,
      handovers,
      prevRound,
      source: opts.source,
      destDir: opts.destDir,
      mode: opts.mode,
      // 本轮阶段索引无独立 analysis/design 阶段 → implement 阶段规划注入裁剪注记
      trimmedPhases: !state.phases.some((unit) => unit.type === "analysis" || unit.type === "design"),
      numberStart,
    }),
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
      // Independent hidden task unit: entry clean gate + SHA baseline + close-out
      // check (plans/0021-commit-boundary-design.md).
      unitStart: true,
      artifact: `a valid task index ${taskIndex} with its task documents (at least one task)`,
      detail: "missing, no task, a non-compliant task document, or a task number reusing a taken number",
      get requirement() {
        return (
          `write the task index ${taskIndex} (one line per task, \`- [ ] T-NNN <task title>\`, at least one; even if you believe this phase has nothing to do, write one explanatory task) ` +
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
  // 收口: 删除本步骤的 driver 侧恢复点(产物已校验、提交与编号推进均完成)。
  // 在此之前被 kill → 记录仍 active,下次运行经 openStep 重入规划并复用会话。
  await closeStep(directory, "phase-plan", phaseKey(phase).id)
  return 0
}

// 阶段交接(F 节,docs 永不移动): ① 蒸馏会话(AI 唯一职责,旁路一次性)产出
// 阶段目录内的永久交接文档 docs/R-NN/P<nn>-<type>/handover.md(落定不移动)→
// ② 阶段完成(completePhase: todo.md → done.md + 索引勾选;阶段目录即归档,
// 无快照、无重置,M3.4)→ ③ 统一提交(Auto-Stage: phase-transition)。各步幂等:
// 中断后阶段仍未完成、任务仍全部 done,路由照旧是 handover,交接文档已齐备即跳过
// 蒸馏直接补做 ②③(C.2)。返回 0 = 交接完成,2 = 蒸馏会话隐性阻塞。
export async function handoverPhase(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const { directory, opts, server: serverHandle, agentName, repl } = ctx
  const state = await phaseState(directory)
  const following = state.phases[state.phases.findIndex((unit) => unit.id === phase.id) + 1]
  const next = following ? phaseTitle(following) : undefined
  const target = next ?? "flow complete"
  banner(`phase handover: ${phaseTitle(phase)} → ${target}`)
  // 阶段目录轮首即建;交接文档不在 protect 名单,无需 allowWrite。
  const handover = phaseHandoverDoc(phase)
  const handoverFile = join(directory, handover)
  await mkdir(dirname(handoverFile), { recursive: true })
  // 蒸馏幂等跳过 + ③ 补提交(plans/0021-commit-boundary-design.md P4): 交接文档已齐备
  // (四小节经 validHandover 校验)时不再重开蒸馏会话——上次中断在"蒸馏已产出、
  // driver 未收口"区间的现场直接续跑快照/完成改名;文档仍在未提交清单则先补提交
  // (产物落盘且已提交才算完成)。部分写就(小节不全)照常走蒸馏: reset 清文件
  // 重来,step 恢复点(openStep)仍可复用原会话续写。
  const distillTask = { id: "PLAN", title: `phase handover distillation (${phaseTitle(phase)})`, status: "in_progress" as const, attempts: 0, body: "" }
  const distillCommit = { stage: "phase-handover", subject: `PLAN handover ${phaseTitle(phase)}` }
  if (validHandover(await Bun.file(handoverFile).text().catch(() => ""))) {
    const pending = await commitPending(directory, opts, distillTask, distillCommit, [handover])
    if (pending !== "clean") {
      if (!pending.ok) {
        log(`⏸ handover document make-up commit failed: ${pending.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}, handle it manually and re-run`)
        return 2
      }
      log(`✓ handover document produced but not yet committed; make-up commit done: ${handover}`)
    }
    log(`↻ handover document ${handover} is complete; skipping the distillation session, going straight to archiving`)
  } else {
    log(`▶ starting the handover distillation session to produce ${handover}`)
    const distilled = await requireArtifact(
      serverHandle.client,
      distillTask,
      renderPhaseHandover({ phase: phase.entry, handover, next }),
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
      },
      {
        kind: "handover distillation",
        step: { step: "phase-handover", unit: phaseKey(phase).id },
        // Independent hidden task unit: entry clean gate + SHA baseline + close-out
        // check (plans/0021-commit-boundary-design.md; a partly written handover is
        // cleared by reset and rewritten).
        unitStart: true,
        artifact: `a valid handover document ${handover} (all four mandatory sections)`,
        detail: "missing or sections incomplete",
        requirement:
          `write the handover document to ${handover} with four sections whose headings are exactly ` +
          `${HANDOVER_SECTIONS.map((section) => `\`${section}\``).join(" / ")} (driver protocol strings, write them verbatim).`,
        commit: distillCommit,
        reset: () => rm(handoverFile, { force: true }),
        collect: async () => {
          const text = await Bun.file(handoverFile).text().catch(() => "")
          return validHandover(text) || undefined
        },
      },
    )
    if (distilled !== true) {
      if (distilled.type === "dirty") {
        log(`⏸ worktree not clean before starting the handover distillation session; handle it manually (commit/clean) and re-run:`)
        for (const file of distilled.files) log(`  ${file}`)
      } else {
        log(`⏸ handover distillation session blocked (implicit block, investigate and re-run):\n${distilled.question}`)
      }
      return 2
    }
  }
  // 收口: 蒸馏会话(本步骤唯一的 AI 环节)已产出有效交接文档并提交,删除 driver
  // 侧恢复点。其后的完成改名与提交为幂等的 driver 记账,中断后重跑经上方的交接
  // 文档齐备跳过补完,不再依赖会话恢复。
  await closeStep(directory, "phase-handover", phaseKey(phase).id)
  await completePhase(directory, phase)
  // AGENTS.md 只校验不改写(F.2): 超 150 行在交接提交信息与终端 note 提示人工精简。
  const agentsLines = (await Bun.file(join(directory, "AGENTS.md")).text().catch(() => "")).trimEnd().split("\n").length
  const fat = agentsLines > 150 ? `AGENTS.md is ${agentsLines} lines, over the 150-line limit; trim it manually` : undefined
  if (fat) log(`ℹ ${fat}`)
  if (opts.commit !== false) {
    // 交接提交是阶段单元的收口落账(完成改名 + 索引勾选),提交失败 → 阻塞退出 2
    // 交人工: 阶段已改名完成,重跑会路由到下一阶段,遗留未提交改动由人工
    // 处置后继续(plans/0021-commit-boundary-design.md P3)。
    const settled = await commitTree(directory, { id: "PLAN", title: `phase handover (${phaseTitle(phase)})` }, {
      stage: "phase-transition",
      subject: `PLAN transition ${phaseTitle(phase)} → ${target}${fat ? `(${fat})` : ""}`,
    })
    if (!settled.ok) {
      log(
        `⏸ phase handover commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. ` +
          `The completion changes are kept in the worktree (the phase is already marked done); commit manually and re-run`,
      )
      return 2
    }
  }
  // 阶段代答汇总(plans/0020-auto-resolve-design.md §H-③,H6): 置顶于 ■ 收口行之前。
  for (const line of await phaseResolveLines(directory, phase)) log(line)
  // 阶段收口行(STATS_PLAN §4.3,T-006): commitTree 之后、return 0 之前——
  // 交接提交时长仍计入本阶段桶(读数实时外推,含当前开放段)。
  const closing = await phaseCloseLines(directory, phase)
  if (closing) for (const line of closing) log(line)
  return 0
}

// 阶段循环(D.1;无阶段模式亦走此循环,plans/0047 L2): 推导当前阶段 → 任务索引
// 无任务则开规划会话 → 主循环执行 → 本阶段任务全 done 交接 → 阶段完成改名推导
// 下一阶段;全部阶段完成退出 0。阶段/任务索引缺失或非法等环境错误退出 1(H 节)。
// 无阶段模式(ctx.manual,phases = "m"): 唯一阶段 P01-implement 为人工模式——
// 不开规划会话(任务由 init 快捷模式或人工写入)、不交接、阶段保持未完成(追加
// 任务后重跑即续),任务全部完成即打印轮次完成行退出 0。
// 步进暂停(phase 边界,OPENCODE_AUTO_STEP ≥ phase): 交接(完成+提交)
// 完成后、下一轮路由前硬暂停——最后一个阶段暂停后回车即「全部阶段已完成」退出。
export async function handoverWithStep(ctx: LoopCtx, phase: PhaseUnit): Promise<number> {
  const { directory, repl } = ctx
  const code = await handoverPhase(ctx, phase)
  if (code !== 0) return code
  await stepPause("phase", `phase ${phaseTitle(phase)} handover`, { interactive: repl, dir: directory })
  maybeExit("phase", `phase ${phaseTitle(phase)} handover`)
  // Hibernate window (phase boundary, OPENCODE_AUTO_HIBERNATE): a safe spot to
  // check after the handover (snapshot+completion+commit) completes; sleep
  // until wake inside the window before entering the next phase
  // (plans/0027-hibernate-design.md).
  await hibernatePause(`phase ${phaseTitle(phase)} handover boundary`, { dir: directory })
  // failback 回试(phase 边界): 所有粒度都在阶段边界重置——phase 粒度的跨任务
  // sticky holder 在此清零;/failback 请求同点消费。
  clearSticky()
  consumeFailback()
  return 0
}

export async function runPhaseLoop(ctx: LoopCtx): Promise<number> {
  const { directory, opts, server: serverHandle, agentName, repl } = ctx
  for (;;) {
    const route = await routePhase(directory)
    if (route.type === "blocked") {
      log(`⏸ phase flow blocked: ${route.reason}`)
      return 1
    }
    if (route.type === "complete") {
      log("✓ all phases complete")
      for (const line of await roundResolveLines(directory)) log(line)
      // 轮次完成行(STATS_PLAN §4.4,T-006): 阶段数取阶段索引 done 计数(本轮
      // 已交接阶段);历轮累计段在 history.rounds > 0 时由构造函数自行追加。
      const lines = await roundCompleteLines(directory, { phaseCount: (await phaseState(directory)).done.size })
      if (lines) for (const line of lines) log(line)
      return 0
    }
    // 人工模式(无阶段): 没有任务可跑即收场——任务索引为空提示补写,任务全部
    // 完成打印轮次完成行;均退出 0,阶段保持未完成。
    if (ctx.manual && route.type !== "execute") {
      if (route.type === "plan") {
        log(`ℹ no tasks listed in ${route.plan.index}; add task lines there (with docs/T-NNN/todo.md per task) and re-run`)
        return 0
      }
      log("✓ all tasks complete")
      // 轮次代答汇总(plans/0020-auto-resolve-design.md §H-③,H6): 置顶于 ■ 轮次行之前。
      for (const line of await roundResolveLines(directory)) log(line)
      // 非分阶段路径的轮次完成行(STATS_PLAN §4.4,T-006): 阶段桶恒为 "m" 伪阶段,省略阶段段。
      const lines = await roundCompleteLines(directory)
      if (lines) for (const line of lines) log(line)
      return 0
    }
    // 阶段切换挂点(STATS_PLAN §3): 阶段限定编号变化重置 phase 桶;相同编号幂等。
    // blocked 已 return、complete 即将退出,均无需切换。
    await statsPhase(directory, phaseKey(route.phase).id)
    // Session resume takes precedence over file-derived routing
    // (plans/0018-session-resume-precedence-design.md): an unclosed phase-step
    // resume point on the driver side (the last run's planning/handover session
    // was interrupted before the driver closed it out) → re-enter that step and
    // reuse the interrupted session, even if the task/phase index has already
    // moved file routing on. Task units and handover docs are written by the AI
    // (or patched by the driver after the interruption) and cannot prove the
    // session closed out; only closeStep deleting the resume point does. It
    // applies only when the step's phase is the current routed phase and is not
    // done: another phase (manual rollback, stale record) lets file routing win,
    // and a done phase clears the stale record. The point is keyed by the
    // qualified phase id R-NN.P<nn> (a type may repeat within a round); a record
    // without one (pre-M3.6 `letter`) matches no phase and file routing wins.
    const open = await openStep(directory)
    if (open) {
      const state = await phaseState(directory)
      const owner = state.phases.find((unit) => phaseKey(unit).id === open.unit)
      if (owner && state.done.has(owner.id)) {
        await closeStep(directory, open.step, open.unit)
      } else if (open.unit === phaseKey(route.phase).id) {
        log(
          `↻ session resume point takes precedence: the ${open.step === "phase-plan" ? "phase planning" : "phase handover"} session` +
            `(${phaseTitle(route.phase)}) was not closed out; re-entering that step to continue`,
        )
        if (open.step === "phase-plan") {
          banner(`${phaseTitle(route.phase)} phase planning`)
          const code = await planPhase(ctx, route.phase)
          if (code !== 0) return code
          continue
        }
        // 交接重入仅当文件路由也是 handover(本阶段任务全部 done): 否则(尚有
        // 未完成任务的异常态)交接会把未完成任务的阶段标记完成,让文件路由优先并告警。
        if (route.type === "handover") {
          const code = await handoverWithStep(ctx, route.phase)
          if (code !== 0) return code
          continue
        }
        log(
          `⚠ unclosed handover resume point (${open.unit}) is inconsistent with the current route (${route.type})` +
            `(unfinished tasks remain?); continuing with the file-derived route, not re-entering the handover to avoid losing unfinished tasks`,
        )
      } else {
        log(
          `⚠ unclosed phase-step resume point (${open.step} ${open.unit ?? "unrecorded phase"}) is inconsistent with the current route phase (${phaseTitle(route.phase)}); ` +
            `continuing with the file-derived route (ignore if this was a manual rollback; otherwise check .auto/progress.json)`,
        )
      }
    }
    if (route.type === "plan") {
      // k(知识提炼)阶段整体认领 --extract-knowledge 设计(P4): 不开规划会话、
      // 不写任务索引——plan 路由直接进入知识提取旁路会话(产物为阶段目录内
      // 的类型标准产物 P<nn>-knowledge/kb.md;已产出则幂等跳过),随后照常交接。提取失败只打 ⚠ 警告、不污染
      // 退出码(迁移成功不被文档生成失败反向污染);人工在 k 阶段自行写任务索引
      // 时走通用 execute/handover 路由,提取挂点不触发。
      // 判据为注册表 hasTasks: false(M3.2);直连会话是知识提取专属——内置类型中
      // 仅 knowledge 无任务,自定义类型恒有任务(M3.6,src/phases/custom.ts),故
      // 会话选择无需泛化。
      if (!route.phase.entry.hasTasks) {
        banner("k knowledge distillation: migration knowledge capture")
        const extracted = await extractKnowledge(serverHandle.client, directory, {
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
        }, route.phase)
        if (extracted.type === "ok") log(`✓ migration knowledge document produced: ${extracted.file}`)
        else if (extracted.type === "skipped") log(`↻ migration knowledge document already produced (${extracted.file}); skipping extraction, going straight to handover`)
        else if (extracted.type === "dirty") {
          // dirty (plans/0021-commit-boundary-design.md ④ generalization): an
          // unclean worktree (leftover from an abandoned extraction, make-up
          // commit failure or unified commit failure) must stop for the
          // human — handing over anyway would start the next unit on an
          // unclean baseline, breaking the commit boundary.
          log(`⏸ migration knowledge extraction could not complete or post on a clean baseline; handle it manually (commit/clean) and re-run:`)
          for (const file of extracted.files) log(`  ${file}`)
          return 2
        } else {
          log(
            `⚠ migration knowledge capture incomplete (knowledge_extraction_error); exit code unaffected, the k phase hands over as usual; ` +
              `fix the issue, then retry separately per the manual rollback procedure (rename the knowledge phase's done.md back to todo.md and delete its kb.md). Block details:\n${extracted.question}`,
          )
        }
        const code = await handoverWithStep(ctx, route.phase)
        if (code !== 0) return code
        continue
      }
      banner(`${phaseTitle(route.phase)} phase planning`)
      const code = await planPhase(ctx, route.phase)
      if (code !== 0) return code
      continue
    }
    if (route.type === "execute") {
      const code = await runTaskLoop(ctx, route.phase)
      if (code !== 0) return code
      continue
    }
    const code = await handoverWithStep(ctx, route.phase)
    if (code !== 0) return code
  }
}
