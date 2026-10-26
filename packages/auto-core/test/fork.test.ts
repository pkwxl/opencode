// The fork command core (plans/0128): forkTask — the experiment environment
// in a new worktree. The task form's derivation (the parent of the oldest
// Auto-Task commit, interrupted attempts included in what is excluded), the
// sha form (the named commit itself, the root commit accepted), the branch
// family's first-free naming, the nested repositories' aligned
// reconstruction (the Auto-Nested record, the task form's own-log fallback,
// the underivable refusal), and the usage matrix (unknown task, unresolvable
// sha, the path bounds, the initial-commit edge). The driver's commits are
// made by the real commitTree, so the trailers the derivation scans are the
// production ones. land's original-branch filter (the auto-fork/* family)
// is pinned beside its own suite in test/land.test.ts.
import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { commitTree } from "../src/git"
import { forkTask } from "../src/fork"
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
        expect(outcome.lines).toContain(`  git -C ${dir} worktree remove ${path} && git -C ${dir} branch -D auto-fork/T-002`)
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
