# 0074 — Branch-isolation landing (the `land` command)

Status: **proposal, 2026-10-03.** Follow-up feature per the person's ruling of 2026-10-03
(enters via `plan --append` behind its own design doc + ruling). Covers original
requirement 3: stop committing the driver's per-session commits into a real target
repository's branch; land all of a round's work back as **one** commit. Ruled
2026-10-04: all four rulings accepted as recommended (§5).

## 1. Problem, and the rejected mechanism

The pain is real: the unified commit is per-session and nested-repos-first, so a nested
deliverable repository (e.g. `opencode` inside the driven root) receives one driver
commit per session on whatever branch is checked out — unusable history for an
upstream/PR-workflow repository.

The originally requested mechanism — back up and remove the nested `.git`, work under
the outer repository's git, restore `.git` at a final `opencode-auto commit` — was
assessed (2026-10-03 system-review consultation) and rejected: it fights the machinery at
every layer (`repoRoots` walking, the init gitignore's nested-repo entries, per-repo SHA
baselines, rollback's stash/reset, close-out's foreign-commit detection), opens an
uninsured crash window (a run dying with the target's git detached; the final net-diff
apply has no failure grammar today), does not generalize past one target (no submodules,
no multiple nested repos), and relocates the audit trail out of the repository of record.

## 2. Proposed mechanism — branch isolation, git never moves

All existing per-unit machinery keeps working because nothing about the nested
repository's git changes except **which branch is checked out**:

1. **Designation** — a new constitutional config key (init flag `--isolate <rel-path>`,
   repeatable; `amend` per-key; name must avoid the tombstoned `source`/`destDir`),
   listing nested repositories under branch isolation. The driver's own record
   repository (the target root) is never a member.
2. **Isolation at round start** — when a round is established (`plan`'s establish route;
   the natural point where round-scoped state is created), each designated nested repo
   that is clean gets a branch `auto/R-NN` created from its current HEAD and checked out.
   Every per-session unified commit, rollback, baseline and foreign-commit check then
   lands on `auto/R-NN` exactly as today — zero changes to `git.ts`'s commit/rollback
   paths. The person's original branch never moves.
3. **Landing** — a new person-invoked shell command `opencode-auto land <dir>` (the name
   matches the existing vocabulary: lanes already write `Auto-Stage: landing`):
   for each designated repo — refuse (exit 2, human attention) if the original branch
   moved or foreign commits mixed into `auto/R-NN`'s range; otherwise check out the
   original branch, apply the round's net change as **one commit** (default
   `git merge --squash auto/R-NN`), delete `auto/R-NN` (`--keep` to retain it), and
   print the landed SHA. Landing mid-round is allowed (the branch simply continues);
   `land --abandon` discards the isolation branch after a person-reviewed
   reset — the undo path.
4. **Lanes interplay** — unit-level worktrees already branch per lane
   (`auto-lane/<id>`) and land serialized merges; round-level isolation is orthogonal:
   lane branches live inside whichever branch is checked out at the root of the nested
   repo. The design unit must pin one e2e case of lanes inside an isolated repo.

The audit trail trade-off is stated, not hidden: during the round the per-unit record
lives in the working repository + the isolated branch; after `land` the deliverable's
history holds one commit, and the full per-unit trail remains in the driven root's git —
which is exactly the 0064 record model (the driven root is the process layer of record;
the deliverable repository is the person's to curate).

## 3. Unit split

- **U-L1 (core)**: the config key + isolation at round establishment + refusal paths
  (dirty nested repo at isolation time → block listing the paths).
- **U-L2 (shell command)**: `land` (+ `--keep`, `--abandon`), its exit codes under the
  contract (0 landed / 1 usage / 2 blocked-for-human), and the README section.
- **U-L3 (tests)**: unit suites + one e2e (isolate → run units → land → assert one
  commit, original branch intact, `auto/R-NN` gone; plus the lanes-inside-isolation case).

## 4. Risks

- Round-establishment refusal when a designated repo is dirty — must name the repo and
  stay a person decision (the same class as today's run-start clean gate).
- `land` on a diverged original branch is a conflict surface by design: refusal, never
  an automated merge resolution.
- The isolation branch left behind by an abandoned run is recoverable state, not
  corruption: `land --abandon` and plain git both address it; preflight reports it.

## 5. Rulings (decided 2026-10-04 — all as recommended)

1. Approve the branch-isolation mechanism (rejecting the `.git`-removal design)?
2. Command name `land` (recommended over `commit` — avoids colliding with the "sessions
   never commit" doctrine)?
3. Default landing mode squash-one-commit (recommended, matches the requirement) with
   `--merge` as the explicit alternative?
4. Config surface: key name (proposal: `isolate`, a list of relative paths) and the
   init flag `--isolate`; alternatives welcome.
