# 0181 — The sideband detaches with the dispatch's watch: no free line starts an unwatched turn

Status: **active**. Ruled 2026-11-06 by 0166 step 021 (wave W5-control), enacting 0165-010
(S06-01, S2, CONFIRMED, the ∪1 union — the --interactive sideband never detaches: a free line
typed while no turn runs is promptAsync'd to the last attached session, and both adapters start
a fresh, unwatched agent turn on the idle session).

## Derives

Derives: P20 — no unwatched work beside a dispatch — the direct case: between turns the person
reads the 💬 line as "talk to the running session", but their guidance starts a NEW agent turn
with full tool rights in the working tree that no watch observes — its edits swept into
whichever unit commits next (P4's boundary attributing them to a task whose sessions never made
them, P3's committed-evidence lying), or racing the next session on the same files; during a
hibernate window it spends tokens in the very hours the window exists to avoid; under doc lanes
the line goes to whichever lane attached last. P2 shows in the remedy's own lineage (0014 §2's
rule — input with no active session is discarded — was the designed answer; the sideband
outlived the session it was attached to). P10 in the floor (an attached session's mid-turn
steering unchanged; the no-sideband run unchanged). Tier: operating — P20/P4 statements applied
to the sideband's lifetime; no Tier I statement changes.

premises this ruling changes: 0157's named residual ("probe retargeting, harmless" — the
sideband's attach-only state was the general shape behind it; the detach closes the general
case, the probe-specific half stays S14-06's row, step 027). Re-readings: 0014 §2 stands (its
discard rule becomes the between-turns answer); 0056's steer contract stands (a mid-turn line
to a WATCHED session unchanged); 0069's Interactive sideband shape stands (detach is the
lifetime's missing half).

## Category scope (0123 D1's discipline)

Family: *the control sideband's lifetime*. Home-set: `src/control-types.ts` (the Interactive
type's detach), `src/interactive.ts` (the implementation — the between-turns state clears),
`src/attempt.ts` (the dispatch's finally detaches), the Interactive doubles
(`test/interactive-seam.test.ts`, `test/interactive.test.ts`, `test/session.test.ts`,
`test/blockage-diagnosis.test.ts`, `test/fixtures/turn-trace.ts`), `test/interactive.test.ts`
+ `test/session.test.ts` (the pins). No frozen vocabulary changes: the discard line is 0014
§2's existing wording; detach is an additive member of an internal service type.

## D1 — the sideband's lifetime is the dispatch's watch

`detach()` on the Interactive surface: the session layer calls it when a dispatch's watch ends
(attempt's finally, beside the stats backstop), clearing the sideband's session binding — a
free line between turns then answers 0014 §2's own rule ("no active session, input discarded")
instead of starting a fresh turn no watch observes. The next dispatch's attach re-binds it (the
mid-turn steering path unchanged). The probe-never-attach half of the family stays S14-06's
row (step 027), its general case closed here.

## Residuals

- A queued-note shape (holding the between-turns line as the next dispatch's note) was weighed
  and deferred: no measured demand, and the discard line teaches the rule (P21).
- auto-server's worker-interactive attach (the transport's free-line route) is S30's family
  (step 037) — the core's detach is the contract it will ride.

## Tests

- interactive.test.ts: attach → a mid-turn line sends; detach → the between-turns line sends
  NOTHING (no promptAsync); the next attach re-binds (fail-before: the free line sends).
- session.test.ts: a recording sideband over one attempt — attach at the dispatch, detach in
  the finally (fail-before: no detach call).
