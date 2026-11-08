# 0235 — loop-plan split to its header's promise: the planning family's modules

Status: active-authority (0166 remediation step 075, wave WC-hygiene; findings
0165-177 = S01-08 and 0165-190 = S08-12 and 0165-224 = S32-06, S4 CONFIRMED
CPLX — "loop-plan.ts is 1184 lines against its own header's promise to stay
under 600" / the three measured seams / the complexity standing-debts
umbrella — plus the comment half of 0165-189 = S08-11, S4 CONFIRMED DOC).

One family — **the module-split law under P5 and P18** (this repository's own
build rules: 0024 §D.2 and AGENTS.md's development conventions — pure moves
under byte-identical goldens, one ingredient per change during relocations,
the import-direction ratchet's conscious table edits). A module that outgrows
its own recorded size promise splits along its internal seams by whole-function
move; the navigation surfaces follow; the maintenance text that describes
retired machinery is restated to the truth its code keeps. 0165 is the
evidence, not the authorization: every number below was re-measured at this
step's HEAD before the remedy was chosen.

## The measured ground (this step's own, at HEAD `25fe8329f`)

- **loop-plan.ts is 1300 lines at HEAD** (the finding's 1184 was the review
  snapshot; W8-planning's rulings 0205/0207/0208 grew it) against the
  header's line-6 promise ("…do not push that file past 600 lines").
- **The importers, exhaustive**: src — loop-phase.ts alone (`appendPlan`,
  `appendWithStep`, `phaseState`, `planWithStep`); tests —
  test/append.test.ts (`appendProblems`, `resetAppend`, `snapshotAppend`,
  `AppendSnapshot`) and one agent-fake.test.ts comment naming the module for
  the audit-commit behavior; shells — nothing (grep across packages/auto and
  packages/auto-server, src and test).
- **The internal seams at HEAD** (measured on the current file, not the
  review's line numbers): (1) the append half — `earlierHandoverSources`,
  `AppendSnapshot`/`snapshotAppend`, `appendProblems`, `resetAppend`,
  `appendPlan`, `phaseAppendPrompt`, `appendWithStep`, lines 881–1300,
  420 lines; (2) the shared plan-step gate — `planFacts`, `planDuties`,
  `charterPhaseEntry`, `verifyPlanStep`, `auditTail`, `admissionWarn`,
  `recordSynthesisAudit`, lines 66–217 + 822–838, 169 lines; (3) the
  composition state — `previewFormulationDocument`, `FormulationParts`,
  `readFormulationSources`, `formulationParts`, `floorBlocks`, lines
  654–820, 167 lines; `earlierHandovers` (862–879) shared by (3) and the
  append prompt. planPhase + planWithStep + header/imports are the remaining
  ~510.
- **The finding's third seam is already delivered in substance**: 0208 D2
  split `formulationParts` into the booking half and `readFormulationSources`
  (the re-readable half, freshened per pass — S08-03's remedy landed as step
  048). What remains of S08-12's item (3) is the compose closure's syntactic
  shape — extracting it rewrites eleven captured locals into parameters; that
  is a restructure, not a move.
- **The stale comments, verified live at HEAD**: (a) three numbering-record
  comments — loop-plan.ts:235 "a missing one starts no numbering-restore
  session", :1049 "sharing its machinery — the numbering record", :1060 the
  append twin of :235 — the numbering record and its restore session retired
  by 0150 (the module's own comment at :240–243 states the truth: the number
  derived at each allocation, no record, no restore session); (b) two
  classifier-route comments — formulate-synthesis.ts:466 "the
  verifyPlanPrompt shape: the registry's classifier entry", :501 "the
  verifyPlanPrompt precedent" — the plan verifier left the classifier route
  for the phase-plan candidate list in 0113 (docs/structure.md's plan-step
  verifier row; `checkTextAgainstCharter` still rides the entry — the
  accurate live sibling).
- **The dead re-export**: loop-plan's `export { phaseTitle }` claims
  re-exporting "so this module's historical importers keep one path" —
  measured zero importers at HEAD (loop-phase.ts and wall.ts import
  `phaseTitle` from ./phases; no test, no shell).
- **phaseState's placement decides itself**: three of the four post-split
  consumers (loop-phase, the append half's two helpers, `formulationParts`)
  need it; leaving it in loop-plan closes a cycle loop-plan →
  formulate-parts → loop-plan. Its body is `readPhases` plus the empty
  default — the phases reader family's own shape (its natural home is beside
  `readPhases` and the `PhaseState` type in src/phases.ts).
- **Loop-phase.ts measures 803 lines at HEAD** — past the same 600 number
  its 0053 A2 split companion promised. No register row names it (the
  register's size-debt set is loop-plan, planPrelude, session.ts); recorded
  here as a measured observation for the ledger, not enacted.

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P5** (single ownership, mechanism scope): "every mechanism, rule and
  vocabulary has exactly one owning home". Showing: the append step, the
  plan-step gate and the composition state each get one owning module, and
  the ratchet family completes consciously in the same change — the
  import-direction tables' rows for the new modules, the fifteen one-way
  lists that name loop-plan gaining the three family names (their `why`
  texts say "must not import the loop"; a lower module importing a split
  half of the loop is the same violation). No compatibility re-export is
  added, and the one existing dead re-export is removed — "compatibility
  re-exports … deliberately temporary; retired when the migration they serve
  lands" (P5's known tensions); the 0105 migration it served has no
  importers left.
- **P18** (the record outlives the tool): the header's size promise is a
  commitment in the durable record about the record's own navigability.
  Showing: the promise is KEPT, not retired — every family member measured
  under 600 after the split — and restated as the family's own so the next
  reader answers "where does X live" from the modules themselves (224's own
  remedy: "size promises either kept or re-stated when consciously broken").
- **P6** (derived state, idempotence): the move re-derives nothing and
  persists nothing — whole functions move verbatim, every caller's behavior
  byte-identical, the proof the unchanged full suite.
- **P8** (every surfaced line teaches its remedy — here its mirror: every
  maintenance line states the truth): comments describing retired machinery
  (the numbering record, the verifier's pre-0113 route) teach falsehoods to
  the next reader; restated to what the code keeps.
- **P21** (machinery waits for its consumer): the compose-closure
  restructure is declined — its consumer (the freshen's correctness) was
  served by 0208 D2; extracting `composeFormulation` now would be structure
  for a shape no future change has asked for, bought with restructure risk
  the byte-identical proof cannot carry.
- The module-split law itself (0024 §D.2; the 0032 F9 / 0034 D4 / 0102
  convention; "one ingredient per change during relocations — no dedup
  mid-move"): the relocation carries no other behavior change; the comment
  repairs are comment-only; 0165-189's four behavior-affecting items are
  deferred with named residuals (D4).

Derives: P5, P18, P6, P8, P21 (the showings above) + the repository's
module-split law (0024 §D.2, a development convention carried by AGENTS.md —
its ratchet's conscious edit is part of D1). Amends: none.

Tier: **source layout** (a pure module split, its import-path locksteps and
comment restatements; no runtime behavior, no protocol surface, no test
semantics — the suite's verdict over the moved code is the byte-identical
proof).

premises this ruling changes: **none** — re-read standing: 0053 A2 (the
move out of loop-phase; its direction law restated for the family, its
content unchanged), 0053 D23–D25 (the append step — moved whole, its
snapshot → reset → collect contract verbatim), 0080 §5 + 0082 §10 D12/D14b
(the gate — moved whole), 0097 D3 (the composition state — moved whole),
0156 D4 + 0208 D2 (the freshen and the parts split — untouched, their homes
named in the new module headers), 0102 (the split conventions — followed),
0150 (the numbering — its truth is what the restated comments now say),
0113 (the verifier's route — its truth restated into formulate-synthesis's
comments), 0105 (the phaseTitle move whose re-export retires — the
migration measured complete).

## Decisions

**D1 — the split: three sibling modules by pure move; loop-plan keeps the
planner.** `src/loop-append.ts` ← the append half (finding seam 1; the
module named as S08-12 proposed), exporting `appendPlan`/`appendWithStep`
(loop-phase's imports) and `snapshotAppend`/`appendProblems`/`resetAppend`/
`AppendSnapshot` (test/append.test.ts's — its import line updated, the ruled
lockstep). `src/plan-gate.ts` ← the gate (seam 2): the plan-step consistency
gate both planning sessions pass (`verifyPlanStep`, `auditTail`),
`admissionWarn`, `recordSynthesisAudit`, and the render facts both halves
share (`planFacts`, `planDuties`, `charterPhaseEntry`) — exported to the two
loop modules. `src/formulate-parts.ts` ← the composition state (the size
promise's third move): `previewFormulationDocument`, `FormulationParts`,
`readFormulationSources`, `formulationParts`, `floorBlocks`,
`earlierHandovers` — `earlierHandovers`' home decided by its consumers (both
halves read it; it is a composition source reader, not gate machinery —
S08-12's "shared through the gate module" suggestion overruled on that
ground). `phaseState`'s home moves to src/phases.ts beside `readPhases` (the
cycle law decides; loop-phase's import updated); the dead `phaseTitle`
re-export is removed from loop-plan (measured zero importers). loop-plan
keeps `planPhase` + `planWithStep` (~510 lines after); measured sizes:
loop-append ≈ 470, plan-gate ≈ 200, formulate-parts ≈ 215 — **every family
member under 600**. The import-direction ratchet's conscious edit: CLASSIFIED
and SUBDOMAIN rows for the three new modules ("driver" / "pipeline" —
loop-plan's own cells), and the fifteen FORBIDDEN one-way lists naming
loop-plan (close, plan, driver-helper, models, tier, model-route,
models-describe, agent-env, select, routing, keyring, classify, router,
agent-pool, lanes) gain the three names. Comments naming loop-plan for a
moved mechanism follow their module (the lockstep agent-fake.test.ts's §5
wiring-gap note stood for: it names src/loop-plan.ts for the audit-commit
behavior — now src/plan-gate.ts). The verification pass found seven more of
that class and repaired them, comment-only: src/prompt-verify.ts (the
verifier-verdicts line names verifyPlanStep's home), src/loop-task.ts (the
repair-eligibility note names appendPlan's home), src/loop-phase.ts's own
audit-placement comment (the convention's writer), src/roles/registry.ts's
`index-docs` policy line (appendProblems's home; its plannedTaskProblems
half was already stale for a pre-split move to tasks.ts — restated whole),
and test/golden.test.ts + test/prompt-phase.test.ts's two duty-paragraph
notes (the planDuties wrapper's home). Not of that class and left
untouched: test/driver-helper.test.ts's local forbidden-import pin names
./loop-plan — a 0105 D4 functional list, not a comment; the law for the
new modules is held by the import-direction ratchet's driver-helper row,
and widening that local list is its own ruling's act.

**D2 — the header's promise restated as the family's own (177/190/224's
loop-plan item).** loop-plan's header replaces the 0053 A2 sentence (whose
"that file" pointed at loop-phase) with the family truth: the module keeps
itself under 600 lines — split to honor it (0235) — the three siblings named
with their one-line responsibilities, and the direction law extended
(loop-phase → loop-plan/loop-append → plan-gate/formulate-parts → loop-task;
loop-plan never imports loop-phase, loop or loop-append). Each new module's
header states its own responsibility and the same law.

**D3 — the stale comments restated (189a/189b), comment-only.** (a) The
three numbering comments: the input checks' purpose restated — "checked
first, so a missing one stops the step before anything is written" (the
truth since 0150 the module's own numbering comment already states); the
append doc comment's "the numbering record" → "the numbering derivation".
(b) formulate-synthesis's two: the fidelity one-shot's call shape
re-attributed to the live sibling — `checkTextAgainstCharter` still rides
the registry's classifier entry, and the plan verifier left that route for
phase-plan in 0113. No code, no strings, no behavior.

**D4 — 0165-189's four behavior-affecting items deferred with named
residuals.** Each is a defect fix under the program's regression rule
(coverage that fails for the confirmed defect and passes for the fix), and
folding one into a relocation breaks 0024's one-ingredient law and the
byte-identical proof obligation: (c) the formulation todo's nested sketch
headings (`acceptanceSection` reads the sketch's placeholder for every
formulation unit) — a rendering change that moves every standing todo's
floor digest (the 0097 D6 keep misses; one-time reconstruct churn across
reviewed todos) — its own ruling must answer that migration question;
(d) `coverageProblems`' known set includes the skipped formulation unit
itself (the planner as its own coverage passes totality) — a
collect-semantics fix at runner.ts/formulate-synthesis.ts;
(e) the synthesis FALLBACK line's missing retry teaching
(`transfer --resynthesize`, the one channel that retries the constructor) —
a surfaced-line change, pinned outputs following in lockstep;
(f) the append block map's missing round brief (the locator never names
round.md for an append verdict) — a block-map change. Their home: this
ruling + the program's Current position + the 0165-189 ledger row (deferred,
each named); the final audit sees them; scheduling them is the maintainer's.

**D5 — 224's other debts, each with its standing home (the umbrella
dispositioned).** planPrelude's 16 hand-ordered rows: consciously declined
on P21 grounds by 0207 D3 (recorded in 0165-188's row as the first candidate
for the next row-affecting ruling). session.ts's size/comment debt: S13's
finding (step 077's "loop comments" family, finding 0165-019's set).
stats-schema untested: fixed — 0165-063, step 072's census. The ~310
AUTO-DECISION/AUTO-RESOLVE working-memory comments: S32's own note — nothing
to fix (the corpus's working memory; 0167's premise guard is the
drift-slowing measure). The probe-form /exit P21 note: **healed at HEAD** —
0211 D2's park/repair/blocked-keep landings run the boundary machinery in
probe form (loop-task.ts:1333/:1343/:1556 name the consumers); no reserved
surface remains. loop-phase.ts at 803 lines: measured here, no register row
names it — recorded for the ledger as the family's next size observation.

## Category scope (0123 D1 — the family: the module-split/navigation law over the planning modules, measured at ruling time)

| home | this ruling |
| --- | --- |
| `src/loop-plan.ts` | **changed** — keeps planPhase + planWithStep; header restated; the (a) comments; the dead re-export removed (D1/D2/D3) |
| `src/loop-append.ts` | **created** — the append half, moved whole (D1) |
| `src/plan-gate.ts` | **created** — the gate, moved whole (D1) |
| `src/formulate-parts.ts` | **created** — the composition state, moved whole (D1) |
| `src/phases.ts` | **changed** — `phaseState`'s new home, moved whole (D1) |
| `src/loop-phase.ts` | **changed** — the import lines, the header's family sentence, one comment's module name (D1) |
| `src/formulate-synthesis.ts` | **changed** — the two (b) comments only (D3) |
| `src/prompt-verify.ts`, `src/loop-task.ts`, `src/roles/registry.ts` | **changed** — one lockstep comment each, naming a moved mechanism's home (D1) |
| `test/append.test.ts` | **changed** — the import path lockstep (D1) |
| `test/agent-fake.test.ts` | **changed** — one comment's module name (D1) |
| `test/golden.test.ts`, `test/prompt-phase.test.ts` | **changed** — comment-only lockstep (the plan-gate helper's name), no test semantics (D1) |
| `test/import-direction.test.ts` | **changed** — CLASSIFIED/SUBDOMAIN rows, the fifteen FORBIDDEN lists (D1) |
| `AGENTS.md` | **changed** — the navigation lines naming loop-plan's files |
| `docs/structure.md` | **changed** — the module rows naming loop-plan's files |
| `plans/INDEX.md` | **changed** — the 0235 row |
| `templates/prompts/*`, `src/prompt-plan.ts` | untouched, deliberately — no prompt surface or renderer moves (the sketch's nesting is D4(c)'s deferred ruling, not a move) |
| `packages/auto`, `packages/auto-server` | untouched, deliberately — no shell file names loop-plan (measured); no shell suite owed |

Open after this ruling: D4's four deferred items (each named, each with its
ruling question) and D5's loop-phase observation.
