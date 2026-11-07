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
import { CONFIG_KEY_SPELLINGS, configKeyRevision } from "@opencode-ai/auto-core/config"
import { RETIRED_SWITCHES, SWITCH_ENV } from "@opencode-ai/auto-core/switches"

// A usage error in the run request. The worker turns it into its stderr
// refusal with exit 1 (the CLI convention); the daemon turns it into a 400
// — the message itself is the shared artifact.
export class RequestError extends Error {}

// The per-run options (the payload's `options`; the flags the CLI's `run`
// takes as its own session flags, in their JSON form). interactive is
// deliberately absent — see parseOptions. repair/stopAfter/boundary are the
// run-side widths the CLI's run gained since (0079 §4, 0128, 0101 D1) —
// plain-run fields, refused under a plan or transfer payload (the core
// carries no budget under a stop condition; the worker enforces the pair).
export type RunRequestOptions = {
  verbose?: boolean
  waitAnswer?: number
  waitBetween?: number
  permission?: PermissionMode
  newSession?: boolean
  dryrun?: boolean
  maxSessions?: number
  server?: string
  repair?: number
  stopAfter?: string
  boundary?: "stop" | "flow"
}

// The options after validation, defaults resolved (the CLI's parse* helpers'
// absent-value semantics: waitAnswer/waitBetween 0 = no wait, permission
// ask-deny, maxSessions 1). Width ≥ 2 is served (plans/0162, the reserved
// call of plans/0069 §6 item 5 made): it activates the core's lane
// scheduler — doc lanes at tier 0, worktree lanes under treeLanes on|auto,
// the lane children being workers of this binary (the profile's
// laneLauncher self-spawns them) — and the daemon attaches no interactive
// transport to a wide run (the core refuses a channel under width, the
// CLI's own rule, so its questions take the stdin-closed degradation
// path). repair defaults to 0 (none), boundary to "stop" (the reading of
// absent — only "flow" is threaded into the run, the CLI's own shape).
export type RunOptions = {
  verbose: boolean
  waitAnswer: number
  waitBetween: number
  permission: PermissionMode
  newSession: boolean
  dryrun: boolean
  maxSessions: number
  server: string | undefined
  repair: number
  stopAfter: string | undefined
  boundary: "stop" | "flow"
}

// The constitutional config keys (the CLI's CONFIG_FLAGS plus the two
// hand-edited-only keys): frozen by init into .opencode/auto/config.json,
// revised by amend, never set on a run. Both the config-file spelling and
// the CLI's flag spelling are recognized; the revision hint of each renders
// from the core's one table (auto-core src/config.ts configKeyRevision,
// plans/0193 D2 — this shell's mirror of the CLI's amendHint shapes drifted
// by lockstep misses, phases teaching the amend flag 0137 retired).
// AUTO-DECISION (refusal wording, re-read by plans/0193 D2): the frozen-key
// refusal names the CLI's `opencode-auto amend` because that is a real
// revision surface beside the daemon (the shell's own amend operation being
// the other — the request grammar speaks the flag tails as field spellings);
// plans/0067 §三 item 5's "can take the hint over then" remainder stands.
export const CONFIG_KEYS: Record<string, string> = Object.fromEntries(CONFIG_KEY_SPELLINGS.map((key) => [key, configKeyRevision(key).clause]))
// Keys no flag reaches (plans/0049 G9; the tier-1 lane knobs beside
// --tree-lanes the same class, plans/0096 D9): the refusal names the file
// alone.
export const HAND_EDITED_KEYS = new Set(["acceptanceGate", "build", "lanes"])

// The per-run options a run request accepts (the CLI `run` session flags'
// JSON form); interactive is deliberately absent — see parseOptions.
export const OPTION_KEYS = new Set(["verbose", "waitAnswer", "waitBetween", "permission", "newSession", "dryrun", "maxSessions", "server", "repair", "stopAfter", "boundary"])
const PERMISSION_MODES: readonly PermissionMode[] = ["auto-allow", "ask-allow", "ask-deny", "ask-fail"]

