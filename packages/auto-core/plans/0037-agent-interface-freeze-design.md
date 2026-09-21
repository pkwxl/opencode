# 0037 Agent interface freeze (MA.1): AgentClient, capabilities, unified event vocabulary

> Milestone MA.1 of `plans/AUTO_NEXT_REFACTOR_PLAN.md` (root), implementing
> D5 (claude headless as the first second adapter) and D8 (interface-first
> domains) for the agent domain. Stage-assisting document per D6: retires as
> history once MA closes. Fact baseline = root plan §2.4 (not repeated here,
> F15).

## 1. Scope

1. **Frozen interface** — `src/agent/types.ts`: `AgentClient` (14 calls),
   `AgentCapabilities`, `AgentEvent` / `AgentPart` / `AgentMessage` /
   `AgentError` / `AgentTokens`, `UsageTier`, `PromptInput`,
   `PermissionReply`, `AgentResult`, and `AgentHost` (lifecycle).
2. **opencode → unified event mapping table** — executable:
   `src/agent/opencode/events.ts` (`mapEvent`, `mapMessage`), one pure
   function per event, tested row by row. The table also heads that file.
3. **Transport concurrency ownership moves to adapters (F12)** — expressed
   in the contract of `prompt()` (see D3).
4. **F17a** — `packages/auto` dropped its unused `@opencode-ai/sdk`
   dependency (no import anywhere in the shell; the SDK reaches the binary
   through `@opencode-ai/auto-core`'s own dependency).

Nothing is wired: no driver module imports the new files yet. The first
consumer is MA.3 (0031 D4 path: the first real consumer may amend the frozen
shape as a conscious architecture event).

## 2. Decisions

| # | Decision | Content |
|---|---|---|
| D1 | Self-contained domain | `agent/types.ts` imports nothing from src/. Import-direction rule 6 forbids a physically-placed provider domain from importing driver (type-only edges included), so shapes the driver also has are restated structurally: `AgentTokens` ≅ `stats.ts Usage` minus aggregates, `AgentError` ≅ `chain.ts ErrorInfo` minus `attempt`/`next` (those travel on the `retry` event). |
| D2 | Never reject | Every call resolves `{ ok: true; value } \| { ok: false; error }`. Agent-reported failures and transport failures (timeout, network, abort) look the same; `error` stays `unknown` so `formatClientError` keeps working unchanged. `events()` never rejects either: a subscription that cannot be established is an empty stream, which watch already reads as transport loss (retryable). **MA.3 alignment item**: today a rejected `session.create` or `event.subscribe` escapes `attempt` as an exception; under D2 they become a blocked result / a retryable stream loss. MA.3 either accepts that delta consciously or preserves the old path. |
| D3 | Two observation surfaces (F12) | `prompt()` is *dispatch*: its resolution timing belongs to the adapter (opencode resolves at turn end because of its synchronous POST; a CLI adapter may resolve once the prompt is handed over). The outcome of the turn is read only from the event stream (`idle` / `error` / stream end). What stays opencode-only inside its adapter: the 2 h POST timeout special case, the connection-pool concern, the requirement that SSE is subscribed before the POST. The generic race in `attempt` (watch fails first → withdraw the dispatch via `signal`) remains valid for any adapter. |
| D4 | One `retry` event | opencode's two retry signals (retry part; `session.status` retry) map to one `retry` event: the driver already handles them identically (merge into the error record, classify, fail over early on quota/auth/rate). `id` is set when the signal was a part (dedupe and the verbose `↻ request retry` line). |
| D5 | `idle` is at-least-once | opencode emits two idles per turn. The adapter does not collapse them (collapsing needs turn state that watch already keeps in `idleHandled`); the contract says consumers settle once and ignore further idles until other activity. `session.status` busy is dropped, matching today (busy never reset `idleHandled`). |
| D6 | Display-only parts become `note` | file / subtask / agent / patch / snapshot / compaction have no driver semantics. The adapter renders their one-line text (identical to today's `describePart` output minus the indent), so the vocabulary does not grow per agent. Parts with semantics (text, reasoning, tool, step-start, step-finish) stay structured. |
| D7 | Usage in the vocabulary, semantics in MA.2 | `AgentMessage.contextUsed` is "tokens occupying the context window by the adapter's own measure" (opencode: `input + cache.read` of the latest message, as watch computes today); `step-finish` carries billing tokens. `AgentCapabilities.usage` freezes the four tier names the plan already fixed for MA.2 (`events` / `reported` / `estimated` / `none`); what reuse / steer / test handover / failover window do per tier is MA.2's matrix. |
| D8 | Capabilities are graded where the agents differ | The draft's six booleans became eight fields: `fork` is `"none" \| "session" \| "message"` (claude can fork a whole session on resume but has no message anchor, which the handover pin fork needs), and `resume` / `history` are separate flags (root §2.4 assumption ①: persistent ids, readable history). Each flag maps onto a fallback that already exists (MA.4 wires them). |
| D9 | Model and agent strings are opaque | `PromptInput.model` is the adapter's model string; `splitModel` ("provider/model") moves into the opencode adapter in MA.3. An absent model means the prompt carries none (routing invariant, 0017). `agent` is adapter-specific (opencode's `.opencode/agent/<name>.md`). |
| D10 | Lifecycle is a separate interface | `AgentHost` { client, syncContext, restart, close } generalizes `server.ts` `ServerHandle`/`ServerControl`: `syncAgents` is renamed `syncContext` (an agent that rereads contract files per session implements it as a no-op). `url` is not part of it (no driver consumer). |
| D11 | Published entry unchanged | `agent/types` was already the agent domain's entry in the import-direction suite; `agent/opencode/events` stays internal to the domain (only the adapter and its tests import it). No table edit. |

## 3. Call mapping (the 14 calls → today's call sites)

| AgentClient | opencode SDK today | Call sites |
|---|---|---|
| `create` | `session.create` | attempt.ts |
| `prompt` | `session.prompt` | attempt.ts |
| `promptAsync` | `session.promptAsync` | watch.ts (steer), interactive.ts |
| `abort` | `session.abort` | watch.ts ×5 |
| `fork` | `session.fork` (+ rename) | session-api.ts forkSession |
| `rename` | `session.update` | session-api.ts renameSession, forkSession |
| `messages` | `session.messages` | session-api.ts sessionUsage, exec-session.ts seedPinFork |
| `get` | `session.get` | session-api.ts sessionAlive, probeSession |
| `events` | `event.subscribe` | attempt.ts |
| `replyQuestion` / `rejectQuestion` | `question.reply` / `question.reject` | watch.ts |
| `replyPermission` | `permission.reply` | watch.ts ×6 |
| `contextLimits` | `provider.list` | session-api.ts |
| `defaultModel` | `app.agents` → `config.get` → `provider.list` | session-api.ts serverDefaultModel |

Event mapping: see the table heading `src/agent/opencode/events.ts`.

## 4. Capability values (expected)

| Flag | opencode | claude headless (to confirm in MA.5) |
|---|---|---|
| resume | true | true (`--resume`) |
| fork | message | session (`--resume --fork-session`), no anchor |
| steer | true | false (single stdout stream per process) |
| abort | true | true (kill the process) |
| question | true | false |
| permission | true | false (`--permission-mode` fixed up front) |
| history | true | open (session transcript files) |
| usage | events | reported or estimated (open question 5, MA.5) |

## 5. Non-goals

- Moving any call site onto the interface, the adapter itself, and
  per-adapter `classifySessionError` patterns → MA.3.
- The usage-tier behavior matrix → MA.2. Degradation wiring → MA.4.
- Contract-file placement across agents (open question 7) → MA.5.

## 6. Verification

- `test/agent-events.test.ts`: 10 cases — every mapping row (text,
  tool terminal/non-terminal, step-finish, notes, both retry signals incl.
  field-less legacy status, message.updated incl. failed/user, question,
  permission, session.error incl. the dropped forms, both idles, busy and
  unrelated events dropped) + a fake `AgentClient` built without SDK types.
- The mapper compiles against the SDK's `Event`/`Part`/`Message` unions, so
  a renamed SDK field fails typecheck.
- auto-core 964 pass / 0 fail (954 + 10) + typecheck clean; import-direction
  suite green with no table edit; packages/auto 54 pass (52 + 2 skip) +
  typecheck clean after F17a; `bun install --frozen-lockfile` accepts the
  edited lockfile; a compiled shell binary builds and runs.
