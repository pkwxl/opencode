# 0119 — The destination scan reads git's modified view: the whole-tree form retired

Ruled from the cleanroom OOM (2026-10-24). `opencode-auto driver-helper` on a
phased project whose destinations are kernel-sized checkouts — a pristine
upstream `linux` tree, a one-person-commit `vethx` on top of one — died with
`Out of memory` at the complete-round stop: the round-close containment scan
(0108's whole-tree form) diffed every nested repository against the empty
tree, materializing every line of every tracked file — hundreds of millions
of lines the migration had never written — as one in-memory diff string. The
maintainer ruled the general model, verbatim: *We should not check the full
tree, instead, check those that has been modified which can be shown via
git.*

This ruling Derives: **P1** (the deliverable stands alone — the ledger and
the gate answer the project's own references alone: the scan's subject is
what the migration wrote into the destination, and a destination's
pre-existing content — upstream or hand-made — was never the project's
writing to answer for; 0108's whole-tree form was reading, and recording as
containment debt, lines P1 never scoped the project to write), **P4**
(committing is the completion condition — the criterion for "driver commit"
is the system's own machine line, the `Auto-Stage` trailer the unified
commit writes: what the project wrote is what its own commits say it
wrote), **P6** (derived state — the baseline is derived from git alone at
every scan, nothing persisted, every scan re-deriving from the
repositories' own history), and **P8** (deliberate enforcement moments —
the moment split stands undisturbed: the round keeps its recording-only
count, release keeps the blocking form; only the set both read narrows).
Tier touched: **mechanism only** — `git.ts driverBaseline`, the two scan
call sites and their tests; no principle change (0108's destination scoping
stands, its every-tracked-line derivation retired); the INDEX release cell
stays open until the next release event.

## The ruling and its lineage

0108 completed 0103's line by scoping the scan to the destination
repositories alone — the deliverable is what a nested repository's git
manages. But 0108's derivation of *which lines* to read was the empty
baseline: every tracked line counts as "added", untracked files whole. On a
destination the migration actually writes, that price is the project's own
content and buys the ledger. On a destination the migration only *reads* —
the cleanroom's upstream kernel checkout — it reads a tree the project never
touched, twice over: the OOM's cost, and a semantic misattribution (an
upstream file that happens to carry a `T-NNN`-shaped string was being
recorded as the migration's containment debt).

0119 keeps 0108's destination scoping and re-derives the content set from
git: **the scan's subject is the repository's modified view — the run of
driver commits back from HEAD, plus the uncommitted and untracked state.**
The criterion for "driver commit" is the system's own machine line, the
`Auto-Stage` trailer (`foreignCommits`, `baselineIntact`, `land`'s
foreign-commit refusal already key on it): what the project wrote is what
its own commits say it wrote. A destination's pre-existing content — the
person's history, upstream or hand-made — was never the migration's to
answer for.

## D1 — `driverBaseline`: the SHA the scan diffs from

`git.ts driverBaseline(root)` walks HEAD's log as a stream
(`git log -z --format="%H %B"`), kills git at the first commit without the
trailer, and returns that commit's SHA as the exclusive baseline:

- HEAD itself foreign (the pristine-checkout and person-on-top shapes) →
  HEAD: the tracked side contributes nothing, and the scan reduces to
  `git status`'s own view — uncommitted changes and untracked files;
- every commit a driver commit, or a repository with none → the empty
  baseline (the whole history is the project's writing; `unitAddedLines`'s
  existing `sha || EMPTY_TREE` form);
- driver commits buried under a person's later commits sit outside the
  contiguous run and stay unscanned — the same linear-range simplification
  `foreignCommits` and `land`'s foreign-commit refusal already make. The
  person's commits are the person's content, never the migration's ledger.

The callers keep `unitAddedLines` unchanged: the baseline..worktree diff
covers the committed run plus uncommitted edits, the untracked walk covers
the rest — a real SHA where 0108's call sites passed `""`.

## D2 — both gates, one set

The round-close ledger (`round-close.ts`) and the release enforcement
(`release.ts`) scan the same driver-written set — the ledger the person
reads each round, the gate the person answers at ship, no divergence
between record and enforcement. Release's clean-tree check (check 1) means
its scan is the committed run alone there. One deliberate consequence,
recorded not hidden: `land`'s landing commit deliberately carries no
Auto-Stage trailer (0074 §2 — the deliverable's own history entry, the
person's to curate), so a post-landing release of an isolated repository
finds an empty run and certifies — consistent with that ruling's division:
the driven root's git keeps the per-unit trail, the deliverable's history
is the person's own.

## D3 — the memory shape

The OOM was allocation, not patience: the whole-tree form's cost is one
buffer per repository proportional to its entire tracked content. The
modified view's cost is proportional to what the project wrote — the log
walk stops at the first foreign commit (a pristine checkout stops at HEAD),
the diff is the project's own output, and no tree the project never touched
is ever materialized.

## Homes

`src/git.ts` (`driverBaseline`), `src/round-close.ts`, `src/release.ts`;
pinned by `test/document-roles.test.ts` (driverBaseline, the unitAddedLines
composition), `test/round-gates.test.ts` (the ledger's set and the
pristine-checkout shape), `test/release.test.ts` (the gate's set, the
person-content boundary), `test/driver-helper.test.ts` (the brief's held
close over a driver-written finding).
