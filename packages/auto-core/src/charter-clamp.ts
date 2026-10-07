// Charter-clamped provisional defaults (plans/0082 §10 D12, closing RC2):
// every AUTO-RESOLVE default a session records gets one cheap one-shot
// charter check at the post-session scan that already collects the markers
// (git-ops.ts collectSessionMarks calls clampRecordedResolves after
// collectAgentResolves). A default the check flags is clamped: the marker
// line is re-recorded so the default *in force* is the charter-consistent
// reading, and the wider grant it wanted becomes the OPEN question's option;
// the ledger marks the clamp and the phase boundary surfaces one OPEN line
// per clamped item. Whether the person reads the flag never decides
// correctness — the pipeline proceeds under the clamped reading, and the
// person may widen a wall by answering the round report or through the
// charter channel (pack-amend).
//
// AUTO-DECISION (check site): the design names the post-session scan; the
// scan's collector (resolve.ts) is a pure ledger leaf with no client, so the
// check rides the scan's one caller that holds the run's server control.
// The check itself is the 0080 verifier's call (src/prompt-verify.ts
// checkTextAgainstCharter) and reaches this module through the setter
// injection the log.ts family established: the type-counted import graph
// forbids git-ops (kernel, below the services holder) from reaching the
// classifier's policies layer, so the run start (loop.ts, after the routing
// facts exist) wires the caller and the finally clears it — no caller, no
// check (the same degenerate floor the verifier's own inactive arm holds).
// Markers in deliverable/code files are clamped in the ledger only (editing
// code comments mechanically is unsafe); the pipeline's consumption path
// — the handover and the prompts — is covered by the re-record plus
// D13/D14.
import { join } from "node:path"
import { pendingClampItems, parseResolveLine, recordClamp, resolvesOf, sameIssue, type ResolveItem } from "./resolve"

// The check caller the run start wires (prompt-verify's
// checkTextAgainstCharter over the run's server and routing; structural so
// this module reaches no policies layer).
export type ClampCaller = (input: { dir?: string; intent?: string; label: string; text: string }) => Promise<
  { kind: "skipped" } | { kind: "consistent" } | { kind: "flagged"; reading: string }
>

let clampCaller: ClampCaller | undefined

// Wire (or clear) the run's check caller — the log.ts setter-injection
// family. Without a caller the clamp is inert: items stay pending, nothing
// re-records, nothing surfaces (commands without the run's server never
// check, exactly as a run without a classifier entry never asks).
export function setClampCaller(caller: ClampCaller | undefined): void {
  clampCaller = caller
}

// The clamp's run (called at the post-session scan site): check every
// pending recorded default once, re-record flagged markers, mark the ledger.
// Returns the surfacing lines (one per clamped item — the phase boundary
// prints them). Auditing discipline: never throws into the caller's flow;
// one catch swallows everything (the resolve.ts convention).
export async function clampRecordedResolves(dir: string | undefined, intent?: string): Promise<string[]> {
  if (!dir || clampCaller === undefined) return []
  try {
    const items = await pendingClampItems(dir)
    const lines: string[] = []
    for (const item of items) {
      const text = [item.question, item.option, item.reason].filter((part): part is string => part !== undefined).join(" → ")
      const check = await clampCaller({ dir, intent, label: `the recorded AUTO-RESOLVE default of ${item.task} (${item.file ?? "unlocated marker"})`, text })
      if (check.kind === "skipped" || check.kind === "consistent") {
        // Checked either way: the item never re-checks on later scans (a
        // consistent default keeps its recorded reading in force).
        await recordClamp(dir, item)
        continue
      }
      await clampItem(dir, item, check.reading)
      lines.push(clampLine(item, check.reading))
    }
    return lines
  } catch {
    return []
  }
}

// Clamp one item: the ledger mark plus, for markers in Markdown process
// documents, the re-record (D12) — the marker line is rewritten so the
// default in force is the clamped reading and the wider grant rides inside
// as the OPEN option. A marker whose line no longer matches (edited, moved)
// is ledger-clamped only.
async function clampItem(dir: string, item: ResolveItem, reading: string): Promise<void> {
  await recordClamp(dir, item, reading)
  if (item.file === undefined) return
  const split = item.file.lastIndexOf(":")
  const rel = item.file.slice(0, split)
  const lineText = Number(item.file.slice(split + 1))
  if (!rel.endsWith(".md") || !rel.startsWith("docs/") || !Number.isFinite(lineText)) return
  const path = join(dir, rel)
  const raw = await Bun.file(path).text().catch(() => undefined)
  if (raw === undefined) return
  const lines = raw.split("\n")
  const reRecorded = clampMarkerLine(item, reading)
  if (reRecorded === undefined) return
  const at = lines.findIndex((line, index) => index === lineText - 1 || sameIssueLine(line, item))
  if (at < 0) return
  lines[at] = reRecorded
  await Bun.write(path, lines.join("\n"))
}

function sameIssueLine(line: string, item: ResolveItem): boolean {
  const parsed = parseResolveLine(line)
  return parsed !== undefined && sameIssue(parsed.question, item.question)
}

// The re-recorded marker line (parseResolveLine-compatible: one arrow, a
// trailing parenthesized reason with no nested parens).
export function clampMarkerLine(item: ResolveItem, reading: string): string | undefined {
  const clean = (text: string): string => text.replace(/[()（）]|->|=>|→/g, " ").replace(/\s+/g, " ").trim()
  const question = clean(item.question)
  const option = clean(item.option ?? "")
  const reason = clean(item.reason ?? "recorded provisional default")
  const safeReading = clean(reading)
  if (!question || !safeReading) return undefined
  return `AUTO-RESOLVE: ${question} -> ${safeReading} (${reason}; charter-clamped by the driver, 0082 D12 — the wider grant "${option || "the recorded default"}" is OPEN until the person rules)`
}

// The phase-boundary surfacing line (D12): one line naming the OPEN question.
export function clampLine(item: ResolveItem, reading: string): string {
  return `⚡ OPEN question (charter-clamped): ${item.question} — the default in force is "${reading}"; the recorded wider grant waits for your ruling (the round report's needs-attention section lists it)`
}

// The scope's clamped items (the phase-close lines read this).
export async function clampedItemsOf(dir: string | undefined, scope: "phase" | "round", id: string | number): Promise<ResolveItem[]> {
  const items = await resolvesOf(dir, scope, id).catch(() => [])
  return items.filter((item) => item.clamped === true)
}
