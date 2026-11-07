# 0201 — The manual fix subject's ordinal derives from the log, and the gap list the master counts is the driver's countable grammar

Status: **active**. Ruled 2026-11-07 by 0166 step 041 (wave W-manual-fix), enacting 0165-049
(S25-03, S2, CONFIRMED — both manual fix-subject sites say "`<session>` the round's landed fix
shares count": a fresh round's first session numbers 0 (zero-based, the driver's is 1), the share
after an existing `fix 1.1` numbers 1 again (a duplicate subject), and sparse ordinals — the
legitimate git shape when a context-wall handover commits nothing, the driver's own comment "the
ordinal still advances, so git may skip indices" — are renumbered; the driver's `nextFixSession`
(src/git.ts) instead scans **every repository root** for the highest `<id> fix <round>.<n>`
subject and returns max+1, 1 when none exists) and 0165-050 (S25-04, S2, CONFIRMED — run-verify's
INCOMPLETE branch authorizes a freeform gap list ("one entry per gap", no `## Gaps` heading, no
`### Gap N` form, a false "its last line of body text is simply its last entry" sentence) while
the driver's own FAIL side (templates/prompts/wrapup.md, 0146 D1) teaches the countable grammar —
one `### Gap N — <one-line title>` heading under `## Gaps`, closing `Result: FAIL <one-sentence
reason>`, no terminator — and gates on it (`gapsShapeProblems`: non-empty, ≥ 1 countable heading,
the one-re-prompt rule); run.md's master then "counts the gap entries" with no countable form and
no shape gate, so the same list is two entries to a prose reader and zero to the ruled mechanical
count, and the manual no-progress judgment is ambiguous and non-reproducible). Carried with them,
from 0200's residuals: run.md's own progress-rule sentences (loop step 6 and the single-mode
self-verification copy) still read pre-0198 phrasing ("a round that shrank the count buys the
loop another round" — natural reading versus-previous-count, the exact reading 0198 D1 retired on
the driver side).

## Derivation and Category scope

Derives: **P13** — frozen additive-only vocabularies change only by conscious lockstep; both
defects are grammar drift between the manual mirror and the driver's frozen grammar (the
`fix <round>.<session>` derivation, the gap list's countable form), and each fix lands in
conscious lockstep: this ruling + the ratchet arm in the same change, the vocabulary itself
carried as ruled (0148 D1, 0146 D1, 0198 D1 — mirrored, never amended). Derives: **P7** —
grammars, never content; the master's fix budget is computed over a mechanical grammar (the
`### Gap N` headings alone) with a mechanical shape gate, never over prose judgment of the
entries' content — the freeform list made the budget a content judgment. Derives: **P2**
(operating half) — every automatic escalation bounded; the manual twin of 0198 D1's own showing:
a progress budget is bounded only if the count is reproducible, and a count over an undefined
form is not — the countable grammar plus the best-count rule are what make the manual loop's stop
deterministic (≤ 2N+2 rounds, two consecutive no-progress rounds stop for the person). Derives:
**P6** — derived state, re-derivation; the ordinal derives from the log (max+1), never from an
in-conversation count, so a restarted master control re-derives it by the same read the live one
made. Tier: none — mirror-copy corrections inside the manual suite (`prompts/`), no runtime
mechanism and no frozen vocabulary changed; the ruled sources stand as the mirrors' truth.

