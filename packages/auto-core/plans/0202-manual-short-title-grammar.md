# 0202 — The manual suite's short-title grammar completed: every task-title-bearing subject carries `<short title>`, the clause-cut/four-word rule taught once per commit-making companion

Status: **active**. Ruled 2026-11-07 by 0166 step 042 (wave W-manual-vocabulary), enacting 0165-163
(S25-08, S3, CONFIRMED — 0148's short-title grammar is still incomplete across the manual suite: the
subtask companions' decompose/wrapup/fix/done subjects keep the full-title `<task title>` placeholder
(15 sites across `prompts/run-as-subtasks.md` and `prompts/resume-subtasks.md`, the fix subjects among
them written by 0200 D1), run.md's formulation share keeps `<task id> exec <title>`, and no
commit-making companion teaches the derivation — run.md's general definition says only "its leading
words" plus 100-character truncation, and run-verify.md, whose primary hands it the **full**
`<task title>`, teaches nothing at all, so the verification session cannot derive the `<short title>`
its own wrapup/done subjects require except by improvisation; the driver's rule is `shortTitle` in
src/git.ts, 0148 D2: the title's first clause cut at the first `:` / `(` / em-dash, capped at four
words, the leading words the fallback).

## Derivation and Category scope

Derives: **P13** — frozen vocabularies change only by conscious lockstep; the manual mirror's subject
vocabulary is corrected to the driver's already-frozen grammar in one change that carries the prompt
edits, this ruling and every ratchet pin together — including the two pins that hold the retired forms
(0200 D1's arm pinning `T-NNN fix <round>.<session> <task title>`, the phase-transfer arm pinning
`` `<task id> exec <title>` ``), each flipped here as part of the same lockstep. Derives: **P7** —
grammars, never content; the short-title derivation is a mechanical rule over the title's form (clause
cut, word cap), never a judgment of its content, and the manual companions now teach it as exactly
that. Derives: **0148 D2/D3** as the mirrored source (never amended): D2's rule and D3's mirror
promise ("the manual-driver prompts teach the same grammar") are completed across the suite's every
commit-making file — the driver side (src/git.ts and every subject site) already ruled, unchanged
here. Tier: none — mirror-copy corrections inside the manual suite (`prompts/` + its ratchet), no
runtime mechanism and no driver-side frozen vocabulary changed.

premises this ruling changes: none that a standing rule loses — 0148 D2/D3 stand as the mirrored
source, re-read in this change; 0200 D1's text spells the companions' fix subject with `<task title>`
(the then-current literal) while its rule — the loop, the log-derived ordinal, the gap lifecycle —
rests on none of it, and its ratchet pin moves in this same change (a pin is held grammar, not a
premise); 0201 D1's derivation sentences sit in run.md's sites that already carry `<short title>`,
untouched.

### Category scope

