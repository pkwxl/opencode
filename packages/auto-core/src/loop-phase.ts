// Phase loop (--phases): the phase handover (handoverPhase and its step wrapper
// handoverWithStep) and the phase routing loop (runPhaseLoop), runAll's former
// closures as top-level functions with their captures made explicit as LoopCtx
// (defined in ./loop-task). Phase planning lives in ./loop-plan (plans/0053 A2).
// Split out of src/loop.ts (plans/0024-module-split-plan.md S16, pure move). Does not depend on loop.ts.
import { mkdir, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { requireArtifact } from "./artifact"
import { phaseCloseLines, phaseResolveLines, roundCompleteLines, roundResolveLines } from "./conclusion"
import { acceptanceMark, ACCEPTED_MARK, HANDOVER_SECTIONS, validHandover } from "./document/roles"
import { maybeExit } from "./exit"
import { clearSticky, consumeFailback } from "./failback"
import { commitPending, commitTree } from "./git"
import { hibernatePause } from "./hibernate"
import { extractKnowledge } from "./knowledge"
import { banner, log } from "./log"
import { appendWithStep, phaseState, phaseTitle, planWithStep } from "./loop-plan"
import { runTaskLoop, type LoopCtx } from "./loop-task"
import { completePhase, phaseAcceptanceDoc, phaseGates, phaseHandoverDoc, phaseKey, routePhase, type PhaseUnit } from "./phases"
import { emptyIndexNotice, executeNotice, roundCompleteNext } from "./plan"
import { planInputPath, readPlanInput } from "./plan-input"
import { renderPhaseHandover } from "./prompt"
import { roundCloseLines, roundCloseProblems } from "./round-close"
import { closeStep, openStep } from "./resume"
import { shellProfile } from "./shell"
import { statsPhase } from "./stats"
import { stepPause } from "./step"
import { loadPlan } from "./tasks"

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
  // Phase gates (plans/0049 G7). With the acceptance gate on, the distillation
  // also drafts acceptance.md for the human to sign; the draft must never carry
  // an `Accepted:` line, which only a human writes.
  const gates = phaseGates(phase, opts.acceptanceGate)
  const acceptance = gates.includes("acceptance") ? phaseAcceptanceDoc(phase) : undefined
  const acceptanceFile = acceptance ? join(directory, acceptance) : undefined
  // fresh = the output of this distillation session: it must not be signed. An
  // existing draft on the idempotent skip path may carry the human's sign-off.
  const draftProblem = async (fresh: boolean): Promise<string | undefined> => {
    if (!acceptance) return undefined
    const text = await Bun.file(acceptanceFile!).text().catch(() => undefined)
    if (text === undefined) return `${acceptance} is missing`
    if (fresh && acceptanceMark(text).present) return `${acceptance} carries an \`Accepted:\` line; only the human reviewer writes it — remove it`
    if (!text.split("\n").some((line) => line.trim() && !/^#{1,6}\s/.test(line.trim()))) return `${acceptance} has no content`
    return undefined
  }
  // 蒸馏幂等跳过 + ③ 补提交(plans/0021-commit-boundary-design.md P4): 交接文档已齐备
  // (四小节经 validHandover 校验)时不再重开蒸馏会话——上次中断在"蒸馏已产出、
  // driver 未收口"区间的现场直接续跑快照/完成改名;文档仍在未提交清单则先补提交
  // (产物落盘且已提交才算完成)。部分写就(小节不全)照常走蒸馏: reset 清文件
  // 重来,step 恢复点(openStep)仍可复用原会话续写。
  const distillTask = { id: "PLAN", title: `phase handover distillation (${phaseTitle(phase)})`, status: "in_progress" as const, attempts: 0, body: "" }
  const distillCommit = { stage: "phase-handover", subject: `PLAN handover ${phaseTitle(phase)}` }
  if (validHandover(await Bun.file(handoverFile).text().catch(() => "")) && !(await draftProblem(false))) {
    const pending = await commitPending(directory, opts, distillTask, distillCommit, acceptance ? [handover, acceptance] : [handover])
    if (pending !== "clean") {
      if (!pending.ok) {
        log(`⏸ handover document make-up commit failed: ${pending.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}, handle it manually and re-run`)
        return 2
      }
      log(`✓ handover document produced but not yet committed; make-up commit done: ${handover}`)
    }
    log(`↻ handover document ${handover} is complete; skipping the distillation session, going straight to archiving`)
  } else {
    log(`▶ starting the handover distillation session to produce ${handover}${acceptance ? ` and the acceptance draft ${acceptance}` : ""}`)
    // The phase's closed tasks are listed for the distillation as not delivered (plans/0053 D16); the route already
    // validated the index, so a load failure only drops the list (an index-less phase has no tasks).
    const plan = await loadPlan(directory, phase).catch(() => undefined)
    const closedTasks = plan?.tasks.flatMap((task) => (task.closed === undefined ? [] : [{ id: task.id, title: task.title, reason: task.closed }]))
    let draftIssue: string | undefined
    const distilled = await requireArtifact(
      serverHandle.client,
      distillTask,
      renderPhaseHandover({ phase: phase.entry, handover, next, acceptance, closedTasks }),
      {
        agent: agentName,
        dir: directory,
        verbose: opts.verbose,
        waitAnswer: opts.waitAnswer,
        humanQuestions: opts.stopBefore === "execute",
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
        artifact: `a valid handover document ${handover} (all four mandatory sections)${acceptance ? ` and an acceptance draft ${acceptance}` : ""}`,
        detail: acceptance ? "missing, sections incomplete, or the acceptance draft missing, empty or signed" : "missing or sections incomplete",
        get requirement() {
          return (
            `write the handover document to ${handover} with four sections whose headings are exactly ` +
            `${HANDOVER_SECTIONS.map((section) => `\`${section}\``).join(" / ")} (driver protocol strings, write them verbatim).` +
            (acceptance ? ` Also write the acceptance draft ${acceptance} for the human reviewer, without any \`Accepted:\` line.` : "") +
            (draftIssue ? ` Problem last time: ${draftIssue}.` : "")
          )
        },
        commit: distillCommit,
        // The acceptance draft is not reset: on a rejected phase it holds the
        // reviewer's notes, which the new draft must keep.
        reset: () => rm(handoverFile, { force: true }),
        collect: async () => {
          const text = await Bun.file(handoverFile).text().catch(() => "")
          draftIssue = await draftProblem(true)
          return (validHandover(text) && !draftIssue) || undefined
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
  const gated = await completePhase(directory, phase, gates)
  if (gated.length) {
    logGateStop(directory, phase, gated, acceptance)
    return 2
  }
  if (opts.commit !== false) {
    // 交接提交是阶段单元的收口落账(完成改名 + 索引勾选),提交失败 → 阻塞退出 2
    // 交人工: 阶段已改名完成,重跑会路由到下一阶段,遗留未提交改动由人工
    // 处置后继续(plans/0021-commit-boundary-design.md P3)。
    const settled = await commitTree(directory, { id: "PLAN", title: `phase handover (${phaseTitle(phase)})` }, {
      stage: "phase-transition",
      subject: `PLAN transition ${phaseTitle(phase)} → ${target}`,
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

// A phase gate holds (plans/0049 G7): the phase stays on its handover route,
// and the next run re-checks. The human's ways on — sign, rework through an
// append, or close without the gate — are spelled out here as commands: the
// append removes the stale handover itself (plans/0053 D25) and replans the
// distillation after the fix tasks.
function logGateStop(directory: string, phase: PhaseUnit, problems: string[], acceptance: string | undefined): void {
  const { bin } = shellProfile()
  const waiting = problems.every((problem) => problem.startsWith("acceptance:"))
  log(`⏸ phase ${phaseTitle(phase)} ${waiting ? "awaits acceptance" : "is held by its gate"}:`)
  for (const problem of problems) log(`  ${problem}`)
  const handover = phaseHandoverDoc(phase)
  if (acceptance) {
    log(`  to accept: review ${handover} and ${acceptance}, add the line \`${ACCEPTED_MARK}\` to ${acceptance}, commit, re-run`)
  }
  log(
    `  to rework: ${acceptance ? `write your notes in ${acceptance}, ` : ""}append fix tasks with ${bin} plan ${directory} --append -p <text> ` +
      `(the stale handover is removed and distilled again after them)`,
  )
  log(`  to close the phase without its gate: ${bin} close ${phaseKey(phase).id} ${directory} --reason <text>`)
}

// 阶段循环(D.1;无阶段模式亦走此循环,plans/0047 L2): 推导当前阶段 → 任务索引
// 无任务则开规划会话 → 主循环执行 → 本阶段任务全 done 交接 → 阶段完成改名推导
// 下一阶段;全部阶段完成退出 0。阶段/任务索引缺失或非法等环境错误退出 1(H 节)。
// 无阶段模式(ctx.manual,phases = "m"): 唯一阶段 P01-implement 为人工模式——
// 任务由人工写入,规划会话只在给了规划输入或规划步骤未收口时开(planPhase,
// plans/0053 D12)、不交接、阶段保持未完成(追加任务后重跑即续),任务全部完成
// 即打印轮次完成行退出 0。
// 步进暂停(phase 边界,OPENCODE_AUTO_STEP ≥ phase): 交接(完成+提交)
// 完成后、下一轮路由前硬暂停——最后一个阶段暂停后回车即「全部阶段已完成」退出。
// plan runs the same loop under its stop condition (opts.stopBefore,
// plans/0053 D6): it goes through handovers and knowledge phases as run does,
// and stops after a successful planning step or where an execute route would
// start, printing what to review; the complete route adds the next step (D8).
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
  try {
    return await phaseLoop(ctx)
  } finally {
    // plan's input backstop (plans/0053 D8): the prelude refuses an input no
    // phase would take, so this fires only where the loop stopped short of a
    // planning step (a gate, a block, a phase whose tasks were listed by hand).
    if (ctx.input) log("⚠ the planning input was not used: no planning step ran on it, so it was not saved; pass it again to a later plan")
  }
}

async function phaseLoop(ctx: LoopCtx): Promise<number> {
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
      const state = await phaseState(directory)
      const lines = await roundCompleteLines(directory, { phaseCount: state.done.size })
      if (lines) for (const line of lines) log(line)
      // Round-close report (plans/0049 G8, anchor a): the checks the next
      // round's start enforces, reported on every complete run; the exit code
      // is unaffected.
      for (const line of roundCloseLines(await roundCloseProblems(directory, state.round, { build: opts.build }))) log(line)
      // plan does not open the next round here (plans/0053 D8): the round's
      // ## Close cannot be filled in yet, so the round-close checks would fail.
      if (opts.stopBefore === "execute") log(roundCompleteNext(directory, state.round))
      return 0
    }
    // 阶段切换挂点(STATS_PLAN §3): 阶段限定编号变化重置 phase 桶;相同编号幂等。
    // blocked 已 return、complete 即将退出,均无需切换。
    await statsPhase(directory, phaseKey(route.phase).id)
    // Session resume takes precedence over file-derived routing
    // (plans/0018-session-resume-precedence-design.md): an unclosed phase-step
    // resume point on the driver side (the last run's planning/appending/
    // handover session was interrupted before the driver closed it out) →
    // re-enter that step and reuse the interrupted session, even if the
    // task/phase index has already moved file routing on. Task units and
    // handover docs are written by the AI (or patched by the driver after the
    // interruption) and cannot prove the session closed out; only closeStep
    // deleting the resume point does. It applies only when the step's phase is
    // the current routed phase and is not done: another phase (manual
    // rollback, stale record) lets file routing win, and a done phase clears
    // the stale record. The point is keyed by the qualified phase id R-NN.P<nn>
    // (a type may repeat within a round); a record without one (pre-M3.6
    // `letter`) matches no phase and file routing wins.
    // The check precedes the m-mode branch below (plans/0053 D12), so an
    // interrupted m-mode planning or appending step is finished by whichever
    // command runs next, from its persisted planning input; a record with no
    // input to plan against (it predates the input) is closed, and file
    // routing continues. An interrupted append re-enters through appendPlan
    // (plans/0053 D23), never a full planPhase.
    const open = await openStep(directory)
    if (open) {
      const state = await phaseState(directory)
      const owner = state.phases.find((unit) => phaseKey(unit).id === open.unit)
      if (owner && state.done.has(owner.id)) {
        await closeStep(directory, open.step, open.unit)
      } else if (
        ctx.manual &&
        (open.step === "phase-plan" || open.step === "phase-append") &&
        open.unit === phaseKey(route.phase).id &&
        !ctx.input &&
        !(await readPlanInput(directory, route.phase))?.trim()
      ) {
        log(
          `⚠ unclosed m-mode ${open.step === "phase-plan" ? "planning" : "appending"} resume point (${open.unit}) has no planning input (${planInputPath(route.phase)}) to plan against; ` +
            `closing it and continuing with the file-derived route`,
        )
        await closeStep(directory, open.step, open.unit)
      } else if (open.unit === phaseKey(route.phase).id) {
        const stepName = open.step === "phase-plan" ? "phase planning" : open.step === "phase-append" ? "task appending" : "phase handover"
        log(`↻ session resume point takes precedence: the ${stepName} session(${phaseTitle(route.phase)}) was not closed out; re-entering that step to continue`)
        if (open.step === "phase-plan") {
          banner(`${phaseTitle(route.phase)} phase planning`)
          const code = await planWithStep(ctx, route.phase)
          if (code !== 0 || opts.stopBefore === "execute") return code
          continue
        }
        if (open.step === "phase-append") {
          banner(`${phaseTitle(route.phase)} task append`)
          const code = await appendWithStep(ctx, route.phase)
          if (code !== 0 || opts.stopBefore === "execute") return code
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
    // An append this run was asked for (plans/0053 D23): the phase the route
    // names now already has its index written — tasks pending (execute route)
    // or the phase distilled / gate-stopped (handover route) — so new tasks
    // are appended to it, never a full planning step and never another phase.
    // It always rides an input (the prelude refuses --append without one, and
    // m mode implies the append from an input on a non-empty index), so the
    // input still being unconsumed is what makes this an append: a planning
    // step consumed it otherwise, and appendPlan consumes it here.
    if (ctx.input !== undefined && route.type !== "plan" && (ctx.append || ctx.manual)) {
      banner(`${phaseTitle(route.phase)} task append`)
      const code = await appendWithStep(ctx, route.phase)
      if (code !== 0 || opts.stopBefore === "execute") return code
      continue
    }
    // 人工模式(无阶段): 没有任务可跑即收场——任务索引为空提示补写,任务全部
    // 完成打印轮次完成行;均退出 0,阶段保持未完成。A planning input handed to
    // this run (ctx.input) is the exception: m mode then plans on planPhase
    // like a phase (plans/0053 D12).
    if (ctx.manual && route.type !== "execute" && !(route.type === "plan" && ctx.input)) {
      if (route.type === "plan") {
        for (const line of emptyIndexNotice(directory, route.plan.index)) log(line)
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
          humanQuestions: opts.stopBefore === "execute",
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
      const code = await planWithStep(ctx, route.phase)
      // plan's stop condition (plans/0053 D6): a planning step that succeeded
      // is where plan stops; planWithStep printed the summary.
      if (code !== 0 || opts.stopBefore === "execute") return code
      continue
    }
    if (route.type === "execute") {
      // plan's stop condition (plans/0053 D6, D7): an execute route this run
      // did not plan (planning stops the run itself), e.g. a next phase whose
      // tasks were listed by hand. An input left over is plan's usage error.
      if (opts.stopBefore === "execute") {
        for (const line of executeNotice(directory, route, ctx.manual)) log(line)
        return ctx.input ? 1 : 0
      }
      const code = await runTaskLoop(ctx, route.phase)
      if (code !== 0) return code
      continue
    }
    const code = await handoverWithStep(ctx, route.phase)
    if (code !== 0) return code
  }
}
