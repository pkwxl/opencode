# 0051 — MP.2 per-unit state (design, draft)

Status (2026-10-02): **fully absorbed — retired into
`0068-parallel-execution-lanes-design.md`.** D1's process model (one child
`run` process per lane, each in its own worktree) and D3's registry
(`Runtime.worktree` with the lane pid in `.auto/units.json`, §5 P1) are built
there (S1 the registry fields, S2–S3 the dispatch and recovery over them);
P2's recovery planner became 0068 D14's orphan scan, and the per-directory
state isolation D1 (a) rests on is what made every serial-era singleton
per-lane again with zero core surgery (0068 F11). Nothing here is maintained
further.

Status: **ruled** (2026-09-23; drafted 2026-09-22). Outcome: **MP.2 is
retired as a milestone and folds into MP.3** — see §5. Root plan item: MP.2
(`plans/AUTO_NEXT_REFACTOR_PLAN.md` §4, MP track). Source proposal: 0036 D16
(with F8, F9, F26 and D15). Nothing here is implemented yet.

## 1. Why this document exists

0036 D16 lists the state that must become per-unit "before any
concurrency": `.auto/progress.json` (one record → keyed set), `CURRENT.md`
(one mirror → per-unit or tabular), `.auto/handover.json` and `tmp/test.sh`
(per unit), and the module-level globals of `failback.ts` / `exit.ts`. It
also says the list is worth doing "even if tier 3 never ships", as a
recovery-fidelity gain.

Before the list goes in as written, two facts need checking. First, D16 was
written before D15's isolation model (one worktree per agent) was settled
as the recommendation. Second, it was written before the M3 unit layout,
which already moved part of the runtime state to a keyed store. This
document re-derives the work list from today's code.

## 2. Fact base (auto-next @ `22b76c1e7`)

| # | Fact | Where |
|---|---|---|
| F1 | `Progress` is one record `{task, session?, at, active, phase?, baseline?, model?}` in `.auto/progress.json`. Every writer overwrites it and every reader reads the whole file. `closeStep` only deletes it when the record still names that step, because a task record may have overwritten a step record. | `src/resume.ts:62-84,122-127` |
| F2 | Progress writers and readers: `attempt.ts` (claim on dispatch, restore the snapshot on a retryable error), `runner.ts` (recall, demote to summary state, delete on completion), `unit-commit.ts` (summary state on a blocked or rolled-back unit), `artifact.ts` (step record), `loop-phase.ts` (`openStep` / `closeStep`), `loop-task.ts`, `execute.ts` (`peekProgress` for the resume gate). | grep `Progress(` in `src/` |
| F3 | **Per-task runtime state is already keyed.** `.auto/units.json` = `{tasks: {[id]: {status?, attempts?, forkBase?}}}`. It is written by a serialized read-modify-write with an atomic rename, and the queue is an in-process module global. | `src/tasks.ts:222-264` |
| F4 | `.auto/handover.json` is one record, and scope-checked (`task` + `scope` = handoff file path). Writers are `watch.ts` (pin), `exec-session.ts` (close, resume), `attempt.ts` (claim `nextSession`, restore) and `unit-commit.ts` (forget). | `src/handover.ts:50-87` |
| F5 | `tmp/test.sh` is a **session-visible protocol string**: templates tell the session to write the script path into `tmp/test.sh` (`templates/prompts/subtask.md:43`, `agents-block.ts:30`). Archive numbering `tmp/test.<n>.out` / `.sh` is one sequence per target directory. | `src/testrun.ts:37,214-232`, `src/watch.ts:164` |
| F6 | `CURRENT.md` is a tracked, write-protected mirror of *the* task in progress. It is a driver state file for the clean gate's carryover, and sessions read it only as a fallback after compaction. | `src/current.ts`, `src/git.ts:122-128` |
| F7 | Every state function takes `dir` (the target directory) explicitly. None of them hard-code the cwd. | `resume.ts`, `handover.ts`, `tasks.ts`, `current.ts`, `testrun.ts` |
| F8 | `.auto/` and `tmp/` are gitignored per target directory. A git worktree of the target therefore has its **own** `.auto/`, `tmp/` and `CURRENT.md` view. | `src/gitignore.ts:10` |
| F9 | Module-level mutable state in `src/`: `exit.ts` `pending`; `failback.ts` `sticky` / `pending` / `override`; `log.ts` `fd` / `rl` / flags; `stats.ts` `handles` / `loading` (keyed by `dir`); `tasks.ts` write `queue`; `protect.ts` `enabled`; `shell.ts` `profile`; `prompt.ts` `activeIntentPack`; `switches.ts` `memo`; `template.ts` `library` / `cache`; `session-api.ts` `serverModelCache`. | grep `^let` / module `Map`s |
| F10 | Execution is strictly serial: at most one unit (task pipeline stage, subtask, or phase step) is in flight at any time, and `run --max-sessions` above 1 is a usage error (0046 D9). | `runAll`, MP.1 |
| F11 | The opencode backend spawns one `opencode serve` per run process and owns its lifecycle (restart on failure). | `src/agent/opencode/server.ts:71,110` |

