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
//   T-NNN — the parent of the current corpus's oldest `Auto-Task: T-NNN`
//           commit: the state before the task first started, interrupted
//           earlier attempts included (a retry from the beginning wants
//           none of them). The corpus bound (plans/0140): task numbers
//           never repeat within a corpus, but a wipe-and-restart over
//           retained history re-issues them — unbounded, the oldest
//           trailer commit under a re-issued id belongs to an earlier
//           corpus and the fork would land before the restart — so the
//           scan is bounded at the task's corpus set (taskCorpusCommits,
//           the newest commit that added the unit's todo.md).
//   sha   — the commit itself: the person names the exact state.
//   sha:<rel>@<sha>[,<rel>@<sha>…] — the named-alignment form (the
//           maintainer's internal affordance, undocumented in the CLI help):
//           the commit itself, with each nested repository's state named on
//           the command instead of read from the commit's Auto-Nested record
//           — the override for a person commit that records no alignment.
//           A named entry wins over the record; repositories not named keep
//           the record's alignment; an entry naming no nested repository of
//           this project is a usage refusal, never silently ignored.
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
// manual cleanup. Bringing work back is the person's plain git (P21: no
// landing machinery until a consumer rules it); tearing down is
// `remove-fork` (plans/0139 — the deferred consumer arrived), the exact
// inverse of what fork builds.
import { existsSync } from "node:fs"
import { mkdir, realpath, stat } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { firstLine, git, nestedShasAt, physicalDir, repoRoots, taskFirstCommit } from "./git"
import { addWorktreeAt } from "./git-worktree"
import { localBranches, revSha } from "./git-land"
import { liveRunLock, lockLines } from "./lock"
import { parseUnitDoc } from "./document/unit"
import { shellProfile } from "./shell"

export type ForkOutcome = { type: "forked" | "removed" | "usage" | "blocked"; lines: string[] }

const TASK_TARGET = /^T-\d{3,}$/
const SHA_TARGET = /^[0-9a-f]{7,40}$/i
// The named-alignment form's two halves: a root sha, then comma-separated
// `<rel>@<sha>` entries (the greedy rel side takes the last @ — a repository
// path containing one still parses).
const NAMED_TARGET = /^([0-9a-f]{7,40}):(.+)$/i
const NAMED_ENTRY = /^(.+)@([0-9a-f]{7,40})$/i

// One nested repository of the fork: its path relative to the project and
// its absolute original root (the worktree is added from there), with the
// state it aligns at.
type NestedFork = { rel: string; root: string; sha: string; named: boolean }

