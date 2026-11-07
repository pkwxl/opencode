// The fork command core (plans/0128): forkTask — the experiment environment
// in a new worktree. The task form's derivation (the parent of the oldest
// Auto-Task commit of the current corpus, interrupted attempts included in
// what is excluded), the sha form (the named commit itself, the root commit
// accepted), the branch family's first-free naming, the nested repositories'
// aligned reconstruction (the Auto-Nested record, the task form's own-log
// fallback, the underivable refusal), the named-alignment form
// (sha:<rel>@<sha> — the person names the nested state on the command: a
// person commit with no record forks, a named entry wins over the record,
// an unmatched rel is refused), the usage matrix (unknown task,
// unresolvable sha, the path bounds, the initial-commit edge), and the
// corpus bound (plans/0140 — a task number re-issued after a
// wipe-and-restart forks the current corpus's pre-start, never before the
// restart). The driver's commits are made by the real commitTree, so the
// trailers the derivation scans are the production ones. land's
// original-branch filter (the auto-fork/* family) is pinned beside its own
// suite in test/land.test.ts.
//
// removeFork (plans/0139) — the teardown of what fork builds: the members'
// worktrees and their one branch, the tips named; the dirty refusal and its
// --force bracket; the not-a-fork usage matrix (the project's own tree, a
// stranger path, a person worktree, a member off the coherent branch); a
// live run inside the fork; the swept-directory shape; and the retry
// round-trip the teardown exists for (the stem branch name free again).
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { dirname, join, sep } from "node:path"
import { hostname, tmpdir } from "node:os"
import { commitTree } from "../src/git"
import { forkTask, removeFork } from "../src/fork"
import { addWorktree, addWorktreeAt } from "../src/git-worktree"
import { git } from "./fixtures/runner"
import { withDirFactory } from "./fixtures/dir"

const withDir = withDirFactory("auto-fork-")

const fullShaOf = async (root: string, ref: string) => (await git(root, "rev-parse", ref)).trim()

const hasBranch = async (root: string, branch: string) => (await git(root, "branch", "--list", branch)).trim() !== ""

// The root repository's person setup: git identity, the .gitignore keeping
// nested repositories out of the root's index, one person commit (no
// trailers — the state before any driver work).
async function initRoot(dir: string, ...nestedRels: string[]): Promise<string> {
  await git(dir, "init", "-q")
  await git(dir, "config", "user.email", "t@example.com")
  await git(dir, "config", "user.name", "t")
  writeFileSync(join(dir, ".gitignore"), nestedRels.map((rel) => `/${rel}\n`).join(""))
  writeFileSync(join(dir, "root.txt"), "init\n")
  await git(dir, "add", "-A")
  await git(dir, "commit", "-qm", "init")
  return fullShaOf(dir, "HEAD")
}

// A nested repository under the target directory: initialized, with identity
// and one setup commit (a person commit in the nested history).
async function nestedRepo(dir: string, rel: string): Promise<string> {
  const root = join(dir, rel)
  mkdirSync(root, { recursive: true })
  await git(root, "init", "-q")
  await git(root, "config", "user.email", "t@example.com")
  await git(root, "config", "user.name", "t")
  writeFileSync(join(root, "readme.txt"), "nested\n")
  await git(root, "add", "-A")
  await git(root, "commit", "-qm", "nested setup")
  return fullShaOf(root, "HEAD")
}

// One driver commit of a task (the real commitTree: the Auto-Task/Auto-Stage
// trailers, and Auto-Nested on the root's commit when nested repositories
// exist). Writes one root file per call so every commit has a change.
async function taskCommit(dir: string, taskId: string, title: string, stage: string, file: string) {
  writeFileSync(join(dir, file), `${taskId} ${stage}\n`)
  const settled = await commitTree(dir, { id: taskId, title }, { stage, subject: `${taskId} ${title}: ${stage}` })
  expect(settled.ok).toBe(true)
}

// The fork worktree paths live outside the project (their bound is the
// point), so withDir's cleanup never reaches them — each test removes its
// own in a finally.
const forksOf = (dir: string) => {
  const paths: string[] = []
  return {
    at: (name: string) => {
      const path = `${dir}-${name}`
      paths.push(path)
      return path
    },
    done: () => {
      for (const path of paths) rmSync(path, { recursive: true, force: true })
    },
  }
}

