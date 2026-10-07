// Blockage dossier and honest block line (plans/0082 §2 D1/D2), the strict
// remediation-plan format (§4 D5) and the blockage document's shape (§5 D6):
// the pure half of the consented-remediation design. Every covered block site
// mechanically assembles a dossier before printing anything — the block map
// of the composed prompt (which block came from which file), the span
// locator's results over the block-map sources and the round's process
// documents, the state snapshot — so the block line names located files
// instead of assumed roles. The session half (the diagnosis session, the
// document commit, the interactive pick) lives in src/blockage-diagnose.ts;
// the executor in src/blockage-execute.ts; both build on this module, and
// plan.ts imports the executor only (the prelude imports no session layer).
//
// The locator is honest about limits (D2): model-written evidence may
// paraphrase; a fragment that locates nowhere simply drops the file claim.
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { changedFiles } from "./git"
import { roundDirName } from "./docpaths"

// —— the block map (D1) ——

// One block of the composed prompt: its role and its source path. The source
// string is display text ("(absent)" when the block's file does not exist),
// assembled where the prompt was composed — the driver's own composition
// state, never a guess read back out of the prompt.
export type BlockMapEntry = { block: string; source: string }

export function renderBlockMap(blocks: readonly BlockMapEntry[]): string {
  return blocks.map((entry) => `- ${entry.block} → ${entry.source}`).join("\n")
}

// —— the span locator (D2) ——

// One located fragment: file and 1-based line range, or explicitly
// unlocated. A hit is the first literal occurrence in the first source (in
// search order) that contains the fragment.
export type SpanHit = { fragment: string; file: string; lineStart: number; lineEnd: number } | { fragment: string; unlocated: true }

// The fragments worth locating: the evidence's backtick spans and
// double-quoted spans (the verifier's verdict quotes both ways), plus — for
// the render gate — the offending literals themselves. Short fragments and
// pure placeholders locate nothing but noise; the floor is 8 characters.
export function evidenceFragments(evidence: string): string[] {
  const found: string[] = []
  for (const match of evidence.matchAll(/`([^`]{8,})`|"([^"]{8,})"/g)) {
    const fragment = (match[1] ?? match[2] ?? "").trim().replace(/[.,;:]+$/, "")
    if (fragment.length >= 8) found.push(fragment)
  }
  return [...new Set(found)]
}

// Locate fragments literally over the sources (in order), then over the
// round's process documents (D1: "the block-map sources first, then the
// round's process documents"). Binary-looking and oversized files are
// skipped; a fragment that appears nowhere is reported unlocated.
export async function locateSpans(dir: string, fragments: readonly string[], sources: readonly string[]): Promise<SpanHit[]> {
  const searchPaths = [...new Set([...sources, ...(await roundProcessDocs(dir))])]
  const texts = new Map<string, string | undefined>()
  for (const rel of searchPaths) {
    if (!texts.has(rel)) texts.set(rel, await readLocatable(join(dir, rel)))
  }
  const hits: SpanHit[] = []
  for (const fragment of fragments) {
    let hit: SpanHit | undefined
    for (const [rel, text] of texts) {
      if (text === undefined) continue
      const at = text.indexOf(fragment)
      if (at < 0) continue
      const lineStart = text.slice(0, at).split("\n").length
      const lineEnd = lineStart + fragment.split("\n").length - 1
      hit = { fragment, file: rel, lineStart, lineEnd }
      break
    }
    hits.push(hit ?? { fragment, unlocated: true })
  }
  return hits
}

// A scannable source: missing, oversized (2 MB) or NUL-bearing files return
// undefined (the resolve.ts collector's discipline — markers and spans live
// in human-written text).
async function readLocatable(path: string): Promise<string | undefined> {
  const file = Bun.file(path)
  const size = await file.exists().then((ok) => (ok ? file.size : -1)).catch(() => -1)
  if (size < 0 || size > 2 * 1024 * 1024) return undefined
  const text = await file.text().catch(() => undefined)
  return text === undefined || text.includes("\x00") ? undefined : text
}

// The round's process documents (the locator's fallback tier): every file
// under docs/R-NN/ plus the task documents docs/T-NNN/, the brief and the
// materialized default pack — the surfaces a block's evidence can quote.
export async function roundProcessDocs(dir: string, round?: number): Promise<string[]> {
  const found: string[] = []
  const walk = async (rootRel: string): Promise<void> => {
    for (const entry of await readdir(join(dir, rootRel), { withFileTypes: true }).catch(() => [])) {
      const rel = join(rootRel, entry.name)
      if (entry.isDirectory()) await walk(rel)
      else if (entry.name.endsWith(".md")) found.push(rel)
    }
  }
  await walk(join("docs", roundDirName(round ?? 1)))
  for (const entry of await readdir(join(dir, "docs"), { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && /^T-\d+$/.test(entry.name)) await walk(join("docs", entry.name))
  }
  found.push(join(".opencode", "auto", "brief.md"), join(".opencode", "auto", "intents", "default.md"))
  return [...new Set(found)]
}

// —— the honest block lines (D2) ——

export function locatedSpanLines(hits: readonly SpanHit[]): string[] {
  return hits.map((hit) =>
    "unlocated" in hit
      ? `  the span "${hit.fragment}" located no file (the verdict's evidence may paraphrase — no file is named for it)`
      : `  the conflicting span is ${hit.file}:${hit.lineStart}${hit.lineEnd !== hit.lineStart ? `-${hit.lineEnd}` : ""}`,
  )
}

