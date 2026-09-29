// The transcript concern (plans/0061 §4.5, the transcript cells of the part,
// message and retry rows): terminal echo and billing. The final text part is
// the session's closing words (lastText); each part or message is echoed once
// (the seen ids — re-sent updates echo once); a step-finish part is the
// billing unit, deduplicated by its id (re-sends are not counted twice); the
// first message carrying a model is reported once (the actually-used model);
// only a NEW completed assistant message passes the row on to the usage
// measurement; a retry's vlog is deduplicated by the same seen ids.
//
// The fresh flag names the part newly echoed this input — the stuck concern's
// cell (the part row's next) reads it to feed only newly seen tool parts to
// the detector.
import { describePart } from "../../session-api"
import type { Advice, Concern, TurnState } from "../contract"

export const transcriptConcern: Concern<"transcript"> = {
  name: "transcript",
  initial: (): TurnState["transcript"] => ({
    lastText: "",
    seen: new Set<string>(),
    billed: new Set<string>(),
    usage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 },
    modelReported: false,
  }),
  handle: async (input, own, _view, fx): Promise<Advice> => {
    if (input.kind !== "event") return "pass"
    if (input.event.type === "part") {
      const part = input.event.part
      // step-finish increment accumulation (the one basis that neither
      // duplicates nor misses): re-sends of the same part are not counted
      // twice.
      if (part.kind === "step-finish" && !own.billed.has(part.id)) {
        own.billed.add(part.id)
        own.usage.input += part.tokens.input
        own.usage.output += part.tokens.output
        own.usage.reasoning += part.tokens.reasoning
        own.usage.cacheRead += part.tokens.cacheRead
        own.usage.cacheWrite += part.tokens.cacheWrite
        own.usage.cost += part.cost
        own.usage.steps += 1
      }
      if (part.kind === "text") {
        if (part.final) {
          own.lastText = part.text
          fx.vlog(part.text)
        }
        return "consumed"
      }
      // The fresh flag: the id of a part newly echoed this input, cleared
      // first (a re-sent update is not fresh). The stuck concern's cell —
      // the row's next — reads it.
      own.fresh = undefined
      const line = describePart(part)
      if (line && !own.seen.has(part.id)) {
        own.seen.add(part.id)
        own.fresh = part.id
        fx.vlog(line)
      }
      return "pass"
    }
    if (input.event.type === "message") {
      const info = input.event.message
      own.lastMessage = info.id
      // Actually-used model report (each watch reports only the first
      // message carrying a model): a user message's model is the model the
      // server resolved in effect for this turn; an assistant message's
      // model is the same, as fallback.
      if (info.model !== undefined && !own.modelReported) {
        own.modelReported = true
        fx.onModel(info.model)
      }
      // The measurement point's filter: only a new completed assistant
      // message passes the row on (the usage concern's cell follows).
      if (info.role !== "assistant" || !info.completed || own.seen.has(info.id)) return "consumed"
      own.seen.add(info.id)
      return "pass"
    }
    if (input.event.type === "retry") {
      const event = input.event
      if (event.id !== undefined && !own.seen.has(event.id)) {
        own.seen.add(event.id)
        fx.vlog(`  ↻ request retry (attempt ${event.attempt})`)
      }
      return "consumed"
    }
    return "pass"
  },
}
