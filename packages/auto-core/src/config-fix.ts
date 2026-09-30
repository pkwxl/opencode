// Config fix (plans/0052 D10/D11): the rule table behind the shell's
// `fix` command. Every key retirement used to be only an error text telling a
// person what to edit; each rule here turns one into an executable step.
// Rules for the rules:
//   - Config layer only: .opencode/auto/config.json and the artifacts init
//     writes from it. Phase-index inconsistencies belong to `plan` (0052 D22).
//   - Two classes. fixable = deterministic and meaning-preserving; manual =
//     report only, never guess (handoverTest without testByDriver: which side
//     to change is a human decision).
//   - Only keys that fail to load or silently lose their meaning are broken.
//     Valid alternative spellings (a phases array, parallel "none", agent
//     "opencode") are left alone.
//   - config.json is rewritten from its own raw record, so unknown keys and
//     every key no rule names survive: fix never resets other keys.
//   - The artifact rules render from the config, so they run only when the
//     config loads strictly once the key rules are applied; otherwise they are
//     reported as skipped.
//   - Files a person may have edited (opencode.json, brief.md) are only
//     written when missing, as init does. The one exception is moving the
//     retired source/destDir into brief.md, which appends to its sections.
// validateProjectConfig stays strict: run, status and amend name `fix`
// in a strict failure when a key rule applies (fixHint); `fix --dryrun`
// lists the same findings without writing.
import { join } from "node:path"
import { ensurePointer } from "./agents-block"
import { appendToSection, BRIEF_FILE, BRIEF_SOURCE_HEADING, BRIEF_TARGET_HEADING, renderProjectBrief } from "./brief"
import {
  CONFIG_DEFAULTS,
  CONFIG_FILE,
  legacyModeFallback,
  LEGACY_FILE,
  retiredValue,
  saveConfigRecord,
  validateProjectConfig,
  type ProjectConfig,
} from "./config"
import { ensureGitignore, ensureModelsGitignore, MODELS_ENTRY } from "./gitignore"
import { CONTRACT_AGENT } from "./opts"
import { loadIntents } from "./intent/load"
import { shellProfile } from "./shell"
import { renderText } from "./template"
import templateAgent from "../templates/.opencode/agent/auto.md" with { type: "file" }
import templateConfig from "../templates/opencode.json" with { type: "file" }

export const CONTRACT_FILE = join(".opencode", "agent", `${CONTRACT_AGENT}.md`)

// The agent contract's rendered text: renders the built-in template in its two
// testByDriver states. The shell's contract-maintenance write, fix's contract
// rule and runAll's integrity check share this function, so the write and the
// comparison cannot drift apart (the template contains {{#if}} conditional
// blocks; comparing the raw text against the rendered file would never match).
export async function renderAgentContract(testByDriver: boolean): Promise<string> {
  return renderText(await Bun.file(templateAgent).text(), { testByDriver })
}

export type FixFinding = {
  class: "fixable" | "manual"
  // The file the finding is about, relative to the target directory.
  path: string
  problem: string
  // What fix does about it (fixable findings only).
  change?: string
}

export type FixPlan = {
  // No config.json and no legacy mode: there is nothing to fix; the directory needs init.
  uninitialized: boolean
  findings: FixFinding[]
  // Why the artifact rules did not run; undefined when they ran.
  skipped?: string
  // The writes behind the fixable findings, applied in this order.
  writes: { path: string; apply: () => Promise<unknown> }[]
}

// The key rules over the raw config.json: the fixed record (undefined when the
// file does not parse) and, when source/destDir move, the new brief text.
type KeyPlan = { uninitialized: boolean; findings: FixFinding[]; record?: Record<string, unknown>; brief?: string }

// Renamed watchdog keys: the old name is still read when the new one is absent.
const RENAMED: [string, string][] = [
  ["verifyIdle", "idleTime"],
  ["verifyMax", "idleMax"],
]

