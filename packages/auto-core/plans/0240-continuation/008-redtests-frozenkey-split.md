# Step 008 — redtests-frozenkey-split

Program 0240, wave red-tests · status: **done** 2026-11-10 (opened at HEAD
`7edd3fbda` — step 007's commit; worked, verified and committed in one
session, branch `auto-core`). Authority:
ruling [0241](../0241-redtests-root-causes.md) **D4** (finding 4, coverage
item 5) — the wave's ruling, already written and landed by step 002; this
step is enactment only, no new ruling number.

## Scope

The frozen-key e2e case in `packages/auto/test/e2e.test.ts` (:710, "run
refuses options frozen by init (exit code 1 + revision hints)" — one test
over ~25 CLI spawns: the 16-entry frozen loop + 9 individual arms, measured
3056–3060 ms at step 002's HEAD on this host, 4143.79 ms on 0166 step 073's
host) splits per family in 0224 D4's standing form (the server's own
frozen-key case, split into five family tests by 0233 D2, is the precedent
shape): the frozen-constitutional loop, the --phases remedy arm, the paired
revision hints, the short-form arm, the retirement arms, the rename arms,
the loneliness arm — each family its own test on its own fresh dir, every
row and assertion retained verbatim (coverage identical), the spawn count
per test bounded so none rides past the family guideline (each test under
roughly half bun's 5 s per-test default; the census's largest standing
family ~2 s). This discharges 0233 D3's deferral at its named home. A
timing/structure change only — no behavior change: the product (the frozen
-key refusal and every hint it prints) stands untouched; no src path
changes. Fail-before is the timing census re-measured at this step's HEAD
(the monolith past the guideline); the verification is each split piece
under the guideline plus coverage-identical checks (every family/arm still
asserted).

## Session log

- 2026-11-10 (this worker): step opened at HEAD `7edd3fbda` (verified
  `git log -1 --format=%h`, tree clean, branch `auto-core`). Program,
  ruling 0241 (D4's disposition and the Category-scope row naming this
  file's :710), 0224 D4 (the standing split rule), 0233 D3 (the deferral
  this step discharges) and the server precedent (`packages/auto-server/
  test/worker.test.ts`'s five family tests, 0233 D2's enactment) read.
  Step marked `doing`, this record created. Next: the fail-before census
  at this HEAD.
