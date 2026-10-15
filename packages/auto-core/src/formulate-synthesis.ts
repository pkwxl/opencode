// Formulation synthesis (plans/0097 D2–D6): where the pack declares a plan
// charter for a phase (the resolved verify-plan, D1), a tool-less constructor
// session re-voices the evidential sources under the charter into a Sources
// brief and derives an obligation ledger — the enumerated, quoted list of
// what the sources demand. The ledger rides inside the formulation todo's
// Scope (D2's single-input discipline: no sidecar file); the driver seeds
// protocol rows itself (artifacts, verdict, report duty) before the session
// adds judgment rows; everything is validated mechanically (D4: grammar,
// quote anchoring, the guarantee asserts) before it lands, and any failure
// degrades loudly to the Stage-1 deterministic floor — an audit entry, never
// a silent continuation and never a blocked plan (a misbehaving constructor
// degrades quality, not the run). This module holds the pure half (grammar,
// validation, seeding, the frame's protocol line) and the one-shot session
// half; the orchestration lives in loop-plan's compose step, the totality
// check of the coverage map in the runner's formulation collect (D7).
//
// The honesty limits (stated in the template, enforced by construction): the
// ledger enumerates what the *sources* name — it cannot invent requirements
// (the fidelity pass judges that direction, D5), and the repository survey
// stays the formulation session's own first duty. The ledger carries this
// round's obligations under the charter; the charter carries the standing
// bar.
import { classifierEntry, oneShot } from "./classify"
import type { ModelEntry } from "./models-schema"
import { candidateList } from "./model-route"
import { usableAt } from "./model-window"
import { entryPassesAgentFilter } from "./select"
import { log } from "./log"
import { renderPrompt } from "./prompt"
import type { PromptFacts } from "./prompt"
import type { PhaseTypeEntry } from "./phases/registry"
import { resolvedVerifyPlan, verifyPlanCharterText } from "./intent/guarantees"
import type { RoutingFacts } from "./routing"
import { SWITCH_ENV, autoSwitches } from "./switches"
import type { AgentPool } from "./agent-pool"

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

export const ledgerRowId = (row: Pick<LedgerRow, "kind" | "n">): string => `${row.kind}-${String(row.n).padStart(2, "0")}`

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
// and boundaries paragraphs) around them; a `- ` line that does not parse is
// a named problem.
export function parseLedger(body: string, from?: { O: number; C: number }): { rows: LedgerRow[]; problems: string[] } {
  const rows: LedgerRow[] = []
  const problems: string[] = []
  const seen = new Set<string>()
  const last: Record<"O" | "C", number | undefined> = { O: from?.O ? from.O - 1 : undefined, C: from?.C ? from.C - 1 : undefined }
  body.split("\n").forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith("#") || !line.startsWith("- ")) return
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
export function protocolFrameText(entry: PhaseTypeEntry, finalPhase: boolean, reportFile?: string): string {
  const parts: string[] = []
  const phase = entry.phaseArtifacts.map((spec) => spec.path).join(", ")
  const task = entry.taskArtifacts.map((spec) => spec.path).join(", ")
  if (phase) parts.push(`this phase type's standard phase artifacts (${phase}) land in the phase directory by the plan's own tasks`)
  if (task) parts.push(`this phase type's standard task artifacts (${task}) land in each task's own docs/T-NNN/ directory`)
  if (entry.gates.includes("verdict")) {
    parts.push(`the phase's verdict gate reads the closing task's verdict document ending with the result line \`Result: PASS\` or \`Result: FAIL <reason>\``)
  }
  if (finalPhase) {
    parts.push(`the round report duty: the plan ends with the wrap-up task titled "Round user report" whose deliverable is ${reportFile ?? "docs/R-NN/report-for-user.md"}`)
  }
  return parts.join("; ")
}

// The seeded rows, in ledger order (O-01 up). Each quotes a fragment of the
// protocol line; finalPhase/reportFile as in protocolFrameText.
export function seededLedgerRows(entry: PhaseTypeEntry, finalPhase: boolean, reportFile?: string): LedgerRow[] {
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
  if (finalPhase) {
    push("Round user report", `the plan ends with the wrap-up task titled "Round user report" delivering the round report (${reportFile ?? "docs/R-NN/report-for-user.md"})`)
  }
  return rows
}

// —— the constructor session (D3) ——
//
// Tool-less one-shot (the oneShot primitive, bare by construction —
// read-only, no worktree pollution, no session commit; the driver owns every
// write and commit, the blockage-diagnose pattern) at the planning role's
// route (deep tier — it is planning work and the ledger is load-bearing).
// Bounded: one feedback retry, then the degradation ladder (D4).

