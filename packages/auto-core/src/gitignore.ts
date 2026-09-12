// .gitignore 中 driver 工作目录条目的维护(与 reset 成对,故上收为叶子模块:
// 从 loop.ts 导出会让 reset.ts 拖进 loop → runner → … 整条依赖链,与 git.ts
// 上收 changedFiles 的理由同源)。loop.ts 再导出 ensureGitignore 保持既有
// 导入路径 @opencode-ai/auto-core/loop 不变。
import { rm, stat } from "node:fs/promises"
import { join } from "node:path"

// driver 工作目录: tmp/(verify 脚本与输出,位于目标目录内)与 .auto/(运行
// 日志、进度恢复记录与判定文件等运行时状态)。
const ENTRIES = ["tmp/", ".auto/"]

// 行归一化后的等价比对: 前导 / 与尾随 / 均不计入(`/tmp`、`tmp/`、`tmp` 等价)。
function normalize(line: string): string {
  return line.trim().replace(/^\//, "").replace(/\/$/, "")
}

// 确保 .gitignore 忽略 driver 工作目录。统一提交会提交全部未提交改动,不忽略
// 会把它们带进提交。已有等价条目则跳过;非 git 目录(无 .git 且无 .gitignore)
// 不做任何事。返回是否追加了条目。
export async function ensureGitignore(directory: string): Promise<boolean> {
  const file = join(directory, ".gitignore")
  const existing = await Bun.file(file).text().catch(() => undefined)
  // .git 可能是目录(普通仓库)或文件(worktree/子模块),stat 两者皆可。
  if (existing === undefined && !(await stat(join(directory, ".git")).then(() => true, () => false))) return false
  const lines = existing ? existing.split("\n") : []
  const missing = ENTRIES.filter((entry) => !lines.some((line) => normalize(line) === normalize(entry)))
  if (!missing.length) return false
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
