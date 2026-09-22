// OPENCODE_AUTO_* 实验开关注册表——环境变量层(fork 系开关设计文档
// plans/0003-fork-decompose-design.md §4.6,步进开关 plans/0012-step-mode-design.md):
// 实验期全部开关经 OPENCODE_AUTO_* 环境变量注入、核心内一次解析(memo)、全流水线
// 一致,CLI 壳零改动(命名沿 OPENCODE_AUTO_SERVER 先例,src/server.ts)。不落盘:
// 实验语义 = 本次运行,区别于宪法键的 init 固化,同一次运行内开关恒定;宪法键
// 转正(实验定型后)另议。空串视同未设;非法值 throw 中文报错(含变量名与期望
// 值域),经 runner 入口(runTask)抛出、CLI 侧转退出码 1——与配置「坏文件严格
// 失败」哲学一致。
import { log, vlog } from "./log"
import { PHASE_LETTERS, type PhaseLetter } from "./phases/registry"

// 开关的环境变量名(解析、启动日志与测试引用同一来源)。
export const SWITCH_ENV = {
  fork: "OPENCODE_AUTO_FORK",
  forkBase: "OPENCODE_AUTO_FORK_BASE",
  fine: "OPENCODE_AUTO_DECOMPOSE_FINE",
  steer: "OPENCODE_AUTO_STEER",
  step: "OPENCODE_AUTO_STEP",
  refCheck: "OPENCODE_AUTO_REF_CHECK",
  reuseSession: "OPENCODE_AUTO_REUSE_SESSION",
  stuck: "OPENCODE_AUTO_STUCK",
  taskContext: "OPENCODE_AUTO_TASK_CONTEXT",
  ask: "OPENCODE_AUTO_ASK",
  model: "OPENCODE_AUTO_MODEL",
  modelFallback: "OPENCODE_AUTO_MODEL_FALLBACK",
  modelFailbackScope: "OPENCODE_AUTO_MODEL_FAILBACK_SCOPE",
  retryWaits: "OPENCODE_AUTO_RETRY_WAITS",
  recoveryWait: "OPENCODE_AUTO_RECOVERY_WAIT",
  strictResume: "OPENCODE_AUTO_STRICT_RESUME",
  handoverConcurrent: "OPENCODE_AUTO_HANDOVER_CONCURRENT",
  hibernate: "OPENCODE_AUTO_HIBERNATE",
  agent: "OPENCODE_AUTO_AGENT",
} as const

// 步进模式(OPENCODE_AUTO_STEP)值域: off 不暂停;phase/task/subtask 为包含式
// 粒度——所取值及更粗的边界都暂停(见 src/step.ts)。
export type StepMode = "off" | "phase" | "task" | "subtask"

// 降级回试粒度(OPENCODE_AUTO_MODEL_FAILBACK_SCOPE)值域: 降级到候选模型后,在哪个
// 边界重新回到首选模型——包含式粒度,所取值及更粗的边界都重置(与 step 同一 RANK
// 思路,见 src/failback.ts): phase 仅阶段边界(跨任务粘滞);task(缺省)= 现状,
// 链逐任务销毁天然归零;subtask 加子任务边界;session 每个新会话起点都回试首选
// (降级 fork 出的迁移会话不触发,防震荡)。
export type FailbackScope = "phase" | "task" | "subtask" | "session"

// 理解摘要行数档位(OPENCODE_AUTO_TASK_CONTEXT)值域: off 为现状(建议 200 行
// 以内);small/medium/large 逐档放宽(300/400/500 行,见 src/prompt.ts 的
// TASK_CONTEXT_LINES)——仅调整提示词里的"建议行数"措辞,不做代码侧截断或校验
// (context.md 本就无硬性行数限制,超出建议行数不会被拒收)。
export type TaskContextMode = "off" | "small" | "medium" | "large"

