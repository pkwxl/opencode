// The REST lifecycle surface (P1d, auto-core plans/0067 §三.3): the operations
// mirroring the CLI's remaining command surface — config ops (init / amend /
// fix / reset), units (close, task-add) and models — plus the P1 `plan`
// boundary. Served by the daemon under /projects/<project>/<op> (the
// whitelist resolves the project exactly as POST /runs does), this module is
// the API's own shell duty in the CLI's shape: every gate the CLI's shell
// runs, every refusal text, every write ordering — but through the core's
// library functions, never a re-implementation. The constitution of this
// layer (plans/0067 §五, assessment §11 risk 1):
//   - every state change reaches disk through the core (saveProjectConfig,
//     renderAgentContract, renderProjectBrief, ensurePointer,
//     ensureInitGitignore, applyFix, applyReset, closeUnit, planPrelude →
//     addTask/establishRound/syncPhaseIndex); the two template writes the
//     CLI shell also performs itself (opencode.json, the agent contract's
//     file bytes) use the core's own renderer for the contract, and nothing
//     here ever writes `.auto/`, `docs/` unit state or an index tick;
//   - **confirm and clean-tree are two separate request fields** ("confirm",
//     "cleanTree"), never one bundled force: the CLI's -f skips both the
//     confirmation and the cleanliness gate, and the API must not inherit the
//     bundling (assessment §5). The confirmation itself is mapped onto the
//     core's io-injectable gate (confirm.ts) — the request's `confirm: true`
//     is the "y" the [y/N] prompt would collect, routed through the same
//     normalization (only y/yes pass);
//   - config ops refuse while `liveRunLock` returns a holder (the CLI's
//     init/amend/fix/reset refusals); close, task-add and plan take the lock
//     themselves around their writes (acquire "close"/"plan", the CLI's
//     own command names, so a live holder answers before any write);
//   - models and `fix` dryrun are read-only: no lock, no refusal beside a
//     live run (shell-contract §9; the CLI's fix --dryrun skip list).
//
// Status vocabulary (documented in docs/daemon.md): 200 the op served (body
// carries `code`, the CLI's own exit code, and `lines`, the CLI's own
// output); 400 a request-shape error; 404 unregistered project; 409 the
// target's state refuses (body carries the CLI exit code 1|2 and its lines;
// the clean-tree gate answers 409 with `gate: "cleanTree"`); 423 a live run
// lock; 428 the confirmation gate unanswered (`gate: "confirm"`, the exact
// question included); 501 a route this version refuses (agent planning needs
// the interactive transport of P3; the models probe is not exposed).
import { Readable, Writable } from "node:stream"
import { join } from "node:path"
import { renderProjectBrief, BRIEF_FILE } from "@opencode-ai/auto-core/brief"
import { checkCleanTree } from "@opencode-ai/auto-core/clean"
import { confirm, type ConfirmIO } from "@opencode-ai/auto-core/confirm"
import {
  CONFIG_DEFAULTS,
  CONFIG_FILE,
  PARALLEL_LEVELS,
  formatProjectConfig,
  legacyModeFallback,
  loadOverwriteBaseline,
  loadProjectConfig,
  mergeProjectConfig,
  saveProjectConfig,
  scanExemptProblem,
  type ParallelLevel,
  type ProjectConfig,
  type RetiredKey,
} from "@opencode-ai/auto-core/config"
import { applyFix, fixHint, formatFixPlan, planFix, renderAgentContract } from "@opencode-ai/auto-core/config-fix"
import { closeUnit, type CloseChanges } from "@opencode-ai/auto-core/close"
import { commitIdentityProblem } from "@opencode-ai/auto-core/git"
import { ensureInitGitignore } from "@opencode-ai/auto-core/gitignore"
import { acquireRunLock, liveRunLock, lockLines, type LockState } from "@opencode-ai/auto-core/lock"
import { loadModes } from "@opencode-ai/auto-core/mode"
import { describeModels, formatModels } from "@opencode-ai/auto-core/models-describe"
import { planPrelude } from "@opencode-ai/auto-core/plan"
import { applyReset, formatResetPlan, planReset } from "@opencode-ai/auto-core/reset"
import {
  currentRound,
  legacyLayoutProblem,
  parsePhases,
  plannedPhaseUnits,
  readPhases,
  type PhaseState,
} from "@opencode-ai/auto-core/phases"
import { loadPhaseTypes } from "@opencode-ai/auto-core/phases/custom"
import { phasesProblem, PRESET_FORM } from "@opencode-ai/auto-core/phases/registry"
import { ensurePointer } from "@opencode-ai/auto-core/agents-block"
import { roundDirName } from "@opencode-ai/auto-core/docpaths"
import { SUBTASK_MODES } from "@opencode-ai/auto-core/opts"
import { loadIntents } from "@opencode-ai/auto-core/intent/load"
import { usePromptLibrary } from "@opencode-ai/auto-core/template"
import type { RegisteredProject, Scope } from "./store"
import { RequestError } from "./request"
import templateConfig from "@opencode-ai/auto-core/templates/opencode.json" with { type: "file" }

// The canonical unit refs closeUnit takes (the CLI's CLOSE_REF): a round
// R-NN, a phase R-NN.P<nn> or a task T-NNN — padded shapes never name another
// unit by accident.
const CLOSE_REF = /^(?:R-\d{2,}|R-\d{2,}\.P\d{2,}|T-\d{3,})$/

const CONTRACT_FILE = join(".opencode", "agent", "auto.md")

export type OpRequest = {
  project: RegisteredProject
  // The parsed JSON body of a POST (undefined when absent); GET carries only
  // the query.
  body: Record<string, unknown> | undefined
  query: URLSearchParams
}

export type OpOutcome = { status: number; body: Record<string, unknown> }

