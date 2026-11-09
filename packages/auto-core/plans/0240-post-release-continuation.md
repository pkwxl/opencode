# 0240 — The post-release continuation program: a committed, resumable queue

Status: **active**. Initialized 2026-11-09 (step 001) at HEAD `7a3f018f8` (the v0.4.0 cut), by the coordinating session that executed the cut, at the maintainer's instruction ("build a prompt file so that I can run it to continue all the jobs in sessions even if a session breaks"). Standing instruction from the maintainer (the 0166 amendment, carried forward): an invocation may work directly or **delegate each step's work to one child working session launched sequentially** — one step at a time, each committed before the next begins.

This document carries the executable prompt for the outstanding post-v0.4.0 work. The work runs as a sequence of independent, single-session steps: each invocation of the prompt recovers any unclean predecessor state, then completes consecutive proper steps — each individually verified and committed before the next begins — until the session's budget no longer safely admits another step or the program has no subsequent work. The program's durable position lives in this document and under [`0240-continuation/`](./0240-continuation/), never in conversation history alone. It is the 0166 protocol applied to the post-release queue; the 0166 program itself is COMPLETE and its own prompt terminates at its Part A gate — this program is the only active one.

## Derivation and Category scope

Derives: P18, P6 and P4 — method only, the 0166 derivation carried forward. P18 shows in plain files and git as the durable state (this document and the step records, never conversation memory); P6 shows in every worker re-deriving the actual position from disk, diffs and commits; P4 shows in the verified commit as the completion condition of every proper step. Tier: none — an execution and governance record, no product mechanism ruled.

### Category scope

None. This document changes no requirement family and no code, test or runtime-documentation home. Each work wave it schedules (the red-tests round, the shell-snapshot refresh) requires its own numbered ruling with Derives/Amends, tier, Category scope, code homes and test homes in the same change (0110 D5, 0123) — the red-tests round's ruling is expected to be 0241.

## Executable prompt

Run the following prompt from `packages/auto-core`. The same text is used for every invocation; each invocation performs the whole protocol directly (or delegates per the standing instruction below) and never schedules another task.

