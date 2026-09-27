// claude headless stdout → unified AgentEvent mapping (MA.5, design
// plans/0041 §3). One parser per subprocess: `claude -p --output-format
// stream-json --verbose` prints one JSON object per line, and this turns each
// line into zero or more AgentEvents. Pure apart from its own per-process
// state, so the table is testable line by line; the process manager
// (client.ts) owns what depends on the process itself — replay
// acknowledgments, when a turn counts as idle, exits, the permission preset.
//
// | stdout line                                   | AgentEvent                           |
// |-----------------------------------------------|--------------------------------------|
// | assistant (first line of a turn)              | part step-start                      |
// | assistant (each line = one content block)     | message (in progress) + part         |
// |   text / non-empty thinking / tool_use        |   text / reasoning / tool (running)  |
// | assistant with another message id             | message (previous one completed)     |
// | user tool_result                              | message completed + tool part        |
// |                                               |   (completed / error)                |
// | system api_retry                              | retry                                |
// | system compact_boundary / permission_denied   | part note                            |
// | rate_limit_event                              | limit (its windows); the info is     |
// |                                               |   kept for the turn's error          |
// | result                                        | message completed + step-finish      |
// |                                               |   (+ error when is_error)            |
// | anything with parent_tool_use_id (subagents), | dropped                              |
// |   replayed user lines, init, ...              |                                      |
//
// An API error arrives as a synthetic assistant message (model "<synthetic>",
// all-zero usage, `is_api_error_message`): it measured nothing and ran on no
// model, so its message event carries neither figure nor model and the
// session keeps the context it earned (plans/0057 F21). The turn's error is
// named by the message's `error` code, else the result's `terminal_reason`,
// else its subtype — never "success", which contradicts `is_error` (F7).
//
// Usage windows (plans/0057 §5.2, F20): the CLI emits a rate_limit_event when
// its view of the account's windows changes, so its info is state and stands
// until the next one. Each becomes a `limit` event (allowed / warning /
// rejected, with the unified windows it states). A turn that fails while the
// latest status is rejected is refused by a spent window: its error is not
// retryable (a fresh session fails the same way until the reset, F19) and
// carries the window:
//
// | rate_limit_info                       | error field                             |
// |---------------------------------------|-----------------------------------------|
// | status rejected                       | isRetryable false                       |
// | resetsAt (epoch s)                    | resetAt (ms)                            |
// | rateLimitType five_hour               | scope 5h                                |
// | rateLimitType seven_day*              | scope 7d                                |
// | rateLimitType overage, or none        | scope unknown                           |
// | rateLimitType, overageDisabledReason  | limitReason (five_hour/out_of_credits)  |
//
// Billing: the stream repeats a message's usage on every content-block line
// with its output count still growing, so per-message figures cannot be
// summed. The turn's `result` carries the exact turn totals and becomes the
// one step-finish of the turn (the billing unit). Its cost, though, is the
// session's running total — carried across resumes and into forks — so the
// parser bills the difference to the previous total: `costBase` is the total
// before this process started, undefined when unknown (then the first turn's
// cost is not billed rather than billing the whole history).
// Context: input + cache reads + cache writes of the latest API message — the
// whole prompt the model saw — measured in-turn, hence usage tier `events`.
import type { AgentError, AgentEvent, AgentMessage, AgentPart, AgentTokens, LimitScope, LimitWindow } from "../types"

// The adapter's model-string form: "claude/<model id>". The driver's model
// strings carry a provider prefix (switches.ts requires "prov/model"); the
// adapter strips whatever prefix it gets and reports its own.
export const MODEL_PREFIX = "claude/"

// The model name the CLI gives the assistant message that wraps an API error.
const SYNTHETIC_MODEL = "<synthetic>"

type Line = Record<string, any>

type Current = { id: string; model: string | undefined; used: number | undefined; blocks: number; failed: boolean }

export type ClaudeStream = {
  feed(line: Line): AgentEvent[]
}