// 会话角色词表(阶段化模型路由,见 plans/0017-model-routing-design.md C.1):实验期固定、
// 不做自由命名;与 B.5 执行链角色一一对应,`bypass` 为未显式给 role 的旁路会话兜底。
// 导出为共享真源,后续 P2(resolveModel / roleOf)与旁路改造复用同一份。
// M1.0 起 understand/decompose 两会话合一(plans/0030 D12): 词表不再含 understand——
// 合并会话路由在 decompose 角色下,旧配置里的 understand= 键按非法键严格失败;
// verify-*/review-*/final-plan 随三机制退役出表(plans/0044 D1),同样严格失败。
export const MODEL_ROLES = [
  "decompose",
  "whole",
  "subtask",
  "wrapup",
  "phase-plan",
  "phase-handover",
  "knowledge",
  "prior-knowledge",
  "implement-scan",
  "number-recovery",
  "bypass",
] as const
export type ModelRole = (typeof MODEL_ROLES)[number]

// 阶段字母键(OPENCODE_AUTO_MODEL 条目表的字母键值域 = 阶段类型注册表的预置字母,
// 见 runner 的 opts.phase)。
const MODEL_LETTERS = PHASE_LETTERS
export type ModelLetter = PhaseLetter

// 归一化后的模型路由策略(P1 只解析并持有,实际求值 resolveModel 落 P2)。缺省
// wildcard=undefined / byLetter={} / byRole={} / fallback=[] 即「未设」——两变量
// 均未设时 resolveModel 必须据此起「不带 model」(逐字节等价现状)。
export type ModelPolicy = {
  wildcard?: string
  byLetter: Partial<Record<ModelLetter, string>>
  byRole: Partial<Record<ModelRole, string>>
  fallback: string[]
}

