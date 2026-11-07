# 0191 — the fork family's path identity, its worktree order, its failure causes; the lane digest's identity

Status: active-authority (0166 remediation step 031, wave W-fork — the 085 row rides W-fork/W-lanes
jointly; findings 0165-143 = S20-06, 0165-144 = S20-07, 0165-145 = S20-08, 0165-146 = S20-09 and
0165-085 = S05-08, all CONFIRMED — S20-06/09 by the R6-r6 repro, S20-07 by the forklink repro,
S05-08 by the digest repro, S20-08 by direct `git worktree add` observation; every mechanism
re-probed against live git at ruling time: deepest-first nested creation fatal
"'<path>' already exists" exit 128 with "Preparing worktree (new branch …)" first on stderr,
shallowest-first succeeds; git registers the realpath of a worktree added through a symlink;
`rev-parse --verify --quiet HEAD` exits 1 on an empty repository, 0 with commits, 128 not-a-repo).

Five findings, one family: **the fork and lane machinery reasons about paths and branches as
strings, while git holds them as identities** — where the tree nests, which directory a path
names, what a failure's cause is, what survives a teardown, and which directory a lane branch
belongs to.

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P6** — derived state, re-derivation: fork's whole record is git's own (the registry and the
  branch family, 0129's argument); asking *git's* registration and *git's* checked-out branch —
  instead of re-deriving a spelling git never sees — is the re-derivation this family owed. The
  lane digest likewise derives from the directory's identity, the same fact under every spelling.
- **P12** — conservative under uncertainty: a worktree-path lookup that misses must say "nothing
  of a fork to remove" only when git truly holds nothing there; a cause line that names progress
  over the fatal line hides the failure's kind; a reflog claim that is false fails loud in the
  worst way — quietly, at the moment the person needs it. An empty repository's "not derivable"
  reads uncertain where the truth is exact (nothing exists to align).
- **P20** — in-flight work is never destroyed: a false "nothing here" invites `rm -rf` that strands
  registrations and branches; a lane recovery blocked on a re-derived name strands committed lane
  work behind an exit 2; the pre-fix-records fallback exists so an upgrade never destroys a
  straggler's or a scene's branch.
- **P8** — every surfaced line teaches its remedy: the printed cleanup command must work verbatim;
  the teardown's recovery line must name the act that actually recovers (the sha, `git branch`);
  the empty repository's refusal names the one act that makes it forkable.
- **P10** — the byte-identical floor: symlink-free paths (realpath = resolve) keep every byte —
  the printed paths, the digests, the guards; the digest's floor extends to paths realpath cannot
  resolve (not on disk), which hash their spelling exactly as before.
- **P13** — frozen vocabularies: `auto-lane/<unit>-<digest>` and `auto-fork/<target>` keep their
  grammars; the digest's *input* changes meaning (identity, not spelling), the branch names of
  existing on-disk lanes keep working through the fallback ladder — old names never silently
  re-mean.
- **P17/P4** — one sole writer, the commit anchor: the nested-creation order is derived from the
  tree's own shape (shallowest first), never a hard-coded layout fact (P16's structural rule, not
  an exemption).

## D1 — fork creates nested worktrees shallowest-first; the absent-recorded and the empty edges speak (0165-143)

