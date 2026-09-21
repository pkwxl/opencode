// Session helpers over the AgentClient (fork/usage/liveness/rename) + terminal
// formatting + waiting for human answers. Since MA.3 (plans/0039) this file
// holds no SDK call: every agent request goes through the AgentClient, and
// the SDK-facing half moved into src/agent/opencode/. It is a driver module
// (it seeds chains, reads opts, logs). It contains no session-driving logic
// (dispatch/retry/failover/subscription live in session.ts and watch.ts), so
// it sits at the bottom of the graph: watch/session/runner may call it freely;
// **it must not import the session-driving layer**.
// Split from src/runner.ts (plans/0024-module-split-plan.md S5).

import { createInterface } from "node:readline/promises"
import { join } from "node:path"
import type { AgentClient, AgentPart } from "./agent/types"
import type { ForkBaseInfo, SessionChain } from "./chain"
import { commitTitle } from "./git"
import type { Interactive } from "./interactive"
import { log, vlog } from "./log"
import { DEFAULT_CONTEXT_LIMIT, type Opts } from "./opts"
import { shellProfile } from "./shell"
import { statsWaitBegin, statsWaitEnd, type Usage } from "./stats"
import { forkBaseAllowed } from "./usage"

// 封装 client.fork(fork-decompose 设计 §4.3;client 可注入 fake 单测):
// 在基点末端复制消息前缀为新会话并改名为本阶段短标签标题。{error} 或任何异常
// (外部旧版 --server 无此路由、基点被存储清理等)都属预期回退场景——log 后
// 返回 undefined,调用方走全新会话 + 冷启动,不是错误。
export async function forkSession(client: AgentClient, base: string, title: string, messageID?: string): Promise<string | undefined> {
  // An agent that cannot fork takes the same fallback as a failed fork (MA.4,
  // plans/0040); the run start already said so once, hence verbose only.
  const { fork } = client.capabilities
  if (fork === "none") {
    vlog(`↻ the agent cannot fork sessions; falling back to a brand-new session`)
    return undefined
  }
  // messageID 为分叉锚点: 服务端复制该消息**之前**的全部消息(缺省复制整条会话)。
  // Without message-level forks the whole session is copied — the pin fork's
  // own fallback when its anchor is gone (exec-session seedPinFork).
  const forked = await client.fork(base, fork === "message" ? messageID : undefined)
  if (!forked.ok) {
    log(`↻ fork failed (${formatClientError(forked.error)}); falling back to a brand-new session`)
    return undefined
  }
  const id = forked.value.id
  // 分叉会话默认标题形如 "... (fork #N)";改名为本阶段提交标题,与 git 历史、
  // 任务进度对齐(改名失败仅记明细)。
  const renamed = await client.rename(id, commitTitle(title))
  if (!renamed.ok) vlog(`fork session rename failed: ${JSON.stringify(renamed.error)}`)
  return id
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
  client: AgentClient,
  opts: Opts,
  chain: SessionChain,
  base: ForkBaseInfo | undefined,
  subject: string,
): Promise<boolean> {
  if (!base) return false
  // 恢复续跑优先于分叉: 中断会话仍在链上且恢复说明(note)待注入 → 复用之。
  if (chain.id !== undefined && chain.note !== undefined) return true
  const cap = opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT
  if (!forkBaseAllowed(base.used, cap)) {
    log(
      base.used === undefined
        ? `↻ base usage unknown; not forking (cold start)`
        : `↻ base usage ${formatTokens(base.used)} reached the ${formatTokens(cap / 2)} cap; not forking (cold start)`,
    )
    chain.id = undefined
    chain.pending = undefined
    chain.pct = 100
    chain.used = 0
    chain.at = 0
    return false
  }
  // 新会话前同步 AGENTS.md(与 create 路径同款;分叉会话的 system context 继承
  // 自基点,基点前缀与最新契约的一致性在此保证)。
  await opts.server?.syncContext()
  const forked = await forkSession(client, base.id, subject)
  chain.id = undefined
  chain.pending = forked
  chain.forkBase = base.id
  chain.pct = 100
  // forkBaseAllowed passed, so the figure is known.
  const used = base.used ?? 0
  chain.used = forked ? used : 0
  chain.at = 0
  if (forked) log(`⑂ forked a new session from base ${base.id} (prefix ${formatTokens(used)} tokens)`)
  return forked !== undefined
}

