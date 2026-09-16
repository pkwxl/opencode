// 会话后的统一提交与执行单元回滚: 代答标记采集、提交门禁与单元收口校验、
// refcheck 挂点门禁、恢复保真(严格恢复生效判定/模型一致性求值)、回滚到
// 单元基线的 runner 侧编排。设计见 docs/commit-boundary-design.md 与
// docs/session-recovery-fidelity-design.md。
// 位于会话驱动层之下: 不得 import session/watch/runner。
// 拆分自 src/runner.ts(docs/module-split-plan.md S3,纯搬运)。
import { writeCurrent } from "./current"
import { phaseToRole, resolveModel } from "./chain"
import { failbackOverride, stickyModel } from "./failback"
import { commitTree, rollbackUnit, unitViolations, type RollbackResult, type UnitBaseline } from "./git"
import { log, vlog } from "./log"
import type { Opts, SessionCommit, UnitStop } from "./opts"
import { currentRound } from "./phases"
import type { Task } from "./plan"
import { autoCorrectRefs, formatRefGap, taskRefFindings } from "./refcheck"
import { collectAgentResolves, resolvesOf, type ResolveItem } from "./resolve"
import { saveProgress, type Phase, type Progress } from "./resume"
import { autoSwitches, type Switches } from "./switches"

// Questions get this autonomous reply when no human answers in time (or
// --wait-answer was not given for non-permission questions); only a repeated
// question on the same issue escalates to human intervention.
// 文案按提问策略档位取用(OPENCODE_AUTO_ASK,docs/auto-resolve-design.md §G):
// 两档共同点明"这是一个被代答的提问"——本应由用户拍板的分歧点因无人值守由 driver
// 代替用户闭环,让会话知道自己正在替用户做主,而不是当成一次普通的自主决策。
// off 档(缺省)要求以 AUTO-RESOLVE 标注该决策并明确区别于 AUTO-DECISION(台账靠
// 会话自觉标注补全);on 档下提问本身即流经 driver 的事件、已被完整落账,故不要求
// 任何标注——此档文案不出现 AUTO-DECISION 字样,避免会话出于惯性继续留痕。
// 导出供单测直驱两档文案(与 gatedAutoCorrectRefs 同款: 内部接线的可测出口)。
export function autoAnswer(ask: boolean): string {
  const head =
    "这是一个被代答的提问: 它本应由用户拍板,因无人值守由 driver 代替用户闭环。" +
    "你根据情况来自主决策如何做即可,如果当前阶段已经完成,直接转下一个阶段。"
  if (ask) {
    return (
      head +
      "本次运行允许发问,driver 已完整记录这次代答,你无须为它另行留痕,按答复继续执行即可。"
    )
  }
  return (
    head +
    "请记录决策过程:把决策理由与考虑过(并否决)的备选方案写入相关文档(docs/ 设计文档或报告);" +
    "该决策须在设计文档或代码注释中以 `AUTO-RESOLVE: <原问题> -> <所选方案> (<理由>)` 行明确标注," +
    "不要记成 `AUTO-DECISION`——后者只用于决定权本就属于你的纯实现取舍。"
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
  // 代答标记采集(auto-resolve H4,docs/auto-resolve-design.md §G): 提到 commit/
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
      question: `统一提交失败: ${result.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}。改动保留在工作区,请人工处理 git 后重新运行。`,
    }
  }
  if (baseline) {
    const violations = await unitViolations(dir, baseline)
    if (violations.length) return { type: "failed", question: `单元收口校验未通过: ${violations.join("; ")}` }
  }
  return { type: "ok" }
}

// afterSession 门禁失败 → blocked 出口(unit 描述本单元,如「T-001 子任务 2」):
// 提交失败即不视为完成,问题进 PLAN.md,由 loop 的 interrupted 提交重试一次落账,
// 仍失败则留脏现场给人工(退出码 2)。
export function commitBlocked(unit: string, commit: { type: "failed"; question: string }): { type: "blocked"; question: string } {
  return { type: "blocked", question: `${unit}的产出未提交落账,不视为完成——${commit.question}` }
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
    phase: opts.phase ?? "",
    round: await currentRound(dir).catch(() => 0),
  }).catch(() => undefined)
  if (!found) return
  if (found.resolves) vlog(`⚑ ${task.id} ${stage}: 采集到 AUTO-RESOLVE 标记 ${found.resolves} 条`)
  if (found.decisions) vlog(`ℹ ${task.id} ${stage}: 记录 AUTO-DECISION ${found.decisions} 条`)
}

