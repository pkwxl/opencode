# Session recovery takes precedence over process recovery (design + implementation record)

> Status: **implemented** (2026-09-10, `packages/auto-core`, branch `auto-core`).
> `bun typecheck && bun test` all green (451→459 pass, +8 cases).
> This file is the design truth; `plans/0008-precise-resume-plan.md` / `plans/0015-session-error-retry-plan.md`
> are prior work, and this document revises two of their statements of current behavior (see "Relationship to prior documents" at the end of this file).

## Original requirement (user)

> When running again after a session interruption, the subtask session still has not been truly reused; although we have already fixed the session's
> effective checkpoint, this time, upon hitting the quota limit, recovery was skipped outright — which shows that the recovery mechanism was, at least for this
> PLAN phase, unsuccessful. Our process-recovery mechanism should cooperate with the session-recovery mechanism: if a session
> recovery point exists, it should take effect ahead of the process recovery point; because the process cannot sense the detailed state inside the session, going purely by whether the external
> files exist, it will directly skip processing steps that have not fully finished. We cannot take AI-generated files
> as the basis for flow control; control must be based on the state the driver has actually persisted.

Two principles:

1. **Session recovery points take precedence over process recovery points**: when an unclosed session recovery point exists, the flow must re-enter the step
   that session belongs to and resume it, rather than letting "file-derived routing" advance.
2. **Flow control must not be based on AI-generated files**: PLAN.md tasks, handover documents, and the like are written by the AI
   (or backfilled by the driver only after a session interruption); their existence cannot prove "the session has been closed out"; only state the
   driver actually persists (and clears at close-out) can serve as the basis for advancing the flow.

## Incident scenes (`/workspace/kernel-dm-stripe`, an auto-migrate user task)

### Scene 1: the phase-planning session was silently skipped (principles 1/2 hit directly)

1. `run-2026-09-09_22-26-31.log`: in round 5, the m (migration implementation) phase-planning session
   `ses_f773ba946ffeWbMA0w0SEPRyta` (title `PLAN plan m 迁移实现`, "migration implementation") ran `00:39`–
   `00:47`; at `00:47:47`, right after writing PLAN.md (the four tasks T-065..T-068), it immediately hit the
   Kimi weekly quota (`isRetryable:false`). The driver, per
   `plans/0015-session-error-retry-plan.md` points 1–3, handled it correctly: `⛔ PLAN 遇到不可重试的会话
   错误,直接阻塞` (PLAN hit a non-retryable session error, blocking directly) — no fork, no switch to a fresh-board session, `chain.id` stayed on that session. That session totaled
   **196.8k tokens** (measured in the DB `session` table) and was a session that did real work.
2. But the planning session is a **one-shot bypass session** (`requireArtifact` skeleton, pseudo-task `PLAN`),
   and `attempt()`'s `remember()` was at the time gated on `task.id.startsWith("T-") && chain.phase`,
   while a bypass chain **carries no phase** — so that session was never written into `.auto/progress.json`,
   leaving no "planning step in progress" recovery point on the driver side.
3. `run-2026-09-10_00-51-49.log`: on the next run, `routePhase` derived purely from (the ledger, PLAN.md)
   — PLAN.md already had four non-done tasks → routed to `execute` → straight to `▶ T-065 开始执行` ("start executing T-065").
   The planning session was silently discarded: its 196.8k context, plus the driver-side bookkeeping that should have happened at planning close-out
   (`advanceNextTask` advancing the task number, the unified `PLAN plan m` commit), was lost entirely. `.auto/next-task`
   still sat at `65` (T-065..068 had already taken 65–68) — precisely the trace of the unclosed planning.

### Scene 2: killed mid-turn, the in-flight subtask session left unclaimed

1. In the same run at `00:56:10`, T-065's decompose session forked from the digest base into
   `ses_f772f5aa6ffed3GThypRRhTEAb` (title `T-065 decompose …`), read the batch1 design
   document, and totaled **29.4k tokens**; at `00:56:19`/`00:56:20` the user pressed Ctrl+C in succession to force-exit (130).
2. `.auto/progress.json` was at that point `{task:T-065, session: ses_f7733502effe…(the understand session),
   active:false, phase:{kind:"decompose"}}` — `at` was 8ms earlier than the decompose session's creation
   moment. That is: the record was stuck at the **previous phase boundary** (the understand session had ended, `persistStage(decompose)` wrote
   `active:false`), so the decompose session actually running was recorded neither as `session` nor as `active`.
3. The root cause is that point 4 of `plans/0015-session-error-retry-plan.md` moved `remember()` from "sessionID just determined
   (before dispatch)" to "after the turn ends": that change fixed "a retryable intermediate failure state substituting for the real session"
   (T-062) but incidentally took away "claiming the in-flight session when killed mid-turn". On the next run,
   `active:false` → no reuse → decompose redone from zero. This is what the user meant by "the subtask session still has not been truly
   reused".

