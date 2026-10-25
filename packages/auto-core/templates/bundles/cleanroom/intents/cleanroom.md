# cleanroom

## quality

### decompose

3. One requirement per item: each item implements one definite behavior or contract of the
specification, declares its artifact (module/file or document path), and carries the way
to verify it — the checks that target the item's own behavior, not the task's full suite.
An item that depends on an earlier one comes after it; no close-out item of its own (the
last item runs the task's full verification once, after its own work). An implementation
item is kept ordered after the contract artifact it implements (`Depends:`).

### self-check-subtask

check that the item's behavior matches the specification's words, not the reference
implementation's shape — check the behavior against the contract the item cites, and
the property that proves it

### self-check-whole

once the whole task is complete, check that every specified behavior is implemented and
every acceptance criterion is actually observed to pass, and that every specified
behavior maps to a stated contract or a recorded deferral

### test-lanes

# The lane table is the project's own declaration, never shipped content: the rows below are
# commented examples that teach the shape, and every command in them is a neutral placeholder,
# not a runnable one. Real commands are per-project — the person fills them in the materialized
# pack after `init --intent` (pack edits are the person's; `sync` carries upstream duty-text
# changes). The surfaces are the project's own paths; a row marked Exclusive must run alone in
# the tree. A task's `## Acceptance` names its anchor row. A regression-cost row is never part
# of a task's wrap-up lane set and never an anchor: the driver alone runs it, in the background
# against committed trees and once more at phase close, and the phase cannot complete while its
# round-scoped receipt is red.

# build — the cheapest tree-wide consistency check, green before deeper lanes run.
# build:
# Command: build
# Cost: cheap
# Surfaces: .
# Exclusive: yes

# paradigm-constraints — the target platform's safety and forbidden-construct checks, the
# mechanical half of the paradigm boundary; the command is the overlay's own content, naming
# no particular toolchain.
# paradigm-constraints:
# Command: paradigm-constraints
# Cost: cheap
# Surfaces: src/
# Exclusive: no

# properties — the property suites' cheap smoke over the delivered contracts; the proof-class
# run may be declared as an anchor row of its own.
# properties:
# Command: properties
# Cost: cheap
# Surfaces: src/
# Exclusive: no

# divergence — the similarity scan of the deliverable and the specification notes against the
# reference corpus, at regression cost (the rules above). Its command is a bare target name —
# a single neutral token, no path, no toolchain word, no corpus path inline: the command's
# implementation lives driver-side and holds the corpus location, and the worktree carries at
# most a bare stub that invokes it and names no corpus path. The tool's configured scope
# includes the specification notes, so the spec-read close runs the scan like any phase close.
# divergence:
# Command: divergence-scan
# Cost: regression
# Surfaces: .
# Exclusive: no

# acceptance — the black-box acceptance anchor.
# acceptance:
# Command: acceptance
# Cost: anchor
# Surfaces: .
# Exclusive: yes

## phase duties

### spec-read

4. Splitting and artifact criteria for this phase ({{phaseName}}):
   - One item per specification concern: functional scope, entities and lifecycles, public
     interface contracts, data-plane behaviors, error semantics, acceptance criteria;
   - Each item reads the reference implementation at the location the brief names and
     produces one standalone behavior-only notes document — observable behavior and
     contracts, never private names, internal structures, translated code or
     infra-shaped vocabulary (concepts whose meaning hangs on the reference's
     particular internal organization): behavior is stated as observable contracts
     at the boundary, in the target platform's terms — the clause targets the
     concept, never the word, and domain-natural infrastructure names a target
     needs regardless are not suspect;
   - The concern list is a floor, not a ceiling: a concern may span several tasks sized
     to a session, and every feature area of the reference is assigned to exactly one
     task (a coverage/accounting task may hold the mapping);
   - This phase writes documents only, no implementation code;

### d design

4. Splitting and artifact criteria for this phase: design from the specification notes
alone — one item per design concern (data model, public interface contracts, module
boundaries, error handling), each producing one design document that cites the
specification section it serves; a cross-concern consistency check (the design documents
do not contradict each other) is a closing item of its own. Design documents propose
structures the specification calls for, never shapes carried over from the reference
implementation. Each design item's artifact is a contract document: the stated
behavior plus its properties and invariants, in the declared property framework the
pack overlay names — property suites are the in-pipeline instrument, model
definitions and checking a named option. Per design concern, the design document
names the target platform construct chosen in place of the transliterated shape,
building on the target platform's declared interfaces — the platform contract the
brief declares: its execution model, its memory/isolation discipline, its interface
shapes; the reference's substrate shapes are unavailable, and structures derived
from them are defects, not defaults. Where the specification's behavior was
expressed by the reference in terms of infrastructure the platform forbids,
restating that behavior in the platform's model is its own named design-document
section. Re-expression is demanded where the platform provides a materially
different or better abstraction — never everywhere a difference could be
manufactured: a shape that is also the rational design in the target is kept and
justified, not mangled for difference.

Substantive design choices are independently derived; structural similarity that is
unavoidable — protocol-mandated sequencing, shared mathematical constraints,
hardware fact, or the shape that is simply the rational design — is justified in the
task documents at design time: the design-time rationale is the strong form of a
justification record, and one written after a divergence flag reads as a
rationalization — commit order tells them apart.

Contract-first ordering: an implementation item depends, via its `Depends:` field,
on the contract artifact it implements — these duties say it, and the planner writes
the fields. A contract revised mid-implementation is a recorded change — its reason
in the task documents, stating its kind: a clarification of the specification (an
omission or defect found and corrected), or an accommodation of the implementation
(the contract bent to what was built; an accommodation without a justification of
its own is a finding). The durable evidence is the citation: each implementation
task's document records the commit SHA of the contract it cites — cheap, and it
survives history rewrites; commit order corroborates.

Specification sufficiency runs both ways: the notes cover the behaviors the target
must keep, and every behavior the specification notes and the brief's MUSTs name is
carried into some contract, or explicitly deferred with its record — without this,
contract-first only proves the faithful implementation of whatever happened to be
written down.

### m implementation

4. Splitting and artifact criteria for this phase: implement the specification — vertical
thin slices first, one observable behavior end to end per item, not horizontal layers;
each item declares the source files it changes plus its task report, and the check that
proves the behavior it implements (a build, a targeted test, or a black-box acceptance
step); the tree stays consistent when an item completes — it compiles and existing
checks do not regress; where the specification is silent, take the minimal behavior
consistent with the public interfaces and record the assumption in the task documents.
Each vertical slice cites the contract it satisfies — and the property that proves it
— by its own surfaces: the contract id, and the commit SHA its task document records.

### t testing

4. Splitting and artifact criteria for this phase: split by verification layer or scenario
family — build checks, functional tests, and black-box acceptance (one item per
acceptance criterion family, each verifying Given/When/Then against the specification)
each become an item; every acceptance item maps the criterion to the check that proves
it and records the observed evidence, never a bare "tests passed"; keep writing checks
apart from fixing defects — defects the checks expose are appended as separate fix
items, not mixed into the check-writing item.

### audit

4. Splitting and artifact criteria for this phase ({{phaseName}}):
   - One item per compliance dimension (coverage, behavior, interface, scope, spec
     hygiene, clean-room independence); each item audits the implementation against the
     specification and writes its findings;
   - The closing item consolidates the findings into the verdict document: every finding
     carries its evidence and severity, and the Result line follows the findings, never
     optimism;

## planning-input

What this step is for (one sentence, your own terms):
<what these clean-room tasks should accomplish now>

The reference and its wall:
<where the reference implementation lives, and the wall kind — layout separation or rule
separation; under rule separation, the platform boundary (the parts of the shared tree the
clean rooms may still read)>

Scope posture:
<bounded core vs full parity, and the multi-round expectation — which parts of the
reference are MUST for this round. When a survey phase leads the round, this item defers
to its forks: answer them in the survey (or after the person's clarified answers), not here>

Acceptance anchor:
<the build/test precedent to follow — the existing artifact whose shape the deliverable's
proof should take>

Environment facts and gaps:
<missing tools, quotas, layout facts planning must respect; name a gap as a gap — it
becomes a recorded gap the person reads — `driver-helper` renders the standing list)>

Corrections to provisionally-defaulted questions the last round recorded:
<the person's answers to the round's AUTO-RESOLVE records — the task reports' "Proxy-answered
questions" sections; `driver-helper` renders the standing list>

What would convince you it is done:
<the observable outcome that makes this step finished>

## acceptance

### result-line

Write it in every report of this project: this work is judged by black-box behavioral
verification against the specification. `Result: PASS` means every acceptance criterion
the task asked for was actually observed to pass, with the evidence written in this
report; `Result: FAIL` means a required check failed, could not be run, or the goal is
not met — say why in one line. Never write PASS for a check you did not run or observe.

## governance

### repair

A repair task fixes the finding it is named for, adds a regression check for it, and
re-runs the verification that produced the finding; it touches nothing the finding does
not name. Repair never re-architects: the minimal change that makes the specified
behavior hold is the whole task.

Compliance findings — divergence receipts, their fix directives, audit findings that
cite divergence — obey a stricter diet: they name ids, risk bands and structural
directives only, never excerpts, diffs or paraphrases of either side. A remediation
channel that quoted reference content would carry the reference back into the clean
room — the gate breaching the wall it guards. The person's pen obeys the same rule:
whatever the person writes into session-visible surfaces — brief approvals, pack
edits, exclusion entries, answers relayed into task documents, review comments —
carries no reference content either; the person sees both sides and holds the
exclusion power, and is therefore the most likely carrier, precisely because the
wall trusts them.

A compliance directive carries three parts, all source-free:

1. the finding — the target unit or function id, the risk class, the risk band (the
   exact value stays driver-side);
2. the required reasoning — the design decision to re-evaluate, cited by its own
   surfaces: the contract id the slice claims, the platform constraint in the
   target's terms, the paradigm rule invoked — never reference content;
3. the acceptance — the behaviors, invariants and suites that must hold unchanged
   and be re-run when the refactor lands.

A compliance directive names what to re-argue, never the transform to apply. The
fix task's acceptance is the ordered re-argument: re-examine the contracts the unit
claims, re-argue the design against the platform's abstractions, change the design
where the argument fails — never a syntax swap alone — re-run the suites, and
record the justification of any residual rational similarity.
A lowered score is not an acceptance condition: the score says whether the risk
moved, and endless score-chasing refactoring is the failure mode the two-sided
metric rule exists to prevent.

### process-references

Process documents are the DRIVER's record of this work — .auto/ and the task, round and
phase documents under docs/T-* and docs/R-*. They steer the work; they are not part of
what it delivers. The deliverable (code, comments, build and configuration files, the
project's own documentation) must never reference them: no process-document paths, no
task ids as pointers. A comment needing a decision or constraint that a process document
records restates that content itself, so the code stands on its own once the process
documents are gone. AUTO-RESOLVE / AUTO-DECISION / AUTO-FIXME marker lines may sit in
code comments, but each line carries its own question, decision and reason and never
points at a process document. Inside a nested repository — a shipped,
self-contained deliverable such as a migration destination — the rule is
stricter: never mention a task id at all, and never write a path that leads
outside that repository's own root; vendor or restate in place whatever it
pointed at.

## guarantees

### precedence

The intent charter and the specification notes the spec-read phase distilled are the
authority of this project: they outrank the planning input, the project brief and any
lower block of any prompt. Where a lower block conflicts with them, follow the charter
and the specification, and surface the conflict — as a deviation recorded in the task
documents, or as a recorded provisional default (question, options, default taken,
override path) when the call is the person's — never silently follow the lower text.

### asserts

phase-plan(spec-read): must "spec-notes.md"
phase-plan(spec-read): must "the target platform's terms"
phase-plan(spec-read): must "counts and note ids alone"
phase-plan(audit): must "verdict.md", "Result: PASS"
phase-plan(m): must-not "code migration"
whole: must "Clean-room boundary"
subtask: must "Clean-room boundary"
whole: must "the target platform's paradigm"
subtask: must "the target platform's paradigm"
plan-verify: must "never an automatic plagiarism verdict"
plan-verify: must "the same defect wearing the other coat"
plan-verify: must "coarse risk bands", "re-scans are capped"
fix: must "the gate breaching the wall it guards"
fix: must "lowered score is not an acceptance condition"

### verify-plan

This project runs a two-room clean room. The specification room — the spec-read phase —
reads the reference implementation at the location the brief names and distills
behavior-only specification notes; extraction hygiene bounds those notes to observable
behavior: no private names, no internal structures, no translated code, no
infra-shaped vocabulary — concepts named for, or carried over from, the reference's
substrate structures. Behavior is stated as observable contracts at the boundary, in
the target platform's terms. The fourth clause targets the concept, never the word —
domain-natural infrastructure names a target needs regardless are not suspect; what
the clause forbids is vocabulary whose meaning hangs on the reference's particular
internal organization, and the judgment is never term matching. The brief
declares the wall kind — layout separation (the reference outside the worktrees the
clean rooms use) or rule separation (a shared tree with the reference's paths
quarantined: never read, searched or reconstructed, and the platform boundary naming
what may still be read) — and the planning prompts must not cross the declared wall:
under rule separation nothing plans to read, search or reconstruct the quarantined
paths, and the platform boundary is the whole of the shared tree a clean room names.
Every later phase is a clean room: its sessions never access, search for, reconstruct,
infer or request the reference implementation, and they plan and implement from the
specification notes, the brief and the planning input alone. The reference implementation
is everything under the location the brief names, its published interface headers
included — their content reaches clean-room sessions only through the specification
notes' restatement. Walls and permissions live in this charter alone, and a lower
document may narrow them, never widen them — widening is the person's ruling, carried
as an open question until given. The deliverable is an independent
implementation of the specified external contracts; internal structure is free, and
structural resemblance to the reference implementation beyond those contracts is a
defect, not a goal. Where the specification is silent, the minimal behavior consistent
with the public interfaces is chosen and the assumption is recorded; the audit phase
judges compliance and independence, and its verdict follows the findings.

The checks this charter sets beside the wall — the divergence scan over the
deliverable and over the notes — are risk reduction and the detection of known
indicators of non-independent implementation, never proof: a control flow can be
carried over under renamed identifiers, and some of the reference's shapes are
rational in the target too. The wall stays primary; nothing in these clauses may
be cited to narrow it, and widening remains the person's ruling as above.
Comparing the deliverable with the reference needs someone who may see both, and no
clean room can: the compliance monitor — the person, or a driver-side designate the
person names — owns that dirty side, and the adjudication splits: the audit judges
the target-side rationale, the monitor confirms what kind of similarity was
flagged. The divergence corpus, its comparison configuration and the tooling are
driver-owned and live outside the platform boundary, in a driver-side repository
or path — clean-room sessions never read or execute them; the worktree carries at
most a bare stub that invokes the driver-side location and names no corpus path
inline; and a corpus path in any session-rendered surface is a wall breach by the
gate meant to enforce the wall. The divergence instrument's cheap half runs on the
specification notes themselves at spec-read close, before contamination spreads:
any of the reference's private identifiers in a note is a hard finding — public
specification names are the notes' lawful vocabulary; the spec-read room may be
told the colliding identifier outright, for it reads the reference lawfully; and
the committed receipt carries counts and note ids alone — a reference identifier
never persists in any session-readable document.

A divergence score is screening, never a verdict: a risk flag that triggers
adjudication, never an automatic plagiarism verdict — similarities can originate
in public interfaces, protocol-mandated sequencing, shared mathematical
constraints, hardware fact, or independent derivation. The tool's declared
configuration excludes what is public or protocol-mandated by declaration; what
remains flagged flows to the audit's independence dimension as a finding carrying
its justification record. The only exits from a red receipt are two: a refactor
that genuinely re-expresses, or a person-declared exclusion on the committed tool
configuration with its recorded reason — there is no agent-side waiver, and the
audit adjudicates but cannot green the lane. An exclusion is a bounded,
reviewable scope — a declared public interface, a named symbol set, a
protocol-mandated sequence — written in target-side terms only, never a broad
silencer: a whole-directory exclusion that greens the scan is itself an audit
finding.

The metric cuts both ways: beside this charter's rule that structural
resemblance beyond the specified contracts is a defect, divergence manufactured
to lower a score is the same defect wearing the other coat. What is prohibited
is structural inheritance without independent justification, not the
coincidental alignment of rational designs; what is required is target-platform
adaptation, not manufactured difference. Structural similarity that is
unavoidable — protocol-mandated sequencing, shared mathematical constraints,
hardware fact, or the shape that is simply the rational design in the target too
— is justified in the task documents, and adjudicated from the justification
records, never the score alone. A justification's weight follows when it was
written: the strong form is the design-time rationale; a justification written
after the flag has the shape of a rationalization, and commit order tells them
apart.

Source-free is not yet leak-free: over repeated rounds, receipts would teach the
clean side which deliverable names collide. Session-rendered receipts and
directives name the flagged unit and never the colliding symbol; sessions see
coarse risk bands, the exact values staying driver-side for the person and the
compliance monitor; and a unit's re-scans are capped — the cap a declared
project fact — past it, the next red escalates to the person instead of opening
another fix loop. A session cannot chase a number it never sees.

### verify-plan-test

The test plan must establish a verifiable path to the round's coverage targets, the
validation of the applicable design objectives, and an honest quality assessment of the
round's delivered work. Independently inspect the round's requirements, analysis and
design artifacts, the implementation changes, the specification notes the spec-read
phase distilled, existing tests and project tooling, and derive the plan's scope,
coverage strategy, behavioral assertions, risk-based cases and acceptance criteria from
these — never invent them. The plan is actionable, never a category enumeration: every
test task derives implementation-specific detail — the named behaviors, the fixtures,
the evidence each check records — from the repository and the artifacts. Explicitly
address:

- **Coverage** — how required line/branch coverage is measured, how gaps are identified,
  and which tests close them;
- **Design verification** — how each applicable design objective and core behavioral
  requirement maps to implementation areas, test cases, assertions and verifiable
  evidence;
- **Verification sufficiency** — the suites cover each contract's properties,
  boundaries and failure paths; property assertions derive from the stated contract,
  never restated from the implementation they sit beside — a property changed to
  match observed behavior is a contract revision, recorded with its kind and reason,
  not a test fix;
- **Conformance** — how the plan exposes divergence from the specification: boundary
  defects, failure-handling errors, resource lifecycle issues; independence defects
  (structural cloning of the reference implementation) are findings the plan must be
  able to surface;
- **Evidence and limitations** — actual results distinguished from assumptions; uncovered
  code, unverified requirements, environmental constraints and unresolved discrepancies
  reported openly.

The two-room wall restated for planning: no test task reads, searches or reconstructs
the reference implementation or its quarantined paths; the specification notes are the
test plan's only authority about the reference. Adaptive test planning: when a check
fails — investigate the failure's origin before changing anything; decide the fix's
scope against the round's objectives; fix in scope without weakening assertions or
acceptance criteria; add regression coverage for every fix; record deferred issues with
their rationale. Critical failures and unresolved mandatory requirements are never
reported as passed; the final assessment distinguishes verified, failed, blocked and
deferred.

### verify-plan-audit

The audit plan must render the round's compliance verdict from evidence on disk, re-running
every deciding check itself: a prior phase's green report is context, never the verdict.
Independently inspect the round's requirements, the specification notes the spec-read phase
distilled, the design artifacts, the implementation and test changes, and the round's
recorded deviations, deferrals and open findings, and derive the plan's verdict structure
from these — never invent criteria. The plan is an item-by-item adjudication, never a
summary: each compliance dimension — coverage of the MUST requirements, behavioral
conformance, public interface conformance, scope discipline, spec hygiene, clean-room
independence — is its own audit task with its findings written to audit.md, and no
criterion is accepted on prose, merged, or silently dropped. Explicitly address:

- **Negative scope** — the plan's first deliverable states what this round does not deliver:
  every deferred, descoped or postponed item with the record that owns it, so a passing
  verdict cannot read as the whole mission being complete;
- **Re-run, never cite** — every entry names the command, check or committed artifact that
  decides it, re-executed at audit time on the final tree; recorded counts and ledgers the
  round kept are re-derived from the tree, and drift is a finding, never an edit;
- **Independence judgment** — how the audit surfaces structural cloning of the reference
  implementation, and implementation leakage in the specification notes themselves;
- **Gap disposition** — every open finding and deferred item makes an explicit contribution
  to the verdict: blocking, or accepted with its recorded rationale and the condition that
  reopens it; nothing passes by silence;
- **Evidence and limitations** — the verdict distinguishes verified, failed, blocked and
  deferred, and a person can re-execute the deciding checks from the recorded command lines
  and artifacts alone.

The two-room wall restated for the audit: no audit task reads, searches or reconstructs the
reference implementation or its quarantined paths; the specification notes are the audit
plan's only authority about the reference. The audit verifies, it never re-implements: a
defect found at audit is a named finding for the repair path, and the plan re-opens no
decision the round recorded. The verdict follows the findings — Result: PASS only when
every criterion's evidence holds, Result: FAIL with the reason naming what does not, never
from optimism.
