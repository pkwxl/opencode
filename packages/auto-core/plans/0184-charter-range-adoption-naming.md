# 0184 — The charter's range is the task's true start, and the adoption names what it adopts

Status: **active**. Ruled 2026-11-06 by 0166 step 024 (wave W5-control), enacting 0165-023
(S12-04, S2, CONFIRMED — every resume or re-run re-anchors the unit baseline at the current
HEAD, so the verification charter's commit range omits all work committed before: a re-run
after a FAIL block or a kill during the wrap-up hands the verifier an empty HEAD..HEAD range)
and 0165-024 (S12-05, S2, CONFIRMED — the resume re-anchor puts every trailer-less commit made
before the interruption outside the close-out audit: an agent's own `git commit` is adopted as
the person's, silently, and P4's audit never sees it).

## Derives

Derives: P3 — completion is judged by planned, independent verification over the task's actual
output: a verifier handed an empty range over existing work either FAILs a task whose work
exists or inspects outside the stated range on its own judgment — the charter's sentence ("every
change this task's sessions made") must be true after the two commonest recovery acts (D1's
spine). P4 — the commit right and its audit: a trailer-less commit made while the driver ran is
laundry unless the adoption names it; the person, not the log's phrasing, judges it (D2). P6 —
the true start is derived from durable evidence (the Auto-Task trailer's own history,
taskFirstCommit's corpus-bounded scan), never newly persisted state; P8 — every surfaced line
teaches its remedy (each adopted commit named sha/author/date; the flagged ones carry the
revert); P10 — every floor: a task with no unit commit keeps today's range, an empty baseline
keeps the no-range wording, the non-ladder callers keep the unflagged names. Tier: operating —
no Tier I statement changes.

premises this ruling changes: 0083 D1's charter wiring (the range's source changes from the
callers' re-anchored baseline to the derived true start — the sentence itself stands, now true
after recovery); 0145 D1's adoption line (the blanket "foreign commits" phrase becomes the named
list — the adoption VERDICT stands, its wording no longer attributes every commit to the
person); 0183 D3's BaselineProblems (the foreign line's format grows the named list; the shape
{foreign, unreadable} stands). Re-readings: 0140's corpus bound stands and is the charter's own
(a re-issued id is a new lineage — the restart's charter never spans the wiped corpus);
taskFirstCommit's scan is the one derivation home (fork and the charter read the same walk);
0173 D2's trailer-block criterion already enacted S12-05's driver-commit half (the finding's
substring evidence predated it — no change); the stream/subtask baselines (execute.ts's
persistStage refresh) keep their own refresh semantics — their ranges narrow by stage, the
finding's measured shape was the task-level re-anchor (named as the family residual);
S03-01's constitution wording (P4's derivation text vs 0145) stays step 065's row (0165-007),
which this ruling's case should name when it lands — recorded here as the cross-reference the
finding asked for.

## Category scope (0123 D1's discipline)

Family: *the verification charter's range and the recovery adoption's naming*. Home-set:
`src/git.ts` (charterBaseline; foreignCommitRecords and the foreignCommits count front;
baselineIntact's ranUntil and the named/flagged foreign lines; namedForeignCommits),
`src/resume-gate.ts` (the ladder passes record.at), `src/wrapup.ts` (runWrapup's commitRange
over the derived baseline), `test/git.test.ts`, `test/resume-gate.test.ts`,
`test/verify-loop.test.ts`. Vocabulary: no frozen literal changes — the foreign line's wording
is a teaching line (P8), and the named list is additive inside it; commitRangeText and the
wrapup template sentence are unchanged (the injected range alone changes).

## D1 — the charter's range derives the task's true start

runWrapup computes the charter's range over charterBaseline(task.id, input.baseline): per
repository, the commit before the task's first unit commit (taskFirstCommit's corpus-bounded
scan over the Auto-Task trailer — the same walk fork reads), so a resume's or re-run's
re-anchored HEAD no longer hands the verifier an empty HEAD..HEAD range over the work the
task's own sessions committed before the interruption. A repository where the task has no unit
commit keeps the given sha (nothing committed there — today's range); the task's first commit
at a repository root renders the whole-history shape; an empty input baseline passes through
(the no-range wording, non-git and the no-commit double). The re-anchored HEAD the callers hand
in keeps its own role untouched: the close-out audit's foreign-commit question (unitViolations,
loop-task's two sites) still reads it — the audit asks what landed during THIS unit's close
range, the charter asks what this task's sessions ever made; two questions, two baselines.

## D2 — the adoption names each commit; the while-driver-ran ones carry the P4 flag

foreignCommitRecords is the one walk under the driver-witness criterion (the count front
foreignCommits keeps its callers), and baselineIntact's foreign line names each adopted commit
— short sha, author, committer date, bounded at five with the count naming the rest. ranUntil
(the ladder passes the record's last write, epoch ms) flags each commit whose committer time
precedes it: made while the driver ran — not the person's post-kill act — the line carries the
P4 judgment and its remedy ("judge whether to keep it, git revert <sha> reclaims it").
Adoption still proceeds (the committed state is the scene either way — 0145 D1's verdict
stands; a sticky stop would wedge the run on a fact the record cannot change), and the person
reads exactly which commits the driver never made. The honest window: a person's mid-run
commit landing between its act and the record's next write flags too — the flag names the
judgment, never an accusation; the boundary is the record's own write cadence (every dispatch
and boundary).

## Residuals

- The stream/subtask stage baselines (execute.ts's persistStage refresh) keep their own
  semantics — a stream's charter range narrows by stage; the finding's measured shape was the
  task-level re-anchor, and the stream-level derivation has no measured demand (P21).
- The while-ran flag is the record-cadence boundary, not proof of authorship — the flag names
  the judgment; deliberate imitation (a session forging the trailer block) stays the
  commit-provenance guard's family (0169 D4).
- S03-01's P4 derivation wording is step 065's row; this ruling's case is recorded for it to
  name.
- The named list is bounded at five per repository — a wide adoption (a merge flood) shows the
  count and the newest five; the full list is the repository's own log.

## Tests

- git.test.ts: charterBaseline — the blocked-then-rerun pin (the range contains the execute
  commit; fail-before: the re-anchored sha alone), the no-unit-commit and empty floors, the
  root-first whole-history shape; baselineIntact — the named line and the ranUntil flag with
  the revert remedy (fail-before: the bare count line).
- resume-gate.test.ts: the adoption why names the sha (fail-before: the count phrase alone);
  the while-ran flag over a commit preceding the record's write, adoption proceeding.
- verify-loop.test.ts: the wiring — runWrapup over a re-anchored baseline renders the verify
  prompt's range from the true start (fail-before: `<reanchored>..HEAD`, the empty range).
