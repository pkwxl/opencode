// The regression lane (plans/0098): the two-level pass's complete tier —
// round-scoped receipts, the coverage predicate (the carry-forward rule read
// at phase scope), the background slot, the phase-close hold and the strict
// test-readiness. Stage B's pure half lives here: the receipt home, the role,
// the coverage predicate over real repositories.
import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { latestRegressionSeq, regressionReceiptDoc } from "../src/docpaths"
import { ROLE_POLICIES, roleOf } from "../src/document/roles"
import { parseLaneReceipt, type TestLane } from "../src/intent/test-lanes"
import { newestGreenReceipt, regressionCovered, regressionLanes, roundNumberOf } from "../src/regression"
import { EOF_MARK } from "../src/doccheck"
import { freshRepo, git } from "./fixtures/runner"

const lane: TestLane = { name: "verify-full", command: "bash test/verify_full.sh", cost: "regression", surfaces: ["src/", "include/"], exclusive: true }

// A driver-shaped receipt on disk, the writeLaneReceipt fields verbatim.
const receiptText = (heads: string, verdict: "green" | "red", end: string): string =>
  ["# Lane verify-full", "", `Lane: verify-full`, `Heads: .=${heads}`, `Start: ${end}`, `End: ${end}`, `Verdict: ${verdict}`, `Log: /tmp/opencode/r1.log`, "", EOF_MARK, ""].join("\n")

const writeReceipt = (dir: string, seq: number, text: string) => {
  const rel = regressionReceiptDoc(1, seq, lane.name)
  mkdirSync(join(dir, join(rel, "..")), { recursive: true })
  writeFileSync(join(dir, rel), text)
  return rel
}

describe("the regression receipt home (plans/0098 D2)", () => {
  test("the path constructor and the seq scan", async () => {
    expect(regressionReceiptDoc(1, 3, "verify-full")).toBe(join("docs", "R-01", "regression", "3-verify-full.md"))
    const dir = mkdtempSync(join(tmpdir(), "auto-regression-"))
    try {
      expect(await latestRegressionSeq(dir, 1)).toBe(0)
      writeReceipt(dir, 2, receiptText("abc123", "green", "2026-10-15T10:00:00Z"))
      writeReceipt(dir, 11, receiptText("abc123", "green", "2026-10-15T11:00:00Z"))
      expect(await latestRegressionSeq(dir, 1)).toBe(11)
      // Another round's directory is not this round's counter.
      expect(await latestRegressionSeq(dir, 2)).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("the role: driver-written round-level evidence, eof-scanned, P1-exempt", () => {
    expect(roleOf(join("docs", "R-01", "regression", "3-verify-full.md"))).toBe("regression")
    expect(roleOf(join("docs", "R-01", "regression", "notes.md"))).toBe("artifact")
    expect(roleOf(join("docs", "T-003", "regression", "3-verify-full.md"))).toBe("artifact")
    expect(ROLE_POLICIES.regression).toEqual({ eofScan: true, process: true })
  })

  test("parseLaneReceipt reads the round receipts' machine fields unchanged", () => {
    expect(parseLaneReceipt(receiptText("deadbeef99", "green", "2026-10-15T10:00:00Z"))).toEqual({
      lane: "verify-full",
      heads: [{ root: ".", sha: "deadbeef99" }],
      verdict: "green",
      end: "2026-10-15T10:00:00Z",
    })
  })

  test("roundNumberOf parses the phase unit's round name; regressionLanes keeps the floor undefined", () => {
    expect(roundNumberOf({ round: "R-01" })).toBe(1)
    expect(roundNumberOf({ round: "R-12" })).toBe(12)
    expect(regressionLanes(undefined)).toBeUndefined()
    expect(regressionLanes([{ name: "lint", command: "x", cost: "cheap", surfaces: ["src/"], exclusive: false }])).toBeUndefined()
    expect(regressionLanes([lane, { name: "lint", command: "x", cost: "cheap", surfaces: ["src/"], exclusive: false }])).toEqual([lane])
  })
})

describe("the coverage predicate (regressionCovered — the complete-pass rule, plans/0098 D3)", () => {
  test("no receipt, a red receipt, or a headless one never cover (the fail-safe direction)", async () => {
    const dir = await freshRepo()
    try {
      writeFileSync(join(dir, "src.ts"), "// baseline\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "--allow-empty", "-qm", "init")
      expect((await regressionCovered(dir, 1, lane)).covered).toBe(false)
      const head = (await git(dir, "rev-parse", "HEAD")).trim()
      writeReceipt(dir, 1, receiptText(head, "red", "2026-10-15T10:00:00Z"))
      expect((await regressionCovered(dir, 1, lane)).covered).toBe(false)
      expect((await newestGreenReceipt(dir, 1, lane.name))).toBeUndefined()
      writeReceipt(dir, 2, ["# Lane verify-full", "", "Lane: verify-full", "Heads: ", "Verdict: green", "", EOF_MARK, ""].join("\n"))
      expect((await regressionCovered(dir, 1, lane)).covered).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a green receipt at the current HEADs covers; a later change on its surfaces uncovers with the diff as the attribution basis", async () => {
    const dir = await freshRepo()
    try {
      mkdirSync(join(dir, "src"), { recursive: true })
      writeFileSync(join(dir, "src", "a.ts"), "a\n")
      mkdirSync(join(dir, "docs"), { recursive: true })
      writeFileSync(join(dir, "docs", "note.md"), "note\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "--allow-empty", "-qm", "init")
      const head = (await git(dir, "rev-parse", "HEAD")).trim()
      writeReceipt(dir, 1, receiptText(head, "green", "2026-10-15T10:00:00Z"))
      expect(await regressionCovered(dir, 1, lane)).toEqual({ covered: true, receipt: await newestGreenReceipt(dir, 1, lane.name) })
      // A newer green receipt wins by its End time; an older stale one does
      // not shadow it.
      writeReceipt(dir, 2, receiptText(head, "green", "2026-10-15T12:00:00Z"))
      expect((await newestGreenReceipt(dir, 1, lane.name))?.end).toBe("2026-10-15T12:00:00Z")
      // A change off the lane's surfaces keeps it covered (docs only).
      writeFileSync(join(dir, "docs", "note.md"), "changed\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "--allow-empty", "-qm", "doc change")
      expect((await regressionCovered(dir, 1, lane)).covered).toBe(true)
      // A change on its surfaces uncovers it, the diff named (the receipts
      // themselves ride the diff once committed — off-surfaces, harmless).
      writeFileSync(join(dir, "src", "a.ts"), "a changed\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "--allow-empty", "-qm", "source change")
      const uncovered = await regressionCovered(dir, 1, lane)
      expect(uncovered.covered).toBe(false)
      expect(uncovered.changed).toContain(join("src", "a.ts"))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
