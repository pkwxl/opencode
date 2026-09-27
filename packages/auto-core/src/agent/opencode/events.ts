// opencode SSE → unified AgentEvent mapping (MA.1, design plans/0037 §3). A
// pure function per event so the table is testable on its own; the adapter
// (MA.3) applies it to the SSE stream and watch.ts consumes the result.
//
// | opencode event                          | AgentEvent                   |
// |-----------------------------------------|------------------------------|
// | message.part.updated (part.type retry)  | retry (with id)              |
// | message.part.updated (other parts)      | part                         |
// | message.updated                         | message                      |
// | question.asked                          | question                     |
// | permission.asked                        | permission                   |
// | session.error (with session and error)  | error                        |
// | session.status retry                    | retry (no id)                |
// | session.status idle, session.idle       | idle (twice per turn)        |
// | everything else (incl. status busy)     | dropped                      |
//
// Both retry signals become one event: the driver treats them alike (merge
// into the error record, classify, fail over early on quota/auth/rate).
// opencode's status `next` is the epoch instant of the next attempt
// (SessionRetry.policy: now + wait); the event's `next` is the wait until it,
// so the mapping subtracts `now` (plans/0057 F3). The status's
// `action.reason` (free_tier_limit, account_rate_limit) is the error's
// limitReason (F5); an API error's response headers give its limit fields
// (limitFields below, §5.1). Current servers publish retries as the status
// only, so the headers arrive with session.error (and with the retry parts
// older servers send).
import type { Event, Message, Part } from "@opencode-ai/sdk/v2"
import type { AgentError, AgentEvent, AgentMessage, AgentPart, LimitScope } from "../types"

export function mapEvent(event: Event, now = Date.now()): AgentEvent | undefined {
  switch (event.type) {
    case "message.part.updated": {
      const part = event.properties.part
      if (part.type === "retry") {
        return { type: "retry", session: part.sessionID, id: part.id, attempt: part.attempt, error: mapError(part.error, now) }
      }
      const mapped = mapPart(part)
      return mapped && { type: "part", session: part.sessionID, part: mapped }
    }
    case "message.updated": {
      const info = event.properties.info
      return { type: "message", session: info.sessionID, message: mapMessage(info) }
    }
    case "question.asked": {
      const asked = event.properties
      return { type: "question", session: asked.sessionID, request: asked.id, questions: asked.questions.map((q) => q.question) }
    }
    case "permission.asked": {
      const asked = event.properties
      return { type: "permission", session: asked.sessionID, request: asked.id, permission: asked.permission, patterns: asked.patterns }
    }
    case "session.error": {
      const { sessionID, error } = event.properties
      if (!sessionID || !error) return undefined
      return { type: "error", session: sessionID, error: mapError(error, now) }
    }
    case "session.status": {
      const { sessionID, status } = event.properties
      if (status.type === "idle") return { type: "idle", session: sessionID }
      if (status.type === "retry") {
        // Older servers may omit fields; keep only what arrived.
        const st = status as { attempt?: number; message?: string; next?: number; action?: { reason?: unknown } }
        const reason = typeof st.action?.reason === "string" && st.action.reason ? st.action.reason : undefined
        return {
          type: "retry",
          session: sessionID,
          ...(st.attempt !== undefined ? { attempt: st.attempt } : {}),
          ...(st.next !== undefined ? { next: Math.max(0, st.next - now) } : {}),
          error: { ...(st.message !== undefined ? { message: st.message } : {}), ...(reason !== undefined ? { limitReason: reason } : {}) },
        }
      }
      return undefined
    }
    case "session.idle":
      return { type: "idle", session: event.properties.sessionID }
    default:
      return undefined
  }
}

// Message shape shared by message.updated and session history (MA.3 reuses it
// for messages()). Context occupancy is opencode's own measure: prompt input
// plus cache reads of the latest step.
export function mapMessage(info: Message): AgentMessage {
  if (info.role !== "assistant")
    return {
      id: info.id,
      role: "user",
      completed: false,
      failed: false,
      // The user message carries the model the server resolved for its turn
      // (prompt model > agent > config > session history); the driver
      // displays this as the actually-used model.
      ...(info.model ? { model: `${info.model.providerID}/${info.model.modelID}` } : {}),
    }
  return {
    id: info.id,
    role: "assistant",
    completed: Boolean(info.time?.completed),
    model: `${info.providerID}/${info.modelID}`,
    contextUsed: info.tokens.input + info.tokens.cache.read,
    failed: info.error !== undefined,
  }
}