async function planKeys(dir: string): Promise<KeyPlan> {
  const text = await Bun.file(join(dir, CONFIG_FILE)).text().catch(() => undefined)
  if (text === undefined) {
    const legacy = await legacyModeFallback(dir)
    if (legacy === undefined) return { uninitialized: true, findings: [] }
    return {
      uninitialized: false,
      findings: [{ class: "fixable", path: CONFIG_FILE, problem: `missing; the legacy ${LEGACY_FILE} holds mode "${legacy}"`, change: `write it with mode "${legacy}" and the defaults` }],
      record: { ...CONFIG_DEFAULTS, mode: legacy },
    }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return { uninitialized: false, findings: [{ class: "manual", path: CONFIG_FILE, problem: `not valid JSON: ${error instanceof Error ? error.message : String(error)}` }] }
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { uninitialized: false, findings: [{ class: "manual", path: CONFIG_FILE, problem: "must be a JSON object" }] }
  }
  let record = { ...(raw as Record<string, unknown>) }
  const findings: FixFinding[] = []
  const drop = (key: string, problem: string, change = "drop the key") => {
    findings.push({ class: "fixable", path: CONFIG_FILE, problem, change })
    delete record[key]
  }
  if (retiredValue("commit", record.commit)) drop("commit", "commit: false is retired (unified commit is a completion condition)")
  if ("verify" in record) drop("verify", `verify: ${JSON.stringify(record.verify)} is retired (task-level acceptance was removed)`)
  if (retiredValue("agent", record.agent)) {
    drop("agent", `agent "${record.agent}" is a retired agent contract name (the contract is always ${CONTRACT_FILE})`, "drop the key (the agent is opencode)")
  }
  for (const [old, key] of RENAMED) {
    if (!(old in record)) continue
    if (key in record) {
      drop(old, `${old} was renamed to ${key}, which is also set`)
      continue
    }
    findings.push({ class: "fixable", path: CONFIG_FILE, problem: `${old} was renamed to ${key}`, change: `rename it to ${key}` })
    record = Object.fromEntries(Object.entries(record).map(([name, value]) => [name === old ? key : name, value]))
  }
  let brief: string | undefined
  for (const [key, heading, lines] of [
    ["source", BRIEF_SOURCE_HEADING, sourceLines],
    ["destDir", BRIEF_TARGET_HEADING, targetLines],
  ] as const) {
    if (!(key in record)) continue
    brief ??= (await Bun.file(join(dir, BRIEF_FILE)).text().catch(() => undefined)) ?? renderProjectBrief()
    brief = appendToSection(brief, heading, lines(record[key]))
    drop(key, `${key} is retired (the migration source and target are intent, not configuration)`, `move its value into ${BRIEF_FILE} under ${heading}, then drop the key`)
  }
  return { uninitialized: false, findings, record, brief }
}

// The retired keys as brief text, worded like the retired phase-plan inputs.
function sourceLines(value: unknown): string {
  const source = value as { dir?: unknown; path?: unknown } | null
  if (typeof source?.dir === "string" && typeof source.path === "string") {
    return [
      `- Source-system directory (relative to the working directory): \`${source.dir}\``,
      `- Source-module path (relative to the source-system directory): \`${source.path}\``,
    ].join("\n")
  }
  return `- Migration source (moved from ${CONFIG_FILE}): \`${JSON.stringify(value)}\``
}

function targetLines(value: unknown): string {
  if (typeof value === "string") return `- Migration-target directory (relative to the working directory): \`${value}\` — migrated code is written here`
  return `- Migration target (moved from ${CONFIG_FILE}): \`${JSON.stringify(value)}\``
}

