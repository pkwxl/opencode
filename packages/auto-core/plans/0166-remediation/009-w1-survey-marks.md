# Step 009 — w1-survey-marks

Wave W1-person-marks · findings 0165-001 (S04-06, S1), 0165-002 (S07-01, S1) · status: **done** 2026-11-05
Started 2026-11-05 · start HEAD 2f0229815 · verified and committed same day.

## Scope (as enacted)

The S1 pair: the survey gate's person marks. **0165-001** — the brief install ran whenever the
human gate passed with zero forks the scan could see (near-miss spellings invisible), no person
act; **0165-002** — the release mark was read anywhere in the agent-written survey.md, so a
session's indented example released a forked survey. The wave's ruling is
**[plans/0169-survey-person-marks.md](../0169-survey-person-marks.md)** (Derives: P2 with P7 and
P13; tier: operating; `premises this ruling changes: none` — 0081's D15.2 approval semantics
enacted, not amended).

## Changes

1. `plans/0169-survey-person-marks.md` (created) — the ruling (D1–D4 as below).
2. `src/phases.ts` — `clarifiedMark` scoped: the mark counts as a whole line inside a trailing
   `## Release` section (the forward channel) or as the legacy flush-left whole line (CRLF-tolerant);
   indented and fenced lines never count, anywhere. `nearMissForkLines` exported (`1. Fork:`,
   `**Fork:**` shapes). The human gate holds on near-misses, on open forks, and on an unreleased
   `## Project brief` proposal (fork-only hold line byte-identical to the pinned original; the
   proposal shapes get their own lines).
3. `src/loop-phase.ts` — `installApprovedBrief` returns unless the mark holds.
4. `src/clarify.ts` — `withMark` writes the `## Release` region; the zero-fork-proposal shape is
   a release moment (review names the proposal, subject "release the proposed brief"); a
   near-miss survey refuses until normalized.
5. `templates/bundles/{cleanroom,faithful,faithful-lean}/phases/survey.md` — the prohibition
   tightened (never write the person's `Clarified:` line, not even as an example, indented or
   fenced; the proposal holds for the person's release too).
6. `test/import-direction.test.ts` — `brief` joins the document domain's entry list (the
   conscious table edit: the `## Project brief` proposal reader is that grammar's one home, P5,
   and the phases domain's gate now consumes it — the AGENTS.md-named path).
7. Tests: `test/survey-gate.test.ts` +3 (zero-fork-proposal hold and install-on-release;
   near-miss hold; the indented example never releasing while the `## Release` region does),
   `test/clarify.test.ts` +2 (the near-miss refusal; the zero-fork-proposal release writing the
   region and passing the gate). The survey-gate fixture gained a parameterized survey document.
8. `AGENTS.md` (the survey-gate navigation line gains clarify.ts, the scoped-mark phrase and
   0169); `plans/INDEX.md` (the 0169 row).

## Verification

- `bun test` (full suite) — **2924 pass, 0 fail** across 152 files (was 2921 + the five new
  regressions, two reworked counts); `bun typecheck` clean.
- Fixed in passage, each with its own probe: the CRLF flush-left shape (the old trim semantics
  preserved for `\r`), the driver-helper row-4 byte pin (the fork-only hold line restored
  verbatim — the proposal clause only where a proposal exists), and the import-direction ratchet
  (the conscious entry-list edit).
- Direct function probes: forks/near-miss/clarifiedMark over the four shapes (strict fork
  counted; `1. Fork:`/`**Fork:**` near-miss; indented and fenced marks false; region and legacy
  flush-left true).
- family-check 0169 post-commit (the untracked-plan limitation): 5 rows expected ok.

## Dispositions

- **0165-001** — fixed (step 009, this commit, ruling 0169): the install is mark-gated (D2); the
  zero-fork-proposal and near-miss shapes hold (D3); clarify accepts the proposal release and
  refuses near-misses.
- **0165-002** — fixed (step 009, this commit, ruling 0169): the mark scoped (D1) — the confirmed
  exploit (the indented example) dead, pinned by the regression; the analysis and roadmap
  channels inherit the scoped reader unchanged.

Residuals (0169 D4, named): a session writing a flush-left bare mark or a forged `## Release`
section in its own text still releases — the region rule kills the example class (the confirmed
shape) and the templates now prohibit all of them; the commit-provenance guard (the mark present
in the session's own committed version — the S20-05 receipt-provenance shape) is the named
follow-up if the field ever confirms the flush-left forgery.
