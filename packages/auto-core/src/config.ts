// The project config layer (design doc plans/0004-init-config-agents-design.md
// §A): constitutional options — project properties deciding how sessions are
// told things and how commit semantics operate — are fixed by init into
// .opencode/auto/config.json, versioned, shared with the repository and
// human-editable; unknown keys are ignored (forward compatibility). run only
// controls this one execution and no longer accepts the corresponding options.
// The legacy .auto/config.json (mode only) is read as a fallback only while
// the new file is missing; once the new file is written it is never read
// again; run does not clean it up (it naturally sinks inside gitignore), but
// it belongs to the config layer, and reset removes it along with the rest.
import { chmod } from "node:fs/promises"
import { join } from "node:path"
import { loadModes } from "./mode"
import { loadPhaseTypes } from "./phases/custom"
import { phasesProblem, resolvePhases } from "./phases/registry"
import { SUBTASK_MODES, type SubtaskMode } from "./opts"
import { phaseTypeRoleProblems, type AgentChoice } from "./switches"
import { PARALLEL_LEVELS, type ParallelLevel } from "./intent/types"

export { PARALLEL_LEVELS, type ParallelLevel }

export type ProjectConfig = {
  // Must be a name registered in loadModes(dir).
  mode: string
  // The coding agent the project runs on (M6.1): opencode (absent, the
  // default — no key is written) or claude. Until M6.1 this key named the agent
  // contract; that name is fixed to `auto` now (opts.ts CONTRACT_AGENT), and a
  // stored contract name fails loading with a hint.
  agent?: AgentChoice
  // Thousands of tokens (same unit as the CLI; the run side injects it into
  // Opts ×1000).
  contextLimit: number
  subtask: SubtaskMode
  // Minutes, 1..120. The general watchdog of the driver-executed scripts (the
  // test scripts of --test-by-driver).
  idleTime: number
  // Minutes, 0 = unset, 1..1440.
  idleMax: number
  // --test-by-driver: the right to execute test/compile/build commands moves
  // to the driver. When on, execution sessions do not run such commands
  // directly; instead the command is written as a script into the test/
  // directory and the script path into tmp/test.sh to tell the driver to
  // execute it; the driver merges stdout/stderr into a single file and feeds
  // the exit code and output file back into the session.
  testByDriver: boolean
  // --handover-test (needs testByDriver): when a test fails and the session
  // context reaches its limit, the AI is required to write a handover document
  // and a new session continues from it, preventing repeated trial and error
  // inside a huge context.
  handoverTest: boolean
  // --auto-number: auto numbering — task numbers (T-NNN) never repeat in the
  // target directory; the next available number is persisted in
  // .auto/next-task and planning sessions continue numbering from that record;
  // when the record is missing, an AI recovery session first derives and
  // restores it before continuing. Default true (stable-refs D5 flip);
  // --no-auto-number stays as the off switch (once off, numbering re-runs from
  // T-001, matching the historical behavior).
  autoNumber: boolean
  // --no-wrapup: turns off the task wrap-up sessions (renderWrapup: the
  // wrap-up sessions after subtask/whole-task execution completes and after a
  // rework round). Default true (zero change to today's behavior).
  wrapup: boolean
  // A letter preset (a subsequence of admtvk containing m, design doc
  // plans/0006-phases-design.md §A) or a comma-separated list of phase type
  // ids (custom types from .opencode/auto/phases/ included, must contain
  // implement, M3.6); "m" = no phases declared, a single run. config.json may
  // also hold a JSON array; it is normalized to the comma string on load.
  phases: string
  // Phase types whose phases wait for a human's `Accepted: yes` in their
  // acceptance.md before they are marked done (M4.2, plans/0049 G7/G9; a
  // custom type can carry the gate itself with `Gate: acceptance`). Optional,
  // hand-edited; absent = no builtin type is gated.
  acceptanceGate?: string[]
  // The target's own build command, run in the target directory by the
  // round-close gate (M4.2, plans/0049 G8/G9). Optional, hand-edited; absent =
  // the build check is skipped.
  build?: string
  // How hard planning sessions work to make tasks independent (MP.1, plans/0046
  // D8/D10): the level picks the `## parallelism` intent subsection injected
  // into the planning templates. Absent = none (nothing injected, today's
  // prompts byte for byte). Planning guidance only: tasks still run one at a time.
  parallel?: ParallelLevel
  // Path globs, relative to the target directory, of deliverable files the
  // driver's two content scans skip (plans/0059 X2): the P1 prohibition scan
  // (process-document paths in added lines, at unit close-out and at round
  // close) and the whole-unit document terminator scan. For a deliverable
  // that legitimately holds process-shaped strings or terminator-free
  // Markdown, such as a tool's own test fixtures and prompt templates. A glob
  // naming a directory covers the files under it. Absent (or []) = none; set
  // with init/amend --scan-exempt, shared with the repository like every key.
  scanExempt?: string[]
}

