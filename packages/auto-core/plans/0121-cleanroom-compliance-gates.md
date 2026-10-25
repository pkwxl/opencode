# 0121 — the cleanroom compliance gates: the output half of the clean room

The two-room wall the cleanroom bundle ships is an **input cut**: spec notes are the only channel
reference content may lawfully cross, and every later session works from the notes, the brief and the
planning input alone. The person's review brought the complementary framing (adversarial compliance /
constrained negative synthesis, motivated by the aster-mig posture — a Rust/MPL-2.0 re-derivation of a
GPL C codebase): compliance held by upstream access control alone is only half a clean room. The other
half is **output gates** — checks that make transliteration fail even when leakage happens, by forcing
heterogeneity at four places:

1. **paradigm** — the deliverable is written in the target language's own constructs; the reference's
   idiom families cannot survive the paradigm-constraint suites nor the audit's conformance eye;
2. **divergence** — a similarity scan of the deliverable against the reference corpus, a gate that
   flags structural isomorphism the way CI flags a suspect PR;
3. **impedance** — the spec notes and the platform contract are worded so the reference's substrate
   vocabulary never reaches the implementing sessions at all;
4. **contract-first** — behavior is derived from stated contracts and invariants (property suites,
   model definitions), never from imitation of internal practice.

Every instrument lands on seams that already exist: test lanes (0096/0098), the guarantees charter and
its asserts (0080), phase duty text, the `Depends:`/`Artifacts:` grammars, the audit's
dimension-per-findings-document shape (0120), committed receipts. **No src change, no new phase type, no
new grammar.** The wall stays primary — gates are bounded instruments with gameable thresholds, and the
input cut is both cheaper and legally load-bearing; a gate is never argued as license to weaken the wall
(P12).

The draft then went through the person's review rounds (2026-10-25: two external model reviews, a
comprehensive review of the revised draft plus an adjacent marker proposal, and the Claude review);
the load-bearing refinements are woven in below and their full dispositions recorded before the
execution schedule. The shaping ones across the rounds: the gates are risk screening, never proof
(D1); the similarity metric cuts both ways — no artificial divergence, justified similarity on the
record (D6); the dirty side has an owner — the compliance monitor, the notes-side scan, band-shaped
receipts, the physical tooling wall (D5); remediation directives carry their reasoning, stay
source-free, and never target a score the sessions cannot see (D10); coverage runs in both directions
— contracts must cover the specification, not only the implementation its contracts (D8); contract
immutability is served by recorded revisions and citations, not by a lockout mechanism (D8, D11).

This ruling Derives: **P7** (grammars, never content — the showing: the driver runs declared suites and
parses receipts, but every judgment above — paradigm conformance, vocabulary hygiene, contract adequacy,
justified similarity — is authored as pack/duty text and judged by sessions, the audit and the person,
never by driver code), **P12** (fail loud; conservative under uncertainty — the divergence instrument is
staged from cheap high-precision proxies, thresholds strict on identifiers and loose on structure, a
score is evidence and never the thing measured, and the wall is never traded for the gate), **P15**
(policy is data — all four dimensions' judgment content rides the bundle templates and the materialized
pack overlay, never code), **P16** (genericity — the shipped templates name no language, toolchain or
project, and assume no environment: not a source or target language, not a language pair, not a
reference or destination project — the C→Rust / Linux→Asterinas posture is the motivating field case
and the first consumer, never a shape any shipped artifact carries; the target's materialized overlay
declares its own suites, instruments, thresholds and exclusions after `init --intent`),
**P19** (measured evidence — the staged instrument and the deferred per-unit
granularity are revisit rules with named triggers, ruled before the field data exists, not speculation
built anyway), **P21** (machinery waits for its consumer — no similarity engine, no core gate, no
lockout; every consumer of the existing seams is present in the same change), **P2** (the person
brackets every boundary — the showing: the only exits from a red divergence receipt are a genuine
re-expression or a person-declared exclusion on a committed surface with its recorded reason; no
agent-side waiver exists anywhere in the pipeline), **P8** (deliberate enforcement moments — the
showing: scans and audits record scores and findings; blocking stays at the stops that already exist,
the verdict gate and the phase-close hold, and the exemption path is a person's declared surface, never
a runtime override), and **P18** (the record outlives the tool — the chain of custody is the committed
receipts, findings documents, justification records and verdicts the existing machinery already
produces). Tier touched: **data and prompts** (bundle/mode/phase templates, guarantees text and
asserts, tests); no principle change; the INDEX release cell stays open until the next release event.

## D1 — the second half: gates beside the wall, never instead of it

The charter's wall rule is unchanged and remains the first line. What changes is that the cleanroom
bundle stops relying on the wall alone: the phases' duties, the lane table a project declares, and the
audit's dimensions together make a transliteration **less likely to survive and more likely to be
caught** — the paradigm suites reject its known idiom families, the divergence receipt flags its
structural indicators, the platform contract refuses its interfaces, and the contract-first ordering
removes the thing to imitate, the derivation target being a stated contract rather than the reference's
shape. The claim stops there, deliberately: this is risk reduction and the detection of *known*
indicators of non-independent implementation, never prevention — a control flow can be carried over
under renamed identifiers, module divisions and state-transition logic can survive beneath safe
target-paradigm syntax, and some of the reference's shapes are rational in the target too, so the
gates do not exhaust the ways to transliterate. What the chain can honestly claim is what it enforced,
what it found, and how each finding was disposed — never the proven absence of transliteration. The
wall is the input cut; these are the output cut; defense in depth. Nothing in this document may be
cited to narrow the wall, and a widening anyone wants stays the person's ruling (the charter's
existing widening rule).

