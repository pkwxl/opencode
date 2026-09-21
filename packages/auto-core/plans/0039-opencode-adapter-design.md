# 0039 opencode adapterization (MA.3): the driver holds an AgentClient

> Milestone MA.3 of `plans/AUTO_NEXT_REFACTOR_PLAN.md` (root). First consumer
> of the MA.1 interface (`plans/0037`) and the MA.2 usage source
> (`plans/0038`), and the first amendment of the frozen interface (0031 D4
> path). A stage-assisting document per D6: it retires as history once MA
> closes.

## 1. Scope

1. **Adapter.** `src/agent/opencode/client.ts` holds `opencodeAgent(sdk)`,
   which implements all 14 AgentClient calls over the SDK client. The
   default-model resolution chain, the `provider/model` split (`splitModel`,
   moved from chain.ts) and opencode's own error names moved here with it.
2. **Host.** `src/server.ts` moved to `src/agent/opencode/server.ts`.
   `manage()` now returns an `AgentHost` whose client is the adapter over the
   proxy SDK client (the proxy still targets the current server instance).
   `syncAgents` is now `syncContext`, and logging is injected.
3. **Driver on the interface.** The driver holds an `AgentClient` wherever
   it used to hold the SDK client: attempt, watch, session, session-api,
   exec-session, execute, interactive, plus the pass-through modules.
   `Opts.server` is `Pick<AgentHost, "syncContext" | "restart">`. No driver
   file imports `@opencode-ai/sdk`.
4. **Unified event stream.** `watch` consumes `AsyncIterable<AgentEvent>`
   and dispatches on the seven event types.
5. **Usage source wired.** watch tracks usage through `usageSource` and
   decides the steer and the test handover with `steerDue` and
   `testHandoverDue`. attempt decides reuse with `reuseAllowed`, execute
   makes the post-session check with `sessionHandoverDue`, and
   seedForkSession applies the fork guard with `forkBaseAllowed`. The
   duplicate predicates in testrun.ts are gone.
6. **Classifier extensible per adapter.** The interface gains
   `AgentErrorPatterns` and an optional `AgentClient.errorPatterns`, and
   `classifySessionError(info, extra)` ORs them in.

## 2. Fact baseline (before → after)

| Before (SDK call) | Site | After |
|---|---|---|
| `session.create` | attempt | `client.create` |
| `event.subscribe` + raw `Event` loop | attempt, watch | `client.events(signal)` → `AgentEvent` loop |
| `session.prompt` with `splitModel(target)` | attempt | `client.prompt({ model: target })`, split in the adapter |
| `session.promptAsync` | watch steer, interactive | `client.promptAsync` |
| `session.abort` ×5 | watch | `client.abort` |
| `question.reply` / `reject`, `permission.reply` ×6 | watch | `replyQuestion` / `rejectQuestion` / `replyPermission` |
| `session.fork` + `session.update` | session-api forkSession | `client.fork` + `client.rename` |
| `session.update` | session-api renameSession | `client.rename` |
| `session.messages` | session-api sessionUsage, exec-session seedPinFork | `client.messages` → `AgentMessage[]` |
| `session.get` | session-api sessionAlive, probeSession | `client.get` |
| `provider.list` | session-api contextLimits (watch, session) | `client.contextLimits()` |
| `app.agents` → `config.get` → `provider.list` | session-api serverDefaultModel | `client.defaultModel()`, with the per-process cache still in the driver |

## 3. Decisions

