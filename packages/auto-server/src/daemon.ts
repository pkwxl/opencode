// The daemon of the headless service shell (P1c/P1d/P1e/P3/P4a, auto-core
// plans/0067): self-contained on Bun.serve (HTTP, SSE and the WebSocket
// interactive transport — zero added runtime dependencies, the isolation
// line of T-086). Its duties:
//   - the whitelist: daemon-owned, in the daemon's own data directory
//     (src/store.ts); a run request names a registered project and the
//     daemon resolves the target only against that registry — never against
//     an arbitrary request path (plans/0067 §五 trust-boundary
//     amplification: `.opencode/auto/` overlays are injected verbatim into
//     prompts, and this tool spends real tokens and writes git);
//   - token auth with scopes (the assessment's §8 Q6 tiers): read /
//     control / config / executor / projects. Unauthenticated → 401, a
//     known token without the route's scope → 403. `config` guards the P1d
//     config operations, `control` the unit/lifecycle operations that write
//     git through the core, `read` the observability surface, `executor`
//     the executor protocol, `projects` the project lifecycle (the `probe`
//     scope is gone with the models surface — plans/0296: the tool spawns
//     no agent session, ever, so nothing probes a model again);
//   - the run registry and worker supervision: one worker child process per
//     run (the P1b entry, spawned as a subprocess — never imported: one run
//     per process is the core's own invariant), with the run's exit-code
//     vocabulary mapped onto run states and lock conflicts mapped onto
//     HTTP;
//   - the lifecycle operations (P1d, src/ops.ts): config ops, units
//     and the P1 plan boundary, run in this process as library calls into the
//     core (an operation is a synchronous request/response — no session,
//     no exit vocabulary of its own), never a worker child;
//   - the disk observability surface (P1e, src/observe.ts): the polled status
//     read model over `.auto/*.json` plus git, and the SSE tails of the run
//     log and the engine journal — every fact read from disk the run itself
//     wrote, beside a live run, never a write into the target;
//   - the interactive transport (P3b, src/interactive-ws.ts): the WebSocket
//     endpoints of a run — `/runs/<id>/worker` (the run's bridge, the
//     per-run secret the spawn payload carried) and `/runs/<id>/interactive`
//     (the clients, operator tokens) — carrying the question channel and
//     the control channel (/exit, /failback) as typed versioned frames
//     (src/ws-protocol.ts), multiplexed on one client socket;
//   - the persistent pending-question queue and the plan unlock (P3c,
//     src/question-journal.ts): the question lifecycle journaled in the
//     daemon's own data directory, replayed at start so a restart restores
//     every run that still holds an open question (the `restored` state —
//     the orphan worker's bridge reconnects against the journaled secret,
//     a client connecting is replayed the pending set), and the plan
//     operation's agent-planning routes spawning planning runs under
//     stopBefore: "execute" (humanQuestions armed) through the same
//     spawn the run surface uses.
//   - the Web client's static shell (P4a): the page and its script served
//     from the package's embedded assets (src/web/client.ts, built from
//     web/ by script/build-web.ts — a string constant, so the source layout,
//     the test harness and the compiled binary serve the same bytes), plus
//     the two read endpoints the client's surface needs: GET /projects (the
//     whitelist) and GET /session (the token's scopes — the typed source of
//     the client's scope-aware UI; refusal prose is never parsed).
//
// v1 boundary (assessment §8 Q4): single machine, multiple directories. The
// daemon binds 127.0.0.1 by default, the run lock's stale detection is
// same-host only, and the cross-host recovery story is "delete the lock by
// hand" — documented in this package's docs/daemon.md and stopped there.
//
// The daemon never writes into a target directory: every state write is the
// worker's own or an operation's own, and both go through the core's
// functions (the operations write the config layer the way the CLI shell
// does — saveProjectConfig, ensurePointer — never
// `.auto/`, `docs/` unit state or an index tick); the daemon's view of a run
// is its child's output plus what the run leaves on disk. The daemon's OWN
// writes live in its own data directory: the whitelist, the token digests
// (src/store.ts) and, since P3c, the question journal
// (src/question-journal.ts) — never under a target's `.auto/`.
import { readFileSync } from "node:fs"
import { createHash, timingSafeEqual } from "node:crypto"
import { join, resolve } from "node:path"
import { liveRunLock, lockStatusLine } from "@opencode-ai/auto-core/lock"
import { readStatusModel, statusEventsResponse, tailResponse, type TailChannel } from "./observe"
import { environmentBootReport } from "./env-boot"
import { OP_DEFINITIONS, type OpOutcome } from "./ops"
import { DaemonStore, type RegisteredProject, type Scope, StoreError } from "./store"
import { applyServerProfile } from "./profile"
import { BRIDGE_TOKEN_ENV, REQUEST_BYTE_LIMIT, requestTooLarge, RequestError, type TransportPayload } from "./request"
import { resolvedLine } from "./version"
import { executorRoutes, PROTOCOL_VERSION, type ExecutorRoute } from "./ws-protocol"
import { ExecutorBridge, freshRunSecret, type SocketData } from "./executor-bridge"
import { parseExecutorRequest, readExecutorBody } from "./executor-request"
import { openProjectCreation } from "./project-creation"
import { workerCommand } from "./worker-command"

export const DEFAULT_PORT = 4770
export const DEFAULT_HOSTNAME = "127.0.0.1"

