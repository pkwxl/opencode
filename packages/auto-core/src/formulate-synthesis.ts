// The executor's synthesize grant re-voices evidential sources under the
// plan charter into a Sources brief and an obligations ledger. Seeded
// protocol rows precede the executor's quote-anchored rows. The composed
// sections land in the formulation todo, where the formulation collect
// checks the plan's coverage against the ledger.
import { renderPrompt } from "./prompt"
import type { PromptFacts } from "./prompt"
import type { PhaseTypeEntry } from "./phases/registry"
import { BRIEF_FILE } from "./brief"
import { ANALYSIS_DOC, roundBriefPath } from "./docpaths"

// —— the ledger grammar (D2, strict, driver-parsed) ——
//
// The section inside a formulation todo's Scope:
//
//   ## Obligations ledger
//
//   - O-01 | round.md | "error semantics preserved for the parser" | the plan's tests exercise parser error paths and record observed evidence
//   - C-01 | plan-input.md vs analysis.md | "input asks a rewrite" / "analysis settles the config layer as stable" | analysis wins (authority order); the plan records the deviation, never silent
//
// O-<nn> obligation rows: source name · verbatim quote · what the plan must
// cover. C-<nn> conflict rows: the two sources (joined " vs ") · both
// quotes · the authority order's verdict and what the plan must record. Ids
// are sequential per kind (each row one past the previous of its kind); the
// driver's seeded rows open the O sequence at 01, the session's rows continue
// past them.

export const LEDGER_HEADING = "## Obligations ledger"

// The source name of the driver-seeded protocol rows: their quotes locate in
// the composed Scope's own duties frame (the protocol line below), never in
// an evidential source.
export const LEDGER_FRAME_SOURCE = "phase duties"

export type LedgerRow = {
  kind: "O" | "C"
  n: number
  // O: the one source. C: both, joined " vs " (the parts are validated at
  // locate time).
  source: string
  // One quote for O, two for C (the "/" pair in file order).
  quotes: string[]
  // The obligation phrasing (O) or the resolution record the plan must carry (C).
  text: string
}

const O_ROW = /^- O-(\d+)\s+\|\s+(.+?)\s+\|\s+"([^"]+)"\s+\|\s+(.+)$/
const C_ROW = /^- C-(\d+)\s+\|\s+(.+?)\s+\|\s+"([^"]+)"\s+\/\s+"([^"]+)"\s+\|\s+(.+)$/

const ledgerRowId = (row: Pick<LedgerRow, "kind" | "n">): string => `${row.kind}-${String(row.n).padStart(2, "0")}`

export function renderLedgerRow(row: LedgerRow): string {
  const quotes = row.quotes.map((quote) => `"${quote}"`).join(" / ")
  return `- ${ledgerRowId(row)} | ${row.source} | ${quotes} | ${row.text}`
}

export function renderLedger(rows: readonly LedgerRow[]): string {
  return rows.map(renderLedgerRow).join("\n")
}

// Parse a ledger section body: strict row grammar, ids unique and sequential
// per kind. `from` pins the first id of each kind (the landed ledger always
// opens at O-01/C-01); omitted, the first row of each kind sets its baseline
// and only the sequence holds (a constructor session's rows continue past
// the seeded ones, after any verbatim echo of them). Only `- `-prefixed
// lines are rows — the landed section carries the DRIVER's prose (the intro
// and boundaries paragraphs) around them. A constructor reply contains
// only rows, blank lines and headings inside its ledger delimiters.
export function parseLedger(body: string, from?: { O: number; C: number }, source: "document" | "reply" = "document"): { rows: LedgerRow[]; problems: string[] } {
  const rows: LedgerRow[] = []
  const problems: string[] = []
  const seen = new Set<string>()
  let missingPrefixReported = false
  const last: Record<"O" | "C", number | undefined> = { O: from?.O ? from.O - 1 : undefined, C: from?.C ? from.C - 1 : undefined }
  body.split("\n").forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith("#")) return
    if (!line.startsWith("- ")) {
      if (source === "reply" && !missingPrefixReported) {
        problems.push(`ledger line ${i + 1} is missing the literal \`- \` prefix required on each row: ${line.slice(0, 120)}`)
        missingPrefixReported = true
      }
      return
    }
    const o = O_ROW.exec(line)
    const c = !o ? C_ROW.exec(line) : undefined
    const match = o ?? c
    if (!match) {
      problems.push(`ledger line ${i + 1} does not parse (\`- O-<nn> | <source> | "<quote>" | <obligation>\` or \`- C-<nn> | <source> vs <source> | "<quote>" / "<quote>" | <resolution>\`): ${line.slice(0, 120)}`)
      return
    }
    const kind: "O" | "C" = o ? "O" : "C"
    const n = Number(match[1])
    const id = ledgerRowId({ kind, n })
    if (seen.has(id)) problems.push(`ledger line ${i + 1}: duplicate row id ${id}`)
    seen.add(id)
    if (last[kind] !== undefined && n !== last[kind] + 1) {
      problems.push(`ledger line ${i + 1}: ${id} sits where ${ledgerRowId({ kind, n: last[kind] + 1 })} belongs (ids are sequential per kind${from ? "" : ", continuing the DRIVER's seeded rows"})`)
    }
    last[kind] = last[kind] === undefined ? n : Math.max(last[kind], n)
    rows.push({
      kind,
      n,
      source: match[2]!.trim(),
      quotes: kind === "O" ? [match[3]!] : [match[3]!, match[4]!],
      text: (kind === "O" ? match[4]! : match[5]!).trim(),
    })
  })
  return { rows, problems }
}

