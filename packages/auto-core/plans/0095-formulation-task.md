# 0095 — The formulation task: planning as the phase's first task unit

The planning session becomes the phase's first ordinary task unit. Its `todo.md`
is the single synthesized prompt input (deterministically assembled by the driver
from the same sources today's composed planning prompt stacked as blocks), its
execution rides the ordinary task pipeline, and — the prize — its `## Acceptance`
is judged by the standard wrap-up verification session (plans/0083), so plan
quality becomes a verified artifact with bounded re-planning through the fix
loop instead of an unjudged session output.

Ruled with the person, 2026-10-14: (1) deterministic floor now, charter-gated
synthesis as a separate later change (Stage 2, §7); (2) wrapup verifies the
formulation task; (3) incremental landing — this document specifies Stage 1.

## D1 — The formulation task unit

Every task-bearing phase planned by the driver gets a **formulation task** as
the first entry of its task index (plans/0095's only new task-document grammar:
the `Formulate: <qualified phase id>` field, driver-written, recognized only
when the value equals the owning index's phase — a hand-written look-alike on a
task of another phase matches nothing and behaves as a normal task).

- **Construction** (`src/formulate.ts`, modeled on `addTask` / plans/0058):
  the driver allocates the next number, writes `docs/T-NNN/todo.md` through
  `renderTaskTodo` (title `Formulate the <PhaseName> tasks`, fields `Phase:` +
  `Formulate:` + `Depends: none` + `Decompose: whole`), writes the index's
  first line, and lands one commit — subject `PLAN formulate <phaseTitle>`,
  `Auto-Stage: phase-formulate`. Numbering: with the record (restored first by
  the caller through `ensureNumbering` exactly as before) the record leads,
  never below the deterministic floor; the record advances past the
  formulation number at construction (addTask's two-state rule). Construction
  is idempotent: when the index already lists exactly the pending formulation
  task, the body is re-rendered and rewritten (its own commit) only when it
  differs — the changed-input restart path; a formulation task already
  `in_progress` is never rewritten (the session may have read it; the run
  blocks asking the person to let it finish or close the phase).
- **The todo is the single input**: `## Goal` (formulate the phase's complete
  task plan), `## Scope` (the deterministic assembly of exactly the blocks
  today's `phase-plan`/`implement-plan` templates stacked — brief, round brief
  + round rules, approved analysis (human-gated phases), planning input, mode
  preamble, precedence, handovers, prevRound digest, phase duties +
  artifact conventions + report duty, parallelism — followed by the task-writing
  protocol skeleton moved from `phase-plan.md`), `## Acceptance` (D2). The
  session runs under the ordinary whole-task machinery (`whole.md` wrapper,
  `Decompose: whole`), so the todo is literally the single prompt input — the
  conflict-bearing block stack exists only at construction time, and the
  precedence block inside the Scope is its resolved record.
- **Execution**: the plan route constructs, then runs the formulation task
  through `runSerialUnit` (the serial unit path, exported from
  `src/loop-task.ts`) — deliberately not through the lane scheduler: the
  formulation task is a phase's only ready unit, its Touches are everything,
  and it must complete before anything it plans can run. `run` continues into
  the execute route for the remaining tasks; `plan` stops after the
  formulation task completes (its review point, as before, is the completed
  plan — `plannedLines` lists the index entries after the formulation one).
- **m mode unifies**: P01-implement gets a formulation task like any phase.
  The three m-mode differences of plans/0053 D12 collapse — the renderer is
  the same assembly (manual variant: no round/handover/phase framing,
  `finalPhase` always), the routing role is the task site's ordinary phase
  key, and the no-record numbering floor rule moves into construction. The
  input-required rule stays: m-mode construction refuses without a planning
  input.

## D2 — Charter as acceptance, wrapup as the plan gate

The formulation task's `## Acceptance` is the plan-quality charter: the generic
core (every obligation the Scope's inputs name is covered by a task or an
explicitly recorded deferral; every task's acceptance verifiable by inspection;
every task executable from its document plus docs/ alone; decisions recorded;
the driver's format protocol followed) plus — when the active pack declares
`## guarantees` / `### verify-plan` — that charter text appended verbatim
(zero new intent schema: the bundle charters become the acceptance source
directly). The standard 0083 wrap-up session judges these criteria by
inspection of the unit's commit range (which contains the new task files);
`gaps.md` entries ("objective X uncovered") open the bounded fix rounds, where
a fix session edits/appends the task list to close the named gaps — bounded
re-planning through existing machinery. No wrapup-template change.

## D3 — The mechanical collect

`plannedTaskProblems` still guards the format layer: it runs inside
`runTask`'s pipeline (after the formulation session, before wrap-up — the slot
`requireArtifact`'s collect occupied), over the index with the formulation
entry skipped per-task but present in the dependency graph (`skip` option;
`before` = taken ids ∪ nothing — the formulation entry is excluded by `skip`,
not reported as pre-existing). `numberStart` is the formulation number + 1.
Problems block the task (the outcome is `blocked` with the problem lines — a
conscious v1 simplification: the one feedback retry of the bypass era is not
re-built; a re-run dispatches a fresh session over the surviving files).
On pass, the numbering record advances to the highest listed number + 1 when
it exists.

## D4 — Re-homed machinery, retirements

- The `requireArtifact` planning call, the `PLAN` pseudo task, the
  `phase-plan` step record and its `openStep` precedence arm retire. A legacy
  open `phase-plan` record (rounds mid-planning at upgrade) is closed with a
  warning, `resetPlanning` clears its un-taken output, and file routing
  proceeds into the formulation path — `resetPlanning` survives as that legacy
  migration helper only. `phase-append` step records are untouched.
- An interrupted formulation task resumes as any task: under `run` the execute
  route re-dispatches it with the recovery ladder; under `plan` the execute
  route's stop check recognizes "every not-done task is a formulation task"
  and routes it back through the plan branch instead of the execute notice.
- `planDutyText` gains an optional render ctx (phaseName, testByDriver): the
  empty-ctx wart (empty `{{phaseName}}` parens, silently dropped
  `{{#if testByDriver}}` line in every default-intent planning/append prompt)
  is fixed for the formulation assembly and the append path alike.
- `closeUnit` refuses a formulation task (closing it closes the phase's
  planning surface — the phase-level close is that lever).
- `verifyPlanStep` stays, retargeted: it judges the constructed todo (the
  same charter source, the same `prompt-audit.md` trail) after construction
  and before the session, step id `formulation <phaseId>`.
- `templates/prompts/phase-plan.md` and `implement-plan.md` retire with their
  renderers and template markers; `phase-append.md` is untouched
  (`plan --append` is out of scope, D23–D27 unchanged). The protocol skeleton
  (task-document format, index format, `Depends:`/`Touches:`/`Decompose:`
  fields) moves verbatim into the formulation todo's Scope; the tier-1 marker
  list keeps the skeleton literals pinned there. A project's `phase-plan.md`
  overlay no longer has an effect (the todo assembly is code, consciously not
  template-driven in Stage 1; overlays of `_partials.md` — duty texts,
  question rule — still apply through `planDutyText`).
- The manual prompt suite mirrors the driver (0088): the master control
  constructs the formulation task (`PLAN formulate`, stage `phase-formulate`,
  the formulation-first index convention) and dispatches it as an ordinary
  task child; the ratchet test syncs.

## D5 — Interaction notes pinned during design

- The planning input stays verbatim (person-channel discipline): the Scope
  embeds it under its own heading, quoted, not paraphrased.
- The admission warn (0082 D14b) keeps its place at input save; the
  compose-and-verify loop keeps its remediate re-compose (re-render +
  rewrite-on-diff covers the recomposition).
- `plan --new-task` on an unplanned phase still bypasses formulation (the
  hand-listed path, as today); a phase whose index was hand-filled never gets
  a formulation task.
- Lanes: the formulation task never schedules (it runs in the plan branch,
  serially, before the scheduler's phase); the remaining tasks schedule
  normally afterwards.

## D6 — Test surface

New `test/formulate.test.ts` (construction shape and grammar, idempotent
re-entry, rewrite-on-diff, in-progress refusal, charter assembly with and
without verify-plan, recognition); `test/golden/` gains the assembled-todo
golden, loses the six `phase-plan-*` and implement-plan goldens; the pinned
suites amend (plan-loop, plan, tasks, artifact, verify-loop, close, repair,
session-opts, resume, intent-guarantees, golden, prompt-phase,
prompt-template, manual-prompts-ratchet).

## D7 — Stage 2 sketch (separate change)

Where the pack declares `### verify-plan`, a constructor session replaces the
deterministic assembly: it synthesizes the `## Scope` under the charter,
citing/anchoring the person's input and protocol lines verbatim, judged by a
separate cheap fidelity pass over constructed-todo-vs-sources;
`prompt-audit.md` gains synthesis-rationale entries. Default-intent projects
keep the deterministic floor forever.
