# 0171 — Verdict-surface provenance, part 2: the test channel confined to the root, receipts witnessed by their janitor commit, the formulation unit's landed text pinned, the handover document retired with its scope

Status: **active**. Ruled 2026-11-06 by 0166 step 011 (wave W1-person-marks), enacting 0165-006
(S32-01 ∪15) part 2 — the members S11-04, S20-05, S08-04/06/08 and S10-01/02/07 — under
[0170](./0170-verdict-provenance.md)'s witness frame: location is never provenance.

## Derives

Derives: P3 — completion and verdict surfaces are judged on driver-witnessed evidence, and every
confirmed member consumed a file act by a session (or a stale scope) as the driver's own: the test
marker steering the driver to chmod 0755 and execute a path outside the project root (S11-04), a
session-written green receipt discharging the regression hold and the lane carry (S20-05), a
formulation collect judging the ledger and Acceptance from the session-edited todo.md (S08-04), a
dropped formulation row making the planning unit invisible while its unjudged plan executed
(S08-06), a session-copied `Formulate:` field reclassifying a planned task as machinery (S08-08),
a handover document trusted past its scope's end (S10-01), a `Status: done` document ticking a
subtask off with no shape check (S10-02), and a due handover verdict reading the predecessor's
consumed document (S10-07). P2 shows in D3/D4/D5 (the person's marks and the recovery facts are
never a session's line); P4 shows in D2 (the janitor commit — the driver's exclusive right — is
the provenance witness) and D6/D7 (the commit boundary restores, the row restore commits); P7
throughout (every mechanism is grammar: path containment, commit stages, digests, section
readers, presence gates — no content judgment anywhere). Tier: operating — P3's statement applied
to six existing surfaces; no Tier I statement changes.

premises this ruling changes: 0098 (D4's receipt-commit deferral — a receipt riding a session's
unified commit was the designed degrade; it is now never allowed, the sweep always pathspec-
commits), 0130 (D2's fix-round seeding comment — "the execution stage's completion document
(Status: done — the consumed seed)" half is dead by construction: the stage's document never
reaches the tail), 0141 (D2's blocked-collect remedy — "restoring the row by hand" becomes the
driver's own restore; the blocked voice keeps teaching the re-run), 0095 (D1's marker note — "a
hand-written look-alike on a task of another phase matches nothing" stays true, and a look-alike
on a task of THIS phase is now a collect problem), 0148 (D1's round-entry seeding — see 0130
above). Each premise's re-reading:

