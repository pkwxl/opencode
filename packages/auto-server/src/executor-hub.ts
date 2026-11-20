// Program W's holder side (0275). One process owns one worker channel.
// Run on the workspace host. The child consumes the brief on stdin.
import { setTimeout as delay } from "node:timers/promises"

type Kind = "execute" | "verify" | "fix" | "formulate" | "distill" | "audit"
type Pair = { step: string; lease: string }
type Held = Pair & { deadline: number; kind: Kind }
type Menu = { leases: Held[]; claimable: { unit: string; kinds: Kind[] }[] }
type Grant = { id: string; lease: string; deadline: number; workspace: string; prompt: string; kind: Kind }
type Notice = { kind: "wait" | "done" | "blocked" | "settled" | "phase-boundary"; retryAfter?: number; detail?: string; remedy?: string; summary?: string }
type Reply = { protocol: number; menu?: Menu; step?: Grant | Notice }
type Request = (route: "heartbeat" | "claim" | "report" | "ready" | "release", body: object, signal?: AbortSignal) => Promise<Reply>

function live(deadline: number) {
  return Number.isSafeInteger(deadline) && deadline > Date.now()
}

// Stop at the last acknowledged deadline even if a renewal request hangs.
// An unchanged deadline is the coordinator's cap. Wait out its remaining
// time without shortening the interval into a busy loop.
async function renew(grant: Grant, pair: Pair, request: Request, signal: AbortSignal) {
  let deadline = grant.deadline
  while (live(deadline)) {
    const remaining = deadline - Date.now()
    await delay(Math.max(1, Math.floor(remaining / 2)), undefined, { signal })
    if (!live(deadline)) break
    const untilExpiry = AbortSignal.timeout(Math.max(1, deadline - Date.now()))
    const { menu } = await request("heartbeat", { leases: [pair] }, AbortSignal.any([signal, untilExpiry]))
    const held = menu?.leases.find(row => row.step === pair.step && row.lease === pair.lease)
    if (!live(deadline) || !held || !live(held.deadline)) break
    if (held.deadline === deadline) {
      await delay(Math.max(1, deadline - Date.now()), undefined, { signal })
      break
    }
    deadline = held.deadline
  }
  throw new Error("The executor lease expired or disappeared.")
}

export async function serveGrant(grant: Grant, command: string[], request: Request, shutdown: AbortSignal) {
  const pair = { step: grant.id, lease: grant.lease }
  if (!live(grant.deadline)) throw new Error("The grant expired before dispatch.")
  if (shutdown.aborted) return request("release", pair)

  let child: Bun.Subprocess
  try {
    child = Bun.spawn(command, {
      cwd: grant.workspace, stdin: new Blob([grant.prompt]), stdout: "inherit", stderr: "inherit", detached: true,
    })
  } catch (error) {
    await request("release", pair)
    throw error
  }

  const finished = new AbortController()
  let outcome: "ended" | "failed" = "failed"
  let failure: unknown
  try {
    const status = await Promise.race([
      child.exited,
      renew(grant, pair, request, AbortSignal.any([shutdown, finished.signal])),
    ])
    if (status === 0 && !shutdown.aborted) outcome = "ended"
    else if (!shutdown.aborted) failure = new Error(`Executor child exited with status ${status}.`)
  } catch (error) {
    failure = error
  } finally {
    finished.abort()
    // Reap the whole group, including descendants left by a wrapper that
    // exited on its own. A failed stop must never hand off a live writer.
    try {
      process.kill(-child.pid, "SIGKILL")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
    }
    await child.exited
  }
  const reply = await request("report", { ...pair, outcome })
  if (failure && !shutdown.aborted) throw failure
  return reply
}

const isKind = (value: string): value is Kind => ["execute", "verify", "fix", "formulate", "distill", "audit"].includes(value)

