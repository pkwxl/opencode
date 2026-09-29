// Deterministic criteria for the document shape check (session-boundary-hardening
// design §4.3/§4.5/§4.6): the "non-trivial + last-line terminator" check shared
// by subtask declared artifacts (D4), automatic-session artifacts (D5) and the
// whole-unit document terminator scan (D6). A pure leaf module doing no IO at
// all; eof only proves "finished writing" (mechanically decidable) — quality
// belongs to planned acceptance work.

// Non-semantic terminator: deliberately a different shape from the `Status:`
// line of handoff/testhandoff — avoiding a semantic collision, and avoiding
// stamping a "done" wording on cross-task narrative files such as report (D5
// decision).
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

// The D6 whole-unit scan's exemptions derive from document roles
// (document/roles.ts eofScanExempt, M2.3).

// Whether the D2/D4 shape check is on (session-boundary-hardening §4.3): not
// judged under dryrun / an empty baseline (non-git, or a run on the git
// seam's no-commit double, whose unitBaseline answers empty); a
// test-handover closing session is exempt — its completion criterion is
// testhandoff.md, already covered by the handover-boundary write check (the
// current wiring does not leak the testHandover result out of runExecSession
// to runSubtask, so the guard is deliberately kept as designed).
export function shapeCheckOn(
  opts: { dryrun?: boolean },
  baseline: { length: number } | undefined,
  testHandover: boolean,
): boolean {
  if (opts.dryrun) return false
  if (!baseline?.length) return false
  return !testHandover
}