What the gates are not: **proof**. Risk detection, clean-room independence and behavioral correctness
are three goals, each with its own evidence chain — the scans' committed receipts screen for the first
and feed the second's record (beside the wall and the justification records), while only the
verification loop — contracts, property suites, black-box acceptance — establishes the third. A green
divergence receipt is the absence of a flag, never a correctness verdict, and never by itself the
independence story a dispute would rest on. The three chains do not deduce one another: no similar
code found is not no leakage; idiomatic target code is not independent design; passing tests is not
covering what was never specified; and behavioral correctness settles no license question — specific
obligations take their own evaluation, beside the record. What ships with the code, then, is the
evidence collection itself — behavioral, design, process, detection and audit records, P18's shape —
and the collection exists to strengthen review, never to replace it.

Derives P12 (conservative under uncertainty), P19 (each gate is bounded and staged, its threshold a
declared project fact, not a shipped constant).

## D2 — impedance installed upstream: spec-notes vocabulary hygiene

The cheapest place to force re-conceptualization is ahead of the implementing sessions: if the
specification notes never carry the reference's substrate vocabulary, downstream sessions cannot
pattern after it. The spec-read hygiene (observable behavior only — no private names, no internal
structures, no translated code) gains its fourth clause: **no infra-shaped vocabulary** — concepts
named for, or carried over from, the reference's substrate structures. Behavior is stated as observable
contracts at the boundary, in the target platform's terms. A note that can only be understood by
someone who knows the reference's internals is leakage, and the audit's spec-hygiene dimension treats
it as a finding. The clause's target is the concept, not the word: `scheduler`, `queue`, `lock`,
`buffer` are domain-natural names a target needs regardless, and nothing is suspect for sounding like
infrastructure — what the clause forbids is vocabulary whose meaning hangs on the reference's
particular internal organization. The audit judges smuggled organization, never term matching.

D2 gains D4's mechanical/judgmental split: the driver-side scan runs on the notes themselves at
spec-read close (D5), where any of the reference's *private* identifiers in a note is a hard finding —
public specification names are the notes' lawful vocabulary — and a hit is cheap to fix at the source:
the same leak found in the deliverable three phases later is rework across every unit built on the
note. The spec-read room may be told the colliding identifier outright (it reads the reference
lawfully); the committed receipt carries counts and note ids alone — a reference identifier never
persists in any session-readable document.

Files: `templates/bundles/cleanroom/phases/spec-read.md` (the duty text), the pack's `### spec-read`
phase-duties block (`templates/bundles/cleanroom/intents/cleanroom.md`), one hygiene sentence in
`### verify-plan` (the charter's extraction-hygiene enumeration), and a pinning assert (drafted anchor:
`phase-plan(spec-read): must "the target platform's terms"` — finalized against the wording at
execution; asserts are ratchets on the text, text first, then the pin).

Derives P7 (the judgment is duty text judged by sessions and the audit, not a driver scan), P15.

## D3 — the platform contract and the design re-expression duty

The brief (proposed by the survey, approved by the person) gains a declared **platform contract**: the
target platform's own abstractions the deliverable must build on — its execution model, its
memory/isolation discipline, its interface shapes — with the standing rule that the reference's
substrate shapes are unavailable, and structures derived from them are defects, not defaults. The
design duties then require, per concern, that the design document name the target construct chosen
**in place of** the transliterated shape; and where the specification's behavior was expressed by the
reference in terms of infrastructure the platform forbids, the **re-expression** — restating that
behavior in the platform's model — is its own named design-document section.

Re-expression is demanded where the platform provides a materially different or better abstraction —
never everywhere a difference could be manufactured: a shape that is also the rational design in the
target is kept and justified (D6's rule), not mangled for difference.

Files: the pack's `### d design` block, one paragraph in `modes/cleanroom.md` `## exec` (the session-side
boundary text), and the survey's proposal duty (wave 4 adds the declaration line the person
approves). Shipped text stays generic: "the target platform's declared interfaces"; which interfaces is
the brief's content, the target's own surface (P16).

Derives P15 (the contract is brief/duty data), P16 (no platform facts in shipped templates).

## D4 — the paradigm boundary: lanes for the mechanical half, charter for the judgmental half

Two halves, different homes:

- **Mechanical** — a *paradigm-constraint* lane row in the test-lane table the project declares: the
  target language's safety and forbidden-construct checks (the lint/forbid family), one cheap lane with
  a committed receipt, part of every implementation task's wrap-up lane set. The shipped bundle names
  the row's *shape* and says the pack overlay declares the command; it names no toolchain (P16).
- **Judgmental** — charter and duty text: the deliverable is written in the target platform's paradigm;
  the reference's own idiom families — whatever its paradigm's are, named by the project's duty text
  in its own terms (an imperative reference brings manual shared-mutable aliasing, cascade error
  unwinding, bitflag state machines, blocking synchronization; a different paradigm brings its own
  families) — must be re-expressed in the target language's native constructs; and the audit carries a
  **paradigm conformance** dimension (D9) whose findings read reference-idiom fingerprints in the
  deliverable. The demand is re-expression in the platform's terms, never difference for its own sake —
  D6 bounds this duty from the other side.

Files: the pack's `### d design`/`### m implementation` blocks, `modes/cleanroom.md` `## exec`, the lane
table (D7), the audit dimensions (D9), and a pinning assert (drafted anchor: a `must` pin on the
paradigm-boundary phrase in `whole`/`subtask` or `phase-plan(d)`, finalized at execution).

