// The brief module's direct home (created for plans/0215 D3): the
// install's write discipline. The loop's path is pinned end-to-end by
// survey-gate.test.ts; this pins the write itself — write-tmp-then-rename
// over the committed constants file.
import { describe, expect, test } from "bun:test"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installBriefProposal } from "../src/brief"

describe("installBriefProposal's write discipline (plans/0215 D3, 0165-157)", () => {
  test("the install replaces the file: a read-only brief is healed, not a thrown EACCES; the commit still runs", async () => {
    // The read-only brief (a killed run's stale protect bit) is the
    // deterministic stand-in for the crash mid-write: the pre-fix in-place
    // Bun.write answers EACCES out of the install, the rename replaces the
    // entry and the approved proposal lands verbatim.
    const dir = await mkdtemp(join(tmpdir(), "auto-brief-install-"))
    try {
      const brief = join(dir, ".opencode/auto/brief.md")
      await Bun.write(brief, "the old constants\n")
      await chmod(brief, 0o444)
      let commits = 0
      try {
        const lines = await installBriefProposal(dir, "docs/R-01/P01-survey/survey.md", "the approved constants", async () => {
          commits++
          return { ok: true }
        })
        expect(await Bun.file(brief).text()).toBe("the approved constants\n")
        expect(lines).toEqual(["✓ approved project brief installed: docs/R-01/P01-survey/survey.md `## Project brief` section → .opencode/auto/brief.md"])
        expect(commits).toBe(1)
      } finally {
        await chmod(brief, 0o644).catch(() => {})
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