// The ledger section of a formulation todo's body/Scope (D7's collect and
// D8's wrap-up read it back): the text between LEDGER_HEADING and the next
// `## ` heading, undefined when the Scope carries no ledger (the floor).
export function ledgerSection(scope: string): string | undefined {
  const at = scope.indexOf(LEDGER_HEADING)
  if (at < 0) return undefined
  const rest = scope.slice(at + LEDGER_HEADING.length)
  const end = rest.indexOf("\n## ")
  return (end < 0 ? rest : rest.slice(0, end)).trim() || undefined
}

// The parsed rows of a Scope's ledger (the landed ledger always opens at
// O-01/C-01), with its problems — a Scope whose section does not parse is a
// collect problem, never silently accepted.
export function ledgerOf(scope: string): { rows: LedgerRow[]; problems: string[] } | undefined {
  const section = ledgerSection(scope)
  return section === undefined ? undefined : parseLedger(section, { O: 1, C: 1 })
}

// —— the mechanical validation (D4) ——
//
// Everything cheap and deterministic, all before anything lands: row grammar
// (parseLedger), sources among the actual input sources, every quote
// locating in its named source (the blockage-span precedent: exact first,
// then whitespace-normalized — content-tolerant, never fuzzy). The frame
// blocks need no check — verbatim by construction, that being the point of
// the frame.

export type LedgerSource = { name: string; text: string }

// The two-tier quote locate (D4.2): exact substring, then both sides
// whitespace-normalized (a session re-wrapping a long line still locates; a
// paraphrase does not).
export function quoteLocates(quote: string, text: string): boolean {
  if (text.includes(quote)) return true
  const norm = (value: string): string => value.replace(/\s+/g, " ").trim()
  return norm(text).includes(norm(quote))
}

// The problems of the constructor's rows against the actual sources: unknown
// source names, quotes that locate nowhere. The driver's seeded rows (the
// leading rows sourced from the duties frame) are never checked here — their
// quotes locate in the frame by construction.
export function sessionRowProblems(rows: readonly LedgerRow[], sources: readonly LedgerSource[]): string[] {
  const byName = new Map(sources.map((source) => [source.name, source.text]))
  const problems: string[] = []
  for (const row of rows) {
    if (row.kind === "O" && row.source === LEDGER_FRAME_SOURCE) {
      problems.push(`${ledgerRowId(row)} claims the source "${LEDGER_FRAME_SOURCE}" — the protocol rows are the DRIVER's own; a session row names an evidential source (${[...byName.keys()].join(", ") || "none"})`)
      continue
    }
    const names = row.kind === "O" ? [row.source] : row.source.split(/\s+vs\s+/)
    if (row.kind === "C" && names.length !== 2) {
      problems.push(`${ledgerRowId(row)}'s source field must be "<source A> vs <source B>" (the two conflicting sources); got: ${row.source}`)
      continue
    }
    row.quotes.forEach((quote, k) => {
      const name = names[k]!.trim()
      const text = byName.get(name)
      if (text === undefined) {
        problems.push(`${ledgerRowId(row)} names the source "${name}", which is not among this formulation's input sources (${[...byName.keys()].join(", ") || "none"})`)
        return
      }
      if (!quoteLocates(quote, text)) {
        problems.push(`${ledgerRowId(row)}'s quote does not locate in ${name}: "${quote.slice(0, 100)}"`)
      }
    })
  }
  return problems
}