export const CONFIG_DEFAULTS: ProjectConfig = {
  mode: "migrate",
  contextLimit: 64,
  subtask: "auto",
  idleTime: 10,
  idleMax: 0,
  testByDriver: false,
  handoverTest: false,
  autoNumber: true,
  wrapup: true,
  phases: "m",
}

export const CONFIG_FILE = join(".opencode", "auto", "config.json")
export const LEGACY_FILE = join(".auto", "config.json")

// Load + validate: file missing → defaults + the legacy fallback (the mode of
// .auto/config.json); bad JSON / a key out of range / an unregistered mode
// (loadModes) → throw (the error names the key and what it expects), which the
// CLI side turns into exit code 1. Both run and init go through this entry.
export async function loadProjectConfig(dir: string): Promise<ProjectConfig> {
  return validateProjectConfig(await readConfigRecord(dir), dir)
}

// A retired key found in config.json, with the value it held and why it is gone.
export type RetiredKey = { key: string; value: unknown; why: string }

// The baseline of a full-overwrite init (plans/0052 D4). The overwrite drops
// retired keys anyway, so they are returned for the caller to report instead
// of failing the load — a stored `commit: false` or `source` would otherwise
// block the very re-init that clears it. Every other key is validated as
// strictly as loadProjectConfig does; an amend still loads strictly, since it
// would carry the retired keys over.
export async function loadOverwriteBaseline(dir: string): Promise<{ config: ProjectConfig; retired: RetiredKey[] }> {
  const raw = await readConfigRecord(dir)
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { config: validateProjectConfig(raw, dir), retired: [] }
  const record = { ...(raw as Record<string, unknown>) }
  const retired: RetiredKey[] = []
  for (const [key, rule] of Object.entries(RETIRED_KEYS)) {
    if (!rule.retired(record[key])) continue
    retired.push({ key, value: record[key], why: rule.why })
    delete record[key]
  }
  return { config: validateProjectConfig(record, dir), retired }
}

