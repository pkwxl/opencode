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
//
// Down marks(plans/0055 §6.4):模型注册表之下的降级标记——按模型内部名(及按
// provider+key 引用,供后续步骤的密钥环)记「已降级」,在 OPENCODE_AUTO_MODEL_
// FAILBACK_SCOPE 的边界与 /failback 处清零;带 until 的标记活到该时刻为止。无注册
// 表的运行不写标记,sticky 语义逐字节不变。
import { log } from "./log"
import type { Boundary } from "./step"
import type { FailbackScope } from "./switches"

// 边界与粒度的细度序: 值越细序越大,边界序 ≤ 粒度序即重置(session 无对应
// Boundary——对链上候选它的重置点是 attempt 的新建会话分支;对下面的 down
// marks,"session" 是 scope=session 的等价边界: 每个新会话起点清标记)。
const RANK: Record<FailbackScope | Boundary, number> = { phase: 1, task: 2, subtask: 3, session: 4 }

// 粒度是否覆盖该边界(纯函数,供单测): 包含式——session 覆盖全部边界,subtask 覆盖
// subtask/task/phase,task 覆盖 task 与 phase(均由链/holder 生命周期天然承担),
// phase 只覆盖 phase。"session" 作为边界只被 scope=session 覆盖。
export function failbackApplies(scope: FailbackScope, boundary: Boundary | "session"): boolean {
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

// ---------------------------------------------------------------------------
// Down marks (plans/0055 §6.4): under a model registry, a classified failure
// marks a model down and a key failure marks a key down (the key half feeds
// the per-provider rings of a later step); selection then moves to the next
// usable candidate, and the primary returns when its mark clears. The marks
// take over from the phase-scoped `sticky` holder, which keeps its exact
// no-registry semantics: marks are written only where a registry drives the
// failover, so a run without one never touches them.
//
// Marks live in memory only (nothing persists); a new run starts with every
// model eligible. They are keyed by the model's internal name (a raw override
// value by its model string, matching how selection reads them) and by
// (provider, key reference) for a ring. A mark may carry `until`, the instant
// a reset time named: it lasts until that instant *instead of* the scope
// boundary, so a boundary clear keeps it and a read past the instant treats
// it as cleared.
// ---------------------------------------------------------------------------

// A down mark; `until` (epoch ms) is the instant a reset time named, absent
// = the mark clears at the scope boundaries. `classifier` = the class that
// wrote the mark came from the failure-message classifier (plans/0055 §7.1),
// so the ◈ line names the move `quota (classifier)` (§6.5).
export type DownMark = { until?: number; classifier?: true }

const downModels = new Map<string, DownMark>()
const downKeys = new Map<string, Map<string, DownMark>>()

// The run's model down marks by internal name; selection reads this map
// through its context. The map is never replaced, only mutated, so a held
// reference stays live.
export function downMarks(): ReadonlyMap<string, DownMark> {
  return downModels
}

export function markModelDown(model: string, until?: number, classifier?: boolean): void {
  downModels.set(model, { ...(until !== undefined ? { until } : {}), ...(classifier === true ? { classifier: true as const } : {}) })
}

// A reset time that became known after the mark was written (the
// classifier's answer arriving after the turn ended, plans/0055 §7.1): the
// mark now lasts until that instant instead of the scope boundary. Only an
// existing mark is changed — a mark a boundary or /failback already cleared
// is not written again.
export function extendModelDownMark(model: string, until: number): boolean {
  const mark = downModels.get(model)
  if (mark === undefined) return false
  downModels.set(model, { ...mark, until })
  return true
}

// Removes one model's mark (the recovery probe's "a successful probe clears
// that candidate's mark", §6.3; a failed probe re-marks it through the
// caller). Key marks are not touched.
export function clearModelDownMark(model: string): void {
  downModels.delete(model)
}

export function modelDownMark(model: string): DownMark | undefined {
  return downModels.get(model)
}

export function isModelDown(model: string, now: number): boolean {
  const mark = downModels.get(model)
  return mark !== undefined && (mark.until === undefined || mark.until > now)
}

// Key marks, per provider and key reference (the ring position itself never
// moves back, §4.3; only whether a key is down lives here).
export function markKeyDown(provider: string, key: string, until?: number): void {
  let marks = downKeys.get(provider)
  if (marks === undefined) {
    marks = new Map()
    downKeys.set(provider, marks)
  }
  marks.set(key, until !== undefined ? { until } : {})
}

// The key-mark counterpart of extendModelDownMark: an existing key mark
// lasts until `until`.
export function extendKeyDownMark(provider: string, key: string, until: number): boolean {
  const marks = downKeys.get(provider)
  const mark = marks?.get(key)
  if (marks === undefined || mark === undefined) return false
  marks.set(key, { ...mark, until })
  return true
}

export function keyDownMark(provider: string, key: string): DownMark | undefined {
  return downKeys.get(provider)?.get(key)
}

export function isKeyDown(provider: string, key: string, now: number): boolean {
  const mark = keyDownMark(provider, key)
  return mark !== undefined && (mark.until === undefined || mark.until > now)
}

// Clears one provider's key marks: the recovery probe's ring half (§6.3 —
// the probe candidate ignores the down marks and the ring). The ring
// position itself lives in src/keyring.ts and never moves here.
export function clearKeyDownMarks(provider: string): void {
  downKeys.get(provider)?.clear()
}

// Marks at a scope boundary (§6.4): the boundary clears every mark the scope
// covers — phase clears under every scope, task under task (default) and
// finer, and "session" is the new-session start of scope=session, which is
// also the only scope that clears there. A mark with `until` lasts until
// that instant instead, so it survives the clear and reads as up once the
// instant has passed. Calling this at a boundary the scope does not cover is
// a no-op.
export function clearDownMarks(boundary: Boundary | "session", scope: FailbackScope): void {
  if (!failbackApplies(scope, boundary)) return
  dropScopeCleared(downModels)
  for (const marks of downKeys.values()) dropScopeCleared(marks)
}

function dropScopeCleared(marks: Map<string, DownMark>): void {
  for (const [key, mark] of marks) if (mark.until === undefined) marks.delete(key)
}

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
// (链上候选 + sticky holder + down marks),带参时同时重定义运行期模型序。返回是否消费。
// The chain's selected registry entry is cleared with the raw candidate
// (plans/0055 §6.4: the next prompt re-selects from the list).
// AUTO-RESOLVE: does a mark with `until` survive `/failback`, as it survives a scope boundary? -> no, `/failback` clears every mark, an `until` included (§6.4 lists the scope boundaries and `/failback` separately, and says `until` stands in for the scope boundary; the operator's explicit command retries the primary now, so a quota reset time must not override it)
export function consumeFailback(chain?: { model?: string; modelEntry?: string; modelStep?: number }): boolean {
  if (pending === undefined) return false
  if (chain) {
    chain.model = undefined
    chain.modelEntry = undefined
    chain.modelStep = 0
  }
  sticky = undefined
  downModels.clear()
  downKeys.clear()
  const order = pending.order
  pending = undefined
  if (order !== undefined) {
    override = { wildcard: order[0]!, fallback: order.slice(1) }
    log(`⇄ /failback applied: primary model redefined as ${override.wildcard}, fallback order ${override.fallback.join(", ") || "(none)"}; fallback state reset`)
  } else {
    log(`⇄ /failback applied: fallback state reset, next prompt returns to the primary model`)
  }
  return true
}

// 仅供单测复位(bun test 单进程跑多个测试文件,模块级状态跨文件残留;先例 exit.ts)。
export function resetFailback(): void {
  sticky = undefined
  pending = undefined
  override = undefined
  downModels.clear()
  downKeys.clear()
}
