// The questions concern (plans/0061 §4.5, the question and permission rows —
// both are its alone): every question and permission path of the turn. A
// question waits for the human when the run asks for one (plan's sessions
// wait with no timeout and never proxy-answer; --wait-answer waits minutes
// and falls back to the driver's auto-answer), else the driver answers on
// the user's behalf — the fallback answers are the turn's proxy-answer
// observations (the ⚑ report and the resolves the snapshot carries out to
// the ledger), while a human reply is a real person's decision and books
// nothing. A permission-worded question under the default (no --wait-answer)
// blocks outright — unattended, the driver cannot decide authorization in
// the human's stead — and so does a repeat of an already answered question.
// A permission request is denied by the dryrun preflight without interrupting
// the session, auto-allowed, or handled by the ask-* modes: a human answer
// matching the approval wording grants, any other explicit answer denies
// without interrupting, and the timeout falls back per mode (ask-allow
// grants, ask-deny denies but continues, ask-fail denies, aborts and blocks
// the run).
//
// The auto-answer wording (whether the session must label the decision
// AUTO-RESOLVE, or the driver's log already recorded it in full) follows the
// run's switches as frozen in the turn's context — never a mid-turn re-read
// of the process memo, which the pool's capability clamp may have mutated
// after the run's snapshot was taken.
import { autoAnswer } from "../../unit-commit"
import { compactText, sameIssue } from "../../resolve"
import { isApproval } from "../../session-api"
import { emitStatus } from "../../run-status"
import type { QuestionSettlement } from "../../run-status-schema"
import type { Advice, Concern, TurnState } from "../contract"

// The question lifecycle events (P2b, src/run-status.ts): every question and
// permission this concern routes emits its raise at handling and its
// settlement where the routing decides — human / timeout / driver, the
// settlements table's words. The correlation (request, session) joins the
// agent stream's own question/permission event; see the emitter module's
// header for why this concern is the seam, not askHuman itself.
const raise = (request: string, question: string, session: string): void =>
  emitStatus({ type: "question-raised", origin: "agent", question, request, session })

const settle = (request: string, session: string, by: QuestionSettlement, answer?: string): void =>
  emitStatus({ type: "question-answered", by, request, session, ...(answer !== undefined ? { answer } : {}) })

