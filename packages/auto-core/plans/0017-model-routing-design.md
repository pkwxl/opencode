# Phase-based model routing and quota failover (Model Routing / Failover) design

Status: implemented (2026-09-10; P1..P6 all landed — switches parsing, runner routing evaluation, error classification,
the failover loop, unit tests and docs; `bun typecheck` clean, `bun test` all green). 2026-09-13 added P7: the manual fallback after the retry ladder
is exhausted, wired into the failover loop (the second trigger surface of D.3), `bun test` 652→657 pass; added P8: failback granularity
`OPENCODE_AUTO_MODEL_FAILBACK_SCOPE` (D.6), the `/failback` command and the runtime model-order override (D.7),
and the model-in-use announcement (D.8), `bun test` 675 pass. P5 automated verification has passed; the real three-package
smoke run awaits an environment with provider credentials (`OPENCODE_AUTO_E2E=1`). The experimental-switch layer
(`OPENCODE_AUTO_MODEL` / `OPENCODE_AUTO_MODEL_FALLBACK` / `OPENCODE_AUTO_MODEL_FAILBACK_SCOPE`),
defaults to unset = zero change to existing behavior, zero changes to the CLI shell, nothing written to disk, nothing entering `ProjectConfig`.
**2026-09-16 revision: the endpoint on candidate exhaustion changes from a blocking exit to the wait-probe loop of plans/0015-session-error-retry-plan.md
"2026-09-16 Correction 3" (probing once every half hour with a brand-new temporary session; once recovered, forking the
interrupted session and resuming it) — D.4's "fallback blocking path (exit code 2)" and invariant F's "with no candidate list,
quota blocks directly" are both superseded as of that point; the switching/fork/window-clamping/note mechanisms are unchanged.**


## A. Motivation

Two kinds of needs within a single run that the existing mechanisms do not cover:

1. **Capability mismatch**: phases differ greatly in the model capability they demand — `a`/`d` (analysis, design) want long context and strong reasoning,
   `m` (migration implementation) wants accurate code rewriting and tool calls, while much of `t`/`v` (testing, acceptance) and `k` (knowledge distillation)
   is judging and writing, for which a cheap model suffices; the decomposition (understand/decompose) and judgment
   (judge/review) sessions on the same task chain are pure throughput. Today the whole pipeline has a single default agent (`auto`) and a single global model,
   with no way to assign by phase/role.
2. **Quota interruption**: on account-level rate limiting or balance exhaustion, the driver's behavior today is to block outright and wait for a human (see B.3),
   yet exactly this failure class has the shape of "switch to a new provider and it keeps going"; with no human present, the whole migration round stalls.

The two share **the same injection point** in implementation: every prompt carries the target model + a routing table of (phase, role) → model.

## B. Factual baseline (read before implementing; line numbers follow auto-core branch HEAD `2f2b20a09` [session-recovery priority layer, implemented 2026-09-10])

### B.1 driver side: the whole pipeline has a single prompt point

`src/runner.ts:2018`'s `client.session.prompt({ sessionID, agent: opts.agent, parts })`
is the only place a prompt is issued (inside `attempt()`); one-shot bypass sessions — verify-judge / review / final / knowledge extraction and the like — go through
`requireArtifact` (defined at runner.ts:1606, forwarding runSession at :1686), taking the same
`runSession` → `attempt` route. So **adding model at this one point
covers every session**, with no per-call-site rework needed.

The SDK surface already supports it: `session.prompt`'s parameters include `model?: { providerID: string; modelID: string }`
(`@opencode-ai/sdk/v2`; see the prompt parameter table in `packages/sdk/js/src/v2/gen/sdk.gen.ts`).

### B.2 server side: carrying model on every prompt is guaranteed to override the pre-existing model

opencode's model resolution priority (`packages/opencode/src/session/prompt.ts:469`, `:646`):

