// The knowledge documents' read halves: the paths, the completion marks and
// the digest readers the planning sessions and the formulation assembly
// consume. The extraction sessions themselves — the k phase's one-shot
// distiller and the round's prior-knowledge extraction — are retired
// (plans/0283, confirming 0277's residual): no session writes these
// documents anymore; what earlier rounds committed stays the durable record
// the digests read (P18).

import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { priorKnowledgeDoc, roundDirName } from "./docpaths"
import { PRIOR_KB_DONE } from "./document/roles"
import { parsePhaseDir } from "./document/unit"
import { formatTokens } from "./log"
import { renderTemplate } from "./template"
import { currentRound, phaseArtifacts, phaseHandoverDoc, readPhases, roundKnowledgeDocs, roundRoot, type PhaseUnit } from "./phases"
import { estimateTokens } from "./usage"

// Output path: the knowledge phase's standard artifact (registry phaseArtifacts,
// kb.md inside the phase directory).
export function knowledgeFile(phase: PhaseUnit): string {
  return phaseArtifacts(phase)[0]!.path
}

// The path-shape recognizer of that artifact (plans/0236 D5, 0165-078): the
// start clean gate names an interrupted knowledge write by its family —
// knowledgeFile needs a PhaseUnit, the gate holds only dirty paths. Spelled
// from the registry's own knowledge entry (type id "knowledge", artifact
// "kb.md", phases/registry.ts) and pinned beside it in test; the knowledge
// phase's directory is the only one whose standard artifact is kb.md.
export function isKnowledgeDoc(rel: string): boolean {
  return /^docs\/R-\d+\/P\d{2,}-knowledge\/kb\.md$/.test(rel.replaceAll("\\", "/"))
}

// Idempotence check: a non-empty knowledge document for this phase means
// already extracted. Once the phase is done the extraction hook does not fire
// anyway (routePhase routes incomplete phases only).
export async function existingKnowledge(dir: string, phase: PhaseUnit): Promise<string | undefined> {
  const file = knowledgeFile(phase)
  if (!(await Bun.file(join(dir, file)).text().catch(() => "")).trim()) return undefined
  return file
}

// —— Prior-knowledge extraction (specialized secondary migration tool, docs/specialized-tool-design.md §3) ——

// Output path: the fixed in-round name docs/R-NN/prior-kb.md — a new round's
// round directory is always empty, so prior knowledge must be re-distilled;
// kept separate from the k-phase knowledge document, each side's idempotence
// check recognizing only this round's artifact.
export function priorKnowledgeFile(round: number): string {
  return priorKnowledgeDoc(round)
}

// Idempotence check: this round's prior-kb.md non-empty means already extracted.
export async function existingPriorKnowledge(dir: string, round: number): Promise<string | undefined> {
  const file = priorKnowledgeDoc(round)
  return (await Bun.file(join(dir, file)).text().catch(() => "")).trim() ? file : undefined
}

// The list of already distilled artifacts (extractPriorKnowledge's
// by-reference input): the conclusive documents distilled so far — migration
// knowledge (kb.md of past rounds' knowledge phase directories), phase
// handovers (handover.md of past rounds' phase directories) and past rounds'
// prior knowledge (past rounds' docs/R-*/prior-kb.md, this round's excluded).
// When the list is non-empty the extraction session is required to reference,
// not restate, already covered knowledge points (the reference targets are
// reachable in the same context: priorKnowledgeDigest and prevRoundDigest
// inject the full texts). Missing directories or only empty files → empty
// array (the template's conditional section disappears, behavior same as full
// distillation).
export async function existingDistilledDocs(dir: string, round: number): Promise<string[]> {
  const found = new Set<string>()
  // Round-specific directories: past rounds' docs/R-*/ prior knowledge, the
  // handovers of each phase directory, and the knowledge phase documents.
  for (const entry of await readdir(join(dir, "docs"), { withFileTypes: true }).catch(() => [])) {
    const number = /^R-(\d+)$/.exec(entry.name)
    if (!entry.isDirectory() || !number) continue
    const root = join("docs", entry.name)
    const files = await roundKnowledgeDocs(dir, Number(number[1]))
    if (entry.name !== roundDirName(round)) files.push(join(root, "prior-kb.md"))
    for (const phase of await readdir(join(dir, root), { withFileTypes: true }).catch(() => [])) {
      if (phase.isDirectory() && parsePhaseDir(phase.name)) files.push(join(root, phase.name, "handover.md"))
    }
    for (const file of files) {
      if ((await Bun.file(join(dir, file)).text().catch(() => "")).trim()) found.add(file)
    }
  }
  return [...found].sort()
}

// Closing-mark check (pure, exported for tests): the document is non-empty and
// its last non-empty line is exactly PRIOR_KB_DONE — the AI's explicit
// declaration that the work is finished; the prompt forbids writing it before
// every section is written.
export function priorKnowledgeComplete(text: string): boolean {
  const trimmed = text.trimEnd()
  if (!trimmed) return false
  return trimmed.split("\n").pop()!.trim() === PRIOR_KB_DONE
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

// Prior-knowledge digest (injected into this round's first phase planning
// session and the parameter-inference session): past rounds' prior knowledge
// concatenated in full, sorted by path — the non-empty documents among past
// rounds' docs/R-*/prior-kb.md (cross-round cumulative injection). No artifact
// → undefined.
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
// prior-kb.md, the freshly distilled one included), the previous round's
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
