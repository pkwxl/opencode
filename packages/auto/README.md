# opencode-auto

The CLI shell of the auto tool family (bin `opencode-auto`). It initializes and maintains a
driver-governed project — the config layer `.opencode/auto/config.json` (constitutional project options:
the agent contract, context budget, scenario mode — versioned, shared with the repository, human-editable),
the agent contract, the AGENTS.md block, intent packs and bundles, the model registry — and carries the
person's local tooling: `close`, `land`, `fork`/`remove-fork`, `fix`, `sync`, `release`, `reset`, `status`,
`models`, `install-prompts`, `driver-helper`.

**The protocol does nothing via push (plans/0283)**: this binary no longer drives sessions. A phase's
tasks, the planning, the distillation and the construction are **grants external coding agents claim over
the executor protocol** (a daemon's `POST /projects/<project>/executor/claim`; `opencode-auto-server serve`
registers the project), and the person's acts — the boundary advance, the release, the task add — are the
daemon's **operations** (`POST /projects/<project>/transfer` / `clarify` / `plan` / `tasks` / `reconcile` over REST with
a token — `reconcile` the executor ledger's dead-letter reconciliation, plans/0287). The work itself is unchanged in shape: task units (the phase's task index `tasks.md` +
`docs/T-NNN/`), whole-task sessions under the standing handover protocol (`subtask: off` the default,
`auto` adaptive decomposition), the unified commit after every session, planned checking and acceptance —
when the result line at the end of a task report says `Result: FAIL` the task blocks for a person (see
[Acceptance result line](#acceptance-result-line-result-passfail)) — and precise interruption recovery from
the progress record. The references for the daemon and the protocol: the `../auto-server` package's
[README](../auto-server/README.md) and [docs/daemon.md](../auto-server/docs/daemon.md) (register, serve,
tokens, every operation), and the core's
[docs/protocol.md](../auto-core/docs/protocol.md) (the executor protocol's standing specification — grants,
lease tiers, the wire vocabulary).

## The push commands are retired (plans/0283)

`run`, `plan`, `transfer` and `clarify` — and the hidden `_lane` lane-worker entry — are **permanent
tombstones** of this binary: every invocation answers its one-line retirement notice with exit code 1,
ahead of every flag, directory and lock semantics (a retired command has no flags left to honor).

| Retired command | Where the work lives now |
| --- | --- |
| `run` | a phase's tasks are **execute grants** external coding agents claim over the executor protocol — a daemon's `POST /projects/<project>/executor/claim` (`opencode-auto-server serve` registers the project) |
| `plan` | the no-agent planning routes are the daemon's **plan operation** (`POST /projects/<project>/plan`), the planning session the **formulate grant**'s over the executor protocol, and one task at a time the **task-add operation**'s (`POST /projects/<project>/tasks`) |
| `transfer` | the person-bracketed advance is the daemon's **transfer operation** (`POST /projects/<project>/transfer`) — a deterministic apply (git and document writes only); the distillation and the construction are the **distill/synthesize grants**' over the executor protocol |
| `clarify` | the person's release act is the daemon's **clarify operation** (`POST /projects/<project>/clarify`) — or the document edit itself (the whole-line `Clarified: yes`) plus its commit |
| `_lane` (hidden) | the push lane workers are demolished — concurrency rides the executor protocol's **scoped/doc lease tiers** (external workers claim grants in their own worktrees) |

Retired with them: the task-append session (`plan --append`), the repair budget (`run --repair`) and the
charter verifier — FAIL verdicts surface as state, the fix grant repairs verify FAILs, and appends ride
task-add and re-formulation. Their flags keep their owned refusals on every live command (`--append`,
`--force-close`, `--scaffold`, `--new-task`, `--export`/`--adopt`, `--round`/`--phase`, `--resynthesize`,
`-p`/`--file`), each pointing at the daemon surface or document channel that replaced it.

## Building a standalone executable

```sh
cd packages/auto
bun run build            # produces dist/opencode-auto (native platform)
bun run build -- --target bun-windows-x64   # cross-compile; the artifact gets a platform suffix
```

The artifact is a single self-contained file (templates and SDK embedded) — copy it to any machine and run.
The daemon (`opencode-auto-server`, its own package) requires the `opencode` CLI on the target machine: the
runs it hosts automatically start and manage an `opencode serve` instance, or point at an existing server
address to reuse an external instance (see
[opencode server and agent selection](#opencode-server-and-agent-selection)).

You can also skip the build and run the sources directly with Bun:

```sh
bun run packages/auto/src/index.ts <subcommand> ...
```

## Usage

```sh
opencode-auto init [dir]     # initialize the project config layer: fix the project config into .opencode/auto/config.json, generate opencode.json and the .opencode/agent/auto.md template, idempotently sync the single opencode-auto marker block in AGENTS.md, and write the driver workdir (tmp/, .auto/), the local-only files (/.env, /AGENTS.md, the model registry project layer /.opencode/auto/models.json) and every nested git repository in the tree into .gitignore — the .gitignore itself and opencode.json are committed project surfaces (plans/0138: the ignore set and the host posture reach every fresh clone; AGENTS.md stays local, re-derived from the committed config at every run start); writes nothing under docs/ — round directories are established by the daemon's transfer operation (its plan operation in m mode) — and no project brief: the assisted project analysis the first transfer operation opens proposes and installs it (`--brief`/`--brief-file` are retired on init). In a directory inside no git work tree it first initializes the repository itself (branch: the configured init.defaultBranch when set, else main, printed loudly) and checks a commit identity resolves — see the [init prerequisite](#project-configuration-opencodeautoconfigjson)
opencode-auto amend [dir] --<key-option> <value> ... [--brief <text> | --brief-file <path>]   # rewrite only the given config keys, keep the rest (at least one key, or a brief revision; refused without a config), see "Amending (amend)"
opencode-auto fix [dir] [-f] [--dryrun]  # repair the config layer by rule: delete/rename/migrate retired keys into brief.md, align the contract, the AGENTS.md block and .gitignore with the config; --dryrun lists the findings read-only and writes nothing (exit 0 when there are none or only informational notes, 1 when there are findings), see "Config fix (fix)"
opencode-auto sync [dir] [-f] [--dryrun] [--from-bundle]  # upgrade a materialized intent bundle to the running binary's: unedited managed files (the pack, the mode, the phase files, digests recorded in .opencode/auto/provenance.json) fast-forward byte-identically, person-edited files/extras are reported never written or deleted, an unstamped legacy project bootstraps (byte-identical files adopted into a fresh stamp, differing ones report-only unless --from-bundle), never touching config.json and never committing — the diff is yours to review; --dryrun plans and prints only (exit 0 when nothing would change, 1 when something would), see "Bundle sync (sync)"
opencode-auto release [dir]   # the release gate for a destination repository (a nested git repository): the containment findings the working rounds record but deliberately defer — task-id mentions, paths leading outside the repository's own root, process-document paths — block here beside a clean-tree check (an uncommitted state is not a release); a gate, not a scrubber — removal is content work you do with your agent, and the re-run certifies with one ✓ line per destination naming its HEAD, see "The release gate (release)"
opencode-auto close <ref> [dir] --reason <text> [--cascade] [--commit-changes | --stash-changes]   # close a unit (task T-NNN, phase R-NN.P<nn>, round R-NN) without delivering it — done for scheduling, the reason in a Closed: field, the close commit, undo = git revert, see "Closing units (close)"
opencode-auto land [dir] [--keep] [--abandon] [--merge] [--onto <branch>]   # the person-invoked return path of branch isolation (config isolate): land each designated nested repository's round of work — its auto/R-NN branch — back onto its original branch as one commit, delete the round branch, print the landed SHA; see "Branch isolation and landing (isolate, land)"
opencode-auto fork <T-NNN | sha> <worktree-path> [dir]   # build an experiment environment in a new worktree — at the state before a task first started (T-NNN, the parent of its oldest Auto-Task commit of the current corpus; a number re-issued after a restart never forks before the restart, plans/0140) or at an exact commit — to retry it in isolation; nested repositories reconstructed alongside, aligned at the recorded state; the main tree, its branches and its history never touched; takes no run lock, runs beside a live run, see "The retry fork (fork, remove-fork)"
opencode-auto remove-fork <worktree-path> [dir] [--force]   # tear down a fork: every worktree of the fork removed and its auto-fork/* branch deleted per repository (uncommitted work blocks naming the files — `--force` discards it explicitly), freeing the path and the branch name to fork again; the tips stay recoverable via git reflog; see "The retry fork (fork, remove-fork)"
opencode-auto reset [dir]    # de-initialize: remove exactly the config-layer artifacts init wrote (the project brief .opencode/auto/brief.md is kept — an installed approved proposal or a person's `amend --brief` write — and so is a materialized intent bundle's landed files, the pack/mode/phase files and provenance.json: person-owned once landed; delete them by hand if you mean to)
opencode-auto status [dir]   # print the project config summary and the read-only round → phase → task → subtask tree
opencode-auto models [dir] [--probe]   # print the model registry's effective table (tier, candidates and current availability per phase type × session role); --probe additionally sends a short recovery-probe prompt to every listed model (optional, costs tokens), see "Model registry overview (models)"
opencode-auto install-prompts [dir]   # resync the manual prompt suite (the executor protocol's manual floor, executor.md) into the target's prompts/ byte-identically — differing files rewritten, extras reported never deleted, prompts/MANIFEST written pinning the vintage; --check is the read-only drift gate; requires an initialized project, takes no run lock, runs no git (you review and commit), see "Manual prompt suite (install-prompts)"
opencode-auto driver-helper [dir]   # render the person-proxy brief (plans/0105): the six-block context — role pin (never the driver; prompts/ is reference material), the driver's working model, the live state plus the stop's own lines, the person-owned channels open right now, the assist policy, the exact recovery commands — to paste into the coding-agent session acting with your pen at a boundary run cannot cross; read-only, stdout, nothing written, no run lock (a live lock is reported, never refused on), see "The person-proxy brief (driver-helper)"
```

Retired commands (plans/0283, each answered by its one-line notice with exit 1): `run` — a phase's tasks are
execute grants external coding agents claim over the executor protocol (a daemon's
`POST /projects/<project>/executor/claim`; `opencode-auto-server serve` registers the project); `plan` — the
no-agent planning routes are the daemon's plan operation (`POST /projects/<project>/plan`), the planning
session the formulate grant's over the executor protocol, and one task at a time the task-add operation's
(`POST /projects/<project>/tasks`); `transfer` — the person-bracketed advance is the daemon's transfer
operation (`POST /projects/<project>/transfer`) — a deterministic apply (git and document writes only), the
distillation and the construction the distill/synthesize grants'; `clarify` — the person's release act is the
daemon's clarify operation (`POST /projects/<project>/clarify`) — or the document edit itself (the whole-line
`Clarified: yes`) plus its commit; the hidden `_lane` lane worker — concurrency rides the executor protocol's
scoped/doc lease tiers.

Run `opencode-auto --help` for the full usage text (stdout, exit 0; the bare `opencode-auto` prints the same
text to stderr with exit 1), and `opencode-auto <command> --help` (or `-h`) for one command's synopsis,
summary and options. An unknown command is refused with a one-line error naming the closest live commands
(`opencode-auto: 'clos' is not a command (did you mean 'close'?)`), never the full text — a retired name
never suggests, its notice is its one answer; an unknown option points at its command's `--help` view.

New-project flow, phased, over the daemon (`init` → register and `serve` → the transfer operation → fill in
and release → transfer again → claim the grants → transfer at each boundary):

```sh
opencode-auto init <dir> --phases "admtvk"   # 1. fix the project config (init writes only the config layer, no round directories)
opencode-auto-server register <dir>           # 2. whitelist the project with a daemon (absolute path); `opencode-auto-server serve`
#                                              hosts it — issue a token (`opencode-auto-server token issue --scopes …`), then talk REST.
POST /projects/<project>/transfer             # 3. open docs/analysis.md (the assisted first-run step) — or, with OPENCODE_AUTO_ANALYSIS=off, establish docs/R-01/ and stop at the round-start gate
# 4. with your agent fill docs/analysis.md (analysis, goals, brief proposal, roadmap — and optionally each round's `### R-NN` brief under ## Round briefs), then release it: POST /projects/<project>/clarify writes the `Clarified: yes` line and commits it (or add the line and commit by hand)
POST /projects/<project>/transfer             # 5. install the approved brief, establish docs/R-01/ under the roadmap's line; a released `### R-01` brief installs verbatim and the same invocation constructs the formulation todo and stops at the review seam — otherwise stop at the round-start gate, by hand: fill in docs/R-01/round.md (goals/acceptance/release criteria), commit
# 6. pull the work: an executor worker claims over the protocol — POST /projects/<project>/executor/claim with an executor-scoped token — the synthesize grant first when a charter declares one, then the formulate grant (the planning session writes the phase's tasks), then the planned tasks' execute/verify/fix shares (a different token performing the verification)
POST /projects/<project>/transfer             # 7. at the phase boundary: the distill grant produces the handover, then the transfer operation applies — the completion, the transition, the next phase's floor; the round closes through the same op (fill ## Close of docs/R-NN/round.md first), the next round opens through it too
```

Every call returns in seconds — the daemon spawns no agent session itself (the protocol does nothing via
push): the grants are pulled by executor workers, the operations are deterministic applies. Watch from
anywhere: `GET /projects/<project>/status` (the status read model), `GET /projects/<project>/status-events`
(the typed event stream), `GET /projects/<project>/log`. The daemon package's
[README](../auto-server/README.md) walks the same loop in full; its
[docs/daemon.md](../auto-server/docs/daemon.md) documents every route, and the core's
[docs/protocol.md](../auto-core/docs/protocol.md) is the executor protocol's standing specification.

The `m` mode (the default single-phase compatibility floor) drives the same way — the daemon's plan
operation establishes the implicit single phase `R-01/P01-implement` and stops at the round-start gate,
`POST /projects/<project>/tasks` adds one task at a time (or list tasks by hand in `tasks.md`), and the
grants execute them. `init`'s `-p` (init takes no prompt and writes no brief — the analysis flow owns the
start) and `--amend` (use the `amend` subcommand instead) are retired; the `continue` subcommand is retired
too (every boundary crossing is the daemon's transfer operation — opening the next round included), and so
is the `check` subcommand (the principle scan and the reference check were removed; `fix --dryrun` lists
the configuration findings).

### Working with an intent bundle (`--intent cleanroom` / `faithful` / `faithful-lean`)

The three shipped bundles are whole workflows — an intent pack (quality bars, phase duties,
governance), a scenario mode and custom phase types — that `init --intent <name>` materializes into
the ordinary `.opencode/auto/` surfaces, stamping `phases` and `mode` from the manifest (explicit
flags win). The steps of the phased flow above do not change; the intent changes what lives inside
them, and where you come in. `cleanroom` — the two-room clean room, `survey,spec-read,design,
implement,test,audit` — in full:

```sh
opencode-auto init <dir> --intent cleanroom   # materializes the bundle; then your declarations (below)
#                                              the analysis flow exactly as steps 2–5 above (the clarify
#                                              operation releases it; the approved `## Project brief` proposal
#                                              installs the brief; R-01 opens under the roadmap's line,
#                                              `survey` leading its phases)
# P01-survey: the claimed grants' sessions size the reference and record only
#   the genuinely open decisions; the round stops at the phase's held `Gate: human` naming the release
POST /projects/<p>/clarify                    # your review: the operation prints every `Fork:` line with its
#                                              `Recommend:` default, then writes the release (or answer the
#                                              forks in survey.md by hand); the release also installs the
#                                              completed project brief
POST /projects/<p>/transfer                   # past the survey; constructs P02-spec-read's floor for review
# P02-spec-read: the claimed grants' specification room reads the reference through
#   the door and distills behavior-only notes
POST /projects/<p>/transfer                   # this advance seals the wall — the door removed, a standing deny
#                                              stamped on its target, the admission scan's receipts committed —
#                                              and constructs design's floor
# P03-design → P04-implement → P05-test: the plain loop (transfer applies each boundary, the claimed grants
#   do each phase's work), every phase now a clean room working from the specification notes, the brief and
#   the planning input alone — the divergence lane runs driver-side in the background against committed
#   trees; P06-audit: the compliance verdict (findings first, the Result line last)
```

Your declarations at materialization, none of them shipped content: the **lane rows** — uncomment
and command the pack's `### test-lanes` rows in `.opencode/auto/intents/cleanroom.md` (build, the
paradigm-constraint suite, the property suite, the divergence scan behind a bare target name, the
acceptance anchor) in the project's own toolchain terms; the **wall door** — fill the
`Wall: seal <door>` line in `.opencode/auto/phases/spec-read.md` with the reference symlink's path;
and the **divergence corpus location** — a driver-side fact you hold outside the platform boundary,
never brief, pack or session content. Between rounds, `sync` upgrades the materialized bundle to
the running binary — unedited files fast-forward, your lane rows and door fill are person-edits,
reported and never overwritten.

The re-work bundles share the survey rhythm: a `faithful` or `faithful-lean` round opens with the
same human-gated survey (its release installing the revised brief) — `faithful` ports an existing
system faithfully (the survey sizes the reference, the phases carry the parity duties),
`faithful-lean` the same with deliberate debt shedding. Neither carries the wall, the sealed
channel or the audit — those are the cleanroom's compliance gates alone.

`init` always leaves an existing opencode.json untouched; `.opencode/agent/auto.md` is always replaced when
it differs from the built-in template, so the agent contract is the latest version. Round directories
(`docs/R-NN/`) are not an init product — the daemon's transfer operation establishes them in a phased
project (its plan operation in `m` mode; see
[The round lifecycle over the daemon](#the-round-lifecycle-over-the-daemon-transfer-clarify-plan-tasks)).

The generated `opencode.json` is full-trust by design: the bash permission table ships
`{"*": "allow"}` and no model is pinned (session models come from the driver's own routing and
the model registry layers; a fresh project simply inherits your opencode default). Driver runs
are unattended and a permission request blocks the run (exit 2) rather than guarding it, so
containment lives in branch isolation (`--isolate`), the clean-tree gates and the unified
commit's SHA audit — not the bash table. The narrower patterns listed beside the wildcard
(`bun`/`npm test*`, `git status*`/`diff*`/`log*`, …) are the ready-made starting point for a
person who deletes the wildcard and wants a tighter posture; the file is yours after init
(`fix` never overwrites an existing copy).

The semantics of `init` writing `.opencode/auto/config.json` are a **stateless full overwrite**: the output
is decided solely by the arguments passed to this invocation; keys not given always fall back to the built-in
defaults, with no incremental merge against the old config on disk. So "run a no-argument `init` in a clean
environment" and "run a no-argument `init` after a parameterized `init`" produce byte-identical output — a
single `init` reaches a deterministic state, no prior cleanup needed; repeated runs with the same arguments
are constant. To change one or two keys and keep the rest of the existing values, use the `amend` subcommand
(see [Amending (amend)](#amending-amend)); to only refresh the contract / AGENTS.md block to match the current
config, or to clear retired keys, use `fix` (see [Config fix (fix)](#config-fix-fix)) — neither ever resets the
remaining keys to defaults.

**Breaking change (plans/0283)**: `run`, `plan`, `transfer`, `clarify` and the hidden `_lane` entry are
retired — every invocation answers the retirement notice with exit code 1 (see
[The push commands are retired](#the-push-commands-are-retired-plans0283)). The constitutional options
(`-m/--mode`, `--agent`, `--context-limit`, `--subtask`, `--idle-time`, `--idle-max`, `--test-by-driver`,
`--handover-test`, `--auto-number`/`--no-auto-number`, `--phases`, `--parallel`, `--tree-lanes`,
`--scan-exempt`, `--isolate`, `--intent`) stay fixed by `init` as project attributes (the strict commands
— `close`, `land` — still refuse any of them with the amend revision hint). `--commit` is retired entirely
(see the compatibility table below). `--implement-file`/`--implement-prompt` are retired with `plan`
itself — the planning input is the phase's `plan-input.md`, the planning session the formulate grant's.

## Project configuration (.opencode/auto/config.json)

Constitutional options — those deciding "how sessions are instructed" —
are fixed at `init` time into `.opencode/auto/config.json`: versioned, shared with the repository,
human-editable. The driver reads the file at every run start (the daemon's runs) and prints a one-line
config summary; `status` prints the same. The test for which side an option belongs on: **changing it requires also changing the wording of
AGENTS.md / task documents / the contract, or it describes a model/project attribute → init; it only
describes how this run executes and how a person watches it → run.**

| Key | Value range | Default | Description |
| --- | --- | --- | --- |
| `mode` | A registered mode name | `migrate` | Prompt-level scenario mode, see [Mode layer](#mode-layer--m--mode) |
| `agent` | `opencode` / `claude` | `opencode` (key not written) | The coding agent that drives every session (M6.1); `OPENCODE_AUTO_AGENT` overrides it per run. In older versions this key held a contract name (e.g. `auto`); reading one is an error telling you to delete the key (`fix` deletes it) — the contract is always `.opencode/agent/auto.md`. See [agent selection](#opencode-server-and-agent-selection) |
| `contextLimit` | Positive integer (thousand tokens) | `64` | The context budget baseline; the context-handover wall is 2x, raised to a quarter of a large model window and capped at 80% of the window (every whole-task session and fix round since the protocol became standing; see [Execution pipeline](#execution-pipeline)) |
| `subtask` | `off` / `auto` / `true` / `ondemand` | `off` (changed from `auto` on 2026-10-04) | Subtask splitting, see [Execution pipeline](#execution-pipeline); the JSON boolean `true` reads as `"true"`, and `ondemand` — the mode that once carried the context-handover protocol alone — is `off`'s permanent synonym (the protocol is standing for every whole-task session), read and written back as `off` |
| `idleTime` | 1..120 (minutes) | `10` | The no-progress window for driver-managed scripts (test scripts); the old key name `verifyIdle` is read as a fallback when the new key is missing (`fix` renames it in place) |
| `idleMax` | 0..1440 (minutes, 0 = no limit) | `0` | The absolute duration cap for driver-managed scripts; the old key name `verifyMax` is read as a fallback when the new key is missing (`fix` renames it in place) |
| `verify` | **Retired** | — | Task-level acceptance was retired (2026-09-21): an existing config with `verify: true` fails loading with exit 1 (delete the key — `fix` does it — and plan acceptance as tasks or use the v phase); `false` or absent is ignored |
| `commit` | **Retired** | — | Committing cannot be turned off. `false` was retired on 2026-09-15, and the key went entirely on 2026-09-29 with the flag: a stored `true` (what an older init wrote) loads and is ignored like an unknown key; any other stored value fails loading with exit 1 (`fix` deletes the key) |
| `testByDriver` | `true` / `false` | `false` | Compile/test/build/lint commands are executed by the driver (sessions request them via a `test/` script + the `tmp/test.sh` marker), see [Test execution protocol](#test-execution-protocol---test-by-driver) |
| `handoverTest` | `true` / `false` | `false` | On test failure with the context at its limit, write a handover document and continue in a new session; requires `testByDriver: true`, otherwise config validation fails (exit code 1) |
| `autoNumber` | `true` / `false` | `true` | Auto numbering (on by default, disabled by `--no-auto-number`): task numbers (T-NNN) never repeat among the target directory's task artifacts; the next available number is derived from them (the highest number any task index lists or any `docs/T-*` path holds, + 1) — no record is kept — see the end of [Phased flow](#phased-flow---phases) |
| `phases` | A subsequence of `admtvk` containing `m`, or a list of phase type ids containing `implement` (comma-separated string or JSON array) | `"m"` | Init-stamped machinery (plans/0137): the birth shape alone — `init --phases` / an `--intent` bundle's manifest stamps it, `amend --phases` is retired (a round's phases reshape through its `- R-NN <phases> — <goal>` roadmap line in `docs/analysis.md`, never the key), and `status` prints no phases segment (the round's operative list is the phase tree). The released roadmap line covering a round is that round's authority (only a diverging line is recorded — an informational note, nothing to repair); the key governs a round no released line covers. Phased flow (a analysis → d design → m implementation → t test → v acceptance → k knowledge distillation; the list form may reference custom types under `.opencode/auto/phases/`); `"m"` = the single-phase mode — the compatibility floor (plans/0137: machinery kept, not a supported way of working for new projects; a phased project starts at `init --phases` or `--intent`), no phases declared, the implicit `docs/R-01/P01-implement`, no handover sessions, tasks listed by a person or planned from a planning input (see [Planning tasks with AI](#planning-tasks-with-ai)). The letters are human shorthand for the CLI only — the durable names are the full type ids (`P02-implement`, never `P02-m`), and the comma form (`--phases analysis,design,implement,test`) is the first-class expressive spelling, any order, repeats allowed. See [Phased flow](#phased-flow---phases) |
| `intent` | A loaded intent pack's name (the built-in `default`, or one of `.opencode/auto/intents/*.md`) | `default` (key not written) | The active intent pack (auto-core plans/0079 §2): quality bars, phase duties, governance and artifact conventions injected into the prompts. `init --intent <name>` selects it (on init the value may also name an **intent bundle** — a directory with a `bundle.json` manifest, custom phase types, the pack and a mode — which init materializes into the ordinary `.opencode/auto/` surfaces and stamps `phases`/`mode`/further config keys from its manifest; explicit flags win over the manifest); `amend --intent` revises the key. A missing pack fails loading strictly; the run's preflight logs the active pack and its provenance |
| `parallel` | `none` / `low` / `medium` / `high` | `none` (key not written) | The parallel planning level (auto-core plans/0046; concurrent execution live since plans/0068, its activation decoupled by plans/0125 — width alone runs it): selects the `## parallelism` guidance injected into the code-phase planning prompts — and, on concurrent runs, into the decomposition prompts — so tasks are arranged for parallel execution, their `Depends:`/`Touches:` declarations keeping concurrent units disjoint. Execution width stays per run: the daemon's run width (`maxSessions` 2 or higher) executes concurrently by width alone (see [Parallel execution](#parallel-execution-parallel---max-sessions)) — documentation-scoped tasks run side by side as their declarations allow with no level at all, a ℹ note teaching the declarations-as-admission model; a level adds the code-phase planning depth (code tasks running concurrently only under `--tree-lanes`) and sets the landing-conflict posture: `low` blocks on the first conflict, `medium`/`high` allow one repair re-dispatch before blocking — no level is the low one |
| `treeLanes` | `off` / `auto` / `on` | `off` (key not written) | The execution tier of concurrent runs (auto-core plans/0096, the 0068 amendment): `off` = tier 0, process parallelism in one tree — doc lanes side by side plus serial code task sessions, the tests as parallel driver processes, no worktrees; `auto` = the preflight probe (reflink capability + the `lanes.treeBudgetMB` budget against the working tree) picks between tier 0 and tier 1's sparse CoW worktree lanes, logging the tier and its reason; `on` = tier 2, the full worktree per lane. Set with `init`/`amend --tree-lanes`; the `parallel` level stays the planning-guidance key. The `lanes` object beside it (`caches`, `treeBudgetMB`, `sparseFloor`) is hand-edited like `acceptanceGate`/`build` |
| `scanExempt` | An array of path globs relative to the target directory (`*`, `**`, `{a,b}`; no absolute path, no `..`) | none (key not written) | Deliverable files the driver's two content scans skip (auto-core plans/0059 X2): the process-document reference scan (the lines a unit added, at subtask close-out, and the whole tree at round close — inside the nested destination repositories alone since auto-core plans/0108, every finding recorded as one count during rounds and enforced itemized at `release` alone; the working directory's own files, test tooling and `prompts/` included, are process workspace and never reference-scanned) and the document terminator scan at subtask close-out. For a deliverable where such strings are content — a destination's own test fixtures or sample documents. A glob naming a directory covers the files under it (`test/fixtures` = `test/fixtures/**`). Only deliverable paths are exempted: the task and round records stay held to their rules whatever the list says. Set with `init`/`amend --scan-exempt a,b` (the list replaces the stored one; `none` removes the key); shared with the repository like every key |
| `isolate` | An array of repository-relative paths to nested git repositories (each holding a `.git`; no duplicates, nothing absolute or climbing out, never the target root) | none (key not written) | Branch-isolated nested repositories (auto-core plans/0074): at round establishment (the daemon's transfer operation in a phased project, its plan operation in `m` mode) each designated clean repository is checked onto the round branch `auto/R-NN` (a dirty one blocks exit 2 naming the repository and its paths) — every per-session driver commit, rollback and baseline then lands there while the original branch never moves; `opencode-auto land` returns the round onto the original branch as one commit. Set with `init`/`amend --isolate <rel-path>` (repeatable; the list replaces the stored one; `none` removes the key); see [Branch isolation and landing](#branch-isolation-and-landing-isolate-land) |
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

Bad JSON / out-of-range values / an unregistered `mode` → every strict-loading command (`init`, `amend`,
`close`, `land` — and the daemon's operations) fails with exit code 1, the error naming the key and its
expected range (strict failure over silent fallback); unknown keys are ignored (forward compatible). When
the strict failure is of a class `fix` can repair (retired keys, old key names, only the legacy
`.auto/config.json`), the message appends the line `fix: opencode-auto fix <dir>`, and `status` prints the
same line under its ⚠ line.

**init validates everything, then writes** (auto-core plans/0052 D7): option values, modes, the prefix
guardrail (read-only: no completed phase is lost, no phase directory containing existing work is deleted;
re-syncing the phase index belongs to the round lifecycle — the advance's committed re-derivation over the
daemon), the target directory's prompt-library overrides
(`.opencode/auto/prompts/`) and the intent packs are all validated before the first write — any failure is
exit code 1 with the config layer untouched (no config.json, no contract or AGENTS.md block refresh, no
brief.md). The **commit-capability prerequisite** follows the same discipline:

- **Git bootstrap** (auto-core plans/0073, ruled 2026-10-04): when the target directory is inside no git
  work tree, `init` first initializes the repository itself — on the person's `init.defaultBranch` when set,
  `main` as the fallback — and prints it loudly (`✓ initialized git repository (branch …) — the driver's
  record and rollback need it`). There is deliberately **no `--no-git` escape hatch**: a git-less production
  run was the silently-broken state this closes (no unified commit, no unit baselines, no rollback, no audit
  trail), and the loud print is the disclosure. The bootstrap runs before the identity probe and before the
  `.gitignore` write, so the ignore set, the first unified commit and every later gate see a real repository;
  a refusal after it still leaves no config written, and the empty repository it leaves behind is
  `rm -rf .git` away from undone. In-repo `init` is unchanged (the bootstrap is a no-op there). The
  non-git production tier effectively disappears with this — the behavior-contract change is recorded in the
  compatibility table below (the tests keep their seam: the non-git paths of the core functions remain, only
  `init` bootstraps).
- **Identity, in resolution order**: a resolving global/`GIT_*` identity (judged exactly as the commit-time
  probe judges, `git var` under `user.useConfigOnly`) → proceed, nothing written; else `--name <name>
  --email <email>` given at init → written as **repository-local** config in the repository at the target
  root (never `--global` — the tool never edits the person's global config); neither → refused (exit code 1
  before any write, the message saying how to configure an identity and naming the flags). The
  `opencode-auto@local` fallback identity is deliberately never auto-written at init — it covers only the
  nested repositories the person brought in; the target root's history is the audit trail of AI changes and
  keeps an attributable identity.

Run `git config --global user.name/user.email` first (or drop `--global` inside the repository, or pass
`--name`/`--email`) and retry. During a run the file is made read-only together with opencode.json and
AGENTS.md; make manual revisions outside a run.

Compatibility and migration:

| Scenario | Behavior |
| --- | --- |
| `init` in a directory inside no git work tree (auto-core plans/0073) | **Breaking (behavior contract)**: `init` initializes the repository itself (branch: the configured `init.defaultBranch` when set, else `main`) and prints it loudly, instead of silently running on with every commit-side gate idle (no unified commit, no unit baselines, no rollback, no audit trail). No `--no-git` exists — the loud print is the disclosure. Identity as [above](#project-configuration-opencodeautoconfigjson): a resolving global identity passes, `--name`/`--email` are written as repository-local config, neither refuses with exit 1. The `.git` directory `init` created is not a `reset` artifact — undo it with `rm -rf .git` while it is still empty |
| Old project (only `.auto/config.json` has a mode) | When the new file is missing, the old value is read as a fallback and a run prints a hint to "run `fix` to write out the full config" (`fix` writes the new file from the old mode + defaults); once init / fix has written the new file the fallback ends (the old file is not deleted — it sits ignored by git until `reset` cleans it up) |
| Old scripts like `run -m xxx` | Exit code 1 + the retirement notice (plans/0283 — the protocol does nothing via push; the constitutional keys are revised through `amend`) |
| Retired option `--commit` (any value, on any command) | Exit code 1 + retirement notice (committing cannot be turned off; a stored `commit: true` still loads and is ignored) |
| Retired options `--verify` / `--review` / `--early` / `--early-review` / `--final-review` | Appearing on any command: exit code 1 + retirement notice (acceptance becomes planned tasks; the report result line `Result: FAIL` stops the run) |
| Retired options `--source-dir` / `--source-path` / `--dest-dir` | Appearing on any command: exit code 1 + retirement notice (the migration source and target are intent and go into the project analysis's `## Project brief` proposal — or `amend --brief` — or the planning input) |
| Existing config containing `source` / `destDir` | `amend` / `init` / `land` fail strictly (`status` prints a ⚠ line); the message names the original value and the fix (copy into brief.md, then delete the key) and points at `fix` — `fix` migrates the value into brief.md's `## Source` / `## Target` sections and deletes the key; a no-argument `init` drops them, prints the original values, and overwrites as usual |
| Retired options `init -p` / `--prompt` (init takes no prompt and no brief; the planning input is the phase's `plan-input.md`), `init --brief` / `--brief-file` (init writes no brief — the project analysis's approved `## Project brief` proposal installs it; a later manual override: `amend --brief`), `amend --phases` (plans/0137: the config `phases` key is init-stamped machinery — a round reshapes by its `- R-NN <phases> — <goal>` line in `docs/analysis.md`, the daemon's transfer operation re-deriving the unstarted tail) and `--amend` | Appearing: exit code 1 + retirement notice (the first points at the analysis flow, the second at the analysis flow and `amend --brief`, the third at the `amend` subcommand); the retired `continue` subcommand likewise: exit code 1 + retirement notice (pointing at the transfer operation of a daemon — `POST /projects/<project>/transfer` — it runs the round-close checks and opens the next round); the retired `check` subcommand likewise: exit code 1 + retirement notice (pointing at `fix --dryrun` — the principle scan and the reference check were removed) |
| Unknown `--` options (including misspellings like `--next`) | Exit code 1 + near-name suggestions (breaking; previously silently ignored). `status` accepts only a directory argument and rejects any option; `reset` accepts only a directory argument and `-f`; `fix` accepts only a directory argument, `-f` and `--dryrun` |
| Close-family flags (`--reason`, `--cascade`, `--commit-changes`, `--stash-changes`) or the lane value flags (`--unit`, `--merge`) on `init`, `close`, `land` or any other live command | Exit code 1 + a pointer at the owning command — `close` for the close family, the demolished hidden `_lane` entry for the lane flags (breaking; previously silently ignored — `init --dryrun` wrote everything and `run --merge <dir>` swallowed the directory; `plan` silently dropped the lane flags until the 0159 guard; the lane entry itself retired with `run`, plans/0283) |
| Repeated `init` (no arguments) | **Every key falls back to its default** (breaking: previously "config unchanged"); templates and the marker block stay idempotent |
| Parameterized init like `init --test-by-driver true` | Given keys are written with their values, **keys not given fall back to defaults** |
| `amend --test-by-driver true` | Only the explicitly given keys are rewritten, the rest are kept |
| Overwriting an existing config with a dirty worktree | Exit code 1 + a list of uncommitted files (including nested repositories/submodules); `-f`/`--force` skips it |
| Overwriting an existing config on an interactive terminal | Asks for confirmation `[y/N]`; anything but `y` cancels with no changes; non-TTY (CI/scripts) overwrites directly |
| An existing PLAN.md (with `verify:` / `verified:` / `final:` field lines, `T-F<k>` tasks) | Not read since M3.4; migrate the tasks into task units (see [Task unit format](#task-unit-format)) to continue |
| Switching `subtask` mid-run | Tasks whose checklist was already injected resume from their ticked state (progress is recorded per task, never mixed across tasks); new tasks run under the new setting; switching mid-run is discouraged |
| Changing `mode` mid-run | Only the prompt copy changes (modes do not enter the scheduling state machine) |
| Turning `commit` off | No longer possible: `commit: false` was retired on 2026-09-15, and on 2026-09-29 the flag and the config key went entirely — any `--commit` form is exit 1 + retirement notice; a stored `commit: true` loads and is ignored, any other stored value fails with exit 1 (`fix` deletes the key and keeps the rest; or delete it by hand, or a no-argument `init` full overwrite — dropping and printing the key) |

### init options (fixing and amending)

| Option | Description |
| --- | --- |
| `-m` / `--mode <name>` | Scenario mode, written to the config's `mode` key (precedence: explicit value > existing config value > default `migrate`; an unregistered name is a usage error with exit code 1, the message listing the currently supported modes); see [Mode layer](#mode-layer--m--mode) |
| `--agent opencode\|claude` | The coding agent driving the sessions, written to the config's `agent` key (default `opencode`, key not written; `--amend --agent opencode` deletes the key); any other value is a usage error; see [agent selection](#opencode-server-and-agent-selection) |
| `--phases <admtvk subsequence containing m \| phase type list>` | Phased flow, written to the config's `phases` key (default `"m"` = single run); the comma form of full type ids (`--phases spec-read,design,implement,test,audit`, custom types included) is the expressive spelling — any order, repeats allowed, `implement` required. Init's alone (plans/0137): `amend --phases` is retired outright — a round's phases reshape by moving or adding its `- R-NN <phases> — <goal>` line in `docs/analysis.md` (an uncovered round becomes covered the moment its line exists; the next `transfer` re-derives the round's unstarted tail from it before constructing). When completed phases exist, a re-init must additionally satisfy the prefix guardrail (the completed phases form a prefix of the new value), otherwise it errors and points at rolling back the phase index by hand. See [Phased flow](#phased-flow---phases) |
| `--intent <name>` | The active intent pack, written to the config's `intent` key (auto-core plans/0079; default = the built-in `default` pack, key not written): the name must be a pack the loader resolves in this directory (built-in plus `.opencode/auto/intents/`). On `init` the value may instead name an **intent bundle** — a built-in one (`cleanroom` ships with the tool: the Clean-Room Redesign workflow — spec read, design, implement, test, spec-compliance audit, with the clean-room boundary carried by its pack and mode), a registered bundle, or a directory holding a `bundle.json` manifest with `phases/`, `intents/` and `modes/` files. A bundle is validated as a whole (nothing written on a parse failure), materialized into the ordinary `.opencode/auto/` surfaces, and stamps `intent`, `phases`, `mode` and any manifest config keys (explicit flags win over the manifest; the bundle's phase sequence uses the comma form of full type ids only). `amend` takes plain pack names |
| `--parallel <none\|low\|medium\|high>` | The parallel planning level, written to the config's `parallel` key (default/`none` writes no key): the planning prompts arrange tasks for parallel execution at that level; a run's width (the daemon's run request `maxSessions`) activates concurrent execution — see [Parallel execution](#parallel-execution-parallel---max-sessions) |
| `--tree-lanes <off\|auto\|on>` | The execution tier of concurrent runs, written to the config's `treeLanes` key (auto-core plans/0096; default/`off` writes no key): `off` = tier 0, process parallelism in one tree (serial task sessions, the tests as parallel driver processes — no worktrees); `auto` = the preflight probe picks tier 1's sparse CoW worktree lanes when the filesystem reflinks and the `lanes.treeBudgetMB` budget allows, logging the tier and its reason; `on` = tier 2, the full worktree per lane. The `lanes` object (`caches`, `treeBudgetMB`, `sparseFloor`) is hand-edited — see [Parallel execution](#parallel-execution-parallel---max-sessions) |
| `--subtask [mode]` | Subtask splitting, written to the config (default/bare flag `off` — changed from `auto` on 2026-10-04): `auto` is adaptive decomposition — one lead session works the task under `ondemand`'s handover protocol, and may split the remaining work into 2–5 streams, each run in a fork of the lead, when the driver's guard finds that it pays; `true` is the planned pipeline (a decompose session, then one session per subtask — what `auto` meant before auto-core plans/0059); `off` disables splitting and one session completes the whole task; `ondemand` hands over and continues when the context reaches 2x `contextLimit`. See [Execution pipeline](#execution-pipeline) |
| `--idle-time [1-120]` | The no-progress window for driver-managed scripts (minutes, default/bare flag 10; the old name `--verify-idle` was renamed — appearing errors with guidance): the driver polls the size of the output file (`tmp/test.<n>.out`, stdout/stderr merged into one file) and terminates the script only after no growth is sustained for the window (exit code recorded as 124); as long as output keeps growing, the runtime is unlimited |
| `--idle-max [1-1440]` | The absolute runtime cap for driver-managed scripts (minutes, default/bare flag unset; the old name `--verify-max` was renamed): a backstop against scripts looping forever while printing; when set to a positive integer, exceeding the total duration terminates the script regardless of output |
| `--context-limit [n]` | The context budget baseline (unit: thousand tokens, default/bare flag 64), written to the config; a new session starts once the previous session's used tokens reach half of it (32k by default), effective alongside the 50% share threshold |
| `--test-by-driver [true]` | Execution rights for compile/test/build/lint commands move to the driver (default/bare flag `false`), written to the config: execution sessions no longer run such commands in-session; instead they write the command as a script in `test/`, write the script path into `tmp/test.sh` to request execution by the driver, and the exit code and output file are fed back for the AI to read and judge directly. The switch also decides whether the test-execution principle block enters AGENTS.md and whether the test protocol section enters the agent contract and execution prompts. See [Test execution protocol](#test-execution-protocol---test-by-driver) |
| `--handover-test [true]` | Must be combined with `--test-by-driver` (otherwise a usage error, exit code 1), written to the config: when a test fails and the session context reaches `contextLimit`, the AI is asked to write a handover document and continue in a new session, preventing repeated trial-and-error inside a bloated context |
| `--scan-exempt none\|<globs>` | The scan exemptions, written to the config's `scanExempt` key as a comma-separated glob list (commas inside `{a,b}` stay in the glob; default none, key not written; `none` deletes the key): deliverable paths the process-document reference scan (destination repositories' files alone, plans/0108) and the document terminator scan skip. An empty list, an absolute glob or one containing `..` is a usage error |
| `--auto-number` / `--no-auto-number` | Auto numbering switch, written to the config's `autoNumber` key (default `--auto-number` = on, `--no-auto-number` is the disabling toggle; both switches present without `=false` is a usage error): with it on, task numbers (T-NNN) never repeat among the target directory's task artifacts; the phase planning session continues numbering from the derived next free number (the highest number any task index lists or any `docs/T-*` path holds, + 1 — no record is kept). The `phases = "m"` planning session (see [Planning tasks with AI](#planning-tasks-with-ai)) continues the same way. See [Phased flow](#phased-flow---phases) |
| `--name <name> --email <email>` | The commit identity pair (auto-core plans/0073): when no global/`GIT_*` identity resolves in the repository at the target root — including one `init` just bootstrapped in a non-git directory — init writes them as **repository-local** `user.name`/`user.email` (never `--global`; the tool never edits the person's global config). A resolving global identity always wins and nothing is written. Not config keys (they never enter config.json); the pair must be given together (a commit identity needs both) with one-line non-empty values; every other command refuses them. Without them and without a resolving identity, init refuses (exit code 1) with the manual `git config` guidance |
| `-f` / `--force` | Skip the overwrite confirmation and the clean-worktree check, for CI and automation scripts (shared with `reset` / `fix`); on `amend` it is a usage error (amend discards no keys, so there is no overwrite confirmation to skip) |

Under `init` (the default full overwrite), the config-writing options above mean "not given falls back to the
default"; "only explicitly given keys are rewritten" is the `amend` subcommand's semantics (its `-p`, `-f`,
`--amend` are all usage errors). The project brief `.opencode/auto/brief.md` is not an init product (its seed
half retired, auto-core plans/0133): the assisted project analysis the first `plan`/`transfer` opens proposes
it (`## Project brief` in `docs/analysis.md`) and the approved proposal installs the brief on release — every
survey release likewise installs the revised one; a later manual override is `amend --brief <text> |
--brief-file <path>`, and `init -p` / `init --brief` are retired (appearing gets a message pointing at the
analysis flow and `amend --brief`). `--server` was removed from init along with its de-AI-ification (init starts no
sessions), and init now refuses every foreign option outright — exit 1 with a pointer at the owning command
— instead of silently dropping it. init writes nothing under `docs/` (round directories are established by
the daemon's transfer operation — its plan operation in `m` mode) and starts no AI sessions.

### Amending (amend)

`opencode-auto amend [dir] --<key-option> <value> ...` rewrites the given config keys and keeps the rest at
their existing values (auto-core plans/0052 D25; the old spelling `init --amend` is retired, folded into this
command). It accepts the same key options and values as init (`-m/--mode`, `--agent`, `--subtask`,
`--idle-time`, `--idle-max`, `--context-limit`, `--test-by-driver`,
`--handover-test`, `--auto-number`/`--no-auto-number`, `--wrapup`/`--no-wrapup`, `--parallel`, `--tree-lanes`,
`--scan-exempt`, `--intent` a plain pack name, and `--isolate <rel-path>` repeatable with `none` clearing
the key); value-range validation and the `handoverTest` pairing check share their code with init, and the
brief rides its own channel — `--brief <text> | --brief-file <path>` revises `.opencode/auto/brief.md`
verbatim (satisfying "at least one key" on its own). `--phases` is the one init key amend refuses outright
(plans/0137: the config `phases` key is init-stamped machinery — a round's phases reshape by moving or
adding its `- R-NN <phases> — <goal>` line in `docs/analysis.md`, the daemon's transfer operation re-deriving the
unstarted tail; the prefix guardrail guards init's changes alone, since amend never changes the key).

- **Config keys only**: `-p` is a usage error (the planning input is the phase's `plan-input.md`, read by
  the formulation grant; the brief is revised with `amend --brief <text> | --brief-file <path>`, or by hand
  outside a run); `-f` is a usage error (amend discards no keys, there is no overwrite confirmation or
  cleanliness gate to skip); `--amend` is a usage error (redundant).
- **At least one key**: giving no key option at all is a usage error, and the message points at `fix` (to
  only refresh the contract / AGENTS.md block to match the existing config, use `fix`).
- **Refused without a config**: when the target directory has no `.opencode/auto/config.json`, exit code 1
  pointing at `init` (with only the legacy `.auto/config.json` it also points at `fix`, which writes the full
  config from the old mode).
- **Strict loading**: if the existing config fails to load (retired keys, out-of-range values, …) it fails
  rather than carrying bad keys forward; when the failure is of a class `fix` can repair, a `fix:` line is
  appended to the message.
- **What it writes**: config.json, the agent contract and the AGENTS.md marker block (both rendered from
  the config — plus the brief when `--brief`/`--brief-file` was given) and nothing else: it never touches
  round directories (`--phases` is refused, never drifted); `opencode.json` and `.gitignore` belong to
  `init` / `fix`, which amend does not touch.
- On success it prints `✓ amended (<given options>)`; the changes stay in the worktree, uncommitted — review
  and commit them yourself.

### Bundle sync (sync)

`opencode-auto sync [dir] [-f] [--dryrun] [--from-bundle]` upgrades a materialized intent bundle to the
running binary's (auto-core plans/0100): the write side of the provenance detection every run logs beside
the intent-pack line (and `fix`/`status` report as manual findings/rows). Init's `--intent` materializes the
bundle's files and records their digests in `.opencode/auto/provenance.json`; when the binary's bundle
moves on, that committed surface silently predates it — detection names the drift, `sync` propagates it:

- unedited managed files fast-forward **byte-identically** to the running binary's bundle and the stamp
  rewrites with the new digests; files the bundle newly ships land, files it retired are reported and never
  deleted;
- person-edited files are reported with the headings delta and **never written** (the stamp keeps the
  tool's last-written bytes, so the binary's offer stays visible in detection); extras under the materialized
  homes are reported, never deleted;
- an unstamped legacy project (materialized before the stamp existed) bootstraps: byte-identical files are
  adopted into a fresh stamp, differing ones reported with the delta — `--from-bundle` overwrites them
  (your assertion that the pack is pristine-but-old);
- a round in flight only warns (later phases would plan under changed charters — your boundary call);
  `config.json` is never touched, nothing is committed (review and commit the diff), and `sync` refuses
  while a run lock is live (`--dryrun` reads only).

### The release gate (release)

`opencode-auto release [dir]` certifies that the **destination repository** — a nested git
repository inside the target, the shipped deliverable of a migration like `aster-spi-nor` —
**stands alone** (auto-core plans/0103). During the migration's rounds the containment
findings are deliberately deferred: a process-document path, a task-id citation or an
out-of-root path inside the destination is *recorded* (one ⚠ count line at close-out, a
warning at round close — the running ledger; the blocking form of "the destination must
not reference process documents" is release-time truth alone), because restating citations
away is churn a working round should not be forced
into. `release` is the moment the bill comes due:

- every **task-id mention** (T-NNN), every **path leading outside the repository's own
  root** (a `..` chain climbing past it, an absolute path into the workspace) and every
  **process-document path** (`docs/T-*`, `docs/R-*`, `.auto/`) in the destination blocks;
- each destination must hold a **clean tree** — uncommitted changes are not a releasable
  state;
- it is a **gate, not a scrubber**: removal is content work (restate the decision a
  citation pointed at, vendor or rewrite what a path named) you do with your agent; fix,
  commit, and the re-run certifies with one `✓ <destination> @ <HEAD>` line;
- `AUTO-*` markers are self-contained content, not references — stripping them is your
  editorial choice, never demanded;
- the workspace's own tree is not the destination's business: `test/` scripts naming task
  ids never blocked anything, and the outer repository's dirt does not either.

Exit codes: `0` certified; `2` findings remain (fix, commit, re-run); `1` there is no
nested repository to release or no config. Takes no options (like `status`); runs beside a
live run (read-only — the clean-tree check makes a mid-flight certification refuse on its
own).

### Config fix (fix)

`opencode-auto fix [dir] [-f] [--dryrun]` repairs the config layer by rule (auto-core plans/0052 D10/D11):
`.opencode/auto/config.json` and the artifacts init writes from it. The baseline is the existing config on
disk (read as raw records, without strict validation); it accepts no config key options and **never resets
any key to its default** — unknown keys and keys no rule names are kept verbatim. The rules repair only keys
that "fail to load or silently lose their meaning"; legal alternative spellings (array-form `phases`,
`parallel: "none"`, `agent: "opencode"`) are left alone; phase index inconsistency is not fix's business (it
belongs to the advance).

Findings come in three classes: **fixable** — deterministic and meaning-preserving, applied per the table
below; **manual** — reported only, never guessed (e.g. `handoverTest: true` with `testByDriver: false`:
which side to change is a person's decision); **info** — a recorded state, nothing to repair (auto-core
plans/0135): the note names an expected posture and its channel, asks nothing of anyone, and `fix` /
`fix --dryrun` exit `0` when only info notes remain — an expected state is not drift, so a CI gate on the
exit code stays green.

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
| `.gitignore` missing an entry for a nested git repository in the tree (auto-core plans/0138) | Fixable | Append the entry (the parent's unified commit would otherwise absorb the repository as a gitlink) |
| `.gitignore` holds the retired `/.gitignore` entry (projects initialized before plans/0138) | Fixable | Remove the entry — the ignore set is a tracked project surface; the file surfaces untracked and lands in git with the next commit |
| `.gitignore` holds the retired `/opencode.json` entry (projects initialized before plans/0138) | Manual | Remove the line by hand to surface `opencode.json` as a tracked project surface — or keep the line and own it if the file must stay local (raw secrets belong in references, never literals) |
| `opencode.json` missing | Fixable | Write the built-in template (left alone when it exists, possibly containing manual edits) |
| `opencode.json` missing the working-directory knowledge boundary — the `"/**": "deny"` + `"/tmp/**": "allow"` pair under `permission.external_directory` (auto-core plans/0147) | Fixable | Insert the pair additively (person entries kept, always winning the evaluation tie) |
| `opencode.json` missing the root-symlink read-only stamps — the `external_directory` allow or the `permission.edit` denies for a root symlink's resolved target in the forms the live edit tools ask (the target's real path, its worktree-relative form, the door name — auto-core plans/0122; 0147; 0188) | Fixable | Insert both layers additively after the last person catch-all of any spelling (person entries kept, always winning the evaluation tie) |
| A stale `external_directory` allow — its symlink or target is gone (auto-core plans/0122) | Manual | Remove the entry if the reference moved |
| `opencode.json` cannot hold per-pattern allows (malformed file or a flat action, auto-core plans/0122) | Manual | Add them by hand |
| Bundle provenance: a managed intent-bundle file stale or person-edited (auto-core plans/0100) | Manual | Reported; `sync` plans the upgrade |
| The config `phases` key diverging from a released roadmap line covering the current round (auto-core plans/0114 D2; divergence-only per 0136 — an agreeing line prints nothing) | Info | Nothing — recorded, both values named; reshape the round by moving its `R-NN` line in `docs/analysis.md` (the config key is inert for the round, never amended) |

The artifact rules are rendered from the config, so they run only when the config (after the key rules are
applied) loads strictly.

Interaction mirrors `reset`: it first prints the findings list (`fix:` / `manual:` / `info:` / `skipped:`
lines — only informational notes print under a `config-layer notes in` header instead of `findings`); when
there are fixable items it goes through the clean-worktree gate, then asks once more `[y/N]` (no prompt
off-TTY; `-f`/`--force` skips both gates), then writes per the list and prints a `fixed:` line per item. fix
does not commit — the changes stay in the worktree for review.

`fix --dryrun` is the read-only half and the replacement for the retired `check` as a scripted gate on config
drift: it plans and prints the findings and writes nothing, exiting `0` when there are none and `1` when
there are fixable or manual ones — informational notes alone print and exit `0` (an expected state is not
drift, auto-core plans/0135) — so a CI job can gate on the exit code. It skips only the gates
that guard writes — the clean-worktree check, the confirmation and the run-lock refusal (it runs beside a
live run) — and keeps fix's other refusals, including the uninitialized and legacy-layout ones.

| Case | Exit code |
| --- | --- |
| No config and no legacy mode (not initialized; run `init` first) | 1 |
| No findings at all (the config layer matches the config) | 0 |
| All fixable items applied, no manual items | 0 |
| Only informational notes (nothing to repair) | 0, nothing written |
| Manual items present (fixable items still applied) | 1 |
| Dirty worktree (no `-f` given) | 1, no changes made |
| Confirmation answered with anything but `y` | 0, no changes made |
| `--dryrun`, no findings | 0, nothing written |
| `--dryrun`, only informational notes | 0, nothing written |
| `--dryrun`, findings (fixable and/or manual) | 1, nothing written |

Strict failures on the `status`, amend, close and land paths append a `fix: opencode-auto fix <dir>`
line when fix's key rules can repair them (the daemon's operations do the same); recovery hints like a missing contract or a stale AGENTS.md block
likewise point at `fix` (previously they pointed at a no-argument `init`, which resets the other keys).

### De-initialization (reset)

`opencode-auto reset [dir]` de-initializes: it precisely removes the **config layer** artifacts
init wrote (the enumerated whitelist below), clearing config leftovers that would
otherwise interfere with the opencode host program and other extension components. The removal is exact
for the whitelist, not the whole uninitialized worktree — the project brief and a materialized intent
bundle's landed files survive it (their rows below).

Cleanup scope (an enumerated whitelist — no globs, no recursive deletion):

| Target | Action |
| --- | --- |
| `.opencode/auto/config.json` | Deleted |
| `.opencode/auto/brief.md` | **Kept unconditionally** — an installed approved proposal or a person's `amend --brief` write (human intent, not an init product; the printed list says so); delete it by hand if you mean to |
| `.auto/config.json` | Deleted (the legacy leftover config holding only `mode`) |
| `.opencode/agent/auto.md` | Deleted (`init` already overwrites it unconditionally from the template — a pure auto product) |
| `opencode.json` | **Deleted only when byte-identical to the built-in template**; if edited it is kept and the list explains why |
| `AGENTS.md` | Only the `opencode-auto` marker block is removed, the rest of the body kept verbatim; if only a hollow heading is left (i.e. the file was init-created in the first place) the whole file is deleted |
| `.gitignore` | Only the entries init wrote are removed (`tmp/`, `.auto/`, the local-only files `/.env`/`/AGENTS.md`/`/.opencode/auto/models.json` and the entries for existing nested git repositories); user-owned entries are kept — including, on a project initialized before plans/0138, the retired `/.gitignore` and `/opencode.json` lines (their retirement is `fix`'s rule); if the file is empty after removal it is deleted entirely. The model registry project layer `.opencode/auto/models.json` itself is not deleted (it belongs to the operator, not written by the driver) |
| `.opencode/auto/`, `.opencode/agent/`, `.opencode/` | **Reclaimed only when empty** (`rmdir`; skipped when non-empty) |

**Explicitly untouched**: `docs/` (including round directories `R-NN` and task directories `T-NNN`), all
runtime state in `.auto/` other than `config.json` (logs, `stats.json`, `resolves.json`, `progress.json`),
`tmp/`, and the git repository itself — a `.git` that `init` bootstrapped (auto-core plans/0073) is not a
config-layer artifact and survives `reset`; undo it by hand with `rm -rf .git` while it is still empty.
These are human and AI work products or run traces, not `init` artifacts.

Reclaiming only empty directories also preserves three things: your own prompt-override directory
`.opencode/auto/prompts/`, your other agent contracts under `.opencode/agent/`, and a materialized intent
bundle's landed files (the pack/mode/phase files and `provenance.json` — person-owned once landed, still what
`fix`/`sync`/`status` read and report; delete them by hand if you mean to).

Two gates run before execution (`-f`/`--force` skips both):

- **Clean worktree**: when the repository containing the target directory, or any nested
  repository/submodule in the tree, has uncommitted changes, exit code 1 with the files listed and nothing
  changed. git is the only undo mechanism — a dirty worktree means no undo.
- **Interactive confirmation**: print the full list first (including kept items and reasons), then ask once
  `[y/N]`. Off-TTY (CI, scripts) it executes without prompting — but the cleanliness gate still applies.

After `reset`, a fresh `init` produces byte-identical output to the first one. When the directory holds no
`init` artifacts at all, `reset` prints "no init artifacts found" and exits 0.

### The run lock and exit codes

The retired `run` options (`--server`, `--verbose`, `--interactive`/`-i`, `--wait-answer`, `--wait-between`,
`--permission`, `--dryrun`, `--boundary`, `--new-session`, `--max-sessions`, `--repair`) went with their
command (plans/0283): session shaping is the daemon's per-run switch layer now (its README documents the
`"switches"` a run request carries), and each of these flags appearing on a live command is a usage error
pointing at its dead owner. What stays this binary's truth:

**Only one driver process may work in a directory at a time** — the **run lock** `.auto/run.lock` (JSON:
pid `pid`, host `host`, command `command`, start time `started`). The daemon-side operations (plan,
transfer, clarify, the coordinator) hold the lock in their own process; `close` holds it around its writes
and `land` around its branch moves. While another process holds the lock, `init`, `amend`, `fix`, `sync`
and `reset` — they rewrite files a running driver reads — refuse with exit code `1` and name the holder
(`fix`/`sync --dryrun` read and print only, so they run beside a live run; `-f` does not step over the run
lock); `status` never takes the lock, and prints a live lock on its first line (`▶ close in progress
(pid 1234 on build-3, since …)`). A same-host lock whose holder process no longer exists (e.g. after
`kill -9`) counts as stale: the next command that takes the lock removes it automatically and prints a
one-line notice; a lock recorded on another host cannot be probed and always counts as valid (the daemon's
v1 boundary: cross-host recovery is deleting `<project>/.auto/run.lock` by hand). An unparseable lock file
also counts as valid — after confirming no process is running, delete `.auto/run.lock` by hand.

Exit codes (the protocol's shared vocabulary, this binary's commands and the daemon's runs alike): `0`
complete; `1` usage or environment error (the same code `fix --dryrun` answers with configuration
findings); `2` blocked or incomplete awaiting human intervention (including a task report whose result
line reads `Result: FAIL`); `3` the `/exit` pause at a safe boundary (no human attention needed —
re-running recovers fully); `130` force-terminated by two consecutive Ctrl+C.

### Parallel execution (`parallel` + `--max-sessions`)

The config keys stay constitutional (set at `init`, revised through `amend`); what retired with `run` is
the local push driver — width alone activates concurrent execution, auto-core plans/0125, and the width is
the daemon's run request (`maxSessions`) or an executor's claimed grants — a `parallel` level adding
code-phase planning depth and the landing-conflict posture, never permission. concurrent execution is active by width alone (auto-core plans/0125).

- **Tier 0, the default (`treeLanes: off` or absent)**: no worktrees at all. Documentation-scoped units run
  side by side as **doc lanes** in the main tree (auto-core plans/0099, the `## doc-parallelism` teaching of
  plans/0126 — their declared `Depends:`/`Touches:` is the admission); code task sessions run serially in
  the main tree, and the parallelism there is the test machinery — the project's test-lane table runs its
  suites as parallel driver processes against the frozen tree between the sessions' shares. Where the
  wall-clock actually goes, this is most of the win at zero disk cost.
- **Tier 2 (`treeLanes: on`)**: the full-worktree lanes of plans/0068, chosen knowingly.
- **Tier 1 (`treeLanes: auto`, probe-gated)**: the run's preflight probes the filesystem — reflink
  capability (btrfs/XFS) and the declared `lanes.treeBudgetMB` budget against the working tree — and runs
  the worktree lanes with cheap materialization when both allow: a `--no-checkout` worktree whose cone-mode
  sparse set over the unit's `Touches:` (plus `docs` and the declared `lanes.sparseFloor`) is copied in by
  reflink, byte-shared until divergence, with the declared `lanes.caches` cache homes injected per worker.
  No capability or budget exceeded — tier 0, reason logged.

Under tiers 1 and 2 each schedulable unit runs in its own git worktree — parked under the target's
`.auto/worktrees/` (gitignored, removed again at landing) on its own branch
`auto-lane/<task-id>-<digest>` (the digest is the first 8 hex of the target directory's realpath — the
branch namespace belongs to the repository's object store and fork arms share it, auto-core plans/0151 D2
and 0191 D5) — driven by a worker of its own. The parent keeps scheduling, state ownership and landings to
itself; the main tree is always clean between landings. Readiness is computed from declared facts only — a
unit is ready when its `Depends:` are done and its declared `Touches:` paths are disjoint from every
in-flight lane's; a unit without a `Touches:` declaration touches everything and always runs alone. Landing
is serialized in the parent — the lane branch is verified (only driver commits inside), merged
(`Auto-Stage: landing`), the index ticks re-derived (`Auto-Stage: landing-sync`), the worktree and branch
torn down; a conflict at `parallel: low` blocks naming the park path, at `medium`/`high` the lane is
re-dispatched once with a merge instruction, then blocks. The executor protocol's **scoped/doc lease
tiers** carry the same declarations-as-admission model for external workers (each claims grants in its own
worktree — the protocol's lease vocabulary in [docs/protocol.md](../auto-core/docs/protocol.md)).

- **Human surface**: one person cannot steer N sessions — the retired `--interactive`/`--wait-answer` were
  usage errors under width, and the interactive sideband retired with `run`. There is no `/exit` channel at width
  (and no push channel to exit at all, plans/0283 — the daemon's kill route is the force-terminate half). `status` lists in-flight lanes first while any are recorded, and the round conclusion carries a
  lanes roll-up line (sessions, tokens, summed lane wall beside the parent's wall clock).
- **The lane-log directory**: the driver-run lane and regression logs land under `/tmp/opencode/` — one
  global path every project and every fork arm shares. `OPENCODE_AUTO_LANE_LOG_DIR=<dir>` redirects this
  run's driver-run lane and regression logs (whatever the session count — the `--test-by-driver` channel
  and the regression lane included), every receipt `Log:` line naming the actual path — so one run's
  evidence never poses as another's; empty counts as unset, and an unset environment keeps the prescribed
  path byte for byte. Per run, never persisted; agent sessions never see the variable (the driver's env
  scrub), so a session-run lane's logs keep the prescribed default.

### The round lifecycle over the daemon (transfer, clarify, plan, tasks)

The person-bracketed boundaries are the daemon's operations — one boundary after another, each call
returning in seconds, no agent session spawned by the daemon (the pull-only operator loop; the daemon
package's README walks it in full, its `docs/daemon.md` documents every route):

```
POST /projects/<project>/transfer    # whatever the state holds: the next boundary step, stopped for you
POST /projects/<project>/clarify     # the release act: writes `Clarified: yes` into the one awaiting gate, commits
POST /projects/<project>/plan        # the no-agent planning routes (m mode's establishment shapes)
POST /projects/<project>/tasks       # task-add: one task at a time, the one-line title
POST /projects/<project>/executor/claim   # the executor workers' pull surface: the grants (execute, verify,
                                         # fix, formulate, distill, synthesize, audit)
```

- **Project start (no round yet)**: with the assisted analysis on (`OPENCODE_AUTO_ANALYSIS`, default) the
  first transfer opens `docs/analysis.md` — work with your agent on the analysis, the goals, one `Fork:`
  line per open decision, the `## Project brief` proposal and the multi-round `## Roadmap`
  (`- R-NN <phases> — <goal>` per round, or the single word `open`, the
  [open round](#open-rounds) kind), then release it: the clarify operation writes the whole line
  `Clarified: yes` and commits it (adding the line and committing by hand remains fully supported); the
  next transfer installs the approved brief verbatim and establishes `R-01` under the roadmap's line (the
  config `phases` value the fallback when no released line covers the round — the established line names
  its source). The analysis may also carry the optional `## Round briefs` section — one `### R-NN`
  subsection per round: a released proposal installs verbatim into `docs/R-NN/round.md` when the round
  opens. Without an installed proposal either shape stops at the **round-start gate**: review the setup,
  fill in `docs/R-NN/round.md` (`## Goal`, `## Acceptance criteria`, `## Release criteria`), and commit —
  the commit is your veto.
- **The review seam and the grants**: the transfer operation constructs each phase's formulation floor
  (the formulation todo, driver-owned, built from the round brief and the phase's `plan-input.md`) and
  stops for review. A constructed todo is reviewed, never edited — a rejection is fixed through its inputs
  and the re-run reconstructs (the resynthesize request field re-voices a rejected synthesized ledger).
  Then the work is **pulled**: an executor worker claims the formulate grant (the planning session writes
  the phase's tasks), later the planned tasks' execute/verify/fix shares — a different token performing
  the verification. FAIL verdicts surface as state; the fix grant repairs verify FAILs (the CLI's
  `run --repair` budget retired with the command).
- **Phase boundary and round close**: at the boundary the distill grant produces the handover, then the
  transfer operation applies — the completion, the phase close, the next phase's floor (a deterministic
  apply: git and document writes only). When the closed phase was the round's last, the same invocation
  performs the **round close** and stops there (the round-close checks — whole-tree scan, build if
  configured, `## Close` filled — gate it, exit 2 while they fail): your natural moment with the round's
  `## Close` listing before committing to the next round. The next transfer opens the next round from the
  roadmap's line; past its last planned line the stop names `## Roadmap` of `docs/analysis.md` as the
  document to extend.
- **The re-derivable tail**: a round's unstarted phase tail is reshaping state, not commitment: every
  round reshapes by moving or adding its `- R-NN <phases> — <goal>` line in `docs/analysis.md`
  (`amend --phases` is retired, the config key init-stamped machinery), and the next transfer re-derives
  the tail from it on the driver's own `phase-sync` commit before constructing. Where the line's phases
  diverge from the key, `status` and `fix` record it as an informational note — nothing to repair; an
  agreeing line prints nothing.
- **Questions are recorded, never asked**: the pre-execution sessions (planning, distillation) are told
  never to ask non-permission questions — a session takes the recommended option as a provisional
  default, records the question in the affected task documents and continues; the record stays for your
  considered answer (the round conclusion's proxy-answer summary counts every such question, and
  `driver-helper` renders the standing list on demand).
- **The retired CLI surfaces and their channels**: `plan --append` (the task-append session) — appends
  ride task-add and re-formulation; `plan --new-task` — the daemon's task-add operation carries the
  one-line title; `plan --export`/`--adopt` (the standalone work orders) — the executor protocol's grants
  carry the work to external agents; `plan --force-close` — `close` then the plan operation is the
  close-then-continue pair; `plan -p`/`--file` — the planning input's home is the phase's
  `docs/R-NN/P<nn>-<type>/plan-input.md` (your own coding agent edits it directly; the active intent
  pack's `## planning-input` section carries the scaffold); `transfer --resynthesize` — the transfer
  operation's request field. Each flag keeps its owned refusal on every live command, pointing at the
  channel that replaced it.

### Open rounds

A roadmap line whose phases slot is the single word `open` — `- R-05 open — <goal>`, nothing beside it —
establishes an **open round** (auto-core plans/0243): the light maintenance kind, for the work that comes
back after a project ships (bug fixes found in application, small features, debugging). Where a phased
round carries the full ceremony — a formulation floor per phase, a handover distillation per phase, a
boundary stop per phase — an open round carries none of it:

```
POST /projects/<p>/transfer   # opens the round under its `open` line: single P01-implement, round.md
                              # pre-seeded with the line's goal — review and commit (the round-start gate)
POST /projects/<p>/tasks      # per issue: one task at a time, the one-line title ("fix the login crash…")
# the claimed grants execute each task (verification session + unified commit as anywhere);
# the round stays open between issues — no handover, no boundary stop
POST /projects/<p>/transfer   # when the window is done: fill the `## Close` of docs/R-05/round.md, commit,
                              # then this op closes the round (round-close checks gate it) and stops with
                              # its listing; the next transfer opens the next roadmap line (or the
                              # exhausted stop)
```

- **The kind, not a mode**: `open` is a round kind in the roadmap grammar (the one reshape channel,
  plans/0137) — never a phase type (`open` beside other tokens is a release problem the analysis flow
  names; a custom phase type named `open` is refused at load). The scenario *prose* for maintenance work
  rides the mode layer instead: `amend -m debug|fix` (see [Mode layer](#mode-layer--m--mode)).
- **What stays**: everything per-task — the execute session, the independent verification session, the
  bounded fix loop, the unified commit, the regression boundary between units, work orders, the retry
  fork. The round's index records its kind (`Kind: open` in `docs/R-NN/phases.md`, write-once); the round
  never drifts (its single implicit implement phase is the kind's definition); `status`, `driver-helper`
  and the AGENTS.md guidance teach the open channels in every open-round state.
- **The close is the person's**: the transfer operation on an open round refuses while work is pending or
  nothing is listed (naming the task-add operation); the filled `## Close` of `round.md` is the close
  intent — the round-close checks gate it (build, the restatement listing), the completion rename and a
  `phase-transition` commit scoped to the round's own close surface land it, and no handover distills. A
  released `### R-NN` round-brief proposal beats the pre-seeded goal and installs verbatim at the open, as
  for any round.

### Closing units (close)

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
  record, session handover).
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
- **Close-then-continue**: the former `plan --force-close` (close a unit, then keep planning in the same
  process) retired with its command (plans/0283) — the pair over the daemon is `close` then the plan
  operation, and `--force-close` on any live command answers the retirement notice pointing at exactly
  that. Typical uses, re-keyed:

```sh
opencode-auto close T-005 <dir> --reason "direction changed"   # swap out a task; then the task-add operation adds its replacement
opencode-auto close R-01.P02 <dir> --reason "skipped this round"   # skip the phase; the next transfer constructs the next phase's floor
```

### Branch isolation and landing (isolate, land)

A nested deliverable repository (say `opencode/` inside the driven root) that the driver commits into per
session would receive one driver commit per session on whatever branch of it is checked out — unusable
history for an upstream/PR-workflow repository. **Branch isolation** (auto-core plans/0074, ruled
2026-10-04) fixes that by changing only which branch is checked out: the constitutional key `isolate`
designates nested repositories (the config table above; `init`/`amend --isolate <rel-path>`, repeatable —
the list replaces the stored one, `none` removes the key), and when a round is established (the daemon's
transfer operation in a phased project, its plan operation in `m` mode), each
designated repository that is clean is checked out on a round branch `auto/R-NN` created from its current
HEAD. Every per-session unified commit, rollback, baseline and foreign-commit check then lands on
`auto/R-NN` exactly as before — the commit machinery is untouched, and **the original branch never moves**.
A dirty designated repository at establishment blocks (exit 2) naming the repository and its paths; lane
branches (`auto-lane/*`) live inside whichever branch is checked out, so lanes work unchanged on the round
branch.

`opencode-auto land [dir] [--keep] [--abandon] [--merge] [--onto <branch>]` is the person-invoked **return path**: land each
designated repository's round of work back onto its original branch **as one commit**, then delete the
round branch and print the landed SHA.

- **Default squash-one-commit**: `git merge --squash auto/R-NN` plus one commit (subject
  `land auto/R-NN: N commit(s) of round R-NN`, no `Auto-Stage` trailer — it is the deliverable's own
  history entry, not a driver session commit). `--merge` is the explicit alternative: a true merge commit
  (`git merge --no-ff`), the round's commits entering the original branch's history as themselves.
- **`--keep`** retains the round branch — the mid-round landing: whatever was checked out before the
  landing (normally `auto/R-NN` itself) is checked back out, and the round simply continues on it; a later
  `land` recognizes the previous landing and folds only the new commits.
- **`--abandon`** is the undo path, after a person-reviewed reset: it checks the original branch back out,
  deletes `auto/R-NN` (its tip printed — the work stays recoverable via `git reflog` until collection) and
  lands nothing.
- **The original branch is derived, never guessed** (auto-core plans/0192): the establishment's own
  checkout wrote `moving from <original> to auto/R-NN` into the repository's HEAD reflog, and land reads
  that record — so a second ordinary branch beside the original (a `dev`, any feature branch) never
  blocks the landing. When the record cannot answer (reflogs off or expired past the establishment, or
  the record's branch deleted or renamed since), the floor — exactly one local branch besides the
  driver's `auto/R-<n>`, `auto-lane/*` and `auto-fork/*` families — answers; and `--onto <branch>` names
  the original outright, one branch name for every designated repository (composing with `--keep`,
  `--merge` and `--abandon`). The refusals teach `--onto`, never branch surgery.
- **Refusal is never an automated merge resolution** (exit 2, the reason naming each repository): the
  original branch moved since isolation, foreign commits (no `Auto-Stage` trailer) mixed into the round
  branch's range, a dirty repository, or an original branch no derivation could name — a record naming a
  deleted branch blocks naming it rather than landing onto a different one. Every refusal is checked for every
  designated repository before any landing starts, so a mixed set lands nothing; settle the named problems
  and re-run — the command is re-runnable (an already-landed repository no longer holds the round branch
  and is skipped). Exit codes: `0` landed; `1` usage error; `2` blocked for human.
- **The audit-trail trade-off is stated, not hidden**: during the round the per-unit record lives in the
  working repository + the isolated branch; after `land` the deliverable's history holds one commit, and
  **the full per-unit trail remains in the driven root's git** — the 0064 record model (the driven root is
  the process layer of record; the deliverable repository is the person's to curate).
- A leftover `auto/R-NN` from an abandoned run is **recoverable state, not corruption**: preflight warns
  about unlanded round branches of earlier rounds (naming the land-by-hand and branch-delete addresses);
  `land --abandon` (the current round's branch) and plain git both address the rest.

`land` holds the run lock around its branch moves — run it when no daemon operation is live, exactly like
`close`; landing mid-round is allowed under `--keep`, and the round's sessions keep committing to the
retained branch.

### The retry fork (fork, remove-fork)

`opencode-auto fork <T-NNN | sha> <worktree-path> [dir]` (auto-core plans/0128) builds an **experiment
environment**: a new worktree outside the project — at the state *before* a task first started (a task
target `T-NNN`, the parent of the repository's oldest `Auto-Task: T-NNN` commit, interrupted earlier
attempts included in what is left behind) or at an exact commit you name (a sha) — where a retry runs
without the main tree, its branches or its history being touched in any way. The scan is bounded at the
task's **corpus** (plans/0140): task numbers never repeat within a corpus, but a reset-and-restart over
retained git history re-issues them — the derivation reads the current corpus alone (bounded at the
newest commit that added the task's `docs/T-NNN/todo.md`), so a re-issued id never forks at the state
before the restart, and the success line names the older lineage when one exists. Nested repositories
are reconstructed alongside as their own worktrees, aligned at the state the fork commit's
`Auto-Nested` lines record. The environment is self-resetting (`.auto/` is gitignored, so no runtime state rides
over; the task documents at that commit already read pending); drive the retry from the daemon (register
the fork's worktree as its own project, or claim its task's grants from there — the `--stop-after`
guardrail retired with `run`, plans/0283) and bring work back with plain git. One branch family `auto-fork/<target>` is created (first-free suffix across every
repository of the fork). It takes **no run lock** (plans/0129 — its only writes in the source
repositories are the reserved branch family and worktree registrations, surfaces a running driver never
reads), so it runs beside a live run there.

`opencode-auto remove-fork <worktree-path> [dir] [--force]` (auto-core plans/0139) is the teardown —
the retry loop's other half: every worktree of the fork removed (its nested repositories' first, the
root's last) and the one `auto-fork/*` branch deleted in each of its repositories, so the path is free
**and the stem branch name is free again** (a leftover branch would push the next fork of the same
target to `-2` forever). The branch tips are printed before deletion and stay recoverable via
`git reflog`; committed experiment work is discardable by design. The record it reads is git's own
(the worktree registrations and the branch family — nothing is ever persisted about a fork), so the
path must be a registered worktree of this project on an `auto-fork/*` branch: a lane park, a person
worktree or a stranger path is refused (exit 1), never touched. **Uncommitted work in the fork blocks**
(exit 2) naming the files per member — commit it or bring it back by hand, or re-run with `--force` to
discard it explicitly. A run live inside the fork refuses (stop it first; P20 — in-flight work is never
destroyed mid-run). Like `fork` it takes no run lock in the source. Exit codes: `0` removed / `1` the
path is not a fork of this project / `2` blocked — the live run, the uncommitted work, or a git failure
midway (the removal is resumable by re-running: an already-removed member is seen and skipped).

### Manual prompt suite (install-prompts)

`opencode-auto install-prompts [dir]` resyncs the **manual prompt suite** into the target's
`prompts/` (auto-core plans/0093): the executor protocol's manual floor — `executor.md`, the
runbook a coding-agent session claiming grants over the daemon's executor routes reads. The
push-era runbooks (`run.md` the master control and its children, the subtask pipeline, the append
planner, the charter discussion runbook) retired with the push CLI (auto-core plans/0296). The
command **requires an initialized project** and takes exactly one option, `--check`.

- **Byte-identical overwrite is the point**: every suite file whose content differs is rewritten, an
  already-identical one is left untouched, and files in `prompts/` the suite does not carry are
  **reported and never deleted** — local additions are yours.
- **The vintage pin (plans/0164)**: the resync also writes `prompts/MANIFEST` — every suite file's
  digest plus the suite-level digest of the installed revision. Commit the manifest alone and the
  target proves which suite drives it; `install-prompts <dir> --check` is the read-only gate over the
  same facts (drifted/missing files, the manifest's state), exit `0` clean and `1` on any drift — run
  it before handing a target to a session that reads the suite.
- **No run lock, no git**: the automated driver never reads the target's `prompts/`, so the command
  writes nothing a running driver reads and runs beside a live run; and it runs no git command — the
  suite is tracked content in the target, so you review and commit the resync.
- Exit `0` on a completed resync (an already-current suite included), `1` on refusal or write failure;
  `--check` exits `0` clean and `1` on drift, writing nothing.

### The person-proxy brief (driver-helper)

`opencode-auto driver-helper [dir]` renders the **person-proxy brief** (auto-core plans/0105): the
context a coding-agent session needs to act **with the person's pen** at a boundary the automated
driver deliberately leaves to them — the round-start gate (the round brief is the person's own
writing, 0107), a held survey's `Fork:` lines, a phase's planning input, a blockage document's
`Choice:` line, a failed task's accept-or-rework. The third rendered role beside the manual
suite's driver (install-prompts) and an executor's claimed-grant session (the grants the external
workers pull): the brief is generated **from live state** — the same
predicates and stop-line emitters the terminal prints — so it can never be stale and never misname
the role, unlike a hand-drafted paste-prompt.

The brief is six blocks: **ROLE** (the proxy pin — the session never takes the driver's seat and
never the executor claimant's role of `prompts/executor.md`, which is reference material, not the
execution
path; and its mandate is the person's instruction alone — every stop a command reaches is a report
point, never a runway, 0107), **PRIMER** (the driver's working model), **STATE** (the live facts plus the stop's own
lines), **CHANNELS** (the person-owned documents open at this state, each with its grammar and its
commit ownership), **POLICY** (the assist rule, the state's recorded defaults — held forks'
`Recommend:` lines, the round report's needs-attention section — and the stop-and-ask boundary) and
**RECOVERY** (the exact commands, with the brief's own dir argument). A healthy mid-state renders
the rhythm brief (the claimed grants execute; the boundary follows) — the command is consultable at any moment,
not only at stops.

- **Read-only, stdout, flagless** (the `plan --scaffold` precedent): nothing is written into the
  target, exit `0`; nothing is parsed back — the driver's own advances gain no inputs, and the proxy's
  writes land only in the person-owned channels that already exist.
- **No run lock**: a live lock is *reported* in the brief (write nothing while it holds), never
  refused on — the brief is exactly the thing a person reads while a run sits blocked.
- The state is keyed on the config: an unloadable config refuses with exit `1` (fix the config
  layer first); the round-close checks run without the config build (the brief says so when one is
  configured — a brief must not run the target's build).
- The trust model is unchanged: the proxy holds the person's pen under the backstops that bound any
  session (protect, the clean-tree start gates, the close-out SHA audit, the P1 and containment
  scans). The tool renders; the person pastes the brief into the coding agent of their choice.

## opencode server and agent selection

### opencode server: default auto-start and auto-restart

By default a run **auto-starts** an `opencode serve` child process (requires the `opencode` CLI on PATH; the daemon's runs do this)
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
   (read-only during a run), so this path only triggers when the file is changed externally mid-run.

With an external server the instance is not managed by this tool: in the two situations above it only prints
a notice and does not restart (network errors still retry in a new session); starting, stopping and
repairing the external instance is the user's responsibility.

### Agent semantics and selection

The `agent` key selects the **coding agent that drives the sessions** (`init --agent opencode|claude`, M6.1):

| Choice | Description |
| --- | --- |
| `opencode` (default) | Managed or reused `opencode serve` (see above), the full capability set |
| `claude` | Claude Code headless (`claude -p --output-format stream-json`, requires the `claude` CLI on PATH); one child process per working session, `--server` ignored. Missing capabilities (fork, questions, …) are degraded automatically at run start and printed one by one. The `opencode.json` `permission.external_directory` posture — the working-directory knowledge boundary, the root-symlink read-only stamps, a sealed wall's standing deny — reaches no claude session (auto-core plans/0190): `status` renders the limit, and a project that declares a wall refuses to seal under claude (advance the sealing boundary under an agent that carries it, e.g. `OPENCODE_AUTO_AGENT=opencode`) |

Precedence: the shell profile's agent > the environment variable `OPENCODE_AUTO_AGENT` (per-run override;
empty string = no override) > the config's `agent` key > `opencode`. Every session (including the `m`-mode
planning session) is started by the driver and uses that agent.

The **agent contract** is always `.opencode/agent/auto.md`, generated and maintained by `init` (no longer
optional since M6.1; the old `--agent <name>` contract-name semantics are retired): a non-interactive work
contract — strictly do only the current role, treat state files as read-only, verification execution rights
belong to the driver, permission questions go through the question tool while everything else is decided
autonomously with the decision process recorded. opencode uses it as the session agent; claude appends its
body to the system prompt and translates `opencode.json`'s permission rules into claude settings —
except `permission.external_directory`, which has no claude translation today (auto-core plans/0190:
the knowledge boundary and the wall's standing deny are opencode-session facts; a declared wall's
close refuses under claude). When the
contract differs from the built-in template, `init` / `amend` / `fix` always replace it with the latest
template, and a run prints a refresh hint at startup when it spots a mismatch; a missing file is caught by
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
  removes only the entry and never deletes the file itself, and during a run it is read-only alongside the
  other configs; a project layer git does not ignore (or already tracks) is refused at run start
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
handover, knowledge/prior-knowledge and one-shot bypass sessions are simple; task
sessions (whole-task, subtask) use the **phase type's execute tier** — among the builtin types a analysis /
d design / v acceptance are deep, m implementation / t test / k knowledge distillation are simple, and a
custom type reads its type file's `Reasoning: deep|simple` field (default deep, versioned with the
project). **Borrowing** is one-way: a simple session whose simple list has nothing available continues down
the deep list (availability beats cost); a deep session never borrows simple — it waits, because depth is
the reason it exists. `routes` is the operator's override: keys are role words / phase type ids / preset
letters (precedence as in `OPENCODE_AUTO_MODEL`'s key syntax; `*` is not allowed — the tier lists themselves
are the default), values are a tier name or an ordered list of internal names. A retired role word is a
permanent tombstone: it is refused with the ruling that retired it, and the remedy is removing the route
entry.

Every dispatch takes the **first entry available right now** from the candidate list: past the agent
filter, inside its window, not down-marked, its provider's key ring (if any) still has a key that is not
held (a stated reset to its instant, an unstated failure for five minutes), and
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
reference only (`key 2/3 ZHIPU_KEY_B`). **Rotation is a managed server restart**: the landed key goes into
the spawn config and the server restarts (sessions survive the restart); the failed session is forked and
resent on the **same model**. A key that fails **without stating a reset** is held for **five minutes** —
a short, person-ruled hold (ruled against measured 30–90-minute session lengths: recovery may be manual,
not only timed, so the key is re-checked soon rather than parked on a long invented schedule). A failure
that **states a reset** holds the key until the stated instant (provider-stated evidence; it survives every
failback boundary — boundaries never touch key state at all). Both searches are **order-first**: the
rotation search starts at the first declared key and lands on the earliest key with no evidence against it,
and **every new session walks the same order** — when an earlier key's hold or reset has passed, the ring
moves back to it and the managed server restarts before the session's first call, so a recovered earlier
key is retried at the next session without waiting for the current key to fail. Three gates bound the walk
(plans/0178): it only ever moves to an *earlier* key (a later key's passed hold never disturbs a working
current key), a consumed fork skips it (the fork rides the key path its seeding act chose — a rotation's
fork would otherwise undo the rotation under a short stated reset, the measured restart-per-failure
cycle), and a doc-lane session defers it whole (a restart would kill the sibling lanes' open sessions; the
recovered key re-preferences at the next serial moment). A key with no mark never triggers a walk (the
recovery probe's cleared ring stays on the key it tests). A refused rotation search (every other
key held) is applied too — the failed key is marked, the position stays. `/failback`
clears all key state and rewinds every ring to its first key; a successful probe likewise clears the key
state it tested. An external server (`--server`, a profile's `server`) cannot be restarted, so the ring is
inactive under it (the startup log says so). **No provider is listed as verified for key rings yet**: the
generic
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
| `OPENCODE_AUTO_MODEL_FAILBACK_SCOPE` | Unchanged | Clears model down marks (key state never clears at a boundary — a failed key carries a mark: a stated reset held to its instant, an unstated failure held five minutes) |
| `/failback [a b …]` | Unchanged | Arguments are internal names; wholly replaces every list from then on (same semantics as an override); also clears every key mark and rewinds the key rings to their first key |
| `OPENCODE_AUTO_AGENT`, the shell profile's `agent` | Selects the run's single agent | **Filter**: only models on that adapter are candidates. The config's `agent` (init `--agent`) is no longer a filter but the **default agent** — bare `provider/model` values and session records without an agent belong to it; a startup notice when no tier uses it |
| `--server` / `OPENCODE_AUTO_SERVER` | Unchanged | Overrides an opencode profile's `server`; the key ring is inactive under an external server, and the profile's `bin` / `env` have no effect on it |

The registry's effective table: see [Model registry overview (models)](#model-registry-overview-models).

### Experiment switches (`OPENCODE_AUTO_*`)

The run reads one layer of environment-variable switches: per-run experiments, never persisted to
disk, parsed once at run start (an invalid value is a usage error, exit code 1; the empty string
counts as unset). This table is the complete person-facing reference — it follows the core's switch
registry, so a switch added there lands a row here in the same change (this package's docs-truth
census holds the two together). Run start lists the non-default switches on one `⚙` line; `--verbose`
shows the full set. Switches whose `off` is an emergency exit say so.

| Variable | Default | Governs |
| --- | --- | --- |
| `OPENCODE_AUTO_AGENT` | unset | Per-run coding-agent override (`opencode` / `claude`) over the config's `agent` key |
| `OPENCODE_AUTO_ANALYSIS` | on | The first-run assisted project analysis; `off` establishes `docs/R-01/` directly (the scripted-flow escape hatch) |
| `OPENCODE_AUTO_ASK` | off | Question policy: `off` decides autonomously and marks divergences AUTO-RESOLVE; `on` asks the person at decision points |
| `OPENCODE_AUTO_DECOMPOSE_FINE` | off | Fine-grained decompose criteria in the decompose templates |
| `OPENCODE_AUTO_DOC_LANES` | on | Doc lanes — concurrent documentation-scoped pipelines at tier 0; `off` runs the serial loop (the emergency exit) |
| `OPENCODE_AUTO_FORK` | on | The fork pipeline behind `subtask: auto` (the understand session and the split); `off` runs each task as one whole session |
| `OPENCODE_AUTO_FORK_BASE` | digest | The fork base: `session` (the understand session's tail) or `digest` (a fresh base session over the context digest) |
| `OPENCODE_AUTO_HIBERNATE` | unset | A daily UTC high-tariff window `HH:MM+H`; inside it the run sleeps at the next safe boundary |
| `OPENCODE_AUTO_LANE_ISOLATION` | off | Full worktree isolation, one lane at a time — the whole landing machinery, zero concurrency |
| `OPENCODE_AUTO_MODEL` | unset | Model override / staged routing for this run (key syntax; internal names under a registry) |
| `OPENCODE_AUTO_MODEL_FALLBACK` | unset | Failover candidates (no registry); under a registry a **usage error** — the tier list is the failover order |
| `OPENCODE_AUTO_MODEL_FAILBACK_SCOPE` | task | Where failback resets to the preferred model (`phase` / `task` / `subtask` / `session`) |
| `OPENCODE_AUTO_PARK` | on | The dependency park (`Status: park <blocker>`); `off` reads the park line as the invalid-handoff case it was (the emergency exit) |
| `OPENCODE_AUTO_RECOVERY_WAIT` | 30 | Wait-and-probe interval in minutes for session failures that exhaust the ladder |
| `OPENCODE_AUTO_REGRESSION` | on | The regression lane and its phase-close hold where the pack declares a regression-cost row; `off` launches nothing (the emergency stop) |
| `OPENCODE_AUTO_REMEDIATE` | on | Consented remediation (the blockage dossier and the `Choice:` executor); `off` returns the static behavior (the emergency exit) |
| `OPENCODE_AUTO_RETRY_WAITS` | 0,1,2,4,8 | The retry ladder for transient session errors, waits in minutes, the element count the cap; `off` = no retries |
| `OPENCODE_AUTO_STEER` | on | Session-handover context management (usage notices, `docs/T-NNN/handoff.md`); `off` is the floor — no notices, no handover demand |
| `OPENCODE_AUTO_STEP` | off | Step mode: hard-pause at `phase` / `task` / `subtask` boundaries, waiting for Enter |
| `OPENCODE_AUTO_STRICT_RESUME` | on | Interruption-recovery fidelity gates (baseline and model verified at resume); `off` is the emergency-off |
| `OPENCODE_AUTO_STUCK` | on | Stuck-loop detection (repeated-action hints, at most three per session) |
| `OPENCODE_AUTO_SYNTHESIS` | on | Formulation synthesis where the pack declares a plan charter; `off` forces the deterministic Stage-1 floor (the emergency exit) |
| `OPENCODE_AUTO_SYNTHESIS_TIMEOUT` | 15 | The formulation constructor's one-shot wall in minutes (a timeout degrades to the floor, never a failure) |

Retired variables (permanent tombstones): `OPENCODE_AUTO_REF_CHECK`, `OPENCODE_AUTO_REUSE_SESSION`,
`OPENCODE_AUTO_HANDOVER_CONCURRENT`, `OPENCODE_AUTO_TASK_CONTEXT` and `OPENCODE_AUTO_PLAN_VERIFY` (the
charter verifier retired with the push commands, plans/0283 — FAIL verdicts surface as state, the fix
grant repairs verify FAILs) — a set variable prints one
`⚠ … is retired` notice at run start and changes nothing; a notice, never a usage error, so a stale
shell profile cannot cost an unattended run.

Two registered names are not switches: `OPENCODE_AUTO_MODELS` (the registry's operator layer — a
file path, named by the registry's own startup lines) and `OPENCODE_AUTO_SERVER` (the external
server URL, `--server`'s env form). And two `OPENCODE_AUTO_*` names are the agent's own, not the
driver's: `OPENCODE_AUTO_SHARE` and `OPENCODE_AUTO_HEAP_SNAPSHOT` configure the opencode server
itself — the driver never parses them and its environment scrub passes them through.

## Execution pipeline

The driver runs a pipeline for every task, and **index ticks, the `todo.md` → `done.md` rename and
`.auto/units.json` are written by the driver alone**. How a task executes is decided by the project config's
`subtask` key (`off` is the default — changed from `auto` on 2026-10-04):

`subtask: auto` (adaptive decomposition; auto-core plans/0059): the task runs as one lead
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
stored `"subtask": "auto"` keeps this meaning with no migration; `amend --subtask off` returns to one whole-task
session per task.

`subtask: true` (the planned pipeline — what `auto` meant before auto-core plans/0059):

1. **Decompose** (when `docs/T-NNN/subtasks.md` has no checklist yet): one session analyzes the task and
   writes `docs/T-NNN/subtasks.md` (a Markdown checklist — the task's subtask checklist itself) plus each
   subtask directory's `todo.md`. Producing no valid file is retried once automatically with feedback;
   failing again blocks.
2. **Execute subtask by subtask**: all execution sessions within a task (decompose/subtask/repair/wrap-up)
   form one chain, and every prompt in the chain opens a **fresh session** (each prompt carries its full
   context and does not depend on the previous session's memory; in-chain session reuse was removed, and the
   former `OPENCODE_AUTO_REUSE_SESSION` knob is retired and ignored). Every session end
   unconditionally prints two stats lines: line 1 `◉ session ended: context n% (used/limit tokens), time X
   (cumulative Y / N turns)` (pure-AI time, accumulated across interruptions), line 2 the token breakdown
   (in/out/thinking/cache-read/cache-write/hit-rate/cost); sessions taken over by
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

`subtask: off` (splitting disabled — the **default**, changed from `auto` on 2026-10-04): one session completes
the whole task, then the common wrap-up runs; if
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
A `CURRENT.md` left by earlier releases (first line the heading it always wrote) is deleted at run
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
status (no session actually running); at startup a run resets all of them to `pending` and resumes normally
(`attempts` preserved) — no manual cleanup needed.

Recovery is grounded in the **progress record** `.auto/progress.json`: during a run the driver persists
`{task, session, at, active, phase}` at every stage boundary of the task pipeline — `phase` marks the
current stage (decompose / whole-task execution / subtask by subtask / wrap-up / result-line check), and an
execution-chain session is recorded live as `active` while it runs; one-shot bypass sessions such as dryrun
and fork bases write no record (they do not pollute the execution chain's memory). The record is deleted
when the task completes; the legacy `.auto/session.json` is read compatibly.

**In-session recovery** (session interrupted mid-flight with no way to summarize progress — kill/crash/
network failure): as long as the session still exists on the server, the driver simply **reuses it and
continues** (no context loss, isomorphic to `opencode -r <session-id>`, however long the interruption
lasted — this takeover is the one place a recorded session is resumed rather than opened fresh, and no
reuse knob governs it; the recovery log carries the
inherited context usage, and the recovery note is cleared after use — the next prompt returns to the normal
fresh-session rules); the first prompt carries a recovery note asking the AI to verify actual progress with git
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
`auto-rollback`); the log says how to retrieve it. Foreign commits you land between an unexpected
interruption and the re-run (a hand-commit protecting the in-flight work) are **adopted, not blocking**: the
interrupted session is never reused across them and never rolled back over them — the resume log names what
was adopted (per repository, the non-driver commit count since the recorded baseline) and a fresh session
continues from the current committed state. The same holds for the work you *don't* commit: an
active progress record (a unit left mid-flight by a kill, a crash, or an `/exit` inside the
recovery wait — e.g. a quota window having closed the session) makes the worktree's uncommitted
changes that unit's resumable progress — the run-start clean gate **exempts them** with one log
line, the resumed unit picks the batch up as it stands and its close commits it; a run paused and
resumed (the daemon's run lifecycle) needs no manual git work in between. The stop for a dirty tree belongs to the
*graceful-exit* rerun alone (no active record), where the worktree really is yours to clean. Exhausted network-failure retries count as "interrupted
mid-flight with no summary" and keep session-reuse eligibility — recovery prefers to reclaim the original
session.

During a run the driver makes opencode.json, `.opencode/auto/config.json`, AGENTS.md and the model registry
project layer `.opencode/auto/models.json` (when present; the driver reads it only at startup and never
writes it) read-only (chmod 0o444), temporarily restoring write access for its own writes and re-setting it
immediately after. When the run ends (including a blocked exit) they become writable again, for human editing
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
strictly; the model-routing role keys retired over the versions (`understand`, merged into decompose; the
verify-*/review-*/final-plan family; `number-recovery`) are permanent tombstones — in the registry's
`routes` and the `OPENCODE_AUTO_MODEL` entry list alike they fail with the ruling that retired them and the
remedy (remove the entry). Existing PLAN.md
files (with their `verify:`/`verified:`/`final:` field lines and `T-F<k>` tasks) have not been read since
M3.4; leftover `.auto/verify.md`, `.auto/review.md`, `tmp/verify.*` are not cleaned up.

## Test execution protocol (--test-by-driver)

`--test-by-driver` (a constitutional option, fixed into the config's `testByDriver` key by `init
--test-by-driver`; appearing at run time is a usage error — the key is init's) moves execution rights for "implementation-phase
commands that can run long or produce massive output — compile/test/build/lint and the like" to the driver.
It applies to execution sessions — subtask sessions (`subtask: true`, and the streams of `auto`'s split),
whole-task sessions (`off` / `ondemand`, and `auto`'s lead), and the verification loop's fix rounds; bypass
sessions such as decompose and wrap-up are out of scope (`--dryrun` does not enable it either). The channel
serves **code-work phases** — the `implement` and `test` phase types, or a custom phase type declaring
`Code-work: yes`; in any other phase (analysis, design, …) no marker machinery exists at all: a task there
that needs such a run has its session do it in-session (within the task's own rules), never through
`tmp/test.sh`. A marker left behind where the channel cannot serve it (a task document or gap list
instructing the protocol in a non-code-work phase is the known trap) is consumed at the session's close with
a log line — never left on disk to read as wiring — and a fix round that ends waiting on such a request
**blocks unbooked**: the round's budget is untouched and the message names the phase and the three exits
(run the check in-session, move the task to a code-work phase, or run the command by hand), then re-run.

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
historical handover content lives in the git commit records. The driver then opens a new session (the old
session's context was over the limit) and continues the task with
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

**Exception: the pre-execution sessions never ask, never proxy-answer.** The planning and distillation sessions run for the
pre-execution human review: their sessions are told to take the recommended option as a provisional
default, record the question in the affected task documents and continue — no AUTO-RESOLVE proxy
answers or markers, and the record stays for the person's considered answer after the fact (the
round conclusion's proxy-answer summary counts each; `driver-helper` renders the standing list on
demand). A session that asks
anyway is the backstop: it waits for a human answer (no timeout; `-i`'s resident input line or stdin)
and produces no proxy answers; an unreachable answer channel (closed input) or a repeated question
blocks for the human. The execute sessions keep the normal
policy.

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
changes**. Built-in mode files (auto-core package; plans/0243 A):

- `templates/modes/migrate.md` — migration/upgrade scenario: tasks arranged as "baseline confirmation →
  migration rework → regression verification" under the precondition that external behavior stays
  unchanged; the execution notes require old and new implementations to behave identically, compatibility
  layers to state their purpose and removal timing, and migration trade-offs to be marked per
  `AUTO-DECISION` requirements.
- `templates/modes/debug.md` — defect diagnosis scenario: tasks arranged as "reproduce → diagnose → fix →
  verify"; no fix before a failing reproduction exists or the cause is named; instrumentation removed when
  the fix lands; the diagnosis converted into a failing test the fix turns green.
- `templates/modes/fix.md` — known-issue fix scenario: one issue per task, the smallest coherent diff;
  every fix lands with its regression test; no refactors or dependency bumps riding a fix.
- `templates/modes/fork.md` — divergent-copy scenario: the divergence stays small, recorded and mergeable;
  every deliberate divergence a recorded deviation with its upstreaming disposition; the upstream-merge
  surface kept clean.
- `templates/modes/pr.md` — review-ready change-set scenario: the round's output is one coherent,
  self-contained change set; tests and docs planned with the behavior they cover; commit hygiene part of
  the deliverable.

The target directory's `.opencode/auto/modes/<name>.md` adds or overrides modes, file
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
amends it explicitly (precedence: explicit value > existing config value > default `migrate`); a run reads
and resolves it from the config and no longer accepts `-m` (appearing is a usage error). Additional
scenarios like `optimize` / `implement` / `test` are just files in the format above. A mode is scenario
prose only (plans/0079 §5): the light *work shape* for maintenance is the open round's (see
[Open rounds](#open-rounds)), not a mode's — `amend -m debug` switches the prose posture while an `open`
roadmap line carries the shape.

## Phased flow (--phases)

`--phases <admtvk subsequence containing m | phase type list>` (accepted by `init` alone — `amend --phases` retired, plans/0137; written to
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
the type id; it must not collide with a builtin type, a preset letter form, or a model-routing role word —
live or retired) and reference it by id in the type list:

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

- **brief.md**: the project brief `.opencode/auto/brief.md` (versioned, driver-written — person words
  through a driver-owned channel), consumed by
  every phase's planning session — the project's constants are just as needed in the k phase as in the
  a phase. The person's words reach it through approvals, never the pen: an approved `## Project brief`
  proposal replaces the whole file (the project analysis's release installs the provisional constants,
  every survey release the completed or revised ones — the latest approval is the entire brief;
  auto-core plans/0081 D11/D15, plans/0133 the lifetime ruling). The order at the start: the project
  analysis (`docs/analysis.md`) comes first — its release installs the provisional brief; init never
  writes a brief (`--brief`/`--brief-file` are retired on init, auto-core plans/0133 D9).
  `amend --brief <text> | --brief-file <path>` is the rare manual override, written verbatim; comments are stripped before injecting into the planning
  session, and a missing or comment-only file injects nothing. `reset` always keeps it. init starts no
  AI sessions and
  accepts no `-p` and no `--brief` (the brief is installed from the analysis's approved proposal or
  revised with `amend --brief`; the planning input's home is the phase's `plan-input.md` — see
  [Planning tasks with AI](#planning-tasks-with-ai)).
- **Migration source and target**: project facts, written into brief.md (e.g. "migrate `legacy/pkg`
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
  established at round start (the daemon's transfer operation establishes it: first round `R-01`, and
  `R-(N+1)` once the previous round closes — the same operation runs the round-close checks and opens the
  next; the plan operation does this
  in `m` mode); everything in
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
  new `--phases` value for `init` must have the completed phases (in index order) as a prefix,
  otherwise an error (exit code 1) — keeping
  the flow state derivable; once the current round is complete the guardrail lifts and the new value
  applies to the next round the transfer operation establishes (the plan operation in `m` mode).
  A compatible new value no longer rewrites the index on the spot: the difference between index and new
  value is left as **drift** for the advance to re-derive on its own commit (rewriting
  the not-yet-started tail of phase directories; a run meeting drift stops pointing at the transfer
  operation too — m mode never drifts, its single phase). An
  unparseable index line, an
  unknown or duplicated type, or a phase directory with both or neither of `todo.md`/`done.md` is likewise
  an environment error
  (exit code 1).
- **Manual rollback**: rolling back to a phase = (1) rename `done.md` back to `todo.md` in that phase's
  and every later phase directory (untick the index lines while at it, or leave that to the driver);
  (2) to resume one of the phase's tasks, rename its `docs/T-NNN/done.md` back to `todo.md`; (3) resume
  the run over the daemon. Derived state means rollback needs no dedicated code.
- The `v` (acceptance) phase carries the completion-side checking: v-phase tasks only verify and record,
  never repair; gaps found are reported through the task report's result line — `Result: FAIL` blocks and
  stops the run, with a person planning the repairs
  (see [Acceptance result line](#acceptance-result-line-result-passfail)).
- **Phase loop**: with `phases ≠ "m"` configured, the claimed grants execute the current phase's tasks
  and the run stops at its **clean phase end** — the handover distillation, the phase close and the next
  phase's floor are the transfer operation's (see
  [The round lifecycle over the daemon](#the-round-lifecycle-over-the-daemon-transfer-clarify-plan-tasks));
  every phase's work is pulled the same way — formulate, execute, hand over — until every phase is
  complete. All progress is derived from phase index/phase directories + task index/task
  directories (runtime state lives only in
  `.auto/units.json`):
  - **Planning**: a phase with no plan task yet gets its floor constructed by the transfer operation and
    its session pulled as the formulate grant. Planning is the
    phase's first task unit (since 0095, the driver-constructed formulation todo, `Auto-Stage:
    phase-formulate`): the **planning session**
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
- **Phase progress line**: a run's startup banner prints one progress line after the config summary
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
  task numbers **never repeat** among the target directory's task artifacts: the next available number is
  **derived from them** (the highest number any task index `tasks.md` lists or any `docs/T-*` path holds,
  + 1 — plans/0150; no record is kept and no recovery session runs), the phase planning session
  continues numbering from that derived start, and the driver validates that output reuses no occupied
  number and starts no lower than the derived start (a violation is invalid output — retried once
  with feedback, still failing as an implicit block with exit code 2). A fresh clone or fork worktree
  continues exactly where its own files say — parallel forks of one baseline assign the same numbers to
  the same logical tasks and stay comparable. A number whose artifacts were deleted becomes available
  again (docs are write-once by design, so deleting one is off protocol; a full restart already re-issues
  from T-001).

- **Opening the next round (the transfer operation, plans/0101)**: once a round's phases are all
  complete (the run stops at the round's last boundary, exit code `0`), fill in
  `docs/R-NN/round.md`'s `## Close` section (listing which decisions have been restated into the target's
  own documents and which
  losses are accepted) and commit, then call the transfer operation: the same invocation that closes the
  round's last
  phase performs the round close and stops there (your natural moment with the round's `## Close`
  listing — and its `report-for-user.md`, on the rounds you commission one — before committing to the
  next round), and the next transfer operation runs the round-close check (whole-tree P1
  scan, target build,
  `## Close` checklist; failing → itemized listing, exit code `2`, and nothing opens);
  passing, it establishes
  `docs/R-(N+1)/` — the phase index and phase directories expand from the released roadmap's line for the
  round (the configured `phases` the fallback), stopping at
  the round-start gate for review and commit;
  every step is idempotent, and re-calling the operation after an interruption finishes naturally. A released
  roadmap governs the sequence's end: past its last planned line the stop names `## Roadmap` of
  `docs/analysis.md` as the document to extend, never a silent config round. The new round's
  goal is to fill the previous round's gaps and close residual
  differences, not to redo finished work; the previous round's directory stays as-is (permanent once on
  disk). Change config across rounds with
  `amend` (the mid-phase guardrail refuses while the current round holds pending work, naming the
  boundary — the value applies to the round's unstarted tail at the next transfer operation, or to the
  round it establishes next once the current one is complete). The new
  round's first phase planning session gets an excerpt of the previous round's conclusions (the round's
  phase directory index + the last completed phase's handover document
  in full + the migration knowledge document in full); later phases use this round's handover distillation
  chain as usual. Rolling back a new round = delete
  the new round directory `docs/R-(N+1)/` and resume over the daemon, restoring the previous round's
  completed state. The `continue` subcommand is
  retired (appearing gets a message pointing at the daemon's transfer operation); `--continue` is not an
  option of any command (appearing errors with guidance).
- **Round derivation**: the current round = the largest `R-NN` round directory number under `docs/`
  (established at round start, no +1),
  zero new persisted state; a run's phase progress line carries the round annotation (above), and
  `status`'s tree starts with `R-NN`.

> The phased flow's P1..P4 are all wired in: from P3 the handover document is produced by the distillation
> session and injected into the next phase's
> planning session; from P4 the k (knowledge distillation) phase wholly adopts the former
> `--extract-knowledge` design (the knowledge-extraction session produces `kb.md` in the knowledge phase
> directory, failures not polluting the
> exit code). `--track-fixme` never landed — no CLI flag ever shipped — and is retired,
> permanently blocked by the completion-side retirement of the review flow it fed (0044 D1);
> the design record is `packages/auto-core/plans/0002-fixme-knowledge-design.md`.

## The AGENTS.md marker block

`init` / `amend` / `fix` idempotently sync a single opencode-auto marker block in the target
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
During a run AGENTS.md is read-only, and the agent contract (`.opencode/agent/auto.md`) equally forbids sessions
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
  a redundant view, and having neither or both is an environment error (a run refuses with guidance).
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
  the driver loads the index (tasks and phases exit 1;
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

The `init --implement-file` / `--implement-prompt` shortcuts are retired (auto-core plans/0053 D13), and
with them the `plan` command itself (plans/0283): either option on any command is a usage error (exit
code 1), the message pointing at the phase's `plan-input.md` — written with your agent directly, read by
the formulation grant (see
[The round lifecycle over the daemon](#the-round-lifecycle-over-the-daemon-transfer-clarify-plan-tasks)).
`init` starts no AI sessions and no longer defaults `subtask` to `ondemand` or `wrapup` to off because of
these options.

Planning under `phases = "m"` shares the same phase planning session with the phased flow (auto-core
plans/0053 D12):

- The input is stored verbatim as the phase directory's `plan-input.md`
  (`docs/R-01/P01-implement/plan-input.md`),
  committed on its own before the planning session; the planning session reads it as the "plan file"
  and writes the task index and each `docs/T-NNN/todo.md`, and the step lands through the task
  grammar's own commit ladder — the construct as `PLAN formulate` (stage `phase-formulate`), the
  session's share as its exec commit, completion as its wrapup/done commits (planning is the phase's
  first task unit since 0095; the older `Auto-Stage: phase-plan` no longer exists).
- Model routing keeps the `implement-scan` role; existing routing config needs no change.
- Numbering: with `autoNumber` on, continue from the derived next free number (the highest number any
  index lists or any `docs/T-*` path holds, + 1 — plans/0150); off, start
  after the largest occupied number.
- When the planning session is interrupted, the next run finishes this step first, then
  executes tasks; like the phased
  flow's planning step, it reuses the unclosed session.

## Model registry overview (models)

`opencode-auto models [dir]` read-only prints the **model registry**'s effective table; it starts no
agent and writes no file, so it takes no run lock and can run alongside a live run. The registry merges
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

Exit codes: no registry prints one line, exit code `0`; a registry a run would accept prints the full
table, exit code `0`;
problems a run would refuse at start (bad JSON, unknown fields, bad windows, a referenced
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
  resume the run from the block (re-claim through the daemon — the local `run` is retired, plans/0283).

## Security posture and boundaries

The guardrails this tool ships are accident prevention, not security boundaries — where a hard security
property is required it is stated as a requirement, never assumed from a guardrail (the design
constitution's boundary disclaimer, `packages/auto-core/docs/principles.md`):

- **Read-only protections** — during a run the driver makes the config files, the project brief, AGENTS.md
  and the registry's project layer read-only and restores write access at run end: a guard rail against
  accidental writes by the sessions it spawns; a same-user process can still bypass it.
- **Driver-run test scripts** (`--test-by-driver`) — bypass the agent's permission system as a convenience
  trade-off, equivalent to running the tests locally yourself.
- **The standing hard security requirement** — the secrets family: registry keys and env values are
  references (`{env:NAME}` / `{file:path}`), never literals, and logs, `models` output and error lines name
  the reference, never a value (see the model registry section).
- **The agent server** — the managed `opencode serve` child's lifecycle belongs to this tool (auto-start,
  restart, shutdown; see "opencode server and agent selection"); an external instance reused through
  `--server <url>` / `OPENCODE_AUTO_SERVER` is the operator's own to secure and repair.
- **The headless service shell** — the daemon behind `opencode-auto-server` carries its own operational
  security posture (the target-directory allowlist, token auth with scopes, the loopback-by-default bind,
  the POST-not-GET model probe); it is documented with that package (`packages/auto-server/docs/daemon.md`),
  not here — this CLI shares only the core with it.

<!-- auto: eof -->