```
input.model (this prompt) > agent.model (.opencode/agent/*.md frontmatter or opencode.json agent.<name>.model)
  > currentModel(sessionID) (session-table model → last user message carrying a model → provider.defaultModel(), prompt.ts:613-633)
```

Moreover, explicitly carrying `input.model` writes the model back to the session table (prompt.ts:675-685), so subsequent prompts on the chain naturally keep using it.
Conclusion: **no need to change opencode.json, and no need to split agent contract files per phase** — both of those routes require a server restart
(project config is cached per instance, `config.ts:600` InstanceState), whereas carrying model on each prompt works equally for reused sessions and
forked sessions.

### B.3 Status quo: the three paths a quota error takes

- **Retryable surface**: in the `session.error` event, `data.isRetryable !== false` → `attempt()` wraps it as
  `会话错误: …` (session error: ...; runner.ts:2070) → `runSession`'s transient-error retry loop (runner.ts:1891) retries from a forked copy
  of the original session (runner.ts:1909-1922); once `RETRIES = 3` (runner.ts:1927) is exhausted, it blocks.
- **Non-retryable surface**: `isRetryable === false` (e.g. `insufficient_quota`,
  `packages/opencode/src/provider/error.ts:117-121`) → blocks directly (runner.ts:1896-1899) →
  `loop.ts` `block()` reverts to pending, **exit code 2**, waiting for a human.
- **Waiting surface**: opencode itself applies **uncapped, non-configurable** backoff to retryable errors
  (`packages/opencode/src/session/retry.ts:175-198`, honoring `retry-after`,
  `RETRY_MAX_DELAY = 2^31-1`). When the quota resets hourly/daily, the server keeps backing off without erroring, and the driver can only
  wait for the `--idle-time` watchdog to pronounce it dead.

Classification info is currently **discarded**: the `session.error` branch of `watch` takes only `data.message`, and `isRetryable` is used only
for the `=== false` check (runner.ts:2365-2379); `statusCode` / `responseBody` / `responseHeaders`
never make it into the `Watch` result.

### B.4 Two ready-made failover signals, currently unused

1. **retry part**: `RetryPart = { type: "retry", attempt, error: ApiError }`
   (`packages/sdk/js/src/v2/gen/types.gen.ts:605-615`) — carrying the full structured `ApiError`. It arrives with
   `message.part.updated`, an event `watch` already handles; `describePart` even already has a printing branch
   (runner.ts:2471), but it **only prints and never reports upward**. This is the cheapest classification surface.
2. **The retry variant of `session.status`**: `{ type: "retry", attempt, message, action?, next }`
   (`types.gen.ts:673-690`), where `next` is the wait duration until the next attempt. `watch` matches only
   `status.type === "idle"` (runner.ts:2380-2385); the retry variant is ignored. This one can turn "still 40 more minutes to wait"
   into an active decision, without having to wait for the idle watchdog.

### B.5 Where the routing keys come from

- Phase letter: `opts.phase` (`"a"|"d"|"m"|"t"|"v"|"k"`, runner.ts:192, passed through by loop, default undefined).
- Execution-chain role: `chain.phase` is the discriminated union of `src/resume.ts:66`
  (`understand` / `decompose` / `whole` / `subtasks` / `wrapup` / `verify:{generate,exec,judge,fix}`
  / `review:{audit,planfix,fixrun}` / `step:{phase-plan,phase-handover}` — the step variants were
  added by the session-recovery priority layer, `StepKind = "phase-plan" | "phase-handover"` at resume.ts:49),
  assigned at runner.ts:345/397, directly readable by `attempt()`.
- Bypass sessions: the chains `requireArtifact` builds (runner.ts:1673-1679) currently carry, only for steps with `spec.step`,
  `chain.phase` (the `step` variants, whose English slug is exactly `StepKind`; the roles of loop.ts:481 phase planning and :572 handover
  distillation can be taken directly); the remaining chains leave `chain.phase` unset and currently have only the Chinese `spec.kind`
  label (runner.ts:1477 review, :1520 script generation, :1551 quality review, :1576 fix planning;
  final.ts:246 final-review task planning; knowledge.ts:61/180 knowledge extraction; implement.ts:44;
  numbering.ts:113 number recovery). → The `requireArtifact` spec needs an English `role` field added (`step` already has one).
