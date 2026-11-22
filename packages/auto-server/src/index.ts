#!/usr/bin/env bun
// Entry point of the headless automation service shell (bin
// opencode-auto-server): the server shape of opencode-auto, where a daemon
// supervises one worker child process per run and exposes the driver over
// HTTP (REST + SSE). This entry carries the package's process surfaces: the
// worker (P1b — one run per child process, exit code the run's own) and the
// daemon with its CLI-side duties (P1c — serve, plus the whitelist and token
// management in the daemon's own data directory). The REST lifecycle surface
// (config ops, units, the P1 plan boundary) is served by the daemon
// (P1d, src/ops.ts), as is the disk observability surface (P1e, src/observe.ts
// — the polled status read model and the SSE log/journal tails).
//
// Dependency line (constitutional): this package imports @opencode-ai/auto-core
// and Node/Bun builtins only — never @opencode-ai/core, @opencode-ai/protocol,
// @opencode-ai/sdk, the monorepo server package or any Effect infrastructure;
// the server is self-contained on Bun.serve with zero added runtime
// dependencies. test/isolation.test.ts holds that line as an assertion.
import { dirname, resolve } from "node:path"
import { accessSync, constants, lstatSync, rmSync, statSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { applyServerProfile } from "./profile"
import { parseEnvFile } from "./env-boot"
import { DEFAULT_HOSTNAME, DEFAULT_PORT, deriveWorkerCommand, startDaemon } from "./daemon"
import { defaultDataDir, DaemonStore, SCOPES, StoreError } from "./store"
import { resolvedLine, VERSION } from "./version"
import { runExecutorHub } from "./executor-hub"
import { runWorker } from "./worker"

const USAGE = `usage:
  opencode-auto-server --help
  opencode-auto-server --version
  opencode-auto-server serve [--port <n>] [--host <addr>] [--data-dir <dir>] [--env-file <path>]
  opencode-auto-server register <directory> [--data-dir <dir>]
  opencode-auto-server unregister <name-or-directory> [--data-dir <dir>]
  opencode-auto-server projects [--data-dir <dir>]
  opencode-auto-server token issue --scopes <read,control,…> [--name <label>] [--out <file>] [--data-dir <dir>]
  opencode-auto-server token list [--data-dir <dir>]
  opencode-auto-server token revoke <name> [--data-dir <dir>]
  opencode-auto-server executor-hub [--resume] CONNECTION PROJECT CHANNEL execute|verify|fix|formulate|synthesize|distill|audit COMMAND [ARG ...]
  opencode-auto-server worker '<coordinator request JSON>'

opencode-auto-server is the headless automation service shell of opencode-auto:
a daemon that runs the driver over HTTP and streams run state (REST + SSE).
The worker runs exactly one run in one target directory as a child process
and exits with the run's own code (0 all complete; 1 usage/environment error;
2 blocked awaiting a human; 3 graceful exit pause; 130 force-terminated).
v1 boundary: single machine, multiple directories (see docs/daemon.md).

serve — the daemon (P1c/P1d/P1e; pull-only since plans/0282). Binds
  ${DEFAULT_HOSTNAME}:${DEFAULT_PORT} by default (v1 is single-machine;
  widen with --host at your own trust boundary) and serves coding agents
  only — no web client, no ask channel, the protocol doing nothing via
  push. The executor protocol rides POST /projects/<project>/executor/<op>
  (ready/claim/brief/report/heartbeat/release — the executor scope, the
  standing spec auto-core's docs/protocol.md); each project's coordinator
  is one spawned worker, its bridge socket the daemon's one WebSocket
  surface. The deterministic operations (the control scope, in-process —
  git and document writes only): init, amend, fix, reset (the config
  scope), close, tasks (task-add), plan (the no-agent prelude routes; the
  planning session itself is pull-only formulate work over the protocol),
  transfer (the person-bracketed advance: the apply halves alone, the
  distillation and synthesis the distill/synthesize grants'), clarify (the
  person's release act). The
  observability surface (P1e, the read scope): GET
  /projects/<project>/status, /log, /events (SSE tails) and
  /status-events (the typed driver-events stream with event-id cursoring);
  GET /runs, GET /runs/<id>, DELETE /runs/<id> (kill) observe the spawned
  coordinators. Destructive operations take two separate fields —
  "confirm" and "cleanTree" — never one bundled force. Stopping the daemon
  leaves live coordinators running to completion; the run lock arbitrates
  any successor.
  --env-file <path> — the daemon's environment declaration (plans/0265):
  NAME=VALUE lines ('#' comments, blank lines, a later duplicate wins; values
  literal bytes — no quoting, no interpolation) loaded at boot into the
  daemon's environment, the file's names winning over the inherited shell's.
  The durable form of the carrier the confinement launcher reads, so a
  restart does not depend on the launching shell's memory. Beside it, every
  start writes the effective environment's NAMES (presence only, never
  values) to <data-dir>/env-manifest.json and warns at boot about names the
  carrier lost since the previous boot and about model-registry references
  that do not resolve — the blocked-run discoveries of the adoption site's
  evening, moved to the boot line.

register — add a target directory to the daemon's whitelist. The whitelist
  is absolute: every project-scoped route resolves the registry (by name
  or by the registered absolute path) and nothing else; the daemon never
  resolves an arbitrary request path. The registry lives in the daemon's own data
  directory (--data-dir; default $XDG_CONFIG_HOME/opencode-auto/server,
  ~/.config/opencode-auto/server on a plain machine) — never inside a
  project, never under .auto/.

token — manage bearer tokens and their scopes (plans/0282's six): read
  (status/logs/events), control (kill, close, task-add and the plan/
  transfer/clarify/reconcile operations), config (init/amend/fix/reset), probe (the
  model probe, POST /projects/<project>/models — opt-in and disabled by
  default), executor (the executor protocol), projects (the project lifecycle:
  POST /projects creation and DELETE /projects/<project>, plans/0284).
  The ask channel's answer/person scopes are tombstoned.
  Unauthenticated requests
  get 401, a token without the route's scope 403. The plaintext token is
  printed once at issue, or with --out <file> written direct to that file
  mode 0600 instead (a fresh path in an existing writable directory —
  never overwriting, never creating directories, and nothing of the
  credential on stdout); the store keeps only its digest either way.

worker '<coordinator request JSON>' — the unit the daemon spawns (P1b,
narrowed to the executor carriage by plans/0282). The JSON document holds:
  directory  (required) the target directory of the coordinator
  executor   true, always — the coordinator worker is the one shape; the
             protocol does nothing via push, ever again (plans/0282), so
             plain runs, planning sessions, transfers and lanes are
             pull-only work on the executor protocol (execute/verify/fix/
             formulate/synthesize/distill/audit grants over
             POST /projects/<project>/executor), never spawned. The
             retired payloads (options, switches, plan, transfer, lane)
             are tombstoned: the worker refuses every field beyond
             {directory, executor, transport}, and the spec's tombstone
             section (auto-core's docs/protocol.md) is the compatibility
             record
  transport  the bridge URL payload { run, url } (required — the worker's
             socket back to the daemon's executor routes, the daemon's one
             WebSocket surface). The per-run secret rides the worker's
             spawn environment (OPENCODE_AUTO_BRIDGE_TOKEN), never the
             request document — argv is world-readable (plans/0222)

the worker's stdin is closed: the coordinator's interactions ride the
bridge alone`

// The profile is set before anything else (shell-contract §E.2: set once at
// shell-entry startup), so every core message the entry reaches is shaped by
// it already.
applyServerProfile()

const args = process.argv.slice(2)

// The child's argv is opaque to the host, including its help/version flags.
if (args[0] === "executor-hub" && args[1] !== "--help" && args[1] !== "-h") {
  try {
    await runExecutorHub(args.slice(1))
  } catch (error) {
    refuse(error instanceof Error ? error.message : String(error))
  }
  process.exit(0)
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(USAGE)
  process.exit(0)
}

if (args.includes("--version") || args.includes("-v")) {
  console.log(`opencode-auto-server ${VERSION}`)
  process.exit(0)
}

// Usage refusal: stderr + exit 1, the CLI convention.
function refuse(message: string): never {
  console.error(message)
  process.exit(1)
}

// --data-dir is the one flag every daemon-side command takes: where the
// whitelist and the tokens live (default under the XDG config root).
// Returns the remaining arguments.
function takeDataDir(argv: string[]): { dataDir: string; rest: string[] } {
  const rest: string[] = []
  let dataDir: string | undefined
  for (let at = 0; at < argv.length; at++) {
    if (argv[at] === "--data-dir") {
      const value = argv[at + 1]
      if (!value || value.startsWith("--")) refuse("--data-dir takes the daemon data directory as its value")
      dataDir = value
      at++
      continue
    }
    rest.push(argv[at]!)
  }
  return { dataDir: dataDir ?? defaultDataDir(), rest }
}

// The daemon-side commands' shared error surface: store problems are usage
// errors of this shell (stderr, exit 1).
function runStored(action: () => void): void {
  try {
    action()
  } catch (error) {
    if (error instanceof StoreError) refuse(error.message)
    throw error
  }
}

// The --out arm of token issue (plans/0268, the 0264-06 remedy): the
// credential's one clean delivery — written direct to the operator's file
// mode 0600 and never to stdout, so a transcript, log or captured pipe
// never carries it and a script storing the token needs no line-picking
// (the finding's wrong-line grab). The status and shown-once lines stay
// on stdout byte-identical. The path is taught first, proven after: the
// parent directory must exist (this flag never creates directories —
// mkdir is the operator's own act) and be writable, and the target must
// not exist (a fresh credential writes a fresh file: no clobbered bytes,
// no pre-existing mode left holding a credential) — then the mint, then
// the exclusive 0600 write itself, so the proof never rests on the
// pre-flight's race-free window. A failure between mint and delivery
// never prints the credential: a file the write may have created is
// removed (an EEXIST refused — that entry is not this command's), and
// the refusal names the token for the operator's revoke; an automatic
// rollback declined (a second store write inside an error path, its own
// failure unhandleable cleanly — the residual 0268 records).
function issueTokenToFile(dataDir: string, scopes: string, name: string | undefined, rawOut: string): void {
  const path = resolve(rawOut)
  const dir = dirname(path)
  try {
    if (!statSync(dir).isDirectory()) refuse(`--out takes a file in an existing directory — ${dir} is not a directory`)
  } catch {
    refuse(`--out takes a file in an existing directory — ${dir} does not exist (create it first; token issue never creates directories)`)
  }
  try {
    accessSync(dir, constants.W_OK)
  } catch {
    refuse(`--out cannot write into ${dir} — the directory is not writable (pick a writable location for the credential)`)
  }
  try {
    lstatSync(path)
    refuse(`--out refuses to overwrite ${path} — a fresh credential writes a fresh 0600 file (move ${path} aside, or pass another path)`)
  } catch {
    // absent — the fresh-file arm.
  }
  let label: string | undefined
  let issued: { name: string; scopes: string[] } | undefined
  try {
    const { token, stored } = new DaemonStore(dataDir).issueToken(scopes, name)
    label = stored.name
    // Exactly the bytes the shown-once line puts on stdout — the
    // credential and the newline that terminates it, nothing else (no
    // wrapper: the file's consumers are Bearer headers and scripts, and a
    // wrapper would make every one of them parse).
    writeFileSync(path, `${token}\n`, { flag: "wx", mode: 0o600 })
    issued = { name: stored.name, scopes: [...stored.scopes] }
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== "EEXIST") {
      try {
        rmSync(path, { force: true })
      } catch {
        // best-effort belt; the refusal below is the act.
      }
    }
    if (error instanceof StoreError) refuse(error.message)
    const detail = error instanceof Error ? error.message : String(error)
    const named = label === undefined ? "the token (token list names it)" : `the token "${label}"`
    refuse(`--out could not write ${path} (${detail}) — ${named} was issued but delivered nowhere; revoke it, then re-issue: opencode-auto-server token revoke`)
  }
  console.log(`✓ token "${issued.name}" issued with scopes: ${issued.scopes.join(", ")}`)
  console.log(`the token is shown once; the store (${dataDir}/tokens.json) keeps only its digest`)
}

