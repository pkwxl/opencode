# 0182 — The planned sleeps wake on /exit, the pause recognizes /exit, and the force-terminate path answers the supervisor's signals

Status: **active**. Ruled 2026-11-06 by 0166 step 022 (wave W5-control), enacting 0165-087
(S06-02, S3, CONFIRMED — the hibernate window and the window wait sleep their full length past
a requested /exit), 0165-088 (S06-03, S3, CONFIRMED — /exit typed while a line is pending is
consumed as the answer), 0165-091 (S06-07, S3, CONFIRMED — no SIGTERM/SIGHUP handler anywhere)
and 0165-092 (S06-08, S3, CONFIRMED — the startup hibernate sleeps before runAll installs its
SIGINT handler, after preflight protected the files).

## Derives

Derives: P2 — the person's stop is honored at the next safe boundary, and every escalation
bounded — the spine of all four: a multi-hour planned sleep that ignores the requested exit
defers the person's stop by hours; a hard wait that consumes "/exit" as its content answer
spends the stop word on nothing; an unhandled SIGTERM ends the run with none of the
force-terminate path's cleanup (the server left running, protected files left read-only —
P20's mirror at the process edge); a Ctrl+C during the startup window finding no handler is the
same hole one boundary earlier. P20 shows in the wake mechanics (the sleeps run through the
control's /exit-wakeable form; nothing in flight is destroyed — the boundary probe takes the
exit); P8 in the teaching (the step-pause prompt names the stop; the ask's "/exit" hint says
where the line went). Tier: operating — P2 statements applied to the wait and signal surfaces;
no Tier I statement changes.

premises this ruling changes: 0057 §11 item 9's named residual (the planned sleeps and /exit —
closed: bookedSleep runs through the control, one ruling extending the item to BOTH planned
waits); 0014 §9 (amended for the hard-wait shape: the content-free pause recognizes /exit —
requestExit, settle empty; an ask keeps every line as its answer, one hint naming where a
"/exit" went); the exit-code vocabulary grows 143/129 (P13's additive lockstep: SIGTERM/SIGHUP
through the force-terminate body with the conventional 128+signal codes, named beside 130 in
AGENTS.md's list). Re-readings: 0027's hibernate design stands (the window itself unchanged —
only its wake); 0057 §6's awaitRecovery shape stands (the pattern the other waits now share);
the lock header's "SIGKILL skips every cleanup" widens to every unhandled signal (the README's
double-Ctrl+C note gains the SIGTERM line — the shell README touched in the same change).

## Category scope (0123 D1's discipline)

Family: *the run's planned waits and process signals*. Home-set: `src/hibernate.ts`
(bookedSleep's control and paused answer; hibernatePause's cut-short return),
`src/session.ts` (waitForWindow's control + pauseForExit), `src/loop-phase.ts`,
`src/runner.ts`, `src/loop-task.ts` (the boundary sites' post-hibernate probe),
`src/interactive.ts` (the pending branch), `src/step.ts` (the pause prompt),
`src/loop.ts` (the SIGTERM/SIGHUP handlers; onSigint before the startup window; the finally's
removal of all three), `AGENTS.md` (the exit-code line), the auto README's force-quit note,
`test/hibernate.test.ts`, `test/interactive.test.ts`, `test/step.test.ts`. No frozen
vocabulary retired: the exit codes GROW additively (143/129); the pause prompt's wording is a
teaching line, not a protocol literal.

## D1 — the planned sleeps wake on /exit

bookedSleep takes the run's control and sleeps through sleepUnlessExit (the clock's
/exit-wakeable form), answering whether /exit cut it; hibernatePause passes the control
through and returns at the cut without its "over" line; the three boundary sites probe
maybeExit after the window (the same checkpoint they run before it — the lane's own probe
shape preserved in taskBoundary); waitForWindow runs through the control and pauses at the cut
(awaitRecovery's own shape, the injected form delegating to the run's clock so a fake clock
still advances the wait in tests). The startup sleep stays plain (no sideband exists to
request an exit).

## D2 — the hard wait recognizes /exit; the ask teaches where its lines go

Inside the pending branch: a step-pause wait (no timeout armed) recognizes "/exit" — the
request is set, the pause settles empty, the boundary's probe takes the exit; an ask (a
timeout armed) keeps every line as its answer, one hint line saying a "/exit" went to the
agent, not the run. The step-pause prompt names the stop ("press Enter to continue, /exit to
stop here").

## D3 — SIGTERM and SIGHUP run the force-terminate body

loop.ts routes both signals through the double-Ctrl+C path's body (server close, unprotect,
exit) with the conventional codes (143/129), removed in the finally beside SIGINT — a plain
`kill`, a `timeout` wrapper or a supervisor's stop now cleans up instead of leaving the
server running and the protected files read-only. The lock header's "SIGKILL skips every
cleanup" widens to every unhandled signal; the shell README's force-quit note names SIGTERM.

## D4 — the SIGINT handler precedes the startup window

onSigint is installed before the startup hibernatePause (its body already tolerates
server === undefined): one Ctrl+C during the multi-hour startup window finds the handler, and
the window's own "press Ctrl+C twice" line holds everywhere it prints.

## Residuals

- The signal handlers carry no unit pin (process signals are not testable in-process without
  machinery no measured demand justifies — the shapes ride the SIGINT path's own standing,
  and the handlers' removal in the finally is the suite-visible half).
- auto-server's supervisor paths (its own signal handling) are S29/S30's family.

## Tests

- hibernate.test.ts: the control path — an already-requested exit answers paused at once (the
  injected sleep never runs), the window returning without its "over" line (fail-before: the
  sleep runs its full injected length and the over line prints).
- interactive.test.ts: the hard wait's /exit settles empty with the exit requested and nothing
  sent (fail-before: "/exit" resolves as the answer); the ask's /exit stays the answer.
- step.test.ts: the pause prompt's oracle updated to the teaching wording.