describe("forkTask (plans/0128: the fork command core)", () => {
  test(
    "the task form: the worktree sits at the parent of the task's oldest commit — interrupted attempts included in what is left behind — on auto-fork/<task>",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      try {
        await initRoot(dir)
        await taskCommit(dir, "T-001", "first migration", "execute", "one.txt")
        const before = await fullShaOf(dir, "HEAD")
        mkdirSync(join(dir, "docs", "T-002"), { recursive: true })
        writeFileSync(join(dir, "docs", "T-002", "todo.md"), "# T-002: second migration\n\n## Goal\nRetry me.\n")
        await taskCommit(dir, "T-002", "second migration", "interrupted", "two.txt")
        await taskCommit(dir, "T-002", "second migration", "execute", "two-b.txt")
        const outcome = await forkTask(dir, "T-002", forks.at("exp"))
        expect(outcome.type).toBe("forked")
        const path = forks.at("exp")
        // The fork point is before the task first started: the interrupted
        // attempt's commit is excluded with the rest.
        expect(await fullShaOf(path, "HEAD")).toBe(before)
        expect(await hasBranch(dir, "auto-fork/T-002")).toBe(true)
        expect(existsSync(join(path, ".git"))).toBe(true)
        expect(await git(path, "status", "--porcelain")).toBe("")
        expect(outcome.lines[0]).toBe(`✓ fork of T-002 second migration created at ${path} on auto-fork/T-002`)
        expect(outcome.lines).toContain(`  .: ${before.slice(0, 7)} — the state before T-002 first started`)
        expect(outcome.lines).toContain(`run it: opencode-auto run ${path} --stop-after T-002`)
        expect(outcome.lines).toContain(`cleanup when done: opencode-auto remove-fork ${path} ${dir} — removes every worktree of the fork and deletes auto-fork/T-002 in each of its repositories`)
        // The main tree is untouched: still at its own HEAD, no checkout.
        expect(await fullShaOf(dir, "HEAD")).not.toBe(before)
        expect(await git(dir, "rev-parse", "--abbrev-ref", "HEAD")).not.toBe("auto-fork/T-002")
      } finally {
        forks.done()
      }
    }),
  )

  test(
    "the sha form: the worktree sits at the named commit itself (the root commit accepted), on auto-fork/<short>",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      try {
        const init = await initRoot(dir)
        await taskCommit(dir, "T-001", "first migration", "execute", "one.txt")
        const after = await fullShaOf(dir, "HEAD")
        const outcome = await forkTask(dir, after.slice(0, 7), forks.at("exp"))
        expect(outcome.type).toBe("forked")
        const path = forks.at("exp")
        expect(await fullShaOf(path, "HEAD")).toBe(after)
        expect(await hasBranch(dir, `auto-fork/${after.slice(0, 7)}`)).toBe(true)
        expect(outcome.lines).not.toContain(`run it: opencode-auto run ${path} --stop-after T-001`)
        // The root commit is a valid fork point for the sha form.
        const atRoot = await forkTask(dir, init.slice(0, 10), forks.at("root"))
        expect(atRoot.type).toBe("forked")
        expect(await fullShaOf(forks.at("root"), "HEAD")).toBe(init)
      } finally {
        forks.done()
      }
    }),
  )

  test(
    "a second fork of the same target takes the first-free branch name",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      try {
        await initRoot(dir)
        await taskCommit(dir, "T-001", "first migration", "execute", "one.txt")
        await taskCommit(dir, "T-002", "second migration", "execute", "two.txt")
        const first = await forkTask(dir, "T-002", forks.at("one"))
        const second = await forkTask(dir, "T-002", forks.at("two"))
        expect(first.type).toBe("forked")
        expect(second.type).toBe("forked")
        expect(await hasBranch(dir, "auto-fork/T-002")).toBe(true)
        expect(await hasBranch(dir, "auto-fork/T-002-2")).toBe(true)
        expect(second.lines[0]).toContain("on auto-fork/T-002-2")
      } finally {
        forks.done()
      }
    }),
  )

  test(
    "nested repositories are reconstructed alongside, aligned at the state the fork commit records",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      try {
        await nestedRepo(dir, "pkg")
        await initRoot(dir, "pkg")
        await taskCommit(dir, "T-001", "first migration", "execute", "one.txt")
        const rootAfter1 = await fullShaOf(dir, "HEAD")
        const pkgAfter1 = await fullShaOf(join(dir, "pkg"), "HEAD")
        await taskCommit(dir, "T-002", "second migration", "execute", "two.txt")
        const outcome = await forkTask(dir, "T-002", forks.at("exp"))
        expect(outcome.type).toBe("forked")
        const path = forks.at("exp")
        expect(await fullShaOf(path, "HEAD")).toBe(rootAfter1)
        // pkg is its own worktree of the nested repository, at the SHA the
        // root commit's Auto-Nested line recorded — the aligned state.
        expect(existsSync(join(path, "pkg", ".git"))).toBe(true)
        expect(await fullShaOf(join(path, "pkg"), "HEAD")).toBe(pkgAfter1)
        expect(outcome.lines).toContain(`  pkg: ${pkgAfter1.slice(0, 7)} (aligned at the fork point)`)
      } finally {
        forks.done()
      }
    }),
  )

  test(
    "nested-of-nested repositories fork shallowest-first: the parent's worktree never meets an existing directory (plans/0191 D1, 0165-143)",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      try {
        // The source layout: root holding a, a holding a/b — each its own
        // repository, a's .gitignore keeping b out of a's index.
        await nestedRepo(dir, "a")
        writeFileSync(join(dir, "a", ".gitignore"), "/b\n")
        await git(join(dir, "a"), "add", "-A")
        await git(join(dir, "a"), "commit", "-qm", "a ignores b")
        const abSetup = await nestedRepo(dir, "a/b")
        const aAfterIgnore = await fullShaOf(join(dir, "a"), "HEAD")
        await initRoot(dir, "a")
        await taskCommit(dir, "T-001", "first migration", "execute", "one.txt")
        const rootAfter1 = await fullShaOf(dir, "HEAD")
        const aAfter1 = await fullShaOf(join(dir, "a"), "HEAD")
        const abAfter1 = await fullShaOf(join(dir, "a", "b"), "HEAD")
        await taskCommit(dir, "T-002", "second migration", "execute", "two.txt")
        // Deepest-first creation (repoRoots' commit order) meets an existing
        // non-empty directory at a — the layout the unified commit fully
        // supports must fork.
        const outcome = await forkTask(dir, "T-002", forks.at("exp"))
        expect(outcome.type).toBe("forked")
        const path = forks.at("exp")
        expect(await fullShaOf(path, "HEAD")).toBe(rootAfter1)
        expect(await fullShaOf(join(path, "a"), "HEAD")).toBe(aAfter1)
        expect(await fullShaOf(join(path, "a", "b"), "HEAD")).toBe(abAfter1)
        expect(abAfter1).toBe(abSetup)
        expect(aAfter1).toBe(aAfterIgnore)
        // One coherent branch name in every repository of the fork.
        for (const repo of [dir, join(dir, "a"), join(dir, "a", "b")]) {
          expect(await hasBranch(repo, "auto-fork/T-002")).toBe(true)
        }
        expect(outcome.lines).toContain(`  a: ${aAfter1.slice(0, 7)} (aligned at the fork point)`)
        expect(outcome.lines).toContain(`  a/b: ${abAfter1.slice(0, 7)} (aligned at the fork point)`)
        // The teardown (deepest-first, the measured opposite) takes the whole
        // scene down again.
        const removed = await removeFork(dir, path)
        expect(removed.type).toBe("removed")
        expect(removed.lines[0]).toBe(`✓ fork at ${path} removed — 3 worktrees and the branch auto-fork/T-002 deleted`)
        for (const repo of [dir, join(dir, "a"), join(dir, "a", "b")]) {
          expect(await hasBranch(repo, "auto-fork/T-002")).toBe(false)
        }
      } finally {
        forks.done()
      }
    }),
  )

  test(
    "a repository the fork commit records but today's tree does not hold is named, never silently dropped (plans/0191 D1, 0165-143)",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      try {
        await nestedRepo(dir, "pkg")
        await initRoot(dir, "pkg")
        const pkgSha = await fullShaOf(join(dir, "pkg"), "HEAD")
        // A person fork commit recording pkg (present) and gone (absent
        // today — removed after the record was written).
        writeFileSync(join(dir, "person.txt"), "person\n")
        await git(dir, "add", "-A")
        await git(dir, "commit", "-qm", "person fork point", "-m", `Auto-Nested: pkg @ ${pkgSha}`, "-m", `Auto-Nested: gone @ ${pkgSha}`)
        const point = await fullShaOf(dir, "HEAD")
        const outcome = await forkTask(dir, point.slice(0, 7), forks.at("exp"))
        expect(outcome.type).toBe("forked")
        expect(outcome.lines).toContain(`  pkg: ${pkgSha.slice(0, 7)} (aligned at the fork point)`)
        expect(outcome.lines).toContain("  ℹ gone: recorded at the fork point but absent from the tree today — not forked; no worktree of the fork holds it")
        // Only the present repository was forked.
        expect(existsSync(join(forks.at("exp"), "pkg", ".git"))).toBe(true)
      } finally {
        forks.done()
      }
    }),
  )

  test(
    "an empty nested repository (no commits) is refused with the one satisfiable act — commit once — not the unsatisfiable sha remedy (plans/0191 D1)",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      try {
        // pkg is a repository with no commit at all: no alignment can exist
        // and no sha can ever be named for it.
        mkdirSync(join(dir, "pkg"), { recursive: true })
        await git(join(dir, "pkg"), "init", "-q")
        await git(join(dir, "pkg"), "config", "user.email", "t@example.com")
        await git(join(dir, "pkg"), "config", "user.name", "t")
        await initRoot(dir, "pkg")
        await taskCommit(dir, "T-001", "first migration", "execute", "one.txt")
        const outcome = await forkTask(dir, "T-001", forks.at("exp"))
        expect(outcome.type).toBe("usage")
        expect(outcome.lines[0]).toBe("T-001: the nested repositories cannot all be aligned at this fork point:")
        expect(outcome.lines.some((line) => line.startsWith("  pkg: the repository is empty (no commits yet) — a worktree cannot be aligned on nothing; commit once in pkg and fork again"))).toBe(true)
        expect(outcome.lines.some((line) => line.includes("not derivable"))).toBe(false)
      } finally {
        forks.done()
      }
    }),
  )

  test(
    "the task form's own-log fallback: a person commit at the fork point (no Auto-Nested lines) falls back to the nested repository's own first task commit",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      try {
        const pkgSetup = await nestedRepo(dir, "pkg")
        const init = await initRoot(dir, "pkg")
        // The task commits in pkg too, so pkg's own log carries a T-001
        // commit whose parent is the fallback's answer.
        writeFileSync(join(dir, "pkg", "change.txt"), "change\n")
        await taskCommit(dir, "T-001", "first migration", "execute", "one.txt")
        // The fork point is the person init commit — no Auto-Nested record;
        // pkg's own oldest T-001 commit's parent is its setup commit.
        const outcome = await forkTask(dir, "T-001", forks.at("exp"))
        expect(outcome.type).toBe("forked")
        const path = forks.at("exp")
        expect(await fullShaOf(path, "HEAD")).toBe(init)
        expect(await fullShaOf(join(path, "pkg"), "HEAD")).toBe(pkgSetup)
      } finally {
        forks.done()
      }
    }),
  )

  test(
    "a nested repository whose state is not derivable refuses naming it (the sha form has no fallback to fall back on)",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      try {
        await nestedRepo(dir, "pkg")
        await initRoot(dir, "pkg")
        await taskCommit(dir, "T-001", "first migration", "execute", "one.txt")
        // pkg2 appears after the fork point and no task ever touched it.
        await nestedRepo(dir, "pkg2")
        const taskRefusal = await forkTask(dir, "T-001", forks.at("exp"))
        expect(taskRefusal.type).toBe("usage")
        expect(taskRefusal.lines[0]).toBe("T-001: the nested repositories cannot all be aligned at this fork point:")
        expect(taskRefusal.lines.some((line) => line.startsWith("  pkg2: its state at the fork point is not derivable"))).toBe(true)
        // The sha form at the person init commit: pkg's fallback is the
        // task's own scan, which the sha form never runs — both refuse.
        const shaRefusal = await forkTask(dir, (await fullShaOf(dir, "HEAD~1")).slice(0, 7), forks.at("exp2"))
        expect(shaRefusal.type).toBe("usage")
        expect(shaRefusal.lines.some((line) => line.startsWith("  pkg:"))).toBe(true)
        expect(shaRefusal.lines.some((line) => line.startsWith("  pkg2:"))).toBe(true)
      } finally {
        forks.done()
      }
    }),
  )

  test(
    "the usage matrix: unknown task, unresolvable sha, the path bounds, the initial-commit edge — each a usage refusal, nothing created",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      try {
        await initRoot(dir)
        await taskCommit(dir, "T-001", "first migration", "execute", "one.txt")
        // A task with no commits never started — the main tree is its beginning.
        const unknown = await forkTask(dir, "T-099", forks.at("exp"))
        expect(unknown.type).toBe("usage")
        expect(unknown.lines[0]).toContain("no commit of this repository carries the trailer Auto-Task: T-099")
        // A sha that does not resolve.
        const unresolvable = await forkTask(dir, "1234567", forks.at("exp"))
        expect(unresolvable.type).toBe("usage")
        expect(unresolvable.lines[0]).toContain("no commit of this repository resolves to this sha")
        // A path that already exists.
        mkdirSync(forks.at("taken"), { recursive: true })
        const exists = await forkTask(dir, "T-001", forks.at("taken"))
        expect(exists.type).toBe("usage")
        expect(exists.lines[0]).toContain("the path already exists")
        // A path inside the project (a worktree there would be misread as a
        // nested repository), and one containing it.
        const inside = await forkTask(dir, "T-001", join(dir, "exp"))
        expect(inside.type).toBe("usage")
        expect(inside.lines[0]).toContain("cannot lie inside the project")
        const around = await forkTask(dir, "T-001", dirname(dir))
        expect(around.type).toBe("usage")
        expect(around.lines[0]).toContain("cannot contain the project")
        // Nothing was created and no branch appeared.
        expect(existsSync(forks.at("exp"))).toBe(false)
        expect(await hasBranch(dir, "auto-fork/T-001")).toBe(false)
        // The initial-commit edge: the task's first commit is the root
        // commit, so no pre-task state exists.
        mkdirSync(forks.at("bare"), { recursive: true })
        const bare = forks.at("bare")
        await git(bare, "init", "-q")
        await git(bare, "config", "user.email", "t@example.com")
        await git(bare, "config", "user.name", "t")
        writeFileSync(join(bare, "a.txt"), "a\n")
        const settled = await commitTree(bare, { id: "T-001", title: "first migration" }, { stage: "execute", subject: "T-001 first migration: execute" })
        expect(settled.ok).toBe(true)
        const edge = await forkTask(bare, "T-001", forks.at("edge"))
        expect(edge.type).toBe("usage")
        expect(edge.lines[0]).toContain("is the repository's initial commit")
        expect(existsSync(forks.at("edge"))).toBe(false)
      } finally {
        forks.done()
      }
    }),
  )
})

