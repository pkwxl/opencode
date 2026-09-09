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
} as const

// 步进模式(OPENCODE_AUTO_STEP)值域: off 不暂停;phase/task/subtask 为包含式
// 粒度——所取值及更粗的边界都暂停(见 src/step.ts)。
export type StepMode = "off" | "phase" | "task" | "subtask"

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
}

const SWITCH_DEFAULTS: Switches = { fork: true, forkBase: "digest", fine: true, steer: false, step: "off", refCheck: false, reuseSession: false, stuck: true }

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
  return {
    fork: onOff(SWITCH_ENV.fork, env[SWITCH_ENV.fork], SWITCH_DEFAULTS.fork),
    forkBase: forkBase as Switches["forkBase"],
    fine: onOff(SWITCH_ENV.fine, env[SWITCH_ENV.fine], SWITCH_DEFAULTS.fine),
    steer: onOff(SWITCH_ENV.steer, env[SWITCH_ENV.steer], SWITCH_DEFAULTS.steer),
    step: step as StepMode,
    refCheck: onOff(SWITCH_ENV.refCheck, env[SWITCH_ENV.refCheck], SWITCH_DEFAULTS.refCheck),
    reuseSession: onOff(SWITCH_ENV.reuseSession, env[SWITCH_ENV.reuseSession], SWITCH_DEFAULTS.reuseSession),
    stuck: onOff(SWITCH_ENV.stuck, env[SWITCH_ENV.stuck], SWITCH_DEFAULTS.stuck),
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
