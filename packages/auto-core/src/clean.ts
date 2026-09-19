// 破坏性操作前的工作区干净度闸门(reset、覆盖既有配置的 init)。
//
// 理由: 这两条路径都会删改已落盘的文件,而 git 是用户唯一的撤销手段——工作区
// 脏就意味着撤销不回来。与「非 TTY 免交互确认」的口径互不覆盖: 非 TTY 只免掉
// 提问,拦截照常生效,脚本与 CI 同样会被脏工作区拦下。
//
// 范围直接复用 git.ts 的 changedFiles: 目标目录所在仓库(pathspec `-- .` 限定
// 在该子树内,目标目录位于更大仓库中时也正确)加上目录树下所有含 .git 的嵌套
// 仓库(子模块与 worktree 的 .git 是文件而非目录,repoRoots 对两者都识别,嵌套
// 中的嵌套继续下探,node_modules 排除)。不在任何仓库内时返回空数组 → 视为
// 干净放行,与 ensureGitignore「非 git 目录不做任何事」的既有口径一致。
import { changedFiles } from "./git"

const PREVIEW = 10

// 干净返回 undefined;脏则返回可直接打印的报文(含前 PREVIEW 条文件与两条退路)。
export async function checkCleanTree(dir: string, action: string): Promise<string | undefined> {
  const dirty = await changedFiles(dir)
  if (!dirty.length) return undefined
  const shown = dirty.slice(0, PREVIEW).map((file) => `  ${file}`)
  if (dirty.length > PREVIEW) shown.push(`  …and ${dirty.length - PREVIEW} more files`)
  return [
    `${action} will delete or modify files on disk and requires a clean worktree (including all nested repos/submodules in the tree); uncommitted changes found:`,
    ...shown,
    "commit or git stash these changes first; to run on a dirty worktree anyway, pass -f/--force to skip this check",
  ].join("\n")
}
