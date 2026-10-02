// Document domain — the role model (M2.3, plans/0045): every path in the
// target directory plays one DocumentRole (types.ts), and the driver's
// per-document policies derive from that role instead of from scattered
// name lists. One classifier (roleOf), one policy table (ROLE_POLICIES):
//   - the whole-unit eof terminator scan skips roles whose policy says so
//     (eofScanExempt — formerly a hand-kept name list in doccheck.ts);
//   - the run-time read-only guard (protect.ts) covers the fixed-location
//     files of the driverState role (PROTECTED_FILES);
//   - the handoff role's two protocol shapes (session handoff status line,
//     phase handover four sections) are checked here;
//   - the P1 prohibition scan (process-refs.ts) targets exactly the paths
//     whose role is not a process role (p1Scope);
//   - both scans skip the deliverable paths the project lists in its config
//     key scanExempt (scanExempted, plans/0059 X2).
// Legacy layouts have no shapes here (M3.7, plans/0047 R3): an old project is
// a usage error before any path is classified.
//
// Standardization boundary. The driver's protocol markers constrain exactly
// two kinds of file: the index and state files it parses (the phase and task
// indexes, the task todo.md title line and field block, subtasks.md checklist
// items and their `Artifacts:` declarations, the todo.md section anchors, the
// report result line) and the handoff documents
// (status line, four handover sections). Everything else an AI session writes
// under docs/T-NNN/ — context.md, subtask artifacts under S<nn>/, free phase
// documents — is free content: the only mechanical demands on it are the
// shape check (non-trivial, eof terminator) and the section anchors a
// decomposition declared for itself; no schema, no required headings. New
// protocol surface must be justified against this boundary: prefer a marker
// in an index or handoff file over a schema on free content.
//
// Process documents are not design dependencies (P1, root plan D12). Every
// role except freeform is a process role: the tool's record of long-running
// work, kept to steer the work to its goal. The deliverable (freeform) must
// never depend on it — no path into it, and when a comment needs what a
// process document says, it restates the content in place — so that the
// deliverable stays coherent once the process documents are gone (P1-a: the
// dependency runs process → deliverable only; P1-b: the process side is
// disposable). AUTO-* marker lines may sit in deliverable comments (ruling of
// 2026-09-21): they are process *marks*, eventually removed by later
// iterations, and each must be self-contained — a mark is legal, a pointer
// into the process side is not. Enforcement: the prompt-side discipline is
// intent (`## governance` / `### process-references`), the mechanical side is
// the prohibition scan at unit close-out (process-refs.ts), and the whole-tree
// scan at round close belongs to M4.
import { PHASE_ACCEPTANCE_NAME, PLAN_INPUT_NAME, ROUND_BRIEF_NAME } from "../docpaths"
import type { DocumentRole } from "./types"

export type RolePolicy = {
  // Subject to the whole-unit eof terminator scan when the path is a .md
  // file changed in a unit (execute.ts subtaskArtifactProblems).
  eofScan: boolean
  // A process role (P1): the tool's record of the work. Paths of a process
  // role are exempt from the prohibition scan — they are the referenced side.
  process: boolean
}

export const ROLE_POLICIES: Record<DocumentRole, RolePolicy> = {
  // Driver-written state; no terminator (the driver owns the format).
  driverState: { eofScan: false, process: true },
  // The phase index (M3.3: replaced the append-only ledger under the same
  // role): driver-written at round start, ticked at phase completion; the
  // driver owns the format, so no terminator.
  ledger: { eofScan: false, process: true },
  // Carries its own final-state contract (status line / four sections).
  // The session handoff family spans three shapes since plans/0068 S5: the
  // task-level handoff.md (ondemand whole-task sessions, auto's lead), the
  // per-stream handoff.md inside docs/T-NNN/S<nn>/ (side-by-side stream
  // lanes hand over through one document each — the deferral "all streams
  // of a task share one handoff.md" retired with it), and the test-handover
  // testhandoff(-<n>).md family; one role, one policy set, one status-line
  // check for all of them.
  handoff: { eofScan: false, process: true },
  // Drafted by the handover session, signed by a human; the acceptance gate
  // reads its marker, not a terminator.
  phaseAcceptance: { eofScan: false, process: true },
  // Human-written round brief; no terminator (plans/0049 G2).
  roundBrief: { eofScan: false, process: true },
  // A phase's planning input, the human's text kept verbatim by the driver;
  // no terminator, like the round brief (plans/0053 D10).
  planningInput: { eofScan: false, process: true },
  artifact: { eofScan: true, process: true },
  // The deliverable and the project's own documents: .md files changed in a
  // unit still carry the terminator (the D6 whole-unit scan predates roles).
  freeform: { eofScan: true, process: false },
}

