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
   - Each item produces one standalone notes document; this phase writes documents only,
     no implementation code;

### test

Splitting and artifact criteria for this phase ({{phaseName}}):
   - Split by verification layer or scenario family: build checks, functional tests, and
     black-box acceptance (one item per acceptance criterion family, each verifying
     Given/When/Then against the specification) each become an item;
   - Every acceptance item maps the criterion to the check that proves it and records the
     observed evidence; never report "tests passed" without saying which requirement a
     check proves;
   - Keep writing checks apart from fixing defects: defects the checks expose are appended
     as separate fix items, not mixed into the check-writing item;

### audit

Splitting and artifact criteria for this phase ({{phaseName}}):
   - One item per compliance dimension (coverage, behavior, interface, scope, clean-room
     independence); each item audits the implementation against the specification and
     writes its findings;
   - The closing item consolidates the findings into the verdict document: every finding
     carries its evidence and severity, and the Result line follows the findings, never
     optimism;

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
