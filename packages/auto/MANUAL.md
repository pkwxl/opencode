# opencode-auto — concise user manual

opencode-auto drives an AI coding agent (opencode or claude) through a project one task at a time:
it plans tasks into a reviewable index, executes them in sessions it starts and watches, commits every
session itself (the unified commit — the audit trail and rollback granularity), and moves through
rounds → phases → tasks. In a phased project you work with four commands, one per side of the
boundary between you and the work:

```sh
opencode-auto init <dir>       # open a project  (config layer only, no AI, nothing under docs/)
opencode-auto transfer <dir>   # advance one boundary: open the round, or close the finished phase and construct the next one's plan task (stops for your review)
opencode-auto plan <dir>       # dispatch: run the reviewed plan task's planning session (stops before any task executes)
opencode-auto run <dir>        # execute: the phase's tasks one by one, then stop at the phase's clean end
```

`transfer` is the *advancing* door (every boundary between rounds and phases is yours — it never
crosses one without a stop for your review), `plan` the *dispatch* door, `run` the *working* door;
all share one state machine, and all are safe to re-run at any time — state is derived from files on
disk, so an interruption is recovered by rerunning the same command. In `m` mode (the default single
phase) there is no `transfer` — it refuses — and `plan`/`run` alone drive the work as before.

The four things you "open":

| You want to open | Command | What happens |
| --- | --- | --- |
| a project | `init [dir]` | writes the config layer, prepares git; no AI session, nothing under `docs/` |
| a round | `transfer [dir]` | establishes `docs/R-NN/` (phase index, phase directories, round brief); stops at the round-start gate for your review + commit |
| a phase | `transfer [dir]` → review → `plan [dir]` → `run [dir]` | `transfer` closes the finished phase and constructs the next one's plan task, stopping for review; `plan` dispatches it (the planning session lists the tasks); `run` executes the phase and stops at its clean end |
| one task / a group | `plan [dir] --new-task "<title>"` / `plan [dir] --append -p "<text>"` | adds one task with no session / appends a group planned from an input, then stops for review |

## 1. Open a project — init

```sh
opencode-auto init <dir> --phases "adm" --test-by-driver    # keys not given fall back to defaults
```

- **Prerequisites**: a git repository (`init` bootstraps one itself in a non-git directory — branch
  `init.defaultBranch` or `main`, printed loudly) and a resolvable commit identity (global/`GIT_*`, or
  pass `--name <name> --email <email>` to write repository-local config; neither → refused).
- **What it writes**: `.opencode/auto/config.json` (the constitution: `phases`, `mode`, `subtask`,
  `contextLimit`, `parallel`, `treeLanes`, `testByDriver`, `idleTime`/`idleMax`, `scanExempt`, `isolate`, …),
  `.opencode/agent/auto.md` (the session contract), `opencode.json`, `.gitignore` entries,
  `.auto/` + `tmp/` workdirs, the `AGENTS.md` marker block, and the project brief stub
  `.opencode/auto/brief.md` (sections `## Goal` / `## Source` / `## Target` / `## Constraints`).
  **Fill in the brief** — every planning session reads it; `init` starts no AI sessions.
- **Config semantics**: `init` is a stateless full overwrite (keys not given revert to defaults).
  Change a few keys with `opencode-auto amend <dir> --<key> <value>`; repair drift with `fix`;
  remove the layer with `reset`; `init`/`amend`/`fix` never touch round directories.
- **`phases`** picks the flow: a subsequence of `admtvk` containing `m`
  (`a` analysis → `d` design → `m` implement → `t` test → `v` acceptance → `k` knowledge), or a comma
  list of type ids containing `implement` (custom types from `.opencode/auto/phases/<type>.md` allowed).
  `"m"` (the default) = one implicit phase `R-01/P01-implement`, no handovers — the plan/run-only mode.

## 2. Open a round — transfer

```sh
opencode-auto transfer <dir>
# ✓ round R-01 established: P01-analysis, P02-design, P03-implement
# next (round-start gate): review the setup, fill in docs/R-01/round.md, and commit it; then run transfer again
```

- With the assisted analysis on (`OPENCODE_AUTO_ANALYSIS`, default), a fresh project's first
  `transfer` opens `docs/analysis.md` instead — work with your agent on the analysis, the goals, the
  project-brief proposal and the multi-round roadmap, then add the line `Clarified: yes` and commit;
  the next `transfer` installs the approved brief and establishes R-01 under the roadmap's line.
- `transfer` establishes `docs/R-01/`: the phase index `phases.md`, one phase directory
  `P<nn>-<type>/` per phase (the released roadmap's line for the round rules; the config `phases`
  value the fallback), and the round brief stub `round.md`. It stops there (exit 0) — **the
  round-start gate**: review the setup, fill in `round.md` (`## Goal`, `## Acceptance criteria`,
  `## Release criteria`), and commit. The next `transfer` constructs P01's plan task (see §3).
- Everything inside `docs/R-NN/` is permanent once written — never renamed or moved.
- With config `isolate`, designated nested repositories are switched onto the round branch `auto/R-NN`
  at establishment (a dirty one blocks, exit 2); `opencode-auto land` returns their work to the original
  branch later.
