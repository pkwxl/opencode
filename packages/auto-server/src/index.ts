#!/usr/bin/env bun
// Entry point of the headless automation service shell (bin
// opencode-auto-server): the server shape of opencode-auto, where a daemon
// supervises one worker child process per run and exposes the driver over
// HTTP (REST + SSE). This unit ships the package skeleton only — the entry
// sets the shell profile and answers --help/--version; the daemon, worker and
// control plane land with the later units of the headless service evolution
// (auto-core plans/0067).
//
// Dependency line (constitutional): this package imports @opencode-ai/auto-core
// and Node/Bun builtins only — never @opencode-ai/core, @opencode-ai/protocol,
// @opencode-ai/sdk, the monorepo server package or any Effect infrastructure;
// the server is self-contained on Bun.serve with zero added runtime
// dependencies. test/isolation.test.ts holds that line as an assertion.
import { applyServerProfile } from "./profile"
import { VERSION } from "./version"

const USAGE = `usage:
  opencode-auto-server --help
  opencode-auto-server --version

opencode-auto-server is the headless automation service shell of opencode-auto:
a daemon that runs the driver over HTTP and streams run state (REST + SSE).
This binary is the service skeleton — it sets the server shell profile and
answers --help/--version; the daemon, the run worker and the HTTP control
plane are not implemented yet. Until they are, drive the driver with the
opencode-auto CLI.`

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

// Nothing else is implemented yet: the daemon is the entry the later units
// add. Refuse with the usage text rather than pretending to serve.
console.error("opencode-auto-server: nothing to run yet — the daemon, the run worker and the HTTP control plane are not implemented")
console.error(USAGE)
process.exit(1)
