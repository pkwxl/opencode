# 0147 — the working-directory knowledge boundary: everything outside denied, /tmp excepted, symlink targets read-only

The maintainer's rulings (2026-10-28, over the dm-glm-t083-250 fork's T-083 block diagnosis — the
first fork's 23:53 "solution" of the dangling-`$LINUX` wall had been to read the main checkout's
`test/in_container.sh`, the T-117 fix, knowledge from outside the fork), the maintainer's own words:

> *The method in last night's T-083 fork that seemingly solved the problem correctly is actually
> invalid, as it referenced future knowledge (T-117). The runtime parameters erroneously granted
> unpermitted ask-allow privileges, enabling the coding agent to access knowledge outside the working
> directory. In the future, we may also need to restrict it from accessing knowledge left in /tmp
> concurrently by other forks.*

> *Symlinks in the working directory (including the paths they point to) should be changed to
> read-only access, and modifying content within symlinks should not be allowed.*

And the answered design fork: **/tmp stays an explicit allow** (the target projects' own receipts
convention — `/tmp/opencode`, bind-mounted by their container scripts — is the evidence channel
verification itself depends on; the concurrent-forks leak through the shared directory is the named
residual), and the rollout is **template + fix rule** (the 0138 ignore-set precedent: a committed
project surface repaired by the person's command, never silently at run — the spawn-time floor over
`OPENCODE_CONFIG_CONTENT` recorded as the rejected alternative: immediate for standing projects but
beating the person's file, a second mechanism, and inert under external servers).

## The measurement (the incident, the permission model verified at the source)

- **The incident's own shape**: the first fork's session read a sibling checkout's *future* state
  (T-117 landed in main after the fork's base) and ported it as a "fix" — the retry environment
  contaminated by knowledge that does not exist in its history; the `-250` fork's verification
  rounds judged "their" exec round against receipts (`vfull-B14-verity7`) another fork's tree had
  produced in the shared `/tmp/opencode`; and the `-250` fix session's last act — a workaround
  writing under the sibling fork's `tmp/` — was the permission posture asking, then auto-denying
  (ask-deny, the unattended default): the one place the boundary held, and the only reason the
  contamination stopped there.
- **The permission model, verified at the source** (`packages/core/src/v1/config/permission.ts`,
  `packages/core/src/tool/{read,edit,write}.ts`, `packages/core/src/permission.ts` `evaluate`,
  `packages/opencode/src/tool/external-directory.ts`): every permission key takes a bare action or a
  pattern→action object; every tool access to a path outside the working directory asserts
  `external_directory` first, then its own action (write rides `edit`); `evaluate` is `findLast`
  over the merged rules with an unmatched default of `ask`; config key order is preserved
  (order matters within one action's patterns). So the composed posture works exactly: a catch-all
  `"/**": "deny"` in `external_directory` gates every outside access (reads included — `read:
  "allow"` only opens the tool, the path gate still applies), `"/tmp/**": "allow"` after it excepts
  the receipts convention, later keys always win — the person widens by appending.
- **The mechanism's own walls**: 0122 already owns the additive opencode.json stamp discipline
  (person keys never overridden, always winning ties); the wall (0132) already owns the deny-side
  stamp; the template already ships the permissive posture byte-for-byte — the error lives in one
  file the driver itself authors.

## D1 — the boundary

The template ships `"external_directory": { "/**": "deny", "/tmp/**": "allow" }` (order canonical:
the deny first, anything after it winning the tie). Everything outside the working directory —
sibling checkouts, other forks' trees, the main checkout's future state — is denied to every
driver-spawned session; /tmp is excepted (the receipts convention); the person widens by appending
later keys, never the agent. `fix` carries the pair to standing projects as a fixable finding
(`stampKnowledgeBoundary`: insert the missing keys at the front in canonical order — existing
allows and person rules end up after the deny and keep functioning; a person's own `/**` key of any
action counts as the wall present, never inserted over; malformed shapes stay manual). No config
key (the boundary is a driver invariant, not a project choice); no spawn-time floor (the rejected
alternative, recorded); `fork` stays pure git (0128's floor — the fork's committed opencode.json
repairs through `fix` like any standing project).

## D2 — symlink targets read-only (amends 0122's stamp action)

The root-symlink stamp becomes the **read-only composite**: `"<realpath>/**": "allow"` under
`external_directory` (the read side opens — 0122's exact bytes) **and** `"<realpath>/**": "deny"`
under `permission.edit` (the write side closes — the t083 incident's port came through exactly such
an opening). The edit-layer stamp (`stampReadOnlyEdits`): an absent or bare-action edit rule
materializes as the object form with the blanket action preserved as its leading `"*"` entry (the
effective default, never widened); an existing object keeps its order with the denies placed after
its `"*"` key (beating the blanket action, losing to every person key that follows). The
external_directory stamp's insert position adapts to the boundary: allows land after any `"/**"`
key (whoever set it) so they function beneath the catch-all deny — without one, 0122's front insert
stands. `externalAllowsStatus`/`applyExternalAllows` compose both layers (init and fix share
them); the fixable finding names both layers' missing keys.

## D3 — the named residual

Concurrent-fork receipts in the shared `/tmp/opencode` remain readable (the maintainer's "may also
need" future): a per-run receipts directory is the target projects' own convention change, not the
driver's to impose — recorded as the reopen trigger when a real consumer locks the shape (P21).
Bash command-argument path detection is opencode's own best-effort (the tool's documented advisory
nature): the boundary is hard at the read/edit/write tool layer, best-effort through bash — the
named limitation, upstream's to close.

## The floors

- The wall (0132) composes, with one ruled interplay: the person-entry split and the retirement
  treat the boundary's canonical keys as the driver's own (re-derivable from the template, exactly
  the 0122-stamp argument — never a person-authored block, never retired), and a reference inside
  the allowed /tmp subtree **cannot seal** — the receipts allowance beats the wall's per-target deny
  under last-match-wins — so the close refuses such targets, teaching the move (the reference out of
  /tmp, or the person narrowing the allowance by hand).
- No root symlinks: nothing stamped beyond the boundary, the byte-identical floor of 0122 held.
- A person's opencode.json: only the three additive exceptions (the boundary pair, the symlink
  allows, the read-only edit denies) — every person key kept, in order, always winning ties.
- The wall (0132) composes: its closure retires the stamp keys beside its own deny — under the
  boundary the retired door's path falls to the `/**` deny, tighter still.
- The spawn config (`OPENCODE_CONFIG_CONTENT`) stays the provider-keys channel — no permission
  floor rides it (the rejected alternative).

Derives: **P16** (no environment-specific knowledge — the showing: the session's world is the
working directory; a sibling checkout's future state is environment knowledge the agent must not
read, exactly as a project's paths never enter core code), **P2** (the person brackets every
boundary — the showing: the person widens by explicit later keys, the agent never self-widens; the
23:53 read was the agent consuming a decision that was not its to make), **P8** (deliberate
enforcement moments — the fix rule's finding teaches the boundary and its remedy), **P19** (the
incident's own measurements: the 23:53 T-117 read, the 10:47:10 ask-deny as the posture holding,
the verity7 cross-fork receipts; the permission model verified at the source, not assumed).
Amends: **0122's stamp action** (the bare allow becomes the read-only composite; the insert
ordering adapts to the boundary's deny). Tier touched: **mechanism** — core
(`templates/opencode.json`, `src/external-dirs.ts`, `src/config-fix.ts`) and the docs' restatements
(structure.md, AGENTS.md, the shell README's fix table).

## Category scope (0123 D1's discipline — reconstructed 2026-11-05 by 0166 step 003 from this ruling's D-blocks and landing commit fc84aec40)

Family: *the session's external-directory knowledge boundary — the opencode.json posture a project
ships, the stamps that write it, and its interplays with the wall and the person's own keys.* Home-set
reconstructed from D1–D3 and the floors:

| home | disposition |
|---|---|
| `templates/opencode.json` (the boundary pair ships: `/**` deny first, `/tmp/**` allow) | changed — D1 |
| `src/external-dirs.ts` (stampKnowledgeBoundary; the root-symlink read-only composite; externalAllowsStatus/applyExternalAllows composing both layers) | changed — D1/D2 |
| `src/config-fix.ts` (the fixable finding carrying the pair to standing projects) | changed — D1/D2 |
| `src/wall.ts` (the interplay: a /tmp-resident reference cannot seal — the allowance beats the per-target deny, the close refuses and teaches the move; the boundary's keys re-derivable, never retired) | changed — the floors |
| `packages/auto/src/index.ts` and `packages/auto/README.md` (init's stamp; the fix table's restatement) | changed |
| The spawn config (`OPENCODE_CONFIG_CONTENT` — stays the provider-keys channel, no permission floor) and `fork`'s pure-git floor (0128) | held, untouched — D1's rejected alternatives, recorded |
| The no-root-symlink floor (nothing stamped beyond the boundary; 0122's byte-identical floor held) and every person key's order-and-tie win | held, untouched — the floors |
| Test homes: `test/external-dirs.test.ts`, `test/config-fix.test.ts`, `test/wall.test.ts`, `packages/auto/test/e2e.test.ts` (the wall fixture's corpus moved out of /tmp) | changed |

Tests: `test/external-dirs.test.ts` — the boundary stamps (the canonical order, the idempotence,
the person's own `/**` wall never inserted over, the absent-permission apply), the read-only edit
stamps (the bare-action materialization preserving the effective default, the object insertion
after `*`, the person key never overridden), and the ordering pin (a symlink allow lands after the
`/**` deny and wins its tie; without the deny, 0122's front insert); the composite's status/apply
pins updated (both layers named); `test/config-fix.test.ts` — the boundary finding on a person
file (fixable, additive, the person's `model` key intact), the missing-file write carrying the
boundary beneath the composite, the additive gains (the boundary finding beside the composite
finding, the person key last and winning), the stale and malformed cases isolated with the
boundary seeded (the malformed file now reporting both families' manual findings);
`test/wall.test.ts` — the interplay pin (a /tmp-resident reference with the boundary shipped: the
close refuses naming the subtree and the move, nothing mutated, the boundary's keys never
person-authored; the person narrowing the allowance by hand lets the close proceed), the
person-entry fixture's corpus moved out of /tmp (every /tmp-covering allow at "allow" now reads as
the boundary's own); the shell's e2e wall and 0122 suites aligned (the wall fixture's corpus under
the home directory, the closed config carrying the boundary pair beside the wall's deny, the
init-stamp line and the fresh file's boundary-only floor).
