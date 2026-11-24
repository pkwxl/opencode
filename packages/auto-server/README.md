# opencode-auto-server

The headless service shell of opencode-auto (`@opencode-ai/auto-server`, bin
`opencode-auto-server`): a resident daemon that runs the driver over HTTP —
start runs, watch them, answer their questions, and drive a project's
lifecycle, all without a terminal. It is a shell in the core/shell contract's
sense (`@opencode-ai/auto-core`'s `docs/shell-contract.md`): it imports the
core and Node/Bun builtins only, adds no runtime dependency, and the core
never knows HTTP. `docs/daemon.md` is the deep documentation of every route,
gate and status; this README is the landed shape at a glance. The executor
protocol's standing specification is the auto-core package's
`docs/protocol.md` — the single source, enforced by the protocol-doc
ratchet (`test/protocol-doc.test.ts` in both packages).

```
opencode-auto-server register <dir>              # the whitelist (absolute)
opencode-auto-server token issue --scopes read,control,answer,config [--out <file>]
opencode-auto-server serve [--port 4770] [--host 127.0.0.1] [--data-dir <dir>] [--env-file <declaration file>]
# then: talk REST — the daemon serves coding agents only, no web client.
```

## Topology: one daemon, one worker child per run — and many projects at once

The daemon is a single `Bun.serve` process. Every project's executor
coordinator is a **separate child process** (`opencode-auto-server worker
'{"executor": true, "directory": …, "transport": …}'`) that serves exactly
one coordinator and exits with its own code — the daemon never imports the
worker, never drives the core's loop itself (plans/0282: the protocol does
nothing via push, ever again; the deterministic operations run in the
daemon as library calls). Two facts of the underlying stack force this
shape:

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

The push lane children are retired (plans/0283): the worker serves
executor coordinators only, and concurrency rides the executor protocol's
scoped/doc lease tiers — external coding agents claim grants in their own
worktrees.

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
from an environment that carries what the runs need (PATH included — a
launcher that forwards environment references by name reads them from the
daemon's environment).

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
environment-referenced values resolve from
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
manifest) — the discovery that used to cost one blocked run each, moved to
the boot line. (That boot check's registry-reference half — model-registry
references resolved at boot — is retired with the models surface, plans/0296:
the tool spawns no agent session, ever.)

## The surface

| kind  | routes |
| ----- | ------ |
| REST  | `GET /health` (liveness, plus the identity witness — the daemon's own `line` beside a fresh `checkout` read, their divergence the restart-owed staleness window, plans/0293); `GET /runs`, `GET /runs/<id>`, `DELETE /runs/<id>` (kill); `GET /projects`; the operations under `/projects/<p>/…` — `init`, `amend`, `fix`, `reset` (the config scope), `close`, `tasks`, `plan`, `transfer`, `clarify`, `reconcile` (the deterministic boundary operations — the protocol does nothing via push, plans/0282; `reconcile` the executor ledger's dead-letter reconciliation, plans/0287 (its booked non-landing class widened plans/0292), the booked-continuation re-derivation riding the same sweep, plans/0289) |
| WS    | the executor coordinator's bridge socket (the per-run secret the spawn carried) — the daemon serves coding agents only, never a web client (plans/0282) |

Every route but `/health` requires `Authorization: Bearer <token>`:
**401** unknown, **403** a known token without the route's scope. Scopes:
`read` (status/observability), `control` (kill, close/task-add and
the plan/transfer/clarify/reconcile operations), `config` (init/amend/fix/reset),
`executor` (the executor protocol),
`projects` (project creation) — five scopes; the `probe` scope is retired
with the models surface (plans/0296: the tool spawns no agent session, ever,
so no model is ever probed). The ask channel is gone (plans/0282): the
`answer`/`person` scopes are tombstoned, and a blocked coding agent
resolves its block itself — the person's gates are document-derived, their
acts document writes and the deterministic operations. The plaintext token is printed once at
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
| `claim` | optional `task` and `kind` (`execute`, `verify`, `fix`, `formulate`, `synthesize`, `distill`, or `audit`) | `step` |
| `brief` | `task`, `kind` | `step` |
| `heartbeat` | `leases`, an array of `{ step, lease }` pairs | `menu` |
| `report` | `step`, `lease`, `outcome` (`ended` or `failed`), optional `note` | `step` |
| `release` | `step`, `lease` | `step` |

Successful responses include `protocol: 0.1` and the listed payload —
`0.1` is preview: vocabulary may be added or removed while it carries (the
wire's standing specification is the auto-core package's
`docs/protocol.md`, enforced by the protocol-doc ratchet). The
`ready` response also includes `build` — the server's version and build
commit — so a stale daemon shows itself at the handshake. Running from
source, the commit is the resolved line (plans/0293): the tool tree's own
commit plus dirt at the bridge's spawn, `dev` only when git cannot name
the tree, never a fabricated value. `GET /health` carries the same
resolution twice — `line`, the daemon process's own captured at its
start, beside `checkout`, a fresh read of the tool tree — and the two
diverging is the source-mode staleness window (a daemon outliving its
checkout); its remedy is the restart, cheap by design: every recovery
re-derives from disk. Lease
deadlines use Unix milliseconds. After an ambiguous untargeted claim,
reconcile `menu.leases` with `ready` before claiming again. Retry a report
or release with its original step and lease. If a report was accepted
before an interruption, a later claim resumes settlement before new work
can be granted. A claim returns the specific block if settlement cannot
proceed. A successor using the same token and channel can use `brief` for
the original task and kind to recover a pending report’s exact step and
lease. Address the reported finding and retry the original report. If an
operator needs a project write operation while settlement is pending, the
409 response gives the coordinator’s stop route. Stop it with a control
token and retry the operation once the run is terminal.

