# Precise Breakpoint Resume Implementation Plan (handover document)

> Status: **fully implemented**. Both the code and the doc sync are complete (`bun typecheck` + `bun test` all green);
> The design truth has been moved into section H of plans/0009-verify-review-design.md; this file is kept as the implementation record.

## Original Requirement

For every abnormally interrupted AI session, the next execution reuses the interrupted session (covering Ctrl+C exits,
server faults, AI-service faults, etc.); forcing a new session requires explicitly passing `--new-session`; the program's runtime state and
the session context must match exactly — whatever state it abnormally exited in, recovery drives the subsequent control flow precisely from that state.

Additional clarification (user): on interruption, **if a handover file was already saved, open a new session** (the old session's context is exhausted and the progress
is carried by the handover document); **if no handover file was saved, restore the original session's
context the way `opencode -r <session-id>` does** and continue.

## Confirmed Decisions

| Decision point | Conclusion |
| --- | --- |
| Time window | RESUME_WINDOW_MS (30 minutes) removed entirely: active-record reuse looks only at sessionAlive; stale context escapes via `--new-session` |
| `--new-session` semantics | Skips session reuse only; precise re-entry into the phase stage is preserved. It also immediately flips the record to active=false (preventing the old session from misaligning with the phases already advanced after an interruption in a session-less phase) |
| Handover file first | On active recovery, if the handover document already exists (ondemand `docs/<id>.handoff.md`, or the handover-test `<id>.testhandoff.md`) → do not reuse the old session; open a new session and resume from the handover; on `状态: 完成` (status: done) the whole-task session is skipped outright |
| Bypass one-shot sessions | Keep re-running a new session (idempotent artifacts guarantee the state matches), no progress record written |
| Enhancements | ① precise recovery of an interrupted verify fix round (stage=fix + gap persisted); ② an interrupted SSE event stream is no longer misjudged as the session ending (handled as a session error + abort the orphaned round) |

Unchanged: the exit-code regime; graceful exit (blocked / failback pending) → active=false, no reuse.

> **2026-09-10 addendum**: the timing of persisting recovery points was further refined by [plans/0018-session-resume-precedence-design.md](plans/0018-session-resume-precedence-design.md)
> — an active record is now **written as soon as the prompt dispatch succeeds** (a session with a claimed round in progress;
> the earlier "write only after the round ends" lost the claim when killed mid-round); a retriable session error restores the pre-dispatch
> snapshot; phase-level bypass steps (planning/handover) also carry a recovery point via requireArtifact's spec.step,
> and session recovery takes precedence over file-derived routing. The "in-session recovery / phase stage" semantics of this document are unchanged; for persist timing and
> coverage, that document prevails.

~~Transient in-flight runSession errors still retry on a new session~~ — superseded by
[plans/0015-session-error-retry-plan.md](plans/0015-session-error-retry-plan.md) (implemented 2026-09-09):
isRetryable:false blocks directly without retrying; retriable errors instead retry via fork(chain.id), abandoned on failure,
the original session unaffected — chain.id is no longer indiscriminately cleared to swap in a blank-slate session.

## Completed (code, verified all green)

### src/resume.ts
- Deleted the `RESUME_WINDOW_MS`/`RESUME_WINDOW_MINUTES` exports; the file-header comment rewritten (no time window,
  isomorphic to `-r`, handover first, --new-session).
- `Phase` verify variant: stage gains `"fix"`, plus `gap?: string` (the verbatim gap text the fix round was judged on).
  `parseProgress` passes the phase object through wholesale, so gap is compatible automatically — no change needed.

### src/runner.ts
- Dropped RESUME_WINDOW_* from the imports; `Opts` gains `newSession?: boolean`.
- runTask's recovery-decision block: the time window is gone; `handedOff` (recalled.active plus the handover document existing) takes precedence over
  reuse; with `--new-session`, first `saveProgress({...recalled, active: false})`, then start the new session;
  distinct log wording for each of the three no-reuse reasons.