const SYNTH_TITLE = "auto: formulation synthesis"
const SYNTH_TIMEOUT_MS = 300_000

// The first usable entry of the planning role's route (the classifierEntry
// discipline over the phase-plan candidate list: the agent filter, the
// windows, the down marks and the key rings apply; the context cap does not
// — the entry list already encodes fitness).
function planRouteEntry(routing: RoutingFacts, entry: PhaseTypeEntry | undefined, now: number): { name: string; entry: ModelEntry } | undefined {
  const list = candidateList(routing.registry, entry, "phase-plan")
  for (const name of list.names) {
    const model = routing.registry.models.get(name)
    if (model === undefined) continue
    if (!entryPassesAgentFilter(routing.registry, routing.agentFilter, model)) continue
    if (!usableAt(model, routing.registry.tz, now)) continue
    if (routing.router.isModelDown(name, now)) continue
    if (model.provider !== undefined && !routing.router.ringHasUsableKey(model.provider, now)) continue
    return { name, entry: model }
  }
  return undefined
}

// The strict output delimiters (D3): the reply carries the brief and the
// ledger between DRIVER markers, closing with one Rationale line.
export type ParsedSynthesis = { brief: string; ledgerBody: string; rationale: string }

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

// One constructor outcome: ok carries the validated brief and the merged rows
// (seeded first) plus the audit line bodies (D6 — the caller writes and
// commits them); fallback carries the reason and its FALLBACK audit line;
// off means the enhancement is deliberately not in force this run (switch
// off, or no resolved charter — the plain floor, a log line, no audit).
export type SynthesisOutcome =
  | { kind: "ok"; brief: string; rows: LedgerRow[]; rationale: string; audit: string[] }
  | { kind: "fallback"; reason: string; audit: string[] }
  | { kind: "off"; reason: string }

export type SynthesisInput = {
  pool: AgentPool
  routing: RoutingFacts | undefined
  facts: PromptFacts
  // The phase key of the charter resolution (undefined in m mode).
  phaseKey: string | undefined
  // The phase type entry (the route and the seeded rows); the implicit
  // implement entry in m mode.
  entry: PhaseTypeEntry
  phaseStep: string
  finalPhase: boolean
  reportFile?: string
  sources: readonly LedgerSource[]
  // The expected-but-absent source names (the source-health finding, D6).
  missing: readonly string[]
  // The pre-rendered duties paragraph (the frame's own duties text).
  duties: string
  // The composed-Scope guarantee check (D4.3): the caller renders the
  // candidate todo (frame + this brief + these rows) and reports violation
  // texts back — an assert miss is a retry cause here, never exit 2.
  validate?: (brief: string, rows: readonly LedgerRow[]) => string[]
}

