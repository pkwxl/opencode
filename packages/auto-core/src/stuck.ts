// 死循环检测(弱模型自救): 能力较弱的模型常会连续多次以同一方式重复同一个动作
// ——同样的工具、同样的参数、同样的失败,或参数微调但报错一字不差——自己走不
// 出来。driver 观察每个工具调用的终态,识别到这类重复即经 steer 主动向会话注入
// 提示(src/runner.ts 的 watch 挂点,文案在 templates/prompts/stuck-hint.md),
// 让模型换一种思路而不是继续空转。设计见 docs/stuck-loop-design.md。
//
// 判据(两条,均以本会话为范围,不要求"连续"——A,B,A,B,A 这类交替重试同样是
// 死循环,按签名累计即可识别):
//   - error: 同一工具 + 同一报错(参数可不同)累计达 errorRepeat 次;
//   - repeat: 同一工具 + 同一参数 + 完全相同的输出累计达 sameRepeat 次
//     (结果一模一样 = 这次调用没带来任何新信息)。
// 结果有变化(报错不同、输出不同)一律视为有进展,不计入。
//
// 提示后该签名的计数清零(需再次达阈值才会再提示),每会话最多 maxHints 次,
// 提示逐级升级(见模板);检测只发提示,不中止会话——判据再稳妥也可能误判,
// 停机代价远高于一条多余的提示。

// 同一工具 + 同一报错累计达此次数即提示(参数可不同: 弱模型常微调参数后撞上
// 一模一样的报错)。
export const STUCK_ERROR_REPEAT = 3

// 同一工具 + 同一参数 + 完全相同的输出累计达此次数即提示(成功但无新信息的
// 空转,阈值比报错高一档: 重复读同一文件在正常会话里也偶有发生)。
export const STUCK_SAME_REPEAT = 4

// 每会话最多注入的提示条数,达上限后静默(继续检测但不再打扰)。
export const STUCK_MAX_HINTS = 3

// 观察到的工具调用终态(由 runner 从 SDK 的 ToolPart 摘取,detector 不依赖 SDK 类型)。
export type StuckCall = {
  tool: string
  // 工具入参(对象,签名按键名排序后序列化;缺省视为空参)。
  input?: unknown
  status: "completed" | "error"
  // status=error 时为报错文本,completed 时为输出文本。
  result: string
}

// 命中详情(交给 renderStuckHint 组装提示词): kind=error 为同报错重复,
// repeat 为同参同果重复;count 为触发时的累计次数,level 为本会话第几次提示。
export type StuckHit = {
  kind: "error" | "repeat"
  tool: string
  count: number
  level: number
  // 参数与结果的摘要(截断后的展示文本,注入提示词让模型知道说的是哪一次调用)。
  input: string
  detail: string
}

export type StuckTracker = {
  observe(call: StuckCall): StuckHit | undefined
}

// 阈值可注入(单测用;缺省即上面三个常量)。
export type StuckOptions = {
  errorRepeat?: number
  sameRepeat?: number
  maxHints?: number
}

// 会话级检测器: 每个会话一个实例(状态即本会话的调用历史,不跨会话累计)。
export function createStuckTracker(options: StuckOptions = {}): StuckTracker {
  const errorRepeat = options.errorRepeat ?? STUCK_ERROR_REPEAT
  const sameRepeat = options.sameRepeat ?? STUCK_SAME_REPEAT
  const maxHints = options.maxHints ?? STUCK_MAX_HINTS
  const counts = new Map<string, number>()
  let hints = 0
  return {
    observe(call: StuckCall): StuckHit | undefined {
      const error = call.status === "error"
      // 报错判据不含参数(参数微调仍算同一个坑),同参同果判据含参数与输出。
      const input = call.input === undefined || call.input === null ? "" : stableJson(call.input)
      const key = error
        ? `e|${call.tool}|${hash(normalize(call.result))}`
        : `r|${call.tool}|${hash(input)}|${hash(normalize(call.result))}`
      const count = (counts.get(key) ?? 0) + 1
      counts.set(key, count)
      if (count < (error ? errorRepeat : sameRepeat)) return undefined
      // 计数清零: 提示后重新起算,同一个坑再犯满一轮才会再提示。
      counts.set(key, 0)
      if (hints >= maxHints) return undefined
      hints += 1
      return {
        kind: error ? "error" : "repeat",
        tool: call.tool,
        count,
        level: hints,
        input: summarize(input, 300),
        detail: summarize(call.result, 800),
      }
    },
  }
}

// 签名归一化: 空白折叠 + 小写,消除排版差异导致的"看起来不同"。
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase()
}

// 入参的确定性序列化(键名排序,与书写顺序无关);非对象原样 JSON,不可序列化
// 的值回落其 String 形态。
function stableJson(value: unknown): string {
  const seen = new Set<unknown>()
  const walk = (node: unknown): unknown => {
    if (node === null || typeof node !== "object") return node
    if (seen.has(node)) return "[circular]"
    seen.add(node)
    if (Array.isArray(node)) return node.map(walk)
    const record = node as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const name of Object.keys(record).sort()) sorted[name] = walk(record[name])
    return sorted
  }
  try {
    return JSON.stringify(walk(value)) ?? String(value)
  } catch {
    return String(value)
  }
}

// 展示用摘要: 首尾去空白 + 超长截断(注入提示词,只为让模型认出是哪一次调用)。
function summarize(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}…(已截断)` : trimmed
}

// FNV-1a 32 位: 只用于把长文本压成短签名键,不做安全用途。
function hash(text: string): string {
  let value = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i)
    value = Math.imul(value, 0x01000193)
  }
  return (value >>> 0).toString(16)
}
