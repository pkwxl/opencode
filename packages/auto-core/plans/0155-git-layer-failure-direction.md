# 0155 — the git layer: failure-direction, the multi-door wall, stamp ordering

The 2026-10-30 three-package review of the auto tool family (auto-core, the `auto` shell, the
cleanroom workspace) walked the git layer's read seams end to end and found one founding failure
class plus four edge defects, each verified against the current tree before this change. This
document rules them together because they share one shape: a git-side fact the machinery reads but
cannot afford to misread — a failed read taken as clean, a missing door taken as out of scope, an
insert order that silences an allowance, a `!` over a maybe-undefined — and one principle answers
them all: the uncertain read resolves toward dirty, the failure surfaces, never a quiet verdict.

## The measurement (the review's findings, file:line evidence at HEAD bb414d168)

- **The quiet direction at the git-read seam** — `hasChanges` (src/git.ts): the comment claimed
  only "when git is unavailable (spawn throws), treat as no changes", but the code
  (`if (!status || status.code !== 0) return false`) swallowed **nonzero exits** into "clean" too;
  `statusEntries` returned `[]` on both a nonzero toplevel probe and a nonzero status; and
  `unitViolations`' rev-parse catch (`head === undefined … continue`) read a failed HEAD as "no
  violation" — while `baselineIntact` ten lines of logic away already pushed a problem line over
  the same shape. `sealedChannelCheck` (src/wall.ts) returned `[]` on a nonzero `git log`, against
  the module's own inherited contract "a scan failure is a red lane" (0121 D5).
- **The multi-door recovery gate was all-or-nothing** — `closeWall` (src/wall.ts):
  `if (!present.length && text !== undefined)` ran the driver-stamp recovery derivation only when
  NO declared door survived. `Wall: seal linux, vendor` with the person's tracked removal of
  `vendor` and its 0122 stamp still live in the untracked opencode.json gave `present = [linux]`,
  recovery skipped, `targets = [linux]` alone — vendor's allow orphaned by both the person-entry
  split (it operates on recorded targets) and `retireAndDeny`, the reference readable through the
  live allow past a wall the record calls closed. Every scene in test/wall.test.ts used a single
  door.
