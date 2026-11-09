# Step 004 — final-audit

Program 0240, wave program · status: **done** 2026-11-10 (opened at HEAD
`80136392b` — step 003's commit; worked, verified and committed in one
session, branch `auto-core`; this step is the program's last). Authority:
the program's own FINAL COMPLETION clause and row 004 (the program's
Category scope: none — this step is measurement and program bookkeeping
only, no code, test or runtime-documentation home changes, no ruling
number).

## Scope

The program's closing audit, by fresh measurement at this step's HEAD:

1. **Coverage** — every item of the program's coverage list dispositioned,
   and each disposition's owning step itself `done` with its commit landed
   in history (items 1–5 FIXED by steps 005–008, item 6 COMPLETED by the
   step-003 census).
2. **Table** — the status table has no `todo` or `doing` rows once this step
   marks itself done.
3. **Baselines** — every recorded baseline green at 0 fail, the D6-retired
   "seven standing failures" gone (each through its own fix, ruling 0241):
   auto-core `bun typecheck` + `bun test` (recorded 3319/0); `packages/auto`
   `bun x tsgo --noEmit` + full suite (recorded 185/8/0); `packages/auto-server`
   `bun x tsgo --noEmit` + full suite (recorded 177 pass / 1 fail on an
   IPv6-less host — the one red must be exactly the IPv6 observation row by
   name, nothing else; 178/0 on an IPv6-capable host).
4. **Tree and history** — the working tree clean of step-owned leftovers;
   the program's step commits (001, 002, 003, 005, 006, 007, 008 — every
   step before this one) all present in history, this audit's own commit the
   last.

Any check failing its expectation is recorded honestly as a blocker, never
papered over (a genuine defect a small fix owns would need its own appended
step under the protocol). On all checks passing: the program's status and
current position state COMPLETE per the FINAL COMPLETION clause, and this
step commits as a proper step — the program's last.

## Session log

- 2026-11-10 (this worker): step opened at HEAD `80136392b` (verified
  `git log -1 --format=%h`, tree clean, branch `auto-core`, no `doing` step
  before this one — steps 001–003 and 005–008 all done per the table and
  their commits). Program (status table, coverage list, current position,
  FINAL COMPLETION clause), step records 003 and 008 (form), ruling 0241
  (D6's retired baseline — this audit's target) read. Step marked `doing`,
  this record created. Next: the coverage and history checks, then the
  three baseline measurements.
- 2026-11-10 (coverage and history checks): every prior step's commit
  present and naming its step (`git log --grep "^0240: step"` — the map in
  Measured results); every step record on disk (`001`–`008`, this file
  included); ruling 0241's INDEX row landed (with 0240's own). The coverage
  list cross-checked item by item against the table and history (the map
  below) — every disposition's owning step `done`, its commit in history.
  Tree: only this step's own two paths modified (the program document, this
  record) — no unrelated or leftover changes.
- 2026-11-10 (the three baselines, fresh at this HEAD): the exact commands
  and numbers in Measured results — auto-core typecheck exit 0 + suite
  3319/0; `packages/auto` typecheck exit 0 + suite 185/8/0;
  `packages/auto-server` typecheck exit 0 + suite 177 pass / 1 fail, the
  one red verified to be exactly the IPv6 observation row by name and
  nothing else; the host's IPv6-less loopback re-measured (the observation's
  basis). Every check met its expectation — no blocker, no appended step.

## Measured results (all fresh at HEAD `80136392b`, 2026-11-10)

**Coverage × steps × commits** (each disposition's step `done` in the
table, its commit present in history, subject naming the step):

