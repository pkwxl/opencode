// Formulation reads knowledge documents committed by earlier rounds (0283).
// The start clean gate also recognizes knowledge-phase artifacts by path.

import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { formatTokens } from "./log"
import { renderTemplate } from "./template"
import { currentRound, phaseHandoverDoc, readPhases, roundKnowledgeDocs, roundRoot } from "./phases"
import { estimateTokens } from "./usage"

// The start clean gate classifies leftover paths before it has a phase unit.
// The knowledge phase's registry artifact pins this spelling in the test.
export function isKnowledgeDoc(rel: string): boolean {
  return /^docs\/R-\d+\/P\d{2,}-knowledge\/kb\.md$/.test(rel.replaceAll("\\", "/"))
}

// Per-file prior-knowledge parts (the digest's sources): past rounds'
// non-empty docs/R-*/prior-kb.md, sorted by path. The digest joins them into
// one text; the capped index form lists them per file.
export async function priorKnowledgeParts(dir: string): Promise<Array<{ file: string; text: string }>> {
  const files: string[] = []
  for (const entry of await readdir(join(dir, "docs"), { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && /^R-\d+$/.test(entry.name)) files.push(join("docs", entry.name, "prior-kb.md"))
  }
  const parts: Array<{ file: string; text: string }> = []
  for (const file of files.sort()) {
    const text = (await Bun.file(join(dir, file)).text().catch(() => "")).trim()
    if (text) parts.push({ file, text })
  }
  return parts
}

// The formulation's prior-knowledge digest joins the non-empty round
// documents in path order.
export async function priorKnowledgeDigest(dir: string): Promise<string | undefined> {
  const parts = await priorKnowledgeParts(dir)
  return parts.length ? parts.map((part) => `### ${part.file}\n\n${part.text}`).join("\n\n") : undefined
}

// —— The digest cap's index form (plans/0061 R3/A7) ——

// One document of the index form: its repository-relative path and estimated
// token size (the same token estimate the usage source uses).
type DigestIndexEntry = {
  file: string
  tokens: number
}

// The documents the injected digest would carry, one entry each: the
// prior-knowledge documents (priorKnowledgeParts — every round's non-empty
// prior-kb.md), the previous round's
// final handover (the last done phase's handover.md) and its knowledge
// documents (the knowledge phase directories' kb.md). Assembled here from
// the phases module's exports because the full digest's selection rules
// live in prevRoundDigest there; this mirrors them for the index (empty
// files never count, same as the digest).
export async function digestIndexEntries(dir: string): Promise<DigestIndexEntry[]> {
  const entries: DigestIndexEntry[] = []
  for (const part of await priorKnowledgeParts(dir)) entries.push({ file: part.file, tokens: estimateTokens(part.text) })
  const prev = (await currentRound(dir)) - 1
  const root = prev >= 1 ? await roundRoot(dir, prev) : undefined
  if (root) {
    const state = await readPhases(dir, prev).catch(() => undefined)
    const last = state?.phases.filter((unit) => state.done.has(unit.id)).at(-1)
    const files = [...(last ? [phaseHandoverDoc(last)] : []), ...(await roundKnowledgeDocs(dir, prev))]
    for (const file of files) {
      const text = (await Bun.file(join(dir, file)).text().catch(() => "")).trim()
      if (text) entries.push({ file, tokens: estimateTokens(text) })
    }
  }
  return entries
}

// The capped digest's rendered index form: what fills the planning prompt's
// prevRound slot when the joined digest exceeds the cap — the path and size
// of each knowledge document and handover, and one line asking the session to
// open what it needs (the template digest-index.md carries the text).
export function renderDigestIndex(entries: readonly DigestIndexEntry[], figures: { total: number; cap: number }): string {
  return renderTemplate("digest-index", {
    total: formatTokens(figures.total),
    cap: formatTokens(figures.cap),
    index: entries.map((entry) => `- ${entry.file} (~${formatTokens(entry.tokens)} tokens)`).join("\n"),
  })
}
