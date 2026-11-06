import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  baselineIntact,
  beginUnit,
  bootstrapRepository,
  changedFiles,
  commitIdentityProblem,
  commitPending,
  commitTitle,
  nextFixSession,
  shortTitle,
  commitTree,
  deletedFiles,
  fileCommitted,
  fileTracked,
  pendingChanges,
  removeIfUntracked,
  repoRoots,
  restoreFile,
  rollbackUnit,
  statusEntries,
  statusEntriesRead,
  stashTree,
  suffixedTitle,
  taskChangedPaths,
  unitBaseline,
  unitViolations,
  driverStage,
  driverBoundary,
  foreignCommits,
  writeLocalIdentity,
  scriptGuardSnapshot,
  scriptGuardCheck,
  workTree,
  rangeChangedFiles,
} from "../src/git"
import {
  addWorktree,
  deleteBranch,
  landBranch,
  mergeBaseSha,
  pruneWorktrees,
  removeWorktree,
  WORKTREE_TEARDOWN,
} from "../src/git-worktree"
import { afterSession, noCommitGit } from "../src/git-ops"
import { captureRun } from "./fixtures/capture"
import { git } from "./fixtures/runner"

describe("shortTitle (the commit-subject title form, plans/0148 D2)", () => {
  test("the leading words, cut at the first colon/paren/em-dash, capped at four", () => {
    expect(shortTitle("K5 verity (batch B14)")).toBe("K5 verity")
    expect(shortTitle("K2 families: flakey/dust/delay/ebs/switch/log-writes (batch B12)")).toBe("K2 families")
    expect(shortTitle("Formulate the Implementation tasks")).toBe("Formulate the Implementation tasks")
    expect(shortTitle("Formulate the Implementation tasks for the second wave")).toBe("Formulate the Implementation tasks")
    expect(shortTitle("wall resolution — split in-diff or record the waiver")).toBe("wall resolution")
    expect(shortTitle("sample task")).toBe("sample task")
    // A title whose first clause is empty (it starts with the separator)
    // falls back to its leading words — never an empty subject tail.
    expect(shortTitle("（中文标题）的迁移任务")).toBe("（中文标题）的迁移任务")
  })
})

describe("nextFixSession (the fix round's per-session ordinals, plans/0148 D1)", () => {
  test("one past the highest <id> fix <round>.<n> subject across every repository root", async () => {
    const dir = await fresh()
    await Bun.write(join(dir, "a.txt"), "1\n")
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "T-001 exec sample")
    await git(dir, "commit", "--allow-empty", "-qm", "T-001 fix 2.1 sample")
    await git(dir, "commit", "--allow-empty", "-qm", "T-001 fix 2.3 sample")
    expect(await nextFixSession(dir, "T-001", 2)).toBe(4)
    // A different round or task starts fresh at 1; a failed read (no commits
    // of the shape) is an empty history.
    expect(await nextFixSession(dir, "T-001", 1)).toBe(1)
    expect(await nextFixSession(dir, "T-002", 2)).toBe(1)
  })
})

async function fresh() {
  const dir = await mkdtemp(join(tmpdir(), "auto-git-"))
  await git(dir, "init", "-q")
  return dir
}

const task = { id: "T-001", title: "implement the migration" }

