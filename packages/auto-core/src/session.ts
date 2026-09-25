// 会话驱动的核心层: 单个提示词在会话链上的执行(runSession——复用/新建、瞬时
// 错误换新会话重试、网络故障重启 server、配额受限的模型降级环与窗口钳制、
// 一切会话故障的最终归宿「等待-探测环」awaitRecovery),以及 fork 基点的确立
// (ensureForkBase——它驱动一次性基点会话,属会话驱动而非 SDK 薄封装,故与
// runSession 同层,见 plans/0024-module-split-plan.md §I D9)。
// 位于 attempt/watch 之上、runner 之下;**不得反向 import runner**。
// 拆分自 src/runner.ts(plans/0024-module-split-plan.md S8,纯搬运)。

import { dirname, join } from "node:path"
import type { AgentClient } from "./agent/types"
import { resolveModel, roleOf, type ForkBaseInfo, type SessionChain, type SessionResult } from "./chain"
import { attempt } from "./attempt"
import { taskDoc } from "./docpaths"
import { clearModelDownMark, downMarks, failbackOverride, markModelDown, setSticky, stickyModel } from "./failback"
import { log } from "./log"
import { DEFAULT_CONTEXT_LIMIT, type Opts } from "./opts"
import { candidateKey, nowOf, selectContext } from "./routing"
import { select } from "./select"
import { setForkBase, type Plan, type Task } from "./tasks"
import { renderContextBase } from "./prompt"
import { firstLine } from "./resume-gate"
import { forkSession, formatClientError, formatTokens, seedForkSession, sessionAlive, sessionUsed } from "./session-api"
import { autoSwitches, type Switches } from "./switches"
import { statsWaitBegin, statsWaitEnd } from "./stats"
import { type Steer, type TestRun } from "./testrun"

// fork 基点确立(fork-decompose 设计 §4.2,2026-09-18 持久化修订): 返回生效基点,
// undefined = 冷启动。digest 模式基点**一经建立即跨运行持久**——setForkBase 以
// `digest:` 前缀落运行态 .auto/units.json 的 forkBase,此后每次运行(含中断恢复、子任务未竟的
// 重跑)先校验存活,存活即复用同一基点会话继续分叉,不再从 context.md 无条件重建;
// 失效(存储清理)才经一次性链(subject `T-NNN ctxbase …`,不带 phase、不写进度
// 记录;确认 turn 无工作区改动、commitTree 自然零提交)重建——前缀确定性 = 摘要全文,
// provider 缓存友好。基点会话建立后只被 fork、不再下发,前缀恒为摘要全文,复用不
// 引入漂移。回退链: 持久 digest 基点存活复用 → digest 重建 → session 基点(units.json
// 持久字段,校验存活,失效回退冷启动) → 冷启动。session 模式基点跨运行持久,用量
// 经 messages 末条消息重建(近似即可;同次运行且基点即链上会话时直接取跟踪值)。
export async function ensureForkBase(
  client: AgentClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
  switches: Switches = autoSwitches(),
): Promise<ForkBaseInfo | undefined> {
  if (!switches.fork) return undefined
  const dir = opts.dir ?? plan.dir
  // digest 持久基点以 `digest:` 前缀与理解会话 id(session 基点)区分——无前缀值在
  // digest 模式下只是重建失败时的兜底,不参与「存活即复用」。
  const persistID = task.forkBase?.startsWith("digest:") ? task.forkBase.slice("digest:".length) : undefined
  if (switches.forkBase === "digest") {
    if (persistID !== undefined) {
      if (await sessionAlive(client, persistID)) {
        const used = await sessionUsed(client, persistID)
        log(`⑂ ${task.id} digest base reuse: session ${persistID} (${used === undefined ? "usage unknown" : `${formatTokens(used)} tokens`})`)
        return { id: persistID, used }
      }
      log(`↻ ${task.id} persistent digest base ${persistID} is stale; rebuilding from ${taskDoc(task.id, "context")}`)
    }
    const digest = (await Bun.file(join(dir, taskDoc(task.id, "context"))).text().catch(() => "")).trim()
    if (digest) {
      const subject = `${task.id} ctxbase ${task.title}`
      const base: SessionChain = { pct: 100, used: 0, at: 0, subject }
      const result = await runSession(client, task, renderContextBase(task, digest), opts, base)
      if (result.type === "idle" && base.id) {
        await setForkBase(dir, task.id, `digest:${base.id}`)
        log(`⑂ ${task.id} digest base ready: session ${base.id} (digest prefix ${formatTokens(base.used)} tokens)`)
        return { id: base.id, used: base.used }
      }
      log(`↻ ${task.id} digest base session not established${result.type === "blocked" ? ` (${firstLine(result.question)})` : ""}; falling back to the session base`)
    } else {
      log(`↻ ${task.id} ${taskDoc(task.id, "context")} digest missing; digest base cannot be established, falling back to the session base`)
    }
  }
  // session 基点(理解会话): digest 模式下持久基点走到这里必已在上方判死(存活即
  // 复用返回),不重复校验;session 模式遇 digest: 前缀遗留(运行中途切换基点模式)
  // 剥壳校验——存活的 digest 基点同样是有效暖前缀。
  const sessionID = persistID === undefined ? task.forkBase : switches.forkBase === "session" ? persistID : undefined
  if (sessionID) {
    if (await sessionAlive(client, sessionID)) {
      const used = sessionID === chain.id ? chain.used : await sessionUsed(client, sessionID)
      log(`⑂ ${task.id} session base ready: session ${sessionID} (${used === undefined ? "usage unknown" : `${formatTokens(used)} tokens`})`)
      return { id: sessionID, used }
    }
    log(`↻ ${task.id} session base ${sessionID} is stale; falling back to cold start`)
  }
  return undefined
}

