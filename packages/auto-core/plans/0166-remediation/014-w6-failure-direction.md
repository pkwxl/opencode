# Step 014 — w6-failure-direction

Wave: W6-git. Findings: 0165-035 (S19-03, S2, CONFIRMED), 0165-036 (S19-05, S2, CONFIRMED),
0165-110 (S11-09, S3, CONFIRMED), 0165-138 (S19-04, S3, CONFIRMED), 0165-204 (S19-10, S4,
CONFIRMED). Started 2026-11-06 at HEAD `a6ac2374c`.

## Scope

The git layer's failure-direction stragglers 0155's sweep never classified, and the
subdirectory-target layout (the target inside a larger repository — a supported contract with no
test home): the script guard's pathspec mismatch (035), repoRoots reading every failed
`rev-parse --is-inside-work-tree` as "not a repository" (036), receipt coverage diffing only the
recorded repositories (110), the half-applied subtree confinement of commitTree/stashTree (138),
and the straggler set of 204 — nestedHeads' empty-sha trailer, nextFixSession's failed log as
ordinal 1, the guard's post-run read failures as "untouched", rollbackUnit's unreadable HEAD
reported ok, and taskChangedPaths blending corpora in nested repositories — plus the
subdirectory-target scenario as the test home.

Out of scope (their own steps): S29-04's run-time non-git refusal (the W3 shell-seam family;
0165-193's corpus bound for nextFixSession (step 078); the release clean-tree unreadable
destination (0165-034, step 016); driverBaseline's exit codes and foreignCommits' range semantics
(step 013, ruling 0173); S19-06's doc-lane decorator copy (0165-139, step 015).

## Design ruling

Ruling **0174** ([0174-git-failure-direction.md](../0174-git-failure-direction.md)): D1 the work-tree
probe reads three states (`workTree`: inside / outside / problem, the discriminator stderr's
"not a git repository" vs everything else — repoRoots surfaces the problem line; beginUnit dirty,
commitTree failed, bootstrapRepository refused, so a refused read never idles the commit boundary
and init never nests a repository inside a monorepo git cannot read); D2 the subtree confinement
completed (commitTree's commit takes the add's surviving pathspec — the person's staged work
elsewhere stays staged; stashTree's push gains the subtree `-- .`, amending 0053 D20 to
rollbackUnit's own shape); D3 the script guard anchored to the toplevel (the diff and the restore's
checkout run under `-C <toplevel>` with the toplevel-relative porcelain paths; a failed post-run
read surfaces as an unrestorable entry, never "untouched"); D4 a receipt that names fewer roots
than the tree vouches for nothing (rangeChangedFiles undefined on a grown root set); D5 the
straggler sites (nestedHeads skips the empty repository; nextFixSession logs a failed log beside
the ordinal floor; rollbackUnit fails an unreadable HEAD with a recorded baseline; taskChangedPaths'
nested corpora bounded by the root boundary commit's Auto-Nested record, amending 0140's nested
floor). Premises changed: 0053 D20, 0140; re-read standing: 0021, 0083 D11, 0155 D1, 0096 D5.

## Implementation order (the recovery map)

1. `src/git.ts`: `workTree` (the three-state probe; repoRoots surfaces its anomaly line);
   `beginUnit`/`commitTree` block on it; `bootstrapRepository` refuses on it;
   `scriptGuardCheck` (toplevel-anchored pathspecs + failed reads surfaced as unrestorable);
   `commitTree`'s commit pathspec (the surviving `drop` spec); `stashTree`'s `-- .`;
   `nestedHeads` skips empty shas; `nextFixSession` logs a failed log; `rollbackUnit`'s
   unreadable-HEAD failure; `rangeChangedFiles`' grown-roots undefined; `taskCorpusBound` +
   the nested corpus via the boundary commit's Auto-Nested record.
2. Tests per the ruling's Tests section in `test/git.test.ts` (fail-before proof first).
3. Full suite + typecheck; INDEX row, ledger dispositions, program close-out, commit.

## Execution log

- 2026-11-06: step opened; the five findings' evidence records read (S19-git whole, S11-09);
  git.ts read whole at HEAD `a6ac2374c`; the guard's three consumers (script.ts, regression.ts,
  wall.ts) and rangeChangedFiles' three callers read. Git mechanics probed empirically:
  `git commit -m … -- .` under a subdirectory commits only the subtree and leaves the person's
  staged files staged (exit 0 also with `--allow-empty`); `git stash push -u -m … -- .` confines
  the stash to the subtree; dubious ownership and not-a-repo both exit 128 — the discriminator
  is stderr ("not a git repository" vs anything else).
- Ruling 0174 written; implementation landed per the map's item 1 (git.ts only — every site of
  the five findings in the one home the Category scope names).
- Tests: 4 new describes, 11 tests (the subdirectory-target scenario — commitTree, stashTree,
  the guard, beginUnit/close-out; the probe refusal via GIT_TEST_ASSUME_DIFFERENT_OWNER and the
  non-git floor; the grown-roots receipt; the four straggler cases). Two fixture bugs found and
  fixed during the run: the corpus-restart fixture must commit the docs deletion (else the
  re-created todo.md is a modify, not an add — the boundary resolved to the old formulation), and
  the unborn-empty-repo fixture needs a scoped second commit (`git add -A` over an unborn nested
  repository fatals — the shape is only reachable scoped; noted in the test's comment).

## Verification

- `bun typecheck` clean in packages/auto-core and packages/auto.
- auto-core full suite: **2972 pass, 0 fail** (152 files; 2961 at step 013's close; +11).
- Fail-before: `git stash push -- src/git.ts` → a copy of the suite minus the workTree import
  runs, and exactly the 7 behavioral regressions fail on the pre-fix code (the commit
  confinement, the stash confinement, the guard under the layout, the grown roots, the
  empty-sha trailer line, the silent rollback ok, the blended nested corpus); the two floor
  tests (the layout's beginUnit/close-out scenario, the whole-log floor) pass on both — the
  byte-identical floors the ruling promises. The workTree import itself cannot compile pre-fix
  (the new-export shape step 013 also recorded); `git stash pop` restored everything.
- packages/auto suite: 157 pass, 5 fail — **the 5 fork/remove-fork failures are pre-existing
  baseline**, reproduced identically at HEAD `a6ac2374c` with the fix stashed (the W-fork
  family, step 031 owns its wave); no shell failure is this step's.

## Close-out

Step done 2026-11-06. Ruling 0174 active-authority; the INDEX row, one AGENTS.md navigation
line, ledger rows 0165-035/036/110/138/204 and the program's status/current-position land in the
same commit. Residuals to their named families: gitignore.ts's boolean probe (contained by D1's
gates — init refuses before the ignore write, runs never start); land's/isolateRound's clean
gates under a refused work tree outside a run (the W4/W-land steps if their waves touch them);
S29-04's run-time non-git refusal (the W3 shell-seam family); 0165-193's nextFixSession corpus
bound (step 078).
