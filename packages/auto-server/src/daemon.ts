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
//     control / config / answer / probe. Unauthenticated → 401, a known
//     token without the route's scope → 403. `config` guards the P1d config
//     operations, `control` the unit/lifecycle operations that write git
//     through the core, `read` the models table; `answer` names the P3c
//     question queue; `probe` guards the model probe alone (P4b, POST
//     /projects/<project>/models) — opt-in and disabled by default: no
//     default token set carries it, and beside the scope the probe takes an
//     explicit confirm field and this daemon's own rate window (below);
//   - the run registry and worker supervision: one worker child process per
//     run (the P1b entry, spawned as a subprocess — never imported: one run
//     per process is the core's own invariant), with the run's exit-code
//     vocabulary mapped onto run states and lock conflicts mapped onto
//     HTTP;
//   - the lifecycle operations (P1d, src/ops.ts): config ops, units, models
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
// does — saveProjectConfig, renderAgentContract, ensurePointer — never
// `.auto/`, `docs/` unit state or an index tick); the daemon's view of a run
// is its child's output plus what the run leaves on disk. The daemon's OWN
// writes live in its own data directory: the whitelist, the token digests
// (src/store.ts) and, since P3c, the question journal
// (src/question-journal.ts) — never under a target's `.auto/`.
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { liveRunLock, lockStatusLine } from "@opencode-ai/auto-core/lock"
import { createHub, freshRunSecret, interactiveHandlers, settleOpenQuestions, type InteractiveHub, type SocketData } from "./interactive-ws"
import { appendJournal, compactJournal, foldJournal, journalRunFloor, readJournal } from "./question-journal"
import { readStatusModel, statusEventsResponse, tailResponse, type TailChannel } from "./observe"
import { OP_DEFINITIONS, type OpOutcome } from "./ops"
import { CLIENT_APP_JS, CLIENT_INDEX_HTML } from "./web/client"
import { DaemonStore, type RegisteredProject, type Scope } from "./store"
import { CONFIG_KEYS, HAND_EDITED_KEYS, frozenRefusal, parseOptions, parseSwitches, parsePlan, RequestError, type PlanPayload, type RunOptions, type TransportPayload } from "./request"
import { PROTOCOL_VERSION } from "./ws-protocol"