## Root causes

| # | Root cause | Principle violated |
| --- | --- | --- |
| A | Phase-level bypass sessions (planning/handover) write no driver-side recovery point; the flow derives routing purely from AI-written files (PLAN.md/handover documents) and silently skips unclosed sessions | Principles 1 + 2 |
| B | The execution chain's `active` record is written only **after the turn ends**; when killed mid-turn the record is stuck at the previous phase boundary (`active:false`, pointing at the previous session), leaving the in-flight session unclaimed | Principle 1 (with no session recovery point, precedence is moot) |

## Confirmed decisions

| Decision point | Conclusion |
| --- | --- |
| Recovery-point persistence timing (B) | Changed to **write the `active` record as soon as the prompt dispatch succeeds** (claiming the in-flight session); refreshed by outcome after the turn ends |
| Retryable errors (B) | When the turn ends with a retryable session error, **restore `progress.json` to the pre-dispatch snapshot** (an abandoned fork copy / failed session must not substitute for the real recovery point) — keeping the protection of point 4 of `plans/0015-session-error-retry-plan.md`, changed from "do not persist ahead of dispatch" to "persist on dispatch + restore on failure" |
| `remember()` gating (B) | Drop `task.id.startsWith("T-")`, keep only `chain.phase` — every phase-carrying session (execution chains + phase-step bypasses) writes it; one-shot bypasses without a phase (adjudication/review/script generation/repair planning/dryrun/fork base) still do not |
| Phase-step recovery points (A) | `resume.ts`'s `Phase` gains a `step` variant (`phase-plan`/`phase-handover` + the owning phase letter); `requireArtifact` gains `spec.step`; on entry, if an `active` record for the same step is found → resume |
| Whether to reuse the session on resume (A) | Session alive and not an error stub → reuse the original session (preserving the artifact scene, **no reset**); session dead / `--new-session` / error stub → open a new session and **reset as usual** (equivalent to a brand-new step) |
| Close-out timing (A) | The **caller** deletes the record via `closeStep` after completing its own post-processing: planning = after task-number advancement + the completion log; handover = after distilled-artifact validation + commit (the archiving/reset/ledger that follow are idempotent driver bookkeeping, backstopped by the existing "handover-interruption recovery"). `requireArtifact` itself does not delete, to avoid losing the step claim if killed when "artifacts validated but post-processing unfinished" |
| Routing precedence (A) | `runPhaseLoop` consults `openStep` **before** consuming file-derived routing: the step's owning phase == the currently routed phase and not yet in the ledger → re-enter that step (reusing the session); the phase already in the ledger → clear the stale record; letter mismatch (manual rollback / staleness) → warn and let file routing take precedence |
| The fate of file-derived routing | **Kept** as the default routing (manually filling in PLAN.md, manually entering tasks in the k phase, and the purely manual `phases="m"` mode all depend on it). This design only adds the precedence layer "when an unclosed session recovery point exists, driver state is always authoritative"; it does not require every step to carry a driver close-out stamp (otherwise all existing projects and manual flows would be blocked) |
| Coverage | This iteration covers the two steps phase planning + phase handover, plus persist-on-dispatch for all execution-chain sessions. Knowledge extraction (already guarded idempotently by artifact existence, failure only warns), task-number recovery, and final-review generation (each with its own file-derived routing) are excluded for now, left as needed |

## Implementation (all landed, `bun typecheck && bun test` all green)

### P1 `src/resume.ts` — step recovery-point types and read/write
- Add `PhaseLetter` (`a|d|m|t|v|k`, inlined to avoid a resume→phases reverse dependency) and
  `StepKind`(`phase-plan|phase-handover`)。
- The `Phase` union gains `{ kind: "step"; step: StepKind; letter: PhaseLetter }`.
- Add `openStep(dir)`: returns `{step, letter, session}` when the current record is an `active` step variant,
  `undefined` otherwise.
- Add `closeStep(dir, step, letter)`: `forgetProgress` only when the current record is exactly that step
  (left untouched on mismatch, to avoid clearing task records by mistake).
- File-header comment rewritten: records are written as soon as dispatch succeeds, restored on retryable errors, and written for phase steps too.

### P2 `src/runner.ts` — persist on dispatch + restore on failure (B)
- `attempt()`: the `remember()` gating drops `task.id.startsWith("T-")`, keeping only `chain.phase`.
- Snapshot before dispatch: `prior = peekProgress(dir)`; immediately after `client.session.prompt` succeeds,
  `await remember()` (claiming the in-flight session).
- Retryable session-error branch: besides restoring `chain.id/used/at`, restore `progress.json` to
  `prior` (`forgetProgress` if there is no `prior`) — an abandoned copy must not substitute for the real recovery point.
- Add `peekProgress` to the imports.

