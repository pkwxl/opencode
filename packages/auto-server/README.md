# opencode-auto-server

The headless service shell of opencode-auto (`@opencode-ai/auto-server`, bin
`opencode-auto-server`): a resident daemon that runs the driver over HTTP —
start runs, watch them, answer their questions, and drive a project's
lifecycle, all without a terminal. It is a shell in the core/shell contract's
sense (`@opencode-ai/auto-core`'s `docs/shell-contract.md`): it imports the
core and Node/Bun builtins only, adds no runtime dependency, and the core
never knows HTTP. `docs/daemon.md` is the deep documentation of every route,
gate and status; this README is the landed shape at a glance.

```
opencode-auto-server register <dir>              # the whitelist (absolute)
opencode-auto-server token issue --scopes read,control,answer,config [--out <file>]
opencode-auto-server serve [--port 4770] [--host 127.0.0.1] [--data-dir <dir>] [--launch <confinement script>] [--env-file <declaration file>] [--open --root <dir> …]
# then: open the daemon's URL in a browser, paste a token — or talk REST.
```

## Topology: one daemon, one worker child per run — and many projects at once

The daemon is a single `Bun.serve` process. Every run is a **separate child
process** (`opencode-auto-server worker '<run request JSON>'`) that performs
exactly one `runAll` in one target directory and exits with the run's own
code — the daemon never imports the worker, never calls `runAll` itself. Two
facts of the underlying stack force this shape:

- **Environment memoization.** The core parses the `OPENCODE_AUTO_*` switch
  layer once per process and a `Bun.spawn` without an explicit env inherits
  the environment as it was at process start — per-run switches can only be
  applied safely to a fresh process. One run per process is what makes
  `"switches": { "OPENCODE_AUTO_…": … }` per-run instead of per-daemon.
- **Process ownership.** The run's exit vocabulary (below), its SIGINT
  discipline (a single press captured, a second force-terminates with 130)
  and its kill story are properties of the process running it. A child
  process gives each run its own pid to kill, its own crash containment, and
  its own exit code to observe; the daemon only maps what it sees. This is
  also why stopping the daemon does NOT stop live workers — they are
  self-sufficient, their state lands on disk, and the run lock arbitrates
  any successor.

**One daemon hosts many registered projects concurrently.** The one-run rule
is per *directory*: the registry refuses a second run on a project that
already has one live (409, retryable) and the run lock arbitrates against
every other driver process, but runs on *different* projects simply execute
in parallel — each in its own worker child, each under its own
`.auto/run.lock`. Combine with `--launch` (below) and each project's runs
land in that project's own confined environment.

At width ≥ 2 the worker itself spawns **lane children** — workers of this
same binary carrying a lane payload (the profile's `laneLauncher`
self-spawns them), one per schedulable unit in its own git worktree. The
whole lane family runs on this shell: a lane child holds its worktree's own
lock, writes the lane report the parent lands, and inherits the parent's
environment (its applied switch layer included).

The daemon's own duties around that: the whitelist and token stores, run
supervision and the exit-code mapping, the REST lifecycle operations (run in
the daemon process as library calls into the core — a synchronous
request/response with no session and no exit vocabulary of its own), the
read-only observability surface, the WebSocket interactive transport, and
the Web client.

## Hosting and lifetime — where the daemon must live

The daemon is an ordinary foreground process: it exits when its process is
killed and stops serving on SIGINT **without touching the workers**. That
makes it the right vehicle for runs that must outlive the shell that asked
for them — a driving agent's harness may reap its background jobs at any
time (process-tree- and cgroup-scoped reapers catch reparented processes
too, so `nohup`/`setsid` are not escapes), but the daemon's runs are
children of the *daemon*, and your interactions with the daemon are short
HTTP calls. Host the daemon where nothing reaps it:

- **a terminal you own** — the person's own shell knows no reaper at all; or
- **a container or service manager outside any job reaper's reach** — e.g.
  a detached container owned by a container daemon (processes the container
  daemon owns are not your harness's to reap). Bind the workspace at
  identical paths if the runs and their targets must see the same files.

Facts to plan around: the run registry is in-memory (run history does not
survive a daemon restart; pending questions do — the journal); workers
outlive the daemon's own stop and finish on disk; if the daemon dies
mid-run, that is the same scene as any killed run — the lock arbitrates and
the next run recovers, so re-host the daemon and re-run. Start the daemon
from an environment that carries what the runs need (PATH, the model
registry's referenced values — a launcher that forwards environment
references by name reads them from the daemon's environment).

## The confinement launcher — `serve --launch <script>`

By default workers spawn bare, inheriting the daemon's environment. With
`--launch <script>`, every spawned run — a plain run, a planning run, a
transfer advance — starts as

```
bash <script> <project-dir> -- <worker command...>
```

and the script owns the run's environment overlay and writable surface. The
daemon knows nothing of the launcher's mechanics; the contract is exactly
that invocation: resolve what the project needs (a sandbox, a per-project
container — whatever derives its confinement from the project argument),
**exec** the command after `--`, and let your exit code be the run's.

The pattern this exists for: **each project runs inside its own
container-based sandbox**. A launcher script that maps the project argument
to a per-project container (its own name, its own writable binds at
identical paths, its own scratch) gives concurrent projects real isolation
while the daemon stays the one control plane. Requirements the launcher
carries: the worker's WebSocket bridge URL must be reachable from inside
the container (host-network containers reach a loopback-bound daemon at
`127.0.0.1:4770`; wide runs carry no bridge at all), and
environment-referenced values (model-registry keys by name) resolve from
the daemon's environment — forward them by name, never by value in argv.

Caveats under a launcher: `DELETE /runs/<id>` signals the wrapper process —
what a kill means is the launcher's own (a container launcher's run may
outlive its wrapper; the run lock arbitrates any successor and the core's
interruption recovery heals the directory on the next run), and the run's
recorded pid is the wrapper's. Without `--launch`, nothing changes: bare
spawns exactly as before.

## The environment carrier — `serve --env-file <path>` (plans/0265)

The daemon's environment is the carrier the launcher (or a bare spawn)
reads; by default every restart re-derives it from the launching shell's
memory. `--env-file` makes it a durable declaration: `NAME=VALUE` lines
(`#` comments, blank lines, a later duplicate wins; values are literal
bytes) loaded at boot, **the file's names winning over the inherited
shell's** — resolved and validated at the serve command's own act, a
malformed line refused at its line number (never echoing the line's bytes:
a value may be a secret).

Beside it, every start pins the carrier two ways, names only — never
values: the effective environment's names (presence only, the
`OPENCODE_AUTO_*` switch layer excluded — it never reaches a child) are
written to `<data-dir>/env-manifest.json`, and the boot warns about names
the carrier **lost since the previous boot** (the diff against that
manifest) and about model-registry references that do not resolve at boot —
the discoveries that used to cost one blocked run each, moved to the boot
line.

## The surface

| kind  | routes |
| ----- | ------ |
| REST  | `GET /health`; `GET /runs`, `POST /runs`, `GET /runs/<id>`, `DELETE /runs/<id>` (kill); `GET /projects`, `GET /session`; the operations under `/projects/<p>/…` — `init`, `amend`, `fix`, `reset` (the config scope), `close`, `tasks`, `plan` (the dispatch surface: the standing plan task's session spawned as a run), `transfer` (the advance command: one person-bracketed boundary per invocation, spawned as a run) (control), `models` (GET the table; POST the probe — its own `probe` scope) |
| SSE   | `GET /projects/<p>/status` (the polled read model: the core's rendered status tree, commit-verdict completions, per-worktree git cleanliness, the lock), `/log` and `/events` (whole-line tails of the run log and the engine journal), `/status-events` (the typed driver-events stream with event-id cursoring) |
| WS    | `GET /runs/<id>/interactive` — the question channel and the control channel (`/exit`, `/failback`) multiplexed on one typed versioned protocol; the run's own bridge connects back to `GET /runs/<id>/worker` with a per-run secret |
| Web   | `GET /` — the client (plain TypeScript, no framework, no dependency), served from the package's embedded bundle; scope-aware over `GET /session` |

Every route but `/health`, the page and its script requires
`Authorization: Bearer <token>`: **401** unknown, **403** a known token
without the route's scope. Scopes: `read` (status/observability/models),
`control` (run control, kill, `/exit`/`/failback`, close/task-add/plan),
`config` (init/amend/fix/reset), `answer` (the question channel),
`probe` (the model probe alone — opt-in, carried by no default token set,
and beside the scope it takes an explicit `confirm` field and the
per-daemon 10-minute rate window). The plaintext token is printed once at
issue; `token issue --out <file>` instead writes it direct to a fresh 0600
file — never overwriting, never creating directories, nothing of the
credential on stdout.

## Executor preview

Issue a token with `token issue --scopes executor` to use the worker routes
for a registered, standalone Git project configured with `subtask: off`.
The first request starts a per-project coordinator through the same worker
launcher as a normal run, including `serve --launch` when configured.

Send JSON with POST to `/projects/<project>/executor/<operation>`. Every
request can include a `channel` string. Omitting it selects that token's
default channel.

| Operation | Body fields | Response payload |
| --- | --- | --- |
| `ready` | none | `menu` |
| `claim` | optional `role` (`worker` or `person`), worker-only optional `task` and `kind` (`execute`, `verify`, or `fix`) | `step` |
| `brief` | `task`, `kind`, optional `cursor` | `step` |
| `heartbeat` | `leases`, an array of `{ step, lease }` pairs | `menu` |
| `report` | `step`, `lease`, `outcome` (`ended` or `failed`), optional `note` | `step` |
| `release` | `step`, `lease` | `step` |
| `question` | `text`, optional complete `task`, `step`, `lease` tuple | `question` with `id` and `state: "raised"` |
| `answer` | `item`, `decision`, optional `rationale` | next eligible person `step` |

Successful responses include `protocol: 1` and the listed payload. The
`ready` response also includes `build` — the server's version and build
commit — so a stale daemon shows itself at the handshake (running from
source, the commit reads `dev`, never a fabricated value). Lease
deadlines use Unix milliseconds. After an ambiguous untargeted claim,
reconcile `menu.leases` with `ready` before claiming again. Retry a report
or release with its original step and lease. If a report was accepted
before an interruption, a later claim resumes settlement before new work
can be granted. A claim returns the specific block if settlement cannot
proceed. Verification requires a different token from the execute or fix
producer and a fresh agent context. A same-token claim over its own booked
report answers the terminal `settled`, naming the booked commit — that
token's work on the unit has ended.

Issue `person` for questions and release approvals or grant either separately
with `person-questions` and `person-releases`. The daemon derives these grants
from the bearer token. A person-only token defaults to a person claim. A
token with `executor` defaults to a worker claim and can request
`role: "person"` if it also has a person grant. Person claims return the oldest
eligible `question` or `human` step. Use its ID as `item` when answering.
The `ready` and `heartbeat` menus also carry `pending`, naming every pending
person item by `kind` (`question` or `gate`) and `id`, with question text only
when the requesting token's grant answers questions; gate proposals stay
behind the person claim.
Release decisions use `"approve"` and apply to the reviewed proposal. If the
proposal changes, the response offers a new item. Replaying a settled answer
preserves the original decision and returns fresh person work.

The live brief owner can follow `answerCursor` by passing its value as
`cursor` on the brief route. Send `null` to fetch from the beginning. A page
has `kind: "answers"`, an `answers` array, and a `next` cursor when more
answers are available.

Different projects can hold worker leases concurrently. Within a project,
use `ready` to see which task and step pairs the coordinator can offer. Use
a distinct channel for each concurrent worker. A worker may start only
after `claim` grants its lease and must stay inside the returned `workspace`
and task scope. The menu also carries a `types` block stating each work
type's restrictions — the standing prohibitions and permitted write surfaces
as machine-readable grammar, the person steps' authority vocabulary.
Provisioning against it is the operator's affair; the coordinator's
boundary checks are the authority either way.

Ready whole-task units with disjoint documentation-only `Touches` scopes
can share the project checkout. With `treeLanes: on`, ready code units with
disjoint declared scopes can lease separate Git worktrees. Use the returned
`workspace` again on takeover. The coordinator retains the workspace across
attempts and lands verified work or a dependency park in the main checkout.
Same-tree work and worktree work run in separate groups. Tasks without a
declared scope run alone. Worktree landing requires Git with
`merge-tree --write-tree` support.

### Create a project under a declared root

On Linux, start the daemon with `serve --open --root /srv/projects`. Repeat
`--root` to allow additional roots. Each root must already exist, be owned by
the daemon's user, and disallow group and public writes. Issue a bearer token
with `token issue --scopes projects` to authorize creation and initial
configuration under those roots. The route is disabled by default.

Send a JSON object to `POST /projects`:

```json
{"root": "/srv/projects", "name": "example", "config": {"subtask": "off"}}
```

Use the root's canonical absolute path and a single directory name. The
optional `config` object accepts the init configuration keys and defaults
`subtask` to `off`. A successful response returns HTTP 200 with
`{ "project": … }`. For an existing directory, use the operator's
`register <dir>` command.

After an interruption or an ambiguous response, retry with the same bearer
token, root, name, and configuration. The daemon initializes in private
staging under the declared root, publishes the directory without replacing
an existing entry, and checks its identity before registration. A matching
retry resumes the creation or returns the existing registration. If the
root, staging directory, or destination has been replaced, ask the operator
to inspect it.

## The whitelist

A run or project-scoped operation names a **registered project** — by its registered name
or registered absolute path — and the daemon resolves the target only
against the registry in its own data directory (`--data-dir`, default
`$XDG_CONFIG_HOME/opencode-auto/server/`). It never resolves an arbitrary
request path and refuses a `directory` field outright: this tool spends real
tokens and writes git, and `.opencode/auto/` overlays are injected verbatim
into prompts — one-click runs on arbitrary directories would amplify both.

## Per-run options

`POST /runs` takes `{ "project", "options"?, "switches"? }`. `options` are
the per-run `RunAllOpts` fields of the CLI's `run` (`verbose`, `waitAnswer`,
`waitBetween`, `permission`, `newSession`, `dryrun`, `maxSessions`,
`server`, `repair`, `stopAfter`, `boundary`); `switches` are per-run
`OPENCODE_AUTO_*` overrides applied to the worker's fresh process. **Never
config keys**: the constitutional keys — `intent`, `treeLanes`, `isolate`
and the hand-edited `lanes` table included — are frozen by `init`
(`.opencode/auto/config.json`) and a request carrying one is refused with
the frozen-flag message — revise them with the `amend` operation, never on
a run. `repair`/`stopAfter`/`boundary` ride plain runs only (the stop
conditions of the plan and transfer payloads carry no budget), and the
serial-path pair is refused up front: `stopAfter` cannot ride
`maxSessions ≥ 2`, nor can `waitAnswer > 0` — the width pairs the core
itself refuses at run start.

**Width (`maxSessions ≥ 2`) is served**: it activates the core's lane
scheduler exactly as the CLI's `--max-sessions` does — documentation-scoped
tasks run side by side at tier 0 (doc lanes, in-process), and under a
project config of `treeLanes: on|auto` code tasks run as worktree lanes
(each lane child a worker of this binary, landing serialized). One thing a
wide run does **not** carry: the interactive transport. One channel cannot
serve concurrent sessions (the core's own rule, the CLI's own width-run
shape), so the daemon attaches no bridge to a wide run — its questions take
the stdin-closed degradation path (a permission question blocks the run
with exit 2), and `/runs/<id>/interactive` answers 409 naming the rule.

The rounds' opening and advance commands: a phased project starts through
the **transfer operation** (the assisted analysis — the person and their
agent fill `docs/analysis.md`, its release opens R-01 — then the
formulation construction, the phase boundaries and the round close/open);
`plan` dispatches the standing plan task. In m mode the shapes are `plan`
and `run` (transfer refuses). Init points at the right one and writes no
brief — the analysis flow owns the start.

## The operator loop — one phase after another, from anywhere

The whole driving loop of a phased project maps onto short HTTP calls; each
call returns in seconds and the runs live in the daemon's workers:

1. **Start** — `POST /projects/<p>/transfer` opens the assisted analysis
   (its questions ride the interactive transport). The person (or their
   authoring agent) fills `docs/analysis.md`; `clarify` is CLI-side (below)
   or the manual `Clarified: yes` line releases it.
2. **Round open** — `POST /projects/<p>/transfer` again: installs the brief,
   opens the round, constructs the formulation plan task. `POST
   /projects/<p>/plan` dispatches the formulation session (its questions are
   the human's, over the transport).
3. **Execute** — `POST /runs { "project": …, "options": { … } }` with the
   shape you want:
   - the **whole phase** at once: no `stopAfter` — the run works through the
     phase's units and parks at the phase's close gate (exit 0) or holds at
     a human gate (exit 2);
   - a **concurrent wave** (two enumeration tasks, disjoint work):
     `"maxSessions": 2`;
   - a **single-task segment**: `"stopAfter": "T-005"`.
4. **Watch** — `GET /runs/<id>` (state, exit code, output tail);
   `GET /projects/<p>/status` (the status read model: units, git verdicts,
   the lock); `GET /projects/<p>/status-events?after=<id>` (the typed event
   stream, cursor-based — poll with the last id you saw); `GET
   /projects/<p>/log` (the newest run log). A terminal state plus its exit
   code is the completion notification.
5. **Boundaries** — gates and advances are the person's: answer questions
   over the transport or run `clarify` CLI-side; then `transfer` for the
   next boundary. Repeat.

Mixing the daemon and the CLI on the same project is safe — the run lock is
the arbiter whichever process takes it (a daemon run refuses while the CLI
holds the directory, and the other way around); short CLI commands beside
daemon runs are the intended shape, not a workaround.

## The exit-code vocabulary

The worker exits with the run's own code; the daemon maps it onto a run
state (a death by signal — e.g. a kill that arrived before the run installed
its handler — is `killed` too, with the signal recorded):

| exit | state      | meaning                                        |
| ---- | ---------- | ---------------------------------------------- |
| 0    | completed  | all tasks done                                 |
| 1    | failed     | run created, terminated with error             |
| 2    | blocked    | needs a human; re-running resumes              |
| 3    | paused     | the graceful `/exit` pause: progress persisted, a re-run resumes precisely — what a pause button produces |
| 130  | killed     | force-terminated (the double-SIGINT path — the daemon's kill) |

Exit 3 is reachable over the daemon's control channel (`/exit` over the
interactive transport); the kill (`DELETE /runs/<id>`) stays the
force-terminate half beside it.

## The pending-question queue

A question raised inside a run is answerable from outside the process: it
rides the interactive transport to connected clients, and it is **journaled**
— `<dataDir>/questions.jsonl`, an append-only JSON-lines journal (compacted
at each daemon start down to the runs that still hold open questions) in the
daemon's own data directory, never under a target's `.auto/` (whose writes
are driver-exclusive). A client that connects later is replayed the pending
set; a daemon restart restores every run that still holds an open question
(the `restored` state), so the orphan worker reconnects and the answer still
lands. The durable question lifecycle itself is the run's own event stream
(`question-raised`/`question-answered` in `.auto/run-status.jsonl`, served by
`/status-events`); the journal holds the daemon's half.

## v1 boundary

Single machine, multiple directories. The daemon binds `127.0.0.1` by
default (`--host` widens it at your own trust boundary), and stale-lock
detection is same-host only: a run lock recorded on another host counts as
live forever, because its pid cannot be probed from here. **Cross-host
recovery is: delete `<project>/.auto/run.lock` by hand** and re-run. No
automatic cross-host arbitration exists or is planned for v1.

## The honestly-absent surfaces

The daemon serves the run, config, units, plan-dispatch, transfer and
models surfaces above. These stay CLI-side (`opencode-auto`, the general
shell), stated plainly: `clarify` (the one-command release act — the
daemon's texts teach the manual path, "add the line and commit yourself"),
`sync` (the intent-bundle upgrade), `land` (branch isolation's return
path), `fork`/`remove-fork` (the retry experiment environment) and
`driver-helper` (the person-proxy brief). The `transfer` subcommand of this
binary exists (`opencode-auto-server transfer <dir>`) — every core text
naming it points at a runnable command — but it is the headless form: its
questions degrade the hand-spawned worker's way (a permission question
blocks, exit 2); answer questions over the daemon's transfer operation
instead, which attaches the interactive transport.

## Verification

`bun run typecheck` and `bun test` inside this package. The suites cover the
worker, the daemon and every operation over the fake `claude` CLI
(`test/fixtures/`), the Web client's built bundle, and the constitutional
guards: dependency isolation (`test/isolation.test.ts` — only
`@opencode-ai/auto-core` and Node/Bun builtins, asserted) and the
daemon-writes-nothing guard (`test/no-target-writes.test.ts`). The
cross-stack close-out e2e (`test/service-e2e.test.ts`) drives one sample
project through the whole surface in one unbroken run.

<!-- auto: eof -->

## Open project creation

Start the daemon with `serve --open --root /absolute/project-root`. Repeat
`--root` to allow other directories. Open creation requires Linux with glibc and a
filesystem that supports no-replace rename. Each root must be owned by the
daemon user and writable only by that user.

Issue a token with `token issue --scopes projects` and send
`POST /projects` with the canonical root path, a single directory name,
and optional init config. The full create-and-init operation uses the
`projects` grant. For example:

```json
{"root":"/absolute/project-root","name":"widget","config":{"subtask":"off"}}
```

The daemon initializes a private directory and publishes it before adding
it to the registry. An interrupted request can be retried by the same
token with the same project name, root and config. Existing directories
require the operator's usual `register` command. Review and commit the
generated init files before starting work.