// The parsed config.json, or the defaults (plus the legacy mode) when it is missing.
async function readConfigRecord(dir: string): Promise<unknown> {
  const text = await Bun.file(join(dir, CONFIG_FILE)).text().catch(() => undefined)
  if (text === undefined) {
    const legacy = await readLegacyMode(dir)
    return legacy === undefined ? { ...CONFIG_DEFAULTS } : { ...CONFIG_DEFAULTS, mode: legacy }
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${CONFIG_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Retired keys (tombstones). A stored retired value fails loading strictly
// with its own fix: ignoring it like an unknown key would hide that its meaning
// is gone. The names stay reserved forever — no future key may reuse one, or a
// stale config would be quietly reinterpreted (plans/0052 D3; the process-doc
// root of plans/0036 F18 therefore needs a name other than destDir).
const RETIRED_KEYS: Record<string, { retired: (value: unknown) => boolean; why: string; message: (value: unknown) => string }> = {
  // 2026-09-15, plans/0021-commit-boundary-design.md D7: the unit-commit clean
  // gate, SHA baseline and recovery rollback anchor all assume commits are on.
  // 2026-09-29 (plans/0061 R13): the key went with the code-side switch the
  // git seam replaced — every stored value but true now fails (a stored true
  // loads and is ignored like an unknown key; before the deletion "none"/1
  // died in booleanOf's type check instead, likewise strictly — one strict
  // failure traded for another, so no stored value changed meaning).
  commit: {
    retired: (value) => value !== undefined && value !== true,
    why: "unified commit is a completion condition",
    message: () =>
      "commit: false is retired (unified commit is a completion condition, see plans/0021-commit-boundary-design.md): remove the key or set it to true",
  },
  // D13, 2026-09-21, plans/0044 D2: the acceptance a stored `true` asks for no
  // longer runs. `false`, which init used to write, is ignored like any unknown key.
  verify: {
    retired: (value) => value === true,
    why: "task-level acceptance was removed",
    message: () => "verify is retired (task-level acceptance was removed; plan acceptance work as tasks or use the v phase): remove the key",
  },
  // M6.1: before it named the coding agent, the key named the agent contract.
  agent: {
    retired: (value) => typeof value === "string" && value !== "opencode" && value !== "claude",
    why: "the key once named the agent contract, which is always .opencode/agent/auto.md",
    message: (value) =>
      `agent must be opencode|claude ("${value}" looks like an agent contract name: that setting is retired — the contract is always .opencode/agent/auto.md; delete the key, or set "claude")`,
  },
  // plans/0052 D3: the migration parameters were only ever forwarded into the
  // phase-planning prompt, so they are intent and belong in brief.md.
  source: migrationParameter("source"),
  destDir: migrationParameter("destDir"),
}

// Whether a stored key holds a retired value (the rules above); `fix` drops or
// moves exactly these (config-fix.ts).
export function retiredValue(key: string, value: unknown): boolean {
  return RETIRED_KEYS[key]?.retired(value) ?? false
}

function migrationParameter(key: string) {
  return {
    retired: (value: unknown) => value !== undefined,
    why: "the migration source and target are intent — state them in .opencode/auto/brief.md",
    message: (value: unknown) =>
      `${key} is retired (the migration source and target are intent, not configuration): ` +
      `copy its value ${JSON.stringify(value)} into .opencode/auto/brief.md, then remove the key`,
  }
}

// For init: only explicitly given keys override the existing values, the rest
// are kept (a key of undefined counts as not given); returns the complete
// config to write back.
export function mergeProjectConfig(existing: ProjectConfig, explicit: Partial<ProjectConfig>): ProjectConfig {
  const given = Object.fromEntries(Object.entries(explicit).filter(([, value]) => value !== undefined))
  return { ...existing, ...given }
}

// The plain full write (Bun.write creates parent directories); called only by
// init (outside the protect period), no atomic write needed. Best-effort
// clears the read-only bit before writing: protect.ts chmods this file 0444
// during run, the bit survives a killed run, and allowWrite relies on
// module-level state and cannot help in a new process — without clearing it,
// every init from then on fails with EACCES.
export async function saveProjectConfig(dir: string, config: ProjectConfig): Promise<void> {
  await saveConfigRecord(dir, config)
}

// Writes a raw config record as it is (`fix` rewrites the file from its own
// record, so unknown keys and keys no rule names survive).
export async function saveConfigRecord(dir: string, record: object): Promise<void> {
  const file = join(dir, CONFIG_FILE)
  await chmod(file, 0o644).catch(() => {})
  await Bun.write(file, JSON.stringify(record, null, 2) + "\n")
}

// For run's startup notice: the new file is missing while the legacy
// .auto/config.json still holds a persisted mode (the live mode comes from
// the old location; re-running init fixes the full config); returns the old
// value, undefined when there is none.
export async function legacyModeFallback(dir: string): Promise<string | undefined> {
  if (await Bun.file(join(dir, CONFIG_FILE)).exists()) return undefined
  return readLegacyMode(dir)
}

async function readLegacyMode(dir: string): Promise<string | undefined> {
  const config = (await Bun.file(join(dir, LEGACY_FILE)).json().catch(() => undefined)) as { mode?: unknown } | undefined
  return typeof config?.mode === "string" ? config.mode : undefined
}

// The one-line config summary shared by run's startup banner and status.
export function formatProjectConfig(config: ProjectConfig): string {
  const watchdog = `idle ${config.idleTime}m/max ${config.idleMax > 0 ? `${config.idleMax}m` : "unset"}`
  return (
    `mode ${config.mode} · agent ${config.agent ?? "opencode"} · subtask ${config.subtask}` +
    ` · watchdog ${watchdog}` +
    (config.testByDriver ? ` · test-by-driver on${config.handoverTest ? "(handover)" : ""}` : "") +
    (config.autoNumber ? " · auto-number on" : "") +
    (config.wrapup ? "" : " · wrapup off") +
    ` · context-limit ${config.contextLimit}k · phases ${config.phases}` +
    (config.acceptanceGate?.length ? ` · acceptance gate ${config.acceptanceGate.join(",")}` : "") +
    (config.build ? " · build set" : "") +
    (config.parallel ? ` · parallel ${config.parallel}` : "") +
    (config.scanExempt?.length ? ` · scan-exempt ${config.scanExempt.join(",")}` : "")
  )
}

// Value ranges match the CLI-side parse*; unknown keys are ignored (forward
// compatibility), missing keys fall back to the defaults.
export function validateProjectConfig(raw: unknown, dir: string): ProjectConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`${CONFIG_FILE} must be a JSON object`)
  const record = raw as Record<string, unknown>
  for (const [key, rule] of Object.entries(RETIRED_KEYS)) {
    if (rule.retired(record[key])) throw new Error(`${CONFIG_FILE} ${rule.message(record[key])}`)
  }
  const pick = (key: keyof ProjectConfig) => (record[key] === undefined ? CONFIG_DEFAULTS[key] : record[key])
  const mode = stringOf("mode", pick("mode"))
  const modes = loadModes(dir)
  if (!modes[mode]) {
    throw new Error(`${CONFIG_FILE} mode value "${mode}" is not registered (currently supported: ${Object.keys(modes).join(", ")})`)
  }
  const contextLimit = pick("contextLimit")
  if (typeof contextLimit !== "number" || !Number.isInteger(contextLimit) || contextLimit < 1) {
    throw new Error(`${CONFIG_FILE} contextLimit must be a positive integer (thousands of tokens)`)
  }
  const rawPhases = pick("phases")
  const phases = Array.isArray(rawPhases) && rawPhases.every((item) => typeof item === "string") ? rawPhases.join(",") : rawPhases
  if (typeof phases !== "string") {
    throw new Error(`${CONFIG_FILE} phases must be a letter preset (e.g. m, amt, admtvk) or a list of phase type ids (e.g. "analysis,security-review,implement")`)
  }
  const types = loadPhaseTypes(dir)
  const clashes = phaseTypeRoleProblems(types.filter((entry) => entry.origin === "project").map((entry) => entry.type))
  if (clashes.length) throw new Error(clashes.join("\n"))
  if (resolvePhases(phases, types) === null) throw new Error(`${CONFIG_FILE} phases is invalid: ${phasesProblem(phases, types)}`)
  // commit is refused above (RETIRED_KEYS) for every stored value but true,
  // which loads and is ignored like an unknown key — the key itself went with
  // the code-side switch the git service seam replaced (plans/0061 R13).
  const testByDriver = booleanOf("testByDriver", pick("testByDriver"))
  const handoverTest = booleanOf("handoverTest", pick("handoverTest"))
  if (handoverTest && !testByDriver) {
    throw new Error(`${CONFIG_FILE} handoverTest requires testByDriver: true`)
  }
  return {
    mode,
    agent: agentOf(record.agent),
    contextLimit,
    subtask: subtaskOf(pick("subtask")),
    testByDriver,
    handoverTest,
    autoNumber: booleanOf("autoNumber", pick("autoNumber")),
    wrapup: booleanOf("wrapup", pick("wrapup")),
    // The watchdog keys were renamed from verifyIdle/verifyMax (the old names
    // carried over from the already-retired verify scripts; they now govern
    // test script execution); the old keys are read as a fallback only while
    // the new ones are missing, never migrated back in writing — the next
    // init naturally fixes the new keys.
    idleTime: intInRange("idleTime", record.idleTime ?? record.verifyIdle ?? CONFIG_DEFAULTS.idleTime, 1, 120, "minutes"),
    idleMax: intInRange("idleMax", record.idleMax ?? record.verifyMax ?? CONFIG_DEFAULTS.idleMax, 0, 1440, "minutes, 0 = unset"),
    phases,
    acceptanceGate: acceptanceGateOf(record.acceptanceGate, types.map((entry) => entry.type)),
    build: record.build === undefined ? undefined : stringOf("build", record.build),
    parallel: parallelOf(record.parallel),
    scanExempt: scanExemptOf(record.scanExempt),
  }
}

// agent: opencode|claude; absent and "opencode" both mean opencode (undefined),
// so the default is never written. Any other string is a pre-M6.1 contract name.
export function agentOf(value: unknown): AgentChoice | undefined {
  if (value === undefined || value === "opencode") return undefined
  if (value === "claude") return value
  const rule = RETIRED_KEYS.agent!
  throw new Error(`${CONFIG_FILE} ${rule.retired(value) ? rule.message(value) : "agent must be opencode|claude"}`)
}

// parallel: none|low|medium|high; absent and "none" both mean none (undefined),
// so a config without the key and one saying "none" load the same.
export function parallelOf(value: unknown): ParallelLevel | undefined {
  if (value === undefined || value === "none") return undefined
  if (typeof value !== "string" || !(PARALLEL_LEVELS as readonly string[]).includes(value)) {
    throw new Error(`${CONFIG_FILE} parallel must be none|${PARALLEL_LEVELS.join("|")}`)
  }
  return value as ParallelLevel
}

// scanExempt (plans/0059 X2): an array of usable globs; absent or [] = none.
function scanExemptOf(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${CONFIG_FILE} scanExempt must be an array of path globs (relative to the target directory)`)
  }
  const problems = value.flatMap((glob) => scanExemptProblem(glob) ?? [])
  if (problems.length) throw new Error(`${CONFIG_FILE} scanExempt: ${problems.join("; ")}`)
  return value.length ? value : undefined
}

// Why one scan-exemption glob is unusable, undefined when it is fine: the
// scans see repository-relative paths, so an absolute glob or one climbing
// out with `..` could never match, and an empty one says nothing. Shared by
// the config load and the shells' --scan-exempt parse.
export function scanExemptProblem(glob: string): string | undefined {
  if (!glob.trim()) return "an empty glob"
  if (glob.trim() !== glob) return `"${glob}" has surrounding whitespace`
  if (glob.startsWith("/") || /^[A-Za-z]:[\\/]/.test(glob)) return `"${glob}" is absolute (globs match paths relative to the target directory)`
  if (glob.replaceAll("\\", "/").split("/").includes("..")) return `"${glob}" climbs out of the target directory (..)`
  return undefined
}

// A comma-separated glob list as a flag gives it: commas inside a brace group
// (`{a,b}`) belong to the glob, every entry is trimmed, and empty entries are
// dropped.
export function splitGlobList(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let current = ""
  for (const char of text) {
    if (char === "{") depth++
    else if (char === "}" && depth > 0) depth--
    if (char === "," && depth === 0) {
      out.push(current)
      current = ""
      continue
    }
    current += char
  }
  out.push(current)
  return out.map((glob) => glob.trim()).filter(Boolean)
}

// acceptanceGate: an array of distinct known phase type ids; absent or [] = none.
function acceptanceGateOf(value: unknown, known: readonly string[]): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${CONFIG_FILE} acceptanceGate must be an array of phase type ids`)
  }
  const unknown = value.filter((item) => !known.includes(item))
  if (unknown.length) throw new Error(`${CONFIG_FILE} acceptanceGate names unknown phase type(s) ${unknown.join(", ")} (known: ${known.join(", ")})`)
  if (new Set(value).size !== value.length) throw new Error(`${CONFIG_FILE} acceptanceGate lists a phase type twice`)
  return value.length ? value : undefined
}

function stringOf(key: string, value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error(`${CONFIG_FILE} ${key} must be a non-empty string`)
  return value
}

function booleanOf(key: string, value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error(`${CONFIG_FILE} ${key} must be true|false`)
  return value
}

function intInRange(key: string, value: unknown, min: number, max: number, unit: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${CONFIG_FILE} ${key} must be an integer in ${min}..${max} (${unit})`)
  }
  return value
}

// subtask: off|auto|true|ondemand. The JSON boolean true is the same value as
// "true" (plans/0059 D1: the pipeline's name reads as a boolean, so a
// hand-edited config may well write it as one); the config is read back as the
// string, so the next amend writes "true".
// AUTO-RESOLVE: is the JSON boolean false accepted as "off"? -> no, it stays invalid (0059 D1 names only true as an alias; false never was a valid value, and reading it as off would widen the ruled contract).
function subtaskOf(value: unknown): SubtaskMode {
  if (value === true) return "true"
  if (typeof value !== "string" || !(SUBTASK_MODES as readonly string[]).includes(value)) {
    throw new Error(`${CONFIG_FILE} subtask must be ${SUBTASK_MODES.join("|")}`)
  }
  return value as SubtaskMode
}
