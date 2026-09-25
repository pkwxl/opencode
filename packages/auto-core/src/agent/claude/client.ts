// claude headless adapter (MA.5, design plans/0041): the AgentClient over
// `claude -p` subprocesses. Each session that is working has one live process
// in streaming-input mode:
//
//   claude -p --output-format stream-json --input-format stream-json
//          --replay-user-messages --verbose  <session> [--model m] <contract>
//
// A prompt is one JSON user message on its stdin. The process keeps reading
// stdin while it works, so a message written mid-turn joins the running turn
// at the next tool boundary: that is `steer` (promptAsync). The turn's
// `result` line ends it; once nothing we wrote is still unconsumed the adapter
// emits `idle` and closes stdin, and the process exits. The next prompt starts
// a new process that resumes the session (`--resume <id>`), rereading
// AGENTS.md and the contract — so syncContext has nothing to do.
//
// Sessions: `create` mints the id (`--session-id` on the first start); `fork`
// mints one too and records the source (`--resume <src> --fork-session
// --session-id <new>` on its first start: whole-session copies only, no
// message anchor → fork "session"). `abort` kills the process; the
// transcript claude persisted up to there stays resumable.
//
// Every call resolves (0037 D2). Question and permission events never occur
// (AskUserQuestion is disallowed; permissions are fixed per process start by
// the preset, contract.ts), so their reply calls report failure.
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { AgentCapabilities, AgentClient, AgentEnv, AgentErrorPatterns, AgentEvent, AgentResult, PermissionPreset, PromptInput } from "../types"
import { contractArgs } from "./contract"
import { claudeStream, MODEL_PREFIX } from "./stream"

export const CLAUDE_CAPABILITIES: AgentCapabilities = {
  resume: true,
  fork: "session",
  steer: true,
  abort: true,
  question: false,
  permission: false,
  // Transcripts exist on disk (~/.claude/projects/...) but their format is
  // internal; the driver's rebuild paths degrade instead (MA.4 row).
  history: false,
  usage: "events",
}

// claude's own error wording (the assistant `error` code, folded into the
// classified message by watch). The neutral table in chain.ts already covers
// "credit" / "usage limit" / HTTP statuses.
export const CLAUDE_ERROR_PATTERNS: AgentErrorPatterns = {
  overflow: /prompt is too long|context_length_exceeded|exceeds? the context window/i,
  quota: /billing_error/i,
  auth: /authentication_failed|invalid api key|not logged in|please run \/login/i,
  rate: /rate_limit/i,
  transient: /server_error|claude process exited/i,
}

// One subprocess, as the manager needs it (Bun.spawn in production, a scripted
// double in tests).
export type ClaudeProcess = {
  write(line: string): void
  // Close stdin: the process finishes what it read and exits.
  end(): void
  kill(): void
  readonly lines: AsyncIterable<string>
  readonly exited: Promise<{ code: number | null; stderr: string }>
}
export type ClaudeSpawn = (args: string[], options: { cwd: string; env: Record<string, string | undefined> }) => ClaudeProcess

export type ClaudeAgentOptions = {
  directory: string
  permission: PermissionPreset
  bin?: string
  // The agent profile's overlay on the processes' environment (null removes
  // an inherited variable); absent = the driver's environment as it is.
  env?: AgentEnv
  log?: (line: string) => void
  spawn?: ClaudeSpawn
  // Where claude keeps transcripts, for `get` on ids this process never ran
  // (a resumed run); absent = <config dir>/projects, where the config dir is
  // the one the processes see: the overlay's CLAUDE_CONFIG_DIR when it sets
  // or removes one, otherwise the driver's, otherwise ~/.claude.
  projectsDir?: string
  // Arguments from the target directory (contract, permissions); absent =
  // contract.ts contractArgs.
  contract?: (agent: string | undefined) => Promise<{ args: string[] } | { error: string }>
}

type Live = {
  proc: ClaudeProcess
  model?: string
  // Messages written that claude has not echoed back yet (not yet consumed).
  unacked: number
  // A turn is running (from the first write until an idle result).
  busy: boolean
  // Killed by abort() or the block preset: the exit is expected.
  killed: boolean
  // stdin closed (idle, or a model change): takes no more messages.
  closing: boolean
  exited: boolean
  done: Promise<void>
}

