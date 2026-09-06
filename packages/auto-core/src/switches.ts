// fork 分解实验开关——环境变量层(设计文档 docs/fork-decompose-design.md §4.6):
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
} as const

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
}

const SWITCH_DEFAULTS: Switches = { fork: true, forkBase: "session", fine: false, steer: true }

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
    throw new Error(`环境变量 ${SWITCH_ENV.forkBase} 取值非法: "${forkBaseRaw}"(期望 session|digest;空串视同未设,缺省 session)`)
  }
  return {
    fork: onOff(SWITCH_ENV.fork, env[SWITCH_ENV.fork], SWITCH_DEFAULTS.fork),
    forkBase: forkBase as Switches["forkBase"],
    fine: onOff(SWITCH_ENV.fine, env[SWITCH_ENV.fine], SWITCH_DEFAULTS.fine),
    steer: onOff(SWITCH_ENV.steer, env[SWITCH_ENV.steer], SWITCH_DEFAULTS.steer),
  }
}

// 非默认生效项(启动日志): `名=值` 逗号清单,默认组合返回 undefined(静默)。
export function nonDefaultSwitches(switches: Switches): string | undefined {
  const items = [
    switches.fork === SWITCH_DEFAULTS.fork ? undefined : `${SWITCH_ENV.fork}=${switches.fork ? "on" : "off"}`,
    switches.forkBase === SWITCH_DEFAULTS.forkBase ? undefined : `${SWITCH_ENV.forkBase}=${switches.forkBase}`,
    switches.fine === SWITCH_DEFAULTS.fine ? undefined : `${SWITCH_ENV.fine}=${switches.fine ? "on" : "off"}`,
    switches.steer === SWITCH_DEFAULTS.steer ? undefined : `${SWITCH_ENV.steer}=${switches.steer ? "on" : "off"}`,
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
