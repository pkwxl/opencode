# Step 022 — w5-sleeps-signals

Wave: W5-control. Findings: 0165-087 (S06-02, S3, CONFIRMED — the hibernate window and the
window wait sleep their full length past a requested /exit), 0165-088 (S06-03, S3, CONFIRMED —
/exit typed while a line is pending is consumed as the answer), 0165-091 (S06-07, S3,
CONFIRMED — no SIGTERM/SIGHUP handler anywhere), 0165-092 (S06-08, S3, CONFIRMED — the
startup hibernate sleeps before runAll installs its SIGINT handler, after preflight protected
the files). Started 2026-11-06 at HEAD `37dd96db0`.

## Scope

The run's planned waits and process signals: bookedSleep's control form shared by both
planned sleeps, the boundary probes after the window, the hard wait's /exit, the
SIGTERM/SIGHUP handlers, the SIGINT-before-startup ordering, the exit-code line and the
shell README's force-quit note. auto-server's own supervisor signal handling stays
S29/S30's family.

## Design ruling

Ruling **0182** ([0182-sleeps-signals.md](../0182-sleeps-signals.md)): D1 the planned sleeps
wake on /exit (bookedSleep through the control's sleepUnlessExit; the three boundary sites
probe after the window as before it; waitForWindow pauses at the cut in awaitRecovery's own
shape); D2 the content-free hard wait recognizes /exit (request set, pause settled empty)
while an ask keeps every line as its answer, one hint naming where a "/exit" went — 0014 §9
amended for the hard-wait shape; D3 SIGTERM/SIGHUP routed through the double-Ctrl+C
force-terminate body with the conventional 143/129 codes (P13's additive growth), removed in
the finally beside SIGINT; D4 onSigint installed before the startup hibernate. Derives P2
with P20/P8; premises — 0057 §11 item 9's named residual closed (extended to BOTH planned
waits), 0014 §9 amended; 0027's hibernate design and 0057 §6's awaitRecovery shape stand.

## Implementation order (the recovery map)

1. `src/hibernate.ts` (bookedSleep's control + paused return; hibernatePause's cut-short).
2. `src/session.ts` (waitForWindow), `src/loop-phase.ts`, `src/loop-task.ts`, `src/runner.ts`
   (the post-window probes).
3. `src/interactive.ts` (the pending branch), `src/step.ts` (the prompt).
4. `src/loop.ts` (forceTerminate, the two handlers, the ordering, the finally's removal).
5. AGENTS.md (the exit-code line) + the shell README (the force-quit note); the three test
   files; fail-before; suites; bookkeeping; commit.

## Execution log

- 2026-11-06: step opened after step 021's commit (37dd96db0) in the same worker stretch;
  the surfaces read (the S06 step file's evidence, the register rows). Implementation landed
  per the map and the ruling written — the session ended before the suite ran; the step
  record, the INDEX row and the program metadata were left for the recovery.
- 2026-11-06 (recovery): the tree verified against the map — every planned edit present.
  The full suite surfaced one miss the landing missed: agent-fake's suspend oracle
  (§10 item 6) built its seven-hour overshoot into the hand-built clock's `sleep`, which the
  window wait no longer consumes since D1 — the wait runs through the clock's
  `sleepUnlessExit`. The oracle re-pointed (the overshoot rides sleepUnlessExit, the comment
  naming 0182 D1); the file's 130 tests green.

## Verification

- `bun typecheck` clean in packages/auto-core and packages/auto.
- auto-core full suite: **2996 pass, 0 fail** (153 files; 2993 at step 021's close — the
  three new pins plus the re-pointed suspend oracle).
- Fail-before: `git stash push -- src/hibernate.ts src/interactive.ts src/step.ts` → exactly
  the three pins red on the pre-change code (the hibernate sleep running its full injected
  length past a requested exit; the old pause prompt; "/exit" settling as the wait's
  answer); `git stash pop` restored everything. The ask pin passes both ways by design —
  it is the conservation half of D2.
- packages/auto suite: 149 pass, 8 skip, 5 fail — the same pre-existing fork/remove-fork
  baseline proven at step 014 (step 031's wave); the README touch changes nothing.

## Close-out

Step done 2026-11-06. Ruling 0182 active-authority; the INDEX row, the AGENTS.md exit-code
line, ledger rows 0165-087/088/091/092 and the program's status/current-position land in the
same commit. Residuals: the signal handlers carry no unit pin (process signals are not
testable in-process without machinery no measured demand justifies — they ride the SIGINT
path's own standing, and the finally's removal is the suite-visible half); auto-server's
supervisor paths are S29/S30's family.