function mapPart(part: Exclude<Part, { type: "retry" }>): AgentPart | undefined {
  switch (part.type) {
    case "text":
      return { kind: "text", id: part.id, text: part.text, final: Boolean(part.time?.end) }
    case "reasoning":
      return { kind: "reasoning", id: part.id, text: part.text, final: Boolean(part.time.end) }
    case "tool": {
      const state = part.state
      const base = { kind: "tool" as const, id: part.id, tool: part.tool, status: state.status, input: state.input }
      if (state.status === "completed") return { ...base, output: state.output, title: state.title }
      if (state.status === "error") return { ...base, error: state.error }
      return base
    }
    case "step-start":
      return { kind: "step-start", id: part.id }
    case "step-finish":
      return {
        kind: "step-finish",
        id: part.id,
        reason: part.reason,
        tokens: {
          input: part.tokens.input,
          output: part.tokens.output,
          reasoning: part.tokens.reasoning,
          cacheRead: part.tokens.cache.read,
          cacheWrite: part.tokens.cache.write,
        },
        cost: part.cost,
      }
    // Display-only kinds: the text matches today's verbose log line
    // (session-api.ts describePart) without its two-space indent.
    case "file":
      return { kind: "note", id: part.id, text: `file: ${part.filename ?? part.url}` }
    case "subtask":
      return { kind: "note", id: part.id, text: `subtask (${part.agent}): ${part.description}` }
    case "agent":
      return { kind: "note", id: part.id, text: `subagent: ${part.name}` }
    case "patch":
      return { kind: "note", id: part.id, text: `patch (${part.files.length} files): ${part.files.join(", ")}` }
    case "snapshot":
      return { kind: "note", id: part.id, text: `snapshot: ${part.snapshot}` }
    case "compaction":
      return { kind: "note", id: part.id, text: `context compaction${part.auto ? " (auto)" : ""}` }
    default:
      return undefined
  }
}

// opencode error bodies are { name, data? } with data.message / statusCode /
// isRetryable / responseHeaders / responseBody on the API error family.
// Non-string messages are stringified, as watch.ts does today.
function mapError(error: { name: string; data?: unknown }, now: number): AgentError {
  const data = (typeof error.data === "object" && error.data !== null ? error.data : {}) as Record<string, unknown>
  const headers = typeof data.responseHeaders === "object" && data.responseHeaders !== null ? (data.responseHeaders as Record<string, unknown>) : undefined
  return {
    name: error.name,
    ...(data.message !== undefined ? { message: String(data.message) } : {}),
    ...(typeof data.statusCode === "number" ? { statusCode: data.statusCode } : {}),
    ...(typeof data.isRetryable === "boolean" ? { isRetryable: data.isRetryable } : {}),
    ...(data.responseBody !== undefined ? { responseBody: String(data.responseBody) } : {}),
    ...limitFields(headers, now),
  }
}

// The limit fields of an API error's response headers (plans/0057 §5.1, F6,
// F13, F15). Names match case-insensitively; a value that does not parse is
// dropped, not guessed. The reset comes from the most specific family
// present, and a stated wait alone is counted from `now`:
//
// | header                                             | field                                    |
// |----------------------------------------------------|------------------------------------------|
// | retry-after-ms, else retry-after (s or HTTP-date)  | retryAfterMs                             |
// | anthropic-ratelimit-unified-reset / -5h / -7d      | resetAt, scope 5h / 7d / unknown         |
// | anthropic-ratelimit-requests-reset                 | resetAt, scope request                   |
// | anthropic-ratelimit-{input-,output-,}tokens-reset  | resetAt, scope token                     |
// | x-ratelimit-reset-requests / -tokens (a duration)  | resetAt, scope request / token, and      |
// |                                                    |   retryAfterMs when no retry-after       |
// | retry-after alone                                  | resetAt = now + retryAfterMs             |
//
// The unified family is the subscription's windows. Its `-reset` names the
// window that binds (its scope is the window whose own reset it equals);
// without it a lone window's reset is taken, and of two the fuller one
// (`-utilization`), else the later. A `-status` other than rejected means
// the windows are open, so the failure is not theirs and the family is
// skipped. A per-minute cap whose `-remaining` is above zero did not refuse
// the request and is skipped too; of the caps left, the latest reset binds.
// AUTO-DECISION: the unified family counts only when its status is absent or rejected, and a per-minute cap only when its remaining count is absent or zero (§5.1's table lists the reset headers alone, but the providers send them on every response — a throttled request on an open subscription window would otherwise carry a five-hour reset it never hit)
export function limitFields(raw: Record<string, unknown> | undefined, now: number): Pick<AgentError, "retryAfterMs" | "resetAt" | "scope"> {
  if (raw === undefined) return {}
  const headers = new Map<string, string>()
  for (const [name, value] of Object.entries(raw)) if (typeof value === "string") headers.set(name.toLowerCase(), value.trim())
  const wait = statedWait(headers, now)
  const reset = windowReset(headers) ?? capReset(headers, now)
  const retryAfterMs = wait ?? reset?.wait
  const resetAt = reset?.resetAt ?? (wait !== undefined ? now + wait : undefined)
  return {
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    ...(resetAt !== undefined ? { resetAt } : {}),
    ...(reset !== undefined ? { scope: reset.scope } : {}),
  }
}

