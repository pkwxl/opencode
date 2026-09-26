import { readdir, rename, rm } from "node:fs/promises"
import { join } from "node:path"
import { priorKnowledgeDoc, roundDirName, tempPriorKnowledgeDoc } from "./docpaths"
import { PRIOR_KB_DONE } from "./document/roles"
import { parsePhaseDir } from "./document/unit"
import { changedFiles, commitPending, commitTree } from "./git"
import { log } from "./log"
import { currentRound, phaseArtifacts, roundKnowledgeDocs, type PhaseUnit } from "./phases"
import { renderKnowledge, renderPriorKnowledge } from "./prompt"
import type { ClientSource, Opts, UnitStop } from "./opts"
import { requireArtifact } from "./artifact"
import { afterSession } from "./unit-commit"

// The k (knowledge distillation) phase claims the whole --extract-knowledge
// design (plans/0002-fixme-knowledge-design.md §D + plans/0006-phases-design.md
// P4): after each phase completes, a one-shot bypass session distills the
// finally verified migration experience into a structured knowledge document.
// The output is the phase type's standard artifact inside the knowledge phase
// directory docs/R-NN/P<nn>-knowledge/kb.md (M3.3, plans/0047 §5), never moved
// once settled. Extraction failure does not pollute the exit code — a blocked
// session or two failures to produce merely return failed; the caller prints a
// ⚠ warning and proceeds with the phase handover as usual (migration success is
// not reversely polluted by document-generation failure).

// Output path: the knowledge phase's standard artifact (registry phaseArtifacts,
// kb.md inside the phase directory).
export function knowledgeFile(phase: PhaseUnit): string {
  return phaseArtifacts(phase)[0]!.path
}

// Idempotence check: a non-empty knowledge document for this phase means
// already extracted. Once the phase is done the extraction hook does not fire
// anyway (routePhase routes incomplete phases only).
export async function existingKnowledge(dir: string, phase: PhaseUnit): Promise<string | undefined> {
  const file = knowledgeFile(phase)
  return (await Bun.file(join(dir, file)).text().catch(() => "")).trim() ? file : undefined
}

// Knowledge extraction orchestration (mirrors the requireArtifact skeleton of
// final.ts generateFinalTask; the pseudo task PLAN does not enter the task
// chain, writes no progress record): collect is lenient — a file that exists
// and is non-empty counts as produced (section completeness is a prompt-level
// requirement; over-structural validation would create meaningless retries);
// the output goes through the unified commit with the session (stage=knowledge),
// a permanent path inside the phase directory, not moved at handover (R2).
// The completion condition includes the commit (plans/0021-commit-boundary-design.md
// ③④ generalized): ③ the idempotent entry finds this round's document already
// produced but still on the uncommitted list → backfill commit, then complete;
// ④ document missing and the worktree dirty (the site of a previous half-finished
// extraction or manual changes) → return dirty for a person to handle, then
// re-run — against the k phase's existing semantics that "extraction failure is
// a ⚠ only and does not pollute the exit code", dirty is the exception (an
// unclean worktree pollutes the start baseline of every later unit, it must
// stop first). A commit failure (requireArtifact's blocked) is likewise thrown
// up under the dirty convention, and the caller halts.
export async function extractKnowledge(
  client: ClientSource,
  dir: string,
  opts: Opts,
  phase: PhaseUnit,
): Promise<
  { type: "ok"; file: string } | { type: "skipped"; file: string } | { type: "dirty"; files: string[] } | { type: "failed"; question: string }
