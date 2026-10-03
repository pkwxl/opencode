# refcheck scope convergence and recovery design (OPENCODE_AUTO_REF_CHECK)

> **Historical record (2026-09-28, `plans/0061` A3): retired, not maintained.** refcheck as a whole is retired:
> `src/refcheck.ts`, the `OPENCODE_AUTO_REF_CHECK` switch (now a retired-switch notice), the pre-commit gate, the
> `fix-refs` script and the `.auto/invalid-refs.md` stale list are deleted, and the `deleted|archived|historical`
> exemption markers left the `plans/0035` protocol registry. Keeping references valid is each session's own work
> (`plans/0061` R6). Originally preserved untranslated; translated to English 2026-10-03 with the plans/ corpus
> (protocol-string citations inside backticks keep their original Chinese spelling).

> Status: **P1..P3 all implemented (2026-09-08): P1 = the switch + control of the three hook layers + removal of the D2 retired items;
> P2 = missing-reference recovery (rename history map + in-place rewrite recovery + re-scan); P3 = scope re-confirmation (changed-file
> detection + `@sha` syntax and parsing/validation extensions + nested-repo SHA) + convention-block/template copy**.
> This document revises plans/0010-stable-refs-design.md §4.5/D6. Requirements source (2026-09-08 session, three items):
>
> 1. refcheck never touches the docs directory tree — never moving/renaming any file or directory inside it; rewrites never disturb
>    document layout (the layout invariant was already pinned down earlier, on 2026-09-08; see plans/0010-stable-refs-design.md §4.5).
> 2. For reference breakage in legacy documents caused by moves: only after the dedicated breakage-confirmation mechanism (scanRefs findings)
>    confirms the breakage may git history be used to track the original file's move record and rewrite the reference in place to restore it.
> 3. The whole refcheck mechanism is governed by the `OPENCODE_AUTO_REF_CHECK=on/off` switch and is **off by default**;
>    its checking scope is also narrowed (three classes only, see D4).

## 1. Decision table

