# Step 002 — redtests-investigate

Program 0240, wave red-tests · status: **done** 2026-11-10 (started from
HEAD `857ce0b18` — step 001's commit; worked, verified and committed in one
session, branch `auto-core`). Ruling: [0241](../0241-redtests-root-causes.md).

## Scope

Coverage items 1–5 (the six standing auto e2e failures, the auto-server
planPrelude drift, the D3 timing observation): reproduce every failure at
HEAD, root-cause each, write ruling **0241** (the wave's ruling — Derives/
Amends + Category scope per family), disposition every coverage item (fix
or consciously ruled retirement with a named reason), and append the
enactment steps to the program's table.

## Session log

- 2026-11-10 (this worker): step opened at HEAD `857ce0b18` (verified
  `git log -1 --format=%h`, tree clean, branch `auto-core`). Program and
  step 001's record read; the 0166 baseline-establishing records read
  (steps 050/067/069/073/077/079 — the six auto failures and the one
  server drift each named pre-existing, by name). Step marked `doing`,
  this record created.
- 2026-11-10 (reproduction): `packages/auto` full suite **173 pass /
  8 skip / 6 fail** — the exact v0.4.0-cut baseline, the six by name (the
  phased-P1 e2e; fork "runs beside a live run lock" + "the task form's
  happy path"; remove-fork teardown-happy-path + uncommitted-work-blocks +
  live-run-refuses). `packages/auto-server` full suite **176 pass /
  2 fail** on this host: the known planPrelude boundary matrix drift by
  name, plus "an IPv6 bind writes a bracketed transport URL (0165-169)" —
  measured host-environment (this host's loopback carries no IPv6 address
  at all; `EADDRNOTAVAIL` on `::1`, reproduced by a minimal
  `Bun.serve({hostname: "::1"})`; the recorded 177/1 baseline was measured
  on an IPv6-capable host) — recorded in the program's observations, not a
  coverage item. The frozen-key timing case re-measured **3056–3060 ms**
  (two consecutive runs).
- 2026-11-10 (root-causing, each cause measured and — for the three
  behavior flips — proven by a one-line mechanism probe on HEAD's own
  source, each probe restored and cmp-verified byte-identical):
  1. **Fork family ×5**: fork exits 1, "no commit … carries the trailer
     Auto-Task: T-00N". Cause: 0173 D2 (0166 step 013) changed
     `taskFirstCommit` (src/git.ts:2257) to read Auto-Task from the body's
     LAST paragraph only; the two e2e `taskProject` helpers
     (packages/auto/test/e2e.test.ts:3875, :4000) commit with three `-m`
     flags — git's paragraph join puts Auto-Task in its own paragraph, a
     shape `message()` (git.ts:52) never writes. Probe: only 0173's read
     line reverted → "fork runs beside a live run lock" 1/1 green, the
     remove-fork describe 5/5 green. Dating: no auto-suite run recorded
     between 0166 steps 013 and 029; step 029 first records the 5 as
     "pre-existing".
  2. **Phased-P1**: transfer #2 exits 2 — the establishment, brief install
     and round-start commits all succeed, then the start-clean gate
     (loop-preflight.ts:725) lists exactly init's never-committed config
     layer (`.gitignore`, `.opencode/agent/auto.md`,
     `.opencode/auto/config.json`, `opencode.json`; CLI reproduction
     captured verbatim). Cause: 0207 D1 (0166 step 047) scoped the
     brief-install commit to `[BRIEF_FILE, source]` (brief.ts:170) — the
     walkthrough rode the pre-0207 pathspec-less commit that folded the
     person's dirt (the exact defect 0165-013 ruled). Probes: dropping only
     the pathspec → the walkthrough 1/1 green; the CLI-level converse —
     the config layer committed at the taught channel → transfer exits 0
     printing every line the test expects (the sourced establishment line,
     the verbatim round-brief install, "review stop: the formulation
     todo"). Dating: step 046's close recorded auto 160/8/5 (this test
     green); step 050 first records 159/8/6.
  3. **Server planPrelude**: row 3 (the drift re-sync) gets 409 where the
     test expects 200 "re-synced" — the body measured verbatim: "the phase
     index of round R-01 differs from the roadmap of docs/analysis.md:
     transfer re-derives the unstarted tail on its own commit — run:
     opencode-auto-server transfer <dir>". Cause: 0206 D2 (0166 step 046)
     retired plan's re-sync apply and lockstepped packages/auto's e2e drift
     describe (the diff is the form) but missed packages/auto-server's
     ops.test.ts mirror row (:628–:644, its comment still teaching the
     apply). Category greps: no other `-m`-paragraphed Auto-Task fixture
     exists (the two helpers alone); no other server test carries the
     retired re-sync expectation.
  4. **Timing**: the frozen-key case is ~25 spawns in one test
     (16-entry loop + 9 arms), 3.06 s at HEAD here / 4.14 s on step 073's
     host — past the family guideline on both. 0224 D4's split form (the
     server's own frozen-key case) is the standing precedent; 0233 D3's
     deferral named this wave as the disposition's home.
