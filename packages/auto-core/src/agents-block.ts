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

// —— Preparation guidance (plans/0084) ——
//
// The block is also the delivery surface for preparation states: between
// commands — while a round setup, a phase's planning input or the first-run
// project analysis awaits the person — the block carries, beside the
// constitution, the guidance that turns whatever agent reads AGENTS.md (the
// person's interactive coding agent first, a driver-driven session just the
// same) into an assistant for that preparation step. One primer (how the tool
// works, so a plan written against it is well-formed), one assist rule (how
// to help a person determine what is missing without deciding for them), one
// state text naming the document of the moment and its spec. The guidance
// never renders during a run (the execution state is the constitution alone,
// byte-identical to before — the ratchet's floor), and the state flips only
// at command boundaries: plan's preparation stops set it, run's preflight
// renders it away. AGENTS.md is local-only, so the flips leave no git noise.

// The primer: the tool's working model in one paragraph, distilled for
// preparation work — the unit hierarchy, the lifecycle, the phase vocabulary,
// the gates' marks, and where a round's phase list comes from. An agent that
// understands this proposes roadmaps and round briefs the machinery can
// actually execute (plans/0084 D4: the analysis must deeply understand
// opencode-auto's mechanisms to formulate a long-term plan that fits).
const DRIVER_PRIMER = `How opencode-auto works — the model a preparation plan must fit: work runs in rounds, one permanent \`docs/R-NN/\` directory per round. A round holds phases (\`docs/R-NN/P<nn>-<type>/\`, from the configured phases value — builtin types a analysis, d design, m implement, t test, v acceptance, k knowledge, plus custom types in \`.opencode/auto/phases/\`), each phase holds tasks (\`docs/T-NNN/\`, planned by the driver's planning session from the phase's \`plan-input.md\`), and a task may decompose into subtasks (\`docs/T-NNN/S<nn>/\`). Progress is the \`todo.md\` → \`done.md\` rename, made by DRIVER alone; \`phases.md\` and \`tasks.md\` are membership indexes DRIVER ticks. \`plan\` establishes rounds and runs the planning sessions; \`run\` executes — one session per unit, DRIVER commits everything after each session (an AI session never commits). A phase ends with a distilled \`handover.md\` for the next; gates hold for the person's mark where the phase type declares one (\`Clarified: yes\` on a survey, \`Accepted: yes\` on acceptance, a \`Result: PASS|FAIL\` verdict), and a round closes only with its \`round.md\` \`## Close\` section and its \`report-for-user.md\` in place. The phase list of every round comes from the config phases value — set it per round with \`amend --phases\` before the round opens; tasks may carry \`Depends:\`/\`Touches:\` fields to shape their order; everything under \`docs/T-*\`, \`docs/R-*\` and \`.auto/\` is process record the deliverable never references (P1).`

// The assist rule: the interactive-determination discipline every preparation
// state shares — enumerate the missing information, ask, propose, record the
// open decisions as Fork: lines, and put each settled result into the document
// it belongs to. The Fork: line is the non-interactive agent's outlet too, so
// the same text is safe for both kinds of reader.
const ASSIST_RULE = `Assisted preparation rule: in this state your job is to help the person determine what the next step needs, never to decide it for them. When information is missing, first enumerate what is unknown and which document each piece belongs to; then work it out with the person — targeted questions, options with consequences, a recommendation. What the person has not decided stays open as a \`Fork:\` line with its options and recommended default; never invent the person's answer. Every settled result goes into the named document, in the section it belongs to — chat text and session memory are not storage. A session with no person present follows the same rule with the \`Fork:\` line as its only outlet.`

// The analysis state: the first-run step, before round R-01 exists. Names the
// document, its sections, the reading order (the tool's own surfaces first),
// and the release mark.
const ANALYSIS_STATE = `Current state — project analysis (before round R-01 exists): the goals of the engagement are not fixed yet, so no round is open; the document to produce is \`docs/analysis.md\` (a stub with section hints is in place). Read the tool's own surfaces first — \`.opencode/auto/config.json\` (the phases value and switches as they stand), the active intent pack's planning-input scaffold (\`plan --scaffold\` prints it), \`.opencode/auto/phases/\` for the project's custom types — and the project's own material (README, docs/, the source tree; an existing codebase gets a real inventory). Then help the person fill the sections: \`## Analysis\` (the thorough, evidence-based analysis of the project), \`## Goals\` (the overall goals in the project's own terms), one \`Fork:\` line per open decision, \`## Project brief\` (the project's constants — goal, inputs, deliverable target, binding constraints; installed verbatim into \`.opencode/auto/brief.md\` on release), and \`## Roadmap\` — the long-term plan for the next few rounds, one line per round \`- R-NN <phases> — <goal>\` (<phases> is the value \`amend --phases\` sets for that round), with each round's key work at task granularity, its acceptance posture, its dependencies and the risks it resolves under the line. The bar: done thoroughly, this analysis determines the key work of the rounds that follow — later rounds should need little new deciding. The person releases it by adding the whole line \`Clarified: yes\` and committing; the next \`plan\` installs the approved brief and opens round R-01.`

