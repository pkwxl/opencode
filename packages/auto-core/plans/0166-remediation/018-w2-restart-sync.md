# Step 018 — w2-restart-sync

Wave: W2-keyring. Findings: 0165-057 (S32-04, S2, CONFIRMED — the ∪5 union: S17-01 the forward
walk, S17-02 the restart under doc-lane siblings, S17-03 the short-reset oscillation, S16-01 the
/failback rewind that never re-keys, S17-10's walk double-spawn half — every restart of a shared
managed host an unsynchronized act). Started 2026-11-06 at HEAD `9fcd1a38a`.

## Scope

The key-ring restart path: the walk's bound, its shared-host gates, the /failback rewind's owed
re-key, and the pool restart's double spawn. S17-10's README/comment-drift half stays step 077
(with 0165-186); the failure rotation's code stays as-is (the ruling's D3 decision closes
0099's named audit item).

## Design ruling

Ruling **0178** ([0178-rekey-safe-boundary.md](../0178-rekey-safe-boundary.md)): D1 ringWalk's
scan stops at the current position (`index < from` — keyring's comment always stated the bound);
D2 a consumed fork never walks (`forked === undefined` at attempt's call site); D3 a doc-lane
session never re-keys the shared host (opts.docLane defers the walk whole; the failure
rotation's restart stays immediate by ruled decision); D4 consumeFailback sets an owed-rekey
debt beside the rewound positions, consumed by the next new session's walk moment with one
restart onto the rewound rings; D5 the pool's restart answers false over an un-started host (no
spawn-just-to-kill). Derives P20 with P17/P5/P12; premises changed: 0163 (the walk's bound and
its no-oscillation measurement claim — the INDEX row annotated); 0144 §6.4 and 0055 §6.3 stand.

## Implementation order (the recovery map)

1. `src/router.ts`: the bound; the owed state + members; consumeFailback's flag.
2. `src/attempt.ts`: walkProviderKey's gates (docLane, owed) + export; the fork-skip conjunct.
3. `src/agent-pool.ts`: restart's un-started no-op.
4. Tests (keyring: bound, owed, the act's gates; agent-pool: the double spawn); fail-before;
   suites; bookkeeping (incl. 0163's INDEX annotation); commit.

## Execution log

- 2026-11-06: step opened after step 017's commit (9fcd1a38a) in the same worker stretch. The
  five members' evidence read (S17-models.md whole for S17-01/02/03/10, S32-04's union record,
  S16-01's record in S16-routing.md); the surfaces read (router's ringWalk/consumeFailback/
  commitWalk, attempt's walkProviderKey and call site, session's rotateProviderKey, the pool's
  hostOf/restart/setConfig, the server's setConfig/restart, the three failback consume sites).
- Design decisions recorded in the ruling: the failure rotation keeps its immediate restart
  (D3's reasoned decision — the alternative serves siblings turns on a dead key); the owed debt
  rides the walk's own path (the next new session's pre-first-call moment is serial by D3's own
  gate); the fork-skip covers every consumed fork (the chain's pending carries no reason — the
  bounded one-dispatch deferral against the unbounded cycle).
- Implementation landed per the map; walkProviderKey exported for its unit tests (the
  watchProcess precedent).

## Verification

- `bun typecheck` clean in packages/auto-core and packages/auto.
- auto-core full suite: **2989 pass, 0 fail** (152 files; 2982 at step 017's close).
- Fail-before: `git stash push -- src/router.ts src/attempt.ts src/agent-pool.ts` → the D1 test
  (the forward walk answers a walk), the owed test (the members missing) and the double-spawn
  test (restart starts the host and answers true) all red on the pre-change code — run from a
  copy of keyring.test.ts with the new-export describe stripped (the import itself cannot
  compile pre-change, the new-export shape); `git stash pop` restored everything.
- packages/auto suite: 157 pass, 5 fail — the same pre-existing fork/remove-fork baseline
  (step 031's wave).

## Close-out

Step done 2026-11-06. Ruling 0178 active-authority; the INDEX row, 0163's INDEX annotation
(the premise guard's re-read), the AGENTS.md model-registry navigation line, ledger row
0165-057 (the ∪5 union enumerated) and the program's status/current-position land in the same
commit. Residuals: the failback re-key under live doc lanes defers with the walk (the flag
survives); the rotation's sibling-restart hazard accepted by rule, not mechanism (P21); the
fork-skip's one-dispatch deferral on non-rotation forks.