// Computes the whole plan without writing: the shell prints it, gates and
// confirms, then applies exactly these writes (applyFix).
export async function planFix(dir: string): Promise<FixPlan> {
  const keys = await planKeys(dir)
  if (keys.uninitialized) return { uninitialized: true, findings: [], writes: [] }
  const findings = [...keys.findings]
  const writes: FixPlan["writes"] = []
  if (keys.brief !== undefined) {
    const brief = keys.brief
    writes.push({ path: BRIEF_FILE, apply: () => Bun.write(join(dir, BRIEF_FILE), brief) })
  }
  const record = keys.record
  if (!record) return { uninitialized: false, findings, writes, skipped: `${CONFIG_FILE} does not parse` }
  if (keys.findings.some((finding) => finding.class === "fixable")) writes.push({ path: CONFIG_FILE, apply: () => saveConfigRecord(dir, record) })
  let config: ProjectConfig
  try {
    config = validateProjectConfig(record, dir)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    findings.push({ class: "manual", path: CONFIG_FILE, problem: message.startsWith(`${CONFIG_FILE} `) ? message.slice(CONFIG_FILE.length + 1) : message })
    return { uninitialized: false, findings, writes, skipped: `${CONFIG_FILE} does not load` }
  }
  const fixable = (path: string, problem: string, change: string, apply: () => Promise<unknown>) => {
    findings.push({ class: "fixable", path, problem, change })
    writes.push({ path, apply })
  }

  const contract = await renderAgentContract(config.testByDriver)
  const current = await Bun.file(join(dir, CONTRACT_FILE)).text().catch(() => undefined)
  if (current === undefined) fixable(CONTRACT_FILE, "missing", "write it from the template", () => Bun.write(join(dir, CONTRACT_FILE), contract))
  else if (current !== contract) {
    fixable(CONTRACT_FILE, `differs from the template rendered for testByDriver = ${config.testByDriver}`, "rewrite it from the template", () => Bun.write(join(dir, CONTRACT_FILE), contract))
  }

  // The block embeds intent-pack text, so it renders against the project's packs.
  let packs: string | undefined
  try {
    loadIntents(dir)
  } catch (error) {
    packs = error instanceof Error ? error.message : String(error)
  }
  if (packs !== undefined) findings.push({ class: "manual", path: "AGENTS.md", problem: `the opencode-auto block renders from the intent packs, which do not load: ${packs}` })
  else {
    const preview = await ensurePointer(dir, { testByDriver: config.testByDriver, dryRun: true })
    const problems = [
      ...(preview.block === "inserted" ? ["the opencode-auto block is missing"] : []),
      ...(preview.block === "replaced" ? ["the opencode-auto block differs from the current config render"] : []),
      ...(preview.legacyRemoved ? [`${preview.legacyRemoved} legacy/stray opencode-auto marker block(s)`] : []),
    ]
    if (problems.length) {
      fixable("AGENTS.md", problems.join("; "), "write the current block and remove the stray ones", () => ensurePointer(dir, { testByDriver: config.testByDriver }))
    }
  }

  if (await ensureGitignore(dir, { dryRun: true })) fixable(".gitignore", "lacks the tmp/ or .auto/ entry", "append the missing entries", () => ensureGitignore(dir))
  // A project initialized before init ignored the model registry's project
  // layer (plans/0055 §4.1): preflight refuses an unignored one and names fix.
  if (await ensureModelsGitignore(dir, { dryRun: true })) {
    fixable(".gitignore", `lacks the ${MODELS_ENTRY} entry (the model registry's project layer is local-only)`, "append the entry", () => ensureModelsGitignore(dir))
  }

  if (!(await Bun.file(join(dir, "opencode.json")).exists())) {
    fixable("opencode.json", "missing", "write the template", async () => Bun.write(join(dir, "opencode.json"), await Bun.file(templateConfig).text()))
  }
  if (keys.brief === undefined && !(await Bun.file(join(dir, BRIEF_FILE)).exists())) {
    fixable(BRIEF_FILE, "missing", "write the stub", () => Bun.write(join(dir, BRIEF_FILE), renderProjectBrief()))
  }
  return { uninitialized: false, findings, writes }
}

export async function applyFix(plan: FixPlan): Promise<void> {
  for (const write of plan.writes) await write.apply()
}

// The plan as the shell prints it (and the tests read it): one line per finding.
export function formatFixPlan(plan: FixPlan): string {
  return [
    ...plan.findings.map((finding) =>
      finding.class === "fixable" ? `  fix: ${finding.path}: ${finding.problem} → ${finding.change}` : `  manual: ${finding.path}: ${finding.problem}`,
    ),
    ...(plan.skipped ? [`  skipped: the agent contract, AGENTS.md block, .gitignore, opencode.json and brief checks (${plan.skipped})`] : []),
  ].join("\n")
}

// The hint a strict config failure ends with when a key rule would repair it
// (0052 D11): undefined when none applies.
export async function fixHint(dir: string): Promise<string | undefined> {
  const keys = await planKeys(dir)
  return keys.findings.some((finding) => finding.class === "fixable") ? `fix: ${shellProfile().bin} fix ${dir}` : undefined
}
