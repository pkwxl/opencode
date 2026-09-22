// 单次会话的事件流订阅与实时处置: 消费统一事件流(AgentEvent,MA.3 plans/0039;
// opencode SSE 的映射在 agent/opencode/events.ts),做终端回显、
// 上下文用量跟踪与交接 steer 插入、死循环提示、代答采集(AUTO-RESOLVE /
// AUTO-DECISION)、测试请求的发起与收口、会话错误信号的归类上报;在途失联探针
// (plans/0026-session-boundary-hardening-design.md D3/§4.4)周期探测会话活性,两连败判半开
// 并收口为可重试会话错误。
// 位于 session.ts 之下(其 attempt 起订阅后 await 本函数),自身只向下调用
// testrun / unit-commit / session-api 等层;**不得反向 import session / runner**。
// 拆分自 src/runner.ts(plans/0024-module-split-plan.md S7,纯搬运)。

import { join, relative } from "node:path"
import type { AgentClient, AgentEvent } from "./agent/types"
import { classifySessionError, type ErrorInfo, type Watch } from "./chain"
import { afterSession, autoAnswer, commitBlocked, strictResumeActive } from "./unit-commit"
import { suffixedTitle } from "./git"
import { handoffComplete, saveHandover } from "./handover"
import { log, vlog } from "./log"
import type { Opts } from "./opts"
import { handoffFile, renderStuckHint, renderTestWrapup, renderTestResult } from "./prompt"
import { compactText, sameIssue, type ResolveEvent } from "./resolve"
import { askHuman, describePart, formatClientError, formatTokens, isApproval, probeSession } from "./session-api"
import type { Usage } from "./stats"
import { STUCK_MAX_HINTS, type StuckTracker } from "./stuck"
import { autoSwitches, type Switches } from "./switches"
import { executeTest, resolveTestScript, type Steer, type TestRun } from "./testrun"
import { steerDue, testHandoverDue, usageSource } from "./usage"

// 失联探针参数(plans/0026-session-boundary-hardening-design.md D3): 周期缺省复用 idleTime
// (10 分钟,与脚本看门狗同键同缺省,config.idleTime);**连续 2 次**未通才判半开
// ——排除服务端瞬时抖动(GC 停顿等)造成的误判。单次探测的短超时(30 秒)见
// session-api 的 PROBE_TIMEOUT_MS。
const PROBE_INTERVAL_MS = 10 * 60_000
const PROBE_MAX_FAILURES = 2

// 输出截断续跑(2026-09-18,kernel-spi-nor T-030 S13 现场): 末步 step-finish 以
// length 收场 = 模型回复被输出上限截断(推理流中段切断),服务端照常 idle——这不是
// 自然结束,会话工作显然未完。此时 steer 一句「从截断处继续」让原会话接着做(上下文
// 一分不丢),而不是按自然结束收口去走形检/勾选、再开空白会话重读全场。连续截断以
// 3 次为限(防单条消息过长的退化形态空转),超限仍按自然结束收口,由既有产物形检环
// 兜住;出现非 length 的步骤收场(续跑后恢复正常工作)即重置计数。
const LENGTH_CONTINUE_MAX = 3