Derives P7 (the split itself: what a linter can check runs as a lane; what a linter cannot check is
judgment, authored as text), P15, P16.

## D5 — the divergence scan is driver-side: a regression-cost lane, the corpus never session-rendered

The similarity scan needs **both sides** — the deliverable and the reference — so it can never run
inside a clean-room session. It is the compliance monitor's instrument, and in this architecture the
monitor role belongs to the driver side of the wall:

- Declared as a **`Cost: regression`** lane row. That cost class already means: the driver alone runs
  it, in the background between units against committed trees, once more at phase close, with
  round-scoped receipts — and the phase cannot complete while the receipt is red (0098's two-level
  pass). A red receipt blocks; what it *means* is adjudicated (D6).
- **The corpus location and the comparison tooling are driver-owned and outside the platform
  boundary.** The lane table renders into session prompts (`{{laneTable}}` in whole/subtask/fanout), so
  the divergence row's `Command:` is a bare target name (`make divergence-scan`,
  `./scripts/compliance.sh`) whose implementation holds the corpus path — classified in the charter as
  driver-side compliance tooling: clean-room sessions never read or execute it. The wall is physical,
  not merely textual: the tool, its configuration and the corpus live outside the session-visible tree
  (a driver-side repository or path); the worktree carries at most a bare stub that invokes the
  driver-side location and names no corpus path inline; and the target-side acceptance checks
  reachability — nothing readable from the worktree opens the corpus. A corpus path in any
  session-rendered surface is a wall breach by the gate meant to enforce the wall.
- **The dirty side has an owner.** Comparing the deliverable with the reference needs someone who may
  see both, and no clean room can: the audit judges whether a justification record is an adequate
  design argument, but cannot confirm the flagged similarity is really the protocol-mandated or
  rational kind the record claims; a clean reader cannot see notes organized after the reference
  either. The charter names the role — the **compliance monitor** is the person or a driver-side
  designate they name (traditional clean rooms' monitor; the person already holds it de facto through
  the exclusion power) — and splits the adjudication: the audit judges the target-side rationale, the
  monitor confirms what kind of similarity was flagged.