Verification requires a different token from the execute or fix
producer and a fresh agent context. A same-token claim over its own booked
report answers the terminal `settled`, naming the booked commit — that
token's work on the unit has ended.

On a POSIX workspace host, start a resident hub for one work kind.
This example starts an execute worker.

```sh
opencode-auto-server executor-hub connection.json my-project build-lane execute /path/to/execute-agent
```

Supply a local connection file with `url` and an executor-only `token`.
Use one hub per token and channel. Its command starts a fresh process for
each grant in the granted workspace and receives the rendered prompt on
stdin. Exit zero when the turn ends or nonzero on failure. Child commands
must keep their writers in the spawned process group. Start verification
with its own command and a different token. The hub renews while the
command runs. SIGINT and SIGTERM stop the process group before settlement.
After an unplanned exit, stop any orphaned writers before restarting,
including when a lease has already expired. Pass `--resume` before the
connection file to recover a still-live grant after that check.

The ask channel is gone (plans/0282): no `question`/`answer` routes, no
person grants. A coding agent blocked mid-grant resolves the block itself
and records its decision in its artifact; the person's gates are
document-derived (the menu's `pending` names the awaiting gate and its
document) and their acts are the document writes plus the deterministic
operations (`clarify`, `transfer`).

## The whitelist

A run or project-scoped operation names a **registered project** — by its registered name
or registered absolute path — and the daemon resolves the target only
against the registry in its own data directory (`--data-dir`, default
`$XDG_CONFIG_HOME/opencode-auto/server/`). It never resolves an arbitrary
request path and refuses a `directory` field outright: this tool spends real
tokens and writes git, and `.opencode/auto/` overlays are injected verbatim
into prompts — one-click runs on arbitrary directories would amplify both.

## The pull-only operator loop — one boundary after another, from anywhere

The whole driving loop of a phased project maps onto short HTTP calls; each
call returns in seconds, and no agent session is ever spawned by the daemon
(the protocol does nothing via push, plans/0282):

1. **Start** — `POST /projects/<p>/transfer` opens the assisted analysis.
   The person (or their authoring agent) fills `docs/analysis.md`; the
   deterministic `POST /projects/<p>/clarify` (or the manual `Clarified:
   yes` line) releases it.
2. **Round open** — `POST /projects/<p>/transfer` again: installs the brief,
   opens the round, constructs the formulation floor todo and stops at the
   review seam.
3. **Pull the work** — an executor worker claims over the protocol: `POST
   /projects/<p>/executor/claim` with an `executor`-scoped token — the
   synthesize grant first when a charter declares one, then formulate,
   then the planned tasks' execute/verify/fix shares (a different token
   performing the verification).
4. **Advance** — at the phase boundary the distill grant produces the
   handover, then `POST /projects/<p>/transfer` applies: the completion,
   the wall, the transition, the next phase's floor. The round closes
   through the same op; the person reviews the close listing.
5. **Watch** — `GET /projects/<p>/status` (the status read model: units,
   git verdicts, the lock); `GET /projects/<p>/status-events?after=<id>`
   (the typed event stream, cursor-based); `GET /projects/<p>/log` (the
   newest run log).

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

## v1 boundary

Single machine, multiple directories. The daemon binds `127.0.0.1` by
default (`--host` widens it at your own trust boundary), and stale-lock
detection is same-host only: a run lock recorded on another host counts as
live forever, because its pid cannot be probed from here. **Cross-host
recovery is: delete `<project>/.auto/run.lock` by hand** and re-run. No
automatic cross-host arbitration exists or is planned for v1.

## The honestly-absent surfaces

The daemon serves the run, config, units, plan-dispatch and transfer
surfaces above. These stay CLI-side (`opencode-auto`, the general
shell), stated plainly: `clarify` (the one-command release act — the
daemon's texts teach the manual path, "add the line and commit yourself"),
`sync` (the intent-bundle upgrade), `land` (branch isolation's return
path), `fork`/`remove-fork` (the retry experiment environment) and
`driver-helper` (the person-proxy brief). The `transfer` subcommand of
this binary is retired (plans/0283) — the advance is the daemon's transfer
operation (`POST /projects/<project>/transfer`), a deterministic apply.

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

## The project lifecycle over REST

Creation is generalized beyond the retired `--open` roots (plans/0284): no
boot-time flags — the request itself names the directory to create. Creation
requires Linux with glibc and a filesystem that supports no-replace rename.
The destination's parent must exist, be owned by the daemon user and be
writable only by that user (the anchor's standing posture); the `projects`
grant that reaches the route at all is the trust boundary.

Issue a token with `token issue --scopes projects` and send `POST /projects`
with the absolute directory, an optional name (the basename by default) and
optional init config:

```json
{"directory":"/absolute/project-root/widget","config":{"subtask":"off"}}
```

The daemon initializes a private staging directory beside the destination
and publishes it without replacement before adding it to the registry. An
interrupted request can be retried with the same directory and config (the
staged creation is idempotent). Existing directories require the operator's
usual `register` command. Review and commit the generated init files before
starting work.

`DELETE /projects/<project>` (the same `projects` scope) removes a registry
entry: it refuses 409 beside a live coordinator or run (the stop taught —
`DELETE /runs/<id>`, the run id named) and beside a run lock held by a
driver the daemon does not know (the shared condition the CLI's
`unregister` command also meets); past both, the entry is removed — the
directory itself is never touched.