export async function watch(
  client: AgentClient,
  sessionID: string,
  stream: AsyncIterable<AgentEvent>,
  opts: Opts,
  steer?: Steer,
  test?: TestRun,
  stuck?: StuckTracker,
  // 严格恢复门禁(交接边界写核)取本次运行的开关;缺省取 OPENCODE_AUTO_* 解析值,
  // 注入供单测(attempt 透传其自身持有的 switches)。
  switches: Switches = autoSwitches(),
 ): Promise<Watch> {
   const waitAnswer = opts.waitAnswer ?? 0
   let lastText = ""
   let error = ""
   // 会话错误是否可重试(plans/0015-session-error-retry-plan.md): 只有 ApiError 携带
   // isRetryable,其余错误类型没有该字段,缺省按可重试处理(undefined)。
   let retryable: boolean | undefined = undefined
   // 结构化错误累加器(plans/0017-model-routing-design.md D.2): 三条触发面(session.error、
   // retry part、session.status retry)增量合并 message/statusCode/isRetryable/
   // responseBody(+attempt/next),既供分类又随错误结果上报;undefined 表示本回合
   // 未收到任何结构化错误信号。
   let errorInfo: ErrorInfo | undefined = undefined
   // 上下文占比与已用量始终跟踪(会话复用决策依据);拿不到上限记 100。
   // The figure comes from the usage source of the adapter's tier (plans/0038):
   // `used` mirrors it at each measurement point (a completed assistant
   // message) and stays 0 while it is unknown, as before MA.3.
   const tier = client.capabilities.usage
   const source = usageSource(tier)
   let pct = 100
   let used = 0
   let limit: number | undefined = undefined
  // 会话开始时间戳,用于计算耗时
  const startTime = Date.now()
  // token 增量累加(STATS_PLAN §2,T-003): 逐 step-finish part 按 part.id 去重累加
  // (SSE 重发同一 part 的更新事件不重计);跨会话串话由事件循环内 sessionID 守卫排除。
  const usage: Usage = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 }
  const billedSteps = new Set<string>()
  // 本回合的代答观测(auto-resolve H1): 仅"无人工答复的回落自动答复"入列——
  // --wait-answer 下人工真答了的是真人决定,dryrun 预检只探查权限,两者都不是代答。
  const resolves: ResolveEvent[] = []
  // 回合快照(STATS_PLAN §2): watch 的全部 return 出口统一带 durationMs + usage +
  // resolves,error/blocked 提前结算口同样带——消耗与代答都真实发生,不丢。extra 为
  // 各出口差异字段。
  const snapshot = (extra?: Partial<Watch>): Watch => ({
    lastText,
    pct,
    used,
    limit,
    durationMs: Date.now() - startTime,
    usage,
    resolves,
    ...(steerSent ? { hinted: true } : {}),
    ...extra,
  })
  // steer 每会话只插入一次。
  let steerSent = false
  // 自动答复过的问题(同一问题重复出现仍阻塞停机)。
  const autoAnswered: string[] = []
  // --test-by-driver 测试执行协议状态: 会话 idle 时检测 tmp/test.sh(请求标记,
  // 内容为 test/ 下脚本路径或内联脚本)→ 运行该脚本 → steer 结果回本会话继续
  // 观察;--handover-test 在测试失败且 used 达上限时改为要求写交接文档,文档
  // 就绪后正常结束(testHandover)。
  let testHandover = false
  let testHandoverAsked = test?.resumeWrapup === true
  let testHandoverRetried = false
  // 本会话事件流里观测到的末条消息 id(测试交接中断恢复 §I): 定版那一刻把它记进
  // 在途交接记录,收尾没写完就被打断时据此从定版点 fork 出新会话重做收尾。纯观测,
  // 不额外发请求。
  let lastMessage: string | undefined
  // 回合结束服务端连发两个 idle 事件(session.status idle + session.idle);steer
  // 经 promptAsync 投递即返回后,第二个 idle 会在 steer 回合启动前到达,照处理
  // 会误判会话结束提前 break。处理过一次 idle 后忽略后续 idle,直到本会话出现
  // 新的会话事件(新回合开始)再重新接受。
  let idleHandled = false
  // 会话经 idle 事件正常结算才置位;事件流未收 idle 即耗尽(SSE 断流: server 崩溃
  // 或网络断开)时按会话错误处理,不作正常结束——否则 driver 会误勾选子任务、把
  // 中断会话当已完成推进流水线。
  let settled = false
  // steer 投递用 promptAsync(投递即返回):v2 同步 /message 端点会阻塞到它启动的
  // 整个回合结束,在事件循环内同步等待会卡死事件循环(事件堆积、提问/权限无人
  // 应答)。投递失败记 log 并返回 false,调用方按隐性阻塞处理,不再静默空等。
  const steerText = async (text: string): Promise<boolean> => {
    source.prompt(text)
    const sent = await client.promptAsync({ session: sessionID, text })
    if (sent.ok) return true
    log(`⚠ steer dispatch failed: ${formatClientError(sent.error)}`)
    return false
  }
  const handleIdleTest = async (): Promise<{ type: "continue" } | { type: "break" } | { type: "blocked"; question: string } | { type: "invalid" }> => {
    // 交接要求已发出: 校验交接文档写完了(F1,末行 `Status: continue|done`)。判据由
    // "非空"收紧为状态行,是为了让中断恢复分得清"会话写完了"与"driver 死在会话
    // 写文件途中的半截文件"——后者要重做收尾,不能当成交接完成往下走。
    if (testHandoverAsked) {
      const doc = await Bun.file(test!.handoffFile).text().catch(() => "")
      if (handoffComplete(doc, false)) {
        testHandover = true
        return { type: "break" }
      }
      // 交接边界写核(plans/0022-session-recovery-fidelity-design.md 3.3,严格恢复): 文档无效
      // 一次即判,不再 steer 补写重试——"完成判定不靠 agent 自报"同样适用于交接
      // 文档(S07 幻影档实证),发现时机就在交接边界。
      if (strictResumeActive(opts, switches)) {
        return { type: "invalid" }
      }
      if (testHandoverRetried) {
        return {
          type: "blocked",
          question:
            `the test-handover session failed twice to produce a valid ${test!.handoffFile} (missing, or lacking a \`Status: continue|done\` status line; hidden blockage). ` +
            `Check the file and re-run. Last agent output:\n${lastText.trim().slice(-2000) || "(no output)"}`,
        }
      }
      testHandoverRetried = true
      const ok = await steerText(
        `You ended the session last time without writing a valid ${test!.handoffFile} (missing, or lacking the \`Status: continue|done\` status line). This is a hard requirement: ` +
          `write the progress, key decisions, failing-test context and next steps into that file, put the status line on the last line, and only then end the session.`,
      )
      if (!ok) return { type: "blocked", question: `steer dispatch failed (asking to backfill ${test!.handoffFile}); cannot continue the session, see the log.` }
      return { type: "continue" }
    }
    const pending = join(test!.tmp, "test.sh")
    if (!(await Bun.file(pending).exists())) return { type: "break" }
    // 交接判定就在这一刻(D1),先于执行——判据已与测试成败解耦。命中时 driver
    // 先提交定版、把脚本定下来,再下发收尾+交接指令;测试何时跑由
    // OPENCODE_AUTO_HANDOVER_CONCURRENT 决定(缺省顺序,见 E1/E2)。
    const now = source.used()
    if (testHandoverDue(test!, now)) {
      testHandoverAsked = true
      const n = test!.handovers + 1
      log(
        `⚠ ${test!.label} context used ${formatTokens(now !== undefined && now > 0 ? now : test!.startUsed)} tokens reached the ${formatTokens(test!.limit)} cap; ` +
          (switches.handoverConcurrent
            ? `tests run concurrently with the session wrapup after the frozen commit; asking for a handover document before switching to a new session`
            : `after the frozen commit, hand over first and then run the tests; asking for a handover document before switching to a new session`),
      )
      // 提交 #1(定版): 固定被测的脚本与源码。此刻会话处于 idle(本函数由 idle
      // 事件驱动),没有半写文件,是唯一安全的 mid-session 提交时点;走
      // afterSession 而非裸 commitTree,使代答采集与引用订正落在定版之内——
      // 订正会改文件,必须先于测试启动,三者才是同一份快照。单元尚未收口,
      // 不传 baseline。
      const pinSubject = suffixedTitle(test!.subject, `test handover #${n} freeze`)
      const pin = await afterSession(test!.dir, opts, test!.task, { stage: `${test!.unit} handoff-${n}-pin`, subject: pinSubject })
      if (pin.type === "failed") {
        return { type: "blocked", question: commitBlocked(pinSubject, pin).question }
      }
      // 顺序态(缺省): 只消费请求标记、把脚本定下来,执行推迟到交接收口之后
      // (runExecSession 的 test.pending),收尾期因此没有任何并发写。
      // 并发态: 不 await 即起跑,收口由 attempt 在 watch 返回后统一做(test.running),
      // 覆盖正常结束/会话错误/断流各路;代价是测试面对的是定版快照而非最终树。
      if (switches.handoverConcurrent) test!.running = executeTest(test!, opts)
      else test!.pending = await resolveTestScript(test!)
      // 在途交接记录(中断恢复 §I): 定版已落账、收尾还没开始的这一刻是记录的
      // 唯一正确时点——待跑脚本刚消费出来(标记已被拿走,重新运行再也读不到),
      // 会话锚点还没被收尾的那些消息盖过。并发态无待跑脚本可记(定版即起跑),
      // 记录仍写,恢复时退化为引用最近一次测试输出。
      await saveHandover(test!.dir, {
        task: test!.task.id,
        scope: relative(test!.dir, test!.handoffFile),
        unit: test!.unit,
        n,
        script: test!.pending?.script,
        seq: test!.pending?.seq,
        pinSession: sessionID,
        pinMessage: lastMessage,
      })
      const ok = await steerText(renderTestWrapup({ handoffFile: test!.handoffFile }))
      if (!ok) return { type: "blocked", question: "steer dispatch failed (test-handover request); cannot continue the session, see the log." }
      // 收尾要求已生效,播种 resumeWrapup: testHandoverAsked 是本 watch 实例的状态,
      // 收尾途中会话出错被 runSession 重试环/降级环 fork 续跑时,新 attempt 建新
      // watch 实例——没有这面旗标,新实例会把「收尾完成」误判为自然结束,交接循环
      // 就此丢失(定版脚本永不执行、交接文档永不归档)。跨进程中断的同款播种在
      // exec-session 的 H1 分支;收口后由 runExecSession 在每次 runSession 返回后清零。
      test!.resumeWrapup = true
      return { type: "continue" }
    }
    // 归档(存在即请求的协议标记,执行后移除以便再次请求)→ 执行 → 反馈。
    const run = await executeTest(test!, opts)
    const ok = await steerText(renderTestResult(run))
    if (!ok) return { type: "blocked", question: "steer dispatch failed (test result feedback); cannot continue the session, see the log." }
    return { type: "continue" }
  }
  // 已记录的 part 与 message,避免同一 part 的多次更新事件重复输出。
  const seen = new Set<string>()
  // 本会话最近一个 step-finish 的收场原因(截断续跑判据,见 LENGTH_CONTINUE_MAX):
  // "length" = 回复被输出上限截断。已观测到 session.error 时禁用续跑——错误路径
  // (可重试阶梯/降级环)优先,不与截断续跑争抢会话。
  let lastFinish: string | undefined
  let lengthContinued = 0
  // 模型上下文上限(model string → window),首次需要时拉取。
  let limits: ReadonlyMap<string, number> | undefined
  // 在途失联探针(D3/§4.4): watching 期间每 idleTime 经独立短超时连接 GET 会话
  // 元信息;连续 PROBE_MAX_FAILURES 次未通即判半开——记日志、trip 抢占事件等待,
  // 收口处 abort 会话并按可重试会话错误返回(transient 归类,走既有重试阶梯与
  // 降级环;新连接 fork 续跑)。探针成功即重置计数。attempt 在 prompt 下发前就启动
  // 本函数,探针因此覆盖 POST 在途窗口;定时器随全部出口在下方生成器 finally 清理。
  let probeFailures = 0
  let halfOpen = false
  // 探针链活跃标记: watch 收口(生成器 finally)后,在途 probe 的迟到回调不得再
  // 续排定时器。
  let probeActive = true
  let probeTimer: ReturnType<typeof setTimeout> | undefined
  // 探针判半开时抢占事件等待: 半开场景流上再无事件,对原流 for-await 会永远阻塞
  // 在 next() 上,探针结果无从生效——故事件流套一层与 trip 竞速的迭代包装。
  let trip!: () => void
  const tripped = new Promise<void>((resolve) => (trip = resolve))
  const scheduleProbe = () => {
    probeTimer = setTimeout(() => {
      probeTimer = undefined
      void (async () => {
        const ok = await probeSession(client, sessionID)
        if (!probeActive || halfOpen) return
        if (ok) {
          probeFailures = 0
        } else {
          probeFailures += 1
          log(`⚠ connectivity probe failure ${probeFailures}/${PROBE_MAX_FAILURES} (session ${sessionID}); connection suspected half-open`)
          if (probeFailures >= PROBE_MAX_FAILURES) {
            halfOpen = true
            trip()
            return
          }
        }
        scheduleProbe()
      })()
    }, opts.idleMs ?? PROBE_INTERVAL_MS)
  }
  scheduleProbe()
  const raced = (async function* () {
    const inner = stream[Symbol.asyncIterator]()
    try {
      for (;;) {
        const step = await Promise.race([inner.next(), tripped.then((): IteratorResult<AgentEvent> => ({ done: true, value: undefined }))])
        if (step.done) return
        yield step.value
      }
    } finally {
      probeActive = false
      if (probeTimer !== undefined) clearTimeout(probeTimer)
      // 本生成器只可能悬挂在 yield 上被消费方收尾(return 立即进 finally),清理
      // 无时延。半开抢占出口内层留有悬挂的 next()(旧连接永不兑现),return() 会
      // 排在它后面一并等死——跳过,由 attempt 的 sse.abort() 取消底层 reader 收尾;
      // 其余出口无悬挂 next(),return() 促走内层 finally(释放 reader 锁),与裸
      // for-await 行为一致。
      if (!halfOpen) await inner.return?.().catch(() => {})
    }
  })()
  for await (const event of raced) {
    if (event.session !== sessionID) continue
    source.observe(event)
    if (event.type === "part") {
      const part = event.part
      idleHandled = false
      // step-finish 增量累加(T-003,唯一不重不漏口径): 同 part 重发不重计。
      if (part.kind === "step-finish") {
        // 截断续跑判据(与计费去重无关,重发事件覆写同值无害): 非 length 收场
        // (续跑后恢复正常工作)重置连续截断计数。
        lastFinish = part.reason
        if (part.reason !== "length") lengthContinued = 0
        if (!billedSteps.has(part.id)) {
          billedSteps.add(part.id)
          usage.input += part.tokens.input
          usage.output += part.tokens.output
          usage.reasoning += part.tokens.reasoning
          usage.cacheRead += part.tokens.cacheRead
          usage.cacheWrite += part.tokens.cacheWrite
          usage.cost += part.cost
          usage.steps += 1
        }
      }
      if (part.kind === "text") {
        if (part.final) {
          lastText = part.text
          vlog(part.text)
        }
        continue
      }
      const line = describePart(part)
      if (line && !seen.has(part.id)) {
        seen.add(part.id)
        vlog(line)
        // 死循环检测(src/stuck.ts): 工具调用的终态逐个喂给检测器,识别到"重复
        // 同一动作且结果不变"即经 steer 主动注入提示,帮能力较弱的模型跳出空转。
        // 只提示不中止会话;投递失败已由 steerText 记日志,照常继续观察。
        if (stuck && part.kind === "tool" && (part.status === "completed" || part.status === "error")) {
          const hit = stuck.observe({
            tool: part.tool,
            input: part.input,
            status: part.status,
            result: (part.status === "error" ? part.error : part.output) ?? "",
          })
          if (hit) {
            log(
              `⚠ repetitive action detected: ${hit.tool} has ${hit.count} consecutive ${hit.kind === "error" ? "identical errors" : "identical calls with identical results"}; ` +
                `inserting a hint (level ${hit.level}/${STUCK_MAX_HINTS})`,
            )
            await steerText(renderStuckHint(hit))
          }
        }
      }
      continue
    }
    if (event.type === "message") {
      const info = event.message
      idleHandled = false
      lastMessage = info.id
      if (info.role !== "assistant" || !info.completed || seen.has(info.id)) continue
      seen.add(info.id)
      // Measurement point: the usage source already took this message in
      // (events/reported: its own figure; estimated: the running estimate).
      // An unknown figure (none, or none measured yet) changes nothing.
      const now = source.used()
      if (now === undefined) continue
      limits ??= await client.contextLimits()
      used = now
      limit = info.model !== undefined ? limits.get(info.model) : undefined
      pct = limit ? Math.round((used / limit) * 100) : 100
      vlog(`  context: ${formatTokens(used)}${limit ? `/${formatTokens(limit)}` : ""} tokens${limit ? ` (${pct}%)` : ""}`)
      if (steer && !steerSent && steerDue(tier, now, steer.limit)) {
        steerSent = true
        log(`⚠ context used ${formatTokens(used)} tokens reached the ${formatTokens(steer.limit)} cap; inserting a handover hint`)
        const ok = await steerText(steer.text)
        if (!ok) {
          return snapshot({
            blocked: { type: "blocked", question: "steer dispatch failed (handover hint); cannot continue the session, see the log." },
          })
        }
      }
      continue
    }
    if (event.type === "question") {
      const text = event.questions.join("\n")
      // dryrun 预检会话一律自动答复,不因提问阻塞。
      const permission = opts.dryrun ? false : /权限|permission/i.test(text)
      const repeated = autoAnswered.some((prev) => sameIssue(prev, text))
      // 权限与非权限提问在 --wait-answer 下都先等人工答复,超时一律回落
      // autoAnswer 让 AI 自主决策继续;仅缺省 --wait-answer 时的权限提问
      // 直接阻塞(无人值守时不能替人工决定是否授权)。
      if (!repeated && (!permission || waitAnswer > 0)) {
        autoAnswered.push(text)
        log(`❓ received a ${permission ? "permission" : "non-permission"} question:\n${text}`)
        const human = waitAnswer > 0 ? await askHuman(waitAnswer, "auto-answered on timeout", opts.interactive, opts.dir) : undefined
        const ask = autoSwitches().ask
        const fallback = autoAnswer(ask)
        const reply = human ?? fallback
        // 代答观测(auto-resolve H1,plans/0020-auto-resolve-design.md §G/§H-①): 仅回落
        // 自动答复才计——人工答了是真人做的决定,dryrun 预检不产生工程决策。回落时
        // 把原 `→ 自动答复: <长文案>` 换成两行高亮式(答复全文降为明细日志),
        // 让"driver 替用户做了主"在会话日志里一眼可见、事后可数。
        if (human) log(`→ human answer: ${human}`)
        else if (opts.dryrun) log(`→ auto answer: ${fallback}`)
        else {
          resolves.push({ at: Date.now(), question: text, session: sessionID })
          log(`⚑ auto-answer (AUTO-RESOLVE) #${resolves.length}: ${compactText(text)}`)
          log(`  → answered; ${ask ? "the driver recorded it in full; this mode does not require the session to label it separately" : "asking the session to label the decision with AUTO-RESOLVE"}`)
          vlog(`  answer content: ${fallback}`)
        }
        await client.replyQuestion(event.request, event.questions.map(() => [reply]))
        continue
      }
      await client.rejectQuestion(event.request)
      await client.abort(sessionID)
      return snapshot({
        blocked: {
          type: "blocked",
          question: permission ? text : `asked again about the same question after auto-answer; handle it manually outside the session, then re-run:\n${text}`,
        },
      })
    }
    if (event.type === "permission") {
      // dryrun 预检: 自动拒绝但不中断会话,让 AI 记录受阻项后继续探查下一项。
      if (opts.dryrun) {
        log(`🔐 preflight probe denied (recorded in the report): ${event.permission} (${event.patterns.join(", ")})`)
        await client.replyPermission(event.request, "reject")
        continue
      }
      const desc = `${event.permission} (${event.patterns.join(", ")})`
      const mode = opts.permission ?? "ask-deny"
      // auto-allow: 不等待人工,立即自动授权(always 放行本请求)。
      if (mode === "auto-allow") {
        log(`🔐 permission request received; auto-allowed via --permission auto-allow: ${desc}`)
        await client.replyPermission(event.request, "always")
        continue
      }
      // ask-*: 先等人工(--wait-answer 分钟,未设则不等待即视为超时)。回答
      // allow/yes/y 等视为确认授权(always 放行);明确的其余回答拒绝该权限但
      // 不中断会话,AI 在无该权限下绕开继续;超时按模式回落——ask-allow 自动
      // 授权、ask-deny 自动拒绝但会话继续、ask-fail 拒绝并退出运行。
      let human: string | undefined
      if (waitAnswer > 0) {
        log(`🔐 permission request received: ${desc}`)
        human = await askHuman(
          waitAnswer,
          `enter allow/yes/y to approve; any other answer denies the permission and continues; on timeout handled as --permission ${mode}`,
          opts.interactive,
          opts.dir,
        )
      } else {
        log(`🔐 permission request received (--wait-answer unset, not waiting for a human; handled as --permission ${mode}): ${desc}`)
      }
      if (human && isApproval(human)) {
        log(`→ human allowed: ${human} (always)`)
        await client.replyPermission(event.request, "always")
        continue
      }
      if (human) {
        log(`→ human denied: ${human} (permission denied; the AI continues without it)`)
        await client.replyPermission(event.request, "reject")
        continue
      }
      if (mode === "ask-allow") {
        log(`→ wait timed out; --permission ask-allow auto-allowed: ${desc}`)
        await client.replyPermission(event.request, "always")
        continue
      }
      await client.replyPermission(event.request, "reject")
      if (mode === "ask-deny") {
        log(`→ wait timed out; --permission ask-deny auto-denied (the AI continues without it): ${desc}`)
        continue
      }
      // ask-fail: 拒绝并退出运行(阻塞停机,问题记入运行日志)。
      await client.abort(sessionID)
      return snapshot({
        blocked: {
          type: "blocked",
          question: `permission request unanswered (--permission ask-fail): ${desc}. Allow it in the permission rules of the target directory's opencode.json, then re-run.`,
        },
      })
    }
    if (event.type === "error") {
      const e = event.error
      idleHandled = false
      const errName = e.name ?? ""
      const detail = e.message ?? errName
      error = error ? `${error}\n${detail}` : detail
      // 悲观口径: 一旦某次会话错误明确带 isRetryable:false(账号级限流等,
      // 换会话/换新会话都一样失败),整轮就判定为不可重试,不因后续事件回撤。
      if (e.isRetryable === false) retryable = false
      // D.2 触发面 1:除 message/retryable 外把结构化字段带进 errorInfo 供分类与上报
      // (Watch 加 errorInfo?,retryable? 是同类先例)。**不改变控制流**——此路径绝不做
      // failover 提前结算,只让现有错误路径把分类带上行下效。错误名(APIError/
      // ProviderAuthError/ContextOverflowError/…)折进 message,使分类器能据名识别
      // overflow/auth 这类以错误名为判据的类别(设计 D.1;名字表由适配器供给)。
      const classifyMsg = detail.toLowerCase().includes(errName.toLowerCase()) ? detail : `${errName} ${detail}`
      const prev = errorInfo as ErrorInfo | undefined
      errorInfo = {
        ...(prev ?? {}),
        message: prev?.message ? `${prev.message}\n${classifyMsg}` : classifyMsg,
        ...(e.statusCode !== undefined ? { statusCode: e.statusCode } : {}),
        ...(e.responseBody !== undefined ? { responseBody: e.responseBody } : {}),
        ...(e.isRetryable !== undefined ? { isRetryable: e.isRetryable } : {}),
      }
      continue
    }
    // retry(B.4 两路信号合一 / D.2 触发面 2、3,0037 D4): 服务端自己在重试失败的
    // provider 请求。带 id 的来自 retry part(自带完整结构化 ApiError),不带 id 的
    // 来自 session.status retry(message/attempt/next,next 为下次尝试的等待时长,把
    // "还要再等 40 分钟"变成主动决策;旧版 server 可能缺字段)。先累积 errorInfo 再喂
    // 分类器;命中 quota/auth/rate 即提前结算本回合——必须先 abort server 端仍在跑的
    // 旧回合再返回(与断流清理同一手法),否则会与随后 fork 出的新会话并发改文件
    // (D.2);overflow/transient/unknown 只累积不结算,继续观察(不作 idle)。
    if (event.type === "retry") {
      const e = event.error
      idleHandled = false
      errorInfo = {
        ...(errorInfo ?? {}),
        ...(e.message !== undefined ? { message: e.message } : {}),
        ...(e.statusCode !== undefined ? { statusCode: e.statusCode } : {}),
        ...(e.isRetryable !== undefined ? { isRetryable: e.isRetryable } : {}),
        ...(e.responseBody !== undefined ? { responseBody: e.responseBody } : {}),
        ...(event.attempt !== undefined ? { attempt: event.attempt } : {}),
        ...(event.next !== undefined ? { next: event.next } : {}),
      }
      const cls = classifySessionError(errorInfo, client.errorPatterns)
      if (cls === "quota" || cls === "auth" || cls === "rate") {
        await client.abort(sessionID)
        const msg = errorInfo.message ?? error
        error = error ? `${error}\n${msg}` : msg
        return snapshot({
          error: msg,
          // isRetryable:false(如 insufficient_quota)才下传不可重试;其余可降级
          // 错误换会话仍无意义但换模型可能有用,交给 P4(retryable 保持 undefined)。
          retryable: errorInfo.isRetryable === false ? false : undefined,
          errorInfo,
          errorClass: cls,
          failover: true,
        })
      }
      if (event.id !== undefined && !seen.has(event.id)) {
        seen.add(event.id)
        vlog(`  ↻ request retry (attempt ${event.attempt})`)
      }
      continue
    }
    if (event.type === "idle") {
      // 孪生 idle 去重: 一个回合结束只结算一次(见 idleHandled 注释)。
      if (idleHandled) continue
      idleHandled = true
      // 测试执行协议: idle 先结算待执行请求(执行 + steer 反馈/交接要求)再结束;
      // 无待执行请求且无未完成的交接要求时,会话才算真正结束。
      if (test) {
        const handled = await handleIdleTest()
        if (handled.type === "continue") continue
        if (handled.type === "blocked") {
          return snapshot({ blocked: { type: "blocked", question: handled.question }, testHandover })
        }
        if (handled.type === "invalid") {
          return snapshot({
            blocked: {
              type: "blocked",
              question:
                `test handover document ${test.handoffFile} missing or empty (strict resume: the boundary write-verify failed; no more backfill retries; ` +
                `this unit will roll back to its baseline and redo). Last agent output:\n${lastText.trim().slice(-2000) || "(no output)"}`,
            },
            testHandoverInvalid: true,
          })
        }
      }
      // 输出截断续跑(LENGTH_CONTINUE_MAX): 末步 length 收场且未观测到会话错误时,
      // 会话工作未完——steer 一句「从截断处继续」让原会话接着做,不按自然结束收口。
      // 孪生 idle 去重(idleHandled)与 steer 回合的衔接同交接/测试 steer 路径。
      // An agent that takes no further messages (MA.4: steer off) cannot be
      // told to continue; the truncated turn ends as if the cap were used up.
      if (lastFinish === "length" && !error && lengthContinued < LENGTH_CONTINUE_MAX && client.capabilities.steer) {
        lengthContinued++
        // 续跑回合自身的 step-finish 会刷新 lastFinish;steer 后先清掉,防新回合
        // 无 step-finish 的边角形态对着陈旧判据重复续跑(上限兜底,最多空转到 MAX)。
        lastFinish = undefined
        log(`⚠ session reply truncated by the output length limit (step-finish reason=length); prompting it to continue from the cut-off point (${lengthContinued}/${LENGTH_CONTINUE_MAX})`)
        const ok = await steerText(
          "[DRIVER] Your previous reply was cut off by the output length limit; continue the unfinished work from the cut-off point " +
            "(do not redo what is finished; split long output into several steps / tool calls so you don't hit the limit again).",
        )
        if (!ok) return snapshot({ blocked: { type: "blocked", question: "steer dispatch failed (length-continuation hint); cannot continue the session, see the log." } })
        continue
      }
      settled = true
      break
    }
  }
  if (!settled) {
    // 断流/半开收口: 中止 server 端可能仍在运行的孤儿回合,避免与重试的新会话并发
    // 改文件(abort 对已完成的会话无害;网络已断时调用静默失败)。会话错误经 attempt
    // 包装后走重试/阻塞路径,进度记录保持 active,下次运行复用本会话继续。
    await client.abort(sessionID)
    // 探针判半开(D3)与 SSE 断流分案报文;半开报文带 network/timeout 判据喂给
    // classifySessionError 归 transient——传输层故障走既有可重试阶梯与降级环,不
    // 换模型;errorInfo 同步带上,使分类与上行报文有据。
    const msg = halfOpen
      ? `connectivity probe failed ${PROBE_MAX_FAILURES} consecutive times; connection judged half-open (server unresponsive or network down, half-open network timeout)`
      : "event stream interrupted (no session-end event received; suspected server failure or network down)"
    error = error ? `${error}\n${msg}` : msg
    if (halfOpen) errorInfo = { ...(errorInfo ?? {}), message: errorInfo?.message ? `${errorInfo.message}\n${msg}` : msg }
  }
  return snapshot({
    error,
    testHandover,
    retryable,
    // 仅当确有会话错误时把分类带上行下效(不改控制流);正常结束不带这两个键,行为
    // 逐字节等价现状。errorInfo 可能为空(如纯断流)→ 据空输入归类为 unknown。
    ...(error ? { errorInfo, errorClass: classifySessionError(errorInfo ?? {}, client.errorPatterns) } : {}),
  })
}
