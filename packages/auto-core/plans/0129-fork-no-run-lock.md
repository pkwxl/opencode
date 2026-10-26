# 0129 — fork takes no run lock: the retry channel builds beside the live run

The maintainer's report (2026-10-26): `opencode-auto fork T-020 /workspace/aster-mig-root/fork-baseline-t020`
refused on the cleanroom baseline with the run-lock lines — pid 1988317's `run` had been live since
04:30. The refusal defeated the channel's own purpose: the experiment environment exists to retry a
task whose run is live or stalled (0128's motivating incident was the 4h14m T-020 stall — forking the
baseline *while* the run was looping was the designed move), and 0128's lock posture ("it writes refs")
made the channel refuse exactly then, at its primary case.

The analysis: **fork is read-only to the source directory.** The lock's owning concern (0053 D3) is
*commands that write what a running driver reads* — the config commands refuse on a foreign lock,
land and close hold one because they move git state a live run works on (branch moves, the close
commit). Fork owns no state in the source directory: its fork point and nested alignment derive from
committed history (each git invocation a consistent snapshot), and its only writes there are the
reserved `auto-fork/*` branch family (inert by 0128 D3's land filter — a run never reads or enumerates
it) and `.git/worktrees/<name>` registrations (metadata no run touches; `repoRoots` scans the working
tree, not worktree registrations, and the fork path bounds already keep the worktree outside the
project). Git serializes ref writes itself, so a commit landing mid-derivation can neither corrupt the
fork point nor race the branch creation. Holding the lock protected no state; refusing on a foreign
lock blocked the one consumer the channel was built for. Two concurrent forks of the same target
remain loud, never corrupting: the first-free suffix reads then creates, git's ref lock makes the
second's `worktree add` fail, and the blocked lines name the partial scene (0128 D3's exit-2 shape).

This ruling Derives: **P5** (single ownership — the showing: the lock is the writer gate of the run's
state homes, and fork owns no state in the source directory, so it takes no gate), **P8** (deliberate
enforcement moments — the showing: a refusal that guards nothing is a false block, and the lock family
keeps its refusals for the commands that write what a run reads), **P20** (in-flight work is never
destroyed — the showing: the retry channel must stay available beside the live run it spares; the
person no longer chooses between the experiment and the run), and **P19** (measured evidence — the
ruling grounded in the field refusal above). Tier touched: **mechanism** — the shell's surface, one
test, documents; no core change (`src/fork.ts` never saw the lock), no principle text, no templates.

## Category scope (0123 D1's discipline)

Family: *the run lock's holder and refusal set (0053 D3) — which commands hold `.auto/run.lock`, which
refuse on a foreign lock, which are deliberately lock-free.* Home-set enumerated at ruling time:

| home | disposition |
|---|---|
| `packages/auto/src/index.ts` (fork's `takeRunLock` + the handler comment, fork's help topic, fork's `options` row) | changed — the ruling's whole enactment surface |
| `packages/auto/test/e2e.test.ts` (the lock test, the describe comment) | changed — re-pinned: a planted live lock no longer refuses, the fork succeeds beside it with the lock untouched |
| `src/lock.ts` | held, untouched — the lock's mechanics, holder vocabulary and refusal lines unchanged; only the holder set narrows |
| The config commands' live-lock refusal list (init, amend, reset, clarify, fix, sync — they write what a running driver reads) | held, untouched |
| `land` / `close` lock posture | held, untouched — they move git state a live run works on; fork moves none |
| `src/fork.ts` | held, untouched — `forkTask` was always lock-blind; the shell's acquisition was the only lock surface |
| `status`'s lock line, `run`/`plan`/`transfer` holders | held, untouched |

## The ruling

**D1 — fork neither holds nor refuses a run lock.** The shell's fork block drops
`takeRunLock("fork")`/`release` entirely (the core's `forkTask` never saw the lock; the change is the
shell's alone). The posture is taught the established lock-free way — `models` and `install-prompts`'
pattern: fork's own help topic states "It takes no run lock … so it runs beside a live run there", and
the `run-lock` topic is dropped from fork's `options` row (that topic names the holders and the
refusers; fork is now neither). The `run-lock` topic text itself never named fork and stays
byte-identical.

**D2 — nothing else in the lock family moves (the byte-identical floor).** The config commands' refusal,
land/close/plan/transfer's holding, status's line, the stale-lock probing and removal — all exactly as
before; only the holder set narrows by one. A planted live lock that refused `fork` at 0128 now watches
it succeed.

## Enactment

The shell's fork block (the lock acquisition removed, the comment restating why), fork's help topic and
`options` row, the e2e lock test re-pinned (the `taskProject` fixture with a planted live lock: exit 0,
the success lines, the lock file untouched, the branch checked out in the new worktree). Documents:
this file, the INDEX row, the AGENTS.md navigation phrase, the `docs/structure.md` Fork row.

Verification: full typecheck clean; both suites green; the closing read below ran the real CLI.

## The closing read

A scratch project (`taskProject`'s shape: init, a checkpoint, two hand-made `Auto-Task` trailer
commits) with a planted live lock naming a foreign pid: `fork T-002 <path>` succeeds (exit 0, the
worktree at the pre-task commit on `auto-fork/T-002`, the run hint and the cleanup lines), the lock
file still on disk byte-identical; under the same planted lock `land` and `plan` still refuse with the
lock lines — the family's refusals intact around the one command that left it.
