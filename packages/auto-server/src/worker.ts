// The worker entry of the headless service shell (P1b, auto-core
// plans/0067 §二/§四): one child process per run. The daemon (P1c, the next
// unit) spawns one worker per run request; the worker runs exactly one
// runAll in one target directory and exits with the run's own code — the
// unit of execution the daemon supervises. One run per process is not a
// preference but the process topology the core already assumes: SIGINT
// handling and the run lock's process-exit hook own the whole process
// (auto-core src/loop.ts, src/lock.ts), the OPENCODE_AUTO_* env-switch layer
// parses process.env once and memoizes (src/switches.ts — per-run overrides
// are only possible because every run is a fresh process), and the log fd,
// the run-events fd and the frozen switch snapshot are process-lifetime
// state ("one run per process is an existing invariant", src/services.ts).
// This module is therefore a process entry, never an in-process library: the
// daemon spawns `opencode-auto-server worker '<json>'` and reads its exit
// code; it must never import this and call runAll itself.
//
// The worker performs the shell duties the CLI shell performs around runAll
// (packages/auto/src/index.ts `run`) itself, so a spawned worker is a
// fully-formed shell run, observable on disk from the outside:
//   - the profile is set by the entry before dispatch (src/profile.ts);
//   - the audit log starts exactly as the CLI's startRunLog (setLogFile) —
//     without it there is no .auto/logs/run-*.log for the outside to tail;
//   - the core's own gates are called, never rewritten here (constitution
//     erosion risk): strict loadProjectConfig with fixHint,
//     legacyLayoutProblem, and the run lock arrives via runAll itself — the
//     worker never works around a refusal.
//
// stdin is closed / not a TTY by construction (a daemon-spawned child): the
// worker never builds the terminal sideband. Its question handling is the
// daemon's interactive transport (P3b, src/worker-interactive.ts): when the
// request carries the transport payload, every human-interaction route is
// bridged to the daemon's WebSocket surface as typed frames — questions
// answerable from outside the process, /exit and /failback reachable over
// the network, a transport loss degrading each open question to the
// unanswered path (blocked/exit 2, or the configured fallback — never a
// hang). Without the payload, the P1 semantics stand: with waitAnswer 0
// (this entry's default) a permission question blocks the run (exit 2) and
// a non-permission question is auto-answered (auto-core
// src/engine/concerns/questions.ts).
import { resolve } from "node:path"
import {
  formatProjectConfig,
  legacyModeFallback,
  loadProjectConfig,
  type ProjectConfig,
} from "@opencode-ai/auto-core/config"
import { fixHint } from "@opencode-ai/auto-core/config-fix"
import { runAll, type RunAllOpts } from "@opencode-ai/auto-core/loop"
import { log, setLogFile, setVerbose } from "@opencode-ai/auto-core/log"
import { loadModes, type ModeSpec } from "@opencode-ai/auto-core/mode"
import { currentRound, formatPhases, legacyLayoutProblem, phaseIndexPath, readPhases } from "@opencode-ai/auto-core/phases"
import type { Interactive } from "@opencode-ai/auto-core/control-types"
import { CONFIG_KEYS, HAND_EDITED_KEYS, frozenRefusal, parseOptions, parseSwitches, parseTransport, type RunOptions, type TransportPayload } from "./request"
import { wsInteractive } from "./worker-interactive"

// The run request (the payload the daemon sends; the transport — here one
// argv token holding the JSON document — is the daemon's choice):
//   directory  the target directory of the run (required; resolved against
//              the worker's cwd like the CLI's positional directory);
//   options    the per-run options, exactly the RunAllOpts fields the CLI's
//              `run` takes as its own session flags — everything else (the
//              project's constitutional config keys) is refused, the
//              API-side equivalent of the CLI's frozen-flag refusal;
//   switches   per-run OPENCODE_AUTO_* experimental switch overrides,
//              applied to this process's environment before the core parses
//              them once (parse-memoization is why each run is a fresh
//              process);
//   transport  the P3b interactive transport (daemon-written): the worker
//              bridge URL and the per-run secret. Present on every run this
//              daemon spawns — the entry builds its Interactive
//              implementation from it and injects it through
//              RunAllOpts.interactive (the P3a seam), so a question raised
//              inside the run is answerable from outside the process and
//              /exit, /failback are reachable over the network. Absent (a
//              hand-spawned worker): no interactive channel, the stdin-closed
//              question semantics of P1 unchanged.
// The vocabulary itself — the option keys, the frozen-key table, the switch
// registry — lives in src/request.ts, the one module the daemon (P1c) and
// this entry share: the daemon pre-validates a POST /runs body with it, so
// an invalid request is a 400 there instead of a 202 whose run dies on
// arrival, while this entry remains the enforcer (it re-validates the
// payload it actually received).
export type RunRequest = {
  directory: string
  options?: RunOptions
  switches?: Record<string, string>
  transport?: TransportPayload
}