**The order.** Pass 2 keeps creating the root worktree first, then iterates the nested set **sorted
shallowest-first** (the repository-relative depth of `rel`), instead of `repoRoots`' commit order
(deepest-first). The measured mechanism: an empty intermediate directory does not stop `git
worktree add` (it populates it), but a directory already holding the deeper repository's worktree
does — `fatal: '<path>' already exists`, exit 128 — so deepest-first creation defeats itself on any
nested-of-nested layout (root, `a`, `a/b`), a layout the unified commit and the Auto-Nested
alignment lines fully support. Creation mirrors the containment (parent directories come into
being by the parent's own creation); removal keeps its measured opposite (0139's teardown:
deepest-first, root last — the root's removal sweeps the directory). `repoRoots`' order is the
**commit** order and stays untouched (its own comment says so); fork's creation order becomes its
own derived fact with its own comment.

**The absent-recorded edge.** A repository the fork commit's Auto-Nested record names but today's
tree does not hold is currently dropped silently — the fork proceeds without it and says nothing.
It becomes one informational ℹ line in the success output (the established glyph), naming the rel,
the record's provenance, and the fact: not forked, no worktree of the fork holds it. Informational,
never a refusal: the record is a past state's word about a since-changed tree, not the person's
present ask (the named-alignment form's refusal for a typo'd rel stays — a person's explicit word
is checked, a record's word is reported).

**The empty edge.** A nested repository with no commits (S19's seam: `nestedHeads` writes an empty
sha the reader skips, so the record holds nothing for it) is currently refused through the generic
"state not derivable" remedy, which teaches naming a sha — an act impossible on a repository that
has none. The refusal distinguishes it first (one `git rev-parse --verify --quiet HEAD` read; exit
1 = empty, 0 = has commits, anything else or an unreadable repo = the generic path, P12) and names
the one satisfiable act: commit once in the repository, then fork again — or settle it by hand.

## D2 — fork and remove-fork speak git's path: the realpath, before every comparison and printed line (0165-144)

**The measured fact.** `git worktree add` registers the worktree at the **realpath** of the path it
is given (probed: an add through `/link/wt` registers `/real/wt`), while fork and remove-fork
compare `resolve()` spellings — so on any host whose workspace sits behind a symlink, the cleanup
line fork prints answers "nothing of a fork to remove", the natural next act (`rm -rf`) strands the
registration and the `auto-fork/*` branch forever, and the containment guard (`within`) lets a
path that resolves *into* the project pass as "outside" (the misread-nested-repository hazard the
guard exists to stop).

**The canonicalization.** One shape, three points:

- `forkTask`'s root: `physicalDir(resolve(dir))` — the existing helper (realpath, catch → the
  resolve form), already git.ts's established canonicalization precedent.
- `forkTask`'s worktree path: the realpath **of the deepest existing prefix**, the absent tail
  kept as spelled (fork requires an absent path; the not-yet-created part has no other name).
  A symlink-free path is byte-identical (realpath = resolve).
- `removeFork`'s argument: `physicalDir` of the resolve form (the fork worktree exists; a path
  that does not resolves to itself and the registration lookup refuses as today).

With root and path canonical, `within` compares identity against identity, the nested member
lookup (`join(path, rel)`) lands on git's registered spellings, and every printed line (the
success lines, the cleanup command, the retry hint) names the path the next command will resolve.
Refusal lines keep echoing the person's own spelling for their input (the leading token); the
directory facts they teach are canonical.

## D3 — a worktree-creation failure reports its cause, not git's progress (0165-145)

