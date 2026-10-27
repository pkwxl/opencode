# 0142 — the unservable test request: consumed and surfaced, never left as wiring; a fix round never books a wait

The maintainer's field report (2026-10-27, over the `dm-glm-auto-analysis-done` project, mid-run):
*gap.md is there. but, a re run skip it.* — with the re-run's log: T-058 ("Crypto Tier-1 throughput
spike", phase R-01.P02 **design**) blocked previously, resuming directly, re-entering the wrap-up as
"re-verification after fix round 2 of 2", dispatching the verify session — the gap list on disk never
acted on. The person Ctrl+C'd the third such re-verification.

## The measurement (live probes over the project and its logs)

- Git holds **no `T-058 fix 2` commit**, yet the progress record says `{kind: wrapup, round: 2}` and
  every later run re-enters as "re-verification after fix round 2 of 2". Three `T-058 wrapup` commits
  carry three FAIL gap lists (00:04, 00:11, 00:16 on 10-27; a fourth at 18:57 after the person's
  hand-fix and re-run). No `⚙ … test script exit code` line exists in **any** of the project's run
  logs — the driver has never executed a single test there.
- The overnight run's log shows fix round 2's session in full: it read the gap list, found
  `tmp/test.sh` already wired, ended its turn with "**[DRIVER] request: please run `tmp/test.sh`
  now**" — 51.5 s, zero changes, session ended. The driver treated that as a natural finish: no
  commit (clean tree), `bookAttempt` (attempts → 5), **round 2 booked as spent**. The re-verify then
  FAILed ("nothing changed since the round-2 gaps") and the budget-spent block fired. Two person
  re-runs later the cycle holds: re-verify → FAIL → the same block teaching `close` / `force-close` /
  hand-listed fix tasks — none of which names the actual blocker.
- Why no test ever ran: the run is in phase P02-design; the `--test-by-driver` channel's derived
  condition is `testByDriver && codeWork(phase)` (0083 D9) and `design` carries no `codeWork` — so
  `runExecSession`'s entry degenerates to a plain `runSession` (src/exec-session.ts:74): **no TestRun
  context, no marker watching, no execution** — for the exec session, the fix rounds, every session
  of the phase. The fix prompt's `test-protocol` partial is equally derived out
  (src/prompt.ts:1065 keys the render fact on `codeWork`), so no driver prompt taught the protocol.
- What *did* teach it: the task's own document — `docs/T-058/todo.md` step (3), driver-formulated by
  the P02 planning session: "run it via the driver test protocol (`tmp/test.sh` → container run)" —
  and the verify session's gap list repeating it ("hand it to the DRIVER through the driver test
  protocol; the session itself must never run the container directly", with the marker verified in
  the "Verified OK" section as "exactly right; keep it"). The AGENTS block's TEST_PRINCIPLE scopes
  itself by the words "in implementation and testing tasks" — read by the planner as task-kind words
  (this task "implements deps and runs a bench"), not as the phase-type boundary it names. The run
  banner (shell `logRunBanner`) prints the protocol line from the config flag alone, unscoped.
- The marker itself — `tmp/test.sh`, content `bash test/in_container.sh test/dm_crypto_spike.sh`,
  mtime 10-27 00:06 — is **still on disk**, surviving as false wiring through every later session
  (the 18:5x verify session again "left it intact for the fix session").

The defect, one sentence: a session's test request against the phase-gated-off channel is silently
dropped — 0083 D9 ruled the *stray* marker "inert by design", but a marker left by a session
obeying the task document's own instruction is a deliberate request, and its silent drop burnt a
fix round on a 51-second wait, left false wiring for every later session, and produced a block
whose three remedies never name the dead channel — the person's re-run can therefore never
progress, which is exactly what was reported.

## D1 — the unservable request is consumed and surfaced at every scope's close

New in src/testrun.ts (the marker protocol's own home): `testChannelOffFor(opts)` — the channel's
derived condition negated, `dryrun` excluded (the floor) — and `consumeDeadTestMarker(dir, opts,
label)`: when the channel is off for the session's phase (`testByDriver` on but the phase not
code-work, **or** `testByDriver` off outright — in both worlds nothing will ever serve the marker)
and `tmp/test.sh` exists, the marker is deleted and a `⚠` log line names the drop (which side is
off, that the request was not executed, and that a leftover would read as wiring for later
sessions). Consuming is the doc-lane refusal's own precedent (0126 D3: an unservable request is
consumed and refused, never left to confuse the next session) and amends 0083 D9's housekeeping
ruling — "inert" was measured too optimistic: the marker sat through five sessions as
verified-OK wiring.

Three call sites, one helper:

