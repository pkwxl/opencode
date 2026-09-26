// --interactive bypass interaction: a resident readline waits for human input;
// Enter injects a non-empty line as an extra user message into the current
// active session via promptAsync (fire-and-forget) — for a running session
// this is steer semantics on the v1 engine, processed at the next provider
// turn boundary; waiting for input does not block the main flow. The human
// waits of ask (--wait-answer) and the between-tasks pause (--wait-between)
// are received through this input line too (prompt text, timeout and fallback
// semantics unchanged); after ask ends the input line returns to send-message
// mode. No existing handling logic changes: without --wait-answer questions
// are still auto-answered, permissions still block.
import { createInterface } from "node:readline/promises"
import type { AgentClient } from "./agent/types"
import { requestExit } from "./exit"
import { requestFailback } from "./failback"
import { log, setInput } from "./log"

export type Interactive = {
  // Called by the runner whenever a session is created/reused; subsequent
  // input goes to that session.
  attach(sessionID: string): void
  // Show the prompt and wait for one line of human input; minutes omitted =
  // no timeout (waiting on the input line or stdin closing); with a value set,
  // timeout or close falls back to undefined (the step-mode pause hard-waits
  // through the omitted-value behavior).
  question(promptText: string, minutes?: number): Promise<string | undefined>
  close(): void
}

const PROMPT = "💬 "
const ASK_PROMPT = "❓ "

export function startInteractive(
  client: AgentClient,
  agent?: string,
  io?: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream },
  // The registry's internal model names (plans/0055 §9): under a registry a
  // /failback argument is an internal name or a raw provider/model string,
  // and an unknown bare name is refused at input, as malformed arguments
  // always were. undefined = no registry: the arguments keep the raw-only
  // rule.
  modelNames?: ReadonlySet<string>,
): Interactive {
  const rl = createInterface({ input: io?.input ?? process.stdin, output: io?.output ?? process.stdout })
  // In raw mode ^C does not raise the process-level SIGINT, readline
  // intercepts it; forward it to the process-level handler so two consecutive
  // Ctrl+C during the resident input still force-quit (same as askHuman).
  rl.on("SIGINT", () => process.kill(process.pid, "SIGINT"))
  let sessionID: string | undefined
  let closed = false
  // readline is closed; no further terminal operations (setPrompt/prompt).
  let dead = false
  // With a pending, the input line resolves the ask/pause; otherwise it is
  // sent as a session message.
  let pending: { resolve: (answer: string | undefined) => void; timer?: ReturnType<typeof setTimeout> } | undefined

  function settle(answer: string | undefined) {
    const current = pending
    pending = undefined
    if (current?.timer) clearTimeout(current.timer)
    if (!dead) {
      rl.setPrompt(PROMPT)
      rl.prompt()
    }
    current?.resolve(answer)
  }

  rl.on("line", (line) => {
    const text = line.trim()
    // Waiting in ask/pause: any input line (empty lines included) is
    // immediately taken as the answer — consistent with the original
    // askHuman's empty-line fallback and waitBetween's empty-line-continues
    // semantics; the caller interprets an empty answer.
    if (pending) {
      settle(text)
      return
    }
    if (!text) {
      rl.prompt()
      return
    }
    // /exit (design document plans/0014-exit-resume-design.md): not sent to
    // the session, only sets the flag — the actual pause is deferred to the
    // next phase/task/subtask safe boundary, by which point progress has been
    // written through the regular wrap-up and the next run resumes exactly.
    // It does not check whether a session is currently active (unlike the
    // discard semantics of message forwarding, /exit's intent is independent
    // of whether a session is attached).
    if (text === "/exit") {
      requestExit()
      log("🚪 /exit received: will pause and exit at the next safe boundary (phase/task/subtask handover point); progress is persisted, re-run to resume exactly")
      rl.prompt()
      return
    }
    // /failback (design document plans/0017-model-routing-design.md section
    // E): isomorphic to /exit but does not stop — once the flag is set, the
    // next safe boundary resets the failover state and retries the primary
    // model; with arguments (a space-separated provider/model list) it wholly
    // redefines the model order (the first is the primary, the rest the
    // failover candidate ring). Independent of whether a session is attached,
    // not sent to the session. Under a model registry the arguments are
    // internal model names (a raw provider/model string still works), and they
    // replace every candidate list for the rest of the run (plans/0055 §9).
    if (text === "/failback" || text.startsWith("/failback ")) {
      const order = text.slice("/failback".length).trim().split(/\s+/).filter(Boolean)
      const valid = (item: string): boolean =>
        modelNames === undefined ? item.includes("/") : item.includes("/") || modelNames.has(item)
      const bad = order.find((item) => !valid(item))
      if (bad !== undefined) {
        log(
          modelNames === undefined
            ? `⚠ invalid /failback argument: "${bad}" (models must be provider/model with a slash; usage: /failback [primary prov/a candidate prov/b ...])`
            : `⚠ invalid /failback argument: "${bad}" (under a model registry, arguments are internal model names or provider/model with a slash; usage: /failback [primary <name> candidate <name> ...])`,
        )
      } else {
        requestFailback(order)
        log(
          order.length
            ? `⇄ /failback received: model order will be redefined at the next safe boundary (phase/task/subtask handover point) — primary ${order[0]}, fallback candidates ${order.slice(1).join(", ") || "(none)"}, and the primary will be retried`
            : "⇄ /failback received: fallback state will be reset at the next safe boundary (phase/task/subtask handover point), retrying the primary model",
        )
      }
      rl.prompt()
      return
    }
    if (!sessionID) {
      log(`⚠ no active session, input discarded: ${text}`)
      return
    }
    // An agent without steer (MA.4) takes no message into a running session;
    // the run start said so once.
    if (!client.capabilities.steer) {
      log(`⚠ the agent takes no messages mid-turn, input discarded: ${text}`)
      return
    }
    log(`→ sent: ${text}`)
    void client.promptAsync({ session: sessionID, agent, text }).then((result) => {
      if (!result.ok) log(`⚠ send failed: ${result.error instanceof Error ? String(result.error) : JSON.stringify(result.error)}`)
    })
  })
  // stdin closed (pipe end etc.): fall back to non-interactive behavior; a
  // waiting ask is treated as timed out. Also synchronously clear log.ts's
  // resident input-line reference — otherwise any later log would call
  // prompt(true) on the closed rl and throw ERR_USE_AFTER_CLOSE, breaking
  // through the main flow (2026-09-17 review H6; symmetric with the cleanup
  // in close() below).
  rl.on("close", () => {
    closed = true
    dead = true
    setInput(undefined)
    settle(undefined)
  })

  rl.setPrompt(PROMPT)
  rl.prompt()
  setInput(rl)

  return {
    attach(id) {
      sessionID = id
    },
    question(promptText, minutes) {
      // When already closed or re-entered (never happens in the normal flow),
      // fall back immediately; the caller treats it as no answer.
      if (closed || pending) return Promise.resolve(undefined)
      log(promptText)
      rl.setPrompt(ASK_PROMPT)
      rl.prompt()
      return new Promise((resolve) => {
        // minutes omitted = hard wait with no timeout (step-mode pause); the
        // timer is armed only when a value is explicitly given.
        pending = { resolve, timer: minutes === undefined ? undefined : setTimeout(() => settle(undefined), minutes * 60_000) }
      })
    },
    close() {
      closed = true
      settle(undefined)
      setInput(undefined)
      dead = true
      rl.close()
    },
  }
}
