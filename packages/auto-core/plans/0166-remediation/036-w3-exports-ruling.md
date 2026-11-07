# Step 036 — w3-exports-ruling: the exports ruling — entry modules vs the open `./*` boundary

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W3-shell-seam, finding **0165-174** (S32-03, S3, CONF, BOUND, P14/P5;
0165 §9-3 named it a matter for the maintainer's ruling; ruling 0194 D3's
residual named this step for the exports half). Started 2026-11-07 at HEAD
`26bf36670` (tree clean; steps 001–035 done; no recovery needed — the
coordinator verified the fresh-step path).

## Finding

**0165-174** (S32-03): the core's internal layering is guarded by a
hand-mapped ~200-row table while the package boundary is fully open
(`"./*": "./src/*.ts"` exports every src file), **and** the table is
layer-blind at the services seam: git-ops (the run services' commit-side
member home) imports charter-clamp and resolve (policy) — the class machinery
cannot see it (measured at this step's HEAD: `git-ops → charter-clamp` is the
**only** kernel→pipeline value edge in the graph, so the class-wide
`["kernel", "pipeline"]` allowance in SUBDOMAIN_EDGES is seeded by exactly
this one member edge; `git-ops → resolve` is kernel→kernel, invisible to any
class pair). The finding's remedy: split the table's driver into services-seam
members vs pipeline **or** add one asserted edge (git-ops must not import
charter-clamp/resolve — the collection moves to the caller); and decide the
exports question consciously (entry modules vs status quo) in one ruling.

## Evidence re-verified against HEAD 26bf36670

- The imports stand: `src/git-ops.ts:50` (`clampRecordedResolves` from
  `./charter-clamp`), `:54` (`collectAgentResolves` from `./resolve`), both
  value imports inside `collectSessionMarks` — hoisted **before** afterSession's
  dryrun early return by design (0020 H4: "collection is auditing and must not
  depend on the commit switch"; the no-commit double's body keeps the
  collection "for the same reason").
- Exports map (`package.json`): exactly `"./*": "./src/*.ts"` +
  `"./templates/*": "./templates/*"`; consumers repo-wide: **only**
  packages/auto and packages/auto-server (src + test; no scripts, no root
  configs, no relative reach-arounds anywhere).
- Consumption census: shells' **src** import 45 distinct core subpaths
  (incl. 2 templates); shells' **tests** import 27 (12 of them test-only,
  `services` among them — 0194 D3's sanctioned holder-install pattern); union
  **56**.
- Mechanical probe (Bun 1.4.4, /tmp workspace): a narrowed exports map **has
  teeth** for bare specifiers (`@probe/core/b` not in the map → "Cannot find
  module"), but **relative imports bypass the map entirely**
  (`../core/src/b.ts` resolves) — the map cannot be the whole boundary.

## Plan (enactment order; each ingredient lands green)

1. Ruling **0196** written first (Derives/Amends, Category scope, premise
   guard) — both halves: D1 the exports question (§9-3), D2 the seam
   policy-reach ratchet, D3 the specifier-only rule + pins.
2. D2 — `test/import-direction.test.ts`: the member-granular
   SEAM_POLICY_REACH table (git-ops's two declared policy edges with whys;
   stale entries fail) + the guard check (a seam home reaches no
   pipeline/policies member outside its declared set; type edges count).
3. D1's pin — the exports map's shape asserted in the same suite (drift in
   either direction fails naming the ruling).
4. D3 — each shell's `no-ambient-services.test.ts` (0194 D3's homes) gains
   the specifier-only guard: no src **or test** file reaches the core by a
   relative path — the package specifier is the only sanctioned route (bite
   rows after the 0194 pattern; green at HEAD, measured).
5. Full verification (all three packages), fail-before proofs over /tmp
   backups (the pre-fix blindness demonstrated: a crafted policy import into
   git-ops passes the old suite, fails the new one); docs (ruling, INDEX row,
   shell-contract §B, AGENTS nav), ledger, program position, single commit.

## Verification

All measured on the committed state (proofs over `/tmp` backups, files restored and
`cmp`-verified byte-identical, suites re-run green). **No production module touched in any
package** — the step is boundary machinery and documentation; behavior byte-identical
everywhere by construction.

