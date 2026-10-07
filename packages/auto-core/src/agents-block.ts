import { chmod, rm } from "node:fs/promises"
import { join } from "node:path"
import { reprotect } from "./protect"

// The opencode-auto block of AGENTS.md: one marker block, content = the
// pointer + the test-execution principle (the testByDriver switch) + the
// commit principle + the summary principle (non-interactive scenarios
// produce no end-of-session summary) + the reference conventions, merged
// into one English text. Paragraphs are assembled with array filter/join
// (\n\n separated), not through template.ts's {{#if}} engine — the semantic
// where a tag alone on its line swallows the whole line's newline would
// glue adjacent paragraphs together when a switch is off, losing the
// separating blank line; array joining does not depend on that semantic and
// always separates with exactly one blank line.
// AGENTS.md holds only this block (plus whatever a human wrote around it):
// sessions do not maintain it (plans/0054 D2). The file is gitignored
// (local-only), so session edits would escape the unified commit and the
// unit rollback; durable knowledge lives in committed docs/ documents
// instead, and run makes the file read-only (protect.ts). It is system
// context reread on every provider turn; init/amend/fix/run only keep this
// block in sync with the config.
export const AGENTS_BLOCK_START = "<!-- opencode-auto:start -->"
export const AGENTS_BLOCK_END = "<!-- opencode-auto:end -->"

// The one canonical block (no name segment).
const CANONICAL_BLOCK = /<!--\s*opencode-auto:start\s*-->[\s\S]*?<!--\s*opencode-auto:end\s*-->/

// Any opencode-auto block with a `:<name>:` segment — the legacy six-block
// format (verify/test/commit/maint/refs) or any future stray marker block;
// does not match the bare start/end canonical block above.
export const LEGACY_BLOCK = /<!--\s*opencode-auto:([\w-]+):start\s*-->[\s\S]*?<!--\s*opencode-auto:\1:end\s*-->\n*/g

const POINTER = `This directory is driven by opencode-auto. The session prompt already inlines the task for this turn, so you normally don't need to read state files separately. A task's own documents hold its full content and progress — \`docs/T-NNN/todo.md\` (goal, scope, acceptance) and \`docs/T-NNN/subtasks.md\` (the subtask checklist): reread them if context has been compacted, or whenever you are unsure about the current task or its progress, rather than relying on session memory. The \`todo.md\` → \`done.md\` renames of phases, tasks and subtasks and the ticks in their indexes are made by DRIVER alone. AGENTS.md is not a place for notes: do not edit it — anything worth keeping belongs in \`docs/\` documents.`

// Narrowed by plans/0083 D10/D11: the protocol covers compilation and test
// runs only (build, typecheck, test suites) — formatting or style validation
// is not a test script and is not routed through tmp/test.sh — and a
// driver-run script is an observation that never changes git-managed
// content. The block is rendered per config (testByDriver), so it scopes
// itself in wording ("in implementation and testing tasks") instead of
// per phase; the per-phase derivation is the gates' (phases/registry
// codeWork). The honest caveat is part of the charter: the driver runs
// whatever script path lands in tmp/test.sh and cannot mechanically tell a
// lint script — a task document that itself demands a formatting check
// makes that check acceptance for that task, which the last-but-one
// sentence states.
const TEST_PRINCIPLE = `Test principle: in implementation and testing tasks, compilation and test runs — build, typecheck, test suites — which can be slow or produce large amounts of output, are always run by DRIVER outside the session; no session should run them directly. When needed, write the command as a script under \`test/\`, then write that script's path into \`tmp/test.sh\` to tell DRIVER to run it. After running it, DRIVER reports the exit code and the output file path (stdout and stderr merged into one file) back to the session, which reads the file directly to judge the result. A driver-run script is an observation: it must not modify, create or delete tracked files and must not run git state commands (commit, checkout, rebase, …); scratch output goes to \`tmp/\` or other gitignored paths, and a check that inherently rewrites tracked content (snapshot updates, codegen) does not go through the protocol at all. Formatting or style validation is not a test script and is not routed through \`tmp/test.sh\`; a task document that itself demands a formatting or style check makes that check part of that task's acceptance — run it as the task says. Task descriptions and project conventions must not contain instructions that contradict this.`