- **0098 D4** — the background run's receipt "rides that session's unified commit" is amended:
  the write path janitor-commits (stage `regression`), and the boundary sweep pathspec-commits
  even beside foreign dirt (the pathspec cannot absorb it — the deferral's reason dissolves).
  D5's hold and D7's strict wait are unchanged in shape; their coverage reads now demand the
  witness. The wall's admission scan (0132 D3) keeps its heads-equal-current-HEAD immunity and
  gains the witness for free through the shared scan.
- **0130 D2** — the fix round's seeding loses its "execution stage's completion document" half
  (D5 retires the document before the tail begins); the "interrupted fix session's Status:
  continue" half stands and is the only shape a round's entry can now see. D1's steer-off floor
  is untouched (S10-02's read gate aligns runSubtask with it).
- **0141 D2** — "the remedy is restoring the row by hand, and a re-run dispatches a fresh
  session" is made true by machinery: the driver restores the row itself (D7), the blocked voice
  is unchanged, and loadPlan refuses an orphaned formulation unit instead of routing around it.
- **0095 D1** — the marker stays driver-written; the collect now enforces it on the session's
  planned tasks (D6), closing the "look-alike on a task of this phase" gap the note's contrast
  implied away.
- **0148 D1** — the round's per-session commit cadence is unchanged; only the round's natural
  end gains the document retirement (D5), which is the lifecycle the cadence always implied.

## Category scope (0123 D1's discipline)

Family: *the driver's verdict surfaces — who may write the file a verdict reads* (0170's family,
part 2: the test channel's request marker, the lane receipts, the formulation unit's todo.md and
index row, the handover document's scope lifecycle). Home-set:

| home | disposition |
|---|---|
| `src/testrun.ts` | changed — `resolveTestScript` confines the path form to the project root (realpath; chmod only inside) and refuses an escaping single-line path (D1); `runTestScript` renders the refusal; `TestRun.pending` carries `refused` |
| `src/engine/concerns/test.ts` / `src/engine/fx.ts` | unchanged — the in-session consumer shares `resolveTestScript` through the fx kernel; the refusal renders in its result channel |
| `src/script.ts` | changed — `newestGreenReceipt` demands the provenance witness (`receiptDriverCommitted`: uncommitted-change check + the introducing commit's `Auto-Stage: regression`/`testhands`); `commitLaneReceipts` (the janitor commit) written into `runTestLanes` (D2) |
| `src/regression.ts` | changed — `runRegressionLane` janitor-commits its receipt; `commitPendingReceipts` always pathspec-commits (the 0098 D4 deferral retired); the strict wait and the hold pass their git handle (D2) |
| `src/wrapup.ts` | changed — the lane gate passes the git handle; the fix round's natural end retires the handover document (D5) |
| `src/tasks.ts` | changed — the landed-todo digest (D6); loadPlan's orphan formulation guard (D7); `newTaskProblems` rejects `Formulate:`/`Closed:` on a session-planned task (D6) |
| `src/formulate.ts` | changed — `constructFormulation` records the digest; `restoreFormulationRow` (D7) |
| `src/runner.ts` | changed — the blocked collect restores and commits the row (D7); the formulation collect pins the todo by digest (D6); the wrap-up tail's entry retires the task-level handoff document (D5); `handedOff` denies the closeout phase (D5) |
| `src/execute.ts` | changed — `handoverVerdict` requires freshness for every due verdict and re-arms the retry on each accepted handover (D3); `runSubtask`'s recovery read gated on steer and resumeUnit, the done document verified by the shape check before the close-out (D4) |
| `src/git-ops.ts` | changed — `restoreUnitCloses` gains the own task's todo.md content restore (D6) |
| `templates/prompts/_partials.md` | changed — the test protocol names the path form's confinement (P15) |
| `test/` (below) | changed — one regression per member, each failing for the confirmed defect |

Out of family here (each its own later step): the kill-window rename and cross-task shapes
(0170 D4's residuals — step 023's family), the subtask-file content edits and the carryover
sweep (S12-07, step 023), the `0165-035` nested-diff receipt coverage (step 014), the lane
landing's commit rewriting of receipts (D2's residual below), the `--no-wrapup` report-read floor
(0083 D6, standing).

## The ruling

**D1 — the test channel's path form is confined to the project root, and a refusal is an
answer.** `resolveTestScript` accepts the path form only when the candidate's realpath stays
inside the project root (both sides realpath-resolved: an absolute path, a `../` spelling, and a
symlink under the root pointing out are all escapes; chmod follows symlinks, so the judgment is
on the resolved path) and best-effort-chmods only inside it. A single-line request naming an
existing file outside the root is refused — the marker consumed, the request snapshotted for
audit, the refusal rendered as the run's whole output (exit code 125) instead of executing
anything: falling back to the inline form would have bash execute the named path as a command
line, so the outside script would still run. The refusal reaches both consumers (the driver-side
`executeTest` and the engine's in-session protocol) through `runTestScript`, and a test handover
that froze a refused request renders the same refusal after the close-out. The protocol partial
names the confinement. Residual: a kill between a refused freeze and the post-handover run loses
the refused flag to the handover record (which carries script and seq only) — the recovered run
executes the snapshot, which contains the bare path text as a command line: harmless
(command-not-found), and the confinement itself never depended on the flag.

**D2 — a green receipt is carry basis only when its introducing commit is a receipt janitor
commit.** The receipts' writers are the lane runners, and every write path now commits through a
janitor commit — stage `testhands` (the lane gate's task-scoped receipts, committed inside
`runTestLanes` right after the guard check) or `regression` (the round-scoped receipts, committed
by `runRegressionLane` itself; the boundary sweep `commitPendingReceipts` pathspec-commits any
receipt a killed process left dirty, no longer deferring beside foreign dirt — a pathspec commit
cannot absorb it). The shared reader `newestGreenReceipt` — the one home of the carry rule
(laneCarry), the coverage predicate (regressionCovered) and the strict wait (dependencyComplete)
— demands the witness: the tree holds no uncommitted change to the file, and the last commit
that introduced its current bytes carries `Auto-Stage: regression` or `Auto-Stage: testhands`.
A rejected receipt is named (P12) and is simply not carry basis: the lane re-runs and a fresh
janitor receipt replaces it — the fail-safe direction that self-heals, never a block (a
pre-0171 receipt degrades to one re-run, not a held phase). Unreadable git reads as rejected.
Residuals: a lane landing that rewrites the receipt-introducing commit (merge-repair shapes)
re-bases the witness away — the landed lane re-runs once and re-witnesses; the wall's admission
scan keeps its own heads-equal-HEAD immunity beside the witness.

**D3 — a due handover verdict is judged only by a fresh document, and the retry is per
handover.** `handoverVerdict` reads the document's status only when it is fresh (not the engine's
consumed seed); the quiet natural (not due, nothing fresh) is the only verdict a stale document
can still produce. A due session over the consumed document — the predecessor's `Status:
continue` accepted as this session's handover, or its `done` accepted as this session's
completion — falls to the invalid-document path: the strict-resume rollback, then the single
retry with feedback, then the hidden blockage, exactly the ladder built for a missing document.
Each accepted `Status: continue` re-arms the retry flag (the feedback promises one retry per
handover; the flag was previously spent for the scope's whole life, so a long chain's first
invalid document blocked as "failed twice" on its first failure).

**D4 — a subtask's recovery document is a recovery fact, and a completion claim is checked, never
obeyed.** `runSubtask`'s prior read is gated on this scope's own steer (OPENCODE_AUTO_STEER off
= the protocol does not exist, the 0130 D1 floor the whole-task stage already gated on) and an
active recalled record naming this subtask (resumeUnit): a document present at a fresh dispatch
is another scope's leftover (the lead's stage's task-level file riding the interruption commit),
never this dispatch's signal — the session runs. Under a genuine recovery, `Status: continue`
seeds the continuation as designed, and `Status: done` no longer ticks the item off directly:
the recovery close-out runs the artifact shape check first (the same check a natural end faces —
the writing session is gone, so a failure blocks for the person with both facts named rather
than re-prompting). The engine's consumed seed still reads the text unconditionally, so a stale
document is never "fresh" for the handover check either.

**D5 — the handover document is retired with its scope.** The task-level handoff.md belongs to
the execution stage's scope; the wrap-up tail's entry (`runCloseout`, every mode — the fresh
closeout and the whole-phase resume, not a wrapup resume whose document is the interrupted fix
session's seed) removes it, the deletion riding the wrap-up's own commit (or the terminal close
under --no-wrapup). A fix round's natural end removes it before the round's close-out commit.
With both retires, no later scope inherits a dead stage's handover: the first fix round is no
longer seeded as "the previous fix session ended with a handover", and an interruption of the
verify/fix tail no longer takes the fresh rung on a false cause line. `handedOff` (the resume
ladder's rung gate) denies the closeout phase — the one phase whose document can only be such a
leftover; whole (the execution stage), subtasks (a stream's own file), wrapup (a fix session's
handover) and decompose keep their documents, which are genuinely theirs. Residual: the kill
window between a stage's natural end and its retire leaves the document with the record at the
stage's own phase — the rung then continues the interrupted stage from its own document, which
is the correct recovery, not a false cause.

**D6 — the formulation unit's landed text is pinned, its markers are the driver's, and the
running unit's contract is restored at the commit boundary.** Three grammars, one rule (the
todo.md is driver-owned state, 0101 D3): (a) `constructFormulation` records the landed todo's
sha256 beside the floor digest (`todoDigest`, re-recorded on the idempotent re-entry), and the
formulation collect refuses a session that edited its own single input — the ledger rows and the
Acceptance are judged as landed (absent digest = pre-0171 construction = no check, the floor);
(b) `afterSession` restores the commit's own task's todo.md content from HEAD (modified or
deleted — the rename shapes remain 0170 D2's; subtask files are S12-07's family; the formulation
session's planned tasks' documents are other tasks' files, untouched), so a weakened Acceptance
or a dropped ledger never lands in any unified commit — (a) covers the windows the boundary
cannot (an interruption commit, a lane); (c) `newTaskProblems` rejects a `Formulate:` or
`Closed:` field on a session-planned task with the removal remedy — the markers are the
driver's, and the append collect inherits the check through the same function.

**D7 — a formulation unit absent from its index is restored by the driver or refused by the
loader.** The blocked collect's reload-failure return first re-inserts the dropped row at the
index head and commits it as the driver's own write (stage `phase-formulate`, the construction
family) — the blocked voice is unchanged, and the re-run re-dispatches the formulation over the
surviving files as 0141 D2 promised, instead of silently executing the unjudged plan through a
"clean phase end". `loadPlan` refuses the shape at read time: a pending `docs/T-*/todo.md`
carrying `Formulate: <this phase>` whose row the index does not list is a loader problem naming
the restore — the kill window between the exec commit and the collect (where no blocked return
runs) and any hand-dropped row both land here, fail-loud, before any route can execute around an
invisible unit. Closed phases never trip it (a done unit reads done.md); other phases' units
never match the qualified id. Runner's unguarded resume reload (the 0141 note's :412 shape) is
unreachable for the drop family by this guard.

**D8 — floors and residuals.** Every mechanism floors byte-identical: the path-form confinement
changes nothing for inside-root paths and inline content; the witness rejects only receipts that
were never legitimate carry basis or degrade to one re-run; the digest check is inert without a
recorded digest; the restores no-op on a clean tree; the retires no-op on an absent document;
the gates return the same values wherever their new conditions were already implied. Named
residuals: D1's lost-refusal recovery window; D2's lane-landing rewrite; D5's kill window
(analyzed correct-by-recovery above); the subtask-file content edits and the cross-task shapes
(0170 D4's residuals, steps 023+); the forged-mark residuals of 0169 D4 unchanged. The ∪15
union is now fully dispositioned: parts 1 (step 010) and 2 (this ruling) together with 0169/0170
carry every member — S11-01/S12-01/S12-02 (0170), S24-01/02 (0170's template teaching),
S11-06/S12-12 (S11-01's dispatch-side removal and the marks' region scope — the receipt `Lane:`
field and the remaining location-trust the witness now covers), and the six members here.

## Tests

`test/testrun.test.ts` (or the suite owning `resolveTestScript`) — a marker naming an existing
file outside the root: refused, marker consumed, `runTestScript` renders exit 125 and the
reason, the outside file's mode unchanged; an inside-root path form still chmods and runs; a
symlink under the root pointing out is an escape. `test/lane-table.test.ts` / the regression
suite — a session-shaped receipt (riding a task-stage commit, or dirty) is not carry basis with
the named line; a janitor-committed receipt carries. `test/formulate-synthesis.test.ts` — a
session deleting its todo's ledger blocks with the restore remedy (digest check); the row-drop
blocked return restores and commits the row (the re-run re-dispatches); a planned task carrying
`Formulate:` is a collect problem. `test/execute-handover.test.ts` — a due session over the
consumed document takes the invalid path (retry, not a phantom handover); the retry re-arms
after an accepted continue. `test/git.test.ts` / `test/verify-loop.test.ts` — a session's
own-task todo.md content edit is restored at afterSession; the wrap-up tail's entry retires the
task-level handoff document; a subtask's `Status: done` recovery runs the shape check (a
missing declared artifact blocks, a complete one closes out).
