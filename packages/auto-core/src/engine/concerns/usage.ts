// The usage concern (plans/0061 §4.5, the usage cell of the message row —
// the measurement point): every new completed assistant message (the
// transcript concern's cell before this filters everything else out)
// measures the session's context occupancy off the usage source
// (plans/0038: the adapter's tier decides whether a figure exists) and the
// model's window off the agent's context limits (fx.contextLimits,
// memoized once per turn), records both on the slice and vlogs the line.
// Under an ondemand handover steer (OPENCODE_AUTO_STEER, plans/0056) the
// same point decides the two in-turn steers: the hard wall — the effective
// wall of the last measurement (testrun.ts steerWall) — sends the handover
// hint once, spends every notice band with it and stops the row (the hint
// owns the measurement point; the stepUp cell after this never runs);
// below the wall the highest newly crossed milestone band steers its
// notice, one steer per measurement point, the lower bands crossed by the
// same jump spent with it. Notices do not suppress the step-up check: the
// row passes on, and the notice-then-step-up pair at one measurement point
// is the plan's ruled exception to the one-steer-per-quiet-point rule (F4)
// — the audit's quiet point is idle-only. A failed steer dispatch settles
// the turn blocked at either steer.
import { formatTokens } from "../../format"
import { fillUsageNote, steerWall, type Steer } from "../../testrun"
import { steerDue } from "../../usage"
import type { Advice, Concern, TurnState } from "../contract"

export const usageConcern: Concern<"usage"> = {
  name: "usage",
  initial: (): TurnState["usage"] => ({ pct: 100, used: 0, hinted: false, notes: new Set<number>() }),
  handle: async (input, own, _view, fx, ctx): Promise<Advice> => {
    if (input.kind !== "event" || input.event.type !== "message") return "pass"
    const info = input.event.message
    // Measurement point: the usage source already took this message in
    // (events/reported: its own figure; estimated: the running estimate).
    // An unknown figure (none, or none measured yet) changes nothing.
    const now = ctx.source.used()
    if (now === undefined) return "consumed"
    const limits = await fx.contextLimits()
    own.used = now
    // A message that names no model (claude's synthetic API-error message,
    // plans/0057 F21) ran under the window already in effect.
    own.limit = info.model !== undefined ? limits.get(info.model) : own.limit
    own.pct = own.limit ? Math.round((own.used / own.limit) * 100) : 100
    fx.vlog(`  context: ${formatTokens(own.used)}${own.limit ? `/${formatTokens(own.limit)}` : ""} tokens${own.limit ? ` (${own.pct}%)` : ""}`)
    const steer = ctx.steer
    if (steer !== undefined) {
      // Effective wall (plans/0056, plans/0059 D6): the 2×cap budget, raised
      // to a quarter of a large model window and clamped to 80% of any
      // window — the hard-wall hint must leave room to write the handover
      // document. Recomputed per measurement, so a mid-session model step-up
      // widens it naturally.
      const wall = steerWall(steer.limit, own.limit)
      own.wall = wall
      if (!own.hinted && steerDue(ctx.client.capabilities.usage, now, wall)) {
        // The hard wall supersedes the notice bands (a jump may cross both):
        // one steer, and the bands count as spent.
        own.hinted = true
        for (const note of steer.notes) own.notes.add(note.at)
        fx.log(`⚠ context used ${formatTokens(own.used)} tokens reached the wall ${formatTokens(wall)}; inserting the handover hint`)
        const ok = await fx.steer(steer.text)
        if (!ok) return { settle: { kind: "blocked", question: "steer dispatch failed (handover hint); cannot continue the session, see the log." } }
        // The handover hint owns this measurement point: the session is being
        // wound down by the project's cap, so a step-up steer in the same
        // breath would only confuse it. A session that keeps working past the
        // hint steps up at a later measurement (hinted stays true).
        // AUTO-RESOLVE: when one measurement crosses both the wall and a step-up point, which steer goes out? -> the handover hint (the wall is the operator's policy for ending the session, and the design keeps the two mechanisms independent without ordering them; a session that survives the hint still steps up at its next measurement)
        return "consumed"
      }
      // Milestone usage notices (plans/0056): informational steers, the
      // session decides when to hand over. One steer per measurement point —
      // the highest band newly crossed; lower bands crossed by the same jump
      // are spent with it. Notices do not suppress the step-up check below.
      let fire: Steer["notes"][number] | undefined
      for (const note of steer.notes) {
        if (now < note.at * wall) break
        if (!own.notes.has(note.at)) fire = note
      }
      if (fire !== undefined) {
        for (const note of steer.notes) if (note.at <= fire.at) own.notes.add(note.at)
        fx.log(`• context used ${formatTokens(own.used)} tokens (${Math.round((own.used / wall) * 100)}% of the wall ${formatTokens(wall)}); steering a usage notice`)
        const ok = await fx.steer(fillUsageNote(fire.text, now, wall))
        if (!ok) return { settle: { kind: "blocked", question: "steer dispatch failed (usage notice); cannot continue the session, see the log." } }
      }
    }
    // The measurement happened and the wall did not own it: the row passes
    // on to the stepUp cell (the row's last cell consumes the input there).
    return "pass"
  },
}
