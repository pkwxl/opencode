// Document domain — the P1 prohibition scan (M2.3, plans/0045; root plan D12,
// 0036 D9): the deliverable must not reference process documents, so a
// reference found in what a unit added is a close-out problem, not something
// to resolve. The scan is a prohibition, not a resolution: it needs no tree
// index and never asks whether the path exists.
//
// Scope: the lines the unit added (git.ts unitAddedLines) in files inside a
// nested destination repository (plans/0108: the deliverable is exactly what
// a destination child repository's git manages — every file in the working
// directory outside them, test tooling and prompts/ included, is process
// workspace, never scanned) that sit on the deliverable side by role
// (roles.ts p1Scope — non-process roles minus the project's scan exemptions,
// plans/0059 X2). Completing 0103's line: all three finding families now key
// on destination membership. Never the existing tree: retroactively failing
// older content is not the driver's business (the whole-tree scan is the
// round-close gate, M4).
//
// Keyed on tool-owned path shapes, not on the bare word `docs/`, so the scan
// is safe in a tree with its own documentation directory:
//   docs/T-…, docs/R-<n>…, .auto/…
//
// Destination containment (plans/0103, ruled from spi-nor-glm's R-01 close):
// a file inside a nested repository (git.ts nestedRepoPrefixes) is a piece of
// a shipped, self-contained deliverable — the destination of a migration or
// an isolated component — and answers two rules there that the outer
// workspace does not: a bare task id (T-NNN) is a finding, not advisory
// noise (the register names and project conventions that kept the old check
// a warning live in the workspace's own tree; shipped code restates what the
// id pointed at), and no path the file adds may lead outside the
// repository's own root — a `..` chain climbing past the root, or an
// absolute path under the target directory. Their enforcement moment is the
// release gate (plans/0103 D2): while rounds still run the scan only
// RECORDS them (`deferred`, logged at close-out, listed at round close —
// the treatment is deliberately delayed because restating citations away is
// churn a working round should not be forced into), and `release`
// (src/release.ts) refuses while any remains. In the outer workspace a bare
// task id is acceptable content — the harness's own scripts name tasks
// freely — so no task-id check runs there at all.
//
// AUTO-* marker lines are held to the same rule: a mark may sit in a code
// comment, a pointer into the process side may not. The marks themselves are
// content, not references — their removal is editorial work the release gate
// deliberately does not demand (plans/0103 D3).
//
// Pure: no IO; the caller supplies the added lines and logs the findings.
import { p1Scope } from "./roles"
import type { AddedLine } from "./types"

