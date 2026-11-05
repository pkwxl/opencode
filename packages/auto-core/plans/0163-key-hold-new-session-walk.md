# 0163 — the key hold and the new-session walk: every key failure carries a duration, every new session tries the keys in order

The maintainer's field report (2026-11-01, the aster-mig cleanroom fork `baseline-init-std`): a run that hit
the provider's 5-hour token limit on key 1 rotated to key 2 at 07:28 UTC and then burned key 2 for the rest
of the run — key 1's window reset hours before the run ended, and no retry ever happened. The expectation,
restated in the follow-up: *"my retry means a new session try the keys"* — the original ask of 0144's design
conversation (*"when creating each new session, attempts … should always be made in sequential order"*,
quoted in 0144's own measurement), which 0144 had narrowed to a failure-triggered search with the named
residual *"while a later key works, a recovered earlier key waits for the next rotation."* The ruling that
closes the gap: *"We can change the flag to a small timeout flag, a quota limit let the key is 5 min
unusable, so every new session 5 min later may do a retry on the key."*

## The measurement (what the field case shows, and what it rules against)

- The run rotated once at 07:28 UTC (quota restricted; key 1 marked down; the fork re-dispatch succeeded on
  key 2) and then had **no failure of any kind** for the remaining 5.5 hours (four tasks, clean sessions) —
  so 0144 D2's order-first search, which lives only on the escalation's failure path, never ran again, and
  key 1 — recovered hours earlier — was never retried. Not a misclassification: the one failure was treated
  as quota exactly as designed.
- The provider's 5h-limit error **states no machine-readable reset** (`.auto/windows.json` is empty across
  every run of the project — no window was ever learned), so key 1 carried a one-shot skip flag, not an
  `until` mark: the driver held no instant to wait for and no trigger to re-check the key.
- The three walls 0144 measured against the per-new-session proposal still stand, and the hold answers each
  at the grain the field case demands. The **restart cost** (the key is a property of the managed server) is
  bounded by the hold: a restart happens only when an earlier key's mark actually passed, at most once per
  hold per key — never once per session. The **fork oscillation** cannot happen: the fork a rotation just
  seeds walks at its own session start and lands on the held key the rotation moved to (the fresh mark skips
  the failed key), so the walk never ping-pongs. The **re-bought failure** is bounded to one probe per five
  minutes per spent key — small against the 30–90-minute sessions the same run log shows (T-047 1h28m,
  T-048 1h12m, T-049 1h17m, T-050 57m).
- 0144's own objection to driver-invented durations — "a key never parks on a driver-invented schedule" —
  is answered by size and source: five minutes is the person's ruled constant, not a scope-boundary guess,
  and it is the floor on responsiveness, not a park. The worst case it produces is one failed dispatch per
  new session per five minutes while a key stays spent.

## D1 — one mark shape: every key failure carries a duration

