# Step 003 — shell-refresh-survey

Program 0240, wave shell-refresh · status: **done** 2026-11-10 (started from
HEAD `2ecaa0a16` — step 008's commit; worked, verified and committed in one
session, branch `auto-core`). Authority: [0241](../0241-redtests-root-causes.md)
**D5** (the wave's standing disposition — no new ruling; this step's product is
measurement and program bookkeeping only).

## Scope

The branch census: every non-auto-core branch (local and `origin/*` — the
program names translate, quota, migrate-hw, dev, "and any other"), each
measured for last-commit date, merge-base against `auto-core`, shell-package
presence, and membership in docs/shell-contract.md §D's frozen list
(`auto`, `migrate` — never merge targets). For each candidate shell branch:
whether it has EVER modified `packages/auto-core` (its diff against the merge
base must be confined to shell-owned files — a violation would be recorded as
a blocker for the maintainer, not merged). The confirmed merge-target list
recorded in the program BEFORE any merge; one merge step appended per
confirmed target. No merge performed in this step; no branch checked out
(all measurements over refs — `git log`/`ls-tree`/`diff`/`merge-base`; the
working tree never left `auto-core`).

## Session log

- 2026-11-10 (this worker): step opened at HEAD `2ecaa0a16` (verified
  `git log -1 --format=%h`, tree clean, branch `auto-core`, no `doing` step,
  steps 005–008 all done — the red-tests wave complete per the table). Program,
  step 001's record (the survey's recorded design: the branch roles "measured,
  not assumed"), step 002's record (form) and docs/shell-contract.md §D read.
  Step marked `doing`, this record created.
- 2026-11-10 (census): every ref under `refs/heads` and `refs/remotes`
  enumerated (`git for-each-ref`) — no branch exists beyond the seven measured
  below (plus `refs/remotes/origin/HEAD → origin/dev`). All measurements over
  refs; no checkout, no merge, no fetch. The results are in the Census
  section; the decision in the Decision section. `origin/auto-core` measured
  at the v0.4.0 cut `7a3f018f8` (2026-11-09) — the maintainer's push of the
  cut happened; the six program commits since (001–008) remain local.

## Census (measured 2026-11-10, auto-core at `2ecaa0a16`)

"Ahead" = the branch's own commits beyond its merge-base with auto-core;
auto-core sits 773/800/688/686/374/487/227 commits beyond the respective
bases (every branch's base is inside auto-core's history — the fork descends
from `origin/dev`, which is itself fully contained).

