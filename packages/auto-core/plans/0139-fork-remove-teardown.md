# 0139 — remove-fork: the teardown of the experiment environment, and the retry loop closed

The maintainer's request (2026-10-27): *a `remove-fork <worktree-path>` to clean up a fork so that we can
retry.* The model in one sentence: **remove-fork is the exact inverse of fork — every worktree of the fork
removed and its one branch name deleted in each of its repositories — so the path is free and the next fork
of the same target takes the stem branch again; nothing else is touched, and uncommitted work is never
discarded without the person's explicit bracket.**

The consumer 0128 D3/P21 waited for has arrived: teardown was deferred ("bring-back and cleanup are the
printed plain-git commands, a landing channel deferred until a consumer rules it"), and the field use —
retry until it works — is a loop whose second iteration stumbles on exactly the surfaces the printed lines
leave behind. The measurement (the live probes this ruling ran): the printed per-repo
`git worktree remove <path> && git branch -D <branch>` sequence (a) leaves the **branch taken** when only the
root line is run — the next fork of the same target names `auto-fork/T-NNN-2` forever, the suffix designed
for *concurrent* experiments misreading as accumulation; (b) breaks on **nested repositories** when run
root-first — `git worktree remove` of the root sweeps the whole directory, so the nested repository's
registration points at a swept path and its printed line fails ("is not a working tree"); (c) collides with
git's own guard — `branch -D` refuses the branch a worktree still has checked out, so the printed order
per repository is load-bearing and easy to get wrong. And the plain-git path has no bracket at all for the
two things the person cannot see: a **run live inside the fork** (its driver mid-experiment) and
**uncommitted work** (a retry's half-done state, silently destroyed by `worktree remove --force` habits).
One command closes the loop: fork → run --stop-after → review → remove-fork → fork again.

This ruling Derives: **P21** (machinery waits for its consumer — the showing: the deferred `--remove` is
built now, shaped exactly by the retry loop that asked, nothing more — no listing, no age-based sweeping, no
registry), **P6** (derived state, re-derivation — the showing: the teardown reads the same git-only record
fork left (the worktree registrations' checked-out branches, the `auto-fork/*` family), persists nothing,
and is idempotent — a re-run rediscovers what still stands, which is also its failure recovery), **P20**
(in-flight work is never destroyed — the showing: a live run inside the fork blocks; uncommitted work
blocks naming its files unless `--force` explicitly discards it; committed experiment work is discardable
*by design*, the reflog keeping the tips), **P2** (the person brackets every boundary — the showing:
`--force` is the person's explicit discard bracket; the printed tips keep the destruction reviewable),
**P12** (fail loud, conservative under uncertainty — the showing: a member worktree on any branch other
than the fork's one coherent name is *named* for the person to settle, never guessed at; a stranger path
or a person worktree is refused, never touched), **P5** (single ownership — the showing: the teardown
deletes exactly what fork created and nothing beside — the lane park, person worktrees and the source
trees' HEADs are outside its writes), and **P13** (frozen additive-only vocabularies — the showing: one
new command row, its exit codes under the standing contract 0/1/2, fork's own success lines re-pointed at
the command in the same lockstep). Tier touched: **mechanism** — core src, the shell's surface, tests, the
README; no principle text, no templates.

## Category scope (0123 D1's discipline)

Family: *the person-invoked experiment/retry channel — 0128's family, its teardown half.* Home-set
enumerated at ruling time:

| home | disposition |
|---|---|
| `src/fork.ts` (`removeFork`, `worktreeBranches`) | changed — the new home, beside `forkTask` (the family's one module) |
| `packages/auto/src/index.ts` (the remove-fork row, topic, argument checks, dispatch; fork's `--force` teaching) | changed — the shell's half |
| `test/fork.test.ts` | changed — the teardown pins beside the fork pins (one module, one suite) |
| `packages/auto/test/e2e.test.ts` | changed — the CLI describe; fork's cleanup-line pins re-pointed |
| `packages/auto/README.md` | changed — the usage rows (fork's own row repaired: 0128 never added it) and the retry-fork section |
| 0128's D3 ("no `--remove`") | re-ruled here — P21's consumer arrived; the remainder of 0128 stands |
| `src/land.ts` / `src/git-land.ts` (the original-branch filter) | consistent, untouched — the family is deleted, so the filter simply stops seeing it |
| `src/git-worktree.ts` (`removeWorktree`, the lane teardown) | consistent, untouched — the lane park's teardown keeps its retry schedule and its park path; fork worktrees live outside the project and outside that machinery |
| `src/lock.ts` | consistent, untouched — `liveRunLock`/`lockLines` reused read-only for the fork-internal run check |

## The ruling

**D1 — the shape and the inverse.** `remove-fork <worktree-path> [dir] [--force]`, `--force` its one
option (anything else is a usage error, fork's own no-options posture one notch wider for the discard
bracket alone). The teardown: the root worktree plus every nested repository of the source
(`repoRoots`, fork's own enumeration) holding a worktree at the same relative place **on the same
branch** — fork's one coherent name is the membership proof — removed **nested-first, root-last** (the
measured ordering: the root's removal sweeps the directory, so root-first strands the nested
registrations pointing at swept paths), each branch deleted *after* its own worktree is gone (git
refuses to delete a branch a worktree has checked out). Each deleted tip is printed before the
deletion, `land --abandon`'s recoverability posture. The success lines close the loop with the retry
hint (`fork <target> <path> <dir>`, the target read off the branch stem by fork's own target grammar).

**D2 — the membership grammar, conservative under uncertainty.** The path must be a **registered**
worktree of the source repository (git's own `worktree list --porcelain`, the record P6 rests on)
whose checked-out branch is of the `auto-fork/*` family: the project's own tree, a stranger path, a
person worktree on another branch, or a detached HEAD is a usage refusal (exit 1), never touched —
remove-fork never removes a worktree it cannot name as its own. A nested member on any branch other
than the root's is named for the person to settle (P12: the coherence is fork's invariant; a violation
is a person fact, never auto-resolved). Every refusal lands before any git state is touched (land's
two-pass shape); the teardown is idempotent — a member whose directory is already gone has its
registration dropped and its branch deleted (the swept-directory shape: `rm -rf` by hand is a legal
half-teardown), which is also the blocked-failure recovery (re-run resumes).

**D3 — the two brackets.** A **live run inside the fork** blocks (exit 2, the lock's own refusal lines
over the fork's tree — the experiment's driver holds state there; P20). Uncommitted work in a member
blocks naming the files per member (exit 2) — commit it or bring it back by hand — unless `--force`
explicitly discards it (P2: the discard is the person's act; committed work needs no bracket, being
reflog-recoverable by design). A member's own nested members do not count as its dirt (each member is
judged by its own status; the nested-first order removes the inner worktrees before the root's
removal runs — the same reasoning as `repoRoots`' per-repository status). The **source project's own
lock is deliberately not consulted**: 0129's argument verbatim — the only writes in the source
repositories are the branch family and the worktree registrations, surfaces a running driver never
reads — so remove-fork, like fork, runs beside a live run in the source.

**D4 — fork's teaching re-pointed, one lockstep.** fork's success line `cleanup, per repository of the
fork:` + the per-repo plain-git lines is replaced by `cleanup when done: <bin> remove-fork <path>
<dir>` — the printed sequence was the measured trap (the branch-left-over, the root-first order, the
checked-out guard), and the command exists now; bring-back stays plain git (P21 unbroken: no landing
machinery). The partial-creation failure message teaches `remove-fork` the same way. The shell gains
the command row and topic; the README's usage block gains both rows (fork's row repaired — 0128 never
added it — and remove-fork's) and a compact retry-fork section. Exit codes under the standing
contract: `0` removed / `1` the path is not a fork of this project / `2` blocked — the live run, the
uncommitted work, or a git failure midway (the partial scene named, the removal resumable).

## Enactment

`removeFork` + `worktreeBranches` in `src/fork.ts`; the shell's remove-fork block (argument checks
before the directory resolves, `positional[1]` the directory, the legacy-layout list, the lock-free
dispatch after fork's, `requireConfigFile` + the config load as the validity gate, fork's shape);
fork's success/blocked lines re-pointed. Tests: `test/fork.test.ts` — the teardown happy path over a
nested-repo fork (both members' tips named, the source HEADs untouched), the retry round-trip (the
stem branch free again), the dirty refusal with `--force` as the explicit discard, the usage matrix
(the own tree, a stranger path, a person worktree, a member off the branch), the live-run refusal
(pid 1 planted — the reading process's own pid reads stale by the dead-predecessor rule), the
swept-directory shape; `packages/auto/test/e2e.test.ts` — its own describe (argument checks, help
rows, the happy path through the real CLI with the retry, the dirty/--force pair, the live-run
refusal) and fork's cleanup-line pins re-pointed.

Verification: full typecheck clean in both packages; the suites green (auto-core, the shell — the
exact counts in the commit message); the closing read below ran the real CLI on a scratch project.

## The closing read

A scratch project (the fork describe's fixture shape: `init`, a checkpoint, two `Auto-Task` trailer
commits): `fork T-002 <path>` → an experiment commit inside → `remove-fork <path> <dir>` prints the
member lines with the tip, frees the branch; `fork T-002 <path>` again takes the stem `auto-fork/T-002`
(not `-2`); `remove-fork` on a dirty fork blocks naming the file, `--force` discards it; a stranger
path and the project's own tree are refused; the source tree's HEAD never moves.
