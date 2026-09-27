// Session helpers over the AgentClient (fork/usage/liveness/rename) + terminal
// formatting + waiting for human answers. Since MA.3 (plans/0039) this file
// holds no SDK call: every agent request goes through the AgentClient, and
// the SDK-facing half moved into src/agent/opencode/. It is a driver module
// (it seeds chains, reads opts, logs). It contains no session-driving logic
// (dispatch/retry/failover/subscription live in session.ts and watch.ts), so
// it sits at the bottom of the graph: watch/session/runner may call it freely;
// **it must not import the session-driving layer**.
// Split from src/runner.ts (plans/0024-module-split-plan.md S5).

import { createInterface } from "node:readline/promises"
import { join } from "node:path"
import type { AgentClient, AgentPart } from "./agent/types"
import type { ForkBaseInfo, SessionChain } from "./chain"
import type { ClientSource } from "./opts"
import { commitTitle } from "./git"
import type { Interactive } from "./interactive"
import { log, vlog } from "./log"
import { DEFAULT_CONTEXT_LIMIT, type Opts } from "./opts"
import { shellProfile } from "./shell"
import { statsWaitBegin, statsWaitEnd, type Usage } from "./stats"
import { forkBaseAllowed } from "./usage"

// The worktree-check tail every one-off note of a session that inherited no
// context carries (the retry/failover/recovery notes of src/session.ts, and
// the cross-agent move of src/attempt.ts, plans/0055 §8.3): a session that
// did not inherit this attempt's context must be told to check the disk
// state before going on, or it redoes half-finished work (same wording as
// the cross-run resumeNote).
export const WORKTREE_CHECK =
  " The worktree may already hold part of this prompt's output: check it with git status / git diff first, then continue the remaining work from there without redoing what is finished."
export const worktreeNote = (lead: string) => `[DRIVER] ${lead}${WORKTREE_CHECK}`

// The client that serves an agent profile (plans/0055 §8.1): the pool starts
// the profile's host here on its first selection (undefined agent = the
// run's start profile); a plain client source (a test double, the
// no-registry single agent) is returned as is, whatever the agent — the
// no-registry path never reads the agent at all.
export async function clientOf(source: ClientSource, agent?: string): Promise<AgentClient> {
  return "client" in source ? await source.client(agent) : source
}

// The context windows of every model the source knows: a pool merges the
// started hosts' contextLimits (a model on a host that has not started is
// absent — an unknown window never excludes a candidate, §6.2 rule 5); a
// plain client answers its own map.
export async function contextLimitsOf(source: ClientSource): Promise<ReadonlyMap<string, number>> {
  return await source.contextLimits()
}

// Wraps client.fork (fork-decompose design §4.3; the client accepts an
// injected fake for unit tests): copies the message prefix up to the base's
// tail into a new session and renames it to this phase's short-label title.
// {error} or any exception (an external legacy --server without this route,
// the base wiped by storage cleanup, etc.) is an expected fallback scenario —
// log, then return undefined; the caller takes a brand-new session + cold
// start, not an error.
export async function forkSession(client: AgentClient, base: string, title: string, messageID?: string): Promise<string | undefined> {
  // An agent that cannot fork takes the same fallback as a failed fork (MA.4,
  // plans/0040); the run start already said so once, hence verbose only.
  const { fork } = client.capabilities
  if (fork === "none") {
    vlog(`↻ the agent cannot fork sessions; falling back to a brand-new session`)
    return undefined
  }
  // messageID is the fork anchor: the server copies every message **before**
  // that message (by default the whole session is copied).
  // Without message-level forks the whole session is copied — the pin fork's
  // own fallback when its anchor is gone (exec-session seedPinFork).
  const forked = await client.fork(base, fork === "message" ? messageID : undefined)
  if (!forked.ok) {
    log(`↻ fork failed (${formatClientError(forked.error)}); falling back to a brand-new session`)
    return undefined
  }
  const id = forked.value.id
  // The forked session's default title looks like "... (fork #N)"; rename it
  // to this phase's commit title, aligned with the git history and task
  // progress (a rename failure only logs a detail line).
  const renamed = await client.rename(id, commitTitle(title))
  if (!renamed.ok) vlog(`fork session rename failed: ${JSON.stringify(renamed.error)}`)
  return id
}