export type Switches = {
  // fork 三段式流水线总开关: off = 现状流水线(无理解会话、无分叉),行为零变化。
  fork: boolean
  // fork 基点模式(仅 fork=on 有意义): session = 理解会话末端;digest = 以
  // context.md 摘要为输入新建基点会话(前缀瘦、建立后跨运行持久复用、失效时可从
  // 磁盘确定性重建)。
  forkBase: "session" | "digest"
  // 细粒度分解: decompose-<phase> 模板注入细粒度准则段(仍受下限保护约束)。
  fine: boolean
  // 超限交接 steer(2×cap): off = 停用会话中交接注入与会话后的交接判定
  // (自然完成即收;--handover-test 的测试交接是独立机制,不受影响)。
  steer: boolean
  // 步进模式: phase/task/subtask 在对应(及更粗)边界硬暂停等回车放行。
  step: StepMode
  // refcheck 总开关(refcheck-scope-design D3,缺省 off): off 时两处挂点
  // (提交前 auto-correct、check 引用扫描)全部空转,目标目录
  // 零引用检查行为;fix-refs 手动脚本不受约束(人工显式执行等价于显式开启)。
  refCheck: boolean
  // 会话链复用总开关(缺省 off): off = 任务内每个提示词都开新会话(链上只留
  // 上一会话的用量供日志与交接判定),阈值规则(REUSE_BELOW / cap 一半 /
  // REUSE_IDLE_MS)不再参与;on = 恢复既有的阈值复用。中断恢复接管的会话不受
  // 本开关约束(恢复语义即"接着被中断的那个会话继续",见 attempt 的 resumed)。
  reuseSession: boolean
  // 死循环检测(缺省 on,见 src/stuck.ts): 会话内重复同一动作且结果不变时,
  // driver 经 steer 主动注入提示(每会话至多三次,不中止会话);off = 不检测、
  // 不注入。dryrun 预检会话本就靠反复被拒探查权限,恒不检测(与本开关无关)。
  stuck: boolean
  // 理解摘要行数档位(缺省 off,现状零变化): small/medium/large 放宽 context.md
  // 的建议行数上限(见 src/prompt.ts 的 TASK_CONTEXT_LINES),供怀疑摘要因"建议
  // 200 行"措辞被过度压缩、信息丢失时调大预算验证。
  taskContext: TaskContextMode
  // 提问策略(缺省 off,现状零变化;设计文档 plans/0020-auto-resolve-design.md §E):
  // off = 压制——非权限问题一律不调 question 工具、自主决策,凡本应发问却未发问的
  // 分歧点强制以 AUTO-RESOLVE 标注,纯工程取舍以 AUTO-DECISION 标注;on = 允许——
  // 决定权属于用户的分歧点主动调 question 工具发问,纯实现手段自主决定且不要求
  // 任何标注(提问是流经 driver 的事件,代答记录由 driver 观测即完备)。提问策略
  // 与标注义务同进同退、由本开关单键切换,不拆成两个独立布尔量。
  ask: boolean
  // 阶段化模型路由 + 配额降级候选(缺省未设 = 现状零变化): OPENCODE_AUTO_MODEL 归一
  // 化为 wildcard/byLetter/byRole,OPENCODE_AUTO_MODEL_FALLBACK 的有序候选折进 fallback。
  // 实际求值与降级动作落 P2/P4,本层只解析、校验、日志登记。
  model: ModelPolicy
  // 降级回试粒度(缺省 task = 现状零变化): 降级后在哪个边界重置回首选模型,
  // 见 FailbackScope 与 src/failback.ts;/failback 命令的运行期覆写不经过本层
  // (src/failback.ts 模块态)。
  modelFailbackScope: FailbackScope
  // 瞬时会话错误的重试阶梯(OPENCODE_AUTO_RETRY_WAITS,逗号分隔的分钟数):每个
  // 元素是「该次重试前的等待」,元素个数即重试次数上限。缺省 0,1,2,4,8 = 五次
  // 重试,首次立即、其后 1/2/4/8 分钟。off = 不重试(首次失败即进等待-探测环)。
  retryWaits: number[]
  // 等待-探测环的间隔分钟数(OPENCODE_AUTO_RECOVERY_WAIT): 会话故障(不可重试的
  // 配额类、阶梯耗尽的瞬时类、降级候选用尽)一律不再阻塞退出,改为以该间隔无限
  // 等待,每轮用全新临时会话下发极小探测提示词;探测成功(服务恢复)后 fork 被中断
  // 的会话续跑。等待期间连按两次 Ctrl+C 经进程级 SIGINT 处理器强制退出(130)。
  recoveryWait: number
  // 严格恢复(plans/0022-session-recovery-fidelity-design.md,缺省 off = 现状): on 时进度
  // 记录补单元基线 baseline 与生效模型 model、恢复时核对(外部提交混入走 dirty、
  // 模型不一致/会话死亡/--new-session 回滚到单元基线重跑)、复用会话的恢复说明
  // 收敛为一句 continue、交接文档无效一次即回滚。门禁关闭(--commit false/dryrun)
  // 时由 runner 侧整体空转(记录不带新字段)。
  strictResume: boolean
  // 测试交接的测试时机(缺省 off = 先交接、后运行): off 时定版提交后只把脚本定下来
  // (消费 tmp/test.sh 标记),会话收尾、交接文档归档、提交 #2 全部完成之后才执行——
  // 被测的就是提交 #2 的那一份树,收尾期没有并发写。on 恢复旧的真并发(定版后不 await
  // 测试即下发收尾),此时测试面对的是定版快照,收尾期若改了被测内容只打一行告警,
  // 不 stash、不重跑、不阻塞(重测守卫已随本开关的引入退役,见
  // plans/0023-test-handover-early-design.md §H)。
  handoverConcurrent: boolean
  // 休眠时段(避开 LLM 高收费时段,plans/0027-hibernate-design.md,缺省 undefined = 不休眠,
  // 现状零变化): OPENCODE_AUTO_HIBERNATE="HH:MM+H"(UTC 每日窗口,H 小时允许小数)。
  // 只在三处既有安全边界(phase/task/subtask,挂点同 step.ts)与启动时检查「现在是否
  // 在窗口内」——在窗口内睡到窗口结束 + 固定随机 0~600 秒再继续;执行中的单元跑到
  // 边界才停,天然实现「优雅等待到安全退出点再暂停」。不预判下一单元、不落盘。
  hibernate: HibernateWindow | undefined
  // Built-in coding agent behind the run (MA.5, plans/0041): opencode (default,
  // unchanged) or claude (the headless adapter, src/agent/claude/). A shell
  // whose profile names an agent (setShellProfile `agent`) overrides it.
  agent: AgentChoice
}

