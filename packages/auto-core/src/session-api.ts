// 会话 SDK 薄封装(分叉/用量/存活/改名)+ 终端输出格式化 + 人工问答等待。
// 本层只与 opencode 服务端的会话接口及输出呈现打交道,不含任何会话驱动逻辑
// (下发/重试/降级/订阅都在 session.ts 与 watch.ts),故位于依赖图底层,
// 可被 watch/session/runner 各层自由调用;**不得反向 import 会话驱动层**。
// 拆分自 src/runner.ts(docs/module-split-plan.md S5,纯搬运)。

import { createInterface } from "node:readline/promises"
import { join } from "node:path"
import type { OpencodeClient, Part } from "@opencode-ai/sdk/v2"
import type { ForkBaseInfo, SessionChain } from "./chain"
import { commitTitle } from "./git"
import type { Interactive } from "./interactive"
import { log, vlog } from "./log"
import { DEFAULT_CONTEXT_LIMIT, type Opts } from "./opts"
import { shellProfile } from "./shell"
import { statsWaitBegin, statsWaitEnd, type Usage } from "./stats"

// 封装 client.session.fork(fork-decompose 设计 §4.3;client 可注入 fake 单测):
// 在基点末端复制消息前缀为新会话并改名为本阶段短标签标题。{error} 或任何异常
// (外部旧版 --server 无此路由、基点被存储清理等)都属预期回退场景——log 后
// 返回 undefined,调用方走全新会话 + 冷启动,不是错误。
export async function forkSession(client: OpencodeClient, base: string, title: string, messageID?: string): Promise<string | undefined> {
  try {
    // messageID 为分叉锚点: 服务端复制该消息**之前**的全部消息(缺省复制整条会话)。
    const forked = await client.session.fork({ sessionID: base, ...(messageID ? { messageID } : {}) })
    if (forked.error) {
      log(`↻ fork 失败(${JSON.stringify(forked.error)}),回退全新会话`)
      return undefined
    }
    const id = forked.data.id
    // 分叉会话默认标题形如 "... (fork #N)";改名为本阶段提交标题,与 git 历史、
    // 任务进度对齐(改名失败仅记明细)。
    const renamed = await client.session.update({ sessionID: id, title: commitTitle(title) }).catch(() => undefined)
    if (renamed?.error) vlog(`fork 会话改名失败: ${JSON.stringify(renamed.error)}`)
    return id
  } catch (error) {
    log(`↻ fork 失败(${error instanceof Error ? error.message : String(error)}),回退全新会话`)
    return undefined
  }
}

// 阶段/子任务首个会话的 fork 播种(fork-decompose 设计 §4.3/§4.4): 有基点即
// 「先 fork 后渲染」——成功 → chain.pending = 分叉会话、种子链 { pct: 100,
// used: 基点用量, at: 0, forkBase }(pct:100 强制首次不复用,fork 优先;跨子任务
// 不复用、每项重新从基点分叉);fork 失败 → 重置链走全新会话 + 冷启动提示词;
// 基点用量达 cap/2 → 不起 fork、直接冷启动(防前缀逼近上限)。中断恢复复用
// 中断会话(链上仍有会话且恢复说明待注入)时不分叉,首个提示词进复用会话。
// 返回 warm(= 本会话已继承任务背景)供提示词选择背景段;无基点(fork=off/
// 从未确立)不动链,行为与现状完全一致。
export async function seedForkSession(
  client: OpencodeClient,
  opts: Opts,
  chain: SessionChain,
  base: ForkBaseInfo | undefined,
  subject: string,
): Promise<boolean> {
  if (!base) return false
  // 恢复续跑优先于分叉: 中断会话仍在链上且恢复说明(note)待注入 → 复用之。
  if (chain.id !== undefined && chain.note !== undefined) return true
  const cap = opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT
  if (base.used >= cap / 2) {
    log(`↻ 基点用量 ${formatTokens(base.used)} 达到 ${formatTokens(cap / 2)} 上限,不起分叉(冷启动)`)
    chain.id = undefined
    chain.pending = undefined
    chain.pct = 100
    chain.used = 0
    chain.at = 0
    return false
  }
  // 新会话前同步 AGENTS.md(与 create 路径同款;分叉会话的 system context 继承
  // 自基点,基点前缀与最新契约的一致性在此保证)。
  await opts.server?.syncAgents()
  const forked = await forkSession(client, base.id, subject)
  chain.id = undefined
  chain.pending = forked
  chain.forkBase = base.id
  chain.pct = 100
  chain.used = forked ? base.used : 0
  chain.at = 0
  if (forked) log(`⑂ 从基点 ${base.id} 分叉新会话(前缀 ${formatTokens(base.used)} tokens)`)
  return forked !== undefined
}