// 形检/检查未过的「带反馈重提示」的会话播种(session-boundary-hardening 设计
// §4.3/§4.5,2026-09-18 修订): 基于刚结束的会话(链上当前会话)fork 副本下发——
// 副本带着全部工作上下文,一句简短反馈即可接着做,而非开空白会话重发整份提示词
// (重读全场、重做已完成的探查,还丢失「做了一半」的现场,kernel-spi-nor T-030 S13
// 现场)。原会话保持不动、仍是恢复点(与重试阶梯「一律 fork 副本而非直接复用」同
// 一哲学)。链上无会话/会话已失效/fork 失败返回 false,调用方回退全新会话 + 完整
// 提示词。分叉前缀的用量即刚结束会话的用量,链上 pct/used/at 照留(attempt 在回合
// 结束后以实测值刷新)。
export async function forkEndedSession(client: AgentClient, chain: SessionChain, subject: string): Promise<boolean> {
  if (chain.id === undefined || !(await sessionAlive(client, chain.id))) return false
  const forked = await forkSession(client, chain.id, subject)
  if (!forked) return false
  // 与 seedForkSession 同形态: 清 id 让 attempt 消费 pending(reuse 判定要求链上
  // 无会话,且 note + id 非空会命中 resumed 复用分支而忽略 pending)。
  chain.id = undefined
  chain.pending = forked
  return true
}

// 会话末端上下文用量(AgentMessage.contextUsed;opencode = input + cache.read)与占比重建: 经
// client.messages **从末条往前**取第一条真正跑完过的 assistant 消息(不是
// 字面末条,原因见 basis 注释),上限查 provider 表(与 watch 同口径: 取不到上限记
// pct=100)。用于 fork 基点用量与中断恢复接管会话的用量继承。导出仅供单测直接驱动
// 判据(与 ensureForkBase 同款,恢复决策本身落在 runTask,完整流水线由壳包 e2e 覆盖)。
export async function sessionUsage(client: AgentClient, id: string): Promise<{ used: number; pct: number; limit?: number; errorStub: boolean }> {
  // No readable history (MA.4): the same unknown as a failed read — pct 100
  // keeps the session from being reused on its figure.
  if (!client.capabilities.history) return { used: 0, pct: 100, errorStub: false }
  const got = await client.messages(id)
  if (!got.ok) return { used: 0, pct: 100, errorStub: false }
  const data = got.value
  const last = data.findLast((message) => message.role === "assistant")
  if (!last) return { used: 0, pct: 100, errorStub: false }
  // 用量基准 = 从末条往前第一条"真正跑完过"的 assistant 消息(用量非 0)。provider
  // 报错时服务端会追加一条 tokens 全 0 的 assistant 行(prompt.ts 先建行、processor
  // .halt() 只写 error,step-finish 从未发生),被中断的轮次同样留下 0 tokens 的残行;
  // 直接取末条会把"累积了十万级上下文、最后一轮撞限流"的会话读成 0 用量。基准不排除
  // error 行:step-finish 之后才判定的错误(输出超限、内容过滤等)带真实 tokens,正是
  // 末端用量的最佳估计。
  const basis = data.findLast((message) => message.role === "assistant" && (message.contextUsed ?? 0) > 0)
  if (!basis) {
    // 整条会话从未有过真实产出:末条本身就是报错桩,即 plans/0015-session-error-retry-plan.md
    // 第 5 点要兜底的历史遗留形态(旧版"重试即换白板会话"留下的空会话)。
    return { used: 0, pct: 100, errorStub: last.failed }
  }
  const used = basis.contextUsed!
  const limit = basis.model !== undefined ? (await client.contextLimits()).get(basis.model) : undefined
  return { used, pct: limit ? Math.round((used / limit) * 100) : 100, limit, errorStub: false }
}

// 基点会话末端上下文用量(tokens);取不到按 0。Undefined when the agent keeps
// no readable history (MA.4): the fork base guard then treats the base as full
// and starts cold (plans/0038 G1) instead of trusting a made-up 0.
export async function sessionUsed(client: AgentClient, id: string): Promise<number | undefined> {
  if (!client.capabilities.history) return undefined
  return (await sessionUsage(client, id)).used
}

// statsSessionEnd 兜底用零用量(下发失败/异常路径无 usage 可记,不虚构消耗)。
export function zeroUsage(): Usage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 }
}

