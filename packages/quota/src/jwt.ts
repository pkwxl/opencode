// JWT helpers: payload decoding without verification (plan 0066 §4) and the
// masking utilities the C4 discipline (plan 0066 §2) requires — token material
// never appears in code, logs, errors, or output; only masked fingerprints do.

const STALE_MS = 24 * 60 * 60 * 1000

/**
 * Decode a JWT payload (base64url, no signature check). Fails soft — returns
 * undefined for any non-JWT or undecodable payload. zhipu's web JWT payload is
 * not valid JSON (a control byte replaces a comma), so this must never throw.
 */
export function jwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".")
  if (parts.length !== 3) return undefined
  const payload = parts[1]
  if (payload === "") return undefined
  let json: string
  try {
    json = Buffer.from(payload, "base64url").toString("utf8")
  } catch {
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(json)
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}

/** Numeric `exp` (seconds since epoch) from the payload, or undefined. */
export function jwtExp(token: string): number | undefined {
  const exp = jwtPayload(token)?.exp
  return typeof exp === "number" && Number.isFinite(exp) ? exp : undefined
}

/** `expiresAt` converted to epoch ms (the JWT's exp is seconds) + staleness flag (<24h left). */
export function expiryInfo(token: string, now: number = Date.now()): { expiresAt?: number; stale?: boolean } {
  const exp = jwtExp(token)
  if (exp === undefined) return {}
  const expiresAt = exp * 1000
  return { expiresAt, stale: expiresAt - now < STALE_MS }
}

/** Masked fingerprint for display: first 4 + last 4 chars, e.g. `eyJ…X5uT`. */
export function maskToken(token: string): string {
  return token.length >= 12 ? `${token.slice(0, 4)}…${token.slice(-4)}` : "…"
}

/**
 * Mask a server-provided message before putting it into an error: redact any
 * long credential-shaped run (JWT/hex/base64) and cap the length.
 */
export function maskText(text: string): string {
  const redacted = text.replace(/[A-Za-z0-9_-]{32,}/g, "***")
  return redacted.length > 120 ? `${redacted.slice(0, 117)}…` : redacted
}
