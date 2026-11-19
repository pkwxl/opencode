import { lstat, mkdir, readFile, realpath } from "node:fs/promises"
import { join } from "node:path"
import { git, identityArgs, statusEntriesRead, workdirEntry } from "./git"
import { addWorktreeAt, deleteBranch, landBranch, laneLandingMessage, removeWorktree } from "./git-worktree"

export type ExecutorWorkspace = { id: string; start: string; established?: true }
export type ExecutorLanding = { parent: string; share: string; tree: string }
type Task = { id: string; title: string }

const sha = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export class ExecutorWorktreeError extends Error {}

export function validExecutorWorkspace(workspace: ExecutorWorkspace): boolean {
  return uuid.test(workspace?.id) && sha.test(workspace?.start) &&
    (workspace.established === undefined || workspace.established === true)
}

export function validExecutorLanding(landing: ExecutorLanding): boolean {
  return sha.test(landing?.parent) && sha.test(landing?.share) && sha.test(landing?.tree)
}

export function executorWorkspacePath(dir: string, workspace: ExecutorWorkspace): string {
  return join(dir, ".auto", "worktrees", `executor-${workspace.id}`)
}

function branch(workspace: ExecutorWorkspace): string {
  return `auto-executor/${workspace.id}`
}

function ref(workspace: ExecutorWorkspace): string {
  return `refs/heads/${branch(workspace)}`
}

async function present(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error
    return undefined
  })
}

async function read(dir: string, ...args: string[]): Promise<string> {
  const result = await git(dir, args)
  if (result.code !== 0) throw new ExecutorWorktreeError(result.err.trim() || `git ${args[0]} failed`)
  return result.out.trim()
}

async function branchHead(dir: string, workspace: ExecutorWorkspace): Promise<string | undefined> {
  const result = await git(dir, ["show-ref", "--verify", "--quiet", ref(workspace)])
  if (result.code === 1) return undefined
  if (result.code !== 0) throw new ExecutorWorktreeError(result.err.trim() || "Cannot read the executor branch.")
  return read(dir, "rev-parse", ref(workspace))
}

async function registered(dir: string, path: string, workspace: ExecutorWorkspace): Promise<boolean> {
  const result = await git(dir, ["worktree", "list", "--porcelain", "-z"])
  if (result.code !== 0) throw new ExecutorWorktreeError(result.err.trim() || "Cannot read the Git worktree registry.")
  const records = result.out.split("\0\0").map((record) => record.split("\0"))
  const atPath = records.find((fields) => fields[0] === `worktree ${path}`)
  if (!atPath) {
    if (records.some((fields) => fields.includes(`branch ${ref(workspace)}`))) {
      throw new ExecutorWorktreeError("The executor branch is checked out at another location.")
    }
    return false
  }
  if (!atPath.includes(`branch ${ref(workspace)}`)) {
    throw new ExecutorWorktreeError(`The registered checkout at ${path} has an unexpected branch.`)
  }
  return true
}

async function validateDirectory(path: string): Promise<void> {
  if (!(await present(path))?.isDirectory() || await realpath(path) !== path) {
    throw new ExecutorWorktreeError(`The executor workspace directory ${path} is missing or has moved.`)
  }
}

export async function ensureExecutorWorkspace(dir: string, workspace: ExecutorWorkspace): Promise<string> {
  const path = executorWorkspacePath(dir, workspace)
  // Refuse a moved driver directory before using it in a Git write.
  for (const parent of [join(dir, ".auto"), join(dir, ".auto", "worktrees")]) {
    if (!workspace.established && !(await present(parent))) await mkdir(parent)
    await validateDirectory(parent)
  }
  if (!(await registered(dir, path, workspace))) {
    if (workspace.established || await present(path)) {
      throw new ExecutorWorktreeError(`The executor workspace at ${path} is no longer registered with Git.`)
    }
    const head = await branchHead(dir, workspace)
    if (head !== undefined) {
      if (head !== workspace.start) throw new ExecutorWorktreeError("The pending executor branch moved before checkout.")
      await read(dir, "worktree", "add", path, branch(workspace))
    } else {
      const added = await addWorktreeAt(dir, path, branch(workspace), workspace.start)
      if (!added.ok) throw new ExecutorWorktreeError(added.error)
    }
  }
  await validateDirectory(path)
  const [top, symbolic, common, mainCommon] = await Promise.all([
    read(path, "rev-parse", "--show-toplevel"),
    read(path, "symbolic-ref", "HEAD"),
    read(path, "rev-parse", "--path-format=absolute", "--git-common-dir"),
    read(dir, "rev-parse", "--path-format=absolute", "--git-common-dir"),
  ])
  if (top !== path || symbolic !== ref(workspace) || common !== mainCommon) {
    throw new ExecutorWorktreeError(`The checkout at ${path} does not match its registered executor workspace.`)
  }
  if (!workspace.established) {
    const status = await statusEntriesRead(path, path)
    if (!status || status.length || await read(path, "rev-parse", "HEAD") !== workspace.start) {
      throw new ExecutorWorktreeError(`The unfinished checkout at ${path} does not match its start commit.`)
    }
  }
  return path
}