- Candidate models' context windows: `contextLimits(client)` already provides the `providerID/modelID → limit.context`
  map (runner.ts:2478), and usage percentages are already computed against each message's real model (runner.ts:1072, :2250).

## C. Design: the routing table and where it takes effect

### C.1 Keys and precedence order

The resolution function `resolveModel(policy, letter, role)`, precedence from finest to coarsest:

```
role (session role) > letter (phase letter) > "*" (catch-all) > undefined (no model carried, status quo)
```

Role slug vocabulary (one-to-one with B.5; fixed for the experimental period; no free-form naming):
`understand` `decompose` `whole` `subtask` `wrapup` `verify-generate` `verify-exec`
`verify-judge` `verify-fix` `review-audit` `review-planfix` `review-fixrun`
`phase-plan` `phase-handover` `final-plan` `knowledge` `prior-knowledge` `implement-scan`
`number-recovery`; a bypass session with no explicit role takes `bypass`.

### C.2 Environment variable format (consistent with the existing conventions of `src/switches.ts`)

- `OPENCODE_AUTO_MODEL`: two shapes.
  - Bare value `prov/model` → full override (equivalent to `*=prov/model`), for "swap the model for this whole run".
  - An entry table of `键=prov/model` (key=prov/model) items, comma-separated, e.g.
    `*=kimi/k2,m=anthropic/c-4,t=kimi/k2-lite,verify-judge=kimi/k2-lite,decompose=anthropic/c-4`。
    keys ∈ {`*`} ∪ {`admtvk`} ∪ the C.1 role vocabulary; the separator is `=` rather than `:` (a model id may contain a colon);
    values must contain `/`; an empty string counts as unset.
- `OPENCODE_AUTO_MODEL_FALLBACK`: a comma-separated, **ordered** candidate list `prov/a,prov/b`; empty by default = no failover.

Illegal values always `throw` a Chinese-language error (including the variable name, an example, and the list of out-of-domain keys), which the CLI side converts to exit code 1 — consistent with the existing
switch philosophy of "fail hard on bad values". Startup logging lists the effective entries via `nonDefaultSwitches` (silent by default).

### C.3 Where it takes effect

`attempt()` (`src/attempt.ts:179`) takes `opts.phase` and `chain.phase`/`chain.role` to resolve the target model,
and passes it, together with `chain.model` (the candidate this chain has already failed over to; see D.4), to `client.session.prompt`'s
`model` field:

```
target model = chain.model ?? resolveModel(policy, opts.phase, roleOf(chain))
```

`chain.model` lives on the chain rather than globally, guaranteeing that failover affects only the session chain that ran into trouble.

## D. Quota failover

### D.1 Classifier (a new pure function, easy to unit-test)

`classifySessionError(structuredErrorInfo) → "quota" | "auth" | "rate" | "overflow" | "transient" | "unknown"`
Input comes from the B.4 retry part `ApiError` (`statusCode`, `responseBody`, `isRetryable`) and
`session.error`'s `data`; the criteria table (deliberately kept different from opencode `retry.ts:31-38`'s RETRYABLE regex
— this one asks "would switching the model help", not "would retrying help"):

| Category | Criteria | Action |
|---|---|---|
| `quota` | `isRetryable === false`; message/response body contains `insufficient_quota`/`quota`/`balance`/`credit`/`usage limit`/`402` | **switch to the next candidate** |
| `auth` | 401/403, `ProviderAuthError` | switch to the next candidate (this provider is unusable) |
| `rate` | 429/`rate limit`/`resource exhausted` plus (retry `attempt >= 3` or `next > 60s`, the latter provided only by the D.2 item-3 event) | switch to the next candidate |
| `overflow` | `ContextOverflowError` | **do not switch** (the handover mechanism handles it; switching to a larger-window model is listed as a section-H follow-up) |
| `transient` / `unknown` | everything else | take the existing retry path, no model switch |