describe("the named-alignment form (sha:<rel>@<sha>: the person names the nested state on the command)", () => {
  test(
    "a person commit that records no Auto-Nested line forks with the nested worktree at the sha named on the command",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      try {
        const pkgSetup = await nestedRepo(dir, "pkg")
        const init = await initRoot(dir, "pkg")
        // pkg moves past its setup before the fork is asked for — the named
        // sha, not the nested HEAD, is what the fork must land on.
        writeFileSync(join(dir, "pkg", "later.txt"), "later\n")
        await git(join(dir, "pkg"), "add", "-A")
        await git(join(dir, "pkg"), "commit", "-qm", "nested later")
        const outcome = await forkTask(dir, `${init.slice(0, 7)}:pkg@${pkgSetup.slice(0, 7)}`, forks.at("exp"))
        expect(outcome.type).toBe("forked")
        const path = forks.at("exp")
        expect(await fullShaOf(path, "HEAD")).toBe(init)
        expect(existsSync(join(path, "pkg", ".git"))).toBe(true)
        expect(await fullShaOf(join(path, "pkg"), "HEAD")).toBe(pkgSetup)
        expect(await hasBranch(dir, `auto-fork/${init.slice(0, 7)}`)).toBe(true)
        expect(outcome.lines).toContain(`  pkg: ${pkgSetup.slice(0, 7)} (aligned as named)`)
        // The main tree's nested repository is untouched at its own HEAD.
        expect(await fullShaOf(join(dir, "pkg"), "HEAD")).not.toBe(pkgSetup)
      } finally {
        forks.done()
      }
    }),
  )

  test(
    "a named entry wins over the recorded alignment; repositories not named keep the record's",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      try {
        const pkgSetup = await nestedRepo(dir, "pkg")
        const pkg2Setup = await nestedRepo(dir, "pkg2")
        await initRoot(dir, "pkg", "pkg2")
        await taskCommit(dir, "T-001", "first migration", "execute", "one.txt")
        // A person commit inside pkg between two driver commits, so the
        // record at the fork point holds a different pkg sha than the named
        // one — precedence is what this pins.
        writeFileSync(join(dir, "pkg", "later.txt"), "later\n")
        await git(join(dir, "pkg"), "add", "-A")
        await git(join(dir, "pkg"), "commit", "-qm", "nested later")
        await taskCommit(dir, "T-002", "second migration", "execute", "two.txt")
        const rootAfter2 = await fullShaOf(dir, "HEAD")
        const outcome = await forkTask(dir, `${rootAfter2.slice(0, 7)}:pkg@${pkgSetup.slice(0, 7)},pkg2@${pkg2Setup.slice(0, 7)}`, forks.at("exp"))
        expect(outcome.type).toBe("forked")
        const path = forks.at("exp")
        expect(await fullShaOf(path, "HEAD")).toBe(rootAfter2)
        expect(await fullShaOf(join(path, "pkg"), "HEAD")).toBe(pkgSetup)
        expect(await fullShaOf(join(path, "pkg2"), "HEAD")).toBe(pkg2Setup)
        expect(outcome.lines).toContain(`  pkg: ${pkgSetup.slice(0, 7)} (aligned as named)`)
        expect(outcome.lines).toContain(`  pkg2: ${pkg2Setup.slice(0, 7)} (aligned as named)`)
      } finally {
        forks.done()
      }
    }),
  )

  test(
    "the refusal matrix: an unmatched rel, a malformed entry, an unresolvable named sha, an unresolvable root sha — usage, nothing created",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      try {
        const pkgSetup = await nestedRepo(dir, "pkg")
        const init = await initRoot(dir, "pkg")
        const short = init.slice(0, 7)
        // A rel no repository sits at — never silently ignored; pkg itself,
        // unrecorded at the person commit and unnamed, rides along with its
        // own underivable line teaching the command form.
        const ghost = await forkTask(dir, `${short}:ghost@${pkgSetup.slice(0, 7)}`, forks.at("exp"))
        expect(ghost.type).toBe("usage")
        expect(ghost.lines[0]).toBe(`${short}:ghost@${pkgSetup.slice(0, 7)}: the nested repositories cannot all be aligned at this fork point:`)
        expect(ghost.lines.some((line) => line.startsWith("  ghost: no nested repository of this project sits there"))).toBe(true)
        expect(ghost.lines.some((line) => line.startsWith("  pkg: its state at the fork point is not derivable"))).toBe(true)
        expect(ghost.lines.some((line) => line.includes("name it on the command"))).toBe(true)
        // A malformed entry (no @).
        const malformed = await forkTask(dir, `${short}:pkg`, forks.at("exp"))
        expect(malformed.type).toBe("usage")
        expect(malformed.lines[0]).toContain("not a nested alignment")
        // A named sha that does not resolve in the nested repository.
        const unresolvable = await forkTask(dir, `${short}:pkg@abcdef0`, forks.at("exp"))
        expect(unresolvable.type).toBe("usage")
        expect(unresolvable.lines.some((line) => line.startsWith("  pkg: the aligned sha abcdef0 you named does not resolve"))).toBe(true)
        // A root sha that does not resolve — the sha named alone in the
        // refusal, not the whole target.
        const badRoot = await forkTask(dir, `abcdef0:pkg@${pkgSetup.slice(0, 7)}`, forks.at("exp"))
        expect(badRoot.type).toBe("usage")
        expect(badRoot.lines[0]).toContain("abcdef0: no commit of this repository resolves to this sha")
        expect(existsSync(forks.at("exp"))).toBe(false)
        expect(await hasBranch(dir, `auto-fork/${short}`)).toBe(false)
      } finally {
        forks.done()
      }
    }),
  )
})