// Fixed-location driverState files; they form PROTECTED_FILES. .auto/ is
// driverState too (units.json runtime state, progress.json, …) but is
// rewritten continuously by the driver, so it is guarded by the prompt
// contract alone. The retired task mirror CURRENT.md (plans/0054 D3) is no
// longer a role of its own.
const DRIVER_STATE_PATHS = ["opencode.json", ".opencode/auto/config.json"]

// Read-only during a run (protect.ts, which adds the contract surface
// AGENTS.md). Every entry must classify as driverState — asserted by
// test/document-roles.test.ts.
export const PROTECTED_FILES = ["opencode.json", ".opencode/auto/config.json"] as const

// The session handoff family by file name, wherever it sits: the task-level
// handoff.md, the per-stream handoff.md of docs/T-NNN/S<nn>/ (plans/0068 S5
// — classification is by name, so the per-stream document already read as
// this role the day the family gained it), testhandoff.md and the archived
// testhandoff-<n>.md.
const HANDOFF_NAME = /^(?:test)?handoff(?:-\d+)?\.md$/

// Phase index: docs/R-NN/phases.md (M3.3).
const LEDGER = /^docs\/R-\d+\/phases\.md$/

// A phase directory docs/R-NN/P<nn>-<type> (plans/0047 §4).
const PHASE_DIR = "R-\\d+/P\\d{2,}-[a-z][a-z0-9-]*"

// Phase handover distillations: docs/R-NN/P<nn>-<type>/handover.md.
const PHASE_HANDOVER = new RegExp(`^docs/${PHASE_DIR}/handover\\.md$`)

// Phase acceptance records inside the phase directory. `acceptance-r<n>.md` is
// accepted too, leaving per-iteration naming open to the gate without a role
// change.
const PHASE_ACCEPTANCE = new RegExp(`^docs/${PHASE_DIR}/${PHASE_ACCEPTANCE_NAME.replace(".md", "")}(?:-r\\d+)?\\.md$`)

// The round brief: docs/R-NN/round.md (plans/0049 G2).
const ROUND_BRIEF = new RegExp(`^docs/R-\\d+/${ROUND_BRIEF_NAME.replace(".", "\\.")}$`)

// A phase's planning input: docs/R-NN/P<nn>-<type>/plan-input.md (plans/0053 D10).
const PLANNING_INPUT = new RegExp(`^docs/${PHASE_DIR}/${PLAN_INPUT_NAME.replace(".", "\\.")}$`)

// Everything else the tool keeps under docs/: task directories (the task
// unit's todo.md / done.md included) and round directories (phase directories
// with their state files, task index tasks.md and standard artifacts included).
const PROCESS_DOCS = /^docs\/(?:T-\d+|R-\d+)(?:\/|$)/

