# 0178 — The managed host's re-key is a safe-boundary act: the walk bounded, gated and debt-carrying; the restart never double-spawns

Status: **active**. Ruled 2026-11-06 by 0166 step 018 (wave W2-keyring), enacting 0165-057
(S32-04, S2, CONFIRMED, the ∪5 union: S17-01, S17-02, S17-03, S16-01, S17-10's walk half —
every restart of a shared managed host is an unsynchronized act, and the router's key position
and the host's spawn config are two homes synced only by the restart sites).

## Derives

Derives: P20 — in-flight work is never destroyed; control changes land only at safe boundaries —
the ruling's spine. The walk is a non-failure act: re-keying the shared managed server while doc
-lane siblings hold open sessions kills their turns mid-flight and cascades (S17-02, CONFIRMED
with repro); the same boundary discipline bounds the walk to earlier keys (a healthy current key
is in-flight work the walk must not disturb — the forward walk bought a failure-and-two-restarts
cycle per hold, S17-01) and defers it past a consumed fork (the fork rides the key path its
seeding act chose — walking right after a rotation undoes it under a short stated reset, S17-03's
measured restart-per-failure oscillation). P17 shows in the shared host's declared concurrency
(one pool, in-process lanes — the restart is the one act that crosses the lanes' isolation
without a gate); P5 in the two-homes disease the union names (the router's position and the
host's spawn config synchronized only by the restart sites — the /failback rewind moved the
position home and left the server's key stale, S16-01); P12 in the ⇄ line's honesty (the rewind
now owes and pays its restart). Tier: operating — P20/P17 statements applied to the key-ring
restart path; no Tier I statement changes.

premises this ruling changes: 0163 (D2's walk — the scan is bounded to keys before the current
position, as keyring's own RingWalk comment always stated and the ruling's wording omitted; and
0163's measurement claim "the fork oscillation cannot happen" is corrected — the short-stated-
reset oscillation was measured at 80 restarts over 40 failures with the second key never serving
a prompt; the INDEX row carries the annotation). Re-readings: 0144 §6.4's floor stands ("never
goes back while a later key works" — the bounded walk still re-preferences only a recovered
earlier key); 0099's named audit item (the restart path under doc lanes) closes here with a
reasoned decision (D3); 0055 §6.3's probe clear stands (the unmarked current key is tested, not
walked — D1 makes it structural); 0157 D2's drained-close stands.

## Category scope (0123 D1's discipline)

Family: *the key-ring restart path* (who restarts the managed host, when, and what a position
move owes). Home-set: `src/router.ts` (ringWalk's bound; the owed-rekey state and members;
consumeFailback's flag), `src/attempt.ts` (walkProviderKey's gates — the doc-lane deferral, the
owed re-key, the fork-skip at the call site), `src/agent-pool.ts` (restart over an un-started
host), `test/keyring.test.ts` (the walk's bound, the owed flag, the act's gates), 
`test/agent-pool.test.ts` (the no-double-spawn), `plans/INDEX.md` (0163's annotation). No frozen
vocabulary changes: the walk's answer shape, the rotation path and every log line stand; the two
router members are additive machine surface (rekeyOwed/consumeRekeyOwed), the walk's restart
reason for the owed case is a new line the person sees exactly once per /failback.

## D1 — the walk only ever re-preferences an earlier key

ringWalk's scan stops at the current position (`index < from`): the walk is the recovered-earlier
-key act 0163 designed and keyring's comment always stated — a passed hold on a LATER key with
the current key unmarked (the exhausted-ring shape the probe's clear leaves) answers nothing, and
the session keeps the working key. The unbounded scan's forward walk — a restart onto a spent
later key every hold expiry, then the rotation's restart back — is gone.

## D2 — a consumed fork never walks

The walk moment is skipped when the dispatch consumed a fork (`chain.pending`): the fork rides
the key path its seeding act chose, and a rotation's fork under a short stated reset (the
mark held seconds) would have the walk immediately undo the rotation — the measured oscillation.
The next fresh session walks (a fork is one dispatch; non-rotation forks lose one walk
opportunity, a bounded cost against an unbounded cycle).

## D3 — the doc-lane session never re-keys the shared host; the failure rotation stays immediate

Under the concurrent doc-lane pipeline (`opts.docLane` — set only by the doc-lane dispatch), the
walk defers whole: no commit, no restart, the position keeps the serving key (a restart would
kill the sibling lanes' open sessions; the recovered key re-preferences at the next serial
moment or through the rotation path). The FAILURE rotation's restart stays immediate, and this
is the ruled decision that closes 0099's named audit item: a failed key is an emergency whose
restart is the failure's own cost — the alternative serves every sibling its turns on a dead
key; the walk is the only non-failure restart the shared host takes, and it is the one gated.

## D4 — the /failback rewind owes its re-key, and the walk moment pays it

consumeFailback, rewinding active rings, sets an owed flag beside the positions it cannot
restart (the router owns positions, not hosts — the two-homes seam made explicit). The next new
session's pre-first-call moment — serial by D3's own gate — consumes the debt: setConfig to the
rewound rings and one restart ("re-keying the managed server onto the rewound key rings"), the
walk's own path. The flag survives gates it cannot pass (a doc-lane moment, an external server)
and is consumed only by the path that restarts, so the rewind's ⇄ line finally states an effect
that happens.

## D5 — restart over an un-started host is a no-op

The pool's restart answers false for a profile whose host has not started (and no start is in
flight) instead of starting a host only to kill it — the walk-before-first-use double spawn.
The caller's existing "the new key applies at its next spawn" line is exactly the truth: the
next spawn reads the router's current position itself. A start in flight still gets the restart
(its spawn may have read the pre-rekey config — the wait-then-restart heals a stale start).

## Residuals

- The failback re-key under LIVE doc lanes defers with the walk (D3's gate): the shared server
  keeps the rotated-to key until a serial moment or its own restart — the same deferral the
  walk takes, one /failback late rather than never (the flag survives).
- The sibling-restart hazard of the failure rotation under lanes is accepted by rule (D3), not
  mechanism — a lane-width-aware drain would be new machinery no measured incident demands
  (P21).
- The fork-skip's one-dispatch walk deferral (D2) applies to every consumed fork, not only a
  rotation's — the bounded cost named above.

## Tests

- keyring.test.ts: the forward-walk bound (the exhausted-ring sequence answers nothing — the
  S17-01 repro's shape; fail-before: the unbounded scan walks to B); the owed flag's life
  (consumeFailback sets it over active rings, the walk moment consumes it, a ringless router
  owes nothing); the act's gates (the landed-key restart with its config and position move; the
  doc-lane deferral — no restart, no config, the position keeps the serving key, fail-before;
  the owed restart's reason and debt consumption; the no-setConfig host answers nothing).
- agent-pool.test.ts: restart over an un-started host answers false and spawns nothing; a
  started host restarts as before.
- Fail-before: the ringWalk bound and the owed members are pure-router pins runnable on the
  pre-change code (the D1 test walks forward, the owed test meets missing members); the act's
  describe rides the newly exported walkProviderKey (the new-export shape).