const command = args[0]

// AUTO-DECISION (whitelist/token management is a CLI surface, not REST):
// managing the auth material over HTTP has a bootstrap problem — the first
// token cannot be issued by an API that requires a token — and the daemon
// may not even be running when an operator registers a project. The
// commands below write the daemon's own data directory directly; the store
// reads per request, so a registration or a token issued beside a live
// daemon takes effect on the next request with no restart.

// The worker entry (P1b): parse, validate, run, exit — one runAll per child
// process, the unit the daemon (P1c) supervises. (Every path through
// runWorker exits; if one ever returned, the refusal at the bottom would
// catch the fallthrough.)
if (command === "worker") {
  await runWorker(args.slice(1))
}

// transfer <dir> is retired (plans/0283, the CLI tombstones letter): the
// advance is the daemon's transfer operation — an in-process deterministic
// apply (git and document writes only, zero agent processes, the
// distillation and the construction the distill/synthesize grants') over a
// registered project, not a local subcommand. The notice is the one answer
// whatever follows the command (P13's tombstone discipline), naming the
// executor surface.
if (command === "transfer") {
  console.error(
    "transfer is retired (plans/0283): the person-bracketed advance is the daemon's transfer operation — POST /projects/<project>/transfer over a registered project (serve first; the advance is a deterministic apply, the distillation and the construction the distill/synthesize grants' over the executor protocol)",
  )
  process.exit(1)
}