// 会话错误中属于网络/服务故障的特征串;命中时先重启 server(外部 server 除外)
// 再换新会话重试,避免对着同一坏实例反复失败。
const NETWORK_FAILURE = /internal network failure|network error|fetch failed|econnrefused|econnreset|socket hang up/i

// Probe prompt of the wait-and-probe loop: a minimal payload that only needs one
// real provider round trip to tell whether service is back. Never probe with the
// interrupted session (a probe turn in a real session pollutes its context, and a
// forked probe burns the full prefix on every wait round, which only makes a
// quota squeeze worse).
const RECOVERY_PROBE_PROMPT = "[DRIVER] Service availability probe: reply with just ok and do nothing else."

// One-off note when the same prompt is re-sent after a retry or recovery
// (carried to the AI with the next prompt via chain.note, cleared once used). Two
// forms, keyed on whether the session taking over carries this attempt's context:
// ① full context (a fork of the failed session itself): the copy ends with the
//    original error message, so a repeated prompt needs a word of explanation or
//    the AI treats the re-send as a repeated request and starts over (same motive
//    as awaitRecovery's note);
// ② partial context (blank new session / re-seeded from the base / a fork of the
//    chain's original session): the attempt's partial output on disk is not in
//    the new session's context, so the AI must check the worktree before going on,
//    or it redoes half-finished work, duplicating appended output and re-running
//    finished steps (same wording as the cross-run resumeNote: check the disk
//    state, do not redo).
const WORKSPACE_CHECK =
  " The worktree may already hold part of this prompt's output: check it with git status / git diff first, then continue the remaining work from there without redoing what is finished."
const retryNote = (lead: string) => `[DRIVER] ${lead}${WORKSPACE_CHECK}`

