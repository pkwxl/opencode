# 0196 — the open package boundary ruled; the services seam's policy reach declared

Status: active-authority (0166 remediation step 036, wave W3-shell-seam; finding 0165-174 =
S32-03, CONFIRMED — re-verified against HEAD `26bf36670` at ruling time: the imports at
`src/git-ops.ts:50/:54` (`clampRecordedResolves` from `./charter-clamp`, `collectAgentResolves`
from `./resolve`, both value imports inside `collectSessionMarks`), the exports map exactly
`{ "./templates/*": "./templates/*", "./*": "./src/*.ts" }`, and the class-blindness measured
afresh: **`git-ops → charter-clamp` is the only kernel→pipeline value edge in the entire
graph** — the class-wide `["kernel","pipeline"]` allowance in SUBDOMAIN_EDGES is seeded by
exactly this one member edge, so no new kernel→pipeline reach could ever fail it while this
edge lives; `git-ops → resolve` is kernel→kernel, invisible to every class pair. 0165 §9-3
named the exports question a matter for the maintainer's ruling; 0194 D3's residual named
this step for it.)

One finding, one family: **the boundary's visibility.** The core polices its internals with a
hand-mapped layer ratchet while its package boundary exports everything (`./*`), and the one
place the ratchet is blind is the seam a shell can swap — the run services' commit-side home
carrying policy reaches no suite can see. Two halves, one ruling each: the exports question
answered consciously (§9-3's demand — either way, with reasons and a revisit trigger), and the
seam's policy reach made a declared, ratchet-held fact.

Derives: **P14** — one-way dependencies through declared seams: the exports map IS the
declared seam (docs/shell-contract.md §B: "shells import `@opencode-ai/auto-core/*`"); D1
rules what that declaration means (every src module is consumable — the seam's granularity is
the module, held open as a measured decision, not an accident), and D2/D3 hold the seam where
the map cannot (member-granular policy reach inside the core; the specifier as the only route
from a shell — the map cannot see relative imports, so the rule lives where it can be seen).
**P19** — measured evidence: the census (shells' src consume 45 distinct subpaths; their
tests 27 more, 12 test-only; union 56 — the core is consumed broadly, not through a small
entry set), the mechanical probe (Bun 1.4.4, /tmp workspace: a narrowed map refuses an
unlisted bare specifier — teeth — while a relative import resolves straight past it — the map
alone is no boundary), and the incident census (exactly one open-boundary incident class in
the register, S06-04 → 0165-089, already fixed and guarded by 0194 D3) decide both halves.
**P21** — machinery waits for its consumer: the entry-module allowlist would be a ~56-row
hand-maintained table whose only enforcement gain over the landed per-shell scans is the one
distinction a map cannot express (shell src forbidden, shell tests sanctioned, on the same
subpath `services`); the consumer for that machinery does not exist, and it is recorded here
as the revisit trigger's debt, not accrued silently. **P5** — single ownership: the boundary
gains no second source of truth — the map's shape is pinned once (D1's test), the
specifier-only rule lives in each shell's own scan (the only side that can see it), and the
seam's declared edges live in the one layering ratchet (D2), each entry carrying its why.
**P10** — the byte-identical floor: no production module changes in any package; every
existing import resolves as before; the ruling adds boundary machinery only. Amends: none —
no principle restated. Tier: tests (auto-core `test/import-direction.test.ts`; the shells'
`test/no-ambient-services.test.ts`), documentation — no runtime code.

premises this ruling changes: none — **0194 D3's residual clause** ("the exports boundary
itself … is a separate ruling (0165-174); this scan holds this shell's src regardless") is
*resolved* here, not invalidated: the map stays open, and 0194's scans were built to hold
"whatever the map later says", so their premise stands unchanged (re-read below); **0061
R10's class ratchet** is extended beside, not amended — SUBDOMAIN_EDGES, its shrink-only
discipline and every existing row are untouched, and D2's member table exists precisely
because the class pair was measured too coarse at this seam (one member edge seeding a
class-wide allowance); **0020 H4's hoist discipline** is restated as the declared edges' own
why (the marker collection stays inside the seam by design — re-read below).

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P14** — "the core does not know shells … shells inject differences through profiles,
  registrations and parameters; inside the core, layers point downward through entry modules
  held by ratchets." The injection direction (shell → core differences) is held by the
  profile/registration seams and the core's no-shell-imports hygiene check; the consumption
  direction (shell ← core mechanisms) rides the exports map. Nothing in the principle's
  letter demands a finite entry list at the package boundary — it demands *declared* seams
  and *held* layering. D1 rules the declaration's breadth; D2 supplies the holding the
  finding measured missing; D3 closes the one route no map can govern.