| Coverage item | Disposition (program's list) | Owning step | Step's commit |
| --- | --- | --- | --- |
| 1 — auto phased-P1 e2e | FIXED (0241 D2) | 006 done | `03c7d93f4` |
| 2 — auto fork e2e ×2 | FIXED (0241 D1) | 005 done | `15061be59` |
| 3 — auto remove-fork e2e ×3 | FIXED (0241 D1) | 005 done | `15061be59` |
| 4 — auto-server planPrelude matrix | FIXED (0241 D3) | 007 done | `7edd3fbda` |
| 5 — the D3 timing observation | FIXED (0241 D4) | 008 done | `2ecaa0a16` |
| 6 — the shell-snapshot refresh | COMPLETED (0241 D5, the census) | 003 done | `80136392b` |

Program step commits present in history (7 — every step before this audit;
`git log --grep "^0240: step"`): 001 init `857ce0b18`, 002
redtests-investigate `b0c1b232c`, 005 redtests-fork-fixtures `15061be59`,
006 redtests-phased-p1 `03c7d93f4`, 007 redtests-server-planprelude
`7edd3fbda`, 008 redtests-frozenkey-split `2ecaa0a16`, 003
shell-refresh-survey `80136392b` — this audit's own commit (004) is the
eighth and last, landing with this record.

**Baselines** (verbatim `bun` output; the suites' summaries):

- `auto-core` — `bun typecheck` (`tsgo --noEmit`): **exit 0**. `bun test`:
  **3319 pass / 0 fail**, 21664 expect() calls — "Ran 3319 tests across
  166 files. [170.50s]", exit 0. The recorded baseline (3319/0) held
  exactly.
- `packages/auto` — `bun x tsgo --noEmit`: **exit 0**. `bun test`: **185
  pass / 8 skip / 0 fail**, 2795 expect() calls — "Ran 193 tests across 4
  files. [130.94s]", exit 0. The recorded post-split baseline (185/8/0,
  step 008's measurement) held exactly; the six auto failures of the
  retired seven-name baseline gone (0 fail).
- `packages/auto-server` — `bun x tsgo --noEmit`: **exit 0**. `bun test`:
  **177 pass / 1 fail**, 2292 expect() calls — "Ran 178 tests across 26
  files. [96.83s]", exit 1. The one failing test, by name (the log's only
  distinct `(fail)` row): *"daemon: the spawn boundary's failure shapes
  (plans/0223) > an IPv6 bind writes a bracketed transport URL the worker's
  own validator accepts (0165-169)"* — exactly the program's recorded IPv6
  observation row, nothing else; 0 skips. The drift half of the retired
  seven-name baseline (planPrelude row 3) gone. An IPv6-capable host reads
  178/0 (the observation's split, standing).
- The IPv6-less host re-measured: `ip -6 addr show lo` — **empty** (no
  IPv6 address on the loopback), the observation's basis confirmed at
  audit time.

**The D6 retirement verified**: the "seven standing failures" baseline is
gone by measurement — `packages/auto` at 0 fail (the six auto e2e names:
phased-P1, fork ×2, remove-fork ×3 — each fixed through its own step
005/006) and `packages/auto-server`'s only red the IPv6 environment
observation (never one of the seven; the planPrelude drift fixed through
its own step 007). No failure lives as "the known baseline" anywhere.

**Tree and table**: the working tree carried only this step's two paths at
commit time (verified `git status` — no step-owned leftovers, no unrelated
changes); after this step's own `done` marking the status table holds no
`todo` or `doing` row.

## Verification

- All six coverage items dispositioned with their owning steps `done` and
  commits landed (the map above) — the FINAL COMPLETION clause's first
  condition.
- Every recorded baseline green at 0 fail per its recorded split: core
  3319/0, auto 185/8/0, server 177/1 with the one red exactly the IPv6
  observation row by name (178/0 on an IPv6-capable host) — the clause's
  second condition, measured fresh at this step's HEAD, not quoted.
- The table has no `todo`/`doing` rows once this step marks itself done
  (this record and the program's row update land in this step's commit) —
  the clause's third condition.
- This audit commits as a proper step (the clause's fourth condition);
  every push and any release act remain the maintainer's, per the
  protocol's standing reservation.
- The step's product is measurement and program bookkeeping: no code, test
  or runtime-documentation home changed (`git status` names only the two
  plans/ paths at commit time); no ruling, no INDEX row needed (the
  program's Category scope: none).

## Dispositions

- **The program 0240 is COMPLETE** — the FINAL COMPLETION clause's four
  conditions all verified by fresh measurement (above); the program's
  status line and current position now state COMPLETE, so later invocations
  of the executable prompt terminate immediately at the Part A gate.
- What remains outside the program, the maintainer's own acts: the push of
  `auto-core` (the cut `7a3f018f8` plus the eight program commits 001–004,
  005–008 — seven landed before this audit, this audit's commit the last)
  and any release act; the standing observations list (the IPv6 host split,
  `origin/migrate-hw`, the named residuals of rulings 0168–0239, the
  agent-fake quota-wait one-off) — each opted into by naming it, which
  appends a step to a new or reopened program.

Committed as `0240: step 004 done — …` over the step's two paths (the
program document and this record); the commit's own SHA is not written here
(a record committed inside its step's commit cannot name it — the 0166
convention: a step's SHA lands in the next step's start-HEAD row, and this
is the program's last step). It lives in git history as the program's final
commit, subject naming this step, and in the worker's closing report.