const COMMIT_PRINCIPLE = `Commit principle: after a session ends, DRIVER performs one unified recursive commit of every change (nested sub-repositories first, then this repository), with commit messages carrying the task number and phase; no session should ever run \`git commit\`/\`amend\`/\`rebase\` or any other commit-type command, nor alter commit history. Background worth preserving belongs in \`docs/\` documents, which DRIVER's commit picks up automatically. Task descriptions and project conventions must not contain instructions that contradict this.`

const SUMMARY_PRINCIPLE = `Summary principle: do not produce a closing summary or wrap-up narration in your final chat turn when a session finishes. DRIVER is non-interactive and never reads chat text, and this system runs many unattended agent sessions back-to-back, so a spoken summary at the end of each one is pure wasted tokens with no reader. Anything worth keeping belongs in \`docs/\` files (or the task's report, where applicable) — once the required file writes are done, end the turn. Task descriptions and project conventions must not contain instructions that contradict this.`

const REFS_SPEC = `Reference and storage conventions (stable references; see the stable-refs design document for the full rationale):
1. Storage: task documents live only under \`docs/T-NNN/\` (the task's own \`todo.md\`/\`done.md\`, \`context\`/\`subtasks\`/\`report\`/\`gaps\`/\`handoff\`/\`testhandoff.md\`); subtask artifacts live only under \`docs/T-NNN/S<2-digit-seq>/\` (\`index.md\`, \`testhandoff.md\`); each round has one round directory \`docs/R-NN/\` (created at the start of the round, never moved afterward): the phase index \`phases.md\`, one phase directory \`P<nn>-<type>/\` per phase (its \`todo.md\`/\`done.md\` state file, task index \`tasks.md\`, handover \`handover.md\`, phase-level artifacts and standard artifacts such as the migration knowledge \`kb.md\`), and prior knowledge \`prior-kb.md\` all live inside the round directory. Once created, these paths are permanent — never move them, never rename them.
2. References: references between documents, and references into code, are always written as paths relative to the target directory root (for example \`docs/T-003/S04/index.md\`, \`src/runner.ts:120\`, in backticks or as links), optionally with a \`:line\` anchor; the anchor may further carry an \`@<sha>\` version marker (for example \`src/runner.ts:120@abc1234\`, meaning that range is valid only for that historical revision). Do not reference state files inside round directories (the \`phases.md\` and \`tasks.md\` indexes, or phase \`todo.md\`/\`done.md\`); differences across rounds are expressed through separate \`docs/R-NN/\` directories, not by moving or renaming directories.
3. Checking: DRIVER neither checks nor rewrites references. Confirm that a path exists before you write it, and keep the references your task touches valid — that is part of the task's own work and of its acceptance.`

// The constitution's paragraphs in block order (TEST_PRINCIPLE present only
// under the switch). One source, two renderings (plans/0072 §2 U-B): the
// AGENTS.md marker block below and the standalone preamble next to it —
// both assemble exactly these paragraphs, so the two can never drift apart.
function constitutionParagraphs(opts: { testByDriver?: boolean } = {}): string[] {
  return [
    POINTER,
    opts.testByDriver ? TEST_PRINCIPLE : undefined,
    COMMIT_PRINCIPLE,
    SUMMARY_PRINCIPLE,
    REFS_SPEC,
  ].filter((p): p is string => Boolean(p))
}

// The five constitution constants as one exported record: the single source
// every other surface must not restate. The drift ratchet
// (test/constitution-ratchet.test.ts) reads its probes from here, and any
// future consumer of the wordings (error texts, docs generators) reads them
// from here too — never a hand copy.
export const CONSTITUTION = {
  POINTER,
  TEST_PRINCIPLE,
  COMMIT_PRINCIPLE,
  SUMMARY_PRINCIPLE,
  REFS_SPEC,
} as const

