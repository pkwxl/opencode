# cleanroom

## quality

### decompose

One requirement per item: each item implements one definite behavior or contract of the
specification, declares its artifact (module/file or document path), and carries the way
to verify it — the checks that target the item's own behavior, not the task's full suite.
An item that depends on an earlier one comes after it; no close-out item of its own (the
last item runs the task's full verification once, after its own work).

### self-check-subtask

check that the item's behavior matches the specification's words, not the reference
implementation's shape

### self-check-whole

once the whole task is complete, check that every specified behavior is implemented and
every acceptance criterion is actually observed to pass

## phase duties

### spec-read

Splitting and artifact criteria for this phase ({{phaseName}}):
   - One item per specification concern: functional scope, entities and lifecycles, public
     interface contracts, data-plane behaviors, error semantics, acceptance criteria;
   - Each item reads the reference implementation at the location the brief names and
     produces one standalone behavior-only notes document — observable behavior and
     contracts, never private names, internal structures or translated code;
   - The concern list is a floor, not a ceiling: a concern may span several tasks sized
     to a session, and every feature area of the reference is assigned to exactly one
     task (a coverage/accounting task may hold the mapping);
   - This phase writes documents only, no implementation code;

### d design

Splitting and artifact criteria for this phase: design from the specification notes
alone — one item per design concern (data model, public interface contracts, module
boundaries, error handling), each producing one design document that cites the
specification section it serves; a cross-concern consistency check (the design documents
do not contradict each other) is a closing item of its own. Design documents propose
structures the specification calls for, never shapes carried over from the reference
implementation.

### m implementation

Splitting and artifact criteria for this phase: implement the specification — vertical
thin slices first, one observable behavior end to end per item, not horizontal layers;
each item declares the source files it changes plus its task report, and the check that
proves the behavior it implements (a build, a targeted test, or a black-box acceptance
step); the tree stays consistent when an item completes — it compiles and existing
checks do not regress; where the specification is silent, take the minimal behavior
consistent with the public interfaces and record the assumption in the task documents.

### t testing

Splitting and artifact criteria for this phase: split by verification layer or scenario
family — build checks, functional tests, and black-box acceptance (one item per
acceptance criterion family, each verifying Given/When/Then against the specification)
each become an item; every acceptance item maps the criterion to the check that proves
it and records the observed evidence, never a bare "tests passed"; keep writing checks
apart from fixing defects — defects the checks expose are appended as separate fix
items, not mixed into the check-writing item.

### audit

Splitting and artifact criteria for this phase ({{phaseName}}):
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
becomes a needs-attention item of the round report>

Corrections to provisionally-defaulted questions the last round's report flagged:
<the person's answers to the needs-attention items of docs/R-NN/report-for-user.md>

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

### process-references

Process documents are the DRIVER's record of this work — .auto/ and the task, round and
phase documents under docs/T-* and docs/R-*. They steer the work; they are not part of
what it delivers. The deliverable (code, comments, build and configuration files, the
project's own documentation) must never reference them: no process-document paths, no
task ids as pointers. A comment needing a decision or constraint that a process document
records restates that content itself, so the code stands on its own once the process
documents are gone. AUTO-RESOLVE / AUTO-DECISION / AUTO-FIXME marker lines may sit in
code comments, but each line carries its own question, decision and reason and never
points at a process document.

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
phase-plan(audit): must "verdict.md", "Result: PASS"
phase-plan(m): must-not "code migration"
whole: must "Clean-room boundary"
subtask: must "Clean-room boundary"

### verify-plan

This project runs a two-room clean room. The specification room — the spec-read phase —
reads the reference implementation at the location the brief names and distills
behavior-only specification notes; extraction hygiene bounds those notes to observable
behavior: no private names, no internal structures, no translated code. The brief
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
