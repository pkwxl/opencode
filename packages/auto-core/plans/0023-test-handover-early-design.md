# Test Handover Front-Loading Design (criterion decoupling + one handover, two commits)

Status: **Implemented 2026-09-15** (`auto-core` branch; P1..P5 landed, P6 gradual-rollout switch evaluated and not done -- see §F for the rationale).
**Revision 2026-09-15 (§H): test timing changed from "true concurrency" to "handover first, run later"; the retest guard is retired.**
**Revision 2026-09-15 (§I): recovery from interruption mid-handover -- locate the breakpoint by file state × commit state and resume; the PLAN.md blocking notes are retired.**
**Revision 2026-09-16 (§J): discard the pinning session right at handover close as the anchor for restart reuse / retry forking -- records no longer point back to the pre-handover session.**
The original wording of D2/D3/D5/D6 is kept below as the pre-rework factual baseline; current behavior is governed by §H. Upstream registration: `plans/0022-session-recovery-fidelity-design.md` §3.5 ① "handover-trigger decoupling".
Field evidence: `docs/session-interruption-field-audit-20260915.md` (repo root, not under version control).

## A. Factual Baseline (Before the Rework)

The handover criterion of `--handover-test` is a two-part condition, attached **after test execution**:

```ts
const run = await executeTest(test, opts)
const failed = run.code !== 0
if (failed && test.handover && used >= test.limit) { ...require writing the handover document... }
```

Handover happens only if "the test fails **and** the context has reached `contextLimit`". Field audit §5 empirically demonstrated the paradox of this criterion:

| Directory | Configured limit | Measured context when the handover triggered | Handovers in that run |
|---|---|---|---|
| kernel-spi-nor | 80k | 90.7k – 264.3k | 9 |
| kernel-dm | 64k | 72.7k – 251.8k | 27 |

**Routinely 2–4x the limit**: while tests stay green the session grows without bound; only the run where "the test happens to fail" gets a passive handover.
The larger the context, the larger the loss surface when the session dies unexpectedly (R1 reuse failure degrading to R5 cold start) --
recovery-fidelity risk is directly coupled to the handover trigger condition.

## B. Decision Table

| # | Decision | Value | Rationale |
|---|---|---|---|
| D1 | Criterion and timing | **Judge and dispatch the prompt at the exact moment the AI initiates a test (`tmp/test.sh` appears)**; the criterion decouples to the single condition `used ≥ contextLimit`. When no live value can be read at that moment, keep using the start value `startUsed` | Initiating a test usually means the related work is done and is about to be verified -- the only naturally clean split point; past that moment the context starts changing and is no longer cleanly cuttable |
| D2 | Test vs wrap-up | ~~**True concurrency**~~ (**changed to sequential in §H**; concurrency kept behind `OPENCODE_AUTO_HANDOVER_CONCURRENT=on`): steer the wrap-up + handover instructions without awaiting the test. The prompt does **not** demand "don't touch the source code" | Serial execution would leave the session hanging until the provider cache expires; when the AI initiates a test it already knows the code under test must not move, no need to say it for it -- state is fixed by D3's pinning commit and backstopped by the retest guard |
| D3 | Commit strategy | **One handover, two commits**: commit #1 pins when the script is dispatched, commit #2 confirms at handover close. ~~Source and script must be unmodified between the two commits~~ (**§H change**: the sequential-mode invariant is "what gets tested is exactly the tree of commit #2") | Every handover has a rollback-able record; pinning turns "which copy of the code is under test" into a fact rather than a convention |
| D4 | Handover document archiving | Accumulates `testhandoff-<n>.md` in the same directory; the new session reads the latest copy | The handover chain stays traceable; the current copy's name is constant, so the session's write target never changes |
| D5 | Retest trigger surface | Considers only `test/**` and **tracked** non-document source files; `docs/**`, `PLAN.md`/`CURRENT.md`, and untracked new files do not count | Wrap-up always writes documents to disk; counting them would mean one extra test run per handover; untracked new files that join compilation get missed -- a deliberate trade-off |
| D6 | ~~stash handling~~ (**retired wholesale in §H**) | `stash -u` → rerun against the pinned snapshot → `stash pop` → commit #2; a pop conflict blocks immediately (exit code 2), the stash entry is kept | Not one wrap-up result is lost; conflicts are not swallowed |

## C. Handover Timing (Before the Rework; Current Timing in §H)

