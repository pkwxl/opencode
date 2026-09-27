// Agent domain — frozen interface (D8; root plans/AUTO_NEXT_REFACTOR_PLAN.md
// MA.1, design plans/0037). The driver talks to a coding agent (opencode
// today; claude headless next, D5) only through AgentClient: fourteen calls,
// a capability record, and one normalized event vocabulary. Adapters own
// everything transport-shaped — the opencode server's SSE + synchronous POST
// dual channel, request timeouts, the "provider/model" split, a CLI
// subprocess's stdout stream — so none of it leaks into the driver (F12).
//
// Self-contained on purpose: a physically-placed provider domain may not
// import the driver domain (import-direction rule 6), so shapes the driver
// also has (token usage, error info) are restated here structurally.
//
// Frozen in MA.1 and wired in MA.3 (plans/0039): the opencode adapter lives
// in agent/opencode/; the driver holds an AgentClient everywhere it used to
// hold the SDK client. MA.3 amended this file once, consciously (0031 D4):
// AgentErrorPatterns / AgentClient.errorPatterns. MA.4 (plans/0040) amended
// it again: PermissionPreset / AgentHostOptions / AgentHostFactory, the path a
// permission policy takes into an agent that has no permission events. The
// model registry (plans/0055 §4.2, §8.1, F14) amended it a third time:
// AgentHostOptions.bin / env / config, the agent profile a host starts with —
// its executable, the overlay on its processes' environment, and (opencode)
// the config content its managed server is spawned with. Selection (0055
// §4.2, §12) amended it a fourth time, consciously: PromptInput.variant, the
// per-prompt reasoning-effort variant a registry model entry may declare —
// opencode carries it in the v2 prompt body next to the model; adapters that
// cannot apply a variant reject the field at registry load, so the driver
// never has to. AgentClient's calls are unchanged. The key rings (0055 §4.3)
// amended it a fifth time: AgentHost.setConfig. The failure-message
// classifier (0055 §7.1, F18) amended it a sixth time, consciously:
// PromptInput.bare, a prompt that denies every tool — opencode carries it as
// the v2 body's `tools: {"*": false}`; only opencode sessions ever receive it
// (the registry accepts classifier entries on opencode profiles only). Session
// exceptions (plans/0057 §4, S2) amended it a seventh time, consciously:
// AgentRetryPolicy / AgentClient.retryPolicy, what the agent does on its own
// when a provider request fails, so the driver consults a declared record
// instead of guessing the agent's behaviour from the shape of one error. The
// same amendment grew in S3 (0057 §5): AgentError's limit fields (retryAfterMs,
// resetAt, scope, limitReason) — what the provider or the agent stated about
// the limit behind a failure — and the `limit` event, the agent's view of the
// provider's usage windows on healthy turns too.

// Every call resolves; none rejects. A failure the agent reports and a
// transport failure (network error, timeout, abort via signal) both arrive as
// { ok: false }; `error` is whatever the adapter observed (an Error instance
// for transport failures, the agent's structured error body otherwise).
export type AgentResult<T = void> = { ok: true; value: T } | { ok: false; error: unknown }

// Token accounting of one model step (the unit the driver bills; summing
// steps is the only double-count-free total, see stats.ts). Mirrors the
// driver's Usage minus its aggregate fields.
export type AgentTokens = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

// Structured error signal, normalized from whatever the agent emits. Every
// field is optional: signals arrive piecemeal and the driver merges them
// before classifying (chain.ts classifySessionError).
export type AgentError = {
  // Error type name (e.g. "APIError", "ContextOverflowError"); the classifier
  // keys some classes on it.
  name?: string
  message?: string
  statusCode?: number
  // Present only when the agent states it; absent means "not stated", which
  // the driver treats as retryable (plans/0015).
  isRetryable?: boolean
  responseBody?: string
  // The limit fields (plans/0057 §5): each absent when neither the provider
  // nor the agent stated it — the failure-message classifier may then still
  // read a reset from the wording (0055 §7.1). A stated value outranks the
  // classifier's.
  // The provider's stated wait before a retry may succeed (retry-after).
  retryAfterMs?: number
  // The instant the limit resets, epoch ms: a rate-limit header's reset
  // value, claude's rate_limit_event, or a stated wait counted from the
  // moment it arrived.
  resetAt?: number
  // Which limit the reset belongs to, so a per-minute cap and a weekly quota
  // are not waited out the same way (0057 §7).
  scope?: LimitScope
  // The provider's or agent's own machine-readable limit reason: opencode's
  // retry action.reason, claude's rateLimitType (with its
  // overageDisabledReason, `five_hour/out_of_credits`).
  limitReason?: string
}

