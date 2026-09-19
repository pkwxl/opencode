// 恢复点的单元归属门禁与中断文案: 判定 active 会话所属执行单元本次是否重跑
// (决定能否复用其会话),以及阶段描述 / 恢复说明 / CURRENT.md 中断备注三类
// 面向人与 AI 的文案渲染。只依赖类型与开关,不依赖会话驱动层。
// 拆分自 src/runner.ts(plans/0024-module-split-plan.md S4,纯搬运)。
import { FIX_ROUNDS, REVERIFY_ROUNDS, type Outcome } from "./opts"
import type { Phase } from "./resume"
import { shellProfile } from "./shell"
import { autoSwitches } from "./switches"

// 恢复点的单元归属门禁: active 记录的中断会话属于某个具体执行单元(任务级
// 阶段/子任务#N/修复检查项#N),仅当本次运行将重跑该单元时返回 true(允许
// 复用其会话)。单元已过(检查项序号错位:中断发生在子任务收口后的间歇)、
// 配置/实验开关变更使该单元不再执行、或记录缺失序号无法判定归属(老版本
// 记录)时返回 false——恢复只发生在原单元重跑时,防下一单元误续上一单元的
// 中断会话。ctx 由调用方按当前 PLAN.md/文件状态预计算(文件 IO 不进本函数)。
export type UnitRerunCtx = {
  // 子任务模式(auto/off/ondemand)与 fork 开关(understand/decompose 单元的运行条件)
  mode: "auto" | "off" | "ondemand"
  fork: boolean
  // 当前 PLAN.md 检查项(含 review 注入的修复项)
  items: { text: string; done: boolean }[]
  // docs/<id>/context.md 已有有效摘要 / subtasks.md 已有检查项(理解/分解单元将幂等跳过)
  contextExists: boolean
  subtasksFileItems: number
  // 收尾/验收/审核单元本轮是否会跑(配置与豁免已计入)
  wrapup: boolean
  verify: boolean
  review: boolean
}

export function unitReruns(phase: Phase | undefined, ctx: UnitRerunCtx): boolean {
  const firstUnticked = ctx.items.findIndex((item) => !item.done)
  // 序号归属: 记录的检查项恰为当前首个未勾选项 = 该单元将重跑
  const atItem = (index: number | undefined) => index !== undefined && firstUnticked === index - 1
  switch (phase?.kind) {
    case "understand":
      return ctx.mode === "auto" && ctx.fork && ctx.items.length === 0 && !ctx.contextExists
    case "decompose":
      // 理解单元先跑(fork 且摘要缺失)时,分解会话不是首个消费链的单元
      return ctx.mode === "auto" && ctx.items.length === 0 && ctx.subtasksFileItems === 0 && !(ctx.fork && !ctx.contextExists)
    case "whole":
      return ctx.mode !== "auto"
    case "subtasks":
      return atItem(phase.index)
    case "wrapup":
      return ctx.wrapup && firstUnticked === -1
    case "verify":
      // active 的 verify 记录只会是修复轮执行会话(generate 为旁路、exec 由 driver 承担)
      return phase.stage === "fix" && ctx.verify
    case "review":
      // 审核/修复规划是独立旁路会话(重跑恒新建);active 记录只会是 fixrun 检查项会话
      return phase.stage === "fixrun" && ctx.review && atItem(phase.index)
    case "step":
      // step 恢复点由 loop 经 openStep 判定归属,不经任务流水线复用
      return true
    case undefined:
      // 旧版无阶段记录(session.json): 无法判定单元归属,不复用(恢复走默认流程)
      return false
  }
}
// 阶段的人类可读描述(恢复日志与 CURRENT.md 中断备注共用)。
export function phaseText(phase: Phase | undefined): string {
  switch (phase?.kind) {
    case undefined:
      return "未记录阶段(按默认流程)"
    case "understand":
      return "任务背景理解阶段(写 context.md 摘要)"
    case "decompose":
      return "任务分解阶段(检查项尚未注入)"
    case "whole":
      return "整任务单会话执行阶段"
    case "subtasks":
      return `逐子任务执行阶段(${phase.index !== undefined ? `中断于子任务 ${phase.index},` : ""}从首个未勾选项继续)`
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
    case "step":
      return phase.step === "phase-plan" ? `阶段规划步骤(${phase.letter} 阶段,填充 PLAN.md)` : `阶段交接步骤(${phase.letter} 阶段,产出交接文档)`
  }
}