export async function synthesizeFormulation(input: SynthesisInput): Promise<SynthesisOutcome> {
  const stamp = () => new Date().toISOString()
  const charterKeys = [
    ...(resolvedVerifyPlan(input.facts.pack).global !== undefined ? ["verify-plan"] : []),
    ...(input.phaseKey !== undefined && resolvedVerifyPlan(input.facts.pack, input.phaseKey).phase !== undefined ? [`verify-plan-${input.phaseKey}`] : []),
  ]
  const seeded = seededLedgerRows(input.entry, input.finalPhase, input.reportFile)
  let lastFidelityAudit: string | undefined
  const fallback = (reason: string, ...before: readonly string[]): SynthesisOutcome => ({
    kind: "fallback",
    reason,
    audit: [...before, `- ${stamp()} formulation ${input.phaseStep} synthesis: FALLBACK — ${reason}`],
  })
  const charter = verifyPlanCharterText(resolvedVerifyPlan(input.facts.pack, input.phaseKey))
  if (charter === undefined) return { kind: "off", reason: "no resolved plan charter — the deterministic floor" }
  if (!autoSwitches().synthesis) {
    return { kind: "off", reason: `${SWITCH_ENV.synthesis}=off — the deterministic floor is forced; the charter still rides the Acceptance and the verifier` }
  }
  if (input.routing === undefined) {
    return fallback("no model registry routing — no planning-route entry to run the constructor on (the charter still rides the Acceptance and the verifier)")
  }
  const now = input.routing.clock.now()
  const pick = planRouteEntry(input.routing, input.entry, now)
  if (pick === undefined) {
    return fallback("no usable planning-route entry (the registry names none, or none is up) — the charter still rides the Acceptance and the verifier")
  }
  const client = await input.pool.client(pick.entry.agent)
  const nextO = seeded.filter((row) => row.kind === "O").length + 1
  const text = renderPrompt(input.facts, "formulate-synthesize", {
    charters: charter,
    duties: input.duties,
    sources: input.sources.map((source) => `### ${source.name}\n\n${source.text}`).join("\n\n"),
    missing: input.missing.length ? input.missing.join(", ") : "(none)",
    seeded: seeded.length ? seeded.map(renderLedgerRow).join("\n") : "(none)",
    nextId: `O-${String(nextO).padStart(2, "0")}`,
    phaseType: input.entry.name,
  })
  let feedback = ""
  for (let attempt = 1; attempt <= 2; attempt++) {
    const outcome = await oneShot(
      client,
      pick.entry,
      feedback ? `${text}\n\n---\nYour last reply failed the DRIVER's mechanical checks:\n${feedback}\nRe-write the reply in the exact prescribed shape, fixing exactly these findings.` : text,
      SYNTH_TIMEOUT_MS,
      SYNTH_TITLE,
    )
    if (outcome.kind === "timeout") {
      feedback = `the constructor gave no reply within ${Math.round(SYNTH_TIMEOUT_MS / 1000)} s`
      continue
    }
    if (outcome.kind === "failed") {
      feedback = `the constructor session failed: ${outcome.error.message ?? "session error"}`
      continue
    }
    const parsed = parseSynthesisReply(outcome.text)
    if ("problems" in parsed) {
      feedback = parsed.problems.join("; ")
      continue
    }
    // A verbatim echo of the seeded head rows is accepted and dropped (the
    // instruction says never repeat them; an echo costs nothing). The
    // session's own rows must then continue past the seeds.
    const seededText = new Set(seeded.map(renderLedgerRow))
    const { rows, problems } = parseLedger(parsed.parsed.ledgerBody)
    let echoed = 0
    while (echoed < rows.length && seededText.has(renderLedgerRow(rows[echoed]!))) echoed++
    const own = rows.slice(echoed)
    const firstO = own.find((row) => row.kind === "O")
    const firstC = own.find((row) => row.kind === "C")
    const validation = [
      ...problems,
      ...(firstO !== undefined && firstO.n !== nextO ? [`the first O row is ${ledgerRowId(firstO)} — the session's rows continue the DRIVER's seeded sequence at O-${String(nextO).padStart(2, "0")}`] : []),
      ...(firstC !== undefined && firstC.n !== 1 ? [`the first C row is ${ledgerRowId(firstC)} — the C sequence opens at C-01`] : []),
      ...sessionRowProblems(own, input.sources),
    ]
    if (!own.length) validation.push("the ledger carries no row of the session's own — every obligation the sources name needs one")
    if (!parsed.parsed.brief.trim()) validation.push("the sources brief is empty")
    const composed = [...seeded, ...own]
    validation.push(...(input.validate?.(parsed.parsed.brief, composed) ?? []))
    if (validation.length) {
      feedback = validation.join("; ")
      continue
    }
    // The fidelity pass (D5): the relevance judgment over the mechanically
    // valid reply — a fail's evidence is this loop's feedback (the constructor
    // retry re-voices under it), past the retry the D4 ladder. A skipped
    // check is loud (its audit line) and proceeds.
    const fidelity = await fidelityPass(input.pool, input.routing, input.facts, { sources: input.sources, brief: parsed.parsed.brief, rows: composed })
    const fidelityAudit =
      fidelity.kind === "pass"
        ? `- ${stamp()} formulation ${input.phaseStep} fidelity: pass`
        : fidelity.kind === "skipped"
          ? `- ${stamp()} formulation ${input.phaseStep} fidelity: SKIPPED — ${fidelity.reason}`
          : `- ${stamp()} formulation ${input.phaseStep} fidelity: FAIL — ${fidelity.evidence}`
    if (fidelity.kind === "fail") {
      feedback = `the fidelity check failed: ${fidelity.evidence} — re-voice so every real demand of the sources becomes an honest row`
      lastFidelityAudit = fidelityAudit
      continue
    }
    log(`✓ formulation synthesis: the constructor ${pick.name} re-voiced ${input.sources.length} source(s) into the brief and ${own.length} ledger row(s) beside the ${seeded.length} seeded protocol row(s)${fidelity.kind === "pass" ? ", the fidelity pass judging nothing dropped or weakened" : ""}`)
    return {
      kind: "ok",
      brief: parsed.parsed.brief,
      rows: composed,
      rationale: parsed.parsed.rationale,
      audit: [
        `- ${stamp()} formulation ${input.phaseStep} synthesis: charters [${charterKeys.join(", ")}] on ${pick.name} — ${parsed.parsed.rationale}${input.missing.length ? ` — source health: ${input.missing.join(", ")} absent` : ""}`,
        fidelityAudit,
      ],
    }
  }
  return fallback(
    `${feedback} (after one retry — the floor carries the charter on the Acceptance, the verifier and the wrap-up)`,
    ...(lastFidelityAudit ? [lastFidelityAudit] : []),
  )
}

