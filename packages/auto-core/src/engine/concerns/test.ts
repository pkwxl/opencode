// The test concern (plans/0061 §4.5, the idle row's test cell, run only with
// a test run): the --test-by-driver test execution protocol. When the session
// goes idle, the protocol first settles any pending test request — the
// tmp/test.sh request marker (holding a script path under test/ or an inline
// script) is executed and the rendered result steered back into this session
// — and any unfinished handover request: --handover-test switches, when used
// reaches the cap, to asking for a handover document, and the session ends
// normally once the document is ready (the slice's handover flag). This cell
// holds the turn's only kernel fx calls (the freeze pin commitFreeze, the
// pending-script resolution resolveTest, the test execution runTest), each
// preceding its path's single steer — the audit's idle quiet point never
// trips on this protocol, and that invariant is load-bearing: the cell runs
// before every other idle cell that may steer (the liveness truncation
// continuation after it steers and stops the input), so a concern placed
// wrongly before it and steering there would trip the kernel-after-steer
// audit at this cell's next kernel call.
import { join, relative } from "node:path"
import type { Watch } from "../../chain"
import { suffixedTitle } from "../../git"
import { handoffComplete } from "../../handover"
import { commitBlocked, strictResumeActive } from "../../unit-commit"
import { renderTestResult, renderTestWrapup } from "../../prompt"
import { promptFacts } from "../../prompt-facts"
import { formatTokens } from "../../session-api"
import { testHandoverDue } from "../../usage"
import type { Advice, Concern, TurnContext, TurnFx, TurnState, TurnView } from "../contract"

// What one protocol turn needs beside its context. `blockedExtra` is the
// settle protocol's channel for this concern's blocked exits: the settle
// itself names only the question (plus, on the strict-resume exit, the
// invalid mark), while the Watch extras those exits carry — testHandover,
// testHandoverInvalid — are protocol state. The concern writes them beside
// the settle it returns and watch's result mapping reads the same cell, so
// which exit added which extra stays a property of the exit.
export type TestDeps = {
  blockedExtra: { extra?: Partial<Watch> }
}

// The idle protocol's outcome, as the old idle branch's handleIdleTest
// answered it: "continue" keeps the turn running (the input is consumed),
// "break" ends the test protocol's share of the row (the row passes on),
// "blocked" and "invalid" settle the turn.
type Handled = { type: "continue" } | { type: "break" } | { type: "blocked"; question: string } | { type: "invalid" }

// One concern instance per turn (a factory, not a module constant): the
// blocked-extras cell is per-turn wiring, shared with the result mapping
// built over the same cell.
export const makeTestConcern = (deps: TestDeps): Concern<"test"> => ({
  name: "test",
  // The wrap-up request already out (resumeWrapup) seeds the asked flag: it
  // is state of this turn, and when a mid-wrap-up session error is forked
  // onward by the retry ring / failover ring, the new attempt builds a new
  // turn — without the seeding the new instance would misjudge "wrap-up
  // finished" as a natural finish and the handover loop would be lost (the
  // pinned script never runs, the handover document is never archived). The
  // same seeding for cross-process interruption lives in exec-session's
  // recovery branch; runExecSession clears it after every runSession return,
  // once closed out.
  initial: (ctx): TurnState["test"] => ({ handover: false, asked: ctx.test?.resumeWrapup === true, retried: false }),
  handle: async (input, own, view, fx, ctx): Promise<Advice> => {
    if (input.kind !== "event" || input.event.type !== "idle") return "pass"
    const test = ctx.test
    if (test === undefined) return "pass"
    // Test execution protocol: idle first settles any pending test request
    // (execute + steer the result / handover request) before ending; the
    // session is only truly over when there is no pending test request and
    // no unfinished handover request. Every protocol path that steers or
    // settles stops the input here; "break" (nothing pending, or the handover
    // document complete) passes the row on to the liveness cell.
    const handled = await idleProtocol(test, own, view, fx, ctx)
    if (handled.type === "continue") return "consumed"
    if (handled.type === "blocked") {
      deps.blockedExtra.extra = { blocked: { type: "blocked", question: handled.question }, testHandover: own.handover }
      return { settle: { kind: "blocked", question: handled.question } }
    }
    if (handled.type === "invalid") {
      const question =
        `test handover document ${test.handoffFile} missing or empty (strict resume: the boundary write-verify failed; no more backfill retries; ` +
        `this unit will roll back to its baseline and redo). Last agent output:\n${view.transcript.lastText.trim().slice(-2000) || "(no output)"}`
      deps.blockedExtra.extra = { blocked: { type: "blocked", question }, testHandoverInvalid: true }
      return { settle: { kind: "blocked", question, invalid: true } }
    }
    // "break": nothing pending, or the handover document complete — the row
    // passes on to the liveness cell, whose own pass lets the spine's idle
    // terminal settle the turn naturally.
    return "pass"
  },
})

