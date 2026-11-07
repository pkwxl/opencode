# Step 049 — w-round-docs: round-brief subsection grammar, brief-install commit idempotence, awaiting note, driver-helper truths, analysis hygiene

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W-round-docs (the round-documents family: the round-brief proposal
grammar 0115 D2 / 0158 D3, the proposal-install family's idempotence 0081
D15.2 / 0115 D3, status's awaiting note 0081 D14.3, driver-helper's
close-check truths 0105, and the S09 hygiene sweep), findings **0165-016**
(S09-01, S2), **0165-103** (S09-03, S3), **0165-104** (S09-04, S3),
**0165-105** (S09-05, S3) and **0165-191** (S09-06, S4). Started 2026-11-07
at HEAD `2fb8ae579` (steps 001–048 done); resumed 2026-11-08 by a delegated
worker recovering the first session's in-flight work (ruling 0209 complete
on disk, the nine src changes and two test homes landed, the remaining test
homes and all bookkeeping this session's).

## Findings (from plans/0165-review/S09-round-docs.md)

- **0165-016 (S09-01, S2, 0115 D2/D3 + 0158 D3, P2/P12/P8)** — a round-brief
  proposal structured like the round.md it becomes is silently truncated:
  since 0158 D3 any `####` sub-heading ends the subsection (the body before
  it installs, the rest dropped — while the success line says "installed
  verbatim"), and a `##` heading ends the whole `## Round briefs` section
  (every later proposal lost, no problem, no note). The stub's own hint
  invites the sectioned shape ("goal, acceptance criteria, release criteria —
  the content of docs/R-NN/round.md", whose stub is three `##` sections), and
  a proposal opening with a sub-heading draws a false "holds no content"
  problem.
- **0165-103 (S09-03, S3, P6/P4)** — the brief install's idempotence skips
  the commit: an equal brief.md on disk returns [] before committing, so a
  kill between the write and the brief-install commit leaves brief.md
  uncommitted and no later install pass commits it (unlike its family member
  installRoundBrief, which re-commits on an equal re-run); the dirty file
  then blocks the next unit start or rides an unrelated driver commit.
- **0165-104 (S09-04, S3, 0081 D14.3, P8)** — status's awaiting-clarification
  note fires for every not-done human-gated phase whose survey.md is missing
  or still being written: the comment's "tasks all done" condition is not in
  the code, `<dir>` prints as a literal, and no test pins the note.
- **0165-105 (S09-05, S3, 0105, P8/P12)** — driver-helper's build-less round
  close tells two untruths: the held shape renders round-close's "⚠ build: no
  build command configured" beside its own "ℹ this brief did not run the
  config build" (a configured project read as build-less), and when the build
  is the only failing check the brief reports "complete and passes its close
  checks" with no caveat at all.
- **0165-191 (S09-06, S4, P13/P5)** — scope hygiene: (a) analysis.ts's
  near-miss comment names `### R-5` a near-miss (it parses — unpadded round
  5; 0115 D2 carries the same slip); (b) driver-helper's ROLE and brief.ts's
  comment still teach the `init/amend --brief` seed retired by 0133 D9
  (amend keeps the pair, init does not seed); (c) `releasedRoadmapRound`
  imported and unused in plan.ts and loop-phase.ts; (d) status.ts re-composes
  releasedRoadmapRound+phasesDiverge where roadmap.ts `supersedingPhases` is
  the one composition; (e) status.ts prints the literal `<dir>`; (f)
  driver-helper's `Needs your attention` free-content scan is dead code (no
  template or prompt writes the heading; 0109 says a person-commissioned
  report is never read).

## Plan (enactment order; each ingredient lands green)

1. Ruling **0209** written first (Derives P2/P6/P8/P12/P5/P7/P4; Amends
   0158 D3's terminator premise and 0115 D2's near-miss enumeration slip;
   premise guard against 0158 D3 and 0115 D2 — both INDEX rows annotated).
2. D1 (0165-016): `roundBriefProposals` terminates a subsection only on a
   round-shaped head (ROUND_BRIEF_NEAR — the near-miss discipline kept,
   scoped to heads that name a round); other `####`–`######` lines ride as
   body (0115 D2's ruled free markdown). A `##`/`#` heading still ends the
   section, and exact `### R-NN` heads after the section's end become a named
   release problem (`analysisProblems`) plus the open-time note arm when one
   names the round being opened. The stub hint and the AGENTS.md guidance
   teach the heading levels.
3. D2 (0165-103): `installBriefProposal` commits on the equal path too —
   compare, write when different, always run the commit (commitTree skips a
   clean tree, so the no-op re-run stays byte-identical); the round-brief
   family shape. Crash-shape test beside the round-brief one.
4. D3 (0165-104): status's awaiting note keyed on the ruled condition —
   the phase's tasks all done, the survey present, a clarification problem
   open; the real `dir` rendered.
5. D4 (0165-105): `roundCloseProblems` gains a `buildSkipped` opt (the
   "no build command configured" warning omitted, a `buildSkipped` marker
   returned); driver-helper passes it when a build is configured, renders the
   caveat on both paths — the pass line "passes its close checks except the
   build, not run by this brief".
6. D5 (0165-191): the hygiene sweep — the comment corrections (a), (b); the
   unused imports dropped (c); status calling `supersedingPhases` (d); (e)
   rides D3; the dead `Needs your attention` scan deleted (f).
7. Pins for each arm; fail-before on pre-fix source over a /tmp backup.
8. Full verification (`bun typecheck` + `bun test`), docs (ruling 0209,
   INDEX row + the 0158/0115 annotations, AGENTS.md navigation,
   structure.md), ledger rows, program position, single commit.

## Verification

Recovered in-flight work verified against disk and git at resume (all five
src arms of the ruling landed; the two in-flight test homes — analysis,
driver-helper's D5f pin — sound). Completed the four remaining test homes
exactly as the ruling's Category scope enumerates. `bun typecheck` exit 0;
auto-core full suite **3141 pass / 0 fail** (155 files = the 3131/155
baseline + 10 net new, zero regressions); the doc-reading suites
(import-direction, constitution-ratchet) and the golden suite green inside
it. Fail-before proof over /tmp/049-fixed (the nine changed src files backed
up, `git show HEAD:` pre-fix versions swapped in, the pins run, the fixed
files restored and cmp-verified byte-identical): **12 pins red on pre-fix
source** —

- D1 (3 pins in analysis.test.ts + 1 e2e in transfer.test.ts): the
  sectioned proposal parsed to `""` (its `#### Goal` terminated the
  subsection — the false-empty arm), the `##`-stranded `### R-02` never
  named (no problem, `roundBriefLostHeadings` absent), the stub missing the
  levels hint, and the e2e release **held at exit 2** over the sectioned
  proposal (the "holds no content" problem the truncated read drew);
- D2 (1 pin in plan.test.ts): the interrupted install logged nothing
  (`lines[0]` the establishment line, the equal path's `[]` before the
  commit — brief.md left uncommitted for the next clean gate);
- D3 (3 pins in tasks.test.ts): the note printed the literal
  `clarify <dir>` placeholder, and fired for a pending-task phase and for a
  missing survey (the loose predicate, verbatim: "awaiting your
  clarification" over a survey that does not exist);
- D4 (1 pin in round-gates.test.ts + 2 in driver-helper.test.ts): the gate
  rendered `build: no build command configured` under `buildSkipped` with no
  marker; the held close carried the same borrowed ⚠ warning beside its ℹ
  caveat; the complete route's pass line carried no caveat clause;
- D5 (1 pin riding driver-helper's ROLE test): the dead
  `Needs your attention` scan still rendered the needs-attention defaults
  line.

The pre-existing tests of the touched files were green on the pre-fix source
(the floor); the restored tree green across all six touched suites
(203/203).

## Dispositions

- **0165-016 (S09-01, S2)** — fixed (ruling 0209 D1): the terminator
  grammar restated on what a line names — a round-shaped head
  (`ROUND_BRIEF_NEAR`, scoped to heads naming a round) terminates, every
  other `#{3,6}` line is body (the stub's invited sectioned shape installs
  whole, the false "holds no content" problem dead); a `##`/`#` heading
  still ends the section with exact heads after it a named release problem
  (`roundBriefLostHeadings`, capped 3 + count) and the note's second arm at
  the stranded round's open; the stub hint and the AGENTS.md guidance teach
  the levels.
- **0165-103 (S09-03, S3)** — fixed (ruling 0209 D2): `installBriefProposal`
  compares, writes when different, always commits — commitTree skips a clean
  repository, the no-op re-run byte-identical; the interrupted install
  recovered by the driver's own re-run.
- **0165-104 (S09-04, S3)** — fixed (ruling 0209 D3): the awaiting note
  keyed on 0081 D14.3's ruled condition (tasks all done, survey present,
  clarification open), the real `dir` rendered, the comment now the code.
- **0165-105 (S09-05, S3)** — fixed (ruling 0209 D4): `buildSkipped` opt
  (warning omitted, no run, marker returned), driver-helper passing it
  exactly when a build is configured, the caveat on both paths — the pass
  line "passes its close checks, except the build, not run by this brief"
  (byte-identical when no build is configured).
- **0165-191 (S09-06, S4)** — fixed (ruling 0209 D5): (a) the `### R-5`
  near-miss comment corrected (0115 D2's slip, its INDEX row annotated);
  (b) the seed-channel teachings restated (driver-helper's ROLE line,
  brief.ts's and loop-phase's comments — the channels that exist); (c) the
  unused `releasedRoadmapRound` imports dropped from plan.ts and
  loop-phase.ts; (d) status composes the supersession through
  `supersedingPhases`; (e) rides D3; (f) the dead `Needs your attention`
  scan deleted (0158's residual register dispositioned by deletion).
- Named residuals carried (0209): a round-shaped near-miss head still
  terminates the subsection it follows (deliberately kept); the
  lost-headings problem runs only at the project start (the open-time note
  covering the round being opened alone); status's and driver-helper's
  two derivations of the awaiting condition remain two (the predicates
  agree, both pinned); the pass-line caveat names the build alone.
- Premise guard: 0158 D3 and 0115 D2 re-read in this change, both INDEX
  rows annotated (0158's row also carrying the residual register's
  needs-attention disposition).
