// The shell profile of the headless service shell (shell-contract §C.1): the
// server shape of opencode-auto — a daemon supervising per-run worker
// processes and exposing the driver over HTTP (REST + SSE), per the headless
// service evolution draft (auto-core plans/0067). The profile is set once at
// shell-entry startup; the core reads it and never knows this shell.
import { setShellProfile, type ShellProfile } from "@opencode-ai/auto-core/shell"
import { workerCommand } from "./worker-command"

// The lane launcher (plans/0162, the shell-contract §E item 8 obligation met
// through the profile's own override): a lane child is a worker of this
// binary carrying a lane payload — the same self-spawn shape the daemon
// performs per run and the CLI's hidden `_lane` entry provides on its side.
// Runs in the WORKER process (the parent run dispatches lanes mid-runAll),
// which is why the command derivation lives in src/worker-command.ts —
// importing the daemon module here would cycle, and the daemon is not this
// process. The environment is the parent's own plus the launcher's injection
// (the tier-1 cache homes) — inherited, exactly the default launcher's
// contract; a `serve --launch` confinement the parent worker runs under
// covers the child the same way (a child of a confined process is inside the
// confinement), and per-run OPENCODE_AUTO_* switches applied to the parent's
// environment ride the inheritance too.
const laneLauncher: NonNullable<ShellProfile["laneLauncher"]> = (worktree, unit, instruction, env) => {
  const self = workerCommand()
  return Bun.spawn(
    [self.command, ...self.prefix, "worker", JSON.stringify({ directory: worktree, lane: { unit, ...(instruction ? { merge: instruction.merge } : {}) } })],
    // The environment is always spelled out: Bun's bare spawn inherits the
    // process's INITIAL environment (a runtime write to process.env — this
    // worker's applySwitches — never reaches a bare child; probed
    // 2026-11-01), and a lane child must see the parent's applied switch
    // layer (OPENCODE_AUTO_AGENT among them — the CLI's own children inherit
    // it because a shell exported it before the process started; this
    // shell's worker applies the request's switches at runtime). The
    // launcher's injection (the tier-1 cache homes) merges over it, exactly
    // the default launcher's {...process.env, ...env} shape.
    { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...(env ?? {}) } },
  )
}

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
// - laneLauncher: above — width ≥ 2 is served since plans/0162, and the
//   default launcher's `process.argv[1]` re-invocation cannot answer on this
//   shell (its hidden entry is `worker '<json>'`, not `_lane`), so the
//   override is the shell's own obligation, not an optimization.
export const SERVER_PROFILE: Partial<ShellProfile> = {
  program: "opencode-auto-server",
  bin: "opencode-auto-server",
  agentRecovery: "startup",
  auditLog: true,
  laneLauncher,
}

// Sets the profile (idempotent, like setShellProfile itself). Called first at
// shell entry, before any core message can be shaped.
export function applyServerProfile(): void {
  setShellProfile(SERVER_PROFILE)
}
