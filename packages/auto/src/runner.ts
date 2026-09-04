import { createInterface } from "node:readline/promises"
import { mkdir, readdir, rm } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import type { OpencodeClient, Part } from "@opencode-ai/sdk/v2"
import type { Interactive } from "./interactive"
import { commitTitle, commitTree } from "./git"
import { autobanner, log, subbanner, vlog } from "./log"
import type { ModeSpec } from "./mode"
import {
  appendSubtasks,
  begin,
  countSubtasks,
  load,
  markDone,
  parse,
  parseFinalMark,
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
  renderHandoffSteer,
  renderReview,
  renderReviewFix,
  renderSubtask,
  renderTestContinue,
  renderTestHandover,
  renderTestResult,
  renderVerifyJudge,
  renderVerifyScriptGen,
  renderWhole,
  renderWrapup,
  REVIEW_FILE,
  testHandoffFile,
  VERDICT_FILE,
  type TestRunInfo,
  type VerifyRun,
} from "./prompt"
import { allowWrite, reprotect } from "./protect"
import { forgetProgress, recallProgress, saveProgress, type Phase } from "./resume"
import type { ServerControl } from "./server"
import { resolveVerifyScript, runVerifyScript, verifyTmpDir } from "./verify"

export type Outcome = { type: "completed" } | { type: "blocked"; question: string } | { type: "incomplete"; reason: string }

// Questions get this fixed autonomous reply when no human answers in time
// (or --wait-answer was not given for non-permission questions); only a
// repeated question on the same issue escalates to human intervention.
// The reply also requires the agent to record its decision process, and any
// decision touching architecture or code must be marked AUTO-DECISION.
const AUTO_ANSWER =
  "你根据情况来自主决策如何做即可,如果当前阶段已经完成,直接转下一个阶段。" +
  "请记录决策过程:把决策理由与考虑过(并否决)的备选方案写入相关文档(docs/ 设计文档或报告);" +
  "涉及架构设计或代码变更的决策,须在设计文档或代码注释中以 `AUTO-DECISION: <决策与理由>` 行明确标注。"

// A failing task-level acceptance feeds the gap back into the execution
// session chain; after this many unsuccessful fix rounds the task blocks for
// human intervention.
const FIX_ROUNDS = 3

// 会话后统一提交(收回 AI 提交权,见 src/git.ts): 每个会话结束且 driver 完成
// 状态写入(tick 勾选等)后调用,递归提交全部改动——git 历史即 AI 变更的审计
// 轨迹,回滚粒度 = 会话。--commit false 与 dryrun 跳过。
async function afterSession(
  dir: string | undefined,
  opts: Opts,
  task: { id: string; title: string },
  info: { stage: string; subject: string },
): Promise<void> {
  if (!dir || opts.commit === false || opts.dryrun) return
  await commitTree(dir, task, info)
}

// --subtask 三档: off(单会话完成)/ auto(自动分解,缺省;子任务会话上下文达到
// 2x --context-limit 时同样交接文档 + 新会话续跑)/ ondemand(单会话执行,
// 上下文达到 2x --context-limit 时交接文档 + 新会话续跑)。
export type SubtaskMode = "off" | "auto" | "ondemand"

// --permission 四档: 权限请求(permission.asked)的处理策略,缺省 ask-deny。
// auto-allow 立即自动授权(always 放行,不等待);ask-* 先等人工(--wait-answer
// 分钟,未设则不等待即视为超时;allow/yes/y 等回答视为授权,明确拒绝的回答拒绝
// 该权限但会话继续),超时分别回落:ask-allow 自动授权 / ask-deny 自动拒绝但会话
// 继续(AI 无授权绕开) / ask-fail 拒绝并退出运行(阻塞停机)。
export type PermissionMode = "auto-allow" | "ask-allow" | "ask-deny" | "ask-fail"

// 会话级选项: runTask/runOnce 与终审任务生成会话(src/final.ts 复用
// requireArtifact)共用的透传参数。
export type Opts = {
  agent?: string
  // 目标目录;用于下发失败时检测 agent 契约文件缺失并给出恢复提示。
  dir?: string
  verbose?: boolean
  waitAnswer?: number
  // --commit false: 关闭 driver 的会话后统一提交(缺省启用;提交机制见 src/git.ts)。
  commit?: boolean
  subtask?: SubtaskMode
  // --verify: 启用 driver 的任务级三段式验收(脚本准备 → driver 执行 → 独立判定);
  // 缺省不启用——任务在收尾后直接标 done(不写 verified,未经验证不落账),
  // --review 的质量审核相应改为串行执行。
  verify?: boolean
  // dryrun 会话: 权限请求自动拒绝但不中断(供 AI 记录受阻项),提问一律自动答复。
  dryrun?: boolean
  // 上下文预算基线(tokens);缺省 64k(--context-limit n 以千 tokens 计):会话
  // 复用的已用量阈值为其一半,交接 steer 阈值为其 2 倍(ondemand 整任务会话与
  // auto 子任务会话)。
  contextLimit?: number
  // --review 质量审核轮数上限(0=不启用);终审任务(final 字段)被强制置 0
  // (见 pipeline),终审任务生成会话(src/final.ts)不受影响。
  review?: number
  // --early: 审核会话挪进 verify 脚本执行窗口并行(需 review>0,设计文档 F 节),
  // 经 verifyTask 审核挂点实现。
  early?: boolean
  // --permission 四档: 权限请求的处理策略,缺省 ask-deny(见 PermissionMode)。
  permission?: PermissionMode
  // --interactive 旁路: 每个会话建立/复用时 attach,人工输入经它注入会话;
  // ask 的人工等待也改由它接收(语义不变)。
  interactive?: Interactive
  // server 控制句柄: 新会话前 syncAgents(AGENTS.md 有更新则重启 server)、
  // 网络类会话错误 restart 换新实例后重试。
  server?: ServerControl
  // driver 托管脚本的看门狗: 持续无输出的判定窗口(缺省 10 分钟)与绝对时长上限
  // (缺省不设;config 的 idleTime / idleMax 以分钟设定,verify 与 test 脚本共用)。
  idleMs?: number
  maxMs?: number
  // --test-by-driver: 测试/编译/构建等命令的执行协议(与 verify 三段式正交,
  // config.testByDriver 持久化、run 注入)——执行类会话(子任务/整任务/修复轮)
  // 不在会话内直接运行这类命令,把命令写成脚本放 test/ 目录、把脚本路径写入
  // tmp/test.sh 由 driver 执行(存在即待执行请求),driver 合并 stdout/stderr
  // 整写 tmp/test.<n>.out,退出码与输出文件路径 steer 回原会话由 AI 直读判断。
  testByDriver?: boolean
  // --handover-test(需 --test-by-driver,config 持久化): 测试失败(非零退出或
  // 看门狗超时)且会话上下文已用达到 contextLimit 时,要求 AI 写交接文档
  // docs/<id>.testhandoff.md 并结束会话,driver 开新会话据其续跑,防止在超大
  // 上下文中反复试错。
  handoverTest?: boolean
  // -m/--mode 场景模式(缺省 migrate): 透传给执行类与初始化提示词渲染。
  mode?: ModeSpec
  // --new-session: 中断恢复时跳过会话复用(即使被中断的会话仍存活也开新会话);
  // 阶段精确重入不受影响——仅放弃旧会话上下文,进度记录的 phase 照常指导续跑。
  newSession?: boolean
  // 阶段化流程下的当前阶段字母(loop 透传,缺省 undefined = 单次运行): "v"
  // (验收)阶段任务本身即检验,强制 review=0 且跳过任务级三段式验收——与终审
  // 任务的 final 字段共用同一豁免路径,为内部标记、不写 PLAN.md(设计文档
  // phases-design.md D.3)。
  phase?: "a" | "d" | "m" | "t" | "v" | "k"
}

type Watch = {
  blocked?: Outcome & { type: "blocked" }
  error?: string
  lastText: string
  // 会话结束时最近一次 assistant 消息的上下文占比(0-100);上限未知记 100。
  pct: number
  // 会话结束时最近一次 assistant 消息的上下文已用量(tokens: input + cache.read)。
  used: number
  // --handover-test: 会话在 driver 发出测试交接要求后写出交接文档并正常结束,
  // runExecSession 据此开新会话续跑。
  testHandover?: boolean
}

type SessionResult = { type: "idle"; lastText: string; testHandover?: boolean } | (Outcome & { type: "blocked" })

