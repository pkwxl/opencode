// The fork command's core (plans/0128): the person's experiment environment
// — a new worktree (plus one per nested repository, aligned) at the state a
// named task started from, or at an exact commit the person names — where a
// retry runs without the main tree, its branches or its history being touched
// in any way (P20: the experiment never disturbs finished or in-flight work;
// P6: the fork point is derived from durable git evidence — the Auto-Task
// trailer scan and the Auto-Nested alignment lines — and nothing is
// persisted; `.auto/` is gitignored, so the environment starts with no
// runtime state and the task documents at that commit already say "pending").
//
// Target forms (the shell shape-checks; this module owns the semantics):
//   T-NNN — the parent of the repository's oldest `Auto-Task: T-NNN` commit:
//           the state before the task first started, interrupted earlier
//           attempts included (a retry from the beginning wants none of them).
//   sha   — the commit itself: the person names the exact state.
//
// Branch family `auto-fork/<target>` (first-free -2, -3… across every
// repository being forked, one coherent name everywhere); land's original-
// branch derivation excludes the family beside auto/* and auto-lane/*.
//
// Exit-code contract (the shell prints the lines; this module never does):
// 0 forked / 1 usage — the person asked for something this fork point cannot
// give (an unknown task, an unresolvable sha, an underivable nested
// alignment, a path that exists or sits inside the project) / 2 blocked — a
// git failure after worktrees began appearing, the partial state named for
// manual cleanup. Bringing work back and cleaning up are the person's plain
// git (P21: no landing machinery until a consumer rules it).
import { mkdir, stat } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { git, nestedShasAt, repoRoots, taskFirstCommit } from "./git"
import { addWorktreeAt } from "./git-worktree"
import { localBranches, revSha } from "./git-land"
import { parseUnitDoc } from "./document/unit"
import { shellProfile } from "./shell"

export type ForkOutcome = { type: "forked" | "usage" | "blocked"; lines: string[] }

const TASK_TARGET = /^T-\d{3,}$/
const SHA_TARGET = /^[0-9a-f]{7,40}$/i

// One nested repository of the fork: its path relative to the project and
// its absolute original root (the worktree is added from there), with the
// state it aligns at.
type NestedFork = { rel: string; root: string; sha: string }

