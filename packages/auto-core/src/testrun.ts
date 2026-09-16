// --test-by-driver 测试执行与 --handover-test 交接文档的文件操作: 测试请求标记的
// 消费、脚本执行与输出归档、交接判据(steer / 测试两族)、交接文档的补状态行/
// 归档/链式清理与恢复。**本模块不依赖任何会话驱动代码**(不得 import
// session / watch / exec-session / runner)——这是 docs/module-split-plan.md §D.2
// 环消解的落点:watch → testrun 单向,交接时序状态机另在 exec-session。
// 拆分自 src/runner.ts(docs/module-split-plan.md S6,纯搬运)。

import { mkdir, readdir, rename, rm } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { archivedTestHandoff, latestHandoffSeq, legacyTaskDoc, taskDoc } from "./docpaths"
import { deletedFiles, fileTracked, restoreFile } from "./git"
import { handoffStatus, peekHandover } from "./handover"
import { log } from "./log"
import type { Opts } from "./opts"
import type { Task } from "./plan"
import { handoffFile, renderHandoffSteer, type TestRunInfo } from "./prompt"
import { runVerifyScript } from "./verify"

// steer: 会话进行中已用上下文达到 limit 时,driver 向该会话插入一次 text
// (handoff-steer 交接提示;v2 prompt 默认 steer,在下一个 provider turn 边界生效)。
export type Steer = { limit: number; text: string }

// 交接 steer 构造(ondemand 整任务会话与 auto 子任务会话两处调用点共用;导出纯
// 函数供单测): 实验开关 OPENCODE_AUTO_STEER=off(on = autoSwitches().steer)时不
// 构造——会话进行中不注入 2×cap 交接提示。
export function handoffSteer(on: boolean, cap: number, task: Task): Steer | undefined {
  return on ? { limit: cap * 2, text: renderHandoffSteer(task) } : undefined
}

// 会话结束后的交接判定(与 steer 构造同开关联动;导出纯函数供单测): 仅当交接
// steer 生效(开关 on 且模式启用)且会话已用上下文达到其阈值(2×cap)时才要求
// 交接文档/续跑;steer 未构造(off 模式整任务会话,或 OPENCODE_AUTO_STEER=off)
// 时会话自然完成即收,不索要交接文档。--handover-test 的测试交接是独立机制
// (watch 的 test 协议),不经此判定。
export function handoverDue(steer: Steer | undefined, used: number): boolean {
  return steer !== undefined && used >= steer.limit
}

// --test-by-driver 的测试执行协议状态(watch 与 runExecSession 共享,跨会话/
// 跨运行持续): tmp 为目标目录下 driver 工作目录(tmp/);seq 为按序归档编号
// (初始化时扫描既有 tmp/test.<n>.out 取最大值——每次执行都会产出 .out,故以
// 它为编号基准;test/ 脚本路径形态不另产 .sh,内联形态产 tmp/test.<n>.sh);
// handoffFile 为 --handover-test 交接文档绝对路径(按执行范围命名: 子任务为
// docs/<id>/S<两位序号>/testhandoff.md,整任务/修复轮为 docs/<id>/testhandoff.md);
// handover 开关;limit 为上下文
// 已用量上限(config.contextLimit 原值;ondemand 的交接 steer 用其 2 倍);
// last 为最近一次执行信息(continuation 提示引用其输出路径)。
// task/unit/handovers 供交接定版提交(#1)构造提交信息——watch 不持有 task 与执行
// 范围标签,经本结构带下去;startUsed 为判据的回落值(见 testHandoverDue)。
export type TestRun = {
  dir: string
  tmp: string
  handoffFile: string
  handover: boolean
  limit: number
  seq: number
  task: Task
  unit: string
  // 交接提交的标题主体: 取本执行单元的提交标题(子任务为 `T-NNN S<n> <子任务标题>`,
  // 整任务为 `T-NNN exec <标题>`,修复轮为 `T-NNN fix<n> <标题>`),交接提交在其后
  // 缀 `测试交接 #<n>[ 定版]`——与该单元完成时的提交同题,git 历史里一眼看出这几次
  // 中间提交属于哪个子任务。
  subject: string
  // 日志与终端用的短标签(`T-NNN S<n>` / `T-NNN`): 交接相关的日志行大多发生在会话
  // 横幅之外(定版、收口、恢复判定、顺序态的脚本执行都在会话结束之后),只打任务
  // 编号看不出是哪个子任务。
  label: string
  handovers: number
  startUsed: number
  last?: TestRunInfo
  // 并发态(OPENCODE_AUTO_HANDOVER_CONCURRENT=on)下与会话收尾并发执行中的测试。
  // watch 起跑、attempt 在 watch 返回后收口: 测试进程不能跨会话悬挂(会与随后开的
  // 新会话并发改文件),且 test.last 是新会话续跑提示的依据。收口即清。
  running?: Promise<TestRunInfo>
  // 顺序态(缺省)下已定版、待交接收口后执行的脚本(与 running 互斥)。标记
  // tmp/test.sh 在定版那一刻就被消费掉——会话随后还会继续收尾,标记留着会被
  // 下一轮误读;执行推迟到提交 #2 之后,由 runExecSession 收口。执行即清。
  pending?: { script: string; seq: number }
  // 中断恢复(§I)的一次性旗标: 本轮会话是"从定版点分叉出来重做交接收尾"的,
  // 收尾指令已随首个提示词下发——watch 因此一开始就处于"已索要交接文档"状态,
  // 会话 idle 时直接校验文档而不是当成普通结束。用后即清。
  resumeWrapup?: boolean
}

