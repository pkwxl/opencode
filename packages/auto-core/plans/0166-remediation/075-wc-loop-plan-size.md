# Step 075 — wc-loop-plan-size: loop-plan.ts split to its header's promise + its stale comments

Status: **done** 2026-11-09 (started from HEAD 25fe8329f — step 074's
commit; enacted in the first session, verified, completed and committed by
the recovery session).

Findings: 0165-177 (S01-08), 0165-189 (S08-11), 0165-190 (S08-12), 0165-224
(S32-06), all S4 CONFIRMED, bucket WC-hygiene. The register rows: 177 "loop-plan.ts
is 1184 lines against its own header's promise to stay under 600" (at HEAD
1300); 190 the three measured split seams (the append half, the plan-step gate,
the compose closure); 189 the S08 scope-hygiene set (stale numbering-record
comments, stale classifier-route comments, the nested sketch headings, the
coverage known set, the FALLBACK retry teaching, the append block map's round
brief); 224 the complexity standing-debts umbrella (the loop-plan size promise
its loop-plan item). Evidence: the records
plans/0165-review/S01-probes.md (S01-08), S08-formulation.md (S08-11, S08-12),
S32-synthesis.md (S32-06).

Surface: `src/loop-plan.ts` (1300 lines at HEAD) and the surfaces that name
its files — AGENTS.md navigation lines, docs/structure.md, the
test/import-direction.test.ts tables, test/append.test.ts (the append
collect's direct-test importer). This is a hygiene step under the development
conventions: behavior-preserving moves under byte-identical goldens (0032 F9 /
0034 D4 / 0102), one ingredient per change during relocations (0024), the
module-split and dependency-direction law (0024 §D.2, the import-direction
ratchet).

## Plan (written before editing)

1. Ruling 0235 first (next free number after 0234): answer the boundary from
   docs/principles.md first (P5 one home per mechanism — the split modules'
   ownership and the acyclic graph; P18 the record — the header's size
   promise kept or re-stated, never silently broken; the module-split law
   0024 §D.2 and its ratchet's conscious table edit; P6 — pure moves only,
   nothing re-derived; P8 — every stale comment restated to the truth its
   code keeps). Decide the seams from the module's internal structure at
   HEAD (not the review's 1184-line snapshot): the append half, the shared
   plan-step gate, the composition-state block; measure the resulting sizes
   against the 600-line promise; rule the compose-closure extraction (the
   finding's third seam) separately — its substance (the freshen re-read)
   already landed as 0208 D2, and a closure restructure is not a pure move.
2. Enact per the ruling, the move/split only: the new sibling modules by
   whole-function moves, loop-phase's and test/append.test.ts's import
   paths updated as the conscious lockstep, the import-direction tables'
   conscious rows, phaseState's home question ruled (the cycle law decides).
3. Repair the stale comments the findings name: 189(a) the three
   numbering-record comments in the loop-plan family, 189(b) the two
   classifier-route comments in formulate-synthesis.ts — comment-only, no
   behavior. Restate loop-plan's header so the size promise is the module's
   own and kept (190's "retire or keep accordingly", 224's "kept or
   re-stated").
4. Prove behavior preserved: `bun typecheck` + the full suite green at the
   3278 pass / 0 fail, 165 files baseline — zero test edits beyond the
   ruled import-path lockstep; no new tests (the existing suite is the
   proof). 189's behavior-affecting items ((c) the sketch nesting, (d) the
   coverage known set, (e) the FALLBACK retry line, (f) the append block
   map) are NOT enacted here — each is a defect fix needing its own
   fail-before pin (the program's regression rule) and folding one into a
   relocation breaks 0024's one-ingredient law; they are deferred with
   named residuals in the ruling and the ledger.
5. Bookkeeping: INDEX row for 0235, coverage-ledger dispositions for
   0165-177/189/190/224, program row 075 → done, Current position rewritten,
   this record's Verification + Dispositions filled. Commit the step's
   paths.

## Session log

- 2026-11-09 (this worker): authoritative inputs read (the program's
  executable prompt in full, status row 075, the four ledger rows, Current
  position; the S01-08, S08-11, S08-12, S32-06 records; src/loop-plan.ts in
  full at HEAD — 1300 lines; the review-time loci re-derived against
  92f45c501 where the findings' line numbers had drifted; the importers —
  loop-phase.ts the only src importer, test/append.test.ts and one
  agent-fake.test.ts comment the test side; the import-direction tables'
  loop-plan rows — CLASSIFIED, SUBDOMAIN, the fifteen FORBIDDEN one-way
  lists; docs/principles.md's P5/P6/P8/P18 statements and the How-to-rule
  section; AGENTS.md's navigation lines naming loop-plan; docs/structure.md's
  module index; 0102/0024 re-read for the split conventions; the W8-planning
  rulings 0205/0207/0208 re-read for the premises guard — the compose
  closure's substance (the freshen re-read) landed as 0208 D2). Row 075
  marked doing; this record created. Next: write ruling 0235.
- 2026-11-09 (this worker, interrupted; recovered by the next): ruling 0235
  written whole (239 lines) and the split enacted in the working tree —
  src/loop-plan.ts 1300 → 488; src/loop-append.ts (451), src/plan-gate.ts
  (193), src/formulate-parts.ts (212) created; src/phases.ts gained
  phaseState; loop-phase's imports rewired; formulate-synthesis's two (b)
  comments; test/append.test.ts's import path; agent-fake's one comment;
  the import-direction CLASSIFIED/SUBDOMAIN rows and the fifteen FORBIDDEN
  lists. Interrupted before verification, the Category-scope navigation
  homes and bookkeeping.
- 2026-11-09 (this worker, recovery session): the predecessor's enactment
  recovered-complete — verified, not redone. A line-multiset comparison of
  HEAD's loop-plan against the three siblings proved the move whole-function
  verbatim (every unmatched line a ruled repair: headers, imports, export
  keywords, the D3 comment restatements, the dead re-export's removal,
  phaseState's body identical in phases.ts); every D1 export checked at its
  module and every importer matched (loop-phase, append.test, shells none);
  the fifteen FORBIDDEN lists verified as exactly D1's fifteen. One defect
  class found and repaired in-step, comment-only: seven comments naming
  loop-plan for a moved mechanism (src/prompt-verify.ts verifyPlanStep;
  src/loop-task.ts appendPlan; src/loop-phase.ts's audit-convention line;
  src/roles/registry.ts's `index-docs` policy line — its plannedTaskProblems
  half already stale for a pre-split move to tasks.ts, restated whole;
  test/golden.test.ts and test/prompt-phase.test.ts ×2, the planDuties
  wrapper) — the lockstep class D1's agent-fake comment stood for; ruling
  0235's D1 and Category-scope table extended to record them.
  test/driver-helper.test.ts's local forbidden-import pin names ./loop-plan —
  a 0105 D4 functional list, deliberately left (the ratchet's driver-helper
  row holds the law for the new modules; widening a test's assertion list is
  its own ruling's act) — recorded in the ruling and the INDEX row.
  Navigation homes landed: AGENTS.md five lines (append planning →
  loop-append; admissionWarn → plan-gate; the blockage line's compose-loop
  callers; the planning-input line's append consumer; the phase-loop family
  list), docs/structure.md four rows (plan-step verifier, phase planning,
  formulation task, blockage diagnosis), plans/INDEX.md the 0235 row.
  Verified: typecheck clean, full suite 3278/0 (165 files) — first run green
  over the enactment, second green over the final tree, no one-off in
  either; the nine affected suites (import-direction, constitution ×2,
  blockage, golden, prompt-phase, append, agent-fake, driver-helper) 268/0
  after the docs edits. Bookkeeping and commit follow.

## Verification

- `bun typecheck` exit 0 (after the seven comment repairs and the docs
  edits; also clean before them).
- Full suite `bun test` **3278 pass / 0 fail, 165 files** — the exact
  step-074 baseline; run twice: the first over the recovered enactment
  (184.12 s), the second over the final tree with the comment repairs and
  navigation homes (187.01 s). Zero test edits beyond the ruled lockstep
  (append.test's import path; the comment-only lockstep in agent-fake,
  golden and prompt-phase — no test semantics touched). No one-off failure
  in either run (the steps-072/073/074 agent-fake quota-wait pattern did
  not appear).
- The nine suites reading or pinning the touched surfaces re-run together
  after the docs edits: 268 pass / 0 fail (test/import-direction.test.ts —
  the ratchet over the three new modules' rows and fifteen lists;
  test/constitution-reconciliation.test.ts + test/constitution-ratchet.test.ts
  + test/blockage.test.ts — the AGENTS.md readers; test/golden.test.ts,
  test/prompt-phase.test.ts, test/append.test.ts, test/agent-fake.test.ts,
  test/driver-helper.test.ts).
- No test pins docs/structure.md or plans/INDEX.md (grep over test/; the
  docs-pin family pins releases.md and principles.md surfaces only).

## Dispositions

- **0165-177 (S01-08)** — **fixed** (ruling 0235 D1/D2: the split enacted,
  loop-plan 488 lines, the header's under-600 promise kept and restated as
  the family's own — every family member measured under 600: loop-append
  451, plan-gate 193, formulate-parts 212).
- **0165-189 (S08-11)** — **fixed for its comment half** (D3: the three
  numbering-record comments and the two classifier-route comments restated,
  comment-only); **the four behavior-affecting items deferred with named
  residuals** (D4: (c) the formulation todo's nested sketch headings — a
  rendering change moving every standing todo's floor digest, its own
  migration ruling owed; (d) coverageProblems' known set including the
  skipped formulation unit itself — a collect-semantics fix at
  runner.ts/formulate-synthesis.ts; (e) the synthesis FALLBACK line's
  missing retry teaching (`transfer --resynthesize`) — a surfaced-line
  change with pinned outputs; (f) the append block map's missing round
  brief — a block-map change; each a defect fix needing its own fail-before
  pin, folding one into a relocation breaking 0024's one-ingredient law;
  homes: ruling 0235 D4 + the program's Current position + the 0165-189
  ledger row; scheduling the maintainer's).
- **0165-190 (S08-12)** — **fixed** (D1: the append half and the
  composition state enacted as ruled — whole-function verbatim moves with
  earlierHandovers' home decided by its consumers; **the compose-closure
  extraction declined on P21 grounds** — its substance (the freshen
  re-read) landed as 0208 D2, the remaining syntactic shape a restructure
  of eleven captured locals the byte-identical proof cannot carry).
- **0165-224 (S32-06)** — **dispositioned via the D5 umbrella, each debt
  with its standing home**: planPrelude's 16 hand-ordered rows consciously
  declined on P21 grounds (0207 D3, carried by 0165-188's row); session.ts's
  size/comment debt step 077's finding-019 family; stats-schema untested
  fixed (0165-063, step 072's census); the ~310 working-memory comments
  nothing to fix (0167's premise guard the drift-slowing measure); the
  probe-form /exit P21 note **healed at HEAD** (0211 D2's landings run the
  boundary machinery, loop-task.ts:1333/:1343/:1556 the consumers); the
  loop-plan size promise this step's own D2; **loop-phase.ts at 803 lines
  measured and recorded as the family's next size observation** (no register
  row names it — the ledger row carries it).
- In-step observation, no register row: test/driver-helper.test.ts's local
  forbidden-import pin (0105 D4) names ./loop-plan and does not list the
  three new modules — deliberately left (a functional test list, its
  widening its own ruling's act; the import-direction ratchet's
  driver-helper row holds the law). Recorded in ruling 0235 D1 and the
  INDEX row.