// 会话末端上下文用量(tokens: input + cache.read)与占比重建: 经
// client.session.messages **从末条往前**取第一条真正跑完过的 assistant 消息(不是
// 字面末条,原因见 basis 注释),上限查 provider 表(与 watch 同口径: 取不到上限记
// pct=100)。用于 fork 基点用量与中断恢复接管会话的用量继承。导出仅供单测直接驱动
// 判据(与 ensureForkBase 同款,恢复决策本身落在 runTask,完整流水线由壳包 e2e 覆盖)。
export async function sessionUsage(client: OpencodeClient, id: string): Promise<{ used: number; pct: number; limit?: number; errorStub: boolean }> {
  const got = await client.session.messages({ sessionID: id }).catch(() => undefined)
  const data = got && !got.error ? got.data : undefined
  if (!data) return { used: 0, pct: 100, errorStub: false }
  const last = data.findLast((message) => message.info.role === "assistant")
  if (!last || last.info.role !== "assistant") return { used: 0, pct: 100, errorStub: false }
  // 用量基准 = 从末条往前第一条"真正跑完过"的 assistant 消息(tokens 非 0)。provider
  // 报错时服务端会追加一条 tokens 全 0 的 assistant 行(prompt.ts 先建行、processor
  // .halt() 只写 error,step-finish 从未发生),被中断的轮次同样留下 0 tokens 的残行;
  // 直接取末条会把"累积了十万级上下文、最后一轮撞限流"的会话读成 0 用量。基准不排除
  // error 行:step-finish 之后才判定的错误(输出超限、内容过滤等)带真实 tokens,正是
  // 末端用量的最佳估计。
  const basis = data.findLast(
    (message) => message.info.role === "assistant" && message.info.tokens.input + message.info.tokens.cache.read > 0,
  )
  if (!basis || basis.info.role !== "assistant") {
    // 整条会话从未有过真实产出:末条本身就是报错桩,即 session-error-retry-plan.md
    // 第 5 点要兜底的历史遗留形态(旧版"重试即换白板会话"留下的空会话)。
    return { used: 0, pct: 100, errorStub: last.info.error !== undefined }
  }
  const used = basis.info.tokens.input + basis.info.tokens.cache.read
  const limit = (await contextLimits(client)).get(`${basis.info.providerID}/${basis.info.modelID}`)
  return { used, pct: limit ? Math.round((used / limit) * 100) : 100, limit, errorStub: false }
}

// 基点会话末端上下文用量(tokens);取不到按 0。
export async function sessionUsed(client: OpencodeClient, id: string): Promise<number> {
  return (await sessionUsage(client, id)).used
}

// statsSessionEnd 兜底用零用量(下发失败/异常路径无 usage 可记,不虚构消耗)。
export function zeroUsage(): Usage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 }
}

// 会话进度改名: 会话标题与提交标题共用同一短标签方案(`T-NNN <label> <标题/子任务>`,
// label ∈ decompose/S<n>/exec/wrapup/fix<n>/judge/script/review/final/planfix/pending/
// blocked/done 等),会话结束与任务终态时把链上会话改名为最新标签,标题前缀即任务
// 进度;改名失败仅记录明细,不影响流程。
export async function renameSession(client: OpencodeClient, chain: SessionChain, subject: string): Promise<void> {
  chain.subject = subject
  if (!chain.id) return
  const renamed = await client.session.update({ sessionID: chain.id, title: commitTitle(subject) }).catch(() => undefined)
  if (renamed?.error) vlog(`会话改名失败: ${JSON.stringify(renamed.error)}`)
}

// 记忆会话是否仍存在于 server 上(opencode 会话持久化在项目存储,server 重启
// 不丢;拉取失败或不存在则视为不可复用)。
export async function sessionAlive(client: OpencodeClient, id: string): Promise<boolean> {
  const got = await client.session.get({ sessionID: id }).catch(() => undefined)
  return got !== undefined && !got.error
}

// 下发任务失败的常见根因: 目标目录缺少 agent 契约文件时服务端只回
// UnknownError(错误体不含根因),此处检测并按外壳画像提示恢复方式(见 src/shell.ts)。
export async function missingAgentHint(opts: Opts): Promise<string> {
  if (!opts.dir) return ""
  const file = `.opencode/agent/${opts.agent ?? "auto"}.md`
  const exists = await Bun.file(join(opts.dir, file)).exists()
  if (exists) return ""
  const { program, bin, agentRecovery } = shellProfile()
  const recovery =
    agentRecovery === "startup"
      ? `重新运行 ${program} 恢复(启动时按模板重建默认契约)后重跑`
      : `运行 ${bin} init ${opts.dir} 恢复后重跑`
  return `\n提示: 目标目录缺少 agent 契约文件 ${file},服务端会因此以 UnknownError 拒绝下发任务;${recovery}`
}

