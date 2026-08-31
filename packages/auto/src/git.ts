import { readdir } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import { log } from "./log"

// driver 统一提交机制: 收回 AI 会话的提交权——任何会话结束后由 driver 递归提交
// 全部改动(先嵌套子仓库、后目标目录所在仓库),提交信息携带任务编号与阶段,
// 使 git 历史成为 AI 变更的审计轨迹(追踪与回滚的粒度 = 会话)。会话不执行
// git commit(AGENTS.md 提交原则块与 agent 契约同步约束)。

// 提交信息: 中文标题行(人读)+ 机器可读 trailer(脚本化定位回滚点)。
// Auto-Task 任务编号(T-F*/PLAN 等)、Auto-Stage 阶段与序号;目标目录所在
// 仓库的提交另以 Auto-Nested 行记录本轮实际提交的嵌套仓库路径与 SHA,保持
// 跨仓库可追踪(对齐旧 commit-rule 中"列出子仓库路径与提交 SHA"的要求)。
function message(subject: string, task: { id: string }, stage: string, nested: { rel: string; sha: string }[] = []): string {
  return [
    subject,
    "",
    `Auto-Task: ${task.id}`,
    `Auto-Stage: ${stage}`,
    ...nested.map((repo) => `Auto-Nested: ${repo.rel} @ ${repo.sha}`),
  ].join("\n")
}

// 会话后统一提交。逐仓库(深度优先,嵌套仓库先提交): 有未提交改动才
// git add -A + git commit,无改动跳过、非 git 环境整体跳过;单仓库失败仅
// 警告不阻塞(改动保留在工作区,下一次提交全量 add 自然清扫连带)。
// subject 为标题行(子任务条目由调用方省略任务标题以免过长,超过 100 字截断)。
export async function commitTree(dir: string, task: { id: string; title: string }, info: { stage: string; subject: string }): Promise<void> {
  const roots = await repoRoots(dir)
  const subject = info.subject.length > 100 ? `${info.subject.slice(0, 100)}…` : info.subject
  const nested: { rel: string; sha: string }[] = []
  for (const root of roots) {
    const rel = relative(dir, root) || "."
    try {
      if (!(await hasChanges(root))) continue
      const added = await git(root, ["add", "-A", "--", "."])
      if (added.code !== 0) {
        log(`⚠ git 提交失败(${rel}): git add 退出码 ${added.code}(${firstLine(added.err || added.out)})`)
        continue
      }
      const committed = await git(root, [...(await identityArgs(root)), "commit", "-m", message(subject, task, info.stage, root === dir ? nested : undefined)])
      if (committed.code !== 0) {
        log(`⚠ git 提交失败(${rel}): ${firstLine(committed.err || committed.out)}(改动保留在工作区,下一次提交会清扫连带)`)
        continue
      }
      const sha = (await git(root, ["rev-parse", "--short", "HEAD"])).out.trim()
      if (root !== dir) nested.push({ rel, sha })
      log(`✓ git 提交(${rel}): ${subject}`)
    } catch (error) {
      log(`⚠ git 提交失败(${rel}): ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

// 工作区是否已有未提交改动(run 启动时提示用户: 它们会被纳入 driver 的下一次提交)。
export async function pendingChanges(dir: string): Promise<boolean> {
  for (const root of await repoRoots(dir)) {
    if (await hasChanges(root)) return true
  }
  return false
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
