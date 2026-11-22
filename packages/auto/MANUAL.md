# opencode-auto — concise user manual

The protocol does nothing via push (plans/0283): this binary initializes and maintains a driver-governed
project and carries your local tooling; the work itself is pulled. A phase's tasks, the planning, the
distillation and the construction are **grants external coding agents claim over the executor protocol**,
and your acts — the boundary advance, the release, the task add — are a **daemon's operations** over REST
with a token. The same state machine as ever — rounds → phases → tasks, the unified commit after every
session (the audit trail and rollback granularity), state derived from files on disk so an interruption is
recovered by re-running — only the doors changed:

```sh
opencode-auto init <dir>                     # open a project (config layer only, no AI, nothing under docs/)
opencode-auto-server register <dir>          # whitelist the project with a daemon; `opencode-auto-server serve` hosts it
POST /projects/<project>/transfer            # advance one boundary: open the round, or close the finished phase and construct the next one's floor (stops for your review)
POST /projects/<project>/clarify             # your release act: write `Clarified: yes` into the one awaiting gate and commit it
POST /projects/<project>/tasks              # add one task (the one-line title)
POST /projects/<project>/executor/claim      # the executor workers' pull surface: the grants (formulate, execute, verify, fix, distill, synthesize, audit)
```

The transfer operation is the *advancing* door (every boundary between rounds and phases is yours — it
never crosses one without a stop for your review), the clarify operation the *release* door, the claimed
grants the *working* door; all share one state machine, and all are safe to re-run at any time — state is
derived from files on disk, so an interruption is recovered by re-running the same operation. In `m` mode
(the default single phase) the plan operation establishes the round and the same grants drive the work.
The daemon package's README and `docs/daemon.md` document every route; the core's `docs/protocol.md` is
the executor protocol's standing specification. The retired local commands — `run`, `plan`, `transfer`,
`clarify` and the hidden `_lane` lane worker — answer their one-line retirement notices with exit code 1
(`--append`, `--force-close`, `--scaffold`, `--new-task`, `--export`/`--adopt`, `--round`/`--phase`,
`--resynthesize`, `-p`/`--file` keep their owned refusals on every live command, each pointing at the
daemon surface or document channel that replaced it).

The four things you "open":

| You want to open | How | What happens |
| --- | --- | --- |
| a project | `init [dir]` | writes the config layer, prepares git; no AI session, nothing under `docs/` |
| a round | `POST /projects/<p>/transfer` | establishes `docs/R-NN/` (phase index, phase directories, round brief); a released `### R-NN` round-brief proposal in `docs/analysis.md` installs verbatim and the advance continues to the floor's review, otherwise stops at the round-start gate for your review + commit |
| a phase | `POST /projects/<p>/transfer` → review → claim the grants | the transfer operation closes the finished phase and constructs the next one's floor, stopping for review; the formulate grant's session lists the tasks; the execute/verify/fix grants run them; the run stops at the phase's clean end |
| one task / a group | `POST /projects/<p>/tasks` (one task) / re-formulation or the `plan` operation (a group) | one task at a time, no session; a group rides the phase's planning input (`plan-input.md`) and its formulation |

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
  `.auto/` + `tmp/` workdirs, and the `AGENTS.md` marker block — no project brief and nothing under
  `docs/`: the first transfer operation (or the plan operation in m mode) opens the assisted project
  analysis `docs/analysis.md`, whose approved `## Project brief` proposal installs
  `.opencode/auto/brief.md` on release (a later manual override: `amend --brief`). Work on the analysis
  with your agent and release it with the clarify operation (`POST /projects/<p>/clarify`) or by adding
  the `Clarified: yes` line and committing by hand; `init` starts no AI sessions.
- **Config semantics**: `init` is a stateless full overwrite (keys not given revert to defaults).
  Change a few keys with `opencode-auto amend <dir> --<key> <value>`; repair drift with `fix`;
  remove the layer with `reset`; `init`/`amend`/`fix` never touch round directories.
- **`phases`** picks the flow: a subsequence of `admtvk` containing `m`
  (`a` analysis → `d` design → `m` implement → `t` test → `v` acceptance → `k` knowledge), or a comma
  list of type ids containing `implement` (custom types from `.opencode/auto/phases/<type>.md` allowed).
  `"m"` (the default) = one implicit phase `R-01/P01-implement`, no handovers — the single-phase
  compatibility floor, driven through the daemon's plan operation and the same grants.

