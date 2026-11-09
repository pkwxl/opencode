# Step 078 — wc-hygiene-modules: hygiene B (the runner's missed 0156-D5 log, resolve.ts's comment language, the dead export, the STATS_PLAN citations, the external-dirs dedup, the task-store hygiene)

Status: **done** 2026-11-09 (started from HEAD 5199a8b73 — step 077's
commit; worked, verified and committed in one session).

Findings: 0165-192 (S10-09, S4 CONFIRMED TEST — the 0156 D5 surface missed
in runner.ts's strict-resume invalid-handover log; stale and orphan comments;
saveHandover's write shape; the untested recovery skips and multi-handover
chains), 0165-193 (S11-11, S4 CONFIRMED DOC — resolve.ts commented in Chinese;
the stale TestRun.subject comment; nextFixSession's unbounded history scan),
0165-194 (S12-11, S4 CONFIRMED CPLX — resumeModelNow a dead export kept alive
by its own test; parseProgress passing unknown phase kinds through
unvalidated), 0165-198 (S15-05, S4 CONFIRMED DOC — 32 comments citing
plans/STATS_PLAN.md, a file never in this repository's history; the stats
header's stale concurrent-runs note), 0165-205 (S20-14, S4 CONFIRMED DUP —
the door scan written twice, protect's swallowed chmod failures, a duplicated
containment helper, wall's double config parse), 0165-206 (S21-06, S4
CONFIRMED UX — a park-problem remedy naming the wrong file, a false header
claim, CR-carrying task bodies, Artifacts paths unconstrained beside Touches),
all bucket WC-hygiene. Evidence: the records plans/0165-review/S10-dispatch.md
(192), S11-verification.md (193), S12-recovery.md (194), S15-accounting.md
(198), S20-isolation.md (205), S21-tasks.md (206).

Surface (expected, re-derived at HEAD before editing): `src/runner.ts` (the
strict-resume log's stream-aware path; the orphan comments), `src/execute.ts`
(stale comments), `src/handover.ts` (the save shape), `src/resolve.ts` (the
comment translation), `src/testrun.ts`/`src/git.ts`/`src/wrapup.ts` (the
stale comment restatements; the corpus bound), `src/unit-commit.ts` +
`src/resume.ts` + `src/resume-gate.ts` (the dead export; the kind
validation), the 17 STATS_PLAN-citing src files, `src/external-dirs.ts` +
`src/protect.ts` + `src/fork.ts` + `src/wall.ts` (the dedup and the chmod
teaching), `src/tasks.ts` + `src/document/spec.ts`/`src/document/unit.ts`
(the task-store hygiene), their test homes, ruling 0238 + INDEX row +
program bookkeeping.

## Plan (written before editing)

1. Ruling 0238 first: answer each finding's boundary from docs/principles.md
   (P19/P6/P12 for the measured hygiene arms; P5 for the dedup and the dead
   export; P8/P12 for the swallowed chmod; P18 for the citations; P7 for the
   task-store grammar arms; P13 for any vocabulary surface). Measure every
   locus at HEAD 5199a8b73 — the review's line numbers drifted and later
   steps (023/0183 for the handover write, 0236 for units.json, 0237 for
   execute.ts's park arms) landed arms of the records' remedies; where an
   arm is already landed or its remedy is wrong on measurement, decline it
   with the measurement.
2. Enact per the ruling: the runner log's stream-aware path; the comment
   restatements (resolve.ts's translation included — pure comments, behavior
   byte-identical); the corpus bound where ruled; the dead export's removal;
   the kind validation; the STATS_PLAN citation sweep; the external-dirs
   dedup + the chmod teaching line; the task-store arms (the park remedy's
   file, the header, CRLF in taskBody, the Artifacts path rule).
3. Regression coverage per ruled defect, fail-before proven by the /tmp
   swap-source method (back up fixed files, `git show HEAD:` the pre-fix
   bytes in, run the new tests red, restore, cmp-verify byte-identical, run
   green). Comment-only arms prove by measurement (grep red/green), the
   0233 test-home discipline.
4. Verify: `bun typecheck` + the full suite against the 3293 pass / 0 fail,
   165 files baseline (step 077's); no shell suite unless a shell file is
   touched (none expected — all six findings are auto-core).
5. Bookkeeping: INDEX row 0238, ledger dispositions for the six findings,
   program row 078 → done, Current position rewritten, this record's
   Verification + Dispositions filled. Commit the step's paths.

## Session log

- 2026-11-09 (this worker): authoritative inputs read (the program's
  executable prompt, status row 078, the six ledger rows, Current position;
  the S10-09/S11-11/S12-11/S15-05/S20-14/S21-06 records in full;
  docs/principles.md's P5/P6/P7/P8/P12/P13/P18/P19/P21 statements; AGENTS.md;
  0156 D5, 0148 D1, 0140, 0019, 0053 D1, 0122, 0147, 0188, 0047, 0158's
  letters). Row 078 marked doing; this record created. Next: measure every
  locus at HEAD 5199a8b73, then write ruling 0238.

- 2026-11-09 (this worker): measurement pass at HEAD `5199a8b73` complete.
  **192**: runner.ts:356's invalid-handover log names `handoffFile(task)`
  while the read at :326 takes `subtaskDoc(task.id, opts.stream, "handoff")`
  for a stream — the 0156 D5 miss LIVE; runner.ts:36-38 the orphan
  formatDurationCompact note (no import follows; STATS_PLAN cite), :~186
  "throws its Chinese error message" (switches.ts errors English, measured)
  both stale; execute.ts:361 "cleaned up by the caller" (only an untracked
  copy — removeIfUntracked at runner.ts:578/:598, 0171's remedy), :988
  "ticks the checklist item on trust" (the shape check gates the tick since
  0171, execute.ts:1319-1341), :993-999 "left by a run of an earlier
  release" (the read is the live consumed-state seeding — :1104-1110's
  comment tells the truth) all stale; handover.ts saveHandover CONSUMED as
  landed (0183 D2's tmp+rename measured); no test names the recovery-skip
  lines (grep empty), no tracked-document recovery-skip case per scope.
  **193**: resolve.ts 128 CJK comment lines, zero code-side CJK (measured by
  comment-stripping scan); testrun.ts:131's `fix<n>` shape stale (writer
  `<id> fix <round>.<session> <short title>`, wrapup.ts:364); nextFixSession
  whole-history scan LIVE (git.ts:95-115, `log --format=%s` unbounded);
  wrapup.ts's bound comment CONSUMED (states 0198's 2N+2/2N, measured TRUE).
  **194**: resumeModelNow dead export LIVE (only test/unit-commit.test.ts
  imports it; resume-gate.ts:242's AUTO-DECISION records the drop);
  parseProgress passes unknown kinds through (sanitizePhaseRound returns any
  non-wrapup as-is; step's `step` unvalidated — phaseText's handover
  fallthrough). **198**: 32 STATS_PLAN cites in 17 files (unchanged from the
  review), `git log --all -- '**/STATS_PLAN.md'` empty; stats.ts:24-27's
  "accepted boundary, no lock file added" stale after 0053 D1; stats.ts:1027
  cites "the risks section of context.md" (never in history); 0019 §A–H
  mapped (§F items 1–6 ↔ §4.1–4.6). **205**: rootSymlinkRealPaths /
  rootSymlinkDoors duplicate loop+exclusions LIVE (external-dirs.ts:72-100);
  protect.ts set() = `chmod(...).catch(() => {})` LIVE (:58-60); wall.ts
  openFindingsOf double parse LIVE (:269-270 — externalDirectoryLive +
  admittingCoverage's internal re-parse); fork.ts within() measured a
  DISTINCT grammar (directional; both refusal directions pinned at
  fork.test :376/:379/:660) beside pathsOverlap (symmetric, 0189 D3's
  deliberate shared predicate) and allowCovers (pattern) — the dedup arm
  declines on measurement. **206**: the wrapper's remedy misdirects for park
  problems LIVE (tasks.ts:602-607 teaches editing todo.md fields; the park
  record lives in .auto/units.json); the header's "checked on load" true of
  the task graph only (subtask graph at runner.ts:1170, execute.ts:929,
  split.ts:109, work-order.ts:217 — never loadPlan); taskBody keeps `\r`
  LIVE (tasks.ts:294-313; subtasks()'s precedent at :172-174); Artifacts
  accepts absolute/`..` paths LIVE (spec.ts declarePath/checkArtifactSpecs;
  Touches' rule at unit.ts:412-413). Next: write ruling 0238.

- 2026-11-09 (this worker): ruling 0238 written (one consolidated Derives
  paragraph, nine showings, Amends none — 0156 D5 completed, 0148 D1/0140
  standing; the premise guard naming fifteen re-reads and the four
  declined/consumed arms; Category scope a 28-row table). Enacted: D1 in
  src/runner.ts (the log's stream-aware path, `handoffFile(task,
  opts.stream)`) + the five comment restatements across runner.ts/execute.ts;
  D2 in src/resolve.ts (the 128-line translation — code comment-stripped
  byte-identical, zero CJK after) + src/testrun.ts (the subject comment) +
  src/git.ts (nextFixSession over the taskChangedPaths corpus pattern,
  sha-filtered subjects, the whole-log floor); D3 in src/unit-commit.ts
  (resumeModelNow deleted) + src/resume.ts (PHASE_KINDS/STEP_KINDS
  validation, validPhase before sanitizePhaseRound) + test re-pointing; D4
  across the 17 stats-family files (32 cites re-pointed to plans/0019's
  measured sections, grep 32 → 0; the header sentence; the §H cite); D5 in
  src/external-dirs.ts (rootSymlinkRealPaths derived; admittingCoverageLive
  split) + src/protect.ts (set() renders its ⚠ lines, the three arming
  calls returning them — protect/protectAdditional/unprotect) with the five
  driver call sites logging them (loop-preflight's protect and stopBlocked,
  loop's forceTerminate and finally, wall's protectAdditional; the first
  attempt imported log into protect directly and the import-direction D8
  rule refused it — the document-domain module returns lines, the driver
  plane logs) + src/wall.ts (openFindingsOf parses once); the within()
  unification declined per the ruling; D6 in src/tasks.ts (the park remedy
  tail split by problem kind; the header; taskBody's CRLF entry
  normalization) + src/document/unit.ts (isAbsolutePath/pathHasDotDot/
  pathEscapesRoot exported at the Touches rule's home, the Touches arm on
  them) + src/document/spec.ts (checkArtifactSpecs refuses escaping
  declarations before any existence test). Regression tests in eight files
  (+10 new, −2 deleted pure tests, +8 net). Verification below. Next:
  bookkeeping, then commit.

## Verification

- auto-core `bun typecheck` exit 0.
- Full suite **3301 pass / 0 fail** (165 files = the 3293 pass / 0 fail
  baseline + 8 net new: resume +2, execute-handover +2, git +1, protect +1,
  tasks +2, document-spec +1, external-dirs +1, unit-commit −2 with the
  eligibility picks re-pointed; 21404 expects) — green on the first full
  run; the agent-fake quota-wait one-off absent.
- No shell suite (no shell file touched — all six findings auto-core).
- Fail-before over /tmp/078-fixed (the twelve changed code files backed up,
  HEAD's bytes via `git show` swapped in, the seven defect rows run red,
  restored and cmp-verified byte-identical, green):
  - the stream-aware log (resume.test.ts — at HEAD the log names
    `docs/T-001/handoff.md`, the not.toContain failing);
  - the kind validation (resume.test.ts — a bogus kind and two bad step
    shapes passing through at HEAD);
  - the corpus-bounded ordinal (git.test.ts — at HEAD the wiped lineage's
    fix 1.2 numbers the new corpus's first session 3, not 2);
  - the ELOOP ⚠ (protect.test.ts — at HEAD protect returns void, no line);
  - the park remedy (tasks.test.ts — at HEAD the wrapper teaches the
    Depends field remedy alone, no .auto/units.json naming);
  - the CRLF body (tasks.test.ts — at HEAD the CR bytes ride the body);
  - the artifact escape (document-spec.test.ts — at HEAD the EXISTING
    outside file passes the declared gate silently, the defect's exact
    shape).
- Green at HEAD by design: the two recovery-skip oracles (execute-handover
  — the finding measured absent coverage, not a defect; the skip mechanism
  was correct and untested) and the derivation pin (external-dirs — a
  byte-identical dedup, the pin the ratchet).
- Comment-only arms proven by measurement: resolve.ts 128 CJK comment lines
  at HEAD → 0 after (code comment-stripped byte-identical against HEAD's
  bytes); the 32 STATS_PLAN cites at HEAD → 0 after; the stale wordings
  ("Chinese error message", "ticks the checklist item on trust", "earlier
  release", "no lock file added", "risks section of context.md", the
  `fix<n>` subject shape, the orphan formatter note) all present at HEAD,
  absent after.
- Import-direction suite green with the final shape (the protect→log import
  refused by the D8 domain rule — the restructure keeps protect
  document-pure, its lines logged by the driver-plane callers).

## Dispositions

- **0165-192 (S10-09)** — fixed (0238 D1): the log beside the read names
  the read's own document (0156 D5 completed at its one missed surface);
  the five stale comments restated; saveHandover's atomic write consumed as
  landed (0183 D2); the recovery-skip oracles landed one per scope over a
  tracked `Status: done` document.
- **0165-193 (S11-11)** — fixed (0238 D2): resolve.ts translated (pure
  comments); the subject comment restated to 0148 D1's grammar;
  nextFixSession corpus-bounded (the arm 0165-204's row assigned here,
  the ⚠ and floor byte-identical); wrapup's bound comment consumed as
  landed (0198's 2N+2/2N already stated at HEAD).
- **0165-194 (S12-11)** — fixed (0238 D3): resumeModelNow deleted with its
  two pure tests, the eligibility picks re-pointed through the router's
  own target; parseProgress's phase read validated (unknown kind or step
  shape → no phase, the default flow).
- **0165-198 (S15-05)** — fixed (0238 D4): the 32 citations re-pointed to
  plans/0019's measured sections; the header sentence stating the run lock;
  the context.md cite → §H.
- **0165-205 (S20-14)** — fixed (0238 D5): the one doors scan; protect's
  chmod failures rendered and logged by the driver plane (ENOENT excepted;
  the D8 boundary held); the single parse inside the closed predicate; the
  within() unification declined on measurement (three grammars, pinned
  directional teachings — recorded in the ruling).
- **0165-206 (S21-06)** — fixed (0238 D6): the park remedy naming the
  record and its file; the header telling where each graph is checked;
  taskBody's CRLF normalization; the Touches escape rule consumed by the
  artifact checker (both policies, every declaration surface).
- Residuals recorded: none deferred of this step's six; the declined arms
  and their grounds live in the ruling's decisions and the ledger rows
  (the allowWrite/reprotect half of the ⚠ left void — a reprotect failure
  surfaces at the driver's own write, never the finding's shape).