// Tool-owned path shapes. Each alternative refuses a preceding word/path
// character so neighbours like `mydocs/T-1` or `x.auto/` do not match by
// accident; the trailing run captures the rest of the path for the message.
// PLAN.md and docs/phases/ left the list with the legacy layouts (M3.7): a
// project's own file of that name is no process document.
const PROCESS_PATH = /(?:(?<![\w.-])docs\/(?:T-\w|R-\d)|(?<![\w.-])\.auto\/)[^\s"'`<>()[\]{},;]*/g

// A bare task id: T-NNN (three or more digits), not part of a longer word.
const TASK_ID = /(?<![\w-])T-\d{3,}(?![\w])/

// A relative path built from `..` segments (at least one, slash-terminated),
// capturing the rest of the token for the message. Matched anywhere in the
// line: a path that climbs may sit inside quotes or markdown parentheses.
const REL_CLIMB = /(?:\.\.\/)+[^\s"'`<>()[\]{},;]*/g

// Per-file cap on reported hits: enough to act on, short enough for feedback.
const MAX_HITS_PER_FILE = 3

// The scan's repository context, derived by every caller from git.ts
// repoRoots or the unit baseline: `nested` the directory-relative path
// prefixes of the nested repositories inside the target, `dir` the target
// directory itself, `release` the release gate's enforcing posture — the
// containment findings become problems with release wording instead of
// recorded `deferred` lines. `nested` is also the P1 gate itself (plans/
// 0108): a file outside every prefix is workspace, not deliverable, and is
// skipped whole — an absent or empty list means no destination
// repositories, hence no scan surface (the workspace-only posture; release
// answers the same shape with "nothing to release").
export type ScanRepos = { nested?: readonly string[]; dir?: string; release?: boolean }

export type ProcessReferenceScan = {
  // Blocking everywhere: process-path references, and — under the release
  // posture — the containment findings below.
  problems: string[]
  // Destination containment while rounds still run: recorded, never
  // blocking; the release gate (src/release.ts, plans/0103 D2) enforces
  // them when the person is ready to ship.
  deferred: string[]
}

// `exempt` = the project's scan exemptions (config scanExempt, roles.ts
// scanExempted): deliverable files where process-shaped strings are content.
export function processReferenceScan(added: ReadonlyMap<string, readonly AddedLine[]>, exempt: readonly string[] = [], repos: ScanRepos = {}): ProcessReferenceScan {
  const problems: string[] = []
  const deferred: string[] = []
  for (const [rel, lines] of [...added].sort(([a], [b]) => a.localeCompare(b))) {
    const nested = repos.nested?.find((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))
    // The deliverable definition (plans/0108): only a nested destination
    // repository's own files are scanned — a workspace file (test tooling,
    // prompts/, the person's checkouts) is process side whatever its role.
    if (!nested || !p1Scope(rel, exempt)) continue
    const hits: string[] = []
    const outside: string[] = []
    let ids = 0
    for (const { line, text } of lines) {
      const found = [...text.matchAll(PROCESS_PATH)].map((m) => m[0].replace(/[.:]+$/, ""))
      if (found.length) hits.push(`${rel}:${line} references ${found.map((path) => `"${path}"`).join(", ")}`)
      else {
        const out = outsideRootReferences(rel, nested, text, repos.dir)
        if (out.length) outside.push(`${rel}:${line} references ${out.map((path) => `"${path}"`).join(", ")}`)
        else if (TASK_ID.test(text)) ids++
      }
    }
    if (hits.length) {
      const shown = hits.slice(0, MAX_HITS_PER_FILE)
      const more = hits.length - shown.length
      problems.push(
        `${shown.join("; ")}${more ? ` (and ${more} more in this file)` : ""} — the destination must not reference process documents ` +
          `(docs/T-*, docs/R-*, .auto/): restate the needed content in place and remove the path`,
      )
    }
    if (outside.length) {
      const shown = outside.slice(0, MAX_HITS_PER_FILE)
      const more = outside.length - shown.length
      const head = `${shown.join("; ")}${more ? ` (and ${more} more in this file)` : ""}`
      if (repos.release) {
        problems.push(`${head} — no path may lead outside the destination's own root: vendor or restate what it pointed at, then re-run release`)
      } else {
        // AUTO-DECISION (wording, 0106): the remedy clause is part of the
        // record — the field finding was a session reading "must shed" as
        // delete and stripping the AUTO-DECISION records by removal, which
        // loses the provenance the pointer anchored. The round-time lines
        // now carry the same restatement instruction their release-gate
        // siblings above carry.
        deferred.push(`${head} — recorded for release: when the destination ships, vendor or restate what it pointed at in place and remove the path — never delete the content it anchored`)
      }
    }
    if (ids) {
      if (repos.release) {
        problems.push(`${rel}: ${ids} line(s) mention a task id (T-NNN) — restate the content in place and remove the id: the destination must stand alone to release`)
      } else {
        deferred.push(`${rel}: ${ids} added line(s) mention a task id (T-NNN) — recorded for release: when the destination ships, restate the content in place and remove the id — never delete the record it anchored`)
      }
    }
  }
  return { problems, deferred }
}

// The out-of-root path references of one added line in a nested repository
// (plans/0103): a `..` chain whose climb exceeds the file's own directory
// depth inside the repository (counted from the repository's root — the
// prefix itself is not a level) cannot resolve inside it, and an absolute
// path under the target directory names the workspace the repository ships
// out of. Pure path arithmetic — the scan never asks whether a path exists.
function outsideRootReferences(rel: string, prefix: string, text: string, dir?: string): string[] {
  const depth = rel.slice(prefix.length + 1).split("/").length - 1
  const out: string[] = []
  for (const match of text.matchAll(REL_CLIMB)) {
    if ((match[0].match(/\.\.\//g) ?? []).length > depth) out.push(match[0].replace(/[.:]+$/, ""))
  }
  if (dir) {
    const trimmed = dir.replaceAll("\\", "/").replace(/\/+$/, "")
    // The tail mirrors PROCESS_PATH's token shape: the rest of the path.
    const absolute = new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/[^\\s\"'`<>()[\\]{},;]*", "g")
    for (const match of text.matchAll(absolute)) out.push(match[0].replace(/[.:]+$/, ""))
  }
  return out
}