## 2. Open a round — the transfer operation

```
POST /projects/<project>/transfer
# ✓ round R-01 established: P01-analysis, P02-design, P03-implement
# next (round-start gate): review the setup, fill in docs/R-01/round.md, and commit it; then transfer again
```

- With the assisted analysis on (`OPENCODE_AUTO_ANALYSIS`, default), a fresh project's first transfer
  opens `docs/analysis.md` instead — work with your agent on the analysis, the goals, the
  project-brief proposal and the multi-round roadmap, then release it: the clarify operation writes
  the `Clarified: yes` line and commits it (or add the line and commit by hand); the next transfer
  installs the approved brief and establishes R-01 under the roadmap's line.
- The operation establishes `docs/R-01/`: the phase index `phases.md`, one phase directory
  `P<nn>-<type>/` per phase (the released roadmap's line for the round rules; the config `phases`
  value the fallback), and the round brief stub `round.md`. It stops there (exit 0) — **the
  round-start gate**: review the setup, fill in `round.md` (`## Goal`, `## Acceptance criteria`,
  `## Release criteria`), and commit. The next transfer constructs P01's floor (see §3).
  The drafting can travel the analysis instead: a `### R-01` subsection under `## Round briefs` of
  `docs/analysis.md`, released with the document (or drafted into it later between rounds — no new
  release mark needed), **installs verbatim** into `round.md` on the driver's own commit when the
  round opens — the gate passes and the same invocation already constructs the floor. Your
  hand-written file always wins: a filled `round.md` is never overwritten, and after an install the
  file is yours to revise in place.
- Everything inside `docs/R-NN/` is permanent once written — never renamed or moved.
- With config `isolate`, designated nested repositories are switched onto the round branch `auto/R-NN`
  at establishment (a dirty one blocks, exit 2); `opencode-auto land` returns their work to the original
  branch later.
- **Opening the next round**: when the run stops at the round's last boundary with every phase complete,
  fill in `round.md`'s `## Close` (which decisions were restated where, which losses accepted) and
  commit; the transfer operation then runs the round-close check (whole-tree reference scan, `build` if
  configured, `## Close` filled, the round user report in place) and establishes `docs/R-(N+1)/` from
  the roadmap's next line — failing items are listed, exit 2, and nothing opens until they are fixed.
  A released `### R-(N+1)` round-brief proposal drafted into the analysis installs verbatim at that
  open (the gate passes, the construction follows); without one the round-start gate waits for your
  hand-written brief as above. A released roadmap governs the end: past its last line the operation
  stops pointing at `## Roadmap` as the place to extend, never silently opening a config round.
- **Reshaping the round**: at a phase boundary (or with no phase in progress) the round's
  **unstarted** phase tail is reshaping state, and the next transfer re-derives it before
  constructing. The channel is the roadmap line alone: reshape a round by moving or adding its
  `- R-NN <phases> — <goal>` line in `docs/analysis.md` — an uncovered round becomes covered the
  moment its line exists, and `amend --phases` refuses outright (plans/0137: the config `phases`
  key is init-stamped machinery, chosen at birth). Started or completed phases are never reshaped.

## 3. Cross a phase boundary — transfer → review → claim the grants

One phase per cycle, each step stopped for you:

```
POST /projects/<p>/transfer   # 1. close the finished phase (the distill grant's handover), construct the next one's floor, stop for review
#                             2. by hand: review the constructed todo (fix its inputs — round.md, plan-input.md, the brief — never the todo)
POST /projects/<p>/executor/claim   # 3. the formulate grant: the planning session writes the phase's tasks.md + docs/T-NNN/todo.md per task
POST /projects/<p>/executor/claim   # 4. the execute/verify/fix grants run the tasks; the run stops at the phase's clean end — the next boundary
```