type Reset = { resetAt: number; scope: LimitScope; wait?: number }

// retry-after-ms, else retry-after in seconds or as an HTTP-date — the order
// opencode's own SessionRetry.delay reads them in.
function statedWait(headers: Map<string, string>, now: number): number | undefined {
  const ms = decimal(headers.get("retry-after-ms"))
  if (ms !== undefined) return Math.ceil(ms)
  const after = headers.get("retry-after")
  const seconds = decimal(after)
  if (seconds !== undefined) return Math.ceil(seconds * 1000)
  const at = after !== undefined && HTTP_DATE_RE.test(after) ? Date.parse(after) : NaN
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined
}

function windowReset(headers: Map<string, string>): Reset | undefined {
  const status = headers.get("anthropic-ratelimit-unified-status")
  if (status !== undefined && status !== "rejected") return undefined
  const five = instant(headers.get("anthropic-ratelimit-unified-5h-reset"))
  const seven = instant(headers.get("anthropic-ratelimit-unified-7d-reset"))
  const binding = instant(headers.get("anthropic-ratelimit-unified-reset"))
  if (binding !== undefined) return { resetAt: binding, scope: binding === five ? "5h" : binding === seven ? "7d" : "unknown" }
  if (five === undefined) return seven !== undefined ? { resetAt: seven, scope: "7d" } : undefined
  if (seven === undefined) return { resetAt: five, scope: "5h" }
  const fiveUsed = decimal(headers.get("anthropic-ratelimit-unified-5h-utilization"))
  const sevenUsed = decimal(headers.get("anthropic-ratelimit-unified-7d-utilization"))
  const weekly = fiveUsed !== undefined && sevenUsed !== undefined && fiveUsed !== sevenUsed ? sevenUsed > fiveUsed : seven > five
  return weekly ? { resetAt: seven, scope: "7d" } : { resetAt: five, scope: "5h" }
}

// The per-minute caps: Anthropic states an instant, the OpenAI family a
// duration from now.
const CAPS: { reset: string; remaining: string; scope: LimitScope; duration?: true }[] = [
  { reset: "anthropic-ratelimit-requests-reset", remaining: "anthropic-ratelimit-requests-remaining", scope: "request" },
  { reset: "anthropic-ratelimit-tokens-reset", remaining: "anthropic-ratelimit-tokens-remaining", scope: "token" },
  { reset: "anthropic-ratelimit-input-tokens-reset", remaining: "anthropic-ratelimit-input-tokens-remaining", scope: "token" },
  { reset: "anthropic-ratelimit-output-tokens-reset", remaining: "anthropic-ratelimit-output-tokens-remaining", scope: "token" },
  { reset: "x-ratelimit-reset-requests", remaining: "x-ratelimit-remaining-requests", scope: "request", duration: true },
  { reset: "x-ratelimit-reset-tokens", remaining: "x-ratelimit-remaining-tokens", scope: "token", duration: true },
]

function capReset(headers: Map<string, string>, now: number): Reset | undefined {
  let found: Reset | undefined
  for (const cap of CAPS) {
    const left = decimal(headers.get(cap.remaining))
    if (left !== undefined && left > 0) continue
    const value = headers.get(cap.reset)
    const wait = cap.duration ? duration(value) : undefined
    const resetAt = cap.duration ? (wait !== undefined ? now + wait : undefined) : instant(value)
    if (resetAt === undefined || (found !== undefined && found.resetAt >= resetAt)) continue
    found = { resetAt, scope: cap.scope, ...(wait !== undefined ? { wait } : {}) }
  }
  return found
}

const DECIMAL_RE = /^\d+(?:\.\d+)?$/
// RFC 3339 with its offset, and the IMF-fixdate form of an HTTP-date.
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|z|[+-]\d{2}:?\d{2})$/
const HTTP_DATE_RE = /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/
const UNIT_MS: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1000, ms: 1 }

function decimal(value: string | undefined): number | undefined {
  return value !== undefined && DECIMAL_RE.test(value) ? Number(value) : undefined
}

// A reset instant: RFC 3339 (the documented Anthropic headers), or an epoch
// number — seconds (the unified family) or milliseconds, told apart by size;
// a number too small for either is no instant.
function instant(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const number = decimal(value)
  if (number !== undefined) return number >= 1e12 ? Math.round(number) : number >= 1e9 ? Math.round(number * 1000) : undefined
  if (!RFC3339_RE.test(value)) return undefined
  const at = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"))
  return Number.isFinite(at) ? at : undefined
}

// A Go-style duration as the OpenAI family sends it: "1s", "6m0s", "20ms".
function duration(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined
  const parts = [...value.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)]
  if (parts.map((part) => part[0]).join("") !== value) return undefined
  return Math.round(parts.reduce((sum, [, amount, unit]) => sum + Number(amount) * UNIT_MS[unit!]!, 0))
}