Conservative default: when the classification is uncertain, **do not switch** — the cost of a wrong switch (a whole round running on a weaker model) exceeds the cost of one more attempt.

### D.2 Wiring the three trigger surfaces

1. The `watch` `session.error` branch (`src/watch.ts:401`): besides the existing `message`/`retryable`, carry
   out the structured fields of `data` (`Watch` gains `errorInfo?`; `retryable?: boolean` is a precedent of the same kind).
2. The `watch` `message.part.updated` branch: when `part.type === "retry"`, record
   `{ attempt, statusCode, isRetryable, responseBody }` (taken from `RetryPart.error`; the part itself
   carries no wait duration) and feed it to the classifier; on hitting a `quota|auth|rate` threshold,
   settle the current turn early — **`client.session.abort({ sessionID })` must run before breaking out**, using the same
   technique as the stream-break cleanup (`src/watch.ts:235-238`): the old server-side turn is still running at this moment; left un-aborted, it would concurrently edit files with the
   session forked right after. Return `blocked` with `failover: true`.
3. The `session.status` retry variant: a second signal for the same criteria (still usable when the server emits no retry part),
   additionally providing `next` (the wait duration until the next attempt; the `rate` criterion uses it as a "don't keep waiting if it is still too long" threshold),
   tolerant of it being absent (older servers).

### D.3 The failover action

Inside `runSession`'s retry loop, insert one branch **before** the `result.retryable === false` direct block:
classified as failover-able and the candidate list still has an untried entry → take the next candidate (clamped via D.4) → set `chain.model = 候选` (candidate) →
continue by reusing the existing forked-copy path.

The failover action is collected into a single closure, `switchModel(why)`, **shared by both trigger surfaces**:

| Trigger surface | Classification | Timing |
| --- | --- | --- |
| Quota failover (this design) | `quota` / `auth` / `rate` | immediately, ahead of the ladder (manual adjudication was retired on 2026-09-16) |
| The fallback after the retry ladder is exhausted (wired in 2026-09-13) | `transient` / `unknown` | after the ladder has run (since 2026-09-16 it no longer waits for a human, it falls back directly) |

What the second trigger surface adds is another way out: the ladder is out of moves against transient failures (see
`plans/0015-session-error-retry-plan.md`, "2026-09-12 Correction 2" — upstream degradation is measured in hours, and raising the attempt count only burns
money linearly), whereas switching provider is the only lever outside the ladder not yet tried. When the human clearly answers `exit`, do not fail over: that is
an instruction to "stop", not to "find another way". Branch order is unchanged — the quota/auth/rate classes, as before, ahead of the ladder
still switch the model immediately; this item only adds a way out for transient/unknown.

The fork source uses the same "keep the most valuable session" criteria as the retry loop (the failed session itself and the chain's original session, whichever has the greater
accumulated usage; a pure-error stub with 0 usage does not enter the candidates). The two trigger surfaces see different chain-state shapes, and this criteria set covers both: for the non-
retryable class, `attempt` has already promoted the session into `chain.id`, `chain.failed` is empty, and what gets selected is exactly `chain.id`
(behavior identical to before the wiring); for the retryable class, when it falls back here after the ladder has run, `attempt` has already restored `chain.id` to the original session from before the
prompt was issued, and it is `chain.failed` that actually holds the accumulated context — ignoring it would throw away 100k+ of output to start a blank session.

Context coming along is the payoff here, not an accident: `session.fork` clones the messages one by one
(plans/0003-fork-decompose-design.md:341, "fork only carries messages over; it does not copy agent/model/permission"), and prompt-level
`model` has the highest priority (B.2) — **continuing on a switched model needs no context rebuild**. The log looks like
`⇄ T-001 配额受限,链上下文保留,切换模型 a/x → b/y(候选 2/3)` (T-001 quota-limited, chain context preserved, switching model a/x → b/y, candidate 2/3).

