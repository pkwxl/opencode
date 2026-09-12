// OPENCODE_AUTO_* 实验开关注册表——环境变量层(fork 系开关设计文档
// docs/fork-decompose-design.md §4.6,步进开关 docs/step-mode-design.md):
// 实验期全部开关经 OPENCODE_AUTO_* 环境变量注入、核心内一次解析(memo)、全流水线
// 一致,CLI 壳零改动(命名沿 OPENCODE_AUTO_SERVER 先例,src/server.ts)。不落盘:
// 实验语义 = 本次运行,区别于宪法键的 init 固化,同一次运行内开关恒定;宪法键
// 转正(实验定型后)另议。空串视同未设;非法值 throw 中文报错(含变量名与期望
// 值域),经 runner 入口(runTask)抛出、CLI 侧转退出码 1——与配置「坏文件严格
// 失败」哲学一致。
import { log, vlog } from "./log"

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
} as const

// 步进模式(OPENCODE_AUTO_STEP)值域: off 不暂停;phase/task/subtask 为包含式
// 粒度——所取值及更粗的边界都暂停(见 src/step.ts)。
export type StepMode = "off" | "phase" | "task" | "subtask"

// 理解摘要行数档位(OPENCODE_AUTO_TASK_CONTEXT)值域: off 为现状(建议 200 行
// 以内);small/medium/large 逐档放宽(300/400/500 行,见 src/prompt.ts 的
// TASK_CONTEXT_LINES)——仅调整提示词里的"建议行数"措辞,不做代码侧截断或校验
// (context.md 本就无硬性行数限制,超出建议行数不会被拒收)。
export type TaskContextMode = "off" | "small" | "medium" | "large"

// 会话角色词表(阶段化模型路由,见 docs/model-routing-design.md C.1):实验期固定、
// 不做自由命名;与 B.5 执行链角色一一对应,`bypass` 为未显式给 role 的旁路会话兜底。
// 导出为共享真源,后续 P2(resolveModel / roleOf)与旁路改造复用同一份。
export const MODEL_ROLES = [
  "understand",
  "decompose",
  "whole",
  "subtask",
  "wrapup",
  "verify-generate",
  "verify-exec",
  "verify-judge",
  "verify-fix",
  "review-audit",
  "review-planfix",
  "review-fixrun",
  "phase-plan",
  "phase-handover",
  "final-plan",
  "knowledge",
  "prior-knowledge",
  "implement-scan",
  "number-recovery",
  "bypass",
] as const
export type ModelRole = (typeof MODEL_ROLES)[number]

// 阶段字母键(OPENCODE_AUTO_MODEL 条目表的字母键值域,见 runner 的 opts.phase)。
const MODEL_LETTERS = ["a", "d", "m", "t", "v", "k"] as const
export type ModelLetter = (typeof MODEL_LETTERS)[number]

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
  // context.md 摘要为输入新建基点会话(前缀瘦、可从磁盘确定性重建)。
  forkBase: "session" | "digest"
  // 细粒度分解: decompose-<phase> 模板注入细粒度准则段(仍受下限保护约束)。
  fine: boolean
  // 超限交接 steer(2×cap): off = 停用会话中交接注入与会话后的交接判定
  // (自然完成即收;--handover-test 的测试交接是独立机制,不受影响)。
  steer: boolean
  // 步进模式: phase/task/subtask 在对应(及更粗)边界硬暂停等回车放行。
  step: StepMode
  // refcheck 总开关(refcheck-scope-design D3,缺省 off): off 时三层挂点
  // (提交前 auto-correct、check 引用扫描、verify 门禁预扫)全部空转,目标目录
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
  // 提问策略(缺省 off,现状零变化;设计文档 docs/auto-resolve-design.md §E):
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
}

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
}

