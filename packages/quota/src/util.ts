// Small shared helpers for the adapters.

export const DEFAULT_TIMEOUT_MS = 10_000

/** The one user-facing credential error (plan 0066 §10); never carries server message text. */
export const INVALID_TOKEN_401 = "token 已失效，请重新粘贴（401）"

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

export function asRec(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Error message for a thrown fetch — generic on purpose; causes may embed URLs or request material. */
export function fetchErrorMessage(e: unknown, timeoutMs: number): string {
  const name = (e as { name?: string } | undefined)?.name
  if (name === "TimeoutError" || name === "AbortError") return `查询超时（${timeoutMs}ms）`
  return "网络错误"
}
