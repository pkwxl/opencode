# Step 006 — redtests-phased-p1

Program 0240, wave red-tests · status: **done** 2026-11-10 (opened at HEAD
`15061be59` — step 005's commit; worked, verified and committed in one
session, branch `auto-core`). Authority: ruling
[0241](../0241-redtests-root-causes.md) **D2** (finding 2, coverage item 1) —
the wave's ruling, already written and landed by step 002; this step is
enactment only, no new ruling number.

## Scope

The phased-P1 walkthrough in `packages/auto/test/e2e.test.ts` (:1894,
"roadmap-driven establishment, the round-brief proposal channel, and the
amend --phases coverage refusal") gains the person's commit at the taught
channel — a `commitFixture(dir)` after the stub transfer (the person's
review-and-commit of init's config layer and the opened analysis stub) and
before the released analysis's re-run, placed ahead of the released
`docs/analysis.md` write so the released document stays uncommitted by hand
and rides the brief-install commit as its evidence (0207 D1's
uncommitted-hand-release arm — 0241 D2's recommended placement, both proven
at the CLI level by step 002). The product stands (0207 D1's scoped
release-consumption commits, the review stop's start-clean gate): no
auto-core source changes. Fail-before is the standing red (confirmed the
sole failure in step 005's verification run of the packages/auto suite).

## Session log

- 2026-11-10 (this worker): step opened at HEAD `15061be59` (verified
  `git log -1 --format=%h`, tree clean, branch `auto-core`). Program and
  ruling 0241 read (D2's disposition and the Category-scope row naming this
  file); step marked `doing`, this record created.
- 2026-11-10 (fail-before at this HEAD): the focused walkthrough
  (`bun test test/e2e.test.ts -t "roadmap-driven establishment"`)
  **0 pass / 1 fail** — red at `expect(established.code).toBe(0)`: the
  released analysis's re-run exits **2** (the start-clean gate naming
  init's never-committed config layer — the exact standing red of 0241
  finding 2, unchanged from step 002's reproduction and step 005's
  verification run).
- 2026-11-10 (the edit): `await commitFixture(dir)` inserted after the stub
  transfer's expects and before the released-analysis write, with the
  comment teaching both halves — the person's review-and-commit between the
  gated commands (the release consumptions' 0207 D1 pathspecs never absorb
  the person's dirt; without this step the start-clean gate names the files
  and stops exit 2) and the released analysis deliberately left
  uncommitted below (it rides the brief-install commit as its evidence —
  0207 D1's uncommitted-hand-release arm).
- 2026-11-10 (green at the fix): the same focused run **1 pass / 0 fail**
  (20 expects) — the sourced establishment line, the verbatim round-brief
  install and the review stop all reached.

## Verification

- `packages/auto` full suite (`bun test`): **179 pass / 8 skip / 0 fail** —
  the six-name baseline fully cleared: step 005's five fork-family fixes
  plus this step's walkthrough. 2795 expects, 187 tests across 4 files.
  (0241 D6's retirement of the standing-failures baseline is now measured
  fact for this package; step 008's split does not change the count.)
- `packages/auto` typecheck (`tsgo --noEmit`, the touched shell): exit 0.
- `packages/auto-core` `bun typecheck`: exit 0; full suite **3319 pass /
  0 fail** (the recorded baseline) — no core source changed, the tree-state
  check.
- No auto-core src/ or template/ path touched (`git status` names only the
  three step paths at commit time); 0207 D1's scoped commits and the
  start-clean gate stand untouched.

## Dispositions

- **Coverage item 1 (auto phased-P1 e2e)** — FIXED by this step (0241 D2):
  the walkthrough's person-commit step added at the taught channel; the
  product's scoped release-consumption commits and the start-clean gate
  stand; the test green at the fix, fail-before the standing red
  re-confirmed at this step's HEAD. With this, `packages/auto`'s half of
  the six-name baseline is fully gone — the remaining red-tests steps are
  007 (the server mirror) and 008 (the timing split), next in the
  program's sequence.

Committed as `0240: step 006 done — …` over the step's three paths (the
program document, this record, the test file); the commit's SHA lands as
the next step's start HEAD when that step opens (the program's start-HEAD
chain, the 0166 convention).
