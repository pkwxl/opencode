# The opencode-auto-server daemon (P1c/P1d/P1e)

The resident daemon of the headless service shell: it owns the target-directory
whitelist and the auth tokens, spawns one worker child process per run (the P1b
entry, `opencode-auto-server worker '<json>'`), serves the run-control REST
surface (P1c), the REST lifecycle operations (P1d — config ops, units, models,
the P1 `plan` boundary) and the disk observability surface (P1e — the polled
status read model and the SSE log/journal tails) on `Bun.serve` —
self-contained, zero added runtime dependencies (the isolation line of T-086;
the core never knows HTTP).

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

Every route except `GET /health` requires `Authorization: Bearer <token>`;
unauthenticated or unknown tokens get **401**, a known token without the route's
scope gets **403**. Scopes (the authorization tiers of the assessment, §8 Q6):

| scope    | surface                                                          | status |
| -------- | ---------------------------------------------------------------- | ------ |
| `read`   | run status, list, detail; the models operation; the observability surface — `status`, the `log` and `events` SSE tails | active |
| `control`| run control: `POST /runs`, kill (`DELETE /runs/<id>`); the `close`, `task-add` and `plan` operations | active |
| `config` | the `init` / `amend` / `fix` / `reset` operations | active |
| `answer` | the pending-question queue                                        | schema now, surface with P3c |
| `probe`  | `models --probe` — burns tokens by starting agents                | opt-in, **disabled by default**: no route requires it; its confirmation parameter and per-daemon rate limit land with the Web write surface |

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
  that arrived before the run installed its handler) is `killed` too, with the
  signal recorded in `signal`: crash and kill are isomorphic scenes
  (`auto-core src/exit.ts:1-14`). In P1 no daemon-driven path produces exit 3 —
  the graceful pause needs the P3 transport (`Control.requestExit` is an
  in-process service) — but the mapping is in place for the runs that will.

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

`DELETE /runs/<id>` is P1's only mid-run control. The run's process owns
SIGINT (a single press is captured and logged; a second within the window
force-terminates with exit 130 — `auto-core src/loop.ts:82-96`), so the
daemon's kill is that double press: two SIGINTs inside the window, producing
exactly the 130 the vocabulary maps to `killed`. A kill of a still-`starting`
worker lands before the handler exists and ends as a signal death — `killed`
with `signal: "SIGINT"`.

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
| `POST /projects/<p>/plan`           | `control`| the P1 plan boundary: planPrelude's no-agent routes only (see below) |
| `GET  /projects/<p>/models`         | `read`   | the model registry's effective table (describeModels / formatModels) |

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

### The plan boundary (P1)

`POST /projects/<p>/plan` serves only `planPrelude`'s **no-agent** outcomes:
round establishment (the round-start gate), the round-close gate (opening the
next round), the phase-index drift re-sync, and the refusal stops — with
their own lines and codes. Any route that would continue into an agent
planning session (`planPrelude` → `{ type: "loop" }`) is refused with
**501** naming the reason: such a session runs with `humanQuestions` (the
human's questions wait with no timeout, `auto-core src/opts.ts:179-185`), and
a headless worker's closed stdin only degrades it to blocked — the WebSocket
question queue that carries it arrives with the P3c unit. The planning-input
fields (`input`/`prompt`/`file`/`append`) are refused the same way;
`plan --force-close`'s close half is the close operation, and its
continue-into-planning half waits with the rest.

### Operation status vocabulary

Every operation answers a body carrying `code` (the CLI's own exit code for
that command) and `lines` (the CLI's own output), so a script reads one
vocabulary through either shell:

| status | meaning |
| ------ | ------- |
| 200 | served (`code: 0`) |
| 400 | request-shape error (unknown fields, bad values) |
| 404 | unregistered project / unknown route |
| 409 | the target's state refuses — the CLI's exit-1/2 refusals (body carries `code` 1 or 2 and the `lines`); the clean-tree gate (`gate: "cleanTree"`); a live registry run or an in-flight operation on the directory (retryable) |
| 423 | a live run lock holder (the CLI's `lockLines` holder text) |
| 428 | the confirmation gate unanswered (`gate: "confirm"`, the question included) |
| 501 | a route this version refuses: agent planning (the P3 interactive transport), the models probe |

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
not requests of this one). `models` and `fix` dryrun take no lock and run
beside a live run.

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

<!-- AUTO-DECISION: this document (T-088's) is extended in place by T-090 — the P1c/P1d sections already promised "SSE observability arrives with P1e", so the extension is the designed continuation of the package's own living documentation. -->

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
history does not survive a restart; nothing else depends on it.

<!-- auto: eof -->
