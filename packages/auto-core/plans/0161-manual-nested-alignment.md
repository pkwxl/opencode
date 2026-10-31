# 0161 — the manual suite's Auto-Nested alignment lines: every commit-making companion teaches the enclosing repository's nested-HEAD trailers

Ruled from field evidence (P19): the aster-mig cleanroom baseline run
(`/workspace/aster-mig-root/cleanroom/baseline`) carries
`Auto-Nested: asterinas @ 82a17cff4` on **every** commit of the enclosing
repository — exec, fix, wrapup and done alike — while the nested repository's
own commits carry the `Auto-Task`/`Auto-Stage` trailers alone. That is
`src/git.ts`'s own grammar (`message()`/`nestedHeads()`, the 0021 D4 commit
boundary): when the repository containing the target directory commits (last,
after every nested repository), it appends one `Auto-Nested: <rel> @ <short
sha>` trailer line per nested repository — the just-landed SHA where that
repository committed this pass, its baseline where it did not — so any commit
of the enclosing repository aligns cross-repository state (the fork command's
reconstruction anchor, `src/fork.ts`'s Auto-Nested alignment lines).

## The measurement

- The manual suite (plans/0078's ratchet domain) taught only
  `Auto-Task`/`Auto-Stage`: every commit-format block in `prompts/` — run.md's
  share/park/fix/phase blocks, run-verify's wrapup/done, run-handover's three,
  the subtask twins' unit-cycle block — omitted the nested lines. A manual run
  over a multi-repo target would land a history the driver's own machinery
  reads incompletely: fork's cross-repository reconstruction anchor absent
  from every commit.
- The grammar cannot be taught once: each companion file is handed to a
  separate session that never sees run.md (the same discipline that gives
  each file its own commit blocks).

## D1 — the grammar in every commit-making companion

One literal everywhere — `Auto-Nested: <nested repository path> @ <its short
HEAD sha>`. The full rule lives at run.md's step 3, the canonical add +
commit pass: this repository's commit — the pass's last — alone carries the
lines, one per nested repository, each read fresh at commit time
(`git -C <path> rev-parse --short HEAD`, the nested repositories' own
commits already landed): a repository that changed this share shows the SHA
just landed, an untouched one its recorded baseline. The lines never ride the
nested repositories' own commits (the two trailers alone), and they ride
every commit the master control lands in this repository — the park commit,
the fix shares, the phase-transfer commits.

The compact form in the four siblings: run-verify.md (the close-out's wrapup
and done commits), run-handover.md (the handover, brief-install and
transition commits, beside its trailers-verbatim line), and the subtask twins
(the unit-cycle block, keeping the changed/baseline clause — their passes
routinely commit the nested repositories).

## D2 — the ratchet arm

The 0078 constitution-ratchet pattern: the src side pins the producer
(`Auto-Nested: ${repo.rel} @ ${repo.sha}` in `src/git.ts` — if the driver's
grammar ever changes, the arm fails first and the prompts follow in the same
change), the prompts side pins the literal in all five files.

Derives: **P13** (frozen additive-only vocabularies — the commit-message
trailer grammar is one vocabulary across the driver and its manual mirror,
carried in one conscious lockstep; the suite's omission was never a second
meaning, and the fix adds no new word), **P5** (single ownership — the
grammar's owning home is `src/git.ts` `message()` alone; the manual suite
holds the mirror, and mirrors are held by ratchets that only fail louder),
**P18** (the record outlives the tool — the Auto-Nested lines are the
machine-addressable cross-repository history plain git carries; a manual
run's history stays uniform with the driver's own, no special tooling needed
to read it).
Tier touched: **prompt copy** — the five commit-making companions + the
ratchet's new arm; no core code changed.

Tests: `test/manual-prompts-ratchet.test.ts` — the Auto-Nested arm (the src
producer literal + the grammar literal in run.md, run-verify.md,
run-handover.md, run-as-subtasks.md, resume-subtasks.md); the suite 24 pass /
0 fail (the standing 23 + 1 new), typecheck clean.
