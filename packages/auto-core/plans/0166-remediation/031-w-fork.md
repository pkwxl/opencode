# Step 031 — w-fork: nested-of-nested worktrees, symlinked paths, failure cause, the reflog claim; lane digest identity

Wave **W-fork** (the 085 row rides W-fork/W-lanes jointly). Started 2026-11-07 at HEAD `56fe125b8`
(step 030 done: ruling 0190). Worker: the delegated child session, executing the program's Part B
directly.

## Scope

Findings (all CONFIRMED in plans/0165-review/S20-isolation.md and S05-loop-task.md):

- **0165-143 (S20-06)** — fork builds nested worktrees in `repoRoots`' commit order (deepest
  first), so a nested-of-nested layout (root, `a`, `a/b`) blocks: the parent's `worktree add`
  meets a non-empty existing directory. Two sub-edges ride it: an Auto-Nested-recorded repository
  absent from today's tree is dropped silently, and an empty nested repository (no HEAD) is
  refused with an unsatisfiable remedy (`<rel>@<sha>` naming — no sha exists).
- **0165-144 (S20-07)** — fork/remove-fork compare worktree paths lexically while git registers
  the realpath: a fork created through a symlinked path prints a cleanup command that answers
  "nothing of a fork to remove"; the containment guard (`within`) is lexical too, so a path
  through a symlink into the project passes.
- **0165-145 (S20-08)** — every worktree-creation failure reports git's progress line
  ("Preparing worktree (new branch …)") instead of its cause: `firstLine` over multi-line stderr.
- **0165-146 (S20-09)** — remove-fork's closing "recoverable via git reflog until collection" is
  false: the linked worktree's HEAD reflog dies with the worktree, `branch -D` drops the branch's
  reflog; the printed short sha is the one handle (object present until gc).
- **0165-085 (S05-08)** — the lane branch digest hashes the directory string, not its identity:
  a lane dispatched by `run /link/proj` and recovered by `run .` (cwd is physical) lands against
  a branch that does not exist ("deriving the lane baseline … failed", exit 2); the straggler
  prune deletes the wrong branch name and strands the real one.

Homes (verified against the findings' named homes): `src/fork.ts`, `src/git.ts` (the `causeLine`
helper beside `firstLine`), `src/git-worktree.ts` (the three `worktree add` sites),
`src/lanes.ts` (`laneBranch`, the resolver, `dispatchLane`/`landLane`/`teardownLane`),
`src/loop-preflight.ts` (the cap line, `pruneLaneStragglers`); test homes `test/fork.test.ts`,
`test/lanes-scheduler.test.ts`, `test/loop-isolation.test.ts` (the `await` threading).
`src/loop-task.ts` is named by the step launch list but by no finding — untouched unless
enactment proves otherwise. The shell package needs no change (its fork rows pass `dir` through;
the e2e fork/remove-fork failures are pre-existing at HEAD — verified: they die at the trailer
scan, `git commit -m` triple-paragraph shape vs 0173 D2's last-paragraph rule, before any code
this step touches).

## Findings → decisions (enacted as ruling 0191, plans/0191-fork-lane-path-identity.md)

- 143 → 0191 D1 (creation order shallowest-first; the absent-recorded ℹ line; the
  empty-repository refusal naming "commit once").
- 144 → 0191 D2 (canonicalize the root, the worktree path's existing prefix, and remove-fork's
  argument before every comparison and printed line).
