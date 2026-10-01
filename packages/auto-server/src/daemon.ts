// The daemon of the headless service shell (P1c/P1d, auto-core plans/0067):
// self-contained on Bun.serve (HTTP now, SSE with P1e, WebSocket with P3 —
// zero added runtime dependencies, the isolation line of T-086). Its duties:
//   - the whitelist: daemon-owned, in the daemon's own data directory
//     (src/store.ts); a run request names a registered project and the
//     daemon resolves the target only against that registry — never against
//     an arbitrary request path (plans/0067 §五 trust-boundary
//     amplification: `.opencode/auto/` overlays are injected verbatim into
//     prompts, and this tool spends real tokens and writes git);
//   - token auth with scopes (the assessment's §8 Q6 tiers): read /
//     control / config / answer / probe. Unauthenticated → 401, a known
//     token without the route's scope → 403. `config` guards the P1d config
//     operations, `control` the unit/lifecycle operations that write git
//     through the core, `read` the models table; `answer` names the P3c
//     question queue; `probe` is opt-in and disabled by default (no route
//     requires it — its confirmation and rate limit land with the Web write
//     surface);
//   - the run registry and worker supervision: one worker child process per
//     run (the P1b entry, spawned as a subprocess — never imported: one run
//     per process is the core's own invariant), with the run's exit-code
//     vocabulary mapped onto run states and lock conflicts mapped onto
//     HTTP;
//   - the lifecycle operations (P1d, src/ops.ts): config ops, units, models
//     and the P1 plan boundary, run in this process as library calls into
//     the core (an operation is a synchronous request/response — no session,
//     no exit vocabulary of its own), never a worker child.
//
// v1 boundary (assessment §8 Q4): single machine, multiple directories. The
// daemon binds 127.0.0.1 by default, the run lock's stale detection is
// same-host only, and the cross-host recovery story is "delete the lock by
// hand" — documented in this package's docs/daemon.md and stopped there.
//
// The daemon never writes into a target directory: every state write is the
// worker's own or an operation's own, and both go through the core's
// functions (the operations write the config layer the way the CLI shell
// does — saveProjectConfig, renderAgentContract, ensurePointer — never
// `.auto/`, `docs/` unit state or an index tick); the daemon's view of a run
// is its child's output plus what the run leaves on disk.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { liveRunLock, lockStatusLine } from "@opencode-ai/auto-core/lock"
import { OP_DEFINITIONS, type OpOutcome } from "./ops"
import { DaemonStore, type RegisteredProject, type Scope } from "./store"
import { CONFIG_KEYS, HAND_EDITED_KEYS, frozenRefusal, parseOptions, parseSwitches, RequestError, type RunOptions } from "./request"

export const DEFAULT_PORT = 4770
export const DEFAULT_HOSTNAME = "127.0.0.1"

// The run states: starting (spawned, the run lock not yet observed), running
// (the worker holds .auto/run.lock), and the terminal states the exit-code
// vocabulary maps onto. A terminal run is immutable history.
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
//                                 (auto-core src/loop.ts:226-239)
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
  request: { options: RunOptions; switches: Record<string, string> }
  proc: Bun.Subprocess | undefined
  tail: string
  watcher: ReturnType<typeof setInterval> | undefined
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
  // Test/CLI observability: the registry as plain views.
  runs(): RunView[]
  stop(): Promise<void>
}

// The worker command, resolved once per daemon before the first spawn:
//   - a source layout (the daemon runs as `bun src/index.ts`, or in-process
//     in a test): the same interpreter on this module's neighbor entry
//     src/index.ts, which exists on the real filesystem;
//   - a compiled binary (script/build.ts): the embedded modules live on
//     Bun's virtual $bunfs, where a script path cannot be spawned — but
//     process.execPath already IS the server binary, whose argv goes
//     straight to the command dispatch (`<binary> worker '<json>'`).
async function deriveWorkerCommand(): Promise<{ command: string; prefix: string[] }> {
  if (!import.meta.dir.includes("$bunfs")) {
    const entry = join(import.meta.dir, "index.ts")
    if (existsSync(entry)) return { command: process.execPath, prefix: [entry] }
  }
  return { command: process.execPath, prefix: [] }
}

