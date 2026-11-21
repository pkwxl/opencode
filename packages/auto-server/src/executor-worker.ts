import { EXECUTOR_PROTOCOL, ExecutorRequestError, openExecutorCoordinator } from "@opencode-ai/auto-core/executor-coordinator"
import { parseExecutorRequest } from "./executor-request"
import { BRIDGE_TOKEN_ENV, parseTransport, RequestError } from "./request"
import { buildFingerprint, resolvedLine } from "./version"
import { encodeFrame, parseFrame, PROTOCOL_VERSION, type StepDone, type StepRequest } from "./ws-protocol"

type Coordinator = Awaited<ReturnType<typeof openExecutorCoordinator>>
type Step = Awaited<ReturnType<Coordinator["claim"]>>

// Exported for the wire serialization pin (test/executor-wire.test.ts,
// plans/0294): the per-kind serializer alone, detached from the coordinator.
export function wireStep(step: Step): Record<string, unknown> {
  switch (step.kind) {
    case "execute": {
      if (!("lease" in step)) throw new Error("Executor returned an unleased execute step.")
      const { id, unit, title, prompt, budget, lease, deadline, attempt, workspace, answerCursor } = step
      // 0294 (0290 F4d): the landed context rides the wire over a unit
      // with a landed share — the prior share's id and commit; absent on
      // a fresh unit (the key itself absent, never a null).
      return { kind: step.kind, id, unit, title, prompt, budget, lease, deadline, attempt, workspace, answerCursor, ...(step.landed ? { landed: step.landed } : {}) }
    }
    // 0276 (0256 stage 2's first convergence kind): the formulation grant —
    // a fresh unit claim like execute, carrying the phase's identity (the
    // qualified id and the task-index path) beside the brief. Additive under
    // the frozen protocol; an old client stops and asks per the standing
    // unknown-kind letter.
    case "formulate": {
      if (!("lease" in step)) throw new Error("Executor returned an unleased formulate step.")
      const { id, unit, title, phase, index, prompt, budget, lease, deadline, attempt, workspace, answerCursor } = step
      return { kind: step.kind, id, unit, title, phase, index, prompt, budget, lease, deadline, attempt, workspace, answerCursor }
    }
    // 0277 (0256 stage 2's second convergence kind, the transfer advance's
    // session work): the distillation grant — a fresh unit claim like
    // execute, the unit the phase's own qualified id, carrying the handover
    // document path (the one write surface) beside the brief. Additive under
    // the frozen protocol.
    case "distill": {
      if (!("lease" in step)) throw new Error("Executor returned an unleased distill step.")
      const { id, unit, title, handover, prompt, budget, lease, deadline, attempt, workspace, answerCursor } = step
      return { kind: step.kind, id, unit, title, handover, prompt, budget, lease, deadline, attempt, workspace, answerCursor }
    }
    // 0278 (0256 stage 2's third and final convergence kind): the audit
    // grant — a fresh unit claim like execute over the round's standing
    // close-audit unit, carrying the findings document path (the one write
    // surface beside the handoff) and the round's number (the marker
    // field's own) beside the brief. Additive under the frozen protocol; an
    // old client stops and asks per the standing unknown-kind letter.
    case "audit": {
      if (!("lease" in step)) throw new Error("Executor returned an unleased audit step.")
      const { id, unit, title, findings, round, prompt, budget, lease, deadline, attempt, workspace, answerCursor } = step
      return { kind: step.kind, id, unit, title, findings, round, prompt, budget, lease, deadline, attempt, workspace, answerCursor }
    }
    // 0281 (0279's construction-determinized letter): the synthesize grant —
    // a fresh unit claim like formulate, carrying the phase's identity (the
    // qualified id and the task-index path) beside the brief. Additive under
    // the preview-open protocol; an old client stops and asks per the
    // standing unknown-kind letter.
    case "synthesize": {
      if (!("lease" in step)) throw new Error("Executor returned an unleased synthesize step.")
      const { id, unit, title, phase, index, prompt, budget, lease, deadline, attempt, workspace, answerCursor } = step
      return { kind: step.kind, id, unit, title, phase, index, prompt, budget, lease, deadline, attempt, workspace, answerCursor }
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
      return { kind: "wait", reason: "gate", detail: `A person must attend ${step.gate} in ${step.document} — release it with the deterministic clarify op (POST /projects/<project>/clarify) or the document edit itself, then claim again.`, retryAfter: 2 }
    case "phase-boundary":
      return { kind: "phase-boundary", phase: step.phase, remedy: step.problems.join("\n") || "Advance it with POST /projects/<project>/transfer." }
    // 0273's additive terminal (0264-05's fix): a same-token claim over a
    // booked report — distinct from done, which renders the round's own
    // completion; the remedy names the booked commit, no retryAfter.
    case "settled":
      return { kind: "settled", unit: step.unit, commit: step.commit, remedy: step.detail }
    case "done":
      return { kind: "done", summary: "The round is complete." }
  }
}

async function perform(coordinator: Coordinator, request: StepRequest, line: string): Promise<StepDone> {
  const base = { v: PROTOCOL_VERSION, type: "step-done", id: request.id } as const
  try {
    const { action, holder } = parseExecutorRequest(request.route, request.body, request.token)
    let payload: Record<string, unknown>
    switch (action.route) {
      case "ready":
        // 0270's additive carrier: the build fingerprint rides the ready
        // envelope beside protocol — the handshake every session starts
        // with, the one place identity needs carrying (per-response
        // repetition declined). A client that ignores the field reads the
        // pre-change envelope. 0293: the commit is the resolved line — a
        // stamped build names its commit, a source-mode bridge names the
        // tool tree's own state at its spawn, the daemon's /health `line`
        // the comparison home (a freshly attached bridge reading a later
        // line than the daemon names the skew the site measured).
        payload = { build: buildFingerprint(line), menu: await coordinator.ready(holder) }
        break
      case "heartbeat":
        payload = { menu: await coordinator.heartbeat(holder, action.leases) }
        break
      case "claim":
        payload = { step: wireStep(await coordinator.claim(holder, action.task, action.kind)) }
        break
      case "brief":
        payload = { step: wireStep(await coordinator.brief(holder, action.task, action.kind)) }
        break
      case "release":
        payload = { step: wireStep(await coordinator.release(holder, action.key.step, action.key.lease)) }
        break
      case "report": {
        const result = await coordinator.report(holder, action.key.step, action.key.lease, action.outcome, action.note)
        // A reconciled receipt answers a late report over a dead lease the
        // same way a consumed landing does (0287): the holder's chain ends —
        // the unit closed without the share — and the next step routes it on.
        const step = result.kind === "landed" || result.kind === "without-landing" || result.kind === "reconciled" ? await coordinator.next(holder) : result
        payload = { step: wireStep(step) }
        break
      }
    }
    return { ...base, status: 200, body: { protocol: EXECUTOR_PROTOCOL, ...payload } }
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
  // 0293: the bridge's own line, resolved once per worker session — the
  // spawn-time truth this process's modules are. Never re-read per request:
  // the checkout may move under a live session and a fresh read would claim
  // code this process is not running.
  const line = await resolvedLine()
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
        void perform(coordinator, parsed.frame, line).then((reply) => {
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
