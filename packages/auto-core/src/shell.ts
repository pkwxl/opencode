// Shell profile: the shell-level parameters of core messages and log-audit
// semantics (set once at shell-entry startup via setShellProfile, see
// plans/AUTO_CORE_INTEGRATION_PLAN stage two). Core code only reads the
// profile and never knows a concrete shell — the behavioral differences
// between the general shell (auto) and the simple shell (migrate) (message
// program name, agent-contract recovery guidance, log-audit semantics) are
// all parameterized through this, eliminating shell patches over
// runner/loop text.
import type { AgentCapabilities, AgentHostFactory } from "./agent/types"
import { setAuditLog } from "./log"

// The process a lane launcher returns (plans/0068 §6.4, D2): the pid the
// dispatch registry records, the exit promise the lane loop awaits and the
// piped output streams the loop drains (a full pipe would deadlock the
// worker) and reads back for the failure matrix's relays. Structural on
// purpose: Bun.spawn with `stdout: "pipe"` satisfies it, and a test double
// satisfies it with an already-exited stub and no process at all — the
// launcher is the seam the shell contract keeps shell-free.
export type LaneWorker = {
  pid?: number
  exited: Promise<number>
  stdout?: ReadableStream<Uint8Array> | null
  stderr?: ReadableStream<Uint8Array> | null
}

// The merge instruction a conflict repair's re-dispatch carries (plans/0068
// D7's conflict path, S3): `merge` names the parent's current main branch the
// lane worker merges into its lane branch before running the unit. The
// instruction exists only on a repair re-dispatch — absent on every ordinary
// one — so a worker that sees it knows exactly why it was re-dispatched.
export type LaneMergeInstruction = { merge: string }

// The self-invocation vector (plans/0213 D1, enacting 0165-011 / S06-05):
// how this process re-invokes its own CLI entry, derived from the process
// shape rather than assumed a spawnable script path. `argv1` is the entry
// this process started from (the caller passes process.argv[1]):
//   - a real path (the source layout `bun src/index.ts`, a bundle under
//     `bun dist/index.js`) — `{ command: execPath, prefix: [argv1] }`: the
//     interpreter re-runs the entry, today's vector exactly;
//   - a Bun-compiled binary's virtual entry (argv[1] = `/$bunfs/root/<name>`
//     — `bun build --compile` embeds the modules on Bun's virtual $bunfs,
//     where a script path cannot be spawned; the child would read the
//     virtual path as its command and refuse) or no entry at all —
//     `{ command: execPath, prefix: [] }`: process.execPath already IS the
//     program (the compiled binary), whose argv goes straight to command
//     dispatch. The structural fact alone is encoded — no shell, no entry
//     file name (the service shell's own twin, worker-command.ts, probes
//     its sibling entry instead: a shell fact the core cannot own).
export function selfInvoke(argv1: string | undefined): { command: string; prefix: string[] } {
  if (argv1 !== undefined && !argv1.startsWith("/$bunfs/")) return { command: process.execPath, prefix: [argv1] }
  return { command: process.execPath, prefix: [] }
}

// The default lane launcher: re-invoke this shell's CLI with the hidden
// `_lane` subcommand (§6.4 — "re-invoke this shell's CLI with the hidden lane
// subcommand") through the self-invocation vector above (both shapes — the
// source layout's entry path and the compiled binary itself, plans/0213 D1).
// A host that owns its workers differently (a test, a 0067 daemon worker)
// overrides the profile field.
// A repair re-dispatch's merge instruction rides along as `--merge <branch>`
// (the hidden subcommand's own option). The optional env record is tier 1's
// cache-home injection (plans/0096 D9): the declared cache variables resolved
// to shared and per-lane paths, merged over the inherited environment —
// absent on every other dispatch, so the child's env is exactly as before.
export function defaultLaneLauncher(worktree: string, unit: string, instruction?: LaneMergeInstruction, env?: Record<string, string>): LaneWorker {
  const self = selfInvoke(process.argv[1])
  return Bun.spawn(
    [self.command, ...self.prefix, "_lane", worktree, "--unit", unit, ...(instruction ? ["--merge", instruction.merge] : [])],
    env === undefined ? { stdout: "pipe", stderr: "pipe" } : { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } },
  )
}

