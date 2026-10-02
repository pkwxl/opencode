# The opencode-auto-server daemon (P1c/P1d/P1e/P3/P4)

The resident daemon of the headless service shell: it owns the target-directory
whitelist and the auth tokens, spawns one worker child process per run (the P1b
entry, `opencode-auto-server worker '<json>'`), serves the run-control REST
surface (P1c), the REST lifecycle operations (P1d — config ops, units, models,
the plan surface), the disk observability surface (P1e — the polled status
read model and the SSE log/journal tails), the WebSocket interactive
transport (P3b — questions and run control bridged between a run's worker and
its clients) and the persistent pending-question queue with its journal (P3c —
reconnect-safe, restart-safe question delivery, and the unlocked plan
sessions), and serves the Web client (P4 — the browser shell over all of the
above: the read surface, run control, and the write surface — question
answering, the units/config/plan operations and the probe-gated models view)
on `Bun.serve` — self-contained, zero added runtime dependencies (the
isolation line of T-086; the core never knows HTTP).

## v1 boundary: single machine, multiple directories

The daemon of this version serves **one machine** and **any number of registered
directories on it**. Two things follow, and both stop here:

- The daemon binds `127.0.0.1` by default (`--host` widens it at the operator's
  own trust boundary).
- Stale-lock detection is same-host only (the run lock's pid probe,
  `auto-core src/lock.ts:146-155`): a lock recorded on another host counts as
  live forever, because its pid cannot be probed from here. **The cross-host
  recovery story is: delete the lock by hand** (`<project>/.auto/run.lock`) and
  re-run. No automatic cross-host arbitration exists or is planned for v1.

## The whitelist

A run request (`POST /runs`) names a **registered project** — by its registered
name or its registered absolute path, both exact matches — and the daemon
resolves the run's target directory **only against that registry**. It never
resolves an arbitrary request path, never normalizes one against the filesystem,
and refuses a `directory` field outright. This is the trust-boundary mitigation
of the direction draft (`auto-core plans/0067` §五): `.opencode/auto/` overlays
are injected verbatim into prompts, and this tool spends real tokens and writes
git — one-click runs on arbitrary directories would amplify both.

The registry lives in the daemon's own data directory (`--data-dir`, default
`$XDG_CONFIG_HOME/opencode-auto/server`, i.e. `~/.config/opencode-auto/server/`
on a plain machine) as `projects.json` — outside every target directory and
never under `.auto/` (whose writes are driver-exclusive by constitution).
Manage it with the CLI commands:

```
opencode-auto-server register <dir>        # add to the whitelist (realpath'd)
opencode-auto-server unregister <name>     # remove (name or registered path)
opencode-auto-server projects              # list
```

## Token auth and scopes

Every route except `GET /health` and the Web client's own two static assets
(`GET /`, `GET /app.js` — the login shell carries no data; see the Web client
section below) requires `Authorization: Bearer <token>`;
unauthenticated or unknown tokens get **401**, a known token without the route's
scope gets **403**. Scopes (the authorization tiers of the assessment, §8 Q6):

| scope    | surface                                                          | status |
| -------- | ---------------------------------------------------------------- | ------ |
| `read`   | run status, list, detail; the models operation; the observability surface — `status`, the `log` and `events` SSE tails, the `status-events` typed driver stream; the project list (`GET /projects`) | active |
| `control`| run control: `POST /runs`, kill (`DELETE /runs/<id>`); the `close`, `task-add` and `plan` operations; the control channel of the interactive transport (`/exit`, `/failback` over `/runs/<id>/interactive`) | active |
| `config` | the `init` / `amend` / `fix` / `reset` operations | active |
| `answer` | the interactive transport's question channel: receiving questions and answering them over `/runs/<id>/interactive` — the persistent pending-question queue (P3c) | active |
| `probe`  | the model probe alone (`POST /projects/<p>/models` — burns tokens by starting agents) | **opt-in, disabled by default**: carried by no default token set; beside the scope the probe takes an explicit `confirm` field and the per-daemon rate window (see the model probe below) |

`GET /session` (any known token, no specific scope) answers the presented
token's own scopes — the typed source the Web client's scope-aware UI reads
(deriving scopes by parsing refusal prose would be scraping).

Tokens are managed beside the whitelist (`tokens.json` in the data directory,
mode 0600): the store keeps only each token's SHA-256 digest, the plaintext is
printed exactly once at issue, and issuing/revoking takes effect on the next
request (the store reads per request, no daemon restart needed):

```
opencode-auto-server token issue --scopes read,control [--name <label>]
opencode-auto-server token list
opencode-auto-server token revoke <name>
```

## The REST control plane (P1c)

| route               | scope    | meaning                                                                 |
| ------------------- | -------- | ----------------------------------------------------------------------- |
| `GET /health`       | —        | liveness, no auth                                                        |
| `GET /runs`         | `read`   | every run of this daemon (its registry is in-memory; see below)          |
| `POST /runs`        | `control`| validate, spawn one worker, answer **202** + the run id                  |
| `GET /runs/<id>`    | `read`   | the run resource: state, mapped exit code, output tail                   |
| `DELETE /runs/<id>` | `control`| kill the run (**202**; see kill below)                                   |