- 145 → 0191 D3 (`causeLine` beside `firstLine`, used at the three worktree-add sites).
- 146 → 0191 D4 (the closing line says what is true — the printed full sha until gc, the
  `git branch <name> <sha>` recipe; land --abandon's sentence stays, true there).
- 085 → 0191 D5 (the digest keys the directory's realpath inside `laneBranch`; records written
  before read through `resolveLaneBranch`'s evidence ladder).

## Recovery state (maintained as work goes)

- 2026-11-07 session open: evidence read (S20-06/07/08/09, S05-08, S19's empty-nested seam, the
  register rows); code homes read in full; baseline of packages/auto established (149 pass,
  8 skip, 5 fail — the 5 = 2 fork + 3 remove-fork, all dying at the trailer scan, identity
  checked by manual reproduction); git behaviors probed empirically (deepest-first nested
  creation fatal "already exists" exit 128 with "Preparing worktree" first on stderr;
  shallowest-first succeeds; git registers the realpath of a symlinked worktree add;
  `rev-parse --verify --quiet HEAD` exits 1 on an empty repository, 0 with commits, 128
  not-a-repo). Step marked `doing` in the program. Ruling **0191** written
  (plans/0191-fork-lane-path-identity.md, D1–D5 + floors + premise guard over
  0151/0128/0139, 0068 D14/D16 and 0129 re-read).
- Src edits landed (D1–D5): `src/git.ts` (causeLine beside firstLine);
  `src/git-worktree.ts` (the three worktree-add sites take causeLine);
  `src/fork.ts` (physicalDir root + realPathPrefix worktree path + removeFork
  canonicalization; the shallowest-first creation loop; the empty-repository
  refusal; the absent-recorded ℹ line; the full-sha tips + the git-branch
  recipe closing line; comments restated); `src/lanes.ts` (laneBranch async
  over the realpath digest; resolveLaneBranch; dispatchLane's and landLane's
  resolution; teardownLane threads the branch); `src/loop-preflight.ts` (the
  cap line's resolved branch; pruneLaneStragglers' ladder). **Next action**:
  typecheck (the async laneBranch fallout in tests), then the new regression
  tests, then verification.

## Verification

- `bun typecheck` (auto-core) — exit 0. `bun test` (auto-core, full) — **3071 pass, 0 fail, 153
  files** (step 030's close: 3062 pass; +9 = 6 new fork tests + 3 new lanes tests).
- `bun typecheck` (packages/auto) — exit 0 after the five `laneBranch` pins in
  `packages/auto/test/e2e.test.ts` gained their `await` (the async signature's lockstep, 0151 D2's
  derivation-site pattern). `bun test` (packages/auto, full) — **149 pass, 8 skip, 5 fail** —
  exactly the baseline; the 5 are the pre-existing fork/remove-fork failures, their identity
  verified at session start by manual reproduction (they die at the trailer scan — the fixture's
  triple-`-m` commit shape vs 0173 D2's last-paragraph rule — before any code this step touches).
- **Fail-before proof** (src reverted to HEAD — `git show HEAD:…` over the five touched files,
  after `/tmp` backups; tests kept fixed): `test/fork.test.ts` **8 pins red** — the
  nested-of-nested fork (blocked at `a`'s worktree add), the absent-recorded ℹ line (no such
  line), the empty-repository refusal (the generic not-derivable remedy), the symlinked
  round-trip (the printed cleanup command answering "nothing of a fork to remove"), the
  containment refusal (the into-the-project fork accepted), the cause lines (Preparing worktree),
  the teardown's full-sha + sha-recipe pins (the 7-char cut, the reflog sentence), the swept-fork
  full-sha pin — **17 pre-existing fork tests green** on the pre-fix source (the byte-identical
  floor). `test/lanes-scheduler.test.ts` — the file-level red (step 024's precedent shape):
  `resolveLaneBranch` does not exist at HEAD, the suite fails at import; behind it, the digest
  defect demonstrated at runtime by an inline probe on the pre-fix source
  (`auto-lane/T-001-c35c26b4` vs `auto-lane/T-001-fb5e522e` for one directory reached by two
  spellings — the finding's own repro shape), and the recovery pin's behavioral red is that
  defect's direct consequence (the S-record's confirmed "deriving the lane baseline … failed").
  The fixed files restored and verified byte-identical (`cmp` × 5); both suites re-run green.

## Dispositions

- 0165-143 → **fixed @0191 D1** (creation order shallowest-first; the absent-recorded ℹ line; the
  empty-repository "commit once" refusal).
- 0165-144 → **fixed @0191 D2** (physicalDir root, realPathPrefix worktree path, remove-fork's
  canonicalized argument; every comparison and printed line on git's own spelling).
- 0165-145 → **fixed @0191 D3** (`causeLine` at the three measured sites; the wider firstLine
  sweep a named residual, P21).
- 0165-146 → **fixed @0191 D4** (full-sha tips; the sha-until-gc recipe; land --abandon's true
  sentence untouched).
- 0165-085 → **fixed @0191 D5** (the digest keys the realpath; `resolveLaneBranch`'s evidence
  ladder at the four resolution sites).

Residuals recorded in the ruling: the wider `firstLine` sweep (step 078's S19-10 family
territory), two listed `auto-lane/<unit>-*` branches without a worktree to ask (the conservative
rung), the lane park paths under a symlinked target left to filesystem resolution (the run-wide
canonicalization variant declined — no additional git-visible fix for a bigger printed-path
blast radius).