export type AgentChoice = "opencode" | "claude"

// 休眠窗口(OPENCODE_AUTO_HIBERNATE 归一化形态): startMin = UTC 窗口起点(当日分钟
// 数,∈ [0,1440));durationMin = 时长(分钟,∈ (0,1440),允许小数)。跨午夜(如
// 22:00+8)由消费侧取模处理。解析见 parseSwitches 的 hibernate 段。
export type HibernateWindow = { startMin: number; durationMin: number }

const SWITCH_DEFAULTS: Switches = {
  fork: true,
  forkBase: "digest",
  fine: true,
  steer: false,
  step: "off",
  refCheck: false,
  reuseSession: false,
  stuck: true,
  taskContext: "off",
  ask: false,
  model: { byLetter: {}, byRole: {}, fallback: [] },
  modelFailbackScope: "task",
  retryWaits: [0, 1, 2, 4, 8],
  recoveryWait: 30,
  strictResume: false,
  handoverConcurrent: false,
  hibernate: undefined,
  agent: "opencode",
}

// OPENCODE_AUTO_MODEL / _FALLBACK 归一化为 ModelPolicy(纯函数,供单测)。两形态:
// 裸值 prov/model 等价全量覆盖(*=prov/model);条目表 `键=prov/model` 逗号分隔,键 ∈
// {* ∪ 阶段字母 ∪ 角色词表},条目内分隔符用 = 而非 :(model id 可能含冒号)。值必须
// 含 /;空串视同未设。坏值严格失败: throw 中文报错(含变量名、示例、越界键/坏值)。
function parseModelPolicy(rawModel: string | undefined, rawFallback: string | undefined): ModelPolicy {
  const policy: ModelPolicy = { byLetter: {}, byRole: {}, fallback: [] }
  const modelExample = "*=kimi/k2,m=anthropic/c-4,wrapup=kimi/k2-lite"
  const modelRaw = rawModel === undefined || rawModel === "" ? undefined : rawModel
  if (modelRaw !== undefined) {
    if (modelRaw.includes("=")) {
      // 条目表形态:逐条 key=value。
      for (const entry of modelRaw.split(",")) {
        const idx = entry.indexOf("=")
        if (idx < 0) {
          throw new Error(
            `env ${SWITCH_ENV.model} invalid entry: "${entry}" (entry-list form requires key=prov/model per item; example ${modelExample})`,
          )
        }
        const key = entry.slice(0, idx)
        const value = entry.slice(idx + 1)
        if (!value.includes("/")) {
          throw new Error(
            `env ${SWITCH_ENV.model} invalid value: "${value}" (model for key "${key}" must be provider/model with a slash; example ${modelExample})`,
          )
        }
        if (key === "*") policy.wildcard = value
        else if ((MODEL_LETTERS as readonly string[]).includes(key)) policy.byLetter[key as ModelLetter] = value
        else if ((MODEL_ROLES as readonly string[]).includes(key)) policy.byRole[key as ModelRole] = value
        else {
          throw new Error(
            `env ${SWITCH_ENV.model} invalid key: "${key}" (expected *, a phase letter ${MODEL_LETTERS.join("|")}, or a role word ${MODEL_ROLES.join("|")}; example ${modelExample})`,
          )
        }
      }
    } else {
      // 裸值形态:全量覆盖。
      if (!modelRaw.includes("/")) {
        throw new Error(
          `env ${SWITCH_ENV.model} invalid value: "${modelRaw}" (bare value must be provider/model with a slash, or use entry-list key=prov/model; example ${modelExample})`,
        )
      }
      policy.wildcard = modelRaw
    }
  }
  const fallbackRaw = rawFallback === undefined || rawFallback === "" ? undefined : rawFallback
  if (fallbackRaw !== undefined) {
    // 有序候选表 prov/a,prov/b;空/未设 = 不降级(空数组)。
    for (const item of fallbackRaw.split(",")) {
      if (!item.includes("/")) {
        throw new Error(
          `env ${SWITCH_ENV.modelFallback} invalid value: "${item}" (candidates must be provider/model, a comma-separated ordered list; example prov/a,prov/b)`,
        )
      }
      policy.fallback.push(item)
    }
  }
  return policy
}

