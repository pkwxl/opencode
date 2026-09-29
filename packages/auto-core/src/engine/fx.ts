// The production TurnFx (plans/0061 §4.2/§4.3): the one I/O path of a turn,
// over the AgentClient, the testrun module, the git service's freeze commit,
// the in-flight handover record, the per-model stats counter and the human
// question. watch() builds it once per turn from the turn's context and hands
// it to the spine, which wraps it with the audit (the queue discipline's
// invariants, §4.4 rule 4) — so every member below is the exact call the
// pre-consolidation watch body made, and nothing more: the policy of when to
// call stays with the concerns.
//
// Member by member, against the old body:
// - steer is steerText: the usage source takes the text, promptAsync
//   dispatches (naming the reached context step's model when there is one),
//   a failed dispatch logs and answers false;
// - contextLimits is the `limits ??=` memoization — one fetch per turn;
// - commitFreeze is the test-handover freeze pin through the git service
//   (afterSession with the handoff-N-pin stage and the suffixed subject, no
//   baseline); runTest is executeTest; resolveTest is resolveTestScript.
//   The three kernel members exist only inside the test protocol and throw
//   on a turn without a test run;
// - saveHandover writes the in-flight record under the test run's dir (the
//   record itself is assembled by the concern — pinMessage is turn state);
// - readText/exists are the bare Bun.file reads; the handover check's
//   unreadable-is-empty catch stays with the concern (it is the write-verify
//   criterion, not I/O);
// - askHuman waits with the turn's interactive channel and dir; onModel and
//   onLimit pass through to the caller's observation callbacks (the
//   once-per-turn and on-change guards live in the concerns); log/vlog are
//   the run's log; now() reads the services' clock.
import { suffixedTitle } from "../git"
import { saveHandover as writeHandover } from "../handover"
import { log, vlog } from "../log"
import { askHuman as waitForHuman, formatClientError } from "../session-api"
import { statsModelEvent as recordModelEvent } from "../stats"
import { executeTest, resolveTestScript, type TestRun } from "../testrun"
import type { LimitEvent, TurnContext, TurnFx } from "./contract"

// Builds the turn's fx. The observation callbacks are watch()'s own
// parameters, passed through unchanged; steerModel is how the steer default
// (the reached context step's id, the stepUp slice's model field) reaches an
// object built before the slices exist — a getter, so a mid-turn step-up is
// seen by the steers that follow it. watch wires it to the live slice object.
// AUTO-DECISION: the steer-model default arrives as a zero-arg getter rather
// than the TurnView (the fx is constructed before runTurn builds the slices;
// a getter over the pre-created slice object keeps the contract's
// "default model = view.stepUp.model" without the fx knowing the view).
export function makeTurnFx(args: {
  ctx: TurnContext
  steerModel?: () => string | undefined
  onModel?: (model: string) => void
  onLimit?: (event: LimitEvent) => void
}): TurnFx {
  const { ctx } = args
  // The contextLimits memo (the old body's `limits ??=`): one fetch per turn.
  let limits: ReadonlyMap<string, number> | undefined
  // The kernel members exist only inside the test protocol; a call without a
  // test run is a programming error (the old body would have dereferenced
  // `test!`).
  const testRun = (): TestRun => {
    if (ctx.test === undefined) throw new Error("turn engine fx: a test-protocol kernel call (commitFreeze/runTest/resolveTest/saveHandover) on a turn without a test run")
    return ctx.test
  }
  return {
    steer: async (text, model) => {
      ctx.source.prompt(text)
      const named = model ?? args.steerModel?.()
      const sent = await ctx.client.promptAsync({ session: ctx.sessionID, text, ...(named !== undefined ? { model: named } : {}) })
      if (sent.ok) return true
      log(`⚠ steer dispatch failed: ${formatClientError(sent.error)}`)
      return false
    },
    replyQuestion: async (request, answers) => {
      await ctx.client.replyQuestion(request, answers)
    },
    rejectQuestion: async (request) => {
      await ctx.client.rejectQuestion(request)
    },
    replyPermission: async (request, reply) => {
      await ctx.client.replyPermission(request, reply)
    },
    abort: async () => {
      await ctx.client.abort(ctx.sessionID)
    },
    askHuman: (timeoutMin, hint) => waitForHuman(timeoutMin, hint, ctx.opts.interactive, ctx.opts.dir),
    contextLimits: async () => {
      limits ??= await ctx.client.contextLimits()
      return limits
    },
    readText: (path) => Bun.file(path).text(),
    exists: (path) => Bun.file(path).exists(),
    commitFreeze: (n) => {
      const test = testRun()
      const subject = suffixedTitle(test.subject, `test handover #${n} freeze`)
      return ctx.services.git.afterSession(test.dir, ctx.opts, test.task, { stage: `${test.unit} handoff-${n}-pin`, subject })
    },
    runTest: () => executeTest(testRun(), ctx.opts),
    resolveTest: () => resolveTestScript(testRun()),
    saveHandover: (record) => writeHandover(testRun().dir, record),
    statsModelEvent: (kind) => recordModelEvent(ctx.opts.dir, ctx.steerContext?.name, kind),
    onModel: (model) => args.onModel?.(model),
    onLimit: (event) => args.onLimit?.(event),
    log: (line) => log(line),
    vlog: (line) => vlog(line),
    now: () => ctx.services.clock.now(),
  }
}
