# opencode-auto

A command-line tool that drives [opencode](https://opencode.ai) to implement work automatically, task by task,
in task units (the phase's task index `tasks.md` + `docs/T-NNN/`). Constitutional project options (the agent
contract, context budget, scenario mode) are fixed by `init` into `.opencode/auto/config.json`
(versioned, shared with the repository, human-editable); `run` controls only the current execution. State is
maintained exclusively by the driver: each task runs as one lead session that manages its own context (the
default `subtask: auto`), or — under `subtask: true` — is first split into subtasks by a decompose session,
then completed one subtask at a time by dispatched sessions (by default every session starts fresh; with
`OPENCODE_AUTO_REUSE_SESSION=on` the previous session is reused when its context share was below 50% and it
ended within 5 minutes; the driver ticks state as each session ends), and after wrap-up the driver marks the
task done. Checking and acceptance are planned work (acceptance tasks, the v acceptance phase): when the
result line at the end of a task report says `Result: FAIL`, the driver blocks that task after committing and
stops the run for a person to adjust the task (task-level acceptance `verify`, quality review `--review` and
the final-review loop `--final-review` were retired on 2026-09-21 — see
[Acceptance result line](#acceptance-result-line-result-passfail)); the run also halts for human attention on
repeated questions the AI cannot decide on its own, permission requests left unanswered under
`--permission ask-fail`, and similar situations. After an interruption (including application crashes and
network failures), rerunning recovers precisely to the interrupted session and phase from the progress record.

## Building a standalone executable

```sh
cd packages/auto
bun run build            # produces dist/opencode-auto (native platform)
bun run build -- --target bun-windows-x64   # cross-compile; the artifact gets a platform suffix
```

The artifact is a single self-contained file (templates and SDK embedded) — copy it to any machine and run.
Running `run` only requires the `opencode` CLI on the target machine: by default the tool automatically starts
and manages an `opencode serve` instance; you can also point it at an existing server address to reuse an
external instance (see [opencode server and agent selection](#opencode-server-and-agent-selection)).

You can also skip the build and run the sources directly with Bun:

```sh
bun run packages/auto/src/index.ts <subcommand> ...
```

## Usage

```sh
opencode-auto init [dir]     # initialize the project config layer: fix the project config into .opencode/auto/config.json, generate opencode.json, the .opencode/agent/auto.md template and the .opencode/auto/brief.md project brief stub, idempotently sync the single opencode-auto marker block in AGENTS.md, and write the driver workdir (tmp/, .auto/), the local-only files (/.gitignore, /.env, /AGENTS.md, /opencode.json, the model registry project layer /.opencode/auto/models.json) and every nested git repository in the tree into .gitignore; writes nothing under docs/ — round directories are established by plan
opencode-auto amend [dir] --<key-option> <value> ...   # rewrite only the given config keys, keep the rest (at least one key; refused without a config), see "Amending (amend)"
opencode-auto fix [dir] [-f] [--dryrun]  # repair the config layer by rule: delete/rename/migrate retired keys into brief.md, align the contract, the AGENTS.md block and .gitignore with the config; --dryrun lists the findings read-only and writes nothing (exit 0 when there are none, 1 when there are any), see "Config fix (fix)"
opencode-auto plan [dir] [-p "<planning input>" | --file <path>]   # plan the current phase's tasks and stop before execution for human review; establishes the round first when none exists (printing the round-start gate), and after a round completes runs the round-close check to open the next one (see "Planning and the round lifecycle (plan)")
opencode-auto run [dir]      # execute tasks one by one following the current phase's task index (agent semantics and the context budget come from the project config; the unified commit after every session is always on)
opencode-auto reset [dir]    # de-initialize (the inverse of init): remove the config-layer artifacts init wrote and restore the worktree to the uninitialized state
opencode-auto status [dir]   # print the project config summary and the read-only round → phase → task → subtask tree
opencode-auto models [dir] [--probe]   # print the model registry's effective table (tier, candidates and current availability per phase type × session role); --probe additionally sends a short recovery-probe prompt to every listed model (optional, costs tokens), see "Model registry overview (models)"
```

New-project flow (`init` → `plan` → fill in and commit → `plan` (optional) → `run`):

```sh
opencode-auto init <dir> --phases "admtvk"   # 1. fix the project config (init writes only the config layer, no round directories)
opencode-auto plan <dir>                      # 2. establish docs/R-01/ (phase index + phase directories + round brief stub), stop at the round-start gate
#                                              3. by hand: review the round setup, fill in docs/R-01/round.md (goals/acceptance/release criteria), commit
opencode-auto plan <dir> -p "First round: migrate legacy/pkg into app/"   # 4. optional: plan P01 with a planning input (tasks can also be listed by hand in tasks.md)
opencode-auto run <dir>                       # 5. execute phase by phase; after each round fills ## Close, run plan again to open the next round
```

The `m` mode (the default single run) works the same way: `init` → `plan` (establishes the implicit single
phase `R-01/P01-implement`, stops at the round-start gate) → commit → `plan -p` (optional, see
[Planning tasks with AI](#planning-tasks-with-ai)) or list tasks by hand in `tasks.md` → `run`. `init`'s
`-p` (edit `.opencode/auto/brief.md` directly instead) and `--amend` (use the `amend` subcommand instead) are
retired; the `continue` subcommand is retired too (opening the next round is simply `plan`), and so is the
`check` subcommand (the principle scan and the reference check were removed; `fix --dryrun` lists the
configuration findings).

`init` always leaves an existing opencode.json untouched; `.opencode/agent/auto.md` is always replaced when
it differs from the built-in template, so the agent contract is the latest version. Round directories
(`docs/R-NN/`) are not an init product — `plan` establishes them (see
[Planning and the round lifecycle (plan)](#planning-and-the-round-lifecycle-plan)).

The semantics of `init` writing `.opencode/auto/config.json` are a **stateless full overwrite**: the output
is decided solely by the arguments passed to this invocation; keys not given always fall back to the built-in
defaults, with no incremental merge against the old config on disk. So "run a no-argument `init` in a clean
environment" and "run a no-argument `init` after a parameterized `init`" produce byte-identical output — a
single `init` reaches a deterministic state, no prior cleanup needed; repeated runs with the same arguments
are constant. To change one or two keys and keep the rest of the existing values, use the `amend` subcommand
(see [Amending (amend)](#amending-amend)); to only refresh the contract / AGENTS.md block to match the current
config, or to clear retired keys, use `fix` (see [Config fix (fix)](#config-fix-fix)) — neither ever resets the
remaining keys to defaults.

**Breaking change**: `run` no longer accepts `-m/--mode`, `--agent`, `--context-limit`, `--subtask`,
`--idle-time`, `--idle-max`, `--test-by-driver`, `--handover-test`, `--auto-number`,
`--no-auto-number`, `--phases`, `--parallel`, `--scan-exempt` — any of them appearing is a usage error (exit code 1), and the
message points at how to amend (`opencode-auto amend <dir> --<flag> <value>`, or edit the config file
directly); these options are fixed as project attributes, see the next section. `--commit` is retired
entirely (see the compatibility table below). `--implement-file`/
`--implement-prompt` are retired; appearing on any command is a usage error — see
[Planning tasks with AI](#planning-tasks-with-ai).

## Project configuration (.opencode/auto/config.json)

Constitutional options — those deciding "how sessions are instructed" —
are fixed at `init` time into `.opencode/auto/config.json`: versioned, shared with the repository,
human-editable. `run` reads the file at every start and prints a one-line config summary; `status` prints the
same. The test for which side an option belongs on: **changing it requires also changing the wording of
AGENTS.md / task documents / the contract, or it describes a model/project attribute → init; it only
describes how this run executes and how a person watches it → run.**

| Key | Value range | Default | Description |
| --- | --- | --- | --- |
| `mode` | A registered mode name | `migrate` | Prompt-level scenario mode, see [Mode layer](#mode-layer--m--mode) |
| `agent` | `opencode` / `claude` | `opencode` (key not written) | The coding agent that drives every session (M6.1); `OPENCODE_AUTO_AGENT` overrides it per run. In older versions this key held a contract name (e.g. `auto`); reading one is an error telling you to delete the key (`fix` deletes it) — the contract is always `.opencode/agent/auto.md`. See [agent selection](#opencode-server-and-agent-selection) |
| `contextLimit` | Positive integer (thousand tokens) | `64` | The context budget baseline: the used-tokens threshold for session reuse (needs `OPENCODE_AUTO_REUSE_SESSION=on`) is half of it (32k by default); under `subtask` `ondemand` and `auto` the context-budget wall is 2x, raised to a quarter of a large model window and capped at 80% of the window (see [Execution pipeline](#execution-pipeline)) |
| `subtask` | `off` / `auto` / `true` / `ondemand` | `auto` | Subtask splitting, see [Execution pipeline](#execution-pipeline); the JSON boolean `true` reads as `"true"` |
| `idleTime` | 1..120 (minutes) | `10` | The no-progress window for driver-managed scripts (test scripts); the old key name `verifyIdle` is read as a fallback when the new key is missing (`fix` renames it in place) |
| `idleMax` | 0..1440 (minutes, 0 = no limit) | `0` | The absolute duration cap for driver-managed scripts; the old key name `verifyMax` is read as a fallback when the new key is missing (`fix` renames it in place) |
| `verify` | **Retired** | — | Task-level acceptance was retired (2026-09-21): an existing config with `verify: true` fails loading with exit 1 (delete the key — `fix` does it — and plan acceptance as tasks or use the v phase); `false` or absent is ignored |
| `commit` | **Retired** | — | Committing cannot be turned off. `false` was retired on 2026-09-15, and the key went entirely on 2026-09-29 with the flag: a stored `true` (what an older init wrote) loads and is ignored like an unknown key; any other stored value fails loading with exit 1 (`fix` deletes the key) |
| `testByDriver` | `true` / `false` | `false` | Compile/test/build/lint commands are executed by the driver (sessions request them via a `test/` script + the `tmp/test.sh` marker), see [Test execution protocol](#test-execution-protocol---test-by-driver) |
| `handoverTest` | `true` / `false` | `false` | On test failure with the context at its limit, write a handover document and continue in a new session; requires `testByDriver: true`, otherwise config validation fails (exit code 1) |
| `autoNumber` | `true` / `false` | `true` | Auto numbering (on by default, disabled by `--no-auto-number`): task numbers (T-NNN) never repeat in the target directory; the next available number is persisted in `.auto/next-task`, consumed by the phase planning session and recovered first when the record is missing — see the end of [Phased flow](#phased-flow---phases) |
| `phases` | A subsequence of `admtvk` containing `m`, or a list of phase type ids containing `implement` (comma-separated string or JSON array) | `"m"` | Phased flow (a analysis → d design → m implementation → t test → v acceptance → k knowledge distillation; the list form may reference custom types under `.opencode/auto/phases/`); `"m"` = no phases declared, i.e. the implicit single phase `docs/R-01/P01-implement`, no handover sessions, tasks listed by a person or planned from a planning input (see [Planning tasks with AI](#planning-tasks-with-ai)). See [Phased flow](#phased-flow---phases) |
| `scanExempt` | An array of path globs relative to the target directory (`*`, `**`, `{a,b}`; no absolute path, no `..`) | none (key not written) | Deliverable files the driver's two content scans skip (auto-core plans/0059 X2): the process-document reference scan (the lines a unit added, at subtask close-out, and the whole tree at round close) and the document terminator scan at subtask close-out. For a deliverable where such strings are content — a tool's own test fixtures, prompt templates, sample documents. A glob naming a directory covers the files under it (`test/fixtures` = `test/fixtures/**`). Only deliverable paths are exempted: the task and round records stay held to their rules whatever the list says. Set with `init`/`amend --scan-exempt a,b` (the list replaces the stored one; `none` removes the key); shared with the repository like every key |
| `source` / `destDir` | **Retired** | — | The migration source and target are intent, not config (2026-09-23, auto-core plans/0052 D2/D3): they go into `.opencode/auto/brief.md`, read by the planning sessions. An existing config carrying either key (any value) fails loading with exit 1; the message names the original value and the fix (copy it into brief.md, then delete the key — `fix` migrates it into the `## Source` / `## Target` sections and deletes the key); a no-argument `init` full overwrite drops them and prints each original value. Both key names are tombstoned for good, never reused |

**Unified commit** (always on; the `commit` config key is retired): after any session ends and the driver has
finished its
state writes (e.g. ticking a subtask), the driver recursively commits all changes — nested `.git`
repositories first, then the repository containing the target directory — with the short-label subject line
`T-NNN <label> <task title/subtask>` (e.g. `T-001 decompose fix login`, `T-001 S2 write schema`, `T-001 wrapup
fix login`, `T-001 done fix login`; trailers `Auto-Task` / `Auto-Stage`, and in the target repository
`Auto-Nested` records the final/latest SHA of every nested repository). The git history is the audit trail of
AI changes and the rollback granularity is one session; **committing is the completion condition** (auto-core
plans/0021-commit-boundary-design.md): a failed unified commit always blocks and halts for human attention;
tasks/subtasks/hidden tasks start from a clean-worktree baseline, and a unit starting on a person's leftover
dirty area also blocks (commit or clean up first, then run). The opencode session shares the commit's name, so
the session list reads as task progress; AI sessions never run git commit (enforced by the AGENTS.md
commit-principle block and the agent contract).

There are four write channels:

1. **init (default, full overwrite)**: `opencode-auto init <dir> [--<flag> <value> ...]` — the output is
   decided solely by this invocation's arguments; keys not given are forced back to defaults (hand-edited
   keys without options, `acceptanceGate` / `build`, are preserved). Retired keys in the existing file
   (`commit: false`, `verify: true`, a contract-name `agent`, `source`, `destDir`) are overwritten anyway, so
   the baseline read tolerates them: init prints `⚠ full overwrite drops the retired key <key> = <value>`
   for each and writes as usual (auto-core plans/0052 D4) — an existing `commit: false` no longer blocks the
   init that clears it;
2. **amend (incremental revision)**: `opencode-auto amend <dir> --<flag> <value>` — only the keys explicitly
   given on the command line are rewritten, the rest keep their existing values; a bare flag takes the key's
   default (e.g. `amend --test-by-driver` means `testByDriver: true`), see [Amending (amend)](#amending-amend).
   The old spellings `init <dir> --amend --<flag> <value>` and the `continue` subcommand are retired (either
   appearing gets a message pointing at `amend` / `plan`). amend carries retired keys through as-is, so it
   loads strictly, fails on them and points at `fix`;
3. **fix (repair by rule)**: `opencode-auto fix <dir>` — repairs only keys that "fail to load or silently
   lose their meaning" (retired keys deleted/renamed/migrated into brief.md), every other key kept verbatim,
   see [Config fix (fix)](#config-fix-fix);
4. **Edit** `.opencode/auto/config.json` directly (init writes the full key set every time; manual editing is
   equally legal).

Bad JSON / out-of-range values / an unregistered `mode` → both `run` and `init` fail with exit code 1, the
error naming the key and its expected range (strict failure over silent fallback); unknown keys are ignored
(forward compatible). When the strict failure is of a class `fix` can repair (retired keys, old key names,
only the legacy `.auto/config.json`), the `run` / `amend` / `init` message appends the line
`fix: opencode-auto fix <dir>`, and `status` prints the same line under its ⚠ line.

**init validates everything, then writes** (auto-core plans/0052 D7): option values, modes, the prefix
guardrail (read-only: no completed phase is lost, no phase directory containing existing work is deleted;
re-syncing the phase index belongs to `plan`), the target directory's prompt-library overrides
(`.opencode/auto/prompts/`) and the intent packs are all validated before the first write — any failure is
exit code 1 with the config layer untouched (no config.json, no contract or AGENTS.md block refresh, no
brief.md). When the target directory is inside a git repository there is also a **commit-capability
prerequisite check**: the unified commit is the completion condition, so a repository that cannot commit (no
user.name/user.email commit identity configured) is refused (exit code 1, the message says how to configure
it) — run `git config --global user.name/user.email` first (or drop `--global` inside the repository) and
retry. During `run` the file is made read-only together with opencode.json and AGENTS.md; make manual
revisions outside a run.

Compatibility and migration:

| Scenario | Behavior |
| --- | --- |
| Old project (only `.auto/config.json` has a mode) | When the new file is missing, the old value is read as a fallback and run prints a hint to "run `fix` to write out the full config" (`fix` writes the new file from the old mode + defaults); once init / fix has written the new file the fallback ends (the old file is not deleted — it sits ignored by git until `reset` cleans it up) |
| Old scripts like `run -m xxx` | Exit code 1 + amend guidance (breaking) |
| Retired option `--commit` (any value, on any command) | Exit code 1 + retirement notice (committing cannot be turned off; a stored `commit: true` still loads and is ignored) |
| Retired options `--verify` / `--review` / `--early` / `--early-review` / `--final-review` | Appearing on any command: exit code 1 + retirement notice (acceptance becomes planned tasks; the report result line `Result: FAIL` stops the run) |
| Retired options `--source-dir` / `--source-path` / `--dest-dir` | Appearing on any command: exit code 1 + retirement notice (the migration source and target are intent and go into `.opencode/auto/brief.md`) |
| Existing config containing `source` / `destDir` | `run` / `amend` / `init` fail strictly (`status` prints a ⚠ line); the message names the original value and the fix (copy into brief.md, then delete the key) and points at `fix` — `fix` migrates the value into brief.md's `## Source` / `## Target` sections and deletes the key; a no-argument `init` drops them, prints the original values, and overwrites as usual |
| Retired options `init -p` / `--prompt` (init no longer writes the brief) and `--amend` | Appearing: exit code 1 + retirement notice (the former points at `.opencode/auto/brief.md` and `plan -p`, the latter at the `amend` subcommand); the retired `continue` subcommand likewise: exit code 1 + retirement notice (pointing at `plan`); the retired `check` subcommand likewise: exit code 1 + retirement notice (pointing at `fix --dryrun` — the principle scan and the reference check were removed) |
| Unknown `--` options (including misspellings like `--next`) | Exit code 1 + near-name suggestions (breaking; previously silently ignored). `status` accepts only a directory argument and rejects any option; `reset` accepts only a directory argument and `-f`; `fix` accepts only a directory argument, `-f` and `--dryrun` |
| Repeated `init` (no arguments) | **Every key falls back to its default** (breaking: previously "config unchanged"); templates and the marker block stay idempotent |
| Parameterized init like `init --test-by-driver true` | Given keys are written with their values, **keys not given fall back to defaults** |
| `amend --test-by-driver true` | Only the explicitly given keys are rewritten, the rest are kept |
| Overwriting an existing config with a dirty worktree | Exit code 1 + a list of uncommitted files (including nested repositories/submodules); `-f`/`--force` skips it |
| Overwriting an existing config on an interactive terminal | Asks for confirmation `[y/N]`; anything but `y` cancels with no changes; non-TTY (CI/scripts) overwrites directly |
| An existing PLAN.md (with `verify:` / `verified:` / `final:` field lines, `T-F<k>` tasks) | Not read since M3.4; migrate the tasks into task units (see [Task unit format](#task-unit-format)) to continue |
| Switching `subtask` mid-run | Tasks whose checklist was already injected resume from their ticked state (progress is recorded per task, never mixed across tasks); new tasks run under the new setting; switching mid-run is discouraged |
| Changing `mode` mid-run | Only the prompt copy changes (modes do not enter the scheduling state machine) |
| Turning `commit` off | No longer possible: `commit: false` was retired on 2026-09-15, and on 2026-09-29 the flag and the config key went entirely — any `--commit` form is exit 1 + retirement notice; a stored `commit: true` loads and is ignored, any other stored value fails with exit 1 (`fix` deletes the key and keeps the rest; or delete it by hand, or a no-argument `init` full overwrite — dropping and printing the key) |

Combination notes: `--dryrun` reads the config's `agent` / `contextLimit`; subtask does not take part.

### init options (fixing and amending)

| Option | Description |
| --- | --- |
| `-m` / `--mode <name>` | Scenario mode, written to the config's `mode` key (precedence: explicit value > existing config value > default `migrate`; an unregistered name is a usage error with exit code 1, the message listing the currently supported modes); see [Mode layer](#mode-layer--m--mode) |
| `--agent opencode\|claude` | The coding agent driving the sessions, written to the config's `agent` key (default `opencode`, key not written; `--amend --agent opencode` deletes the key); any other value is a usage error; see [agent selection](#opencode-server-and-agent-selection) |
| `--phases <admtvk subsequence containing m \| phase type list>` | Phased flow, written to the config's `phases` key (default `"m"` = single run); when completed phases exist, an amendment must satisfy the prefix guardrail (the completed phases form a prefix of the new value), otherwise it errors and points at rolling back the phase index by hand. See [Phased flow](#phased-flow---phases) |
| `--subtask [mode]` | Subtask splitting, written to the config (default/bare flag `auto`): `auto` is adaptive decomposition — one lead session works the task under `ondemand`'s handover protocol, and may split the remaining work into 2–5 streams, each run in a fork of the lead, when the driver's guard finds that it pays; `true` is the planned pipeline (a decompose session, then one session per subtask — what `auto` meant before auto-core plans/0059); `off` disables splitting and one session completes the whole task; `ondemand` hands over and continues when the context reaches 2x `contextLimit`. See [Execution pipeline](#execution-pipeline) |
| `--idle-time [1-120]` | The no-progress window for driver-managed scripts (minutes, default/bare flag 10; the old name `--verify-idle` was renamed — appearing errors with guidance): the driver polls the size of the output file (`tmp/test.<n>.out`, stdout/stderr merged into one file) and terminates the script only after no growth is sustained for the window (exit code recorded as 124); as long as output keeps growing, the runtime is unlimited |
| `--idle-max [1-1440]` | The absolute runtime cap for driver-managed scripts (minutes, default/bare flag unset; the old name `--verify-max` was renamed): a backstop against scripts looping forever while printing; when set to a positive integer, exceeding the total duration terminates the script regardless of output |
| `--context-limit [n]` | The context budget baseline (unit: thousand tokens, default/bare flag 64), written to the config; a new session starts once the previous session's used tokens reach half of it (32k by default), effective alongside the 50% share threshold |
| `--test-by-driver [true]` | Execution rights for compile/test/build/lint commands move to the driver (default/bare flag `false`), written to the config: execution sessions no longer run such commands in-session; instead they write the command as a script in `test/`, write the script path into `tmp/test.sh` to request execution by the driver, and the exit code and output file are fed back for the AI to read and judge directly. The switch also decides whether the test-execution principle block enters AGENTS.md and whether the test protocol section enters the agent contract and execution prompts. See [Test execution protocol](#test-execution-protocol---test-by-driver) |
| `--handover-test [true]` | Must be combined with `--test-by-driver` (otherwise a usage error, exit code 1), written to the config: when a test fails and the session context reaches `contextLimit`, the AI is asked to write a handover document and continue in a new session, preventing repeated trial-and-error inside a bloated context |
| `--scan-exempt none\|<globs>` | The scan exemptions, written to the config's `scanExempt` key as a comma-separated glob list (commas inside `{a,b}` stay in the glob; default none, key not written; `none` deletes the key): deliverable paths the process-document reference scan and the document terminator scan skip. An empty list, an absolute glob or one containing `..` is a usage error |
| `--auto-number` / `--no-auto-number` | Auto numbering switch, written to the config's `autoNumber` key (default `--auto-number` = on, `--no-auto-number` is the disabling toggle; both switches present without `=false` is a usage error): with it on, task numbers (T-NNN) never repeat in the target directory; the phase planning session continues numbering from the `.auto/next-task` record and recovers it first when missing. The `phases = "m"` planning session (see [Planning tasks with AI](#planning-tasks-with-ai)) also continues from that record. See [Phased flow](#phased-flow---phases) |
| `-f` / `--force` | Skip the overwrite confirmation and the clean-worktree check, for CI and automation scripts (shared with `reset` / `fix`); on `amend` / `run` it is a usage error (amend discards no keys, so there is no overwrite confirmation to skip) |

Under `init` (the default full overwrite), the config-writing options above mean "not given falls back to the
default"; "only explicitly given keys are rewritten" is the `amend` subcommand's semantics (its `-p`, `-f`,
`--amend` are all usage errors). The project brief `.opencode/auto/brief.md` is a separate file: `init` writes
the project brief stub when the file is missing and keeps an existing one (it is not cleared by the config's
full overwrite); to supply intent, edit it directly — `init -p` is retired (appearing gets a message pointing
at this file and `plan -p`). `--server` was removed from init along with its de-AI-ification (init starts no
sessions). init writes nothing under `docs/` (round directories are established by `plan`) and starts no AI
sessions.

### Amending (amend)

`opencode-auto amend [dir] --<key-option> <value> ...` rewrites the given config keys and keeps the rest at
their existing values (auto-core plans/0052 D25; the old spelling `init --amend` is retired, folded into this
command). It accepts the same key options and values as init (`-m/--mode`, `--agent`, `--subtask`,
`--idle-time`, `--idle-max`, `--context-limit`, `--phases`, `--test-by-driver`,
`--handover-test`, `--auto-number`/`--no-auto-number`, `--wrapup`/`--no-wrapup`, `--parallel`,
`--scan-exempt`); value-range
validation, the `handoverTest` pairing check and the phase index prefix guardrail share their code with init.

- **Config keys only**: `-p` is a usage error (the brief is not config — edit `.opencode/auto/brief.md`
  directly); `-f` is a usage error (amend discards no keys, there is no overwrite confirmation or cleanliness
  gate to skip); `--amend` is a usage error (redundant).
- **At least one key**: giving no key option at all is a usage error, and the message points at `fix` (to
  only refresh the contract / AGENTS.md block to match the existing config, use `fix`).
- **Refused without a config**: when the target directory has no `.opencode/auto/config.json`, exit code 1
  pointing at `init` (with only the legacy `.auto/config.json` it also points at `fix`, which writes the full
  config from the old mode).
- **Strict loading**: if the existing config fails to load (retired keys, out-of-range values, …) it fails
  rather than carrying bad keys forward; when the failure is of a class `fix` can repair, a `fix:` line is
  appended to the message.
- **What it writes**: config.json, the agent contract and the AGENTS.md marker block (both rendered from the
  config) — it never touches round directories: changing `--phases` runs only the read-only prefix
  guardrail, and the difference between index and config is left as drift for `plan` to re-sync;
  `opencode.json`, `.gitignore` and the brief.md stub belong to `init` / `fix`, which amend does not touch.
- On success it prints `✓ amended (<given options>)`; the changes stay in the worktree, uncommitted — review
  and commit them yourself.

### Config fix (fix)

`opencode-auto fix [dir] [-f] [--dryrun]` repairs the config layer by rule (auto-core plans/0052 D10/D11):
`.opencode/auto/config.json` and the artifacts init writes from it. The baseline is the existing config on
disk (read as raw records, without strict validation); it accepts no config key options and **never resets
any key to its default** — unknown keys and keys no rule names are kept verbatim. The rules repair only keys
that "fail to load or silently lose their meaning"; legal alternative spellings (array-form `phases`,
`parallel: "none"`, `agent: "opencode"`) are left alone; phase index inconsistency is not fix's business (it
belongs to the later `plan`).

Findings come in two classes: **fixable** — deterministic and meaning-preserving, applied per the table
below; **manual** — reported only, never guessed (e.g. `handoverTest: true` with `testByDriver: false`:
which side to change is a person's decision).

| Object | Finding | Action |
| --- | --- | --- |
| `config.json` missing, legacy `.auto/config.json` has a mode | Fixable | Write the new file from the old mode + defaults |
| `commit` (any stored value but `true`) / `verify` (any value) / a contract-name `agent` (e.g. `auto`) | Fixable | Delete the key |
| `verifyIdle` / `verifyMax` | Fixable | Rename to `idleTime` / `idleMax` (key order unchanged); if the new key already exists, delete the old one |
| `source` / `destDir` | Fixable | Migrate the original value to the end of brief.md's `## Source` / `## Target` section (append the section at the end of the file if missing; start from the stub if brief.md is missing), then delete the key |
| `config.json` is not valid JSON / not an object | Manual | — |
| After applying the rules above the config still fails to load (out-of-range values, unregistered mode, pairing conflicts…) | Manual | Reported verbatim; the artifact rules below are skipped as a whole (`skipped:` line) |
| Agent contract `.opencode/agent/auto.md` missing / differs from the template rendered per `testByDriver` | Fixable | Rewrite from the template |
| AGENTS.md marker block missing / inconsistent with the current config rendering / leftover old or stray marker blocks | Fixable | Write the current block and clean up the others (body text untouched) |
| Intent packs fail to load (the marker block cannot be rendered) | Manual | — |
| `.gitignore` missing the `tmp/` or `.auto/` entry | Fixable | Append the missing entries |
| `.gitignore` missing the `/.opencode/auto/models.json` entry (projects initialized before init wrote it) | Fixable | Append that entry (the remaining local-only entries are left to the person) |
| `opencode.json` missing | Fixable | Write the built-in template (left alone when it exists, possibly containing manual edits) |
| brief.md missing | Fixable | Write the project brief stub (left alone when it exists) |

The artifact rules are rendered from the config, so they run only when the config (after the key rules are
applied) loads strictly.

Interaction mirrors `reset`: it first prints the findings list (`fix:` / `manual:` / `skipped:` lines); when
there are fixable items it goes through the clean-worktree gate, then asks once more `[y/N]` (no prompt
off-TTY; `-f`/`--force` skips both gates), then writes per the list and prints a `fixed:` line per item. fix
does not commit — the changes stay in the worktree for review.

`fix --dryrun` is the read-only half and the replacement for the retired `check` as a scripted gate on config
drift: it plans and prints the findings and writes nothing, exiting `0` when there are none and `1` when
there are any (fixable and manual alike), so a CI job can gate on the exit code. It skips only the gates
that guard writes — the clean-worktree check, the confirmation and the run-lock refusal (it runs beside a
live run) — and keeps fix's other refusals, including the uninitialized and legacy-layout ones.

| Case | Exit code |
| --- | --- |
| No config and no legacy mode (not initialized; run `init` first) | 1 |
| No findings at all (the config layer matches the config) | 0 |
| All fixable items applied, no manual items | 0 |
| Manual items present (fixable items still applied) | 1 |
| Dirty worktree (no `-f` given) | 1, no changes made |
| Confirmation answered with anything but `y` | 0, no changes made |
| `--dryrun`, no findings | 0, nothing written |
| `--dryrun`, findings (fixable and/or manual) | 1, nothing written |

Strict failures on the `run` / `status` and amend paths append a `fix: opencode-auto fix <dir>`
line when fix's key rules can repair them; recovery hints like a missing contract or a stale AGENTS.md block
likewise point at `fix` (previously they pointed at a no-argument `init`, which resets the other keys).

### De-initialization (reset)

`opencode-auto reset [dir]` is the inverse of `init`: it precisely removes the **config layer** artifacts
init wrote and restores the worktree to the uninitialized state, clearing config leftovers that would
otherwise interfere with the opencode host program and other extension components.

Cleanup scope (an enumerated whitelist — no globs, no recursive deletion):

| Target | Action |
| --- | --- |
| `.opencode/auto/config.json` | Deleted |
| `.opencode/auto/brief.md` | **Deleted only when byte-identical to the project brief stub**; if it has been filled in it is kept (human intent, not an init product) and the list explains why |
| `.auto/config.json` | Deleted (the legacy leftover config holding only `mode`) |
| `.opencode/agent/auto.md` | Deleted (`init` already overwrites it unconditionally from the template — a pure auto product) |
| `opencode.json` | **Deleted only when byte-identical to the built-in template**; if edited it is kept and the list explains why |
| `AGENTS.md` | Only the `opencode-auto` marker block is removed, the rest of the body kept verbatim; if only a hollow heading is left (i.e. the file was init-created in the first place) the whole file is deleted |
| `.gitignore` | Only the entries init wrote are removed (`tmp/`, `.auto/`, the local-only files `/.gitignore`/`/.env`/`/AGENTS.md`/`/opencode.json`/`/.opencode/auto/models.json` and the entries for existing nested git repositories); user-owned entries are kept; if the file is empty after removal it is deleted entirely. The model registry project layer `.opencode/auto/models.json` itself is not deleted (it belongs to the operator, not written by the driver) |
| `.opencode/auto/`, `.opencode/agent/`, `.opencode/` | **Reclaimed only when empty** (`rmdir`; skipped when non-empty) |

**Explicitly untouched**: `docs/` (including round directories `R-NN` and task directories `T-NNN`), all
runtime state in `.auto/` other than `config.json` (logs, `stats.json`, `resolves.json`, `progress.json`),
and `tmp/`. These are human and AI work products or run traces, not `init` artifacts.

Reclaiming only empty directories also preserves two things: your own prompt-override directory
`.opencode/auto/prompts/` and your other agent contracts under `.opencode/agent/`.

Two gates run before execution (`-f`/`--force` skips both):

- **Clean worktree**: when the repository containing the target directory, or any nested
  repository/submodule in the tree, has uncommitted changes, exit code 1 with the files listed and nothing
  changed. git is the only undo mechanism — a dirty worktree means no undo.
- **Interactive confirmation**: print the full list first (including kept items and reasons), then ask once
  `[y/N]`. Off-TTY (CI, scripts) it executes without prompting — but the cleanliness gate still applies.

After `reset`, a fresh `init` produces byte-identical output to the first one. When the directory holds no
`init` artifacts at all, `reset` prints "no init artifacts found" and exits 0.

### run options (this execution)

| Option | Description |
| --- | --- |
| `--server <url>` | Reuse an already-running `opencode serve` instead of spawning one; the environment variable `OPENCODE_AUTO_SERVER` works too. By default an `opencode serve` is spawned automatically with its lifecycle managed (network failures and AGENTS.md updates restart it — see [opencode server and agent selection](#opencode-server-and-agent-selection)) |
| `--verbose [true]` | Print every message part of the sessions (text, tool calls, reasoning, steps, …) plus context usage/share, every line timestamped, and every 10 seconds list files newly changed per git status (including nested git repositories in subdirectories) |
| `--interactive` / `-i` | Interactive side channel (mutually exclusive with `--verbose`): the terminal keeps the clean non-verbose output and waits for human input; Enter sends the input as an extra user message to the currently active session (steer semantics, processed at the next provider turn boundary; with no active session the input is dropped with a notice), and waiting for input never blocks normal execution. The log file still keeps the full `--verbose`-level record. The human waits of `--wait-answer`/`--wait-between` are also received through this input line; session messages resume after the ask ends. Typing `/exit` does not go to the session — it schedules a pause-and-exit at the next safe boundary (where a phase/task/subtask transition completes) with exit code `3`; progress is already persisted, and rerunning recovers fully |
| `--wait-answer [1-60]` | Questions first wait for a human stdin answer (minutes): non-permission questions are proxy-answered on timeout; for permission requests under `--permission`'s ask-* modes this is the wait window (see that option); without a value it defaults to 1 minute; without this option non-permission questions are proxy-answered immediately and permission questions (the question tool) simply block |
| `--wait-between [1-60]` | Pause between tasks waiting for a human (minutes): Enter starts the next task immediately, timeout continues automatically; without a value it defaults to 1 minute; without this option there is no pause between tasks |
| `--permission [mode]` | Handling policy for permission requests (permission.asked), default `ask-deny`: `auto-allow` auto-grants immediately (always allowed, no waiting); `ask-allow` / `ask-deny` / `ask-fail` first wait for a human (the window is `--wait-answer` minutes; unset means no wait, i.e. immediate timeout; answering `allow`/`yes`/`y` etc. grants, any other explicit answer denies that permission but the session continues); on timeout they fall back respectively to: auto-grant / auto-deny with the session continuing (the AI gets no grant to go around) / deny and exit the run (blocked halt, exit code 2) |
| `--dryrun [true]` | Permission preflight: a single AI call lists the directories/operations the tasks may need beyond the opencode.json grants, each confirmed by a read-only probe; the report is written to `.auto/dryrun.md` and printed to the terminal; no tasks are executed |
| `--new-session` | Force a new session on interruption recovery: skips session reuse (the escape hatch when the old session's context has gone stale); phase-level precise re-entry still follows the progress record; effective for this run only, never written to the config. See [Interruption recovery](#interruption-recovery) |

Every `run` (and every `plan` that enters the loop) creates a new log file `.auto/logs/run-<timestamp>.log`
in the target directory; all terminal output is written to it synchronously (written line by line, so an
interrupted process loses nothing already printed). Under `--interactive` the log file additionally contains
the verbose detail (session parts, context usage, changed files), matching what a `--verbose` run records.

Only one driver process may work in a directory at a time: `run` takes the **run lock** `.auto/run.lock` at
startup (JSON: pid `pid`, host `host`, command `command`, start time `started`) and deletes it when the run
ends (including a Ctrl+C force quit); `plan` holds the lock too (command recorded as `plan`, re-entering
internally through `runAll`), and so does `close` (command recorded as `close`). While another process holds
the lock, `run`, `plan` and `close` refuse with exit code `1` and name the holder; `init`, `amend`, `fix`,
`reset` rewrite files a running driver reads and are likewise refused with `1` (`fix --dryrun` reads and
prints only, so it runs beside a live run; `-f` does not step over the
run lock); `status` never takes the lock, and prints a live lock on its first line
(`▶ run in progress (pid 1234 on build-3, since …)`, or `▶ plan in progress (…)`/`▶ close in progress (…)`
when `plan`/`close` holds it). A same-host lock whose holder process no longer exists (e.g. after `kill -9`)
counts as stale: the next `run` or `plan` removes it automatically and prints a one-line notice; a lock
recorded on another host cannot be probed and always counts as valid. An unparseable lock file also counts as
valid — after confirming no process is running, delete `.auto/run.lock` by hand.

Exit codes: `0` everything complete (under the phased flow = all phases complete); `1` usage/environment
error (including a missing or invalid phase index, or the run lock held by another process); `2` blocked, or
incomplete work reverted to pending, waiting for human attention (including a blocked phase planning session
and the task report result line `Result: FAIL`); `3` `/exit` received under `--interactive`, paused and
exited at a safe boundary (no human attention needed — rerunning recovers fully); `130` force-terminated.

During a run a single Ctrl+C does not terminate (it only prints a notice); pressing Ctrl+C again within 3
seconds force-quits. Before exiting it best-effort restores write permissions on opencode.json, AGENTS.md and
the like, and shuts down the opencode server.

As each task and subtask starts, the output prints a prominent banner (an `=` rule for a task, a `-` rule
for a subtask; a repeated-character line followed by the title):

```
============================================================
T-009 Implement the migration

------------------------------------------------------------
T-009 Subtask 1: write the schema part of the migration script
```

In `true` subtask mode, when the task body has no checklist yet, the driver prints the implicit (automatic)
subtask split marker before opening the decompose session (a dotted rule, a blank line, then `<task id>
<task title>: subtask decomposition`):

```
............................................................
T-009 Implement the migration: subtask decomposition
```

### Planning and the round lifecycle (plan)

`plan [dir] [-p|--prompt <text> | --file <path>]` is the **planning command**: it shares the same state
machine with `run` plus one extra **stop condition** — it stops as soon as a planning step succeeds (or the
round reaches the point where tasks would execute), leaving the task list for human review; afterwards `run`
executes as usual (auto-core plans/0053 D4–D14).

```sh
opencode-auto plan <dir>            # no round yet → establish one and stop at the round-start gate; otherwise plan the current phase and stop before execution
opencode-auto plan <dir> -p "…"     # with a planning input: stored as this phase's plan-input.md, then planned
opencode-auto plan <dir> --file plan-brief.md   # planning input taken from a file (-p and --file are mutually exclusive)
opencode-auto plan <dir> --new-task "Fix the retry storm in the sync client"   # add this one known task with no session at all
opencode-auto run <dir>             # review (edit/strike tasks directly if needed), then execute
```

- **Choosing the planning scope** — use the lightest tool that fits:
   - a **multi-phase plan** is the phase flow itself: the `phases` value frozen by `init`
     (rounds and their phase directories are established mechanically, each phase planned in
     turn);
   - an **intra-phase multi-task plan** is a planning input: `plan -p "…"` for a fresh phase
     (or `--file <path>`), `plan --append -p "…"` to add to a phase that already lists tasks —
     a session decomposes the input into the task list;
   - a **single task you can already name** needs neither: `plan --new-task "<one-line
     title>"` adds exactly that task with no session (see
     [Adding a single task without a session](#adding-a-single-task-without-a-session-plan---new-task)).

- **Agent-free routes run first (plan prelude)**, decided after taking the run lock and before any session
  starts:
   - **Establish a round**: when the current round's `docs/R-NN/` does not exist yet, first run the
     round-close check (against the previous round), then establish this round's directory and print the
     round-start gate notice (the next line), exit code `0`. Under `phases = "m"` the same establishes
     `R-01/P01-implement`.
   - **Open the next round**: when the previous round is fully complete, first run the round-close check
     (G8): failing → print the problem list (one `✗` line each; `plan` refuses to open the next round until
     they are fixed), exit code `2`; passing → print warnings, establish the new round and stop at the
     round-start gate, exit code `0`.
   - **Phase index drift re-sync**: when the config's `phases` changed after the round was established and
     the current round is not complete, the not-yet-started tail of phase directories is re-synced (changes
     uncommitted; it stops for review and commit, exit code `0`; with a planning input it refuses first —
     re-sync without input, commit, then come back with input). `run` never re-syncs: on drift it stops with
     exit code `1` and points at `plan`.
   - **Notice-and-exit**: a blocked route → exit code `1`; the phase already planned (`run` takes over;
     exit code `0` when there is no input, keeping `plan && run` chainable) or an empty task index in `m`
     mode (hinting to list tasks by hand or use `-p`/`--file`) → print the notice and exit. When the round
     is complete and needs no planning, it hints to fill in `## Close` and then `plan` the next round.
   - **Input refused (before any write, exit code `1`)**: when no round is established, the round is
     complete awaiting a new one, or the target phase already lists tasks, a given planning input is not
     consumed — the message says "first `plan` without input to establish the round, commit the setup, then
     come back with input".
- **Planning input**: the `-p` text or the `--file` file's content (non-empty, mutually exclusive; `--file`
  must be a regular file), written verbatim by the driver to the phase directory's
  `docs/R-NN/P<nn>-<type>/plan-input.md` and **committed on its own before the planning unit starts**; the
  planning session reads it through the phase-plan template's `{{input}}` block. One file per phase, always
  the latest copy (history lives in git); a changed input restarts an in-flight planning step in a new
  session. To plan without input, just delete the file and commit.
- **`m` mode**: `plan -p`/`--file` is the entry point for "planning tasks with AI" (the former
  `--implement-*` is retired), see [Planning tasks with AI](#planning-tasks-with-ai).
 - **Options**: accepts `run`'s session options (`--server`, `--verbose`, `--interactive/-i`,
  `--wait-answer`, `--permission`, `--new-session`); rejects every config-class option (message identical to
  `run`'s) plus `--dryrun`, `--wait-between`, `--max-sessions`, `-f`, `--amend`, `--continue` (`run` in turn
  rejects `-p`/`--file`). Holds the run lock (command recorded as `plan`); creates a log file under
  `.auto/logs/` when it enters the loop. Exit codes as `run` (plus: a failed round-close check is `2`).
- **Questions go to the human (no AUTO-RESOLVE)**: plan runs for the pre-execution human review, so every
  non-permission question in its sessions is answered by a person — the driver **waits without timeout**
  (`-i`'s resident input line, or a stdin prompt without `-i`), `--wait-answer`'s timeout-proxy-answer
  fallback does not apply, and the session is not asked for AUTO-RESOLVE marking (see
  [Question policy and proxy-answer audit (AUTO-RESOLVE)](#question-policy-and-proxy-answer-audit-auto-resolve)).
  When the input channel is unreachable (stdin closed or empty answers) or the same question is asked
  repeatedly, it blocks for the human (exit code `2`); handle it outside the session and rerun.

Appending tasks (`--append`), adding one without a session (`--new-task`) and closing units
(`close`, `plan --force-close`) are covered in the next three
sections.

### Append planning (plan --append)

`plan [dir] --append -p <text> | --file <path>` appends tasks to the **current phase**: existing lines in
the task index are untouched, new tasks are appended after them per the planning input, numbering continuing
(`autoNumber` on: continues from and advances `.auto/next-task`; otherwise from the largest occupied or
listed number + 1). It never switches phases — whichever phase routing points at right now is the phase
appended to, including one on a handover route whose handover document is already written, or one held back
by a phase gate. In `m` mode with a non-empty index, an input-carrying `plan` already appends, so `--append`
may be omitted (giving it explicitly just counts as redundant).

- **Existing content stays untouched**: the append step (step kind `phase-append`) snapshots the task index
  and every existing task document on entry; if the session rewrites an existing line or an existing task
  document, it is refused and told to retry. Half-finished output a person committed after the step was
  interrupted counts as existing by the snapshot on rerun; only the new tasks after it are validated.
- **The old handover document is removed**: after a successful append, a `handover.md` already written in
  the phase is deleted by the driver in its own commit; the handover is distilled anew once the new tasks
  are done (acceptance.md / verdict.md are kept, rewritten by the next distillation).
- **No appending while the task pipeline is in flight**: while some task's recovery point is still in
  `.auto/progress.json` (mid-execution or just blocked), `--append` refuses with exit code `1` — finish it
  with `run` first, or close it with `close`. New tasks would queue behind a stuck task anyway and could not
  help it.
- `--append` without input is a usage error (what gets appended is exactly the tasks planned from the
  input); on routes where no round is established or the round is complete awaiting a new one, the input
  refusal rules match ordinary planning input.

### Adding a single task without a session (plan --new-task)

`plan [dir] --new-task "<one-line title>"` adds the **one task you name** to the current phase with **no
planning session at all**: you already did the planning, the driver does the mechanics — allocate the next
task number, write a conforming `docs/T-NNN/todo.md`, append the index line, and commit (trailer
`Auto-Stage: task-add`). It is the session-free counterpart of `--append`, and composes with
`--force-close` for a session-free task replacement:
`plan <dir> --force-close T-005 --reason "direction changed" --new-task "do X instead"`.

- **Targeting and guards are `--append`'s**: whichever phase routing points at right now is the phase
  added to (never another one, including one held back by a handover or a gate); it refuses while a task
  is mid-pipeline, and the round-setup routes (no round yet, complete, drifting) refuse like a planning
  input. One guard is added: while any planning / append / handover step is still open (interrupted, not
  closed out), the add waits — finish it with `plan` / `run` first.
- **The title is the whole task content**: it becomes the index line, the document's title and its
  `## Goal`; `## Scope` and `## Acceptance` are written as unrestricted, each noting its provenance
  (`Added by plan --new-task`). Sharpen `docs/T-NNN/todo.md` before `run` when the task needs a tighter
  scope or pinned criteria — the stop lines point there. The title must be one line.
- **Numbering**: `autoNumber` on — continues from and advances `.auto/next-task`; otherwise the largest
  occupied or listed number + 1. A missing numbering record is *not* recovered here (that recovery is a
  session); the deterministic scan picks the number, and the next planning session recovers the record.
- **A stale handover is removed first**, in its own commit before the add (the phase is distilled again
  once the task runs) — the add itself is one commit, and both require a **clean worktree** (exit 2
  otherwise): like every planning-side write, `--new-task` never rides a dirty tree, so after
  establishing a round, commit the setup first.
- **Usage errors**: with `-p`/`--file` (a planning input plans *through a session*), with `--append`
  (the session-planned way to add tasks), on any command other than `plan`, or a blank / multi-line
  title.

### Closing units (close and plan --force-close)

`close <ref> [dir] --reason <text> [--cascade] [--commit-changes | --stash-changes]` **closes** a unit
rather than completing it: for scheduling it is treated as closed out (the `todo.md` → `done.md` rename and
the index tick happen as usual), but it was **not delivered** — the reason goes into the `Closed:` field of
the unit's `done.md` field block, and the status tree (`⊘` mark), the completed list, planning notices and
handover distillation all flag it as "closed, not delivered — do not assume its artifacts exist". The target
`ref` must belong to the current round and be open, in three forms: `T-NNN` (task), `R-NN.P<nn>` (phase),
`R-NN` (a whole round, phased flow only; the single phase of `m` mode cannot be closed — close its tasks
instead). `--reason` is required and single-line; it is both the `Closed:` value and the tail of the close
commit's subject; an explicit ref plus the required reason is the confirmation — `close` asks nothing
further.

- **Commit and records**: the close lands in its own commit (subject `<ref> closed: <reason>`, trailer
  `Auto-Stage: force-close`, body listing every closed unit, the gates skipped per phase and the
  merged/stashed files); a closed phase gets a **mechanical handover** written by the driver (a handover.md
  with all four sections, recording the close reason and each task's done/closed status, no distillation
  session); in `.auto/` **only the closed units' own** run records are cleared (units.json entries, progress
  record, session handover). `.auto/next-task` never rolls back — closed numbers are never reused.
- **Dependencies**: open tasks whose `Depends:` explicitly names the unit being closed block the close and
  are listed one by one; `--cascade` closes them too (the reason annotated with the cascade origin, iterated
  to the closure). A default `Depends:` (implicitly following the predecessor) counts as satisfied; the
  output names those tasks. Subtasks never take part in a cascading close — their state files record how far
  the task got.
- **Dirty worktree**: uncommitted changes beyond the driver's own state files make `close` refuse (exit code
  `1`, files listed); `--commit-changes` merges them into the close commit, `--stash-changes` runs
  `git stash push --include-untracked` at every repository root (nested repositories first, each printed).
- **Exit codes**: `0` closed; `1` refused or usage error; `2` the close commit or close-out check failed.
- **Undo is `git revert`; there is no `reopen`**: `close` ends its output with
  `to undo before anything else runs: git revert <sha>`. The revert restores `todo.md`, removes the
  `Closed:` field, unticks the index and removes the mechanical handover; the cleared run records are **not**
  restored — a reopened task starts from zero, which is exactly what reopening should mean. The limit is
  "before any follow-up work runs": once later work has built on the close (say the next phase was already
  planned under the new state), the revert leaves two open phases and `reopen` would not help either.
- **`plan --force-close <ref> --reason <text> [close options above]`**: closes first, then continues
  `plan`'s normal flow in the same process (sharing `plan`'s run lock; close refused → exit code `1` with
  nothing written, commit failed → `2`; after a successful close the exit code is `plan`'s). Close-class
  options (`--reason`, `--cascade`, `--commit-changes`, `--stash-changes`) on `plan` without
  `--force-close` are usage errors; no other command accepts `--force-close`. Typical uses:

```sh
opencode-auto plan <dir> --force-close T-005 --reason "direction changed" --append -p "do X instead"   # swap out a task
opencode-auto plan <dir> --force-close R-01.P02 --reason "skipped this round"                     # skip the phase, plan the next one directly
```

## opencode server and agent selection

### opencode server: default auto-start and auto-restart

By default `run` **auto-starts** an `opencode serve` child process (requires the `opencode` CLI on PATH)
whose lifecycle is fully managed by this tool: the server is shut down on normal exit or force termination.
An external server is reused only when explicitly requested: `--server <url>` or the environment variable
`OPENCODE_AUTO_SERVER` (the address must be healthy, otherwise a usage/environment error with exit code 1).

The managed instance **kills itself and starts a fresh one** in two situations:

1. **Network-class session errors**: when a session error matches network/service-failure signatures like
   `Internal network failure` / `Network error`, the driver restarts the server first, then retries in a new
   session (at most 3 times; still failing blocks and halts), avoiding repeated failures against the same
   broken instance;
2. **AGENTS.md updated**: AGENTS.md is the sessions' system context; the driver tracks its change
   fingerprint (mtime + size) and, on detecting an update, restarts the server **before the next new session
   opens**, so the new session is guaranteed to load the latest content (AGENTS.md is re-read live on every
   provider turn anyway; the restart is a backstop for caching). Sessions no longer maintain AGENTS.md
   (read-only during `run`), so this path only triggers when the file is changed externally mid-run.

With an external server the instance is not managed by this tool: in the two situations above it only prints
a notice and does not restart (network errors still retry in a new session); starting, stopping and
repairing the external instance is the user's responsibility.

### Agent semantics and selection

The `agent` key selects the **coding agent that drives the sessions** (`init --agent opencode|claude`, M6.1):

| Choice | Description |
| --- | --- |
| `opencode` (default) | Managed or reused `opencode serve` (see above), the full capability set |
| `claude` | Claude Code headless (`claude -p --output-format stream-json`, requires the `claude` CLI on PATH); one child process per working session, `--server` ignored. Missing capabilities (fork, questions, …) are degraded automatically at run start and printed one by one |

Precedence: the shell profile's agent > the environment variable `OPENCODE_AUTO_AGENT` (per-run override;
empty string = no override) > the config's `agent` key > `opencode`. Every session (including the `m`-mode
planning session) is started by `run`'s driver and uses that agent.

The **agent contract** is always `.opencode/agent/auto.md`, generated and maintained by `init` (no longer
optional since M6.1; the old `--agent <name>` contract-name semantics are retired): a non-interactive work
contract — strictly do only the current role, treat state files as read-only, verification execution rights
belong to the driver, permission questions go through the question tool while everything else is decided
autonomously with the decision process recorded. opencode uses it as the session agent; claude appends its
body to the system prompt and translates `opencode.json`'s permission rules into claude settings. When the
contract differs from the built-in template, `init` / `amend` / `fix` always replace it with the latest
template, and `run` prints a refresh hint at startup when it spots a mismatch; a missing file is caught by
the pre-run integrity check — both point at `opencode-auto fix <dir>` (rewrites the contract from the
current config, touching no key).

## Model registry and tiered routing (model registry)

Which models exist, which agent runs each, which keys pay for them and when they are cheap is the
**operator's** knowledge, not project content: it lives in the **model registry** outside the target
directory (auto-core plans/0055), merged from two layers:

- **Operator layer**: the file named by `$OPENCODE_AUTO_MODELS`; when unset,
  `$XDG_CONFIG_HOME/opencode-auto/models.json` (`XDG_CONFIG_HOME` defaults to `~/.config`; relative values
  are ignored). A missing file counts as no operator layer (no fallback to the XDG path).
- **Project layer**: `.opencode/auto/models.json` (optional). It belongs to whoever operates this checkout
  and does not travel with the repository, hence a **local-only file**: `init` writes
  `/.opencode/auto/models.json` into `.gitignore` (`fix` backfills the entry for older projects), `reset`
  removes only the entry and never deletes the file itself, and during `run` it is read-only alongside the
  other configs; a project layer git does not ignore (or already tracks) is refused at `run` / `plan`
  startup (exit code 1, message pointing at `fix`).

Neither layer present means **no registry**: every behavior stays byte-for-byte as before and the
environment-switch semantics are unchanged. The merge is one level deep: each of the project layer's
`agents` / `models` / `tiers` / `routes` keys **wholly replaces** the operator layer's entry of the same
name (a `null` value deletes that operator entry); `tz` / `classifier` replace wholesale; entries are never
merged internally. Loading is **strict**: bad JSON, unknown fields (tolerated neither at top level nor
inside entries — a misspelled `aviod` would silently push a model back into peak hours), bad windows and
bad references are all reported item by item at startup with exit code 1 (each naming the layer and file).
The registry is read once at run start; edits take effect on the next run. The driver only reads, never
writes either layer.

### Registry format

JSON. The **internal name** (`^[a-z][a-z0-9.-]*$`) is a model's registry key: it contains no `/`, so it can
never be confused with a bare `provider/model` string. The example is illustrative (neither the names nor
the windows are any provider's real price sheet):

```json
{
  "tz": "Asia/Shanghai",
  "agents": {
    "opencode": { "adapter": "opencode", "env": { "HTTPS_PROXY": null } },
    "claude":   { "adapter": "claude", "env": { "HTTPS_PROXY": "http://127.0.0.1:7890" } },
    "claude-b": { "adapter": "claude",
                  "env": { "CLAUDE_CONFIG_DIR": "~/.claude-b", "HTTPS_PROXY": "{env:CLAUDE_B_PROXY}" } }
  },
  "models": {
    "opus":   { "agent": "claude",   "model": "opus", "avoid": ["mon-fri 09:00-18:00"] },
    "k3":     { "agent": "opencode", "model": "moonshotai/kimi-k3-256k", "wider": ["moonshotai/kimi-k3"],
                "keys": ["{env:MOONSHOT_KEY_A}", "{env:MOONSHOT_KEY_B}"] },
    "glm":    { "agent": "opencode", "model": "zhipuai/glm-4.6", "only": ["00:00-08:00", "sat-sun 00:00-24:00"],
                "keys": ["{env:ZHIPU_KEY_A}", "{env:ZHIPU_KEY_B}", "{file:~/.secrets/zhipu-c}"] },
    "free":   { "agent": "opencode", "model": "opencode/some-free-model" }
  },
  "tiers": { "deep": ["opus", "k3"], "simple": ["glm", "free"] },
  "routes": { "acceptance": "deep", "phase-handover": ["free"] },
  "classifier": ["free"]
}
```

**Agent profiles** (`agents.<name>`): `adapter` is required (`opencode` / `claude`, or a name the shell
registered via `registerAgentAdapter`); `bin` is optional (an executable; by default the adapter's own
`opencode` / `claude`); `env` is optional (see below); `server` is optional (opencode only: an external
server address; `--server` still overrides per run). No `agents` section implies a single `opencode`
profile. Several profiles sharing one adapter give **account fault tolerance**: two claude profiles
differing only in `CLAUDE_CONFIG_DIR`, each logged in outside the driver, both listed in a tier — switching
on failure is an ordinary model failover.

**Model entries** (`models.<internal name>`): `agent` is required (a profile name); `model` is optional —
when absent the agent's own default model is used (the prompt carries no model), and the entry may not have
`keys` / `variant` / `wider`, so a "pausing-only" registry can be expressed; `avoid` / `only` are mutually
exclusive (a window list); `keys` is an ordered key ring (opencode only); `wider` is the context step
(opencode only); `variant` passes through opencode's per-prompt variant (e.g. reasoning effort; claude
rejects the field at load); `context` is optional (the context window in thousand tokens, for agents that
do not report one before startup); `retry` is optional and overrides fields of the agent's retry policy
(`maxAttempts`, `backoffCapMs`, `honorsRetryAfter`, `waitsOutLimit`, `silenceBudgetMs`; auto-core
plans/0057 §4) where the profile changes how the agent retries, e.g. a claude profile whose `env` sets
`CLAUDE_CODE_RETRY_WATCHDOG` or `CLAUDE_CODE_MAX_RETRIES`.

### Tiers and routing

Sessions come in two tiers: **deep** (deep reasoning needed) and **simple** (reports, distillation,
extraction). Listing a model in a tier *is* its classification; the same model may appear in both. The
program's default table: phase planning, the `m`-mode planning scan and decompose are deep; wrap-up, phase
handover, knowledge/prior-knowledge, numbering recovery and one-shot bypass sessions are simple; task
sessions (whole-task, subtask) use the **phase type's execute tier** — among the builtin types a analysis /
d design / v acceptance are deep, m implementation / t test / k knowledge distillation are simple, and a
custom type reads its type file's `Reasoning: deep|simple` field (default deep, versioned with the
project). **Borrowing** is one-way: a simple session whose simple list has nothing available continues down
the deep list (availability beats cost); a deep session never borrows simple — it waits, because depth is
the reason it exists. `routes` is the operator's override: keys are role words / phase type ids / preset
letters (precedence as in `OPENCODE_AUTO_MODEL`'s key syntax; `*` is not allowed — the tier lists themselves
are the default), values are a tier name or an ordered list of internal names.

Every dispatch takes the **first entry available right now** from the candidate list: past the agent
filter, inside its window, not down-marked, its provider's key ring (if any) still has an unmarked key, and
its known context window is at least the project limit (stepped entries check the top step). Continuations
of the same prompt (retries, forks after failure, wait-loop redispatches, strict recovery) keep the chain's
model; a new prompt goes back to the preferred entry at any time — it returns automatically once the
preferred window reopens or the mark clears, so failback in cheap hours needs no extra state. With no
available candidate: candidates exist but are windowed out → **wait for the earliest opening** (the sleep
happens inside the unit, with the same 0–600 s random jitter as hibernate, counted as `window` waiting; two
consecutive Ctrl+C force-quits); all down-marked → the existing **wait-and-probe loop** (probes the first
in-window candidate and clears its mark on success); the tier has no candidate left after filtering → a
preflight error (exit code 1), never a silent wait.

Session errors escalate **key → model → wait**: quota/auth/rate-limit classes first try key ring rotation,
then failover to another model, and finally wait (the retry ladder of auto-core plans/0017 is unchanged).

### Windows and time zones

`avoid` makes a model unavailable inside the listed windows; `only` makes it available only inside them.
Syntax `[days ]HH:MM-HH:MM`: `days` is `mon`..`sun`, a range (`mon-fri`, may wrap the week like `fri-mon`)
or a comma list (list items may themselves be ranges, `mon-wed,fri`), defaulting to every day; `24:00` is
allowed only as an end point; a window crossing midnight (`22:00-06:00`) belongs to the day it starts. One
`tz` per file (an IANA zone, default `UTC`), interpreted on the local clock face including DST rules (a
nonexistent time opens at the jump; a repeated time takes the first occurrence). Windows gate **dispatches**
only and never interrupt a running turn; the running turn finishes and the next dispatch re-selects. The
machine clock is taken as correct; after system sleep the sleep simply arrives late (same as hibernate).

### Key ring

Multiple API keys for one opencode provider form a **ring**: declared on model entries, effective for the
whole provider — every entry of the same provider must declare the same ring (or none); two different rings
are a load error. Keys **accept references only**: `{env:NAME}` or `{file:path}` (relative paths resolve
against the layer file); literal secrets are rejected at load. The driver never reads a key's value into
any string: the reference reaches the managed opencode server through the spawn config
(`OPENCODE_CONFIG_CONTENT`) and is substituted inside the server's own process; logs and output name the
reference only (`key 2/3 ZHIPU_KEY_B`). **Rotation is a managed server restart**: the next key goes into
the spawn config and the server restarts (sessions survive the restart); the failed session is forked and
resent on the **same model**. The ring position only advances — clearing a key's mark never rewinds it; it
moves only when the current key fails, avoiding restart churn; a successful probe likewise clears only the
mark. An external server (`--server`, a profile's `server`) cannot be restarted, so the ring is inactive
under it (the startup log says so). **No provider is listed as verified for key rings yet**: the generic
provider path (config apiKey taking precedence over the environment and `auth.json`, `{env:}`/`{file:}`
substitution inside the server process, setConfig+restart resend) is verified at the source and mechanism
level on real machines, but custom loading paths — bedrock, cloudflare, cloudflare-ai-gateway, gitlab and
gateways (env before config) — each need a two-key smoke test (`OPENCODE_AUTO_E2E_KEYS`, see the e2e notes
of `packages/auto`) before being listed.

### Context step

When the same model is sold under several ids that share the prompt cache and differ only in context window
and price (e.g. kimi `k3-256k` vs `k3`), write **one entry**: `model` is the base step and `wider` lists
the progressively larger ids. The entry is the unit of routing: tiers, routes, windows, key rings and down
marks apply to it as a whole; the project limit is clamped against the top step. Load validation checks
that every step is on the same provider with strictly increasing windows (verified once the server is up; a
step with an unknown window is disabled from that step on, with a warning). When the session context
reaches the current step's **step-up point** (window − max(48k, window/5)), the driver steers **the same
session** with the next id — session, history and cached prefix all stay put, no fork, no handover; the
interjection always names the current id so the server does not drop later turns back to the base step.
Within a session it only steps up, never down; a new session (new prompt, after a handover, failed over
onto this entry) starts at the base step; on recovery it is recomputed from the historical context size and
not persisted. The first step-finish after a successful step-up interjection checks the cache claim (large
`cacheRead` → sharing holds; a full-prefix `cacheWrite` → contradiction, warned once per entry). Stepping
up early only pays the price difference; stepping up late means the server compacts as usual and the log
records `step-up late`.

### Profile env: proxies and multiple accounts

A profile's `env` layers on top of the driver's environment and applies only to that profile's processes:
values are literals (`~` expanded), `{env:NAME}` / `{file:path}` references (resolved by the driver before
the profile's host starts; a host restart reuses the same resolution) or `null` (removes the inherited
variable, keeping a global proxy away from agents that must connect directly). Uses: `HTTPS_PROXY` and
friends route that agent's traffic through a proxy (`NO_PROXY` does not include loopback by default, and the
driver's own loopback traffic to the managed server would be intercepted by the proxy — preflight warns when
`HTTP_PROXY` is set and `NO_PROXY` lacks `127.0.0.1,localhost`); `CLAUDE_CONFIG_DIR` turns two externally
logged-in accounts into two profiles. **One opencode server, one environment**: all providers on the same
server share its env; when only some providers need a proxy, list the direct hosts in `NO_PROXY`, or declare
two opencode profiles (each runs its own managed server and holds its own key ring; sessions never cross
profiles). An external server keeps the env it started with; a profile's `env` has no effect on it. Logs and
`models` output name variables only, never values.

### Failure-message classifier (classifier)

Providers phrase failures differently (other languages, plan limits, "resets at 15:00"); when the error
pattern strings cannot decide, the models listed in the registry's `classifier` (usually free models) read
it: they are asked only when the pattern strings are inconclusive (unknown class, or a rate signal below
its threshold; never for overflow / already-decided quota / auth), at most once per failed turn, and a
30-second timeout or failure counts as no answer — the pattern-string verdict stands. The reply is one line
of JSON (`class` + optional `resetAt`) and **only ever escalates**: unknown takes the reply's class (quota /
rate / auth / transient — rate also requires the pattern string's own threshold to hold), a rate signal
below threshold may only escalate to quota, and a class the pattern strings already decided is never
downgraded. A quota / auth reply ends the turn immediately, like a pattern string (after the abort:
key → model → wait); `resetAt` (with timezone offset, within the next 7 days) sets when the down mark
lifts. At most 20 calls per run, cached by the redacted text (the same text is paid for once). It receives
**only the redacted error text** (≤2000 characters; key-like tokens / emails / URL query strings stripped),
in a one-shot session on the adapter's default agent with **all tools disabled** — a free tier may retain
what it receives, hence the narrow input surface. The classifier's own failures are classified by the
pattern strings and only mark the classifier entry itself. Its tokens go into the `classify` bucket, not
the unit session totals.

### The agent pool and run behavior

Under a registry the driver **lazily starts one host per selected profile** (a profile nobody selects never
spawns; one managed server per opencode profile, with the profile's `bin` / `env` / key ring spawn config
applied to its own process — the driver spawns `opencode serve` itself, no longer through the SDK).
Sessions **never cross profiles**: a cross-agent move = a new session + a worktree-verification note;
session chains and persistent records (progress record, fork base, handover anchor) all carry the agent,
and an old record without the field belongs to the default agent. At startup, **capability degradation
intersects** over the adapters the filtered tier/route lists involve (each note naming the agent that lacks
it; the classifier list does not widen the intersection); preflight runs `<bin> --version` (10 seconds) for
every referenced profile. Run start prints the **routing block** (each tier's list with every model's
agent, current window state, ring position; effective routes; filtering); every dispatch prints a `◈` line
naming the reason for the move (`window` / `quota` / `key ring` / `failback`; a classifier origin annotated
as `quota (classifier)`); waits print `⏸` lines and step-ups print `⇡` lines. Stats are booked per internal
model name and per tier (bare override values as the raw string); the round-completion conclusion has one
line per model (this round only) plus a per-tier summary; with no model data the persisted shape and the
conclusion stay byte-identical.

### Environment variables and commands with and without a registry

| Surface | No registry | With a registry |
| --- | --- | --- |
| `OPENCODE_AUTO_MODEL` | Unchanged | Same key syntax; the value is an **internal name**, or a bare `provider/model` running on the default agent (no window, no ring, no stepping). Overrides the matched session's candidate list, this run only |
| `OPENCODE_AUTO_MODEL_FALLBACK` | Unchanged | **Usage error** (exit code 1): the tier list is the failover order |
| `OPENCODE_AUTO_MODEL_FAILBACK_SCOPE` | Unchanged | Clears down marks (both the model and the key kind) |
| `/failback [a b …]` | Unchanged | Arguments are internal names; wholly replaces every list from then on (same semantics as an override) |
| `OPENCODE_AUTO_AGENT`, the shell profile's `agent` | Selects the run's single agent | **Filter**: only models on that adapter are candidates. The config's `agent` (init `--agent`) is no longer a filter but the **default agent** — bare `provider/model` values and session records without an agent belong to it; a startup notice when no tier uses it |
| `--server` / `OPENCODE_AUTO_SERVER` | Unchanged | Overrides an opencode profile's `server`; the key ring is inactive under an external server, and the profile's `bin` / `env` have no effect on it |

The registry's effective table: see [Model registry overview (models)](#model-registry-overview-models).

## Execution pipeline

The driver runs a pipeline for every task, and **index ticks, the `todo.md` → `done.md` rename and
`.auto/units.json` are written by the driver alone**. How a task executes is decided by the project config's
`subtask` key (`auto` is the default):

`subtask: auto` (adaptive decomposition, the default; auto-core plans/0059): the task runs as one lead
session under the same context-budget protocol as `subtask: ondemand` below, and its prompt carries a split
rule. By default the lead finishes the task itself, handing over by time as `ondemand` does. It may split
only when the remaining work is 2–5 substantial streams that each change their own files, and only once the
driver's first usage notice (half the wall) has arrived: it then builds the shared foundation itself, writes
one line per stream into `docs/T-NNN/subtasks.md` (`- [ ] <title>: <what, where, how to verify> Depends: S01
Artifacts: <paths>`) and ends. The driver checks the split mechanically — 2 to 5 lines, a valid dependency
graph, no path declared by two streams unless one depends on the other, the lead's final context at least
half the wall:

- **Taken**: the driver writes each stream's `S<nn>/todo.md` from its line, commits the lead's work with the
  checklist as the task's `exec` commit, and the streams run one at a time, each in a fork of the lead, then
  the common wrap-up. A fork already holds everything the lead read, so its prompt is a short delta: the
  stream's line, the other streams by title, the files changed since the split when the stream waits for an
  earlier one, checks targeted at the stream, and the task's full verification in the last stream. A stream
  runs under the same context-budget protocol and may hand itself over: a new session continues it from
  `docs/T-NNN/handoff.md`, and the stream still closes with one commit. The lead's final context figure is
  kept with the split in `.auto/units.json`, so every stream — and every stream of a resumed run — can fork
  the lead on an agent that cannot read an ended session's size back (claude). Without a fork (the lead's
  session is gone, or the fork fails) a stream starts in a new session with the full subtask prompt.
- **Rejected**: `subtasks.md` is removed, the lead's work is committed, and a fork of the lead is told why and
  finishes the task (when the fork fails, a new session with the full prompt). There is no second split: a
  `subtasks.md` written after that is removed.

Without usage notices (`OPENCODE_AUTO_STEER=off`, or an agent that takes no mid-turn messages), with an agent
that cannot fork sessions (every stream is a fork of the lead; under a model registry, any agent the run may
use — the run start prints a degradation note naming it), or when the task already has a checklist written by
hand, the lead gets no split rule and runs exactly as `ondemand`. A
stored `"subtask": "auto"` takes this meaning with no migration; `amend --subtask true` keeps the pipeline.

`subtask: true` (the planned pipeline — what `auto` meant before auto-core plans/0059):

1. **Decompose** (when `docs/T-NNN/subtasks.md` has no checklist yet): one session analyzes the task and
   writes `docs/T-NNN/subtasks.md` (a Markdown checklist — the task's subtask checklist itself) plus each
   subtask directory's `todo.md`. Producing no valid file is retried once automatically with feedback;
   failing again blocks.
2. **Execute subtask by subtask**: all execution sessions within a task (decompose/subtask/repair/wrap-up)
   form one chain, and reuse within the chain is **off by default** — every prompt opens a new session (each
   prompt carries its full context and does not depend on the previous session's memory); set
   `OPENCODE_AUTO_REUSE_SESSION=on` to restore threshold-based reuse: the previous session is reused only
   when its context share at the end was below 50%, its used tokens below half the configured `contextLimit`
   (32k tokens by default) and it ended **no more than 5 minutes ago** (share and usage are always tracked,
   independent of `--verbose`; when the model's context limit is unavailable the share is recorded as 100
   and a new session is always opened; driver-managed scripts and bypass sessions can run long — past 5
   minutes the context counts as stale and a new session starts automatically). Every session end
   unconditionally prints two stats lines: line 1 `◉ session ended: context n% (used/limit tokens), time X
   (cumulative Y / N turns)` (pure-AI time, accumulated across interruptions), line 2 the token breakdown
   (in/out/thinking/cache-read/cache-write/hit-rate/cost); reused sessions and sessions taken over by
   interruption recovery print them too; task completion / phase close-out / round completion each add
   their own conclusion line (cumulative time and token breakdowns across interruptions at each level;
   stats live in `.auto/stats.json` in the target directory, the file deleted when zeroed).
   A subtask session gets no context-budget protocol (auto-core plans/0056 D1): no usage notices, no
   handover; one that outgrows the budget runs into the provider's own compaction or limit errors and the
   session-error retry path. A subtask handover document an earlier release left (`docs/T-NNN/handoff.md`)
   is still read on resume, and deleted once the subtask completes.
   The subtask session self-checks its own work; after the session ends the driver renames the subtask's
   `todo.md` to `done.md` and ticks the matching line in subtasks.md.
   Each checklist line opens with a short title (`- [ ] <title>: <description> Artifacts: <paths>`), and a
   subtask session sees the other items by title only. It runs the checks aimed at its own changes, not the
   full suite; the last item then runs the task's full acceptance verification once, so the decompose
   session plans no separate close-out item. An item is sized so that its own work — what its session reads
   and writes beyond the context it starts with — is on the order of half the context budget. Under the
   default fork base (`OPENCODE_AUTO_FORK_BASE=digest`) a subtask session is told it inherits the
   task-background digest alone (the files the decompose session read are not in its context). The
   fine-grained decompose criteria (`OPENCODE_AUTO_DECOMPOSE_FINE`) are off by default since auto-core
   plans/0059 (`=on` restores them): their premise, no re-reading cost between subtasks, holds only for the
   `session` fork base.
3. **Wrap-up**: see the common part below.

`subtask: off` (splitting disabled): one session completes the whole task, then the common wrap-up runs; if
the session fails to finish there is **no repair rerun** — the driver reverts the task status to `pending`
and halts with exit code 2, for a person to improve the task documents and rerun.

`subtask: ondemand` (handover on demand; auto-core plans/0056): the task runs as a single session that manages
its own context against a **wall** — twice the configured `contextLimit`, raised to a quarter of the model's
window when that is larger and capped at 80% of the window (at the default 64k: 102k on a 128k window, 128k
on a 160k–512k window, 250k on a 1M window). The driver steers one-line `[DRIVER] context: …` usage notices
into the running session at about 50% and 85% of the wall; they are information, not interrupts. The session
decides when to hand over:
at a natural boundary it writes progress, key decisions, verified facts, dead ends and next steps to
`docs/T-NNN/handoff.md` (last line `Status: continue|done`; the older Chinese spelling is still readable) and
ends, and the driver opens a new session that continues from the handover document until the task completes.
Only a session that reaches the wall itself gets the hard-wall hint to write the document at once.
`OPENCODE_AUTO_STEER=off` turns the protocol off (no notices, no hint, a written document ignored).

Common part (**wrap-up**): one session updates docs/ and `docs/T-NNN/report.md` (a summary of each
subtask's output) coherently; after the session ends the driver runs the unified commit. The driver then
reads the report's result line (see
[Acceptance result line](#acceptance-result-line-result-passfail)): no result line or `Result: PASS` → the
task is marked done; `Result: FAIL` → the task is blocked and the run stops (exit code 2). Completion is
never judged by session self-report: subtasks are ticked by the driver from the state files, a unit is
complete when its artifacts are on disk and the unified commit succeeded, and checking work is itself
planned as tasks (acceptance tasks, the v acceptance phase), whose verdict reaches the driver only through
the result line.

There is no separate current-task mirror (`CURRENT.md` was retired on 2026-09-25, auto-core plans/0054):
every session's prompt inlines the current task, and the task's full content and progress live in its own
`docs/T-NNN/todo.md` and `docs/T-NNN/subtasks.md` — the AGENTS.md pointer block tells sessions to re-read
those two files when the context gets compacted or progress is uncertain (AGENTS.md, as the system context,
is re-read live on every provider turn and does not disappear with context compaction). The reason for a
block or a revert-to-pending is printed in the run log; the interrupted phase stays in the progress record.
A `CURRENT.md` left by earlier releases (first line the heading it always wrote) is deleted at `run`/`plan`
startup, the deletion recorded in the startup carryover commit; a same-named file with a different first
line belongs to the project itself and is never touched.

When a non-permission question goes unanswered, the driver proxy-answers it and requires the AI to decide
on its own and continue; the proxy answer also requires the AI to **record the decision process** (the
rationale and the rejected alternatives go into the relevant documents) and to mark two classes per "whose
call was this decision point supposed to be" — `AUTO-RESOLVE` for calls that were yours but were closed on
your behalf, `AUTO-DECISION` for engineering decisions the AI should have made itself; the former is
highlighted at the top at task end to remind you to review. See
[Question policy and proxy-answer audit](#question-policy-and-proxy-answer-audit-auto-resolve).

### Interruption recovery

When the previous run was interrupted by kill/Ctrl+C, `.auto/units.json` may be left with an `in_progress`
status (no session actually running); at startup `run` resets all of them to `pending` and resumes normally
(`attempts` preserved) — no manual cleanup needed.

Recovery is grounded in the **progress record** `.auto/progress.json`: during a run the driver persists
`{task, session, at, active, phase}` at every stage boundary of the task pipeline — `phase` marks the
current stage (decompose / whole-task execution / subtask by subtask / wrap-up / result-line check), and an
execution-chain session is recorded live as `active` while it runs; one-shot bypass sessions such as dryrun
and fork bases write no record (they do not pollute the execution chain's memory). The record is deleted
when the task completes; the legacy `.auto/session.json` is read compatibly.

**In-session recovery** (session interrupted mid-flight with no way to summarize progress — kill/crash/
network failure): as long as the session still exists on the server, the driver simply **reuses it and
continues** (no context loss, isomorphic to `opencode -r <session-id>`, no time window anymore; the takeover
is exempt from `OPENCODE_AUTO_REUSE_SESSION` and the reuse thresholds, the recovery log carries the
inherited context usage, and the recovery note is cleared after use — the next prompt returns to the normal
rules); the first prompt carries a recovery note asking the AI to verify actual progress with git
status/diff and continue from where it broke off. **Handover files take precedence**: when a handover
document was already written before the interruption (the `docs/<id>/handoff.md` of `subtask: ondemand` or
`auto`, or handover-test's task-level/subtask-level `testhandoff.md` — a leftover at either
scope decides it), the old session is not reused — its context was full and progress is carried by the
handover document, so a new session continues from the handover (with the handoff marked `Status: done`, the
whole-task session is skipped outright). When the session is gone or `--new-session` is given, a new session
opens: the recovery note gives concrete next-step guidance per the recorded stage, likewise redoing no
finished work — `--new-session` skips only session reuse, phase-level precise re-entry stays, and it is the
escape hatch for stale old-session context. An interrupted event stream (the stream drops before the
session-end event, likely a server failure or network cut) is likewise treated as mid-flight, never
misjudged as a natural session end.

**Phase-level precise re-entry**: recovery re-enters the pipeline per `phase` instead of starting over —

- Decompose stage: valid checklist items already written to `docs/T-NNN/subtasks.md` last time → adopted
  as-is, no new session;
- Subtask by subtask: continue from the first unfinished item (subtask `todo.md`/`done.md` are naturally
  persistent);
- Under `auto`, a split the guard already took is not decided again: the lead does not rerun, and its
  streams continue from the first unfinished one;
- Wrap-up: off/ondemand do not rerun the whole-task execution session, just the wrap-up;
- Wrap-up already done (result-line check stage): no session at all — read the result line and register
  completion — a legacy progress record sitting in the retired verify / review stages is handled the same
  way.

**Graceful-exit summary** (halts not caused by the AI service — blocked, reverted to pending, …): the exit
reason is printed in the run log and the progress record turns into a summary state (the old session is no
longer reused — human attention may take hours and changes the environment, so the old session's context is
no longer trustworthy); after rerunning, a new session continues precisely from the tick state and stage
record. When strict recovery rolls a unit back, the retracted work goes into git stash (message prefix
`auto-rollback`); the log says how to retrieve it. Exhausted network-failure retries count as "interrupted
mid-flight with no summary" and keep session-reuse eligibility — recovery prefers to reclaim the original
session.

During `run` the driver makes opencode.json, `.opencode/auto/config.json`, AGENTS.md and the model registry
project layer `.opencode/auto/models.json` (when present; the driver reads it only at startup and never
writes it) read-only (chmod 0o444), temporarily restoring write access for its own writes and re-setting it
immediately after. When `run` ends (including a blocked exit) they become writable again, for human editing
(including hand-revising the project config); read-only bits left by a force-killed run do not stop
`init`/`amend`/`fix`/`reset` from rewriting these files. This is a guard rail against accidental writes
beyond the prompt contract — a same-user process can still bypass it via bash chmod; it is not a security
boundary. Sessions do not maintain AGENTS.md (see [AGENTS.md marker block](#the-agentsmd-marker-block)): the
driver only ensures, before starting a session, that it contains the single opencode-auto marker block
rendered from the current config (appended when missing, replaced wholesale when the content differs; old
or extra named marker blocks are always cleaned up) and never rewrites AGENTS.md otherwise.

## Acceptance result line (Result: PASS|FAIL)

Task-level acceptance `verify` (three-stage script acceptance and the `verified` field), quality review
`--review`/`--early`/`--early-review` and the final-review loop `--final-review` were retired on 2026-09-21
(auto-core plans/0044-completion-side-retirement-design.md): checking and acceptance are **planned work** —
written as ordinary tasks, or carried by the phased flow's v (acceptance) phase. The driver keeps exactly
one verdict on the completion side:

- The wrap-up session writes `Result: PASS` or `Result: FAIL <one-line reason>` on its own line as the
  last body line of `docs/T-NNN/report.md` (before the eof marker) — a protocol string, written verbatim:
  no translation, no bold, no list marker. When to write it and what FAIL means are intent-pack content
  (`## acceptance` / `### result-line`): required whenever the task description asks for checking, tests,
  verification or acceptance, and also written when the task's goal turns out unmet; PASS requires every
  requested check to have actually run or been observed, with evidence in the report. An intent pack that
  omits the section simply does not impose the requirement (the run never stops);
- The driver goes by the last `Result:` line (case-sensitive): `PASS`, no report or no result line → mark
  done; any other value → treated as no verdict; `FAIL` → the report and changes were already committed
  with the wrap-up's unified commit, the task is set `[blocked]` and the run stops (exit code 2), the
  reason printed in the log;
- Human disposal: accept the verdict → mark the task `[done]` by hand; needs rework → insert a repair task
  **before** it (with a subtask checklist, hand-appending items to that task's checklist is an illegal
  subtask state — repairs are always planned as tasks); then rerun. Rerunning the blocked task directly only reruns the
  wrap-up and rewrites the result line.

Retired options are exit code 1 on any command (with a retirement notice); config `verify: true` fails
strictly; the model-routing verify-*/review-*/final-plan role keys error the same way. Existing PLAN.md
files (with their `verify:`/`verified:`/`final:` field lines and `T-F<k>` tasks) have not been read since
M3.4; leftover `.auto/verify.md`, `.auto/review.md`, `tmp/verify.*` are not cleaned up.

## Test execution protocol (--test-by-driver)

`--test-by-driver` (a constitutional option, fixed into the config's `testByDriver` key by `init
--test-by-driver`; appearing on `run` is a usage error) moves execution rights for "implementation-phase
commands that can run long or produce massive output — compile/test/build/lint and the like" to the driver.
It applies to execution sessions — subtask sessions (`subtask: true`, and the streams of `auto`'s split) and
whole-task sessions (`off` / `ondemand`, and `auto`'s lead); bypass sessions such as decompose and wrap-up are out of scope (`--dryrun` does not enable it
either).

The protocol mechanics:

- **Request = script + marker**: when a session needs to run such a command, it writes the command as a
  script in `test/` (clearly named, executable, reusable, versioned with the repository), writes the script
  path (relative to the working directory, e.g. `test/build.sh`) into the `tmp/test.sh` marker file (the
  driver-managed work directory in the target directory, already gitignored), and ends its turn. The
  marker's presence is the "pending request" — there is no mtime race; rewriting the marker requests again.
- **Execution and output**: the driver detects the marker while the session is idle: if the trimmed content
  is a single line naming an existing file path, it runs that script directly and best-effort adds
  `chmod +x` (no debugging needed when the session forgets the exec bit; scripts in `test/` are already
  versioned by the unified commit, no extra archiving); otherwise it falls back to an inline script,
  writing the content wholesale to `tmp/test.<n>.sh` and running it (an execution snapshot kept for audit).
  Either form removes the marker first, then executes in the target directory (sharing the `idleTime` /
  `idleMax` watchdog); stdout/stderr are merged and written whole to `tmp/test.<n>.out` (one file, numbering
  continuing across sessions and runs). A nonzero exit code is never judged by the driver — judgment
  belongs to the AI.
- **Feedback**: via steer (at the next provider turn boundary) the driver injects the exit code, duration,
  timeout reason, and the script and output file paths into **the same session**; the AI reads the files
  directly to judge (no tool-output truncation; large files read in chunks). Rerunning the same test =
  writing the same script path into `tmp/test.sh` again (the script may be edited first). The loop repeats
  until the session writes no more markers and finishes naturally, returning to the main pipeline.

Every execution-session entry clears the pending marker left by the previous session/run (the archived
history is kept), preventing stale requests from polluting a new session; test scripts bypass the opencode
permission system (equivalent to the driver running tests locally itself; a convenience trade-off, not a
security boundary). init also propagates the convention: the test-execution principle section inside the
AGENTS.md opencode-auto marker block (appearing and disappearing with `testByDriver`) and a matching clause
in the agent contract.

### Test handover (--handover-test)

`--handover-test` (requires `--test-by-driver`, fixed into the config's `handoverTest` key by `init
--handover-test`) targets "repeated trial-and-error inside a bloated context".

**The handover moment = the instant the AI requests a test.** The criterion is a single condition: the
session's used context tokens have reached `contextLimit` ("test failed" is no longer layered on top). The
reason it pins on the test request is that it is the only naturally clean split point — a test request
usually means the related work is done and about to be verified; past that moment the context starts
changing again and no longer cuts well. Field audits measured the old two-condition criterion letting
sessions run to 2–4x the limit (64k/80k limits vs measured 72.7k–264.3k); the bigger the context, the bigger
the loss surface when a session dies unexpectedly.

On a hit, the driver does three things at that instant:

1. **The freeze commit (commit #1)** — pins the script and source under test. At this moment the session is
   idle, with no half-written files.
2. **Run the test concurrently** — without waiting for the session to finish (serializing would leave the
   session hanging until its cache expires).
3. **Dispatch the wrap-up + handover instruction** — the AI must finish and persist all remaining work that
   **does not depend on this test's result**, then write the parts **closely tied to this test or dependent
   on its result** into the test handover document and end the session.

After the session ends, the driver's **re-test guard** compares tracked non-document changes since the
freeze commit (`test/` scripts and source; the documentation surface and untracked additions do not count):
changes mean this test's result no longer matches the worktree, so `git stash -u` moves the wrap-up changes
aside, the same script is rerun against the frozen snapshot, then `stash pop` restores — not one wrap-up
result is lost, and "no source or script changes between the two commits" holds (a pop conflict is not
swallowed: the stash entry is kept, blocked halt). The handover document is then **archived** as
`testhandoff-<n>.md`, and **commit #2** records the handover. One handover, two commits — every handover
leaves a revertible record.

The document is named by execution scope: a subtask gets `docs/<task id>/S<two-digit number>/testhandoff.md`,
a whole-task session `docs/<task id>/testhandoff.md`; the handover applies to this execution scope only —
the next subtask cannot misread the previous subtask's leftover handover. A missing document is retried once
with feedback; still missing halts as an implicit block (with strict recovery on, one failure rolls the unit
back and redoes it). The archived and current copies are both cleared when the execution scope completes;
historical handover content lives in the git commit records. The driver then opens a new session (the
context is over the limit, so the session-reuse rules start fresh automatically) and continues the task with
a continuation note (read the handover document first, then interpret that test's result); tests still go
through the same protocol.

The wrap-up prompt deliberately **never mentions "context/limit"**: once a session knows its context is
tight, it decides on its own that the remainder is not enough and skips persist work it should have
finished (observed in the field); nor does it say "do not touch the source" — the AI already knows the code
under test should not move when it requests the test, and if it truly does, the freeze commit + re-test
guard backstop it.

Handovers have no hard cap; past 10 consecutive handovers the continuation note carries a reminder — first
assess whether this is a problem unsolvable right now, and if so skip past it marked
`AUTO-FIXME: <reason and plan>`, an autonomous AI decision. The handover document's name is separate from
`ondemand`'s `docs/<task id>/handoff.md`, so both mechanisms can coexist; when a task is not resumed by
recovery, the previous attempt's leftover handover documents (archived copies included) are cleared
(mirroring the ondemand semantics).

## Stuck-loop detection (repeated-action hints)

Weaker models often repeat the same action the same way several times without success — the same edit
failing with the same error over and over, the error byte-identical after parameter tweaks, the same file
read repeatedly with identical output — the context fills with the same failure and the model cannot get
out on its own. The driver observes every tool call's result while the session runs, and on recognizing
this pattern **actively steers a hint into the session** to help it break the loop.

Criteria (scoped to the session; consecutive not required — alternating retries are recognized too):

| Case | Criterion | Count |
|---|---|---|
| The same error keeps coming back | Same tool + same error text (**parameters ignored** — a parameter tweak is still the same trap) | 3 |
| Same arguments, same result, no progress | Same tool + same arguments + identical output (this call brought no new information) | 4 |

A different error or different output always counts as progress and is not counted. The hints escalate:
the first lays out the evidence (tool, arguments, error text) and asks to re-check premises and try a
different approach; the second asks to first write down "goal / what has been tried and where each attempt
failed / what to switch to next" before acting; the third asks to stop retrying, mark the leftover with
`AUTO-FIXME: <reason and plan>`, state the progress and end the session, letting the driver advance the
flow. At most three hints per session; a hit resets that action's counters (a fresh full round is needed
before hinting again).

Detection **only hints, never halts**: it aborts no session, changes no completion verdict, writes no
state file. However sound the criteria, they can misjudge (some tasks legitimately run the same command
repeatedly waiting for external state to change), so even the third level only hands the "wrap it up"
decision back to the AI.

Set `OPENCODE_AUTO_STUCK=off` to disable detection (default `on`); the `--dryrun` permission-preflight
session is never checked — it explores the permission boundary by being rejected repeatedly, and repeated
errors are its normal shape.

## Question policy and proxy-answer audit (AUTO-RESOLVE)

To keep the unattended pipeline running, it closes **decision points that should have been yours** on your
behalf. These decisions are a completely different animal from the engineering decisions the AI should make
itself, yet they used to share one `AUTO-DECISION` marker: a task recorded a dozen-plus entries and the two
or three that truly deserved eyes drowned in them. The two are now recorded and reported separately.

There is exactly one criterion — **whose call was this decision point supposed to be**:

| Call belongs to | Marker | Typical cases |
|---|---|---|
| **You (the user)** | `AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)` | Requirement-intent and scope trade-offs (do it or not, how far), changes to externally visible behavior and interface contracts, the bar for "what counts as done", fact-confirmation questions (data anomalies, missing environment, reality not matching docs), going beyond or narrowing the task description's literal scope |
| **AI** | `AUTO-DECISION: <decision> (<reason>)` | Choice of implementation means, where no option changes user-visible behavior (algorithm, internal structure, naming, file organization, injection approach, test style) |

One decision, one class; when unsure, mark `AUTO-RESOLVE` — one extra reminder is harmless, a missed one is
the real loss.

The driver collects from two channels: (1) sessions that actually asked and fell back to the proxy answer
(a human genuinely answering within `--wait-answer` **does not count** — that was your decision; the
`--dryrun` permission-preflight session does not count either); (2) an end-of-session scan of this run's
uncommitted changes for both marker lines. After pairing the two sources, `AUTO-RESOLVE` entries surface at
the top with `⚑` **before** the conclusion lines of the task, phase and round:

```
⚑ This task proxy-answered 3 questions that should have been yours to confirm — please review:
  1. Should the third copy of formatTokens in prompt.ts be closed out as well → close it out too (same-layer dependency, no reverse import)
     src/prompt.ts:501
  2. Should depreciation booking go through the same MAX_TICK clamp → same clamp (better under than over)
     src/stats.ts:84
  3. Does "what counts as done" include concurrent scenarios  ⚠ the session did not write the AUTO-RESOLVE marker as required
  Full record in the "Proxy-answered questions" section of docs/T-001/report.md
  Also recorded 5 AUTO-DECISION entries (collapsed, see the task report)
✓ T-001 done: 24m 31s elapsed (AI 18m 12s), 7 sessions
```

At task level they are listed item by item (past 8 only the first 8); phases and rounds get a one-line
count. `AUTO-DECISION` **never competes for the space**: with proxy answers present it folds into a number
on the last line, and with none it does not even reach the terminal (log file only). The wrap-up session is
also injected with the driver-observed proxy-answer list and required to give the task report a dedicated
"Proxy-answered questions" section — the persistent record therefore does not depend on AI diligence; the
marker lines in git and that section are the audit trail.

### The two question policies (`OPENCODE_AUTO_ASK`)

The duty to ask and the duty to mark **rise and fall together**, toggled by this one switch:

| Value | Question policy | Marking requirement | Completeness of the proxy-answer record |
|---|---|---|---|
| `off` (default) | Never ask non-permission questions; decide autonomously (byte-for-byte identical to before the change) | Both markers mandatory | Covers only the rare "session still asked" cases; the rest relies on session diligence, and **missed markers are undetectable** |
| `on` | Decision points that belong to you are **actively asked via the question tool** | No marking required | Questions are events flowing through the driver, so **observation is complete** |

**Use `on` if you want an auditable proxy-answer record** — the default's counts are incomplete; do not
treat them as exhaustive. The cost is one session round trip per question (tokens and wall time), and, with
more questions, a higher chance of hitting the "asking the same question repeatedly blocks the run" safety
net (that check is a normalized substring containment, scoped to the current turn).

A side effect: the question count is a **plan-completeness metric**. A complete plan → few questions → a
quiet run; dense questioning → a noisy highlight block → the plan has holes. Choosing the tier is your
explicit statement about your plan's quality; the program does not decide it for you.

The ledger lands in the target directory's `.auto/resolves.json` (gitignored, written exclusively by the
driver) and has nothing to do with recovery decisions: corruption or absence merely restarts counting from
now and never affects the run. Before a human rollback and rerun of the same task, `rm` it to zero the
count (same procedure as `.auto/stats.json`).

**Exception: `plan`'s sessions never proxy-answer.** plan runs for the pre-execution human review; every
non-permission question waits for a human answer (no timeout; `-i`'s resident input line or stdin) and
produces no AUTO-RESOLVE proxy answers or markers; an unreachable answer channel (closed input) or a
repeated question blocks for the human. `run`'s sessions (including planning sessions started by `run`)
keep the normal policy.

## Prompt templates and customization

Every session prompt is managed as a **file template** (copy separated from logic; prompt assembly lives in
the core package `@opencode-ai/auto-core`'s `src/prompt.ts`):

- Built-in templates live in the core package `@opencode-ai/auto-core`'s `templates/prompts/` (one file per
  session kind, shared partials centralized in its `_partials.md`), embedded into the standalone binary at
  compile time;
- A same-named file `.opencode/auto/prompts/<name>.md` in the target directory can **override** any built-in
  template (`_partials.md` merges shared partials by section name), no recompile needed.

The template syntax is deliberately minimal:

| Syntax | Meaning |
|---|---|
| `{{var}}` | Variable substitution (strings replaced directly; boolean/undefined render empty) |
| `{{#if x}}…{{/if}}` / `{{^x}}…{{/if}}` | Conditional block (truthy when x is a non-empty string or true) |
| `{{> partial name}}` | References the `## partial name` section of `_partials.md`; when it occupies a line of its own, the line's leading indent is applied to every line of the partial |

A block/partial tag on a line of its own swallows the whole line, so writing need not worry about blank
lines. Overriding a protocol-sensitive template (wrap-up, phase handover,
decompose, …) triggers a **key protocol content check**: missing a protocol line the driver's parsing
depends on (e.g. the wrap-up
template's `Result: PASS` / `Result: FAIL` result-line instructions) fails loading with exit code 1,
keeping custom templates from silently breaking the driver protocol.

## Mode layer (-m/--mode)

`-m/--mode <name>` (accepted by `init` only, written to the config's `mode` key; default `migrate`; an
explicit value must be a registered mode name, otherwise a usage error with exit code 1 and a message
listing the currently supported modes) is **prompt-level** scenario guidance; it does not change the
driver's scheduling state machine:

- The phase planning session gets the scenario prelude: scenario definition, task-arrangement principles
  and verification emphasis;
- Execution sessions (decompose / whole-task / subtask / wrap-up) get the matching notes.

Modes are file templates too: **adding a mode = dropping a mode file into the target directory, zero source
changes**. Built-in `templates/modes/migrate.md` (auto-core package; migration/upgrade scenario: tasks
arranged as "baseline confirmation → migration rework → regression verification" under the precondition
that external behavior stays unchanged, regression verification preferring existing test/build commands;
the execution
notes require old and new implementations to behave identically, compatibility layers to state their
purpose and removal timing, and migration trade-offs to be marked per `AUTO-DECISION`
requirements); the target directory's `.opencode/auto/modes/<name>.md` adds or overrides modes, file
format (rendered through the template engine before injection):

```markdown
# <mode name> (must match the file name; letters/digits/hyphens, starting with a lowercase letter)

## init
(planning prelude: scenario definition, task-arrangement principles, verification emphasis)

## exec
(execution notes)
```

Both sections are required; a missing or unknown section is a parse error. The three pre-retirement
sections `## final: audit` /
`## final: validate` / `## final: finalize` still load, content ignored.

The mode is fixed in the project config's `mode` key (`.opencode/auto/config.json`): `init -m <name>`
amends it explicitly (precedence: explicit value > existing config value > default `migrate`); `run` reads
and resolves it from the config and no longer accepts `-m` (appearing is a usage error). Additional
scenarios like `optimize` / `implement` / `test` are just files in the format above.

## Phased flow (--phases)

`--phases <admtvk subsequence containing m | phase type list>` (accepted by `init` / `amend`, written to
the config's `phases` key; default `"m"` = no phases declared, a single run, behavior identical to
pre-phases) splits a long migration-style flow into phases. The value takes two forms:

- **Preset letters**: a subsequence of the six builtin phases **a analysis → d design → m implementation
  (implement) → t test → v acceptance → k knowledge distillation (knowledge)**
  that contains `m` (`m`, `amt`, `admtvk` are valid; `tma`, `adk`, repeated letters and the empty string
  are invalid).
- **Phase type list**: comma-separated type ids (e.g. `analysis,security-review,implement`),
  any order, repeats allowed, must contain `implement`; in config.json a JSON array works too. Note that
  only the string `"m"` is a single run — the list `implement` is a phased flow with a planning session.

**Custom phase types**: define one type per file under `.opencode/auto/phases/<type>.md` (the file name is
the type id; it must not collide with a builtin type, a preset letter form, or a model-routing role word)
and reference it by id in the type list:

```markdown
# Security review

Gate: verdict
Reasoning: deep
Phase-artifacts: threat-model.md
Task-artifacts: review.md

## plan duties

Plan one review task per trust boundary.

## decompose duties

Split by attack surface.
```

The heading line is the display name; the field block is optional (`Tasks:` accepts only `yes` — custom
types always have tasks; the taskless
knowledge-distillation phase is builtin-only; `Gate:` takes `none` / `verdict`; `Reasoning:` takes
`deep` / `simple`, declaring the reasoning tier this type's
task sessions (whole-task, subtask) need, default `deep`, versioned with the type file; artifact paths are
relative to the phase/task directory);
`## plan duties` is required (the phase planning session's duties paragraph), `## decompose duties`
optional (the decompose session's). An invalid file is reported as a usage error naming the file.
`OPENCODE_AUTO_MODEL` can route a model by type id
(`security-review=prov/model`, precedence role > type id > preset letter > `*`;
under a model registry the value is an internal name — see
[Model registry and tiered routing](#model-registry-and-tiered-routing-model-registry));
an unknown type key is a usage error at run start.

- **brief.md**: the project brief `.opencode/auto/brief.md` (versioned, human-editable), consumed by
  every phase's planning session — it is project-level intent, and the tone set in the a phase is just as
  needed in the k phase. When the file is missing, `init`
  writes a **project brief stub** (four sections `## Goal` / `## Source` / `## Target`
  / `## Constraints`, each holding only HTML comment hints; an existing file is kept) for a person to fill
  in by direct editing; comments are stripped before injecting into the planning session, and an unfilled
  stub injects nothing. The section headings are scaffolding only — the driver
  does not parse them. `reset` deletes it only while it is byte-identical to the stub; once filled in it is
  kept. init starts no AI sessions and
  accepts no `-p` (intent is edited directly in that file; planning with input is `plan -p` — see
  [Planning tasks with AI](#planning-tasks-with-ai)).
- **Migration source and target**: project intent, written into brief.md (e.g. "migrate `legacy/pkg`
  into `app/`"), and picked up by the planning session when it reads the brief — no longer config
  (auto-core plans/0052
  D1–D3, 2026-09-23). The former `--source-dir` / `--source-path` / `--dest-dir` options and
  the config keys `source` / `destDir` are retired: the options are usage errors, and existing keys fail
  loading strictly with
  the original value named — copy the value into brief.md and delete the key; `fix` migrates it into the
  `## Source` / `## Target` sections
  and deletes the key (or a no-argument `init` full overwrite drops it). A large source tree can still
  enter the working directory via a symlink — just write the link path in the brief.
- **Round-private directory `docs/R-NN/`**: under the phased flow (`phases ≠ "m"`) every round is a
  self-contained round container (two zero-padded digits after R, e.g. `R-01`, carrying naturally),
  established at round start (`plan` establishes it: first round
  `R-01`, and `R-(N+1)` after the previous round completes and passes the round-close check); everything in
  it is **permanent once on disk** — never renamed, never repathed, never deleted:
  the phase index `phases.md`, one
  **phase directory** `P<nn>-<type>/` per phase (e.g. `P01-analysis/`, see below), and the prior knowledge
  `prior-kb.md`
  (the round-start AGENTS.md snapshot `AGENTS.md.bak` was retired on 2026-09-25 — AGENTS.md holds only the
  config-rendered marker block and needs no per-round copy; snapshots already present in old rounds are
  kept as-is).
  The phase directory gathers everything of the phase: state files `todo.md`/`done.md`, the handover
  document
  `handover.md`, the task index `tasks.md` (this phase's task list — see [Task unit format](#task-unit-format)),
  phase-level free-form artifacts, the type's standard artifacts (e.g. the knowledge phase's knowledge
  document `kb.md`) and the human-written acceptance
  record `acceptance.md`. The tasks themselves live in working-directory-level `docs/T-NNN/` (globally
  unique numbering).
  `phases = "m"` likewise establishes `docs/R-01/`, the implicit single phase `P01-implement/`.
  **Old layouts are incompatible** (auto-next refactor ruling): the lettered-phase layout (in-round
  `<letter>-<english name>/`
  archives, `handovers/`, `phase-docs/`, `- [done]` ledger lines) and the earlier flat layout (root
  `docs/phases.md` ledger, `docs/phases/`, `docs/handovers/`, `docs/migration-kb/`)
  do not advance under this version; open a new project to continue. The leftover flat-layout read
  fallback and old-layout
  detection errors land together with later cleanup.
- **Phase index (the round's `docs/R-NN/phases.md`) and phase directories**: at round start the index is
  written by expanding the `phases` preset
  letters (one line per phase, order and membership only) along with each phase directory (containing a
  `todo.md`).
  Phase state is **derived** — a phase is complete when its directory's `todo.md` has been renamed
  `done.md` by the driver (recorded with the handover commit), and the current phase is the first
  incomplete one in the index; the index ticks are a redundant view, files win:

  ```markdown
  # Phases (R-01)

  - [x] P01 analysis
  - [ ] P02 implement
  - [ ] P03 test
  ```

- **Prefix guardrail (read-only)**: while the current round is incomplete and completed phases exist, a
  new `--phases` value for `init` / `amend` must have the completed phases (in index order) as a prefix,
  otherwise an error (exit code 1) — keeping
  the flow state derivable; once the current round is complete the guardrail lifts and the new value
  applies to the next round `plan` establishes.
  A compatible new value no longer rewrites the index on the spot: the difference between index and new
  value is left as **drift** for `plan` to re-sync (rewriting
  the not-yet-started tail of phase directories; `run` exits 1 on drift and points at `plan`). An
  unparseable index line, an
  unknown or duplicated type, or a phase directory with both or neither of `todo.md`/`done.md` is likewise
  an environment error
  (exit code 1).
- **Manual rollback**: rolling back to a phase = (1) rename `done.md` back to `todo.md` in that phase's
  and every later phase directory (untick the index lines while at it, or leave that to the driver);
  (2) to resume one of the phase's tasks, rename its `docs/T-NNN/done.md` back to `todo.md`; (3) rerun
  `run`. Derived state means rollback needs no dedicated code.
- The `v` (acceptance) phase carries the completion-side checking: v-phase tasks only verify and record,
  never repair; gaps found are reported through the task report's result line — `Result: FAIL` blocks and
  stops the run, with a person planning the repairs
  (see [Acceptance result line](#acceptance-result-line-result-passfail)).
- **Phase loop (`run`)**: with `phases ≠ "m"` configured, `run` advances through "plan → execute → hand
  over" until
  every phase is complete; all progress is derived from phase index/phase directories + task index/task
  directories (runtime state lives only in
  `.auto/units.json`):
  - **Planning**: when the current phase has no task index `tasks.md` yet (or the index is empty), a
    **phase planning session**
    writes the phase's tasks as the phase directory's `tasks.md` and each `docs/T-NNN/todo.md` (format in
    [Task unit format](#task-unit-format)). The driver shape-checks every document (field block,
    `## Goal`/`## Scope`/
    `## Acceptance`, trailing eof marker, `Phase:` equal to this phase's id, numbers not colliding with
    other phases or completed tasks
    ); a failure is retried once with feedback, the phase's previous output cleared before the retry. The
    session consumes `brief.md`
    (including the migration source and target), the round brief, the mode prelude and **every preceding
    phase's handover document** (the distilled handover is the only cross-phase
    memory channel; the preceding phases' raw `docs/` are not injected; a phase without a handover is
    flagged
    "(no handover document)" in the list); a blocked planning session exits 2 (rerun after human handling).
  - **Execution**: with unfinished tasks the existing main loop runs; task-level semantics
    (decompose/wrap-up/result line/unified commit/
    breakpoint recovery) are identical to a single run.
  - **The k (knowledge distillation) phase is the exception**: the k phase opens no planning session and
    lists no tasks —
    the plan route goes straight into the **knowledge-extraction bypass session** (wholesale adoption of
    the former `--extract-knowledge`
    design, see the revision note at the head of
    `packages/auto-core/plans/0002-fixme-knowledge-design.md`), reads the phase index and every
    phase directory's handover documents, and distills the finally verified migration experience into the
    type's standard
    artifact `docs/R-NN/P<nn>-knowledge/kb.md` in that phase directory (permanent once on disk; section
    skeleton: migration overview / API and type mapping / implementation patterns / pitfalls and edge
    cases / reusable rules / design
    deviations and major decisions / verification evidence / references).
    **Extraction failure does not pollute the exit code**: a blocked session or two failures to produce
    output only logs a ⚠ warning, and the k phase hands over as usual
    (a successful migration is not polluted in reverse by a documentation failure; retry = rename the
    phase's `done.md` back to
    `todo.md`, delete its `kb.md`, rerun); interrupted before the handover, a rerun skips already-produced
    documents idempotently. The knowledge document enters the repository with the unified commit. When a
    person lists tasks in the
    k phase's own `tasks.md`, the generic execute/handover routes run instead and the extraction hook
    never triggers.
  - **Handover**: once the phase's tasks are all done, a **handover distillation session** opens first (a
    one-shot bypass session reading the phase's
    task index and `docs/` artifacts and distilling the `handover.md` handover document in the phase
    directory, with the
    four required sections: key decisions / constraints and pitfalls / required reading for the next
    phase / artifact index; a missing artifact is
    retried once with feedback, still failing as an implicit block with exit code 2), then the driver
    closes out mechanically — the phase's `todo.md`
    is renamed `done.md` and the index line ticked (the task index stays in the phase directory verbatim,
    no snapshot, no reset), the whole recorded as one unified commit
    (`Auto-Stage: phase-transition`). The phase's `docs/` artifact documents
    (`docs/T-*/` etc.) are permanent paths; the handover never moves them. Every step is idempotent —
    after a power cut/Ctrl+C mid-handover, a
    rerun completes it by itself (including catching up the completion rename).
  - Every phase in the index complete → exit code 0 (`✓ all phases complete`).
- **Phase progress line**: the `run` startup banner prints one progress line after the config summary
  (`status` instead prints the full
  phase/task/subtask tree): `✓` = completed, `▶` = current phase, the rest = not started; in a continuing
  round (largest `docs/R-NN` number
  \> 1) it carries a round annotation:

  ```text
  phases: P01-analysis✓ P02-design✓ P03-implement▶ P04-test
  phases (round 2): P01-analysis▶ P02-implement
  ```

- **Auto numbering (on by default, disabled by `init --no-auto-number`)**: disabled, the phase planning
  session is no longer given a starting number, but task directories `docs/T-NNN/` stay globally unique
  and the driver still rejects numbers colliding with other phases or completed tasks. Enabled,
  task numbers **never repeat** in the target directory: the next available number is persisted in
  `.auto/next-task` (content: a single
  positive integer, maintained by the driver; `.auto/` is gitignored, so fresh clones lack it naturally),
  the phase planning session
  continues numbering from that record, and the driver validates that output reuses no occupied number (a
  reuse is invalid output — retried once
  with feedback, still failing as an implicit block with exit code 2); after successful planning the
  record advances to this run's largest number + 1 (grows only).
  **When the record is missing it is recovered first**: with no number evidence anywhere in existing
  files (each phase's task index `tasks.md`,
  task directories `docs/T-NNN/` and other artifact file names — a brand-new project), 1 is written
  directly; otherwise a one-shot bypass
  **numbering recovery session** reads the archives and git commit history to derive the next number (git
  history can discover numbers whose artifacts were
  deleted), and the driver validates its write against the lower bound of a deterministic scan (below the
  bound is invalid — retried once with feedback, still failing as an
  implicit block with exit code 2).

- **Opening the next round (`plan`)**: once a round's phases are all complete (`run` exit code `0`),
  fill in
  `docs/R-NN/round.md`'s `## Close` section (listing which decisions have been restated into the target's
  own documents and which
  losses are accepted) and commit, then run `plan`: it first runs the round-close check (whole-tree P1
  scan, target build,
  `## Close` checklist; failing → itemized listing, exit code `2`, and `plan` refuses to open the next
  round); passing, it establishes
  `docs/R-(N+1)/` — the phase index and phase directories expand from the configured `phases`, stopping at
  the round-start gate for review and commit;
  every step is idempotent, and rerunning `plan` after an interruption finishes naturally. The new round's
  goal is to fill the previous round's gaps and close residual
  differences, not to redo finished work; the previous round's directory stays as-is (permanent once on
  disk). Change config across rounds with
  `amend` (the prefix guardrail lifts once the current round is complete, the new value applying to the
  round `plan` establishes next). The new
  round's first phase planning session gets an excerpt of the previous round's conclusions (the round's
  phase directory index + the last completed phase's handover document
  in full + the migration knowledge document in full); later phases use this round's handover distillation
  chain as usual. Rolling back a new round = delete
  the new round directory `docs/R-(N+1)/` and rerun `run`, restoring the previous round's completed state.
  The `continue` subcommand is
  retired (appearing gets a message pointing at `plan`); `--continue` is not an option of any command
  (appearing errors with guidance).
- **Round derivation**: the current round = the largest `R-NN` round directory number under `docs/`
  (established at round start, no +1),
  zero new persisted state; `run`'s phase progress line carries the round annotation (above), and
  `status`'s tree starts with `R-NN`.

> The phased flow's P1..P4 are all wired in: from P3 the handover document is produced by the distillation
> session and injected into the next phase's
> planning session; from P4 the k (knowledge distillation) phase wholly adopts the former
> `--extract-knowledge` design (the knowledge-extraction session produces `kb.md` in the knowledge phase
> directory, failures not polluting the
> exit code). `--track-fixme` still evolves independently
> (`packages/auto-core/plans/0002-fixme-knowledge-design.md`), unimplemented.

## The AGENTS.md marker block

`init` / `amend` / `fix` / `run` idempotently sync a single opencode-auto marker block in the target
directory's AGENTS.md
(from `<!-- opencode-auto:start -->` to `<!-- opencode-auto:end -->`, content in English):
it is rendered from the current config and compared with the file's existing standard block — identical:
untouched; different: replaced wholesale; missing:
appended; any other `opencode-auto:<name>:start/end` marker blocks in the file (the old six-block format,
or
stray marker blocks) are always cleaned up, and AGENTS.md is never rewritten otherwise. The block contains
these sections:

| Section | Content |
| --- | --- |
| Pointer | Prompts inline the current task; re-read `docs/T-NNN/todo.md` and `subtasks.md` when the context is compacted or progress is uncertain; AGENTS.md keeps no notes |
| Test principle | Compile/test/build/lint commands are executed by the driver outside the session (present only with `testByDriver: true`) |
| Commit principle | The driver recursively runs the unified commit after sessions; sessions never run git commits |
| Summary principle | No end-of-session summaries in non-interactive scenarios; output always goes into docs/ |
| Reference and storage conventions | stable-refs: `docs/T-NNN/` directory-style permanent paths, root-relative reference syntax; the DRIVER neither checks nor rewrites references — confirming a path exists and keeping the references a task touches valid is the session's own work |

The commit principle, summary principle and reference conventions describe **configuration-independent
invariants** and appear unconditionally; the test
principle corresponds to the test execution protocol and appears or disappears with the `testByDriver`
switch — when the mechanism is absent, the block keeps no
description of it. The effective config is printed by the run startup banner and `status`.

**AGENTS.md carries only this marker block** (plus whatever a person writes outside it): sessions do not
maintain it — the former
maintenance-rules section, the `docs/agents/<topic>.md` routing convention and the 150-line cap were
retired on 2026-09-25
(auto-core plans/0054). Reason: `init` lists AGENTS.md in `.gitignore` (local only), so session edits to it
enter neither the unified commit nor the unit rollback — invisible to both the completion condition and
the audit trail; knowledge worth keeping
goes into `docs/` documents that are committed with the work (phase handovers, the knowledge phase's
`kb.md`, …). During
`run` AGENTS.md is read-only, and the agent contract (`.opencode/agent/auto.md`) equally forbids sessions
from changing it. `fix` lists a missing or stale marker block (or a lingering legacy one) among its
findings (`fix --dryrun` prints them without writing).

## Task unit format

Tasks are registered per phase in the phase directory's task index, one directory per task. `phases = "m"`
(the default) means the implicit single phase `docs/R-01/P01-implement/`:

```md
<!-- docs/R-01/P01-implement/tasks.md (task index: order and membership only) -->
# Tasks

- [ ] T-001 Task title
- [ ] T-002 Another task
```

```md
<!-- docs/T-001/todo.md (task body) -->
# T-001: Task title
Phase: R-01.P01

## Goal

The goal.

## Scope

Scope and key constraints.

## Acceptance

Completion criteria.
```

- Index lines take the form `- [ ] T-<number> <title>` and execute in line order; the driver takes the
  first unfinished task whose dependencies are satisfied.
  **Files are the source of truth for progress**: the task directory holds exactly one of `todo.md`
  (unfinished) or `done.md` (complete);
  when the driver completes a task it renames `todo.md` to `done.md` and ticks the index line — the tick is
  a redundant view, and having neither or both is an environment error (`run` exits 1 with amend guidance).
- The task body consists of a heading line, the immediately following field block (`Phase:`, optional
  `Depends:` / `Touches:`) and
  the three sections `## Goal` / `## Scope` / `## Acceptance`; task documents produced by the planning
  session are shape-checked against this, and hand-written ones should follow it too. Do not write subtask
  checklist items by hand — under `subtask: true` the decompose session will write
  `docs/T-NNN/subtasks.md`, and subtask progress likewise follows `docs/T-NNN/S<nn>/todo.md|done.md`.
- The dependency field is isomorphic across the three levels: a task's sits after the `Phase:` line, a
  phase's after the `Type:` line in the phase directory's `todo.md`, a subtask's at the head of
  `S<nn>/todo.md` (checklist line n is `S<nn>`). `Depends: T-011, T-012`
  = start only after the listed units complete (same-level numbers only: a task may reference tasks of its
  own phase or completed tasks, a phase only
  phases of its own round, a subtask only subtasks of its own task); the default = depend on the previous
  entry in the index (i.e. serial),
  `Depends: none` = no prerequisite. `Touches:` lists the repository-relative paths that will change (no
  absolute paths, no `..`); the default = may touch anything — currently checked only, not used in
  scheduling. Empty values, self-dependencies, unknown numbers and cycles
  are bounced back for rewriting at the planning/decompose close-out, and are environment errors when
  `run` loads the index (tasks and phases exit 1;
  subtasks block with exit 2).
- Runtime state (`in_progress` / `blocked`, attempt counts, fork base) lives only in `.auto/units.json`,
  never in a document; index ticks and the `todo.md` → `done.md` rename are maintained by the driver
  alone — agent sessions must not change them. `opencode-auto status [dir]` prints the read-only round →
  phase → task
  → subtask tree.
- Acceptance criteria go into `## Acceptance` (or are planned as dedicated acceptance tasks, or the v
  phase); the verdict is reported through the task report's
  result line — see [Acceptance result line](#acceptance-result-line-result-passfail).

### Planning tasks with AI

The `init --implement-file` / `--implement-prompt` shortcuts are retired (auto-core plans/0053 D13):
either option on any command is a usage error (exit code 1), with the message pointing at
`opencode-auto plan <dir> -p <text> | --file <path>` (run `plan` first to establish the round and commit
the round-start setup;
see [Planning and the round lifecycle (plan)](#planning-and-the-round-lifecycle-plan)).
`init` starts no AI sessions and no longer defaults `subtask` to `ondemand` or `wrapup` to off because of
these options.

Planning under `phases = "m"` shares the same phase planning session with the phased flow (auto-core
plans/0053 D12):

- The input is stored verbatim as the phase directory's `plan-input.md`
  (`docs/R-01/P01-implement/plan-input.md`),
  committed on its own before the planning session; the planning session reads it as the "plan file",
  writes the task index and each `docs/T-NNN/todo.md`, and commits with the unified commit on completion
  (`Auto-Stage: phase-plan`).
- Model routing keeps the `implement-scan` role; existing routing config needs no change.
- Numbering: with `autoNumber` on, continue from `.auto/next-task` and advance after planning; off, start
  after the largest occupied number.
- When the planning session is interrupted, the next `run` (or `plan`) finishes this step first, then
  executes tasks; like the phased
  flow's planning step, it reuses the unclosed session.

## Model registry overview (models)

`opencode-auto models [dir]` read-only prints the **model registry**'s effective table; it starts no
agent and writes no file, so it takes no run lock and can run alongside a live `run`. The registry merges
two layers: the operator layer
(`$OPENCODE_AUTO_MODELS`, or `$XDG_CONFIG_HOME/opencode-auto/models.json` when unset,
`XDG_CONFIG_HOME` defaulting to `~/.config`) and the optional project layer `.opencode/auto/models.json`
(local-only;
`init` writes it into `.gitignore`, older projects get it backfilled by `fix`). Neither layer present means
no registry, and run behavior is byte-identical to before.
This section covers only the command's output:

- **Sources and environment**: the layers read, the window timezone and current time, the agent filter
  (the shell profile's agent, else
  `OPENCODE_AUTO_AGENT`; matched by profile adapter), the project context limit (config `contextLimit`)
  and the default agent (config `agent`); when `OPENCODE_AUTO_MODEL` is set, an extra line marks whose
  candidates it overrides.
- **agent profiles**: each profile's source layer (`[operator]` / `[project]` / `[implied]`), adapter,
  `bin`, `server` (userinfo stripped from the URL) and the `env` **variable names** — literals are only
  marked `(literal)`, references only named
  (`(env CLAUDE_B_PROXY)`), `null` marked `(removed)`; **no value is ever printed**.
- **model entries**: source layer, agent, steps (`model` followed by the `wider` ids), `variant`,
  `context`, window,
  and the provider's key ring; the next line gives **availability right now and why** — outside the window
  (with the next opening time),
  excluded by the agent filter, or a known context window below the project limit; an unknown context
  window (opencode reports it only after the server
  starts, claude after the first turn) is only a note, not judged unavailable.
- **key rings**: one line per provider, listing the reference names and count in order, plus the models
  sharing it.
- **tiers / routes / classifier**: the two tier lists, route overrides and the failure-message classifier
  model list, each with its source layer; models referenced by no
  tier, route list or classifier are flagged separately as unused.
- **routing table**: under each phase type (builtin and project-custom), session roles resolving
  identically share one line:
  the tier (default tier, or a `route <key>` override, precedence role > type id > preset letter) and the
  ordered candidates, `✓`/`✗` marking
  availability right now; a simple tier continues after `|` with the deep list it borrows (a deep tier
  never borrows simple).

Exit codes: no registry prints one line, exit code `0`; a registry `run` would accept prints the full
table, exit code `0`;
problems `run`/`plan` would refuse at startup (bad JSON, unknown fields, bad windows, a referenced
environment variable unset or file unreadable,
a git-unignored project layer, …) print item by item with `⚠`, exit code `1` — when the registry loads,
the full table prints first and the problems follow.
`models` takes no run lock and accepts no option besides `--probe` (same group as `status`).
`--probe` **starts agents** (lazily bringing up each profile's host via the agent pool) and sends one very
short recovery-probe prompt (the same one the wait-and-probe loop uses) to every model referenced by a
tier,
route list or classifier, printing one reply-or-failure line per model — which is why it is optional:
probing costs real tokens. A failed probe is a per-model
finding, not a command error; the exit code still follows the registry itself.

## Blocking and recovery

When a task blocks (exit code `2`), the driver writes the problem into that task's `question` field and
halts:

- **Permission problems**: handled per the `--permission` policy (default `ask-deny`) — `auto-allow`
  auto-grants immediately;
  `ask-allow` / `ask-deny` / `ask-fail` first wait for a human instruction (`--wait-answer`
  minutes; unset means no wait; answering `allow`/`yes`/`y` etc. grants, any other explicit answer denies
  that permission but
  the session continues); on timeout they respectively auto-grant / auto-deny and continue (the AI gets no
  grant to go around) / deny and block-halt
  (in that case, per the hint, allow it in the target directory's `opencode.json` `permission` rules and
  rerun);
- **Other problems**: handle them outside the session (or fill the answer into the `answer` field), then
  rerun
  `opencode-auto run` to resume from the block.

<!-- auto: eof -->