// 由策略回推 OPENCODE_AUTO_MODEL 的环境变量取值(启动日志用):固定按 wildcard→
// 字母→角色的稳定次序渲染条目表;三项皆空返回空串(视同未设)。
function renderModelEnv(policy: ModelPolicy): string {
  const parts: string[] = []
  if (policy.wildcard !== undefined) parts.push(`*=${policy.wildcard}`)
  for (const letter of MODEL_LETTERS) {
    const value = policy.byLetter[letter]
    if (value !== undefined) parts.push(`${letter}=${value}`)
  }
  for (const role of MODEL_ROLES) {
    const value = policy.byRole[role]
    if (value !== undefined) parts.push(`${role}=${value}`)
  }
  return parts.join(",")
}

// 休眠窗口的规范写法(启动日志与单测同一来源): HH:MM+H(HH 补零两位,H 为小时数、
// 小数渲染原样);undefined(未设)返回空串(视同未设)。
export function formatHibernate(window: HibernateWindow | undefined): string {
  if (window === undefined) return ""
  const hh = String(Math.floor(window.startMin / 60)).padStart(2, "0")
  const mm = String(window.startMin % 60).padStart(2, "0")
  return `${hh}:${mm}+${window.durationMin / 60}`
}

// OPENCODE_AUTO_HIBERNATE 解析(纯函数): "HH:MM+H"——UTC 每日窗口,H 为小时数(允许
// 小数,如 6.5)。空串/未设 = undefined(不休眠);坏值严格失败: throw 中文报错(含
// 变量名、期望值域与示例)。
function parseHibernate(raw: string | undefined): HibernateWindow | undefined {
  if (raw === undefined || raw === "") return undefined
  const match = /^(\d{1,2}):(\d{2})\+(\d+(?:\.\d+)?)$/.exec(raw)
  if (!match) {
    throw new Error(
      `env ${SWITCH_ENV.hibernate} invalid value: "${raw}" (expected HH:MM+H — UTC start + hibernate hours, e.g. 04:00+6, 22:00+8.5; empty string = unset, default no hibernation)`,
    )
  }
  const hour = Number(match[1])
  const minute = Number(match[2])
  const hours = Number(match[3])
  if (hour > 23 || minute > 59 || !(hours > 0) || hours >= 24) {
    throw new Error(
      `env ${SWITCH_ENV.hibernate} invalid value: "${raw}" (HH ∈ 00..23, MM ∈ 00..59, H ∈ (0,24) hours; example 04:00+6)`,
    )
  }
  return { startMin: hour * 60 + minute, durationMin: hours * 60 }
}

