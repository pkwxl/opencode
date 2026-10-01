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
// worker never enables interactive mode, and its question handling rides the
// core's defaults — with waitAnswer 0 (this entry's default) a permission
// question blocks the run (exit 2) and a non-permission question is
// auto-answered, never a hang (auto-core src/engine/concerns/questions.ts).
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
import type { PermissionMode } from "@opencode-ai/auto-core/opts"
import { currentRound, formatPhases, legacyLayoutProblem, phaseIndexPath, readPhases } from "@opencode-ai/auto-core/phases"
import { RETIRED_SWITCHES, SWITCH_ENV } from "@opencode-ai/auto-core/switches"

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
//              process).
export type RunRequestOptions = {
  verbose?: boolean
  waitAnswer?: number
  waitBetween?: number
  permission?: PermissionMode
  newSession?: boolean
  dryrun?: boolean
  maxSessions?: number
  server?: string
}

export type RunRequest = {
  directory: string
  options?: RunRequestOptions
  switches?: Record<string, string>
}

// The options after validation, defaults resolved (the CLI's parse* helpers'
// absent-value semantics: waitAnswer/waitBetween 0 = no wait, permission
// ask-deny, maxSessions 1 — the only value the core accepts today).
type ParsedOptions = {
  verbose: boolean
  waitAnswer: number
  waitBetween: number
  permission: PermissionMode
  newSession: boolean
  dryrun: boolean
  maxSessions: number
  server: string | undefined
}

// The constitutional config keys (the CLI's CONFIG_FLAGS plus the two
// hand-edited-only keys): frozen by init into .opencode/auto/config.json,
// revised by amend, never set on a run. Both the config-file spelling and
// the CLI's flag spelling are recognized, each mapping to its revision hint
// (the CLI's amendHint shapes).
// AUTO-DECISION (refusal wording): the frozen-key refusal names the CLI's
// `opencode-auto amend` because that is today's revision surface — the
// server's own REST config ops arrive with P1d (T-089) and can take the
// hint over then; the CLI stays the escape hatch beside the daemon either
// way (plans/0067 §三 item 5).
const CONFIG_KEYS: Record<string, string> = {
  mode: "-m <value>",
  agent: "--agent <value>",
  contextLimit: "--context-limit <value>",
  "context-limit": "--context-limit <value>",
  subtask: "--subtask <value>",
  idleTime: "--idle-time <value>",
  "idle-time": "--idle-time <value>",
  idleMax: "--idle-max <value>",
  "idle-max": "--idle-max <value>",
  testByDriver: "--test-by-driver",
  "test-by-driver": "--test-by-driver",
  handoverTest: "--handover-test",
  "handover-test": "--handover-test",
  autoNumber: "--auto-number (use --no-auto-number to turn off)",
  "auto-number": "--auto-number (use --no-auto-number to turn off)",
  "no-auto-number": "--no-auto-number (use --auto-number to turn on)",
  wrapup: "--wrapup (use --no-wrapup to turn off)",
  "no-wrapup": "--no-wrapup (use --wrapup to turn on)",
  phases: "--phases <value>",
  parallel: "--parallel <value>",
  scanExempt: "--scan-exempt <value>",
  "scan-exempt": "--scan-exempt <value>",
}
// Keys no flag reaches (plans/0049 G9): the refusal names the file alone.
const HAND_EDITED_KEYS = new Set(["acceptanceGate", "build"])

// The per-run options this entry accepts (the CLI `run` session flags' JSON
// form); interactive is deliberately absent — see parseOptions.
const OPTION_KEYS = new Set(["verbose", "waitAnswer", "waitBetween", "permission", "newSession", "dryrun", "maxSessions", "server"])
const PERMISSION_MODES: readonly PermissionMode[] = ["auto-allow", "ask-allow", "ask-deny", "ask-fail"]

// Every name the env-switch registry answers to: the live switches plus the
// env-only names it registers (models, server) and the retired variables
// (which the core answers with their notice when set — passed through, not
// refused here).
const KNOWN_SWITCHES = new Set([...Object.values(SWITCH_ENV), ...Object.keys(RETIRED_SWITCHES)])