| Branch | Last commit | Merge-base w/ auto-core | Ahead | Shell package carried | Frozen list | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `origin/auto` | `b8cf8eb18` 2026-08-26 | its own tip (fully contained) | 0 | none — the pre-split monolith (carries `packages/auto`, no `packages/auto-core`) | **frozen** (contract §D) | never a target; also nothing to merge |
| `origin/dev` | `941e71dbb` 2026-08-10 | its own tip (fully contained) | 0 | none — the upstream opencode monorepo line (the fork point; carries neither `auto` nor `auto-core`) | not on it | fully contained — nothing to merge |
| `origin/migrate` | `e4cf244a5` 2026-09-10 ("Merge branch 'auto-core' into migrate") | `2f2b20a09` 2026-09-10 01:51 UTC | 43 | `packages/auto-migrate` (the simple shell) | **frozen** (contract §D) | never a target |
| `origin/migrate-hw` | `32630280b` 2026-09-12 ("Merge branch 'fix/core-timeout-retry' into migrate") | `cc0bba0fd` 2026-09-12 14:36 UTC (the fix branch's tip, inside auto-core's history) | 44 (= migrate's 43 + the one merge commit) | `packages/auto-migrate` (inherited from migrate) | not on it | **not a registered live shell branch** — see Decision |
| `origin/quota` | `3f714b1e6` 2026-10-01 ("plans 0068: intra-run parallel execution design — lanes …") | its own tip (fully contained) | 0 | none beyond the auto-core set (an old core-development branch — plan 0068's design line; carries `packages/auto-core` itself) | not on it | fully contained — nothing to merge |
| `origin/translate` | `4cd64a365` 2026-09-26 ("auto: refresh the agent contract … retire PLAN.md") | its own tip (fully contained) | 0 | none beyond the auto-core set (old `packages/auto` work) | not on it | fully contained — nothing to merge |
| `local-src/auto-core` | `47bd607c7` 2026-10-23 (the 0105 era) | its own tip (fully contained) | 0 | — | — | not a non-auto-core branch: a stale fetch of `auto-core` itself from the maintainer's other checkout (`/home/wxl/workspace/aseo/opencode`, remote `local-src`) — excluded by name, recorded for completeness |

The auto-core-confinement probe (a shell branch must never have modified
`packages/auto-core` — the diff against the merge base must be confined to
shell-owned files):

- `origin/migrate`, diff `2f2b20a09…e4cf244a5`: exactly **13 paths, 2567
  insertions, 0 deletions** — 11 under `packages/auto-migrate/`
  (AGENTS.md, docs/specialized-tool-design.md, package.json, script/build.ts,
  src/index.ts, src/templates.d.ts, src/templates/tool-state-recovery.md,
  src/tool.ts, test/e2e.test.ts, test/tool.test.ts, tsconfig.json) plus
  `.opencode/tool/github-triage.ts.bak` and `bun.lock`. **Zero paths under
  `packages/auto-core`** — no contract violation.
- `origin/migrate-hw`, diff `cc0bba0fd…32630280b`: the same 13-path shape,
  **zero paths under `packages/auto-core`**. The tip is one merge commit with
  parents (`e4cf244a5` = migrate's tip, `cc0bba0fd` = the auto-core-side fix
  `fix/core-timeout-retry`); `2f2b20a09` is an ancestor of `cc0bba0fd`, so
  the merge cleanly advanced the line's core snapshot to the fix — the shell
  divergence is exactly migrate's own work. No contract violation.
- The fully-contained branches (`auto`, `dev`, `quota`, `translate`): their
  tips ARE their merge bases — no diff exists to confine; nothing to merge.

## Decision — the confirmed merge-target list

**Empty. Zero merge steps appended; table numbers 009 upward stay free.**
The contract's rules decide it (docs/shell-contract.md §D, the branch table —
per its own AUTO-DECISION (T-098) "this contract's own registry of the shells
that exist" — the authority for what counts as a live shell branch):

1. The only branches diverging from auto-core at all are `migrate` (43) and
   `migrate-hw` (44) — both of the `auto-migrate` line.
2. `migrate` is on the contract's frozen list — never a merge target.
3. `migrate-hw` has no row in the branch table: it is not a shell branch
   started per the onboarding checklist, but the maintainer's own 2026-09-12
   derivative of the frozen line (migrate + one merge of the
   `fix/core-timeout-retry` hotfix, both predating the 2026-09-22 freeze).
   By the table's authority it is not a live shell branch → not a merge
   target. Its measured existence and clean confinement are recorded here
   and in the program's observations; refreshing, registering or retiring it
   is the maintainer's act (naming it appends a step).
4. `auto`, `dev`, `quota` and `translate` are fully contained in auto-core —
   there is no divergence to merge, whatever their role.
5. The shells that actually evolve (`packages/auto`, `packages/auto-server`)
   live on `auto-core` itself — no snapshot refresh exists to perform.

Consequence: the shell-refresh wave (coverage item 6) completes at this step —
every branch on the confirmed (empty) list merged (vacuously), the frozen
branches untouched (verified above by measurement, no step touched them), the
census recorded in the program before any merge (there is no merge). 0241 D5's
enactment ("rows 003 and the merge steps it appends") discharges at the survey
itself: the survey appended zero merge rows, and D5 left the count to the
survey. Coverage item 6's disposition moves to **completed by step 003** with
this named reason — no item disappears silently.

## Verification

- The step's product is measurement and program bookkeeping: no code, test or
  runtime-documentation home changed (`git status` names only the two plans/
  paths at commit time). `bun typecheck` exit 0 (the tree-state check — the
  program's own rule for this step: "no suite should need re-running"; nothing
  this step changed could move any recorded number).
- The census itself is the affected-packages verification: no merge was
  performed, no branch checked out, the working tree stayed on `auto-core`
  clean throughout; the frozen branches' refs measured at their recorded tips
  (`e4cf244a5`, `b8cf8eb18`) — untouched.
- Every number above is a measured `git` output reproduced in this session;
  the ancestry claims verified (`git merge-base --is-ancestor`:
  `2f2b20a09` ⊂ `cc0bba0fd`; `e4cf244a5` a tip-parent of `32630280b`).

## Dispositions

- **Confirmed merge-target list (authoritative for any future merge step)**:
  **empty** — recorded in the program before any merge. A branch not on it is
  not merged (the protocol's own rule); with the list empty, the
  shell-snapshot merge steps number zero.
- **Coverage item 6 (the shell-snapshot refresh)** — completed by this step:
  the census recorded, the frozen branches untouched, zero live shell
  branches exist to refresh (the evolving shells live on auto-core). 0241 D5
  discharged.
- **Recorded, not scheduled**: `origin/migrate-hw` (the unregistered frozen
  line derivative — clean, hotfixed 2026-09-12, predating the freeze) in the
  program's observations; the maintainer opts in by naming it, which appends
  a step. `local-src/auto-core` (the stale same-name fetch) noted in the
  census only.

Committed as `0240: step 003 done — …` over the step's two paths (the program
document and this record); the commit's SHA lands as the next step's start
HEAD when it opens (the program's start-HEAD chain, the 0166 convention).
