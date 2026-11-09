# Step 077 — wc-runtime-hygiene: runtime hygiene A (the handover rollback's scope, the unknown-id park, the round-close build's EOF wait, the mid-restart throw's teaching line, the weak-oracle repairs, the loop comments, the run-control aggregates)

Status: **done** 2026-11-09 (started from HEAD 0f7251504 — step 076's
commit; worked, verified and committed in one session).

Findings: 0165-019 (S10-08, S2 CONFIRMED CONC — the handover engine's strict
rollback redo is tree-wide: one doc unit's due-but-invalid handover stashes
every sibling's in-flight files and soft-resets past their landed shares),
0165-075 (S04-05, S3 CONFIRMED VOCAB — a park on an id that exists nowhere is
treated as a cross-phase park and throws exit 1 with a remedy naming a phantom
task), 0165-102 (S09-02, S3 CONFIRMED FAIL — the round-close build's 30-minute
cap does not bound the wait: runBuild kills only `sh` and awaits EOF on pipes a
grandchild still holds), 0165-137 (S18-04, S3 PLAUSIBLE FAIL — a restart that
throws mid-way leaves the rotation path without its fallback teaching line),
0165-175 (S32-05, S3 CONFIRMED TEST — weak-oracle tests pin defects as
behavior), 0165-184 (S04-10, S4 CONFIRMED DOC — stale comments and fragile
ordering in the loop-root family), 0165-186 (S06-09, S4 CONFIRMED DEF —
run-control hygiene: formatDurationCompact's unit inversion, the services
install stack's one-slot depth vs the ruled LIFO, the CLI lock comment's
"one atomic check" claim), all bucket WC-hygiene. Evidence: the records
plans/0165-review/S10-dispatch.md (019), S04-loop-root.md (075, 184),
S09-round-docs.md (102), S18-agent-adapters.md (137), S32-synthesis.md (175),
S06-control.md (186).

Surface: `src/unit-commit.ts` (rollbackUnitState's sibling guard — 019's one
home), `src/opts.ts` + `src/loop-task.ts` (the siblingScopes fact carried onto
the doc-lane session options), `src/execute.ts` (the park's unknown-id arm and
the cross-phase blocked verdict; both rollbackRedo closures threading the
fact), `src/round-close.ts` (runBuild over the process-group machinery),
`src/session.ts` (the rotation restart's catch-and-teach), `src/log.ts`
(formatDurationCompact), `src/services.ts` (the install stack), `src/loop.ts`/
`src/phases/registry.ts`/`src/protect.ts` (the comment restatements and the
serverHandle reorder), `packages/auto/src/index.ts` (the lock-refusal
comment), their test homes, ruling 0237 + INDEX row + program bookkeeping.

## Plan (written before editing)

1. Ruling 0237 first: answer each finding's boundary from docs/principles.md
   (P17/P20/P5 for the rollback scope; P2/P8/P13 for the park vocabulary;
   P12/P20 for the build wait and the restart throw; P19 + the How-to-rule
   test-home discipline for the weak oracles; P13/P8 for the comments; P5/P12
   for the run-control aggregates). Measure every locus at HEAD 0f7251504 —
   the review's line numbers drifted, and steps 050/051/060/071/076 landed
   arms of the records' remedies (the siblingScopes threading, the goldens,
   the README tier paragraph); where an arm is already landed or its remedy
   is wrong on measurement, decline it with the measurement.
2. Enact per the ruling: the guard at rollbackUnitState with the fact
   threaded through the doc-lane session options; the park's known:false arm
   joining the invalid branch and the cross-phase arm returning blocked;
   runBuild over detached group spawn + watchProcess with the output in a
   file; the rotation restart's catch-teach-rethrow; the re-pointed Choice
   oracles; the comment restatements + the serverHandle reorder; the
   duration rounding and the real install stack; the CLI comment's honest
   wording.
3. Regression coverage per ruled defect, fail-before proven by the /tmp
   swap-source method (back up fixed files, `git show HEAD:` the pre-fix
   bytes in, run the new tests red, restore, cmp-verify byte-identical, run
   green).
4. Verify: `bun typecheck` + the full suite against the 3286 pass / 0 fail,
   165 files baseline (step 076's); packages/auto's suite too (the CLI
   comment is a shell file — auto: 170/8/6 with the 6 named pre-existing
   fails).
5. Bookkeeping: INDEX row 0237, ledger dispositions for the seven findings,
   program row 077 → done, Current position rewritten, this record's
   Verification + Dispositions filled. Commit the step's paths.

## Session log

- 2026-11-09 (this worker): authoritative inputs read (the program's
  executable prompt, status row 077, the seven ledger rows, Current position;
  the S10-08/S04-05/S09-02/S18-04/S32-05/S04-10/S06-09 records in full plus
  S17-10's (the 0165-057 row's deferred half); docs/principles.md's
  P2/P5/P8/P12/P13/P17/P19/P20 statements; AGENTS.md's navigation lines for
  the touched surfaces; 0096 D7's letters, 0116 D6's lock letter, 0233's
  How-to-rule discipline, 0203's oracle boundary). Loci re-measured at HEAD
  0f7251504: execute.ts parkCheck :291-307 (foreign/known both thrown at
  :629-638), rollbackRedo :545-568 and :1205-1232 both unguarded;
  unit-commit.ts rollbackUnitState :171-199 (no sibling fact); loop-task.ts
  dispatch :1294-1298 and flatten :1435 thread siblingScopes only into
  runTask's input (the ladder's pre-checks runner.ts :352/:420 read it;
  executeWhole gets `{ docLane }` alone at runner.ts :625); opts.ts Opts has
  docLane :283, the task site :348-434 (siblingScopes absent); round-close.ts
  runBuild :118-140 (plain spawn, pipes, proc.kill() at the cap); script.ts
  watchProcess :166-226 + killGroup :89 + detached spawn :136-147 (the 0175
  machinery, exported); server.ts restart :204-256 (0219 D3's closed flag and
  one-in-flight in place; spawn failure still throws); session.ts rotation
  :387-393 (commitRotation + setConfig then restart, the fallback line only
  on false); blockage-diagnosis.test.ts :236-239 `toMatch(/Choice: A/)`
  whole-text (the reader's ruled grammar blockage.ts choiceMark :356-374 is
  Decision-region + line-anchored); loop.ts exit-code comment :43-46 (no 3),
  the clamp closure reading serverHandle :287-289 declared :333 (the TDZ);
  phases/registry.ts :46-47 ("Chinese until the M3.8 translation batch" over
  English names :110-180); protect.ts :13-15 ("runAll restores writability
  in a finally block" — preflight's stopBlocked exits now unprotect too,
  0236 D3); loop-phase.ts :329-330 comment TRUE at HEAD (installApprovedBrief
  mark-gated :474-477, 0169 D2 — the record's S04-06 arm consumed as
  landed); log.ts formatDurationCompact :182-190 (the inversion live,
  pinned as behavior by log.test.ts :104 `59_950 → "60.0s"`; the verbose
  sibling :170-176 already round-first with its tier-carry pinned :89);
  services.ts :122-151 (one-slot `previous`, 0061's AUTO-DECISION rules
  "the installs restore in LIFO order"); auto/src/index.ts :1296-1314 (the
  lock-refusal comment's "one atomic check → write → commit", 0116 D6's
  letter); S17-10's deferred README half GONE at HEAD (step 071's 0231
  removed "numbering recovery" from README:1292; attempt.ts's comment
  restated by 0178 D5; agent-pool's no-op restart landed; keyring's bound
  comment matches the implementation — nothing owed); 0165-175's other four
  arms consumed (0187 D4 re-blessed the two goldens; 0220 D1 replaced the
  permissive census fixture; 0198 D1 re-pointed the progress tests; 0203
  ruled the ratchet's oracle boundary) — the blockage Choice oracles the one
  live arm. Row 077 marked doing; this record created. Next: write ruling
  0237, then enact.

- 2026-11-09 (this worker): ruling 0237 written (one consolidated Derives
  paragraph, ten showings plus the How-to-rule discipline, Category scope
  25 rows, the premise guard naming the re-reads and the six declined or
  consumed arms). Enacted: D1 in src/unit-commit.ts (the guard before any
  git call, the D10 tail verbatim) + src/opts.ts (Opts.siblingScopes + the
  task-site member) + src/loop-task.ts (runDocUnit threads the site; the
  runTask input carrier retired) + src/runner.ts (the pre-checks and
  rollbackRefused on opts, messages byte-identical) + src/execute.ts (both
  rollbackRedo closures); D2 in src/execute.ts (parkCheck's state-file
  split, the foreign caller's blocked return); D3 in src/round-close.ts
  (runBuild over the 0175 machinery — detached group spawn, the
  shell-redirected output file under scriptTmpDir, watchProcess with
  idle=max=cap and the tick finer than the cap, readLogTail, exported with
  the timeoutMs knob); D4 in src/session.ts (the rotation catch-teach-
  rethrow); D6 in src/loop.ts (the exit-code comment, the serverHandle
  const above the clamp wiring) + src/phases/registry.ts +
  src/protect.ts; D7 in src/log.ts (round-first, the tenth kept
  sub-minute) + src/services.ts (the real stack) + packages/auto/src/
  index.ts (the honest lock comment); D5 in test/blockage-diagnosis.test.ts
  (the readers as oracles). Regression tests in eight files; fail-before
  proven over /tmp/077-fixed (the twelve changed src files swapped to
  HEAD: the two-level sibling refusal, the opts key, both park arms red on
  the exact throw, the hung-grandchild cap, the rotation line, the
  rounding, the depth-3 stack — all red, restored cmp-verified
  byte-identical, green). Verification: typecheck exit 0; full suite 3293
  pass / 0 fail (165 files, +7 net new, first run green, no agent-fake
  one-off); packages/auto typecheck exit 0, suite 170/8/6 — its exact
  named baseline. Bookkeeping: INDEX row 0237, the seven ledger
  dispositions, the 0165-057 deferral note reconciled, program row 077 →
  done, Current position rewritten, structure.md's four rows, AGENTS.md's
  doc-lanes line. Step 077 committed.

## Verification

- auto-core `bun typecheck` exit 0.
- Full suite **3293 pass / 0 fail** (165 files = the 3286 pass / 0 fail
  baseline + 7 net new: unit-commit +1, execute-handover +1, session-opts
  +1, park +1 net (the throw pin rewritten into two ruled-verdict rows),
  round-gates +1, agent-fake +1, services +1, log +0 re-pointed) — green on
  the first full run; the agent-fake quota-wait one-off absent.
- packages/auto (touched: the CLI lock-refusal comment) `bun typecheck`
  exit 0; suite **170 pass / 8 skip / 6 fail** — the exact named baseline
  (the phased-flow row "roadmap-driven establishment…" and the five
  fork/remove-fork rows, all pre-existing; the session's one shell edit is
  comment-only).
- Fail-before over /tmp/077-fixed (the twelve changed src files backed up,
  HEAD's bytes via `git show` swapped in, restored and cmp-verified
  byte-identical): the unit-level sibling refusal (at HEAD the rollback ran
  — a stash written, the verdict `ok`), the engine-level refusal (at HEAD
  the redo cold-started — result undefined, the stash present), the
  opts-site key (absent at HEAD), both park arms (at HEAD red on the exact
  thrown Error — the unknown-id shape and the cross-phase shape alike), the
  hung-grandchild cap (at HEAD the wait rode the pipes to the grandchild's
  own lifetime — the finding's repro shape), the rotation teaching line
  (absent at HEAD beside the propagating throw), the duration rounding
  ("60.0s" still pinned at HEAD) and the depth-3 stack (the process default
  after two uninstalls at HEAD) — all red at HEAD, green at the fix.
- D5's oracle rows green at HEAD by the test-home discipline (0233): the
  runtime writer was correct, the oracle weaker than the ruled grammar; the
  proof is the repaired rows' green runs beside the render-level teeth row
  (blockage-diagnosis.test.ts's indented ` Choice: A` answering
  choiceMark-undefined), which fails any whole-text matcher.

## Dispositions

- **0165-019 (S10-08)** — fixed (0237 D1): the sibling guard at
  rollbackUnitState's one home, the fact on the session options, both
  execute.ts closures threading it, the ladder's input carrier retired;
  pinned at the unit level, the engine level (real git, the due-but-invalid
  handover under a live sibling scope) and the opts site.
- **0165-075 (S04-05)** — fixed (0237 D2): the unknown id joins the invalid
  arm (the collect problem — one relaunch with the invented-id feedback,
  then the hidden-blockage block), the cross-phase park returns blocked
  with today's message verbatim minus the throw; both arms pinned, the old
  throw pin rewritten.
- **0165-102 (S09-02)** — fixed (0237 D3): runBuild over the detached group
  spawn + file output + watchProcess cap with TERM→grace→KILL, the
  message byte-identical (the pinned round-gates tail row green
  unchanged); the hung-grandchild pin bounds the wait at the cap.
- **0165-137 (S18-04)** — fixed (0237 D4): the rotation restart's
  catch-teach-rethrow — the ⚠ names the committed rotation and the
  next-spawn application, the throw propagates (fail-loud kept); the
  reorder arm declined as structurally impossible, the walk's void restart
  by design.
- **0165-175 (S32-05)** — fixed (0237 D5): the blockage suite's Choice and
  Executed oracles re-pointed through the executor's own readers with the
  declining row's choiceMark-undefined; the record's other four arms
  consumed as landed (0187 D4, 0198 D1, 0220 D1, 0203 — each re-read
  standing).
- **0165-184 (S04-10)** — fixed (0237 D6): the exit-code comment complete
  (3 + the signal rows), the serverHandle reorder (TDZ retired, behavior
  byte-identical), registry's name comment, protect's lifecycle sentence
  naming both unprotect homes; the loop-phase Clarified arm declined as
  consumed (true since 0169 D2).
- **0165-186 (S06-09)** — fixed (0237 D7): the duration rounding (the
  pinned inversion retired), the real install stack (LIFO at any depth,
  depths ≤ 2 byte-identical), the CLI comment's honest check-then-act
  wording; the take-the-lock arm declined on P21; S17-10's deferred
  README/comment half measured GONE at HEAD (071's 0231, 0178 D5,
  keyring's bound comment) — the 0165-057 row's deferral note reconciled.
- Residuals recorded: none deferred of this step's findings; the declined
  arms and their grounds live in the ruling's decisions and the ledger
  rows.
