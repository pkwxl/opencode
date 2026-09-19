// 单次提示词下发的执行体: 会话复用判定与新建、模型 target 求值与下发、进度
// 恢复点写入、统计收段,以及把事件流订阅(watch)接上后等待会话自然结束;
// 代答台账的落账体 recordDriverResolves 只被本层调用,故一并归此。
// 位于 session.ts 之下(其 runSession 的重试/降级环逐次调用本函数),自身只
// 向下调用 watch / session-api / stats 等层;**不得反向 import session / runner**。
// 拆分自 src/runner.ts(plans/0024-module-split-plan.md S8,纯搬运)。

import { rm } from "node:fs/promises"
import { join, relative } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { resolveModel, roleOf, splitModel, REUSE_BELOW, REUSE_IDLE_MINUTES, REUSE_IDLE_MS, type SessionChain, type SessionResult } from "./chain"
import { failbackOverride, stickyModel } from "./failback"
import { commitTitle, unitBaseline } from "./git"
import { recallHandover, saveHandover, type Handover } from "./handover"
import { formatCost, formatDurationCompact, formatUsageLine, log, vlog } from "./log"
import { DEFAULT_CONTEXT_LIMIT, type Opts } from "./opts"
import { currentRound } from "./phases"
import { type Task } from "./plan"
import { handoffFile } from "./prompt"
import { recordResolves, type ResolveEvent } from "./resolve"
import { forgetProgress, peekProgress, saveProgress } from "./resume"
import { formatClientError, formatTokens, missingAgentHint, renameSession, serverDefaultModel, zeroUsage } from "./session-api"
import { statsSessionBegin, statsSessionEnd } from "./stats"
import { createStuckTracker } from "./stuck"
import { SWITCH_ENV, type Switches } from "./switches"
import { type Steer, type TestRun } from "./testrun"
import { strictResumeActive } from "./unit-commit"
import { watch } from "./watch"

// H3 的落账体: 回合内观测到的代答补上 task/phase/round/session 后落台账。无观测即
// 空转(不读轮号、不碰文件),故常见的"整轮无提问"路径零新增 IO。
async function recordDriverResolves(opts: Opts, taskID: string, events: ResolveEvent[] | undefined): Promise<void> {
  if (!opts.dir || !events?.length) return
  const round = await currentRound(opts.dir).catch(() => 0)
  await recordResolves(
    opts.dir,
    events.map((event) => ({
      at: event.at,
      task: taskID,
      phase: opts.phase ?? "",
      round,
      session: event.session,
      source: "driver" as const,
      question: event.question,
    })),
  )
}


