# opencode-auto headless servicization evolution: direction assessment and pre-planning (to be discussed)

> Date: 2026-10-01
> Status: assessment conclusions; **chartered and fully implemented: T-086..T-098 (2026-10-02) delivered the `packages/auto-server` shell package, the daemon/worker subprocess topology, the REST control plane + SSE/WS, and the Web client with end-to-end closure**; the old status "not chartered, for future discussion" is void (2026-10-02 correction, `plans/0069` §4.2 A8). The body keeps the assessment draft as originally written; for implementation truth, `packages/auto-server` and its docs are authoritative.
> Assessment target: `~/worksapce/aseo/opencode/packages/auto-core` (branch `auto-core`, HEAD `6e146c979`) + `packages/auto`
> Proposition: evolve opencode-auto into a purely headless automation service, operated via a RESTful API, with running state fetched over SSE; pair it with a pure Web client providing basic execution control.
> Note: this is a discussion draft, written in Chinese; if it is later formally chartered into the repo as `plans/NNNN-*.md`, it should be rewritten in English per the AGENTS.md convention.

## 1. Conclusions (TL;DR)

The direction holds, and the codebase has already been consciously evolving toward it; the migration cost is much lower than expected. The original five-component split (headless execution core / dynamic-config tool suite / REST API module / pure Web client / simple command-line console) is broadly correct but needs two corrections:

1. **The "headless execution core" already exists**: it is `auto-core` itself. Do not fork or rewrite it; just add a shell package in server form. The core never knows HTTP (core/shell contract: core does not know shells).
2. **"Dynamic config" must be reinterpreted**. The config model of this program is deliberately "anti-dynamic" (init locks it in → amend revises it → frozen at runtime; a constitutional key appearing at runtime means exit 1). The correct meaning is **API-reachable** (API-driven pre-run config), not **mutable mid-run**. Breaking the config constitution is the only path by which this migration could ruin the whole design.

## 2. Why the Direction Holds (current-state inventory)

### Servicization foundations already in place

| # | Fact | Evidence |
|---|---|---|
| 1 | The whole runtime is one library function | `src/loop.ts:33` `runAll(directory, opts: RunAllOpts): Promise<number>`; `planPrelude` / `closeUnit` / `task-add` / `renderStatus(dir)` are likewise directly callable. The CLI shell (`packages/auto`) is only ~1600 lines of argument parsing and printing |
| 2 | The CLI form belongs to the shell, and a server legitimately is "another shell" | `docs/shell-contract.md` §A decision rules; the injection points `setShellProfile` / `registerTemplate` / `registerAgentAdapter` all exist already |
| 3 | Human interaction is already transport-agnostic at the key points | The `Interactive` sideband accepts injected `io: { input, output }` streams (`src/interactive.ts:34`, defaulting to stdin/stdout); the control plane is in-process service calls: `Control.requestExit()` (`src/exit.ts:37`), `Router.requestFailback(order)`. `/exit` and `/failback` are essentially methods waiting to be invoked over WebSocket |
| 4 | Observability is disk-based and naturally multi-process safe | `renderStatus(dir)` purely reads unit files + `.auto/units.json` + the phase index; `status` never takes a lock and is explicitly designed to coexist with a running process; every run writes a complete synchronous audit log `.auto/logs/run-*.log` |
| 5 | One driver per directory is already enforced | `.auto/run.lock` (pid+host JSON, stale-pid detection, `src/lock.ts`) → one daemon supervising N workers over N directories is safe today |
| 6 | Crash and kill are isomorphic; workers can be cattle, not pets | `src/exit.ts` header comment: with progress persisted, the next run resumes "precisely"; `/exit` produces, at any safe boundary, a state fully isomorphic to a real kill. The supervisor may kill/restart workers at will |
| 7 | There is already a REST+SSE precedent at the layer below | The opencode adapter itself spawns/takes over `opencode serve` and consumes SSE (`src/agent/opencode/`); this monorepo already has the same architecture (`packages/server`, `packages/web`, `packages/console`) |

### Locations still terminal-bound (an honest list)

