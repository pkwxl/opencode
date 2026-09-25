// 会话链与模型路由求值: 任务内会话串链的状态载体(SessionChain / Watch /
// SessionResult / FailedSession / ForkBaseInfo)、阶段→角色→模型的路由求值
// (phaseToRole / roleOf / resolveModel),以及会话错误归类
// (classifySessionError)与会话复用阈值常量。见 plans/0017-model-routing-design.md。
// 拆分自 src/runner.ts(plans/0024-module-split-plan.md S2,纯搬运)。
import type { AgentErrorPatterns } from "./agent/types"
import { type UnitBaseline } from "./git"
import { type ResolveEvent } from "./resolve"
import { type Phase } from "./resume"
import { type Usage } from "./stats"
import type { PhaseTypeEntry, Tier } from "./phases/registry"
import { type ModelPolicy, type ModelRole } from "./switches"

export type Watch = {
  // 会话内阻塞(askHuman 超时回落/权限拒绝)恒为 blocked 形态,不含 dirty——
  // dirty 只在单元启动门禁(runSubtask/requireArtifact/beginUnit)产生,先于会话。
  blocked?: { type: "blocked"; question: string }
  error?: string
  lastText: string
  // 会话结束时最近一次 assistant 消息的上下文占比(0-100);上限未知记 100。
  pct: number
  // 会话结束时最近一次 assistant 消息的上下文已用量(tokens: input + cache.read)。
  used: number
  // 上下文上限(tokens),计算 pct 用;若未知则为 undefined。
  limit?: number
  // 会话耗时(ms)。
  durationMs?: number
  // --handover-test: 会话在 driver 发出测试交接要求后写出交接文档并正常结束,
  // runExecSession 据此开新会话续跑。
  testHandover?: boolean
  // The in-turn handover hint went out in this session (plans/0040 D6; set
  // only when true). The post-session check reads it next to the final figure.
  hinted?: boolean
  // plans/0015-session-error-retry-plan.md: 会话错误是否值得重试(仅 ApiError 携带
  // isRetryable;字段不存在或非 false 一律按可重试处理,保守缺省;多个
  // session.error 事件叠加取悲观口径,只要出现过一次 false 即不可重试)。
  retryable?: boolean
  // plans/0017-model-routing-design.md D.2: 三条触发面增量累积的结构化错误数据(message/
  // statusCode/isRetryable/responseBody,第 3 信号再带 attempt/next),供分类与上报。
  errorInfo?: ErrorInfo
  // 上述 errorInfo 经 classifySessionError 的归类结果(有错误信息时才有意义)。
  errorClass?: ErrorClass
  // 仅 retry part / session.status retry 两条提前结算面置 true:标识本错误可降级,
  // 交由 runSession 的 P4 failover 决策读取(此处只标记,不选择候选)。
  failover?: boolean
  // 本回合 token 增量累加(STATS_PLAN §2,T-003): 逐 step-finish part 按 part.id
  // 去重累加——唯一不重不漏口径(服务端 assistantMessage.tokens 是末步覆盖值、
  // session.tokens 含 fork 继承前缀,均不可直接求和,不得回退到这两个口径)。
  // attempt 在回合结束时据此 statsSessionEnd 入账。
  usage?: Usage
  // 本回合被 driver 代答的提问(auto-resolve H1/H2,plans/0020-auto-resolve-design.md §G):
  // 与 usage 完全同构——由 snapshot 统一带出,7 个 return 出口(含 error/blocked 提前
  // 结算口)一个不漏;attempt 在回合结束时补桶身份后 recordResolves 落账。
  resolves?: ResolveEvent[]
  // 测试交接写核失败(严格恢复,plans/0022-session-recovery-fidelity-design.md 3.3): 会话被要求
  // 写测试交接文档但文档缺失/为空,严格模式下不再补写重试——经 attempt 折成下方
  // SessionResult 的 rollback 标记,交单元所有者回滚后冷启动重做。
  testHandoverInvalid?: boolean
}