- **auto-core**: `bun typecheck` clean; full suite **3092 pass / 0 fail** (155 files) —
  the 3090/0 baseline plus the 2 new tests (the seam-policy-reach guard, the exports-shape
  pin; the suite's other 12 unchanged).
- **packages/auto**: `bun typecheck` clean; full suite **160 pass / 8 skip / 5 fail** —
  the 158/8/5 baseline plus the 2 new specifier-only tests. The 5 = the pre-existing
  fork/remove-fork trailer-scan family (fork ×2, remove-fork ×3), **identical names to
  step 035's verified baseline**; this step touched no auto src file (the boundary suite
  only), so they are not re-proven here but carried as the standing baseline.
- **auto-server**: `bun typecheck` clean; full suite **142 pass / 0 fail** (24 files) —
  the 139/1 baseline's known failure (the 0165-220 observe `sawDirty` race) **passed this
  run**: it is the documented race (the fixture can write-and-commit between two 150 ms
  polls — step 073's deterministic repair owns it), and a passing run of a flaky baseline
  test is within its measured behavior; plus the 2 new specifier-only tests. 0 fail — no
  new failure.
- **Fail-before proofs** (each on crafted or real drift, restored and cmp-verified):
  - **The blindness itself**: on the pre-fix suite (extracted from HEAD), a crafted
    `import { blockageLines } from "./blockage"` (pipeline) appended to `src/git-ops.ts`
    **passes 12/12** — that pass is the finding; with the new guard landed, the same
    source **fails** naming SEAM_POLICY_REACH and 0196 D2. (A first attempt used `./close`
    — declined as the proof's vehicle: it closes a type cycle the acyclicity check
    already catches, so it would demonstrate nothing about the policy reach.)
  - **The stale arm**: a false declaration (`git-ops → blockage` with no live import)
    fails the guard as stale, naming the entry's own why.
  - **The exports pin**: `package.json` narrowed to an entry-module shape
    (`./loop`, `./plan`) fails naming 0196 D1 and the ruled open shape; restored, green.
  - **The reach-around guard**: a real relative reach-around
    (`import … from "../../auto-core/src/git"`) appended to `../auto/src/index.ts` fails
    the shell's real-sources scan naming the file and specifier; restored, green.
  - D3's bite rows (both shells) prove the scanner's shapes statically; the real-sources
    guards are green at HEAD by design — measured (no escape exists), 0194 D3's
    standing-guard precedent.
- **In-change discovery** (fixed in the same change): the specifier-only scan's first
  draft flagged its own suite — the bite rows quote the violation shapes as data, and the
  scan reads test/ (its scope is the whole package). The fix is the one-file self-exclusion
  (`SELF = "test/no-ambient-services.test.ts"`), commented in both suites: a scanner that
  flags its own examples would force the examples out of the suite that proves them.

## Dispositions

- **0165-174** (the exports question + the ratchet's services-seam layer-blindness) —
  **fixed** under ruling **0196**, both halves:
  - **The exports question (§9-3)** — **ruled by-design OPEN** (0196 D1): `./*` stays
    beside `./templates/*`, a measured decision (45 subpaths consumed in the shells' src,
    56 across src + test; the one incident class the register holds is a src/test
    distinction on one subpath a map cannot express; the probe: a narrowed map refuses
    unlisted bare specifiers while relative imports resolve straight past it — the scan
    is the boundary's constant half whatever the map says; the branch model holds the
    write side). The ruled shape is pinned core-side (checkExportsShape) so any change
    amends the ruling; the revisit trigger is named with the entry-module allowlist's
    shape (a second reach-through incident class beyond the ambient-holder family).
  - **The layer-blindness** — **fixed** (0196 D2): SEAM_POLICY_REACH declares git-ops's
    two policy edges (charter-clamp, resolve) with 0020 H4's hoist discipline as their
    why — `git-ops → charter-clamp` measured the only kernel→pipeline value edge in the
    graph, so the class allowance was exactly as wide as the one invisible edge; the
    guard arm refuses any new pipeline/policies reach into a listed seam home (type edges
    count) and the stale arm retires dead declarations. The finding's other remedy branch
    (move the collection to the caller) **declined** on H4 and P20 grounds — recorded in
    the ruling.
  - **The specifier-only rule** (0196 D3): the package specifier is the only sanctioned
    route from a shell into the core (no relative escape into any sibling), held in each
    shell's boundary suite beside 0194 D3's ambient-holder scan — the map cannot see
    relative imports, so the route rule lives where it can be seen.

Residuals recorded (0196's own list): the guard's class filter cannot see a new
intra-kernel policy leaf (a resolve-shaped module reaching a seam home silently unless
declared) — closing it awaits a consumer (P21); D1's revisit trigger is the entry-module
debt, a named shape, not a mechanism built ahead of its consumer. The step's scope held:
no unrelated cleanup, no production code.