// —— the driver's seeded protocol rows (D2) ——
//
// The protocol obligations every plan of this phase type carries: the
// standard artifacts, the verdict protocol where the type gates on it, the
// round report duty on a final phase. Their quotes are fragments of the
// frame's protocol line (protocolFrameText below), which the synthesized
// Scope renders verbatim — so the same locate-check applies by construction.

// The driver-owned protocol line of the synthesized duties frame: names the
// seeded rows' quotes. Pure; prompt-plan renders it into the synthesis
// shape's duties block.
export function protocolFrameText(entry: PhaseTypeEntry): string {
  const parts: string[] = []
  const phase = entry.phaseArtifacts.map((spec) => spec.path).join(", ")
  const task = entry.taskArtifacts.map((spec) => spec.path).join(", ")
  if (phase) parts.push(`this phase type's standard phase artifacts (${phase}) land in the phase directory by the plan's own tasks`)
  if (task) parts.push(`this phase type's standard task artifacts (${task}) land in each task's own docs/T-NNN/ directory`)
  if (entry.gates.includes("verdict")) {
    parts.push(`the phase's verdict gate reads the closing task's verdict document ending with the result line \`Result: PASS\` or \`Result: FAIL <reason>\``)
  }
  return parts.join("; ")
}

// The seeded rows, in ledger order (O-01 up). Each quotes a fragment of the
// protocol line.
export function seededLedgerRows(entry: PhaseTypeEntry): LedgerRow[] {
  const rows: LedgerRow[] = []
  const push = (quote: string, text: string) => rows.push({ kind: "O", n: rows.length + 1, source: LEDGER_FRAME_SOURCE, quotes: [quote], text })
  for (const spec of entry.phaseArtifacts) {
    push(spec.path, `the phase's ${spec.label} (${spec.path}) is delivered in the phase directory by the plan's own tasks`)
  }
  for (const spec of entry.taskArtifacts) {
    push(spec.path, `each task the type's duties give this artifact declares it in its own directory (docs/T-NNN/${spec.path})`)
  }
  if (entry.gates.includes("verdict")) {
    push("Result: PASS", `a closing task writes the phase's verdict document ending with the result line (a driver protocol string, verbatim)`)
  }
  return rows
}

// —— synthesis source assembly and reply validation ——

export type SynthesisSourceInputs = {
  brief?: string
  manual?: boolean
  round?: string
  roundPath: string
  analysis?: string
  humanGated: boolean
  planInput?: { path: string; text: string }
  handoverDocs?: { path: string; text: string }[]
  missingHandovers?: string[]
  prevRound?: string
  prevRoundExpected?: boolean
}

// The evidential source list (loop-plan's D3 assembly, one home): the
// project brief (named by its path), the round brief (this round's
// round.md), the approved analysis (human-gated phases), the planning
// input, each done prior phase's handover document, the prior-round
// digest — with the expected-but-absent names collected as the source
// health findings, never silence. m mode (`manual: true`) carries its
// planning input as the one source beside the brief.
export function synthesisSources(input: SynthesisSourceInputs): { sources: LedgerSource[]; missing: string[] } {
  const sources: LedgerSource[] = []
  const missing: string[] = []
  if (input.brief) sources.push({ name: BRIEF_FILE, text: input.brief })
  else missing.push(BRIEF_FILE)
  if (input.manual) {
    sources.push({ name: input.planInput!.path, text: input.planInput!.text })
  } else {
    if (input.round) sources.push({ name: input.roundPath, text: input.round })
    else missing.push(input.roundPath)
    if (input.analysis !== undefined) sources.push({ name: ANALYSIS_DOC, text: input.analysis })
    else if (input.humanGated) missing.push(ANALYSIS_DOC)
    if (input.planInput) sources.push({ name: input.planInput.path, text: input.planInput.text })
    for (const handover of input.handoverDocs ?? []) sources.push({ name: handover.path, text: handover.text })
    missing.push(...(input.missingHandovers ?? []))
    if (input.prevRound) sources.push({ name: "prior-round digest", text: input.prevRound })
    else if (input.prevRoundExpected) missing.push("prior-round digest")
  }
  return { sources, missing }
}

