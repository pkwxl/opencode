// The worktree cleanliness gate's own laws (plans/0232 D2, finding
// 0165-063/S01-05 — the module had no direct test import): clean returns
// undefined, dirty returns the ready-to-print message (the first ten files,
// the "…and N more files" line past ten, the two ways out), the scope is the
// repository containing the target plus every nested repository in the tree
// (repoRoots' descent), and a directory outside any repository is let
// through as clean (the stated stance — git is the user's only undo, and
// where there is no git there is nothing to undo). The gate's consumers
// (reset, the init-over-config path) are the CLI suites' subject; these pins
// hold the gate's own half.
import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkCleanTree } from "../src/clean"

const gitOf = (dir: string) => {
  return async (...args: string[]) => {
    const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    expect(code, `git ${args.join(" ")}: ${err}`).toBe(0)
    return out
  }
}

const ACTION = "reset"

describe("checkCleanTree", () => {
  test("a clean worktree is undefined; a non-git directory is let through as clean", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-clean-"))
    try {
      // No repository here at all: repoRoots finds none, changedFiles is
      // empty, the gate lets the destructive operation through.
      expect(await checkCleanTree(dir, ACTION)).toBeUndefined()
      const git = gitOf(dir)
      await git("init")
      await git("config", "user.email", "t@t")
      await git("config", "user.name", "t")
      await writeFile(join(dir, "committed.txt"), "x")
      await git("add", "-A")
      await git("commit", "-qm", "baseline")
      expect(await checkCleanTree(dir, ACTION)).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("uncommitted changes return the message: the action line, the files indented, the two ways out", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-clean-"))
    try {
      const git = gitOf(dir)
      await git("init")
      await git("config", "user.email", "t@t")
      await git("config", "user.name", "t")
      await writeFile(join(dir, "committed.txt"), "x")
      await git("add", "-A")
      await git("commit", "-qm", "baseline")
      await writeFile(join(dir, "committed.txt"), "changed")
      await writeFile(join(dir, "untracked.txt"), "new")
      const message = await checkCleanTree(dir, ACTION)
      expect(message).toBeDefined()
      const lines = message!.split("\n")
      expect(lines[0]).toBe(`${ACTION} will delete or modify files on disk and requires a clean worktree (including all nested repos/submodules in the tree); uncommitted changes found:`)
      // The tracked modification and the untracked file both surface, the
      // paths relative to the target directory.
      expect(lines).toContain("  committed.txt")
      expect(lines).toContain("  untracked.txt")
      expect(lines.at(-1)).toBe("commit or git stash these changes first; to run on a dirty worktree anyway, pass -f/--force to skip this check")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("past ten files the preview counts the rest in one line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-clean-"))
    try {
      const git = gitOf(dir)
      await git("init")
      await git("config", "user.email", "t@t")
      await git("config", "user.name", "t")
      await git("commit", "--allow-empty", "-qm", "baseline")
      for (let i = 1; i <= 12; i++) await writeFile(join(dir, `file-${String(i).padStart(2, "0")}.txt`), "new")
      const message = await checkCleanTree(dir, ACTION)
      expect(message).toBeDefined()
      const lines = message!.split("\n")
      expect(lines).toContain("  file-10.txt")
      expect(lines).not.toContain("  file-11.txt")
      expect(lines).toContain("  …and 2 more files")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a nested repository's dirt is in scope (the whole tree, not only the outer repository)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-clean-"))
    try {
      const git = gitOf(dir)
      await git("init")
      await git("config", "user.email", "t@t")
      await git("config", "user.name", "t")
      await git("commit", "--allow-empty", "-qm", "baseline")
      const nested = join(dir, "vendor", "inner")
      await mkdir(nested, { recursive: true })
      const inner = gitOf(nested)
      await inner("init")
      await inner("config", "user.email", "t@t")
      await inner("config", "user.name", "t")
      await writeFile(join(nested, "inner-dirt.txt"), "new")
      // The outer repository sees only its own (clean) tree; the nested
      // repository's untracked file is what the gate must catch.
      const message = await checkCleanTree(dir, ACTION)
      expect(message).toBeDefined()
      expect(message!.split("\n")).toContain(join("  vendor", "inner", "inner-dirt.txt"))
      // Remove the dirt: the whole tree clean, the gate open again.
      await rm(join(nested, "inner-dirt.txt"))
      expect(await checkCleanTree(dir, ACTION)).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
