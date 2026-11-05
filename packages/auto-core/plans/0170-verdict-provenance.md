# 0170 — Verdict-document provenance, part 1: the verification's files removed at dispatch, the session's closes restored at the commit boundary, the blockage marks section-scoped

Status: **active**. Ruled 2026-11-05 by 0166 step 010 (wave W1-person-marks), enacting 0165-006
(S32-01 ∪15) part 1 — the members S11-01, S12-01 and S12-02. Part 2 (the receipts and test marker
by location, the formulation surfaces, the handover document's ownership — S11-04, S20-05, S08-*,
S10-*) is step 011's, under this ruling's witness frame.

## Derives

Derives: P3 — completion is never judged by agent self-report, and all three confirmed surfaces
consumed a file act by the agent as a driver verdict: the work session's own report.md `Result: PASS`
outranking the verify session's FAIL (S11-01), the session's own todo.md → done.md rename surviving a
FAIL verdict and closing the task (S12-01), the diagnosis session's verbatim `Choice:` line parsed as
the person's and executed under the person's ratification semantics (S12-02). P2 shows in D3 (the
`Choice:` line is the person's one obligation; a session's line in the Analysis is not them); P4
shows in D2 (the commit boundary — the driver's exclusive right — is the enforcement point); P7
throughout (every fix is grammar: a dispatch-side removal, a boundary-side rename restore, a
section-scoped mark reader — no content judgment anywhere). Tier: operating — P3's statement applied
to three existing surfaces; no Tier I statement changes.

premises this ruling changes: 0083 (its D3 lifecycle clause and the code-level read order — a
passing report outranking a stale gap list, wrapup.ts's own comment), 0120 (D1's reservation,
enacted copy-only). 0082 D6 is re-read and **stands as written** — its "one line … written into the
document's mark section" already scopes the mark; the whole-text scan was implementation drift from
the ruling, and D3 enforces the ruling. Each premise's re-reading:

- **0083 D3** — "a committed gap list from an interrupted round is overwritten by the next verify
  round" stands and is made total: the next round now *removes* gaps.md and report.md at its first
  dispatch (D1), so no verdict file of an earlier round survives into a later one. The comment-level
  read order ("a passing report wins over a stale gap list of an earlier round") is dead by
  construction — with both files removed at dispatch, every file the verdict reads is this session's
  own write; the order never decides anything again.
- **0120 D1** — the reservation ("the verification child's wrap-up report … never a task session's
  write") stands and gains its enforcement and the programmatic teaching sites 0120 consciously left
  un-touched (its D3 changed no programmatic template): the dispatch-side removal enforces it
  mechanically, and whole.md / fix.md / the doc-layout partial teach it (P15: the copy in templates).

## Category scope (0123 D1's discipline)

Family: *the driver's verdict surfaces — who may write the file a verdict reads* (the verification
loop's documents, the unit close state at the commit boundary, the blockage document's marks).
Home-set:

| home | disposition |
|---|---|
| `src/wrapup.ts` | changed — `verifySession` removes report.md and gaps.md before the round's first dispatch; the read-order comment rewritten (D1) |
| `src/git-ops.ts` | changed — `restoreUnitCloses` (D2): the free `afterSession` and the doc-lane decorator's `afterSession` restore session-made unit closes of the commit's own task before committing |
| `src/execute.ts` | changed — `runSubtask` restores the own subtask index's close between the session's end and the driver's rename (D2's subtask half) |
| `src/blockage.ts` | changed — `choiceMark`/`executedMark`/`rejectedMark` read the last `## Decision` region only (D3) |
| `src/blockage-diagnose.ts` | changed — `renderBlockageDocument` neutralizes the four mark line heads in the freeform verbatim sections (D3) |
| `src/blockage-execute.ts` | changed — `appendMarkLine` anchors inside the Decision region (D3) |
| `templates/prompts/whole.md`, `templates/prompts/fix.md`, `templates/prompts/_partials.md`, `templates/prompts/diagnose.md` | changed — the reservation taught (report.md/gaps.md are the verification's alone) and the mark-head prohibition named (P15) |
| `test/verify-loop.test.ts`, `test/git.test.ts`, `test/blockage*.test.ts` | changed — the three regressions, each failing for the confirmed defect |

Out of family here (each its own later step): the receipts and the test marker trusted by location
(S11-04, S20-05 — step 011), the formulation unit's session-writable surfaces (S08 — step 011), the
handover document's ownership lifecycle (S10 — step 011), the cross-task rename and the index-tick
shapes (D4's residuals), the manual suite's verdict channel (the manual waves).

## The ruling

**D1 — the verification's documents are the round's alone, by removal at dispatch.** Before the
first dispatch of every verification round (`verifySession`'s entry — never the shape re-prompt's
fork, which continues the same session), the driver removes `docs/T-NNN/report.md` and
`docs/T-NNN/gaps.md`. Both are the verifier's alone (0083 D2/D3, 0120 D1), and every round re-verifies
from scratch, so nothing of an earlier round — and nothing a work or fix session left at those names —
can outrank, feed or erase this session's verdict. The verdict now keys on this session's writes
exactly; the removal itself lands in the round's wrap-up commit (the PASS close-out or the FAIL's gap
commit — both branches commit at that boundary). The teaching joins the enforcement: whole.md's
constraint names the two reserved files, fix.md's verification-channel constraint extends to
report.md, and the doc-layout partial names the report's owner. The `--no-wrapup` floor is untouched:
runner's closeout read (`reportResult`) still reads a task-written report — the person disabled the
verification, so the task's own report is all there is (0083 D6's standing rule).

