# 0269 — The executor restriction catalog enacted

Status: **enactment of [0261](0261-executor-restriction-catalog.md)'s ruled
design, 2026-11-20** — the [0267](0267-protocol-completion-program.md) docket's
catalog slice: D2's `types` block on `ready`'s menu, D4's catalog sentence (the
catalog half alone — the daemon postures are 0275's), and D5's 0203 both-sides
ratchet, landed with the absent-block floor and the AGENTS.md catalog pointer
0261's companion letter names. Everything 0261 ruled is enacted as designed;
the one pin 0261 left to the enactment — the exact field grammar against
0246 D4's letter — is ruled below.

Derives P2 (the duty information provision, whole and entire: the catalog
states each work type's restrictions on the wire and stops there — the
`executor.md` sentence teaches exactly that boundary, provisioning against the
block the operator's bracket, never the tool's machinery), P5 (one source, two
renderings: the catalog is computed from exactly the tables the landing fence
reads — `standingRefusal`'s members, `driverExclusive`'s documents,
`taskDocPaths` over the placeholder unit, `roleOf`'s own `freeform` word, the
`questionAuthority`/`releaseAuthority` admitted sets — the fence the
settlement rendering, the catalog the dispatch rendering, never a second
hand-maintained list; the wire carries it with no second author either, the
worker passing `menu` through unchanged), P7 (mechanical grammars alone:
regex-source path grammar, `taskDocPaths` placeholder paths, delegation
vocabulary words — no content judgment anywhere in the block), P10 (the floor:
absent from a server or ignored by a client, the menu is byte-identical to
yesterday's — the stripped payload equals the pre-change two-key shape,
pinned by test on both sides of the wire), P12 (no enforcement claim is made,
so nothing degrades dishonestly — violations surface at the standing boundary
checks, which fail loud; the catalog carries no marking field and states no
severity), P13 (additive under the frozen `protocol: 1`: the id set —
`execute`/`verify`/`fix` (the wire's grant kinds, `satisfies`-proven against
`Grant["kind"]` at compile time) plus `human`/`question` (the person channel's
step kinds) — frozen additive and never an id the coordinator cannot grant),
P15 (the catalog is data on the wire; the teaching that accompanies it is
prompt copy in `prompts/executor.md`, assembled nowhere by code), P19 (the
consumer named from the field per 0261 — the adoption site's
configure-before-launch preparation flow, the block its input; nothing here
speculates past that consumer), and P21 (0261's declined slate stays declined
— the dedicated fetch route, per-host renders, enforcement-class marking, the
tightening key; and this enactment's own decline of a sibling envelope field,
below). Amends none — 0246 D4 b's menu letter and D4 i's write contract are
extended additively exactly as 0261 read them; no standing letter's premise
moves.

## Category scope

Tier: mechanism — code home and test home in this change (0110 D13): the
rendering and its tables in `src/executor-coordinator.ts`, the derivation and
floor tests in `test/executor-catalog.test.ts`, the ratchet's coupling arm in
`test/manual-prompts-ratchet.test.ts`, the wire assertions in
`packages/auto-server/test/executor-e2e.test.ts`, the sentence in
`prompts/executor.md`.

Premises this ruling changes: none. Re-read in this change: **0246 D4**
(b — the carrier letter: `ready` is "the hub-as-scheduler's menu," pure,
already carrying kinds and touches; i — the write contract the catalog
renders), **0248 D5 / 0259** (the fence letter — stands, read forward as the
derivation source exactly as 0261 ruled), **0252** (the prompt pair and
ratchet — the catalog sentence joins the pinned set), **0261** (enacted as
designed; the id-growth letter carried to Residuals), **0203** (the
both-sides pattern this enactment's ratchet follows), **0267** (the docket's
0269 row — this slice is that row, nothing more).

## The ruling

### The carrier pin: `menu.types`

