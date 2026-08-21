import { readdir } from "node:fs/promises"
import { join, relative } from "node:path"
import { log } from "./log"
import { block, countSubtasks, load, next } from "./plan"
import { protect, unprotect } from "./protect"
import { runTask } from "./runner"
import { ensure } from "./server"

// Exit codes: 0 = all tasks done, 1 = usage/setup error, 2 = blocked, waiting
// for a human to resolve the issue outside the session and re-run. A blocked
// task needs no `answer`: re-running resumes it directly.
export async function runAll(
  directory: string,
  opts: {
    agent?: string
    server?: string
    verbose?: boolean
    waitAnswer?: number
    commitSubtask?: boolean
  },
): Promise<number> {
  const path = join(directory, "PLAN.md")
  if (!(await Bun.file(path).exists())) {
    console.error(`未找到计划文件: ${path}`)
    return 1
  }

  const watcher = opts.verbose ? watchFiles(directory) : undefined
  const progress = opts.commitSubtask ? trackSubtasks(path) : undefined
  // Driver-owned files go read-only for the whole run; driver writes
  // re-apply it, and the finally below restores writability so a human can
  // edit the files (e.g. opencode.json after a permission block).
  await protect(directory)
  let server: Awaited<ReturnType<typeof ensure>> | undefined
  try {
    server = await ensure(directory, opts.server)
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
      const outcome = await runTask(server.client, plan, task, {
        agent: opts.agent,
        verbose: opts.verbose,
        waitAnswer: opts.waitAnswer,
        commitSubtask: opts.commitSubtask,
      })
      if (outcome.type === "blocked") {
        await block(path, task.id, outcome.question)
        log(`⏸ ${task.id} 已阻塞,问题已写入 PLAN.md:\n${outcome.question}`)
        return 2
      }
      log(`✓ ${task.id} 完成(用时 ${formatDuration(Date.now() - start)})`)
    }
  } finally {
    watcher?.close()
    progress?.close()
    server?.close()
    await unprotect(directory)
  }
}

// Verbose mode: every 10s list files newly appearing in `git status`
// (modified, staged, or untracked), so a human watching the terminal can
// follow the agent's progress on disk.
function watchFiles(directory: string) {
  let seen = new Set<string>()
  const timer = setInterval(async () => {
    const changed = await gitChangedFiles(directory).catch(() => [] as string[])
    const fresh = changed.filter((file) => !seen.has(file))
    seen = new Set(changed)
    if (fresh.length) log(`  ✎ 变更文件:\n${fresh.map((file) => `    ${file}`).join("\n")}`)
  }, 10_000)
  return { close: () => clearInterval(timer) }
}

// 变动文件只取 git status 的输出:目标目录自身(可能位于更大的仓库中,
// 用 pathspec `-- .` 限定该子树)加上所有含 .git 的子目录(嵌套仓库,
// 含 worktree/子模块的 .git 文件)。返回相对目标目录的路径。
async function gitChangedFiles(directory: string): Promise<string[]> {
  const inRepo =
    (await Bun.spawn(["git", "-C", directory, "rev-parse", "--is-inside-work-tree"], {
      stdout: "ignore",
      stderr: "ignore",
    }).exited) === 0
  const roots = new Set<string>(inRepo ? [directory] : [])
  // 手工逐层遍历而非 readdir recursive,以免每 10 秒扫一遍 .git/node_modules 内部。
  const pending = [directory]
  while (pending.length) {
    const dir = pending.pop()!
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    if (entries.some((entry) => entry.name === ".git")) roots.add(dir)
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== ".git" && entry.name !== "node_modules") {
        pending.push(join(dir, entry.name))
      }
    }
  }
  const lists = await Promise.all([...roots].map((root) => gitStatusFiles(directory, root)))
  return lists.flat()
}

// --porcelain -z --no-renames -uall: 逐文件 NUL 分隔输出,不带改名箭头;每条为
// "XY <path>",路径相对仓库根(worktree 顶层),需换算为相对目标目录的路径。
// -uall 下仍以 "?? dir/" 折叠输出的只有嵌套仓库目录(其内部文件由该仓库自身
// 的 status 单独列出),跳过以免重复。
async function gitStatusFiles(directory: string, root: string): Promise<string[]> {
  const top = Bun.spawn(["git", "-C", root, "rev-parse", "--show-toplevel"], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const toplevel = (await new Response(top.stdout).text()).trim()
  if ((await top.exited) !== 0 || !toplevel) return []
  const proc = Bun.spawn(
    ["git", "-C", root, "status", "--porcelain", "-z", "--no-renames", "-uall", "--", "."],
    { stdout: "pipe", stderr: "ignore" },
  )
  const output = await new Response(proc.stdout).text()
  if ((await proc.exited) !== 0) return []
  return output
    .split("\0")
    .filter((entry) => entry && !(entry.startsWith("?? ") && entry.endsWith("/")))
    .map((entry) => relative(directory, join(toplevel, entry.slice(3))))
}

// --commit-subtask mode: every 30s re-read PLAN.md, report the current task's
// subtask checkbox progress and a remaining-time estimate. The estimate is a
// simple linear projection from completed items, so its precision is bounded
// by this check interval.
function trackSubtasks(path: string) {
  let current = { id: "", since: 0 }
  const timer = setInterval(async () => {
    const plan = await load(path).catch(() => undefined)
    const task = plan && (plan.tasks.find((t) => t.status === "in_progress") ?? next(plan))
    if (!task) return
    if (task.id !== current.id) current = { id: task.id, since: Date.now() }
    const { done, total } = countSubtasks(task.body)
    if (!total) return
    const elapsed = Date.now() - current.since
    const estimate = done ? formatDuration((elapsed / done) * (total - done)) : "未知(尚无已完成的子任务)"
    log(`  ⏳ ${task.id} 子任务进度 ${done}/${total},已用时 ${formatDuration(elapsed)},预计剩余 ${estimate}`)
  }, 30_000)
  return { close: () => clearInterval(timer) }
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  if (!minutes) return `${seconds} 秒`
  return `${minutes} 分 ${seconds % 60} 秒`
}
