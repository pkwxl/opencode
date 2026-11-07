# 0205 — the formulation review seam: reconstruction beside hand-added tasks, the fixed prefix, and the digest that travels with the todo

Status: **active**. Ruled 2026-11-07 by 0166 step 045 (wave W8-planning), enacting 0165-014
(S08-01, S2, CONFIRMED — 0101 stage C widened the digest-keep, `formulationNumber` and every
dispatch predicate to "wherever the todo sits — beside hand-added tasks too", but
`constructFormulation`'s own recognition (`formulationState`) still read any second index entry
as `foreign`: after a `plan --new-task` add at the review stop, transfer exits 2 with
"lists work beyond the formulation task" — a message naming no remedy — and plan exits 1 naming
transfer: the two commands point at each other, and the only exits are hand-deleting the added
task or reverting the input edit, neither named), 0165-015 (S08-09, S2, CONFIRMED — dispatching
the reviewed formulation beside a `--new-task` task overwrites the person's task without a line:
the floor's numberStart is the standing todo's own id + 1 — exactly the id `addTask`'s floor
allocation then takes — the floor renders the index path but never its rows, so the add leaves
the floor digest unchanged and the digest-keep dispatches the stale numbering;
`takenTaskIds` holds "what the current phase's own index lists is not taken", and the collect
re-checks every index id as newly planned with no snapshot of the pre-existing rows, so a
session that follows its input replaces the person's document and index line inside the
formulation's exec commit and "phase planning complete" follows) and 0165-100 (S08-07, S3,
CONFIRMED — the reviewed todo's identity lives only in gitignored `.auto/units.json`
(`synthDigest`): in a fresh clone, a `fork` worktree, or after `.auto/` is cleared, `plan`
refuses an unchanged reviewed todo with "an input changed since construction" — a cause that did
not happen — and the transfer it names re-runs the constructor, under a charter a
nondeterministic re-voicing that rewrites the todo the person already reviewed, the exact churn
0097 D6's digest-keep exists to prevent).

This ruling Derives: **P20** (in-flight work is never destroyed — the person's hand-added task
is work in flight at the review seam; the formulation's dispatch may neither teach a numbering
that collides with it nor accept a session output that replaced it), **P2** (the person brackets
every boundary — `--new-task` is the person's one supported act at the review stop; the seam's
commands must absorb it, not deadlock against each other), **P6** (derived state — the fixed
prefix derives from the unit-start git baseline and the index at compose time, and the digest
from the committed todo itself; nothing new persists), **P7** (grammars, never content — the
driver checks rows, fields and digests; the prefix block teaches, the collect checks mechanical
identity), **P18** (the record outlives the tool — the floor digest moves into the todo
document, plain files and git the only durable state; `.auto/units.json` stays a fallback cache
for pre-0205 constructions) and **P10** (the byte-identical floor — every state without a
hand-added row beside a pending formulation, and every ran formulation, renders and dispatches
byte-identically; the fields land only when a construction happens anyway). It Amends:
**0097 D6** (the digest's recorded home — see Premises) and completes **0101 stage C/D3/D4**'s
widening (the constructor's recognition joins the predicates stage C already widened).
Tier touched: **mechanism only** — the formulation step's state recognition, prompt assembly,
collect checks and digest home; no principle change; the vocabulary changes are additive field
grammars on a driver-written document (`Prefix:`, `Floor-Digest:`), never silent dual meanings.

### Category scope

- **Derives**: P20, P2, P6, P7, P18, P10 (statements unchanged; the showing clauses above).
- **Amends**: no principle. The plans-level amendments: 0097 D6's record home (the digest's
  durable home is the todo document; `.auto/units.json`'s `synthDigest` becomes the pre-0205
  fallback reader and its write retires) and 0095 D4's constructor scope (the `pending` state's
  definition, restated in D1). 0101 D3/D4's review-seam discipline (transfer reconstructs, plan
  dispatches exactly as constructed, the refusal naming the re-run) is unchanged and is the
  channel D2 rides.