```text
Execute the next scheduled step of the 0240 post-release continuation program.

You are the worker (working directly, or the coordinating invocation delegating
each step to one child working session launched sequentially — one step at a
time, each committed before the next begins; never two steps in flight). This
protocol behaves identically whether it runs as an ordinary interactive session
or any unattended task.

Never call OffPeakCreate, OffPeakList, CronCreate or any other scheduling
facility, and never launch an idle-time task; a later manual invocation of
this same prompt resumes the program. Ordinary build, test and git subprocesses
are allowed. Do not ask the maintainer to select work or approve the next
step. Do not push, tag, publish or create a release — every push is the
maintainer's own act, including branch pushes after shell-snapshot merges.

AUTHORITATIVE INPUT

- plans/0240-post-release-continuation.md, this program's durable home.
- plans/0240-continuation/, containing step records.
- AGENTS.md, docs/principles.md, docs/structure.md, plans/INDEX.md,
  docs/shell-contract.md (the branch table and the merge flow), and for the
  red-tests wave the 0166 records that established each standing baseline:
  plans/0166-remediation/ (steps 050/067/069/073/077/079 name the six auto
  failures and the one server drift as pre-existing, by name).

PART A — REMAINING-WORK GATE

1. Read the program's status table and current-position section. Determine
   whether subsequent work exists: a `doing`, `todo` or recoverable
   incomplete step, or an unfinished final audit.
2. If no subsequent work exists, terminate immediately with a short statement
   that the program is complete. Do not make any edits.
3. Otherwise proceed directly to Part B in this same session.

PART B — WORKER: CONSECUTIVE COMMITTED, RECOVERABLE STEPS

The session may be terminated at any point; treat every moment as a possible
interruption. It completes whole proper steps one at a time — each recovered,
executed, verified and committed before the next begins — and keeps accepting
further steps while its budget safely allows (when a time limit is known,
begin a next step while more than one hour remains, even if it plausibly will
not finish inside the budget, because an interrupted step is recoverable by
the next invocation; with no limit known, continue until the maintainer stops
the session or no subsequent work exists). Write recovery state early and
often; never schedule a successor.

WORKER STARTUP AND UNCLEAN-STATE RECOVERY

1. Read AGENTS.md, the program and the active step record. Re-read the
   program's status table and current position from disk at the start of
   every session — conversation memory is never the position authority.
2. Inspect `git status`, `git branch --show-current`, relevant diffs and
   recent commits (on the branch the step record names — a shell-merge step
   may legitimately leave the repository on a shell branch; the record says
   which). An unclean tree is expected after interruption and is not, by
   itself, a reason to stop.
3. Select the first `doing` step in table order. If work exists but no step
   is marked `doing`, reconstruct the owning step from the program, step
   records, diffs and commit history, restore it to `doing`, and continue.
4. Resume from the recorded next action, but verify against disk and git what
   actually landed. Never assume an edit, test or commit completed merely
   because the record says it was attempted.
5. If the previous step's changes are complete, verify them and finish its
   documentation and commit. If partial or incorrect, continue or repair them
   within that same step. Do not begin another step while the previous step
   owns unresolved changes.
6. If the latest commit already landed the step but the program's metadata
   was not updated, reconcile the metadata without duplicating the
   implementation. Do not amend or rewrite existing commits.
7. Preserve all in-flight and user-authored work. Never use `reset --hard`,
   `clean`, `checkout --`, `restore`, or `stash` to make recovery easier.
   One sanctioned exception: a conflicted or in-flight `git merge` belonging
   to the CURRENT step's own shell-snapshot merge may be aborted with
   `git merge --abort`, returning the branch to the step's recorded starting
   commit — the abort is the step's own rewind of its own uncommitted merge,
   never a destruction of others' work; the step record names the starting
   commit before the merge begins.
8. Distinguish step-owned changes from unrelated pre-existing changes. Leave
   unrelated changes untouched and uncommitted; name them if they prevent a
   safe, isolated commit.
9. Only when no prior work requires recovery, select the first `todo`, mark
   it `doing`, record the date and starting HEAD, and create its durable
   step record before editing.

EXECUTION RULES

- Stay with the selected step until it is committed, or until a genuine
  external blocker is recorded in the step record and the program.
- Process each change through its requirement family, not just the files the
  incident names. Answer the constitutional boundary from docs/principles.md
  first, then enumerate the family's homes. Each work wave needs its own
  numbered ruling (the next free number is recorded in the program's current
  position) with Derives/Amends, tier, Category scope, INDEX row and any
  navigation line, landed together with the enactment.
- Add regression coverage that fails for the defect and passes for the fix;
  prove fail-before where behavior changes (the 0166 method: swap pre-fix
  bytes via `git show`, run red, restore, cmp-verify byte-identical).
- Do not broaden a step into unrelated cleanup. Record newly discovered
  issues in the program's observations list without losing the step's scope.
- A step may append new steps to the status table when its work reveals the
  need (the investigation step is expected to): append with the next table
  number, never renumber existing rows, and record why in the step record.
- Update the program's current position and the active step record after
  every meaningful edit, test run or discovered blocker. Before any long
  operation or anticipated stop, record the exact next action.
- If a step cannot be completed before the session ends, leave it `doing`
  with its changes intact and a precise recovery record (naming the branch
  checked out). Do not make a WIP commit and do not schedule a successor.

SHELL-SNAPSHOT MERGE STEPS (additional rules)

- The frozen branches named in docs/shell-contract.md's branch table
  (`auto`, `migrate`) are never merge targets. The survey step's recorded
  target list is authoritative; a branch not on it is not merged.
- Before each merge, the step record names: the target branch, its starting
  HEAD, the merge base against auto-core, and divergence in shell-owned
  files (a shell branch must never have modified packages/auto-core; if it
  has, stop and record the blocker — the contract violation is the
  maintainer's to resolve, not the worker's to paper over).
- Merge auto-core into the target branch on a local checkout of that branch;
  resolve conflicts only in shell-owned files; run that shell's typecheck
  and test suite and auto-core's, all green at their recorded baselines
  (the red-tests wave lands before this wave, so the baselines are 0-fail);
  commit the merge on the shell branch; switch back to auto-core before
  updating the program (the program document is edited and committed on
  auto-core only, as its own bookkeeping commit or folded into the step's
  program update — never on the shell branch).
- Never push the merged branch.

VERIFICATION AND COMMIT PROTOCOL

Run focused regression tests and the affected package checks (auto-core
`bun typecheck` + `bun test`; the touched shells' `bun x tsgo --noEmit` +
suites; template changes run the named prompt suites per AGENTS.md).
Distinguish new failures from the recorded baselines and report both
honestly. A proper step is coherent, verified, documented and leaves the
affected packages green at their baselines. When complete: update the step
record and the program (verification results, dispositions, status `done`);
stage only the step's paths; commit with a subject naming the step. If a
commit fails, record the error and recovery action; leave verified changes
intact. After a successful commit note the SHA in the step record; do not
create bookkeeping-only commits merely to write SHAs into the program.

Finish the worker with: each step worked this session (one line: step,
disposition, commit SHA); whether interrupted work was recovered; files and
ruling documents changed; tests/checks run with exact results; the commit
SHA or why none; residuals and blockers; the next program step.

FINAL COMPLETION

The program is complete when the coverage list is fully dispositioned, the
final audit step finds every recorded baseline green (auto-core and the
touched shells at 0 fail — the seven standing failures gone, each through
its own fix or a consciously ruled retirement), the table has no `todo` or
`doing` rows, and the audit is committed as a proper step. Pushing the
resulting branches and any release act remain the maintainer's.
```

