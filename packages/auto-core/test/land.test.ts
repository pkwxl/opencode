// Branch-isolation landing (plans/0074 §2.3, U-L2: the `land` command): the
// command core landUnit — the happy path (exactly one commit on the original
// branch, the original otherwise intact, auto/R-NN deleted, the landed SHA
// printed), the refusal paths (a moved original branch, foreign commits
// mixed into the round branch's range, a dirty repository, an ambiguous or
// missing original branch — each exit-2 blocked naming the reason, with
// nothing landed anywhere in a mixed set), the modes (--keep's mid-round
// landing and its re-landing, --merge's merge commit, --abandon's discard),
// and preflight's leftover report (leftoverIsolationLines). The driver's
// round commits are made by the real commitTree, so the branch carries the
// Auto-Stage trailers the foreign-commit check reads.
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { commitTree, isolateRound } from "../src/git"
import { landUnit, leftoverIsolationLines } from "../src/land"

function withDir(fn: (dir: string) => Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-land-"))
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

const fullShaOf = async (root: string, ref: string) => (await git(root, "rev-parse", ref)).trim()

const treeOf = async (root: string, ref: string) => (await git(root, "rev-parse", `${ref}^{tree}`)).trim()

const hasBranch = async (root: string, branch: string) => (await git(root, "branch", "--list", branch)).trim() !== ""

const commitCount = async (root: string, ref: string) => Number((await git(root, "rev-list", "--count", ref)).trim())

// The driver's per-session commit on whatever branch the repository holds
// (the round branch, in these fixtures) — the real commitTree, so the commit
// carries the Auto-Stage trailer the landing's foreign-commit check reads.
async function driverCommit(dir: string, root: string, file: string, content: string, n: number) {
  writeFileSync(join(root, file), content)
  const settled = await commitTree(dir, { id: "T-001", title: "implement the migration" }, { stage: "execute", subject: `T-001 implement the migration: execute ${n}` })
  expect(settled.ok).toBe(true)
}

describe("landUnit (plans/0074 §2.3, U-L2: the landing command core)", () => {
  test(
    "the happy path: exactly one commit on the original branch, the original otherwise intact, auto/R-NN deleted, the SHA printed",
    withDir(async (dir) => {
      const pkg = await nestedRepo(dir)
      const original = await branchOf(pkg)
      const setup = await fullShaOf(pkg, original)
      expect(await isolateRound(dir, ["pkg"], "auto/R-01")).toEqual({ type: "ok", isolated: ["pkg"] })
      await driverCommit(dir, pkg, "one.txt", "one\n", 1)
      await driverCommit(dir, pkg, "two.txt", "two\n", 2)
      await driverCommit(dir, pkg, "three.txt", "three\n", 3)
      const tip = await fullShaOf(pkg, "auto/R-01")
      const landed = await landUnit(dir, { isolate: ["pkg"] })
      expect(landed.type).toBe("landed")
      const sha = await shaOf(pkg, "HEAD")
      expect(landed.lines).toContain(`✓ pkg: landed ${sha} on ${original} (3 commit(s) of auto/R-01 as one); auto/R-01 deleted`)
      // One commit landed: the original grew by exactly one, its previous
      // history untouched beneath, and the landing's tree is the round
      // branch's tip tree (the net change of the round).
      expect(await commitCount(pkg, original)).toBe(2)
      expect(await fullShaOf(pkg, "HEAD~1")).toBe(setup)
      expect(await treeOf(pkg, "HEAD")).toBe(await treeOf(pkg, tip))
      expect(await branchOf(pkg)).toBe(original)
      expect(await hasBranch(pkg, "auto/R-01")).toBe(false)
      // Re-running is the no-op: the branch is gone, nothing left to land.
      const again = await landUnit(dir, { isolate: ["pkg"] })
      expect(again.type).toBe("landed")
      expect(again.lines).toEqual(["ℹ nothing to land: no designated repository holds auto/R-01 (already landed, or this round never isolated one)"])
      expect(await commitCount(pkg, original)).toBe(2)
    }),
  )

  test(
    "--keep lands mid-round: the branch is retained and checked out (the round simply continues); a later land folds only the new commits",
    withDir(async (dir) => {
      const pkg = await nestedRepo(dir)
      const original = await branchOf(pkg)
      expect(await isolateRound(dir, ["pkg"], "auto/R-01")).toEqual({ type: "ok", isolated: ["pkg"] })
      await driverCommit(dir, pkg, "one.txt", "one\n", 1)
      const mid = await landUnit(dir, { isolate: ["pkg"], keep: true })
      expect(mid.type).toBe("landed")
      expect(mid.lines[0]).toMatch(/^✓ pkg: landed [0-9a-f]+ on \S+ \(1 commit\(s\) of auto\/R-01 as one\); auto\/R-01 retained and checked out — the round simply continues on it$/)
      // The mid-round state: one commit on the original, the round branch
      // still there and still the checked-out one.
      expect(await commitCount(pkg, original)).toBe(2)
      expect(await branchOf(pkg)).toBe("auto/R-01")
      expect(await hasBranch(pkg, "auto/R-01")).toBe(true)
      // The round continues on the branch; the final land recognizes the
      // previous landing (the original sits at its tree) and folds only the
      // new commits.
      await driverCommit(dir, pkg, "two.txt", "two\n", 2)
      const finalTip = await fullShaOf(pkg, "auto/R-01")
      const final = await landUnit(dir, { isolate: ["pkg"] })
      expect(final.type).toBe("landed")
      expect(final.lines[0]).toMatch(/^✓ pkg: landed [0-9a-f]+ on \S+ \(1 commit\(s\) of auto\/R-01 as one\); auto\/R-01 deleted$/)
      expect(await commitCount(pkg, original)).toBe(3)
      expect(await treeOf(pkg, "HEAD")).toBe(await treeOf(pkg, finalTip))
      expect(await branchOf(pkg)).toBe(original)
      expect(await hasBranch(pkg, "auto/R-01")).toBe(false)
      // Both commits' content reached the original branch.
      expect(await Bun.file(join(pkg, "one.txt")).text()).toBe("one\n")
      expect(await Bun.file(join(pkg, "two.txt")).text()).toBe("two\n")
    }),
  )

  test(
    "--merge lands a true merge commit (the round's commits enter the original branch's history as themselves)",
    withDir(async (dir) => {
      const pkg = await nestedRepo(dir)
      const original = await branchOf(pkg)
      const setup = await fullShaOf(pkg, original)
      expect(await isolateRound(dir, ["pkg"], "auto/R-01")).toEqual({ type: "ok", isolated: ["pkg"] })
      await driverCommit(dir, pkg, "one.txt", "one\n", 1)
      const tip = await fullShaOf(pkg, "auto/R-01")
      const landed = await landUnit(dir, { isolate: ["pkg"], merge: true })
      expect(landed.type).toBe("landed")
      expect(landed.lines[0]).toMatch(/1 commit\(s\) of auto\/R-01 as one \(merge commit\)\); auto\/R-01 deleted$/)
      // A merge commit: the first parent keeps the original's history, the
      // second is the round branch's tip.
      expect(await fullShaOf(pkg, "HEAD^1")).toBe(setup)
      expect(await fullShaOf(pkg, "HEAD^2")).toBe(tip)
      expect(await branchOf(pkg)).toBe(original)
      expect(await hasBranch(pkg, "auto/R-01")).toBe(false)
    }),
  )

  test(
    "--abandon discards the round branch after the person-reviewed reset: back on the original, nothing landed, the tip printed",
    withDir(async (dir) => {
      const pkg = await nestedRepo(dir)
      const original = await branchOf(pkg)
      const setup = await fullShaOf(pkg, original)
      expect(await isolateRound(dir, ["pkg"], "auto/R-01")).toEqual({ type: "ok", isolated: ["pkg"] })
      await driverCommit(dir, pkg, "one.txt", "one\n", 1)
      const tip = await shaOf(pkg, "auto/R-01")
      const abandoned = await landUnit(dir, { isolate: ["pkg"], abandon: true })
      expect(abandoned.type).toBe("landed")
      expect(abandoned.lines).toContain(`✓ pkg: abandoned auto/R-01 (was ${tip}, recoverable via git reflog until collection); back on ${original}, nothing landed`)
      expect(await branchOf(pkg)).toBe(original)
      expect(await hasBranch(pkg, "auto/R-01")).toBe(false)
      expect(await fullShaOf(pkg, original)).toBe(setup)
    }),
  )

  test(
    "refusal: the original branch moved — nothing lands, the reason names the repository and the branch",
    withDir(async (dir) => {
      const pkg = await nestedRepo(dir)
      const original = await branchOf(pkg)
      expect(await isolateRound(dir, ["pkg"], "auto/R-01")).toEqual({ type: "ok", isolated: ["pkg"] })
      await driverCommit(dir, pkg, "one.txt", "one\n", 1)
      // A human commit lands on the original branch after isolation: the
      // landing's conflict surface by design.
      await git(pkg, "checkout", "-q", original)
      writeFileSync(join(pkg, "moved.txt"), "moved\n")
      await git(pkg, "add", "-A")
      await git(pkg, "commit", "-qm", "a human move")
      const moved = await fullShaOf(pkg, original)
      await git(pkg, "checkout", "-q", "auto/R-01")
      const blocked = await landUnit(dir, { isolate: ["pkg"] })
      expect(blocked.type).toBe("blocked")
      expect(blocked.lines).toHaveLength(3)
      expect(blocked.lines[0]).toBe("⏸ round R-01 cannot land yet:")
      expect(blocked.lines[1]).toMatch(/^  pkg: the original branch \S+ moved since auto\/R-01 was isolated \(its tip left the isolation point /)
      expect(blocked.lines[2]).toBe(`next: settle the above by hand, then re-run: opencode-auto land ${dir}`)
      // Nothing was touched: the branch and the moved original stay as they
      // were.
      expect(await hasBranch(pkg, "auto/R-01")).toBe(true)
      expect(await fullShaOf(pkg, original)).toBe(moved)
      expect(await branchOf(pkg)).toBe("auto/R-01")
    }),
  )

  test(
    "refusal: foreign commits mixed into auto/R-NN's range — never landed automatically",
    withDir(async (dir) => {
      const pkg = await nestedRepo(dir)
      const original = await branchOf(pkg)
      const setup = await fullShaOf(pkg, original)
      expect(await isolateRound(dir, ["pkg"], "auto/R-01")).toEqual({ type: "ok", isolated: ["pkg"] })
      await driverCommit(dir, pkg, "one.txt", "one\n", 1)
      // A commit without the Auto-Stage trailer on the round branch: the
      // same criterion the unit close-out check uses.
      writeFileSync(join(pkg, "human.txt"), "human\n")
      await git(pkg, "add", "-A")
      await git(pkg, "commit", "-qm", "a human touch on the round branch")
      const blocked = await landUnit(dir, { isolate: ["pkg"] })
      expect(blocked.type).toBe("blocked")
      expect(blocked.lines[1]).toMatch(/^  pkg: 1 non-driver commit\(s\) on auto\/R-01 since the isolation point /)
      expect(await hasBranch(pkg, "auto/R-01")).toBe(true)
      expect(await fullShaOf(pkg, original)).toBe(setup)
    }),
  )

  test(
    "refusal: a dirty repository blocks like the establishment gate, naming the paths; nothing is touched",
    withDir(async (dir) => {
      const pkg = await nestedRepo(dir)
      const original = await branchOf(pkg)
      const setup = await fullShaOf(pkg, original)
      expect(await isolateRound(dir, ["pkg"], "auto/R-01")).toEqual({ type: "ok", isolated: ["pkg"] })
      writeFileSync(join(pkg, "wip.txt"), "uncommitted\n")
      const blocked = await landUnit(dir, { isolate: ["pkg"] })
      expect(blocked).toEqual({
        type: "blocked",
        lines: [
          "⏸ landing requires clean repositories (uncommitted changes would ride into the landing); handle them manually (commit/clean) and re-run:",
          "  pkg:",
          "    pkg/wip.txt",
        ],
      })
      expect(await hasBranch(pkg, "auto/R-01")).toBe(true)
      expect(await fullShaOf(pkg, original)).toBe(setup)
    }),
  )

  test(
    "refusal: an ambiguous original branch (several candidates) blocks naming them; a repository with no candidate branch blocks the same way",
    withDir(async (dir) => {
      const pkg = await nestedRepo(dir)
      const original = await branchOf(pkg)
      expect(await isolateRound(dir, ["pkg"], "auto/R-01")).toEqual({ type: "ok", isolated: ["pkg"] })
      await driverCommit(dir, pkg, "one.txt", "one\n", 1)
      await git(pkg, "branch", "wip")
      const blocked = await landUnit(dir, { isolate: ["pkg"] })
      expect(blocked.type).toBe("blocked")
      expect(blocked.lines[1]).toBe(`  pkg: cannot tell which of ${original}, wip is the original branch; landing needs exactly one — settle the branches manually or land by hand`)
      // Removing the extra branch unblocks; removing the original instead
      // leaves no candidate at all.
      await git(pkg, "branch", "-D", "wip")
      await git(pkg, "branch", "-D", original)
      const none = await landUnit(dir, { isolate: ["pkg"] })
      expect(none.type).toBe("blocked")
      expect(none.lines[1]).toBe(`  pkg: no candidate original branch remains beside auto/R-01; landing needs exactly one — settle the branches manually or land by hand`)
    }),
  )

  test(
    "a lane-family branch inside the designated repository is never mistaken for the original (plans/0074 §2.4: lane branches live inside whichever branch is checked out)",
    withDir(async (dir) => {
      const pkg = await nestedRepo(dir)
      const original = await branchOf(pkg)
      const setup = await fullShaOf(pkg, original)
      expect(await isolateRound(dir, ["pkg"], "auto/R-01")).toEqual({ type: "ok", isolated: ["pkg"] })
      await driverCommit(dir, pkg, "one.txt", "one\n", 1)
      // A lane branch the repository holds beside the round branch (the
      // nested repository was itself lane-driven once, or a lane park of an
      // interrupted attempt was salvaged by hand): the original-branch
      // derivation skips the lane family exactly like the round family.
      await git(pkg, "branch", "auto-lane/T-009", "auto/R-01")
      const landed = await landUnit(dir, { isolate: ["pkg"] })
      expect(landed.type).toBe("landed")
      expect(landed.lines[0]).toMatch(/^✓ pkg: landed [0-9a-f]+ on \S+ \(1 commit\(s\) of auto\/R-01 as one\); auto\/R-01 deleted$/)
      expect(await branchOf(pkg)).toBe(original)
      expect(await commitCount(pkg, original)).toBe(2)
      expect(await fullShaOf(pkg, "HEAD~1")).toBe(setup)
      expect(await hasBranch(pkg, "auto-lane/T-009")).toBe(true)
      expect(await hasBranch(pkg, "auto/R-01")).toBe(false)
    }),
  )

  test(
    "a mixed set lands nothing: one repository's refusal blocks every repository's landing",
    withDir(async (dir) => {
      const pkg = await nestedRepo(dir, "pkg")
      const tools = await nestedRepo(dir, "tools/cli")
      const pkgOriginal = await branchOf(pkg)
      const toolsOriginal = await branchOf(tools)
      expect(await isolateRound(dir, ["pkg", "tools/cli"], "auto/R-01")).toEqual({ type: "ok", isolated: ["pkg", "tools/cli"] })
      await driverCommit(dir, pkg, "one.txt", "one\n", 1)
      await driverCommit(dir, tools, "one.txt", "one\n", 1)
      // tools/cli's original branch moves: the whole landing refuses, and
      // pkg — perfectly landable — is left untouched too.
      await git(tools, "checkout", "-q", toolsOriginal)
      writeFileSync(join(tools, "moved.txt"), "moved\n")
      await git(tools, "add", "-A")
      await git(tools, "commit", "-qm", "a human move")
      await git(tools, "checkout", "-q", "auto/R-01")
      const blocked = await landUnit(dir, { isolate: ["pkg", "tools/cli"] })
      expect(blocked.type).toBe("blocked")
      expect(blocked.lines[1]).toMatch(/^  tools\/cli: the original branch /)
      expect(await hasBranch(pkg, "auto/R-01")).toBe(true)
      expect(await commitCount(pkg, pkgOriginal)).toBe(1)
    }),
  )

  test(
    "a round branch that holds no change beyond the original is deleted with no commit made",
    withDir(async (dir) => {
      const pkg = await nestedRepo(dir)
      const original = await branchOf(pkg)
      expect(await isolateRound(dir, ["pkg"], "auto/R-01")).toEqual({ type: "ok", isolated: ["pkg"] })
      const landed = await landUnit(dir, { isolate: ["pkg"] })
      expect(landed.type).toBe("landed")
      expect(landed.lines).toContain(`✓ pkg: nothing to land — auto/R-01 holds no change beyond ${original}; branch deleted`)
      expect(await commitCount(pkg, original)).toBe(1)
      expect(await hasBranch(pkg, "auto/R-01")).toBe(false)
      // Under --keep the changeless branch stays (the round's own branch,
      // re-established here after the deletion above).
      expect(await isolateRound(dir, ["pkg"], "auto/R-01")).toEqual({ type: "ok", isolated: ["pkg"] })
      const kept = await landUnit(dir, { isolate: ["pkg"], keep: true })
      expect(kept.lines).toContain(`✓ pkg: nothing to land — auto/R-01 holds no change beyond ${original}; branch retained`)
      expect(await hasBranch(pkg, "auto/R-01")).toBe(true)
    }),
  )

  test(
    "usage: an empty isolate list, and the contradictory flag pairs",
    withDir(async (dir) => {
      await nestedRepo(dir)
      const empty = await landUnit(dir, { isolate: [] })
      expect(empty.type).toBe("usage")
      expect(empty.lines[0]).toContain("nothing to land: the config designates no branch-isolated repositories")
      const both = await landUnit(dir, { isolate: ["pkg"], keep: true, abandon: true })
      expect(both.type).toBe("usage")
      expect(both.lines[0]).toContain("--keep and --abandon are mutually exclusive")
      const merged = await landUnit(dir, { isolate: ["pkg"], merge: true, abandon: true })
      expect(merged.type).toBe("usage")
      expect(merged.lines[0]).toContain("--merge is a landing mode and --abandon lands nothing")
    }),
  )

  test(
    "the landing commit carries no Auto-Stage trailer (the deliverable's own history entry, not a driver session commit)",
    withDir(async (dir) => {
      const pkg = await nestedRepo(dir)
      const original = await branchOf(pkg)
      expect(await isolateRound(dir, ["pkg"], "auto/R-01")).toEqual({ type: "ok", isolated: ["pkg"] })
      await driverCommit(dir, pkg, "one.txt", "one\n", 1)
      const landed = await landUnit(dir, { isolate: ["pkg"] })
      expect(landed.type).toBe("landed")
      const body = await git(pkg, "log", "-1", "--format=%B")
      expect(body).not.toContain("Auto-Stage:")
      expect(body.trim()).toBe("land auto/R-01: 1 commit(s) of round R-01")
      expect(await branchOf(pkg)).toBe(original)
    }),
  )
})

describe("leftoverIsolationLines (plans/0074 §4: preflight's leftover report)", () => {
  test(
    "an unmerged auto/R-NN of an earlier round is reported as recoverable state; the live branch and merged leftovers are not",
    withDir(async (dir) => {
      const pkg = await nestedRepo(dir)
      const original = await branchOf(pkg)
      // An abandoned round's branch: created from the original with the
      // round's driver commits on it (the round died before landing), then
      // the repository was switched back — the branch holds unlanded work
      // the current HEAD lacks. The trail continued into the next round:
      // round 2's branch grew from the abandoned one and carried its work
      // onward.
      await git(pkg, "checkout", "-q", "-b", "auto/R-01")
      await driverCommit(dir, pkg, "lost.txt", "unlanded\n", 1)
      await git(pkg, "checkout", "-q", "-b", "auto/R-02")
      await driverCommit(dir, pkg, "live.txt", "ongoing\n", 2)
      await git(pkg, "checkout", "-q", original)
      const lines = await leftoverIsolationLines(dir, ["pkg"], "auto/R-02")
      expect(lines).toHaveLength(1)
      expect(lines[0]).toBe(
        "⚠ pkg: auto/R-01 holds unlanded work from an earlier round — recoverable state, not corruption: " +
          "land by hand (git checkout <original> && git merge --squash auto/R-01), or remove the branch (git branch -D auto/R-01)",
      )
      // The live round branch is excluded however unmerged it is… (from the
      // original branch both round branches hold work HEAD lacks; only the
      // live one is exempt)
      expect(await leftoverIsolationLines(dir, ["pkg"], "auto/R-02")).toEqual(lines)
      // …and a leftover whose commits the current HEAD already contains (the
      // trail continued into the next round) is merged, not a leftover:
      // landing round 2 with --merge (docs/R-02 makes it the current round)
      // takes both branches' commits into the original as merge ancestors,
      // so auto/R-01's history is contained in HEAD and the branch is no
      // longer a leftover. (The default squash landing carries the tree, not
      // the commits — an abandoned branch it folded in would stay reported,
      // its content recoverable by review; the branch delete is then safe.)
      mkdirSync(join(dir, "docs", "R-02"), { recursive: true })
      const merged = await landUnit(dir, { isolate: ["pkg"], merge: true })
      expect(merged.type).toBe("landed")
      expect(await leftoverIsolationLines(dir, ["pkg"], "auto/R-03")).toEqual([])
    }),
  )

  test(
    "a repository with no leftover round branches reports nothing",
    withDir(async (dir) => {
      await nestedRepo(dir)
      expect(await leftoverIsolationLines(dir, ["pkg"], "auto/R-01")).toEqual([])
    }),
  )
})
