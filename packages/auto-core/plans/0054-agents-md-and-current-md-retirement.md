# 0054 — Retire the AGENTS.md round snapshot, session-maintained AGENTS.md, and the CURRENT.md mirror

Status: **implemented** (2026-09-25). Request: stop backing up `AGENTS.md` into each round's `docs/R-NN/AGENTS.md.bak`, keep `AGENTS.md` to the content the driver initialises (no backup, no maintenance), and retire `CURRENT.md` too — after checking that doing so is sound.

## 1. Fact baseline

- **F1 — AGENTS.md is local-only.** `init` writes `/AGENTS.md` into `.gitignore` (`src/gitignore.ts` `INIT_ENTRIES`, commit 088100858). So edits a session makes to it are outside the unified commit (the completion condition, plans/0021), and outside the strict-resume rollback, since `git stash -u` skips ignored files. The P1 scan sees nothing either, because `unitAddedLines` reads git.
- **F2 — the round snapshot has no reader.** `establishRound` copied the root `AGENTS.md` to `docs/R-NN/AGENTS.md.bak` once at round start. Nothing reads it: `prevRoundDigest` injects the phase index, the last handover and the knowledge docs, never the snapshot. It also records the file *before* the round's work, so knowledge a session added during the round was never in any committed copy.
- **F3 — the block is reproducible.** The driver's part of `AGENTS.md` renders from the config (`testByDriver`) and the intent pack (`renderAgentsBlock`). The only non-reproducible part was what sessions wrote under the maintenance rules (`## governance` / `### agents-maintenance`, the 150-line cap, `docs/agents/` routing).
- **F4 — CURRENT.md duplicates the task documents.** It held the title, the status, the body of `docs/T-NNN/todo.md` and a subtask count from `subtasks.md`. Every execution prompt already inlines the task (`taskBlock`), and the `ground-state` partial carries the status and tick snapshot. The agent contract used it only as a fallback after compaction.
- **F5 — CURRENT.md is costly.** It is tracked, so every task churned it inside its unit commits: written at start, after decompose, after each subtask, and deleted at completion. It also needed the carryover self-heal, chmod protection, a tier-1 marker (`state-rule`), `close` parsing its third line, and some fifteen template mentions. plans/0051 F6 names it as single-task-shaped state in the way of per-worktree identity.
- **F6 — its human-facing remarks are available elsewhere.**
  - The interruption remark gave the exit reason and phase. The run log prints the reason, which it already calls "recorded only in this log", and `.auto/progress.json` keeps the phase that the resume note is built from (`resumeNote(recalled.phase)`). No resume path read the remark back.
  - The rollback remark said where the rolled-back work went. The rollback log line can say that.

## 2. Assessment

Both retirements are sound.

- **AGENTS.md backup and maintenance.** Under F1, session maintenance produced unversioned state that the completion condition and the rollback could not see. That contradicts the rule that a unit is done only when its artifacts are committed. The snapshot (F2) was the only committed trace, it was taken at the wrong moment, and nothing read it. Durable knowledge already has committed carriers: phase handovers, the knowledge phase's `kb.md` and `prior-kb.md`, and task reports.
- **CURRENT.md.** It is a pure mirror of committed documents (F4). It cost a write and commit churn per subtask, protection and marker machinery (F5). Nothing on the resume path depends on it (F6).

Costs accepted:
- a blocked run's reason is no longer in a committed file, only in the log (as the log line already claimed);
- sessions lose a place for cross-task workflow notes in their system context — such notes belong in `docs/`.

## 3. Decisions

- **D1 — no round snapshot.** `establishRound` stops writing `AGENTS.md.bak`. Snapshots already in older round directories stay: round directories are permanent.
- **D2 — AGENTS.md holds only the driver's block.**
  - The `agents-maintenance` subsection leaves the built-in intent pack, and its paragraph leaves the block. A project overlay's leftover subsection has no consumer.
  - The pointer paragraph now names `docs/T-NNN/todo.md` / `subtasks.md` and says AGENTS.md is not a place for notes.
  - The agent contract says the same.
  - `check` drops the 150-line note, and the phase-handover commit drops its line-count suffix.
  - `protect.ts` adds `AGENTS.md` to the files made read-only during `run`. `ensurePointer` / `removePointer` unlock before writing, so a killed run's leftover `0o444` never blocks `init`/`amend`/`fix`/`reset`. `ensurePointer` reprotects after writing, which does nothing outside a run.
  - The opencode server's AGENTS.md fingerprint restart stays. It is cheap and still covers an external edit during a run.
- **D3 — no task mirror.**
  - `src/current.ts` is deleted.
  - `runTask`, `executeWhole`/`runSubtask`/`ensureDecomposed`, `rollbackUnitState` and `closeUnit` no longer write or remove the mirror.
  - `interruptionRemark` is gone.
  - The rollback log line names the stash (`auto-rollback`, `git stash list`).
  - The resume note no longer asks the session to read `CURRENT.md`.
  - Templates name `docs/{{taskId}}/todo.md` instead.
  - The `state-rule` marker becomes `todo.md → done.md` (plans/0035 amendment). `CURRENT.md` leaves the role table, `PROTECTED_FILES` and git.ts `documentOnly`.
- **D4 — leftover migration.** Preflight deletes a root `CURRENT.md` whose first line is the mirror's fixed header. The deletion runs before the start gate. `CURRENT.md` stays in git.ts `DRIVER_STATE` only so that the gate's carryover commits the deletion, where it would otherwise block for a human. A file with any other first line belongs to the project and is left alone.

## 4. Shell impact

`packages/auto` needed no source change: its README describes the new behaviour and one e2e assertion flipped (no `AGENTS.md.bak` after `plan`). Shells refreshing the core snapshot: see the `docs/shell-contract.md` entry of the same date.

## 5. Verification

`bun typecheck` and `bun test` in `packages/auto-core` and `packages/auto`.
- The goldens were regenerated (`UPDATE_GOLDEN=1`); the diff contains only the wording above.
- `test/protect.test.ts` covers the protected block write and the leftover read-only file. Without the unlock both cases fail, since the tests run as a non-root user.
