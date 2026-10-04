// Branch isolation (plans/0074 §2, U-L1: the `isolate` config key and the
// round-establishment isolation): the config surface's validation (the target
// root never a member, nonexistent paths rejected), the git primitive
// (isolateRound: clean designated repositories onto auto/R-NN, dirty ones
// listed for the human with no branch touched), the establish route's wiring
// (a dirty repository blocks exit 2 naming the repo and the paths before any
// write; a clean one is switched before the round's state is written), and
// the standing acceptance — the existing commit / baseline / close-out /
// rollback machinery runs unchanged against an isolated branch, with the
// original branch never moving.
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { formatProjectConfig, isolateProblem, loadProjectConfig, saveProjectConfig, CONFIG_DEFAULTS } from "../src/config"
import { commitTree, isolateRound, rollbackUnit, unitBaseline, unitViolations } from "../src/git"
import { planPrelude } from "../src/plan"

function withDir(fn: (dir: string) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-isolate-"))
    try {
      await fn(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

async function git(dir: string, ...args: string[]) {
  const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`git ${args.join(" ")} exited ${code}: ${err}`)
  return out
}

// A nested repository under the target directory: initialized, with identity
// and one commit, on whatever branch git's defaults give (read back by
// branchOf — the tests never hardcode a branch name).
async function nestedRepo(dir: string, rel = "pkg"): Promise<string> {
  const root = join(dir, rel)
  mkdirSync(root, { recursive: true })
  await git(root, "init", "-q")
  await git(root, "config", "user.email", "t@example.com")
  await git(root, "config", "user.name", "t")
  writeFileSync(join(root, "readme.txt"), "nested\n")
  await git(root, "add", "-A")
  await git(root, "commit", "-qm", "nested setup")
  return root
}

const branchOf = async (root: string) => (await git(root, "rev-parse", "--abbrev-ref", "HEAD")).trim()

const shaOf = async (root: string, ref: string) => (await git(root, "rev-parse", "--short", ref)).trim()

const exists = (dir: string, path: string) => Bun.file(join(dir, path)).exists()

function writeConfig(dir: string, value: unknown) {
  mkdirSync(join(dir, ".opencode", "auto"), { recursive: true })
  writeFileSync(join(dir, ".opencode", "auto", "config.json"), JSON.stringify({ isolate: value }))
}

describe("config key isolate (plans/0074 §5.4)", () => {
  test(
    "absent and [] load as undefined; a nested repository's path round-trips through a save",
    withDir(async (dir) => {
      await nestedRepo(dir, "pkg")
      expect((await loadProjectConfig(dir)).isolate).toBeUndefined()
      writeConfig(dir, [])
      expect((await loadProjectConfig(dir)).isolate).toBeUndefined()
      writeConfig(dir, ["pkg"])
      const config = await loadProjectConfig(dir)
      expect(config.isolate).toEqual(["pkg"])
      await saveProjectConfig(dir, config)
      expect((await loadProjectConfig(dir)).isolate).toEqual(["pkg"])
    }),
  )

  test(
    "rejects the target root, a nonexistent path, a non-repository, a duplicate and bad shapes, naming the path",
    withDir(async (dir) => {
      await nestedRepo(dir, "pkg")
      writeFileSync(join(dir, "plain.txt"), "a file\n")
      mkdirSync(join(dir, "just-a-dir"))
      for (const [value, match] of [
        [".", /is the target root itself/],
        ["./", /is the target root itself/],
        ["missing", /does not exist under/],
        ["plain.txt", /is not a directory/],
        ["just-a-dir", /holds no \.git/],
        ["/abs/pkg", /is absolute/],
        ["../pkg", /climbs out of the target directory/],
        ["" , /an empty path/],
        ["pkg", /lists a path twice/],
      ] as [string, RegExp][]) {
        writeConfig(dir, value === "pkg" ? ["pkg", "pkg"] : [value])
        await expect(loadProjectConfig(dir), value).rejects.toThrow(match)
        await expect(loadProjectConfig(dir), value).rejects.toThrow(/isolate/)
      }
      for (const value of ["pkg", 42, { a: "b" }, [1], [true]]) {
        writeConfig(dir, value)
        await expect(loadProjectConfig(dir)).rejects.toThrow("isolate must be an array of nested-repository paths")
      }
    }),
  )

  test(
    "isolateProblem names what makes a path unusable; the summary line lists the repositories only when set",
    withDir(async (dir) => {
      await nestedRepo(dir, "pkg/sub")
      // The shape rules answer before the filesystem probes; the fine paths
      // then need the fixture's real nested repository.
      expect(isolateProblem(dir, "pkg/sub")).toBeUndefined()
      expect(isolateProblem(dir, "pkg/sub/")).toBeUndefined()
      expect(isolateProblem(dir, "")).toBe("an empty path")
      expect(isolateProblem(dir, " pkg/sub")).toContain("surrounding whitespace")
      expect(isolateProblem(dir, "C:\\work\\pkg")).toContain("is absolute")
      expect(isolateProblem(dir, "a/../pkg")).toContain("climbs out")
      expect(formatProjectConfig(CONFIG_DEFAULTS)).not.toContain("isolate")
      expect(formatProjectConfig({ ...CONFIG_DEFAULTS, isolate: ["pkg", "tools/cli"] })).toEndWith(" · isolate pkg,tools/cli")
    }),
  )
})

describe("isolateRound (plans/0074 §2.2: the round branch primitive)", () => {
  test(
    "a clean repository: auto/R-NN created from HEAD and checked out; the original branch never moves; re-runs are idempotent",
    withDir(async (dir) => {
      const pkg = await nestedRepo(dir)
      const original = await branchOf(pkg)
      const setup = await shaOf(pkg, "HEAD")
      const first = await isolateRound(dir, ["pkg"], "auto/R-01")
      expect(first).toEqual({ type: "ok", isolated: ["pkg"] })
      expect(await branchOf(pkg)).toBe("auto/R-01")
      expect(await shaOf(pkg, "HEAD")).toBe(setup)
      expect(await shaOf(pkg, original)).toBe(setup)
      // Idempotent: the same round's re-run counts the repository as isolated
      // without touching git.
      const again = await isolateRound(dir, ["pkg"], "auto/R-01")
      expect(again).toEqual({ type: "ok", isolated: ["pkg"] })
      expect(await shaOf(pkg, "HEAD")).toBe(setup)
      expect((await git(pkg, "branch", "--list", "auto/R-*")).trim()).toBe("* auto/R-01")
    }),
  )

  test(
    "a branch left by an interrupted attempt is checked out as it is, keeping its commits; the next round branches from the current HEAD",
    withDir(async (dir) => {
      const pkg = await nestedRepo(dir)
      const original = await branchOf(pkg)
      const setup = await shaOf(pkg, original)
      // Interrupted attempt: the branch was created and moved on (a session
      // commit landed on it), then the repository was switched back.
      await git(pkg, "checkout", "-q", "-b", "auto/R-01")
      writeFileSync(join(pkg, "work.txt"), "wip\n")
      await git(pkg, "add", "-A")
      await git(pkg, "commit", "-qm", "round work")
      const moved = await shaOf(pkg, "HEAD")
      await git(pkg, "checkout", "-q", original)
      const resumed = await isolateRound(dir, ["pkg"], "auto/R-01")
      expect(resumed).toEqual({ type: "ok", isolated: ["pkg"] })
      expect(await branchOf(pkg)).toBe("auto/R-01")
      expect(await shaOf(pkg, "HEAD")).toBe(moved)
      expect(await shaOf(pkg, original)).toBe(setup)
      // The next round isolates from wherever the repository is now: R-02
      // branches off R-01's tip, the trail stays recoverable.
      const next = await isolateRound(dir, ["pkg"], "auto/R-02")
      expect(next).toEqual({ type: "ok", isolated: ["pkg"] })
      expect(await branchOf(pkg)).toBe("auto/R-02")
      expect(await shaOf(pkg, "HEAD")).toBe(moved)
      expect(await shaOf(pkg, "auto/R-01")).toBe(moved)
    }),
  )

  test(
    "a dirty repository is reported with its paths and no branch is touched — in any designated repository",
    withDir(async (dir) => {
      const pkg = await nestedRepo(dir, "pkg")
      const other = await nestedRepo(dir, "tools/cli")
      writeFileSync(join(pkg, "dirty.txt"), "uncommitted\n")
      mkdirSync(join(other, "src"), { recursive: true })
      writeFileSync(join(other, "src", "new.txt"), "untracked\n")
      const blocked = await isolateRound(dir, ["pkg", "tools/cli"], "auto/R-01")
      expect(blocked).toEqual({
        type: "dirty",
        repos: [
          { rel: "pkg", files: ["pkg/dirty.txt"] },
          { rel: "tools/cli", files: ["tools/cli/src/new.txt"] },
        ],
      })
      for (const root of [pkg, other]) expect((await git(root, "branch", "--list", "auto/*")).trim()).toBe("")
    }),
  )
})

describe("planPrelude: isolation at round establishment (plans/0074 §2.2, U-L1)", () => {
  test(
    "a clean designated repository is isolated on auto/R-01 while the round is established",
    withDir(async (dir) => {
      const pkg = await nestedRepo(dir)
      const original = await branchOf(pkg)
      const setup = await shaOf(pkg, original)
      const result = await planPrelude(dir, { phases: "m", isolate: ["pkg"] })
      expect(result.type === "stop" && result.code).toBe(0)
      expect(result.type === "stop" && result.lines).toContain(
        "✓ branch isolation: pkg on auto/R-01 (the driver's commits land there; the original branch stays untouched)",
      )
      expect(await exists(dir, "docs/R-01/phases.md")).toBe(true)
      expect(await branchOf(pkg)).toBe("auto/R-01")
      expect(await shaOf(pkg, original)).toBe(setup)
    }),
  )

  test(
    "a dirty designated repository blocks exit 2 naming the repository and the paths, before any round write",
    withDir(async (dir) => {
      const pkg = await nestedRepo(dir)
      const original = await branchOf(pkg)
      const setup = await shaOf(pkg, original)
      writeFileSync(join(pkg, "wip.txt"), "uncommitted\n")
      const blocked = await planPrelude(dir, { phases: "am", isolate: ["pkg"] })
      expect(blocked).toEqual({
        type: "stop",
        code: 2,
        lines: [
          "⏸ round R-01 cannot open yet: a repository designated by config isolate is not clean, and branch isolation requires clean repositories; handle it manually (commit/clean) and re-run:",
          "  pkg:",
          "    pkg/wip.txt",
        ],
      })
      expect(await exists(dir, "docs/R-01")).toBe(false)
      expect(await branchOf(pkg)).toBe(original)
      expect((await git(pkg, "branch", "--list", "auto/*")).trim()).toBe("")
      expect(await shaOf(pkg, original)).toBe(setup)
      // Once the human settled the worktree, the same call establishes and isolates.
      writeFileSync(join(pkg, "wip.txt"), "settled\n")
      await git(pkg, "add", "-A")
      await git(pkg, "commit", "-qm", "settle")
      const opened = await planPrelude(dir, { phases: "am", isolate: ["pkg"] })
      expect(opened.type === "stop" && opened.code).toBe(0)
      expect(await branchOf(pkg)).toBe("auto/R-01")
    }),
  )

  test(
    "no isolate key: the establish route is unchanged (no branch operations, the plain G1 lines)",
    withDir(async (dir) => {
      await nestedRepo(dir)
      const result = await planPrelude(dir, { phases: "m" })
      expect(result.type === "stop" && result.code).toBe(0)
      expect(result.type === "stop" && result.lines.some((line) => line.includes("isolation"))).toBe(false)
      expect((await git(join(dir, "pkg"), "branch", "--list", "auto/*")).trim()).toBe("")
    }),
  )
})

describe("the commit boundary unchanged on an isolated branch (plans/0074 §2.2: zero changes to git.ts's commit/rollback paths)", () => {
  const task = { id: "T-001", title: "implement the migration" }

  test(
    "unified commit, baseline, close-out check and rollback land on auto/R-01; the original branch never moves",
    withDir(async (dir) => {
      const pkg = await nestedRepo(dir)
      const original = await branchOf(pkg)
      const setup = await shaOf(pkg, original)
      expect(await isolateRound(dir, ["pkg"], "auto/R-01")).toEqual({ type: "ok", isolated: ["pkg"] })
      // A unit's begin (clean → baseline) and the driver's per-session commit:
      // both run against the repository as it is — the isolated branch.
      const baseline = await unitBaseline(dir)
      const pkgBaseline = baseline.find((line) => line.root === pkg)!.sha
      writeFileSync(join(pkg, "src.txt"), "change\n")
      const committed = await commitTree(dir, task, { stage: "execute", subject: "T-001 implement the migration: execute" })
      expect(committed.ok).toBe(true)
      expect(await branchOf(pkg)).toBe("auto/R-01")
      expect(await shaOf(pkg, "HEAD")).not.toBe(pkgBaseline)
      expect(await shaOf(pkg, original)).toBe(setup)
      expect(await unitViolations(dir, baseline)).toEqual([])
      // Rollback reclaims the driver's commit inside the branch, the original
      // branch untouched by all of it.
      const rolled = await rollbackUnit(dir, baseline, { task: task.id, unit: "S01" })
      expect(rolled.ok).toBe(true)
      expect(rolled.resets).toEqual(["pkg"])
      expect(await branchOf(pkg)).toBe("auto/R-01")
      expect(await shaOf(pkg, "HEAD")).toBe(pkgBaseline)
      expect(await shaOf(pkg, original)).toBe(setup)
    }),
  )
})