The manual-driver prompt suite family (0078–0094, 0098–0118, 0120, 0146–0148's manual halves, 0161,
0163, 0164, 0200, 0201): code homes `prompts/run.md` (the general share-title definition restated
mechanically, the formulation share's subject), `prompts/run-verify.md` (the rule, taught once),
`prompts/run-as-subtasks.md` and `prompts/resume-subtasks.md` (the 15 subject sites, the rule taught
once each); test home `test/manual-prompts-ratchet.test.ts` (the new arm, the two flipped pins, the
retired forms pinned absent); documentation homes this row in `plans/INDEX.md` and this ruling. No
`src/` home — the driver side is the rule's source and already ruled (0148 D2); no shell package
touched.

## D1 — every task-title-bearing subject in the manual suite carries `<short title>`

**The defect.** 0148 D3 landed its mirror in run.md and run-verify.md alone. The subtask companions
— in the suite since 0078, each a separate driver-role session that never sees run.md — kept the
full-title placeholders in exactly the subjects 0148 shortened on the driver side: `T-NNN decompose`,
`T-NNN wrapup`, `T-NNN fix <round>.<session>`, `T-NNN done` (the stage listings, the Stage 3 close-out
sentences, the fix-share landings, and resume's reconstruction items — 15 sites), 0200 D1's fix
subjects among them. run.md's own phase-loop step 6 kept a bare `<title>` in the formulation share
(`<task id> exec <title>`), though the driver lands that share through the task pipeline's
`T-NNN exec ${shortTitle(task.title)}` like any task. The result the finding measured: manual history
differs by title length and clause shape from driver history despite the suite's same-grammar promise
— long descriptive titles remain in exactly the subjects 0148 shortened.

**The rule.** Every subject that bears the task's title carries its short form `<short title>`:

- the companions' four subject forms per stage listing, close-out and reconstruction site (decompose,
  wrapup, `fix <round>.<session>`, done — both files);
- run.md's formulation share (`<task id> exec <short title>`, `Auto-Stage: execute`).

**What stands, unchanged.** The full title in every non-subject position — the authoritative-state
lines (`task T-NNN "<task title>" is in progress`), the primaries' fill-ins (run.md hands run-verify
the full `<task title>` from the index line; the short form is derived, never handed), and the
document grammar of run-plan.md / plan-append.md (index lines `- [ ] T-NNN <task title>` and title
lines `# T-NNN: <task title>` carry the full title per the task-unit model). The elided subject forms
(`` `T-NNN decompose …` ``, `` `T-NNN S<nn> …` ``). The phase commits (PLAN handover / transition /
formulate carry phase ids and phase names — `phaseTitle`, never shortTitle). The `<subtask short
title>` form of the Stage 2 shares (D2's cap note completes it). run.md's task-channel subjects, already
`<short title>` since 0148 D3 (loop step 3, step 6, the single-mode copy, run-verify's close-out).

## D2 — the mechanical rule taught once per commit-making companion

**The defect.** No commit-making companion stated the derivation. run.md's general definition — the
one site the suite defines the term — said only "its leading words … truncated so the subject stays
within 100 characters": a description, not the driver's rule, so two manual runs may shorten the same
title differently. run-verify.md stated nothing at all while requiring `<short title>` in its check-1
range validation and its own wrapup/done subjects.

**The rule** (0148 D2's own terms, taught once per file — every companion is a separate session that
never sees the others):

> The title's **first clause**, cut at the first `:` / `(` / em-dash (where long titles park their
> parenthetical detail), **capped at four words**, the title's leading words when the first clause is
> empty — the task id identifies the unit, the full title stays in the task document and the run's
> state files; a mechanical rule over the title's form, never its content. The subject, ordinal
> included, is truncated past 100 characters.

- **run.md** — the general definition (loop step 3, the suite's canonical statement and the finding's
  named family site) restated with the mechanical rule, the 100-character truncation clause standing.
- **run-verify.md** — the rule added once after the intro, serving both uses: check 1's grammar
  validation over the range's subjects and the close-out's own wrapup/done commits.
- **run-as-subtasks.md / resume-subtasks.md** — the rule added at the "Commit subjects and stages"
  block, with the subtask-share note: the Stage 2 subject carries the item's declared short title
  (its checklist line's text before the fields — the driver's `shortTitle` over the item's full line
  lands exactly there, the colon of a `<title>: <description>` line being the clause cut) under the
  same four-word cap.

## D3 — the ratchet extended beyond the run.md/run-verify happy path

The finding's remedy names it: the ratchet pinned the short-title forms only where 0148 D3 landed
them. The new arm holds, per commit-making companion: the four short-title subject forms (the
companions), the formulation share's short form and the mechanical rule's terms (first clause,
four-word cap, the separators) in every commit-making file, and the retired full-title subject
literals pinned **absent** — `decompose <task title>`, `wrapup <task title>`, `done <task title>`,
`fix <round>.<session> <task title>` in both companions, `<task id> exec <title>` in run.md — so
reversing one is a conscious change that updates this ruling with the file. The two existing pins of
the retired forms (0200 D1's arm, the phase-transfer arm) flip in the same change.

## Residuals

- The rule is a text-level prompt rule — the ratchet holds the subject literals, the rule's terms and
  the retired forms (text-level oracles, the suite's only possible oracle over prompt copy); deeper
  scenario machinery is 0165-165's question (step 043), as 0201's residual already records.
- The driver's `shortTitle` handles the full-width twins of the separators (`（`, `—`, `–`) in code;
  the manual prose names the canonical three (`:` / `(` / em-dash), 0148 D2's own spelling — a
  decomposition writing a full-width separator in a task title is a divergence the ratchet cannot
  see, accepted with this ruling (the driver-side rule is the truth; the prompt teaches its terms).
- run-handover.md teaches no task-title subjects (its commits carry phase ids and names) — outside
  the family by the driver's own construction (`phaseTitle`), no rule needed there.