- 2026-11-10 (ruling and program): ruling **0241** written (Derives
  P19/P13/P10/P12/P18, Amends none, Tier tests, Category scope a 10-row
  home-set table, premise guard with six re-reads, named residuals
  carrying the 0166 process gap and the IPv6 host finding). The program's
  table gained rows 005–008 (one per fix family, inserted between the
  survey and the final audit, the note updated); the coverage list's every
  item dispositioned; the observations list gained the IPv6 and
  process-gap rows; the next free ruling number moved to 0242; INDEX row
  0241 landed.

## Verification

- The step's product is the ruling and the program's bookkeeping: no code,
  test or runtime-documentation home changed (`git status` names only
  plans/ files at commit time). `bun typecheck` exit 0 (the tree state
  check).
- The investigation's own measurements stand as the affected packages'
  verification: `packages/auto` **173/8/6** — the exact recorded baseline,
  the six failures by name, every root cause above measured against them;
  `packages/auto-server` **176/2** on this host — the recorded drift by
  name plus the measured host-IPv6 failure (the observation row explains
  the 177/1-vs-176/2 difference honestly; nothing this step changed could
  move either number).
- The three mechanism probes each restored and **cmp-verified
  byte-identical** (src/git.ts ×2, src/brief.ts ×1; the ops.test.ts probe
  likewise); `git diff` clean over src/ and the shell packages before the
  commit.
- The fail-before proofs for steps 005–007 are the standing reds
  themselves (measured here, by name); step 008's is the timing census
  (measured here on this host, step 073's on its own).

## Dispositions

- **Coverage item 1 (phased-P1)** — fixed by step 006 (0241 D2): the
  product stands (0207 D1's scoped commits, the start-clean gate); the
  test's person-commit step at the taught channel is the fix.
- **Coverage items 2–3 (fork ×2, remove-fork ×3)** — fixed by step 005
  (0241 D1): the reader's grammar stands (0173 D2, P13); the two
  `taskProject` helpers lockstep to the writer's one-paragraph trailer
  shape.
- **Coverage item 4 (server planPrelude)** — fixed by step 007 (0241 D3):
  0206 D2's category completeness completed late; the server row locksteps
  to the refusal shape.
- **Coverage item 5 (D3 timing)** — fixed by step 008 (0241 D4): the split
  (0224 D4's form) chosen over acceptance — 0233 D3's deferral discharged;
  the reason recorded (past the guideline on both measured hosts).
- **Coverage item 6 (shell refresh)** — stays scheduled (0241 D5): rows
  003+ are its enactment; the fixes land first by step 001's design.
- **D6**: the "seven standing failures" baseline count retires — after
  steps 005–008 the shells sit at 0 fail, the final audit's very check.
- **Recorded, not scheduled**: the IPv6 host finding and the 0166 process
  gap (the program's observations list; 0241's named residuals).

Committed as `0240: step 002 done — ruling 0241 …` over the step's four
paths (the program document, its INDEX row, this record, the ruling); the
commit's SHA lands as step 005's start HEAD when that step opens (the
program's start-HEAD chain, the 0166 convention).
