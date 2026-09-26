// Stuck-loop detection (a weak model's self-rescue): weaker models often repeat the
// same action the same way several times in a row — same tool, same parameters, same
// failure, or slightly adjusted parameters with a byte-identical error — and cannot
// get out of it by themselves. The driver observes every tool call's final state, and
// on recognizing this kind of repetition proactively injects a hint into the session
// via steer (the watch hook point in src/runner.ts, wording in
// templates/prompts/stuck-hint.md), so the model tries a different approach instead of
// spinning. Design: plans/0016-stuck-loop-design.md.
//
// Criteria (two, both scoped to this session, "consecutive" not required — an
// alternating retry pattern like A,B,A,B,A is just as much a stuck loop; accumulating
// by signature recognizes it):
//   - error: the same tool + the same error (parameters may differ) accumulated
//     errorRepeat times;
//   - repeat: the same tool + the same parameters + a completely identical output
//     accumulated sameRepeat times (an identical result = the call brought no new
//     information).
// Any change in the result (a different error, a different output) always counts as
// progress and is not counted.
//
// After a hint the signature's counter resets to zero (the threshold must be reached
// again before another hint), at most maxHints hints per session, with escalating
// levels (see the template); detection only sends hints, never aborts the session —
// however sound the criteria, they can still misjudge, and the cost of halting is far
// higher than one superfluous hint.

// Hint once the same tool + the same error accumulates this many times (parameters may
// differ: a weak model often tweaks parameters and runs into the byte-identical error).
export const STUCK_ERROR_REPEAT = 3

// Hint once the same tool + the same parameters + a completely identical output
// accumulates this many times (spinning without new information despite success; one
// tier above the error threshold: re-reading the same file also happens occasionally in
// a healthy session).
export const STUCK_SAME_REPEAT = 4

// Max hint injections per session; past the cap it stays silent (still detecting, but
// no longer intruding).
export const STUCK_MAX_HINTS = 3

// The final state of an observed tool call (extracted by the runner from the SDK's
// ToolPart; the detector does not depend on SDK types).
export type StuckCall = {
  tool: string
  // The tool input (an object; the signature serializes it with keys sorted; absent
  // counts as no arguments).
  input?: unknown
  status: "completed" | "error"
  // The error text when status=error, the output text when completed.
  result: string
}

// Hit details (handed to renderStuckHint to assemble the prompt): kind=error is the
// same-error repeat, repeat the same-args-same-result repeat; count is the accumulated
// count at triggering, level is which hint of the session this is.
export type StuckHit = {
  kind: "error" | "repeat"
  tool: string
  count: number
  level: number
  // Digests of the input and result (display text trimmed when overlong; injected into
  // the prompt so the model knows which call is being talked about).
  input: string
  detail: string
}

export type StuckTracker = {
  observe(call: StuckCall): StuckHit | undefined
}

// Thresholds are injectable (for unit tests; defaults are the three constants above).
export type StuckOptions = {
  errorRepeat?: number
  sameRepeat?: number
  maxHints?: number
}

// Session-scoped detector: one instance per session (its state is this session's call
// history, not accumulated across sessions).
export function createStuckTracker(options: StuckOptions = {}): StuckTracker {
  const errorRepeat = options.errorRepeat ?? STUCK_ERROR_REPEAT
  const sameRepeat = options.sameRepeat ?? STUCK_SAME_REPEAT
  const maxHints = options.maxHints ?? STUCK_MAX_HINTS
  const counts = new Map<string, number>()
  let hints = 0
  return {
    observe(call: StuckCall): StuckHit | undefined {
      const error = call.status === "error"
      // The error criterion excludes parameters (a tweaked parameter is still the same
      // pit); the same-args-same-result criterion includes parameters and output.
      const input = call.input === undefined || call.input === null ? "" : stableJson(call.input)
      const key = error
        ? `e|${call.tool}|${hash(normalize(call.result))}`
        : `r|${call.tool}|${hash(input)}|${hash(normalize(call.result))}`
      const count = (counts.get(key) ?? 0) + 1
      counts.set(key, count)
      if (count < (error ? errorRepeat : sameRepeat)) return undefined
      // Counter reset: counting restarts after a hint; the same pit must be fallen into
      // a full round again before the next hint.
      counts.set(key, 0)
      if (hints >= maxHints) return undefined
      hints += 1
      return {
        kind: error ? "error" : "repeat",
        tool: call.tool,
        count,
        level: hints,
        input: summarize(input, 300),
        detail: summarize(call.result, 800),
      }
    },
  }
}

// Signature normalization: whitespace folding + lowercase, removing the "looks
// different" that layout differences cause.
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase()
}

// Deterministic serialization of the input (keys sorted, independent of writing
// order); non-objects JSON as-is, unserializable values fall back to their String
// form.
function stableJson(value: unknown): string {
  const seen = new Set<unknown>()
  const walk = (node: unknown): unknown => {
    if (node === null || typeof node !== "object") return node
    if (seen.has(node)) return "[circular]"
    seen.add(node)
    if (Array.isArray(node)) return node.map(walk)
    const record = node as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const name of Object.keys(record).sort()) sorted[name] = walk(record[name])
    return sorted
  }
  try {
    return JSON.stringify(walk(value)) ?? String(value)
  } catch {
    return String(value)
  }
}

// Display summary: trimmed at both ends + truncated when overlong (injected into
// the prompt, only so the model can recognize which call it was).
function summarize(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}… (truncated)` : trimmed
}

// FNV-1a 32-bit: only compresses long text into short signature keys, no security
// use.
function hash(text: string): string {
  let value = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i)
    value = Math.imul(value, 0x01000193)
  }
  return (value >>> 0).toString(16)
}
