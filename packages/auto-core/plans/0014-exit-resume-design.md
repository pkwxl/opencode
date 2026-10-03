# /exit Graceful Exit and Resume Design

Status: implemented (2026-09-09).

## 1. Motivation

The `--interactive` resident input line currently treats any non-empty entered line as a user
message bound for the currently active session (steer semantics). During long unattended runs, the human wants a safe way to stop the program — not letting it
run on to the next blocking/completion point, and not a crude kill either (which easily lands in the middle of a tool call, file write,
or unified commit, leaving a dirty scene behind). `/exit` offers a "scheduled" exit: receipt is acknowledged immediately, but the actual
pause is deferred to the next existing safe boundary, after which progress is saved as usual; the next run resumes precisely from the
already-persisted state — fully isomorphic to the recovery path of any real crash/kill interruption, introducing no new
recovery mechanism.

## 2. Trigger

Only the `--interactive` resident input line recognizes it: a line that, after trim, is **exactly equal to** `/exit` (case-
sensitive, no normalization). Recognition happens after the empty-line check and before session forwarding — it is not sent to the session.
In the `pending` state (waiting for an answer to an ask or a step hard-pause) there is no special-casing: input is answered as-is —
/exit promises exit only in the "send a message" context, avoiding ambiguity in the "answering something else" context.
With no active session (`sessionID` not attached) the flag is still set — unlike message forwarding's "drop when no active session"
semantics, /exit's intent has nothing to do with whether a session is attached.

Setting the flag is a one-time, per-process mark with no undo entry: repeated /exit input has no side effects; for a truly immediate force-quit,
a double Ctrl+C (exit code 130) remains the fastest route; the two do not conflict and do not affect each other.

## 3. Hook Points (fully reusing step.ts's three boundary levels)

| Boundary | Location | Timing |
|---|---|---|
| subtask | `src/runner.ts` pipeline subtask loop | after checklist ticking and the unified commit complete, before the next checklist item |
| task | `src/loop.ts` runTaskLoop | after the task's final-state commit, before final-review routing and the next task |
| phase | `src/loop.ts` runPhaseLoop (handoverWithStep) | after the phase handover (archive + ledger + commit) completes, before the next round's routing |

Each of the three sites inserts `maybeExit(boundary, label)` immediately after the existing `stepPause` call — at that point
PLAN.md/CURRENT.md/`.auto/progress.json` are already this boundary's normal wrap-up result,
`maybeExit` merely "stops here early" and does no extra saving. Boundary coverage exactly matches
the boundary cases of plans/0012-step-mode-design.md §5 (--subtask off/ondemand has no subtask
hook point, single-phase `m` mode has no phase hook point, etc.).

## 4. Propagation and Exit Code

When `maybeExit` hits it throws `ExitRequested` (an ordinary exception carrying boundary/label) and does **not**
occupy `Outcome`'s `blocked`/`incomplete` channels — those two channels mean "needs human
intervention" (block reason written to PLAN.md, task reverted to pending); /exit is not that, and re-running needs no human
to fill in any field. The exception propagates up the call stack, skipping `runTask`'s non-completion wrap-up (that logic
exists for genuine blocking/pending: retitling the session to blocked/pending, writing the CURRENT.md interruption
note), avoiding mis-marked state. `src/loop.ts`'s `runAll` catches it uniformly at top level and converts it to exit code `3`
(new, distinct from `2`'s "blocked/pending needs a human"); the existing `finally`'s
`repl?.close()`/`server?.close()`/`unprotect(directory)` still execute as usual.

## 5. Resume

No new recovery path is introduced — the point where the exit happens is itself one of the three existing boundaries, and resume fully reuses
`resume.ts`'s existing semantics (`recallProgress` deciding by active/session liveness whether to reuse the session or open a new
session, re-entering the pipeline precisely by `phase`) — byte-for-byte identical to the recovery path when a real crash/kill happens at that boundary,
see the top comment of `src/resume.ts` and the `runTask` interruption-recovery section.

## 6. Edge Cases

- Non-`--interactive` runs: no resident input line, /exit has no way to trigger, zero behavior.
- Single-phase `m` mode (`--phases` default): no phase boundary; task/subtask boundaries as usual.
- `--subtask off/ondemand`: no subtask boundary; task/phase boundaries as usual — one /exit
  waits at most until the current task completes (matching that mode's `OPENCODE_AUTO_STEP=task` granularity ceiling).
- Coexists independently with step mode (`OPENCODE_AUTO_STEP`): at the same boundary `stepPause` first hard-waits
  for the human's release, then `exitRequested` is checked after release; the order does not affect semantics and both can take effect together.
- `--dryrun`/`init`/`check`/`status` have none of the three hook points and are naturally unaffected (the
  same treatment as step mode).

## 7. Implementation

- `src/exit.ts`:`requestExit`/`exitRequested`/`maybeExit(boundary, label)`/
  `ExitRequested`, a module-level one-time per-process flag (`resetExitRequest` for test resets).
- `src/interactive.ts`: `rl.on("line")` gains a /exit branch (intercepted after the pending and empty-line
  checks, before session forwarding; not forwarded, no attached session required).
- `src/loop.ts`: one `maybeExit` call after each of the task/phase `stepPause` sites;
  `runAll` adds `catch (ExitRequested)` between the top-level `try`/`finally` → log + exit code 3.
- `src/runner.ts`: calls `maybeExit` after the subtask loop's `stepPause`.
- `docs/behavior.md`: the exit-code table gains `3`, and the `--interactive` entry gains /exit behavior.

## 8. Tests

- `test/exit.test.ts`: `maybeExit` hit/miss, `requestExit` idempotence, the exception carrying
  the correct boundary/label.
- `test/interactive.test.ts`: /exit is not sent to the session and sets `exitRequested` (incl. the no-active-
  session scenario); after the flag is set the input line stays usable and later messages forward as usual.

## 9. Out of Scope (deliberately kept simple)

- /exit typed while waiting in an ask/step pause is not special-cased — it still answers per the original semantics. Extending it to "/exit takes priority in any
  scenario" would require doing /exit recognition inside the `pending` branch too and settling
  that wait (`settle(undefined)`); a separate discussion.
- No interaction to "cancel an already-set exit request" is provided; within a single run /exit is one-way.