// —— the fidelity pass (D5) ——
//
// A second cheap one-shot (the verifyPlanPrompt shape: the registry's
// classifier entry, tools denied, strict last-line verdict, one retry for a
// parsable line): given the sources and the constructor's brief + ledger as
// data, judge that nothing load-bearing was dropped, nothing invented, no
// obligation weakened. Anchoring is already mechanical (D4.2), so this is
// the relevance judgment — did any real demand of the sources fail to become
// a row? The evidence of a fail becomes the constructor retry's feedback;
// past that, the D4 ladder (fallback to the floor). A check that cannot run
// (no classifier entry) or cannot answer (unparsable after its retry) is a
// loud skip — recorded, never silent, never a block: the mechanical
// anchoring still holds, only the relevance judgment is absent.

const FIDELITY_TITLE = "auto: formulation fidelity check"
const FIDELITY_TIMEOUT_MS = 120_000

// The strict reply parser (the parseVerifyReply discipline): the last line
// that parses wins. `Fidelity: pass` | `Fidelity: fail — <evidence>`.
export function parseFidelityReply(text: string): { pass: boolean; evidence?: string } | undefined {
  for (const raw of text.split("\n").reverse()) {
    const line = raw.trim().replace(/^`+|`+$/g, "")
    const match = /^Fidelity:\s*(pass|fail)\b\s*(.*)$/i.exec(line)
    if (!match) continue
    const pass = match[1]!.toLowerCase() === "pass"
    const rest = match[2]!.replace(/^[—–-]\s*/, "").trim()
    return { pass, ...(!pass && rest ? { evidence: rest } : {}) }
  }
  return undefined
}

export type FidelityOutcome =
  | { kind: "pass" }
  | { kind: "fail"; evidence: string }
  | { kind: "skipped"; reason: string }

// One fidelity check over the constructor's output, on the registry's
// classifier entry (the verifyPlanPrompt precedent — a cheap judge, not a
// second planner): no usable entry is a loud skip, never a block.
async function fidelityPass(
  pool: AgentPool,
  routing: RoutingFacts,
  facts: PromptFacts,
  input: { sources: readonly LedgerSource[]; brief: string; rows: readonly LedgerRow[] },
): Promise<FidelityOutcome> {
  const pick = classifierEntry(routing.router, routing.registry, routing.agentFilter, routing.clock.now())
  if (pick === undefined) {
    return { kind: "skipped", reason: "no usable classifier entry — the relevance judgment cannot run (the mechanical anchoring still holds)" }
  }
  const client = await pool.client(pick.entry.agent)
  const text = renderPrompt(facts, "formulate-fidelity", {
    sources: input.sources.map((source) => `### ${source.name}\n\n${source.text}`).join("\n\n"),
    brief: input.brief,
    ledger: renderLedger(input.rows),
  })
  let lastReason = "the fidelity check produced no answer"
  for (let attempt = 1; attempt <= 2; attempt++) {
    const outcome = await oneShot(client, pick.entry, text, FIDELITY_TIMEOUT_MS, FIDELITY_TITLE)
    if (outcome.kind === "timeout") {
      lastReason = `the fidelity check gave no verdict within ${Math.round(FIDELITY_TIMEOUT_MS / 1000)} s`
      continue
    }
    if (outcome.kind === "failed") {
      lastReason = `the fidelity check failed: ${outcome.error.message ?? "session error"}`
      continue
    }
    const verdict = parseFidelityReply(outcome.text)
    if (verdict === undefined) {
      lastReason = `the fidelity check replied without a parsable Fidelity line; its last words: ${outcome.text.trim().split("\n").slice(-3).join(" ⏎ ").slice(0, 400)}`
      continue
    }
    if (verdict.pass) return { kind: "pass" }
    return { kind: "fail", evidence: verdict.evidence ?? "a demand of the sources is dropped or weakened (the check named no span)" }
  }
  return { kind: "skipped", reason: `${lastReason} (after one retry — the mechanical anchoring still holds; only the relevance judgment is absent)` }
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

export type CoverageRow = { row: string; target: string; note: string }

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
