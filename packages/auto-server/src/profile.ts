// The shell profile of the headless service shell (shell-contract §C.1): the
// server shape of opencode-auto — a daemon supervising per-run worker
// processes and exposing the driver over HTTP (REST + SSE), per the headless
// service evolution draft (auto-core plans/0067). The profile is set once at
// shell-entry startup; the core reads it and never knows this shell.
import { setShellProfile, type ShellProfile } from "@opencode-ai/auto-core/shell"

// AUTO-DECISION (profile fields):
// - program/bin "opencode-auto-server": the core's "re-run <program>" and
//   "<bin> <subcommand>" message patterns name this binary.
// - agentRecovery "startup": the server ships no interactive `fix` command —
//   its config-fix routes arrive with the REST lifecycle surface — so the
//   core's recovery hints must not name one; "startup" points at re-running
//   the shell itself.
// - auditLog true: the service is unattended, so the run log always records
//   in full regardless of options — the log file is the audit trail.
// - configDir keeps the default "opencode-auto": the operator model registry
//   is shared with the CLI shell (one operator, one registry).
export const SERVER_PROFILE: Partial<ShellProfile> = {
  program: "opencode-auto-server",
  bin: "opencode-auto-server",
  agentRecovery: "startup",
  auditLog: true,
}

// Sets the profile (idempotent, like setShellProfile itself). Called first at
// shell entry, before any core message can be shaped.
export function applyServerProfile(): void {
  setShellProfile(SERVER_PROFILE)
}
