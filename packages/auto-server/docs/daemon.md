# The opencode-auto-server daemon (P1c)

The resident daemon of the headless service shell: it owns the target-directory
whitelist and the auth tokens, spawns one worker child process per run (the P1b
entry, `opencode-auto-server worker '<json>'`), and serves the run-control REST
surface on `Bun.serve` — self-contained, zero added runtime dependencies (the
isolation line of T-086; the core never knows HTTP). The REST lifecycle surface
(config ops, units, models) arrives with P1d; SSE observability with P1e.

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
| `read`   | run status, list, detail (logs/events feeds with P1e)             | active |
| `control`| run control: `POST /runs`, kill (`DELETE /runs/<id>`); `close`, `task-add` with P1d | active |
| `config` | `init` / `amend` / `fix` / `reset`                                | schema now, routes with P1d |
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

## Supervision and the daemon's lifetime

Workers are cattle, not pets. Exit, crash and kill are all observed and recorded
(the registry maps them per the table above); the output tail is kept (last 8
KiB) in the run resource, and the run's full audit trail is on disk where the
worker wrote it (`.auto/logs/run-*.log`; SSE tailing arrives with P1e).

The run registry is in-memory: it lives exactly as long as the daemon. Stopping
the daemon stops serving but does **not** kill live workers — they run to
completion, their state stays on disk, and the lock arbitrates any successor (a
restarted daemon answers 423 while an orphan still holds a directory). Run
history does not survive a restart; nothing else depends on it.

<!-- auto: eof -->