- **Tier**: mechanism. Code homes: `src/formulate.ts` (D1 recognition, D2/D3 fields),
  `src/loop-plan.ts` (D2 prefix assembly + numbering, D3 digest-keep), `src/prompt-plan.ts`
  (D2's fixed-prefix block), `src/tasks.ts` (the field render + the planned-task guard),
  `src/runner.ts` + `src/git.ts` (D2's collect backstop, the baseline content read). Test
  homes: `test/formulate.test.ts` (the state predicate, the todo-only rewrite, the fields),
  `test/transfer.test.ts` (the walkthrough: reconstruct-beside-add, the taught numbering, the
  person's task surviving the dispatch, the collect guard, the cleared-`.auto/` durability).
  Documentation homes: this document, its INDEX row, the AGENTS.md formulation navigation line.

## D1 — the constructor's recognition keys on the awaiting predicate (0165-014)

`formulationState` answers one question — may the constructor (re)write here? — and its three
arms must agree with the dispatch seam's one predicate (0101 stage C widened
`awaitingFormulation`, `standingFormulation`, `formulationNumber` and the digest-keep to "the
todo wherever it sits, beside hand-added tasks too"; the constructor's `pending` arm stayed at
"the index lists exactly one task and it is the formulation"). The rule:

- `pending` when a formulation task of this phase stands in the index and is not done —
  **wherever it sits**: beside hand-added rows too. The todo's own id is kept (the audit trail
  already names it), and the constructor rewrites **the todo alone**: the re-entry path never
  writes the index (unchanged code — the index write is the fresh path's), so the hand-added
  rows survive the reconstruct byte-for-byte. An `in_progress` formulation still refuses
  ("already in progress") — now correctly, beside rows too (the old predicate mislabeled that
  state `foreign`).
- `foreign` when the index lists work and **no** formulation task of this phase stands in it —
  the constructor only writes an empty phase. The message is restated to the new truth ("lists
  work and no formulation task of this phase stands in it"); no parser reads it.
- `none` unchanged (absent/empty index).

With D1, the finding's loop closes: after a `--new-task` add at the review stop, transfer's
reconstruct rewrites the todo beside the rows (exit 0, review stop again — the changed floor
re-renders through the existing 0101 D3 channel), and plan dispatches the re-reviewed todo.

## D2 — the review-seam fixed prefix: the todo teaches it, the digest moves with it, the collect guards it (0165-015)

The one supported way to add work beside a reviewed plan must not hand the formulation session
a numbering that collides with it. The prefix discipline (0053 D24's append rule, transposed to
the formulation's review seam) has three halves, each derived, nothing persisted:

**The predicate.** The prefix is the phase's rows beside the formulation, and it is read from
the index **only while the standing formulation has never been dispatched** (`status ===
"pending"`): a pending unit has no session output — every other row arrived through
`plan --new-task` or a person's commit. A **ran** (blocked) formulation keeps today's
row-blind floor: its extra rows are its own session's never-collected output, and 0141 D2's
re-dispatch promise ("a re-run dispatches a fresh session over the surviving files" — the
session re-plans its own crashed rows) must stay true; that state's prefix reads back from the
landed todo's own `Prefix:` field (below), never from the index — the session's output is not
the person's prefix. A fresh construction has no prefix (the constructor only writes an empty
phase, D1).

**The teaching and the numbering (compose).** While pending, the floor renders the prefix rows
into the todo as a fixed-prefix block (`existingTaskList`'s lines, the append prompt's own
format), stating the rule: their lines and documents are fixed, the planned tasks come after
them, their numbers are taken. The numbering start becomes the **deterministic floor**
(`taskNumberFloor` — the same derivation `addTask` allocates from): the taught start and the
hand-add's allocation share one rule, so the taught number can never be a number the add
already took (the finding's collision is impossible by construction), and numbers held in
other phases are passed too. While ran, the start is `max(the formulation's own number, the
recorded prefix's numbers) + 1` — past the person's rows, the crashed rows left re-takeable.
A fresh construction keeps `formulationNumber + 1` (the floor the formulation itself is about
to occupy, + 1 — nothing runs between the two, 0097 D6's own premise). The floor document now
carries the prefix, so **the digest moves with an add**: the digest-keep misses, plan's
dispatch discipline (0101 D4, unchanged) refuses naming transfer, and the reconstruct
re-renders the todo for review — the stale numbering can no longer dispatch. The
byte-identical floor: a pending formulation with no rows beside it (and no higher number
anywhere) renders the same document as before — no block, the same start.

**The record and the collect backstop (the session that violates the teaching).** The
formulation todo's field block gains a driver-written `Prefix: T-004, …` field (additive
document grammar, `Formulate:`'s shape): the rows the todo was constructed beside, rendered by
construction and read back by the ran-state floor above. At the unit's **first dispatch**
(`attempts === 1`), the collect derives the pre-session rows from the **unit-start git
baseline** (`input.baseline` — the committed state the session was dispatched over; P4 keeps
the session off git, and the unified commit lands after the collect, so the baseline is
exactly pre-session): every baseline row must still stand — present, in order, id/title/tick
unchanged (D24's first-n check, the formulation's own row included) — and each pre-existing
task's state files must be byte-identical to the baseline (a replaced document, a removed row,
a forged tick all block, naming the row). Their ids join the collect's `skip` set (present in
the dependency graph, exempt from the per-task new-task checks — a pre-existing row is not
"newly planned"). The baseline read failing (unborn repository, no baseline under the
no-commit double) degrades to the unchecked floor — the addedLines precedent (0199 D1); a
block is never raised on a failed read. A **retry** (`attempts > 1`) does not enforce: the
retrying session replans over its own prior output (0141 D2), and a killed-first-dispatch
resume (attempts already past 1) keeps the teaching as its guard — the enforcement window is
the first dispatch, where the person's rows are the only rows that can be harmed. The accept
line states the kept count when a prefix stands.

The `Formulate:`/`Closed:` planned-task guard (0171 D6, enacting S08-08) extends to the two new
driver-written fields: a session writing `Prefix:` or `Floor-Digest:` onto a task it planned is
a problem naming the driver's marker — the same reclassification hazard, closed in the same
home (`newTaskProblems`).

## D3 — the floor digest travels with the todo (0165-100)

The digest-keep's record moves to the one place that survives clones, forks and a cleared
`.auto/`: **the landed todo's own driver-written `Floor-Digest:` field**, rendered by
construction beside the todo it describes (the field's value is `floorDigest` over the floor
**preview** — the preview carries the prefix field but never the digest of itself, so the
computation is unchanged and a pre-0205 recorded digest equals a post-0205 computed one over
the same floor: the fallback is era-compatible by construction). The keep reads the field
first; `.auto/units.json`'s `synthDigest` stays readable as the **pre-0205 fallback** (a
standing construction from before this ruling has no field, and its record still serves — no
standing todo is rewritten merely to gain the field; the field lands when a construction
happens anyway). The record **write** retires (loop-plan's post-construct
`recordSynthDigest`): one home per construction era, no mirror (P5). A fresh clone of a
post-0205 construction keeps its todo (the field matches the recomposed floor — no refusal, no
re-voice); a fresh clone of a pre-0205 todo re-constructs once (the pre-fix behavior,
unchanged) and lands the field. A hand-edited or hand-deleted field makes the keep miss and
the reconstruct re-land the driver's text — the digest-keep can no longer be defeated by
clearing gitignored state, which was the finding's shape.

## Enactment notes

- `src/formulate.ts`: `formulationState` re-derived over the loader's tasks (the awaiting
  predicate's find, done excluded); the `foreign` message restated; `constructFormulation`
  gains an optional `record` (`digest`, `prefix`) threading D3's field and D2's prefix record
  into the render.
- `src/tasks.ts`: `renderTaskTodo` renders `Prefix:`/`Floor-Digest:` when present; the
  `synthDigest` runtime comment names its fallback status; `newTaskProblems` refuses the two
  new fields on a planned task.
- `src/prompt-plan.ts`: `renderFormulationTodo` gains `existingTasks` (the pre-joined
  `existingTaskList` lines) rendering the fixed-prefix block — only when non-empty (the floor).
- `src/loop-plan.ts`: compose loads the plan once, derives standing/review/prefix/numberStart,
  reads the landed todo once (its fields feed the keep and the ran-state prefix), threads
  `existingTasks` into both mode branches, previews with the prefix field, keeps on
  `Floor-Digest:` else the units record, and constructs with the record (the prefix derived
  from the preview's own field — one source); the `recordSynthDigest` call retires.
- `src/git.ts`: `contentAtBase` — the committed content of one path at a unit-start baseline
  (`ok:false` = failed read, `ok:true` + `undefined` = absent at the baseline).
- `src/runner.ts`: the formulation collect's prefix backstop (baseline rows first-n check +
  state-file identity + the skip set + the accept line's kept count), gated on
  `task.attempts === 1`.
- P13: `Prefix:`/`Floor-Digest:` are new additive field grammars on a driver-written document,
  refused on session-written ones; no frozen string changes; the digest values are
  backward-compatible across the era boundary.

## Premises

premises this ruling changes: **0097 D6 (the digest's recorded home)**. Re-read in this change:
D6's rule — idempotence keyed on the deterministic floor, never on model output, compared at
re-entry — stands unchanged; its "recorded at construction" home becomes the todo's committed
field (P18), the units.json record the pre-0205 fallback reader, the write retired. **0101
D3/D4** re-read: the review-stop channel, the reconstruct's rewrite-on-diff and the dispatch
refusal are D1/D2's carriers, unchanged. **0141 D2** re-read: the ran formulation's row-blind
floor and the retry's non-enforcement keep the "fresh session over the surviving files"
promise. **0171 D6/D7** re-read: the landed-todo digest pin covers the new fields (both render
inside the pinned document), and the row restore is untouched. Named residuals: (a) a person
adding a task **while the formulation sits blocked** is guarded by the teaching alone (the
retry does not enforce; the remedy is the reconstruct after the retry completes); (b) a
killed-then-resumed first dispatch (attempts past 1) likewise teaches without enforcing;
(c) a pre-0205 standing todo in a fresh clone still re-constructs once (the era boundary, the
pre-fix behavior).