// The URL host for the daemon's own bound address (plans/0223 D2, the
// 0165-169 finding): an IPv6 literal must be bracketed inside a URL ("::1"
// bare makes the port read as scheme junk — new URL refuses it, and so does
// the worker's own parseTransport over the transport this daemon wrote), and
// a wildcard bind is an address to BIND, not one to CONNECT to — the URLs
// this daemon hands out (the worker bridge transport, the handle's own URL)
// name the loopback the wildcard covers. Pure; exported for the pin.
export function connectHost(hostname: string): string {
  const host = hostname === "0.0.0.0" ? "127.0.0.1" : hostname === "::" ? "::1" : hostname
  return host.startsWith("[") || !host.includes(":") ? host : `[${host}]`
}

// The run states: starting (spawned, the run lock not yet observed), running
// (the worker holds .auto/run.lock), and the terminal states the exit-code
// vocabulary maps onto. A terminal run is immutable history. `restored` is
// the P3c restart state: a run reconstructed from the question journal after
// a daemon restart — its worker is not this daemon's child (no process to
// supervise, no exit to observe), but its bridge secret and pending
// questions are served again, so the orphan worker reconnects and a client
// answers what it came to answer. Not live (this daemon spawns nothing on
// its behalf — the on-disk lock arbitrates the directory, exactly as for
// any other driver process) and never terminal (nothing here observes its
// end; the run's own state lives on the disk it writes).
export type RunState = "starting" | "running" | "completed" | "failed" | "blocked" | "paused" | "killed"
export type TerminalState = Exclude<RunState, "starting" | "running">
export const TERMINAL_STATES: readonly TerminalState[] = ["completed", "failed", "blocked", "paused", "killed"]

// The exit-code vocabulary → run state (the draft's table corrected by the
// assessment §5: exit 3 was missing — it is the single most Web-relevant
// code, what a pause button produces):
//   0 → completed                 all tasks done
//   1 → failed                    run created, terminated with error
//   2 → blocked                   needs a human (re-run resumes)
//   3 → paused / resumable        the graceful /exit pause, progress
//                                 persisted, re-run resumes precisely
//                                 (the retired push run's pause; its loop
//                                 retired with auto-core plans/0314)
//   130 → killed                  force-terminated (double Ctrl+C; the
//                                 daemon's kill is the same path)
// A death by signal (no exit code — a SIGKILL from outside, or a SIGINT that
// arrived before the run installed its handler) is a kill too: crash and
// kill are isomorphic scenes (auto-core src/exit.ts:1-14), and the signal is
// recorded beside the state. An exit code outside the vocabulary cannot be
// produced by the core's runs; it is recorded verbatim under failed.
export function terminalOf(exitCode: number | null, signalCode: string | null): { state: TerminalState; code: number | null; signal: string | null } {
  if (signalCode) return { state: "killed", code: null, signal: signalCode }
  switch (exitCode) {
    case 0:
      return { state: "completed", code: 0, signal: null }
    case 1:
      return { state: "failed", code: 1, signal: null }
    case 2:
      return { state: "blocked", code: 2, signal: null }
    case 3:
      return { state: "paused", code: 3, signal: null }
    case 130:
      return { state: "killed", code: 130, signal: null }
    default:
      return { state: "failed", code: exitCode, signal: null }
  }
}

// The registry's terminal bound (plans/0224 D2, the 0165-170 finding —
// 0160's named deferral "run-registry eviction in a long-lived daemon",
// discharged): every terminal record keeps its 8 KiB tail and request for
// the daemon's life, so past this count the oldest terminal records (Map
// insertion order — the registry's natural start order) evict WITH their
// hubs. A count, not an age: no consumer asks by age, and a restart clears
// the registry whole ("run history does not survive a restart", P1's
// decision 0160 restated) — the bound only caps THIS process's memory.
// Live and `restored` runs never count or evict: a live run is the
// machine's own business, and a restored stub retires on the lock's
// evidence (plans/0224 D1), not by this bound. A GET on an evicted id
// answers the same 404 a post-restart GET always did — the run's truth
// lives in its own committed output, never in this process's memory.
// AUTO-DECISION (50): the record's own measure (8 KiB per tail) bounds the
// kept history near half a megabyte — a dashboard page of recent runs.
export const MAX_TERMINAL_RUNS = 50

// Pure over the two maps (exported for its pin); called at every settle.
export function evictTerminalRuns(runs: Map<string, { state: string }>, bound: number = MAX_TERMINAL_RUNS): void {
  let terminals = 0
  for (const run of runs.values()) if (TERMINAL_STATES.includes(run.state as TerminalState)) terminals++
  for (const [id, run] of runs) {
    if (terminals <= bound) break
    if (!TERMINAL_STATES.includes(run.state as TerminalState)) continue
    runs.delete(id)
    terminals--
  }
}

type RunRecord = {
  id: string
  project: string
  directory: string
  state: RunState
  code: number | null
  signal: string | null
  pid: number | null
  started: string
  ended: string | null
  proc: Bun.Subprocess | undefined
  tail: string
  watcher: ReturnType<typeof setInterval> | undefined
}

// The spawn itself threw (plans/0223 D1, the 0165-055 finding): no process
// exists, ever — Bun.spawn answers E2BIG (the argv or env past the kernel's
// per-string cap), ENOENT (a missing bash under --launch, a removed worker
// binary) or its kin synchronously. spawnWorker has already settled the
// record as failed by the time this propagates; the message names the cause
// and the run, and the catching route answers it as a 500 with the settled
// view — never the generic wedge the finding caught (a `starting` record
// with no process behind it).
class SpawnError extends Error {
  constructor(message: string, readonly runId: string) {
    super(message)
  }
}

