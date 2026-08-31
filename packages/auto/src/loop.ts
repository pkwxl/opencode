import { createInterface } from "node:readline/promises"
import { stat } from "node:fs/promises"
import { join, relative } from "node:path"
import { appendFinalTask, generateFinalTask, routeFinal, type FinalProposal } from "./final"
import { commitTree, pendingChanges, repoRoots } from "./git"
import { startInteractive, type Interactive } from "./interactive"
import { banner, log, vlog } from "./log"
import type { ModeSpec } from "./mode"
import { block, countSubtasks, load, next, resetInProgress, setStatus, type Plan } from "./plan"
import { renderDryrun, stageText } from "./prompt"
import { protect, unprotect } from "./protect"
import { peekProgress } from "./resume"
import { runOnce, runTask, type PermissionMode, type SubtaskMode } from "./runner"
import { manage, type ServerHandle } from "./server"
import { usePromptLibrary } from "./template"
import templateAgent from "../templates/.opencode/agent/auto.md" with { type: "file" }

// AGENTS.md 指针块: CURRENT.md 由 driver 整文件重写,指针本身永不变更。
// AGENTS.md 作为 system context 每个 provider turn 现场重读,不随上下文压缩丢失;
// 它有更新时 driver 会在下一个新会话前重启 server,使新会话必定加载最新内容。
// AGENTS.md 不置只读(任务可更新它),run/init 只确保指针块存在。
const POINTER = `<!-- opencode-auto:start -->
本目录由 opencode-auto 驱动。每个会话开始必须先读 \`CURRENT.md\`(若存在),其中是当前
任务的完整内容与进度,优先于一切会话记忆。不要编辑 \`CURRENT.md\` 与 \`PLAN.md\`,
它们由 driver 独占维护。
<!-- opencode-auto:end -->`

// AGENTS.md 验证原则块: 独立于指针块的第二个标记块,旧目标目录再次 init 也能补写。
// 内容与 check 命令检查的原则一致(见 src/check.ts)。
const VERIFY_PRINCIPLE = `<!-- opencode-auto:verify:start -->
验证原则: 任务级验证脚本与验证命令一律由 driver 在会话外执行,任何会话不要直接
运行它们来下验收结论;验收标准写在任务的 verify 字段。若会话认为验证脚本本身有
问题,可编写新的验证脚本替换指定脚本(tmp/verify.sh,目标目录下 driver 管理的
工作目录),由 driver 重新执行并把输出回传给独立判定会话。判定会话另可在 driver
授权下更新 PLAN.md 中后续未完成任务的 verify 字段(把验证经验沉淀到后续任务,
仅限 verify 字段),除此之外 PLAN.md 与 CURRENT.md 由 driver 独占维护。任务描述
与项目规范不要出现与此相违背的指示(可用 opencode-auto check 检查)。
<!-- opencode-auto:verify:end -->`

// AGENTS.md 提交原则块: 第三个标记块,与验证原则对等——提交执行权在 driver。
const COMMIT_PRINCIPLE = `<!-- opencode-auto:commit:start -->
提交原则: 会话结束后由 driver 递归统一提交全部改动(先嵌套子仓库后本仓库),
提交信息携带任务编号与阶段;任何会话不要执行 git commit/amend/rebase 等提交
类命令,也不要修改提交历史。需要留档的变更背景写入 docs/ 文档,由 driver 的
提交一并纳入。任务描述与项目规范不要出现与此相违背的指示(可用
opencode-auto check 检查)。
<!-- opencode-auto:commit:end -->`

// 幂等维护 AGENTS.md 的 opencode-auto 块: 指针块、验证原则块与提交原则块各自
// 独立判断、只追加,从不改写已有内容。返回补写了哪些块。
export async function ensurePointer(directory: string): Promise<{ pointer: boolean; principle: boolean; commit: boolean }> {
  const agentsFile = join(directory, "AGENTS.md")
  const existing = await Bun.file(agentsFile).text().catch(() => "")
  let text = existing
  const pointer = !text.includes("opencode-auto:start")
  if (pointer) text = text ? `${text.trimEnd()}\n\n${POINTER}\n` : `# AGENTS.md\n\n${POINTER}\n`
  const principle = !text.includes("opencode-auto:verify:start")
  if (principle) text = `${text.trimEnd()}\n\n${VERIFY_PRINCIPLE}\n`
  const commit = !text.includes("opencode-auto:commit:start")
  if (commit) text = `${text.trimEnd()}\n\n${COMMIT_PRINCIPLE}\n`
  if (pointer || principle || commit) await Bun.write(agentsFile, text)
  return { pointer, principle, commit }
}