// Whether child lies inside parent (or equals it): relative() says "" for
// equality and a ".."-headed path for anything outside; a sibling named
// "..foo" would give "..foo" — not ".." and not ".."+sep — hence the exact
// prefix form, never bare startsWith("..").
const within = (parent: string, child: string): boolean => {
  const rel = relative(parent, child)
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

// A task's title from its document (done.md after completion, todo.md
// before), for the success lines; undefined when neither doc is readable.
async function taskTitle(dir: string, id: string): Promise<string | undefined> {
  for (const name of ["done.md", "todo.md"]) {
    const text = await Bun.file(join(dir, "docs", id, name)).text().catch(() => undefined)
    if (text !== undefined) return parseUnitDoc(text).title
  }
  return undefined
}

export async function forkTask(dir: string, target: string, worktreePath: string): Promise<ForkOutcome> {
  const { bin } = shellProfile()
  const root = resolve(dir)
  const usage = (lines: string[]): ForkOutcome => ({ type: "usage", lines })
  const blocked = (lines: string[]): ForkOutcome => ({ type: "blocked", lines })
  const task = TASK_TARGET.test(target) ? target : undefined
  const shape = `${bin} fork <T-NNN | sha> <worktree-path> [dir]`
  if (task === undefined && !SHA_TARGET.test(target)) {
    return usage([`${target}: not a fork target; expected a task T-NNN or a commit sha (usage: ${shape})`])
  }
  if (!worktreePath.trim()) {
    return usage([`fork requires a worktree path — the absent directory the experiment environment is created in (usage: ${shape})`])
  }
  const path = resolve(worktreePath)

  // —— Pass 1: every refusal, before any repository's git state is touched ——
  // The path is the person's one placement decision, so its bounds are named
  // before anything is derived: inside the project a worktree holding a .git
  // entry would be misread as a nested repository by every later unified
  // commit (repoRoots skips only the lane park), and the project inside the
  // worktree inverts the containment the same way.
  if (within(root, path)) {
    return usage([`${worktreePath}: the fork worktree cannot lie inside the project — a worktree there would be misread as a nested repository by every unified commit; place it outside ${root}`])
  }
  if (within(path, root)) {
    return usage([`${worktreePath}: the fork worktree cannot contain the project — place it beside ${root}, not around it`])
  }
  if (await stat(path).then(() => true, () => false)) {
    return usage([`${worktreePath}: the path already exists — fork needs an absent path it can create`])
  }
  // The fork point. The task form walks the trailer scan to the task's first
  // commit and takes its parent; the sha form takes the commit itself.
  let point: string
  if (task !== undefined) {
    const first = await taskFirstCommit(root, task)
    if (first === undefined) {
      return usage([
        `${task}: no commit of this repository carries the trailer Auto-Task: ${task} — the task never started here, so the main tree already sits at its beginning; nothing to fork`,
      ])
    }
    const parent = await revSha(root, `${first}^`)
    if (parent === undefined) {
      return usage([
        `${task}: its first commit (${first.slice(0, 7)}) is the repository's initial commit — no state exists before the task; fork a sha you choose instead`,
      ])
    }
    point = parent
  } else {
    const full = await revSha(root, target)
    if (full === undefined) {
      return usage([`${target}: no commit of this repository resolves to this sha (or the short form is ambiguous) — name a commit of ${root}`])
    }
    point = full
  }
  // The nested repositories, aligned at the fork point: the record the root
  // commit carries (Auto-Nested), with the task form's own-log fallback (the
  // nested repository's own first task commit, for a fork commit that records
  // no alignment — a person commit); the sha form has no task to scan, its
  // record is the alignment or the fork is refused naming the gap.
  const nested: NestedFork[] = []
  const problems: string[] = []
  const recorded = await nestedShasAt(root, point)
  for (const repoRoot of (await repoRoots(root)).filter((entry) => entry !== root)) {
    const rel = relative(root, repoRoot) || "."
    let sha = recorded.get(rel)
    if (sha !== undefined && (await revSha(repoRoot, sha)) === undefined) {
      problems.push(`${rel}: the aligned sha ${sha} recorded at ${point.slice(0, 7)} does not resolve in this repository (history rewritten?) — settle it by hand and fork again`)
      continue
    }
    if (sha === undefined && task !== undefined) {
      const first = await taskFirstCommit(repoRoot, task)
      const parent = first === undefined ? undefined : await revSha(repoRoot, `${first}^`)
      if (parent !== undefined) sha = parent
    }
    if (sha === undefined) {
      problems.push(
        `${rel}: its state at the fork point is not derivable — ${
          task !== undefined
            ? `neither recorded at ${point.slice(0, 7)} (no Auto-Nested line) nor reachable as the parent of a first ${task} commit of its own`
            : `the fork commit records no Auto-Nested line for it`
        }; fork a commit that records the alignment, or settle the repository by hand`,
      )
      continue
    }
    nested.push({ rel, root: repoRoot, sha })
  }
  if (problems.length) {
    return usage([`${target}: the nested repositories cannot all be aligned at this fork point:`, ...problems.map((problem) => `  ${problem}`)])
  }
  // One branch name free in every repository of the fork (the first-free
  // suffix keeps a second experiment of the same target coherent).
  const stem = `auto-fork/${task ?? point.slice(0, 7)}`
  const taken = new Set((await Promise.all([root, ...nested.map((repo) => repo.root)].map((repo) => localBranches(repo)))).flat())
  const branch = [stem, ...Array.from({ length: 98 }, (_, i) => `${stem}-${i + 2}`)].find((name) => !taken.has(name))
  if (branch === undefined) {
    return usage([`no free branch name beside ${stem} — clean up old fork branches first (git branch -D …)`])
  }

  // —— Pass 2: the worktrees (the root first, then each nested repository at
  // its aligned state; a failure midway blocks naming the partial scene) ——
  const created: { root: string; path: string }[] = []
  const cleanupLine = (entry: { root: string; path: string }): string => `  git -C ${entry.root} worktree remove ${entry.path} && git -C ${entry.root} branch -D ${branch}`
  const added = await addWorktreeAt(root, path, branch, point)
  if (!added.ok) {
    return blocked([
      `⏸ creating the fork worktree failed: ${added.error}`,
      `clean up any partial state by hand: git -C ${root} worktree prune${(await revSha(root, branch)) !== undefined ? ` && git -C ${root} branch -D ${branch}` : ""}`,
    ])
  }
  created.push({ root, path })
  for (const repo of nested) {
    const at = join(path, repo.rel)
    await mkdir(dirname(at), { recursive: true })
    const ok = await addWorktreeAt(repo.root, at, branch, repo.sha)
    if (!ok.ok) {
      return blocked([
        `⏸ ${repo.rel}: creating its aligned worktree failed: ${ok.error}`,
        `the fork is partial — remove what was created (the root worktree exists on ${branch}) and re-run:`,
        ...created.map(cleanupLine),
      ])
    }
    created.push({ root: repo.root, path: at })
  }
  // The success lines: what each repository sits at, how to run the
  // experiment, how to clean it up. The run hint names --stop-after for the
  // task form only — the sha form has no single task to stop after.
  const lines: string[] = []
  if (task !== undefined) {
    const title = await taskTitle(root, task)
    lines.push(`✓ fork of ${task}${title !== undefined ? ` ${title}` : ""} created at ${path} on ${branch}`)
    lines.push(`  .: ${point.slice(0, 7)} — the state before ${task} first started`)
  } else {
    const shown = await git(root, ["show", "-s", "--format=%s", point])
    const subject = shown.code === 0 ? shown.out.trim() : undefined
    lines.push(`✓ fork at ${point.slice(0, 7)}${subject ? ` (${subject})` : ""} created at ${path} on ${branch}`)
    lines.push(`  .: ${point.slice(0, 7)} — the named commit`)
  }
  for (const repo of nested) lines.push(`  ${repo.rel}: ${repo.sha.slice(0, 7)} (aligned at the fork point)`)
  lines.push(`run it: ${bin} run ${path}${task !== undefined ? ` --stop-after ${task}` : ""}`)
  lines.push(`cleanup, per repository of the fork:`)
  for (const entry of created) lines.push(cleanupLine(entry))
  return { type: "forked", lines }
}
