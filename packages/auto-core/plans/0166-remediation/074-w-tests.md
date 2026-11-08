# Step 074 — w-tests: the chain-writes ratchet's ten missed write shapes

Status: **done** (started 2026-11-09, from HEAD e292fbb7e — step 073's
commit; committed 2026-11-09 — see the program's Current position for the
session summary and the commit, its SHA recoverable from git history).

Finding: 0165-195 (S13-03). The register row: "The chain-write ratchet is
regex-based and misses ten write shapes (`||=`, aliasing, `Object.assign`,
bracket access, an optional `chain?: SessionChain` binding, `chain!.x`, a
newline before the dot, inferred locals, array elements, type aliases); a
type-aware census finds no real escape today — the gap is latent." Severity
S4, CONFIRMED, cat TEST. Evidence: the record
plans/0165-review/S13-session.md (S13-03), the lead probe
plans/0165-review/leads/R4-chain-ratchet.test.ts.txt (all ten shapes score 0
against the ratchet's patterns copied verbatim; the control
`chain.model = 'x'` scores 1), and the reviewer's TypeScript-checker census
over src/ (NO WRITES outside chain-transitions.ts; control: 60 writes inside
it). The gap is latent — no real single-ownership defect today; the ratchet's
own header names the hazard class ("a silent false negative is the real
hazard").

Surface: `test/chain-writes.test.ts` (0061 §4.8's ratchet, the one-home rule
for `SessionChain` writes held against `src/chain-transitions.ts`; AGENTS.md's
navigation line). P5 single ownership is the constitutional spine; P19 the
census; P13/P21 the frozen-vocabulary and machinery-awaiting-consumer
questions the remedy choice must answer.

## Plan (written before editing)

1. Ruling 0234 first (next free number after 0233): answer the boundary from
   docs/principles.md first (P5 — the ratchet exists to hold the one-writer
   rule; P19 — the census measured the ten escape shapes and the no-real-
   escape state of src/; P13 — the detection vocabulary grows consciously,
   additively; P21 — the remedy's machinery waits for its consumer: the ten
   shapes are natural future code, the consumer is the ratchet's own claim).
   Decide the remedy honestly: regex widening covers at most the syntactic
   shapes; aliasing and inferred locals are semantic — a flat regex cannot
   hold them; the finding's preferred remedy is the type-aware census (~60
   lines over the workspace's typescript package). Rule which, with the
   dependency question (typescript is the root workspace's declared runtime
   dependency; auto-core does not declare it — a declared devDependency is
   the one-home move) and the fail-before proof's shape.
2. Enact per the ruling: the ratchet's scan half is rebuilt on the ruled
   mechanism; the synthetic pin carries the finding's ten shapes as its
   fixture (the lead probe's cases asserted inverted — every escape shape
   must now be caught); the flat rule and the anti-vacuous guards stay.
3. Fail-before proof: the pre-fix ratchet (HEAD's file via `git show`) run
   over a crafted src file carrying all ten write shapes accepts them (0
   findings — the defect); the extended ratchet over the same file names all
   ten sites; HEAD's bytes restored and cmp-verified byte-identical.
4. Verification: `bun typecheck` + `bun test` in auto-core (baseline after
   step 073: 3277 pass / 0 fail across 165 files). No shell suite (no shell
   file touched). Measure the new census's runtime honestly.
5. Bookkeeping: INDEX row for 0234, coverage-ledger disposition for
   0165-195, program row 074 → done, Current position rewritten, this
   record's Verification + Dispositions filled. Commit the step's paths.

## Session log

- 2026-11-09 (this worker): authoritative inputs read (the program's
  executable prompt, status row 074, ledger row 0165-195, Current position;
  the S13-03 record and the R4 lead probe; 0061 §4.8 and its B-stage landing
  notes; test/chain-writes.test.ts in full; src/chain.ts's SessionChain; the
  AGENTS.md navigation line; docs/principles.md's P5/P5-adjacent P13/P19/P21
  statements and the How-to-rule section; the pattern-borrowers' citations
  0072/0082/0102 re-read for the premises guard — they borrow the one-home
  shape, never the lexical scanner). Row 074 marked doing; this record
  created. Measurements so far: the write alternation at
  test/chain-writes.test.ts:227 lists `\|=` but not `\|\|=` (the `||=`
  escape confirmed from the pattern itself); the binding finder at :184 has
  no `?` before the colon (the `chain?: SessionChain` escape); no
  `Partial<SessionChain>`/`Readonly<SessionChain>` anywhere in src/; no
  method-call mutation of `chain.failed/baseline.…(…)` in src/; 163 .ts
  files under src/; the typescript package resolves from packages/auto-core
  (5.8.2, hoisted from the root's declared runtime dependency — auto-core
  itself does not declare it); the workspace install is frozen-lockfile-clean
  and offline-capable. Next: write ruling 0234.
- 2026-11-09 (this worker, measurements): the census probe (scratch,
  package-local for module resolution, removed after) — (a) the lead
  probe's ten cases re-run against the current ratchet's patterns verbatim:
  all ten 0, control 1 (re-confirmed at this HEAD); (b) the type-aware
  census over src/'s 163 root files: program build 1.7 s, **0 writes
  outside chain-transitions.ts** (the reviewer's census confirmed — no
  code moves), **65 writes inside** (the reviewer's 60 drifted with the
  transitions' evolution); (c) the ten shapes in an in-memory probe module:
  exactly ten hits, zero over the negatives — and two probe defects found
  and fixed on the way (absolute-vs-relative filename matching making a
  census vacuous — the same class the control floor now guards; the
  Object.assign target being a bare identifier, not a member access).
  Ruling 0234 written. Next: enact (the ratchet rebuild, the devDependency).
- 2026-11-09 (this worker, enactment): test/chain-writes.test.ts rebuilt on
  the census (one program, the probe module riding the same build; four
  tests: the flat rule, the control floor, the type-anchor shape guard, the
  inverted ten-shape pin); package.json + bun.lock gain the typescript
  devDependency (offline reconcile, the lockfile diff exactly one line).
  First ratchet run 4/4 green in 3.87 s. One tsgo-only fix in-change:
  `ts.isAssignmentOperator` exists at runtime but not on the public type
  surface — the frozen enum markers FirstAssignment..LastAssignment (64–79,
  `||=`/`&&=`/`??=` inside) used instead; typecheck exit 0 after.
- 2026-11-09 (this worker, fail-before): HEAD's test/chain-writes.test.ts
  extracted via `git show` into /tmp/074-head (src/ copied beside it).
  First attempt — one combined plant file with all ten shapes: the OLD
  ratchet caught f5's flat `chain.model =` through a name cross-leak from
  f1's annotated binding in the same file (a catch for the wrong reason;
  the lead probe's per-case isolation is the honest measurement shape).
  Ten isolated plants `__escape_01__..10__.ts`: the OLD ratchet's flat rule
  **passes** (3 pass / 0 fail — ten violating writes accepted silently,
  the defect); the same ten planted in-tree: the NEW census's flat rule
  **fails naming all ten sites** (`__escape_01__..10__.ts`, one per shape,
  the pin green beside them); plants removed (`rm`, my own scratch — no
  wholesale reversion touched), suite green again.
- 2026-11-09 (this worker, verification): `bun typecheck` exit 0. Full
  suite: first run 3277 pass / 1 fail — the failure `test/agent-fake.test.ts`
  "a reset stated in Zhipu's wording (S4a)" (13 ms; the steps-072/073
  one-off pattern, this time named) — then green in isolation (142/142)
  and in the second full run: **3278 pass / 0 fail, 165 files** (the
  3277/0 baseline + 1 net test). Bookkeeping done (INDEX 0234 row, AGENTS.md
  + docs/structure.md pointers, ledger 0165-195 fixed, row 074 done,
  Current position rewritten). Next: the commit.

## Verification

- `bun typecheck` exit 0 (one in-change repair: the runtime-only
  `ts.isAssignmentOperator` replaced with the public enum range markers).
- Full suite **3278 pass / 0 fail** across 165 files (the 3277/0 step-073
  baseline + 1 net test — the ratchet's 4 tests replacing its old 3; the
  file runs 3.9 s, the program build its measured cost). One first-run
  failure in `test/agent-fake.test.ts`'s quota-wait case ("a reset stated
  in Zhipu's wording (S4a)", 13 ms) — green in isolation (142/142) and in
  the second full run; the third session with this one-off pattern, its
  name captured this time (a recurrence makes it a register row).
- Fail-before/red-green (the program's swapped-source method, HEAD's file
  via `git show`, worked in /tmp/074-head): the pre-fix ratchet over ten
  isolated violating src files **accepts all ten** (its flat rule green —
  that acceptance is the defect, matching the finding's measured
  `logicalOr:0 … typeAlias:0, control:1`); the extended ratchet over the
  same plants names all ten sites (flat rule red listing them); plants
  removed before any commit; the combined-file cross-leak measured and the
  isolation requirement recorded in the session log.
- No shell suite run — no shell file touched (packages/auto,
  packages/auto-server untouched).

## Dispositions

- **0165-195 (S13-03)** — **fixed** by ruling 0234: the ratchet's detection
  truth rebuilt type-aware, all ten shapes held (the pin asserts the lead
  probe's cases inverted — each escape shape must now fail the suite), the
  regex scan deleted rather than widened (two of the ten are dataflow
  facts), the census's three remaining edges recorded empty-by-measurement
  with their reopening triggers (0234 D3), the family line drawn for the
  finding's own family note (0234 D4: statement- and prose-shaped ratchets
  stay regex — no measured escape, both siblings green). The gap was latent
  (census: 0 writes outside the transitions) — no code moves, zero runtime
  behavior changed.
- Residuals named: the three census edges + the family line (0234 D3/D4,
  the ruling + the program's Current position their home); the agent-fake
  quota-wait one-off (third session, named — a recurrence becomes a
  register row).