export type ShellProfile = {
  // The run-time program name: for the message pattern "re-run X"
  // (general shell: "opencode-auto run").
  program: string
  // The management-subcommand prefix: for the message pattern
  // "run X init <dir>" ("opencode-auto").
  bin: string
  // Recovery guidance when the agent contract is missing: "init" = hint at
  // running the init subcommand to rebuild it (general shell); "startup" =
  // the shell rebuilds the default contract from the template at every
  // startup, so the hint is simply to re-run the shell (simple shell).
  agentRecovery: "init" | "startup"
  // true = the log file always records in full (vlog exempt from the
  // verbose gate, every line timestamped), making the run log a complete
  // audit record independent of options (simple-shell semantics);
  // false = detail recorded only under --verbose.
  auditLog: boolean
  // Agent profile (MA.4, plans/0040): the coding agent this shell drives.
  // Absent = the built-in opencode adapter (loop.ts falls back to it), so a
  // shell that never sets it behaves exactly as before. What the agent can do
  // is not declared here: it comes from the host's client capabilities and the
  // driver degrades per flag at run start (src/capability.ts).
  agent?: AgentProfile
  // The directory under $XDG_CONFIG_HOME (default ~/.config) that holds the
  // operator layer of the model registry, `<configDir>/models.json`
  // (src/models.ts). OPENCODE_AUTO_MODELS overrides the whole path.
  configDir: string
  // The lane worker launcher (plans/0068 §6.4, D2): spawns the child process
  // that runs one lane's unit-scoped runAll in its worktree. Absent = the
  // default — re-invoke this shell's CLI (`_lane <dir> --unit <id>`,
  // defaultLaneLauncher above); the shell contract's §E item makes that
  // entry a shell obligation. A host that owns its workers differently (a
  // 0067 daemon's "register a worker", a test's bootstrap script) injects
  // its own here; the core never names a shell. The third argument is the
  // merge instruction of a conflict repair's re-dispatch (S3, D7): present
  // only there, so a launcher that spawns the ordinary entry forwards it as
  // the repair dispatch's one extra fact. The fourth is the cache-home
  // injection of a tier-1 dispatch (plans/0096 D9): a record of environment
  // variables the child should see (the declared shared/per-lane cache
  // paths); absent on every dispatch that is not tier 1.
  laneLauncher?: (worktree: string, unit: string, instruction?: LaneMergeInstruction, env?: Record<string, string>) => LaneWorker
  // The person-facing surface names of this shell's task-running, planning
  // and advancing channels, as the core's served stop lines render them
  // (plans/0193 D3): a service shell whose runs and planning are HTTP
  // operations — not `<bin> run` / `<bin> plan` subcommands — supplies its
  // own renderers so no served line teaches a command its binary refuses.
  // Per-channel partial: a channel left absent renders the default CLI
  // subcommand shape (`<bin> run <dir>` etc.) — the general shell's exact
  // wording, and the right shape for any channel a shell keeps as a real
  // subcommand. `dir` is the target directory when the line names one (a
  // renderer may fold it into its own addressing); `flags` is the CLI
  // grammar tail a teaching carries (`-p <text> | --file <path>` and kin) —
  // the CLI's grammar, not the renderer's: a renderer without that grammar
  // restates or drops it.
  surface?: Partial<ShellSurface>
}

// One served channel's renderer (see ShellProfile.surface). A call without
// arguments names the channel bare (`opencode-auto plan`) — the shape a
// remedy like "run X to establish the round" embeds.
export type ShellSurface = {
  run: (dir?: string, flags?: string) => string
  plan: (dir?: string, flags?: string) => string
  transfer: (dir?: string, flags?: string) => string
}

export type AgentProfile = {
  // Display name for the startup line (e.g. "opencode", "claude").
  name: string
  // Starts or connects the agent for a run.
  host: AgentHostFactory
}

// Defaults = the general shell (auto) status quo; with no profile set,
// core messages and historical behavior are byte-for-byte identical.
const DEFAULTS: ShellProfile = {
  program: "opencode-auto run",
  bin: "opencode-auto",
  agentRecovery: "init",
  auditLog: false,
  configDir: "opencode-auto",
}

let profile: ShellProfile = DEFAULTS

// Called at shell-entry startup (partial override, merged onto the previous
// value; repeated calls are idempotent); auditLog wires the log layer.
export function setShellProfile(part: Partial<ShellProfile>): void {
  profile = { ...profile, ...part }
  setAuditLog(profile.auditLog)
}

export function shellProfile(): ShellProfile {
  return profile
}

// The served-surface renderers in force: the profile's own channels merged
// over the default CLI subcommand shapes built on the profile's bin (plans/
// 0193 D3) — a shell overrides only the channels that are not subcommands of
// its binary. The defaults render exactly the general shell's historical
// wording — `<bin> run <dir>`, the bare channel name without a directory,
// the flags tail verbatim — so an absent surface (or channel) changes
// nothing.
export function surfaceOf(): ShellSurface {
  const bin = profile.bin
  const render = (command: string) => (dir?: string, flags?: string) => `${bin} ${command}${dir !== undefined ? ` ${dir}` : ""}${flags !== undefined ? ` ${flags}` : ""}`
  return {
    run: render("run"),
    plan: render("plan"),
    transfer: render("transfer"),
    ...profile.surface,
  }
}

// An agent adapter a shell registers (plans/0055 §8.8): the host factory that
// starts or connects the agent, plus the adapter's static capabilities — the
// record the pool degrades on before any host starts (§8.5: lazy start means
// capabilities must be known without spawning; the builtin adapters expose
// theirs through their entry modules, src/agent-pool.ts). Registering an
// adapter never changes a run by itself: a registry profile must name the
// adapter before anything dispatches on it.
// AUTO-DECISION: the registration carries the capabilities beside the factory instead of the pool reading them off a started client (§8.5 names "a static per-adapter capability record exposed with the factory" as the shape; a shell adapter knows what it can do before it runs, and the builtin opencode/claude records already exist as constants)
export type AgentAdapter = {
  host: AgentHostFactory
  capabilities: AgentCapabilities
  // The adapter's default executable for preflight's `<bin> --version` check
  // (§8.7); absent = the check skips the adapter's profiles unless a profile
  // declares its own `bin`.
  bin?: string
}

const adapters = new Map<string, AgentAdapter>()

// Registers an agent adapter under `name` (idempotent; the last registration
// wins, like setShellProfile). After it, the model registry's `adapter` field
// accepts `name` (src/models.ts reads registeredAdapterNames), and a profile
// naming it starts through the factory.
export function registerAgentAdapter(name: string, adapter: AgentAdapter): void {
  adapters.set(name, adapter)
}

// The adapter a shell registered under `name`; undefined for the builtins
// ("opencode", "claude"), whose factories the pool itself holds.
export function shellAdapter(name: string): AgentAdapter | undefined {
  return adapters.get(name)
}

// Every adapter name a shell registered (no builtins). The registry loader
// accepts these beside its builtin list.
export function registeredAdapterNames(): string[] {
  return [...adapters.keys()]
}

// Tests reset the registry (one Bun process runs many test files).
export function resetShellAdapters(): void {
  adapters.clear()
}
