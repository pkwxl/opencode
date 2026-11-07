# 0188 — the admission oracle, the catch-all placement's every spelling, and the read-only edit deny in the forms the tools ask

Status: active-authority (0166 remediation step 028, wave W4-wall-perms; findings 0165-039 = S20-03 and 0165-150 = S20-13, both CONFIRMED by the R7-perm lead against this repository's own opencode matcher and tool registry).

The 0165 S20 design note named this wave's first act: "a W-wall wave whose first act is an opencode-matcher oracle in the tests (S20-13). With that oracle in place, S20-01/02/03 become test-visible." The permission family had reasoned about opencode's permission system from first principles and never tested against it — every stamp test pinned key ORDER, and the two defects below shipped exactly there: the stamps read as present to `fix` (no finding) while admitting (or failing to deny) what the person's config claims they gate.

The measured facts (R7-perm, re-verified at this step against the current sources):

- opencode's live v1 edit tools — `edit.ts:104,147`, `write.ts:56`, `apply_patch.ts:205`, all registered by `registry.ts` — ask the `edit` permission with **`path.relative(instance.worktree, filePath)`**: a worktree-relative pattern such as `../corpus/drivers/x.c` (an absolute-path edit) or `linux/drivers/x.c` (an in-tree write through the door symlink). The read side (`tool/external-directory.ts`) asks `external_directory` with the absolute `<dirname>/*` glob.
- `evaluate` (`permission/index.ts:29`) is `findLast` over the merged rules with an unmatched default of `ask`; `fromConfig` preserves object key order and expands `~`/`$HOME`; `Wildcard.match` (`core/src/util/wildcard.ts`) turns `*` into `.*` and `?` into `.`, anchored — so `*`, `**`, `/*` and `/**` all match every absolute path, and the driver's placement cut must recognize every spelling, not the literal `"/**"` alone.

## D1 — the admission oracle (0165-150's test half)

A test helper, `test/helpers/perm-oracle.ts`, that evaluates a config's permission section **exactly as opencode does**: rules built from the section object in file key order (`fromConfig`'s shape, the `~`/`$HOME` expansion mirrored), judged by `findLast` with the permission name matched too (upstream matches both the name and the pattern), the unmatched default `ask` — using **opencode's own `Wildcard.match`, imported from the workspace source** (`packages/core/src/util/wildcard.ts`; the same file the 0165 measurements and 0147's "verified at the source" ruling read). The import is the oracle's point, not a convenience: a copied matcher would be a second source that drifts silently (P5); the import fails loudly the day the matcher moves, and that failure is the oracle doing its job. This is the first cross-package source import in the test tree — deliberate, test-only (the import-direction ratchet scans src/, and src gains no such edge), and named here as the ruling that admits it.

The stamp suites' assertions graduate from key order to **admission**: what does the stamped file answer for the corpus read (`<target>/drivers/*` under `external_directory`), for the edit asks (`../<rel>/drivers/x.c` and `<door>/drivers/x.c` under `edit`), and for the receipts convention (`/tmp/...`)? Key-order pins stay where they pin the person-key discipline; the admission pins are the oracle's own. S20-01/02's wall-side questions (step 029) consume the same helper when they land.

## D2 — the catch-all placement recognizes every spelling (0165-150)

`externalWithAllows` (the `external_directory` insert) and `objectWithInserted` (the `permission.edit` insert) move their cut from the literal `"/**"` (first occurrence) / the literal leading `"*"` to **after the last existing key that matches every pattern the layer's tools ask** under opencode's matcher:

- `external_directory` asks absolute `<dirname>/*` globs — its catch-alls are the spellings that match every such ask (`/**`, `/*`, `*`, `**`, `/?*`, …);
- the v1 edit tools ask worktree-relative paths — its catch-alls match every relative path (`*`, `**`, …; `/*` and `/**` are NOT catch-alls there, lacking the leading slash they require).

The predicate is one exported mirror of opencode's matcher translation (escape, `*`→`.*`, `?`→`.`, anchor) plus per-layer probe sets, all in `src/external-dirs.ts` — the one src home — pinned against the oracle's real matcher over a spelling corpus (`*`, `**`, `***`, `/*`, `/**`, `/?*`, `/a/**`, `**/*`, `?`, `src/**`, `/tmp/**`): divergence between mirror and matcher is a red test, never a silent drift. The mirror exists because the core carries no dependency on opencode's packages (P14 — the SDK seam is the one the adapter owns, and the matcher is not in it); the oracle is what keeps it honest.

