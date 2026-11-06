# Step 019 — w2-ring-wait-vocab

Wave: W2-keyring. Findings: 0165-126 (S16-02, S3, CONFIRMED — recoveryAt treats an exhausted
key ring as 0057 S4's "instant unknown" although every key mark has carried `until` since 0163
D1), 0165-199 (S16-07, S4, CONFIRMED — the router still speaks the retired skip-flag vocabulary
in three comments, routing.ts imports `select` unused, recoveryAt's header states the pre-0163
premise). Started 2026-11-06 at HEAD `ea4504a2f`.

## Scope

The selection schedule's ring half and the key-state vocabulary's comment lockstep: the
wait-and-probe round's first sleep over an exhausted ringed provider, and 0163's own P13
lockstep clause (the comments).

## Design ruling

Ruling **0179** ([0179-ring-return-instant.md](../0179-ring-return-instant.md)): D1 the
selection context gains `ringBack(provider)` (the router's earliest `until` over the provider's
key marks) and recoveryAt treats an exhausted ring like a down mark with an instant — the
candidate's return the LATER of its model mark and its ring's keys, the withholding floor
standing (no readable instant → poll); D2 the three stale comments restated to the one-mark
shape, recoveryAt's header rewritten with D1, routing.ts's unused import dropped. Derives P6
with P19/P13/P10; premises — 0057 S4's ring rule amended, 0163 D3's "stated-reset half
unchanged" corrected; 0163 D1 and recoverySleep's cascade stand.

## Implementation order (the recovery map)

1. `src/select.ts`: SelectContext's `ringBack` + the facts.router slice + the routeContext
   wiring; recoveryAt's ring branch (max with the mark) and header.
2. `src/router.ts`: the `ringBack` member + type line; the three comments. `src/routing.ts`:
   the import.
3. The oracle rewrite; fail-before; suites; bookkeeping; commit.

## Execution log

- 2026-11-06: step opened after step 018's commit (ea4504a2f) in the same worker stretch. Both
  findings' records read (S16-02/07 in S16-routing.md); the surfaces read (select.ts's
  recoveryAt/faultsOf/SelectContext, router.ts's recoverySleep and key-mark state, the stale
  comments).
- Implementation landed per the map. Two authoring slips caught by the compiler and the oracle:
  the Candidate union's raw shape and the provider-undefined guard (faultsOf's own narrowing
  mirrored), and the both-clear oracle's arithmetic (the soonest candidate wins — the sub-case
  re-timed so k3's combined instant is the answer).

## Verification

- `bun typecheck` clean in packages/auto-core and packages/auto.
- auto-core full suite: **2989 pass, 0 fail** (152 files; unchanged count from step 018 — the
  oracle rewrite replaced one test, the suite's total stable).
- Fail-before: `git stash push -- src/select.ts src/router.ts src/routing.ts` → the rewritten
  oracle red on the pre-change code (the scheduled-ring case answers undefined under the old
  `if (ring) return undefined`); the withholding-floor sub-cases green on both sides (the
  floor). `git stash pop` restored everything.
- packages/auto suite: 157 pass, 5 fail — the same pre-existing fork/remove-fork baseline
  (step 031's wave).

## Close-out

Step done 2026-11-06. Ruling 0179 active-authority; the INDEX row, the AGENTS.md model-registry
line's year list, ledger rows 0165-126/199 and the program's status/current-position land in the
same commit. Residual: the probe's wholesale key-mark clear narrowed by the schedule (the first
round sleeps to the marks' instant), never re-drawn — 0178 D1 bounds its consequence.