// Fork seeding for a phase's / subtask's first session (fork-decompose design
// §4.3/§4.4): with a base it is "fork first, render later" — success →
// chain.pending = the forked session, seeded chain { pct: 100, used: the base's
// usage, at: 0, forkBase } (pct:100 forces no reuse of the first attempt, fork
// wins; no reuse across subtasks, every item forks fresh from the base); fork
// failure → reset the chain and take a brand-new session + cold-start prompt;
// base usage reaching cap/2 → no fork, straight cold start (keeps the prefix
// away from the limit). When interruption recovery reuses the interrupted
// session (the chain still holds a session and a resume note is pending
// injection), no fork: the first prompt goes into the reused session. Returns
// warm (= this session already inherited the task background) for the prompt
// to pick its background section; without a base (fork=off / never established)
// the chain is untouched, behavior identical to the status quo.
// Under a model registry the base is per agent (plans/0055 §8.4): a base that
// names its agent forks there and moves the chain's binding to it, so the
// seeded session and its consuming dispatch agree on the agent.
export async function seedForkSession(
  client: ClientSource,
  opts: Opts,
  chain: SessionChain,
  base: ForkBaseInfo | undefined,
  subject: string,
): Promise<boolean> {
  if (!base) return false
  // Resume takes precedence over forking: the interrupted session is still on
  // the chain and its resume note is pending injection → reuse it.
  if (chain.id !== undefined && chain.note !== undefined) return true
  const cap = opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT
  if (!forkBaseAllowed(base.used, cap)) {
    log(
      base.used === undefined
        ? `↻ base usage unknown; not forking (cold start)`
        : `↻ base usage ${formatTokens(base.used)} reached the ${formatTokens(cap / 2)} cap; not forking (cold start)`,
    )
    chain.id = undefined
    chain.pending = undefined
    chain.pct = 100
    chain.used = 0
    chain.at = 0
    return false
  }
  // The base session is agent-local (plans/0055 §8.2): the fork runs on the
  // chain's agent's host, resolved through the pool when the caller passed
  // one (a base seeded onto this chain lives on its agent). Under a registry
  // the base names the agent it was built on (§8.4): the fork runs there and
  // the chain's binding follows — the pre-created session lives on that
  // agent, so the dispatch consuming it must resolve its client, and read the
  // cross-agent check, against the same name. Without a registry the base
  // names no agent and the chain's stands, exactly as before (C2).
  const agent = base.agent ?? chain.agent
  const baseClient = await clientOf(client, agent)
  // Sync AGENTS.md before the new session (same as the create path; the forked
  // session's system context is inherited from the base — the base prefix's
  // consistency with the latest contract is guaranteed here).
  await opts.server?.syncContext(agent)
  const forked = await forkSession(baseClient, base.id, subject)
  chain.id = undefined
  chain.pending = forked
  chain.forkBase = base.id
  chain.pct = 100
  // forkBaseAllowed passed, so the figure is known.
  const used = base.used ?? 0
  chain.used = forked ? used : 0
  chain.at = 0
  if (forked) {
    if (agent !== undefined) chain.agent = agent
    log(`⑂ forked a new session from base ${base.id}${agent !== undefined ? ` on agent ${agent}` : ""} (prefix ${formatTokens(used)} tokens)`)
  }
  return forked !== undefined
}

// Session seeding for the re-prompt with feedback after a failed shape check /
// check (session-boundary-hardening design §4.3/§4.5, revised 2026-09-18):
// dispatch a fork copy of the just-ended session (the chain's current session)
// — the copy carries the full work context, so one short line of feedback
// continues the work, instead of opening a blank session and resending the
// whole prompt (re-reading everything, redoing finished exploration, and
// losing the half-done state; field incident kernel-spi-nor T-030 S13). The
// original session stays untouched and remains the recovery point (the same
// philosophy as the retry ladder's "always fork a copy, never reuse
// directly"). Returns false when the chain holds no session / the session is
// dead / the fork fails; the caller falls back to a brand-new session + the
// full prompt. The forked prefix's usage is the just-ended session's usage;
// the chain's pct/used/at are left as they are (attempt refreshes them with
// measured values once the round ends).
// The fork runs on the chain's agent's host (§8.2): the ended session lives
// on it, and its copy must too.
export async function forkEndedSession(client: ClientSource, chain: SessionChain, subject: string): Promise<boolean> {
  const sessionClient = await clientOf(client, chain.agent)
  if (chain.id === undefined || !(await sessionAlive(sessionClient, chain.id))) return false
  const forked = await forkSession(sessionClient, chain.id, subject)
  if (!forked) return false
  // Same shape as seedForkSession: clear id so attempt consumes pending (the
  // reuse decision requires no session on the chain, and a non-empty note +
  // id would hit the resumed reuse branch and ignore pending).
  chain.id = undefined
  chain.pending = forked
  return true
}

