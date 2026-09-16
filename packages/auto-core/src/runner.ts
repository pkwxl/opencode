import { rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { type ForkBaseInfo, type SessionChain, type SessionResult } from "./chain"
import { requireArtifact } from "./artifact"
import { writeCurrent, removeCurrent } from "./current"
import { afterSession, commitBlocked, gatedTaskRefGap, resumeModelNow, rollbackUnitState, strictResumeActive, wrapupResolves } from "./unit-commit"
import { archivedTestHandoff, latestHandoffSeq, legacySubtaskTestHandoff, legacyTaskDoc, resolveSubtaskDoc, resolveTaskDoc, taskDoc } from "./docpaths"
import { maybeExit } from "./exit"
import { consumeFailback, failbackApplies } from "./failback"
import { baselineIntact, beginUnit, commitTree, fileCommitted, suffixedTitle, trackedSourceChanges, unitBaseline, type UnitBaseline } from "./git"
import { forgetHandover, handoffStatus, handoverStage, recallHandover, saveHandover, type Handover } from "./handover"
import { autobanner, log, subbanner } from "./log"
import { DEFAULT_CONTEXT_LIMIT, FIX_ROUNDS, REVERIFY_ROUNDS, type Opts, type Outcome, type UnitStop } from "./opts"
import { interruptionRemark, phaseText, resumeNote, unitReruns } from "./resume-gate"
import { ensureForkBase, runSession } from "./session"
import {
  appendSubtasks,
  begin,
  load,
  markDone,
  parse,
  parseFinalMark,
  setForkBase,
  setStatus,
  setSubtasks,
  subtasks,
  tick,
  verifyCommand,
  type Plan,
  type Task,
} from "./plan"
import {
  handoffFile,
  renderDecompose,
  renderFix,
  renderReview,
  renderReviewFix,
  renderSubtask,
  renderTestContinue,
  renderTestWrapup,
  renderUnderstand,
  renderVerifyJudge,
  renderVerifyScriptGen,
  renderWhole,
  renderWrapup,
  REVIEW_FILE,
  testHandoffFile,
  VERDICT_FILE,
  type VerifyRun,
} from "./prompt"
import { allowWrite, reprotect } from "./protect"
import { forgetProgress, peekProgress, recallProgress, saveProgress, type Phase } from "./resume"
import { forkSession, formatTokens, renameSession, seedForkSession, sessionAlive, sessionUsage, sessionUsed } from "./session-api"
import { autoSwitches } from "./switches"
import { stepPause } from "./step"
import {
  archiveHandoff,
  cleanTestHandoffs,
  fillHandoffStatus,
  handoffSteer,
  handoverDue,
  latestTestScript,
  latestTestSeq,
  removeHandoffChain,
  restoreTestHandoffs,
  runTestScript,
  TEST_HANDOVER_ADVISORY,
  testHandoffExists,
  type Steer,
  type TestRun,
} from "./testrun"
import { resolveVerifyScript, runVerifyScript, verifyTmpDir } from "./verify"

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
  // 实验开关(OPENCODE_AUTO_* 环境变量层,fork-decompose-design.md §4.6): 入口
  // 解析一次(memo)——非法值在此抛出中文报错(CLI 侧退出码 1),非默认组合记入
  // 启动日志(默认组合静默,verbose 可查全量);fork/forkBase 由 fork 流水线消费,
  // 本层只做解析与既有机制接线(fine/steer);failback 粒度在子任务边界消费。
  const switches = autoSwitches()
  await begin(plan.path, task.id)
  const dir = opts.dir ?? dirname(plan.path)
  const mode = opts.subtask ?? "auto"
  const chain: SessionChain = { pct: 100, used: 0, at: Date.now() }
  // 严格恢复(session-recovery-fidelity-design.md): on 时记录携带单元基线/生效模型、
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
      rerun = unitReruns(recalled.phase, {
        mode,
        fork: switches.fork,
        items: subtasks(fresh.body),
        contextExists: (await Bun.file(join(planDir, await resolveTaskDoc(planDir, task.id, "context"))).text().catch(() => "")).trim().length > 0,
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
    // 严格恢复(session-recovery-fidelity-design.md 3.3): 交接文档在场但无有效状态行
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
    // 双保险(session-error-retry-plan.md 第 5 点): 历史遗留的 progress.json 可能
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
      const done = await rollbackUnitState(dir, task, "执行单元(交接文档无效)", recalled.baseline!, { progress: recalled })
      if (done.type !== "ok") return done
      rolledBack = done.remark
      recalled.active = false
      log(`↻ ${task.id} 恢复中断: 交接文档 ${handoffFile(task)} 存在但无有效状态行,严格恢复判定不可保真,已回滚重跑`)
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
          ? "--new-session 指定"
          : !(alive && usage)
            ? "原会话不可复用"
            : errorStub
              ? "原会话只挨了一记报错、无真实产出"
              : `模型不一致(记录 ${recalled.model},当前 ${modelNow ?? "未配置路由"})`
        const done = await rollbackUnitState(dir, task, "执行单元", recalled.baseline!, { progress: recalled })
        if (done.type !== "ok") return done
        rolledBack = done.remark
        recalled.active = false
        log(`↻ ${task.id} 恢复中断: ${phaseText(recalled.phase)}(${why}),严格恢复判定不可保真,已回滚到单元基线重做`)
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
          `↻ ${task.id} 恢复中断: ${phaseText(recalled.phase)},复用中断的会话 ${recalled.session} 继续(上下文不丢,` +
            `已用 ${formatTokens(usage.used)}${usage.limit ? `/${formatTokens(usage.limit)} tokens,${usage.pct}%` : " tokens,上限未知"})`,
        )
      } else {
        // --new-session 显式放弃旧会话: 立即把记录转总结态,防止本次运行在无会话
        // 阶段(如 verify 脚本执行)中断后,下次运行误复用与已推进阶段错位的旧会话。
        if (opts.newSession && recalled.active) {
          await saveProgress(dir, { ...recalled, active: false })
        }
        chain.note = resumeNote(recalled.phase, false, strict)
        const why = !rerun
          ? "中断会话所属的执行单元本次不会重跑(已完成或不再执行),其恢复点已淘汰,开新会话继续"
          : handedOff
            ? "中断前已写出交接文档,开新会话凭交接续跑"
            : opts.newSession
              ? "--new-session 指定,开新会话继续"
              : legacyRecord
                ? "严格恢复启用前的旧记录无单元基线,无法严格核对,开新会话继续"
                : errorStub
                  ? "原会话只挨了一记报错、无真实产出,开新会话继续"
                  : "原会话不可复用,开新会话继续"
        log(`↻ ${task.id} 恢复中断: ${phaseText(recalled.phase)}(${why})`)
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
  if (!(outcome.type === "blocked" && outcome.question.startsWith("会话错误:"))) {
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
    // 模式从 context.md 重建基点会话,session 模式沿用/校验 PLAN.md fork-base 字段,
    // 失败沿回退链(digest → session → 冷启动)降级,undefined = 冷启动。
    let fork: ForkBaseInfo | undefined
    if (mode === "auto") {
      const sw = autoSwitches()
      // ① 理解阶段: 任务体无检查项且 fork=on 才进入(已有人工检查项的任务跳过,
      // 现状不变);摘要文件已存在(中断恢复/上一轮遗留)时幂等跳过。
      if (sw.fork && !subtasks(task.body).length) {
        await persistStage({ kind: "understand" })
        const understood = await ensureUnderstood(client, plan, task, opts, chain)
        if (understood.type !== "ok") return understood
        task = understood.task
      }
      // ①′(digest)/基点校验(session)——此后 decompose 与每个子任务都从同一
      // 基点分叉(fork=off 时 fork 恒为 undefined,行为与现状零差异)。
      fork = sw.fork ? await ensureForkBase(client, plan, task, opts, chain) : undefined
      await persistStage({ kind: "decompose" })
      const decomposed = await ensureDecomposed(client, plan, task, opts, chain, fork)
      if (decomposed.type !== "ok") return decomposed
      task = decomposed.task
      // 子任务交接文档的陈旧清理(镜像 ondemand 语义): 非恢复续跑时清除上次尝试
      // 遗留;恢复续跑(active 记录)时保留,由子任务会话凭交接续跑。
      if (recalled?.active !== true) {
        await rm(join(dirname(plan.path), handoffFile(task)), { force: true })
        // 旧平铺交接文档(docs/<id>.handoff.md)兼容清扫: 写目标已目录化,遗留
        // 旧文件一并移除,防读回落误续跑陈旧交接。
        await rm(join(dirname(plan.path), legacyTaskDoc(task.id, "handoff")), { force: true })
        // --handover-test 的测试交接文档同理(任务级与子任务级一并清): runExecSession
        // 的交接循环在一次 runTask 调用内闭环,跨调用的遗留文档属陈旧状态;auto 模式
        // 不进整任务分支,清理须在此覆盖,否则陈旧交接会被下一子任务误读续跑。
        if (opts.testByDriver) await cleanTestHandoffs(plan.path, task)
      }
    } else if (resumed !== "wrapup" && resumed !== "verify" && resumed !== "review") {
      // 非恢复续跑才清除上次尝试遗留的交接文档;恢复时保留(其中是中断会话的进度
      // 总结,executeWhole 依其 `状态:` 行决定续跑)。
      if (mode === "ondemand" && recalled?.active !== true) {
        await rm(join(dirname(plan.path), handoffFile(task)), { force: true })
        // 旧平铺交接文档兼容清扫(与 auto 分支同语义)。
        await rm(join(dirname(plan.path), legacyTaskDoc(task.id, "handoff")), { force: true })
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
    // (设计文档 B.6 与 phases-design.md D.3)。终审任务报告缺失/协议非法由路由时
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
    // (commit-boundary-design.md P3);提交失败即阻塞,planfix 产物不算落账。
    const injectFix = async (items: string[], round: number): Promise<{ type: "blocked"; question: string } | undefined> => {
      await appendSubtasks(plan.path, task.id, items)
      await persistStage({ kind: "review", round, stage: "fixrun" })
      task = requireTask(await load(plan.path), task.id)
      await writeCurrent(plan.path, task, mode !== "auto")
      if (opts.commit !== false && !opts.dryrun) {
        const committed = await commitTree(dir, task, { stage: "review-fix", subject: `${task.id} planfix ${task.title} 修复检查项注入` })
        if (!committed.ok) {
          return commitBlocked(`${task.id} 修复检查项注入`, {
            type: "failed",
            question: `统一提交失败: ${committed.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}。改动保留在工作区,请人工处理 git 后重新运行。`,
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
        log(`↻ ${task.id} 恢复中断: 修复检查项 ${fixFile} 已有效,直接注入(第 ${round}/${limit} 轮)`)
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
          const index = items.findIndex((item) => !item.done)
          if (index === -1) break
          // 进度记录标注归属子任务(1 起序号): attempt 下发成功即随记录落盘,恢复时
          // 经单元归属门禁(unitReruns)仅当该子任务将重跑才复用其会话。review 修复轮
          // (fixrun)保持 review 阶段标记(round/stage 供精确重入),仅追加序号。
          const loopPhase: Phase = chain.phase?.kind === "review" ? chain.phase : { kind: "subtasks" }
          chain.phase = { ...loopPhase, index: index + 1 }
          // 恢复续跑判定(active 记录恰归属本检查项): 中断现场的工作区脏区是本单元
          // 自身进度,runSubtask 的启动 clean 门禁据此豁免(commit-boundary-design.md)。
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
          await stepPause("subtask", `${task.id} 子任务 ${index + 1}`, { interactive: opts.interactive, dir })
          maybeExit("subtask", `${task.id} 子任务 ${index + 1}`)
          // failback 回试(OPENCODE_AUTO_MODEL_FAILBACK_SCOPE): subtask/session 粒度
          // 在子任务边界清链上降级候选,下一子任务回试首选(task 粒度由链逐任务销毁
          // 天然承担);/failback 请求同点消费(可整体重定义模型序)。
          if (failbackApplies(switches.modelFailbackScope, "subtask")) chain.model = undefined
          consumeFailback(chain)
        }
        // 收尾会话: verify/review(audit) 阶段恢复时跳过(此前已完成,重跑纯浪费);
        // config.wrapup=false(--no-wrapup,缺省 true)时整体关闭。
        if (!skipWrapup && (opts.wrapup ?? true)) {
          await persistStage({ kind: "wrapup" })
          autobanner(`${task.id} ${task.title}: 收尾`)
          const subject = `${task.id} wrapup ${task.title}`
          chain.subject = subject
          const resolves = await wrapupResolves(dir, task.id)
          const result = await runSession(client, task, renderWrapup(plan, task, { mode: opts.mode, verify: opts.verify, solo: mode !== "auto", resolves }), opts, chain)
          if (result.type === "blocked") return result
          const committed = await afterSession(dir, opts, task, { stage: "wrapup", subject })
          if (committed.type === "failed") return commitBlocked(`${task.id} 收尾会话`, committed)
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
              ? `⏭ ${task.id} 终审任务不做任务级验收(该阶段本身即检验),直接完成`
              : opts.phase === "v"
                ? `⏭ ${task.id} v(验收)阶段任务不做任务级验收(该阶段本身即检验),直接完成`
                : `⏭ ${task.id} 未启用 --verify,略过任务级验收,直接完成`,
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
        return { type: "blocked", question: `质量审核连续 ${limit} 轮修复后仍未通过:\n${audit.gap}` }
      }
      // verifyTask 通过时已把任务标 done;审核发现差距须先置回 in_progress,
      // 否则中断重跑时 next() 会跳过该任务,注入的 fix 检查项永不执行。
      await setStatus(plan.path, task.id, "in_progress")
      log(`↻ ${task.id} 质量审核未通过,规划修复子任务后继续(第 ${round}/${limit} 轮):\n${audit.gap}`)
      await persistStage({ kind: "review", round, stage: "planfix" })
      const planned = await planReviewFix(client, plan, task, opts, audit.gap)
      if (planned.type !== "ok") return planned
      const injected = await injectFix(planned.items, round)
      if (injected) return injected
    }
  }
}

// off/ondemand 的执行阶段: off 单会话完成整个任务;ondemand 会话进行中上下文
// 达到 2x --context-limit 时由 driver steer 交接提示,会话写出交接文档后换新会话
// 续跑,直到自然完成或交接文档标记完成。返回 undefined 表示执行阶段完成。
// 上次尝试遗留交接文档的清理由调用方(pipeline)在做恢复判定后进行。
async function executeWhole(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
  ondemand: boolean,
): Promise<UnitStop | undefined> {
  const cap = opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT
  const dir = opts.dir ?? dirname(plan.path)
  const strict = strictResumeActive(opts)
  // 交接文档读回落(stable-refs P1): 会话写目标恒为新路径 docs/<id>/handoff.md
  // (提示词经 handoffFile 注入),读点优先新路径、旧平铺存在则回落——存量项目
  // 中断恢复续跑不受改名影响。
  const planDir = dirname(plan.path)
  const readHandoff = async (): Promise<string> =>
    Bun.file(join(planDir, await resolveTaskDoc(planDir, task.id, "handoff"))).text().catch(() => "")
  // steer=off(OPENCODE_AUTO_STEER)时不构造交接提示,会话后的交接判定一并停用
  // (见 handoverDue);off 模式本就不构造。
  const steer = ondemand ? handoffSteer(autoSwitches().steer, cap, task) : undefined
  const subject = `${task.id} exec ${task.title}`
  chain.subject = subject
  // 中断恢复播种: 陈旧交接文档由 pipeline 在非恢复路径清除,此处文件仍存在即
  // active 恢复——中断前已交接。状态=完成 → 执行阶段已完成,跳过整任务会话;
  // 状态=继续 → 以续跑提示开新会话凭交接继续(复用旧会话只会立刻再触上限)。
  const prior = ondemand ? handoffStatus(await readHandoff()) : undefined
  if (prior === "完成") {
    log(`↻ ${task.id} 恢复中断: 交接文档 ${handoffFile(task)} 标记执行已完成,跳过整任务会话`)
    return undefined
  }
  let continuation = prior === "继续"
  if (continuation) log(`↻ ${task.id} 恢复中断: 中断前已交接 ${handoffFile(task)},新会话凭交接文档续跑`)
  let feedback = ""
  let retried = false
  // 严格恢复的回滚重做(3.3 R3 收紧): 交接文档无效(含测试交接写核失败)一次即回滚
  // 到单元基线、冷启动重做本单元,不再带反馈重试;以一次为限,再失败按隐性阻塞
  // 上抛(现场已保全在 stash)。
  let rolled = false
  const rollbackRedo = async (): Promise<UnitStop | "done" | undefined> => {
    if (!strict || !chain.baseline) return undefined
    const done = await rollbackUnitState(dir, task, "执行会话", chain.baseline, {
      planPath: plan.path,
      progress: await peekProgress(dir),
      solo: (opts.subtask ?? "auto") !== "auto",
    })
    if (done.type !== "ok") return done
    continuation = false
    feedback = ""
    retried = false
    chain.id = undefined
    chain.pending = undefined
    chain.note = undefined
    chain.pct = 100
    chain.used = 0
    chain.at = 0
    return "done"
  }
  for (;;) {
    const result = await runExecSession(
      client,
      plan,
      task,
      renderWhole(plan, task, { mode: opts.mode, verify: opts.verify, ondemand, continuation }) + feedback,
      opts,
      chain,
      steer,
    )
    if (result.type === "blocked") {
      // 测试交接写核失败(严格恢复): 回滚后冷启动重做,一次为限。
      if (result.rollback && !rolled) {
        const redone = await rollbackRedo()
        if (redone === "done") {
          rolled = true
          continue
        }
        if (redone) return redone
      }
      return result
    }
    const committed = await afterSession(dir, opts, task, { stage: "execute", subject })
    if (committed.type === "failed") return commitBlocked(`${task.id} 执行会话`, committed)
    // 未触发交接阈值(2x cap)即结束 = 任务在单会话内自然完成;steer 未构造
    // (off 模式或 OPENCODE_AUTO_STEER=off)时同样自然收,不做交接判定。
    if (!handoverDue(steer, chain.used)) return undefined
    const status = handoffStatus(await readHandoff())
    if (status === "完成") return undefined
    if (status === "继续") {
      log(`↻ ${task.id} 上下文达到 ${formatTokens(cap * 2)} 上限,已交接 ${handoffFile(task)},新会话继续`)
      continuation = true
      feedback = ""
      continue
    }
    // 交接边界写核失败(严格恢复): 无效一次即回滚冷启动重做。
    if (!rolled) {
      const redone = await rollbackRedo()
      if (redone === "done") {
        rolled = true
        log(`↻ ${task.id} 达到上下文上限但未产出有效交接文档 ${handoffFile(task)},严格恢复已回滚,冷启动重做`)
        continue
      }
      if (redone) return redone
    }
    if (retried) {
      return {
        type: "blocked",
        question:
          `会话上下文达到上限但两次未写出有效交接文档 ${handoffFile(task)}(缺失或无状态行,隐性阻塞)。` +
          `请检查该文件后重新运行。Agent 最后的输出:\n${result.lastText.trim().slice(-2000) || "(无输出)"}`,
      }
    }
    log(`↻ ${task.id} 达到上下文上限但未产出 ${handoffFile(task)},带反馈重试一次`)
    retried = true
    feedback =
      `\n\n你上次结束会话时上下文已达上限,但未写出有效的 ${handoffFile(task)}(缺失或缺少 \`状态: 继续|完成\` 行)。` +
      `这是硬性要求: 写出该文件后再结束会话。`
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

function requireTask(plan: Plan, id: string): Task {
  const task = plan.tasks.find((task) => task.id === id)
  if (!task) throw new Error(`${plan.path}: task ${id} not found`)
  return task
}

// fork 流水线 ① 理解阶段(fork-decompose 设计 §4.1): 理解会话只读探查并写
// docs/<id>/context.md 四节摘要(requireArtifact 同款两次重试 + 隐性阻塞);成功后
// driver 写任务字段 fork-base(session 模式下即最终基点;digest 模式随后被基点
// 确认会话覆写)并按 "understand" 阶段统一提交。摘要已存在(中断恢复/上一轮
// 遗留)时幂等跳过,仅补写缺失的 fork-base(中断恰好落在摘要写盘与 setForkBase
// 之间的恢复路径)。
async function ensureUnderstood(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
): Promise<({ type: "ok" } & { task: Task }) | UnitStop> {
  // 摘要路径(目录化布局,stable-refs P1): 写目标恒为新路径;读点经 resolveTaskDoc
  // 回落旧平铺 docs/<id>.context.md,存量项目中断恢复不受改名影响。
  const dir = dirname(plan.path)
  const file = join(dir, taskDoc(task.id, "context"))
  const readContext = async (): Promise<string> =>
    (await Bun.file(join(dir, await resolveTaskDoc(dir, task.id, "context"))).text().catch(() => "")).trim()
  if (await readContext()) {
    log(`↻ ${task.id} 理解摘要 ${file} 已存在,跳过理解会话`)
    if (!task.forkBase && chain.id) {
      await setForkBase(plan.path, task.id, chain.id)
      task = requireTask(await load(plan.path), task.id)
    }
    return { type: "ok", task }
  }
  autobanner(`${task.id} ${task.title}: 任务背景理解`)
  const subject = `${task.id} understand ${task.title}`
  chain.subject = subject
  let feedback = ""
  for (let i = 0; ; i++) {
    // taskContext(OPENCODE_AUTO_TASK_CONTEXT)透传理解提示词: 放宽 context.md
    // 的建议行数措辞(与 fine 透传分解提示词同一接线方式)。
    const result = await runSession(
      client,
      task,
      renderUnderstand(plan, task, { ...opts, taskContext: autoSwitches().taskContext }) + feedback,
      opts,
      chain,
    )
    if (result.type === "blocked") return result
    if (await readContext()) {
      // 理解会话即 session 模式基点;digest 模式由 ensureForkBase 随后覆写。
      if (chain.id) await setForkBase(plan.path, task.id, chain.id)
      task = requireTask(await load(plan.path), task.id)
      const committed = await afterSession(opts.dir ?? dirname(plan.path), opts, task, { stage: "understand", subject })
      if (committed.type === "failed") return commitBlocked(`${task.id} 理解会话`, committed)
      return { type: "ok", task }
    }
    if (i === 1) {
      return {
        type: "blocked",
        question:
          `理解会话两次结束但 ${file} 缺失或为空(隐性阻塞)。` +
          `请检查该文件后重新运行。Agent 最后的输出:\n${result.lastText.trim().slice(-2000) || "(无输出)"}`,
      }
    }
    log(`↻ ${task.id} 理解会话未产出 ${file},带反馈重试一次`)
    feedback =
      `\n\n你上次结束会话但未写出有效的 ${file}(缺失或为空)。这是硬性要求:` +
      `把理解结果按四节结构写入该文件后再结束会话(即使任务看起来很简单)。`
  }
}

// Ensures the task body has a checklist: tasks resuming with one (or with a
// human-written one) are used as-is; otherwise a decomposition session writes
// docs/<id>/subtasks.md and the driver injects the items into PLAN.md.
// 中断恢复: 分解会话可能已写出文件但尚未注入——先直读文件,有效则直接注入,
// 不再开会话。
async function ensureDecomposed(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
  base?: ForkBaseInfo,
): Promise<({ type: "ok" } & { task: Task }) | UnitStop> {
  if (subtasks(task.body).length) return { type: "ok", task }
  // 分解结果路径(目录化布局): 写目标恒为新路径;读点经 resolveTaskDoc 回落旧
  // 平铺 docs/<id>.subtasks.md(中断恢复: 分解会话可能已写旧名文件但尚未注入)。
  const dir = dirname(plan.path)
  const file = join(dir, taskDoc(task.id, "subtasks"))
  const readItems = async (): Promise<string[]> =>
    subtasks(await Bun.file(join(dir, await resolveTaskDoc(dir, task.id, "subtasks"))).text().catch(() => "")).map((item) => item.text)
  const existing = await readItems()
  if (existing.length) {
    log(`↻ ${task.id} 分解结果 ${file} 已存在,直接注入检查项`)
    await setSubtasks(plan.path, task.id, existing)
    return { type: "ok", task: requireTask(await load(plan.path), task.id) }
  }
  let feedback = ""
  // One automatic retry with feedback: a resumed session may have done the
  // work instead of writing the file; the file is a hard requirement.
  autobanner(`${task.id} ${task.title}: 子任务分解`)
  const subject = `${task.id} decompose ${task.title}`
  chain.subject = subject
  // ② 分解会话从基点分叉(先 fork 后渲染,设计 §4.3);无基点/失败 → 现状全新
  // 会话。种子链使分解会话不复用理解会话(基点保持纯净分叉点)。
  await seedForkSession(client, opts, chain, base, subject)
  for (let i = 0; ; i++) {
    // fine(OPENCODE_AUTO_DECOMPOSE_FINE=on)透传分解提示词: 注入细粒度准则段
    // (fork-decompose-design.md §5.1)。
    const result = await runSession(client, task, renderDecompose(plan, task, { ...opts, fine: autoSwitches().fine }) + feedback, opts, chain)
    if (result.type === "blocked") return result
    const items = await readItems()
    if (items.length) {
      await setSubtasks(plan.path, task.id, items)
      // 镜像刷新同样先于统一提交(与子任务勾选同口径): 注入的检查项与镜像同入
      // decompose 提交,调用方随后的刷新即幂等空写。
      await writeCurrent(plan.path, requireTask(await load(plan.path), task.id))
      const committed = await afterSession(opts.dir ?? dirname(plan.path), opts, task, { stage: "decompose", subject })
      if (committed.type === "failed") return commitBlocked(`${task.id} 分解会话`, committed)
      return { type: "ok", task: requireTask(await load(plan.path), task.id) }
    }
    if (i === 1) {
      return {
        type: "blocked",
        question:
          `分解会话两次结束但 ${file} 缺失或不含有效检查项(隐性阻塞)。` +
          `请检查该文件后重新运行。Agent 最后的输出:\n${result.lastText.trim().slice(-2000) || "(无输出)"}`,
      }
    }
    log(`↻ ${task.id} 分解会话未产出 ${file},带反馈重试一次`)
    feedback =
      `\n\n你上次结束会话但未写出有效的 ${file}(缺失或无检查项)。这是硬性要求:` +
      `即使任务已完成或极简单,也必须写出该文件(原子任务写单个检查项即可)。`
  }
}

// Runs one subtask session, then ticks the checklist item on trust: the
// session self-checks its own work, and acceptance of the whole task is
// deferred to the single task-level review after wrap-up (a gap there
// appends a fix subtask).
// handoff-steer 同样适用于子任务会话(与 ondemand 整任务会话同机制、共用
// docs/<id>/handoff.md): 会话进行中上下文已用量达到 2x --context-limit 时
// driver steer 交接提示,会话写出交接文档(末行 `状态: 继续|完成`,以本子任务
// 是否完成计)后换新会话凭交接续跑,直到自然完成或交接文档标记完成;子任务
// 完成后清除交接文档,下一子任务重新起算。实验开关 OPENCODE_AUTO_STEER=off
// 停用本机制(不注入交接提示、会话后不做交接判定,自然完成即收)。
async function runSubtask(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  text: string,
  index: number,
  opts: Opts,
  chain: SessionChain,
  base?: ForkBaseInfo,
  // 本子任务恢复续跑(active 进度记录归属本单元): 豁免启动 clean 门禁——工作区
  // 脏区是本单元自身进度(含交接文档),收口时一并落账(commit-boundary-design.md)。
  resumeUnit = false,
): Promise<UnitStop | undefined> {
  subbanner(`${task.id} 子任务 ${index}：${text.length > 50 ? `${text.slice(0, 50)}…` : text}`)
  const subject = `${task.id} S${index} ${text}`
  chain.subject = subject
  const dir = opts.dir ?? dirname(plan.path)
  // 子任务单元提交边界: 启动 clean 门禁 + SHA 基线(收口时校验提交区间全为 driver
  // 提交);driver 独占状态文件遗留由 beginUnit 内部 carryover 自愈。基线同时上链
  // (严格恢复: active 记录携带、回滚锚点)。
  let baseline: UnitBaseline | undefined
  if (resumeUnit) {
    if (opts.commit !== false && !opts.dryrun) baseline = await unitBaseline(dir)
  } else {
    const gate = await beginUnit(dir, opts, task)
    if (gate.type === "dirty") return { type: "dirty", files: gate.files }
    baseline = gate.baseline
  }
  chain.baseline = baseline
  const strict = strictResumeActive(opts)
  const cap = opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT
  // steer=off(OPENCODE_AUTO_STEER)时不构造交接提示,会话后的交接判定一并停用
  // (见 handoverDue);--handover-test 的测试交接是独立机制,不受影响。
  const steer = handoffSteer(autoSwitches().steer, cap, task)
  // 交接文档读回落(stable-refs P1): 会话写目标恒为新路径(提示词经 handoffFile
  // 注入),读点优先新路径、旧平铺存在则回落。
  const planDir = dirname(plan.path)
  const readHandoff = async (): Promise<string> =>
    Bun.file(join(planDir, await resolveTaskDoc(planDir, task.id, "handoff"))).text().catch(() => "")
  // 中断恢复播种: 陈旧交接文档由 pipeline 在非恢复路径清除,此处文件仍存在且
  // 状态=完成 → 子任务在中断前已由交接会话完成,直接勾选;状态=继续 → 以续跑
  // 提示开新会话凭交接继续(复用旧会话只会立刻再触上限)。
  const prior = handoffStatus(await readHandoff())
  if (prior === "完成") {
    log(`↻ ${task.id} 恢复中断: 交接文档 ${handoffFile(task)} 标记子任务已完成,直接勾选`)
  } else {
    let continuation = prior === "继续"
    if (continuation) log(`↻ ${task.id} 恢复中断: 中断前已交接 ${handoffFile(task)},新会话凭交接文档续跑子任务`)
    // ③ 子任务首个会话从基点分叉(与分解会话同一分叉点,先 fork 后渲染——warm/
    // cold 背景段据此选择);跨子任务不复用(种子链强制),交接续跑与带反馈重试
    // 沿用链内既有机制。无基点/失败 → 全新会话 + 冷启动提示词(读 context.md)。
    let warm = await seedForkSession(client, opts, chain, base, subject)
    let feedback = ""
    let retried = false
    // 严格恢复的回滚重做(3.3 R3 收紧): 交接文档无效(含测试交接写核失败)一次即
    // 回滚到子任务基线、冷启动重做,不再带反馈重试;以一次为限,再失败按隐性阻塞
    // 上抛(现场已保全在 stash)。
    let rolled = false
    const rollbackRedo = async (): Promise<UnitStop | "done" | undefined> => {
      if (!strict || !baseline) return undefined
      const done = await rollbackUnitState(dir, task, `子任务 ${index}`, baseline, {
        planPath: plan.path,
        progress: await peekProgress(dir),
        solo: (opts.subtask ?? "auto") !== "auto",
      })
      if (done.type !== "ok") return done
      continuation = false
      feedback = ""
      retried = false
      chain.id = undefined
      chain.pending = undefined
      chain.note = undefined
      chain.pct = 100
      chain.used = 0
      chain.at = 0
      // 冷启动重做从基点重新分叉(与子任务首个会话同一形态,拿回暖前缀)。
      warm = await seedForkSession(client, opts, chain, base, subject)
      return "done"
    }
    for (;;) {
      const result = await runExecSession(
        client,
        plan,
        task,
        renderSubtask(plan, task, text, { ...opts, continuation, index, warm }) + feedback,
        opts,
        chain,
        steer,
        index,
      )
      if (result.type === "blocked") {
        // 测试交接写核失败(严格恢复): 回滚后冷启动重做,一次为限。
        if (result.rollback && !rolled) {
          const redone = await rollbackRedo()
          if (redone === "done") {
            rolled = true
            continue
          }
          if (redone) return redone
        }
        return result
      }
      // 未触发交接阈值(2x cap)即结束 = 子任务在单会话内自然完成,勾选后统一提交;
      // steer=off 时不构造交接提示,自然完成即收、不索要交接文档——否则自然结束
      // 但用量超限的会话会被误要求补写交接文档;超限收场交由 provider 侧压缩/上限
      // 错误走既有「会话错误」换新会话重试,磁盘进度与统一提交不受影响。
      if (!handoverDue(steer, chain.used)) break
      const status = handoffStatus(await readHandoff())
      if (status === "完成") break
      // 交接续跑/带反馈重试前先把本会话产出提交(下一会话从已提交的工作区继续)。
      const committed = await afterSession(dir, opts, task, { stage: `subtask ${index}`, subject })
      if (committed.type === "failed") return commitBlocked(`${task.id} 子任务 ${index}`, committed)
      if (status === "继续") {
        log(`↻ ${task.id} 子任务 ${index} 上下文达到 ${formatTokens(cap * 2)} 上限,已交接 ${handoffFile(task)},新会话继续`)
        continuation = true
        feedback = ""
        continue
      }
      // 交接边界写核失败(严格恢复): 无效一次即回滚冷启动重做。
      if (!rolled) {
        const redone = await rollbackRedo()
        if (redone === "done") {
          rolled = true
          log(`↻ ${task.id} 子任务 ${index} 达到上下文上限但未产出有效交接文档 ${handoffFile(task)},严格恢复已回滚,冷启动重做`)
          continue
        }
        if (redone) return redone
      }
      if (retried) {
        return {
          type: "blocked",
          question:
            `子任务会话上下文达到上限但两次未写出有效交接文档 ${handoffFile(task)}(缺失或无状态行,隐性阻塞)。` +
            `请检查该文件后重新运行。Agent 最后的输出:\n${result.lastText.trim().slice(-2000) || "(无输出)"}`,
        }
      }
      log(`↻ ${task.id} 子任务 ${index} 达到上下文上限但未产出 ${handoffFile(task)},带反馈重试一次`)
      retried = true
      feedback =
        `\n\n你上次结束会话时上下文已达上限,但未写出有效的 ${handoffFile(task)}(缺失或缺少 \`状态: 继续|完成\` 行)。` +
        `这是硬性要求: 写出该文件后再结束会话。`
    }
  }
  // 子任务完成: 清除交接文档(ondemand 交接与测试交接,下一子任务重新起算——
  // 测试交接按子任务命名,这里移除本子任务的文件),新旧两处一并清(driver 勾选后统一提交)。
  await rm(join(planDir, handoffFile(task)), { force: true })
  await rm(join(planDir, legacyTaskDoc(task.id, "handoff")), { force: true })
  await removeHandoffChain(planDir, testHandoffFile(task, index))
  await removeHandoffChain(planDir, legacySubtaskTestHandoff(task.id, index))
  await tick(plan.path, task.id, text)
  // 镜像刷新属本次状态写入,须在统一提交前落盘: 否则 PLAN.md 的勾选与 CURRENT.md
  // 的同一次刷新分属相邻两次提交(镜像永远落后一格,回滚到子任务提交取回的镜像
  // 与 PLAN.md 不一致;步进暂停现场亦会残留未提交改动)。
  await writeCurrent(plan.path, requireTask(await load(plan.path), task.id), (opts.subtask ?? "auto") !== "auto")
  // 子任务提交信息省略任务标题(编号 + 子任务编号 + 子任务标题即可定位)。
  // 单元收口: 带基线做提交区间校验——勾选与镜像未落账即不视为完成。
  const committed = await afterSession(dir, opts, task, { stage: `subtask ${index}`, subject }, baseline)
  if (committed.type === "failed") return commitBlocked(`${task.id} 子任务 ${index}`, committed)
  log(`  ✓ ${text.slice(0, 60)}`)
  return undefined
}

// Task-level acceptance after the wrap-up session, three stages (设计文档
// A.4/A.5,判定会话执行限制见 G 节): resolve and (when needed) generate the
// verify script, execute it via the driver, then run the independent judge
// session and parse its verdict file. The judge never executes verify scripts
// or commands itself; when it deems the script broken it replaces the
// designated script and concludes 重验 — the driver then re-executes that
// script (up to REVERIFY_ROUNDS) instead of resolving by verify field again.
// On pass the verified field prefers the judge's verified-command line, then
// the task's original command, then the actual executed script path. A gap is
// fed back into the execution session chain for a fix round (wrap-up re-runs,
// then the same script is re-executed and re-judged) until it passes or
// FIX_ROUNDS is exhausted; off mode skips fix rounds and returns the gap to
// the caller (task reverts to pending).
// Each review round re-enters verifyTask with a fresh fix-round budget.
// --early audit hook (设计文档 F.5): when given, a fresh audit session starts
// right before each script execution (after the generate session, if any) and
// joins before the judge session — a blocked audit propagates immediately;
// the last audit verdict rides back with the done result.
// 中断恢复(design doc H): persist 在各阶段边界写进度记录(含已执行的脚本运行
// 记录);resume 提供上次中断时的轮数计数与运行记录——脚本已执行完毕时不重跑,
// 直接(early 且审核结论缺失时补跑审核会话后)进入判定会话;修复轮进行中被中断
// (stage=fix,差距原文随记录持久化)时凭差距重新下发修复提示续跑,不重复判定。
async function verifyTask(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
  audit?: () => Promise<Verdict | UnitStop>,
  persist?: (phase: Phase) => Promise<void>,
  resume?: Phase & { kind: "verify" },
): Promise<{ type: "done"; audit?: Verdict } | { type: "gap"; gap: string } | UnitStop> {
  const mode = opts.subtask ?? "auto"
  const dir = opts.dir ?? dirname(plan.path)
  // 判定会话重验后固定执行指定脚本路径,不再按 verify 字段重新解析——wrapped
  // 分支每次 resolve 都会重新包装,覆盖掉替换产物。
  const replacement = join(verifyTmpDir(dir), "verify.sh")
  let replaced = resume?.replaced === true
  // 恢复用的运行记录(仅首轮消费): 脚本上次已执行完毕且有持久化记录时不重跑。
  // stage = fix 的修复轮中断不走直判(run 属上一轮已判定记录),由 pendingFix 接管。
  let pending = resume?.run && resume.stage !== "fix" ? resume : undefined
  // 修复轮中断恢复(仅首轮消费): fix 会话半途被中断,首轮凭持久化的差距原文重新
  // 下发修复提示续跑(执行链会话经 runTask 复用时上下文不丢),随后照常收尾与重验。
  let pendingFix = resume?.stage === "fix" && typeof resume.gap === "string" ? resume : undefined
  // 差距反馈回执行会话链修复 + 重新收尾(正常修复轮与中断恢复共用)。
  const fixRound = async (gap: string, round: number): Promise<UnitStop | undefined> => {
    const fixSubject = `${task.id} fix${round} ${task.title}`
    chain.subject = fixSubject
    // 修复轮无子任务序号(交接文档为任务级),但提交 stage 要跟着修复轮走。
    const fixed = await runExecSession(client, plan, task, renderFix(plan, task, gap, opts), opts, chain, undefined, undefined, `fix ${round}`)
    if (fixed.type === "blocked") return fixed
    const fixCommitted = await afterSession(dir, opts, task, { stage: `fix ${round}`, subject: fixSubject })
    if (fixCommitted.type === "failed") return commitBlocked(`${task.id} 修复轮 ${round}`, fixCommitted)
    if (opts.wrapup ?? true) {
      autobanner(`${task.id} ${task.title}: 收尾`)
      const wrapSubject = `${task.id} wrapup ${task.title}`
      chain.subject = wrapSubject
      const resolves = await wrapupResolves(dir, task.id)
      const wrapped = await runSession(client, task, renderWrapup(plan, task, { mode: opts.mode, verify: opts.verify, solo: mode !== "auto", resolves }), opts, chain)
      if (wrapped.type === "blocked") return wrapped
      const wrapCommitted = await afterSession(dir, opts, task, { stage: "wrapup", subject: wrapSubject })
      if (wrapCommitted.type === "failed") return commitBlocked(`${task.id} 修复后收尾会话`, wrapCommitted)
    }
    return undefined
  }
  for (let round = resume?.round ?? 0, rechecks = resume?.rechecks ?? 0; ; ) {
    const counters = { round, rechecks, replaced }
    if (pendingFix) {
      // 中断恢复: 修复轮会话半途被中断,重新下发持久化的差距反馈续跑修复。
      const fix = pendingFix
      pendingFix = undefined
      log(`↻ ${task.id} 恢复中断: 验收修复轮(第 ${round}/${FIX_ROUNDS - 1} 轮)会话被中断,凭持久化的差距反馈续跑修复:\n${fix.gap}`)
      const blocked = await fixRound(fix.gap!, round)
      if (blocked) return blocked
    }
    let execution: { type: "ok"; run: VerifyRun; audit?: Verdict } | UnitStop
    if (pending?.run) {
      // 中断恢复: 脚本已执行完毕且运行记录已持久化——不重跑脚本;early 且审核
      // 结论缺失时先补跑审核会话,然后直接进入判定。
      let auditVerdict: (typeof pending.audit) | undefined = pending.audit
      if (!auditVerdict && audit) {
        const fresh = await audit()
        if (fresh.type === "blocked" || fresh.type === "dirty") return fresh
        auditVerdict = fresh
      }
      log(`↻ ${task.id} 恢复中断: verify 脚本上次已执行完毕(${pending.run.script}),直接进入判定`)
      execution = { type: "ok", run: pending.run, audit: auditVerdict }
    } else {
      execution = await executeVerifyScript(client, plan, task, opts, audit, replaced ? replacement : undefined, persist, counters)
    }
    pending = undefined
    if (execution.type === "blocked" || execution.type === "dirty") return execution
    await persist?.({ kind: "verify", stage: "judge", ...counters, run: execution.run, audit: execution.audit })
    // 引用门禁(stable-refs P4,D6 第三层): 判定会话前对任务产物文档(docs/
    // T-NNN/**)做确定性预扫——失效引用 = 差距,直接进修复轮、不消耗判定会话;
    // 修复轮语义与判定差距一致(off 模式回退 pending,耗尽阻塞退出 2)。verify
    // 未启用时无任务级验收,门禁不存在(退化为提交时 auto-correct 的 ⚠ 日志)。
    // 受 OPENCODE_AUTO_REF_CHECK 管控(refcheck-scope-design D3,缺省 off 空转)。
    const refGap = await gatedTaskRefGap(dir, task.id, autoSwitches().refCheck)
    if (refGap) {
      if (mode === "off") return { type: "gap", gap: refGap }
      round++
      if (round >= FIX_ROUNDS) {
        return { type: "blocked", question: `任务产物文档连续 ${FIX_ROUNDS} 轮修复仍存在失效引用:\n${refGap}` }
      }
      log(`↻ ${task.id} 任务产物文档存在失效引用,反馈回执行会话修复(第 ${round}/${FIX_ROUNDS - 1} 轮):\n${refGap}`)
      await persist?.({ kind: "verify", stage: "fix", round, rechecks, replaced, gap: refGap })
      const blocked = await fixRound(refGap, round)
      if (blocked) return blocked
      continue
    }
    const verdict = await judge(client, plan, task, opts, execution.run)
    if (verdict.type === "blocked" || verdict.type === "dirty") return verdict
    if (verdict.type === "pass") {
      await markDone(plan.path, task.id, verdict.command ?? verifyCommand(task) ?? execution.run.script)
      return { type: "done", audit: execution.audit }
    }
    // 判定会话认定脚本本身有问题并已替换: driver 重新执行替换脚本并再判定。
    if (verdict.type === "reverify") {
      if (!(await Bun.file(replacement).exists())) {
        return { type: "blocked", question: `判定会话结论为重验,但未写出替换脚本 ${replacement}:\n${verdict.gap}` }
      }
      rechecks++
      if (rechecks > REVERIFY_ROUNDS) {
        return { type: "blocked", question: `验证脚本经 ${REVERIFY_ROUNDS} 轮替换重验仍未通过:\n${verdict.gap}` }
      }
      log(`↻ ${task.id} 判定会话替换了验证脚本,重新执行并判定(第 ${rechecks}/${REVERIFY_ROUNDS} 轮):\n${verdict.gap}`)
      replaced = true
      continue
    }
    // off 模式不做修复重跑: 差距交回调用方(回退 pending,等人工改进后重试)。
    if (mode === "off") return { type: "gap", gap: verdict.gap }
    round++
    if (round >= FIX_ROUNDS) {
      return { type: "blocked", question: `任务级验收连续 ${FIX_ROUNDS} 轮未通过:\n${verdict.gap}` }
    }
    // 把判定会话的差距信息反馈回执行会话链,续跑修复后重新收尾与验收。
    log(`↻ ${task.id} 验收未通过,把审核差距反馈回执行会话续跑修复(第 ${round}/${FIX_ROUNDS - 1} 轮):\n${verdict.gap}`)
    // 修复轮进行中标记(stage=fix + 差距原文)先于 fix 会话持久化: 此刻中断,恢复时
    // 凭差距重新下发修复提示续跑(执行链会话复用时上下文不丢),而不是重走一轮判定。
    await persist?.({ kind: "verify", stage: "fix", round, rechecks, replaced, gap: verdict.gap })
    const blocked = await fixRound(verdict.gap, round)
    if (blocked) return blocked
  }
}

type Verdict = { type: "pass"; command?: string } | { type: "gap"; gap: string } | { type: "reverify"; gap: string }

// Verify 前两段: resolveVerifyScript 判定来源(existing/wrapped 由 driver 直接
// 给出;自然语言或缺失先开一次性脚本生成旁路会话——generate 分支沿用约定名
// tmp/verify.sh,上一轮(或修复前)生成的脚本存在则复用,V1 不自动重新
// 生成),随后 runVerifyScript 在目标目录执行(进度看门狗: 持续无输出超过
// --verify-idle 才终止;--verify-max 另设绝对上限)并 log 一行结果。退出码非 0
// 不在此判定——判定权在判定会话。
// override: 重验轮由判定会话替换出的指定脚本,直接执行、跳过 resolve(wrapped
// 分支重新包装会覆盖掉替换产物)。
// persist: 阶段边界写进度记录——脚本执行完毕即持久化运行记录,此刻中断,恢复时
// 跳过执行直接进入判定会话(脚本可能很长)。
// --early 审核挂点(F.2 时序保证): generate 分支的脚本生成会话结束后才启动
// 审核会话,与脚本执行并行;脚本执行完毕先 join 审核(blocked 立即上抛),随后
// 才进入判定会话。每次脚本执行(含修复轮重跑)重开一次新审核。
async function executeVerifyScript(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  audit?: () => Promise<Verdict | UnitStop>,
  override?: string,
  persist?: (phase: Phase) => Promise<void>,
  counters: { round: number; rechecks: number; replaced: boolean } = { round: 0, rechecks: 0, replaced: false },
): Promise<{ type: "ok"; run: VerifyRun; audit?: Verdict } | UnitStop> {
  const dir = opts.dir ?? dirname(plan.path)
  const tmp = verifyTmpDir(dir)
  // generate 分支的脚本约定名:上一次(或上轮修复前)生成的脚本存在则复用。
  const script = join(tmp, "verify.sh")
  let path: string
  if (override) {
    path = override
  } else {
    await persist?.({ kind: "verify", stage: "generate", ...counters })
    const resolved = await resolveVerifyScript(task, dir)
    if (resolved.kind === "generate" && !(await Bun.file(script).exists())) {
      const failed = await generateScript(client, plan, task, opts, script)
      if (failed) return failed
    }
    path = resolved.kind === "generate" ? script : resolved.script
  }
  await persist?.({ kind: "verify", stage: "exec", ...counters })
  const auditing = audit?.()
  const outPath = join(tmp, "verify.out")
  const run = await runVerifyScript(dir, path, { idleMs: opts.idleMs, maxMs: opts.maxMs, out: outPath })
  log(
    `  ⚙ verify 脚本退出码 ${run.code}${run.timedOut ? `(超时终止: ${run.timeoutReason === "max" ? "超过绝对时长上限" : "持续无输出"})` : ""},耗时 ${run.ms}ms,输出: ${outPath}`,
  )
  const record: VerifyRun = {
    script: path,
    code: run.code,
    ms: run.ms,
    timedOut: run.timedOut,
    timeoutReason: run.timeoutReason,
    out: outPath,
  }
  // 脚本执行完毕即持久化运行记录(early 的审核结论由 verifyTask 在 join 后随
  // judge 阶段一并写入)。
  await persist?.({ kind: "verify", stage: "exec", ...counters, run: record })
  const audited = await auditing
  if (audited?.type === "blocked" || audited?.type === "dirty") return audited
  return { type: "ok", run: record, audit: audited }
}

// Verify 第三段: 独立判定旁路会话(一次性 chain,不进任务执行链),注入运行信息,
// 解析 VERDICT_FILE 结论;产出缺失的重试策略见 requireArtifact。
// 判定会话被授权把验证经验沉淀到后续未完成任务的 verify 字段(renderVerifyJudge
// 授权段): 会话期间临时放开 PLAN.md 写权限,结束后恢复并校验——解析失败或除
// verify 字段外的结构性内容(任务集合/状态/attempts/正文)被改动时,整体还原
// 会话前快照,越权编辑不被信任。
async function judge(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  run: VerifyRun,
): Promise<Verdict | UnitStop> {
  autobanner(`${task.id} ${task.title}: 验收判定`)
  const file = join(dirname(plan.path), VERDICT_FILE)
  const snapshot = await Bun.file(plan.path).text()
  await allowWrite(plan.path)
  try {
    // 重新加载计划: 此前轮次的判定会话可能已更新后续任务的 verify 字段。
    return await requireArtifact(client, task, renderVerifyJudge(await load(plan.path), task, run, opts), opts, {
      kind: "审核",
      role: "verify-judge",
      artifact: `有效判定文件 ${VERDICT_FILE}`,
      detail: "缺失或无结论行",
      requirement: "无论审核结论如何,都必须写出该文件,且最后一行为 `结论: 通过`、`结论: 差距 <描述>` 或 `结论: 重验 <原因>`(替换指定验证脚本后交 driver 重新执行)。",
      commit: { stage: "verify-judge", subject: `${task.id} judge ${task.title}` },
      reset: () => rm(file, { force: true }),
      collect: async () => parseVerdict(await Bun.file(file).text().catch(() => "")),
    })
  } finally {
    await checkPlanEdit(plan.path, snapshot)
    await reprotect(plan.path)
  }
}

// 校验判定会话对 PLAN.md 的编辑仅限授权范围(后续未完成任务的 verify 字段):
// 任务集合、状态、attempts 与正文(含检查项)任一变化或解析失败,即恢复会话前
// 快照并警告。verified/question 等其余字段不在授权内但也不做还原——它们由
// driver 在后续步骤统一重写,不会造成状态错乱。
async function checkPlanEdit(planFile: string, before: string) {
  const after = await Bun.file(planFile).text().catch(() => "")
  if (after === before) return
  const shape = (text: string) => parse(planFile, text).tasks.map((item) => `${item.id}|${item.status}|${item.attempts}|${item.body}`)
  try {
    if (JSON.stringify(shape(before)) === JSON.stringify(shape(after))) return
  } catch {
    // 解析失败按越权处理,走还原。
  }
  await allowWrite(planFile)
  await Bun.write(planFile, before)
  log(`⚠ 判定会话对 PLAN.md 的编辑超出授权(仅允许后续未完成任务的 verify 字段),已还原原内容`)
}

// Natural-language or missing verify: a one-shot side session writes the
// executable script (retry/blockage policy shared via requireArtifact).
async function generateScript(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  script: string,
): Promise<UnitStop | undefined> {
  autobanner(`${task.id} ${task.title}: 验收脚本生成`)
  const produced = await requireArtifact(client, task, renderVerifyScriptGen(plan, task, script, opts), opts, {
    kind: "脚本生成",
    role: "verify-generate",
    artifact: script,
    requirement: "必须把可执行脚本写到该路径并 chmod +x。",
    commit: { stage: "verify-script", subject: `${task.id} script ${task.title}` },
    collect: async () => (await Bun.file(script).exists()) || undefined,
  })
  if (produced !== true) return produced
  return undefined
}

// --review 质量审核(设计文档 B.2/B.3): 旁路审核会话产出 audit 报告,结论写
// REVIEW_FILE(协议同 VERDICT_FILE,复用 requireArtifact/parseVerdict 的重试
// 策略)。final = 当前任务之后全部任务已 done(或无后继),即本任务是最后一
// 个任务,审核升级为全计划终审。
// --early 下同一会话经挂点在 verify 脚本执行窗口并行启动(F.3): 提示词用
// early 措辞(静态审核脚本内容、以只读检查为主),横幅随窗口启动打印。
async function reviewTask(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  early = false,
): Promise<Verdict | UnitStop> {
  // 重新加载计划判定 final: 串行路径下当前任务刚被 verifyTask 标 done;early
  // 窗口下审核先于 markDone 启动,但 final 只看后继任务,两者结论一致。
  const current = await load(plan.path)
  const index = current.tasks.findIndex((item) => item.id === task.id)
  const final = current.tasks.slice(index + 1).every((item) => item.status === "done")
  autobanner(`${task.id} ${task.title}: ${final ? "最终质量审核(全计划)" : "质量审核"}${early ? "(与 verify 脚本并行)" : ""}`)
  const file = join(dirname(plan.path), REVIEW_FILE)
  return requireArtifact(client, task, renderReview(current, task, { final, early, verify: opts.verify }), opts, {
    kind: "质量审核",
    role: "review-audit",
    artifact: `有效结论文件 ${REVIEW_FILE}`,
    detail: "缺失或无结论行",
    requirement: "无论审核结论如何,都必须写出该文件,且最后一行为 `结论: 通过` 或 `结论: 差距 <描述>`。",
    commit: { stage: "review", subject: final ? `${task.id} final ${task.title}` : `${task.id} review ${task.title}` },
    reset: () => rm(file, { force: true }),
    collect: async () => parseVerdict(await Bun.file(file).text().catch(() => "")),
  })
}

// 审核差距 → 旁路修复规划会话(设计文档 B.4): 产出 docs/<id>/fix.md 检查项,
// 调用方经 appendSubtasks 注入 PLAN.md,交既有子任务会话机制执行。
async function planReviewFix(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  gap: string,
): Promise<{ type: "ok"; items: string[] } | UnitStop> {
  autobanner(`${task.id} ${task.title}: 审核修复规划`)
  // 修复检查项文件(目录化布局): reset/collect 同一目标;collect 读经 resolveTaskDoc
  // 回落旧平铺 docs/<id>.fix.md(中断恢复: 规划会话可能已写旧名文件)。
  const dir = dirname(plan.path)
  const file = join(dir, taskDoc(task.id, "fix"))
  const collected = await requireArtifact(client, task, renderReviewFix(plan, task, gap, opts), opts, {
    kind: "修复规划",
    role: "review-planfix",
    artifact: `有效修复检查项文件 ${taskDoc(task.id, "fix")}`,
    detail: "缺失或无检查项",
    requirement: "必须把修复检查项写入该文件(每条差距至少一项)。",
    commit: { stage: "review-fix", subject: `${task.id} planfix ${task.title}` },
    reset: () => rm(file, { force: true }),
    collect: async () => {
      const items = subtasks(await Bun.file(join(dir, await resolveTaskDoc(dir, task.id, "fix"))).text().catch(() => ""))
      return items.length ? items.map((item) => item.text) : undefined
    },
  })
  if (!Array.isArray(collected)) return collected
  return { type: "ok", items: collected }
}

function parseVerdict(text: string): Verdict | undefined {
  const conclusion = /结论[:：]\s*(通过|差距[^\n]*|重验[^\n]*)/.exec(text)
  if (!conclusion) return undefined
  if (conclusion[1] === "通过") {
    return { type: "pass", command: /^verified-command:\s*(.+)$/m.exec(text)?.[1]?.trim() }
  }
  const gap = conclusion[1]!.trim()
  // 重验: 判定会话认定脚本本身有问题并已替换指定脚本,driver 重新执行后再判定。
  return gap.startsWith("重验") ? { type: "reverify", gap: gap.replace(/^重验[:：]?\s*/, "").trim() } : { type: "gap", gap }
}

// 执行类会话(子任务/整任务/修复轮)的统一入口: --test-by-driver 未启用时直通
// runSession;启用时包装测试交接循环——会话因测试失败且上下文达上限交结束后,
// 以 continuation 提示(先读交接文档与最近输出)开新会话续跑,直至会话自然完成。
// 交接次数不设硬上限,超过 TEST_HANDOVER_ADVISORY 时提示 AI 评估是否陷入无法
// 解决的问题(可 AUTO-FIXME 标注遗留后继续)。subtask 为子任务序号(仅子任务
// 会话传入): 交接文档按执行范围命名(子任务级 docs/<id>/S<两位序号>/
// testhandoff.md),防下一子任务误读上一子任务的遗留交接;整任务/修复轮为任务级命名。
async function runExecSession(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  promptText: string,
  opts: Opts,
  chain: SessionChain,
  steer?: Steer,
  subtask?: number,
  unit = subtask !== undefined ? `subtask ${subtask}` : "execute",
): Promise<SessionResult> {
  if (!opts.testByDriver || opts.dryrun) return runSession(client, task, promptText, opts, chain, steer)
  const dir = opts.dir ?? dirname(plan.path)
  const tmp = verifyTmpDir(dir)
  const handoff = testHandoffFile(task, subtask)
  // 现场复原(中断恢复 F3): 已落账却不在工作区的交接文档先取回——上一次运行的
  // 陈旧清理可能把在途文档删掉。必须早于下面的归档编号扫描: 编号要基于复原后的
  // 现场,否则被删掉的归档份会让编号倒退、覆盖历史交接。
  await restoreTestHandoffs(dir, task)
  // 归档编号跨会话/跨运行接续(D4): 中断恢复时从既有 testhandoff-<n>.md 的最大
  // 编号续起,不从 1 重来覆盖历史交接。
  let handovers = await latestHandoffSeq(dir, handoff)
  const test: TestRun = {
    dir,
    tmp,
    handoffFile: join(dir, handoff),
    handover: opts.handoverTest === true,
    limit: opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT,
    seq: await latestTestSeq(tmp),
    task,
    unit,
    subject: chain.subject ?? task.id,
    label: subtask !== undefined ? `${task.id} S${subtask}` : task.id,
    handovers,
    startUsed: 0,
  }
  // 中断恢复(测试交接中断恢复,docs/test-handover-early-design.md §I): 按
  // 「文件状态 × 提交状态」定出交接时序被打断的位置,再从该位置续跑。观测量是
  // 当前份 testhandoff.md、归档份 testhandoff-<n>.md 以及两者的落账情况;在途
  // 记录(.auto/handover.json)只补上文件和提交推不出来的身份信息(待跑脚本、
  // 可 fork 的会话)。文件按执行范围命名,只认本范围的交接;旧平铺名经 resolve 读回落。
  const record = await recallHandover(dir, task.id, handoff)
  const seeded = subtask !== undefined
    ? await resolveSubtaskDoc(dir, task.id, subtask, "testhandoff")
    : await resolveTaskDoc(dir, task.id, "testhandoff")
  const current = await Bun.file(join(dir, seeded)).text().catch(() => undefined)
  const archivedRel = handovers > 0 ? archivedTestHandoff(handoff, handovers) : handoff
  const hasArchived = handovers > 0 && (await Bun.file(join(dir, archivedRel)).exists())
  const stage = handoverStage({
    record,
    current,
    currentCommitted: current !== undefined && (await fileCommitted(dir, seeded)),
    archived: hasArchived,
    archivedCommitted: hasArchived && (await fileCommitted(dir, archivedRel)),
  })
  let continuation = false
  let archived = archivedRel
  // 首轮提示词的一次性改写: 收尾未完成时从定版点 fork 出的会话已经带着本执行
  // 范围的全部上下文,要下发的是收尾指令本身,而不是再讲一遍任务提示词。
  let firstPrompt: string | undefined
  if (stage === "wrapup" && record) {
    // H1 收尾未完成: 定版提交已落账、会话没写完交接文档就被打断。从定版那一刻的
    // 会话状态 fork 出新会话重做收尾——收尾之后照常走归档 → 提交 #2 → 跑脚本。
    if (await seedPinFork(client, chain, record, `${test.label} 测试交接 #${record.n} 收尾`)) {
      if (record.script) test.pending = { script: record.script, seq: record.seq ?? ++test.seq }
      test.resumeWrapup = true
      firstPrompt = renderTestWrapup({ handoffFile: test.handoffFile })
      log(`↻ ${test.label} 恢复中断: 测试交接 #${record.n} 定版已落账、收尾未完成,从定版点分叉会话重做收尾`)
    } else {
      // 定版会话已不可用: 收尾无从接续,丢掉在途记录冷启动重做本执行范围
      // (定版提交留在历史里,是一次无害的中间提交)。
      await forgetHandover(dir)
      log(`↻ ${test.label} 恢复中断: 测试交接 #${record.n} 的定版会话已不可用,冷启动重做本执行范围`)
    }
  } else if (stage === "commit" || stage === "test") {
    // H2 交接已写完未收口 / H3 已收口: 补齐缺的那几步(补状态行 → 归档 → 提交 #2
    // → 执行脚本),再开续跑会话。
    if (stage === "commit") {
      if (!hasArchived) {
        // F2 补标记: 内容按构造是完整的(已落账,或带状态行),缺的那一行由 driver
        // 补上——归档份本身要自证"这是写完的交接",随提交 #2 一并落账。
        await fillHandoffStatus(join(dir, seeded))
        handovers++
        test.handovers = handovers
        archived = archivedTestHandoff(handoff, handovers)
        await archiveHandoff(dir, seeded, handoff, handovers)
      }
      const subject = suffixedTitle(test.subject, `测试交接 #${handovers}`)
      const committed = await afterSession(dir, opts, task, { stage: `${unit} handoff-${handovers}`, subject })
      if (committed.type === "failed") return commitBlocked(subject, committed)
      log(`↻ ${test.label} 恢复中断: 交接文档 ${archived} 已写完但未收口,已补提交`)
    } else {
      log(`↻ ${test.label} 恢复中断: 测试交接 #${handovers} 已收口(${archived} 已落账)`)
    }
    // 脚本幂等(F6): 该跑就跑。记录里有定版时消费出来的脚本就跑它;记录缺失
    // (本机制上线前的存量现场)回落到 tmp/ 下最新一份执行快照;都没有就只凭
    // 交接文档续跑,不臆造测试结果。
    const script = record?.script ?? (await latestTestScript(tmp))
    if (script) {
      log(`↻ ${test.label} 恢复中断: 重跑定版时待执行的测试脚本 ${script}`)
      await runTestScript(test, opts, script)
    }
    // 续跑会话已经开过并被打断 → 从它分叉恢复,把那一轮已积累的上下文接回来。
    if (record?.nextSession && (await seedSessionFork(client, chain, record.nextSession, `${test.label} 测试交接 #${handovers} 续跑`))) {
      log(`↻ ${test.label} 恢复中断: 中断前的续跑会话 ${record.nextSession} 尚存,已分叉副本接回`)
    }
    continuation = true
    await saveHandover(dir, {
      ...(record ?? { task: task.id, scope: handoff, unit, n: handovers }),
      n: handovers,
      script: undefined,
      seq: undefined,
      pinSession: undefined,
      pinMessage: undefined,
      nextSession: undefined,
    })
  }
  for (;;) {
    const extra = continuation
      ? `\n\n${renderTestContinue({
          handoffFile: archived,
          run: test.last,
          stuck: handovers > TEST_HANDOVER_ADVISORY ? handovers : undefined,
        })}`
      : ""
    const prompt = firstPrompt ?? promptText + extra
    firstPrompt = undefined
    const result = await runSession(client, task, prompt, opts, chain, steer, test)
    test.resumeWrapup = false
    // 阻塞退出保留在途记录: 人工处置后重新运行时,状态机据它落回被打断的位置。
    if (result.type === "blocked") return result
    // 会话自然结束 = 本执行范围的交接循环闭环,记录随之作废。
    if (!result.testHandover) {
      await forgetHandover(dir)
      return result
    }
    handovers++
    test.handovers = handovers
    // 并发态的漂移登记(E3): 定版之后、提交 #2 之前比对**已跟踪**的非文档改动——
    // 非空即说明本次测试面对的定版快照与将要落账的树不是同一份。只记事实,不
    // stash、不重跑、不阻塞(重测守卫已退役,见 docs/test-handover-early-design.md §H)。
    // 必须在提交 #2 之前做: 提交之后 diff 恒空,什么也看不见。
    if (autoSwitches().handoverConcurrent) {
      const drifted = await trackedSourceChanges(dir)
      if (drifted.length) {
        log(
          `⚠ ${test.label} 并发态: 交接收尾期间改动了被测内容(${drifted.slice(0, 3).join(", ")}${drifted.length > 3 ? " 等" : ""}),` +
            `本次测试跑的是定版快照,判读时以交接文档为准`,
        )
      }
    }
    archived = archivedTestHandoff(handoff, handovers)
    await archiveHandoff(dir, handoff, handoff, handovers)
    // 提交 #2(交接确认): 会话收尾落盘的成果 + 归档交接文档一并落账。单元尚未
    // 收口,不传 baseline。
    const subject = suffixedTitle(test.subject, `测试交接 #${handovers}`)
    const committed = await afterSession(dir, opts, task, { stage: `${unit} handoff-${handovers}`, subject })
    if (committed.type === "failed") return commitBlocked(subject, committed)
    // 顺序态(缺省,E1): 交接收口之后才执行——被测的就是提交 #2 的那一份树。脚本
    // 自身若改写了跟踪文件(如 rustfmt apply),留作未提交增量,由下一单元的提交吸纳。
    if (test.pending) {
      const pending = test.pending
      test.pending = undefined
      await runTestScript(test, opts, pending.script, pending.seq)
    }
    // 收口完成: 在途记录进入"已收口"态——待跑脚本已消费、定版锚点作废,余下的
    // 身份信息只剩下一会儿要开的续跑会话(由 attempt 回填 nextSession)。
    await saveHandover(dir, { task: task.id, scope: handoff, unit, n: handovers })
    log(`↻ ${test.label} 上下文达到上限,已交接 ${archived},新会话继续(第 ${handovers} 次测试交接)`)
    continuation = true
  }
}

// 定版点分叉(F5): 从记录的定版会话在定版那一刻的状态分叉出新会话,用于重做
// 被打断的交接收尾。server 的 fork 语义是"复制 target **之前**的消息",故锚点取
// 定版时观测到的末条消息的**后一条**;取不到(消息已被清理、锚点就是末条)时整份
// 分叉——收尾提示词重下一遍,会话至多把收尾做两遍,不会丢东西。
export async function seedPinFork(client: OpencodeClient, chain: SessionChain, record: Handover, subject: string): Promise<boolean> {
  if (!record.pinSession || !(await sessionAlive(client, record.pinSession))) return false
  let anchor: string | undefined
  if (record.pinMessage) {
    const got = await client.session.messages({ sessionID: record.pinSession }).catch(() => undefined)
    const list = got && !got.error ? got.data : []
    const at = list.findIndex((message) => message.info.id === record.pinMessage)
    anchor = at >= 0 ? list[at + 1]?.info.id : undefined
  }
  const forked = await forkSession(client, record.pinSession, subject, anchor)
  if (!forked) return false
  chain.id = undefined
  chain.pending = forked
  chain.pct = 100
  // 分叉前缀的用量无法廉价测得,归零处理: attempt 对非复用会话本就把
  // test.startUsed 归零,链内后续复用决策在本回合结束后即被真实用量覆盖。
  chain.used = 0
  chain.at = 0
  // 收尾指令自成一体,不再叠加恢复说明(那是给冷启动会话读的)。
  chain.note = undefined
  return true
}

// 整份分叉一个尚存的会话(F5,续跑会话被打断时接回其上下文);不可用返回 false,
// 调用方按冷启动继续。
async function seedSessionFork(client: OpencodeClient, chain: SessionChain, session: string, subject: string): Promise<boolean> {
  if (!(await sessionAlive(client, session))) return false
  const forked = await forkSession(client, session, subject)
  if (!forked) return false
  chain.id = undefined
  chain.pending = forked
  chain.pct = 100
  chain.used = await sessionUsed(client, session).catch(() => 0)
  chain.at = 0
  return true
}

// 拆分期兼容再导出(docs/module-split-plan.md §D.3): 这些符号已迁往 src/opts.ts 等新模块,
// 此处保留 `runner` 子路径的旧入口,使壳包与既有单测无需随拆分同步改动。
// 收尾步骤(S12)复核最终留存面——壳包只消费 PermissionMode / SubtaskMode。
export type { Opts, Outcome, UnitStop, SessionCommit, PermissionMode, SubtaskMode } from "./opts"
export type { SessionChain, FailedSession, ForkBaseInfo, ErrorClass, ErrorInfo } from "./chain"
export { phaseToRole, roleOf, resolveModel, splitModel, classifySessionError } from "./chain"
export { afterSession, autoAnswer, gatedAutoCorrectRefs, gatedTaskRefGap, resumeModelNow, strictResumeActive } from "./unit-commit"
export type { UnitRerunCtx } from "./resume-gate"
export { unitReruns, phaseText, resumeNote } from "./resume-gate"
export { askHuman, forkSession, seedForkSession, sessionUsage } from "./session-api"
export type { Steer, TestRun } from "./testrun"
export { cleanTestHandoffs, handoffSteer, handoverDue, resolveTestScript, restoreTestHandoffs, testHandoverDue } from "./testrun"
export type { RetryDecision } from "./session"
export { ensureForkBase, retryDecision, runSession } from "./session"
export { requireArtifact } from "./artifact"
