# Step 065 — wa-constitution-releases

Wave WA-docs · findings 0165-007 (S2), 0165-068 (S3), 0165-069 (S3), 0165-071 (S3), 0165-181
(S4), 0165-182 (S4), 0165-183 (S4), F11 (twin 0165-068), F12 (twin 0165-069), F17 (twin
0165-181), F18 (twin 0165-007), F19 (twin 0165-071), F20 (twin 0165-182), F21 (twin 0165-183)
· status: **done** 2026-11-09 · start HEAD `6496418db`.

## Scope (the findings' one family)

The constitution/releases documentation pair reconciled with the rulings it records — every
finding of this step is one shape: `docs/principles.md` or `docs/releases.md` text that
contradicts, lags, or stays silent where the corpus has ruled, proven where it could be by
0165's blind falsification replay (S03). No code behavior is ruled; the wave is WA-docs.

- **0165-007/F18 (S2)** — P4's derivation text predicts "stop" where 0145 ruled "adopt the
  person's foreign commits, never a stop" (replay Q1 MISMATCH, the S2).
- **0165-071/F19 (S3)** — no principle states the informational class (0135/0136's `info`,
  exit 0), so a blind reader reads a divergent superseded key as an exit-1 finding (Q5).
- **0165-068/F11 (S3)** — the written deprecation lifecycle (tombstone → warning release →
  removal) is not the practiced instant parse-time tombstone (0137, 0150 D2, 0052 D3/D4,
  0053 §10 B4).