0261 D2 rules "an additive `types` block on `ready`'s menu, under the frozen
`protocol: 1`," re-reading 0246 D4 b — `ready` is "the hub-as-scheduler's
menu," pure, already carrying kinds and touches, and "the catalog's `types`
block extends that menu." Pinned: **`menu.types`** — the block is a field of
the menu object, the menu remaining the single dispatch-time payload and the
response envelope unchanged (`{ protocol: 1, menu }`, the outer keys still
exactly `menu` and `protocol`, pinned by the e2e). A sibling top-level field
beside `menu` was considered and declined: it would fork the dispatch-time
payload into two surfaces with no consumer needing a standalone fetch (P21,
0261's own dedicated-route decline at the field scale) and contradict the
"extends that menu" letter both rulings carry. The block rides both of
`menu()`'s arms identically — the leases-held early return carries it beside
the claimable form, so a hub holding leases reads the same catalog. The
worker's rendering (`packages/auto-server/src/executor-worker.ts`, `payload =
{ menu: await coordinator.ready(holder) }`) passes the block through
untouched — one author, the coordinator (P5/P15); no server-side change was
needed, only the e2e assertions grew.

### The entry grammar and each entry's derivation source

The block is an object keyed by type id, canonical order `execute`, `verify`,
`fix`, `human`, `question` — one entry per id:

- **Work entries** (`execute`/`verify`/`fix`, shape `{ id, never: { git,
  paths }, writes: { scope, paths, undeclared? } }`). The `never.paths` list
  is rendered as regex sources from `standingRefusal`'s own members: the
  workdir roots (`WORKDIR_ROOTS`, the imported constant `workdirEntry` reads,
  rendered `^(?:tmp|\.auto)(?:/|$)`), the config directory arm
  (`^\.opencode(?:/|$)`), the AGENTS.md segment arm
  (`(?:^|/)AGENTS\.md(?:/|$)` — segment semantics exactly matching the
  fence's `split("/").includes`), and `driverExclusive`'s documents — the
  `UNIT_STATE_DOC`/`INDEX_DOC`/`SUBTASKS_DOC` sources verbatim plus
  `CONFIG_DOC` (`^opencode\.json$`), extracted in this change from
  `driverExclusive`'s inline literal into a named constant so both renderings
  read one home. The never-list dominates every scope arm (the fence's own
  ordering — a declared scope containing the index still refuses), which the
  derivation test proves by self-declaring scopes. The `writes` letters:
  `verify` carries `{ scope: "none", paths: [report, gaps] }` — the paths
  rendered by calling `taskDocPaths("T-NNN")` itself, the placeholder unit
  through the same function the fence calls; `execute`/`fix` carry
  `{ scope: "unit-effective", undeclared: "freeform", paths: [handoff] }` —
  the per-unit effective scope staying where it rides (the menu's `touches`,
  the grant's `workspace`, 0261's type-level-only letter), the undeclared
  floor `roleOf`'s own `freeform` word, the artifact path the fence's handoff
  early-return. `execute` and `fix` share the letter today — `permitted`'s
  non-verify arms are common to both kinds — distinct ids, coinciding
  letters, recorded here so a future divergence is a conscious change.
- **The git letter** (`never.git: "coordinator-only"`, all three work
  entries). No path table carries this prohibition: git metadata never rides
  a status row, the fence's only input, so path grammar for it would be
  unreachable and a lie. Its home is the standing write contract's authority
  posture (0246 D4 i — the coordinator alone stages and commits, P4; the
  settlement's every staging and commit act; `executor.md`'s standing
  "Never run Git staging or commit operations"), rendered as the frozen
  literal `"coordinator-only"` — cited as data, the one catalog letter whose
  derivation source is a ruling and a practice rather than a predicate, per
  0261's own allowance.
- **Person entries** (`human`/`question`, shape `{ id, authority }`):
  `question: ["unrestricted", "questions"]` and
  `human: ["unrestricted", "releases"]` — exactly the admitted sets of
  `questionAuthority` and `releaseAuthority` (0250's delegation vocabulary,
  `unrestricted` the human's own channel), the machine-readable form of
  "answer within delegation, gate release." The derivation test proves each
  word behaviorally: a `questions`-delegated person claims the question and
  is refused the gate, a `releases`-delegated person the mirror, answering
  past the envelope refused.

The `never` path grammar states the fence's input grammar —
checkout-relative, forward-slash status rows; that is the form both
renderings consume.

### The rendering's home, and the behavior-preserving extraction

`executorTypeCatalog()` lives in `src/executor-coordinator.ts` beside
`menu()`, exported for the wire (the coordinator the one home), computing one
object from the tables at module init — every menu carries the same value.
To make the tables the single source, `permitted`'s first line and the
`driverExclusive` call were grouped into a named `standingRefusal()` and the
inline `opencode.json` comparison into `CONFIG_DOC` — a pure move, the
fence's behavior byte-identical, the standing suites (executor-steps,
executor-worktree, blockage-executor, the e2e) the proof; `permitted` and
`driverExclusive` are exported beside it so the derivation test reads the
fence side from the same home rather than a test-private re-statement.

### The ratchet (0261 D5, the 0203 both-sides form)

Three renderings pinned in one change: the wire block, the fence's tables,
and the `executor.md` sentence. `test/executor-catalog.test.ts` proves the
derivation behaviorally over a 32-path corpus, both directions — the never
grammar equals the standing refusal (isolated by self-declaring scopes, so
the never-list's dominance is exercised, not assumed), the verify letter
equals the verify arm and `taskDocPaths`' own output, the execute/fix letters
equal the scope, handoff and freeform arms (declared, `touches`-declared and
undeclared), the person authority words equal the authority checks, and the
id set is exactly the grantable five. `test/manual-prompts-ratchet.test.ts`
gains the coupling arm: the manual sentence pinned verbatim beside the
producer's derivation anchors (the `satisfies`-proven id list, the
`.source`-rendered never-list constants, `taskDocPaths(CATALOG_UNIT)`, the
frozen git literal, the menu's carriage) — a change to the fence's grammar
cannot land without the catalog and the prompt line moving, which is what
the two files together make true. The e2e pins the third rendering's wire
shape (the menu keys, the id set, the stripped-menu floor).

### The floor (P10) and the measured size

Absent or ignored = today's behavior, byte-identical, pinned on both sides:
in auto-core, the menu with the block stripped deep-equals the pre-change
two-key shape (claimable content intact, both menu arms); in the e2e, the
stripped wire menu leaves exactly `claimable` and `leases`, and the outer
envelope keys stay `["menu", "protocol"]`. The two whole-menu assertions in
`test/executor-steps.test.ts` and the e2e's deep-equal now carry
`types: executorTypeCatalog()` — the additive shape pinned, never assumed.

**Measured**: the types block serializes to **1475 bytes**. No byte bound
applies to the ready/menu payload today — the 256 KiB figure (0246 D4 a's
provisional envelope, `MAX_RESPONSE_BYTES`) governs the gate offer and the
rendered briefs (the two computations in `executor-coordinator.ts`), and the
menu rode unbounded before this change; the block is ~0.6% of that
provisional figure. The floor test pins a 4096-byte ceiling so the block's
growth stays a conscious, ratchet-visible act.

### Declined here

A sibling envelope field beside `menu` (above); rendering the git prohibition
as path grammar (unreachable grammar — git metadata never rides a status
row); an enforcement-class or severity field on entries (P12 — no enforcement
claim, nothing to grade); a per-unit scope field on entries (0261's
type-level-only letter — the scope already rides `touches`/`workspace`, a
second carriage would be a mirror); and 0261 D4's daemon postures (0275's
slice, deliberately not landed — the prompt sentence here is the catalog half
alone).

## Residuals

- **The id set's growth** (0261's letter carried forward): each new id is its
  own enactment change with its fence-tables entry and ratchet pin — the
  stage-2 convergence kinds (0276–0278: formulation steps, the transfer
  advance's session work, the close-audit) will exercise it, and at the
  current letter size each id adds roughly 150–300 bytes against the test's
  ceiling.
- The block's byte ceiling is a ratchet figure, not a ruled bound; if the id
  set's growth presses it, the envelope question (menu-bound or not) reopens
  with real numbers — 0267's freeze-settled table already holds the 256 KiB
  measurement for the brief side.

## Companion changes and verification

The INDEX row; the AGENTS.md executor-leases navigation line's catalog
pointer (0261's companion letter — at enactment, this change); the
auto-server README truth pass (the menu's `types` block sentence in the
executor preview section — the wire payload is documented there). Test
evidence: `test/executor-catalog.test.ts` (6 tests — the id set, the never
equivalence, the verify letter, the execute/fix letters, the person
authority behavior, the absent-block floor with the byte ceiling), the
ratchet's coupling arm (the file at 36 tests), the e2e's three assertion
sites updated, the manifest row in `test/lanes.ts`; the standing suites green
— auto-core full suite 3472 across 171 files, typecheck exit 0; auto-server
203 pass beside the container's pre-existing IPv6-bind failure, failing on
the committed tree identically (0265's record), typecheck exit 0.
