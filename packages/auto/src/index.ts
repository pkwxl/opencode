#!/usr/bin/env bun
import { stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import { checkCleanTree } from "@opencode-ai/auto-core/clean"
import { confirm } from "@opencode-ai/auto-core/confirm"
import {
  CONFIG_FILE,
  PARALLEL_LEVELS,
  configKeyRevision,
  type ParallelLevel,
  formatProjectConfig,
  isolateProblem,
  legacyModeFallback,
  loadProjectConfig,
  scanExemptProblem,
  splitGlobList,
  type ProjectConfig,
} from "@opencode-ai/auto-core/config"
import { applyFix, fixHint, formatFixPlan, planFix } from "@opencode-ai/auto-core/config-fix"
import { applySync, formatSyncPlan, planSync, syncWritesAnything } from "@opencode-ai/auto-core/sync"
import { releaseCheck } from "@opencode-ai/auto-core/release"
import { PROVENANCE_FILE } from "@opencode-ai/auto-core/provenance"
import { closeUnit, type CloseChanges } from "@opencode-ai/auto-core/close"
import { clarifyGate } from "@opencode-ai/auto-core/clarify"
import { checkPrompts, formatCheckPrompts, formatInstallPrompts, installPrompts } from "@opencode-ai/auto-core/install-prompts"
import { renderHelperBrief } from "@opencode-ai/auto-core/driver-helper"
import { landUnit } from "@opencode-ai/auto-core/land"
import { forkTask, removeFork } from "@opencode-ai/auto-core/fork"
import { acquireRunLock, liveRunLock, lockLines, lockStatusLine } from "@opencode-ai/auto-core/lock"
import { log, setInteractive, setLogFile, setVerbose } from "@opencode-ai/auto-core/log"
import { runAll, runLaneWorker, type RunAllOpts } from "@opencode-ai/auto-core/loop"
import { configRunOptions } from "@opencode-ai/auto-core/loop-preflight"
import { runBannerLines } from "@opencode-ai/auto-core/banner"
import { runConfigSequence } from "@opencode-ai/auto-core/config-op"
import { loadModes, type ModeSpec } from "@opencode-ai/auto-core/mode"
import { describeModels, formatModels } from "@opencode-ai/auto-core/models-describe"
import { probeModels } from "@opencode-ai/auto-core/agent-pool"
import { planPrelude } from "@opencode-ai/auto-core/plan"
import { runTransfer } from "@opencode-ai/auto-core/transfer"
import type { PlanInput } from "@opencode-ai/auto-core/plan-input"
import { applyReset, formatResetPlan, planReset } from "@opencode-ai/auto-core/reset"
import { legacyLayoutProblem, parsePhases } from "@opencode-ai/auto-core/phases"
import { loadPhaseTypes } from "@opencode-ai/auto-core/phases/custom"
import { PRESET_FORM, phasesProblem, type PhaseTypeEntry } from "@opencode-ai/auto-core/phases/registry"
import { renderStatus } from "@opencode-ai/auto-core/status"
import { roundDirName } from "@opencode-ai/auto-core/docpaths"
import { SUBTASK_MODES, type PermissionMode, type SubtaskMode } from "@opencode-ai/auto-core/opts"
import { loadIntents, planningInputScaffold } from "@opencode-ai/auto-core/intent/load"
import { parseIntentBundle, resolveIntentBundle, type IntentBundle } from "@opencode-ai/auto-core/bundle"
import { shellProfile } from "@opencode-ai/auto-core/shell"

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
// (mirroring -p's swallow rule), --help the short form -h (likewise boolean,
// swallows nothing). Parsing matches whole names exactly:
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
  "tree-lanes",
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
  // --stop-after (auto-core plans/0128): the task id whose completion ends
  // this run — the retry's guardrail beside fork; run's alone.
  "stop-after",
  // --brief/--brief-file (plans/0081 D11; init's seed half retired by
  // auto-core plans/0133 D9 — the analysis flow owns the start): the project
  // brief's revision channel, amend's alone — the text verbatim, or the file
  // holding it (refused elsewhere like the config flags).
  "brief",
  "brief-file",
  // --boundary (auto-core plans/0101 D1): run's phase-boundary shape — stop
  // (the default) ends the run at each clean phase end naming transfer, flow
  // restores today's continuous crossing; run's alone.
  "boundary",
  // --onto (auto-core plans/0192 D2): land's alone — the person's name for
  // the original branch, the derivation ladder's first rung; a value flag
  // (it swallows the branch name).
  "onto",
])
// Repeatable value flags (plans/0074 §5.4: --isolate): each occurrence names
// one value, so the values are collected in their own table instead of the
// single-value flags map (which keeps only the last occurrence as a presence
// marker, for the whitelist pass and the amend "name at least one key" check
// that read flags.has). parseConfigFlags reads the values from repeatFlags.
const REPEAT_FLAGS = new Set(["isolate"])
const repeatFlags = new Map<string, string[]>()
// --probe (models' alone, plans/0055 §9) is a boolean like the rest: presence
// means true, --probe=false the explicit opt-out, and a following true/false
// swallowed — before it joined this set, `--probe=false` set the flag with the
// value "false" and still ran the probe (a token-spending opt-out ignored),
// and `--probe true <dir>` left "true" as the directory.
const BOOLEAN_FLAGS = new Set(["verbose", "interactive", "dryrun", "test-by-driver", "handover-test", "new-session", "auto-number", "no-auto-number", "wrapup", "no-wrapup", "amend", "force", "cascade", "commit-changes", "stash-changes", "append", "keep", "abandon", "scaffold", "round", "phase", "from-bundle", "resynthesize", "probe", "check"])
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
  // -h is --help's short form (boolean, swallows nothing — the help
  // interception below answers it ahead of every option policy).
  if (arg === "-h") {
    flags.set("help", "")
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
    `continue is retired: once the round is complete, fill in ## Close of docs/R-NN/round.md, commit, and run ${shellProfile().bin} transfer <dir> — it runs the round-close checks and opens the next round`,
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

// The help surface: the command table is the one source of the usage text —
// the former single usage dump (the file's last block) split into its rows,
// so the full usage (a missing subcommand, and --help/-h) and each command's
// own `opencode-auto <command> --help` view render from the same data and
// cannot drift apart. A row carries the command's synopsis (its full
// argument grammar), a one-line summary and the keys of the option
// paragraphs its view shows; OPTION_HELP holds the paragraphs themselves in
// the full usage's order — one text per topic (a command's behavior, an
// option's semantics, a retirement), shared by every view that names its
// key. The retirements (the last four keys) ride the full usage alone: they
// are every command's answer on use, not one command's help. The "frozen"
// paragraph lives beside them for the views of the commands that take or
// refuse the config flags, and doubles as the options section's own first
// line in the full usage.
interface CommandHelp {
  name: string
  summary: string
  synopsis: string
  options: readonly string[] // OPTION_HELP keys, in the view's display order
}
const FROZEN_OPTIONS =
  "project-constitution options (-m/--mode, --agent, --context-limit, --subtask, --idle-time, --idle-max, --intent, --test-by-driver, --handover-test, --auto-number/--no-auto-number, --wrapup/--no-wrapup, --phases, --parallel, --tree-lanes, --scan-exempt, --isolate) are frozen by init into .opencode/auto/config.json (versioned, shared with the repo, human-editable); passing them to run is a usage error"
const OPTION_HELP: ReadonlyArray<readonly [key: string, text: string]> = [
  [
    "init",
    "init defaults to a stateless full overwrite: the output is determined solely by the parameters given this time; keys not provided fall back to defaults without merging the old on-disk config — the same init produces identical output in any environment, no pre-cleanup needed. " +
      "It writes the config layer only (config.json, opencode.json, the agent contract, the AGENTS.md block and .gitignore; never the rounds — transfer establishes them (plan does in m mode), and never the project brief — the analysis flow owns the start: its `## Project brief` proposal installs the brief on release), " +
      "so its -p (init takes no prompt and no brief; the planning input is plan's), --brief/--brief-file (the brief's channels are the approved proposals and amend's manual revision) and --amend (change individual keys with the amend command) are retired. " +
      "In a directory inside no git work tree, init first initializes the repository itself (branch: the configured init.defaultBranch when set, else main) and prints it loudly — the driver's record and rollback need it; there is no --no-git escape hatch. " +
      "It then checks that git can commit there: a resolving global/GIT_* user.name/user.email identity passes with nothing written; else --name <name> --email <email> given at init are written as repository-local config (never --global); " +
      "else init refuses with exit 1 before any write, the message naming the flags. It also extends .gitignore with the driver workdir (tmp/, .auto/), local-only files (/.env, /AGENTS.md, the model registry project layer /.opencode/auto/models.json) and every nested git repository in the tree — the .gitignore itself and opencode.json are committed project surfaces (plans/0138: the ignore set and the host posture reach every fresh clone; AGENTS.md stays local, re-derived from the committed config at every run start)",
  ],
  [
    "amend",
    "amend changes the config keys given and keeps the rest (at least one key, or a brief revision with --brief <text> | --brief-file <path>; refuses without .opencode/auto/config.json); it rewrites config.json, the agent contract and the AGENTS.md block and never touches the rounds. " +
      "The phases key is init-stamped machinery (plans/0137): amend refuses --phases outright — a round's phases reshape by moving or adding its `- R-NN <phases> — <goal>` line in docs/analysis.md, and the next transfer re-derives the round's unstarted tail before constructing",
  ],
  [
    "fix",
    "fix repairs the config layer by rule, never changing a key's meaning: drops or renames retired keys in config.json (moving source/destDir into .opencode/auto/brief.md), writes config.json from a legacy .auto/config.json, " +
      "and rewrites the agent contract, the AGENTS.md block and the .gitignore entries when missing or out of step with the config — the .gitignore rules append the workdir, model-layer and nested-repository entries and remove the retired /.gitignore self-entry (plans/0138: the ignore set is a tracked surface), the retired /opencode.json line reported for the person, a visibility decision — (opencode.json only when missing; the brief is never written — its channels are the approved proposals and amend --brief); " +
      "anything else is reported for a person to fix (exit 1). It prints the plan, then asks like reset; it never commits. " +
      "fix --dryrun plans and prints the findings and writes nothing (exit 0 when there are none, 1 when there are any — a scripted gate on config drift), skipping only the write-side gates (the clean-tree check, the confirmation and the run-lock refusal)",
  ],
  ["force", "-f/--force skips the confirmation and the worktree cleanliness check (for CI and automation; shared by init, reset, fix and sync)"],
  [
    "sync",
    "sync upgrades a materialized intent bundle to the running binary's (auto-core plans/0100): unedited managed files (the pack, the mode, the phase files init materialized, recorded with their digests in .opencode/auto/provenance.json) " +
      "fast-forward byte-identically, the stamp rewrites, and the diff is left for review — never committed, never touching config.json. " +
      "Person-edited files, files the bundle retired and extras under the materialized homes are reported and never written or deleted. " +
      "An unstamped project (materialized before the stamp existed) bootstraps: byte-identical files are adopted into a fresh stamp, differing ones reported with the headings delta (--from-bundle overwrites them — your assertion the pack is pristine-but-old). " +
      "A round in flight only warns: later phases would plan under changed charters, your boundary call. sync --dryrun plans and prints, writes nothing (exit 0 when nothing would change, 1 when something would)",
  ],
  [
    "release",
    "release [dir] certifies the destination repository standing alone (auto-core plans/0103): the containment findings the working rounds record but deliberately defer — inside a nested repository, task-id mentions, " +
      "paths leading outside the repository's own root and process-document paths — block here, beside a clean-tree check (an uncommitted state is not a release). " +
      "A gate, not a scrubber: removal is content work you do with your agent — restate the decision a citation pointed at, vendor or rewrite what a path named — and the re-run certifies the result with one ✓ line per destination naming its HEAD. " +
      "AUTO-* markers are self-contained content, not references: their removal is your editorial choice, never demanded. Exit 0 certified; 2 findings remain (fix, commit, re-run); 1 no nested repository to release",
  ],
  [
    "driver-helper",
    "driver-helper [dir] renders the person-proxy brief (auto-core plans/0105): the six-block context — ROLE (the session holds the person's pen: never the driver, the manual prompts/ suite reference material, not the execution path), " +
      "PRIMER (the driver's working model), STATE (the live facts plus the stop's own lines, from the same emitters the terminal prints), CHANNELS (the person-owned documents open at this state, each with its grammar and commit ownership), " +
      "POLICY (the assist rule, the state's recorded defaults, everything else stop-and-ask) and RECOVERY (the exact commands) — a coding-agent session pastes it to act with you at a boundary run cannot cross: " +
      "the round-start round.md, a held survey's forks, a planning input, a blockage Choice, a failed task's accept-or-rework. " +
      "Read-only, stdout, exit 0, nothing written, no run lock (a live lock is reported in the brief, never refused on) and nothing parsed back — the next transfer/plan/run recovers by the re-derivation it always performs. " +
      "The state is keyed on the config: an unloadable one refuses (fix the config layer first)",
  ],
  [
    "plan",
    "plan (auto-core plans/0101 D4) is the dispatch half of the person-bracketed boundary: bare plan runs the awaiting, reviewed plan task transfer constructed — the formulation session, the collect checks and the wrap-up, " +
      "one session chain stopping on completion (the produced index and task documents are committed, so the second review, of the actual decomposition, is free, and run is its approval act). " +
      "Every phased state that is not that dispatch refuses naming transfer: the project start and the round establishment (transfer's project-start shape), the complete round (transfer closes it and opens the next), " +
      "an unplanned phase or one at its boundary (transfer constructs and stops for review). Two guards hold the seam: the round brief docs/R-NN/round.md must be filled — an untouched stub refuses exit 2 naming the fill " +
      "(no planning session dispatches against an empty round brief) — and an input (-p/--prompt <text> | --file <path>, m mode's planning channel and --append's) that changes what the reviewed todo rendered refuses naming the transfer re-run, " +
      "whose idempotent reconstruct absorbs it (the input's home is the phase's plan-input.md; plan --phase prepares it assisted). " +
      "--append appends the tasks planned from the input to the phase the route names now, never advancing to another phase (in m mode the input already implies the append on a non-empty index); it requires an input, " +
      "refuses while a task is mid-pipeline, and a stale handover of the phase is removed and distilled again after the appended tasks. " +
      '--new-task "<one-line title>" adds the one task you name with no session at all — the driver allocates the number, writes docs/T-NNN/todo.md and the index line and commits (targeting, guards and the stale-handover removal as --append\'s; ' +
      "the title is the whole task content, so review the document before run). " +
      "--export <T-NNN> | --adopt <T-NNN> are the standalone work-order routes (plans/0076): --export renders a ready unit's work order to stdout (nothing persisted — run it with your own coding-agent session outside the driver, " +
      "its question protocol the attended record-then-review shape), and --adopt re-checks the externally-driven unit, runs the test handover, performs the ticks and todo.md → done.md renames and lands the unified commit — " +
      "the driver-side closer a hand-commit would break. The two are mutually exclusive, and each refuses -p/--file, --append, --new-task and --force-close. " +
      "It takes run's session options; config options, --dryrun, --wait-between, --max-sessions, --repair and --boundary are refused. Exit codes as run's (the guards: the stub-round refusal 2, the state refusals 1)",
  ],
  [
    "plan-force-close",
    'plan --force-close <ref> --reason <text> closes a unit (close\'s semantics: the Closed: field, the close commit, a phase\'s mechanical handover) and continues planning in the same process under one run lock — ' +
      'replace a task (plan <dir> --force-close T-005 --reason "…" --append -p "do X instead") or skip a phase into the next one (plan <dir> --force-close R-01.P02 --reason "…"); ' +
      "--reason (one line, required) is the confirmation, and --cascade / --commit-changes | --stash-changes are close's options. " +
      "The close runs first: a refused close exits 1 with nothing done, a failed close commit exits 2, and after a successful close the exit code is plan's",
  ],
  [
    "plan-prep",
    "plan --round | --phase (mutually exclusive, no other option) are the assisted preparation stops (auto-core plans/0084): plan writes nothing itself — it points the AGENTS.md block's guidance at the document of the moment " +
      "so your own coding agent, interactive or not, can help you fill it. --round targets the round brief docs/R-NN/round.md of the round at hand (goal, acceptance and release criteria; in m mode the stub is written, round-close needs it); " +
      "--phase targets the planning input docs/R-NN/P<nn>-<type>/plan-input.md of the next phase to plan (the active intent pack's scaffold rides in the guidance, and plan --scaffold prints it to stdout); " +
      "the existing gates check the result — the round-start gate for the brief, the construct's own input read for the input (phased: transfer reads it and stops for review; m mode: plan's session). " +
      "In m mode on a fresh target (no rounds yet) the first plan opens the assisted project analysis instead — the phased project-start shape is transfer's below; " +
      "OPENCODE_AUTO_ANALYSIS=off skips the analysis and establishes R-01 directly, as plan always did in m mode",
  ],
  [
    "transfer",
    "transfer [dir] is the single advance command of the person-bracketed boundaries (auto-core plans/0101): one advance per invocation, resolved by state — " +
      "the project start (the assisted project analysis re-homed from plan: the stub, the release gate, the brief install, R-01 established under the released roadmap's line for the round, stopping at the round-start gate — review the setup, fill docs/R-NN/round.md, commit), " +
      'the phase boundary (a survey with open forks refuses exit 2 ahead of any session until your "Clarified: yes"; released, the advance distills the handover, closes the phase — installing the approved project brief — ' +
      "and constructs the next phase's plan task docs/T-NNN/todo.md, stopping for your review: the todo is driver-owned, a rejection is fixed through its inputs — round.md, plan-input.md, the brief, the roadmap line — and transfer re-run), " +
      "the round close (the same invocation when the closed phase was the round's last: the round-close checks gate it, and the stop is your moment with the round's close — its ## Close listing, a commissioned report-for-user.md beside it), " +
      "and the round open (the roadmap's next line applied, the establish stop naming its source; a released roadmap that plans no line for the next round is exhausted — extend ## Roadmap and re-run, exit 0). " +
      "plan dispatches the reviewed plan task, run executes the phase and stops at its clean end. " +
      "--resynthesize bypasses the digest keep of a standing plan task: the constructor session re-voices the sources under the charter and the reconstruct lands the new todo for review — the channel for a rejected synthesized ledger " +
      "(a rejected input needs no flag, the plain re-run absorbs it). m mode refuses (its plan/run shapes stand); it takes run's session options only",
  ],
  [
    "clarify",
    'clarify [dir] is the person\'s release command (auto-core plans/0116): it writes the whole-line "Clarified: yes" into the one document a gate is awaiting and commits it — the unreleased docs/analysis.md at the project start, ' +
      'or the held survey.md of the current human-gated phase (open "Fork:" lines) at a phase boundary — byte-identical to a correct hand edit plus its commit, which is exactly what it saves you: finding the document, ' +
      "writing the marker exactly (an inline or lowercase form does not release), and committing the edit (the advance runs only on a committed state). " +
      'Before writing it prints what the release accepts — the survey\'s Fork: lines with their "Recommend:" defaults, the analysis\'s roadmap lines — so running it is the review; the mark accepts every default, ' +
      "and your own answers sit beside the fork lines (before, riding the release commit, or after, as a plain committed edit the planners read). The gates stay the mechanical authority and the manual path stays fully supported. " +
      "It refuses (exit 2) when nothing awaits, when problems hold the release, when a Fork: line lacks its Recommend: default, or when the worktree is dirty beyond the target document; " +
      "it takes a directory argument only, refuses beside a live run, and never starts a session",
  ],
  [
    "close",
    "close <ref> closes a unit (task T-NNN, phase R-NN.P<nn> or round R-NN) without completing it — done for scheduling, never delivered: the reason goes into a Closed: field of the unit's done.md, " +
      'a close commit (Auto-Stage: force-close), and for a phase a driver-written mechanical handover that records the skipped gates. The ref comes first (then the directory); the explicit ref and the required one-line --reason are the confirmation (no prompt), ' +
      'and the undo is "git revert" of the close commit, printed in the output and valid before anything else runs. ' +
      "--cascade closes explicit dependents too (tasks whose Depends: names a closed unit, repeating over their chains); --commit-changes / --stash-changes handle uncommitted changes (folded into the close commit / stashed away) — " +
      "without one, anything beyond the driver's own state files refuses the close. Exit codes: 0 closed; 1 refused or usage error; 2 the close commit or close-out check failed",
  ],
  [
    "land",
    "land [dir] lands each branch-isolated repository's round of work (config isolate, the auto/R-NN branch round establishment switched it onto) back onto its original branch as one commit — " +
      "default git merge --squash (the deliverable's history gains exactly one commit; --merge takes a true merge commit instead) — deletes the round branch and prints the landed SHA. " +
      "Landing mid-round is allowed with --keep: the branch is retained and checked back out — the round simply continues on it; a later land recognizes the previous landing and folds only the new commits. " +
      "--abandon discards the round branch after a person-reviewed reset — the undo path: it checks the original branch back out, deletes auto/R-NN (its tip printed, recoverable via git reflog) and lands nothing. " +
      "The original branch is derived, never guessed: the establishment's own reflog record names it, with exactly-one-branch-outside-the-driver-families as the floor — a second ordinary branch never blocks; " +
      "--onto <branch> names it outright when the evidence cannot (no reflog record, an ambiguous floor, or the record's branch deleted — auto-core plans/0192). " +
      "Refusal is never an automated merge resolution: the original branch moved, foreign commits mixed into auto/R-NN's range, a dirty repository or an ambiguous original branch all block (exit 2) naming what to settle; " +
      "preflight warns about a leftover auto/R-NN of an abandoned round (recoverable state — land --abandon and plain git both address it). " +
      "The audit-trail trade-off is stated, not hidden: one commit on the deliverable, the full per-unit trail in the driven root's git. Exit codes: 0 landed; 1 usage error; 2 blocked for human",
  ],
  [
    "run-lock",
    "run lock: run, plan and transfer hold .auto/run.lock while they work (a plan --force-close holds it across the close and the planning alike; transfer holds it across its state checks and the advance), " +
      "close holds it around its writes, and land around its branch moves; init, amend, clarify, fix, sync and reset refuse while another process holds it (fix/sync --dryrun read and print only, so they run beside a live run; " +
      "-f does not override the refusal), and status shows it on its first line. A lock whose process is gone is removed by the next run, plan or close",
  ],
  [
    "new-session",
    "--new-session when resuming from an interruption, do not reuse the interrupted session; start a new one (only skips session reuse; exact phase re-entry is unaffected; by default the surviving interrupted session is reused)",
  ],
  ["mode", "-m/--mode prompt-level scenario mode (built-in migrate; add or override via .opencode/auto/modes/<name>.md in the target directory — new modes need no source changes)"],
  [
    "prompt",
    "-p/--prompt is the planning input of plan (-p <text> | --file <path>; plan --scaffold prints a template to complete into a file); on every other command it is refused. " +
      "The project brief .opencode/auto/brief.md is installed from approved proposals (the project analysis's release first, then every survey release — the latest approval is the entire file) and revised only by amend's --brief/--brief-file, the person's manual override — " +
      "never hand-edited mid-run; every planning session reads it. State the migration source and target there — --source-dir/--source-path/--dest-dir are retired",
  ],
  [
    "reset",
    "reset de-initialization (inverse of init): removes the config-layer artifacts init wrote (.opencode/auto/config.json, .opencode/agent/auto.md, legacy .auto/config.json, the AGENTS.md opencode-auto block, " +
      "the .gitignore entries init wrote (tmp/, .auto/, the local-only files and nested git repositories), plus opencode.json if unmodified); the project brief .opencode/auto/brief.md is kept " +
      "(an installed approved proposal or a person's amend --brief write — delete it by hand if you mean to); docs/, .auto/ runtime state and tmp/ are never touched; empty directories only are reclaimed (preserving .opencode/auto/prompts/ and your other agent contracts)",
  ],
  [
    "phases",
    "--phases <admtvk subsequence with m | type-id list> phased flow (a analysis → d design → m migration implementation → t test → v acceptance → k knowledge distillation; " +
      '"m" default = the manual single phase P01-implement, no planning or handover session — the compatibility floor (plans/0137: machinery kept, not a supported way of working for new projects; a phased project starts at init --phases or --intent); alternatively a comma-separated list of phase type ids in any order, repeats allowed, containing implement (e.g. analysis,security-review,implement), ' +
      "where custom types are defined one per file in .opencode/auto/phases/<type>.md). " +
      "init's alone: amend refuses --phases outright (plans/0137 — a round's phases reshape by moving or adding its `- R-NN <phases> — <goal>` line in docs/analysis.md, the next transfer re-deriving the unstarted tail; the config key is init-stamped machinery), and a mid-round re-init must keep the completed phases and the directories holding work (the prefix guard)",
  ],
  [
    "test-by-driver",
    "--test-by-driver [true] moves compile/test/build/lint execution rights to the driver: execution-type sessions no longer run such commands in-session; instead they write the commands as scripts into test/ " +
      "and put the script path in tmp/test.sh for the driver, which merges stdout/stderr into tmp/test.<n>.out and feeds the exit code and output file back to the session for the AI to judge",
  ],
  [
    "handover-test",
    "--handover-test requires --test-by-driver: when a session's context reaches its cap, hand over at the moment it next initiates a test — the driver first commits the finalized pinned script and sources, " +
      "and has the AI write remaining work that does not depend on test results to disk plus a handover document (subtask sessions: docs/<task>/S<two-digit>/testhandoff.md; whole-task sessions: docs/<task>/testhandoff.md) before ending the session; " +
      "the document is archived as testhandoff-<n>.md with one more commit to confirm the handover, and only then does the test run (what gets tested is exactly that commit's tree); " +
      "a new session reads the results and continues, avoiding repeated trial-and-error in an oversized context. " +
      "If the handover is interrupted, the next run locates the breakpoint from the document's file and commit state (wrap-up unfinished → fork from the finalized point and redo the wrap-up; written → add the missing commit and run the script). " +
      "Set OPENCODE_AUTO_HANDOVER_CONCURRENT=on to restore the old concurrent timing (tests start right after finalization, parallel to the session wrap-up, testing the finalized snapshot)",
  ],
  [
    "auto-number",
    "--auto-number / --no-auto-number auto-numbering switch (default --auto-number = on; --no-auto-number is the opt-out): task numbers (T-NNN) never repeat among the target directory's task artifacts — " +
      "the next free number is derived from them (the highest number any task index lists or any docs/T-* path holds, + 1) and phase planning sessions continue from it (no longer restarting from T-001 each phase); " +
      "a fresh clone or fork worktree continues exactly where its own files say (no record is kept, nothing is recovered)",
  ],
  ["wrapup", "--wrapup / --no-wrapup task wrap-up session switch (default --wrapup = on; --no-wrapup is the opt-out): when off, the wrap-up session is skipped after each task's subtasks/whole-task execution completes (including wrap-up after fix rounds)"],
  [
    "agent",
    "--agent opencode|claude the coding agent that runs every session (default opencode; claude = Claude Code headless, needs the claude CLI on PATH). The agent contract is always .opencode/agent/auto.md; " +
      "the env var OPENCODE_AUTO_AGENT overrides the configured agent for a run",
  ],
  [
    "parallel",
    "--parallel none|low|medium|high code-phase planning depth (default none): how hard planning sessions work to make implement/test tasks independent (declared Depends:/Touches: fields, tasks split along file and module boundaries) for worktree-lane execution; " +
      "the level's text comes from the ## parallelism section of the intent pack, rendered for code-work phases and m mode — doc phases read ## doc-parallelism, keyed on the run's width, not the level. It never gates concurrency and sets the landing-conflict posture (low blocks on the first conflict; " +
      "medium/high allow one repair merge before blocking); which machinery executes concurrently is the --tree-lanes tier's call, not the level's",
  ],
  [
    "tree-lanes",
    "--tree-lanes off|auto|on the execution tier of concurrent runs (default off): off = tier 0, process parallelism in one tree — task sessions run serially in the main tree while the project's test suites run as parallel driver processes " +
      "(and parallel session lanes) against it, no extra checkouts; on = tier 2, the full git worktree per concurrent task (each lane holds the whole checkout, merged back serially); " +
      "auto = the run's preflight probes the filesystem and the declared lanes.treeBudgetMB budget — reflink-capable (btrfs/XFS) and within budget it runs tier 1, sparse CoW worktree lanes (a --no-checkout worktree materialized over the unit's Touches: by reflink, " +
      "with the project's declared lanes.caches cache homes injected per lane), else it falls through to tier 0 with the reason logged. " +
      "The lanes.caches / lanes.treeBudgetMB / lanes.sparseFloor knobs beside it are hand-edited in .opencode/auto/config.json like acceptanceGate and build",
  ],
  [
    "scan-exempt",
    "--scan-exempt none|<globs> comma-separated path globs, relative to the target directory, of deliverable files the driver's content scans skip (default none): the process-document reference scan " +
      "(unit close-out and round close, inside the nested destination repositories alone — the working directory's own files are process workspace, never scanned, auto-core plans/0108) and the document terminator scan. " +
      "For deliverables where such strings are content, e.g. a destination's own test fixtures; a glob naming a directory covers the files under it; " +
      "only deliverable paths are exempted (process documents are never scanned for references anyway); the list replaces the stored one, none removes it",
  ],
  [
    "isolate",
    "--isolate <rel-path> (repeatable) branch isolation of nested repositories (default none): at round establishment each designated repository — named by a repository-relative path holding a .git, never the target root — " +
      "is switched onto the branch auto/R-NN, so the driver's per-session commits land there while the repository's original branch never moves; a designated repository that is not clean at establishment blocks the round for human attention. " +
      "The list replaces the stored one, none removes it",
  ],
  [
    "max-sessions",
    "--max-sessions <n> run option: the number of AI sessions running concurrently (counts sessions; unrelated to --agent). The default 1 runs everything serially; above 1 gives documentation waves out of the box — documentation-scoped tasks run side by side as their declared Depends/Touches allow, doc phases' planning arranging the declarations at this width (the pack's ## doc-parallelism teaching, no config needed); " +
      "code tasks run concurrently only under --tree-lanes (the execution tier: the default runs them serially in one tree with the tests parallel; on/auto run them as concurrent lanes in isolated worktrees, a level — init --parallel — adding their planning depth); " +
      "--interactive and --wait-answer are refused above 1 (one human cannot steer concurrent sessions)",
  ],
  [
    "boundary",
    '--boundary stop|flow run option (auto-core plans/0101): run\'s shape at the phase boundaries. stop (the default) ends the run at the current phase\'s clean end — every unit done, the lanes landed — before the handover, ' +
      'naming transfer as the advance command (a survey with open forks stops exit 2 awaiting your "Clarified: yes"); flow restores the continuous crossing of the boundaries, for trusted unattended stretches. ' +
      "A run-side width only — never a config key — and orthogonal to plan's stop condition",
  ],
  [
    "repair",
    "--repair [1-10] run option (auto-core plans/0079 §4): the bounded repair budget — how many automatic repair rounds a task report's Result: FAIL (or a held verdict gate) may drive before blocking for the human: " +
      "the failed task is closed and an appending session adds rework tasks over the report's evidence, which then run and re-verify. Acceptance gates never auto-repair — the human's sign alone; serial runs only, never persisted",
  ],
  [
    "stop-after",
    "--stop-after <T-NNN> run option (auto-core plans/0128): the task whose completion ends this run — the retry's guardrail (fork prints the hint), usable anywhere the serial loop runs. " +
      "The run stops cleanly (exit 0) once that task closes, its handover and the phase's remaining tasks staying for the next run; an already-complete target stops at once; a target outside the routed phase's index is a usage error. " +
      "Serial runs only — refused beside --max-sessions ≥ 2 and the lane switches; never persisted",
  ],
  [
    "fork",
    "fork <T-NNN | sha> <worktree-path> (auto-core plans/0128): build an experiment environment in a new directory and retry a task from its beginning — or experiment at any exact commit — without the main tree, its branches or its history being touched. " +
      "A task target T-NNN forks at the state before the task first started (the parent of its oldest Auto-Task commit of the current corpus — a task number re-issued after a wipe-and-restart never forks at the state before the restart, plans/0140; the success line names the older lineage when one exists); a sha target forks at that commit itself. Nested repositories are reconstructed alongside, aligned at the state the fork commit records. " +
      "The environment is self-resetting (no .auto/ runtime state rides over; the task documents at that commit already read pending); run it with opencode-auto run <path> [--stop-after T-NNN], bring work back with plain git, clean up with remove-fork. " +
      "It takes no run lock (plans/0129 — its only writes in the source repositories are the auto-fork/* branches and worktree registrations, nothing a running driver reads), so it runs beside a live run there. " +
      "Exit codes: 0 forked / 1 the target or path cannot give what was asked / 2 a git failure midway, the partial state named",
  ],
  [
    "remove-fork",
    "remove-fork <worktree-path> (auto-core plans/0139): tear down a fork — every worktree of the fork removed (its nested repositories' first, the root's last) and the one auto-fork/* branch deleted in each of its repositories — so the path is free and a retry takes the stem branch name again; the branch tips are printed and stay recoverable via git reflog. " +
      "The record it reads is git's own (the worktree registrations and the branch family — nothing is persisted about a fork), so the worktree must be a registered one of this project on an auto-fork/* branch: a lane park, a person worktree or a stranger path is refused, never touched. " +
      "Uncommitted work in the fork blocks naming the files (commit it or bring it back by hand) — re-run with --force to discard it explicitly; a run live inside the fork refuses (stop it first). " +
      "Like fork it takes no run lock (plans/0129's argument: its source-tree writes are the branch family and the registrations alone), so it runs beside a live run in the source. " +
      "Exit codes: 0 removed / 1 the path is not a fork of this project / 2 blocked — the live run, the uncommitted work, or a git failure midway (the removal is resumable by re-running)",
  ],
  [
    "commit-retired",
    "--commit is retired: committing cannot be turned off — after any session ends the driver recursively commits all changes (git history is the audit trail of AI changes; --commit false and the old alias none were retired on 2026-09-15, " +
      "and with the config key gone the flag went entirely). A stored commit: true in .opencode/auto/config.json still loads and is ignored; any other stored value fails loading (opencode-auto fix <dir> drops the key)",
  ],
  [
    "implement-retired",
    "--implement-file / --implement-prompt are retired: plan tasks with opencode-auto plan <dir> -p <text> | --file <path> (after plan establishes the round and its setup is committed)",
  ],
  [
    "models",
    "models prints the model registry's effective table without starting an agent: the layers it was read from (the operator layer $OPENCODE_AUTO_MODELS, else $XDG_CONFIG_HOME/opencode-auto/models.json; the project layer .opencode/auto/models.json, local-only), " +
      "each agent profile (adapter, bin, server, env variable names — never values), each model entry (its layer, steps, windows and key ring by reference name) with whether it is usable now and why not " +
      "(outside its windows, filtered out by the agent filter, a known context window below the project cap), the tiers, routes and classifier list, and per phase type and role the tier, the route in force and the ordered candidates. " +
      "It exits 0 without a registry (one line) and 1 with the problems run and plan would refuse at start (bad JSON, an unknown field, a broken reference, a project layer git would commit); it takes no run lock; " +
      "--probe additionally sends the recovery probe prompt to each listed model (opt-in, it costs tokens), printing each model's answer or failure, and a failed probe is a finding, not a command error; " +
      "--probe=false is the explicit opt-out (the boolean forms every other flag takes)",
  ],
  [
    "status",
    "status prints the project config summary, a live run lock on its first line when one is held, and the current round's read-only overview tree — round → phase → task → subtask, with status and dependencies; " +
      "an invalid config only warns and never blocks the overview, a missing or invalid phase/task index shows as ⚠ lines, and nothing is written",
  ],
  [
    "install-prompts",
    "install-prompts resyncs the manual-driver prompt suite into the project: every suite file is copied byte-identical into <dir>/prompts/ (differing content rewritten, identical files untouched) " +
      "and files the suite does not carry are reported and left alone; it also writes prompts/MANIFEST — the per-file digests and the suite-level digest of the installed vintage, the pin an arm commits instead of the suite's bytes (plans/0164); " +
      "it requires an initialized project, writes nothing a running driver reads, takes no run lock and runs no git — the person reviews and commits the resync",
  ],
  [
    "install-prompts-check",
    "--check answers the drift question without writing: it compares the target's prompts/ against this binary's embedded suite and the manifest against the vintage it should pin, " +
      "prints the drifted and missing files and the manifest's state, and exits 0 clean or 1 with any drift (a scripted gate — run it before handing a target to a manual-driver session; local additions are reported and never count as drift)",
  ],
  [
    "continue-retired",
    `continue is retired: once the round is complete, fill in ## Close of docs/R-NN/round.md, commit, and run ${shellProfile().bin} transfer <dir> — it runs the round-close checks and opens the next round`,
  ],
  ["check-retired", `check is retired: the principle scan and the reference check were removed; ${shellProfile().bin} fix --dryrun <dir> lists the configuration findings`],
]
// The exit-codes line and the per-command pointer close every help view.
// 3 is the /exit pause under --interactive (auto-core plans/0143): the core's
// loop converts the request at a safe boundary; the help row carried only
// 0/1/2/130 while README and MANUAL already named 3 — one vocabulary, one
// conscious lockstep (P13).
const EXIT_CODES =
  "exit codes: 0 all complete (including the boundary stop of run --boundary stop and transfer's review stops); 1 usage/environment error (the same code fix --dryrun answers with configuration findings); " +
  "2 blocked/incomplete awaiting human intervention (including a task report whose result line reads Result: FAIL); " +
  "3 /exit received under --interactive, paused and exited at a safe boundary (no human attention needed — rerunning recovers fully); " +
  "130 force-terminated by two consecutive Ctrl+C"
// The public command rows, in the full usage's order. Every `options` key
// must exist in OPTION_HELP (or be "frozen") — the table is static and
// reviewed together.
const COMMANDS: readonly CommandHelp[] = [
  {
    name: "init",
    summary: "write a project's config layer as a stateless full overwrite (config.json, opencode.json, the agent contract, the AGENTS.md block, .gitignore)",
    synopsis:
      "opencode-auto init [dir] [-m|--mode <name>] [--agent opencode|claude] [--subtask [off|auto|true|ondemand]] [--idle-time [1-120]] [--idle-max [1-1440]] [--context-limit [n]] [--phases <admtvk subsequence with m | type-id list>] [--intent <name>] [--test-by-driver [true|false]] [--handover-test [true|false]] [--auto-number|--no-auto-number] [--wrapup|--no-wrapup] [--parallel none|low|medium|high] [--tree-lanes off|auto|on] [--scan-exempt none|<globs>] [--isolate <rel-path>]... [--name <name> --email <email>] [-f|--force]",
    options: ["frozen", "init", "mode", "prompt", "phases", "test-by-driver", "handover-test", "auto-number", "wrapup", "agent", "parallel", "tree-lanes", "scan-exempt", "isolate", "force", "run-lock"],
  },
  {
    name: "run",
    summary: "execute the current phase's tasks one by one — the driver commits after every session — and stop at its clean end, the phase boundary",
    synopsis:
      "opencode-auto run [dir] [--server <url>] [--verbose [true|false]] [--interactive|-i] [--wait-answer [1-60]] [--wait-between [1-60]] [--permission [auto-allow|ask-allow|ask-deny|ask-fail]] [--dryrun [true|false]] [--new-session] [--max-sessions <n>] [--boundary stop|flow] [--repair [1-10]] [--stop-after <T-NNN>]",
    options: ["frozen", "new-session", "max-sessions", "boundary", "repair", "stop-after", "run-lock"],
  },
  {
    name: "plan",
    summary: "plan the current phase and stop before execution, for review (the dispatch half of the person-bracketed boundary)",
    synopsis:
      'opencode-auto plan [dir] [-p|--prompt <text> | --file <path>] [--append] [--new-task "<one-line title>"] [--scaffold] [--round | --phase] [--export <T-NNN> | --adopt <T-NNN>] [--force-close <ref> --reason <text> [--cascade] [--commit-changes | --stash-changes]] [--server <url>] [--verbose [true|false]] [--interactive|-i] [--wait-answer [1-60]] [--permission [auto-allow|ask-allow|ask-deny|ask-fail]] [--new-session]',
    options: ["frozen", "plan", "plan-force-close", "plan-prep", "prompt", "new-session", "run-lock"],
  },
  {
    name: "transfer",
    summary: "advance one person-bracketed boundary per invocation, resolved by state — the single advance command",
    synopsis:
      "opencode-auto transfer [dir] [--resynthesize] [--server <url>] [--verbose [true|false]] [--interactive|-i] [--wait-answer [1-60]] [--permission [auto-allow|ask-allow|ask-deny|ask-fail]] [--new-session]",
    options: ["frozen", "transfer", "new-session", "run-lock"],
  },
  {
    name: "clarify",
    summary: "write the person's Clarified: yes release mark into the one document a gate awaits, and commit it",
    synopsis: "opencode-auto clarify [dir]",
    options: ["clarify"],
  },
  {
    name: "close",
    summary: "close a unit (task T-NNN, phase R-NN.P<nn>, round R-NN) without completing it — done for scheduling, never delivered",
    synopsis: "opencode-auto close <ref> [dir] --reason <text> [--cascade] [--commit-changes | --stash-changes]",
    options: ["close", "run-lock"],
  },
  {
    name: "land",
    summary: "land branch-isolated repositories' round of work back onto their original branches (the person-invoked return path)",
    synopsis: "opencode-auto land [dir] [--keep] [--abandon] [--merge] [--onto <branch>]",
    options: ["land", "run-lock"],
  },
  {
    name: "fork",
    summary:
      "build an experiment environment in a new worktree — at the state before a task first started (T-NNN) or at an exact commit — to retry it in isolation; the main tree is never touched",
    synopsis: "opencode-auto fork <T-NNN | sha> <worktree-path> [dir]",
    options: ["fork"],
  },
  {
    name: "remove-fork",
    summary:
      "tear down a fork — every worktree of the fork removed and its auto-fork/* branch deleted per repository — freeing the path (and the branch name) to fork again",
    synopsis: "opencode-auto remove-fork <worktree-path> [dir] [--force]",
    options: ["remove-fork"],
  },
  {
    name: "amend",
    summary: "change the config keys given and keep the rest, rewriting what renders from the config",
    synopsis:
      "opencode-auto amend [dir] [-m|--mode <name>] [--agent opencode|claude] [--subtask [off|auto|true|ondemand]] [--idle-time [1-120]] [--idle-max [1-1440]] [--context-limit [n]] [--intent <name>] [--test-by-driver [true|false]] [--handover-test [true|false]] [--auto-number|--no-auto-number] [--wrapup|--no-wrapup] [--parallel none|low|medium|high] [--tree-lanes off|auto|on] [--scan-exempt none|<globs>] [--isolate <rel-path>]...|none [--brief <text> | --brief-file <path>]  # revise the config per key (the phases key excepted — init-stamped machinery, plans/0137: a round reshapes by its roadmap line)",
    options: ["frozen", "amend", "mode", "prompt", "phases", "test-by-driver", "handover-test", "auto-number", "wrapup", "agent", "parallel", "tree-lanes", "scan-exempt", "isolate"],
  },
  {
    name: "fix",
    summary: "repair the config layer by rule — never changing a key's meaning",
    synopsis: "opencode-auto fix [dir] [-f|--force] [--dryrun [true|false]]",
    options: ["fix", "force", "run-lock"],
  },
  {
    name: "sync",
    summary: "upgrade a materialized intent bundle to the running binary's",
    synopsis: "opencode-auto sync [dir] [-f|--force] [--dryrun [true|false]] [--from-bundle]",
    options: ["sync", "force", "run-lock"],
  },
  {
    name: "release",
    summary: "certify the destination repository stands alone — the release gate (the containment findings the rounds defer block here)",
    synopsis: "opencode-auto release [dir]",
    options: ["release"],
  },
  {
    name: "reset",
    summary: "de-initialize: remove the config-layer artifacts init wrote and restore the uninitialized state",
    synopsis: "opencode-auto reset [dir] [-f|--force]",
    options: ["reset", "force", "run-lock"],
  },
  {
    name: "status",
    summary: "print the read-only overview — the project config, a live run lock, the current round's tree",
    synopsis: "opencode-auto status [dir]",
    options: ["status", "run-lock"],
  },
  {
    name: "models",
    summary: "print the model registry's effective table without starting an agent",
    synopsis: "opencode-auto models [dir] [--probe [true|false]]",
    options: ["models"],
  },
  {
    name: "install-prompts",
    summary: "resync the manual-driver prompt suite into the project's prompts/ and pin its vintage in prompts/MANIFEST (you review and commit)",
    synopsis: "opencode-auto install-prompts [dir] [--check]",
    options: ["install-prompts", "install-prompts-check"],
  },
  {
    name: "driver-helper",
    summary: "render the person-proxy brief a coding-agent session pastes at a boundary run cannot cross",
    synopsis: "opencode-auto driver-helper [dir]",
    options: ["driver-helper"],
  },
]
const OPTION_TEXT: ReadonlyMap<string, string> = new Map<string, string>([
  ["frozen", FROZEN_OPTIONS] as const,
  ...OPTION_HELP.map(([key, text]) => [key, text] as const),
])
const COMMAND_BY_NAME: ReadonlyMap<string, CommandHelp> = new Map(COMMANDS.map((entry) => [entry.name, entry]))
// The words that name a command: the public sixteen plus `_lane` — the
// hidden lane-worker entry is a real command (the parent run's launcher
// invokes this CLI with it) but never appears in any help surface; its own
// option ladder below answers everything it is passed, --help included.
const KNOWN_COMMANDS: ReadonlySet<string> = new Set([...COMMANDS.map((entry) => entry.name), "_lane"])

// The closest live command names for an unknown word (the unknown-command
// refusal's suggestions): edit distance 1 always suggests (2 from five
// letters on), a prefix of a command name suggests from two letters, and
// the closest three are named. Retired commands never suggest — their
// notice is their one answer.
function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const held = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = held
    }
  }
  return row[b.length]!
}
function similarCommands(word: string): string[] {
  return COMMANDS.map((entry) => entry.name)
    .filter((name) => name !== word)
    .map((name) => ({ name, distance: editDistance(word, name), prefix: word.length >= 2 && name.startsWith(word) }))
    .filter((candidate) => candidate.prefix || candidate.distance <= (word.length >= 5 ? 2 : 1))
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((candidate) => candidate.name)
}