// 解析(纯函数,供单测): env 传 process.env 或测试构造的记录;值为空串视同未设
// (取缺省),非法值 throw 中文报错。
export function parseSwitches(env: Record<string, string | undefined>): Switches {
  const onOff = (name: string, raw: string | undefined, fallback: boolean): boolean => {
    const value = raw === undefined || raw === "" ? (fallback ? "on" : "off") : raw
    if (value !== "on" && value !== "off") {
      throw new Error(`env ${name} invalid value: "${raw}" (expected on|off; empty string = unset, default ${fallback ? "on" : "off"})`)
    }
    return value === "on"
  }
  // 分钟阶梯: off = 空表(不重试);否则逗号分隔的非负分钟数(允许小数,供单测取
  // 亚分钟值)。空串视同未设。
  const waitList = (name: string, raw: string | undefined, fallback: number[]): number[] => {
    if (raw === undefined || raw === "") return fallback
    if (raw === "off") return []
    const parts = raw.split(",").map((part) => part.trim())
    return parts.map((part) => {
      const value = Number(part)
      if (part === "" || !Number.isFinite(value) || value < 0) {
        throw new Error(`env ${name} invalid value: "${raw}" (expected off or comma-separated non-negative minutes, e.g. 0,1,2,4,8; empty string = unset)`)
      }
      return value
    })
  }
  const minutes = (name: string, raw: string | undefined, fallback: number): number => {
    if (raw === undefined || raw === "") return fallback
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`env ${name} invalid value: "${raw}" (expected non-negative minutes, 0 = no wait; empty string = unset, default ${fallback})`)
    }
    return value
  }
  const forkBaseRaw = env[SWITCH_ENV.forkBase]
  const forkBase = forkBaseRaw === undefined || forkBaseRaw === "" ? SWITCH_DEFAULTS.forkBase : forkBaseRaw
  if (forkBase !== "session" && forkBase !== "digest") {
    throw new Error(`env ${SWITCH_ENV.forkBase} invalid value: "${forkBaseRaw}" (expected session|digest; empty string = unset, default digest)`)
  }
  const stepRaw = env[SWITCH_ENV.step]
  const step = stepRaw === undefined || stepRaw === "" ? SWITCH_DEFAULTS.step : stepRaw
  if (step !== "off" && step !== "phase" && step !== "task" && step !== "subtask") {
    throw new Error(
      `env ${SWITCH_ENV.step} invalid value: "${stepRaw}" (expected off|phase|task|subtask; empty string = unset, default off)`,
    )
  }
  const taskContextRaw = env[SWITCH_ENV.taskContext]
  const taskContext = taskContextRaw === undefined || taskContextRaw === "" ? SWITCH_DEFAULTS.taskContext : taskContextRaw
  if (taskContext !== "off" && taskContext !== "small" && taskContext !== "medium" && taskContext !== "large") {
    throw new Error(
      `env ${SWITCH_ENV.taskContext} invalid value: "${taskContextRaw}" (expected off|small|medium|large; empty string = unset, default off)`,
    )
  }
  const failbackScopeRaw = env[SWITCH_ENV.modelFailbackScope]
  const modelFailbackScope =
    failbackScopeRaw === undefined || failbackScopeRaw === "" ? SWITCH_DEFAULTS.modelFailbackScope : failbackScopeRaw
  if (
    modelFailbackScope !== "phase" &&
    modelFailbackScope !== "task" &&
    modelFailbackScope !== "subtask" &&
    modelFailbackScope !== "session"
  ) {
    throw new Error(
      `env ${SWITCH_ENV.modelFailbackScope} invalid value: "${failbackScopeRaw}" (expected phase|task|subtask|session; empty string = unset, default task)`,
    )
  }
  const agentRaw = env[SWITCH_ENV.agent]
  const agent = agentRaw === undefined || agentRaw === "" ? SWITCH_DEFAULTS.agent : agentRaw
  if (agent !== "opencode" && agent !== "claude") {
    throw new Error(`env ${SWITCH_ENV.agent} invalid value: "${agentRaw}" (expected opencode|claude; empty string = unset, default opencode)`)
  }
  return {
    fork: onOff(SWITCH_ENV.fork, env[SWITCH_ENV.fork], SWITCH_DEFAULTS.fork),
    forkBase: forkBase as Switches["forkBase"],
    fine: onOff(SWITCH_ENV.fine, env[SWITCH_ENV.fine], SWITCH_DEFAULTS.fine),
    steer: onOff(SWITCH_ENV.steer, env[SWITCH_ENV.steer], SWITCH_DEFAULTS.steer),
    step: step as StepMode,
    refCheck: onOff(SWITCH_ENV.refCheck, env[SWITCH_ENV.refCheck], SWITCH_DEFAULTS.refCheck),
    reuseSession: onOff(SWITCH_ENV.reuseSession, env[SWITCH_ENV.reuseSession], SWITCH_DEFAULTS.reuseSession),
    stuck: onOff(SWITCH_ENV.stuck, env[SWITCH_ENV.stuck], SWITCH_DEFAULTS.stuck),
    taskContext: taskContext as TaskContextMode,
    ask: onOff(SWITCH_ENV.ask, env[SWITCH_ENV.ask], SWITCH_DEFAULTS.ask),
    model: parseModelPolicy(env[SWITCH_ENV.model], env[SWITCH_ENV.modelFallback]),
    modelFailbackScope: modelFailbackScope as FailbackScope,
    retryWaits: waitList(SWITCH_ENV.retryWaits, env[SWITCH_ENV.retryWaits], SWITCH_DEFAULTS.retryWaits),
    recoveryWait: minutes(SWITCH_ENV.recoveryWait, env[SWITCH_ENV.recoveryWait], SWITCH_DEFAULTS.recoveryWait),
    strictResume: onOff(SWITCH_ENV.strictResume, env[SWITCH_ENV.strictResume], SWITCH_DEFAULTS.strictResume),
    handoverConcurrent: onOff(SWITCH_ENV.handoverConcurrent, env[SWITCH_ENV.handoverConcurrent], SWITCH_DEFAULTS.handoverConcurrent),
    hibernate: parseHibernate(env[SWITCH_ENV.hibernate]),
    agent,
  }
}

