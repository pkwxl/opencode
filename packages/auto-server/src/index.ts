#!/usr/bin/env bun
// Entry point of the headless automation service shell (bin
// opencode-auto-server): the server shape of opencode-auto, where a daemon
// supervises one worker child process per run and exposes the driver over
// HTTP (REST + SSE). This unit ships the package skeleton plus the worker
// entry (P1b, auto-core plans/0067): `worker '<run request JSON>'` runs
// exactly one runAll in one target directory as a child process and exits
// with the run's code. The daemon that spawns workers — and with it the
// whitelist, token auth and the HTTP control plane — lands with the later
// units of the headless service evolution.
//
// Dependency line (constitutional): this package imports @opencode-ai/auto-core
// and Node/Bun builtins only — never @opencode-ai/core, @opencode-ai/protocol,
// @opencode-ai/sdk, the monorepo server package or any Effect infrastructure;
// the server is self-contained on Bun.serve with zero added runtime
// dependencies. test/isolation.test.ts holds that line as an assertion.
import { applyServerProfile } from "./profile"
import { VERSION } from "./version"
import { runWorker } from "./worker"

const USAGE = `usage:
  opencode-auto-server --help
  opencode-auto-server --version
  opencode-auto-server worker '<run request JSON>'

opencode-auto-server is the headless automation service shell of opencode-auto:
a daemon that runs the driver over HTTP and streams run state (REST + SSE).
The worker runs exactly one run in one target directory as a child process
and exits with the run's own code (0 all complete; 1 usage/environment error;
2 blocked awaiting a human; 3 graceful exit pause; 130 force-terminated).
The daemon that spawns workers, and the HTTP control plane, arrive with the
later units of the headless service evolution (auto-core plans/0067); until
then drive runs through the worker entry below or the opencode-auto CLI.

worker '<run request JSON>' — the JSON document holds:
  directory  (required) the target directory of the run
  options    per-run options (the run flags of opencode-auto run): verbose,
             waitAnswer, waitBetween, permission, newSession, dryrun,
             maxSessions, server. The project's constitutional config keys
             are frozen by init (.opencode/auto/config.json) and refused
             here — revise them with opencode-auto amend, never on a run
  switches   per-run OPENCODE_AUTO_* experimental switch overrides, applied
             to the worker's environment before the run starts (each run is
             a fresh process, so the switch layer is safely per-run)

the worker's stdin is closed: questions degrade to the unanswered path
(permission questions block the run with exit 2), never a hang; interactive
input arrives with the WebSocket transport of the later units`

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

// The worker entry (P1b): parse, validate, run, exit — one runAll per child
// process, the unit the daemon (P1c) supervises.
if (args[0] === "worker") {
  await runWorker(args.slice(1))
}

// Nothing else is implemented yet: the daemon is the entry the next unit
// adds. Refuse with the usage text rather than pretending to serve.
console.error(`opencode-auto-server: unknown command ${args[0] ?? "(none)"} — the daemon and the HTTP control plane are not implemented yet; the worker entry is 'worker <run request JSON>'`)
console.error(USAGE)
process.exit(1)