// The full usage — the text the bare invocation prints to stderr (exit 1)
// and --help to stdout (exit 0): every synopsis, the options section (the
// frozen-options line, then every paragraph in table order, indented to
// align under "options: ") and the exit codes.
function renderFullUsage(): string {
  const lines: string[] = ["usage:"]
  for (const entry of COMMANDS) lines.push(`  ${entry.synopsis}`)
  lines.push("", `options: ${FROZEN_OPTIONS}`)
  for (const [, text] of OPTION_HELP) lines.push(`        ${text}`)
  lines.push("", EXIT_CODES, "run 'opencode-auto <command> --help' for one command's options")
  return lines.join("\n")
}

// One command's --help view: its synopsis (the full argument grammar), the
// summary line and its option paragraphs, closed by the shared exit codes
// and the pointer at the full usage.
function renderCommandHelp(entry: CommandHelp): string {
  const lines: string[] = ["usage:", `  ${entry.synopsis}`, "", `${entry.name} — ${entry.summary}`, ""]
  for (const key of entry.options) lines.push(`  ${OPTION_TEXT.get(key)!}`)
  lines.push("", EXIT_CODES, "run 'opencode-auto --help' for all commands")
  return lines.join("\n")
}

// The help and refusal interception. It sits after the retirement notices
// above (a retired command has no help — its notice is the one answer,
// whatever follows it) and ahead of the owned-flag refusals and the option
// whitelist below: --help outranks every option policy (a person asking for
// help is answered, whatever else rides the line). An unknown command is a
// one-line refusal naming the closest commands — the root cause and the
// remedy, not the full usage dump; only a missing subcommand prints the
// full text (the file's last block).
if (command === "--help" || command === "-h") {
  console.log(renderFullUsage())
  process.exit(0)
}
if (command !== undefined && !KNOWN_COMMANDS.has(command)) {
  const suggestions = similarCommands(command)
  // A path-shaped word (./x, ~/x, /x, a/b) is the command-after-directory
  // mistake: the message names the shape instead of suggesting commands.
  const pathShaped = command.includes("/") || command.startsWith(".") || command.startsWith("~")
  console.error(
    `opencode-auto: '${command}' is not a command` +
      (suggestions.length && !pathShaped ? ` (did you mean ${suggestions.map((name) => `'${name}'`).join(" or ")}?)` : "") +
      (pathShaped ? " — the command comes first: opencode-auto <command> [dir] [options]" : "") +
      `; run 'opencode-auto --help' to see all commands, or 'opencode-auto <command> --help' for one command's options`,
  )
  process.exit(1)
}
if (flags.has("help")) {
  const entry = command === undefined ? undefined : COMMAND_BY_NAME.get(command)
  if (entry) {
    console.log(renderCommandHelp(entry))
    process.exit(0)
  }
}

