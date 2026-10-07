// The record-time charter check and the clamp (plans/0082 §10 D12, §13's
// Part II): parseDefaultCheckReply's strict grammar; clampRecordedResolves
// over the ledger — a charter-consistent default passes silently, a
// charter-touching default is flagged, re-recorded (the charter-consistent
// reading in force, the wider grant the OPEN option) and carried OPEN
// through the ledger; the phase-boundary surfacing line. Beside them the
// Part II template pins: the shipped cleanroom charter's boundary sentence
// (a golden for the bundle's verify-plan text, D11), the plan-verify
// template's OPEN-judging rule and its location enumeration naming
// handovers (D14c/d — the mechanical halves; the reply parser pins both
// directions), and the admission warn's record shape (D14b).
import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clampLine, clampMarkerLine, clampRecordedResolves, clampedItemsOf, setClampCaller } from "../src/charter-clamp"
import { OPEN_FALLBACK_READING, parseDefaultCheckReply } from "../src/prompt-verify"
import { parseVerifyReply } from "../src/prompt-verify"
import { parseResolveLine, recordResolves, resolvesOf, type ResolveItem } from "../src/resolve"
import { materializeIntentBundle, parseIntentBundle, resolveIntentBundle } from "../src/bundle"
import { renderPrompt } from "../src/prompt"
import { packSubsection } from "../src/intent/load"
import { promptFacts } from "../src/prompt-facts"

// —— the strict reply parser ——

describe("parseDefaultCheckReply (plans/0082 §10 D12)", () => {
  test("`Clamp: none` passes; `Clamp: <reading>` flags with the reading; the last line that parses wins", () => {
    expect(parseDefaultCheckReply("some prose\n\nClamp: none")).toEqual({ clamp: false })
    expect(parseDefaultCheckReply("Clamp: constants come only from the restated ABI")).toEqual({ clamp: true, reading: "constants come only from the restated ABI" })
    expect(parseDefaultCheckReply("Clamp: none\n\nClamp: no reference-header reads")).toEqual({ clamp: true, reading: "no reference-header reads" })
    expect(parseDefaultCheckReply("no protocol line at all")).toBeUndefined()
    expect(parseDefaultCheckReply("Clamp:")).toBeUndefined()
  })
})

// —— the clamp over the ledger ——

const item = (over: Partial<ResolveItem> = {}): ResolveItem => ({
  at: 1,
  task: "T-001",
  phase: "R-01.P02",
  round: 1,
  source: "agent",
  question: "may implementers read the uapi header?",
  option: "yes, constants only",
  reason: "the spec points there",
  file: "docs/T-001/report.md:4",
  ...over,
})

const MARKER_FILE = ["# Report", "", "## Proxy-answered questions", "", "- AUTO-RESOLVE: may implementers read the uapi header? -> yes, constants only (the spec points there)", ""].join("\n")

async function ledgerDir(marker = MARKER_FILE): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "auto-clamp-"))
  await mkdir(join(dir, "docs/T-001"), { recursive: true })
  await writeFile(join(dir, "docs/T-001/report.md"), marker)
  await recordResolves(dir, [item()])
  return dir
}