// 阶梯的规范写法(日志与默认值比较同一来源): 空表渲染为 off。
function formatWaits(waits: number[]): string {
  return waits.length ? waits.join(",") : "off"
}

// 非默认生效项(启动日志): `名=值` 逗号清单,默认组合返回 undefined(静默)。
export function nonDefaultSwitches(switches: Switches): string | undefined {
  const items = [
    switches.fork === SWITCH_DEFAULTS.fork ? undefined : `${SWITCH_ENV.fork}=${switches.fork ? "on" : "off"}`,
    switches.forkBase === SWITCH_DEFAULTS.forkBase ? undefined : `${SWITCH_ENV.forkBase}=${switches.forkBase}`,
    switches.fine === SWITCH_DEFAULTS.fine ? undefined : `${SWITCH_ENV.fine}=${switches.fine ? "on" : "off"}`,
    switches.steer === SWITCH_DEFAULTS.steer ? undefined : `${SWITCH_ENV.steer}=${switches.steer ? "on" : "off"}`,
    switches.step === SWITCH_DEFAULTS.step ? undefined : `${SWITCH_ENV.step}=${switches.step}`,
    switches.refCheck === SWITCH_DEFAULTS.refCheck ? undefined : `${SWITCH_ENV.refCheck}=${switches.refCheck ? "on" : "off"}`,
    switches.reuseSession === SWITCH_DEFAULTS.reuseSession ? undefined : `${SWITCH_ENV.reuseSession}=${switches.reuseSession ? "on" : "off"}`,
    switches.stuck === SWITCH_DEFAULTS.stuck ? undefined : `${SWITCH_ENV.stuck}=${switches.stuck ? "on" : "off"}`,
    switches.taskContext === SWITCH_DEFAULTS.taskContext ? undefined : `${SWITCH_ENV.taskContext}=${switches.taskContext}`,
    switches.ask === SWITCH_DEFAULTS.ask ? undefined : `${SWITCH_ENV.ask}=${switches.ask ? "on" : "off"}`,
    (() => {
      const routing = renderModelEnv(switches.model)
      return routing === "" ? undefined : `${SWITCH_ENV.model}=${routing}`
    })(),
    switches.model.fallback.length ? `${SWITCH_ENV.modelFallback}=${switches.model.fallback.join(",")}` : undefined,
    switches.modelFailbackScope === SWITCH_DEFAULTS.modelFailbackScope
      ? undefined
      : `${SWITCH_ENV.modelFailbackScope}=${switches.modelFailbackScope}`,
    formatWaits(switches.retryWaits) === formatWaits(SWITCH_DEFAULTS.retryWaits) ? undefined : `${SWITCH_ENV.retryWaits}=${formatWaits(switches.retryWaits)}`,
    switches.recoveryWait === SWITCH_DEFAULTS.recoveryWait ? undefined : `${SWITCH_ENV.recoveryWait}=${switches.recoveryWait}`,
    switches.strictResume === SWITCH_DEFAULTS.strictResume ? undefined : `${SWITCH_ENV.strictResume}=${switches.strictResume ? "on" : "off"}`,
    switches.handoverConcurrent === SWITCH_DEFAULTS.handoverConcurrent
      ? undefined
      : `${SWITCH_ENV.handoverConcurrent}=${switches.handoverConcurrent ? "on" : "off"}`,
    switches.hibernate === undefined ? undefined : `${SWITCH_ENV.hibernate}=${formatHibernate(switches.hibernate)}`,
    switches.agent === SWITCH_DEFAULTS.agent ? undefined : `${SWITCH_ENV.agent}=${switches.agent}`,
  ].filter((item): item is string => item !== undefined)
  return items.length ? items.join(", ") : undefined
}

