# Step 047 — w8-release-consumption: release consumption commits under the clean-tree gate + person-boundary stop-line hygiene

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W8-planning (the planning/boundary family: the release consumptions'
commit scope 0081 D15.2 / 0115 D3 / 0101 D6, the person-boundary commands'
remedy lines 0116 D5 / 0076 §2.3 / 0053 D20, the boundary stop renderings
0102), findings **0165-013** (S07-06, S2), **0165-187** (S07-05, S4) and
**0165-188** (S07-09, S4). Started 2026-11-07 at HEAD `2b38d4bbe`
(tree clean; steps 001–046 done; no recovery needed).

## Findings (from plans/0165-review/S07-planning-a.md)

- **0165-013 (S07-06, S2, P4)** — the release consumptions commit
  pathspec-less ahead of any clean-tree gate: transfer's project start (and
  m-mode plan's row 0d through the same `analysisGate`) folds the person's
  unrelated uncommitted work into the driver's `PLAN brief install` commit,
  unlisted; the round-brief install and `rederiveTail` sweep the same way just
  before preflight, so the run-start clean gate then passes over dirt it never
  saw. A later revert of "the brief install" takes the person's work with it.
- **0165-187 (S07-05, S4, P8)** — the person-boundary commands' failed-commit
  and crash lines teach a re-run their own refusals stop: adopt's "commit
  manually and re-adopt" meets "T-NNN is already done" (the rename precedes
  the commit); close's "then re-run" meets "already closed"; task-add's
  "a re-run would add it again" is false (beginUnit refuses the dirty tree
  first); a kill inside close or adopt after the rename leaves no line at all,
  the re-run answering "already done/closed" with the uncommitted close-out
  unnamed; a kill between clarify's survey write and its commit leaves the
  re-run saying "already released — … transfer", whose preflight then refuses
  the uncommitted survey.md.
- **0165-188 (S07-09, S4, P5, DUP)** — hygiene: transfer's proposal
  continuation re-composes the `✓ round … established` / `✓ branch isolation
  …` pair inline beside `establishStopLines` (the one wording source 0102
  built); `isolateRound`'s failure arm says "nothing was written" after
  earlier repositories already switched; `gateStopLines`' survey release line
  promises "the approved `## Project brief` section is installed"
  unconditionally; `planPrelude`'s row numbers live only in comments.

## Plan (enactment order; each ingredient lands green)

1. Ruling **0207** written first (Derives P4/P8/P5/P6/P10; Amends 0099 D4's
   "never a caller's argument" premise; premise guard against 0099 D4; the
   Category scope covers the release-consumption commit family and the
   person-boundary remedy-line family).
2. D1 (0165-013): the three release-consumption committers take their own
   pathspec — `installBriefProposal` `[BRIEF_FILE, source]`,
   `installRoundBrief` the round's root directory, `rederiveTail`'s
   phase-sync commit the index plus the drift's tail directories. Over a
   clean tree byte-identical (the P10 floor); the person's unrelated dirt
   stays for preflight's clean gate to judge.
3. D2 (0165-187): every named line teaches the true recovery — adopt's and
   close's failed-commit lines, task-add's failed line, clarify's
   already-released arm reading whether the mark is committed; the re-run
   refusals (plan's adopt/export route over a done unit, close's
   already-done/closed arms) detect their own uncommitted close-out and name
   the one manual commit.
4. D3 (0165-188): the ✓ pair extracted from `establishStopLines` and routed
   through by transfer's continuation; `isolateRound`'s failure arm carries
   the switched repositories and the stop line says so on the partial arm;
   `gateStopLines`' brief clause conditioned on `briefProposal(survey)`;
   the planPrelude row table consciously declined (P21).
5. Pins for each arm; fail-before on pre-fix source over a /tmp backup.
6. Full verification (`bun typecheck` + `bun test`), docs (ruling 0207,
   INDEX row + the 0099 annotation, AGENTS.md navigation, structure.md),
   ledger rows, program position, single commit.

## Verification

All measured on the committed-state sources; the fail-before proof over
/tmp/047-prefix and /tmp/047-fixed (the ten changed src files backed up both
ways — HEAD's pre-fix content and the fixed working tree — the pre-fix files
swapped in, the suites run, the fixed files restored, cmp-verified
byte-identical, the suites re-run green).