export type SessionResult =
  | { type: "idle"; lastText: string; testHandover?: boolean }
  | ({ type: "blocked"; question: string; retryable?: boolean; failover?: boolean; errorClass?: ErrorClass } & {
      // 严格恢复: 本阻塞由交接文档无效触发,单元所有者(executeWhole/runSubtask)据此
      // 回滚到单元基线并冷启动重做,而非把阻塞上抛;无基线的调用方忽略此标记。
      rollback?: boolean
      // Registry routing (plans/0055 §6.3): selection found no usable model
      // for this dispatch — every candidate of the list is down or outside
      // its windows. runSession sends the prompt to the wait-and-probe loop
      // instead of treating this as a session failure.
      noModel?: boolean
      // The §6.3 wait decision (with noModel): every candidate is blocked
      // only by its windows and one that is not down opens later, so the
      // dispatch waits inside the unit instead of probing. runSession sleeps
      // until `until` plus hibernate's jitter and then selects again; the
      // facts carry what the wait line names.
      windowWait?: WindowWait
    })

// The window wait of one dispatch (plans/0055 §6.3): `until` is the earliest
// opening among the candidates that are not down (epoch ms), `model` the
// candidate that opens then (the key selection knows it by), `tier` the
// dispatch's list tier and `opens` the formatted opening ("opens 18:00
// Asia/Shanghai") for the wait line.
export type WindowWait = { until: number; model: string; tier: Tier; opens: string }

// 任务内所有会话(分解/子任务/修复/收尾)串成一条链: 复用受
// OPENCODE_AUTO_REUSE_SESSION 管控,缺省 off = 每个提示词开新会话;开启时上一
// 会话结束时上下文占比低于 REUSE_BELOW、已用量低于 contextLimit 的一半、且距其
// 结束不超过 REUSE_IDLE_MS 才复用。初始 pct=100 保证首个会话新建;模型上限未知时
// watch 记 100,即总是新建。中断恢复接管的会话不受开关与阈值约束(attempt 的
// resumed: 链上有会话且 note 待注入 → 首个提示词必进原会话)。
// phase 携带当前流水线阶段: 执行链会话据此写进度恢复
// 记录(.auto/progress.json);旁路一次性会话(requireArtifact)的链不带 phase、
// 不写记录,避免污染执行链记忆。note 为一次性附加说明(中断恢复时随首个提示词
// 带给 AI,用后即清)。subject 为本会话产出的提交标题(短标签方案): 新建会话
// 以它显式命名,复用会话跨阶段在结束时改名(见 renameSession),使会话列表
// 与 git 历史、任务进度对齐。
// fork 三段式(fork-decompose 设计 §4.3): forkBase 为本链的分叉基点会话(种子
// 链携带,溯源用);pending 为预创建会话 id(seedForkSession 从基点分叉所得),
// attempt() 在 !reuse 时优先消费它(等效于 session.create 的结果),消费即清——
// 瞬时错误重试自然回落 create 路径。
// modelShown 为终端展示的已播报模型(每次 prompt 求值出的 target——未设路由时回落
// 服务端生效模型——与之比对,模型变化时再播报「◈ 使用模型」;新会话(新建/分叉)
// 恒播报,同会话同模型的续跑 prompt 不重复;仅内存态,不落盘)。
// 模型注册表之下的选择态(plans/0055 §6.2,§12): modelEntry 为所选条目的内部名
// (裸 override 值则为其模型串)——续跑判定、降级标记与严格恢复记录都以它为键;
// model 在注册表之下改存「实际下发给适配器的模型 id」(无 model 的条目为 undefined,
// prompt 不带 model 键),兼作续跑判定的 current(会话升步后等于所达步的 id);
// modelStep 为会话已达的上下文步(0 = 基础步,§4.5;步进机制为后续步骤,此处仅
// 记录基位)。无注册表的运行三者恒 undefined,原语义逐字节不变。
// baseline 为当前执行单元的 SHA 基线(严格恢复,plans/0022-session-recovery-fidelity-design.md
// 3.1 ③): runTask 入口/persistStage 阶段边界/runSubtask 子任务门禁/requireArtifact
// 单元门禁处置,attempt 写 active 记录时随记;恢复时据此核对与回滚。
// hinted: the chain's current session was sent the in-turn handover hint
// (copied from its Watch by attempt; plans/0040 D6).
export type SessionChain = { id?: string; pct: number; used: number; at: number; hinted?: boolean; note?: string; phase?: Phase; subject?: string; forkBase?: string; pending?: string; role?: ModelRole; model?: string; modelEntry?: string; modelStep?: number; failed?: FailedSession; modelShown?: string; baseline?: UnitBaseline }

