// 会话驱动的核心层: 单个提示词在会话链上的执行(runSession——复用/新建、瞬时
// 错误换新会话重试、网络故障重启 server、配额受限的模型降级环与窗口钳制),
// 阶梯耗尽后的人工裁决(askRetry/retryDecision),以及 fork 基点的确立
// (ensureForkBase——它驱动一次性基点会话,属会话驱动而非 SDK 薄封装,故与
// runSession 同层,见 docs/module-split-plan.md §I D9)。
// 位于 attempt/watch 之上、runner 之下;**不得反向 import runner**。
// 拆分自 src/runner.ts(docs/module-split-plan.md S8,纯搬运)。

import { dirname, join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { resolveModel, roleOf, type ForkBaseInfo, type SessionChain, type SessionResult } from "./chain"
import { attempt } from "./attempt"
import { resolveTaskDoc, taskDoc } from "./docpaths"
import { failbackOverride, setSticky, stickyModel } from "./failback"
import type { Interactive } from "./interactive"
import { log } from "./log"
import { DEFAULT_CONTEXT_LIMIT, type Opts } from "./opts"
import { setForkBase, type Plan, type Task } from "./plan"
import { renderContextBase } from "./prompt"
import { firstLine } from "./resume-gate"
import { askHuman, contextLimits, forkSession, formatTokens, seedForkSession, sessionAlive, sessionUsed } from "./session-api"
import { autoSwitches, type Switches } from "./switches"
import { type Steer, type TestRun } from "./testrun"

// fork 基点确立(fork-decompose 设计 §4.2): 返回生效基点,undefined = 冷启动。
// digest 模式读 context.md 全文,经一次性链(subject `T-NNN ctxbase …`,不带
// phase、不写进度记录;确认 turn 无工作区改动、commitTree 自然零提交)重建基点
// 会话——前缀确定性 = 摘要全文,provider 缓存友好;每次运行无条件重建并覆写
// fork-base(基点是每次运行重建的易失指针,旧基点会话自然沉没)。回退链:
// digest 建立失败 → session 基点(PLAN.md 持久字段,校验存活,失效回退冷启动)
// → 冷启动。session 模式基点跨运行持久,用量经 messages 末条消息重建(近似
// 即可;同次运行且基点即链上会话时直接取跟踪值)。
export async function ensureForkBase(
  client: OpencodeClient,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
  switches: Switches = autoSwitches(),
): Promise<ForkBaseInfo | undefined> {
  if (!switches.fork) return undefined
  const dir = opts.dir ?? dirname(plan.path)
  if (switches.forkBase === "digest") {
    const digest = (await Bun.file(join(dir, await resolveTaskDoc(dir, task.id, "context"))).text().catch(() => "")).trim()
    if (digest) {
      const subject = `${task.id} ctxbase ${task.title}`
      const base: SessionChain = { pct: 100, used: 0, at: 0, subject }
      const result = await runSession(client, task, renderContextBase(task, digest), opts, base)
      if (result.type === "idle" && base.id) {
        await setForkBase(plan.path, task.id, base.id)
        log(`⑂ ${task.id} digest 基点就绪: 会话 ${base.id}(摘要前缀 ${formatTokens(base.used)} tokens)`)
        return { id: base.id, used: base.used }
      }
      log(`↻ ${task.id} digest 基点会话未建立${result.type === "blocked" ? `(${firstLine(result.question)})` : ""},回退 session 基点`)
    } else {
      log(`↻ ${task.id} 缺少 ${taskDoc(task.id, "context")} 摘要,digest 基点不可建立,回退 session 基点`)
    }
  }
  if (task.forkBase) {
    if (await sessionAlive(client, task.forkBase)) {
      const used = task.forkBase === chain.id ? chain.used : await sessionUsed(client, task.forkBase)
      log(`⑂ ${task.id} session 基点就绪: 会话 ${task.forkBase}(${formatTokens(used)} tokens)`)
      return { id: task.forkBase, used }
    }
    log(`↻ ${task.id} session 基点 ${task.forkBase} 已失效,回退冷启动`)
  }
  return undefined
}

// 会话错误中属于网络/服务故障的特征串;命中时先重启 server(外部 server 除外)
// 再换新会话重试,避免对着同一坏实例反复失败。
const NETWORK_FAILURE = /internal network failure|network error|fetch failed|econnrefused|econnreset|socket hang up/i

// Runs one prompt on the session chain (reusing the previous session when its
// context ended below REUSE_BELOW and within REUSE_IDLE_MS). Transient
// provider failures (session.error, e.g. malformed reasoning content from a
// gateway) are retried in a fresh session before blocking; network/server
// failures (Internal network failure / Network error 等) additionally restart
// the spawned opencode server before the retry.
// 单个提示词在会话链上的执行(复用/新建、错误重试与 server 重启);导出供
// src/final.ts 的终审任务生成会话等旁路复用。test 为 --test-by-driver 的协议
// 状态(仅执行类会话经 runExecSession 传入;旁路会话不传,协议不生效);
// switches 缺省取 OPENCODE_AUTO_* 解析值(复用开关),注入供单测。
export async function runSession(
  client: OpencodeClient,
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
  let limits: Map<string, number> | undefined
  // 重试阶梯(OPENCODE_AUTO_RETRY_WAITS,缺省 0,1,2,4,8): waits 的每个元素是该次
  // 重试前的等待分钟数,元素个数即重试次数上限。首次重试立即——瞬时抖动确实会在
  // 下一回合就恢复(DB 里有「尝试 1 静默 300s 被中止、尝试 2 成功」的实例);其后
  // 按分钟级退避。
  //
  // 为什么退避从分钟起步、而不是从秒开始翻倍: 退避本身不是恢复手段。opencode 内层
  // 每次故障已经用掉 6×300s 超时 + 2+4+8+16+30s 退避 ≈ 1860s(实测 1862s),外层再叠
  // 一条秒级曲线只占其中零头,改变不了下一次请求的命运。分钟级等待的唯一意义是
  // 「跨过一段上游退化」,而实测退化以小时计(6 次致命错误挤在最后 18 小时,每个
  // 致命会话死前已有 2–6 个 ≥250s 的步骤)——所以阶梯必然有耗尽的一天,耗尽后的
  // 出路是人工裁决,不是继续加码次数。
  const waits = switches.retryWaits
  let i = 1
  // 有效降级候选环: /failback 带参重定义过模型序时用其覆写环,否则取 switches 的
  // OPENCODE_AUTO_MODEL_FALLBACK 解析结果(switches memo 恒定,覆写经 failback 模块态
  // 承载)。降级触发门禁与 switchModel 的候选遍历共用同一来源。
  const fallbackRing = () => failbackOverride()?.fallback ?? switches.model.fallback
  // 候选降级的公共动作(两个触发面共用:下面的配额降级支、阶梯耗尽后的人工回落):
  // 取 fallback 中首个「未试过 且 上下文窗口可接受」的候选,换 chain.model、挂一次性
  // 降级 note、fork 副本带上下文随迁,并把阶梯计数重置为 1(本候选独享一轮完整阶梯)。
  // 切换成功返回 true(调用方 continue);候选耗尽返回 false(调用方按各自文案阻塞)。
  // why 为触发原因的中文短语,进日志与降级 note。
  const switchModel = async (why: string): Promise<boolean> => {
    limits ??= await contextLimits(client)
    const fallback = fallbackRing()
    // 窗口已知且 < cap 的候选跳过并记一次原因(D.4:降级后立刻撞上限/交接预算比原故障
    // 更糟);窗口未知(不在映射)不过滤。
    let candidate: string | undefined
    for (const c of fallback) {
      if (tried.includes(c)) continue
      const limit = limits.get(c)
      if (limit !== undefined && limit < cap) {
        if (!clipped.includes(c)) {
          clipped.push(c)
          log(`⇄ ${task.id} 跳过候选 ${c}:上下文窗口 ${formatTokens(limit)} < 链需求 ${formatTokens(cap)},降级后恐立刻撞上限`)
        }
        continue
      }
      candidate = c
      break
    }
    // 候选耗尽(全部试过,或全部被窗口钳制跳过)。
    if (candidate === undefined) return false
    // 记录被离开的模型(供日志与降级 note):链上已降级候选优先,否则取路由主模型;
    // 未设路由时 from 为 undefined,日志渲染为「主模型」。若 from 恰为某真实候选串,
    // 一并标记已试(防被再选)。与 attempt 的 target 求值同一优先级链(chain.model >
    // sticky > /failback 覆写 > 路由表)。
    const from = chain.model ?? stickyModel() ?? failbackOverride()?.wildcard ?? resolveModel(switches.model, opts.phase, roleOf(chain))
    if (from !== undefined && !tried.includes(from)) tried.push(from)
    tried.push(candidate)
    chain.model = candidate
    // failback 粒度 phase: 降级跨任务粘滞——链逐任务销毁,候选人选经 failback 模块的
    // sticky holder 带进本阶段后续任务,阶段边界(clearSticky)才重置回首选。
    if (switches.modelFailbackScope === "phase") setSticky(candidate)
    // 一次性降级说明(设计 D.3):随下一个提示词经 attempt 的 note 机制带给 AI、用后即
    // 清,提示换模型续跑时沿用前文产物格式与协议(与 stuck-hint 为弱模型兜底同一哲学)。
    chain.note = `[driver] 因${why}已切换模型继续,请沿用前文的产物格式与协议。`
    log(`⇄ ${task.id} ${why},链上下文保留,切换模型 ${from ?? "主模型"} → ${candidate}(候选 ${tried.length}/${fallback.length})`)
    i = 1
    // 上下文随迁(设计 D.3/D.4):fork 逐条克隆消息、只搬消息不复制 agent/model/权限,
    // 换模型续跑无需重做上下文。分叉源与重试环同一套「保住最值钱的会话」判据:失败会话
    // 本体(用量 > 0 才算,0 用量是纯报错桩)与链上原会话,取已积累用量大者。两条触发面
    // 的链状态形态不同,这套判据同时覆盖:不可重试类(quota/auth/rate)attempt 已把会话
    // 晋升到 chain.id、chain.failed 为空,选出的就是 chain.id(行为等价改造前);可重试类
    // 跑完阶梯回落到这里时,attempt 把 chain.id 还原成了下发前的原会话、真正攒着上下文的
    // 是 chain.failed,若不看它就会把 100k+ 产出扔掉去开白板会话。fork 成功即从副本续跑;
    // 都不可用则回退全新会话——切换仍生效,仅不继承上下文。
    const sources: { id: string; used: number; why: string }[] = []
    if (chain.failed && chain.failed.used > 0) sources.push({ ...chain.failed, why: "失败会话" })
    if (chain.id !== undefined && chain.id !== chain.failed?.id) sources.push({ id: chain.id, used: chain.used, why: "原会话" })
    chain.failed = undefined
    sources.sort((a, b) => b.used - a.used)
    for (const source of sources) {
      const forked = await forkSession(client, source.id, chain.subject ?? `${task.id} 降级`)
      if (forked === undefined) continue
      // chain.id 清空、改由 pending 承载分叉会话:note 非空 + chain.id 非空会命中
      // attempt 的「中断恢复(resumed)复用原会话」分支而忽略 pending,故此处必须清 id,
      // 让降级 note 随分叉副本会话下发(副本已含真实累计消息)。
      chain.id = undefined
      chain.pending = forked
      chain.pct = 100
      chain.used = source.used
      return true
    }
    if (sources.length) log(`↻ 降级 fork 副本失败,切换仍生效、回退空白新会话(不继承上下文)`)
    else log(`↻ 链上无会话上下文可继承,切换仍生效、开空白新会话`)
    chain.id = undefined
    chain.pct = 100
    return true
  }
  // 候选耗尽时追加到阻塞文案后的清单:已试候选 + 因窗口不足跳过的候选。
  const exhausted = () => `已用尽候选: ${tried.join(", ") || "无"}${clipped.length ? `;因上下文窗口不足跳过 ${clipped.join(", ")}` : ""}`
  for (;;) {
    const result = await attempt(client, task, promptText, opts, chain, steer, test, switches)
    const transient = result.type === "blocked" && result.question.startsWith("会话错误:")
    if (!transient) return result
    // P4 配额降级(设计 D.3):在下方「不可重试直接阻塞」之前插入一支——分类为
    // quota/auth/rate 且配置了候选表时,取下一候选(经 D.4 窗口钳制)、换 chain.model、
    // 复用既有 fork 副本路径续跑(上下文随迁)。候选表为空时整段跳过,行为逐字节等价
    // 现状(不变量 F:两变量未设 → 不进降级、不新增日志、不改文案、同阻塞路径)。
    // 判据取 result.errorClass(P3 三条触发面统一带来的归类):plain session.error 的
    // quota(isRetryable:false)与提前结算的 retry part / session.status retry 均带
    // errorClass,故据它决策即可覆盖两条路径(不读 result.failover)。
    const classZh =
      result.errorClass === "quota" ? "配额受限" : result.errorClass === "auth" ? "provider 鉴权失败" : result.errorClass === "rate" ? "限流等待过久" : undefined
    if (fallbackRing().length > 0 && classZh !== undefined) {
      if (await switchModel(classZh)) continue
      // 候选耗尽 → 回落阻塞(退出码语义不变,仍 blocked),文案追加候选清单。
      return { type: "blocked", question: `${result.question}\n(配额降级${exhausted()})`, retryable: result.retryable }
    }
    // 不可重试(isRetryable:false,如账号级限流): 换哪个会话都一样失败,直接
    // 阻塞——不进入下面的重试/fork 逻辑。attempt() 已保证 chain.id 落在这一轮
    // 实际用过的会话上(哪怕它就是刚失败的这个),真正有内容的会话不被牺牲。
    // (候选表为空时不可重试的 quota 落在此处,行为等价现状;候选表非空时上面的
    // 降级支已先行处理可降级类。)
    if (result.retryable === false) {
      log(`⛔ ${task.id} 遇到不可重试的会话错误(重试无意义),直接阻塞:\n${result.question}`)
      return result
    }
    // 阶梯耗尽: 先交人工裁决,再决定继续或退出(OPENCODE_AUTO_RETRY_ASK=0 关闭)。
    //
    // 为什么不直接退出: 优雅阻塞退出写的是 active=false 的恢复点,重跑明确不复用
    // 旧会话(resume.ts 的既定语义——人工介入可能耗时数小时且会改动环境,旧上下文
    // 不可信)。那条理由对真正的阻塞提问成立,对超时不成立: 人什么也没改,只是等。
    // 于是退出这条路恰好把上面刚保住的那个会话扔掉。留在进程里等,会话就还活着、
    // 还能继续 fork。
    if (i > waits.length) {
      const decision = await askRetry(switches.retryAsk, task, waits.length, result.question, opts.interactive, opts.dir)
      if (decision === "continue") {
        log(`↻ ${task.id} 人工选择继续,重试阶梯从头再走一轮`)
        i = 1
        continue
      }
      const why = decision === "exit" ? ",人工选择退出" : switches.retryAsk > 0 ? ",人工未裁决" : ""
      // 回落(无人应答/答非所问/retryAsk=0 的无人值守形态)接配额降级环:阶梯对
      // transient/unknown 已无计可施,但换一个 provider 仍可能跑通——与 quota 支同一段
      // 逻辑(tried 去重、窗口钳制、chain.model + 降级 note、fork 带上下文、i=1 重开阶
      // 梯)。人工明确答 exit 时不降级:那是「停下来」的指令,不是「再想想办法」。
      // 候选表为空时整段跳过,逐字节等价改造前(不变量 F)。
      // 作用域:chain 由 runTask 逐任务新建,chain.model 随之逐任务归零,下一个任务自动
      // 从首选模型重新起跑——「切备选仅在本次任务内有效」天然成立;更细/更粗的回试粒度
      // 由 OPENCODE_AUTO_MODEL_FAILBACK_SCOPE 在边界挂点消费(见 src/failback.ts)。
      if (decision === "fallback" && fallbackRing().length > 0) {
        if (await switchModel("重试阶梯耗尽")) continue
        return { type: "blocked", question: `${result.question}\n(自动重试 ${waits.length} 次仍失败${why};降级${exhausted()})` }
      }
      return { type: "blocked", question: `${result.question}\n(自动重试 ${waits.length} 次仍失败${why})` }
    }
    if (opts.server && NETWORK_FAILURE.test(result.question)) {
      await opts.server.restart("会话错误为网络/服务故障,重启 opencode server 后换新会话重试")
    }
    // 本次重试前的退避。计数在动作之前推进,下面三条 continue 路径共用 nth 作日志序号。
    const waitMinutes = waits[i - 1] ?? 0
    const nth = i++
    if (waitMinutes > 0) {
      log(`⏳ ${task.id} 遇到瞬时会话错误,等待 ${waitMinutes} 分钟后重试(${nth}/${waits.length}):\n${firstLine(result.question)}`)
      await Bun.sleep(waitMinutes * 60_000)
    }
    // 保住最值钱的会话再从它分叉: 候选为刚失败的会话本体与链上原会话(attempt()
    // 已把 chain.id 还原为下发前的原会话;复用轮里两者同一个,去重后只试一次),
    // 价值以"已积累的上下文用量"度量,取最大者,fork 失败再退而求其次;都不可用
    // 时依次回落 fork 基点(暖前缀,见下方 forkBase 分支)与空白新会话。
    //
    // 失败会话优先的理由: 超时/流中断类故障与会话内容无关(provider 侧停顿),
    // 会话里那 100k+ 已核实产出是本轮最值钱的资产,开空白会话等于把它扔掉、再从
    // 零撞同一堵墙——session-error-retry-plan.md 事实基线第 4 点记过这种"比完全不
    // 复用还差"的反例。代价是副本尾部带着那条 0-token 报错消息、重试提示词落在它
    // 后面;used 为 0 的失败会话则是纯报错桩(下发即失败,什么也没跑出来),没有
    // 值得保护的内容,不进候选(维持原设计判据)。
    //
    // 一律 fork 副本而非直接复用: 原会话不受影响,失败即弃,恢复点仍是原会话
    // (progress 的还原逻辑不动,见 attempt() 的可重试分支)。此处也不设
    // seedForkSession 的"用量达 cap/2 即冷启动"护栏——那道护栏防的是新子任务背上
    // 过大前缀,而重试是同一条提示词的续命,前缀大恰恰因为活干得多。
    const sources: { id: string; used: number; why: string }[] = []
    if (chain.failed && chain.failed.used > 0) sources.push({ ...chain.failed, why: "失败会话" })
    if (chain.id !== undefined && chain.id !== chain.failed?.id) sources.push({ id: chain.id, used: chain.used, why: "原会话" })
    chain.failed = undefined
    sources.sort((a, b) => b.used - a.used)
    let seeded = false
    for (const source of sources) {
      const forked = await forkSession(client, source.id, chain.subject ?? `${task.id} 重试`)
      if (forked === undefined) continue
      log(`↻ ${task.id} 遇到瞬时会话错误,从${source.why} ${source.id}(${formatTokens(source.used)} tokens)分叉副本重试(${nth}/${waits.length}):\n${result.question}`)
      chain.pending = forked
      chain.pct = 100
      chain.used = source.used
      seeded = true
      break
    }
    if (seeded) continue
    if (sources.length) log(`↻ fork 重试副本失败,回退分叉基点/空白新会话`)
    // 无会话可分叉(子任务的首条消息即失败,链上本就为空)但基点还在: 从基点重新
    // 播种,至少赚回免费的暖前缀,而不是纯冷启动——与 fork 三段式"每项重新从基点
    // 分叉"(fork-decompose 设计 §4.3)同一语义。基点失效则回落空白新会话。
    if (chain.id === undefined && chain.forkBase !== undefined && (await sessionAlive(client, chain.forkBase))) {
      const base: ForkBaseInfo = { id: chain.forkBase, used: await sessionUsed(client, chain.forkBase) }
      if (await seedForkSession(client, opts, chain, base, chain.subject ?? `${task.id} 重试`)) {
        log(`↻ ${task.id} 遇到瞬时会话错误,链上无会话可分叉,已从基点重新播种重试(${nth}/${waits.length}):\n${result.question}`)
        continue
      }
    }
    log(`↻ ${task.id} 遇到瞬时会话错误,换新会话重试(${nth}/${waits.length}):\n${result.question}`)
    // 重试保持"换新会话"语义,不复用出错的会话。
    chain.id = undefined
    chain.pct = 100
  }
}

// 阶梯耗尽后人工裁决的三态: continue = 再走一轮阶梯;exit = 立即阻塞退出;
// fallback = 无人应答/答非所问,按既定回落处理(本分支由配额降级环接管:配置了候选
// 表就切下一个候选模型继续,候选耗尽或未配置才阻塞,见 model-routing-design.md)。
export type RetryDecision = "continue" | "exit" | "fallback"

// 人工答复归一化(纯函数,导出供单测): 空答复、超时、stdin 关闭一律归 fallback,
// 使无人值守的跑批不会卡死也不会被静默放行。
export function retryDecision(answer: string | undefined): RetryDecision {
  const value = (answer ?? "").trim().toLowerCase()
  if (/^(c|continue|retry|y|yes|继续|重试)$/.test(value)) return "continue"
  if (/^(q|quit|exit|stop|n|no|退出|停止|停)$/.test(value)) return "exit"
  return "fallback"
}

// 阶梯耗尽的人工等待: minutes = 0 时不问、直接回落(无人值守跑批的既定形态)。
async function askRetry(minutes: number, task: Task, tries: number, question: string, interactive?: Interactive, dir?: string): Promise<RetryDecision> {
  if (minutes <= 0) return "fallback"
  log(`⏸ ${task.id} 自动重试 ${tries} 次仍失败,等待人工裁决(continue = 再试一轮,exit = 退出;${minutes} 分钟无应答按回落处理):\n${question}`)
  return retryDecision(await askHuman(minutes, "continue = 再试一轮,exit = 退出", interactive, dir))
}
