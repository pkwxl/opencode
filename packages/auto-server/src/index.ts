#!/usr/bin/env bun
// Entry point of the headless automation service shell (bin
// opencode-auto-server): the server shape of opencode-auto, where a daemon
// supervises one worker child process per run and exposes the driver over
// HTTP (REST + SSE). This entry carries the package's process surfaces: the
// worker (P1b — one run per child process, exit code the run's own) and the
// daemon with its CLI-side duties (P1c — serve, plus the whitelist and token
// management in the daemon's own data directory). The REST lifecycle surface
// (config ops, units, models, the P1 plan boundary) is served by the daemon
// (P1d, src/ops.ts), as is the disk observability surface (P1e, src/observe.ts
// — the polled status read model and the SSE log/journal tails).
//
// Dependency line (constitutional): this package imports @opencode-ai/auto-core
// and Node/Bun builtins only — never @opencode-ai/core, @opencode-ai/protocol,
// @opencode-ai/sdk, the monorepo server package or any Effect infrastructure;
// the server is self-contained on Bun.serve with zero added runtime
// dependencies. test/isolation.test.ts holds that line as an assertion.
import { applyServerProfile } from "./profile"
import { DEFAULT_HOSTNAME, DEFAULT_PORT, startDaemon } from "./daemon"
import { defaultDataDir, DaemonStore, SCOPES, StoreError } from "./store"
import { VERSION } from "./version"
import { runWorker } from "./worker"

const USAGE = `usage:
  opencode-auto-server --help
  opencode-auto-server --version
  opencode-auto-server serve [--port <n>] [--host <addr>] [--data-dir <dir>]
  opencode-auto-server register <directory> [--data-dir <dir>]
  opencode-auto-server unregister <name-or-directory> [--data-dir <dir>]
  opencode-auto-server projects [--data-dir <dir>]
  opencode-auto-server token issue --scopes <read,control,…> [--name <label>] [--data-dir <dir>]
  opencode-auto-server token list [--data-dir <dir>]
  opencode-auto-server token revoke <name> [--data-dir <dir>]
  opencode-auto-server worker '<run request JSON>'

opencode-auto-server is the headless automation service shell of opencode-auto:
a daemon that runs the driver over HTTP and streams run state (REST + SSE).
The worker runs exactly one run in one target directory as a child process
and exits with the run's own code (0 all complete; 1 usage/environment error;
2 blocked awaiting a human; 3 graceful exit pause; 130 force-terminated).
v1 boundary: single machine, multiple directories (see docs/daemon.md).

serve — the daemon (P1c/P1d/P1e/P3). Binds ${DEFAULT_HOSTNAME}:${DEFAULT_PORT} by
  default (v1 is single-machine; widen with --host at your own trust
  boundary). The run-control REST surface: GET /health, GET /runs, POST /runs,
  GET /runs/<id>, DELETE /runs/<id> (kill — the double-SIGINT
  force-terminate, mapped to killed/130); the lifecycle operations under
  /projects/<project>/<op>: init, amend, fix, reset (the config scope),
  close, tasks (task-add), plan (P3c-unlocked: the no-agent routes served
  in-process, the agent-planning routes spawned as runs under
  stopBefore: execute with their questions over the interactive transport —
  the request takes "input" and "append"; plan --force-close composes as
  the close operation followed by the plan operation) and models
  (read-only, runs beside a live run); the observability surface (P1e, the
  read scope): GET /projects/<project>/status (the polled read model over
  .auto/*.json, git dirty/clean per worktree, the core's rendered status tree
  and its commit-verdict completion — commit-is-completion, agent self-report
  never trusted), GET /projects/<project>/log and /events (SSE tails of the
  newest .auto/logs/run-*.log and the .auto/run-events.jsonl journal —
  whole-line delivery, re-seek on run rotation) and
  GET /projects/<project>/status-events (P2b: the typed driver-events stream
  with event-id cursoring); the interactive transport (P3b/P3c): the WebSocket
  endpoint GET /runs/<id>/interactive, multiplexing the question channel
  (the "answer" scope — a question raised inside the run reaches connected
  clients, an answer returns, the run proceeds; the still-open questions
  are journaled in the daemon's data dir, so a reconnecting client is
  replayed them and a daemon restart restores the pending set and
  redelivers it) and the control channel (the
  "control" scope — /exit produces the graceful pause/exit 3 with progress
  persisted and a re-run resumes precisely; /failback reaches the router).
  Destructive operations take two separate fields — "confirm" (the answer
  routed through the core's confirmation gate) and "cleanTree" (the worktree
  check's opt-out) — never one bundled force. Stopping the daemon leaves live
  workers running to completion; the run lock arbitrates any successor, and
  a restart restores every run that still holds an open question.

register — add a target directory to the daemon's whitelist. The whitelist
  is absolute: POST /runs names a registered project (by name or by its
  registered absolute path) and nothing else; the daemon never resolves an
  arbitrary request path. The registry lives in the daemon's own data
  directory (--data-dir; default $XDG_CONFIG_HOME/opencode-auto/server,
  ~/.config/opencode-auto/server on a plain machine) — never inside a
  project, never under .auto/.

token — manage bearer tokens and their scopes: read (status/logs/events),
  control (run control, close, task-add, /exit and /failback over the
  interactive transport), config (init/amend/fix/reset), answer (answering
  questions over the interactive transport), probe (models --probe; opt-in,
  disabled by default — no route requires it yet). Unauthenticated requests
  get 401, a token without the route's scope 403. The plaintext token is
  printed once at issue; the store keeps only its digest.

worker '<run request JSON>' — the unit the daemon spawns (P1b). The JSON
  document holds:
  directory  (required) the target directory of the run
  options    per-run options (the run flags of opencode-auto run): verbose,
             waitAnswer, waitBetween, permission, newSession, dryrun,
             maxSessions, server. The project's constitutional config keys
             are frozen by init (.opencode/auto/config.json) and refused
             here — revise them with opencode-auto amend, never on a run
  switches   per-run OPENCODE_AUTO_* experimental switch overrides, applied
             to the worker's environment before the run starts (each run is
             a fresh process, so the switch layer is safely per-run)
  transport  the interactive transport (P3b, daemon-written): the worker
             bridge WebSocket URL and the per-run secret. The worker builds
             its Interactive implementation from it and injects it through
             runAll's io/Interactive seam, so questions and /exit, /failback
             control are bridged to the daemon's WebSocket endpoint
  plan       the plan payload (P3c, daemon-written — the plan operation's
             loop route): { "input"?: "<planning input text>",
             "append"?: true|false }. The run performs the CLI plan
             command's work: runAll under stopBefore: execute
             (humanQuestions armed — the sessions' questions wait for the
             human with no timeout over the transport), the planning input
             persisted by the planning step, --append's semantics

the worker's stdin is closed: without a transport payload, questions degrade
to the unanswered path (permission questions block the run with exit 2),
never a hang; with one, every human interaction rides the bridge as typed
frames, and a transport loss degrades the same way`