export function claudeStream(session: string, costBase?: number): ClaudeStream {
  // The assistant message being streamed (its content blocks arrive one line
  // each); closed by a tool result, another message, or the result.
  let current: Current | undefined
  // Tool calls by id, so a tool_result can name the tool and repeat its input.
  const tools = new Map<string, { tool: string; input?: Record<string, unknown> }>()
  let turn = 0
  let stepOpen = false
  let costSeen = costBase
  // Error code of an API error message (assistant `error`), folded into the
  // turn's error event as its name.
  let errorName: string | undefined
  // The provider's usage windows as the CLI last reported them
  // (rate_limit_event, "emitted when rate limit info changes"): state, not a
  // per-turn signal, so it stands until the next event. Rejected means the
  // account's window is spent — a fresh session fails the same way until it
  // resets (plans/0057 F19, F20), so the turn's error is not retryable.
  let limitInfo: Line | undefined

  const message = (c: Current, completed: boolean): AgentEvent => {
    const info: AgentMessage = {
      id: c.id,
      role: "assistant",
      completed,
      ...(c.model !== undefined ? { model: `${MODEL_PREFIX}${c.model}` } : {}),
      ...(c.used !== undefined ? { contextUsed: c.used } : {}),
      failed: c.failed,
    }
    return { type: "message", session, message: info }
  }
  const close = (out: AgentEvent[]) => {
    if (current) out.push(message(current, true))
    current = undefined
  }
  const part = (p: AgentPart): AgentEvent => ({ type: "part", session, part: p })

  return {
    feed(line) {
      const out: AgentEvent[] = []
      // Subagent traffic (Task tool) is the subagent's, not this session's turn.
      if (line.parent_tool_use_id) return out
      switch (line.type) {
        case "assistant": {
          const m = line.message ?? {}
          if (current && current.id !== m.id) close(out)
          if (!stepOpen) {
            stepOpen = true
            out.push(part({ kind: "step-start", id: `${session}:turn:${turn}` }))
          }
          if (line.error) errorName = String(line.error)
          const synthetic = line.is_api_error_message === true || m.model === SYNTHETIC_MODEL
          current ??= { id: String(m.id), model: synthetic ? undefined : String(m.model ?? ""), used: undefined, blocks: 0, failed: false }
          if (!synthetic) current.used = contextUsed(m.usage) ?? current.used
          current.failed ||= synthetic || line.error !== undefined
          out.push(message(current, false))
          for (const block of Array.isArray(m.content) ? m.content : []) {
            const id = `${current.id}:${current.blocks++}`
            if (block.type === "text" && block.text) out.push(part({ kind: "text", id, text: block.text, final: true }))
            // Redacted thinking arrives empty (signature only): nothing to show.
            if (block.type === "thinking" && block.thinking) out.push(part({ kind: "reasoning", id, text: block.thinking, final: true }))
            if (block.type === "tool_use") {
              tools.set(block.id, { tool: block.name, input: block.input })
              out.push(part({ kind: "tool", id: block.id, tool: block.name, status: "running", input: block.input }))
            }
          }
          return out
        }
        case "user": {
          // Our own prompts echoed back (--replay-user-messages): the client's
          // acknowledgment signal, no event.
          if (line.isReplay) return out
          const content = line.message?.content
          if (!Array.isArray(content)) return out
          for (const block of content) {
            if (block?.type !== "tool_result") continue
            // A tool result means the API message that called it is complete.
            close(out)
            const call = tools.get(block.tool_use_id)
            const text = resultText(block.content)
            const base = { kind: "tool" as const, id: String(block.tool_use_id), tool: call?.tool ?? "tool", input: call?.input }
            out.push(part(block.is_error ? { ...base, status: "error", error: text } : { ...base, status: "completed", output: text }))
          }
          return out
        }
        case "system": {
          if (line.subtype === "compact_boundary") out.push(part({ kind: "note", id: String(line.uuid ?? `${session}:compact:${turn}`), text: "context compaction (auto)" }))
          if (line.subtype === "permission_denied") {
            out.push(part({ kind: "note", id: String(line.uuid ?? line.tool_use_id), text: `permission denied: ${line.tool_name}: ${line.message ?? ""}`.trim() }))
          }
          if (line.subtype === "api_retry") {
            const error: AgentError = {
              ...(line.error !== undefined ? { message: String(line.error) } : {}),
              ...(typeof line.error_status === "number" ? { statusCode: line.error_status } : {}),
            }
            out.push({
              type: "retry",
              session,
              ...(typeof line.attempt === "number" ? { attempt: line.attempt } : {}),
              ...(typeof line.retry_delay_ms === "number" ? { next: line.retry_delay_ms } : {}),
              error,
            })
          }
          return out
        }
        case "rate_limit_event": {
          const info = line.rate_limit_info
          if (typeof info?.status !== "string") return out
          limitInfo = info
          const status = LIMIT_STATUS[info.status]
          if (status !== undefined) out.push({ type: "limit", session, status, windows: limitWindows(info) })
          return out
        }
        case "result": {
          close(out)
          const total = typeof line.total_cost_usd === "number" ? line.total_cost_usd : costSeen
          const cost = total !== undefined && costSeen !== undefined ? Math.max(0, total - costSeen) : 0
          costSeen = total
          if (stepOpen) {
            out.push(
              part({
                kind: "step-finish",
                id: `${session}:turn:${turn}:finish`,
                // max_tokens = the output limit cut the reply (watch resumes it).
                reason: line.stop_reason === "max_tokens" ? "length" : String(line.stop_reason ?? "stop"),
                tokens: turnTokens(line.usage),
                cost,
              }),
            )
          }
          stepOpen = false
          turn++
          if (line.is_error) {
            const detail = [line.result, ...(Array.isArray(line.errors) ? line.errors : [])].filter((s) => typeof s === "string" && s).join("\n")
            out.push({
              type: "error",
              session,
              error: {
                name: errorName ?? terminalName(line),
                ...(detail ? { message: detail } : {}),
                ...(typeof line.api_error_status === "number" ? { statusCode: line.api_error_status } : {}),
                ...(limitInfo?.status === "rejected" ? spentWindow(limitInfo) : {}),
              },
            })
          }
          errorName = undefined
          return out
        }
        default:
          return out
      }
    },
  }
}