export type RunView = Omit<RunRecord, "proc" | "watcher"> & { live: boolean }

const TAIL_LIMIT = 8192

export type DaemonOptions = {
  dataDir: string
  port?: number
  hostname?: string
  // The command that starts a worker (source runs: [bun, src/index.ts];
  // compiled runs: the binary itself). Derived when absent; tests may pass
  // their own.
  worker?: { command: string; prefix: string[] }
}

export type DaemonHandle = {
  port: number
  hostname: string
  url: string
  store: DaemonStore
  // The environment boot report (plans/0265): the lines the serve entry
  // prints after its banner — the carrier's lost names since the previous
  // boot, the registry references unresolvable at boot. Computed once at
  // start; an embedding host reads the field where the CLI prints.
  bootWarnings: string[]
  // Test/CLI observability: the registry as plain views.
  runs(): RunView[]
  stop(): Promise<void>
}

// The worker command, resolved once per daemon before the first spawn. The
// derivation itself moved to src/worker-command.ts (plans/0162): the
// profile's lane launcher — which runs in the WORKER process — needs the
// same derivation without importing this module, and a wrapper here keeps
// the entry's `transfer` command and the tests on their existing import.
// Exported for the entry's own `transfer` command — the same self-invocation
// this daemon performs per run (one worker child per process).
export async function deriveWorkerCommand(): Promise<{ command: string; prefix: string[] }> {
  return workerCommand()
}