// The limit a stated reset belongs to: a per-minute request or token cap, a
// rolling five-hour window, a weekly or a daily quota; unknown = a reset was
// stated for a limit the statement does not name.
export type LimitScope = "request" | "token" | "5h" | "7d" | "day" | "unknown"

// One usage window of the provider's account, as the agent reports it (the
// `limit` event). `utilization` is the used share (0.4 = 40 %), absent when
// the agent did not state it.
export type LimitWindow = { scope: "5h" | "7d"; resetAt: number; utilization?: number }

// Agent-specific wording for the driver's error classes (chain.ts
// classifySessionError). The classifier keeps provider-neutral patterns (quota
// wording, HTTP statuses, network failures); an adapter adds what only its
// agent says — typically its own error type names (opencode:
// ContextOverflowError, ProviderAuthError). Each pattern is tested against the
// merged message + response body, like the neutral ones.
export type AgentErrorPatterns = {
  overflow?: RegExp
  quota?: RegExp
  auth?: RegExp
  rate?: RegExp
  transient?: RegExp
}

// What the agent does on its own when a provider request fails (plans/0057
// §4): static per adapter, read from the agent's own retry code, and
// overridable per registry model entry (a profile's environment can change
// it, e.g. claude's CLAUDE_CODE_MAX_RETRIES). The driver consults it where it
// used to infer the agent's behaviour from two constants (chain.ts
// agentGaveUp); an adapter without one gets the driver's neutral record,
// which is exactly those constants.
export type AgentRetryPolicy = {
  // The agent's own attempt cap; undefined = it retries as long as the error
  // stays retryable (opencode: SessionRetry.policy has no cap).
  maxAttempts?: number
  // The longest wait between attempts the agent chooses by itself. A stated
  // wait above it did not come from the agent's own backoff: the provider
  // named it, or the backoff has grown past anything a short throttle needs,
  // so the agent will not cure the failure sooner than that wait.
  backoffCapMs: number
  // The agent honours a provider-stated wait (retry-after) and stays silent
  // for that long: no error, only the retry signal that announced it.
  honorsRetryAfter: boolean
  // The agent waits out a spent quota window by itself, in the mode the
  // driver runs it. False: a limit ends the turn (claude headless, 0057 F19),
  // so a terminal limit signal is final — waiting on the agent cures nothing.
  waitsOutLimit: boolean
  // The silence the driver takes in its stride while the agent backs off. A
  // retry that names a longer wait (with honorsRetryAfter) is an announced
  // silence: the driver logs it with its end, and its liveness watchdog does
  // not judge the session dead before that end (0057 §4.2).
  silenceBudgetMs: number
}

