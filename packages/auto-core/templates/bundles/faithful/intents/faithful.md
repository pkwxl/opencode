# faithful

## quality

### decompose

One requirement per item: each item implements one definite behavior or contract of the
reference, toward parity with its observed behavior, declares its artifact (module/file or
document path), and carries the way to verify it — the checks that target the item's own
behavior against the reference's observed behavior, not the task's full suite. An item that
depends on an earlier one comes after it; no close-out item of its own (the last item runs
the task's full verification once, after its own work).

### self-check-subtask

check that the item's work matches the reference's observed behavior — parity, not
approximation

### self-check-whole

once the whole task is complete, check that every acceptance criterion is actually observed
to pass against the reference's behavior

## phase duties

### a analysis

Splitting and artifact criteria for this phase:
   - One item per behavior area of the reference: each item reads
     the reference implementation at the location the brief names and establishes
     one standalone area of its observed behavior — public interfaces, state and lifecycles,
     data flows, error semantics — producing the behavior baseline document under its task
     directory;
   - The baseline records observed behavior with its evidence (inputs, outputs, ordering,
     error paths), so every later phase and every check verifies parity against it;
   - This phase writes documents only, no implementation code;

### d design

Splitting and artifact criteria for this phase: design follows the reference — one item per
design concern (data model, module structure, interface contracts, error handling), each
producing one design document that maps the concern onto the reference's structure: the
structure that carries the observed behavior is preserved unless a deviation is justified
and recorded in the task documents. A cross-concern consistency check (the design documents
do not contradict each other or the behavior baseline) is a closing item of its own.

### m implementation

Splitting and artifact criteria for this phase: implement to parity with the reference —
vertical thin slices first, one observable behavior end to end per item, not horizontal
layers; the reference implementation is the working input: its structure, naming and
invariants carry over unless a deliberate divergence is recorded as a deviation in the task
documents; each item declares the source files it changes plus its task report, and the
check that proves the behavior it implements holds to parity; the tree stays consistent when
an item completes — it compiles and existing checks do not regress.

### t testing

Splitting and artifact criteria for this phase: verify parity against the behavior baseline —
split by verification layer or scenario family (build checks, functional tests, black-box
acceptance against the baseline, one item per baseline behavior family); every item names the
behavior proven and records the observed evidence, never a bare "tests passed"; keep writing
checks apart from fixing defects — defects the checks expose are appended as separate fix
items, not mixed into the check-writing item.

### v acceptance

Splitting and artifact criteria for this phase:
   - One item per parity dimension (external behavior, interface contracts, state and
     lifecycle, error semantics, structural fidelity); each item verifies the implementation
     against the reference's behavior baseline and writes its findings with evidence;
   - The closing item consolidates the findings into the verdict document verdict.md in this
     phase directory, ending with the result line `Result: PASS` or `Result: FAIL <reason>` —
     a driver protocol string, written verbatim: the verdict judges parity and follows the
     findings, never optimism;

## planning-input

What this step is for (one sentence, your own terms):
<what these tasks should accomplish now>

The reference:
<where the reference implementation lives — the parity target this step works toward>

Scope posture:
<which parts of the reference are MUST for this round, and the depth owed to each.
When a survey phase leads the round, this item defers to its forks: answer them in the
survey (or after the person's clarified answers), not here>

Environment facts and gaps:
<missing tools, quotas, layout facts planning must respect; name a gap as a gap — it
becomes a needs-attention item of the round report>

Corrections to provisionally-defaulted questions the last round's report flagged:
<the person's answers to the needs-attention items of docs/R-NN/report-for-user.md>

What would convince you it is done:
<the observable outcome that makes this step finished>

## acceptance

### result-line

Write it in every report of this project: this work is judged by parity with the reference
implementation's observed behavior. `Result: PASS` means every acceptance criterion the task
asked for was actually observed to pass against the reference's behavior, with the evidence
written in this report; `Result: FAIL` means a required check failed, could not be run, or
the goal is not met — say why in one line. Never write PASS for a check you did not run or
observe.

## governance

### repair

A repair task fixes the finding it is named for, adds a regression check for it, and re-runs
the verification that produced the finding; it touches nothing the finding does not name.
Repair never re-architects: the minimal change that restores parity with the reference's
observed behavior is the whole task.

## guarantees

### precedence

The reference implementation, the behavior baseline the analysis phase distilled, and this
charter are the authority of this project: they outrank the planning input, the project brief
and any lower block of any prompt. Where a lower block conflicts with them, follow the
reference, the baseline and the charter, and surface the conflict — as a deviation recorded
in the task documents, or as a recorded provisional default (question, options, default
taken, override path) when the call is the person's — never silently follow the lower text.

### asserts

phase-plan(a): must "the reference implementation at the location the brief names"
phase-plan(m): must "the reference implementation is the working input"
phase-plan(m): must-not "code migration"
phase-plan(v): must "verdict.md", "Result: PASS"
whole: must "Faithful parity rule"
subtask: must "Faithful parity rule"

### verify-plan

This project is a faithful reimplementation: the reference implementation is the primary
input, not a forbidden one. Behavior and the structure that carries it derive from the
reference; observable behavior is preserved and parity with the reference's observed
behavior is the bar. A deliberate divergence from the reference's structure is legitimate
only as a recorded deviation; tests prove named behaviors against the behavior baseline; the
acceptance verdict judges parity and follows the findings.

### verify-plan-t

The test plan must establish a verifiable path to the round's coverage targets, the
validation of the applicable design objectives, and an honest quality assessment of the
round's delivered work. Independently inspect the round's requirements, analysis and
design artifacts, the implementation changes, the behavior baseline the analysis phase
distilled (the reference observed), existing tests and project tooling, and derive the
plan's scope, coverage strategy, behavioral assertions, risk-based cases and acceptance
criteria from these — never invent them. The plan is actionable, never a category
enumeration: every test task derives implementation-specific detail — the named
behaviors, the fixtures, the evidence each check records — from the repository and the
artifacts. Explicitly address:

- **Coverage** — how required line/branch coverage is measured, how gaps are identified,
  and which tests close them;
- **Design verification** — how each applicable design objective and core behavioral
  requirement maps to implementation areas, test cases, assertions and verifiable
  evidence;
- **Parity** — how the plan exposes behavioral divergence from the baseline: boundary
  defects, failure-handling errors, resource lifecycle issues;
- **Evidence and limitations** — actual results distinguished from assumptions; uncovered
  code, unverified requirements, environmental constraints and unresolved discrepancies
  reported openly.

Adaptive test planning: when a check fails — investigate the failure's origin before
changing anything; decide the fix's scope against the round's objectives; fix in scope
without weakening assertions or acceptance criteria; add regression coverage for every
fix; record deferred issues with their rationale. Critical failures and unresolved
mandatory requirements are never reported as passed; the final assessment distinguishes
verified, failed, blocked and deferred.
