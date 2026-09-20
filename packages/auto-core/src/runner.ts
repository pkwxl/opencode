import { dirname, join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { type ForkBaseInfo, type SessionChain, type SessionResult } from "./chain"
import { writeCurrent, removeCurrent } from "./current"
import { ensureDecomposed, executeWhole, requireTask, runSubtask } from "./execute"
import { commitBlocked, resumeModelNow, rollbackUnitState, strictResumeActive } from "./unit-commit"
import { legacyTaskDoc, resolveTaskDoc } from "./docpaths"
import { maybeExit } from "./exit"
import { consumeFailback, failbackApplies } from "./failback"
import { baselineIntact, commitTree, removeIfUntracked, unitBaseline } from "./git"
import { hibernatePause } from "./hibernate"
import { handoffStatus } from "./handover"
import { log } from "./log"
import { type Opts, type Outcome, type UnitStop } from "./opts"
import { interruptionRemark, phaseText, resumeNote, unitReruns } from "./resume-gate"
import { planReviewFix, reviewTask, verifyTask, type Verdict } from "./review"
import { ensureForkBase, runSession } from "./session"
import {
  appendSubtasks,
  begin,
  load,
  markDone,
  parseFinalMark,
  setStatus,
  subtasks,
  syncSubtaskTicks,
  type Plan,
  type Task,
} from "./plan"
import { handoffFile } from "./prompt"
import { forgetProgress, recallProgress, saveProgress, type Phase } from "./resume"
import { formatTokens, renameSession, sessionAlive, sessionUsage } from "./session-api"
import { effectiveDone, scanSubtaskStates, writeInjectedTodo } from "./subtask-state"
import { autoSwitches } from "./switches"
import { stepPause } from "./step"
import { cleanTestHandoffs, restoreTestHandoffs, testHandoffExists } from "./testrun"
import { runWrapup } from "./wrapup"

// 会话耗时显示用紧凑式时长: 已收口至 src/log.ts 的 formatDurationCompact
// (STATS_PLAN §5,T-001 上收、本任务删本处私有副本并改 import)。

// Runs one task through the pipeline; the driver owns all state
// writes to PLAN.md and CURRENT.md, sessions never edit them.
// --subtask auto (default): decompose (when the task body has no checklist) →
// one session per subtask (driver ticks on trust) → wrap-up → verify.
// --subtask off: a single whole-task session → wrap-up → verify; any gap
// sends the task back to pending for a human to refine and re-run (no fix
// subtasks).
// --subtask ondemand: like off, but when the running session's context usage
// reaches 2x --context-limit the driver steers in a handoff prompt; the session
// writes docs/<id>/handoff.md and a fresh session continues from it.
// The execution phase (decompose / whole-task session) runs only on the first
// round; every round then is: subtask sessions for the unticked checklist →
// wrap-up session → three-stage task-level acceptance (the driver resolves
// and runs the verify script itself, output dumped to tmp/ files, never
// truncated; an independent judge session reads the results and writes the
// verdict; a gap feeds the verdict back into the execution chain for a fix
// round, max FIX_ROUNDS, except off mode).
// With --review n > 0 a quality-audit round follows each acceptance pass:
// an independent audit session (final = every task after this one is done)
// writes an audit report plus the REVIEW_FILE conclusion. A gap in off mode
// reverts the task to pending like a verify gap; otherwise the driver plans
// fix checklist items in a side session, appends them into PLAN.md and runs
// the whole round again (up to n fix rounds, then blocked).
// --early moves that audit session into the verify-script execution window
// (design doc F): verifyTask starts it right before executing the script,
// joins it before the judge session and returns its verdict together with the
// done result, so the audit below consumes it instead of opening a
// separate serial audit session.
// --verify off (the default) skips the three-stage acceptance entirely: the
// driver marks the task done right after wrap-up (no verified record — nothing
// ran), and a --review audit, if enabled, runs serially at that point (--early
// has no execution window to hook into and degrades to the serial audit).
// Final-review tasks (final field, appended by src/final.ts under
// --final-review) run through this same pipeline but force BOTH review=0 AND
// verify off regardless of the flags — the final-review stage is itself the
// inspection; inspecting the inspection is skipped entirely. A missing or
// malformed stage report surfaces later at routeFinal as a brokenReport
// block (exit code 2, human check).
// All execution sessions of a task share one chain: the next session reuses
// the previous one when its context usage ended below REUSE_BELOW, its used
// tokens below 50% of contextLimit (default 32k) and it went idle within
// REUSE_IDLE_MS (default 5 minutes), otherwise a fresh session is created.
// CURRENT.md lives while the task is interrupted or running: it is
// (re)created before the first session — an interrupted run may have left it
// missing or stale — refreshed by later writeCurrent calls, kept with an
// interruption remark when the task ends blocked/incomplete (the next run's
// first prompt carries the essence via the resume note), and deleted only
// when the task completes.
// Interruption recovery (进度记录 .auto/progress.json, design doc H): the
// driver persists the current phase at every pipeline boundary and the
// execution-chain session as active while a session is in flight. On re-run:
// an active record with a live session resumes that session (unsummarized
// in-flight work — equivalent to `opencode -r <session-id>`), unless a handoff
// document was written before the interruption (the old session's context was
// exhausted and the handoff carries the state — a fresh session continues from
// it) or --new-session was given (skip reuse only; the recorded phase still
// re-enters the pipeline precisely). Anything else starts a fresh session
// guided by the recorded phase (graceful exits leave a summarized record with
// active=false); the phase also re-enters the pipeline precisely — a persisted
// verify run skips script re-execution, an interrupted fix round re-issues the
// persisted gap to the execution chain, off/ondemand past the execution phase
// never re-runs the whole-task session, a valid fix checklist file is
// injected without a new planning session. Network-failure blockades keep the
// active record (the session is in-flight and unsummarized); every other
// blocked/incomplete exit finalizes the summary (CURRENT.md remark) and drops
// reuse eligibility. Session reuse is gated by unit attribution (unitReruns):
// the interrupted session belongs to one concrete execution unit (pipeline
// stage / subtask #N / review-fix item #N) and is resumed only when that unit
// will actually rerun — a unit already passed, disabled by config/switches, or
// unattributable (legacy record without index) seals the record and starts a
// fresh session, so the next unit never inherits a stranger's session.
// Permission requests follow --permission (default
// ask-deny): auto-allow grants immediately; ask-* wait for a human (per
// --wait-answer) and time out into auto-allow / auto-deny (session
// continues) / abort+block (ask-fail). Blocking happens on a repeated
// question on the same issue, exhausted transient session errors, a failed
// verification, or an ask-fail permission timeout.
export async function runTask(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
): Promise<Outcome> {
  // 实验开关(OPENCODE_AUTO_* 环境变量层,plans/0003-fork-decompose-design.md §4.6): 入口
  // 解析一次(memo)——非法值在此抛出中文报错(CLI 侧退出码 1),非默认组合记入
  // 启动日志(默认组合静默,verbose 可查全量);fork/forkBase 由 fork 流水线消费,
  // 本层只做解析与既有机制接线(fine/steer);failback 粒度在子任务边界消费。
  const switches = autoSwitches()
  await begin(plan.path, task.id)
  const dir = opts.dir ?? dirname(plan.path)
  const mode = opts.subtask ?? "auto"
  const chain: SessionChain = { pct: 100, used: 0, at: Date.now() }
  // 严格恢复(plans/0022-session-recovery-fidelity-design.md): on 时记录携带单元基线/生效模型、
  // 恢复时核对、不可保真回滚重跑。此刻取任务级基线(与 loop 的 beginUnit 之间无
  // 提交,HEAD 相同;恢复续跑豁免 clean 的路径同样适用)——子任务/阶段边界会由
  // runSubtask/persistStage 刷新为更近的单元基线。
  const strict = strictResumeActive(opts, switches)
  if (strict) chain.baseline = await unitBaseline(dir)
  // 中断恢复(进度记录): 会话半途未总结(active)且 server 上仍存在 → 复用原会话
  // 继续(与 opencode -r 同构,上下文不丢);优雅退出的总结记录、会话已不可用、
  // --new-session 显式放弃 → 新会话。两种情况首个提示词均附"[driver] 中断后的继续"
  // 说明(含按阶段的下一步指引)。
  // 交接文件优先于会话复用: 中断前会话已写出交接文档(ondemand/auto 子任务的
  // handoff.md 或 --handover-test 的 testhandoff.md)时,旧会话上下文已用满、
  // 进度由文档承载——开新会话凭交接续跑(executeWhole/runSubtask/runExecSession
  // 据文件播种 continuation)。
  // 严格恢复: rolledBack 非空 = 恢复时已回滚到单元基线( CURRENT.md 镜像改带
  // 回滚备注,新会话冷启动重做、不附恢复说明)。
  let rolledBack: string | undefined
  const recalled = await recallProgress(dir, task.id)
  if (recalled) {
    chain.phase = recalled.phase
    // 单元归属门禁(unitReruns): 中断会话属于某个具体执行单元(任务级阶段/子任务
    // #N/修复检查项#N),仅当本次运行将重跑该单元才允许复用其会话;否则(单元已过、
    // 配置/开关变更使其不再执行、老记录缺序号无法判定归属)记录转总结态、开新会话
    // ——防已进入下一单元时误续上一单元的中断会话。
    let rerun = true
    if (recalled.active === true) {
      const fresh = requireTask(await load(plan.path), task.id)
      const planDir = dirname(plan.path)
      const exempt = Boolean(parseFinalMark(fresh.final)) || opts.phase === "v"
      const bodyItems = subtasks(fresh.body)
      // 子任务目录状态协议激活时,单元归属判定按 done.md 存在性(进度事实)而非
      // PLAN.md 勾选(展示轨)——plans/0030 D10。
      const scan = await scanSubtaskStates(planDir, task.id, bodyItems.length)
      const doneFlags = effectiveDone(scan, bodyItems)
      rerun = unitReruns(recalled.phase, {
        mode,
        fork: switches.fork,
        items: bodyItems.map((item, i) => ({ text: item.text, done: doneFlags[i] ?? item.done })),
        subtasksFileItems: subtasks(await Bun.file(join(planDir, await resolveTaskDoc(planDir, task.id, "subtasks"))).text().catch(() => "")).length,
        wrapup: opts.wrapup ?? true,
        verify: opts.verify === true && !exempt,
        review: !exempt && (opts.review ?? 0) > 0,
      })
      if (!rerun) {
        await saveProgress(dir, { ...recalled, active: false })
        recalled.active = false
      }
    }
    const handoffRaw =
      mode !== "off" ? await Bun.file(join(dir, await resolveTaskDoc(dir, task.id, "handoff"))).text().catch(() => undefined) : undefined
    const handedOff =
      recalled.active === true && (handoffRaw !== undefined || (opts.handoverTest === true && (await testHandoffExists(dir, task))))
    // 严格恢复(plans/0022-session-recovery-fidelity-design.md 3.3): 交接文档在场但无有效状态行
    // (低质)→ R3 触发,回滚重跑,不凭文档续跑;需基线在册才可回滚。
    const handoffInvalid =
      strict &&
      recalled.active === true &&
      rerun &&
      handoffRaw !== undefined &&
      handoffStatus(handoffRaw) === undefined &&
      recalled.baseline !== undefined
    // 严格恢复: 无基线的旧记录(开关启用前写入)无法严格核对,按不可复用处理。
    const legacyRecord = strict && recalled.baseline === undefined
    const alive =
      !handedOff && !opts.newSession && recalled.active && recalled.session && !legacyRecord && (await sessionAlive(client, recalled.session))
    // 继承中断会话的真实上下文用量(经末条 assistant 消息重建): 此前 seed 为
    // 0/0 占位以保证首个提示词必定复用,代价是恢复后的日志与链内后续复用决策
    // 全用假值;首轮复用现由 attempt 的 resumed 判据保证,这里只取真实值。
    const usage = alive ? await sessionUsage(client, recalled.session!) : undefined
    // 双保险(plans/0015-session-error-retry-plan.md 第 5 点): 历史遗留的 progress.json 可能
    // 记着一个只挨了一记报错、从未真正产出过内容的会话(旧版"重试即换白板会话"
    // 逻辑的残留:整条会话没有任何跑完过的 assistant 轮次,只有报错桩)。有了第
    // 3/4 点的修复后理论上不会再产生这种记录,此处仅兜底改造上线前生成的旧文件。
    // 注意判据不能只看末条:撞不可重试错误死掉的长会话(第 3/4 点刻意保住的正是
    // 它)末行也是报错桩,判据落在 sessionUsage 的 basis 扫描上。
    const errorStub = usage !== undefined && usage.used === 0 && usage.errorStub
    // 严格核对与回滚(3.1 ③④ + 3.3): 只对 active、将重跑、未交接、基线在册的记录
    // 生效;回滚后记录转总结态(复用既有的"非恢复续跑"语义——pipeline 清理陈旧
    // 交接文档、下一单元以干净基线启动),新会话冷启动重做,不附恢复说明。
    if (handoffInvalid) {
      const done = await rollbackUnitState(dir, task, "execution unit (invalid handover document)", recalled.baseline!, { progress: recalled })
      if (done.type !== "ok") return done
      rolledBack = done.remark
      recalled.active = false
      log(`↻ ${task.id} resume after interruption: handover document ${handoffFile(task)} exists but has no valid status line; strict resume judged unfaithful, rolled back and re-running`)
    } else if (strict && recalled.active === true && rerun && !handedOff && recalled.baseline) {
      const drift = await baselineIntact(dir, recalled.baseline)
      if (drift.length) {
        // 外部提交混入: 不回滚(回滚只回收 driver 自己的单元内改动),dirty 交人工。
        return { type: "dirty", files: drift }
      }
      const modelNow = resumeModelNow(opts, switches, recalled.phase)
      const modelOk = recalled.model !== undefined && recalled.model === modelNow
      if (!(alive && usage && !errorStub) || opts.newSession || !modelOk) {
        const why = opts.newSession
          ? "--new-session specified"
          : !(alive && usage)
            ? "original session not reusable"
            : errorStub
              ? "original session only hit an error, no real output"
              : `model mismatch (recorded ${recalled.model}, current ${modelNow ?? "no routing configured"})`
        const done = await rollbackUnitState(dir, task, "execution unit", recalled.baseline!, { progress: recalled })
        if (done.type !== "ok") return done
        rolledBack = done.remark
        recalled.active = false
        log(`↻ ${task.id} resume after interruption: ${phaseText(recalled.phase)}(${why}); strict resume judged unfaithful, rolled back to the unit baseline and redone`)
      }
    }
    if (!rolledBack) {
      if (alive && usage && !errorStub) {
        chain.id = recalled.session!
        chain.pct = usage.pct
        chain.used = usage.used
        // 复用决策已在此做出;链内后续的 5 分钟复用规则从当前时刻起算。
        chain.at = Date.now()
        chain.note = resumeNote(recalled.phase, true, strict)
        log(
          `↻ ${task.id} resume after interruption: ${phaseText(recalled.phase)}, reusing the interrupted session ${recalled.session} to continue (context intact, ` +
            `${formatTokens(usage.used)} used${usage.limit ? `/${formatTokens(usage.limit)} tokens, ${usage.pct}%` : " tokens, limit unknown"})`,
        )
      } else {
        // --new-session 显式放弃旧会话: 立即把记录转总结态,防止本次运行在无会话
        // 阶段(如 verify 脚本执行)中断后,下次运行误复用与已推进阶段错位的旧会话。
        if (opts.newSession && recalled.active) {
          await saveProgress(dir, { ...recalled, active: false })
        }
        chain.note = resumeNote(recalled.phase, false, strict)
        const why = !rerun
          ? "the interrupted session's execution unit will not re-run this time (already done or no longer executing); its resume point is obsolete, starting a new session to continue"
          : handedOff
            ? "a handover document was written before the interruption; starting a new session to continue from the handover"
            : opts.newSession
              ? "--new-session specified; starting a new session to continue"
              : legacyRecord
                ? "the legacy record predates strict resume and has no unit baseline, so strict verification is impossible; starting a new session to continue"
                : errorStub
                  ? "the original session only hit an error with no real output; starting a new session to continue"
                  : "the original session is not reusable; starting a new session to continue"
        log(`↻ ${task.id} resume after interruption: ${phaseText(recalled.phase)}(${why})`)
      }
    }
  }
  // Mirror the task into CURRENT.md before the first session: the agent
  // contract requires every session to read it first.
  task = requireTask(await load(plan.path), task.id)
  await writeCurrent(plan.path, task, mode !== "auto", rolledBack)
  // 阶段持久化: 每个阶段边界推进记录(active=false,总结态);执行链会话开始/结束
  // 时由 attempt 刷新为 active=true(半途态)——此刻中断按"未总结"复用会话。
  // 严格恢复时同步刷新链上单元基线: 回滚锚点跟随阶段边界收紧(基线..HEAD 只含
  // driver 提交时更近的基线与更远的基线核对等价,回滚半径更小)。
  const persistStage = async (phase: Phase) => {
    chain.phase = phase
    if (strict) chain.baseline = await unitBaseline(dir)
    if (opts.dir && task.id.startsWith("T-")) {
      await saveProgress(opts.dir, { task: task.id, session: chain.id, at: Date.now(), active: false, phase })
    }
  }
  const outcome = await pipeline(recalled?.phase)
  if (outcome.type === "completed") {
    // 终态改名: 链上最后一个会话标题指向 done 标签(与 loop 的终态提交同题)。
    await renameSession(client, chain, `${task.id} done ${task.title}`)
    await removeCurrent(plan.path)
    await forgetProgress(dir)
    return outcome
  }
  // 非完成结局(阻塞/回退 pending)时终结当前进展: CURRENT.md 写中断备注后保留,
  // 供人工查看与下次恢复(下次 runTask 重建镜像时,备注要点经恢复提示词带给 AI)。
  // 会话错误类(网络重试耗尽)保持 active 记录供恢复复用(会话半途无法总结);
  // 其余清除复用资格(进度已总结,人工介入可能耗时且改动环境,旧会话上下文不可信),
  // 阶段信息保留供精确重入。会话标题同步改名为中断状态(与 loop 边界提交同题)。
  task = requireTask(await load(plan.path), task.id)
  await renameSession(client, chain, `${task.id} ${outcome.type === "incomplete" ? "pending" : "blocked"} ${task.title}`)
  await writeCurrent(plan.path, task, mode !== "auto", interruptionRemark(outcome, chain.phase))
  if (!(outcome.type === "blocked" && outcome.question.startsWith("session error: "))) {
    await persistStage(chain.phase ?? (mode === "auto" ? { kind: "decompose" } : { kind: "whole" }))
  }
  return outcome

  // 任务流水线(闭包,持 client/plan/task/opts/chain): resume 为恢复记录的阶段
  // 标记,用于精确重入;一次性旗标(enterAudit/skipWrapup/fastFix/pendingVerify)
  // 仅影响恢复后的首轮,之后回归常规循环。
  async function pipeline(resume?: Phase): Promise<Outcome> {
    // 交接文档的现场复原(测试交接中断恢复 F3): 必须无条件、且早于任何执行单元的
    // clean 门禁——上一次运行的陈旧清理可能把已落账的在途交接文档删掉,那道删除
    // 本身就是脏区,门禁会当场阻塞。复原即消脏。
    if (opts.testByDriver) await restoreTestHandoffs(dir, task)
    // 阶段精确重入: 记录显示已推进到收尾及之后 → off/ondemand 跳过执行阶段
    // (不重跑整任务会话;auto 的分解/子任务循环本就幂等,无需特判)。
    const resumed = resume?.kind
    // fork 基点(fork-decompose 设计 §4.2): 仅 fork=on 的 auto 模式确立;digest
    // 模式持久基点(PLAN.md fork-base 字段,digest: 前缀)存活即复用、失效才从
    // context.md 重建,session 模式沿用/校验 fork-base 字段,失败沿回退链
    // (digest → session → 冷启动)降级,undefined = 冷启动。
    let fork: ForkBaseInfo | undefined
    if (mode === "auto") {
      const sw = autoSwitches()
      // 合并理解与分解会话(M1.0,plans/0030): 任务体无检查项时进入(已有人工
      // 检查项的任务跳过,现状不变);单会话产出 context.md + shared.md +
      // subtasks.md + 各子任务 todo.md;subtasks.md 已有检查项(中断恢复/旧版
      // 遗留)时幂等直注。会话成功后 driver 记录 fork-base(session 模式即最终
      // 基点;digest 模式随后由基点确认会话覆写)。
      await persistStage({ kind: "decompose" })
      const decomposed = await ensureDecomposed(client, plan, task, opts, chain)
      if (decomposed.type !== "ok") return decomposed
      task = decomposed.task
      // ①′(digest)/基点校验(session)——此后每个子任务都从同一基点分叉
      // (fork=off 时 fork 恒为 undefined,行为与现状零差异)。
      fork = sw.fork ? await ensureForkBase(client, plan, task, opts, chain) : undefined
      // 子任务交接文档的陈旧清理(镜像 ondemand 语义): 非恢复续跑时清除上次尝试
      // 遗留;恢复续跑(active 记录)时保留,由子任务会话凭交接续跑。只删未被 git
      // 跟踪的份(F4 同款): 已跟踪的 handoff.md 必属未收口的执行单元(单元收口时
      // 删除随提交落账,盘上与 HEAD 同时消失;检查项按序执行,未收口单元必是首个
      // 未勾选项),保留给重跑的子任务凭交接续跑——无条件删它只会制造脏区,把下一
      // 单元的 clean 门禁撞停后陷入"人工恢复→再删→再阻塞"的循环(T-028 同类现场)。
      if (recalled?.active !== true) {
        await removeIfUntracked(dirname(plan.path), handoffFile(task))
        // 旧平铺交接文档(docs/<id>.handoff.md)兼容清扫: 写目标已目录化,遗留
        // 旧文件一并移除,防读回落误续跑陈旧交接。
        await removeIfUntracked(dirname(plan.path), legacyTaskDoc(task.id, "handoff"))
        // --handover-test 的测试交接文档同理(任务级与子任务级一并清): runExecSession
        // 的交接循环在一次 runTask 调用内闭环,跨调用的遗留文档属陈旧状态;auto 模式
        // 不进整任务分支,清理须在此覆盖,否则陈旧交接会被下一子任务误读续跑。
        if (opts.testByDriver) await cleanTestHandoffs(plan.path, task)
      }
    } else if (resumed !== "wrapup" && resumed !== "verify" && resumed !== "review") {
      // 非恢复续跑才清除上次尝试遗留的交接文档;恢复时保留(其中是中断会话的进度
      // 总结,executeWhole 依其 `状态:` 行决定续跑)。同样只删未被 git 跟踪的份
      // (理由同 auto 分支: 已跟踪的属未收口单元的在途状态,删它即脏区)。
      if (mode === "ondemand" && recalled?.active !== true) {
        await removeIfUntracked(dirname(plan.path), handoffFile(task))
        // 旧平铺交接文档兼容清扫(与 auto 分支同语义)。
        await removeIfUntracked(dirname(plan.path), legacyTaskDoc(task.id, "handoff"))
      }
      // --handover-test 的测试交接文档同理: 非恢复续跑时清除上次尝试遗留
      // (任务级与子任务级一并清;恢复续跑(active 记录)时保留,由续跑会话消费)。
      if (opts.testByDriver && recalled?.active !== true) {
        await cleanTestHandoffs(plan.path, task)
      }
      await persistStage({ kind: "whole" })
      const blocked = await executeWhole(client, plan, task, opts, chain, mode === "ondemand")
      if (blocked) return blocked
      task = requireTask(await load(plan.path), task.id)
    }
    await persistStage({ kind: "subtasks" })
    await writeCurrent(plan.path, task, mode !== "auto")

    // 终审任务(final 字段)与 v(验收)阶段任务本身即检验: 共用同一豁免路径,
    // 强制 review=0 且跳过三段式验收,不对检验再做检验(--early 随之自然失效);
    // v 豁免为内部标记(opts.phase),不写 final 字段、不污染 PLAN.md 协议
    // (设计文档 B.6 与 plans/0006-phases-design.md D.3)。终审任务报告缺失/协议非法由路由时
    // brokenReport 阻塞兜底。
    const finalMark = parseFinalMark(task.final)
    const exempt = Boolean(finalMark) || opts.phase === "v"
    const limit = exempt ? 0 : (opts.review ?? 0)
    // --verify 未启用(或豁免强制关闭): 略过三段式验收(early 依赖的脚本执行
    // 窗口随之不存在),收尾后由 driver 直接标 done;--review 的质量审核改为此时
    // 串行执行。
    const verifyOn = opts.verify === true && !exempt
    // --early(设计文档 F.2/F.5): review 启用时把审核会话挪进 verify 脚本执行
    // 窗口并行,verifyTask 经挂点启动并随 done 带回 audit 结论。
    const early = opts.early && limit > 0 && verifyOn
    // 恢复重入旗标(仅首轮生效):
    // - review/audit → 验收已过,直接补跑审核会话;
    // - verify → verifyTask 内部按 stage/run 精确恢复;
    // - review/planfix 且修复检查项文件已有效 → 跳到注入分支(round 已是记录值);
    //   文件无效(规划会话半途中断,差距原文已丢失)→ 退回重跑审核重新发现差距,
    //   round 回退 1 使审核后的 round++ 回到记录值。
    const resumedReview = resume?.kind === "review" ? resume : undefined
    // 修复检查项文件(目录化布局,读回落兼容旧平铺 docs/<id>.fix.md)。
    const fixFile = join(dirname(plan.path), await resolveTaskDoc(dirname(plan.path), task.id, "fix"))
    const fixItems = subtasks(await Bun.file(fixFile).text().catch(() => "")).map((item) => item.text)
    const fixReady = resumedReview?.stage === "planfix" && fixItems.length > 0
    const replan = resumedReview?.stage === "planfix" && !fixReady
    // limit=0(--review 未启用或终审任务强制关闭)时补跑审核没有意义: 陈旧的
    // review 阶段恢复记录不再开审核会话,按常规循环走完直接完成。
    let enterAudit = limit > 0 && resumedReview !== undefined && (resumedReview.stage === "audit" || replan)
    let skipToInject = fixReady
    let skipWrapup = resume?.kind === "verify" || enterAudit
    let pendingVerify = resume?.kind === "verify" ? resume : undefined
    // 修复检查项注入是 driver 状态写入(PLAN.md 检查项 + CURRENT.md 镜像),注入后
    // 立即统一提交——下一个执行单元(fixrun 检查项)的启动 clean 门禁据此成立
    // (plans/0021-commit-boundary-design.md P3);提交失败即阻塞,planfix 产物不算落账。
    const injectFix = async (items: string[], round: number): Promise<{ type: "blocked"; question: string } | undefined> => {
      const prevCount = subtasks(task.body).length
      await appendSubtasks(plan.path, task.id, items)
      // 子任务目录状态协议(plans/0030 D9): 协议已激活的任务,为每个注入的修复
      // 检查项补 DRIVER 侧最小 todo.md,维持「每个检查项恰有一个状态文件」不变量;
      // 协议未激活(旧版分解/人工检查项)保持纯勾选语义。todo.md 随注入同一次提交
      // 落账(下方 commitTree)。
      if ((await scanSubtaskStates(dir, task.id, prevCount)).active) {
        for (let k = 0; k < items.length; k++) await writeInjectedTodo(dir, task.id, prevCount + k + 1, items[k]!)
      }
      await persistStage({ kind: "review", round, stage: "fixrun" })
      task = requireTask(await load(plan.path), task.id)
      await writeCurrent(plan.path, task, mode !== "auto")
      if (opts.commit !== false && !opts.dryrun) {
        const committed = await commitTree(dir, task, { stage: "review-fix", subject: `${task.id} planfix ${task.title} fix-checklist injection` })
        if (!committed.ok) {
          return commitBlocked(`${task.id} fix-checklist injection`, {
            type: "failed",
            question: `unified commit failed: ${committed.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. Changes are kept in the worktree; handle git manually and re-run.`,
          })
        }
      }
      return undefined
    }
    for (
      let round = resumedReview ? (replan ? resumedReview.round - 1 : resumedReview.round) : 0;
      ;
    ) {
      if (skipToInject) {
        // planfix 恢复: 规划会话已产出有效检查项文件,直接注入后进入 fixrun。
        skipToInject = false
        log(`↻ ${task.id} resume after interruption: fix checklist ${fixFile} is already valid, injecting directly (round ${round}/${limit})`)
        const injected = await injectFix(fixItems, round)
        if (injected) return injected
        continue
      }
      let audit: Verdict | UnitStop
      if (enterAudit) {
        // review/audit 恢复: 任务级验收已通过(任务可能已被 loop 置回 in_progress),
        // 直接补跑质量审核会话。
        audit = await reviewTask(client, plan, task, opts)
      } else {
        // auto 模式此处执行分解出的检查项(含 review 注入的 fix 检查项);
        // off/ondemand 模式只有正文中人工编写的检查项。
        for (;;) {
          const items = subtasks(task.body)
          // 子任务目录状态协议(M1.0,plans/0030): 协议激活(任一 todo/done 文件
          // 存在)时,done.md 存在性覆盖勾选成为进度事实;非法态(两者同存/同缺)
          // 检出即阻塞交人工;勾选漂移按文件状态 reconcile(文件为准,展示轨跟随)。
          const scan = await scanSubtaskStates(dir, task.id, items.length)
          if (scan.illegal.length) {
            return {
              type: "blocked",
              question:
                `${task.id} subtask state files are illegal (${scan.illegal
                  .map((v) => `S${String(v.index).padStart(2, "0")}: ${v.kind === "both" ? "both todo.md and done.md exist" : "neither todo.md nor done.md exists"}`)
                  .join("; ")}). Resolve the docs/${task.id}/S<nn>/ state files manually and re-run.`,
            }
          }
          const doneFlags = effectiveDone(scan, items)
          const index = doneFlags.findIndex((done) => !done)
          if (index === -1) break
          if (scan.active && items.some((item, i) => item.done !== doneFlags[i])) {
            await syncSubtaskTicks(plan.path, task.id, doneFlags)
            task = requireTask(await load(plan.path), task.id)
          }
          // 进度记录标注归属子任务(1 起序号): attempt 下发成功即随记录落盘,恢复时
          // 经单元归属门禁(unitReruns)仅当该子任务将重跑才复用其会话。review 修复轮
          // (fixrun)保持 review 阶段标记(round/stage 供精确重入),仅追加序号。
          const loopPhase: Phase = chain.phase?.kind === "review" ? chain.phase : { kind: "subtasks" }
          chain.phase = { ...loopPhase, index: index + 1 }
          // 恢复续跑判定(active 记录恰归属本检查项): 中断现场的工作区脏区是本单元
          // 自身进度,runSubtask 的启动 clean 门禁据此豁免(plans/0021-commit-boundary-design.md)。
          const recalledPhase = recalled?.active === true ? recalled.phase : undefined
          const resumeUnit =
            recalledPhase !== undefined &&
            recalledPhase.kind !== "step" &&
            "index" in recalledPhase &&
            recalledPhase.index === index + 1 &&
            (recalledPhase.kind === "subtasks"
              ? loopPhase.kind === "subtasks"
              : recalledPhase.kind === "review" && loopPhase.kind === "review" && recalledPhase.stage === "fixrun")
          const blocked = await runSubtask(client, plan, task, items[index].text, index + 1, opts, chain, fork, resumeUnit)
          if (blocked) return blocked
          // 勾选后的镜像刷新已在 runSubtask 内于统一提交前完成,这里只重读任务。
          task = requireTask(await load(plan.path), task.id)
          // 子任务已收口(勾选+统一提交): 进度记录刷新为总结态(active=false,剥离
          // 序号)——子任务间歇(步进暂停/回试处理)期间中断不再遗留"半途未总结"的
          // 上一单元会话,恢复时不会被下一单元误续。
          await persistStage(loopPhase)
          // 步进暂停(subtask 边界,OPENCODE_AUTO_STEP=subtask): 检查项勾选与统一
          // 提交完成后、下一检查项前硬暂停(review 注入的 fix 检查项同循环,一并覆盖)。
          // dir 传入使暂停等待从用时统计扣除(STATS_PLAN §3)。
          await stepPause("subtask", `${task.id} subtask ${index + 1}`, { interactive: opts.interactive, dir })
          maybeExit("subtask", `${task.id} subtask ${index + 1}`)
          // Hibernate window (subtask boundary, OPENCODE_AUTO_HIBERNATE): a safe
          // spot to check after check-off + unified commit; sleep until wake
          // inside the window before continuing (plans/0027-hibernate-design.md).
          await hibernatePause(`${task.id} subtask ${index + 1} boundary`, { dir })
          // failback 回试(OPENCODE_AUTO_MODEL_FAILBACK_SCOPE): subtask/session 粒度
          // 在子任务边界清链上降级候选,下一子任务回试首选(task 粒度由链逐任务销毁
          // 天然承担);/failback 请求同点消费(可整体重定义模型序)。
          if (failbackApplies(switches.modelFailbackScope, "subtask")) chain.model = undefined
          consumeFailback(chain)
        }
        // 收尾会话: verify/review(audit) 阶段恢复时跳过(此前已完成,重跑纯浪费);
        // config.wrapup=false(--no-wrapup,缺省 true)时整体关闭。report.md 存在性 +
        // 形检门禁在 runWrapup 内(session-boundary-hardening §4.5 D5,S3b)。
        if (!skipWrapup && (opts.wrapup ?? true)) {
          await persistStage({ kind: "wrapup" })
          const stopped = await runWrapup(client, plan, task, opts, chain, { solo: mode !== "auto", label: "wrapup session" })
          if (stopped) return stopped
        }
        skipWrapup = false
        let auditFromVerify: Verdict | undefined
        if (verifyOn) {
          // 三段式验收自带修复轮(差距反馈回执行会话链,≤ FIX_ROUNDS);
          // gap 只在 off 模式出现(该模式不修复,回退 pending 等人工改进)。
          // early 时审核挂点并行进脚本执行窗口,结论随 done 带回。
          const verdict = await verifyTask(
            client,
            plan,
            task,
            opts,
            chain,
            early ? () => reviewTask(client, plan, task, opts, true) : undefined,
            persistStage,
            pendingVerify,
          )
          pendingVerify = undefined
          if (verdict.type === "blocked" || verdict.type === "dirty") return verdict
          if (verdict.type === "gap") {
            await setStatus(plan.path, task.id, "pending")
            return { type: "incomplete", reason: verdict.gap }
          }
          auditFromVerify = verdict.audit
        } else {
          log(
            finalMark
              ? `⏭ ${task.id} final-review tasks skip task-level verify (the stage itself is the check); completing directly`
              : opts.phase === "v"
                ? `⏭ ${task.id} v (verify) phase tasks skip task-level verify (the phase itself is the check); completing directly`
                : `⏭ ${task.id} --verify is not enabled; skipping task-level verify, completing directly`,
          )
          await markDone(plan.path, task.id)
        }
        if (limit <= 0) return { type: "completed" }
        await persistStage({ kind: "review", round, stage: "audit" })
        // early 的审核结论已随 verifyTask 带回(挂点在每次脚本执行前重开,done 必有
        // 结论);其余情况(未启用 --verify 或非 early)在此时串行开审核会话。
        audit = auditFromVerify ?? (await reviewTask(client, plan, task, opts))
      }
      enterAudit = false
      if (audit.type === "blocked" || audit.type === "dirty") return audit
      if (audit.type === "pass") return { type: "completed" }

      // off 模式不做审核修复循环: 与该模式 verify 失败语义一致。
      if (mode === "off") {
        await setStatus(plan.path, task.id, "pending")
        return { type: "incomplete", reason: audit.gap }
      }
      round++
      if (round > limit) {
        return { type: "blocked", question: `quality review still failing after ${limit} consecutive fix round(s):\n${audit.gap}` }
      }
      // verifyTask 通过时已把任务标 done;审核发现差距须先置回 in_progress,
      // 否则中断重跑时 next() 会跳过该任务,注入的 fix 检查项永不执行。
      await setStatus(plan.path, task.id, "in_progress")
      log(`↻ ${task.id} quality review failed; planning fix subtasks and continuing (round ${round}/${limit}):\n${audit.gap}`)
      await persistStage({ kind: "review", round, stage: "planfix" })
      const planned = await planReviewFix(client, plan, task, opts, audit.gap)
      if (planned.type !== "ok") return planned
      const injected = await injectFix(planned.items, round)
      if (injected) return injected
    }
  }
}

// --dryrun 的单次独立会话: 不属于任何任务,不进任何链,也不做会话后提交
// (预检不改动工作区)。
export async function runOnce(
  client: OpencodeClient,
  title: string,
  promptText: string,
  opts: Opts,
): Promise<SessionResult> {
  return runSession(client, pseudoTask("AUTO", title), promptText, opts, { pct: 100, used: 0, at: 0 })
}

function pseudoTask(id: string, title: string): Task {
  return { id, title, status: "in_progress", attempts: 0, body: "" }
}

// 壳包兼容再导出(plans/0024-module-split-plan.md §D.3,S12 收敛): runner.ts 不再是万能入口,
// 包内模块与单测一律从符号所在模块精确导入;此处只保留壳包经 `runner` 子路径的既有
// 消费面(PermissionMode / SubtaskMode 类型与 requireArtifact),壳分支零改动。
export type { PermissionMode, SubtaskMode } from "./opts"
export { requireArtifact } from "./artifact"