// The pieces of an assistant turn, as far as the driver needs them.
// `id` is stable across updates of the same piece: adapters may deliver a
// piece more than once (opencode re-sends a part on every update), and
// consumers deduplicate by id (billing, display, stuck detection).
export type AgentPart =
  // Assistant prose; `final` once the piece stops growing. The last final
  // text of a turn is the session's closing words (lastText).
  | { kind: "text"; id: string; text: string; final: boolean }
  | { kind: "reasoning"; id: string; text: string; final: boolean }
  // Tool call. Only terminal states (completed/error) carry results; the
  // stuck detector observes those.
  | {
      kind: "tool"
      id: string
      tool: string
      status: "pending" | "running" | "completed" | "error"
      input?: Record<string, unknown>
      // completed: tool output and the tool's own one-line title.
      output?: string
      title?: string
      // error: the error text.
      error?: string
    }
  | { kind: "step-start"; id: string }
  // End of one model step: the billing unit. `reason` is the model's finish
  // reason; "length" means the output limit truncated the reply (watch.ts
  // resumes it instead of treating the turn as finished).
  | { kind: "step-finish"; id: string; reason: string; tokens: AgentTokens; cost: number }
  // Display-only pieces with no driver semantics (opencode: file, subtask,
  // agent, patch, snapshot, compaction). The adapter renders `text`, a
  // one-line human-readable summary; the driver only logs it.
  | { kind: "note"; id: string; text: string }

// A message of a session, as the driver sees it (events and history alike).
export type AgentMessage = {
  id: string
  role: "user" | "assistant"
  // Assistant only: the message finished (no further updates will change it).
  completed: boolean
  // The model behind this message, in the adapter's model-string form (the
  // same form the driver passes back as PromptInput.model). Assistant: the
  // model that produced it. User: the model the agent resolved for the turn
  // it opens — the driver's "actually used" display reads it from here.
  model?: string
  // Assistant only: tokens occupying the context window after this message,
  // by the adapter's own measure; absent when it cannot measure. Feeds reuse,
  // steer, test-handover and failover-window decisions (their behavior per
  // usage tier is MA.2's matrix).
  contextUsed?: number
  // The message ended in an error (a provider error stub is such a message).
  failed: boolean
}

// The unified event vocabulary. Every event names its session; a
// subscription carries all sessions of the client and consumers filter.
// Adapters drop whatever has no counterpart here.
export type AgentEvent =
  // A turn piece was created or updated.
  | { type: "part"; session: string; part: AgentPart }
  // A message was created or updated (usage and model become known here).
  | { type: "message"; session: string; message: AgentMessage }
  // The agent asks the human; answer with replyQuestion/rejectQuestion using
  // `request`. `questions` holds the question texts in order.
  | { type: "question"; session: string; request: string; questions: string[] }
  // The agent requests a permission; answer with replyPermission.
  | { type: "permission"; session: string; request: string; permission: string; patterns: string[] }
  // The turn failed. More than one may arrive; consumers merge them.
  | { type: "error"; session: string; error: AgentError }
  // The agent is retrying a failed provider request on its own. `id` is set
  // when the signal is a turn piece (dedupe/display key, as for parts);
  // `next` is the wait in ms before the next attempt, when stated.
  | { type: "retry"; session: string; id?: string; attempt?: number; next?: number; error: AgentError }
  // The agent's view of the provider's usage windows (claude:
  // rate_limit_event), sent when it changes: on healthy turns too, and never
  // an error by itself — a turn that fails on a rejected window carries the
  // window in its error event (plans/0057 §5.2). `warning` = still allowed,
  // near the limit.
  | { type: "limit"; session: string; status: "allowed" | "warning" | "rejected"; windows: LimitWindow[] }
  // The turn ended and the session waits for input. At-least-once per turn:
  // opencode emits it twice (session.status idle + session.idle), so
  // consumers settle once and ignore further idles until the session shows
  // other activity. A stream that ends without idle is a transport loss.
  | { type: "idle"; session: string }

// Where token usage comes from (MA.2 defines each tier's behavior matrix for
// reuse / steer / test handover / failover window; plan open question 5):
// events = per-step tokens in the event stream; reported = the CLI reports
// totals at turn end; estimated = the driver estimates conservatively;
// none = nothing is known and the driver assumes a full context.
export type UsageTier = "events" | "reported" | "estimated" | "none"

