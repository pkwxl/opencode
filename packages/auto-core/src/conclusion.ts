// 任务循环的结论报文: 启动续接横幅、任务/阶段/轮次三处代答高亮块与结论行
// (docs/stats-timing-design.md §F、docs/auto-resolve-design.md §H)。
// 只构造文案、不打印,loop 主体负责 log。纯叶子,不依赖 loop.ts。
// 拆分自 src/loop.ts(docs/module-split-plan.md S13,纯搬运)。
import { formatDuration, formatUsageLine } from "./log"
import { currentRound, phaseText, type Phase } from "./phases"
import { decisionsOf, resolveHighlight, resolvesOf } from "./resolve"
import { statsBoot, statsHistory, statsId, statsTotals, type StatsResume } from "./stats"

// 启动续接横幅(plans/STATS_PLAN.md §4.6): 快照取自折旧入账之后、轮次滚动之前,
// round/phase/task 均为上一进程停下时的位置;task 缺失(上一进程停在非任务段
// 或桶 id 损坏)省略任务段。
export function resumeBanner(resumed: StatsResume): string {
  const parts = [`第 ${resumed.round} 轮`]
  if (resumed.phase) parts.push(`${resumed.phase} 阶段`)
  if (resumed.task) {
    parts.push(`${resumed.task} 已累计 ${formatDuration(resumed.taskWallMs)}(AI ${formatDuration(resumed.taskAiMs)})`)
  }
  const at = new Date(resumed.lastWriteAt).toTimeString().slice(0, 5)
  return `↻ 统计续接: ${parts.join(" / ")},上次进程止于 ${at}`
}

// ===== 代答高亮块(docs/auto-resolve-design.md §H,H5/H6)=====
// 三处置顶块与下面三处结论行一一配对: 高亮先打、结论行后打(§H-② 的版面顺序——
// 用户先看见"系统替我做了什么主",再看统计)。构造与 log 分离的理由同结论行: 文案
// 可单测直驱(test/loop-conclusion.test.ts),loop 主体只负责 log。
// 三者一律返回数组(空数组 = 没有代答,不占任何版面),与结论行的 undefined 语义
// 刻意不同: 结论行的 undefined 表示"守卫失败、读数不可信",调用方要回落旧文案;
// 高亮块没有守卫失败这一态——台账读不到就是没有代答。
// 台账读失败(损坏/权限)一律吞成空: 审计永不影响流程与退出码。

// 任务置顶块(H5): 打在 ✓/⏸ 结论行之前。AUTO-DECISION 计数经 decisionsOf 折进末行
// (§H-④),没有代答时整块为空、该计数也随之不上终端(它在会话收尾已进 vlog)。
export async function taskResolveLines(directory: string | undefined, taskID: string): Promise<string[]> {
  const items = await resolvesOf(directory, "task", taskID).catch(() => [])
  if (!items.length) return []
  const decisions = await decisionsOf(directory, taskID).catch(() => 0)
  return resolveHighlight(items, { scope: "task", id: taskID, decisions })
}

// 阶段置顶块(H6): 打在 ■ 阶段收口行之前,只给计数(逐条已在各任务结束时展示过)。
export async function phaseResolveLines(directory: string | undefined, letter: Phase): Promise<string[]> {
  const items = await resolvesOf(directory, "phase", letter).catch(() => [])
  return resolveHighlight(items, { scope: "phase", id: letter })
}

// 轮次置顶块(H6): 打在 ■ 轮次完成行之前。轮号取 currentRound 现查——落账侧
// (runner 的 collectSessionMarks/recordDriverResolves)用的就是同一来源,两侧同源
// 才不会错桶;失败取 0,与落账侧的 catch 回落一致。
export async function roundResolveLines(directory: string | undefined): Promise<string[]> {
  if (!directory) return []
  const round = await currentRound(directory).catch(() => 0)
  const items = await resolvesOf(directory, "round", round).catch(() => [])
  return resolveHighlight(items, { scope: "round", id: round })
}

// ===== T-006 结论行报文(plans/STATS_PLAN.md §4.2/4.3/4.4)=====
// 三处结论行(任务三态/阶段收口/轮次完成)统一在这里构造,loop 主体只负责 log。
// tokens 行与 T-004 ◉ 会话结束行 2 共用 log.ts 的 formatUsageLine,格式不漂移。