// 测试交接判据(交接触发解耦,测试交接前置化设计 D1): 不再叠加"测试失败"——
// 上下文达 contextLimit 单条件即交接,判定时点固定为"AI 发起测试的那一刻"
// (tmp/test.sh 出现时)。那是唯一天然干净的分割点: 发起测试通常意味着相关工作
// 已做完、正要验证;越过这一刻上下文就开始变化,不再好切。
// used 为本会话实时用量;这一刻还没收到任何 message.updated(仍为 0,或
// contextLimits 拉取失败)时,回落到起跑时已知的 startUsed 决策。
export function testHandoverDue(test: { handover: boolean; limit: number; startUsed: number }, used: number): boolean {
  return test.handover && (used > 0 ? used : test.startUsed) >= test.limit
}

// 测试交接连续超过该次数时,continuation 提示附带"是否陷入无法解决的问题"评估
// (AUTO-FIXME 标注遗留后继续);不设硬上限,不阻塞。
export const TEST_HANDOVER_ADVISORY = 10

// 交接文档补状态行(F2): 内容已落账或已带状态行时才会走到这里,缺行只是该内容
// 写于状态行约定之前。补 `状态: 继续`——测试结果还没判读,本执行范围一定没完。
export async function fillHandoffStatus(path: string): Promise<void> {
  const text = await Bun.file(path).text().catch(() => "")
  if (!text.trim() || handoffStatus(text)) return
  await Bun.write(path, `${text.trimEnd()}\n\n状态: 继续\n`)
}

// tmp/ 下最新一份执行快照 tmp/test.<n>.sh: 在途记录缺失(本机制上线前的存量
// 现场)时的回落——定版消费出来的脚本就物化在那里。目录缺失或无快照返回 undefined。
export async function latestTestScript(tmp: string): Promise<string | undefined> {
  let max = 0
  for (const file of await readdir(tmp).catch(() => [] as string[])) {
    max = Math.max(max, Number(/^test\.(\d+)\.sh$/.exec(file)?.[1] ?? 0))
  }
  return max > 0 ? join(tmp, `test.${max}.sh`) : undefined
}

// 交接文档的现场复原(F3): 已被提交跟踪、却在工作区被删掉的交接文档取回。
// 上一次运行的陈旧清理会把在途文档整链删除,而它在定版/收口提交里已经落账
// ——删除本身即脏区,下一个执行单元的 clean 门禁当场阻塞。以 git 为权威复原,
// 脏区随之消失,恢复状态机也拿回了判定所需的文件。
// task 省略时复原全部任务的交接文档(run 启动时用: 那一刻还不知道要跑哪个任务,
// 而运行开始前一份被删掉的已落账交接文档没有任何一种正当解释)。
export async function restoreTestHandoffs(dir: string, task?: Task): Promise<void> {
  const deleted = await deletedFiles(dir, "docs")
  for (const rel of deleted) {
    if (!/testhandoff(-\d+)?\.md$/.test(rel)) continue
    if (task && !rel.includes(task.id)) continue
    if (await restoreFile(dir, rel)) log(`↻ 交接文档 ${rel} 曾被清理,已从提交复原`)
  }
}

// 交接文档归档: from(可能是旧平铺名,经 resolve 选出的实际读点)重命名为**新路径
// 家族**的 testhandoff-<n>.md——与 docpaths 的"写目标恒为新路径、读点经 resolve
// 选址"同一口径,归档份因此只有一族,编号接续只需扫新路径同目录。旧平铺项目的
// 目标目录可能还不存在,先建。
export async function archiveHandoff(dir: string, from: string, handoff: string, n: number): Promise<void> {
  const target = join(dir, archivedTestHandoff(handoff, n))
  await mkdir(dirname(target), { recursive: true })
  await rename(join(dir, from), target)
}

