// 会话驱动的核心层: 单个提示词在会话链上的执行(runSession——复用/新建、瞬时
// 错误换新会话重试、网络故障重启 server、配额受限的模型降级环与窗口钳制、
// 一切会话故障的最终归宿「等待-探测环」awaitRecovery),以及 fork 基点的确立
// (ensureForkBase——它驱动一次性基点会话,属会话驱动而非 SDK 薄封装,故与
// runSession 同层,见 plans/0024-module-split-plan.md §I D9)。
// 位于 attempt/watch 之上、runner 之下;**不得反向 import runner**。
// 拆分自 src/runner.ts(plans/0024-module-split-plan.md S8,纯搬运)。

import { dirname, join } from "node:path"
import type { AgentClient } from "./agent/types"
import { resolveModel, roleOf, type ForkBaseInfo, type SessionChain, type SessionResult, type WindowWait } from "./chain"
import { attempt } from "./attempt"
import { taskDoc } from "./docpaths"
import { clearModelDownMark, downMarks, extendKeyDownMark, extendModelDownMark, failbackOverride, markModelDown, setSticky, stickyModel } from "./failback"
import { bookedSleep, HIBERNATE_JITTER_MS } from "./hibernate"
import {
  commitRotation,
  currentKey,
  hasActiveRing,
  markCurrentKeyDown,
  clearRingMarks,
  ringKeyLabel,
  ringRotation,
  spawnKeyConfig,
} from "./keyring"
import { log } from "./log"
import { formatWindowState, isoInZone } from "./model-window"
import { DEFAULT_CONTEXT_LIMIT, type Opts } from "./opts"
import { candidateKey, nowOf, selectContext, type Candidate } from "./routing"
import { candidatesOf, select, type SelectCall, type SelectContext } from "./select"
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
  // failover note, the ladder reset). Key rotation (step 1, above) runs
  // before this; cross-agent candidates are a later step.
  // `until` is a reset time the failure-message classifier read (§7.1): the
  // model's down mark lasts until then instead of the scope boundary;
  // `classified` records that the class came from the classifier, so the ◈
  // line names the move "quota (classifier)" (§6.5).
  const switchModel = async (why: string, until?: number, classified?: boolean): Promise<boolean> => {
    limits ??= await client.contextLimits()
    let from: string | undefined
    let to: string | undefined
    let toModel: string | undefined
    let ringSize = 0
    if (opts.routing) {
      from = chain.modelEntry
      if (from !== undefined) markModelDown(from, until, classified)
      const facts = opts.routing
      const ctx = selectContext(facts, switches, cap, limits)
      const call = { role: roleOf(chain), entry: opts.phase?.entry, now: nowOf(facts), continuation: false as const }
      let decision = select(ctx, call)
      if (decision.kind === "wait") {
        // Escalation step 3 (§7): the remaining candidates are blocked only
        // by their windows — wait for the opening plus the jitter instead of
        // handing a closed window to the probe loop, then select again.
        await waitForWindow(windowWaitOf(ctx, call, decision))
        decision = select(ctx, { ...call, now: nowOf(facts) })
      }
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
  // Escalation step 1 (plans/0055 §7): a quota/auth/rate failure whose model
  // runs on a provider with a key ring moves the ring first — mark the
  // current key down, write the next key into the spawn config, restart the
  // managed server, then re-dispatch the *same* model from a fork of the
  // failed session (the retry path's source choice and note). An auth error
  // counts here because a revoked key looks like one. Only when no key is
  // left that is not down (no ring, inactive rings, an exhausted ring, no
  // host that can take a new spawn config) does the caller fall through to
  // the model failover of step 2 — which then marks the model down and lets
  // selection's ring predicate (§6.2 rule 4) skip every entry on the
  // exhausted provider.
  // AUTO-RESOLVE: the design says the re-dispatch's "source choice and note are those of the retry path" — may the note keep the retry path's literal "transient session error" wording? -> no, the two note forms and the mechanism are the retry path's, but the lead names the key failure ("failed on this provider's key (…) retried on the next key of the ring") (a quota-failed fork told about a transient error would misread the tail message it carries; the forms explain a repeated prompt alike, so only the lead changes)
  // `until` as for switchModel: the failed key's mark lasts until the reset
  // time the classifier read.
  const rotateProviderKey = async (why: string, until?: number): Promise<boolean> => {
    const facts = opts.routing
    if (facts === undefined) return false
    const entry = facts.registry.models.get(chain.modelEntry ?? "")
    const provider = entry?.provider
    if (provider === undefined || !hasActiveRing(provider)) return false
    const now = nowOf(facts)
    const rotation = ringRotation(provider, now)
    if (rotation === undefined) {
      // No key is left that is not down (an exhausted or single-key ring):
      // the current key failed all the same, so it is marked down before the
      // fall-through, and §6.2 rule 4 keeps every entry on this provider out
      // of the selection that follows.
      // AUTO-DECISION: the current key is marked down even when no rotation can land (the design's step 1 words the marking as part of a rotation, but an unmarked current key would leave the ring reading usable while its key just failed with quota, and the failover would be able to re-pick the same dead key the moment the model mark clears)
      markCurrentKeyDown(provider, until)
      return false
    }
    const host = opts.server
    if (host === undefined || host.setConfig === undefined) return false
    const from = ringKeyLabel(rotation.from)
    const to = ringKeyLabel(rotation.to)
    commitRotation(rotation, until)
    host.setConfig(spawnKeyConfig())
    const restarted = await host.restart(`${why}; rotating the provider ${provider} key ring to key ${to}`)
    log(
      `⇄ ${task.id} ${why}; provider ${provider} key ${from} marked down, continuing the same model on key ${to}` +
        (restarted ? "" : " (the managed server could not be restarted; the new key applies at its next spawn)"),
    )
    // The re-dispatch rides a fork of the failed session — the same source
    // choice as the retry ladder and switchModel (the failed session itself
    // above the chain's original session, by accumulated context; a 0-token
    // error stub never qualifies), so the turn's context survives the
    // restart (F8: sessions persist across a managed server restart).
    const failedID = chain.failed?.id ?? chain.id
    const sources: { id: string; used: number; why: string }[] = []
    if (chain.failed && chain.failed.used > 0) sources.push({ ...chain.failed, why: "failed session" })
    if (chain.id !== undefined && chain.id !== chain.failed?.id) sources.push({ id: chain.id, used: chain.used, why: "original session" })
    sources.sort((a, b) => b.used - a.used)
    for (const source of sources) {
      const forked = await forkSession(client, source.id, chain.subject ?? `${task.id} key rotation`)
      if (forked === undefined) {
        if (source.id === chain.failed?.id) chain.failed = undefined
        continue
      }
      log(`↻ ${task.id} ${why}; re-dispatching the same model from a forked copy of the ${source.why} ${source.id} (${formatTokens(source.used)} tokens)`)
      chain.id = undefined
      chain.pending = forked
      chain.pct = 100
      chain.used = source.used
      chain.note =
        source.id === failedID
          ? `[DRIVER] The previous dispatch failed on this provider's key (${why}) and is being retried on the next key of the ring; continue with what this task asks.`
          : retryNote(`The previous dispatch failed on this provider's key (${why}) and is being retried on the next key of the ring, but this session did not inherit this attempt's context.`)
      return true
    }
    if (sources.length) log(`↻ key rotation fork copies failed; the rotation still takes effect, re-dispatching in a blank new session (no context inherited)`)
    else log(`↻ no session context on the chain to inherit; the rotation still takes effect, re-dispatching in a blank new session`)
    chain.note = retryNote(`The previous dispatch failed on this provider's key (${why}) and is being retried on the next key of the ring, but the earlier session's context could not be inherited.`)
    chain.id = undefined
    chain.pct = 100
    return true
  }
  // The down marks one failure's escalation may write (plans/0055 §7.1):
  // the chain's entry and, when its provider has an active ring, the key it
  // ran on — read before the escalation moves anything.
  const downTarget = (): { model?: string; provider?: string; key?: { ref: string; label: string } } => {
    const model = chain.modelEntry
    const provider = opts.routing?.registry.models.get(model ?? "")?.provider
    const key = provider !== undefined && hasActiveRing(provider) ? currentKey(provider) : undefined
    return { model, provider, ...(key !== undefined ? { key: { ref: key.ref, label: key.label } } : {}) }
  }
  // A classifier answer that arrives after the turn ended (§7.1): it can only
  // set when this failure's down marks clear — each mark the escalation wrote
  // and nothing cleared since then lasts until the reset time instead of the
  // scope boundary. The class it names comes too late to change anything.
  const lateReset = (pending: Promise<number | undefined> | undefined, target: ReturnType<typeof downTarget>): void => {
    if (pending === undefined) return
    void pending.then((until) => {
      if (until === undefined) return
      const marked: string[] = []
      if (target.model !== undefined && extendModelDownMark(target.model, until)) marked.push(target.model)
      if (target.provider !== undefined && target.key !== undefined && extendKeyDownMark(target.provider, target.key.ref, until))
        marked.push(`provider ${target.provider} key ${target.key.label}`)
      if (marked.length && opts.routing)
        log(`⏲ ${task.id} the classifier's answer arrived after the turn ended: ${marked.join(" and ")} stay${marked.length > 1 ? "" : "s"} down until ${isoInZone(until, opts.routing.registry.tz)}`)
    })
  }
  // The window wait (plans/0055 §6.3): every candidate is blocked only by
  // its windows and one that is not down opens later. The dispatch sleeps
  // inside the unit before dispatching, as the recovery wait does: one wait
  // line naming the model and its opening, the interval booked as a `window`
  // wait (excluded from aiMs/wallMs, recorded as waitMs), and hibernate's
  // random delay of 0–600 s on top of the opening (plans/0027 D3, shared
  // through HIBERNATE_JITTER_MS and the booked sleep), so drivers sharing an
  // account do not all dispatch at the same moment. A double Ctrl+C
  // force-quits it through runAll's process-level SIGINT handler (130), like
  // every long wait. After the wake the loop selects again on the machine
  // clock (the facts' injected clock in tests): a suspend only wakes late,
  // and a wake past a short window simply waits for its next opening — the
  // wait never exits on its own (§10 item 7).
  // AUTO-DECISION: the wait decision is honored at every selection site — the dispatch target (attempt returns the facts, this loop sleeps), the failover (switchModel below) and the probe loop (awaitRecovery below) wait and re-select in place — instead of only at the dispatch (a failover onto a window-blocked list or a probe round after the marks clear would otherwise burn wait-and-probe rounds against a closed window; the wait line keeps the designed text and adds hibernate's resuming/force-quit hint, which §6.3's force-quit promise asks to be visible)
  const waitForWindow = async (wait: WindowWait): Promise<void> => {
    const facts = opts.routing!
    const now = nowOf(facts)
    const jitter = (facts.random ?? Math.random)() * HIBERNATE_JITTER_MS
    const wakeAt = new Date(now + Math.max(0, wait.until - now) + jitter)
    log(
      `⏸ ${task.id} ${roleOf(chain)} waits for a ${wait.tier} model: ${wait.model} ${wait.opens}` +
        `, resuming around ${wakeAt.toISOString()} (local ${wakeAt.toLocaleString()}, includes random delay); press Ctrl+C twice to force-quit`,
    )
    await bookedSleep("window", Math.max(0, wait.until - now) + jitter, { dir: opts.dir, sleep: facts.sleep })
    log(`→ window wait over: continuing after ${wait.model} opened`)
  }
  // The wait facts of a wait decision, for the wait line: the model that
  // opens first, its formatted opening and the dispatch list's tier. The
  // dispatch target itself (attempt) builds the same payload from the list
  // it already holds; the failover and the probe loop select without one.
  const windowWaitOf = (
    ctx: SelectContext,
    call: SelectCall,
    decision: { until: number; candidate: Candidate },
  ): WindowWait => ({
    until: decision.until,
    model: candidateKey(decision.candidate),
    tier: candidatesOf(ctx, call).tier,
    opens: formatWindowState({ open: false, opens: decision.until }, opts.routing!.registry.tz, call.now),
  })
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
  // list (the wait decision) never gets here: it waits on the window below
  // instead of burning probe rounds against a closed window.
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
      // The probe candidate's provider, when its ring kept the candidate
      // unusable: the probe ignores the ring (§6.3), so the ring's key marks
      // clear for the probe and the key it ran on is re-marked on failure —
      // the same clear-and-re-mark the model mark gets, and the position
      // never moves.
      // AUTO-DECISION: the probe's ring half re-marks only the current key on failure, not every cleared mark (the probe ran on the current key alone; the earlier keys' marks would have cleared at the same boundaries anyway, and a wrapped rotation onto them later is the §6.4 semantics a boundary clear already has)
      let probedProvider: string | undefined
      if (opts.routing) {
        limits ??= await client.contextLimits()
        const facts = opts.routing
        const ctx = selectContext(facts, switches, cap, limits)
        const call = { role: roleOf(chain), entry: opts.phase?.entry, now: nowOf(facts), continuation: false as const }
        let decision = select(ctx, call)
        // A wait decision here (the marks cleared mid-loop — /failback, say —
        // and what is left is window-blocked): wait for the opening rather
        // than probe a closed window, then take the probe decision.
        while (decision.kind === "wait") {
          await waitForWindow(windowWaitOf(ctx, call, decision))
          decision = select(ctx, { ...call, now: nowOf(facts) })
        }
        if (decision.kind === "probe") {
          probed = candidateKey(decision.candidate)
          clearModelDownMark(probed)
          if (decision.candidate.kind === "entry" && decision.candidate.entry.provider !== undefined) {
            probedProvider = decision.candidate.entry.provider
            clearRingMarks(probedProvider)
          }
        }
      }
      const probe: SessionChain = { pct: 100, used: 0, at: 0, ...(opts.routing ? {} : { model: chain.model }), role: roleOf(chain) }
      let ping: SessionResult
      try {
        ping = await attempt(client, task, RECOVERY_PROBE_PROMPT, opts, probe, undefined, undefined, switches)
      } catch (error) {
        if (probed !== undefined) markModelDown(probed)
        if (probedProvider !== undefined) markCurrentKeyDown(probedProvider)
        log(`⏳ ${task.id} probe session itself errored (${formatClientError(error)}); service not recovered, continuing to wait`)
        continue
      }
      if (ping.type !== "idle") {
        // A reset time the classifier read from the probe's failure sets
        // when the re-written marks clear (§7.1), as on the escalation.
        if (probed !== undefined) markModelDown(probed, ping.resetAt, ping.classified)
        if (probedProvider !== undefined) markCurrentKeyDown(probedProvider, ping.resetAt)
        if (probed !== undefined) lateReset(ping.pendingReset, { model: probed })
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
    // not a session failure either. The two §6.3 outcomes split here: a wait-
    // able window sleeps inside the unit until the opening plus the jitter and
    // dispatches again; everything down goes to the wait-and-probe loop, whose
    // probe clears a candidate's mark when service is back.
    if (result.noModel === true) {
      if (result.windowWait !== undefined) {
        await waitForWindow(result.windowWait)
        continue
      }
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
    // The escalation is key → model → wait (plans/0055 §7): a ringed provider
    // rotates to its next key first (rotateProviderKey), the model failover
    // (switchModel, step 2) follows only when no key is left.
    // A class the failure-message classifier raised (§7.1) is marked in the
    // label — the ⇄ line and the failover note read "quota restricted
    // (classifier)" — and its reset time goes into the down marks the
    // escalation writes; an answer still on its way sets them when it lands.
    const classBase =
      result.errorClass === "quota" ? "quota restricted" : result.errorClass === "auth" ? "provider auth failed" : result.errorClass === "rate" ? "rate-limit wait too long" : undefined
    const classLabel = classBase !== undefined && result.classified ? `${classBase} (classifier)` : classBase
    if ((opts.routing !== undefined || fallbackRing().length > 0) && classLabel !== undefined) {
      const target = downTarget()
      const moved =
        (opts.routing !== undefined && (await rotateProviderKey(classLabel, result.resetAt))) ||
        (await switchModel(classLabel, result.resetAt, result.classified))
      lateReset(result.pendingReset, target)
      if (moved) continue
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