// 刚以可重试错误收场的会话本体(id + 末端用量)。链状态在那一刻已被还原为下发前
// 快照(原会话不被牺牲),失败会话本身随之出了作用域——这里单独记下它,使重试能
// 从"本轮积累最多的会话"分叉: 超时类故障下,失败会话里那 100k+ 已核实研究是最
// 值钱的资产,开空白会话等于把它扔掉再从零撞同一堵墙。副本不顶替恢复点(progress
// 的还原逻辑不动,原会话仍是恢复点),晋升后即清。
// 记录更替 invariant(2026-09-17,配额连败现场修复): 只被 used > 0 的失败顶替
// (fork 副本带着旧前缀又跑出新内容,是严格超集);0-token 纯报错桩不顶替——否则
// 副本下发即死时记录被它覆盖,下一轮重试丢失最有价值的分叉源,退化为基点冷播种。
// fork 播种后记录刻意留存(不清空),直到副本成功收口(attempt 清)或跑出内容
// (顶替);fork 已失效的死记录在择源循环顺手清理。
export type FailedSession = { id: string; used: number }

// fork 基点信息: id 为生效基点会话;used 为基点末端上下文用量(tokens,播种进
// 分叉链使 watch() 的 2×cap 交接阈值按「前缀+新增」计算,首个 turn 的事件跟踪
// 随后自行校正)。undefined = unknown (an agent without readable history, MA.4):
// seedForkSession then starts cold (plans/0038 G1).
export type ForkBaseInfo = { id: string; used: number | undefined }

// resume.Phase → 会话角色(模型路由的细键,见 plans/0017-model-routing-design.md B.5/C.1)。
// 执行链各阶段映射同名角色(decompose 为 M1.0 合并理解与分解会话的角色,plans/0030 D12);
// subtasks 取单数 subtask;closeout 无会话(落 bypass);
// step 变体的英文 slug 即 StepKind(phase-plan / phase-handover),唯独 phase-append 是
// 规划会话的追加变体(plans/0053 D23/F6),路由沿用 phase-plan 角色,不加新角色词——
// 既有路由配置继续生效。phase 缺省时返回 undefined——由 roleOf 落 bypass(裸链与无
// phase 的旁路会话)。
export function phaseToRole(phase: Phase | undefined): ModelRole | undefined {
  if (!phase) return undefined
  switch (phase.kind) {
    case "decompose":
      return "decompose"
    case "whole":
      return "whole"
    case "subtasks":
      return "subtask"
    case "wrapup":
      return "wrapup"
    case "closeout":
      return undefined
    case "step":
      return phase.step === "phase-handover" ? "phase-handover" : "phase-plan"
  }
}

// 会话角色(路由键之一): 显式 chain.role(旁路经 requireArtifact 的 spec.role 设定)
// 优先,其次由执行链 phase 推导,最后兜底 bypass。见设计 B.5/C.1。
export function roleOf(chain: SessionChain): ModelRole {
  return chain.role ?? phaseToRole(chain.phase) ?? "bypass"
}

// 路由求值(设计 C.1,优先级由细到粗): role > phase type id > preset letter >
// wildcard;均未命中返回 undefined(= 不带 model)。两变量未设时空策略对任意
// (phase, role) 恒 undefined,保证 prompt 逐字节等价现状。phase 为当前阶段的类型
// 条目(M3.6: 自定义类型只有类型键,内置类型两种键都认)。
export function resolveModel(policy: ModelPolicy, phase: PhaseTypeEntry | undefined, role: ModelRole): string | undefined {
  return (
    policy.byRole[role] ??
    (phase ? (policy.byType[phase.type] ?? (phase.letter ? policy.byLetter[phase.letter] : undefined)) : undefined) ??
    policy.wildcard
  )
}

// 会话错误归类(plans/0017-model-routing-design.md D.1):换模型是否可能有用,是 failover
// (P4)的决策依据。与 opencode retry.ts 的 RETRYABLE 正则(问"重试有没有用")刻意
// 不同——这里问"换候选模型有没有用"。缺省 unknown 表示拿不准,P4 保守不在其上换。
export type ErrorClass = "quota" | "auth" | "rate" | "overflow" | "transient" | "unknown"