// Usage refusal: exit 1 with the message on stderr (the CLI convention —
// usage errors are stderr; driver messages go to stdout through log()).
function refuse(message: string): never {
  console.error(message)
  process.exit(1)
}

// The frozen-key refusal, the API-side equivalent of the CLI's
// refuseFrozenFlags line (packages/auto test/e2e.test.ts pins its shape):
// "was frozen by init", the config file, the amend revision hint.
function refuseFrozen(where: string, key: string, hint: string): never {
  return refuse(`${where}${key} was frozen by init (.opencode/auto/config.json). To change: opencode-auto amend <dir> ${hint}, or edit that file directly`)
}

// The run request's options: strict allowlist, values validated like the
// CLI's parse* helpers. A config key in any spelling gets the frozen
// refusal; interactive gets its own refusal — a worker has no terminal to
// host the resident input line, and the interactive transport (io-injected
// Interactive over WebSocket) arrives with P3 (plans/0067 §四, T-093/T-094);
// accepting it here would be a silent no-op or a hang, so it is a usage
// error pointing at the CLI until that unit lands.
function parseOptions(raw: unknown): ParsedOptions {
  if (raw === undefined) return defaults()
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) refuse("options must be an object holding the run's per-run options (verbose, waitAnswer, waitBetween, permission, newSession, dryrun, maxSessions, server)")
  const given = raw as Record<string, unknown>
  for (const key of Object.keys(given)) {
    if (key in CONFIG_KEYS) refuseFrozen("options.", key, CONFIG_KEYS[key]!)
    if (HAND_EDITED_KEYS.has(key)) refuse(`options.${key} is a config key with no flag (hand-edited in .opencode/auto/config.json); a run request carries no config — config keys are frozen by init`)
    if (key === "interactive") {
      refuse(
        `options.interactive is refused: a worker has no terminal (its stdin is closed), so the resident input line cannot live here — ` +
          `interactive input arrives with the WebSocket transport of the later units (P3); until then drive interactive runs with opencode-auto run <dir> -i`,
      )
    }
    if (!OPTION_KEYS.has(key)) {
      refuse(`options.${key} is not a run option (accepted: ${[...OPTION_KEYS].sort().join(", ")}); the project's config keys are frozen by init (.opencode/auto/config.json), revised with opencode-auto amend <dir>`)
    }
  }
  const parsed = defaults()
  if ("verbose" in given) {
    if (typeof given.verbose !== "boolean") refuse("options.verbose takes true|false")
    parsed.verbose = given.verbose
  }
  if ("newSession" in given) {
    if (typeof given.newSession !== "boolean") refuse("options.newSession takes true|false")
    parsed.newSession = given.newSession
  }
  if ("dryrun" in given) {
    if (typeof given.dryrun !== "boolean") refuse("options.dryrun takes true|false")
    parsed.dryrun = given.dryrun
  }
  if ("waitAnswer" in given) parsed.waitAnswer = parseMinutes(given.waitAnswer, "waitAnswer", "the minutes to wait for the human's answer before the fallback applies")
  if ("waitBetween" in given) parsed.waitBetween = parseMinutes(given.waitBetween, "waitBetween", "the pause between tasks (the timeout auto-continues; no terminal input arrives here)")
  if ("permission" in given) {
    const value = given.permission
    if (typeof value !== "string" || !(PERMISSION_MODES as readonly string[]).includes(value)) {
      refuse(`options.permission takes ${PERMISSION_MODES.join("|")}; defaults to ask-deny`)
    }
    parsed.permission = value as PermissionMode
  }
  if ("maxSessions" in given) {
    const value = given.maxSessions
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      refuse("options.maxSessions takes a positive integer (concurrent AI sessions); defaults to 1")
    }
    if (value > 1) {
      refuse(`options.maxSessions ${value}: concurrent execution is not supported yet; only 1 is accepted (plan for parallelism at init --parallel; tasks still run one at a time)`)
    }
    parsed.maxSessions = value
  }
  if ("server" in given) {
    const value = given.server
    if (typeof value !== "string" || !value.trim()) refuse("options.server takes a URL string (the external agent server this run talks to)")
    parsed.server = value
  }
  return parsed
}

