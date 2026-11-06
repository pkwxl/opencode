# Step 023 — w5-lock-carryover-progress

Wave: W5-control. Findings: 0165-090 (S06-06, S3, CONFIRMED — the run lock's liveness reading
assumes one pid space per hostname: the own-pid shortcut steals a sibling container's live
lock, and a reused/foreign-namespace pid keeps a dead lock live forever), 0165-112 (S12-07,
S3, CONFIRMED — beginUnit's carryover classifies driver-state paths by pattern alone, sweeping
a person's content edit of a todo.md into a carryover commit), 0165-113 (S12-08, S3,
CONFIRMED — the progress record is written in place, the one driver recovery file without the
.tmp → rename discipline), 0165-114 (S12-09, S3, CONFIRMED — 0145's adoption swallows 0155
D1's unreadable-HEAD line: a corrupt-root baseline is "adopted" and the unit runs toward a
commit that cannot land), 0165-115 (S12-10, S3, CONFIRMED — the 0149 run-start line promises
"the resumed unit's close commits them" while a strict-resume rollback stashes them). Started
2026-11-06 at HEAD `12ce72c25`.

## Scope

The recovery-posture control family: the run lock's process identity (lock.ts), the carryover
admission shapes over the driver-state paths (git.ts beginUnit — with the runtime-record
distinction 0170 D4(a) named as this step's), the progress/handover records' atomic writes
(resume.ts, handover.ts — S12-08's family member), the recovery ladder's typed baseline
problems and its stop verdict over unreadable roots (git.ts baselineIntact, resume-gate.ts,
runner.ts, artifact.ts), and the run-start exemption line's conditional truth
(loop-preflight.ts, driver-helper.ts row 11). Out of family: the lane orphan probe's bare
pidAlive (S05-04 = 0165-081, step 050), the commit-provenance guard's cross-task shapes
(0169 D4's follow-up class), close.ts/clarify.ts's visible folds (named in the ruling).

## Design ruling

Ruling **0183** ([0183-lock-carryover-baseline.md](../0183-lock-carryover-baseline.md)) — see
its decision blocks D1–D5 for the full statements.

## Implementation order (the recovery map)

1. `src/resume.ts` (saveProgress atomic write) + `src/handover.ts` (saveHandover atomic
   write) — D2.
2. `src/git.ts` — `driverStateLeftovers` (the carryover shape check) wired into beginUnit
   (D1); `baselineIntact` typed problems (D3).
3. `src/resume-gate.ts` (the stop verdict) + `src/runner.ts` + `src/artifact.ts` (the
   blocked wiring) — D3.
4. `src/lock.ts` — the ns/start identity fields, the stale() identity rule, the
   namespace-aware refusal line (D4).
5. `src/loop-preflight.ts` (the exemption line) + `src/driver-helper.ts` (row 11) — D5.
6. Tests: git/resume/handover/resume-gate/lock/loop-preflight/driver-helper; fail-before
   runs; full suite + typecheck both packages; ruling + INDEX row + AGENTS.md navigation;
   bookkeeping; commit.

## Execution log

- 2026-11-06: step opened after step 022's commit (12ce72c25); the register rows, the S06/S12
  step-file evidence, 0170 D4(a)/0171 D8's named residuals and all five code homes read.
- 2026-11-06: D2 landed (saveProgress/saveHandover .tmp → rename); D1 landed
  (personDirtOverStatePaths + beginUnit's admission branch); D3 landed (typed baselineIntact +
  the stop verdict + both callers); D4 landed (the lock's ns/start identity); D5 landed (the two
  lines). The full suite surfaced two integration findings the unit tests could not see: (a) the
  doc-lane park flow hung order-dependently — saveProgress's first form shared one tmp name
  across concurrent pipelines and the loser's rename threw, wedging the drain (fixed by the
  per-write ordinal; 10/10 green after, 2/3 hangs before — the caught-by-the-suite shape is
  named in 0183 D2); (b) the shape check initially bypassed the GitOps seam, breaking the
  doc-lane delegation tests and the artifact leftover scene — the member joined the seam
  (`reads`'s Pick, the three implementers, the fake), and artifact's scene re-shaped from the
  old over-trust (an untracked brand-new phases.md healed) to the driver's real leftover (a
  committed index + its tick) per the ruling.

## Verification

- `bun typecheck` exit 0 in packages/auto-core and packages/auto.
- auto-core full suite: **3009 pass, 0 fail** (153 files; 2996 at step 022's close — the 13
  new pins plus the baselineIntact oracles).
- Fail-before: `git stash push -- src/` → exactly the 17 new/updated pins red on the pre-change
  sources across the seven touched suites (4 lock — the identity recorded, the foreign-ns lock
  live with its refusal line, the reused-pid start-time read, the status line; 4 carryover
  shapes — the content edit, the runtime-entry rename, the edited rename, the retitle; 3
  baselineIntact typed oracles + the rewound-HEAD one; the ladder stop; the two atomic pins;
  the exemption line; row 11); the "runtime record that no longer names the unit admits the
  pair" pin green both ways by design (the conservation half). `git stash pop` restored.
- The park-flow hang: 0/6 timeouts on pre-change src, 2/3 before the ordinal fix, 10/10 after.
- family-check exit 0 (its range 0124–0163; 0183 carries its Category scope by construction);
  probe P1/P2/P4 clean, P3/P5/P6/P7 the standing baselines (step 006's placeholders, step
  069/072's rows).
- packages/auto suite: 149 pass, 8 skip, 5 fail — the same pre-existing fork/remove-fork
  baseline proven at step 014 (step 031's wave); typecheck clean.

## Close-out

Step done 2026-11-06. Ruling **0183** active-authority; the INDEX row, the AGENTS.md navigation
lines (the run lock's identity, the commit-boundary carryover clause, the recovery-gate list),
the 0145/0149 amendment annotations, ledger rows 0165-090/112/113/114/115 and the program's
status/current-position land in the same commit. Residuals (0183's list): the driver's own
rename-before-updateTask kill window now blocks (conservative; recovery through the 0149
exemption); the hand tick rides as the redundant view; the cross-task shapes stay the
commit-provenance guard's family (0169 D4's follow-up class); no boot_id (cross-boot start
collisions resolve live); the lane orphan probe's bare pidAlive stays 0165-081 (step 050).
