# plan-append — hand-run append planning

For a target directory that the auto driver has already initialized (`init`): fill in the two blocks marked
FILL IN below, then hand this file to a coding-agent session opened in the target directory. The session takes
the role of the driver's appending session (`plan --append -p <text> | --file <path>`): it surveys the
directory, plans the additional work into new task units, and appends them to the current phase's task index and
task documents. It plans only — implementation stays with later task sessions, and everything the driver owns
stays untouched.

<!-- ======================================================= -->
<!-- FILL IN — required. Replace everything between BEGIN    -->
<!-- and END with the person's own words about the           -->
<!-- additional work. If this block still holds this         -->
<!-- instruction, the session must stop and ask for it —     -->
<!-- never invent the planning input.                        -->
<!-- ======================================================= -->
## Planning input

<!-- BEGIN planning input (the person's words, kept verbatim) -->
<describe the additional work to plan: what is needed, why, and any known boundaries>
<!-- END planning input -->

<!-- ======================================================= -->
<!-- FILL IN — optional. Delete the whole section when       -->
<!-- there is nothing to add.                                -->
<!-- ======================================================= -->
## Person's notes (optional)

<!-- BEGIN notes -->
- Target phase (blank = auto-detect):
- Extra constraints, preferences, or pointers:
<!-- END notes -->

---

You are the append planner for this target directory. Work from the blocks above plus the directory's own state;
plan only, do not implement anything.

## Preflight — stop and report when any check fails

1. Initialized target directory: `.opencode/auto/config.json` exists. Otherwise stop: the person must run `init`
   first.
2. No live driver: `.auto/run.lock` absent. A running driver process owns this directory — appending beside it
   would overwrite its resume points; the person finishes or stops the run first.
3. Clean worktree: `git status --porcelain` lists nothing. Planning artifacts must commit cleanly; a dirty tree
   is the person's to commit or clean first.
4. The planning-input block above is filled (it no longer holds the placeholder instruction). Otherwise stop and
   ask the person for it — a question to the person is free here; invented scope is not.

## Find the append target

- Read `.opencode/auto/config.json`. Its `phases` value decides the layout: `"m"` is the no-phase mode — the
  implicit single phase, round `R-01`, phase `P01-implement`; anything else is the phased mode.
- No-phase mode: the task index is `docs/R-01/P01-implement/tasks.md`, the qualified phase id `R-01.P01`; there
  is no round brief and no prior-phase handovers.
- Phased mode: take the latest round (the highest `docs/R-NN/` holding a `phases.md`). Append to the phase the
  notes name; otherwise to the last phase directory (highest `P<nn>`) whose `phases.md` line is not marked
  ` (closed: …)` and whose directory holds a `tasks.md`. When two candidates are plausible, ask the person.
- The index must exist and already list at least one task line — an append adds to an existing plan, it does not
  create one. The phase's qualified id (`R-NN.P<nn>`) goes into each new task document's `Phase:` field.

## Survey (read-only)

- The index lines verbatim, and for each listed task whether `docs/T-NNN/todo.md` or `done.md` exists (exactly
  one of the two; a `Closed:` field means closed without completing — do not assume its deliverables exist).
- Every task number already taken anywhere: all `docs/R-*/P<nn>-*/tasks.md` index lines plus the `docs/T-NNN/`
  directories on disk. Numbers live on after their round ends; a number is never reused.
- The numbering record `.auto/next-task` (see Numbering).
- Planning context: `.opencode/auto/brief.md` (project intent), `docs/R-NN/round.md` (this round's goal and
  criteria, phased mode), the current phase's `plan-input.md` if one exists, the prior phases' `handover.md`
  documents (the sole channel of cross-phase memory — do not read prior phases' raw docs/), and the relevant
  source code and docs/ content.

## Write the tasks — the only writes this session makes

1. First save the planning input verbatim to `<phase dir>/plan-input.md`, overwriting whatever is there (the
   latest input wins; this is the same path the driver's append persists to).
2. Append one line per new task after the last existing line of the task index, in execution order — never
   before or between existing lines:

   - [ ] T-NNN <task title>

3. Create one task document per new task at `docs/T-NNN/todo.md`:

   # T-NNN: <task title>
   Phase: R-NN.P<nn>
   Depends: <same-level task ids, comma-separated>
   Touches: <repository-relative paths this task will change>
   Decompose: <split | whole | pipeline>

   ## Goal
   <what this task delivers>

   ## Scope
   <modules/files involved, key constraints and necessary context — self-contained, executable from this and
   docs/ alone>

   ## Acceptance
   <what counts as done>

   <!-- auto: eof -->

   The title line, the `Phase:` field line, the three section headings and the closing terminator are parsed by
   the driver — write them verbatim, never translated or rephrased. In no-phase mode the field line is literally
   `Phase: R-01.P01`.
4. Dependency fields sit right after the `Phase:` line. Without `Depends:` a task depends on the task before it
   in the index — at the append seam that means the LAST existing task, so write `Depends:` explicitly whenever
   a new task does not build on the one right before it (`Depends: none` declares no prerequisite; name
   same-level task ids only, completed tasks of earlier phases included). `Touches:` may be omitted when the
   task may touch anything (no absolute paths, no `..`). No empty values, no self-dependency, no cycles.
5. The execution-mode field `Decompose:`, in the same field block, is optional: `Decompose: split` (a lead
   session works the task and may split the remainder into parallel streams), `Decompose: whole` (one session
   carries the task to completion) or `Decompose: pipeline` (a decomposition session plans subtasks first, then
   one session per subtask) — how the task should run under the driver's default adaptive execution. Weigh the
   task's size, its parts' dependency shape and the expected session count; the choice is a recorded decision,
   and omitting the field expresses no opinion. The field name and its three values are protocol strings the
   driver parses — write them verbatim, untranslated; any other value is rejected at load.
6. Each new task focuses on one independently deliverable outcome. Do not hand-write subtask checklists —
   whether and how a task is split is decided at execution time. Deliverable files the tasks will create must
   not reference process documents (`docs/T-*`, `docs/R-*`, `docs/phases/`, PLAN.md, `.auto/`) — process
   documents are not design dependencies. When the config sets a parallel level, plan so that tasks whose
   `Touches:` paths do not overlap can run side by side.
7. The append must add at least one new task: even if the input turns out to be covered by the existing tasks,
   write one explanatory task and state the reason in its document.

## Numbering

- `.auto/next-task` present (auto numbering on): start from the number it records, never below the highest taken
  number + 1 (use the larger). After writing the tasks, update the record to the highest used number + 1 — it
  only ever increases.
- Config `autoNumber` set but the record missing (a fresh clone — `.auto/` is gitignored): stop and let a driver
  planning command rebuild it first; its recovery session reads git history, which a file scan cannot.
- No record and no `autoNumber`: start from the highest taken or listed number + 1.

## Hands off — driver-exclusive

- Never edit, reorder or renumber an existing index line, and never change an existing task's document.
- No `- [x]` ticks, no `todo.md` → `done.md` renames, no `docs/T-NNN/subtasks.md`, no `phases.md` edits, no
  writes under `.auto/` except the `.auto/next-task` update above, no chmod.
- No state-changing git commands (no commit, add, stash or the like) — the person reviews and commits; the next
  driver run needs a clean worktree.

## Finish

Report: the append target, each new task's id and one-line title with its `Depends:`/`Touches:` summary, and
what the person should review (the seam dependencies, the numbering, the saved `plan-input.md`). Then stop.
