# 0057 — Session exceptions: the agent's retry policy, quota windows and scheduled waits (design)

Status: **design, ruled; S1–S6 and S4a implemented, S0's evidence gaps open** (2026-09-26;
revised the same day with the field evidence of §1.1, all ten points of §11 ruled as
recommended, and S1 and S2 done as §13 records; S3 and S4 done 2026-09-27; S4a added and done
the same day with the opencode field evidence of §1.2; S5 and S6 done the same day). Source:
the user's request of the same day — the session exception flow has deficiencies; the driver
should recognize what a coding agent reports across agents and models, formulate better
wait-and-retry strategies for the rolling five-hour and weekly quota limits, know when an agent
cures a limit by itself so the driver only has to wait, and consider the providers' public
interfaces as a decision source — plus the follow-up: **the driver should know the retry
policy a coding agent applied**. §11 records the rulings. Line numbers are as of auto-core
`67cde2d55`; search by symbol if they drift.

F7 and F16 first rested on community reports about `claude` headless. Field evidence has since
replaced them (§1.1): the run `.auto/logs/run-2026-09-25_11-20-51.log` hit the five-hour limit
twice on the claude adapter, both sessions' transcripts are on disk, and a headless smoke call was
made on 2026-09-26. The evidence confirms F16, corrects F7's mechanism while confirming its
outcome, and adds F19–F23. §13 S0 lists what is still to be captured.

## 0. The problem in one paragraph

The driver's error handling answers one question well — *does switching model help* — and
guesses at two others it needs just as much: *will this agent cure the failure by itself*, and
*if not, until when must we wait*. The first guess is two global constants shaped like one
agent and wrong for the other (§1 F2, F3). The second is a fixed 30-minute poll that ignores a
reset time it already knows (§1 F10). Meanwhile the structured signals that would answer both
are dropped at the adapter boundary (§1 F5, F6, F7, F20), so the only route to a reset time today
is an LLM reading redacted prose (§1 F11). And when the wait ends, the rejected turn's zero usage has
already thrown away the session the recovery was meant to continue (§1 F21).

## 1. Fact baseline

- **F1 — one taxonomy, six classes.** `ErrorClass = quota | auth | rate | overflow | transient |
  unknown` (`src/chain.ts:284`), decided by `classifySessionError` (`src/chain.ts:337-345`) over
  the merged `message + responseBody` plus `statusCode` and `isRetryable`, with each adapter's
  own wording OR-ed in (`src/agent/types.ts:72-78`). The question it answers is explicitly
  "is switching to a candidate model useful", not "is retrying useful" (`src/chain.ts:280-284`;
  `plans/0017-model-routing-design.md:148-159`).
- **F2 — the rate threshold is two hardcoded constants.** `RATE_ATTEMPTS = 3`,
  `RATE_WAIT_MS = 60_000` (`src/chain.ts:321-322`); `rateThresholdMet` (`src/chain.ts:365-367`)
  is what separates "the agent is still backing off" from "backoff is futile". The documented
  intent is that a lone 429 must **not** switch models (`src/chain.ts:318-320`;
  `plans/0055-model-registry-and-tier-routing-design.md:42` F17).
- **F3 — defect: `retry.next` means two different things to the two adapters.** The interface
  documents it as "the wait in ms before the next attempt" (`src/agent/types.ts:150`) and the
  tests pin that reading (`test/chain.test.ts:125,131` use 40 minutes and 30 seconds). The
  claude adapter sends a real duration, `retry_delay_ms` (`src/agent/claude/stream.ts:139`).
  opencode sends an **absolute epoch timestamp**: `next: now + wait`
  (`packages/opencode/src/session/retry.ts:186-192`, published at
  `packages/opencode/src/session/processor.ts:661-671`), and auto-core forwards it verbatim
  (`src/agent/opencode/events.ts:52-62`) into the classified record (`src/watch.ts:898`). So on
  the opencode adapter `next > 60_000` holds for **every** retry event that carries a `next`,
  the first 429 classes as `rate`, and the driver aborts a turn and escalates (key rotation,
  then a model down mark) on a transient error opencode would have cured in two seconds. This is
  the opposite of F2's intent and it is live today.
- **F4 — opencode's own retry policy: no attempt cap, provider-stated waits honoured.**
  `SessionRetry.policy` (`packages/opencode/src/session/retry.ts:175-197`) is a
  `Schedule.fromStepWithMetadata` that stops only when `retryable()` returns nothing — there is
  no maximum attempt count. The delay is `retry-after-ms`, else `retry-after` (seconds or
  HTTP-date), else `2000 · 2^(attempt-1)`; the 30 s cap (`RETRY_MAX_DELAY_NO_HEADERS`,
  `packages/opencode/src/session/retry.ts:26-29`) applies **only** on the no-headers branch, so
  a provider-stated wait is honoured up to `RETRY_MAX_DELAY = 2^31-1` ms ≈ 24.8 days
  (`packages/opencode/src/session/retry.ts:43-75`).
- **F5 — opencode publishes a machine-readable limit reason; the driver drops it.** `retryable()`
  returns `action: { reason: "free_tier_limit" | "account_rate_limit", provider, title, message,
  label, link }` for the two usage-limit bodies it recognizes, and derives a human "It will reset
  in …" string from `retry-after` (`packages/opencode/src/session/retry.ts:11-24, 91-137`);
  `processor.ts:664-670` puts `action` on the retry status. `src/agent/opencode/events.ts:52-62`
  keeps only `attempt`, `message` and `next`.
- **F6 — `responseHeaders` reach the driver's adapter and are dropped there.** opencode's
  `APIError` carries `statusCode`, `isRetryable`, `responseHeaders`, `responseBody`, `metadata`
  (`packages/schema/src/v1/session.ts:48-55`), and the retry part carries the whole `APIError`
  (`packages/schema/src/v1/session.ts:220-228`). `mapError` keeps four of the five fields and
  drops `responseHeaders` (`src/agent/opencode/events.ts:148-157`) — the field opencode itself
  reads `retry-after` / `retry-after-ms` from, and the field that would carry a provider's
  rate-limit reset header (F13). `plans/0017-model-routing-design.md:71-73` noted the headers
  were dropped and never adopted them.