> {
  const task = { id: "PLAN", title: "migration knowledge distillation (k phase)", status: "in_progress" as const, attempts: 0, body: "" }
  const commit = { stage: "knowledge", subject: "PLAN knowledge migration knowledge distillation" }
  const existing = await existingKnowledge(dir, phase)
  if (existing) {
    // ③ Backfill commit: the document is on disk but still on the uncommitted
    // changes list → commit, then complete.
    const pending = await commitPending(dir, opts, task, commit, [existing])
    if (pending !== "clean") {
      log(pending.ok ? `✓ knowledge document was produced but not committed; committed now: ${existing}` : `⚠ knowledge document make-up commit failed: ${pending.failures.map((f) => `${f.rel}: ${f.error}`).join("; ")}`)
      if (!pending.ok) return { type: "dirty", files: [existing] }
    }
    return { type: "skipped", file: existing }
  }
  // ④ Half-finished-site detection: artifact missing + worktree dirty → hand
  // to a person to clean up, no proactive git action.
  if (opts.commit !== false && !opts.dryrun) {
    const dirty = await changedFiles(dir)
    if (dirty.length) return { type: "dirty", files: dirty }
  }
  const file = knowledgeFile(phase)
  const produced = await requireArtifact(
    client,
    task,
    renderKnowledge({ file, mode: opts.mode }),
    opts,
    {
      kind: "knowledge extraction",
      role: "knowledge",
      // Independent hidden task unit: entry clean gate + SHA baseline + close-out check (plans/0021-commit-boundary-design.md).
      unitStart: true,
      artifact: `a non-empty knowledge document ${file}`,
      detail: "missing or empty",
      requirement: `write the knowledge document to ${file} (fill in the full section skeleton given in the prompt; when information is scarce, still write the skeleton and say why).`,
      commit,
      reset: () => rm(join(dir, file), { force: true }),
      collect: async () => {
        const text = await Bun.file(join(dir, file)).text().catch(() => "")
        return text.trim() ? true : undefined
      },
    },
  )
  if (produced === true) return { type: "ok", file }
  if (produced.type === "dirty") return { type: "dirty", files: produced.files }
  // If the worktree is already dirty after a blocked session / no output
  // (typically: commit failure), likewise halt as dirty.
  if (opts.commit !== false && !opts.dryrun) {
    const dirty = await changedFiles(dir)
    if (dirty.length) return { type: "dirty", files: dirty }
  }
  return { type: "failed", question: produced.question }
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

// Prior-knowledge extraction orchestration (the same requireArtifact skeleton
// as extractKnowledge).
//
// Completion condition (2026-09-13 robustness rework, specialized-tool-design
// §3 — root cause: when the AI service errored, the old criterion "session
// ended + file non-empty" misjudged a half-finished site as complete): the
// phase completes ⟺ the formal knowledge document prior-kb.md is on disk and
// committed. Protocol:
// ① the AI writes only the intermediate artifact temp-kb.md (same directory
//    as the formal artifact); once the whole text is written it puts `DONE` on
//    a line of its own at the very end as the closing mark; collect recognizes
//    only documents carrying the closing mark, its absence counts as not
//    produced (retry with feedback);
// ② after the closing mark is confirmed the driver renames it to the formal
//    artifact and unified-commits — both the rename and the commit are driver
//    actions, AI self-reports do not count;
// ③ on a re-run the artifact already exists but is not yet committed (last
//    time interrupted after the rename / before the commit, or left over by a
//    commit failure) → the driver backfill-commits, then it is complete;
// ④ artifact missing and the worktree has uncommitted changes = the site of a
//    previous half-finished extraction (or manual changes): the driver does
//    not clean up proactively (the say over git state belongs to a person),
//    returns dirty and the caller asks a person to handle it, then re-runs.
// ③④ take git as the authority and apply only while the unified commit is
// enabled (opts.commit !== false); with committing off the old semantics stay
// (document exists = complete, dirty check skipped).
// ⑤ The clean baseline this relies on is the round-start commit, which a human
//    makes after init/continue — no shell commits it (plans/0048 R1).
// failed (blocked session / two failures to produce) is converted by the
// caller into a blocked halt; after a person handles it, a re-run restarts
// this phase.
export async function extractPriorKnowledge(
  client: ClientSource,
  dir: string,
  opts: Opts,
  brief?: string,
): Promise<{ type: "ok"; file: string } | { type: "skipped"; file: string } | { type: "dirty"; files: string[] } | { type: "failed"; question: string }> {
  const round = await currentRound(dir)
  const task = { id: "PLAN", title: "prior-knowledge extraction (retrospective of existing migration results)", status: "in_progress" as const, attempts: 0, body: "" }
  const commit = { stage: "prior-knowledge", subject: "PLAN prior-kb prior-knowledge extraction" }
  const existing = await existingPriorKnowledge(dir, round)
  if (existing) {
    // ③ Backfill commit: the document is on disk but still on the uncommitted
    // changes list → commit, then complete (same protocol as every hidden
    // task, helper see git.ts commitPending).
    const pending = await commitPending(dir, opts, task, commit, [existing])
    if (pending !== "clean") {
      if (pending.ok) {
        log(`✓ prior-knowledge document was produced but not committed; committed now: ${existing}`)
      } else {
        log(`⚠ prior-knowledge document make-up commit failed: ${pending.failures.map((f) => `${f.rel}: ${f.error}`).join("; ")}`)
        return { type: "dirty", files: [existing] }
      }
    }
    return { type: "skipped", file: existing }
  }
  const file = priorKnowledgeFile(round)
  const temp = tempPriorKnowledgeDoc(file)
  // ④ Half-finished-site detection: artifact missing + worktree dirty → hand
  // to a person to clean up, no proactive git action.
  if (opts.commit !== false) {
    const dirty = await changedFiles(dir)
    if (dirty.length) return { type: "dirty", files: dirty }
  }
  const distilled = await existingDistilledDocs(dir, round)
  log(`▶ opening prior-knowledge extraction session (writes ${temp}, renamed to ${file} once the closing mark is confirmed${distilled.length ? "; existing distilled artifacts referenced, not restated" : ""})`)
  const produced = await requireArtifact(client, task, renderPriorKnowledge({ file: temp, brief, mode: opts.mode, distilled }), opts, {
    kind: "prior-knowledge extraction",
    role: "prior-knowledge",
    // Independent hidden task unit (plans/0021-commit-boundary-design.md). The unified
    // commit is deliberately not hooked here: closing-mark check → rename → commit must
    // run in order, and committing at session end would book an unclosed temp-kb.md
    // first; the driver commits after the rename, below.
    unitStart: true,
    artifact: `a knowledge document ${temp} with its closing mark`,
    detail: `missing, empty, or lacking the closing \`${PRIOR_KB_DONE}\` mark at the end`,
    requirement:
      `write the knowledge document to ${temp} (fill in the full section skeleton given in the prompt; when existing migration results are scarce, still write the skeleton and say why), ` +
      `and once the whole document is written put the line \`${PRIOR_KB_DONE}\` on a line of its own at the very end as the closing mark (a driver protocol string, write it verbatim) — without it the document always counts as unfinished.`,
    reset: () => rm(join(dir, temp), { force: true }),
    collect: async () => {
      const text = await Bun.file(join(dir, temp)).text().catch(() => "")
      return priorKnowledgeComplete(text) ? true : undefined
    },
  })
  if (produced !== true) {
    if (produced.type === "dirty") return { type: "dirty", files: produced.files }
    return { type: "failed", question: produced.question }
  }
  // ② Closing mark confirmed → rename to the formal artifact and unified
  // commit (with committing off the rename still happens, the commit is
  // skipped); a commit failure → dirty for a person (completion condition =
  // artifact on disk and committed, plans/0021-commit-boundary-design.md).
  await rename(join(dir, temp), join(dir, file))
  const committed = await afterSession(dir, opts, task, commit)
  if (committed.type === "failed") {
    log(`⚠ prior-knowledge document was promoted but the commit failed: ${committed.question}`)
    return { type: "dirty", files: [file] }
  }
  return { type: "ok", file }
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

// Prior-knowledge digest (injected into this round's first phase planning
// session and the parameter-inference session): past rounds' prior knowledge
// concatenated in full, sorted by path — the non-empty documents among past
// rounds' docs/R-*/prior-kb.md (cross-round cumulative injection). No artifact
// → undefined.
export async function priorKnowledgeDigest(dir: string): Promise<string | undefined> {
  const files: string[] = []
  for (const entry of await readdir(join(dir, "docs"), { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && /^R-\d+$/.test(entry.name)) files.push(join("docs", entry.name, "prior-kb.md"))
  }
  const parts: string[] = []
  for (const file of files.sort()) {
    const text = (await Bun.file(join(dir, file)).text().catch(() => "")).trim()
    if (text) parts.push(`### ${file}\n\n${text}`)
  }
  return parts.length ? parts.join("\n\n") : undefined
}
