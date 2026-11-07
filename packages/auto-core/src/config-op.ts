// The one init/amend sequence (plans/0193 D4): the check-and-write order both
// shells' entries mirror — baseline load, the handover pairing check, the
// phase-state read, the mode check, the merge with the dropper semantics, the
// intent pack-existence check, the read-only prefix guard, the prompt-library
// load, init's git bootstrap and commit-identity prerequisite (0073), the
// retired-key warnings, the overwrite gates, the config save, the
// opencode.json and agent-contract writes, init's root-symlink
// external-directory stamps (0122/0147), the AGENTS.md block sync, init's
// gitignore set, and the closing lines. The shells own their input grammar
// (argv flags / a JSON request body — value validation included), their
// pre-checks' placement, their gate mechanics, their exit mapping and their
// closing-line surfaces — everything else is this module, called with the
// parsed keys, an I/O adapter and a wording record. Before it, each new core
// rule had to be re-enacted in two shells by hand, and the misses were silent
// (0073's bootstrap and 0122/0147's stamps never reached the service shell's
// init; 0137's amend retirement was not enforced there; the gitignore closing
// line lost 0138's committed-surfaces teaching) — 0165-056's whole family.
import { join } from "node:path"
import type { ParallelLevel, ProjectConfig, RetiredKey } from "./config"
import { CONFIG_DEFAULTS, CONFIG_FILE, formatProjectConfig, loadOverwriteBaseline, loadProjectConfig, mergeProjectConfig, saveProjectConfig } from "./config"
import { fixHint, renderAgentContract } from "./config-fix"
import { applyExternalAllows, externalAllowsStatus } from "./external-dirs"
import { bootstrapRepository, commitIdentityProblem, writeLocalIdentity } from "./git"
import { ensureInitGitignore } from "./gitignore"
import { ensurePointer } from "./agents-block"
import { loadIntents } from "./intent/load"
import type { IntentBundle } from "./bundle"
import { materializeIntentBundle } from "./bundle"
import { BRIEF_FILE, writeBrief } from "./brief"
import templateConfig from "../templates/opencode.json" with { type: "file" }
import { loadModes } from "./mode"
import { currentRound, plannedPhaseUnits, readPhases, type PhaseState } from "./phases"
import { loadPhaseTypes } from "./phases/custom"
import { usePromptLibrary } from "./template"

// The parsed keys a shell hands the sequence — its own grammar's output
// (flags or request fields) mapped to this shell-neutral shape. `explicit`
// holds only the keys the caller gave; the carriers keep the dropper
// spellings separate so an amend cannot keep a stale value (agent "opencode",
// parallel "none", treeLanes "off" drop their key; an empty scanExempt or
// isolate list removes the stored one).
export type ConfigOpKeys = {
  explicit: Partial<ProjectConfig>
  mode?: string
  agent?: "opencode" | "claude"
  parallel?: "none" | ParallelLevel
  treeLanes?: "off" | "auto" | "on"
  scanExempt?: string[]
  isolate?: string[]
}

// The sequence's I/O adapter: the sinks and gates each entry owns. `line`
// prints an informational line (a shell's stdout log, an operation's lines
// array); `refuse` ends the operation with a usage/environment refusal
// (exit 1 on a CLI, the refused outcome on a service shell); `gates` runs the
// overwrite gates when the sequence reaches them (plain init over an existing
// config only) and returns the gate's own refusal lines when it blocks — the
// mechanics (a TTY confirmation with a -f escape, a two-field confirm/
// clean-tree request shape) are the shell's. A shell whose gate is a
// structured outcome of its own (an HTTP 409/428 answer) may throw it from
// the hook instead of returning lines; the context carries the merged config
// and the discarded-key warnings the gate's own body may preview.
export type ConfigOpIo = {
  line: (text: string) => void
  refuse: (lines: string[]) => never
  gates: (context: { config: ProjectConfig; warnings: string[] }) => Promise<string[] | undefined>
}

