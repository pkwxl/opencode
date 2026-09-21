// 执行类会话的交接时序状态机(runExecSession): --test-by-driver 下包装测试交接
// 循环,按「交接文档的文件状态 × 提交状态」从中断点续跑,定版点/续跑会话分叉
// (seedPinFork/seedSessionFork)。位于 session 与 testrun 之上、review/execute 之下;
// **不得反向 import runner**,testrun 亦不得反向 import 本模块(§D.2 环消解)。
// 拆分自 src/runner.ts(plans/0024-module-split-plan.md S10,纯搬运)。

import { dirname, join } from "node:path"
import type { AgentClient } from "./agent/types"
import type { SessionChain, SessionResult } from "./chain"
import { archivedTestHandoff, latestHandoffSeq, resolveSubtaskDoc, resolveTaskDoc } from "./docpaths"
import { fileCommitted, suffixedTitle, trackedSourceChanges } from "./git"
import { forgetHandover, closedHandovers, handoverSeq, handoverStage, recallHandover, saveHandover, type Handover } from "./handover"
import { log } from "./log"
import { DEFAULT_CONTEXT_LIMIT, type Opts } from "./opts"
import type { Plan, Task } from "./plan"
import { renderTestContinue, renderTestWrapup, testHandoffFile, type TestRunInfo } from "./prompt"
import { COMMIT_CLARIFY } from "./resume-gate"
import { runSession } from "./session"
import { forkSession, sessionAlive, sessionUsed } from "./session-api"
import { autoSwitches } from "./switches"
import {
  archiveHandoff,
  fillHandoffStatus,
  latestTestScript,
  latestTestSeq,
  restoreTestHandoffs,
  runTestScript,
  TEST_HANDOVER_ADVISORY,
  type Steer,
  type TestRun,
} from "./testrun"
import { afterSession, commitBlocked } from "./unit-commit"
import { verifyTmpDir } from "./verify"