- runTask's big comment block and the non-completion-outcome block comments synced (the 30-minute-window wording removed).
- verifyTask: extracted the `fixRound(gap, round)` closure (fix session + wrapup, shared by normal fix rounds and recovery);
  before the fix branch, `persist({kind:"verify", stage:"fix", round, rechecks, replaced, gap})`;
  `pending` excludes the fix stage; a new `pendingFix` (stage=fix and gap a string) is consumed on the loop's first
  iteration, re-dispatching renderFix to resume.
- `phaseText`/`nextStepText` gained verify-fix wording.
- watch: added a `settled` flag (set only on a normal idle settlement); `for await` exhausted without settled →
  `client.session.abort(sessionID)` aborts the orphaned round + error set to "事件流中断(未收到会话
  结束事件,疑似 server 故障或网络断开)" (event stream interrupted — no session-end event received, suspected server fault or network drop) → the attempt is wrapped as "会话错误:" (session error:) blocked, taking the existing
  retry / active-retention paths, no longer mis-checking subtasks.
- executeWhole: on entry, seeds from the handoff file's `状态:` (status:) line — `完成` (done) returns directly, skipping the whole-task session,
  `继续` (continue) sets `continuation=true` to resume from the top (stale files are cleared by the pipeline's non-recovery path; the file's
  existence means active recovery).
- runExecSession: on entry, detects a non-empty testHandoffFile → `continuation=true` seeds the continuation
  (renderTestContinue tolerates run=undefined).

### src/index.ts
- `BOOLEAN_FLAGS` gains `new-session`; the run branch parses it and passes it through to runAll; the top boolean-options comment,
  the usage text's run line `[--new-session]` and the option-description line have all been filled in.

### src/loop.ts
- runAll's opts type gains `newSession?: boolean`; the runTask call passes it through.

### test/resume.test.ts
- Removed the RESUME_WINDOW_MS references; the original window test became "a record of any age is still returned (at: 0)";
- Added a stage=fix + gap round-trip test.

## Pending (doc sync only)

1. **plans/0009-verify-review-design.md section H** (~lines 294-318):
   - The "in-session recovery" row: change it to reuse whenever the record is active and the session is alive (no time window; isomorphic to `opencode -r`);
     add `--new-session` (skips reuse only) and the handover-file-first rule.
   - The "phase stage" row: the verify stage gains `fix` (with the verbatim gap text persisted).
   - H.1 known trade-offs: delete the "verify fix rounds have no separate stage marker" item (solved by stage=fix),
     keep the early-review-conclusion and AGENTS.md-wording items.
   - New decision row: an SSE event-stream interruption (the stream breaks before idle arrives) → abort the orphaned round and handle it as a session error
     (keeping active reusable), no longer misjudged as the session ending normally.
2. The **docs/behavior.md** progress-recovery entry (~lines 259-269): rewrite the "30-minute window" sentence; add
   --new-session, handover-file first, precise fix-round recovery, and broken-stream handling.
3. **docs/structure.md**: sync the `src/runner.ts` entry (it contains the "active and within the 30-minute window" wording) and
   the `src/resume.ts` entry (RESUME_WINDOW_MS=30 minutes).
4. **README.md**: the interruption-recovery section (~lines 322-340; rewrite the "within 30 minutes" paragraph, add handover-first and
   --new-session explanations); the run option table (~from line 151) gains a `--new-session` row.
5. **This file**: once everything is done it can be deleted (the design truth lands in plans/0009-verify-review-design.md section H) or marked implemented.
6. The package-root AGENTS.md navigation line "中断恢复 → src/resume.ts" (interruption recovery → src/resume.ts) is still accurate, no change needed; just confirm no 30-minute
   leftover wording remains.

## Verification

```bash
bun typecheck && bun test
```

After the doc changes there is no need to re-run tests (no code changes), but a final confirming run is recommended.
