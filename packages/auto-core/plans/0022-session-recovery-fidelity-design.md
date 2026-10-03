# Session Recovery Fidelity Design: Resumable-session-id Criteria, Minimal-Continuation Resume, and stash Rollback

> Status: initiated 2026-09-14, design finalized; **implementation completed 2026-09-15 (S1/S2/S3 all landed,
> the OPENCODE_AUTO_STRICT_RESUME switch defaults to off and is in gradual rollout; see the §4 checklist)**
> (plans/0021-commit-boundary-design.md decision D6).
> 2026-10: the switch is promoted to **default-on** (ruling P-1 of
> `plans/0070-driver-docs-governance-and-round-transition.md` — promote: 20-test coverage, 17+ days gray,
> no field incidents); `OPENCODE_AUTO_STRICT_RESUME=off` remains the emergency-off override, and retiring the
> knob entirely is a later, separately ruled unit.
> 2026-09-15, evidence-based revision per a field-log audit of the two target directories (kernel-spi-nor / kernel-dm,
> about 23MB of run logs, 2026-09-10..15): the reuse criteria gain a model-consistency check (3.1 ④),
> R3 gains a handover-boundary write verification (new trigger in 3.3), fork base-point independence is made explicit (3.4), and correction suggestions for adjacent mechanisms
> (3.5, registered with their owners) are recorded. Evidence details and log sources: docs/session-interruption-field-audit-20260915.md at the repository root.
> Original user requirement (2026-09-14): when an AI session starts with normal execution progress, record its
> session id for interruption recovery; on recovery it must be strictly ensured that the session id corresponds to the session that was live when the current run was interrupted,
> and **append at most one `continue` prompt** to avoid interference from excessive prompts; the bar for recording a resumable session id
> is extremely high -- post-recovery work must closely match the uninterrupted state (including local modifications the AI made via tools);
> if that cannot be guaranteed, restore the state to the initial state at run start via `git stash` and continue in a new session.
> Rollback anchor = the per-unit clean baseline landed by plans/0021-commit-boundary-design.md (worktree always clean at unit start,
> HEAD is the baseline).

## 1. Goals

1. **Fidelity bar**: reuse of a session id is allowed only when "post-recovery behavior ≈ an uninterrupted continuation" can be argued rigorously;
   any uncertainty → no reuse; roll back to the unit baseline and rerun.
2. **Minimal-continuation resume**: the recovery prompt collapses to a single continue (the current resumeNote carries multi-line per-phase guidance).
3. **Deterministic fallback**: when fidelity cannot be guaranteed, restore the worktree to the unit-start state (git stash preserves the scene +
   reset to the baseline), and a new session redoes this unit from the clean baseline -- trading some wasted work for determinism
   (explicit user choice).

## 2. Current-State Audit: Coherence of the Six Recovery Paths

