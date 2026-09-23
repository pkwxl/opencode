// .gitignore 中 driver 工作目录条目的维护(与 reset 成对,故上收为叶子模块:
// 从 loop.ts 导出会让 reset.ts 拖进 loop → runner → … 整条依赖链,与 git.ts
// 上收 changedFiles 的理由同源)。loop.ts 再导出 ensureGitignore 保持既有
// 导入路径 @opencode-ai/auto-core/loop 不变。
import { rm } from "node:fs/promises"
import { join } from "node:path"

// driver 工作目录: tmp/(driver 执行的测试脚本请求与输出,位于目标目录内)与 .auto/(运行
// 日志、进度恢复记录等运行时状态)。
const ENTRIES = ["tmp/", ".auto/"]

// 行归一化后的等价比对: 前导 / 与尾随 / 均不计入(`/tmp`、`tmp/`、`tmp` 等价)。
function normalize(line: string): string {
  return line.trim().replace(/^\//, "").replace(/\/$/, "")
}

// 是否在 git work tree 内。判据与 git.ts repoRoots 同口径(git rev-parse
// --is-inside-work-tree): 目标目录可能嵌于更大仓库的子目录(.git 在上级),
// 仅查本目录 .git 会漏判——漏判的代价是 .auto/ 与 tmp/ 被统一提交带进父仓库,
// 且 stats 心跳持续改写已跟踪的 stats.json,每个单元启动都被自己制造的脏区
// 阻塞(2026-09-17 审查 H5)。
async function insideWorkTree(directory: string): Promise<boolean> {
  const proc = Bun.spawn(["git", "-C", directory, "rev-parse", "--is-inside-work-tree"], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const out = await new Response(proc.stdout).text()
  return (await proc.exited) === 0 && out.trim() === "true"
}

// 确保 .gitignore 忽略 driver 工作目录。统一提交会提交全部未提交改动,不忽略
// 会把它们带进提交。已有等价条目则跳过;非 git 环境(不在任何 work tree 内且
// 无 .gitignore)不做任何事。返回是否追加了条目。dryRun only reports whether
// it would append (for `fix`'s plan).
export async function ensureGitignore(directory: string, opts: { dryRun?: boolean } = {}): Promise<boolean> {
  const file = join(directory, ".gitignore")
  const existing = await Bun.file(file).text().catch(() => undefined)
  if (existing === undefined && !(await insideWorkTree(directory))) return false
  const lines = existing ? existing.split("\n") : []
  const missing = ENTRIES.filter((entry) => !lines.some((line) => normalize(line) === normalize(entry)))
  if (!missing.length) return false
  if (opts.dryRun) return true
  await Bun.write(file, `${existing ? `${existing.trimEnd()}\n` : ""}${missing.join("\n")}\n`)
  return true
}

// ensureGitignore 的逆操作(reset 用): 移除 tmp/ 与 .auto/ 条目,用户自有条目
// 原样保留。移除后文件只剩空白则整个删除(该文件是 init 建的)。dryRun 只算
// 结果不落盘,供 reset 先打印清单再确认。
export async function removeGitignoreEntries(
  directory: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ removed: boolean; emptied: boolean }> {
  const file = join(directory, ".gitignore")
  const existing = await Bun.file(file).text().catch(() => undefined)
  if (existing === undefined) return { removed: false, emptied: false }
  const targets = ENTRIES.map(normalize)
  const kept = existing.split("\n").filter((line) => !targets.includes(normalize(line)))
  const removed = kept.length !== existing.split("\n").length
  const text = kept.join("\n").trim()
  const emptied = removed && text === ""
  if (!opts.dryRun && removed) {
    if (emptied) await rm(file, { force: true })
    else await Bun.write(file, `${text}\n`)
  }
  return { removed, emptied }
}
