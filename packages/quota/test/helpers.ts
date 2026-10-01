import type { CliIo } from "../src/cli.js"
import type { FetchLike } from "../src/types.js"

export function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.sig`
}

/** A JWT whose payload is a raw string — used to mimic zhipu's malformed web-JWT payload. */
export function jwtWithPayload(raw: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")
  return `${header}.${Buffer.from(raw, "utf8").toString("base64url")}.sig`
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json;charset=UTF-8", ...headers },
  })
}

export interface RecordedCall {
  input: string | URL | Request
  init?: RequestInit
}

export function recordingFetch(
  responder: Response | ((call: RecordedCall) => Response),
): { fetchImpl: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const fetchImpl: FetchLike = async (input, init) => {
    const call: RecordedCall = { input, init }
    calls.push(call)
    return typeof responder === "function" ? responder(call) : responder
  }
  return { fetchImpl, calls }
}

export function requestHeaders(call: RecordedCall | undefined): Headers {
  return new Headers(call?.init?.headers)
}

/** stdout capture for runCli: one chunk per JSON text emitted (newlines added by the default writer only). */
export function capture(): { io: CliIo; text: () => string; last: () => any } {
  const chunks: string[] = []
  const io: CliIo = { write: (line) => chunks.push(line) }
  return {
    io,
    text: () => chunks.join("\n"),
    last: () => JSON.parse(chunks[chunks.length - 1] ?? "null"),
  }
}
