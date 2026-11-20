import type { ExecutorHolder } from "@opencode-ai/auto-core/executor-coordinator"
import { REQUEST_BYTE_LIMIT, RequestError } from "./request"
import type { ExecutorRoute } from "./ws-protocol"

type WorkKind = "execute" | "verify" | "fix" | "formulate" | "synthesize" | "distill" | "audit"
type Lease = { step: string; lease: string }
type Action =
  | { route: "ready" }
  | { route: "claim"; task?: string; kind?: WorkKind }
  | { route: "brief"; task: string; kind: WorkKind }
  | { route: "report"; key: Lease; outcome: "ended" | "failed"; note?: string }
  | { route: "heartbeat"; leases: Lease[] }
  | { route: "release"; key: Lease }

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function word(value: unknown, field: string, limit = 256): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit || /[\x00-\x1f\x7f]/.test(value)) {
    throw new RequestError(`Invalid executor field "${field}".`)
  }
  return value
}

function workKind(value: unknown): WorkKind {
  // 0276: the formulate kind joins the frozen vocabulary additively — an
  // unknown word still stops and asks (the standing letter). 0277 adds the
  // distill kind (the transfer advance's distillation session), 0278 the
  // audit kind (the close-audit session) and 0281 the synthesize kind (the
  // formulation construction's re-voicing session) the same way.
  if (value === "execute" || value === "verify" || value === "fix" || value === "formulate" || value === "synthesize" || value === "distill" || value === "audit") return value
  throw new RequestError('Executor "kind" must be execute, verify, fix, formulate, synthesize, distill, or audit.')
}

function key(body: Record<string, unknown>): Lease {
  return { step: word(body.step, "step"), lease: word(body.lease, "lease") }
}

export async function readExecutorBody(request: Request): Promise<unknown> {
  if (!request.body) return {}
  const reader = request.body.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let bytes = 0
  let text = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > REQUEST_BYTE_LIMIT) throw new RequestError(`Executor requests are limited to ${REQUEST_BYTE_LIMIT} bytes.`)
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return text.trim() ? JSON.parse(text) : {}
  } finally {
    void reader.cancel().catch(() => undefined)
  }
}

export function parseExecutorRequest(route: ExecutorRoute, body: unknown, token: string): { holder: ExecutorHolder; action: Action } {
  if (!record(body)) throw new RequestError("The executor request must be a JSON object.")
  const holder = { token, channel: body.channel === undefined ? "" : word(body.channel, "channel") }
  const note = route === "report" || route === "release" ? body.note : undefined
  if (note !== undefined && (typeof note !== "string" || note.length > 4096)) {
    throw new RequestError('Executor "note" must be a string of at most 4096 characters.')
  }
  switch (route) {
    case "ready":
      return { holder, action: { route } }
    case "claim":
      if (body.role !== undefined) throw new RequestError("The person claim role is retired: the ask channel is gone (plans/0282) — the gates are document-derived, the person acts by document writes and deterministic operations.")
      return { holder, action: { route, task: body.task === undefined ? undefined : word(body.task, "task"), kind: body.kind === undefined ? undefined : workKind(body.kind) } }
    case "brief":
      return { holder, action: { route, task: word(body.task, "task"), kind: workKind(body.kind) } }
    case "release":
      return { holder, action: { route, key: key(body) } }
    case "report":
      if (body.outcome !== "ended" && body.outcome !== "failed") throw new RequestError('Executor "outcome" must be ended or failed.')
      return { holder, action: { route, key: key(body), outcome: body.outcome, note } }
    case "heartbeat":
      if (!Array.isArray(body.leases) || body.leases.length > 64) throw new RequestError('Executor "leases" must be an array of at most 64 lease pairs.')
      return { holder, action: { route, leases: body.leases.map((pair: unknown) => {
        if (!record(pair)) throw new RequestError("Invalid heartbeat lease pair.")
        return key(pair)
      }) } }
  }
}
