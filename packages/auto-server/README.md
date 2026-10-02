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
opencode-auto-server token issue --scopes read,control,answer,config
opencode-auto-server serve [--port 4770] [--host 127.0.0.1] [--data-dir <dir>]
# then: open the daemon's URL in a browser, paste a token — or talk REST.
```

## Topology: one daemon, one worker child per run

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

The daemon's own duties around that: the whitelist and token stores, run
supervision and the exit-code mapping, the REST lifecycle operations (run in
the daemon process as library calls into the core — a synchronous
request/response with no session and no exit vocabulary of its own), the
read-only observability surface, the WebSocket interactive transport, and
the Web client.

## The surface

| kind  | routes |
| ----- | ------ |
| REST  | `GET /health`; `GET /runs`, `POST /runs`, `GET /runs/<id>`, `DELETE /runs/<id>` (kill); `GET /projects`, `GET /session`; the operations under `/projects/<p>/…` — `init`, `amend`, `fix`, `reset` (the config scope), `close`, `tasks`, `plan` (control), `models` (GET the table; POST the probe — its own `probe` scope) |
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
per-daemon 10-minute rate window).

## The whitelist

A run or operation names a **registered project** — by its registered name
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
`server`); `switches` are per-run `OPENCODE_AUTO_*` overrides applied to the
worker's fresh process. **Never config keys**: the constitutional keys are
frozen by `init` (`.opencode/auto/config.json`) and a request carrying one
is refused with the frozen-flag message — revise them with the `amend`
operation, never on a run.

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
