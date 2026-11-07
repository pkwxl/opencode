// The record-time charter check and the clamp (plans/0082 §10 D12, §13's
// Part II): parseDefaultCheckReply's strict grammar; clampRecordedResolves
// over the ledger — a charter-consistent default passes silently, a
// charter-touching default is flagged, re-recorded (the charter-consistent
// reading in force, the wider grant the OPEN option) and carried OPEN
// through the ledger; the phase-boundary surfacing line; and a check that
// could not judge clamps fail-closed with the failure named, never a silent
// flag (plans/0208 D1). Beside them the
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
  // The marker line's own position in MARKER_FILE (line 5) — the scan's
  // `file:line` record; the clamp's locator treats it as a hint proven by
  // content (plans/0198 D2), never as authority.
  file: "docs/T-001/report.md:5",
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
      // The original wide grant is gone from the line — the clamped reading
      // is the one in force in the document, not a second line beside it.
      expect(text).not.toContain("-> yes, constants only (the spec points there)")
      // The re-recorded line still parses as a marker (the ledger's grammar).
    } finally {
      setClampCaller(undefined)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a check that could not judge clamps fail-closed with the failure named — never a silent flag (plans/0208 D1)", async () => {
    // 0165-097's clamp half: the fail-closed result was indistinguishable
    // from a real flag. The ruled direction stands (the wider grant never
    // stays in force unjudged — the item clamps to the strict reading
    // through the same path); only the silence was the defect, so the
    // surfaced line names the failure.
    const dir = await ledgerDir()
    try {
      setClampCaller(
        async () =>
          ({ kind: "failed", reading: OPEN_FALLBACK_READING, reason: "the check replied without a parsable Clamp line; its last words: I am not sure, the endpoint is overloaded." }),
      )
      const lines = await clampRecordedResolves(dir)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain("OPEN question (charter-clamped)")
      expect(lines[0]).toContain(`the default in force is "${OPEN_FALLBACK_READING}"`)
      expect(lines[0]).toContain("the check could not judge: the check replied without a parsable Clamp line")
      // The ledger and the re-record: the strict reading in force, the same
      // clampItem path a real flag takes.
      const [entry] = await resolvesOf(dir, "task", "T-001")
      expect(entry?.clamped).toBe(true)
      expect(entry?.clamp).toBe(OPEN_FALLBACK_READING)
      const text = await Bun.file(join(dir, "docs/T-001/report.md")).text()
      expect(text).toContain(`AUTO-RESOLVE: may implementers read the uapi header? -> ${OPEN_FALLBACK_READING} (`)
      expect(text).not.toContain("-> yes, constants only (the spec points there)")
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

  // —— the content-proven locator (plans/0198 D2, enacting 0165-022) ——
  //
  // The old locator took the FIRST line matching by recorded position OR by
  // a substring-equal question: a substring-matching earlier marker was
  // overwritten (its decision destroyed) while the flagged wide default
  // stayed in force, and a stale line number rewrote whatever line had
  // drifted into the slot. The rewrite now requires the grammar's own
  // parse to prove the line is exactly this item's marker.

  test("an earlier substring-question marker is never the clamp's target (0198 D2): the flagged item's own line is rewritten, the unrelated marker untouched", async () => {
    // The finding's repro shape: an unrelated narrower decision ("wire
    // format -> v1") recorded on line 5, the flagged wider default ("wire
    // format for exports -> v2 everywhere") on line 9 — the earlier line's
    // question is a substring of the flagged item's.
    const doc = [
      "# Design",
      "",
      "## Decisions",
      "",
      "AUTO-RESOLVE: wire format -> v1 (the incident's fallback)",
      "",
      "## Later",
      "",
      "AUTO-RESOLVE: wire format for exports -> v2 everywhere (speed)",
      "",
    ].join("\n")
    const dir = await mkdtemp(join(tmpdir(), "auto-clamp-"))
    try {
      await mkdir(join(dir, "docs"), { recursive: true })
      await writeFile(join(dir, "docs/design.md"), doc)
      await recordResolves(dir, [item({ question: "wire format for exports", option: "v2 everywhere", reason: "speed", file: "docs/design.md:9", task: "T-003" })])
      setClampCaller(async () => ({ kind: "flagged", reading: "v2 for exports only" }))
      const lines = await clampRecordedResolves(dir)
      expect(lines).toHaveLength(1)
      const text = await Bun.file(join(dir, "docs/design.md")).text()
      // The unrelated v1 decision stands verbatim — the substring match
      // never authorized its rewrite.
      expect(text).toContain("AUTO-RESOLVE: wire format -> v1 (the incident's fallback)")
      // The flagged item's OWN line is the one re-recorded: the clamped
      // reading in force, the wide grant gone from the line.
      expect(text).toContain("AUTO-RESOLVE: wire format for exports -> v2 for exports only (speed; charter-clamped by the driver")
      expect(text).not.toContain("-> v2 everywhere (speed)")
    } finally {
      setClampCaller(undefined)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a moved marker is found by content; a stale line number never rewrites the line now at the slot (0198 D2)", async () => {
    // The scan recorded the marker at line 4; the document has since been
    // edited above it — the marker now sits at line 7 and unrelated prose
    // occupies the recorded slot. Position alone proves nothing.
    const doc = [
      "# Report",
      "",
      "## Decisions",
      "The v0 settle kept a single attempt in the hot path.",
      "",
      "## Notes",
      "AUTO-RESOLVE: retry policy -> three attempts (the timeout incident)",
      "",
    ].join("\n")
    const dir = await mkdtemp(join(tmpdir(), "auto-clamp-"))
    try {
      await mkdir(join(dir, "docs"), { recursive: true })
      await writeFile(join(dir, "docs/report.md"), doc)
      await recordResolves(dir, [item({ question: "retry policy", option: "three attempts", reason: "the timeout incident", file: "docs/report.md:4", task: "T-005" })])
      setClampCaller(async () => ({ kind: "flagged", reading: "retry only on idempotent calls" }))
      const lines = await clampRecordedResolves(dir)
      expect(lines).toHaveLength(1)
      const text = await Bun.file(join(dir, "docs/report.md")).text()
      // The prose at the stale slot is untouched — the position hint was
      // rejected because the line is not the item's marker.
      expect(text).toContain("The v0 settle kept a single attempt in the hot path.")
      // The moved marker itself is found by content and re-recorded there.
      expect(text).toContain("AUTO-RESOLVE: retry policy -> retry only on idempotent calls (the timeout incident; charter-clamped by the driver")
      expect(text).not.toContain("-> three attempts (the timeout incident)")
    } finally {
      setClampCaller(undefined)
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an ambiguous duplicate rewrites nothing — ledger-clamped only, the OPEN line still surfaced (0198 D2)", async () => {
    // The same marker line twice in one file and the recorded position stale
    // (it names a heading, not a marker): the exact-content search finds
    // two, the match is ambiguous, and the conservative direction is no
    // rewrite (P12) — the clamp, the ledger mark and the person's ⚡ line
    // still land. (When the recorded slot itself holds an exact-content
    // marker, that line is proven and re-records even under duplication
    // elsewhere — the position hint disambiguates, the content authorizes.)
    const twice = ["# Report", "", "## Proxy-answered questions", "", "- AUTO-RESOLVE: may implementers read the uapi header? -> yes, constants only (the spec points there)", "", "- AUTO-RESOLVE: may implementers read the uapi header? -> yes, constants only (the spec points there)", ""].join("\n")
    const dir = await mkdtemp(join(tmpdir(), "auto-clamp-"))
    try {
      await mkdir(join(dir, "docs/T-001"), { recursive: true })
      await writeFile(join(dir, "docs/T-001/report.md"), twice)
      await recordResolves(dir, [item({ file: "docs/T-001/report.md:3" })])
      setClampCaller(async () => ({ kind: "flagged", reading: "no reference-header reads" }))
      const lines = await clampRecordedResolves(dir)
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain("OPEN question (charter-clamped)")
      // The ledger half stands: clamped with the reading in force.
      const [entry] = await resolvesOf(dir, "task", "T-001")
      expect(entry?.clamped).toBe(true)
      expect(entry?.clamp).toBe("no reference-header reads")
      // The document is untouched — no line was provably THE one.
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe(twice)
    } finally {
      setClampCaller(undefined)
      await rm(dir, { recursive: true, force: true })
    }
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

  test("the ⚡ clamp line names the standing-decisions surface (plans/0109 D5 re-keying)", () => {
    const item = { question: "which key ring?", clamp: "rotate on the primary only" } as ResolveItem
    const line = clampLine(item, item.clamp!)
    expect(line).toContain("⚡ OPEN question (charter-clamped): which key ring?")
    expect(line).toContain('the default in force is "rotate on the primary only"')
    expect(line).toContain("driver-helper renders the standing decisions")
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