export type OpDefinition = {
  method: "GET" | "POST"
  // The route segment under /projects/<project>/ the operation answers to.
  segment: string
  // What the 403 names when the token lacks the scope.
  what: string
  scope: Scope
  // Whether this request writes: such requests hold the daemon's per-project
  // in-flight slot and refuse beside a live registry run (fix decides per
  // request — its dryrun is the read-only half that runs beside a live run).
  write: (body: Record<string, unknown> | undefined) => boolean
  run: (request: OpRequest) => Promise<OpOutcome>
}

const textOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const route = (project: RegisteredProject, op: string): string => `/projects/${encodeURIComponent(project.name)}/${op}`

const ok = (lines: string[], extras: Record<string, unknown> = {}): OpOutcome => ({ status: 200, body: { code: 0, lines, ...extras } })
const refused = (code: 1 | 2, lines: string[], extras: Record<string, unknown> = {}): OpOutcome => ({
  status: 409,
  body: { error: lines[0] ?? "refused", code, lines, ...extras },
})
const bad = (message: string): OpOutcome => ({ status: 400, body: { error: message } })
const notImplemented = (message: string): OpOutcome => ({ status: 501, body: { error: message } })

// The run-lock refusals, the CLI's own holder text (lockLines): 423, the same
// status POST /runs answers a live holder with.
const locked = (directory: string, holder: LockState): OpOutcome => {
  const lines = lockLines(directory, holder)
  return {
    status: 423,
    body: {
      error: lines[0]!,
      lines,
      holder: holder === "unreadable" ? undefined : holder,
      hint: "another driver process holds the directory's run lock; wait for it to finish or stop it (the CLI's exit-1 refusal is the same rule; if no such process exists, delete .auto/run.lock by hand — cross-host locks cannot be probed from here)",
    },
  }
}

// The P1 plan boundary (assessment §5, the todo's own boundary statement):
// any route that would start an agent planning session is refused until the
// P3c unit lifts the restriction. plan's sessions run with humanQuestions —
// the human's questions wait with no timeout and never proxy-answer
// (auto-core src/opts.ts:179-185, armed by stopBefore === "execute" at
// src/opts.ts:346) — and a headless worker's closed stdin only degrades such
// a session to blocked / exit 2, so serving the route would be a parked
// request, not a plan.
const P3_REFUSAL =
  "this route requires the interactive transport (P3): it would start an agent planning session whose human questions wait with no timeout (humanQuestions), and a headless worker's closed stdin leaves such a session blocked — " +
  "the WebSocket question queue that carries it arrives with the P3c unit. Until then the no-agent routes are served (round establishment, the round-close gate, the phase-index re-sync, the refusal stops and the task-add operation), and interactive planning stays with the CLI: opencode-auto plan <dir>"

// The environment the daemon's runs see: the daemon's own environment with
// the ambient OPENCODE_AUTO_* layer dropped — the same filter spawnWorker
// applies to its children (per-run switch overrides ride the run request,
// never the daemon's environment). The models operation describes what a run
// of THIS daemon would route on, so it reads the same environment.
export function runEnv(): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^OPENCODE_AUTO_/.test(key)))
}

// The confirmation, mapped onto the core's io-injectable gate (confirm.ts
// lines 18-20) rather than a re-implemented prompt: the API is the terminal
// side — the caller's explicit `confirm: true` is the "y" the [y/N] prompt
// would collect, and anything else (absent, false) is the gate's own "N"
// default (a closed input answers nothing, and the core's normalization
// decides: only y/yes pass). The question the gate asked is captured from the
// injected output, so the refusal can carry the exact wording a person would
// have seen.
async function askConfirm(question: string, confirmed: boolean): Promise<{ ok: boolean; asked: string }> {
  const asked: string[] = []
  const input = new Readable({
    read() {
      this.push(confirmed ? "y\n" : "\n")
      this.push(null)
    },
  })
  const output = new Writable({
    write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void) {
      asked.push(String(chunk))
      callback()
    },
  })
  const io: ConfirmIO = { tty: true, input, output }
  return { ok: await confirm(question, io), asked: asked.join("").trim() }
}

// The two mistouch gates of a destructive write, each with its own request
// field — never one bundled "force" (the CLI's -f skips both; the API keeps
// them apart, assessment §5). Order matches the CLI's ("intercept first, ask
// second — a person must not answer y only to then hit an error"):
//   ① the worktree cleanliness gate (checkCleanTree), skipped exactly when
//      the request says `"cleanTree": true` — it applies without a TTY too:
//      what a non-TTY skips is the confirmation, never this gate;
//   ② the confirmation, always asked through the core's gate — the request's
//      `confirm` field is the answer, so the gate is never "skipped", only
//      answered.
// `extras` supplies the plan/findings the refusal should carry, so one round
// trip shows the caller what confirming would do.
async function gates(
  project: RegisteredProject,
  body: Record<string, unknown> | undefined,
  action: string,
  question: string,
  extras: () => Record<string, unknown>,
): Promise<OpOutcome | undefined> {
  if (body?.cleanTree !== true) {
    const dirty = await checkCleanTree(project.directory, action)
    if (dirty) {
      const lines = dirty.split("\n")
      return {
        status: 409,
        body: {
          error: lines[0]!,
          gate: "cleanTree",
          code: 1,
          lines,
          hint: 'send "cleanTree": true to run on a dirty worktree anyway — its own field, not the confirm field (git is the only undo of what this operation rewrites)',
          ...extras(),
        },
      }
    }
  }
  const answer = await askConfirm(question, body?.confirm === true)
  if (!answer.ok) {
    return {
      status: 428,
      body: {
        error: "confirmation required: this request did not confirm the destructive operation (nothing was changed)",
        gate: "confirm",
        question: answer.asked,
        hint: 'send "confirm": true to proceed — its own field, not the cleanTree field; the worktree check answers 409 under "cleanTree" when it applies',
        ...extras(),
      },
    }
  }
  return undefined
}