// What an adapter can do. The driver degrades per flag (MA.4, src/capability.ts
// and plans/0040); every flag maps onto a fallback path that already exists.
export type AgentCapabilities = {
  // Sessions persist by id and accept further prompts (reuse, interruption
  // recovery). Off: every prompt starts a new session.
  resume: boolean
  // Fork granularity. "message" = copy a session up to a given message (the
  // test-handover pin anchor); "session" = copy the whole session only;
  // "none" = callers fall back to a new session with the full prompt (the
  // existing fork-failure path).
  fork: "none" | "session" | "message"
  // promptAsync can inject text into a live session while the driver keeps
  // observing it (handover hint, test results, stuck hint, length resume,
  // --interactive lines).
  steer: boolean
  // A running turn can be stopped.
  abort: boolean
  // The agent can ask questions (question events). Off: ask=off tier.
  question: boolean
  // The agent can request permissions (permission events). Off: permissions
  // are fixed up front (always allow, or the blocked tier).
  permission: boolean
  // messages() returns a session's history (usage rebuild on resume, pin
  // anchors for handover forks).
  history: boolean
  usage: UsageTier
}

export type PromptInput = {
  session: string
  text: string
  // Adapter-specific agent/profile name (opencode: the .opencode/agent/<name>.md
  // contract); absent = the adapter's default.
  agent?: string
  // Adapter model string (opencode "provider/model"); absent = the agent's
  // own default — the prompt then carries no model at all (routing
  // invariant, plans/0017).
  model?: string
  // A per-prompt model variant (opencode: the v2 prompt body's `variant`,
  // e.g. a reasoning-effort variant; plans/0055 §4.2). Absent = the model's
  // default variant. Only a registry model entry with `model` may carry one
  // (the loader rejects `variant` without `model`, and on adapters that
  // cannot apply it), so a prompt without a model never carries a variant.
  variant?: string
  // Deny every tool for this prompt's turn: the failure-message classifier's
  // one-shot session (plans/0055 §7.1) reads provider error text with no tool
  // at all, so instructions hidden in that text can do no more than produce
  // a wrong class. opencode: the v2 prompt body's `tools: {"*": false}`,
  // which the server turns into a deny-all permission rule on the session and
  // strips every tool from the provider request (0055 §7.1 records the
  // check). Only an adapter with a verified tool-less mode may accept it; the
  // claude adapter refuses a bare prompt instead of running it with tools.
  // Absent = the session's tools as its agent and permissions define them.
  bare?: boolean
}

export type PermissionReply = "once" | "always" | "reject"

// The thirteen calls the driver makes (today spread over attempt.ts,
// watch.ts, session-api.ts, exec-session.ts, interactive.ts).
export interface AgentClient {
  readonly capabilities: AgentCapabilities
  // Extra classifier patterns for this agent's error wording; absent = the
  // neutral patterns only.
  readonly errorPatterns?: AgentErrorPatterns
  // What the agent does on its own when a provider request fails; absent =
  // the driver's neutral record (the rate threshold of plans/0017 F17).
  readonly retryPolicy?: AgentRetryPolicy
  // New session titled `title`.
  create(input: { title: string }): Promise<AgentResult<{ id: string }>>
  // Dispatches a prompt. Resolution timing is the adapter's business (opencode
  // resolves at turn end, a CLI adapter may resolve once the prompt is handed
  // over): consumers read the outcome of the turn from the event stream,
  // never from this result, which only says whether dispatch failed. `signal`
  // withdraws an in-flight dispatch (the driver aborts it when the event
  // stream has already failed the turn).
  prompt(input: PromptInput, signal?: AbortSignal): Promise<AgentResult>
  // Injects text into a live session and returns at once (requires steer).
  promptAsync(input: PromptInput): Promise<AgentResult>
  abort(session: string): Promise<AgentResult>
  // Copies `session` into a new session. With `before`, only the messages
  // preceding that message id are copied (requires fork "message").
  fork(session: string, before?: string): Promise<AgentResult<{ id: string }>>
  rename(session: string, title: string): Promise<AgentResult>
  // The session's messages, oldest first (requires history).
  messages(session: string): Promise<AgentResult<AgentMessage[]>>
  // Whether the session exists and the agent answers for it: the resume
  // check and the in-flight liveness probe (a fresh request, so a half-open
  // old connection does not mask a live agent).
  get(session: string): Promise<AgentResult<{ id: string }>>
  // Subscribes to events until `signal` aborts. Subscribe before prompting:
  // events emitted after this resolves are delivered. The stream ends only on
  // abort or transport loss; a subscription that cannot be established ends
  // immediately, which consumers already treat as transport loss.
  events(signal: AbortSignal): Promise<AsyncIterable<AgentEvent>>
  // One answer list per question, in question order.
  replyQuestion(request: string, answers: string[][]): Promise<AgentResult>
  rejectQuestion(request: string): Promise<AgentResult>
  replyPermission(request: string, reply: PermissionReply): Promise<AgentResult>
  // Context window size by model string; empty when unknown (usage lines then
  // show absolute tokens only and the share counts as 100%).
  contextLimits(): Promise<ReadonlyMap<string, number>>
}