type Session = {
  // new = minted, never started; fork = minted as a copy of `from`, never
  // started; stored = claude has it (it announced the session).
  state: "new" | "fork" | "stored"
  from?: string
  title?: string
  live?: Live
  // The session's running cost total as of its last result (claude reports
  // totals, stream.ts bills differences); absent = not seen in this process.
  cost?: number
  starting?: Promise<AgentResult<Live>>
}

// Environment of a Claude Code session the driver itself may run inside
// (developer machines): a child must not believe it is that session.
const SESSION_ENV = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_(SESSION_ID|CHILD_SESSION|SESSION_ATTENDED|ENTRYPOINT|MESSAGING_\w+))$/

// The environment of a claude process: the driver's minus the Claude Code
// session variables, overlaid by the agent profile's env (plans/0055 F14; a
// null removes the inherited variable). The overlay comes last, so a profile
// may set any variable, a session variable included.
export function claudeEnv(overlay?: AgentEnv, base: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(base)) if (!SESSION_ENV.test(key)) env[key] = value
  for (const [key, value] of Object.entries(overlay ?? {})) {
    if (value === null) delete env[key]
    else env[key] = value
  }
  return env
}

// The directory claude keeps its transcripts in, for the environment its
// processes see: CLAUDE_CONFIG_DIR from the overlay when the overlay names it
// (a null removal means claude's default), otherwise the driver's.
// AUTO-RESOLVE: where do transcripts live when the profile env removes CLAUDE_CONFIG_DIR (null) while the driver has one? -> claude's default ~/.claude (the lookup follows the environment the claude processes actually run in, and they no longer see the driver's variable)
export function claudeProjectsDir(overlay?: AgentEnv, base: Record<string, string | undefined> = process.env): string {
  const own = overlay && Object.hasOwn(overlay, "CLAUDE_CONFIG_DIR") ? overlay.CLAUDE_CONFIG_DIR : base.CLAUDE_CONFIG_DIR
  return join(own ?? join(homedir(), ".claude"), "projects")
}

const fail = (error: unknown): AgentResult<never> => ({ ok: false, error })
const done: AgentResult = { ok: true, value: undefined }