// Whether child lies inside parent (or equals it): relative() says "" for
// equality and a ".."-headed path for anything outside; a sibling named
// "..foo" would give "..foo" — not ".." and not ".."+sep — hence the exact
// prefix form, never bare startsWith("..").
const within = (parent: string, child: string): boolean => {
  const rel = relative(parent, child)
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

// The fork worktree path canonicalized to the extent it exists (plans/0191
// D2, 0165-144): git registers the realpath of the worktree it adds, so a
// lexical spelling of a symlinked prefix would disagree with git's own
// record in every later comparison and every printed cleanup line. The tail
// beyond the existing prefix is kept as spelled — fork requires an absent
// path, and the person's spelling of the not-yet-created part is its name.
// A symlink-free path is byte-identical (realpath of it is itself).
async function realPathPrefix(path: string): Promise<string> {
  if (await stat(path).then(() => true, () => false)) return await realpath(path).catch(() => path)
  const parent = dirname(path)
  if (parent === path) return path
  return join(await realPathPrefix(parent), basename(path))
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
  // The directory facts speak git's own path spelling (plans/0191 D2): the
  // root and the worktree path are canonicalized before every comparison
  // and every printed line, so the containment guards judge the directories
  // the paths resolve to, and the cleanup line names the path git
  // registered (realpath) — a path through a symlink both round-trips and
  // cannot smuggle the worktree inside the project. A symlink-free path is
  // byte-identical to its resolve() form.
  const root = await physicalDir(resolve(dir))
  const usage = (lines: string[]): ForkOutcome => ({ type: "usage", lines })
  const blocked = (lines: string[]): ForkOutcome => ({ type: "blocked", lines })
  const task = TASK_TARGET.test(target) ? target : undefined
  const namedMatch = task === undefined ? NAMED_TARGET.exec(target) : undefined
  const shape = `${bin} fork <T-NNN | sha | sha:<rel>@<sha>> <worktree-path> [dir]`
  if (task === undefined && namedMatch === undefined && !SHA_TARGET.test(target)) {
    return usage([`${target}: not a fork target; expected a task T-NNN or a commit sha (usage: ${shape})`])
  }
  if (!worktreePath.trim()) {
    return usage([`fork requires a worktree path — the absent directory the experiment environment is created in (usage: ${shape})`])
  }
  const path = await realPathPrefix(resolve(worktreePath))
  // The named alignments, keyed by the same repository-relative spelling the
  // enumeration below derives (`relative(root, repoRoot)`) — a forgiving
  // resolve first, so "./pkg" and "pkg/" name the repository the record would.
  const named = new Map<string, string>()
  if (namedMatch) {
    for (const entry of namedMatch[2]!.split(",")) {
      const m = NAMED_ENTRY.exec(entry.trim())
      if (!m) {
        return usage([`${entry.trim()}: not a nested alignment — expected <rel>@<sha> after the colon, comma-separated for several (usage: ${shape})`])
      }
      named.set(relative(root, resolve(root, m[1]!.trim())).replaceAll("\\", "/"), m[2]!)
    }
  }

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
  // commit of the current corpus and takes its parent; the sha form takes
  // the commit itself. `older` rides along for the success line — commits
  // under the same id from before a restart exist, the re-issued shape the
  // person should see named rather than infer from a sha.
  let point: string
  let olderLineage = false
  if (task !== undefined) {
    const first = await taskFirstCommit(root, task)
    if (first === undefined || first.first === undefined) {
      return usage([
        first?.older
          ? `${task}: every commit carrying the trailer Auto-Task: ${task} predates this corpus's formulation of the unit — the task's document was re-created by a later restart, and the current corpus has not started the task; the main tree already sits at its beginning, nothing to fork`
          : `${task}: no commit of this repository carries the trailer Auto-Task: ${task} — the task never started here, so the main tree already sits at its beginning; nothing to fork`,
      ])
    }
    const parent = await revSha(root, `${first.first}^`)
    if (parent === undefined) {
      return usage([
        `${task}: its first commit (${first.first.slice(0, 7)}) is the repository's initial commit — no state exists before the task; fork a sha you choose instead`,
      ])
    }
    point = parent
    olderLineage = first.older
  } else {
    const wanted = namedMatch ? namedMatch[1]! : target
    const full = await revSha(root, wanted)
    if (full === undefined) {
      return usage([`${wanted}: no commit of this repository resolves to this sha (or the short form is ambiguous) — name a commit of ${root}`])
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
  const seen = new Set<string>()
  for (const repoRoot of (await repoRoots(root)).filter((entry) => entry !== root)) {
    const rel = relative(root, repoRoot) || "."
    seen.add(rel)
    // A named entry is the person's deliberate word — it wins over whatever
    // the record carries; repositories not named keep the record's alignment.
    const asNamed = named.get(rel)
    let sha = asNamed ?? recorded.get(rel)
    if (sha !== undefined && (await revSha(repoRoot, sha)) === undefined) {
      problems.push(`${rel}: the aligned sha ${sha} ${asNamed !== undefined ? "you named" : `recorded at ${point.slice(0, 7)}`} does not resolve in this repository (history rewritten?) — settle it by hand and fork again`)
      continue
    }
    if (sha === undefined && task !== undefined) {
      // The nested repository holds no task documents, so its scan has no
      // corpus boundary (taskCorpusCommits's undefined floor) — the whole
      // log stands, the shape before plans/0140, reached only when the
      // fork commit records no alignment for this repository.
      const first = await taskFirstCommit(repoRoot, task)
      const parent = first?.first === undefined ? undefined : await revSha(repoRoot, `${first.first}^`)
      if (parent !== undefined) sha = parent
    }
    if (sha === undefined) {
      // An empty nested repository (git init, no commit yet — the S19 seam
      // 0165-143 folds in: nestedHeads writes an empty sha the record reader
      // skips, so no alignment can exist): its state is not "not derivable",
      // it is nothing, and no sha can ever be named for it — the generic
      // remedy is unsatisfiable there. Refuse naming the one act that makes
      // it forkable (plans/0191 D1). The exit-code reading: `--verify
      // --quiet` exits 1 for an unresolvable HEAD (the unborn branch of an
      // empty repository), 0 with commits; anything else (128, an unreadable
      // repository) falls through to the generic refusal — uncertain stays
      // generic (P12).
      const head = await git(repoRoot, ["rev-parse", "--verify", "--quiet", "HEAD"]).catch(() => undefined)
      if (head?.code === 1) {
        problems.push(`${rel}: the repository is empty (no commits yet) — a worktree cannot be aligned on nothing; commit once in ${rel} and fork again, or settle it by hand`)
        continue
      }
      problems.push(
        `${rel}: its state at the fork point is not derivable — ${
          task !== undefined
            ? `neither recorded at ${point.slice(0, 7)} (no Auto-Nested line) nor reachable as the parent of a first ${task} commit of its own`
            : `the fork commit records no Auto-Nested line for it`
        }; fork a commit that records the alignment, name it on the command (fork <sha>:<rel>@<sha> <worktree-path>), or settle the repository by hand`,
      )
      continue
    }
    nested.push({ rel, root: repoRoot, sha, named: asNamed !== undefined })
  }
  // A repository the fork commit's record names but today's tree does not
  // hold is reported, never silently dropped (plans/0191 D1): the record is
  // a past state's word about a since-changed tree — informational, not a
  // refusal (the named-alignment form's refusal for a typo'd rel stays: a
  // person's explicit word is checked, a record's word is reported).
  const absentRecorded = [...recorded.keys()].filter((rel) => !seen.has(rel))
  // An entry naming no repository of this project never matched anything — a
  // typo'd rel would otherwise fall through to the record path silently.
  for (const rel of named.keys()) {
    if (!seen.has(rel)) problems.push(`${rel}: no nested repository of this project sits there — the named alignment matches nothing (usage: ${shape})`)
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
  // its aligned state, shallowest first; a failure midway blocks naming the
  // partial scene). The creation order is fork's own derived fact
  // (plans/0191 D1, 0165-143), NOT repoRoots' commit order (deepest first —
  // that order is the unified commit's): creation mirrors the containment,
  // because a parent directory that already holds the deeper repository's
  // worktree is non-empty and git refuses to populate it ("already exists",
  // the measured mechanism) — while an empty intermediate directory (this
  // order's own shape: the parent's worktree creates it) is no obstacle.
  // remove-fork's teardown keeps the measured opposite: deepest first, the
  // root last. ——
  const added = await addWorktreeAt(root, path, branch, point)
  if (!added.ok) {
    return blocked([
      `⏸ creating the fork worktree failed: ${added.error}`,
      `clean up any partial state by hand: git -C ${root} worktree prune${(await revSha(root, branch)) !== undefined ? ` && git -C ${root} branch -D ${branch}` : ""}`,
    ])
  }
  for (const repo of [...nested].sort((a, b) => a.rel.split("/").length - b.rel.split("/").length)) {
    const at = join(path, repo.rel)
    await mkdir(dirname(at), { recursive: true })
    const ok = await addWorktreeAt(repo.root, at, branch, repo.sha)
    if (!ok.ok) {
      return blocked([
        `⏸ ${repo.rel}: creating its aligned worktree failed: ${ok.error}`,
        `the fork is partial (the root worktree exists on ${branch}) — tear it down and re-run:`,
        `  ${bin} remove-fork ${path} ${root}`,
      ])
    }
  }
  // The success lines: what each repository sits at, how to run the
  // experiment, how to clean it up. The run hint names --stop-after for the
  // task form only — the sha form has no single task to stop after.
  const lines: string[] = []
  if (task !== undefined) {
    const title = await taskTitle(root, task)
    lines.push(`✓ fork of ${task}${title !== undefined ? ` ${title}` : ""} created at ${path} on ${branch}`)
    lines.push(`  .: ${point.slice(0, 7)} — the state before ${task} first started${olderLineage ? ` (this corpus; the history also holds older ${task} commits from before a restart)` : ""}`)
  } else {
    const shown = await git(root, ["show", "-s", "--format=%s", point])
    const subject = shown.code === 0 ? shown.out.trim() : undefined
    lines.push(`✓ fork at ${point.slice(0, 7)}${subject ? ` (${subject})` : ""} created at ${path} on ${branch}`)
    lines.push(`  .: ${point.slice(0, 7)} — the named commit`)
  }
  for (const repo of nested) lines.push(`  ${repo.rel}: ${repo.sha.slice(0, 7)} (${repo.named ? "aligned as named" : "aligned at the fork point"})`)
  for (const rel of absentRecorded) lines.push(`  ℹ ${rel}: recorded at the fork point but absent from the tree today — not forked; no worktree of the fork holds it`)
  lines.push(`run it: ${bin} run ${path}${task !== undefined ? ` --stop-after ${task}` : ""}`)
  lines.push(`cleanup when done: ${bin} remove-fork ${path} ${root} — removes every worktree of the fork and deletes ${branch} in each of its repositories`)
  return { type: "forked", lines }
}

// The registered worktrees of one repository, as resolved path → checked-out
// branch (undefined = a detached HEAD): `git worktree list --porcelain`, the
// record fork's own statelessness rests on (P6: git's registry and the
// auto-fork/* branch family are the whole record of a fork — nothing else
// exists to consult, and remove-fork persists nothing of its own either).
async function worktreeBranches(dir: string): Promise<Map<string, string | undefined>> {
  const listed = await git(dir, ["worktree", "list", "--porcelain"]).catch(() => undefined)
  const out = new Map<string, string | undefined>()
  if (!listed || listed.code !== 0) return out
  let path: string | undefined
  for (const line of listed.out.split("\n")) {
    if (line.startsWith("worktree ")) {
      path = resolve(line.slice("worktree ".length))
      out.set(path, undefined)
    } else if (line.startsWith("branch ") && path !== undefined) {
      out.set(path, line.slice("branch ".length).replace(/^refs\/heads\//, ""))
    }
  }
  return out
}

export type RemoveForkOptions = {
  // --force: discard the uncommitted work the fork's worktrees hold (the
  // explicit bracket — without it a dirty member blocks naming its files;
  // the branch tips stay named either way, their printed full shas the one
  // recovery handle until git gc prunes the objects, plans/0191 D4).
  force?: boolean
}

// remove-fork (plans/0139): the teardown of what fork builds — every
// worktree of the fork removed and its one branch name deleted in each of
// the fork's repositories, so the path is free and the next fork of the
// same target takes the stem name again (a leftover branch would push it
// to -2 forever). The inverse is exact because the record is git's own:
// the root worktree's registration names the branch (which must be of the
// auto-fork/* family — a lane park or person worktree is never touched),
// and each nested repository of the source (fork's own enumeration)
// holding a worktree at the same relative place on the same branch is a
// member. Every refusal lands before any git state is touched (land's
// two-pass shape); the teardown removes the nested members first and the
// root last — the root's removal sweeps the whole directory, so a
// root-first order would strand the nested registrations pointing at
// swept paths (the measured git behavior this ordering rides).
//
// Exit-code contract: 0 removed / 1 usage — the person pointed at
// something that is not a fork of this project (an unregistered path, a
// worktree on another branch or detached, a member off the coherent
// branch) / 2 blocked — a live run inside the fork, uncommitted work
// without --force, or a git failure midway (resumable: the removal is
// idempotent, a re-run rediscovers what still stands).
export async function removeFork(dir: string, worktreePath: string, opts: RemoveForkOptions = {}): Promise<ForkOutcome> {
  const { bin } = shellProfile()
  // The directory facts speak git's own path spelling (plans/0191 D2,
  // 0165-144): git registers worktrees at their realpath, so the argument
  // and the project root are canonicalized before the registry lookup and
  // every printed line — remove-fork answers for the fork a person's shell
  // spelling of it (a symlinked path) reaches. A path that does not resolve
  // keeps its spelling and the lookup refuses as before.
  const root = await physicalDir(resolve(dir))
  const usage = (lines: string[]): ForkOutcome => ({ type: "usage", lines })
  const blocked = (lines: string[]): ForkOutcome => ({ type: "blocked", lines })
  const shape = `${bin} remove-fork <worktree-path> [dir]`
  const path = await physicalDir(resolve(worktreePath))

  // —— Pass 1: every refusal, before any repository's git state is touched ——
  if (path === root) {
    return usage([`${worktreePath}: that is the project's own working tree — remove-fork tears down fork worktrees only (usage: ${shape})`])
  }
  const registered = await worktreeBranches(root)
  const branch = registered.get(path)
  if (!registered.has(path)) {
    return usage([`${worktreePath}: no worktree of ${root} is registered there — nothing of a fork to remove (usage: ${shape})`])
  }
  if (branch === undefined) {
    return usage([`${worktreePath}: the worktree there has a detached HEAD, not a fork's checked-out auto-fork/* branch — remove it with plain git`])
  }
  if (!branch.startsWith("auto-fork/")) {
    return usage([`${worktreePath}: the worktree there is on ${branch}, not of the fork family auto-fork/* — remove-fork never touches a worktree it did not build; plain git removes it`])
  }
  // The members: the root worktree plus every nested repository of the
  // source holding a worktree at the same relative place, on the same
  // branch (fork's one coherent name — a member on anything else is named
  // for the person to settle, never guessed at).
  const members: { rel: string; repo: string; path: string }[] = [{ rel: ".", repo: root, path }]
  const problems: string[] = []
  for (const repoRoot of (await repoRoots(root)).filter((entry) => entry !== root)) {
    const rel = relative(root, repoRoot) || "."
    const at = join(path, rel)
    const theirs = await worktreeBranches(repoRoot)
    if (!theirs.has(at)) continue
    const theirBranch = theirs.get(at)
    if (theirBranch !== branch) {
      problems.push(`${rel}: its worktree under the fork is on ${theirBranch ?? "a detached HEAD"}, not ${branch} — settle it by hand; remove-fork never touches a worktree it cannot name`)
      continue
    }
    members.push({ rel, repo: repoRoot, path: at })
  }
  if (problems.length) {
    return usage([`${worktreePath}: the fork's repositories do not all sit on ${branch}:`, ...problems.map((problem) => `  ${problem}`)])
  }
  // A live run inside the experiment: its driver holds state in the fork's
  // tree, and removing the worktree under it would destroy in-flight work
  // mid-run (P20). The source project's own lock is deliberately not
  // consulted — fork's own argument (plans/0129), verbatim: the only writes
  // in the source repositories are the auto-fork/* branch family and the
  // worktree registrations, surfaces a running driver never reads.
  const holder = liveRunLock(path)
  if (holder) return blocked(lockLines(path, holder))
  // Uncommitted work in a member is never discarded silently (P20): without
  // --force it blocks naming the files — commit them, bring them back by
  // hand, or discard explicitly. A member's own subtree does not count as
  // the root's dirt (each member is judged by its own status, and the
  // nested-first teardown removes the inner worktrees before the root's
  // removal runs); a swept member (directory already gone) has only its
  // registration left and nothing to check.
  if (!opts.force) {
    const dirty: { rel: string; files: string[] }[] = []
    const memberPrefixes = members.slice(1).map((member) => `${member.rel}/`)
    for (const member of members) {
      if (!existsSync(member.path)) continue
      const status = await git(member.path, ["status", "--porcelain"])
      if (status.code !== 0) {
        return blocked([
          `⏸ ${member.rel}: its status cannot be read (git status exit ${status.code}) — settle the worktree by hand and re-run: ${bin} remove-fork ${worktreePath}`,
        ])
      }
      const files = status.out
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !memberPrefixes.some((prefix) => line.slice(3).startsWith(prefix)))
      if (files.length) dirty.push({ rel: member.rel, files })
    }
    if (dirty.length) {
      return blocked([
        `⏸ the fork holds uncommitted work — remove-fork never discards it silently; commit it or bring it back by hand, then re-run:`,
        ...dirty.flatMap(({ rel, files }) => [`  ${rel}:`, ...files.map((file) => `    ${file}`)]),
        `to discard it instead: ${bin} remove-fork ${worktreePath} ${root} --force`,
      ])
    }
  }

  // —— Pass 2: the teardown — nested members first, the root last, each
  // branch deleted after its own worktree is gone (git refuses to delete a
  // branch a worktree has checked out). Every step names the branch tip —
  // in full, plans/0191 D4 (0165-146): the printed sha is the ONE recovery
  // handle, because the reflogs are already gone when the line is read (the
  // fork's commits were made in the linked worktree, whose HEAD reflog dies
  // with the worktree's removal, and branch -D deletes the branch's own
  // reflog) — the object itself survives until git gc prunes it, and the
  // closing line teaches the recipe. ——
  const lines: string[] = []
  const resumable = `the removal is resumable — settle the cause and re-run: ${bin} remove-fork ${worktreePath}`
  for (const member of [...members.slice(1), members[0]!]) {
    const swept = !existsSync(member.path)
    const tip = await revSha(member.repo, `refs/heads/${branch}`)
    const removed = await git(member.repo, ["worktree", "remove", ...(opts.force ? ["--force"] : []), member.path])
    if (removed.code !== 0) {
      return blocked([
        ...lines,
        `⏸ ${member.rel}: removing its worktree failed: ${firstLine(removed.err || removed.out) || `git worktree remove exit code ${removed.code}`}`,
        resumable,
      ])
    }
    if (tip === undefined) {
      lines.push(`  ${member.rel}: worktree ${swept ? "already gone — registration dropped" : "removed"}, ${branch} already gone`)
      continue
    }
    const deleted = await git(member.repo, ["branch", "-D", branch])
    if (deleted.code !== 0) {
      return blocked([
        ...lines,
        `⏸ ${member.rel}: its worktree is removed, but deleting ${branch} failed: ${firstLine(deleted.err || deleted.out) || `git branch -D exit code ${deleted.code}`}`,
        `finish it by hand: git -C ${member.repo} branch -D ${branch}`,
      ])
    }
    lines.push(`  ${member.rel}: worktree ${swept ? "already gone — registration dropped" : "removed"}, branch ${branch} deleted (was ${tip})`)
  }
  if (lines.some((line) => line.includes("(was "))) {
    lines.push(`  the tips above stay recoverable by their printed shas until git gc prunes them (the reflogs went with the deletion) — git branch ${branch} <the (was …) sha> recreates one in its repository`)
  }
  // The retry hint names the target the branch stem carries (fork's own
  // grammar: the task id or short sha, an experiment number after it).
  const stem = /^auto-fork\/(T-\d{3,}|[0-9a-f]{7,40})(?:-\d{1,2})?$/i.exec(branch)
  const target = stem?.[1] ?? "<T-NNN | sha>"
  return {
    type: "removed",
    lines: [
      `✓ fork at ${path} removed — ${members.length} worktree${members.length === 1 ? "" : "s"} and the branch ${branch} deleted${opts.force ? " (--force: the uncommitted work discarded)" : ""}`,
      ...lines,
      `retry: ${bin} fork ${target} ${path} ${root}`,
    ],
  }
}