// Flags one command owns: every other command refuses them with a pointer at
// the owning invocation, before any whitelist or command block runs (run's
// -p/--file refusal pattern, auto-core plans/0053 D23/D28). One row per
// owning route — --append (D23, appending to the current phase), --force-close
// (D28, closing a unit and keeping planning), --scaffold (plans/0081 D12, the
// planning-input template), --new-task (plans/0058, the no-session task add),
// --export/--adopt (plans/0076, the standalone work-order routes),
// --round/--phase (plans/0084, the assisted preparation stops), transfer's
// --resynthesize (plans/0101 D3, the advance's construct half), land's
// --keep/--abandon (plans/0074 §2.3, U-L2, one line for the pair) and
// --onto (plans/0192, the original branch's name — a value flag, so without
// an owned refusal `run <dir> --onto <x>` would start a full run with the
// flag silently ignored), sync's
// --from-bundle (plans/0100 D5, the unstamped bootstrap's overwrite
// assertion — the flag passed the global whitelist for every command while
// only sync consumed it, so `run <dir> --from-bundle` started a full run
// with the flag silently ignored) and models' --probe (plans/0055 §9, the
// opt-in probe — joining BOOLEAN_FLAGS put it on the whitelist too, so it
// needs the same owned refusal to keep `run --probe` an error rather than a
// silently ignored word) — in refusal order: with several offending flags
// present, the first row answers.
const OWNED_FLAGS: ReadonlyArray<{ owner: string; keys: readonly string[]; line: (key: string, command: string | undefined) => string }> = [
  {
    owner: "plan",
    keys: ["append"],
    line: (_key, command) =>
      `--append is a plan option: ${command ?? "this command"} takes no --append. Append tasks with opencode-auto plan <dir> --append -p <text> | --file <path>`,
  },
  {
    owner: "plan",
    keys: ["force-close"],
    line: (_key, command) =>
      `--force-close is a plan option: ${command ?? "this command"} takes no --force-close. ` +
      `Close a unit and keep planning with opencode-auto plan <dir> --force-close <ref> --reason <text>; to only close, opencode-auto close <ref> [dir] --reason <text>`,
  },
  {
    owner: "plan",
    keys: ["scaffold"],
    line: (_key, command) =>
      `--scaffold is a plan option: ${command ?? "this command"} takes no --scaffold. Print the planning-input template with opencode-auto plan <dir> --scaffold`,
  },
  {
    owner: "plan",
    keys: ["new-task"],
    line: (_key, command) =>
      `--new-task is a plan option: ${command ?? "this command"} takes no --new-task. Add a known task without a session with opencode-auto plan <dir> --new-task "<one-line title>"`,
  },
  {
    owner: "plan",
    keys: ["export", "adopt"],
    line: (key, command) =>
      `--${key} is a plan option: ${command ?? "this command"} takes no --${key}. ` +
      `Render a ready unit's standalone work order with opencode-auto plan <dir> --export <task id>, and close the externally-driven unit out with opencode-auto plan <dir> --adopt <task id>`,
  },
  {
    owner: "plan",
    keys: ["round", "phase"],
    line: (key, command) =>
      `--${key} is a plan option: ${command ?? "this command"} takes no --${key}. ` +
      `Prepare the round brief with opencode-auto plan <dir> --round, or the next phase's planning input with opencode-auto plan <dir> --phase`,
  },
  {
    owner: "transfer",
    keys: ["resynthesize"],
    line: (_key, command) =>
      `--resynthesize is a transfer option: ${command ?? "this command"} takes no --resynthesize. ` +
      `Re-voice a rejected plan task's synthesis with opencode-auto transfer <dir> --resynthesize`,
  },
  {
    owner: "land",
    keys: ["keep", "abandon"],
    line: (_key, command) =>
      `--keep and --abandon are land options: ${command ?? "this command"} takes neither. ` +
      `Land a round's isolation branches with opencode-auto land <dir> [--keep | --abandon]`,
  },
  {
    owner: "land",
    keys: ["onto"],
    line: (_key, command) =>
      `--onto is a land option (the original branch's name, the derivation ladder's first rung — auto-core plans/0192): ${command ?? "this command"} takes no --onto. ` +
      `Land a round's isolation branches with opencode-auto land <dir> [--onto <branch>]`,
  },
  {
    owner: "sync",
    keys: ["from-bundle"],
    line: (_key, command) =>
      `--from-bundle is a sync option (the unstamped bootstrap's overwrite assertion: opencode-auto sync <dir> --from-bundle); ` +
      `${command ?? "this command"} does not accept it — a bundle itself is materialized by init --intent alone`,
  },
  {
    owner: "models",
    keys: ["probe"],
    line: (_key, command) =>
      `--probe is a models option (the opt-in probe: opencode-auto models <dir> --probe); ${command ?? "this command"} does not accept it — ` +
      `the probe starts agents and costs tokens, so it never rides another command`,
  },
  {
    owner: "install-prompts",
    keys: ["check"],
    line: (_key, command) =>
      `--check is an install-prompts option (the read-only drift gate: opencode-auto install-prompts <dir> --check); ${command ?? "this command"} does not accept it — ` +
      `the check names the prompt-suite drift it found and writes nothing`,
  },
]
for (const owned of OWNED_FLAGS) {
  if (command === owned.owner) continue
  for (const key of owned.keys) {
    if (!flags.has(key)) continue
    console.error(owned.line(key, command))
    process.exit(1)
  }
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
  "is retired: the migration source and target are intent, not configuration — state them in the project analysis's `## Project brief` proposal (or opencode-auto amend <dir> --brief <text> | --brief-file <path>) or in the planning input, which planning sessions read"
const IMPLEMENT_RETIRED = "is retired: plan tasks with opencode-auto plan <dir> -p <text> | --file <path> (after plan establishes the round and its setup is committed)"
const INIT_PROMPT_RETIRED =
  "is retired: init takes no prompt and writes no brief — the project analysis (opened by the first plan/transfer) proposes and installs the brief, and the planning input is plan -p"
const INIT_BRIEF_RETIRED =
  "is retired on init: init writes no brief — the project analysis comes first. The first plan/transfer opens docs/analysis.md; its approved `## Project brief` proposal installs the brief on release. A later manual override: opencode-auto amend <dir> --brief <text> | --brief-file <path>"
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
  brief: { command: "init", notice: INIT_BRIEF_RETIRED },
  "brief-file": { command: "init", notice: INIT_BRIEF_RETIRED },
  amend: AMEND_FLAG_RETIRED,
}
const KNOWN_FLAGS = new Set([...VALUE_FLAGS, ...BOOLEAN_FLAGS, ...Object.keys(RETIRED_FLAGS), "continue", "commit-subtask", "verify-idle", "verify-max"])
// The config flags: the project attributes init freezes into config.json and
// amend changes one by one (plans/0052 D25); run refuses every one of them.
const CONFIG_FLAGS = ["mode", "agent", "context-limit", "subtask", "idle-time", "idle-max", "test-by-driver", "handover-test", "auto-number", "no-auto-number", "wrapup", "no-wrapup", "phases", "parallel", "scan-exempt", "isolate", "intent", "tree-lanes"]
// models takes exactly one option: --probe (§9's opt-in probe, which starts
// agents and spends tokens); install-prompts takes exactly one too: --check
// (plans/0164's read-only drift gate); status, release, driver-helper
// and clarify stay flagless (release certifies the destination as it stands —
// no options to shape a read-only gate; driver-helper renders the
// person-proxy brief from live state, plans/0105; clarify writes the person's
// release mark, plans/0116).
const MODELS_FLAGS = new Set(["probe"])
const INSTALL_PROMPTS_FLAGS = new Set(["check"])
const FLAGLESS = command === "status" || command === "models" || command === "release" || command === "driver-helper" || command === "clarify"
// reset is de-initialization with nothing to configure: it accepts only
// -f/--force (skips the confirmation and the worktree cleanliness gate).
// fix takes its baseline from the existing config and no config flags, so it
// accepts the same plus --dryrun (plans/0052 D11; the read-only listing of
// the findings, no write-side gates). sync (auto-core plans/0100 D4/D5) takes
// fix's pair plus --from-bundle (the unstamped bootstrap's opt-in overwrite:
// the person's assertion that a differing pack is pristine-but-old).
const RESET_FLAGS = new Set(["force"])
const SYNC_FLAGS = new Set(["force", "dryrun", "from-bundle"])
// close (auto-core plans/0053 D22) takes only its four flags: --reason (a
// value flag) and the booleans --cascade, --commit-changes, --stash-changes.
// Everything else is refused with a close-appropriate message below — the
// config flags with the frozen-by-init notice, -p/--file with plan's input
// notice — mirroring RESET_FLAGS for reset/fix.
const CLOSE_FLAGS = new Set(["reason", "cascade", "commit-changes", "stash-changes"])
// land (plans/0074 §2.3, U-L2; plans/0192 D2) takes only its four: the
// booleans --keep (retain the round branch: a mid-round landing), --abandon
// (discard it: the undo path) and --merge (the explicit merge-commit
// landing mode; a boolean here — _lane's --merge <branch> value flag of the
// same name is the hidden machine surface, checked below for the
// swallowed-value trap), plus the value flag --onto <branch> (the person's
// name for the original branch when the derivation ladder cannot answer —
// the establishment reflog record absent or expired, the exclusion floor
// ambiguous, or the record's branch deleted; checked below for its own
// value shape). Everything else is refused with a land-appropriate message,
// mirroring CLOSE_FLAGS.
const LAND_FLAGS = new Set(["keep", "abandon", "merge", "onto"])
// The unknown-option interception: every flag outside its command's policy
// below is an error with exit 1, so a typo is never silently ignored. The
// strict commands (close, land) run their own refusal ladder; the narrow
// readers (reset/fix/sync, models, install-prompts) and the flagless
// status/release/driver-helper/clarify
// name their whole surface; everything else (init/amend/plan/transfer/run and
// the hidden _lane) accepts the known flag vocabulary here and leaves its
// specific refusals to its command block (the frozen config flags, the
// planning input, the run-only options). Globally retired flags are waved
// through for their own notices below.
const similarOptions = (key: string): string[] => [...KNOWN_FLAGS].filter((name) => name.startsWith(key)).map((name) => `--${name}`)