// 执行类会话(子任务/整任务/修复轮)的统一入口: --test-by-driver 未启用时直通
// runSession;启用时包装测试交接循环——会话因测试失败且上下文达上限交结束后,
// 以 continuation 提示(先读交接文档与最近输出)开新会话续跑,直至会话自然完成。
// 交接次数不设硬上限,超过 TEST_HANDOVER_ADVISORY 时提示 AI 评估是否陷入无法
// 解决的问题(可 AUTO-FIXME 标注遗留后继续)。subtask 为子任务序号(仅子任务
// 会话传入): 交接文档按执行范围命名(子任务级 docs/<id>/S<两位序号>/
// testhandoff.md),防下一子任务误读上一子任务的遗留交接;整任务/修复轮为任务级命名。
export async function runExecSession(
  client: AgentClient,
  plan: Plan,
  task: Task,
  promptText: string,
  opts: Opts,
  chain: SessionChain,
  steer?: Steer,
  subtask?: number,
  unit = subtask !== undefined ? `subtask ${subtask}` : "execute",
): Promise<SessionResult> {
  if (!opts.testByDriver || opts.dryrun) return runSession(client, task, promptText, opts, chain, steer)
  const dir = opts.dir ?? dirname(plan.path)
  const tmp = verifyTmpDir(dir)
  const handoff = testHandoffFile(task, subtask)
  // 现场复原(中断恢复 F3): 已落账却不在工作区的交接文档先取回——上一次运行的
  // 陈旧清理可能把在途文档删掉。必须早于下面的归档编号扫描: 编号要基于复原后的
  // 现场,否则被删掉的归档份会让编号倒退、覆盖历史交接。
  await restoreTestHandoffs(dir, task)
  // 中断恢复(测试交接中断恢复,plans/0023-test-handover-early-design.md §I): 按
  // 「文件状态 × 提交状态」定出交接时序被打断的位置,再从该位置续跑。观测量是
  // 当前份 testhandoff.md、归档份 testhandoff-<n>.md 以及两者的落账情况;在途
  // 记录(.auto/handover.json)只补上文件和提交推不出来的身份信息(待跑脚本、
  // 已执行结果、可 fork 的会话)。文件按执行范围命名,只认本范围的交接;旧平铺名经 resolve 读回落。
  const record = await recallHandover(dir, task.id, handoff)
  // 观测序号与归档续号分离(handoverSeq): 观测以在途记录为权威、盘扫描兜底——
  // 盘扫描会被会话在归档命名族里的自行落笔污染,把从未发生的交接误判为已收口。
  // 归档编号跨会话/跨运行接续(D4)取两侧最大,不从 1 重来、也不覆盖误写件。
  const seq = handoverSeq(record, await latestHandoffSeq(dir, handoff))
  // handovers 初值 = 已收口计数: 记录未收口时 record.n 是在途交接已分配的号而非
  // 已收口计数,直接当基数会让恢复收口越过它(归档跳空、定版与收口标题不对应)。
  let handovers = closedHandovers(record, seq)
  const test: TestRun = {
    dir,
    tmp,
    handoffFile: join(dir, handoff),
    handover: opts.handoverTest === true,
    limit: opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT,
    seq: await latestTestSeq(tmp),
    task,
    unit,
    subject: chain.subject ?? task.id,
    label: subtask !== undefined ? `${task.id} S${subtask}` : task.id,
    handovers,
    startUsed: 0,
  }
  const seeded = subtask !== undefined
    ? await resolveSubtaskDoc(dir, task.id, subtask, "testhandoff")
    : await resolveTaskDoc(dir, task.id, "testhandoff")
  const current = await Bun.file(join(dir, seeded)).text().catch(() => undefined)
  const archivedRel = seq.observed > 0 ? archivedTestHandoff(handoff, seq.observed) : handoff
  const hasArchived = seq.observed > 0 && (await Bun.file(join(dir, archivedRel)).exists())
  const stage = handoverStage({
    record,
    current,
    currentCommitted: current !== undefined && (await fileCommitted(dir, seeded)),
    archived: hasArchived,
    archivedCommitted: hasArchived && (await fileCommitted(dir, archivedRel)),
  })
  let continuation = false
  let archived = archivedRel
  // 首轮提示词的一次性改写: 收尾未完成时从定版点 fork 出的会话已经带着本执行
  // 范围的全部上下文,要下发的是收尾指令本身,而不是再讲一遍任务提示词。
  let firstPrompt: string | undefined
  if (stage === "wrapup" && record) {
    // H1 收尾未完成: 定版提交已落账、会话没写完交接文档就被打断。从定版那一刻的
    // 会话状态 fork 出新会话重做收尾——收尾之后照常走归档 → 提交 #2 → 跑脚本。
    if (await seedPinFork(client, chain, record, `${test.label} test handover #${record.n} wrapup`)) {
      if (record.script) test.pending = { script: record.script, seq: record.seq ?? ++test.seq }
      test.resumeWrapup = true
      firstPrompt = renderTestWrapup({ handoffFile: test.handoffFile })
      log(`↻ ${test.label} resume after interruption: test handover #${record.n} committed the frozen tree but wrapup is unfinished; forking from the frozen point to redo the wrapup`)
    } else {
      // 定版会话已不可用: 收尾无从接续,丢掉在途记录冷启动重做本执行范围
      // (定版提交留在历史里,是一次无害的中间提交)。
      await forgetHandover(dir)
      log(`↻ ${test.label} resume after interruption: the frozen session for test handover #${record.n} is no longer available; cold-starting this execution scope`)
    }
  } else if (stage === "commit" || stage === "test") {
    // H2 交接已写完未收口 / H3 已收口: 补齐缺的那几步(补状态行 → 归档 → 提交 #2
    // → 执行脚本),再开续跑会话。closedN = 本次认下的归档号: H3 即观测号,H2 补
    // 归档时为续出的新号;在途记录的 n 与之一致,指着的才是真归档份。
    let closedN = seq.observed
    if (stage === "commit") {
      if (!hasArchived) {
        // F2 补标记: 内容按构造是完整的(已落账,或带状态行),缺的那一行由 driver
        // 补上——归档份本身要自证"这是写完的交接",随提交 #2 一并落账。
        await fillHandoffStatus(join(dir, seeded))
        handovers++
        test.handovers = handovers
        closedN = handovers
        archived = archivedTestHandoff(handoff, closedN)
        await archiveHandoff(dir, seeded, handoff, closedN)
      } else {
        // 归档在盘但未落账: 存量现场可能缺状态行(归档发生于状态行约定之前),补写
        // 幂等(已有状态行则不动),随提交 #2 一并落账。
        await fillHandoffStatus(join(dir, archived))
      }
      const subject = suffixedTitle(test.subject, `test handover #${closedN}`)
      const committed = await afterSession(dir, opts, task, { stage: `${unit} handoff-${closedN}`, subject })
      if (committed.type === "failed") return commitBlocked(subject, committed)
      log(`↻ ${test.label} resume after interruption: handover document ${archived} was fully written but not closed out; committed as backfill`)
    } else {
      log(`↻ ${test.label} resume after interruption: test handover #${closedN} closed out (${archived} archived)`)
    }
    // 脚本执行状态(F6 修订,2026-09-17,设计文档 §M): 定版脚本的执行结果在收口时
    // 随在途记录落盘(ran)——本地脚本除断电/强制终止外必然跑完,已执行即视为完成,
    // 恢复不重复执行,凭记录引用落盘的输出。仅「定版已消费出脚本而执行结果未落盘」
    // (执行途中被打断)才重跑;记录缺失(本机制上线前的存量现场)回落到 tmp/ 下
    // 最新一份执行快照。旧格式记录(无 ran 亦无 script): 收口时清脚本即表示已执行,
    // 不重跑、不臆造结果,续跑会话凭交接文档与 tmp/ 下既有输出判读。
    let ran = record?.ran
    if (ran) {
      test.last = ran
    } else {
      const script = record ? record.script : await latestTestScript(tmp)
      if (script) {
        log(`↻ ${test.label} resume after interruption: test script ${script} pending execution on the frozen rerun`)
        ran = await runTestScript(test, opts, script)
      }
    }
    // 续跑会话已经开过并被打断 → 从它分叉恢复,把那一轮已积累的上下文接回来。
    if (record?.nextSession && (await seedSessionFork(client, chain, record.nextSession, `${test.label} test handover #${closedN} continuation`))) {
      log(`↻ ${test.label} resume after interruption: the pre-interruption continuation session ${record.nextSession} is still alive; forked a copy to resume`)
      // fork 副本带着续跑会话的全部上下文(任务提示词与续跑说明在它开出时已下发),
      // 整份重发只会重复: 本次恢复有新跑的测试才把结果带给它,否则收敛为一句继续
      // (与恢复保真"复用会话的恢复说明收敛为一句 continue"同口径)。
      firstPrompt =
        ran && !record?.ran
          ? renderTestContinue({ handoffFile: archived, run: ran, stuck: handovers > TEST_HANDOVER_ADVISORY ? handovers : undefined })
          : `[DRIVER] 上次运行在此中断,已从续跑会话分叉恢复;请接着中断点继续。${COMMIT_CLARIFY}`
    }
    continuation = true
    await saveHandover(dir, {
      ...(record ?? { task: task.id, scope: handoff, unit, n: closedN }),
      n: closedN,
      script: undefined,
      seq: undefined,
      pinSession: undefined,
      pinMessage: undefined,
      nextSession: undefined,
      ...(ran ? { ran } : {}),
    })
  }
  for (;;) {
    const extra = continuation
      ? `\n\n${renderTestContinue({
          handoffFile: archived,
          run: test.last,
          stuck: handovers > TEST_HANDOVER_ADVISORY ? handovers : undefined,
        })}`
      : ""
    const prompt = firstPrompt ?? promptText + extra
    firstPrompt = undefined
    const result = await runSession(client, task, prompt, opts, chain, steer, test)
    test.resumeWrapup = false
    // 阻塞退出保留在途记录: 人工处置后重新运行时,状态机据它落回被打断的位置。
    if (result.type === "blocked") return result
    // 会话自然结束 = 本执行范围的交接循环闭环,记录随之作废。
    if (!result.testHandover) {
      await forgetHandover(dir)
      return result
    }
    handovers++
    test.handovers = handovers
    // 并发态的漂移登记(E3): 定版之后、提交 #2 之前比对**已跟踪**的非文档改动——
    // 非空即说明本次测试面对的定版快照与将要落账的树不是同一份。只记事实,不
    // stash、不重跑、不阻塞(重测守卫已退役,见 plans/0023-test-handover-early-design.md §H)。
    // 必须在提交 #2 之前做: 提交之后 diff 恒空,什么也看不见。
    if (autoSwitches().handoverConcurrent) {
      const drifted = await trackedSourceChanges(dir)
      if (drifted.length) {
        log(
          `⚠ ${test.label} concurrent mode: the tested content changed during handover wrapup (${drifted.slice(0, 3).join(", ")}${drifted.length > 3 ? " etc." : ""}); ` +
            `this test ran against the frozen snapshot — judge against the handover document`,
        )
      }
    }
    archived = archivedTestHandoff(handoff, handovers)
    await archiveHandoff(dir, handoff, handoff, handovers)
    // 提交 #2(交接确认): 会话收尾落盘的成果 + 归档交接文档一并落账。单元尚未
    // 收口,不传 baseline。
    const subject = suffixedTitle(test.subject, `test handover #${handovers}`)
    const committed = await afterSession(dir, opts, task, { stage: `${unit} handoff-${handovers}`, subject })
    if (committed.type === "failed") return commitBlocked(subject, committed)
    // 顺序态(缺省,E1): 交接收口之后才执行——被测的就是提交 #2 的那一份树。脚本
    // 自身若改写了跟踪文件(如 rustfmt apply),留作未提交增量,由下一单元的提交吸纳。
    let ran: TestRunInfo | undefined
    if (test.pending) {
      const pending = test.pending
      test.pending = undefined
      ran = await runTestScript(test, opts, pending.script, pending.seq)
    } else if (autoSwitches().handoverConcurrent) {
      // 并发态: 定版即起跑,执行结果已经 attempt 收口写在 test.last。
      ran = test.last
    }
    // 收口完成: 在途记录进入"已收口"态——待跑脚本已消费、定版锚点作废,执行结果
    // 随记录固化(ran,恢复不再重复执行);余下的身份信息只剩下一会儿要开的续跑
    // 会话(由 attempt 回填 nextSession)。
    await saveHandover(dir, { task: task.id, scope: handoff, unit, n: handovers, ...(ran ? { ran } : {}) })
    log(`↻ ${test.label} context limit reached; handed over as ${archived}, continuing in a new session (test handover #${handovers})`)
    continuation = true
  }
}

