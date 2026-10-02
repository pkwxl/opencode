import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  addWorktree,
  baselineIntact,
  beginUnit,
  changedFiles,
  commitIdentityProblem,
  commitPending,
  commitTitle,
  commitTree,
  deletedFiles,
  deleteBranch,
  fileCommitted,
  fileTracked,
  landBranch,
  mergeBaseSha,
  pendingChanges,
  pruneWorktrees,
  removeIfUntracked,
  removeWorktree,
  repoRoots,
  restoreFile,
  rollbackUnit,
  suffixedTitle,
  trackedSourceChanges,
  unitBaseline,
  unitViolations,
} from "../src/git"
import { noCommitGit } from "../src/git-ops"

async function git(dir: string, ...args: string[]) {
  const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`git ${args.join(" ")} exit code ${code}: ${err || out}`)
  return out
}

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), "auto-git-"))
  await git(dir, "init", "-q")
  return dir
}

const task = { id: "T-001", title: "implement the migration" }

describe("commitTree", () => {
  test("non-git directory: a no-op without error, pendingChanges false", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-git-"))
    try {
      await writeFile(join(dir, "a.txt"), "a")
      await commitTree(dir, task, { stage: "execute", subject: "T-001 implement the migration: execute" })
      expect(await pendingChanges(dir)).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("git repository: the commit carries the subject line and the Auto-Task/Auto-Stage trailers; with no changes it skips and creates no new commit", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "a.txt"), "a")
      await commitTree(dir, task, { stage: "subtask 2", subject: "T-001: subtask 2 write the schema" })
      const message = await git(dir, "log", "-1", "--pretty=%B")
      expect(message).toContain("T-001: subtask 2 write the schema")
      expect(message).toContain("Auto-Task: T-001")
      expect(message).toContain("Auto-Stage: subtask 2")
      expect(await pendingChanges(dir)).toBe(false)
      // No changes: no new commit is created
      await commitTree(dir, task, { stage: "wrapup", subject: "T-001 implement the migration: wrap-up" })
      expect((await git(dir, "rev-list", "--count", "HEAD")).trim()).toBe("1")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("nested repositories commit first; the parent's commit message records their path and SHA with Auto-Nested", async () => {
    const dir = await fresh()
    try {
      await mkdir(join(dir, "pkg"))
      await git(join(dir, "pkg"), "init", "-q")
      await writeFile(join(dir, "root.txt"), "r")
      await writeFile(join(dir, "pkg", "inner.txt"), "i")
      await commitTree(dir, task, { stage: "subtask 1", subject: "T-001: subtask 1 build the skeleton" })
      expect((await git(dir, "rev-list", "--count", "HEAD")).trim()).toBe("1")
      expect((await git(join(dir, "pkg"), "rev-list", "--count", "HEAD")).trim()).toBe("1")
      const message = await git(dir, "log", "-1", "--pretty=%B")
      expect(message).toMatch(/Auto-Nested: pkg @ [0-9a-f]{7,}/)
      expect(await pendingChanges(dir)).toBe(false)
      expect(await pendingChanges(join(dir, "pkg"))).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("empty repository identity (user.email unset): the identity fallback still commits", async () => {
    const dir = await fresh()
    try {
      // Blank the identity locally, the deterministic path of a fresh
      // environment (no global user.email configured)
      await git(dir, "config", "user.email", "")
      await git(dir, "config", "user.name", "")
      await writeFile(join(dir, "a.txt"), "a")
      await commitTree(dir, task, { stage: "done", subject: "T-001 implement the migration: done" })
      expect((await git(dir, "log", "-1", "--pretty=%an")).trim()).toBe("opencode-auto")
      expect((await git(dir, "log", "-1", "--pretty=%ae")).trim()).toBe("opencode-auto@local")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an over-long subject line is truncated to 100 characters", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "a.txt"), "a")
      await commitTree(dir, task, { stage: "execute", subject: `${task.id} ${task.title}: ${"x".repeat(150)}` })
      const subject = (await git(dir, "log", "-1", "--pretty=%s")).trimEnd()
      expect(subject.length).toBe(101)
      expect(subject.endsWith("…")).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("commitIdentityProblem(init's prerequisite: the repository must be able to commit)", () => {
  test("a non-git directory needs no check: undefined", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-git-"))
    try {
      expect(await commitIdentityProblem(dir)).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a repository with a configured identity: undefined", async () => {
    const dir = await fresh()
    try {
      await git(dir, "config", "user.name", "t")
      await git(dir, "config", "user.email", "t@t")
      expect(await commitIdentityProblem(dir)).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a repository with an empty identity (user.name/user.email locally blanked): the missing identity is reported", async () => {
    const dir = await fresh()
    try {
      // Same trick as the "empty identity" commitTree case: a locally blanked
      // value overrides any global config, so a commit would fail for sure.
      await git(dir, "config", "user.name", "")
      await git(dir, "config", "user.email", "")
      const problem = await commitIdentityProblem(dir)
      expect(problem).toContain("identity unknown")
      expect(problem).toContain("ident")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ---- Unit commit boundary (plans/0021-commit-boundary-design.md) ----

// A pre-commit hook that always fails: builds a deterministic
// commit-failure environment.
async function failHooks(dir: string) {
  await mkdir(join(dir, "hooks"))
  await writeFile(join(dir, "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 })
  await git(dir, "config", "core.hooksPath", "hooks")
}

describe("commitTree failure reporting", () => {
  test("pre-commit hook rejects: ok=false, the failure list carries the repository-relative path and the error; the changes stay in the worktree", async () => {
    const dir = await fresh()
    try {
      await failHooks(dir)
      await writeFile(join(dir, "a.txt"), "a")
      const result = await commitTree(dir, task, { stage: "execute", subject: "T-001 execute" })
      expect(result.ok).toBe(false)
      expect(result.failures).toHaveLength(1)
      expect(result.failures[0]!.rel).toBe(".")
      expect(result.failures[0]!.error.length).toBeGreaterThan(0)
      expect(await pendingChanges(dir)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("Auto-Nested covers every nested repository: one untouched this round still records its current HEAD SHA", async () => {
    const dir = await fresh()
    try {
      await mkdir(join(dir, "pkg"))
      await git(join(dir, "pkg"), "init", "-q")
      await writeFile(join(dir, "pkg", "inner.txt"), "i")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: inner repository init" })
      const pkgHead = (await git(join(dir, "pkg"), "rev-parse", "--short", "HEAD")).trim()
      // This round only changes the root repository, the nested one is
      // untouched — the root commit must still record pkg's latest SHA
      await writeFile(join(dir, "root.txt"), "r")
      const result = await commitTree(dir, task, { stage: "wrapup", subject: "T-001: wrap-up" })
      expect(result.ok).toBe(true)
      const message = await git(dir, "log", "-1", "--pretty=%B")
      expect(message).toMatch(new RegExp(`Auto-Nested: pkg @ ${pkgHead}`))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("unitBaseline / unitViolations (unit close-out check)", () => {
  test("a driver commit range passes; an external commit and a leftover dirty area are each detected", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "a.txt"), "a")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: pre-baseline commit" })
      const baseline = await unitBaseline(dir)
      // ① a driver commit (with the Auto-Stage trailer) → no violations
      await writeFile(join(dir, "b.txt"), "b")
      await commitTree(dir, task, { stage: "subtask 1", subject: "T-001: subtask 1" })
      expect(await unitViolations(dir, baseline)).toEqual([])
      // ② an external commit (no Auto-Stage trailer) → detected
      await writeFile(join(dir, "c.txt"), "c")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "manual commit")
      const violations = await unitViolations(dir, baseline)
      expect(violations).toHaveLength(1)
      expect(violations[0]).toContain("non-driver commit")
      // ③ leftover uncommitted changes → detected
      await git(dir, "commit", "--amend", "-qm", "manual commit") // restore the worktree to clean
      await writeFile(join(dir, "d.txt"), "d")
      const dirty = await unitViolations(dir, baseline)
      expect(dirty.some((problem) => problem.includes("uncommitted changes"))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an empty baseline (gate off / non-git environment) always passes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-git-"))
    try {
      expect(await unitViolations(dir, [])).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("beginUnit (unit start gate)", () => {
  test("clean → record the baseline; the no-commit double / dryrun → straight through with no baseline", async () => {
    const dir = await fresh()
    try {
      const gate = await beginUnit(dir, {}, task)
      expect(gate.type).toBe("ok")
      if (gate.type === "ok") expect(gate.baseline).toHaveLength(1)
      const off = await noCommitGit().beginUnit(dir, {}, task)
      expect(off).toEqual({ type: "ok", baseline: undefined })
      const dry = await beginUnit(dir, { dryrun: true }, task)
      expect(dry).toEqual({ type: "ok", baseline: undefined })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("leftover driver-exclusive state writes (index ticks, the unit todo→done rename, the retired CURRENT.md deletion) → a carryover backfill commit self-heals", async () => {
    const dir = await fresh()
    try {
      await mkdir(join(dir, "docs/R-01/P01-implement"), { recursive: true })
      await mkdir(join(dir, "docs/T-001"), { recursive: true })
      await writeFile(join(dir, "docs/R-01/phases.md"), "- [ ] P01 implement\n")
      await writeFile(join(dir, "docs/R-01/P01-implement/tasks.md"), "- [ ] T-001 sample\n")
      await writeFile(join(dir, "docs/T-001/todo.md"), "# T-001: sample\n")
      await writeFile(join(dir, "CURRENT.md"), "mirror\n")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: seed" })
      // The scene of an interruption between markDone and the final-state
      // commit; CURRENT.md is the retired mirror an earlier release left
      // behind and preflight deletes (plans/0054 D3)
      await rename(join(dir, "docs/T-001/todo.md"), join(dir, "docs/T-001/done.md"))
      await writeFile(join(dir, "docs/R-01/P01-implement/tasks.md"), "- [x] T-001 sample\n")
      await rm(join(dir, "CURRENT.md"))
      const gate = await beginUnit(dir, {}, task)
      expect(gate.type).toBe("ok")
      expect(await changedFiles(dir)).toEqual([])
      const message = await git(dir, "log", "-1", "--pretty=%B")
      expect(message).toContain("Auto-Stage: carryover")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("any other dirty area (manual edits / half-finished AI output) → dirty, handed to a person, never swept automatically", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "src.ts"), "x")
      const gate = await beginUnit(dir, {}, task)
      expect(gate).toEqual({ type: "dirty", files: ["src.ts"] })
      // The dirty area stays exactly as it was (the driver does not touch git)
      expect(await changedFiles(dir)).toEqual(["src.ts"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("dirty non-state files inside the round and task directories still go dirty to a person (subtask state files are not carryover)", async () => {
    const dir = await fresh()
    try {
      await mkdir(join(dir, "docs/R-01/P01-implement"), { recursive: true })
      await mkdir(join(dir, "docs/T-001/S01"), { recursive: true })
      await writeFile(join(dir, "docs/R-01/phases.md"), "- [ ] P01 implement\n")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: seed" })
      await writeFile(join(dir, "docs/R-01/P01-implement/handover.md"), "a\n")
      await writeFile(join(dir, "docs/T-001/S01/done.md"), "a\n")
      expect(await beginUnit(dir, {}, task)).toEqual({ type: "dirty", files: ["docs/R-01/P01-implement/handover.md", "docs/T-001/S01/done.md"] })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("commitPending (a hidden task's ③ backfill commit)", () => {
  test("an artifact on the uncommitted list → backfill commit and return the result; not on it → clean; the no-commit double → clean", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "seed.txt"), "s")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: seed" })
      await mkdir(join(dir, "docs"))
      await writeFile(join(dir, "docs", "kb.md"), "knowledge")
      const committed = await commitPending(dir, {}, task, { stage: "knowledge", subject: "PLAN knowledge migration knowledge distillation" }, [join("docs", "kb.md")])
      expect(committed !== "clean" && committed.ok).toBe(true)
      expect(await changedFiles(dir)).toEqual([])
      const message = await git(dir, "log", "-1", "--pretty=%B")
      expect(message).toContain("Auto-Stage: knowledge")
      // Already committed → clean, no action
      expect(await commitPending(dir, {}, task, { stage: "knowledge", subject: "x" }, [join("docs", "kb.md")])).toBe("clean")
      // The no-commit double → clean no-op
      await writeFile(join(dir, "docs", "kb2.md"), "knowledge 2")
      expect(await noCommitGit().commitPending(dir, {}, task, { stage: "knowledge", subject: "x" }, [join("docs", "kb2.md")])).toBe("clean")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ---- Recovery fidelity (plans/0022-session-recovery-fidelity-design.md 3.1 ③ / 3.3) ----

describe("baselineIntact (baseline verification at recovery)", () => {
  test("HEAD == baseline / a range of only driver commits → passes; an external commit is detected; **uncommitted dirty areas are not reported**", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "a.txt"), "a")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: pre-baseline commit" })
      const baseline = await unitBaseline(dir)
      // ① HEAD == baseline
      expect(await baselineIntact(dir, baseline)).toEqual([])
      // ② baseline..HEAD is all driver commits (with the Auto-Stage trailer)
      await writeFile(join(dir, "b.txt"), "b")
      await commitTree(dir, task, { stage: "subtask 1", subject: "T-001: subtask 1" })
      expect(await baselineIntact(dir, baseline)).toEqual([])
      // ③ a mid-way dirty area is exactly what recovery handles: the check
      // ignores uncommitted changes (the key difference from unitViolations)
      await writeFile(join(dir, "c.txt"), "c")
      expect(await baselineIntact(dir, baseline)).toEqual([])
      expect((await unitViolations(dir, baseline)).some((problem) => problem.includes("uncommitted changes"))).toBe(true)
      // ④ an external commit (no Auto-Stage trailer) mixed in → the recovered
      // picture is wrong
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "manual commit")
      const problems = await baselineIntact(dir, baseline)
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain("non-driver commit")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an empty baseline always passes; a baseline on record but an unreadable repository → HEAD unreadable", async () => {
    const dir = await fresh()
    try {
      expect(await baselineIntact(dir, [])).toEqual([])
      const problems = await baselineIntact(dir, [{ root: join(dir, "missing"), sha: "abc1234" }])
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain("HEAD unreadable")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an empty-repository baseline (no commits yet when the unit started): driver commits pass, an external commit is detected", async () => {
    const dir = await fresh()
    try {
      const baseline = await unitBaseline(dir)
      expect(baseline).toEqual([{ root: dir, sha: "" }])
      expect(await baselineIntact(dir, baseline)).toEqual([])
      await writeFile(join(dir, "a.txt"), "a")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: first commit inside the unit" })
      expect(await baselineIntact(dir, baseline)).toEqual([])
      await writeFile(join(dir, "b.txt"), "b")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "manual commit")
      expect((await baselineIntact(dir, baseline))[0]).toContain("non-driver commit")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("rollbackUnit (the rollback protocol when fidelity cannot be kept)", () => {
  const info = { task: "T-001", unit: "subtask 1" }

  test("dirty area + driver commits in this unit → stash×2 + soft reset back to the baseline, worktree clean, the scene in the stash", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "seed.txt"), "s")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: pre-baseline commit" })
      const baseline = await unitBaseline(dir)
      const base = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      await writeFile(join(dir, "done.txt"), "committed half-finished work")
      await commitTree(dir, task, { stage: "subtask 1", subject: "T-001: subtask 1 mid-flight" })
      await writeFile(join(dir, "wip.txt"), "uncommitted half-finished work")
      const result = await rollbackUnit(dir, baseline, info)
      expect(result.ok).toBe(true)
      expect(result.stashes).toBe(2)
      expect(result.resets).toEqual(["."])
      expect(result.skipped).toEqual([])
      expect((await git(dir, "rev-parse", "--short", "HEAD")).trim()).toBe(base)
      expect(await changedFiles(dir)).toEqual([])
      const stashes = await git(dir, "stash", "list")
      expect(stashes).toContain("auto-rollback")
      expect(stashes.trim().split("\n")).toHaveLength(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an external commit mixed in → ok=false with that repository left as-is (manual commits untouched, handed to a person)", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "seed.txt"), "s")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: pre-baseline commit" })
      const baseline = await unitBaseline(dir)
      await writeFile(join(dir, "human.txt"), "manual edit")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "manual commit")
      const head = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      await writeFile(join(dir, "wip.txt"), "half-finished work")
      const result = await rollbackUnit(dir, baseline, info)
      expect(result.ok).toBe(false)
      expect(result.failures).toHaveLength(1)
      expect(result.failures[0]!.rel).toBe(".")
      expect(result.stashes).toBe(0)
      expect((await git(dir, "rev-parse", "--short", "HEAD")).trim()).toBe(head)
      expect(await changedFiles(dir)).toEqual(["wip.txt"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an upstream detected → stash only, branch history untouched (counted in skipped)", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "seed.txt"), "s")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: pre-baseline commit" })
      const baseline = await unitBaseline(dir)
      await writeFile(join(dir, "done.txt"), "committed")
      await commitTree(dir, task, { stage: "subtask 1", subject: "T-001: subtask 1 mid-flight" })
      const head = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      // A self-referencing upstream (no remote needed): the current branch's
      // upstream points at a local mirror branch
      const current = (await git(dir, "rev-parse", "--abbrev-ref", "HEAD")).trim()
      await git(dir, "branch", "upstream-mirror")
      await git(dir, "config", `branch.${current}.remote`, ".")
      await git(dir, "config", `branch.${current}.merge`, "refs/heads/upstream-mirror")
      await writeFile(join(dir, "wip.txt"), "half-finished work")
      const result = await rollbackUnit(dir, baseline, info)
      expect(result.ok).toBe(true)
      expect(result.stashes).toBe(1)
      expect(result.resets).toEqual([])
      expect(result.skipped).toEqual(["."])
      expect((await git(dir, "rev-parse", "--short", "HEAD")).trim()).toBe(head)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an empty-repository baseline (no commits yet when the unit started) → stash only, history not rewound", async () => {
    const dir = await fresh()
    try {
      const baseline = await unitBaseline(dir)
      await writeFile(join(dir, "a.txt"), "a")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: first commit inside the unit" })
      const head = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      await writeFile(join(dir, "wip.txt"), "half-finished work")
      const result = await rollbackUnit(dir, baseline, info)
      expect(result.ok).toBe(true)
      expect(result.stashes).toBe(1)
      expect(result.resets).toEqual([])
      expect(result.skipped).toEqual(["."])
      expect((await git(dir, "rev-parse", "--short", "HEAD")).trim()).toBe(head)
      expect(await changedFiles(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("nested repositories roll back to their own baselines (depth-first, inner before outer)", async () => {
    const dir = await fresh()
    try {
      await mkdir(join(dir, "pkg"))
      await git(join(dir, "pkg"), "init", "-q")
      await writeFile(join(dir, "root.txt"), "r")
      await writeFile(join(dir, "pkg", "inner.txt"), "i")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: pre-baseline commit" })
      const baseline = await unitBaseline(dir)
      const bases = Object.fromEntries(baseline.map((line) => [line.root, line.sha]))
      // Each repository gets one driver commit + one dirty area left behind
      await writeFile(join(dir, "root2.txt"), "r2")
      await writeFile(join(dir, "pkg", "inner2.txt"), "i2")
      await commitTree(dir, task, { stage: "subtask 1", subject: "T-001: subtask 1 mid-flight" })
      await writeFile(join(dir, "wip.txt"), "partial")
      await writeFile(join(dir, "pkg", "wip.txt"), "partial")
      const result = await rollbackUnit(dir, baseline, info)
      expect(result.ok).toBe(true)
      expect(result.resets.sort()).toEqual([".", "pkg"])
      expect(result.stashes).toBe(4)
      expect((await git(dir, "rev-parse", "--short", "HEAD")).trim()).toBe(bases[dir])
      expect((await git(join(dir, "pkg"), "rev-parse", "--short", "HEAD")).trim()).toBe(bases[join(dir, "pkg")])
      expect(await changedFiles(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("test-handover drift registration: trackedSourceChanges", () => {
  test("non-git directory: no changes to speak of, returns an empty array", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-git-"))
    try {
      await writeFile(join(dir, "src.ts"), "a")
      expect(await trackedSourceChanges(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("only tracked non-document changes count: the document side and untracked additions are not registered", async () => {
    const dir = await fresh()
    try {
      await mkdir(join(dir, "docs", "T-001"), { recursive: true })
      await mkdir(join(dir, "test"), { recursive: true })
      await writeFile(join(dir, "src.ts"), "v1")
      await writeFile(join(dir, "test", "build.sh"), "echo v1")
      await writeFile(join(dir, "docs", "T-001", "testhandoff.md"), "old")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: freeze" })
      expect(await trackedSourceChanges(dir)).toEqual([])

      // Document-side changes (docs/**) do not count.
      await writeFile(join(dir, "docs", "T-001", "testhandoff.md"), "new")
      // Untracked additions do not count (a known trade-off).
      await writeFile(join(dir, "fresh.ts"), "new file")
      expect(await trackedSourceChanges(dir)).toEqual([])

      // Only tracked source and test/ script changes count.
      await writeFile(join(dir, "src.ts"), "v2")
      await writeFile(join(dir, "test", "build.sh"), "echo v2")
      expect((await trackedSourceChanges(dir)).sort()).toEqual([join("test", "build.sh"), "src.ts"].sort())
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("nested repositories covered too: the tracked changes of the outer and inner repositories merge into one list", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "src.ts"), "v1")
      const nested = join(dir, "vendor")
      await mkdir(nested, { recursive: true })
      await git(nested, "init", "-q")
      await writeFile(join(nested, "lib.ts"), "n1")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: freeze" })
      expect(await trackedSourceChanges(dir)).toEqual([])

      await writeFile(join(dir, "src.ts"), "v2")
      await writeFile(join(nested, "lib.ts"), "n2")
      expect((await trackedSourceChanges(dir)).sort()).toEqual(["src.ts", join("vendor", "lib.ts")].sort())
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("scene restoration of handover documents (test-handover interruption recovery F3)", () => {
  test("a committed yet deleted document: listed, retrievable, restoring it clears the dirty area", async () => {
    const dir = await fresh()
    try {
      await mkdir(join(dir, "docs", "T-028", "S03"), { recursive: true })
      const rel = join("docs", "T-028", "S03", "testhandoff.md")
      await writeFile(join(dir, rel), "handover body\n\nStatus: continue\n")
      await commitTree(dir, task, { stage: "subtask 3 handoff-1", subject: "T-001 test handover #1" })
      expect(await fileTracked(dir, rel)).toBe(true)
      expect(await fileCommitted(dir, rel)).toBe(true)
      expect(await deletedFiles(dir, "docs")).toEqual([])

      // A previous run's stale cleanup deleted the in-flight document: the
      // deletion itself is the dirty area
      await rm(join(dir, rel), { force: true })
      expect(await deletedFiles(dir, "docs")).toEqual([rel])
      expect(await changedFiles(dir)).toEqual([rel])

      expect(await restoreFile(dir, rel)).toBe(true)
      expect(await Bun.file(join(dir, rel)).text()).toBe("handover body\n\nStatus: continue\n")
      expect(await changedFiles(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an untracked file: not counted as committed, not counted as deleted", async () => {
    const dir = await fresh()
    try {
      await mkdir(join(dir, "docs"), { recursive: true })
      await writeFile(join(dir, "docs", "stray.md"), "leftover")
      expect(await fileTracked(dir, join("docs", "stray.md"))).toBe(false)
      expect(await fileCommitted(dir, join("docs", "stray.md"))).toBe(false)
      expect(await deletedFiles(dir, "docs")).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // The shared primitive of the steer handover document (handoff.md) stale
  // cleanup (F4 semantics hoisted): a tracked one is the in-flight state of
  // an unclosed unit — deleting it is a dirty area, kept for the recovery
  // semantics; an untracked stale leftover is deleted as-is.
  test("removeIfUntracked: a tracked file is not deleted and produces no dirty area, an untracked one is deleted as-is", async () => {
    const dir = await fresh()
    try {
      const rel = join("docs", "T-028", "handoff.md")
      await mkdir(join(dir, "docs", "T-028"), { recursive: true })
      await writeFile(join(dir, rel), "handover body\n\nStatus: continue\n")
      await commitTree(dir, { id: "T-028", title: "code landing" }, { stage: "subtask 1 handoff", subject: "T-028 S1 handover" })
      await removeIfUntracked(dir, rel)
      expect(await Bun.file(join(dir, rel)).exists()).toBe(true)
      expect(await changedFiles(dir)).toEqual([])
      const stray = join("docs", "T-028", "handoff-legacy.md")
      await writeFile(join(dir, stray), "leftover")
      await removeIfUntracked(dir, stray)
      expect(await Bun.file(join(dir, stray)).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("tracked but modified in the worktree: not counted as committed (commit #2 has not happened yet)", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "a.md"), "one")
      await commitTree(dir, task, { stage: "execute", subject: "T-001 execute" })
      await writeFile(join(dir, "a.md"), "two")
      expect(await fileTracked(dir, "a.md")).toBe(true)
      expect(await fileCommitted(dir, "a.md")).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("non-git directory: always a safe fallback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-git-"))
    try {
      expect(await deletedFiles(dir, "docs")).toEqual([])
      expect(await fileTracked(dir, "a.md")).toBe(false)
      expect(await fileCommitted(dir, "a.md")).toBe(false)
      expect(await restoreFile(dir, "a.md")).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("suffixedTitle (handover commit title = unit title + handover marker)", () => {
  test("a short title is concatenated as-is", () => {
    expect(suffixedTitle("T-028 S3 finalize parameters and implement the main chain family", "test handover #1 freeze")).toBe("T-028 S3 finalize parameters and implement the main chain family test handover #1 freeze")
  })

  test("when over-long the body is truncated and the suffix kept, the total stays within commitTitle's limit (no second truncation)", () => {
    const base = `T-028 S3 ${"x".repeat(120)}`
    const title = suffixedTitle(base, "test handover #2 freeze")
    expect(title.endsWith("… test handover #2 freeze")).toBe(true)
    expect(title.length).toBeLessThanOrEqual(100)
    // Key point: #n and "freeze" are the only information distinguishing one
    // subtask's repeated handover commits, they must not be cut off
    expect(commitTitle(title)).toBe(title)
  })

  test("exactly at the limit: not truncated", () => {
    const suffix = "test handover #1"
    const base = "x".repeat(100 - suffix.length - 1)
    expect(suffixedTitle(base, suffix)).toBe(`${base} ${suffix}`)
    expect(suffixedTitle(base, suffix).length).toBe(100)
  })
})

// ---- Lane worktrees and the landing merge (plans/0068 §6.5, D1/D7/D16/F6) ----

// A committed repository with a lane worktree on auto-lane/T-001, the park
// inside .auto/worktrees/ (gitignored like the rest of .auto/): the shared
// scene of the worktree cases below. Returns the park path.
async function laneScene(): Promise<{ dir: string; park: string; branch: string }> {
  const dir = await fresh()
  await writeFile(join(dir, ".gitignore"), ".auto/\n")
  await writeFile(join(dir, "base.txt"), "base\n")
  await commitTree(dir, task, { stage: "execute", subject: "T-001: baseline" })
  const park = join(dir, ".auto", "worktrees", task.id)
  const branch = `auto-lane/${task.id}`
  const added = await addWorktree(dir, park, branch)
  if (!added.ok) throw new Error(added.error)
  return { dir, park, branch }
}

describe("addWorktree / removeWorktree / pruneWorktrees / mergeBaseSha (the lane git primitives)", () => {
  test("addWorktree creates the worktree on the lane branch at HEAD; the park is not a nested repo (F6); removeWorktree and prune clean up", async () => {
    const { dir, park, branch } = await laneScene()
    try {
      // The worktree is a checkout of the main HEAD on its own branch.
      expect(await Bun.file(join(park, "base.txt")).text()).toBe("base\n")
      expect(await Bun.file(join(park, ".git")).exists()).toBe(true)
      expect((await git(dir, "rev-parse", "--abbrev-ref", "HEAD")).trim()).not.toBe(branch)
      expect((await git(park, "rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe(branch)
      // F6: the linked worktree's `.git` file must not classify it as a
      // nested repository — the unified commit would commit inside the park.
      expect(await repoRoots(dir)).toEqual([dir])
      expect(await changedFiles(dir)).toEqual([])
      // A nested repository beside the park is still discovered: the skip is
      // the park alone, not `.auto/` at large.
      await mkdir(join(dir, "vendor", "lib"), { recursive: true })
      await git(join(dir, "vendor", "lib"), "init", "-q")
      expect(await repoRoots(dir)).toContain(join(dir, "vendor", "lib"))
      // removeWorktree tears the worktree down; prune is then a no-op.
      const removed = await removeWorktree(dir, park)
      expect(removed.ok).toBe(true)
      expect(await Bun.file(park).exists()).toBe(false)
      expect((await git(dir, "worktree", "list")).trim()).not.toContain(park)
      expect(await pruneWorktrees(dir)).toEqual({ ok: true })
      // removeWorktree of a missing path fails and says so.
      const missing = await removeWorktree(dir, park)
      expect(missing.ok).toBe(false)
      expect(missing.error).toBeTruthy()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a dirty lane worktree needs the force retry: removeWorktree still succeeds", async () => {
    const { dir, park } = await laneScene()
    try {
      await writeFile(join(park, "uncommitted.txt"), "dirt\n")
      expect((await removeWorktree(dir, park)).ok).toBe(true)
      expect(await Bun.file(park).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("pruneWorktrees drops the administrative entry of a manually deleted worktree directory", async () => {
    const { dir, park } = await laneScene()
    try {
      await rm(park, { recursive: true, force: true })
      expect((await git(dir, "worktree", "list")).trim()).toContain(task.id)
      expect(await pruneWorktrees(dir)).toEqual({ ok: true })
      expect((await git(dir, "worktree", "list")).trim()).not.toContain(task.id)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("addWorktree of an existing path or branch fails with git's error", async () => {
    const { dir, park, branch } = await laneScene()
    try {
      const again = await addWorktree(dir, park, "auto-lane/T-002")
      expect(again.ok).toBe(false)
      expect(again.error).toBeTruthy()
      const taken = await addWorktree(dir, join(dir, ".auto", "worktrees", "T-002"), branch)
      expect(taken.ok).toBe(false)
      expect(taken.error).toBeTruthy()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("mergeBaseSha names where the lane forked; a lane commit keeps it, a main commit moves it", async () => {
    const { dir, park } = await laneScene()
    try {
      const head = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      expect(await mergeBaseSha(dir, "HEAD", "auto-lane/T-001")).toBe(head)
      // A driver commit on the lane branch leaves the fork point alone.
      await writeFile(join(park, "lane.txt"), "lane\n")
      await commitTree(park, task, { stage: "subtask 1", subject: "T-001: subtask 1" })
      expect(await mergeBaseSha(dir, "HEAD", "auto-lane/T-001")).toBe(head)
      // An unresolved side names nothing.
      expect(await mergeBaseSha(dir, "HEAD", "auto-lane/T-999")).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("landBranch (D7's landing merge)", () => {
  test("merges the lane branch --no-ff with Auto-Task/Auto-Stage: landing trailers; deleteBranch cleans up after", async () => {
    const { dir, park, branch } = await laneScene()
    try {
      await writeFile(join(park, "lane.txt"), "lane\n")
      await commitTree(park, task, { stage: "subtask 1", subject: "T-001: subtask 1" })
      const landed = await landBranch(dir, branch, task)
      expect(landed).toEqual({ type: "ok" })
      // The lane's work arrived in the main tree through a merge commit.
      expect(await Bun.file(join(dir, "lane.txt")).text()).toBe("lane\n")
      expect(await pendingChanges(dir)).toBe(false)
      const parents = (await git(dir, "log", "-1", "--format=%P")).trim().split(" ")
      expect(parents).toHaveLength(2)
      const message = await git(dir, "log", "-1", "--pretty=%B")
      expect(message).toContain("Auto-Task: T-001")
      expect(message).toContain("Auto-Stage: landing")
      // The merged branch deletes cleanly once its worktree is gone (the
      // teardown order landLane keeps: worktree first, branch second).
      expect(await removeWorktree(dir, park)).toEqual({ ok: true })
      expect(await deleteBranch(dir, branch)).toEqual({ ok: true })
      expect((await git(dir, "branch", "--list", branch)).trim()).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a conflicting main-tree commit: the merge aborts as a conflict and leaves the main tree clean", async () => {
    const { dir, park, branch } = await laneScene()
    try {
      // Both sides move the same file.
      await writeFile(join(park, "base.txt"), "lane side\n")
      await commitTree(park, task, { stage: "subtask 1", subject: "T-001: subtask 1" })
      await writeFile(join(dir, "base.txt"), "main side\n")
      await commitTree(dir, task, { stage: "housekeeping", subject: "PLAN housekeeping sibling move" })
      const landed = await landBranch(dir, branch, task)
      expect(landed.type).toBe("conflict")
      // The main tree is exactly the pre-merge state again.
      expect(await Bun.file(join(dir, "base.txt")).text()).toBe("main side\n")
      expect(await changedFiles(dir)).toEqual([])
      // The lane branch and worktree survive for the conflict protocol (`+`
      // marks a branch checked out in another worktree).
      expect((await git(dir, "branch", "--list", branch)).trim()).toContain(branch)
      expect(await Bun.file(join(park, "base.txt")).text()).toBe("lane side\n")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("landing an unknown branch is a plain failure, not a conflict", async () => {
    const { dir } = await laneScene()
    try {
      const landed = await landBranch(dir, "auto-lane/T-999", task)
      expect(landed.type).toBe("failed")
      if (landed.type === "failed") expect(landed.error).toBeTruthy()
      expect(await changedFiles(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("the git seam's lane members (the no-commit double)", () => {
  test("the double fails closed on worktree creation and landing; removal and prune answer ok", async () => {
    const double = noCommitGit()
    const created = await double.addWorktree("/nowhere", "/nowhere/park", "auto-lane/T-001")
    expect(created.ok).toBe(false)
    const landed = await double.landBranch("/nowhere", "auto-lane/T-001", task)
    expect(landed.type).toBe("failed")
    expect(await double.removeWorktree("/nowhere", "/nowhere/park")).toEqual({ ok: true })
    expect(await double.pruneWorktrees("/nowhere")).toEqual({ ok: true })
  })
})