- **Step 1 — the advance**: the transfer operation performs one boundary step: a survey phase with open
  `Fork:` lines refuses first (exit 2, no session run) — resolve them (write your answers beside the
  lines), then release: the clarify operation prints the forks with their `Recommend:` defaults and
  writes the `Clarified: yes` line and its commit (the hand edit remains fully supported); otherwise
  the finished phase's `handover.md` is distilled, its `todo.md` → `done.md`, and the next phase's
  **floor** (the formulation todo, driver-owned) is constructed and stopped for review. A rejected
  todo is fixed through its inputs (the round brief, the phase's `plan-input.md`, the project brief,
  the roadmap line) and the re-run — never by editing the todo; the operation's resynthesize request
  field re-voices a rejected synthesized ledger.
- **Step 3 — the formulate grant**: the claimed grant runs the reviewed floor's planning session (the
  construction refuses while the round brief is the untouched stub). A phase's planning input is
  written to its `docs/R-NN/P<nn>-<type>/plan-input.md` — write it with your agent directly (the
  active intent pack's `## planning-input` section carries the scaffold) — and the construct reads it
  as written.
- **Step 4 — the execution**: the execute/verify/fix grants run the phase's tasks one by one and the
  run stops at the phase's clean end, the next boundary the transfer operation's. FAIL verdicts
  surface as state; the fix grant repairs verify FAILs (the CLI's `run --repair` budget retired with
  the command).
- A **knowledge (`k`) phase** has no tasks: its extraction session writes `kb.md` directly, then the
  boundary follows.
- **Gates**: a phase type can carry gates checked at completion — `verdict` (a `Result: FAIL` in
  `verdict.md` blocks; the fix grant repairs, a person decides beyond it) and `acceptance` (the
  driver drafts `acceptance.md`; you sign it with an `Accepted: yes` line, commit, and re-run).
- In `m` mode there are no boundaries: the single phase stays open, tasks can be added any time (the
  task-add operation, one at a time), and the run completes once all tasks are done.

## 4. Open tasks — one, or a group

Pick the lightest tool that fits:

| Scope | How | Mechanism |
| --- | --- | --- |
| a group, fresh phase | write the phase's `plan-input.md` with your agent, then `POST /projects/<p>/transfer` | the planning input is the phase's plan-input.md; the construct/formulate session plans the tasks from it |
| a group, phase already lists tasks | re-formulation through the phase's inputs (the `plan` operation over the daemon) | the append session (`plan --append`) retired — appends ride task-add and re-formulation |
| one task you can already name | `POST /projects/<p>/tasks` with the one-line title | no session: allocates `T-NNN`, writes `docs/T-NNN/todo.md`, commits |
| one task run outside the driver | the executor protocol's grants (an external agent claims the unit) | the work-order pair (`plan --export`/`--adopt`) retired with its command — the grants carry the work to external agents |
| by hand | edit `tasks.md` + `docs/T-NNN/todo.md` | files are the source of truth; the driver picks them up |

Notes:

- In a phased project a planning input never rides a flag (the retired `-p`/`--file` point at the
  phase's `plan-input.md` on every live command): write the file with your agent, commit, and the next
  transfer constructs from it. The input is committed before the planning runs; a changed text
  restarts an open planning step.
- The task-add title becomes the index line and the task's `## Goal`; sharpen `## Scope` /
  `## Acceptance` in `docs/T-NNN/todo.md` before the grants run it. The add refuses while a task is
  mid-pipeline or a planning/handover step is open — finish that first.
- **Replace or skip a unit**: `opencode-auto close <ref> [dir] --reason "…"` closes it without
  delivering (`ref`: `T-NNN`, `R-NN.P<nn>`, `R-NN`; options `--cascade`,
  `--commit-changes`/`--stash-changes`); the close-then-continue pair over the daemon is `close` then
  the plan operation (the retired `plan --force-close` refusal teaches exactly that). Closed units are
  ⊘ "closed, not delivered"; undo is `git revert` of the close commit.

## Watching, waiting, recovering

- `opencode-auto status [dir]` — config summary and the read-only round → phase → task → subtask tree
  (`✓` done, `⊘` closed, `▶` current); prints a live run lock if one is held. Over the daemon:
  `GET /projects/<p>/status` (the status read model), `GET /projects/<p>/status-events` (the typed
  event stream), `GET /projects/<p>/log` (the newest run log).
- Every run logs to `.auto/logs/run-<timestamp>.log`. One driver per directory: the daemon-side
  operations (plan, transfer, clarify, the coordinator) hold `.auto/run.lock` in their own process,
  and so do `close` and `land` around their writes; `init`/`amend`/`fix`/`sync`/`reset` refuse with
  exit 1 naming the holder while another process holds it.
- **Exit codes**: `0` complete (a stop with the next step named — review stops and boundary stops
  included) · `1` usage/environment error · `2` blocked or held for a human (open survey forks, FAIL
  verdict, gate, failed round-close) · `3` the `/exit` pause at a safe boundary (rerun to recover) ·
  `130` force-terminated.
- **Questions are recorded for you**: the pre-execution sessions (planning, distillation) never ask
  non-permission questions — they take the recommended option as a provisional default, record it in
  the affected task documents, and the round report's needs-attention section
  (`docs/R-NN/report-for-user.md`) lists every such question for your considered answer; a session
  that asks anyway waits for a human answer without timeout and is never proxy-answered. Repeated/
  undecidable questions block the run (exit 2) for you to handle and re-run.
- **Interruption recovery**: re-run the same operation or re-claim the grant; the progress record
  re-enters the exact interrupted session/step. Manual rollback = rename `done.md` back to `todo.md`
  (and untick index lines), resume.
- **Run shaping** is the daemon's per-run switch layer (`"switches"` on a run request — its README):
  concurrent width, waits, the permission policy, the server pointer. The retired `run` flags
  (`--max-sessions`, `--boundary`, `--repair`, `--dryrun`, `--wait-between`, `--server`, …) answer
  their retirement pointers on every live command.

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
Touches: src/db/      # optional, repository-relative paths (concurrent units need disjoint sets)

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
| `amend [dir] --<key> <value>` | rewrite only the given config keys (`--brief <text>` revises the project brief; the `phases` key excepted — a round reshapes by its roadmap line, `amend --phases` refuses) |
| `fix [dir] [-f] [--dryrun]` | repair the config layer by rule |
| `sync [dir] [-f] [--dryrun] [--from-bundle]` | upgrade a materialized intent bundle to the running binary's (never writes person-edited files, never deletes extras; `--from-bundle` overwrites differing unstamped files) |
| `release [dir]` | the release gate: certify a destination repository (nested git repository) stands alone — the task-id/out-of-root/process-path findings the rounds recorded now block, beside a clean-tree check (read-only; fix with your agent, commit, re-run) |
| `reset [dir] [-f]` | de-initialize: remove exactly the config-layer artifacts init wrote (the project brief and a materialized bundle's landed files are kept — delete by hand) |
| `close <ref> [dir] --reason "…"` | close a unit without delivering |
| `fork <T-NNN \| sha> <worktree-path> [dir]` | build a retry experiment environment in a new worktree — at the state before a task first started (`T-NNN`) or at an exact commit; the main tree and its history never touched (runs beside a live run) |
| `remove-fork <worktree-path> [dir] [--force]` | tear down a fork: every worktree removed and its `auto-fork/*` branch deleted per repository (uncommitted work blocks; `--force` discards it) |
| `land [dir] [--keep \| --abandon \| --merge]` | return isolated round branches |
| `status [dir]` | read-only progress tree |
| `install-prompts [dir] [--check]` | resync the manual-driver prompt suite (the runbooks for a coding-agent session acting as the driver) into `prompts/` byte-identically and write `prompts/MANIFEST` pinning the vintage — extras reported, never deleted; no run lock, no git (you review and commit); `--check` compares without writing, exit 1 on drift |
| `driver-helper [dir]` | render the person-proxy brief: the six-block context (role pin, the driver's working model, the live state and the stop's own lines, the open person-owned channels, the assist policy, the exact recovery commands) to paste into a coding-agent session acting with your pen at a boundary the run cannot cross |

The retired commands and their replacements: `run` → execute grants over the executor protocol
(`POST /projects/<project>/executor/claim`); `transfer` → the transfer operation
(`POST /projects/<project>/transfer`); `clarify` → the clarify operation
(`POST /projects/<project>/clarify`); `plan` → the plan operation
(`POST /projects/<project>/plan`), the formulate grant, and the task-add operation
(`POST /projects/<project>/tasks`); `_lane` → the executor protocol's scoped/doc lease tiers;
`models` (with `--probe`) → nothing (plans/0296, the opencode severance: the model registry was
push-mode carriage — the tool spawns no agent session, ever, and the agents that work a project are
external coding agents each bringing its own model).