// 定版点分叉(F5): 从记录的定版会话在定版那一刻的状态分叉出新会话,用于重做
// 被打断的交接收尾。server 的 fork 语义是"复制 target **之前**的消息",故锚点取
// 定版时观测到的末条消息的**后一条**;取不到(消息已被清理、锚点就是末条)时整份
// 分叉——收尾提示词重下一遍,会话至多把收尾做两遍,不会丢东西。
export async function seedPinFork(client: AgentClient, chain: SessionChain, record: Handover, subject: string): Promise<boolean> {
  if (!record.pinSession || !(await sessionAlive(client, record.pinSession))) return false
  let anchor: string | undefined
  if (record.pinMessage) {
    const got = await client.messages(record.pinSession)
    const list = got.ok ? got.value : []
    const at = list.findIndex((message) => message.id === record.pinMessage)
    anchor = at >= 0 ? list[at + 1]?.id : undefined
  }
  const forked = await forkSession(client, record.pinSession, subject, anchor)
  if (!forked) return false
  chain.id = undefined
  chain.pending = forked
  chain.pct = 100
  // 分叉前缀的用量无法廉价测得,归零处理: attempt 对非复用会话本就把
  // test.startUsed 归零,链内后续复用决策在本回合结束后即被真实用量覆盖。
  chain.used = 0
  chain.at = 0
  // 收尾指令自成一体,不再叠加恢复说明(那是给冷启动会话读的)。
  chain.note = undefined
  return true
}

// 整份分叉一个尚存的会话(F5,续跑会话被打断时接回其上下文);不可用返回 false,
// 调用方按冷启动继续。
async function seedSessionFork(client: AgentClient, chain: SessionChain, session: string, subject: string): Promise<boolean> {
  if (!(await sessionAlive(client, session))) return false
  const forked = await forkSession(client, session, subject)
  if (!forked) return false
  chain.id = undefined
  chain.pending = forked
  chain.pct = 100
  chain.used = await sessionUsed(client, session).catch(() => 0)
  chain.at = 0
  return true
}