// The constitution preamble (plans/0076's standalone work orders, T-137): the
// same five paragraphs as the block, rendered without the AGENTS.md markers —
// a standalone session may run in an agent that reads no AGENTS.md and never
// sees the auto.md contract, so its work order carries the constitution
// itself. The full constitution, never a trimmed selection. This export is
// the seam T-131 lands: until T-137 wires the work-order export it has no
// caller (a stub by design, named here so the consumer is discoverable).
export function renderConstitutionPreamble(opts: { testByDriver?: boolean } = {}): string {
  return constitutionParagraphs(opts).join("\n\n")
}

export function renderAgentsBlock(opts: { testByDriver?: boolean } = {}): string {
  return `${AGENTS_BLOCK_START}\n${renderConstitutionPreamble(opts)}\n${AGENTS_BLOCK_END}`
}

// Idempotently syncs AGENTS.md's opencode-auto block: renders the template
// from the current config and compares it with the canonical block already
// in the file (bare opencode-auto:start/end) — identical content is left
// alone, differing content replaces the whole block, a missing one is
// appended; every other opencode-auto block with a name segment in the file
// (legacy six-block format or any stray marker block) is deleted. The
// legacy bare-pointer block itself matches the canonical-block regex, so it
// goes through the replace branch and is superseded by the new merged
// content, while the other five named blocks are cleaned up by the delete
// branch — that is the migration path from the old format to the new one.
// dryRun computes the result without writing, so `fix` can print its plan first.
export async function ensurePointer(
  directory: string,
  opts: { testByDriver?: boolean; dryRun?: boolean } = {},
): Promise<{ block: "inserted" | "replaced" | "unchanged"; legacyRemoved: number }> {
  const agentsFile = join(directory, "AGENTS.md")
  const existing = await Bun.file(agentsFile).text().catch(() => "")
  let text = existing

  let legacyRemoved = 0
  text = text.replace(LEGACY_BLOCK, () => {
    legacyRemoved++
    return ""
  })
  text = text.replace(/\n{3,}/g, "\n\n")
  if (legacyRemoved) text = text.replace(/\n{2,}$/, "\n")

  const rendered = renderAgentsBlock(opts)
  const match = CANONICAL_BLOCK.exec(text)
  let block: "inserted" | "replaced" | "unchanged"
  if (!match) {
    text = text ? `${text.trimEnd()}\n\n${rendered}\n` : `# AGENTS.md\n\n${rendered}\n`
    block = "inserted"
  } else if (match[0] === rendered) {
    block = "unchanged"
  } else {
    text = text.slice(0, match.index) + rendered + text.slice(match.index + match[0].length)
    block = "replaced"
  }

  if (!opts.dryRun && text !== existing) {
    // A killed run can leave the file read-only (protect.ts): unlock before
    // writing, then reprotect — a no-op unless a run is protecting it.
    await chmod(agentsFile, 0o644).catch(() => {})
    await Bun.write(agentsFile, text)
    await reprotect(agentsFile)
  }
  return { block, legacyRemoved }
}

// The inverse of ensurePointer (used by reset): removes the canonical block
// and any legacy named blocks, keeping the rest of the file (the user's own
// prose) verbatim. If after removal the prose is down to the bare
// `# AGENTS.md` heading shell — i.e. the file was created by ensurePointer
// in the first place — it reports emptied and the caller deletes the whole
// file. dryRun only computes the result without writing, so reset can
// print the list first and confirm.
export async function removePointer(
  directory: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ removed: boolean; emptied: boolean }> {
  const agentsFile = join(directory, "AGENTS.md")
  const existing = await Bun.file(agentsFile).text().catch(() => undefined)
  if (existing === undefined) return { removed: false, emptied: false }

  let removed = false
  let text = existing.replace(LEGACY_BLOCK, () => {
    removed = true
    return ""
  })
  const match = CANONICAL_BLOCK.exec(text)
  if (match) {
    text = text.slice(0, match.index) + text.slice(match.index + match[0].length)
    removed = true
  }
  text = text.replace(/\n{3,}/g, "\n\n").trim()

  const emptied = removed && (text === "" || text === "# AGENTS.md")
  if (!opts.dryRun && removed) {
    if (emptied) await rm(agentsFile, { force: true })
    else {
      await chmod(agentsFile, 0o644).catch(() => {})
      await Bun.write(agentsFile, `${text}\n`)
    }
  }
  return { removed, emptied }
}