// 中断恢复时随首个提示词注入的"[driver] 中断后的继续"说明: 按记录的阶段给出
// 具体的下一步指引,使 AI 不重做已完成的工作。
// 严格恢复(OPENCODE_AUTO_STRICT_RESUME=on)下复用会话(R1/R2)收敛为一句 continue
// (plans/0022-session-recovery-fidelity-design.md 3.2): 现场实证表明恢复会话本就靠盘面自定位
// (读 CURRENT.md → git status → 首个未勾选项),阶段指引冗余;逐步骤的下一步指引
// 保留在交接文档/状态文件里,不进恢复提示词。非复用路径(回滚后冷启动不带说明,
// 优雅退出的总结态续跑)维持既有指引。
// strictResume 由调用方传入**门禁值**(strictResumeActive: 开关 on 且提交门禁在位),
// 不是裸开关——门禁关闭(dryrun)时没有单元基线也没有回滚兜底,"一句 continue"赖以
// 成立的前提(不可保真即回滚重跑)不存在,故维持既有多行指引(设计 §4.1 ①/⑥)。
// 缺省取 OPENCODE_AUTO_* 解析值,注入供单测。
// 提交语义澄清(2026-09-17): 恢复会话以 git 核对盘面时,「工作区比预期干净 /
// git log 出现陌生提交」会被误读为修改丢失而重做——中断前落盘的修改可能仍在
// 工作区待提交(单元中途被打断),也可能已由 driver 统一提交(定版/交接/单元收口)
// 或经人工处置提交进 Git(中断后重跑的 clean 门禁要求人工处置脏区)。两种形态
// 都正常,以盘面为准继续,不要重做。
export const COMMIT_CLARIFY =
  `中断前落盘的修改可能仍在工作区待提交,也可能已由 driver 统一提交(或经人工处置)进 Git——` +
  `git log 出现陌生提交、工作区比预期干净,都不代表修改丢失。`

export function resumeNote(phase: Phase | undefined, reused: boolean, strictResume = autoSwitches().strictResume): string {
  if (reused && strictResume) {
    return `[driver] 会话曾中断,请继续当前工作直至本单元完成。中断前落盘的修改若已不在工作区,即已由 driver 统一提交进 Git——以 git log 核实,不要重做。`
  }
  const next = nextStepText(phase)
  if (phase?.kind === "step") {
    return (
      `[driver] 本阶段步骤此前的执行因应用中断而停止。` +
      (reused ? `你正在原来中断的会话中继续。` : `部分工作可能已完成。`) +
      `以 git status / git diff 核对工作区实际状态。${COMMIT_CLARIFY}` +
      `${next}提交由 driver 统一负责,你从不亲自提交;不要重做已完成的工作。`
    )
  }
  return (
    `[driver] 该任务(或其某个子任务)此前的执行因应用中断而停止。` +
    (reused ? `你正在原来中断的会话中继续。` : `部分工作可能已完成。`) +
    `先读 CURRENT.md 了解当前任务与进度,并以 git status / git diff 核对工作区实际状态。${COMMIT_CLARIFY}` +
    `${next}提交由 driver 统一负责,你从不亲自提交;不要重做已完成的工作。`
  )
}

function nextStepText(phase: Phase | undefined): string {
  switch (phase?.kind) {
    case undefined:
      return ""
    case "understand":
      return `当前处于任务背景理解阶段:把理解结果写入 docs/ 下的 context.md 摘要文件(若尚未写出)后结束。`
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
    case "step":
      return phase.step === "phase-plan"
        ? `当前处于阶段规划步骤:先读 PLAN.md 现状(上次会话可能已写入部分任务),在其基础上补全/修正本阶段任务,不要重复已存在的任务编号,完成后结束会话。`
        : `当前处于阶段交接步骤:先读交接文档现状(上次会话可能已写入部分内容),补全四个必备小节(关键决策/约束与坑/下一阶段必读清单/产物索引),不要重做已完成的部分,完成后结束会话。`
  }
}

// CURRENT.md 的中断备注(非完成结局保留文件时写入): 退出原因、阶段快照与恢复
// 方式;下次运行重建镜像时,要点经恢复提示词(resumeNote)带给 AI。
export function interruptionRemark(outcome: Outcome, phase: Phase | undefined): string {
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
    `- 恢复方式: 处理上述原因后重新运行 ${shellProfile().program},driver 将按中断阶段精确继续;本备注要点会随恢复提示词带给 AI。`,
  ].join("\n")
}

export function firstLine(text: string): string {
  return text.split("\n")[0]!.slice(0, 200)
}