// The corrected block line (D2): located files, not assumed roles. The
// incident's shape — "the conflicting span is docs/R-01/P02-design/
// handover.md:139 (an earlier phase's handover). Rewrite it, or amend the
// intent — the driver never rewrites your words".
export function honestBlockLines(input: { intro: string; hits: readonly SpanHit[]; next: string }): string[] {
  return [input.intro, ...locatedSpanLines(input.hits), input.next]
}

// —— the strict remediation-plan format (D5) ——

export const REMEDIATION_CHANNELS = ["handover-edit", "planning-input", "brief-amend", "pack-amend", "task-doc-note", "advice"] as const
export type RemediationChannel = (typeof REMEDIATION_CHANNELS)[number]

export type RemediationEdit = {
  // Repository-relative path of an existing file.
  path: string
  // 1-based inclusive line range of the replaced span.
  first: number
  last: number
  // The old span's first and last lines, quoted verbatim — the executor's
  // literal-match anchors (D7: a stale document re-blocks, never overwrites).
  oldFirst: string
  oldLast: string
  // The replacement text, verbatim.
  text: string
}

export type RemediationOption = {
  id: string
  title: string
  channel: RemediationChannel
  edits: RemediationEdit[]
  advice?: string
  consequences: string
}

export type RemediationPlan =
  | { kind: "options"; analysis: string; options: RemediationOption[]; recommendation: string }
  | { kind: "escalation"; analysis: string; escalation: string }

const CHANNEL_LINE = /^Channel:\s*(\S+)\s*$/
const EDIT_LINE = /^\d+\.\s+(.+?)\s+—\s+replace lines (\d+)\s*[–-]\s*(\d+)\s+\((.+)\)\s+with:\s*$/
const CONSEQUENCES_LINE = /^Consequences:\s*(.*)$/
const ADVICE_LINE = /^Advice:\s*(.+)$/
const OPTION_HEAD = /^###\s+([A-Z])\s+(.+?)\s*$/
const RECOMMENDATION_LINE = /^Recommendation:\s*([A-Z])\s*$/