export async function prepareExecutorLanding(dir: string, share: string): Promise<ExecutorLanding> {
  const mergeHead = await read(dir, "rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD")
  if (await present(mergeHead)) throw new ExecutorWorktreeError("Finish the existing main checkout merge before landing an executor lane.")
  const parent = await read(dir, "rev-parse", "HEAD")
  const merged = await git(dir, ["merge-tree", "--write-tree", parent, share])
  const tree = merged.out.split("\n", 1)[0]
  if (merged.code !== 0 || !sha.test(tree)) {
    throw new ExecutorWorktreeError("Git could not merge the executor lane. Inspect the retained workspace and main checkout.")
  }
  return { parent, share, tree }
}

export async function landExecutorWorkspace(
  dir: string, workspace: ExecutorWorkspace, task: Task, intent: ExecutorLanding,
): Promise<string> {
  const current = await read(dir, "rev-parse", "HEAD")
  const message = laneLandingMessage(task)
  const provesLanding = async (commit: string) =>
    await read(dir, "show", "-s", "--format=%P%n%T%n%B", commit) ===
      `${intent.parent} ${intent.share}\n${intent.tree}\n${message}`

  if (current !== intent.parent) {
    if (await provesLanding(current)) return current
    throw new ExecutorWorktreeError("Main HEAD moved outside the booked lane landing.")
  }
  const workspacePath = await ensureExecutorWorkspace(dir, workspace)
  if (await branchHead(dir, workspace) !== intent.share) {
    throw new ExecutorWorktreeError(`The executor branch at ${workspacePath} moved outside the booked lane landing.`)
  }
  const mergeHeadPath = await read(dir, "rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD")
  const status = await statusEntriesRead(dir, dir)
  if (!status) throw new ExecutorWorktreeError("Git status is unreadable in the main checkout.")
  // The lane park is coordinator state, even in a project fixture that has
  // yet to install the standing gitignore entries.
  const changes = status.filter(({ rel, status }) => status !== "??" || !workdirEntry(rel))
  if (await present(mergeHeadPath)) {
    if ((await readFile(mergeHeadPath, "utf8")).trim() !== intent.share ||
        changes.some(({ status }) => status[1] !== " ") ||
        await read(dir, "write-tree") !== intent.tree) {
      throw new ExecutorWorktreeError("The main checkout has an unexpected incomplete merge. Inspect it before retrying the lane landing.")
    }
    await read(dir, ...await identityArgs(dir), "commit", "-m", message)
  } else {
    if (changes.length) throw new ExecutorWorktreeError("The main checkout must be clean before landing an executor lane.")
    const landed = await landBranch(dir, intent.share, task)
    if (landed.type !== "ok") {
      throw new ExecutorWorktreeError(`The executor lane stayed at ${workspacePath}: ${landed.type === "conflict" ? landed.detail : landed.error}`)
    }
  }
  const landed = await read(dir, "rev-parse", "HEAD")
  if (!(await provesLanding(landed))) throw new ExecutorWorktreeError("The main merge differs from its booked landing.")
  return landed
}

export async function removeExecutorWorkspace(dir: string, workspace: ExecutorWorkspace, share: string): Promise<void> {
  const path = executorWorkspacePath(dir, workspace)
  const head = await branchHead(dir, workspace)
  if (head !== undefined && head !== share) throw new ExecutorWorktreeError("The executor branch moved after landing.")
  if (await registered(dir, path, workspace)) {
    await validateDirectory(path)
    const removed = await removeWorktree(dir, path, { attempts: 1, delayMs: 0 })
    if (!removed.ok) throw new ExecutorWorktreeError(removed.error)
  } else if (await present(path)) {
    throw new ExecutorWorktreeError(`Inspect the remaining unregistered directory at ${path}.`)
  }
  if (head !== undefined) {
    const deleted = await deleteBranch(dir, branch(workspace))
    if (!deleted.ok) throw new ExecutorWorktreeError(deleted.error)
  }
}
