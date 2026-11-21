// The shell profile of the headless service shell (shell-contract §C.1): the
// server shape of opencode-auto — a daemon supervising per-run worker
// processes and exposing the driver over HTTP (REST + SSE), per the headless
// service evolution draft (auto-core plans/0067). The profile is set once at
// shell-entry startup; the core reads it and never knows this shell.
import { setShellProfile, type ShellProfile } from "@opencode-ai/auto-core/shell"

// AUTO-DECISION (profile fields):
// - program/bin "opencode-auto-server": the core's "re-run <program>" and
//   "<bin> <subcommand>" message patterns name this binary.
// - agentRecovery "startup": the core's recovery hints for a missing agent
//   contract must name a remedy this binary actually serves — `fix` is an
//   operation here (POST /projects/<project>/fix), not a subcommand, so the
//   "init" value's `run <bin> fix <dir>` hint shape would teach a command
//   this shell refuses; "startup" keeps the hint off the false subcommand
//   shape, pointing at re-running the shell itself.
// - auditLog true: the service is unattended, so the run log always records
//   in full regardless of options — the log file is the audit trail.
// - configDir keeps the default "opencode-auto": the operator model registry
//   is shared with the CLI shell (one operator, one registry).
// - laneLauncher: retired (plans/0283, the push lane workers' demolition) —
//   the worker refuses every non-executor payload, so no launcher is
//   registered; concurrency rides the executor protocol's scoped/doc lease
//   tiers, external workers claiming grants.
// - surface (plans/0193 D3, re-keyed by plans/0282/0283): the run, plan,
//   transfer and task-entry channels are HTTP operations of the daemon (or
//   the executor protocol itself), never subcommands of this binary, so the
//   core's teachings name them with their routes. The CLI-grammar tails are
//   dropped: a daemon client never spells a flag.
export const SERVER_PROFILE: Partial<ShellProfile> = {
  program: "opencode-auto-server",
  bin: "opencode-auto-server",
  agentRecovery: "startup",
  auditLog: true,
  surface: {
    run: () => "the executor protocol (POST /projects/<p>/executor/claim — execute grants)",
    plan: () => "the plan operation (POST /projects/<p>/plan)",
    transfer: () => "the transfer operation (POST /projects/<p>/transfer)",
    tasks: () => "the task-add operation (POST /projects/<p>/tasks)",
  },
}

// Sets the profile (idempotent, like setShellProfile itself). Called first at
// shell entry, before any core message can be shaped.
export function applyServerProfile(): void {
  setShellProfile(SERVER_PROFILE)
}
