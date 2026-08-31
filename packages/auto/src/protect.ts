import { chmod } from "node:fs/promises"
import { join } from "node:path"

// Read-only guard for driver-owned files: during `run`, PLAN.md, CURRENT.md,
// opencode.json and the persisted project config are chmod'd 0o444 so agent
// sessions cannot modify them by mistake (defense in depth on top of the
// prompt contract — a same-user process could still chmod them back via bash,
// so this is a guardrail, not a security boundary). AGENTS.md is deliberately
// excluded: tasks may update it; runAll only ensures the pointer block exists
// before starting sessions. Driver writes call allowWrite / reprotect around
// each mutation; runAll restores writability in a finally block so a human can
// edit the files (including manual config amendments) after the driver stops.
const FILES = ["PLAN.md", "CURRENT.md", "opencode.json", ".opencode/auto/config.json"]

let enabled = false

async function set(path: string, mode: number) {
  await chmod(path, mode).catch(() => {})
}

export async function protect(dir: string) {
  enabled = true
  for (const file of FILES) await set(join(dir, file), 0o444)
}

export async function unprotect(dir: string) {
  enabled = false
  for (const file of FILES) await set(join(dir, file), 0o644)
}

// No-ops when protection is not active (tests, one-off scripts).
export async function allowWrite(path: string) {
  if (enabled) await set(path, 0o644)
}

export async function reprotect(path: string) {
  if (enabled) await set(path, 0o444)
}