// Every name the env-switch registry answers to: the live switches plus the
// env-only names it registers (models, server) and the retired variables
// (which the core answers with their own notice when set — passed through,
// never refused here).
export const KNOWN_SWITCHES = new Set([...Object.values(SWITCH_ENV), ...Object.keys(RETIRED_SWITCHES)])

// The frozen-key refusal, the API-side equivalent of the CLI's
// refuseFrozenFlags line (packages/auto test/e2e.test.ts pins its shape):
// "was frozen by init", the config file, the revision clause from the core's
// one table (the file-edit offer only where it is a real remedy — phases
// teaches the roadmap line alone).
export function frozenRefusal(where: string, key: string): string {
  const revision = configKeyRevision(key.trim())
  return `${where}${key} was frozen by init (.opencode/auto/config.json). To change: ${revision.clause}${revision.file ? ", or edit that file directly" : ""}`
}

function fail(message: string): never {
  throw new RequestError(message)
}

export function runOptionDefaults(): RunOptions {
  return { verbose: false, waitAnswer: 0, waitBetween: 0, permission: "ask-deny", newSession: false, dryrun: false, maxSessions: 1, server: undefined, repair: 0, stopAfter: undefined, boundary: "stop" }
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
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail("options must be an object holding the run's per-run options (verbose, waitAnswer, waitBetween, permission, newSession, dryrun, maxSessions, server, repair, stopAfter, boundary)")
  const given = raw as Record<string, unknown>
  for (const key of Object.keys(given)) {
    if (key in CONFIG_KEYS) fail(frozenRefusal("options.", key))
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
    // Width ≥ 2 is served since plans/0162 — the reserved call of plans/0069
    // §6 item 5 made by the shell owner: the core has run concurrency since
    // 0068 (width alone activates the scheduler since 0125 — doc lanes at
    // tier 0, worktree lanes under treeLanes on|auto), the lane children
    // are workers of this binary (the profile's laneLauncher self-spawns
    // them), and the daemon attaches no interactive transport to a wide run
    // (the core's own refusal — one channel cannot serve concurrent
    // sessions — so questions degrade the CLI's width-run way).
    parsed.maxSessions = value
  }
  if ("server" in given) {
    const value = given.server
    if (typeof value !== "string" || !value.trim()) fail("options.server takes a URL string (the external agent server this run talks to)")
    parsed.server = value
  }
  // --repair (the CLI's run option, auto-core plans/0079 §4): the bounded
  // repair budget, 0..10 rounds; 0 (also the serialized default's spelling
  // of absent) = none — the first FAIL verdict blocks.
  if ("repair" in given) {
    const value = given.repair
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 10) {
      fail("options.repair takes 0..10 (automatic repair rounds before blocking for the human; 0 = none, the default)")
    }
    parsed.repair = value
  }
  // --stop-after (auto-core plans/0128): the task id whose completion ends
  // this run — the serial path alone (the core's own confinement, refused
  // up front as the width pair below so the request dies as a 400, never a
  // spawned run that exits 1 in its first lines).
  if ("stopAfter" in given) {
    const value = given.stopAfter
    if (typeof value !== "string" || !/^T-\d{3,}$/.test(value)) {
      fail("options.stopAfter takes a task id (T-NNN): the task whose completion ends this run")
    }
    parsed.stopAfter = value
  }
  // --boundary (auto-core plans/0101 D1): run's phase-boundary shape — stop
  // (the default) ends the run at each clean phase end naming transfer, flow
  // crosses the boundaries continuously.
  if ("boundary" in given) {
    const value = given.boundary
    if (value !== "stop" && value !== "flow") {
      fail("options.boundary takes stop or flow (stop ends the run at each clean phase end, the default; flow crosses the boundaries continuously as before)")
    }
    parsed.boundary = value
  }
  // The width pairs the core itself refuses at run start (auto-core
  // src/loop-task.ts's --stop-after confinement; src/loop-preflight.ts's
  // waitAnswer refusal) are refused here instead — the shared-validator
  // pattern's own rule: an invalid request is a 400 on POST /runs, never a
  // 202 whose run dies on arrival, and the worker's stderr refusal carries
  // the same text for a hand-spawned payload.
  if (parsed.stopAfter !== undefined && parsed.maxSessions >= 2) {
    fail(`options.stopAfter is a serial-path option: it cannot ride maxSessions ${parsed.maxSessions} (the core confines --stop-after to one-task-at-a-time runs — send it alone at the default width 1, or run the phase wide without it)`)
  }
  if (parsed.waitAnswer > 0 && parsed.maxSessions >= 2) {
    fail(`options.waitAnswer cannot ride maxSessions ${parsed.maxSessions}: one answer window cannot serve concurrent sessions (the core's own refusal — a wide run takes the no-wait question path)`)
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
// do with them: the worker sets them on its own process environment ahead
// of the core's single parse — autoSwitches memoizes on first access inside
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

// The interactive transport payload (P3b): what the daemon writes into the
// spawn request — the worker bridge URL (ws://…/runs/<id>/worker) and the
// per-run secret that authenticates the connection — and what the worker
// entry builds its Interactive implementation from. Daemon-written, never
// client-written: POST /runs does not accept it (the interactive transport
// is the daemon's own surface, on for every run it spawns), so a request
// carrying it by hand is a usage error on the daemon side and a validated
// field on the worker side.
export type TransportPayload = { run: string; url: string; token: string }

export function parseTransport(raw: unknown): TransportPayload {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail("transport must be an object: { \"run\": \"<run id>\", \"url\": \"ws://…/runs/<run id>/worker\", \"token\": \"<the per-run secret>\" }")
  }
  const given = raw as Record<string, unknown>
  for (const key of Object.keys(given)) {
    if (key === "run" || key === "url" || key === "token") continue
    fail(`transport.${key} is not a transport field (run, url, token)`)
  }
  const run = given.run
  const url = given.url
  const token = given.token
  if (typeof run !== "string" || !run.trim()) fail('transport.run takes the run id the daemon assigned ("run-<n>")')
  if (typeof token !== "string" || !token.trim()) fail("transport.token takes the per-run secret the daemon generated for the worker bridge")
  if (typeof url !== "string" || !url.trim()) fail('transport.url takes the worker bridge WebSocket URL ("ws://<host>:<port>/runs/<run id>/worker")')
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    fail(`transport.url is not a URL: ${url}`)
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    fail(`transport.url takes a ws:// or wss:// URL (the worker bridge WebSocket endpoint), not ${parsed.protocol}`)
  }
  return { run, url, token }
}

