// The executor carriage's shared vocabulary (the run request's remnant,
// plans/0282–0283): the request-size bound both processes enforce (the
// worker's argv carriage — one token the kernel caps at 128 KiB, the bound
// half of it), the bridge credential's env name and the transport payload
// (the worker's socket back to the daemon's executor routes) with its
// parser. The push run carriages — the per-run options, the switch
// overrides, the plan/transfer/lane payloads and their validators — are
// tombstoned with the push mode (the worker serves executor coordinators
// only, its request {directory, executor, transport}; the spec's tombstone
// section, auto-core's docs/protocol.md, is the compatibility record).

// A usage error in the run request. The worker turns it into its stderr
// refusal with exit 1 (the CLI convention); the daemon turns it into a 400
// — the message itself is the shared artifact.
export class RequestError extends Error {}

function fail(message: string): never {
  throw new RequestError(message)
}

// The carriage of the worker bridge's per-run secret (plans/0222 D1): the
// spawn environment, never the request document. The OPENCODE_AUTO_ prefix is
// the load-bearing choice — the agent domain's X1 scrub (auto-core
// src/agent/env.ts) removes every OPENCODE_AUTO_* variable from every process
// the driver runs, so no agent session inherits the credential through the
// existing seam, zero core change. The daemon writes it after its own
// OPENCODE_AUTO_* spawn filter; the worker reads it when the transport payload
// is present; the lane launcher strips it (a lane child carries no channel).
export const BRIDGE_TOKEN_ENV = "OPENCODE_AUTO_BRIDGE_TOKEN"


// The spawn carriage bound (plans/0223 D1, the 0165-055 finding): the run
// request rides the worker's argv as ONE token, and the kernel caps a single
// argument string at 128 KiB (MAX_ARG_STRLEN — past it the spawn itself
// throws E2BIG, no process ever exists). The bound is half that: every honest
// request (the directory and the transport URL) is kilobytes.
export const REQUEST_BYTE_LIMIT = 64 * 1024

// The refusal when a serialized run request exceeds the carriage bound. The
// daemon answers it as a 400 before registering anything (startRun measures
// the payload it is about to spawn); the worker entry answers it as its
// stderr usage refusal for a hand-spawned token — the same text either way,
// the shared-validator pattern's own rule.
export function requestTooLarge(serialized: string): string | undefined {
  const bytes = Buffer.byteLength(serialized)
  if (bytes <= REQUEST_BYTE_LIMIT) return undefined
  return (
    `the run request serializes to ${bytes} bytes, over the ${REQUEST_BYTE_LIMIT}-byte spawn carriage: ` +
    `the worker's request rides one argv token, and the kernel caps a single argument string at 128 KiB ` +
    `(the spawn would fail E2BIG before any process exists). ` +
    `Split or trim the request`
  )
}

// The interactive transport payload (P3b): what the daemon writes into the
// spawn request — the worker bridge URL (ws://…/runs/<id>/worker) — and what
// the worker entry builds its Interactive implementation from (with the
// per-run secret, which rides the spawn environment as BRIDGE_TOKEN_ENV —
// never the request document: argv is world-readable through
// /proc/<pid>/cmdline, the environment is not, plans/0222 D1). Daemon-written,
// never client-written: the daemon attaches it to every coordinator it
// spawns (the bridge is its own one WebSocket surface), so a request
// carrying it by hand is a usage error on the daemon side and a validated
// field on the worker side.
export type TransportPayload = { run: string; url: string }

export function parseTransport(raw: unknown): TransportPayload {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail('transport must be an object: { "run": "<run id>", "url": "ws://…/runs/<run id>/worker" }')
  }
  const given = raw as Record<string, unknown>
  for (const key of Object.keys(given)) {
    if (key === "run" || key === "url") continue
    fail(
      key === "token"
        ? `transport.token is not a transport field (run, url): the per-run secret rides the worker's spawn environment (${BRIDGE_TOKEN_ENV}), never the request document`
        : `transport.${key} is not a transport field (run, url)`,
    )
  }
  const run = given.run
  const url = given.url
  if (typeof run !== "string" || !run.trim()) fail('transport.run takes the run id the daemon assigned ("run-<n>")')
  if (typeof url !== "string" || !url.trim()) fail('transport.url takes the worker bridge WebSocket URL ("ws://<host>:<port>/runs/<run id>/worker")')
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    fail(`transport.url is not a URL: ${url}`)
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    fail(`transport.url takes a ws:// or wss:// URL (the worker bridge WebSocket endpoint), not ${parsed.protocol}`)
  }
  return { run, url }
}
