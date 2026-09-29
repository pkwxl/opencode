// The failure concern (plans/0061 §4.5, the failure cells of the part, error
// and retry rows): the turn's failure accumulator. A session error appends
// its text to the merged error string and folds its structured fields into
// the slice's info — the message with the error name folded in (the
// classifier keys some classes on it), the pessimistic retryable (once any
// error explicitly carries isRetryable:false the whole turn is judged
// non-retryable, never retracted), and terminal: the agent's turn failed and
// it stopped retrying. A retry signal means the agent works through a
// failure again: it replaces the info's message with the signal's own, drops
// the earlier end's terminal flag and sets `retrying`, which holds until the
// model produces output again — a late classifier answer must never abort a
// turn that recovered. Model output also drops what was stated about the
// limit: a later failure of the same watch must not carry an earlier
// statement's reset into a down mark.
//
// The limit statement (AgentError's limit fields, plans/0057 §5) is laid over
// the turn's record by the two helpers below, moved verbatim out of the watch
// body: withWording reads a reset the provider stated only in a known
// wording when the event states no structured limit of its own, and withLimit
// merges the latest statement (a stated reset replaces the earlier one
// together with its scope).
import type { AgentError } from "../../agent/types"
import { statedInWording, type ErrorInfo } from "../../chain"
import type { Advice, Concern, TurnState } from "../contract"

// A failure's limit statement (AgentError's limit fields, plans/0057 §5) laid
// over the turn's record: the latest statement stands, and a stated reset
// replaces the earlier reset together with its scope.
function withLimit(info: ErrorInfo, e: AgentError): ErrorInfo {
  const { resetAt, scope, ...rest } = info
  const reset = e.resetAt !== undefined || e.scope !== undefined ? { resetAt: e.resetAt, scope: e.scope } : { resetAt, scope }
  return {
    ...rest,
    ...(reset.resetAt !== undefined ? { resetAt: reset.resetAt } : {}),
    ...(reset.scope !== undefined ? { scope: reset.scope } : {}),
    ...(e.retryAfterMs !== undefined ? { retryAfterMs: e.retryAfterMs } : {}),
    ...(e.limitReason !== undefined ? { limitReason: e.limitReason } : {}),
  }
}

// A failure's own words beneath its structured limit fields (plans/0057
// S4a): a reset the provider states in a known wording (chain.ts
// statedInWording) counts as stated when the event states no limit of its
// own — a header- or stream-stated one outranks it.
function withWording(e: AgentError, now: number): AgentError {
  if (e.resetAt !== undefined || e.scope !== undefined) return e
  const stated = statedInWording(`${e.message ?? ""}\n${e.responseBody ?? ""}`, now)
  return stated !== undefined ? { ...e, ...stated } : e
}

const LIMIT_KEYS = ["resetAt", "scope", "retryAfterMs", "limitReason"] as const

export const failureConcern: Concern<"failure"> = {
  name: "failure",
  initial: (): TurnState["failure"] => ({ error: "", retrying: false }),
  handle: async (input, own, _view, fx): Promise<Advice> => {
    // The concern's cells are the part, error and retry rows; every other
    // input passes through untouched, and no cell ever stops the input or
    // settles the turn — the row continues to the cells that decide.
    if (input.kind !== "event") return "pass"
    if (input.event.type === "part") {
      const part = input.event.part
      // Model output after a retry (a step-start alone is not output: the
      // model may still be streaming the retry it got through): the agent's
      // retry succeeded, and what was stated about the limit no longer
      // applies — a later failure of this watch must not carry its reset
      // into a down mark.
      if (part.kind !== "step-start") {
        own.retrying = false
        const stated = own.info
        if (stated !== undefined && LIMIT_KEYS.some((key) => stated[key] !== undefined)) {
          const { resetAt: _reset, scope: _scope, retryAfterMs: _wait, limitReason: _reason, ...rest } = stated
          own.info = rest
        }
      }
      return "pass"
    }
    if (input.event.type === "error") {
      const e = input.event.error
      const errName = e.name ?? ""
      const detail = e.message ?? errName
      own.error = own.error ? `${own.error}\n${detail}` : detail
      // Pessimistic reading: once any session error explicitly carries
      // isRetryable:false (account-level rate limiting and the like, where a
      // re-dispatch or a fresh session fails the same way), the whole turn is
      // judged non-retryable and never retracted by later events.
      if (e.isRetryable === false) own.retryable = false
      // D.2 trigger surface 1: beyond message/retryable, carry the structured
      // fields into the failure slice's info for classification and reporting
      // (Watch gained errorInfo?, as retryable? did before it — the same kind
      // of precedent). **No control-flow change** — this path never settles
      // early for a failover; it only lets the existing error paths carry the
      // classification up and downstream. The error name (APIError/
      // ProviderAuthError/ContextOverflowError/…) is folded into message so
      // the classifier can recognize the name-keyed classes like overflow/auth
      // (design D.1; the name table is supplied by the adapter).
      const classifyMsg = detail.toLowerCase().includes(errName.toLowerCase()) ? detail : `${errName} ${detail}`
      const prev = own.info
      own.info = withLimit(
        {
          ...(prev ?? {}),
          message: prev?.message ? `${prev.message}\n${classifyMsg}` : classifyMsg,
          ...(e.statusCode !== undefined ? { statusCode: e.statusCode } : {}),
          ...(e.responseBody !== undefined ? { responseBody: e.responseBody } : {}),
          ...(e.isRetryable !== undefined ? { isRetryable: e.isRetryable } : {}),
          // The agent's turn failed: it stopped retrying (plans/0057 §4.1).
          terminal: true,
        },
        withWording(e, fx.now()),
      )
      return "pass"
    }
    if (input.event.type === "retry") {
      const event = input.event
      const e = event.error
      own.retrying = true
      // A retry means the agent works through a failure again (a later turn
      // of this watch, say): an earlier turn's end is not this signal's.
      const { terminal: _ended, ...before } = own.info ?? {}
      own.info = withLimit(
        {
          ...before,
          ...(e.message !== undefined ? { message: e.message } : {}),
          ...(e.statusCode !== undefined ? { statusCode: e.statusCode } : {}),
          ...(e.isRetryable !== undefined ? { isRetryable: e.isRetryable } : {}),
          ...(e.responseBody !== undefined ? { responseBody: e.responseBody } : {}),
          ...(event.attempt !== undefined ? { attempt: event.attempt } : {}),
          ...(event.next !== undefined ? { next: event.next } : {}),
        },
        withWording(e, fx.now()),
      )
      return "pass"
    }
    return "pass"
  },
}
