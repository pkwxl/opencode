// Document domain — the P1 prohibition scan (M2.3, plans/0045; root plan D12,
// 0036 D9): the deliverable must not reference process documents, so a
// reference found in what a unit added is a close-out problem, not something
// to resolve. The scan is a prohibition, not a resolution: it needs no tree
// index and never asks whether the path exists.
//
// Scope: the lines the unit added (git.ts unitAddedLines) in files on the
// deliverable side (roles.ts p1Scope — non-process roles minus the
// agent-contract surfaces). Never the existing tree: retroactively failing
// older content is not the driver's business (the whole-tree scan is the
// round-close gate, M4).
//
// Keyed on tool-owned path shapes, not on the bare word `docs/`, so the scan
// is safe in a tree with its own documentation directory:
//   docs/T-…, docs/R-<n>…, docs/phases/…, root PLAN.md, .auto/…
// A bare task id (T-NNN) is only a warning — register names, hardware
// designators and project conventions make it too noisy to block on.
//
// AUTO-* marker lines are held to the same rule: a mark may sit in a code
// comment, a pointer into the process side may not.
//
// Pure: no IO; the caller supplies the added lines and logs the warnings.
import { p1Scope } from "./roles"
import type { AddedLine } from "./types"

// Tool-owned path shapes. Each alternative refuses a preceding word/path
// character so neighbours like `mydocs/T-1`, `x.auto/` or `docs/R-01/PLAN.md`'s
// own `PLAN.md` segment do not match twice or by accident; the trailing run
// captures the rest of the path for the message.
const PROCESS_PATH =
  /(?:(?<![\w.-])docs\/(?:T-\w|R-\d|phases\/)|(?<![\w./-])(?:\.\/)?PLAN\.md(?!\w)|(?<![\w.-])\.auto\/)[^\s"'`<>()[\]{},;]*/g

// A bare task id: T-NNN (three or more digits), not part of a longer word.
const TASK_ID = /(?<![\w-])T-\d{3,}(?![\w])/

// Per-file cap on reported hits: enough to act on, short enough for feedback.
const MAX_HITS_PER_FILE = 3

export type ProcessReferenceScan = {
  // Violations: the unit's output is not acceptable until they are removed.
  problems: string[]
  // Bare task-id mentions: logged, never blocking.
  warnings: string[]
}

export function processReferenceScan(added: ReadonlyMap<string, readonly AddedLine[]>): ProcessReferenceScan {
  const problems: string[] = []
  const warnings: string[] = []
  for (const [rel, lines] of [...added].sort(([a], [b]) => a.localeCompare(b))) {
    if (!p1Scope(rel)) continue
    const hits: string[] = []
    let ids = 0
    for (const { line, text } of lines) {
      const found = [...text.matchAll(PROCESS_PATH)].map((m) => m[0].replace(/[.:]+$/, ""))
      if (found.length) hits.push(`${rel}:${line} references ${found.map((path) => `"${path}"`).join(", ")}`)
      else if (TASK_ID.test(text)) ids++
    }
    if (hits.length) {
      const shown = hits.slice(0, MAX_HITS_PER_FILE)
      const more = hits.length - shown.length
      problems.push(
        `${shown.join("; ")}${more ? ` (and ${more} more in this file)` : ""} — deliverable files must not reference process documents ` +
          `(docs/T-*, docs/R-*, docs/phases/, PLAN.md, .auto/): restate the needed content in place and remove the path`,
      )
    }
    if (ids) warnings.push(`${rel}: ${ids} added line(s) mention a task id (T-NNN); deliverable text should not point at process records`)
  }
  return { problems, warnings }
}
