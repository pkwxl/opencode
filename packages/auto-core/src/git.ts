import { readdir } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import { log } from "./log"

// driver 统一提交机制: 收回 AI 会话的提交权——任何会话结束后由 driver 递归提交
// 全部改动(先嵌套子仓库、后目标目录所在仓库),提交信息携带任务编号与阶段,
// 使 git 历史成为 AI 变更的审计轨迹(追踪与回滚的粒度 = 会话)。会话不执行
// git commit(AGENTS.md 提交原则块与 agent 契约同步约束)。

// 提交边界(commit-boundary-design.md):git 提交是执行单元(任务/子任务/隐藏任务)
// 完成条件的一部分——单元启动要求工作区 clean(依赖的信息全部由上一次提交固定),
// 收口要求改动全部落账且提交区间内只有 driver 提交。本文件提供三件套:
// - beginUnit: 单元启动门禁(clean 检查 + driver 独占状态文件遗留的自愈补提交 + 基线);
// - unitBaseline/unitViolations: SHA 基线与收口校验(外部提交检测);
// - commitPending: 隐藏任务幂等入口的"产物已落盘未提交 → 补提交即完成"(③)。
// --commit false / dryrun / 非 git 环境下门禁整体不生效。

// 提交信息: 中文标题行(人读)+ 机器可读 trailer(脚本化定位回滚点)。
// Auto-Task 任务编号(T-F*/PLAN 等)、Auto-Stage 阶段与序号(伪任务为旁路
// 阶段标签: phase-plan/phase-handover/phase-transition/knowledge/numbering/
// final-plan/doc-migrate/housekeeping/carryover 等);Auto-Stage 同时是"driver
// 提交"的机器判据(单元收口校验据此检出外部提交)。目标目录所在仓库的提交另以
// Auto-Nested 行记录**全部**嵌套仓库的最终(或最新)SHA——本轮有提交记新 SHA、
// 无提交记单元基线 SHA,使任一 root 提交都能对齐跨仓库状态(提交边界 D4)。
function message(subject: string, task: { id: string }, stage: string, nested: { rel: string; sha: string }[] = []): string {
  return [
    subject,
    "",
    `Auto-Task: ${task.id}`,
    `Auto-Stage: ${stage}`,
    ...nested.map((repo) => `Auto-Nested: ${repo.rel} @ ${repo.sha}`),
  ].join("\n")
}

// 提交标题(即会话标题,短标签方案 `T-NNN <label> <标题/子任务>`,见 runner.ts):
// 超过 100 字截断,git 标题行与会话列表都保持可读。
export function commitTitle(subject: string): string {
  return subject.length > 100 ? `${subject.slice(0, 100)}…` : subject
}

// 统一提交结果(commit-boundary-design.md P1): ok=false 时 failures 列出提交
// 失败的仓库(相对目标目录路径 + 首行错误)。空数组 = 全部成功或无需提交。
export type CommitResult = { ok: boolean; failures: { rel: string; error: string }[] }

// 会话后统一提交。逐仓库(深度优先,嵌套仓库先提交): 有未提交改动才
// git add -A + git commit,无改动跳过、非 git 环境整体跳过;单仓库失败计入
// failures 返回(调用方按完成条件处置——门禁关闭的调用方忽略返回值即旧行为)。
// subject 为标题行。
export async function commitTree(dir: string, task: { id: string; title: string }, info: { stage: string; subject: string }): Promise<CommitResult> {
  const roots = await repoRoots(dir)
  const subject = commitTitle(info.subject)
  const failures: { rel: string; error: string }[] = []
  for (const root of roots) {
    const rel = relative(dir, root) || "."
    try {
      if (!(await hasChanges(root))) continue
      const added = await git(root, ["add", "-A", "--", "."])
      if (added.code !== 0) {
        const error = `git add 退出码 ${added.code}(${firstLine(added.err || added.out)})`
        log(`  ⚠ git 提交失败(${rel}): ${error}`)
        failures.push({ rel, error })
        continue
      }
      // Auto-Nested 覆盖全部嵌套仓库(根仓库最后提交,届时各嵌套仓库已落定最终 SHA)。
      const nested = root === dir ? await nestedHeads(dir, roots) : undefined
      const committed = await git(root, [...(await identityArgs(root)), "commit", "-m", message(subject, task, info.stage, nested)])
      if (committed.code !== 0) {
        const error = firstLine(committed.err || committed.out) || `git commit 退出码 ${committed.code}`
        log(`  ⚠ git 提交失败(${rel}): ${error}(改动保留在工作区)`)
        failures.push({ rel, error })
        continue
      }
      log(`  ✓ git 提交(${rel}): ${subject}`)
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      log(`  ⚠ git 提交失败(${rel}): ${text}`)
      failures.push({ rel, error: firstLine(text) })
    }
  }
  return { ok: failures.length === 0, failures }
}