// 一份交接文档及其全部归档份(testhandoff.md + testhandoff-<n>.md)是否在盘。
async function handoffChainExists(dir: string, handoff: string): Promise<boolean> {
  if (await Bun.file(join(dir, handoff)).exists()) return true
  return (await latestHandoffSeq(dir, handoff)) > 0
}

// 移除一份交接文档及其全部归档份: 交接链在一次 runTask 调用内闭环,单元完成
// (或非恢复路径的陈旧清理)即整链清除——留给下一执行范围会被误读为续跑依据,
// 也会永久否决会话复用。历史交接内容由 git 提交记录承载,不靠工作区文件留存。
export async function removeHandoffChain(dir: string, handoff: string, untrackedOnly = false): Promise<void> {
  for (let n = await latestHandoffSeq(dir, handoff); n > 0; n--) {
    const rel = archivedTestHandoff(handoff, n)
    if (untrackedOnly) await removeIfUntracked(dir, rel)
    else await rm(join(dir, rel), { force: true })
  }
  if (untrackedOnly) await removeIfUntracked(dir, handoff)
  else await rm(join(dir, handoff), { force: true })
}

// 归档编号接续: 扫描 tmp/ 下既有 test.<n>.out 取最大编号(每次执行都产出 .out,
// 故覆盖 test/ 脚本路径与内联两种形态);跨会话/跨运行不覆盖。目录缺失从 0 起。
export async function latestTestSeq(tmp: string): Promise<number> {
  let max = 0
  for (const file of await readdir(tmp).catch(() => [] as string[])) {
    max = Math.max(max, Number(/^test\.(\d+)\.out$/.exec(file)?.[1] ?? 0))
  }
  return max
}

// 该任务的测试交接文档是否留有任一执行范围的遗留(任务级 docs/<id>/testhandoff.md
// 或子任务级 docs/<id>/S<kk>/testhandoff.md;兼容期旧平铺 docs/<id>.testhandoff.md
// 与 docs/<id>-S<n>.testhandoff.md 同样认定): 中断恢复判定用——文件在手说明中断前
// 会话已写出交接,旧会话上下文已用满,不得复用(开新会话凭交接续跑)。
export async function testHandoffExists(dir: string, task: Task): Promise<boolean> {
  // 当前份与归档份(testhandoff-<n>.md)同样认定: 归档只是 driver 收口时的重命名,
  // 交接这件事已经发生——本单元闭环前不得复用旧会话(单元完成时随 removeHandoffChain
  // 一并清除,陈旧归档不会永久否决复用)。
  // 任务级: 目录化新路径与旧平铺两处。
  if (await handoffChainExists(dir, taskDoc(task.id, "testhandoff"))) return true
  if (await handoffChainExists(dir, legacyTaskDoc(task.id, "testhandoff"))) return true
  // 子任务级: 任务目录内任意层级 testhandoff*.md(** 匹配零段,任务级同名文件已被
  // 上面覆盖,此处聚焦子任务目录;范围收窄到本任务)。
  for await (const _ of new Bun.Glob(join("docs", task.id, "**", "testhandoff*.md")).scan({ cwd: dir, onlyFiles: true })) {
    return true
  }
  // 兼容期旧平铺 docs/<id>-S<n>.testhandoff.md(含归档份)前缀扫描。
  for (const name of await readdir(join(dir, "docs")).catch(() => [] as string[])) {
    if (name.startsWith(`${task.id}-S`) && /\.testhandoff(-\d+)?\.md$/.test(name)) return true
  }
  return false
}