premises this ruling changes: none that a standing rule loses — 0148 D1/D3, 0146 D1–D3 and
0198 D1 are the sources this ruling mirrors, re-read in this change and standing unchanged (the
manual copies' claims **against** them were the defects). 0200 D1's same-protocol premise (the
companions' Stage 3 runs "the same whole-unit protocol run.md's loop steps 5–6 run") is
**completed** here, not invalidated: 0200 wrote the companions ahead of run.md's own channel and
recorded run.md's stale sentence as its residual for this step; with this ruling the two channels
carry the same grammar, derivation and progress rule. 0200's residual is discharged.

### Category scope

The manual-driver prompt suite family (0078–0094, 0098–0118, 0120, 0146–0148's manual halves,
0161, 0163, 0164, 0200): code homes `prompts/run.md` (both fix-subject sites, the loop step 6
INCOMPLETE branch — shape gate, count rule, progress rule — and the single-mode copy), 
`prompts/run-verify.md` (the INCOMPLETE branch's gap-list grammar and closing line),
`prompts/run-fix.md` (the read-first description of the list it reads); test home
`test/manual-prompts-ratchet.test.ts` (the new arm plus the protocol-strings comment carried
current); documentation homes this row in `plans/INDEX.md` and this ruling. No `src/` home: the
driver side is the rule's source and already ruled (0148 D1, 0146 D1/D3, 0198 D1); no shell
package touched.

## D1 — the fix subject's `<session>` is one past the highest ordinal in the log, never a landed count

**The defect.** run.md states the derivation twice — loop step 3's share-ordinal paragraph ("the
session the round's landed fix shares count — a restarted master control derives it from the log
the same way") and loop step 6's INCOMPLETE landing sentence ("`<session>` the round's landed fix
shares count"). A count is not the driver's derivation in three measured ways: a fresh round
numbers its first session 0 where the driver numbers 1 (`nextFixSession` returns max+1 = 1 over
an empty history); the share after one existing `fix 1.1` numbers 1 again — a duplicate subject,
destroying 0148 D1's unique per-session history; and a sparse index (the driver's own legitimate
shape: a context-wall handover commits nothing and "the ordinal still advances, so git may skip
indices", src/wrapup.ts) is renumbered, so the manual log cannot be read back by the driver's
max+1 reader without collision. The adjacent exec-ordinal sentence ("`<k>` one past the count of
this task's landed exec shares") is not the defect and stands: exec shares are dense by
construction within a run (each landing is one ordinal, one share), the restart derivation
already names the log, and the finding measured only the fix sites.

**The rule.** Both sites teach the driver's derivation in the driver's own terms: `<session>` is
one past the highest `<task id> fix <round>.<n>` subject already in the log for that round —
**across every repository the target holds** (a round's commits may land in any of them, the
driver's own `nextFixSession` comment) — and 1 when none exists. Sparse indices stay sparse (the
numbering keys on the log's highest, never on a count of landings); a restarted master control
derives the number by the same read. The subject literals (`<task id> fix <round>.<session>
<short title>` and its `[<k>]` tail) are unchanged — frozen vocabulary, the derivation sentence
alone restated.

## D2 — the countable gap grammar carried into the whole-task channel, the master counting it alone

**The defect.** The suite's promise is that "the state files and git history afterwards look as
if the driver had run the round" — but the driver's FAIL side is a mechanical contract
(countable headings, a mechanical count, a shape gate with one re-prompt) while the manual
whole-task channel taught none of it: the verification child could write a freeform list, and
the master "counted the gap entries" over an undefined form. Two rounds that reword or split the
same defects can be judged differently by different sessions — an early stall stop or an
unbounded loop where the driver re-prompts once then blocks; the manual twin of exactly the
unbounded-escalation shape 0198 D1 closed on the driver side, opened again by the count's
ambiguity.

**The rule.** The grammar, carried verbatim from the driver's own FAIL side (0146 D1, as 0200 D1
already carried it into the subtask companions):

1. **run-verify.md, the INCOMPLETE branch** — the gap list's write grammar: first a compact
   summary of what was verified as OK (so the fix session does not redo it), then one entry per
   gap as a `### Gap N — <one-line title>` heading under a `## Gaps` heading (N counting 1, 2, …;
   the entry under its heading names the missing or wrong required action, where — files —, and
   what exactly to do) — ending with `Result: FAIL <one-sentence reason>` as that file's last
   line of body text (no terminator in that file). The false sentence "its last line of body text
   is simply its last entry, the same file shape the driver's own verification loop uses" is
   retired — it was false twice over (no grammar, wrong last line). The verdict channel stays
   the reply line (`Verification: INCOMPLETE`); the closing `Result: FAIL` line is the file's
   own shape, the driver's, never a second verdict channel.
2. **run-fix.md, the read-first** — the description of the list the fix session reads states the
   same countable form (the driver's own fix template's description), so the reader and the
   writer hold one shape.
3. **run.md, the loop step 6 INCOMPLETE branch** — the master's intake is mechanical:
   shape-check the verdict's own write (the list non-empty, carrying at least one `### Gap N —`
   heading under `## Gaps`, its last line `Result: FAIL …`) — a malformed verdict write gets one
   feedback relaunch of the verification child naming the deficiency, then stop and report (the
   driver's one-re-prompt rule's mirror, the companions' identical check); count the list's
   `### Gap N` headings alone — the countable form the fix budget measures; and the progress
   rule in 0198 D1's terms: the loop's best count is the minimum its FAILs have measured (the
   first FAIL only seeds it), a round made progress only when a later FAIL's count is strictly
   lower than the best — same count, grown count or a re-fall to a count the loop already saw is
   no progress — and once two consecutive fix rounds made no progress, stop and report (the work
   stays landed as the unit's share commits, reverting it the person's call); a loop that keeps
   making progress runs at most 2N+2 fix rounds from N seed gaps before it passes or blocks.
4. **run.md, the single-mode copy** — the self-verification sentence's progress clause restated
   in the same terms (strictly lowering the loop's best, two consecutive no-progress rounds
   stop), retiring its "while the gap count shrinks" phrasing whose natural reading is
   versus-previous-count.

The retired readings are pinned absent in the ratchet beside the new sentences ("the round's
landed fix shares count", "a round that shrank the count buys the loop another round", "the
count stopped shrinking", "its last line of body text is simply its last entry"), so reversing
one is a conscious change that updates this ruling with the file.

## Residuals

- The manual master's shape gate and count are text-level prompt rules — the suite has no
  machinery to execute them; the ratchet holds the rule-sentences and the retired phrases
  (text-level oracles, the suite's only possible oracle over prompt copy). Deeper
  scenario-execution machinery is 0165-165's question (step 043).
- The fix-share subject sites of run.md keep their `<short title>` form (already the driver's
  grammar); the **companions'** `<task title>` sites are 0165-163's family (step 042), untouched
  here — no companion file changed in this ruling.
- The driver's dispatch-ordinal subtlety (an uncommitted context-wall session still advances the
  ordinal, so two runs may share a sparse tail) is the driver's own accepted sparseness
  (S25's residual note, 0148's sparse-index residual) — the manual mirror derives from the log
  and therefore inherits the same sparseness, never a collision.