- **Opening the next round**: when `run` stops at the round's last boundary with every phase complete,
  fill in `round.md`'s `## Close` (which decisions were restated where, which losses accepted) and
  commit; `transfer` then runs the round-close check (whole-tree reference scan, `build` if
  configured, `## Close` filled, the round user report in place) and establishes `docs/R-(N+1)/` from
  the roadmap's next line — failing items are listed, exit 2, and nothing opens until they are fixed.
  A released roadmap governs the end: past its last line `transfer` stops pointing at
  `## Roadmap` as the place to extend, never silently opening a config round.
- In `m` mode `transfer` refuses (exit 1): `plan` establishes the single phase as before.
- **Reshaping the round**: `amend --phases` at a phase boundary (or with no phase in progress)
  changes the config value, and the next `transfer` re-derives the round's **unstarted** phase tail
  from it before constructing (a released roadmap's line still wins); mid-phase it refuses, naming
  the boundary. Started or completed phases are never reshaped.

## 3. Cross a phase boundary — transfer → review → plan → run

One phase per cycle, four steps, each stopped for you:

```sh
opencode-auto transfer <dir>    # 1. close the finished phase (handover distillation), construct the next one's plan task, stop for review
#                                2. by hand: review the constructed todo (fix its inputs — round.md, plan-input.md, the brief — never the todo)
opencode-auto plan <dir>        # 3. dispatch: the planning session writes the phase's tasks.md + docs/T-NNN/todo.md per task
opencode-auto run <dir>         # 4. execute the tasks; stop at the phase's clean end — the next boundary
```

- **Step 1 — the advance**: `transfer` performs one boundary step: a survey phase with open `Fork:`
  lines refuses first (exit 2, no session run) — resolve them, write `Clarified: yes`, commit, re-run;
  otherwise the finished phase's `handover.md` is distilled, its `todo.md` → `done.md`, and the next
  phase's **plan task** (the formulation todo, driver-owned) is constructed and stopped for review.
  A rejected todo is fixed through its inputs (the round brief, the phase's `plan-input.md`, the
  project brief, the roadmap line) and the re-run — never by editing the todo;
  `transfer --resynthesize` re-voices a rejected synthesized ledger.
- **Step 3 — the dispatch**: `plan` runs only the reviewed plan task's planning session (it refuses
  while the round brief is the untouched stub, and execute work belongs to `run`). A phase's planning
  input is written to its `docs/R-NN/P<nn>-<type>/plan-input.md` — `plan --phase` points your agent
  at it with the pack's scaffold — and the construct reads it as written.
- **Step 4 — the execution**: `run` executes the phase's tasks one by one and stops at the phase's
  clean end, naming `transfer` as the next command (`run --boundary flow` crosses the boundaries
  continuously as before — the older single-invocation shape).
- A **knowledge (`k`) phase** has no tasks: its extraction session writes `kb.md` directly, then the
  boundary follows.
- **Gates**: a phase type can carry gates checked at completion — `verdict` (a `Result: FAIL` in
  `verdict.md` blocks; `run --repair <N>` can append bounded repair rounds) and `acceptance` (the
  driver drafts `acceptance.md`; you sign it with an `Accepted: yes` line, commit, and re-run).
- In `m` mode there are no boundaries: the single phase stays open, tasks can be appended any time
  (`plan -p` plans them), and `run` exits 0 once all tasks are done.

## 4. Open tasks — one, or a group

Pick the lightest tool that fits:

| Scope | Command | Mechanism |
| --- | --- | --- |
| a group, fresh phase | `plan [dir] --phase` then `transfer [dir]` (phased) / `plan [dir] -p "<text>"` (m mode) | the planning input becomes the phase's plan-input.md; the construct/session plans the tasks from it |
| a group, phase already lists tasks | `plan [dir] --append -p "<text>"` | appends only; never rewrites existing lines; removes a stale handover |
| one task you can already name | `plan [dir] --new-task "<one-line title>"` | no session: allocates `T-NNN`, writes `docs/T-NNN/todo.md`, commits |
| one task run outside the driver | `plan [dir] --export <T-NNN>` then `--adopt <T-NNN>` | prints a standalone work order; adopts the finished unit back in |
| by hand | edit `tasks.md` + `docs/T-NNN/todo.md` | files are the source of truth; `run` picks them up |

Notes:

- In a phased project a planning input never rides `plan -p` (refused, pointing at the phase's
  `plan-input.md`): write the file — `plan --phase` assists — commit, and the next `transfer`
  constructs from it. `--append -p` keeps working everywhere (it adds tasks to a phase that already
  lists some). The input is committed before the planning runs; a changed text restarts an open
  planning step.
- `--new-task`'s title becomes the index line and the task's `## Goal`; sharpen `## Scope` /
  `## Acceptance` in `docs/T-NNN/todo.md` before `run`. It refuses while a task is mid-pipeline or a
  planning/append/handover step is open — finish that with `plan`/`run` first.
