# Step 040 — w-manual-subtasks: the subtask companions' independent verification + phase selection, resume gate, recommit

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W-manual-subtasks (the manual-driver prompt suite family: `prompts/` +
`src/install-prompts.ts` + `test/manual-prompts-ratchet.test.ts` — the wave
mirrors the verification loop W7 ruled in 0198/0199), findings **0165-005**
(S25-01, S1, CONF, DEF, P3, 0083 D1–D5/D8; `prompts/run-as-subtasks.md:224-259`,
`prompts/resume-subtasks.md:215-252`), **0165-048** (S25-02, S2, CONF, STATE,
P6/P20, 0078 §4; `prompts/resume-subtasks.md:59-70`), **0165-053** (S25-07, S2,
CONF, DEF, P6, 0088 D1/D3; both companions' phase selector) and **0165-164**
(S25-09, S3, CONF, STATE, P6, 0044 D9; `prompts/resume-subtasks.md:93-103`).
Started 2026-11-07 at HEAD `1b037acbf` (tree clean; steps 001–039 done; no
recovery needed).

## Findings

- **0165-005 (S25-01)** — both subtask companions' Stage 3 closes the task from
  a narrative wrap-up (one line per subtask + a `Result:` line written from the
  checklist's claims), bypassing the driver's independent verification and
  bounded fix loop the suite claims to mirror. The driver's common pipeline
  tail (runner.ts → runCloseout → runWrapup) runs the verification session and
  the fix rounds for every mode, subtask mode included; 0086/0087 explicitly
  excluded only the handover-free loop and the per-subtask commit choreography
  — no ruling excludes the final task-level verification loop.
- **0165-048 (S25-02)** — resume-subtasks' decomposition gate item 3 requires
  every checklist item's `S<nn>/todo.md`; Stage 2's completion act is the
  todo.md → done.md rename, so the normal interrupted state (earlier items
  done, later pending) fails the gate — the documented recovery path cannot
  recover the common case.
- **0165-053 (S25-07)** — both companions select the first phase whose
  `phases.md` line is "not marked ` (closed: …)`" — a suffix the normal phase
  close-out never writes (it ticks `- [x]`); run.md's selector (first unticked
  line) is the correct mirror. After the first normally completed phase the
  companions operate on the wrong phase or report nothing ready.
- **0165-164 (S25-09)** — resume-subtasks' existing-report path follows the
  verdict rules directly, whose FAIL branch commits the report unconditionally;
  resuming the committed-FAIL state runs a no-change git commit instead of the
  clean blocked stop — crash recovery not idempotent at this boundary.

## Plan (enactment order; each ingredient lands green)

1. Ruling **0200** written first (Derives/Amends, Category scope, premise
   guard): D1 the Stage 3 verification loop (fresh verification child over the
   task's committed range, countable gap list, fix rounds under the
   best-count progress rule, the master's close-out), D2 the decomposition
   gate on exactly-one-of todo.md/done.md + tick agreement, D3 the unticked
   phase selector, D4 the verification-state re-entry (report re-entry
   idempotent).
2. Enactment in `prompts/run-as-subtasks.md` + `prompts/resume-subtasks.md`
   (lockstep Stage 3 per the sibling comment): the Stage 3 rewrite, the phase
   selector, the decomposition gate, the re-entry point, the reconstruction
   comment, preflight item 6, the Finish wording.
3. Ratchet arms in `test/manual-prompts-ratchet.test.ts` (rule sentences +
   retired-rule absences), fail-before red on the pre-fix prompt sources.
4. Full verification (`bun typecheck` + `bun test`; no shell package source
   touched — a guard run of packages/auto), docs (ruling 0200, INDEX row,
   AGENTS.md navigation line, structure.md row if the family is listed),
   ledger rows, program position, single commit.

## Verification

All measured on the committed-state sources; fail-before proofs over `/tmp/040-fixed/` backups
(the pre-fix prompt sources restored from `git show HEAD:…` — run-as-subtasks.md,
resume-subtasks.md — the proof run, the fixed files restored, `cmp`-verified byte-identical,
green re-run).

- **auto-core**: `bun typecheck` clean; full suite **3103 pass / 0 fail** (155 files) — the
  3099/155 baseline + the 4 new ratchet tests (the loop, the selector, the gate, the re-entry;
  the protocol-strings pin's carrier growth is an edit of an existing test), zero regressions.
- **packages/auto** (guard run — no auto source touched, but the embedded suite changed):
  `bun typecheck` clean; **160 pass / 8 skip / 5 fail** — the exact baseline; the 5 = the
  pre-existing fork/remove-fork family (fork ×2, remove-fork ×3), identical names to step 039's
  verified baseline.
- **auto-server**: not run — no auto-server source or surface touched.
- **Fail-before proofs** (the new ratchet over the pre-fix prompt sources): **5 tests red, the
  other 23 green** —
  - the protocol-strings pin (the verdict-carrier growth): pre-fix companions carry neither
    `Verification: PASS` nor `Verification: INCOMPLETE` (the S1's own face: no verification
    channel existed);
  - the D1 loop arm: fails at its first charter pin (`a fresh pair of eyes` absent — the
    narrative wrap-up judged from the checklist, never the range);
  - the D3 selector arm: the unticked selector sentence absent (the pre-fix files key on
    `(closed: …`, the suffix the close-out never writes);
  - the D2 gate arm: the one-of-state gate sentence absent (the pre-fix gate demands every
    item's `todo.md`);
  - the D4 re-entry arm: the verification-state keying absent (the pre-fix path follows
    Stage 3's verdict rules directly — the unconditional recommit).
  - The restored sources re-ran **39 pass / 0 fail** (ratchet + install-prompts).
- Focused runs during enactment: ratchet + install-prompts 39/0 (after the in-change rewrap —
  the first draft wrapped the frozen `Result: FAIL <one-sentence reason>` literal across lines
  and tripped the standing pin: the wrap, not the pin, was wrong); the three template suites
  (`prompt-exec` / `prompt-phase` / `prompt-template`) green beside them (193/0 over the five
  files); `test/constitution-ratchet.test.ts` 5/0 after the doc edits.
- In-change discovery (fixture hygiene, not code): none this step; the lockstep diff between
  the two Stage 3 sections verified to be exactly the three resume-specific deltas (the
  re-entry preamble, the fix child's dirty-continue bracket, the zero-write skip for a dirty
  re-entry — Stage 2's own resume-only deltas mirrored).

## Dispositions

- **0165-005 (S25-01)** — **fixed** under ruling **0200 D1**: both companions' Stage 3 is the
  task-level verification loop (the fresh verification child, the countable gap list, the fix
  rounds under the best-count progress rule, the master's close-out), the narrative wrap-up
  retired with its self-report channel. 0083's manual twin completed; 0086/0087's exclusions
  stand (no handover, no per-subtask budget; one fix session per round, recoverable through
  resume).
- **0165-048 (S25-02)** — **fixed** under ruling **0200 D2**: the decomposition gate reads
  exactly-one-of todo.md/done.md + the tick's agreement; the no-rewrite rule's list gains
  `S<nn>/done.md`.
- **0165-053 (S25-07)** — **fixed** under ruling **0200 D3**: run.md's unticked selector,
  verbatim, in both files; `(closed: …)` retired from the selector.
- **0165-164 (S25-09)** — **fixed** under ruling **0200 D4**: the re-entry keyed on the
  verification state; the existing-report close-out idempotent (commit only when uncommitted,
  completion writes only when pending); a complete `Result: FAIL` report stops for the person
  with no git write — 0044 D9's manual mirror restated, the driver-side read unchanged.
- **Discovered in-change** (recorded, unacted on): run.md's own progress-rule sentence (loop
  step 6, "a round that shrank the count buys the loop another round") still reads the
  pre-0198 phrasing whose natural reading is versus-previous-count — a manual-copy drift in
  0165-049/050's family (step 041's files), recorded in 0200's residuals for that step's
  sweep. The new fix-share subject sites join 0165-163's short-title family (step 042).

Residuals recorded (0200's own): the fix child's handover-free shape (0086/0087's standing
exclusion — an unfinishable fix session ends unlanded and is continued by the next
resume-subtasks invocation); the `<task title>` form of the new fix subjects (joins step 042's
sweep); the ratchet arms are text-level oracles, the suite's only possible oracle over prompt
copy — deeper scenario machinery is 0165-165's question (step 043).
