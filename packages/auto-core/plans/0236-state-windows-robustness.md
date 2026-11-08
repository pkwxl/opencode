# 0236 — State-window robustness: the runtime read sanitized and evidence-preserving, preflight's protected exits, the unreadable verdict no exemption consumes, the clean gate's per-family teaching, the survey brief install ahead of the rename

Status: active-authority (0166 remediation step 076, wave WC-hygiene; findings
0165-042 = S21-02, S2 CONFIRMED STATE; 0165-072 = S04-02, 0165-073 = S04-03,
0165-074 = S04-04, 0165-078 = S04-09, 0165-151 = S21-03, all S3 CONFIRMED).

One family — **the state windows around the driver's own reads, writes and
exits** (P12's conservative-under-uncertainty applied at each window: a runtime
read that trusts shape, a parse failure that destroys evidence, an exit path
that leaks a protection, a gate verdict whose meaning an exemption consumes, a
block line that cannot name whose dirt it lists, a kill window between two
driver acts). 0165 is the evidence, not the authorization: every locus below
was re-measured at this step's HEAD `3d0c9473a` before the remedy was chosen,
and two of the review's remedy arms are declined on measurement as already
landed or unreachable.

## The measured ground (this step's own, at HEAD `3d0c9473a`)

- **042**: tasks.ts:585 `status: done ? "done" : (runtime.status ?? "pending")`
  and :587 `attempts: runtime.attempts ?? 0` — the only two runtime fields read
  without a sanitizer (parseForkBase :411, parseSplitPoint :427, parseLeadUsed
  :434, parkedOf :441 all sanitize; laneRecords :953 f. sanitizes per field).
  The raw entry also reaches `begin` :731 (`(entry.attempts ?? 0) + 1`, and
  `from = entry.status ?? "pending"` :730) and `unitAttempts` :965 through
  updateTask's spread of the raw read.
- **151**: readUnits :458-469 — a parse failure returns `{ tasks: {} }` under
  the comment "every one of them has a safe default" (0047 R1's words, written
  when the file held status/attempts/forkBase); since then 0068 D6 put the lane
  registry in it, 0096 D7 the park, 0059 D5 the split point, 0097/0171 the
  digests. updateUnits :473-485 writes the empty read over the file. The writes
  are tmp+rename atomic — the reachability is external damage (a hand edit)
  alone. git.ts:615-630 (runtimeEntryGone) already treats a corrupt read as
  "entry gone" — the heal path's own degradation, unchanged by this ruling.
- **072**: loop-phase.ts — completePhase at :316 (gates re-checked inside, then
  rename+tick), `installApprovedBrief` at :349, the transition commit at :363.
  A kill between :316 and :349 leaves the phase done on disk with the install
  never run: routing moves to the next phase (the tick is the routing fact),
  `installApprovedBrief`'s only survey caller is :349, and the next phase's
  formulation reads the old brief — the person's approval silently dropped.
  The finding's other half (the pathspec-less install commit absorbing the
  rename and tick) is **already landed as 0207 D1** (step 047): brief.ts
  :167-170 commits exactly `[BRIEF_FILE, source]`, and the comment states the
  transition commit keeps the close-out booking. The remedy's remaining arm is
  the reorder alone. The manual prompt (prompts/run-handover.md steps 2-4)
  teaches its own driver's sequence — untouched (P15: the manual suite is its
  own driver; its transition commit is the absorbing `git add -A`, its re-entry
  the person's re-run, its kill semantics not this finding's).
