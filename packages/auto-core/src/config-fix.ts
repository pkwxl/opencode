// Config fix (plans/0052 D10/D11): the rule table behind the shell's
// `fix` command. Every key retirement used to be only an error text telling a
// person what to edit; each rule here turns one into an executable step.
// Rules for the rules:
//   - Config layer only: .opencode/auto/config.json and the artifacts init
//     writes from it. Phase-index inconsistencies belong to `plan` (0052 D22).
//   - Three classes. fixable = deterministic and meaning-preserving; manual =
//     report only, never guess (handoverTest without testByDriver: which side
//     to change is a human decision); info = recorded state, nothing to
//     repair (plans/0135: the note names an expected posture and its channel,
//     never a person act — it fails no gate and asks nothing of anyone).
//   - Only keys that fail to load or silently lose their meaning are broken.
//     Valid alternative spellings (a phases array, parallel "none", agent
//     "opencode") are left alone.
//   - config.json is rewritten from its own raw record, so unknown keys and
//     every key no rule names survive: fix never resets other keys.
//   - The artifact rules render from the config, so they run only when the
//     config loads strictly once the key rules are applied; otherwise they are
//     reported as skipped.
//   - Files a person may have edited (opencode.json, brief.md) are only
//     written when missing, as init does. Three exceptions: moving the retired
//     source/destDir into brief.md (appends to its sections); inserting
//     the root-symlink external_directory allows into opencode.json
//     (plans/0122 — additive, exactly those allow entries, the person's
//     rules kept and always winning the evaluation tie); and inserting the
//     working-directory knowledge boundary with the symlink targets'
//     read-only edit denies (plans/0147 — additive, exactly the
//     deny-`/**` + allow-`/tmp/**` pair and those deny entries, the
//     person's later rules still winning).
// validateProjectConfig stays strict: run, status and amend name `fix`
// in a strict failure when a key rule applies (fixHint); `fix --dryrun`
// lists the same findings without writing.
import { join } from "node:path"
import { ensurePointer } from "./agents-block"
import { provenanceComparison } from "./bundle"
import { appendToSection, BRIEF_FILE, BRIEF_SOURCE_HEADING, BRIEF_TARGET_HEADING } from "./brief"
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
import {
  ensureGitignore,
  ensureModelsGitignore,
  ensureNestedGitignore,
  MODELS_ENTRY,
  removeGitignoreEntry,
  retiredGitignoreEntries,
} from "./gitignore"
import { ANALYSIS_DOC, roundDirName } from "./docpaths"
import { applyExternalAllows, applyKnowledgeBoundary, externalDirectoryEntries, knowledgeBoundaryMissing, missingExternalDirectoryAllows, missingReadOnlyEditDenies, OPENCODE_CONFIG_FILE, pathsOverlap, readOnlyEditEntriesFor, rootSymlinkRealPaths, staleExternalDirectoryAllows, stampExternalDirectories, stampReadOnlyEdits } from "./external-dirs"
import { findWallCommit, wallDeclared } from "./wall"
import { provenanceFindings } from "./provenance"
import { currentRound } from "./phases"
import { supersedingPhases } from "./roadmap"
import { CONTRACT_AGENT } from "./opts"
import { loadIntents } from "./intent/load"
import { shellProfile } from "./shell"
import { renderText } from "./template"
import templateAgent from "../templates/.opencode/agent/auto.md" with { type: "file" }
import templateConfig from "../templates/opencode.json" with { type: "file" }

const CONTRACT_FILE = join(".opencode", "agent", `${CONTRACT_AGENT}.md`)

// The agent contract's rendered text: renders the built-in template in its two
// testByDriver states. The shell's contract-maintenance write, fix's contract
// rule and runAll's integrity check share this function, so the write and the
// comparison cannot drift apart (the template contains {{#if}} conditional
// blocks; comparing the raw text against the rendered file would never match).
export async function renderAgentContract(testByDriver: boolean): Promise<string> {
  return renderText(await Bun.file(templateAgent).text(), { testByDriver })
}