// The plan payload (P3c, the plan unlock): a request carrying `plan` runs
// the worker as the CLI's `plan` command does — runAll under
// stopBefore === "execute" (humanQuestions armed,
// auto-core src/opts.ts:346/:179-185), its questions riding the interactive
// transport like every other ask. `input` is the planning input (the CLI's
// -p; the API carries the text itself — `--file` is the CLI's local-file
// convenience, and the daemon reads no request-named files outside its own
// data directory and registered projects); `append` rides an input exactly
// as the CLI's --append does. Daemon-written on the worker payload (the
// plan operation builds it after planPrelude's no-agent routes had their
// fast path), never client-written: POST /runs refuses a `plan` field — the
// plan surface is POST /projects/<project>/plan.
export type PlanPayload = { input?: string; append: boolean }

export function parsePlan(raw: unknown): PlanPayload {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail('plan must be an object: { "input"?: "<the planning input text>", "append"?: true|false }')
  }
  const given = raw as Record<string, unknown>
  for (const key of Object.keys(given)) {
    if (key === "input" || key === "append") continue
    fail(`plan.${key} is not a plan field (input, append)`)
  }
  let input: string | undefined
  if ("input" in given) {
    if (typeof given.input !== "string" || !given.input.trim()) fail("plan.input takes the planning input text (the CLI's plan -p <text>; the whole document, not a file path)")
    input = given.input
  }
  let append = false
  if ("append" in given) {
    if (typeof given.append !== "boolean") fail("plan.append takes true|false (append the tasks planned from the input to the current phase; requires input)")
    append = given.append
  }
  if (append && input === undefined) fail('plan.append rides a planning input: pass "input" with it (appending adds the tasks planned from the input)')
  return { ...(input !== undefined ? { input } : {}), append }
}

