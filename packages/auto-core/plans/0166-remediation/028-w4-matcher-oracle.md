# Step 028 — w4-matcher-oracle

Wave: W4-wall-perms. Findings: 0165-039 (S20-03, S2, CONFIRMED — the 0147 read-only
composite's edit deny never matches: opencode's live edit/write/apply_patch tools ask `edit`
with a worktree-relative pattern (`path.relative(instance.worktree, filePath)`, e.g.
`../corpus/drivers/x.c`), while the stamp is an absolute `<realpath>/**` — the deny matches no
request on the live tool path, the edit falls to the blanket `*` action, a session writes into
the reference while the config reads "read-only"), 0165-150 (S20-13, S3, CONFIRMED — the stamp
placement recognizes only a `/**` catch-all: `const cut = keys.indexOf("/**") + 1` gives any
other catch-all spelling (`*`, `**`, `/*`) cut 0, so the person's last-position catch-all
lands AFTER the driver's inserts under object-key insertion order and silently kills the 0122
allows and the /tmp receipts allowance under last-match-wins; and no test anywhere evaluates a
stamped file with opencode's own matcher — the suites pin key order, not admission). Started
2026-11-07 at HEAD `29f7ee1ce`.

## Scope

The matcher-oracle half of the wall family. S20's design note: "a W-wall wave whose first act
is an opencode-matcher oracle in the tests (S20-13). With that oracle in place, S20-01/02/03
become test-visible." This step is that first act plus the two findings the oracle exposes
directly:

- The oracle itself: a test helper that evaluates a stamped `external_directory`/`edit` map
  with opencode's own matcher semantics (last-match-wins over the file's key order) — the R7
  lead is the seed.
- 0165-150: the catch-all recognition at the stamp-placement cut widens from the literal
  `"/**"` to every pattern that matches every absolute path under opencode's matcher.
- 0165-039: the 0147 read-only edit deny is stamped in the form the tools ask (worktree-
  relative `../<rel>/**` of the realpath, plus the door name's `<door>/**` for in-tree writes
  through the symlink), pinned by the oracle on the v1 tool's pattern.

Out of scope (later steps of the wave): 0165-008/037/038/076/149 (step 029, wall close and
doors — the recovery sweep, the closed predicate, close-before-gates ordering, false
remedies); 0165-040/147 (step 030, the claude adapter boundary translation and the wall commit
message staleness vs 0138 — S20-04 and S20-10); S20-02's fix-side 0122 sync (its wall-blind
half) and S20-14's hygiene rows stay with their own buckets.

## Design ruling

Ruling **0188** ([0188-matcher-oracle-edit-deny.md](../0188-matcher-oracle-edit-deny.md)) —
D1/D2/D3.

## Implementation order (the recovery map)

1. The oracle: `test/helpers/perm-oracle.ts` (opencode's own `Wildcard.match` +
   last-match-wins evaluate), importing the matcher from the opencode workspace source — the
   auto package's dependency path, checked for test-time reachability first.
2. `src/external-dirs.ts` — the catch-all predicate at the stamp-placement cut (D2) and the
   read-only edit-deny spellings (D3).