// The profile is set before anything else (shell-contract §E.2: set once at
// shell-entry startup), so every core message the entry reaches is shaped by
// it already.
applyServerProfile()

const args = process.argv.slice(2)

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
      } else {
        refuse(`unknown token issue argument "${flag}" (token issue takes --scopes and --name)`)
      }
    }
    if (scopes === undefined) refuse(`--scopes is required (a comma-separated subset of: ${SCOPES.join(", ")})`)
    runStored(() => {
      const { token, stored } = new DaemonStore(dataDir).issueToken(scopes!, name)
      console.log(`✓ token "${stored.name}" issued with scopes: ${stored.scopes.join(", ")}`)
      console.log(token)
      console.log(`the token is shown once; the store (${dataDir}/tokens.json) keeps only its digest`)
    })
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
  for (let at = 0; at < rest.length; at++) {
    const flag = rest[at]
    const value = rest[at + 1]
    if (flag === "--port") {
      if (value === undefined || !/^\d+$/.test(value)) refuse("--port takes the TCP port to listen on (an integer; 0 picks a free one)")
      port = Number(value)
      at++
    } else if (flag === "--host") {
      if (value === undefined || value.startsWith("--")) refuse("--host takes the address to bind (default 127.0.0.1 — v1 is single-machine)")
      host = value
      at++
    } else {
      refuse(`unknown serve argument "${flag}" (serve takes --port, --host and --data-dir)`)
    }
  }
  const store = new DaemonStore(dataDir)
  const projects = store.listProjects()
  const tokens = store.listTokens()
  const daemon = await startDaemon({ dataDir, port, hostname: host })
  // AUTO-DECISION (default bind 127.0.0.1): v1 is single-machine (the
  // assessment's §8 Q4 boundary) and the run lock's stale detection cannot
  // cross hosts; a loopback default keeps the token-guarded control plane
  // off the network until an operator explicitly widens it with --host.
  console.log(`opencode-auto-server ${VERSION} serving on ${daemon.url} (data dir: ${dataDir})`)
  console.log(`whitelist: ${projects.length} project${projects.length === 1 ? "" : "s"} registered${projects.length ? ` (${projects.map((project) => project.name).join(", ")})` : ""} — runs target registered projects only`)
  console.log(`auth: ${tokens.length} token${tokens.length === 1 ? "" : "s"} (scopes: ${SCOPES.join(", ")}); requests carry 'Authorization: Bearer <token>'`)
  console.log(`v1 boundary: single machine, multiple directories; the daemon binds ${daemon.hostname} — a lock held on another host cannot be probed from here (recovery: delete that .auto/run.lock by hand)`)
  console.log(`stopping the daemon (Ctrl+C) leaves live workers running to completion; their runs stay observable on disk and the run lock arbitrates any successor`)
} else {
  // Nothing else exists: refuse with the usage text rather than pretending.
  console.error(`opencode-auto-server: unknown command ${command ?? "(none)"} — the command surface is serve, register, unregister, projects, token and worker`)
  console.error(USAGE)
  process.exit(1)
}