- **execution scopes** (src/exec-session.ts, the degenerate branch): after `runSession` returns,
  for `execute` / `subtask` units — consume + log, nothing else. The unit's wrap-up remains the
  judge (the exec session may have done real work; the verify FAIL on "zero runs" is honest, and
  the fix round's D2 block is the surface that teaches).
- **the fix round** (src/wrapup.ts `runFixRound`, below) — the block's own detection.
- **the wrap-up's entry** (src/wrapup.ts `runWrapup`, each loop iteration before the lane gate):
  consume + log, so a verify session never again reads a dead marker as wiring — this is also the
  standing-project shape (a resume straight into wrap-up with the marker already on disk).

## D2 — a fix round never books a wait on a channel that will not serve it

In `runFixRound`, after the round's sessions finish naturally and the round's commit lands
(`afterSession`, stage `execute` — partial hybrid work is committed, never stranded behind the next
run's clean gate), before `bookAttempt`: `consumeDeadTestMarker` fired → return a **blocked**
`UnitStop` (the run stops for the person, exit 2), the round **not booked** — the round-opening
persist (which ran before the round's sessions, D7's "counts once it opens") is rewound to the
roundless wrap-up stage, so a re-run re-opens the same round fresh rather than counting it spent,
and `bookAttempt` never runs. This
is the hidden-blockage family's own caliber (the shape gates block a session whose stated
instrument failed; here the session's stated instrument — the driver run — cannot exist), and it
amends 0083 D7's booking rule with a narrow exception: *a round counts once it opens **and its
sessions closed without an unservable request pending*** — the incident's round 2 was a pure wait;
booking it spent the person's budget on the driver's own gap. The D7 rationale (never re-run a
spent round) is untouched: no round is re-run; an unbooked round re-opens fresh.

The block's message names the mechanical fact and teaches the three real exits: the request came
from the task document's or the gap list's own instruction (both name `tmp/test.sh`); in a phase
without the channel a session runs such a check **itself in-session** (within the task's rules), or
the task belongs in a code-work phase, or the person runs the command by hand — adjust the task's
step (and the gap entry), then re-run; any work the round's sessions completed is already
committed.

## D3 — the teaching says which phases the channel serves

- **TEST_PRINCIPLE** (src/agents-block.ts): "in implementation and testing tasks" — task-kind words
  the planner measurably read as task descriptions — becomes the phase-type boundary it names:
  the channel serves the **code-work phases** (the implement and test types, a custom type
  declaring `Code-work: yes`); and the other side gains its rule: in any other phase no driver-run
  channel exists — a task there that needs such a run has its session do it in-session, never
  through `tmp/test.sh`. The block re-renders from the config at every run start, so standing
  projects heal on their next run.
- **The run banner** (shell `logRunBanner`): the driver-tests line gains the scope clause "(the
  channel serves code-work phases)" — the person reading the banner of a design-phase run no longer
  holds a protocol the phase will not run.

## D4 — scope, floors, residuals

- The channel's derivation itself (0083 D9: `testByDriver && codeWork(phase)`) is **unchanged**.
  The measured consumer on the other side of it — a spike task in a design phase needing a long
  driver-run execution, structural for this project family (the spike plan's §5 ordering puts Tier
  1 before the P02 freeze) — is recorded here as the reopen trigger: if the in-session run proves
  impractical in the field (the 1.5 h container case), the next report reopens the derivation.
- Floors (P10): `dryrun` never consumes; a code-work phase under `testByDriver` keeps the live
  channel byte-identical (the marker is settled inside the session by the engine's test concern,
  exactly as today); with no marker on disk every path is a no-op — the existing suite pins the
  unchanged behavior. The consume/block only ever fires on a marker that no machinery would serve,
  which is itself the anomaly (a ruled defect fix, never masked by a floor).
- The standing T-058: its round 2 was booked by the old code and stands (history); with this
  change the next re-run consumes the stale marker at the wrap-up entry (logged) and the budget
  block still requires a person act — `close` / `force-close` / a hand run of
  `bash test/in_container.sh test/dm_crypto_spike.sh` before closing. Reported to the maintainer
  with this change.

This ruling Derives: **P12** (fail loud, conservative under uncertainty — the showing: the dropped
request was invisible at every layer, and the marker survived as false wiring; now the drop is
consumed with its `⚠` line and the wait blocks instead of booking), **P8** (deliberate enforcement
moments, every surfaced line teaches its remedy — the showing: the budget-spent block taught three
remedies none of which named the dead channel; the new block names the fact and the three real
exits, and the banner and TEST_PRINCIPLE now teach both sides of the boundary), **P2** (the person
brackets every boundary — the showing: the fix budget is the person's resource; the driver's own
channel gap must not consume it silently, and the unbooked round keeps the decision with the
person), **P10** (the byte-identical floor — the showing in D4), **P19** (measured evidence — the
probes above: the git timeline, the absent `⚙` lines, the 51.5 s session, the marker's survival,
the planner's misread source). Amends: 0083 **D9**'s housekeeping ruling (a stray marker in a
gated-off session is no longer inert — consumed and surfaced) and **D7**'s booking rule (the
unservable-wait exception, D2). Tier touched: **mechanism** — core (`src/testrun.ts`,
`src/exec-session.ts`, `src/wrapup.ts`, `src/agents-block.ts`) and the shell banner line, with the
AGENTS-block ratchet and the verify-loop suite re-pinned in the same change.

Tests: test/verify-loop.test.ts's unservable-request describe (the design-phase fix round that
leaves `tmp/test.sh` → blocked with the teaching, the round unbooked — attempts and the progress
round unchanged, the marker consumed; the config-off variant of the same block; the exec-scope
session's marker consumed with the run proceeding; the wrap-up entry consuming a pre-planted
marker), the constitution ratchet's TEST_PRINCIPLE pin re-pinned to the phase-type wording, and
the no-marker floor carried by the existing suite.