## 3. Findings

**G1 — The "even if tier 3 never ships" value is small under serial
execution.** By F10 there is never more than one live resume point, so a
keyed `progress.json` holds at most one active entry. That is exactly
today's content. The only serial gain is removing the step/task overwrite
coupling that `closeStep` guards against (F1). D16's rationale, "the
reason a resumed run can only re-enter one unit", describes a limit that
only becomes real once more than one unit can be in flight. So MP.2 should
be scheduled as preparation for MP.3, not as a standalone fidelity item.

**G2 — Under D15 (i), most of the file list is per-unit by
construction.** One worktree per agent means one target directory per
in-flight unit (F8). With F7, `progress.json`, `handover.json`,
`tmp/test.sh`, the test archive sequence and `CURRENT.md` are all
per-worktree without any schema change. This is the same argument 0036
makes for F8 ("satisfied by construction rather than redesigned"), and it
extends to the rest of D16's file list. Rekeying those files would buy
nothing under (i). It is only required under D15 (ii), which 0036 and the
root plan both advise against.

**G3 — What remains is the parent's view and the process model.** Two
real gaps survive G2:

1. **Recovery across N worktrees.** After a crash, the parent run must know
   which units were in flight and in which worktree, so it can re-enter each
   one. Each worktree's own `progress.json` holds the session detail. The
   parent needs only the unit → worktree map.
2. **In-process globals (F9).** These matter only if one process drives N
   sessions. If each agent is a child `run` process in its own worktree, every
   F9 global is per-agent automatically, and the problem moves to MP.4
   (routing `/exit` and `/failback` from the parent to the children, and
   multiplexing their logs).

**G4 — Several F9 globals are legitimately process-wide under any model.**
The legitimately global ones are `protect.enabled`, `shell.profile`,
`prompt.activeIntentPack`, `switches.memo`, `template.library` / `cache`
and `serverModelCache`, because they hold configuration fixed for the run.
`stats.handles` is already keyed by `dir`. D16 named only `failback.ts`
and `exit.ts`, which is correct.

## 4. Decisions (**ruled by the user, 2026-09-23**: D1 (a), and MP.2 folds into MP.3)

