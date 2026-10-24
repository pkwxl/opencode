// The release gate (plans/0103 D2/D3): the destination repository's
// containment findings — recorded but deferred while rounds run — become
// blocking at the person's release, beside a clean-tree check. These cases
// pin the gate's data; the scan wordings themselves are pinned in
// document-roles.test.ts.
import { describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { releaseCheck } from "../src/release"
import { git } from "./fixtures/runner"
import { withDirFactory } from "./fixtures/dir"

const withDir = withDirFactory("auto-release-")

async function repo(dir: string) {
  await git(dir, "init", "-q")
  await git(dir, "config", "user.email", "t@example.com")
  await git(dir, "config", "user.name", "t")
}

// A destination repository under <dir>/vendor: a person seed commit, then
// the given files landed as the driver's own commit (the unified commit's
// trailer shape — plans/0119: the release scan reads git's modified view,
// the run of driver commits back from HEAD, never the whole tree).
async function destination(dir: string, files: Record<string, string>, commitMessage = "work\n\nAuto-Task: T-001\nAuto-Stage: implement") {
  mkdirSync(join(dir, "vendor"), { recursive: true })
  await repo(join(dir, "vendor"))
  writeFileSync(join(dir, "vendor", "seed.txt"), "seed\n")
  await git(join(dir, "vendor"), "add", "-A")
  await git(join(dir, "vendor"), "commit", "-qm", "seed")
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, "vendor", rel)), { recursive: true })
    writeFileSync(join(dir, "vendor", rel), text)
  }
  if (Object.keys(files).length) {
    await git(join(dir, "vendor"), "add", "-A")
    await git(join(dir, "vendor"), "commit", "-qm", commitMessage)
  }
}

describe("releaseCheck (plans/0103 D2/D3)", () => {
  test(
    "no nested repository: nothing to release",
    withDir(async (dir) => {
      await repo(dir)
      mkdirSync(join(dir, "src"), { recursive: true })
      writeFileSync(join(dir, "src", "a.c"), "int a;\n")
      const check = await releaseCheck(dir)
      expect(check.nothing).toStartWith("nothing to release:")
      expect(check.certified).toEqual([])
      expect(check.problems).toEqual([])
    }),
  )

  test(
    "a clean, self-contained destination certifies with its HEAD named",
    withDir(async (dir) => {
      await repo(dir)
      // The workspace's own task-naming script is not the destination's
      // business: release scans the nested repository alone.
      mkdirSync(join(dir, "test"), { recursive: true })
      writeFileSync(join(dir, "test/lane.sh"), "# the T-012 lane\n")
      await destination(dir, { "src/a.rs": "//! The geometry slot.\npub fn a() {}\n" })
      const check = await releaseCheck(dir)
      expect(check.nothing).toBeUndefined()
      expect(check.problems).toEqual([])
      expect(check.certified).toHaveLength(1)
      expect(check.certified[0]).toStartWith("✓ vendor @ ")
      expect(check.certified[0]).toContain("no process references, no task ids, no paths outside its own root")
    }),
  )

  test(
    "the recorded findings block at release: task ids, out-of-root paths, process paths",
    withDir(async (dir) => {
      await repo(dir)
      await destination(dir, {
        "src/a.rs": "//! The geometry slot (T-012 §2.2).\n",
        "src/b.c": 'path = "../../outside"\n',
        "src/c.c": "// see docs/T-004/report.md for the reason\n",
      })
      const check = await releaseCheck(dir)
      expect(check.nothing).toBeUndefined()
      expect(check.certified).toEqual([])
      expect(check.problems).toHaveLength(3)
      expect(check.problems.find((p) => p.startsWith("vendor/src/a.rs"))).toContain("mention a task id (T-NNN)")
      expect(check.problems.find((p) => p.startsWith("vendor/src/b.c"))).toContain('references "../../outside"')
      expect(check.problems.find((p) => p.startsWith("vendor/src/c.c"))).toContain('references "docs/T-004/report.md"')
    }),
  )

  test(
    "an uncommitted destination is not a releasable state; scan exemptions hold",
    withDir(async (dir) => {
      await repo(dir)
      await destination(dir, {})
      writeFileSync(join(dir, "vendor", "wip.rs"), "// in flight\n")
      const dirty = await releaseCheck(dir)
      expect(dirty.problems).toHaveLength(1)
      expect(dirty.problems[0]).toStartWith("vendor holds 1 uncommitted path(s) (e.g. vendor/wip.rs)")
      expect(dirty.certified).toEqual([])
      // The exemption path: a deliverable the project declared as content.
      await git(join(dir, "vendor"), "add", "-A")
      await git(join(dir, "vendor"), "commit", "-qm", "wip")
      mkdirSync(join(dir, "vendor", "fixtures"), { recursive: true })
      writeFileSync(join(dir, "vendor", "fixtures", "sample.txt"), "docs/T-004/report.md (T-004)\n")
      await git(join(dir, "vendor"), "add", "-A")
      await git(join(dir, "vendor"), "commit", "-qm", "fixtures\n\nAuto-Task: T-001\nAuto-Stage: implement")
      const exempt = await releaseCheck(dir, { scanExempt: ["vendor/fixtures"] })
      expect(exempt.problems).toEqual([])
      expect(exempt.certified).toHaveLength(1)
    }),
  )

  test(
    "person-committed content is the person's own, never the migration's debt (plans/0119): a clean upstream history certifies untouched",
    withDir(async (dir) => {
      await repo(dir)
      // The destination the migration only reads: committed references
      // everywhere, none of them the project's writing — the cleanroom
      // shape whose whole-tree scan OOMed and whose findings were never
      // the migration's to answer for.
      await destination(dir, {
        "src/old.rs": "//! The slot (T-012 §2.2).\n",
        "src/old.c": 'path = "../../outside"\n',
      }, "person history")
      const check = await releaseCheck(dir)
      expect(check.nothing).toBeUndefined()
      expect(check.problems).toEqual([])
      expect(check.certified).toHaveLength(1)
    }),
  )

  test(
    "an empty destination repository has no commits to release",
    withDir(async (dir) => {
      await repo(dir)
      mkdirSync(join(dir, "vendor"), { recursive: true })
      await repo(join(dir, "vendor"))
      const check = await releaseCheck(dir)
      expect(check.problems).toEqual(["vendor has no commits to release (an empty repository cannot stand alone)"])
    }),
  )
})