// 任务内所有会话(分解/子任务/修复/收尾)串成一条链: 上一会话结束时上下文
// 占比低于 REUSE_BELOW、已用量低于 contextLimit 的一半、且距其结束不超过
// REUSE_IDLE_MS 时,下次复用同一会话,否则新建。初始 pct=100 保证首个会话新建;模型上限未知时
// watch 记 100,即总是新建。phase 携带当前流水线阶段: 执行链会话据此写进度恢复
// 记录(.auto/progress.json);旁路一次性会话(requireArtifact)的链不带 phase、
// 不写记录,避免污染执行链记忆。note 为一次性附加说明(中断恢复时随首个提示词
// 带给 AI,用后即清)。subject 为本会话产出的提交标题(短标签方案): 新建会话
// 以它显式命名,复用会话跨阶段在结束时改名(见 renameSession),使会话列表
// 与 git 历史、任务进度对齐。
type SessionChain = { id?: string; pct: number; used: number; at: number; note?: string; phase?: Phase; subject?: string }

// 上下文占比低于该值(%)时复用上一会话。
const REUSE_BELOW = 50

// 会话复用的间隔上限: 距上一会话结束超过该值即视为上下文陈旧(driver 侧工作
// 如 verify 脚本执行、判定/审核会话可能耗时很久),不复用、开新会话。
const REUSE_IDLE_MS = 5 * 60 * 1000
const REUSE_IDLE_MINUTES = REUSE_IDLE_MS / 60_000

// 上下文预算默认基线(tokens);--context-limit n 以千 tokens 覆盖。会话复用阈值
// 为其一半、交接 steer 阈值为其 2 倍。
const DEFAULT_CONTEXT_LIMIT = 64_000