The first prompt after a failover carries, via `chain.note` (a one-shot addendum, `src/attempt.ts:172-173`), the sentence "the model has been
switched; keep following the artifact format and protocol from the earlier context" — the same philosophy as `stuck-hint` backstopping weak models.

### D.4 Candidate clamping and exhaustion

- A candidate whose `limit.context` (B.5) is known and is `< opts.contextLimit` → skip that candidate and log the reason
  (this prevents immediately hitting context overflow / the handover budget right after the failover, which would be worse than the original failure). An unknown limit (tolerating an empty map) is not filtered out.
- Candidates exhausted → **as of 2026-09-16, it drops into the wait-probe loop** (plans/0015-session-error-retry-plan.md, "Correction 3":
  wait indefinitely at the OPENCODE_AUTO_RECOVERY_WAIT interval, default 30 minutes; probe with a brand-new temporary session; after recovery, fork
  the interrupted session and resume it; the wait log lists the already-tried candidates) — the former "fallback blocking path (exit code 2, revert to
  pending)" is retired as of that date.
- Failover counting is separate from the retry ladder: each candidate gets its own full round of the ladder (`i = 1` on switch); the total cap =
  (1 + number of candidates) × ladder length, so the two counters cannot mask each other.

### D.5 No stickiness across chains (default task granularity)

`chain.model` is valid only within its chain: execution chains are newly created per task by `runTask`, so the task boundary resets it naturally; the next task
re-evaluates against the routing table, and the primary model gets retried at every task boundary (the implementation predates this document's wording — chains sit at task level, not
subtask level; subtasks of the same task share the chain, and failover sticks within the task); bypass one-shot sessions
(`requireArtifact`) get a fresh chain per call, so failover never sticks across calls. Rationale: consistent with "phase state is derived,
zero newly added rot-prone state" (the phases.ts header note), and it keeps one blip from permanently degrading the whole round. The cost is that a quota-type
failure re-hits the first prompt on every new chain — an accepted trade-off (see G.4 and U2). Since 2026-09-13
the failback granularity can be adjusted via `OPENCODE_AUTO_MODEL_FAILBACK_SCOPE` (D.6); the default `task` is exactly this section's semantics.

### D.6 Failback granularity (OPENCODE_AUTO_MODEL_FAILBACK_SCOPE, implemented 2026-09-13)

After failing over to a candidate model, at which pipeline boundary the reset back to the preferred model happens — four tiers of **inclusive** granularity (the same
RANK idea as step.ts: the chosen value and all coarser boundaries reset; implementation in `src/failback.ts`):

| Value | Reset at | Implementation mechanism |
|---|---|---|
| `phase` | phase boundary only (failover sticks across tasks) | chains are destroyed per task; the chosen candidate is carried into this phase's subsequent tasks via the failback module's sticky holder (`setSticky`/`stickyModel`); cleared at the phase boundary (loop.ts `clearSticky()`) |
| `task` (default) | task boundary | zero code: per-task chain destruction resets it naturally (= the D.5 status quo) |
| `subtask` | subtask/task/phase boundaries | the subtask boundary (the runner.ts subtask loop, right after `maybeExit`) clears `chain.model` |
| `session` | the start of every new session (task/subtask/hidden-task sessions) | attempt's **fresh-create branch** clears `chain.model`; session reuse and fork consumption do not clear it — clearing the migration session forked out by a failover would immediately undo the failover into oscillation. Bypass/hidden-task chains are created per call anyway and naturally fail back to the preferred model |

The tried-candidate dedup (`tried`) is local state of `runSession`, naturally reset on every session call — after a boundary reset
the whole candidate ring is available again, with no extra cleanup needed. With `reuseSession=on`, session granularity follows the real session boundary
(if the same session is reused, the failover sticks, matching the "reset only on a new session" semantics).