// How an agent without permission events (`capabilities.permission` false)
// settles permission requests on its own, fixed when the host starts (MA.4,
// plans/0040; the driver derives it from --permission): allow = grant
// everything; deny = refuse and let the session go on without it; block =
// refuse and end the turn with a non-retryable error, so the run blocks for a
// human. Adapters with permission events ignore it — the driver answers each
// request itself.
export type PermissionPreset = "allow" | "deny" | "block"

// An overlay on the driver's environment for an agent's processes: a string
// sets the variable, null removes an inherited one. Values are already
// resolved (the driver reads `{env:…}` / `{file:…}` references just before the
// host starts) and may be secrets, such as a proxy URL with credentials: a
// host passes them to its child processes only, and never logs or writes them.
// Log lines name the variables.
export type AgentEnv = Readonly<Record<string, string | null>>

export type AgentHostOptions = {
  // An already running instance to connect to instead of starting one
  // (opencode: --server <url>); absent = the adapter starts its own.
  server?: string
  permission: PermissionPreset
  log: (line: string) => void
  // The executable; absent = the adapter's own ("opencode", "claude").
  bin?: string
  // Overlay on the driver's environment for every process the host starts;
  // absent = the driver's environment as it is. A host that connects to an
  // already running instance cannot apply it, and says so in its log.
  env?: AgentEnv
  // opencode: the config content the managed server is spawned with
  // (OPENCODE_CONFIG_CONTENT; opencode merges it over the project's
  // opencode.json and substitutes its `{env:…}` / `{file:…}` references
  // itself); absent = {}. Other adapters ignore it.
  config?: Readonly<Record<string, unknown>>
}

// Starts (or connects) the agent behind a run. A shell selects its agent by
// handing one to setShellProfile (src/shell.ts `agent`); absent = opencode.
export type AgentHostFactory = (directory: string, options: AgentHostOptions) => Promise<AgentHost>

// Lifecycle of the process behind a client (opencode: a spawned or reused
// server, src/server.ts; claude: a subprocess manager, MA.5).
export interface AgentHost {
  // Stays valid across restart(): calls go to the current instance.
  readonly client: AgentClient
  // Called before each new session: make sure it sees the current contract
  // files (opencode restarts its server when AGENTS.md changed; an agent that
  // rereads them per session does nothing).
  syncContext(): Promise<void>
  // Replace the running instance; false when the adapter does not manage it
  // (an external server).
  restart(reason: string): Promise<boolean>
  // Replaces the config content the next spawn uses (opencode only; key
  // rings rotate the provider apiKey this way, plans/0055 §4.3). Absent on
  // hosts that never spawn with driver-supplied config — rotation is simply
  // not available for them, and the caller falls back to model failover.
  // The fifth conscious amendment of this frozen file (0055 §12).
  // AUTO-DECISION: setConfig rides the AgentHost interface as an optional method instead of the driver feature-detecting the opencode host (the session layer must not import an adapter module — that would pull the SDK into its import graph — and an optional method states the capability the same way AgentCapabilities does)
  setConfig?(config: Readonly<Record<string, unknown>> | undefined): void
  close(): void
}
