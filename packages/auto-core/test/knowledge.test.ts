import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  digestIndexEntries,
  isKnowledgeDoc,
  priorKnowledgeDigest,
  priorKnowledgeParts,
  renderDigestIndex,
} from "../src/knowledge"
import { phaseArtifacts, syncPhaseIndex } from "../src/phases"

test("isKnowledgeDoc recognizes the knowledge phase's registry artifact", async () => {
  const dir = mkdtempSync(join(tmpdir(), "auto-knowledge-"))
  try {
    const phase = (await syncPhaseIndex(dir, 2, "amk")).find(unit => unit.type === "knowledge")!
    const artifact = phaseArtifacts(phase)[0]!.path
    expect(artifact).toBe("docs/R-02/P03-knowledge/kb.md")
    expect(isKnowledgeDoc(artifact)).toBe(true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  expect(isKnowledgeDoc("docs/R-01/P03-knowledge/kb.md")).toBe(true)
  expect(isKnowledgeDoc("docs\\R-01\\P03-knowledge\\kb.md")).toBe(true)
  expect(isKnowledgeDoc("docs/R-01/P03-implement/kb.md")).toBe(false)
  expect(isKnowledgeDoc("docs/R-01/P03-knowledge/notes.md")).toBe(false)
  expect(isKnowledgeDoc("docs/R-01/regression/3-verify-full.md")).toBe(false)
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
