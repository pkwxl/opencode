# 0065 — Artifact-declaration pitfalls: the stale snapshot, the directory shape, and the unchecked item line

Status: **fixes landed, 2026-10-02 (T-113).** F1–F4 below are the spec of record the fix unit landed;
the body is the original findings record, kept verbatim.
AUTO-DECISION (T-113 edited this banner instead of only appending): the header said "no code changes
are made here" — true when the document was a findings record awaiting its fix unit, actively false
after it; rewritten per the fix-status pattern (0069 §4.1), the T-015/T-079 precedent.

## 1. The incidents

T-066's decomposed checklist declared the golden **directory** as a subtask artifact (`Artifacts: …, opencode/packages/auto-core/test/golden/turn/`). Two hidden blockages followed:

1. **S01 close-out**: "declared artifact `…/test/golden/turn/` does not exist". The directory existed with the recorded golden inside. Root cause: `checkArtifactSpecs`'s existence test is `Bun.file(path).exists()` (`src/document/spec.ts`), which is false for any directory, with or without the trailing slash. The declaration was unsatisfiable as written. No earlier task had ever declared a trailing-slash artifact (the only occurrences across all `docs/*/subtasks.md` were T-066's own S01–S08), so the hole survived since M1.4 (69e91e7aa).
2. **S02 close-out**: same failure, *after* the declaration had been fixed. Root cause: `runSubtask` receives the item text snapshotted at dispatch (`src/runner.ts:557`, `items[index].text` from the task loaded when the subtask loop was entered; the task is reloaded only after a *successful* close-out, `src/runner.ts:561`, and a blocked run exits before that). A declaration fixed mid-session is therefore judged by its pre-session text — every subtask that fixes its own declaration eats exactly one spurious block, cleared only by a human re-run.

A third, cosmetic defect: T-066's decompose wrote each checklist item as a single physical line of 1.3–2.9 KB (scope paragraph + artifact list), where T-062/T-065 hard-wrap at ~100 columns. `status` prints the raw first line of each item (`src/status.ts:56`), so it dumped the full text. Nothing constrains item line length; the difference was purely convention drift between decompose sessions.

## 2. Fixes, in order of leverage

### F1 — Re-read the item text at close-out (the stale snapshot)

In `src/runner.ts`, reload the checklist (or at least the current item's text) immediately before `runSubtask`'s shape check, instead of passing the dispatch-time snapshot. One-line-scale change; removes the entire class of "fixed it mid-session but judged by stale text" — both S01 and S02 burned a session cycle plus a human round-trip on exactly this. Note the tick/idempotency invariant is unaffected: the shape check reads, it does not write.

Alternative with a deeper payoff: move the artifact declaration's source of truth from the checklist item to `S<nn>/todo.md`'s `## Artifacts` section (already written by decompose, already read by the subtask session) and have the close-out parse *that*, fresh from disk. This matches the protocol's own division of labor — subtasks.md is the index, todo.md is what the subtask learns — and makes F3's wrapping safe by construction (today the check silently sees nothing when `Artifacts:` sits on a continuation line).

### F2 — Reject unsatisfiable declarations at decompose time

The decompose-collect check should reject (or the checker should accept, see rejected alternative) artifact paths ending in `/`. Failing the *planning* session costs a retry inside one session; failing a *subtask close-out* costs a hidden blockage, a human diagnosis, and a re-run. The check is trivial: declared path ends with `/` → problem line naming it.

Rejected: teaching `checkArtifactSpecs` to accept directories (`statSync().isDirectory()` + non-empty). A directory declaration is vacuous as a completion gate — it passes the moment any file lands, saying nothing about *which* artifacts the unit owed. Concrete files are the honest declaration; the directory form only ever appeared by convention drift.

### F3 — Make `status` immune to item formatting

`src/status.ts:56` prints raw `item.text`; switch to `checklistTitle(item.text)` (the existing 60-char-capped helper, `src/tasks.ts:155`). This is the mechanical fix — wrapping conventions are a social contract between decompose sessions, the cap is not. Optionally also enforce first-line ≤ ~100 chars at decompose-collect, but that is redundant once status caps the display.

### F4 — Test gap

A golden case declaring a trailing-slash directory in the decompose-collect or subtask-shape suite would have caught F2's hole at M1.4. Whichever of F1/F2 lands should add it.

## 3. What was done in the meantime (T-066, no `src/` changes)

- S01's and S02's declarations were edited mid-run to name the concrete golden files (AUTO-DECISION, recorded in `docs/T-066/S01/index.md`); S01–S02 were then marked done by hand (state-file rename + tick — files are the progress fact, `src/document/state.ts:108-119`).
- T-066's `subtasks.md` items were re-wrapped to the T-062/T-065 style (~100-column first lines, 2-space continuation indent). Side effect, accepted consciously: the `Artifacts:` declarations moved to continuation lines, which the close-out parser never reads (`subtasks()` takes only `- [ ]` lines, `src/tasks.ts:137-142`), so the declared-artifact existence check is inert for T-066's remaining subtasks — the same regime T-062/T-065 ran under. The zero-write and eof scans still run. F1's alternative (declarations in todo.md) is the principled repair of this silent coupling between line-wrapping and check semantics.

<!-- auto: eof -->