| # | Path | Current state | Coherence gap |
|---|---|---|---|
| R1 | Execution-chain session reuse (active record + session alive → attempt's resumed) | Reuses the original session + resumeNote (multi-line per-phase guidance) | Prompt overload (requirement: a single continue); reuse criteria already fairly strict (alive + the unitReruns ownership gate + not an error stub) |
| R2 | requireArtifact step resume (phase-plan/phase-handover, openStep) | Reuses the original session, keeps the artifact scene (resumedSession) | Keeping in-flight artifacts = post-recovery state consistent with "never interrupted" (acceptable); prompt as heavy as R1 |
| R3 | Handover resume (handoff.md `状态: 继续` (status: continue), new session relies on the document) | Context is carried by the document; the new session reads it and continues | Coherence rests on document quality, not session fidelity -- this is "progressive degradation"; under the fidelity bar it should be explicitly **not guaranteed**, and a missing/low-quality document should trigger rollback and rerun (current behavior: one retry with feedback, then a silent block) |
| R4 | Fallback ring / retry ring fork (failback, forking the most valuable session) | session.fork carries the messages over and continues; context migrates along | fork has the highest fidelity (message-level copy); but behavioral drift after a model switch is unquantified -- under the "a model change is a user-visible change" doctrine it is outside this design's rollback scope |
| R5 | Session death (active record present, session gone) | New session + resumeNote (summary state), **keeps the mid-flight dirty worktree and continues** | **Main gap**: mid-flight tool modifications stay in the worktree and the new session faces a scene "it did not make itself" -- fidelity does not hold; this design changes it to rollback and rerun |
| R6 | Graceful exit (blocked/pending, summary-state record) | Rerun after manual intervention; the new session relies on the CURRENT.md interruption note | A human may have changed the environment, so the old session is not reused (current behavior is correct); mid-flight changes were already swept by the interrupted commit, baseline clean |

Conclusion: R1/R2/R4 meet the fidelity bar (they only need prompt slimming); R5 needs rollback; R3 is demoted to "best effort"
(continue when the document is valid, roll back when it is not, and no more repeatedly demanding documents).

### 2.1 Field-Evidence Notes (2026-09-15 audit; source: docs/session-interruption-field-audit-20260915.md at the repository root)

- **R1 proven feasible in the field**: 4 cross-run reuse cases (T-013@148.3k / T-014@223.8k / T-019@201.8k /
  T-054@22.3k context), all resumed work successfully. The recovered session's self-orientation routine is highly persistent (read CURRENT.md →
  git status/log → first unchecked item in PLAN.md → artifact existence), confirming 3.2's feasibility -- the session already orients itself from the on-disk
  state, so the recovery prompt only needs the "continue" signal.
- **A hidden strength of the R1 recovery order**: on recovery the driver first refreshes the digest fork base point and the original session only finishes the current subtask;
  all downstream subtasks fork from the new base point -- the blast radius of a reuse failure is limited to a single subtask (kept explicit in 3.4).
- **Session liveness must be probed**: in the field one ECONNRESET (server-side restart) evaporated an entire chain's sessions -- the active record was present,
  the sessions were not; liveness must not be assumed from records (this is the real entry point of the R5 path).
- **R5 field evidence**: for dm T-010 (08-22) the new session did a "forensic" reconstruction of the previous session's uncommitted work-in-progress (git status/diff +
  inference from compile/test runs); it happened to succeed in practice but depended entirely on the model's reasoning quality -- validating this design's "rollback over dirty-area continuation" orientation.
- **R3 failed in the field**: the T-019/S07 session claimed it had written testhandoff.md, but the file never existed (zero records across the full git history),
  and it was only caught by the S09 acceptance subtask; on another occasion a handover session violated the "do not fix in this session" instruction and ran chmod on its own.
  Conclusion: **"completion is not judged by the agent's self-report" must apply equally to handover documents** -- write verification moves up to the handover boundary (3.3).
- **Context-overflow exposure**: handover currently triggers only on the dual condition "test failure × limit reached"; field sessions routinely ran to 2–4x the limit
  (64k/80k limits vs measured 72.7k–264.3k); the larger the context, the larger the loss surface of session death (R1→R5) (3.5 ①).
- **Retrying quota-class errors in a new session is structurally futile**: the limit is account-level; in the field, 2 retries returned the same error within 1 second (3.5 ②).
- **Provider switches are naturally safe across runs** (on-disk ledger architecture; 4 in-field model switches with continuous work), but model consistency
  must enter the reuse criteria (3.1 ④); both target directories' opencode.json files still carry 4 duplicate model keys
  (JSON last-wins) -- configuration drift is a field fact that has actually happened.

## 3. Design

### 3.1 Recording Criteria for a Resumable session id (Tightened)

Record as "resumable" only when all of the following hold:

1. The prompt was dispatched successfully and the round is proceeding normally (current state: the active record is written on dispatch, already satisfied);
2. The record carries unit ownership (phase + index; the unit-ownership gate already has this);
3. **Unit baseline on record**: add `baseline` to the record (per-repository HEAD SHA; commit-boundary already has
   unitBaseline) -- on recovery, verify each repository's current HEAD: HEAD == baseline, or
   every commit in baseline..HEAD carries the Auto-Stage trailer (i.e. only the driver committed in between); otherwise foreign
   commits have mixed in and the session context's view of the present is distorted → no reuse, roll back.
