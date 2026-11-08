# 0234 — the chain-writes ratchet's detection truth: the type-aware census (the ten escape shapes)

Status: active-authority (0166 remediation step 074, wave W-tests; finding
0165-195 = S13-03, S4 CONFIRMED TEST — "The chain-write ratchet is regex-based
and misses ten write shapes (`||=`, aliasing, `Object.assign`, bracket access,
an optional `chain?: SessionChain` binding, `chain!.x`, a newline before the
dot, inferred locals, array elements, type aliases); a type-aware census finds
no real escape today — the gap is latent").

One family — **the detection truth of P5's one-home ratchets over source that
carries dataflow**. `SessionChain` is mutable state with one home
(`src/chain-transitions.ts`, 0061 §4.8); `test/chain-writes.test.ts` holds
every other src file to zero direct field writes. The ratchet's own header
names its hazard class — "a silent false negative is the real hazard" — and
the finding measured ten write shapes that pass silently. 0165 is the
evidence, not the authorization: every number below was re-measured at this
step's HEAD before the remedy was chosen.

## The measured ground (this step's own, at HEAD `e292fbb7e`)

- **The ten escapes, re-confirmed at this HEAD**: the lead probe R4's cases
  (`leads/R4-chain-ratchet.test.ts.txt`, the ratchet's patterns copied
  verbatim) run again — `logicalOr:0, alias:0, objectAssign:0, bracket:0,
  optionalParam:0, nonNull:0, newlineDot:0, inferred:0, arrayElem:0,
  typeAlias:0, control:1`. Ten silent false negatives, one caught control.
- **Why two of the ten are unreachable at any regex strength**: aliasing
  (`const c = chain; c.model = 'x'`) and inferred locals
  (`const chain = makeChain(); chain.model = 'x'`) are **dataflow facts** —
  the binding carries no `: SessionChain` annotation, so the name-based
  scanner's foundation (annotated bindings) does not see the name at all.
  The other eight are each patchable in regex (add `\|\|=`; allow `?` before
  the colon; allow `!` before the dot; allow whitespace before the dot; match
  string-bracket field access; collect `type X = SessionChain` aliases; allow
  bracket indexing between binding and dot; match `Object.assign(chain…)`),
  but the patches stack a third of a type checker in regex while still
  missing the two dataflow shapes. The honest mechanism for "a write through
  a SessionChain-typed binding, any shape" is the compiler's own checker.
- **The type-aware census, measured over src/** (typescript package, a
  program over src/'s 163 root files, build **1.7 s**): **0 writes outside
  `chain-transitions.ts`** — the reviewer's census confirmed, the gap latent,
  **no code moves ruled**; the control inside the transitions measures **65
  writes** (the reviewer's 60 has drifted with the transitions' own
  evolution; both numbers cited). The ten synthetic shapes in an in-memory
  probe module: **exactly ten hits, one per shape, zero over the negatives**
  (reads, `??` reads, object-literal construction).
- **No `Partial<SessionChain>` / `Readonly<SessionChain>` annotation exists
  anywhere in src/** (grep 0) — the identity-based type matching's known
  edge is empty today.
- **No method-call mutation of a chain-held object field exists in src/**
  (`chain.failed.…(…)`, `chain.baseline.…(…)`: grep 0) — the operator class
  the census still does not claim has no measured instance.
- **The dependency's state**: `typescript` 5.8.2 resolves from
  `packages/auto-core` (hoisted from the workspace root's own declared
  runtime `dependencies`); auto-core itself does not declare it. The
  workspace install is frozen-lockfile-clean and reconciles offline.

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P5** (single ownership, mechanism scope): "chain-transitions.ts as the
  one home of every SessionChain field write", held by
  "`test/chain-writes.test.ts` (the write ratchet reaching zero)". Showing:
  a one-writer rule held by a detector that cannot see two of the ten
  natural write shapes is a rule held against straw — the ratchet's
  detection truth is upgraded to match the rule it exists to hold. The
  upgrade stays inside P5's own ratchet family line; no second scanner
  coexists (the regex scan, its prose-stripper and its binding finder are
  deleted in the same change — one home for the mechanism, before and
  after).
- **P19** (measured evidence): the ruling enters on the finding's census
  re-measured at this HEAD (ten escapes; 0 outside; 65 inside; 1.7 s build;
  the empty method-mutation and Partial edges), and the remedy is chosen on
  the measurement — the two dataflow shapes are proven regex-unreachable,
  which is what forces the checker, not the finding's preference.
- **P21** (machinery waits for its consumer): the consumer is real — the ten
  shapes are natural future driver code (`chain.hinted ||= true` is
  idiomatic; every conversion stage wrote flat assignments that were one
  typo from an alias), and the ratchet's own header names the silent false
  negative as the hazard. The checker-based census is the **minimum
  complete** mechanism for the ruled claim, not generality ahead of need;
  conversely the census's extension to method-call mutation is **declined**
  — no measured instance exists (the consumer does not), recorded below as
  the standing edge.
- **P13** (frozen additive-only vocabularies): the detection vocabulary
  grows **additively in one conscious change with its pin**: every shape the
  old alternation flagged (`=`, `+=`, `-=`, `*=`, `/=`, `%=`, `??=`, `|=`,
  `&&=`, `++`, `--`, `delete`, through annotated bindings) still flags under
  the census (`isAssignmentOperator` covers `=` and every compound; the
  annotated bindings are a subset of the spine-typed bindings) — the pin
  test is replaced in lockstep with the mechanism, and no dual scanner
  survives to carry an old meaning.
- **P10** (the byte-identical floor): zero runtime behavior — a test file,
  its devDependency declaration, and documentation; src/ is untouched (the
  census measured 0 writes outside the transitions, so nothing moves), and
  the ratchet's verdict over today's src is unchanged (zero findings before,
  zero after).

Derives: P5, P19, P21, P13, P10 (the five showings above). Amends: none.
Tier: **tests** (test infrastructure + its dependency declaration; no
runtime src, no template, no protocol surface).

premises this ruling changes: **none** — 0061 §4.8 re-read standing: its
ratchet sentence's claim ("scans src/ for assignments to a SessionChain field
outside src/chain-transitions.ts …; object-literal construction of a new
chain is not a write") is restated verbatim by the census — only the
mechanism description ("a lexical scanner … through `: SessionChain`-annotated
bindings") is superseded, and that description lived in the retired scanner's
own header, rewritten here; its per-file budget table was already retired at
B5's flat zero before this ruling. The pattern-borrowers — 0072's
constitution ratchet, 0082's executor ratchet, the import-direction family —
borrow the one-home **shape**, never the lexical scanner; their subjects are
statement- or prose-shaped (no dataflow class to miss), so no premise of
theirs moves.

## Decisions

**D1 — the census becomes type-aware; the regex scan is deleted, not
widened.** `test/chain-writes.test.ts`'s scan half is rebuilt on the
typescript checker: a program over every `.ts` under src/ (skipLibCheck,
Bundler resolution — unresolved external imports degrade quietly and never
affect the census: src's chain bindings are all file-local through
`src/chain.ts`'s own graph); the SessionChain type resolved through the
checker from `src/chain.ts`'s own alias declaration (the anti-drift anchor
the old hand parser had — the type itself, never a parsed copy; not found →
the suite throws); a **write** = an assignment (`=` and every compound
assignment, `||=`, `&&=`, `??=` included), `++`/`--`, `delete`, a member
target inside a destructuring assignment or a for-in/for-of initializer, or
an `Object.assign(<target>, …)` — whose target expression's member-access
spine (property/element access, non-null assertion, as-cast, satisfies,
parenthesization — any depth, nested writes into chain-held object fields
included) touches the SessionChain type at any node. That one predicate
holds all ten shapes: the two dataflow shapes (aliasing, inferred locals)
resolve through the spine's types, and the eight syntactic shapes
(`||=`, Object.assign, bracket access, optional `?:` binding, `chain!.x`,
newline before the dot, array elements, type aliases) are arithmetic along
the way. The flat rule is unchanged: zero writes outside
`src/chain-transitions.ts`, ever. The synthetic pin becomes the finding's
own ten shapes: an in-memory probe module (compiler-host-served, never a
file on disk) asserting exactly ten hits — one per shape — and zero over
the negatives (reads, `??` reads, object-literal construction); the lead
probe R4's cases, asserted inverted. The anti-vacuity guards: the alias
must resolve (else thrown) and the control count inside the transitions
floors at ≥ 20 (measured 65 at adoption — a census that silently scans
nothing fails the floor, not the suite).

**D2 — the dependency gets one home.** auto-core's `package.json` declares
`typescript` (`catalog:` → 5.8.2) as a devDependency: the census's import
must not ride hoisting from the root's declaration — the package that
imports it owns the edge (P5's mechanism scope applied to the dependency
itself). The lockfile reconciles offline (the version already in the graph;
frozen-lockfile-clean before the edit). Typecheck stays tsgo
(@typescript/native-preview); the census rides typescript's checker — two
compilers, one purpose each, no lockstep owed: the census's truth is the
AST and checker of whatever version resolves, held honest by the control
count, not by compiler agreement with tsgo.

**D3 — the honest boundary, recorded not enacted.** Outside the census's
claim, three edges, each empty by measurement and each a conscious
two-act escape (write the shape AND the annotation/call): (a) method-call
mutation of a chain-held object field (`chain.baseline.revs.push(…)`) —
outside 0061 §4.8's claim ("assignments … and deletes") and outside the
finding's ten; no instance in src/ (grep 0); a measured instance reopens.
(b) wrapper annotations (`Partial<SessionChain>` and mapped variants) —
identity-based type matching does not flag them; none exist in src/ (grep
0). (c) writes whose spine types come from an unresolved import — none:
src's chain bindings are file-local. The header teaches all three.

**D4 — the family line, drawn on the subject's shape.** The finding's own
family note ("test/import-direction.test.ts and the other source-scanning
ratchets (regex-based, same class)") is answered with a boundary, not a
program: a ratchet whose subject **carries dataflow** (a mutable type
flowing through bindings — this ratchet) needs the checker; a ratchet whose
subject is **statement-shaped** (import specifiers — import-direction) or
**prose-shaped** (the manual-prompts ratchet) has no aliasing class to
miss — no name ever stands in for another. No measured escape exists in
either sibling (both green at this HEAD); converting them would be
machinery without a consumer (P21). The line is recorded here and in the
census's header, so the next same-class finding starts from the boundary,
not from a corpus search.

## Category scope (0123 D1 — the family: P5's source-scanning one-home ratchets, measured at ruling time)

| home | this ruling |
| --- | --- |
| `test/chain-writes.test.ts` | **changed** — the census, the inverted ten-shape pin, the control floor (D1) |
| `package.json` (auto-core) + the workspace `bun.lock` | **changed** — the devDependency declaration and its lockfile entry (D2) |
| `src/chain-transitions.ts` | untouched — the sanctioned writer, the census's control (65 writes measured) |
| `src/chain.ts` | untouched — the type anchor; the old hand field-parser retired with the scanner, the checker resolves the alias itself |
| `test/import-direction.test.ts` | untouched, deliberately — statement-shaped subject, no dataflow class (D4) |
| `test/manual-prompts-ratchet.test.ts` | untouched, deliberately — prose-shaped subject (D4) |
| `test/turn-sources.test.ts`, `packages/auto/test/docs-truth.test.ts` | untouched, deliberately — frozen-registry censuses (P13 subjects, no dataflow) |
| `AGENTS.md` | **changed** — the navigation line's plans pointer (0061; 0234) |
| `docs/structure.md` | **changed** — the chain-transitions row's pointer |
| `plans/INDEX.md` | **changed** — the 0234 row |

No deferral remains open except D3's three recorded edges (their reopening
triggers named there) and D4's boundary itself.
