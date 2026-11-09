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

Initialized 2026-11-09 at HEAD `7a3f018f8` by step 001. Conventions: one step = one committed unit (a session completes several steps per invocation; an interrupted step is left `doing` and resumed by the next invocation); step records live under [`0240-continuation/`](./0240-continuation/) and are created by their own step; the next free ruling number is **0241** (the red-tests wave's ruling); steps may be appended with the next number, never renumbered.

| # | step | wave | scope | record | status | start HEAD | verification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 001 | init — Program initialization: this table, the coverage list, the current position (this step) | program | — | [001](./0240-continuation/001-init.md) | **done** 2026-11-09 | 7a3f018f8 | typecheck clean; suites at the recorded v0.4.0-cut baselines (measured, not re-run — the cut commit's own verification) |
| 002 | redtests-investigate — Reproduce the seven standing failures at HEAD, root-cause each, write ruling 0241 (Derives/Amends + Category scope per family), disposition every coverage item (fix or consciously ruled retirement with reason), append the enactment steps to this table | red-tests | the six auto failures + the server drift + the D3 timing observation | [002](./0240-continuation/002-redtests-investigate.md) | todo | — | — |
| 003 | shell-refresh-survey — Measure every non-auto-core branch (translate, quota, migrate-hw, dev, and any other `origin/*`): last-commit date, merge-base against auto-core, shell-package presence, the contract's frozen list; record the confirmed merge-target list in the program before any merge | shell-refresh | the branch census | [003](./0240-continuation/003-shell-refresh-survey.md) | todo | — | — |
| 004 | final-audit — Every coverage item dispositioned, the table empty of todo/doing, the recorded baselines green at 0 fail | program | — | [004](./0240-continuation/004-final-audit.md) | todo | — | — |

(The enactment steps the investigation appends — one per fix family — take numbers from 005 upward, inserted into the running order before the final audit; the final audit is always the last row. Shell-merge steps are appended by the survey, one per confirmed target branch, after the red-tests enactment steps.)

## Coverage list

Every item ends fixed, or consciously retired with a named reason recorded in its ruling and step record; no item disappears silently.

1. **auto phased-P1 e2e** — "roadmap-driven establishment, the round-brief proposal channel, and the amend --phases coverage refusal (auto-core plans/0101 D5, 0114 D3, 0115)" — standing pre-existing through 0166 (steps 067/069/073/077/079 measured it identical on pre-fix src).
2. **auto fork e2e ×2** — "fork runs beside a live run lock (plans/0129)"; "the task form's happy path (plans/0128)".
3. **auto remove-fork e2e ×3** — the teardown happy path; uncommitted-work blocks; a live run inside the fork refuses (plans/0139).
4. **auto-server planPrelude boundary matrix** — "the surviving no-agent routes are served, the boundary routes refuse naming transfer" — the known step-050 drift.
5. **The D3 timing observation (0166 step 073)** — packages/auto's frozen-key e2e case measured 4143.79 ms (24 CLI spawns, 83% of bun's 5 s default, past the family guideline 2×; no register row names it) — disposition with the red-tests wave (split or consciously accept, the reason recorded).
6. **The shell-snapshot refresh** — every branch on the survey's confirmed target list merged with auto-core, its checks green; the frozen branches untouched; the census recorded.

## Observations (recorded, not scheduled)

- The agent-fake quota-wait one-off (0166's cross-session pattern, "worth a register row if it recurs again") — not scheduled; a recurrence during any step gets recorded here and may be appended as a step.
- The named residuals of rulings 0168–0239 (0168 D2's count restart, 0169 D4, 0170 D4, 0171 D8, S10-02's e2e, 0231's census edges, 0239's transfer never-init cousin, the 0138 family-check artifact) — standing, each owned in its home; the maintainer opts into any of them by naming it, which appends a step.
- `origin/auto-core` was at the v0.4.0 cut's parent at program start — the maintainer's push of `7a3f018f8` + tags `v0.3.0`/`v0.4.0` may or may not have happened; no step of this program depends on or performs it.

## Current position

- **Active step**: none from the initializing session — step 002 is the first `todo`, the next invocation's act.
- **Latest session (2026-11-09, the initializing session)**: step 001 — this program created (the executable prompt, the status table, the coverage list, this position), the INDEX row landed, the step record written. No code, test or documentation home changed beyond plans/INDEX.md and this program; no suite re-run (the v0.4.0 cut's own verification at `7a3f018f8` is the recorded baseline: core 3319/0; auto 173 pass / 8 skip / 6 fail — the six named in coverage items 1–3; server 177/1 — item 4).
- **Next action**: step **002 (redtests-investigate)** — reproduce the seven standing failures at HEAD, root-cause, write ruling **0241** first, disposition the coverage items, append the enactment steps. Mark 002 `doing` with date and starting HEAD (step 001's commit, recovered from git history), create its step record, then work it under the worker rules.