- **073**: loop-preflight.ts — protect() at :600; four post-protect exits
  (:640 reblocked, :707 the dirty gate, :738 orphan recovery, :815 the
  housekeeping commit failure) close progress and watcher but never unprotect;
  the only unprotect is driveRun's finally (loop.ts :432), which
  runLocked returns before (:68). The finding's other remedy arms are
  **already landed or out of reach on measurement**: sync's provenance write
  and every brief write go through 0215 D3's write-tmp-then-chmod-rename
  (sync.ts writeManaged :293-305, brief.ts writeBrief :110-121 — "the rename
  also replaces a stale read-only bit a killed run left behind"), so no
  EACCES remains from a 0444 leftover on those paths; and step 022 (ruling
  0182) already installed the signal handlers before the startup
  hibernatePause (loop.ts :151-158 precede :158's pause — a double Ctrl+C
  runs forceTerminate, which unprotects at :139). The test harness's
  compensating unprotect (loop-preflight.test.ts capture :200) serves the
  SUCCESS arm too (preflight alone leaves protect active by design — the
  real run continues into driveRun), so it stays; the new exit-arm pin holds
  the behavior instead.
- **074**: beginUnit's two strict arms — the refused work tree (git.ts
  :1325-1330) and the unreadable status (:1337-1344, 0155 D1) — both return
  `type: "dirty"` with sentinel-shaped file lines. Preflight's exemption
  (:674-678) consumes ANY dirty verdict under `peekProgress(directory)?.active
  === true` (0149's run-start exemption). The finding's family arms measured
  unreachable: loop-task's unit-start gates decide by recallProgress BEFORE
  beginUnit (:517-520, :1578-1582) — an active record never reaches the gate,
  so no unit-level exemption can consume the sentinel; driver-helper's
  dirty-tree row (:515-525) reads changedFiles (the legacy front — statusEntries
  :1830-1832 reads [] on unreadable) and peekProgress, never beginUnit's
  verdict, and is quiet on an unreadable tree. The confirmed consumption is
  preflight's alone; the false remedy ("handle them manually (commit or
  clean)" over a corrupt index) is the start gate's block line (:702) —
  dirtyStopLines bakes the same remedy into every unit-level wrapper
  (log.ts :141-143).
