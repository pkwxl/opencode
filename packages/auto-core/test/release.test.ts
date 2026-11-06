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

// plans/0173 D1 (0165-004 — the S1): the scan's baseline is the parent of
// the oldest boundary commit reachable from HEAD, so the release loop's own
// remedy commits — and any person or agent commit above the run — stay
// inside the scanned range; a landed repository is recognized by its landing
// subject; a repository under config isolate with no boundary reachable is
// the unlanded round and refuses instead of certifying.
describe("releaseCheck's driver boundary (plans/0173 D1)", () => {
  test(
    "a partial fix commit between two releases stays scanned: the second release still lists the rest (the S1 repro)",
    withDir(async (dir) => {
      await repo(dir)
      await destination(dir, {
        "src/a.rs": "use crate::t;\n\n// ported per docs/T-004/report.md\n",
        "src/b.rs": "// decided in T-004\nfn b() {}\n",
      })
      const first = await releaseCheck(dir)
      expect(first.problems.length).toBe(2)
      // The person's remedy loop: fix one finding, commit (the only way
      // past check 1), re-run — the rest must still be listed, never
      // certified over.
      writeFileSync(join(dir, "vendor", "src", "a.rs"), "use crate::t;\n\n// ported per the upstream ABI notes\n")
      await git(join(dir, "vendor"), "add", "-A")
      await git(join(dir, "vendor"), "commit", "-qm", "person: restate a")
      const second = await releaseCheck(dir)
      expect(second.certified).toEqual([])
      expect(second.problems.length).toBe(1)
      expect(second.problems[0]).toContain("src/b.rs")
      expect(second.problems[0]).toContain("task id")
      expect((await Bun.file(join(dir, "vendor", "src", "b.rs")).text()).includes("decided in T-004")).toBe(true)
    }),
  )

  test(
    "the ✓ line states what was scanned: the boundary kind, the baseline, the changed-file count",
    withDir(async (dir) => {
      await repo(dir)
      await destination(dir, { "src/ok.c": "int ok;\n" })
      const check = await releaseCheck(dir)
      expect(check.certified).toHaveLength(1)
      expect(check.certified[0]).toMatch(
        /✓ vendor @ [0-9a-f]+ — no process references, no task ids, no paths outside its own root \(scanned 1 changed file\(s\) since baseline [0-9a-f]+ \(driver boundary\)\)$/,
      )
    }),
  )

  test(
    "a landed repository is recognized by its landing subject: the squashed round is the migration's content and is scanned",
    withDir(async (dir) => {
      await repo(dir)
      mkdirSync(join(dir, "vendor"), { recursive: true })
      await repo(join(dir, "vendor"))
      writeFileSync(join(dir, "vendor", "seed.txt"), "seed\n")
      await git(join(dir, "vendor"), "add", "-A")
      await git(join(dir, "vendor"), "commit", "-qm", "seed")
      // The landing commit (plans/0074 §2.3): trailer-less by design, the
      // round's net change as exactly one commit.
      writeFileSync(join(dir, "vendor", "ported.rs"), "// ported per docs/T-004/report.md\n")
      await git(join(dir, "vendor"), "add", "-A")
      await git(join(dir, "vendor"), "commit", "-qm", "land auto/R-01: 3 commit(s) of round 1")
      const check = await releaseCheck(dir)
      expect(check.certified).toEqual([])
      expect(check.problems).toHaveLength(1)
      expect(check.problems[0]).toContain("ported.rs")
    }),
  )

  test(
    "a repository under config isolate with no boundary reachable refuses naming the round branch (the unlanded round)",
    withDir(async (dir) => {
      await repo(dir)
      await destination(dir, { "src/ok.c": "int ok;\n" }, "person work, never the driver's")
      const plain = await releaseCheck(dir, { isolate: ["vendor"] })
      expect(plain.certified).toEqual([])
      expect(plain.problems).toHaveLength(1)
      expect(plain.problems[0]).toContain("auto/R-01")
      // Outside the isolate set the same repository keeps 0119's person-
      // content posture: nothing of the run in history, nothing scanned.
      const outside = await releaseCheck(dir)
      expect(outside.problems).toEqual([])
      expect(outside.certified).toHaveLength(1)
    }),
  )
})

// plans/0176 (0165-034, S19-02): a destination whose git cannot be read never
// certifies — the clean-tree check reads strict and the scan blocks on its
// input's unreadable state; the old gate printed its ⚠ lines and then the ✓
// over the empty scan with exit 0.
test(
  "an unreadable destination (corrupt index) blocks, never certifies",
  withDir(async (dir) => {
    await repo(dir)
    await destination(dir, { "src/a.rs": "//! The geometry slot.\npub fn a() {}\n" })
    // The S19-02 repro's shape: a crashed tool mid-write, a half-copied
    // repository — the index is garbage.
    writeFileSync(join(dir, "vendor", ".git", "index"), "not an index")
    const check = await releaseCheck(dir)
    expect(check.certified).toEqual([])
    expect(check.problems.length).toBeGreaterThan(0)
    expect(check.problems.some((line) => line.includes("unreadable") || line.includes("cannot be scanned"))).toBe(true)
    expect(check.problems.every((line) => !line.startsWith("✓"))).toBe(true)
  }),
)