describe("the corpus bound (plans/0140: a task number re-issued over retained history)", () => {
  // A person-side plain commit (no Auto-Task trailer): the formulation
  // commits (the PLAN formulate shape writes the unit document) and the
  // restart's wipe commit of these fixtures.
  async function personCommit(dir: string, message: string) {
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", message)
  }

  async function formulate(dir: string, taskId: string) {
    mkdirSync(join(dir, "docs", taskId), { recursive: true })
    writeFileSync(join(dir, "docs", taskId, "todo.md"), `# ${taskId}\n\n## Goal\n\nThe current corpus's formulation.\n`)
    await personCommit(dir, `${taskId} formulated`)
  }

  // The restart itself: the corpus wiped over retained history (the docs
  // tree gone, the git history holding every old-corpus commit), the
  // shape reset + a hand wipe leaves behind.
  async function restart(dir: string) {
    rmSync(join(dir, "docs"), { recursive: true, force: true })
    await personCommit(dir, "restart: the corpus wiped")
  }

  test(
    "an id re-issued after the restart: the fork sits at the current corpus's pre-start, the success line naming the older lineage",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      try {
        await initRoot(dir)
        await formulate(dir, "T-001")
        await taskCommit(dir, "T-001", "first migration", "execute", "old.txt")
        await restart(dir)
        await formulate(dir, "T-001")
        const before = await fullShaOf(dir, "HEAD")
        await taskCommit(dir, "T-001", "first migration", "execute", "new.txt")
        const outcome = await forkTask(dir, "T-001", forks.at("exp"))
        expect(outcome.type).toBe("forked")
        const path = forks.at("exp")
        // The current corpus's pre-start: after its formulation, before its
        // first task commit — never the old corpus's, which unbounded would
        // have pinned (the parent of the old exec commit).
        expect(await fullShaOf(path, "HEAD")).toBe(before)
        expect(existsSync(join(path, "old.txt"))).toBe(true)
        expect(existsSync(join(path, "new.txt"))).toBe(false)
        expect(outcome.lines).toContain(
          `  .: ${before.slice(0, 7)} — the state before T-001 first started (this corpus; the history also holds older T-001 commits from before a restart)`,
        )
      } finally {
        forks.done()
      }
    }),
  )

  test(
    "an id the current corpus never re-issued: the old corpus's own pre-start, no note (the cross-corpus floor)",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      try {
        await initRoot(dir)
        await formulate(dir, "T-005")
        const oldPreStart = await fullShaOf(dir, "HEAD")
        await taskCommit(dir, "T-005", "fifth migration", "execute", "five.txt")
        await restart(dir)
        await formulate(dir, "T-001")
        await taskCommit(dir, "T-001", "first migration", "execute", "new.txt")
        const outcome = await forkTask(dir, "T-005", forks.at("exp"))
        expect(outcome.type).toBe("forked")
        const path = forks.at("exp")
        // The newest addition of docs/T-005/todo.md is still the old
        // corpus's formulation, so the corpus set contains the old corpus's
        // commits: the derivation lands where the unbounded scan did.
        expect(await fullShaOf(path, "HEAD")).toBe(oldPreStart)
        expect(outcome.lines).toContain(`  .: ${oldPreStart.slice(0, 7)} — the state before T-005 first started`)
      } finally {
        forks.done()
      }
    }),
  )

  test(
    "formulated in the current corpus but never started: the refusal names the corpus shape (the old corpus's commits do not count as its start)",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      try {
        await initRoot(dir)
        await formulate(dir, "T-001")
        await taskCommit(dir, "T-001", "first migration", "execute", "old.txt")
        await restart(dir)
        await formulate(dir, "T-001")
        const refused = await forkTask(dir, "T-001", forks.at("exp"))
        expect(refused.type).toBe("usage")
        expect(refused.lines[0]).toContain("every commit carrying the trailer Auto-Task: T-001 predates this corpus's formulation of the unit")
        expect(existsSync(forks.at("exp"))).toBe(false)
        expect(await hasBranch(dir, "auto-fork/T-001")).toBe(false)
      } finally {
        forks.done()
      }
    }),
  )
})