// 确保 .gitignore 忽略 driver 工作目录: tmp/(verify 脚本与输出,位于目标目录内)
// 与 .auto/(运行日志、进度恢复记录与判定文件等运行时状态)。统一提交会提交全部
// 未提交改动,不忽略会把它们带进提交。已有等价条目则跳过;非 git 目录(无 .git
// 且无 .gitignore)不做任何事。返回是否追加了条目。
export async function ensureGitignore(directory: string): Promise<boolean> {
  const file = join(directory, ".gitignore")
  const existing = await Bun.file(file).text().catch(() => undefined)
  // .git 可能是目录(普通仓库)或文件(worktree/子模块),stat 两者皆可。
  if (existing === undefined && !(await stat(join(directory, ".git")).then(() => true, () => false))) return false
  const ignored = (entry: string) =>
    (existing ? existing.split("\n") : []).some((line) => {
      const normalized = line.trim().replace(/^\//, "").replace(/\/$/, "")
      return normalized === entry.replace(/\/$/, "")
    })
  const missing = ["tmp/", ".auto/"].filter((entry) => !ignored(entry))
  if (!missing.length) return false
  await Bun.write(file, `${existing ? `${existing.trimEnd()}\n` : ""}${missing.join("\n")}\n`)
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
    // --commit false: 关闭会话后统一提交(缺省启用;提交机制见 src/git.ts)。
    commit?: boolean
    subtask?: SubtaskMode
    // dryrun: 只跑一次权限预检会话并输出报告,不执行任何任务。
    dryrun?: boolean
    // 会话复用的上下文已用量上限(tokens),缺省由 runner 按 64k 处理。
    contextLimit?: number
    // --review 质量审核轮数上限(0 = 不启用),透传给 runTask。
    review?: number
    // --verify: 启用 driver 的任务级三段式验收(缺省不启用,任务收尾后直接标
    // done),透传给 runTask。
    verify?: boolean
    // --early: 审核会话与 driver 执行 verify 脚本并行(需 review 已启用),透传给
    // runTask;窗口时序见设计文档 F 节。
    early?: boolean
    // --permission: 权限请求的处理策略(缺省 ask-deny),透传给 runner 的会话监听。
    permission?: PermissionMode
    // --interactive: 常驻 stdin 旁路接收人工输入注入当前会话(与 --verbose 互斥,
    // 调用方已把 verbose 记录级别打开,前台明细静默)。
    interactive?: boolean
    // verify 脚本看门狗: 持续无输出的判定窗口与绝对时长上限(毫秒),透传给
    // runner 的 runVerifyScript(--verify-idle / --verify-max 以分钟设定)。
    verifyIdleMs?: number
    verifyMaxMs?: number
    // -m/--mode 场景模式(缺省 migrate),透传给 runTask 的提示词渲染。
    mode?: ModeSpec
    // --final-review 终审闭环的审计轮上限(0 = 不启用,含首轮 audit): 任务全部
    // 完成后按 docs/mode-final-review-design.md B/C 节推进——终审阶段是入
    // PLAN.md 的 T-F 真任务,本循环只做"生成任务 → 跑任务 → 解析报告路由"。
    finalReview?: number
  },
): Promise<number> {
  const path = join(directory, "PLAN.md")
  if (!(await Bun.file(path).exists())) {
    log(`未找到计划文件: ${path}`)
    return 1
  }

  // 提示词库: 装载目标目录 .opencode/auto/prompts/ 覆盖(协议敏感模板做关键
  // 内容校验,失败按用法错误退出)。之后 render* 同步渲染,无需再感知目录。
  try {
    usePromptLibrary(directory)
  } catch (error) {
    log(error instanceof Error ? error.message : String(error))
    return 1
  }

  // --early 依赖 verify 脚本执行窗口;未启用 --verify 时窗口不存在,审核降级为串行。
  if (opts.early && !opts.verify) log("ℹ 未启用 --verify,--early 的并行审核窗口不存在,质量审核改为串行执行")

  // --agent 缺省取 auto 契约 agent(init 生成的自主执行契约);run 前完整性检查:
  // agent 契约文件缺失时服务端只回 UnknownError(不含根因),此处提前报出并提示
  // 恢复方式;与模板不一致仅警告(init 会刷新该文件)。
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
  // 每 10 分钟上报当前任务的子任务进度与预计剩余时间(基于 PLAN.md 勾选状态)。
  const progress = trackSubtasks(path)
  // Driver-owned files go read-only for the whole run; driver writes
  // re-apply it, and the finally below restores writability so a human can
  // edit the files (e.g. opencode.json after a permission block).
  await protect(directory)
  // 启动会话前确保 AGENTS.md 指针块与验证/提交原则块存在(缺失则补写);AGENTS.md
  // 本身保持可写,任务可更新它的其余内容(有更新时 driver 会在新会话前重启 server)。
  const ensured = await ensurePointer(directory)
  if (ensured.pointer) log("已补写: AGENTS.md 指针块")
  if (ensured.principle) log("已补写: AGENTS.md 验证原则块")
  if (ensured.commit) log("已补写: AGENTS.md 提交原则块")
  if (await ensureGitignore(directory)) log("已更新: .gitignore 忽略 tmp/ 与 .auto/(driver 工作目录与运行时状态)")
  // 工作区已有未提交改动会被 driver 的下一次提交一并纳入(统一提交为全量清扫
  // 语义,与此前会话清扫提交一致),提前提示用户。dryrun 不做任何提交,不提示。
  if (opts.commit !== false && !opts.dryrun && (await pendingChanges(directory))) {
    log("⚠ 工作区已有未提交改动,driver 的下一次统一提交会将它们一并纳入(如需隔离请先自行提交)")
  }
  let server: ServerHandle | undefined
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
    server = await manage(directory, opts.server)
    if (opts.interactive) {
      repl = startInteractive(server.client, agentName)
      log("💬 交互模式: 回车把输入作为额外消息发往当前会话(无活动会话时丢弃)")
    }
    if (opts.dryrun) {
      const result = await runOnce(server.client, "权限预检", renderDryrun(), {
        agent: agentName,
        dir: directory,
        verbose: opts.verbose,
        waitAnswer: opts.waitAnswer,
        dryrun: true,
        contextLimit: opts.contextLimit,
        interactive: repl,
        server,
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
    // 重置为 pending;主循环经 next() 照样续跑,attempts 保留。距中断较近时链上
    // 会话的进度记录(.auto/progress.json)使 runTask 复用原会话继续。
    const stale = await resetInProgress(path)
    if (stale.length) log(`↻ 恢复中断状态: ${stale.join(", ")} 从 in_progress 重置为 pending`)
    // 精确恢复: 进度记录在验收(verify,且 --review 启用)或质量审核(review)阶段
    // 中断的任务,验收通过时已被标 done——next() 会跳过它,审核永不补跑;置回
    // in_progress 使主循环重入该任务,runTask 依记录的阶段直接续跑。
    const record = await peekProgress(directory)
    if (record?.phase && (record.phase.kind === "review" || (record.phase.kind === "verify" && (opts.review ?? 0) > 0))) {
      const fresh = await load(path)
      const pending = fresh.tasks.find((task) => task.id === record.task)
      if (pending?.status === "done") {
        await setStatus(path, pending.id, "in_progress")
        log(`↻ ${pending.id} 上次中断于${record.phase.kind === "review" ? "质量审核" : "任务级验收"}阶段(任务已标 done),置回 in_progress 补跑`)
      }
    }
    // advanceFinal 闭包内引用会失去窄化,以 const 捕获已就绪的 server 句柄。
    const serverHandle = server
    // --final-review 终审闭环推进(设计文档 B.2/C): 路由纯函数依(带 final 标记的
    // 任务及其状态,docs/final/ 产物)决定下一步——开生成会话产出提案、提案已
    // 产出直接解析追加(C.3)、熔断/报告异常 block 对应终审任务(B.5/C.4);追加后
    // 主循环 next() 按文件顺序自然拾取,无新增持久化状态。announce 为真时
    // (next() 为空的启动挂点)先打印终审横幅;runTask 完成后的路由挂点不打印。
    // 返回 appended = 已追加任务续跑、stopped = 阻塞退出(退出码 2)、
    // idle = 无需推进(存在未完成终审任务或终审已完成)。
    const advanceFinal = async (plan: Plan, announce = false): Promise<"appended" | "stopped" | "idle"> => {
      const route = await routeFinal(directory, plan, opts.finalReview ?? 0)
      if (route.type === "wait" || route.type === "complete") return "idle"
      if (route.type === "block") {
        await block(path, route.task, route.question)
        log(`⏸ ${route.task} 已阻塞,问题已写入 PLAN.md:\n${route.question}`)
        return "stopped"
      }
      if (announce) banner("全部任务完成,进入终审闭环")
      const append = async (proposal: FinalProposal) => {
        const id = await appendFinalTask(path, plan, route.stage, route.round, proposal)
        log(`✓ 已追加终审任务 ${id}「${stageText(route.stage)}」,主循环继续执行`)
        return "appended" as const
      }
      if (route.type === "append") {
        log(`↻ 终审提案 docs/final/plan-${route.stage}-r${route.round}.md 已产出(追加前中断),直接解析追加`)
        return append(route.proposal)
      }
      log(`▶ 终审闭环: 开生成会话规划「${stageText(route.stage)}」任务(第 ${route.round} 轮)`)
      const generated = await generateFinalTask(serverHandle.client, plan, route.stage, route.round, route.prior, {
        agent: agentName,
        dir: directory,
        verbose: opts.verbose,
        waitAnswer: opts.waitAnswer,
        contextLimit: opts.contextLimit,
        permission: opts.permission,
        interactive: repl,
        server: serverHandle,
        mode: opts.mode,
      })
      if (generated.type === "blocked") {
        log(`⏸ 终审任务生成会话受阻(隐性阻塞,请检查后重新运行):\n${generated.question}`)
        return "stopped"
      }
      return append(generated.proposal)
    }
    for (;;) {
      const plan = await load(path)
      const task = next(plan)
      if (!task) {
        // --final-review: next() 为空且终审未完成 → 推进终审闭环(生成/追加下一
        // 阶段任务后续跑循环);终审完成则照常退出。
        if ((opts.finalReview ?? 0) > 0) {
          const advanced = await advanceFinal(plan, true)
          if (advanced === "stopped") return 2
          if (advanced === "appended") continue
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
        agent: agentName,
        dir: directory,
        verbose: opts.verbose,
        waitAnswer: opts.waitAnswer,
        commit: opts.commit,
        subtask: opts.subtask,
        contextLimit: opts.contextLimit,
        review: opts.review,
        early: opts.early,
        verify: opts.verify,
        permission: opts.permission,
        interactive: repl,
        server,
        verifyIdleMs: opts.verifyIdleMs,
        verifyMaxMs: opts.verifyMaxMs,
        mode: opts.mode,
      })
      if (outcome.type === "blocked") {
        await block(path, task.id, outcome.question)
        log(`⏸ ${task.id} 已阻塞,问题已写入 PLAN.md:\n${outcome.question}`)
        // 中断现场也提交: 保存断点(阻塞问题、CURRENT.md 中断备注),支持回滚到断点。
        if (opts.commit !== false) {
          await commitTree(directory, task, { stage: "interrupted", subject: `${task.id} ${task.title}: 中断(阻塞)` })
        }
        return 2
      }
      if (outcome.type === "incomplete") {
        log(`⏸ ${task.id} 未完成,已回退为 pending。请改进 PLAN.md 中该任务的描述后重新运行:\n${outcome.reason}`)
        if (opts.commit !== false) {
          await commitTree(directory, task, { stage: "interrupted", subject: `${task.id} ${task.title}: 中断(回退 pending)` })
        }
        return 2
      }
      log(`✓ ${task.id} 完成(用时 ${formatDuration(Date.now() - start)})`)
      ran++
      // 任务完成的终态提交: PLAN.md 的 [done]/verified 与 CURRENT.md 的删除在此
      // 一并落账(各会话产出已随会话提交,这里是收口);终审路由追加的下一任务
      // 改动归入其生成/执行会话的提交。
      if (opts.commit !== false) {
        await commitTree(directory, task, { stage: "done", subject: `${task.id} ${task.title}: 完成` })
      }
      // --final-review 路由挂点: runTask 完成且任务带 final 标记 → 解析阶段报告
      // 路由追加下一任务(设计文档 B.2);熔断/报告异常立即阻塞退出,追加的任务
      // 由下一次 next() 按文件顺序拾取。
      if ((opts.finalReview ?? 0) > 0 && task.final) {
        const advanced = await advanceFinal(await load(path))
        if (advanced === "stopped") return 2
      }
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
// 含 worktree/子模块的 .git 文件;仓库发现复用 src/git.ts 的 repoRoots)。
// 返回相对目标目录的路径。
async function gitChangedFiles(directory: string): Promise<string[]> {
  const lists = await Promise.all((await repoRoots(directory)).map((root) => gitStatusFiles(directory, root)))
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

// 每 10 分钟重读 PLAN.md,上报当前任务的子任务勾选进度与剩余时间估计(估计为
// 已完成项的线性外推,精度受该检查间隔约束)。
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
  }, 10 * 60_000)
  return { close: () => clearInterval(timer) }
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  if (!minutes) return `${seconds} 秒`
  return `${minutes} 分 ${seconds % 60} 秒`
}