- **The boundary stamp's insert order** — `stampKnowledgeBoundary` (src/external-dirs.ts) inserted
  the missing pair at the absolute front: a person pre-set `"/**"` key with `/tmp/**` missing
  yielded `["/tmp/**", "/**"]`, and under last-match-wins the catch-all deny beat the /tmp allow —
  the receipts convention silently disabled, the exact quiet break the sibling 0122 stamp
  (`externalWithAllows`) already places correctly (after any existing `"/**"` key). Beside it,
  `stampWallClosure`'s person loop carried a dead ternary arm (`denies[key] !== undefined &&
  action === "allow"` — a stamp-key allow had already `continue`d) and let a person `"ask"` on a
  stamp key overwrite the wall's deny through the `{ ...denies, ...person }` spread while
  `closeWall` logged "a standing deny recorded in opencode.json" — a false record.
- **Two landing edges** — `landUnit` (src/land.ts): `const base = (await mergeBaseFull(...))!`
  with `mergeBaseFull` returning undefined on a nonzero `git merge-base` (unrelated histories),
  the `!` crashing at `base.slice(0, 7)` inside the refusal message instead of producing the
  blocked line; `landBranch`'s own-file resolution (src/git-worktree.ts) discarded every
  `checkout --ours`/`add` result — a modify/delete conflict whose main side deleted the file
  ("path … does not have our version", verified live) left the surviving lane content staged as
  the resolution and concluded the merge `{ type: "ok" }`, the parent-owned file silently resolved
  onto the lane's side against the documented contract.
- **Hygiene** — `abortToLandResult` judged the abort with `changedFiles(root)`, walking every repo
  root under the merged repository: a dirty nested repository elsewhere misreported a clean abort
  as "abort failed" (the same one-line shape in `squashFailure`, src/git-land.ts).

## D1 — the ruling: failure-direction at every git-read seam (P12's founding class)

The spawn-throw (git binary unavailable) and the nonzero exit over a discovered repository root
are now different facts everywhere. The spawn-throw keeps the quiet no-changes/undefined direction
(the non-git floor; non-git environments never reach a root to ask — `repoRoots` is empty there,
verified). A nonzero exit is an anomaly and resolves toward dirty/loud, classified per caller:

- `hasChanges` returns `boolean | undefined` (undefined = unreadable status). `commitTree` pushes a
  failure line (the skip decision cannot be made; a blind add+commit would sweep an unjudgeable
  tree — P4's halt owns the stop); `stashTree` refuses with a failure before writing; `rollbackUnit`
  refuses at both stash decisions (the scene cannot be judged, the repository left untouched for
  the human); `pendingChanges` counts unreadable as pending (its one caller skips on pending — it
  must not proceed over a tree it could not read).
- `statusEntriesRead` is the new strict distinguishable read (undefined = the toplevel probe or
  the status failed; it prints the ⚠ line naming the root and git's own error). `statusEntries`
  keeps its legacy signature — every existing caller compiles and behaves identically over a
  readable repository — and becomes its front: unreadable → the ⚠ line already printed, then
  `[]`. The strict in-scope gates ask `statusEntriesRead` and block: `beginUnit` (one extra status
  pass per unit start buys the gate its own strictness — the block line names the root),
  `land`'s and `isolateRound`'s clean gates (an unreadable designated repository blocks naming
  the anomaly, never a quiet pass).
- `unitViolations` follows `baselineIntact`'s shape exactly: unreadable HEAD against a non-empty
  baseline pushes "${rel}: HEAD unreadable (repo missing or history corrupt), close-out check
  failed"; the both-empty floor (no commits when the unit started, still none now) keeps passing.
- `sealedChannelCheck` (now exported beside the boundary family's other test-facing readers)
  returns a blocking finding on a nonzero `git log` — the freeze assertion never reads as green on
  an unreadable history.
- `abortToLandResult` and `squashFailure` judge the abort over the merged repository alone
  (`statusEntriesRead(root, root)`), and an unreadable verdict there reads as failed, never clean.

## D2 — the multi-door wall close: recovery whenever any declared door is missing

The recovery gate relaxes from `!present.length` to "any declared door missing"
(`present.length < declared.length` under a fill; the no-fill shape keeps its all-or-nothing
reading — no declared door means the only missing signal is no door at all). The recovery
mechanics are unchanged: `allowBase`, the current-external-set skip, the stat probe, and the
placeholder name (`declared.length === 1 ? declared[0] : RECOVERED_DOOR` — with several declared
doors a recovered entry keeps "(removed)", which `recreatedDoors` already skips and
`wallOpenFindings` already re-derives targets from). What changes is scope: a hand-removed door's
target now enters `doors` → `targets` → the person-entry split, `boundaryAllowedTargets`, and
`retireAndDeny` — the one retirement path (P5) reaches every stamped allow the close is
accountable for.

## D3 — stamp ordering and the seal's standing deny

- `stampKnowledgeBoundary` places the missing pair through `externalWithAllows` (the 0122 stamp's
  own placement): after any existing `"/**"` key when one exists, else the front insert in
  canonical order — byte-identical without a `"/**"` key. A person catch-all of any action keeps
  its bytes (never inserted over), and the /tmp allowance now wins its tie against it.
- `stampWallClosure`'s person loop drops the dead ternary: a retiring key contributes nothing of
  the person's — the wall's deny stands. The ruled direction: the person's non-allow action on a
  sealed target is overridden by the seal they invoked at transfer; the standing deny IS the
  recorded close, and the close's log line is now true. A person `"deny"` already on the key
  keeps the same bytes it always had.

## D4 — the landing edges

- `landUnit`'s merge base is guarded: undefined → the named refusal ("share no merge base (an
  unrelated history) … merge by hand or re-create the isolation point"), additive to 0074 §2.3's
  refusal matrix — a refusal is never an automated merge resolution, and never a crash.
- `landBranch`'s own-file resolution checks every step: a failed `checkout --ours` or `add`
  returns the real-conflict outcome through `abortToLandResult` — the merge stays a conflict, the
  parent's side stands, the lane survives for the conflict protocol. Never a silent resolution
  onto the lane's side.

## The floors

- The spawn-throw keeps the quiet direction at every seam of D1; non-git environments are
  byte-identical (their `repoRoots` is empty — no root is ever asked).
- `statusEntries`' signature and its behavior over readable repositories are unchanged; so are
  `changedFiles`/`untrackedFiles` and every consumer outside this change's files.
- The boundary stamp without a `"/**"` key writes the same bytes as before; the no-fill wall shape
  keeps its all-or-nothing recovery; the closed predicate, the wall record's grammar and the
  placeholder-door reading are untouched.
- The landBranch happy path and the true own-file conflict (both sides modify) behave exactly as
  before — only the failing resolution step changed direction.

## The named residuals

- The loop-side clean gates (the run-start gate through the seam, the loop-task unit gates) and
  `release`'s clean-tree check consume the legacy-typed read: over an unreadable root they print
  the ⚠ line through the wrapper but their verdicts stay quiet-clean — the loud stop lands at
  `beginUnit` (the strict gate they share), at the close-out (`commitTree`'s failure, P4's halt)
  and at `unitViolations`' problem line. Moving the strictness into those callers belongs to
  their owning plans.
- `unitBaseline` records "" over an unreadable HEAD (the empty-repository convention): the
  close-out's both-empty floor then passes — the close's commit failure is the loud stop there.
- A hand-removed door whose stamp was already retired leaves no trace — nothing to recover, the
  seal complete by absence.
- `coveringAllowKeys` counts only `"allow"` actions: a person `"ask"` on a stamp key stays
  invisible to the person-entry split (standing observation — the seal's deny overrides it at
  retirement anyway, D3).
- Deferred with their own owners: `stashTree` stashes whole repositories without the subtree
  pathspec while `rollbackUnit` confines with `-- .` (needs its own 0053 D20 intent ruling); the
  doc-lane decorator's carryover losing the base gate's workdir excludes (git-ops.ts, latent,
  installation-order only).

Derives: **P12** (fail loud; conservative under uncertainty — the showing: D1's every seam and
D4's resolution step, each uncertain read resolved toward dirty/conflict instead of the quiet
clean/ok verdict the review measured), **P5** (single ownership — the showing: D2's one
retirement path reaching every stamped allow of a multi-door close, and D3's retiring keys taking
the wall's deny as the one writer of the seal's record), **P6** (derived state, re-derivation —
the showing: the recovered targets re-derived from the live allows and disk rather than a
recorded list, and the boundary stamp's placement re-derived from the file's own key order),
**P10** (the byte-identical floor — the showing: the named floors above, each mechanism's absent
shape writing the same bytes as before), **P8** (deliberate enforcement moments — the showing:
the ⚠ detection record at the legacy seam teaching its remedy while blocking stays with the
gates and the person's moments). Amends: **0132 D2** (the close's recovery gate — all-or-nothing
widened to any-declared-door-missing; the sealed-channel check's nonzero exit now the red lane
its own contract already claimed) and **0147 D1** (the boundary stamp's insert clause — "at the
front" now "after any existing `/**` key, else the front"). Tier touched: **mechanism** — core
(`src/git.ts`, `src/wall.ts`, `src/external-dirs.ts`, `src/land.ts`, `src/git-land.ts`,
`src/git-worktree.ts`).

## Category scope (0123 D1's discipline — reconstructed 2026-11-05 by 0166 step 003 from this ruling's D-blocks and landing commit 374129a14)

Family: *the git service layer's failure direction — every uncertain read resolving toward
dirty/conflict/refused, never a quiet clean.* Home-set reconstructed from D1–D4, the floors and the
residuals:

| home | disposition |
|---|---|
| `src/git.ts` (hasChanges' undefined; statusEntriesRead the strict read; commitTree/stashTree/rollbackUnit/pendingChanges classified per caller; unitViolations' unreadable-HEAD line; landBranch's guarded edges) | changed — D1/D4 |
| `src/wall.ts` (the any-declared-door-missing recovery gate; sealedChannelCheck exported and blocking; stampWallClosure's standing deny) | changed — D2/D3 |
| `src/external-dirs.ts` (stampKnowledgeBoundary through externalWithAllows — after any `/**` key, else the front) | changed — D3 |
| `src/land.ts` and `src/git-land.ts` (the unrelated-histories merge-base refusal; abortToLandResult/squashFailure judged over the merged repository alone) | changed — D4 |
| `src/git-worktree.ts` (beginUnit's and isolateRound's strict in-scope gates) | changed — D1 |
| `statusEntries`' legacy signature and its behavior over readable repositories; `changedFiles`/`untrackedFiles` and every consumer outside this change's files | held, untouched — the floors |
| The loop-side clean gates and `release`'s clean-tree check (consume the legacy-typed read; their loud stops land at beginUnit, the close-out and unitViolations) | held, untouched — the named residual, their owning plans' to move |
| The no-fill wall shape's all-or-nothing recovery, the wall record's grammar, the landBranch happy path and the true own-file conflict | held, untouched — the floors |
| Test homes: `test/git.test.ts` (the 0155 describe, the two landBranch cases), `test/wall.test.ts` (the two-door scene, the blocking sealed-channel finding), `test/external-dirs.test.ts`, `test/land.test.ts` (the unrelated-histories refusal) | changed |

Tests: `test/git.test.ts` — the 0155 describe (the corrupt-index anomaly: `statusEntries`' ⚠ and
empty answer beside `statusEntriesRead`'s undefined, `commitTree`'s refusal failure line,
`stashTree`'s refusal, `rollbackUnit`'s untouched-with-failure, `pendingChanges` counting
unreadable as pending, `unitViolations`' unreadable-HEAD close-out failure beside the
both-empty floor, `beginUnit`'s strict dirty gate naming the root) plus the two landBranch cases
(the modify/delete own-file conflict aborting as a real conflict with the parent's deletion
standing, and the abort judged over the merged repository alone beside a dirty nested repo);
`test/wall.test.ts` — the two-door scene (the hand-removed vendor door recovered under the
placeholder, both stamps retired to denies, the boundary re-deriving closed) and the unreadable
history as a blocking sealed-channel finding; `test/external-dirs.test.ts` — the 0155 pins (the
missing pair after a person catch-all, ask-on-stamp-key overridden by the standing deny);
`test/land.test.ts` — the unrelated-histories refusal (blocked, naming the state, nothing
landed).