// The strict config load the CLI's run/plan/close share (loadRunConfig):
// strict failure beats silent fallback, the fix hint names the repair route,
// and the configured mode must be registered. 409 with the CLI's exit 1.
async function strictConfig(project: RegisteredProject): Promise<{ config: ProjectConfig } | OpOutcome> {
  let config: ProjectConfig
  try {
    config = await loadProjectConfig(project.directory)
  } catch (error) {
    const lines = [textOf(error)]
    const hint = await fixHint(project.directory)
    if (hint) lines.push(hint)
    return refused(1, lines)
  }
  let modes: Record<string, unknown>
  try {
    modes = loadModes(project.directory)
  } catch (error) {
    return refused(1, [textOf(error)])
  }
  if (!modes[config.mode]) {
    return refused(1, [
      `configured mode "${config.mode}" is not registered (currently supported: ${Object.keys(modes).join(", ")}); to fix: the amend operation with config.mode (${route(project, "amend")}), or edit .opencode/auto/config.json directly`,
    ])
  }
  return { config }
}

// The config-exists refusal of plan/close/task-add (the CLI's "nothing to
// plan / nothing to close"): a directory init never configured is refused
// rather than operated on with the defaults.
async function requireConfig(project: RegisteredProject, what: string): Promise<OpOutcome | undefined> {
  if (await Bun.file(join(project.directory, CONFIG_FILE)).exists()) return undefined
  const legacy = await legacyModeFallback(project.directory)
  return refused(1, [
    `nothing to ${what}: ${project.directory} has no ${CONFIG_FILE}; run the init operation first (${route(project, "init")})` +
      (legacy !== undefined ? ` (or the fix operation (${route(project, "fix")}), which writes it from the legacy .auto/config.json mode "${legacy}")` : ""),
  ])
}

// The constitutional keys an init/amend request may carry (the config-file
// spellings of the CLI's CONFIG_FLAGS). acceptanceGate and build have no flag
// (plans/0049 G9) and stay hand-edited; the retired flag spellings are not
// accepted either — the API speaks the file's language, and its refusal
// texts point the caller at the accepted set.
const CONFIG_REQUEST_KEYS = [
  "mode",
  "agent",
  "contextLimit",
  "subtask",
  "idleTime",
  "idleMax",
  "testByDriver",
  "handoverTest",
  "autoNumber",
  "wrapup",
  "phases",
  "parallel",
  "scanExempt",
] as const

// The parsed `config` object of an init/amend request: the CLI's
// parseConfigFlags in JSON form — the explicitly given keys (`explicit`,
// merged over the baseline), plus the three key droppers kept separate
// (--agent opencode, --parallel none and an empty scan-exempt list drop
// their key instead of setting it).
// Throws RequestError for request-shape problems (mapped to 400); a throw of
// any other Error is a target-state problem (a broken custom phase type file
// under .opencode/auto/phases/), which the caller maps to 409.
export type ConfigKeys = {
  explicit: Partial<ProjectConfig>
  mode?: string
  agent?: "opencode" | "claude"
  parallel?: "none" | ParallelLevel
  scanExempt: "none" | string[]
}

function parseConfigKeys(dir: string, raw: unknown): ConfigKeys {
  const fail = (message: string): never => {
    throw new RequestError(message)
  }
  if (raw === undefined) return { explicit: {}, scanExempt: "none" }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail(`config must be an object holding the constitutional keys init freezes (${CONFIG_REQUEST_KEYS.join(", ")})`)
  }
  const given = raw as Record<string, unknown>
  for (const key of Object.keys(given)) {
    if ((CONFIG_REQUEST_KEYS as readonly string[]).includes(key)) continue
    if (key === "acceptanceGate" || key === "build") {
      fail(`config.${key} is a config key with no flag (hand-edited in ${CONFIG_FILE}); the init and amend operations carry no such key`)
    }
    if (key.includes("-")) {
      fail(`config.${key}: use the config-file spelling (camelCase — ${CONFIG_REQUEST_KEYS.join(", ")})`)
    }
    fail(`config.${key} is not a constitutional key (accepted: ${CONFIG_REQUEST_KEYS.join(", ")})`)
  }
  const explicit: Partial<ProjectConfig> = {}
  let mode: string | undefined
  {
    const value = given.mode
    if (typeof value === "string" && value.trim()) mode = value
    else if (value !== undefined) fail("config.mode takes a registered mode name (a non-empty string); defaults to migrate")
  }
  let agent: "opencode" | "claude" | undefined
  {
    const value = given.agent
    if (value === "opencode" || value === "claude") agent = value
    else if (value !== undefined) fail("config.agent takes opencode|claude (the coding agent that runs the sessions); defaults to opencode. The agent contract is always .opencode/agent/auto.md")
  }
  {
    const value = given.contextLimit
    if (typeof value === "number" && Number.isInteger(value) && value >= 1) explicit.contextLimit = value
    else if (value !== undefined) fail("config.contextLimit takes a positive integer (thousands of tokens); defaults to 64")
  }
  {
    const value = given.subtask
    // AUTO-DECISION (the JSON boolean true is accepted as "true"): the config
    // file's own loader accepts it (plans/0059 D1 — the pipeline's name reads
    // as a boolean, so a hand-edited config may well write it as one); the
    // API accepts the file's spellings, no narrower.
    if (value === true) explicit.subtask = "true"
    else if (typeof value === "string" && (SUBTASK_MODES as readonly string[]).includes(value)) explicit.subtask = value as ProjectConfig["subtask"]
    else if (value !== undefined) fail(`config.subtask takes ${SUBTASK_MODES.join("|")}; defaults to auto`)
  }
  {
    const value = given.idleTime
    if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 120) explicit.idleTime = value
    else if (value !== undefined) fail("config.idleTime takes an integer 1..120 (minutes); defaults to 10")
  }
  {
    const value = given.idleMax
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1440) explicit.idleMax = value
    else if (value !== undefined) fail("config.idleMax takes an integer 0..1440 (minutes; 0 = no cap); defaults to 0")
  }
  for (const key of ["testByDriver", "handoverTest", "autoNumber", "wrapup"] as const) {
    const value = given[key]
    if (typeof value === "boolean") explicit[key] = value
    else if (value !== undefined) fail(`config.${key} takes true|false`)
  }
  {
    const value = given.phases
    if (typeof value === "string" && value.trim()) {
      // parsePhases throws on a broken custom phase type file (target state);
      // null is the request's own invalid value.
      const parsed = parsePhases(value, dir)
      if (parsed !== null) explicit.phases = PRESET_FORM.test(value) ? value : parsed.map((entry) => entry.type).join(",")
      else fail(`config.phases is invalid: ${phasesProblem(value, loadPhaseTypes(dir))}`)
    } else if (value !== undefined) {
      fail(`config.phases takes a letter preset (e.g. m, amt, admtvk) or a comma-separated list of phase type ids (e.g. "analysis,security-review,implement")`)
    }
  }
  let parallel: "none" | ParallelLevel | undefined
  {
    const value = given.parallel
    if (value === "none") parallel = "none"
    else if (typeof value === "string" && (PARALLEL_LEVELS as readonly string[]).includes(value)) {
      parallel = value as ParallelLevel
      explicit.parallel = parallel
    } else if (value !== undefined) fail(`config.parallel takes none|${PARALLEL_LEVELS.join("|")}; defaults to none`)
  }
  let scanExempt: "none" | string[] = "none"
  {
    const value = given.scanExempt
    if (Array.isArray(value) && value.every((item): item is string => typeof item === "string")) {
      const problems = value.flatMap((glob) => scanExemptProblem(glob) ?? [])
      if (problems.length) fail(`config.scanExempt: ${problems.join("; ")}`)
      if (value.length) scanExempt = value
    } else if (value !== undefined) {
      fail("config.scanExempt takes an array of path globs relative to the target directory ([] removes the key); defaults to none")
    }
  }
  return { explicit, ...(mode !== undefined ? { mode } : {}), ...(agent !== undefined ? { agent } : {}), ...(parallel !== undefined ? { parallel } : {}), scanExempt }
}