// Rebuilds the session's tail context usage (AgentMessage.contextUsed;
// opencode = input + cache.read) and its percentage: via client.messages, take
// the first assistant message **walking back from the end** that actually ran
// to completion (not the literal last one — see the basis comment), with the
// limit looked up in the provider table (same convention as watch: no limit
// found → pct=100). Used for the fork base's usage and for the usage a session
// taken over by interruption recovery inherits. Exported only so unit tests
// can drive the criterion directly (same as ensureForkBase; the recovery
// decision itself lives in runTask, the full pipeline is covered by the shell
// package's e2e).
// recorded = the figure the progress record carries (an /exit inside the
// recovery wait writes it, plans/0057 §6): an agent without readable history
// resumes with it instead of 0.
export async function sessionUsage(
  client: AgentClient,
  id: string,
  recorded?: number,
): Promise<{ used: number; pct: number; limit?: number; errorStub: boolean }> {
  // No readable history (MA.4): the same unknown as a failed read — pct 100
  // keeps the session from being reused on its figure.
  if (!client.capabilities.history) return { used: recorded ?? 0, pct: 100, errorStub: false }
  const got = await client.messages(id)
  if (!got.ok) return { used: 0, pct: 100, errorStub: false }
  const data = got.value
  const last = data.findLast((message) => message.role === "assistant")
  if (!last) return { used: 0, pct: 100, errorStub: false }
  // Usage basis = the first assistant message walking back from the end that
  // "actually ran to completion" (non-zero usage). When a provider errors, the
  // server appends an assistant line with all-zero tokens (prompt.ts creates
  // the line first, processor .halt() only writes the error, step-finish never
  // happened); an interrupted round likewise leaves a 0-token stub line. Taking
  // the literal last message would read a session that "accumulated a
  // hundred-thousand-token context and hit the rate limit on its last round"
  // as 0 usage. The basis does not exclude error lines: errors decided only
  // after step-finish (output over the limit, content filtering, etc.) carry
  // real tokens — exactly the best estimate of the tail usage.
  const basis = data.findLast((message) => message.role === "assistant" && (message.contextUsed ?? 0) > 0)
  if (!basis) {
    // The session never produced real output: the last message is itself the
    // error stub — the legacy shape plans/0015-session-error-retry-plan.md
    // point 5 covers (an empty session left by the old "retry = switch to a
    // blank session" behavior).
    return { used: 0, pct: 100, errorStub: last.failed }
  }
  const used = basis.contextUsed!
  const limit = basis.model !== undefined ? (await client.contextLimits()).get(basis.model) : undefined
  return { used, pct: limit ? Math.round((used / limit) * 100) : 100, limit, errorStub: false }
}

// The base session's tail context usage (tokens); 0 when it cannot be read.
// Undefined when the agent keeps no readable history (MA.4): the fork base
// guard then treats the base as full and starts cold (plans/0038 G1) instead
// of trusting a made-up 0.
export async function sessionUsed(client: AgentClient, id: string): Promise<number | undefined> {
  if (!client.capabilities.history) return undefined
  return (await sessionUsage(client, id)).used
}

// Zero usage as the statsSessionEnd fallback (dispatch failure / exception
// paths have no usage to record; no invented consumption).
export function zeroUsage(): Usage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 }
}

// Session progress renaming: session titles and commit titles share the same
// short-label scheme (`T-NNN <label> <title/subtask>`, label ∈
// decompose/S<n>/exec/wrapup/pending/blocked/done etc.); at session end and at
// task terminal states the chain's session is renamed to the latest label, the
// title prefix being the task progress; a rename failure only logs a detail
// line and does not affect the flow.
export async function renameSession(client: AgentClient, chain: SessionChain, subject: string): Promise<void> {
  chain.subject = subject
  if (!chain.id) return
  const renamed = await client.rename(chain.id, commitTitle(subject))
  if (!renamed.ok) vlog(`session rename failed: ${JSON.stringify(renamed.error)}`)
}

// Whether a remembered session still exists on the server (opencode sessions
// persist in the project store and survive a server restart; a failed fetch or
// a miss means not reusable).
// Without resumable sessions (MA.4) no remembered session counts as alive:
// recovery, base reuse and every fork from a stored id start fresh instead.
export async function sessionAlive(client: AgentClient, id: string): Promise<boolean> {
  if (!client.capabilities.resume) return false
  return (await client.get(id)).ok
}