if (command === "register" || command === "unregister" || command === "projects") {
  const { dataDir, rest } = takeDataDir(args.slice(1))
  const store = new DaemonStore(dataDir)
  if (command === "register") {
    if (rest.length !== 1) refuse("register takes exactly one directory (a target directory this daemon may start runs in)")
    runStored(() => {
      const project = store.register(rest[0]!)
      console.log(`✓ registered "${project.name}" → ${project.directory} (whitelist: ${dataDir}/projects.json)`)
      console.log(`runs may now name it: { "project": "${project.name}" } — or the registered path ${project.directory}`)
    })
    process.exit(0)
  }
  if (command === "unregister") {
    if (rest.length !== 1) refuse("unregister takes exactly one project (its registered name or absolute path)")
    runStored(() => {
      const removed = store.unregister(rest[0]!)
      console.log(`✓ unregistered "${removed.name}" (${removed.directory})`)
    })
    process.exit(0)
  }
  const projects = store.listProjects()
  if (!projects.length) {
    console.log("no registered projects (register one: opencode-auto-server register <dir>)")
  } else {
    for (const project of projects) console.log(`${project.name}\t${project.directory}\tregistered ${project.registered}`)
  }
  process.exit(0)
}

if (command === "token") {
  const sub = args[1]
  if (sub === "issue") {
    const { dataDir, rest } = takeDataDir(args.slice(2))
    let scopes: string | undefined
    let name: string | undefined
    let out: string | undefined
    for (let at = 0; at < rest.length; at++) {
      const flag = rest[at]
      const value = rest[at + 1]
      if (flag === "--scopes") {
        if (value === undefined || value.startsWith("--")) refuse(`--scopes takes a comma-separated subset of: ${SCOPES.join(", ")}`)
        scopes = value
        at++
      } else if (flag === "--name") {
        if (value === undefined || value.startsWith("--")) refuse("--name takes a label for the token (shown by token list)")
        name = value
        at++
      } else if (flag === "--out") {
        if (value === undefined || value.startsWith("--")) refuse("--out takes a file path — the credential is written there 0600 and never printed")
        out = value
        at++
      } else {
        refuse(`unknown token issue argument "${flag}" (token issue takes --scopes, --name and --out)`)
      }
    }
    if (scopes === undefined) refuse(`--scopes is required (a comma-separated subset of: ${SCOPES.join(", ")})`)
    if (out !== undefined) issueTokenToFile(dataDir, scopes, name, out)
    else {
      // The floor (P10): no --out, the three stdout lines exactly as
      // before — the credential between the status and shown-once lines.
      runStored(() => {
        const { token, stored } = new DaemonStore(dataDir).issueToken(scopes!, name)
        console.log(`✓ token "${stored.name}" issued with scopes: ${stored.scopes.join(", ")}`)
        console.log(token)
        console.log(`the token is shown once; the store (${dataDir}/tokens.json) keeps only its digest`)
      })
    }
    process.exit(0)
  }
  if (sub === "list") {
    const { dataDir } = takeDataDir(args.slice(2))
    const tokens = new DaemonStore(dataDir).listTokens()
    if (!tokens.length) console.log("no tokens (issue one: opencode-auto-server token issue --scopes read,control)")
    for (const token of tokens) console.log(`${token.name}\t${token.scopes.join(",")}\tissued ${token.created}\t${token.hash.slice(0, 12)}…`)
    process.exit(0)
  }
  if (sub === "revoke") {
    const { dataDir, rest } = takeDataDir(args.slice(2))
    if (rest.length !== 1) refuse("token revoke takes exactly one token name (see token list)")
    runStored(() => {
      const removed = new DaemonStore(dataDir).revokeToken(rest[0]!)
      console.log(`✓ token "${removed.name}" revoked (scopes ${removed.scopes.join(", ")})`)
    })
    process.exit(0)
  }
  refuse(`unknown token subcommand "${sub ?? "(none)"}" (token issue | list | revoke)`)
}