// The wording record: the surfaces that genuinely differ between shells —
// key spellings (a flag grammar names `--mode`, a request grammar
// `config.mode`), the remedy clauses that must teach the caller's own
// revision grammar, and init's closing line (each shell's advancing surface
// and fresh-project tail are its own).
export type ConfigOpWording = {
  // The mode key's spelling in its refusal ("--mode" | "config.mode").
  modeKey: string
  // The handoverTest-requires-testByDriver refusal: the handover key's
  // spelling, the test key's (with its ": true" request shape where the
  // grammar has one), and the "spell both" remedy clause.
  handoverKey: string
  handoverTestKey: string
  handoverRemedy: string
  // The intent key's spelling in its refusal ("--intent" | "config.intent")
  // and the refusal's trailing clause ("" on the CLI; the request-side note
  // that bundle materialization is the CLI's init --intent alone).
  intentKey: string
  intentTail: string
  // The identity refusal's flag-pair clause (the CLI teaches --name/--email;
  // a request grammar has no such fields).
  identityPairRemedy: string
  // The amend closing line's given-keys text (each shell's own vocabulary,
  // pre-joined).
  amendGiven: string
  // init's closing line, by phases shape and whether a round is already
  // established (the CLI names its subcommands; a service shell names its
  // operations — the shell's own advancing surface).
  initClosing: (phased: boolean, established: boolean, round: number) => string
}

// The run's channels beyond the keys: the CLI-only grammar (a bundle install,
// the brief revision, the identity pair) arrives as optional input; a request
// grammar leaves them absent and the sequence skips their branches.
export type ConfigOpInput = {
  kind: "init" | "amend"
  dir: string
  keys: ConfigOpKeys
  io: ConfigOpIo
  wording: ConfigOpWording
  bundle?: IntentBundle
  bundleIntent?: string
  briefSeed?: string
  identity?: { name: string; email: string }
}

const textOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// The sequence itself. Every check precedes the first write (0052 D7): a
// refusal leaves config.json, the templates, AGENTS.md, .gitignore and docs/
// untouched (the one deliberate exception is 0073's bootstrap, which by
// design runs before the gates — an empty repository left behind by a later
// refusal is `rm -rf .git` away from undone, the bootstrap's own ruling).
export async function runConfigSequence(input: ConfigOpInput): Promise<ProjectConfig> {
  const { kind, dir, keys, io, wording } = input
  const amend = kind === "amend"
  const { line, refuse } = io

  // 0137 on every shell: the phases key is init-stamped machinery — amend
  // refuses it outright, before any value validation (a retired key's value
  // is never judged), the reshape channel being the roadmap line. (The CLI
  // refuses its flag at parse time; the sequence's refusal is the request
  // grammar's, and the belt beneath both.)
  if (amend && keys.explicit.phases !== undefined) {
    refuse([
      "the phases key is retired on amend: a round's phases reshape by moving or adding its `- R-NN <phases> — <goal>` line in docs/analysis.md " +
        "(an uncovered round becomes covered the moment its line exists; the next transfer re-derives the unstarted tail) — " +
        "the config key is init-stamped machinery, chosen at init alone (the single-phase mode fixed at birth)",
    ])
  }

  // The baseline: amend loads the existing config strictly (it would carry a
  // retired key over); a full overwrite reads tolerantly and names each
  // retired key it discards (0052 D4) — the re-init that clears them must not
  // be blocked by them.
  // `!` definite assignment: the catch arms end in refuse (never) — the
  // variables are assigned on every path that continues.
  let existing!: ProjectConfig
  let discarded: RetiredKey[] = []
  try {
    if (amend) existing = await loadProjectConfig(dir)
    else ({ config: existing, retired: discarded } = await loadOverwriteBaseline(dir))
  } catch (error) {
    const lines = [textOf(error)]
    const hint = await fixHint(dir)
    if (hint) lines.push(hint)
    refuse(lines)
  }
  // acceptanceGate/build (0049 G9) have no flag, so a full-overwrite init
  // keeps them rather than silently erasing them; scanExempt and isolate
  // (0074) have their flags and follow the stateless overwrite.
  const handEdited = { acceptanceGate: existing.acceptanceGate, build: existing.build }
  const base: ProjectConfig = amend ? existing : { ...CONFIG_DEFAULTS, ...handEdited }

  // handoverTest requires testByDriver, judged on this run's effective values
  // (an amend turning test-by-driver off while keeping a stored
  // handoverTest=true is caught here too).
  const effectiveTestByDriver = keys.explicit.testByDriver ?? base.testByDriver
  const effectiveHandoverTest = keys.explicit.handoverTest ?? base.handoverTest
  if (effectiveHandoverTest && !effectiveTestByDriver) {
    refuse([
      `${keys.explicit.handoverTest !== undefined ? wording.handoverKey : "the existing handoverTest"} requires ${wording.handoverTestKey}: ` +
        `test handover only makes sense when tests run via the driver. To fix: ${wording.handoverRemedy}; or edit .opencode/auto/config.json directly`,
    ])
  }

  const liveRound = await currentRound(dir)
  let phaseState: PhaseState | undefined
  try {
    phaseState = await readPhases(dir, liveRound)
  } catch (error) {
    refuse([textOf(error)])
  }

  const modeName = keys.mode ?? base.mode
  let modes!: Record<string, unknown>
  try {
    modes = loadModes(dir)
  } catch (error) {
    refuse([textOf(error)])
  }
  if (!modes[modeName]) {
    refuse([`${wording.modeKey} must be a registered mode (currently supported: ${Object.keys(modes).join(", ")}); defaults to migrate`])
  }

  // The merge: explicit keys over the baseline; the list keys ride whole when
  // non-empty; the agent's positive value rides like any explicit key.
  const config = mergeProjectConfig(base, {
    ...keys.explicit,
    mode: modeName,
    ...(keys.agent === "claude" ? { agent: keys.agent } : {}),
    ...(keys.scanExempt?.length ? { scanExempt: keys.scanExempt } : {}),
    ...(keys.isolate?.length ? { isolate: keys.isolate } : {}),
  })
  // The bundle's stamps (0079 §3) fill only what the person did not give
  // explicitly — a flag always wins over the manifest.
  if (input.bundle) {
    if (keys.explicit.phases === undefined) config.phases = input.bundle.phases
    if (keys.mode === undefined && input.bundle.mode !== undefined) config.mode = input.bundle.mode
    if (keys.explicit.subtask === undefined && input.bundle.stamps.subtask !== undefined) config.subtask = input.bundle.stamps.subtask
    if (keys.explicit.parallel === undefined && input.bundle.stamps.parallel !== undefined) config.parallel = input.bundle.stamps.parallel
    if (keys.explicit.wrapup === undefined && input.bundle.stamps.wrapup !== undefined) config.wrapup = input.bundle.stamps.wrapup
    config.intent = input.bundle.name
    if (input.bundle.mode !== undefined && !modes[input.bundle.mode] && !input.bundle.files.mode) {
      refuse([`--intent ${input.bundleIntent}: the bundle's manifest mode "${input.bundle.mode}" is not a registered mode (currently supported: ${Object.keys(modes).join(", ")})`])
    }
  }
  // The intent pack-existence check (0079 §2), judged on the merged value: a
  // parsed bundle satisfies itself — its pack materializes before the config
  // write below.
  if (config.intent !== undefined && config.intent !== input.bundle?.name && !loadIntents(dir)[config.intent]) {
    const packs = loadIntents(dir)
    refuse([`${wording.intentKey} must be a loaded intent pack (currently available: ${Object.keys(packs).sort().join(", ")}); defaults to the built-in default pack${wording.intentTail}`])
  }
  // The key droppers: an amend would otherwise keep the old value.
  if (keys.agent === "opencode") delete config.agent
  if (keys.parallel === "none") delete config.parallel
  if (keys.treeLanes === "off") delete config.treeLanes
  if (keys.scanExempt !== undefined && !keys.scanExempt.length) delete config.scanExempt
  if (keys.isolate !== undefined && !keys.isolate.length) delete config.isolate

  // The read-only prefix guard, one per command (0053 D31–D32): a value that
  // would drop a completed phase or a directory holding work could never be
  // re-synced; skipped when the current round is complete (the value then
  // applies to the next round). A bundle's phase types are not on disk until
  // materialization, so the guard sees them beside the loaded ones.
  const roundComplete = !!phaseState && phaseState.phases.every((unit) => phaseState.done.has(unit.id))
  if (!roundComplete) {
    try {
      await plannedPhaseUnits(dir, liveRound, config.phases, input.bundle ? [...loadPhaseTypes(dir), ...input.bundle.types] : undefined)
    } catch (error) {
      refuse([
        `${textOf(error)}. A mid-round phases change must keep the current round's completed phases and the phase directories that hold work; ` +
          "once the current round is complete, any value applies to the next round plan establishes",
      ])
    }
  }

  // The prompt library and intent packs: loading early surfaces override
  // problems at init time already.
  try {
    usePromptLibrary(dir)
    loadIntents(dir)
  } catch (error) {
    refuse([textOf(error)])
  }

  // Commit capability prerequisite (plain init only; amend touches an
  // already-working project): the unified commit is the completion
  // condition. The git bootstrap (0073) runs first and prints loudly — in a
  // directory inside no work tree, init creates the repository itself; there
  // is deliberately no --no-git escape hatch. Every shell's init bootstraps
  // (0193 D4: the service shell's runs used to complete with no commit
  // anywhere — no unified commit, no rollback anchor, no Auto-Stage history).
  if (!amend) {
    const bootstrap = await bootstrapRepository(dir)
    if (bootstrap.type === "failed") {
      refuse([
        `cannot initialize a git repository in ${dir}: ${bootstrap.error}. ` +
          "The driver commits after every session (the unified commit is the completion condition), so init requires one; " +
          "create the repository yourself (git init) and re-run, or fix the underlying git problem",
      ])
    }
    if (bootstrap.type === "created") {
      line(`✓ initialized git repository (branch ${bootstrap.branch}) in ${dir} — the driver's record and rollback need it`)
    }
    const problem = await commitIdentityProblem(dir)
    if (problem) {
      if (input.identity !== undefined) {
        const error = await writeLocalIdentity(dir, input.identity)
        if (error) refuse([`cannot write the repository-local commit identity in ${dir}: ${error}`])
        line("✓ commit identity written as repository-local config (user.name/user.email from --name/--email; never --global)")
      } else {
        refuse([
          `git cannot commit in ${dir}: ${problem}. The driver commits after every session, so init requires a repository that can commit; ` +
            `configure an identity first, e.g. git config --global user.name <name> and git config --global user.email <email> ` +
            `(drop --global to configure this repository only)${wording.identityPairRemedy}`,
        ])
      }
    }
  }

  const warnings = discarded.map((item) => `⚠ full overwrite drops the retired key ${item.key} = ${JSON.stringify(item.value)}: ${item.why}`)
  for (const warning of warnings) line(warning)

  // The mistouch gates (plain init overwriting an existing config only — a
  // fresh directory has nothing to overwrite, and amend discards no key):
  // injected, clean-tree then the person's confirmation, each in the shell's
  // own mechanics.
  if (!amend && (await Bun.file(join(dir, CONFIG_FILE)).exists())) {
    const gate = await io.gates({ config, warnings })
    if (gate) refuse(gate)
  }

  // The bundle's files join the write phase here (0079 §3): every check has
  // passed, so the materialization lands with the config that names it.
  if (input.bundle) {
    let written!: string[]
    try {
      written = await materializeIntentBundle(dir, input.bundle)
    } catch (error) {
      refuse([`--intent ${input.bundleIntent}: materializing the bundle into ${dir} failed: ${textOf(error)}`])
    }
    line(`✓ intent bundle "${input.bundle.name}" materialized (${written.join(", ")})`)
  }

  try {
    await saveProjectConfig(dir, config)
  } catch (error) {
    refuse([`failed to write ${CONFIG_FILE}: ${textOf(error)}`])
  }
  line(`⚙ project config (${CONFIG_FILE}): ${formatProjectConfig(config)}`)

  // opencode.json is init's alone (amend writes only what renders from the
  // config) and may hold a person's edits: skipped whenever it exists. The
  // agent contract renders through the core's one renderer — the same
  // function runAll's integrity check compares against, so the write and the
  // check cannot drift apart.
  if (!amend) {
    const target = join(dir, "opencode.json")
    if (await Bun.file(target).exists()) line("already exists, skipped: opencode.json")
    else {
      await Bun.write(target, await Bun.file(templateConfig).text())
      line("created: opencode.json")
    }
  }
  const contract = await renderAgentContract(config.testByDriver)
  const contractPath = join(dir, ".opencode", "agent", "auto.md")
  const current = await Bun.file(contractPath).text().catch(() => undefined)
  if (current === contract) line(`already exists, skipped: .opencode/agent/auto.md`)
  else {
    await Bun.write(contractPath, contract)
    line(current === undefined ? `created: .opencode/agent/auto.md` : `replaced (differed from the template): .opencode/agent/auto.md`)
  }

  // The root-symlink read-only stamps (0122, the composite since 0147) —
  // every shell's init: one additive insert of exactly the stamp entries,
  // whether it just created opencode.json or found a person's file. No root
  // symlinks writes nothing (the byte-identical floor); a file that cannot
  // hold the entries is a warning here and a fix finding there.
  if (!amend) {
    const allows = await externalAllowsStatus(dir)
    if (allows.status === "needs-stamp") {
      await applyExternalAllows(dir)
      line(`stamped: opencode.json the root-symlink read-only stamps (external_directory allow + edit deny) for ${[...new Set(allows.missing.map((key) => key.replace(/^edit:/, "")))].join(", ")}`)
    } else if (allows.status === "malformed") {
      line("⚠ opencode.json cannot hold the root-symlink external_directory allows (malformed or a flat action); fix reports the detail")
    }
  }

  // The brief revision channel (the CLI's amend --brief; a request grammar
  // has none): the text verbatim.
  if (input.briefSeed !== undefined) {
    const existed = await Bun.file(join(dir, BRIEF_FILE)).exists()
    await writeBrief(dir, `${input.briefSeed.trimEnd()}\n`)
    line(
      existed
        ? `replaced: ${BRIEF_FILE} (the brief, verbatim)`
        : `created: ${BRIEF_FILE} (the person's manual word, verbatim — the next approved proposal replaces the whole file; every planning session reads it)`,
    )
  }

  // The AGENTS.md block, idempotently synced from the current config.
  const ensured = await ensurePointer(dir, { testByDriver: config.testByDriver })
  line(
    ensured.block === "inserted"
      ? "appended: AGENTS.md opencode-auto block"
      : ensured.block === "replaced"
        ? "refreshed: AGENTS.md opencode-auto block (differed from the current config render)"
        : "already exists, skipped: AGENTS.md opencode-auto block (up to date)",
  )
  if (ensured.legacyRemoved) line(`cleaned: removed ${ensured.legacyRemoved} legacy/stray opencode-auto marker block(s) from AGENTS.md`)

  // Plain init writes the full ignore set in one pass; amend never touches
  // it. The file itself and opencode.json are committed project surfaces
  // (0138) — the closing line teaches the person to commit them with the
  // rest, on every shell.
  if (!amend) {
    const appended = await ensureInitGitignore(dir)
    if (appended.length)
      line(
        `updated: .gitignore now ignores ${appended.join(", ")} (driver workdir, local-only files and nested git repositories; ` +
          "the file itself and opencode.json are committed project surfaces — commit them with the config layer)",
      )
  }

  if (amend) {
    line(`✓ amended (${wording.amendGiven}); the other keys are unchanged. Review the change and commit it`)
    return config
  }

  // init's closing line (0053 D31, re-keyed by 0101 D4): the rounds' opening
  // command — transfer on a phased project, plan in m mode — through the
  // shell's own advancing surface, with the fresh-project pointer naming the
  // assisted analysis (0084).
  line(wording.initClosing(config.phases !== "m", phaseState !== undefined, liveRound))
  return config
}
