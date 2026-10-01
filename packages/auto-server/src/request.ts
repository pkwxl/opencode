// The run request's own vocabulary (P1b/P1c, auto-core plans/0067): the
// per-run options and OPENCODE_AUTO_* switch overrides a run may carry, and
// the constitutional refusal every other key gets — config keys are frozen
// by init (.opencode/auto/config.json), revised by amend, never set on a
// run. This module is the one shared piece between the two processes of the
// service topology: the worker (a process entry; src/worker.ts) validates
// with it before running, and the daemon (src/daemon.ts) validates with it
// before spawning, so an invalid request is a 400 on POST /runs rather than
// a 202 whose run dies on arrival — the same texts either way, because the
// worker's stderr refusal and the daemon's HTTP refusal must read alike.
// Pure library code: no process state, no env writes (the worker applies the
// parsed switches to its own environment; the daemon only passes them on).
import type { PermissionMode } from "@opencode-ai/auto-core/opts"
import { RETIRED_SWITCHES, SWITCH_ENV } from "@opencode-ai/auto-core/switches"

// A usage error in the run request. The worker turns it into its stderr
// refusal with exit 1 (the CLI convention); the daemon turns it into a 400
// — the message itself is the shared artifact.
export class RequestError extends Error {}

// The per-run options (the payload's `options`; the flags the CLI's `run`
// takes as its own session flags, in their JSON form). interactive is
// deliberately absent — see parseOptions.
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

// The options after validation, defaults resolved (the CLI's parse* helpers'
// absent-value semantics: waitAnswer/waitBetween 0 = no wait, permission
// ask-deny, maxSessions 1 — the only value the core accepts today).
export type RunOptions = {
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
export const CONFIG_KEYS: Record<string, string> = {
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
  "no-wrapup": "--no-wrapup (use --no-wrapup to turn on)",
  phases: "--phases <value>",
  parallel: "--parallel <value>",
  scanExempt: "--scan-exempt <value>",
  "scan-exempt": "--scan-exempt <value>",
}
// Keys no flag reaches (plans/0049 G9): the refusal names the file alone.
export const HAND_EDITED_KEYS = new Set(["acceptanceGate", "build"])

// The per-run options a run request accepts (the CLI `run` session flags'
// JSON form); interactive is deliberately absent — see parseOptions.
export const OPTION_KEYS = new Set(["verbose", "waitAnswer", "waitBetween", "permission", "newSession", "dryrun", "maxSessions", "server"])
const PERMISSION_MODES: readonly PermissionMode[] = ["auto-allow", "ask-allow", "ask-deny", "ask-fail"]

// Every name the env-switch registry answers to: the live switches plus the
// env-only names it registers (models, server) and the retired variables
// (which the core answers with their own notice when set — passed through,
// never refused here).
export const KNOWN_SWITCHES = new Set([...Object.values(SWITCH_ENV), ...Object.keys(RETIRED_SWITCHES)])

// The frozen-key refusal, the API-side equivalent of the CLI's
// refuseFrozenFlags line (packages/auto test/e2e.test.ts pins its shape):
// "was frozen by init", the config file, the amend revision hint.
export function frozenRefusal(where: string, key: string, hint: string): string {
  return `${where}${key} was frozen by init (.opencode/auto/config.json). To change: opencode-auto amend <dir> ${hint}, or edit that file directly`
}

function fail(message: string): never {
  throw new RequestError(message)
}

export function runOptionDefaults(): RunOptions {
  return { verbose: false, waitAnswer: 0, waitBetween: 0, permission: "ask-deny", newSession: false, dryrun: false, maxSessions: 1, server: undefined }
}

// The run request's options: strict allowlist, values validated like the
// CLI's parse* helpers. A config key in any spelling gets the frozen
// refusal; interactive gets its own refusal — a worker has no terminal to
// host the resident input line, and the interactive transport (io-injected
// Interactive over WebSocket) arrives with P3 (plans/0067 §四, T-093/T-094);
// accepting it here would be a silent no-op or a hang, so it is a usage
// error pointing at the CLI until that unit lands.
export function parseOptions(raw: unknown): RunOptions {
  if (raw === undefined) return runOptionDefaults()
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail("options must be an object holding the run's per-run options (verbose, waitAnswer, waitBetween, permission, newSession, dryrun, maxSessions, server)")
  const given = raw as Record<string, unknown>
  for (const key of Object.keys(given)) {
    if (key in CONFIG_KEYS) fail(frozenRefusal("options.", key, CONFIG_KEYS[key]!))
    if (HAND_EDITED_KEYS.has(key)) fail(`options.${key} is a config key with no flag (hand-edited in .opencode/auto/config.json); a run request carries no config — config keys are frozen by init`)
    if (key === "interactive") {
      fail(
        `options.interactive is refused: a worker has no terminal (its stdin is closed), so the resident input line cannot live here — ` +
          `interactive input arrives with the WebSocket transport of the later units (P3); until then drive interactive runs with opencode-auto run <dir> -i`,
      )
    }
    if (!OPTION_KEYS.has(key)) {
      fail(`options.${key} is not a run option (accepted: ${[...OPTION_KEYS].sort().join(", ")}); the project's config keys are frozen by init (.opencode/auto/config.json), revised with opencode-auto amend <dir>`)
    }
  }
  const parsed = runOptionDefaults()
  if ("verbose" in given) {
    if (typeof given.verbose !== "boolean") fail("options.verbose takes true|false")
    parsed.verbose = given.verbose
  }
  if ("newSession" in given) {
    if (typeof given.newSession !== "boolean") fail("options.newSession takes true|false")
    parsed.newSession = given.newSession
  }
  if ("dryrun" in given) {
    if (typeof given.dryrun !== "boolean") fail("options.dryrun takes true|false")
    parsed.dryrun = given.dryrun
  }
  if ("waitAnswer" in given) parsed.waitAnswer = parseMinutes(given.waitAnswer, "waitAnswer", "the minutes to wait for the human's answer before the fallback applies")
  if ("waitBetween" in given) parsed.waitBetween = parseMinutes(given.waitBetween, "waitBetween", "the pause between tasks (the timeout auto-continues; no terminal input arrives here)")
  if ("permission" in given) {
    const value = given.permission
    if (typeof value !== "string" || !(PERMISSION_MODES as readonly string[]).includes(value)) {
      fail(`options.permission takes ${PERMISSION_MODES.join("|")}; defaults to ask-deny`)
    }
    parsed.permission = value as PermissionMode
  }
  if ("maxSessions" in given) {
    const value = given.maxSessions
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      fail("options.maxSessions takes a positive integer (concurrent AI sessions); defaults to 1")
    }
    if (value > 1) {
      fail(`options.maxSessions ${value}: concurrent execution is not supported yet; only 1 is accepted (plan for parallelism at init --parallel; tasks still run one at a time)`)
    }
    parsed.maxSessions = value
  }
  if ("server" in given) {
    const value = given.server
    if (typeof value !== "string" || !value.trim()) fail("options.server takes a URL string (the external agent server this run talks to)")
    parsed.server = value
  }
  return parsed
}