- 2026-11-10 (fail-before census at this HEAD): the monolith's focused
  run (`bun test test/e2e.test.ts -t "run refuses options frozen by init"`)
  **3.39 s / 3.36 s** (two consecutive runs; bun's file timer and the wall
  clock agree) — past the guideline on this host, consistent with step
  002's census (3056–3060 ms) and past it on step 073's host (4143.79 ms,
  its measurement). The structural proof, step 073's method: the monolith
  deterministically **red at 2500.10 ms** under `--timeout 2500` (the
  guideline bound, roughly half bun's 5 s per-test default) — 70 of its
  81 expects reached before bun's kill; the runtime rides the row count.
- 2026-11-10 (the edit): the single test replaced by the describe-level
  rule comment + **seven family tests** (0241 D4's named families, the
  server form): the 16-spawn frozen-constitutional loop (64 expects),
  the --phases remedy arm (4), the paired revision hints (2), the
  short-form arm (1), the retirement arms (5), the rename arms (3), the
  loneliness arm (2) — every flag row and assertion verbatim from the
  monolith, each family on its own fresh dir. **Coverage identical**:
  25 spawns (16+1+2+1+2+2+1) and **81 expects** (64+4+2+1+5+3+2), both
  exactly the monolith's counts.
- 2026-11-10 (per-piece census, each family focused under
  `--timeout 2500` — green under the bound IS the structural proof):
  the frozen loop **2.12 s** file time (own runtime ≈ 1.9 s after the
  ~0.2 s loader floor the single-spawn runs show: 235–239 ms), the
  six arm families **235–360 ms** each. All seven green, none past the
  2500 ms bound — the monolith's 3.4 s → largest piece 2.12 s file
  time. Next: the full-suite and typecheck verification.

## Verification

- **Fail-before (the census at this HEAD, before the edit)**: the monolith
  3.39 s / 3.36 s focused (two consecutive runs), structurally red at
  **2500.10 ms** under `--timeout 2500` — the guideline bound (roughly
  half bun's 5 s per-test default). Past the guideline on both measured
  hosts (3056–3060 ms at step 002's HEAD here; 4143.79 ms on step 073's
  host).
- **Each split piece under the guideline**: all seven family tests run
  focused under `--timeout 2500`, all green — the largest (the 16-spawn
  frozen loop) **2.12 s** file time (own runtime ≈ 1.9–2.0 s after the
  ~0.12 s loader floor the 235–239 ms single-spawn focused runs show);
  the six arm families **235–360 ms** each. Projection on step 073's
  host at its measured 0.173 s/spawn: the loop ≈ 2.77 s — 55% of the 5 s
  default, the corpus's own standing largest-family scale (0233 D2 ruled
  its "≈ 2.7 s at the S00 scale" family inside 0224 D4's guideline; the
  standing 12-spawn options family projects the same there). A host
  slower than both measured ones re-measures the census per 0241's named
  residual; the describe's rule comment carries the standing split-again
  law for that day.
- **Coverage identical (mechanically)**: the split's row/assertion lines
  diffed against the monolith's (`git show HEAD:…` lines 710–782 vs the
  new block) — **every flag row, spawn line and assertion byte-identical**
  (47/47 lines); the only diff lines are the seven per-family fresh-dir
  mkdtemp lines replacing the monolith's one. Counts: 25 spawns
  (16+1+2+1+2+2+1) and **81 expects** (64+4+2+1+5+3+2), both exactly the
  monolith's; the full-suite expect total grew by the suite's baseline
  remainder untouched. Every original row comment retained (the 0096
  D10 execution-tier note in the loop, the 0193 D2/0165-056 phases
  teaching, both pair-hint notes, the --commit retirement rationale, the
  --commit-subtask note; three arms' comments became their tests' names
  verbatim).
- `packages/auto` typecheck (`bun x tsgo --noEmit`, the touched shell):
  exit 0. Full suite: **185 pass / 8 skip / 0 fail** (193 tests, 4 files,
  2795 expects, 128.81 s) — exactly the predicted post-split count
  (step 006's 179/8/0 minus the monolith plus the seven family tests),
  the six-name baseline stays fully cleared (0 fail).
- `packages/auto`'s frozen-key families in-suite: the full run above
  carries all seven green under bun's 5 s default with every other test.
- `auto-core` `bun typecheck`: exit 0; full suite **3319 pass / 0 fail**
  (the recorded baseline) — no core source changed, the tree-state check.
- No auto-core src/ or template/ path touched (`git status` names only
  the three step paths at commit time); the product's frozen-key
  refusals and every hint they print stand untouched.

## Dispositions

- **Coverage item 5 (the D3 timing observation)** — FIXED by this step
  (0241 D4): the frozen-key e2e case split per family in 0224 D4's
  standing form (the server's own frozen-key case the precedent), rows
  verbatim, coverage identical, every piece under the guideline on both
  measured hosts; **0233 D3's deferral discharged at its named home**
  (this wave). The split chosen over acceptance, the reason on record
  (past the guideline on both measured hosts — 3.4 s here, 4.14 s on
  step 073's host, against the ~2.5 s bound).
- With this the red-tests wave's enactment steps (005–008) are all done:
  coverage items 1–5 closed; item 6 (the shell-snapshot refresh) stays
  scheduled as rows 003 + the merge steps it appends — the next step in
  table order.

Committed as `0240: step 008 done — …` over the step's three paths (the
program document, this record, the test file); the commit's SHA lands as
the next step's start HEAD when that step opens (the program's start-HEAD
chain, the 0166 convention).
