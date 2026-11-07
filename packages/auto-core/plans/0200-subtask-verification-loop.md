# 0200 — The subtask companions' Stage 3 is the task-level verification loop; the phase selector, the resume gate and the report re-entry made true

Status: **active**. Ruled 2026-11-07 by 0166 step 040 (wave W-manual-subtasks), enacting 0165-005
(S25-01, S1 — both subtask companions' Stage 3 closes the task from a narrative wrap-up: one line
per subtask plus a `Result:` line the wrap-up session wrote from the task document and the
checklist's own claims, so artifact-existence checks plus worker-observed checks become
`Result: PASS` and done with no fresh inspection of the work, and a FAIL stops for the person
instead of entering the fix loop — while the driver's common pipeline tail (runner.ts →
runCloseout → runWrapup) runs the verification session and the bounded fix rounds for **every**
mode, subtask mode included), 0165-048 (S25-02 — resume-subtasks' decomposition gate item 3
requires every checklist item's `S<nn>/todo.md`, but Stage 2's completion act is the todo.md →
done.md rename, so `S01/done.md` + `S02/todo.md` — exactly the normal interrupted state the file
exists to recover — fails the gate, and run-as-subtasks' own boundary refuses an already-begun
task: the documented recovery path cannot recover the common case), 0165-053 (S25-07 — both
companions select the first phase whose `phases.md` line is "not marked ` (closed: …)`", a suffix
the normal phase close-out never writes (it ticks `- [x]` and renames to done.md); after the first
normally completed phase the companions operate on the wrong phase or report nothing ready) and
0165-164 (S25-09 — resume-subtasks' existing-report path follows the verdict rules directly, and
the FAIL branch commits the report unconditionally: resuming the committed-FAIL state a prior
Stage 3 stop left runs a no-change git commit instead of the clean blocked stop — crash recovery
not idempotent at this boundary).

## Derivation and Category scope

Derives: **P3** — completion is never judged by agent self-report; D1 shows in the fresh
verification child session over the task's committed range replacing the narrative wrap-up (the
subtask sessions' checklist-claims channel closed), and in the bounded fix loop that follows a
FAIL. Derives: **P2** (operating half) — every automatic escalation bounded and terminating at the
person; D1 shows in the fix loop's progress bound carried to the manual twin (0146 D3 as re-ruled
by 0198 D1: at most 2N+2 rounds, two consecutive no-progress rounds stop for the person) and in
the FAIL verdict's stop staying the person's bracket. Derives: **P6** — derived state,
idempotence, re-derivation; D2/D3/D4 show in the gates and selectors reading the directory's own
state files exactly as the rest of the suite does, and in every re-entry making only the writes
that are still pending. Tier: **I** for D1 (P3's completion rule extended to the manual subtask
channel — the last driver channel that still closed on self-report), operating for D2–D4.

### Category scope

The manual-driver prompt suite family (0078–0094, 0098–0118, 0120, 0146–0148, 0161, 0163, 0164's
manual halves): code homes `prompts/run-as-subtasks.md` + `prompts/resume-subtasks.md` (lockstep
Stage 3 per resume's sibling comment), test home `test/manual-prompts-ratchet.test.ts` (new arms:
the verification-loop protocol sentences, the unticked selector, the one-of-state gate, the
idempotent report re-entry — each with the retired rule sentence pinned absent), documentation
homes this row + AGENTS.md's manual-suite navigation line + docs/structure.md's Manual-driver
suite row. No `src/` change: the driver's own loop (wrapup.ts) is the authority being mirrored,
already ruled by 0083/0146/0148/0170/0198; `src/install-prompts.ts` needs no change (no file
added or removed).

premises this ruling changes: **0044 D9** (its manual mirror's re-entry commit — "the FAIL branch
commits the report" restated to commit only an uncommitted report; the driver-side
`reportResult` read stands unchanged) and **0083's manual-twin premise** (the subtask companions
were left at the pre-0083 close-out on the reading that 0086/0087's exclusions covered the whole
tail — this ruling states what S25's residual note measured: the exclusions name the
handover-free loop and the per-subtask commit choreography only, and no ruling excludes the final
task-level verification loop; 0086/0087 themselves stand). 0146 D1–D3 and 0198 D1's loop
constants, 0148 D1's fix-subject grammar, 0120's report.md reservation and 0170 D1's
reserved-file lifecycle are **carried** to the manual twin as ruled, not changed.

## D1 — Stage 3 becomes the task-level verification loop (0165-005)