`markKeyDown(provider, key, until)` — `until` now **required**; the one-shot skip flag and its consumption
machinery dissolve (`keySkips`, `RingRotation.passed`, commitRotation's clearing loop,
`extendKeyDownMark`'s flag-upgrade branch). The caller states the duration: a stated reset to its instant
(unchanged — provider-stated evidence, never preempted), a failure that stated no reset
`now + UNSTATED_KEY_HOLD_MS` (`src/keyring.ts`, five minutes; the escalation's `rotateProviderKey` and the
probe's re-marks compute it at their call sites). `isKeyDown` collapses to `until > now`; rule 4, the
probe's clear-and-re-mark, boundary non-participation and `/failback`'s rewind are unchanged in contract.
The refusal commits the same way as before — the current key's failure written, the position unmoved — with
no flags left to consume.

## D2 — the new-session walk

Every new session — a create or a consumed fork, never a resumed takeover (not a new session) — walks the
picked entry's provider ring in declared order before the session's first provider call (`walkProviderKey`
in `src/attempt.ts`, placed ahead of the agent client resolving so a host that has not started yet spawns
directly on the walked key). The walk lands on the **first key that carries a mark whose instant has
passed** — aged-out evidence, a recovered earlier key — and answers nothing otherwise. A key with **no mark
never triggers a walk**: the ring landed on it or started at it, and the recovery probe's wholesale clear
(§6.3) leaves exactly that shape — so the probe's own session keeps testing the current key, its contract
intact. A still-held earlier key walks nowhere; the recovered key being the current one is already where
the ring stands. `commitWalk` moves the position alone — the from key did not fail, no mark is written —
then the caller writes the spawn config and restarts the managed server (the rotation's own mechanics;
sessions survive a restart, F8, and the moment is pre-first-call so no in-flight work exists). §6.4's
restart-churn floor, already amended by 0144 to "held by the failure trigger," takes its final shape here:
**a restart follows a failure or a passed hold, never a bare session** — bounded by the holds themselves.

The classifier / plan-verifier / synthesis one-shots create sessions outside `attempt` and never rotated;
they still do not walk — a stated boundary, not an oversight (diagnostic one-shots ride the current key),
recorded here for the next reader.

## D3 — floors and unchanged halves

- No registry, an external server, unactivated rings, a ringless provider: byte-identical (the walk sits
  behind `ringsActive` exactly as the rotation does).
- The stated-reset half: marks, boundary survival, expiry at the instant, extension on a late classifier
  answer — every existing pin holds (the hold is the no-reset case's own duration now).
- `.auto/windows.json` untouched (learned windows still never block a dispatch); `accountOf` and the labels
  unchanged; the escalation ladder (key → model → wait) unchanged; the spawn config's shape unchanged —
  only the position it reads can move at a new moment.
- The unattended everything-down case improves within the standing contract: both keys held five minutes →
  the next session after the holds walks to key 1; the probe path, unchanged, owns the rest.

This ruling Derives: **P19** (measured evidence — the showing: the field case measured a recovered key
waiting five-plus hours behind a failure-triggered search while the provider stated no reset; the
five-minute hold is the person's ruled constant against measured session lengths, and the walk triggers
only on aged-out evidence, never on a guess), **P6** (derived state, minimal — the state kinds halve: one
mark shape, the flag's bookkeeping dissolved with it), **P2** (the person brackets every boundary — the
maintainer's ruling reopens the residual 0144 itself named; `/failback` remains the attended instant path),
**P12** (conservative under uncertainty — an uncertain failure excludes a key a bounded five minutes, then
re-checks; never an unbounded park), **P13** (frozen vocabularies — the skip-flag vocabulary retires in the
same change that teaches the hold and the walk: code comments, the shell README, structure.md and the tests
move in lockstep). Amends: **0144 D1** (the state split collapses to its `until` half — the flag becomes the
five-minute hold), **0144 D2** (the search gains a failure-free trigger, the new-session walk; the refusal's
consumption machinery dissolves with the flags; the named residual "while a later key works, a recovered
earlier key waits for the next rotation" is retired) and **0055 §6.4**'s restart-churn floor (a restart
follows a failure or a passed hold, never a bare session). Tier touched: **mechanism** — core
(`src/keyring.ts`, `src/router.ts`, `src/attempt.ts`, `src/session.ts`, the boundary-clear comment in
`src/runner.ts`) and the shell README's key-ring paragraph.

## Category scope (0123 D1's discipline — reconstructed 2026-11-05 by 0166 step 003 from this ruling's D-blocks and landing commit 358be4003)

Family: *the model registry's key failure state — the hold and the new-session walk that supersede
0144's skip-flag split.* Home-set reconstructed from D1–D3:

| home | disposition |
|---|---|
| `src/keyring.ts` (the state collapses to its `until` half — the flag becomes the five-minute hold; the walk's decide/commit pair) | changed — D1/D2 |
| `src/attempt.ts` (walkProviderKey ahead of the agent client resolving) | changed — D2 |
| `src/router.ts` and `src/session.ts` (the rotation's mechanics; the boundary clears), the boundary-clear comment in `src/runner.ts` | changed |
| `packages/auto/README.md` (the key-ring paragraph) | changed |
| The floors: no registry, an external server, unactivated or ringless providers; the stated-reset half's every pin; `.auto/windows.json`; `accountOf` and the labels; the escalation ladder (key → model → wait) and the spawn config's shape | held, untouched — D3 |
| The diagnostic one-shots (classifier, plan-verifier, synthesis) creating sessions outside `attempt` — they still do not walk | held, untouched — D2's stated boundary, recorded for the next reader |
| Test homes: `test/keyring.test.ts` (the rotation describe re-pinned to the hold; the walk describe), `test/failback.test.ts` (the one-mark shapes, the boundary matrix), `test/agent-fake.test.ts` (the refusing ring; the field-scenario pin on a manual clock), `test/routing.test.ts` | changed |

Tests: `test/keyring.test.ts` — the rotation describe rewritten to the hold (the order-first sequence over
held keys, the refusal marking the current key and moving nothing, the boundary clear leaving position and
marks alone, the single-key refusal, the unstated hold's extent), a new walk describe (decide mutates
nothing, commit moves the position alone and writes no mark, the no-mark / probe-clear carve-out, the
current-key-recovered no-op, the floors); `test/failback.test.ts` — the key-state shapes under the one-mark
rule and the boundary matrix; `test/agent-fake.test.ts` — the refusing ring now leaves both keys held (rule
4 reading false until the instants pass, the spawn config still naming the current key), and the
field-scenario pin on a manual clock: quota rotates A→B; within the hold a new session stays on B with no
restart; past the hold the next session walks back to A — one restart, A's reference in the spawn config,
no failure on B at all.