describe("symlinked paths speak git's own spelling (plans/0191 D2, 0165-144)", () => {
  test(
    "a fork created through a symlinked path prints the real path git registered, and remove-fork answers for either spelling",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      const homes: string[] = []
      try {
        await initRoot(dir)
        await taskCommit(dir, "T-001", "first migration", "execute", "one.txt")
        await taskCommit(dir, "T-002", "second migration", "execute", "two.txt")
        // A home directory reached through a symlink — the host shape the
        // finding measured: git registers the realpath, the shell resolves
        // the argument lexically.
        const realHome = await mkdtemp(join(tmpdir(), "auto-fork-home-"))
        homes.push(realHome)
        const link = `${realHome}-link`
        symlinkSync(realHome, link)
        const viaLink = join(link, "exp")
        const real = join(realHome, "exp")
        const outcome = await forkTask(dir, "T-002", viaLink)
        expect(outcome.type).toBe("forked")
        // The success lines name the path git registered — the cleanup
        // command round-trips.
        expect(outcome.lines[0]).toBe(`✓ fork of T-002 created at ${real} on auto-fork/T-002`)
        expect(outcome.lines).toContain(`cleanup when done: opencode-auto remove-fork ${real} ${dir} — removes every worktree of the fork and deletes auto-fork/T-002 in each of its repositories`)
        expect(existsSync(join(real, ".git"))).toBe(true)
        // remove-fork through the LINK spelling — the person's shell history
        // form of the same directory — finds the registered worktree.
        const removed = await removeFork(dir, viaLink)
        expect(removed.type).toBe("removed")
        expect(removed.lines[0]).toBe(`✓ fork at ${real} removed — 1 worktree and the branch auto-fork/T-002 deleted`)
        expect(await hasBranch(dir, "auto-fork/T-002")).toBe(false)
      } finally {
        forks.done()
        for (const home of homes) {
          rmSync(home, { recursive: true, force: true })
          rmSync(`${home}-link`, { force: true })
        }
      }
    }),
  )

  test(
    "a worktree path that resolves INTO the project through a symlink is refused by the containment guard",
    withDir(async (dir) => {
      try {
        await initRoot(dir)
        await taskCommit(dir, "T-001", "first migration", "execute", "one.txt")
        // A symlink beside the project pointing at it: <base>/intolink/wt is
        // lexically outside the project but resolves to <dir>/wt — a
        // worktree there would be misread as a nested repository by every
        // later unified commit (the guard's own words).
        const intoLink = join(dirname(dir), `${dir.split(sep).pop()}-into`)
        symlinkSync(dir, intoLink)
        const outcome = await forkTask(dir, "T-001", join(intoLink, "wt"))
        expect(outcome.type).toBe("usage")
        expect(outcome.lines[0]).toBe(`${join(intoLink, "wt")}: the fork worktree cannot lie inside the project — a worktree there would be misread as a nested repository by every unified commit; place it outside ${dir}`)
        expect(existsSync(join(dir, "wt"))).toBe(false)
      } finally {
        rmSync(join(dirname(dir), `${dir.split(sep).pop()}-into`), { force: true })
      }
    }),
  )
})

