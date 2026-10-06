# opencode-auto — concise user manual

opencode-auto drives an AI coding agent (opencode or claude) through a project one task at a time:
it plans tasks into a reviewable index, executes them in sessions it starts and watches, commits every
session itself (the unified commit — the audit trail and rollback granularity), and moves through
rounds → phases → tasks. You always work with the same three commands:

```sh
opencode-auto init <dir>   # open a project  (config layer only, no AI, nothing under docs/)
opencode-auto plan <dir>   # open a round, a phase, or tasks  (stops before any task executes)
opencode-auto run <dir>    # execute          (tasks one by one, handovers, next phase — until done)
```

`plan` is the *thinking* door, `run` is the *working* door; both share one state machine, and both are
safe to re-run at any time — state is derived from files on disk, so an interruption is recovered by
rerunning the same command.

The four things you "open":

| You want to open | Command | What happens |
| --- | --- | --- |
| a project | `init [dir]` | writes the config layer, prepares git; no AI session, nothing under `docs/` |
| a round | `plan [dir]` | establishes `docs/R-NN/` (phase index, phase directories, round brief); stops at the round-start gate for your review + commit |
| a phase | `plan [dir]` (then `run`) | hands over the finished previous phase, then a planning session lists the next phase's tasks; stops for review. `run` then executes it and hands over to the next |
| one task / a group | `plan [dir] --new-task "<title>"` / `plan [dir] -p "<text>"` | adds one task with no session / plans a group of tasks from an input, then stops for review |

## 1. Open a project — init

```sh
opencode-auto init <dir> --phases "adm" --test-by-driver    # keys not given fall back to defaults
```

- **Prerequisites**: a git repository (`init` bootstraps one itself in a non-git directory — branch
  `init.defaultBranch` or `main`, printed loudly) and a resolvable commit identity (global/`GIT_*`, or
  pass `--name <name> --email <email>` to write repository-local config; neither → refused).
- **What it writes**: `.opencode/auto/config.json` (the constitution: `phases`, `mode`, `subtask`,
  `contextLimit`, `parallel`, `testByDriver`, `idleTime`/`idleMax`, `scanExempt`, `isolate`, …),
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
  `"m"` (the default) = one implicit phase `R-01/P01-implement`, no handovers.

## 2. Open a round — plan

```sh
opencode-auto plan <dir>
# ✓ round R-01 established: P01-analysis, P02-design, P03-implement
# next (round-start gate): review the setup, fill in docs/R-01/round.md, and commit it; then run plan again
```

- The first `plan` establishes `docs/R-01/`: the phase index `phases.md`, one phase directory
  `P<nn>-<type>/` per configured phase, and the round brief stub `round.md`. It stops there (exit 0) —
  **the round-start gate**: review the setup, fill in `round.md` (`## Goal`, `## Acceptance criteria`,
  `## Release criteria`), and commit. Then `plan` again to open the first phase.
- Everything inside `docs/R-NN/` is permanent once written — never renamed or moved.
- With config `isolate`, designated nested repositories are switched onto the round branch `auto/R-NN`
  at establishment (a dirty one blocks, exit 2); `opencode-auto land` returns their work to the original
  branch later.
- **Opening the next round**: when `run` reports all phases complete, fill in `round.md`'s `## Close`
  (which decisions were restated where, which losses accepted) and commit; `plan` then runs the
  round-close check (whole-tree reference scan, `build` if configured, `## Close` filled) and establishes
  `docs/R-(N+1)/` — failing items are listed, exit 2, and nothing opens until they are fixed.

## 3. Open a phase — plan (then run)

`plan` runs the same loop as `run` under one extra stop condition: **it stops as soon as planning
succeeds, before any task executes** — everything is left for your review.

```sh
opencode-auto plan <dir>                    # hand over the finished phase, plan the next one, stop
opencode-auto plan <dir> -p "focus on X"    # the same, steering the planning session (or --file <path>)
opencode-auto run <dir>                     # execute the phase's tasks, hand over, continue to the next phase
```

- A phase opens in one of three routes (derived, no hidden state): **plan** (task index empty →
  planning session writes `tasks.md` + one `docs/T-NNN/todo.md` per task), **execute** (tasks pending →
  `run` works them; `plan` on this route just prints a notice and exits 0, keeping `plan && run`
  chainable), **handover** (all tasks done → see below).