**D2 — the commit boundary restores the session's unit closes.** A todo.md → done.md rename is a
driver-exclusive write (AGENTS.md; 0047 U2), and the unified commit must not land one the driver
never made. `afterSession` (the free function and the doc-lane decorator alike, before their commit)
restores, with one detection line naming the file (P8): the commit's own task's task-level close
(`docs/<id>/done.md` new in the tree with `todo.md` absent → renamed back), and the task's subtask
closes (`docs/<id>/S<nn>/…`) except the stage's own `subtask N` index — the driver's own subtask
rename precedes its `afterSession` (execute.ts), so the exemption is exact. The own subtask index is
restored at its own point instead: `runSubtask`, between the session's end and the driver's rename,
where the entry check (done.md at dispatch = already closed, session skipped) guarantees that a
done.md appearing after a session is the session's. The task-level rule needs no exemption — the
driver's task rename (`markDone`) runs after the wrap-up session's `afterSession` and lands in the
terminal `done` commit, so a task-level close in the tree at any `afterSession` is never the driver's.
Restoration is renaming back, never deletion (P20: the content survives; only the transition
reverts). Units other than the commit's own task are untouched: an interrupted driver close of
another unit rides `beginUnit`'s carryover self-heal exactly as designed (0021's driver-state
leftovers), and restoring it there would destroy a legitimate driver write.

**D3 — the blockage marks are the Decision section's alone.** `choiceMark`, `executedMark` and
`rejectedMark` read only the last `## Decision` region — from its heading to `## Execution protocol`
(or the document's end). The renderer guarantees the region is the driver's own (the verbatim
session sections — Analysis, Escalation — are rendered *above* it, so the last `## Decision` heading
is always the document's own), and it now neutralizes the four mark line heads (`Choice:`, `Notes:`,
`Executed:`, `Rejected:` at line start) in those freeform verbatim sections — indented one space, a
display-only change — so the document a person reads carries no line that mimics a decision anywhere
outside the Decision section. An option's edit text is never touched: the executor re-parses it
literally as the replacement to apply (the ratification semantics — the marked text becomes the
person's words), and indenting it would corrupt the edit. `appendMarkLine` (the driver's
`Executed:`/`Rejected:` record) anchors inside the same region, so a session line below Decision can
never receive the execution record. A document without a `## Decision` section reads as un-marked
(the conservative direction, P12 — it re-blocks for the person rather than executing a guess). The
diagnosis prompt names the prohibition (never write the four heads yourself, not even as an example
— the 0169 template discipline).

**D4 — floors and residuals.** Every mechanism floors byte-identical: the dispatch-side removals
no-op on absent files (and the whole round's files are absent in every green-field round); the
restores no-op on a clean tree; the region parsers return identical results on every document the
driver itself wrote or the person answered (the driver writes its marks inside the region by
construction, and a hand-added `Choice:` under the Decision heading is the taught shape). The
confirmable residuals, named: (a) the kill-window — a session's rename committed not by its own
`afterSession` but by the *next* unit's carryover self-heal after a kill between session end and the
boundary (the 0021 carryover classification trusts driver-state paths; the runtime-record
distinction a full fix needs — done.md new while the runtime entry still says in_progress — is
0165-112's family, step 023); (b) the cross-task rename and the index-tick shapes (a session writing
another unit's state file, or ticking the index — the tick is a redundant view and the files win,
0047 U3, so a premature tick alone never completes anything; the cross-task rename is the
commit-provenance guard's family, 0169 D4's named follow-up class); (c) the forged-mark residuals of
0169 D4 unchanged. The union's part-2 members (S11-04, S20-05, S08-04/06/08, S10-01/02/07) carry the
witness frame this ruling sets — location is never provenance — into step 011.

## Tests

`test/verify-loop.test.ts` — a committed work-written report.md `Result: PASS` followed by a verify
session writing only a gaps.md FAIL: the FAIL is seen and the fix round opens (before: the report
won, the task closed done, the gaps deleted). `test/git.test.ts` — `afterSession` over a session-made
task-level rename restores todo.md and commits no done.md; the `subtask N` stage's own rename is
exempt; another subtask index's rename is restored. `test/blockage.test.ts` / the executor suite —
the probe's shape (a session `Choice: A …` line in the Analysis never parses; the person's under
Decision does) plus the `Executed:`/`Rejected:` mirrors in the Analysis never dropping a real
pending Choice; `appendMarkLine` lands the record under the Decision region's Choice.
