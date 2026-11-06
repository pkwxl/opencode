# 0174 — The git layer's failure direction closed at its straggler sites: the work-tree probe reads three states, the subtree confinement is completed, the script guard is anchored to the toplevel, and the alignment record bounds nested corpora

Status: **active**. Ruled 2026-11-06 by 0166 step 014 (wave W6-git), enacting 0165-035 (S19-03,
S2, CONFIRMED — the script guard inert under a subdirectory target), 0165-036 (S19-05, S2,
CONFIRMED — repoRoots reading every failed probe as "not a repository"), 0165-110 (S11-09, S3,
CONFIRMED — receipt coverage diffing only the recorded repositories), 0165-138 (S19-04, S3,
CONFIRMED — commitTree's whole-index commit and stashTree's whole-repository stash) and
0165-204 (S19-10, S4, CONFIRMED — the failure-direction stragglers).

## Derives

Derives: P12 — fail loud; conservative under uncertainty — the ruling's spine: every site where a
git read's failure was read as a quiet fact ("not a repository", "untouched", "no changes to
carry", "nothing to roll back", "ordinal 1") now resolves toward the surfaced/blocked direction;
the uncertain read never becomes the clean verdict. P4 shows in D1 (a repository git refuses to
open must never idle the commit boundary — every unit would close done with no commit, the
completion condition silently absent, 0073's "never again silently absent" at the layout it
missed) and D2 (the driver commits the session's changes, never the person's — a whole-index
`git commit` sweeps the person's staged work under the driver's trailer). P20 shows in D2 (the
person's in-flight work outside the target subtree stays in their tree — the close stash and the
session commit both confined). P7 shows in D3/D5 (the guard and the corpus bound read the
grammars git itself defines — porcelain's toplevel-relative paths, the Auto-Nested alignment
record's shape). P6 shows in D5 (the nested corpus bound is derived from git evidence alone —
the boundary commit's recorded alignment — nothing persists, every scan re-derives). P10 in
every floor: the ordinary layout (target at a repository root, a readable git) is byte-identical
— the commit pathspec covers the same tree, the stash the same paths, the guard the same reads.
Tier: operating — P4/P12 statements applied to the existing commit-boundary surfaces; no Tier I
statement changes.

premises this ruling changes: 0053 D20 (the close stash — "runs `git stash push
--include-untracked -m …` in every repository root" is amended by the target-subtree pathspec
rollbackUnit already carries: the person's unrelated WIP outside the target subtree stays in
their tree; the 0155 residual named exactly this asymmetry, now closed), 0140 (the corpus bound's
nested-repository floor — "a nested repository … nothing separates lineages there and the
whole-log scan stands" is amended: the root corpus boundary commit's Auto-Nested record DOES
separate lineages in a nested repository, the recorded sha is the bound; the whole-log floor
stands only where no record resolves — a person-committed boundary, a repository the record does
not name, history rewritten past the sha). Re-readings: 0021 (the unified commit commits the
session's changes recursively; the confinement D2 adds is P4's own sentence, not a new premise —
the person's staged work elsewhere was never the session's), 0083 D11 (the guard's causal claim
stands — the pathspec mismatch was a defect in its reads, not in its design; D3 also surfaces the
post-run read failures the finding's 204 half named), 0155 D1 (the strict-read discipline —
extended to the sites it had not reached: the guard's post-run reads, repoRoots' probe,
rollbackUnit's HEAD read), 0096 D5/0098 D3 (the carry's recorded-HEADs claim — D4's grown-roots
check is the claim's own completion: a receipt vouches for the tree it recorded).

## Category scope (0123 D1's discipline)

Family: *the commit boundary's reads and the subdirectory-target layout* (what a failed git read
means at each site, and the target-inside-a-larger-repository contract git.ts states but never
tested). Home-set: `src/git.ts` (workTree, repoRoots, beginUnit, commitTree, stashTree,
bootstrapRepository, scriptGuardCheck, nestedHeads, nextFixSession, rollbackUnit,
rangeChangedFiles, taskCorpusBound/taskCorpusCommits/taskChangedPaths), `test/git.test.ts` (the
straggler cases and the subdirectory-target scenario — the layout's first test home). No frozen
vocabulary changes: no protocol literal, exit code or document grammar is touched; the ⚠ lines
and problem lines are new surfaced text, and the Auto-Nested *writer* change (no empty-sha line)
removes a malformed line no reader ever parsed (the alignment regex requires a sha).

## D1 — the work-tree probe reads three states; the boundary never idles on a refusal

`workTree(dir)` (one home, git.ts): `git rev-parse --is-inside-work-tree` answered as inside /
outside / **problem** — a nonzero exit whose stderr does not say "not a git repository" (dubious
ownership — the container-mount/CI/sudo shape; a corrupt config; a vanished directory), with
git's first line carried. The probe is what repoRoots consults: the problem state logs one ⚠
line (the discovery), and the state "outside" keeps the non-git floor byte-identical. The strict
callers block on it: **beginUnit** returns dirty (the tree's cleanliness cannot be judged — the
unit never starts over a tree the commit boundary could not certify), **commitTree** fails with a
per-root failure line (the unified commit never silently commits nothing), and
**bootstrapRepository** refuses (its old read — every failure "not a repository" — would `git
init` a nested repository INSIDE the person's monorepo, the one shape init must never produce).
The spawn-throw floor (git unavailable) stays "outside" — the test seam's non-git environment.
The run-time non-git refusal (S29-04) stays that finding's family: this ruling closes the
*refused-read* direction, not the *absent-git* one.

## D2 — the subtree confinement completed: the commit takes the add's pathspec, the stash the subtree

The target-inside-a-larger-repository contract is half-applied today: status and add carry `-- .`
(cwd-relative under `-C <target>`), but commitTree's `git commit` takes the whole index — the
person's staged files elsewhere in the enclosing repository ride the driver's commit under
Auto-Stage (then audited as driver content, possibly rolled back by rollbackUnit's reset), and
stashTree's `git stash push` stashes the whole repository (0053 D20's own text — the person's
unrelated WIP removed from their tree into the close's stash). Both now carry the subtree:
commitTree's commit takes **the same pathspec the add staged with** (the surviving spec after the
0099 D4 did-not-match tolerance, `.` at the floor — `git commit -- <paths>` commits exactly those
paths' worktree state, which the preceding `add -A -- <paths>` just staged, and leaves the
person's staged work elsewhere staged; `--allow-empty` keeps working with paths), and stashTree's
push gains `-- .` (rollbackUnit's own shape — 0053 D20 amended). Nested roots are unchanged:
each is its own toplevel, `-- .` is the whole repository, the byte-identical floor.

## D3 — the script guard anchored to the toplevel; its failed reads surfaced

scriptGuardCheck feeds porcelain paths (always **toplevel**-relative) back as pathspecs to `git
-C <target> diff` and `checkout`, which read them **cwd**-relative — under a subdirectory target
nothing matches, the verdict is "untouched", and the script's tracked mutations ride the session's
next commit: the guard 0083 D11 promises was absent for the whole layout. The check now resolves
each shot's toplevel (`rev-parse --show-toplevel`, the conversion statusEntriesRead already
performs) and runs the diff and the restore's checkout against it with the toplevel-relative
paths — correct in both layouts. And the post-run reads' failures no longer read "untouched"
(0165-204's guard item): a failed status/toplevel/diff read surfaces as an **unrestorable** entry
(the violation channel the three callers already print — the lane/set/regression logs), never as
the quiet undefined. The hard-block semantics are unchanged (a moved HEAD still dominates).

## D4 — a receipt that names fewer roots than the tree vouches for nothing

rangeChangedFiles (the test-lane carry, the regression coverage, the dependency park — 0096
D5/0098 D3) diffs the repositories the receipt's `heads` recorded; a nested repository that
appeared AFTER the green receipt (a task vendoring a dependency, a sub-crate split out) is never
diffed, so a lane whose surfaces lie in it reads covered over code it never ran. The function
now compares the current repoRoots set with the recorded names and returns **undefined** (no
carry — the P12 direction every caller already treats as "must run") when a root exists the
receipt does not name. The vanished-root direction already read undefined; the grown-set
direction now joins it.

## D5 — the straggler verdict sites: nestedHeads, nextFixSession, rollbackUnit, and the nested corpus bound

The remaining spawn sites 0155's sweep never classified, each resolved by what rides on it:

- **nestedHeads** checks the exit and records a line only for a readable sha — an empty
  repository is simply absent from that commit's alignment record (the `Auto-Nested: <rel> @ `
  line with the empty sha was malformed and no reader ever parsed it; the record's meaning —
  "the state every nested repository was at" — keeps its floor: absent means unborn).
- **nextFixSession** keeps the ordinal floor 1 on a failed log (nothing gates on the ordinal;
  the numbering is 0148 D1's session naming) but logs the failed read — the anomaly is surfaced,
  no longer a silent "empty history".
- **rollbackUnit** over an unreadable HEAD with a recorded baseline (the baseline had commits;
  now nothing is readable) goes to **failures** like every other shape the rollback cannot
  certify — the old path stashed the scene, skipped every check and reported ok with no line.
  The empty-baseline/empty-repository shapes are unchanged (the unborn floor both audits keep).
- **taskChangedPaths** bounds the NESTED repositories' corpora: nested roots hold no unit
  documents, so their own history derives no 0140 boundary — the root repository's corpus
  boundary commit (a driver commit) carries the Auto-Nested alignment record, and the sha it
  recorded for a nested repository is that repository's corpus bound (`rev-list <sha>..HEAD`).
  A wipe-and-restart no longer blends the nested lineage into the advisory surface; where no
  record resolves (a person-committed boundary, an unnamed repository, a rewritten history) the
  whole-log floor stands, exactly as an underivable root boundary already floors.

## Residuals

- gitignore.ts's `insideWorkTree` keeps its boolean criterion (the family's other probe): under
  a refused work tree it writes no ignore entries, but init never reaches it (bootstrap refuses
  first) and a run never starts (beginUnit blocks) — contained by D1's gates; noted, not
  changed.
- land's and isolateRound's clean gates iterate repoRoots: under a refused work tree with a
  subdirectory target they see no roots — person-invoked commands outside a run; the run-time
  trio (beginUnit/commitTree/bootstrap) owns the block, and the person's own git will refuse the
  same commands. Left to the W4/W-land steps if their waves touch it.
- S29-04's run-time non-git refusal (a target outside ANY work tree) stays its own finding's
  family (W3 shell-seam); D1's problem state is only the refused-read direction.
- 0165-193's corpus bound for nextFixSession (re-issued ids inheriting old ordinals) stays
  step 078's row — this ruling adds only the failed-read surfacing.

## Tests

- git.test.ts, the subdirectory-target scenario (the layout's first test home): a repository
  with the target a subdirectory — commitTree confines the commit (the person's staged file
  outside stays staged, the commit lists only subtree paths), stashTree confines the stash, the
  script guard catches and restores a tracked mutation (the 035 repro), beginUnit passes on a
  clean subtree and the close-out certifies.
- The work-tree refusal (036): GIT_TEST_ASSUME_DIFFERENT_OWNER over a subdirectory target —
  beginUnit dirty, commitTree failed, bootstrap refused; the plain non-git directory keeps the
  floor (no problem, no roots).
- rangeChangedFiles (110): a new nested repository after the receipt → undefined (all three
  callers' no-carry direction); the identical-roots case unchanged.
- The stragglers (204): nestedHeads skips the empty repository's line (the commit message holds
  no `Auto-Nested: <rel> @ $` tail); rollbackUnit's unreadable HEAD (baseline recorded, `.git`
  damaged) → failures, no stash, ok=false; nextFixSession's failed log — pinned as the ⚠-logged
  floor by construction (the spawn-failure shape needs a broken git; the exit-checked path is
  the same code the corpus tests exercise); taskChangedPaths' nested corpus — an old-lineage
  nested commit excluded after a restart, the record-less boundary keeping the whole-log floor.
- Fail-before: the guard's subdirectory verdict undefined (mutation left in the tree); the
  person's staged file riding the commit; the close stash removing the person's WIP; the grown
  roots answering a changed-file list; the old-lineage nested path in the surface; the empty-sha
  trailer line; rollbackUnit ok over the unreadable HEAD; beginUnit/commitTree/bootstrap quiet
  under the ownership refusal.