| Location | Current state | Migration handling |
|---|---|---|
| `loop.ts:92-96` SIGINT → exit 130, `process.exit` | Assumes it owns the whole process | The run executes in a subprocess; isolation comes for free |
| `lock.ts:61` process exit hook releases the lock | Same as above | Same as above |
| The readline in `confirm.ts` / `session-api.ts askHuman` / `loop-progress.ts waitBetween | Connects directly to stdin (some already support injected io) | Those serving one-shot config commands map to POST; in-session Q&A goes through `Interactive` injection |
| `log.ts` is a module-level singleton that console.logs human-readable prose | No event bus | The only core mechanism that genuinely must be added (see below) |

### Three real gaps

1. **No structured event bus**. The only real-time signals are terminal text + audit files, and log lines are prose for humans, not a protocol; the Web side must not scrape them. `RunServices` needs a small event-emitting service added (an exactly matching precedent: that is how 0061 turned `control` and `router` into services), feeding the log file and the SSE subscribers at the same time; events are structured (unit transitions, session start/end, question, usage, error), with absolutely no scraping of English text.
2. **Blocking Q&A flow**. The `humanQuestions` of the `plan` session waits for a human with no timeout; the Web side must handle disconnect/reconnect, so the server needs a **pending-question queue + persistable delivery** rather than a single WS message. The integration point is exactly `Interactive.question()`.
3. **Process topology**. `runAll` must execute in a subprocess, not inside the API process: SIGINT/exit-hook assume process ownership, and subprocess isolation brings the kill/recovery story for free.

## 3. Corrected Target Component Split

1. **Headless execution core = `auto-core` evolving in place**. Only add: the event-bus service; (optionally) make the io of the last few readline spots injectable too. The core never imports HTTP.
2. **Dynamic config = respect the constitution**. init/amend/fix/reset exposed via API (pre-run); per-run overrides go only through the existing env-switch layer (`OPENCODE_AUTO_*` → the per-run options of the API); mid-run changes go only through the existing control plane (`/exit`, `/failback`, `close`, `task-add`). "Dynamic" = API-reachable, not mutable mid-run.
3. **REST/SSE module = a new shell package** (working name `packages/auto-server`). The resource surface derives directly from the command list:
   - projects (target directories, registered via the daemon-level allowlist)
   - runs: POST returns a run id immediately; run lock conflicts map to 409/423; exit 0/1/2/130 maps mechanically to HTTP status
   - config ops（init/amend/fix/reset）、units（close / task-add）、plan（input / append / force-close）、models
   - SSE: logs, events, status; WS: interactive + the question queue
4. **Pure Web client**: consumes the status tree, the event streams, and the question queue. A thin layer on top of 3.
5. **Simple command-line console: `packages/auto` kept as-is**. It remains the reference shell, the escape hatch when the daemon is unavailable, and the regression baseline.

### Process topology (proposed)

```
daemon (supervisor, packages/auto-server)
 ├─ REST API + SSE/WS endpoints
 ├─ run registry: runs/{id} → (dir, pid, state)
 └─ one subprocess worker per run
     └─ runAll(dir, opts)   ← .auto/run.lock guarantees one instance per directory
                                ↑ disk read model: .auto/*.json + .auto/logs/*.log + git
```

## 4. Phased Implementation Roadmap

| Phase | Content | Core changes |
|---|---|---|
| P1 | daemon + runs in subprocesses + REST control plane + SSE tailing `.auto/logs`, polling `.auto/*.json` | **zero core changes**; all observability is already on disk today |
| P2 | `RunServices` event bus; SSE subscribes to structured events; units.json change push | one small core change (the servicization pattern copied from control/router) |
| P3 | WS `Interactive` transport adaptation (the two ends of the injected io joined on the server side) + a persistable pending-question queue | near-zero core changes; mostly server-package work |
| P4 | pure Web client | no core changes |
| Throughout | `packages/auto` untouched | — |

## 5. Risks and Constraints That Must Hold

The credibility of this tool comes precisely from those "inconvenient" invariants, and the biggest risk of going Web is bypassing them for convenience:

- **The driver has exclusive rights to write state**: API/Web must never write directly to `.auto/`, `todo.md`/`done.md`, or index ticks; every change goes through library functions such as `closeUnit` / `task-add` / `runAll`.
- **Unified commit is the completion condition**: "done" on the Web must be judged by the commit (③ commit / ④ dirty); never trust agent self-reports.
- **Config constitution**: do not introduce mid-run config changes just because the Web is convenient.
- **One run per directory**: horizontal scaling happens only along the directory dimension, never concurrently on the same directory.
- **Amplified trust boundary**: the `.opencode/auto/` overlay gets injected verbatim into the prompt (equivalent to executing the instructions of that repository); a one-click Web trigger for runs on arbitrary directories amplifies this risk → the daemon must maintain a target-directory allowlist, and the API needs token auth (this tool spends real money on tokens and writes to git).

## 6. Open Questions to Discuss (to be answered before chartering)

1. The event-bus schema: the event-type list, its relation to the `AgentEvent` vocabulary, and whether it goes into a `models-schema.ts`-style frozen table.
2. Where the pending-question queue persists: a new file under `.auto/` vs daemon memory + event replay.
3. Whether the daemon reuses the monorepo `packages/server` infrastructure (HTTP/SSE patterns) or is self-contained (how to balance this against the isolation principle of "the core does not know opencode internals"; whether to hold the line that the auto family imports only the SDK).
4. Multi-machine form: whether daemon and worker need to span machines (the host field of the current run lock already distinguishes hosts, but stale detection is limited to the local machine); the first version should explicitly set "single machine, multiple directories" as the boundary.
5. Naming for the new shell package and its bin (`packages/auto-server`? follow the shell-contract §E onboarding checklist).
6. Authorization tiers for Web-side write operations: read-only / Q&A / control plane (exit, failback, close) / config plane (init/amend); whether to split roles.
7. The API-exposure policy for token-burning operations like `models --probe`.
8. Confirming lock semantics when the legacy CLI and the server coexist (already safe today: the server subprocess takes the lock and the CLI gets rejected with 409/423; this needs to be surfaced clearly in the UX).

## 7. Evidence Index (for easy future re-verification)

- Core entry: `src/loop.ts:33` (runAll); `docs/shell-contract.md` (core/shell boundary, injection points, onboarding checklist §E)
- Interaction injection points: `src/interactive.ts:34` (io injection), `src/control-types.ts` (`Interactive`/`Boundary`), `src/exit.ts:37` (`Control`), `src/opts.ts:100-230` (`Opts`: interactive/humanQuestions/control/router/git are all injected fields)
- Locks: `src/lock.ts` (holder JSON, stale detection, re-entrant)
- Read model: `src/status.ts:24` (`renderStatus(dir)` is a pure disk read); under `.auto/`: units.json / progress.json / stats.json / windows.json / logs/
- Logging today: `src/log.ts` (singleton, console + synchronous audit file)
- Terminal-binding residue: `grep process.stdin|readline` → `confirm.ts`, `session-api.ts:377`, `loop-progress.ts:32`, `step.ts:57`
- Recovery story: `src/exit.ts` header comment; resume/progress (0018-0022)
- Isomorphic precedents: `src/agent/opencode/` (REST+SSE consumption), monorepo `packages/server|web|console`

<!-- auto: eof -->