**The defect.** The companions' Stage 3 asked a wrap-up child for a narrative report ("one line
per subtask… without copying or rewriting the subtask artifacts"), told it to write PASS "only
when every check the task requires was actually run or observed" — evidence the subtask sessions'
own claims could satisfy — and closed the task on that line. The driver at the same state runs
`runWrapup`: a fresh verification session over the unit's committed range, a countable gap list on
FAIL, fix rounds under the progress rule, close-out on PASS. P3's letter ("a unit is done only
when its artifacts are on disk and committed; verification is planned, independent, fresh-session
work") was false of this channel — the S1 severity's ground.

**The ruling.** Both companions' Stage 3 is re-titled **verification and close-out** and runs the
same whole-unit protocol `run`'s master control runs at its loop's steps 5–6, over this pipeline's
commit grammar:

- The **task baseline**: the parent of the task's first commit carrying the `Auto-Task: T-NNN`
  trailer — the manual twin of the driver's `charterBaseline` (0184 D1) and the same derivation
  run.md's park/resume rules teach.
- The **verification child** (a fresh session, in-file prompt like the other stages): judges the
  task's `## Scope`/`## Acceptance` by inspection of the committed range's diff and the
  deliverables — never the sessions' claims, never re-running the acceptance's executable checks
  (the last subtask session already ran the task's full acceptance verification — the pipeline's
  own division of labor); checks the range's commit grammar (`T-NNN decompose` / `T-NNN S<nn>` /
  `T-NNN fix <round>.<session>` shares, each with the `Auto-Task: T-NNN` trailer — anything else in
  the range a hard failure), the state files' integrity, the terminator discipline and the P1
  process-path rule. Its verdict channel is run-verify.md's frozen strings — the reply ends
  `Verification: PASS` or `Verification: INCOMPLETE` (P13 additive reuse; no new vocabulary). On
  PASS it writes the wrap-up report `docs/T-NNN/report.md` (the config `wrapup` key's WRITE/SKIP
  line — the key now decides only the report, as run.md's preflight already words it; the
  verification itself always runs, the manual suite's own standing shape, there since run-verify's
  <WRITE|SKIP>); the report is one short section per acceptance criterion with the inspection's
  evidence — the per-subtask narrative channel is retired (0120's reservation enacted here:
  report.md is the verification's alone). On any check failing it writes no report and writes
  `docs/T-NNN/gaps.md` in the driver's countable grammar — a compact verified-OK summary, then one
  `### Gap N — <one-line title>` heading per gap under `## Gaps`, closing `Result: FAIL
  <one-sentence reason>` as the last body line, no terminator (0146 D1's grammar, carried
  verbatim; the companion's old `Result: FAIL` report-shape is gone with the narrative close).
- The **driver-role session** (the one reading the file) owns every commit and state write, the
  companions' own constitutional division (children never commit): before each round's dispatch it
  deletes both reserved files (0170 D1's round-scoped verdict carried: the verdict keys on this
  round's session writes alone); it shape-checks the verdict's writes (report non-trivial +
  terminator + `Result: PASS`; gaps non-empty + ≥ 1 `### Gap N` heading + the closing FAIL line) —
  one feedback relaunch, then stop and report; on PASS it performs the close-out (delete a stale
  gaps.md from disk alone; WRITE only: the wrapup commit; the completion writes — rename, index
  tick, the units.json record removal — and the done commit, exactly the close-out's existing
  shape); on INCOMPLETE it enters the **fix loop**.
- The **fix loop**: count the FAIL list's `### Gap N` headings; the loop's best is the minimum its
  FAILs have measured, the first FAIL only seeds, a round made progress only when the next count
  is strictly lower than the best (0198 D1's meaning, stated directly — the manual text never
  inherits the pre-0198 "shrank the count" ambiguity); two consecutive no-progress rounds stop
  for the person — the work stays landed as the fix shares, the last gap list stays on disk, the
  person accepts with `close` or plans the rework. One fix child session per round (an in-file
  run-fix mirror without the handover/budget machinery — 0086/0087's exclusion, unchanged),
  closing exactly the listed gaps; its work lands as its own share `T-NNN fix <round>.<session>
  <task title>` (Auto-Stage `execute` — 0148 D1's grammar; `<session>` one past the highest
  `T-NNN fix <round>.<n>` already in the log for that round, the driver's `nextFixSession`
  derivation, not a landed-count; the `<task title>` form keeps the companions' current subject
  style and joins 0165-163's short-title family for its step), with the gap list unstaged back out
  — the manual suite's gaps lifecycle (run.md's: the gap list stays on disk, never in a commit;
  the driver's FAIL-side gap commit is not carried, keeping the manual twin one-lifecycle). Then
  a fresh verification round over the whole task from scratch.

**Floors.** No `src/` behavior changes; the suite's file set is unchanged; every existing ratchet
pin over the two files either keeps holding on the untouched sections or is updated in the same
change (the `Result: PASS`/`Result: FAIL <one-sentence reason>` pins keep holding — both strings
live on in the report and the gap list's closing line). The verification protocol's strings are
reuses of frozen vocabulary, not new coinage.

## D2 — the decomposition gate reads the unit state, not one file name (0165-048)

The gate's item 3 becomes: for every checklist item n (S01 = item 1), **exactly one of**
`docs/T-NNN/S<nn>/todo.md` / `done.md` exists — Stage 2's completion act is the rename, so earlier
items legitimately hold `done.md` alone — and whichever exists ends with the terminator and
carries both `## Scope` and `## Artifacts` headings; an item whose `done.md` exists must be ticked
`- [x]` in `subtasks.md`, one whose `todo.md` exists unticked (on a clean tree the rename and the
tick always landed in one commit; a disagreement is a hand-edited or corrupted state — stop and
report). The no-rewrite rule's list gains `S<nn>/done.md`. This is the Stage-2 state protocol's
own legality rule applied at the gate — the gate no longer rejects exactly the state its own loop
produces.

## D3 — the phase selector is the unticked line (0165-053)

Both companions' selector becomes run.md's, verbatim: the first phase whose `phases.md` line is
**unticked** (`- [ ]`; the phase close-out ticks it `- [x]` on completion) and whose directory
holds a `tasks.md`. The `(closed: …)` suffix exclusion is retired from the selector — that suffix
is a digest rendering of a person-closed phase (phases.ts D16), not a state the phase close-out
writes; the tick is the completion record the driver's `done`-set derives from, and run.md's
selector is the manual suite's standing mirror of it. A completed earlier phase can no longer win
the pick over the current phase.

## D4 — the re-entry is keyed on the verification state and idempotent (0165-164)

resume-subtasks' re-entry point, re-keyed from "decided by the report" to "decided by the
verification state" (the loop's own states): a present `gaps.md` shape-checked first (a trivial or
grammar-less list was mid-write — delete it and run the verification); a well-formed list re-enters
the fix loop — dirty-beyond-the-list work is the interrupted fix session's unlanded share
(relaunch the fix child with the dirty-continue line, land it; the round number re-derives as one
past the highest landed `T-NNN fix <r>.<n>` — an interrupted round's share never landed, so its
number re-derives naturally), a clean tree re-verifies at once; the resumed loop's progress state
is derived conservative — best = the present list's heading count, no-progress streak one (the
interruption erased the streak's history; the bounded reading is the conservative one: the next
completed round must strictly lower the best or the loop stops for the person). The
existing-report branch reads its last `Result:` line and **completes the close-out idempotently**:
commit the report only when it is still uncommitted, make the completion writes only when the
task is not already closed, stop clean when everything landed; a complete report whose last line
is `Result: FAIL …` (this suite's earlier vintage or a hand-edited state) is a stopped-for-person
verdict — commit only when uncommitted, then stop for the person; do not tick done, do not
re-verify the verdict away (the person's pending decision is preserved, P20). 0044 D9's manual
mirror restated; the driver-side closeout read stands.

## Dispositions

- **0165-005** — fixed (D1): both companions' Stage 3 is the verification loop.
- **0165-048** — fixed (D2): the gate reads exactly-one-of + tick agreement.
- **0165-053** — fixed (D3): the unticked selector, `(closed: …)` retired from it.
- **0165-164** — fixed (D4): the re-entry keyed on the verification state; report re-entry
  idempotent; the committed-FAIL shape stops for the person with no git write.

## Residuals

- The companions' fix child has no handover/budget machinery (0086/0087's standing exclusion); a
  fix session that cannot finish inside one session ends its session unlanded and the next
  resume-subtasks invocation continues it — the round is recoverable, never lost.
- The fix-share subject sites created here (`T-NNN fix <round>.<session> <task title>`, both
  files) carry the companions' current `<task title>` style and join 0165-163's short-title
  family — step 042's sweep includes them.
- run.md's own progress-rule sentence (its loop step 6: "a round that shrank the count buys the
  loop another round") still reads the pre-0198 phrasing whose natural reading is
  versus-previous-count — a manual-copy drift in 0165-049/050's family (step 041's files),
  recorded for that step; the companions' new text carries 0198 D1's best-count semantics
  directly.
- The ratchet arms added here pin the ruled rule-sentences and the retired-rule absences
  (text-level oracles — the suite's only possible oracle over prompt copy); deeper
  scenario-execution machinery is 0165-165's question (step 043).