// The shared body of init and amend (the CLI's one shared block): every
// check before the first write (plans/0052 D7), the read-only prefix guard
// (plannedPhaseUnits — shell-contract §E.7), then the writes the CLI makes.
// Init is the stateless full overwrite (baseline = defaults + the
// hand-edited keys kept); amend is the per-key revision (baseline = the
// existing config, loaded strictly, the fix hint naming fix on a failure).
async function runConfigOp(kind: "init" | "amend", request: OpRequest): Promise<OpOutcome> {
  const { project, body } = request
  const dir = project.directory
  const amend = kind === "amend"
  for (const key of Object.keys(body ?? {})) {
    if (key === "config") continue
    if (key === "confirm" || key === "cleanTree") {
      if (amend) {
        return bad(
          key === "confirm"
            ? '"confirm" is not an amend field: amend discards no key, so there is no overwrite confirmation to answer'
            : '"cleanTree" is not an amend field: amend discards no key, so there is no worktree gate to skip',
        )
      }
      continue
    }
    return bad(`unknown ${kind} field "${key}" (the ${kind} request takes "config"${amend ? "" : ', "confirm" and "cleanTree"'})`)
  }
  // AUTO-DECISION (check order): request-shape errors answer before any
  // target read (an API's validation precedes resource state; the CLI
  // interleaves them because its flags parse at argv time).
  let keys: ConfigKeys
  try {
    keys = parseConfigKeys(dir, body?.config)
  } catch (error) {
    if (error instanceof RequestError) return bad(error.message)
    return refused(1, [textOf(error)])
  }
  if (amend && !Object.keys(keys.explicit).length && keys.mode === undefined && keys.agent === undefined && keys.parallel === undefined && keys.scanExempt === "none") {
    return bad(
      `name at least one key to change in "config" (for example: {"config":{"phases":"amt"}}); to refresh the agent contract and the AGENTS.md block without changing a key, run the fix operation (${route(project, "fix")})`,
    )
  }
  // An old-layout project is a usage error before anything is read or
  // written (M3.7; only reset stays available on one).
  const legacy = await legacyLayoutProblem(dir)
  if (legacy) return refused(1, [legacy])
  // The run lock: init/amend/fix/reset write what a running driver reads, so
  // they refuse while another process holds it (-f never overrode this, and
  // neither field here does).
  const holder = liveRunLock(dir)
  if (holder !== undefined) return locked(dir, holder)
  if (amend && !(await Bun.file(join(dir, CONFIG_FILE)).exists())) {
    const legacyMode = await legacyModeFallback(dir)
    return refused(1, [
      `nothing to amend: ${dir} has no ${CONFIG_FILE}; run the init operation (${route(project, "init")})` +
        (legacyMode !== undefined ? ` (or the fix operation (${route(project, "fix")}), which writes it from the legacy .auto/config.json mode "${legacyMode}")` : ""),
    ])
  }

  let existing: ProjectConfig
  let discarded: RetiredKey[] = []
  try {
    if (amend) existing = await loadProjectConfig(dir)
    else ({ config: existing, retired: discarded } = await loadOverwriteBaseline(dir))
  } catch (error) {
    const lines = [textOf(error)]
    const hint = await fixHint(dir)
    if (hint) lines.push(hint)
    return refused(1, lines)
  }
  // acceptanceGate/build (plans/0049 G9) have no flag, so a full-overwrite
  // init keeps them rather than silently erasing them; scanExempt has its
  // key and follows the stateless overwrite (the CLI's own AUTO-DECISION).
  const handEdited = { acceptanceGate: existing.acceptanceGate, build: existing.build }
  const base: ProjectConfig = amend ? existing : { ...CONFIG_DEFAULTS, ...handEdited }
  // handoverTest requires testByDriver: judged on this run's effective values
  // (an amend turning test-by-driver off while keeping a stored
  // handoverTest=true is caught here too).
  const effectiveTestByDriver = keys.explicit.testByDriver ?? base.testByDriver
  const effectiveHandoverTest = keys.explicit.handoverTest ?? base.handoverTest
  if (effectiveHandoverTest && !effectiveTestByDriver) {
    return refused(1, [
      `${keys.explicit.handoverTest !== undefined ? "config.handoverTest" : "the existing handoverTest"} requires config.testByDriver: true — test handover only makes sense when tests run via the driver. ` +
        `To fix: send both ({"config":{"testByDriver":true,"handoverTest":true}}), or handoverTest false; or edit ${CONFIG_FILE} directly`,
    ])
  }
  const liveRound = await currentRound(dir)
  let phaseState: PhaseState | undefined
  try {
    phaseState = await readPhases(dir, liveRound)
  } catch (error) {
    return refused(1, [textOf(error)])
  }
  const modeName = keys.mode ?? base.mode
  let modes: Record<string, unknown>
  try {
    modes = loadModes(dir)
  } catch (error) {
    return refused(1, [textOf(error)])
  }
  if (!modes[modeName]) {
    return refused(1, [`config.mode must be a registered mode (currently supported: ${Object.keys(modes).join(", ")}); defaults to migrate`])
  }
  const config = mergeProjectConfig(base, { ...keys.explicit, mode: modeName })
  // The key droppers: an amend would otherwise keep the old value.
  if (keys.agent === "opencode") delete config.agent
  if (keys.parallel === "none") delete config.parallel
  if (keys.scanExempt === "none") delete config.scanExempt
  // The read-only prefix guard, one per command (plans/0053 D31–D32):
  // plannedPhaseUnits is the sync's check half — a value that would drop a
  // completed phase or a directory holding work could never be re-synced, so
  // it is refused before any write, while a mid-round value that keeps the
  // completed phases is allowed and surfaces as a drift for plan to
  // reconcile. Skipped when the current round is complete (the value then
  // applies to the next round the plan operation establishes).
  const roundComplete = !!phaseState && phaseState.phases.every((unit) => phaseState.done.has(unit.id))
  if (!roundComplete) {
    try {
      await plannedPhaseUnits(dir, liveRound, config.phases)
    } catch (error) {
      return refused(1, [
        `${textOf(error)}. A mid-round phases change must keep the current round's completed phases and the phase directories that hold work; once the current round is complete, any value applies to the next round plan establishes`,
      ])
    }
  }
  // The prompt library and intent packs: init renders no prompts, but loading
  // surfaces override problems at init time already (the CLI's own order).
  try {
    usePromptLibrary(dir)
    loadIntents(dir)
  } catch (error) {
    return refused(1, [textOf(error)])
  }
  // Commit capability prerequisite (plain init only; amend touches an
  // already-working project): the unified commit is the completion
  // condition, so a repository whose git cannot commit is refused before any
  // write.
  if (!amend) {
    const problem = await commitIdentityProblem(dir)
    if (problem) {
      return refused(1, [
        `git cannot commit in ${dir}: ${problem}. The driver commits after every session, so init requires a repository that can commit; configure an identity first, e.g. git config --global user.name <name> and git config --global user.email <email> (drop --global to configure this repository only)`,
      ])
    }
  }
  const warnings = discarded.map((item) => `⚠ full overwrite drops the retired key ${item.key} = ${JSON.stringify(item.value)}: ${item.why}`)
  // The mistouch gates (plain init overwriting an existing config only — a
  // fresh directory has nothing to overwrite, and amend discards no key):
  // clean-tree first, then the confirmation, each with its own field.
  if (!amend && (await Bun.file(join(dir, CONFIG_FILE)).exists())) {
    const gate = await gates(
      project,
      body,
      "init full overwrite",
      `found an existing config ${CONFIG_FILE}; this init will fully overwrite it with these parameters (keys not given fall back to defaults; to change individual keys instead, use the amend operation ${route(project, "amend")}). continue? [y/N] `,
      () => ({ config: formatProjectConfig(config), warnings }),
    )
    if (gate) return gate
  }
  try {
    await saveProjectConfig(dir, config)
  } catch (error) {
    return refused(1, [`failed to write ${CONFIG_FILE}: ${textOf(error)}`])
  }
  const lines = [...warnings, `⚙ project config (${CONFIG_FILE}): ${formatProjectConfig(config)}`]
  // opencode.json may hold a person's edits and is init's alone (amend writes
  // only what renders from the config): skipped whenever it exists, like the
  // CLI. The agent contract renders through the core's own renderer
  // (renderAgentContract — the same function runAll's integrity check
  // compares against), so the write and the check cannot drift apart.
  if (!amend) {
    const target = join(dir, "opencode.json")
    if (await Bun.file(target).exists()) lines.push("already exists, skipped: opencode.json")
    else {
      await Bun.write(target, await Bun.file(templateConfig).text())
      lines.push("created: opencode.json")
    }
  }
  const contract = await renderAgentContract(config.testByDriver)
  const contractPath = join(dir, CONTRACT_FILE)
  const current = await Bun.file(contractPath).text().catch(() => undefined)
  if (current === contract) lines.push(`already exists, skipped: ${CONTRACT_FILE}`)
  else {
    await Bun.write(contractPath, contract)
    lines.push(current === undefined ? `created: ${CONTRACT_FILE}` : `replaced (differed from the template): ${CONTRACT_FILE}`)
  }
  // The project brief stub (plans/0052 D9): written only when missing; a
  // person's brief is never touched.
  if (!amend) {
    if (await Bun.file(join(dir, BRIEF_FILE)).exists()) lines.push(`already exists, skipped: ${BRIEF_FILE}`)
    else {
      await Bun.write(join(dir, BRIEF_FILE), renderProjectBrief())
      lines.push(`created: ${BRIEF_FILE} (project brief stub: fill in the goal, the migration source and target, and constraints; every planning session reads it)`)
    }
  }
  // The AGENTS.md block, idempotently synced from the current config.
  const ensured = await ensurePointer(dir, { testByDriver: config.testByDriver })
  lines.push(
    ensured.block === "inserted"
      ? "appended: AGENTS.md opencode-auto block"
      : ensured.block === "replaced"
        ? "refreshed: AGENTS.md opencode-auto block (differed from the current config render)"
        : "already exists, skipped: AGENTS.md opencode-auto block (up to date)",
  )
  if (ensured.legacyRemoved) lines.push(`cleaned: removed ${ensured.legacyRemoved} legacy/stray opencode-auto marker block(s) from AGENTS.md`)
  // Plain init writes the full ignore set in one pass; amend never touches it.
  if (!amend) {
    const appended = await ensureInitGitignore(dir)
    if (appended.length) lines.push(`updated: .gitignore now ignores ${appended.join(", ")} (driver workdir, local-only files and nested git repositories)`)
  }
  if (amend) {
    const given = [
      ...Object.keys(keys.explicit),
      ...(keys.mode !== undefined ? ["mode"] : []),
      ...(keys.agent !== undefined ? ["agent"] : []),
      ...(keys.parallel !== undefined ? ["parallel"] : []),
      ...(keys.scanExempt !== "none" ? ["scanExempt"] : []),
    ]
    lines.push(`✓ amended (${given.join(", ")}); the other keys are unchanged. Review the change and commit it`)
    return ok(lines, { config: formatProjectConfig(config) })
  }
  // init's closing line (plans/0053 D31): plan owns the rounds; the
  // parenthetical is dropped over an established round (the CLI's own
  // AUTO-RESOLVE — it would state a falsehood there).
  lines.push(
    phaseState
      ? `next: the plan operation continues the established round (${route(project, "plan")})`
      : `next: the plan operation establishes round ${roundDirName(liveRound)} and stops at the round-start gate (${route(project, "plan")})`,
  )
  return ok(lines, { config: formatProjectConfig(config) })
}