- **078**: the start-gate block (:702-704) lists the dirty files under the one
  generic remedy. The knowledge extraction writes no progress record by design
  (knowledge.ts :44 "the pseudo task PLAN does not enter the task chain, writes
  no progress record"), its idempotence is existingKnowledge's non-empty test
  (:37-41) — a committed truncated kb.md is skipped as "already produced";
  the regression receipt is written by the background lane and committed only
  at the next boundary (script.ts writeLaneReceipt / commitLaneReceipts). The
  finding's other two families measured closed: the handover distillation's
  write is committed inside the same requireArtifact step (distillCommit) and
  an invalid partial never ratifies — collect rejects it and reset rewrites
  (loop-phase.ts :198-220); the wall's opencode.json deny rides the wall
  commit itself (0132 D2's three-step close). roleOf already classifies the
  receipt ("regression", roles.ts REGRESSION_RECEIPT :210); the knowledge kb
  shape has no recognizer outside phaseArtifacts.

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P3** (completion is never judged by agent self-report — the driver-state
  half): showing for 042 — a hand-edited `"status":"done"` in units.json makes
  a task done with no done.md, no artifact and no git trace; 0047 R1's "a
  task's status is `done` exactly when `done.md` exists" is P3's document-side
  invariant, and the runtime read must not be able to contradict it. The
  sanitized read restores the invariant at the one home every consumer reads.
- **P12** (fail loud; conservative under uncertainty): showings for 042 (an
  unknown status resolves to pending, a non-integer attempts to 0 — never a
  guess), for 074 (an unreadable status is NOT dirt the exemption may absorb —
  the uncertain read resolves toward blocked, with its own cause named), for
  151's evidence arm (the corrupt file is never silently replaced — one ⚠ line
  names it and the bytes are preserved beside the fresh write).
- **P6** (derived state, idempotence, re-derivation): showings for 151 — the
  registry is recoverable-by-default state whose every field has a safe
  default, so the run degrades visibly rather than blocking on a file the
  person is told never to touch (the finding's block-the-run alternative
  declined); and for 072 — the install moved ahead of the rename makes every
  kill point re-derivable: before the rename the phase still reads pending
  and the re-run re-derives the whole handover (the install idempotent, 0209
  D2's own recovery shape), after it the brief is already committed.
- **P20** (in-flight work is never destroyed): showings for 072 (the person's
  approved brief — in-flight work — can no longer be lost to a kill window
  between two driver acts) and 151 (the corrupt registry's bytes survive as
  evidence at `.corrupt-<ts>` instead of being overwritten — the lane
  records, parks and split points a person might still recover by hand).
- **P2** (the person brackets every boundary): showing for 078 — the start
  gate is the person's stop; the block's teaching must tell the person WHICH
  dirt is the driver's own and what each family's safe remedy is (delete the
  partial kb so the extraction re-runs — committing it would ratify a
  truncated document as the phase's knowledge), never leave them to adjudicate
  blind. Detection records; the person's moment enforces (P8's pair).
- **P8** (every surfaced line teaches its remedy): showings for 073 (the
  protected exits leave the person's own next command — `sync`, `amend
  --brief` — failing EACCES with no line naming the cause; protect.ts's own
  header promises "runAll restores writability in a finally block so a human
  can edit the files", a promise the four exits break), for 074 (the
  unreadable block teaches "investigate the repository", never "commit or
  clean" — a remedy that cannot work over a corrupt index), for 078 (the
  per-family lines).
- **P13** (frozen additive-only vocabularies): the `UnitGate` verdict
  vocabulary grows additively (`unreadable` joins `ok`/`dirty` — an internal
  discriminated union), and — because the pipeline Outcome's words are pinned
  exact to the run-events vocabulary — TASK_OUTCOMES grows `unreadable` in
  the same conscious lockstep (the Exact ratchet staying green, every
  consumer handled — the compiler enumerates them); the exit codes and
  block-line shapes stay; the new ⚠/teaching lines are additive (the generic
  lines byte-identical when no family matches, P10's floor).
- **P10** (the byte-identical floor): a well-formed units.json sanitizes to
  itself (identity); a readable clean-or-dirty tree never meets the
  unreadable verdict; the start-gate block's generic line is unchanged; no
  switch, no config, no grammar change.

Derives: P3, P12, P6, P20, P2, P8, P13, P10 (the showings above). Amends:
none — 0047 R1's "unreadable runtime state is not fatal" STANDS (this ruling
restates its rationale beside the fields it now covers, exactly the remedy's
own ask); 0149's exemption STANDS for the dirt it was ruled over (the split
narrows what it consumes, never its letter); 0155 D1 STANDS (its sentinel
gains the distinct verdict its own comment already implies — "the block line
names the root ... P12: the uncertain read resolves toward dirty" — the
dirty TYPING was the implementation, not the ruling).

Tier: **code** (runtime behavior: sanitizers, the corrupt-file handling, the
exits' unprotect, the verdict split, the block-line teaching, the handover
reorder — each with its regression pin).

premises this ruling changes: none — re-read standing: 0047 R1/U4 (the
runtime registry's read contract — restated, not changed: the safe-default
degradation keeps its letter, gains the evidence-preserving arm), 0047 G1-G6
(the field block — untouched), 0068 D6/D14 (the lane registry and orphan
scan — their read unchanged, the corrupt file's aside-move only preserves
their input), 0096 D7 (parks), 0059 D5 (the split point), 0149 D2/D3 (the
run-start exemption — narrowed to honest dirt, its teaching line
byte-identical), 0155 D1 (the strict read — its two arms retyped, its ⚠
line and block preserved), 0021 P3 (the start clean gate — its block gains
additive teaching), 0081 D15.2 (the survey release's install — same act, new
position), 0209 D2 (the install's interrupted-write recovery — its
equal-brief-still-commits contract unchanged, the reorder removes the window
it could not cover), 0207 D1 (the install's pathspec — consumed as landed),
0215 D3 (the write-tmp-then-rename family — consumed as landed), 0182
(the signal handlers before the startup pause — consumed as landed),
0132 D2 (the wall close — measured atomic over its own write),
0024 §I D13 (preflight's exits sit outside runLocked's try/finally — the
ruling adds the exits' own unprotect at their home in preflight, not a
try/finally around the protected half: the success arm must keep protect
active into driveRun, so a region-wide finally is the wrong shape).

## Decisions

**D1 — 042: the runtime read sanitized at its one home (readUnits).** A
per-entry sanitizer inside readUnits — status survives only as the two live
words (`in_progress` | `blocked`), attempts only as a finite non-negative
integer — is the single home every consumer already reads through: loadPlan's
:585/:587 expressions become identity on sanitized values, begin's increment
(:731) and transition `from` (:730), bookAttempt, unitAttempts (:965) and
updateTask's spread all see the sanitized entry, and the next write of an
entry persists the sanitized shape (the file heals incrementally, the same
degradation discipline parseForkBase's family set). A hand-edited
`"status":"done"` reads pending (done stays done.md's alone, 0047 R1); a
string or fractional attempts reads 0 — begin books 1, never "71". The
sanitizer is identity on every well-formed file (P10). Test home:
test/tasks.test.ts (the runtime-state describe) — a units.json
`{"status":"done","attempts":"7"}` row over loadPlan/next(), begin's
numeric increment, and unitAttempts.

**D2 — 151: the parse failure names itself, and the evidence survives the
next write.** readUnits' catch arms with one ⚠ line (a module-level
once-flag — the read is hot, the person needs one line, not one per read)
naming the file and what its loss means (the lane records, parks and split
points read as nothing this run), and updateUnits — inside its serialized
queue, before the write — renames an unparseable file aside to
`units.json.corrupt-<epoch-ms>` and writes the fresh state beside it: the
bytes survive for hand recovery (P20), the fresh write starts from the safe
defaults, and 0047 R1's rationale is restated in the comment that carries it
("not fatal" kept; the fields it now covers named). Blocking the run start
was the finding's alternative and is declined: the registry is
safe-default state the person is told never to touch, and a corrupted
counter file must not strand the work (P6/P20). git.ts runtimeEntryGone's
own corrupt-reads-as-gone degradation is untouched. Test home:
test/tasks.test.ts — a corrupt file over a seeded lane record/park: the ⚠
line once, the read degraded, the next updateUnits writing fresh state with
the `.corrupt-<ts>` beside it holding the old bytes.

**D3 — 073: unprotect on every post-protect exit, at preflight's own home.**
One local `stopBlocked(code)` helper right after protect() — progress.close,
watcher?.close, `await unprotect(directory)`, return `{ exit: code }` —
replaces the four triplet sites (:640, :707, :738, :815): one mechanism
(P5), each exit's code unchanged, the success arm (:818) untouched (protect
stays active into driveRun — the reason the fix lives in preflight, not in
a runLocked finally; 0024 §I D13's placement stands). The finding's
chmod-before-write arms for sync and the brief are declined as already
landed (0215 D3's tmp+rename replaces the stale read-only bit by
construction — measured at sync.ts :293-305 and brief.ts :110-121); the
hibernate sub-item is declined as already landed (0182: the handlers at
loop.ts :151-153 precede the startup pause at :158; forceTerminate
unprotects). The capture harness's compensating unprotect stays — it serves
the success arm, which preflight alone leaves protected by design. Test
home: test/loop-preflight.test.ts — the dirty-gate exit leaves AGENTS.md
writable (0644) again; at HEAD it stays 0444.

**D4 — 074: `unreadable` — the verdict no exemption consumes, the block that
teaches investigation.** UnitGate gains `{ type: "unreadable"; files:
string[] }`; beginUnit's two strict arms (the refused work tree, the
unreadable status) return it. The consumers, enumerated by the compiler:
preflight's start gate — the exemption consumes only `dirty`; an
`unreadable` verdict blocks with its own line ("the repository state cannot
be read ... investigate the repository state and re-run", the file lines
already carrying their causes), never "commit or clean", and the
housekeeping close-out is unreachable behind it; the task-unit and doc-lane
gates (loop-task's two beginUnit sites) block with the investigate wording
(unreadableStopLines, a sibling beside dirtyStopLines in log.ts — the
remedy split out of the shared line); runSubtask's and requireArtifact's
gate mappings (execute, artifact) and formulate's ConstructedFormulation
thread the member through their outcome unions to their print sites
(loop-task's three outcome stops, loop-plan's construction, loop-phase's
distillation and knowledge arms, loop-append's append session,
blockage-diagnose's diagnosis, blockage-execute's pre-choice gate), each
with the investigate wording. The outcome unions are UnitStop and the
pipeline Outcome (opts.ts) — and Outcome's type words are pinned EXACT to
the run-events vocabulary (TASK_OUTCOMES, the Exact ratchet in
test/run-status-schema.test.ts), so the vocabulary grows additively in the
same change: TASK_OUTCOMES gains `unreadable` beside `dirty` (P13's
conscious lockstep — one change, the pin still green), the journal's
task-end/subtask-end events carrying the distinct word so a corrupt
repository is never conflated with resumable dirt in the record either.
Every one of these sites blocks today under "dirty" — the split changes
the remedy line, the exemption and the event word, never the conservative
direction (P12 unchanged). The finding's driver-helper arm is declined on
measurement (row 11 reads changedFiles — the legacy front is quiet on an
unreadable tree — and never the verdict); the unit-start exemption arm is
declined on measurement (recallProgress decides before beginUnit — no
consumption exists). Test homes: test/loop-preflight.test.ts (the exemption
describe — a corrupt .git/index with an active record still exits 2, and
without one the block teaches investigation, not commit-or-clean) and
test/git.test.ts (beginUnit's two strict arms return the unreadable
verdict).

**D5 — 078: the start-gate block names the driver's own record-less
writes, per family.** After the file list, additive lines for exactly the
two families whose kill windows have no record and no re-derivation guard
(measured in the ground above): a knowledge kb.md
(`docs/R-NN/P<nn>-knowledge/kb.md`, recognized by a predicate in
knowledge.ts beside knowledgeFile, pinned to the registry's knowledge
artifact) — "the driver's interrupted knowledge write — delete it and re-run
(the extraction writes it anew; a partial document must not become the
phase's committed knowledge)"; and a regression receipt (recognized through
roleOf === "regression", the one home of the grammar) — "the driver's
background lane receipt — safe to commit (the record is the evidence);
deleted, the lane re-runs at the next boundary". The generic line and list
are unchanged (the floor: no family present, no new line — byte-identical
output for every existing scene). The handover and wall's-opencode.json
families are declined on measurement (their writes are committed inside the
same driver step and their partials never ratify — collect rejects and
reset rewrites; the wall's deny rides the wall commit), recorded here as
the measured boundary, not as open work. The knowledge-entry-writes-a-
progress-record alternative is declined: it contradicts the bypass design
(knowledge.ts :44) and would thread a PLAN pseudo-record through
resume-keyed readers keyed on task ids. Test home:
test/loop-preflight.test.ts — the dirty block over a seeded kb.md and
receipt carries both family lines (absent at HEAD).

**D6 — 072: the survey release's install runs ahead of the completion
rename.** `installApprovedBrief` moves from after completePhase (:349) to
immediately before it — after the gates pre-check and the wall boundary
(:297-312), so the ordering phaseGateProblems → wall → install →
completePhase → transition commit. Every kill point re-derives: before the
rename the phase still reads pending and the re-run redoes the whole
handover (the install idempotent — an equal brief writes nothing and the
commit skips a clean tree, 0209 D2's contract); after the install the brief
is already committed under its own pathspec (0207 D1), and the rename,
transition commit and formulation follow as before. completePhase's own
gate re-check still guards the rename; if that re-check fails after the
install (the narrow race the pre-check just cleared), the phase holds on
its repair/stop path with the person's approved brief installed — the
approval act was real (the Clarified mark the install itself re-checks),
and the repair round re-derives the handover over it. The observable commit
sequence is unchanged (brief-install commit, then the transition commit
booking the rename+tick); what changes is the disk state at the moment of
the brief write — the phase still pending — which is exactly the kill
window closing. The pathspec half of the remedy is consumed as landed
(0207 D1); the manual prompt is untouched (P15 — its own driver, its
transition commit the absorbing one). Test home: test/survey-gate.test.ts
(the boundary-flow released run) with the loop fixture's run opts gaining
an optional `git` service override — a wrapper over services().git records
whether the survey phase's todo.md still stands when the brief-install
commit runs: `[true]` with the fix, `[false]` at HEAD (the kill window,
observed mid-flight); the log still carries the transition commit as the
close-out booking.

## Category scope (0123 D1 — the family: the driver's state windows over the runtime registry, the run-start gates and the phase close-out, measured at ruling time)

| home | this ruling |
| --- | --- |
| `src/tasks.ts` | **changed** — readUnits' per-entry status/attempts sanitizer + the corrupt-read ⚠ (once) and readUnitsState; updateUnits' move-aside before the write; 0047 R1's rationale restated (D1/D2) |
| `src/git.ts` | **changed** — UnitGate's `unreadable` member; beginUnit's two strict arms retyped (D4) |
| `src/loop-preflight.ts` | **changed** — stopBlocked (unprotect on the four post-protect exits); the exemption consumes only `dirty`, the unreadable verdict's own block; the start-gate block's per-family leftover lines (D3/D4/D5) |
| `src/log.ts` | **changed** — unreadableStopLines beside dirtyStopLines (D4) |
| `src/opts.ts`, `src/run-status-schema.ts` | **changed** — UnitStop and Outcome gain the `unreadable` member; TASK_OUTCOMES grows the word in the same lockstep, the Exact pin green (D4) |
| `src/knowledge.ts` | **changed** — the kb leftover recognizer beside knowledgeFile; the extraction unions thread the member (D4/D5) |
| `src/document/roles.ts` | unchanged, deliberately — the receipt recognized through roleOf, the grammar's one home (D5) |
| `src/loop-task.ts`, `src/execute.ts`, `src/artifact.ts`, `src/formulate.ts`, `src/blockage-execute.ts`, `src/blockage-diagnose.ts`, `src/loop-append.ts`, `src/runner.ts`, `src/loop-plan.ts`, `src/loop-phase.ts` | **changed** — the unreadable member threaded through the outcome unions, gate mappings and print sites (D4); loop-phase additionally the install-before-rename reorder (D6) |
| `src/brief.ts`, `src/sync.ts`, `src/protect.ts`, `src/loop.ts` | unchanged, deliberately — the EACCES/handler arms consumed as landed (0215 D3, 0182); protect's header comment restated only if the enactment touches its truth (it does not — runAll's finally keeps its letter, the exits' own unprotect completes it) |
| `src/driver-helper.ts` | unchanged, deliberately — the dirty-tree row never reads beginUnit's verdict (measured; D4's declined arm) |
| `test/tasks.test.ts` | **changed** — the sanitizer rows, begin's numeric increment, the corrupt-file ⚠ + move-aside (D1/D2) |
| `test/loop-preflight.test.ts` | **changed** — the exit-arm unprotect pin, the unreadable-verdict exemption/block pins, the leftover-teaching pin (D3/D4/D5) |
| `test/git.test.ts` | **changed** — beginUnit's strict arms return the unreadable verdict (D4) |
| `test/survey-gate.test.ts` + `test/fixtures/loop.ts` | **changed** — the install-before-rename pin over the boundary-flow run; the fixture's run opts gain the optional `git` override (D6) |
| `prompts/run-handover.md`, `templates/prompts/*` | untouched, deliberately — the manual suite is its own driver (P15); no prompt surface names these mechanisms |
| `packages/auto`, `packages/auto-server` | untouched, deliberately — all six findings live in auto-core; no shell suite owed |
| `AGENTS.md`, `docs/structure.md`, `plans/INDEX.md` | **changed** — navigation/row updates only where a mechanism's key-file attribution changed (the runtime-read sanitizing line, the start-gate family, the install ordering) |

Open after this ruling: none deferred of this step's six; the standing
residuals named in the program's Current position carry forward.