Byte-identical where the catch-all is spelled `/**` or a single `"*"` key (every existing pin's shape — the template, the boundary, the 0155 D3 person files): the cut lands where it landed. The changed behavior is exactly the defect: a person catch-all spelled `*` (or `**`, `/*`) that lands last no longer silently kills the 0122 allows and the /tmp receipts allowance under last-match-wins while every reader reports the stamps present. This amends 0155 D3's placement premise (below).

## D3 — the read-only edit deny stamped in the forms the tools ask (0165-039)

The 0147 D2 composite's edit layer carries, per door, **three** deny keys instead of the one absolute form (which matched no request on the live tool path — the write side never closed, whatever the config read):

1. `"<realpath>/**"` — 0147 D2's exact bytes, kept: the wall family's readers, the claude adapter's generic translation (`contract.ts` picks the new keys up unchanged — their grammar question is 030's finding), and any consumer that ever asks the absolute form;
2. `"<rel>/**"` where `rel = path.relative(base, realpath)` — the worktree-relative form the v1 tools actually ask (`../<corpus>/drivers/x.c`); `base` is **opencode's own derivation of the instance worktree**, `git rev-parse --show-toplevel` from the target directory (one read through git.ts's spawn helper — external-dirs gains the runtime→kernel edge the ratchet already allows, its "node builtins only" comment restated in the same change), with the physical target directory as the fallback when git will not answer (tests' bare directories; a fallback base deeper than the true one can only make the relative key more specific — inert at worst, never broader, P12's conservative direction);
3. `"<door>/**"` — the door name, for in-tree writes through the symlink (`linux/drivers/x.c`), which no absolute or `../`-form key can reach.

`readOnlyEditEntries` takes the doors and the base (the name half is the door scan's own); `externalAllowsStatus`/`applyExternalAllows` derive both beside the real paths; config-fix's template write and rule name the new keys; init's status line lists them (its deduped form keeps naming the target key first, so the shell's e2e pin stands). All three land through the same insert helpers with the same person-key discipline (a key the person already set, to any action, is present — never inserted over), and the oracle pins the admission: both edit ask shapes deny, the read ask allows, /tmp allows.

This amends 0147 D2's stamp shape (the composite grows two keys; the single-key form's premise — that the absolute deny closed the write side — was false on the live tool path, the finding's own measurement).

## The floors