// fix (plans/0052 D10/D11): the rule table of auto-core/config-fix.ts. The
// dryrun keeps the read-only half — plan and findings, write nothing, the
// CLI's exit 1 when findings exist — a scriptable config-drift gate that
// runs beside a live run (no lock, no registry refusal).
async function runFix(request: OpRequest): Promise<OpOutcome> {
  const { project, body } = request
  const dir = project.directory
  for (const key of Object.keys(body ?? {})) {
    if (key === "dryrun" || key === "confirm" || key === "cleanTree") continue
    return bad(`unknown fix field "${key}" (the fix request takes "dryrun", "confirm" and "cleanTree")`)
  }
  if ("dryrun" in (body ?? {}) && typeof body!.dryrun !== "boolean") return bad("dryrun takes true|false (the read-only half: plan and findings, write nothing)")
  const dryrun = body?.dryrun === true
  const legacy = await legacyLayoutProblem(dir)
  if (legacy) return refused(1, [legacy])
  if (!dryrun) {
    const holder = liveRunLock(dir)
    if (holder !== undefined) return locked(dir, holder)
  }
  const plan = await planFix(dir)
  if (plan.uninitialized) {
    return refused(1, [`nothing to fix: ${dir} has no ${CONFIG_FILE}; run the init operation first (${route(project, "init")})`])
  }
  if (!plan.findings.length) {
    return ok([`✓ nothing to fix: the config layer of ${dir} is consistent with its config`])
  }
  const fixable = plan.findings.filter((finding) => finding.class === "fixable")
  const manual = plan.findings.filter((finding) => finding.class === "manual")
  const head = [`config-layer findings in ${dir}:`, formatFixPlan(plan)]
  const extras = () => ({ findings: plan.findings, ...(plan.skipped ? { skipped: plan.skipped } : {}) })
  if (dryrun) {
    const lines = [...head]
    if (manual.length) lines.push(`${manual.length} finding(s) need a person (listed as manual above): edit the file by hand, then re-run the fix operation (${route(project, "fix")})`)
    lines.push(
      fixable.length
        ? `dryrun: nothing was changed; apply the ${fixable.length} fixable finding(s) with the fix operation and "confirm": true (${route(project, "fix")})`
        : "dryrun: nothing was changed; the finding(s) above need a person",
    )
    // The CLI's dryrun exit 1: the drift gate's stable semantics — findings
    // answer 409 with code 1, a clean layer 200.
    return refused(1, lines, extras())
  }
  const lines = [...head]
  if (fixable.length) {
    // -f skipped both gates; here each field answers its own (fix gates only
    // when there is something to apply, like the CLI).
    const gate = await gates(project, body, "fix", `apply the ${fixable.length} fix(es) above? [y/N] `, extras)
    if (gate) return gate
    try {
      await applyFix(plan)
    } catch (error) {
      return refused(1, [`fix failed: ${textOf(error)}`])
    }
    for (const finding of fixable) lines.push(`fixed: ${finding.path}: ${finding.change}`)
  }
  if (manual.length) {
    lines.push(`${manual.length} finding(s) need a person (listed as manual above): edit the file by hand, then re-run the fix operation (${route(project, "fix")})`)
    return refused(1, lines, { ...extras(), applied: fixable.map((finding) => `${finding.path}: ${finding.change}`) })
  }
  lines.push("✓ config layer repaired; review the change and commit it")
  return ok(lines, extras())
}

