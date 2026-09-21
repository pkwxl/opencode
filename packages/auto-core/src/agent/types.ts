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
// AgentErrorPatterns / AgentClient.errorPatterns.

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
}

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
  // Assistant only: the model that produced it, in the adapter's model-string
  // form (the same form the driver passes back as PromptInput.model).
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

// What an adapter can do. The driver degrades per flag (MA.4); every flag
// maps onto a fallback path that already exists today.
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
}

export type PermissionReply = "once" | "always" | "reject"

// The fourteen calls the driver makes (today spread over attempt.ts,
// watch.ts, session-api.ts, exec-session.ts, interactive.ts).
export interface AgentClient {
  readonly capabilities: AgentCapabilities
  // Extra classifier patterns for this agent's error wording; absent = the
  // neutral patterns only.
  readonly errorPatterns?: AgentErrorPatterns
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
  // The model the agent uses when a prompt names none (display only).
  defaultModel(agent?: string): Promise<string | undefined>
}

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
  close(): void
}