// The session-made unit-close restore (plans/0170 D2, enacting 0165-006 /
// S12-01): a todo.md → done.md rename is driver-exclusive, and the unified
// commit must not land one the driver never made — the confirmed defect had
// a work session rename its own todo.md, the rename ride the session's
// boundary commit, and every later load read the task done past a FAIL
// verdict. The three shapes below pin the boundary's behavior: the own
// task's task-level close restored at every stage, the stage's own subtask
// close exempt (the driver's rename precedes its afterSession), another
// subtask index restored, and another task's close deliberately untouched
// (an interrupted driver close rides beginUnit's carryover self-heal).
describe("afterSession's session-made unit-close restore (plans/0170 D2)", () => {
  test("a session's own todo→done rename is restored before the commit and never lands", async () => {
    const dir = await fresh()
    try {
      await mkdir(join(dir, "docs/T-001"), { recursive: true })
      await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "task planned")
      // The session's act: the rename (nothing else dirty).
      await rename(join(dir, "docs/T-001/todo.md"), join(dir, "docs/T-001/done.md"))
      const settled = await afterSession(dir, {}, task, { stage: "execute", subject: "T-001 execute" })
      expect(settled).toEqual({ type: "ok" })
      expect(await Bun.file(join(dir, "docs/T-001/todo.md")).text()).toBe("# T-001\n")
      expect(await Bun.file(join(dir, "docs/T-001/done.md")).exists()).toBe(false)
      expect(await pendingChanges(dir)).toBe(false)
      expect(await git(dir, "log", "--name-only", "--format=", "--", "docs/T-001/done.md")).not.toContain("done.md")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the subtask stage's own index is exempt (the driver's rename precedes its afterSession); any other index is restored", async () => {
    const dir = await fresh()
    try {
      for (const sub of ["S01", "S02"]) {
        await mkdir(join(dir, "docs/T-001", sub), { recursive: true })
        await Bun.write(join(dir, "docs/T-001", sub, "todo.md"), `# ${sub}\n`)
      }
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "subtasks planned")
      // The driver's own close of S01 (renameTodoToDone's output), then its
      // afterSession: the close commits, never restored.
      await rename(join(dir, "docs/T-001/S01/todo.md"), join(dir, "docs/T-001/S01/done.md"))
      const own = await afterSession(dir, {}, task, { stage: "subtask 1", subject: "T-001 S01" })
      expect(own).toEqual({ type: "ok" })
      expect(await Bun.file(join(dir, "docs/T-001/S01/done.md")).exists()).toBe(true)
      // A session closing a different subtask's state (S02, seen at S01's
      // boundary): restored before the commit.
      await rename(join(dir, "docs/T-001/S02/todo.md"), join(dir, "docs/T-001/S02/done.md"))
      const other = await afterSession(dir, {}, task, { stage: "subtask 1", subject: "T-001 S01 again" })
      expect(other).toEqual({ type: "ok" })
      expect(await Bun.file(join(dir, "docs/T-001/S02/todo.md")).exists()).toBe(true)
      expect(await Bun.file(join(dir, "docs/T-001/S02/done.md")).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // The own contract's content restore (plans/0171 D6, enacting S08-04): a
  // session editing its own todo.md — dropping ledger rows, weakening an
  // Acceptance — must not land in the unified commit. HEAD holds the
  // driver's last word; the boundary writes it back. Other tasks' documents
  // (a planning session's output) are never touched.
  test("a session's own todo.md content edit is restored from HEAD before the commit; another task's document keeps the session's write", async () => {
    const dir = await fresh()
    try {
      await mkdir(join(dir, "docs/T-001"), { recursive: true })
      await mkdir(join(dir, "docs/T-002"), { recursive: true })
      const own = ["# T-001", "", "## Acceptance", "", "The acceptance statements hold.", ""].join("\n")
      await Bun.write(join(dir, "docs/T-001/todo.md"), own)
      await Bun.write(join(dir, "docs/T-002/todo.md"), "# T-002\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "tasks planned")
      // The session's acts: an edit to its own contract (a weakened
      // Acceptance) and a planned task's document (legitimate planning
      // output — a different task's file).
      await Bun.write(join(dir, "docs/T-001/todo.md"), own.replace("The acceptance statements hold.", "(whatever)"))
      await Bun.write(join(dir, "docs/T-002/todo.md"), "# T-002\n\nplanned by the session\n")
      const settled = await afterSession(dir, {}, task, { stage: "execute", subject: "T-001 execute" })
      expect(settled).toEqual({ type: "ok" })
      expect(await Bun.file(join(dir, "docs/T-001/todo.md")).text()).toBe(own)
      expect(await Bun.file(join(dir, "docs/T-002/todo.md")).text()).toContain("planned by the session")
      expect(await pendingChanges(dir)).toBe(false)
      expect(await git(dir, "show", "HEAD:./docs/T-001/todo.md")).toBe(own)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("another task's close is deliberately untouched (the interrupted driver close rides the carryover, never this restore)", async () => {
    const dir = await fresh()
    try {
      await mkdir(join(dir, "docs/T-001"), { recursive: true })
      await mkdir(join(dir, "docs/T-002"), { recursive: true })
      await Bun.write(join(dir, "docs/T-001/todo.md"), "# T-001\n")
      await Bun.write(join(dir, "docs/T-002/todo.md"), "# T-002\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "tasks planned")
      // T-002's close sits in the tree (an interrupted driver close of
      // another unit): T-001's boundary commits it as-is (P20 — a
      // legitimate driver write is never destroyed by another unit's
      // restore).
      await rename(join(dir, "docs/T-002/todo.md"), join(dir, "docs/T-002/done.md"))
      const settled = await afterSession(dir, {}, task, { stage: "execute", subject: "T-001 execute" })
      expect(settled).toEqual({ type: "ok" })
      expect(await Bun.file(join(dir, "docs/T-002/done.md")).exists()).toBe(true)
      expect(await Bun.file(join(dir, "docs/T-002/todo.md")).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

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

// ---- init's git bootstrap and identity flags (plans/0073) ----

// The branch a fresh `git init` takes on this host: init.defaultBranch when
// the environment sets one, else the bootstrap's -b main fallback. Asking git
// itself keeps the expectation host-independent (the ambient config layers —
// including a GIT_CONFIG_GLOBAL the e2e side pins — are exactly what the
// bootstrap honors).
async function expectedDefaultBranch(): Promise<string> {
  const proc = Bun.spawnSync(["git", "config", "--get", "init.defaultBranch"], { stdout: "pipe", stderr: "pipe" })
  return proc.exitCode === 0 && proc.stdout.toString().trim() ? proc.stdout.toString().trim() : "main"
}

describe("bootstrapRepository (init's git bootstrap, plans/0073)", () => {
  test("a non-git directory: the repository is created on init.defaultBranch (else main), discovered by repoRoots from then on; a second call and an in-repo call are no-ops", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-git-"))
    try {
      expect(await bootstrapRepository(dir)).toEqual({ type: "created", branch: await expectedDefaultBranch() })
      // A real work tree from that moment: the commit-side gates see it.
      expect((await git(dir, "rev-parse", "--is-inside-work-tree")).trim()).toBe("true")
      expect(await repoRoots(dir)).toEqual([dir])
      // Idempotent: inside a work tree the bootstrap is a no-op (in-repo
      // init behavior unchanged), subdirectories included.
      expect(await bootstrapRepository(dir)).toEqual({ type: "existing" })
      await mkdir(join(dir, "sub"), { recursive: true })
      expect(await bootstrapRepository(join(dir, "sub"))).toEqual({ type: "existing" })
      // The unborn HEAD names the branch (no commit needed).
      expect((await git(dir, "symbolic-ref", "--short", "HEAD")).trim()).toBe(await expectedDefaultBranch())
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a failed git init is reported, not swallowed (the caller refuses init on it)", async () => {
    // A path git cannot treat as a repository root: a file where the .git
    // directory would go makes init fail.
    const dir = await mkdtemp(join(tmpdir(), "auto-git-"))
    try {
      await writeFile(join(dir, ".git"), "not a gitfile target\n")
      const result = await bootstrapRepository(dir)
      expect(result.type).toBe("failed")
      if (result.type === "failed") expect(result.error.length).toBeGreaterThan(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("writeLocalIdentity (init's --name/--email, plans/0073 §2.2)", () => {
  test("writes repository-local user.name/user.email — a commit under them succeeds and the probe resolves", async () => {
    const dir = await fresh()
    try {
      expect(await writeLocalIdentity(dir, { name: "Init Person", email: "init@example.com" })).toBeUndefined()
      // Repository-local config (what init's flags promised: never --global).
      expect((await git(dir, "config", "--local", "user.name")).trim()).toBe("Init Person")
      expect((await git(dir, "config", "--local", "user.email")).trim()).toBe("init@example.com")
      // The identity a commit applies resolves from then on.
      expect(await commitIdentityProblem(dir)).toBeUndefined()
      await writeFile(join(dir, "a.txt"), "a")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "first commit under the init identity")
      expect((await git(dir, "log", "-1", "--pretty=%an")).trim()).toBe("Init Person")
      expect((await git(dir, "log", "-1", "--pretty=%ae")).trim()).toBe("init@example.com")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a non-repository directory: git's error is returned, not thrown", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-git-"))
    try {
      const error = await writeLocalIdentity(dir, { name: "n", email: "e" })
      expect(error).toBeTruthy()
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

  test("untracked driver-workdir files (the run lock ahead of the ignore set's arrival) are not the person's dirt; a tracked workdir file still blocks", async () => {
    const dir = await fresh()
    try {
      await mkdir(join(dir, ".auto"), { recursive: true })
      await mkdir(join(dir, "tmp"), { recursive: true })
      await writeFile(join(dir, ".auto/run.lock"), "1\n")
      await writeFile(join(dir, "tmp/lane-1.out"), "x\n")
      const gate = await beginUnit(dir, {}, task)
      expect(gate.type).toBe("ok")
      // A tracked workdir file is the opposite fact: someone put it in git,
      // and the driver's rewrite of it would dirty every later unit.
      await git(dir, "add", ".auto/run.lock")
      await git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "track the workdir")
      await writeFile(join(dir, ".auto/run.lock"), "2\n")
      expect(await beginUnit(dir, {}, task)).toEqual({ type: "dirty", files: [".auto/run.lock"] })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the carryover stages with the workdir excluded: a repository whose ignore set has not arrived yet heals its driver state without absorbing .auto/ into git", async () => {
    const dir = await fresh()
    try {
      await mkdir(join(dir, "docs/R-01/P01-implement"), { recursive: true })
      await mkdir(join(dir, "docs/T-001"), { recursive: true })
      await writeFile(join(dir, "docs/R-01/phases.md"), "- [ ] P01 implement\n")
      await writeFile(join(dir, "docs/R-01/P01-implement/tasks.md"), "- [ ] T-001 sample\n")
      await writeFile(join(dir, "docs/T-001/todo.md"), "# T-001: sample\n")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: seed" })
      await rename(join(dir, "docs/T-001/todo.md"), join(dir, "docs/T-001/done.md"))
      await writeFile(join(dir, "docs/R-01/P01-implement/tasks.md"), "- [x] T-001 sample\n")
      await mkdir(join(dir, ".auto"), { recursive: true })
      await writeFile(join(dir, ".auto/run.lock"), "1\n")
      const gate = await beginUnit(dir, {}, task)
      expect(gate.type).toBe("ok")
      expect(await fileTracked(dir, "docs/T-001/done.md")).toBe(true)
      // The workdir stays out of git — untracked exactly as before the heal,
      // the state the ignore set will keep it in once preflight writes it.
      expect(await git(dir, "ls-files")).not.toContain(".auto")
      expect(await changedFiles(dir)).toEqual([".auto/run.lock"])
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

describe("taskChangedPaths (the release note's re-merge surface, plans/0096 D7; the corpus bound plans/0140)", () => {
  // A person-side plain commit (no Auto-Task trailer) — the formulation
  // commits (the PLAN formulate shape writes the unit document) and the
  // restart's wipe commit of these fixtures.
  async function personCommit(dir: string, message: string) {
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", message)
  }

  async function formulate(dir: string, taskId: string) {
    await mkdir(join(dir, "docs", taskId), { recursive: true })
    await writeFile(join(dir, "docs", taskId, "todo.md"), `# ${taskId}\n`)
    await personCommit(dir, `${taskId} formulated`)
  }

  test("a single corpus: every trailer commit contributes (the bound changes nothing — the floor)", async () => {
    const dir = await fresh()
    try {
      await git(dir, "config", "user.email", "t@example.com")
      await git(dir, "config", "user.name", "t")
      await writeFile(join(dir, "root.txt"), "init\n")
      await personCommit(dir, "init")
      await formulate(dir, "T-001")
      await writeFile(join(dir, "one.txt"), "one\n")
      await commitTree(dir, task, { stage: "execute", subject: "T-001 implement the migration: execute" })
      await writeFile(join(dir, "two.txt"), "two\n")
      await commitTree(dir, task, { stage: "wrapup", subject: "T-001 implement the migration: wrapup" })
      expect(await taskChangedPaths(dir, "T-001")).toEqual(["one.txt", "two.txt"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an id re-issued after a wipe-and-restart: only the current corpus's commits contribute", async () => {
    const dir = await fresh()
    try {
      await git(dir, "config", "user.email", "t@example.com")
      await git(dir, "config", "user.name", "t")
      await writeFile(join(dir, "root.txt"), "init\n")
      await personCommit(dir, "init")
      // The old corpus: formulated, then its task commits touch old.txt.
      await formulate(dir, "T-001")
      await writeFile(join(dir, "old.txt"), "old\n")
      await commitTree(dir, task, { stage: "execute", subject: "T-001 implement the migration: execute" })
      // The restart: the corpus wiped over retained history, the ids re-issued.
      await rm(join(dir, "docs"), { recursive: true, force: true })
      await personCommit(dir, "restart: the corpus wiped")
      // The current corpus: re-formulated, its task commits touch new.txt.
      await formulate(dir, "T-001")
      await writeFile(join(dir, "new.txt"), "new\n")
      await commitTree(dir, task, { stage: "execute", subject: "T-001 implement the migration: execute" })
      expect(await taskChangedPaths(dir, "T-001")).toEqual(["new.txt"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

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

  // §10's Windows hardening (S6): the teardown retries a transient failure
  // (AV / file-lock races) — plain first, then --force per further attempt,
  // a wait between attempts — and its terminal failure names the kept
  // worktree's path (block-with-path, never a silent loss).
  test("removeWorktree retries the schedule: one wait per failed attempt, --force from the second on, the terminal error names the kept path", async () => {
    const { dir } = await laneScene()
    try {
      // A path git holds no worktree record of fails every attempt, plain
      // and forced alike — the always-failing scene.
      const stray = join(dir, ".auto", "worktrees", "T-999")
      const waits: number[] = []
      const removed = await removeWorktree(dir, stray, { attempts: 3, delayMs: 5, sleep: async (ms) => { waits.push(ms) } })
      expect(removed.ok).toBe(false)
      expect(waits).toEqual([5, 5]) // between the three attempts, never before the first
      expect(removed.error).toContain(stray) // block-with-path
      expect(removed.error).toContain("3 attempts")
      expect(removed.error).toContain("git worktree remove --force")
      // The default schedule is the Windows-shape one: more than one attempt,
      // a short sub-second wait.
      expect(WORKTREE_TEARDOWN.attempts).toBeGreaterThanOrEqual(2)
      expect(WORKTREE_TEARDOWN.delayMs).toBeLessThanOrEqual(500)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("removeWorktree succeeds on the second attempt when the first races a lock: the wait runs once and the worktree is gone", async () => {
    const { dir, park } = await laneScene()
    try {
      // A dirty worktree fails the plain pass; the force pass (after one
      // wait) succeeds — the schedule's recovery shape.
      await writeFile(join(park, "uncommitted.txt"), "dirt\n")
      const waits: number[] = []
      const removed = await removeWorktree(dir, park, { attempts: 3, delayMs: 1, sleep: async (ms) => { waits.push(ms) } })
      expect(removed.ok).toBe(true)
      expect(waits).toEqual([1])
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

  test("a modify/delete conflict over an own file never resolves onto the lane's side: the failing resolution step aborts the merge as a real conflict (plans/0155 D4)", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, ".gitignore"), ".auto/\n")
      await writeFile(join(dir, "base.txt"), "base\n")
      await writeFile(join(dir, "tasks.md"), "v1\n")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: baseline" })
      const park = join(dir, ".auto", "worktrees", task.id)
      const branch = `auto-lane/${task.id}`
      const added = await addWorktree(dir, park, branch)
      if (!added.ok) throw new Error(added.error)
      // The lane ticks the parent-owned index; the main tree has deleted it
      // by the landing — a modify/delete conflict on exactly an own file:
      // `checkout --ours` has no ours-version to restore ("path ... does not
      // have our version"), and staging the surviving lane content would
      // conclude the merge with the parent's deletion silently reverted.
      await writeFile(join(park, "tasks.md"), "lane ticked\n")
      await commitTree(park, task, { stage: "subtask 1", subject: "T-001: subtask 1" })
      await rm(join(dir, "tasks.md"))
      await commitTree(dir, task, { stage: "housekeeping", subject: "PLAN housekeeping removed the phase index" })
      const landed = await landBranch(dir, branch, task, ["tasks.md"])
      expect(landed.type).toBe("conflict")
      // The parent's deletion stands and the main tree is clean again; the
      // lane's work survives for the conflict protocol.
      expect(await Bun.file(join(dir, "tasks.md")).exists()).toBe(false)
      expect(await changedFiles(dir)).toEqual([])
      expect(await Bun.file(join(park, "tasks.md")).text()).toBe("lane ticked\n")
      expect((await git(dir, "branch", "--list", branch)).trim()).toContain(branch)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the aborted merge is judged over the merged repository alone: a dirty nested repository elsewhere never misreports the abort (plans/0155)", async () => {
    const { dir, park, branch } = await laneScene()
    try {
      await writeFile(join(park, "base.txt"), "lane side\n")
      await commitTree(park, task, { stage: "subtask 1", subject: "T-001: subtask 1" })
      await writeFile(join(dir, "base.txt"), "main side\n")
      await commitTree(dir, task, { stage: "housekeeping", subject: "PLAN housekeeping sibling move" })
      // A nested repository under the main tree, dirty: not the abort's
      // work, but a whole-tree walk would count it as a failed abort.
      await mkdir(join(dir, "nested"), { recursive: true })
      await git(join(dir, "nested"), "init", "-q")
      await writeFile(join(dir, "nested", "dirty.txt"), "person dirt\n")
      const landed = await landBranch(dir, branch, task)
      expect(landed.type).toBe("conflict")
      expect(await Bun.file(join(dir, "base.txt")).text()).toBe("main side\n")
      expect(await changedFiles(join(dir, "nested"))).toEqual(["dirty.txt"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ---- The git seam's failure direction (plans/0155 D1) ----
//
// The founding P12 class the change closes: a git read that exits nonzero
// over a discovered repository root (a corrupt index stands in for every
// anomaly shape) used to swallow into a clean verdict — a skipped commit, a
// passed gate, an unexamined close-out. The spawn-throw floor (git
// unavailable) keeps the quiet direction; the nonzero exit resolves toward
// dirty/loud at every seam below.

async function corruptIndex(root: string) {
  await Bun.write(join(root, ".git", "index"), "not an index\n")
}

describe("the git seam's failure direction (plans/0155 D1: a nonzero read is never a clean verdict)", () => {
  test("statusEntries surfaces the unreadable read (the ⚠ line) and answers empty; statusEntriesRead is the strict distinguishable read", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "a.txt"), "a\n")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: seed" })
      await corruptIndex(dir)
      const out = await captureRun(async () => {
        expect(await statusEntries(dir, dir)).toEqual([])
        expect(await statusEntriesRead(dir, dir)).toBeUndefined()
        // The toplevel probe's failure (a path that is not a repository)
        // reads undefined the same way.
        expect(await statusEntriesRead(dir, join(dir, "nowhere"))).toBeUndefined()
        return 0
      })
      expect(out.lines.filter((line) => line.includes("git status unreadable"))).toHaveLength(3)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("commitTree refuses over an unreadable status (the skip decision cannot be made): a failure line, nothing committed", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "a.txt"), "a\n")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: seed" })
      await corruptIndex(dir)
      await writeFile(join(dir, "b.txt"), "b\n")
      const settled = await commitTree(dir, task, { stage: "execute", subject: "T-001: exec" })
      expect(settled.ok).toBe(false)
      expect(settled.failures).toHaveLength(1)
      expect(settled.failures[0]).toEqual({ rel: ".", error: "git status unreadable (repo missing or index corrupt); cannot judge what to commit" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("stashTree refuses over an unreadable status: a failure the caller can act on, no stash attempted", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "a.txt"), "a\n")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: seed" })
      await corruptIndex(dir)
      const stashed = await stashTree(dir, "person close")
      expect(stashed.stashes).toEqual([])
      expect(stashed.failures).toHaveLength(1)
      expect(stashed.failures[0]!.rel).toBe(".")
      expect(stashed.failures[0]!.error).toContain("cannot judge what to stash")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("rollbackUnit leaves an unreadable repository untouched with a failure line (the scene cannot be judged, never half-rolled-back)", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "seed.txt"), "s\n")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: pre-baseline commit" })
      const baseline = await unitBaseline(dir)
      await writeFile(join(dir, "done.txt"), "committed mid-flight work\n")
      await commitTree(dir, task, { stage: "subtask 1", subject: "T-001: subtask 1" })
      const before = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      await corruptIndex(dir)
      const result = await rollbackUnit(dir, baseline, { task: "T-001", unit: "subtask 1" })
      expect(result.ok).toBe(false)
      expect(result.stashes).toBe(0)
      expect(result.resets).toEqual([])
      expect(result.failures).toHaveLength(1)
      expect(result.failures[0]!.error).toContain("this repo is not rolled back, please handle manually")
      expect((await git(dir, "rev-parse", "--short", "HEAD")).trim()).toBe(before)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("pendingChanges counts an unreadable root as pending (a caller that skips on pending must not proceed)", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "a.txt"), "a\n")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: seed" })
      expect(await pendingChanges(dir)).toBe(false)
      await corruptIndex(dir)
      expect(await pendingChanges(dir)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("unitViolations: a baseline on record but an unreadable HEAD fails the close-out; the empty-baseline floor stands", async () => {
    const dir = await fresh()
    try {
      const problems = await unitViolations(dir, [{ root: join(dir, "missing"), sha: "abc1234" }])
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain("HEAD unreadable")
      expect(problems[0]).toContain("close-out check failed")
      // An empty baseline sha is the empty-repository floor (no commits when
      // the unit started, still none readable now): never a violation.
      expect(await unitViolations(dir, [{ root: join(dir, "missing"), sha: "" }])).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("beginUnit blocks on an unreadable status: the gate returns dirty naming the root and the anomaly", async () => {
    const dir = await fresh()
    try {
      await writeFile(join(dir, "a.txt"), "a\n")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: seed" })
      await corruptIndex(dir)
      let gate: Awaited<ReturnType<typeof beginUnit>> | undefined
      const out = await captureRun(async () => {
        gate = await beginUnit(dir, {}, task)
        return 0
      })
      expect(gate).toEqual({ type: "dirty", files: [".: git status unreadable (repo missing or index corrupt) — the tree's cleanliness cannot be judged; investigate the repository state"] })
      expect(out.lines.some((line) => line.includes("git status unreadable"))).toBe(true)
      expect(out.lines.some((line) => line.includes("index file"))).toBe(true)
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

// The side-effect guard of driver-run scripts (plans/0083 D11): the pre-run
// `git stash create` snapshot (nothing touched on disk, no stash entry) and
// the post-run read — tracked mutations restored per path, a moved HEAD the
// hard-block case with no auto-undo, byte-identical writes undetectable and
// harmless, untracked files staying, nested repositories covered root by
// root.
describe("scriptGuardSnapshot / scriptGuardCheck (the side-effect guard, plans/0083 D11)", () => {
  async function seeded(): Promise<string> {
    const dir = await fresh()
    await writeLocalIdentity(dir, { name: "auto", email: "auto@example.com" })
    await writeFile(join(dir, "src.ts"), "// baseline\n")
    await mkdir(join(dir, "sub"), { recursive: true })
    await writeFile(join(dir, "sub", "nested.txt"), "nested baseline\n")
    await git(dir, "add", "-A")
    await git(dir, "commit", "-qm", "init")
    return dir
  }

  test("a tracked mutation over a clean pre-run tree is restored from HEAD and reported", async () => {
    const dir = await seeded()
    try {
      const shots = await scriptGuardSnapshot(dir)
      await writeFile(join(dir, "src.ts"), "// mutated by the script\n")
      const violation = await scriptGuardCheck(dir, shots)
      expect(violation).toEqual({ kind: "tracked", restored: ["src.ts"], unrestorable: [] })
      expect(await Bun.file(join(dir, "src.ts")).text()).toBe("// baseline\n")
      expect((await git(dir, "status", "--porcelain")).trim()).toBe("")
      // `git stash create` on the clean tree stored no ref and touched nothing.
      expect((await git(dir, "stash", "list")).trim()).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a deleted tracked file is restored too; untracked files stay (not git-managed content)", async () => {
    const dir = await seeded()
    try {
      const shots = await scriptGuardSnapshot(dir)
      await rm(join(dir, "src.ts"))
      await writeFile(join(dir, "scratch.out"), "script output\n")
      const violation = await scriptGuardCheck(dir, shots)
      expect(violation).toEqual({ kind: "tracked", restored: ["src.ts"], unrestorable: [] })
      expect(await Bun.file(join(dir, "src.ts")).text()).toBe("// baseline\n")
      expect(await Bun.file(join(dir, "scratch.out")).text()).toBe("script output\n")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("session work-in-progress is in the snapshot: the restore puts the pre-run WIP back, and a path the script never touched keeps its WIP untouched", async () => {
    const dir = await seeded()
    try {
      // The session's own tracked WIP: one committed file the session then
      // modified (the script will overwrite it further), one file the script
      // never touches.
      await writeFile(join(dir, "wip-a.ts"), "// committed\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "wip baseline")
      await writeFile(join(dir, "wip-a.ts"), "// session wip\n")
      await writeFile(join(dir, "wip-b.ts"), "// session wip kept\n")
      const shots = await scriptGuardSnapshot(dir)
      expect(shots[0]!.stash).toBeTruthy()
      await writeFile(join(dir, "wip-a.ts"), "// session wip + script edit\n")
      const violation = await scriptGuardCheck(dir, shots)
      expect(violation?.kind).toBe("tracked")
      if (violation?.kind === "tracked") expect(violation.restored).toEqual(["wip-a.ts"])
      expect(await Bun.file(join(dir, "wip-a.ts")).text()).toBe("// session wip\n")
      expect(await Bun.file(join(dir, "wip-b.ts")).text()).toBe("// session wip kept\n")
      // The restore puts the pre-run content back through the index (git
      // checkout semantics), so the session WIP carries staged form — the
      // next unified commit absorbs it either way; the untracked file stays.
      const status = (await git(dir, "status", "--porcelain")).split("\n").filter(Boolean).sort()
      expect(status).toEqual(["?? wip-b.ts", "M  wip-a.ts"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a byte-identical rewrite is undetectable and harmless (no violation)", async () => {
    const dir = await seeded()
    try {
      const shots = await scriptGuardSnapshot(dir)
      // The script rewrites the file with identical bytes.
      await writeFile(join(dir, "src.ts"), "// baseline\n")
      expect(await scriptGuardCheck(dir, shots)).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a mutation inside a nested repository is restored by that repository's own snapshot", async () => {
    const dir = await fresh()
    try {
      await writeLocalIdentity(dir, { name: "auto", email: "auto@example.com" })
      await writeFile(join(dir, "src.ts"), "// baseline\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      // sub/ becomes its own repository, recorded in the outer repository as
      // the nested root it is (the unified commit's own shape).
      await mkdir(join(dir, "sub"), { recursive: true })
      await writeFile(join(dir, "sub", "nested.txt"), "nested baseline\n")
      await git(join(dir, "sub"), "init", "-q")
      await writeLocalIdentity(join(dir, "sub"), { name: "auto", email: "auto@example.com" })
      await git(join(dir, "sub"), "add", "-A")
      await git(join(dir, "sub"), "commit", "-qm", "nested init")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "nested root")
      const shots = await scriptGuardSnapshot(dir)
      expect(shots.length).toBe(2)
      await writeFile(join(dir, "sub", "nested.txt"), "mutated by the script\n")
      const violation = await scriptGuardCheck(dir, shots)
      expect(violation?.kind).toBe("tracked")
      if (violation?.kind === "tracked") expect(violation.restored).toEqual(["sub/nested.txt"])
      expect(await Bun.file(join(dir, "sub", "nested.txt")).text()).toBe("nested baseline\n")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a moved HEAD is the hard-block case: reported, nothing restored, no stash entry left", async () => {
    const dir = await seeded()
    try {
      const shots = await scriptGuardSnapshot(dir)
      // The script ran a commit (the git-state-command family).
      await writeFile(join(dir, "scripted.txt"), "committed by the script\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "scripted by the script")
      const violation = await scriptGuardCheck(dir, shots)
      expect(violation).toMatchObject({ kind: "head" })
      if (violation?.kind === "head") {
        expect(violation.moved[0]!.from).toBe(shots[0]!.head)
        expect(violation.moved[0]!.root).toBe(".")
      }
      // No auto-undo ran: the commit stands for the human.
      expect((await git(dir, "log", "--format=%s")).split("\n")[0]).toBe("scripted by the script")
      expect((await git(dir, "stash", "list")).trim()).toBe("")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// plans/0173 (0165-140/141, 0165-004): the driver witness is the trailer
// block (one grammar for every audit reader), the audit range is checked
// (a failed log or a rewound HEAD never answers zero), and the boundary walk
// passes trailer-less commits (person fixes, landings) instead of stopping
// at them.
describe("driverStage / trailerBlock (plans/0173 D2, 0165-140)", () => {
  test("the trailer paragraph witnesses; prose mentions, quoted bodies and colon-subjects never", () => {
    expect(driverStage("work\n\nAuto-Task: T-001\nAuto-Stage: implement")).toBe("implement")
    expect(driverStage("work\n\nAuto-Stage: carryover")).toBe("carryover")
    // A prose paragraph mentioning the trailer is not a trailer block.
    expect(driverStage("person: tweak\n\nNote: the driver's Auto-Stage: trailer is not on this one.")).toBeUndefined()
    // A quoted message above the block: the last paragraph is the prose.
    expect(driverStage("squash\n\nSquashed commit of the following:\n\nwork\n\nAuto-Stage: implement\n\nperson note")).toBeUndefined()
    // A single-line colon subject parses as a block with another key.
    expect(driverStage("Fix: the thing")).toBeUndefined()
    // A prose line inside the last paragraph voids the block.
    expect(driverStage("work\n\nAuto-Stage: implement\nbut this line is prose")).toBeUndefined()
  })

  test("foreignCommits counts by the block: the prose-mention commit is foreign, the trailer commit is not", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-witness-"))
    try {
      await git(dir, "init", "-q")
      await git(dir, "config", "user.email", "t@example.com")
      await git(dir, "config", "user.name", "t")
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, "a"), "a")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "base")
      const base = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      await writeFile(join(dir, "b"), "b")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "person: tweak\n\nNote: the driver's Auto-Stage: trailer is not on this one.")
      await writeFile(join(dir, "c"), "c")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "driver\n\nAuto-Stage: implement\nAuto-Task: T-001")
      expect(await foreignCommits(dir, base)).toBe(1)
      expect(await foreignCommits(dir, "deadbeef")).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("the audited range (plans/0173 D3, 0165-141)", () => {
  test("a rewound HEAD blocks unitViolations and baselineIntact, never counts the empty range as clean", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-rewind-"))
    try {
      await git(dir, "init", "-q")
      await git(dir, "config", "user.email", "t@example.com")
      await git(dir, "config", "user.name", "t")
      await writeFile(join(dir, "r"), "r")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "root")
      await writeFile(join(dir, "a"), "a")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "base")
      const base = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      await writeFile(join(dir, "b"), "b")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "driver b\n\nAuto-Stage: implement\nAuto-Task: T-001")
      // The session's mid-unit undo: history rewound below the baseline —
      // HEAD sits on the root, which never contained the baseline commit.
      await git(dir, "reset", "--hard", "HEAD~2")
      const head = (await git(dir, "rev-parse", "--short", "HEAD")).trim()
      const baseline = [{ root: dir, sha: base }]
      const line = `.: history rewritten below the unit baseline (HEAD ${head} does not contain ${base})`
      expect(await unitViolations(dir, baseline)).toEqual([line])
      expect(await baselineIntact(dir, baseline)).toEqual([line])
      const rolled = await rollbackUnit(dir, baseline, { task: "T-001", unit: "T-001" })
      expect(rolled.ok).toBe(false)
      expect(rolled.failures[0]!.error).toContain("history rewritten below the unit baseline")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("driverBoundary: the oldest boundary's parent, landings recognized, none → HEAD, the root driver commit → empty baseline", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-boundary-"))
    try {
      await git(dir, "init", "-q")
      await git(dir, "config", "user.email", "t@example.com")
      await git(dir, "config", "user.name", "t")
      // The root IS a driver commit: the whole history is the run's.
      await writeFile(join(dir, "a"), "a")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "driver root\n\nAuto-Stage: implement")
      expect(await driverBoundary(dir)).toEqual({ baseline: "", kind: "driver" })
      // Person commits above the run stay inside: the boundary is still the
      // root, the scan covers them.
      await writeFile(join(dir, "b"), "b")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "person fix on top")
      expect(await driverBoundary(dir)).toEqual({ baseline: "", kind: "driver" })
      // A repository whose committed history is the person's alone.
      const dir2 = await mkdtemp(join(tmpdir(), "auto-boundary2-"))
      try {
        await git(dir2, "init", "-q")
        await git(dir2, "config", "user.email", "t@example.com")
        await git(dir2, "config", "user.name", "t")
        await writeFile(join(dir2, "a"), "a")
        await git(dir2, "add", "-A")
        await git(dir2, "commit", "-qm", "person history")
        const head = (await git(dir2, "rev-parse", "HEAD")).trim()
        expect(await driverBoundary(dir2)).toEqual({ baseline: head, kind: "none" })
        // A landing subject is a boundary: the squashed round is the
        // migration's content.
        await writeFile(join(dir2, "b"), "b")
        await git(dir2, "add", "-A")
        const seed = (await git(dir2, "rev-parse", "HEAD")).trim()
        await git(dir2, "commit", "-qm", "land auto/R-01: 3 commit(s) of round 1")
        expect(await driverBoundary(dir2)).toEqual({ baseline: seed, kind: "landing" })
      } finally {
        await rm(dir2, { recursive: true, force: true })
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// plans/0174 (0165-035/036/110/138/204): the target-inside-a-larger-
// repository layout gets its first test home, the work-tree probe reads
// three states (a refused read never idles the commit boundary), a receipt
// that names fewer roots than the tree vouches for nothing, and the
// straggler verdict sites resolve toward loud.
describe("the subdirectory target (plans/0174 — the target inside a larger repository)", () => {
  // A repository whose target directory is the subdirectory pkg/: the
  // person's files live outside the target subtree too.
  async function subdirTarget(): Promise<{ repo: string; pkg: string }> {
    const repo = await mkdtemp(join(tmpdir(), "auto-subdir-"))
    await git(repo, "init", "-q")
    await writeLocalIdentity(repo, { name: "auto", email: "auto@example.com" })
    await mkdir(join(repo, "pkg", "src"), { recursive: true })
    await mkdir(join(repo, "other"), { recursive: true })
    await writeFile(join(repo, "pkg", "src", "a.ts"), "// baseline\n")
    await writeFile(join(repo, "other", "keep.txt"), "person\n")
    await git(repo, "add", "-A")
    await git(repo, "commit", "-qm", "init")
    return { repo, pkg: join(repo, "pkg") }
  }

  test("commitTree confines the commit to the target subtree: the person's staged work outside stays staged", async () => {
    const { repo, pkg } = await subdirTarget()
    try {
      // The session writes inside the target; the person stages their own
      // work outside it — a bare `git commit` takes the whole index and the
      // person's staging would ride the driver's trailer.
      await writeFile(join(pkg, "src", "a.ts"), "// session work\n")
      await writeFile(join(repo, "other", "keep.txt"), "person wip\n")
      await git(repo, "add", "other/keep.txt")
      const result = await commitTree(pkg, task, { stage: "implement", subject: "T-001 implement the migration" })
      expect(result.ok).toBe(true)
      expect((await git(repo, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD")).trim()).toBe("pkg/src/a.ts")
      // The person's staged file is untouched: still staged, never committed.
      expect((await git(repo, "status", "--porcelain")).trim()).toBe("M  other/keep.txt")
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  test("stashTree stashes only the target subtree: the person's WIP outside stays in their tree", async () => {
    const { repo, pkg } = await subdirTarget()
    try {
      await writeFile(join(pkg, "src", "a.ts"), "// session wip\n")
      await writeFile(join(repo, "other", "keep.txt"), "person wip\n")
      const result = await stashTree(pkg, "close stash")
      expect(result.failures).toEqual([])
      expect(result.stashes.length).toBe(1)
      expect(await Bun.file(join(pkg, "src", "a.ts")).text()).toBe("// baseline\n")
      expect(await Bun.file(join(repo, "other", "keep.txt")).text()).toBe("person wip\n")
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  test("the script guard works under the layout: a tracked mutation is caught and restored (the toplevel anchoring, 0165-035)", async () => {
    const { repo, pkg } = await subdirTarget()
    try {
      const shots = await scriptGuardSnapshot(pkg)
      expect(shots.length).toBe(1)
      // The 'script' rewrites a tracked file inside the target; porcelain
      // paths are toplevel-relative, so cwd-relative pathspecs would match
      // nothing and the guard would read clean over the mutation.
      await writeFile(join(pkg, "src", "a.ts"), "// SCRIPT MUTATION\n")
      const violation = await scriptGuardCheck(pkg, shots)
      expect(violation).toEqual({ kind: "tracked", restored: ["src/a.ts"], unrestorable: [] })
      expect(await Bun.file(join(pkg, "src", "a.ts")).text()).toBe("// baseline\n")
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  test("beginUnit and the close-out certify the layout: the baseline covers the enclosing repository, the person's WIP outside is not the unit's dirt", async () => {
    const { repo, pkg } = await subdirTarget()
    try {
      const gate = await beginUnit(pkg, {}, task)
      expect(gate.type).toBe("ok")
      if (gate.type !== "ok") return
      expect(gate.baseline?.length).toBe(1)
      await writeFile(join(pkg, "src", "a.ts"), "// session work\n")
      const committed = await commitTree(pkg, task, { stage: "implement", subject: "T-001 implement the migration" })
      expect(committed.ok).toBe(true)
      // The person edits outside the subtree after the session: the unit's
      // close-out stays clean (the pathspec `.` keeps the scope inside it).
      await writeFile(join(repo, "other", "keep.txt"), "person wip\n")
      expect(await unitViolations(pkg, gate.baseline!)).toEqual([])
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })
})

describe("the work-tree probe (plans/0174 D1, 0165-036 — a refused read never idles the commit boundary)", () => {
  test("a refused work tree (dubious ownership) blocks the gates: no roots, beginUnit dirty, commitTree failed, bootstrap refused", async () => {
    const repo = await mkdtemp(join(tmpdir(), "auto-owned-"))
    const pkg = join(repo, "pkg")
    const hadKey = "GIT_TEST_ASSUME_DIFFERENT_OWNER" in process.env
    const was = process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER
    try {
      await git(repo, "init", "-q")
      await writeLocalIdentity(repo, { name: "auto", email: "auto@example.com" })
      await mkdir(pkg, { recursive: true })
      await writeFile(join(pkg, "a.ts"), "// baseline\n")
      await git(repo, "add", "-A")
      await git(repo, "commit", "-qm", "init")
      // git 2.43's knob for the ownership check: the same refusal a
      // different-uid checkout (a container mount, CI) produces.
      process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = "1"
      // The three states: inside is false with a problem carried — the old
      // boolean read this as "not a repository" and the whole boundary
      // idled in silence (roots [], gates ok, nothing committed).
      const read = await workTree(pkg)
      expect(read.inside).toBe(false)
      expect(read.problem).toContain("dubious ownership")
      expect(await repoRoots(pkg)).toEqual([])
      const gate = await beginUnit(pkg, {}, task)
      expect(gate.type).toBe("dirty")
      const committed = await commitTree(pkg, task, { stage: "implement", subject: "T-001 implement the migration" })
      expect(committed.ok).toBe(false)
      expect(committed.failures[0]!.error).toContain("refuses the work tree")
      const boot = await bootstrapRepository(pkg)
      expect(boot.type).toBe("failed")
    } finally {
      if (hadKey) process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = was
      else delete process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER
      await rm(repo, { recursive: true, force: true })
    }
  })

  test("the plain non-git directory keeps the floor: no roots, no problem, init bootstraps", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-nongit-"))
    try {
      expect(await workTree(dir)).toEqual({ inside: false })
      expect(await repoRoots(dir)).toEqual([])
      const boot = await bootstrapRepository(dir)
      expect(boot.type).toBe("created")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("rangeChangedFiles grown roots (plans/0174 D4, 0165-110 — a receipt covers the tree it recorded)", () => {
  test("a nested repository that appeared after the green receipt: no carry; the identical tree diffs on", async () => {
    const dir = await fresh()
    try {
      await writeLocalIdentity(dir, { name: "auto", email: "auto@example.com" })
      await writeFile(join(dir, "a.txt"), "a\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      const heads = [{ root: ".", sha: (await git(dir, "rev-parse", "--short", "HEAD")).trim() }]
      expect(await rangeChangedFiles(dir, heads)).toEqual([])
      // A task vendors a dependency: a repository root the receipt never
      // recorded — its changes are invisible to the recorded-HEADs diff, so
      // the receipt vouches for less than the tree and carry is off.
      await mkdir(join(dir, "vendor"), { recursive: true })
      await git(join(dir, "vendor"), "init", "-q")
      await writeLocalIdentity(join(dir, "vendor"), { name: "auto", email: "auto@example.com" })
      await writeFile(join(dir, "vendor", "v.txt"), "v\n")
      await git(join(dir, "vendor"), "add", "-A")
      await git(join(dir, "vendor"), "commit", "-qm", "vendored")
      expect(await rangeChangedFiles(dir, heads)).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("the straggler verdict sites (plans/0174 D5, 0165-204)", () => {
  test("nestedHeads: an empty nested repository is absent from the alignment record (no empty-sha Auto-Nested line)", async () => {
    const dir = await fresh()
    try {
      await mkdir(join(dir, "pkg"))
      await git(join(dir, "pkg"), "init", "-q")
      await writeFile(join(dir, "pkg", "inner.txt"), "i")
      await writeFile(join(dir, "root.txt"), "r")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: inner repository init" })
      // An empty nested repository joins the tree after the first round; the
      // root's next commit is scoped away from it (an unscoped add over an
      // unborn repository fatals — the shape is only reachable scoped).
      await mkdir(join(dir, "empty"))
      await git(join(dir, "empty"), "init", "-q")
      await writeFile(join(dir, "root.txt"), "r2")
      const committed = await commitTree(dir, task, { stage: "wrapup", subject: "T-001: wrap-up" }, ["root.txt"])
      expect(committed.ok).toBe(true)
      const pkgHead = (await git(join(dir, "pkg"), "rev-parse", "--short", "HEAD")).trim()
      const body = await git(dir, "log", "-1", "--pretty=%B")
      expect(body).toMatch(new RegExp(`Auto-Nested: pkg @ ${pkgHead}`))
      expect(body).not.toMatch(/Auto-Nested: empty @/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("rollbackUnit over an unreadable HEAD with a recorded baseline fails the repository (never a silent ok)", async () => {
    const dir = await fresh()
    try {
      await writeLocalIdentity(dir, { name: "auto", email: "auto@example.com" })
      await writeFile(join(dir, "a.txt"), "a\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      const baseline = await unitBaseline(dir)
      // The unreadable-HEAD shape: the branch ref deleted (HEAD unborn) and
      // the worktree left clean — `rev-parse --short HEAD` fails while
      // `git status` succeeds, the exact combination the old silent path
      // stashed or skipped with no line and reported ok.
      const branch = (await git(dir, "symbolic-ref", "--short", "HEAD")).trim()
      await git(dir, "update-ref", "-d", `refs/heads/${branch}`)
      await rm(join(dir, ".git", "index"), { force: true })
      await rm(join(dir, "a.txt"))
      const rolled = await rollbackUnit(dir, baseline, { task: "T-001", unit: "T-001" })
      expect(rolled.ok).toBe(false)
      expect(rolled.failures[0]!.error).toContain("HEAD unreadable")
      expect(rolled.stashes).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("taskChangedPaths: the nested corpus bounded by the alignment record — an old-lineage nested commit excluded after a restart", async () => {
    const dir = await fresh()
    const vendor = join(dir, "vendor")
    const plan = { id: "PLAN", title: "formulation" }
    try {
      await writeLocalIdentity(dir, { name: "auto", email: "auto@example.com" })
      await writeFile(join(dir, "root.txt"), "root\n")
      await mkdir(vendor, { recursive: true })
      await git(vendor, "init", "-q")
      await writeLocalIdentity(vendor, { name: "auto", email: "auto@example.com" })
      await writeFile(join(vendor, "v.txt"), "v\n")
      await git(vendor, "add", "-A")
      await git(vendor, "commit", "-qm", "vendor init")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "root")
      // The OLD corpus: a driver formulation commit (its Auto-Nested record
      // aligns the tree), then the old lineage's task commit inside vendor.
      await mkdir(join(dir, "docs", "T-001"), { recursive: true })
      await writeFile(join(dir, "docs", "T-001", "todo.md"), "# T-001\n")
      await commitTree(dir, plan, { stage: "formulate", subject: "PLAN formulate T-001" })
      await writeFile(join(vendor, "old.txt"), "old\n")
      await commitTree(vendor, task, { stage: "implement", subject: "T-001 old lineage" })
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "old lineage landed")
      // The restart: the corpus wiped over retained history (the deletion
      // committed — the re-created document is a true add), the id re-issued.
      await rm(join(dir, "docs"), { recursive: true, force: true })
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "restart: the corpus wiped")
      // The CURRENT corpus: formulated again (a fresh alignment record),
      // its task commit inside vendor.
      await mkdir(join(dir, "docs", "T-001"), { recursive: true })
      await writeFile(join(dir, "docs", "T-001", "todo.md"), "# T-001 again\n")
      await commitTree(dir, plan, { stage: "formulate", subject: "PLAN formulate T-001 again" })
      await writeFile(join(vendor, "new.txt"), "new\n")
      await commitTree(vendor, task, { stage: "implement", subject: "T-001 new lineage" })
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "new lineage landed")
      // The nested lineage's old commit falls outside the corpus the
      // boundary's alignment record bounds; the new one is the surface.
      expect(await taskChangedPaths(dir, "T-001")).toEqual(["vendor/new.txt"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("taskChangedPaths: a person-committed boundary (no alignment record) keeps the whole-log floor for the nested repository", async () => {
    const dir = await fresh()
    const vendor = join(dir, "vendor")
    try {
      await writeLocalIdentity(dir, { name: "auto", email: "auto@example.com" })
      await writeFile(join(dir, "root.txt"), "root\n")
      await mkdir(vendor, { recursive: true })
      await git(vendor, "init", "-q")
      await writeLocalIdentity(vendor, { name: "auto", email: "auto@example.com" })
      await writeFile(join(vendor, "v.txt"), "v\n")
      await git(vendor, "add", "-A")
      await git(vendor, "commit", "-qm", "vendor init")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "root")
      // The formulation is a person commit (adopted work): no Auto-Nested
      // record at the boundary, so the nested corpus cannot be bounded and
      // the whole-log scan stands — the byte-identical floor.
      await mkdir(join(dir, "docs", "T-001"), { recursive: true })
      await writeFile(join(dir, "docs", "T-001", "todo.md"), "# T-001\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "T-001 formulated")
      await writeFile(join(vendor, "one.txt"), "one\n")
      await commitTree(vendor, task, { stage: "implement", subject: "T-001 implement the migration" })
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "landed")
      expect(await taskChangedPaths(dir, "T-001")).toEqual(["vendor/one.txt"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
