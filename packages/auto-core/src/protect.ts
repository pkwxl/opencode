import { chmod } from "node:fs/promises"
import { join } from "node:path"
import { PROTECTED_FILES } from "./document/roles"

// Read-only guard for driver-owned files: during `run`, opencode.json, the
// persisted project config, AGENTS.md and the model registry's project layer
// are chmod'd 0o444 so agent sessions
// cannot modify them by mistake (defense in depth on top of the prompt
// contract — a same-user process could still chmod them back via bash, so
// this is a guardrail, not a security boundary). AGENTS.md holds only the
// driver's block, which sessions no longer maintain (plans/0054 D2); preflight
// syncs the block through ensurePointer, which unlocks and reprotects around
// its write. Driver writes call allowWrite / reprotect around each mutation;
// runAll restores writability in a finally block so a human can edit the
// files (including manual config amendments) after the driver stops.
// The file list is the driverState role's fixed-location files
// (document/roles.ts PROTECTED_FILES, M2.3) plus the contract surface AGENTS.md
// and the model registry's project layer (plans/0055 §4.1). The project layer
// is the operator's, not driverState: the driver reads it once at run start and
// never writes it, so it has no allowWrite path, and it goes read-only while a
// session runs as opencode.json does. Its path is src/models.ts MODELS_FILE,
// spelled out because this document-domain module imports nothing from the
// driver plane; test/protect.test.ts pins the two together.
// AUTO-RESOLVE: does a run keep the project layer's own mode (say 0o600) or leave it 0o644 like the other files? -> the same fixed modes as the other files, 0o444 during run and 0o644 after (the layer holds references, never a key, and one mode rule keeps a killed run's leftovers repairable by the next run's unprotect)
const FILES = [...PROTECTED_FILES, "AGENTS.md", ".opencode/auto/models.json"]

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
