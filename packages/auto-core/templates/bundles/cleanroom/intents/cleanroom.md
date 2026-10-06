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
specification notes, the brief and the planning input alone. The deliverable is an independent
implementation of the specified external contracts; internal structure is free, and
structural resemblance to the reference implementation beyond those contracts is a
defect, not a goal. Where the specification is silent, the minimal behavior consistent
with the public interfaces is chosen and the assumption is recorded; the audit phase
judges compliance and independence, and its verdict follows the findings.
