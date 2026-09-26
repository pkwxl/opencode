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
// so the mapping subtracts `now` (plans/0057 F3).
import type { Event, Message, Part } from "@opencode-ai/sdk/v2"
import type { AgentError, AgentEvent, AgentMessage, AgentPart } from "../types"

export function mapEvent(event: Event, now = Date.now()): AgentEvent | undefined {
  switch (event.type) {
    case "message.part.updated": {
      const part = event.properties.part
      if (part.type === "retry") {
        return { type: "retry", session: part.sessionID, id: part.id, attempt: part.attempt, error: mapError(part.error) }
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
      return { type: "error", session: sessionID, error: mapError(error) }
    }
    case "session.status": {
      const { sessionID, status } = event.properties
      if (status.type === "idle") return { type: "idle", session: sessionID }
      if (status.type === "retry") {
        // Older servers may omit fields; keep only what arrived.
        const st = status as { attempt?: number; message?: string; next?: number }
        return {
          type: "retry",
          session: sessionID,
          ...(st.attempt !== undefined ? { attempt: st.attempt } : {}),
          ...(st.next !== undefined ? { next: Math.max(0, st.next - now) } : {}),
          error: st.message !== undefined ? { message: st.message } : {},
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
// isRetryable / responseBody on the API error family. Non-string messages are
// stringified, as watch.ts does today.
function mapError(error: { name: string; data?: unknown }): AgentError {
  const data = (typeof error.data === "object" && error.data !== null ? error.data : {}) as Record<string, unknown>
  return {
    name: error.name,
    ...(data.message !== undefined ? { message: String(data.message) } : {}),
    ...(typeof data.statusCode === "number" ? { statusCode: data.statusCode } : {}),
    ...(typeof data.isRetryable === "boolean" ? { isRetryable: data.isRetryable } : {}),
    ...(data.responseBody !== undefined ? { responseBody: String(data.responseBody) } : {}),
  }
}
