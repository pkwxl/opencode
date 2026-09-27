# 0058 — The no-session task add (`plan --new-task`)

Status: landed with this document (2026-09-27). Scope: one new plan route and one new module; no change to the session-planned paths.

## The gap

`plan` planned at every scope through one mechanism — a planning input (`-p` / `--file`) handed to a session:

| Scope | Today's path | Cost |
|---|---|---|
| Multi-phase | the `phases` value; `plan` establishes rounds, each phase planned per input | right — decomposition across phases is the planner's job |
| Intra-phase multi-task | `plan -p <text>` fresh, `plan --append -p <text>` (m mode implies the append) | right — decomposing a brief into tasks is the planner's job |
| One task, already known | the same append session, or hand-listing the index line + `docs/T-NNN/todo.md` | wrong — a session to transcribe one known task; hand-listing must satisfy the numbering, field-block, section and eof rules by hand (the m-mode empty-index notice suggests exactly that, error-prone as it is) |

**D1 — `plan <dir> --new-task "<one-line title>"` adds the one task you name with no session.** The driver does the mechanics a planning session would otherwise be spawned for; the person did the planning. The flag is standalone, not `--append --new-task`: `--append` means "a session plans tasks from an input" (D23's rule that it requires one stays untouched), while `--new-task` means there is nothing to plan — combining them would carve an exception out of that rule for no added meaning. The combination, and `--new-task` beside `-p`/`--file`, are usage errors pointing at the right form. It composes with `--force-close` the way `--append` does: replace a task session-free (`plan --force-close T-005 --reason "…" --new-task "do X instead"`).

## The route (plan.ts row 11)

Decided and done entirely in the prelude — a route needing no AI, like establishing a round:

- **Targeting is D23's rule verbatim**: the phase the route names *now* — the plan route (the phase's first task), execute, handover (a stale handover or gate holds nothing back), and both m-mode rows. A task someone already knows needs no planner wherever it lands.
- **Refusals, in prelude order**: legacy layout; the usage backstops (one-line title, the exclusions); the round-setup rows 1–3 before any write (establish / commit / re-sync first, adapted tails of the D5 input lines); the blocked route; an **open step** (its snapshot and resume machinery own the phase's index until `closeStep` — a hand-add under them would bypass both); a **task-less phase** (the knowledge type distills knowledge, it holds no index); **D26's guard** (a mid-pipeline task's resume point is never displaced — the same refusal line as the append rows).
- **Exit codes**: 0 added (stop lines review the document and point at `run`); 1 usage or refused; 2 the worktree was dirty (the unit-start gate: the round-start gate's "commit the setup" discipline applies — `--new-task` does not ride a dirty tree) or a commit failed.

## The write (src/task-add.ts)

Ordered for a path with **no resume record** — a kill must leave a state a plain re-run completes:

1. **Gate**: `beginUnit` (driver-state leftovers self-heal, anything else dirty), the gate every planning-side write shares.
2. **Number**: `max(autoNumber record, deterministic floor)` — the record leads but never below `taskNumberFloor` (every index entry and every `docs/T-*` directory); without `autoNumber` the floor alone (D25's missing-record rule). AUTO-DECISION: a *missing* record is never recovered here — the recovery is an AI session over git history and this path starts none. The floor picks the number (safe against everything on disk), the record stays missing for the next planning session to recover, and it is advanced only where it already existed or the floor proves a brand-new project (1).
3. **Stale handover first** (D25/F13): removed in its own commit *before* the add, not after as `appendPlan` does — appendPlan can put it second because its step record re-enters idempotently; this path has none, so removal-first means a retry cannot add the task twice. A failed removal commit aborts with nothing added.
4. **The document and the index line, one commit** (`Auto-Stage: task-add`, subject `PLAN add T-NNN <title>`): `docs/T-NNN/todo.md` through `renderTaskTodo` (title line, `Phase:` field, the three sections, the eof terminator) and the line appended after the existing ones without touching them — the append contract by construction; a missing index is created (`renderTaskIndex`).

The document is deliberately minimal and honest about its provenance: the title doubles as the Goal, and Scope / Acceptance say they were left unrestricted by `plan --new-task` — nothing is padded to look planned. The stop lines point at `docs/T-NNN/todo.md` to sharpen it before `run`.

## What stayed out

- **No `--goal/--scope/--acceptance` flags, no `-p` reuse as the body**: one flag, one meaning; richer content is one edit away after the add, and the add stops for review anyway.
- **No multi-task `--new-task a --new-task b`**: several known tasks are either an input for the planner (decomposition is its job) or two commands; the parser keeps single values everywhere.
- **No runtime-state entry, no step record**: a pending task needs none (pending is the default), and the write is driver-bookkeeping, not a step.

## Tests

- `test/task-add.test.ts`: the document shape, the index append/create, the numbering matrix (record vs floor, advance rules), the git commits (removal first, `Auto-Stage: task-add`), the dirty gate.
- `test/plan.test.ts` row 11: the refusals (usage, round-setup, open step, task-less phase, D26), m-mode and phased adds, the handover-route removal, the dirty stop.
- `packages/auto/test/e2e.test.ts`: the shell flag contract (plan-only, exclusions, one-line title) and the end-to-end add over a git fixture, no agent involved.
- `test/import-direction.test.ts`: `task-add` classified driver (imports tasks / numbering / git / phases only).
