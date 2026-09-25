// 会话后的统一提交与执行单元回滚: 代答标记采集、提交门禁与单元收口校验、
// refcheck 挂点门禁、恢复保真(严格恢复生效判定/模型一致性求值)、回滚到
// 单元基线的 runner 侧编排。设计见 plans/0021-commit-boundary-design.md 与
// plans/0022-session-recovery-fidelity-design.md。
// 位于会话驱动层之下: 不得 import session/watch/runner。
// 拆分自 src/runner.ts(plans/0024-module-split-plan.md S3,纯搬运)。
import { phaseToRole, resolveModel } from "./chain"
import { failbackOverride, stickyModel } from "./failback"
import { commitTree, rollbackUnit, unitViolations, type UnitBaseline } from "./git"
import { forgetHandover } from "./handover"
import { log, vlog } from "./log"
import type { Opts, SessionCommit, UnitStop } from "./opts"
import { currentRound } from "./phases"
import type { Task } from "./tasks"
import { autoCorrectRefs } from "./refcheck"
import { collectAgentResolves, resolvesOf, type ResolveItem } from "./resolve"
import { saveProgress, type Phase, type Progress } from "./resume"
import { autoSwitches, type ModelRole, type Switches } from "./switches"

// Questions get this autonomous reply when no human answers in time (or
// --wait-answer was not given for non-permission questions); only a repeated
// question on the same issue escalates to human intervention.
// 文案按提问策略档位取用(OPENCODE_AUTO_ASK,plans/0020-auto-resolve-design.md §G):
// Both modes state that "this question was answered on the user's behalf": a
// divergence the user should have decided is closed by the driver because nobody
// is watching, so the session knows it is deciding for the user rather than
// making an ordinary decision of its own. Off (default) requires the decision to
// be marked AUTO-RESOLVE and kept distinct from AUTO-DECISION (the ledger relies
// on the session marking it); on, the question itself is a driver event and is
// fully logged, so no marking is asked for, and the text never says AUTO-DECISION
// so the session does not keep leaving marks out of habit.
// Exported so tests drive both texts directly (same pattern as
// gatedAutoCorrectRefs: a testable exit for internal wiring).
export function autoAnswer(ask: boolean): string {
  const head =
    "This question was answered on the user's behalf: it was the user's call, but nobody is watching, so the driver closes it for them. " +
    "Decide how to proceed on your own, and if the current stage is already finished, move straight on to the next one. "
  if (ask) {
    return (
      head +
      "This run allows questions and the driver has fully logged this answer, so you need not record it anywhere; just carry on as answered."
    )
  }
  return (
    head +
    "Record the decision: write its reasoning and the alternatives you considered (and rejected) into the relevant document (a docs/ design document or report); " +
    "mark the decision in a design document or code comment with an `AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)` line, " +
    "not as `AUTO-DECISION` — that one is only for pure implementation choices that were always yours."
  )
}

// 会话后统一提交(收回 AI 提交权,见 src/git.ts): 每个会话结束且 driver 完成
// 状态写入(tick 勾选等)后调用,递归提交全部改动——git 历史即 AI 变更的审计
// 轨迹,回滚粒度 = 会话。--commit false 与 dryrun 跳过。
// 提交前引用 auto-correct(stable-refs P4,D6 第一层): rename 配对机械改写活
// 文档引用 + 失效引用 ⚠ 日志(改写内容随本次统一提交落账,不另起提交)。
// 受 OPENCODE_AUTO_REF_CHECK 管控(refcheck-scope-design D3,缺省 off 空转)。
// 导出供单测(H4 守卫: 采集不受 --commit false / dryrun 的提前 return 影响)。
export async function afterSession(
  dir: string | undefined,
  opts: Opts,
  task: { id: string; title: string },
  info: { stage: string; subject: string },
  baseline?: UnitBaseline,
): Promise<SessionCommit> {
  if (!dir) return { type: "ok" }
  // 代答标记采集(auto-resolve H4,plans/0020-auto-resolve-design.md §G): 提到 commit/
  // dryrun 提前 return **之前**——采集是审计,不该受提交开关影响;on 档下它降级为
  // 兜底(driver 已在事件侧完整落账),但会话自愿标了就收。扫描本次会话的未提交
  // 变更文件,AUTO-RESOLVE 落台账、AUTO-DECISION 只回计数。
  await collectSessionMarks(dir, opts, task, info.stage)
  if (opts.commit === false || opts.dryrun) return { type: "ok" }
  await gatedAutoCorrectRefs(dir, autoSwitches().refCheck)
  const result = await commitTree(dir, task, info)
  if (!result.ok) {
    return {
      type: "failed",
      question: `unified commit failed: ${result.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. Changes are left in the worktree; please handle git manually and re-run.`,
    }
  }
  if (baseline) {
    const violations = await unitViolations(dir, baseline)
    if (violations.length) return { type: "failed", question: `unit close-out check failed: ${violations.join("; ")}` }
  }
  return { type: "ok" }
}

// afterSession 门禁失败 → blocked 出口(unit 描述本单元,如「T-001 子任务 2」):
// 提交失败即不视为完成,阻塞原因进运行日志,由 loop 的 interrupted 提交重试一次落账,
// 仍失败则留脏现场给人工(退出码 2)。
export function commitBlocked(unit: string, commit: { type: "failed"; question: string }): { type: "blocked"; question: string } {
  return { type: "blocked", question: `${unit}: output not committed, not considered complete — ${commit.question}` }
}