// The strict ladder close and land share (mirroring RESET_FLAGS for
// reset/fix): the allowed set, then close's --commit swallow trap, the
// globally retired notices (they exit below), the frozen config keys with the
// amend hint, plan's input flags, and the unknown-option line with the
// command's usage and the spelling suggestions.
const strictOptionRefusal =
  (command: "close" | "land", allowed: Set<string>, usageLine: string) =>
  (key: string): string | undefined => {
    if (allowed.has(key)) return undefined
    // --commit keeps its close-specific refusal ahead of the generic
    // retirement notice below: it takes a value, so it would swallow
    // whatever follows it, and what a close caller means by it is the
    // dirty-worktree pair (auto-core plans/0053 D20/F8).
    if (command === "close" && key === "commit")
      return "--commit is retired (committing cannot be turned off — the driver commits after every session) and it takes a value, so it would swallow whatever follows it; the close options for a dirty worktree are --commit-changes and --stash-changes"
    // Globally retired flags keep their own notices below (they exit there);
    // a scoped entry (init's -p) does not fire for this command, so it must
    // not be waved through here either — the command's own refusals take it.
    if (typeof RETIRED_FLAGS[key] === "string") return undefined
    if (CONFIG_FLAGS.includes(key))
      return `${key === "mode" ? "-m/--mode" : `--${key}`} was frozen by init (.opencode/auto/config.json). To change: ${amendHint(key)}${configKeyRevision(key).file ? ", or edit that file directly" : ""}; ${command} takes no config options`
    if (key === "prompt" || key === "file")
      return `${key === "prompt" ? "-p/--prompt" : "--file"} is a plan option (the planning input: opencode-auto plan <dir> -p <text> | --file <path>); ${command} takes no planning input`
    const similar = similarOptions(key)
    return `--${key} is not a ${command} option${similar.length ? ` (did you mean ${similar.join(" / ")}?)` : ""}: ${usageLine}`
  }