// 把非文本 part 转成一行可读输出(始终经 vlog 交给 log 层决定去留: --verbose 上
// 终端并记录,外壳画像 auditLog 时写入日志文件);返回 undefined 表示该 part 尚无
// 终态内容可输出(后续更新事件会再触发)。工具输出与推理原文较长,
// 截断到与 verify 输出相同的 2000 字符上限。
export function describePart(part: Part): string | undefined {
  if (part.type === "reasoning") return part.time.end ? `  推理:\n${part.text.trim().slice(0, 2000)}` : undefined
  if (part.type === "tool") {
    if (part.state.status === "completed") return `  工具 ${part.tool}: ${part.state.title || "完成"}`
    if (part.state.status === "error") return `  工具 ${part.tool} 出错: ${part.state.error.slice(0, 2000)}`
    return undefined
  }
  if (part.type === "step-finish") return `  步骤结束(${part.reason}): 输入 ${formatTokens(part.tokens.input)} / 输出 ${formatTokens(part.tokens.output)} tokens`
  if (part.type === "step-start") return `  步骤开始`
  if (part.type === "file") return `  文件: ${part.filename ?? part.url}`
  if (part.type === "subtask") return `  子任务(${part.agent}): ${part.description}`
  if (part.type === "agent") return `  子代理: ${part.name}`
  if (part.type === "patch") return `  补丁(${part.files.length} 个文件): ${part.files.join(", ")}`
  if (part.type === "snapshot") return `  快照: ${part.snapshot}`
  if (part.type === "retry") return `  ↻ 请求重试(第 ${part.attempt} 次)`
  if (part.type === "compaction") return `  上下文压缩${part.auto ? "(自动)" : ""}`
  return undefined
}

// 拉取一次 provider 列表,建立 providerID/modelID → 上下文上限的映射;
// 失败时返回空映射,上下文行退化为只显示用量不显示百分比。
export async function contextLimits(client: OpencodeClient): Promise<Map<string, number>> {
  const limits = new Map<string, number>()
  // 整段容错: 请求失败(网络/旧版 server)、错误响应体与客户端不具备该表面
  // (测试替身)都退化为空映射,由调用方按"上限未知"处理。
  try {
    const response = await client.provider.list()
    for (const provider of response?.data?.all ?? []) {
      for (const [id, model] of Object.entries(provider.models)) {
        limits.set(`${provider.id}/${id}`, model.limit.context)
      }
    }
  } catch {}
  return limits
}

export function formatTokens(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

// 客户端错误可读化: fetch 异常(网络断开、请求超时中止等)返回的是 Error 实例,
// JSON.stringify 只得 "{}";取其 message 才能让「请求超时」等字样进入阻塞问题
// 文案,其余(服务端结构化错误体)照旧序列化。
export function formatClientError(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error)
}

// 权限等待中,这些回答(忽略首尾空白与大小写)视为确认授权。
export function isApproval(answer: string): boolean {
  return /^(allow|yes|y|ok|approve|always|允许|授权|是)$/.test(answer.trim().toLowerCase())
}

// Waits up to `minutes` for a human answer on stdin (Enter confirms); returns
// undefined on timeout or empty input, in which case the caller falls back to
// autoAnswer() (questions) or the --permission fallback (permission requests).
// --interactive 下改由常驻输入行接收回答(提示语、超时与回落语义不变)。
// dir 传入时等待区间(含 interactive.question 路径)经 statsWaitBegin/End 从会话
// 用时与 AI 用时中同步扣除、单记 waitMs(STATS_PLAN §2/§3: AI 段关-开);导出供
// 单测直驱(对齐 runSession 等内部接线测试)。
export async function askHuman(
  minutes: number,
  hint: string,
  interactive?: Interactive,
  dir?: string,
): Promise<string | undefined> {
  const promptText = `请在 ${minutes} 分钟内输入回答(回车确认,${hint}): `
  await statsWaitBegin(dir, "askHuman")
  try {
    if (interactive) return (await interactive.question(promptText, minutes)) || undefined
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    // raw 模式下 ^C 不会触发进程级 SIGINT,readline 会截获;转发给进程级
    // 处理器,使等待人工答复期间连续两次 Ctrl+C 同样能强制终止。
    rl.on("SIGINT", () => process.kill(process.pid, "SIGINT"))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const answer = await Promise.race([
        rl.question(promptText),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), minutes * 60_000)
        }),
      ])
      return answer?.trim() || undefined
    } finally {
      clearTimeout(timer)
      rl.close()
    }
  } finally {
    await statsWaitEnd(dir)
  }
}