`POST /runs` takes `{ "project": <registered name or path>, "options"?: {…},
"switches"?: {…} }`. `options` are the per-run fields of the CLI's `run`
(`verbose`, `waitAnswer`, `waitBetween`, `permission`, `newSession`, `dryrun`,
`maxSessions`, `server`) and `switches` are per-run `OPENCODE_AUTO_*` overrides
— the same shared validator the worker enforces (`src/request.ts`); anything
else, notably any constitutional config key, is refused with the frozen-flag
message ("frozen by init … revise with amend") as a **400**.

### The run resource and the exit-code vocabulary

```
{ "id": "run-000001", "project": "aseo", "directory": "/…", "state": "…",
  "code": null, "signal": null, "pid": 12345, "started": "…", "ended": null,
  "tail": "…last 8 KiB of the worker's output…", "live": true,
  "request": { "options": {…}, "switches": {…} } }
```

- `state`: `starting` (spawned, the lock not yet observed) → `running` (the
  worker holds `.auto/run.lock`) → one terminal state.
- Terminal mapping of the run's own exit vocabulary (the draft's table with the
  assessment's correction — exit 3 was missing):

  | exit | state            | meaning                                        |
  | ---- | ---------------- | ---------------------------------------------- |
  | 0    | `completed`      | all tasks done                                  |
  | 1    | `failed`         | run created, terminated with error              |
  | 2    | `blocked`        | needs a human; re-running resumes               |
  | 3    | `paused`         | the graceful `/exit` pause: progress persisted, re-run resumes precisely — what a pause button produces (`auto-core src/loop.ts:226-239`) |
  | 130  | `killed`         | force-terminated (the double-SIGINT path)       |

  A death by signal (no exit code — e.g. a `SIGKILL` from outside, or a kill
  that arrived before the run installed its handler) is `killed` too, with
  the signal recorded in `signal`: crash and kill are isomorphic scenes
  (`auto-core src/exit.ts:1-14`). Exit 3 is reachable over the daemon's
  control channel since P3b — `/exit` over the interactive transport maps
  onto the run's own graceful-exit request (see the interactive transport
  below), while the kill remains the force-terminate path beside it.

### Lock conflicts

One run per directory, with `.auto/run.lock` as the arbiter — the same rule for
the CLI and the daemon, so they coexist: **whichever process takes the lock
first wins**, and the loser refuses (the CLI's plain exit-1 refusal stays the
escape hatch; assessment §8 Q8). On `POST /runs`:

- The daemon's own registry first: a live run (starting/running) of this daemon
  on the directory → **409 Conflict**, retryable — the run id is in the body,
  and the entry reaches a terminal state on its own. This also covers the
  windows where the registry is momentarily ahead of the lock (a run just
  spawned, or a crash whose exit observation has not landed — the lock on disk
  already stale, the directory still held): the "stale-but-locked" conflict of
  the assessment, answered 409 as retryable.
- Then the lock itself (`liveRunLock`, read-only): a **live holder** — the CLI,
  another daemon's worker, a cross-host holder, an unreadable lock file — →
  **423 Locked** with the holder line (`lockStatusLine`: command, pid, host,
  since). A present-but-**stale** lock (its process gone) is *not* refused: the
  spawn proceeds and the worker's own `runAll` performs the core's sanctioned
  next-acquirer cleanup (`auto-core src/lock.ts:47-56`), keeping this API as
  self-healing as the CLI. The daemon never writes the lock itself.

### Kill

`DELETE /runs/<id>` is the force-terminate half of mid-run control. The run's
process owns SIGINT (a single press is captured and logged; a second within
the window force-terminates with exit 130 — `auto-core src/loop.ts:82-96`),
so the daemon's kill is that double press: two SIGINTs inside the window,
producing exactly the 130 the vocabulary maps to `killed`. A kill of a
still-`starting` worker lands before the handler exists and ends as a signal
death — `killed` with `signal: "SIGINT"`. The graceful half of mid-run
control — pause, with progress persisted and a re-run resuming precisely —
is the `/exit` action of the interactive transport below.

## The lifecycle operations (P1d)

