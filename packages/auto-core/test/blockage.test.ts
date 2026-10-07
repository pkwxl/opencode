// The 0082 blockage machinery's pure surface (plans/0082 §13): the span
// locator (located / unlocated / paraphrased-evidence cases), the corrected
// block line's file naming (a golden for the incident), the strict
// remediation-plan parser (option/edit grammar, mutually exclusive
// sections), the blockage document's marks and the two-consecutive-reblocks
// suspension — plus the two new templates' protocol anchors and the D13
// collect lint extracted into document/roles.ts.
import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  choiceMark,
  diagnosisSuspended,
  evidenceFragments,
  executedMark,
  blockageStep,
  honestBlockLines,
  locateSpans,
  nextBlockageSeq,
  parseRemediationPlan,
  readBlockageDocs,
  locateEditSpan,
  rejectedMark,
} from "../src/blockage"
import { constraintPitfallResolves } from "../src/document/roles"
import { parseResolveLine } from "../src/resolve"
import { renderModeBrief } from "../src/blockage-diagnose"
import { renderPrompt } from "../src/prompt"
import { promptFacts } from "../src/prompt-facts"

// —— the span locator (D2) ——

describe("the span locator (plans/0082 §2 D2)", () => {
  test("located: the evidence's quoted fragment names its block-map source as file:line", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-locate-"))
    try {
      await mkdir(join(dir, "docs/R-01/P02-design"), { recursive: true })
      await writeFile(
        join(dir, "docs/R-01/P02-design/handover.md"),
        "## Constraints and pitfalls\n\n- unrelated line one\n- uapi ABI-constant carve-out (AUTO-RESOLVE, T-011 §6.3): include/uapi/linux/ext4.h may be read by grep/extract for constants only\n- unrelated line two\n",
      )
      const hits = await locateSpans(dir, ["may be read by grep/extract for constants only"], ["docs/R-01/P02-design/handover.md"])
      expect(hits).toEqual([{ fragment: "may be read by grep/extract for constants only", file: "docs/R-01/P02-design/handover.md", lineStart: 4, lineEnd: 4 }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("unlocated: a fragment that appears nowhere is reported as unlocated, no file claimed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-locate-"))
    try {
      const hits = await locateSpans(dir, ["a paraphrase the model wrote that no file contains"], [])
      expect(hits).toEqual([{ fragment: "a paraphrase the model wrote that no file contains", unlocated: true }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("paraphrased evidence: the backtick span locates, the surrounding wording does not — the map keeps only the truth", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-locate-"))
    try {
      await mkdir(join(dir, "docs/R-01"), { recursive: true })
      await writeFile(join(dir, "docs/R-01/round.md"), "the wall is strict\n")
      const hits = await locateSpans(dir, ["the wall is `strict` about reads"], ["docs/R-01/round.md"])
      expect(hits).toEqual([{ fragment: "the wall is `strict` about reads", unlocated: true }])
      // The fragment the evidence quoted verbatim (the backtick span alone)
      // is what locates:
      const exact = await locateSpans(dir, ["the wall is strict"], ["docs/R-01/round.md"])
      expect(exact[0]).toMatchObject({ file: "docs/R-01/round.md", lineStart: 1 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the locator is honest about limits: short fragments are not searched (noise floor)", () => {
    // Every quoted/backticked span of 8+ characters is a candidate — both
    // quote styles feed the locator, deduplicated in order.
    expect(evidenceFragments('the charter\'s "never read" contradicts the prompt\'s "`may be read by grep`"')).toEqual([
      "never read",
      "`may be read by grep`",
    ])
    expect(evidenceFragments("no quotes at all")).toEqual([])
    expect(evidenceFragments('the "tiny" one')).toEqual([])
  })
})

// —— the corrected block line (D2): a golden for the incident ——

describe("the honest block line (plans/0082 §2 D2, the incident's golden)", () => {
  test("the incident's block: the line names the located handover, not the assumed planning input", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-block-line-"))
    try {
      await mkdir(join(dir, "docs/R-01/P02-design"), { recursive: true })
      await writeFile(
        join(dir, "docs/R-01/P02-design/handover.md"),
        [
          "# Handover",
          "",
          "## Constraints and pitfalls",
          "",
          "137 filler lines keep the span at 139",
          ...Array.from({ length: 133 }, (_, i) => `filler ${i}`),
          "uapi ABI-constant carve-out (AUTO-RESOLVE, T-011 §6.3): `include/uapi/linux/ext4.h may be read by grep/extract for constants only`",
          "",
        ].join("\n"),
      )
      const evidence =
        'the charter\'s "its sessions never access, search for, reconstruct, infer or request the reference implementation" contradicts the prompt\'s "`include/uapi/linux/ext4.h may be read by grep/extract for constants only`" (in the planning input)'
      const fragments = evidenceFragments(evidence)
      const hits = await locateSpans(dir, fragments, [])
      // The charter quote locates nowhere under docs/ (it lives in the pack,
      // not a process document); the carve-out locates the handover — the
      // verdict's "(in the planning input)" was the model's guess.
      const charterHit = hits.find((hit) => hit.fragment.includes("never access"))
      expect(charterHit && "unlocated" in charterHit).toBe(true)
      const lines = honestBlockLines({
        intro: `⏸ plan verification found the phase-plan R-01.P03 prompt inconsistent with the intent charter: ${evidence}`,
        hits,
        next: "  rewrite the located file, or amend the intent — the driver never rewrites your words",
      })
      expect(lines.some((line) => line.includes("the conflicting span is docs/R-01/P02-design/handover.md:139"))).toBe(true)
      expect(lines.some((line) => line.includes("located no file"))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// —— the strict remediation-plan parser (D5) ——

const PLAN = (channel: string) => [
  "## Analysis",
  "",
  "The handover's carve-out launders a provisional default into a constraint.",
  "",
  "## Options",
  "",
  "### A Tighten the handover",
  `Channel: ${channel}`,
  "Edits:",
  "1. docs/R-01/P02-design/handover.md — replace lines 139–139 (uapi ABI-constant carve-out (AUTO-RESOLVE, T-011 §6.3): include/uapi/linux/ext4.h may be read by grep/extract for constants only | uapi ABI-constant carve-out (AUTO-RESOLVE, T-011 §6.3): include/uapi/linux/ext4.h may be read by grep/extract for constants only) with:",
  "constants come from the restated ABI in the spec notes; no reference-header reads",
  "Consequences: the wall is strict; nothing else changes",
  "### B Amend the pack",
  "Channel: advice",
  "Advice: opencode-auto plan <dir> --append -p <text>",
  "Consequences: the person rules",
  "Recommendation: A",
].join("\n")

describe("parseRemediationPlan (plans/0082 §4 D5, the RESOLVE_FORMAT discipline)", () => {
  test("a parsable plan: analysis, options with edits and advice, a recommendation naming one", () => {
    const parsed = parseRemediationPlan(PLAN("handover-edit"))!
    expect(parsed.kind).toBe("options")
    if (parsed.kind !== "options") return
    const plan = parsed
    expect(plan.analysis).toContain("launder")
    expect(plan.options).toHaveLength(2)
    const a = plan.options[0]!
    expect(a).toMatchObject({ id: "A", title: "Tighten the handover", channel: "handover-edit", consequences: "the wall is strict; nothing else changes" })
    expect(a.edits).toHaveLength(1)
    expect(a.edits[0]).toMatchObject({ path: "docs/R-01/P02-design/handover.md", first: 139, last: 139 })
    expect(a.edits[0]!.oldFirst).toContain("may be read by grep/extract for constants only")
    expect(a.edits[0]!.text).toBe("constants come from the restated ABI in the spec notes; no reference-header reads")
    expect(plan.options[1]).toMatchObject({ id: "B", channel: "advice" })
    expect(plan.options[1]!.advice).toContain("opencode-auto plan")
    expect(plan.recommendation).toBe("A")
  })

  test("mutually exclusive sections: Options and Escalation together never parse", () => {
    const both = `${PLAN("advice")}\n## Escalation\n\nNo safe edit exists.\n`
    expect(parseRemediationPlan(both)).toBeUndefined()
  })

  test("an Escalation outcome parses on its own — a first-class result, not a failure", () => {
    const plan = parseRemediationPlan("## Analysis\n\nA tool defect.\n\n## Escalation\n\nThis is a tool defect: the verifier's model cannot read the charter. No safe edit exists.\n")!
    expect(plan).toMatchObject({ kind: "escalation", analysis: "A tool defect." })
    expect(plan.kind === "escalation" && plan.escalation).toContain("No safe edit exists")
  })

  test("the unparsable shapes fail closed: missing analysis, edit-less option, unknown channel, dangling recommendation, missing anchors", () => {
    expect(parseRemediationPlan("## Options\n\n### A x\nChannel: advice\nAdvice: run it\nRecommendation: A")).toBeUndefined() // no analysis
    expect(parseRemediationPlan("## Analysis\n\nx\n\n## Options\n\n### A x\nChannel: handover-edit\nConsequences: y\nRecommendation: A")).toBeUndefined() // edit-less non-advice option
    expect(parseRemediationPlan("## Analysis\n\nx\n\n## Options\n\n### A x\nChannel: magic\nEdits:\n1. p — replace lines 1–1 (a | b) with:\nt\nConsequences: y\nRecommendation: A")).toBeUndefined() // unknown channel
    expect(parseRemediationPlan("## Analysis\n\nx\n\n## Options\n\n### A x\nChannel: advice\nAdvice: r\nRecommendation: B")).toBeUndefined() // recommendation names no option
    expect(parseRemediationPlan("## Analysis\n\nx\n\n## Options\n\n### A x\nChannel: handover-edit\nEdits:\n1. p — replace lines 1–1 with:\nt\nConsequences: y\nRecommendation: A")).toBeUndefined() // anchors missing
    expect(parseRemediationPlan("## Analysis\n\nx\n\n## Options\n\n### A x\nChannel: handover-edit\nEdits:\n1. p — replace lines 2–1 (a | b) with:\nt\nConsequences: y\nRecommendation: A")).toBeUndefined() // inverted range
    expect(parseRemediationPlan("")).toBeUndefined()
  })
})

// —— the blockage document's marks and the caps (D6/D8) ——

describe("locateEditSpan (the executor's guard and the diagnosis-time validation share it)", () => {
  const edit = (over: Partial<{ first: number; last: number; oldFirst: string; oldLast: string }>) => ({
    path: "docs/R-01/P02-design/handover.md",
    first: over.first ?? 5,
    last: over.last ?? 6,
    oldFirst: over.oldFirst ?? "the first line",
    oldLast: over.oldLast ?? "the last line",
    text: "replacement",
  })

  test("exact at the stated position wins", () => {
    const lines = ["a", "b", "c", "d", "the first line", "the last line", "e"]
    expect(locateEditSpan(lines, edit({}))).toEqual({ at: 4 })
  })

  test("a shifted exact pair relocates by its single occurrence", () => {
    const lines = ["x", "x", "the first line", "the last line"]
    expect(locateEditSpan(lines, edit({}))).toEqual({ at: 2 })
  })

  test("the blockage-1 incident: an anchor quoted without its leading indent matches trimmed at the position", () => {
    const lines = ["a", "b", "c", "d", "the first line", "  the last line", "e"]
    expect(locateEditSpan(lines, edit({}))).toEqual({ at: 4 })
  })

  test("an indented pair quoted clean relocates by its single trimmed occurrence", () => {
    const lines = ["  the first line", "  the last line"]
    expect(locateEditSpan(lines, edit({ first: 1, last: 2 }))).toEqual({ at: 0 })
  })

  test("a trimmed pair occurring more than once away from the stated position is ambiguous; a pair occurring nowhere is stale", () => {
    expect(locateEditSpan(["y", "z", "  the first line", "  the last line", "q", "  the first line", "  the last line"], edit({ first: 1, last: 2 }))).toEqual({ ambiguous: true })
    expect(locateEditSpan(["nothing", "matches"], edit({}))).toEqual({ stale: true })
  })
})

describe("rejectedMark (the stale rejection's record, D7's continuation)", () => {
  test("a Rejected line under a Choice marks the document; its absence does not", () => {
    expect(rejectedMark("Choice: A\nRejected: A — the span went stale")).toBe(true)
    expect(rejectedMark("Choice: A\nExecuted: A (sha)")).toBe(false)
  })
})

describe("the blockage document's marks and the caps (plans/0082 §5 D6 / D8)", () => {
  test("the person's Choice mark: the last line wins, the template's placeholders are not notes", () => {
    const doc = "## Decision\n\nChoice: <one option letter>\nNotes: <optional>\n\nChoice: A\n"
    expect(choiceMark(doc)).toEqual({ choice: "A" })
    expect(choiceMark("## Decision\n\nChoice: <one option letter>\n")).toBeUndefined()
    expect(choiceMark("no marks")).toBeUndefined()
  })

  test("the driver's Executed mark and the Step field (the suspension's key)", () => {
    expect(executedMark("Executed: A (abc1234, def5678)")).toEqual({ option: "A", shas: "abc1234, def5678" })
    expect(executedMark("Executed: B (no commits — advice recorded)")).toMatchObject({ option: "B" })
    expect(executedMark("nothing yet")).toBeUndefined()
    expect(blockageStep("- Step: phase-plan R-01.P03")).toBe("phase-plan R-01.P03")
  })

  test("the round's documents read in seq order; the next seq is max + 1", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-blockage-docs-"))
    try {
      await mkdir(join(dir, "docs/R-01"), { recursive: true })
      await writeFile(join(dir, "docs/R-01/blockage-2.md"), "- Step: s\n")
      await writeFile(join(dir, "docs/R-01/blockage-10.md"), "- Step: s\n")
      const docs = await readBlockageDocs(dir, 1)
      expect(docs.map((doc) => doc.seq)).toEqual([2, 10])
      expect(nextBlockageSeq(docs)).toBe(11)
      expect(nextBlockageSeq([])).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the two-consecutive-reblocks suspension (D8): the last two executed documents of one step suspend; another step's or an unanswered one does not", () => {
    const doc = (step: string, executed: boolean) => ({ seq: 0, text: `- Step: ${step}\n\n${executed ? "Executed: A (sha)" : ""}` })
    expect(diagnosisSuspended([doc("s", true), doc("s", true)], "s")).toBe(true)
    expect(diagnosisSuspended([doc("s", true), doc("s", true), doc("s", false)], "s")).toBe(false)
    expect(diagnosisSuspended([doc("s", true), doc("other", true)], "s")).toBe(false)
    expect(diagnosisSuspended([doc("s", true)], "s")).toBe(false)
    expect(diagnosisSuspended([doc("s", false), doc("s", true)], "s")).toBe(false)
  })
})

// —— the templates (D3/D4): anchors and renders ——

describe("the 0082 templates (_mode-brief, diagnose)", () => {
  test("the mode brief renders the ownership table, the channels and the invariants (D3)", () => {
    const brief = renderModeBrief()
    expect(brief).toContain("## Surfaces and ownership")
    expect(brief).toContain("Driver-exclusive state")
    expect(brief).toContain("## Remediation channels")
    expect(brief).toContain("planning-input")
    expect(brief).toContain("only the gate re-running clears it")
    expect(brief).not.toMatch(/\{\{|\}\}/)
  })

  test("the diagnosis prompt carries the mode brief, the dossier and the strict format; its read-only charter line is the discipline (D4)", () => {
    const prompt = renderPrompt(promptFacts(), "diagnose", {
      modeBrief: renderModeBrief(),
      dossier: "Gate: plan-verify\nStep: phase-plan R-01.P03\nDOSSIER-BODY",
      pointers: "docs/R-01",
    })
    expect(prompt).toContain("You are the blockage diagnosis session")
    expect(prompt).toContain("Propose only: you never edit any file")
    expect(prompt).toContain("DOSSIER-BODY")
    expect(prompt).toContain("## Surfaces and ownership")
    expect(prompt).toContain("### A <title>")
    expect(prompt).toContain("## Escalation")
    expect(prompt).toContain("Recommendation: A")
    expect(prompt).not.toMatch(/\{\{|\}\}/)
  })
})

// —— the D13 collect lint (document/roles.ts) ——

describe("the handover collect lint (plans/0082 §10 D13)", () => {
  const handover = (section: string, line: string) =>
    ["# Handover", "", "## Key decisions", "", "- settled decision", "", "## Constraints and pitfalls", "", ...(section === "constraints" ? [line] : []), "", "## Required reading for the next phase", "", "- nothing", "", "## Artifact index", "", "- none", ...(section === "key" ? ["", line] : [])].join("\n")

  test("an AUTO-RESOLVE marker under Constraints and pitfalls is a collect problem naming the line", () => {
    const marker = "AUTO-RESOLVE: may implementers read the header? -> yes, constants only (narrow)"
    expect(constraintPitfallResolves(handover("constraints", `- ${marker}`))).toMatch(/line \d+ carries an AUTO-RESOLVE marker/)
    // The marker grammar agrees with resolve.ts's parser (the pin the roles
    // module's comment promises):
    expect(parseResolveLine(marker)?.question).toBe("may implementers read the header?")
  })

  test("the same marker under Key decisions is clean — OPEN belongs there (D13's other half)", () => {
    const marker = "AUTO-RESOLVE: may implementers read the header? -> yes, constants only (narrow) — OPEN"
    expect(constraintPitfallResolves(handover("key", `- ${marker}`))).toBeUndefined()
    expect(constraintPitfallResolves(handover("constraints", "- a plain settled constraint"))).toBeUndefined()
  })
})
