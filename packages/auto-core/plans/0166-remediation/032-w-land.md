# Step 032 — w-land: land's original-branch derivation

Wave **W-land**. Started 2026-11-07 at HEAD `8a4907697` (step 031 done: ruling 0191). Worker:
the delegated child session, executing the program's Part B directly.

## Scope

Finding **0165-148 (S20-11, S3, CONFIRMED)** — land derives the original branch as "the one
local branch outside the driver families": any designated repository with a second ordinary
branch (main + dev, any feature branch) can never land, and the refusal's teaching
("settle the branches manually") points at deleting the person's branches; the prefix filter
also hides a person's own `auto/…` branch; the derivation is an implementation
AUTO-DECISION never ruled in 0074 (grep: no multi-branch case there). Homes:
`src/land.ts` (the header's AUTO-DECISION note + pass 1's candidate filter) and — the
finding's named family — `src/git-land.ts` (isolateRound, whose checkout writes the record
the remedy proposes to read); the refusal's teaching reaches the shell (the `--onto` escape
the remedy names needs the land row's parser) and the README's land rows.

This is titled a **derivation ruling**: fix / by-design / fix-plus-residual decided on
evidence, with live git behavior re-probed where the mechanism depends on it.

## Recovery state (maintained as work goes)

- 2026-11-07 session open: evidence read (the register row, S20-11's record, 0074 §2.3/§5);
  code homes read in full (`src/land.ts`, `src/git-land.ts`, the shell land row, the land
  test homes); git behaviors probed empirically (the establishment checkout writes
  `checkout: moving from <X> to auto/R-NN` as HEAD's oldest matching reflog entry —
  newest-first listing; a same-branch re-checkout also writes an entry
  (`moving from auto/R-01 to auto/R-01`), so the **oldest** match is the establishment's;
  `core.logAllRefUpdates=false` leaves `git reflog show HEAD --format=%gs` exiting 0 with
  empty output when the reflog file never existed — and an existing reflog file keeps
  appending regardless of the config, so the no-record floor fixture sets the config before
  any ref update; a detached-HEAD establishment records the commit sha as the from-token,
  not a branch; `git reflog expire --expire=now HEAD` leaves an empty file that later
  checkouts append to). Step marked `doing` in the program.
- Ruling **0192** written (plans/0192-land-original-branch.md): fix — the evidence ladder
  (the person's `--onto` word; the establishment's reflog record; the exclusion floor with
  the round grammar tightened to `auto/R-<n>`; the deleted-record block; the refusals
  teaching `--onto`, never branch surgery), the record ref declined on P6 grounds.
- Src edits landed: `src/git-land.ts` (`reflogIsolationSource`; isolateRound's checkout
  comment; localBranches' caller-guidance comment), `src/land.ts` (the ladder in pass 1;
  the exact-grammar family predicate; `onto` in LandOptions; the header's AUTO-DECISION
  paragraph restated), `packages/auto/src/index.ts` (`onto` a value flag; LAND_FLAGS + the
  strict-ladder usage line; the OWNED_FLAGS owned refusal — the 0159 enumeration guard's
  requirement, caught red by the guard in-change; the help rows and synopsis; the
  bare-`--onto` usage guard; threading to landUnit), `packages/auto/README.md` (the
  synopsis row, the derivation bullet, the refusal bullet), `test/land.test.ts` (the
  ambiguous pin reshaped into five pins), `packages/auto/test/e2e.test.ts` (the
  strict-ladder wording lockstep, the bare-`--onto` guard pin, the `--onto` e2e test).
- Two in-change corrections: the floor fixture's `git branch wip` created wip at the round
  branch's tip (wip must sit at the isolation point — `git branch wip <original>`); the
  no-record floor needs the reflog config set before any ref update (an existing reflog
  file keeps appending — probed).
- Documentation landed: INDEX (the 0192 row; 0074's premise annotation; 0151's filter
  note), AGENTS.md (the land navigation line). **Next action**: fill this record's
  verification/dispositions, set the program's row/ledger/position, review the diff,
  commit.

## Verification

- `bun typecheck` (auto-core) — exit 0. `bun test` (auto-core, full) — **3075 pass, 0 fail,
  153 files** (step 031's close: 3071; +4 net = 5 new land pins replacing 1 reshaped).
- `bun typecheck` (packages/auto) — exit 0. `bun test` (packages/auto, full) — **150 pass,
  8 skip, 5 fail** (163 tests; the baseline 149 pass + the 1 new `--onto` e2e test; the 5
  failures are the pre-existing fork/remove-fork baseline — 2 fork + 3 remove-fork, the
  trailer-scan fixture shape named at steps 030/031, untouched by this step).
- **Fail-before proof** (the three touched src files reverted to HEAD over `/tmp/0192-failbefore`
  backups, tests kept fixed): `test/land.test.ts` — **5 pins red, 16 pre-existing land tests
  green** (the byte-identical floor): the defect pin (a second ordinary branch: expected
  `landed`, received `blocked` — "cannot tell which of master, wip"), the floor pin (the old
  "settle the branches manually" wording where the new teaching names `--onto`), the
  record pin (expected `blocked`, received `landed` — **the wrong-branch landing onto wip**,
  the defect's dangerous half), the `--onto` escape pin (expected `landed`, received
  `blocked`), the grammar pin (a person's `auto/release` original: expected `landed`,
  received `blocked` — "no candidate" under the prefix filter); the floor's
  byte-identical half (no record, one candidate) passes on both sides by design.
  `packages/auto/test/e2e.test.ts` — the `--onto` e2e test red (at HEAD's src the
  original's deletion makes elimination land onto wip: exit 0 where exit 2 is pinned) and
  the land usage test red (the strict-ladder line and the bare-`--onto` guard absent at
  HEAD); the two pre-existing land e2e tests green. The fixed files restored and verified
  byte-identical (`cmp` × 3); both full suites re-run at the numbers above.

## Dispositions

- 0165-148 → **fixed @0192** (the evidence ladder replaces exclusion-only derivation: the
  person's `--onto` word, the establishment's HEAD-reflog record, the exclusion floor with
  the exact `auto/R-<n>` grammar; the deleted-record block; every unanswerable derivation
  blocks teaching `--onto`, never branch surgery).

Residuals recorded in the ruling: reflog expiry (the floor and `--onto` answer),
per-repository originals for a mixed fleet (one name everywhere; land by hand), `--onto`
outside land following `--merge`'s cross-command posture.