| # | Decision | Content |
|---|---|---|
| D1 | Tests go through the adapter | The existing suites keep their SDK-shaped fakes and wrap them with `opencodeAgent(...)`; the fixtures also expose the raw `sdk` for tests that patch one surface. Every driver test therefore exercises the real SSE mapping end to end. `test/agent-client.test.ts` pins what goes on the wire. |
| D2 | 0037 D2 alignment item: resolved with no production delta | The SDK v2 client never rejects. It turns fetch exceptions, including the timeoutFetch abort, into `{ error }`, and its SSE generator retries until its signal aborts. So in production a failed create was already `session creation failed: …`, a failed dispatch was already `task dispatch failed: …`, and a subscription never failed. The exception path the item described exists only for test doubles. The adapter maps those rejections to `{ ok: false }`, or to an empty stream for `events`. runSession's catch stays as a safety net. |
| D3 | session-api becomes driver; server moves; one more entry | With its SDK calls gone, session-api is a set of chain and output helpers over AgentClient, so it is reclassified as `driver` and its frozen-import baseline is dropped. server.ts moved into the domain, which also dropped its baseline. The driver has to name one adapter-specific module to construct a host, so `agent/opencode/server` joins `agent/types` in the entry list. A domain file may not import the driver (rule 6), so `log` is injected into `manage` and `timeoutFetch`. |
| D4 | Interface amendment: adapter error wording | The classifier's neutral table keeps quota wording, HTTP statuses and network failures. Agent-specific error type names move to the adapter: `OPENCODE_ERROR_PATTERNS` holds `ContextOverflowError` → overflow and `ProviderAuthError` → auth. Overflow has no neutral pattern. For opencode the classification is unchanged. Without the adapter's table those names are plain text (tested). |
| D5 | Usage wiring, `events` byte-equal | The measurement point stays at a completed assistant message, for every tier. `used` mirrors `source.used()` there and stays 0 while it is unknown, as before. The steer and the test handover read the source through the MA.2 decisions. `steerDue` also requires a live tier, so under `reported` the hint never fires, and `sessionHandoverDue` does not demand the document it was never asked for (the G2 fix, now wired). The fork guard goes through `forkBaseAllowed`. It receives the numeric figure sessionUsage rebuilt, so G1 (an unknown base counts as full) takes effect only for a tier whose rebuild yields undefined, which is MA.4/MA.5 territory. |
| D6 | Display: parts vs. retry | `describePart` takes an `AgentPart`. Notes arrive already rendered by the adapter and get the old two-space indent. The retry line `  ↻ request retry (attempt N)` moved into watch's retry branch, still deduplicated by the part id. Log output is unchanged. |
| D7 | Error merge rules | Both retry signals merge into `errorInfo` field by field. That is the union of what the two old branches merged, and each signal carries only its own fields, so the merged record matches. A session error still folds its error name into the classified message and keeps the pessimistic `isRetryable: false`. |

## 4. Observable deltas (all log-only or double-only)

- A fork-failure log for an SDK-returned transport `Error` now shows its
  message instead of `{}` (`formatClientError`). The steer-dispatch and
  interactive send-failure logs use the same formatting.
- A rejected rename used to be silent and is now logged as a rename failure
  (verbose). It is reachable only with doubles.
- `mapError` keeps only a number `statusCode`, a boolean `isRetryable` and a
  stringified `responseBody`. These are the SDK's own types, so opencode's
  output is unaffected.
- A double that returns no response object at all counts as failure
  (`get` → not alive, as before).

## 5. Carried forward (not changed here)

- **Estimated-tier inputs.** watch feeds steer texts into the usage source,
  but not the inherited start (a reused or forked session) or the initial
  prompt: watch sees neither. They get wired together with the first
  estimated adapter (MA.5), when attempt has a reason to hand them over.
- **0038 §6 U7** ("has output" instead of `used > 0` for retry fork sources)
  and **§6 latent** ("hint sent" instead of re-reading the final figure for
  the post-session check). Both are unchanged, to keep `events` byte-equal.
  They are candidates for MA.4 alongside the capability degradations.
- The failover-restart regex (`NETWORK_FAILURE`, session.ts) stays in the
  driver. It tests the blocked question text and calls `AgentHost.restart`,
  which works for any host.

## 6. Verification

- `test/agent-client.test.ts` (10 cases): prompt shape (agent key always
  sent, model split, no model key without one, signal forwarded),
  promptAsync keys, fork anchor, never-reject in four forms, reply payloads,
  history mapping, contextLimits, capabilities and error names, event
  mapping with drops, subscription failure as an empty stream.
- `test/chain.test.ts`: overflow/auth by opencode names with the adapter
  table; neutral-only behavior; another adapter's extension (+1 case).
- `test/agent-server.test.ts` (moved from server.test.ts): host lifecycle
  through the AgentClient (`get` echoes the instance), `syncContext`, the
  external server, timeoutFetch.
- Import-direction: `server` and `session-api` removed from the agent rows
  and FROZEN_IMPORTS, `session-api` added as driver, `agent/opencode/server`
  added as an agent entry.
- auto-core 987 pass / 0 fail (976 + 10 + 1) and typecheck clean.
  `packages/auto`: 52 pass + 2 skip, typecheck clean. The compiled shell
  binary builds and runs (`--help`, `status`).