`git worktree add` prints `Preparing worktree (new branch '…')` to stderr *before* the fatal line,
and the three failure sites (`addWorktree`'s plain and sparse arms, `addWorktreeAt`) take
`firstLine` of `err || out` — the lane dispatch failure, the fork block and the sparse tier's
failure all name a non-error. One helper beside `firstLine` in git.ts — `causeLine`: the last
line beginning `fatal:` or `error:`, else the last non-empty line (a lone progress line still
beats the empty string; wholly silent failures keep the callers' `|| exit code` fallback). Used at
exactly the three sites the finding measured; the family's wider sweep (other firstLine callers
over multi-line stderr) is recorded as the residual, not enacted speculatively (P21).

## D4 — the teardown's recovery claim says what is true (0165-146)

remove-fork's closing line — "the tips above stay recoverable via git reflog until collection" —
is false twice over: the fork's commits were made in the linked worktree, whose HEAD reflog dies
with the worktree's removal, and `branch -D` deletes the branch's own reflog (S20-09's probe: the
experiment commit appears in no reflog; the object itself stays until gc prunes it). The member
lines now print the **full** sha (`(was <40-hex>)` — the 7-char cut was the one handle's handle),
and the closing line teaches the act that actually recovers: the printed shas hold until git gc
prunes the objects — `git branch <branch> <sha>` run in that repository recreates the tip. The
`(was …)` shape keeps triggering the closing line exactly as before; land --abandon's identical
sentence stays untouched — its round commits were made on the main worktree's HEAD, where the
reflog claim is true (S20-09's own verification).

## D5 — the lane branch digest keys the directory's identity; the records written before read git's own branch (0165-085)

**The digest.** `laneBranch` hashes the directory's **realpath** — its identity, not its spelling —
amending 0151 D2's "stability is per target directory" from the string to the directory: a lane
dispatched by `run /link/proj` and recovered by `run .` from inside (the shell resolves an explicit
argument lexically and `.` through the physical cwd) now derive the same branch. `laneBranch`
becomes async (realpath is); every consumer awaits (five src sites, two test files). The floor:
a path realpath cannot resolve (not on disk) hashes its spelling exactly as before — the grammar's
nonexistent-path pins keep their bytes; a symlink-free path hashes the same string `resolve`
produced, so every existing digest on such hosts is unchanged.

**The fallback ladder.** Branches created before this change carry the spelling's digest, and P20
forbids blocking or destroying them on the upgrade seam. `resolveLaneBranch(dir, unit,
worktree?)` reads what git itself holds: the grammar's name **iff that branch exists** (`rev-parse
--verify --quiet`); else the worktree's own checked-out branch when it is of the unit's lane family
(`currentBranch` — this scene's branch by construction, every arm has its own park); else the
single listed `auto-lane/<unit>-*` branch (the straggler prune's case — its worktree is already
gone; two listed branches are two arms' lanes and are never guessed between, P12 — git's own
checkout guard additionally refuses `-D` on a branch a registered worktree holds); else the
grammar's name, whose non-existence the caller's existing refusal names. Used at the four
resolution sites: `landLane` (the baseline, the merge, the teardown — one resolution, threaded to
`teardownLane`), `dispatchLane`'s re-dispatch arm (the fresh arm creates the grammar's name),
`recoverOrphanLanes`' cap line (the person's inspection hint names the branch that exists), and
`pruneLaneStragglers` (the stranded-spelling sweep).

## The floors

- Symlink-free paths everywhere: fork/remove-fork print, compare and register byte-identically;
  the lane digests hash the same bytes `resolve` produced — byte-identical.
- A tree without nested repositories, or nested but not nested-of-nested: pass 2's sort is a
  no-op re-derivation — byte-identical.
- No Auto-Nested record naming an absent repository, no empty nested repository: no new lines.
- Every successful worktree creation: `causeLine` is reached only on failure paths —
  byte-identical.
- A teardown deleting no tip: the closing line does not print (the `(was …)` trigger unchanged).
- A post-change dispatch (any spelling): the grammar's branch exists, the ladder's first rung
  returns it — no extra behavior.
- Nonexistent-path lane grammar pins: the realpath catch hashes the spelling — byte-identical.

premises this ruling changes: **0151** (D2's digest input premise — "the SHA-256 of the target
directory's path" read the spelling; re-read in the same change: D2's stability and two-arms
invariants stand and are *strengthened* — one directory now means one digest under every spelling;
the derivation sites keep the lockstep list's homes, today lanes.ts and loop-preflight.ts), **0128**
(pass 2's creation-order premise — it rode `repoRoots`' commit order unstated; re-read: the
two-pass refusal-first shape, the record derivation and the branch family stand; the order becomes
fork's own derived fact), **0139** (the registered-lookup premise — `resolve()` against git's
registry, and the closing line's reflog claim; re-read: the exact-inverse shape and the teardown
order stand and are completed — the lookup now speaks the registry's own spelling, the recovery
line the truth). 0068 D14/D16 re-read and stand (the park paths are filesystem-resolved and
unaffected; D14's recovery reads the ladder, the cattle property kept); 0129 re-read and stands
(the fork's statelessness — git's registry and the branch family remain the whole record).

Derives: **P6** (the showing: fork's record and the lane's branch are re-derived from git's own
registry and checked-out state, the digest from the directory's identity), **P12** (the cause
line, the empty-repository distinction, the no-guess rung of the ladder), **P20** (the working
cleanup line, the sha-until-gc truth, the pre-fix-records fallback), **P8** (every reworded line
teaches its remedy — the printed command that works, the recovery recipe, the one satisfiable
act), **P10** (the floors above), **P13** (the grammars unchanged; old branch names never
re-mean), **P16** (the order derived from the tree's shape, no layout fact named). Tier touched:
**mechanism** — `src/fork.ts`, `src/git.ts`, `src/git-worktree.ts`, `src/lanes.ts`,
`src/loop-preflight.ts`, the test homes; no principle text moves.

## Category scope (0123 D1's discipline)

Family: *the fork/lane machinery's path and branch identity — which directory a path names, in
which order worktrees of a nesting tree are created and removed, what a worktree failure's cause
is, what a teardown's recovery claim may promise, and which directory a lane branch belongs to*
(0128/0139's fork family meeting 0068/0151's lane-branch family at git's own path handling).
Home-set enumerated at ruling time:

| home | disposition |
|---|---|
| `src/fork.ts` (`forkTask`'s canonicalized root and worktree path; the shallowest-first creation loop; the empty-repository refusal; the absent-recorded ℹ line; `removeFork`'s canonicalized argument and root; the full-sha tips; the restated closing line and comments) | changed — D1/D2/D4 |
| `src/git.ts` (`causeLine` beside `firstLine`) | changed — D3 |
| `src/git-worktree.ts` (the three `worktree add` failure sites take `causeLine`) | changed — D3 |
| `src/lanes.ts` (`laneBranch` async over the realpath digest; `resolveLaneBranch`; `dispatchLane`'s resolution; `landLane`'s one resolution threaded to `teardownLane`) | changed — D5 |
| `src/loop-preflight.ts` (the cap line's resolved branch; `pruneLaneStragglers`' ladder) | changed — D5 |
| `src/git.ts` `repoRoots`/`nestedShasAt`, `src/land.ts`'s reflog sentence, `src/lock.ts`'s root resolution | held, untouched — the commit order is repoRoots' own; land's claim is true where it stands (S20-09's verification); the lock file resolves through the filesystem regardless of spelling |
| The other `firstLine` callers over multi-line stderr | deferred — the wider sweep is the residual, named below (P21: no consumer ruled it) |
| `plans/INDEX.md` (the 0191 row; 0151's row annotated) | changed |
| `AGENTS.md` (the fork and lanes navigation lines gain 0191) | restated |
| Test homes: `test/fork.test.ts` (the nested-of-nested fork; the ℹ line; the empty refusal; the symlinked fork/remove-fork round-trip; the containment refusal; the cause lines; the sha recipe), `test/lanes-scheduler.test.ts` (the digest identity; the pre-fix-records recovery through the ladder; the ladder's rungs; the `await` threading), `test/loop-isolation.test.ts` (the `await` threading) | changed |
| `packages/auto` | held, untouched — the shell passes `dir` through; its fork/remove-fork e2e failures are pre-existing at HEAD (verified: they die at 0173 D2's trailer-block scan on the fixture's triple-`-m` commit shape, before any code this ruling touches) |

## Residuals

- **The wider `firstLine` sweep** (other multi-line git stderr surfaces): recorded, not enacted —
  the finding measured the three worktree-add sites; the rest is P21's waiting consumer (the
  S19-10 sweep family, step 078's territory).
- **Two listed `auto-lane/<unit>-*` branches without a worktree to ask** (a straggler whose unit
  two abandoned arms left stranded): the ladder refuses to guess; the ⚠ names the derived branch's
  failed deletion and the person settles it — the conservative rung, not a heuristic.
- **The lane park paths under a symlinked target** stay joined from the run's spelling: the
  filesystem resolves them identically for git (registration and removal both canonicalize at the
  git boundary), and the digest — the one place the *string* was load-bearing — is fixed here; no
  run-wide canonicalization is enacted (the runAll-entry variant was considered and declined: a
  bigger blast radius over printed paths for no additional git-visible fix).
- 0126's lane-landing receipt rewrite residual and the standing 0178–0190 residuals: unchanged,
  not this family's.

## Tests

- `test/fork.test.ts`:
  - the nested-of-nested fork (D1): root + `a` + `a/b`, one coherent branch everywhere, the fork
    succeeds — fail-before red (deepest-first blocked at `a`);
  - the absent-recorded ℹ line (D1): a person fork commit recording `a` and `gone`, the tree
    holding only `a` — the success names `gone` as recorded-but-absent — fail-before red (no such
    line existed);
  - the empty nested repository (D1): the refusal names "empty" and "commit once in" — fail-before
    red (the generic not-derivable remedy);
  - the symlinked round-trip (D2): fork through `<link>/wt` prints the real path; remove-fork
    through the link spelling removes; the containment refusal for a path resolving into the
    project — all fail-before red (the false "nothing to remove", the accepted inside-the-project
    fork);
  - the cause lines (D3): `addWorktree`/`addWorktreeAt` over an existing non-empty directory and
    an existing branch name report the fatal line — fail-before red (Preparing worktree);
  - the sha recipe (D4): the member line carries the full sha, the closing line the `git branch`
    recipe, no reflog claim — fail-before red (the 7-char cut, the reflog sentence).
- `test/lanes-scheduler.test.ts`:
  - the digest identity (D5): `laneBranch` over a directory and its symlink spelling equal —
    fail-before red (the spellings hashed apart);
  - the pre-fix-records recovery (D5): a crashed lane scene created on the spelling's digest (the
    pre-0191 grammar, spelled by hand), recovered by `recoverOrphanLanes` — landed — fail-before
    red (blocked at the merge-base derivation);
  - the ladder's rungs (D5): the grammar's name when it exists; the worktree's checked-out branch
    when not; the single listed branch with no worktree; the grammar's name when nothing resolves
    (the caller's refusal still speaks).
- The `await` threading pins (`lanes-scheduler`, `loop-isolation`): unchanged values, the
  grammar's floors proven by passing unchanged.
