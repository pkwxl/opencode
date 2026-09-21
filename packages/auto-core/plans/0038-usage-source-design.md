# 0038 Usage source (MA.2): four tiers and the behavior matrix of the usage-driven mechanisms

> Milestone MA.2 of `plans/AUTO_NEXT_REFACTOR_PLAN.md` (root); first half of
> its open question 5 (the second half, measuring claude's actual usage
> fields, is MA.5). Builds on the frozen `UsageTier` names of
> `plans/0037` (D7). Stage-assisting document per D6: retires as history once
> MA closes.

## 1. Scope

1. **Usage source** — `src/usage.ts` `usageSource(tier, start)`: tracks one
   session's context occupancy from the unified event stream, per tier.
2. **Behavior matrix** — one pure decision per usage-driven mechanism in the
   same file, taking `used: number | undefined` (undefined = unknown). The
   `events` row reproduces today's inline rules; tests check that on a grid
   of values around every threshold.
3. **Conservative estimator** — `estimateTokens` for the `estimated` tier.

Nothing is wired (0031 D4 path): MA.3 routes watch / attempt / testrun /
session through these functions when it moves them onto the unified event
stream. `src/usage.ts` is a driver module (the mechanisms are driver
behavior; the tier is the adapter's `capabilities.usage`), registered as
such in the import-direction table.

## 2. Fact baseline (who consumes usage today)

| # | Mechanism | Rule | Site |
|---|---|---|---|
| U1 | Measurement | `used = tokens.input + cache.read` of the latest *completed* assistant message; `pct = used/limit`, 100 when the window is unknown | `watch.ts` message.updated |
| U2 | Reuse | reuse switch on ∧ `pct < 50` ∧ `used < cap/2` ∧ idle ≤ 5 min (`REUSE_BELOW`, `REUSE_IDLE_MS`) | `attempt.ts` |
| U3 | Steer handover | in-turn, once per session: `used >= steer.limit` (2·cap) → inject the handover hint | `watch.ts` |
| U4 | Post-session handover check | `handoverDue(steer, chain.used)`: over the limit → read the handover document; missing → one feedback retry, then blocked | `testrun.ts`, `execute.ts` ×2 |
| U5 | Test handover | at the test request (idle + `tmp/test.sh`): `(used > 0 ? used : startUsed) >= cap` | `testrun.ts testHandoverDue`, `watch.ts` |
| U6 | Fork base guard | `base.used >= cap/2` → no fork, cold start; base usage rebuilt from history (`sessionUsage`) | `session-api.ts seedForkSession` |
| U7 | Retry fork source | failed session counts only when `used > 0` (0 = error stub); sources sorted by `used` | `session.ts` ×3 |
| U8 | Failover window clamp | skip a fallback candidate whose known context window is `< cap`; unknown window is not filtered | `session.ts switchModel` |

Observation: today's "unknown" is spelled `used = 0` and `pct = 100`. That
already gives the conservative answer for U2 (pct 100), U3/U4 (0 is under
any limit), U5 (0 → startUsed 0 → no handover) and U7 (0 = stub). It gives
the **wrong** answer in two places, which is what the matrix fixes:

- **G1 (U6)**: an unknown base size reads as 0 and passes the cap/2 guard, so
  the driver would fork a base of unknown, possibly near-full, size.
- **G2 (U4)**: under a tier whose figure arrives only at turn end, a session
  that finished naturally over 2·cap was never sent the hint, yet the check
  demands the handover document it was never asked to write (feedback retry,
  then blocked).

U8 reads window sizes (`contextLimits()`), not usage: it is the same in
every tier, and its "unknown window is not filtered" rule already covers an
adapter without a window table.

## 3. Tiers

| Tier | Meaning | Known when | `used()` |
|---|---|---|---|
| `events` | the agent measures per message in the event stream (opencode) | in-turn | latest completed assistant `contextUsed`; undefined before the first |
| `reported` | the agent reports only at turn end (a CLI's final result line) | turn end | as `events`; the adapter must deliver that final `message` event **before** `idle` |
| `estimated` | nothing reported; the driver estimates | in-turn | `start` + prompts + latest size of every text/reasoning/tool part |
| `none` | nothing known | never | always undefined |

Liveness (`liveUsage`) = `events` or `estimated`.

## 4. Decisions

| # | Decision | Content |
|---|---|---|
| D1 | Two questions decide every row | Is a value known, and is it known while the turn runs. The decision functions take `used: number \| undefined` plus the tier; no per-tier special cases beyond liveness. |
| D2 | Unknown resolves one way | Toward the side that neither carries context forward (no reuse, no fork) nor ends a session on a guess (no steer, no handover demand, no test handover). |
| D3 | "Always full" is not taken literally for triggers | Read as `used = ∞`, `none` would fire the steer on the first message of every session (a handover livelock) and turn every test request into a handover. "Full" applies only where it costs money, not progress: reuse off, fork off (plan risk 3). The substitute trigger for `none` is MA.5's round cap (open question 5, second half). |
| D4 | `reported` keeps everything but in-turn triggers | The turn-end figure is exact, just late: reuse, test handover (decided at idle, after the figure) and the fork guard work as today; the steer hint cannot fire, so the post-session check must not demand a handover document (fixes G2). |
| D5 | Estimates overestimate | ASCII at 3 chars/token (prose ~4, code ~3.5), every non-ASCII code point a whole token (CJK prompts and documents are common here). Overestimating costs extra handovers/fresh sessions; underestimating runs a session into the wall. `start` = inherited occupancy (reused/forked session) or the adapter's fixed overhead. MA.5 calibrates against claude's reported figures. |
| D6 | Measured "0" keeps today's reading | For `events`, U5's `used > 0 ? used : startUsed` stays: a measured 0 means "nothing arrived yet". |
| D7 | Unknown base = full (fixes G1) | `forkBaseAllowed(undefined)` is false: cold start with the full prompt, the existing fork-failure path. |

## 5. Behavior matrix

| Mechanism | events | reported | estimated | none |
|---|---|---|---|---|
| U2 reuse (`reuseAllowed`) | today | today (turn-end figure) | on the estimate | off |
| U3 steer hint (`steerDue`) | today | off (no live figure) | on the estimate | off |
| U4 post-session check (`sessionHandoverDue`) | today | off (G2 fix) | on the estimate | off |
| U5 test handover (`testHandoverDue`) | today | today (figure precedes idle) | on the estimate | off |
| U6 fork base guard (`forkBaseAllowed`) | today | today (needs `history` for rebuilt figures) | on the estimate; unknown after restart → cold start | cold start (G1 fix) |
| U7 retry fork source | today | today | see §6 | original session only |
| U8 failover window clamp | window-based: identical in every tier | | | |

The steer hint also needs `capabilities.steer` (claude: false); that gating
is MA.4. This matrix is only about the usage figure.

## 6. Known limits and hand-offs

- **U7 under `estimated`**: an error stub's estimate is `start + prompt > 0`,
  so a stub could be picked as retry fork source (the copy repeats the
  prompt). Harmless but wasteful; MA.3 can pass the "has output" signal
  instead of `used > 0` when it moves the call site.
- **U6 rebuilt usage**: `sessionUsage` rebuilds a base's figure from
  `messages()`; for `estimated` the history carries no part sizes, so a base
  whose figure did not survive in the chain (process restart) is unknown →
  cold start by D7.
- **Latent, not changed (MA.3 note)**: under `events`, U4 re-reads the final
  figure instead of "was the hint sent". If opencode compacts after the hint,
  the final figure can drop below 2·cap and a written `状态: 继续` handover is
  treated as a natural finish. `sessionHandoverDue` keeps today's reading for
  byte-equivalence; switching to "hint sent" is a candidate fix for MA.3.

## 7. Verification

- `test/usage.test.ts` (12 cases): tracker per tier (events/reported
  settle only on completed assistant messages; estimated dedupes re-sent
  parts by id; none stays unknown), estimator, liveness, the `events` row
  against today's predicates on a threshold grid (`testrun.ts` `handoverDue` /
  `testHandoverDue` imported directly; attempt's inline reuse rule and
  seedForkSession's guard restated), and the other tiers' rows.
- Import-direction suite: `usage` added to the flat-file table as driver.
- auto-core full suite + typecheck (numbers in the root plan's MA.2 entry).