export const DEFAULT_PORT = 4770
export const DEFAULT_HOSTNAME = "127.0.0.1"

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
export type RunState = "starting" | "running" | "completed" | "failed" | "blocked" | "paused" | "killed" | "restored"
export type TerminalState = Exclude<RunState, "starting" | "running" | "restored">
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
  // One interactive hub per run (P3b, src/interactive-ws.ts): the run
  // secret the spawn payload carries, the worker bridge socket, the client
  // sockets and the still-open questions. Beside the registry (not on the
  // record) so the run view stays the wire shape it always was; it lives
  // exactly as long as the registry entry does — this process, or (P3c) a
  // restart that restores it from the question journal below.
  const hubs = new Map<string, InteractiveHub>()
  let counter = 0

  // —— the persistent pending-question queue (P3c, src/question-journal.ts) ——
  //
  // Replay the daemon's own journal at start: every run it left with an
  // open question comes back as a `restored` registry stub beside its hub
  // (the journaled secret re-authenticates the orphan worker's bridge
  // reconnect, the journaled questions redeliver to the first client that
  // connects), and the journal is compacted down to that pending set —
  // history does not survive a restart (P1's own decision, unchanged); the
  // pending state does. This is daemon-owned state in the daemon's own data
  // directory, never under a target directory's `.auto/` (the
  // driver-exclusive-writes constitution).
  const { events: journalEvents, skipped: journalSkipped } = readJournal(options.dataDir)
  if (journalSkipped > 0) {
    console.error(`the question journal under ${options.dataDir} holds ${journalSkipped} record(s) this version does not read (a torn crash tail or a newer format); they were skipped at replay`)
  }
  counter = journalRunFloor(journalEvents)
  const restoredRuns = foldJournal(journalEvents)
  for (const restored of restoredRuns.values()) {
    if (runs.has(restored.run)) continue
    runs.set(restored.run, {
      id: restored.run,
      project: restored.project,
      directory: restored.directory,
      state: "restored",
      code: null,
      signal: null,
      pid: null,
      started: restored.started,
      ended: null,
      request: { options: restored.request.options as unknown as RunOptions, switches: restored.request.switches },
      proc: undefined,
      tail: "",
      watcher: undefined,
    })
    const hub = createHub(restored.secret)
    for (const question of restored.questions) hub.questions.set(question.id, question)
    hubs.set(restored.run, hub)
  }
  compactJournal(options.dataDir, journalEvents, restoredRuns)

  // The journal's append side, as the interactive handlers and the run
  // supervision call it (best-effort inside: a journal that cannot be
  // written degrades durability, never serving).
  const journalRaise = (run: string, question: { id: string; text: string; minutes?: number }): void => {
    appendJournal(options.dataDir, { v: 1, at: new Date().toISOString(), run, event: "raised", id: question.id, text: question.text, ...(question.minutes !== undefined ? { minutes: question.minutes } : {}) })
  }
  const journalSettle = (run: string, id: string, how: "answered" | "timeout" | "transport" | "closed"): void => {
    appendJournal(options.dataDir, { v: 1, at: new Date().toISOString(), run, event: "settled", id, how })
  }

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

  // The daemon-wide model-probe rate window (P4b, assessment §8 Q7): one
  // probe per window per DAEMON — not per token, not per project, because
  // the tokens a probe spends are the operator's one wallet and the agents
  // it starts are this machine's. The claim is atomic (checked and recorded
  // in one step), so two concurrent confirmed probes cannot both fire; a
  // request that never reaches the claim (no scope, no confirmation, no
  // registry) consumes nothing. Daemon-owned in-memory state, gone with the
  // daemon: a restart reopens the window, which is the operator's own act.
  // AUTO-DECISION (10 minutes): the probe's cost is N short agent turns per
  // fire; a window that spans a coffee break bounds an over-eager operator
  // (or a refreshed tab) to six fires an hour while a deliberate fleet
  // check stays anytime-the-window-is-open. The CLI knows no such limit —
  // a terminal is one person's one act; a served route is not.
  const PROBE_RATE_WINDOW_MS = 10 * 60_000
  let probeFiredAt: number | undefined
  const probeWindow = {
    claim: (): { ok: true } | { ok: false; firedAt: string; retryAt: string } => {
      const now = Date.now()
      if (probeFiredAt !== undefined && now - probeFiredAt < PROBE_RATE_WINDOW_MS) {
        return { ok: false, firedAt: new Date(probeFiredAt).toISOString(), retryAt: new Date(probeFiredAt + PROBE_RATE_WINDOW_MS).toISOString() }
      }
      probeFiredAt = now
      return { ok: true }
    },
  }

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
    // The run is over: any question still open in its hub retires as
    // `closed` — a durable settlement (journaled, unlike a bridge blip),
    // because the process that held the ask has ended. Usually the bridge
    // socket's own close already settled them for the clients; this covers
    // the ordering race and journals the ids either way.
    const hub = hubs.get(run.id)
    if (hub !== undefined) {
      for (const id of settleOpenQuestions(hub, "closed")) journalSettle(run.id, id, "closed")
    }
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
  // only the spawn's working directory, never the run's target. The payload
  // carries the P3b interactive transport (the worker bridge URL and the
  // per-run secret) whenever the daemon is serving it: the worker entry
  // builds its Interactive implementation from it and injects it through
  // RunAllOpts.interactive (the P3a seam), so a question raised inside the
  // run is answerable from outside the process.
  const spawnWorker = (project: RegisteredProject, run: RunRecord, runOptions: RunOptions, switches: Record<string, string>, transport?: TransportPayload, plan?: PlanPayload): void => {
    const env: Record<string, string | undefined> = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^OPENCODE_AUTO_/.test(key)))
    const proc = Bun.spawn([worker.command, ...worker.prefix, "worker", JSON.stringify({ directory: project.directory, options: runOptions, switches, ...(transport ? { transport } : {}), ...(plan ? { plan } : {}) })], {
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

  // Register and spawn one run — the tail POST /runs and the plan
  // operation's unlocked loop route share (P3c): the registry entry, the
  // interactive hub with its per-run secret (journal `opened` written
  // before the worker can raise anything, so a restart mid-question
  // reconstructs the run), the transport payload, the spawn. The caller
  // owns the guards (the whitelist, the conflicts) and the response.
  const startRun = (project: RegisteredProject, runOptions: RunOptions, switches: Record<string, string>, server: Bun.Server<SocketData>, plan?: PlanPayload): RunRecord => {
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
      request: { options: runOptions, switches },
      proc: undefined,
      tail: "",
      watcher: undefined,
    }
    runs.set(id, run)
    // The interactive hub (P3b): the per-run secret exists before the spawn
    // — the worker's bridge URL names this daemon's address, and its token
    // is the secret the upgrade compares. The registry entry and the hub
    // are created together; the worker connects back within seconds of its
    // start. The journal's `opened` lands in the same window: the run
    // identity a restart needs to serve this run's pending questions
    // again.
    const secret = freshRunSecret()
    hubs.set(id, createHub(secret))
    appendJournal(options.dataDir, { v: 1, at: new Date().toISOString(), run: id, event: "opened", project: project.name, directory: project.directory, secret, started: run.started, request: { options: runOptions as unknown as Record<string, unknown>, switches } })
    // The transport URL names this daemon's own bound address (the worker
    // connects back on the loopback or whatever host the operator bound;
    // the spawn and the bridge are the same machine in v1).
    const transport: TransportPayload = { run: id, url: `ws://${server.hostname ?? DEFAULT_HOSTNAME}:${server.port}/runs/${id}/worker`, token: secret }
    spawnWorker(project, run, runOptions, switches, transport, plan)
    return run
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

  // POST /runs: validate (registered project; options shaped as RunAllOpts
  // fields plus per-run env-switch overrides only — never config keys,
  // the same shared validator the worker enforces), refuse on conflicts,
  // spawn one worker, answer 202 with the run id.
  const postRuns = async (request: Request, server: Bun.Server<SocketData>): Promise<Response> => {
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
      // The plan surface is the plan operation (P3c): it serves planPrelude's
      // no-agent routes first and spawns the planning session with its input
      // semantics — a run request cannot smuggle planning mode past that.
      if (key === "plan") {
        return json(400, { error: 'a run request carries no "plan": the planning surface is the plan operation (POST /projects/<project>/plan, taking "input" and "append"), which serves the no-agent routes first and spawns the planning session' })
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
    const id = startRun(project, options, switches, server).id
    return json(202, { ...view(runs.get(id)!), note: "the run was accepted; observe its lifecycle with GET /runs/<id> (state, mapped exit code, output tail), and drive it interactively over the WebSocket endpoint /runs/<id>/interactive (questions and /exit, /failback control)", interactive: `/runs/${id}/interactive` }, { location: `/runs/${id}` })
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
    if (run.state === "restored") {
      // A restored run is not this daemon's child: there is no process here
      // to signal, and pretending a kill was requested would be a 202 that
      // does nothing. The worker is an orphan of the restart — if it still
      // runs, the directory's lock (and the machine's process table) is
      // where it lives; if it is gone, the lock is stale and the next run's
      // own next-acquirer cleanup handles it.
      return json(409, {
        error: `run ${run.id} was restored from the question journal after a daemon restart: its worker is not this daemon's child, so there is nothing here to kill`,
        run: view(run),
        hint: "stop the worker process on this machine directly if it still runs (its pid was in the previous daemon's registry; .auto/run.lock names it), or — if no such process exists — delete .auto/run.lock by hand",
      })
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

  const fetchHandler = async (request: Request, server: Bun.Server<SocketData>): Promise<Response> => {
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
    // The Web client (P4a): the static shell, served from the package's own
    // embedded assets (script/build-web.ts bundles web/ into src/web/client.ts
    // — string constants, so source layout, test harness and compiled binary
    // all serve the same bytes). The shell is unauthenticated by the same
    // reasoning as /health above: it carries NO data (no project names, no
    // run state — the page is the login form itself, and it cannot prompt for
    // a token before it has loaded). Every route the shell calls after that
    // requires the token; the client's scope-aware UI reads GET /session.
    if (segments.length === 0 && method === "GET") {
      return new Response(CLIENT_INDEX_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } })
    }
    if (segments[0] === "app.js" && segments.length === 1 && method === "GET") {
      return new Response(CLIENT_APP_JS, { status: 200, headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } })
    }
    // The client's scope source (P4a): any known token, no specific scope —
    // the typed answer to "what can this token do". The client's UI gating
    // (controls without `control`, the question UI without `answer`) reads
    // this and nothing else: deriving scopes by parsing 403 refusal prose
    // would be scraping, the exact discipline the client exists to keep.
    if (segments[0] === "session" && segments.length === 1 && method === "GET") {
      const auth = scopesOf(request)
      if (auth.scopes === undefined) return json(auth.status, auth.body)
      return json(200, { service: "opencode-auto-server", scopes: auth.scopes })
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
    if (segments[0] === "runs") {
      if (segments.length === 1 && method === "GET") {
        const denied = needScope(request, "listing runs", "read")
        if (denied) return denied
        return json(200, { runs: [...runs.values()].map(view) })
      }
      if (segments.length === 1 && method === "POST") {
        const denied = needScope(request, "starting a run", "control")
        if (denied) return denied
        return await postRuns(request, server)
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
    // The P3b interactive surface (src/interactive-ws.ts): the worker
    // bridge and the client endpoint, both WebSocket upgrades over the same
    // typed versioned protocol (src/ws-protocol.ts). The client endpoint
    // multiplexes the question channel (`answer` scope) and the control
    // channel (`control` scope); the worker bridge authenticates with the
    // per-run secret the spawn payload carried — never an operator token,
    // so a bridge socket can do exactly one run's interactive work and
    // nothing else. Auth precedes the upgrade (a refusal is the plain JSON
    // status, the same family as every route above).
    if (segments[0] === "runs" && segments.length === 3 && method === "GET" && (segments[2] === "worker" || segments[2] === "interactive")) {
      const run = findRun(segments[1]!)
      if (!run) return json(404, { error: `no run ${segments[1]} (runs are identified by the id POST /runs returned)` })
      // Auth precedes the websocket check (the refusals are the same plain
      // JSON statuses every route above answers, so a probe or a misrouted
      // client learns its fate without a handshake).
      const hub = hubs.get(run.id)!
      if (segments[2] === "worker") {
        const presented = url.searchParams.get("token")
        if (presented !== hub.secret) {
          return json(401, { error: "unknown run secret: the worker bridge authenticates with the per-run secret the run's spawn payload carried" })
        }
      } else {
        const auth = scopesForSocket(request, url)
        if (auth.scopes === undefined) return json(auth.status, auth.body)
        if (!auth.scopes.includes("answer") && !auth.scopes.includes("control")) {
          return json(403, { error: `the interactive surface requires the "answer" or "control" scope ("answer" guards questions, "control" guards run control); this token carries: ${auth.scopes.join(", ")}` })
        }
        if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
          return json(400, { error: `this route is a WebSocket endpoint: upgrade to websocket and speak the interactive transport protocol v${PROTOCOL_VERSION} (see docs/daemon.md)` })
        }
        if (server.upgrade(request, { data: { kind: "client", run: run.id, scopes: auth.scopes } satisfies SocketData })) return new Response(null)
        return json(400, { error: "the websocket upgrade failed" })
      }
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return json(400, { error: `this route is a WebSocket endpoint: upgrade to websocket and speak the interactive transport protocol v${PROTOCOL_VERSION} (see docs/daemon.md)` })
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
    // OP_DEFINITIONS (config ops, units, models, the plan boundary). The
    // whitelist is the same absolute rule as POST /runs — the project
    // resolves only against the registry, never against the request path
    // itself.
    if (segments[0] === "projects" && segments.length === 3) {
      const name = safeDecode(segments[1]!)
      const op = OP_DEFINITIONS.find((entry) => entry.segment === segments[2] && entry.method === method)
      if (!name || !op) {
        return json(404, {
          error: `no route ${method} ${url.pathname} (P1d serves the project operations ${OP_DEFINITIONS.map((entry) => `${entry.method} /projects/<project>/${entry.segment}${entry.method === "POST" && entry.segment === "models" ? " — the probe: its own probe scope, the confirm field, rate-limited" : ""}`).join(", ")}; the P1c run surface is GET /health, GET /runs, POST /runs, GET /runs/<id>, DELETE /runs/<id>; the P1e observability surface is GET /projects/<project>/status, GET /projects/<project>/log and GET /projects/<project>/events; the P2b structured events channel is GET /projects/<project>/status-events; the P3b interactive transport is the WebSocket endpoints GET /runs/<id>/interactive (clients) and GET /runs/<id>/worker (the run's bridge); the P4a client surface is GET / (the Web client), GET /app.js, GET /session (the token's scopes) and GET /projects (the whitelist))`,
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
        // The plan operation's unlocked loop route spawns a planning run
        // (P3c): the same startRun POST /runs uses, carrying the plan
        // payload (stopBefore === "execute" through the worker entry). The
        // op has released the run lock by the time it calls this (the
        // worker's own runAll takes the lock, and the daemon's in-process
        // hold would refuse its own child).
        const spawnPlanningRun = (plan: PlanPayload): OpOutcome => {
          const live = liveRunOn(project.directory)
          if (live) {
            return {
              status: 409,
              body: {
                error: `a run is already active on ${project.name}: run ${live.id} is ${live.state}`,
                run: { id: live.id, state: live.state },
                retry: "retry once the active run reaches a terminal state (GET the run to observe it)",
              },
            }
          }
          const run = startRun(project, parseOptions(undefined), {}, server, plan)
          return {
            status: 202,
            body: {
              ...view(run),
              lines: [
                `✓ planning session started as run ${run.id} (stopBefore: execute — humanQuestions armed, the questions ride the interactive transport)`,
                `next: review the plan over GET /runs/${run.id} and the project's observability surface; answer its questions over the WebSocket endpoint /runs/${run.id}/interactive`,
              ],
              note: "the planning run was accepted; observe its lifecycle with GET /runs/<id> (state, mapped exit code, output tail), and answer its questions over the WebSocket endpoint /runs/<id>/interactive",
              interactive: `/runs/${run.id}/interactive`,
            },
          }
        }
        if (!op.write(body)) return envelope(await op.run({ project, body, query: url.searchParams, spawnPlanningRun, probeWindow }))
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
          return envelope(await op.run({ project, body, query: url.searchParams, spawnPlanningRun, probeWindow }))
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
    return json(404, { error: `no route ${method} ${url.pathname} (P1c serves: GET /health, GET /runs, POST /runs, GET /runs/<id>, DELETE /runs/<id>; P1d serves the /projects/<project>/<op> operations (GET models is the table; POST models is the probe — its own probe scope, the confirm field, rate-limited); P1e serves GET /projects/<project>/status|log|events — the status read model and the SSE tails; P2b serves GET /projects/<project>/status-events — the typed driver-events stream; P3b serves the WebSocket interactive transport GET /runs/<id>/interactive (clients) and GET /runs/<id>/worker (the run's bridge); P4a serves GET / — the Web client — with GET /app.js, GET /session (the token's scopes) and GET /projects (the whitelist))` })
  }

  const server = Bun.serve<SocketData>({
    port: options.port ?? DEFAULT_PORT,
    hostname: options.hostname ?? DEFAULT_HOSTNAME,
    fetch: fetchHandler,
    // The P3b interactive transport's sockets (src/interactive-ws.ts): the
    // run's worker bridge and the interactive clients, dispatched by the
    // SocketData each upgrade stamped. Bun.serve's own WebSocket support —
    // the isolation line holds (zero added runtime dependencies). The
    // journal hooks (P3c) make the queue durable: every first-held ask and
    // every durable settlement is appended to the daemon's own journal, so
    // a restart replays the pending set.
    websocket: interactiveHandlers({
      hubOf: (run) => hubs.get(run),
      stateOf: (run) => runs.get(run)?.state,
      onRaise: journalRaise,
      onSettle: journalSettle,
    }),
  })

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
