# 0211 — The checklist's writer, the park/repair boundary arms, the repair confinement's truth, the decompose kill window, the step gate's order

Status: **active**. Ruled by 0166 step 051 (findings 0165-017, 0165-082,
0165-083, 0165-106, 0165-107; the evidence, reproductions and register rows in
[0165-review/S10-dispatch.md](./0165-review/S10-dispatch.md) S10-03/S10-04/S10-06
and [0165-review/S05-loop-task.md](./0165-review/S05-loop-task.md)
S05-05/S05-06).

## Derivation and Category scope

Derives: **P2** (the person brackets every boundary — D1: the execution mode is
the person's choice, and agent output cannot convert itself into the person's
checklist; D2: a pending /exit lands at the first safe point, and the parked
and repair-closed units' landings are safe points), **P7** (grammars, never
content — D1's guard is a mechanical ownership comparison, HEAD's copy against
the session's leave, never a judgment of the items), **P20** (in-flight work is
never destroyed; control changes land at safe boundaries — D2's hooks at the
park/repair landings, D4's kill-window artifacts committed as the stage's own,
D5's partial artifact cleared by the reset it was always promised to), **P6**
(derived state, re-derivation — D4 re-derives the interrupted stage's commit
from the tree's state; D5 re-derives the unit's baseline without a gate the
record already answers), **P8** (deliberate enforcement moments — D2's
close-out audit at the unit's own landing; every new line teaches its remedy),
**P5** (single ownership — D3: one stated boundary with one enforcing shape,
the confinement text and the code made to agree), **P3-adjacent through P4**
(D4: the decompose artifacts reach their completion condition — the commit —
on the re-run, 0149's run → re-run promise). Amends: none at the principle
tier; 0156's hygiene clause ("worktree lanes and isolation do not") corrected
at the decision level (below). Tier: mechanism.

### Category scope

- Code homes: `src/execute.ts` (D1 `executeWhole`'s none-scope checklist
  guard; D4 `ensureDecomposed`'s existing-checklist commit), `src/loop-task.ts`
  (D2 `runSerialUnit`'s parked and repair-appended arms + the doc loop's two
  blocked-keep arms; D3 rides the same repair sites), `src/loop-preflight.ts`
  (D3 `RunAllOpts.repair`'s comment — the boundary's one descriptive home),
  `src/artifact.ts` (D5 `requireArtifact`'s unit-gate rungs).
- Test homes: `test/agent-fake.test.ts` (D1's none-scope pin and committed
  floor; D2+D3's doc-loop repair case), `test/park.test.ts` (D2's parked-arm
  /exit and close-out pins), `test/repair-loop.test.ts` (D2's
  repair-appended step-pause pin), `test/auto-doc-shape.test.ts` (D4's
  kill-window pin), `test/artifact.test.ts` (D5's dead-session partial-artifact
  pin).
- Documentation homes: AGENTS.md navigation lines (the task pipeline's
  checklist ownership; the bounded-repair boundary), `docs/structure.md` rows
  where responsibility shifted, `plans/INDEX.md` row + the 0156 annotation.

## Decisions

### D1 (0165-017) — a checklist written outside any split clause is never the person's

Outside the lead's split clause (`split === "none"`: mode off, auto's lead
without the clause, a doc-lane whole session that is not the clause's lead),
a `subtasks.md` the whole-task session wrote was committed by the stage's
close-out and then run by the subtask loop as the person's — one session per
agent-authored item, no 2–5 bound, no disjointness guard, no rejection
(runner's loop comment: "off (and auto without a split) only have the items
hand-written in subtasks.md" — the premise the session's obedience made
untrue). 0059 D4 built the guard for the clause scopes and named the hazard
for the blocked lead only; the no-clause scopes had no guard at all.

The stage's starting checklist — the HEAD copy, the disk copy only without a
commit — is now derived for EVERY whole-task scope, not only the clause's
(the same derivation, one home). A checklist that differs from it after a
session in a scope that offered no clause is removed the way the rejected
state is: the base restored (or the file removed when the stage started from
none), untracked `S<nn>/todo.md` scope files removed (`dropSplit`, the one
removal home), one log line teaching the rule — at the natural close-out
(before the execute commit, so the commit holds the session's work alone),
and the blocked and parked arms' existing unjudged removals extend to the
none scope with the scope-true wording. `judgeSplit` never judges a
none-scope checklist (an explicit guard beside the drop): no clause was
offered, so there is nothing to take — 0059's guard family completed over its
remaining scope.

The floor: a checklist identical to the stage's starting copy (a person's, or
the planned pipeline's — committed either way, and the only kind the clean
gate lets start) runs exactly as before; the lead's clause scopes are
byte-identical; the committed-checklist lead (the "already holds a checklist"
case) keeps its base and its behavior, gaining only the rewrite guard.

### D2 (0165-082) — the park and repair landings run the boundary machinery

The serial loop's parked and repair-appended returns, and the doc loop's two
blocked-keep arms (the landing and the flatten), returned without the
task-boundary hook set — no step pause, no /exit checkpoint, no hibernate
check, no task-scope down-mark clear, no /failback consumption — under a park
comment claiming "the boundary hooks run at the next unit as usual" (false:
the done arm runs them only after the NEXT unit completes, so a pending /exit
waited through a whole further unit — 0143's measured complaint, these arms'
shape; a hibernate window opened there was missed; a task-scope down mark
leaked into the next unit's routing). The serial parked arm also skipped the
unit's commit-range audit (`unitViolations`), so a foreign commit made during
a parked unit's session was never checked. The worktree lane loop already
runs the hooks at every landing, parked included — these arms are the
exception, not the rule.

Enacted: the parked and repair-appended returns of `runSerialUnit` run, in
the done arm's own order, the close-out audit over the unit's baseline (exit
2 naming the violations, the failure event) and then `taskBoundary` — the
park commit and the repair close ARE the unit's landing, a safe point by
construction (everything committed, the unit waiting or closed). The doc
loop's landing blocked-keep arm runs the hooks in the probe form beside its
regression boundary (a /exit seen there stops dispatching and takes effect
after the drain, the landing's own rule); the flatten's blocked-keep arm runs
them in the plain form beside its own (one unit at a time, nothing in
flight). The park comment states the true hook placement. 0012 (step mode),
0027 (hibernate), 0143 (/exit) and 0055 §6.4 (the task-scope marks) are
enacted at the arms that skipped them — their letters amended by nothing.

### D3 (0165-083) — the repair confinement retired; the true boundary stated

The confinement — "never under worktree lanes or branch isolation"
(`RunAllOpts.repair`'s comment, restated by 0156's hygiene sweep) — is
enforced nowhere: `repairRoundAppend`'s guards are the stop condition and the
budget alone. Both lane loops' serial degrades (which run units in the main
tree after the lanes drained) and both phase-level gates open repair rounds
under worktree lanes and the isolation switch; the doc loop's finishBlocked
was ruled in by 0099 D3 outright. The confinement text was the defect: 0079
§6's "No repair under lanes … (serial run path, v1)" named a v1 scope, and
the hazard it reasoned about — an append into the index the lanes schedule
from — does not reach a single current site, because the append (the index
mutation, `appendPlan`) runs only after the task loop returned, every lane
drained.

Ruled: the confinement is retired and the true boundary stated in the
option's one descriptive home — repair rounds open wherever the FAIL or held
gate is judged with no lane in flight: the serial path, both lane loops'
serial degrades (post-drain), the doc loop's finishBlocked (after the quiet
wait), and the two phase-level gates (post-loop); a lane worker's own blocked
exit never opens one (the parent lands the committed work and stops for the
person, 0068's matrix); never under a stop condition; and the append mutates
the index only after the task loop returned, so no scheduler ever reads a
mid-flight change. The lanes-×-repair case the finding found untested is
pinned (the doc-loop round, D2's own test) so a future "enforcement" cannot
land silently. The alternative — enforcing the confinement in
`repairRoundAppend` — declined: it would refuse behavior 0098 D5 and 0099 D3
already ruled in, to prevent a hazard that is structurally absent.

### D4 (0165-106) — the decompose kill window re-derives its commit

A kill between the decompose session's end and its `decompose` commit left
the artifacts on disk and uncommitted; the re-run's "already exists" path
injected the checklist without committing it, and subtask 1's start gate
stopped exit 2 on the unit's own decomposition as "leftover from an abandoned
run or manual changes" — a remedy naming the driver's own output as foreign,
0149's run → re-run promise broken at the first subtask.

The existing-checklist path now runs the same `decompose` stage commit
(`afterSession`, the one seam) before returning: the tree's state is the
guard — `commitTree` skips a clean repository, so an already-committed
decomposition (or a hand-written checklist the clean gate proved committed)
passes byte-identically, and the killed session's finished output lands as
the stage's own commit, the first subtask's gate meeting a clean tree. The
fork base the kill may also have lost (its `setForkBase` sits inside the
killed window) is not re-derived: the per-agent bases build lazily on first
use (0055 §8.4's own rule) — the re-run costs one digest-base session at
most, never a stop. The path's "existing files are not re-audited"
compatibility read keeps its letter (a twice-failed decomposition reused
unchecked stays the named residual, unchanged by this ruling).

### D5 (0165-107) — the fresh rung of a matching open step record skips the unit gate

`requireArtifact` ran the unit-start clean gate before `spec.reset`: an
interrupted phase step whose session was gone (or a strict-resume rollback /
foreign-commit redo, a `spec.restart`, a record whose model the registry does
not know) stopped `dirty` on the killed session's own partial artifact — the
caller's own contract ("a partly written handover is cleared by reset and
rewritten") was true only on the reuse rung.

The record answers the gate's question: when the open progress record names
THIS step (the same match the reuse rung keys on), the fresh rung takes the
baseline without the clean gate — exactly the reuse rung's arm, 0149's
reading (an active record makes the tree's dirt the interrupted unit's
resumable progress) extended from run start to the step gate — and the fresh
loop's reset then clears the step's own partial artifact before the new
session rewrites it. A genuinely fresh step (no matching record — the record
absent, or naming another step) keeps the gate byte-identically; the
reuse-rung exemption is unchanged (it is the same arm, now stated once).
Both step+unitStart callers (the handover distillation, loop-plan's append)
inherit through the one home.

## Premise guard

premises this ruling changes:

- **0156's hygiene clause** — "the repair confinement restated — doc lanes at
  tier 0 repair, worktree lanes and isolation do not … in the opts comment
  and AGENTS.md": the "worktree lanes and isolation do not" half was a
  restatement of a boundary the code never had; restated per D3 (no lane in
  flight at the judgment site; never a lane worker's own blocked exit; the
  append post-loop). INDEX row annotated.
- **0059 D7** — the no-clause lead ("an agent that cannot fork … runs as a
  plain whole-task session", STEER off the same) carried the consequence its
  own suite pinned: "a checklist it writes runs after it, unjudged". That
  consequence is the defect 0165-017 measured (the person's execution mode
  overridden by agent output, no bound, no guard); restated per D1: the
  none scope's checklist is removed at the close-out, never run as the
  person's — the clause withholding itself (D7's degradation floor) stands
  unchanged, and the two suite pins re-pointed in the same lockstep. INDEX
  row annotated.

Re-read, standing: 0059 D4 (the guard's shape — D1 completes its scope
enumeration over the none scope, the guard's criterion unchanged); 0096 D7 (the park's
readiness semantics — untouched; D2 adds the hooks the comment falsely
claimed); 0012/0027/0143/0055 §6.4 (the boundary letters — D2 enacts them at
the missed arms); 0021 P2 and 0149 (D5 extends the resumed-unit reading to
the step gate's fresh rung, the gate itself standing for fresh steps); 0098
D5 / 0099 D3 (D3 states the boundary they already ruled in); 0030 D5 (the
compatibility read — D4 adds the commit, the no-session injection unchanged).

## Residuals (named)

1. D1 pins the serial whole-task scope (mode off) and the committed-checklist
   floor; the doc-lane whole session's none-scope arm rides the same code
   path unpinned end-to-end (its prompt carries the concurrency clause, not a
   split clause — the guard is the same `executeWhole` home).
2. D2's hibernate half is unpinned (a window-shaped pin would cost the suite
   a real sleep; the hook set is one call, pinned through the step pause and
   the /exit checkpoint jointly). The repair-appended /exit label is pinned
   through the step pause alone (the same `taskBoundary` entry, one statement
   apart).
3. D3's lock-pin covers the doc-loop task site; the two phase-level gate
   sites and the degrades are covered by their existing suites' behavior
   (repair-loop, lanes) and the boundary's statement — no per-site width pin
   (the helper is one home; the pin locks the shape a future enforcement
   would have to change).
4. D4: a twice-failed decomposition's artifacts reused unchecked on a bare
   re-run (the compatibility read's own letter) stays as it was — a
   re-audit rule would judge content, P7's line.
5. D5: the restart arm's planning-input commit stays committed (0053 D9's
   own shape); a record whose `phase.step` matches but whose baseline cannot
   be read takes today's `unitBaseline` failure direction (P12, unchanged).

## Vocabulary (P13)

No frozen vocabulary changes: exit codes, event vocabularies, document
grammars and protocol literals are untouched; the new lines are log prose;
the two scope-true unjudged wordings keep the clause scopes' lines
byte-identical; `RunAllOpts.repair`'s type and every refusal text unchanged.
Floors byte-identical where no defect was ruled: the clause scopes' guard,
the committed checklist's run, the serial done arm, the worktree lane loop's
landings, the clean-tree existing-checklist path, the fresh step's gate, and
the reuse rung.
