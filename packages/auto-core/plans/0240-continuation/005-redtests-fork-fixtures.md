# Step 005 — redtests-fork-fixtures

Program 0240, wave red-tests · status: **done** 2026-11-10 (opened at HEAD
`b0c1b232c` — step 002's commit; worked, verified and committed in one
session, branch `auto-core`). Authority: ruling
[0241](../0241-redtests-root-causes.md) **D1** (finding 1, coverage items 2
and 3) — the wave's ruling, already written and landed by step 002; this step
is enactment only, no new ruling number.

## Scope

The two `taskProject` helpers in `packages/auto/test/e2e.test.ts` (the fork
describe's, :3867, and the remove-fork describe's, :3992) lockstep their
driver-style task commits to the driver's real trailer grammar — the trailers
as ONE `-m` paragraph (`Auto-Task: <id>\nAuto-Stage: execute`), the one shape
`message()` (auto-core `src/git.ts:52`) writes and 0173 D2's `trailerBlock`
read (the Auto-Task key from the body's LAST paragraph, `src/git.ts:2257`)
consumes. The fork helper's stale belief comment ("the trailer block git's
-m paragraphs produce matches the scan's line grammar" — false since 0173:
git joins `-m` flags into SEPARATE paragraphs, putting Auto-Task in its own
paragraph, never the last) is restated to the real grammar. The reader stands
(P13): no auto-core source changes. Fail-before is the five standing reds
(reproduced and dated by step 002; re-confirmed at this step's HEAD below).

## Session log

- 2026-11-10 (this worker): step opened at HEAD `b0c1b232c` (verified
  `git log -1 --format=%h`, tree clean, branch `auto-core`). Program and
  ruling 0241 read (D1's disposition and the Category-scope row naming this
  file); step marked `doing`, this record created.
- 2026-11-10 (fail-before at this HEAD): the fork describe
  (`bun test test/e2e.test.ts -t "CLI: fork"`) **4 pass / 2 fail** —
  "fork runs beside a live run lock" and "the task form's happy path" both
  red at `fork` exit 1 (0 expected); the remove-fork describe
  (`-t "CLI: remove-fork"`) **2 pass / 3 fail** — the teardown happy path,
  uncommitted-work-blocks and live-run-refuses all red at their first
  `fork` exit 1. The exact five standing reds of step 002's reproduction,
  at this step's HEAD, unchanged.
- 2026-11-10 (the edit): both helpers' trailer commit changed from three
  `-m` flags to two — `"${id} implement"` then ONE trailer paragraph
  `` `Auto-Task: ${id}\nAuto-Stage: execute` `` — and the fork helper's
  comment restated to the real grammar (the trailers as ONE -m paragraph,
  0173 D2's last-paragraph read named; the stale "matches the scan's line
  grammar" belief gone). The remove-fork helper's comment ("the fork
  describe's fixture shape") stays — accurate now as before. Body shape
  verified byte-level in a scratch repo: `git commit -m <subject> -m
  <trailers>` produces exactly `message()`'s output (subject, blank line,
  the trailer paragraph) — `cat -A` shows `T-001 implement$ / $ /
  Auto-Task: T-001$ / Auto-Stage: execute$`.
- 2026-11-10 (green at the fix): the same two focused runs — fork describe
  **6 pass / 0 fail** (57 expects), remove-fork describe **5 pass / 0
  fail** (55 expects).

## Verification

- `packages/auto` full suite (`bun test`): **178 pass / 8 skip / 1 fail** —
  the six-name baseline dropped to the one expected red: the phased-P1
  walkthrough (step 006's fix, 0241 D2). The five fork-family failures are
  gone. 2779 expects, 187 tests across 4 files.
- `packages/auto` `tsgo --noEmit` (the touched shell): exit 0.
- `packages/auto-core` `bun typecheck`: exit 0; full suite **3319 pass /
  0 fail** (the recorded baseline) — no core source changed, the tree-state
  check.
- No auto-core src/ or template/ path touched (`git status` names only the
  two step paths + the fixture file at commit time); the reader 0173 D2
  stands untouched.

## Dispositions

- **Coverage items 2 and 3 (fork ×2, remove-fork ×3)** — FIXED by this step
  (0241 D1): the fixtures lockstepped to the writer's one-paragraph trailer
  shape; the reader's grammar stands; the five tests green at the fix,
  fail-before the standing reds re-confirmed at this step's HEAD.
- The expected remaining red in `packages/auto` is the phased-P1 walkthrough
  alone — step 006's (0241 D2), next in the program's sequence.