## Program status

Initialized 2026-11-09 at HEAD `7a3f018f8` by step 001. Conventions: one step = one committed unit (a session completes several steps per invocation; an interrupted step is left `doing` and resumed by the next invocation); step records live under [`0240-continuation/`](./0240-continuation/) and are created by their own step; the next free ruling number is **0242** (0241 taken by the red-tests wave's ruling, [0241](./0241-redtests-root-causes.md)); steps may be appended with the next number, never renumbered.

| # | step | wave | scope | record | status | start HEAD | verification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 001 | init — Program initialization: this table, the coverage list, the current position (this step) | program | — | [001](./0240-continuation/001-init.md) | **done** 2026-11-09 | 7a3f018f8 | typecheck clean; suites at the recorded v0.4.0-cut baselines (measured, not re-run — the cut commit's own verification) |
| 002 | redtests-investigate — Reproduce the seven standing failures at HEAD, root-cause each, write ruling 0241 (Derives/Amends + Category scope per family), disposition every coverage item (fix or consciously ruled retirement with reason), append the enactment steps to this table | red-tests | the six auto failures + the server drift + the D3 timing observation | [002](./0240-continuation/002-redtests-investigate.md) | **done** 2026-11-10 | 857ce0b18 | no code/test home changed; auto 173/8/6 + server 176/2 (this host; 177/1 recorded baseline, the +1 the IPv6 observation) reproduced and root-caused, every cause measured, three by one-line mechanism probes restored cmp-verified; typecheck exit 0 |
| 003 | shell-refresh-survey — Measure every non-auto-core branch (translate, quota, migrate-hw, dev, and any other `origin/*`): last-commit date, merge-base against auto-core, shell-package presence, the contract's frozen list; record the confirmed merge-target list in the program before any merge | shell-refresh | the branch census | [003](./0240-continuation/003-shell-refresh-survey.md) | **done** 2026-11-10 | 2ecaa0a16 | census recorded (below), confirmed merge-target list **empty** — zero merge steps appended; no code/test home changed; typecheck exit 0 |
| 005 | redtests-fork-fixtures — Ruling 0241 D1: the two `taskProject` helpers' trailer commits to the driver's one-paragraph shape (0173 D2's grammar stands); fail-before the five standing reds | red-tests | packages/auto/test/e2e.test.ts | [005](./0240-continuation/005-redtests-fork-fixtures.md) | **done** 2026-11-10 | b0c1b232c | fail-before the five reds re-confirmed at this HEAD; five green at the fix; auto 178/8/1 (only phased-P1 red) + typecheck exit 0; core 3319/0 + typecheck exit 0 |
| 006 | redtests-phased-p1 — Ruling 0241 D2: the phased-P1 walkthrough's person-commit step at the taught channel (0207 D1's scoped commits and the start-clean gate stand); fail-before the standing red | red-tests | packages/auto/test/e2e.test.ts | [006](./0240-continuation/006-redtests-phased-p1.md) | **done** 2026-11-10 | 15061be59 | fail-before the standing red re-confirmed at this HEAD (exit 2 at the re-run); green at the fix (1/0, 20 expects); auto **179/8/0** + typecheck exit 0 — the six-name baseline fully cleared; core 3319/0 + typecheck exit 0 |
| 007 | redtests-server-planprelude — Ruling 0241 D3: the server's planPrelude matrix row 3 lockstepped to 0206 D2's refusal shape (409 naming transfer, nothing written); fail-before the standing red | red-tests | packages/auto-server/test/ops.test.ts | [007](./0240-continuation/007-redtests-server-planprelude.md) | **done** 2026-11-10 | 03c7d93f4 | fail-before the standing red re-confirmed at this HEAD (409 where 200 expected; the body captured verbatim, byte-identical to step 002's measurement); green at the fix (1/0, 56 expects); auto-server **177/1** (the IPv6 host row the only red — the recorded observation) + typecheck exit 0; core 3319/0 + typecheck exit 0 |
| 008 | redtests-frozenkey-split — Ruling 0241 D4: the frozen-key e2e split per family (0224 D4's form, 0233 D3's deferral discharged), the per-test spawn count under the guideline; coverage identical | red-tests | packages/auto/test/e2e.test.ts | [008](./0240-continuation/008-redtests-frozenkey-split.md) | **done** 2026-11-10 | 7edd3fbda | fail-before the census re-measured at HEAD (monolith 3.39/3.36 s focused, structurally red at 2500.10 ms under --timeout 2500 — the guideline bound); split into the seven 0241-D4 families, rows byte-identical (47/47 lines diffed; 25 spawns, 81 expects — exactly the monolith's), each piece green under --timeout 2500 (largest, the 16-spawn loop, 2.12 s file time ≈ 1.9–2.0 s own; arms 235–360 ms); auto **185/8/0** (179−1+7, the predicted count; baseline 0 fail held) + typecheck exit 0; core 3319/0 + typecheck exit 0; coverage item 5 closed FIXED, 0233 D3's deferral discharged |
| 004 | final-audit — Every coverage item dispositioned, the table empty of todo/doing, the recorded baselines green at 0 fail | program | — | [004](./0240-continuation/004-final-audit.md) | todo | — | — |

(The enactment steps the investigation appends — one per fix family — take numbers from 005 upward, inserted into the running order before the final audit; the final audit is always the last row. Appended 2026-11-10 by step 002 per ruling 0241: rows 005–008 sit between the survey and the final audit — the survey changes nothing, and the fixes land before any merge step the survey appends. Shell-merge steps are appended by the survey, one per confirmed target branch, after the red-tests enactment steps. Survey outcome, appended 2026-11-10 by step 003: the confirmed merge-target list is **empty** — zero shell-merge rows exist, numbers 009 upward stay free, and the final audit is the only remaining row.)

## Shell-refresh census (step 003, 2026-11-10 — the confirmed list's authority)

The confirmed merge-target list is **EMPTY**. Measured over refs at auto-core `2ecaa0a16` (full table and the confinement probes in [the step record](./0240-continuation/003-shell-refresh-survey.md)):

- `origin/auto` — **frozen** (contract §D); tip `b8cf8eb18` 2026-08-26; fully contained in auto-core (nothing to merge anyway); carries the pre-split monolith only.
- `origin/dev` — the upstream opencode line (the fork point), tip 2026-08-10; fully contained.
- `origin/migrate` — **frozen** (contract §D); tip `e4cf244a5` 2026-09-10; 43 own commits beyond base `2f2b20a09`; carries `packages/auto-migrate`; its divergence strictly shell-owned (13 paths, 0 under `packages/auto-core`).
- `origin/migrate-hw` — tip `32630280b` 2026-09-12 = migrate + one merge of the auto-core-side `fix/core-timeout-retry` hotfix (both predate the 2026-09-22 freeze); not in the contract's branch table → **not a registered live shell branch**, not a merge target; clean (0 `packages/auto-core` paths in its base diff) — recorded in observations for the maintainer.
- `origin/quota`, `origin/translate` — old core-development lines (0068's design; `packages/auto` contract work), tips 2026-10-01 / 2026-09-26; both fully contained.
- `local-src/auto-core` — a stale same-name fetch of auto-core itself (2026-10-23, the 0105 era); excluded by name, fully contained.

The shells that evolve (`packages/auto`, `packages/auto-server`) live on auto-core itself — no snapshot refresh exists to perform. The frozen branches' refs measured untouched at their recorded tips.

## Coverage list

Every item ends fixed, or consciously retired with a named reason recorded in its ruling and step record; no item disappears silently. Dispositions recorded 2026-11-10 by step 002 under ruling [0241](./0241-redtests-root-causes.md) (the root causes measured there; items 1–4 fixed by enactment steps 005–008, item 5's observation dispositioned, item 6 stays scheduled):

1. **auto phased-P1 e2e** — "roadmap-driven establishment, the round-brief proposal channel, and the amend --phases coverage refusal (auto-core plans/0101 D5, 0114 D3, 0115)" — standing pre-existing through 0166 (steps 067/069/073/077/079 measured it identical on pre-fix src). **Disposition: FIXED by step 006 (0241 D2)** — root cause 0207 D1's scoped release-consumption commits (0166 step 047); the walkthrough rode the pre-0207 dirt-absorbing brief-install commit, never committing init's config layer; the product stands, the test's person-commit step is the fix.
2. **auto fork e2e ×2** — "fork runs beside a live run lock (plans/0129)"; "the task form's happy path (plans/0128)". **Disposition: FIXED by step 005 (0241 D1)** — root cause 0173 D2's trailer-block read in `taskFirstCommit` (0166 step 013) vs the fixtures' `-m`-paragraphed trailer commits (a body shape `message()` never writes); the reader's grammar stands, the fixtures lockstep.
3. **auto remove-fork e2e ×3** — the teardown happy path; uncommitted-work blocks; a live run inside the fork refuses (plans/0139). **Disposition: FIXED by step 005 (0241 D1)** — same root cause as item 2 (both `taskProject` helpers).
4. **auto-server planPrelude boundary matrix** — "the surviving no-agent routes are served, the boundary routes refuse naming transfer" — the known step-050 drift. **Disposition: FIXED by step 007 (0241 D3)** — root cause 0206 D2's lockstep (0166 step 046) missed the server's mirror row; the server row locksteps to the refusal shape.
5. **The D3 timing observation (0166 step 073)** — packages/auto's frozen-key e2e case measured 4143.79 ms (24 CLI spawns, 83% of bun's 5 s default, past the family guideline 2×; no register row names it) — disposition with the red-tests wave (split or consciously accept, the reason recorded). **Disposition: FIXED by step 008 (0241 D4)** — the split chosen over acceptance: 0224 D4's standing family form, coverage identical, 0233 D3's deferral discharged; re-measured 3056–3060 ms at HEAD on this host (past the guideline on both hosts).
6. **The shell-snapshot refresh** — every branch on the survey's confirmed target list merged with auto-core, its checks green; the frozen branches untouched; the census recorded. **Disposition: COMPLETED by step 003 (0241 D5)** — the census (2026-11-10) confirmed the merge-target list **empty**: the only divergent branches are the frozen `migrate` line (`migrate` frozen by contract; `migrate-hw` its unregistered 2026-09-12 hotfix derivative, no branch-table row), every other branch fully contained in auto-core, and the evolving shells (`packages/auto`, `packages/auto-server`) live on auto-core itself. Every branch on the empty list merged (vacuously); the frozen branches measured untouched; the census recorded. No merge exists to perform — 0241 D5's "merge steps it appends" number zero, the count left to the survey by the ruling itself.

## Observations (recorded, not scheduled)

- The agent-fake quota-wait one-off (0166's cross-session pattern, "worth a register row if it recurs again") — not scheduled; a recurrence during any step gets recorded here and may be appended as a step.
- The named residuals of rulings 0168–0239 (0168 D2's count restart, 0169 D4, 0170 D4, 0171 D8, S10-02's e2e, 0231's census edges, 0239's transfer never-init cousin, the 0138 family-check artifact) — standing, each owned in its home; the maintainer opts into any of them by naming it, which appends a step.
- `origin/auto-core` was at the v0.4.0 cut's parent at program start — the maintainer's push of `7a3f018f8` + tags `v0.3.0`/`v0.4.0` may or may not have happened; no step of this program depends on or performs it. (2026-11-10, step 003: measured `origin/auto-core` at the cut `7a3f018f8` — the push happened; the six program commits 001–008 since remain local.)
- (2026-11-10, step 003 — the census's one judgment call, recorded for the maintainer) `origin/migrate-hw` exists: the frozen migrate line's derivative (tip `32630280b` 2026-09-12 = migrate + one merge of the auto-core-side `fix/core-timeout-retry` hotfix, both predating the 2026-09-22 freeze), carrying the `auto-migrate` shell with divergence strictly shell-owned (0 `packages/auto-core` paths). The contract's branch table — its own registry of the shells that exist — has no row for it, so the survey did not count it a live shell branch and did not merge into it. Registering, refreshing or retiring it is the maintainer's act; naming it appends a step.
- (2026-11-10, step 002) auto-server's "an IPv6 bind writes a bracketed transport URL (0165-169)" fails on this host — `EADDRNOTAVAIL` on `::1`, the loopback carries no IPv6 address (measured: `ip -6 addr show lo` empty, a minimal `Bun.serve({hostname: "::1"})` reproduces). The recorded v0.4.0-cut baseline (177/1) was measured on an IPv6-capable host. Host-environment, not a code defect and not a coverage item (0241's finding text); the suite reads 176/2 here, 177/1 on an IPv6 host.
- (2026-11-10, step 002, from 0241's named residuals) the process finding behind two root causes: 0166 steps 013 and 047 changed core behavior that shell e2e suites pin, and each step's verification ran the core suite only — the shell flips went undetected for 16 and 3 steps, then lived as "the known baseline" through a release cut. The 0240 protocol's verification text already names the touched shells' suites; no rule change made, the gap recorded as case law.

## Current position

- **Active step**: none — step 003 **done** 2026-11-10 (its commit names the step); the next act is the program's recorded sequence.
- **Latest session (2026-11-10, the step-008 worker)**: ruling 0241 D4 enacted — the frozen-key e2e case in `packages/auto/test/e2e.test.ts` (:710) split into the seven named families (the 16-spawn frozen-constitutional loop; the --phases remedy arm; the paired revision hints; the short-form arm; the retirement arms; the rename arms; the loneliness arm), 0224 D4's standing form with the server's own split as precedent, a describe-level rule comment carrying the split-again law (growth of the frozen vocabulary grows the TEST COUNT, never one test's runtime). Coverage identical, mechanically proven: every flag row, spawn line and assertion byte-identical against the monolith (`git show` diff — 47/47 lines, the only diff the seven per-family fresh-dir lines); 25 spawns and 81 expects, exactly the monolith's counts. Fail-before: the census re-measured at this step's HEAD `7edd3fbda` — the monolith 3.39/3.36 s focused (two consecutive runs), structurally red at 2500.10 ms under `--timeout 2500` (the guideline bound, roughly half the 5 s default). After the split every piece green under the same bound: the loop 2.12 s file time (own ≈ 1.9–2.0 s), the arms 235–360 ms; the slow-host projection (0.173 s/spawn, step 073's measured rate) puts the loop ≈ 2.77 s — 55% of the default, the corpus's standing largest-family scale (0233 D2's own ≈ 2.7 s precedent). `packages/auto` **185 pass / 8 skip / 0 fail** (exactly 179−1+7) + typecheck exit 0; auto-core **3319/0** + typecheck exit 0. Coverage item 5 closed FIXED — **0233 D3's deferral discharged**; the red-tests wave (005–008) complete, both shell suites at 0 fail on this host's class (the IPv6 observation aside).
- **Next action**: step **004 (final-audit)** — the last open row: every coverage item dispositioned (1–5 FIXED, 6 COMPLETED by the census), the table empty of todo/doing after this step's own marking, every recorded baseline green at 0 fail (auto-core typecheck + full suite at 3319/0; `packages/auto` 185/8/0 + typecheck; `packages/auto-server` 177/1 on an IPv6 host — 178/0 on an IPv6-capable one, the observation's split — the D6-retired "seven failures" baseline gone). The audit is committed as a proper step; any push remains the maintainer's.
- **Latest session (2026-11-10, the step-003 worker)**: the branch census executed over refs at HEAD `2ecaa0a16` (no checkout, no merge, the tree never left auto-core) — every ref under `refs/heads`/`refs/remotes` enumerated, seven branches measured. Only the migrate line diverges from auto-core: `origin/migrate` (43 own commits beyond base `2f2b20a09`, carrying `packages/auto-migrate`, divergence strictly shell-owned — 13 paths, 0 under packages/auto-core) is **frozen by contract**; `origin/migrate-hw` (44 beyond base `cc0bba0fd` = migrate + one 2026-09-12 merge of the auto-core-side `fix/core-timeout-retry` hotfix, clean the same way) has **no row in the contract's branch table** — not a registered live shell branch, not merged, recorded in observations for the maintainer. `origin/auto` (frozen), `origin/dev` (the upstream fork point), `origin/quota` and `origin/translate` (old core-dev lines) are all fully contained — nothing to merge; `local-src/auto-core` is a stale same-name fetch. **Confirmed merge-target list: empty** — zero shell-merge rows appended (numbers 009+ stay free), the frozen branches measured untouched, the census recorded in the program before any merge (there is none). Coverage item 6 COMPLETED at the survey (0241 D5 — the merge-step count left to the survey by the ruling); no new ruling (the wave's authority 0241 D5 already landed); no code, test or runtime-documentation home changed; `bun typecheck` exit 0. Also measured: `origin/auto-core` now at the cut `7a3f018f8` (the maintainer's push happened; commits 001–008 remain local).
- **Latest session (2026-11-10, the step-007 worker)**: ruling 0241 D3 enacted — the planPrelude boundary matrix's drift row in `packages/auto-server/test/ops.test.ts` (:628) lockstepped to 0206 D2's refusal shape (409, code 1, the differs/transfer fragments with the full `transfer ${dir}` command, nothing written: the index byte-identical, no P02-design, no P03-implement seed, P02-implement's open todo unmoved); the row's comment and the header's "drift re-sync" phrase restate the 0206 channel (transfer the reshape's one apply). Fail-before: the standing red re-confirmed at this step's HEAD `03c7d93f4` (409 where 200 expected; a one-run body-dump probe captured the 409 body verbatim, byte-identical to step 002's measurement). `packages/auto-server` **177 pass / 1 fail** — the IPv6 host-environment row the only red (the recorded observation, not a coverage item; an IPv6-capable host reads 178/0) — typecheck exit 0; auto-core **3319/0** at its baseline, typecheck exit 0. Coverage item 4 closed FIXED; 0206 D2's category completeness completed late (no src change anywhere — the test row was the fix).
- **Latest session (2026-11-10, the step-006 worker)**: ruling 0241 D2 enacted — the phased-P1 walkthrough in `packages/auto/test/e2e.test.ts` (:1894) gained the person's `commitFixture(dir)` at the taught channel (after the stub transfer, before the released analysis's write — the recommended placement, so the released document rides the brief-install commit as its evidence, 0207 D1's uncommitted-hand-release arm; the comment teaches both halves). Fail-before: the standing red re-confirmed at this step's HEAD `15061be59` (exit 2 at the re-run); green at the fix (1/0, 20 expects). `packages/auto` **179 pass / 8 skip / 0 fail** — the six-name baseline fully cleared for this package (0241 D6's retirement now measured fact here) — typecheck exit 0; auto-core **3319/0** at its baseline, typecheck exit 0. Coverage item 1 closed FIXED.
- **Next action**: step **007 (redtests-server-planprelude)** — ruling 0241 D3: the server's planPrelude matrix row 3 lockstepped to 0206 D2's refusal shape (409 naming transfer, nothing written) in `packages/auto-server/test/ops.test.ts`; fail-before is its standing red; then 008 in table order.
- **Latest session (2026-11-10, the step-005 worker)**: ruling 0241 D1 enacted — the two `taskProject` helpers in `packages/auto/test/e2e.test.ts` (fork :3867, remove-fork :3992) lockstepped to the driver's one-paragraph trailer shape (the trailers as ONE `-m` paragraph, `message()`'s exact output verified byte-level in a scratch repo); the fork helper's stale belief comment restated to the real grammar (0173 D2's last-paragraph read named); the reader untouched (P13). Fail-before: the five standing fork-family reds re-confirmed at this step's HEAD `b0c1b232c` (fork describe 4/2, remove-fork describe 2/3 — the same five by name); green at the fix (6/0 and 5/0). `packages/auto` **178 pass / 8 skip / 1 fail** — the six-name baseline dropped to the one expected red (phased-P1, step 006's); both typechecks exit 0; auto-core **3319/0** at its baseline. Coverage items 2 and 3 closed FIXED.
- **Next action**: step **006 (redtests-phased-p1)** — ruling 0241 D2: the phased-P1 walkthrough's person-commit step at the taught channel in `packages/auto/test/e2e.test.ts` (a `commitFixture(dir)` after the stub transfer, before the released analysis's re-run); fail-before is its standing red (confirmed the sole failure in the 005 verification run); then 007, 008 in table order.
- **Latest session (2026-11-10, the step-002 worker)**: the seven standing failures reproduced at HEAD `857ce0b18` and every one root-caused — the fork family ×5 to 0173 D2's trailer-block read vs the fixtures' `-m`-paragraphed trailer commits (proven by reverting only that read: all five green); the phased-P1 walkthrough to 0207 D1's scoped brief-install commit (the test rode the pre-0207 dirt absorption; proven by the pathspec-drop probe green and the committed-flow CLI repro exit 0); the server planPrelude row 3 to 0206 D2's lockstep missing the server's mirror row (the 409 body measured verbatim); the timing case re-measured past the guideline on both hosts. Ruling **0241** written (INDEX row landed); coverage items 1–4 dispositioned FIXED to enactment steps 005–008 (appended to the table, between the survey and the final audit), item 5 fixed by the split, item 6 stays scheduled; the IPv6 host finding and the 0166 process gap recorded in observations. No code, test or runtime-documentation home changed.
- **Next action**: step **005 (redtests-fork-fixtures)** — ruling 0241 D1: the two `taskProject` helpers' trailer commits to the driver's one-paragraph shape in `packages/auto/test/e2e.test.ts`; fail-before is the five standing reds (reproduced and dated by step 002); then 006, 007, 008 in table order.