- **F7 — a spent claude window classes as `unknown` and burns the ladder; its limit lines are
  dropped (confirmed in the field, §1.1).** The mapping table drops every line except
  `assistant`, `user`, `result` and the `system` subtypes `api_retry`, `compact_boundary` and
  `permission_denied`. "rate limits" is named as dropped
  (`src/agent/claude/stream.ts:9-22, 126-145`), and the top-level `rate_limit_event` line falls
  into `default` (`src/agent/claude/stream.ts:180`). The terminal error takes
  `name = errorName ?? String(line.subtype ?? "error")` and never reads `terminal_reason`
  (`src/agent/claude/stream.ts:165-176`). Community reports (`anthropics/claude-code` #79500,
  #87692) suggested that name could be `"success"`. That does not hold when the assistant line
  carries `error`, and on 2026-09-25 it did. The transcript's synthetic assistant entry carries
  `error: "rate_limit"`, and the 2.1.283 SDK schema gives the stream's assistant line the same
  field, so `errorName` (`src/agent/claude/stream.ts:92`) reads `rate_limit`. The outcome is as
  predicted, though. `CLAUDE_ERROR_PATTERNS.rate = /rate_limit/i` gives a rate *signal*, but
  nothing carries `attempt`/`next`, so `rateThresholdMet` is false. The wording ("You've hit
  your session limit · resets 12:30pm (UTC)") matches neither `QUOTA_RE` nor `TRANSIENT_RE`
  (`src/chain.ts:308, 316`), so the turn classes as **`unknown`**. That leads to five ladder
  retries against a spent window (`OPENCODE_AUTO_RETRY_WAITS` default `0,1,2,4,8` minutes,
  `src/switches.ts:222-227`), then failover, then the probe loop. The run did exactly this,
  twice. `plans/0022-session-recovery-fidelity-design.md:141-158` already registered the
  structural complaint ("a quota error makes new-session retry structurally invalid; the retry
  ring should go straight to the degradation ring"). Also, the assistant `error` code alone
  cannot separate a spent window from a throttle. In 2.1.283 it is one of 13 values
  (`authentication_failed`, `oauth_org_not_allowed`, `account_on_hold`,
  `verification_required`, `billing_error`, `rate_limit`, `overloaded`, `invalid_request`,
  `model_not_found`, `server_error`, `unknown`, `max_output_tokens`,
  `cloud_credential_error`), and `rate_limit` covers both cases. Only F20's
  `status: "rejected"` with a `rateLimitType` tells them apart.
- **F8 — claude's error record is thin by construction.** It carries `message`, a `statusCode`
  from `error_status` / `api_error_status`, and a `name`; never `isRetryable`, never
  `responseBody`, never headers (`src/agent/claude/stream.ts:131-143, 165-176`;
  `src/agent/claude/client.ts:277-280` for the `ProcessExit` case). Its `retry` events do carry
  `attempt` and `retry_delay_ms`.
- **F9 — claude has no key rotation and no bare prompt.** `AgentHost.setConfig` is opencode-only
  (`src/agent/types.ts:317-325`; `src/keyring.ts:148-156`), and the classifier refuses
  non-opencode entries (`src/classify.ts:263-274`; `src/agent/claude/client.ts:293`). On a claude
  host the escalation's first rung is a no-op, so a limit goes straight to model failover.
- **F10 — the wait is polled, not scheduled.** Every fault path ends in `awaitRecovery`
  (`src/session.ts:632-751`), which logs, sleeps `switches.recoveryWait * 60_000` (default 30
  minutes, `src/switches.ts:228-235`), probes with a fresh throwaway session, and loops — with no
  cap and no exit but two Ctrl+C. The sleep does not read the reset time the same function
  already writes into the down marks (`src/session.ts:693-695`).
- **F11 — a reset time already flows end to end, but only from the classifier.** `watch` returns
  `resetAt` / `pendingReset` / `classified` (`src/watch.ts:160-180`), the escalation passes them
  to `rotateProviderKey` and `switchModel` (`src/session.ts:803-818`), and the down marks accept
  an `until` instant that replaces the scope boundary — the marks in
  `src/failback.ts:77-113` for models and `src/failback.ts:133-182` for keys. `acceptedReset` requires a future instant within
  `RESET_HORIZON_MS = 7 days` (`src/classify.ts:51, 184-187`). The classifier is advisory: it
  raises a class, never lowers one, and never judges completion
  (`plans/0055-model-registry-and-tier-routing-design.md:532`).
- **F12 — nothing about a quota survives the run.** Down marks and ring positions are in memory
  only (`src/failback.ts:77-90`; `src/keyring.ts:8-18`), by design: "a new run starts with every
  model eligible" (`plans/0055-model-registry-and-tier-routing-design.md:319`). A reset time
  learned at 02:00 is forgotten at the next restart and must be re-learned from a fresh failure.
- **F13 — Anthropic states its limits in headers.** The documented Messages API set is
  `anthropic-ratelimit-{requests,input-tokens,output-tokens}-{limit,remaining,reset}`, with
  `-reset` an RFC3339 wall-clock timestamp, returned on successful responses and on 429s. The
  subscription path Claude Code authenticates with additionally sends an
  `anthropic-ratelimit-unified-*` family — `-status`, `-reset`, `-5h-reset`, `-7d-reset`,
  `-5h-utilization`, `-7d-utilization`, `-slow-retry-after`, `-overage-*` — found by reading the
  official CLI binary, **not** published in the API reference. Both sets would arrive inside
  F6's `responseHeaders` on the opencode adapter.
- **F14 — Anthropic's only readable window state is an undocumented endpoint.**
  `GET https://api.anthropic.com/api/oauth/usage` with `anthropic-beta: oauth-2025-04-20` and the
  OAuth token from the profile's credentials file returns `five_hour` and `seven_day` windows
  with utilization and `resets_at`. It is what Claude Code's own usage display and the community
  monitors read. The documented Admin endpoint
  `GET /v1/organizations/rate_limits?beta=true` returns *configured* limits, not remaining quota
  or reset times, and needs an Admin key. On the claude adapter the endpoint is not needed: the
  agent's own stream carries the same two windows (F20).
- **F15 — the other providers differ sharply.** OpenRouter: `X-RateLimit-*` on its own 429s only,
  `Retry-After`, a machine-readable `error.metadata.limit_source` on 402, and free
  `GET /api/v1/key` (`limit_remaining`, `limit_reset`) / `GET /api/v1/credits`. OpenAI and Azure
  OpenAI: `x-ratelimit-reset-{requests,tokens}` as **elapsed durations**, plus `retry-after-ms`.
  Gemini: 429 `RESOURCE_EXHAUSTED` with `retryDelay` in the body, no headers. DeepSeek:
  concurrency limits, no headers, free `GET /user/balance`. Moonshot/Kimi: free
  `GET /v1/users/me/balance`, no reset time. Zhipu/GLM: error codes 1302/1305, no headers, no
  balance endpoint. So a reset time is available from headers for Anthropic and OpenAI-family,
  from a free endpoint for OpenRouter, and from nothing but wording for Gemini, Zhipu and Kimi.
  Zhipu's wording turned out to state the reset instant outright (F24).
- **F16 — "just wait, the agent recovers" is not available on the adapter the driver runs
  (confirmed in the field, F19).** Interactive Claude Code waits out a limit and resumes, with a
  documented five-hour rolling window and a weekly window that resets at a fixed
  account-assigned time. Headless `-p` ends the turn instead. The agent that *does* wait silently is opencode
  (F4): it can sit inside one turn honouring a multi-hour `retry-after`, emitting only
  `session.status` retry events and no `session.error` — which is exactly
  `plans/0017-model-routing-design.md:66-70` open question **U3**, where the only thing that
  notices today is the liveness watchdog (`src/watch.ts:36-41`, `PROBE_INTERVAL_MS = 10 min`,
  two consecutive failures = half-open).
- **F17 — a retry-policy record has a home already.** Adapter capabilities are static records the
  run intersects across its fleet (`src/capability.ts:91-158`; `src/agent/types.ts:167-191`), and
  `errorPatterns` is the precedent for a per-adapter classification fact
  (`src/agent/types.ts:225-229`).
- **F18 — hibernate and the registry windows already provide scheduled sleeping with jitter.**
  `HIBERNATE_JITTER_MS = 600_000` (`src/hibernate.ts:20`) is added so drivers sharing an account
  do not all dispatch at the same instant, and a window wait sleeps to the opening inside the
  unit (`src/session.ts:576-588`), as §4.4 of
  `plans/0055-model-registry-and-tier-routing-design.md:207-211` settles. A quota reset is the
  same shape as a window opening; nothing connects them today.
- **F19 — claude does not retry a spent window; the turn ends at once with a synthetic
  message.** Neither interrupted session spent time on retries: their transcripts' `cost-state`
  shows `totalAPIDuration` within 163 ms and 138 ms of `totalAPIDurationWithoutRetries`, and 0
  for the stubs. In both, the limit struck mid-turn on the API call after a `tool_result`, and
  the last entry is an assistant message with `model: "<synthetic>"`, `stop_reason:
  "stop_sequence"`, all-zero `usage`, the text "You've hit your session limit · resets 12:30pm
  (UTC)" (5:30pm in the second), `error: "rate_limit"`, `isApiErrorMessage: true` and
  `apiErrorStatus: 429`. It ended turns of 12 and 15 minutes. Each fresh
  session dispatched before the reset failed the same way within about 2.5 s at 0 tokens and
  $0. So a rejected window costs nothing to hit again, but also cures nothing. The transcript
  entry also holds the window record `quotaLimits: {status: "rejected", resetsAt: 1790339400,
  rateLimitType: "five_hour", overageStatus: "rejected", overageDisabledReason:
  "out_of_credits", unifiedRateLimitFallbackAvailable: false, ...}`, where `resetsAt` is
  12:30:00Z in epoch seconds. The transcript is internal (`history: false`,
  `src/agent/claude/client.ts:38-41`); F20 is the supported surface for the same record.
- **F20 — claude's stream states both windows, before the limit and at it.** The stdout line
  `{type: "rate_limit_event", rate_limit_info, uuid, session_id}` is listed in
  `plans/0041-claude-headless-adapter-design.md:36` (C1) and dropped by the adapter (F7). The
  2.1.283 binary's SDK schema describes it as "emitted when rate limit info changes".
  `rate_limit_info` holds:
  - `status`: `allowed | allowed_warning | rejected`;
  - `resetsAt`: epoch seconds;
  - `rateLimitType`: `five_hour | seven_day | seven_day_opus | seven_day_sonnet |
    seven_day_overage_included | overage`;
  - `utilization`, and the overage fields;
  - `unifiedWindows`: `{five_hour, seven_day, seven_day_overage_included}`, each
    `{utilization, resetsAt}`. The schema calls these fields "read from the
    anthropic-ratelimit-unified-* response headers", "tracked on every observation", and
    "always absent for API-key, Bedrock, and Vertex sessions".

  A headless smoke call on 2026-09-26 at 22:33Z (`claude -p … --output-format stream-json
  --verbose --model haiku`, 2.1.283) emitted one such line before `result`:
  `{"status":"allowed","resetsAt":1790479200,"rateLimitType":"five_hour",
  "overageStatus":"rejected","overageDisabledReason":"out_of_credits","isUsingOverage":false,
  "unifiedWindows":{"five_hour":{"utilization":0.04,"resetsAt":1790479200},
  "seven_day":{"utilization":0.4,"resetsAt":1790805600}}}`. That is the five-hour window
  resetting at 03:20Z and the weekly window at 40 %, resetting on 2026-09-30 at 22:00Z. So on
  a subscription profile, every healthy turn tells the driver both windows' reset times and
  utilization, with no credential in-process (C4) and no endpoint (F14). The field run also
  shows why this matters: the five-hour window starts at the first request after a reset. The
  probe at 12:30:14 opened a window that reset at 17:30, so the next reset is knowable only
  from the stream, not from the previous one.
- **F21 — defect: the rejected turn erases the session's context figure, so the most valuable
  fork source is thrown away.** `contextUsed` returns 0, not undefined, for F19's all-zero usage
  (`src/agent/claude/stream.ts:189-191`). `usageSource.observe` settles on any completed
  message's figure (`src/usage.ts:73`), so the session's `used` becomes 0 and the log reads
  "context 100% (0 tokens)". `attempt` then records the failed session as a 0-token error stub
  (`src/attempt.ts:694`), and both the ladder and the recovery path drop it from the fork
  sources (`chain.failed.used > 0`, `src/session.ts:700, 911`). Both interrupted sessions were
  lost this way: `fad5b2c5` (206.2k tokens, 12m6s, $4.76) and `3e6cfc0d` (239.5k tokens,
  14m42s, $5.49). Every retry and both recoveries started blank with "the earlier session's
  context could not be inherited". opencode has a guard for exactly this shape (take the last
  *non-zero* assistant figure, `src/session-api.ts:203-213`), but it reads history, which the
  claude adapter lacks. The same synthetic message also names the model: each stub logged "◈
  using model claude/`<synthetic>`" and made it the chain's shown model. Per-model stats were
  spared: they book the registry's selected entry (`src/attempt.ts:207`), never the reported
  model.
- **F22 — the fixed poll and the ladder are pure delay against a stated reset.** On both
  events the reset instant was in the wording and in `resetsAt` from the first second (§1.1).
  The ladder spent 15 minutes and five 0-token sessions per event. The 30-minute poll resumed
  14 s after the first reset, but only because 15 + 30 minutes happened to land there. After
  the second it resumed 24m54s late, having probed five times, the last one 5 minutes before
  the reset.
- **F23 — `/exit` does not reach into the wait.** `/exit` arrived at 14:55:30, one minute into
  the second recovery wait. It took effect at 17:58:36 at the task boundary
  (`src/interactive.ts:91-98`), after three hours of waiting and a 3m40s recovery session. With
  F20 the driver knows the wait's length in advance, so an operator who asks to stop during a
  known three-hour wait is left with two Ctrl+C (exit 130) as the only prompt exit.
- **F24 — Zhipu states a spent window's reset in its wording, and opencode relays it before the
  error (field evidence, §1.2).** Zhipu's coding plan sends no rate-limit headers (F15). Its
  refusal names the window and the reset instant: "Usage limit reached for 5 hour. Your limit
  will reset at 2026-09-16 06:28:10", and "Weekly/Monthly Limit Exhausted. Your limit will
  reset at 2026-10-02 11:25:23". The instant is Beijing time without an offset. The five-hour
  refusal came at 19:32Z; 06:28:10 read as +08:00 is 22:28:10Z, 2h56m later, and read as UTC it
  is 10h55m later, which no five-hour window allows. opencode retries the refusal. Its
  `retryable()` keeps an `APIError`'s message as the retry message, and the adapter passes
  `message` through (`src/agent/opencode/events.ts`). So each `session.status` retry carries the
  same text, and the driver holds the statement about 70 s before the `session.error` (§1.2). Nothing read it
  before S4a. "Weekly/Monthly Limit Exhausted" matched no pattern and classed as `unknown`, and
  neither text gave a `resetAt`: the headers of §5.1 are absent, and the classifier that reads
  wording exists only under a registry with a classifier list.

### 1.1 Field evidence: the 2026-09-25 run

`.auto/logs/run-2026-09-25_11-20-51.log`: claude 2.1.282, `OPENCODE_AUTO_AGENT=claude`, no
registry and no fallback ring, so no failover was possible and every fault went ladder →
`awaitRecovery`. Log times are UTC.

| | T-024 | T-026 |
|---|---|---|
| limit hit (mid-turn) | 11:44:57, session `fad5b2c5`, 206.2k context | 14:39:25, session `3e6cfc0d`, 239.5k context |
| stated reset | 12:30:00 ("resets 12:30pm (UTC)", `resetsAt` 1790339400) | 17:30:00 ("resets 5:30pm (UTC)") |
| ladder (`0,1,2,4,8`) | 11:44:57–12:00:10, five stubs × ~2.5 s, 0 tokens | 14:39:25–14:54:38, same |
| probes | 12:30:14 ok (first probe) | 15:24:40, 15:54:44, 16:24:46, 16:54:48, 17:24:51 failed; 17:54:54 ok |
| resumed after reset | +14 s | +24m54s |
| resumed from | blank session, worktree-check note (F21) | blank session, worktree-check note (F21) |
| sessions counted for the task | 8 | 13 |

The recovered sessions finished both tasks from the worktree (T-024: 6m36s at 90.5k context;
T-026: 3m40s at 102.9k). The blank restart was costly but not fatal, which bears on §11 item 8.

### 1.2 Field evidence: opencode on Zhipu, 2026-09-15 to 2026-09-26

`/workspace/kernel-mig/fs/.auto/logs/`, with its sibling targets `virtio` and `net` on the same
host: opencode on `zai-coding-plan/glm-5.3` (the server default), no registry and no fallback
ring, a driver build from before this design. The three targets share one account: on
2026-09-15 all three were refused within 20 s of each other, with the same reset. Log times are
UTC, checked against the files' modification times.

| | 2026-09-15 (fs, virtio, net) | 2026-09-17 (virtio) | 2026-09-26 (fs, T-039) |
|---|---|---|---|
| refused | 19:32:45–19:33:04Z | 01:53:30Z | 17:15:20Z |
| wording | "Usage limit reached for 5 hour. Your limit will reset at 2026-09-16 06:28:10" | "Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-09-17 10:16:43" | "Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-10-02 11:25:23" |
| reset as +08:00 | 22:28:10Z (+2h56m) | 02:16:43Z (+23m) | 2026-10-02 03:25:23Z (+5d10h) |
| each later call failed after | under 1 s | 1m14s–1m18s | 1m9s–1m17s |
| what the driver did | five ladder stubs, a human prompt, blocked at 20:18Z | the ladder | five ladder stubs, then 14 probes at 30-minute intervals until a double Ctrl+C at 01:17Z |

On 2026-09-26 the session's last activity was at 17:14:05 and its `session.error` came at
17:15:19; on 2026-09-17 the gap was 72 s. Every later stub and probe took about as long. That is
opencode retrying the refused request before it gave up. The operator saw the limit wording in
opencode's own log during that time, which matches F24's reading of its retry code. Scheduled on the stated reset, the 2026-09-26 wait is one sleep of five days and ten
hours and one probe; polled, it is about 260 probes of 70 s each.

The same run met "Rate limit reached for requests" three times (11:58Z, 16:09Z, 16:18Z), with no
reset stated. Each burst cleared within about seven minutes, on the ladder's second to fourth
rung. Those calls failed in under a second: the build predates S1, so F3 settled the first retry
signal at once.

opencode's own log and database for these runs were not kept. Under the target,
`.local/share/opencode/opencode/` holds only a bootstrap of 2026-09-12, with one session. The raw
`APIError` (its response body with Zhipu's error code, and its headers) therefore stays S0's open
opencode half; the wording above is what the driver logged from `session.error`.

## 2. Constraints

- **C1 — agents are used through surfaces they already expose.** No patch to opencode, no flag
  invented for claude. Headers, stream-json lines and status events only.
- **C2 — no registry, no change** — with one deliberate exception: F3 and F7 are defects, and a
  defect fix changes behaviour for every run; so is F21. §11 item 1 accepts that exception.
- **C3 — the classifier stays advisory.** A deterministic signal beats an inferred one: patterns
  and headers outrank the classifier, which keeps its raise-only merge
  (`src/classify.ts:200-207`) and never judges completion.
- **C4 — secrets stay out of everything the driver writes**, and registry keys are references,
  never literals: the driver resolves a referenced value only into a child process's environment
  (`plans/0055-model-registry-and-tier-routing-design.md:49` and §4.3). This is what makes §9
  hard.
- **C5 — exit codes are unchanged.** Waiting for a quota never exits; a session fault never
  exits (`plans/0015-session-error-retry-plan.md:370-372`).
- **C6 — `src/agent/types.ts` is frozen.** Every amendment is conscious, numbered and recorded in
  its header comment (six so far, `src/agent/types.ts:13-32`). §5 is the seventh.
- **C7 — the taxonomy does not grow.** A quota window is not a new `ErrorClass`: F1's question is
  "does switching help", and a window answers "until when". The window rides beside the class.

## 3. The split: three questions, three kinds of fact

| Question | Kind of fact | Where it must come from | Today |
|---|---|---|---|
| Does switching model or key help? | **class** | error wording, status code, `isRetryable` | answered (`src/chain.ts:337-345`) |
| Will this agent cure it by itself? | **policy** | declared per adapter, verified once | guessed from `3` / `60_000` (F2, F3) |
| If not, until when must we wait? | **window** | provider headers, a provider endpoint, else prose | an LLM reading prose (F11), then ignored (F10) |

The design keeps the class machinery as it is and adds the two missing kinds.

## 4. The agent's retry policy: declared, not guessed

A static record on the adapter, beside `errorPatterns`:

```ts
// What the agent does on its own when a provider request fails. Static per
// adapter, verified by its smoke check; the driver consults it instead of
// inferring the agent's behaviour from the shape of one error.
export type AgentRetryPolicy = {
  // The agent's own attempt cap; undefined = it retries as long as the error
  // stays retryable (opencode: SessionRetry.policy has no cap).
  maxAttempts?: number
  // The longest backoff the agent applies when the provider stated no wait.
  // Above this, a reported wait came from the provider, not from the ladder.
  backoffCapMs: number
  // The agent honours a provider-stated wait (retry-after) and therefore goes
  // silent for that long: no error, only retry signals.
  honorsRetryAfter: boolean
  // The agent waits out a spent quota window by itself, in the mode the driver
  // runs it. False for claude headless, which terminates the run (F7, F16).
  waitsOutLimit: boolean
  // How a final failure is recognized, so the driver never reads a terminal
  // signal as one more backoff step.
  terminal: "error-event" | "result-line" | "process-exit"
  // How long the driver expects no event at all while the agent backs off.
  // The liveness watchdog must not judge the session dead inside it.
  silenceBudgetMs: number
}
```

Declared values (claude's throttle numbers come from the S0 smoke check, not from this
document):

| Adapter | maxAttempts | backoffCapMs | honorsRetryAfter | waitsOutLimit | terminal | silenceBudgetMs |
|---|---|---|---|---|---|---|
| opencode | undefined (F4) | `30_000` (F4) | true | true | `error-event` | the last known `next`, else `PROBE_INTERVAL_MS` |
| claude | throttle: from S0; spent window: 0 (F19) | from S0 | true | **false** (F16, F19) | `result-line` | from S0 |

claude's two limit shapes differ, and the record has to say so. A throttle 429 goes through the
CLI's own `api_retry` ladder (F8). A spent subscription window is never retried (F19): its
terminal signal is F20's `status: "rejected"`, which arrives before the `result` line of the
same turn.

**4.1 The threshold becomes a policy question.** `rateThresholdMet(info)` keeps its signature and
gains a policy argument; `agentGaveUp(info, policy)` replaces the constants:

- `policy.maxAttempts !== undefined && (info.attempt ?? 0) >= policy.maxAttempts` — the ladder is
  spent;
- `(info.next ?? 0) > policy.backoffCapMs` — the wait came from the provider, so the agent will
  not cure it sooner than the window opens (this is the honest form of today's `60_000`, which
  only worked by accident on the adapter whose cap is 30 s);
- `!policy.waitsOutLimit && info.terminal` — the agent already gave up; waiting is not a strategy.

A spent window with a stated reset (`scope` `5h`/`7d` and a `resetAt`, §5) skips the retry ladder
altogether and goes straight to the escalation: key, then model, then the scheduled wait of §6.
On 2026-09-25 the ladder bought nothing but 15 minutes and five stub sessions per event (F22).
The ladder stays in force for everything else, including an `unknown` class that has no stated
reset.

Without a policy record the two constants stay, so an unmapped adapter behaves as today.

**4.2 The silence budget closes U3.** When `honorsRetryAfter` holds and the last retry signal
named a `next` beyond `silenceBudgetMs`, the liveness watchdog's two-failure rule
(`src/watch.ts:36-41`) must not fire before that instant: the driver logs the expected silence
and its end, and treats the session as alive until then. This is the difference between opencode
honouring a two-hour `retry-after` and the driver declaring the session half-open ten minutes in.

**4.3 Degradation.** An adapter that declares no policy gets the constants, exactly as an adapter
with no `errorPatterns` gets the neutral table (`src/capability.ts:91-158` intersection unchanged:
a policy is a static record, not a capability flag).

## 5. The structured limit signal

The seventh conscious amendment of `src/agent/types.ts` — four optional fields on `AgentError`,
every one absent when the agent did not state it:

```ts
  // The provider's stated wait before a retry may succeed (retry-after).
  retryAfterMs?: number
  // The instant a spent limit resets, epoch ms, as the provider stated it:
  // a rate-limit header's reset value, or a synthesized retry-after. Absent
  // when nothing stated one — then the classifier may still read one (F11).
  resetAt?: number
  // Which limit the reset belongs to, so a per-minute cap and a weekly quota
  // are not waited out the same way (§7).
  scope?: "request" | "token" | "5h" | "7d" | "day" | "unknown"
  // A provider's or agent's own machine-readable limit reason: opencode's
  // action.reason (F5), a provider error code (Zhipu 1302/1305, F15).
  limitReason?: string
```

**5.1 opencode mapping.** `mapError` (`src/agent/opencode/events.ts:148-157`) reads
`data.responseHeaders` (F6):

| Header | Field |
|---|---|
| `retry-after-ms` | `retryAfterMs` |
| `retry-after` (seconds or HTTP-date) | `retryAfterMs`, and `resetAt = now + retryAfterMs` when nothing better |
| `anthropic-ratelimit-unified-5h-reset` | `resetAt`, `scope: "5h"` |
| `anthropic-ratelimit-unified-7d-reset` | `resetAt`, `scope: "7d"` |
| `anthropic-ratelimit-unified-reset` | `resetAt`, `scope: "unknown"` |
| `anthropic-ratelimit-requests-reset` | `resetAt`, `scope: "request"` |
| `anthropic-ratelimit-{input,output}-tokens-reset` | `resetAt`, `scope: "token"` |
| `x-ratelimit-reset-requests` / `-tokens` (a duration) | `retryAfterMs`, `scope: "request"` / `"token"` |

Header names are matched case-insensitively; a value that does not parse is dropped, not
guessed. The most specific reset wins (`5h` over `unified-reset` over `retry-after`). The retry
status's `action.reason` becomes `limitReason` (`src/agent/opencode/events.ts:52-62`, F5).
`retry.next` is converted from opencode's absolute timestamp to a duration at the same place,
which is the F3 fix.

**5.2 claude mapping.** The source is F20's `rate_limit_event`, not wording. The parser keeps
the latest `rate_limit_info` of the turn and folds it into the turn's terminal error:

| `rate_limit_info` | Field |
|---|---|
| `status: "rejected"` | the turn's error carries the window; with no `is_error` result, a synthesized error |
| `resetsAt` (epoch s) | `resetAt = resetsAt × 1000` |
| `rateLimitType: five_hour` | `scope: "5h"` |
| `rateLimitType: seven_day`, `seven_day_opus`, `seven_day_sonnet`, `seven_day_overage_included` | `scope: "7d"` |
| `rateLimitType: overage`, or absent | `scope: "unknown"` |
| `rateLimitType`, `overageDisabledReason` | `limitReason` (e.g. `five_hour`, `five_hour/out_of_credits`) |

The terminal `name` stops falling back to `subtype`:
`name = errorName ?? terminal_reason ?? "error"`, never `"success"`. `api_error_status` is
carried as today. The assistant `error` code keeps feeding `errorName`. F7 shows `rate_limit`
alone cannot separate a throttle from a spent window, so a `rate_limit` without a `rejected`
event stays a throttle signal for §4.1.

A `rate_limit_event` whose status is not `rejected` is not an error, but it is the only place
the driver can learn a window it has not hit yet (F20). It maps to a new `limit` event, part of
the same seventh amendment:

```ts
  // The agent's view of the provider's usage windows (claude: rate_limit_event).
  // Arrives on healthy turns too; never an error by itself.
  | { type: "limit"; session: string; status: "allowed" | "warning" | "rejected";
      windows: { scope: "5h" | "7d"; utilization: number; resetAt: number }[] }
```

The driver logs a `limit` event only when a window's reset time moves or its status changes. It
feeds §8's persistence (source `"stream"`) and gives §6 an instant when the rejected turn's own
line is missing. It is never used to refuse a dispatch in advance; §11 item 10 keeps it that way
for this design.

**5.2a Usage and model of the synthetic message (F21).** An assistant line with
`isApiErrorMessage`/`is_api_error_message`, or `model: "<synthetic>"`, reports no `contextUsed`
(undefined, so the previous figure stands) and no model. The session keeps the context figure
it earned, `attempt` records it as a fork source with its real `used`, and no `<synthetic>`
model reaches the ◈ line. Because the message names no model, watch keeps the context window
already in effect for it; otherwise the session would read 100 %. This belongs to S1 with the
other defects.

**5.3 Precedence.** A header-stated `resetAt` beats a classifier `resetAt`; both land on the same
down-mark `until` through the existing path (F11), and `acceptedReset`'s horizon and the
extend-only rule for late answers are unchanged (`src/classify.ts:184-187`,
`src/failback.ts:108-113`). `shouldAsk` (`src/classify.ts:73-76`) gains one more case where it
does **not** ask: a limit whose reset the headers already stated. The classifier's remaining job
is exactly the providers that state nothing (F15's Gemini, Zhipu, Kimi) and wording in other
languages. A wording that states its reset outright is read without it (S4a, F24): Zhipu's two
spent-window messages rank below a structured statement and above the classifier.

## 6. Scheduled waits instead of a fixed poll

`awaitRecovery` (`src/session.ts:632-751`) keeps its shape — log, sleep, probe with a fresh
throwaway session, clear-and-re-mark, fork on success, never exit — and changes one line: the
sleep targets the earliest instant that could matter.

```
sleep = known reset instant + jitter  when one is known and is sooner
      = switches.recoveryWait         otherwise
```

The jitter reuses `HIBERNATE_JITTER_MS` (F18) so several drivers sharing an account do not all
probe at the same second after a reset. The log line names the instant it is waiting for and why,
which is the difference between an operator seeing "waiting 30 minutes" for six hours and seeing
"weekly limit resets 2026-10-03T00:00+08:00; sleeping until then". `OPENCODE_AUTO_RECOVERY_WAIT`
becomes the interval used when no instant is known — unchanged semantics, no new switch.

A reset further away than the horizon (`RESET_HORIZON_MS`, 7 days) is not scheduled: it falls
back to the polled interval, as today.

Measured against §1.1: with `resetAt` from F20 and §4.1's ladder skip, the T-026 wait would have
run from 14:39:25 to 17:30:00 plus at most 10 minutes of jitter, with one probe. The actual run
waited until 17:54:54 and made five ladder stubs and six probes. T-024 would have ended within
the same jitter of 12:30:00; the actual run happened to land 14 s after it. With one driver
per account the jitter is pure delay, but at most 10 minutes of it; §11 item 6 stands.

`/exit` becomes a pause boundary inside the wait (F23; §11 item 9): no session is active, and a
known multi-hour wait is exactly when an operator wants to stop cleanly. The pause keeps what the
recovery path would have used on success (the interrupted session's id and its `used`) where the
re-run's recovery finds it. If it cannot, the pause says so in its log line.

## 7. Windows: a rolling five hours is not a week

C7 keeps the class taxonomy; the `scope` of §5 decides the strategy.

| `scope` | Meaning | Strategy |
|---|---|---|
| `request`, `token` | a per-minute cap | the agent's own ladder cures it (§4.1): do not escalate before `agentGaveUp` |
| `5h` | a rolling five-hour window | rotate the key if the provider has a ring, else fail over to a usable candidate, else sleep to the reset (§6) |
| `7d`, `day` | a weekly or daily window | a down mark `until resetAt` and selection picks another candidate — the mechanism exists (`src/failback.ts:99-101`, `src/select.ts`); the change is that the wait is scheduled, not polled |
| `unknown` | wording only | today's behaviour, with the classifier asked as today |

A weekly reset days away is not a recovery, it is a schedule — and the registry's `avoid` window
is already that shape (F18). The difference worth stating: a window is operator-declared and
repeats, a quota reset is learned and one-off. §8 writes the learned one down.

The five-hour window starts at the first request after a reset (F20: the 12:30:14 probe opened a
window that reset at 17:30). So its next reset cannot be derived from the previous one and is
never extrapolated. It is read from the stream on the first turn of each window.

## 8. Persisting a learned window (ruled in, §11 item 4)

F12 loses every learned reset at the next restart. A quota window is provider state, not driver
state, so persisting it does not contradict "a new run starts with every model eligible": the
mark still expires at its `until`, and a stale entry costs one failed probe. Proposal: persist
`{ provider, scope, resetAt, learnedAt, source: "header" | "stream" | "classifier" | "probe" }` in the run
state the recovery path already writes, with the 7-day horizon as its TTL, and read it for two
purposes only — scheduling a wait (§6) and skipping a probe that cannot succeed yet. Never for
disabling a model, and never across the horizon. §11 item 4 ruled it in; it is the one place this
design writes state that outlives a run. On a claude subscription profile, F20 feeds
this record on every healthy turn, not only on a failure: the weekly reset and utilization are
known long before the week runs out. The record is keyed by the profile (its
`CLAUDE_CONFIG_DIR`, i.e. the account), not by the model.

## 9. Provider quota endpoints (advisory probes, deferred)

F14 and F15 show what a probe could learn that no failure message states: OpenRouter's remaining
key limit and its reset, DeepSeek's and Moonshot's balance, and Anthropic's `five_hour` /
`seven_day` utilization with `resets_at`. The last is undocumented. It is also no longer the only
way to learn a Claude account's window before hitting it: on the claude adapter the agent's
stream carries the same windows (F20). What is left for this section is the Anthropic
subscription reached through opencode, and the other providers.

The blocker is C4: a driver-side HTTP call needs the credential value in-process, which the
references-never-literals invariant forbids everywhere except a child process's environment.
Three shapes are possible:

1. **Through the agent's own host.** This is how the claude adapter gets its windows (F20, §5.2);
   opencode has no such endpoint, so there it is a dead end.
2. **A narrow exception** — a registry-declared `quotaProbe` list beside `classifier`, naming the
   URL and the fields to read; the driver resolves `{env:NAME}` in-process for one Authorization
   header, logs the reference name only, never writes the value, and treats any failure as no
   answer.
3. **Skip it** — headers (§5) plus the classifier already cover Anthropic on the opencode
   adapter, which is where the reset time matters most.

Ruled deferred (§11 item 5). Shape 2 is not adopted, so nothing in this section is built; §5 and
F20 carry the Anthropic case. Should shape 2 be taken up later, the probe inherits the
classifier's contract exactly: advisory, may set a wait or a down-mark `until`, never lowers a
class, never judges completion, capped per run, and a timeout is no answer. Anthropic's endpoint
would be marked unofficial in the registry data, so a future breakage is expected and cheap.

## 10. Existing switches and commands

Unchanged in meaning: `OPENCODE_AUTO_RETRY_WAITS`, `OPENCODE_AUTO_MODEL_FAILBACK_SCOPE`,
`/failback` (which clears an `until` too, `src/failback.ts:225`), hibernate, the registry
windows. `OPENCODE_AUTO_RECOVERY_WAIT` becomes the no-instant-known interval (§6). No new switch
is added; §11 item 6 rules that a scheduled wait is not opt-out.

## 11. Rulings

All ten points were ruled on 2026-09-26 as recommended. Each item keeps its question and its
reasoning; the **Ruled** sentence is the decision.

1. **Are F3, F7 and F21 fixed for every run, or only under a registry?** They are defects, not
   features. F3 makes the first opencode 429 escalate. F7 makes a claude limit class as
   `unknown` and burn five retries; the 2026-09-25 run shows it happening, not just predicted.
   F21 throws away the interrupted session. C2's "byte-identical without a registry" was written
   for features. **Ruled:** fix all three unconditionally, and record the changed log lines
   ("context 100% (0 tokens)" and "claude/`<synthetic>`" disappear).
2. **Does `retry.next` become a duration everywhere, or does the interface accept both?** The
   interface already documents a duration and the tests pin it, so the fix belongs in the
   opencode mapping. **Ruled:** convert at `src/agent/opencode/events.ts`, and add a
   per-adapter mapping test so the two adapters cannot drift again.
3. **Does a policy record belong on the adapter or in the registry?** Adapter, because it
   describes the agent, not the model — but a provider can change an agent's behaviour (claude on
   a subscription vs an API key waits differently). **Ruled:** adapter default, optional
   per-entry override in the registry, validated at load like every other entry field.
4. **§8 — persist learned windows across runs?** **Ruled:** yes, TTL-bounded, scheduling use
   only.
5. **§9 — quota probes?** The recommendation was to build the mechanism only if shape 2 were
   accepted, and otherwise to defer it and let §5 carry the Anthropic case. **Ruled:** deferred.
   Shape 2 is not adopted, and §5 with F20 carries the Anthropic case.
6. **Should a scheduled wait be opt-out?** **Ruled:** no new switch; the log line names the
   instant and two Ctrl+C still exits 130.
7. **Does a weekly reset far in the future deserve a distinct log and stats bucket?** Today the
   wait is booked as `recovery` wait time (`src/session.ts:641-646`). **Ruled:** keep the
   bucket, add the instant to the line, and let the round conclusion name hours lost to quota
   windows per model — `src/stats.ts` already buckets per model.
8. **After a multi-hour wait, fork the interrupted session or start blank?** Once F21 is fixed,
   the recovery path forks the most valuable session again, as its rule says. But after a wait
   longer than the prompt cache lives, the fork re-writes its whole prefix (206k and 239.5k
   tokens on 2026-09-25). The blank restarts re-grew to 90.5k and 102.9k and finished from the
   worktree (§1.1). **Ruled:** keep the rule and fork. The fork carries the reasoning and the
   half-made decisions the worktree does not show, and the cost gap is bounded. S0 still checks
   what a resumed claude session sends for F19's synthetic message; if that breaks the fork,
   this ruling is reopened.
9. **Is `/exit` honoured inside the wait (F23)?** **Ruled:** yes, as a safe boundary, with
   the recovery state preserved as §6 says. Two Ctrl+C remains the forced exit.
10. **May a window observation (§5.2 `limit` event) steer dispatch before a limit is hit?** For
    example, not starting a large task at 95 % of the five-hour window. **Ruled:** not in this
    design. Log and persist only; the escalation still starts from a real rejection. A
    pre-emptive rule needs its own evidence of what a near-full window costs.

## 12. Module map

| Change | Module |
|---|---|
| `AgentRetryPolicy`, `AgentError.retryAfterMs`/`resetAt`/`scope`/`limitReason`, the `limit` event | `src/agent/types.ts` (C6, seventh amendment) |
| header and status mapping, `next` unit fix, `action.reason` | `src/agent/opencode/events.ts` |
| `rate_limit_event` → error fields and `limit` event, `terminal_reason`, error `name`, synthetic-message usage and model (F21) | `src/agent/claude/stream.ts` |
| the ladder skip for a stated spent window (§4.1) | `src/session.ts` |
| `/exit` as a pause boundary inside the wait (§11 item 9) | `src/session.ts`, `src/exit.ts` |
| the two policy records | `src/agent/opencode/client.ts`, `src/agent/claude/client.ts` |
| the optional per-entry policy override, validated at load (§11 item 3) | `src/models.ts` |
| `agentGaveUp`, the policy-aware threshold | `src/chain.ts` |
| merge order (headers over classifier), `shouldAsk` narrowing | `src/watch.ts`, `src/classify.ts` |
| a reset stated in a known provider wording (S4a) | `src/chain.ts` `statedInWording`, `src/watch.ts` |
| the silence budget in the watchdog | `src/watch.ts` |
| scheduled sleep in the wait-and-probe loop | `src/session.ts` |
| learned-window persistence (§8, §11 item 4) | `src/quota-windows.ts` (`.auto/windows.json`), read by `src/session.ts` |
| the reset instant on the wait line; hours lost to quota windows per model in the round conclusion (§11 item 7) | `src/session.ts`, `src/stats.ts`, `src/conclusion.ts` |
| glossary: retry policy, quota window, scheduled wait, learned window; the structure index; the navigation line (S6) | `docs/glossary.md`, `docs/structure.md`, `AGENTS.md` |

Import direction is unchanged: `src/classify.ts` stays below `src/watch.ts`, and neither adapter
imports the driver domain.

## 13. Stages and steps

- **S0 — close the evidence gaps.** Done so far (§1.1): F16 confirmed, F7 corrected, F19–F21
  found, and one `allowed` `rate_limit_event` captured (F20). Three gaps remain:
  - **The raw stream of a rejected claude turn.** The `rate_limit_event` with `status:
    "rejected"`, the assistant line's `error`, and the `result` line's `subtype`,
    `terminal_reason` and `api_error_status`. The driver keeps no raw stdout, and the transcript
    is a different surface. Capturing it is cheap: F19 shows a rejected call costs 0 tokens, so
    the next time a window is spent, one hand-run `claude -p "ok" --output-format stream-json
    --verbose` saves the lines. §5.2 is checked against them before S3.
  - **claude's throttle numbers** (`maxAttempts`, `backoffCapMs` for a 429 or `overloaded`),
    from its `api_retry` lines, and what a resumed session sends for F19's synthetic message
    (§11 item 8). The numbers were read from the 2.1.283 CLI in S2 (below); what a resumed
    session sends is still open.
  - **The opencode half, unchanged.** One opencode turn against a 429 with headers, capturing the
    `APIError` body (F6, F13).

  Follow the `OPENCODE_AUTO_E2E=1` opt-in precedent for anything automated.
- **S1 — the defects.** The `next` unit conversion, the claude terminal `name`,
  `terminal_reason`, the dropped limit lines, and F21's synthetic-message usage and model. Each
  with a mapping test; the log-line changes recorded for the golden check.

  **Done (2026-09-26).**
  - **F3.** `mapEvent(event, now)` turns opencode's instant into the wait
    (`src/agent/opencode/events.ts`). `test/chain.test.ts` feeds both adapters' own retry
    signal for a 2-second and a 40-minute wait, and asserts one `next` and one class for each
    (§11 item 2). The rate case in `test/watch.test.ts` had fed opencode a duration; it now
    states the instant, as opencode does.
  - **The terminal name.** `errorName`, else `terminal_reason`, else the subtype, else
    `"error"`; `"success"` is never a name. This departs from §5.2's formula in one point: a
    failing subtype (`error_max_turns`, `error_during_execution`) still names the error when
    neither of the first two is present. CLIs before `terminal_reason` send only the subtype,
    and the adapter's existing `error_during_execution` case depends on it.
  - **The limit lines.** `rate_limit_event` is read as state: the latest status of the
    process stands until the next event, since the CLI emits one only when the window changes.
    A failed turn whose latest status is `rejected` carries `isRetryable: false`. That is an
    existing field, and its meaning ("a fresh session fails the same way", `src/watch.ts`) is
    exactly F19. The turn classes as `quota`, so it escalates (key, then model), or with no
    candidate goes straight to the wait-and-probe loop. The ladder is not run. So on claude,
    §4.1's ladder skip already arrives with S1. S4 still brings it for header-stated windows
    (opencode), together with the scheduled sleep. The window's fields and the `limit` event
    stay in S3 with the seventh amendment. A `rejected` event with no `is_error` result still
    synthesizes no error until S0 has the rejected stream.
  - **F21.** The synthetic line reports no figure and no model (`src/agent/claude/stream.ts`),
    and `src/watch.ts` keeps the window in effect for a message that names no model (§5.2a).
  - **Tests.** `test/agent-claude.test.ts` holds the parser cases: the synthetic line rebuilt
    from the transcript, the captured `allowed` line verbatim, and the name rule. It also holds
    two end-to-end cases over the claude process double, each ending the first turn after
    206.2k of work. In the first, a spent window: no ladder, one probe, and the task continues
    on a fork of the interrupted session. In the second, an `overloaded` API error: the
    ladder's first retry forks the failed session with its real figure. §14 placed this F21
    regression in `test/agent-fake.test.ts`. It went into the claude suite instead, because
    the defect sits in the claude parser and only the real adapter exercises it. Each new case
    fails against the code before S1.
  - **Log lines.** The goldens are unchanged, since none covers these paths. What changes:
    - On claude, a spent window no longer logs the ladder ("↻ … transient session error;
      retrying with a new session (n/5)" and "⏳ … waiting n minutes before retrying"). The
      next line is "⏳ … non-retryable session error encountered (session error: You've hit
      your session limit · resets …); waiting 30 minutes, then probing …". With a registry
      or a fallback ring, it is the "quota restricted" failover instead.
    - The interrupted session's "◉ session ended: context 100% (0 tokens)" now shows its real
      figure, for example "context 21% (206.2k/1000.0k tokens)". A session that made only the
      rejected call, such as a probe, still reads 0 tokens, which is its true figure.
    - "◈ … using model claude/`<synthetic>` (server resolved)" is gone; such a session prints
      no ◈ line.
    - After recovery, the log reads "↻ … re-dispatching the task from a forked copy of the
      original session `<id>` (206.2k tokens)". It says "original" because the non-retryable
      path promotes the failed session to the chain's session.
    - On opencode, a 429 with a short backoff no longer settles the turn as `rate` on its
      first retry signal. opencode keeps retrying, and no "rate-limit wait too long" failover
      follows.
  - **Timing against §1.1, S1 without S4.** The fixed 30-minute poll now starts at the failure
    itself. T-024 would have probed at 12:14:57, still limited, and resumed at about 12:45,
    15 minutes after the reset; the field run resumed 14 s after it, by chance. T-026 would
    have resumed at about 17:39, 9 minutes after the reset, against 25 minutes in the field.
    Both events lose their five stub sessions. The timing gain belongs to S4.
- **S2 — the policy record.** `AgentRetryPolicy` on both adapters with the registry's per-entry
  override, `agentGaveUp` in `src/chain.ts`, the silence budget in the watchdog. Closes U3.

  **Done (2026-09-26).**
  - **The record** (`src/agent/types.ts`, the seventh amendment's first part;
    `AgentClient.retryPolicy`, absent = the neutral record). It has five of §4's six fields.
    `terminal` is not built. Every adapter already maps its final failure onto the `error`
    event: opencode's `session.error`, claude's failing `result` line and its process exit alike.
    So the driver reads the terminal signal from the event type (`ErrorInfo.terminal`, set by
    the error surface and cleared by a later retry), and a per-adapter description of it would
    have no reader.
  - **opencode's values** (`OPENCODE_RETRY_POLICY`): no cap, `backoffCapMs` 30 s, honours
    retry-after, waits out a limit, and a `silenceBudgetMs` of 10 minutes (the probe's default
    interval, §4's "else `PROBE_INTERVAL_MS`"). Reading `retry.ts` again corrected F4 in one
    point. The 30 s cap holds only when the error carries no response headers. With headers
    but no retry-after, the 2 s backoff doubles without a cap. So a wait above 30 s is the
    provider's, or the backoff after a fifth failure in a row (32 s). Either way the agent will
    not cure the failure sooner, which is what §4.1 asks.
  - **claude's values** (`CLAUDE_RETRY_POLICY`), read from the 2.1.283 CLI rather than a smoke
    check. The default is 10 retries; `CLAUDE_CODE_MAX_RETRIES` changes it, clamped to 15, and
    every `api_retry` line states it as `max_retries`. The backoff is `min(500 ms ·
    2^(n−1), 32 s)` plus up to 25 % jitter, so 40 s at most. A provider's retry-after is
    honoured up to 60 s; above that the CLI gives up at once (`retry_after_too_long`), so no
    claude silence is longer than 60 s, and that is its budget. `waitsOutLimit` is false
    (F19). `CLAUDE_CODE_RETRY_WATCHDOG` changes the whole policy (300 retries, waits up to
    6 h), and it is the case the per-entry override exists for.
  - **`agentGaveUp` and the neutral record** (`src/chain.ts`). `NEUTRAL_RETRY_POLICY` is the old
    pair of constants written as a record: three attempts, a minute, waits out a limit,
    announces nothing. So an adapter without a policy behaves exactly as before, and there is
    one code path. `rateThresholdMet` and `classifySessionError` take the policy, and so does
    the classifier's `mergeClass`. watch computes the session's policy once:
    `retryPolicyOf(client.retryPolicy, entry.retry)`. The classifier's own one-shot session
    does the same.
  - **The override** (`models.<name>.retry`, `src/models.ts`). It takes any of the five fields,
    each validated on its own, with unknown fields and an empty object refused. It is allowed
    on every adapter, and without `model`, since the agent's default model retries the same
    way. The `models` command shows it as written.
  - **The silence budget** (`src/watch.ts`). This is built as §4.2 says, but its premise needs
    a correction. A retry that names a wait above the budget (with `honorsRetryAfter`) is
    logged with its end, and until that end a failed liveness probe is logged but not counted.
    Model output ends the silence early. The premise was that the watchdog would otherwise
    judge the session dead ten minutes in. It would not. The probe asks `get`, which a live
    agent answers during its wait: opencode's server serves it, and the claude adapter answers
    from its own table. So for today's two adapters the rule changes nothing while the agent
    lives. When the driver cannot reach the agent at all, it defers the half-open verdict to
    the announced end at the latest. What U3 asked is answered by the rest of S2. A rate-signal
    wait that the agent's own backoff would not choose now settles the turn and escalates, and
    no longer sits silent. The wait that does sit silent (a transient one) is announced with
    its end. One silent-wait hazard is left, and it is not the probe. The opencode adapter caps
    the synchronous prompt POST at two hours (`TURN_TIMEOUT_MS`,
    `src/agent/opencode/server.ts`). A turn that outlasts it is read as a failed dispatch,
    whatever its events say. Only a long transient wait can still reach that cap. It is
    recorded here and left for S4, which owns the waits.
  - **Tests.** `test/chain.test.ts`: `agentGaveUp` per clause (the cap spent or absent, a wait
    at and just above each cap, a terminal signal with and without `waitsOutLimit`), the
    neutral record against plans/0017's threshold, and `retryPolicyOf`. The F3 cross-adapter
    block now also runs each adapter's own mapped signal under its own policy.
    `test/agent-fake.test.ts`: the threshold following a declared policy, a terminal rate
    signal on an agent that does not wait out a limit, an entry's override reaching watch, and
    the announced silence (the probe held, the same wait unannounced without
    `honorsRetryAfter`, counting again past the end, and model output ending it).
    `test/models.test.ts` and `test/models-describe.test.ts`: the override's validation and
    display. The four tests that pin the list of known entry fields gained `retry`.
  - **Behaviour and log lines.** The goldens are unchanged.
    - opencode: a rate signal settles the turn only when its wait exceeds 30 s. Before, it
      settled at the third attempt or above a minute. A 429 whose error carries no headers
      therefore keeps opencode retrying every 30 s for as long as it lasts, which is its
      declared policy.
    - claude: a rate signal still being retried settles at the tenth attempt or above 40 s.
      Before, it settled at the third attempt or above a minute. A turn that ends on a rate
      signal (the CLI spent its retries) is now `rate` instead of `unknown`. With a registry or
      a fallback ring it fails over at once. Without either it takes the ladder, as before.
    - New lines: "⏳ the agent waits 2h 0m before retrying (attempt 3) (session …); no
      events are expected until <ISO time>", and during that wait "⚠ connectivity probe failed
      (session …) inside the agent's announced wait; not counted before <ISO time>".
- **S3 — the structured signal.** The four `AgentError` fields, the header table, claude's
  `rate_limit_event` table and the `limit` event, precedence over the classifier, `shouldAsk`
  narrowing.

  **Done (2026-09-27).** S0's rejected stream is still not captured. §5.2 was built from the
  2.1.283 SDK schema, the transcript's window record (F19) and the captured `allowed` line
  (F20), and it is to be checked against the rejected stream once one is saved.
  - **The amendment** (`src/agent/types.ts`, the seventh amendment's second part).
    `AgentError` has `retryAfterMs`, `resetAt`, `scope` and `limitReason`, as §5 wrote them;
    `LimitScope` names the scopes. The `limit` event carries `LimitWindow`s, and it departs
    from §5.2 in one point: `utilization` is optional. A `rate_limit_event` without
    `unifiedWindows` (API-key profiles, and the transcript's record) names one window and no
    utilization. The driver's `ErrorInfo` (`src/chain.ts`) carries the same four fields. They
    ride beside the class and never decide it (C7).
  - **The opencode mapping** (`limitFields` in `src/agent/opencode/events.ts`). It follows
    §5.1's table, with three refinements:
    - The unified family counts only when its `-status` is absent or `rejected`, and a
      per-minute cap only when its `-remaining` is absent or zero. Providers send these reset
      headers on every response, so without the gate a throttled request on an open
      subscription window would carry a five-hour reset it never hit.
    - "The most specific reset wins" is read as "the reset that binds". The unified `-reset`
      names the binding window, and its scope is the window whose own reset it equals, else
      `unknown`. Without it, a lone window is taken; of two, the fuller one by
      `-utilization`, else the later. Among the per-minute caps that refused the request,
      the latest reset binds.
    - `anthropic-ratelimit-tokens-reset` (the documented combined cap) joins the token row.
      An OpenAI-family duration gives a `resetAt` as well, and gives `retryAfterMs` only when
      no retry-after was stated.

    Values parse strictly: RFC 3339 with an offset, an HTTP IMF-fixdate, epoch seconds or
    milliseconds (a number below 1e9 is no instant), and a Go-style duration. Anything else is
    dropped. The retry status's `action.reason` becomes `limitReason`. One fact corrects F6's
    premise. The current opencode server publishes a retry only as the `session.status`
    (`message`, `action`, `next`) and sends no retry parts. So the headers reach the driver
    only on `session.error`, and on the retry parts of older servers. On the retry surface,
    `next` (S2) is still what settles a turn. The Zhipu error codes §5 names under
    `limitReason` are not read: §5.1's table has no row for them.
  - **The claude mapping** (`src/agent/claude/stream.ts`). Every `rate_limit_event` with a
    known status becomes a `limit` event (`allowed_warning` becomes `warning`). Its windows
    are the unified five-hour and weekly windows, else the one window the event names; the
    overage-included weekly window is not listed as a second `7d`. The event's info remains
    the parser's state (S1). A failed turn under a `rejected` status now carries, beside
    `isRetryable: false`, the `resetAt`, the `scope` (`seven_day*` → `7d`; overage or no
    type → `unknown`) and the `limitReason` (`five_hour/out_of_credits`). A `rejected`
    event with no `is_error` result still synthesizes no error; that waits on S0 as before.
  - **Precedence** (`src/watch.ts`, `src/classify.ts`). The turn's record keeps the latest
    limit statement, and a stated reset replaces the earlier reset together with its scope.
    `resetFields` returns a stated reset first, under `acceptedReset`'s horizon, which now
    takes an `ErrorInfo` too. With a stated reset no `pendingReset` is returned, so a late
    answer cannot extend the marks past it. The stated reset rides the result without a
    registry too. It has no effect there, because only the registry's down marks read it;
    S4's scheduled wait will. Model output clears the statement, as it ends an announced
    silence. Otherwise a reset stated by a retry the agent got through would carry into
    the down mark of a later, unrelated failure in the same watch.
  - **`shouldAsk`.** A failure with a stated `resetAt` is not asked about, on either
    surface. A retry-after alone counts too: it synthesizes a `resetAt`, and a provider that
    states its wait is not one of the providers the classifier is for. The same check keeps
    an answer already on its way from raising the class once a reset is stated.
  - **The `limit` event in watch.** It is logged when its status or a window's reset
    changes, once per agent client across its sessions (a `WeakMap`, so a run shows one line
    per window, not one per session). It is not a turn event, and the twin-idle guard does
    not see it. Nothing reads it for dispatch (§11 item 10). Persistence is S5.
  - **Tests.**
    - `test/agent-events.test.ts`: a `session.error` whose `APIError` carries
      `retry-after-ms` and the unified headers, the `action.reason` row, and `limitFields`
      row by row (the binding window, the utilization and later-reset fallbacks, the status
      and remaining gates, both instant forms, durations, and unparsable values dropped).
    - `test/agent-claude.test.ts`: the S1 cases now expect the window on the error and a
      `limit` event per line (the captured `allowed` line verbatim). A new case covers the
      status and type rows.
    - `test/classify.test.ts`: the narrowing.
    - `test/agent-fake.test.ts`:
      - a native double's retry with a stated reset, which ends as the down mark's `until`
        with the classifier never asked (§14's case, without a provider);
      - the classifier not asked about unknown wording when a reset is stated;
      - a stated reset outranking an answer already in hand;
      - model output clearing the statement;
      - the window log's change rule across two sessions and two agents.

    Each fails against the code before S3.
  - **Log lines.** The goldens are unchanged. New lines:
    - "ℹ usage windows (session …): 5h 4% used, resets 2026-09-27T03:20:00.000Z; 7d 40% used,
      resets 2026-09-30T22:00:00.000Z", logged once per change;
    - the same line headed "⚠ usage windows near their limit" or "⚠ a usage window is spent".

    Under a registry, a header- or stream-stated reset now sets the down mark's `until`
    without a classifier, and "the classifier reads the failure as …" no longer appears for
    a failure whose reset was stated.
- **S4 — the scheduled wait.** §6 with §4.1's ladder skip, then §7's scope table, then `/exit`
  inside the wait, then §11 item 7's wait line and round-conclusion figure.

  **Done (2026-09-27).**
  - **The sleep** (`planSleep` in `src/session.ts`). Each round of the wait-and-probe loop
    works out its sleep before it logs. Without a registry, the instant is the reset the last
    failure stated: first the failure that led into the loop, then each failed probe's. A
    probe that errors on its own leaves no instant. Under a registry, the instant is when the
    down list comes back by waiting alone. `recoveryAt` (`src/select.ts`) walks the candidates
    selection would walk and takes the soonest instant one of them is usable again: now for a
    usable one, else a down mark's `until`, in either case moved to the next opening of its
    windows. The marks already hold every stated reset, because the escalation and the failed
    probes write them with `until` (S3), so the failure's own reset needs no second path. The
    rule is conservative. A down mark without `until`, or a ring with no usable key, leaves the
    instant unknown, since waiting alone may never cure it. A candidate the cap excludes is
    skipped, as selection's wait decision skips it. A candidate usable now explains no wait.
    The loop can still be there: a probe on a candidate whose mark has lapsed goes through
    selection as a pick, and its failure re-marks nothing. Such a round falls back to the
    failure's own reset, else the poll, so it never sleeps the jitter alone. §6's "when one is
    known and is sooner" is read as "within the horizon": a known instant up to
    `RESET_HORIZON_MS` away gives `until − now` plus `random() × HIBERNATE_JITTER_MS`, with
    the registry's injected clock, random and sleep when there is one. Anything else sleeps
    `recoveryWait`, as before. The probe, the clear-and-re-mark and the fork on success are
    unchanged.
  - **The ladder skip** (§4.1). `spentWindow` reads a failure with a stated `resetAt` and the
    scope `5h`, `7d` or `day` as a spent window, whatever its class. With a registry or a
    fallback ring, it escalates at once (key, then model). When the class gives no label, the
    move names itself "five-hour / weekly / daily usage window spent". Without either, it goes
    straight to the wait, which sleeps to the reset. On claude, S1 already skipped the ladder
    through `isRetryable: false`. S4 adds opencode's header-stated windows and any other
    adapter's.
  - **The scope table** (§7).
    - `request` and `token`: the retry branch of `src/watch.ts` no longer settles quota
      wording on a per-minute cap before `agentGaveUp`. A rate class already waited for it.
    - `5h`: the escalation as before, then the ladder skip and the scheduled sleep.
    - `7d` and `day`: the down mark `until resetAt` (S3) and the scheduled wait.
    - `unknown`: unchanged.

    The scope rides `Watch` and the blocked `SessionResult` beside `resetAt` (`src/chain.ts`,
    `src/attempt.ts`).
  - **`/exit` inside the wait** (§11 item 9, `src/exit.ts`). `sleepUnlessExit` races the
    sleep against `requestExit`, which now wakes every sleeper. It returns at once when /exit
    was requested before the sleep. On a pause, `pauseForExit` writes the progress record the
    re-run's recovery reads. The record names the most valuable fork source by the recovery's
    own rule (the failed session, else the chain's session), active, with the chain's phase.
    Its figure goes into a new optional `Progress.used`. `sessionUsage` takes that figure for
    an agent that keeps no history (claude), which otherwise reads 0. The runner's resume and
    the step resume in `src/artifact.ts` pass it. Then `ExitRequested("wait", …)` reaches
    `runAll` and exits 3, like the other boundaries. A phase-less chain (a one-off session)
    writes no record, and a chain with no session has nothing to keep; the pause line says
    which. The re-run resumes the kept session through the existing resume path; it does not
    fork it. The /exit receipt names the new boundary, and under `--interactive` the wait line
    offers /exit.
  - **Quota-window stats** (§11 item 7). Two kinds of wait are booked per model in a new
    `quotaWaits` record of each bucket (`statsQuotaWait`, `src/stats.ts`): a wait scheduled to
    a reset, and any wait entered after a `quota` or `rate` failure. Each still books the
    generic `recovery` wait as well. The figure is the planned sleep, or the part slept before
    an /exit; it is never a clock difference. Unlike `waitMs` it is not clamped at `MAX_TICK`
    (30 minutes), so a five-hour wait counts as hours. The key is the model the wait is for:
    under a registry the candidate that comes back first, else the chain's model. The round
    conclusion adds one line after the model block when anything was booked. History merges
    the record at the round rollover.
  - **Tests.**
    - `test/select.test.ts`: `recoveryAt`. It covers the soonest end, now for a usable
      candidate, an unknown instant for a mark without `until` and for an exhausted ring, a
      skipped cap-excluded candidate, and an end inside a closed window moved to its opening.
    - `test/exit.test.ts`: `sleepUnlessExit` for a full sleep, a sleep cut short, an /exit
      requested before it, and an injected sleep.
    - `test/stats.test.ts` and `test/loop-conclusion.test.ts`: the three buckets, the
      unclamped figure, absence until booked, lenient parsing, the rollover, and the
      conclusion line.
    - `test/agent-fake.test.ts`, a new block (§14's wait-and-probe case):
      - without a registry, a stated five-hour reset: the sleep ends at it, one probe, a
        fork, and the figure is booked;
      - under a registry on a fake clock: b's reset plus half the jitter (3 900 000 ms), with
        the line naming b and a's mark keeping its five-hour reset;
      - an end beyond the horizon, and a mark without `until`: polled;
      - a probe failing on a candidate whose mark lapsed: the next round sleeps to the
        probe's stated reset, else polls;
      - a spent weekly window of unknown wording: no ladder, a sleep to its reset, and under
        a registry an immediate escalation;
      - the per-minute gate;
      - /exit in mid-sleep: the record, the line, no probe, and the partial figure booked;
      - /exit requested before the wait: the failed session kept, and the one-off line;
      - `sessionUsage`'s recorded figure.
    - `test/agent-claude.test.ts`: §1.1's case with its reset still ahead sleeps to the
      reset, not the 30-minute poll. `interruptedRun` now takes the switches.

    Each new wait case fails against the code before S4, whose recovery sleep was a plain
    `Bun.sleep` of `recoveryWait`.
  - **Log lines.** The goldens are unchanged. What changes:
    - A wait with a known instant reads "⏳ T-026 non-retryable session error encountered
      (…); the five-hour usage window resets 2026-09-25T17:30:00.000Z, sleeping until about
      <ISO> (local <time>, includes random delay), then probing service recovery with a fresh
      temporary session (press Ctrl+C twice to force exit)". The window is named by the scope
      (five-hour, weekly, daily, per-minute, else "the limit"). Under a registry the reason
      reads "b is usable again at <ISO in the registry's zone>".
    - A spent window with no class reads "the weekly usage window is spent (…)" where the
      ladder used to log, and "⇄ … weekly usage window spent; keeping chain context,
      switching model a → b" when it escalates.
    - Under `--interactive` the wait lines end "(type /exit to pause the run here, or press
      Ctrl+C twice to force exit)". The /exit receipt reads "…next safe boundary
      (phase/task/subtask handover point, or a recovery wait)…".
    - New: "⏸ T-001 /exit inside the recovery wait: the re-run resumes the original session
      ses_1 (5000 tokens)", or the one-off and no-session forms.
    - New in the round conclusion: "  time lost to quota windows: glm 3h 5m; opus 1m 30s".
  - **Timing against §1.1.** Both events carry the reset in the `rejected` window since S3.
    T-026 now sleeps from 14:39:25 to 17:30:00 plus up to 10 minutes of jitter, then probes
    once. The field run resumed at 17:54:54 after five stubs and six probes; S1 alone would have
    resumed at about 17:39. T-024 now wakes between 12:30:00 and 12:40:00, where S1 alone would
    have resumed at about 12:45.
  - **Still open.**
    - The two-hour `TURN_TIMEOUT_MS` hazard S2 left here is not addressed. The scheduled sleep
      runs between sessions and never meets the cap. The hazard is a transient wait longer
      than two hours inside an opencode turn, which is still read as a failed dispatch. The
      fix would be in the opencode adapter (extend the cap by an announced wait) and needs its
      own step.
    - A current opencode server publishes a retry as `session.status` only, with no headers
      (S3). A limit met there reaches the wait with no instant and still polls. Only a
      `session.error` with headers, or claude's `rejected` window, schedules.
    - The window waits (`waitForWindow`, at dispatch and inside the loop) are not /exit
      boundaries. §11 item 9 names only the recovery wait.
    - A probe that selection picks as usable re-marks nothing when it fails (0055 §6.3
      clears and re-marks only the probe decision's candidate). The sleep now covers that
      case; whether such a failure should write a mark is 0055's to decide.
    - A learned instant dies with the process until S5. S0's rejected claude stream is still
      not captured.
- **S4a — a reset stated in the provider's wording.** Added with the field evidence of §1.2:
  on opencode and Zhipu, without a registry, S1–S4 got no instant (F24).

  **Done (2026-09-27).**
  - **The wording table** (`statedInWording`, `src/chain.ts`, beside the classification
    patterns, since provider wording evolves there). Two rows: "Usage limit reached for 5 hour"
    gives `scope: "5h"`, "Weekly/Monthly Limit Exhausted" gives `7d`. Each takes its instant from
    "Your limit will reset at YYYY-MM-DD HH:MM:SS", read as +08:00. An instant that is past, or
    for the five-hour row more than five hours (plus a minute) away, is dropped rather than
    read in another zone. The weekly row has no bound of its own; `acceptedReset`'s horizon
    still applies downstream, so a monthly reset beyond seven days is polled as before. The
    rows match the wording, not the agent: z.ai's Anthropic endpoint under claude sends the
    same text.
  - **The class.** `QUOTA_RE` gains "limit exhausted", so the weekly wording classes as `quota`
    and settles on the first retry status. "limit reached" is not added: Zhipu's per-minute
    "Rate limit reached for requests" must stay a rate signal the agent's backoff owns.
  - **The merge** (`withWording`, `src/watch.ts`). On both surfaces, the event's own words are
    read when the event states no limit in structured form: a header- or stream-stated reset
    outranks the wording, and across events the latest statement stands, as §5.3 has it. The
    rest follows unchanged:
    - `shouldAsk` does not ask the classifier;
    - `resetFields` carries the instant and its scope;
    - `spentWindow` skips the ladder, and `planSleep` sleeps to the reset;
    - under a registry, the down mark ends at it.
  - **Not done.**
    - Zhipu's error codes (1302, 1308, 1310 and the like) are not read. The raw response body
      was not captured (§1.2), and the wording already decides.
    - Kimi's wording is unknown and has no row. Other providers still leave wording to the
      classifier.
  - **Tests.**
    - `test/chain.test.ts`: the three field messages verbatim, their classes, the +08:00
      reading of all three recorded resets, and the drops: a past instant, a five-hour reset
      twelve hours ahead, and text with no window or no reset sentence.
    - `test/agent-fake.test.ts`, the scheduled-wait block:
      - without a registry, a retry status carrying only the weekly wording: abort at the
        first retry, no ladder, a sleep to the stated reset, one probe, a fork;
      - under a registry, the five-hour wording on `session.error`: the ⇄ move, and the down
        mark ending at the reset;
      - a structured statement outranking the wording.

    Each fails against the code before S4a.
  - **Log lines.** The goldens are unchanged. On §1.2's 2026-09-26 event:
    - the ladder's "↻ … transient session error" lines are gone;
    - the wait reads "⏳ T-039 the weekly usage window is spent (session error:
      Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-10-02 11:25:23); the weekly
      usage window resets 2026-10-02T03:25:23.000Z, sleeping until about …";
    - each call settles at opencode's first retry status (its first backoff is 2 s), not after
      about 70 s.

    The five-hour wording sleeps to its reset in the same way ("the five-hour usage window is
    spent …").
  - **This narrows S4's second open item.** A retry status still carries no headers, but on
    Zhipu the wording now gives the instant. Other wording-only providers still poll without a
    registry.

- **S5 — persistence** (§8), keyed by the profile's account.

  **Done (2026-09-27).**
  - **The record** (`src/quota-windows.ts`, `.auto/windows.json`). It holds one entry per account
    and scope: `{ account, scope, resetAt, learnedAt, source, spent, utilization? }`. The latest
    statement stands. An entry dies at its reset, or seven days after it was learned
    (`RESET_HORIZON_MS`). Writes are atomic and serialized per directory, and a failed write is
    silent, as with stats. The run lock makes the in-memory copy the file. The module map named
    `src/failback.ts`, but the record got a module of its own: failback's marks are in-memory
    selection state, and the record must never become one of them.
  - **The account.**
    - Under a registry: the entry's agent profile, its provider, and the ring's current key by
      name (`opencode/zai-coding-plan#ZHIPU_KEY_B`, `claude-b`). A claude profile is its login,
      so the key names the profile rather than its `CLAUDE_CONFIG_DIR` value (C4).
    - Without a registry, the directory has one agent. The account is the provider of the model
      string (`zai-coding-plan`), else `default`, since claude's model ids name no provider.
  - **The sources.** Three sources are recorded:
    - `stated`: the failure's structured fields or a known wording (opencode's headers, claude's
      stream, S4a's wording);
    - `classifier`;
    - `observed`: the `limit` event.

    §8's split between header and stream is not kept, because the driver sees one `AgentError`
    shape (C6) and no adapter name. §8's `probe` is §9's quota endpoint, which is deferred.
  - **The writers.**
    - `runSession` records a failure's stated reset for the account it ran on, before the
      escalation moves the chain. It does the same for each failed probe, on the probed account:
      the probe candidate under a registry, else the chain's.
    - `watch` hands a changed `limit` event to `attempt`, which records it for the chain's
      account. This is a new trailing `onLimit` parameter beside `onModel`. A window is spent when
      its utilization is 1, or when a rejected event names it alone. Any other observation
      replaces a spent entry of the same window.
    - A turn that goes through clears the account's spent entries, whether it is the dispatch
      or a probe. A provider may reset early, and a stale entry must not stretch a later,
      unrelated wait.
    - A per-minute scope is not recorded. Neither is the classifier's late answer
      (`pendingReset`). The reset's source rides `Watch.resetSource` and the blocked
      `SessionResult`.
  - **The reader** (`planSleep`). The record is read only where the failure's own reset would
    apply and the failure states none. There, the latest reset among the account's spent
    entries is the instant. That covers a failure of unknown wording on a spent account, a
    re-run's first failure, and a probe that errored on its own.

    The last case read "no instant" in S4 and polled. The wait now keeps the account of the
    failure it waits out. Under a registry `recoveryAt` still comes first.

    The record never writes a down mark. It never makes the escalation skip the ladder, because
    `spentWindow` reads the failure alone. It never refuses a dispatch (§11 item 10): a re-run's
    first dispatch still goes out and fails.
  - **Tests.**
    - `test/quota-windows.test.ts`:
      - the account key, without a registry and under one (profile, provider, raw override, and
        the ring key by name, never by value);
      - the record surviving a module reset, with the latest spent window read;
      - a classifier's reset recorded as `unknown`; per-minute and past resets not recorded;
      - the horizon;
      - the clear on success, per account;
      - observations: used up, rejected alone, two windows left undecided, an open observation
        superseding a spent entry;
      - an observation arriving beside a statement;
      - lenient reading.
    - `test/agent-fake.test.ts`, the scheduled-wait block:
      - Zhipu's weekly wording is recorded. A re-run whose failure states nothing sleeps to it;
        /exit at the wait line stands in for the long sleep.
      - A probe that errors on its own sleeps to a recorded weekly reset, after the failure's own
        five-hour reset.
      - A turn that goes through clears the account's spent entry and records its observation.

      Each fails against the code before S5.
    - `test/import-direction.test.ts`: the new module is classified as driver.
  - **Log lines.** The goldens are unchanged. A wait whose instant comes from the record reads
    "…; the weekly usage window resets 2026-10-02T03:25:23.000Z (recorded
    2026-09-26T17:15:19.000Z), sleeping until about …". Nothing else is logged; the file is the
    record.
  - **Against §1.2.** The 2026-09-26 run was stopped with Ctrl+C at 01:17Z. Since S4a, a re-run's
    first dispatch fails at opencode's first retry status and sleeps to the stated reset, with
    or without the record. The record adds two cases: the re-run's failure states nothing, or a
    probe errors on its own in the middle of the wait.
  - **This closes S4's open item on a learned instant** ("dies with the process until S5").
    S0's rejected claude stream is still not captured.
  - **Still open.**
    - The record is per directory. fs, virtio and net share one Zhipu account (§1.2), and each
      learns the window once.
    - `recoveryAt` does not read the record for a down mark without `until`. A registry run with
      such a mark polls as before.
- **S6 — the durable documentation:** glossary, `docs/structure.md`, the AGENTS.md navigation
  line. Quota probes are deferred (§11 item 5) and have no step.

  **Done (2026-09-27).** Documentation only; no code, test or log line changes.
  - **`docs/glossary.md`**, in the model-routing table:
    - new rows: retry policy, silence budget, quota window, reset, stated reset, limit event,
      scheduled wait, learned window, account;
    - widened rows: the retry ladder (skipped for a stated spent window), the wait-and-probe
      loop (`OPENCODE_AUTO_RECOVERY_WAIT` is its interval when no reset is known), error
      classification (`unknown` added), and the safe boundary (the wait is one for `/exit`).

    Three confusable pairs are added: retry ladder / retry policy; the registry's window / a
    quota window; and quota window / usage window.
  - **The term.** The design, `src/quota-windows.ts`, `quotaWaits` and the round conclusion
    say "quota window"; the log lines say "usage window" (S3's window lines, S4's wait lines).
    The glossary makes **quota window** the prose term, the design's own. "Usage window"
    survives in the log lines and the agent interface's comments, as `handoff` survives beside
    handover. The log lines are left as they are.
  - **`docs/structure.md`.**
    - A new row for `src/quota-windows.ts` under the task store and state.
    - Widened rows: the agent interface and both adapters, the registry loader (`retry`),
      selection (`recoveryAt`), the classifier, session driving (the ladder skip and the
      scheduled wait), the event stream, the session chain, stats, conclusions, graceful exit,
      and hibernate (its jitter).
  - **`AGENTS.md`.** One navigation line after the wait-and-probe loop's, pointing here. The
    agent-domain line also names the seventh amendment beside 0055's. No invariant line is
    added, because the design's constraints are already listed there: C4 is the references
    invariant and C5 the exit codes.

## 14. Test plan

- `test/chain.test.ts`: `agentGaveUp` per policy — capped vs uncapped `maxAttempts`, a `next`
  above and below `backoffCapMs`, a terminal signal with `waitsOutLimit` false. The existing
  duration-semantics cases (`test/chain.test.ts:125,131`) stay and gain the opencode absolute
  timestamp as the regression for F3.
- Adapter mapping tables, line by line: `src/agent/opencode/events.ts` with a real `APIError`
  carrying `anthropic-ratelimit-unified-5h-reset` and `retry-after-ms`;
  `src/agent/claude/stream.ts` with the S0-captured lines. These are the 2026-09-26 `allowed`
  `rate_limit_event` (F20) verbatim, the rejected turn once captured, and meanwhile F19's
  synthetic assistant line rebuilt from the transcript. That last one must leave the previous
  `contextUsed` standing and report no `<synthetic>` model (F21). Both parsers are pure
  functions today, so the cases need no process.
- `test/agent-fake.test.ts`: a failed turn after real work, whose last message has zero usage.
  The retry ladder and the recovery path must fork the failed session with its real `used`, not
  fall back to a blank session (F21's regression).
- `test/agent-fake.test.ts`: a native double whose retry events carry a stated `resetAt`, so the
  scheduled wait and the down-mark `until` are exercised without a provider.
- The wait-and-probe loop: a fake clock, one known instant, and the assertions that the sleep
  targets the instant plus jitter, that an instant beyond the horizon falls back to
  `recoveryWait`, and that a successful probe still forks the most valuable session.
- `test/quota-windows.test.ts` and `test/agent-fake.test.ts`: the learned-window record (S5) —
  the account key, the horizon, what counts as spent, the clear on success, and the wait that
  sleeps to a recorded reset.
- `test/chain.test.ts` and `test/agent-fake.test.ts`: the provider wordings that state a reset
  (S4a), verbatim from the field (§1.2), including the drops and the precedence.
- Goldens are never regenerated; where a log line must change, the change is stated in the step.
- The classifier's caps, redaction and raise-only merge keep their existing cases; the new
  "headers already stated a reset" case asserts the classifier is not asked.

## 15. Relationship to other designs

- **`plans/0015-session-error-retry-plan.md`** — its rule stands untouched: a session fault never
  exits, whatever the quota. Only the wait's *timing* changes (§6), not its shape or its exit
  behaviour. Its "keep the most valuable session" rule is what F21 silently defeats on the
  claude adapter; §5.2a restores it.
- **`plans/0041-claude-headless-adapter-design.md`** — its C1 already listed `rate_limit_event`
  among the stream's lines; §5.2 is the mapping it never got. Its MA.4 `history: false` stays: the
  transcript served as field evidence (§1.1), never as a driver input.
- **`plans/0014-exit-resume-design.md`** — §6 adds the wait-and-probe loop as a pause boundary
  (F23, §11 item 9).
- **`plans/0017-model-routing-design.md`** — closes open question **U3** (silent-wait takeover)
  through §4.2, and adopts its F17 framing that the class question is about switching, not
  retrying (C7).
- **`plans/0022-session-recovery-fidelity-design.md` §3.5** — its registered complaint (a quota
  error makes new-session retry structurally invalid) is answered by §4.1's third clause and
  §5.2: a terminal limit signal on an agent that does not wait it out escalates at once instead
  of burning the ladder.
- **`plans/0026-session-boundary-hardening-design.md`** — the liveness probe keeps its role; §4.2
  only stops it from judging an expected silence dead.
- **`plans/0027-hibernate-design.md`** — reuses its jitter and its in-process sleep; adds no
  window semantics of its own.
- **`plans/0040-capability-degradation-design.md`** — a policy record is a static adapter fact,
  not a capability flag, so the intersection is unchanged (§4.3).
- **`plans/0055-model-registry-and-tier-routing-design.md`** — retires §10 item 9's deferral
  ("structured reset times on `AgentError` … remains deferred") and §13's `later` row for it;
  keeps the classifier's advisory contract (C3) and narrows when it is asked (§5.3); respects the
  references-never-literals invariant, which is why §9 is deferred.
- **`plans/0016-stuck-loop-design.md`** — orthogonal: a stuck loop is a semantic repeat, a limit
  is a provider refusal. Nothing here changes stuck detection.

<!-- auto: eof -->