// 会话进度改名: 会话标题与提交标题共用同一短标签方案(`T-NNN <label> <标题/子任务>`,
// label ∈ decompose/S<n>/exec/wrapup/pending/
// blocked/done 等),会话结束与任务终态时把链上会话改名为最新标签,标题前缀即任务
// 进度;改名失败仅记录明细,不影响流程。
export async function renameSession(client: AgentClient, chain: SessionChain, subject: string): Promise<void> {
  chain.subject = subject
  if (!chain.id) return
  const renamed = await client.rename(chain.id, commitTitle(subject))
  if (!renamed.ok) vlog(`session rename failed: ${JSON.stringify(renamed.error)}`)
}

// 记忆会话是否仍存在于 server 上(opencode 会话持久化在项目存储,server 重启
// 不丢;拉取失败或不存在则视为不可复用)。
// Without resumable sessions (MA.4) no remembered session counts as alive:
// recovery, base reuse and every fork from a stored id start fresh instead.
export async function sessionAlive(client: AgentClient, id: string): Promise<boolean> {
  if (!client.capabilities.resume) return false
  return (await client.get(id)).ok
}

// 失联探针的探测体(plans/0026-session-boundary-hardening-design.md D3/§4.4): 一条独立的
// 短超时连接 GET 会话元信息——半开的旧连接(无 FIN/RST)不响应也不拒绝,但不影响
// 新连接,故新请求的成败即传输层活性的可信信号;超时无响应与请求异常同按未通计。
// 与 sessionAlive 同族,差别只在超时上界与调用场景(在途周期探测 vs 恢复前一次性核对)。
export const PROBE_TIMEOUT_MS = 30_000
export async function probeSession(client: AgentClient, sessionID: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      client.get(sessionID).then((got) => got.ok),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
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
      ? `re-run ${program} to restore (the default contracts are rebuilt from templates at startup), then re-run`
      : `run ${bin} init ${opts.dir} to restore, then re-run`
  return `\nhint: the target directory is missing the agent contract file ${file}; the server rejects task dispatches with UnknownError because of this; ${recovery}`
}

// 把非文本 part 转成一行可读输出(始终经 vlog 交给 log 层决定去留: --verbose 上
// 终端并记录,外壳画像 auditLog 时写入日志文件);返回 undefined 表示该 part 尚无
// 终态内容可输出(后续更新事件会再触发)。工具输出与推理原文较长,
// 截断到 2000 字符上限。display-only pieces arrive as
// notes already rendered by the adapter (0037 D6); the retry line is watch's
// (retry signals are events, not parts).
export function describePart(part: AgentPart): string | undefined {
  if (part.kind === "reasoning") return part.final ? `  reasoning:\n${part.text.trim().slice(0, 2000)}` : undefined
  if (part.kind === "tool") {
    if (part.status === "completed") return `  tool ${part.tool}: ${part.title || "done"}`
    if (part.status === "error") return `  tool ${part.tool} error: ${(part.error ?? "").slice(0, 2000)}`
    return undefined
  }
  if (part.kind === "step-finish") return `  step finish (${part.reason}): input ${formatTokens(part.tokens.input)} / output ${formatTokens(part.tokens.output)} tokens`
  if (part.kind === "step-start") return `  step start`
  if (part.kind === "note") return `  ${part.text}`
  return undefined
}

export function formatTokens(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

// 服务端生效模型(未设模型路由时 ◈ 播报的回落,plans/0017-model-routing-design.md
// D.8 2026-09-18 修订): the resolution chain is the adapter's (AgentClient
// defaultModel; opencode: agent config > config.model > provider default).
// Cached per agent for the process: the configuration does not change during a
// run. undefined when nothing resolves (the caller stays silent).
const serverModelCache = new Map<string, string | undefined>()

export async function serverDefaultModel(client: AgentClient, agent?: string): Promise<string | undefined> {
  const key = agent ?? ""
  if (!serverModelCache.has(key)) serverModelCache.set(key, await client.defaultModel(agent).catch(() => undefined))
  return serverModelCache.get(key)
}

// 单测用: 清进程内缓存(不同测试的替身 client 不应互相串味)。
export function resetServerModelCache(): void {
  serverModelCache.clear()
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
  const promptText = `enter your answer within ${minutes} minutes (Enter to confirm, ${hint}): `
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