// Usage refusal: exit 1 with the message on stderr (the CLI convention —
// usage errors are stderr; driver messages go to stdout through log()).
// The shared validators raise RequestError instead of exiting (they run in
// the daemon too); here at the entry their messages become the same stderr
// refusals they always were.
function refuse(message: string): never {
  console.error(message)
  process.exit(1)
}

function refuseRequest(error: unknown): never {
  if (error instanceof Error) refuse(error.message)
  refuse(String(error))
}

// The per-run switch overrides, applied to this process's environment ahead
// of the core's single parse (autoSwitches memoizes on first access inside
// runAll's preflight — a fresh process per run is what makes this layer
// per-run). Validation is the shared module's; only the env write is this
// process's own.
function applySwitches(switches: Record<string, string>): void {
  for (const [name, value] of Object.entries(switches)) process.env[name] = value
}

// The worker entry: argv is everything after the `worker` command — exactly
// one token, the run request's JSON document.
// AUTO-DECISION (payload transport): one argv token holding the JSON —
// visible in `ps` (debuggable from the outside), no fd lifecycle to own, and
// stdin stays free to be closed (the question-degradation contract);
// a run request is small (directory, a handful of options, switch
// overrides), far from argv limits. The daemon (P1c) owns the spawn; if a
// later unit prefers a request file, only this function's first block
// changes — parse/validate/run stay put.
export async function runWorker(argv: string[]): Promise<void> {
  if (argv.length !== 1 || !argv[0]) {
    refuse(`the worker takes exactly one argument: the run request as a JSON document (usage: opencode-auto-server worker '<json>' — { "directory": "<dir>", "options": { … }, "switches": { "OPENCODE_AUTO_…": "…" }, "transport": { "run": "…", "url": "ws://…", "token": "…" } })`)
  }
  let document: unknown
  try {
    document = JSON.parse(argv[0]!)
  } catch (error) {
    refuse(`the run request is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    refuse("the run request must be a JSON object: { \"directory\": \"<dir>\", \"options\"?: { … }, \"switches\"?: { … }, \"transport\"?: { … } }")
  }
  const request = document as Record<string, unknown>
  for (const key of Object.keys(request)) {
    if (key === "directory" || key === "options" || key === "switches" || key === "transport") continue
    // A dedicated config carrier gets the same answer as a config key in
    // options: there is no per-run config surface, by constitution.
    if (key === "config") {
      refuse(`a run request carries no config: the constitutional keys are frozen by init (.opencode/auto/config.json); revise them with opencode-auto amend <dir>, or edit that file directly`)
    }
    if (key in CONFIG_KEYS) refuse(frozenRefusal("", `"${key}" `, CONFIG_KEYS[key]!))
    if (HAND_EDITED_KEYS.has(key)) refuse(`"${key}" is a config key (hand-edited in .opencode/auto/config.json); a run request carries no config — config keys are frozen by init`)
    refuse(`unknown request field "${key}" (the run request takes directory, options, switches and transport)`)
  }
  if (typeof request.directory !== "string" || !request.directory.trim()) {
    refuse(`the run request requires "directory": the target directory of the run (resolved against the worker's working directory)`)
  }
  const directory = resolve(request.directory)
  // The shared validators (src/request.ts) raise RequestError; at this entry
  // their messages are the stderr refusals with exit 1 — byte-identical to
  // the texts the daemon's 400s carry.
  let options: RunOptions
  let switches: Record<string, string>
  let transport: TransportPayload | undefined
  try {
    options = parseOptions(request.options)
    switches = parseSwitches(request.switches)
    transport = "transport" in request ? parseTransport(request.transport) : undefined
  } catch (error) {
    refuseRequest(error)
  }
  applySwitches(switches)

  // Legacy layout (M3.7): an old-layout project is a usage error before the
  // worker reads or writes anything — the core's own check, like the CLI's.
  const legacy = await legacyLayoutProblem(directory)
  if (legacy) refuse(legacy)

  // The audit log, exactly the CLI's startRunLog: setVerbose from the
  // request's verbose flag (the log file itself always records in full —
  // auditLog true in the server profile), then a fresh .auto/logs/run-*.log
  // through setLogFile, its path the run's first logged line. Without this
  // there is nothing to tail from the outside. interactive is never set
  // here (see parseOptions).
  setVerbose(options.verbose)
  log(`📝 log file: ${setLogFile(directory)}`)

  // The interactive transport (P3b): the daemon's payload becomes the run's
  // interactive channel — the entry constructs the implementation here
  // (after the audit log starts, so the bridge's own lines land in it) and
  // injects it through RunAllOpts.interactive (the P3a seam). The
  // announcement is the transport's own banner: the loop logs the 💬 line
  // only for the terminal sideband shapes, and an injected implementation
  // is announced by its owner. Without a payload, no channel: the
  // stdin-closed question semantics of P1 stand.
  const interactive: Interactive | undefined = transport ? wsInteractive({ url: transport.url, token: transport.token }) : undefined
  if (transport) {
    log(`🔗 interactive transport: questions and /exit, /failback control are served by the daemon over the bridge ${transport.url} (run ${transport.run}); a transport loss degrades every open question to the unanswered path — never a hang`)
  }

  // The strict config load (the CLI's loadRunConfig): a broken file is an
  // environment error with exit 1, strict failure beats silent fallback, and
  // the fix hint names the repair route. The configured mode must be
  // registered.
  let config: ProjectConfig
  try {
    config = await loadProjectConfig(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    const hint = await fixHint(directory)
    if (hint) console.error(hint)
    process.exit(1)
  }
  let modes: Record<string, ModeSpec>
  try {
    modes = loadModes(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  const mode = modes[config.mode]
  if (!mode) {
    console.error(`configured mode "${config.mode}" is not registered (currently supported: ${Object.keys(modes).join(", ")}); to fix: opencode-auto amend <dir> -m <value>, or edit .opencode/auto/config.json directly`)
    process.exit(1)
  }

  // The banner of run (the CLI's logRunBanner): the legacy-mode note, the
  // driver-run tests line, the config summary and, when phased, the phase
  // progress line — the log file is this service's observability surface
  // (P1e tails it), and these lines tell the reader what the run carries.
  // AUTO-DECISION: replicated here rather than skipped — the banner is part
  // of "a fully-formed shell run"; the texts stay byte-identical to the
  // CLI's so a tailing client cannot tell the shells apart.
  if (await legacyModeFallback(directory)) log(`ℹ mode taken from the legacy persisted value in .auto/config.json; run opencode-auto fix ${directory} to write the full config`)
  if (config.testByDriver) {
    log(
      `⚙ tests run by the driver: sessions put scripts in test/ and write the script path to tmp/test.sh to request execution; the driver merges stdout/stderr into tmp/test.<n>.out and feeds it back to the session` +
        (config.handoverTest ? "; on test failure with context at its cap, a handover document switches to a fresh session" : ""),
    )
  }
  log(`⚙ project config (.opencode/auto/config.json): ${formatProjectConfig(config)}`)
  if (config.phases !== "m") log(await phasesLine(directory))

  // The run itself, under its own lock (acquire is runAll's — a refusal is
  // runAll's refusal, holder lines and exit 1, never worked around here),
  // and the run's exit code propagates verbatim: 0 all complete, 1
  // usage/environment, 2 blocked for a human, 3 a graceful /exit pause with
  // progress persisted (reachable over the daemon's control channel when
  // the transport is attached, 130 force-terminated).
  const code = await runAll(directory, runOptions(config, mode, options, interactive))
  process.exit(code)
}

// The runAll options, the CLI's runOptions for this request: the config
// init froze (loaded strictly above) plus the request's per-run options.
// Config values never come from the request — that is the frozen-flag
// refusal's whole point. The interactive channel is the transport's
// implementation when the daemon attached one (the P3a seam's injected
// shape); the request's options never carry it (parseOptions refuses
// options.interactive — the terminal sideband has no terminal here).
function runOptions(config: ProjectConfig, mode: ModeSpec, options: RunOptions, interactive: Interactive | undefined): RunAllOpts {
  return {
    agent: config.agent,
    server: options.server,
    verbose: options.verbose,
    waitAnswer: options.waitAnswer,
    waitBetween: options.waitBetween,
    subtask: config.subtask,
    contextLimit: config.contextLimit * 1000,
    permission: options.permission,
    idleMs: config.idleTime * 60_000,
    maxMs: config.idleMax > 0 ? config.idleMax * 60_000 : undefined,
    mode,
    phases: config.phases,
    testByDriver: config.testByDriver,
    handoverTest: config.handoverTest,
    autoNumber: config.autoNumber,
    wrapup: config.wrapup,
    acceptanceGate: config.acceptanceGate,
    build: config.build,
    parallel: config.parallel,
    scanExempt: config.scanExempt,
    newSession: options.newSession,
    dryrun: options.dryrun,
    maxSessions: options.maxSessions,
    ...(interactive ? { interactive } : {}),
  }
}

// The phase progress line of the banner (the CLI's phasesLine, byte-identical;
// its missing-index hint names the CLI's plan — the working plan surface
// today, since this shell's own plan route arrives with P1d).
async function phasesLine(directory: string): Promise<string> {
  const round = await currentRound(directory)
  try {
    const state = await readPhases(directory)
    if (!state) return `⚠ phase index (${phaseIndexPath(round)}) is missing; run opencode-auto plan to establish the round`
    return `phases${round > 1 ? ` (round ${round})` : ""}: ${formatPhases(state)}`
  } catch (error) {
    return `⚠ phase index (${phaseIndexPath(round)}) is invalid: ${error instanceof Error ? error.message : String(error)}`
  }
}