// --wait-answer/--wait-between absent = 0 (no wait — the worker entry's
// default, since no human attends a worker); given: an integer 0..60
// minutes.
function parseMinutes(raw: unknown, key: string, what: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 60) {
    fail(`options.${key} takes an integer 0..60 (minutes; 0 = no wait) — ${what}`)
  }
  return raw
}

// The per-run switch overrides, validated only (the caller decides what to
// do with them: the worker sets them on its own process environment ahead of
// the core's single parse — autoSwitches memoizes on first access inside
// runAll's preflight, a fresh process per run is what makes this layer
// per-run). Names are validated against the registry so a typo is a usage
// error, never a silent no-op (the CLI's unknown-option interception rule);
// values are strings (environment variables are strings, and the core reads
// the empty string as unset).
export function parseSwitches(raw: unknown): Record<string, string> {
  if (raw === undefined) return {}
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail("switches must be an object of OPENCODE_AUTO_* names to string values (the per-run experimental switch overrides)")
  const switches: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!name.startsWith("OPENCODE_AUTO_")) {
      fail(`switches.${name}: a switch name is an OPENCODE_AUTO_* environment variable name (the registry of auto-core src/switches.ts)`)
    }
    if (typeof value !== "string") {
      fail(`switches.${name} takes a string value (environment variables are strings; the empty string counts as unset)`)
    }
    if (!KNOWN_SWITCHES.has(name)) {
      fail(`switches.${name} is not a known switch (check the name against the OPENCODE_AUTO_* registry, auto-core src/switches.ts)`)
    }
    switches[name] = value
  }
  return switches
}