const LIMIT_STATUS: Record<string, "allowed" | "warning" | "rejected"> = { allowed: "allowed", allowed_warning: "warning", rejected: "rejected" }

// rateLimitType → the scope of its reset; overage and unknown types have none.
function windowScope(type: unknown): "5h" | "7d" | undefined {
  if (type === "five_hour") return "5h"
  return typeof type === "string" && type.startsWith("seven_day") ? "7d" : undefined
}

// The windows a rate_limit_event states: the unified five-hour and weekly
// windows when present (subscription profiles), else the one window the
// event itself names. The overage-included weekly window is not a second 7d.
function limitWindows(info: Line): LimitWindow[] {
  const one = (scope: "5h" | "7d", resetsAt: unknown, utilization: unknown): LimitWindow[] =>
    typeof resetsAt === "number" ? [{ scope, resetAt: resetsAt * 1000, ...(typeof utilization === "number" ? { utilization } : {}) }] : []
  const unified = info.unifiedWindows
  if (typeof unified === "object" && unified !== null) {
    return [
      ...one("5h", unified.five_hour?.resetsAt, unified.five_hour?.utilization),
      ...one("7d", unified.seven_day?.resetsAt, unified.seven_day?.utilization),
    ]
  }
  const scope = windowScope(info.rateLimitType)
  return scope !== undefined ? one(scope, info.resetsAt, info.utilization) : []
}

// The error fields of a turn refused by a spent window.
function spentWindow(info: Line): AgentError {
  const scope: LimitScope = windowScope(info.rateLimitType) ?? "unknown"
  const reason = [info.rateLimitType, info.overageDisabledReason].filter((part): part is string => typeof part === "string" && part !== "").join("/")
  return {
    isRetryable: false,
    ...(typeof info.resetsAt === "number" ? { resetAt: info.resetsAt * 1000 } : {}),
    scope,
    ...(reason ? { limitReason: reason } : {}),
  }
}

// A failed turn's name when no API error message named it: the result's
// terminal_reason, else a subtype that names a failure (error_max_turns,
// error_during_execution). A failed result can carry subtype "success"
// (plans/0057 F7); that is no name.
function terminalName(line: Line): string {
  if (typeof line.terminal_reason === "string" && line.terminal_reason) return line.terminal_reason
  if (typeof line.subtype === "string" && line.subtype && line.subtype !== "success") return line.subtype
  return "error"
}

// Tokens occupying the context after an API message: the prompt it was sent
// (uncached input + cache reads + cache writes). Undefined without usage.
function contextUsed(usage: Line | undefined): number | undefined {
  if (!usage || typeof usage.input_tokens !== "number") return undefined
  return usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
}

// A turn's totals. claude counts thinking inside output_tokens; the driver's
// shape keeps them apart (reasoning), so the thinking share moves over.
function turnTokens(usage: Line | undefined): AgentTokens {
  const thinking = usage?.output_tokens_details?.thinking_tokens ?? 0
  const output = usage?.output_tokens ?? 0
  return {
    input: usage?.input_tokens ?? 0,
    output: Math.max(0, output - thinking),
    reasoning: Math.min(thinking, output),
    cacheRead: usage?.cache_read_input_tokens ?? 0,
    cacheWrite: usage?.cache_creation_input_tokens ?? 0,
  }
}

// tool_result content is a string or a list of content blocks.
function resultText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((block) => (block?.type === "text" ? String(block.text ?? "") : ""))
    .filter(Boolean)
    .join("\n")
}
