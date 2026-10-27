# 0140 — the task corpus: the trailer scans bounded, a re-issued id never forks before the restart

The maintainer's field report (2026-10-27, the aster-mig cleanroom baseline): *Why a fork and the original
working directory show differently?* — then, reading the two `status` outputs: *It seams it forks the wrong
T-001* and *the project `baseline` has been reset to start from the beginning. There is old T-001 in the git
history.* The model in one sentence: **the two trailer scans that derive task facts from git history
(`taskFirstCommit`, `taskChangedPaths`) read the whole log with no corpus boundary — and a wipe-and-restart
over retained history re-issues task numbers, so "the repository's oldest `Auto-Task: T-NNN` commit" belongs
to an earlier corpus and a fork lands before the restart; the scans are now bounded at the task's corpus,
the boundary derived from git evidence alone, and with no re-issuance the bound changes nothing.**

The measurement (the live probes this ruling ran on the baseline repository): the fork worktree
`fork/baseline-t001` sat at `a2e43cb` (2026-10-25, "PLAN prompt-audit formulation R-01.P01") — exactly the
parent of `8233929`, the **old** lineage's first `Auto-Task: T-001` commit — while the state the person
asked for is `5da3b2b` ("PLAN formulate P01-survey Survey"), the parent of `814e6d0`, the **current**
corpus's first T-001 commit (2026-10-27, after the reset markers `PLAN clarify`/`PLAN brief install`/
`PLAN start R-01`). The history is richer than one restart: `git log --diff-filter=A -- docs/T-001/todo.md`
lists **three** formulation commits (`714d766`, `399f8f7`, `5da3b2b`) — the project restarted twice before —
and `docs/T-002/todo.md` was added by `T-001`'s exec commit (a formulation task's collect writes the *next*
task's unit document under its own id), the shape that makes "the boundary commit is itself a task commit"
a production case, not an exotic one. The old corpus ran to at least T-027 (105 task commits, 10-25→10-26),
the current one is at T-003 — every id the current corpus re-issues collides, and the collision grows as it
advances. The visible symptom (the two `status` outputs differing) was never a malfunction: the fork showed
the 10-25 config (context-limit 64k, no tree-lanes), the 10-25 bundle stamp (four stale/drift rows against
the running binary) and no run lock (`.auto/` is untracked; a fresh worktree starts with none) — every line
per-directory truth, two days and one corpus earlier than the main tree.