```
Session idle, tmp/test.sh on disk
  │
  ├─ testHandoverDue(test, used) == false ──► executeTest → steer test-result → continue in the same session
  │
  └─ true (context at the limit)
       ① afterSession commit #1   stage `<单元> handoff-<n>-pin` (unit-label placeholder)   subject `<单元提交标题> 测试交接 #n 定版` ("<unit commit title> test handover #n pin")
       ② test.running = executeTest(...)        ← not awaited
       ③ steer test-wrapup (persist the remaining work + write the handover document + end the session)
       ...while the session wraps up, the test runs concurrently...
       ④ attempt awaits test.running after watch returns      ← the test process never dangles across sessions
       ⑤ guardRetest: trackedSourceChanges non-empty → stashAll → runTestScript (same script) → stashPopAll
       ⑥ rename testhandoff.md → testhandoff-<n>.md
       ⑦ afterSession commit #2   stage `<单元> handoff-<n>` (unit-label placeholder)      subject `T-NNN 测试交接 #n` ("test handover #n")
       ⑧ New session: task prompt + test-continue (first read the archived handover document, then interpret that test's results)
```

Invariant: **between commit #1 and commit #2, source code and `test/` scripts are byte-identical** (guaranteed by ⑤).
-- That invariant was voided together with ⑤'s retirement; see §H for the replacement.

## D. Hard Copy Constraints (Landing D2)

`test-wrapup.md` **must not contain 「上下文 / 超限 / 上限 / tokens」 (context / over-limit / limit / tokens)**. Field evidence: once a session knows its own
context is tight, it decides on its own that the remaining budget is insufficient and skips persisting work it should have completed -- yet this very handover requires it to first finish
the remaining work that does not depend on test results. The copy states only the fact "a handover is needed and the session must switch", and explicitly writes
「不要因为要交接就省略,这些工作不做完,新会话要从头重做」 ("do not skip just because a handover is coming; if this work is left undone the new session must redo it from scratch"). Likewise it does not say "do not modify the source code":
saying it would only hint to the session that this is a boundary it may freely exercise discretion over. `test/prompt-exec.test.ts` locks this constraint with reverse assertions.

The protocol sections of `subtask.md`/`whole.md`/`fix.md` were likewise reworded -- describing the handover as "the established handover
cadence, not something that went wrong", with no mention of failure or limits.

## E. Relationship to Existing Mechanisms

- **Orthogonal to the ondemand context handover**: the `handoff.md` / `handoffSteer` / `handoverDue` threshold remains
  `2×cap`; the two criteria sit side by side unmerged (`OPENCODE_AUTO_STEER` in `switches.ts` governs only the former).
- **Compatible with the commit-boundary system**: `unitViolations` only checks that every commit in the range carries the `Auto-Stage` trailer,
  it does not limit the commit count, so two extra driver commits inside a unit are legal. When `rollbackUnit` rolls back to the unit baseline it also discards
  the handover commits, which is semantically correct (the whole unit is redone).
- **Resolves a known limitation**: "dirty worktree during handover continuation, exemption from the clean
  gate" registered in `plans/0021-commit-boundary-design.md` no longer holds on the test-handover path -- the worktree at the handover point has been emptied by the two commits.
- **Coexists with the handover-boundary write gate**: the validity criterion for the test handover document is still "non-empty" (it does not require a `状态: 继续|完成`
  ("status: continue|complete") line) -- the decision happens before the test results have been interpreted, so the session has no way to decide 「完成」 (complete); even if required, it could only ever read 「继续」 (continue).
  The strict-recovery channel of rollback-and-redo on one invalid hit is preserved as-is.
- **Relation to stable-refs R2**: `testhandoff.md` is a protocol-level temporary file (the driver has always deleted it);
  only after the rename to `testhandoff-<n>.md` does it become a permanent path; the archived copies are removed with the whole chain when the execution scope completes,
  and the historical handover content is carried by the git commit records.

## F. Not Done, and Known Trade-offs

- **No gradual-rollout switch** (the originally planned P6 `OPENCODE_AUTO_HANDOVER_EARLY`): the old dual condition and the new flow
  have different control-flow shapes (the old "execute first, judge afterwards" and the new "judge first, pin, run concurrently" cannot share one path),
  and a switch would mean permanently nursing a parallel branch inside the most delicate `handleIdleTest` -- exactly the shape judged
  harmful when `--commit false` (D7) was retired. The rollback hatch is `--handover-test` itself (turning it off returns fully to
  the pre-rework behavior), which is enough.
- **Untracked new files do not trigger a retest** (D5): if a source file newly created during wrap-up takes part in compilation, the retest guard cannot see it.
  What that buys is "wrap-up documents/artifacts written to disk never cost one pointless extra test run".
- ~~**stash `-u` and build artifacts**~~ (retired along with the retest guard, §H): if the first test produces build artifacts not covered by gitignore, they get swept into the stash;
  producing them once more on the rerun can make `pop` conflict → block per D6, keep the stash entry, hand to a human. Target projects should put build
  artifacts under `.gitignore`.
- ~~**The rerun script survives only because `tmp/` is ignored**~~ (the rerun was cancelled; but in the sequential mode the script hangs off
  `TestRun.pending` and survives across the session boundary, and the inline form `tmp/test.<n>.sh` still relies on `tmp/` being ignored,
  so this dependency still holds as-is, §H): `git stash -u` takes away untracked files but does not touch **ignored**
  files, and `tmp/` is registered as ignored by `ensureGitignore` -- the inline form `tmp/test.<n>.sh` and the successive
  `.out` files therefore stay on disk untouched during the stash, and the rerun can get the script (the `test/` form was committed to begin with).
  If the ignore policy of the driver's working directory is ever changed, this dependency must be re-examined along with it.
- **Commit #1 is a mid-session commit**: its safety rests on "`handleIdleTest` is driven by the idle event, and at that moment
  the session has no half-written files". If that premise changes (e.g. test requests are someday detected at a non-idle moment), the pinning commit must
  move with it.

## G. Step Checklist

- [x] P1 criterion decoupling and value fallback -- `TestRun.startUsed`, `attempt` sampling tiered by `reuse`,
      export of the pure criterion `testHandoverDue` (`src/runner.ts`)
- [x] P2 the three actions at the test-request moment -- commit #1 / start the test concurrently / dispatch the wrap-up (`handleIdleTest`),
      the concurrency handle hangs on `TestRun.running` and is reaped uniformly by `attempt` after `watch` returns
- [x] P3 retest guard -- `trackedSourceChanges` / `stashAll` / `stashPopAll` in `git.ts`,
      the `guardRetest` + `runTestScript` execution kernel in `runner.ts`
- [x] P4 wrap-up prompt -- the new template `templates/prompts/test-wrapup.md` (replacing `test-handover.md`),
      `renderTestWrapup`, `test-continue.md`, and the protocol sections of the three task templates reworded
- [x] P5 accumulating handover-document archive -- `archivedTestHandoff` / `latestHandoffSeq` in `docpaths.ts`,
      two-state recovery seeding in `runExecSession` plus archive + commit #2, `handoffChainExists` / `removeHandoffChain`,
      and the globs everywhere relaxed to `testhandoff*.md`
- [ ] ~~P6 gradual-rollout switch~~ -- evaluated and not done, see §F
- [x] P7 tests -- reverse assertions in `prompt.test.ts`, four criterion tiers in `runner.test.ts`, guard cases in `git.test.ts`
      (five cases, incl. nested repositories), archive naming and sequence continuation in `docpaths.test.ts`
- [x] P8 docs -- this document, `behavior.md`, `structure.md`, `plans/0022-session-recovery-fidelity-design.md`
      §3.5 ①, `plans/0021-commit-boundary-design.md`, `packages/auto/README.md`, CLI help, navigation, and the root AGENTS.md
- [ ] Real smoke run (all three packages, in the `auto/` integration worktree; needs an environment with credentials)

## H. Revision (2026-09-15): Handover First, Run Afterwards

### H.1 Incident and Root Cause

`auto-migrate` blocked and exited (exit code 2) while running T-028 in `/workspace/kernel-spi-nor`:

```
⏸ T-028 已阻塞: 交接重测后恢复暂存改动冲突
  (asterinas: error: Your local changes to the following files would be overwritten by merge:),
  stash 条目已保留(git stash list),请人工处理后重新运行。
```

The chain: that project's test script rewrites the source under test **in place** at step 0b (`rustfmt --edition 2024 nor.rs`,
applying and freezing whenever `--check` is non-zero). So --

1. Test #1, running concurrently, rewrote `nor.rs` into its rustfmt form;
2. The session wrap-up only wrote documents, but `trackedSourceChanges` saw `nor.rs` change, and the guard concluded "the code under test was
   modified during wrap-up" (**the attribution was already wrong**: what modified it was the test script the driver itself ran concurrently, not the session);
3. After stashing, the guard reran the same script against the pinned snapshot; rustfmt applied the same reflow **again**, and the worktree was dirty once more;
4. `git stash pop` refused -- verified: git reports the same error even when the local changes and the stash contents are **byte-identical**,
   「Your local changes … would be overwritten by merge」。

This is not a race but a **deterministic trap**: whenever a test script makes deterministic rewrites of tracked files, the rerun necessarily reproduces the same change,
and every test handover necessarily blocks. D2's premise ("the session is not supposed to touch the code under test during wrap-up") was broken by the concurrent
execution D2 itself introduced; and `TEST_PRINCIPLE` (`src/agents-block.ts`) never required test scripts to be read-only.

### H.2 Decisions

| # | Decision | Value |
|---|---|---|
| E1 | Test timing | **Sequential**: session ends → archive the handover document → commit #2 → **only then run the test**. The script's own rewrites of tracked files are left as uncommitted increments, absorbed by the next unit's commit |
| E2 | Rollback hatch | `OPENCODE_AUTO_HANDOVER_CONCURRENT`, default `off` (sequential); `on` returns to D2's true concurrency |
| E3 | Retest guard | `guardRetest` / `stashAll` / `stashPopAll` **deleted wholesale**. Concurrent mode only uses `trackedSourceChanges` to emit a one-line drift warning (before commit #2; after it the diff is always empty) -- no stash, no rerun, no blocking |
| E4 | Commit #1 pinning | **Kept** -- one handover still means two commits; it no longer carries D3's byte-identical invariant, but remains a rollback-able checkpoint at the test-request moment |

**Invariant replacement**: D3's "source and script byte-identical between the two commits" is voided and no longer needed; the sequential-mode invariant is
**what gets tested is exactly the tree of commit #2**. That is stronger than before -- the test covers the work the session persisted during wrap-up, not just the pinned snapshot.

**Cost**: the handover's wall-clock time goes from `max(收尾, 测试)` (max of wrap-up and test) to `收尾 + 测试` (wrap-up + test) -- one extra "wrap-up duration" per handover.
Field magnitudes: kernel-spi-nor's test median is about 300s and wrap-up about 74s, so each handover pays roughly 1–2 extra minutes.
The E2 switch exists precisely to switch back to concurrency when pressed for time.

### H.3 Current Timing

```
Session idle, tmp/test.sh on disk
  │
  ├─ testHandoverDue == false ──► executeTest → steer test-result → continue in the same session
  │
  └─ true (context at the limit)
       ① afterSession commit #1   stage `<单元> handoff-<n>-pin` (unit-label placeholder)   subject `T-NNN 测试交接 #n 定版` ("test handover #n pin")
       ② resolveTestScript: consume tmp/test.sh, fix the script and hang it on TestRun.pending  ← not executed
          (concurrent mode: test.running = executeTest(...), not awaited)
       ③ steer test-wrapup (persist the remaining work + write the handover document + end the session)
       ...while the session wraps up, no concurrent writes of any kind...
       ④ concurrent mode only: trackedSourceChanges non-empty → emit a one-line drift warning (must be before ⑥)
       ⑤ rename testhandoff.md → testhandoff-<n>.md
       ⑥ afterSession commit #2   stage `<单元> handoff-<n>` (unit-label placeholder)      subject `<单元提交标题> 测试交接 #n` ("<unit commit title> test handover #n")
       ⑦ runTestScript(test.pending): **what gets tested is the tree of commit #2**
       ⑧ New session: task prompt + test-continue (first read the archived handover document, then interpret that test's results)
```

② must consume the marker at the pinning moment: if the marker survives past the start of wrap-up and the session rewrites it, the driver would run the wrong script; the inline form must
likewise be materialized at the same moment as the pinning commit. Execution and "deciding the script" are therefore split into the two halves `resolveTestScript` / `runTestScript`,
and `executeTest` degenerates into the two chained together.

The title body of a handover commit takes **the execution unit's own commit title** (subtask `T-NNN S<n> <子任务标题>`,
whole task `T-NNN exec <标题>`, fix round `T-NNN fix<n> <标题>`; the angle-bracketed parts are the respective titles), identical to the commit made when that unit completes,
so git history shows at a glance which subtask these intermediate commits belong to. When the title is too long, what gets truncated is the **body**, not the suffix
(`suffixedTitle`) -- `#n` and 「定版」 (pin) are the only information distinguishing a unit's successive handover commits; letting
`commitTitle` truncate from the tail would shave them off. Handover-related log lines likewise carry the short `T-NNN S<n>` tag: those lines
mostly happen outside the session banner (pinning, closing, recovery decisions, and in sequential mode the test script that only runs after the session ends),
and a bare task number would not show which subtask they belong to.

### H.4 Copy

The handover document's content checklist contains an item 「本执行范围内还没做完的事」 ("work not yet finished within this execution scope"): ① of H.3 requires the
remaining test-independent work to be finished and persisted, but the session cannot always finish it (per D2's hard constraint, it does not even know why it is handing over). Remaining work not
listed in the handover document **disappears silently** at the handover -- the new session can neither read it nor knows it exists, treats it as done,
and omits it forever. This does not conflict with ①: what can be finished must still be finished; it only catches the part that genuinely cannot.
`test-continue.md` symmetrically requires the new session to read off this unfinished list right at its start.

The first sentence of `test-wrapup.md` stays **neutral** about test timing (「你刚提交的测试脚本将由 driver 执行」 -- "the test script you just committed will be executed by the driver") -- in sequential mode
it has not run yet at that moment, in concurrent mode it is already running; one copy holds under both modes, so no dual templates. Section D's hard constraints (no
context/over-limit/limit/tokens wording, and not forbidding source edits on the session's behalf) remain in force; the reverse assertions stay locked in `test/prompt-exec.test.ts`.

### H.5 Advice for the Target-Project Side (Not Enforced)

A test script rewriting tracked files in place no longer causes blocking in sequential mode (the rewrite lands after commit #2 and becomes the next unit's increment),
but it still means "what is in the commit is not what the test verified". Formatting-type steps are better run with `--check` for evidence, leaving the apply
to the session, which persists it in the next round. No mechanical gate is added here; this is only registered in this document.

---

## I. Revision (2026-09-15): Recovery from Interruption Mid-Handover

Status: **Implemented** (`auto-core` branch). §H solved "whether the handover blocks"; this section solves "whether a run interrupted
mid-handover can keep running".

### I.1 The Field: One Interruption Destroys the Entire Handover

`/workspace/kernel-spi-nor` T-028 subtask 3 blocked and exited mid test-handover (§H's stash trap); rerunning
(`.auto/logs/run-2026-09-15_14-42-37.log`) not only failed to resume -- it blocked on the spot:

```
[14:42:57] ⏸ T-028 执行单元启动前工作区不净…请人工处置后重新运行:
  CURRENT.md / docs/R-01/PLAN.md / docs/T-028/S03/testhandoff.md
```

The last line of `git status` was ` D docs/T-028/S03/testhandoff.md` -- **the handover document had been deleted by this very run**:

1. The blocked exit recorded progress as `active:false`;
2. the next run, on that basis, judged "not a recovery continuation", and `cleanTestHandoffs` deleted the whole handover-document chain as stale leftovers;
3. that file was already tracked by the previous close commit, so the deletion dirtied the worktree;
4. the unit-start clean gate (`beginUnit`) stopped the entire run.

The result: the handover document destroyed, the pinning commit left dangling, the pending script lost, the run unable to start. Pre-rework recovery had only
one seeding rule, "if `testhandoff.md` is non-empty, patch in an archive and resume"; it looked neither at commit state nor at whether the script had run,
let alone reattaching the interrupted session.

### I.2 Decision Table

| # | Decision | Value |
|---|---|---|
| F1 | "Complete" criterion for the handover document | A trailing `状态: 继续` ("status: continue") at the end of the file (reusing `handoffStatus`, the same parsing as ondemand's handoff.md); non-empty without a status line = a truncated file. **A test handover has no `完成` ("complete") state** -- the test result is always interpreted by the next session, so there is always work after the handover; on the handoff.md side the handover steer is only a suggestion, no handover happens naturally once the work is done, and `完成` ("complete") is the real exit. The driver only consumes "whether the line is present" and never branches on the value |
| F2 | Committed content counts as complete | Tracked and matching the commit → complete by construction (the file was complete at the moment of the commit); a missing status line is backfilled by the driver, no rework |
| F3 | Worktree copy lost | git is authoritative: present in HEAD, absent from the worktree → restore; restoring clears the dirt and the gate lets it through naturally |
| F4 | Stale cleanup | Delete only leftovers **not tracked by git**; tracked = a handover in flight (deleted inside the unit by `removeHandoffChain` when the unit completes normally, landing with the unit's commit), handed to the recovery state machine |
| F5 | How the session is reattached | Fork rather than reuse: wrap-up unfinished → fork from the session state at the pinning moment; resume session already exists → fork the whole thing |
| F6 | Script idempotence | The test script is safe to execute repeatedly; on recovery, run whenever a run is due, never skip on "it may already have run" |
| F7 | PLAN.md blocking notes | `question` / `answer` / `blocked-at` retired wholesale -- cause and outcome are both on record in the logs; writing them into PLAN.md is just one more rewrite of it |

### I.3 Recovery State Machine

The decision happens at the `runExecSession` entry (shared by whole-task and subtask sessions); the observable is **the handover document × its commit state**:

| State | Observation | Action |
|---|---|---|
| H1 wrap-up unfinished | An in-flight record exists; the current copy is missing/truncated, and no archived copy exists | Fork a new session from the pinning anchor and re-dispatch `test-wrapup`; the pending script is restored from the record, then after wrap-up archive as usual → commit #2 → run the script |
| H2 written but not closed | The current copy is complete, or archived but the archived copy is not yet committed | Backfill the status line → archive → commit #2 → run the script → resume session |
| H3 closed | The archived copy is committed | If the execution result was persisted (record `ran`), reference it directly; otherwise rerun the script (F6; see §M for the exact rule) → resume session; if the resume session in the record still exists, reattach by forking from it -- when the fork succeeds and no new test ran this time, the recovery prompt collapses to a one-line continue (§M) |
| H4 legacy site with no record | No record, but the document is on the books | Same as H2/H3, with the script falling back to the latest `test.<n>.sh` under `tmp/`; if none exists, resume on the handover document alone |
| H5 no handover trace | Neither record nor document exists | Current behavior, zero change |

Every state performs the F3 restore before starting work, so "the document was deleted by the previous run" is no longer a fault, just a preliminary repair step.
Restoration has another, earlier hook: **before** `loop`'s startup clean gate -- before a run starts, a committed handover document that has been deleted
has no legitimate explanation, and without restoring it first the gate would block the entrance dead. At the same spot, the startup gate was switched to go through `beginUnit`,
so that leftovers of the driver-owned state files (PLAN.md/CURRENT.md) self-heal via carryover: a previous run exiting via a non-commit path
(e.g. the unit gate finding dirt and doing a direct `return 2`) leaves their disk writes behind, and blocking at the entrance would only keep the next run from ever starting.

### I.4 In-Flight Record `.auto/handover.json`

It records only "what cannot be inferred from files and commits"; phase determination does not depend on it (if it is lost, degrade to H4):

```ts
{ task, scope, unit, n, script?, seq?, pinSession?, pinMessage?, nextSession? }
```

The write happens at the moment **after pinning, before wrap-up** -- the pending script has just been consumed out of `tmp/test.sh` (the marker is already taken away,
a rerun can never read it again), and the session anchor has not yet been covered by the wrap-up messages. After close the record flips to the "closed" state (script and pinning anchor
voided), and the resume session is backfilled into `nextSession` by `attempt`; it is cleared as soon as the handover loop closes (the session ends naturally), and kept on a blocked exit
-- that is exactly the breakpoint the next run falls back to.

Fork anchor: the server's fork semantics are "copy the messages **before** target"
(`Session.fork` in `packages/opencode/src/session/session.ts`), so we take the message **after** the last one observed at pinning;
when that is unavailable, fork the whole thing and re-dispatch the wrap-up prompt -- at worst the wrap-up is done twice; nothing is lost.

### I.5 Retirement of the PLAN.md Blocking Notes (F7)

`block()` now only sets `status: blocked` and clears the existing three lines `question` / `answer` / `blocked-at`
(`edit` keeps unknown field lines as-is; without an explicit clear they would stay forever). The two `Task` fields, the four rendered values of `baseCtx`
(`blockedAnswered` / `blockedUnanswered` / `question` / `answer`), and the two passages of 「该任务此前被阻塞…」 ("this task was previously blocked...") copy
in the eleven prompt templates were removed together. Two reasons: the blocking cause and the handling outcome are already fully on record in the run logs and the terminal,
so duplicating them into PLAN.md is double bookkeeping; and every rewrite of PLAN.md must be landed with a commit and participates in the next execution unit's
clean gate -- one less write is one less source of friction.

## J. Revision (2026-09-16): Discard the Pinning Session at Handover Close as the Anchor for Restart Reuse

Status: **Implemented** (`auto-core` branch). §I lets a run interrupted mid-handover fall back to its breakpoint; this section fixes a class of misplacement
**after** the breakpoint -- the object of restart reuse / retry forking fell back onto the session from **before** the handover.

### J.1 The Field

After the handover close (archive + commit #2 + run the script), the resume session hit an AI session error, the retry ladder was exhausted, and the process exited.
At that point the active record in `.auto/progress.json` pointed to **the old pre-pinning session**: that record was written by the claim (`remember`) of the pinning session's last
successful turn, and the state "the session has handed over, the task is done" was never reflected into the record; a retryable error in the resume session then restored
the record to its pre-dispatch snapshot -- precisely that stale claim. So the session reuse triggered by the next run, as well as
the fork-source choice of `runSession`'s retry loop (`chain.id` restored to the pinning session, which becomes the preferred fork source on the strength of its full context),
both targeted the pre-handover session -- a session whose context was already used up (exactly the reason for the handover) and whose task was already complete.

### J.2 Decisions

- **The handover document writing `状态: 继续` ("status: continue") means the current session's task is thereby complete and it deserves to be discarded**: the success path of `attempt`
no longer claims the session for results carrying `testHandover` -- `chain.id` is cleared (if the resume session errors afterwards, the retry fork sources are down to
the resume lineage `chain.failed`), and `progress.json` flips to the "no session in flight" state: `session` is dropped (the next run has no session
to reuse), `active` is kept (the unit is still in flight -- the recovery continuation's clean exemption and the handover-document retention depend on it), `phase`
is kept (precise phase re-entry is unaffected).
- **The session awaiting restart reuse in the record and the session retries depend on stay the same origin**: after a handover, recovery reattaches only via
`.auto/handover.json`'s `nextSession` (the resume session, backfilled by attempt) or the pinning anchor (when wrap-up is unfinished),
forking back in; no path falls back onto the old pre-pinning session anymore. Task/subtask processing never depends on an active AI session at every moment anyway
(archiving, commit #2, and running the script are all session-less windows); recovery after an interruption inside these windows is carried by the §I state machine, and the record
not claiming a session is precisely the premise that makes it work.

### J.3 Revision (2026-09-17): nextSession Claiming Follows "Write on Dispatch + Restore on Failure"

**The field** (virtio T-005, repeated quota failures): after the 41.3k resume session hit a quota-class session error, every fork copy of the retry loop and
every anchor-reseeded session claimed `nextSession` right at its start, then each died at 0 tokens; when the process terminated,
`handover.json`'s `nextSession` was left on the last 0-token stub -- restart recovery (the `exec-session`'s
stage=test branch) could only fork an empty shell, and the living 41.3k session was no longer pointed to by any record.

**Decision**: claiming keeps "write at start" (there is still an anchor even when killed midway; §J.2's same-origin semantics unchanged), but when a session ends with a
**0-token retryable error**, `attempt` restores the record to its pre-claim state -- a bare error stub does not deserve to be a recovery
anchor; failures with `used > 0` keep the claim (that session is a strict superset of the old anchor). Same rule, and shipped in the same batch, as the
replacement invariant of `chain.failed` (see 「2026-09-17 修正五」 ("2026-09-17 fix five") in plans/0015-session-error-retry-plan.md).
Unit tests: two new cases in `test/session.test.ts` (0-token stub restores the anchor / failure with content keeps the claim).

## K. Revision (2026-09-16): Stale Cleanup of the Steer Handover Document handoff.md Likewise Deletes Only Untracked Copies

### K.1 The Gap (§I Only Fixed the testhandoff Family)

§I/F4 added two tightenings to `cleanTestHandoffs` (skip the whole family when an in-flight record exists; delete only copies not tracked by git),
but the stale cleanup of the steer handover document `docs/<id>/handoff.md` (the 2×cap handover of ondemand whole tasks and auto subtasks)
in the `runTask` pipeline is still an **unconditional `rm`** (the only condition being "not a recovery continuation"). Trigger chain:
the handover continuation session is blocked by a non-session error (permission ask-fail, repeated questions, steer delivery failure, twice failing to write
a valid handover document) → `runTask` flips the progress record to the summary state (`active=false`) → that handoff.md was already committed by the pre-continuation
`afterSession` commit (landed wholesale by `git add -A`) → the next run's cleanup unconditionally deletes a tracked file →
the deletion dirties the worktree → the next execution unit's `beginUnit` clean gate blocks and exits 2. A human runs `git checkout`
to restore the file and runs again, and cleanup deletes it once more -- a blocking loop; if the human breaks the deadlock by "committing the deletion", the handover document's
「还没做完的事」 ("not yet finished") list is lost with it, the continuation is left with only the phase-level resumeNote guidance, and the remaining steps may be omitted forever
(exactly the loss shape test-wrapup.md warns about). Same class as the kernel-spi-nor T-028 field incident.

### K.2 Decisions

- **Stale cleanup deletes only copies not tracked by git** (same semantics as F4): `removeIfUntracked` was promoted
  from a private function in `testrun.ts` to an export in `git.ts`, and both `runTask` sites (the auto branch and the ondemand
  branch) now route their handoff.md / old flat-name cleanup through it. A tracked handoff.md necessarily belongs to an execution unit not yet closed
  (at unit close the deletion lands with a commit and disappears from disk and HEAD simultaneously; checklist items execute in order, so an unclosed unit is necessarily
  the first unchecked item), and keeping it on disk is exactly what gets read by the re-run `runSubtask`/`executeWhole`'s
  `handoffStatus` to continue from the handover -- precisely the carrier the recovery semantics want; deleting it gains nothing.
- **No git restoration for handoff.md** (not merged into `restoreTestHandoffs`): testhandoff is named per execution
  scope, so a restoration cannot cross scopes; handoff.md is task-level and shared across subtasks -- if a worktree deletion in the "deleted at unit close
  but not yet committed" window were restored, the next subtask would misread the previous subtask's handover as its own
  continuation basis. The dirty worktree in that window keeps its current "block and hand to a human" behavior (rare and safe).
- Known trade-off: if a human manually checks off in PLAN.md the subtask a handover belongs to (the checklist-in-order invariant broken
  by hand), the handoff.md kept on disk will be misread by the next subtask; previously this scenario surfaced as a dirty-worktree block,
  both need human intervention, so the ruling stands.

### K.3 Landing Scope

`packages/auto-core`: `src/git.ts` (`removeIfUntracked` export), `src/testrun.ts`
(private copy deleted, switched to import), `src/runner.ts` (both stale cleanups switched to it),
`test/git.test.ts` (a real-repository case for `removeIfUntracked`). `bun typecheck` clean,
`bun test` all green (778 pass).

## L. Revision (2026-09-17): Anti-Forgery for the Archive Naming Family -- the Observed Sequence Number Takes the In-Flight Record as Authority

### L.1 The Field (kernel-mig/virtio T-005 S06)

After handover #1 closed normally, the resume session finished interpreting probe run 1 and, **on its own initiative**, landed its interpretation conclusions
and script corrections in `testhandoff-2.md` (the artifact index.md was, per the handover-document convention, to be kept until after probe b, so the session occupied
the archive naming family as a landing spot); it then hit a quota error, a human pressed Ctrl+C, and the mis-written file stayed in the dirty worktree. On the next run,
the recovery state machine's archive sequence number came from the disk scan `latestHandoffSeq`: the mis-written file occupied slot 2 → the observation pointed to
`testhandoff-2.md` → after the human committed the dirty worktree through the gate, it was "on disk and committed" → H3 misjudged
"handover #2 already closed" -- a handover that never happened was taken as fact, the record's count is permanently inflated by one, and
the already-run script gets one more phantom run.

### L.2 Root Cause

Two layers stacked:

1. **No exclusivity clause in the prompts**: the three test-execution protocol templates only say 「driver 有时会要求你写
   {{testHandoffFile}}」 ("the driver will sometimes ask you to write {{testHandoffFile}}"); none of them declares that the testhandoff naming family is an observable of the driver's
   handover timing that sessions must not create or number on their own; doc-layout even introduces testhandoff.md as a neutral
   storage path. Where the interpretation conclusions should land was never answered by the prompts.
2. **The state machine trusted the naming family**: recovery observation = the highest number from the disk scan; any `testhandoff-<n>.md`
   on disk became state-machine input directly, with no anti-forgery.

### L.3 Decisions

| # | Decision | Rationale |
|---|---|---|
| L-D1 | The prompts gain an exclusivity clause: write the current copy only when the driver explicitly asks; never create or number archived copies on your own; interpretation conclusions go into the execution scope's established artifact document or into the next handover | Plugs the behavioral source; the identical clause in all three templates (subtask/fix/whole) |
| L-D2 | The observed sequence number takes the in-flight record's n as authority; the disk scan is only a fallback when the record is missing (pure function `handoverSeq`) | The record is written by the driver at close and points at the archived copy that actually closed; the disk scan can be polluted by the session's pen and is not to be trusted |
| L-D3 | Archive numbering still takes the max of both sides, "disk scan and record" | D4's never-overwrite-history semantics is kept -- even mis-written files are not overwritten (the file itself is progress evidence, it just is no longer state-machine input) |
| L-D4 | No Auto-Stage trailer validation of archived-copy ownership | Over-engineering: authorizing the record already suffices; legacy sites (record missing) still need the disk-scan fallback, and trailer validation would leave them no way through |

### L.4 Landing Scope

`packages/auto-core`: `src/handover.ts` (new pure function `handoverSeq`),
`src/exec-session.ts` (observed sequence / next number separated; the close number `closedN` of the H2/H3 recovery branches
follows the real archived copy, with the in-flight record's n matching it), `templates/prompts/subtask.md`/`fix.md`/
`whole.md` (exclusivity rules added to the handoverTest clause), `test/handover.test.ts`
(three groups of cases for `handoverSeq`). `bun typecheck` clean, `bun test` all green (831 pass).

## M. Revision (2026-09-17): Persisted Execution Results + Collapsed Fork-Recovery Prompt

### M.1 Field and Problem (two follow-up observations from the same kernel-mig/virtio T-005 S06 site)

1. **An already-executed test was run again as a phantom**: after handover #1 closed, the resume session initiated run 2 again (already executed by the driver,
   its results already read away by the session); the session then hit a quota error and a human pressed Ctrl+C. The in-flight record was in the closed state
   (`script` already cleared at close), and the old H3 recovery fell back to
   `latestTestScript` for want of `script` in the record, running the already-run `test.7.sh` once more -- the `tmp/test.sh` marker is
   deleted at consumption and each execution's evidence lands in `tmp/test.<n>.out`, but "the execution completed" itself
   has no persisted record anywhere, so recovery could only conservatively rerun (F6). Yet a local script always runs to completion except on power loss
   or forced termination, so the rerun is pure waste (that probe takes about 20s-1min alone; the 124-timeout probe takes longer).
2. **Fork recovery re-sends the entire prompt**: after H3 forks the resume copy out of `nextSession`, it still dispatches the full
   `promptText + 续跑说明` (promptText + resume instructions) to that copy -- but the resume session already received
   both when it was opened in the previous run, the fork copy inherits them wholesale, and the re-send is a verbatim duplicate.

### M.2 Decisions

| # | Decision | Rationale |
|---|---|---|
| M-D1 | **Executed means done**: the pinned script's execution result (script / sequence number / exit code / output path / duration) is persisted with the in-flight record once the close-time execution settles (the `ran` field); recovery trusts the record and does not rerun, rebuilding `test.last` from `ran` for the resume prompt to cite | A local script's execution is interrupted only by power loss / double Ctrl+C and the like, and in those cases `ran` never makes it to disk and naturally falls back to the rerun branch -- persisting is lossless |
| M-D2 | The rerun window collapses to the single undecidable interval: rerun only when "the pin already consumed out a script but `ran` is not on disk" (interrupted mid-execution); legacy sites without a record keep the `latestTestScript` fallback rerun; **old-format records (neither `ran` nor `script`) are treated as executed** -- clearing the script at close already meant executed, an invariant that holds for the old code too; no rerun, no fabricated results | F6's conservatism is reserved for cases where execution cannot be proven to have happened; old-format records are thereby backward compatible, and this revision takes effect directly on existing sites |
| M-D3 | When forking the resume session succeeds, the recovery prompt collapses to a one-line continue; `renderTestContinue` (carrying the new results) is sent alone only when this recovery ran a new test; on fork failure (the session has sunk) the full `promptText + 续跑说明` (promptText + resume instructions) is kept | Same rule as recovery fidelity's "the recovery note for a reused session collapses to a single continue"; a cold-start session has no context and still needs the full prompt |
| M-D4 | The transient-error retry ladder during a run is **left untouched**: a fork retry re-sending the same prompt is deliberate "life-extension" semantics (the copy's tail is padded with an error stub, so the same prompt reappearing needs explaining), and the prompt cache makes a hit nearly free | A different scenario from cross-run recovery; not to be conflated |

### M.3 Landing Scope

`packages/auto-core`: `src/handover.ts` (the `Handover.ran` field; a structured declaration avoids
a handover → prompt reverse dependency), `src/exec-session.ts` (the H2/H3 branches skip already-persisted
executions per `ran`; `firstPrompt` collapses on fork success; a normal close persists `ran`, concurrent mode takes
`test.last`), `test/handover.test.ts` (a round-trip case for the closed state).
`bun typecheck` clean, `bun test` all green (832 pass).

## N. Revision (2026-09-17): Six Fixes from the Correctness Review

Origin: a holistic correctness/completeness/robustness review of the testhandoff mechanism (not driven by a field incident)
found six defects, fixed in "likelihood × impact" order.

### N.1 Fix Table

| # | Defect | Fix |
|---|---|---|
| N-1 | **In-process retries lose the entire in-flight handover** (heaviest): `testHandoverAsked` is watch-instance state; when the session errors mid-wrap-up and is forked onward by the runSession retry/degradation loop, the new instance mistakes "wrap-up complete" for a natural end → the handover loop is lost (the pinned script never executes, the document is never archived, the pinning commit dangles) -- cross-process interruption is recoverable from the record, in-process retry is not | On successful delivery of the watch pinning steer, set `test.resumeWrapup` (the same flag, the same semantics as H1's cross-process recovery); the retried new watch instance enters the wrap-up-verification state directly; reset by runExecSession's existing clearing line after close |
| N-2 | **Task-level handover chains are never cleaned → stale archives misjudged as H3**: `removeHandoffChain` is called only at runSubtask close; after executeWhole and fix rounds (task-level scope) complete normally, the archived copies stay on disk forever and are committed, and the F4 tightening makes stale cleanup skip tracked copies → on re-entering the same scope (task rollback rerun / next fix round), "no record + archive committed" is judged "already closed", the old script is rerun and the previous scope's stale handover is injected into the new session | executeWhole and fixRound add `removeHandoffChain` (new path + old flat names) after runExecSession returns and before the close commit, the deletion landing with the close commit -- "a completed unit always clears its chain" now holds for all three execution scopes, closing the invariant the F4 tightening depends on |
| N-3 | **Off-by-one in recovery numbering**: an unclosed record's `n` is the number already allocated to the in-flight handover, not a count of closed ones; using it directly as the `handovers` initial value makes the recovery-close archive skip one number (the pinning "#n 定版" ("#n pin") and the closing "#n+1" titles no longer match) | New pure function `closedHandovers`: when the record is unclosed (carrying script/pinSession) and `nextBase === record.n`, step the base back by one; a larger disk scan (mis-written files) is still held by diskMax and not overwritten |
| N-4 | **Strict-recovery rollback does not clear the in-flight record**: after a write-gate failure rolls back and redoes, the old record makes the recovery state machine reattach the redo to "continue the discarded handover" (re-doing wrap-up forked from the pin point, running the pinned script against the rolled-back tree) | `rollbackUnitState` calls `forgetHandover` as soon as the rollback succeeds (the in-flight record necessarily belongs to the current unit by construction) |
| N-5 | **The 0-token claim restore covers only the retryable branch** (the §J.3 gap): the two paths of non-retryable 0-token errors and prompt-dispatch failure do not restore the nextSession claim; after the process is killed inside the wait-probe loop, restart can only fork from the error stub | The restore condition is extended to both (an empty session dying at first dispatch / an error stub does not deserve to be a recovery anchor; same rule) |
| N-6 | **The H2 archived-but-uncommitted branch does not backfill the status line**: legacy sites (archiving happened before the status-line convention) would land an archive lacking the status line with commit #2 | That branch gains `fillHandoffStatus` (idempotent) |

### N.2 Registered as Not Changed (Known Trade-offs)

- **The H4 fallback can be upgraded by a mis-written current copy**: with no record plus a truncated current document, it is treated as "already handed over" and the
  status line is backfilled and committed -- §L added anti-forgery for the archive naming family, not for the current copy. The prompt exclusivity clause bears down on it, and the
  branch is meant to catch legacy progress from before the mechanism landed; unchanged.
- **Test requests re-issued during wrap-up are silently dropped**: after the pin consumes the marker, a tmp/test.sh rewritten by the session during wrap-up
  is never settled (wrap-up verification takes precedence) and is cleared at the next attempt's start. The session's expectation is dashed but nothing is lost: the resume session
  can re-initiate from the handover document.
- **Concurrent mode loses the pinned test on cross-process interruption**: the concurrent-mode record writes no script (pinning means immediate start); once the process dies
  mid-wrap-up, recovery has no execution entry point and the test is never rerun. Concurrent mode (`OPENCODE_AUTO_HANDOVER_CONCURRENT`)
  defaults to off and is itself a degraded form; registered for the record.

### N.3 Landing Scope

`packages/auto-core`:`src/watch.ts`(N-1)、`src/execute.ts` + `src/review.ts`(N-2)、
`src/handover.ts` + `src/exec-session.ts`(N-3/N-6)、`src/unit-commit.ts`(N-4)、
`src/attempt.ts` (N-5); tests `test/watch.test.ts` (N-1 pinning seeding and retry continuation, driven through a real
git repository), `test/handover.test.ts` (three groups for N-3), `test/unit-commit.test.ts` (N-4
real-repository rollback), `test/session.test.ts` (two N-5 cases, same family as the §J.3 cases). Every fix's
test cases were verified to "go red once the fix is removed". `bun typecheck` clean, `bun test` all green (840 pass).