// The constructor's brief text: the identical formulate-synthesize prompt
// over the resolved charter, the duties, the sources and the seeded rows —
// one render home the push one-shot and the executor grant both read (the
// grant's brief IS this text, plans/0281's "identical prompt" letter).
export function synthesizePromptText(
  facts: PromptFacts,
  input: { charters: string; duties: string; sources: readonly LedgerSource[]; missing: readonly string[]; entry: PhaseTypeEntry },
): string {
  const seeded = seededLedgerRows(input.entry)
  const nextO = seeded.filter((row) => row.kind === "O").length + 1
  return renderPrompt(facts, "formulate-synthesize", {
    charters: input.charters,
    duties: input.duties,
    sources: input.sources.map((source) => `### ${source.name}\n\n${source.text}`).join("\n\n"),
    missing: input.missing.length ? input.missing.join(", ") : "(none)",
    seeded: seeded.length ? seeded.map(renderLedgerRow).join("\n") : "(none)",
    nextId: `O-${String(nextO).padStart(2, "0")}`,
    phaseType: input.entry.name,
  })
}

// One constructor reply's mechanical validation (D4, the retry loop's own
// checks stated once): the strict delimiters, the ledger grammar, the
// seeded echo accepted and dropped, the session's rows continuing the
// seeded sequence, every quote locating in its named source, and a
// non-empty brief. The caller's guarantee check rides separately (the push
// validates the candidate render, the executor composes through it).
export type SynthesisReplyCheck = { brief: string; own: LedgerRow[]; rationale: string } | { problems: string[] }

export function checkSynthesisReply(replyText: string, seeded: readonly LedgerRow[], sources: readonly LedgerSource[]): SynthesisReplyCheck {
  const parsed = parseSynthesisReply(replyText)
  if ("problems" in parsed) return { problems: parsed.problems }
  const seededText = new Set(seeded.map(renderLedgerRow))
  const { rows, problems } = parseLedger(parsed.parsed.ledgerBody, undefined, "reply")
  let echoed = 0
  while (echoed < rows.length && seededText.has(renderLedgerRow(rows[echoed]!))) echoed++
  const own = rows.slice(echoed)
  const nextO = seeded.filter((row) => row.kind === "O").length + 1
  const firstO = own.find((row) => row.kind === "O")
  const firstC = own.find((row) => row.kind === "C")
  const validation = [
    ...problems,
    ...(firstO !== undefined && firstO.n !== nextO ? [`the first O row is ${ledgerRowId(firstO)} — the session's rows continue the DRIVER's seeded sequence at O-${String(nextO).padStart(2, "0")}`] : []),
    ...(firstC !== undefined && firstC.n !== 1 ? [`the first C row is ${ledgerRowId(firstC)} — the C sequence opens at C-01`] : []),
    ...sessionRowProblems(own, sources),
  ]
  if (!own.length && !problems.length) validation.push("the ledger carries no row of the session's own — every obligation the sources name needs one")
  if (!parsed.parsed.brief.trim()) validation.push("the sources brief is empty")
  return validation.length ? { problems: validation } : { brief: parsed.parsed.brief, own, rationale: parsed.parsed.rationale }
}

// The strict output delimiters (D3): the reply carries the brief and the
// ledger between DRIVER markers, closing with one Rationale line.
type ParsedSynthesis = { brief: string; ledgerBody: string; rationale: string }

export function parseSynthesisReply(text: string): { parsed: ParsedSynthesis } | { problems: string[] } {
  const problems: string[] = []
  const brief = /<<<SOURCES-BRIEF\n([\s\S]*?)\nSOURCES-BRIEF>>>/.exec(text)
  const ledger = /<<<LEDGER\n([\s\S]*?)\nLEDGER>>>/.exec(text)
  if (!brief) problems.push("the reply carries no <<<SOURCES-BRIEF … SOURCES-BRIEF>>> block")
  if (!ledger) problems.push("the reply carries no <<<LEDGER … LEDGER>>> block")
  const rationale = [...text.matchAll(/^Rationale:[ \t]*(.+)$/gm)].at(-1)
  if (!rationale) problems.push("the reply carries no closing `Rationale: <one line>` line")
  if (problems.length || !brief || !ledger || !rationale) return { problems }
  return { parsed: { brief: brief[1]!.trim(), ledgerBody: ledger[1]!.trim(), rationale: rationale[1]!.trim() } }
}

