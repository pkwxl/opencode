import { chmod } from "node:fs/promises"
import { join } from "node:path"
import { ANALYSIS_DOC } from "./docpaths"
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
// every exit path restores writability so a human can edit the files
// (including manual config amendments) after the driver stops — driveRun's
// finally for the run's own exits (plans/0236 D3 gave preflight's protected
// stops their own unprotect at the stopBlocked helper), and the
// force-terminate cleanup for the signal paths.
// The file list is the driverState role's fixed-location files
// (document/roles.ts PROTECTED_FILES, M2.3) plus the contract surface AGENTS.md,
// the model registry's project layer (plans/0055 §4.1), the bundle
// provenance sidecar (plans/0100 D1) and the project analysis (plans/0172
// D3, 0165-093). The project layer
// is the operator's, not driverState: the driver reads it once at run start and
// never writes it, so it has no allowWrite path, and it goes read-only while a
// session runs as opencode.json does. Its path is src/models.ts MODELS_FILE,
// spelled out because this document-domain module imports nothing from the
// driver plane; test/protect.test.ts pins the two together. The provenance
// sidecar is the same shape of state (committed, written only by init's
// materialization and the person's sync — never mid-run; sync refuses under a
// live run lock), spelled out from src/provenance.ts PROVENANCE_FILE for the
// same layering reason. The analysis is the person's between-commands
// governance document: its release mark, roadmap lines and round-brief
// proposals all act with the person's authority, the driver never writes it
// during a run (the stub is plan's row, the release is clarify's or the
// person's hand — commands, protection off), and a run-time session has no
// legitimate write to it (plans/0084: the drafting agent works interactively
// at stops, never as a driver-driven session) — the brief's precedent, its
// path spelled out from src/docpaths.ts ANALYSIS_DOC and pinned beside it in
// test/protect.test.ts.
//
// Beside the fixed-role set stands the declared sealed-path set (plans/0132
// D4): the vetted channel the wall commit froze — the sealing phase's
// artifacts, derived from the wall commit at run start (the caller passes it
// in; this near-leaf module derives nothing from git) and extended mid-run by
// the wall's own close (protectAdditional). Declared, not fixed-role: the
// paths keep whatever document role they already carry; the freeze is the
// wall's invariant (checked as the one git-diff assertion at phase close),
// and this set is its guardrail half — the same words bound the claim as
// PROTECTED_FILES' own.
// AUTO-RESOLVE: does a run keep the project layer's own mode (say 0o600) or leave it 0o644 like the other files? -> the same fixed modes as the other files, 0o444 during run and 0o644 after (the layer holds references, never a key, and one mode rule keeps a killed run's leftovers repairable by the next run's unprotect)
const FILES = [...PROTECTED_FILES, "AGENTS.md", ".opencode/auto/models.json", ".opencode/auto/provenance.json", ANALYSIS_DOC]

let enabled = false
let sealed: string[] = []

async function set(path: string, mode: number) {
  await chmod(path, mode).catch(() => {})
}

export async function protect(dir: string, sealedPaths: readonly string[] = []) {
  enabled = true
  sealed = [...sealedPaths]
  for (const file of [...FILES, ...sealed]) await set(join(dir, file), 0o444)
}

// The wall's mid-run close (plans/0132 D4): the sealed channel joins the
// read-only set for the rest of the run — no-ops when protection is not
// active (tests, one-off scripts); the phase-close diff check owns the
// invariant regardless.
export async function protectAdditional(dir: string, paths: readonly string[]) {
  if (!enabled || !paths.length) return
  sealed = [...sealed, ...paths.filter((path) => !sealed.includes(path))]
  for (const path of sealed) await set(join(dir, path), 0o444)
}

export async function unprotect(dir: string) {
  enabled = false
  for (const file of [...FILES, ...sealed]) await set(join(dir, file), 0o644)
  sealed = []
}

// No-ops when protection is not active (tests, one-off scripts).
export async function allowWrite(path: string) {
  if (enabled) await set(path, 0o644)
}

export async function reprotect(path: string) {
  if (enabled) await set(path, 0o444)
}