3. `test/external-dirs.test.ts` (+ the read-only and wall stamp call sites' suites) — the
   oracle-pinned admission tests; fail-before; suites; bookkeeping; commit.

## Execution log

- 2026-11-07: step opened at HEAD 29f7ee1ce (tree clean). The register rows, S20's record,
  rulings 0122/0132/0147/0155 (premise lines — 0147 D2's single-absolute-key write side and
  0155 D3's `/**`-only spelling are the two this step changes; 0132/0122 re-read, standing),
  the code homes (external-dirs, config-fix, wall — untouched, protect — untouched, the claude
  contract — untouched, its generic translation picks the new keys up), opencode's own matcher
  (`packages/core/src/util/wildcard.ts`), its permission evaluation (`permission/index.ts` —
  evaluate = findLast, fromConfig's key order and `~`/`$HOME` expansion) and the live tools'
  ask shapes (`tool/external-directory.ts` absolute `<dirname>/*`; `tool/{edit,write,apply_patch}.ts`
  the worktree-relative `path.relative(instance.worktree, filePath)`, `instance.worktree` =
  git's `rev-parse --show-toplevel`), and the test homes read before any edit.
- 2026-11-07: ruling 0188 written (D1 the oracle, D2 the catch-all placement's every spelling,
  D3 the edit deny's ask forms). Implementation in that order: the oracle helper first
  (`test/helpers/perm-oracle.ts`, upstream matcher imported from the workspace source — the
  first cross-package source import, test-only, admitted by the ruling), then the src half
  (the matcher mirror + per-layer probe sets + `catchAllFor`, the two insert cuts, the
  three-key `readOnlyEditEntries(doors, base)` + `worktreeAskBase` (one git rev-parse through
  git.ts's spawn helper — external-dirs' first non-builtin import, the runtime→kernel edge
  the ratchet allows, its sub-domain comment restated) + `readOnlyEditEntriesFor`, the
  status/apply pairs, the module-header restatements), then config-fix's two sites, then the
  test homes.
- 2026-11-07: one test-authoring correction inside the change: the mirror-classification pin's
  first fixed list wrongly counted `**/*` and `*/*` as non-catch-alls for the absolute layer —
  every external ask contains a slash, so both DO cover it (the agreement pin, which compares
  the predicate against the imported matcher directly, was green throughout and caught the
  list, not the predicate). The classification list corrected before the proofs.

## Verification

- `bun typecheck` exit 0 in packages/auto-core and packages/auto.
- auto-core full suite: **3042 pass, 0 fail** (153 files; 3035 at step 027's close — the seven
  new pins: two mirror (agreement + classification), two placement (the every-spelling external
  pin over `*`/`**`/`/*`/`/**`, the edit `**` pin), two composite-oracle (the both-ask-shapes
  admission pin, the git-toplevel anchor pin), the entries pin; the updated composite pins in
  external-dirs and config-fix carry the three-key shapes).
- Fail-before (the fixed src backed up outside the tree at `/tmp/step028-backup/`, the pre-fix
  content written in per proof with `git show HEAD:packages/auto-core/src/external-dirs.ts`,
  restored after — every proof-touched file confirmed byte-identical to its backup afterward;
  the proofs live at `/tmp/step028-proof/` and import only pre-fix-existing src exports plus
  the src-independent oracle, so the red is per-behavior, not a file-level import error):
  - **150** (pre-fix src): the every-spelling placement pin red — the received list names
    exactly the finding's spellings: `*: corpus read denied`, `*: /tmp receipt denied`, and
    the same two for `**` and `/*` (`/**` passes pre-fix — the control, by design: the literal
    cut already handled it); the edit-`**` pin red — `Expected: "deny", Received: "allow"`
    (the deny landed after the first `*`, the person's trailing `**` winning the tie).
  - **039** (pre-fix src): the composite-oracle pin red twice — the status list received
    without the two new keys (`edit:../<corpus>/**`, `edit:linux/**` absent, pre-fix missing
    naming only the absolute pair), and both edit admission pins reading `Expected: "deny",
    Received: "allow"` — the finding's own repro shape (`v1Edit: "allow"`); the git-toplevel
    anchor pin red the same way (the absolute key never matching the relative ask).
  - On the fixed source the same four proofs pass (4 pass, 0 fail).
- packages/auto suite: 149 pass, 8 skip, 5 fail — the same pre-existing fork/remove-fork
  baseline (2 fork + 3 remove-fork, step 031's wave); no new failure; the e2e init/fix stamp
  test passes unchanged (init's deduped line keeps naming the target key first); typecheck
  clean.

## Close-out

Step done 2026-11-07. Ruling **0188** active-authority; the INDEX row, the AGENTS.md
external-dirs navigation clause, docs/structure.md's row, the shell README's fix-table row,
ledger rows 0165-039/150 and the program's status/current-position land in the same commit.
Residuals (0188's list): the lane-worktree relative depth (a lane session's absolute-path edit
asks are deeper than the one relative key; door-relative writes covered when the door is
checked out, reads still gated by external_directory — recorded as the reopen trigger); the
src-side matcher mirror (one home, oracle-pinned against the imported matcher); stale
edit-layer keys after door removal or wall closure lingering as harmless denies (S20-14's
hygiene family owns the scan dedups); README:458's wider overclaim question rides step 030.
