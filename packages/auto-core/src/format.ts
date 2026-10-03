// The pure formatters over the agent plane's values (0069 §2.2 D10's split,
// T-125): the terminal rendering of agent parts and token counts, readable
// client errors, and the human-answer approval grammar — no I/O, no state,
// no SDK reach (the AgentPart type beside them is the only import, types
// only). Split out of src/session-api.ts, which keeps the session helpers
// (fork/usage/liveness/rename, askHuman) and its driver role; this leaf sits
// in the runtime sub-domain so every sub-domain may reach it — policies
// (model-step, classify, the turn concerns) included — without binding the
// engine's session-driving layer, which is what kills the permanent
// `policies → engine` edge of the import-direction ratchet.

import type { AgentPart } from "./agent/types"

// Renders a non-text part into a readable output line (always via vlog,
// leaving the keep/drop decision to the log layer: --verbose shows it on the
// terminal and records it, the shell profile's auditLog writes it to the log
// file); undefined means the part has no terminal-state content to output yet
// (later update events will trigger again). Tool output and raw reasoning can
// be long, truncated to the 2000-character cap. display-only pieces arrive as
// notes already rendered by the adapter (0037 D6); the retry line is watch's
// (retry signals are events, not parts).
export function describePart(part: AgentPart): string | undefined {
  if (part.kind === "reasoning") return part.final ? `  reasoning:\n${part.text.trim().slice(0, 2000)}` : undefined
  if (part.kind === "tool") {
    if (part.status === "completed") return `  tool ${part.tool}: ${part.title || "done"}`
    if (part.status === "error") return `  tool ${part.tool} error: ${(part.error ?? "").slice(0, 2000)}`
    return undefined
  }
  if (part.kind === "step-finish") return `  step finish (${part.reason}): input ${formatTokens(part.tokens.input)} / output ${formatTokens(part.tokens.output)} tokens`
  if (part.kind === "step-start") return `  step start`
  if (part.kind === "note") return `  ${part.text}`
  return undefined
}

export function formatTokens(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

// Makes client errors readable: a fetch exception (network down, request
// aborted on timeout, etc.) is an Error instance, and JSON.stringify only
// yields "{}"; taking its message is what lets wording like "request timed
// out" into the blocked-problem text; everything else (the server's structured
// error body) is serialized as before.
export function formatClientError(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error)
}

// During a permission wait these answers (leading/trailing whitespace and case
// ignored) count as approval.
export function isApproval(answer: string): boolean {
  return /^(allow|yes|y|ok|approve|always)$/i.test(answer.trim())
}
