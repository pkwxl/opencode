# Step 076 — wc-state-windows: state-window robustness (units.json reads, the brief-install kill window, preflight's protected exits, the sentinel exemption, the clean gate's leftovers)

Status: **done** 2026-11-09 (started from HEAD 3d0c9473a — step 075's
commit; worked, verified and committed in one session).

Findings: 0165-042 (S21-02, S2 CONFIRMED STATE — loadPlan reads units.json
`status`/`attempts` unsanitized), 0165-072 (S04-02, S3 CONFIRMED STATE — the
survey brief installs after the completion rename: a kill between them loses
the install), 0165-073 (S04-03, S3 CONFIRMED STATE — preflight's late exits
return after protect() and never unprotect), 0165-074 (S04-04, S3 CONFIRMED
FAIL — 0149's run-start exemption consumes 0155 D1's unreadable-status
sentinel), 0165-078 (S04-09, S3 CONFIRMED UX — the run-start clean gate cannot
tell driver-written leftovers from the person's), 0165-151 (S21-03, S3
CONFIRMED FAIL — an unparseable units.json reads as empty and the next write
replaces it silently), all bucket WC-hygiene. Evidence: the records
plans/0165-review/S21-tasks.md (042, 151), S04-loop-root.md (072, 073, 074,
078).