4. **model consistency** (added 2026-09-15): add `model` to the record (the effective provider/model string) --
   on recovery, a mismatch against the model resolved from the current configuration → no reuse. Continuing a session on a different model = behavioral drift,
   a user-visible change (same doctrine as R4); this also intercepts target-directory opencode.json configuration drift of the duplicate-model-key
   last-wins kind (both target directories still carry 4 duplicate keys in the field; the effective model may not be the intended one).

The Progress structure gains optional `baseline` and `model` fields (old records lacking either field → treated as non-resumable,
taking the rollback path; during gradual rollout the environment variable `OPENCODE_AUTO_STRICT_RESUME` controls old vs new behavior, defaulting to the current
behavior and promoted once the experiment is finalized -- the same pattern as the fork switch).

### 3.2 Minimal-Continuation Resume (a Single continue)

- R1/R2's resumeNote collapses to a single sentence, e.g. `[driver] 会话曾中断,请继续当前工作直至本单元完成。` ("the session was interrupted; please continue the current work until this unit is complete.")
- The per-phase guidance is redundant anyway: the session context already contains the task prompt and progress; what recovery truly needs is only
  the "continue" signal and "what counts as done" (already in the original prompt). Per-step next-step guidance stays in
  the **handover document / status files**, not in the recovery prompt.
- Copy changes concentrate on the runner.ts resumeNote + the templates are untouched; prompt.test.ts is updated in step.
- **Added 2026-09-17**: the single continue gains a half-sentence clarification of commit semantics (「中断前落盘的修改若已
  不在工作区,即已由 driver 统一提交进 Git——以 git log 核实,不要重做」 -- "modifications landed before the interruption that are no longer in the worktree have already been committed into Git by the driver as a whole; verify with git log, do not redo them"). The trigger:
  when a recovered session cross-checks the on-disk state with git, "clean worktree / unfamiliar commits in git log" gets misread as modifications
  lost and redone: pre-interruption modifications may still sit uncommitted in the worktree (interrupted mid-unit), or may already have been
  committed by the driver as a whole (finalization/handover/unit close-out) or committed via manual disposal (the clean gate of a post-interruption rerun
  requires a human to dispose of the dirty area). Recovery paths that are not the single continue (multi-line resumeNote guidance) and the fork-recovery
  interjection for test handover (exec-session) carry the same sentence in step (sharing the `COMMIT_CLARIFY` constant,
  resume-gate.ts)。

### 3.3 Rollback Protocol (When Fidelity Cannot Be Guaranteed)

Trigger conditions (any one suffices):

- The active record's session is not reusable (dead/error stub/--new-session) and the unit baseline is on record;
- Baseline verification failed (foreign commits mixed in);
- model mismatch (3.1 ④);
- Handover-resume document missing/invalid (R3 tightened) -- **including handover-boundary write verification** (added 2026-09-15): after the handover session
  ends, the driver immediately verifies the handover document is on disk and ends with `状态: 继续` (status: continue); a miss triggers rollback immediately, rather than being
  discovered when the next session reads it. Field evidence: the S07 session claimed it had written testhandoff.md; the file never existed
  (zero records across the full git history) and was only caught at acceptance time -- "completion is not judged by the agent's self-report" applies equally to handover
  documents; the moment of detection must move up from the acceptance period to the handover boundary.

