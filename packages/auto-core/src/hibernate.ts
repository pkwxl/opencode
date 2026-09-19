// 休眠时段(OPENCODE_AUTO_HIBERNATE,设计文档 plans/0027-hibernate-design.md): 避开 LLM
// 高收费时段的每日 UTC 休眠窗口("HH:MM+H",如 04:00+6 = UTC 04:00 起休眠 6 小时)。
// 触发语义: 只在三处既有安全边界(phase/task/subtask,挂点同 step.ts)与 run 启动时
// 检查「现在是否在窗口内」——在窗口内睡到窗口结束、再固定随机延迟 0~600 秒后继续;
// 执行中的单元跨越窗口开始时刻时,在其结束的边界自然被截停,即「优雅等待当前任务/
// 子任务到安全退出点再暂停」。不预判下一单元、不落盘;睡眠期间双 Ctrl+C 经进程级
// SIGINT 处理器强退(130),等待时长经 statsWaitBegin/End 从用时统计扣除。
import { log } from "./log"
import { statsWaitBegin, statsWaitEnd } from "./stats"
import { autoSwitches, formatHibernate, type HibernateWindow } from "./switches"

// 窗口结束后的固定随机延迟上限(D3): 0~600 秒,错开同时唤醒的多实例。
export const HIBERNATE_JITTER_MS = 600_000

const DAY_MS = 86_400_000

// 休眠时长计算(纯函数,供单测): now(epoch 毫秒)落在当日 UTC 窗口
// [startMin, startMin+durationMin)(模 1440 分钟,跨午夜取模)内 → 返回「到窗口结束的
// 毫秒数 + random() × HIBERNATE_JITTER_MS」;不在窗口 → 0。恰在窗口起点算在内(睡满
// 全程),恰在窗口终点算在外(窗口已结束)。
export function hibernateSleepMs(window: HibernateWindow, now: number, random: () => number = Math.random): number {
  const start = window.startMin * 60_000
  const end = start + window.durationMin * 60_000
  const t = ((now % DAY_MS) + DAY_MS) % DAY_MS
  let remaining: number
  if (t >= start) {
    // 起点之后:窗口尚未跨日结束即在内(end 可能 > DAY_MS,无碍比较)。
    if (t >= end) return 0
    remaining = end - t
  } else {
    // 起点之前:仅当窗口跨午夜且尾部覆盖到当日此时才在内。
    if (end <= DAY_MS || t >= end - DAY_MS) return 0
    remaining = end - DAY_MS - t
  }
  return remaining + random() * HIBERNATE_JITTER_MS
}

// 边界/启动挂点: 开关未设(缺省)零行为直接返回(统计零接触);在窗口内则睡到唤醒。
// dir 传目标目录时等待区间经 statsWaitBegin/End 扣除、单记 waitMs(与 stepPause 同一
// 口径);now/random/sleep/window 注入供单测。唤醒后不重新检查窗口——系统挂起导致
// 睡过头只会更晚恢复,语义仍满足「度过休眠时段后继续」。
export async function hibernatePause(
  label: string,
  opts: {
    dir?: string
    now?: number
    random?: () => number
    sleep?: (ms: number) => Promise<void>
    window?: HibernateWindow
  } = {},
): Promise<void> {
  const window = opts.window ?? autoSwitches().hibernate
  if (window === undefined) return
  const now = opts.now ?? Date.now()
  const sleepMs = hibernateSleepMs(window, now, opts.random)
  if (sleepMs <= 0) return
  const wakeAt = new Date(now + sleepMs)
  log(
    `⏸ hibernating: ${label} is inside the hibernate window (UTC ${formatHibernate(window)}),` +
      ` resuming around ${wakeAt.toISOString()} (local ${wakeAt.toLocaleString()}, includes random delay); press Ctrl+C twice to force-quit`,
  )
  // 人工/计划等待扣除(STATS_PLAN §3 同口径): 关段后 aiMs/wallMs 均不增长,waitMs
  // 单记;异常路径经 finally 配对 waitEnd,不留悬挂关段。
  await statsWaitBegin(opts.dir, "hibernate")
  try {
    await (opts.sleep ?? Bun.sleep)(sleepMs)
  } finally {
    await statsWaitEnd(opts.dir)
  }
  log(`→ hibernate over: continuing after ${label}`)
}
