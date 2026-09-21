// Deterministic criteria for the document shape check (session-boundary-hardening
// design §4.3/§4.5/§4.6): the "non-trivial + last-line terminator" check shared
// by subtask declared artifacts (D4), automatic-session artifacts (D5) and the
// whole-unit document terminator scan (D6). A pure leaf module doing no IO at
// all; eof only proves "finished writing" (mechanically decidable) — quality
// belongs to planned acceptance work.

// Non-semantic terminator: deliberately a different shape from the `状态:` line
// of handoff/testhandoff — avoiding a semantic collision, and avoiding stamping
// a "done" wording on cross-task narrative files such as report (D5 decision).
export const EOF_MARK = "<!-- auto: eof -->"

// Non-triviality threshold (conservative, counted in characters after trimming
// whitespace): a new .md below this length is suspected of being a stub or a
// truncation.
export const MIN_DOC_CHARS = 120

// Last-line terminator test: the last non-empty line is exactly the terminator
// (only blank lines may follow it; any body text after the terminator fails —
// which is precisely the "appended after the terminator" truncation shape).
export function endsWithEof(text: string): boolean {
  return text.trimEnd().split("\n").at(-1)?.trim() === EOF_MARK
}

// Shape problems of one document (empty = pass): path goes into the problem text
// so the re-prompt feedback can cite it.
export function docShapeProblems(text: string, path: string): string[] {
  const trimmed = text.trim()
  const problems: string[] = []
  if (trimmed.length < MIN_DOC_CHARS) {
    problems.push(`${path}: content too short (${trimmed.length} chars < threshold ${MIN_DOC_CHARS}), suspected stub or truncation`)
  }
  if (!endsWithEof(text)) problems.push(`${path}: missing last-line terminator (the last line of body text must be ${EOF_MARK})`)
  return problems
}

// Exemption list of the D6 whole-unit scan (session-boundary-hardening §4.6, a
// named constant in code): the driver-exclusive state files PLAN.md/CURRENT.md
// (protect.ts domain; under the round-directory layout the root PLAN.md is a
// symlink and the path git reports is the link target docs/R-NN/PLAN.md, so the
// test goes by file name) and the state files under .auto/. The handover
// document family (handoff/testhandoff) carries its own `状态:` final-state
// contract, so its semantics are not mixed in; HANDOFF_NAME covers it as a whole
// (including archived testhandoff-<n>.md and the old flat names <id>.handoff.md,
// <id>(-S<n>).testhandoff(-<n>).md).
export const EOF_SCAN_EXEMPT_NAMES = ["PLAN.md", "CURRENT.md"]

const HANDOFF_NAME = /^(?:.+\.)?(?:test)?handoff(?:-\d+)?\.md$/

// Whether a path (relative to the target directory) is exempt from the D6
// whole-unit document terminator scan.
export function eofScanExempt(rel: string): boolean {
  if (rel === ".auto" || rel.startsWith(".auto/")) return true
  const name = rel.split("/").at(-1) ?? rel
  return EOF_SCAN_EXEMPT_NAMES.includes(name) || HANDOFF_NAME.test(name)
}

// Whether the D2/D4 shape check is on (session-boundary-hardening §4.3): not
// judged under dryrun / commit gate off (`--commit false` is retired, kept
// defensively) / non-git (no baseline); a test-handover closing session is
// exempt — its completion criterion is testhandoff.md, already covered by the
// handover-boundary write check (the current wiring does not leak the
// testHandover result out of runExecSession to runSubtask, so the guard is
// deliberately kept as designed).
export function shapeCheckOn(
  opts: { dryrun?: boolean; commit?: boolean },
  baseline: { length: number } | undefined,
  testHandover: boolean,
): boolean {
  if (opts.dryrun || opts.commit === false) return false
  if (!baseline?.length) return false
  return !testHandover
}
