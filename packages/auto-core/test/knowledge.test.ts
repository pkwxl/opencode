import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { opencodeAgent } from "../src/agent/opencode/client"
import {
  digestIndexEntries,
  existingDistilledDocs,
  existingKnowledge,
  existingPriorKnowledge,
  extractKnowledge,
  extractPriorKnowledge,
  knowledgeFile,
  priorKnowledgeComplete,
  priorKnowledgeDigest,
  priorKnowledgeFile,
  priorKnowledgeParts,
  renderDigestIndex,
} from "../src/knowledge"
import { noCommitGit } from "../src/git-ops"
import { syncPhaseIndex } from "../src/phases"

// A round established with phases "amk": the knowledge phase is P03.
async function knowledgePhase(dir: string, round: number) {
  return (await syncPhaseIndex(dir, round, "amk")).find((unit) => unit.type === "knowledge")!
}

async function git(dir: string, ...args: string[]) {
  const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`git ${args.join(" ")} exit code ${code}: ${err || out}`)
  return out
}

describe("knowledgeFile / priorKnowledgeFile (output paths)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-knowledge-"))
  }

  test("knowledgeFile = the knowledge phase's standard artifact kb.md inside its phase directory", async () => {
    const dir = tempDir()
    try {
      expect(knowledgeFile(await knowledgePhase(dir, 2))).toBe("docs/R-02/P03-knowledge/kb.md")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("priorKnowledgeFile = docs/R-NN/prior-kb.md", () => {
    expect(priorKnowledgeFile(1)).toBe(join("docs", "R-01", "prior-kb.md"))
    expect(priorKnowledgeFile(3)).toBe(join("docs", "R-03", "prior-kb.md"))
  })
})

describe("existingKnowledge (this phase's idempotence check)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-knowledge-"))
  }

  test("the phase's kb.md non-empty → its path; missing / blank → undefined; legacy flat documents do not count", async () => {
    const dir = tempDir()
    try {
      const phase = await knowledgePhase(dir, 1)
      expect(await existingKnowledge(dir, phase)).toBeUndefined()
      mkdirSync(join(dir, "docs/migration-kb"), { recursive: true })
      writeFileSync(join(dir, "docs/migration-kb/R1-migration-a.md"), "legacy flat knowledge")
      writeFileSync(join(dir, "docs/R-01/migration-kb.md"), "letter-layout-era in-round knowledge")
      expect(await existingKnowledge(dir, phase)).toBeUndefined()
      writeFileSync(join(dir, knowledgeFile(phase)), " \n")
      expect(await existingKnowledge(dir, phase)).toBeUndefined()
      writeFileSync(join(dir, knowledgeFile(phase)), "this round's knowledge")
      expect(await existingKnowledge(dir, phase)).toBe("docs/R-01/P03-knowledge/kb.md")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("existingPriorKnowledge (this round's idempotence check, the same guard as existingKnowledge)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-knowledge-"))
  }

  test("this round's docs/R-NN/prior-kb.md non-empty → returned; an empty file, a missing one and legacy flat docs/prior-kb/ stock do not count (M3.7)", async () => {
    const dir = tempDir()
    try {
      expect(await existingPriorKnowledge(dir, 1)).toBeUndefined()
      mkdirSync(join(dir, "docs/prior-kb"), { recursive: true })
      writeFileSync(join(dir, "docs/prior-kb/R1-prior-a.md"), "legacy flat prior knowledge")
      mkdirSync(join(dir, "docs/R-01"), { recursive: true })
      writeFileSync(join(dir, "docs/R-01/prior-kb.md"), " \n")
      expect(await existingPriorKnowledge(dir, 1)).toBeUndefined()
      writeFileSync(join(dir, "docs/R-01/prior-kb.md"), "round 1 prior knowledge")
      expect(await existingPriorKnowledge(dir, 1)).toBe(join("docs", "R-01", "prior-kb.md"))
      expect(await existingPriorKnowledge(dir, 2)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("the new layout structurally eliminates the old-round misjudgment: round R-05's directory established + old-round R4-prior stock → must distill again (2026-09-08 incident regression)", async () => {
    const dir = tempDir()
    try {
      // The kernel-dm-stripe incident scene: the old round (docs/prior-kb/R4-prior-*.md,
      // including the simple verdict) kept in place; the new round R-05 established at
      // round start (the in-round prior-kb.md is always empty)
      mkdirSync(join(dir, "docs/prior-kb"), { recursive: true })
      writeFileSync(join(dir, "docs/prior-kb/R4-prior-2026.md"), "# Round 4 prior knowledge\n\nProcess advice: simple\n")
      mkdirSync(join(dir, "docs/R-05"), { recursive: true })
      expect(await existingPriorKnowledge(dir, 5)).toBeUndefined()
      // Idempotent hit once the in-round document exists
      writeFileSync(join(dir, "docs/R-05/prior-kb.md"), "this round's prior knowledge")
      expect(await existingPriorKnowledge(dir, 5)).toBe(join("docs", "R-05", "prior-kb.md"))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("temp-kb.md (the extraction intermediate, not yet finalized) never counts as an existing artifact", async () => {
    const dir = tempDir()
    try {
      mkdirSync(join(dir, "docs/R-01"), { recursive: true })
      writeFileSync(join(dir, "docs/R-01/temp-kb.md"), "an abandoned intermediate")
      expect(await existingPriorKnowledge(dir, 1)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("existingDistilledDocs (the list of existing distilled artifacts, referenced input of the extraction session)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-knowledge-"))
  }

  test("directory missing → an empty array; the legacy flat migration-kb/handovers/prior-kb are no longer collected (M3.7)", async () => {
    const dir = tempDir()
    try {
      expect(await existingDistilledDocs(dir, 2)).toEqual([])
      mkdirSync(join(dir, "docs/migration-kb"), { recursive: true })
      mkdirSync(join(dir, "docs/handovers"), { recursive: true })
      mkdirSync(join(dir, "docs/prior-kb"), { recursive: true })
      writeFileSync(join(dir, "docs/migration-kb", "R1-migration-a.md"), "previous round's knowledge")
      writeFileSync(join(dir, "docs/handovers", "R1-m-migrate.md"), "previous round's handover")
      writeFileSync(join(dir, "docs/prior-kb", "R1-prior-old.md"), "old prior knowledge")
      expect(await existingDistilledDocs(dir, 2)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("round directories: every prior round's prior-kb.md, each phase directory's handover.md and the knowledge phase's kb.md collected together; this round's prior-kb excluded", async () => {
    const dir = tempDir()
    try {
      await syncPhaseIndex(dir, 1, "mk")
      writeFileSync(join(dir, "docs/R-01/P02-knowledge/kb.md"), "round 1 knowledge")
      writeFileSync(join(dir, "docs/R-01/prior-kb.md"), "round 1 prior knowledge")
      writeFileSync(join(dir, "docs/R-01/P01-implement/handover.md"), "round 1 handover")
      writeFileSync(join(dir, "docs/R-01/P01-implement/notes.md"), "a free artifact does not count")
      await syncPhaseIndex(dir, 2, "mk")
      writeFileSync(join(dir, "docs/R-02/prior-kb.md"), "this round's prior knowledge does not count")
      writeFileSync(join(dir, "docs/R-02/P02-knowledge/kb.md"), " \n") // an empty file does not count
      writeFileSync(join(dir, "docs/R-02/P01-implement/handover.md"), "this round's completed-phase handover")
      expect(await existingDistilledDocs(dir, 2)).toEqual([
        join("docs/R-01", "P01-implement", "handover.md"),
        join("docs/R-01", "P02-knowledge", "kb.md"),
        join("docs/R-01", "prior-kb.md"),
        join("docs/R-02", "P01-implement", "handover.md"),
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("priorKnowledgeDigest (the prior-knowledge digest, accumulated injection across rounds)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-knowledge-"))
  }

  test("prior rounds' non-empty docs/R-*/prior-kb.md concatenated sorted by path; the legacy flat docs/prior-kb/ is not read; no artifacts → undefined", async () => {
    const dir = tempDir()
    try {
      expect(await priorKnowledgeDigest(dir)).toBeUndefined()
      mkdirSync(join(dir, "docs/R-01"), { recursive: true })
      writeFileSync(join(dir, "docs/R-01/prior-kb.md"), "round 1 prior knowledge")
      mkdirSync(join(dir, "docs/R-02"), { recursive: true })
      writeFileSync(join(dir, "docs/R-02/prior-kb.md"), "  \n") // an empty file is not injected
      mkdirSync(join(dir, "docs/prior-kb"), { recursive: true })
      writeFileSync(join(dir, "docs/prior-kb/R0-prior-legacy.md"), "legacy flat prior knowledge")
      const digest = await priorKnowledgeDigest(dir)
      expect(digest).toContain(`### ${join("docs", "R-01", "prior-kb.md")}`)
      expect(digest).toContain("round 1 prior knowledge")
      expect(digest).not.toContain("legacy flat prior knowledge")
      expect(digest).not.toContain("R-02")
      // temp-kb.md (an intermediate) is not injected into the digest
      writeFileSync(join(dir, "docs/R-02/temp-kb.md"), "an unfinalized intermediate")
      expect(await priorKnowledgeDigest(dir)).not.toContain("temp-kb")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("priorKnowledgeComplete (the finalized-marker check)", () => {
  test("the last non-empty line exactly DONE → true; an empty document / no marker / a marker with a tail → false", () => {
    expect(priorKnowledgeComplete("")).toBe(false)
    expect(priorKnowledgeComplete("  \n")).toBe(false)
    expect(priorKnowledgeComplete("DONE")).toBe(true)
    expect(priorKnowledgeComplete("# Knowledge base\n\nBody\n\nDONE")).toBe(true)
    expect(priorKnowledgeComplete("Body\nDONE\n\n  \n")).toBe(true)
    expect(priorKnowledgeComplete("Body\n  DONE  ")).toBe(true)
    expect(priorKnowledgeComplete("Body, done.")).toBe(false)
    expect(priorKnowledgeComplete("Body\nDONE.")).toBe(false)
    expect(priorKnowledgeComplete("DONE\nanother paragraph of body")).toBe(false)
  })
})

// The digest cap's index form (plans/0061 R3/A7): the per-file parts feed
// both the digest and the index, the entries mirror the full digest's
// selection, and the renderer shapes the prevRound-slot text.
describe("digestIndexEntries / renderDigestIndex (the capped digest's index form)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-knowledge-"))
  }

  test("priorKnowledgeParts: past rounds' non-empty prior-kb.md as {file, text}, sorted by path", async () => {
    const dir = tempDir()
    try {
      expect(await priorKnowledgeParts(dir)).toEqual([])
      mkdirSync(join(dir, "docs/R-02"), { recursive: true })
      writeFileSync(join(dir, "docs/R-02/prior-kb.md"), "round 2 prior knowledge")
      mkdirSync(join(dir, "docs/R-01"), { recursive: true })
      writeFileSync(join(dir, "docs/R-01/prior-kb.md"), "round 1 prior knowledge")
      writeFileSync(join(dir, "docs/R-01/temp-kb.md"), "an unfinalized intermediate")
      expect(await priorKnowledgeParts(dir)).toEqual([
        { file: join("docs", "R-01", "prior-kb.md"), text: "round 1 prior knowledge" },
        { file: join("docs", "R-02", "prior-kb.md"), text: "round 2 prior knowledge" },
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("digestIndexEntries: the prior rounds' prior knowledge plus the previous round's final handover and knowledge documents; empty files never count", async () => {
    const dir = tempDir()
    try {
      // No docs at all → an empty index.
      expect(await digestIndexEntries(dir)).toEqual([])
      // Round 1 complete (its implement phase done with a handover, a
      // knowledge phase with a document, prior knowledge), round 2 under way.
      await syncPhaseIndex(dir, 1, "mk")
      writeFileSync(join(dir, "docs/R-01/P01-implement/handover.md"), "final handover")
      writeFileSync(join(dir, "docs/R-01/P02-knowledge/kb.md"), "migration knowledge")
      writeFileSync(join(dir, "docs/R-01/prior-kb.md"), "round 1 prior knowledge")
      renameSync(join(dir, "docs/R-01/P01-implement/todo.md"), join(dir, "docs/R-01/P01-implement/done.md"))
      await syncPhaseIndex(dir, 2, "m")
      writeFileSync(join(dir, "docs/R-02/prior-kb.md"), "  \n") // this round's, empty — never in the digest anyway
      const entries = await digestIndexEntries(dir)
      // The prior-knowledge parts come first (the digest joins them first),
      // then the previous round's handover and knowledge documents.
      expect(entries.map((entry) => entry.file)).toEqual([
        join("docs", "R-01", "prior-kb.md"),
        join("docs", "R-01", "P01-implement", "handover.md"),
        join("docs", "R-01", "P02-knowledge", "kb.md"),
      ])
      // The sizes are the usage source's token estimate (ASCII at 3 chars per
      // token).
      const handover = entries.find((entry) => entry.file === join("docs", "R-01", "P01-implement", "handover.md"))!
      expect(handover.tokens).toBe(Math.ceil("final handover".length / 3))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("renderDigestIndex: one line per entry (path + size) and the open-what-you-need line, figures formatted", () => {
    const text = renderDigestIndex(
      [
        { file: join("docs", "R-01", "P01-implement", "handover.md"), tokens: 21_400 },
        { file: join("docs", "R-02", "prior-kb.md"), tokens: 300 },
      ],
      { total: 21_700, cap: 16_000 },
    )
    expect(text).toContain("about 21.7k tokens")
    expect(text).toContain("digest budget of 16.0k tokens")
    expect(text).toContain(`- ${join("docs", "R-01", "P01-implement", "handover.md")} (~21.4k tokens)`)
    expect(text).toContain(`- ${join("docs", "R-02", "prior-kb.md")} (~300 tokens)`)
    expect(text).toContain("Open and read the documents")
    // No template braces leak into the rendered form.
    expect(text).not.toMatch(/\{\{|\}\}/)
  })
})

describe("extractPriorKnowledge completion condition (artifact on disk + committed; dirty goes to a human)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-knowledge-"))
  }
  // This group covers only the branches that start no session (skipped/dirty); the client is never touched.
  const client = opencodeAgent({} as OpencodeClient)

  test("artifact already exists and committed → skipped, no new commit", async () => {
    const dir = tempDir()
    try {
      await git(dir, "init", "-q")
      mkdirSync(join(dir, "docs/R-01"), { recursive: true })
      writeFileSync(join(dir, "docs/R-01/prior-kb.md"), "round 1 prior knowledge\n\nDONE\n")
      await git(dir, "add", "-A")
      await git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init")
      const result = await extractPriorKnowledge(client, dir, { dir })
      expect(result).toEqual({ type: "skipped", file: join("docs", "R-01", "prior-kb.md") })
      expect((await git(dir, "rev-list", "--count", "HEAD")).trim()).toBe("1")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("artifact exists but is not committed yet → backfilled, then skipped (the completion condition is the commit)", async () => {
    const dir = tempDir()
    try {
      await git(dir, "init", "-q")
      await git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
      mkdirSync(join(dir, "docs/R-01"), { recursive: true })
      writeFileSync(join(dir, "docs/R-01/prior-kb.md"), "round 1 prior knowledge\n\nDONE\n")
      const result = await extractPriorKnowledge(client, dir, { dir })
      expect(result).toEqual({ type: "skipped", file: join("docs", "R-01", "prior-kb.md") })
      // Backfilled: the worktree is clean and the commit carries the prior-knowledge stage mark
      expect((await git(dir, "status", "--porcelain")).trim()).toBe("")
      expect(await git(dir, "log", "-1", "--pretty=%B")).toContain("Auto-Stage: prior-knowledge")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("artifact missing but the worktree has uncommitted changes → dirty (no cleanup, the changed files listed)", async () => {
    const dir = tempDir()
    try {
      await git(dir, "init", "-q")
      await git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
      mkdirSync(join(dir, "docs/R-01"), { recursive: true })
      writeFileSync(join(dir, "docs/R-01/temp-kb.md"), "an abandoned intermediate")
      const result = await extractPriorKnowledge(client, dir, { dir })
      expect(result.type).toBe("dirty")
      expect((result as { files: string[] }).files).toContain(join("docs", "R-01", "temp-kb.md"))
      // No cleanup: the scene stays as-is, no new commit
      expect((await git(dir, "rev-list", "--count", "HEAD")).trim()).toBe("1")
      expect(await Bun.file(join(dir, "docs/R-01/temp-kb.md")).text()).toBe("an abandoned intermediate")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("extractKnowledge completion condition (the ③ backfill / ④ dirty extension, plans/0021-commit-boundary-design.md)", () => {
  function tempDir() {
    return mkdtempSync(join(tmpdir(), "auto-knowledge-"))
  }
  // This group covers only the branches that start no session (skipped/dirty); the client is never touched.
  const client = opencodeAgent({} as OpencodeClient)
  // The knowledge-phase booking (plans/0061 R3/A7) writes .auto/stats.json,
  // so these repositories gitignore the driver's state directory like init
  // does; the clean-tree assertions below would otherwise see it as dirty.
  async function initRepo(dir: string) {
    await git(dir, "init", "-q")
    await Bun.write(join(dir, ".gitignore"), ".auto/\n")
  }
  // The phase directory established at round start is committed first (the shell commits
  // once right after the round directory is created, providing a clean baseline).
  async function committedKnowledgePhase(dir: string) {
    const phase = await knowledgePhase(dir, 1)
    await git(dir, "add", "-A")
    await git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "round start")
    return phase
  }

  test("③ this round's document already produced but not committed → backfilled, then skipped (the completion condition is the commit)", async () => {
    const dir = tempDir()
    try {
      await initRepo(dir)
      await git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
      const phase = await committedKnowledgePhase(dir)
      writeFileSync(join(dir, knowledgeFile(phase)), "round 1 migration knowledge")
      const result = await extractKnowledge(client, dir, { dir }, phase)
      expect(result).toEqual({ type: "skipped", file: "docs/R-01/P03-knowledge/kb.md" })
      expect((await git(dir, "status", "--porcelain")).trim()).toBe("")
      expect(await git(dir, "log", "-1", "--pretty=%B")).toContain("Auto-Stage: knowledge")
      // A completed distillation books knowledge-phase use (plans/0061 R3/A7).
      expect(JSON.parse(await Bun.file(join(dir, ".auto", "stats.json")).text()).roundB.digests).toEqual({ knowledgePhases: 1 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("④ document missing but the worktree has uncommitted changes → dirty (the abandoned scene goes to a human, no cleanup)", async () => {
    const dir = tempDir()
    try {
      await initRepo(dir)
      await git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
      const phase = await committedKnowledgePhase(dir)
      writeFileSync(join(dir, "src.ts"), "an abandoned artifact")
      const result = await extractKnowledge(client, dir, { dir }, phase)
      expect(result.type).toBe("dirty")
      expect((result as { files: string[] }).files).toContain("src.ts")
      expect((await git(dir, "rev-list", "--count", "HEAD")).trim()).toBe("2")
      // No completion, no knowledge-phase booking.
      expect(await Bun.file(join(dir, ".auto", "stats.json")).exists()).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("the no-commit double keeps the old committing-off semantics: an existing artifact is skipped, nothing checked or committed", async () => {
    const dir = tempDir()
    try {
      await initRepo(dir)
      await git(dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
      const phase = await committedKnowledgePhase(dir)
      writeFileSync(join(dir, knowledgeFile(phase)), "round 1 migration knowledge")
      const result = await extractKnowledge(client, dir, { dir, git: noCommitGit() }, phase)
      expect(result).toEqual({ type: "skipped", file: "docs/R-01/P03-knowledge/kb.md" })
      expect((await git(dir, "rev-list", "--count", "HEAD")).trim()).toBe("2")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