The REST surface mirroring the CLI's remaining command surface. Every
operation runs **in the daemon process as a library call into the core**
(`src/ops.ts` — an operation is a synchronous request/response: no session, no
exit vocabulary of its own), and every state change reaches disk through the
core's functions; the operations write the config layer exactly the way the
CLI shell does and never touch `.auto/`, `docs/` unit state or an index tick
(the driver-exclusive writes of the draft's §五).

| route                               | scope    | meaning |
| ----------------------------------- | -------- | ------- |
| `POST /projects/<p>/init`           | `config` | the stateless full overwrite (config.json, the brief stub, the contract, the AGENTS.md block, the ignore set) |
| `POST /projects/<p>/amend`          | `config` | the per-key revision; writes only what renders from the config |
| `POST /projects/<p>/fix`            | `config` | planFix / applyFix over the rule table; `"dryrun": true` is the read-only drift gate |
| `POST /projects/<p>/reset`          | `config` | planReset / applyReset (keeps a filled brief, removes a stub one) |
| `POST /projects/<p>/close`          | `control`| closeUnit over a ref — the explicit ref and reason are the confirmation |
| `POST /projects/<p>/tasks`          | `control`| task-add: one task by title, no session (the CLI's `plan --new-task` route, over addTask) |
| `POST /projects/<p>/plan`           | `control`| the plan surface: planPrelude's no-agent routes served in-process; the agent-planning routes spawned as runs (see below) |
| `GET  /projects/<p>/models`         | `read`   | the model registry's effective table (describeModels / formatModels) |
| `POST /projects/<p>/models`         | `probe`  | the model probe (the CLI's `models --probe`): one confirmed, rate-limited fire — see below |

`<p>` is a registered project (name or registered absolute path,
percent-encoded in the URL) — the whitelist is the same absolute rule as
`POST /runs`: the daemon resolves operation targets only against the registry.

### The two answer fields — confirm and clean-tree

The CLI's `-f/--force` skips **both** the overwrite confirmation and the
worktree cleanliness gate; the API must not inherit the bundling. Two separate
request fields, each defaulting to the CLI's safe default:

- `"confirm": true` — the answer to the core's confirmation gate. The gate
  itself is the core's io-injectable `confirm()`: the request's field is the
  "y" the `[y/N]` prompt would collect, routed through the same
  normalization (only y/yes pass; everything else, including an absent field,
  is the gate's "N"). An unanswered destructive request answers **428** with
  `gate: "confirm"` and the exact question in the body.
- `"cleanTree": true` — the opt-out of the worktree cleanliness gate
  (`checkCleanTree`). A dirty tree answers **409** with `gate: "cleanTree"`
  and the file list; the check applies without a terminal too (what a
  non-TTY skips is the confirmation, never this gate).

Each field flips only its own gate: `confirm` alone does not license a dirty
worktree, `cleanTree` alone does not confirm the write. `amend` takes neither
(it discards no key); `close` takes neither (the explicit ref and the reason
are the confirmation). `fix` accepts both beside `"dryrun"` (inert under a
dryrun, like `-f` beside the CLI's `--dryrun`).

### The plan surface (P3c: unlocked)

`POST /projects/<p>/plan` serves both halves of the CLI's `plan`:

- **The no-agent routes** (planPrelude's stop outcomes) run in the daemon
  process exactly as P1d served them — round establishment (the round-start
  gate), the round-close gate (opening the next round), the phase-index drift
  re-sync, and the refusal stops — with their own lines and codes.
- **The agent-planning routes** (planPrelude → `{ type: "loop" }`) spawn the
  planning session as a run: **202** with the run resource and its
  interactive endpoint. The run performs the CLI `plan` command's work —
  `runAll` under `stopBefore: "execute"`, which arms `humanQuestions`
  (`auto-core src/opts.ts:346`, the no-timeout human wait of `:179-185`) —
  so its questions ride the interactive transport and the persistent
  pending-question queue like every other ask, and its outcome maps through
  the run's own exit vocabulary (0 a planning step succeeded and the tasks
  landed for review; 2 blocked for a human; 3 the graceful `/exit` pause).

The request fields are the planning surface:

- `"input"`: string — the planning input text (the CLI's `plan -p`); the
  planning step persists it to the phase's `plan-input.md` and plans against
  it. `--file` is the CLI's local-file spelling; the API takes the text
  itself (the daemon reads no request-named files).
- `"append"`: boolean — append the tasks planned from the input to the
  current phase (the CLI's `--append`); it rides an input (the API's
  `"append": true` without `"input"` is the CLI's same usage error).

`plan --force-close <ref> --reason` composes over the API as the **close
operation followed by the plan operation** — close-then-continue, each half
its own surface (the CLI holds one lock across both; the daemon's op
releases its lock before the spawn, and the worker's own `runAll` takes it —
the window between is the lock's own jurisdiction, whichever driver process
takes it first wins, the same rule the CLI and the daemon already share).

### The model probe (P4b)

`POST /projects/<p>/models` is the CLI's `models --probe` — `probeModels`
sends the recovery-probe prompt to every listed model through the agent
pool, one short provider round trip each. It is the only operation that
**starts agents and spends tokens**, and it sits behind three gates none of
which it shares with the config ops (the assessment's §8 Q7; "default: not
enabled"):

1. **the `probe` scope** — its own opt-in tier, carried by no default token
   set; issuing one is a deliberate admin act
   (`opencode-auto-server token issue --scopes read,probe`). Without it the
   route answers **403** like every scope miss.
2. **the explicit `confirm: true` request field** — the same [y/N] shape the
   config ops' confirmation gate uses (the core's io-injectable gate), with
   its own question naming the model count and the cost. An unconfirmed
   request answers **428** with `gate: "confirm"` and the question; nothing
   was started. The body also carries `probe: true` — the request spells
   what it asks, the CLI's `--probe` flag in field form.
3. **the per-daemon rate window** (10 minutes): one probe per window **per
   daemon** — not per token, not per project, because the tokens a probe
   spends are the operator's one wallet. The claim is atomic (two concurrent
   confirmed probes cannot both fire); the second inside the window answers
   **429** with `gate: "probeRate"` and `retryAt`, the instant the window
   reopens. The window is daemon-owned in-memory state: a daemon restart
   reopens it, which is the operator's own act.

A directory with no registry (or one that failed to load) answers the CLI's
own "nothing to probe" line — **without consuming the window** (nothing
fired). A probe that fails is a per-model finding in the body's `probes`
array and the `lines`, never a command error: the status stays the table's
own problems vocabulary (200 / 409 with `code` 1). Like the table, the probe
writes nothing into the target and takes no lock — it runs beside a live
run.

### Operation status vocabulary

Every operation answers a body carrying `code` (the CLI's own exit code for
that command) and `lines` (the CLI's own output), so a script reads one
vocabulary through either shell:

| status | meaning |
| ------ | ------- |
| 200 | served (`code: 0`) |
| 202 | an operation that spawned a run (the plan operation's agent-planning route): the body is the run resource |
| 400 | request-shape error (unknown fields, bad values) |
| 404 | unregistered project / unknown route |
| 409 | the target's state refuses — the CLI's exit-1/2 refusals (body carries `code` 1 or 2 and the `lines`); the clean-tree gate (`gate: "cleanTree"`); a live registry run or an in-flight operation on the directory (retryable) |
| 423 | a live run lock holder (the CLI's `lockLines` holder text) |
| 428 | the confirmation gate unanswered (`gate: "confirm"`, the question included) |
| 429 | the model probe's rate window (`gate: "probeRate"`, `retryAt` included) |
| 501 | a routing fact this version does not serve (the task-add fallback guard; the models probe's P1 refusal ended with P4b) |

`fix` with `"dryrun": true` is the scriptable config-drift gate: findings
answer 409 with `code: 1` (the CLI's `fix --dryrun` exit 1), a consistent
layer 200 — and it takes no lock, so it runs beside a live run (as does
`models`).

### Locks and concurrency for operations

Config operations (`init`, `amend`, `fix`, `reset`) refuse with **423** while
`liveRunLock` returns a holder, exactly the CLI's refusal (`-f` never
overrode it, and neither field here does). `close`, `task-add` and `plan`
acquire the lock themselves around their writes (the CLI's `close`/`plan`
command names). Beside a live run of this daemon the write operations answer
**409** (retryable, the run id in the body) — the registry is ahead of the
lock during a run's starting window — and one write operation holds a
directory at a time (a second answers 409; the run lock arbitrates processes,
not requests of this one). `models`, `fix` dryrun and the probe take no lock
and run beside a live run.

## The observability surface (P1e)

Everything the daemon knows about a run, it reads from disk — the run itself
wrote it. Two shapes, both read-only (pure disk reads, no lock taken, no write
into the target — beside a live run with no refusal path), both under the
`read` scope and the same absolute whitelist as every project route:

| route                             | shape | meaning |
| --------------------------------- | ----- | ------- |
| `GET /projects/<p>/status`        | JSON (poll) | the status read model |
| `GET /projects/<p>/log`           | SSE (`text/event-stream`) | the newest `.auto/logs/run-*.log`, whole lines |
| `GET /projects/<p>/events`        | SSE (`text/event-stream`) | `.auto/run-events.jsonl` as structured payloads |
| `GET /projects/<p>/status-events` | SSE (`text/event-stream`), event ids + cursor | the typed driver events (P2b): `.auto/run-status.jsonl` with event-id resume and bounded subscriber capacity |

### The status read model (polling)

One response, assembled per poll:

- `status` — the core's own `renderStatus(dir)` lines (the round → phase →
  task → subtask tree with its marks), imported and called as-is; the daemon
  never re-derives a tree for the human view.
- `verdicts` — the machine-readable **completion verdicts**, computed here at
  the API's read seam: a unit is `done` exactly when its `done.md` exists (the
  rename rides the driver's closing commit — **commit-is-completion**, agent
  self-report is never trusted), a phase likewise, and the tree's verdicts are
  settled only over a clean worktree. `in_progress`/`blocked` come from the
  runtime state the driver writes (`.auto/units.json`), never from the log.
- `git` — dirty/clean **per worktree** (the project tree's every repository,
  nested ones included; entries as `XY <path>` relative to the project
  directory), plus the overall verdict. The status is read with git's
  `--no-optional-locks`: a concurrent poller must never take `.git/index.lock`
  — without the flag, a poll can collide with the observed run's own
  `git add` and block the run it is watching.
- `lock` — `null`, or the `lockStatusLine` holder text of a live run lock
  (`▶ run in progress (pid … on …, since …)`; an unreadable lock carries its
  own line) with the holder record.
- `state` — the raw `.auto/units.json`, `stats.json`, `windows.json` and
  `progress.json`, defensively parsed.
- `logFile` — the newest discovered run log (the file the `/log` tail follows).

**Defensive parsing is load-bearing**: `.auto/progress.json` is written
non-atomically (a direct `Bun.write` in the core), so a poll can read torn
JSON — and every atomic writer has a rename window that reads as absent. A
read that does not parse is served as `null` with the file named under
`unparsable`: **"no change / retry next tick", never an error state**. The
response is 200 either way; the next poll sees whatever the writer settled on.

### The SSE tails

Both tails deliver whole lines promptly (the audit log and the journal are
`writeSync` per entry, no buffering — even a kill -9'd worker leaves complete
lines), polled at 100 ms; a client sees a line within one tick of its
newline. The log's prose lines are for humans and are delivered verbatim —
**never parsed for state**. The events channel delivers the typed engine
journal (`turn-start | input | fx | fx-result | fx-reject | settle`) verbatim
as structured payloads; a line that does not parse (a torn mid-write read) is
skipped, not delivered and not an error.

```
event: tail        ← the tail target: {file, from, reason: start|rotated|truncated}
event: line        ← one whole line of the run log (log channel only)
event: run-event   ← one typed journal entry, verbatim JSON (events channel only)
: keep-alive       ← a comment frame every 15 s on an idle stream
```

Two rotation rules, one per channel:

- **The log rotates by new name**: log files are per-run
  (`run-<ISO-to-seconds>.log`), and the newest file is **discovered by
  listing, never constructed** — a newer name is a new run, and the tail
  re-seeks to the new file's start (never appended across runs). Two runs in
  the same second share one name (the core opens it to append), so the
  "newest file" is still one file and the tail keeps following it.
- **The journal rotates by truncation**: `.auto/run-events.jsonl` is truncated
  at each run start, so a shrink is a new run and the tail re-seeks to 0.

A tail attaches at the current run's file **beginning** (the newest file *is*
the current run's — a per-run log, banner included), so a connecting client
sees the whole run it came to watch; there is no resume cursor in P1 (the
poll model is the durable view — a reconnect re-reads from the run's start).

### The structured driver-events channel (P2b)

`GET /projects/<p>/status-events` streams the typed driver events the core's
P2b emitter journals: run brackets (with the exit code), unit transitions,
task/subtask brackets, the question lifecycle, usage roll-ups, failures and
exit requests — the frozen `RunStatusEvent` vocabulary (auto-core
`src/run-status-schema.ts`), never log prose. The daemon tails the emitter's
own journal exactly as it tails the engine journal — read-only, beside a live
run, the writes into the driver's state directory staying driver-exclusive.

```
event: tail          ← the attach frame: {file, from, reason: start|resumed|truncated}
event: status-event  ← one typed event, verbatim JSON, with id: <n>
event: dropped       ← the subscriber fell > 256 events behind; reconnect after the last id
: keep-alive         ← a comment frame every 15 s on an idle stream
```

- **Event ids and cursor resume**: every event carries an SSE `id:` — its
  1-based line number in the current run's journal. A reconnect resumes after
  the last received id through the SSE standard's `Last-Event-ID` header or
  `?after=<id>`: the stream re-reads the journal and skips exactly that many
  lines — no event is delivered twice to a cursoring client.
- **Rotation**: the journal truncates at each run start. A shrink mid-stream
  re-seeks to 0 and restarts the ids (`reason: truncated`); a cursor beyond
  the file's current lines predates a rotation and attaches from line 1 the
  same way — the new run-start's `run` join key tells the story the ids alone
  cannot.
- **Bounded subscriber capacity** (256, the monorepo server's own SSE
  pattern, re-implemented on Bun.serve — never imported, the isolation
  line): a subscriber that falls more than 256 frames behind is dropped with
  a `dropped` frame and a closed stream; the daemon never buffers unboundedly
  for a client that cannot keep up, and the client resumes from its cursor.
- Unit-change push rides the `unit-transition` events; the polled read model
  above (over the unit state files) remains the durable fallback — the two
  agree because both read what the driver wrote.

## The interactive transport (P3b)

The WebSocket surface that carries **human interaction and run control**
between a run's worker and its clients: a question asked inside a run is
answerable from outside the process, and the graceful `/exit` (exit 3) is
reachable over the network. Two endpoints per run, one typed versioned
protocol (`src/ws-protocol.ts`, `v: 1` on every frame — a version skew is one
error frame and a close):

| route                          | auth | meaning |
| ------------------------------ | ---- | ------- |
| `GET /runs/<id>/interactive`   | an operator token with the `answer` **or** `control` scope (the `Authorization` header, or `?token=` — a browser WebSocket cannot set headers) | the client socket: the question channel and the control channel, multiplexed |
| `GET /runs/<id>/worker`        | the per-run secret the daemon wrote into the worker's spawn payload | the run's own bridge — the worker entry's injected `Interactive` implementation (`src/worker-interactive.ts`) connects back here through the P3a seam (`RunAllOpts.interactive`) |

Frames (JSON, one per message; `v` on every one):

- **question channel** (`answer` scope): the worker's `question {id, text,
  minutes?}` fans out to every connected client (a connecting client is
  replayed every still-open question, so a reconnect re-sees the ask it came
  to answer); a client answers with `answer {id, text}`; the worker resolves
  the ask and everyone hears `settled {id, how}` (`answered | timeout |
  transport | closed`). The prompt `text` is an opaque payload carried
  verbatim — **never parsed for state** (the direction draft §五's
  no-scraping rule): the question's lifecycle belongs to the P2 event stream
  (`question-raised`/`question-answered` over `status-events`), and this
  channel's correlation is the frame `id` and nothing else.
- **control channel** (`control` scope): `control {action: "exit"}` maps onto
  the run's own graceful-exit request (`Control.requestExit`,
  `auto-core src/exit.ts`) — the run pauses at its next safe boundary with
  progress persisted, exits 3, and a re-run resumes precisely;
  `control {action: "failback", order?}` maps onto `Router.requestFailback`
  (`auto-core src/router.ts`) — the failover state resets (or the model order
  is redefined) at the next safe boundary. This is **mid-run control, never
  config mutation** — the config freeze is untouched. The worker answers
  `control-done {action, applied, reason?}`: a frame that arrived before the
  run opened its interactive channel (the starting window) is answered
  `applied: false` — retry once the run is running — and a malformed failback
  order is refused with the sideband's own usage rule (models are
  `provider/model` with a slash).
- **informational**: `hello {run, state, worker}` on connect (the daemon's
  registry state, the bridge's presence); `session {session, agent?}` when
  the run attaches its channel to a session; `ping`/`pong` keep-alive; an
  `error {message}` frame refuses one frame (a scope miss, an unknown
  question, a control with no bridge connected) and leaves the socket open.

**Degradation is the contract** (`auto-core src/opts.ts:184-185`'s
never-a-hang rule): the core's own timer discipline rides verbatim — the ask's
timer arms only when `minutes` is given, and minutes omitted hard-waits on the
answer or the channel's end. A bridge loss does not resolve the open asks at
once (P3c): the worker holds them across the loss for the reconnect grace
(5 s — a daemon restart is the expected reason, the case the persistent queue
below exists for), re-raising them on its reconnect; past the grace every
still-pending ask resolves `undefined` on the worker (the run degrades to
blocked/exit 2, or the configured fallback — never a hang), and every client
heard the `transport` settle when the socket dropped. A question asked while
the bridge is down waits out the same grace and degrades the same way. The
worker keeps retrying the bridge (a daemon restart is expected back); a daemon
that stays gone leaves the grace to bound every open ask — the run always
reaches its own exit vocabulary. A transport settle may be superseded by the
same id's re-raise when the worker survived the loss — the frame `id` is the
join key; treat a `question` frame as (re)delivery.

**The scope matrix**: opening the client endpoint requires `answer` or
`control`; then each frame is checked against its own scope — a token with
`answer` alone can answer questions but not control the run (and vice
versa), and each refusal names the scope it wanted. The worker bridge takes
no operator token at all: its secret is one run's, held in the daemon's
memory, gone with it.

<!-- AUTO-DECISION: this document (T-088's) is extended in place by T-090 — the P1c/P1d sections already promised "SSE observability arrives with P1e", so the extension is the designed continuation of the package's own living documentation. -->
<!-- AUTO-DECISION: extended in place again by T-092 (P2b) — the status-events channel is this document's own "SSE observability" family, and the P2 phase it belongs to was promised by the same living documentation. -->
<!-- AUTO-DECISION: extended in place again by T-094 (P3b) — the interactive transport section: the header and the scope table promised the WebSocket surface ("WebSocket with P3", "surface with P3c" for the answer scope), and the kill section's "the graceful pause needs the P3 transport" pointed here; the pending-question QUEUE itself still belongs to P3c and stays promised, not described. -->
<!-- AUTO-DECISION: extended in place again by T-095 (P3c) — the queue section below is the surface the answer scope's own row and the P3b section's degradation paragraph promised ("the persistent pending-question queue itself arrives with P3c"), and the plan-unlock rewrite is the boundary section's own designed end. -->

## The persistent pending-question queue (P3c)

The interactive transport's question channel, made durable across the two
disconnections that can lose an ask — a **client** that goes away and comes
back, and a **daemon restart** mid-question. The queue itself is the
in-memory per-run hub of P3b (the still-open questions, replayed to every
connecting client); what P3c adds is the journal that rebuilds it and the
worker-side hold that survives the restart.

### The journal: data-directory layout and format

Daemon-owned state, in the daemon's own data directory — **never under a
target directory's `.auto/`** (whose writes are driver-exclusive by
constitution; the direction draft §六.2's "a new file under `.auto/`" option
is rejected on exactly that ground):

```
<dataDir>/projects.json    the whitelist (P1c)
<dataDir>/tokens.json      the auth tokens, digests only (mode 0600)
<dataDir>/questions.jsonl  the pending-question journal (mode 0600)
```

`questions.jsonl` is an append-only JSON-lines journal (one record per line,
`v: 1` on every record — a torn crash tail and a newer format's records are
skipped at replay, never misread), compacted at each daemon start down to the
runs that still hold open questions. Three record kinds:

```jsonl
{"v":1,"at":"…","run":"run-000001","event":"opened","project":"aseo","directory":"/…","secret":"oar_…","started":"…","request":{"options":{…},"switches":{…}}}
{"v":1,"at":"…","run":"run-000001","event":"raised","id":"q1","text":"⏸ pause between tasks: …","minutes":1}
{"v":1,"at":"…","run":"run-000001","event":"settled","id":"q1","how":"answered"}
```

- `opened` — written once per run at spawn, before the worker can raise
  anything: the run identity a restart reconstructs from (the `secret` is the
  per-run bridge credential, so the orphan worker's reconnect authenticates
  against the restored run; the file is 0600, daemon-local, single-machine).
- `raised` — written when the daemon first holds an ask. A re-raise (the
  worker's reconnect re-stating a still-held ask) appends only if the hub had
  cleared the id; the replay fold is idempotent by id either way.
- `settled` — written for **durable** settlements only: the worker's own
  `settled` frame (its word — `answered`/`timeout`/`transport`/`closed`) and
  the daemon's run-terminal retire (`closed`). A live-socket bridge blip
  deliberately journals nothing — the worker may still hold the ask and
  re-raise it on reconnect, so the loss is not a settlement.

The journal is a **rebuild aid, not the system of record**: the durable
question lifecycle is the P2b event stream the run itself writes
(`question-raised`/`question-answered` in `.auto/run-status.jsonl`, served by
`status-events`); the journal holds the daemon's own half — the pending set
plus the run identity needed to serve it again.

### Restart reconstruction and the `restored` run state

At startup the daemon replays the journal: every run left with an open
question comes back as a registry entry in the **`restored`** state, beside
its hub (the journaled secret, the journaled questions). Then:

- the orphan worker's bridge reconnect (its backoff caps at 2 s) is answered,
  not 404'd — it re-raises its still-held asks on the fresh socket, and the
  answer flows to a run that can take it;
- a client connecting to `/runs/<id>/interactive` receives `hello` (state
  `restored`, the bridge's presence) and the replay of every open question —
  **journal replay redelivers to a new client**;
- delivery and answering are idempotent: a settled question is never
  re-delivered (the fold drops it), a stale or double answer is a no-op
  answered with a diagnostic `error` frame (the socket stays open);
- an unanswered question still degrades — never a hang: the worker's
  reconnect grace (5 s) bounds every ask it holds across a loss, so a daemon
  that stays gone leaves the run to reach its own exit vocabulary
  (blocked/exit 2 under `humanQuestions`).

A `restored` run is not live and never terminal: its worker is not this
daemon's child (no process to supervise, no exit to observe — `DELETE
/runs/<id>` answers **409** naming that), the on-disk lock arbitrates its
directory exactly as for any other driver process, and the run's own state
lives on the disk it writes. One documented edge: a worker that dies in a
restart window without ever reconnecting leaves its journaled questions
pending in the daemon's view (answers get the honest "bridge not connected"
refusal; the P2b stream carries the true lifecycle). Run **history** still
does not survive a restart (P1's own decision, unchanged) — only the pending
set does.

## The Web client (P4)

A browser shell over the daemon's own surfaces — a thin layer, by the
direction draft's §三.4: it consumes the REST/SSE/WS endpoints P1–P3 exposed
and adds no state of its own. The sources live under `web/` (plain
TypeScript, no framework, no dependency — DOM, fetch and WebSocket are the
whole platform); `bun run build:web` (script/build-web.ts) bundles
`web/main.ts` and embeds `web/index.html` into `src/web/client.ts`, the two
string constants the daemon serves — so the source layout, the test harness
and the compiled binary all serve the same bytes (a string constant compiles
into the binary; a sibling file would not).

| route          | auth                          | meaning |
| -------------- | ----------------------------- | ------- |
| `GET /`        | — (the shell carries no data) | the page |
| `GET /app.js`  | — (same)                      | the bundled client |
| `GET /session` | any known token               | the token's scopes — the scope-aware UI's typed source |
| `GET /projects`| `read`                        | the whitelist (the project list) |

**What it renders, and from where:**

- the **project list** — the whitelist itself (`GET /projects`), and per
  project the **run list** (`GET /runs`) in the exit-code vocabulary:
  completed / failed / blocked-needs-human / paused-resumable / killed
  (the mapping P1c defined, exit 3 included);
- the **status tree** — the read model's `status` lines, the core's own
  renderer verbatim in a pre (never re-derived, never parsed back), with
  closed units marked the way the core marks them (⊘ — closed is done for
  scheduling, not delivered; the verdict table spells both facts);
- **commit-is-completion in the UI** — every "done" the page shows renders
  from the read model's structured `verdicts` (a unit is done exactly when
  its done.md exists inside the driver's closing commit), never from agent
  self-report, never scraped from log prose — the log is rendered verbatim
  and nothing parses it (draft §五, the client's core honesty rule). A dirty
  worktree unsettles the verdict banner — git is the record;
- the **SSE streams** — `log` (prose, verbatim), `events` (the engine
  journal's typed lines) and `status-events` (the P2b typed driver events
  with cursor ids; a reconnect resumes after the last received id, a
  `dropped` frame re-opens from the cursor). The client reads SSE over
  `fetch` because the token rides the `Authorization` header — a browser
  EventSource cannot set one, and widening the SSE routes to query-string
  tokens would enlarge the credential's footprint for no gain;
- the **pending questions** — the P3c queue over the interactive transport
  (the WS `question`/`settled` frames, joined by id, replayed on
  reconnect), with the answer input when the token carries `answer`;
- **run control** — start (`POST /runs`), pause (the graceful `/exit`
  control frame → exit 3, the paused-resumable state) and kill
  (`DELETE /runs/<id>`, the 130 path). Resume is the vocabulary's own: a
  plain re-run of the same project with the paused run's request.

**The frozen-flag boundary is UI-enforced**: the start form offers the
per-run `RunAllOpts` fields (verbose, waitAnswer, waitBetween, permission,
newSession, dryrun, maxSessions, server) and the `OPENCODE_AUTO_*` switch
layer only — no constitutional config key has a field to ride in, so runtime
config mutation cannot be spelled in the UI (the daemon's `parseOptions`
refusal is the second gate). Mid-run control (pause, failback) is control,
never config mutation, and stays within the `control` scope.

**Scope-awareness**: the client asks `GET /session` once per token and gates
its own surface — controls hidden without `control`, the question UI without
`answer`, the write surface's config ops without `config`, the probe without
`probe`. The two static
assets themselves are unauthenticated by the `/health` reasoning: the shell
is the login form — it carries no project names, no run state, and cannot
prompt for a token before it has loaded.

### The write surface (P4b)

The client's closing half: the operations panel (`web/ops.ts`), the question
answering flow and the models view with the probe. Its constitution — the
client never touches target-repo state directly: **no git in the browser, no
`.auto/` awareness beyond the read endpoints; every mutation goes API →
daemon → core function** (`closeUnit`, `addTask`, the config writers,
`runAll`), preserving driver-exclusive writes end to end.

- **question answering** (the `answer` scope) — the pending-question cards
  of the run detail (P4a's list, joined by frame id, replayed on reconnect),
  with the answer input; the centerpiece flow is the planning session: the
  plan form starts one (`POST /projects/<p>/plan`), the spawned run is
  selected as THE run, its questions arrive in its card, and answering them
  is what lands the tasks — the verdict table re-renders from the commit
  verdicts when they do;
- **units** (`control`) — close (the explicit ref and the one-line reason
  are the confirmation; the undo is git revert) and task-add, plus the plan
  surface: the planning input (the CLI's `-p`), `append`, and the no-agent
  routes on an empty form; `plan --force-close` composes as close-then-plan,
  each half its own form;
- **the config ops** (`config`) — init / amend over the constitutional keys
  (the two hand-edited keys have no field), fix with `dryrun` as the
  pre-view of its findings, and reset. **Confirm and clean-tree are two
  explicit, separate steps, never one bundled force**: the first request of
  a gated flow carries no gate field at all; each refusal (409
  `gate: "cleanTree"` with the file list, 428 `gate: "confirm"` with the
  exact question) renders its own step with its own button — answering adds
  exactly that step's field (`answerGate`), refusing is simply not sending,
  and each step is independently refusable with nothing changed on disk;
- **the models view** (`read`) — the describe table (the CLI's own rendered
  lines verbatim), read-only beside a live run. **The probe** (`probe`)
  sits behind its own opt-in scope and an **explicit two-step in-UI act**:
  arm (a deliberate button that reveals the confirmation), then confirm and
  fire — never a checkbox; a rate-limit 429 renders the reopen instant and
  never auto-retries. Default disabled everywhere: without the scope the
  whole probe block is hidden.

<!-- AUTO-DECISION: the page shell is served unauthenticated (GET / and
     /app.js): a browser navigation cannot attach a Bearer header, and the
     shell contains no data — everything it renders arrives over
     token-guarded calls. -->
<!-- AUTO-DECISION (two small read endpoints arrived with the client):
     GET /projects (the whitelist, read scope) because the client's project
     list needs an enumeration P1e never served (only per-project routes
     existed), and GET /session (any known token) because scope-aware UI
     gating needs a typed source — parsing 403 refusal prose for scopes
     would violate the no-scraping discipline this client exists to keep. -->
<!-- AUTO-DECISION (the probe is a POST on the models segment, not ?probe on
     the GET): the probe is a mutation of the operator's wallet, not a read
     — a GET with side effects would cache and prefetch its way into
     tokens; the POST body also gives the confirmation a field to live in,
     exactly the confirm/cleanTree shape the config ops established. -->

<!-- AUTO-DECISION: this document is extended in place again by T-096 (P4a) —
     the header and the P1c/P1e sections already promised the client surface
     ("the Web write surface" named by the probe row; the draft's §三.4), and
     the extension is the designed continuation of the package's living
     documentation. -->
<!-- AUTO-DECISION: extended in place again by T-097 (P4b) — the probe row's
     "lands with the Web write surface" promise, the scope-awareness
     paragraph's "the config UI (arriving with P4b)" and the operations
     table's probe route are the surfaces this extension describes; the
     model-probe subsection and the write-surface subsection above are its
     own designed end. -->
<!-- AUTO-DECISION (T-098, close-out): the config ops' agent handling was
     fixed in place — an init/amend request with config.agent "claude" was
     validated and then silently dropped (the parse kept the value only for
     the "opencode" dropper branch, so the frozen config said "agent
     opencode" while the caller asked for claude); the positive value now
     rides the merge like any explicit key. Found by this unit's cross-stack
     e2e, which drives init over the API with agent: "claude". -->

## Supervision and the daemon's lifetime

Workers are cattle, not pets. Exit, crash and kill are all observed and recorded
(the registry maps them per the table above); the output tail is kept (last 8
KiB) in the run resource, and the run's full audit trail is on disk where the
worker wrote it (`.auto/logs/run-*.log` — tailed live by the observability
surface above).

The run registry is in-memory: it lives exactly as long as the daemon. Stopping
the daemon stops serving but does **not** kill live workers — they run to
completion, their state stays on disk, and the lock arbitrates any successor (a
restarted daemon answers 423 while an orphan still holds a directory). Run
history does not survive a restart; nothing else depends on it — except, since
P3c, the **pending questions**: a run that still holds an open question when
the daemon stopped is restored from the journal as described in the queue
section above, so its worker reconnects and its client still finds the ask.

<!-- auto: eof -->