### P3 `src/runner.ts` — `requireArtifact` step resume (A)
- `spec` gains the optional `step?: { step: StepKind; letter: PhaseLetter }`.
- On entry, `recallProgress(dir, task.id)`: an `active` record for the same step + session alive + not an
  error stub + not `--new-session` → `resumedSession`/`resumedUsage`, logging "reusing session";
  otherwise log "opening a new session to redo this step".
- **A brand-new step (no matching active record) writes an active recovery point with `session` still undetermined on entry**:
  this keeps attempt's pre-dispatch snapshot (`prior`) non-empty — on a retryable session error, restoration keeps the step claim rather than
  deleting the record, closing off "retryable errors exhausted → no record → the next run skips this step on a half-finished PLAN.md".
- Inside the loop: `resume = i===0 && resumedSession`; when `resume`, **skip reset** (preserving the artifact
  scene), the chain carrying `id=resumedSession` + `note=resumeNote(stepPhase,true)` + inherited usage;
  otherwise reset as usual + a new chain. Chains always carry `phase=stepPhase` (making P2's persist-on-dispatch effective).
- Feedback retries (i≥1) clear `resumedSession` (the original session ended this round without producing output; the next round resets + a new session).
- `phaseText`/`nextStepText`/`resumeNote` gain `step` branches (recovery logs and resume prompts).

### P4 `src/loop.ts` — routing precedence + close-out (A)
- Add `openStep`/`closeStep` to the imports.
- `planPhase`: the `requireArtifact` spec gains `step:{step:"phase-plan",letter:phase}`;
  on the success path (after task-number advancement + the completion log), `await closeStep(directory,"phase-plan",phase)`.
- `handoverPhase`: the spec gains `step:{step:"phase-handover",letter:phase}`; after distillation succeeds
  (`distilled===true`) and before archiving/reset/ledger, `await closeStep(...)`.
- `runPhaseLoop`: insert the `openStep` precedence layer after the `complete` check and before the `plan` branch
  (see "Confirmed decisions · Routing precedence").

### P5 Tests
- `test/resume.test.ts`: +4 cases (step record round-trip, openStep's three states, closeStep match/
  mismatch, closeStep not clearing task records by mistake).
- `test/runner.test.ts`: +4 cases (requireArtifact resume reuses the session without reset, a brand-new step resets
  + new session + persist-on-dispatch recovery point, a dead session falls back to reset + new session, and the step recovery point
  is not deleted after retryable errors are exhausted).

### P6 Documentation sync
- This file; the progress-recovery and phase-loop entries in `docs/behavior.md`; `docs/structure.md`'s
  `resume.ts`/`runner.ts`/`loop.ts` entries; `plans/0006-phases-design.md` sections D/E;
  `plans/0008-precise-resume-plan.md` / `plans/0015-session-error-retry-plan.md` cross-references; the package-root AGENTS.md navigation line.

## Verification

```bash
cd packages/auto-core && bun typecheck && bun test   # 458 pass / 0 fail
```

- Scene-1 replay: had the planning session `ses_f773ba946ffe` had a step recovery point, the next run's `openStep`
  would hit → `routePhase`'s `execute` overridden → re-enter `planPhase` → `requireArtifact`
  reuses that session (the 196.8k context is not lost) to continue writing/confirming PLAN.md → task-number advancement + commit + `closeStep`.
- Scene-2 replay: the decompose session persists on dispatch `{session: ses_f772f5aa6ffe, active:true,
  phase:decompose}`; after the Ctrl+C force-exit, the next run's `runTask` reuses that session (the 29.4k context is not lost).
- Regression: the `plans/0015-session-error-retry-plan.md` case "a retryable intermediate failure state does not substitute for the real record" stays green
  (changed to persist-on-dispatch + restore-on-failure, same end state); "non-retryable blocking still persists normally" stays green.

## Relationship to prior documents

- Revises the implementation details of `plans/0008-precise-resume-plan.md` beyond 「维持现状」 (maintain the status quo): the recovery-point persistence timing moves from
  "after the turn ends" to "write on dispatch success + restore on retryable failure".
- Revises point 4 of `plans/0015-session-error-retry-plan.md`: its "no persisting ahead of dispatch" is refined into "persist on dispatch,
  restore to the pre-dispatch snapshot on retryable errors" — keeping what point 4 meant to prevent, "an intermediate failure state substituting for the real session",
  while restoring "claiming the in-flight session when killed mid-turn" (the ability the point-4 change incidentally took away).
- Point 5 (the `sessionUsage` error-stub criterion) is unchanged; `requireArtifact` resume reuses the same criterion.

## Known non-coverage (left as needed)

- Knowledge-extraction / task-number recovery / final-review generation sessions: each has file-derived routing or an idempotent guard, and none is included in step recovery points.
- Cross-round stale step records: handled only as "clear when the phase is already in the ledger, warn when the letter mismatches", with no round-number validation.