export async function startDaemon(options: DaemonOptions): Promise<DaemonHandle> {
  // The profile is set at daemon start too (idempotent): the CLI's serve
  // entry sets it before this runs, but an in-process daemon (a test, an
  // embedding host) is a shell entry of its own — every core text the
  // daemon's in-process operations render (planPrelude's refusals,
  // closeUnit's undo lines) names this shell's bin either way.
  applyServerProfile()
  const store = new DaemonStore(options.dataDir)
  // The environment boot report (plans/0265, 0264-01's fix) — before every
  // spawned run exists: the carrier the launcher will read is checked and
  // pinned at the one moment it can be, the daemon's own start.
  const bootWarnings = await environmentBootReport(options.dataDir)
  // 0293 (0290 F3's fix): the daemon's own line, resolved once at start —
  // the process's module graph never moves, so its identity is a start-time
  // fact. /health carries it beside a fresh `checkout` read of the tool
  // tree's live state; the two diverge exactly when the checkout has moved
  // under a still-running daemon (source mode's staleness window), and the
  // divergence's remedy is the restart — cheap by design, every recovery
  // re-deriving from disk.
  const line = await resolvedLine()
  // The creation engine is always mounted (plans/0284): POST /projects is
  // generalized beyond the retired --open roots — the request names the
  // directory, its parent the anchor.
  const creation = openProjectCreation(store)
  const worker = options.worker ?? workerCommand()
  // The spawn cwd is arbitrary (the run target is the registry's absolute
  // path, the worker resolves it itself); it must only be a REAL directory
  // — in a compiled binary import.meta.dir sits on Bun's virtual $bunfs,
  // which no child process can be spawned in (posix_spawn answers ENOENT).
  const spawnCwd = import.meta.dir.includes("$bunfs") ? process.cwd() : import.meta.dir
  // The confinement launcher's path, absolute from the first moment
  // (plans/0223 D3, the 0165-172 finding): verbatim, a relative --launch
  // resolved against the spawn cwd — the package's src/ in the source
  // layout, the operator's cwd compiled — and the two layouts disagreed
  // (every source-layout run died bash's 127). Resolved here against THIS
  // process's cwd: the serve entry has already resolved and checked its own
  // copy before starting the daemon; an embedding host passing a relative
  // path gets its own cwd's truth, stated. The spawn never re-resolves.
  const runs = new Map<string, RunRecord>()
  let counter = 0

  // The P1d operation surface runs in this process (library calls into the
  // core, never a worker child: an operation is a synchronous
  // request/response — no session, no exit vocabulary of its own). Two
  // daemon-side guards keep operations and runs from racing each other in
  // the one process the lock cannot arbitrate (the run lock is re-entrant
  // per process, so it arbitrates processes, not requests):
  //   - the per-directory in-flight slot: one write operation at a time, the
  //     second answers 409 retryable instead of re-entering the lock;
  //   - the live registry run: a starting/running worker of this daemon on
  //     the directory answers 409 (retryable) ahead of the lock, closing the
  //     spawn window where the lock is not yet observable.
  const coordinators = new Map<string, { run: RunRecord; bridge: ExecutorBridge }>()
  const runSecrets = new Map<string, string>()
  // The bridge secret lookup for the socket's timing-safe compare.
  const bridgeSecretOf = (id: string): string => runSecrets.get(id) ?? ""
  const coordinatorBridges = new Map<string, ExecutorBridge>()
  const opInFlight = new Set<string>()
  const liveRunOn = (directory: string): RunRecord | undefined =>
    [...runs.values()].find((run) => run.directory === directory && (run.state === "starting" || run.state === "running"))

  const view = (run: RunRecord): RunView => {
    const { proc: _proc, watcher: _watcher, ...rest } = run
    return { ...rest, live: run.state === "starting" || run.state === "running" }
  }

  // —— worker supervision (plans/0282: the executor coordinator is the only
  // run a daemon spawns — POST /runs is gone, the plain/plan/transfer run
  // payloads with it) ——

  const appendTail = (run: RunRecord, chunk: string): void => {
    run.tail = (run.tail + chunk).slice(-TAIL_LIMIT)
  }

  const pump = (run: RunRecord, stream: ReadableStream<Uint8Array>): void => {
    void (async () => {
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          appendTail(run, decoder.decode(value, { stream: true }))
        }
      } catch {
        // The worker died mid-write; its exit handling records the state.
      }
    })()
  }

  const settle = (run: RunRecord, exitCode: number | null, signalCode: string | null): void => {
    if (TERMINAL_STATES.includes(run.state as TerminalState)) return
    const mapped = terminalOf(exitCode, signalCode)
    run.state = mapped.state
    run.code = mapped.code
    run.signal = mapped.signal
    run.ended = new Date().toISOString()
    if (run.watcher) clearInterval(run.watcher)
    run.watcher = undefined
    run.proc = undefined
    const coordinator = coordinators.get(run.directory)
    if (coordinator?.run === run) {
      coordinator.bridge.close()
      coordinatorBridges.delete(run.id)
      coordinators.delete(run.directory)
    }
    runSecrets.delete(run.id)
    // The registry's terminal bound (above): past MAX_TERMINAL_RUNS terminal
    // records the oldest evict — the tail memory this process holds for
    // closed history stays bounded.
    evictTerminalRuns(runs)
  }

  const watch = (run: RunRecord, spawnAt: string): void => {
    const proc = run.proc!
    // starting → running when the worker takes .auto/run.lock (the holder
    // names its pid; the lock file is atomic, so a partial read never
    // happens — a read that fails simply hasn't happened yet).
    run.watcher = setInterval(() => {
      if (run.state !== "starting") {
        clearInterval(run.watcher!)
        run.watcher = undefined
        return
      }
      try {
        const holder = JSON.parse(readFileSync(join(run.directory, ".auto", "run.lock"), "utf8"))
        if (holder?.pid === proc.pid) run.state = "running"
      } catch {
        // No lock yet (or the run refused before taking it).
      }
    }, 200)
    void (async () => {
      await proc.exited
      settle(run, proc.exitCode, proc.signalCode ?? null)
    })()
    pump(run, proc.stdout as ReadableStream<Uint8Array>)
    pump(run, proc.stderr as ReadableStream<Uint8Array>)
  }

  // One coordinator worker child per project. The spawn environment drops
  // the daemon's ambient OPENCODE_AUTO_* layer and keeps everything else,
  // PATH and XDG_CONFIG_HOME included (one operator, one agent tooling). The
  // directory is the registry's absolute path, so the
  // cwd is only the spawn's working directory, never the run's target. The
  // payload is exactly `{ executor, directory, transport }` (plans/0282's
  // narrowed carriage — the executor worker's bridge URL), while the per-run
  // secret rides the spawn environment as OPENCODE_AUTO_BRIDGE_TOKEN —
  // never argv, which any local user reads from /proc/<pid>/cmdline
  // (plans/0222 D1); the OPENCODE_AUTO_ prefix keeps the credential out of
  // every agent child through the agent domain's X1 scrub.
  const spawnWorker = (project: RegisteredProject, run: RunRecord, payload: string, transport: TransportPayload, bridgeSecret: string): void => {
    const env: Record<string, string | undefined> = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/^OPENCODE_AUTO_/.test(key)),
    )
    env[BRIDGE_TOKEN_ENV] = bridgeSecret
    const argv = [worker.command, ...worker.prefix, "worker", payload]
    // The spawn instant, captured immediately before the spawn: a strict
    // lower bound on everything the child does, so the watcher accepts this
    // run's lock and no earlier one.
    const spawnAt = new Date().toISOString()
    let proc: Bun.Subprocess
    try {
      proc = Bun.spawn(argv, {
        cwd: spawnCwd,
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      })
    } catch (error) {
      // A synchronous spawn throw means NO process exists (plans/0223 D1):
      // E2BIG past the kernel's per-string cap, ENOENT for a removed worker
      // binary. The record settles first — failed, code null, the cause in
      // the tail — so the registry never holds a live run with nothing
      // behind it; no bridge ever connected, and the rethrow carries the
      // named cause to the route's 500.
      const cause = error instanceof Error ? error.message : String(error)
      const named = /E2BIG/i.test(cause)
        ? `${cause} — the spawn's environment rides the same kernel per-string limit; the daemon's own inherited environment is the suspect`
        : cause
      appendTail(run, `the worker process could not be spawned: ${named}\n`)
      settle(run, null, null)
      throw new SpawnError(`the worker process could not be spawned for run ${run.id}: ${named}`, run.id)
    }
    run.pid = proc.pid
    run.proc = proc
    watch(run, spawnAt)
  }

  // Register and spawn one executor coordinator for the project: the
  // registry entry, the per-run secret (the bridge's credential — generated
  // before the spawn, compared on the socket upgrade), the transport
  // payload, the spawn. The caller owns the guards (the whitelist, the
  // conflicts) and the response; a spawn that throws settles the record
  // inside spawnWorker before the error reaches the route (plans/0223 D1).
  const startRun = (project: RegisteredProject, server: Bun.Server<SocketData>, executor: ExecutorBridge): RunRecord => {
    const id = `run-${String(++counter).padStart(6, "0")}`
    // The transport URL names this daemon's own bound address (the worker
    // connects back on the loopback or whatever host the operator bound),
    // the host formatted for a URL — an IPv6 literal bracketed, a wildcard
    // bind named by the loopback it covers (plans/0223 D2).
    const transport: TransportPayload = { run: id, url: `ws://${connectHost(server.hostname ?? DEFAULT_HOSTNAME)}:${server.port}/runs/${id}/worker` }
    const payload = JSON.stringify({ directory: project.directory, executor: true, transport })
    const tooLarge = requestTooLarge(payload)
    if (tooLarge !== undefined) throw new RequestError(tooLarge)
    const run: RunRecord = {
      id,
      project: project.name,
      directory: project.directory,
      state: "starting",
      code: null,
      signal: null,
      pid: null,
      started: new Date().toISOString(),
      ended: null,
      proc: undefined,
      tail: "",
      watcher: undefined,
    }
    runs.set(id, run)
    const secret = freshRunSecret()
    runSecrets.set(id, secret)
    coordinators.set(project.directory, { run, bridge: executor })
    coordinatorBridges.set(id, executor)
    spawnWorker(project, run, payload, transport, secret)
    return run
  }



  const json = (status: number, body: Record<string, unknown>, headers?: Record<string, string>): Response =>
    new Response(JSON.stringify(body, null, 2) + "\n", { status, headers: { "content-type": "application/json", ...headers } })

  // Bearer-token auth: 401 for the missing and the unknown, the scopes for
  // the known. Digest comparison happens in the store.
  const scopesOf = (request: Request, identifyExecutor = false): { status: number; body: Record<string, unknown>; scopes?: Scope[]; identity?: string } => {
    const header = request.headers.get("authorization")
    if (!header) {
      return { status: 401, body: { error: "authentication required: send 'Authorization: Bearer <token>' (issue one with: opencode-auto-server token issue --scopes …)" } }
    }
    const presented = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1]
    if (!presented) {
      return { status: 401, body: { error: "the Authorization header must be 'Bearer <token>'" } }
    }
    const scopes = store.verifyToken(presented.trim())
    if (!scopes) return { status: 401, body: { error: "unknown token" } }
    return {
      status: 0, body: {}, scopes,
      ...(identifyExecutor && { identity: createHash("sha256").update("auto-executor/v1\0").update(presented.trim()).digest("hex") }),
    }
  }

  // The WebSocket clients' variant (P3b): a browser WebSocket cannot set
  // headers, so the token may ride the query string instead — either way
  // the same store, the same digest check, the same scope tiers.
  const scopesForSocket = (request: Request, url: URL): { status: number; body: Record<string, unknown>; scopes?: Scope[] } => {
    const query = url.searchParams.get("token")
    if (!request.headers.get("authorization") && query === null) {
      return { status: 401, body: { error: "authentication required: send 'Authorization: Bearer <token>', or '?token=<token>' on the query string (a browser WebSocket cannot set headers)" } }
    }
    const presented = /^Bearer\s+(.+)$/i.exec((request.headers.get("authorization") ?? "").trim())?.[1] ?? query ?? ""
    if (!presented.trim()) {
      return { status: 401, body: { error: "the Authorization header must be 'Bearer <token>' (or '?token=<token>' on the query string)" } }
    }
    const scopes = store.verifyToken(presented.trim())
    if (!scopes) return { status: 401, body: { error: "unknown token" } }
    return { status: 0, body: {}, scopes }
  }

  const needScope = (request: Request, what: string, scope: Scope): Response | undefined => {
    const auth = scopesOf(request)
    if (auth.scopes === undefined) return json(auth.status, auth.body)
    if (!auth.scopes.includes(scope)) {
      return json(403, { error: `${what} requires the "${scope}" scope; this token carries: ${auth.scopes.join(", ")}` })
    }
    return undefined
  }

  const findRun = (id: string): RunRecord | undefined => runs.get(id)

  // One URL segment, percent-decoded; undefined when the segment is not a
  // valid encoding (a name that cannot decode cannot be registered either).
  const safeDecode = (segment: string): string | undefined => {
    try {
      return decodeURIComponent(segment)
    } catch {
      return undefined
    }
  }

  // DELETE /runs/<id>: mid-run control in P1 is kill-only. The push run's
  // process owned SIGINT (a single press captured and logged; the second
  // within the window force-terminating with exit 130 — its loop retired
  // with auto-core plans/0314), so the daemon's kill is the double press: two
  // SIGINTs inside the window, producing exactly the 130 the vocabulary
  // maps to killed. The graceful /exit pause needs the P3 transport
  // (Control.requestExit is an in-process service) and is not reachable
  // here.
  // AUTO-DECISION (kill = double SIGINT, not SIGKILL): the force-terminate
  // path is the run's own 130-exit (its backstop timers included), which
  // settles the record through the normal exit-code vocabulary; a SIGKILL
  // would land as a signal death instead, skipping the run's own cleanup.
  // A kill that arrives before the run installed its handler (the starting
  // window) ends as a signal death — killed with the signal recorded, the
  // isomorphic crash scene the core documents.
  const deleteRun = (run: RunRecord): Response => {
    if (TERMINAL_STATES.includes(run.state as TerminalState)) {
      return json(409, { error: `run ${run.id} is already terminal (state ${run.state}${run.code !== null ? `, code ${run.code}` : ""})`, run: view(run) })
    }
    const proc = run.proc
    if (run.state === "starting" && proc === undefined) {
      // A `starting` record with no process behind it (plans/0223 D1): the
      // spawn's own throw settles the record at the throw, so this arm is
      // the belt under it — whatever path left a registered-but-processless
      // run, the delete settles it instead of answering "kill requested"
      // over nothing (the finding's 202-that-does-nothing). The note states
      // what actually happened and what is true now.
      appendTail(run, "DELETE arrived on a starting run with no worker process (the spawn never succeeded or the process handle was lost); the record was settled as failed by the delete\n")
      settle(run, null, null)
      return json(202, {
        ...view(run),
        note: "the run was registered as starting but no worker process existed (its spawn never succeeded or its process handle was already lost); the record has been settled as failed by this delete — the project's surface is free again",
      })
    }
    if (proc) {
      proc.kill("SIGINT")
      setTimeout(() => {
        try {
          proc.kill("SIGINT")
        } catch {
          // Already gone; the exit observation settles the record.
        }
      }, 250).unref?.()
    }
    return json(202, {
      ...view(run),
      note: "kill requested (double SIGINT, the force-terminate path); observe GET /runs/<id> for the terminal state (the vocabulary maps it to killed/130)",
    })
  }

  const fetchHandler = async (request: Request, server: Bun.Server<SocketData>): Promise<Response> => {
    const url = new URL(request.url)
    const segments = url.pathname.split("/").filter(Boolean)
    const method = request.method
    if (segments[0] === "health" && segments.length === 1 && method === "GET") {
      // AUTO-DECISION (health unauthenticated): the route answers liveness
      // only — no project names, no run state, nothing a token guards. A
      // probe endpoint that needs the credential it is probing for could
      // not tell a wrong token apart from a daemon that is down.
      // 0293: the identity witness rides the same open route — `line`, the
      // daemon process's own resolution captured at its start, beside
      // `checkout`, the tool tree's live state read now. Equal: nothing is
      // owed. Divergent (a source-mode daemon outliving its checkout): a
      // restart is owed — the stale-lock recovery making it cheap by
      // design. A compiled binary reads its stamp for both, no git.
      return json(200, { ok: true, service: "opencode-auto-server", line, checkout: await resolvedLine() })
    }
    // The whitelist as a read surface (P4a): the project list the client
    // renders — the same registry `opencode-auto-server projects` prints and
    // every project-scoped route resolves against (P1e served per-project
    // reads only; the client's project list needs the enumeration, under the
    // read scope like the rest of the observability surface).
    if (segments[0] === "projects" && segments.length === 1 && method === "GET") {
      const denied = needScope(request, "listing projects", "read")
      if (denied) return denied
      return json(200, { projects: store.listProjects() })
    }
    if (segments[0] === "projects" && segments.length === 1 && method === "POST") {
      const auth = scopesOf(request, true)
      if (!auth.scopes || !auth.identity) return json(auth.status, auth.body)
      if (!auth.scopes.includes("projects")) return json(403, { error: 'Project creation requires the "projects" scope.' })
      let body: unknown
      try {
        body = await readExecutorBody(request)
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError("Project creation requires a JSON object.")
      } catch (error) {
        return json(400, { error: error instanceof Error ? error.message : "Invalid project creation request." })
      }
      server.timeout(request, 0)
      const result = await creation.request(auth.identity, body as Record<string, unknown>)
      return json(result.status, result.body)
    }
    // DELETE /projects/<project> (plans/0284, the lifecycle's removal): the
    // projects scope; a live coordinator or run on the project's directory
    // refuses 409 teaching the stop (DELETE /runs/<id> — the run id named);
    // past that the store's own live-refusal condition guards (a run lock
    // held by a driver this daemon does not know — another host's or a
    // hand-run process), and past both the registry entry is removed.
    if (segments[0] === "projects" && segments.length === 2 && method === "DELETE") {
      const denied = needScope(request, "deleting a project", "projects")
      if (denied) return denied
      const name = safeDecode(segments[1]!)
      const project = name ? store.resolveProject(name) : undefined
      if (!project) {
        return json(404, { error: `"${segments[1]}" is not a registered project (GET /projects lists the registry; DELETE removes an entry by name or path)` })
      }
      const live = [...runs.values()].find((run) => run.directory === project.directory && !TERMINAL_STATES.includes(run.state as TerminalState))
      if (live) {
        return json(409, {
          error: `project "${project.name}" has a live run (${live.id}, state ${live.state}) — stop it first: DELETE /runs/${live.id} (the kill ladder), then retry the delete`,
          run: live.id,
        })
      }
      try {
        const removed = store.unregister(name!)
        return json(200, { removed: { name: removed.name, directory: removed.directory } })
      } catch (error) {
        if (error instanceof StoreError) return json(409, { error: error.message })
        throw error
      }
    }
    if (segments[0] === "runs") {
      if (segments.length === 1 && method === "GET") {
        const denied = needScope(request, "listing runs", "read")
        if (denied) return denied
        return json(200, { runs: [...runs.values()].map(view) })
      }
      if (segments.length === 2) {
        const run = findRun(segments[1]!)
        if (method === "GET") {
          const denied = needScope(request, "reading a run", "read")
          if (denied) return denied
          if (!run) return json(404, { error: `no run ${segments[1]} (runs are identified by the id POST /runs returned)` })
          return json(200, view(run))
        }
        if (method === "DELETE") {
          const denied = needScope(request, "killing a run", "control")
          if (denied) return denied
          if (!run) return json(404, { error: `no run ${segments[1]} (runs are identified by the id POST /runs returned)` })
          return deleteRun(run)
        }
      }
    }
    const executorRoute = segments[3] as ExecutorRoute
    if (method === "POST" && segments.length === 4 && segments[0] === "projects" &&
        segments[2] === "executor" && executorRoutes.includes(executorRoute)) {
      const auth = scopesOf(request, true)
      if (!auth.scopes || !auth.identity) return json(auth.status, auth.body)
      if (!auth.scopes.includes("executor")) {
        return json(403, { error: 'The executor routes require the "executor" scope.' })
      }
      const name = safeDecode(segments[1]!)
      const project = name ? store.resolveProject(name) : undefined
      if (!project) return json(404, { error: "No registered project matches the executor route." })

      let body: unknown
      try {
        body = await readExecutorBody(request)
        parseExecutorRequest(executorRoute, body, auth.identity)
      } catch (error) {
        return json(400, { error: error instanceof Error ? error.message : "Invalid executor request." })
      }
      let bridge = coordinators.get(project.directory)?.bridge
      if (!bridge) {
        if (opInFlight.has(project.directory) || liveRunOn(project.directory)) {
          return json(409, { error: "A run or operation already occupies this project." })
        }
        const holder = liveRunLock(project.directory)
        if (holder) return json(423, { error: lockStatusLine(holder) })
        bridge = new ExecutorBridge()
        try {
          startRun(project, server, bridge)
        } catch (error) {
          return json(500, { error: error instanceof Error ? error.message : "The coordinator could not start." })
        }
      }
      // The bridge timeout owns ambiguous delivery, even when the HTTP peer disconnects.
      server.timeout(request, 0)
      const reply = await bridge.send(executorRoute, auth.identity, body)
      return json(reply.status, reply.body)
    }
    // The executor coordinator's bridge socket (plans/0282: the daemon's one
    // WebSocket surface): the per-run secret the spawn payload's transport
    // named, compared timing-safely over digests — never an operator token,
    // so a bridge socket does exactly one coordinator's work. The secret
    // rides the query string (an upgrade cannot carry headers), the v1
    // loopback posture. A coordinator run's socket alone exists; every
    // other run id answers the same 401 the unknown secret does.
    if (method === "GET" && segments[0] === "runs" && segments.length === 3 && segments[2] === "worker") {
      const run = findRun(segments[1]!)
      const bridge = run === undefined ? undefined : coordinatorBridges.get(run.id)
      const presented = url.searchParams.get("token") ?? ""
      if (
        run === undefined ||
        bridge === undefined ||
        !timingSafeEqual(createHash("sha256").update(presented).digest(), createHash("sha256").update(presented === "" ? "" : bridgeSecretOf(run.id)).digest())
      ) {
        return json(401, { error: "unknown run secret: the coordinator bridge authenticates with the per-run secret the spawn payload carried" })
      }
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return json(400, { error: `this route is a WebSocket endpoint: upgrade to websocket and speak the executor protocol v${PROTOCOL_VERSION} (see docs/protocol.md)` })
      }
      if (server.upgrade(request, { data: { kind: "worker", run: run.id } satisfies SocketData })) return new Response(null)
      return json(400, { error: "the websocket upgrade failed" })
    }
    // The P1e observability surface plus the P2b structured events channel:
    // /projects/<project>/{status,log,events,status-events} — the polled
    // status read model (plain JSON), the two SSE tails (the run log and the
    // engine journal) and the typed driver-events stream (the run-status
    // journal with event-id cursoring; src/observe.ts). Read-only by
    // construction (pure disk reads, no lock, src/observe.ts), so they run
    // beside a live run with no refusal path. The whitelist and the scope are
    // the rules every project route shares: the project resolves only against
    // the registry, the token needs `read`.
    if (segments[0] === "projects" && segments.length === 3 && method === "GET" && ["status", "log", "events", "status-events"].includes(segments[2]!)) {
      const denied = needScope(request, `the ${segments[2]} feed`, "read")
      if (denied) return denied
      const name = safeDecode(segments[1]!)
      const project = name ? store.resolveProject(name) : undefined
      if (!project) {
        return json(404, { error: `"${segments[1]}" is not a registered project: the whitelist resolves observability targets only against the registry (register with: opencode-auto-server register <dir>)` })
      }
      if (segments[2] === "status") {
        // An unexpected throw here is a daemon bug the operator must see
        // (the model itself never errors for target-state reasons — a torn
        // or missing state file is a fact it reports, not a failure).
        try {
          return json(200, await readStatusModel(project.directory))
        } catch (error) {
          console.error(`the status read model on ${project.directory} failed unexpectedly:`, error)
          return json(500, { error: `the status read model failed unexpectedly: ${error instanceof Error ? error.message : String(error)}` })
        }
      }
      if (segments[2] === "status-events") {
        // The P2b structured events channel: the cursor is the last event id
        // the client received — the SSE standard's Last-Event-ID header on a
        // reconnect, or ?after=<id> for an explicit resume.
        const header = request.headers.get("last-event-id")
        const after = header !== null && header.trim() !== "" ? Number(header) : Number(url.searchParams.get("after") ?? 0)
        return statusEventsResponse(project.directory, Number.isFinite(after) ? after : 0)
      }
      return tailResponse(project.directory, (segments[2] === "log" ? "log" : "events") as TailChannel)
    }
    // The P1d operation surface: /projects/<project>/<op>, one entry per
    // OP_DEFINITIONS (config ops, units, the plan boundary). The
    // whitelist is the same absolute rule as POST /runs — the project
    // resolves only against the registry, never against the request path
    // itself.
    if (segments[0] === "projects" && segments.length === 3) {
      const name = safeDecode(segments[1]!)
      const op = OP_DEFINITIONS.find((entry) => entry.segment === segments[2] && entry.method === method)
      if (!name || !op) {
        return json(404, {
          error: `no route ${method} ${url.pathname} (P1d serves the project operations ${OP_DEFINITIONS.map((entry) => `${entry.method} /projects/<project>/${entry.segment}`).join(", ")}; the run surface is GET /health, GET /runs, GET /runs/<id>, DELETE /runs/<id> (kill — the coordinator a project's executor route spawned); the observability surface is GET /projects/<project>/status, /log, /events and /status-events; the project lifecycle is GET /projects (the whitelist), POST /projects (creation, the projects scope) and DELETE /projects/<project>)`,
        })
      }
      const denied = needScope(request, op.what, op.scope)
      if (denied) return denied
      const project = store.resolveProject(name)
      if (!project) {
        return json(404, { error: `"${name}" is not a registered project: the whitelist resolves operation targets only against the registry (register with: opencode-auto-server register <dir>)` })
      }
      let body: Record<string, unknown> | undefined
      if (method === "POST") {
        // An empty POST body is the no-fields request ({}); anything else
        // must be a JSON object.
        const text = await request.text()
        if (text.trim()) {
          let parsed: unknown
          try {
            parsed = JSON.parse(text)
          } catch (error) {
            return json(400, { error: `the request body is not valid JSON: ${error instanceof Error ? error.message : String(error)}` })
          }
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return json(400, { error: "the operation request is a JSON object" })
          }
          body = parsed as Record<string, unknown>
        } else {
          body = {}
        }
      }
      const dispatch = async (): Promise<Response> => {
        const envelope = (outcome: OpOutcome): Response => json(outcome.status, { project: project.name, directory: project.directory, ...outcome.body })
        // A write operation owns its directory while it runs: a second write
        // operation on the same project answers 409 while one is in flight
        // (each acquires the run lock around its own span), and any
        // operation answers 409 beside a live coordinator run.
        if (!op.write(body)) return envelope(await op.run({ project, body, query: url.searchParams }))
        if (opInFlight.has(project.directory)) {
          return json(409, {
            error: `an operation is already in flight on ${project.name}; retry once it finishes (one write operation holds a directory at a time — the run lock arbitrates processes, not requests of this one)`,
            retry: "retry once the operation completes — it is synchronous, so the very next request sees the directory free",
          })
        }
        const live = liveRunOn(project.directory)
        if (live) {
          return json(409, {
            error: `a run is already active on ${project.name}: run ${live.id} is ${live.state}`,
            run: { id: live.id, state: live.state },
            retry: `To stop the active coordinator, DELETE /runs/${live.id} with control scope. Once GET /runs/${live.id} (read scope) shows a terminal state, retry the operation. Read-only fix dryrun can run beside the coordinator.`,
          })
        }
        opInFlight.add(project.directory)
        try {
          return envelope(await op.run({ project, body, query: url.searchParams }))
        } finally {
          opInFlight.delete(project.directory)
        }
      }
      // An operation's own errors are its outcomes (409/423/428/501 carry
      // their reasons); an unexpected throw is a daemon bug the operator
      // must see, never a silent 200.
      try {
        return await dispatch()
      } catch (error) {
        console.error(`the ${op.segment} operation on ${project.directory} failed unexpectedly:`, error)
        return json(500, { error: `the ${op.segment} operation failed unexpectedly: ${error instanceof Error ? error.message : String(error)}` })
      }
    }
    return json(404, { error: `no route ${method} ${url.pathname} (the daemon serves: GET /health; GET /runs, GET /runs/<id>, DELETE /runs/<id> (kill); the executor protocol POST /projects/<project>/executor/<ready|claim|brief|report|heartbeat|release>; the operations POST /projects/<project>/<init|amend|fix|reset|close|tasks|plan|transfer|clarify|reconcile>; the observability GET /projects/<project>/status|log|events|status-events; the project lifecycle GET /projects (the whitelist), POST /projects (creation, the projects scope), DELETE /projects/<project>)` })
  }

  const server = Bun.serve<SocketData>({
    port: options.port ?? DEFAULT_PORT,
    hostname: options.hostname ?? DEFAULT_HOSTNAME,
    fetch: fetchHandler,
    // The executor coordinator's bridge socket (plans/0282: the interactive
    // endpoints are gone — this is the daemon's one WebSocket surface). The
    // bridge authenticated with the per-run secret at the upgrade; the
    // SocketData dispatch is one kind.
    websocket: {
      open(socket) {
        coordinatorBridges.get(socket.data.run)?.open(socket)
      },
      message(socket, message) {
        coordinatorBridges.get(socket.data.run)?.message(socket, message)
      },
      close(socket) {
        coordinatorBridges.get(socket.data.run)?.disconnect(socket)
      },
    },
  })

  const handle: DaemonHandle = {
    port: server.port ?? options.port ?? DEFAULT_PORT,
    hostname: server.hostname ?? options.hostname ?? DEFAULT_HOSTNAME,
    // The handle's URL formats the bound host for a URL too (plans/0223 D2):
    // an IPv6 literal bracketed, a wildcard named by its loopback — the
    // serve banner and the web client link read this string.
    url: `http://${connectHost(server.hostname ?? options.hostname ?? DEFAULT_HOSTNAME)}:${server.port ?? options.port ?? DEFAULT_PORT}`,
    store,
    bootWarnings,
    runs: () => [...runs.values()].map(view),
    stop: async () => {
      // Ordinary workers finish independently. Coordinator workers depend
      // on this bridge, so wait for them to drain and release their locks.
      for (const run of runs.values()) if (run.watcher) clearInterval(run.watcher)
      const children = [...coordinators.values()].map(({ run }) => run.proc?.exited)
      for (const bridge of coordinatorBridges.values()) bridge.close()
      server.stop(true)
      await Promise.all([...children, creation?.close()])
    },
  }
  return handle
}