// Parse the diagnosis session's plan (the RESOLVE_FORMAT discipline: strict,
// one shape, unparsable ⇒ undefined and the caller fails closed). Rules
// (plans/0082 §4 D5): an Analysis section; then either Options with at
// least one well-formed option and a Recommendation naming one of them, or
// an Escalation section — mutually exclusive, never both. A channel other
// than `advice` carries at least one edit; `advice` carries an Advice line
// and no edits.
export function parseRemediationPlan(text: string): RemediationPlan | undefined {
  const lines = text.split("\n")
  // Slice a `## <name>` section: undefined when absent; end = the next
  // top-level heading (or EOF).
  const section = (name: string): { start: number; end: number } | undefined => {
    const start = lines.findIndex((line) => line.trim() === `## ${name}`)
    if (start < 0) return undefined
    let end = lines.length
    for (let i = start + 1; i < lines.length; i++) {
      if (/^##\s+\S/.test(lines[i]!)) {
        end = i
        break
      }
    }
    return { start, end }
  }
  const analysis = section("Analysis")
  if (analysis === undefined) return undefined
  const analysisBody = lines.slice(analysis.start + 1, analysis.end).join("\n").trim()
  if (!analysisBody) return undefined
  const options = section("Options")
  const escalation = section("Escalation")
  if (options !== undefined && escalation !== undefined) return undefined
  if (escalation !== undefined) {
    const body = lines.slice(escalation.start + 1, escalation.end).join("\n").trim()
    if (!body) return undefined
    return { kind: "escalation", analysis: analysisBody, escalation: body }
  }
  if (options === undefined) return undefined
  // Walk the Options section: option heads open options; within one, the
  // channel line, the edits (each with its verbatim replacement block), the
  // advice or consequences line; the recommendation closes the walk and must
  // name a collected option id.
  const parsed: RemediationOption[] = []
  let current: RemediationOption | undefined
  let recommendation: string | undefined
  const closeCurrent = (): string | undefined => {
    if (current === undefined) return undefined
    if (!optionComplete(current)) return `option ${current.id} is malformed`
    parsed.push(current)
    current = undefined
    return undefined
  }
  for (let i = options.start + 1; i < options.end; i++) {
    const line = lines[i]!
    const head = OPTION_HEAD.exec(line)
    if (head) {
      const problem = closeCurrent()
      if (problem) return undefined
      current = { id: head[1]!, title: head[2]!, channel: "advice", edits: [], consequences: "" }
      continue
    }
    if (current === undefined) continue // prose between options (a lead-in) is tolerated
    const channel = CHANNEL_LINE.exec(line)
    if (channel) {
      if (!(REMEDIATION_CHANNELS as readonly string[]).includes(channel[1]!)) return undefined
      current.channel = channel[1] as RemediationChannel
      continue
    }
    if (/^Edits:\s*$/.test(line)) continue
    const advice = ADVICE_LINE.exec(line)
    if (advice) {
      current.advice = advice[1]!.trim()
      continue
    }
    const edit = EDIT_LINE.exec(line)
    if (edit) {
      const anchors = splitAnchors(edit[4]!)
      if (anchors === undefined) return undefined
      const first = Number(edit[2])
      const last = Number(edit[3])
      if (!(first >= 1) || last < first) return undefined
      // The verbatim replacement block: the lines after the edit header
      // until the next structural line.
      const textLines: string[] = []
      let j = i + 1
      for (; j < options.end; j++) {
        const next = lines[j]!
        if (OPTION_HEAD.test(next) || /^##\s+\S/.test(next) || CONSEQUENCES_LINE.test(next) || RECOMMENDATION_LINE.test(next) || EDIT_LINE.test(next)) break
        textLines.push(next)
      }
      while (textLines.length && !textLines.at(-1)!.trim()) textLines.pop()
      if (!textLines.length) return undefined
      current.edits.push({ path: edit[1]!.trim(), first, last, oldFirst: anchors.first, oldLast: anchors.last, text: textLines.join("\n") })
      i = j - 1
      continue
    }
    const consequences = CONSEQUENCES_LINE.exec(line)
    if (consequences) {
      current.consequences = consequences[1]!.trim()
      continue
    }
    const rec = RECOMMENDATION_LINE.exec(line)
    if (rec) {
      const problem = closeCurrent()
      if (problem) return undefined
      recommendation = rec[1]
      // Nothing but the recommendation may follow inside the section.
      for (let k = i + 1; k < options.end; k++) {
        if (lines[k]!.trim()) return undefined
      }
      break
    }
  }
  const problem = closeCurrent()
  if (problem) return undefined
  if (recommendation === undefined) return undefined
  if (!parsed.some((option) => option.id === recommendation)) return undefined
  return { kind: "options", analysis: analysisBody, options: parsed, recommendation }
}

// The old-span anchors: `(<old first line> | <old last line>)` — split on
// the last " | " so an old first line that itself carries a pipe still
// parses (the strict format's one tolerance).
function splitAnchors(body: string): { first: string; last: string } | undefined {
  const at = body.lastIndexOf(" | ")
  if (at < 0) return undefined
  return { first: body.slice(0, at).trim(), last: body.slice(at + 3).trim() }
}

function optionComplete(option: RemediationOption): boolean {
  if (option.channel === "advice") return Boolean(option.advice) && option.edits.length === 0
  return option.edits.length > 0 && Boolean(option.consequences)
}

// Locate an edit's old span in the file's current lines — the executor's
// guard and the diagnosis-time validation share it. Four tiers, strongest
// first: exact lines at the stated position, a unique exact occurrence
// elsewhere, the same two with outer whitespace trimmed. The trimmed tiers
// are the blockage-1 lesson: a diagnosis session quotes prose content, not
// markdown indentation (an anchor failed on the two leading spaces of a
// wrapped continuation line and a person's approved Choice dead-ended).
// Position plus content is always accepted; content alone must be unique;
// nothing found, or a trimmed pair occurring more than once, is a refusal —
// a stale document re-blocks, never a blind overwrite.
export type SpanLocation = { at: number } | { stale: true } | { ambiguous: true }

export function locateEditSpan(lines: readonly string[], edit: RemediationEdit): SpanLocation {
  const width = edit.last - edit.first + 1
  const same = (a: string, b: string, trim: boolean): boolean => (trim ? a.trim() === b.trim() : a === b)
  const at = (start: number, trim: boolean): boolean =>
    start >= 0 && start + width <= lines.length && same(lines[start]!, edit.oldFirst, trim) && same(lines[start + width - 1]!, edit.oldLast, trim)
  if (at(edit.first - 1, false)) return { at: edit.first - 1 }
  const exact = occurrences(false)
  if (exact.length === 1) return { at: exact[0]! }
  if (at(edit.first - 1, true)) return { at: edit.first - 1 }
  const trimmed = occurrences(true)
  if (trimmed.length === 1) return { at: trimmed[0]! }
  return trimmed.length > 1 ? { ambiguous: true } : { stale: true }

  function occurrences(trim: boolean): number[] {
    const found: number[] = []
    for (let i = 0; i + width <= lines.length; i++) if (at(i, trim)) found.push(i)
    return found
  }
}

// —— the blockage document (D6) ——

export const CHOICE_LINE = "Choice:"
export const EXECUTED_LINE = "Executed:"

// The driver-parsed marks of one blockage document: the person's choice and
// the driver's execution record (the last of each wins, like the other
// protocol lines).
export function choiceMark(text: string): { choice: string; notes?: string } | undefined {
  let choice: string | undefined
  let notes: string | undefined
  for (const line of text.split("\n")) {
    const mark = /^Choice:\s*([A-Z])\s*(.*)$/.exec(line)
    if (mark) {
      choice = mark[1]
      notes = mark[2]!.trim() || undefined
    }
    const note = /^Notes:\s*(.+)$/.exec(line)
    if (note) {
      const value = note[1]!.trim()
      // The template's own placeholder line is not a note (the document's
      // Decision section ships with `Notes: <optional>` until answered).
      if (!/^<[^<>]*>$/.test(value)) notes = value || notes || undefined
    }
  }
  return choice === undefined ? undefined : { choice, ...(notes !== undefined ? { notes } : {}) }
}

export function executedMark(text: string): { option: string; shas: string } | undefined {
  let found: { option: string; shas: string } | undefined
  for (const line of text.split("\n")) {
    const mark = /^Executed:\s*([A-Z])\s*\((.*)\)\s*$/.exec(line)
    if (mark) found = { option: mark[1]!, shas: mark[2]!.trim() }
  }
  return found
}

// The stale-spec rejection's record (D7's continuation): a document whose
// chosen edit could not be applied carries `Rejected: <option> — …` under
// the Choice. It stops the document being pending — a rejected spec must not
// be retried every run nor shadow later documents — while the Choice itself
// stays for the record; a person who re-decides on the same document removes
// the Rejected line with their new Choice.
export function rejectedMark(text: string): boolean {
  return text.split("\n").some((line) => /^Rejected:\s*[A-Z]\b/.test(line))
}

// The document's Step field (its diagnosis-suspension key, D8): the step
// string the gate blocked, e.g. "phase-plan R-01.P03".
export function blockageStep(text: string): string | undefined {
  for (const line of text.split("\n")) {
    const field = /^-\s*Step:\s*(.+)$/.exec(line)
    if (field) return field[1]!.trim()
  }
  return undefined
}

// All of one round's blockage documents in seq order.
export async function readBlockageDocs(dir: string, round: number): Promise<Array<{ seq: number; file: string; text: string }>> {
  const root = join("docs", roundDirName(round))
  const docs: Array<{ seq: number; file: string; text: string }> = []
  for (const name of await readdir(join(dir, root), { withFileTypes: true }).catch(() => [])) {
    const seq = /^blockage-(\d+)\.md$/.exec(name.name)
    if (!seq) continue
    const file = join(root, name.name)
    const text = await Bun.file(join(dir, file)).text().catch(() => "")
    docs.push({ seq: Number(seq[1]), file, text })
  }
  return docs.sort((a, b) => a.seq - b.seq)
}

// The next document's sequence number (1 when the round holds none).
export function nextBlockageSeq(docs: readonly { seq: number }[]): number {
  return docs.reduce((max, doc) => Math.max(max, doc.seq), 0) + 1
}

// The two-consecutive-reblocks suspension (D8): when the last two blockage
// documents of one step both carried executed marks, diagnosis for that step
// suspends — repeated disagreement signals a diagnosis quality problem or a
// person who keeps approving the wrong option; either way the human reads.
export function diagnosisSuspended(docs: readonly { seq: number; text: string }[], step: string): boolean {
  const ofStep = docs.filter((doc) => blockageStep(doc.text) === step)
  const lastTwo = ofStep.slice(-2)
  return lastTwo.length === 2 && lastTwo.every((doc) => executedMark(doc.text) !== undefined)
}

// —— the dossier (D1) ——

export type BlockageDossier = {
  gate: string
  step: string
  verdict: string
  blockMap: readonly BlockMapEntry[]
  hits: readonly SpanHit[]
  state: string
}

export function renderDossier(dossier: BlockageDossier): string {
  const spans = dossier.hits.length
    ? dossier.hits
        .map((hit) =>
          "unlocated" in hit
            ? `  - "${hit.fragment}" → unlocated`
            : `  - "${hit.fragment}" → ${hit.file}:${hit.lineStart}${hit.lineEnd !== hit.lineStart ? `-${hit.lineEnd}` : ""}`,
        )
        .join("\n")
    : "  - (no quotable span in the verdict — the evidence named no literal)"
  return [
    `Gate: ${dossier.gate}`,
    `Step: ${dossier.step}`,
    `Verdict: ${dossier.verdict}`,
    "Block map (each block of the composed prompt and its source):",
    renderBlockMap(dossier.blockMap) || "  (none)",
    "Span locator (the verdict's quoted fragments, searched literally over the sources above, then the round's documents):",
    spans,
    "State snapshot:",
    dossier.state,
  ].join("\n")
}

// The state snapshot (D1): the dirty files and the round's audit tail. Read
// here so every block site assembles the same shape.
export async function dossierState(dir: string, auditTail: readonly string[]): Promise<string> {
  const dirty = await changedFiles(dir).catch(() => [] as string[])
  return [
    dirty.length ? `dirty tree: ${dirty.join(", ")}` : "dirty tree: clean",
    auditTail.length ? `audit tail:\n${auditTail.map((line) => `  ${line}`).join("\n")}` : "audit tail: (no verdicts recorded yet this round)",
  ].join("\n")
}
