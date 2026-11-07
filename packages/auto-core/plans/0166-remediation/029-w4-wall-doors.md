# Step 029 — w4-wall-doors: wall close/doors

Wave W4-wall-perms, findings 0165-008 (S04-01, S2), 0165-037 (S20-01, S2), 0165-038 (S20-02, S2),
0165-076 (S04-07, S3), 0165-149 (S20-12, S3). Started 2026-11-07 at HEAD `d8cc63149`; the tree was
clean.

## Scope

The sealed-reference wall family's close and door machinery: `src/wall.ts`, `src/loop-phase.ts` (the
handover tail's ordering), `src/plan.ts` (the boundary-stop lines), `src/external-dirs.ts` (the
coverage evaluator), `src/config-fix.ts` (fix's stamp past a sealed wall), with `src/phases/custom.ts`
and `src/protect.ts` read as the declaration and freeze surfaces. Standing rulings 0132 (the wall),
0147 (the boundary), 0155 (failure direction, the multi-door recovery), 0188 (the matcher mirror and
oracle); the admission oracle at `test/helpers/perm-oracle.ts` judges the wall's permission tests.

## Recovery state (maintained during the step)

- Ruling: `plans/0189-wall-close-doors.md` (created).
- Code: `src/wall.ts`, `src/loop-phase.ts`, `src/plan.ts`, `src/external-dirs.ts`, `src/config-fix.ts`.
- Tests: `test/wall.test.ts`, `test/transfer-wall.test.ts`, `test/external-dirs.test.ts`,
  `test/config-fix.test.ts`.
- Bookkeeping: this record, the program row/ledger/Current position, `plans/INDEX.md`, `AGENTS.md`.
- Next action if interrupted: see the program's Current position.

## Findings → decisions (summary; the ruling is the authority)

| finding | decision |
|---|---|
| 0165-008 | D1 — the seal-due handover holds on every non-transfer path (flow, plain-run re-entry, plan), naming transfer as the sealing command; the close stays transfer's alone; the re-entry's boundary stop prints the phase-closed variant |
| 0165-037 | D2 — the recovery adopts only provable door targets (git: the door's last add/modify content, HEAD first), never a live allow's base; unprovable allows are left alone (covered ones block through the split) |
| 0165-038 | D3 — the closed predicate re-derived: the door half walks tracked symlinks at any depth plus top-level untracked ones (resolved or, dangling, lexically pointed), under or over a recorded target; the allow half evaluates coverage with opencode's semantics (matcher, key order, last-match-wins, `~`/`$HOME`, non-deny = open); fix never stamps allows past a recorded wall target |
| 0165-076 | D4 — the phase gates are checked read-only BEFORE the wall (a hold stops ahead of the seal); completePhase's own re-check stays the choke point |
| 0165-149 | D5 — `recreatedDoors` counts the entry by what it points at (the dangling door included); the failed wall commit's line teaches the re-run (the close re-derives the interrupted state — the stamp-slot deny recognized — landing the record commit), with the hand-commit recipe's exact record lines as the alternative |

## Verification (2026-11-07, HEAD d8cc63149 → the step's commit)

- `bun typecheck` exit 0 in auto-core and in packages/auto.
- auto-core full suite: **3056 pass 0 fail** (153 files; 3042 at step 028's close — the step's 14 net
  new tests: wall.test.ts 19→27, transfer-wall.test.ts 3→7, external-dirs.test.ts +3 net
  (4 evaluator/oracle pins replacing the coveringAllowKeys pin), config-fix.test.ts +1).
- packages/auto: **149 pass 8 skip 5 fail** — the pre-existing baseline (2 fork + 3 remove-fork,
  step 031's wave); the one mid-run red (the wall e2e's `person-authored external_directory allow`
  pin) was the ruled entry-word change, updated to `entry` in the same change and green.
- Fail-before proofs (pre-fix source via `git show HEAD:…`, bounded timeouts, fixed files restored
  and confirmed byte-identical):
  - test/wall.test.ts: 8 red — the hold (0 lines received vs >0, 0165-008), the multi-door
    `(removed)` vs `vendor` (0165-037), the templated-boundary close BLOCKED with the received line
    `"⏸ the wall cannot close: the reference target(s) /tmp sit inside the knowledge boundary's
    allowed /tmp subtree …"` (S20-01 scene A verbatim, 0165-037), the person-allow sweep (two doors
    recorded + the person's allow flipped, 0165-037), the committed `reference`/`docs/ref/k` reopens
    reading closed (0165-038), the ancestor/dangling door reading closed (0165-149), the `*`/subtree/
    ask coverage reading closed (0165-038), the failed-commit line + the re-run's
    `"no reference door is present"` block (0165-149). Every pre-existing unchanged pin green
    pre-fix (byte-identical where no fix was ruled).
  - test/transfer-wall.test.ts: the 4 new loop-level tests red (flow exit 0 past an open wall; the
    re-entry closing the phase wall-open; the stale "distills the handover" stop; the seal landing
    before a FAIL verdict gate); the 3 pre-existing green.
  - test/config-fix.test.ts: the wall-skip test red (the missing-stamp finding listed the
    corpus-subtree allow pre-fix).
  - test/external-dirs.test.ts: cannot run pre-fix at all — `admittingCoverage`/`pathsOverlap` are
    new exports (import error). Recorded honestly: the evaluator's behavioral fail-before is carried
    by wall.test.ts's coverage test above; the oracle-agreement pin is meaningful only against the
    fixed source.

## Outcome

All five findings fixed under ruling 0189 (D1 008, D2 037, D3 038, D4 076, D5 149). Residuals as the
ruling names: agent-level permission sections, interior-wildcard ancestor keys at depth, deeper
untracked symlinks, no persistent-reopen register — plus 0188's standing residuals.