// Runs one prompt on the session chain (reusing the previous session when its
// context ended below REUSE_BELOW and within REUSE_IDLE_MS). Transient
// provider failures (session.error, e.g. malformed reasoning content from a
// gateway) are retried in a fresh session; network/server failures
// (Internal network failure / Network error 等) additionally restart the
// spawned opencode server before the retry; non-retryable failures (quota
// etc.) and ladder exhaustion fall into the recovery wait-probe loop instead
// of blocking — a session fault never terminates the run.
// 单个提示词在会话链上的执行(复用/新建、错误重试与 server 重启、等待-探测环);
// 导出供旁路会话复用。test 为 --test-by-driver 的协议
// 状态(仅执行类会话经 runExecSession 传入;旁路会话不传,协议不生效);
// switches 缺省取 OPENCODE_AUTO_* 解析值(复用开关),注入供单测。
export async function runSession(
  client: AgentClient,
  task: Task,
  promptText: string,
  opts: Opts,
  chain: SessionChain,
  steer?: Steer,
  test?: TestRun,
  switches: Switches = autoSwitches(),
): Promise<SessionResult> {
  // 配额降级候选跟踪(设计 D.3/D.4):整条会话链共享——每个模型候选各享一轮完整的
  // 重试阶梯(i 在切换候选时重置为 1),总上限 = 候选数 × 阶梯长度,降级计数与
  // 阶梯计数分离、互不掩盖。tried 记录本链已试过的候选串(有序,供耗尽文案与去重
  // 再选);clipped 记录因上下文窗口不足被跳过的候选(供耗尽文案与去重日志);limits
  // 惰性取一次 contextLimits 并缓存(降级判定只读上下文窗口,容错空映射)。
  const cap = opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT
  const tried: string[] = []
  const clipped: string[] = []
  let limits: ReadonlyMap<string, number> | undefined
  // 重试阶梯(OPENCODE_AUTO_RETRY_WAITS,缺省 0,1,2,4,8): waits 的每个元素是该次
  // 重试前的等待分钟数,元素个数即重试次数上限。首次重试立即——瞬时抖动确实会在
  // 下一回合就恢复(DB 里有「尝试 1 静默 300s 被中止、尝试 2 成功」的实例);其后
  // 按分钟级退避。
  //
  // 为什么退避从分钟起步、而不是从秒开始翻倍: 退避本身不是恢复手段。opencode 内层
  // 每次故障已经用掉 6×300s 超时 + 2+4+8+16+30s 退避 ≈ 1860s(实测 1862s),外层再叠
  // 一条秒级曲线只占其中零头,改变不了下一次请求的命运。分钟级等待的唯一意义是
  // 「跨过一段上游退化」;阶梯耗尽后的出路是下方的等待-探测环(2026-09-16 起,
  // 此前为人工裁决)——配额/限流的恢复窗口以小时计,加码次数无济于事,等就是了。
  const waits = switches.retryWaits
  let i = 1
  // 有效降级候选环: /failback 带参重定义过模型序时用其覆写环,否则取 switches 的
  // OPENCODE_AUTO_MODEL_FALLBACK 解析结果(switches memo 恒定,覆写经 failback 模块态
  // 承载)。降级触发门禁与 switchModel 的候选遍历共用同一来源。
  const fallbackRing = () => failbackOverride()?.fallback ?? switches.model.fallback
  // 候选降级的公共动作(两个触发面共用:下面的配额降级支、阶梯耗尽后的回落):
  // 取下一个可用候选,换 chain.model、挂一次性降级 note、fork 副本带上下文随迁,
  // 并把阶梯计数重置为 1(本候选独享一轮完整阶梯)。
  // 切换成功返回 true(调用方 continue);候选耗尽返回 false(调用方落入等待-探测环)。
  // why is a short phrase naming the trigger; it goes into the log and the failover note.
  // Under a model registry (plans/0055 §7 step 2) the current model is marked
  // down and selection picks the next usable candidate of the tier's list,
  // which replaces the global _FALLBACK ring; on this run's single agent the
  // move is today's path unchanged (fork copy, the chain's model, the
  // failover note, the ladder reset). Cross-agent candidates are a later
  // step, and the key-ring half (step 1) too.
  const switchModel = async (why: string): Promise<boolean> => {
    limits ??= await client.contextLimits()
    let from: string | undefined
    let to: string | undefined
    let toModel: string | undefined
    let ringSize = 0
    if (opts.routing) {
      from = chain.modelEntry
      if (from !== undefined) markModelDown(from)
      const decision = select(selectContext(opts.routing, switches, cap, limits), {
        role: roleOf(chain),
        entry: opts.phase?.entry,
        now: nowOf(opts.routing),
        continuation: false,
      })
      if (decision.kind !== "pick") return false
      to = candidateKey(decision.candidate)
      // The model just marked down cannot be the pick; a same-name result
      // would mean an override re-listed it — refuse rather than loop.
      if (to === from) return false
      toModel = decision.candidate.kind === "entry" ? decision.candidate.entry.model : decision.candidate.model
    } else {
      const fallback = fallbackRing()
      // 窗口已知且 < cap 的候选跳过并记一次原因(D.4:降级后立刻撞上限/交接预算比原故障
      // 更糟);窗口未知(不在映射)不过滤。
      for (const c of fallback) {
        if (tried.includes(c)) continue
        const limit = limits.get(c)
        if (limit !== undefined && limit < cap) {
          if (!clipped.includes(c)) {
            clipped.push(c)
            log(`⇄ ${task.id} skipping candidate ${c}: context window ${formatTokens(limit)} < chain requirement ${formatTokens(cap)}; switching would immediately hit the ceiling`)
          }
          continue
        }
        to = c
        break
      }
      // 候选耗尽(全部试过,或全部被窗口钳制跳过)。
      if (to === undefined) return false
      // 记录被离开的模型(供日志与降级 note):链上已降级候选优先,否则取路由主模型;
      // 未设路由时 from 为 undefined,日志渲染为「主模型」。若 from 恰为某真实候选串,
      // 一并标记已试(防被再选)。与 attempt 的 target 求值同一优先级链(chain.model >
      // sticky > /failback 覆写 > 路由表)。
      from = chain.model ?? stickyModel() ?? failbackOverride()?.wildcard ?? resolveModel(switches.model, opts.phase?.entry, roleOf(chain))
      if (from !== undefined && !tried.includes(from)) tried.push(from)
      tried.push(to)
      toModel = to
      ringSize = fallback.length
    }
    chain.model = toModel
    if (opts.routing) {
      // The registry's selection state: the internal name (and the base step)
      // travel with the chain; the down marks replace the phase-scoped sticky
      // holder (§6.4), so scope=phase keeps the move through the task
      // boundaries without it.
      chain.modelEntry = to
      chain.modelStep = 0
    } else if (switches.modelFailbackScope === "phase") {
      // failback 粒度 phase: 降级跨任务粘滞——链逐任务销毁,候选人选经 failback 模块的
      // sticky holder 带进本阶段后续任务,阶段边界(clearSticky)才重置回首选。
      setSticky(to)
    }
    log(
      opts.routing
        ? `⇄ ${task.id} ${why}; keeping chain context, switching model ${from ?? "primary model"} → ${to} (registry list; ${from ?? "the primary"} marked down)`
        : `⇄ ${task.id} ${why}; keeping chain context, switching model ${from ?? "primary model"} → ${to} (candidate ${tried.length}/${ringSize})`,
    )
    i = 1
    // 上下文随迁(设计 D.3/D.4):fork 逐条克隆消息、只搬消息不复制 agent/model/权限,
    // 换模型续跑无需重做上下文。分叉源与重试环同一套「保住最值钱的会话」判据:失败会话
    // 本体(用量 > 0 才算,0 用量是纯报错桩)与链上原会话,取已积累用量大者。两条触发面
    // 的链状态形态不同,这套判据同时覆盖:不可重试类(quota/auth/rate)attempt 已把会话
    // 晋升到 chain.id、chain.failed 为空,选出的就是 chain.id(行为等价改造前);可重试类
    // 跑完阶梯回落到这里时,attempt 把 chain.id 还原成了下发前的原会话、真正攒着上下文的
    // 是 chain.failed,若不看它就会把 100k+ 产出扔掉去开白板会话。fork 成功即从副本续跑;
    // 都不可用则回退全新会话——切换仍生效,仅不继承上下文。
    // 「下发过本提示词的会话」:可重试类记在 chain.failed,不可重试类已被 attempt 晋升到
    // chain.id——分到它即上下文完整,只带换模说明;分到链上原会话则本次尝试的部分产出
    // 不在副本里,须带现场核对说明(见 retryNote)。
    const failedID = chain.failed?.id ?? chain.id
    const sources: { id: string; used: number; why: string }[] = []
    if (chain.failed && chain.failed.used > 0) sources.push({ ...chain.failed, why: "failed session" })
    if (chain.id !== undefined && chain.id !== chain.failed?.id) sources.push({ id: chain.id, used: chain.used, why: "original session" })
    // chain.failed 在 fork 播种后刻意保留(不清空): 副本若 0-token 即死(配额连败
    // 现场),attempt 的守卫不会拿报错桩顶替它,下一轮重试仍能从这个最有价值的会话
    // 重新分叉;副本成功时由 attempt 收口清空。fork 已失效的死记录在此顺手清理,
    // 避免后续轮次对着死会话重复 fork。
    sources.sort((a, b) => b.used - a.used)
    for (const source of sources) {
      const forked = await forkSession(client, source.id, chain.subject ?? `${task.id} failover`)
      if (forked === undefined) {
        if (source.id === chain.failed?.id) chain.failed = undefined
        continue
      }
      // chain.id 清空、改由 pending 承载分叉会话:note 非空 + chain.id 非空会命中
      // attempt 的「中断恢复(resumed)复用原会话」分支而忽略 pending,故此处必须清 id,
      // 让降级 note 随分叉副本会话下发(副本已含真实累计消息)。
      chain.id = undefined
      chain.pending = forked
      chain.pct = 100
      chain.used = source.used
      // One-off failover note: carried to the AI with the next prompt via attempt's
      // note mechanism and cleared once used, telling the new model to keep the
      // earlier output formats and protocol (same idea as the stuck hint's weak-model
      // backstop); a fork of the original session (no context from this attempt)
      // gets the worktree-check form instead.
      chain.note =
        source.id === failedID
          ? `[DRIVER] Switched model to continue (${why}); keep the output formats and protocol used earlier in this session.`
          : retryNote(`Switched model to continue (${why}), but this session did not inherit this attempt's context.`)
      return true
    }
    if (sources.length) log(`↻ failover fork copies failed; the switch still takes effect, falling back to a blank new session (no context inherited)`)
    else log(`↻ no session context on the chain to inherit; the switch still takes effect, starting a blank new session`)
    // Falling back to a blank new session leaves no context at all: "keep what was
    // used earlier" would mislead a session with nothing earlier, so the note
    // becomes the worktree-check form (the worktree may hold this attempt's output).
    chain.note = retryNote(`Switched model to continue (${why}), but this session did not inherit the earlier session's context.`)
    chain.id = undefined
    chain.pct = 100
    return true
  }
  // 等待-探测环(2026-09-16 策略): 会话故障的最终归宿——不再阻塞退出,以
  // recoveryWait(缺省 30 分钟)为间隔无限等待,每轮用**全新临时干净会话**下发极小
  // 探测提示词判明服务是否恢复;恢复后 fork 被中断的会话(与重试环同一套「保住
  // 最值钱的会话」判据: 失败会话本体 > 链上原会话,0 用量纯报错桩不进候选)从
  // 副本续跑,fork 失败回退空白新会话重发完整提示词,阶梯计数重开一轮。如此无论
  // 面临何种配额限制,程序都能等到额度恢复后再继续;等待期间连按两次 Ctrl+C 经
  // runAll 的进程级 SIGINT 处理器强制退出(130),这是唯一的退出方式。
  // 探测链不带 phase(不写进度记录、不动真实链的恢复点),但复制真实链的
  // model/role——探测的就是恢复后要续跑的那条模型,配额按模型/账号计量,探测
  // 别的模型结论无意义。探测会话本身异常(订阅断开等)同样视为未恢复,继续等。
  // Under a registry (§6.3) the probe dispatches through selection like any
  // other: the probe candidate is the first one inside its window, ignoring
  // the down marks, so its mark is cleared for the probe and re-marked when
  // the probe fails — a successful probe leaves it cleared, which is exactly
  // "a successful probe clears that candidate's mark", and the re-dispatch
  // that follows picks it as the first usable candidate. A window-blocked
  // list (the wait decision) keeps failing its probes until the window opens;
  // the proper window wait with its jitter is the next step of the design.
  // AUTO-DECISION: the probe realizes the mark-clearing by clearing the probe candidate's mark before the dispatch and re-marking it on a failed probe, instead of bypassing selection with a dictated model (selection then picks the cleared candidate deterministically — it is the first in-window one — and no dispatch path exists that skips the windows or the marks)
  const awaitRecovery = async (why: string): Promise<void> => {
    for (;;) {
      log(`⏳ ${task.id} ${why}; waiting ${switches.recoveryWait} minutes, then probing service recovery with a fresh temporary session (press Ctrl+C twice to force exit)`)
      // 等待可能以小时计,从会话与 AI 用时中扣除、单记 waitMs(与 askHuman 同口径,
      // STATS_PLAN §2/§3);探测会话自身的用时照常入账。
      await statsWaitBegin(opts.dir, "recovery")
      try {
        await Bun.sleep(switches.recoveryWait * 60_000)
      } finally {
        await statsWaitEnd(opts.dir)
      }
      let probed: string | undefined
      if (opts.routing) {
        limits ??= await client.contextLimits()
        const decision = select(selectContext(opts.routing, switches, cap, limits), {
          role: roleOf(chain),
          entry: opts.phase?.entry,
          now: nowOf(opts.routing),
          continuation: false,
        })
        if (decision.kind === "probe") {
          probed = candidateKey(decision.candidate)
          clearModelDownMark(probed)
        }
      }
      const probe: SessionChain = { pct: 100, used: 0, at: 0, ...(opts.routing ? {} : { model: chain.model }), role: roleOf(chain) }
      let ping: SessionResult
      try {
        ping = await attempt(client, task, RECOVERY_PROBE_PROMPT, opts, probe, undefined, undefined, switches)
      } catch (error) {
        if (probed !== undefined) markModelDown(probed)
        log(`⏳ ${task.id} probe session itself errored (${formatClientError(error)}); service not recovered, continuing to wait`)
        continue
      }
      if (ping.type !== "idle") {
        if (probed !== undefined) markModelDown(probed)
        log(`⏳ ${task.id} probe session still failing (${firstLine(ping.question)}); continuing to wait`)
        continue
      }
      const sources: { id: string; used: number; why: string }[] = []
      if (chain.failed && chain.failed.used > 0) sources.push({ ...chain.failed, why: "failed session" })
      if (chain.id !== undefined && chain.id !== chain.failed?.id) sources.push({ id: chain.id, used: chain.used, why: "original session" })
      // 「下发过本提示词的会话」:不可重试类被 attempt 晋升到 chain.id、可重试类记在
      // chain.failed——分到它即上下文完整,只带恢复说明;分到原会话/空白会话则本次
      // 尝试的部分产出不在上下文里,须带现场核对说明(见 retryNote)。
      // chain.failed 在 fork 播种后刻意保留(与重试阶梯同一 invariant,见下方):
      // 副本 0-token 即死时记录不被顶替,恢复重发仍能从它重新分叉。
      const failedID = chain.failed?.id ?? chain.id
      sources.sort((a, b) => b.used - a.used)
      let seeded = false
      for (const source of sources) {
        const forked = await forkSession(client, source.id, chain.subject ?? `${task.id} recovery`)
        if (forked === undefined) {
          if (source.id === chain.failed?.id) chain.failed = undefined
          continue
        }
        log(`↻ ${task.id} service recovered; re-dispatching the task from a forked copy of the ${source.why} ${source.id} (${formatTokens(source.used)} tokens)`)
        // 清 chain.id、改由 pending 承载分叉会话(与 switchModel 同理: note + chain.id
        // 非空会命中 attempt 的 resumed 复用分支而忽略 pending)。
        chain.id = undefined
        chain.pending = forked
        chain.pct = 100
        chain.used = source.used
        // One-off recovery note: the forked copy ends with the original error
        // message, so a repeated prompt needs a word of explanation or the AI treats
        // it as a repeated request; a fork of the original session (no context from
        // this attempt) gets the worktree-check form instead.
        chain.note =
          source.id === failedID
            ? "[DRIVER] The previous dispatch was interrupted by a service/quota failure; service has recovered, so continue with what this task asks."
            : retryNote("The previous dispatch was interrupted by a service/quota failure; service has recovered, but this session did not inherit this attempt's context.")
        seeded = true
        break
      }
      if (!seeded) {
        if (sources.length) log(`↻ ${task.id} service recovered, but all forked copies of the interrupted session failed; falling back to a blank new session to re-dispatch the task`)
        // A blank new session knows nothing of this attempt's output; the re-send
        // must carry the worktree-check note.
        chain.note = retryNote("The previous dispatch was interrupted by a service/quota failure; service has recovered, but the earlier session's context could not be inherited.")
        chain.id = undefined
        chain.pct = 100
      }
      i = 1
      return
    }
  }
  for (;;) {
    let result: SessionResult
    try {
      result = await attempt(client, task, promptText, opts, chain, steer, test, switches)
    } catch (error) {
      // 会话故障不退出: SDK 调用抛出的异常(事件流订阅断开、请求超时中止等)与
      // 返回错误同渠道进入重试/等待机制——除连按两次 Ctrl+C 外,任何会话故障都
      // 不终止运行。
      result = { type: "blocked", question: `session error: ${formatClientError(error)}` }
    }
    // 会话故障面(错误本体/创建会话失败/下发任务失败)全部进入恢复机制,不直接
    // 上抛阻塞;仍直接返回的 blocked 只有会话内阻塞提问与权限拒绝——那需要人工
    // 答复,本就不属于故障。
    if (result.type !== "blocked") return result
    // Registry routing: selection found nothing usable for the dispatch (every
    // candidate down or outside its windows, §6.3) — no session ran, so this is
    // not a session failure either: straight into the wait-and-probe loop,
    // whose probe clears a candidate's mark when service is back.
    if (result.noModel === true) {
      await awaitRecovery(firstLine(result.question))
      continue
    }
    if (!(result.question.startsWith("session error: ") || result.question.startsWith("session creation failed: ") || result.question.startsWith("task dispatch failed: "))) return result
    // P4 配额降级(设计 D.3):分类为 quota/auth/rate 且配置了候选表时,取下一候选
    // (经 D.4 窗口钳制)、换 chain.model、复用既有 fork 副本路径续跑(上下文随迁)。
    // 判据取 result.errorClass(P3 三条触发面统一带来的归类):plain session.error 的
    // quota(isRetryable:false)与提前结算的 retry part / session.status retry 均带
    // errorClass,故据它决策即可覆盖两条路径(不读 result.failover)。
    // Under a registry the tier lists are the candidate table (the global ring
    // is a refused switch there), so the same gate applies with no ring set.
    const classLabel =
      result.errorClass === "quota" ? "quota restricted" : result.errorClass === "auth" ? "provider auth failed" : result.errorClass === "rate" ? "rate-limit wait too long" : undefined
    if ((opts.routing !== undefined || fallbackRing().length > 0) && classLabel !== undefined) {
      if (await switchModel(classLabel)) continue
      // 候选耗尽(候选与首选全部配额受限/不可用): 不再阻塞退出——等待-探测环等到
      // 额度恢复,期间探测用当前生效模型,恢复后从被中断的会话分叉续跑。
      await awaitRecovery(
        opts.routing !== undefined
          ? `${classLabel} and every candidate of the tier list is down (down: ${[...downMarks().keys()].join(", ") || "none"})`
          : `${classLabel} and fallback candidates exhausted (tried: ${tried.join(", ") || "none"})`,
      )
      continue
    }
    // 不可重试(isRetryable:false,配额/鉴权类): 换会话无意义、未配候选表也换不了
    // 模型——不再直接阻塞,等待-探测环无限等额度恢复,期间全新临时会话探测,恢复
    // 后 fork 被中断的会话续跑。attempt() 已保证 chain.id 落在这一轮实际用过的
    // 会话上(哪怕它就是刚失败的这个),真正有内容的会话不被牺牲。
    if (result.retryable === false) {
      await awaitRecovery(`non-retryable session error encountered (${firstLine(result.question)})`)
      continue
    }
    // 阶梯耗尽: 不再等人工裁决——先试降级候选(换 provider 是阶梯之外唯一还没
    // 试过的手段),候选也用尽(或未配置)则进入等待-探测环,半小时一次直至服务
    // 恢复,从被中断的会话分叉续跑、阶梯重开一轮。留在进程里等,会话就还活着、
    // 还能继续 fork——阻塞退出反而会把阶梯期间刚保住的那个会话扔掉。
    // 作用域:chain 由 runTask 逐任务新建,chain.model 随之逐任务归零,下一个任务
    // 自动从首选模型重新起跑;更细/更粗的回试粒度由 OPENCODE_AUTO_MODEL_FAILBACK_SCOPE
    // 在边界挂点消费(见 src/failback.ts)。
    if (i > waits.length) {
      if ((opts.routing !== undefined || fallbackRing().length > 0) && (await switchModel("retry ladder exhausted"))) continue
      await awaitRecovery(`retry ladder exhausted (${waits.length} retries) without success`)
      continue
    }
    if (opts.server && NETWORK_FAILURE.test(result.question)) {
      await opts.server.restart("session error is a network/service failure; restarting the opencode server and retrying with a new session")
    }
    // 本次重试前的退避。计数在动作之前推进,下面三条 continue 路径共用 nth 作日志序号。
    const waitMinutes = waits[i - 1] ?? 0
    const nth = i++
    if (waitMinutes > 0) {
      log(`⏳ ${task.id} transient session error; waiting ${waitMinutes} minutes before retrying (${nth}/${waits.length}):\n${firstLine(result.question)}`)
      await Bun.sleep(waitMinutes * 60_000)
    }
    // 保住最值钱的会话再从它分叉: 候选为刚失败的会话本体与链上原会话(attempt()
    // 已把 chain.id 还原为下发前的原会话;复用轮里两者同一个,去重后只试一次),
    // 价值以"已积累的上下文用量"度量,取最大者,fork 失败再退而求其次;都不可用
    // 时依次回落 fork 基点(暖前缀,见下方 forkBase 分支)与空白新会话。
    //
    // 失败会话优先的理由: 超时/流中断类故障与会话内容无关(provider 侧停顿),
    // 会话里那 100k+ 已核实产出是本轮最值钱的资产,开空白会话等于把它扔掉、再从
    // 零撞同一堵墙——plans/0015-session-error-retry-plan.md 事实基线第 4 点记过这种"比完全不
    // 复用还差"的反例。代价是副本尾部带着那条 0-token 报错消息、重试提示词落在它
    // 后面;used 为 0 的失败会话则是纯报错桩(下发即失败,什么也没跑出来),没有
    // 值得保护的内容,不进候选(维持原设计判据)。
    //
    // 一律 fork 副本而非直接复用: 原会话不受影响,失败即弃,恢复点仍是原会话
    // (progress 的还原逻辑不动,见 attempt() 的可重试分支)。此处也不设
    // seedForkSession 的"用量达 cap/2 即冷启动"护栏——那道护栏防的是新子任务背上
    // 过大前缀,而重试是同一条提示词的续命,前缀大恰恰因为活干得多。
    //
    // 「下发过本提示词的会话」= chain.failed(可重试类 attempt 已还原链状态并把它
    // 记录在案):分到它即上下文完整,重发只需一句解释;分到链上原会话、基点或空白
    // 会话则本次尝试已落盘的部分产出不在上下文里,须带现场核对说明(见 retryNote)。
    const failedID = chain.failed?.id ?? chain.id
    const sources: { id: string; used: number; why: string }[] = []
    if (chain.failed && chain.failed.used > 0) sources.push({ ...chain.failed, why: "failed session" })
    if (chain.id !== undefined && chain.id !== chain.failed?.id) sources.push({ id: chain.id, used: chain.used, why: "original session" })
    // chain.failed 在 fork 播种后刻意保留(不清空): 副本若 0-token 即死(配额连败
    // 现场,2026-09-17 virtio T-005),attempt 的守卫不会拿报错桩顶替它,下一轮重试
    // 仍能从这个最有价值的会话重新分叉;副本跑出内容(used > 0)则严格超集正常顶替,
    // 成功时由 attempt 收口清空。fork 已失效的死记录在此顺手清理。
    sources.sort((a, b) => b.used - a.used)
    let seeded = false
    for (const source of sources) {
      const forked = await forkSession(client, source.id, chain.subject ?? `${task.id} retry`)
      if (forked === undefined) {
        if (source.id === chain.failed?.id) chain.failed = undefined
        continue
      }
      log(`↻ ${task.id} transient session error; retrying from a forked copy of the ${source.why} ${source.id} (${formatTokens(source.used)} tokens) (${nth}/${waits.length}):\n${result.question}`)
      chain.pending = forked
      chain.pct = 100
      chain.used = source.used
      // One-off retry note: the copy ends with the error message, so a repeated
      // prompt needs a word of explanation or the AI treats the re-send as a repeated
      // request (same motive as awaitRecovery's note). The original session stays in
      // chain.id (the next retry forks from it again); with both note and pending set,
      // attempt consumes pending first (the resumed check requires pending to be
      // empty), so the original session is never reused by mistake.
      chain.note =
        source.id === failedID
          ? "[DRIVER] The previous dispatch was interrupted by a transient session error and is being retried now; continue with what this task asks."
          : retryNote("The previous dispatch was interrupted by a transient session error and is being retried now, but this session did not inherit this attempt's context.")
      seeded = true
      break
    }
    if (seeded) continue
    if (sources.length) log(`↻ fork retry copy failed; falling back to the fork base / a blank new session`)
    // 无会话可分叉(子任务的首条消息即失败,链上本就为空)但基点还在: 从基点重新
    // 播种,至少赚回免费的暖前缀,而不是纯冷启动——与 fork 三段式"每项重新从基点
    // 分叉"(fork-decompose 设计 §4.3)同一语义。基点前缀只有任务背景,本次尝试的
    // 上下文不在其中,重发须带现场核对说明。基点失效则回落空白新会话。
    if (chain.id === undefined && chain.forkBase !== undefined && (await sessionAlive(client, chain.forkBase))) {
      const base: ForkBaseInfo = { id: chain.forkBase, used: await sessionUsed(client, chain.forkBase) }
      if (await seedForkSession(client, opts, chain, base, chain.subject ?? `${task.id} retry`)) {
        log(`↻ ${task.id} transient session error; no session on the chain to fork, re-seeded from the base for retry (${nth}/${waits.length}):\n${result.question}`)
        chain.note = retryNote("The previous dispatch was interrupted by a transient session error and is being retried now, but this session did not inherit this attempt's context.")
        continue
      }
    }
    log(`↻ ${task.id} transient session error; retrying with a new session (${nth}/${waits.length}):\n${result.question}`)
    // 重试保持"换新会话"语义,不复用出错的会话;空白会话对本次尝试的产出一无所知,
    // 重发必须带现场核对说明,否则新会话对着半成品从头重做。
    chain.id = undefined
    chain.pct = 100
    chain.note = retryNote("The previous dispatch was interrupted by a transient session error and is being retried now, but this session did not inherit the earlier session's context.")
  }
}
