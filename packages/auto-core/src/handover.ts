import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { handoffStatus } from "./document/roles"

// Interruption recovery of the test handover (--handover-test), see
// plans/0023-test-handover-early-design.md §I.
//
// The sequence of one test handover: freeze commit #1 → the session wraps up
// and writes the handover document → archived as testhandoff-<n>.md → handover
// commit #2 → run the script consumed at the freeze point → open the
// continuation session. Wherever along it the driver is interrupted, a re-run
// must land back exactly at the interrupted position — the criteria are
// **file state × commit state**: does the handover document exist, is it
// complete, was it archived, is the archived copy committed. This module
// provides that determination (pure functions, amenable to exhaustive unit
// tests) plus the on-disk record of the identity information it needs that
// files and commits cannot derive (the pending script, the session anchor
// available for a fork).

// In-flight handover record (.auto/handover.json): stores only what the
// observables cannot derive. Losing the record does not disable the mechanism —
// file and commit state still determine the stage; it only degrades to "not
// knowing which script to run, no session to fork", continuing from the most
// recent test output.
export type Handover = {
  task: string
  // Path of the handover document relative to the target directory
  // (docs/<id>/testhandoff.md or docs/<id>/S<kk>/testhandoff.md), doubling as the
  // execution scope identity — the record is valid for this scope only.
  scope: string
  // For commit message construction (watch does not hold the execution scope
  // label; it is carried down through the freeze point).
  unit: string
  n: number
  // The pending script and archive sequence number obtained by consuming
  // tmp/test.sh at the freeze moment; the run itself happens only after the
  // handover close-out.
  script?: string
  seq?: number
  // The agent profile the recorded sessions live on (plans/0055 §8.2), next
  // to their ids: session ids are agent-local, so the record carries the
  // agent of `pinSession`/`nextSession`. Written only under a model registry
  // (without one the file stays byte-identical); an absent field means the
  // default agent's session, so records written before the binding stay
  // valid.
  agent?: string
  // The session and last message id at the freeze moment: when the wrap-up is
  // unfinished, a new session is forked from here to redo the wrap-up (a fork
  // copies the messages before target, so the anchor is the one **after** the
  // last message).
  pinSession?: string
  pinMessage?: string
  // The continuation session opened after close-out: it can itself be
  // interrupted; recovery forks from it.
  nextSession?: string
  // Persisted execution result of the freeze-point script (F6 revision,
  // 2026-09-17): written into the record as soon as the close-out run settles —
  // a local script always finishes except on power loss/forced kill, so having
  // run counts as complete and recovery never runs it again, referencing the
  // persisted output through this record (see the design document
  // plans/0023-test-handover-early-design.md §M).
  // The structure matches TestRunInfo (a structured declaration avoids the
  // handover → prompt reverse dependency).
  ran?: {
    script: string
    seq: number
    code: number
    ms: number
    timedOut: boolean
    timeoutReason?: "idle" | "max"
    out: string
  }
}

const FILE = join(".auto", "handover.json")

export async function saveHandover(dir: string, record: Handover): Promise<void> {
  await mkdir(join(dir, ".auto"), { recursive: true })
  await Bun.write(join(dir, FILE), JSON.stringify(record))
}

// Read the in-flight record belonging to this execution scope; returns
// undefined on a scope mismatch, a missing or corrupt file (the next execution
// scope must not continue the previous scope's handover — same rationale as
// naming the handover document by scope).
export async function recallHandover(dir: string, task: string, scope: string): Promise<Handover | undefined> {
  const raw = await Bun.file(join(dir, FILE)).text().catch(() => undefined)
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as Partial<Handover>
    if (parsed.task !== task || parsed.scope !== scope) return undefined
    if (typeof parsed.unit !== "string" || typeof parsed.n !== "number") return undefined
    return parsed as Handover
  } catch {
    return undefined
  }
}

// The in-flight record of any scope (no scope check): the pipeline head uses it
// to decide "does this task have a test handover in flight" — when in flight,
// no stale cleanup happens and the handover document goes to the recovery state
// machine.
export async function peekHandover(dir: string, task: string): Promise<Handover | undefined> {
  const raw = await Bun.file(join(dir, FILE)).text().catch(() => undefined)
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as Partial<Handover>
    return parsed.task === task && typeof parsed.n === "number" ? (parsed as Handover) : undefined
  } catch {
    return undefined
  }
}

