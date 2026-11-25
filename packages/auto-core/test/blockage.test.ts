// The 0082 blockage machinery's pure surface, the executor's half (plans/0082
// §13): the strict remediation-plan parser (option/edit grammar, mutually
// exclusive sections), the edit-span locator the executor's guard reads, the
// blockage document's marks — plus the D13 collect lint extracted into
// document/roles.ts. The diagnosis half (the dossier's span locator and
// block line, the reblock suspension, the mode brief and the diagnosis
// prompt) retired with its session (plans/0314).
import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  choiceMark,
  executedMark,
  parseRemediationPlan,
  readBlockageDocs,
  locateEditSpan,
  rejectedMark,
} from "../src/blockage"
import { constraintPitfallResolves } from "../src/document/roles"
import { parseResolveLine } from "../src/resolve"

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

// —— the blockage document's marks (D6) ——

describe("locateEditSpan (the executor's guard)", () => {
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
  test("a Rejected line in the Decision region marks the document; its absence does not", () => {
    expect(rejectedMark("## Decision\n\nChoice: A\nRejected: A — the span went stale")).toBe(true)
    expect(rejectedMark("## Decision\n\nChoice: A\nExecuted: A (sha)")).toBe(false)
  })
})

describe("the Decision region (plans/0170 D3 — verdict-surface provenance, 0165-006/S12-02)", () => {
  const doc = (decision: string, analysis = "") =>
    [
      "# Blockage 1: plan-verify (phase-plan R-01.P01)",
      "",
      "- Step: phase-plan R-01.P01",
      "",
      "## Analysis",
      "",
      analysis,
      "",
      "## Decision",
      "",
      decision,
      "",
      "## Execution protocol",
      "",
      "1. The next `run`/`plan` executes an un-executed `Choice:` mark mechanically.",
      "",
    ].join("\n")

  test("a session's Choice line in the Analysis is not the person's; the Decision region's is", () => {
    // The confirmed exploit: the diagnosis session's verbatim analysis
    // carries `Choice: A is the obvious fix here.` — with the whole-text
    // scan this parsed as the person's and the executor consumed it while
    // the Decision section still showed the unanswered placeholder.
    expect(choiceMark(doc("Choice: <one option letter>\nNotes: <optional>", "Choice: A is the obvious fix here."))).toBeUndefined()
    expect(choiceMark(doc("Choice: <one option letter>\nNotes: <optional>\nChoice: B", "Choice: A is the obvious fix here."))).toEqual({ choice: "B" })
  })

  test("the mirrors never drop a pending document: Executed/Rejected lines in the Analysis are session text", () => {
    const pending = doc("Choice: A", "Executed: A (deadbeef)\nRejected: A — the span went stale")
    expect(choiceMark(pending)).toEqual({ choice: "A" })
    expect(executedMark(pending)).toBeUndefined()
    expect(rejectedMark(pending)).toBe(false)
  })

  test("a document without a Decision section reads as un-marked (the conservative direction: it re-blocks, never executes a guess)", () => {
    expect(choiceMark("# Blockage 1\n\nChoice: A\n")).toBeUndefined()
    expect(executedMark("Executed: A (sha)\n")).toBeUndefined()
    expect(rejectedMark("Rejected: A — x\n")).toBe(false)
  })
})

describe("the blockage document's marks (plans/0082 §5 D6)", () => {
  test("the person's Choice mark: the last line wins, the template's placeholders are not notes", () => {
    const doc = "## Decision\n\nChoice: <one option letter>\nNotes: <optional>\n\nChoice: A\n"
    expect(choiceMark(doc)).toEqual({ choice: "A" })
    expect(choiceMark("## Decision\n\nChoice: <one option letter>\n")).toBeUndefined()
    expect(choiceMark("no marks")).toBeUndefined()
  })

  test("the driver's Executed mark", () => {
    expect(executedMark("## Decision\n\nExecuted: A (abc1234, def5678)")).toEqual({ option: "A", shas: "abc1234, def5678" })
    expect(executedMark("## Decision\n\nExecuted: B (no commits — advice recorded)")).toMatchObject({ option: "B" })
    expect(executedMark("nothing yet")).toBeUndefined()
  })

  test("the round's documents read in seq order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-blockage-docs-"))
    try {
      await mkdir(join(dir, "docs/R-01"), { recursive: true })
      await writeFile(join(dir, "docs/R-01/blockage-2.md"), "- Step: s\n")
      await writeFile(join(dir, "docs/R-01/blockage-10.md"), "- Step: s\n")
      const docs = await readBlockageDocs(dir, 1)
      expect(docs.map((doc) => doc.seq)).toEqual([2, 10])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
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