// 分类器的结构化输入:取自 B.4 的三条触发面——session.error 的 data、retry part 的
// ApiError.data(+attempt)、session.status retry 变体(+attempt、next)。字段全可选,
// 便于多信号增量累积(见 watch 内 errorInfo 累加器)。
export type ErrorInfo = {
  message?: string
  statusCode?: number
  isRetryable?: boolean
  responseBody?: string
  attempt?: number
  next?: number
}

// 分类判据集中于此(设计 G.2:新 provider 措辞漏判时,正则在此演进并由 test/chain.test.ts
// 的固定报文样本回归)。分类器问"换模型有没有用",与 opencode 自身的重试分类器不同。
// Neutral wording only (MA.3, plans/0039): an agent's own error type names
// (opencode ContextOverflowError / ProviderAuthError) come from its adapter's
// AgentClient.errorPatterns and are OR-ed in per class. Overflow has no
// neutral pattern: it is recognized by agent-specific names alone.
const QUOTA_RE = /insufficient_quota|quota|balance|credit|usage limit/i
const AUTH_RE = /unauthorized|forbidden/i
const RATE_RE = /rate limit|resource exhausted/i
// 数字状态码须带数字/小数点边界: 裸 500|502|503|504 会把 "Error 1500"、
// "code 5042"、版本号 "5.0.4" 误归 transient(2026-09-17 审查 H4)。长号码里的
// 子串与版本号都不构成"服务端 5xx"信号,应落 unknown 保守不换模型。
const TRANSIENT_RE = /overloaded|timeout|timed out|econn|socket hang up|network|temporar|internal server error|bad gateway|service unavailable|(?<![\d.])50[0234](?![\d.])/i
const QUOTA_STATUS = 402
// rate 阈值:单个 429 只是 opencode 仍在退避(不可据此换模型),须满足"已重试够多次"
// 或"下次等待超阈值"才判 rate(设计 D.1 rate 行、B.4 第 2 信号)。
const RATE_ATTEMPTS = 3
const RATE_WAIT_MS = 60_000

// 归类优先级(自上而下,首个命中即返回,与设计 D.1 判据表一致):
//   1. overflow   —— 报文含上下文溢出错误名(opencode: ContextOverflowError;交接/handover 机制管,明确不换)。
//   2. quota      —— 服务端明说不可重试、或配额/余额/额度文案、或 402。
//   3. auth       —— 401/403 或认证/越权文案(provider 不可用)。
//   4. rate       —— 429/限流文案且达到重试次数或下次等待超阈值。
//   5. transient  —— 已知瞬时错误(走现有重试路径,不换模型)。
//   6. unknown    —— 保守缺省(拿不准不换)。
export function classifySessionError(info: ErrorInfo, extra: AgentErrorPatterns = {}): ErrorClass {
  const hay = `${info.message ?? ""}\n${info.responseBody ?? ""}`
  const hit = (neutral: RegExp | undefined, own: RegExp | undefined) => (neutral?.test(hay) ?? false) || (own?.test(hay) ?? false)
  if (hit(undefined, extra.overflow)) return "overflow"
  if (info.isRetryable === false || hit(QUOTA_RE, extra.quota) || info.statusCode === QUOTA_STATUS) return "quota"
  if (info.statusCode === 401 || info.statusCode === 403 || hit(AUTH_RE, extra.auth)) return "auth"
  const rateSignal = info.statusCode === 429 || hit(RATE_RE, extra.rate)
  const rateThreshold = (info.attempt ?? 0) >= RATE_ATTEMPTS || (info.next ?? 0) > RATE_WAIT_MS
  if (rateSignal && rateThreshold) return "rate"
  if (hit(TRANSIENT_RE, extra.transient)) return "transient"
  return "unknown"
}

// 上下文占比低于该值(%)时复用上一会话(仅 OPENCODE_AUTO_REUSE_SESSION=on 生效)。
export const REUSE_BELOW = 50

// 会话复用的间隔上限(仅 OPENCODE_AUTO_REUSE_SESSION=on 生效): 距上一会话结束
// 超过该值即视为上下文陈旧(driver 侧工作如测试脚本执行可能耗时很久),不复用、开新会话。
export const REUSE_IDLE_MS = 5 * 60 * 1000
export const REUSE_IDLE_MINUTES = REUSE_IDLE_MS / 60_000
