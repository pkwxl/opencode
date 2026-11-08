# 0221 — the renderer-owned prose boundary and the bundle parse's nested validators

Status: active-authority (0166 remediation step 061, wave WE-policy; findings 0165-159 = S23-04
(S3, CONFIRMED — the bundle parse's deferred failure, reproduced by the record's probe) and
0165-047 = S23-05 (S2, CONFIRMED — a P15 design challenge the record itself carries to a ruling,
not an accidental drift claim: "this is a design challenge to those rulings under the current
P15")).

Two rulings of one family — where session-facing copy may live, and where a policy bundle's
nested grammars are first judged:

- **Bundle parsing accepts malformed guarantee and test-lane bodies, deferring failure until
  after materialization** (0165-159): `parseIntentBundle` validates every piece through the
  per-surface parsers (`parsePhaseTypeFile`, `parseIntentFile`, `parseModeFile` — 0079 §3's
  "a refused parse writes nothing" contract) but the pack's nested semantic grammars — the
  `## guarantees` assert lines, the `(<phase>)` qualifiers, the `verify-plan-*` key family, the
  `### test-lanes` field blocks — are parsed nowhere on that path. A bundle whose pack carries
  `must nope` (unquoted) or a lane row without its `Command:` line passes init's
  validate-before-write boundary, materializes its files, stamps the config, and only then fails:
  every later `run` exits 1 at preflight over a committed governance surface the person must
  repair by hand.
- **Session-facing prose still lives in renderers, including a consciously un-overridable
  formulation protocol** (0165-047): four named sites plus their conscious rulings — the
  phase-charter lead-in (`verifyPlanCharterText`), the side-effect violation lines
  (`scriptViolationLine`, 0083 D11's "caller-side join the template syntax has no loops for"),
  the closed-prerequisite notes (`closedPrerequisiteNotes`, 0053 D16's "driver text, so no
  template changes"), and the formulation todo's assembly (`renderFormulationTodo`, 0095 D4's
  "the todo assembly is code, consciously not template-driven in Stage 1" — a project's former
  `phase-plan.md` overlay consciously has no effect). The record's own remedy names the two
  admissible answers: re-home the prose in templates/partials, or explicitly amend P15 and the
  navigation to carve out durable formulation documents and dynamic driver feedback.

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P15** — the principle whose letter is at stake. Its rationale ("copy in code is
  unreviewable and un-overridable") and its derivations ("renderers only assemble; to change
  prompt wording touch only the template files", 0005/0029) were written for **prompt copy** —
  the wording of the session prompts — and **judgment content** — the policy carried by packs and
  bundles. The four sites are neither, on inspection: the formulation todo is a *durable task
  document the driver itself writes into the target repo and parses back* (its title line,
  `Phase:` field, `## Goal`/`## Scope`/`## Acceptance` headings, terminator, index line and
  coverage-map grammar are `taskTodoSpec` and the collect's own parsers — P7's mechanical
  grammars); the violation and prerequisite lines are *state-naming joins over measured run
  state* (which paths the guard restored, which prerequisite closed and why — data, serialized as
  prose because the template syntax has no loops, 0083 D11); the charter lead-in is a
  serialization join over two pack subsections whose one sentence names the pack key the
  following text came from (0100 D11's audit spelling — which `verify-plan-*` key was in force).
  P15's own derivations already scoped driver feedback out of the guarantee gate (0080 §8: "the
  gate does not check driver-authored feedback strings"). The honest defect is therefore not the
  code's location but the **letter's silence**: the statement claims a totality ("never authors
  copy") the corpus's own conscious rulings had already punctured. A principle that misstates its
  own scope is corrected in its letter, not by relocating code the rulings consciously placed
  (D2 below).
- **P7** — grammars, never content: the driver checks and writes only mechanical grammars it
  defines. The formulation protocol's teaching is exactly that — the driver teaching the session
  the grammar the driver itself will parse. Making it overlay-writable would hand the authority
  over the driver↔session contract to the same accident surface 0220 D1/D2 just fenced (a
  template that teaches a driver-parsed grammar is tier-1 guarded precisely because an overlay
  may re-voice it but never drop it; the formulation todo is *almost entirely* such grammar, so
  its "template" would be guardable only by freezing nearly the whole body — an overlay in name
  only).
- **P12** — fail loud, conservative under uncertainty: the bundle-parse defect is the principle's
  exact anti-shape — a green accept whose failure surfaces one boundary later, after writes, as
  a repeated exit 1 over a surface the person did not hand-write. The nested validators run at
  the parse's own moment (0079's no-writes contract) and the uncertain reading (a malformed
  assert line) resolves toward the loud refusal.
- **P13** — frozen vocabularies grow additively and in conscious lockstep: no vocabulary changes
  here at all. The bundle-parse arm adds no new grammar — it runs the two validators that already
  exist (0220 D3's `guaranteesProblem` among them) at one earlier moment; the two new
  refusal messages are the validators' own existing texts. The P15 amendment adds a named
  boundary to a principle's letter — a constitution wording change, enacted in the same change
  as the navigation that states it (the lockstep owed).
- **P10** — the byte-identical floor: every valid bundle parses to the identical `IntentBundle`
  (the validators return undefined over clean packs; the shipped family's existing parse tests
  stay green unchanged), every render and steered line is byte-identical (D2 changes no code
  behavior — comment pointers aside), and a project with no `### asserts`, no lane table and no
  overlays is untouched. The known-breakage class of D1 is a bundle that already carried a
  malformed body: it previously materialized and failed at preflight; it now fails at parse —
  the acceptance 0079 §3 already ruled for every other malformed piece of the same bundle.
- **P5/P21** — one owner per mechanism, machinery waits for its consumer: the validators keep
  their one home (`src/intent/guarantees.ts`, `src/intent/test-lanes.ts`) and the bundle parse
  calls them; no mirror grammar is written. The D2 by-design arm refuses a new template surface
  whose only consumer would be a hypothetical overlay author — no incident, no demand, and a
  measured cost (a new frozen surface plus the tier-1 guard lockstep it immediately owes); P21's
  own rule is that a reserved surface is a name, never a half-built mechanism.
- **P19** — measured evidence: the record's evidence is the design tension and the deterministic
  traces, honestly labeled RECORDED-0095 ("prior" — a challenge to a standing ruling, not a new
  defect). No incident of a person defeated by the un-overridable protocol is on file; the one
  measured harm named is the dishonest navigation line (fixed in this change's lockstep).

## Decisions

### D1 (0165-159) — the bundle parse runs the nested validators before returning a materializable bundle

`parseIntentBundle` (src/bundle.ts) captures the pack `parseIntentFile` returns (previously
parsed and discarded) and, before returning, runs the two nested-grammar validators on it,
throwing the first problem:

- `guaranteesProblem(pack, <the bundle's own custom phase type ids>)` — the assert lines' syntax,
  the `(<phase>)` qualifiers and the `verify-plan-*` key family validated against the builtin
  preset letters plus the bundle's own declared custom types (`spec-read`, `audit` for
  cleanroom). The **template vocabulary parameter is omitted** — 0220 D3's own design: the
  template half is "a fact about the run's library the preflight caller owns", and the bundle
  layer knows no library (it parses at init and inside provenance/sync comparisons, where no
  library state exists; P14 — the bundle layer cannot import one). An assert's *template* target
  therefore stays validated only at run preflight, over the materialized project's loaded
  library — the split 0220 D3 already ruled, restated here as the bundle boundary's own letter.
- `testLanesProblem(pack)` — the lane table's strict field-block grammar.

Both validators' messages already name the pack (`intent pack "x" asserts literals must be
double-quoted…`), so the CLI's existing `--intent <value>: <message>` + exit 1 arm renders the
refusal unchanged. Every caller inherits the strictness from the one parse home (P5): init's
validate-before-write (the finding's scene — the refusal now precedes every write), and the
provenance/sync comparisons, which parse *the running binary's own bundle* — a malformed
registered bundle now surfaces there loudly, the same throw class a malformed manifest already
occupies today (those parses were never throw-free), while the shipped built-ins are held green
by the existing parse tests plus the new census rows.

The floor and the edges:

- A clean pack changes nothing: both validators return undefined, the returned `IntentBundle` is
  field-for-field identical, and the shipped family's existing parse/materialize tests run
  unmodified (their packs were already held to the same validators at every stamped project's
  preflight).
- A bundle pack asserting on a phase type the bundle does not itself declare (say a project's
  pre-existing on-disk custom type) is refused at parse though a post-materialization preflight
  over that directory would accept the qualifier: the conservative bound is deliberate — a
  bundle is a self-contained policy unit whose pack targets the vocabulary it ships, and on
  every fresh install (the bundle's own scene) such an assert is a dangling target, exactly the
  silently-checks-nothing class 0220 D3 exists to catch. Named as a residual.
- Hand-dropped project packs are untouched: they never pass through the bundle parse and keep
  failing at run preflight by design (the record's family note — "bundle parse has the stronger
  no-writes contract").

### D2 (0165-047) — by-design with a named boundary: P15's letter amended, the navigation corrected, the boundary ratcheted

The design question is answered in the record's second arm: **the prose stays renderer-owned,
and P15's letter is amended to name the two classes it never reached.** The first arm
(re-homing in templates/partials) is declined on the record's own evidence:

1. **The formulation todo is driver grammar teaching for a driver-written durable document, not
   prompt copy.** Its protocol section is the teaching of the grammar the driver itself parses
   (`taskTodoSpec`, the index line, the coverage map, the numbering rule); a template surface
   for it would be instantly tier-1 by 0033 D4's own criterion (a string the driver parses out
   of session output), so an overlay could re-voice nothing of substance — the guard would have
   to freeze nearly the whole body. The policy content that *should* be project-owned already
   flows to the assembly from the P15-correct layers: the pack's duties and precedence and
   round-brief rules through `planDutyText`/`intentText`, the partials (`task-depends`,
   `task-decompose`, `doc-layout`, the question rule) through `renderText` — 0095 D4's own
   "overlays of `_partials.md` still apply" letter. Re-templating the frame buys re-voicing
   structural lead-ins at the cost of a new frozen surface, the guard lockstep it owes, and the
   resurrection of exactly the dropped-protocol risk class 0220 D1/D2 just fenced — with no
   measured consumer (P19, P21).
2. **The feedback lines are state-naming joins, not policy.** `scriptViolationLine` serializes
   what the guard measured (restored paths, moved HEADs) into the `{{violation}}` slot of the
   `test-result` template, which itself carries the standing instruction — the template owns the
   policy sentence, the code names the state (0083 D11's caller-side-join ruling, 0080 §8's
   scoped-out class). `closedPrerequisiteNotes` is one line per closed prerequisite naming id
   and reason — 0053 D16's conscious ruling, its `[DRIVER]` marker the registered
   language-neutral token (0053's own non-registration table).
3. **The charter lead-in is a serialization join over pack data.** `verifyPlanCharterText`
   composes the pack's two charter subsections under one sentence whose load-bearing content is
   the key id itself — `(verify-plan-test)` is how the audit trail shows which spelling was in
   force (0100 D11). The charter text on both sides of the join is pack-owned (P15's own
   "judgment content in packs").

The enactment is the finding's second remedy, in lockstep (P13):

- **docs/principles.md, P15**: the statement's "code assembles data and never authors copy"
  gains the named boundary — the two standing renderer-owned classes (driver document-grammar
  teaching; dynamic driver feedback) — and the Derivations block gains the 0221 line carrying
  the class census and the conscious rulings it restates. A named boundary, not an open door:
  any *third* class of code-authored session-facing prose remains a P15 defect.
- **AGENTS.md**, the prompt-copy navigation line: "src/prompt.ts and src/prompt-plan.ts only
  assemble data" is corrected to name the two classes (the dishonest line was the finding's one
  measured harm); the formulation-task navigation line gains 0221 in its plans pointer list.
- **docs/structure.md**, the Prompt assembly row: "all copy lives in `templates/prompts/*.md`"
  gains the same boundary clause.
- **The census sites carry the pointer** (comment-only, no behavior): `verifyPlanCharterText`,
  `scriptViolationLine`, `closedPrerequisiteNotes`, `renderFormulationTodo`, and
  `FORMULATION_CHARTER` (formulate.ts — the same grammar-teaching class, enumerated into the
  census honestly though the finding names it only through its family note).
- **A docs ratchet pin** (the 0216 D3 pattern — the single-owner line read by test): a test
  asserts P15's statement in principles.md carries the boundary sentence and AGENTS.md's
  prompt-copy line names the two classes, so the next drift of either — a wording edit that
  drops the carve-out, or a new navigation line that reclaims the totality — goes red.

Re-read standing: **0095 D4** (the formulation assembly stays code — its "Stage 1" reservation
is discharged by this ruling's explicit answer, not by a later re-templating), **0053 D16** and
**0083 D11** (the driver-text rulings stand, now under P15's named boundary instead of beside
it), **0080 §8** (the scoped-out feedback strings are the same class, named), **0100 D11** (the
lead-in's key id is audit grammar). None is overturned; the premise drift the record named —
rulings that made code-authors-copy decisions while P15's letter claimed totality — is resolved
in the constitution, which is where it lived.

## Derivation and Category scope

Derives: P15, P12, P13, P7, P5, P10, P19, P21. P15 shows in the letter amended to state its own
scope and in the pack-carried policy channels the boundary protects; P12 shows in the deferred
bundle failure pulled to the parse's own loud moment; P13 shows in the zero-vocabulary change
and the constitution/navigation/ratchet lockstep; P7 shows in the grammar teaching kept under the
driver's single authority; P5 shows in the one validator home the parse calls; P10 shows in the
clean-bundle and no-overlay floors byte-identical; P19/P21 show in the by-design arm's refusal
of an unconsumed template surface. Amends: **P15** (the statement and derivations gain the named
renderer-owned boundary — the principle's scope stated, not its direction changed). Tier:
mechanism (the bundle parse's validation moment — src behavior) + constitution wording (P15's
letter).

### Category scope

- **Code homes**: `src/bundle.ts` (D1 the nested validators in `parseIntentBundle`);
  comment-only D2 pointers in `src/intent/guarantees.ts`, `src/prompt.ts`, `src/prompt-plan.ts`,
  `src/formulate.ts`.
- **Test homes**: `test/bundle.test.ts` (D1's malformed-body rows — malformed assert line,
  unknown phase qualifier, bad `verify-plan-*` key, malformed lane row — plus the positive
  own-vocabulary row and the shipped-family census arm), `test/prompt-template.test.ts` (D2's
  docs ratchet pin), `test/provenance.test.ts` (one fixture repaired in the same lockstep: the
  older-binary simulation's invented `verify-plan-OLD` key re-spelled to the historically real
  legacy letter `verify-plan-t` — an invented key is a strict parse error since D1, and the
  letter spelling is the true historical form the simulation meant).
- **Documentation homes**: this document, `docs/principles.md` (P15's statement, derivations),
  `AGENTS.md` (the prompt-copy and formulation-task navigation lines), `docs/structure.md` (the
  prompt-assembly row), `plans/INDEX.md` (the 0221 row).
- No config key, no exit code, no event vocabulary, no document grammar, no template registry
  and no bundle vocabulary changes. The two refusal surfaces D1 can produce are the existing
  validators' own messages at an existing exit path.

premises this ruling changes: none — 0079 §3's "a refused parse writes nothing" is enforced on
one more class of malformed piece (its own letter, the nested grammars being pack pieces the
per-surface parser alone could not judge); 0220 D3's optional-templates design is consumed as
designed (its "omitted = the template half unchecked" arm is the bundle boundary's own shape);
0095 D4, 0053 D16, 0083 D11 and 0080 §8 are re-read standing, their premise drift resolved by
the P15 amendment rather than by amendment of any of them.

## Residuals (named)

- An assert's *template* target stays unchecked at bundle parse (no library exists there); a
  bundle pack naming a typo'd template materializes clean and fails at the project's first
  preflight — the split 0220 D3 ruled, now stated as the bundle boundary's letter.
- A bundle pack asserting on a phase type the bundle does not declare is refused at parse even
  where a pre-existing on-disk custom type would have made the qualifier live post-init (the
  self-contained-policy bound, D1).
- A retired-name prompt overlay (a stale `phase-plan.md` under `.opencode/auto/prompts/`) still
  loads silently as a never-rendered library addition — the standing additions posture (0220's
  residual names the vacuous-assert half); no refusal is added for retired names.
- `scriptViolationLine`'s head arm ends by restating the observation rule the `test-result`
  template's violation block also carries — deliberate-looking reinforcement in two homes;
  wording-level, byte-identical, left alone.
- The charter join's lead-in sentence and `FORMULATION_CHARTER`'s acceptance prose stay code as
  the grammar-teaching/serialization classes name — reviewing them means reading src, the P15
  cost the boundary accepts; the pins (prompt suites, goldens) hold their bytes.
- A vacuous-assert census for project packs (as opposed to shipped bundles) remains unbuilt —
  0220's residual, unchanged here.

## Verification

Filled by the step record (plans/0166-remediation/061-we-renderer-prose.md): typecheck, the
full auto-core suite, and the fail-before proof over the pre-fix sources (/tmp/061-fixed).
