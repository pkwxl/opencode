// 任务循环的进度与等待: 任务间人工暂停(--wait-between)、verbose 变更文件监视、
// 子任务进度心跳及其文案(plans/0019-stats-timing-design.md §F)。
// 纯叶子,不依赖 loop.ts。
// 拆分自 src/loop.ts(plans/0024-module-split-plan.md S13,纯搬运)。
import { createInterface } from "node:readline/promises"
import { changedFiles } from "./git"
import type { Interactive } from "./interactive"
import { formatDuration, log, vlog } from "./log"
import { countSubtasks, load, next } from "./plan"
import { statsBoot, statsId, statsTotals, statsWaitBegin, statsWaitEnd } from "./stats"

// --wait-between: 任务完成后、下一任务开始前暂停等待人工;回车(任意输入)
// 立即继续,超时自动继续。与 runner 的 askHuman 一样转发 readline 截获的 ^C,
// 使暂停期间连续两次 Ctrl+C 同样能强制终止。
// --interactive 下改由常驻输入行接收(语义不变),避免两个 readline 争抢 stdin。
// dir 传入时等待区间经 statsWaitBegin/End 从总用时/AI 用时扣除、单记 waitMs
// (STATS_PLAN §3 三处人工等待点之一);导出供单测直驱(对齐 subtaskProgressLine)。
export async function waitBetweenTasks(minutes: number, nextID: string, repl?: Interactive, dir?: string) {
  const promptText = `⏸ 任务间暂停: 回车立即开始 ${nextID},或等待 ${minutes} 分钟自动继续: `
  await statsWaitBegin(dir, "waitBetweenTasks")
  try {
    if (repl) {
      const answer = await repl.question(promptText, minutes)
      log(answer === undefined ? `⏳ 等待超时,自动继续 ${nextID}` : `→ 人工确认,继续 ${nextID}`)
      return
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.on("SIGINT", () => process.kill(process.pid, "SIGINT"))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const answer = await Promise.race([
        rl.question(promptText),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), minutes * 60_000)
        }),
      ])
      log(answer === undefined ? `⏳ 等待超时,自动继续 ${nextID}` : `→ 人工确认,继续 ${nextID}`)
    } finally {
      clearTimeout(timer)
      rl.close()
    }
  } finally {
    await statsWaitEnd(dir)
  }
}

// Verbose mode: every 10s list files newly appearing in `git status`
// (modified, staged, or untracked), so a human watching the terminal can
// follow the agent's progress on disk.
export function watchFiles(directory: string) {
  let seen = new Set<string>()
  const timer = setInterval(async () => {
    const changed = await changedFiles(directory).catch(() => [] as string[])
    const fresh = changed.filter((file) => !seen.has(file))
    seen = new Set(changed)
    if (fresh.length) vlog(`  ✎ 变更文件:\n${fresh.map((file) => `    ${file}`).join("\n")}`)
  }, 10_000)
  return { close: () => clearInterval(timer) }
}

// 每 10 分钟重读 PLAN.md,上报当前任务的子任务勾选进度与剩余时间估计(估计为
// 已完成项的线性外推,精度受该检查间隔约束)。
export function trackSubtasks(path: string, directory: string) {
  const timer = setInterval(() => {
    void subtaskProgressLine(path, directory)
      .then((line) => line && log(line))
      .catch(() => {}) // 统计永不影响流程: 读数/解析异常静默,下次心跳重试
  }, 10 * 60_000)
  return { close: () => clearInterval(timer) }
}

// 进度心跳文案(plans/STATS_PLAN.md §4.5): 任务用时改读 stats 任务桶的跨中断
// 累计(含开放段实时外推),取代原内存 since——进程重启后首次外推即可信。
// 返回完整报文行;无可上报对象(无任务/无子任务)或守卫失败返回 undefined。
// 守卫 statsId === task.id: task 桶身份与当前任务一致才可信(statsTask 切换前
// 的窗口期、或未装载句柄时 statsId 为 undefined)。
// AUTO-DECISION: 守卫失败时跳过本次上报(返回 undefined),不保留内存 since 兜底。
// 备选"守卫失败退回内存计时"会在跨中断重启后的守卫真空期回到旧的外推失真问题,
// 且双口径并存使文案时而有累计、时而只有本进程,展示口径漂移;心跳 10 分钟一次,
// 跳过一次的代价远小于口径失真,否决。
export async function subtaskProgressLine(path: string, directory: string): Promise<string | undefined> {
  const plan = await load(path).catch(() => undefined)
  const task = plan && (plan.tasks.find((t) => t.status === "in_progress") ?? next(plan))
  if (!task) return undefined
  const { done, total } = countSubtasks(task.body)
  if (!total) return undefined
  if (statsId(directory) !== task.id) return undefined
  const totals = await statsTotals(directory, "task")
  const boot = await statsBoot(directory)
  if (!totals || !boot) return undefined
  const elapsed = totals.wallMs
  const estimate = done ? formatDuration((elapsed / done) * (total - done)) : "未知(尚无已完成的子任务)"
  const totalText = formatDuration(elapsed)
  const localText = formatDuration(elapsed - boot.task.wallMs)
  // "本进程"仅当 ≠ 累计时输出(未中断时两者相等,文案等价现状);按格式化结果
  // 比较,差值不足 1 秒(舍入相同)时不打。
  const local = localText === totalText ? "" : `(本进程 ${localText})`
  return `  ⏳ ${task.id} 子任务进度 ${done}/${total},累计用时 ${totalText}${local},预计剩余 ${estimate}`
}