// OPENCODE_AUTO_MODEL / _FALLBACK 归一化为 ModelPolicy(纯函数,供单测)。两形态:
// 裸值 prov/model 等价全量覆盖(*=prov/model);条目表 `键=prov/model` 逗号分隔,键 ∈
// {* ∪ 阶段字母 ∪ 角色词表},条目内分隔符用 = 而非 :(model id 可能含冒号)。值必须
// 含 /;空串视同未设。坏值严格失败: throw 中文报错(含变量名、示例、越界键/坏值)。
function parseModelPolicy(rawModel: string | undefined, rawFallback: string | undefined): ModelPolicy {
  const policy: ModelPolicy = { byLetter: {}, byRole: {}, fallback: [] }
  const modelExample = "*=kimi/k2,m=anthropic/c-4,verify-judge=kimi/k2-lite"
  const modelRaw = rawModel === undefined || rawModel === "" ? undefined : rawModel
  if (modelRaw !== undefined) {
    if (modelRaw.includes("=")) {
      // 条目表形态:逐条 key=value。
      for (const entry of modelRaw.split(",")) {
        const idx = entry.indexOf("=")
        if (idx < 0) {
          throw new Error(
            `环境变量 ${SWITCH_ENV.model} 条目非法: "${entry}"(条目表形态每项须为 键=prov/model;示例 ${modelExample})`,
          )
        }
        const key = entry.slice(0, idx)
        const value = entry.slice(idx + 1)
        if (!value.includes("/")) {
          throw new Error(
            `环境变量 ${SWITCH_ENV.model} 取值非法: "${value}"(键 "${key}" 的模型须为 provider/model 形态含斜杠;示例 ${modelExample})`,
          )
        }
        if (key === "*") policy.wildcard = value
        else if ((MODEL_LETTERS as readonly string[]).includes(key)) policy.byLetter[key as ModelLetter] = value
        else if ((MODEL_ROLES as readonly string[]).includes(key)) policy.byRole[key as ModelRole] = value
        else {
          throw new Error(
            `环境变量 ${SWITCH_ENV.model} 键非法: "${key}"(期望 *、阶段字母 ${MODEL_LETTERS.join("|")} 或角色词表 ${MODEL_ROLES.join("|")};示例 ${modelExample})`,
          )
        }
      }
    } else {
      // 裸值形态:全量覆盖。
      if (!modelRaw.includes("/")) {
        throw new Error(
          `环境变量 ${SWITCH_ENV.model} 取值非法: "${modelRaw}"(裸值须为 provider/model 形态含斜杠,或改用条目表 键=prov/model;示例 ${modelExample})`,
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
          `环境变量 ${SWITCH_ENV.modelFallback} 取值非法: "${item}"(候选须为 provider/model 形态、逗号分隔有序表;示例 prov/a,prov/b)`,
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

// 解析(纯函数,供单测): env 传 process.env 或测试构造的记录;值为空串视同未设
// (取缺省),非法值 throw 中文报错。
export function parseSwitches(env: Record<string, string | undefined>): Switches {
  const onOff = (name: string, raw: string | undefined, fallback: boolean): boolean => {
    const value = raw === undefined || raw === "" ? (fallback ? "on" : "off") : raw
    if (value !== "on" && value !== "off") {
      throw new Error(`环境变量 ${name} 取值非法: "${raw}"(期望 on|off;空串视同未设,缺省 ${fallback ? "on" : "off"})`)
    }
    return value === "on"
  }
  const forkBaseRaw = env[SWITCH_ENV.forkBase]
  const forkBase = forkBaseRaw === undefined || forkBaseRaw === "" ? SWITCH_DEFAULTS.forkBase : forkBaseRaw
  if (forkBase !== "session" && forkBase !== "digest") {
    throw new Error(`环境变量 ${SWITCH_ENV.forkBase} 取值非法: "${forkBaseRaw}"(期望 session|digest;空串视同未设,缺省 digest)`)
  }
  const stepRaw = env[SWITCH_ENV.step]
  const step = stepRaw === undefined || stepRaw === "" ? SWITCH_DEFAULTS.step : stepRaw
  if (step !== "off" && step !== "phase" && step !== "task" && step !== "subtask") {
    throw new Error(
      `环境变量 ${SWITCH_ENV.step} 取值非法: "${stepRaw}"(期望 off|phase|task|subtask;空串视同未设,缺省 off)`,
    )
  }
  const taskContextRaw = env[SWITCH_ENV.taskContext]
  const taskContext = taskContextRaw === undefined || taskContextRaw === "" ? SWITCH_DEFAULTS.taskContext : taskContextRaw
  if (taskContext !== "off" && taskContext !== "small" && taskContext !== "medium" && taskContext !== "large") {
    throw new Error(
      `环境变量 ${SWITCH_ENV.taskContext} 取值非法: "${taskContextRaw}"(期望 off|small|medium|large;空串视同未设,缺省 off)`,
    )
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
  }
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
  if (changed) log(`⚙ 实验开关(OPENCODE_AUTO_* 环境变量,仅本次运行生效): ${changed}`)
  vlog(`⚙ 实验开关全量: ${formatSwitches(memo)}`)
  return memo
}