| No. | Decision |
|---|---|
| D1 | **Tree invariant**: refcheck never moves/renames any file or directory in the docs directory tree; **layout invariant**: a rewrite only replaces the hit token in place, preserving line structure/whitespace/alignment/trailing newline exactly, and nothing is written back when nothing is hit (already pinned down). The recovery mechanism likewise only edits reference text and never moves files |
| D2 | **Reject move-based adaptation**: retire the run-startup migration hook of `docpaths.migrateLegacyDocs` (loop.ts) and the fix-docs script's directory-ization migration step — no longer adapting stable-refs by moving files; the legacy flat layout stays where it is, and the `resolveTaskDoc`/`resolveSubtaskDoc` read fallbacks are kept permanently for compatibility with the existing corpus; broken references arising from this go through the §4 recovery mechanism |
| D3 | **The switch governs the whole refcheck**: `OPENCODE_AUTO_REF_CHECK=on/off`, default **off**; when off, the three hook layers (pre-commit auto-correct, the check subcommand's reference scan, the verify-gate pre-scan) all no-op and the target directories see zero reference-checking behavior. The `fix-refs` one-shot manual script is an explicit human entry point and is not constrained by the switch |
| D4 | **Scope convergence** (three classes only when on): ① missing recovery — only reference targets that "once existed and are currently missing" get git-history rename tracking and in-place recovery (§4); ② pre-commit move correction — only files moved before the commit (the current renamePairs semantics) get path correction (§5); ③ scope re-confirmation — only the `:N`/`:N-M` line anchors of files that have been edited (including nested sub-git-repo source) get re-confirmed; on content mismatch the original range is kept and the `@<sha>` version marker is appended (§6) |
| D5 | The deterministic criterion for "appeared in AI session history" = the path once existed in the history of the git repo the target belongs to (the `git log` rename map lists it as old). AI session artifacts are booked through unified commits, so git history is the deterministic projection of session history — no session-transcript scanning is introduced, keeping the driver deterministic |

## 2. The switch (src/switches.ts)

- `SWITCH_ENV` gains `refCheck: "OPENCODE_AUTO_REF_CHECK"`; `Switches` gains
  `refCheck: boolean`; `SWITCH_DEFAULTS.refCheck = false`; parsing/errors/startup logging
  reuse the existing onOff channel (illegal values throw a Chinese error; non-default entries are logged at startup).
- Control points (wired during implementation):
  - `runner.ts` afterSession's `autoCorrectRefs(dir)` — skipped when off;
  - the `check.ts` reference-scan section — skipped when off (silently; verbose shows the full switch state);
  - the `runner.ts` verify-gate `taskRefFindings` pre-scan — skipped when off;
  - the `script/fix-refs.ts` manual script is not constrained (explicit human execution is equivalent to explicitly enabling it).
- Test impact: the existing three-layer hook tests run under an env that injects `OPENCODE_AUTO_REF_CHECK=on`
  (pure-function injection via parseSwitches); add default-off behavior tests (all three layers no-op, zero changes to the target directories).

## 3. Invariants (must not be broken at any point during implementation)

- The tree invariant and the layout invariant (D1);
- The minimal-scope principle for recovery and correction: rewrite only the confirmed-broken reference's path
  token, in the document containing it, with no spillover to other references or documents;
- The unified-commit invariant is unaffected (rewrites are booked with this run's unified commit; no separate commit is started).

## 4. Missing-reference recovery (D4①, git-history tracking)

- **Trigger**: the entries with `problem: "missing"` among the `autoCorrectRefs` re-scan findings
  (switch on; breakage confirmation first, recovery after — the order must not be reversed).
- **Steps**:
  1. Build the rename history map: the target repo and each nested sub-repo each run
     `git log --find-renames --diff-filter=R --name-status --format= -z`,
     traversed in new→old order with first occurrence taking priority, chaining old→new to the final landing point (with visited to guard against cycles).
  2. For each missing target: the map contains the path as old → resolve the final landing point; if the landing point currently exists →
     `rewriteRefs` rewrites that reference in place (layout invariant); if the landing point does not exist (deleted) →
     keep the finding in the stale list for manual correction.
  3. Re-scan after rewriting; `.auto/invalid-refs.md` registers only the broken references that were not recovered.
- **Boundary**: only breakage caused by moves/renames is recovered; deletions and semantic changes are not auto-recovered (carrying over
  the stable-refs §8 boundary).

## 5. Pre-commit move correction (D4②)

The current semantics are kept unchanged: `renamePairs` (index vs HEAD, staged first via `git add -A`) →
`rewriteRefs` live documents. Only files "moved before the commit" take part in path correction — exactly the existing behavior,
with no implementation delta; brought under switch control (it no-ops together with autoCorrectRefs when off).

## 6. Reference-scope re-confirmation (D4③, line anchors + version markers)

- **Targets**: references with line anchors (`:N` or `:N-M`) whose target file has been "edited/modified" —
  criterion = the target file has uncommitted content differences in its (possibly nested) git repo
  (`git diff HEAD --name-only`; renamePairs already ran `git add -A`, so the staging area is the full set of changes;
  nested sub-repos are judged one by one, mirroring git.ts's nested-first traversal for unified commits).
- **Consistency check**: the line slice of the target file's HEAD version over the range vs the same-range line slice of the current working-tree version
  (if the current file has too few lines, it counts as inconsistent):
  - consistent → the reference is left untouched;
  - inconsistent → **keep the original reference range unchanged**, rewriting the anchor to `path:N-M@<sha>` (sha = the owning repo's
    current HEAD short hash, 7 characters) — semantics: the range is valid only for this historical version; its content has since
    changed.
- **Parsing extension**: `extractRefs` tail-anchor parsing order — strip the optional `@<sha>` first, then `:N(-M)`;
  `Ref` gains `ver?: string`.
- **Validation semantics**: a reference with `ver` is treated as a historical-snapshot reference — only path existence is checked, the line-number upper-bound check
  is waived (a historical version cannot be mechanically validated); idempotent — a reference already carrying `ver` gets no marker appended or updated, and is left for
  manual correction.
- **Copy sync** (when P3 is implemented): the sixth marker block of AGENTS.md (reference conventions) and the wrapup/fix templates
  gain an explanation of the `@sha` marker semantics.

## 7. Retirement and retention list (D2)

| Item | Disposition |
|---|---|
| The loop.ts startup migration hook (migrateLegacyDocs) | Retired |
| The fix-docs directory-ization migration step | Retired (settled at P1 implementation: once removed it is fully equivalent to fix-refs, so the script is retired as well and fix-refs is kept as the only manual entry point) |
| `migrateLegacyDocs` and its tests | Retired along with the hook |
| Read fallbacks (resolveTaskDoc/resolveSubtaskDoc/old flat-layout constructors) | Kept permanently, for compatibility with existing flat-layout projects |
| The stale-list `.auto/invalid-refs.md` mechanism | Kept (the manual-correction entry point for items that recovery failed on) |

## 8. Implementation phases

| Phase | Content | Verification |
|---|---|---|
| P1 | The switch (switches.ts) + control of the three hook layers + reworking the default-off regression tests; removal of the D2 retired items | This package's typecheck + tests green (hook tests inject on; new off no-op cases) |
| P2 | Missing recovery (rename history map + in-place rewrite recovery + re-scan) | New recovery unit tests (move recovered/deletion kept/nested repos/idempotence) |
| P3 | Scope re-confirmation (changed-file detection + `@sha` syntax and parsing/validation extensions + nested-repo SHA) + convention-block/template copy | New re-confirmation unit tests (consistent untouched/inconsistent marker appended/idempotence/sub-repos) |

Revised in sync every phase: this file's status line, the plans/0010-stable-refs-design.md §4.5 revision note, the behavior.md
"reference-consistency three layers" entry (adding the switch condition and the scope convergence), the structure.md refcheck/switches
entries, and the AGENTS.md navigation row (dropping the "not implemented" annotation).

## 9. Explicitly not done

- No scanning AI session transcripts to decide "appeared" (D5: git history is the deterministic projection);
- No auto-recovering deletion/semantic-change breakage (manual correction, with the stale list as the entry point);
- The switch is not persisted as a constitutional key (experiment-period read-only environment, following the experimental-switch contract; graduation is a separate discussion);
- No touching the location or naming of any file or directory in the docs directory tree (D1, including recovery paths).