// 收尾会话的代答清单(auto-resolve H7,docs/auto-resolve-design.md §I): 本任务台账里
// driver 观测到的代答问题,经 renderWrapup 注入收尾提示词,要求 report.md 单列「自动
// 代答问题」一节——driver 看见的那部分因此被强制写进 git,持久记录不再依赖会话自觉。
// 台账读失败一律吞成空(与 loop 侧三处置顶块同款): 审计永不影响流程与退出码。
export async function wrapupResolves(dir: string | undefined, taskID: string): Promise<ResolveItem[]> {
  return await resolvesOf(dir, "task", taskID).catch(() => [])
}

// refcheck 挂点门禁(refcheck-scope-design D3,OPENCODE_AUTO_REF_CHECK 缺省 off):
// off 时提交前 auto-correct 与 verify 门禁预扫空转——目标目录零引用检查行为;
// check 子命令的引用扫描段在 check.ts 同款门控;script/fix-refs.ts 手动脚本不经
// 门禁(人工显式执行等价于显式开启)。导出供单测(parseSwitches 纯函数注入)。
export async function gatedAutoCorrectRefs(dir: string, on: boolean): Promise<void> {
  if (on) await autoCorrectRefs(dir)
}

// verify 门禁预扫(D6 第三层)的门禁同款: off 时无差距(门禁不存在)。
export async function gatedTaskRefGap(dir: string, id: string, on: boolean): Promise<string | undefined> {
  return on ? formatRefGap(await taskRefFindings(dir, id)) : undefined
}

// —— 恢复保真(session-recovery-fidelity-design.md,OPENCODE_AUTO_STRICT_RESUME)——

// 严格恢复是否生效: 开关 on 且提交门禁在位(--commit true 且非 dryrun)。门禁关闭
// 时记录不带基线/模型字段、核对与回滚整体空转(逐字节等价现状)。switches 缺省取
// OPENCODE_AUTO_* 解析值,注入供单测。
export function strictResumeActive(opts: Opts, switches: Switches = autoSwitches()): boolean {
  return switches.strictResume && opts.commit !== false && !opts.dryrun
}

// 恢复时的模型一致性求值(设计 3.1 ④): 与 attempt 为复用会话计算 target 的优先级
// 链一致(链上降级候选在恢复时不存在,取 sticky > /failback 覆写 > 路由表)。返回
// undefined = 当前未配置模型路由(此时记录也无可记,核对按不匹配处理)。
export function resumeModelNow(opts: Opts, switches: Switches, phase: Phase | undefined): string | undefined {
  return stickyModel() ?? failbackOverride()?.wildcard ?? resolveModel(switches.model, opts.phase, phaseToRole(phase) ?? "bypass")
}

// 回滚协议的 runner 侧编排(设计 3.3): rollbackUnit(stash 保全 + soft reset 收回
// driver 提交)→ 进度记录转总结态(清基线/模型)→ CURRENT.md 写回滚备注(planPath
// 给出时;runTask 恢复路径不在此写,由随后的任务镜像统一携带)。回滚失败返回
// dirty(git 状态的决定权在人工);成功返回备注文本,调用方以冷启动(不附
// resumeNote)重做本单元。
export async function rollbackUnitState(
  dir: string,
  task: Task,
  unit: string,
  baseline: UnitBaseline,
  extra: { planPath?: string; progress?: Progress; solo?: boolean } = {},
): Promise<{ type: "ok"; remark: string } | UnitStop> {
  const rolled = await rollbackUnit(dir, baseline, { task: task.id, unit })
  if (!rolled.ok) {
    return { type: "dirty", files: rolled.failures.map((failure) => `${failure.rel}: ${failure.error}`) }
  }
  if (extra.progress) {
    await saveProgress(dir, { ...extra.progress, active: false, baseline: undefined, model: undefined })
  }
  const remark = rollbackRemark(task.id, unit, rolled)
  if (extra.planPath) {
    await writeCurrent(extra.planPath, task, extra.solo ?? false, remark)
  }
  log(
    `↻ ${task.id} ${unit}已回滚到单元基线(stash ${rolled.stashes} 次` +
      `${rolled.resets.length ? `,reset ${rolled.resets.join(", ")}` : ""}` +
      `${rolled.skipped.length ? `;仅 stash 未 reset: ${rolled.skipped.join(", ")}` : ""}),新会话从干净基线重做本单元`,
  )
  return { type: "ok", remark }
}

// CURRENT.md 的回滚备注(回滚重跑路径保留文件时写入): 现场去向与找回方式。
function rollbackRemark(taskID: string, unit: string, rolled: RollbackResult): string {
  return [
    `## 回滚备注(opencode-auto)`,
    ``,
    `- 回滚时间: ${new Date().toISOString()}`,
    `- 回滚单元: ${taskID} ${unit}`,
    `- 现场保全: 未提交改动与被收回的本单元提交均在 git stash(信息含 auto-rollback 前缀),可用 git stash list 定位、git stash show -p 查看`,
    `- 后续: 本单元将由新会话从基线重做;如需找回被回滚的部分工作,请人工检查 stash 后自行取舍`,
  ].join("\n")
}