// 全量开关描述(verbose 日志;与非默认项清单同一 `名=值` 形态)。
export function formatSwitches(switches: Switches): string {
  return [
    `${SWITCH_ENV.fork}=${switches.fork ? "on" : "off"}`,
    `${SWITCH_ENV.forkBase}=${switches.forkBase}`,
    `${SWITCH_ENV.fine}=${switches.fine ? "on" : "off"}`,
    `${SWITCH_ENV.steer}=${switches.steer ? "on" : "off"}`,
    `${SWITCH_ENV.step}=${switches.step}`,
    `${SWITCH_ENV.refCheck}=${switches.refCheck ? "on" : "off"}`,
    `${SWITCH_ENV.reuseSession}=${switches.reuseSession ? "on" : "off"}`,
    `${SWITCH_ENV.stuck}=${switches.stuck ? "on" : "off"}`,
    `${SWITCH_ENV.taskContext}=${switches.taskContext}`,
    `${SWITCH_ENV.ask}=${switches.ask ? "on" : "off"}`,
    `${SWITCH_ENV.model}=${renderModelEnv(switches.model)}`,
    `${SWITCH_ENV.modelFallback}=${switches.model.fallback.join(",")}`,
    `${SWITCH_ENV.modelFailbackScope}=${switches.modelFailbackScope}`,
    `${SWITCH_ENV.retryWaits}=${formatWaits(switches.retryWaits)}`,
    `${SWITCH_ENV.recoveryWait}=${switches.recoveryWait}`,
    `${SWITCH_ENV.strictResume}=${switches.strictResume ? "on" : "off"}`,
    `${SWITCH_ENV.handoverConcurrent}=${switches.handoverConcurrent ? "on" : "off"}`,
    `${SWITCH_ENV.hibernate}=${formatHibernate(switches.hibernate)}`,
    `${SWITCH_ENV.agent}=${switches.agent}`,
  ].join(", ")
}

let memo: Switches | undefined

// 运行期开关访问(memo 一次,全流水线一致): 首次调用解析 process.env——非法值
// 抛出,由调用链最外层(CLI)转退出码 1;并在启动日志列出非默认生效项(默认
// 组合静默,verbose 可查全量)。此后恒定返回同一对象。
export function autoSwitches(): Switches {
  if (memo) return memo
  memo = parseSwitches(process.env)
  const changed = nonDefaultSwitches(memo)
  if (changed) log(`⚙ experimental switches (OPENCODE_AUTO_* env vars, this run only): ${changed}`)
  vlog(`⚙ experimental switches (full): ${formatSwitches(memo)}`)
  return memo
}

// Capability degradation (MA.4, src/capability.ts): the run start forces off
// the switches whose "on" side the agent cannot serve. Mutates the memoized
// object in place, so every holder of autoSwitches() sees the values in force;
// like the switches themselves, nothing is persisted.
export function clampSwitches(patch: Partial<Switches>): void {
  Object.assign(autoSwitches(), patch)
}
