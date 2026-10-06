# faithful-lean

## quality

### decompose

One requirement per item: each item delivers one definite piece of external behavior at
parity with the reference, or sheds one definite piece of legacy debt, declares its artifact
(module/file or document path), and carries the way to verify it — the checks that target
the item's own external behavior against the reference's observed behavior, not the task's
full suite. An item that depends on an earlier one comes after it; no close-out item of its
own (the last item runs the task's full verification once, after its own work).

### self-check-subtask

check that the item's work keeps external behavior exactly as the reference exhibits it,
and that every internal removal it made is justified in the task documents

### self-check-whole

once the whole task is complete, check that external behavior is indistinguishable from
the reference's and every removal of internal legacy is accounted for

## phase duties

### a analysis

Splitting and artifact criteria for this phase:
   - One item per behavior area of the reference: each item reads
     the reference implementation at the location the brief names and establishes
     one standalone area of its observed external behavior — public interfaces, state and
     lifecycles, data flows, error semantics — producing the behavior baseline document
     under its task directory;
   - Beside each area, its legacy debt: internals the external behavior does not depend
     on, named as removal candidates, each with the reason it is legacy and the risk of
     shedding it;
   - This phase writes documents only, no implementation code;

### d design

Splitting and artifact criteria for this phase: design for external parity with internal
freedom — one item per design concern (external contracts fixed first, then data model,
module structure, error handling), each producing one design document that pins the
external behavior it preserves and redesigns the internals underneath it, justifying every
legacy structure it drops. A cross-concern consistency check (the design documents do not
contradict each other or the behavior baseline) is a closing item of its own.

### m implementation

Splitting and artifact criteria for this phase: reimplement behavior-compatible and
remove legacy debt deliberately — vertical thin slices first, one observable behavior end to
end per item, not horizontal layers; external behavior is preserved exactly as the behavior
baseline records it, while internal design is free: rebuild, rename, restructure, and never
preserve internals for their own sake; each removal of legacy names what it removes and why
in the task documents; each item declares the source files it changes plus its task report,
and the check that proves the external behavior it carries still holds; the tree stays
consistent when an item completes — it compiles and existing checks do not regress.

### t testing

Splitting and artifact criteria for this phase: verify parity against the behavior baseline —
split by verification layer or scenario family (build checks, functional tests, black-box
acceptance against the baseline, one item per baseline behavior family); every item names the
behavior proven and records the observed evidence, never a bare "tests passed"; keep writing
checks apart from fixing defects — defects the checks expose are appended as separate fix
items, not mixed into the check-writing item.

### v acceptance

Splitting and artifact criteria for this phase:
   - One item per verification dimension (external behavior, interface contracts, state and
     lifecycle, error semantics, debt-removal accounting); each item verifies the
     implementation against the reference's behavior baseline and writes its findings with
     evidence — the debt-removal accounting item lists every internal removal the work made
     and where its justification lives;
   - The closing item consolidates the findings into the verdict document verdict.md in this
     phase directory, ending with the result line `Result: PASS` or `Result: FAIL <reason>` —
     a driver protocol string, written verbatim: the verdict judges external parity plus the
     debt-removal accounting and follows the findings, never optimism;

## planning-input

What this step is for (one sentence, your own terms):
<what these tasks should accomplish now>

The reference:
<where the reference implementation lives — the parity target this step works toward>
Legacy debt in scope:
<which classes of internal debt this step may shed deliberately, and which must be
carried over unchanged for now>

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

Write it in every report of this project: this work is judged by external parity with the
reference implementation's observed behavior. `Result: PASS` means every acceptance
criterion the task asked for was actually observed to pass against the reference's
behavior, with the evidence written in this report; `Result: FAIL` means a required check
failed, could not be run, or the goal is not met — say why in one line. Never write PASS for
a check you did not run or observe.

## governance

### repair

A repair task fixes the finding it is named for, adds a regression check for it, and re-runs
the verification that produced the finding; it touches nothing the finding does not name.
Repair never re-architects: the minimal change that restores the reference's external
behavior is the whole task.

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
phase-plan(m): must "remove legacy debt deliberately"
phase-plan(m): must-not "code migration"
phase-plan(v): must "verdict.md", "Result: PASS"
whole: must "Lean boundary"
subtask: must "Lean boundary"

### verify-plan

This project is a lean reimplementation: the reference implementation's external behavior is
preserved exactly — public interfaces, observable effects, state and error semantics — while
internal design is free. Legacy debt is removed deliberately, never preserved for its own
sake, and every removal is justified in the task documents. Tests prove named behaviors
against the behavior baseline; the acceptance verdict judges external parity plus the
debt-removal accounting, and follows the findings.