// reset (de-initialization): planReset keeps a filled brief and removes a
// stub one; the cleanliness gate applies unconditionally (reset is always
// destructive, unlike init which checks only when overwriting), and so does
// the confirmation.
async function runReset(request: OpRequest): Promise<OpOutcome> {
  const { project, body } = request
  const dir = project.directory
  for (const key of Object.keys(body ?? {})) {
    if (key === "confirm" || key === "cleanTree") continue
    return bad(`unknown reset field "${key}" (the reset request takes "confirm" and "cleanTree")`)
  }
  const holder = liveRunLock(dir)
  if (holder !== undefined) return locked(dir, holder)
  const entries = await planReset(dir)
  const actionable = entries.filter((entry) => entry.action !== "keep")
  if (!actionable.length) {
    return ok([`no init artifacts found; reset not needed: ${dir}`])
  }
  const head = [`the following cleanup will run in ${dir}:`, formatResetPlan(entries)]
  const gate = await gates(project, body, "reset deinit", `the ${actionable.length} item(s) above will be deleted/restored; continue? [y/N] `, () => ({ plan: entries }))
  if (gate) return gate
  try {
    await applyReset(dir, entries)
  } catch (error) {
    return refused(1, [`reset failed: ${textOf(error)}`])
  }
  return ok([...head, "✓ restored to the uninitialized state (docs/, .auto/ runtime state and tmp/ untouched)"])
}