// H4 的采集体: 计数只进明细日志(vlog),不上终端——AUTO-DECISION 永不与
// AUTO-RESOLVE 争版面(§H-④),而"扫描确实跑过、看见了多少标记"是可追溯的证据。
// 本任务的高亮块由 loop 侧读台账构造(T-006),此处不打终端行。台账写失败全静默,
// 采集本身也不得影响流程与退出码,故整体 catch 吞掉。
async function collectSessionMarks(
  dir: string,
  opts: Opts,
  task: { id: string },
  stage: string,
): Promise<void> {
  const found = await collectAgentResolves(dir, {
    task: task.id,
    phase: opts.phase?.id ?? "",
    round: await currentRound(dir).catch(() => 0),
  }).catch(() => undefined)
  if (!found) return
  if (found.resolves) vlog(`⚑ ${task.id} ${stage}: collected ${found.resolves} AUTO-RESOLVE marker(s)`)
  if (found.decisions) vlog(`ℹ ${task.id} ${stage}: recorded ${found.decisions} AUTO-DECISION entries`)
}

// 收尾会话的代答清单(auto-resolve H7,plans/0020-auto-resolve-design.md §I): 本任务台账里
// driver 观测到的代答问题,经 renderWrapup 注入收尾提示词,要求 report.md 单列「自动
// 代答问题」一节——driver 看见的那部分因此被强制写进 git,持久记录不再依赖会话自觉。
// 台账读失败一律吞成空(与 loop 侧三处置顶块同款): 审计永不影响流程与退出码。
export async function wrapupResolves(dir: string | undefined, taskID: string): Promise<ResolveItem[]> {
  return await resolvesOf(dir, "task", taskID).catch(() => [])
}

// refcheck 挂点门禁(refcheck-scope-design D3,OPENCODE_AUTO_REF_CHECK 缺省 off):
// off 时提交前 auto-correct 空转——目标目录零引用检查行为;
// check 子命令的引用扫描段在 check.ts 同款门控;script/fix-refs.ts 手动脚本不经
// 门禁(人工显式执行等价于显式开启)。导出供单测(parseSwitches 纯函数注入)。
export async function gatedAutoCorrectRefs(dir: string, on: boolean): Promise<void> {
  if (on) await autoCorrectRefs(dir)
}

// —— 恢复保真(plans/0022-session-recovery-fidelity-design.md,OPENCODE_AUTO_STRICT_RESUME)——

// 严格恢复是否生效: 开关 on 且提交门禁在位(--commit true 且非 dryrun)。门禁关闭
// 时记录不带基线/模型字段、核对与回滚整体空转(逐字节等价现状)。switches 缺省取
// OPENCODE_AUTO_* 解析值,注入供单测。
export function strictResumeActive(opts: Opts, switches: Switches = autoSwitches()): boolean {
  return switches.strictResume && opts.commit !== false && !opts.dryrun
}

// 恢复时的模型一致性求值(设计 3.1 ④): 与 attempt 为复用会话计算 target 的优先级
// 链一致(链上降级候选在恢复时不存在,取 sticky > /failback 覆写 > 路由表)。返回
// undefined = 当前未配置模型路由(此时记录也无可记,核对按不匹配处理)。
// role is the session's explicit routing role (requireArtifact's spec.role,
// such as m-mode planning's implement-scan, plans/0053 D12). The dispatch
// routed by it, since an explicit role wins over the phase (roleOf), so the
// check must derive the same role; absent = derived from the phase.
export function resumeModelNow(opts: Opts, switches: Switches, phase: Phase | undefined, role?: ModelRole): string | undefined {
  return stickyModel() ?? failbackOverride()?.wildcard ?? resolveModel(switches.model, opts.phase?.entry, role ?? phaseToRole(phase) ?? "bypass")
}

// 回滚协议的 runner 侧编排(设计 3.3): rollbackUnit(stash 保全 + soft reset 收回
// driver 提交)→ 进度记录转总结态(清基线/模型)→ 日志记下现场去向(stash)与
// 找回方式。回滚失败返回 dirty(git 状态的决定权在人工);成功后调用方以冷启动
// (不附 resumeNote)重做本单元。
export async function rollbackUnitState(
  dir: string,
  task: Task,
  unit: string,
  baseline: UnitBaseline,
  extra: { progress?: Progress } = {},
): Promise<{ type: "ok" } | UnitStop> {
  const rolled = await rollbackUnit(dir, baseline, { task: task.id, unit })
  if (!rolled.ok) {
    return { type: "dirty", files: rolled.failures.map((failure) => `${failure.rel}: ${failure.error}`) }
  }
  // 在途测试交接记录随单元回滚一并作废: 记录指向的定版提交与定版锚点属于被收回
  // 的单元,留着会让重做被恢复状态机接回「继续被丢弃的交接」(从定版点 fork 重做
  // 收尾、对回滚后的树跑定版脚本),而不是从基线重做整个单元。
  await forgetHandover(dir)
  if (extra.progress) {
    await saveProgress(dir, { ...extra.progress, active: false, baseline: undefined, model: undefined })
  }
  log(
    `↻ ${task.id} ${unit} rolled back to unit baseline (stash ×${rolled.stashes}` +
      `${rolled.resets.length ? `, reset ${rolled.resets.join(", ")}` : ""}` +
      `${rolled.skipped.length ? `; stash only, no reset: ${rolled.skipped.join(", ")}` : ""}), re-running this unit from a clean baseline with a new session; ` +
      `the rolled-back work is kept in git stash (message prefix auto-rollback: git stash list, git stash show -p)`,
  )
  return { type: "ok" }
}
