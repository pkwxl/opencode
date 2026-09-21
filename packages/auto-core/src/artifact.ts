// 旁路会话"必须产出文件"的通用骨架(requireArtifact): 下发 → 采集产物 → 缺失
// 带反馈重试一次 → 仍缺失按隐性阻塞停机;兼管阶段级旁路步骤的恢复点续跑
// (spec.step)与独立隐藏任务单元的提交边界(spec.unitStart)。被验收机具
// (review 层)与 final/implement/numbering/knowledge/loop 消费,单独成文件使
// 它们不必拉进整个 runner。位于 session 之上;**不得反向 import runner**。
// 拆分自 src/runner.ts(plans/0024-module-split-plan.md S9,纯搬运)。

import type { AgentClient } from "./agent/types"
import type { SessionChain } from "./chain"
import { baselineIntact, beginUnit, unitBaseline, type UnitBaseline } from "./git"
import { log } from "./log"
import type { Opts, UnitStop } from "./opts"
import type { Task } from "./plan"
import { recallProgress, saveProgress, type Phase, type PhaseLetter, type StepKind } from "./resume"
import { resumeNote } from "./resume-gate"
import { runSession } from "./session"
import { formatTokens, sessionAlive, sessionUsage } from "./session-api"
import { autoSwitches, type ModelRole, type Switches } from "./switches"
import { afterSession, commitBlocked, resumeModelNow, rollbackUnitState, strictResumeActive } from "./unit-commit"

