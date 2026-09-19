// 降级回试与 /failback(设计文档 plans/0017-model-routing-design.md):
// OPENCODE_AUTO_MODEL_FAILBACK_SCOPE 控制降级到候选模型后、在哪个流水线边界重置回
// 首选模型——包含式粒度(与 step.ts 同一 RANK 思路): phase 仅阶段边界(降级跨任务
// 粘滞,经本模块 sticky holder 承载);task(缺省)= 现状,链逐任务销毁天然归零,无
// 需代码;subtask 加子任务边界(清 chain.model);session 每个新会话起点都回试首选
// (attempt 新建会话分支清零;降级 fork 出的迁移会话走 pending 路径不触发,防震荡)。
//
// /failback(--interactive 常驻输入行,与 /exit 同构): 置位后在下一个安全边界
// (phase/task/subtask,挂点同 step.ts)消费——不抛异常、不占退出码通道,只重置降级
// 状态;带参数时整体重定义模型序(首个为首选通配、其余为降级候选环),经本模块
// override 层在运行期覆盖 switches.model(switches memo 恒定,不原地改)。
import { log } from "./log"
import type { Boundary } from "./step"
import type { FailbackScope } from "./switches"

// 边界与粒度的细度序: 值越细序越大,边界序 ≤ 粒度序即重置(session 无对应
// Boundary——它的重置点是 attempt 的新建会话分支,不走边界挂点)。
const RANK: Record<FailbackScope | Boundary, number> = { phase: 1, task: 2, subtask: 3, session: 4 }

// 粒度是否覆盖该边界(纯函数,供单测): 包含式——session 覆盖全部边界,subtask 覆盖
// subtask/task/phase,task 覆盖 task 与 phase(均由链/holder 生命周期天然承担),
// phase 只覆盖 phase。
export function failbackApplies(scope: FailbackScope, boundary: Boundary): boolean {
  return RANK[boundary] <= RANK[scope]
}

// 单进程模块态(每次 CLI 调用是独立进程,天然复位;单测经 resetFailback 复位):
// - sticky: phase 粒度的跨任务降级 holder,仅 scope=phase 时由 switchModel 写入,
//   阶段边界无条件清(其他粒度下恒为 undefined,清理是空操作);
// - pending: /failback 请求(可选整体重定义模型序);
// - override: /failback 带参消费后的运行期模型序覆写,attempt/switchModel 读它优先于
//   switches.model(不破坏 switches memo 恒定约定)。
let sticky: string | undefined
let pending: { order?: string[] } | undefined
let override: { wildcard: string; fallback: string[] } | undefined

// /failback 置位(interactive.ts 已校验参数形态): order 非空 = 整体重定义模型序
// (首个为首选、其余按序为降级候选环);空 = 仅重置降级状态回试当前首选。
export function requestFailback(order?: string[]): void {
  pending = order !== undefined && order.length > 0 ? { order } : {}
}

export function failbackRequested(): boolean {
  return pending !== undefined
}

export function stickyModel(): string | undefined {
  return sticky
}

export function setSticky(model: string): void {
  sticky = model
}

// 阶段边界挂点(loop.ts,紧随 maybeExit): 无条件清 sticky——sticky 只在 scope=phase
// 下写入,其余粒度下是空操作。
export function clearSticky(): void {
  sticky = undefined
}

export function failbackOverride(): { wildcard: string; fallback: string[] } | undefined {
  return override
}

// 三处安全边界共用的 /failback 消费点(紧随 maybeExit 之后;subtask 边界传入链以清
// chain.model,task/phase 边界链已随 runTask 销毁、无需传入): 命中即重置降级状态
// (链上候选 + sticky holder),带参时同时重定义运行期模型序。返回是否消费。
export function consumeFailback(chain?: { model?: string }): boolean {
  if (pending === undefined) return false
  if (chain) chain.model = undefined
  sticky = undefined
  const order = pending.order
  pending = undefined
  if (order !== undefined) {
    override = { wildcard: order[0]!, fallback: order.slice(1) }
    log(`⇄ /failback 生效: 首选模型重定义为 ${override.wildcard},降级候选序 ${override.fallback.join(", ") || "(无)"};降级状态已重置`)
  } else {
    log(`⇄ /failback 生效: 降级状态已重置,下一提示词重回首选模型`)
  }
  return true
}

// 仅供单测复位(bun test 单进程跑多个测试文件,模块级状态跨文件残留;先例 exit.ts)。
export function resetFailback(): void {
  sticky = undefined
  pending = undefined
  override = undefined
}
