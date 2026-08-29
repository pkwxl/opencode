import { createInterface } from "node:readline/promises"
import { readdir } from "node:fs/promises"
import { join, relative } from "node:path"
import { startInteractive, type Interactive } from "./interactive"
import { banner, log, vlog } from "./log"
import { block, countSubtasks, load, next, resetInProgress } from "./plan"
import { renderDryrun, type CommitMode } from "./prompt"
import { protect, unprotect } from "./protect"
import { commitAll, runOnce, runTask, type SubtaskMode } from "./runner"
import { ensure } from "./server"
import templateAgent from "../templates/.opencode/agent/auto.md" with { type: "file" }

// AGENTS.md 指针块: CURRENT.md 由 driver 整文件重写,指针本身永不变更。
// AGENTS.md 作为 system context 每个 provider turn 现场重读,不随上下文压缩丢失。
// AGENTS.md 不再置只读(任务可更新它),run/init 只确保指针块存在。
const POINTER = `<!-- opencode-auto:start -->
本目录由 opencode-auto 驱动。每个会话开始必须先读 \`CURRENT.md\`(若存在),其中是当前
任务的完整内容与进度,优先于一切会话记忆。不要编辑 \`CURRENT.md\` 与 \`PLAN.md\`,
它们由 driver 独占维护。
<!-- opencode-auto:end -->`

