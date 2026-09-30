import { rm } from "node:fs/promises"
import { join } from "node:path"
import { parseIndex } from "./document/unit"
import { renderNumberRecovery } from "./prompt"
import { promptFacts } from "./prompt-facts"
import type { ClientSource, Opts, UnitStop } from "./opts"
import { requireArtifact } from "./artifact"

// The --auto-number (config.autoNumber) task-numbering record mechanism: task
// numbers (T-NNN) never repeat in the target directory; the next available
// number is persisted in .auto/next-task (a driver-maintained state file;
// .auto/ is already gitignored, so a fresh clone naturally lacks it). The
// phase planning session continues numbering from that record (no longer
// restarting from T-001 every phase); a missing record is recovered first,
// then numbering continues — with no historical evidence at all (a brand-new
// project) write 1 directly; with historical evidence, open a one-shot bypass
// AI recovery session that reads through the task indexes / docs artifacts /
// git history to derive the next number (git history may hold numbers whose
// artifacts have since been deleted, invisible to a pure file scan); the
// driver validates its output against the floor of the deterministic scan.
// Under --no-auto-number (the opt-out switch) this whole file is inert.

// The numbering record file (relative to the target directory): its content is
// a single positive integer (the next available number).
export const NEXT_TASK_FILE = join(".auto", "next-task")

// Task-number extraction: only the T-<digits-only> form counts (final-audit
// ids like T-F are a separate derivation namespace, not part of the auto
// numbering record).
export function taskNumber(id: string): number | undefined {
  const match = /^T-(\d+)$/.exec(id)
  return match ? Number(match[1]) : undefined
}

export async function readNextTask(dir: string): Promise<number | undefined> {
  const text = await Bun.file(join(dir, NEXT_TASK_FILE)).text().catch(() => undefined)
  if (text === undefined) return undefined
  const n = Number(text.trim())
  return Number.isInteger(n) && n >= 1 ? n : undefined
}

export async function writeNextTask(dir: string, n: number): Promise<void> {
  await Bun.write(join(dir, NEXT_TASK_FILE), `${n}\n`)
}

// Deterministic floor of used numbers: scan every round's and phase's task
// indexes (docs/R-*/P*/tasks.md, M3.4) and task directories (path segments of
// docs/**/T-*/*.md — the task units' todo.md/done.md live right there), take
// the maximum number + 1;
// no evidence = 1. Sees only surviving files — numbers taken by since-deleted
// artifacts are completed by the AI recovery session reading git history.
export async function taskNumberFloor(dir: string): Promise<number> {
  let max = 0
  const seen = (id: string) => {
    const n = taskNumber(id)
    if (n !== undefined) max = Math.max(max, n)
  }
  for await (const file of new Bun.Glob(join("docs", "R-*", "P*", "tasks.md")).scan({ cwd: dir, onlyFiles: true })) {
    const text = await Bun.file(join(dir, file)).text().catch(() => "")
    for (const entry of parseIndex(text, "task").entries) seen(entry.id)
  }
  // Directory-layout: docs/**/T-*/*.md, take the first T-<digits-only> path
  // segment (a T-F<k> anchor segment is filtered out naturally by taskNumber).
  for await (const file of new Bun.Glob(join("docs", "**", "T-*", "*.md")).scan({ cwd: dir, onlyFiles: true })) {
    for (const segment of file.split(/[\\/]/)) {
      if (/^T-\d+$/.test(segment)) {
        seen(segment)
        break
      }
    }
  }
  return max + 1
}

// Advance the numbering record after a planning session's output: take the
// maximum number in this task index + 1 (grows only, never shrinks; a number
// below the existing record leaves it untouched — the collect already rejects
// that case, this is only a backstop).
export async function advanceNextTask(dir: string, ids: string[]): Promise<number> {
  const used = Math.max(0, ...ids.map((id) => taskNumber(id) ?? 0))
  const next = used + 1
  const current = await readNextTask(dir)
  if (current === undefined || next > current) await writeNextTask(dir, next)
  return Math.max(next, current ?? 0)
}

// Ensure the numbering record is in place (called before a planning session):
// with the record present, return directly; when missing, recover first — a
// floor of 1 (no historical evidence at all, a brand-new project) writes 1
// directly with no session; otherwise open a one-shot bypass AI recovery
// session (mirroring knowledge.ts's requireArtifact skeleton; the pseudo task
// PLAN enters no task chain and writes no progress record), artifact = a
// valid .auto/next-task written by the AI; the driver validates against the
// deterministic floor (below the floor counts as an invalid artifact: retry
// once with feedback, still failing blocks silently).
export async function ensureNumbering(
  client: ClientSource,
  dir: string,
  opts: Opts,
): Promise<{ type: "ok"; next: number } | UnitStop> {
  const existing = await readNextTask(dir)
  if (existing !== undefined) return { type: "ok", next: existing }
  const floor = await taskNumberFloor(dir)
  if (floor === 1) {
    await writeNextTask(dir, 1)
    return { type: "ok", next: 1 }
  }
  const recovered = await requireArtifact(
    client,
    { id: "PLAN", title: "task numbering record recovery", status: "in_progress", attempts: 0, body: "" },
    renderNumberRecovery(promptFacts(opts), { floor }),
    opts,
    {
      kind: "numbering recovery",
      role: "number-recovery",
      // Independent hidden task unit (plans/0021-commit-boundary-design.md). The artifact
      // .auto/next-task is gitignored and touches no tracked file; the gate mainly covers
      // the close-out check and any other file the session might touch.
      unitStart: true,
      artifact: `a valid numbering record ${NEXT_TASK_FILE} (a positive integer not below ${floor})`,
      detail: "missing, not a positive integer, or below the used-number floor",
      requirement: `write the derived next available task number to ${NEXT_TASK_FILE}: the file holds only a positive integer not below ${floor} (a trailing newline is fine), nothing else.`,
      commit: { stage: "numbering", subject: "PLAN numbering next-task record recovery" },
      reset: () => rm(join(dir, NEXT_TASK_FILE), { force: true }),
      collect: async () => {
        const n = await readNextTask(dir)
        return n !== undefined && n >= floor ? n : undefined
      },
    },
  )
  if (typeof recovered === "number") return { type: "ok", next: recovered }
  return recovered
}