- No root symlinks: nothing stamped, nothing written, the file byte-identical (0122's floor, untouched).
- A catch-all spelled `/**` (or a single `"*"` edit key): the cut lands exactly where the old literal rule put it — the existing pins' bytes stand (P10).
- The allow layer (`external_directory`) is untouched: 0122's entries, ordering and bytes stand as they are.
- The wall side (`stampWallClosure`, the closed predicate) is untouched: this step owns the stamps' admission, not the wall's doors (step 029).

Derives: **P12** (fail loud, conservative under uncertainty — the showing: a stamp that read "read-only" while admitting writes and a placement that read "present to fix" while admitting nothing are both silent lies made loud; the fallback base errs toward the tighter key), **P19** (measured evidence — R7-perm's matcher-and-registry measurements are the ruling's whole ground; the oracle pins the drivers to the measured counterpart instead of a first-principles re-implementation), **P7** (grammars, never content — the new keys are mechanical derivations of disk facts: the door's name, its resolved target, the worktree root), **P6** (derived state, idempotence — the three keys re-derive from the same scan at every write, re-running reproduces the same bytes), **P13** (frozen additive-only vocabularies — the edit layer's key set grows additively; no existing key changes meaning; the oracle adds no protocol vocabulary), **P10** (the byte-identical floor — the two floors above; the composite's growth is the ruled defect fix, P10's named exemption). Amends: **0147 D2** (the composite's edit layer — three keys in the forms the tools ask, the absolute form kept), **0155 D3** (the placement's catch-all premise — every spelling that matches every layer ask, not `/**` alone). Tier touched: **mechanism** — `src/external-dirs.ts`, `src/config-fix.ts`, the test homes; no principle change.

premises this ruling changes: **0147** (D2's single-absolute-key write side never closed on the live tool path — re-read in the same change: D1's boundary and D3's residual stand untouched; the floors' "person keys always win ties" stands; only the edit layer's key set grows), **0155** (D3's `/**`-only spelling premise — re-read in the same change: the pair-after-the-catch-all placement stands, widened to every spelling; the seal's standing-deny half untouched). 0132 and 0122 were re-read and stand: the wall reads only `external_directory` (no edit-layer premise), and 0122's allow layer is byte-untouched.

## Category scope (0123 D1's discipline)

Family: *the session's external-directory knowledge boundary — the opencode.json posture a project ships, the stamps that write it, and its interplays with the wall and the person's own keys* (0147's own family, unchanged). Home-set:

| home | disposition |
|---|---|
| `src/external-dirs.ts` (the matcher mirror + per-layer probe sets + `catchAllFor`; the two insert cuts; `readOnlyEditEntries(doors, base)` + the worktree base; `externalAllowsStatus`/`applyExternalAllows`; the header's ordering and composite paragraphs restated) | changed — D2/D3 |
| `src/config-fix.ts` (the template write and the fix rule derive doors+base beside the real paths; the finding names the new keys) | changed — D3 |
| `test/helpers/perm-oracle.ts` (the oracle: upstream matcher import, fromConfig/evaluate mirror, `admission()`) | created — D1 |
| `test/external-dirs.test.ts` + `test/config-fix.test.ts` (the admission pins, the catch-all placement pins per spelling, the mirror-vs-matcher corpus pin, the composite's three-key pins) | changed — D1/D2/D3 |
| `test/import-direction.test.ts` (external-dirs' sub-domain comment: "touching only node builtins" → the one git spawn edge, runtime→kernel already allowed) | comment restated — D3 |
| `docs/structure.md` (the external-dirs row's composite sentence gains the tools'-ask forms and the every-spelling placement), `packages/auto/README.md` (the fix-table row's read-only-stamps entry names the forms), `AGENTS.md` (the navigation line gains 0188) | restated |
| `packages/auto/src/index.ts` (init's stamp line — no code change; the deduped key list grows), `packages/auto/test/e2e.test.ts` (the pin's substring stands; verified) | held, verified |
| The wall side (`src/wall.ts`, the closed predicate, `stampWallClosure`) | held, untouched — step 029 |
| The claude translation (`src/agent/claude/contract.ts`) | held, untouched — picks the new keys up generically; its grammar question is step 030 (S20-04) |

## Residuals

- **The lane-worktree relative depth**: a lane session's worktree root sits under `.auto/worktrees/`, so its absolute-path edit asks are `../../../<corpus>/…`-deep — the one relative key (anchored at the primary root) does not cover them; door-relative writes are covered whenever the door is checked out (the door-name key is depth-free), and reads stay gated by `external_directory`. No static key set covers every depth; a per-lane re-stamp would be new machinery with no measured incident — recorded as the reopen trigger (P21).
- **The src-side matcher mirror**: one home, oracle-pinned against the imported matcher; it is an approximation by construction (the core carries no opencode-package dependency), and the pin is what bounds the drift.
- **Stale edit-layer keys** (a removed door or a closed wall leaves the three denies standing): harmless defense-in-depth (they deny writes into a reference that stays reference), and the stale-allow finding's extension to the edit layer is not added — S20-14's hygiene family owns that scan's dedups.
- README:458's wider overclaim question (the row's claim vs the wall family's whole truth) rides step 030's S20-10/S22 rows; this step makes the row's own words true and no more.

## Tests

- `test/helpers/perm-oracle.ts` — the oracle (D1): upstream `Wildcard.match`, the `fromConfig` expansion, `evaluate`'s findLast; `admission(text, section, ask)` and `rulesOf(section)` exported for the suites.
- `test/external-dirs.test.ts`:
  - the admission pins (D1/D3): a stamped fixture's `external_directory` answers the corpus read ask `allow` and `/tmp` asks `allow`; its `edit` answers `../<rel>/drivers/x.c` and `linux/drivers/x.c` `deny` — fail-before red on the pre-fix source (the edit asks read `allow` off the blanket `*`);
  - the placement pins (D2): person catch-alls `*`, `**`, `/*` (and the `/**` control) at last position, both layers — the allows/denies still function beneath them — fail-before red on `*`/`**`/`/*` (the front insert left them dead), byte-identical on `/**`;
  - the mirror pin (D2): `catchAllFor` agrees with the imported matcher over the spelling corpus for both probe sets;
  - the composite's three-key pins (D3): entries, status missing list, the applied file, idempotence.
- `test/config-fix.test.ts`: the fix rule's named keys, the clean-file fixture carrying person actions on all three keys, the stale-allow file carrying the full composite (D3).
- `packages/auto` e2e: the init line and fix rows verified against the grown key list (no edit expected — the target key stays first in the deduped line).