Actions (per repository, depth-first, mirroring commitTree's traversal):

1. `git stash push -u -m "auto-rollback <task> <unit> <timestamp>"` (preserve the scene;
   uncommitted changes remain manually recoverable; `.auto/` and `tmp/` are already gitignored and naturally stay out);
2. If driver commits of this unit exist within baseline..HEAD (interim subtask handover commits and the like):
   `git reset --soft <baseline>` then stash -- pulling this unit's already-booked partial work back
   into the stash, returning the branch to the baseline (not applicable to pushed/referenced commits -- target directories are repositories under the driver's
   exclusive control, not pushed by default; if an upstream is detected, skip the reset, stash only, and warn);
3. The progress record switches to summary state (active=false, baseline cleared) and CURRENT.md gets a rollback note;
4. A new session redoes this unit from the clean baseline (cold-start prompt, no resumeNote attached).

Things not done: nothing outside the nested repositories is stashed; human commits are untouched (when foreign commits are detected,
**no rollback** -- go straight to a dirty block and hand it to a human -- rollback reclaims only the driver's own in-unit changes).

### 3.4 Relationship to Existing Mechanisms

- **Unit commit boundary (commit-boundary)**: this design consumes its baseline and trailer verification; after rollback,
  the unit restarts clean and the gate passes naturally.
- **Unit ownership gate (unitReruns)**: unchanged -- rollback affects only "sessions and scene", not the routing of
  "which unit will be rerun".
- **Unified commits**: the stash produced by rollback is not part of the commit trajectory; the unit redone by the new session still commits per session as usual.
- **Stats**: session durations already booked for the rolled-back unit are kept (real consumption); the redone portion is booked incrementally.
- **Fallback ring (failback)**: fork continuation (R4) does not trigger rollback -- fork is message-level copy, fidelity
  higher than document handover; rollback is reached only when fork also fails.
- **fork decomposition** (made explicit 2026-09-15): on R1 recovery the digest fork base point is refreshed first and the original session only finishes
  the current subtask; all downstream subtasks fork from the new base point -- the failure blast radius of a reused session = a single subtask.
  This structure is a field-proven hidden strength and must be preserved in implementation (the rollback protocol does not change the fork cadence).

### 3.5 Evidence-Based Correction Suggestions for Adjacent Mechanisms (registered 2026-09-15; outside this design's implementation scope)

The following two items come from the field audit (source: docs/session-interruption-field-audit-20260915.md at the repository root);
they are registered for their owning designs, to avoid getting lost:

1. **Handover-trigger decoupling** (**implemented 2026-09-15**, see plans/0023-test-handover-early-design.md): currently
   handover triggers only on the dual condition "test failure × context limit reached"; field sessions routinely ran to 2–4x the limit
   (64k/80k limits vs measured 72.7k–264.3k) -- while tests stay green the session grows without bound, and the loss surface of session death
   grows with it, directly coupled to recovery fidelity. Suggestion: hand over on the single condition of the context reaching its limit (at a subtask safety boundary).
   Owner: the runner.ts handover decision (fork-decompose / commit-boundary system).
   **The safety boundary actually landed on is "the moment the AI initiates the tests"** (when tmp/test.sh appears): initiating tests usually
   means the related work is finished and about to be verified -- the only naturally clean split point; the criterion is accordingly decoupled to
   the single condition `used ≥ contextLimit`. The companion D3 "one handover, two commits" makes the worktree clean at the handover point,
   and dissolves the limitation of the "handover-resume dirty-area exemption" registered in §6 on this path.
2. **Quota-class errors must not burn new-session retries**: quota is an account-level limit; retrying in a new session is structurally futile (in the field, 2
   retries returned the same error within 1 second). classifySessionError already classifies quota; the retry ring should skip the new-session retry
   and go straight to the fallback ring (block if no candidates are configured). Owners: plans/0015-session-error-retry-plan.md /
   plans/0017-model-routing-design.md。

## 4. Phased Implementation (all completed 2026-09-15)

Landing spots at a glance (files changed in 2026-09-15 session 1): `src/switches.ts`, `src/resume.ts`,
`src/git.ts`, `src/runner.ts`, `test/switches.test.ts`; typecheck clean and a full
`bun test` at 706 green (the last full run before the final stroke of the injectability refactor; only typecheck re-verification after that).

- [x] **S1-a switch** (prerequisite for S3): `OPENCODE_AUTO_STRICT_RESUME` (off|on, default off)
  fully registered (SWITCH_ENV/Switches/DEFAULTS/parse/nonDefault/format in switches.ts);
  test/switches.test.ts updated in step (sixteen variables, illegal values, non-default items).
- [x] **S1-b fields**: resume.ts Progress gains `baseline?: UnitBaseline` (type-import from
  git.ts, no cycle) + `model?: string`; parseProgress round-trips (per-item validation of the baseline array).
- [x] **S1-c verification**: git.ts extracts the shared `foreignCommits(root, sha)` (unitViolations switched to it in
  step); adds `baselineIntact(dir, baseline)` -- checks only HEAD==baseline or an all-Auto-Stage range,
  **not uncommitted changes** (the mid-flight dirty area is precisely the recovery target).
- [x] **S1-d records**: runner.ts attempt's remember() writes, when strictResumeActive,
  `baseline: chain.baseline ?? unitBaseline(dir)` and `model: promptModel` (promptModel is an outer
  let backfilled after the target is evaluated); baseline placement points on the chain: runTask entry, persistStage (refreshed at phase boundaries,
  narrowing the rollback radius), runSubtask (after the subtask gate), requireArtifact (unitStart chain).
- [x] **S1-e resumeNote slimming**: `reused && strictResume` → the single sentence
  `[driver] 会话曾中断,请继续当前工作直至本单元完成。` (glossed in §3.2); non-reuse paths (graceful-exit
  summary state) keep the existing per-phase guidance; resumeNote is now exported.
- [x] **S2-a rollbackUnit(dir, baseline, info)** (git.ts): per repository, mirroring commitTree's
  depth-first; foreign commits → that repository is left untouched and counted in failures (overall ok=false → the caller goes dirty);
  `stash push -u -m "auto-rollback …" -- .` (pathspec limits the subtree); with an upstream → skip the
  reset, stash only, and warn; baseline on an empty repository / repository not on the baseline → stash only; after reset --soft a second
  stash reclaims the already-booked commits; returns RollbackResult{ok,failures,stashes,resets,skipped}.
- [x] **S2-b R5 wiring** (runTask recovery block): strict branch -- baseline verification failed → `dirty` exit;
  session death/error stub/--new-session/model mismatch → `rollbackUnitState` (runner-side orchestration:
  rollbackUnit + record to summary state clearing baseline/model + CURRENT.md rollback note) → `recalled.active
  = false` (the pipeline takes non-recovery continuation semantics), no chain.note set (cold start); the `rolledBack`
  note is subsequently merged into the task-mirror writeCurrent. Old records without a baseline (legacyRecord) → alive forced
  false → the existing new-session path (noted in the copy).
- [x] **S2-c R3 tightening + handover-boundary write verification**: executeWhole/runSubtask -- after handoverDue, an invalid document
  once triggers `rollbackRedo()` (rollback + resetting continuation/feedback/retried and the chain state
  + a cold-start redo; runSubtask additionally re-seeds seedForkSession from the base point), `rolled` limited to once; on a further
  failure it escalates per the existing silent block; watch's handleIdleTest, under strict, treats a missing/empty document directly as
  `{type:"invalid"}` (no more steer-to-rewrite retry) → folded at idle into blocked +
  `Watch.testHandoverInvalid` → attempt folds it into the `SessionResult.rollback` marker → the unit's
  owner rolls back and redoes; **scope**: fixRound has no baseline context and ignores the marker, keeping current behavior (block);
  rollback-redo lands only at the two executeWhole/runSubtask sites (decision: a fix-round rollback anchor is outside this design's
  unit scope). On recovery, a handover document present but without a status line (handoffInvalid, requires the baseline on record) → rollback
  rather than document-based continuation; `handoffStatus()` unifies the status-line criterion.
- [x] **S2-d requireArtifact step resume made strict**: sameStep with the baseline on record → baselineIntact
  failure means dirty; model mismatch/record without model/death → after rollbackUnitState, redo as a brand-new step;
  old records without a baseline → no reuse, taking the existing "open a new session and redo this step".
- [x] **S1/S2 tests**:
  - test/resume.test.ts: baseline/model round-trip, compatibility for records missing the fields;
  - test/git.test.ts: baselineIntact (HEAD==baseline / driver-range pass / foreign-commit detection / empty baseline)
    and rollbackUnit (dirty area + driver commits → stash×2 + reset back to baseline, stash list containing
    auto-rollback, clean worktree; foreign commits → ok=false with the repository untouched; upstream → stash only;
    empty baseline → stash only; nested repositories each roll back their own);
  - test/runner.test.ts: resumeNote's two states (injection needed, see below); the requireArtifact strict
    path (switches injected: record with baseline + matching model → reuse; model mismatch/session death →
    reopen after rollback -- records built with a git init temp repository + saveProgress, asserting the HEAD reset and the
    stash's existence).
- [x] **S3 close-out**:
  - Injectability completed (done): ① strictResumeActive inside requireArtifact takes switches;
    ② watch gains a switches parameter (passed through at attempt's call sites) and handleIdleTest uses it; ③ resumeNote
    gains a third parameter `strictResume = autoSwitches().strictResume`; the three runTask/requireArtifact
    call sites pass the **gate value** `strict` (§4.1 ⑥, not the bare switch); ④ inside attempt's remember,
    strictResumeActive takes switches (the gate call at the runTask entry passes it through as well).
    executeWhole/runSubtask's strictResumeActive(opts) is not on the unit-test surface and stays as is;
  - Docs synced: docs/behavior.md (strict-resume behavior section: recording criteria/verification/rollback/the rule that without a configured route
    nothing is ever reused), docs/structure.md (the sixteenth switches variable + git.ts
    baselineIntact/rollbackUnit + runner.ts additions), the package AGENTS.md navigation line, and the root
    /workspace/aseo/AGENTS.md in-progress-plans section (changed to implemented + the switch default off in gradual rollout),
    this file's status line switched to "implemented (gradual rollout)";
  - Final verification: `bun typecheck` + `bun test` in the package directory all green.

Finalized (2026-09-15 session 2): all four injectability points are complete (requireArtifact's strictResumeActive
takes switches, watch gains a switches parameter passed through via attempt, resumeNote's third parameter receives the gate value from call sites,
and attempt's remember takes switches; the gate call at the runTask entry passes through as well). 20 new tests --
test/resume.test.ts 2 (baseline/model round-trip and bad-value tolerance), test/git.test.ts 8
(three baselineIntact cases + five rollbackUnit cases, including an upstream self-reference construction and nested repositories),
test/runner.test.ts 9 (three resumeNote states + six requireArtifact strict-path states, including the switch-off
equivalent-current-behavior regression); a reverse check was done -- flipping the injected strictResume to off makes all four strict cases fall immediately.
auto-core `bun typecheck` clean, `bun test` 726 all green (previously 706); the auto shell's typecheck clean,
e2e 52 passing (one new --commit false retirement case).

### 4.1 Implementation-Period Decision Log (settled positions beyond the design text)

1. **Gate linkage**: the strict mechanism as a whole is gated on `strictResumeActive = 开关 on 且
   --commit true 且非 dryrun` (switch on, --commit true, and not a dryrun); off (the default) means records carry no new fields and verification and rollback are byte-for-byte equivalent to the status quo.
2. **No routing, no reuse** (§5 literal reading): when OPENCODE_AUTO_MODEL is not configured the record has no model to write,
   which under strict resume counts as a mismatch → rollback; session reuse requires a configured route (behavior.md must state this).
3. **Baseline-anchor tiering**: the task-entry baseline (runTask, same HEAD as loop's beginUnit) is narrowed by the subtask/
   phase-boundary baselines that override it; a nearer baseline and a farther baseline verify equivalently under "all commits in the range are driver commits",
   with a smaller rollback radius.
4. **Foreign commits ≠ rollback**: always dirty and handed to a human (3.3, "Things not done"), covering both the recovery check and
   both sides of rollbackUnit.
5. **Mid-flight rollback-redo bound**: once each for executeWhole/runSubtask (`rolled`); a further failure takes the existing
   silent block; the scene is already preserved in the stash.
6. **resumeNote's gate reading** (settled 2026-09-15 session 2): the third parameter is passed the **gate value**
   `strictResumeActive(opts, switches)` by the call sites, not the bare switch -- when the gate is not in place there is neither a unit baseline nor a
   rollback backstop; the premise the "single continue" rests on (roll back and rerun whenever fidelity is unprovable) does not exist, so the existing
   multi-line per-phase guidance stays. Same doctrine as §4.1 ①.
7. **`--commit false` retirement** (user decision 2026-09-15, plans/0021-commit-boundary-design.md D7):
   the commit-off mode conflicts with this design (and with commit boundaries) -- with the gate off, strict resume spins idle as a whole, yet it would require every
   new mechanism to carry an idle branch. Entrance-layer soft retirement is done: a CLI `--commit false`/`none` or a config
   `commit: false` occurrence is a usage error/strict failure; the `opts.commit !== false`
   term of `strictResumeActive` is thus always true, leaving the gate effectively "switch on and not dryrun". The code-side gate branch stays for now; its cleanup is a separate task.

## 5. Risks

- **Wasted work**: rollback discards mid-flight work (recoverable from the stash); against the current state's hidden risk of "dirty-area continuation",
  the user has decided for determinism.
- **Visibility of reset**: soft reset rewrites branch history; limited to driver repositories without an upstream,
  with an upstream it degrades to stash-only + a warning.
- **Old-record compatibility**: existing active records without baseline/model fields are uniformly treated as non-resumable (new session/
  rollback, the choice controlled by the S1 switch), avoiding half-hearted verification. The model-consistency check judges only "on record and mismatched"
  → no reuse; a missing record counts as a mismatch, the same reading as baseline.

## 6. Field-audit provenance (added 2026-10-03): the interruption audit

The raw field evidence behind §2.1 and 3.5 is `session-interruption-field-audit-20260915.md` (2026-09-15, written in Chinese; at deletion
time it sits in `docs/temp/` of the target root — the status header above cites it "at the repository root", a path that has drifted). The
docs-governance round rules the file for deletion; it remains findable in this repository's git history afterward. Its qualitative
findings are already folded above (the R1 reuse cases, the R3 phantom handover document, the R5 forensic reconstruction, the
context-overflow exposure, the quota-retry futility). The unique quantitative summary, preserved here:

- **Scope**: the `.auto/logs/run-*.log` execution logs of two auto-migrate targets, 2026-09-10..2026-09-15, about 23 MB excluding the
  `vfull-*` verification logs — kernel-spi-nor R-01 (5 runs, the largest single log 6.9 MB) and kernel-dm R-04 (08-22, five consecutive
  runs) plus R-05 (09-13..15, largest 7.1 MB).
- **Mechanism usage, final runs**: spi-nor 72 digest forks and 9 handover session switches; dm 119 digest forks and 27 handover switches.
  Across both directories 36 handover documents were written by the "tests fail × context at limit" cycle (spi-nor 9 / dm 27). A digest
  fork measured a 93% cache-hit rate (T-020-S02).
- **Context at handover trigger**: 90.7k–264.3k against the 80k limit (spi-nor); 72.7k–251.8k against 64k (dm) — the 2–4× figures §2.1
  cites. Sessions grew unbounded while tests stayed green.
- **The old architecture, for contrast**: dm's R-04 (08-22) ran same-session cross-subtask reuse (♻) on kimi k3-256k with a 262.1k
  window, accumulating 13% → 61% across subtasks — cache-friendly with a large single-failure surface; retired in September for the fork
  architecture. Both directories ran the audit with `OPENCODE_AUTO_REUSE_SESSION=off` + `FORK=on/FORK_BASE=digest` (after 09-13) and an
  empty `OPENCODE_AUTO_MODEL_FALLBACK`, so quota and timeout events relied entirely on blocking plus human pacing.
- **The audit tables**: the raw file's §2 is an interruption typology by phase (analysis a / design d / migration m) with each incident
  anchored to its run log and timestamp; its §4 is a seven-mechanism inventory table (① cross-run reuse of the interrupted session,
  ② digest base + new session after session death, ③ digest-fork per subtask, ④ handover document, ⑤ new-session retry on transient
  errors, ⑥ blocked-then-attempt-N+1, ⑦ the old same-session reuse) with per-mechanism field evidence and risk notes — ① succeeded 4/4,
  ④ failed once in 36 (the S07 phantom document), ⑤ is structurally futile for upstream timeouts and account-level quota; its §7 is a
  data-source index naming every run log and the config evidence (both targets' `opencode.json` carrying 4 duplicate `model` keys,
  JSON last-wins).

<!-- auto: eof -->