// close (plans/0053 D22): the explicit ref and the required one-line reason
// ARE the confirmation — neither the CLI nor this op asks for another, which
// is why close takes no "confirm" field at all (everything is reversible:
// the undo is git revert of the close commit, printed in the lines).
// closeUnit owns every behavioural refusal; the checks here are the
// request-shape errors that fire before anything is read.
async function runClose(request: OpRequest): Promise<OpOutcome> {
  const { project, body } = request
  const dir = project.directory
  for (const key of Object.keys(body ?? {})) {
    if (key === "ref" || key === "reason" || key === "cascade" || key === "changes") continue
    return bad(`unknown close field "${key}" (the close request takes "ref", "reason", "cascade" and "changes")`)
  }
  const given = body ?? {}
  const ref = given.ref
  if (typeof ref !== "string" || !CLOSE_REF.test(ref)) {
    return bad(
      ref === undefined
        ? 'the close request requires "ref": a round R-NN, a phase R-NN.P<nn> or a task T-NNN'
        : `${ref}: not a unit reference; expected a round R-NN, a phase R-NN.P<nn> or a task T-NNN`,
    )
  }
  const reason = given.reason
  if (reason === undefined) return bad('the close request requires "reason": the one-line reason recorded in the Closed: field, the close commit and the phase handover')
  if (typeof reason !== "string" || !reason.trim()) return bad('"reason" requires non-empty text (the close reason; the explicit ref and the reason are the confirmation — close asks for no other)')
  if (reason.includes("\n")) return bad('"reason" must be one line (it is the Closed: value and the close commit subject\'s tail); longer context belongs in the round brief or the plan')
  if ("cascade" in given && typeof given.cascade !== "boolean") return bad("cascade takes true|false (close explicit dependents too)")
  let changes: CloseChanges | undefined
  if ("changes" in given) {
    if (given.changes !== "commit" && given.changes !== "stash") {
      return bad('changes takes "commit"|"stash" — the two ways to handle uncommitted changes (folded into the close commit, or stashed); without it, anything beyond the driver\'s own state files refuses the close')
    }
    changes = given.changes
  }
  const legacy = await legacyLayoutProblem(dir)
  if (legacy) return refused(1, [legacy])
  const unconfigured = await requireConfig(project, "close")
  if (unconfigured) return unconfigured
  const loaded = await strictConfig(project)
  if (!("config" in loaded)) return loaded
  // close holds the run lock itself around its writes (D3), the CLI's
  // "close" command name; a live holder answers before any write.
  const lock = acquireRunLock(dir, "close")
  if (!lock.ok) return locked(dir, lock.holder)
  let result
  try {
    result = await closeUnit(dir, ref, {
      reason,
      cascade: given.cascade === true,
      changes,
      phases: loaded.config.phases,
      acceptanceGate: loaded.config.acceptanceGate,
    })
  } finally {
    lock.release()
  }
  if (result.type === "closed") return ok(result.lines)
  return refused(result.type === "refused" ? 1 : 2, result.lines)
}

// The plan prelude's stop outcome as an op outcome: the no-agent routes are
// served with their own lines and codes (the CLI's exit vocabulary — 0 the
// round was established / re-synced / the notice, 1 a refusal, 2 the
// round-close gate or a dirty task-add).
function preludeOutcome(lines: string[], code: number): OpOutcome {
  return code === 0 ? ok(lines) : refused(code === 2 ? 2 : 1, lines)
}

// task-add — the units op over addTask (auto-core src/task-add.ts:46), served
// as its own operation rather than a plan field: adding one task the caller
// names, with no session, is the one plan route that never needs an agent.
// AUTO-DECISION (over planPrelude's row 11, which calls addTask itself): the
// op routes through planPrelude with newTask so the whole guard chain — the
// established round, the drift gate, the open step, the mid-pipeline task,
// the task-less phase — is the core's own, never re-implemented here
// (re-writing the core's gates is the constitution-erosion risk the
// assessment names); the CLI's `plan --new-task` is exactly this route.
async function runTaskAdd(request: OpRequest): Promise<OpOutcome> {
  const { project, body } = request
  const dir = project.directory
  for (const key of Object.keys(body ?? {})) {
    if (key === "title") continue
    return bad(`unknown task-add field "${key}" (the task-add request takes "title" — the one-line task title, the CLI's plan --new-task)`)
  }
  const title = body?.title
  if (typeof title !== "string" || !title.trim()) return bad('"title" requires a one-line task title (it becomes the index line and the task document\'s title)')
  if (title.includes("\n")) {
    return bad('"title" must be one line (it becomes the task\'s index line); longer context belongs in the task document — add the task, then edit its docs/T-NNN/todo.md')
  }
  const legacy = await legacyLayoutProblem(dir)
  if (legacy) return refused(1, [legacy])
  const unconfigured = await requireConfig(project, "add a task to")
  if (unconfigured) return unconfigured
  const loaded = await strictConfig(project)
  if (!("config" in loaded)) return loaded
  const lock = acquireRunLock(dir, "plan")
  if (!lock.ok) return locked(dir, lock.holder)
  let prelude
  try {
    prelude = await planPrelude(dir, {
      phases: loaded.config.phases,
      build: loaded.config.build,
      scanExempt: loaded.config.scanExempt,
      newTask: title,
      autoNumber: loaded.config.autoNumber,
    })
  } finally {
    lock.release()
  }
  if (prelude.type === "stop") return preludeOutcome(prelude.lines, prelude.code)
  return notImplemented(P3_REFUSAL)
}

