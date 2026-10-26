# 0128 — the task retry fork: an experiment environment in a worktree, and the run's task stop

The maintainer's request (2026-10-26): *a new sub-command `fork T-NNN <worktree-path>` that builds an
experiment environment in a new directory to retry from the beginning of that task* — then widened to
an exact-commit target (`fork <git-sha> …`) and to a run-side stop (`run --stop-after <T-NNN>`) so the
retry halts once the retried task closes. The model in one sentence: **fork derives the pre-task state
from git's own record (the `Auto-Task` trailer and the `Auto-Nested` alignment), materializes it as
worktrees outside the project, and the run in there stops at the target task — the main tree, its
branches and its history never touched.**

The census behind it: nothing in the corpus retried a task. `rollbackUnit` (git.ts) rolls the
*current* unit back to its own baseline — strict-resume fidelity, not exposed; `close`'s undo hint is
manual `git revert`; `resetInProgress` only clears in-flight marks. A retry meant either rewriting the
main history (P20's forbidden direction) or a hand-built `git worktree` the person assembled themselves.
And the retry needs a stop: `RunAllOpts.stopBefore` stops at planning seams, never after a task — a
retry run in an experiment env would continue through the phase's later tasks, spending tokens on work
the person already has. The naming hazard is named once here: **"fork" already means session forking
inside the corpus** (`forkBase`, `forkSession`, the fork-decompose pipeline — src/session.ts); the
command's fork is git's fork (a worktree of a historical state), the person's word, and the two never
share a surface (the session fork is machinery, never a command).

This ruling Derives: **P20** (in-flight work is never destroyed — the showing: the experiment is
additive worktrees on new branches; the main tree's checkout, branches and history are read, never
written), **P6** (derived state, idempotence, re-derivation — the showing: the fork point is derived
from durable git evidence at command time, nothing persisted, no registry of forks — `git worktree
list` and the branch family are the whole record), **P5** (single ownership — the showing: one new
branch family `auto-fork/*` with one naming rule, and `land`'s stateless original-branch derivation
taught the family so a lingering experiment branch never perturbs a landing), **P7** (grammars, never
content — the showing: the derivation reads the commit-message grammar the driver itself writes,
`Auto-Task:`/`Auto-Nested:`, never a document's meaning), **P16** (genericity — the showing: no
project fact enters; target forms, bounds and families are structural), **P12** (fail loud — the
showing: an underivable nested alignment refuses naming the repository, never silently omits it), and
**P21** (machinery waits for its consumer — the showing: no landing path for `auto-fork/*` and no
`fork --remove`; bring-back and cleanup are the printed plain-git commands, a landing channel deferred
until a consumer rules it). Tier touched: **mechanism** — core src, the shell's surface, tests; no
principle text, no templates.

## Category scope (0123 D1's discipline)

Family: *the person-invoked experiment/retry channel — the fork command, its derivation grammar, its
branch family, and the run-side stop that bounds a retry.* Home-set enumerated at ruling time:

| home | disposition |
|---|---|
| `src/fork.ts` (the command core) | changed — the new home |
| `src/git.ts` (`taskFirstCommit`, `nestedShasAt`) | changed — the derivation grammar's two readers, beside `taskChangedPaths` |
| `src/git-worktree.ts` (`addWorktreeAt`) | changed — the start-point worktree primitive beside `addWorktree` |
| `src/git-land.ts`, `src/land.ts` (the original-branch derivation's family filter) | changed — `auto-fork/*` excluded beside `auto/*` and `auto-lane/*` |
| `src/loop-preflight.ts` (`RunAllOpts.stopAfter`), `src/loop-task.ts` (`runTaskLoop`'s stop checks, `LoopCtx.stopAfterDone`), `src/loop-phase.ts` (the stop's return) | changed — the run-side stop |
| `packages/auto/src/index.ts` (the fork block, the `--stop-after` wiring, the help rows, the refusal surfaces) | changed — the shell's half |
| `test/fork.test.ts`, `test/stop-after.test.ts`, `test/land.test.ts` (the filter case), `packages/auto/test/e2e.test.ts` (the CLI describe), `test/lanes.ts`, `test/import-direction.test.ts` | changed — the test homes and manifests |
| `src/resetInProgress`-family retry surfaces (`src/tasks.ts`, `src/resume.ts`, `src/unit-commit.ts`) | consistent, untouched — strict-resume rollback keeps its own meaning; fork is a new channel, never a rewrite of the in-flight one |
| `src/execute.ts` / `src/session.ts` (the session fork) | consistent, untouched — the naming collision is vocabulary only; no surface shared |
| `src/lanes.ts` (the lane park and `repoRoots`' skip) | consistent, untouched — fork's path bounds (outside the project) keep the park's exclusion the only one needed |
| `prompts/` (the manual suite) | consistent, untouched — a person-driven session assembles its own experiment by hand; the command is the driver-channel's |

## The ruling

**D1 — the two target forms and the derivation.** `fork <T-NNN | sha> <worktree-path> [dir]` (close's
ref-first split; the shape check makes it safe the same way). The task form scans the root repository's
log (`git log -z`, the `taskChangedPaths` walk) for the **oldest** commit whose body carries the exact
line `Auto-Task: T-NNN` and forks at its **parent** — the state before the task *first* started,
interrupted earlier attempts included in what is left behind (a retry from the beginning wants none of
them; a carryover backfill at unit start is itself a task commit, so its parent is the same state). The
sha form forks at the named commit itself (`[0-9a-f]{7,40}`, verified to resolve; the root commit
valid); branch names and tags are deliberately not targets — the person names a state, not a movable
reference. Refusals are usage (exit 1): a task with no commits (it never started — the main tree is its
beginning), the task's first commit being the root commit (no parent exists), an unresolvable sha.

**D2 — the environment is self-resetting; nested repositories are reconstructed, aligned.** `.auto/`
is gitignored, so the worktree starts with no runtime state; the task documents at the fork commit
already say pending (`todo.md` present, the index line unticked by construction), and `loadPlan` reads
exactly that — no reset machinery. A worktree of the outer repo materializes only the outer repo, so
each nested repository (`repoRoots`, discovered now) is reconstructed as its **own** worktree of its
own repository at `<worktree-path>/<rel>`: the state the fork commit's `Auto-Nested: <rel> @ <sha>`
lines record — the alignment record every root driver commit writes, read back for the first time. The
task form alone has a fallback (the parent of the nested repository's own oldest `Auto-Task` commit —
for a fork commit that records no alignment, a person commit); the sha form's record is the alignment
or the fork refuses naming the repository (P12: a silently missing nested repo is a trap, never a
degradation). The recursive unified commit then works in the experiment unchanged — nested first, the
fork root last.

**D3 — the branch family, the path bounds, the exit contract.** One branch `auto-fork/<target>` (the
task id, or the 7-char short sha), first-free suffix `-2`, `-3`… across *every* repository of the fork
so one coherent name works everywhere; a third reserved family, and `land`'s stateless derivation
(land.ts) is taught it in the same change — a lingering experiment branch never blocks or masquerades
as an original branch. The worktree path is the person's one placement decision, checked before
anything is derived: it must not exist, must not lie inside the project (a worktree there holds a
`.git` entry and `repoRoots` — which skips only the lane park — would misread it as a nested
repository), and must not contain the project. All refusals before any git state is touched (land's
two-pass shape); a creation failure midway is blocked (exit 2) naming the partial scene and the cleanup
commands. Success prints what each repository sits at, the run hint, and the per-repo cleanup lines —
bring-back and teardown are plain git (P21: no landing machinery, no `--remove`, until a consumer
rules them). Fork holds the run lock itself (`takeRunLock("fork")`, land/close's posture — it writes
refs), so it is absent from the config-commands' live-lock refusal list.

**D4 — `run --stop-after <T-NNN>`.** A run-side width (never a config key, never persisted — the
`--repair` family): the task whose completion ends this run. The stop checks live in `runTaskLoop`'s
serial arm: after a unit closes, if it is the target and the reloaded file state says done (a parked
unit also returns 0 without being done — the file settles it, and a parked target keeps scheduling
around it exactly as without the flag), the run ends cleanly — one `■` line, exit 0, the phase's
remaining tasks and its handover staying for the next run; the stop lands *before* the regression
boundary launches anything new (the next run re-derives it). An already-complete target stops at once;
a target outside the routed phase's index is a usage error (exit 1 — a typo never silently
never-stops). Because `runTaskLoop`'s plain 0 means "phase complete, route the close-out", the stop
signals through `LoopCtx.stopAfterDone` and the phase loop returns before the handover — the boundary
stop's own lines stay absent (the run ended a task early, not at the phase's clean end). The serial
path alone: the confinement refusal fires before any concurrent shape dispatches (the isolation
switch, the readiness scheduler, the doc lanes — a stop mid-flight would strand in-flight work), the
`--repair` posture.

**D5 — the shell surface.** `fork` takes no options at all (any flag is a usage error); its
`COMMANDS` row and `OPTION_HELP` topic state both target forms and the self-resetting guarantee.
`--stop-after` is run's alone: `VALUE_FLAGS`, the format check beside `parseRepairBudget`, the
`RUN_OPTION_REFUSALS` row (plan and transfer refuse it), the init/amend backstop and the init pointers
row, the run row's synopsis and options. Exit codes as the contract: 0 forked / 1 the target or path
cannot give what was asked / 2 blocked midway; run's own codes unchanged (the stop is a clean 0).

## Enactment

`src/fork.ts` (`forkTask`, the `ForkOutcome` contract, land's shape), `taskFirstCommit` +
`nestedShasAt` in `src/git.ts`, `addWorktreeAt` in `src/git-worktree.ts`, the `land.ts`/`git-land.ts`
filter, `RunAllOpts.stopAfter` + the serial arm's three checks + `stopAfterDone` + the loop-phase
return, the shell's fork block and `--stop-after` wiring. Tests: `test/fork.test.ts` (both forms'
happy paths — the interrupted-attempt exclusion pinned — the branch suffix, the nested record and
fallback and refusal, the usage matrix, the untouched main tree), `test/stop-after.test.ts` over the
loop harness (the post-unit stop, the already-complete stop, the typo guard, the confinement, the
before-boundary discriminator, the continuation run), the `land.test.ts` filter case, the e2e describe
(argument checks, help rows, the lock refusal, both forms through the real CLI, `--stop-after`'s
surface), the lane manifest and import-direction rows.

Verification: full typecheck clean; both suites green (auto-core 2772, the shell 146); the closing read
below ran the real CLI on a scratch project.

## The closing read

A scratch project (`init`, a checkpoint, two hand-made `Auto-Task` trailer commits, a nested
repository aligned through the real `commitTree`): `fork T-002 <path>` creates the root worktree at
the pre-task commit and the nested one at its recorded SHA, prints the run hint with `--stop-after
T-002` and the cleanup lines; `fork <sha> <path>` lands at the commit itself on `auto-fork/<short>`;
the second fork of the same task takes `-2`; `fork T-099` refuses naming the trailer; a live lock
refuses with the lock lines; the main tree's HEAD and checkout never move.
