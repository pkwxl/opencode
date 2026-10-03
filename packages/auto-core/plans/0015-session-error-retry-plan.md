# Session error retry rework plan (handover document)

> Status: **implemented** (2026-09-09, `packages/auto-core/src/runner.ts`). The to-be-implemented changes
> 1–5 have all landed; `test/runner.test.ts` filled in the missing cases for points 1–4 (6 new cases; `bun
> typecheck && bun test` all green, 431→437 pass). Point 5 (`runTask`'s cross-process-resume
> "error stub" backstop) is implemented and runs green with the existing tests, but the end-to-end `test/resume.test.ts` scenario the plan required
> **was not added** — driving it to the resume decision at the top of `runTask` would require fully mocking the `executeWhole`/wrapup/verify
> pipeline, a cost out of proportion to the value of that "belt-and-suspenders" branch; left for
> later, on demand (if needed, start from the three variables `alive`/`usage`/`errorStub` at around line 345 of
> `runTask`).
>
> **2026-09-09 addendum: the point 5 implementation is flawed — the criterion looks only at the session's last message, and in production
> (the second incident, T-063 in the same directory) it falsely killed a session that had genuinely accumulated 109.2k of context, throwing away all the progress
> that points 1–4 had preserved in-process, right at the cross-process boundary. The criterion has been fixed and 6 cases added; see the "Post-hoc
> correction" section at the end of this document; points 1–4 themselves were verified in the field to work as designed and are unaffected.**
>
> **2026-09-12 addendum: the fork-source criterion of point 3 is changed to "preserve the most valuable session" — a retry no longer pivots on
> whether `chain.id` is empty; instead it forks from the **live session with the most accumulated context**, first choice being the just-failed
> session itself; when no session on the chain can be forked, it falls back to re-seeding from the fork base. The old criterion left the fork branch structurally
> unreachable for subtasks (a subtask has only one prompt round, so at the moment of failure `chain.id` is necessarily empty); in one
> provider-timeout incident it burned 3 hours 18 minutes with zero output. See the "2026-09-12 correction: preserve the most
> valuable session" section at the end of this document, and the provider timeout attribution analysis (provider-timeout-analysis-20260912.md §8).**
>
> **2026-09-16 addendum: manual adjudication and blocked exit are replaced by the "wait-and-probe loop" — non-retryable errors,
> ladder exhaustion, and fallback-candidate exhaustion all now wait indefinitely at a half-hour interval (OPENCODE_AUTO_RECOVERY_WAIT, default 30 minutes),
> probing each round with a brand-new temporary session; on recovery the interrupted session is forked and continues. From here on, a session
> failure no longer causes the program to exit (the only way out = pressing Ctrl+C twice in a row). askRetry/retryDecision and
> OPENCODE_AUTO_RETRY_ASK are retired. See the "2026-09-16 correction three" section at the end of this document.**
>
> **2026-09-10 addendum: point 4 ("remember no longer persists prematurely") was refined by
> [plans/0018-session-resume-precedence-design.md](plans/0018-session-resume-precedence-design.md) into
> "write on dispatch + restore the pre-dispatch snapshot on retryable failure" — point 4 moved the persist from "as soon as the sessionID is known" to
> "after the round ends", which fixed the half-failed intermediate state supplanting the real session, but also took away "the claim on the running session when it is killed mid-round"
> (in the field: a decompose session with 29.4k accumulated was killed by Ctrl+C, but the record stayed at the previous phase boundary with
> active=false, so the next run did not reuse it). After the refinement: a successful dispatch immediately writes active to claim the running session, and a retryable
> error restores progress.json to the pre-dispatch snapshot (an abandoned fork copy does not supplant the real resume point) — the pathology point 4
> was meant to guard against is still guarded against, and the claiming capability is restored. The point 5 criterion is unchanged.**
>
> This plan revises the "keep the status quo" item in `plans/0008-precise-resume-plan.md`: "transient errors during `runSession` execution
> are still retried with a new session" — that status quo has since been proven to be the root cause of a bug that actually happened, and is no longer kept.

## Incident scene (T-062 postmortem)

Incident directory: `/workspace/kernel-dm-stripe` (an auto-migrate user task).

1. `run-2026-09-09_11-30-18.log`: at `13:59:22` subtask 12 forked session
   `ses_f7988a9c5ffeAaoA8H2z4dUZW4` from the shared base, dutifully read through all 11 files S01–S11 (`13:59:22`–
   `14:00:18`), began formally writing the main artifact at `14:00:50`, and worked until `14:08:06`, when it hit
   "You've reached your 5-hour usage limit" (Kimi API 403, the payload explicitly carried
   `"isRetryable":false`)。
2. The retry loop of `runSession()` (from `src/runner.ts:1758@f50cd615b`) took any blocked result carrying the `会话错误:` (session-error) prefix and
   always executed `chain.id = undefined` before retrying — **with no distinction between errors worth retrying and not,
   and no regard for whether the current session had already accumulated real progress**. So:
   - Retry 1 opened a blank new session `ses_f7980ae04ffeWjCxLiXJCnh6aF`, which hit the limit just as instantly;
   - Retry 2 (retries exhausted, `RETRIES=3`) opened yet another blank new session `ses_f7980aca7ffeA6ygTUvKIh2zNq`,
     which also hit the limit instantly and finally blocked: 「会话错误:...(已换新会话自动重试 2 次仍失败)」 ("session error: ... auto-retried 2 times with a new session and still failed").
   - `ses_f7988a9c...`, the session that actually did the work, was never referenced again — not explicitly discarded, but sidelined
     by the "blank slate on every error" retry policy.