// 测试交接文档的陈旧清理(非恢复续跑): 任务级与全部子任务级一并移除——交接
// 循环在一次 runTask 调用内闭环,跨调用的遗留文档属陈旧状态,留给下一执行范围
// 会被误读为续跑依据。目录化新布局与兼容期旧平铺两处同清。
//
// 两道收窄(中断恢复 F4): ① 本任务有在途交接记录时整段跳过——那不是遗留,是
// 被打断的在途状态,判定权在恢复状态机;② 只删**未被 git 跟踪**的份。已落账的
// 交接文档必然属于在途交接(单元正常完成时由 removeHandoffChain 在单元内删除、
// 随单元提交落账),在这里删它只会制造脏区,把下一个执行单元的 clean 门禁撞停
// ——kernel-spi-nor T-028 现场正是如此。
export async function cleanTestHandoffs(planPath: string, task: Task): Promise<void> {
  const dir = dirname(planPath)
  if (await peekHandover(dir, task.id)) return
  await removeHandoffChain(dir, taskDoc(task.id, "testhandoff"), true)
  await removeHandoffChain(dir, legacyTaskDoc(task.id, "testhandoff"), true)
  for await (const file of new Bun.Glob(join("docs", task.id, "S*", "testhandoff*.md")).scan({ cwd: dir, onlyFiles: true })) {
    await removeIfUntracked(dir, file)
  }
  const docs = join(dir, "docs")
  for (const name of await readdir(docs).catch(() => [] as string[])) {
    if (name.startsWith(`${task.id}-S`) && /\.testhandoff(-\d+)?\.md$/.test(name)) {
      await removeIfUntracked(dir, join("docs", name))
    }
  }
}

// 未被 git 跟踪才删(F4);已跟踪的留给恢复状态机,删它等于制造脏区。
async function removeIfUntracked(dir: string, rel: string): Promise<void> {
  if (await fileTracked(dir, rel)) return
  await rm(join(dir, rel), { force: true })
}

// --test-by-driver 的单次测试执行 = 消费请求标记 + 执行。两步拆开是因为顺序态的
// 测试交接要在定版那一刻先消费标记、把脚本定下来,执行推迟到交接收口之后。
// stdout+stderr 合并整写 tmp/test.<n>.out(共用 idleTime/idleMax 看门狗);退出码
// 非 0 不在此判定——判断权在 AI(与 verify 哲学一致,机制正交)。
export async function executeTest(test: TestRun, opts: Opts): Promise<TestRunInfo> {
  const pending = await resolveTestScript(test)
  return runTestScript(test, opts, pending.script, pending.seq)
}

// 请求标记的消费(定出本次要跑的脚本,占一个归档序号): tmp/test.sh 存在即请求,
// 读完就删以便再次请求。内容有两种形态——
// (1) 指向 test/ 下脚本的路径(相对工作目录,如 test/build.sh):直接运行该脚本
// (脚本本身在 test/ 已进 git,无需另行归档);判据是**整份内容不含换行**,故带
// 尾随换行的路径会落到形态 (2),结果等价(内联的一行路径由 bash 当命令执行);
// (2) 内联脚本(AI 未按协议固化到 test/ 时的回落):把内容整写为 tmp/test.<n>.sh,
// 保留执行快照供审计。
// 顺序态在定版那一刻先行调用——标记必须在会话继续收尾之前拿走(否则收尾期重写
// 标记会让 driver 跑错脚本),内联形态也要与定版提交同一时刻物化。
export async function resolveTestScript(test: Pick<TestRun, "dir" | "tmp" | "seq">): Promise<{ script: string; seq: number }> {
  const seq = ++test.seq
  const marker = join(test.tmp, "test.sh")
  const content = await Bun.file(marker).text()
  const candidate = resolve(test.dir, content.trim())
  let script: string
  // 单行内容且指向现存文件 → 运行该 test/ 脚本(协议首选);否则按内联脚本回落。
  if (!content.includes("\n") && (await Bun.file(candidate).exists())) {
    script = candidate
  } else {
    script = join(test.tmp, `test.${seq}.sh`)
    await Bun.write(script, content)
  }
  await rm(marker, { force: true })
  return { script, seq }
}

// 已知脚本路径的执行内核(executeTest 消费请求标记后调用;顺序态的测试交接亦直接
// 调用它执行定版时已消费出来的 test.pending——那时标记早已被拿走,没有第二次可读)。
// 每次执行都占一个新的归档序号,输出恒为 tmp/test.<n>.out。
export async function runTestScript(test: TestRun, opts: Opts, script: string, seq = ++test.seq): Promise<TestRunInfo> {
  const out = join(test.tmp, `test.${seq}.out`)
  await mkdir(test.tmp, { recursive: true })
  const run = await runVerifyScript(test.dir, script, { idleMs: opts.idleMs, maxMs: opts.maxMs, out })
  log(
    `  ⚙ ${test.label} test 脚本退出码 ${run.code}${run.timedOut ? `(超时终止: ${run.timeoutReason === "max" ? "超过绝对时长上限" : "持续无输出"})` : ""},耗时 ${run.ms}ms,脚本: ${script},输出: ${out}`,
  )
  const info: TestRunInfo = {
    script,
    code: run.code,
    ms: run.ms,
    timedOut: run.timedOut,
    timeoutReason: run.timeoutReason,
    out,
    seq,
  }
  test.last = info
  return info
}