- **P5** — "the ratchet tables are themselves maintained state", and the revisit trigger is
  "a seam or ratchet whose maintenance and indirection measurably cost more than the drift
  they prevent". A 56-row entry list would churn on every core module move or split (this
  corpus's own history: 0061's consolidation, 0102's git split, 0069's formatter move) and
  would make a *new shell branch's* pure shell work — importing existing core modules — a
  core-branch exports edit, against the branch model's grain ("shell branches must not
  modify this package"). The measured drift an entry list would prevent (one incident class)
  is already prevented, more precisely, by 0194 D3's scans.
- **P19** — every claim above is measured in this document (census, probe, class-edge count,
  incident census); the probe artifacts and counts are recorded so a future re-audit can
  re-derive them.
- **P21** — the entry-module machinery is declined *now*, with its trigger named (D1): a
  reserved surface is a name, never a half-built mechanism.
- **P13** — frozen vocabularies: the exports map's keys are not protocol vocabulary, but the
  ruled shape is pinned (D1's test) so any change is a conscious lockstep with this ruling's
  amendment, never a silent drift; nothing else in any frozen vocabulary changes.

## D1 — the exports question: the open `./*` boundary stands, by-design

`"./*": "./src/*.ts"` (beside `"./templates/*"`) stays. The measured reasons:

1. **Breadth is the consumption reality.** 45 distinct subpaths in the shells' production
   sources, 56 across src + test — the core is a library its shells consume broadly (the
   contract's decision rule splits *mechanism vs CLI shape*, not an entry set); an
   entry-module list would be a 56-row second mirror of the imports themselves (P6: the
   imports are the evidence; the list would be newly persisted state to keep in sync —
   P5's known tension made concrete).
2. **The map cannot express the one boundary that bit.** The single open-boundary incident
   class in the register (S06-04: a shell's *production* src importing the ambient holder
   `auto-core/services`) is a src/test distinction on one subpath — the shells' *tests*
   legitimately import the same subpath to install holders (both shells' suites, 0194 D3's
   sanctioned pattern). Narrowing `services` out breaks the sanctioned tests; keeping it in
   leaves the incident class to the scans either way. The map is the wrong mechanism for
   exactly the hazard that exists.
3. **The map is no boundary alone.** The probe: relative imports resolve past it. Whatever
   the map says, the reach-around class needs a scan — D3's, landed here — so the scan is
   the boundary's constant half and the map's breadth its variable half.
4. **The branch model already holds the write side** (core changes land only on auto-core;
   shell branches never modify this package), and the one live hazard of the read side is
   held by the scans (0194 D3) with D3 here extending the same homes.

**What holds the ruled boundary:** the map's shape pinned core-side (D1's test in the
import-direction suite — any narrowing, widening or re-shaping fails naming this ruling);
the specifier-only rule held shell-side (D3); the ambient-holder scans (0194 D3) standing
unchanged; the core's own layering ratchets (this suite) unchanged.

**Revisit trigger:** a second open-boundary incident class in the register beyond the
ambient-holder family — a shell reaching past a declared seam the scans do not name. Then
the entry-module allowlist becomes due: an explicit subpath list replacing `./*` (templates
excepted), grown by conscious reviewed edits, `services` resolved by then (either the
holder-install pattern gains a core-side test seam, or the subpath narrows to it), with D3's
specifier-only scans as its complement — they hold under either map. Until then the open
map is the ruled design, not a deferred fix.

## D2 — the services seam's policy reach: declared and ratchet-held

The finding's blindness, restated as measured fact: the commit-side seam's home (`git-ops`,
the production `GitOps` member `services.ts` builds and the module `noCommitGit` lives in)
imports `charter-clamp` (pipeline — the blockage/charter policy) and `resolve` (kernel — the
proxy-answer ledger); the first is the only kernel→pipeline value edge in the graph, so the
class ratchet's allowance is exactly as wide as this one edge and can never see a second
one; the second is intra-kernel, invisible to every class pair.

**The mechanism**: `SEAM_POLICY_REACH` in `test/import-direction.test.ts` — the member-level
companion of SUBDOMAIN_EDGES for the run-services seam's homes. Each entry is a live edge
with its why (a listed edge the graph no longer produces is stale and must be removed — the
shrink-only reflex); the guard arm: a seam home listed as a source may not import any
pipeline/policies member outside its declared set — a new policy reach into the seam fails
naming the table and this ruling. Type-only edges count (the suite's standing convention for
direction rules). The two declared edges' why is 0020 H4's own discipline: the marker
collection is hoisted *before* the commit gate by design ("collection is auditing and must
not depend on the commit switch"), the no-commit double keeps it for the same reason, so the
seam's policy reads are declared facts, not silent drift.

**The finding's other remedy branch declined**: moving the collection to the caller ("git-ops
must not import charter-clamp/resolve — the collection moves to the caller") — declined
because the hoist *is* the design (H4: every afterSession path, the no-commit double
included, collects; N callers would each have to re-earn that discipline, and one forgotten
call site is exactly the commit-switch dependence H4 forbids), and because it is a
behavior-affecting refactor across every seam caller bought for a visibility defect the
declaration now provides (P20's instinct: land control changes at safe boundaries, and here
no behavior change is warranted at all).

**Residual, named:** the guard arm's class filter (pipeline/policies) cannot see a *new*
intra-kernel policy leaf — a resolve-shaped module would join the graph silently unless
declared. Closing that would mean classifying every kernel leaf's policy content: machinery
without a consumer (P21). The declared set makes the two live edges visible and stale-tracked;
a new services member home enters the table consciously with its why.

## D3 — the specifier-only rule: a shell reaches the core through the package specifier alone

From a shell package, the only sanctioned route into the core is `@opencode-ai/auto-core/*`
— no relative path may escape the package into any sibling (the core, another shell, anything
at the repo root). The probe's reason: relative imports bypass the exports map, so whatever
D1 says, the reach-around would be an unruled door; holding it costs one scan per shell.
Measured: no escape exists in either shell (src or test) at HEAD — the guard is a standing
one, 0194 D3's precedent shape (real-sources guard + crafted bite rows), landing in the same
suites (`test/no-ambient-services.test.ts` in both shells — the shells' side of the core
boundary, one home), so the boundary's shell-side holdings read as one file: the ambient
holder (0194) and the route itself (this ruling). Bare specifiers of other packages stay a
matter for each package's own dependency declarations, not this scan.

## Category scope (0123 D1's discipline)

- **Code homes**: none — no runtime module changes in any package; behavior byte-identical
  everywhere (the ruling is boundary machinery and its documentation).
- **Test homes**: `test/import-direction.test.ts` (D2's table, guard and stale checks; D1's
  exports-shape pin; the header's two new numbered purposes); `packages/auto/test/no-ambient-services.test.ts`
  and `packages/auto-server/test/no-ambient-services.test.ts` (D3's specifier-only guard:
  real-sources scan over src + test, crafted bite rows, header extended).
- **Documentation**: this document; the INDEX row; docs/shell-contract.md §B (the ruled
  boundary's sentence); AGENTS.md build conventions (the pointer); the program's ledger row
  (0165-174) and step record.

### Re-reads

- **0194 D3** — its scans hold "whatever the map later says"; the map now says what it said
  (open), so both shells' scans stand exactly as landed, and their headers' closing note
  ("a separate ruling (0165-174)") resolves to this document: the scans' discipline is now
  D3's foundation, extended in their own homes.
- **0061 R10** — the sub-domain column and SUBDOMAIN_EDGES stand untouched; D2 adds member
  granularity beside them for the seam the finding measured, the same direction of
  refinement R10 itself set (allowlists that only shrink, stale entries removed).
- **0020 H4** — the hoist discipline is unchanged and now carried as the declared edges'
  why; the collection stays inside afterSession and its double.
- **docs/shell-contract.md §B** — the one-way-dependency bullet gains the ruling's sentence
  (the open map ruled; the specifier the only route; the scans the shells' side).

## Floors and proofs

- Byte-identical (no production module touched; the full suites run unchanged): auto-core
  3090/0, packages/auto and auto-server at their established baselines (step record).
- Fail-before, the blindness itself demonstrated: on pre-fix source, a crafted policy import
  into `git-ops` (`import { closeUnit } from "./close"`, pipeline) **passes** the suite —
  that pass is the finding; with D2 landed the same source **fails** naming the table. The
  stale arm: a declared edge whose import is removed fails. D1's pin: a /tmp-modified map
  (an entry-module shape) fails naming the ruling; restored, cmp-verified, green. D3's
  guards: green at HEAD by design (measured; 0194's standing-guard precedent), the bite
  rows proving the scanner flags every import shape and spares prose and in-package paths.

## Residuals

- D2's intra-kernel policy-leaf blindness (named in D2): a new resolve-shaped kernel module
  reaches a seam home silently unless declared; closing it awaits a consumer (P21).
- D1's revisit trigger (the entry-module allowlist) — a named debt with its shape, not a
  mechanism built ahead of its consumer.

## Tests

Named in Category scope; the exact reds and greens are enumerated in the step record
(`plans/0166-remediation/036-w3-exports-ruling.md`).
