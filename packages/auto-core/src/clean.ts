// Worktree cleanliness gate before destructive operations (reset, an init
// that overwrites an existing config).
//
// Rationale: both paths delete or modify files already on disk, and git is
// the user's only undo — a dirty worktree means the deletion cannot be undone.
// This and the "non-TTY skips the interactive confirmation" rule cover
// different things: non-TTY only skips the question, the interception still
// applies — scripts and CI are equally stopped by a dirty worktree.
//
// The scope reuses git.ts changedFiles directly: the repository containing
// the target directory (pathspec `-- .` confines it to that subtree, correct
// even when the target directory sits inside a larger repository) plus every
// nested repository under the directory tree that contains .git (a
// submodule's or worktree's .git is a file, not a directory; repoRoots
// recognizes both and keeps descending into nested-of-nested; node_modules
// excluded). Not inside any repository returns an empty array → treated as
// clean and let through, matching ensureGitignore's existing stance of "do
// nothing in a non-git directory".
import { changedFiles } from "./git"

const PREVIEW = 10

// Clean returns undefined; dirty returns a message ready to print (the first
// PREVIEW files plus the two ways out).
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
