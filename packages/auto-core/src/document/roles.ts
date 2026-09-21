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
//     whose role is not a process role (p1Scope).
// Legacy flat-layout names classify like their directory-layout successors
// (D4 compat read): docs/T-003.context.md is an artifact, docs/T-003.handoff.md
// a handoff.
//
// Standardization boundary. The driver's protocol markers constrain exactly
// two kinds of file: the index and state files it parses (PLAN.md, the phase
// ledger, subtasks.md checklist items and their `Artifacts:` declarations, the
// todo.md section anchors, the report result line) and the handoff documents
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
import { PHASE_ACCEPTANCE_NAME } from "../docpaths"
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
  // Driver-appended line protocol; a terminator would break append-only.
  ledger: { eofScan: false, process: true },
  // Carries its own final-state contract (status line / four sections).
  handoff: { eofScan: false, process: true },
  // Human-written; the M3 gate reads its acceptance marker, not a terminator.
  phaseAcceptance: { eofScan: false, process: true },
  artifact: { eofScan: true, process: true },
  // The deliverable and the project's own documents: .md files changed in a
  // unit still carry the terminator (the D6 whole-unit scan predates roles).
  freeform: { eofScan: true, process: false },
}

// Fixed-location driverState files besides PLAN.md/CURRENT.md. With those two
// they form PROTECTED_FILES; .auto/ is driverState too but is rewritten
// continuously by the driver, so it is guarded by the prompt contract alone.
const DRIVER_STATE_PATHS = ["opencode.json", ".opencode/auto/config.json"]

// PLAN.md/CURRENT.md classify by file name: under the round-directory layout
// the root PLAN.md is a symlink and git reports the link target
// docs/R-NN/PLAN.md, and phase archives keep PLAN.md snapshots.
const DRIVER_STATE_NAMES = ["PLAN.md", "CURRENT.md"]

// Read-only during a run (protect.ts). Every entry must classify as
// driverState — asserted by test/document-roles.test.ts.
export const PROTECTED_FILES = ["PLAN.md", "CURRENT.md", "opencode.json", ".opencode/auto/config.json"] as const

// The session handoff family by file name: handoff.md, testhandoff.md, the
// archived testhandoff-<n>.md and the old flat names <id>.handoff.md,
// <id>(-S<n>).testhandoff(-<n>).md.
const HANDOFF_NAME = /^(?:.+\.)?(?:test)?handoff(?:-\d+)?\.md$/

// Phase ledger: docs/R-NN/phases.md, legacy root docs/phases.md.
const LEDGER = /^docs\/(?:R-\d+\/)?phases\.md$/

// Phase handover distillations: docs/R-NN/handovers/<letter>-<slug>.md, legacy
// docs/handovers/R<N>-<letter>-<slug>.md, and the pre-P2 placement inside the
// phase archive (<archive>/handover.md, still read by the fallback ladder).
const PHASE_HANDOVER = /^docs\/(?:(?:R-\d+\/)?handovers\/[^/]+|(?:R-\d+|phases)\/[a-z]-[^/]+\/handover)\.md$/

// Phase acceptance records inside a phase's free-artifact directory (modern
// docs/R-NN/phase-docs/<letter>-<slug>/, legacy docs/phase-docs/R<N>-<letter>-<slug>/).
// `acceptance-r<n>.md` is accepted too, leaving per-iteration naming open to
// the M3 gate without a role change.
const PHASE_ACCEPTANCE = new RegExp(
  `^docs/(?:R-\\d+/phase-docs/[a-z]-[^/]+|phase-docs/R\\d+-[a-z]-[^/]+)/${PHASE_ACCEPTANCE_NAME.replace(".md", "")}(?:-r\\d+)?\\.md$`,
)

// Everything else the tool keeps under docs/: task documents (directory and
// legacy flat names), round directories, legacy phase archives, handovers,
// free phase documents and the legacy knowledge-document directories.
const PROCESS_DOCS = /^docs\/(?:T-[^/]+|R-\d+|phases|handovers|phase-docs|migration-kb|prior-kb)(?:\/|$)/

// The role of a path relative to the target directory. Pure: classification
// is by path shape only, never by content or existence.
export function roleOf(rel: string): DocumentRole {
  const path = rel.replaceAll("\\", "/").replace(/^\.\//, "")
  if (path === ".auto" || path.startsWith(".auto/")) return "driverState"
  if (DRIVER_STATE_PATHS.includes(path)) return "driverState"
  const name = path.split("/").at(-1) ?? path
  if (DRIVER_STATE_NAMES.includes(name)) return "driverState"
  if (HANDOFF_NAME.test(name)) return "handoff"
  if (!path.startsWith("docs/")) return "freeform"
  if (LEDGER.test(path)) return "ledger"
  if (PHASE_HANDOVER.test(path)) return "handoff"
  if (PHASE_ACCEPTANCE.test(path)) return "phaseAcceptance"
  if (PROCESS_DOCS.test(path)) return "artifact"
  return "freeform"
}

// Whether a path is exempt from the whole-unit document terminator scan
// (session-boundary-hardening §4.6 D6), derived from its role.
export function eofScanExempt(rel: string): boolean {
  return !ROLE_POLICIES[roleOf(rel)].eofScan
}

// Agent-contract surfaces: freeform by role (the project owns them), but
// they legitimately name process paths — the AGENTS.md pointer block tells
// sessions where PLAN.md and docs/T-NNN live, and .opencode/ holds the agent
// contract and the project's prompt/mode/intent overlays. Outside P1 scope.
function contractSurface(path: string): boolean {
  return path === "AGENTS.md" || path.startsWith(".opencode/")
}

// Whether a path belongs to the deliverable side P1 protects: a non-process
// role and not an agent-contract surface.
export function p1Scope(rel: string): boolean {
  const path = rel.replaceAll("\\", "/").replace(/^\.\//, "")
  return !ROLE_POLICIES[roleOf(path)].process && !contractSurface(path)
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

// Dual-read (M2.4, plans/0035 D5): the English `Status: continue|done` is the
// written form; the pre-flip `状态: 继续|完成` still parses because archived
// handoff.md / testhandoff-<n>.md files are re-read on recovery. Both forms
// normalize to the English value so no comparison site sees the old literals.
export function handoffStatus(text: string): HandoffStatus | undefined {
  const m = [...text.matchAll(/^[ \t]*(?:Status|状态)[:：][ \t]*(continue|done|继续|完成)[ \t]*$/gim)].at(-1)
  if (!m) return undefined
  return /^(?:continue|继续)$/i.test(m[1]!) ? "continue" : "done"
}

// The four mandatory sections of a phase handover (F.1 protocol): shared by
// the distillation session's collect check and the prompt template's tier-1
// markers (phase-handover.md inlines the same headings).
export const HANDOVER_SECTIONS = ["## 关键决策", "## 约束与坑", "## 下一阶段必读清单", "## 产物索引"]

// Whether a phase handover has all four sections: each heading must be an
// exact standalone line (a ### subheading does not count — "### 关键决策"
// contains the substring but is not a compliant heading).
export function validHandover(text: string): boolean {
  return HANDOVER_SECTIONS.every((section) => text.split("\n").some((line) => line.trim() === section))
}