// Runs one task through the pipeline; the driver owns all state
// writes to PLAN.md and CURRENT.md, sessions never edit them.
// --subtask auto (default): decompose (when the task body has no checklist) →
// one session per subtask (driver ticks on trust) → wrap-up → verify.
// --subtask off: a single whole-task session → wrap-up → verify; any gap
// sends the task back to pending for a human to refine and re-run (no fix
// subtasks).
// --subtask ondemand: like off, but when the running session's context usage
// reaches 2x --context-limit the driver steers in a handoff prompt; the session
// writes docs/<id>.handoff.md and a fresh session continues from it.
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
// reuse eligibility. Permission requests follow --permission (default
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
  await begin(plan.path, task.id)
  const dir = opts.dir ?? dirname(plan.path)
  const mode = opts.subtask ?? "auto"
  const chain: SessionChain = { pct: 100, used: 0, at: Date.now() }
  // 中断恢复(进度记录): 会话半途未总结(active)且 server 上仍存在 → 复用原会话
  // 继续(与 opencode -r 同构,上下文不丢);优雅退出的总结记录、会话已不可用、
  // --new-session 显式放弃 → 新会话。两种情况首个提示词均附"[driver] 中断后的继续"
  // 说明(含按阶段的下一步指引)。
  // 交接文件优先于会话复用: 中断前会话已写出交接文档(ondemand/auto 子任务的
  // handoff.md 或 --handover-test 的 testhandoff.md)时,旧会话上下文已用满、
  // 进度由文档承载——开新会话凭交接续跑(executeWhole/runSubtask/runExecSession
  // 据文件播种 continuation)。
  const recalled = await recallProgress(dir, task.id)
  if (recalled) {
    chain.phase = recalled.phase
    const handedOff =
      recalled.active === true &&
      ((mode !== "off" && (await Bun.file(join(dir, handoffFile(task))).exists())) ||
        (opts.handoverTest === true && (await Bun.file(join(dir, testHandoffFile(task))).exists())))
    if (!handedOff && !opts.newSession && recalled.active && recalled.session && (await sessionAlive(client, recalled.session))) {
      chain.id = recalled.session
      chain.pct = 0
      chain.used = 0
      // 复用决策已在此做出;链内后续的 5 分钟复用规则从当前时刻起算。
      chain.at = Date.now()
      chain.note = resumeNote(recalled.phase, true)
      log(`↻ ${task.id} 恢复中断: ${phaseText(recalled.phase)},复用中断的会话 ${recalled.session} 继续(上下文不丢)`)
    } else {
      // --new-session 显式放弃旧会话: 立即把记录转总结态,防止本次运行在无会话
      // 阶段(如 verify 脚本执行)中断后,下次运行误复用与已推进阶段错位的旧会话。
      if (opts.newSession && recalled.active) {
        await saveProgress(dir, { ...recalled, active: false })
      }
      chain.note = resumeNote(recalled.phase, false)
      const why = handedOff ? "中断前已写出交接文档,开新会话凭交接续跑" : opts.newSession ? "--new-session 指定,开新会话继续" : "原会话不可复用,开新会话继续"
      log(`↻ ${task.id} 恢复中断: ${phaseText(recalled.phase)}(${why})`)
    }
  }
  // Mirror the task into CURRENT.md before the first session: the agent
  // contract requires every session to read it first.
  task = requireTask(await load(plan.path), task.id)
  await writeCurrent(plan.path, task, mode !== "auto")
  // 阶段持久化: 每个阶段边界推进记录(active=false,总结态);执行链会话开始/结束
  // 时由 attempt 刷新为 active=true(半途态)——此刻中断按"未总结"复用会话。
  const persistStage = async (phase: Phase) => {
    chain.phase = phase
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
    // 阶段精确重入: 记录显示已推进到收尾及之后 → off/ondemand 跳过执行阶段
    // (不重跑整任务会话;auto 的分解/子任务循环本就幂等,无需特判)。
    const resumed = resume?.kind
    if (mode === "auto") {
      await persistStage({ kind: "decompose" })
      const decomposed = await ensureDecomposed(client, plan, task, opts, chain)
      if (decomposed.type === "blocked") return decomposed
      task = decomposed.task
      // 子任务交接文档的陈旧清理(镜像 ondemand 语义): 非恢复续跑时清除上次尝试
      // 遗留;恢复续跑(active 记录)时保留,由子任务会话凭交接续跑。
      if (recalled?.active !== true) {
        await rm(join(dirname(plan.path), handoffFile(task)), { force: true })
      }
    } else if (resumed !== "wrapup" && resumed !== "verify" && resumed !== "review") {
      // 非恢复续跑才清除上次尝试遗留的交接文档;恢复时保留(其中是中断会话的进度
      // 总结,executeWhole 依其 `状态:` 行决定续跑)。
      if (mode === "ondemand" && recalled?.active !== true) {
        await rm(join(dirname(plan.path), handoffFile(task)), { force: true })
      }
      // --handover-test 的测试交接文档同理: 非恢复续跑时清除上次尝试遗留
      // (runExecSession 的交接循环在一次 runTask 调用内闭环,跨调用的遗留文档
      // 属陈旧状态;恢复续跑(active 记录)时保留,由续跑会话消费)。
      if (opts.testByDriver && recalled?.active !== true) {
        await rm(join(dirname(plan.path), testHandoffFile(task)), { force: true })
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
    const fixFile = join(dirname(plan.path), "docs", `${task.id}.fix.md`)
    const fixItems = subtasks(await Bun.file(fixFile).text().catch(() => "")).map((item) => item.text)
    const fixReady = resumedReview?.stage === "planfix" && fixItems.length > 0
    const replan = resumedReview?.stage === "planfix" && !fixReady
    // limit=0(--review 未启用或终审任务强制关闭)时补跑审核没有意义: 陈旧的
    // review 阶段恢复记录不再开审核会话,按常规循环走完直接完成。
    let enterAudit = limit > 0 && resumedReview !== undefined && (resumedReview.stage === "audit" || replan)
    let skipToInject = fixReady
    let skipWrapup = resume?.kind === "verify" || enterAudit
    let pendingVerify = resume?.kind === "verify" ? resume : undefined
    const injectFix = async (items: string[], round: number) => {
      await appendSubtasks(plan.path, task.id, items)
      await persistStage({ kind: "review", round, stage: "fixrun" })
      task = requireTask(await load(plan.path), task.id)
      await writeCurrent(plan.path, task, mode !== "auto")
    }
    for (
      let round = resumedReview ? (replan ? resumedReview.round - 1 : resumedReview.round) : 0;
      ;
    ) {
      if (skipToInject) {
        // planfix 恢复: 规划会话已产出有效检查项文件,直接注入后进入 fixrun。
        skipToInject = false
        log(`↻ ${task.id} 恢复中断: 修复检查项 ${fixFile} 已有效,直接注入(第 ${round}/${limit} 轮)`)
        await injectFix(fixItems, round)
        continue
      }
      let audit: Verdict | (Outcome & { type: "blocked" })
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
          const blocked = await runSubtask(client, plan, task, items[index].text, index + 1, opts, chain)
          if (blocked) return blocked
          task = requireTask(await load(plan.path), task.id)
          await writeCurrent(plan.path, task, mode !== "auto")
        }
        // 收尾会话: verify/review(audit) 阶段恢复时跳过(此前已完成,重跑纯浪费)。
        if (!skipWrapup) {
          await persistStage({ kind: "wrapup" })
          autobanner(`${task.id} ${task.title}: 收尾`)
          const subject = `${task.id} wrapup ${task.title}`
          chain.subject = subject
          const result = await runSession(client, task, renderWrapup(plan, task, { mode: opts.mode, verify: opts.verify, solo: mode !== "auto" }), opts, chain)
          if (result.type === "blocked") return result
          await afterSession(dir, opts, task, { stage: "wrapup", subject })
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
          if (verdict.type === "blocked") return verdict
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
      if (audit.type === "blocked") return audit
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
      if (planned.type === "blocked") return planned
      await injectFix(planned.items, round)
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
): Promise<(Outcome & { type: "blocked" }) | undefined> {
  const cap = opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT
  const file = join(dirname(plan.path), handoffFile(task))
  const steer = ondemand ? { limit: cap * 2, text: renderHandoffSteer(task) } : undefined
  const subject = `${task.id} exec ${task.title}`
  chain.subject = subject
  // 中断恢复播种: 陈旧交接文档由 pipeline 在非恢复路径清除,此处文件仍存在即
  // active 恢复——中断前已交接。状态=完成 → 执行阶段已完成,跳过整任务会话;
  // 状态=继续 → 以续跑提示开新会话凭交接继续(复用旧会话只会立刻再触上限)。
  const prior = ondemand ? /状态[:：]\s*(继续|完成)/.exec(await Bun.file(file).text().catch(() => ""))?.[1] : undefined
  if (prior === "完成") {
    log(`↻ ${task.id} 恢复中断: 交接文档 ${handoffFile(task)} 标记执行已完成,跳过整任务会话`)
    return undefined
  }
  let continuation = prior === "继续"
  if (continuation) log(`↻ ${task.id} 恢复中断: 中断前已交接 ${handoffFile(task)},新会话凭交接文档续跑`)
  let feedback = ""
  let retried = false
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
    if (result.type === "blocked") return result
    await afterSession(opts.dir ?? dirname(plan.path), opts, task, { stage: "execute", subject })
    // 未触发交接阈值(2x cap)即结束 = 任务在单会话内自然完成。
    if (!ondemand || chain.used < cap * 2) return undefined
    const status = /状态[:：]\s*(继续|完成)/.exec(await Bun.file(file).text().catch(() => ""))?.[1]
    if (status === "完成") return undefined
    if (status === "继续") {
      log(`↻ ${task.id} 上下文达到 ${formatTokens(cap * 2)} 上限,已交接 ${handoffFile(task)},新会话继续`)
      continuation = true
      feedback = ""
      continue
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

// CURRENT.md mirrors the task in progress; the agent contract makes every
// session read it first, so the current task survives context compaction.
// The server re-reads it on every provider turn, so no restart is needed.
// remark: 非完成结局保留文件时附带的"中断备注"(退出原因/阶段/恢复方式)。
async function writeCurrent(path: string, task: Task, solo = false, remark?: string) {
  const progress = countSubtasks(task.body)
  const content = [
    `# 当前任务(由 opencode-auto 维护,请勿手工编辑)`,
    ``,
    `## ${task.id}: ${task.title} [${task.status}]`,
    ...(task.verify ? [`  - verify: ${task.verify}`] : []),
    ``,
    task.body,
    ``,
    progress.total ? `进度: 子任务 ${progress.done}/${progress.total}` : solo ? `进度: 单会话执行(无子任务划分)` : `进度: 分解中`,
    ``,
    ...(remark ? [remark, ""] : []),
  ].join("\n")
  const file = join(dirname(path), "CURRENT.md")
  await allowWrite(file)
  await Bun.write(file, content)
  await reprotect(file)
}

// 任务完成才删除 CURRENT.md;阻塞/回退 pending 时由 runTask 写中断备注后保留,
// 强制中断遗留的文件在下次任务开始时由 writeCurrent 重建。
async function removeCurrent(path: string) {
  const file = join(dirname(path), "CURRENT.md")
  await allowWrite(file)
  await rm(file, { force: true })
}

// 阶段的人类可读描述(恢复日志与 CURRENT.md 中断备注共用)。
export function phaseText(phase: Phase | undefined): string {
  switch (phase?.kind) {
    case undefined:
      return "未记录阶段(按默认流程)"
    case "decompose":
      return "任务分解阶段(检查项尚未注入)"
    case "whole":
      return "整任务单会话执行阶段"
    case "subtasks":
      return "逐子任务执行阶段(从首个未勾选项继续)"
    case "wrapup":
      return "收尾阶段(docs 报告与提交)"
    case "verify":
      return `任务级验收(修复轮 ${phase.round}/${FIX_ROUNDS - 1}${phase.rechecks ? `,重验轮 ${phase.rechecks}/${REVERIFY_ROUNDS}` : ""},${
        phase.stage === "fix"
          ? "修复轮进行中(差距反馈已下发)"
          : phase.run
            ? "脚本已执行完毕待判定"
            : phase.stage === "generate"
              ? "待生成验证脚本"
              : phase.stage === "judge"
                ? "待判定"
                : "待执行验证脚本"
      })`
    case "review":
      return `质量审核(第 ${phase.round} 轮,${{ audit: "审核会话", planfix: "修复规划", fixrun: "修复检查项执行" }[phase.stage]})`
  }
}

// 中断恢复时随首个提示词注入的"[driver] 中断后的继续"说明: 按记录的阶段给出
// 具体的下一步指引,使 AI 不重做已完成的工作。
function resumeNote(phase: Phase | undefined, reused: boolean): string {
  const next = nextStepText(phase)
  return (
    `[driver] 该任务(或其某个子任务)此前的执行因应用中断而停止。` +
    (reused ? `你正在原来中断的会话中继续。` : `部分工作可能已完成。`) +
    `先读 CURRENT.md 了解当前任务与进度,并以 git status / git diff 核对工作区实际状态。` +
    `${next}不要重做已完成的工作。`
  )
}

function nextStepText(phase: Phase | undefined): string {
  switch (phase?.kind) {
    case undefined:
      return ""
    case "decompose":
      return `当前处于任务分解阶段:检查项尚未注入 PLAN.md。`
    case "whole":
      return `当前处于整任务单会话执行阶段。`
    case "subtasks":
      return `当前处于逐子任务执行阶段:从 PLAN.md 检查项中首个未勾选项继续。`
    case "wrapup":
      return `全部检查项已完成,当前处于收尾阶段(更新 docs/ 报告并提交)。`
    case "verify":
      return phase.stage === "fix"
        ? `任务级验收发现差距,当前处于修复阶段:按反馈的差距继续修复,完成后由 driver 重新执行验证脚本并判定。`
        : phase.run
          ? `任务级验收的验证脚本已由 driver 执行完毕(输出在 tmp/verify.out),本会话为独立判定会话。`
          : `当前处于任务级验收阶段:验证脚本由 driver 在会话外执行,你不要亲自运行。`
    case "review":
      return phase.stage === "audit"
        ? `任务级验收已通过,当前处于质量审核阶段。`
        : `当前处于质量审核差距的修复阶段:按 PLAN.md 中未勾选的修复检查项继续。`
  }
}

// CURRENT.md 的中断备注(非完成结局保留文件时写入): 退出原因、阶段快照与恢复
// 方式;下次运行重建镜像时,要点经恢复提示词(resumeNote)带给 AI。
function interruptionRemark(outcome: Outcome, phase: Phase | undefined): string {
  const why =
    outcome.type === "blocked"
      ? `阻塞: ${firstLine(outcome.question)}`
      : outcome.type === "incomplete"
        ? `未完成回退 pending: ${firstLine(outcome.reason)}`
        : `完成`
  return [
    `## 中断备注(opencode-auto)`,
    ``,
    `- 退出时间: ${new Date().toISOString()}`,
    `- 退出原因: ${why}`,
    `- 中断阶段: ${phaseText(phase)}`,
    `- 恢复方式: 处理上述原因后重新运行 opencode-auto run,driver 将按中断阶段精确继续;本备注要点会随恢复提示词带给 AI。`,
  ].join("\n")
}

function firstLine(text: string): string {
  return text.split("\n")[0]!.slice(0, 200)
}

// Ensures the task body has a checklist: tasks resuming with one (or with a
// human-written one) are used as-is; otherwise a decomposition session writes
// docs/<id>.subtasks.md and the driver injects the items into PLAN.md.
// 中断恢复: 分解会话可能已写出文件但尚未注入——先直读文件,有效则直接注入,
// 不再开会话。
async function ensureDecomposed(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
): Promise<({ type: "ok" } & { task: Task }) | (Outcome & { type: "blocked" })> {
  if (subtasks(task.body).length) return { type: "ok", task }
  const file = join(dirname(plan.path), "docs", `${task.id}.subtasks.md`)
  const existing = subtasks(await Bun.file(file).text().catch(() => "")).map((item) => item.text)
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
  for (let i = 0; ; i++) {
    const result = await runSession(client, task, renderDecompose(plan, task, opts) + feedback, opts, chain)
    if (result.type === "blocked") return result
    const items = subtasks(await Bun.file(file).text().catch(() => "")).map((item) => item.text)
    if (items.length) {
      await setSubtasks(plan.path, task.id, items)
      await afterSession(opts.dir ?? dirname(plan.path), opts, task, { stage: "decompose", subject })
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
// docs/<id>.handoff.md): 会话进行中上下文已用量达到 2x --context-limit 时
// driver steer 交接提示,会话写出交接文档(末行 `状态: 继续|完成`,以本子任务
// 是否完成计)后换新会话凭交接续跑,直到自然完成或交接文档标记完成;子任务
// 完成后清除交接文档,下一子任务重新起算。
async function runSubtask(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  text: string,
  index: number,
  opts: Opts,
  chain: SessionChain,
): Promise<(Outcome & { type: "blocked" }) | undefined> {
  subbanner(`${task.id} 子任务 ${index}：${text.length > 50 ? `${text.slice(0, 50)}…` : text}`)
  const subject = `${task.id} S${index} ${text}`
  chain.subject = subject
  const dir = opts.dir ?? dirname(plan.path)
  const cap = opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT
  const steer: Steer = { limit: cap * 2, text: renderHandoffSteer(task) }
  const file = join(dirname(plan.path), handoffFile(task))
  // 中断恢复播种: 陈旧交接文档由 pipeline 在非恢复路径清除,此处文件仍存在且
  // 状态=完成 → 子任务在中断前已由交接会话完成,直接勾选;状态=继续 → 以续跑
  // 提示开新会话凭交接继续(复用旧会话只会立刻再触上限)。
  const prior = /状态[:：]\s*(继续|完成)/.exec(await Bun.file(file).text().catch(() => ""))?.[1]
  if (prior === "完成") {
    log(`↻ ${task.id} 恢复中断: 交接文档 ${handoffFile(task)} 标记子任务已完成,直接勾选`)
  } else {
    let continuation = prior === "继续"
    if (continuation) log(`↻ ${task.id} 恢复中断: 中断前已交接 ${handoffFile(task)},新会话凭交接文档续跑子任务`)
    let feedback = ""
    let retried = false
    for (;;) {
      const result = await runExecSession(
        client,
        plan,
        task,
        renderSubtask(plan, task, text, { ...opts, continuation }) + feedback,
        opts,
        chain,
        steer,
      )
      if (result.type === "blocked") return result
      // 未触发交接阈值(2x cap)即结束 = 子任务在单会话内自然完成,勾选后统一提交。
      if (chain.used < cap * 2) break
      const status = /状态[:：]\s*(继续|完成)/.exec(await Bun.file(file).text().catch(() => ""))?.[1]
      if (status === "完成") break
      // 交接续跑/带反馈重试前先把本会话产出提交(下一会话从已提交的工作区继续)。
      await afterSession(dir, opts, task, { stage: `subtask ${index}`, subject })
      if (status === "继续") {
        log(`↻ ${task.id} 子任务 ${index} 上下文达到 ${formatTokens(cap * 2)} 上限,已交接 ${handoffFile(task)},新会话继续`)
        continuation = true
        feedback = ""
        continue
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
  // 子任务完成: 清除交接文档(下一子任务重新起算),driver 勾选后统一提交。
  await rm(file, { force: true })
  await tick(plan.path, task.id, text)
  // 子任务提交信息省略任务标题(编号 + 子任务编号 + 子任务标题即可定位)。
  await afterSession(dir, opts, task, { stage: `subtask ${index}`, subject })
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
  audit?: () => Promise<Verdict | (Outcome & { type: "blocked" })>,
  persist?: (phase: Phase) => Promise<void>,
  resume?: Phase & { kind: "verify" },
): Promise<{ type: "done"; audit?: Verdict } | { type: "gap"; gap: string } | (Outcome & { type: "blocked" })> {
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
  const fixRound = async (gap: string, round: number): Promise<(Outcome & { type: "blocked" }) | undefined> => {
    const fixSubject = `${task.id} fix${round} ${task.title}`
    chain.subject = fixSubject
    const fixed = await runExecSession(client, plan, task, renderFix(plan, task, gap, opts), opts, chain)
    if (fixed.type === "blocked") return fixed
    await afterSession(dir, opts, task, { stage: `fix ${round}`, subject: fixSubject })
    autobanner(`${task.id} ${task.title}: 收尾`)
    const wrapSubject = `${task.id} wrapup ${task.title}`
    chain.subject = wrapSubject
    const wrapped = await runSession(client, task, renderWrapup(plan, task, { mode: opts.mode, verify: opts.verify, solo: mode !== "auto" }), opts, chain)
    if (wrapped.type === "blocked") return wrapped
    await afterSession(dir, opts, task, { stage: "wrapup", subject: wrapSubject })
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
    let execution: { type: "ok"; run: VerifyRun; audit?: Verdict } | (Outcome & { type: "blocked" })
    if (pending?.run) {
      // 中断恢复: 脚本已执行完毕且运行记录已持久化——不重跑脚本;early 且审核
      // 结论缺失时先补跑审核会话,然后直接进入判定。
      let auditVerdict: (typeof pending.audit) | undefined = pending.audit
      if (!auditVerdict && audit) {
        const fresh = await audit()
        if (fresh.type === "blocked") return fresh
        auditVerdict = fresh
      }
      log(`↻ ${task.id} 恢复中断: verify 脚本上次已执行完毕(${pending.run.script}),直接进入判定`)
      execution = { type: "ok", run: pending.run, audit: auditVerdict }
    } else {
      execution = await executeVerifyScript(client, plan, task, opts, audit, replaced ? replacement : undefined, persist, counters)
    }
    pending = undefined
    if (execution.type === "blocked") return execution
    await persist?.({ kind: "verify", stage: "judge", ...counters, run: execution.run, audit: execution.audit })
    const verdict = await judge(client, plan, task, opts, execution.run)
    if (verdict.type === "blocked") return verdict
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

// 判定会话替换脚本的重验轮数上限(独立于修复轮预算)。
const REVERIFY_ROUNDS = 3

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
  audit?: () => Promise<Verdict | (Outcome & { type: "blocked" })>,
  override?: string,
  persist?: (phase: Phase) => Promise<void>,
  counters: { round: number; rechecks: number; replaced: boolean } = { round: 0, rechecks: 0, replaced: false },
): Promise<{ type: "ok"; run: VerifyRun; audit?: Verdict } | (Outcome & { type: "blocked" })> {
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
  if (audited?.type === "blocked") return audited
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
): Promise<Verdict | (Outcome & { type: "blocked" })> {
  autobanner(`${task.id} ${task.title}: 验收判定`)
  const file = join(dirname(plan.path), VERDICT_FILE)
  const snapshot = await Bun.file(plan.path).text()
  await allowWrite(plan.path)
  try {
    // 重新加载计划: 此前轮次的判定会话可能已更新后续任务的 verify 字段。
    return await requireArtifact(client, task, renderVerifyJudge(await load(plan.path), task, run, opts), opts, {
      kind: "审核",
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
): Promise<(Outcome & { type: "blocked" }) | undefined> {
  autobanner(`${task.id} ${task.title}: 验收脚本生成`)
  const produced = await requireArtifact(client, task, renderVerifyScriptGen(plan, task, script, opts), opts, {
    kind: "脚本生成",
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
): Promise<Verdict | (Outcome & { type: "blocked" })> {
  // 重新加载计划判定 final: 串行路径下当前任务刚被 verifyTask 标 done;early
  // 窗口下审核先于 markDone 启动,但 final 只看后继任务,两者结论一致。
  const current = await load(plan.path)
  const index = current.tasks.findIndex((item) => item.id === task.id)
  const final = current.tasks.slice(index + 1).every((item) => item.status === "done")
  autobanner(`${task.id} ${task.title}: ${final ? "最终质量审核(全计划)" : "质量审核"}${early ? "(与 verify 脚本并行)" : ""}`)
  const file = join(dirname(plan.path), REVIEW_FILE)
  return requireArtifact(client, task, renderReview(current, task, { final, early, verify: opts.verify }), opts, {
    kind: "质量审核",
    artifact: `有效结论文件 ${REVIEW_FILE}`,
    detail: "缺失或无结论行",
    requirement: "无论审核结论如何,都必须写出该文件,且最后一行为 `结论: 通过` 或 `结论: 差距 <描述>`。",
    commit: { stage: "review", subject: final ? `${task.id} final ${task.title}` : `${task.id} review ${task.title}` },
    reset: () => rm(file, { force: true }),
    collect: async () => parseVerdict(await Bun.file(file).text().catch(() => "")),
  })
}

// 审核差距 → 旁路修复规划会话(设计文档 B.4): 产出 docs/<id>.fix.md 检查项,
// 调用方经 appendSubtasks 注入 PLAN.md,交既有子任务会话机制执行。
async function planReviewFix(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  gap: string,
): Promise<{ type: "ok"; items: string[] } | (Outcome & { type: "blocked" })> {
  autobanner(`${task.id} ${task.title}: 审核修复规划`)
  const file = join(dirname(plan.path), "docs", `${task.id}.fix.md`)
  const collected = await requireArtifact(client, task, renderReviewFix(plan, task, gap, opts), opts, {
    kind: "修复规划",
    artifact: `有效修复检查项文件 docs/${task.id}.fix.md`,
    detail: "缺失或无检查项",
    requirement: "必须把修复检查项写入该文件(每条差距至少一项)。",
    commit: { stage: "review-fix", subject: `${task.id} planfix ${task.title}` },
    reset: () => rm(file, { force: true }),
    collect: async () => {
      const items = subtasks(await Bun.file(file).text().catch(() => ""))
      return items.length ? items.map((item) => item.text) : undefined
    },
  })
  if (!Array.isArray(collected)) return collected
  return { type: "ok", items: collected }
}

// “旁路会话必须产出文件”的通用骨架(设计文档 A.4): 会话结束但产物缺失或无效时
// 带反馈重试一次,仍失败按隐性阻塞停机(人工检查后重新运行续跑)。脚本生成、
// 判定、质量审核、修复规划与终审任务生成(src/final.ts)会话共用;collect 返回
// undefined 表示该次会话未产出有效产物。spec.commit 声明该类会话的统一提交信息
// (会话结束即提交;判定会话的 PLAN.md 越权还原发生在提交之后时,还原差异由
// 下一次提交清扫,历史中保留越权记录本身亦是审计事实)。
export async function requireArtifact<T>(
  client: OpencodeClient,
  task: Task,
  promptText: string,
  opts: Opts,
  spec: {
    // 会话类型,用于日志与阻塞信息(如“审核”、“脚本生成”)。
    kind: string
    // 产物描述(如 `有效判定文件 ${VERDICT_FILE}`)。
    artifact: string
    // 阻塞信息中的缺失原因补充(如“缺失或无结论行”)。
    detail?: string
    // 重试反馈中的硬性要求。
    requirement: string
    // 每次会话前清理旧产物,避免会话未写出时被误当作本次产出。
    reset?: () => Promise<void>
    // 会话结束后采集产物。
    collect: () => Promise<T | undefined>
    // 会话后统一提交的信息(阶段 trailer 与标题行;缺省不提交)。
    commit?: { stage: string; subject: string }
  },
): Promise<T | (Outcome & { type: "blocked" })> {
  let feedback = ""
  for (let i = 0; ; i++) {
    await spec.reset?.()
    // 旁路一次性会话: 链上不携带阶段(phase),不写进度恢复记录;subject 使新建
    // 会话同样以提交标题显式命名。
    const result = await runSession(client, task, promptText + feedback, opts, { pct: 100, used: 0, at: 0, subject: spec.commit?.subject })
    if (result.type === "blocked") return result
    if (spec.commit) await afterSession(opts.dir, opts, task, spec.commit)
    const value = await spec.collect()
    if (value !== undefined) return value
    if (i === 1) {
      return {
        type: "blocked",
        question:
          `${spec.kind}会话两次结束但未产出${spec.artifact}${spec.detail ? `(${spec.detail})` : ""}(隐性阻塞)。` +
          `请检查后重新运行。${spec.kind}会话最后的输出:\n${result.lastText.trim().slice(-2000) || "(无输出)"}`,
      }
    }
    log(`↻ ${task.id} ${spec.kind}会话未产出${spec.artifact},带反馈重试一次`)
    feedback = `\n\n你上次结束会话但未产出${spec.artifact}。这是硬性要求:${spec.requirement}`
  }
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

// Runs one prompt on the session chain (reusing the previous session when its
// context ended below REUSE_BELOW and within REUSE_IDLE_MS). Transient
// provider failures (session.error, e.g. malformed reasoning content from a
// gateway) are retried in a fresh session before blocking; network/server
// failures (Internal network failure / Network error 等) additionally restart
// the spawned opencode server before the retry.
// steer: 会话进行中已用上下文达到 limit 时,driver 向该会话插入一次 text
// (handoff-steer 交接提示;v2 prompt 默认 steer,在下一个 provider turn 边界生效)。
type Steer = { limit: number; text: string }

// --test-by-driver 的测试执行协议状态(watch 与 runExecSession 共享,跨会话/
// 跨运行持续): tmp 为目标目录下 driver 工作目录(tmp/);seq 为按序归档编号
// (初始化时扫描既有 tmp/test.<n>.out 取最大值——每次执行都会产出 .out,故以
// 它为编号基准;test/ 脚本路径形态不另产 .sh,内联形态产 tmp/test.<n>.sh);
// handoffFile 为 --handover-test 交接文档绝对路径;handover 开关;limit 为上下文
// 已用量上限(config.contextLimit 原值;ondemand 的交接 steer 用其 2 倍);
// last 为最近一次执行信息(continuation 提示引用其输出路径)。
type TestRun = {
  dir: string
  tmp: string
  handoffFile: string
  handover: boolean
  limit: number
  seq: number
  last?: TestRunInfo
}

// 测试交接连续超过该次数时,continuation 提示附带"是否陷入无法解决的问题"评估
// (AUTO-FIXME 标注遗留后继续);不设硬上限,不阻塞。
const TEST_HANDOVER_ADVISORY = 10

// 执行类会话(子任务/整任务/修复轮)的统一入口: --test-by-driver 未启用时直通
// runSession;启用时包装测试交接循环——会话因测试失败且上下文达上限交结束后,
// 以 continuation 提示(先读交接文档与最近输出)开新会话续跑,直至会话自然完成。
// 交接次数不设硬上限,超过 TEST_HANDOVER_ADVISORY 时提示 AI 评估是否陷入无法
// 解决的问题(可 AUTO-FIXME 标注遗留后继续)。
async function runExecSession(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  promptText: string,
  opts: Opts,
  chain: SessionChain,
  steer?: Steer,
): Promise<SessionResult> {
  if (!opts.testByDriver || opts.dryrun) return runSession(client, task, promptText, opts, chain, steer)
  const dir = opts.dir ?? dirname(plan.path)
  const tmp = verifyTmpDir(dir)
  const test: TestRun = {
    dir,
    tmp,
    handoffFile: join(dir, testHandoffFile(task)),
    handover: opts.handoverTest === true,
    limit: opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT,
    seq: await latestTestSeq(tmp),
  }
  // 中断恢复播种: 陈旧测试交接文档由 pipeline 在非恢复路径清除,此处文件仍非空即
  // active 恢复——中断前已完成测试交接,首个会话即以续跑提示凭交接文档继续。
  let continuation = (await Bun.file(test.handoffFile).text().catch(() => "")).trim() !== ""
  if (continuation) log(`↻ ${task.id} 恢复中断: 中断前已测试交接 ${testHandoffFile(task)},新会话凭交接文档续跑`)
  let handovers = 0
  for (;;) {
    const extra = continuation
      ? `\n\n${renderTestContinue({
          handoffFile: testHandoffFile(task),
          run: test.last,
          stuck: handovers > TEST_HANDOVER_ADVISORY ? handovers : undefined,
        })}`
      : ""
    const result = await runSession(client, task, promptText + extra, opts, chain, steer, test)
    if (result.type === "blocked") return result
    if (!result.testHandover) return result
    handovers++
    log(`↻ ${task.id} 测试失败且上下文达到上限,已交接 ${testHandoffFile(task)},新会话继续(第 ${handovers} 次测试交接)`)
    continuation = true
  }
}

// 归档编号接续: 扫描 tmp/ 下既有 test.<n>.out 取最大编号(每次执行都产出 .out,
// 故覆盖 test/ 脚本路径与内联两种形态);跨会话/跨运行不覆盖。目录缺失从 0 起。
async function latestTestSeq(tmp: string): Promise<number> {
  let max = 0
  for (const file of await readdir(tmp).catch(() => [] as string[])) {
    max = Math.max(max, Number(/^test\.(\d+)\.out$/.exec(file)?.[1] ?? 0))
  }
  return max
}

// 会话错误中属于网络/服务故障的特征串;命中时先重启 server(外部 server 除外)
// 再换新会话重试,避免对着同一坏实例反复失败。
const NETWORK_FAILURE = /internal network failure|network error|fetch failed|econnrefused|econnreset|socket hang up/i

// 单个提示词在会话链上的执行(复用/新建、错误重试与 server 重启);导出供
// src/final.ts 的终审任务生成会话等旁路复用。test 为 --test-by-driver 的协议
// 状态(仅执行类会话经 runExecSession 传入;旁路会话不传,协议不生效)。
export async function runSession(
  client: OpencodeClient,
  task: Task,
  promptText: string,
  opts: Opts,
  chain: SessionChain,
  steer?: Steer,
  test?: TestRun,
): Promise<SessionResult> {
  for (let i = 1; ; i++) {
    const result = await attempt(client, task, promptText, opts, chain, steer, test)
    const transient = result.type === "blocked" && result.question.startsWith("会话错误:")
    if (!transient) return result
    if (i === RETRIES) return { type: "blocked", question: `${result.question}\n(已换新会话自动重试 ${RETRIES - 1} 次仍失败)` }
    if (opts.server && NETWORK_FAILURE.test(result.question)) {
      await opts.server.restart("会话错误为网络/服务故障,重启 opencode server 后换新会话重试")
    }
    log(`↻ ${task.id} 遇到瞬时会话错误,换新会话重试(${i}/${RETRIES - 1}):\n${result.question}`)
    // 重试保持"换新会话"语义,不复用出错的会话。
    chain.id = undefined
    chain.pct = 100
  }
}

// Session errors get this many fresh-session attempts before blocking.
const RETRIES = 3

async function attempt(
  client: OpencodeClient,
  task: Task,
  promptText: string,
  opts: Opts,
  chain: SessionChain,
  steer?: Steer,
  test?: TestRun,
): Promise<SessionResult> {
  // 测试执行协议: 清除上一会话/上次运行遗留的待执行脚本(存在即请求,中断
  // 恢复或重试场景下的旧请求不应注入本会话;归档历史 tmp/test.<n>.sh 保留)。
  if (test) await rm(join(test.tmp, "test.sh"), { force: true })
  // 上一会话上下文占比低于 50%、已用量低于 contextLimit 的一半(默认 32k tokens)、
  // 且距其结束不超过 REUSE_IDLE_MS(默认 5 分钟)则复用同一会话继续,否则新建。
  const cap = opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT
  const reuse = chain.id !== undefined && chain.pct < REUSE_BELOW && chain.used < cap / 2 && Date.now() - chain.at <= REUSE_IDLE_MS
  if (reuse) {
    log(`♻ 复用会话(上下文 ${chain.pct}%,已用 ${formatTokens(chain.used)} tokens,${Math.round((Date.now() - chain.at) / 1000)} 秒前结束)`)
  }
  if (!reuse && chain.id !== undefined) {
    const reason =
      chain.pct >= REUSE_BELOW
        ? `上下文占比 ${chain.pct}% 达到 ${REUSE_BELOW}% 阈值`
        : chain.used >= cap / 2
          ? `已用 ${formatTokens(chain.used)} tokens 达到 ${formatTokens(cap / 2)} 上限(复用阈值)`
          : `距上一会话结束已超过 ${REUSE_IDLE_MINUTES} 分钟(上下文已陈旧)`
    log(`▷ ${reason},开启新会话`)
  }
  // 新会话前同步 AGENTS.md: 有更新则重启 server 再开新会话,使新会话加载最新
  // system context(AGENTS.md 每个 provider turn 现场重读,重启兜底缓存场景)。
  if (!reuse) await opts.server?.syncAgents()
  // 显式标题: 新建会话直接以本阶段提交标题命名(短标签,如 `T-001 S2 编写 schema`),
  // 无提交标题的会话(dryrun 等)回落 `[auto] <任务>`。
  const session = reuse ? undefined : await client.session.create({ title: chain.subject ? commitTitle(chain.subject) : `[auto] ${task.id} ${task.title}` })
  if (session?.error) return { type: "blocked", question: `创建会话失败: ${JSON.stringify(session.error)}` }
  const sessionID = session?.data.id ?? chain.id!
  // 交互旁路: 此后人工输入发往本会话(审核/收尾等旁路会话同样覆盖)。
  opts.interactive?.attach(sessionID)
  // 进度记录: 执行链会话(链上携带阶段)写 active 记录,应用中断后据此精确恢复;
  // 旁路一次性会话(判定/审核/脚本生成/修复规划,链上无阶段)与伪任务(PLAN/AUTO)
  // 不写,避免污染执行链记忆。
  const remember = async () => {
    if (opts.dir && task.id.startsWith("T-") && chain.phase) {
      await saveProgress(opts.dir, { task: task.id, session: sessionID, at: Date.now(), active: true, phase: chain.phase })
    }
  }
  await remember()

  const events = await client.event.subscribe()
  const watching = watch(client, sessionID, events.stream, opts, steer, test)

  // 中断恢复等一次性说明随首个提示词带给 AI,用后即清。
  const note = chain.note
  chain.note = undefined
  const prompt = await client.session.prompt({
    sessionID,
    agent: opts.agent,
    parts: [{ type: "text", text: note ? `${promptText}\n\n${note}` : promptText }],
  })
  if (prompt.error) return { type: "blocked", question: `下发任务失败: ${JSON.stringify(prompt.error)}${await missingAgentHint(opts)}` }

  const result = await watching
  chain.id = sessionID
  chain.pct = result.pct
  chain.used = result.used
  chain.at = Date.now()
  // 进度改名: 复用会话的标题停留在旧阶段,结束时改名为本阶段提交标题,使标题
  // 前缀始终反映会话的最新进度(`T-001 S1 …` → `T-001 S2 …` → `T-001 wrapup …`);
  // 新建会话已在创建时命名,无需重复。
  if (reuse && chain.subject) await renameSession(client, chain, chain.subject)
  // 会话结束但阶段尚未推进: 刷新记录时间并保持 active——此刻中断按"半途未总结"
  // 复用本会话继续(无时间窗,恢复时只看会话是否存活)。
  await remember()
  if (result.blocked) return result.blocked
  if (result.error) return { type: "blocked", question: `会话错误: ${result.error}` }
  return { type: "idle", lastText: result.lastText, testHandover: result.testHandover }
}

// 会话进度改名: 会话标题与提交标题共用同一短标签方案(`T-NNN <label> <标题/子任务>`,
// label ∈ decompose/S<n>/exec/wrapup/fix<n>/judge/script/review/final/planfix/pending/
// blocked/done 等),会话结束与任务终态时把链上会话改名为最新标签,标题前缀即任务
// 进度;改名失败仅记录明细,不影响流程。
async function renameSession(client: OpencodeClient, chain: SessionChain, subject: string): Promise<void> {
  chain.subject = subject
  if (!chain.id) return
  const renamed = await client.session.update({ sessionID: chain.id, title: commitTitle(subject) }).catch(() => undefined)
  if (renamed?.error) vlog(`会话改名失败: ${JSON.stringify(renamed.error)}`)
}

// 记忆会话是否仍存在于 server 上(opencode 会话持久化在项目存储,server 重启
// 不丢;拉取失败或不存在则视为不可复用)。
async function sessionAlive(client: OpencodeClient, id: string): Promise<boolean> {
  const got = await client.session.get({ sessionID: id }).catch(() => undefined)
  return got !== undefined && !got.error
}

// 下发任务失败的常见根因: 目标目录缺少 agent 契约文件时服务端只回
// UnknownError(错误体不含根因),此处检测并提示恢复方式。
async function missingAgentHint(opts: Opts): Promise<string> {
  if (!opts.dir) return ""
  const file = `.opencode/agent/${opts.agent ?? "auto"}.md`
  const exists = await Bun.file(join(opts.dir, file)).exists()
  if (exists) return ""
  return `\n提示: 目标目录缺少 agent 契约文件 ${file},服务端会因此以 UnknownError 拒绝下发任务;运行 opencode-auto init ${opts.dir} 恢复后重跑`
}

async function watch(
  client: OpencodeClient,
  sessionID: string,
  stream: AsyncIterable<unknown>,
  opts: Opts,
  steer?: Steer,
  test?: TestRun,
): Promise<Watch> {
  const verbose = opts.verbose
  const waitAnswer = opts.waitAnswer ?? 0
  let lastText = ""
  let error = ""
  // 上下文占比与已用量始终跟踪(会话复用决策依据),与 verbose 无关;拿不到上限记 100。
  let pct = 100
  let used = 0
  // steer 每会话只插入一次。
  let steerSent = false
  // 自动答复过的问题(同一问题重复出现仍阻塞停机)。
  const autoAnswered: string[] = []
  // --test-by-driver 测试执行协议状态: 会话 idle 时检测 tmp/test.sh(请求标记,
  // 内容为 test/ 下脚本路径或内联脚本)→ 运行该脚本 → steer 结果回本会话继续
  // 观察;--handover-test 在测试失败且 used 达上限时改为要求写交接文档,文档
  // 就绪后正常结束(testHandover)。
  let testHandover = false
  let testHandoverAsked = false
  let testHandoverRetried = false
  // 回合结束服务端连发两个 idle 事件(session.status idle + session.idle);steer
  // 经 promptAsync 投递即返回后,第二个 idle 会在 steer 回合启动前到达,照处理
  // 会误判会话结束提前 break。处理过一次 idle 后忽略后续 idle,直到本会话出现
  // 新的会话事件(新回合开始)再重新接受。
  let idleHandled = false
  // 会话经 idle 事件正常结算才置位;事件流未收 idle 即耗尽(SSE 断流: server 崩溃
  // 或网络断开)时按会话错误处理,不作正常结束——否则 driver 会误勾选子任务、把
  // 中断会话当已完成推进流水线。
  let settled = false
  // steer 投递用 promptAsync(投递即返回):v2 同步 /message 端点会阻塞到它启动的
  // 整个回合结束,在事件循环内同步等待会卡死事件循环(事件堆积、提问/权限无人
  // 应答)。投递失败记 log 并返回 false,调用方按隐性阻塞处理,不再静默空等。
  const steerText = async (text: string): Promise<boolean> => {
    const sent = await client.session.promptAsync({ sessionID, parts: [{ type: "text", text }] }).catch(() => undefined)
    if (sent && !sent.error) return true
    log(`⚠ steer 投递失败: ${sent?.error ? JSON.stringify(sent.error) : "请求异常"}`)
    return false
  }
  const handleIdleTest = async (): Promise<{ type: "continue" } | { type: "break" } | { type: "blocked"; question: string }> => {
    // 交接要求已发出: 校验交接文档就绪(非空即有效,内容交新会话解释)。
    if (testHandoverAsked) {
      const doc = await Bun.file(test!.handoffFile).text().catch(() => "")
      if (doc.trim()) {
        testHandover = true
        return { type: "break" }
      }
      if (testHandoverRetried) {
        return {
          type: "blocked",
          question:
            `测试交接会话两次未写出有效的 ${test!.handoffFile}(缺失或为空,隐性阻塞)。` +
            `请检查该文件后重新运行。Agent 最后的输出:\n${lastText.trim().slice(-2000) || "(无输出)"}`,
        }
      }
      testHandoverRetried = true
      const ok = await steerText(
        `你上次结束会话但未写出有效的 ${test!.handoffFile}(缺失或为空)。这是硬性要求: ` +
          `把进度、关键决策、失败测试上下文与后续步骤写入该文件后再结束会话。`,
      )
      if (!ok) return { type: "blocked", question: `steer 投递失败(要求补写 ${test!.handoffFile}),无法继续会话,详见日志。` }
      return { type: "continue" }
    }
    const pending = join(test!.tmp, "test.sh")
    if (!(await Bun.file(pending).exists())) return { type: "break" }
    // 归档(存在即请求的协议标记,执行后移除以便再次请求)→ 执行 → 反馈。
    const run = await executeTest(test!, opts)
    const failed = run.code !== 0
    if (failed && test!.handover && used >= test!.limit) {
      testHandoverAsked = true
      log(`⚠ 测试失败(退出码 ${run.code})且上下文已用 ${formatTokens(used)} tokens 达到 ${formatTokens(test!.limit)} 上限,要求写交接文档后换新会话`)
      const ok = await steerText(renderTestHandover(run, { handoffFile: test!.handoffFile, used, limit: test!.limit }))
      if (!ok) return { type: "blocked", question: "steer 投递失败(测试交接要求),无法继续会话,详见日志。" }
      return { type: "continue" }
    }
    const ok = await steerText(renderTestResult(run))
    if (!ok) return { type: "blocked", question: "steer 投递失败(测试结果反馈),无法继续会话,详见日志。" }
    return { type: "continue" }
  }
  // verbose 已输出的 part 与 message,避免同一 part 的多次更新事件重复打印。
  const seen = new Set<string>()
  // 模型上下文上限(providerID/modelID → limit.context),首次需要时拉取。
  let limits: Map<string, number> | undefined
  for await (const raw of stream) {
    const event = raw as import("@opencode-ai/sdk/v2").Event
    if (event.type === "message.part.updated") {
      const part = event.properties.part
      if (part.sessionID !== sessionID) continue
      idleHandled = false
      if (part.type === "text" && part.time?.end) {
        lastText = part.text
        if (verbose) vlog(part.text)
        continue
      }
      const line = verbose ? describePart(part) : undefined
      if (line && !seen.has(part.id)) {
        seen.add(part.id)
        vlog(line)
      }
    }
    if (event.type === "message.updated") {
      const info = event.properties.info
      if (info.sessionID !== sessionID) continue
      idleHandled = false
      if (info.role !== "assistant" || !info.time.completed || seen.has(info.id)) continue
      seen.add(info.id)
      limits ??= await contextLimits(client)
      used = info.tokens.input + info.tokens.cache.read
      const limit = limits.get(`${info.providerID}/${info.modelID}`)
      pct = limit ? Math.round((used / limit) * 100) : 100
      if (verbose) vlog(`  上下文: ${formatTokens(used)}${limit ? `/${formatTokens(limit)}` : ""} tokens${limit ? ` (${pct}%)` : ""}`)
      if (steer && !steerSent && used >= steer.limit) {
        steerSent = true
        log(`⚠ 上下文已用 ${formatTokens(used)} tokens 达到 ${formatTokens(steer.limit)} 上限,插入交接提示`)
        const ok = await steerText(steer.text)
        if (!ok) {
          return {
             blocked: { type: "blocked", question: "steer 投递失败(交接提示),无法继续会话,详见日志。" },
            lastText,
            pct,
            used,
          }
        }
      }
    }
    if (event.type === "question.asked") {
      const asked = event.properties
      if (asked.sessionID !== sessionID) continue
      const text = asked.questions.map((q) => q.question).join("\n")
      // dryrun 预检会话一律自动答复,不因提问阻塞。
      const permission = opts.dryrun ? false : /权限|permission/i.test(text)
      const repeated = autoAnswered.some((prev) => sameIssue(prev, text))
      // 权限与非权限提问在 --wait-answer 下都先等人工答复,超时一律回落
      // AUTO_ANSWER 让 AI 自主决策继续;仅缺省 --wait-answer 时的权限提问
      // 直接阻塞(无人值守时不能替人工决定是否授权)。
      if (!repeated && (!permission || waitAnswer > 0)) {
        autoAnswered.push(text)
        log(`❓ 收到${permission ? "权限" : "非权限"}提问:\n${text}`)
        const human = waitAnswer > 0 ? await askHuman(waitAnswer, "超时将自动答复", opts.interactive) : undefined
        const reply = human ?? AUTO_ANSWER
        log(human ? `→ 人工答复: ${human}` : `→ 自动答复: ${AUTO_ANSWER}`)
        await client.question
          .reply({ requestID: asked.id, answers: asked.questions.map(() => [reply]) })
          .catch(() => {})
        continue
      }
      await client.question.reject({ requestID: asked.id }).catch(() => {})
      await client.session.abort({ sessionID }).catch(() => {})
      return {
        blocked: {
          type: "blocked",
          question: permission ? text : `自动答复后仍就同一问题再次询问,需人工在会话外处理后重新运行:\n${text}`,
        },
        lastText,
        pct,
        used,
      }
    }
    if (event.type === "permission.asked") {
      const asked = event.properties
      if (asked.sessionID !== sessionID) continue
      // dryrun 预检: 自动拒绝但不中断会话,让 AI 记录受阻项后继续探查下一项。
      if (opts.dryrun) {
        log(`🔐 预检探查被拒绝(记入报告): ${asked.permission} (${asked.patterns.join(", ")})`)
        await client.permission.reply({ requestID: asked.id, reply: "reject" }).catch(() => {})
        continue
      }
      const desc = `${asked.permission} (${asked.patterns.join(", ")})`
      const mode = opts.permission ?? "ask-deny"
      // auto-allow: 不等待人工,立即自动授权(always 放行本请求)。
      if (mode === "auto-allow") {
        log(`🔐 收到权限请求,--permission auto-allow 自动授权: ${desc}`)
        await client.permission.reply({ requestID: asked.id, reply: "always" }).catch(() => {})
        continue
      }
      // ask-*: 先等人工(--wait-answer 分钟,未设则不等待即视为超时)。回答
      // allow/yes/y 等视为确认授权(always 放行);明确的其余回答拒绝该权限但
      // 不中断会话,AI 在无该权限下绕开继续;超时按模式回落——ask-allow 自动
      // 授权、ask-deny 自动拒绝但会话继续、ask-fail 拒绝并退出运行。
      let human: string | undefined
      if (waitAnswer > 0) {
        log(`🔐 收到权限请求: ${desc}`)
        human = await askHuman(
          waitAnswer,
          `输入 allow/yes/y 确认授权,其余回答将拒绝该权限并继续,超时按 --permission ${mode} 处理`,
          opts.interactive,
        )
      } else {
        log(`🔐 收到权限请求(未设 --wait-answer 不等待人工,按 --permission ${mode} 处理): ${desc}`)
      }
      if (human && isApproval(human)) {
        log(`→ 人工授权: ${human}(always 放行)`)
        await client.permission.reply({ requestID: asked.id, reply: "always" }).catch(() => {})
        continue
      }
      if (human) {
        log(`→ 人工未授权: ${human}(拒绝该权限,AI 无授权继续)`)
        await client.permission.reply({ requestID: asked.id, reply: "reject" }).catch(() => {})
        continue
      }
      if (mode === "ask-allow") {
        log(`→ 等待超时,--permission ask-allow 自动授权: ${desc}`)
        await client.permission.reply({ requestID: asked.id, reply: "always" }).catch(() => {})
        continue
      }
      await client.permission.reply({ requestID: asked.id, reply: "reject" }).catch(() => {})
      if (mode === "ask-deny") {
        log(`→ 等待超时,--permission ask-deny 自动拒绝(AI 无授权继续): ${desc}`)
        continue
      }
      // ask-fail: 拒绝并退出运行(阻塞停机,问题写入 PLAN.md)。
      await client.session.abort({ sessionID }).catch(() => {})
      return {
        blocked: {
          type: "blocked",
          question: `权限请求无人答复(--permission ask-fail): ${desc}。请在目标目录 opencode.json 的 permission 规则中放行后重新运行。`,
        },
        lastText,
        pct,
        used,
      }
    }
    if (event.type === "session.error") {
      const props = event.properties
      if (props.sessionID !== sessionID || !props.error) continue
      idleHandled = false
      const detail =
        "data" in props.error && props.error.data && "message" in props.error.data
          ? String(props.error.data.message)
          : String(props.error.name)
      error = error ? `${error}\n${detail}` : detail
    }
    if (
      (event.type === "session.status" &&
        event.properties.sessionID === sessionID &&
        event.properties.status.type === "idle") ||
      (event.type === "session.idle" && event.properties.sessionID === sessionID)
    ) {
      // 孪生 idle 去重: 一个回合结束只结算一次(见 idleHandled 注释)。
      if (idleHandled) continue
      idleHandled = true
      // 测试执行协议: idle 先结算待执行请求(执行 + steer 反馈/交接要求)再结束;
      // 无待执行请求且无未完成的交接要求时,会话才算真正结束。
      if (test) {
        const handled = await handleIdleTest()
        if (handled.type === "continue") continue
        if (handled.type === "blocked") {
          return { blocked: { type: "blocked", question: handled.question }, lastText, pct, used, testHandover }
        }
      }
      settled = true
      break
    }
  }
  if (!settled) {
    // SSE 断流: 中止 server 端可能仍在运行的孤儿回合,避免与重试的新会话并发改文件
    // (abort 对已完成的会话无害;网络已断时调用静默失败)。会话错误经 attempt 包装
    // 后走重试/阻塞路径,进度记录保持 active,下次运行复用本会话继续。
    await client.session.abort({ sessionID }).catch(() => {})
    const msg = "事件流中断(未收到会话结束事件,疑似 server 故障或网络断开)"
    error = error ? `${error}\n${msg}` : msg
  }
  return { lastText, error, pct, used, testHandover }
}

// --test-by-driver 的单次测试执行: tmp/test.sh 为请求标记,其内容有两种形态——
// (1) 指向 test/ 下脚本的路径(相对工作目录,如 test/build.sh):driver 直接运行
// 该脚本(脚本本身在 test/ 已进 git,无需另行归档);
// (2) 内联脚本(AI 未按协议固化到 test/ 时的回落):driver 把内容整写为
// tmp/test.<n>.sh 后运行,保留执行快照供审计。
// 两种形态均把 stdout+stderr 合并整写 tmp/test.<n>.out(共用 idleTime/idleMax
// 看门狗)。退出码非 0 不在此判定——判断权在 AI(与 verify 哲学一致,机制正交)。
async function executeTest(test: TestRun, opts: Opts): Promise<TestRunInfo> {
  const seq = ++test.seq
  const marker = join(test.tmp, "test.sh")
  const out = join(test.tmp, `test.${seq}.out`)
  const content = await Bun.file(marker).text()
  const candidate = resolve(test.dir, content.trim())
  let script: string
  // 单行内容且指向现存文件 → 运行该 test/ 脚本(协议首选);否则按内联脚本回落。
  if (!content.includes("\n") && (await Bun.file(candidate).exists())) {
    script = candidate
  } else {
    script = join(test.tmp, `test.${seq}.sh`)
    await Bun.write(script, content)
  }
  await rm(marker, { force: true })
  await mkdir(test.tmp, { recursive: true })
  const run = await runVerifyScript(test.dir, script, { idleMs: opts.idleMs, maxMs: opts.maxMs, out })
  log(
    `  ⚙ test 脚本退出码 ${run.code}${run.timedOut ? `(超时终止: ${run.timeoutReason === "max" ? "超过绝对时长上限" : "持续无输出"})` : ""},耗时 ${run.ms}ms,脚本: ${script},输出: ${out}`,
  )
  const info: TestRunInfo = {
    script,
    code: run.code,
    ms: run.ms,
    timedOut: run.timedOut,
    timeoutReason: run.timeoutReason,
    out,
    seq,
  }
  test.last = info
  return info
}

// verbose 模式下把非文本 part 转成一行可读输出;返回 undefined 表示该 part
// 尚无终态内容可输出(后续更新事件会再触发)。工具输出与推理原文较长,
// 截断到与 verify 输出相同的 2000 字符上限。
function describePart(part: Part): string | undefined {
  if (part.type === "reasoning") return part.time.end ? `  推理:\n${part.text.trim().slice(0, 2000)}` : undefined
  if (part.type === "tool") {
    if (part.state.status === "completed") return `  工具 ${part.tool}: ${part.state.title || "完成"}`
    if (part.state.status === "error") return `  工具 ${part.tool} 出错: ${part.state.error.slice(0, 2000)}`
    return undefined
  }
  if (part.type === "step-finish") return `  步骤结束(${part.reason}): 输入 ${formatTokens(part.tokens.input)} / 输出 ${formatTokens(part.tokens.output)} tokens`
  if (part.type === "step-start") return `  步骤开始`
  if (part.type === "file") return `  文件: ${part.filename ?? part.url}`
  if (part.type === "subtask") return `  子任务(${part.agent}): ${part.description}`
  if (part.type === "agent") return `  子代理: ${part.name}`
  if (part.type === "patch") return `  补丁(${part.files.length} 个文件): ${part.files.join(", ")}`
  if (part.type === "snapshot") return `  快照: ${part.snapshot}`
  if (part.type === "retry") return `  ↻ 请求重试(第 ${part.attempt} 次)`
  if (part.type === "compaction") return `  上下文压缩${part.auto ? "(自动)" : ""}`
  return undefined
}

// 拉取一次 provider 列表,建立 providerID/modelID → 上下文上限的映射;
// 失败时返回空映射,上下文行退化为只显示用量不显示百分比。
async function contextLimits(client: OpencodeClient): Promise<Map<string, number>> {
  const response = await client.provider.list().catch(() => undefined)
  const limits = new Map<string, number>()
  for (const provider of response?.data?.all ?? []) {
    for (const [id, model] of Object.entries(provider.models)) {
      limits.set(`${provider.id}/${id}`, model.limit.context)
    }
  }
  return limits
}

function formatTokens(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

// Two questions count as the same issue when their normalized texts match or
// one contains the other (the agent may rephrase a question it already asked).
function sameIssue(a: string, b: string): boolean {
  const normalize = (s: string) => s.replace(/\s+/g, "").toLowerCase()
  const x = normalize(a)
  const y = normalize(b)
  return x === y || x.includes(y) || y.includes(x)
}

// 权限等待中,这些回答(忽略首尾空白与大小写)视为确认授权。
function isApproval(answer: string): boolean {
  return /^(allow|yes|y|ok|approve|always|允许|授权|是)$/.test(answer.trim().toLowerCase())
}

// Waits up to `minutes` for a human answer on stdin (Enter confirms); returns
// undefined on timeout or empty input, in which case the caller falls back to
// AUTO_ANSWER (questions) or the --permission fallback (permission requests).
// --interactive 下改由常驻输入行接收回答(提示语、超时与回落语义不变)。
async function askHuman(minutes: number, hint: string, interactive?: Interactive): Promise<string | undefined> {
  const promptText = `请在 ${minutes} 分钟内输入回答(回车确认,${hint}): `
  if (interactive) return (await interactive.question(promptText, minutes)) || undefined
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  // raw 模式下 ^C 不会触发进程级 SIGINT,readline 会截获;转发给进程级
  // 处理器,使等待人工答复期间连续两次 Ctrl+C 同样能强制终止。
  rl.on("SIGINT", () => process.kill(process.pid, "SIGINT"))
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const answer = await Promise.race([
      rl.question(promptText),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), minutes * 60_000)
      }),
    ])
    return answer?.trim() || undefined
  } finally {
    clearTimeout(timer)
    rl.close()
  }
}
