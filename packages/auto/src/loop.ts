import { createInterface } from "node:readline/promises"
import { readdir } from "node:fs/promises"
import { join, relative } from "node:path"
import { log } from "./log"
import { block, countSubtasks, load, next } from "./plan"
import { protect, unprotect } from "./protect"
import { runTask } from "./runner"
import { ensure } from "./server"

// Exit codes: 0 = all tasks done, 1 = usage/setup error, 2 = blocked, waiting
// for a human to resolve the issue outside the session and re-run,
// 130 = force-killed by double Ctrl+C. A blocked
// task needs no `answer`: re-running resumes it directly.
export async function runAll(
  directory: string,
  opts: {
    agent?: string
    server?: string
    verbose?: boolean
    waitAnswer?: number
    // 任务间暂停等待人工的分钟数(0 = 不等待);回车立即继续,超时自动继续。
    waitBetween?: number
    commitSubtask?: boolean
    // 会话复用的上下文已用量上限(tokens),缺省由 runner 按 64k 处理。
    contextLimit?: number
  },
): Promise<number> {
  const path = join(directory, "PLAN.md")
  if (!(await Bun.file(path).exists())) {
    log(`未找到计划文件: ${path}`)
    return 1
  }

  const watcher = opts.verbose ? watchFiles(directory) : undefined
  const progress = opts.commitSubtask ? trackSubtasks(path) : undefined
  // Driver-owned files go read-only for the whole run; driver writes
  // re-apply it, and the finally below restores writability so a human can
  // edit the files (e.g. opencode.json after a permission block).
  await protect(directory)
  let server: Awaited<ReturnType<typeof ensure>> | undefined
  // 单次 Ctrl+C 不终止(运行期间事件流/子进程可能吞掉或挂起默认退出),
  // 窗口期内连续第二次按下才强制终止:尽力恢复文件可写并关闭 server 后退出。
  let sigintAt = 0
  const onSigint = () => {
    const now = Date.now()
    if (now - sigintAt > 3000) {
      sigintAt = now
      log("⚠ 已捕获 Ctrl+C,3 秒内再次按下将强制终止运行")
      return
    }
    log("✋ 收到连续 Ctrl+C,强制终止")
    server?.close()
    void unprotect(directory).finally(() => process.exit(130))
    // 兜底:清理挂起时也要退出。
    setTimeout(() => process.exit(130), 1000).unref()
  }
  process.on("SIGINT", onSigint)
  try {
    server = await ensure(directory, opts.server)
    let ran = 0
    for (;;) {
      const plan = await load(path)
      const task = next(plan)
      if (!task) {
        log("✓ 全部任务已完成")
        return 0
      }
      // 首个任务不等待;仅当存在后继任务时在任务之间暂停。
      if (ran > 0 && opts.waitBetween) await waitBetweenTasks(opts.waitBetween, task.id)
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
        contextLimit: opts.contextLimit,
      })
      if (outcome.type === "blocked") {
        await block(path, task.id, outcome.question)
        log(`⏸ ${task.id} 已阻塞,问题已写入 PLAN.md:\n${outcome.question}`)
        return 2
      }
      log(`✓ ${task.id} 完成(用时 ${formatDuration(Date.now() - start)})`)
      ran++
    }
  } finally {
    process.off("SIGINT", onSigint)
    watcher?.close()
    progress?.close()
    server?.close()
    await unprotect(directory)
  }
}

// --wait-between: 任务完成后、下一任务开始前暂停等待人工;回车(任意输入)
// 立即继续,超时自动继续。与 runner 的 askHuman 一样转发 readline 截获的 ^C,
// 使暂停期间连续两次 Ctrl+C 同样能强制终止。
async function waitBetweenTasks(minutes: number, nextID: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  rl.on("SIGINT", () => process.kill(process.pid, "SIGINT"))
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const answer = await Promise.race([
      rl.question(`⏸ 任务间暂停: 回车立即开始 ${nextID},或等待 ${minutes} 分钟自动继续: `),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), minutes * 60_000)
      }),
    ])
    log(answer === undefined ? `⏳ 等待超时,自动继续 ${nextID}` : `→ 人工确认,继续 ${nextID}`)
  } finally {
    clearTimeout(timer)
    rl.close()
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