// —— the coverage map (D7) ——
//
// The formulation session's closing write when its Scope carries a ledger:
// docs/T-NNN/coverage.md (the coverage document role), strict rows mapping
// every ledger row exactly once —
//
//   - O-01 -> T-012 (the parser error-path suite)
//   - O-02 -> deferred(this round defers DO-3 verification: blocked on the fixture infra gap)
//   - C-01 -> conflict-recorded(T-018's document records the deviation per the authority order)
//
// The driver checks totality mechanically inside the formulation collect:
// every ledger row appears exactly once, every referenced task id exists in
// the index, deferral rows carry a reason. Missing rows are named problems —
// the unit blocks with the row list (a re-run dispatches a fresh session
// over the surviving files).

type CoverageRow = { row: string; target: string; note: string }

const COVERAGE_ROW = /^- ((?:O|C)-\d+) -> (T-\d+|deferred|conflict-recorded)(?: ?\((.*)\))?$/

export function parseCoverage(text: string): { rows: CoverageRow[]; problems: string[] } {
  const rows: CoverageRow[] = []
  const problems: string[] = []
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith("#")) return
    const match = COVERAGE_ROW.exec(line)
    if (!match) {
      problems.push(`coverage line ${i + 1} does not parse (\`- <row id> -> T-NNN (<note>)\` or \`-> deferred(<reason>)\` / \`-> conflict-recorded(<note>)\`): ${line.slice(0, 120)}`)
      return
    }
    rows.push({ row: match[1]!, target: match[2]!, note: match[3] ?? "" })
  })
  return { rows, problems }
}

// The totality check (D7): the ledger rows against the coverage map's rows,
// the mapped ids against the index. Empty problems = accepted.
export function coverageProblems(
  ledger: { rows: readonly LedgerRow[]; problems: readonly string[] },
  coverageText: string,
  indexIds: readonly string[],
): string[] {
  const problems = [...ledger.problems.map((problem) => `the obligations ledger: ${problem}`)]
  if (!coverageText.trim()) {
    return [...problems, "the Scope carries an obligations ledger but the coverage map is missing or empty — map every row"]
  }
  const parsed = parseCoverage(coverageText)
  problems.push(...parsed.problems)
  const ledgerIds = new Set(ledger.rows.map(ledgerRowId))
  const known = new Set(indexIds)
  const seen = new Map<string, number>()
  parsed.rows.forEach((cover, i) => {
    if (!ledgerIds.has(cover.row)) {
      problems.push(`coverage line ${i + 1} maps ${cover.row}, which the ledger does not carry`)
      return
    }
    seen.set(cover.row, (seen.get(cover.row) ?? 0) + 1)
    if (cover.target === "deferred") {
      if (!cover.note.trim()) problems.push(`coverage line ${i + 1}: the deferral of ${cover.row} carries no reason`)
    } else if (cover.target !== "conflict-recorded") {
      if (!known.has(cover.target)) {
        problems.push(`coverage line ${i + 1} maps ${cover.row} to ${cover.target}, which the task index does not list`)
      }
    }
  })
  for (const id of ledgerIds) {
    const times = seen.get(id) ?? 0
    if (times === 0) problems.push(`ledger row ${id} is not mapped — every row appears in the coverage map exactly once`)
    else if (times > 1) problems.push(`ledger row ${id} is mapped ${times} times — every row appears exactly once`)
  }
  return problems
}

// —— the floor digest (D6) ——
//
// Idempotence keyed on the deterministic floor, never on model output: the
// hash of the floor document (the exact text construction would write, the
// placeholder id included). Recorded at construction, compared at re-entry —
// pending + digest unchanged keeps the landed todo (no churn from constructor
// nondeterminism); fresh or changed re-constructs through the full pipeline.

export function floorDigest(floorDocument: string): string {
  return new Bun.CryptoHasher("sha256").update(floorDocument).digest("hex").slice(0, 16)
}