- **The notes are scanned too.** The instrument's cheap half runs on the specification notes at
  spec-read close, before contamination spreads (D2's mechanical half) — a note-side hit costs one
  edit; the same leak in the deliverable costs rework across every unit built on the note.
- **Receipts are band-shaped, and re-scans are capped.** Source-free is not yet leak-free: over
  repeated rounds, receipts would teach the clean side which deliverable names collide and which
  structural changes move a number — an oracle into a reference it never read. So session-rendered
  receipts and directives name the flagged unit and never the colliding symbol; sessions see coarse
  risk bands, the exact values staying driver-side for the person and the monitor; and a unit's
  re-scans are capped (the cap a declared project fact) — past it, the next red escalates to the
  person instead of opening another fix loop (bounded escalation, P2). A session cannot chase a
  number it never sees: D10's anti-score rule becomes mechanical, not aspirational.
- **Screening, not verdict** — a score is a risk flag that triggers adjudication, never an automatic
  plagiarism verdict: similarities can originate in public interfaces, protocol-mandated sequencing,
  shared mathematical constraints, hardware fact, or independent derivation. The tool's declared
  configuration (behind the pack row's bare command) excludes what is public or protocol-mandated by
  declaration; what remains flagged flows to the audit's independence dimension as a finding carrying
  its justification record (D6). The only exits from a red receipt are two: a refactor that genuinely
  re-expresses, or a **person-declared exclusion** on the committed surface with its recorded reason —
  there is no agent-side waiver, and the audit adjudicates but cannot green the lane. An exclusion is
  a **bounded, reviewable scope** — a declared public interface, a named symbol set, a
  protocol-mandated sequence — never a broad silencer: a whole-directory exclusion that greens the
  scan is itself an audit finding, and every exclusion's scope, reason and impact read from the commit
  that declares it (declaration discipline plus an audit duty, no new tooling). Exclusions are written
  in **target-side terms only** — deliverable paths, unit ids, public specification identifiers — so
  the list commits in-tree, harmless to clean-room eyes and auditable forever while the
  corpus-bearing configuration stays out-of-tree; and every entry's reason cites the justification
  record id that earned it, the two lists one-to-one (D6).
- **Staged instrument (P19):** v1 is cheap and high-precision, and its menu is chosen for the
  language pair the project declares — no pair is assumed. The cross-language default:
  private-identifier matching, with the matching method declared in the tool configuration (a minimum
  length, compound names only, or rarity weighting — common names never flood it into broad
  exclusions), plus **literal fingerprinting** (string literals and error-message text, unusual
  numeric constants, lookup-table contents, the ordering of a type's variants or fields where the
  languages carry such types — strong copying indicators, language-independent and cheap to compute;
  protocol-mandated constants excluded by declaration citing the specification). A same-language pair
  may declare token-shape or structural instruments instead — whichever is high-precision for the
  pair it names. v2 structural similarity; cross-language AST/CFG distance only if field evidence
  demands it. Thresholds, matching methods and exclusion lists are declared project facts (the tool's
  configuration): strict on names, loose on structure.
- **Receipt granularity starts round-scoped** (the regression lane's own shape). Per-unit divergence
  feedback is deliberately deferred (D11).

The receipts under the regression lane's round-scoped home are the divergence half of the chain of
custody (P18): each records the flagged unit ids, the risk band (the exact value driver-side, the
anti-oracle rule above), the tool's name and version, the target-side scope, and the corpus identity
as a hash or version — never a path. Reproducible from the recorded line alone, **for the driver**:
only the driver side holds what the line names, and that is the point. The full comparison context
stays driver-side with the corpus (D10's source-free rule).

Derives P12, P19, P21, P18, P2, P8.

## D6 — the metric cuts both ways: no artificial divergence, justified similarity on the record

A similarity gate goodharts in both directions. Downstream, transliteration slips through; upstream, a
session graded against a similarity score learns to obfuscate — mangling a rational design to shave
points off a number, buying its difference with complexity, performance loss or new error paths. Both
are defects, and the charter says so in one breath: structural resemblance to the reference beyond the
specified contracts is a defect (the charter's existing rule), and divergence manufactured to lower a
score is the same defect wearing the other coat. The principle in one line, running through D2–D4 as
much as here: **what is prohibited is structural inheritance without independent justification, not
the coincidental alignment of rational designs; what is required is target-platform adaptation, not
manufactured difference.** Three layers hold the line:

- **behavior** — specified external behavior and invariants are preserved; semantics are never altered
  to manufacture structural difference;
- **architecture** — target-platform abstractions are adopted where the platform provides a materially
  better fit; a standard pattern that fits the target substrate is not discarded merely for resembling
  the reference;
- **implementation** — substantive design choices are independently derived; structural similarity that
  is unavoidable — protocol-mandated sequencing, shared mathematical constraints, hardware fact, or the
  shape that is simply the rational design in the target too — is **justified in the task documents**,
  and the audit's independence dimension adjudicates the justification records, never the score alone.

The justification record is the evidence layer (the person and the audit read it); the gate layer
greens only through the tool's declared configuration — a committed surface edit — or a refactor. A
record's weight follows when it was written: the strong form is the design-time rationale D3's duties
already demand (the design document naming, per concern, the target construct chosen); a justification
written after the flag has the shape of a rationalization, and the audit reads commit order to tell
them apart. The linkage is explicit — a justified similarity greens only through an exclusion, so
every accepted justification becomes an exclusion entry whose reason cites the record's id: the two
lists stay one-to-one, and neither grows a silent member. A remediation directive inherits the rule:
it demands re-expression against a contract in platform terms (D10's grammar), never divergence as
such.

Derives P12 (a metric is evidence, not the thing measured), P7 (adjudication is judgment — the audit's,
from records), P8 (detection records; the disposition moments stay where they are).

## D7 — the lane table ships as the floor, declared by the project

The pack gains a `### test-lanes` subsection under `## quality` — **comments-only in the shipped
bundle** (a comments-only section is the byte-identical zero-intent floor, 0080's optionality
precedent): a project that declares no lanes is unaffected, and the shipped comments carry the example
rows that teach the shape —

- `build` (cheap), the *paradigm-constraint* suite (cheap), the *property* suite (cheap smoke; the
  proof-class run an anchor), the *divergence* scan (**regression**, its Command a bare target name —
  D5's shape), and the acceptance anchor. A task's `## Acceptance` names its anchor row (existing
  rule).

Real commands are per-project: the person fills them in the materialized pack after `init --intent`.
The survey proposes the declarations (the lane rows, the corpus location, the platform contract) as
part of its environment facts and its `## Project brief` proposal — the fork the person approves; the
person installs the rows into the materialized pack (pack edits are the person's; `sync` carries
upstream duty-text changes, provenance's own channel).

Files: the pack's `### test-lanes` (comments), `phases/survey.md` (the proposal duty),
`modes/cleanroom.md` `## init` (naming the declarations a cleanroom project owes), and a bundle-test
pin that the shipped cleanroom pack's lane section parses to the floor (`parseTestLanes(pack)` is
`undefined`) while the section's commented examples name the five rows — and that the example rows,
uncommented into a scratch pack, parse with the divergence row a regression-cost row carrying a bare
command.

Derives P10 (the floor: unset declarations change nothing), P16 (no toolchain words shipped), P13 (no
new grammar — the lane table is 0096's, used as declared).

## D8 — contract-first: structure it with existing grammar, no new machinery

No implementation before its contract exists — expressed with surfaces that already exist:

- **Design-phase artifacts become contracts**: each design item's artifact is a contract document plus
  its stated properties/invariants in the framework the pack overlay names — property suites as the
  in-pipeline instrument, model definitions/checking as a named option. Shipped text says "the declared
  property framework"; which framework is the overlay's content.
- **Ordering via `Depends:`** — an implementation item depends on the contract artifact it implements;
  the dependency fields and the formulation's obligation ledger carry the rule as authored duty text
  (the design duties say it; the planner writes the fields). No new gate, no new phase type.
- **Property suites are lanes** (D7's rows): the wrap-up verification loop and the two fix rounds
  exercise them with receipts, cheap smoke before the proof-class anchor.
- The `### m implementation` duties add: a vertical slice cites the contract (and the property that
  proves it) it satisfies; `### decompose` and the self-check blocks say the same at their level.

Two refinements from the review round, landing as authored text: **property assertions derive from the
stated contract, never restated from the implementation they sit beside** — a property changed to match
observed behavior is a contract revision, not a test fix; and **a contract revised mid-implementation
is a recorded change** — its reason in the task documents, its commit order the evidence (the
contract's commit precedes the implementation's), which is exactly what the audit's contract-coverage
dimension reads when it checks the loop ran the right way round. Commit order breaks under squash or
rebase, so the durable form is the citation: each implementation task's document records the commit
SHA of the contract it cites — cheap, and it survives history rewrites; the audit reads the SHA
citations first, commit order as corroboration. The reviews also proposed a read-only
lockout on contract artifacts enforced at runtime; declined — the driver cannot judge an edit's intent
(P7) and git history already is the evidence (P18); D11 records the disposition. The verified/unverified
disclosure the reviews asked for is already the shipped charter's standing rule (`###
verify-plan-test`/`### verify-plan-audit`: the assessment distinguishes verified, failed, blocked and
deferred) — no change.

Coverage runs in both directions, and the audit's coverage dimension judges both:
implementation-covers-contracts (every delivered behavior maps to a stated contract) and
**contracts-cover-the-specification** (every behavior the specification notes and the brief's MUSTs
name is carried into some contract, or explicitly deferred with its record) — without the second,
contract-first only ever proves the faithful implementation of whatever happened to be written down.
Sufficiency splits into three layers, each the duty of an existing home: specification sufficiency
(the notes cover the behaviors the target must keep — the spec-hygiene dimension), contract
sufficiency (each requirement becomes a verifiable contract — the design duties), verification
sufficiency (the suites cover each contract's properties, boundaries and failure paths — the test
plan). And a recorded contract revision states its kind — a **clarification** of the specification
(an omission or defect found and corrected) or an **accommodation** of the implementation (the
contract bent to what was built) — the audit reads the kind, and an accommodation without a
justification of its own is a finding.

Derives P3 (the derivation target is a stated contract, and verification is the property suite plus
black-box acceptance — never resemblance), P6 (contracts are re-derivable durable evidence; the ordering
rule adds no persisted state), P21 (no new mechanism; every consumer present).

## D9 — the audit grows two dimensions and one carve-out

`phases/audit.md` and the pack's `### audit` duties extend the dimension list (each dimension its own
task, its findings in its own `docs/T-NNN/findings.md` — 0120's one-writer rule):

- **paradigm conformance** — the deliverable reads in the target platform's paradigm;
  reference-idiom fingerprints are findings (D4's judgmental half);
- **contract coverage** — every implemented behavior maps to a stated contract/property and the
  property suite is the acceptance instrument (D8's judgmental half); the dimension reads the revision
  records and commit order when a contract changed mid-implementation.

The independence dimension gains its adjudication duty: beside the divergence receipts it reads D6's
justification records — a justified similarity is accepted with its record, an unjustified one is a
finding; the score is never the verdict. The labor splits with the compliance monitor (D5): the audit
judges whether the record is an adequate design argument; the monitor — the person or their
driver-side designate — confirms what kind of similarity the flag actually names; the audit's half
never needs the corpus. `### verify-plan-audit` gains the contract-coverage
requirement and the **one carve-out** to its "re-run, never cite" rule: driver-run divergence receipts
are cited and adjudicated, never re-executed — audit sessions are clean rooms; they never see the
corpus, and the divergence lane is the single class of evidence the audit takes on the driver's record
(the receipt's scores and directives, D10's source-free shape). A pinning assert drafts as
`phase-plan(audit): must "paradigm conformance", "contract coverage"`, finalized at execution.

Derives P3 (the audit is the fresh-eyes adjudicator; its verdict follows the findings), P8 (blocking
stays where it already lives — the verdict gate and the phase-close hold; detection records findings).

## D10 — source-free findings: the remediation channel cannot launder the reference

The fix loop feeds failure text back into clean-room sessions. If a divergence finding quoted reference
code, a diff, or a close paraphrase, the remediation channel would carry GPL structure back into the
clean room — the gate breaching the wall it guards. The rule, authored into the pack (no new subsection
name, P13 — it rides the existing blocks): compliance findings — divergence receipts, fix directives,
audit findings that cite divergence — **name ids, scores and structural directives only**, never
excerpts, diffs or paraphrases of either side. The scope includes **the person's pen**: whatever the
person writes into session-visible surfaces — brief approvals, pack edits, exclusion entries, answers
relayed into task documents, review comments — obeys the same rule; the person sees both sides and
holds the exclusion power, and is therefore the most likely carrier, precisely because the wall
trusts them. And source-free is necessary but not sufficient: a source-free channel can still teach
the reference's shape one collision at a time, which is why receipts are band-shaped and re-scans
capped (D5).

But a bare transform ("recursion → iteration") invites the mechanical shuffle the reviews warn about —
a syntax change that leaves the copied shape underneath, or degrades a sound design to move a number.
So a remediation directive carries three parts, all source-free:

1. **the finding** — the target unit/function id, the risk class, the risk band (the exact value
   stays driver-side, D5's anti-oracle rule);
2. **the required reasoning** — the design decision to re-evaluate, cited by its own surfaces: the
   contract id the slice claims, the platform constraint in the target's terms, the paradigm rule
   invoked — never reference content;
3. **the acceptance** — the behaviors, invariants and suites that must hold unchanged and be re-run
   (the property suite, the acceptance anchor, the divergence scan) when the refactor lands.

Example shape: "unit U-042, structural-similarity risk: re-evaluate its state flow against the contract
its slice cites, in the platform's native control-flow and resource idioms; the contract's state
invariants and its property suite must hold and re-run; do not alter required semantics to lower the
score" — the last
clause standing, D6's rule in the directive's own mouth.

The directive names what to re-argue, never the transform to apply: the scanner knows a risk sits at a
unit, not whether its cause is unjustified inheritance, a public protocol, or a rational shared
design — so the fix task's acceptance is the ordered re-argument (re-examine the contracts the unit
claims → re-argue the design against the platform's abstractions → change the design where the
argument fails, never a syntax swap alone → re-run the property suite, the acceptance anchor and the
scan → record the justification of any residual rational similarity), and **a lowered score is not an
acceptance condition** — the score says whether the risk moved, and endless score-chasing refactoring
is the failure mode D6 exists to prevent. Two questions close the design: does the directive carry
enough for a session to complete the redesign independently, with no reference internals needed? and
does the repaired unit still satisfy its contracts, with a design justification of its own? Both yes,
and D10 is an executable independent-redesign mechanism, not only an anti-leakage rule.

Files: the three-part diet in `### repair` (the fix task's finding vocabulary), the divergence-receipt
sentence in `### verify-plan-audit`.

Derives P7 (a rule about what findings may carry, not what code may do), P13 (no new grammar; the rule
is charter text), P12 (uncertain readings resolve toward not-carrying).

## D11 — deliberately not done (recorded as cost, with revisit triggers)

- **No core/src change.** Every consumer of the seams this document uses exists in the same change
  (lanes, gates, asserts, duty text). A similarity engine, a threshold constant, a `forbid` rule in
  driver code would each be a P16/P21 violation with no consumer the seams lack.
- **No read-only lockout on contract artifacts** (proposed in the review round). Replaced by recorded
  revisions with reasons and commit-order adjudication (D8): the driver cannot judge whether an edit is
  a retrofit or a correction (P7), no new protection surface is built for a threat git history already
  evidences (P18, P21), and a hard lockout would block the honest correction path the charter already
  provides (recorded deviation).
- **No runtime waiver/override mechanism for divergence findings.** The exemption path is the person's
  declared exclusion on the committed tool configuration — visible in git, auditable forever (P2, P8,
  P15); an in-pipeline override would be an agent- or session-side widening of exactly the boundary
  this document exists to narrow.
- **No `CLEAN-*` source-marker family.** The second review round also proposed an in-source marker
  protocol for leftover work and automated-decision records (`CLEAN-TODO`/`-DEFER`/`-RESOLVE`/
  `-DECISION`, with lifecycle and closure rules) as a complement to this ruling. Out of scope here and
  deferred to its own document, taken up when field evidence shows task documents plus the existing
  `AUTO-*` marker lines (self-contained per the process-references rule) failing to carry the
  justification and decision load. Two ties bind it whenever it comes: its markers obey the
  source-free rule (contract ids and platform reasoning, never reference internals), and a new marker
  family is a P13 vocabulary decision in conscious lockstep, never a bundle edit that grows one
  sideways. The proposal's own staging — protocol first, no tooling, validated in real rounds — is
  the P19/P21 route and is endorsed as the shape of that future document.
- **No in-repo synthetic end-to-end fixture suite** (proposed in the review round). The
  detection→blocking→directive→re-validation loop's blocking half is the regression lane's hold,
  already mechanism-tested (0098's suites); re-testing it under a differently-named row duplicates
  coverage. What is added instead: the wave-4 pin that the example rows parse (D7), and the
  target-side tool acceptance in the follow-up section — synthetic fixture pairs and the red-path
  smoke.
- **Per-unit divergence granularity deferred.** Round-scoped (the regression lane's shape) is v1.
  Revisit when aster-mig's v1 receipts show round-close rejections arriving late enough to cost a wave
  of rework (the measured trigger; P19). The fields the decision reads are already in the records —
  each red's first-discovery time, the tasks and rework inside its scope, recurrence after repair, the
  unit-level cost estimate — extracted from receipts and commit logs; no new data model.
- **No AST/CFG engine anywhere in this repo.** v1 is identifiers and literal fingerprints (the
  cross-language default; a pair may declare otherwise, D5); structural tools are
  the target project's own investment behind the bare command name. Revisit on v1 field evidence.
- **No language-pair or project assumption anywhere in the shipped artifacts** (the person's standing
  rule, restating P16 as each wave's test): every template line the waves write is worded for any
  source→target pair; where a ruling illustrates with an imperative-paradigm idiom family or a
  construct one language names specially, the shipped duty names the category and lets the project's
  reference paradigm supply the members, and the divergence instrument's menu is declared per pair
  (D5). The test per wave: a template line that only makes sense for one language pair, one toolchain
  or one project is wrong — aster-mig is the first consumer, never a shape the bundle assumes.
- **No `prompts/` (manual suite) change.** The manual suite reads the bundle duty text as the phase's
  authority (0120's channel) and carries no cleanroom-specific copy to extend; nothing here changes a
  manual-suite literal, so the manual ratchet is untouched.
- **No new pack subsection names, no protocol strings, no bundle.json change** (the phase list and
  `subtask: off` stand).

## Review rounds — dispositions

### Round 1 (2026-10-25, two external model reviews)

The load-bearing points and where each landed:

1. **Gates are not proof; three goals, three evidence chains** (both reviews) — accepted into D1's
   closing paragraph.
2. **Similarity scans are risk screening, not verdicts; an explicit exemption path** (both) — accepted
   into D5 (screening, receipt reproducibility) and D6 (adjudication); the proposed runtime override
   mechanism declined, replaced by the person-declared exclusion on the committed surface (D11).
3. **Separate target-native design from artificial divergence; justified similarity** (both) — accepted
   as D6, with the three-layer line and the justification records the audit adjudicates.
4. **Reasoning-carrying remediation directives** (both) — accepted as D10's three-part grammar; the
   source-free rule kept and made stricter about what the reasoning may cite.
5. **Contract immutability / read-only lockout, and precedence in the contract-first cycle** (Gemini;
   ChatGPT's loop-closing) — the precedence and independence halves accepted into D8 (properties derive
   from contracts; revisions recorded with commit-order evidence); the lockout machinery declined with
   the replacement recorded in D11.
6. **Synthetic end-to-end fixtures in-repo** (both) — declined as duplicating the regression-lane
   hold's coverage (D11); replaced by the wave-4 uncommented-rows pin and the target-side tool
   acceptance (synthetic fixture pairs, the red-path smoke).
7. **Verified/partially-verified/unverified scope disclosure in acceptances** (ChatGPT) — already the
   shipped charter's standing rule in `### verify-plan-test`/`### verify-plan-audit`; no change.

### Round 2 (2026-10-25, a comprehensive review of the revised draft plus an adjacent marker proposal)

1. **D1's "cannot land a transliteration" overclaimed** — accepted: D1 reworded to risk reduction and
   known-indicator detection, the non-exhaustiveness examples named, the claim restated as enforced /
   found / disposed, never proven absence.
2. **The three guarantees are non-deducible; keep them uncompressed, and the deliverable is the
   evidence collection** — accepted into D1 (the explicit non-deducibilities, the P18 evidence
   framing, and the restraint: an evidence chain settles no license question by itself).
3. **Exclusions must be bounded and reviewable, never backdoors** — accepted into D5 (a
   whole-directory exclusion is itself an audit finding).
4. **Repair must not target score reduction; detection must not dictate the remediation plan** —
   accepted into D10 (the ordered re-argument, a lowered score never an acceptance condition, the two
   closing questions).
5. **Contract sufficiency: bidirectional coverage, the three sufficiency layers, the
   clarification/accommodation revision taxonomy** — accepted into D8, as duties of existing homes
   (spec-hygiene, design, test plan, audit).
6. **D2's vocabulary clause targets internals-dependent concepts, not infrastructure-sounding
   words** — accepted as D2's sharpened caveat (the audit judges smuggled organization, never term
   matching).
7. **Target-side acceptance is a delivery condition, and the exclusion check must prove boundedness**
   — accepted into the follow-up section (an exclusion that also silences the benign fixture fails
   acceptance).
8. **The per-unit upgrade decision needs named metrics** — accepted into D11, drawn from existing
   receipts and commit logs.
9. **A cross-wave traceability matrix and the evidence-layers principle** — accepted into the
   execution schedule.
10. **The `CLEAN-*` marker protocol proposal** — out of scope, deferred with its ties recorded in
    D11 (P13 lockstep, source-free, taken up on field evidence).

### Round 3 (2026-10-25, the Claude review — approved with changes made before wave 1)

1. **No one owns the dirty side** — accepted into D5 (the compliance monitor named in the charter:
   the person or a driver-side designate; the adjudication split — the audit judges the rationale,
   the monitor confirms the similarity kind) and D10 (the person's pen under the source-free rule),
   with D9 carrying the split's audit half.
2. **Run the scan on the spec notes, not only the deliverable** — accepted into D5/D2 (the notes-side
   identifier scan at spec-read close; the spec-read room may be told the identifier, the committed
   receipt never carries one).
3. **Source-free feedback is still an oracle** — accepted into D5/D10 (band-shaped receipts, the
   colliding symbol never named to clean rooms, capped re-scans escalating to the person — the
   anti-score rule made mechanical).
4. **The tooling wall rests on text alone** — accepted into D5 (corpus, configuration and tool
   out-of-tree; the worktree stub names no corpus path; exclusions in target-side terms committed
   in-tree; reachability checked at acceptance).
5. **The v1 instrument is miscalibrated** — accepted into D5 (a declared matching method instead of
   per-symbol exclusions for common names; literal fingerprinting replacing token-shape overlap —
   language-independent and cheap).
6. **Justifications written after a flag are weaker evidence** — accepted into D6 (commit-order
   weighting; every accepted justification one-to-one with its exclusion entry) and D8 (contract SHA
   citations surviving squash/rebase).
7. **Wave 1 was not one ingredient** — accepted: the schedule splits it (six waves), and the
   repair-diet pin is noted as exercising nothing until the lane wave lands.
8. **Receipt fields** — accepted into D5 (target-side scope; the corpus identity a hash or version,
   never a path; reproducible for the driver alone).

## Execution schedule (six waves, one session each, always green)

Sequencing discipline: one ingredient per wave; asserts and their text land in the same wave
(lockstep, P13); each wave ends green and interruptible; the person commits at the wave boundary.
Every wave runs the P16 test on what it wrote (D11): a template line that only makes sense for one
language pair, toolchain or project is wrong — the implementation is universal, the field case
merely the first consumer. This document and its INDEX row landed ahead of the waves (the ruling
commits, the same-change rule satisfied there); the six text waves land separately. Tests after any
template/prompt change, per the package conventions: `bun typecheck`, then `bun test` — at minimum
`test/prompt-exec.test.ts
test/prompt-phase.test.ts test/prompt-template.test.ts` plus each wave's named suites; the shipped
bundles' self-ratchet renders the pack through its own asserts, so a new pin that outruns its text
fails immediately.

Evidence has layers, and no wave is asked to prove them all: prompt asserts prove a rule was not
deleted; parse tests prove the grammar and the floor; the target-side smoke proves blocking, exclusion
and repair actually engage; only real rounds' receipts prove field behavior. Each wave adds its layer,
and wave 6 checks the correspondence across this matrix — an execution and acceptance checklist,
never a mechanism:

| core requirement | primary homes | closing evidence |
|---|---|---|
| reference isolation | the charter's corpus clause, spec-read hygiene, D5's driver-side tooling rule | the wall pins (round 1); the target smoke's corpus-never-rendered and corpus-not-reachable checks |
| platform adaptation | the brief's platform contract, the design duties, the mode's exec text | the design docs' per-concern construct naming; the audit's paradigm dimension |
| contract-first | the design duties, `Depends:` fields, the implementation duties | contract-before-implementation commit order; the audit's contract-coverage dimension |
| similarity risk handling | the lane table, receipts, repair, audit | red-blocks-close and bounded-exclusion checks (the target smoke); the source-free directive pins |
| independent audit | the audit dimensions, findings documents, verdict | the round-2 dimension pins; the verdict gate, untouched |

**Wave 1 — the wall and hygiene clauses (D1, D2, D5's corpus/tooling/monitor clauses).**
`templates/bundles/cleanroom/intents/cleanroom.md`: the `### verify-plan` corpus-and-tooling clause —
the compliance monitor named (the person or their driver-side designate), the corpus, configuration
and tooling physically out-of-tree with the worktree stub naming no corpus path, the notes-side scan
at spec-read close — all in D1's risk-reduction framing; the extraction-hygiene fourth clause
(infra-shaped vocabulary, the concept never the word).
`templates/bundles/cleanroom/phases/spec-read.md`: the
vocabulary-hygiene duty. Asserts: the D2 pin plus a pin on the corpus clause. Green: full `bun test`
(the boundary-sentence pin in
`test/charter-clamp.test.ts` is untouched — additive sentences after it; `test/intent-guarantees.test.ts`
anchors unchanged).

**Wave 2 — the metric and repair charter text (D5's screening/band/cap sentences, D6's charter
sentences, D10).**
The pack's `### verify-plan` two-sided metric sentences (screening never verdict; artificial
divergence the same defect; bands not values; re-scans capped with escalation to the person); the
`### repair` source-free three-part finding diet with the person's-pen sentence. Asserts: the
metric-sentence pins (the repair pin holds text the lane wave — wave 4 — makes operative: pin first,
exercise later, legal and noted). Green: the prompt suite.

**Wave 3 — paradigm and contract duties (D3, D4's text, D8's text).**
The pack's `### d design` (contract artifacts, the per-concern target-construct naming, the
re-expression section, the justified-similarity record practice), `### m implementation` (the
slice-cites-its-contract rule), `### decompose` / `### self-check-*` lines, the `### verify-plan-test`
property-coverage sentences; `modes/cleanroom.md` `## exec` (the paradigm/platform paragraph). Asserts:
the D4 pin. Green: the prompt suite plus `test/intent-guarantees.test.ts`.

**Wave 4 — the lane table and the declarations (D5, D7, D8's lanes).**
The pack's `### test-lanes` comments-only section with the five example rows (the divergence row a
regression-cost row, its Command a bare target name; the divergence tool's configured scope including
the specification notes, the spec-read close running it like any phase close); `phases/survey.md`
(the proposal duty: lane rows, corpus location, platform contract); `modes/cleanroom.md` `## init`
(the declarations a cleanroom project owes). Tests: the floor pins in `test/bundle.test.ts` — the
shipped pack parses to `undefined`
and the uncommented example rows parse (the divergence row regression-cost, bare command);
`test/lane-table.test.ts` untouched (grammar unchanged). Green: `bun test`.

**Wave 5 — the audit dimensions (D9).**
`templates/bundles/cleanroom/phases/audit.md` and the pack's `### audit` (the two new dimensions); the
independence dimension's justification-record adjudication; `### verify-plan-audit` (contract coverage;
the divergence-receipt carve-out; the source-free three-part directive sentence). Asserts: the D9 pins.
Green: the prompt suite; `test/round-gates.test.ts` (the verdict gate is untouched — the Result-line
rule stands verbatim).

**Wave 6 — records and the closing read.**
`AGENTS.md` navigation: extend the intent/bundle line (and the manual-suite line only if wave
inspection found a touchpoint — none is expected) with the 0121 pointer. Full `bun typecheck` + `bun
test`; read the materialized surface once through `init --intent` in a scratch directory (the bundle
materializes, the pack resolves, the floor holds). No `docs/structure.md` change (no module moved); no
`docs/releases.md` change between release events.

**Target-side follow-up (not this repository):** the aster-mig project materializes the refreshed
bundle via `sync`, declares its real lane rows (build, its paradigm-constraint suite, its property
suite, the divergence scan behind a bare target name — the project's own toolchain names, never the
bundle's), states its platform contract in the
brief, and stages the v1 instruments its language pair selects (identifier matching + literal
fingerprinting). The tool's acceptance is
a **delivery condition before the first live round**, not an optional follow-up: two synthetic fixture
pairs — one that must flag (a colliding identifier/structure pair) and one that must pass clean (a
benign pair: public-interface terms, protocol-mandated sequencing); the red-path smoke — a scratch
project's declared lane exiting 1 blocks its phase close; the exclusion check — the person's
bounded exclusion (with its recorded reason) clears its own finding, greens the lane, and exempts
nothing else: an exclusion that also silences the benign fixture fails acceptance; and the
reachability check — nothing readable from the worktree opens the corpus: read the stub and
everything it names, and no path resolves to corpus content. The first rounds' receipts are the
evidence D11's revisit triggers read.