- **Replace or skip a unit**: `plan <dir> --force-close T-005 --reason "…"` closes it and continues
  planning (compose with `--append`/`--new-task` to swap in work); `plan <dir> --force-close R-01.P02
  --reason "…"` skips a whole phase. Outside `plan` the same is `close <ref> [dir] --reason "…"`
  (`ref`: `T-NNN`, `R-NN.P<nn>`, `R-NN`; options `--cascade`, `--commit-changes`/`--stash-changes`).
  Closed units are ⊘ "closed, not delivered"; undo is `git revert` of the close commit.
- `--export` renders the ready unit's work order on stdout (nothing persisted); `--adopt` re-checks
  readiness, runs the test-handover protocol, ticks/renames and commits the unit the driver way.

## Watching, waiting, recovering

- `opencode-auto status [dir]` — config summary and the read-only round → phase → task → subtask tree
  (`✓` done, `⊘` closed, `▶` current); prints a live run lock if one is held.
- Every run logs to `.auto/logs/run-<timestamp>.log`. One driver per directory:
  `run`/`plan`/`transfer`/`close` hold `.auto/run.lock`; conflicting commands refuse with exit 1
  naming the holder.
- **Exit codes**: `0` complete (a stop with the next step named — review stops and boundary stops
  included) · `1` usage/environment error · `2` blocked or held for a human (open survey forks, FAIL
  verdict, gate, failed round-close) · `3` `/exit` received under `--interactive` (paused at a safe
  boundary — rerun to recover) · `130` force-terminated.
- **Questions go to you**: during `plan` and `transfer` every session question waits for a human
  answer without timeout; during `run` see `--wait-answer` / `--permission` / `--interactive` (or
  accept the default proxy-answering). Repeated/undecidable questions block the run (exit 2) for you
  to handle and re-run.
- **Interruption recovery**: rerun the same command; the progress record re-enters the exact interrupted
  session/step. `run --new-session` discards a stale session. Manual rollback = rename `done.md` back
  to `todo.md` (and untick index lines), rerun.
- Useful run options: `--max-sessions <N>` (concurrent execution; requires config `parallel` — by default tier 0, serial task sessions with the tests as parallel processes; config `treeLanes` `on`/`auto` runs worktree lanes),
  `--boundary stop|flow` (stop, the default, ends the run at each clean phase end naming `transfer`;
  flow crosses boundaries continuously), `--repair <N>` (bounded repair rounds on FAIL verdicts),
  `--dryrun` (permission preflight, no tasks run), `--wait-between <min>` (pause between tasks),
  `--server <url>` (reuse an external `opencode serve`).

## Unit document formats (for hand-written tasks)

```md
<!-- docs/R-01/P02-design/tasks.md — order and membership only -->
# Tasks

- [ ] T-004 Draft the storage design
```

```md
<!-- docs/T-004/todo.md — the task body -->
# T-004: Draft the storage design
Phase: R-01.P02
Depends: T-003        # optional, comma list of same-level ids; default = previous entry, `none` = free
Touches: src/db/      # optional, repository-relative paths (parallel lanes need disjoint sets)

## Goal
…
## Scope
…
## Acceptance
…
```

A task is complete when its `todo.md` has been renamed `done.md` by the driver (the index tick is a
redundant view); phases follow the same `todo.md`/`done.md` convention inside `P<nn>-<type>/` with a
`Type:` field line. Never hand-rename units the driver owns, and never commit from a session — the
driver's unified commit is the completion condition.

## Command cheat sheet

| Command | Purpose |
| --- | --- |
| `init [dir] [keys]` | open a project: write the config layer (full overwrite) |
| `amend [dir] --<key> <value>` | rewrite only the given config keys (`--phases` at a boundary reshapes the round's unstarted tail) |
| `fix [dir] [-f] [--dryrun]` | repair the config layer by rule |
| `sync [dir] [-f] [--dryrun] [--from-bundle]` | upgrade a materialized intent bundle to the running binary's (never writes person-edited files, never deletes extras; `--from-bundle` overwrites differing unstamped files) |
| `reset [dir] [-f]` | de-initialize (remove exactly init's artifacts) |
| `transfer [dir] [--resynthesize]` | advance one boundary: open the round, or close the finished phase and construct the next one's plan task (stops for review) |
| `plan [dir]` | dispatch the reviewed plan task (m mode: also establishes and plans) |
| `plan [dir] --phase` / `--round` | prepare the next phase's planning input / the round brief with your agent |
| `plan [dir] --append -p "…"` | append tasks to the current phase |
| `plan [dir] --new-task "<title>"` | add one task, no session |
| `plan [dir] --export <T-NNN>` / `--adopt <T-NNN>` | standalone work order out / in |
| `plan [dir] --force-close <ref> --reason "…"` | close a unit, then keep planning |
| `run [dir] [--boundary stop\|flow]` | execute the phase's tasks; stop at its clean end (flow crosses) |
| `close <ref> [dir] --reason "…"` | close a unit without delivering |
| `land [dir] [--keep \| --abandon \| --merge]` | return isolated round branches |
| `status [dir]` | read-only progress tree |
| `models [dir] [--probe]` | print the effective model routing |
