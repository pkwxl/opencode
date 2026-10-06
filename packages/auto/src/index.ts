#!/usr/bin/env bun
import { stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import { BRIEF_FILE } from "@opencode-ai/auto-core/brief"
import { checkCleanTree } from "@opencode-ai/auto-core/clean"
import { confirm } from "@opencode-ai/auto-core/confirm"
import {
  CONFIG_DEFAULTS,
  CONFIG_FILE,
  PARALLEL_LEVELS,
  formatProjectConfig,
  isolateProblem,
  legacyModeFallback,
  loadOverwriteBaseline,
  loadProjectConfig,
  mergeProjectConfig,
  saveProjectConfig,
  scanExemptProblem,
  splitGlobList,
  type ProjectConfig,
  type RetiredKey,
} from "@opencode-ai/auto-core/config"
import { applyFix, fixHint, formatFixPlan, planFix } from "@opencode-ai/auto-core/config-fix"
import { closeUnit, type CloseChanges } from "@opencode-ai/auto-core/close"
import { landUnit } from "@opencode-ai/auto-core/land"
import { acquireRunLock, liveRunLock, lockLines, lockStatusLine } from "@opencode-ai/auto-core/lock"
import { log, setInteractive, setLogFile, setVerbose } from "@opencode-ai/auto-core/log"
import { ensurePointer } from "@opencode-ai/auto-core/agents-block"
import { bootstrapRepository, commitIdentityProblem, writeLocalIdentity } from "@opencode-ai/auto-core/git"
import { ensureInitGitignore } from "@opencode-ai/auto-core/gitignore"
import { runAll, runLaneWorker, type RunAllOpts } from "@opencode-ai/auto-core/loop"
import { loadModes, type ModeSpec } from "@opencode-ai/auto-core/mode"
import { describeModels, formatModels } from "@opencode-ai/auto-core/models-describe"
import { probeModels } from "@opencode-ai/auto-core/agent-pool"
import { planPrelude } from "@opencode-ai/auto-core/plan"
import type { PlanInput } from "@opencode-ai/auto-core/plan-input"
import { applyReset, formatResetPlan, planReset } from "@opencode-ai/auto-core/reset"
import {
  currentRound,
  formatPhases,
  legacyLayoutProblem,
  parsePhases,
  phaseIndexPath,
  plannedPhaseUnits,
  readPhases,
  type PhaseState,
} from "@opencode-ai/auto-core/phases"
import { loadPhaseTypes } from "@opencode-ai/auto-core/phases/custom"
import { PRESET_FORM, phasesProblem, type PhaseTypeEntry } from "@opencode-ai/auto-core/phases/registry"
import { renderStatus } from "@opencode-ai/auto-core/status"
import { roundDirName } from "@opencode-ai/auto-core/docpaths"
import { SUBTASK_MODES, type PermissionMode, type SubtaskMode } from "@opencode-ai/auto-core/opts"
import { loadIntents, planningInputScaffold } from "@opencode-ai/auto-core/intent/load"
import { materializeIntentBundle, parseIntentBundle, resolveIntentBundle, type IntentBundle } from "@opencode-ai/auto-core/bundle"
import { shellProfile } from "@opencode-ai/auto-core/shell"
import { usePromptLibrary, renderText } from "@opencode-ai/auto-core/template"
import templateConfig from "@opencode-ai/auto-core/templates/opencode.json" with { type: "file" }
import templateAgent from "@opencode-ai/auto-core/templates/.opencode/agent/auto.md" with { type: "file" }

const args = process.argv.slice(2)
const command = args[0]

const flags = new Map<string, string>()
const positional: string[] = []
// --agent/--server/--wait-answer/--wait-between/--context-limit/--subtask/
// --prompt/--file/--permission/--idle-time/--idle-max/--mode/--phases/--parallel/
// --scan-exempt/--max-sessions/--reason (shared by close and plan --force-close)/--force-close
// and --new-task (plan's alone) are value flags (they swallow the next token; the retired
// --implement-file/--implement-prompt/--commit swallow one too, so their argument is
// never mistaken for the directory, auto-core plans/0053 D13; init's retired
// -p/--prompt keeps swallowing one for the same reason, plans/0053 D31);
// --verbose/--interactive/--dryrun/--test-by-driver/
// --handover-test/--new-session/--auto-number/--no-auto-number/--wrapup/
// --no-wrapup plus --cascade/--commit-changes/--stash-changes (shared by close and plan
// --force-close), --append (plan's alone) and --keep/--abandon (land's alone,
// plans/0074 U-L2) are boolean flags: presence means
// true, and only a literally following true/false is swallowed. Every flag
// accepts --flag=value; --prompt also has the short form -p, --interactive the
// short form -i (boolean, swallows nothing), --mode the short form -m
// (mirroring -p's swallow rule). Parsing matches whole names exactly:
// --commit-changes differs from the retired --commit and --force-close from
// -f/--force, so none swallows the other's value by mistake; close's ref always
// comes first (positional[0]), so --commit cannot swallow it even as a value
// flag (auto-core plans/0053 D20/F8; the close side intercepts it with its own
// retirement message anyway).
const VALUE_FLAGS = new Set([
  "agent",
  "server",
  "wait-answer",
  "wait-between",
  "context-limit",
  "commit",
  "subtask",
  "prompt",
  "file",
  "reason",
  "force-close",
  "permission",
  "idle-time",
  "idle-max",
  "mode",
  "phases",
  "implement-file",
  "implement-prompt",
  "parallel",
  "scan-exempt",
  "max-sessions",
  "new-task",
  // `_lane`'s alone (hidden, below): the unit the lane worker runs, and the
  // parent branch a conflict repair's re-dispatch merges into the lane
  // branch (plans/0068 D7).
  "unit",
  "merge",
  // --name/--email (plans/0073 §2.2): init's identity pair, written as
  // repository-local git config when no global/GIT_* identity resolves —
  // value flags (they swallow their argument); every command but init
  // refuses them.
  "name",
  "email",
  // --isolate (plans/0074 §5.4, U-L1): a branch-isolated nested repository,
  // by repository-relative path; a value flag like every config flag, but
  // repeatable — see REPEAT_FLAGS below.
  "isolate",
  // --export/--adopt (plans/0076, T-137): the standalone work-order routes of
  // plan — render a ready unit's work order to stdout (--export <T-NNN>) and
  // close the externally-driven unit out (--adopt <T-NNN>); value flags (they
  // swallow the task id), plan's alone.
  "export",
  "adopt",
  // --intent (plans/0079 §2/§3): the active intent pack's name — on init also
  // an intent-bundle source (a registered bundle name or a directory path
  // holding bundle.json, materialized into the target); elsewhere the plain
  // config-key revision.
  "intent",
  // --repair (plans/0079 §4): run's bounded repair budget — how many
  // automatic repair rounds a FAIL verdict or a held verdict gate may drive
  // before blocking for the human; run's alone.
  "repair",
  // --brief/--brief-file (plans/0081 D11): the project brief's seed (init) or
  // revision (amend) — the text verbatim, or the file holding it; init/amend's
  // alone (refused elsewhere like the config flags).
  "brief",
  "brief-file",
])
// Repeatable value flags (plans/0074 §5.4: --isolate): each occurrence names
// one value, so the values are collected in their own table instead of the
// single-value flags map (which keeps only the last occurrence as a presence
// marker, for the whitelist pass and the amend "name at least one key" check
// that read flags.has). parseConfigFlags reads the values from repeatFlags.
const REPEAT_FLAGS = new Set(["isolate"])
const repeatFlags = new Map<string, string[]>()
const BOOLEAN_FLAGS = new Set(["verbose", "interactive", "dryrun", "test-by-driver", "handover-test", "new-session", "auto-number", "no-auto-number", "wrapup", "no-wrapup", "amend", "force", "cascade", "commit-changes", "stash-changes", "append", "keep", "abandon", "scaffold"])
for (let i = 1; i < args.length; i++) {
  const arg = args[i]!
  if (arg === "-i") {
    flags.set("interactive", "")
    continue
  }
  if (arg === "-f") {
    flags.set("force", "")
    continue
  }
  if (arg === "-p") {
    const next = args[i + 1]
    if (next !== undefined) {
      flags.set("prompt", next)
      i++
    } else {
      flags.set("prompt", "")
    }
    continue
  }
  if (arg === "-m") {
    const next = args[i + 1]
    if (next !== undefined) {
      flags.set("mode", next)
      i++
    } else {
      flags.set("mode", "")
    }
    continue
  }
  if (!arg.startsWith("--")) {
    positional.push(arg)
    continue
  }
  const eq = arg.indexOf("=")
  if (eq !== -1) {
    if (REPEAT_FLAGS.has(arg.slice(2, eq))) {
      pushRepeat(arg.slice(2, eq), arg.slice(eq + 1))
      continue
    }
    flags.set(arg.slice(2, eq), arg.slice(eq + 1))
    continue
  }
  const key = arg.slice(2)
  const next = args[i + 1]
  if ((VALUE_FLAGS.has(key) && next !== undefined) || (BOOLEAN_FLAGS.has(key) && (next === "true" || next === "false"))) {
    if (REPEAT_FLAGS.has(key)) pushRepeat(key, next!)
    else flags.set(key, next)
    i++
    continue
  }
  if (REPEAT_FLAGS.has(key)) pushRepeat(key, "")
  flags.set(key, "")
}

// Collect one occurrence of a repeatable flag (values in repeatFlags; the
// flags map keeps the last value as the presence marker).
function pushRepeat(key: string, value: string) {
  const list = repeatFlags.get(key) ?? []
  list.push(value)
  repeatFlags.set(key, list)
  flags.set(key, value)
}

// `continue` is retired (auto-core plans/0053 D33): plan owns the rounds —
// its prelude runs the round-close checks and opens the next round once the
// current one is complete, so the dedicated subcommand has no work left.
// The notice is the one answer whatever follows the command: it fires before
// the flag refusals, the unknown-option scan, the legacy-layout check and the
// run-lock refusal — a retired command has no flags, directory or lock
// semantics left to honor (A1 had `continue` refuse while a live lock was
// held because it wrote the config and the round setup; that path is gone).
// AUTO-DECISION (placement): the check sits before every command-specific
// interception, so `continue --append`/`--verify`/... print the retirement
// notice rather than each flag's own refusal (alternatives rejected: after
// the whitelist, which would answer "unknown option" for a dead command;
// per-flag ordering, which multiplies answers for one retirement).
if (command === "continue") {
  console.error(
    `continue is retired: once the round is complete, fill in ## Close of docs/R-NN/round.md, commit, and run ${shellProfile().bin} plan <dir> — it runs the round-close checks and opens the next round`,
  )
  process.exit(1)
}

// `check` is retired: its principle scan was a regex heuristic over prose
// (content policing), and its reference check was removed with the reference
// checker. The useful half of the command — the configuration findings —
// already lives in `fix`; `fix --dryrun` lists them read-only and keeps an
// exit code a scripted gate can use. Like `continue`'s, the notice is the one
// answer whatever follows the command: it fires before the flag refusals, the
// unknown-option scan, the legacy-layout check and the run-lock refusal — a
// retired command has no flags, directory or lock semantics left to honor.
if (command === "check") {
  console.error(
    `check is retired: the principle scan and the reference check were removed; ${shellProfile().bin} fix --dryrun <dir> lists the configuration findings`,
  )
  process.exit(1)
}

// Unknown-option interception: every flag outside the whitelist is an error
// with exit 1, so a typo is never silently ignored. Constitutional and
// historical options have their own refusal messages on init/run/plan and are
// waved through here for those to handle; close accepts only its four flags,
// and everything else (constitutional options and -p/--file included) is
// refused below in the close branch with close's own messages; status takes
// no options at all — any flag is refused.
// models (auto-core plans/0055 §9) joins them: it only reads and prints.
// --append is plan's alone (auto-core plans/0053 D23): appending tasks to the
// current phase is a plan route, so every other command refuses the flag with
// a pointer to plan — run's -p/--file refusal pattern — before any whitelist
// or command block runs.
if (command !== "plan" && flags.has("append")) {
  console.error(`--append is a plan option: ${command ?? "this command"} takes no --append. Append tasks with opencode-auto plan <dir> --append -p <text> | --file <path>`)
  process.exit(1)
}
// --force-close is plan's alone too (auto-core plans/0053 D28): closing a unit
// and continuing planning in the same process is a plan route, so every other
// command refuses the flag with a pointer to plan — run's -p/--file refusal
// pattern — before any whitelist or command block runs (close keeps its own
// positional ref).
if (command !== "plan" && flags.has("force-close")) {
  console.error(
    `--force-close is a plan option: ${command ?? "this command"} takes no --force-close. ` +
      `Close a unit and keep planning with opencode-auto plan <dir> --force-close <ref> --reason <text>; to only close, opencode-auto close <ref> [dir] --reason <text>`,
  )
  process.exit(1)
}
// --scaffold is plan's alone too (plans/0081 D12): printing the active pack's
// planning-input scaffold is a plan route; every other command refuses the
// flag with a pointer to plan, the same pattern as --append above.
if (command !== "plan" && flags.has("scaffold")) {
  console.error(
    `--scaffold is a plan option: ${command ?? "this command"} takes no --scaffold. Print the planning-input template with opencode-auto plan <dir> --scaffold`,
  )
  process.exit(1)
}
// --new-task is plan's alone too (auto-core plans/0058): adding a task the
// person names, with no session, is a plan route; every other command refuses
// the flag with a pointer to plan, the same pattern as --append above.
if (command !== "plan" && flags.has("new-task")) {
  console.error(`--new-task is a plan option: ${command ?? "this command"} takes no --new-task. Add a known task without a session with opencode-auto plan <dir> --new-task "<one-line title>"`)
  process.exit(1)
}

// --export/--adopt are plan's alone too (plans/0076, T-137): the standalone
// work-order routes — rendering a ready unit's prompt for a session outside
// the driver, and closing that unit out — are plan prelude rows, so every
// other command refuses the flags with a pointer to plan, the same pattern
// as --new-task above.
if (command !== "plan" && (flags.has("export") || flags.has("adopt"))) {
  const flag = flags.has("export") ? "--export" : "--adopt"
  console.error(
    `${flag} is a plan option: ${command ?? "this command"} takes no ${flag}. ` +
      `Render a ready unit's standalone work order with opencode-auto plan <dir> --export <task id>, and close the externally-driven unit out with opencode-auto plan <dir> --adopt <task id>`,
  )
  process.exit(1)
}
// --keep/--abandon are land's alone (plans/0074 §2.3, U-L2): the mid-round
// retain and the undo path of the branch-isolation landing; every other
// command refuses them with a pointer to land, the same pattern as --append
// above, before any whitelist or command block runs.
if (command !== "land" && (flags.has("keep") || flags.has("abandon"))) {
  console.error(
    `--keep and --abandon are land options: ${command ?? "this command"} takes neither. ` +
      `Land a round's isolation branches with opencode-auto land <dir> [--keep | --abandon]`,
  )
  process.exit(1)
}
// Retired flags are usage errors with their own notice (the --commit false
// retirement set the pattern; the whole flag joined the table when its config
// key went), let through the whitelist so the notice replaces "unknown
// option": the completion-side mechanisms (plans/0044 D13), the migration
// parameters — intent, not configuration (plans/0052 D1) — init's m-mode
// planning shortcut, whose session is now plan's (plans/0053 D13), and init's
// -p and --amend, since init writes the config layer only (plans/0053 D31:
// the brief is edited by hand, per-key revision is the amend command's). An
// entry is a notice string (retired on every command) or { command, notice } (that command alone): -p stays plan's input — init's own -p is retired with the config-only init, and the `continue` command that took the per-round brief is retired ahead of every flag — so the entry stays scoped to init; --amend has no live command left and retires everywhere, one notice naming `amend <dir> --<key> <value>` (replacing run/plan's "init-only option" refusal and the amend command's "redundant" note: same exit 1, one wording).
// AUTO-DECISION (scoping): command-scoped entries here rather than a second init-only refusal inside the init block — the generic loop fires ahead of every command block, staying ordering-safe with the whitelist, the per-command refusals and the close whitelist pass-through.
const COMPLETION_RETIRED =
  "is retired: the driver no longer runs task-level acceptance, quality review or a final review. " +
  'Plan the checking as tasks (for example the v acceptance phase); a task report whose result line reads "Result: FAIL" stops the run'
const MIGRATION_RETIRED =
  "is retired: the migration source and target are intent, not configuration — state them in the project brief (opencode-auto init <dir> --brief <text> | --brief-file <path>, likewise amend) or in the planning input, which planning sessions read"
const IMPLEMENT_RETIRED = "is retired: plan tasks with opencode-auto plan <dir> -p <text> | --file <path> (after plan establishes the round and its setup is committed)"
const INIT_PROMPT_RETIRED =
  "is retired: init takes no prompt — the optional brief seed is --brief <text> | --brief-file <path> (written verbatim to .opencode/auto/brief.md), and the planning input is plan -p"
const AMEND_FLAG_RETIRED =
  "is retired: init is the stateless full overwrite; to change individual keys use opencode-auto amend <dir> --<key> <value>"
const COMMIT_FLAG_RETIRED =
  "is retired: committing cannot be turned off — the driver commits all changes after every session ends (unified commits are the " +
  "completion condition). A stored commit: true in .opencode/auto/config.json still loads and is ignored; any other stored value " +
  "fails loading (opencode-auto fix <dir> drops the key)"
const RETIRED_FLAGS: Record<string, string | { command: string; notice: string }> = {
  commit: COMMIT_FLAG_RETIRED,
  verify: COMPLETION_RETIRED,
  review: COMPLETION_RETIRED,
  early: COMPLETION_RETIRED,
  "early-review": COMPLETION_RETIRED,
  "final-review": COMPLETION_RETIRED,
  "source-dir": MIGRATION_RETIRED,
  "source-path": MIGRATION_RETIRED,
  "dest-dir": MIGRATION_RETIRED,
  "implement-file": IMPLEMENT_RETIRED,
  "implement-prompt": IMPLEMENT_RETIRED,
  prompt: { command: "init", notice: INIT_PROMPT_RETIRED },
  amend: AMEND_FLAG_RETIRED,
}
const KNOWN_FLAGS = new Set([...VALUE_FLAGS, ...BOOLEAN_FLAGS, ...Object.keys(RETIRED_FLAGS), "continue", "commit-subtask", "verify-idle", "verify-max"])
// The config flags: the project attributes init freezes into config.json and
// amend changes one by one (plans/0052 D25); run refuses every one of them.
const CONFIG_FLAGS = ["mode", "agent", "context-limit", "subtask", "idle-time", "idle-max", "test-by-driver", "handover-test", "auto-number", "no-auto-number", "wrapup", "no-wrapup", "phases", "parallel", "scan-exempt", "isolate", "intent"]
// models takes exactly one option: --probe (§9's opt-in probe, which starts
// agents and spends tokens); status stays flagless.
const MODELS_FLAGS = new Set(["probe"])
const FLAGLESS = command === "status" || command === "models"
// reset is de-initialization with nothing to configure: it accepts only
// -f/--force (skipping the confirmation and the worktree cleanliness gate).
// fix takes its baseline from the existing config and no config flags, so it
// accepts the same plus --dryrun (plans/0052 D11; the read-only listing of
// the findings, no write-side gates).
const RESET_FLAGS = new Set(["force"])
// close (auto-core plans/0053 D22) takes only its four flags: --reason (a
// value flag) and the booleans --cascade, --commit-changes, --stash-changes.
// Everything else is refused with a close-appropriate message below — the
// config flags with the frozen-by-init notice, -p/--file with plan's input
// notice — mirroring RESET_FLAGS for reset/fix.
const CLOSE_FLAGS = new Set(["reason", "cascade", "commit-changes", "stash-changes"])
// land (plans/0074 §2.3, U-L2) takes only its three: the booleans --keep
// (retain the round branch: a mid-round landing), --abandon (discard it: the
// undo path) and --merge (the explicit merge-commit landing mode; a boolean
// here — _lane's --merge <branch> value flag of the same name is the hidden
// machine surface, checked below for the swallowed-value trap). Everything
// else is refused with a land-appropriate message, mirroring CLOSE_FLAGS.
const LAND_FLAGS = new Set(["keep", "abandon", "merge"])
for (const key of flags.keys()) {
  if (command === "reset" || command === "fix") {
    // fix accepts --dryrun beside -f/--force (reset does not)
    if (RESET_FLAGS.has(key) || (command === "fix" && key === "dryrun")) continue
    console.error(`unknown option --${key}: ${command} only accepts a directory argument${command === "fix" ? ", -f/--force and --dryrun" : " and -f/--force"}`)
    process.exit(1)
  }
  if (command === "close") {
    if (CLOSE_FLAGS.has(key)) continue
    // --commit keeps its close-specific refusal ahead of the generic
    // retirement notice below: it takes a value, so it would swallow whatever
    // follows it, and what a close caller means by it is the dirty-worktree
    // pair (auto-core plans/0053 D20/F8).
    if (key === "commit") {
      console.error(
        "--commit is retired (committing cannot be turned off — the driver commits after every session) and it takes a value, so it would swallow whatever follows it; " +
          "the close options for a dirty worktree are --commit-changes and --stash-changes",
      )
      process.exit(1)
    }
    // Globally retired flags keep their own notices below (they exit there);
    // a scoped entry (init's -p) does not fire for close, so it must not be
    // waved through here either — close's own refusals take it.
    if (typeof RETIRED_FLAGS[key] === "string") continue
    if (CONFIG_FLAGS.includes(key)) {
      console.error(`${key === "mode" ? "-m/--mode" : `--${key}`} was frozen by init (.opencode/auto/config.json). To change: ${amendHint(key)}, or edit that file directly; close takes no config options`)
      process.exit(1)
    }
    if (key === "prompt" || key === "file") {
      console.error(`${key === "prompt" ? "-p/--prompt" : "--file"} is a plan option (the planning input: opencode-auto plan <dir> -p <text> | --file <path>); close takes no planning input`)
      process.exit(1)
    }
    const similar = key ? [...KNOWN_FLAGS].filter((name) => name.startsWith(key)).map((name) => `--${name}`) : []
    console.error(`--${key} is not a close option${similar.length ? ` (did you mean ${similar.join(" / ")}?)` : ""}: close takes only --reason <text>, --cascade, --commit-changes and --stash-changes (usage: opencode-auto close <ref> [dir] --reason <text>)`)
    process.exit(1)
  }
  if (command === "land") {
    if (LAND_FLAGS.has(key)) continue
    // Globally retired flags keep their own notices below (they exit there);
    // a scoped entry (init's -p) does not fire for land, so it must not be
    // waved through here either — land's own refusals take it.
    if (typeof RETIRED_FLAGS[key] === "string") continue
    if (CONFIG_FLAGS.includes(key)) {
      console.error(`${key === "mode" ? "-m/--mode" : `--${key}`} was frozen by init (.opencode/auto/config.json). To change: ${amendHint(key)}, or edit that file directly; land takes no config options`)
      process.exit(1)
    }
    if (key === "prompt" || key === "file") {
      console.error(`${key === "prompt" ? "-p/--prompt" : "--file"} is a plan option (the planning input: opencode-auto plan <dir> -p <text> | --file <path>); land takes no planning input`)
      process.exit(1)
    }
    const similar = key ? [...KNOWN_FLAGS].filter((name) => name.startsWith(key)).map((name) => `--${name}`) : []
    console.error(`--${key} is not a land option${similar.length ? ` (did you mean ${similar.join(" / ")}?)` : ""}: land takes only --keep, --abandon and --merge (usage: opencode-auto land [dir] [--keep] [--abandon] [--merge])`)
    process.exit(1)
  }
  if (command === "models") {
    if (MODELS_FLAGS.has(key)) continue
    console.error(`unknown option --${key}: models takes only --probe (a directory argument and no other options)`)
    process.exit(1)
  }
  if (!FLAGLESS && KNOWN_FLAGS.has(key)) continue
  const similar = !FLAGLESS && key ? [...KNOWN_FLAGS].filter((name) => name.startsWith(key)).map((name) => `--${name}`) : []
  console.error(`unknown option --${key}${similar.length ? ` (did you mean ${similar.join(" / ")}?)` : ""}${FLAGLESS ? ": status only accepts a directory argument, no options" : "; run opencode-auto without a subcommand to see usage"}`)
  process.exit(1)
}
for (const [key, entry] of Object.entries(RETIRED_FLAGS)) {
  if (!flags.has(key)) continue
  if (typeof entry !== "string" && command !== entry.command) continue
  console.error(`--${key} ${typeof entry === "string" ? entry : entry.notice}`)
  process.exit(1)
}

// close (auto-core plans/0053 D22): the ref is required, so it comes first —
// positional[0] is the unit ref (R-NN | R-NN.P<nn> | T-NNN, closeUnit's
// canonical shapes) and positional[1] the directory, overriding the global
// directory rule for this command. The shape check is what makes the split
// safe: a positional[0] that is not a ref means the ref is missing (the
// directory alone, the natural mistake), never a directory silently taken as
// the ref and closeUnit reading the wrong tree. closeUnit owns every
// behavioural refusal (done or closed units, another round, the m-mode
// phase, dependents, a dirty tree); the checks here are usage errors that
// fire before anything is read.
const CLOSE_REF = /^(?:R-\d{2,}|R-\d{2,}\.P\d{2,}|T-\d{3,})$/
let closeRef: string | undefined
if (command === "close") {
  const ref = positional[0]
  if (ref === undefined || !CLOSE_REF.test(ref)) {
    console.error(
      ref === undefined
        ? "close requires a unit reference: opencode-auto close <ref> [dir] --reason <text> — a round R-NN, a phase R-NN.P<nn> or a task T-NNN"
        : `${ref}: not a unit reference; expected a round R-NN, a phase R-NN.P<nn> or a task T-NNN (usage: opencode-auto close <ref> [dir] --reason <text>)`,
    )
    process.exit(1)
  }
  closeRef = ref
  const reason = flags.get("reason")
  if (reason === undefined) {
    console.error("close requires --reason <text>: the one-line reason recorded in the Closed: field, the close commit and the phase handover")
    process.exit(1)
  }
  if (!reason.trim()) {
    console.error("--reason requires non-empty text (the close reason; the explicit ref and the reason are the confirmation — close asks for no other)")
    process.exit(1)
  }
  if (reason.includes("\n")) {
    console.error("--reason must be one line (it is the Closed: value and the close commit subject's tail); longer context belongs in the round brief or the plan")
    process.exit(1)
  }
  if (flagOn("commit-changes") && flagOn("stash-changes")) {
    console.error("--commit-changes and --stash-changes are mutually exclusive: pick one way to handle the uncommitted changes (folded into the close commit, or stashed)")
    process.exit(1)
  }
}
// land's --merge is the landing-mode boolean, but --merge is also _lane's
// value flag (the parent branch a conflict repair merges; VALUE_FLAGS holds
// it for that), so a directory following land's --merge would be swallowed
// as its value and the command would run on the wrong directory. Intercept
// here, before the directory resolves: land's --merge accepts only the
// boolean forms (bare / =true / =false).
if (command === "land" && flags.has("merge")) {
  const value = flags.get("merge")
  if (value !== "" && value !== "true" && value !== "false") {
    console.error(
      `--merge here is land's landing-mode flag and takes no value (unlike _lane's --merge <branch>); ` +
        `"${value}" was swallowed as its value. Pass it bare after the directory: opencode-auto land <dir> --merge`,
    )
    process.exit(1)
  }
}
const directory = resolve(command === "close" ? positional[1] ?? "." : positional[0] ?? ".")

// fix --dryrun: list the configuration findings read-only (the replacement
// for the retired `check` as a scripted gate on config drift). It skips only
// the gates that guard writes — the clean-tree check, the confirmation and
// the run-lock refusal below — so a boolean flag here is read by both gates.
// -f/--force alongside it is accepted and inert: dryrun has no gates left to
// skip.
const fixDryrun = command === "fix" && flags.has("dryrun") && flags.get("dryrun") !== "false"

// Legacy layout (M3.7, auto-core plans/0047 R3): an old-layout project is a
// usage error before init/amend/plan/close/fix writes anything, status
// reads anything or run starts (runAll, planPrelude and closeUnit repeat the
// check for other shells). fix used to stay available so an old tree could
// still be repaired, and `check` ran on one — but the driver refuses an old
// layout everywhere else, so the repair had no consumer, and with `check`
// retired its legacy-layout exemption ended: `fix --dryrun`, the gate that
// replaced it, refuses the layout like every other live command. Only reset
// stays available, so an old tree can still be de-initialized.
if (command === "init" || command === "amend" || command === "plan" || command === "close" || command === "land" || command === "fix" || command === "status" || command === "run") {
  const legacy = await legacyLayoutProblem(directory)
  if (legacy) {
    console.error(legacy)
    process.exit(1)
  }
}

// The run lock (auto-core plans/0053 D3): these commands write what a running
// driver reads (config.json, the agent contract, the AGENTS.md block, the round
// setup), so they refuse while another process holds .auto/run.lock; -f does
// not override it. run takes the lock inside runAll; plan and close take it
// themselves — plan before its prelude (re-entered through runAll), close
// around closeUnit — so neither joins this refusal list. fix --dryrun reads
// and prints only, so it runs beside a live run (the one write-side gate it
// skips). (`continue` and `check` used to refuse here too; both retired ahead
// of every check, their notices above.)
if (command === "init" || command === "amend" || command === "reset" || (command === "fix" && !fixDryrun)) {
  const holder = liveRunLock(directory)
  if (holder) {
    for (const line of lockLines(directory, holder)) console.error(line)
    process.exit(1)
  }
}

if (command === "run") {
  refuseFrozenFlags("run")
  // The planning input is plan's (auto-core plans/0053 D14): run never reads
  // it, so it is refused rather than silently ignored.
  for (const key of ["prompt", "file"]) {
    if (flags.has(key)) {
      console.error(
        `${key === "prompt" ? "-p/--prompt" : "--file"} is a plan option: run takes no planning input. Plan with opencode-auto plan <dir> -p <text> | --file <path>, then run`,
      )
      process.exit(1)
    }
  }
  const session = parseSessionFlags()
  const waitBetween = parseMinutes(flags.get("wait-between"))
  if (waitBetween === null) {
    console.error("--wait-between takes 1..60 (minutes); defaults to 1 when given without a value")
    process.exit(1)
  }
  // --max-sessions (auto-core plans/0046 D9; live since plans/0068 S3/D10):
  // concurrent AI sessions of the task loop. Above 1 the project needs a
  // parallel level (config parallel, init --parallel) — the check sits after
  // the config load below. Unrelated to --agent.
  const maxSessions = parseMaxSessions(flags.get("max-sessions"))
  if (maxSessions === null) {
    console.error("--max-sessions takes a positive integer (concurrent AI sessions, unrelated to --agent); defaults to 1")
    process.exit(1)
  }
  // --repair (auto-core plans/0079 §4): the bounded repair budget — how many
  // automatic repair rounds a FAIL verdict (the task loop closes the task and
  // appends rework) or a held verdict gate (a gate-evidence append) may drive
  // before blocking for the human. Absent = none: the first FAIL blocks,
  // today's behavior.
  const repair = parseRepairBudget(flags.get("repair"))
  if (repair === null) {
    console.error("--repair takes 1..10 (automatic repair rounds before blocking for the human); defaults to none")
    process.exit(1)
  }
  startRunLog(directory, session)
  const { config, mode } = await loadRunConfig(directory)
  if (maxSessions > 1 && !config.parallel) {
    console.error(`--max-sessions ${maxSessions}: concurrent execution needs a parallel level — set one with init --parallel low|medium|high (planning then arranges the tasks for it) and re-run`)
    process.exit(1)
  }
  await logRunBanner(directory, config)
  const code = await runAll(directory, {
    ...runOptions(config, mode, session),
    waitBetween,
    dryrun: flags.has("dryrun") && flags.get("dryrun") !== "false",
    maxSessions,
    repair,
  })
  process.exit(code)
}

// `_lane <dir> --unit <id> [--merge <branch>]` (hidden, auto-core plans/0068
// §6.4/D2): the lane worker entry the parent run's default lane launcher
// re-invokes this CLI with — a machine surface, never a person's (absent from
// the usage text; the shell contract's §E obligation makes providing it part
// of being a shell). It loads the project config like run (the worktree
// received it by the scaffolding copy), then runs the one unit through
// runLaneWorker, which writes the lane report the parent reads after this
// process exits. Session flags take their defaults; everything the lane needs
// beyond them rides the copied scaffolding and the inherited environment.
// --merge (D7's conflict path) rides only a conflict repair's re-dispatch:
// the parent's current main branch the lane merges into its branch first.
if (command === "_lane") {
  const unit = flags.get("unit")
  if (!unit) {
    console.error("_lane requires --unit <task id> (the unit this lane worker runs); it is the entry the parent run's lane launcher invokes")
    process.exit(1)
  }
  const merge = flags.get("merge")
  const session = parseSessionFlags()
  startRunLog(directory, session)
  const { config, mode } = await loadRunConfig(directory)
  await logRunBanner(directory, config)
  process.exit(await runLaneWorker(directory, { ...runOptions(config, mode, session), lane: { unit, ...(merge !== undefined ? { merge } : {}) } }))
}

// plan (auto-core plans/0053 D14, D23, D28; --new-task plans/0058): plan the
// current phase and stop before execution, for review. It is run with a stop
// condition: the same options (the builder is shared), preceded by the prelude
// that settles every route needing no agent — establishing a round, the
// round-close gate before the next one, the notices and the input refusals
// (planPrelude, D4), and the no-session task add of --new-task. Order: the
// flags and the planning input, then --append (which rides an input and
// appends the tasks it plans to the current phase) and --new-task (which
// takes neither), then --force-close (D28: close a unit and keep planning in
// this process), the strict config load and the mode check, then the run lock
// ("plan", held across a force-close, the prelude and the loop; runAll
// re-enters it), the prelude, and runAll.
// A prelude stop prints its lines and exits with its code; runAll's exit
// codes are run's.
if (command === "plan") {
  refuseFrozenFlags("plan")
  // run's options for the task loop: plan stops before any task runs.
  for (const [key, flag, what] of [
    ["dryrun", "--dryrun", "the permission preflight: opencode-auto run <dir> --dryrun"],
    ["wait-between", "--wait-between", "the pause between tasks, and plan runs none"],
    ["max-sessions", "--max-sessions", "concurrent sessions of the task loop"],
    ["repair", "--repair", "the bounded repair budget for FAIL verdicts"],
  ] as const) {
    if (flags.has(key)) {
      console.error(`${flag} is a run option (${what}); plan does not accept it`)
      process.exit(1)
    }
  }
  // --force-close <ref> (auto-core plans/0053 D28): close a unit, then keep
  // planning in this process — replace a task (--force-close T-005 --reason
  // "…" --append -p "do X instead") or skip a phase into the next one
  // (--force-close R-01.P02 --reason "…"). The argument checks mirror close's
  // (D22) so both commands validate the same flag set: the three canonical
  // ref shapes — a subtask-shaped ref stops here as a usage error naming the
  // shapes, like close, keeping closeUnit's friendlier "close the task
  // instead" refusal for core-level callers — the required non-empty
  // one-line --reason, and the mutually exclusive change pair. They fire
  // before the lock and before the input is read.
  const forceClose = flags.get("force-close")
  if (forceClose !== undefined) {
    if (!forceClose) {
      console.error("--force-close requires a unit reference: a round R-NN, a phase R-NN.P<nn> or a task T-NNN (usage: opencode-auto plan <dir> --force-close <ref> --reason <text>)")
      process.exit(1)
    }
    if (!CLOSE_REF.test(forceClose)) {
      console.error(`${forceClose}: not a unit reference; expected a round R-NN, a phase R-NN.P<nn> or a task T-NNN (usage: opencode-auto plan <dir> --force-close <ref> --reason <text>)`)
      process.exit(1)
    }
    const reason = flags.get("reason")
    if (reason === undefined) {
      console.error("--force-close requires --reason <text>: the one-line reason recorded in the Closed: field, the close commit and the phase handover")
      process.exit(1)
    }
    if (!reason.trim()) {
      console.error("--reason requires non-empty text (the close reason; the explicit ref and the reason are the confirmation — neither command asks for another)")
      process.exit(1)
    }
    if (reason.includes("\n")) {
      console.error("--reason must be one line (it is the Closed: value and the close commit subject's tail); longer context belongs in the round brief or the plan")
      process.exit(1)
    }
    if (flagOn("commit-changes") && flagOn("stash-changes")) {
      console.error("--commit-changes and --stash-changes are mutually exclusive: pick one way to handle the uncommitted changes (folded into the close commit, or stashed)")
      process.exit(1)
    }
  } else {
    // AUTO-RESOLVE: should plan accept the close-family flags
    // (--reason/--cascade/--commit-changes/--stash-changes) without
    // --force-close, silently ignoring them as it did before D28? -> no:
    // they are usage errors pointing at --force-close (silently ignoring a
    // close attempt would let a person believe a unit was closed when
    // nothing happened; "validate both commands' flag sets" only makes sense
    // when the group is meaningful, which is under --force-close alone).
    for (const key of ["reason", "cascade", "commit-changes", "stash-changes"]) {
      if (flags.has(key)) {
        console.error(
          `--${key} is a close option of "plan --force-close <ref> --reason <text>": pass --force-close <ref> to close a unit and keep planning, ` +
            `or close only with opencode-auto close <ref> [dir] --reason <text>`,
        )
        process.exit(1)
      }
    }
  }
  const input = await parsePlanInput()
  // --new-task (auto-core plans/0058): add one task the person names, with no
  // session. It takes the one-line title alone — the title becomes the index
  // line and the task document's title, longer context belongs in the
  // document after the add — and it excludes the planning input (a session
  // plans from that) and --append (a session appends from it).
  const newTask = flags.get("new-task")
  if (newTask !== undefined) {
    if (!newTask.trim()) {
      console.error("--new-task requires a one-line task title (it becomes the index line and the task document's title)")
      process.exit(1)
    }
    if (newTask.includes("\n")) {
      console.error("--new-task must be one line (it becomes the task's index line); longer context belongs in the task document — add the task, then edit its docs/T-NNN/todo.md")
      process.exit(1)
    }
    if (input) {
      console.error("--new-task and -p | --file are mutually exclusive: --new-task adds the task you name with no session; a planning input has one plan tasks from it")
      process.exit(1)
    }
  }
  // --scaffold (plans/0081 D12.2) takes no other option: it only prints the
  // planning-input template and exits.
  if (flagOn("scaffold") && (input || newTask !== undefined || forceClose !== undefined || flags.has("append") || flags.has("export") || flags.has("adopt"))) {
    console.error("--scaffold takes no other option: it prints the planning-input template to stdout and exits — complete it into a file and pass it with -p <text> | --file <path>")
    process.exit(1)
  }
  // --append (auto-core plans/0053 D23) rides a planning input: it appends
  // the tasks planned from the input to the current phase. In m mode the
  // input implies the append on a non-empty index, so the flag is redundant
  // there; the prelude and planPrelude repeat the check for other shells.
  const append = flags.has("append") && flags.get("append") !== "false"
  if (newTask !== undefined && append) {
    console.error("--new-task and --append are mutually exclusive: --new-task adds the task directly, no session appends anything (drop --append, or plan from an input instead)")
    process.exit(1)
  }
  if (append && !input) {
    console.error("--append requires a planning input: pass -p <text> | --file <path>; it appends the tasks planned from the input to the current phase")
    process.exit(1)
  }
  // --export / --adopt <T-NNN> (plans/0076, T-137): the standalone work-order
  // routes. The unit of a work order is a task; the two flags are mutually
  // exclusive (one renders, one closes), and neither plans from an input,
  // appends, hand-adds a task or closes a unit — the exclusions mirror
  // --new-task's, checked here before the lock; planPrelude backstops other
  // shells and direct callers.
  const exportRef = flags.get("export")
  const adoptRef = flags.get("adopt")
  if (exportRef !== undefined || adoptRef !== undefined) {
    for (const [flag, value] of [
      ["export", exportRef],
      ["adopt", adoptRef],
    ] as const) {
      if (value === undefined) continue
      if (!/^T-\d+$/.test(value)) {
        console.error(`--${flag} requires a task id (usage: opencode-auto plan <dir> --${flag} T-NNN); a work order is rendered for one task unit of the current phase`)
        process.exit(1)
      }
    }
    if (exportRef !== undefined && adoptRef !== undefined) {
      console.error("--export and --adopt are mutually exclusive: --export renders a ready unit's work order for a standalone session, --adopt closes one out — run them one at a time")
      process.exit(1)
    }
    if (input) {
      console.error("--export / --adopt and -p | --file are mutually exclusive: a standalone work order is rendered for an existing task, no session plans from the input")
      process.exit(1)
    }
    if (append) {
      console.error("--export / --adopt and --append are mutually exclusive: appending plans tasks with a session; a work order neither plans nor appends")
      process.exit(1)
    }
    if (newTask !== undefined) {
      console.error("--export / --adopt and --new-task are mutually exclusive: --new-task adds a task with no session; --export / --adopt render or close one that exists")
      process.exit(1)
    }
    if (forceClose !== undefined) {
      console.error("--export / --adopt and --force-close are mutually exclusive: --force-close closes a unit and keeps planning in this process; a work order route does neither")
      process.exit(1)
    }
  }
  const session = parseSessionFlags()
  // plan writes the round setup, which follows the config (phases): a
  // directory init never configured is refused rather than planned with the
  // defaults.
  if (!(await Bun.file(join(directory, CONFIG_FILE)).exists())) {
    const legacy = await legacyModeFallback(directory)
    console.error(
      `nothing to plan: ${directory} has no ${CONFIG_FILE}; run opencode-auto init ${directory} first` +
        (legacy !== undefined ? ` (or opencode-auto fix ${directory}, which writes it from the legacy .auto/config.json mode "${legacy}")` : ""),
    )
    process.exit(1)
  }
  // --scaffold (plans/0081 D12.2): print the active pack's planning-input
  // scaffold to stdout and exit 0 — nothing written into the target, the
  // verbatim-input contract untouched (no stub file a git clean or a planning
  // step could mistake for input). The person completes it into a file and
  // runs plan --file <path>. Read-only, so it runs before the lock.
  if (flagOn("scaffold")) {
    const { config: scaffoldConfig } = await loadRunConfig(directory)
    const scaffold = planningInputScaffold(loadIntents(directory), scaffoldConfig.intent ?? "default")
    if (scaffold === undefined) {
      console.error("no planning-input scaffold: neither the active intent pack nor the default pack carries a ## planning-input section")
      process.exit(1)
    }
    console.log(scaffold)
    process.exit(0)
  }
  const { config, mode } = await loadRunConfig(directory)
  const lock = acquireRunLock(directory, "plan")
  if (!lock.ok) {
    for (const line of lockLines(directory, lock.holder)) console.error(line)
    process.exit(1)
  }
  // --force-close (auto-core plans/0053 D28): one lock held across the close
  // and the planning — the lock above, not a second one. closeUnit's lines
  // print first (stdout when closed, stderr otherwise); a refused close exits
  // 1 with nothing done (closeUnit refuses before writes), a failed close
  // commit or close-out check exits 2, and a successful close falls through
  // to the normal plan flow (prelude → runAll), whose exit code is plan's.
  if (forceClose !== undefined) {
    const changes: CloseChanges | undefined = flagOn("commit-changes") ? "commit" : flagOn("stash-changes") ? "stash" : undefined
    const closed = await closeUnit(directory, forceClose, {
      reason: flags.get("reason")!,
      cascade: flagOn("cascade"),
      changes,
      phases: config.phases,
      acceptanceGate: config.acceptanceGate,
    })
    for (const line of closed.lines) (closed.type === "closed" ? console.log : console.error)(line)
    if (closed.type !== "closed") {
      lock.release()
      process.exit(closed.type === "refused" ? 1 : 2)
    }
  }
  const prelude = await planPrelude(directory, {
    phases: config.phases,
    build: config.build,
    scanExempt: config.scanExempt,
    isolate: config.isolate,
    input,
    append,
    newTask,
    autoNumber: config.autoNumber,
    // The work-order routes (plans/0076): the render inputs from the config
    // (the same fields runOptions threads into a run), plus the script
    // watchdog adopt's test handover runs under.
    export: exportRef,
    adopt: adoptRef,
    mode,
    testByDriver: config.testByDriver,
    handoverTest: config.handoverTest,
    idleMs: config.idleTime * 60_000,
    maxMs: config.idleMax > 0 ? config.idleMax * 60_000 : undefined,
  })
  if (prelude.type === "stop") {
    for (const line of prelude.lines) (prelude.code === 0 ? console.log : console.error)(line)
    lock.release()
    process.exit(prelude.code)
  }
  startRunLog(directory, session)
  await logRunBanner(directory, config)
  const code = await runAll(directory, { ...runOptions(config, mode, session), stopBefore: "execute", planInput: input, append })
  lock.release()
  process.exit(code)
}

// close (auto-core plans/0053 D22): close a unit — a task T-NNN, a phase
// R-NN.P<nn> or a round R-NN — without completing it: done for scheduling,
// never delivered, the reason recorded in a Closed: field, the close commit
// and (for a phase) the driver-written mechanical handover. The explicit ref
// and the required --reason are the confirmation, so there is no prompt, and
// everything is reversible: the undo is `git revert` of the close commit,
// printed in the output. The argument checks (ref shape, reason, the change
// pair) ran above with the ref/directory split; closeUnit owns every
// behavioural refusal. Exit codes: 0 closed; 1 refused or usage error; 2 the
// close commit or the close-out check failed.
// AUTO-DECISION (config load): reuse loadRunConfig, the strict load run and
// plan share, instead of a phases/acceptanceGate-only reader. close needs
// config.phases (the m-mode round/phase refusal) and config.acceptanceGate
// (the skipped-gates record); the shared load adds only the mode check and
// the fixHint, and a config that cannot load strictly leaves nothing to close
// into — one strict loader is easier to keep honest than a second lighter
// one. Like plan, a directory without config.json is refused outright rather
// than closing with default values.
if (command === "close") {
  if (!(await Bun.file(join(directory, CONFIG_FILE)).exists())) {
    const legacy = await legacyModeFallback(directory)
    console.error(
      `nothing to close: ${directory} has no ${CONFIG_FILE}; run opencode-auto init ${directory} first` +
        (legacy !== undefined ? ` (or opencode-auto fix ${directory}, which writes it from the legacy .auto/config.json mode "${legacy}")` : ""),
    )
    process.exit(1)
  }
  const { config } = await loadRunConfig(directory)
  // close holds the run lock itself (D3), so it is not in the refusal list
  // above; status shows a live lock while this runs.
  const lock = acquireRunLock(directory, "close")
  if (!lock.ok) {
    for (const line of lockLines(directory, lock.holder)) console.error(line)
    process.exit(1)
  }
  const changes: CloseChanges | undefined =
    flagOn("commit-changes") ? "commit" : flagOn("stash-changes") ? "stash" : undefined
  const result = await closeUnit(directory, closeRef!, {
    reason: flags.get("reason")!,
    cascade: flagOn("cascade"),
    changes,
    phases: config.phases,
    acceptanceGate: config.acceptanceGate,
  })
  lock.release()
  for (const line of result.lines) (result.type === "closed" ? console.log : console.error)(line)
  process.exit(result.type === "closed" ? 0 : result.type === "refused" ? 1 : 2)
}

// land (plans/0074 §2.3, U-L2, ruled 2026-10-04 §5): the person-invoked
// return path of branch isolation — land each designated nested repository's
// round of work (its auto/R-NN branch) back onto its original branch as one
// commit (default squash; --merge the explicit merge-commit alternative),
// delete the round branch (--keep retains it: a mid-round landing, the branch
// simply continues), print the landed SHA. --abandon discards the round
// branch after a person-reviewed reset — the undo path; nothing lands.
// Refusal is never an automated merge resolution: a moved original branch,
// foreign commits in the round branch's range, a dirty repository or an
// ambiguous original branch block (exit 2) naming what to settle. The
// audit-trail trade-off: one commit on the deliverable, the full per-unit
// trail stays in the driven root's git (the 0064 record model).
// Exit codes under the contract: 0 landed / 1 usage / 2 blocked for human.
// The argument checks above (the land whitelist, the boolean --merge form,
// --keep/--abandon being land's alone) ran before the directory resolved;
// landUnit owns every behavioural refusal and returns the complete printable
// output, close's shape. Like close, land holds the run lock itself (the
// branches it moves are what a running driver commits to), so it is not in
// the refusal list above.
if (command === "land") {
  if (flagOn("keep") && flagOn("abandon")) {
    console.error("--keep and --abandon are mutually exclusive: --keep retains auto/R-NN for a mid-round landing, --abandon discards it as the undo path")
    process.exit(1)
  }
  if (flagOn("merge") && flagOn("abandon")) {
    console.error("--merge is a landing mode and --abandon lands nothing: drop one of the two")
    process.exit(1)
  }
  if (!(await Bun.file(join(directory, CONFIG_FILE)).exists())) {
    const legacy = await legacyModeFallback(directory)
    console.error(
      `nothing to land: ${directory} has no ${CONFIG_FILE}; run opencode-auto init ${directory} first` +
        (legacy !== undefined ? ` (or opencode-auto fix ${directory}, which writes it from the legacy .auto/config.json mode "${legacy}")` : ""),
    )
    process.exit(1)
  }
  let config: ProjectConfig
  try {
    config = await loadProjectConfig(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    const hint = await fixHint(directory)
    if (hint) console.error(hint)
    process.exit(1)
  }
  const lock = acquireRunLock(directory, "land")
  if (!lock.ok) {
    for (const line of lockLines(directory, lock.holder)) console.error(line)
    process.exit(1)
  }
  const landed = await landUnit(directory, {
    isolate: config.isolate ?? [],
    keep: flagOn("keep"),
    abandon: flagOn("abandon"),
    merge: flagOn("merge"),
  })
  lock.release()
  for (const line of landed.lines) (landed.type === "landed" ? console.log : console.error)(line)
  process.exit(landed.type === "landed" ? 0 : landed.type === "usage" ? 1 : 2)
}

// The amend hint of one config flag: how a person changes a key init froze.
// Shared by run/plan's frozen-flag refusal and close's whitelist, so the hint
// for a key is written once.
function amendHint(key: string): string {
  if (key === "auto-number" || key === "no-auto-number") return "opencode-auto amend <dir> --auto-number (use --no-auto-number to turn off)"
  if (key === "wrapup" || key === "no-wrapup") return "opencode-auto amend <dir> --wrapup (use --no-wrapup to turn off)"
  return `opencode-auto amend <dir> ${key === "mode" ? "-m" : `--${key}`} <value>`
}

// A boolean flag's on-state: present and not explicitly false. Shared by the
// close and plan --force-close argument checks and option reads.
function flagOn(key: string): boolean {
  return flags.has(key) && flags.get(key) !== "false"
}

// The options run and plan refuse alike (auto-core plans/0053 D14). Frozen
// options (design document §C): the constitutional project attributes are
// frozen by init into .opencode/auto/config.json — their presence at run time
// is a usage error (mirroring the existing --commit-subtask removal
// precedent); revision goes through amend (plans/0052 D25) or direct edits of
// the config file. The watchdog keys were renamed from --verify-idle/
// --verify-max to --idle-time/--idle-max (now governing the test-script
// watchdog); the old names get their own rename notice.
function refuseFrozenFlags(command: "run" | "plan") {
  for (const key of ["verify-idle", "verify-max"]) {
    if (flags.has(key)) {
      const renamed = key === "verify-idle" ? "idle-time" : "idle-max"
      console.error(`--${key} was renamed to --${renamed} (the driver-run script watchdog). To change: opencode-auto amend <dir> --${renamed} <value>, or edit .opencode/auto/config.json directly`)
      process.exit(1)
    }
  }
  for (const key of CONFIG_FLAGS) {
    if (flags.has(key)) {
      console.error(`${key === "mode" ? "-m/--mode" : `--${key}`} was frozen by init (.opencode/auto/config.json). To change: ${amendHint(key)}, or edit that file directly`)
      process.exit(1)
    }
  }
  if (flags.has("commit-subtask")) {
    console.error("--commit-subtask removed: commits are now made by the driver after every session ends (AI commit rights revoked), and can no longer be turned off (--commit false is retired)")
    process.exit(1)
  }
  // --amend is retired everywhere (RETIRED_FLAGS above: once init stopped
  // taking the flag, no command accepts it).
  // --brief/--brief-file are init/amend's alone (plans/0081 D11): the project
  // brief's seed/revision channel; run and plan never write it, so they
  // refuse the pair rather than silently ignoring it.
  for (const key of ["brief", "brief-file"]) {
    if (flags.has(key)) {
      console.error(
        `--${key} is an init/amend option (the project brief: opencode-auto init <dir> --${key} <text or path>, likewise amend); ${command} does not accept it`,
      )
      process.exit(1)
    }
  }
  // --name/--email are init's alone (plans/0073 §2.2): the commit identity
  // pair init writes as repository-local git config when no global/GIT_*
  // identity resolves; run and plan never write git config, so they refuse
  // the pair rather than silently ignoring it.
  for (const key of ["name", "email"]) {
    if (flags.has(key)) {
      console.error(
        `--${key} is an init option (paired with --${key === "name" ? "email" : "name"}: the commit identity written as repository-local git config when init bootstraps a repository without a resolving identity); ` +
          `${command} does not accept it`,
      )
      process.exit(1)
    }
  }
  // -f/--force belongs to init/reset/fix alone (it skips the overwrite
  // confirmation and the worktree cleanliness gate); run and plan write no
  // config and do no destructive overwrite, so it is meaningless there.
  if (flags.has("force")) {
    console.error(`-f/--force is an init/reset/fix option (skips the confirmation and the worktree cleanliness check); ${command} does not accept it`)
    process.exit(1)
  }
  // --continue is no command's option: opening the next round is not a
  // subcommand (`continue` is retired) but a plan route — once the round is
  // complete and ## Close is filled in and committed, plan runs the round-close
  // checks and opens the next round.
  if (flags.has("continue")) {
    console.error(
      `--continue is not an option: the next round opens with plan — once the round is complete, fill in ## Close of docs/R-NN/round.md, commit, and run ${shellProfile().bin} plan <dir> (it runs the round-close checks and opens the next round)`,
    )
    process.exit(1)
  }
}

// The session flags of run and plan (auto-core plans/0053 §2): they shape this
// run's sessions, not the project.
type SessionFlags = { verbose: boolean; interactive: boolean; waitAnswer: number; permission: PermissionMode; newSession: boolean }

function parseSessionFlags(): SessionFlags {
  const verbose = flags.has("verbose") && flags.get("verbose") !== "false"
  // --interactive/-i: foreground interactive mode (mutually exclusive with
  // --verbose); the log file keeps the full verbose-level record while the
  // foreground hides the verbose detail, and a resident stdin feeds human input
  // into the current session as a steer.
  const interactive = flags.has("interactive") && flags.get("interactive") !== "false"
  if (interactive && verbose) {
    console.error("--interactive/-i and --verbose are mutually exclusive; pick one")
    process.exit(1)
  }
  const waitAnswer = parseMinutes(flags.get("wait-answer"))
  if (waitAnswer === null) {
    console.error("--wait-answer takes 1..60 (minutes); defaults to 1 when given without a value")
    process.exit(1)
  }
  const permission = parsePermission(flags.get("permission"))
  if (permission === null) {
    console.error("--permission takes auto-allow|ask-allow|ask-deny|ask-fail; defaults to ask-deny")
    process.exit(1)
  }
  // --new-session: when resuming from an interruption, do not reuse the
  // interrupted session (it only skips reuse; exact phase re-entry is
  // unaffected).
  return { verbose, interactive, waitAnswer, permission, newSession: flags.has("new-session") && flags.get("new-session") !== "false" }
}

// plan's planning input (auto-core plans/0053 D14): the -p/--prompt text or
// the --file contents, one of the two and non-empty; undefined when neither
// is given. Checked before the lock, so a bad input writes nothing.
async function parsePlanInput(): Promise<PlanInput | undefined> {
  const text = flags.get("prompt")
  const file = flags.get("file")
  if (text !== undefined && file !== undefined) {
    console.error("-p/--prompt and --file are mutually exclusive: give the planning input one way")
    process.exit(1)
  }
  if (text !== undefined) {
    if (!text.trim()) {
      console.error("-p/--prompt requires non-empty text (the planning input)")
      process.exit(1)
    }
    return { text }
  }
  if (file === undefined) return undefined
  if (!file) {
    console.error("--file requires a path: the file holding the planning input")
    process.exit(1)
  }
  const path = resolve(file)
  const info = await stat(path).catch(() => undefined)
  if (!info?.isFile()) {
    console.error(`--file ${file}: ${info ? "not a regular file" : "no such file"}; it names the file holding the planning input`)
    process.exit(1)
  }
  const content = await Bun.file(path).text()
  if (!content.trim()) {
    console.error(`--file ${file} is empty: the planning input must not be empty`)
    process.exit(1)
  }
  return { text: content, source: path }
}

// init/amend's --brief/--brief-file (plans/0081 D11): the project brief's
// seed (init) or revision (amend) — the text verbatim, or the file holding
// it; one of the two and non-empty; undefined when neither is given.
async function parseBriefSeed(): Promise<string | undefined> {
  const text = flags.get("brief")
  const file = flags.get("brief-file")
  if (text !== undefined && file !== undefined) {
    console.error("--brief and --brief-file are mutually exclusive: give the brief one way")
    process.exit(1)
  }
  if (text !== undefined) {
    if (!text.trim()) {
      console.error("--brief requires non-empty text (the brief, written verbatim)")
      process.exit(1)
    }
    return text
  }
  if (file === undefined) return undefined
  if (!file) {
    console.error("--brief-file requires a path: the file holding the brief, written verbatim")
    process.exit(1)
  }
  const path = resolve(file)
  const info = await stat(path).catch(() => undefined)
  if (!info?.isFile()) {
    console.error(`--brief-file ${file}: ${info ? "not a regular file" : "no such file"}; it names the file holding the brief`)
    process.exit(1)
  }
  const content = await Bun.file(path).text()
  if (!content.trim()) {
    console.error(`--brief-file ${file} is empty: the brief must not be empty`)
    process.exit(1)
  }
  return content
}

// Every run (and every plan that enters the loop) starts a fresh log file
// under the target directory's .auto/logs/, recording all output
// synchronously.
function startRunLog(directory: string, session: SessionFlags) {
  setVerbose(session.verbose)
  if (session.interactive) setInteractive()
  log(`📝 log file: ${setLogFile(directory)}`)
}

// The project config (.opencode/auto/config.json) is the only source of the
// constitutional options; a broken file is an environment error with exit 1
// (strict failure beats silent fallback, with a fix hint appended). A missing
// file takes the defaults plus the legacy fallback (the mode in
// .auto/config.json, noted but never migrated). The configured mode must be
// registered.
async function loadRunConfig(directory: string): Promise<{ config: ProjectConfig; mode: ModeSpec }> {
  let config: ProjectConfig
  try {
    config = await loadProjectConfig(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    const hint = await fixHint(directory)
    if (hint) console.error(hint)
    process.exit(1)
  }
  const modes = loadModeTable(directory)
  const mode = modes[config.mode]
  if (!mode) {
    console.error(`configured mode "${config.mode}" is not registered (currently supported: ${Object.keys(modes).join(", ")}); to fix: opencode-auto amend <dir> -m <value>, or edit .opencode/auto/config.json directly`)
    process.exit(1)
  }
  return { config, mode }
}

// The banner of run and plan: the legacy-mode note, the driver-run tests line,
// the config summary and, when phased, the phase progress line.
async function logRunBanner(directory: string, config: ProjectConfig) {
  if (await legacyModeFallback(directory)) log(`ℹ mode taken from the legacy persisted value in .auto/config.json; run opencode-auto fix ${directory} to write the full config`)
  if (config.testByDriver) {
    log(
      `⚙ tests run by the driver: sessions put scripts in test/ and write the script path to tmp/test.sh to request execution; the driver merges stdout/stderr into tmp/test.<n>.out and feeds it back to the session` +
        (config.handoverTest ? "; on test failure with context at its cap, a handover document switches to a fresh session" : ""),
    )
  }
  log(`⚙ project config (.opencode/auto/config.json): ${formatProjectConfig(config)}`)
  // The phase progress line (B.2, sharing phasesLine with status; ✓ = done,
  // ▶ = current, the rest = not started); carries a round annotation when
  // rounds continue (the greatest docs/R-NN round number > 1). A missing or
  // invalid phase index only warns here — runAll's phase routing exits 1 as an
  // environment error.
  if (config.phases !== "m") log(await phasesLine(directory))
}

// The runAll options run and plan share (auto-core plans/0053 D14): the config
// init froze plus this run's session flags. run adds --wait-between, --dryrun
// and --max-sessions; plan adds its stop condition and planning input.
function runOptions(config: ProjectConfig, mode: ModeSpec, session: SessionFlags): RunAllOpts {
  return {
    // The coding agent, context budget etc. come from the config file (written
    // by init); OPENCODE_AUTO_AGENT still overrides the agent.
    agent: config.agent,
    server: flags.get("server"),
    // interactive implies the verbose log level (the watch/change-file
    // monitoring runs as usual and writes to the log).
    verbose: session.verbose || session.interactive,
    waitAnswer: session.waitAnswer,
    subtask: config.subtask,
    contextLimit: config.contextLimit * 1000,
    permission: session.permission,
    interactive: session.interactive,
    idleMs: config.idleTime * 60_000,
    maxMs: config.idleMax > 0 ? config.idleMax * 60_000 : undefined,
    mode,
    intent: config.intent,
    phases: config.phases,
    testByDriver: config.testByDriver,
    handoverTest: config.handoverTest,
    autoNumber: config.autoNumber,
    wrapup: config.wrapup,
    acceptanceGate: config.acceptanceGate,
    build: config.build,
    parallel: config.parallel,
    scanExempt: config.scanExempt,
    isolate: config.isolate,
    newSession: session.newSession,
  }
}

// --max-sessions defaults to 1; must be a positive integer — null marks an
// invalid value.
function parseMaxSessions(raw: string | undefined): number | null {
  if (raw === undefined) return 1
  const value = Number(raw)
  return /^\d+$/.test(raw) && value >= 1 ? value : null
}

// --repair defaults to 0 (no automatic repair: a FAIL verdict blocks for the
// human, today's behavior); 1..10 rounds when given — null marks an invalid
// value (a bare flag among them: the budget is never implied).
function parseRepairBudget(raw: string | undefined): number | null {
  if (raw === undefined) return 0
  const value = Number(raw)
  return /^\d+$/.test(raw) && value >= 1 && value <= 10 ? value : null
}

// --subtask absent/bare = off (the default since 2026-10-04; auto was
// plans/0059 D1's original default); null marks an invalid value. The four
// values are the core's SUBTASK_MODES (auto-core plans/0059 D1: true is the
// planned pipeline auto used to be, auto the adaptive mode).
function parseSubtask(raw: string | undefined): SubtaskMode | null {
  if (raw === undefined || raw === "") return "off"
  return (SUBTASK_MODES as readonly string[]).includes(raw) ? (raw as SubtaskMode) : null
}

// --permission absent/bare = ask-deny; null marks an invalid value.
function parsePermission(raw: string | undefined): PermissionMode | null {
  if (raw === undefined || raw === "") return "ask-deny"
  if (raw === "auto-allow" || raw === "ask-allow" || raw === "ask-deny" || raw === "ask-fail") return raw
  return null
}

// --wait-answer/--wait-between absent (no flag) = 0 (no wait); bare = the
// default 1 minute; null marks an invalid value.
function parseMinutes(raw: string | undefined): number | null {
  if (raw === undefined) return 0
  if (raw === "") return 1
  const minutes = Number(raw)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) return null
  return minutes
}

// --context-limit absent/bare = 64 (k tokens); null marks an invalid value.
function parseContextLimit(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return 64
  const limit = Number(raw)
  if (!Number.isInteger(limit) || limit < 1) return null
  return limit
}

// --idle-time absent/bare = 10 (minutes); an explicit value must be an integer
// in 1..120; null marks an invalid one.
function parseIdleTime(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return 10
  const minutes = Number(raw)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) return null
  return minutes
}

// --idle-max absent/bare = 0 (no absolute cap); an explicit value must be an
// integer in 1..1440 (minutes); null marks an invalid value.
function parseIdleMax(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return 0
  const minutes = Number(raw)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return null
  return minutes
}

// Load the mode registry (builtin plus the target directory's
// .opencode/auto/modes/ overrides); an invalid mode file prints its error and
// exits 1. Shared by init and run.
function loadModeTable(directory: string): Record<string, ModeSpec> {
  try {
    return loadModes(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

// The config flags of init/amend, parsed once (plans/0052 D25): the
// value checks, and the keys explicitly given (`explicit`, merged over the
// baseline). --agent opencode, --parallel none, --scan-exempt none and
// --isolate none are returned separately, since they drop their key instead
// of setting it. A bad value exits 1.
function parseConfigFlags(directory: string): { explicit: Partial<ProjectConfig>; phases?: string; agent?: string; parallel?: string; scanExempt?: string; isolate?: string } {
  // --agent (M6.1): the coding agent, frozen like every project attribute;
  // opencode = the key is absent from config.json.
  const agent = flags.get("agent")
  if (agent !== undefined && agent !== "opencode" && agent !== "claude") {
    console.error(`--agent takes opencode|claude (the coding agent that runs the sessions); defaults to opencode. The agent contract is always .opencode/agent/auto.md`)
    process.exit(1)
  }
  // --parallel (auto-core plans/0046 D8): planning-guidance level, frozen like
  // every project attribute; none = the key is absent from config.json.
  const parallel = flags.get("parallel")
  if (parallel !== undefined && parallel !== "none" && !(PARALLEL_LEVELS as readonly string[]).includes(parallel)) {
    console.error(`--parallel takes none|${PARALLEL_LEVELS.join("|")}; defaults to none`)
    process.exit(1)
  }
  // --scan-exempt (auto-core plans/0059 X2): comma-separated path globs the
  // driver's P1 and terminator scans skip; the list replaces the stored one,
  // none = the key is absent from config.json.
  const scanExempt = flags.get("scan-exempt")
  const exemptGlobs = scanExempt === undefined || scanExempt === "none" ? [] : splitGlobList(scanExempt)
  if (scanExempt !== undefined && scanExempt !== "none") {
    const problems = exemptGlobs.flatMap((glob) => scanExemptProblem(glob) ?? [])
    if (!exemptGlobs.length || problems.length) {
      console.error(
        `--scan-exempt takes none or a comma-separated list of path globs relative to the target directory (e.g. "test/fixtures/**,templates/prompts")` +
          `${problems.length ? `: ${problems.join("; ")}` : ""}; defaults to none`,
      )
      process.exit(1)
    }
  }
  const subtask = parseSubtask(flags.get("subtask"))
  if (subtask === null) {
    console.error(`--subtask takes ${SUBTASK_MODES.join("|")}; defaults to off`)
    process.exit(1)
  }
  const contextLimit = parseContextLimit(flags.get("context-limit"))
  if (contextLimit === null) {
    console.error("--context-limit takes a positive integer (unit: k tokens); defaults to 64")
    process.exit(1)
  }
  // --idle-time: the no-progress window of a driver-run script (the test
  // script) — terminate once its output file stops growing; --idle-max: the
  // absolute duration cap (0 = none: as long as output keeps coming, it never
  // times out).
  const idleTime = parseIdleTime(flags.get("idle-time"))
  if (idleTime === null) {
    console.error("--idle-time takes 1..120 (minutes); defaults to 10")
    process.exit(1)
  }
  const idleMax = parseIdleMax(flags.get("idle-max"))
  if (idleMax === null) {
    console.error("--idle-max takes 1..1440 (minutes); no cap by default")
    process.exit(1)
  }
  // --phases: the phased flow (design document plans/0006-phases-design.md);
  // "m" (the default) = no phase declaration, a single run, behavior unchanged.
  // The prefix guard over already-completed phases sits below (the completed
  // phases must form a prefix of the new value, so amend cannot push the flow
  // state beyond derivation).
  // Two value shapes (M3.6): the letter preset (an admtvk subsequence
  // containing m) or a comma-separated list of phase type ids (custom types
  // from .opencode/auto/phases/ allowed, implement required); the list shape is
  // normalized to a space-free comma string in the config.
  let phases: string | undefined
  if (flags.has("phases")) {
    const raw = flags.get("phases") ?? ""
    let parsed: PhaseTypeEntry[] | null
    try {
      parsed = parsePhases(raw, directory)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    }
    if (!parsed) {
      console.error(`--phases is invalid: ${phasesProblem(raw, loadPhaseTypes(directory))}`)
      process.exit(1)
    }
    phases = PRESET_FORM.test(raw) ? raw : parsed.map((entry) => entry.type).join(",")
  }
  // --isolate (plans/0074 §5.4, U-L1): branch-isolated nested repositories,
  // one path per repeated flag occurrence; the list replaces the stored one
  // (scan-exempt's semantics), none removes the key. Each path is validated
  // against the directory — an existing .git-holding directory that is not
  // the target root — so a typo is a usage error here; the config load
  // repeats the same checks for hand edits.
  // AUTO-DECISION: the flag replaces the whole list instead of adding to it
  // (and `none` clears it) — amend per key stays a one-shot statement of the
  // resulting value, the same contract --scan-exempt established; a per-key
  // add/remove pair would need two more flags for one ruling's surface.
  const isolateRaw = repeatFlags.get("isolate") ?? []
  const isolateNone = isolateRaw.length === 1 && isolateRaw[0] === "none"
  if (!isolateNone && isolateRaw.length) {
    const problems = isolateRaw.flatMap((path) => isolateProblem(directory, path) ?? [])
    if (problems.length) {
      console.error(
        `--isolate takes none or nested-repository paths relative to the target directory, one repository per repeated flag ` +
          `(e.g. --isolate packages/app --isolate tools/cli): ${problems.join("; ")}`,
      )
      process.exit(1)
    }
  }
  // Only explicitly given keys enter the merge: bare --subtask and its kin
  // take their own defaults, and options never given leave the existing config
  // alone.
  const explicit: Partial<ProjectConfig> = {}
  if (!isolateNone && isolateRaw.length) explicit.isolate = isolateRaw
  if (agent === "claude") explicit.agent = agent
  // --intent (plans/0079 §2): the active intent pack's name, frozen like
  // every project attribute. The pack-existence check sits in the command
  // block — on init the name may belong to a bundle whose pack materializes
  // before the config write.
  const intentName = flags.get("intent")
  if (intentName !== undefined && !intentName.trim()) {
    console.error("--intent takes an intent pack name (a lowercase letter followed by letters/digits/hyphens); defaults to the built-in default pack")
    process.exit(1)
  }
  if (intentName !== undefined) explicit.intent = intentName
  if (flags.has("subtask")) explicit.subtask = subtask
  if (flags.has("context-limit")) explicit.contextLimit = contextLimit
  if (flags.has("idle-time")) explicit.idleTime = idleTime
  if (flags.has("idle-max")) explicit.idleMax = idleMax
  if (phases !== undefined) explicit.phases = phases
  if (parallel !== undefined && parallel !== "none") explicit.parallel = parallel as ProjectConfig["parallel"]
  if (exemptGlobs.length) explicit.scanExempt = exemptGlobs
  // --test-by-driver / --handover-test: boolean constitutional options
  // accepted by init/amend (bare or true turns them on, false off), merged
  // through explicit (amend semantics).
  if (flags.has("test-by-driver")) explicit.testByDriver = flags.get("test-by-driver") !== "false"
  if (flags.has("handover-test")) explicit.handoverTest = flags.get("handover-test") !== "false"
  // --auto-number/--no-auto-number: a boolean on/off pair (auto numbering on
  // or off), likewise constitutional boolean options merged through explicit
  // (amend semantics); both at once contradict themselves and are a usage
  // error.
  if (flags.has("auto-number") && flags.has("no-auto-number") && flags.get("auto-number") !== "false" && flags.get("no-auto-number") !== "false") {
    console.error("--auto-number and --no-auto-number are a mutually exclusive pair; do not use both")
    process.exit(1)
  }
  if (flags.has("auto-number") && flags.get("auto-number") !== "false") explicit.autoNumber = true
  if (flags.has("no-auto-number") && flags.get("no-auto-number") !== "false") explicit.autoNumber = false
  // --wrapup/--no-wrapup: a boolean pair (the task wrap-up session on or off),
  // handled the same way as --auto-number/--no-auto-number; both at once
  // contradict themselves and are a usage error.
  if (flags.has("wrapup") && flags.has("no-wrapup") && flags.get("wrapup") !== "false" && flags.get("no-wrapup") !== "false") {
    console.error("--wrapup and --no-wrapup are a mutually exclusive pair; do not use both")
    process.exit(1)
  }
  if (flags.has("wrapup") && flags.get("wrapup") !== "false") explicit.wrapup = true
  if (flags.has("no-wrapup") && flags.get("no-wrapup") !== "false") explicit.wrapup = false
  return { explicit, phases, agent, parallel, scanExempt, ...(isolateNone ? { isolate: "none" as const } : {}) }
}

if (command === "init" || command === "amend") {
  // The project's constitutional options are frozen by init (design document
  // §B): the default is a **stateless full overwrite** — the config.json
  // produced is determined solely by the parameters passed this run; keys not
  // given always fall back to the builtin defaults, never incrementally
  // merging the old config on disk. So "a bare init in a clean environment"
  // and "a bare init after a parameterized one" produce byte-identical output:
  // one init yields a determined state, no pre-cleanup needed. Value
  // validation reuses the existing parse* helpers (same source as the
  // config-file side's validateProjectConfig).
  //
  // The amend command (plans/0052 D25) is the per-key revision of its own:
  // it takes the config flags only, refuses without config.json or without a
  // key, and writes config.json plus the artifacts rendered from it (the
  // agent contract and the AGENTS.md block). Since plan owns the rounds
  // (auto-core plans/0053 D31–D32), neither init nor amend runs the round
  // step; each keeps one read-only prefix-guard check below, so a --phases
  // change that keeps the completed phases is allowed and surfaces as a
  // drift for plan to reconcile instead of a silent index rewrite.
  // opencode.json, .gitignore and the brief stub are left to init and `fix`.
  // (The `continue` subcommand that shared this block — amend semantics plus
  // the round establishment at round start — retired with plans/0053 D33:
  // plan's prelude runs the round-close checks and opens the next round.)
  //
  // Every check runs before the first write (plans/0052 D7): a refused init
  // leaves config.json, the templates, AGENTS.md and docs/ untouched.
  if (command === "init" && flags.has("continue")) {
    console.error(
      `--continue is not an option: the next round opens with plan — once the round is complete, fill in ## Close of docs/R-NN/round.md, commit, and run ${shellProfile().bin} plan <dir> (it runs the round-close checks and opens the next round)`,
    )
    process.exit(1)
  }
  const amendCommand = command === "amend"
  if (amendCommand) {
    const allowed = new Set([...CONFIG_FLAGS, "verify-idle", "verify-max", "commit-subtask", "brief", "brief-file"])
    for (const key of flags.keys()) {
      if (allowed.has(key)) continue
      console.error(
        key === "prompt"
          ? `-p/--prompt is not an amend option: the planning input is plan's (-p/--file of opencode-auto plan); the brief is revised with --brief <text> | --brief-file <path>`
          : key === "force"
            ? "-f/--force is not an amend option: amend discards no key, so there is no overwrite confirmation or worktree check to skip"
            : `--${key} is not an amend option: amend takes only config flags (${CONFIG_FLAGS.map((name) => (name === "mode" ? "-m/--mode" : `--${name}`)).join(", ")})`,
      )
      process.exit(1)
    }
    if (!(await Bun.file(join(directory, CONFIG_FILE)).exists())) {
      const legacy = await legacyModeFallback(directory)
      console.error(
        `nothing to amend: ${directory} has no ${CONFIG_FILE}; run opencode-auto init ${directory}` +
          (legacy !== undefined ? ` (or opencode-auto fix ${directory}, which writes it from the legacy .auto/config.json mode "${legacy}")` : ""),
      )
      process.exit(1)
    }
    if (!CONFIG_FLAGS.some((key) => flags.has(key)) && flags.get("brief") === undefined && flags.get("brief-file") === undefined) {
      console.error(
        `name at least one key to change (for example: opencode-auto amend ${directory} --phases amt), or revise the brief with --brief <text> | --brief-file <path>; ` +
          `to refresh the agent contract and the AGENTS.md block without changing a key, run opencode-auto fix ${directory}`,
      )
      process.exit(1)
    }
  }
  // --file is plan's planning input (auto-core plans/0053 D14); neither init
  // (whose own -p is retired — the brief is edited by hand) nor amend takes a
  // planning input, so --file is refused rather than ignored.
  if (flags.has("file")) {
    console.error(`--file is a plan option (the planning input: opencode-auto plan <dir> --file <path>); ${command} does not accept it`)
    process.exit(1)
  }
  if (flags.has("commit-subtask")) {
    console.error("--commit-subtask removed: commits are now made by the driver after every session ends (AI commit rights revoked), and can no longer be turned off (--commit false is retired)")
    process.exit(1)
  }
  for (const key of ["verify-idle", "verify-max"]) {
    if (flags.has(key)) {
      const renamed = key === "verify-idle" ? "idle-time" : "idle-max"
      console.error(`--${key} was renamed to --${renamed} (the driver-run script watchdog)`)
      process.exit(1)
    }
  }
  if (flags.has("max-sessions")) {
    console.error(`--max-sessions is a run option (concurrent AI sessions for this run); ${command} does not accept it`)
    process.exit(1)
  }
  if (flags.has("repair")) {
    console.error(`--repair is a run option (the bounded repair budget for FAIL verdicts, per run and never persisted); ${command} does not accept it`)
    process.exit(1)
  }
  // --name/--email (plans/0073 §2.2, init only — the amend whitelist above
  // already refused them there): the commit identity pair, written as
  // repository-local git config when the identity probe below finds no
  // resolving global/`GIT_*` identity. Not config keys — they never enter
  // config.json; the pair must be complete (a commit needs both) and each
  // value one non-empty line (they become git config values).
  const identityName = flags.get("name")
  const identityEmail = flags.get("email")
  if (command === "init" && identityName !== undefined && identityEmail !== undefined) {
    if (!identityName.trim() || !identityEmail.trim() || identityName.includes("\n") || identityEmail.includes("\n")) {
      console.error("--name and --email each require a non-empty one-line value (they become the repository-local user.name/user.email; never --global)")
      process.exit(1)
    }
  }
  if (command === "init" && (identityName !== undefined) !== (identityEmail !== undefined)) {
    console.error(
      `--${identityName !== undefined ? "name" : "email"} requires its pair --${identityName !== undefined ? "email" : "name"}: ` +
        "pass --name <name> --email <email> together (a commit identity needs both; init writes them as repository-local git config, never --global)",
    )
    process.exit(1)
  }
  // --intent as a bundle source (plans/0079 §3), init only: the value may
  // name a registered intent bundle or a directory holding bundle.json. The
  // parse validates everything (phase types through the custom-type parser,
  // the pack, the mode, the comma-form phases, the stamps) and writes
  // nothing — materialization joins the write phase below, before the config
  // save. A value that resolves to no bundle is a plain pack name (validated
  // after the merge); amend takes plain names only — a bundle is an
  // installation, and installing belongs to init.
  let bundle: IntentBundle | undefined
  const intentFlag = flags.get("intent")
  if (intentFlag !== undefined && intentFlag.trim() && command === "init") {
    const files = await resolveIntentBundle(intentFlag)
    if (files !== undefined) {
      try {
        bundle = parseIntentBundle(files)
      } catch (error) {
        console.error(`--intent ${intentFlag}: ${error instanceof Error ? error.message : String(error)}`)
        process.exit(1)
      }
    }
  }
  // No command reaching this block takes -p (init's is a scoped retired flag,
  // the amend command refuses it, `continue` is retired), so only the key
  // droppers and the explicit keys are read back here.
  const briefSeed = await parseBriefSeed()
  const { explicit, agent, parallel, scanExempt, isolate } = parseConfigFlags(directory)
  // The one watershed between full overwrite and per-key revision: the default
  // takes the builtin defaults table as its baseline (keys not given fall back
  // to the defaults), while the amend command takes the existing on-disk
  // config as its baseline (keys not given keep their values).
  //
  // An amend loads strictly, since it would carry a retired key over. A full
  // overwrite discards them anyway, so its baseline read tolerates them and
  // names each one before the overwrite (plans/0052 D4) — otherwise a stored
  // `commit: false` or `source` would block the very re-init that clears it.
  // From P2 the strict failure names `fix` when a rule repairs it (D4, D11).
  const amend = amendCommand
  let existing: ProjectConfig
  let discarded: RetiredKey[] = []
  try {
    if (amend) existing = await loadProjectConfig(directory)
    else ({ config: existing, retired: discarded } = await loadOverwriteBaseline(directory))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    const hint = await fixHint(directory)
    if (hint) console.error(hint)
    process.exit(1)
  }
  // acceptanceGate/build (plans/0049 G9) have no flag, so they are only ever
  // hand-edited: a full-overwrite init keeps them rather than silently erasing them.
  // AUTO-DECISION: scanExempt is not kept here — it has its flag
  // (--scan-exempt), so it follows the stateless overwrite like parallel; a
  // single key is changed with amend. isolate (plans/0074) has its flag too
  // (--isolate) and follows the same rule.
  const handEdited = { acceptanceGate: existing.acceptanceGate, build: existing.build }
  const base: ProjectConfig = amend ? existing : { ...CONFIG_DEFAULTS, ...handEdited }
  // handoverTest requires testByDriver: when either is explicit, the check
  // judges this run's effective values (an ungiven --test-by-driver falls back
  // to the existing config value); an amend turning test-by-driver off while
  // keeping a stored handoverTest=true is caught here too.
  {
    const effectiveTestByDriver = explicit.testByDriver ?? base.testByDriver
    const effectiveHandoverTest = explicit.handoverTest ?? base.handoverTest
    if (effectiveHandoverTest && !effectiveTestByDriver) {
      console.error(
        `${explicit.handoverTest !== undefined ? "--handover-test" : "the existing handoverTest"} requires --test-by-driver: ` +
          "test handover only makes sense when tests run via the driver. To fix: give --test-by-driver as well (or --handover-test false), e.g. opencode-auto amend <dir> --test-by-driver --handover-test; or edit .opencode/auto/config.json directly",
      )
      process.exit(1)
    }
  }
  // The phase index (the current round's docs/R-NN/phases.md plus each phase
  // directory's todo.md/done.md, M3.3) is a derived state carrier; an invalid
  // one is an environment error with exit 1 (the message points a person at
  // the fix). The completed phases' type sequence (index order, replacing the
  // preset letter string since M3.6): when non-empty, an explicit --phases
  // change must satisfy the prefix guard. (`continue` used to re-check the
  // previous round's completeness here, run the round-close checks and
  // establish the next round; that subcommand retired, and plan's prelude owns
  // the whole route.)
  const liveRound = await currentRound(directory)
  let phaseState: PhaseState | undefined
  try {
    phaseState = await readPhases(directory, liveRound)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  // -m/--mode parsing (the reduced init-side form): precedence is explicit
  // value > baseline value (the defaults under a full overwrite, the existing
  // config under the amend command); an unregistered name is a usage error
  // (the message lists the currently supported modes).
  const modeName = flags.get("mode") ?? base.mode
  const modes = loadModeTable(directory)
  if (!modes[modeName]) {
    console.error(`--mode must be a registered mode (currently supported: ${Object.keys(modes).join(", ")}); defaults to migrate`)
    process.exit(1)
  }
  const config = mergeProjectConfig(base, { ...explicit, mode: modeName })
  // The bundle's stamps (plans/0079 §3) fill only what the person did not
  // give explicitly — a flag always wins over the manifest. The bundle's
  // phases value goes through the prefix guard below like any other, and its
  // mode stamp re-checks against the loaded mode table (a bundle's own mode
  // file is only on disk after materialization, so its name checks here
  // against the manifest's word; the file itself was parsed with the bundle).
  if (bundle) {
    if (explicit.phases === undefined) config.phases = bundle.phases
    if (!flags.has("mode") && bundle.mode !== undefined) config.mode = bundle.mode
    if (!flags.has("subtask") && bundle.stamps.subtask !== undefined) config.subtask = bundle.stamps.subtask
    if (!flags.has("parallel") && bundle.stamps.parallel !== undefined) config.parallel = bundle.stamps.parallel
    if (!flags.has("wrapup") && !flags.has("no-wrapup") && bundle.stamps.wrapup !== undefined) config.wrapup = bundle.stamps.wrapup
    config.intent = bundle.name
    if (bundle.mode !== undefined && !modes[bundle.mode] && !bundle.files.mode) {
      console.error(`--intent ${intentFlag}: the bundle's manifest mode "${bundle.mode}" is not a registered mode (currently supported: ${Object.keys(modes).join(", ")})`)
      process.exit(1)
    }
  }
  // --intent's pack-existence check (plans/0079 §2), judged on the merged
  // value: the name must be a pack the loader resolves in this directory
  // (built-in plus .opencode/auto/intents/). A parsed bundle satisfies itself
  // — its pack materializes before the config write below — so the check
  // skips it.
  if (config.intent !== undefined && config.intent !== bundle?.name && !loadIntents(directory)[config.intent]) {
    const packs = loadIntents(directory)
    console.error(`--intent must be a loaded intent pack (currently available: ${Object.keys(packs).sort().join(", ")}); defaults to the built-in default pack`)
    process.exit(1)
  }
  // --parallel none / --scan-exempt none / --isolate none / --agent opencode
  // drop their keys (an amend would otherwise keep the old value).
  if (parallel === "none") delete config.parallel
  if (scanExempt === "none") delete config.scanExempt
  if (isolate === "none") delete config.isolate
  if (agent === "opencode") delete config.agent
  // The read-only prefix guard, one per command (plans/0053 D31–D32): init
  // and amend no longer re-sync the index, so the guard only keeps the config
  // reconcilable with the current round. plannedPhaseUnits is the sync's check
  // half: a value that would drop a completed phase or a directory holding
  // work could never be re-synced, so it is refused before any write, while a
  // mid-round value that keeps the completed phases is allowed and shows up
  // as a drift for plan to reconcile. Skipped when the current round is
  // complete — the value then applies to the next round plan establishes,
  // what continue offered (0052 §4.1 addition 3). It judges this run's
  // effective value (config.phases), so a no-flag overwrite that would reset
  // a staged project to "m" is caught here too.
  // AUTO-DECISION (one guard): the shells' completed-types prefix check was removed — plannedPhaseUnits is the single guard, refusing every value it refused (a completed phase survives only when its directory matches positionally, the same prefix; a hand-edited index whose done phases are not an index prefix is allowed now: the directories still match, and the sync judges directories).
  const roundComplete = !!phaseState && phaseState.phases.every((unit) => phaseState.done.has(unit.id))
  if (!roundComplete) {
    try {
      // A bundle's phase types are not on disk until materialization, so the
      // guard sees the bundle's parsed entries beside the loaded ones
      // (plans/0079 §3: the stamped value must reconcile against the types
      // the bundle will materialize, not the ones that predate it).
      await plannedPhaseUnits(directory, liveRound, config.phases, bundle ? [...loadPhaseTypes(directory), ...bundle.types] : undefined)
    } catch (error) {
      console.error(
        `${error instanceof Error ? error.message : String(error)}. ` +
          "A mid-round phases change must keep the current round's completed phases and the phase directories that hold work; " +
          "once the current round is complete, any value applies to the next round plan establishes",
      )
      process.exit(1)
    }
  }
  // The prompt library and intent packs: load the target directory's
  // .opencode/auto/prompts/ and .opencode/auto/intents/ overrides (a failed
  // protocol check exits right there); init renders no prompts, but loading
  // early surfaces override problems at init time already. The pack load
  // validates through the loader itself (the render facts build per render
  // call holds no module state).
  try {
    usePromptLibrary(directory)
    loadIntents(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
  // Commit capability prerequisite (plain init only; the amend command is
  // not covered — it touches an already-working project): the
  // unified commit is the completion condition, so a repository whose git
  // cannot commit (no user.name / user.email, nothing to fall back to) is
  // refused before any write.
  // The git bootstrap (plans/0073, ruled 2026-10-04): in a directory inside
  // no git work tree, init first creates the repository itself — with the
  // person's init.defaultBranch when set, `-b main` as the fallback — and
  // prints it loudly (the driver's record and rollback need it; the loud
  // print is the disclosure, there is deliberately no --no-git escape hatch).
  // It runs here, before the identity probe and before ensureInitGitignore
  // below, joining the everything-before-first-write check phase: a refusal
  // after it still leaves no config written, and the empty repository it
  // leaves behind is `rm -rf .git` away from undone. In-repo init is
  // unchanged (the bootstrap is a no-op there).
  if (command === "init") {
    const bootstrap = await bootstrapRepository(directory)
    if (bootstrap.type === "failed") {
      console.error(
        `cannot initialize a git repository in ${directory}: ${bootstrap.error}. ` +
          "The driver commits after every session (the unified commit is the completion condition), so init requires one; " +
          "create the repository yourself (git init) and re-run, or fix the underlying git problem",
      )
      process.exit(1)
    }
    if (bootstrap.type === "created") {
      console.log(`✓ initialized git repository (branch ${bootstrap.branch}) in ${directory} — the driver's record and rollback need it`)
    }
    const problem = await commitIdentityProblem(directory)
    if (problem) {
      // Identity resolution order (plans/0073 §2.2): a resolving
      // global/`GIT_*` identity (judged exactly as commitIdentityProblem
      // judges) → proceed, nothing written — the passing probe is this
      // branch's guard; the --name/--email pair → written as repository-local
      // config in the repository at the target root (never --global; the
      // tool never edits the person's global config); neither → refuse with
      // today's message extended by the new-flags hint. The
      // opencode-auto@local fallback (git.ts identityArgs) deliberately does
      // NOT apply here — it covers only nested repositories the person
      // brought in; the target root's history is the audit trail and keeps
      // an attributable identity.
      if (identityName !== undefined && identityEmail !== undefined) {
        const error = await writeLocalIdentity(directory, { name: identityName, email: identityEmail })
        if (error) {
          console.error(`cannot write the repository-local commit identity in ${directory}: ${error}`)
          process.exit(1)
        }
        console.log("✓ commit identity written as repository-local config (user.name/user.email from --name/--email; never --global)")
      } else {
        console.error(
          `git cannot commit in ${directory}: ${problem}. The driver commits after every session, so init requires a repository that can commit; ` +
            `configure an identity first, e.g. git config --global user.name <name> and git config --global user.email <email> ` +
            `(drop --global to configure this repository only), or pass --name <name> --email <email> to have init write the repository-local identity`,
        )
        process.exit(1)
      }
    }
  }
  for (const item of discarded) console.log(`⚠ full overwrite drops the retired key ${item.key} = ${JSON.stringify(item.value)}: ${item.why}`)
  // The mistouch gates: they bite only when "a config already exists and this
  // run is a full overwrite" — a fresh directory has nothing to overwrite, and
  // the amend command discards no existing key. Both gates must precede the
  // first write (saveProjectConfig); the existing e2e invariant "the directory
  // is empty until every flag check passes" depends on it. Intercept first,
  // ask second — a person must not answer y only to then hit an error.
  const force = flags.has("force")
  const overwriting = !amendCommand && !force && (await Bun.file(join(directory, ".opencode", "auto", "config.json")).exists())
  if (overwriting) {
    // ① Worktree cleanliness: init overwrites a config already on disk, and
    //    git is the person's only undo. It applies without a TTY too — what a
    //    non-TTY skips is the confirmation, never this gate.
    const dirty = await checkCleanTree(directory, "init full overwrite")
    if (dirty) {
      console.error(dirty)
      process.exit(1)
    }
    // ② Interactive confirmation: a non-TTY passes straight through (decided
    //    inside confirm).
    const ok = await confirm(
      "found an existing config .opencode/auto/config.json; init will fully overwrite it with these parameters (keys not given fall back to defaults; to change individual keys instead, use opencode-auto amend). continue? [y/N] ",
    )
    if (!ok) {
      console.log("cancelled; nothing was changed")
      process.exit(0)
    }
  }
  // The bundle's files join the write phase here (plans/0079 §3): every
  // check — the parse, the stamps, the prefix guard, the gates — has passed,
  // so the materialization lands with the config that names it. Re-running
  // init --intent re-materializes the same bytes (no drift copy exists).
  if (bundle) {
    const written = await materializeIntentBundle(directory, bundle).catch((error: unknown) => {
      console.error(`--intent ${intentFlag}: materializing the bundle into ${directory} failed: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    })
    console.log(`✓ intent bundle "${bundle.name}" materialized (${written.join(", ")})`)
  }
  try {
    await saveProjectConfig(directory, config)
  } catch (error) {
    console.error(`failed to write .opencode/auto/config.json: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  console.log(`⚙ project config (.opencode/auto/config.json): ${formatProjectConfig(config)}`)
  // The `type: "file"` imports are embedded into the compiled output, keeping
  // the standalone binary self-sufficient. Tasks are not written here (PLAN.md
  // retired, M3.4): round and phase directories come from plan's
  // round-establishment route, and task units from a planning session or a
  // person. amend writes only what renders from the config
  // (the contract); opencode.json may hold a person's edits and is init's and fix's.
  const templates: Record<string, string> = amendCommand
    ? { ".opencode/agent/auto.md": templateAgent }
    : { "opencode.json": templateConfig, ".opencode/agent/auto.md": templateAgent }
  for (const [file, source] of Object.entries(templates)) {
    const target = resolve(directory, file)
    const raw = await Bun.file(source).text()
    // The agent contract renders conditionally on config.testByDriver.
    const content = file === "opencode.json" ? raw : renderText(raw, { testByDriver: config.testByDriver })
    const existing = await Bun.file(target).text().catch(() => undefined)
    if (existing !== undefined && (existing === content || file !== ".opencode/agent/auto.md")) {
      console.log(`already exists, skipped: ${file}`)
      continue
    }
    await Bun.write(target, content)
    console.log(existing === undefined ? `created: ${file}` : `replaced (differed from the template): ${file}`)
  }
  // The project brief seed (plans/0081 D11, superseding 0052 D9's stub):
  // written verbatim only when --brief/--brief-file is given — omitted writes
  // no file, and a bare re-init never touches an existing brief (a generated,
  // approved brief survives re-init, §7 A5). init seeds; amend revises (the
  // person's rare manual override and the default path's install channel).
  if (briefSeed !== undefined) {
    const existed = await Bun.file(join(directory, BRIEF_FILE)).exists()
    await Bun.write(join(directory, BRIEF_FILE), `${briefSeed.trimEnd()}\n`)
    console.log(
      existed
        ? `replaced: ${BRIEF_FILE} (the brief, verbatim)`
        : `created: ${BRIEF_FILE} (the brief seed, verbatim — the survey/analysis phase proposes the full brief later; every planning session reads it)`,
    )
  }
  // Idempotently sync the opencode-auto block of AGENTS.md: render it from the
  // current config and compare with the file's existing standard block —
  // append when missing, replace the whole block when it differs, and clean
  // out legacy/stray named marker blocks unconditionally.
  const ensured = await ensurePointer(directory, { testByDriver: config.testByDriver })
  console.log(
    ensured.block === "inserted"
      ? "appended: AGENTS.md opencode-auto block"
      : ensured.block === "replaced"
        ? "refreshed: AGENTS.md opencode-auto block (differed from the current config render)"
        : "already exists, skipped: AGENTS.md opencode-auto block (up to date)",
  )
  if (ensured.legacyRemoved) console.log(`cleaned: removed ${ensured.legacyRemoved} legacy/stray opencode-auto marker block(s) from AGENTS.md`)
  // Plain init writes the full ignore set in one pass (the driver workdir, the
  // local-only files and every nested git repository in the tree — see
  // auto-core/gitignore.ts); the amend command never touches it.
  if (command === "init") {
    const appended = await ensureInitGitignore(directory)
    if (appended.length) console.log(`updated: .gitignore now ignores ${appended.join(", ")} (driver workdir, local-only files and nested git repositories)`)
  }

  if (amendCommand) {
    const given = CONFIG_FLAGS.filter((key) => flags.has(key)).map((key) => (key === "mode" ? "-m" : `--${key}`))
    console.log(`✓ amended (${given.join(" ")}); the other keys are unchanged. Review the change and commit it`)
    process.exit(0)
  }

  // init's closing line (plans/0053 D31): plan owns the rounds; init points at it and writes nothing under docs/ itself.
  // AUTO-RESOLVE: the design pins one line — "next: <bin> plan <dir> (establishes round R-01 and stops at the round-start gate)"; print it verbatim on an overwrite init whose round is already established? -> no: the parenthetical is dropped there (it would state a falsehood over an existing round; both states keep a plan-pointing line, which is what the acceptance asks of fresh and overwrite init alike).
  // AUTO-DECISION (dead -p path): the shared block's promptText handling (the per-round brief write of `continue`'s -p and its non-empty check) was deleted rather than kept for a future caller — no command reaching this block accepts -p anymore (init's is a scoped retired flag, the amend command refuses it, `continue` itself is retired ahead of every flag), so the branch was unreachable.
  console.log(
    phaseState
      ? `next: opencode-auto plan ${directory}`
      : `next: opencode-auto plan ${directory} (establishes round ${roundDirName(liveRound)} and stops at the round-start gate)`,
  )
  process.exit(0)
}

// reset subcommand (de-initialization / uninstall): the inverse of init —
// remove exactly the config-layer artifacts init wrote and restore the
// worktree to the uninitialized state, so leftover config stops interfering
// with the opencode main program and other extension components. The checklist
// and its execution live in auto-core/reset.ts (the boundary is stated in that
// file's header comment): it clears the config layer only, never .auto/
// runtime state, docs/ or tmp/; opencode.json, shared with the main program,
// is deleted only after matching the template byte for byte; AGENTS.md loses
// only the opencode-auto marker block; directories are reclaimed by rmdir only
// when empty, preserving .opencode/auto/prompts/ and the person's other agent
// contracts.
if (command === "reset") {
  const entries = await planReset(directory)
  const actionable = entries.filter((entry) => entry.action !== "keep")
  if (!actionable.length) {
    console.log(`no init artifacts found; reset not needed: ${directory}`)
    process.exit(0)
  }
  console.log(`the following cleanup will run in ${directory}:`)
  console.log(formatResetPlan(entries))
  const force = flags.has("force")
  if (!force) {
    // reset is always destructive, so the cleanliness gate applies
    // unconditionally (unlike init, which checks only when overwriting).
    const dirty = await checkCleanTree(directory, "reset deinit")
    if (dirty) {
      console.error(dirty)
      process.exit(1)
    }
    const ok = await confirm(`the ${actionable.length} item(s) above will be deleted/restored; continue? [y/N] `)
    if (!ok) {
      console.log("cancelled; nothing was changed")
      process.exit(0)
    }
  }
  try {
    await applyReset(directory, entries)
  } catch (error) {
    console.error(`reset failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  console.log(`✓ restored to the uninitialized state (docs/, .auto/ runtime state and tmp/ untouched)`)
  process.exit(0)
}

// fix (plans/0052 D10/D11): repairs the config layer by rule — retired or
// renamed keys in config.json, and config-layer artifacts that are missing or
// out of step with the config. The rule table and its boundary are in
// auto-core/config-fix.ts. Its baseline is the existing config, read raw; it
// takes no config flags and never resets a key. The interaction is reset's:
// print the plan, then the worktree cleanliness gate and the confirmation
// (-f skips both), then apply. It never commits: the diff is left for review.
// --dryrun keeps the read-only half: plan and print the findings, write
// nothing, exit 0 when there are none and 1 when there are any — a scripted
// gate on config drift keeps its exit code. It skips only the write-side
// gates (the clean-tree check, the confirmation and the run-lock refusal
// above) and keeps fix's other refusals, including the uninitialized and
// legacy-layout ones; the uninitialized refusal still applies because a
// directory without a config layer has nothing to list.
if (command === "fix") {
  const plan = await planFix(directory)
  if (plan.uninitialized) {
    console.error(`nothing to fix: ${directory} has no ${CONFIG_FILE}; run opencode-auto init ${directory}`)
    process.exit(1)
  }
  if (!plan.findings.length) {
    console.log(`✓ nothing to fix: the config layer of ${directory} is consistent with its config`)
    process.exit(0)
  }
  const fixable = plan.findings.filter((finding) => finding.class === "fixable")
  const manual = plan.findings.filter((finding) => finding.class === "manual")
  console.log(`config-layer findings in ${directory}:`)
  console.log(formatFixPlan(plan))
  if (fixDryrun) {
    if (manual.length) {
      console.error(`${manual.length} finding(s) need a person (listed as manual above): edit the file by hand, then re-run opencode-auto fix ${directory}`)
    }
    console.log(
      fixable.length
        ? `dryrun: nothing was changed; apply the ${fixable.length} fixable finding(s) with opencode-auto fix ${directory}`
        : "dryrun: nothing was changed; the finding(s) above need a person",
    )
    process.exit(1)
  }
  if (fixable.length) {
    if (!flags.has("force")) {
      const dirty = await checkCleanTree(directory, "fix")
      if (dirty) {
        console.error(dirty)
        process.exit(1)
      }
      const ok = await confirm(`apply the ${fixable.length} fix(es) above? [y/N] `)
      if (!ok) {
        console.log("cancelled; nothing was changed")
        process.exit(0)
      }
    }
    try {
      await applyFix(plan)
    } catch (error) {
      console.error(`fix failed: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
    for (const finding of fixable) console.log(`fixed: ${finding.path}: ${finding.change}`)
  }
  if (manual.length) {
    console.error(`${manual.length} finding(s) need a person (listed as manual above): edit the file by hand, then re-run opencode-auto fix ${directory}`)
    process.exit(1)
  }
  console.log("✓ config layer repaired; review the change and commit it")
  process.exit(0)
}

// The phase progress line (shared by run's banner and status): the current
// round's phase index → P01-analysis✓ P02-design▶ …; a missing or invalid
// index only yields a warning line and never blocks the caller.
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

if (command === "status") {
  // The config summary, then the current round's read-only overview tree
  // (round → phase → task → subtask, with status and dependencies; plans/0047
  // L1/R2). An invalid config only warns and never blocks the overview; a
  // missing or invalid phase/task index shows as ⚠ lines. A live run lock
  // comes first (plans/0053 D3).
  const holder = liveRunLock(directory)
  if (holder) console.log(lockStatusLine(holder))
  try {
    const config = await loadProjectConfig(directory)
    console.log(`⚙ project config (.opencode/auto/config.json): ${formatProjectConfig(config)}`)
  } catch (error) {
    console.log(`⚠ project config (.opencode/auto/config.json) is invalid: ${error instanceof Error ? error.message : String(error)}`)
    const hint = await fixHint(directory)
    if (hint) console.log(`  ${hint}`)
  }
  for (const line of await renderStatus(directory)) console.log(line)
  process.exit(0)
}

// models (auto-core plans/0055 §9): the model registry's effective table —
// per phase type and routing role the tier, the route in force and the
// candidates, whether each is usable now and why not, plus each entry's layer,
// steps, key ring names, the classifier list and the profiles' env variable
// names (never a value). It writes nothing and takes no run lock, so it runs
// beside a live run. Exit codes: 0 no registry or a registry a run start
// accepts; 1 one that run and plan would refuse (the problems are printed,
// after the table when the registry loads).
// AUTO-RESOLVE: does a registry that loads but has broken references (or a project layer git would commit) exit 1, and is its table printed? -> exit 1, since run and plan refuse it at start, with the table printed before the problems (it shows the operator what the references belong to)
// --probe (§9) additionally sends the recovery probe prompt to each listed
// model through the agent pool — the only thing here that starts agents, and
// opt-in because it costs tokens; the shell only prints the lines the core
// answers (probeModels, auto-core src/agent-pool.ts). A failed probe is a
// finding printed per model, not a command error.
if (command === "models") {
  const description = await describeModels(directory, Date.now())
  for (const line of formatModels(description)) console.log(line)
  if (flags.has("probe")) {
    if (description.registry === undefined) console.log("probe: no model registry, nothing to probe")
    else {
      console.log("probing every listed model (this sends one short prompt to each; it may take a while)")
      for (const probe of await probeModels(description.registry, directory))
        console.log(`${probe.ok ? "◇" : "⚠"} probe ${probe.name} (${probe.agent}): ${probe.line}`)
    }
  }
  process.exit(description.problems.length ? 1 : 0)
}

console.error(`usage:
  opencode-auto init [dir] [-m|--mode <name>] [--agent opencode|claude] [--subtask [off|auto|true|ondemand]] [--idle-time [1-120]] [--idle-max [1-1440]] [--context-limit [n]] [--phases <admtvk subsequence with m | type-id list>] [--test-by-driver [true|false]] [--handover-test [true|false]] [--auto-number|--no-auto-number] [--wrapup|--no-wrapup] [--parallel none|low|medium|high] [--scan-exempt none|<globs>] [--isolate <rel-path>]... [--name <name> --email <email>] [--brief <text> | --brief-file <path>] [-f|--force]
  opencode-auto run [dir] [--server <url>] [--verbose [true|false]] [--interactive|-i] [--wait-answer [1-60]] [--wait-between [1-60]] [--permission [auto-allow|ask-allow|ask-deny|ask-fail]] [--dryrun [true|false]] [--new-session] [--max-sessions <n>]
  opencode-auto plan [dir] [-p|--prompt <text> | --file <path>] [--append] [--new-task "<one-line title>"] [--scaffold] [--force-close <ref> --reason <text> [--cascade] [--commit-changes | --stash-changes]] [--server <url>] [--verbose [true|false]] [--interactive|-i] [--wait-answer [1-60]] [--permission [auto-allow|ask-allow|ask-deny|ask-fail]] [--new-session]
  opencode-auto close <ref> [dir] --reason <text> [--cascade] [--commit-changes | --stash-changes]
  opencode-auto land [dir] [--keep] [--abandon] [--merge]
  opencode-auto amend [dir] [-m|--mode <name>] [--agent opencode|claude] [--subtask [off|auto|true|ondemand]] [--idle-time [1-120]] [--idle-max [1-1440]] [--context-limit [n]] [--phases <admtvk subsequence with m | type-id list>] [--test-by-driver [true|false]] [--handover-test [true|false]] [--auto-number|--no-auto-number] [--wrapup|--no-wrapup] [--parallel none|low|medium|high] [--scan-exempt none|<globs>] [--isolate <rel-path>]...|none [--brief <text> | --brief-file <path>]
  opencode-auto fix [dir] [-f|--force] [--dryrun [true|false]]
  opencode-auto reset [dir] [-f|--force]
  opencode-auto status [dir]
  opencode-auto models [dir] [--probe]

options: project-constitution options (-m/--mode, --agent, --context-limit, --subtask, --idle-time, --idle-max, --test-by-driver, --handover-test, --auto-number/--no-auto-number, --wrapup/--no-wrapup, --phases, --parallel, --scan-exempt, --isolate) are frozen by init into .opencode/auto/config.json (versioned, shared with the repo, human-editable); passing them to run is a usage error
       init defaults to a stateless full overwrite: the output is determined solely by the parameters given this time; keys not provided fall back to defaults without merging the old on-disk config — the same init produces identical output in any environment, no pre-cleanup needed. It writes the config layer only (config.json, opencode.json, the agent contract, the AGENTS.md block and .gitignore, plus the optional project-brief seed of --brief/--brief-file; never the rounds — plan establishes them), so its -p (the brief seed is --brief; the planning input is plan's) and --amend (change individual keys with the amend command) are retired. In a directory inside no git work tree, init first initializes the repository itself (branch: the configured init.defaultBranch when set, else main) and prints it loudly — the driver's record and rollback need it; there is no --no-git escape hatch. It then checks that git can commit there: a resolving global/GIT_* user.name/user.email identity passes with nothing written; else --name <name> --email <email> given at init are written as repository-local config (never --global); else init refuses with exit 1 before any write, the message naming the flags. It also extends .gitignore with the driver workdir (tmp/, .auto/), local-only files (/.gitignore, /.env, /AGENTS.md, /opencode.json) and every nested git repository in the tree
       amend changes the config keys given and keeps the rest (at least one key; refuses without .opencode/auto/config.json); it rewrites config.json, the agent contract and the AGENTS.md block and never touches the rounds. A --phases change is judged by the prefix guard below; on an established round the index stays as it was and the change surfaces as a drift plan deals with
       fix repairs the config layer by rule, never changing a key's meaning: drops or renames retired keys in config.json (moving source/destDir into .opencode/auto/brief.md), writes config.json from a legacy .auto/config.json, and rewrites the agent contract, the AGENTS.md block and the .gitignore entries when missing or out of step with the config (opencode.json only when missing; the brief is never written — seed it with init/amend --brief); anything else is reported for a person to fix (exit 1). It prints the plan, then asks like reset; it never commits. fix --dryrun plans and prints the findings and writes nothing (exit 0 when there are none, 1 when there are any — a scripted gate on config drift), skipping only the write-side gates (the clean-tree check, the confirmation and the run-lock refusal)
       -f/--force skips the confirmation and the worktree cleanliness check (for CI and automation; shared by init, reset and fix)
         plan establishes the current round when it is not yet (and, once a finished round passes its round-close checks, the next one), plans the current phase and stops before any task runs, for review; where nothing needs an agent it prints what is next and exits 0. -p/--prompt <text> or --file <path> is the planning input: it is saved as the phase's plan-input.md and committed before the planning session reads it (refused on a round that is not established yet: establish it, commit the setup, then pass the input). --append appends the tasks planned from the input to the phase the route names now, never advancing to another phase (on the plan route the phase is planned normally; in m mode the input already implies the append on a non-empty index); it requires an input, refuses while a task is mid-pipeline, and a stale handover of the phase is removed and distilled again after the appended tasks. --new-task "<one-line title>" adds the one task you name with no session at all — the driver allocates the number, writes docs/T-NNN/todo.md and the index line and commits (targeting, guards and the stale-handover removal as --append's; the title is the whole task content, so review the document before run). It takes run's session options; config options, --dryrun, --wait-between and --max-sessions are refused. Exit codes as run's (2 also when the finished round fails its round-close checks)
         plan --force-close <ref> --reason <text> closes a unit (close's semantics: the Closed: field, the close commit, a phase's mechanical handover) and continues planning in the same process under one run lock — replace a task (plan <dir> --force-close T-005 --reason "…" --append -p "do X instead") or skip a phase into the next one (plan <dir> --force-close R-01.P02 --reason "…"); --reason (one line, required) is the confirmation, and --cascade / --commit-changes | --stash-changes are close's options. The close runs first: a refused close exits 1 with nothing done, a failed close commit exits 2, and after a successful close the exit code is plan's
         close <ref> closes a unit (task T-NNN, phase R-NN.P<nn> or round R-NN) without completing it — done for scheduling, never delivered: the reason goes into a Closed: field of the unit's done.md, a close commit (Auto-Stage: force-close), and for a phase a driver-written mechanical handover that records the skipped gates. The ref comes first (then the directory); the explicit ref and the required one-line --reason are the confirmation (no prompt), and the undo is "git revert" of the close commit, printed in the output and valid before anything else runs. --cascade closes explicit dependents too (tasks whose Depends: names a closed unit, repeating over their chains); --commit-changes / --stash-changes handle uncommitted changes (folded into the close commit / stashed away) — without one, anything beyond the driver's own state files refuses the close. Exit codes: 0 closed; 1 refused or usage error; 2 the close commit or close-out check failed
         land [dir] lands each branch-isolated repository's round of work (config isolate, the auto/R-NN branch round establishment switched it onto) back onto its original branch as one commit — default git merge --squash (the deliverable's history gains exactly one commit; --merge takes a true merge commit instead) — deletes the round branch and prints the landed SHA. Landing mid-round is allowed with --keep: the branch is retained and checked back out — the round simply continues on it; a later land recognizes the previous landing and folds only the new commits. --abandon discards the round branch after a person-reviewed reset — the undo path: it checks the original branch back out, deletes auto/R-NN (its tip printed, recoverable via git reflog) and lands nothing. Refusal is never an automated merge resolution: the original branch moved, foreign commits mixed into auto/R-NN's range, a dirty repository or an ambiguous original branch all block (exit 2) naming what to settle; preflight warns about a leftover auto/R-NN of an abandoned round (recoverable state — land --abandon and plain git both address it). The audit-trail trade-off is stated, not hidden: one commit on the deliverable, the full per-unit trail in the driven root's git. Exit codes: 0 landed; 1 usage error; 2 blocked for human
         run lock: run and plan hold .auto/run.lock while they work (a plan --force-close holds it across the close and the planning alike), close holds it around its writes, and land around its branch moves; init, amend, fix and reset refuse while another process holds it (fix --dryrun reads and prints only, so it runs beside a live run; -f does not override the refusal), and status shows it on its first line. A lock whose process is gone is removed by the next run, plan or close
       --new-session when resuming from an interruption, do not reuse the interrupted session; start a new one (only skips session reuse; exact phase re-entry is unaffected; by default the surviving interrupted session is reused)
       -m/--mode prompt-level scenario mode (built-in migrate; add or override via .opencode/auto/modes/<name>.md in the target directory — new modes need no source changes)
       -p/--prompt is the planning input of plan (-p <text> | --file <path>; plan --scaffold prints a template to complete into a file); on every other command it is refused. The project brief .opencode/auto/brief.md is seeded with init --brief <text> | --brief-file <path> (written verbatim; omitted writes no file) and revised with amend's --brief/--brief-file or installed from the survey phase's approved proposal — never hand-edited mid-run; every planning session reads it. State the migration source and target there — --source-dir/--source-path/--dest-dir are retired
       reset de-initialization (inverse of init): removes the config-layer artifacts init wrote (.opencode/auto/config.json, .opencode/agent/auto.md, legacy .auto/config.json, the AGENTS.md opencode-auto block, the .gitignore entries init wrote (tmp/, .auto/, the local-only files and nested git repositories), plus opencode.json if unmodified); the project brief .opencode/auto/brief.md is kept (a seed or the analysis phase's generated brief — delete it by hand if you mean to); docs/, .auto/ runtime state and tmp/ are never touched; empty directories only are reclaimed (preserving .opencode/auto/prompts/ and your other agent contracts)
       --phases <admtvk subsequence with m | type-id list> phased flow (a analysis → d design → m migration implementation → t test → v acceptance → k knowledge distillation; "m" default = the manual single phase P01-implement, no planning or handover session; alternatively a comma-separated list of phase type ids in any order, repeats allowed, containing implement (e.g. analysis,security-review,implement), where custom types are defined one per file in .opencode/auto/phases/<type>.md). Changing it mid-round must keep the completed phases and the directories holding work (the prefix guard init and amend apply); once the current round is complete any value applies to the next round plan establishes
       --test-by-driver [true] moves compile/test/build/lint execution rights to the driver: execution-type sessions no longer run such commands in-session; instead they write the commands as scripts into test/ and put the script path in tmp/test.sh for the driver, which merges stdout/stderr into tmp/test.<n>.out and feeds the exit code and output file back to the session for the AI to judge
       --handover-test requires --test-by-driver: when a session's context reaches its cap, hand over at the moment it next initiates a test — the driver first commits the finalized pinned script and sources, and has the AI write remaining work that does not depend on test results to disk plus a handover document (subtask sessions: docs/<task>/S<two-digit>/testhandoff.md; whole-task sessions: docs/<task>/testhandoff.md) before ending the session; the document is archived as testhandoff-<n>.md with one more commit to confirm the handover, and only then does the test run (what gets tested is exactly that commit's tree); a new session reads the results and continues, avoiding repeated trial-and-error in an oversized context. If the handover is interrupted, the next run locates the breakpoint from the document's file and commit state (wrap-up unfinished → fork from the finalized point and redo the wrap-up; written → add the missing commit and run the script). Set OPENCODE_AUTO_HANDOVER_CONCURRENT=on to restore the old concurrent timing (tests start right after finalization, parallel to the session wrap-up, testing the finalized snapshot)
       --auto-number / --no-auto-number auto-numbering switch (default --auto-number = on; --no-auto-number is the opt-out): task numbers (T-NNN) never repeat in the target directory — the next free number is persisted in .auto/next-task and phase planning sessions continue from that record (no longer restarting from T-001 each phase); if the record is missing (e.g. a fresh clone without .auto/ shared), an AI recovery session first derives the next number from the task indexes, docs artifacts and git history, restores the record, and only then continues planning
       --wrapup / --no-wrapup task wrap-up session switch (default --wrapup = on; --no-wrapup is the opt-out): when off, the wrap-up session is skipped after each task's subtasks/whole-task execution completes (including wrap-up after fix rounds)
       --agent opencode|claude the coding agent that runs every session (default opencode; claude = Claude Code headless, needs the claude CLI on PATH). The agent contract is always .opencode/agent/auto.md; the env var OPENCODE_AUTO_AGENT overrides the configured agent for a run
       --parallel none|low|medium|high planning guidance (default none): how hard planning sessions work to make tasks independent (declared Depends:/Touches: fields, tasks split along file and module boundaries); the level's text comes from the ## parallelism section of the intent pack. With --max-sessions above 1 it also switches the run to concurrent lanes (each task isolated in its own git worktree, merged back serially) and sets the landing-conflict posture (low blocks on the first conflict; medium/high allow one repair merge before blocking); the level is required for concurrency
       --scan-exempt none|<globs> comma-separated path globs, relative to the target directory, of deliverable files the driver's content scans skip (default none): the process-document reference scan (unit close-out and round close) and the document terminator scan. For deliverables where such strings are content, e.g. a tool's own test fixtures or prompt templates; a glob naming a directory covers the files under it; only deliverable paths are exempted (process documents and the agent-contract surfaces are never scanned for references anyway); the list replaces the stored one, none removes it
        --isolate <rel-path> (repeatable) branch isolation of nested repositories (default none): at round establishment each designated repository — named by a repository-relative path holding a .git, never the target root — is switched onto the branch auto/R-NN, so the driver's per-session commits land there while the repository's original branch never moves; a designated repository that is not clean at establishment blocks the round for human attention. The list replaces the stored one, none removes it
        --max-sessions <n> run option: the number of AI sessions running concurrently (counts sessions; unrelated to --agent). The default 1 runs everything serially; above 1 requires a parallel level (init --parallel) and runs the phase's tasks as concurrent lanes (isolated worktrees, serial landings); --interactive and --wait-answer are refused above 1 (one human cannot steer concurrent sessions)
        --commit is retired: committing cannot be turned off — after any session ends the driver recursively commits all changes (git history is the audit trail of AI changes; --commit false and the old alias none were retired on 2026-09-15, and with the config key gone the flag went entirely). A stored commit: true in .opencode/auto/config.json still loads and is ignored; any other stored value fails loading (opencode-auto fix <dir> drops the key)
        --implement-file / --implement-prompt are retired: plan tasks with opencode-auto plan <dir> -p <text> | --file <path> (after plan establishes the round and its setup is committed)
       models prints the model registry's effective table without starting an agent: the layers it was read from (the operator layer $OPENCODE_AUTO_MODELS, else $XDG_CONFIG_HOME/opencode-auto/models.json; the project layer .opencode/auto/models.json, local-only), each agent profile (adapter, bin, server, env variable names — never values), each model entry (its layer, steps, windows and key ring by reference name) with whether it is usable now and why not (outside its windows, filtered out by the agent filter, a known context window below the project cap), the tiers, routes and classifier list, and per phase type and role the tier, the route in force and the ordered candidates. It exits 0 without a registry (one line) and 1 with the problems run and plan would refuse at start (bad JSON, an unknown field, a broken reference, a project layer git would commit); it takes no run lock; --probe additionally sends the recovery probe prompt to each listed model (opt-in, it costs tokens), printing each model's answer or failure, and a failed probe is a finding, not a command error
        continue is retired: once the round is complete, fill in ## Close of docs/R-NN/round.md, commit, and run ${shellProfile().bin} plan <dir> — it runs the round-close checks and opens the next round
        check is retired: the principle scan and the reference check were removed; ${shellProfile().bin} fix --dryrun <dir> lists the configuration findings

exit codes: 0 all complete; 1 usage/environment error (the same code fix --dryrun answers with configuration findings); 2 blocked/incomplete awaiting human intervention (including a task report whose result line reads Result: FAIL); 130 force-terminated by two consecutive Ctrl+C`)
process.exit(1)