// 全部嵌套仓库的当前 HEAD(相对路径 + 短 SHA): 根仓库提交时逐个读取,使
// Auto-Nested 同时记录"本轮已提交"与"本轮未动"的嵌套仓库(后者即基线 SHA,
// 除非期间有外部提交——那会被 unitViolations 检出)。
async function nestedHeads(dir: string, roots: string[]): Promise<{ rel: string; sha: string }[]> {
  const heads: { rel: string; sha: string }[] = []
  for (const root of roots) {
    if (root === dir) continue
    heads.push({ rel: relative(dir, root) || ".", sha: (await git(root, ["rev-parse", "--short", "HEAD"])).out.trim() })
  }
  return heads
}

// 工作区是否已有未提交改动(run 启动时提示用户: 它们会被纳入 driver 的下一次提交)。
export async function pendingChanges(dir: string): Promise<boolean> {
  for (const root of await repoRoots(dir)) {
    if (await hasChanges(root)) return true
  }
  return false
}

// —— 单元提交边界(commit-boundary-design.md)——

// driver 独占状态文件(相对目标目录,protect.ts 拦截 AI 写入): 单元启动遇脏时,
// 脏区全属此清单 = 上次提交失败遗留的 driver 落账 → carryover 补提交自愈;
// 其余脏区(人工改动/AI 半途产物)一律阻塞交人工,不自动清扫。
const DRIVER_STATE_FILES = ["PLAN.md", "CURRENT.md"]

// 单元 SHA 基线: 逐仓库 HEAD 短 SHA(空仓库记空串——其后任何提交都发生在本单元
// 期间,收口校验全量检查)。
export type UnitBaseline = { root: string; sha: string }[]

export async function unitBaseline(dir: string): Promise<UnitBaseline> {
  const baseline: UnitBaseline = []
  for (const root of await repoRoots(dir)) {
    baseline.push({ root, sha: (await git(root, ["rev-parse", "--short", "HEAD"])).out.trim() })
  }
  return baseline
}

// 单元收口校验: ① 工作区必须 clean(统一提交成功后仍不净 = 有提交失败或新改动);
// ② 各仓库 基线..HEAD 区间内每个提交必须带 Auto-Stage trailer(= driver 提交),
// 出现无 trailer 的提交 = 期间有外部提交(人工/其他进程),破坏"提交即隔离边界"。
// 返回违规清单(空 = 通过);空基线(非 git 环境/门禁关闭)恒通过。
export async function unitViolations(dir: string, baseline: UnitBaseline): Promise<string[]> {
  if (!baseline.length) return []
  const problems: string[] = []
  const dirty = await changedFiles(dir)
  if (dirty.length) {
    problems.push(`工作区仍有未提交改动: ${dirty.slice(0, 5).join(", ")}${dirty.length > 5 ? ` 等 ${dirty.length} 个文件` : ""}`)
  }
  for (const { root, sha } of baseline) {
    const head = (await git(root, ["rev-parse", "--short", "HEAD"]).catch(() => undefined))?.out.trim()
    if (head === undefined || head === sha) continue
    // 基线为空串(单元启动时仓库尚无提交)→ 全部提交都在区间内。
    const bodies = await git(root, ["log", "-z", "--format=%B", ...(sha ? [`${sha}..HEAD`] : ["HEAD"])])
    const foreign = bodies.out
      .split("\0")
      .filter((body) => body.trim())
      .filter((body) => !body.includes("Auto-Stage:")).length
    if (foreign) {
      problems.push(`${relative(dir, root) || "."}: 检测到 ${foreign} 个非 driver 提交(无 Auto-Stage trailer),单元期间存在外部提交`)
    }
  }
  return problems
}

// 单元启动门禁结果: ok = 基线已记录(baseline 为 undefined 表示门禁关闭——
// --commit false / dryrun,收口校验随之跳过);dirty = 脏区不可自愈,交人工。
export type UnitGate = { type: "ok"; baseline: UnitBaseline | undefined } | { type: "dirty"; files: string[] }

// 单元启动门禁: 工作区 clean → 记基线放行;脏区全属 driver 独占状态文件 →
// carryover 补提交自愈后放行;其余脏区 → dirty(调用方阻塞停机,不写状态文件、
// 不做清扫提交——git 状态的决定权在人工)。
export async function beginUnit(
  dir: string,
  opts: { commit?: boolean; dryrun?: boolean },
  task: { id: string; title: string },
): Promise<UnitGate> {
  if (opts.commit === false || opts.dryrun) return { type: "ok", baseline: undefined }
  const dirty = await changedFiles(dir)
  if (dirty.length) {
    if (dirty.every((file) => DRIVER_STATE_FILES.includes(file))) {
      const healed = await commitTree(dir, task, { stage: "carryover", subject: `${task.id} carryover 状态落账补提交` })
      if (healed.ok) {
        log(`  ✓ 检测到 driver 状态文件未落账(${dirty.join(", ")}),已补提交自愈`)
        return { type: "ok", baseline: await unitBaseline(dir) }
      }
    }
    return { type: "dirty", files: dirty }
  }
  return { type: "ok", baseline: await unitBaseline(dir) }
}