// 任务结束三态行的统计段(done/blocked/incomplete 共用,§4.2): 返回
// [`用时 W(AI A[,其中本进程 P]),会话 N 次`, tokens 行] 两件套,由调用方拼状态
// 前缀(✓ 完成 / ⏸ 阻塞 / ⏸ 未完成)。桶为任务桶跨中断累计(含中断前)。守卫
// statsId === taskID(与 subtaskProgressLine 同一理由:桶身份不符时读数不可信),
// 守卫失败返回 undefined,调用方回落 T-006 前的旧文案(done)或不打印(blocked/
// incomplete 原本就无统计行)。
// AUTO-DECISION: "本进程"取墙钟差(wallMs − boot.task.wallMs)。草案"其中本进程"
// 紧邻 AI 一词,有 AI 子集读法;但 T-002 进度心跳行(本文件 subtaskProgressLine)
// 已把"本进程"确立为同一任务桶的墙钟口径,同一措辞跨报文行必须同义,且主语
// "用时"本身是墙钟——备选"AI 子集"会造成心跳行与结论行同词异义,否决。按格式
// 化结果比较,差值不足 1 秒(舍入相同)时不打(与心跳行同手法)。
export async function taskEndLines(directory: string | undefined, taskID: string): Promise<string[] | undefined> {
  if (statsId(directory) !== taskID) return undefined
  const totals = await statsTotals(directory, "task")
  const boot = await statsBoot(directory)
  if (!totals || !boot) return undefined
  const wall = formatDuration(totals.wallMs)
  const local = formatDuration(totals.wallMs - boot.task.wallMs)
  const since = local === wall ? "" : `,其中本进程 ${local}`
  return [
    `用时 ${wall}(AI ${formatDuration(totals.aiMs)}${since}),会话 ${totals.sessions} 次`,
    formatUsageLine(totals.usage),
  ]
}

// 阶段收口行(§4.3,handoverPhase 末尾 commitTree 之后): [`■ 阶段 t 测试验证 收口:
// 总用时 W(含规划/交接/提交;AI A[,人工等待 Z]),任务 T 个 / 会话 S 次`, tokens 行]。
// 阶段桶含规划/交接蒸馏等旁路会话(旁路归 phase+round 桶,见 stats.ts 接线注释),
// 与"含规划/交接/提交"文案对应。守卫桶 id === letter(字母不符 = 桶已被后续阶段
// 重置,不打印)。
// AUTO-DECISION: 人工等待段仅 waitMs > 0 时输出(轮次行同理)——与费用/思考项的
// 0 省略规则同风格,"人工等待 0 秒"是纯噪声;草案示例(waitMs = 3 分)未覆盖 0
// 情形,按既有省略惯例处理。
export async function phaseCloseLines(directory: string | undefined, letter: Phase): Promise<string[] | undefined> {
  const totals = await statsTotals(directory, "phase")
  if (!totals || totals.id !== letter) return undefined
  const wait = totals.waitMs ? `,人工等待 ${formatDuration(totals.waitMs)}` : ""
  return [
    `■ 阶段 ${letter} ${phaseText(letter)} 收口: 总用时 ${formatDuration(totals.wallMs)}` +
      `(含规划/交接/提交;AI ${formatDuration(totals.aiMs)}${wait}),任务 ${totals.tasks} 个 / 会话 ${totals.sessions} 次`,
    formatUsageLine(totals.usage),
  ]
}

// 轮次完成行(§4.4): 本轮 [`■ 第 N 轮完成: 总用时 W(AI A[,人工等待 Z]),[阶段 P / ]
// 任务 T / 会话 S`, tokens 行];phaseCount 仅分阶段路径提供(台账 done 计数 = 本轮
// 已交接阶段数),非分阶段路径省略阶段段(全程恒为 "m" 一个伪阶段,计数无信息)。
// history.rounds > 0 时追加两行历轮累计段(缩进两格,"历轮"前缀区别于本轮行)。
// 轮号取 roundB.id(loadStats 以 currentRound 快照建立并随轮次滚动重置);损坏缺失
// 时回落 currentRound 现查。
// AUTO-DECISION: 历轮累计单列两行,不并入本轮数字——计划只写"tokens 行含 history
// 历累计,rounds=0 省略历轮部分",未给并入格式;并入会把命中率/费用混成跨轮加权
// 值且破坏主行"本轮"语义。备选"并入主行加(累计…)"否决。
export async function roundCompleteLines(
  directory: string | undefined,
  opts?: { phaseCount?: number },
): Promise<string[] | undefined> {
  const totals = await statsTotals(directory, "round")
  if (!totals) return undefined
  // totals 非空即 directory 已定义(statsTotals 对 undefined 空转返回 undefined)。
  const round = Number(totals.id) || (await currentRound(directory as string).catch(() => 1))
  const wait = totals.waitMs ? `,人工等待 ${formatDuration(totals.waitMs)}` : ""
  const phasesPart = opts?.phaseCount !== undefined ? `阶段 ${opts.phaseCount} / ` : ""
  const lines = [
    `■ 第 ${round} 轮完成: 总用时 ${formatDuration(totals.wallMs)}(AI ${formatDuration(totals.aiMs)}${wait}),` +
      `${phasesPart}任务 ${totals.tasks} / 会话 ${totals.sessions}`,
    formatUsageLine(totals.usage),
  ]
  const history = await statsHistory(directory)
  if (history && history.rounds > 0) {
    const h = history.totals
    const hwait = h.waitMs ? `,人工等待 ${formatDuration(h.waitMs)}` : ""
    lines.push(
      `  历轮累计(${history.rounds} 轮): 总用时 ${formatDuration(h.wallMs)}(AI ${formatDuration(h.aiMs)}${hwait}),` +
        `任务 ${h.tasks} / 会话 ${h.sessions}`,
      `  历轮 ${formatUsageLine(h.usage)}`,
    )
  }
  return lines
}