Surface: `src/tasks.ts` (readUnits/updateUnits, the runtime read), `src/git.ts`
(UnitGate, beginUnit's strict arms), `src/loop-preflight.ts` (protect's exits,
the start gate's exemption and block lines), `src/loop-phase.ts` (the handover
close-out's install-before-rename), `src/brief.ts` (installBriefProposal — the
already-landed pathspec half), `src/log.ts` (the block-line helpers),
`src/knowledge.ts`/`src/regression.ts` (the leftover families' grammars), the
outcome unions threading an unreadable verdict (`src/execute.ts`,
`src/artifact.ts`, `src/formulate.ts`, `src/blockage-execute.ts`,
`src/loop-task.ts`), and their test homes.

## Plan (written before editing)

1. Ruling 0236 first: answer each finding's boundary from docs/principles.md
   (P3/P12/P6/P20 for the units.json reads; P2/P6/P20 for the kill window;
   P8/P12 for the protected exits; P12/P13 for the sentinel verdict; P8/P6 for
   the clean-gate teaching). Measure every locus at HEAD 3d0c9473a — the
   review's line numbers drifted; where a finding's remedy arm is already
   landed (0215 D3's write-tmp-then-rename for sync/brief EACCES; 0207 D1's
   install pathspec; step 022's SIGINT-before-hibernate) or unreachable
   (driver-helper never sees beginUnit's verdict), decline that arm with the
   measurement.
2. Enact per the ruling: the sanitizers at the one read home; the
   corrupt-file ⚠ + move-aside; the unprotect on preflight's protected exits;
   the unreadable verdict split through UnitGate and its consumers; the
   start-gate block's per-family leftover teaching; the install-before-rename
   reorder of the survey release's brief install.
3. Regression coverage per defect, fail-before proven by the /tmp swap-source
   method (back up fixed files, `git show HEAD:` the pre-fix bytes in, run the
   new tests red, restore, cmp-verify byte-identical, run green).
4. Verify: `bun typecheck` + the full suite against the 3278 pass / 0 fail,
   165 files baseline (step 075 held it exactly); report the delta from the
   new tests. No shell suite owed unless a shell file is touched (none
   planned; all six findings live in auto-core).
5. Bookkeeping: INDEX row 0236, ledger dispositions for the six findings,
   program row 076 → done, Current position rewritten, this record's
   Verification + Dispositions filled. Commit the step's paths.

## Session log

- 2026-11-09 (this worker): authoritative inputs read (the program's
  executable prompt, status row 076, the six ledger rows, Current position;
  the S21-02/S21-03 and S04-02/03/04/09 records in full; docs/principles.md's
  P3/P6/P8/P12/P20 statements; AGENTS.md's navigation lines for the touched
  surfaces). Loci re-measured at HEAD: tasks.ts readUnits :458-469 /
  updateUnits :473-485 / the status+attempts reads :585/:587 / begin :731 /
  unitAttempts :965; loop-phase.ts completePhase call :316 and
  installApprovedBrief :349 (the kill window between), brief.ts
  installBriefProposal :159-178 (the pathspec [BRIEF_FILE, source] already
  0207 D1); loop-preflight.ts protect :600 and the four post-protect exits
  :640/:707/:738/:815, the exemption :674-678, the block :702-704; git.ts
  beginUnit's two strict arms :1325-1330 (refused) and :1337-1344 (unreadable
  status) both typed `dirty`; loop.ts driveRun's finally unprotect :432 (the
  only one); sync.ts writeManaged and brief.ts writeBrief both already
  tmp+chmod+rename (0215 D3 — the EACCES arms of 073's remedy already
  landed); step 022's 0182 already installed the SIGINT handlers before the
  startup hibernatePause (loop.ts :151-158 — 073's hibernate sub-item
  already landed); driver-helper's dirty row reads changedFiles (the legacy
  front, quiet on unreadable) and never beginUnit's verdict (074's
  driver-helper arm unreachable); loop-task's unit-start exemption decides by
  recallProgress BEFORE beginUnit (:517-520, :1578-1582 — it never consumes
  the sentinel; the confirmed consumption is preflight's alone). Row 076
  marked doing; this record created. Next: write ruling 0236.

- 2026-11-09 (this worker): ruling 0236 written (one consolidated Derives
  paragraph, eight showings, Category scope 18 rows, premise guard naming
  the re-reads and the three consumed-as-landed arms). Enacted: D1/D2 in
  src/tasks.ts (sanitizedRuntime + readUnitsState, the corrupt-noted ⚠
  keyed per file, updateUnits' move-aside); D3/D4/D5 in
  src/loop-preflight.ts (stopBlocked, the unreadable block ahead of the
  dirty arm, driverLeftoverLines) + src/log.ts (unreadableStopLines) +
  src/knowledge.ts (isKnowledgeDoc); D4's verdict threaded by the compiler
  through UnitGate/UnitStop/Outcome (src/git.ts, src/opts.ts) — the Exact
  pin in test/run-status-schema.test.ts forcing the honest choice:
  TASK_OUTCOMES grew `unreadable` additively in the same lockstep (the
  first-draft map-to-dirty at the brackets withdrawn in-change, the
  ruling's D4 restated to the enacted design) — and through loop-task's two
  unit gates and three outcome stops, execute/artifact's gate maps,
  formulate/loop-plan, knowledge/loop-phase, loop-append,
  blockage-diagnose/execute, runner's brackets; D6 the install-before-rename
  reorder in loop-phase.ts (the old post-rename site removed).
- 2026-11-09 (this worker): test homes — test/tasks.test.ts +2 (the
  sanitizer row with the healed persisted shape; the corrupt-file row: one ⚠,
  the degraded read, the move-aside with the old bytes),
  test/loop-preflight.test.ts +5 (the sentinel not consumed under an active
  record; the no-record investigate block; the exit-arm unprotect read
  straight after the exit, outside capture's compensating unprotect; the
  per-family teaching over a seeded kb.md + receipt), test/git.test.ts (the
  two strict-arm expectations re-pointed to the unreadable verdict),
  test/knowledge.test.ts +1 (isKnowledgeDoc pinned beside knowledgeFile),
  test/survey-gate.test.ts +1 (the install-before-rename pin over the
  boundary-flow run — the loop fixture's run opts gaining the git-override,
  the wrapper recording todo.md's standing at the brief-install commit; the
  commit order asserted: brief-install below the transition, newest-first).
  One in-change lockstep at full-suite time: test/doc-lanes.test.ts's
  decorator verdict word (the base gate's verdict carried through —
  `unreadable` now). Fail-before over /tmp/076-fixed (the seventeen changed
  src files swapped to HEAD, restored, cmp-verified byte-identical): all
  the new pins red at HEAD per finding — the sanitizer (status done /
  attempts "7" verbatim), the corrupt-file row (no line, the lane record
  silently replaced), the sentinel exemption (a corrupt index with an
  active record proceeding), the no-record block ("commit or clean" over a
  corrupt index), the exit-arm unprotect (AGENTS.md 0444 after the exit),
  the per-family teaching (absent), the survey reorder ([false] — todo.md
  already renamed at the install commit), git.test's two verdicts and
  knowledge's isKnowledgeDoc (the file-level export error). Verified:
  typecheck clean; full suite 3286/0 (165 files) — the first run 3285/1 on
  the doc-lanes lockstep miss, repaired, then the full green; no agent-fake
  quota-wait one-off in either. Bookkeeping: INDEX row 0236, the six ledger
  dispositions, row 076 → done, Current position rewritten, AGENTS.md five
  navigation lines, docs/structure.md five module rows. Commit follows.

## Verification

- `bun typecheck` exit 0.
- Full suite `bun test` **3286 pass / 0 fail** (165 files, 21318 expects) —
  the 3278/0 step-075 baseline + 8 net new tests. Run twice: the first
  carried exactly one failure — test/doc-lanes.test.ts's decorator verdict
  word ("the decorator's gate blocks on an unreadable repository" expected
  `dirty`), the one in-change lockstep miss, repaired and green — the second
  run the full green. The agent-fake quota-wait one-off (the
  steps-072/073/074 pattern) did not appear in either run.
- Fail-before proven over /tmp/076-fixed: the seventeen changed src files
  backed up, HEAD's bytes via `git show` swapped in, the new tests run red
  per finding (every defect pin in the session log), the fixed files
  restored and cmp-verified byte-identical, the tests green again.
- No shell suite owed (no packages/auto or packages/auto-server file
  touched; all six findings live in auto-core).

## Dispositions

- **0165-042 (S21-02)** — **fixed** (ruling 0236 D1: the status/attempts
  read sanitized at the readUnits home — every consumer through the one
  source, identity on well-formed files, `"done"` reads pending, "7" reads
  0 and begin books 1).
- **0165-072 (S04-02)** — **fixed** (ruling 0236 D6: the install ahead of
  the rename, every kill point re-derivable; the pathspec half consumed as
  landed — 0207 D1; the manual prompt untouched by design, P15).
- **0165-073 (S04-03)** — **fixed** (ruling 0236 D3: stopBlocked unprotects
  the four post-protect exits; the EACCES and hibernate remedy arms declined
  as already landed — 0215 D3 and 0182, with the measured loci; the capture
  harness's compensating unprotect stays for the success arm).
- **0165-074 (S04-04)** — **fixed** (ruling 0236 D4: the `unreadable`
  verdict through UnitGate/UnitStop/Outcome with TASK_OUTCOMES grown in P13
  lockstep; no exemption consumes it; every block teaching investigation;
  the driver-helper and unit-start-exemption family arms declined on
  measurement).
- **0165-078 (S04-09)** — **fixed** (ruling 0236 D5: the per-family
  teaching for the knowledge kb.md and the regression receipt, additive
  lines over the unchanged generic block; the handover and wall families
  declined on measurement — their windows close inside one driver step and
  their partials never ratify; the progress-record alternative declined on
  the bypass design).
- **0165-151 (S21-03)** — **fixed** (ruling 0236 D2: one ⚠ per file naming
  the loss, the corrupt bytes moved aside at the next write, the run
  degrading visibly; 0047 R1's rationale restated; the block-the-run
  alternative declined).
- Residuals: none deferred of this step's six; the declined-with-measurement
  arms are recorded in the ruling's decisions and the ledger rows.