- **Phase handover**: when a phase's tasks are all done, the next `plan`/`run` runs a distillation
  session that writes the phase's `handover.md`, then the driver renames the phase's `todo.md` →
  `done.md`, ticks `phases.md`, and commits — the next phase opens in the same invocation. The handover
  is idempotent; an interruption mid-way is finished by the rerun.
- A **knowledge (`k`) phase** has no tasks: its extraction session writes `kb.md` directly, then hands
  over.
- **Gates**: a phase type can carry gates checked at completion — `verdict` (a `Result: FAIL` in
  `verdict.md` blocks; `run --repair <N>` can append bounded repair rounds) and `acceptance` (the
  driver drafts `acceptance.md`; you sign it with an `Accepted: yes` line, commit, and re-run).
- In `m` mode there is no handover: the single phase stays open, tasks can be appended any time, and
  `run` exits 0 once all tasks are done.

## 4. Open tasks — one, or a group

Pick the lightest tool that fits:

| Scope | Command | Mechanism |
| --- | --- | --- |
| a group, fresh phase | `plan [dir] -p "<text>"` / `--file <path>` | planning session decomposes the input into tasks |
| a group, phase already lists tasks | `plan [dir] --append -p "<text>"` | appends only; never rewrites existing lines; removes a stale handover |
| one task you can already name | `plan [dir] --new-task "<one-line title>"` | no session: allocates `T-NNN`, writes `docs/T-NNN/todo.md`, commits |
| one task run outside the driver | `plan [dir] --export <T-NNN>` then `--adopt <T-NNN>` | prints a standalone work order; adopts the finished unit back in |
| by hand | edit `tasks.md` + `docs/T-NNN/todo.md` | files are the source of truth; `run` picks them up |

Notes:

- `-p`/`--file` input is stored verbatim as the phase's `plan-input.md` and committed before the
  planning session starts. It is refused (before any write) while the round is not established/complete,
  or when the target index already lists tasks — `--append` is the way to add to a planned phase.
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
- Every run logs to `.auto/logs/run-<timestamp>.log`. One driver per directory: `run`/`plan`/`close`
  hold `.auto/run.lock`; conflicting commands refuse with exit 1 naming the holder.
- **Exit codes**: `0` complete · `1` usage/environment error · `2` blocked or held for a human (FAIL
  verdict, gate, failed round-close) · `3` `/exit` received under `--interactive` (paused at a safe
  boundary — rerun to recover) · `130` force-terminated.
- **Questions go to you**: during `plan` every session question waits for a human answer without
  timeout; during `run` see `--wait-answer` / `--permission` / `--interactive` (or accept the default
  proxy-answering). Repeated/undecidable questions block the run (exit 2) for you to handle and re-run.
- **Interruption recovery**: rerun the same command; the progress record re-enters the exact interrupted
  session/step. `run --new-session` discards a stale session. Manual rollback = rename `done.md` back
  to `todo.md` (and untick index lines), rerun.
- Useful run options: `--max-sessions <N>` (concurrent lanes; requires config `parallel`),
  `--repair <N>` (bounded repair rounds on FAIL verdicts), `--dryrun` (permission preflight, no tasks
  run), `--wait-between <min>` (pause between tasks), `--server <url>` (reuse an external `opencode serve`).

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
| `amend [dir] --<key> <value>` | rewrite only the given config keys |
| `fix [dir] [-f] [--dryrun]` | repair the config layer by rule |
| `reset [dir] [-f]` | de-initialize (remove exactly init's artifacts) |
| `plan [dir] [-p \| --file]` | open round/phase: plan and stop before execution |
| `plan [dir] --append -p "…"` | append tasks to the current phase |
| `plan [dir] --new-task "<title>"` | add one task, no session |
| `plan [dir] --export <T-NNN>` / `--adopt <T-NNN>` | standalone work order out / in |
| `plan [dir] --force-close <ref> --reason "…"` | close a unit, then keep planning |
| `run [dir] [run options]` | execute tasks, hand over phases, until complete |
| `close <ref> [dir] --reason "…"` | close a unit without delivering |
| `land [dir] [--keep \| --abandon \| --merge]` | return isolated round branches |
| `status [dir]` | read-only progress tree |
| `models [dir] [--probe]` | print the effective model routing |