const closeOptionRefusal = strictOptionRefusal(
  "close",
  CLOSE_FLAGS,
  "close takes only --reason <text>, --cascade, --commit-changes and --stash-changes (usage: opencode-auto close <ref> [dir] --reason <text>)",
)
const landOptionRefusal = strictOptionRefusal("land", LAND_FLAGS, "land takes only --keep, --abandon, --merge and --onto <branch> (usage: opencode-auto land [dir] [--keep] [--abandon] [--merge] [--onto <branch>])")
// One command's option policy: the refusal line for a flag, undefined to
// accept it here. Models (auto-core plans/0055 §9) and install-prompts
// (plans/0164) each read and print with one shaping option; status takes no
// options at all.
const optionRefusal = (key: string): string | undefined => {
  if (command === "close") return closeOptionRefusal(key)
  if (command === "land") return landOptionRefusal(key)
  if (command === "reset" || command === "fix" || command === "sync") {
    // fix accepts --dryrun beside -f/--force (reset does not); sync adds
    // --from-bundle on top (the bootstrap overwrite's opt-in).
    if (RESET_FLAGS.has(key) || (command === "fix" && key === "dryrun") || (command === "sync" && SYNC_FLAGS.has(key))) return undefined
    return `unknown option --${key}: ${command} only accepts a directory argument${command === "fix" ? ", -f/--force and --dryrun" : command === "sync" ? ", -f/--force, --dryrun and --from-bundle" : " and -f/--force"}`
  }
  if (command === "models") {
    if (MODELS_FLAGS.has(key)) return undefined
    return `unknown option --${key}: models takes only --probe (a directory argument and no other options)`
  }
  if (command === "install-prompts") {
    if (INSTALL_PROMPTS_FLAGS.has(key)) return undefined
    return `unknown option --${key}: install-prompts takes only --check (a directory argument and no other options)`
  }
  if (FLAGLESS) return `unknown option --${key}: ${command} only accepts a directory argument, no options`
  if (KNOWN_FLAGS.has(key)) return undefined
  const similar = similarOptions(key)
  // The pointer names the command's own --help view when there is one (the
  // hidden _lane has none — the generic pointer keeps it unnamed).
  const pointer =
    command && command !== "_lane" ? `run 'opencode-auto ${command} --help' to see this command's usage` : "run 'opencode-auto --help' to see usage"
  return `unknown option --${key}${similar.length ? ` (did you mean ${similar.join(" / ")}?)` : ""}; ${pointer}`
}
for (const key of flags.keys()) {
  const line = optionRefusal(key)
  if (line !== undefined) {
    console.error(line)
    process.exit(1)
  }
}
for (const [key, entry] of Object.entries(RETIRED_FLAGS)) {
  if (!flags.has(key)) continue
  if (typeof entry !== "string" && command !== entry.command) continue
  console.error(`--${key} ${typeof entry === "string" ? entry : entry.notice}`)
  process.exit(1)
}