// The protocol proper, moved verbatim from the old idle branch: every path's
// statements in today's order, the slice reached through `own` and the other
// concerns' slices through the view.
const idleProtocol = async (test: NonNullable<TurnContext["test"]>, own: TurnState["test"], view: TurnView, fx: TurnFx, ctx: TurnContext): Promise<Handled> => {
  // The handover request is out: verify the handover document is finished
  // (F1, last line `Status: continue|done`). The criterion was tightened
  // from "non-empty" to the status line so interruption recovery can tell
  // "the session finished writing" from "a half-written file left by a
  // driver that died mid-write" — the latter must redo the wrap-up, not be
  // taken downstream as a completed handover.
  if (own.asked) {
    const doc = await fx.readText(test.handoffFile).catch(() => "")
    if (handoffComplete(doc, false)) {
      own.handover = true
      return { type: "break" }
    }
    // Handover-boundary write-verify
    // (plans/0022-session-recovery-fidelity-design.md 3.3, strict resume):
    // one invalid document decides it, no more steer-to-backfill retries —
    // "completion is never judged by agent self-report" applies to the
    // handover document too (the S07 phantom-file evidence), and the
    // discovery moment is exactly the handover boundary.
    if (strictResumeActive(ctx.opts, ctx.switches)) {
      return { type: "invalid" }
    }
    if (own.retried) {
      return {
        type: "blocked",
        question:
          `the test-handover session failed twice to produce a valid ${test.handoffFile} (missing, or lacking a \`Status: continue|done\` status line; hidden blockage). ` +
          `Check the file and re-run. Last agent output:\n${view.transcript.lastText.trim().slice(-2000) || "(no output)"}`,
      }
    }
    own.retried = true
    const ok = await fx.steer(
      `You ended the session last time without writing a valid ${test.handoffFile} (missing, or lacking the \`Status: continue|done\` status line). This is a hard requirement: ` +
        `write the progress, key decisions, failing-test context and next steps into that file, put the status line on the last line, and only then end the session.`,
    )
    if (!ok) return { type: "blocked", question: `steer dispatch failed (asking to backfill ${test.handoffFile}); cannot continue the session, see the log.` }
    return { type: "continue" }
  }
  const pending = join(test.tmp, "test.sh")
  if (!(await fx.exists(pending))) return { type: "break" }
  // The handover decision happens at this moment (D1), before execution —
  // the criterion is already decoupled from test outcome. On a hit the
  // driver first commits the freeze to pin the script down, then dispatches
  // the wrap-up + handover instruction; the test itself runs only after
  // the handover close-out, facing exactly the close-out commit's tree.
  const now = ctx.source.used()
  if (testHandoverDue(test, now)) {
    own.asked = true
    const n = test.handovers + 1
    fx.log(
      `⚠ ${test.label} context used ${formatTokens(now !== undefined && now > 0 ? now : test.startUsed)} tokens reached the ${formatTokens(test.limit)} cap; ` +
        `after the frozen commit, hand over first and then run the tests; asking for a handover document before switching to a new session`,
    )
    // Commit #1 (the freeze): pins the script under test and the sources.
    // The session is idle at this moment (this function is driven by the
    // idle event), no half-written files exist — the only safe mid-session
    // commit point; it goes through the git service's afterSession rather
    // than a bare commitTree so proxy-answer collection and reference
    // corrections land inside the freeze — corrections change files and
    // must precede the test start for all three to be the same snapshot.
    // The unit is not yet closed out, so no baseline is passed.
    const pin = await fx.commitFreeze(n)
    if (pin.type === "failed") {
      const pinSubject = suffixedTitle(test.subject, `test handover #${n} freeze`)
      return { type: "blocked", question: commitBlocked(pinSubject, pin).question }
    }
    // Only consume the request marker and pin the script down; execution
    // is deferred until after the handover wrap-up (runExecSession's
    // test.pending), so the wrap-up period has no concurrent writes at all
    // and the test faces exactly the close-out commit's tree.
    test.pending = await fx.resolveTest()
    // In-flight handover record (interruption recovery §I): this moment —
    // freeze committed, wrap-up not yet started — is the only correct time
    // to record it: the pending script was just consumed (the marker is
    // gone, a re-run can never read it again), and the session anchor has
    // not yet been buried under the wrap-up messages.
    await fx.saveHandover({
      task: test.task.id,
      scope: relative(test.dir, test.handoffFile),
      unit: test.unit,
      n,
      script: test.pending?.script,
      seq: test.pending?.seq,
      // The pinned session's agent profile (plans/0055 §8.2), under a
      // registry only; absent = the default agent's, as every pre-binding
      // record reads.
      ...(ctx.opts.routing ? { agent: ctx.opts.routing.runAgent } : {}),
      pinSession: ctx.sessionID,
      pinMessage: view.transcript.lastMessage,
    })
    const ok = await fx.steer(renderTestWrapup(promptFacts(ctx.opts), { handoffFile: test.handoffFile }))
    if (!ok) return { type: "blocked", question: "steer dispatch failed (test-handover request); cannot continue the session, see the log." }
    // The wrap-up request is in effect; seed resumeWrapup:
    // the test slice's asked flag is state of this turn, and when
    // a mid-wrap-up session error is forked onward by runSession's retry
    // ring / failover ring, the new attempt builds a new turn —
    // without this flag the new instance would misjudge "wrap-up finished"
    // as a natural finish and the handover loop would be lost (the pinned
    // script never runs, the handover document is never archived). The
    // same seeding for cross-process interruption lives in exec-session's
    // recovery branch; runExecSession clears it after every runSession
    // return, once closed out.
    test.resumeWrapup = true
    return { type: "continue" }
  }
  // Archive (a protocol marker whose presence is the request, removed after
  // execution so it can be requested again) → execute → feed back.
  const run = await fx.runTest()
  const ok = await fx.steer(renderTestResult(promptFacts(ctx.opts), run))
  if (!ok) return { type: "blocked", question: "steer dispatch failed (test result feedback); cannot continue the session, see the log." }
  return { type: "continue" }
}