3. `attempt()` (around `src/runner.ts:1832@f50cd615b`–`1845`) called `remember()` after obtaining the `sessionID` but
   before `client.session.prompt()` was even sent, writing that id into
   `progress.json` marked `active:true` — regardless of whether the round ultimately succeeded. Of the three attempts, the last
   (the blank session `ses_f7980aca7ffe`) thereby became the finally persisted "recoverable session".
4. The cross-process resume decision of the next run (`run-2026-09-09_14-09-55.log`) (`runTask`, around
   `src/runner.ts:345@f50cd615b`) used only `sessionAlive()` (which merely confirms the session exists, lines `1916`–`1919`)
   to judge "reusable", without checking whether the round had any substantive output. So it confidently "reused"
   `ses_f7980aca7ffe` — the log printed "上下文不丢,已用 0/262.1k tokens,0%" ("context preserved, used 0/262.1k tokens, 0%"), but in
   `sqlite` (`~/.local/share/opencode/opencode.db`) the session's history turned out to hold only two entries:
   the original 23KB prompt + one pure error stub with all-zero tokens. Subtask 12 was forced to rediscover all
   state from scratch (re-reading CURRENT.md, git status, and re-reading S01–S11 one by one), and its context also pointlessly carried an
   already-voided 23KB prompt + one error stub + a second nearly duplicate 23KB prompt — strictly worse than not
   reusing at all (none of the work that needed redoing was spared, plus extra tokens were paid for the redundant context).
5. Waste further upstream: when `watch()` received an SSE `session.error` event (`src/runner.ts:2188@f50cd615b`
   nearby) it took only `props.error.data.message` to splice into the error string; structured fields like `isRetryable`
   were read and thrown away, taking no part in the "retry or not" decision — even though the API had explicitly said "retrying is useless".

## Confirmed decisions