// The transfer payload (plans/0101 D2, the service absorb): a request
// carrying `transfer` runs the worker as the CLI's `transfer` command does —
// runTransfer, one person-bracketed advance resolved by state (the project
// start, the phase boundary, the round close/open), the loop under
// stopBefore "formulate" inside it, its questions riding the interactive
// transport like every other ask. `resynthesize` is the CLI's
// transfer-only flag (plans/0101 D3): bypass the digest-keep of a standing
// plan task so the reconstruct lands the new todo for review. Daemon-written
// on the worker payload (the transfer operation spawns it after its own
// request-shape checks) or written by this shell's own `transfer` CLI
// command — never client-written: POST /runs refuses a `transfer` field, the
// advance surface is POST /projects/<project>/transfer.
export type TransferPayload = { resynthesize?: boolean }

export function parseTransfer(raw: unknown): TransferPayload {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail('transfer must be an object: { "resynthesize"?: true|false }')
  }
  const given = raw as Record<string, unknown>
  for (const key of Object.keys(given)) {
    if (key === "resynthesize") continue
    fail(`transfer.${key} is not a transfer field (resynthesize)`)
  }
  let resynthesize: boolean | undefined
  if ("resynthesize" in given) {
    if (typeof given.resynthesize !== "boolean") fail("transfer.resynthesize takes true|false (bypass the digest-keep of a standing plan task: the synthesis re-voices the sources and the reconstruct lands the new todo for review)")
    resynthesize = given.resynthesize
  }
  return { ...(resynthesize !== undefined ? { resynthesize } : {}) }
}

// The lane payload (plans/0162): a request carrying `lane` runs the worker
// as the CLI's hidden `_lane` entry does — runLaneWorker, one unit in its
// worktree, the lane report the parent run reads after this process exits.
// Written only by this shell's own profile laneLauncher (a worker of this
// binary self-spawned per lane dispatch, src/profile.ts), never by the
// daemon's POST /runs and never by a client — the lane surface is the
// launcher's private channel, the machine shape of the CLI's hidden
// subcommand, and a run request naming it gets the same refusal `plan` and
// `transfer` get. The worktree holds the copied scaffolding (config
// included), so the child loads the project config itself like the CLI's
// _lane does; the session flags take their defaults and everything else
// rides the inherited environment. `merge` is a conflict repair's
// re-dispatch alone (the parent's current main branch the lane merges into
// its branch first — auto-core src/shell.ts's LaneMergeInstruction).
export type LanePayload = { unit: string; merge?: string }

export function parseLane(raw: unknown): LanePayload {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail('lane must be an object: { "unit": "<task id>", "merge"?: "<branch>" }')
  }
  const given = raw as Record<string, unknown>
  for (const key of Object.keys(given)) {
    if (key === "unit" || key === "merge") continue
    fail(`lane.${key} is not a lane field (unit, merge)`)
  }
  const unit = given.unit
  if (typeof unit !== "string" || !/^T-\d{3,}(\.S\d{2,})?$/.test(unit)) {
    fail('lane.unit takes the unit id this lane worker runs (T-NNN, or a stream lane T-NNN.Snn)')
  }
  let merge: string | undefined
  if ("merge" in given) {
    if (typeof given.merge !== "string" || !given.merge.trim()) fail("lane.merge takes the branch name of a conflict repair's re-dispatch (the parent's current main branch the lane merges into its own first)")
    merge = given.merge
  }
  return { unit, ...(merge !== undefined ? { merge } : {}) }
}