// The role of a path relative to the target directory. Pure: classification
// is by path shape only, never by content or existence.
export function roleOf(rel: string): DocumentRole {
  const path = rel.replaceAll("\\", "/").replace(/^\.\//, "")
  if (path === ".auto" || path.startsWith(".auto/")) return "driverState"
  if (DRIVER_STATE_PATHS.includes(path)) return "driverState"
  const name = path.split("/").at(-1) ?? path
  if (HANDOFF_NAME.test(name)) return "handoff"
  if (!path.startsWith("docs/")) return "freeform"
  if (LEDGER.test(path)) return "ledger"
  if (PHASE_HANDOVER.test(path)) return "handoff"
  if (PHASE_ACCEPTANCE.test(path)) return "phaseAcceptance"
  if (ROUND_BRIEF.test(path)) return "roundBrief"
  if (PLANNING_INPUT.test(path)) return "planningInput"
  if (PROCESS_DOCS.test(path)) return "artifact"
  return "freeform"
}

// The project's scan exemptions (config scanExempt, plans/0059 X2): globs of
// deliverable paths where process-shaped strings or terminator-free Markdown
// are content, not a slip — a tool's own test fixtures and prompt templates.
// A path is exempt when a glob matches it or one of its parent directories,
// so a glob naming a directory covers the files under it. Only the
// deliverable side (freeform) is ever exempted: the process roles keep their
// own policies whatever a glob says.
// AUTO-DECISION: an exemption reaches freeform paths only (a glob as broad as docs/** must not switch off the terminator check of the driver's own task artifacts; the process roles are the P1 scan's referenced side anyway)
// AUTO-DECISION: a glob matches the path or any parent directory of it (a person naming a fixtures directory means the files in it; `dir/**` still works as written)
const compiled = new Map<string, InstanceType<typeof Bun.Glob>>()
export function scanExempted(rel: string, globs: readonly string[] = []): boolean {
  if (!globs.length) return false
  const path = rel.replaceAll("\\", "/").replace(/^\.\//, "")
  if (roleOf(path) !== "freeform") return false
  const parts = path.split("/")
  const candidates = parts.map((_, i) => parts.slice(0, parts.length - i).join("/"))
  return globs.some((glob) => {
    const pattern = glob.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "")
    const matcher = compiled.get(pattern) ?? new Bun.Glob(pattern)
    compiled.set(pattern, matcher)
    return candidates.some((candidate) => matcher.match(candidate))
  })
}

// Whether a path is exempt from the whole-unit document terminator scan
// (session-boundary-hardening §4.6 D6), derived from its role; `exempt` is
// the project's scan exemptions (scanExempted).
export function eofScanExempt(rel: string, exempt: readonly string[] = []): boolean {
  return !ROLE_POLICIES[roleOf(rel)].eofScan || scanExempted(rel, exempt)
}

// Agent-contract surfaces: freeform by role (the project owns them), but
// they legitimately name process paths — the AGENTS.md pointer block tells
// sessions where docs/T-NNN lives, .opencode/ holds the agent
// contract and the project's prompt/mode/intent overlays, and the driver
// writes `.auto/` into .gitignore (gitignore.ts). Outside P1 scope; the
// whole-tree scan at round close (round-close.ts) would otherwise trip on them.
function contractSurface(path: string): boolean {
  return path === "AGENTS.md" || path === ".gitignore" || path.startsWith(".opencode/")
}

// Whether a path belongs to the deliverable side P1 protects: a non-process
// role, not an agent-contract surface and not one of the project's scan
// exemptions (`exempt`, scanExempted).
export function p1Scope(rel: string, exempt: readonly string[] = []): boolean {
  const path = rel.replaceAll("\\", "/").replace(/^\.\//, "")
  return !ROLE_POLICIES[roleOf(path)].process && !contractSurface(path) && !scanExempted(path, exempt)
}

// —— handoff role: protocol checks ——

// The session handoff status line (`Status: continue|done`): ondemand
// handoff.md and test-handover testhandoff.md share one criterion
// (handover-boundary write check, plans/0022-session-recovery-fidelity-design.md
// 3.3 R3). undefined = missing/invalid.
//
// The criterion is a whole-line anchored status line: from line start, value
// exactly continue|done. An unanchored full-text match would mistake body text
// quoting the prompt (e.g. "write the last line Status: continue and end") for
// a finished file — the prompt itself contains that instruction and sessions
// often restate it (2026-09-17 review H3). The protocol puts the line last, so
// the last matching line wins: a bare `Status: done` earlier in the body (a
// per-step note) must not override the closing `Status: continue`.
//
// The two handovers use the line differently. handoff.md's steer only
// *suggests* a handover; a session that genuinely finished needs none, so
// `done` is a real exit and runSubtask closes out on it. A test handover has
// no such exit: the test result must be read by the next session, so there is
// always work after the handover and `done` is unreachable — test-wrapup.md
// asks only for `Status: continue`, and the driver consumes only "is the line there"
// (handover.ts handoffComplete), never branching on the value. Parsing still
// accepts both values: a session that wrote `done` anyway is better treated as
// finished than sent back to rewrite a supposedly half-written file.
export type HandoffStatus = "continue" | "done"

// The last `Status: continue|done` line wins. The pre-flip `状态: 继续|完成`
// spelling is no longer read (M3.7, root open question 17: legacy projects are
// a usage error, and an old-spelling override template fails its marker check).
export function handoffStatus(text: string): HandoffStatus | undefined {
  const m = [...text.matchAll(/^[ \t]*Status[:：][ \t]*(continue|done)[ \t]*$/gim)].at(-1)
  if (!m) return undefined
  return m[1]!.toLowerCase() === "continue" ? "continue" : "done"
}

// The four mandatory sections of a phase handover (F.1 protocol): shared by
// the distillation session's collect check and the prompt template's tier-1
// markers (phase-handover.md inlines the same headings). Driver protocol
// strings (0035 §4 phase face), flipped from the Chinese headings in M3.8 with
// no dual-read.
export const HANDOVER_SECTIONS = ["## Key decisions", "## Constraints and pitfalls", "## Required reading for the next phase", "## Artifact index"]

// The closing mark of the prior-knowledge document: its last non-empty line
// (src/knowledge.ts priorKnowledgeComplete; prior-knowledge.md tier-1 marker).
// Driver protocol string (0035 §4 phase face), flipped from `完成` in M3.8 with
// no dual-read.
export const PRIOR_KB_DONE = "DONE"

// Whether a phase handover has all four sections: each heading must be an
// exact standalone line (a ### subheading does not count — "### Key decisions"
// contains the substring but is not a compliant heading).
export function validHandover(text: string): boolean {
  return HANDOVER_SECTIONS.every((section) => text.split("\n").some((line) => line.trim() === section))
}

// —— result line ——

// The result line — the driver's only completion-side verdict: the task
// report's (FAIL stops the run) and, since M4.2, an acceptance-type phase's
// verdict.md (the verdict gate, plans/0049 G7). Protocol: `Result: PASS` or
// `Result: FAIL <reason>`, written verbatim by the wrap-up session (when to write it is intent content,
// `## acceptance` / `### result-line`). The last line starting with `Result:`
// decides; a value other than PASS/FAIL there, or no such line, is no verdict
// (the run does not stop). Case-sensitive like the other protocol lines.
export type ReportResult = { type: "pass" } | { type: "fail"; reason: string }

export function parseResult(text: string): ReportResult | undefined {
  const lines = text.split("\n")
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim()
    if (!line.startsWith("Result:")) continue
    const match = /^Result:[ \t]*(PASS|FAIL)(?![\w-])[ \t:—-]*(.*)$/.exec(line)
    if (!match) return undefined
    return match[1] === "PASS" ? { type: "pass" } : { type: "fail", reason: match[2]!.trim() }
  }
  return undefined
}

// —— phaseAcceptance role: the sign-off marker ——

// The human's sign-off line in a phase's acceptance.md (0036 D8, plans/0049
// G7). Driver protocol string; the handover session drafts the file but must
// never write this line.
export const ACCEPTED_MARK = "Accepted: yes"

// Whether an acceptance record carries an `Accepted:` line at all (a draft
// holding one is a forged sign-off) and whether the last such line is exactly
// the sign-off. Whole-line, case-sensitive, like the other protocol lines.
export function acceptanceMark(text: string): { present: boolean; accepted: boolean } {
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("Accepted:"))
  return { present: lines.length > 0, accepted: lines.at(-1) === ACCEPTED_MARK }
}