describe("worktree-creation failures report their cause, not git's progress (plans/0191 D3, 0165-145)", () => {
  test("addWorktree over an existing non-empty directory, and over an existing branch name — both name the fatal line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-fork-cause-"))
    try {
      await git(dir, "init", "-q")
      await git(dir, "config", "user.email", "t@example.com")
      await git(dir, "config", "user.name", "t")
      writeFileSync(join(dir, "a.txt"), "a\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      // An existing non-empty directory: git prints its progress line first,
      // the fatal "already exists" after — the cause is the fatal line.
      const taken = join(dir, "wt-taken")
      mkdirSync(taken)
      writeFileSync(join(taken, "x.txt"), "x\n")
      const existing = await addWorktree(dir, taken, "cause-b1")
      expect(existing.ok).toBe(false)
      expect(existing.error).toContain("already exists")
      expect(existing.error).not.toContain("Preparing worktree")
      // An existing branch name: a different cause, the same shape.
      const fresh = await addWorktree(dir, join(dir, "wt-fresh"), "master")
      expect(fresh.ok).toBe(false)
      expect(fresh.error).toContain("a branch named")
      expect(fresh.error).not.toContain("Preparing worktree")
      // addWorktreeAt (fork's form) shares the helper.
      const atTaken = await addWorktreeAt(dir, join(dir, "wt-at"), "cause-b2", "HEAD")
      expect(atTaken.ok).toBe(true)
      const atBranch = await addWorktreeAt(dir, join(dir, "wt-at2"), "cause-b2", "HEAD")
      expect(atBranch.ok).toBe(false)
      expect(atBranch.error).toContain("a branch named")
      expect(atBranch.error).not.toContain("Preparing worktree")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("removeFork (plans/0139: the teardown of what fork builds)", () => {
  // A planted live run lock inside the fork's tree — the experiment running
  // there, whose work the teardown must not destroy mid-run. The pid is 1's,
  // not this process's own: stale() reads a lock naming the reading process
  // itself as a dead predecessor whose pid was reused, so pid 1 (alive,
  // unprobeable-EPERM) is the plant that reads live.
  async function plantRunLock(path: string) {
    mkdirSync(join(path, ".auto"), { recursive: true })
    writeFileSync(join(path, ".auto", "run.lock"), JSON.stringify({ pid: 1, host: hostname(), command: "run", started: new Date().toISOString() }))
  }

  test(
    "the teardown: every worktree of the fork removed, the branch deleted per repository, the tips named — committed experiment work needs no force",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      try {
        await nestedRepo(dir, "pkg")
        await initRoot(dir, "pkg")
        await taskCommit(dir, "T-001", "first migration", "execute", "one.txt")
        await taskCommit(dir, "T-002", "second migration", "execute", "two.txt")
        const forked = await forkTask(dir, "T-002", forks.at("exp"))
        expect(forked.type).toBe("forked")
        const path = forks.at("exp")
        // The experiment commits on the fork's branch: discardable by design —
        // the printed full shas are the one recovery handle until git gc
        // prunes the objects (plans/0191 D4: the reflogs die with the
        // worktree removal and the branch -D).
        writeFileSync(join(path, "exp.txt"), "experiment\n")
        await git(path, "add", "-A")
        await git(path, "commit", "-qm", "experiment")
        const rootTip = await fullShaOf(path, "HEAD")
        const pkgTip = await fullShaOf(join(path, "pkg"), "HEAD")
        const sourceHead = await fullShaOf(dir, "HEAD")
        const outcome = await removeFork(dir, path)
        expect(outcome.type).toBe("removed")
        expect(outcome.lines[0]).toBe(`✓ fork at ${path} removed — 2 worktrees and the branch auto-fork/T-002 deleted`)
        expect(outcome.lines).toContain(`  pkg: worktree removed, branch auto-fork/T-002 deleted (was ${pkgTip})`)
        expect(outcome.lines).toContain(`  .: worktree removed, branch auto-fork/T-002 deleted (was ${rootTip})`)
        expect(outcome.lines).toContain(`  the tips above stay recoverable by their printed shas until git gc prunes them (the reflogs went with the deletion) — git branch auto-fork/T-002 <the (was …) sha> recreates one in its repository`)
        // The recipe is true: the object is still present after the teardown,
        // and no reflog names it (the claim the old line made falsely).
        expect((await git(dir, "cat-file", "-t", rootTip)).trim()).toBe("commit")
        expect((await git(dir, "reflog", "show", "--all", "--grep=experiment")).trim()).toBe("")
        expect(outcome.lines).toContain(`retry: opencode-auto fork T-002 ${path} ${dir}`)
        expect(existsSync(path)).toBe(false)
        expect(await hasBranch(dir, "auto-fork/T-002")).toBe(false)
        expect(await hasBranch(join(dir, "pkg"), "auto-fork/T-002")).toBe(false)
        // The source trees are untouched: same HEADs, no checkout moved.
        expect(await fullShaOf(dir, "HEAD")).toBe(sourceHead)
        expect(await fullShaOf(join(dir, "pkg"), "HEAD")).toBe(pkgTip)
      } finally {
        forks.done()
      }
    }),
  )

  test(
    "the retry round-trip: after the teardown the same path and target take the stem branch again",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      try {
        await initRoot(dir)
        await taskCommit(dir, "T-001", "first migration", "execute", "one.txt")
        await taskCommit(dir, "T-002", "second migration", "execute", "two.txt")
        expect((await forkTask(dir, "T-002", forks.at("exp"))).type).toBe("forked")
        expect((await removeFork(dir, forks.at("exp"))).type).toBe("removed")
        const again = await forkTask(dir, "T-002", forks.at("exp"))
        expect(again.type).toBe("forked")
        // A leftover branch would have pushed the retry to -2 forever; the
        // teardown frees the stem name.
        expect(await hasBranch(dir, "auto-fork/T-002")).toBe(true)
        expect(await hasBranch(dir, "auto-fork/T-002-2")).toBe(false)
        expect(again.lines[0]).toContain("on auto-fork/T-002")
      } finally {
        forks.done()
      }
    }),
  )

  test(
    "uncommitted work blocks naming the files per member — nothing removed — and --force discards it explicitly",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      try {
        await nestedRepo(dir, "pkg")
        await initRoot(dir, "pkg")
        await taskCommit(dir, "T-001", "first migration", "execute", "one.txt")
        await taskCommit(dir, "T-002", "second migration", "execute", "two.txt")
        expect((await forkTask(dir, "T-002", forks.at("exp"))).type).toBe("forked")
        const path = forks.at("exp")
        writeFileSync(join(path, "junk.txt"), "uncommitted\n")
        writeFileSync(join(path, "pkg", "junk2.txt"), "uncommitted\n")
        const refused = await removeFork(dir, path)
        expect(refused.type).toBe("blocked")
        expect(refused.lines[0]).toContain("the fork holds uncommitted work — remove-fork never discards it silently")
        expect(refused.lines).toContain("  .:")
        expect(refused.lines).toContain("    ?? junk.txt")
        expect(refused.lines).toContain("  pkg:")
        expect(refused.lines).toContain("    ?? junk2.txt")
        expect(refused.lines.some((line) => line.startsWith("to discard it instead: opencode-auto remove-fork"))).toBe(true)
        // The refusal touched nothing.
        expect(existsSync(path)).toBe(true)
        expect(await hasBranch(dir, "auto-fork/T-002")).toBe(true)
        const forced = await removeFork(dir, path, { force: true })
        expect(forced.type).toBe("removed")
        expect(forced.lines[0]).toContain("(--force: the uncommitted work discarded)")
        expect(existsSync(path)).toBe(false)
        expect(await hasBranch(dir, "auto-fork/T-002")).toBe(false)
      } finally {
        forks.done()
      }
    }),
  )

  test(
    "the usage matrix: the project's own tree, a stranger path, a person worktree, a member off the coherent branch — each refused, nothing touched",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      try {
        await nestedRepo(dir, "pkg")
        await initRoot(dir, "pkg")
        await taskCommit(dir, "T-001", "first migration", "execute", "one.txt")
        await taskCommit(dir, "T-002", "second migration", "execute", "two.txt")
        // The project's own working tree is never a removal target.
        const self = await removeFork(dir, dir)
        expect(self.type).toBe("usage")
        expect(self.lines[0]).toContain("the project's own working tree")
        // A path where no worktree of the source is registered.
        mkdirSync(forks.at("plain"), { recursive: true })
        const stranger = await removeFork(dir, forks.at("plain"))
        expect(stranger.type).toBe("usage")
        expect(stranger.lines[0]).toContain(`no worktree of ${dir} is registered there`)
        // A person worktree on a non-fork branch is never touched.
        await git(dir, "worktree", "add", "-q", "-b", "person-branch", forks.at("person"))
        const person = await removeFork(dir, forks.at("person"))
        expect(person.type).toBe("usage")
        expect(person.lines[0]).toContain("on person-branch, not of the fork family auto-fork/*")
        expect(existsSync(forks.at("person"))).toBe(true)
        await git(dir, "worktree", "remove", "--force", forks.at("person"))
        // A nested member checked out elsewhere breaks the coherence — the
        // whole removal refuses rather than guessing.
        expect((await forkTask(dir, "T-002", forks.at("exp"))).type).toBe("forked")
        await git(join(forks.at("exp"), "pkg"), "checkout", "-q", "-b", "drifted")
        const off = await removeFork(dir, forks.at("exp"))
        expect(off.type).toBe("usage")
        expect(off.lines[0]).toContain("the fork's repositories do not all sit on auto-fork/T-002:")
        expect(off.lines.some((line) => line.startsWith("  pkg: its worktree under the fork is on drifted"))).toBe(true)
        expect(existsSync(forks.at("exp"))).toBe(true)
      } finally {
        forks.done()
      }
    }),
  )

  test(
    "a run live inside the fork refuses (its in-flight work is not torn down mid-run); the fork itself stands",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      try {
        await initRoot(dir)
        await taskCommit(dir, "T-001", "first migration", "execute", "one.txt")
        expect((await forkTask(dir, "T-001", forks.at("exp"))).type).toBe("forked")
        const path = forks.at("exp")
        await plantRunLock(path)
        const live = await removeFork(dir, path)
        expect(live.type).toBe("blocked")
        expect(live.lines[0]).toContain(`holds the run lock of ${path}`)
        expect(existsSync(path)).toBe(true)
        expect(await hasBranch(dir, "auto-fork/T-001")).toBe(true)
      } finally {
        forks.done()
      }
    }),
  )

  test(
    "a swept fork (the directory already gone by hand): the registrations and branches still come down",
    withDir(async (dir) => {
      const forks = forksOf(dir)
      try {
        await nestedRepo(dir, "pkg")
        await initRoot(dir, "pkg")
        // pkg carries its own T-001 commit (a change written before the task
        // commit rides into it), so the task form's fallback can align it.
        writeFileSync(join(dir, "pkg", "change.txt"), "change\n")
        await taskCommit(dir, "T-001", "first migration", "execute", "one.txt")
        expect((await forkTask(dir, "T-001", forks.at("exp"))).type).toBe("forked")
        const path = forks.at("exp")
        const rootTip = await fullShaOf(path, "HEAD")
        rmSync(path, { recursive: true, force: true })
        const outcome = await removeFork(dir, path)
        expect(outcome.type).toBe("removed")
        expect(outcome.lines.some((line) => line.startsWith("  pkg: worktree already gone — registration dropped, branch auto-fork/T-001 deleted (was "))).toBe(true)
        expect(outcome.lines).toContain(`  .: worktree already gone — registration dropped, branch auto-fork/T-001 deleted (was ${rootTip})`)
        expect(await hasBranch(dir, "auto-fork/T-001")).toBe(false)
        expect(await hasBranch(join(dir, "pkg"), "auto-fork/T-001")).toBe(false)
      } finally {
        forks.done()
      }
    }),
  )
})