// 隐藏任务幂等入口的 ③ 补提交: 指定产物文件任一在未提交清单 → 统一提交(补账)
// 并返回结果;均不在(已提交/不存在)→ "clean" 无动作。完成判定 = 产物落盘且已
// 提交,故补提交成功即视为完成。门禁关闭时空转。
export async function commitPending(
  dir: string,
  opts: { commit?: boolean; dryrun?: boolean },
  task: { id: string; title: string },
  info: { stage: string; subject: string },
  files: string[],
): Promise<"clean" | CommitResult> {
  if (opts.commit === false || opts.dryrun) return "clean"
  const dirty = await changedFiles(dir)
  if (!files.some((file) => dirty.includes(file))) return "clean"
  return commitTree(dir, task, info)
}

// 目标目录所在仓库及目录树下所有含 .git 的嵌套仓库根(排除 node_modules;
// 嵌套仓库内部继续下探,嵌套中的嵌套同样参与)。目标目录可能位于更大的
// 仓库中,以 git rev-parse 判定;提交范围由各 git 命令的 pathspec `.` 限定
// 在该子树内。返回按路径深度降序排序,保证先内后外提交;loop 的 verbose
// 变更文件监视(watchFiles)亦复用本发现。
export async function repoRoots(dir: string): Promise<string[]> {
  const inRepo = await git(dir, ["rev-parse", "--is-inside-work-tree"])
    .then((out) => out.code === 0)
    .catch(() => false)
  const roots = new Set<string>(inRepo ? [dir] : [])
  const pending = [dir]
  while (pending.length) {
    const current = pending.pop()!
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    if (entries.some((entry) => entry.name === ".git")) roots.add(current)
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== ".git" && entry.name !== "node_modules") {
        pending.push(join(current, entry.name))
      }
    }
  }
  return [...roots].sort((a, b) => depth(b) - depth(a))
}

function depth(path: string): number {
  return path.split(sep).length
}

// 工作区未提交变更文件清单(相对目标目录的路径): 目标目录自身(可能位于更大的
// 仓库中,用 pathspec `-- .` 限定该子树)加上所有含 .git 的子目录(嵌套仓库,含
// worktree/子模块的 .git 文件;仓库发现复用本文件的 repoRoots)。非 git 环境返回
// 空数组。
// 本函数(与 gitStatusFiles)自 loop.ts 上收至此,供 loop 的变更文件监视与
// resolve.ts 的会话收尾扫描共用: 从 loop.ts 导出会造成 loop → runner → resolve →
// loop 的循环依赖,在 resolve.ts 镜像一份则留下两份必须同步演进的仓库遍历;git.ts
// 是叶子模块(只依赖 log.ts)且已持有 repoRoots 与同款 porcelain 解析。决策记录见
// docs/auto-resolve-design.md §N。
export async function changedFiles(dir: string): Promise<string[]> {
  const lists = await Promise.all((await repoRoots(dir)).map((root) => gitStatusFiles(dir, root)))
  return lists.flat()
}

// --porcelain -z --no-renames -uall: 逐文件 NUL 分隔输出,不带改名箭头;每条为
// "XY <path>",路径相对仓库根(worktree 顶层),需换算为相对目标目录的路径。
// -uall 下仍以 "?? dir/" 折叠输出的只有嵌套仓库目录(其内部文件由该仓库自身
// 的 status 单独列出),跳过以免重复。
async function gitStatusFiles(dir: string, root: string): Promise<string[]> {
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
    .map((entry) => relative(dir, join(toplevel, entry.slice(3))))
}

// 仓库内是否有未提交改动(限定该目录子树;折叠目录项只可能是嵌套仓库,由其
// 自身的提交单独处理)。git 不可用(spawn 抛错)按无改动处理。
async function hasChanges(root: string): Promise<boolean> {
  const status = await git(root, ["status", "--porcelain", "-z", "--no-renames", "-uall", "--", "."]).catch(() => undefined)
  if (!status || status.code !== 0) return false
  return status.out.split("\0").some((entry) => entry && !(entry.startsWith("?? ") && entry.endsWith("/")))
}

// git 身份兜底: 仓库未配置 user.email 时以固定身份提交,避免全新环境提交失败
// (-c 仅对该次调用生效,已配置的仓库不受影响)。
async function identityArgs(root: string): Promise<string[]> {
  const email = await git(root, ["config", "user.email"])
  if (email.code === 0 && email.out.trim()) return []
  return ["-c", "user.name=opencode-auto", "-c", "user.email=opencode-auto@local"]
}

async function git(root: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { code, out, err }
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0]!.slice(0, 200)
}
