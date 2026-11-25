// The strict remediation-plan format (plans/0082 §4 D5) and the blockage
// document's shape (§5 D6): the pure half of the consented-remediation
// design the executor reads. The executor lives in src/blockage-execute.ts
// and builds on this module, and plan.ts imports the executor only (the
// prelude imports no session layer). The diagnosis half — the block map, the
// span locator, the honest block line, the dossier and the reblock
// suspension — and the session that assembled them retired with the push
// loop (plans/0314); the documents already on disk stay readable and
// executable here.
import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { roundDirName } from "./docpaths"

// —— the strict remediation-plan format (D5) ——

const REMEDIATION_CHANNELS = ["handover-edit", "planning-input", "brief-amend", "pack-amend", "task-doc-note", "advice"] as const
type RemediationChannel = (typeof REMEDIATION_CHANNELS)[number]

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

type RemediationPlan =
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
type SpanLocation = { at: number } | { stale: true } | { ambiguous: true }

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

// The person's region of a blockage document (plans/0170 D3, enacting
// 0165-006 / S12-02): the last `## Decision` section, bounded by
// `## Execution protocol` (or the document's end). The renderer places
// every verbatim session section (Analysis, Escalation, the options) above
// the Decision section, so the last `## Decision` heading is the document's
// own, and the marks — the person's `Choice:`/`Notes:`, the driver's
// `Executed:`/`Rejected:` — are this region's alone: a line the diagnosis
// session wrote into its verbatim text is not the person's act and never
// parses (0082 D6's own wording — "one line … written into the document's
// mark section"). A document without the section reads as un-marked (the
// conservative direction, P12: it re-blocks for the person rather than
// executing a guess).
function decisionRegion(text: string): string {
  const lines = text.split("\n")
  const at = lines.findLastIndex((line) => line.trim() === "## Decision")
  if (at < 0) return ""
  const end = lines.findIndex((line, i) => i > at && line.trim() === "## Execution protocol")
  return lines.slice(at + 1, end < 0 ? undefined : end).join("\n")
}

// The driver-parsed marks of one blockage document: the person's choice and
// the driver's execution record (the last of each wins inside the Decision
// region, like the other protocol lines).
export function choiceMark(text: string): { choice: string; notes?: string } | undefined {
  let choice: string | undefined
  let notes: string | undefined
  for (const line of decisionRegion(text).split("\n")) {
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
  for (const line of decisionRegion(text).split("\n")) {
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
  return decisionRegion(text)
    .split("\n")
    .some((line) => /^Rejected:\s*[A-Z]\b/.test(line))
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