// The run-only options plan and transfer refuse alike (auto-core plans/0053
// D14; transfer's rows plans/0101 D2): plan stops before any task runs and
// transfer executes none, so run's execution shaping applies to neither. The
// two command-specific `what` texts differ where the reason genuinely does.
const RUN_OPTION_REFUSALS: ReadonlyArray<{ key: string; flag: string; what: (command: "plan" | "transfer") => string }> = [
  { key: "dryrun", flag: "--dryrun", what: () => "the permission preflight: opencode-auto run <dir> --dryrun" },
  { key: "wait-between", flag: "--wait-between", what: (command) => `the pause between tasks, and ${command} runs none` },
  { key: "max-sessions", flag: "--max-sessions", what: () => "concurrent sessions of the task loop" },
  { key: "repair", flag: "--repair", what: () => "the bounded repair budget for FAIL verdicts" },
  { key: "stop-after", flag: "--stop-after", what: () => "the task whose completion ends the run" },
  {
    key: "boundary",
    flag: "--boundary",
    what: (command) =>
      command === "plan"
        ? "run's phase-boundary shape (stop, the default, or flow); plan stops at its own boundary — the reviewed plan task"
        : "run's phase-boundary shape; transfer is itself the boundary command",
  },
]

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
// fork (auto-core plans/0128): like close, the target is required and comes
// first — positional[0] is the fork target (a task T-NNN or a commit sha),
// positional[1] the worktree path, positional[2] the optional directory. The
// shape check makes the split safe the same way close's does; forkTask owns
// every behavioural refusal (the target's derivation, the nested alignment,
// the path's bounds). fork takes no options at all, so any flag is a usage
// error before anything is read. The colon suffix (the internal
// named-alignment form sha:<rel>@<sha>[,…] — the core owns its parse and its
// refusals; undocumented here) only widens what passes the shape check.
const FORK_TARGET = /^(?:T-\d{3,}|[0-9a-f]{7,40}(?::.+)?)$/i
let forkTarget: string | undefined
let forkPath: string | undefined
if (command === "fork") {
  const target = positional[0]
  if (target === undefined || !FORK_TARGET.test(target)) {
    console.error(
      target === undefined
        ? "fork requires a target and a worktree path: opencode-auto fork <T-NNN | sha> <worktree-path> [dir] — the task to retry from its beginning, or an exact commit"
        : `${target}: not a fork target; expected a task T-NNN or a commit sha (usage: opencode-auto fork <T-NNN | sha> <worktree-path> [dir])`,
    )
    process.exit(1)
  }
  forkTarget = target
  if (positional[1] === undefined || !positional[1]!.trim()) {
    console.error("fork requires a worktree path: opencode-auto fork <T-NNN | sha> <worktree-path> [dir] — the absent directory the experiment environment is created in")
    process.exit(1)
  }
  forkPath = positional[1]!
  if (flags.size > 0) {
    console.error(`fork takes no options (usage: opencode-auto fork <T-NNN | sha> <worktree-path> [dir]); --${[...flags.keys()][0]} is not one`)
    process.exit(1)
  }
}
// remove-fork (auto-core plans/0139): the teardown of what fork builds.
// positional[0] is the fork's root worktree path, positional[1] the optional
// source directory. --force is its one option — the explicit discard of the
// fork's uncommitted work; anything else is a usage error before anything is
// read. removeFork owns every behavioural refusal (the registration, the
// branch family, the members' coherence, a live run inside the fork, the
// dirty files).
let removeForkPath: string | undefined
if (command === "remove-fork") {
  if (positional[0] === undefined || !positional[0]!.trim()) {
    console.error("remove-fork requires a worktree path: opencode-auto remove-fork <worktree-path> [dir] — the fork's root worktree, as fork's success line named it")
    process.exit(1)
  }
  removeForkPath = positional[0]!
  const foreign = [...flags.keys()].filter((key) => key !== "force")
  if (foreign.length) {
    console.error(`remove-fork takes only --force (usage: opencode-auto remove-fork <worktree-path> [dir] [--force]); --${foreign[0]} is not one`)
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
const directory = resolve(command === "close" ? positional[1] ?? "." : command === "fork" ? positional[2] ?? "." : command === "remove-fork" ? positional[1] ?? "." : positional[0] ?? ".")

// fix --dryrun: list the configuration findings read-only (the replacement
// for the retired `check` as a scripted gate on config drift). It skips only
// the gates that guard writes — the clean-tree check, the confirmation and
// the run-lock refusal below — so a boolean flag here is read by both gates.
// -f/--force alongside it is accepted and inert: dryrun has no gates left to
// skip.
const fixDryrun = command === "fix" && flags.has("dryrun") && flags.get("dryrun") !== "false"
const syncDryrun = command === "sync" && flags.has("dryrun") && flags.get("dryrun") !== "false"

// Legacy layout (M3.7, auto-core plans/0047 R3): an old-layout project is a
// usage error before init/amend/plan/close/fix writes anything, status
// reads anything or run starts (runAll, planPrelude and closeUnit repeat the
// check for other shells). fix used to stay available so an old tree could
// still be repaired, and `check` ran on one — but the driver refuses an old
// layout everywhere else, so the repair had no consumer, and with `check`
// retired its legacy-layout exemption ended: `fix --dryrun`, the gate that
// replaced it, refuses the layout like every other live command. Only reset
// stays available, so an old tree can still be de-initialized.
if (command === "init" || command === "amend" || command === "plan" || command === "transfer" || command === "close" || command === "land" || command === "fork" || command === "remove-fork" || command === "fix" || command === "sync" || command === "status" || command === "release" || command === "driver-helper" || command === "clarify" || command === "run") {
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
// skips); sync joins the family beside fix (it rewrites the materialized
// bundle files a run's sessions read, plans/0100 D4) with the same dryrun
// exemption; clarify (plans/0116 D6) writes the gate documents a running
// driver re-reads (docs/analysis.md, a held survey.md), amend's reason, and
// never takes the lock itself — one atomic check → write → commit. (`continue`
// and `check` used to refuse here too; both retired ahead of every check,
// their notices above.)
if (command === "init" || command === "amend" || command === "reset" || command === "clarify" || (command === "sync" && !syncDryrun) || (command === "fix" && !fixDryrun)) {
  const holder = liveRunLock(directory)
  if (holder) {
    for (const line of lockLines(directory, holder)) console.error(line)
    process.exit(1)
  }
}

if (command === "run") {
  refuseFrozenFlags("run")
  refusePlanInputFlags("run")
  refuseCloseFamilyFlags("run")
  refuseLaneValueFlags("run")
  const session = parseSessionFlags()
  const waitBetween = parseMinutes(flags.get("wait-between"))
  if (waitBetween === null) {
    console.error("--wait-between takes 1..60 (minutes); defaults to 1 when given without a value")
    process.exit(1)
  }
  // --max-sessions (auto-core plans/0046 D9; live since plans/0068 S3/D10;
  // activation decoupled by auto-core plans/0125 D1): concurrent AI sessions
  // of the task loop. Width alone activates the scheduler — no parallel
  // level required; the level stays planning guidance and the
  // landing-conflict posture. Unrelated to --agent.
  const maxSessions = parseMaxSessions(flags.get("max-sessions"))
  if (maxSessions === null) {
    console.error("--max-sessions takes a positive integer (concurrent AI sessions, unrelated to --agent); defaults to 1")
    process.exit(1)
  }
  // --repair (auto-core plans/0079 §4): the bounded repair budget — how many
  // automatic repair rounds a FAIL verdict (a task report's Result line)
  // or a held verdict gate (a gate-evidence append) may drive
  // before blocking for the human. Absent = none: the first FAIL blocks,
  // today's behavior.
  const repair = parseRepairBudget(flags.get("repair"))
  if (repair === null) {
    console.error("--repair takes 1..10 (automatic repair rounds before blocking for the human); defaults to none")
    process.exit(1)
  }
  // --boundary (auto-core plans/0101 D1): run's phase-boundary shape. stop
  // (the default, flag omitted) ends the run at each clean phase end — before
  // the handover — naming transfer as the advance command; flow restores
  // today's continuous crossing of the boundaries, for trusted unattended
  // stretches.
  const boundary = flags.get("boundary")
  if (boundary !== undefined && boundary !== "stop" && boundary !== "flow") {
    console.error("--boundary takes stop or flow (stop ends the run at each clean phase end, the default; flow crosses the boundaries continuously as before)")
    process.exit(1)
  }
  // --stop-after (auto-core plans/0128): the task whose completion ends this
  // run — the retry's guardrail in a fork environment. The task loop owns
  // the semantics (the stop itself, the index check, the serial-path
  // confinement); the shell validates the shape alone.
  const stopAfter = flags.get("stop-after")
  if (stopAfter !== undefined && !/^T-\d{3,}$/.test(stopAfter)) {
    console.error("--stop-after takes a task id (T-NNN): the task whose completion ends this run")
    process.exit(1)
  }
  startRunLog(directory, session)
  const { config, mode } = await loadRunConfig(directory)
  await logRunBanner(directory, config)
  const code = await runAll(directory, {
    ...runOptions(config, mode, session),
    waitBetween,
    dryrun: flags.has("dryrun") && flags.get("dryrun") !== "false",
    maxSessions,
    repair,
    ...(stopAfter !== undefined ? { stopAfter } : {}),
    ...(boundary === "flow" ? { boundary: "flow" as const } : {}),
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
  // The retired extras and frozen config flags are refused here too
  // (0165-056/S26-04's _lane half): _lane is a run-shaped entry sharing the
  // option vocabulary, and a silently ignored retired flag on it is the same
  // defect run/plan/transfer's refusal family already refuses.
  refuseFrozenFlags("_lane")
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
  refuseRunOptions("plan")
  // The lane value flags are _lane's (the hidden machine surface): plan
  // shares run and transfer's refusal — each swallows the next token as its
  // value, so the directory would be eaten (0159 closed the gap where plan
  // silently dropped them).
  refuseLaneValueFlags("plan")
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
  if (flagOn("scaffold") && (input || newTask !== undefined || forceClose !== undefined || flags.has("append") || flags.has("export") || flags.has("adopt") || flags.has("round") || flags.has("phase"))) {
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
  // --round / --phase (auto-core plans/0084): the assisted preparation stops —
  // plan points the AGENTS.md guidance at the round brief (--round) or the
  // next phase's planning input (--phase) and the person works with their own
  // coding agent on the document. Mutually exclusive with each other and with
  // every other route option, checked here before the lock; planPrelude
  // backstops other shells and direct callers.
  const prepRound = flagOn("round")
  const prepPhase = flagOn("phase")
  if (prepRound && prepPhase) {
    console.error("--round and --phase are mutually exclusive: --round prepares the round brief of the round at hand, --phase the planning input of the next phase to plan — run them one at a time")
    process.exit(1)
  }
  if ((prepRound || prepPhase) && (input || append || newTask !== undefined || forceClose !== undefined || exportRef !== undefined || adoptRef !== undefined)) {
    console.error("--round / --phase take no other option: no planning input, no --append, no --new-task, no --force-close, no --export / --adopt — pass the flag alone (opencode-auto plan <dir> --round | --phase)")
    process.exit(1)
  }
  const session = parseSessionFlags()
  // plan writes the round setup, which follows the config (phases): a
  // directory init never configured is refused rather than planned with the
  // defaults.
  await requireConfigFile("plan", true)
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
  const lock = takeRunLock("plan")
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
    // The assisted-preparation routes (auto-core plans/0084) and the intent
    // pack's name --phase's scaffold lookup reads.
    round: prepRound,
    phase: prepPhase,
    intent: config.intent,
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

// transfer (auto-core plans/0101 D2): the single advance command — the
// person-bracketed boundaries, one advance per invocation, resolved by
// state: the project start (the assisted analysis flow of plans/0084, re-homed
// from plan's rows — the stub, the release gate, the brief install, R-01's
// establishment under the roadmap's line), the phase boundary (the human gate
// first — open forks refuse ahead of any session — then the handover, the
// phase close, the next phase's plan task constructed and stopped for
// review), the round close (stopping there, the person's moment with the
// round's report), and the round open (the roadmap's next line applied, or
// the roadmap-exhausted stop naming the extend-the-document channel). It
// takes the run lock itself ("transfer", re-entered by the runAll the
// advance delegates to) and run's session options only; m mode refuses (its
// planning and execution keep the plan/run shapes). Exit codes: the review,
// round-open and exhausted stops 0; the gate-held and nothing-to-advance
// refusals 2; usage and state errors 1.
if (command === "transfer") {
  refuseFrozenFlags("transfer")
  // run's execution options: transfer executes no task.
  refuseRunOptions("transfer")
  // The planning input is plan's (the dispatch half of the boundary): the
  // fix-inputs channel of a rejected plan task edits the documents
  // (round.md, plan-input.md, the brief, the roadmap line) and re-runs
  // transfer — never rides the command.
  refusePlanInputFlags("transfer")
  refuseCloseFamilyFlags("transfer")
  refuseLaneValueFlags("transfer")
  const session = parseSessionFlags()
  const { config, mode } = await loadRunConfig(directory)
  startRunLog(directory, session)
  await logRunBanner(directory, config)
  // --resynthesize (auto-core plans/0101 D3): bypass the digest keep of a
  // standing plan task — the synthesis pipeline re-voices the sources and the
  // reconstruct lands the new todo for review (the rejected-ledger channel;
  // the inputs-fixed channel needs no flag, the plain re-run absorbs it).
  process.exit(await runTransfer(directory, { ...runOptions(config, mode, session), ...(flagOn("resynthesize") ? { resynthesize: true } : {}) }))
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
  await requireConfigFile("close", true)
  const { config } = await loadRunConfig(directory)
  // close holds the run lock itself (D3), so it is not in the refusal list
  // above; status shows a live lock while this runs.
  const lock = takeRunLock("close")
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
  exitWithResult(result, "closed", "refused")
}

// clarify (auto-core plans/0116): the person's release command — the one act
// every awaiting stop names by hand, performed: it writes the whole-line
// `Clarified: yes` into the one document a gate is awaiting (the unreleased
// docs/analysis.md at the project start, or the held survey.md of the current
// human-gated phase) and commits it, byte-identical to a correct hand edit.
// The gates stay the mechanical authority and the manual path stays fully
// supported; the command is sugar over the edit plus its commit — the thing a
// novice could not do (find the document, write the marker exactly, commit
// it), the thing the tool can. It prints what the release accepts (the
// survey's Fork: lines with their Recommend: defaults; the analysis's roadmap
// lines) before writing, so running it is the review; no confirmation prompt
// — the deliberate invocation at a stop that named it is the confirmation.
// Flagless (a directory argument only), legacy-layout and run-lock refused
// above, no run log and no lock of its own (the status/install-prompts
// family). Exit codes: 0 released; 1 usage/environment (a missing config, an
// unreadable phase index); 2 held — nothing awaiting, problems holding the
// release, bare Fork: lines, a dirty tree beyond the target, or a failed
// commit (the mark is written, the manual commit named).
if (command === "clarify") {
  if (!(await Bun.file(join(directory, CONFIG_FILE)).exists())) {
    const legacy = await legacyModeFallback(directory)
    console.error(
      `nothing to clarify: ${directory} has no ${CONFIG_FILE}; run opencode-auto init ${directory} first` +
        (legacy !== undefined ? ` (or opencode-auto fix ${directory}, which writes it from the legacy .auto/config.json mode "${legacy}")` : ""),
    )
    process.exit(1)
  }
  const { config } = await loadRunConfig(directory)
  const result = await clarifyGate(directory, { phases: config.phases })
  for (const line of result.lines) (result.type === "released" ? console.log : console.error)(line)
  process.exit(result.type === "released" ? 0 : result.type === "error" ? 1 : 2)
}

// land (plans/0074 §2.3, U-L2, ruled 2026-10-04 §5; plans/0192): the
// person-invoked return path of branch isolation — land each designated
// nested repository's
// round of work (its auto/R-NN branch) back onto its original branch as one
// commit (default squash; --merge the explicit merge-commit alternative),
// delete the round branch (--keep retains it: a mid-round landing, the branch
// simply continues), print the landed SHA. --abandon discards the round
// branch after a person-reviewed reset — the undo path; nothing lands. The
// original branch is an evidence ladder (plans/0192): the person's --onto
// word, the establishment's own reflog record (a second ordinary branch
// never blocks), the exactly-one-candidate floor; the refusals teach --onto,
// never branch surgery. Refusal is never an automated merge resolution: a
// moved original branch, foreign commits in the round branch's range, a
// dirty repository or an ambiguous original branch block (exit 2) naming
// what to settle. The
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
  if (flags.has("onto") && !flags.get("onto")) {
    console.error(`--onto names the original branch and takes a value (the derivation ladder's first rung, auto-core plans/0192); pass it as --onto <branch>: opencode-auto land <dir> --onto <branch>`)
    process.exit(1)
  }
  await requireConfigFile("land", true)
  let config: ProjectConfig
  try {
    config = await loadProjectConfig(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    const hint = await fixHint(directory)
    if (hint) console.error(hint)
    process.exit(1)
  }
  const lock = takeRunLock("land")
  const landed = await landUnit(directory, {
    isolate: config.isolate ?? [],
    keep: flagOn("keep"),
    abandon: flagOn("abandon"),
    merge: flagOn("merge"),
    onto: flags.get("onto") || undefined,
  })
  lock.release()
  exitWithResult(landed, "landed", "usage")
}

// fork (auto-core plans/0128): build an experiment environment in a new
// worktree — at the state before a task first started (T-NNN) or at an exact
// commit — to retry it in isolation; the main tree, its branches and its
// history are never touched. The target checks above (the ref-first split,
// the required path, the no-options refusal) ran before the directory
// resolved; forkTask owns every behavioural refusal and returns the complete
// printable output, land's shape. fork takes no run lock (plans/0129): its
// only writes in the source repositories are the reserved auto-fork/* branch
// family and the .git/worktrees registrations — surfaces a running driver
// never reads or writes — so the experiment can be built while a run is live
// in the source tree (the retry channel's own case; land and close keep the
// lock, they move git state a run works on). The config load is the validity
// gate alone — the fork point and the nested alignment derive from committed
// history; the experiment's own config is the committed one at that state.
// Exit codes under the contract: 0 forked / 1 usage / 2 blocked for human.
if (command === "fork") {
  await requireConfigFile("fork", true)
  try {
    await loadProjectConfig(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    const hint = await fixHint(directory)
    if (hint) console.error(hint)
    process.exit(1)
  }
  const forked = await forkTask(directory, forkTarget!, forkPath!)
  exitWithResult(forked, "forked", "usage")
}

// remove-fork (auto-core plans/0139): the teardown of what fork builds —
// every worktree of the fork removed (its nested repositories' first, the
// root's last, its removal sweeping the directory) and the auto-fork/*
// branch deleted in each repository, so the person can fork the same path
// (and the same branch stem) again. The argument checks above (the required
// path, --force the one option) ran before the directory resolved;
// removeFork owns every behavioural refusal and returns the complete
// printable output, land's shape. Like fork it takes no run lock
// (plans/0129's argument verbatim: its only writes in the source
// repositories are the reserved branch family and the worktree
// registrations — surfaces a running driver never reads), so it runs beside
// a live run in the source; the run it refuses is one live inside the fork
// itself (removeFork's own check, P20). The config load is the validity
// gate alone, fork's shape. Exit codes under the contract: 0 removed /
// 1 usage / 2 blocked for human.
if (command === "remove-fork") {
  await requireConfigFile("remove-fork", true)
  try {
    await loadProjectConfig(directory)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    const hint = await fixHint(directory)
    if (hint) console.error(hint)
    process.exit(1)
  }
  const removed = await removeFork(directory, removeForkPath!, { force: flagOn("force") })
  exitWithResult(removed, "removed", "usage")
}

// The amend hint of one config flag: how a person changes a key init froze.
// Shared by run/plan's frozen-flag refusal and close's whitelist — rendered
// by the core's one revision table (configKeyRevision, plans/0193 D2), so
// the hint for a key is written once for every shell (phases teaches the
// roadmap line, not the amend flag 0137 retired).
function amendHint(key: string): string {
  return configKeyRevision(key).clause
}

// A boolean flag's on-state: present and not explicitly false. Shared by the
// close and plan --force-close argument checks and option reads.
function flagOn(key: string): boolean {
  return flags.has(key) && flags.get(key) !== "false"
}

// The run-only options plan and transfer refuse (RUN_OPTION_REFUSALS above).
function refuseRunOptions(command: "plan" | "transfer"): void {
  for (const refusal of RUN_OPTION_REFUSALS) {
    if (!flags.has(refusal.key)) continue
    console.error(`${refusal.flag} is a run option (${refusal.what(command)}); ${command} does not accept it`)
    process.exit(1)
  }
}

// The planning input is plan's (auto-core plans/0053 D14): run never reads it
// and transfer's rejected-plan-task channel edits the documents and re-runs —
// neither takes it, so it is refused rather than silently ignored.
function refusePlanInputFlags(command: "run" | "transfer"): void {
  for (const key of ["prompt", "file"]) {
    if (!flags.has(key)) continue
    console.error(
      `${key === "prompt" ? "-p/--prompt" : "--file"} is a plan option: ${command} takes no planning input. ` +
        (command === "run"
          ? "Plan with opencode-auto plan <dir> -p <text> | --file <path>, then run"
          : "A rejected plan task is fixed through its inputs — the documents — and transfer re-runs on them"),
    )
    process.exit(1)
  }
}

// The close-family flags are close's and plan --force-close's (auto-core
// plans/0053 D22/D28): neither run nor transfer closes anything, and silently
// ignoring a close attempt would let a person believe a unit was closed when
// nothing happened (the AUTO-RESOLVE rationale of plan's own refusal of the
// group without --force-close).
function refuseCloseFamilyFlags(command: "run" | "transfer"): void {
  for (const key of ["reason", "cascade", "commit-changes", "stash-changes"]) {
    if (!flags.has(key)) continue
    console.error(
      `--${key} is a close option: ${command} closes nothing. Close a unit with opencode-auto close <ref> [dir] --reason <text>, ` +
        `or close and keep planning with opencode-auto plan <dir> --force-close <ref> --reason <text>`,
    )
    process.exit(1)
  }
}

// The lane value flags are _lane's alone (hidden, auto-core plans/0068 §6.4):
// the parent run's lane launcher re-invokes this CLI with `_lane <dir> --unit
// <id> [--merge <branch>]`, never `run`, `plan` or `transfer` — a person's
// command takes neither, and each swallows the next token as its value (the
// directory would be eaten). plan joined run and transfer's refusal late
// (0159): it shared their option machinery but not this check, so
// `plan <dir> --unit T-001` sailed into a real planning dispatch with the
// flag silently dropped.
function refuseLaneValueFlags(command: "run" | "plan" | "transfer"): void {
  for (const key of ["unit", "merge"]) {
    if (!flags.has(key)) continue
    console.error(
      `--${key} is a value flag of the hidden _lane entry (the lane worker the parent run's launcher invokes; a person never passes it)${key === "merge" ? " — land's --merge is the landing-mode boolean (opencode-auto land <dir> --merge)" : ""}; ` +
        `${command} takes no --${key}`,
    )
    process.exit(1)
  }
}

// The missing-config refusal of the commands that need an initialized project
// (plan, close, land and the amend command): the verb is the block's own word
// ("nothing to plan/close/land/amend"); `first` carries the one wording
// difference (amend's line omits "first").
async function requireConfigFile(verb: string, first: boolean): Promise<void> {
  if (await Bun.file(join(directory, CONFIG_FILE)).exists()) return
  const legacy = await legacyModeFallback(directory)
  console.error(
    `nothing to ${verb}: ${directory} has no ${CONFIG_FILE}; run opencode-auto init ${directory}${first ? " first" : ""}` +
      (legacy !== undefined ? ` (or opencode-auto fix ${directory}, which writes it from the legacy .auto/config.json mode "${legacy}")` : ""),
  )
  process.exit(1)
}

// The run lock's acquisition tail plan, close and land share: each holds it
// around its own writes (re-entered by the runAll a plan delegates to), and a
// refusal prints the lock's lines and exits 1 — the returned lock is always
// the acquired one.
type AcquiredRunLock = Extract<ReturnType<typeof acquireRunLock>, { ok: true }>
function takeRunLock(holder: string): AcquiredRunLock {
  const lock = acquireRunLock(directory, holder)
  if (!lock.ok) {
    for (const line of lockLines(directory, lock.holder)) console.error(line)
    process.exit(1)
  }
  return lock
}

// Prints a core result's lines (stdout on the ok type, stderr otherwise) and
// exits with the contract's codes: 0 ok, 1 the refused/usage type, 2 the rest
// (the tail close and land share).
function exitWithResult(result: { lines: string[]; type: string }, ok: string, refused: string): never {
  for (const line of result.lines) (result.type === ok ? console.log : console.error)(line)
  process.exit(result.type === ok ? 0 : result.type === refused ? 1 : 2)
}

// The options run and plan refuse alike (auto-core plans/0053 D14). Frozen
// options (design document §C): the constitutional project attributes are
// frozen by init into .opencode/auto/config.json — their presence at run time
// is a usage error (mirroring the existing --commit-subtask removal
// precedent); revision goes through amend (plans/0052 D25) or direct edits of
// the config file. The watchdog keys were renamed from --verify-idle/
// --verify-max to --idle-time/--idle-max (now governing the test-script
// watchdog); the old names get their own rename notice.
function refuseFrozenFlags(command: "run" | "plan" | "transfer" | "_lane") {
  for (const key of ["verify-idle", "verify-max"]) {
    if (flags.has(key)) {
      const renamed = key === "verify-idle" ? "idle-time" : "idle-max"
      console.error(`--${key} was renamed to --${renamed} (the driver-run script watchdog). To change: opencode-auto amend <dir> --${renamed} <value>, or edit .opencode/auto/config.json directly`)
      process.exit(1)
    }
  }
  for (const key of CONFIG_FLAGS) {
    if (flags.has(key)) {
      const revision = configKeyRevision(key)
      console.error(`${key === "mode" ? "-m/--mode" : `--${key}`} was frozen by init (.opencode/auto/config.json). To change: ${revision.clause}${revision.file ? ", or edit that file directly" : ""}`)
      process.exit(1)
    }
  }
  if (flags.has("commit-subtask")) {
    console.error("--commit-subtask removed: commits are now made by the driver after every session ends (AI commit rights revoked), and can no longer be turned off (--commit false is retired)")
    process.exit(1)
  }
  // --amend is retired everywhere (RETIRED_FLAGS above: once init stopped
  // taking the flag, no command accepts it).
  // --brief/--brief-file are amend's alone (plans/0081 D11; init's seed half
  // retired by auto-core plans/0133 D9): the project brief's revision
  // channel; run and plan never write it, so they refuse the pair rather
  // than silently ignoring it.
  for (const key of ["brief", "brief-file"]) {
    if (flags.has(key)) {
      console.error(
        `--${key} is an amend option (the project brief's manual revision: opencode-auto amend <dir> --${key} <text or path>); ${command} does not accept it`,
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
  // subcommand (`continue` is retired) but transfer's advance — once the
  // round is complete and ## Close is filled in and committed, transfer runs
  // the round-close checks and opens the next round.
  if (flags.has("continue")) {
    console.error(
      `--continue is not an option: the next round opens with transfer — once the round is complete, fill in ## Close of docs/R-NN/round.md, commit, and run ${shellProfile().bin} transfer <dir> (it runs the round-close checks and opens the next round)`,
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

// A text-or-file pair flag — plan's -p/--prompt | --file planning input
// (auto-core plans/0053 D14) and init/amend's --brief | --brief-file seed
// (plans/0081 D11): one of the two and non-empty, the file a regular
// readable file; undefined when neither is given. Checked before the lock, so
// a bad input writes nothing. The spec carries the pair's own message words;
// the flag keys are passed beside it (plan's text flag is -p/--prompt).
interface TextOrFileSpec {
  textFlag: string // the text flag's display name
  fileFlag: string // the file flag's display name
  what: string // what the pair carries, singular ("planning input")
  textWhy: string // the text-empty parenthetical
  fileWhy: string // the requires-a-path clause's trailing words
  namesWhy: string // the not-a-file clause's trailing words
  emptyWhy: string // the empty-file clause
}
async function parseTextOrFile(spec: TextOrFileSpec, textKey: string, fileKey: string): Promise<{ text: string; source?: string } | undefined> {
  const text = flags.get(textKey)
  const file = flags.get(fileKey)
  if (text !== undefined && file !== undefined) {
    console.error(`${spec.textFlag} and ${spec.fileFlag} are mutually exclusive: give the ${spec.what} one way`)
    process.exit(1)
  }
  if (text !== undefined) {
    if (!text.trim()) {
      console.error(`${spec.textFlag} requires non-empty text (${spec.textWhy})`)
      process.exit(1)
    }
    return { text }
  }
  if (file === undefined) return undefined
  if (!file) {
    console.error(`${spec.fileFlag} requires a path: the file holding the ${spec.fileWhy}`)
    process.exit(1)
  }
  const path = resolve(file)
  const info = await stat(path).catch(() => undefined)
  if (!info?.isFile()) {
    console.error(`${spec.fileFlag} ${file}: ${info ? "not a regular file" : "no such file"}; it names the file holding the ${spec.namesWhy}`)
    process.exit(1)
  }
  const content = await Bun.file(path).text()
  if (!content.trim()) {
    console.error(`${spec.fileFlag} ${file} is empty: the ${spec.emptyWhy}`)
    process.exit(1)
  }
  return { text: content, source: path }
}

// plan's planning input: the -p/--prompt text or the --file contents.
function parsePlanInput(): Promise<PlanInput | undefined> {
  return parseTextOrFile(
    { textFlag: "-p/--prompt", fileFlag: "--file", what: "planning input", textWhy: "the planning input", fileWhy: "planning input", namesWhy: "planning input", emptyWhy: "planning input must not be empty" },
    "prompt",
    "file",
  )
}

// init/amend's --brief/--brief-file: the project brief's seed (init) or
// revision (amend), the text verbatim.
function parseBriefSeed(): Promise<string | undefined> {
  return parseTextOrFile(
    { textFlag: "--brief", fileFlag: "--brief-file", what: "brief", textWhy: "the brief, written verbatim", fileWhy: "brief, written verbatim", namesWhy: "brief", emptyWhy: "brief must not be empty" },
    "brief",
    "brief-file",
  ).then((parsed) => parsed?.text)
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
// the config summary and, when phased, the phase progress line — the core's
// one emitter family (auto-core src/banner.ts, plans/0193 D1), rendered here
// through the log sink.
async function logRunBanner(directory: string, config: ProjectConfig) {
  for (const line of await runBannerLines(directory, config)) log(line)
}

// The runAll options run and plan share (auto-core plans/0053 D14): the config
// init froze (threaded by the core's one configRunOptions, plans/0193 D1)
// plus this run's session flags. run adds --wait-between, --dryrun
// and --max-sessions; plan adds its stop condition and planning input.
function runOptions(config: ProjectConfig, mode: ModeSpec, session: SessionFlags): RunAllOpts {
  return {
    // The coding agent, context budget etc. come from the config file (written
    // by init); OPENCODE_AUTO_AGENT still overrides the agent.
    ...configRunOptions(config, mode),
    server: flags.get("server"),
    // interactive implies the verbose log level (the watch/change-file
    // monitoring runs as usual and writes to the log).
    verbose: session.verbose || session.interactive,
    waitAnswer: session.waitAnswer,
    permission: session.permission,
    interactive: session.interactive,
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
// planned pipeline auto used to be, auto the adaptive mode; ondemand is off's
// permanent synonym since auto-core plans/0130 D1 — accepted here, the core's
// config boundary reads and writes it as the canonical off).
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
function parseConfigFlags(directory: string): { explicit: Partial<ProjectConfig>; phases?: string; agent?: string; parallel?: string; scanExempt?: string; isolate?: string; treeLanes?: string } {
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
  // --tree-lanes (auto-core plans/0096 D10): the execution tier of the lanes
  // machinery, frozen like every project attribute; off = the key is absent
  // from config.json (Tier 0, the default). The lanes.* knobs beside it
  // (caches, treeBudgetMB, sparseFloor) are hand-edited like
  // acceptanceGate/build — no flag grammar for a table.
  const treeLanes = flags.get("tree-lanes")
  if (treeLanes !== undefined && !["off", "auto", "on"].includes(treeLanes)) {
    console.error("--tree-lanes takes off|auto|on (the execution tier: off = process parallelism in one tree, the default; auto = the preflight probe picks sparse CoW worktree lanes when the filesystem and budget allow; on = the full worktree per lane)")
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
  // amend's half is retired (plans/0137): the config key is init-stamped
  // machinery — a round's phases reshape through its roadmap line alone, so
  // the refusal fires before any value validation (a retired flag's value is
  // never judged). The prefix guard over already-completed phases sits below
  // (the completed phases must form a prefix of the new value, so a re-init
  // cannot push the flow state beyond derivation).
  // Two value shapes (M3.6): the letter preset (an admtvk subsequence
  // containing m) or a comma-separated list of phase type ids (custom types
  // from .opencode/auto/phases/ allowed, implement required); the list shape is
  // normalized to a space-free comma string in the config.
  let phases: string | undefined
  if (flags.has("phases")) {
    if (command === "amend") {
      console.error(
        "--phases is retired on amend: a round's phases reshape by moving or adding its `- R-NN <phases> — <goal>` line in docs/analysis.md " +
          "(an uncovered round becomes covered the moment its line exists; the next transfer re-derives the unstarted tail) — " +
          "the config key is init-stamped machinery, chosen at init alone (the single-phase mode fixed at birth)",
      )
      process.exit(1)
    }
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
  if (treeLanes === "auto" || treeLanes === "on") explicit.treeLanes = treeLanes
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
  return { explicit, phases, agent, parallel, scanExempt, treeLanes, ...(isolateNone ? { isolate: "none" as const } : {}) }
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
      `--continue is not an option: the next round opens with transfer — once the round is complete, fill in ## Close of docs/R-NN/round.md, commit, and run ${shellProfile().bin} transfer <dir> (it runs the round-close checks and opens the next round)`,
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
    await requireConfigFile("amend", false)
    if (!CONFIG_FLAGS.some((key) => flags.has(key)) && flags.get("brief") === undefined && flags.get("brief-file") === undefined) {
      console.error(
        `name at least one key to change (for example: opencode-auto amend ${directory} --context-limit 128), or revise the brief with --brief <text> | --brief-file <path>; ` +
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
  if (flags.has("stop-after")) {
    console.error(`--stop-after is a run option (the task whose completion ends that run, per run and never persisted); ${command} does not accept it`)
    process.exit(1)
  }
  // init's option whitelist (the amend whitelist's pattern, placed after the
  // refusals above so their pinned notices answer first): init takes its
  // config flags, the brief pair, the identity pair and -f alone — every
  // other known flag is refused with a pointer at its owning command rather
  // than silently dropped (before this, `init --dryrun` wrote everything and
  // `init --merge <dir>` swallowed the directory as the lane value). Retired
  // flags need no entry: the RETIRED_FLAGS interception runs ahead of every
  // command block, and the plan/transfer/land/sync/models-owned flags are
  // refused globally the same way — the generic line below is their backstop
  // alone.
  if (command === "init") {
    const pointers: Record<string, string> = {
      dryrun:
        "--dryrun is a run option (the permission preflight: opencode-auto run <dir> --dryrun); init does not accept it — there is no dry-run init, and the refusal comes before any write",
      server:
        "--server is a run option (reuse a running opencode server: opencode-auto run <dir> --server <url>); init does not accept it — init starts no session",
      verbose:
        "--verbose is a run option (the session log level: opencode-auto run <dir> --verbose); init does not accept it — init starts no session",
      interactive:
        "--interactive/-i is a run option (the foreground interactive mode: opencode-auto run <dir> -i); init does not accept it — init starts no session",
      "wait-answer":
        "--wait-answer is a run option (the wait for a human answer inside a session); init does not accept it — init starts no session",
      permission:
        "--permission is a run option (the session permission preset: opencode-auto run <dir> --permission <mode>); init does not accept it — init starts no session",
      "new-session":
        "--new-session is a run option (skip reusing an interrupted session on resume); init does not accept it — init starts no session",
      "wait-between":
        "--wait-between is a run option (the pause between tasks: opencode-auto run <dir> --wait-between <minutes>); init does not accept it — init runs no task",
      boundary:
        "--boundary is a run option (run's phase-boundary shape: opencode-auto run <dir> --boundary stop|flow); init does not accept it — init runs no phase",
      "stop-after":
        "--stop-after is a run option (the task whose completion ends that run: opencode-auto run <dir> --stop-after <T-NNN>); init does not accept it — init runs no task",
      reason:
        "--reason is a close option (opencode-auto close <ref> [dir] --reason <text>, likewise plan --force-close <ref>); init does not accept it — init closes nothing",
      cascade:
        "--cascade is a close option (opencode-auto close <ref> [dir] --cascade, likewise plan --force-close <ref>); init does not accept it — init closes nothing",
      "commit-changes":
        "--commit-changes is a close option (opencode-auto close <ref> [dir] --commit-changes, likewise plan --force-close <ref>); init does not accept it — init closes nothing",
      "stash-changes":
        "--stash-changes is a close option (opencode-auto close <ref> [dir] --stash-changes, likewise plan --force-close <ref>); init does not accept it — init closes nothing",
      unit:
        "--unit is _lane's value flag (the hidden lane-worker entry the parent run's lane launcher invokes, never a person's); init does not accept it",
      merge:
        "--merge is _lane's value flag (the hidden lane-worker entry the parent run's lane launcher invokes, never a person's) and land's landing-mode boolean (opencode-auto land <dir> --merge); init does not accept it",
    }
    const allowed = new Set([...CONFIG_FLAGS, "brief", "brief-file", "name", "email", "force"])
    for (const key of flags.keys()) {
      if (allowed.has(key)) continue
      console.error(
        pointers[key] ??
          `--${key} is not an init option: init takes only the config flags (${CONFIG_FLAGS.map((name) => (name === "mode" ? "-m/--mode" : `--${name}`)).join(", ")}), --brief <text> | --brief-file <path>, --name <name> --email <email> and -f/--force`,
      )
      process.exit(1)
    }
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
  const { explicit, agent, parallel, scanExempt, isolate, treeLanes } = parseConfigFlags(directory)
  // The sequence itself is the core's one home (runConfigSequence,
  // auto-core src/config-op.ts, plans/0193 D4): this shell parses its flags
  // (parseConfigFlags above) and renders the outcome — the checks, their
  // order and the writes are shared with every shell, so a core rule cannot
  // exist here unmirrored. The one watershed between full overwrite and
  // per-key revision lives there too: the default takes the builtin defaults
  // table as its baseline, the amend command the existing on-disk config
  // (an amend loads strictly, since it would carry a retired key over; a
  // full overwrite's baseline read tolerates them and names each one before
  // the overwrite, plans/0052 D4).
  const amend = amendCommand
  await runConfigSequence({
    kind: amend ? "amend" : "init",
    dir: directory,
    keys: {
      explicit,
      mode: flags.get("mode"),
      // The dropper spellings ride as carriers (the positive list values are
      // already inside `explicit`); the raw flag strings are parse-validated
      // unions, narrowed here for the sequence's ConfigOpKeys.
      agent: agent as "opencode" | "claude" | undefined,
      ...(parallel !== undefined ? { parallel: parallel as "none" | ParallelLevel } : {}),
      ...(treeLanes !== undefined ? { treeLanes: treeLanes as "off" | "auto" | "on" } : {}),
      ...(scanExempt === "none" ? { scanExempt: [] } : {}),
      ...(isolate === "none" ? { isolate: [] } : {}),
    },
    io: {
      line: (text) => console.log(text),
      refuse: (lines) => {
        for (const refusalLine of lines) console.error(refusalLine)
        process.exit(1)
      },
      // The mistouch gates in this shell's mechanics: -f skips both; the
      // clean-tree check applies without a TTY too (what a non-TTY skips is
      // the confirmation, never this gate); the cancel branch exits 0 having
      // changed nothing.
      gates: async () => {
        if (flags.has("force")) return undefined
        const dirty = await checkCleanTree(directory, "init full overwrite")
        if (dirty) return [dirty]
        const ok = await confirm(
          "found an existing config .opencode/auto/config.json; init will fully overwrite it with these parameters (keys not given fall back to defaults; to change individual keys instead, use opencode-auto amend). continue? [y/N] ",
        )
        if (!ok) {
          console.log("cancelled; nothing was changed")
          process.exit(0)
        }
        return undefined
      },
    },
    wording: {
      modeKey: "--mode",
      handoverKey: "--handover-test",
      handoverTestKey: "--test-by-driver",
      handoverRemedy: "give --test-by-driver as well (or --handover-test false), e.g. opencode-auto amend <dir> --test-by-driver --handover-test",
      intentKey: "--intent",
      intentTail: "",
      identityPairRemedy: ", or pass --name <name> --email <email> to have init write the repository-local identity",
      amendGiven: CONFIG_FLAGS.filter((key) => flags.has(key)).map((key) => (key === "mode" ? "-m" : `--${key}`)).join(" "),
      // init's closing line (plans/0053 D31, re-keyed by plans/0101 D4): the
      // rounds' opening command — transfer on a phased project (the dispatch
      // half being plan's, every advance is transfer's), plan in m mode —
      // with the fresh-project pointer naming the assisted analysis
      // (plans/0084; the parenthetical is dropped over an established round,
      // where it would state a falsehood).
      initClosing: (phased, established, round) => {
        const opener = `opencode-auto ${phased ? "transfer" : "plan"} ${directory}`
        return established
          ? `next: ${opener}`
          : `next: ${opener} (opens the assisted project analysis: you and your agent fill docs/analysis.md, guided through AGENTS.md; round ${roundDirName(round)} opens on its release)`
      },
    },
    ...(bundle ? { bundle, bundleIntent: intentFlag } : {}),
    ...(briefSeed !== undefined ? { briefSeed } : {}),
    ...(command === "init" && identityName !== undefined && identityEmail !== undefined ? { identity: { name: identityName, email: identityEmail } } : {}),
  })
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
// nothing, exit 0 when there are none and when only informational notes
// remain (plans/0135: an expected posture is not drift) and 1 when there are
// fixable or manual findings — a scripted gate on config drift keeps its exit
// code. It skips only the write-side gates (the clean-tree check, the
// confirmation and the run-lock refusal above) and keeps fix's other
// refusals, including the uninitialized and legacy-layout ones; the
// uninitialized refusal still applies because a directory without a config
// layer has nothing to list.
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
  // Info notes alone are not findings against the layer (plans/0135): the
  // header and the closing line say so, and no gate fails over them.
  console.log(`${fixable.length + manual.length ? "config-layer findings" : "config-layer notes"} in ${directory}:`)
  console.log(formatFixPlan(plan))
  if (fixDryrun) {
    if (manual.length) {
      console.error(`${manual.length} finding(s) need a person (listed as manual above): edit the file by hand, then re-run opencode-auto fix ${directory}`)
    }
    console.log(
      fixable.length
        ? `dryrun: nothing was changed; apply the ${fixable.length} fixable finding(s) with opencode-auto fix ${directory}`
        : manual.length
          ? "dryrun: nothing was changed; the finding(s) above need a person"
          : "dryrun: nothing was changed; the note(s) above are informational — nothing to repair",
    )
    process.exit(fixable.length + manual.length ? 1 : 0)
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
  if (!fixable.length) {
    console.log("✓ nothing to fix: the note(s) above are informational — nothing to repair")
    process.exit(0)
  }
  console.log("✓ config layer repaired; review the change and commit it")
  process.exit(0)
}

// sync (auto-core plans/0100 D4/D5): the person's upgrade command for a
// materialized intent bundle — the write side of the provenance detection
// every run logs. Plan-then-apply on the fix UX: print the plan, then the
// worktree cleanliness gate and the confirmation (-f skips both), then
// apply; the sidecar rewrites last. Unedited managed files fast-forward
// byte-identically to the running binary's bundle; person-edited files and
// extras are reported and never written or deleted; an unstamped project
// bootstraps (byte-identical files adopted into a fresh stamp, differing
// ones report-only unless --from-bundle asserts pristine-but-old). It never
// touches config.json, never commits (the person reviews and commits), and
// proceeds past the open-round warning — a round in flight means later
// phases would plan under changed charters, the person's boundary call.
// --dryrun keeps the read-only half (plan and print, no write-side gates),
// exiting 0 when nothing would change and 1 when something would.
if (command === "sync") {
  if (!(await Bun.file(join(directory, CONFIG_FILE)).exists())) {
    console.error(`nothing to sync: ${directory} has no ${CONFIG_FILE}; run opencode-auto init ${directory}`)
    process.exit(1)
  }
  const plan = await planSync(directory, { fromBundle: flags.has("from-bundle") && flags.get("from-bundle") !== "false" })
  if (plan.nothing !== undefined) {
    console.log(`✓ nothing to sync: ${plan.nothing}`)
    process.exit(0)
  }
  const actionable = plan.entries.filter((entry) => entry.action !== "current")
  if (!actionable.length) {
    console.log(`✓ nothing to sync: every materialized file of bundle "${plan.bundle}" matches the running binary's`)
    process.exit(0)
  }
  console.log(`the bundle sync plan for ${directory} (bundle "${plan.bundle}", stamp ${plan.stampText !== undefined ? "rewrites" : "stands"}):`)
  console.log(formatSyncPlan(plan))
  if (syncDryrun) {
    console.log(
      syncWritesAnything(plan)
        ? `dryrun: nothing was changed; apply with opencode-auto sync ${directory}${flags.has("from-bundle") ? "" : " (--from-bundle to also overwrite the differing unstamped files)"}`
        : "dryrun: nothing was changed; the entries above are report-only",
    )
    process.exit(syncWritesAnything(plan) ? 1 : 0)
  }
  if (syncWritesAnything(plan) && !flags.has("force")) {
    const dirty = await checkCleanTree(directory, "sync")
    if (dirty) {
      console.error(dirty)
      process.exit(1)
    }
    const writes = plan.writes.length + (plan.stampText !== undefined ? 1 : 0)
    const ok = await confirm(`apply the sync above (${writes} write(s))? [y/N] `)
    if (!ok) {
      console.log("cancelled; nothing was changed")
      process.exit(0)
    }
  }
  try {
    await applySync(directory, plan)
  } catch (error) {
    console.error(`sync failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
  for (const write of plan.writes) console.log(`synced: ${write.path}`)
  if (plan.stampText !== undefined) console.log(`stamp: ${PROVENANCE_FILE} rewritten`)
  const held = plan.entries.filter((entry) => entry.action === "edited" || entry.action === "retired" || entry.action === "collision" || entry.action === "differ" || entry.action === "extra")
  if (held.length) console.error(`${held.length} entr(ies) above are yours alone (person-owned or retired): they were reported, never written`)
  console.log("✓ bundle synced; review the change and commit it")
  process.exit(0)
}

// The release gate (auto-core plans/0103 D2/D3): the destination repository
// ships standalone, so the containment findings the working rounds only
// record (close-out ⚠ lines, round-close warnings) become blocking here.
// Read-only beside the config read — no run-lock refusal (it certifies a
// committed state, and the clean-tree check inside makes a mid-flight tree
// refuse on its own). Exit 0 with one ✓ line per destination naming its
// HEAD; 2 while findings remain (fix them with your agent, commit, re-run);
// 1 when there is no destination to release or the config is unusable.
if (command === "release") {
  if (!(await Bun.file(join(directory, CONFIG_FILE)).exists())) {
    console.error(`nothing to release: ${directory} has no ${CONFIG_FILE}; run opencode-auto init ${directory}`)
    process.exit(1)
  }
  let scanExempt: readonly string[] | undefined
  let isolate: readonly string[] | undefined
  try {
    const config = await loadProjectConfig(directory)
    scanExempt = config.scanExempt
    isolate = config.isolate
  } catch {
    // An invalid config does not stop a read-only gate over the tree; the
    // scan simply runs without the project's exemptions (a stale exemption
    // can only over-report, never pass something the config would refuse).
    scanExempt = undefined
    isolate = undefined
  }
  const check = await releaseCheck(directory, { scanExempt, isolate })
  if (check.nothing !== undefined) {
    console.error(check.nothing)
    process.exit(1)
  }
  if (check.problems.length) {
    console.error(`⚠ release checks: the destination does not stand alone yet — these must be removed before it ships`)
    for (const problem of check.problems) console.error(`  ✗ ${problem}`)
    console.error(`next: fix them (restate in place, vendor what a path named), commit, then re-run: opencode-auto release ${directory}`)
    process.exit(2)
  }
  for (const line of check.certified) console.log(line)
  console.log("✓ release checks passed")
  process.exit(0)
}

// The phase progress line lives in the core now (src/banner.ts phasesLine,
// plans/0193 D1) — this shell's local copy is deleted; the banner and the
// status view share the one renderer.

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
// finding printed per model, not a command error. A true boolean read
// (`!== "false"`): --probe=false is the explicit opt-out and runs nothing —
// before 0159 the bare-presence read started the probe against it.
if (command === "models") {
  const description = await describeModels(directory, Date.now())
  for (const line of formatModels(description)) console.log(line)
  if (flags.has("probe") && flags.get("probe") !== "false") {
    if (description.registry === undefined) console.log("probe: no model registry, nothing to probe")
    else {
      console.log("probing every listed model (this sends one short prompt to each; it may take a while)")
      for (const probe of await probeModels(description.registry, directory))
        console.log(`${probe.ok ? "◇" : "⚠"} probe ${probe.name} (${probe.agent}): ${probe.line}`)
    }
  }
  process.exit(description.problems.length ? 1 : 0)
}

// install-prompts (auto-core plans/0093): resync the manual-driver prompt
// suite into the project — every suite file copied byte-identical into
// <dir>/prompts/ (differing content rewritten, identical files untouched),
// files the suite does not carry reported and left alone, and prompts/
// MANIFEST written pinning the installed vintage's digests (plans/0164 — the
// manifest a target commits instead of the suite's bytes). It requires an
// initialized project and writes nothing a running driver reads (the
// automated driver never reads the target's prompts/), so it takes no run
// lock; it runs no git command — the suite is tracked content, so the person
// reviews and commits the resync. Exit 0 on a completed resync (an
// already-current suite included), 1 on refusal or write failure.
// --check (plans/0164) is the read-only half: the same comparisons against
// this binary's embedded suite and the manifest's pin, nothing written, exit
// 0 clean and 1 on any drift (drifted files, missing files, or a manifest
// absent or pinning another vintage) — the scripted preflight before a
// manual-driver session takes the suite. A true boolean read (0159):
// --check=false is the explicit opt-out and runs the resync.
if (command === "install-prompts") {
  try {
    if (flags.has("check") && flags.get("check") !== "false") {
      const report = await checkPrompts(directory)
      for (const line of formatCheckPrompts(directory, report)) console.log(line)
      process.exit(report.drifted.length || report.missing.length || report.manifest !== "current" ? 1 : 0)
    }
    const result = await installPrompts(directory)
    for (const line of formatInstallPrompts(directory, result)) console.log(line)
    process.exit(0)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

// driver-helper (auto-core plans/0105): render the person-proxy brief — the
// six-block context a coding-agent session holding the person's pen needs at
// a boundary run cannot cross (ROLE: never the driver, prompts/run.md
// reference-not-role; PRIMER: the driver's working model; STATE: the live
// facts and the stop's own lines from the same emitters the terminal prints;
// CHANNELS: the person-owned documents open at this state; POLICY: the assist
// rule, the recorded defaults, the stop-and-ask boundary; RECOVERY: the
// exact commands). The plan --scaffold precedent: read-only, stdout, exit 0,
// nothing written into the target, no run lock (a live lock is reported in
// the brief, never refused on), nothing parsed back — the person pastes the
// brief into the coding agent of their choice; the tool renders, the person
// launches. An unloadable config refuses (the map is keyed on it): fix the
// config layer first.
if (command === "driver-helper") {
  try {
    const config = await loadProjectConfig(directory)
    const brief = await renderHelperBrief(directory, {
      phases: config.phases,
      build: config.build,
      scanExempt: config.scanExempt,
      acceptanceGate: config.acceptanceGate,
    })
    for (const line of brief) console.log(line)
    process.exit(0)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

// The missing-subcommand fallback: only a bare invocation reaches here —
// unknown commands were refused with one line above, --help/-h answered
// above — and the full usage is the right answer for it (a person asking
// what the tool does). stderr and exit 1, the usage error; --help prints
// the same text to stdout with exit 0.
console.error(renderFullUsage())
process.exit(1)