export async function startDaemon(options: DaemonOptions): Promise<DaemonHandle> {
  const store = new DaemonStore(options.dataDir)
  const worker = options.worker ?? (await deriveWorkerCommand())
  // The spawn cwd is arbitrary (the run target is the registry's absolute
  // path, the worker resolves it itself); it must only be a REAL directory
  // — in a compiled binary import.meta.dir sits on Bun's virtual $bunfs,
  // which no child process can be spawned in (posix_spawn answers ENOENT).
  const spawnCwd = import.meta.dir.includes("$bunfs") ? process.cwd() : import.meta.dir
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
  const opInFlight = new Set<string>()
  const liveRunOn = (directory: string): RunRecord | undefined =>
    [...runs.values()].find((run) => run.directory === directory && (run.state === "starting" || run.state === "running"))

  const view = (run: RunRecord): RunView => {
    const { proc: _proc, watcher: _watcher, ...rest } = run
    return { ...rest, live: run.state === "starting" || run.state === "running" }
  }

  // —— worker supervision ——

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
  }

  const watch = (run: RunRecord): void => {
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

  // One worker child per run. The spawn environment drops the daemon's
  // ambient OPENCODE_AUTO_* layer (a driver environment must not reach a
  // run — the per-run switches ride the request payload, applied by the
  // worker to its own fresh process) and keeps everything else, PATH and
  // XDG_CONFIG_HOME included (one operator, one agent tooling, one model
  // registry). The directory is the registry's absolute path, so the cwd is
  // only the spawn's working directory, never the run's target.
  const spawnWorker = (project: RegisteredProject, run: RunRecord, runOptions: RunOptions, switches: Record<string, string>): void => {
    const env: Record<string, string | undefined> = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^OPENCODE_AUTO_/.test(key)))
    const proc = Bun.spawn([worker.command, ...worker.prefix, "worker", JSON.stringify({ directory: project.directory, options: runOptions, switches })], {
      cwd: spawnCwd,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    run.pid = proc.pid
    run.proc = proc
    watch(run)
  }

  // —— HTTP plumbing ——

  const json = (status: number, body: Record<string, unknown>, headers?: Record<string, string>): Response =>
    new Response(JSON.stringify(body, null, 2) + "\n", { status, headers: { "content-type": "application/json", ...headers } })

  // Bearer-token auth: 401 for the missing and the unknown, the scopes for
  // the known. Digest comparison happens in the store.
  const scopesOf = (request: Request): { status: number; body: Record<string, unknown>; scopes?: Scope[] } => {
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

  // POST /runs: validate (registered project; options shaped as RunAllOpts
  // fields plus per-run env-switch overrides only — never config keys,
  // the same shared validator the worker enforces), refuse on conflicts,
  // spawn one worker, answer 202 with the run id.
  const postRuns = async (request: Request): Promise<Response> => {
    let body: unknown
    try {
      body = await request.json()
    } catch (error) {
      return json(400, { error: `the request body is not valid JSON: ${error instanceof Error ? error.message : String(error)}` })
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return json(400, { error: 'the run request is a JSON object: { "project": "<registered name or path>", "options"?: { … }, "switches"?: { … } }' })
    }
    const given = body as Record<string, unknown>
    for (const key of Object.keys(given)) {
      if (key === "project" || key === "options" || key === "switches") continue
      // The whitelist is absolute: a directory in the request body is
      // refused with the rule itself, not silently matched.
      if (key === "directory") {
        return json(400, {
          error:
            'a run request carries "project" (a registered project name or its registered absolute path), never "directory": the whitelist resolves run targets only against the registry (register with: opencode-auto-server register <dir>)',
        })
      }
      if (key === "config") {
        return json(400, { error: "a run request carries no config: the constitutional keys are frozen by init (.opencode/auto/config.json); revise them with opencode-auto amend <dir>, or edit that file directly" })
      }
      if (key in CONFIG_KEYS) return json(400, { error: frozenRefusal("", `"${key}" `, CONFIG_KEYS[key]!) })
      if (HAND_EDITED_KEYS.has(key)) {
        return json(400, { error: `"${key}" is a config key (hand-edited in .opencode/auto/config.json); a run request carries no config — config keys are frozen by init` })
      }
      return json(400, { error: `unknown request field "${key}" (the run request takes project, options and switches)` })
    }
    if (typeof given.project !== "string" || !given.project.trim()) {
      return json(400, { error: 'the run request requires "project": the registered project (name or registered absolute path) to run in' })
    }
    let options: RunOptions
    let switches: Record<string, string>
    try {
      options = parseOptions(given.options)
      switches = parseSwitches(given.switches)
    } catch (error) {
      if (error instanceof RequestError) return json(400, { error: error.message })
      throw error
    }
    // The whitelist: the target resolves only against the registry.
    const project = store.resolveProject(given.project.trim())
    if (!project) {
      return json(404, { error: `"${given.project.trim()}" is not a registered project: the whitelist resolves run targets only against the registry (register with: opencode-auto-server register <dir>)` })
    }
    // One run per directory, the registry first: a live run of this daemon
    // on the directory refuses the second spawn whether or not the lock is
    // observable yet (the starting window, or a crash whose exit observation
    // has not landed) — retryable, because the entry reaches a terminal
    // state on its own. A write operation in flight on the directory is the
    // same refusal from the other side (the operations hold the directory
    // while they write through the core).
    // AUTO-DECISION (the "stale-but-locked → 409" mapping): 409 is the
    // registry-vs-lock disagreement — the daemon's one-run-per-directory
    // reservation answering while the on-disk lock is stale or not yet
    // visible. A present-but-stale lock with no live registry run is NOT a
    // conflict: the spawn proceeds and the worker's runAll performs the
    // core's sanctioned next-acquirer cleanup (auto-core src/lock.ts:47-56),
    // which keeps this API as self-healing as the CLI; the daemon never
    // writes the lock itself (refusing a stale lock with no cleanup would
    // wedge the directory behind a 409 no blind retry could clear).
    if (opInFlight.has(project.directory)) {
      return json(409, {
        error: `an operation is in flight on ${project.name}; retry once it finishes (config operations and unit operations hold the directory while they write)`,
        retry: "retry once the operation completes — it is synchronous, so the very next request sees the directory free",
      })
    }
    const live = liveRunOn(project.directory)
    if (live) {
      return json(409, {
        error: `a run is already active on ${project.name}: run ${live.id} is ${live.state}`,
        run: { id: live.id, state: live.state },
        retry: "retry once the active run reaches a terminal state (GET the run to observe it)",
      })
    }
    // The lock, the arbiter between the daemon and every other process (the
    // CLI included — whichever process takes it first wins, assessment §8
    // Q8): a live holder answers 423 with the holder line. A present-but-
    // stale lock (its process gone) is NOT refused — the spawn proceeds and
    // the worker's own runAll performs the core's sanctioned next-acquirer
    // cleanup (auto-core src/lock.ts:47-56), so the API surface stays as
    // self-healing as the CLI and the daemon never touches the lock itself.
    const holder = liveRunLock(project.directory)
    if (holder !== undefined) {
      return json(423, {
        error: lockStatusLine(holder),
        holder: holder === "unreadable" ? undefined : holder,
        hint: "another driver process holds the directory's run lock; wait for it to finish or stop it (the CLI's exit-1 refusal is the same rule; if no such process exists, delete .auto/run.lock by hand — cross-host locks cannot be probed from here)",
      })
    }
    const id = `run-${String(++counter).padStart(6, "0")}`
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
      request: { options, switches },
      proc: undefined,
      tail: "",
      watcher: undefined,
    }
    runs.set(id, run)
    spawnWorker(project, run, options, switches)
    return json(202, { ...view(run), note: "the run was accepted; observe its lifecycle with GET /runs/<id> (state, mapped exit code, output tail)" }, { location: `/runs/${id}` })
  }

  // DELETE /runs/<id>: mid-run control in P1 is kill-only. The core's
  // process owns SIGINT (a single press is captured and logged; the second
  // within the window force-terminates with exit 130 — auto-core
  // src/loop.ts:82-96), so the daemon's kill is the double press: two
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
    return json(202, { ...view(run), note: "kill requested (double SIGINT, the force-terminate path); observe GET /runs/<id> for the terminal state (the vocabulary maps it to killed/130)" })
  }

  const fetchHandler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const segments = url.pathname.split("/").filter(Boolean)
    const method = request.method
    if (segments[0] === "health" && segments.length === 1 && method === "GET") {
      // AUTO-DECISION (health unauthenticated): the route answers liveness
      // only — no project names, no run state, nothing a token guards. A
      // probe endpoint that needs the credential it is probing for could
      // not tell a wrong token apart from a daemon that is down.
      return json(200, { ok: true, service: "opencode-auto-server" })
    }
    if (segments[0] === "runs") {
      if (segments.length === 1 && method === "GET") {
        const denied = needScope(request, "listing runs", "read")
        if (denied) return denied
        return json(200, { runs: [...runs.values()].map(view) })
      }
      if (segments.length === 1 && method === "POST") {
        const denied = needScope(request, "starting a run", "control")
        if (denied) return denied
        return await postRuns(request)
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
    // The P1d operation surface: /projects/<project>/<op>, one entry per
    // OP_DEFINITIONS (config ops, units, models, the plan boundary). The
    // whitelist is the same absolute rule as POST /runs — the project
    // resolves only against the registry, never against the request path
    // itself.
    if (segments[0] === "projects" && segments.length === 3) {
      const name = safeDecode(segments[1]!)
      const op = OP_DEFINITIONS.find((entry) => entry.segment === segments[2] && entry.method === method)
      if (!name || !op) {
        return json(404, {
          error: `no route ${method} ${url.pathname} (P1d serves the project operations ${OP_DEFINITIONS.map((entry) => `${entry.method} /projects/<project>/${entry.segment}`).join(", ")}; the P1c run surface is GET /health, GET /runs, POST /runs, GET /runs/<id>, DELETE /runs/<id>)`,
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
            retry: "retry once the active run reaches a terminal state (GET the run to observe it); read-only operations (models, fix dryrun) run beside it",
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
    return json(404, { error: `no route ${method} ${url.pathname} (P1c serves: GET /health, GET /runs, POST /runs, GET /runs/<id>, DELETE /runs/<id>; P1d serves the /projects/<project>/<op> operations)` })
  }

  const server = Bun.serve({ port: options.port ?? DEFAULT_PORT, hostname: options.hostname ?? DEFAULT_HOSTNAME, fetch: fetchHandler })

  const handle: DaemonHandle = {
    port: server.port ?? options.port ?? DEFAULT_PORT,
    hostname: server.hostname ?? options.hostname ?? DEFAULT_HOSTNAME,
    url: `http://${server.hostname ?? options.hostname ?? DEFAULT_HOSTNAME}:${server.port ?? options.port ?? DEFAULT_PORT}`,
    store,
    runs: () => [...runs.values()].map(view),
    stop: async () => {
      // Stopping the daemon stops serving; live workers are NOT killed —
      // they are self-sufficient processes whose runs complete and leave
      // their state on disk, and the lock arbitrates any successor (a
      // restarted daemon answers 423 while an orphan still holds a
      // directory). Workers are cattle, not pets.
      for (const run of runs.values()) if (run.watcher) clearInterval(run.watcher)
      server.stop(true)
    },
  }
  return handle
}