type FixFinding = {
  class: "fixable" | "manual" | "info"
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
    // The stub model retired (plans/0081 D11): a missing brief starts empty —
    // appendToSection adds the heading — and is no finding of its own.
    brief ??= (await Bun.file(join(dir, BRIEF_FILE)).text().catch(() => undefined)) ?? ""
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
  // The nested-repository entries (plans/0138): init stamps the set at init
  // time; a repository that appears later (or a pre-0138 clone whose partial
  // .gitignore never carried them) would be absorbed by the parent's unified
  // commit as a gitlink.
  if ((await ensureNestedGitignore(dir, { dryRun: true })).length) {
    fixable(".gitignore", "lacks an entry for a nested git repository in the tree", "append the entry (the parent's unified commit would otherwise absorb the repository as a gitlink)", () => ensureNestedGitignore(dir))
  }
  // The retired entries (plans/0138): pre-0138 init ignored the .gitignore
  // itself and opencode.json, so neither ever reached git — every fresh clone
  // lost the whole ignore set (the first run's housekeeping commit then
  // tracking a partial file) and the person's opencode.json edits were
  // unversioned. The self-entry is the tool's own surface: stripped here, the
  // file surfaces untracked and lands in git with the next commit. The
  // opencode.json line stays the person's pen act: the file holds person
  // settings, and whoever must keep it local owns their own line and this
  // finding.
  const retired = await retiredGitignoreEntries(dir)
  if (retired.includes("/.gitignore")) {
    fixable(".gitignore", "holds the retired /.gitignore entry (the ignore set is a tracked project surface since plans/0138 — a self-ignored file never reached git, and every fresh clone lost the whole set)", "remove the entry (the file surfaces untracked and lands in git with the next commit)", () => removeGitignoreEntry(dir, "/.gitignore"))
  }
  if (retired.includes("/opencode.json")) {
    findings.push({
      class: "manual",
      path: ".gitignore",
      problem: "holds the retired /opencode.json entry (opencode.json is a tracked project surface since plans/0138) — remove the line by hand to surface the file, or keep it and own it if the file must stay local",
    })
  }

  // The template write carries the boundary (plans/0147) and the read-only
  // symlink stamps (plans/0122 + 0147 D2), so one pass sets a fresh file up
  // completely; the file itself stays the template byte-for-byte when no
  // symlinks exist. The sealed wall's recorded targets (plans/0189 D3): the
  // allow layer never stamps a real path under or over one — a reopened
  // room stays shut (the edit-layer denies still stamp; defense-in-depth).
  const wallTargets = wallDeclared(dir) ? ((await findWallCommit(dir))?.doors.map((door) => door.target) ?? []) : []
  const stampableAllows = (realPaths: readonly string[]): readonly string[] =>
    wallTargets.length ? realPaths.filter((real) => !wallTargets.some((target) => pathsOverlap(real, target))) : realPaths
  const stampedTemplate = async () => {
    const text = await Bun.file(templateConfig).text()
    const realPaths = await rootSymlinkRealPaths(dir)
    let next = stampExternalDirectories(text, externalDirectoryEntries(stampableAllows(realPaths)))
    if (next !== undefined) next = stampReadOnlyEdits(next, await readOnlyEditEntriesFor(dir))
    return next ?? text
  }
  if (!(await Bun.file(join(dir, OPENCODE_CONFIG_FILE)).exists())) {
    fixable(OPENCODE_CONFIG_FILE, "missing", "write the template", async () => Bun.write(join(dir, OPENCODE_CONFIG_FILE), await stampedTemplate()))
  } else {
    const text = await Bun.file(join(dir, OPENCODE_CONFIG_FILE)).text()
    // The working-directory knowledge boundary (plans/0147 D1): standing
    // projects keep the pre-boundary bytes; missing boundary keys are fixable
    // (the person widens by appending later keys, which win the tie), a file
    // that cannot hold per-pattern entries is manual.
    const boundaryMissing = knowledgeBoundaryMissing(text)
    if (boundaryMissing === undefined) {
      findings.push({
        class: "manual",
        path: OPENCODE_CONFIG_FILE,
        problem: "the permission.external_directory section cannot hold the working-directory knowledge boundary (malformed file or a flat action) — add it by hand",
      })
    } else if (boundaryMissing) {
      fixable(OPENCODE_CONFIG_FILE, "permission.external_directory lacks the working-directory knowledge boundary (default-deny outside the working directory, /tmp excepted)", "insert the knowledge boundary (deny /** , allow /tmp/**)", () => applyKnowledgeBoundary(dir))
    }
    // The root-symlink read-only composite (plans/0122, the write side since
    // 0147 D2 in every ask form since plans/0188 D3): missing entries in
    // either layer are fixable (the write re-derives from disk at apply
    // time — idempotent); a stale allow or a file that cannot hold
    // per-pattern entries is manual (never guess, never delete person
    // content). A root symlink resolving under or over a recorded wall
    // target is a reopen (plans/0189 D3): its allow is never stamped — it
    // would land after the boundary's catch-all deny and beat the wall's
    // front deny under last-match-wins, re-opening the room through a new
    // door — and the manual finding names the reopen instead.
    const realPaths = await rootSymlinkRealPaths(dir)
    const stampable = stampableAllows(realPaths)
    for (const reopened of realPaths.filter((real) => !stampable.includes(real))) {
      findings.push({
        class: "manual",
        path: OPENCODE_CONFIG_FILE,
        problem: `a root symlink resolves to ${reopened}, under (or over) the sealed reference wall's recorded target — a reopen the wall's boundary checks block; remove the symlink (fix does not stamp allows past a sealed wall)`,
      })
    }
    if (realPaths.length) {
      const missing = missingExternalDirectoryAllows(text, externalDirectoryEntries(stampable))
      const editMissing = missingReadOnlyEditDenies(text, await readOnlyEditEntriesFor(dir))
      if (missing === undefined || editMissing === undefined) {
        findings.push({
          class: "manual",
          path: OPENCODE_CONFIG_FILE,
          problem: "the permission.external_directory or permission.edit section cannot hold the root-symlink read-only stamps (malformed file or a flat action) — add them by hand",
        })
      } else if (missing.length || editMissing.length) {
        const named = [...missing, ...editMissing.map((key) => `edit ${key}`)]
        fixable(OPENCODE_CONFIG_FILE, `the root-symlink stamps are incomplete (${named.join(", ")})`, "insert the root-symlink allow(s) and their read-only edit deny(s)", () => applyExternalAllows(dir, wallTargets))
      }
      for (const key of (await staleExternalDirectoryAllows(text, realPaths)) ?? []) {
        findings.push({
          class: "manual",
          path: OPENCODE_CONFIG_FILE,
          problem: `permission.external_directory allows ${key} but that path does not exist (the symlink or its target is gone) — remove the entry if the reference moved`,
        })
      }
    }
  }
  // The bundle provenance findings (plans/0100 D3): manual only — a charter
  // change is not meaning-preserving, so the class stays out of the fixable
  // set by the rule table's own contract, and `sync` owns the write side.
  // Report-only: the write list gains nothing, and the findings appear
  // exactly when a stamp exists and a managed file is stale or edited.
  {
    const comparison = await provenanceComparison(dir)
    if (comparison !== undefined) {
      for (const finding of provenanceFindings(comparison)) findings.push({ class: "manual", path: finding.path, problem: finding.problem })
    }
  }
  // The roadmap supersession (plans/0114 D2, divergence-only since 0136): a
  // released roadmap's line for the current round is that round's phase list
  // (plans/0101 D5) — the config key then silently loses its meaning for the
  // round. Nothing is wrong with the config: the person reshapes rounds by
  // moving roadmap lines, and a valid key is never rewritten — so the note is
  // info, not manual (plans/0135): an expected posture recorded against
  // "cleaning up" the key, it names no person act, exits 0 alone, and no edit
  // of the file could clear it. It fires only on a real divergence
  // (supersedingPhases resolves both values through the establishment
  // registry): an agreeing pair is the designed state — the line establishes
  // exactly what init stamped — and no note surfaces to read as drift. m mode
  // never consults the roadmap; a round the roadmap does not cover keeps the
  // key as its live establishment authority and names nothing.
  if (config.phases !== "m") {
    const round = await currentRound(dir)
    const superseded = await supersedingPhases(dir, config.phases, round)
    if (superseded !== undefined) {
      findings.push({
        class: "info",
        path: CONFIG_FILE,
        problem: `phases (config "${config.phases}"): ${roundDirName(round)}'s line establishes "${superseded.phases}" under the released roadmap of ${ANALYSIS_DOC} — nothing to repair (reshape the round by moving its line)`,
      })
    }
  }
  // A missing brief is no longer a finding (plans/0081 D11): omitted seed
  // writes no file, and the analysis phase proposes the brief in its round.
  return { uninitialized: false, findings, writes }
}

export async function applyFix(plan: FixPlan): Promise<void> {
  for (const write of plan.writes) await write.apply()
}

// The plan as the shell prints it (and the tests read it): one line per finding.
export function formatFixPlan(plan: FixPlan): string {
  const line = (finding: FixFinding) =>
    finding.class === "fixable"
      ? `  fix: ${finding.path}: ${finding.problem} → ${finding.change}`
      : `  ${finding.class}: ${finding.path}: ${finding.problem}`
  return [...plan.findings.map(line), ...(plan.skipped ? [`  skipped: the agent contract, AGENTS.md block, .gitignore, opencode.json and brief checks (${plan.skipped})`] : [])].join("\n")
}

// The hint a strict config failure ends with when a key rule would repair it
// (0052 D11): undefined when none applies.
export async function fixHint(dir: string): Promise<string | undefined> {
  const keys = await planKeys(dir)
  return keys.findings.some((finding) => finding.class === "fixable") ? `fix: ${shellProfile().bin} fix ${dir}` : undefined
}