// The daemon (P1c): serve the REST control plane over the whitelist and the
// token store, supervising one worker child per run. This branch is the
// module's last: nothing may follow it, because a serving daemon does not
// exit — the running Bun.serve holds the process open (verified: a module
// that only starts a server stays alive), and SIGINT (the terminal's
// Ctrl+C) terminates it by the default disposition, which stops serving
// without touching the workers.
if (command === "serve") {
  const { dataDir, rest } = takeDataDir(args.slice(1))
  let port = DEFAULT_PORT
  let host = DEFAULT_HOSTNAME
  let envFile: string | undefined
  for (let at = 0; at < rest.length; at++) {
    const flag = rest[at]
    const value = rest[at + 1]
    if (flag === "--open" || flag === "--root") {
      // The creation roots are retired (plans/0284): POST /projects is
      // generalized — the request names the directory, its parent the
      // anchor, the projects scope the trust boundary.
      refuse(`${flag} is retired (plans/0284): project creation over POST /projects names the directory in the request itself (the projects scope the boundary) — no boot-time roots to declare`)
    } else if (flag === "--port") {
      // 0..65535, refused at the flag instead of Bun.serve's throw: an
      // out-of-range port is a usage error and the refusal names the range
      // (plans/0197 D5); 0 keeps its documented meaning (pick a free one).
      const given = value === undefined || !/^\d+$/.test(value) ? undefined : Number(value)
      if (given === undefined || given > 65535) refuse("--port takes the TCP port to listen on: an integer 0..65535 (0 picks a free one)")
      port = given
      at++
    } else if (flag === "--host") {
      if (value === undefined || value.startsWith("--")) refuse("--host takes the address to bind (default 127.0.0.1 — v1 is single-machine)")
      host = value
      at++
    } else if (flag === "--launch") {
      refuse("--launch is retired (plans/0282): the daemon spawns executor coordinators only, and their confinement is the operator's own process arrangement — nothing is left to wrap")
    } else if (flag === "--env-file") {
      if (value === undefined || value.startsWith("--")) refuse("--env-file takes the daemon's environment declaration file (NAME=VALUE lines; its names win over the inherited shell's)")
      envFile = value
      at++
    } else {
      refuse(`unknown serve argument "${flag}" (serve takes --port, --host, --data-dir and --env-file)`)
    }
  }
  // malformed line refuses at its line number, never echoing the line's
  // bytes — a value may be a secret.
  if (envFile !== undefined) {
    const resolvedEnvFile = resolve(envFile)
    let envFileReadable = false
    try {
      accessSync(resolvedEnvFile, constants.R_OK)
      envFileReadable = statSync(resolvedEnvFile).isFile()
    } catch {
      // stat/access spoke: refused below.
    }
    if (!envFileReadable) {
      refuse(`--env-file takes the daemon's environment declaration — a readable file: ${resolvedEnvFile} (resolved against the serve command's working directory) is not a readable file`)
    }
    let declared: Record<string, string>
    try {
      declared = parseEnvFile(await readFile(resolvedEnvFile, "utf8"))
    } catch (error) {
      refuse(`--env-file ${resolvedEnvFile}: ${(error as Error).message}`)
    }
    for (const [name, value] of Object.entries(declared)) process.env[name] = value
  }
  const store = new DaemonStore(dataDir)
  const projects = store.listProjects()
  const tokens = store.listTokens()
  const daemon = await startDaemon({ dataDir, port, hostname: host })
  // AUTO-DECISION (default bind 127.0.0.1): v1 is single-machine (the
  // assessment's §8 Q4 boundary) and the run lock's stale detection cannot
  // cross hosts; a loopback default keeps the token-guarded control plane
  // off the network until an operator explicitly widens it with --host.
  // The banner carries the resolved identity from the same home the wire
  // reads (plans/0270, its source-mode line widened plans/0293): the version
  // beside the line this process's modules actually are — a stamped build
  // names its commit, a source run names the tool tree's own commit (plus
  // dirt) at the moment the daemon started, `dev` alone when git cannot
  // name the tree.
  const line = await resolvedLine()
  console.log(`opencode-auto-server ${VERSION} (build ${line}) serving on ${daemon.url} (data dir: ${dataDir})`)
  console.log(`whitelist: ${projects.length} project${projects.length === 1 ? "" : "s"} registered${projects.length ? ` (${projects.map((project) => project.name).join(", ")})` : ""} — runs target registered projects only`)
  console.log(`auth: ${tokens.length} token${tokens.length === 1 ? "" : "s"} (scopes: ${SCOPES.join(", ")}); requests carry 'Authorization: Bearer <token>'`)
  console.log(`v1 boundary: single machine, multiple directories; the daemon binds ${daemon.hostname} — a lock held on another host cannot be probed from here (recovery: delete that .auto/run.lock by hand)`)
  console.log(`stopping the daemon (Ctrl+C) leaves live workers running to completion; their runs stay observable on disk and the run lock arbitrates any successor`)
  // The environment boot report (plans/0265): the carrier's losses and the
  // unresolvable references, at the boot line instead of one blocked run at
  // a time — names only, every value never printed.
  for (const warning of daemon.bootWarnings) console.log(warning)
} else {
  // Nothing else exists: refuse with the usage text rather than pretending.
  console.error(`opencode-auto-server: unknown command ${command ?? "(none)"} — the command surface is serve, register, unregister, projects, token, executor-hub and worker`)
  console.error(USAGE)
  process.exit(1)
}