| # | Question | Options | Ruling |
|---|---|---|---|
| D1 | Process model for N agents (decides the scope of everything below) | **(a) one child `run` process per agent**, each in its own worktree; the parent schedules, allocates ids, merges and routes input. **(b) one process, N session chains** in-process. | **(a)** (user, 2026-09-23). It follows from G2/G3: F9 dissolves, F11 (one server per process) and the stats-per-`dir` design stay as they are, and a crash of one agent cannot corrupt another's in-memory state (root plan MP exit criterion "killing any agent does not damage other units"). Cost: N opencode servers, and inter-process plumbing for `/exit`, `/failback`, logs and usage (MP.4). |
| D2 | `progress.json` / `handover.json` / `CURRENT.md` / `tmp/test.sh` shape | Keep the single-record-per-directory form (per worktree) vs. rekey to keyed sets. | **Keep them as they are** under D1 (a) + D15 (i). No schema change, no protocol-string change (F5: `tmp/test.sh` stays a stable session-facing literal). |
| D3 | Parent's in-flight registry | New `.auto/agents.json` vs. extend `units.json` runtime entries with `worktree?`. | **Extend `units.json`** (F3: already keyed per task, atomic writes): `worktree?: string` on the `Runtime` entry = "this task is in flight in that worktree". Recovery = for each entry with `worktree`, re-launch a child there; the child's own `progress.json` does the rest. Tasks only (0046 R1: task-level parallelism first; subtasks stay serial inside a task's worktree). |
| D4 | `units.json` writer under concurrency | In-process queue (today) vs. cross-process lock. | **Parent is the sole writer** of the parent's `units.json` (children write their own worktree's copy for their own task). No lock needed. The in-process `queue` stays. |
| D5 | Step/task overwrite coupling (F1, the one serial gain from G1) | Leave as is vs. split step records into their own file. | **Leave as is.** The guard in `closeStep` is correct, and phase steps are never concurrent with tasks (planning precedes the task set, the handover follows it). Record the rationale only. |
| D6 | `exit.ts` / `failback.ts` semantics (0036 D16's explicit ask) | Per-agent vs. "global with documented semantics". | Under D1 (a) they are per-process = per-agent by construction. Document the **parent-level** semantics that MP.4 must implement: `/exit` is broadcast to every child and takes effect at each child's next boundary; `/failback [order]` is broadcast; `sticky` (phase-scope quota degradation) stays per child — a quota hit is detected by each child on its first failing call, which costs one failed call per agent and needs no shared state. |

**The rejected branch, recorded (D6 of the root plan asks for it).** Had D1
been **(b)**, MP.2 would have grown back to D16's full list: `progress.json`
and `handover.json` keyed by unit id; the test slot at `tmp/<unit>/test.sh`,
a protocol-string change needing a 0035 §3 entry and a template lockstep;
a tabular `CURRENT.md`; `exit` / `failback` carried per chain on
`SessionChain`; and `tasks.ts`'s queue still in-process. Size L, not M.

## 5. Outcome: MP.2 closes, its residue moves into MP.3

**MP.2 as written in 0036 D16 is retired** (user, 2026-09-23). Under D15 (i)
plus D1 (a), every item on D16's list is satisfied by construction (G2, G4)
or has no serial value (G1). No state file changes shape (D2).

What is left is not a state-shape task but the first two steps of the
scheduler, so they move into **MP.3** and MP.2 is closed as folded:

- **P1** `Runtime.worktree?` in `units.json` (D3), with read/write helpers and tests — the parent's in-flight registry, parent-sole-writer (D4).
- **P2** A pure recovery planner: given `units.json` entries carrying `worktree` and the worktrees on disk, return the units to re-enter, the stale entries to clear (worktree gone) and the orphan worktrees to report. Launching children is MP.3's scheduler proper.
- **P3** Header comments in `resume.ts`, `handover.ts`, `current.ts`, `testrun.ts`, `exit.ts` and `failback.ts` recording the per-directory / per-process invariant that D1 (a) rests on, so a later in-process concurrency change cannot break it silently.
- **P4** An invariant test: every state-file function takes `dir` and never falls back to `process.cwd()` (guards F7, on which G2 depends).

P1–P4 carry no prerequisite of their own and can open MP.3, before the id
namespace ruling (0046 R5) that the rest of MP.3 waits on.

**MP.4 inherits** the D6 semantics: `/exit` and `/failback [order]` are
broadcast from the parent to every child and take effect at each child's
next boundary; `sticky` stays per child.

## 6. Step table

- [x] S0 User ruling on D1–D6 and on the fold (2026-09-23: D1 (a); MP.2 folds into MP.3).
- [x] S1 Root plan: close MP.2 as folded, carry P1–P4 into MP.3, write D1 (a) and the broadcast semantics into the MP.3 / MP.4 text.
- Implementation of P1–P4 is tracked in MP.3, not here. This document is an MP-stage design aid (D6 two-tier docs): it retires once MP.3 ships or its findings are superseded.

<!-- auto: eof -->
