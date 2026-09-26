// The single construction point for task-document paths (stable-refs design
// §4.1, plans/0010-stable-refs-design.md): task documents (the seven role
// files + subtask artifacts) exist only inside docs/T-NNN/ (R3
// directory-ization), role file names are fixed (R4), and a path, once
// created, is a permanent path (R2) — the driver, prompt templates and read
// fallback unify their three views through this module; callers must not
// concatenate strings themselves. Legacy layouts (flat docs/<id>.<role>.md,
// docs/T-NNN/SNN.md, docs/T-NNN-S<k>.testhandoff.md, flat docs/prior-kb/)
// have no read fallback since M3.7 (plans/0047 R3): an old project is a
// usage error, never read silently. The round-specific directories
// (roundDir/roundDirName, docs/R-NN) and the in-round prior-knowledge
// document path (priorKnowledgeDoc, a fixed name within the round) are also
// constructed here; paths inside the phase directory (handover, acceptance,
// the k phase's knowledge document kb.md) depend on the phase unit and live
// in src/phases.ts (the deviation note is in the design document §4.1);
// upstream clauses: R1 unique numbering, R2 permanence, R3
// directory-ization, R4 role file names, R5 archive semantics, R6 temporary
// files, R7 phase-difference expression.
import { readdir } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

// Task-document roles (R4: role file names fixed); index (the subtask
// artifact) is constructed only through subtaskDoc. shared is the
// common-context reference index of the M1.0 merged understand+decompose
// session (plans/0030 D3).
export type TaskRole = "context" | "shared" | "subtasks" | "report" | "handoff" | "testhandoff"

// Subtask numbers zero-padded to two digits (S2 → S02), three digits carry
// over naturally (matching the existing padStart(2,"0") convention).
const pad2 = (k: number) => String(k).padStart(2, "0")

// —— New-layout constructors (return target-directory-relative paths) ——

// docs/T-003
export function taskDir(id: string): string {
  return join("docs", id)
}

// docs/T-003/context.md
export function taskDoc(id: string, role: TaskRole): string {
  return join(taskDir(id), `${role}.md`)
}

// docs/T-003/S04
export function subtaskDir(id: string, k: number): string {
  return join(taskDir(id), `S${pad2(k)}`)
}

// docs/T-003/S04/index.md (the subtask artifact),
// docs/T-003/S02/testhandoff.md (the subtask-level test handover) and
// docs/T-003/S04/todo.md|done.md (the subtask directory state protocol, M1.0
// plans/0030: todo.md = the scope statement fixed during decomposition,
// done.md = the fact of completion DRIVER renames it to at subtask
// close-out).
export function subtaskDoc(id: string, k: number, role: "index" | "testhandoff" | "todo" | "done"): string {
  return join(subtaskDir(id, k), `${role}.md`)
}

// —— Permanent knowledge-document paths (the round-specific directory
// docs/R-NN, created at round start, permanent once on disk) ——

// Round directory name: R-NN (zero-padded to two digits after the R, e.g.
// R-01, carrying over naturally R-99 → R-100); it and docs/T-NNN form the
// two top-level namespaces under docs/ side by side (T = task documents
// with cross-round permanent numbering, R = self-contained round
// containers).
export function roundDirName(round: number): string {
  return `R-${pad2(round)}`
}

// docs/R-01 (the round-specific directory)
export function roundDir(round: number): string {
  return join("docs", roundDirName(round))
}

// docs/R-NN/prior-kb.md (the prior-knowledge document; a fixed name within
// the round — a new round's directory is always empty, so prior knowledge
// must be distilled anew, replacing the old round-prefix guard).
export function priorKnowledgeDoc(round: number): string {
  return join(roundDir(round), "prior-kb.md")
}

// The intermediate artifact of prior-knowledge extraction (not yet
// pen-down; robustness protocol, see specialized-tool-design §3): the AI
// writes only this file, and only after the driver confirms the trailing
// `DONE` closing mark is it renamed to the formal knowledge document
// (completion = the rename on disk + the commit). Fixed name, appearing in
// no existing-content scan (existingDistilledDocs/priorKnowledgeDigest read
// only the formal artifact), never treated as existing knowledge.
export const TEMP_KB_NAME = "temp-kb.md"

// The intermediate artifact shares the formal artifact's directory:
// docs/R-NN/temp-kb.md. final is the formal artifact's relative path
// (priorKnowledgeFile).
export function tempPriorKnowledgeDoc(final: string): string {
  return join(dirname(final), TEMP_KB_NAME)
}

// File name of a phase's acceptance record (the phaseAcceptance role, M2.3,
// plans/0045): one per phase inside the phase directory docs/R-NN/P<nn>-<type>/
// (phases.ts phaseAcceptanceDoc builds the path). Written by a human, read by
// the acceptance gate (0036 D8, M4.2).
export const PHASE_ACCEPTANCE_NAME = "acceptance.md"

// The round brief (roundBrief role, M4.2, plans/0049 G2): docs/R-NN/round.md,
// stubbed at round start and written by a human. Planning sessions read it; the
// round-close gate reads its `## Close` section.
export const ROUND_BRIEF_NAME = "round.md"

export function roundBriefPath(round: number): string {
  return join(roundDir(round), ROUND_BRIEF_NAME)
}

// File name of a phase's planning input (planningInput role, plans/0053 D9–D10):
// one per phase directory docs/R-NN/P<nn>-<type>/, the latest `plan -p` /
// `--file` text verbatim, written and committed by the driver before the
// planning unit (src/plan-input.ts builds the path and owns the file).
export const PLAN_INPUT_NAME = "plan-input.md"

// —— Archived copies of the test handover document (test-handover
// front-loading design D4) ——
//
// The current copy is always testhandoff.md (the session's write target);
// at handover close-out the driver renames it to testhandoff-<n>.md to
// archive it — the new session reads the latest copy, earlier copies
// remain as a traceable chain. The construction rule is "strip the .md
// suffix, append -<n>.md" (docs/T-003/S02/testhandoff-1.md).
export function archivedTestHandoff(handoff: string, n: number): string {
  return `${handoff.replace(/\.md$/, "")}-${n}.md`
}

// The largest number of existing archived copies in the same directory
// (mirrors runner.ts's latestTestSeq: scan the directory and take the max;
// numbering continues across sessions/runs, interruption recovery never
// restarts from 1); returns 0 when the directory is missing or holds no
// archived copies.
export async function latestHandoffSeq(dir: string, handoff: string): Promise<number> {
  const stem = basename(handoff).replace(/\.md$/, "")
  const re = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)\\.md$`)
  let max = 0
  for (const name of await readdir(join(dir, dirname(handoff))).catch(() => [] as string[])) {
    max = Math.max(max, Number(re.exec(name)?.[1] ?? 0))
  }
  return max
}