| Decision point | Conclusion |
| --- | --- |
| Non-retryable errors (`isRetryable === false`) | No longer run the whole "swap in a new session and retry" loop: return `blocked` directly, `chain.id` stays untouched (a session with real content is not sacrificed) |
| Retryable transient errors | No longer open a blank new session to resend the original prompt; instead fork an independent copy and retry the same prompt on it. **The fork source was changed by the 2026-09-12 correction to "the live session with the most accumulated context"** (previously `chain.id`) |
| Fork copy retries successfully | "Promotion": `chain.id` = the copy's id, and the chain proceeds as usual; the original session need not be explicitly deleted — it sinks naturally |
| Fork copy still fails on retry | Discard the copy and re-select a source by value for one more try, until `RETRIES` is exhausted. **Before the 2026-09-12 correction this was "re-fork from the same untouched original `chain.id` session"**; after the correction, a copy that has itself accumulated more context becomes the new preferred source (the original session remains a candidate) |
| `chain.id` is empty to begin with (this round is the session's first message and has never succeeded) | ~~Keep the status quo: open a blank new session and retry directly~~ **2026-09-12 correction: if the failed session itself has accumulated usage, fork it; only a pure error stub (used=0) falls back to re-seeding from the fork base, and only when even the base is absent does it open a blank new session.** The criterion for "nothing worth protecting" changes from "whether the chain has a session" to "whether the failed session has content" |
| When `progress.json` is persisted (`remember()`) | Write that session id to `active` only when "promotion" happens (i.e. a session is confirmed to have truly completed a round, not a half-round judged as a retryable session error); no longer persist prematurely the moment the `sessionID` is known with the outcome still unknown |
| The user's originally proposed approach | Adopted (fork-retry, discard on failure, original session unaffected), plus one layer of pre-check — for errors like this incident's `isRetryable:false`, forking to retry is pointless (an account-level limit fails the same way on any session), so the entire retry stage should be skipped outright rather than forking once first and then giving up |

## Changes to implement (all in `packages/auto-core/src/runner.ts`; line numbers are positions as of this writing — when implementing, defer to the current code)

1. **`watch()`'s `session.error` handling (around lines 2186–2194)**: also extract `isRetryable` from `props.error.data`
   (a missing field or any non-`false` value is always treated as retryable — a conservative default),
   and pass it through to the caller via the `Watch` return value (a new field, e.g. `retryable?: boolean`); when multiple
   `session.error` events stack, take "a single `false` anywhere means non-retryable" (a pessimistic reading).
2. **`attempt()`'s return value**: the `result.error` branch (around line 1877, `if (result.error) return
   { type: "blocked", question: ... }`) should also carry `retryable` out, instead of a plain-string
   `blocked` (either extend `SessionResult`'s blocked variant, or add a separate field to distinguish).
3. **`runSession()`'s retry loop (around lines 1758–1774)**:
   - First check `retryable === false`: `return` the blocked result directly, executing none of the `chain.id
     = undefined` / retry logic.
   - Otherwise, if `chain.id !== undefined` (by this point before the retry it is already confirmed to be "a real session"
     rather than an empty slot): call `forkSession(client, chain.id, ...)` to get the copy's id; if that
     copy id exists, use it as the next `attempt()`'s `chain.pending` (reusing the existing fork
     pre-created channel; `attempt()` already has the consumption logic `forked = reuse ? undefined : chain.pending`,
     so it plugs in naturally), **without modifying `chain.id` itself**; only if the fork fails (`forkSession`
     returns `undefined`) does it degrade to the status quo (blank new session).
   - If the copy succeeds this round (`chain.id = sessionID` inside `attempt()` advances normally), promotion is complete —
     no extra code is needed, because once the fork copy is used by `attempt()` and succeeds, `chain.id` naturally
     becomes it.
   - If the copy fails again this round: do **not** set `chain.id` to this failed copy's id (currently
     `attempt()` has already set `chain.id = sessionID` to the failed session before returning the error — this
     line needs tightening: `chain.id` may land on the failed session only on non-`会话错误:` (session-error) blocks or the success path;
     the retryable-error path must explicitly restore `chain.id` to the original session id from before this round's retry,
     so that "the next re-fork" forks the original session rather than the just-failed copy).
4. **When `remember()` is called inside `attempt()` (around lines 1832–1845)**: move the first
   `await remember()` from "after the `sessionID` is determined" to "after confirming this round is not a retryable session
   error" (i.e. success, a non-retryable block, or a non-session-error block); a session error judged
   `retryable` no longer writes its intermediate failed state to `progress.json`. In abnormal-exit scenarios such as the process being killed mid-run,
   what survives is therefore "the last session that truly ran to completion", not a just-created, unverified session — this simultaneously
   fixes both problems, "remember jumping the gun" and "the retry chain wiping real progress".
5. **`runTask()`'s cross-process resume decision (around line 345)**: as a backstop, next to the `sessionAlive()` check
   add a "last round is not a pure error stub" check (`sessionUsage()` already computes `usage.used`;
   it was previously used only for logging) — if `usage.used` is 0 and the last assistant message is itself
   an error (rather than the normal case of "genuinely the empty session's first round", which requires checking whether any earlier real
   assistant message existed), classify it into the "original session not reusable, continue with a new session" branch. With the point 3/4
   fixes in place, such sessions should theoretically no longer appear in `progress.json`; this is a belt-and-suspenders guard against
   legacy `progress.json` records (generated before the rework) still being wrongly reused after the rework.

## Verification plan

- `packages/auto-core/test/runner.test.ts`: add a set of cases —
  1. A session error with `isRetryable:false` → assert no `session.fork` / new
     `session.create` call happens at all, blocked is returned directly, and `chain.id` is unchanged.
  2. Retryable error + `chain.id` already has history → assert `session.fork(chain.id)` was called;
     after a successful retry `chain.id` becomes the forked id; after a still-failing retry `chain.id` stays the
     **original** session id (not the failed fork id), and the second retry indeed forks the same original
     `chain.id` again (not a fork of the failed fork).
  3. `chain.id` empty to begin with (the session's first message fails) → keep the status quo; assert the blank new
     session path is taken, with no fork triggered.
  4. `remember()`/`progress.json` persist timing: construct a single-round failure that is "a session error but retryable",
     and assert that after the round ends `progress.json` still holds the pre-retry value, not overwritten by the failed
     intermediate state.
- `packages/auto-core/test/resume.test.ts`: add one end-to-end scenario — simulate "cross-process resume
  encountering a historical session with only an error stub and no real output", and assert the resume logic judges it non-reusable (point 5's
  backstop branch is triggered).
- Full run: `bun typecheck && bun test` (run inside the package directory; tests cannot be run from the repo root).
- Doc sync: after this file is done, add a decision line to `plans/0008-precise-resume-plan.md` (or directly
  strike through its "keep the status quo" item noting "superseded by plans/0015-session-error-retry-plan.md"), so that
  future readers do not assume the status quo is still "a retry swaps in a blank session".

## Known out-of-scope

- The `NETWORK_FAILURE`-regex-triggered `server.restart()` logic is unchanged (that restart targets
  process-level server failure; it and this document's session-level fork-retry are two different dimensions and can coexist).
- Fork's provider prefix-cache-friendliness (`plans/0003-fork-decompose-design.md` §4.2/4.3) is
  unaffected — this rework only changes "the new session opened on retry" from "blank" to "forked from chain.id", reusing
  exactly the same `forkSession()`/`seedForkSession()` infrastructure.

## Post-hoc correction (2026-09-09): point 5's criterion falsely kills long sessions (T-063 postmortem)

After point 5 was implemented per this document's original text, it backfired in the next incident in the **same directory**, throwing away the session
that points 1–4 had finally preserved. This section records the scene and the fix; later readers should defer to this section.

### The scene

Still `/workspace/kernel-dm-stripe`, task T-063 (batch III design).

1. `run-2026-09-09_15-58-55.log:2053` (17:55:26): subtask 8's session
   `ses_f78b6649cffe1X1U02wb383fhp` worked 6m23s and, after accumulating **109.2k/262.1k (42%)**
   of real context, hit the Kimi 5-hour limit (`isRetryable:false`). Points 1–3 took effect as designed:
   `⛔ 遇到不可重试的会话错误(重试无意义),直接阻塞` ("hit a non-retryable session error (retrying is pointless), blocking directly") — no fork, no new session,
   `chain.id` stayed on that session (persisted by `remember()` in `runner.ts` attempt's `else` branch;
   `runTask` skips `persistStage` on "session error" blocks, so the `active:true` record survived).
   In the DB the session's title was renamed to `T-063 blocked …`, i.e. `chain.id` was that session at rename time — points 1–4's
   in-process behavior is thereby confirmed.
2. `run-2026-09-09_22-26-31.log:14` (22:26:34): the next run read that record, the criterion
   `usage.used === 0 && usage.errorStub` held, and it printed
   `(原会话只挨了一记报错、无真实产出,开新会话继续)` ("the original session merely caught an error, no real output; continuing with a new session") — 109.2k of context was discarded.
3. Cost: S08 re-forked from the 12.3k digest prefix and re-read `docs/T-063/S01–S07/index.md` one by one;
   the session had to grow back to **116.0k** before closing (22:40:19). This is the same shape as T-062's "forced to rediscover all
   state from scratch, worse than not reusing at all" at the start of this document; only the trigger changed from "a retry swapping in a blank" to
   this backstop branch.

### Root cause

`sessionUsage()` at the time computed usage **from the last assistant message only**. The opencode server side behaves as follows:
before each LLM call it first writes an assistant row with all-zero `tokens` (`packages/opencode/src/session/prompt.ts`
creates the row); on a provider error, `processor.ts`'s `halt()` only writes `error` into that row, `step-finish`
never happens, and `tokens` stays all-zero (`packages/opencode/src/session/processor.ts`). So a session that
"did lots of work but hit an error on the last round" has a last row identical in shape to the **empty session**'s last row in the old incident:
`{tokens: 0/0, error: APIError}`. The last message alone cannot tell the two apart — and exactly what could tell them apart was this document's own
point-5 requirement — "this needs to be judged together with whether any earlier real assistant message existed" — but the implementation missed
that half of it.

More importantly: after the point 1–4 fixes, **"long sessions whose last row is an error stub" became the most common record shape in `progress.json`
** (the highest-frequency failure mode in this workspace is exactly this limit error), so this misjudgment is not an edge
case — it necessarily fires on the next run after every non-retryable-error block.

### The fix

`sessionUsage()` is changed to first compute `basis` = the first assistant message, walking backward from the last, that **actually ran to completion**
(`tokens.input + tokens.cache.read > 0`):

- `used`/`pct`/`limit` are all rebuilt from `basis`; `basis` does not exclude rows carrying `error` —
  errors determined only after step-finish (output over limit, content filtering, pre-compaction over limit, etc.) come with real
  tokens and are the best estimate of end-stage usage.
- `errorStub` is true only when **the whole session has no `basis`** and the last row is itself an error —
  i.e. the pure-error-stub empty sessions left behind by the old "retry swaps in a blank session"; the shape point 5 originally meant to detect is still detected.

One change resolves three problems at once: resume falsely killing long sessions, killed sessions (last row a 0-token, error-less
residual row) inheriting a fake 0 usage, and the session-mode fork base's `sessionUsed()` reading 0, which disabled the gate
"no fork once base usage reaches cap/2".

### Verification

- `test/runner.test.ts` adds 6 cases for `sessionUsage(恢复复用判据)` — the resume-reuse criterion — (last row an error stub but real output
  before it / pure-error-stub empty session / kill residual row / error row with real tokens / no assistant
  message yet / messages query failure). `bun typecheck && bun test` all green, 445→451 pass — these two
  numbers come from a working tree that also carried 2 uncommitted taskContext cases from another session (later landed in `b0eceec96`);
  this fix alone is 443→449 (reverting those two test files to this commit and running measured `Ran 449 tests`).
- Real-data replay: fed all 19 messages of `ses_f78b6649cffe…` to the old and new criteria — the old one
  gives `{used:0, errorStub:true}` (reproducing the 22:26 discard), the new one `{used:109192, pct:42,
  errorStub:false}` (matching the in-run log's 109.2k/42%).
- Full-population comparison: of `/workspace/kernel-dm-stripe`'s 539 sessions, the old criterion flagged 16 error stubs,
  of which **9 were misjudgments** (real output existed beforehand); the new criterion flagged 7, all genuinely error-stub-only
  sessions — misjudgments dropped to zero with no loss of original detection power.
- Not done: the `test/resume.test.ts` end-to-end envisioned for point 5 in this document's "Verification plan" (would require mocking
  the whole `executeWhole`/wrapup/verify pipeline to drive to the resume decision at the top of `runTask`).
  The changed criterion lands on `sessionUsage` and already has tests built directly at that single point; on the `runTask` side only the
  single composed condition `used === 0 && errorStub` remains, so the cost/benefit still does not support adding that e2e; left for when needed.

### Landed scope

Only `packages/auto-core` changed (core): `src/runner.ts` (`sessionUsage` + the resume-branch comment),
`test/runner.test.ts`, `docs/behavior.md`, `docs/structure.md`, and this file. Under the branch model,
core changes land only on the `auto-core` branch; the `migrate`/`auto` worktrees get them via `git merge auto-core`
snapshot refreshes (the incident directory runs `opencode-migrate`, which still had the old criterion until the merge).

---

## 2026-09-12 correction: preserve the most valuable session

### Incident shape

Upstream `zai-coding-plan/glm-5.3-flash` exhibited stalls of "the connection is established but no bytes come for a long time", which ran into
the 300s `headerTimeout`/`chunkTimeout` that opencode 1.18.x enforces on all providers.
One such failure costs 6 requests × 300s + backoff ≈ 31 minutes at the ai-sdk inner layer; the driver's outer layer then
reopens the session and retries 3 more times, so a single subtask blocked after 3 hours 18 minutes with zero output (the three sessions' out tokens were
2677 / 2161 / 2403, versus 15k–25k for a normal subtask of the same kind). For the complete evidence chain see the provider timeout attribution analysis
`provider-timeout-analysis-20260912.md`。

### Why the existing fork retry did not catch it

Both gates were shut exactly as designed:

1. **The criterion is `chain.id`, and a subtask's `chain.id` is necessarily empty.** A subtask session has
   **one prompt round** (the entire subtask runs a dozen to two dozen steps inside that round); at the moment of failure it has not
   yet succeeded at any round; with `REUSE_SESSION=off`, every prompt even opens a new session. So the
   `if (chain.id !== undefined)` branch is **structurally unreachable** for subtasks — it can only take effect on multi-round chains
   or phase-level side sessions (both Kimi limit incidents, T-062/T-063, were exactly that shape,
   which explains why the mechanism worked there but not here).
2. **Retries were colder than the first attempt.** The fork-seeded `chain.pending` is cleared once consumed; `chain.forkBase`
   is still there and the base session is still alive, but the retry loop never consults it. Verifiable in the DB: T-013's ctxbase base was built at
   05:49 (prefix 12.8k tokens); S03's attempt 1 inherited it, while attempts 2 and 3 had no such inheritance
   message and their first assistant row read `in=9738, cache_read=0` — a pure cold start. That is, the retry not only failed to keep the failed
   session's 170–200k of verified research, it even threw away the warm prefix that was free to begin with.

### New criterion

On retry, pick sources in **descending order of accumulated context usage**, taking the first fork that succeeds:

| Order | Source | Notes |
| --- | --- | --- |
| ① | The just-failed session itself (`chain.failed`) | Timeouts/stream cuts have nothing to do with session content (a provider-side stall); the verified output inside the session is this round's most valuable asset. A pure error stub with `used = 0` does not enter the candidates — there is nothing worth protecting there, and forking would only carry the error stub into the copy |
| ② | The chain's original session (`chain.id`) | Non-empty only on multi-round chains; identical to ① on reuse rounds, deduplicated to a single try |
| ③ | The fork base (`chain.forkBase`) | Re-seed when no session on the chain can be forked (via `seedForkSession`, same semantics as the fork-decompose design §4.3 "each item re-forks from the base"), at least recovering the warm prefix |
| ④ | Blank new session | The status-quo fallback when none of the above is available |

Three invariants: **① always fork a copy rather than reuse directly** — the original session is unaffected and abandoned on failure,
the `progress.json` restore logic is untouched and the resume point is still the original session; **② the copy inherits the source session's `used`**,
and the 2×cap handover threshold is computed as "prefix + additions"; **③ the `seedForkSession` guard "cold-start once usage
reaches cap/2" does not apply here** — that guard exists to keep a new subtask from carrying an oversized prefix, whereas a retry is a lifeline for the same prompt,
and the prefix is large precisely because much work was done.

Known cost: the copy's tail carries that 0-token error message, and the retry prompt lands after it. Compared with "rediscovering all
state from zero" (the counterexample recorded under point 4 of the factual baseline), this trade is worth it.

### Landed scope

Only `packages/auto-core` changed (core): `src/runner.ts` (the new `SessionChain.failed` slot +
`attempt()`'s retryable branch recording the failed session and clearing it on promotion + `runSession()`'s source-selection ladder),
`test/runner.test.ts` (retry-case fakes now support injecting real usage per session; 7 new cases covering
subtask shape, value ordering in both directions, prefix-usage inheritance, base re-seeding, no fork of error stubs, and `failed` clearing),
`docs/behavior.md`, `docs/structure.md`, and this file.

`bun typecheck` clean, `bun test` all green (459→466 pass). Three pre-existing cases (zero-usage fakes)
passed unchanged — when the failed session is an error stub, the new ladder degenerates byte-for-byte into the old behavior, which is precisely the evidence of backward compatibility.


## 2026-09-12 correction two: the retry ladder and manual adjudication

"Preserve the most valuable session" solved **where to retry from**, but not **how many times to retry or what to do after failure**.
The old strategy hardcoded `RETRIES = 3`, no backoff, block-and-exit on exhaustion. This section changes all three at once.

### Factual baseline (provider-timeout-analysis-20260912.md §3)

| Observation | Value |
| --- | --- |
| Actual duration of one provider timeout | 1860s (measured 1862s) |
| Of which 6 requests × `headerTimeout`/`chunkTimeout` | 1800s |
| Of which opencode inner-layer backoff 2+4+8+16+30 | 60s |
| Fatal errors across the project's 176 sessions | 6, all concentrated in the last 18 hours |
| Steps ≥250s in each fatal session before death | 2–6 |

Two conclusions directly shape the design: **exponential backoff already exists in the inner layer and accounts for only 3% of total duration** — stacking another
seconds-scale curve on the outside cannot change the fate of the next request; **upstream degradation is measured in hours** — any retry ladder will inevitably see a day
when it is exhausted, and raising the retry count just burns money linearly (every retry must replay the 100k+ prefix as cache reads).

### New criterion

| Stage | Value | Rationale |
| --- | --- | --- |
| Retry count and waits | `OPENCODE_AUTO_RETRY_WAITS`, default `0,1,2,4,8` | Each element of the list is the wait before that retry, and the element count is the retry cap. The first retry is immediate — the DB has an instance of "attempt 1 silent for 300s then aborted, attempt 2 succeeded"; afterwards minute-scale backoff, because only minute-scale waits can ride across a stretch of upstream degradation |
| Ladder exhausted | Wait for manual adjudication, `OPENCODE_AUTO_RETRY_ASK` default 30 minutes | See below |
| Human answers continue/继续 | The ladder restarts from the beginning | A human is in the loop, no round cap |
| Human answers exit/退出 | Block immediately, with copy marking it as a human decision | |
| Timeout / off-topic answer / stdin closed | Fallback = switch to the next candidate model and continue; block only when candidates are exhausted (or no candidate list configured) | An unattended batch run must neither hang nor be waved through silently; switching provider is the only lever not yet tried outside the ladder |

**Why wait for a human after exhaustion rather than exit directly.** A graceful blocked exit writes an `active=false` resume
point, and the rerun explicitly does not reuse the old session — the reason `resume.ts` gives is "manual intervention may take hours and may modify the
environment, so the old session's context is no longer trustworthy". That reason holds for a genuine blocking question but **does not hold** for a timeout: the human
changed nothing, and merely waited. So the exit route would throw away exactly the session the previous section had just worked to preserve. Staying in the process
and waiting keeps the session alive and still forkable.

**Fallback = switch to the fallback model (wired up 2026-09-13, `auto-core` branch only).** This was always meant to be the fallback action;
it is just that phased model routing and quota fallback (`chain.model` / `switches.model.fallback` /
`classifySessionError`) landed only on the `auto-core` branch — on the common base where this correction sits, that whole mechanism does not exist,
so on the common base and on `migrate`, fallback = block. On `auto-core` the seam is connected: when `decision === "fallback"`
and the candidate list is non-empty, it runs the same logic as the quota-fallback branch (`switchModel()`) to switch to the next candidate and restart a ladder round,
blocking only when the candidates run out (with the copy appending 「降级已用尽候选: …」 ("fallback has exhausted the candidates: ...")). When the human explicitly answers `exit`, no fallback — that is
a "stop" command, not "find another way". See `plans/0017-model-routing-design.md` D.3.

Scoping naturally satisfies "the fallback switch applies only within the current task" — `chain` is created anew by `runTask` for each task and
shared by all execution sessions within the task (`runner.ts`'s "All execution sessions of a task share one chain"),
so `chain.model` resets per task and the next task starts again from the preferred model, with no extra revert logic needed. Known
deviation: the subtasks of one task share this chain, so a fallback switched during subtask 3 stays in use through the task's last
subtask; resetting per subtask would be a separate change, not done.

### Landed scope

`packages/auto-core`: `src/switches.ts` (parsing, validation, startup logging, and the full description of the two new variables),
`src/runner.ts` (the ladder counter switched to manual advancement, backoff sleeps, `askRetry`/`retryDecision` three-way adjudication,
`requireArtifact` passing `switches` through), `test/switches.test.ts`, `test/runner.test.ts`
(8 new cases in total: ladder counts, real backoff, human three-way, `waits=off`, and wordlist normalization; existing retry cases switched
to the zero-wait fixture `0,0`, with counts matching the pre-rework `RETRIES=3` and assertions reused byte-for-byte), `docs/behavior.md`,
`docs/structure.md`, and this file.

`bun typecheck` clean, `bun test` all green (466→475 pass).

## 2026-09-16 correction three: the wait-and-probe loop replaces manual adjudication and blocked exit (session failures no longer exit the program)

### Motivation

Three field needs roll up into one policy shift:

1. **Quota-type non-retryable errors** (`isRetryable:false`, e.g. `insufficient_quota`) previously ended at
   a direct block (exit code 2 awaiting a human) — but quota recovery is measured in hours/days, and with no human present the whole migration run stalls;
   moreover, the upstream "avoid immediate retry" mechanism for such errors proved undependable in the field (the server side backs off indefinitely on retryable quota
   errors, leaving the driver to wait on the idle watchdog).
2. After the transient-error retry ladder was exhausted, it went to manual adjudication (`askRetry`), likewise hanging an unattended batch run on a human
   reply.
3. Prime directive: **guarantee that a session failure never exits the program** — under any quota limit, the program should wait until the quota
   recovers, then continue.

### Mechanism (the `awaitRecovery` wait-and-probe loop in `src/session.ts`)

The three failure paths all converge into the same wait-and-probe loop inside `runSession`:

| Trigger path | Entry condition |
| --- | --- |
| Non-retryable error | `result.retryable === false` (quota's `isRetryable:false`, auth 401/403, etc.) |
| Ladder exhausted | A transient error has walked the whole `OPENCODE_AUTO_RETRY_WAITS` ladder with no candidate left to switch to (candidate list empty or exhausted) |
| Fallback candidates exhausted | quota/auth/rate-type errors where `switchModel` has tried all candidates (preferred + OPENCODE_AUTO_MODEL_FALLBACK) |

Loop behavior:

- **Wait indefinitely** at the `OPENCODE_AUTO_RECOVERY_WAIT` interval (default 30 minutes); during the wait, pressing Ctrl+C twice in
  a row force-exits (130) via runAll's process-level SIGINT handler — that is the only way out.
- Each probe round uses a **brand-new temporary clean session** (dispatching a tiny probe prompt `RECOVERY_PROBE_PROMPT` via `attempt`):
  never probe with the interrupted session — pushing probe rounds into the real session pollutes its context, while a forked probe would burn the full
  prefix once per wait round (during quota restriction that only compounds the damage). The probe chain copies the real chain's `model`/`role`
  (what is being probed is exactly the model that will continue after recovery — quota is metered per model/account), but it carries no `phase`, writes no
  progress record, and does not touch the real chain's resume point.
- A successful probe (the session ends normally) means the service has recovered: **fork the interrupted session** (with the same "preserve the most
  valuable session" criterion as the retry loop: failed session itself > chain's original session, 0-usage pure error stubs not candidates) and resend the original prompt,
  attaching a one-time recovery note (`chain.note`, explaining why the same prompt appears again), with the ladder counter starting a fresh round
  (freshly-recovered jitter does not immediately fall back into the wait loop); if the fork fails or there is nothing forkable, resend on a blank new session.
- A probe session that itself misbehaves (SDK throw, create/dispatch failure) likewise counts as not recovered; keep waiting.

### Retired and extended in the same batch

- **Manual adjudication fully retired**: the `askRetry`/`retryDecision` and `OPENCODE_AUTO_RETRY_ASK`
  switch is deleted (the `OPENCODE_AUTO_RETRY_ASK` environment variable is ignored from now on). After ladder exhaustion the sequence is fixed as
  "switch candidate → wait-and-probe", with no human involvement.
- **Failure surface extended**: `runSession` folds blocked results with the `创建会话失败:` (session creation failed) / `下发任务失败:` (task dispatch failed) prefixes, together with exceptions thrown by `attempt`
  (SDK layer: subscription dropped, request timeout, etc.), into the failure surface entering the recovery mechanism;
  what still returns blocked directly is only in-session blocking questions and permission denials — those need a human reply and are not failures.
  Hence the "session-error retries exhausted → blocked" exit path no longer exists.
- **Wait-time accounting**: waits are deducted from session and AI time via `statsWaitBegin/End` and recorded separately as `waitMs`
  (same treatment as askHuman; the probe session's own time is still counted as usual).
- The new switch `OPENCODE_AUTO_RECOVERY_WAIT` (non-negative minutes, default 30) enters the switches registry,
  and `OPENCODE_AUTO_RETRY_WAITS=off` now means "enter the wait-and-probe loop on the first failure".

### Relation to the model-routing design

The invariant of `plans/0017-model-routing-design.md`, "quota blocks directly when there is no candidate list (byte-for-byte equivalent to the status quo)", and
D.4 "candidate exhaustion falls back to the blocked path (exit code 2)" are **superseded** as of this correction: candidate switching (immediately swapping provider
to continue) remains the first choice, but its exhaustion state changes from blocking to waiting for recovery; the switching/fork/window-clamping/note mechanisms all
stay as before. The fallback stickiness semantics are unchanged (a recovery resume keeps the `chain.model` of that moment; task boundaries retry the preferred model as usual).

### Landed scope

`packages/auto-core`: `src/session.ts` (the `awaitRecovery` closure, wiring of the three failure paths, the failure-surface
extension, deletion of `askRetry`/`retryDecision`), `src/switches.ts` (`retryAsk` retired,
`recoveryWait` added), `test/session.test.ts` (new wait-and-probe-loop cases, manual-adjudication cases removed),
`test/watch.test.ts` and `test/session-api.test.ts` (error-signal/stats/SSE/ensureForkBase
changed to drive `attempt` directly or rewritten per the new semantics), `test/artifact.test.ts`, `test/switches.test.ts`,
`docs/behavior.md`, `docs/structure.md`, and this file.

`bun typecheck` clean, `bun test` all green (772 pass).

## 2026-09-16 correction four: retry resends must carry a one-time note (prevent the new session from redoing half-finished work)

### Motivation

"Preserve the most valuable session" is the preferred path, but the three resend paths that **fall back to a blank new session / a session with incomplete context**
(the transient ladder's blank fallback, `awaitRecovery`'s blank fallback when all forks fail after recovery, `switchModel`'s
blank fallback when the demotion fork fails, plus the case where the fork source is not the failed session itself but the chain's original session / the base)
previously **resent the very same prompt unchanged**, with no explanation. At that moment the partial output this attempt had already landed is not in the new
session's context (on an SSE cut, the orphan round's edits remain in the workspace; on a first-round stream cut the failed session's usage is
0, not even entering the fork candidates), while the task prompt templates (subtask/whole) have no "check the workspace" instruction —
so the new session redoes the half-finished work from scratch: append-style artifacts (document sections, numbered entries) get duplicated and completed steps get re-
executed. The cross-run resume `resumeNote` has always had 「以 git status / git diff 核对现场……不要
重做已完成的工作」 ("check the scene with git status / git diff ... do not redo completed work"); the in-run retry paths are the bare exposed surface of the same risk. Besides, `switchModel`'s demotion
note, when its fork fails and it falls back to a blank session, still says 「请沿用前文的产物格式与协议」 ("please keep following the artifact format and protocol of the preceding text") — misleading for a session with no preceding
text.

### New criterion

When resending the same prompt, attach a one-time note in either of two tiers, keyed on "whether the session taking over carries this attempt's context"
(`chain.note` mechanism, cleared once used):

- **Context complete** (fork source = a session that has received this prompt; retryable cases are recorded in `chain.failed`,
  non-retryable cases were already promoted into `chain.id` by attempt, identified uniformly by `failedID = chain.failed?.id ?? chain.id`):
  explain only that "the resend is not a repeated demand; please continue completing this task's requirements" — the same motive as the recovery
  note of awaitRecovery in correction three (the copy's tail carries the error message; if the same prompt reappears with no explanation,
  it will be taken as a repeated demand). Previously only awaitRecovery's seeded branch had this note; the fork path of the ordinary ladder
  retry did not — this correction fills the gap.
- **Context incomplete** (blank new session / base re-seeding / forking the chain's original session): beyond the explanation above, append a
  workspace-check paragraph (`WORKSPACE_CHECK`, worded in the same register as resumeNote): 「工作区可能已包含本
  提示词对应的部分产出：先以 git status / git diff 核对现场，在此基础上续做剩余
  工作，不要重做已完成的部分。」 ("the workspace may already contain part of the output for this prompt: first check the scene with git status / git diff, then continue the remaining work on that basis; do not redo the parts already done.")

Accompanying wiring: the ladder retry's seeded branch attaches the note but **does not clear `chain.id`** (the original session remains the re-fork
source for the next retry — the "discard the copy, re-fork from the same original session" semantics are unchanged). For that, `attempt`'s
`resumed` criterion gains `chain.pending === undefined` — when note and pending coexist, the pending copy is consumed first,
so the original session is never reused by mistake (the "must clear id" anti-collision logic of switchModel/awaitRecovery
is kept — belt and suspenders).

### Landed scope

`packages/auto-core`: `src/session.ts` (`WORKSPACE_CHECK`/`retryNote`, note wiring for the three fallback
branches and the three seeded branches), `src/attempt.ts` (`resumed` criterion gaining pending priority),
`test/session.test.ts` (6 new cases: the retry note plus pending priority when the failed session itself is forked,
the workspace-check note when a pure error stub forks the original session, the workspace-check note for the blank fallback, the workspace-check
version of the demotion note when its fork fails, and the workspace-check note when a recovery-period fork fails). `bun typecheck` clean, `bun test`
all green (778 pass).

## 2026-09-17 correction five: a 0-token error stub must not supplant a failed-session record with content (chain.failed replacement invariant)

**Scene** (virtio T-005 / spi-nor T-029, consecutive quota failures): the continuation session after handover ran to 41.3k and hit
a quota-type session error; retry 1 forked a copy from that failed session (41.3k of context carried over), and the copy died on dispatch
(0 tokens); the old bookkeeping cleared `chain.failed` when seeding the fork, and the copy's failure then overwrote it with
`{副本, used: 0}` (the copy, used: 0) — the 41.3k session was still alive on the server with intact content, but no field on the chain
pointed to it any more. From retry 2 on, the source-selection list was empty (the 0-token stub does not enter candidates under the existing criteria, and `chain.id` had been cleared at test-handover
wrap-up per §J), degrading into the "re-seed from the base" cold start, and every round likewise.

**Invariant**: `chain.failed` is supplanted only by a failure with `used > 0` (a fork copy carrying the old prefix that produced new
content is a strict superset of the old record); a 0-token pure error stub neither supplants nor enters candidates (existing criteria unchanged).
Two accompanying changes for this:

- `attempt()` retryable branch: only when `result.used > 0` or the chain has no record yet do we write
  `chain.failed`；
- The three source-selection points (retry ladder / `switchModel` demotion / `awaitRecovery` recovery resend) after fork seeding
  **no longer clear** `chain.failed` — the record lives until the copy closes successfully (cleared on `attempt` promotion) or the copy
  produces content (normal supplanting); dead records whose fork has gone stale are swept in passing inside the source-selection loop, so later rounds do not
  repeatedly fork a dead session.

The behavior change is confined to the "consecutive failures, each failing at 0 tokens" scenario: before, every round lost the best fork source; now, every round re-forks
that most valuable session; every other path (single failure, copy produces content, successful close) is byte-for-byte equivalent.

**Verification**: `test/session.test.ts` adds two cases — recovery after a three-streak of quota failures (all three retries re-fork
the original 41.3k session, no blank new session is opened, and the resend note stays in the "context complete" tier) and normal supplanting
once the copy produces content; the existing 46 cases pass unchanged. `bun typecheck` clean, `bun test` all green.

Companion piece: the other half of the same scene — the `nextSession` claim in `handover.json` was likewise overwritten one by one by 0-token
stubs — a "claim restoration" is added to `attempt` under the same invariant; see
plans/0023-test-handover-early-design.md §J.3。