- **0165-069/F12 (S3)** — the constitution was edited between releases once, silently (0146's
  commit `7401fe7b5` rewrote P2's bounded-escalation line, stamp unchanged); the line also
  imports a threshold and the misreadable "no-gap rounds".
- **0165-181/F17 (S4)** — How-to-rule asks a derivation per decision block; the corpus states
  one consolidated Derives paragraph per document.
- **0165-182/F20 (S4)** — five constitution silences: lock scope, "shared git state", task-id
  uniqueness, "safe boundary", Tier I/II precedence.
- **0165-183/F21 (S4)** — the replay protocol leaks: a session inside the package auto-loads
  AGENTS.md, which names the rulings; releases.md's audit duty never states the method.

## Design ruling (written before the enactment)

Ruling **0225** ([0225-constitution-releases-reconciliation.md](../0225-constitution-releases-reconciliation.md))
— D1 P4's derivations reconciled with 0145 (adoption + the re-anchor that keeps the close-out
range pure; the 0076 line restated to teach, not threaten); D2 P8 gains the recorded-state
(info) class (statement parenthetical + derivation bullet + chosen-default clause); D3 the
deprecation lifecycle amended to the practiced two-track rule (a vocabulary's tombstone is its
permanent teaching refusal; a silently-changing behavior takes the warning release) in both
homes — the rule step 071 enacts against; D4 P2's bounded-escalation line rephrased without the
threshold or the "no-gap rounds" phrase, current to 0198; D5 the five definitional sentences
(lock scope in P5; shared git state in P17; task-id uniqueness in P18; the safe-boundary
definition in P20; Tier precedence in How-to-rule); D6 the mid-cycle amendment register — the
change-control rule amended to the two recorded classes (reconciliation; mid-cycle Amends), the
register created in releases.md, 0146's edit recorded retroactively, this step's and step 006's
edits recorded as they land, consumption at the next cut (step 070's material); D7 the replay
method named in releases.md's audit duty (never inside the repository; an isolated directory
with principles.md alone). Derives P18/P19 with P8/P13; Amends the change-control framework
sentence (principles.md How-to-rule + releases.md's intro) and P13's chosen-default lifecycle
line — both Tier II documentation defaults; `premises this ruling changes: 0110 D14` (the
release-only change-control letter — the amendment is its subject). Category scope: the
constitution/releases documentation family; homes enumerated in the ruling.

## Implementation order (the recovery map)

1. Ruling 0225 written (above).
2. `docs/principles.md`: D1 (P4 bullets 2 and 6), D2 (P8 statement + derivations + default),
   D3 (P13 chosen default), D4 (P2 l.61), D5 (P5/P17/P18/P20 bullets + How-to-rule), D6 (the
   change-control sentence), D7 nothing (releases.md's home).
3. `docs/releases.md`: D3 (the deprecation lifecycle), D6 (the intro sentence + the register),
   D7 (the audit duty §2).
4. `AGENTS.md`: the derivation-discipline sentence's consolidation clause (D-F17's lockstep,
   one clause — the same letter as principles.md, no navigation change).
5. The pin: `test/constitution-reconciliation.test.ts` (the 0221 docs-pin pattern) — fail-red
   at HEAD before the doc edits, green after.
6. INDEX row 0225; ledger dispositions; program bookkeeping; commit.

## Execution log

- 2026-11-09 (delegated worker): step opened after step 064's commit (`6496418db`, verified).
  Evidence read: the 0165 register rows, S02-03/S02-04/S02-09, S03-replay (all runs + gaps),
  0145 (D1's adoption + the re-anchor passage + 0183 D3's readable bound), 0146's commit
  diff (the mid-cycle edit verified verbatim), 0135/0136 (the info class), 0137/0150 D2
  (the practiced tombstones), 0076 (the hand-commit passage), 0129 (the lock's scope), 0140
  (the corpus bound), 0143 (the handover boundary), src/numbering.ts's header (the floor's
  true letter). Old-wording carriers grepped: the lifecycle sentence and the P4 phrases live
  in the two docs alone — the lockstep scope is closed.
- 2026-11-09: ruling 0225 written (D1–D8). Enacted in order: principles.md (D4, D1, D2, D3's
  P13 line, D5's four principle bullets + How-to-rule's two sentences, D6's change-control
  paragraph, D8's consolidated-form sentence), releases.md (D6's intro lockstep, D3's
  two-track lifecycle + D6's register, D7's method sentence), AGENTS.md's one clause, the
  pin test + its lanes.ts row, the INDEX row. Fail-before proven before the bookkeeping;
  verification green; dispositions and program updates landed in the same commit.

## Verification (the step's close)

- `bun typecheck` — exit 0.
- Full suite: **3215 pass / 0 fail** (157 files) — the 3213/0/156 baseline plus the pin file's
  2 tests. Three consecutive complete full-suite runs green; the one intermediate red was the
  lane-manifest registration itself (`every test file on disk is in the manifest exactly
  once`) before `test/lanes.ts` carried the new file — its early-exit the 20930−20928 expect
  pair — green in every run after the registration landed.
- Fail-before proof (the /tmp/065-head pattern — HEAD's pre-fix doc bytes extracted read-only
  via `git show`, the pin needles evaluated against them by a mirror of the test's tables):
  **22/22 pins red, 3/3 retired wordings still present** at HEAD — the exact state the
  findings measured (the replay's "stop" reading, the missing info class, the single-track
  lifecycle, the threshold phrase, the five silences, no register, no method rule, the
  per-block wording). Working-tree pin green (2 tests, 25 expects). One needle was
  re-distinctified during the proof ("with no surface left to refuse" for the behavior
  track — the first draft's substring also matched the old single-track sentence at HEAD,
  21/22; the needle now separates the two texts exactly).
- The 0165 probe (`bun plans/0165-review/tools/probe.ts`): **P4 empty** (ruling 0225 carries
  Derives/Amends + Category scope); P1/P3 flags identical to the standing pre-existing set
  (the 0193 INDEX row, the placeholder-class path refs — step 006's own record), none added;
  P2 unchanged (the 0224 row's pre-existing flag, step 064's).
- No shell suite due: no packages/auto or auto-server file touched.

## Dispositions

- **0165-007 / F18 (S2)** — fixed (ruling 0225 D1): P4's derivations state the adoption and
  the re-anchor; the 0076 tail teaches; the blind reader's decisive half-sentence retired;
  pinned fail-red at HEAD.
- **0165-071 / F19 (S3)** — fixed (ruling 0225 D2): the recorded-state (info) class in P8's
  statement, derivations and chosen default.
- **0165-068 / F11 (S3)** — fixed (ruling 0225 D3): the two-track deprecation lifecycle in
  both homes, the practiced convention stated with its citations; step 071's rule.
- **0165-069 / F12 (S3)** — fixed (ruling 0225 D4+D6): the line rephrased current to 0198;
  the mid-cycle edit recorded retroactively and the rule regularized (the two classes + the
  register), premises line naming 0110 D14.
- **0165-181 / F17 (S4)** — fixed (ruling 0225 D8): the consolidated-paragraph form stated
  in both homes in lockstep.
- **0165-182 / F20 (S4)** — fixed (ruling 0225 D5): the five definitional sentences placed
  where each term lives.
- **0165-183 / F21 (S4)** — fixed (ruling 0225 D7): the replay method named in the audit
  duty.

Residuals (the ruling's named list): the v0.3.0 replay's isolation unverifiable
retroactively (its recorded confirmation stands; the next cut's replay under the stated
method — consumed at step 070/081); the register's consumption a cut-time act (rows
accumulate until step 070 writes them into the next release section; no test pins it); the
derivation-wording's oracle one pin over two homes (a sanctioned per-block revert moves the
pin in the same change); the five definitions stated, not mechanized (the pin holds the
sentences; the next replay the living audit).

Step done 2026-11-09. Ruling 0225 active-authority; the INDEX row, the ledger rows, the
status row and the program's current position land in this step's commit.