// 幂等维护 AGENTS.md 指针块: 只追加,从不改写已有内容。返回是否发生了写入。
export async function ensurePointer(directory: string): Promise<boolean> {
  const agentsFile = join(directory, "AGENTS.md")
  const existing = await Bun.file(agentsFile).text().catch(() => "")
  if (existing.includes("opencode-auto:start")) return false
  await Bun.write(agentsFile, existing ? `${existing.trimEnd()}\n\n${POINTER}\n` : `# AGENTS.md\n\n${POINTER}\n`)
  return true
}

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
    commit?: CommitMode
    subtask?: SubtaskMode
    // dryrun: 只跑一次权限预检会话并输出报告,不执行任何任务。
    dryrun?: boolean
    // 会话复用的上下文已用量上限(tokens),缺省由 runner 按 64k 处理。
    contextLimit?: number
    // --review 质量审核轮数上限(0 = 不启用),透传给 runTask。
    review?: number
    // --interactive: 常驻 stdin 旁路接收人工输入注入当前会话(与 --verbose 互斥,
    // 调用方已把 verbose 记录级别打开,前台明细静默)。
    interactive?: boolean
  },
): Promise<number> {
  const path = join(directory, "PLAN.md")
  if (!(await Bun.file(path).exists())) {
    log(`未找到计划文件: ${path}`)
    return 1
  }

  // run 前完整性检查: agent 契约文件缺失时服务端只回 UnknownError(不含根因),
  // 此处提前报出并提示恢复方式;与模板不一致仅警告(init 会刷新该文件)。
  const agentName = opts.agent ?? "auto"
  const agentFile = join(directory, ".opencode/agent", `${agentName}.md`)
  const agentText = await Bun.file(agentFile).text().catch(() => undefined)
  if (agentText === undefined) {
    log(`⏸ 缺少 agent 契约文件: .opencode/agent/${agentName}.md(缺失会导致下发任务失败: UnknownError)`)
    log(`  恢复方式: 运行 opencode-auto init ${directory} 重建该文件(或手工补回),然后重新运行`)
    return 1
  }
  if (agentName === "auto" && agentText !== (await Bun.file(templateAgent).text())) {
    log(`⚠ .opencode/agent/auto.md 与当前模板不一致(可能为旧版契约),可运行 opencode-auto init ${directory} 刷新`)
  }

  const watcher = opts.verbose ? watchFiles(directory) : undefined
  const progress = opts.commit === "subtask" ? trackSubtasks(path) : undefined
  // Driver-owned files go read-only for the whole run; driver writes
  // re-apply it, and the finally below restores writability so a human can
  // edit the files (e.g. opencode.json after a permission block).
  await protect(directory)
  // 启动会话前确保 AGENTS.md 指针块存在(缺失则补写);AGENTS.md 本身保持可写,
  // 任务可更新它的其余内容。
  if (await ensurePointer(directory)) log("已补写: AGENTS.md 指针块")
  let server: Awaited<ReturnType<typeof ensure>> | undefined
  // --interactive 旁路输入控制器;server 就绪后创建,finally 中关闭。
  let repl: Interactive | undefined
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
    if (opts.interactive) {
      repl = startInteractive(server.client, opts.agent)
      log("💬 交互模式: 回车把输入作为额外消息发往当前会话(无活动会话时丢弃)")
    }
    if (opts.dryrun) {
      const result = await runOnce(server.client, "权限预检", renderDryrun(), {
        agent: opts.agent,
        dir: directory,
        verbose: opts.verbose,
        waitAnswer: opts.waitAnswer,
        dryrun: true,
        contextLimit: opts.contextLimit,
        interactive: repl,
      })
      if (result.type === "blocked") {
        log(`⏸ 预检会话受阻:\n${result.question}`)
        return 2
      }
      log(`✓ 权限预检完成,报告已写入 .auto/dryrun.md,要点:\n\n${result.lastText}`)
      return 0
    }
    let ran = 0
    // 中断恢复: 上次运行被 kill/Ctrl+C 可能遗留 in_progress 标记(无会话在跑),
    // 重置为 pending;主循环经 next() 照样续跑,attempts 保留。
    const stale = await resetInProgress(path)
    if (stale.length) log(`↻ 恢复中断状态: ${stale.join(", ")} 从 in_progress 重置为 pending`)
    for (;;) {
      const plan = await load(path)
      const task = next(plan)
      if (!task) {
        // --commit once: 任务期间不提交,全部完成后开一次整体提交会话。
        if (opts.commit === "once" && ran > 0) {
          banner("全部任务完成,整体提交")
          const outcome = await commitAll(server.client, plan, {
            agent: opts.agent,
            dir: directory,
            verbose: opts.verbose,
            waitAnswer: opts.waitAnswer,
            contextLimit: opts.contextLimit,
            interactive: repl,
          })
          if (outcome.type !== "completed") {
            const detail = outcome.type === "blocked" ? outcome.question : outcome.reason
            log(`⏸ 整体提交未完成(任务本身已全部完成):\n${detail}`)
            return 2
          }
        }
        log("✓ 全部任务已完成")
        return 0
      }
      // 首个任务不等待;仅当存在后继任务时在任务之间暂停。
      if (ran > 0 && opts.waitBetween) await waitBetweenTasks(opts.waitBetween, task.id, repl)
      if (task.status === "blocked" && task.question) {
        log(`↻ ${task.id} 此前因问题阻塞,未填写 answer,直接续跑:\n${task.question}`)
      }
      banner(`${task.id} ${task.title}`)
      log(`▶ ${task.id} 开始执行(第 ${task.attempts + 1} 次尝试)`)
      const start = Date.now()
      const outcome = await runTask(server.client, plan, task, {
        agent: opts.agent,
        dir: directory,
        verbose: opts.verbose,
        waitAnswer: opts.waitAnswer,
        commit: opts.commit,
        subtask: opts.subtask,
        contextLimit: opts.contextLimit,
        review: opts.review,
        interactive: repl,
      })
      if (outcome.type === "blocked") {
        await block(path, task.id, outcome.question)
        log(`⏸ ${task.id} 已阻塞,问题已写入 PLAN.md:\n${outcome.question}`)
        return 2
      }
      if (outcome.type === "incomplete") {
        log(`⏸ ${task.id} 未完成,已回退为 pending。请改进 PLAN.md 中该任务的描述后重新运行:\n${outcome.reason}`)
        return 2
      }
      log(`✓ ${task.id} 完成(用时 ${formatDuration(Date.now() - start)})`)
      ran++
    }
  } finally {
    process.off("SIGINT", onSigint)
    repl?.close()
    watcher?.close()
    progress?.close()
    server?.close()
    await unprotect(directory)
  }
}

// --wait-between: 任务完成后、下一任务开始前暂停等待人工;回车(任意输入)
// 立即继续,超时自动继续。与 runner 的 askHuman 一样转发 readline 截获的 ^C,
// 使暂停期间连续两次 Ctrl+C 同样能强制终止。
// --interactive 下改由常驻输入行接收(语义不变),避免两个 readline 争抢 stdin。
async function waitBetweenTasks(minutes: number, nextID: string, repl?: Interactive) {
  const promptText = `⏸ 任务间暂停: 回车立即开始 ${nextID},或等待 ${minutes} 分钟自动继续: `
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
    if (fresh.length) vlog(`  ✎ 变更文件:\n${fresh.map((file) => `    ${file}`).join("\n")}`)
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

// --commit subtask mode: every 30s re-read PLAN.md, report the current task's
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