function defaults(): ParsedOptions {
  return { verbose: false, waitAnswer: 0, waitBetween: 0, permission: "ask-deny", newSession: false, dryrun: false, maxSessions: 1, server: undefined }
}

// --wait-answer/--wait-between absent = 0 (no wait — this entry's default,
// since no human attends a worker); given: an integer 0..60 minutes.
function parseMinutes(raw: unknown, key: string, what: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 60) {
    refuse(`options.${key} takes an integer 0..60 (minutes; 0 = no wait) — ${what}`)
  }
  return raw
}

// The per-run switch overrides: applied to this process's environment ahead
// of the core's single parse (autoSwitches memoizes on first access inside
// runAll's preflight — a fresh process per run is what makes this layer
// per-run). Names are validated against the registry so a typo is a usage
// error, never a silent no-op (the CLI's unknown-option interception rule);
// values are strings (environment variables are strings, and the core reads
// the empty string as unset).
function applySwitches(raw: unknown): void {
  if (raw === undefined) return
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) refuse("switches must be an object of OPENCODE_AUTO_* names to string values (the per-run experimental switch overrides)")
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!name.startsWith("OPENCODE_AUTO_")) {
      refuse(`switches.${name}: a switch name is an OPENCODE_AUTO_* environment variable name (the registry of auto-core src/switches.ts)`)
    }
    if (typeof value !== "string") {
      refuse(`switches.${name} takes a string value (environment variables are strings; the empty string counts as unset)`)
    }
    if (!KNOWN_SWITCHES.has(name)) {
      refuse(`switches.${name} is not a known switch (check the name against the OPENCODE_AUTO_* registry, auto-core src/switches.ts)`)
    }
    process.env[name] = value
  }
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
    refuse(`the worker takes exactly one argument: the run request as a JSON document (usage: opencode-auto-server worker '<json>' — { "directory": "<dir>", "options": { … }, "switches": { "OPENCODE_AUTO_…": "…" } })`)
  }
  let document: unknown
  try {
    document = JSON.parse(argv[0]!)
  } catch (error) {
    refuse(`the run request is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof document !== "object" || document === null || Array.isArray(document)) {
    refuse("the run request must be a JSON object: { \"directory\": \"<dir>\", \"options\"?: { … }, \"switches\"?: { … } }")
  }
  const request = document as Record<string, unknown>
  for (const key of Object.keys(request)) {
    if (key === "directory" || key === "options" || key === "switches") continue
    // A dedicated config carrier gets the same answer as a config key in
    // options: there is no per-run config surface, by constitution.
    if (key === "config") {
      refuse(`a run request carries no config: the constitutional keys are frozen by init (.opencode/auto/config.json); revise them with opencode-auto amend <dir>, or edit that file directly`)
    }
    if (key in CONFIG_KEYS) refuseFrozen("", `"${key}" `, CONFIG_KEYS[key]!)
    if (HAND_EDITED_KEYS.has(key)) refuse(`"${key}" is a config key (hand-edited in .opencode/auto/config.json); a run request carries no config — config keys are frozen by init`)
    refuse(`unknown request field "${key}" (the run request takes directory, options and switches)`)
  }
  if (typeof request.directory !== "string" || !request.directory.trim()) {
    refuse(`the run request requires "directory": the target directory of the run (resolved against the worker's working directory)`)
  }
  const directory = resolve(request.directory)
  const options = parseOptions(request.options)
  applySwitches(request.switches)

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
  // progress persisted (in P1 a worker exits 3 only when the run requests
  // its own exit — the daemon-driven graceful pause arrives with the P3
  // transport), 130 force-terminated.
  const code = await runAll(directory, runOptions(config, mode, options))
  process.exit(code)
}

// The runAll options, the CLI's runOptions for this request: the config
// init froze (loaded strictly above) plus the request's per-run options.
// Config values never come from the request — that is the frozen-flag
// refusal's whole point.
function runOptions(config: ProjectConfig, mode: ModeSpec, options: ParsedOptions): RunAllOpts {
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