### D.7 The /failback command and the runtime model-order override (implemented 2026-09-13)

A manual-takeover channel isomorphic to `/exit` (plans/0014-exit-resume-design.md), available only on the `--interactive` persistent input line
and not recognized in the waiting-for-answer (pending) state:

- **Setting** (interactive.ts): exact match on `/failback`, or prefix match on `/failback prov/a prov/b ...`;
  each argument is validated to be in `provider/model` form (containing `/`); a bad value logs usage and sets nothing. Nothing is sent to the session,
  regardless of whether a session is connected.
- **Consumption** (three safety boundaries, hook points same as step/exit: the runner.ts subtask boundary, the loop.ts task/phase boundaries,
  right after `maybeExit`): `consumeFailback(chain?)` clears the chain's failed-over candidate and the sticky holder; **it throws no exception and
  occupies no exit-code channel** (unlike `/exit`'s ExitRequested → exit code 3). When pending at the same time as `/exit`,
  exit wins (the process has already ended).
- **With-arguments semantics = redefining the model order wholesale**: the first model becomes the preferred one (a wildcard overriding every letter/role key of the routing table),
  and the rest become the failover candidate ring in order. The override is carried by the failback module's `override` layer (`failbackOverride()`),
  attempt's target evaluation chain becomes `chain.model ?? sticky ?? override.wildcard ?? resolveModel(...)`,
  and switchModel's candidate ring and trigger gate likewise take `override.fallback ?? switches.model.fallback` —
  **the switches memo is not mutated in place** (the constancy convention stays unbroken). The override stays in effect until the process ends or the next /failback with arguments.

### D.8 Announcing the model actually in use to the terminal (implemented 2026-09-13; the 2026-09-18 revisions added the server-default fallback and always announcing on new sessions)

After attempt evaluates the target it announces `◈ <任务> 使用模型 <prov/model>(<来源>)` (task uses model <prov/model> (<source>)), with source ∈
`路由` / `降级候选` / `降级候选·阶段内粘滞` / `/failback 指定` (routing / fallback candidate / fallback candidate·sticky within the phase / specified by /failback); deduped via `chain.modelShown`
 — a continuation prompt on the same chain with the same model is not announced again; a new session or a model change (failover switch, /failback consumption,
granularity reset) triggers a fresh announcement. **2026-09-18 revision**: when target is undefined (neither routing nor override is set), fall back to
announcing the server's effective model (source `服务端缺省` (server default)), resolved in the same order as the server prompt's model fallback chain —
agent-config-level model (/agent) > global config.model (/config) > the first connected provider's default
model (the /provider default table; the server's recently-used model.json is not exposed via the API, so it is skipped),
implemented as session-api's `serverDefaultModel` (cached per agent in-process; silent if nothing resolves at all). Display-
only: the decision of whether the prompt carries a model key is unchanged, and invariant F is not broken. **2026-09-18 revision 2**:
always announcing on new sessions is now actually in place — the earlier implementation deduped only on the model string via `chain.modelShown`, so a new session
(newly created/forked) reusing the old model went unannounced (this section's established "a new session ... announces again" semantics had not landed);
the announce condition is now "a new session (!reuse) or the model has changed since last time"; continuation prompts on the same session with the same model
(reuse/resume takeover) are still not repeated.

## E. Decision record (confirmed)

- **D1 landing spot = the experimental-switch layer**: no new constitutional keys, no touching `opencode.json` or the agent contract files; for the graduation shape see U1.
- **D2 granularity = phase letter + session role, a double key** (role overrides letter), not letters only.
- **D3 carry model on every prompt**: no server restart, no splitting agent contracts.
- **D4 failover = reuse the existing fork retry path**: the context comes along; no new resume mechanism is built.
- **D5 failover state is not persisted** (default): `progress.json` records no model; after cross-process recovery, the routing table is re-evaluated.
- **D6 classifier is conservative by default**: uncertain means no switch; `overflow` explicitly does not switch.
- **D7 failback granularity defaults to `task`** (= zero change from the status quo); the granularity semantics align with step's inclusive RANK; the phase tier's
  cross-task stickiness is carried by the failback module's sticky holder and is not persisted (same as D5).
- **D8 /failback is isomorphic to /exit but does not stop**: consumed at the safety boundaries, throws no exception, occupies no exit code; with arguments = a wholesale
  redefinition of the preferred + candidate order, implemented via the runtime override layer, without breaking the switches-memo constancy convention.
- **D9 the model-in-use announcement goes through the existing log channel**: announced at every prompt evaluation, deduped per chain; when no model is set
  it falls back to announcing the server's effective model (2026-09-18 revision, see D.8), and only stays silent if that too cannot be resolved.

## F. Invariants (the implementation must not break them)

- Exit-code semantics unchanged: `0`/`1` (illegal switch value)/`2` (still failing after candidates are exhausted)/`130`.
- Experimental switches read the environment only and persist nothing; with both variables unset, **behavior is byte-for-byte equivalent to the status quo** (carrying no `model` field,
  rather than carrying `undefined`).
- The constitutional-level project-property list is unchanged (this document adds no `-m/--model` to init/run).
- "Independent-judgment sessions do not fork" is unaffected: routing changes only the `model` parameter, not how sessions are created.
- The driver's exclusive state writes, unified commits, and completion judgments independent of agent self-reports — all orthogonal to model choice; the failover path must not be used to
  write PLAN.md/CURRENT.md.
- The existing `retryable === false` semantics (switching sessions does not help) must keep the original behavior **when there is no candidate list**.
  (Since 2026-09-16 the latter half of this item is superseded: with no candidate list it no longer blocks but goes straight into the wait-probe loop; see the revision in the status paragraph.)
- The retry ladder and manual adjudication (`plans/0015-session-error-retry-plan.md`) must keep the original behavior **when there is no candidate list**:
  the fallback blocks immediately, the copy does not mention failover, no new fork, and the prompt carries no `model`. (Since 2026-09-16 manual adjudication is
  retired and the fallback goes into the wait-probe loop; with no candidate list there is still no failover and the prompt still carries no `model` — these two points are unchanged.)

## G. Risks

1. **Mixed-model context**: history generated by a strong model is continued by a weaker one; checklist format / protocol adherence may drift.
   Mitigation: note injection (D.3), the vocabulary allows configuring only the necessary entries, and by default nothing is mixed.
2. **Quota wording is not portable**: the classifier depends on provider reports; a new provider with different wording slips past. Mitigation: a missed
   classification merely results in the status-quo block (acceptable); the regex table lives in one place and evolves with pinned samples in unit tests.
3. **Event-surface drift**: the retry part / the `session.status` retry variant may change across server versions.
   Mitigation: the two signals back each other up, and both tolerate absence (the same fault-tolerance philosophy as `contextLimits`).
4. **The primary model is re-hit on every new chain** (the D.5 trade-off): when quota is exhausted, one extra failed round per task boundary. If the measured cost
   proves too high, go with U2's tmp/ recording scheme instead of changing the contract.

## H. Implementation steps (checklist)

| Step | Content | Files | Verification |
|---|---|---|---|
| P1 | `SWITCH_ENV` gains `model` / `modelFallback`; `parseSwitches` parses the two C.2 shapes and normalizes into `ModelPolicy`; registered in `nonDefaultSwitches` / `formatSwitches`; illegal values raise a Chinese error | `src/switches.ts` | `bun test test/switches.test.ts` (add five case classes: empty / bare value / entry table / out-of-domain key / value missing `/`) |
| P2 | Routing pure functions `resolveModel(policy, letter, role)` and `roleOf(chain)`; `SessionChain` gains `role?` / `model?`; the `requireArtifact` spec gains an English `role`, filled in at the call sites (of the 11 sites in the B.5 list, loop.ts phase-planning/handover-distillation can already take the English slug via `spec.step`'s `StepKind` with `roleOf` mapping the `step` variants, so `role` must be added at 9 sites); `attempt()` passes `model` | `src/runner.ts` (+ `src/resume.ts` if role slugs require it) | `bun test test/runner.test.ts` (the fake client asserts the `model` received by prompt; with no switch set, assert the arguments contain **no** `model` key) |
| P3 | Classifier `classifySessionError` + `Watch.errorInfo` / retry part recording / the `session.status` retry second signal | `src/runner.ts` | Unit tests: pinned report samples → category; unknown report → `unknown` |
| P4 | The `runSession` failover branch (D.3) + candidate window clamping and exhaustion (D.4) + the failover note (D.3) | `src/runner.ts` | Unit tests: quota non-retryable + two candidates → the second prompt carries the candidate model with context from the fork; candidates exhausted → still `blocked` |
| P5 | Real smoke run (all three packages in the `auto/` worktree): set `OPENCODE_AUTO_MODEL` and run one short migrate flow, checking the `⇄`/percentage logs and re-baselining; deliberately misconfigure a provider key to trigger an `auth` failover | `auto/` | See the smoke-run conventions in docs/behavior.md; typecheck + three-package tests |
| P6 | Docs: the AGENTS.md navigation row was added with this document; after implementation, change this document's status to "implemented (P1..P5)" and add the switch and failover sections to `docs/structure.md` / `docs/behavior.md` | `docs/`, `AGENTS.md` | Manual review |
| P7 | The manual fallback after retry-ladder exhaustion is wired into the failover loop (the D.3 second trigger surface): the failover action becomes the `switchModel()` closure, and the fork source switches to the same "most valuable session" criteria as the retry loop | `src/runner.ts`, `test/runner.test.ts` | Unit tests: transient exhausts the ladder → switch candidate and restart a round; a manual `exit` answer does not fail over; candidates exhausted → still `blocked` with the list shown; with no candidate list, byte-for-byte equivalent (invariant F) |
| P8 | Failback granularity `OPENCODE_AUTO_MODEL_FAILBACK_SCOPE` (D.6) + the `/failback` command and the runtime model-order override (D.7) + the model-in-use announcement (D.8) | `src/switches.ts`, `src/failback.ts` (new), `src/runner.ts`, `src/loop.ts`, `src/interactive.ts` | Unit tests: switches value domain/bad values/log registration; failback module state and RANK; interactive `/failback` parsing; the runner's task/session/phase three-tier failback and override failover (675 all green) |
| Follow-up | `overflow` → a failover route to a larger-window model (the category is already reserved in B.4/D.1); graduation to a constitutional key (U1) | — | A separate design document |

## I. Open questions

- **U1 graduation shape**: once the experiment settles, whether `modelRouting` (phase/role → model) and `modelFallback` (ordered candidates)
  enter `.opencode/auto/config.json` as constitutional keys (init-only, manual editing as the revision channel)? Leaning yes,
  because "which model for which phase" is a project property that should be versioned and shared with the repo; at graduation you must update in sync the usage text of both shells and
  `test/config.test.ts`。
- **U2 whether failover is persisted**: the alternative to the D.5 trade-off records this run's failover state as one entry under `tmp/` (non-versioned,
  written by the driver), carried across chains until the process ends. To be decided once P5 smoke data exists.
- **U3 taking over during the silent wait**: D.2 item 2 settled on "abort first, then settle, before failing over". What is still open is another kind of scene —
  the server side keeps backing off, producing neither `session.error` nor any retry signal for a long time (the session is simply idle), and the driver
  can only wait for the `--idle-time` watchdog; whether to introduce a shorter dedicated wait window for this shape, or to also attempt a failover at watchdog timeout
  (instead of today's direct block).
- **U4 role-vocabulary stability**: whether the vocabulary's maintenance cost rises as the `stage` enum grows; whether to converge on
  the two mutually exclusive rules "execution chains by letter, bypass by role".