export async function forgetHandover(dir: string): Promise<void> {
  await rm(join(dir, FILE), { force: true })
}

// Whether the handover document is fully written (F1/F2): having the status
// line means complete; lacking the status line but with the content already
// committed (tracked and matching the commit) also counts as complete — the
// file was whole at commit time, the missing line only means that content was
// written before the status-line convention. Non-empty content satisfying
// neither is treated as a "half-written file" (the driver died while the
// session was writing the file).
export function handoffComplete(content: string | undefined, committed: boolean): boolean {
  if (content === undefined || content.trim() === "") return false
  return handoffStatus(content) !== undefined || committed
}

// Where the handover sequence was interrupted:
// - none   no handover traces, the status-quo flow
// - wrapup freeze committed, wrap-up unfinished → fork from the freeze anchor
//          and redo the wrap-up
// - commit handover document fully written but not closed out → archive (if not
//          yet archived) + commit #2 + run + continuation session
// - test   archived copy already committed (commit #2 has happened) → run +
//          continuation session
// The determination looks at observables only; the record's presence does not
// change the stage, it only decides whether the "run" step re-runs the script
// from the record or degrades to referencing the most recent test output.
export type HandoverStage = "none" | "wrapup" | "commit" | "test"

// The observed sequence number for recovery and the base of the next archive
// number (anti-forgery: a session's own writing under the testhandoff-<n>.md
// naming family is not handover evidence). Stage observation treats the
// in-flight record's n as authoritative — the driver writes the record at
// handover close-out, pointing at the archive copy that was actually closed
// out; only a missing record (legacy sites from before the mechanism went
// live) falls back to a disk scan. The next archive number takes the max of
// both sides: even a wrongly written file lying on disk is not overwritten, the
// numbering skips past it (design document
// plans/0023-test-handover-early-design.md §I, 2026-09-17 revision).
export function handoverSeq(record: Handover | undefined, diskMax: number): { observed: number; nextBase: number } {
  const observed = record?.n ?? diskMax
  return { observed, nextBase: Math.max(diskMax, observed) }
}

// The closed-out count at the recovery entry (the initial value of handovers):
// while the record is not closed out (it still carries the pending script or
// the freeze anchor — both are voided together at close-out), record.n is the
// number **already allocated** to this in-flight handover, not the closed-out
// count. Taking handoverSeq's nextBase directly as the base, the recovery
// close-out's handovers++ would step past it — the archive skips a number, and
// the numbering of the freeze commit (`#n freeze`) and the close-out commit
// (`#n+1`) no longer matches. A closed-out record and the no-record disk-scan
// fallback keep nextBase's original meaning. When the disk scan is larger
// (wrongly written files in the naming family) it likewise does not overwrite:
// the base is still held up by diskMax.
export function closedHandovers(record: Handover | undefined, seq: { observed: number; nextBase: number }): number {
  if (record && (record.script !== undefined || record.pinSession !== undefined) && seq.nextBase === record.n && record.n > 0) {
    return record.n - 1
  }
  return seq.nextBase
}

export function handoverStage(observed: {
  // The in-flight record (only used to distinguish "wrap-up unfinished" from "never handed over").
  record?: Handover
  // The content of the current testhandoff.md (undefined/blank = not on disk)
  // and whether it is already committed.
  current?: string
  currentCommitted: boolean
  // Whether the archived copy testhandoff-<n>.md is on disk and already committed.
  archived: boolean
  archivedCommitted: boolean
}): HandoverStage {
  // An empty file is equivalent to not on disk: the session created the file
  // and was interrupted before writing; the content volume is zero.
  const current = observed.current?.trim() ? observed.current : undefined
  if (observed.archived) return observed.archivedCommitted ? "test" : "commit"
  if (handoffComplete(current, observed.currentCommitted)) return "commit"
  // Document incomplete (or not on disk): only with a freeze record does
  // "wrap-up unfinished" apply; no record and no document means no handover in
  // flight. Record present and document half-written → redo the wrap-up.
  if (observed.record) return "wrapup"
  // No record yet a half-written document remains (a legacy site from before
  // this mechanism went live): the content already written is still progress;
  // treat it as handed over and closed out, do not redo it from nothing.
  return current === undefined ? "none" : "commit"
}
