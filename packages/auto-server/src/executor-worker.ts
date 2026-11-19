import { ExecutorRequestError, openExecutorCoordinator } from "@opencode-ai/auto-core/executor-coordinator"
import { parseExecutorRequest } from "./executor-request"
import { BRIDGE_TOKEN_ENV, parseTransport, RequestError } from "./request"
import { encodeFrame, parseFrame, type StepDone, type StepRequest } from "./ws-protocol"

type Coordinator = Awaited<ReturnType<typeof openExecutorCoordinator>>
type Step = Awaited<ReturnType<Coordinator["claim"]>>

function wireStep(step: Step): Record<string, unknown> {
  switch (step.kind) {
    case "execute": {
      if (!("lease" in step)) throw new Error("Executor returned an unleased execute step.")
      const { id, unit, title, prompt, budget, lease, deadline, attempt, workspace, answerCursor } = step
      return { kind: step.kind, id, unit, title, prompt, budget, lease, deadline, attempt, workspace, answerCursor }
    }
    case "verify":
    case "fix": {
      if (!("lease" in step)) throw new Error("Executor returned an unleased follow-up step.")
      const { id, unit, prompt, lease, deadline, attempt, workspace, answerCursor } = step
      return {
        kind: step.kind, id, unit, prompt, lease, deadline, attempt, workspace, answerCursor,
        ...(step.kind === "verify" ? { baseline: step.baseline, head: step.head } : { round: step.id.slice(step.id.lastIndexOf(" ") + 1) }),
      }
    }
    case "blocked":
      return { kind: "blocked", code: step.reason, remedy: step.detail }
    case "wait":
      return { kind: "wait", reason: step.reason, detail: step.detail, retryAfter: 2 }
    case "human":
      return { kind: "wait", reason: "gate", detail: `A person must attend ${step.gate} in ${step.document}.`, retryAfter: 2 }
    case "phase-boundary":
      return { kind: "phase-boundary", phase: step.phase, remedy: step.problems.join("\n") || "Run transfer to advance the phase." }
    case "done":
      return { kind: "done", summary: "The round is complete." }
  }
}

function wirePersonStep(step: Awaited<ReturnType<Coordinator["claimPerson"]>>): Record<string, unknown> {
  return step.kind === "blocked" || step.kind === "wait" ? wireStep(step) : step
}

async function perform(coordinator: Coordinator, request: StepRequest): Promise<StepDone> {
  const base = { v: 1, type: "step-done", id: request.id } as const
  try {
    const { action, holder } = parseExecutorRequest(request.route, request.body, request.token, request.delegation)
    let payload: Record<string, unknown>
    switch (action.route) {
      case "ready":
        payload = { menu: await coordinator.ready(holder) }
        break
      case "heartbeat":
        payload = { menu: await coordinator.heartbeat(holder, action.leases) }
        break
      case "claim":
        payload = { step: action.role === "person"
          ? wirePersonStep(await coordinator.claimPerson({ ...holder, delegation: request.delegation! }))
          : wireStep(await coordinator.claim(holder, action.task, action.kind)) }
        break
      case "brief":
        payload = { step: action.cursor === undefined
          ? wireStep(await coordinator.brief(holder, action.task, action.kind))
          : { kind: "answers", ...await coordinator.briefAnswers(holder, action.task, action.cursor ?? undefined, action.kind) } }
        break
      case "question":
        payload = { question: await coordinator.question(holder, action.text, action.target) }
        break
      case "answer":
        payload = { step: wirePersonStep(await coordinator.answerPerson({ ...holder, delegation: request.delegation! }, action.item, action.decision, action.rationale)) }
        break
      case "release":
        payload = { step: wireStep(await coordinator.release(holder, action.key.step, action.key.lease)) }
        break
      case "report": {
        const result = await coordinator.report(holder, action.key.step, action.key.lease, action.outcome, action.note)
        const step = result.kind === "landed" || result.kind === "without-landing" ? await coordinator.next(holder) : result
        payload = { step: wireStep(step) }
        break
      }
    }
    return { ...base, status: 200, body: { protocol: 1, ...payload } }
  } catch (error) {
    if (error instanceof RequestError || error instanceof ExecutorRequestError) {
      return { ...base, status: 400, body: { error: error.message } }
    }
    console.error(error)
    return { ...base, status: 500, body: { error: "The coordinator could not process the request." } }
  }
}

const IDLE_MS = 30_000

export async function runExecutorWorker(request: Record<string, unknown>): Promise<void> {
  if (Object.keys(request).some((key) => key !== "executor" && key !== "directory" && key !== "transport") ||
      typeof request.directory !== "string" || !request.directory.trim()) {
    throw new RequestError("An executor worker requires a directory and bridge transport.")
  }
  const transport = parseTransport(request.transport)
  const secret = process.env[BRIDGE_TOKEN_ENV]
  if (!secret) throw new RequestError("The executor worker requires a bridge secret.")
  const url = new URL(transport.url)
  url.searchParams.set("token", secret)
  delete process.env[BRIDGE_TOKEN_ENV]

  const coordinator = await openExecutorCoordinator(request.directory)
  try {
    await new Promise<void>((resolve) => {
      const socket = new WebSocket(url)
      let active = 0
      let lastActivity = Date.now()
      const keepalive = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(encodeFrame({ type: "ping" }))
      }, 15_000)
      let idle: ReturnType<typeof setTimeout>
      const refresh = () => {
        clearTimeout(idle)
        idle = setTimeout(async () => {
          const busy = active > 0 || await coordinator.busy().catch(() => true)
          if (socket.readyState !== WebSocket.OPEN) return
          if (busy || active || Date.now() - lastActivity < IDLE_MS) refresh()
          else socket.close(1000, "coordinator idle")
        }, IDLE_MS)
      }
      const done = () => {
        clearTimeout(idle)
        clearInterval(keepalive)
        resolve()
      }
      socket.onclose = done
      socket.onerror = () => socket.close()
      socket.onmessage = ({ data }) => {
        const parsed = parseFrame(String(data))
        if (parsed.ok && parsed.frame.type === "pong") return
        if (!parsed.ok || parsed.frame.type !== "step-request") {
          socket.close(1002, "invalid coordinator request")
          return
        }
        active++
        lastActivity = Date.now()
        void perform(coordinator, parsed.frame).then((reply) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(reply))
        }).catch(console.error).finally(() => {
          active--
          lastActivity = Date.now()
          if (socket.readyState === WebSocket.OPEN) refresh()
        })
      }
      refresh()
    })
  } finally {
    await coordinator.close()
  }
}
