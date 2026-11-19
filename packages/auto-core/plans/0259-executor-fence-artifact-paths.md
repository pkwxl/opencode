# 0259 — The landing fence's in-scope artifact paths

Discharges [0257](0257-executor-preview-findings.md) finding 02 (the fence's
role gate excluded the task grammar's own documents). Derives P7 (the fence is
grammar — path intersection over the documents' own frozen shapes, never
content judgment; the widening removes an unruled role test, it adds no test
of its own), P10 (the undeclared floor byte-identical — a unit with no
`Touches:` keeps the freeform-only refusal exactly as before, the widening
reaching only where a declaration opted in), P3 and P4 (settlement still
judged from the tree and Git alone — the widened writes are ordinary task
work the verification and close-out witnesses key the same commits for), P17
(scope stays the declared surface — the widening rides `Touches:`/`docScope`
exactly, and the never-list keeps the driver-exclusive surfaces fenced even
inside a declared scope, wrong surface loudly), P5 (the never-list stated
once, in the fence, as path grammar derived from the documents' own shapes —
no second classification home, the role classifier untouched and still
confined to the document domain), and P13 (no wire act — no grant field,
blocked reason, or message vocabulary changes; "no new grammar" is the
finding's own remedy letter). Amends none — 0248 D5's permitted set and
0253's reservation were always scope-based; this ruling enforces their
letters. Tier: mechanism.

## Category scope

Tier: mechanism (code home `src/executor-coordinator.ts`, test homes beside
it).

Premises this ruling changes: none — the ruling closes the finding's two
named under-ruled corners in words and enforces two standing letters; no
ruling rested on the role gate. Re-read in this change: **0248 D5** (stands —
its permitted set was always "the unit's effective scope plus the artifact
paths per kind"; the `roleOf === "freeform"` conjunct was the unruled
narrowing this change drops), **0253** (stands — the tier-1 reservation "the
declarations and the unit's own task directory" unchanged, now honored for
artifact-role paths instead of refused), **0246 D4 i** (stands — its
never-list now stated mechanically in the fence where the widening would
otherwise reach it; the close-out's rename and tick remain the coordinator's
own booked writes, never fenced session work), **0249** and **0258** (stand —
the strict landing scope and the per-root settlement compose unchanged
through the widened fence).

## The ruling

**The fence.** The write contract's permitted set is 0248 D5's letter and
nothing else: the unit's effective scope — `entry.scope ?? entry.touches`,
the reservation's `docScope` at the scoped tiers, the declared `Touches:` on
the serial tier — plus the per-kind artifact paths (`handoff.md` always;
`report.md`/`gaps.md` alone on a verify). Inside a declared scope the role
test yields: a path within scope is permitted whatever its document role, so
a unit whose `Touches:` declares its register under `docs/T-NNN/`, its
receipts under `docs/T-NNN/testhands/`, or an evidence doc under a sibling
task's directory writes those artifact-role paths as ordinary task work.
Outside the declared scope the refusal stands; with no declaration at all
the freeform-only serial floor stands byte-identical (P10) — an undeclared
unit's every `docs/T-*`/`docs/R-*` write still refuses, its freeform writes
still land.

**The never-list completed.** D4 i's never-list is a refusal set over the
permitted set, not a member of it. The finding's letter — "honored by the
first line" — held only while the role gate refused every `docs/T-*`/
`docs/R-*` path anyway; the widening states the docs-space members
mechanically: `todo.md`/`done.md` (task, stream and phase-planning shapes),
the index family (`docs/R-NN/phases.md` and the phase's
`docs/R-NN/P<nn>-<type>/tasks.md`), and `docs/T-NNN/subtasks.md` — path
grammar inside the process tree, no role vocabulary (the executor family
still names none) — plus the root `opencode.json` the first line never
covered (a driverState surface a declaration could name; `.opencode/`,
`AGENTS.md` and `.auto/` keep their first-line arms, and git metadata never
rides a status row, the fence's only input). A declared scope containing
another unit's `todo.md` or the phase index therefore still refuses — the
driver-exclusive surfaces are nobody's in-scope work, and a never-listed
path is nobody's sibling dirt either: unowned, it holds landings for the
person exactly as 0248 D5 rules the violation.

**Residual 1 — docs-declared units at tier 0.** A unit whose `Touches:`
declares its document surfaces carries its artifact-role writes as in-scope
work at every tier: the serial tier (scope = the declared `Touches:`), the
doc tier and the worktree tier (scope = `docScope`). 0253's tier-1
reservation shape — "the unit's own `Touches` ∪ `docs/T-NNN/`" (0099's
`docScope`) — is unchanged; what changes is that the fence now honors that
shape for artifact-role paths instead of refusing them.

**Residual 2 — the fence and the `Artifacts:` declaration.** The fence never
reads `Artifacts:`. The planning side already derives `touches` from it —
the decompose scope file's `Touches:` is rendered from the line's
`Artifacts:` paths (`src/split.ts`'s AUTO-DECISION), the task-level field
block carries the declaration forward — and the fence consumes only the
derived `touches`/`docScope`: one declaration, one derived field, one fence
input (P5 — no second reader of the declaration enters the driving layer).
The artifact-existence checks (`declaredArtifacts` and its consumers) remain
the collect machinery's own, untouched.

Untouched beside these: the verify branch (`report.md`/`gaps.md` only), the
handoff early-return, `grant.budget`'s advisory carriage — and 0258's
per-root settlement composes unchanged (a nested-repository path stays
freeform-role and unaffected).

## Tests

`test/executor-steps.test.ts` — the reproduction: a document-deliverable
task (register under `docs/T-001/`, receipts under `docs/T-001/testhands/`,
an evidence doc under `docs/T-002/`) claims at the doc tier, its sibling's
overlapping claim waiting, settles the artifact-role writes plus the handoff,
verifies PASS and closes; an out-of-scope `docs/T-009/` path still fences by
name. The undeclared floor: no `Touches:` — a `docs/T-001/` artifact write
refused (named), a freeform `docs/` path and `src/` write landing. The
never-list: a `Touches: docs/` scope — another unit's `todo.md`, the round
ledger, the phase task index and `subtasks.md` each named in the refusal,
the in-scope register landing beside the handoff once they resolve. The
standing doc-lane family (freeform `docs/` scopes) stays green — the tier-1
reservation letter unchanged. `test/executor-worktree.test.ts` — the tier-2
widening (a mixed `src/` + `docs/T-001/` declaration settles its
artifact-role write from the lane) and the config arm (`Touches:
opencode.json` fenced by name). Form checks: `bun typecheck` exit 0; the
executor suites, `test/blockage-executor.test.ts`, the four reconciliation
suites and the manual-prompts ratchet green — no pin moved (the verify
branch's pinned line untouched).