async function main(args: string[], shutdown: AbortSignal) {
  const resume = args[0] === "--resume"
  const [connection, project, channel, kind, ...command] = resume ? args.slice(1) : args
  if (!connection || !project || !channel || !isKind(kind) || !command.length) {
    throw new Error("Usage: opencode-auto-server executor-hub [--resume] CONNECTION PROJECT CHANNEL execute|verify|fix|formulate|distill|audit COMMAND [ARG ...]")
  }
  if (process.platform === "win32") throw new Error("The executor hub requires POSIX process groups to stop workspace writers.")
  const { url, token } = await Bun.file(connection).json()
  if (typeof url !== "string" || typeof token !== "string" || !token) throw new Error("Invalid executor connection file.")
  const base = url.replace(/\/$/, "")
  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" }
  const session = await fetch(base + "/session", {
    headers, redirect: "error", signal: AbortSignal.any([shutdown, AbortSignal.timeout(30_000)]),
  })
  if (!session.ok) throw new Error(`Executor session returned HTTP ${session.status}.`)
  const { scopes } = await session.json()
  if (!Array.isArray(scopes) || !scopes.includes("executor") || scopes.some(s => typeof s !== "string" || s.startsWith("person"))) {
    throw new Error("The hub requires a worker token without person scope.")
  }
  const endpoint = base + "/projects/" + encodeURIComponent(project) + "/executor/"
  const post: Request = async (route, body, signal) => {
    const timeout = AbortSignal.timeout(30_000)
    const response = await fetch(endpoint + route, {
      method: "POST", redirect: "error", signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers,
      body: JSON.stringify({ channel, ...body }),
    })
    if (!response.ok) throw new Error(`Executor ${route} returned HTTP ${response.status}.`)
    const reply: Reply = await response.json()
    if (reply.protocol !== 1) throw new Error("Unknown executor protocol.")
    return reply
  }

  const request: Request = async (route, body, signal) => {
    try {
      return await post(route, body, signal)
    } catch (error) {
      // Settlement is idempotent on the original pair and outcome. A
      // dropped reply can follow a successful booking. Never replay claim.
      if (route !== "release" && route !== "report") throw error
      return post(route, body, signal)
    }
  }

  let allowRecovery = resume
  while (!shutdown.aborted) {
    const { menu } = await request("ready", {}, shutdown)
    if (!menu) throw new Error("Missing executor menu.")
    const inherited = menu.leases[0]
    if (inherited && (!allowRecovery || inherited.kind !== kind)) {
      throw new Error("Stop any orphaned child, then use --resume on the same token, channel and work kind.")
    }
    allowRecovery = false
    const target = menu.claimable.find(row => row.kinds.includes(kind))
    if (shutdown.aborted) return
    if (menu.claimable.length && !target && !inherited) {
      await delay(2000, undefined, { signal: shutdown })
      continue
    }
    const { step } = await request("claim", { role: "worker", kind, task: target?.unit })
    if (!step) throw new Error("Missing executor step.")
    let next = step
    if ("lease" in step) {
      if (step.kind !== kind || !step.id || !step.lease || typeof step.prompt !== "string" || !step.workspace) {
        throw new Error("Unexpected leased brief.")
      }
      const reply = await serveGrant(step, command, request, shutdown)
      if (!reply.step) throw new Error("Missing settlement response.")
      next = reply.step
    }
    if (next.kind === "wait") {
      if (!shutdown.aborted) await delay((next.retryAfter ?? 2) * 1000, undefined, { signal: shutdown })
    } else if (next.kind === "done" || next.kind === "settled" || next.kind === "blocked" || next.kind === "phase-boundary") {
      console.log(next.remedy ?? next.summary ?? next.kind)
      return
    } else throw new Error("Unexpected executor step. Check the protocol version and work kind.")
  }
}

export async function runExecutorHub(args: string[]) {
  const shutdown = new AbortController()
  const stop = () => shutdown.abort()
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)
  try {
    await main(args, shutdown.signal)
  } catch (error) {
    if (!(shutdown.signal.aborted && error instanceof Error && error.name === "AbortError")) throw error
  } finally {
    process.off("SIGINT", stop)
    process.off("SIGTERM", stop)
  }
}
