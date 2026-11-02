# 0164 — the manual suite's vintage pin and agent-channel seams: prompts/MANIFEST, the --check drift gate, the stale-lock diagnosis, the stop-after segment, the report-file fallback

Ruled from field evidence (P19): the aster-mig cleanroom's first two
manual-driver arms (2026-11-02). The claude arm
(`forks/baseline-init-std-claude`) is the suite's existence proof — from the
ten files alone, a claude session executed the whole survey phase
(T-002…T-006, the concurrent enumeration pair as a `parallel:` wave, every
share/wrapup/done commit in full trailer grammar) in ~90 minutes, a history
indistinguishable in shape from a driver run. The qoder arm
(`forks/baseline-init-std-qoder`) measured the seams. The person's
instruction the same day: the arms' coding agents work from the prompts, not
from the driver — make that channel smooth.

## The measurement

- **Vintage drift was invisible.** The qoder arm's suite was an October-30
  hand-copied vintage predating 0161 — no `Auto-Nested` lines, its
  regression-receipt commit landed without them — and nothing on disk said
  which suite revision an arm runs. `install-prompts` (0093) rewrote files
  but recorded nothing; the two arms even disagreed on whether `prompts/`
  is tracked content.
- **A stale run lock stopped every hand-run with no diagnosis.** The qoder
  arm's `.auto/run.lock` names a `transfer` run dead since 2026-10-31; the
  suite's preflight item 2 stops on the lock's existence — correct, the
  mutual-exclusion rule — but the session could not tell the person whether
  a driver was live or the lock was carrion, or whose act clearing it is.
- **The existence-proof run needed one mid-run protocol edit.** A Claude
  Code subagent refuses the file-write tool for files named `report.md`; the
  arm's run-verify.md gained a hand-patched fallback (write it through a
  shell heredoc) under run.md's one sanctioned exception. A host-shaped fact
  generalized fine — but it lived as a patch, not as suite copy.
- **The driver's segmentation had no manual twin.** `run --stop-after
  T-NNN` (one task per segment, chained on completion) is the playbook's
  per-task rhythm; the hand-over line's phrases shaped waves, modes and
  phase flow, but never a run's end.

## D1 — the vintage pin (prompts/MANIFEST)

`installPrompts` writes `prompts/MANIFEST` after the copy pass: every suite
file's `sha256-…` digest plus a suite-level digest over the registry-ordered
`name  digest` pairs, and a generator line. The manifest is installer
output, never a suite file — it does not enter `SUITE`, never counts as
written or unchanged, and is excluded from the extras report (the guard
test's registry-vs-directory arm is untouched: the source `prompts/`
directory stays the ten files). An arm commits the manifest alone and its
vintage is provable from the target — no 150KB of suite bytes to track
(P18). The pin derives fresh from the embedded registry on every call, so
the same suite always pins the same digest and a differing one always
differs (P5: the registry is the pin's single owner; a manifest is derived,
never authored).

## D2 — the read-only drift gate (`install-prompts --check`)

`checkPrompts` answers the question the pin enables, writing nothing: the
same per-file comparisons against this binary's embedded suite (`drifted`,
`missing`), the manifest's state against the suite it should pin
(`current` / `missing` / `stale`), extras reported and never drift. The CLI
exits 0 clean and 1 on any drift — the scripted preflight an operator runs
before handing a target to a manual-driver session. A true boolean read
(0159): `--check=false` is the explicit opt-out and runs the resync.
`install-prompts` leaves the flagless family for the models shape — exactly
one option, an `OWNED_FLAGS` row so no other command accepts `--check`, and
the refusal line naming the whole surface.

## D3 — the preflight reads the lock (stale diagnosed, the person clears)

run.md's preflight item 2 now teaches the diagnosis: read the lock's `pid`,
`command` and `started` fields — a pid that no longer answers a `kill -0`
probe marks the lock stale, its run having died without the cleanup. Stale
or live, clearing it stays the person's alone: the session reports which it
found with the lock's own facts and stops, never deleting or editing
anything under `.auto/` — the mutual-exclusion rule of 0093 D3 unchanged,
the report now naming the remedy's owner.

## D4 — the `stop-after: T-NNN` hand-over phrase (the one-task segment)

The driver's `--stop-after` gains its manual twin as a fourth hand-over-line
phrase (beside `phases: all` and `parallel: <n>`): the loop's pick ends the
run the moment the named task is done — its `done.md` present, a `Closed:`
field counting alike — or parked (the park a legal boundary, landed before
the Finish). The phrase bounds the run's end, never its order; a named task
already done at the start means the segment is spent before it began —
Finish, saying so. It never rides `parallel: <n>` (one task's bound cannot
gate a concurrent shape — the driver's own `--stop-after` refusal), and it
bounds one segment only: the report names it spent, and the restart repeats
nothing of it (P13: the driver's own flag name, one vocabulary).

## D5 — the report-file fallback folded upstream

run-verify.md's wrap-up-report paragraph gains the claude arm's hand patch
verbatim: the report is the session's own required deliverable, authorized
by the person — not a findings summary to return as text — and when the
host refuses the file-write tool for it (a subagent report-file guard), it
is written through a shell heredoc instead, never skipped. The one mid-run
protocol edit the existence-proof run needed becomes suite copy; run.md's
sanctioned exception retires for this shape.

Derives: **P19** (field evidence — both arms, 2026-11-02), **P13** (frozen
additive-only vocabularies — `stop-after` mirrors the driver's own flag; the
fallback adds no word, it generalizes one host's fact), **P18** (the record
outlives the tool — the manifest proves vintage from the target alone),
**P5** (single ownership — the registry owns the pin; manifests are
derived, never authored).
Tier touched: **prompt copy** (run.md, run-verify.md) + the installer and
the CLI shell (one flag, one emitted file, no lock, no git); no core loop
code.

Tests: `test/install-prompts.test.ts` grown to eleven — the manifest's
determinism and extras exclusion, `checkPrompts` clean / drifted / missing
/ stale / never-installed, both formatters — and the auto e2e
install-prompts row grown with the `--check` exit pair, the drift wording,
the option refusal and the owned-flag line.