Why the derivation had no boundary: it rested on numbering's invariant *"task numbers (T-NNN) never repeat
in the target directory"* (plans/0001) — but that invariant is **per corpus**, and its enforcement scans
surviving files only (`taskNumberFloor`: `docs/R-*/P*/tasks.md`, `docs/**/T-*/*.md`; `src/numbering.ts`).
Reset clears the config layer and never touches `docs/` (plans/0004's boundary 1; the hand wipe is the
person's), so over retained history the numbering correctly restarts at T-001 while the trailer scans
blend both lineages.

This ruling Derives: **P6** (derived state, re-derivation from durable evidence — the showing: the corpus
boundary is derived from git alone, the newest commit that added the unit's `todo.md` plus one `rev-list`;
nothing persists, every fork and every advisory scan re-derives it), **P19** (measured evidence — the
showing: the incident probed live, the three-formulation history and the T-002-by-T-001 shape measured
before the bound was designed), **P12** (fail loud; conservative under uncertainty — the showing: a boundary
that cannot be derived (a nested repository, a unit document no history commit added, a boundary at the
repository's initial commit) floors to the unchanged whole-log scan, never a guess; and the re-issued shape
is *surfaced*, the success line naming the older lineage, the refusal naming the corpus, where before it
landed silently wrong), **P10** (the byte-identical floor — the showing: with no re-issuance the corpus set
contains every trailer commit, so every single-corpus repository derives byte-identically; the whole
existing fork/git suite passes unpinned-unchanged), and **P8** (deliberate enforcement moments — the
showing: the two new surfaced lines each teach their fact: `— the state before T-001 first started (this
corpus; the history also holds older T-001 commits from before a restart)` and the refusal's
`predates this corpus's formulation of the unit`). Tier touched: **mechanism** — core src, the shell's help
text, the README, tests; no principle text, no templates, no protocol vocabulary change (the success line
grows an optional parenthetical, the refusal one variant message; exit codes untouched).

## Category scope (0123 D1's discipline)

Family: *the person-invoked experiment/retry channel — 0128's family, its derivation half; and 0096 D7's
release-note re-merge surface, the other reader of the same trailer scan.* Home-set enumerated at ruling
time:

| home | disposition |
|---|---|
| `src/git.ts` (`taskCorpusCommits` new; `taskFirstCommit`, `taskChangedPaths` bounded) | changed — the derivation's one home |
| `src/fork.ts` (the two `taskFirstCommit` call sites, the refusal split, the success line, the header comment) | changed — the consumer's copy and shape |
| `packages/auto/src/index.ts` (the fork help row's derivation sentence) | changed — the shell's teaching |
| `packages/auto/README.md` (the fork usage row, the retry-fork section) | changed — the same |
| `docs/structure.md`, `AGENTS.md` (the fork navigation lines) | changed — the navigation lockstep |
| `test/fork.test.ts` (a corpus-bound describe: three tests) | changed — the fork pins |
| `test/git.test.ts` (a `taskChangedPaths` describe: two tests) | changed — the advisory pins (none existed) |
| 0128's own document | untouched (historical record; this ruling supersedes none of it — the derivation's *shape* is refined, its contract unchanged) |

## D1 — the boundary: the newest addition of the unit document, the set it opens

`taskCorpusCommits(root, taskId)` (private to `src/git.ts`, both scans' shared derivation): the newest
commit that **added** `docs/T-NNN/todo.md` (`git log -n 1 --diff-filter=A --format=%H` over the path) is
the current corpus's formulation-of-record — every corpus formulates a unit exactly once, so the newest
addition is the current one's; the corpus set is `rev-list <bound>^..HEAD` — everything reachable from HEAD
but not from the boundary's first parent, **the boundary commit included**. Inclusion is load-bearing, the
measurement named the shapes: a formulation task's collect writes the *next* task's `todo.md` under its own
id (baseline's `docs/T-002/todo.md` added by `T-001 exec`), and an interrupted first attempt can commit its
own `todo.md` (the fork suite's own fixture shape) — in both, a trailer commit of the task *is* the boundary,
and excluding it would push "first started" past the task's real beginning. Renames never false-positive:
the completion's `todo.md → done.md` rename is a move of the old path, not an addition, and re-additions
after a wipe are exactly the signal sought (three measured on the baseline). `undefined` — no addition in
this repository (a **nested** repository: task documents live in the target directory alone; a unit whose
document no history commit added; a boundary at the repository's initial commit, where nothing exists
before it) — floors the caller to the unchanged whole-log scan: nothing separates lineages there, and the
unbounded answer is correct for the single lineage that exists.

## D2 — fork: the current corpus's pre-start, the re-issued shape surfaced

`taskFirstCommit` now returns `{ first, older }`: `first` the oldest **in-corpus** trailer commit (its
parent the fork point, interrupted attempts still included in what is excluded), `older` true when trailer
commits under the same id exist outside the corpus — the re-issued shape. `forkTask`'s refusal splits with
it: `first` undefined and `older` false keeps 0128's message verbatim (nothing anywhere carries the
trailer — the floor); `first` undefined and `older` true refuses naming the corpus — *every commit
carrying the trailer predates this corpus's formulation of the unit — the task's document was re-created by
a later restart, and the current corpus has not started the task* (the person who sees `git log --grep`
disagree must never be told "no commit carries the trailer"). The success line appends, exactly when
`older`: *`(this corpus; the history also holds older T-001 commits from before a restart)`* — the
confusion this incident rode on was a sha that read plausibly and said nothing. An id the current corpus
never re-issued derives unchanged: the newest `todo.md` addition is still the old corpus's formulation, the
set contains the old corpus's commits, the fork lands where it always did, no note (pinned).

## D3 — taskChangedPaths: the advisory surface never blends lineages either

The same bound, per repository of the walk (the root repository's set; nested repositories floor to
whole-log, their documents absent by construction): commits of an earlier corpus under a re-issued id no
longer contribute their diff paths. The consumers (execute's blocker steer over `taskChangedPaths`, the
regression lane's own/dep path sets) keep their contracts — the surface is advisory steer, never a gate,
and the steer now names only the current corpus's files.

## D4 — residuals

The nested repositories' own scans stay unbounded (no unit document exists there to bound by; fork's
own-log fallback fires only when the fork commit's `Auto-Nested` record lacks the repository;
`taskChangedPaths`'s nested contribution is advisory) — reopened on the first field report of a nested
blend. The person's already-created wrong fork is unwound by the standing tools: `remove-fork <path>` then
`fork T-NNN <path>` takes the corrected derivation (measured: the re-fork pins `5da3b2b`-shaped states, the
stem branch name freed by the teardown).

## Tests and the closing read

`test/fork.test.ts` — a corpus-bound describe beside the 0128 pins: the re-issued id forks the current
corpus's pre-start with the note in the success line (the old corpus's file present, the new task's output
absent); an id never re-issued keeps the old corpus's own pre-start with no note (the cross-corpus floor);
formulated-not-started in the current corpus refuses naming the corpus shape. The existing suite pins the
single-corpus floor byte-identically (the interrupted-attempt shape — the boundary commit itself a trailer
commit — unchanged). `test/git.test.ts` — a `taskChangedPaths` describe: the single-corpus floor (every
trailer commit contributes) and the re-issued id (only the current corpus's paths). Full typecheck clean in
both packages; the whole suites green. The closing read ran the derivation live on the baseline repository
itself (read-only probes): the corpus set over `5da3b2b` yields `814e6d0` as T-001's first commit — the
state the person asked for — with `older` true, and over the untouched single-corpus history of a fresh
scratch project the derivation is byte-identical to the previous one.