// The P1 plan boundary: the API's plan surface serves only planPrelude's
// no-agent outcomes — round establishment (the round-start gate), the
// round-close gate, the phase-index drift re-sync, and the refusal stops.
// Every route that would continue into runAll under stopBefore === "execute"
// (planning a phase, finishing an interrupted planning step) waits for the
// P3c unit; `plan --force-close`'s close half is the close operation, and
// its continue-into-planning half waits with the rest.
async function runPlan(request: OpRequest): Promise<OpOutcome> {
  const { project, body } = request
  const dir = project.directory
  for (const key of Object.keys(body ?? {})) {
    if (key === "input" || key === "prompt" || key === "file" || key === "append") {
      return notImplemented(`"${key}" rides an agent planning session (the planning input is what such a session plans from): ${P3_REFUSAL}`)
    }
    if (key === "newTask") {
      return bad(`"newTask" is the task-add operation, served as its own unit op: POST ${route(project, "tasks")} with {"title": …} (the CLI's plan --new-task route)`)
    }
    return bad(`unknown plan field "${key}" (the P1 plan operation takes no fields: it serves the no-agent routes only — round establishment, the round-close gate, the phase-index re-sync and the refusal stops; the task-add operation is ${route(project, "tasks")})`)
  }
  const legacy = await legacyLayoutProblem(dir)
  if (legacy) return refused(1, [legacy])
  const unconfigured = await requireConfig(project, "plan")
  if (unconfigured) return unconfigured
  const loaded = await strictConfig(project)
  if (!("config" in loaded)) return loaded
  const lock = acquireRunLock(dir, "plan")
  if (!lock.ok) return locked(dir, lock.holder)
  let prelude
  try {
    prelude = await planPrelude(dir, {
      phases: loaded.config.phases,
      build: loaded.config.build,
      scanExempt: loaded.config.scanExempt,
      autoNumber: loaded.config.autoNumber,
    })
  } finally {
    lock.release()
  }
  if (prelude.type === "stop") return preludeOutcome(prelude.lines, prelude.code)
  // { type: "loop" } is the agent-planning route: planning this phase (or
  // finishing an interrupted planning step) starts the session whose
  // humanQuestions would wait indefinitely — refused until P3c lifts it.
  return notImplemented(
    `the current route of ${dir} would start an agent planning session (planning its current phase, or finishing an interrupted planning step): ${P3_REFUSAL}`,
  )
}

// models (shell-contract §9): the registry's effective table, read-only —
// describeModels writes nothing and takes no lock, so it runs beside a live
// run. probeModels is NOT exposed in P1: its opt-in scope stays disabled (no
// route requires it), and its confirmation parameter and per-daemon rate
// limit land with the Web write surface.
async function runModels(request: OpRequest): Promise<OpOutcome> {
  const { project, query } = request
  for (const key of [...new Set([...query.keys()])]) {
    if (key === "probe") continue
    return bad(`unknown query parameter "${key}" (the models operation takes only ?probe — which is not exposed in P1)`)
  }
  if (query.has("probe")) {
    return notImplemented(
      "the model probe is not exposed in P1: it starts agents through the pool and burns tokens — its opt-in scope, its confirmation parameter and its per-daemon rate limit arrive with the Web write surface",
    )
  }
  const description = await describeModels(project.directory, Date.now(), { env: runEnv() })
  const code = description.problems.length ? 1 : 0
  return {
    status: code === 0 ? 200 : 409,
    body: {
      code,
      lines: formatModels(description),
      operatorPath: description.operatorPath,
      problems: description.problems,
      notes: description.notes,
      ...(description.table === undefined ? {} : { table: description.table }),
    },
  }
}

// The P1d operation table: what the daemon serves under
// /projects/<project>/<segment>. Scopes are the assessment's §8 Q6 tiers —
// config for the config ops, control for the unit/lifecycle ops that write
// git through the core, read for the models table.
export const OP_DEFINITIONS: readonly OpDefinition[] = [
  { method: "POST", segment: "init", what: "the init operation", scope: "config", write: () => true, run: (request) => runConfigOp("init", request) },
  { method: "POST", segment: "amend", what: "the amend operation", scope: "config", write: () => true, run: (request) => runConfigOp("amend", request) },
  { method: "POST", segment: "fix", what: "the fix operation", scope: "config", write: (body) => body?.dryrun !== true, run: runFix },
  { method: "POST", segment: "reset", what: "the reset operation", scope: "config", write: () => true, run: runReset },
  { method: "POST", segment: "close", what: "the close operation", scope: "control", write: () => true, run: runClose },
  { method: "POST", segment: "tasks", what: "the task-add operation", scope: "control", write: () => true, run: runTaskAdd },
  { method: "POST", segment: "plan", what: "the plan operation", scope: "control", write: () => true, run: runPlan },
  { method: "GET", segment: "models", what: "the models operation", scope: "read", write: () => false, run: runModels },
]
