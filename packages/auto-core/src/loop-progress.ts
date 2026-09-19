// Task-loop progress and waiting: manual pause between tasks
// (--wait-between), verbose changed-files watch, and the subtask progress
// heartbeat with its text (plans/0019-stats-timing-design.md §F).
// Pure leaf, no dependency on loop.ts.
// Split out of src/loop.ts (plans/0024-module-split-plan.md S13, pure move).
import { createInterface } from "node:readline/promises"
import { changedFiles } from "./git"
import type { Interactive } from "./interactive"
import { formatDuration, log, vlog } from "./log"
import { countSubtasks, load, next } from "./plan"
import { statsBoot, statsId, statsTotals, statsWaitBegin, statsWaitEnd } from "./stats"

// --wait-between: after a task completes, pause for human confirmation before
// the next task starts; Enter (any input) continues immediately, timeout
// continues automatically. Like runner's askHuman, forwards ^C intercepted by
// readline so two consecutive Ctrl+C during the pause still force-quit.
// Under --interactive the resident input line takes over (same semantics),
// avoiding two readlines fighting over stdin.
// When dir is given, the wait interval is deducted from total/AI elapsed via
// statsWaitBegin/End and recorded separately as waitMs (one of the three
// human-wait points in STATS_PLAN §3); exported for direct unit tests
// (aligned with subtaskProgressLine).
export async function waitBetweenTasks(minutes: number, nextID: string, repl?: Interactive, dir?: string) {
  const promptText = `⏸ pause between tasks: press Enter to start ${nextID} now, or wait ${minutes}m to auto-continue: `
  await statsWaitBegin(dir, "waitBetweenTasks")
  try {
    if (repl) {
      const answer = await repl.question(promptText, minutes)
      log(answer === undefined ? `⏳ wait timed out, auto-continuing ${nextID}` : `→ confirmed, continuing ${nextID}`)
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
      log(answer === undefined ? `⏳ wait timed out, auto-continuing ${nextID}` : `→ confirmed, continuing ${nextID}`)
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
    if (fresh.length) vlog(`  ✎ changed files:\n${fresh.map((file) => `    ${file}`).join("\n")}`)
  }, 10_000)
  return { close: () => clearInterval(timer) }
}

// Re-read PLAN.md every 10 minutes and report the current task's subtask
// checkbox progress with a remaining-time estimate (linear extrapolation from
// completed items; precision bounded by this check interval).
export function trackSubtasks(path: string, directory: string) {
  const timer = setInterval(() => {
    void subtaskProgressLine(path, directory)
      .then((line) => line && log(line))
      .catch(() => {}) // stats never affect flow: read/parse failures stay silent, retried next heartbeat
  }, 10 * 60_000)
  return { close: () => clearInterval(timer) }
}

// Progress heartbeat text (plans/STATS_PLAN.md §4.5): task elapsed now reads
// the stats task bucket's cross-interruption cumulative (with live
// extrapolation of the open segment), replacing the old in-memory since —
// trustworthy from the first extrapolation after a process restart.
// Returns the full message line; undefined when there is nothing to report
// (no task / no subtasks) or the guard fails.
// Guards on statsId === task.id: readings are trustworthy only when the task
// bucket identity matches the current task (during the window before statsTask
// switches, or when no handle is loaded, statsId is undefined).
// AUTO-DECISION: on guard failure skip this report (return undefined), no
// in-memory-since fallback. The "fall back to in-memory timing" alternative
// would return to the old extrapolation distortion during the guard vacuum
// after a cross-interruption restart, and dual calibers would make the text
// drift between cumulative and this-process-only readings; the heartbeat runs
// every 10 minutes, skipping one beats caliber distortion — rejected.
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
  const estimate = done ? formatDuration((elapsed / done) * (total - done)) : "unknown (no completed subtasks yet)"
  const totalText = formatDuration(elapsed)
  const localText = formatDuration(elapsed - boot.task.wallMs)
  // "this process" is only printed when ≠ cumulative (without interruption the
  // two are equal, text equivalent to current behavior); compared after
  // formatting, not printed when the delta is under 1 second (same rounding).
  const local = localText === totalText ? "" : ` (this process ${localText})`
  return `  ⏳ ${task.id} subtask progress ${done}/${total}, elapsed ${totalText}${local}, est. remaining ${estimate}`
}