// “旁路会话必须产出文件”的通用骨架(设计文档 A.4): 会话结束但产物缺失或无效时
// 带反馈重试一次,仍失败按隐性阻塞停机(人工检查后重新运行续跑)。脚本生成、
// 判定、质量审核、修复规划与终审任务生成(src/final.ts)会话共用;collect 返回
// undefined 表示该次会话未产出有效产物。spec.commit 声明该类会话的统一提交信息
// (会话结束即提交;判定会话的 PLAN.md 越权还原发生在提交之后时,还原差异由
// 下一次提交清扫,历史中保留越权记录本身亦是审计事实)。
//
// spec.step(阶段级旁路步骤,plans/0018-session-resume-precedence-design.md): 仅阶段
// 规划/交接蒸馏会话声明。有值时:① 会话链携带 step 阶段,attempt 在提示词下发
// 成功时写 active 记录(认领在跑的会话,回合进行中被 kill 也不丢);② 进入时若
// 发现同一步骤的 active 记录(上次运行中断、driver 未收口)→ 续跑: 会话存活且非
// 报错桩则复用原会话(保留产物现场,不重置),否则开新会话重做本步骤(照常重置);
// ③ 收口(删除记录)由调用方在后处理完成后经 closeStep 执行——requireArtifact 本身
// 不删,避免"产物已校验但后处理(编号推进/台账/提交)未完成"时被 kill 丢失步骤认领。
//
// spec.unitStart(plans/0021-commit-boundary-design.md P2): 独立隐藏任务单元声明(阶段规划/
// 交接蒸馏/知识提取/前置知识/编号恢复/终审任务生成)。有值时: ① 入口经 beginUnit
// 做启动 clean 门禁并记 SHA 基线(恢复复用原会话时豁免 clean——脏区是本单元自身
// 产物现场——但仍记基线);② spec.commit 失败 → blocked(不开反馈重试: git 故障
// 重开会话无意义),提交后做单元收口校验(提交区间须全为 driver 提交)。任务内部的
// 验收机具会话(judge/review/planfix/脚本生成)不声明——它们运行在任务单元内层,
// 提交义务由 afterSession 门禁覆盖。
export async function requireArtifact<T>(
  client: AgentClient,
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
    // 独立隐藏任务单元声明(启动 clean 门禁 + SHA 基线 + 收口校验,见函数头注释)。
    unitStart?: boolean
    // 阶段级旁路步骤身份(仅阶段规划/交接蒸馏会话声明);有值即启用 driver 侧
    // 恢复点与会话续跑(见函数头注释)。
    step?: { step: StepKind; letter: PhaseLetter }
    // 会话角色(模型路由细键,plans/0017-model-routing-design.md C.1):旁路一次性会话
    // 显式声明(如 verify-judge / review-audit / knowledge);缺省 undefined →
    // roleOf 落 bypass。带 spec.step 的阶段步骤会话无需声明(roleOf 由 step 变体推导)。
    role?: ModelRole
  },
  // 缺省取 OPENCODE_AUTO_* 解析值,透传给 runSession(与其同款注入点,供单测把
  // 重试阶梯压成零等待)。
  switches: Switches = autoSwitches(),
): Promise<T | UnitStop> {
  const stepPhase: Phase | undefined = spec.step ? { kind: "step", step: spec.step.step, letter: spec.step.letter } : undefined
  // 阶段步骤续跑判定: 上次运行在本步骤中断(driver 未收口)且原会话仍可复用 →
  // 首个提示词进原会话(保留产物现场);否则按全新步骤处理(重置 + 新会话)。
  // 严格恢复(OPENCODE_AUTO_STRICT_RESUME): 复用前核对单元基线与生效模型
  // (plans/0022-session-recovery-fidelity-design.md 3.1);不可保真时回滚到基线后按全新步骤
  // 重做——外部提交混入直接 dirty 交人工(不动 git)。
  const strict = strictResumeActive(opts, switches)
  let resumedSession: string | undefined
  let resumedUsage: { used: number; pct: number; limit?: number } | undefined
  if (stepPhase && opts.dir) {
    const recalled = await recallProgress(opts.dir, task.id)
    const sameStep =
      recalled?.active === true &&
      recalled.phase?.kind === "step" &&
      recalled.phase.step === spec.step!.step &&
      recalled.phase.letter === spec.step!.letter
    if (sameStep) {
      const candidate = !opts.newSession ? recalled!.session : undefined
      const alive = candidate !== undefined ? await sessionAlive(client, candidate) : false
      const usage = alive ? await sessionUsage(client, candidate!) : undefined
      // 报错桩(整条会话无真实产出)不复用——与 runTask 跨进程恢复同款双保险。
      const usable = alive && usage && !(usage.used === 0 && usage.errorStub)
      const legacyRecord = strict && recalled!.baseline === undefined
      if (strict && recalled!.baseline) {
        const drift = await baselineIntact(opts.dir, recalled!.baseline)
        if (drift.length) return { type: "dirty", files: drift }
        const modelNow = resumeModelNow(opts, switches, recalled!.phase)
        if (usable && !legacyRecord && recalled!.model !== undefined && recalled!.model === modelNow) {
          resumedSession = candidate
          resumedUsage = usage
          log(
            `↻ ${task.id} ${spec.kind}会话恢复中断点,复用会话 ${candidate} 继续(上下文不丢,` +
              `已用 ${formatTokens(usage.used)}${usage.limit ? `/${formatTokens(usage.limit)} tokens,${usage.pct}%` : " tokens"})`,
          )
        } else {
          const why = opts.newSession
            ? "--new-session 指定"
            : !usable
              ? "原会话不可复用"
              : recalled!.model === undefined
                ? "记录无生效模型(严格恢复启用前的旧记录)"
                : `模型不一致(记录 ${recalled!.model},当前 ${modelNow ?? "未配置路由"})`
          const done = await rollbackUnitState(opts.dir, task, `${spec.kind}步骤`, recalled!.baseline, { progress: recalled })
          if (done.type !== "ok") return done
          log(`↻ ${task.id} ${spec.kind}会话恢复中断点(${why},严格恢复已回滚,重做本步骤)`)
        }
      } else if (usable && !legacyRecord) {
        resumedSession = candidate
        resumedUsage = usage
        log(
          `↻ ${task.id} ${spec.kind}会话恢复中断点,复用会话 ${candidate} 继续(上下文不丢,` +
            `已用 ${formatTokens(usage.used)}${usage.limit ? `/${formatTokens(usage.limit)} tokens,${usage.pct}%` : " tokens"})`,
        )
      } else {
        const why = opts.newSession
          ? "--new-session 指定"
          : candidate === undefined
            ? "记录无会话"
            : legacyRecord
              ? "严格恢复启用前的旧记录无单元基线,无法严格核对"
              : alive
                ? "原会话只挨了一记报错、无真实产出"
                : "原会话不可复用"
        log(`↻ ${task.id} ${spec.kind}会话恢复中断点(${why},开新会话重做本步骤)`)
      }
    } else {
      // 全新步骤(或记录不属于本步骤): 先写一个 session 未定的 active 恢复点,使
      // attempt 的下发前快照(prior)恒非空——可重试会话错误还原时保留步骤认领而非
      // 删除记录,避免"可重试错误耗尽 → 无记录 → 下次运行凭半成品 PLAN.md 跳过本
      // 步骤"。会话 id 由首个提示词下发时的 remember 落实。
      await saveProgress(opts.dir, { task: task.id, session: undefined, at: Date.now(), active: true, phase: stepPhase })
    }
  }
  let feedback = ""
  // 独立隐藏任务单元的提交边界(spec.unitStart,plans/0021-commit-boundary-design.md P2):
  // 恢复复用原会话(resumedSession)豁免 clean 检查——工作区脏区是本单元自身产物
  // 现场;全新进入要求 clean(driver 独占状态文件遗留自愈),两种情况都记 SHA 基线。
  let baseline: UnitBaseline | undefined
  if (spec.unitStart && opts.dir && opts.commit !== false && !opts.dryrun) {
    if (resumedSession) {
      baseline = await unitBaseline(opts.dir)
    } else {
      const gate = await beginUnit(opts.dir, opts, task)
      if (gate.type === "dirty") return { type: "dirty", files: gate.files }
      baseline = gate.baseline
    }
  }
  for (let i = 0; ; i++) {
    // 续跑复用原会话时保留产物现场(上次会话可能已写入部分产物,重置会毁掉它);
    // 其余情况(全新步骤、反馈重试)照常重置,避免会话未写出时被误当作本次产出。
    const resume = i === 0 && resumedSession !== undefined
    if (!resume) await spec.reset?.()
    const chain: SessionChain = {
      pct: resume ? resumedUsage!.pct : 100,
      used: resume ? resumedUsage!.used : 0,
      at: resume ? Date.now() : 0,
      subject: spec.commit?.subject,
      phase: stepPhase,
      role: spec.role,
      // 单元基线上链(严格恢复: attempt 写 active 记录时随记)。
      baseline,
    }
    if (resume) {
      // attempt 的 resumed 判据(链上有会话且 note 待注入)使首个提示词必进原会话,
      // 不受复用开关与阈值约束;note 用后即清。
      chain.id = resumedSession
      chain.note = resumeNote(stepPhase, true, strict)
    }
    const result = await runSession(client, task, promptText + feedback, opts, chain, undefined, undefined, switches)
    if (result.type === "blocked") return result
    if (spec.commit) {
      const committed = await afterSession(opts.dir, opts, task, spec.commit, baseline)
      if (committed.type === "failed") return commitBlocked(`${task.id} ${spec.kind}会话`, committed)
    }
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
    // 反馈重试不再复用原会话(它已结束本轮却未产出有效产物): 清续跑标记,下一轮
    // 重置产物并开新会话。
    resumedSession = undefined
    resumedUsage = undefined
  }
}
