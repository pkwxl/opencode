// The admission oracle (plans/0188 D1, 0166 step 028; 0165 S20-13's remedy —
// "a test helper importing core/src/util/wildcard.ts that evaluates the
// stamped file for the read, edit and /tmp cases", the R7-perm lead the
// seed). It judges a config's permission section exactly as opencode does —
// not the driver's own reduced re-reading of it — so the stamp suites pin
// what a stamped file ADMITS, never key order alone.
//
// The matcher is opencode's own, imported from the workspace source: a
// copied matcher would be a second source that drifts silently (P5), while
// this import fails loudly the day the matcher moves — which is the oracle
// doing its job. Test-only (the import-direction ratchet scans src/; src
// carries no opencode-package edge — the SDK seam is the adapter's, and the
// matcher is not in it).
//
// Mirrored from opencode's permission layer (packages/opencode/src/permission/index.ts):
// fromConfig preserves an object's key order and expands `~`/`$HOME`; a bare
// string action is the pattern `"*"`; evaluate is findLast over the rules
// with BOTH the permission name and the pattern matched, the unmatched
// default "ask".
import { match } from "../../../core/src/util/wildcard"
import os from "node:os"

// The matcher itself, re-exported for the suites' mirror pins (0188 D2):
// src/external-dirs.ts mirrors the translation, and the pin below compares
// the mirror's verdicts against this, the real one.
export { match }

export type OracleRule = { permission: string; pattern: string; action: string }

// fromConfig's expansion (the driver never stamps these forms; a person's
// file may carry them, and the oracle must judge the file as opencode does).
function expand(pattern: string): string {
  if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
  if (pattern === "~") return os.homedir()
  if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
  if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
  return pattern
}

// One permission section's rules in file key order (a bare action is the
// pattern "*" — opencode's own shape for it).
export function rulesOf(permission: string, section: Record<string, string> | string): OracleRule[] {
  if (typeof section === "string") return [{ permission, pattern: "*", action: section }]
  return Object.entries(section).map(([pattern, action]) => ({ permission, pattern: expand(pattern), action }))
}

// opencode's evaluate: the LAST rule whose permission name and pattern both
// match wins; no match answers "ask".
export function evaluate(rules: readonly OracleRule[], permission: string, ask: string): "allow" | "deny" | "ask" {
  const hit = [...rules].findLast((rule) => match(permission, rule.permission) && match(ask, rule.pattern))
  return (hit?.action as "allow" | "deny" | "ask") ?? "ask"
}

// What one config text answers for one ask on one permission section:
// "allow", "deny" or "ask" (also the answer of a malformed text or an absent
// section — opencode evaluates no rule there either).
export function admission(text: string, section: "external_directory" | "edit", ask: string): "allow" | "deny" | "ask" {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return "ask"
  }
  const value = (parsed as { permission?: Record<string, unknown> } | undefined)?.permission?.[section]
  if (value === undefined) return "ask"
  if (typeof value !== "string" && (typeof value !== "object" || value === null)) return "ask"
  return evaluate(rulesOf(section, value as Record<string, string>), section, ask)
}