export const questionsConcern: Concern<"questions"> = {
  name: "questions",
  initial: (): TurnState["questions"] => ({ autoAnswered: [], resolves: [] }),
  handle: async (input, own, _view, fx, ctx): Promise<Advice> => {
    if (input.kind !== "event") return "pass"
    const waitAnswer = ctx.opts.waitAnswer ?? 0
    if (input.event.type === "question") {
      const event = input.event
      const text = event.questions.join("\n")
      raise(event.request, text, ctx.sessionID)
      // The dryrun preflight session auto-answers everything, never blocking
      // on a question.
      const permission = ctx.opts.dryrun ? false : /\bpermission\b/i.test(text)
      const repeated = own.autoAnswered.some((prev) => sameIssue(prev, text))
      // plan's sessions (opts.humanQuestions): a non-permission question is a
      // decision for the human — plan runs for human review before execution,
      // and the driver waits for the human answer with no timeout (-i's
      // resident input line or stdin) and never proxy-answers (no
      // AUTO-RESOLVE); only an unanswerable human (closed input channel) or a
      // repeat of the same question blocks, handing it to the human.
      if (!ctx.opts.dryrun && ctx.opts.humanQuestions && !permission) {
        if (!repeated) {
          own.autoAnswered.push(text)
          fx.log(`❓ received a non-permission question (waiting for your answer; plan never proxy-answers):\n${text}`)
          const human = await fx.askHuman(undefined, "no timeout and no automatic answer under plan")
          if (human) {
            fx.log(`→ human answer: ${human}`)
            settle(event.request, ctx.sessionID, "human", human)
            await fx.replyQuestion(event.request, event.questions.map(() => [human]))
            return "consumed"
          }
        }
        await fx.rejectQuestion(event.request)
        await fx.abort()
        // The driver's own handling closed it (rejected and blocked): the
        // settlement is the driver's, the blocked outcome carries the rest.
        settle(event.request, ctx.sessionID, "driver")
        return {
          settle: {
            kind: "blocked",
            question: repeated
              ? `asked again about the same question after the human's answer; handle it manually outside the session, then re-run:\n${text}`
              : `the session asked for a human decision, but no answer could be received (the input channel is closed); answer it outside the session, then re-run:\n${text}`,
          },
        }
      }
      // With --wait-answer both permission and non-permission questions first
      // wait for a human reply; on timeout both fall back to autoAnswer and
      // the AI decides autonomously and continues; only a permission question
      // under the default (no --wait-answer) blocks outright (unattended,
      // the driver cannot decide authorization in the human's stead).
      if (!repeated && (!permission || waitAnswer > 0)) {
        own.autoAnswered.push(text)
        fx.log(`❓ received a ${permission ? "permission" : "non-permission"} question:\n${text}`)
        const human = waitAnswer > 0 ? await fx.askHuman(waitAnswer, "auto-answered on timeout") : undefined
        // The run's switches, frozen in the context when the turn started.
        const ask = ctx.switches.ask
        const fallback = autoAnswer(ask)
        const reply = human ?? fallback
        // The settlement: a human reply, a wait that expired into the
        // fallback, or the driver answering outright (no wait configured).
        settle(event.request, ctx.sessionID, human ? "human" : waitAnswer > 0 ? "timeout" : "driver", human ?? undefined)
        // Proxy-answer observation (auto-resolve H1,
        // plans/0020-auto-resolve-design.md §G/§H-①): only fallback auto
        // answers count — a human reply is a real person's decision, and the
        // dryrun preflight produces no engineering decisions. On fallback the
        // old single-line `→ auto answer: <long text>` form is replaced by a
        // two-line highlighted one (the full answer text demoted to verbose
        // logging), making "the driver decided for the user" visible at a
        // glance and countable afterwards in the session log.
        if (human) fx.log(`→ human answer: ${human}`)
        else if (ctx.opts.dryrun) fx.log(`→ auto answer: ${fallback}`)
        else {
          own.resolves.push({ at: fx.now(), question: text, session: ctx.sessionID })
          fx.log(`⚑ auto-answer (AUTO-RESOLVE) #${own.resolves.length}: ${compactText(text)}`)
          fx.log(`  → answered; ${ask ? "the driver recorded it in full; this mode does not require the session to label it separately" : "asking the session to label the decision with AUTO-RESOLVE"}`)
          fx.vlog(`  answer content: ${fallback}`)
        }
        await fx.replyQuestion(event.request, event.questions.map(() => [reply]))
        return "consumed"
      }
      await fx.rejectQuestion(event.request)
      await fx.abort()
      // The policy's own answer (a permission the driver cannot grant
      // unattended, or a repeat after auto-answer): settled by the driver.
      settle(event.request, ctx.sessionID, "driver")
      return {
        settle: {
          kind: "blocked",
          question: permission ? text : `asked again about the same question after auto-answer; handle it manually outside the session, then re-run:\n${text}`,
        },
      }
    }
    if (input.event.type === "permission") {
      const event = input.event
      // dryrun preflight: auto-deny without interrupting the session, so the
      // AI records the blocked item and goes on probing the next one.
      if (ctx.opts.dryrun) {
        fx.log(`🔐 preflight probe denied (recorded in the report): ${event.permission} (${event.patterns.join(", ")})`)
        raise(event.request, `permission ${event.permission} (${event.patterns.join(", ")})`, ctx.sessionID)
        settle(event.request, ctx.sessionID, "driver")
        await fx.replyPermission(event.request, "reject")
        return "consumed"
      }
      const desc = `${event.permission} (${event.patterns.join(", ")})`
      raise(event.request, `permission ${desc}`, ctx.sessionID)
      const mode = ctx.opts.permission ?? "ask-deny"
      // auto-allow: no waiting for a human, auto-approve immediately
      // ("always" lets this request through).
      if (mode === "auto-allow") {
        fx.log(`🔐 permission request received; auto-allowed via --permission auto-allow: ${desc}`)
        settle(event.request, ctx.sessionID, "driver")
        await fx.replyPermission(event.request, "always")
        return "consumed"
      }
      // ask-*: first wait for a human (--wait-answer minutes; unset means no
      // wait, i.e. treated as a timeout). An answer of allow/yes/y and the
      // like confirms the authorization ("always" lets it through); any other
      // explicit answer denies the permission without interrupting the
      // session, and the AI works around it and continues; on timeout the
      // mode's fallback applies — ask-allow auto-approves, ask-deny
      // auto-denies but the session continues, ask-fail denies and exits the
      // run.
      let human: string | undefined
      if (waitAnswer > 0) {
        fx.log(`🔐 permission request received: ${desc}`)
        human = await fx.askHuman(
          waitAnswer,
          `enter allow/yes/y to approve; any other answer denies the permission and continues; on timeout handled as --permission ${mode}`,
        )
      } else {
        fx.log(`🔐 permission request received (--wait-answer unset, not waiting for a human; handled as --permission ${mode}): ${desc}`)
      }
      if (human && isApproval(human)) {
        fx.log(`→ human allowed: ${human} (always)`)
        settle(event.request, ctx.sessionID, "human", human)
        await fx.replyPermission(event.request, "always")
        return "consumed"
      }
      if (human) {
        fx.log(`→ human denied: ${human} (permission denied; the AI continues without it)`)
        settle(event.request, ctx.sessionID, "human", human)
        await fx.replyPermission(event.request, "reject")
        return "consumed"
      }
      if (mode === "ask-allow") {
        fx.log(`→ wait timed out; --permission ask-allow auto-allowed: ${desc}`)
        settle(event.request, ctx.sessionID, waitAnswer > 0 ? "timeout" : "driver")
        await fx.replyPermission(event.request, "always")
        return "consumed"
      }
      await fx.replyPermission(event.request, "reject")
      if (mode === "ask-deny") {
        fx.log(`→ wait timed out; --permission ask-deny auto-denied (the AI continues without it): ${desc}`)
        settle(event.request, ctx.sessionID, waitAnswer > 0 ? "timeout" : "driver")
        return "consumed"
      }
      // ask-fail: deny and exit the run (blocked halt, the question recorded
      // in the run log).
      await fx.abort()
      settle(event.request, ctx.sessionID, waitAnswer > 0 ? "timeout" : "driver")
      return {
        settle: {
          kind: "blocked",
          question: `permission request unanswered (--permission ask-fail): ${desc}. Allow it in the permission rules of the target directory's opencode.json, then re-run.`,
        },
      }
    }
    return "pass"
  },
}