export async function attempt(
  client: OpencodeClient,
  task: Task,
  promptText: string,
  opts: Opts,
  chain: SessionChain,
  steer: Steer | undefined,
  test: TestRun | undefined,
  switches: Switches,
): Promise<SessionResult> {
  // 测试执行协议: 清除上一会话/上次运行遗留的待执行脚本(存在即请求,中断
  // 恢复或重试场景下的旧请求不应注入本会话;归档历史 tmp/test.<n>.sh 保留)。
  if (test) await rm(join(test.tmp, "test.sh"), { force: true })
  const cap = opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT
  // 中断恢复接管的会话(链上有会话且恢复说明待注入): 首个提示词无条件进原会话
  // ——恢复语义即"接着被中断的那个会话继续",不受复用开关与阈值约束(与
  // seedForkSession 的"恢复续跑优先于分叉"同一判据)。说明用后即清,此后该链
  // 回归常规复用规则。分叉会话(pending)在场时让位: runSession 的重试环会同时
  // 挂上 note(重试说明)与 pending(失败会话的副本)且刻意不清 chain.id(下次
  // 重试仍从原会话重新 fork),此刻要接管的是副本而非复用原会话。
  const resumed = chain.id !== undefined && chain.note !== undefined && chain.pending === undefined
  // 链内复用受 OPENCODE_AUTO_REUSE_SESSION 管控(缺省 off): off 时任务内每个
  // 提示词都开新会话,阈值(占比/用量/闲置)不再参与决策。
  const reuseSession = switches.reuseSession
  const reuse =
    chain.id !== undefined &&
    (resumed ||
      (reuseSession && chain.pct < REUSE_BELOW && chain.used < cap / 2 && Date.now() - chain.at <= REUSE_IDLE_MS))
  // 测试交接判据的回落值(D1): 复用/恢复接管的会话起跑就背着链上已用量,首个
  // message.updated 到达前的测试请求照样要判得出来;fork 与全新会话归零——
  // chain.used 是上一个会话的残值,照搬会让刚起跑的小会话在首次测试就误判超限、
  // 白烧一次交接。
  if (test) test.startUsed = reuse ? chain.used : 0
  // 恢复接管的复用已由 runTask 的恢复日志交代(含继承的上下文用量),不重复打印。
  if (reuse && !resumed) {
    log(`♻ session reused (context ${chain.pct}%, used ${formatTokens(chain.used)} tokens, ended ${Math.round((Date.now() - chain.at) / 1000)}s ago)`)
  }
  if (!reuse && chain.id !== undefined) {
    const reason = !reuseSession
      ? `session reuse disabled (${SWITCH_ENV.reuseSession}=off, default)`
      : chain.pct >= REUSE_BELOW
        ? `context share ${chain.pct}% reached the ${REUSE_BELOW}% threshold`
        : chain.used >= cap / 2
          ? `used ${formatTokens(chain.used)} tokens reached the ${formatTokens(cap / 2)} cap (reuse threshold)`
          : `more than ${REUSE_IDLE_MINUTES} minutes since the last session ended (context stale)`
    // 复用关闭是缺省形态(链上每个会话都命中),只进明细日志;开启复用后的不
    // 复用原因是决策依据,照常上终端。
    if (reuseSession) log(`▷ ${reason}; starting a new session`)
    else vlog(`▷ ${reason}; starting a new session`)
  }
  // fork 预创建会话(seedForkSession 从基点分叉所得)在 !reuse 时优先于 create,
  // 消费即清——瞬时错误重试时 pending 已清,自然回落 create 路径(设计 §4.3)。
  const forked = reuse ? undefined : chain.pending
  chain.pending = undefined
  // 新会话前同步 AGENTS.md: 有更新则重启 server 再开新会话,使新会话加载最新
  // system context(AGENTS.md 每个 provider turn 现场重读,重启兜底缓存场景)。
  // 分叉会话已在 seedForkSession 分叉前同步过。
  if (!reuse && !forked) await opts.server?.syncAgents()
  // 显式标题: 新建会话直接以本阶段提交标题命名(短标签,如 `T-001 S2 编写 schema`),
  // 无提交标题的会话(dryrun 等)回落 `[auto] <任务>`;分叉会话已在 forkSession
  // 改名,不经 create。
  const session = reuse || forked ? undefined : await client.session.create({ title: chain.subject ? commitTitle(chain.subject) : `[auto] ${task.id} ${task.title}` })
  if (session?.error) return { type: "blocked", question: `session creation failed: ${formatClientError(session.error)}` }
  // failback 粒度 session(OPENCODE_AUTO_MODEL_FAILBACK_SCOPE): 每个全新会话起点
  // 都清链上降级候选、回试首选模型。仅 create 路径(会话复用与 fork 消费不动)——
  // 降级 fork 出的迁移会话经 pending 进入,若在此清零会把 failover 立即 undo 成震荡。
  if (session !== undefined && switches.modelFailbackScope === "session") chain.model = undefined
  const sessionID = forked ?? session?.data.id ?? chain.id!
  // 交互旁路: 此后人工输入发往本会话(审核/收尾等旁路会话同样覆盖)。
  opts.interactive?.attach(sessionID)
  // 测试交接中断恢复(§I): 交接收口后开出的续跑会话在此认领——它自己被打断时,
  // 下次运行从它分叉接回上下文。定版前的会话(记录里还留着待跑脚本与定版锚点)
  // 不认领,那一态的恢复靠定版点分叉。
  // 认领同样遵循「下发即写 + 失败还原」: 起跑即写(半途被 kill 也有锚点),但会话
  // 以 0-token 可重试错误收场时还原为认领前的记录——纯报错桩不配作恢复锚点,否则
  // 配额连败现场里最后一个 0-token 桩会顶掉真正有内容的续跑会话(2026-09-17
  // virtio T-005: 41.3k 会话的 nextSession 被重试 3 的 0-token 桩覆写),重启只能
  // fork 空壳。与 chain.failed 的更替 invariant 同一口径。
  let handoverClaimPrior: Handover | undefined
  if (test && opts.dir) {
    const inflight = await recallHandover(opts.dir, task.id, relative(test.dir, test.handoffFile))
    if (inflight && inflight.script === undefined && inflight.pinSession === undefined && inflight.nextSession !== sessionID) {
      handoverClaimPrior = inflight
      await saveHandover(opts.dir, { ...inflight, nextSession: sessionID })
    }
  }
  // 进度记录: 携带阶段的会话(执行链 + 阶段步骤旁路)写 active 记录,应用中断后
  // 据此精确恢复;无阶段的旁路会话(判定/审核/脚本生成/修复规划/dryrun/fork 基点)
  // 不写,避免污染恢复记忆。plans/0018-session-resume-precedence-design.md: 下发成功即落盘
  // 认领在跑的会话(此前只在回合结束后写,回合进行中被 kill 会丢失认领);可重试
  // 错误把记录还原为下发前快照,被弃的 fork 副本不顶替真实恢复点(保留
  // plans/0015-session-error-retry-plan.md 第 4 点的保护,改为"下发即写 + 失败还原")。
  // 本次提示词的生效模型(target 求值后回填,remember 写严格恢复记录用)。
  let promptModel: string | undefined
  const remember = async () => {
    if (opts.dir && chain.phase) {
      await saveProgress(opts.dir, {
        task: task.id,
        session: sessionID,
        at: Date.now(),
        active: true,
        phase: chain.phase,
        // 严格恢复(plans/0022-session-recovery-fidelity-design.md 3.1): active 记录随带单元
        // 基线与本次生效模型(恢复时核对;model 未配置路由时无串可记,严格恢复下
        // 该记录视为不可复用)。基线缺 thread 时以当前 HEAD 兜底(窗口从现在起)。
        ...(strictResumeActive(opts, switches)
          ? { baseline: chain.baseline ?? (await unitBaseline(opts.dir)), model: promptModel }
          : {}),
      })
    }
  }
  // 下发前的 progress.json 快照: 可重试错误时还原,防止被弃副本顶替真实恢复点。
  const prior = opts.dir && chain.phase ? await peekProgress(opts.dir) : undefined

  // SSE 订阅跟随本会话生命周期: 订阅时传入 AbortSignal,无论正常结束、下发失败
  // 提前返回还是异常退出,finally 都立即中止订阅,断开底层连接并释放客户端连接
  // 配额——此前订阅无人关闭、依赖 GC 回收,长周期运行下已结束会话的 SSE 长连接
  // 持续积压,占满客户端并发池(Bun 缺省 256 条)后,后续所有请求在池内无限排队
  // 且无超时报错,表现为无声卡死。
  const sse = new AbortController()
  // 同步 POST 的中止信号(H7): watch 判半开/断流等错误先于悬挂的 POST 返回时
  // 联动 abort——POST 立即作废不再悬挂到 TURN_TIMEOUT(2h),重试阶梯在探针判定
  // 时刻(~2×idleTime)即启动。
  const post = new AbortController()
  // 统计收段幂等守卫(STATS_PLAN §2,T-003): 正常路径在 await watching 后收段;
  // 下发失败/异常等未走到正常收段的路径由 finally 兜底——AI 段不悬挂。
  let booked = false
  // 死循环检测器(会话级,见 src/stuck.ts): 开关 off 时不建;dryrun 预检会话恒不建
  // ——它本就靠反复被拒探查权限,重复报错是其正常形态,不是死循环。
  const stuck = switches.stuck && !opts.dryrun ? createStuckTracker() : undefined
  try {
    const events = await client.event.subscribe(undefined, { signal: sse.signal })
    // 失联探针判半开等错误收场(session-boundary-hardening §4.4)先于悬挂的 POST
    // 返回时: 提前断流释放 SSE reader 与连接配额,并联动中止 POST(下方竞速不再
    // 等它,直接按本结果的会话错误收口)。对已中止的订阅重复 abort 无害;正常
    // 结束路径此处无 effect。
    let watchFailed = false
    const watching = watch(client, sessionID, events.stream, opts, steer, test, stuck, switches).then((w) => {
      if (w.error) {
        watchFailed = true
        sse.abort()
        post.abort()
      }
      return w
    })

    // 中断恢复等一次性说明随首个提示词带给 AI,用后即清。
    const note = chain.note
    chain.note = undefined
    // 本次模型(plans/0017-model-routing-design.md C.3/E): 优先级 链上降级候选 >
    // phase 粒度跨任务粘滞(sticky holder)> /failback 运行期覆写首选 > 路由表
    // (阶段字母 + 会话角色)。target 未定义时不带 model 键——两变量未设且无任何
    // 覆写时全链恒 undefined,逐字节等价现状(而非带 model: undefined)。
    const override = failbackOverride()
    const target = chain.model ?? stickyModel() ?? override?.wildcard ?? resolveModel(switches.model, opts.phase, roleOf(chain))
    promptModel = target
    // 实际使用模型上终端(前端可见): 每个新会话(新建/分叉,即 !reuse)都播报一行
    // (来源标注),模型较上次 prompt 有变化时亦播报;同会话同模型的续跑 prompt
    // (复用/恢复接管)不重复。target 未定义(未设路由)时回落服务端生效模型
    // (agent 配置 > 全局 config.model > provider 缺省,见 session-api.serverDefaultModel),
    // 仍取不到则静默;无论何种来源,prompt 是否带 model 键的决定不变(不变量 F 不破)。
    const shown = target ?? (await serverDefaultModel(client, opts.agent))
    if (shown !== undefined && (shown !== chain.modelShown || !reuse)) {
      const from =
        target === undefined
          ? "server default"
          : chain.model !== undefined
            ? "fallback candidate"
            : stickyModel() !== undefined
              ? "fallback candidate (sticky within phase)"
              : override !== undefined
                ? "/failback override"
                : "route"
      log(`◈ ${task.id} using model ${shown} (${from})`)
      chain.modelShown = shown
    }
    // 统计接线(STATS_PLAN §2,T-003): prompt 下发前开 AI 段并关联任务。旁路会话
    // (伪任务 PLAN/AUTO,恢复点先例见 resume.ts)同此照记——statsTask 未设当前任务
    // 时 usage/sessions 仍入 phase+round 桶。
    await statsSessionBegin(opts.dir, task.id)
    // 下发与事件流竞速(H7): 同步 POST 挂在半开连接上永不返回时,watch 的探针
    // 判定先回——watch 带错误先回即由哨兵 null 接管(POST 已被上方 post.abort()
    // 作废),不再等 POST 直接进下方 watching 的会话错误收口;watch 无错误则
    // 透传 POST 自身结果。竞速落败后 prompting 的迟到结果无人消费,挂 catch
    // 防未处理拒绝。
    const prompting = client.session.prompt(
      {
        sessionID,
        agent: opts.agent,
        ...(target ? { model: splitModel(target) } : {}),
        parts: [{ type: "text", text: note ? `${promptText}\n\n${note}` : promptText }],
      },
      { signal: post.signal },
    )
    prompting.catch(() => {})
    const prompt = await Promise.race([prompting, watching.then((w) => (w.error ? null : prompting))])
    // POST 因 watch 判错被联动中止时,其 error 只是 abort 回声,真实错误在
    // watching 里——跳过下发失败分支与认领,由下方会话错误收口处置(可重试
    // 分支会把进度记录还原为下发前快照)。
    const dispatchEcho = watchFailed
    if (prompt !== null && prompt.error && !dispatchEcho) {
      // 下发即失败: 刚认领的 nextSession 是什么都没收到的空会话,不配作恢复锚点
      // ——还原为认领前的记录(与下方 0-token 报错桩还原同一口径)。
      if (handoverClaimPrior && opts.dir) await saveHandover(opts.dir, handoverClaimPrior)
      await remember()
      return { type: "blocked", question: `task dispatch failed: ${formatClientError(prompt.error)}${await missingAgentHint(opts)}` }
    }
    // 下发成功即认领在跑的会话: 此刻进程被 kill/Ctrl+C,progress.json 指向本会话,
    // 下次运行复用之(精确恢复的核心——回合进行中的会话不丢)。回合结束后再按
    // 结果刷新或还原(见下方可重试错误分支)。
    if (prompt !== null && !dispatchEcho) await remember()

    const result = await watching
    // 并发态(OPENCODE_AUTO_HANDOVER_CONCURRENT=on)交接期测试的统一收口: watch
    // 起跑、这里等它落定——正常结束、会话错误、SSE 断流各路都经过此处,测试进程
    // 不会跨会话悬挂。结果写在 test.last 上,供新会话续跑提示引用。顺序态(缺省)
    // 此处恒空转,测试由 runExecSession 在提交 #2 之后执行。
    if (test?.running) {
      await test.running.catch(() => {})
      test.running = undefined
    }
    // 收段入账(T-003): usage 入 task/phase/round 三桶 + per-session;报告(report)
    // 由下方 ◉ 会话结束两行消费(累计用时/轮次/累计费用,STATS_PLAN §4.1)。
    const report = await statsSessionEnd(opts.dir, sessionID, result.usage ?? zeroUsage())
    booked = true
    // 代答落账(auto-resolve H3): 与 statsSessionEnd 同处收段——watch 侧只观测提问
    // 原文与会话 id,桶身份(任务/阶段/轮号)由此处补齐。旁路会话的伪任务
    // (PLAN/AUTO)照记,与统计同一口径。写失败在模块内静默,不影响回合结果。
    await recordDriverResolves(opts, task.id, result.resolves)
    // 本轮开始前的原链状态: 可重试的会话错误需要还原到这里(而不是留在这一轮
    // 刚失败的会话上),下一次重试才会从"从未被动过的原会话"重新 fork。
    const previousId = chain.id
    const previousUsed = chain.used
    const previousAt = chain.at
    chain.id = sessionID
    chain.pct = result.pct
    chain.used = result.used
    chain.at = Date.now()
    // ◉ 会话结束两行(STATS_PLAN §4.1,T-004): 无条件打印——所有经 attempt 的会话
    // (含 verify 判定/审核/阶段规划/交接蒸馏等旁路,复用会话同样打印)统一输出;
    // 行 1 上下文与用时,行 2 tokens 分项。省略规则: 单轮(session.rounds ≤ 1)
    // 省略"(累计…)";reasoning=0 省略思考项;cost=0 省略费用;命中率分母 0 显示 —
    // (formatCacheHit 口径)。report 仅 dir 缺失时为 undefined,按单轮处理,用时
    // 回落 watch 的 durationMs。下发失败在上方提前 return,不会走到这里。
    // AUTO-DECISION: 行 1 用时取 report.thisAiMs(纯 AI 时长口径)而非旧行的
    // watch durationMs(含会话内人工等待)——与同行"累计"(session.aiMs 累计)同基
    // 才有可比性,且符合"AI 用时排除 askHuman 挂起"的既定口径;旧行为只在无
    // stats 目录(dir undefined)时经回落保留。
    // AUTO-DECISION: 思考项插在"出"与"缓存读"之间(/ 思考 N)——计划草案未给出
    // reasoning>0 的示例位次,取与 Usage 分项声明序(input/output/reasoning/
    // cacheRead/cacheWrite)一致的位置;备选"行尾追加"会拆开缓存读/写相邻对,否决。
    // AUTO-DECISION: 本次 cost=0 但跨轮累计 >0 时仍按"cost=0 省略费用"整项省略
    // (不显示孤立的"(累计 $X)")——孤立累计无本次基数易误读,且逐字遵循既定省略
    // 规则;备选"省略本次保留累计"与规则文字冲突,否决。
    const usage = result.usage ?? zeroUsage()
    const rounds = report?.session.rounds ?? 1
    const since = rounds > 1 ? ` (cumulative ${formatDurationCompact(report!.session.aiMs)} / ${rounds} rounds)` : ""
    log(
      `◉ session ended: context ${chain.pct}% (${formatTokens(chain.used)}${result.limit ? `/${formatTokens(result.limit)} tokens` : " tokens"}), ` +
        `elapsed ${formatDurationCompact(report?.thisAiMs ?? result.durationMs ?? 0)}${since}`,
    )
    // 行 2 复用 log.ts 的 formatUsageLine(T-006 收口,任务/阶段/轮次结论行同格式);
    // 会话特有的费用跨轮累计作为后缀追加(仅本次费用显示且跨轮时,见上方
    // AUTO-DECISION: cost=0 整项省略,不出现孤立的"(累计 $X)")。
    const cost = formatCost(usage.cost)
    const costSince = cost && rounds > 1 ? formatCost(report!.session.usage.cost) : undefined
    log(formatUsageLine(usage) + (costSince ? ` (cumulative ${costSince})` : ""))
    // 进度改名: 复用会话的标题停留在旧阶段,结束时改名为本阶段提交标题,使标题
    // 前缀始终反映会话的最新进度(`T-001 S1 …` → `T-001 S2 …` → `T-001 wrapup …`);
    // 新建会话已在创建时命名,无需重复。
    if (reuse && chain.subject) await renameSession(client, chain, chain.subject)
    // 可重试的会话错误(plans/0015-session-error-retry-plan.md): 半截失败态——链状态与
    // progress.json 一并还原为本轮下发前的原会话/原记录,被弃的 fork 副本不顶替
    // 真实恢复点,交给 runSession 的重试循环从原会话重新 fork。不可重试的会话
    // 错误、非会话错误类阻塞与成功一律"晋升":chain.id 落在这一轮实际用过的会话
    // 上并刷新 progress.json(会话结束但阶段尚未推进时,保持 active——此刻中断
    // 按"半途未总结"复用本会话继续,无时间窗,恢复时只看会话是否存活;子任务间歇
    // 的窗口由 pipeline 在勾选+提交后经 persistStage 主动收口为总结态)。唯一例外
    // 是测试交接收场——会话以交接文档收尾,任务已告完成,不认领(见下方分支)。
    if (result.error && result.retryable !== false) {
      chain.id = previousId
      chain.used = previousUsed
      chain.at = previousAt
      // 链状态还原,但失败会话本身留给重试环作首选分叉源(见 FailedSession)。
      // 0-token 的失败是纯报错桩(下发即失败,什么也没跑出来),不顶替链上仍有效
      // 的有内容记录——否则下一轮重试将丢失最有价值的分叉源(2026-09-17 现场:
      // 41.3k 失败会话被其 0-token fork 副本顶替,后续重试退化为基点冷播种);
      // used > 0 的失败则是旧记录的严格超集(fork 副本带着旧前缀又跑出了新内容),
      // 正常顶替。
      if (result.used > 0 || chain.failed === undefined) chain.failed = { id: sessionID, used: result.used }
      // 0-token 桩同时撤回对 handover.json nextSession 的认领(恢复锚点回到上一个
      // 有内容的续跑会话);used > 0 的失败保留认领——该会话是旧锚点的严格超集。
      if (result.used === 0 && handoverClaimPrior && opts.dir) await saveHandover(opts.dir, handoverClaimPrior)
      if (opts.dir && chain.phase) {
        if (prior) await saveProgress(opts.dir, prior)
        else await forgetProgress(opts.dir)
      }
    } else {
      chain.failed = undefined
      // 0-token 还原对不可重试错误同样适用(§J.3 只覆盖可重试分支的补齐):
      // 首发即死的报错桩(会话里只有一条用户消息、没有任何产出)不配作恢复锚点。
      if (result.error && result.used === 0 && handoverClaimPrior && opts.dir) await saveHandover(opts.dir, handoverClaimPrior)
      // 测试交接收场(testhandoff.md 写出 `状态: 继续`): 该会话的任务即告完成,作为
      // 重启复用/重试分叉的锚点一并丢弃——链 id 清空(此后续跑会话出错,重试分叉源
      // 只剩续跑谱系 chain.failed,不再可能 fork 回上下文已用满的定版前旧会话);
      // progress 同步转「无会话在途态」: session 丢弃(下次运行无会话可复用,恢复经
      // .auto/handover.json 的 nextSession/定版锚点接回交接**之后**的会话),active
      // 保留(单元仍在途: 恢复续跑的 clean 豁免与交接文档保留依赖它)。此前的行为是
      // 照常 remember() 认领定版会话——续跑会话随后遇可重试错误会把这份陈旧认领还原
      // 成 progress.json,程序退出后再运行即复用/分叉到交接之前的会话(2026-09-16 修)。
      if (result.testHandover) {
        chain.id = undefined
        if (opts.dir && chain.phase) {
          await saveProgress(opts.dir, { task: task.id, session: undefined, at: Date.now(), active: true, phase: chain.phase })
        }
      } else {
        await remember()
      }
    }
    if (result.blocked) {
      // 严格恢复的测试交接写核失败(3.3): 折成 rollback 标记上抛,单元所有者
      // (executeWhole/runSubtask)据此回滚重做;无基线的调用方按普通阻塞处理。
      return result.testHandoverInvalid ? { ...result.blocked, rollback: true } : result.blocked
    }
    if (result.error)
      return { type: "blocked", question: `session error: ${result.error}`, retryable: result.retryable, errorClass: result.errorClass, failover: result.failover }
    return { type: "idle", lastText: result.lastText, testHandover: result.testHandover }
  } finally {
    // 统计兜底(T-003): 下发失败/异常等未走正常收段的路径同样收段——无配对 begin
    // 时 thisAiMs=0、usage 零值照记(stats.ts 既有语义,消耗真实发生不虚构)。
    if (!booked) await statsSessionEnd(opts.dir, sessionID, zeroUsage())
    // 显式断流: 中止信号会取消 SSE 底层 reader 并退出其重连循环,连接配额即时
    // 释放(对已结束的订阅重复中止无害);POST 信号兜底——异常退出等路径上仍在
    // 途的下发一并作废。
    sse.abort()
    post.abort()
    vlog(`▪ unsubscribed from the event stream of session ${sessionID}`)
  }
}