// The probe body of the liveness probe
// (plans/0026-session-boundary-hardening-design.md D3/§4.4): an independent
// short-timeout connection GETting the session's metadata — a half-open old
// connection (no FIN/RST) neither responds nor refuses, but does not affect
// new connections, so the success or failure of a fresh request is a
// trustworthy signal of transport-level liveness; a timeout without a response
// counts as a failed probe, same as a request exception. Same family as
// sessionAlive; only the timeout upper bound and the call site differ
// (periodic in-flight probing vs a one-time check before recovery).
export const PROBE_TIMEOUT_MS = 30_000
export async function probeSession(client: AgentClient, sessionID: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      client.get(sessionID).then((got) => got.ok),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

// A common root cause of task-dispatch failure: when the target directory is
// missing the agent contract file the server only answers UnknownError (the
// error body carries no root cause); detected here, hinting the recovery path
// from the shell profile (see src/shell.ts).
export async function missingAgentHint(opts: Opts): Promise<string> {
  if (!opts.dir) return ""
  const file = `.opencode/agent/${opts.agent ?? "auto"}.md`
  const exists = await Bun.file(join(opts.dir, file)).exists()
  if (exists) return ""
  const { program, bin, agentRecovery } = shellProfile()
  const recovery =
    agentRecovery === "startup"
      ? `re-run ${program} to restore (the default contracts are rebuilt from templates at startup), then re-run`
      : `run ${bin} fix ${opts.dir} to restore, then re-run`
  return `\nhint: the target directory is missing the agent contract file ${file}; the server rejects task dispatches with UnknownError because of this; ${recovery}`
}

// Renders a non-text part into a readable output line (always via vlog,
// leaving the keep/drop decision to the log layer: --verbose shows it on the
// terminal and records it, the shell profile's auditLog writes it to the log
// file); undefined means the part has no terminal-state content to output yet
// (later update events will trigger again). Tool output and raw reasoning can
// be long, truncated to the 2000-character cap. display-only pieces arrive as
// notes already rendered by the adapter (0037 D6); the retry line is watch's
// (retry signals are events, not parts).
export function describePart(part: AgentPart): string | undefined {
  if (part.kind === "reasoning") return part.final ? `  reasoning:\n${part.text.trim().slice(0, 2000)}` : undefined
  if (part.kind === "tool") {
    if (part.status === "completed") return `  tool ${part.tool}: ${part.title || "done"}`
    if (part.status === "error") return `  tool ${part.tool} error: ${(part.error ?? "").slice(0, 2000)}`
    return undefined
  }
  if (part.kind === "step-finish") return `  step finish (${part.reason}): input ${formatTokens(part.tokens.input)} / output ${formatTokens(part.tokens.output)} tokens`
  if (part.kind === "step-start") return `  step start`
  if (part.kind === "note") return `  ${part.text}`
  return undefined
}

export function formatTokens(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

// Makes client errors readable: a fetch exception (network down, request
// aborted on timeout, etc.) is an Error instance, and JSON.stringify only
// yields "{}"; taking its message is what lets wording like "request timed
// out" into the blocked-problem text; everything else (the server's structured
// error body) is serialized as before.
export function formatClientError(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error)
}

// During a permission wait these answers (leading/trailing whitespace and case
// ignored) count as approval.
export function isApproval(answer: string): boolean {
  return /^(allow|yes|y|ok|approve|always)$/i.test(answer.trim())
}

// Waits up to `minutes` for a human answer on stdin (Enter confirms); returns
// undefined on timeout or empty input, in which case the caller falls back to
// autoAnswer() (questions) or the --permission fallback (permission requests).
// minutes === undefined = no timeout (plan's humanQuestions path: the run
// waits for the human's answer indefinitely, never falling back); undefined
// then means only that the input channel closed.
// Under --interactive the resident input line takes the answer instead (prompt
// text, timeout and fallback semantics unchanged).
// When dir is passed, the waiting interval (the interactive.question path
// included) is deducted from the session time and the AI time via
// statsWaitBegin/End and recorded separately as waitMs (STATS_PLAN §2/§3: AI
// segment off-on); exported for direct unit-test driving (aligned with the
// runSession internal wiring tests).
export async function askHuman(
  minutes: number | undefined,
  hint: string,
  interactive?: Interactive,
  dir?: string,
): Promise<string | undefined> {
  const promptText =
    minutes === undefined
      ? `enter your answer (Enter to confirm, ${hint}): `
      : `enter your answer within ${minutes} minutes (Enter to confirm, ${hint}): `
  await statsWaitBegin(dir, "askHuman")
  try {
    if (interactive) return (await interactive.question(promptText, minutes)) || undefined
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    // In raw mode ^C does not raise the process-level SIGINT; readline
    // intercepts it. Forward to the process-level handler so two consecutive
    // Ctrl+C still force-quit while waiting for a human answer.
    rl.on("SIGINT", () => process.kill(process.pid, "SIGINT"))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const answer =
        minutes === undefined
          ? await rl.question(promptText)
          : await Promise.race([
              rl.question(promptText),
              new Promise<undefined>((resolve) => {
                timer = setTimeout(() => resolve(undefined), minutes * 60_000)
              }),
            ])
      return answer?.trim() || undefined
    } finally {
      clearTimeout(timer)
      rl.close()
    }
  } finally {
    await statsWaitEnd(dir)
  }
}