// The round-preparation state: the round-start gate's document and where its
// content comes from. The m-mode caveat keeps the text honest where no stub
// was written at establishment.
function roundState(round: string): string {
  return `Current state — round ${round} preparation (the round-start gate): the round's setup is on disk; the document to fill is \`docs/${round}/round.md\`, whose sections are \`## Goal\` (what this round must achieve, in the project's own terms), \`## Acceptance criteria\` (how a reviewer tells it was met) and \`## Release criteria\` (what must hold before the round closes); \`## Close\` stays empty until the round ends — the round-close gate requires it then. Derive the content from the project brief (\`.opencode/auto/brief.md\`), this round's line and key work in \`docs/analysis.md\`, and the previous round's \`report-for-user.md\` and \`## Close\` listing; settle anything still open with the person before it lands. When the sections hold the person's real intent, review together, commit, and run \`plan\` again — it plans the round's first phase. (In the manual single-phase mode the round brief is not stubbed at establishment; create the file before the round closes — its \`## Close\` is required there too.)`
}

// The phase-preparation state: the next phase's planning input, its scaffold
// (the active intent pack's own `## planning-input` section, pre-rendered by
// the caller), and its anchors.
function phaseState(phase: string, inputPath: string, scaffold: string): string {
  return [
    `Current state — phase ${phase} preparation: the next step is this phase's planning session, and it reads the person's planning input. The document to fill is \`${inputPath}\` — the driver commits it unchanged before the session runs; free-form markdown, completed per the active intent pack's scaffold:`,
    scaffold,
    `Anchor it in the round brief (\`docs/R-NN/round.md\`), this round's roadmap line in \`docs/analysis.md\`, and the previous phase's \`handover.md\`; settle open points with the person — a \`Fork:\` line in the input is legitimate when a decision must stay open. When the file holds the person's intent, run \`plan\` — the planning session consumes it as written.`,
  ].join("\n\n")
}

// The guidance a preparation stop renders: which state, plus the data only
// the caller knows (the round name; the target phase, its input path and the
// pack's scaffold).
export type Guidance =
  | { kind: "analysis" }
  | { kind: "round"; round: string }
  | { kind: "phase"; phase: string; inputPath: string; scaffold: string }

// The static guidance texts as one exported record — the pinning surface for
// the tests, in CONSTITUTION's shape (the state texts with data are reached
// through renderAgentsBlock).
export const GUIDANCE = {
  DRIVER_PRIMER,
  ASSIST_RULE,
  ANALYSIS_STATE,
} as const

// The guidance's paragraphs, in block order: the primer, the assist rule,
// then the state's own text.
function guidanceParagraphs(guidance: Guidance): string[] {
  const state =
    guidance.kind === "analysis"
      ? ANALYSIS_STATE
      : guidance.kind === "round"
        ? roundState(guidance.round)
        : phaseState(guidance.phase, guidance.inputPath, guidance.scaffold)
  return [DRIVER_PRIMER, ASSIST_RULE, state]
}

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

// The block: the constitution, plus the preparation guidance when a
// preparation stop asked for it (plans/0084). Without `guidance` the bytes
// are exactly the constitution block — the run-time floor the ratchet freezes.
export function renderAgentsBlock(opts: { testByDriver?: boolean; guidance?: Guidance } = {}): string {
  const paragraphs = [...constitutionParagraphs(opts), ...(opts.guidance ? guidanceParagraphs(opts.guidance) : [])]
  return `${AGENTS_BLOCK_START}\n${paragraphs.join("\n\n")}\n${AGENTS_BLOCK_END}`
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
// `guidance` (plans/0084) renders a preparation state beside the
// constitution: a preparation stop (the analysis stub, a round establishment,
// plan --round / --phase) passes it so the person's agent reads the step's
// instructions; run's preflight and fix call without it, rendering the block
// back to the execution floor.
export async function ensurePointer(
  directory: string,
  opts: { testByDriver?: boolean; dryRun?: boolean; guidance?: Guidance } = {},
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
