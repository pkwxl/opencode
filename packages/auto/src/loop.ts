import { readdir, stat } from "node:fs/promises"
import { join, relative } from "node:path"
import { log } from "./log"
import { block, load, next } from "./plan"
import { runTask } from "./runner"
import { ensure } from "./server"

// Exit codes: 0 = all tasks done, 1 = usage/setup error, 2 = blocked, waiting
// for a human to resolve the issue outside the session and re-run. A blocked
// task needs no `answer`: re-running resumes it directly.
export async function runAll(
  directory: string,
  opts: { agent?: string; server?: string; verbose?: boolean; waitAnswer?: number },
): Promise<number> {
  const path = join(directory, "PLAN.md")
  if (!(await Bun.file(path).exists())) {
    console.error(`未找到计划文件: ${path}`)
    return 1
  }

  const watcher = opts.verbose ? watchFiles(directory) : undefined
  const server = await ensure(directory, opts.server)
  try {
    for (;;) {
      const plan = await load(path)
      const task = next(plan)
      if (!task) {
        log("✓ 全部任务已完成")
        return 0
      }
      if (task.status === "blocked" && task.question) {
        log(`↻ ${task.id} 此前因问题阻塞,未填写 answer,直接续跑:\n${task.question}`)
      }
      log(`▶ ${task.id}: ${task.title}(第 ${task.attempts + 1} 次尝试)`)
      const start = Date.now()
      const outcome = await runTask(server.client, plan, task, { agent: opts.agent, verbose: opts.verbose, waitAnswer: opts.waitAnswer })
      if (outcome.type === "blocked") {
        await block(path, task.id, outcome.question)
        log(`⏸ ${task.id} 已阻塞,问题已写入 PLAN.md:\n${outcome.question}`)
        return 2
      }
      log(`✓ ${task.id} 完成(用时 ${formatDuration(Date.now() - start)})`)
    }
  } finally {
    watcher?.close()
    server.close()
  }
}

// Verbose mode: every 10s list files modified since the previous check so a
// human watching the terminal can follow the agent's progress on disk.
function watchFiles(directory: string) {
  let since = Date.now()
  const timer = setInterval(async () => {
    const checkpoint = Date.now()
    const changed = await modifiedSince(directory, since).catch(() => [] as string[])
    since = checkpoint
    if (changed.length) log(`  ✎ 变更文件:\n${changed.map((file) => `    ${file}`).join("\n")}`)
  }, 10_000)
  return { close: () => clearInterval(timer) }
}

async function modifiedSince(directory: string, since: number): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !path.includes("/node_modules/") && !path.includes("/.git/"))
  const stats = await Promise.all(files.map(async (path) => ({ path, mtime: (await stat(path)).mtimeMs })))
  return stats.filter((entry) => entry.mtime > since).map((entry) => relative(directory, entry.path)).sort()
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  if (!minutes) return `${seconds} 秒`
  return `${minutes} 分 ${seconds % 60} 秒`
}