describe("clampRecordedResolves (plans/0082 §10 D12, the agent-fake check)", () => {
  test("a charter-consistent default passes silently: checked, nothing re-recorded, nothing surfaced", async () => {
    const dir = await ledgerDir()
    try {
      let asked = 0
      setClampCaller(async (input) => {
        asked++
        expect(input.text).toContain("may implementers read the uapi header?")
        return { kind: "consistent" }
      })
      expect(await clampRecordedResolves(dir)).toEqual([])
      expect(asked).toBe(1)
      const [entry] = await resolvesOf(dir, "task", "T-001")
      expect(entry?.checked).toBe(true)
      expect(entry?.clamped).toBeUndefined()
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe(MARKER_FILE)
    } finally {
      setClampCaller(undefined)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a charter-touching default is flagged: the marker re-recorded with the charter-consistent reading in force, the wider grant OPEN, the ledger carried OPEN", async () => {
    const dir = await ledgerDir()
    try {
      setClampCaller(async () => ({ kind: "flagged", reading: "no reference-header reads; constants from the restated ABI" }))
      const lines = await clampRecordedResolves(dir)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain("OPEN question (charter-clamped)")
      expect(lines[0]).toContain("may implementers read the uapi header?")
      // The ledger: clamped with the reading in force.
      const [entry] = await resolvesOf(dir, "task", "T-001")
      expect(entry?.clamped).toBe(true)
      expect(entry?.clamp).toBe("no reference-header reads; constants from the restated ABI")
      expect(await clampedItemsOf(dir, "phase", "R-01.P02")).toHaveLength(1)
      // The re-record (D12): the marker line itself now carries the clamped
      // default, the wider grant riding as the OPEN option.
      const text = await Bun.file(join(dir, "docs/T-001/report.md")).text()
      expect(text).toContain("AUTO-RESOLVE: may implementers read the uapi header? -> no reference-header reads; constants from the restated ABI (the spec points there; charter-clamped by the driver, 0082 D12")
      expect(text).toContain('the wider grant "yes, constants only" is OPEN until the person rules')
      // The re-recorded line still parses as a marker (the ledger's grammar).
    } finally {
      setClampCaller(undefined)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("without a caller the clamp is inert — the setter-injection floor (no run, no check)", async () => {
    const dir = await ledgerDir()
    try {
      setClampCaller(undefined)
      expect(await clampRecordedResolves(dir)).toEqual([])
      const [entry] = await resolvesOf(dir, "task", "T-001")
      expect(entry?.checked).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a marker in a deliverable/code file clamps in the ledger only — no mechanical edit of code comments", async () => {
    const dir = await ledgerDir()
    try {
      await recordResolves(dir, [item({ question: "read the header from code?", file: "src/main.ts:12", task: "T-002" })])
      setClampCaller(async (input) => (input.text.includes("read the header from code?") ? { kind: "flagged", reading: OPEN_FALLBACK_READING } : { kind: "consistent" }))
      const lines = await clampRecordedResolves(dir)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain("read the header from code?")
      const [entry] = await resolvesOf(dir, "task", "T-002")
      expect(entry?.clamped).toBe(true)
    } finally {
      setClampCaller(undefined)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the pure lines: the re-recorded marker and the surfacing line", () => {
    const reRecorded = clampMarkerLine(item(), "no reference-header reads")!
    // The re-recorded line still parses as the ledger's marker grammar.
    expect(parseResolveLine(reRecorded)?.question).toBe("may implementers read the uapi header?")
    expect(clampLine(item(), "no reference-header reads")).toContain("the default in force is \"no reference-header reads\"")
    expect(clampMarkerLine(item({ question: "" }), "x")).toBeUndefined()
  })
})

// —— Part II template pins (D11's golden, D14c/d's mechanical halves) ——

describe("Part II template pins (plans/0082 §10 D11 / D14c-d)", () => {
  test("the shipped cleanroom charter's boundary sentence (D11): the wall defined in the authority itself, monotonic", async () => {
    // Materialize the bundle the way a stamped project holds it, then read
    // the pack through the loader (the same surface the verifier reads).
    const bundle = parseIntentBundle((await resolveIntentBundle("cleanroom"))!)
    const dir = await mkdtemp(join(tmpdir(), "auto-d11-"))
    try {
      await materializeIntentBundle(dir, bundle)
      const charter = promptFacts({ dir, intent: "cleanroom" }).pack
      const verifyPlan = (packSubsection(charter, "guarantees", "verify-plan") ?? "").replace(/\s+/g, " ")
      expect(verifyPlan).toContain("The reference implementation is everything under the location the brief names, its published interface headers included")
      expect(verifyPlan).toContain("their content reaches clean-room sessions only through the specification notes' restatement")
      expect(verifyPlan).toContain("Walls and permissions live in this charter alone, and a lower document may narrow them, never widen them — widening is the person's ruling, carried as an open question until given")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the plan-verify template's judging rule (D14d): an OPEN default is a deference, the same grant settled is not; the verdict line's enumeration names handovers (D14c)", () => {
    const text = renderPrompt(promptFacts(), "plan-verify", { charter: "CHARTER-TEXT", prompt: "PROMPT-TEXT", step: "phase-plan R-01.P03" })
    expect(text).toContain("A grant presented as an open question awaiting the person's ruling — marked OPEN or AUTO-RESOLVE, carried as a decision, not a constraint — is a deference, not an override: judge it consistent")
    expect(text).toContain("The same grant presented as settled instruction or constraint is not")
    expect(text).toContain("(in the <planning input / brief / phase duties / mode notes / handovers>)")
    expect(text).toContain("CHARTER-TEXT")
    expect(text).toContain("PROMPT-TEXT")
    expect(text).not.toMatch(/\{\{|\}\}/)
  })

  test("the reply parser pins both directions (the OPEN deference and the settled contradiction are verdicts the driver parses)", () => {
    const open = parseVerifyReply('Consistent: yes')
    expect(open).toEqual({ consistent: true })
    const settled = parseVerifyReply('Consistent: no — the charter\'s "never access" contradicts the prompt\'s "may be read by grep" (in the handovers)')
    expect(settled).toEqual({ consistent: false, evidence: 'the charter\'s "never access" contradicts the prompt\'s "may be read by grep" (in the handovers)' })
    expect(parseVerifyReply("garbage")).toBeUndefined()
  })

  test("the round report's needs-attention charter lists un-Choice'd blockage documents (§7)", async () => {
    const { reportCharter } = await import("../src/round-report")
    const charter = reportCharter("docs/R-01/report-for-user.md")
    expect(charter).toContain("un-Choice'd blockage documents (docs/R-NN/blockage-<seq>.md")
    expect(charter).toContain("awaiting your one `Choice:` line")
  })

  test("the default-check template carries the charter and the text under review with its Clamp protocol", () => {
    const text = renderPrompt(promptFacts(), "default-check", { charter: "CHARTER-TEXT", label: "the recorded default of T-001", text: "DEFAULT-TEXT" })
    expect(text).toContain("CHARTER-TEXT")
    expect(text).toContain("DEFAULT-TEXT")
    expect(text).toContain("the recorded default of T-001")
    expect(text).toContain("Clamp: none")
    expect(text).not.toMatch(/\{\{|\}\}/)
  })
})