- **auto-core**: `bun typecheck` clean; full suite **3126 pass / 0 fail**
  (155 files) — the 3119/155 baseline + 7 net new tests (transfer +2, plan
  +1, work-order +1, task-add +1, clarify +1, isolate +1; close extended in
  place; survey-gate's floor pin an assertion inside an existing test), zero
  regressions; the doc-reading suites (import-direction,
  constitution-ratchet) re-run green after the doc sweep (AGENTS.md,
  structure.md, INDEX.md).
- **packages/auto**: not run — no shell source or surface touched (a grep
  over its README/src/AGENTS found no retired spelling; the README's
  round-start passages stay true under the bounded sweep).
- **Fail-before proof** (each red on pre-fix source; the 139 pre-existing
  tests of the seven touched files green on it — the byte-identical floor):
  - the S07-06 repro (0165-013, both arms): red with exit 0 past the clean
    gate and the folded commit — the defect verbatim reproduced by a scratch
    probe over the pre-fix source (`git show --name-only` of `PLAN brief
    install`: `.opencode/auto/brief.md, docs/analysis.md, notes-private.txt,
    src/main.ts` — the person's half-done edit and private scratch inside
    the driver-trailered brief install, unlisted);
  - the m-mode round-start pin (plan.test.ts): red — the round-start commit
    carrying `scratch.txt` (and the fixture's untracked AGENTS.md) pre-fix;
  - the phase-sync pathspec pin (transfer.test.ts): red — `src-main.ts`
    inside `PLAN resync R-01 tail` pre-fix;
  - the adopt/close/task-add/clarify remedy pins (0165-187): each red on its
    own defect shape — the old "commit manually and re-adopt" line, the old
    close line's "then re-run", the old "a re-run would add it again" claim,
    the already-released arm pointing at transfer over an uncommitted mark,
    and none of the interrupted-close-out ℹ lines existing;
  - the isolate partial-arm pin and the forked-survey conditional-clause pin
    (0165-188): red — the failed isolation result carrying no `switched`
    (the line claiming nothing was written after pkg-a switched), the
    release line promising a brief install the proposal-less survey never
    performs.
  - Fixed sources restored byte-identical (cmp over all ten), re-verified by
    the same scratch probe (the brief install carrying exactly
    `.opencode/auto/brief.md` + `docs/analysis.md`, the round-start exactly
    `docs/R-01`, the dirt still uncommitted and judged at the clean gate),
    the touched suites re-run 154/0 green.

## Dispositions

- **0165-013 (S07-06)** — **fixed** under ruling **0207 D1**: the three
  release consumptions that run ahead of preflight's clean gate take their
  own pathspec through the one `commitTree` seam (the wall close's 0190 D2
  shape): `installBriefProposal` commits `[BRIEF_FILE, source]` (the brief
  plus the document the approval was read from — a hand-released uncommitted
  document rides the install as its evidence; inside the loop the pathspec
  is behavior-neutral over the clean tree except that the install no longer
  absorbs the completion rename and tick — the `PLAN transition` commit
  keeps them as the phase's close-out booking, S04-02's demanded shape; that
  finding's remaining ordering half stays step 076 with 0165-072),
  `installRoundBrief` the round's root directory `docs/R-NN` (0115 D3's
  "sweeps the uncommitted round setup" bounded to its object: everything
  `establishRoundSetup` wrote), and `rederiveTail`'s phase-sync commit the
  index plus the drift's tail directories (the removed dirs' deletions and
  the created dirs' seeds staging, the started prefix out by construction).
  Over a clean tree byte-identical (every existing pin green); the person's
  dirt stays for the clean gate — at the G1 stop it joins the person's own
  review commit, on every continuing path preflight refuses it by name. The
  finding's alternative (clarify's D5 discipline before each consumption)
  declined: a second home for the clean gate's judgment (P5). 0099 D4's
  "never a caller's argument" premise restated (INDEX row annotated, the
  GitOps comment with it).
- **0165-187 (S07-05)** — **fixed** under ruling **0207 D2**: every named
  line teaches the recovery that works — adopt's failed-commit line (the
  unit is closed in the worktree; commit by hand, continue with run; no
  re-adopt — the re-run would refuse "already done"), close's (commit by
  hand, or revert and re-run; a same-ref re-run would refuse "already
  closed"), task-add's (the add is complete, no re-run needed — the re-run's
  two dead ends stated), clarify's already-released arm reading whether the
  mark is committed (the kill window between the write and the commit taught
  its one manual commit ahead of the advance whose preflight would refuse
  the uncommitted survey; the committed case byte-identical). The re-run
  refusals detect their own interrupted close-out from disk (the unit's
  `done.md` dirty — P6's re-derivation, never a record) and append the same
  recovery line: plan's `--adopt`/`--export` route over a done unit, and
  close's already-done/already-closed arms. The finding's "better" branch
  (adopt/close re-committing the close-out on re-run) declined on P4/P8
  grounds — the retry re-fails through the same git while appearing to own
  the recovery; the manual commit is the constitution's own channel for a
  failed unified commit, now taught truthfully at every exit.
- **0165-188 (S07-09, DUP)** — **fixed** under ruling **0207 D3** (the
  duplicate was 0102's rendering-dedup family — the continuation's inline
  pair was its one missed member; dispositioned by completing that family
  rather than a new mechanism): the `✓ round … established` / `✓ branch
  isolation` pair extracted into `establishedLines` — `establishStopLines`'
  success arm and transfer's proposal continuation compose through the one
  home, byte-identically; `isolateRound`'s failure arm carries the
  repositories already switched (`switched`), the establishment stop naming
  them on the partial arm ("content-neutral branches; the re-run's
  idempotent skips finish the rest, nothing else was written") with the
  nothing-was-written line kept byte-identical when nothing switched;
  `gateStopLines`' "the approved `## Project brief` section is installed"
  conditioned on `briefProposal(survey)` — the same extraction the install
  itself gates on — a proposal-less survey's release line saying the phase
  completes and nothing installs; the planPrelude row table consciously
  **declined** (P21 — no defect and no consumer locks the shape; the next
  row-affecting ruling names it as the reshape's first candidate).
- **Discovered in-change** (recorded, unacted on): the loop-side brief
  install's pathspec change carries half of 0165-072's remedy ahead of step
  076 (the transition commit restored as the phase's close-out booking) —
  not a new finding, the same seam one home; plan.test's m-mode fixture
  leaves AGENTS.md untracked where the real init's ignore set keeps it
  local, so the m-mode pin asserts it beside the scratch file (the fixture
  difference noted in the test); the survey-gate suite's end-state porcelain
  pins confirmed the transition commit carries the rename/tick the install
  no longer absorbs.