export function claudeAgent(options: ClaudeAgentOptions): AgentClient & { close(): void } {
  const { directory } = options
  const bin = options.bin ?? "claude"
  const spawn = options.spawn ?? bunSpawn
  const contract = options.contract ?? ((agent) => contractArgs(directory, agent, options.permission))
  const projects = options.projectsDir ?? claudeProjectsDir(options.env)
  const sessions = new Map<string, Session>()
  const subscribers = new Set<(event: AgentEvent) => void>()
  // Context windows claude reported (result modelUsage), keyed by the
  // adapter's model string. The map is handed out live: a caller that cached
  // it sees windows learned later.
  const limits = new Map<string, number>()

  const emit = (event: AgentEvent) => {
    for (const push of subscribers) push(event)
  }

  // claude files a transcript per session under a directory named after the
  // working directory, every non-alphanumeric character replaced by "-".
  const transcript = (id: string) => join(projects, directory.replace(/[^a-zA-Z0-9]/g, "-"), `${id}.jsonl`)

  const known = (id: string): Session | undefined => {
    const found = sessions.get(id)
    if (found) return found
    if (!existsSync(transcript(id))) return undefined
    const stored: Session = { state: "stored" }
    sessions.set(id, stored)
    return stored
  }

  // The running cost total claude last filed for a session this process has
  // not seen (a session resumed from an earlier run): the transcript's last
  // cost-state record, best effort — undefined when unreadable.
  const savedCost = async (id: string): Promise<number | undefined> => {
    const text = await Bun.file(transcript(id)).text().catch(() => "")
    const at = text.lastIndexOf('"type":"cost-state"')
    if (at < 0) return undefined
    const line = text.slice(text.lastIndexOf("\n", at) + 1, (text.indexOf("\n", at) + 1 || text.length + 1) - 1)
    try {
      const total = JSON.parse(line).totalCostUSD
      return typeof total === "number" ? total : undefined
    } catch {
      return undefined
    }
  }

  const start = async (id: string, s: Session, input: PromptInput): Promise<AgentResult<Live>> => {
    const extra = await contract(input.agent)
    if ("error" in extra) return fail(new Error(extra.error))
    const model = input.model !== undefined ? input.model.slice(input.model.indexOf("/") + 1) : undefined
    const which =
      s.state === "new" ? ["--session-id", id] : s.state === "fork" ? ["--resume", s.from!, "--fork-session", "--session-id", id] : ["--resume", id]
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--replay-user-messages",
      "--verbose",
      ...which,
      ...(model ? ["--model", model] : []),
      ...(s.title ? ["--name", s.title] : []),
      ...extra.args,
    ]
    const env = claudeEnv(options.env)
    const base = s.state === "new" ? 0 : s.state === "fork" ? (sessions.get(s.from!)?.cost ?? (await savedCost(s.from!))) : (s.cost ?? (await savedCost(id)))
    let proc: ClaudeProcess
    try {
      proc = spawn([bin, ...args], { cwd: directory, env })
    } catch (error) {
      return fail(error)
    }
    const live: Live = { proc, model, unacked: 0, busy: false, killed: false, closing: false, exited: false, done: Promise.resolve() }
    s.live = live
    live.done = pump(id, s, live, base)
    return { ok: true, value: live }
  }

  // Reads one process to its end: maps lines, decides idle, handles exit.
  const pump = async (id: string, s: Session, live: Live, costBase: number | undefined) => {
    const stream = claudeStream(id, costBase)
    try {
      for await (const text of live.proc.lines) {
        let line: Record<string, any>
        try {
          line = JSON.parse(text)
        } catch {
          continue
        }
        if (line.type === "system" && line.subtype === "init") {
          // The session exists on claude's side from here on.
          s.state = "stored"
          s.from = undefined
        }
        if (line.type === "user" && line.isReplay && !line.parent_tool_use_id) live.unacked = Math.max(0, live.unacked - 1)
        for (const event of stream.feed(line)) emit(event)
        if (line.type === "system" && line.subtype === "permission_denied" && options.permission === "block" && !live.killed) {
          // The block preset (MA.4 D4): refuse and end the turn with a
          // non-retryable error, so the run blocks for a human.
          emit({
            type: "error",
            session: id,
            error: {
              name: "PermissionDenied",
              message: `permission denied (--permission ask-fail): ${line.tool_name}: ${line.message ?? ""}. Allow it in the permission rules of the target directory's opencode.json, then re-run.`,
              isRetryable: false,
            },
          })
          live.killed = true
          live.proc.kill()
        }
        if (line.type === "result") {
          if (typeof line.total_cost_usd === "number") s.cost = line.total_cost_usd
          for (const [name, usage] of Object.entries((line.modelUsage ?? {}) as Record<string, { contextWindow?: number }>)) {
            if (typeof usage?.contextWindow === "number") limits.set(`${MODEL_PREFIX}${name}`, usage.contextWindow)
          }
          // Still working when something we wrote waits unread or queued.
          const queued = typeof line.queued_turn_count === "number" ? line.queued_turn_count : 0
          if (live.unacked > 0 || queued > 0) continue
          live.busy = false
          live.closing = true
          live.proc.end()
          emit({ type: "idle", session: id })
        }
      }
    } catch {}
    const { code, stderr } = await live.proc.exited.catch(() => ({ code: null, stderr: "" }))
    live.exited = true
    if (s.live === live) s.live = undefined
    if (!live.busy) return
    live.busy = false
    if (!live.killed) {
      const tail = stderr.trim().split("\n").slice(-5).join("\n")
      emit({ type: "error", session: id, error: { name: "ProcessExit", message: `claude process exited (code ${code}) before the turn finished${tail ? `: ${tail}` : ""}` } })
    }
    emit({ type: "idle", session: id })
  }

  // Hands a message to the session's live process, starting one if needed.
  // A prompt naming another model than the live process was started with
  // restarts it between turns (the model is fixed per process).
  const send = async (input: PromptInput, signal?: AbortSignal): Promise<AgentResult> => {
    const s = known(input.session)
    if (!s) return fail(new Error(`session not found: ${input.session}`))
    const wanted = input.model !== undefined ? input.model.slice(input.model.indexOf("/") + 1) : undefined
    let live = s.live && !s.live.exited ? s.live : undefined
    if (live && !live.busy && wanted !== undefined && wanted !== live.model) {
      live.closing = true
      live.proc.end()
    }
    // A closing process finishes on its own; the message goes to the next one
    // (which resumes the session once this one has let go of it).
    if (live?.closing) {
      await live.done
      live = undefined
    }
    if (signal?.aborted) return fail(signal.reason ?? new Error("dispatch aborted"))
    if (!live) {
      // One start at a time per session: a second message arriving while the
      // first start is under way goes to the same process.
      s.starting ??= start(input.session, s, input).finally(() => (s.starting = undefined))
      const started = await s.starting
      if (!started.ok) return started
      live = started.value
    }
    const message = { type: "user", message: { role: "user", content: [{ type: "text", text: input.text }] } }
    try {
      live.proc.write(`${JSON.stringify(message)}\n`)
    } catch (error) {
      return fail(error)
    }
    live.unacked++
    live.busy = true
    return done
  }

  return {
    capabilities: CLAUDE_CAPABILITIES,
    errorPatterns: CLAUDE_ERROR_PATTERNS,
    async create({ title }) {
      const id = crypto.randomUUID()
      sessions.set(id, { state: "new", title })
      return { ok: true, value: { id } }
    },
    // Resolves once the message is handed over; the turn is read from events.
    prompt: (input, signal) => send(input, signal),
    promptAsync: (input) => send(input),
    async abort(session) {
      const live = sessions.get(session)?.live
      if (live && !live.exited) {
        live.killed = true
        live.proc.kill()
      }
      return done
    },
    // Whole-session copies only (fork "session"); the driver drops `before`
    // for this capability (session-api forkSession).
    async fork(session) {
      const source = known(session)
      if (!source) return fail(new Error(`session not found: ${session}`))
      const id = crypto.randomUUID()
      // Copying a session claude never saw copies nothing: a fresh session.
      const copy: Session =
        source.state === "new" ? { state: "new" } : source.state === "fork" ? { state: "fork", from: source.from } : { state: "fork", from: session }
      sessions.set(id, { ...copy, title: source.title })
      return { ok: true, value: { id } }
    },
    // Used as the display name of the next process start (--name).
    async rename(session, title) {
      const s = known(session)
      if (!s) return fail(new Error(`session not found: ${session}`))
      s.title = title
      return done
    },
    async messages() {
      return fail(new Error("claude adapter: session history is not available"))
    },
    // Exists = minted here, or claude holds a transcript for it. There is no
    // server connection to go half-open: a live process that died reports
    // itself through its exit.
    async get(session) {
      return known(session) ? { ok: true, value: { id: session } } : fail(new Error(`session not found: ${session}`))
    },
    async events(signal) {
      const queue: AgentEvent[] = []
      let wake: (() => void) | undefined
      const push = (event: AgentEvent) => {
        queue.push(event)
        wake?.()
      }
      const stop = () => {
        subscribers.delete(push)
        wake?.()
      }
      if (signal.aborted) return (async function* () {})()
      subscribers.add(push)
      signal.addEventListener("abort", stop, { once: true })
      return (async function* (): AsyncGenerator<AgentEvent> {
        try {
          for (;;) {
            while (queue.length) yield queue.shift()!
            if (signal.aborted) return
            await new Promise<void>((resolve) => (wake = resolve))
            wake = undefined
          }
        } finally {
          stop()
        }
      })()
    },
    async replyQuestion() {
      return fail(new Error("claude adapter: questions are not supported"))
    },
    async rejectQuestion() {
      return fail(new Error("claude adapter: questions are not supported"))
    },
    async replyPermission() {
      return fail(new Error("claude adapter: permission requests are settled by the preset"))
    },
    async contextLimits() {
      return limits
    },
    close() {
      for (const s of sessions.values()) {
        if (s.live && !s.live.exited) {
          s.live.killed = true
          s.live.proc.kill()
        }
      }
    },
  }
}

// Bun.spawn behind the ClaudeProcess shape. kill() sends SIGTERM and follows
// up with SIGKILL when the process has not gone within 5 s.
function bunSpawn(args: string[], options: { cwd: string; env: Record<string, string | undefined> }): ClaudeProcess {
  const child = Bun.spawn(args, { cwd: options.cwd, env: options.env, stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  const stderr = new Response(child.stderr).text().catch(() => "")
  const exited = child.exited.then(async (code) => ({ code, stderr: await stderr }))
  return {
    write(line) {
      child.stdin.write(line)
      child.stdin.flush()
    },
    end() {
      try {
        child.stdin.end()
      } catch {}
    },
    kill() {
      child.kill("SIGTERM")
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000)
      timer.unref?.()
      void exited.finally(() => clearTimeout(timer))
    },
    lines: readLines(child.stdout),
    exited,
  }
}

async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) yield line
    }
  }
  const rest = (buffer + decoder.decode()).trim()
  if (rest) yield rest
}
