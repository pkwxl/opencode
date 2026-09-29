// The stuck-loop hint concern (plans/0061 §4.5, the part row's last cell):
// each tool call's terminal state is fed to the detector (src/stuck.ts);
// recognizing "the same action repeated with unchanged results" injects a
// hint via steer, helping weaker models break out of the spin. Hint only, the
// session is not aborted; a failed dispatch was already logged by the fx's
// steer, observation continues as usual. Under a registry the hint also
// counts into the model's stuck-hint counter (the protocol-drift criterion of
// 0055 §10 item 3); without one steerContext is undefined and
// statsModelEvent is a no-op. The slice is empty on purpose: the tracker
// lives in TurnContext (dispatch lifetime, one instance per session).
import { renderStuckHint } from "../../prompt"
import { STUCK_MAX_HINTS } from "../../stuck"
import type { Advice, Concern, TurnState } from "../contract"

export const stuckConcern: Concern<"stuck"> = {
  name: "stuck",
  initial: (): TurnState["stuck"] => ({}),
  handle: async (input, _own, view, fx, ctx): Promise<Advice> => {
    if (input.kind !== "event" || input.event.type !== "part") return "pass"
    const part = input.event.part
    // A newly echoed terminal tool part (the transcript concern's fresh flag,
    // set by its cell just before this one) is the detector's input; a
    // re-sent update feeds it once. Anything else ends the input here.
    if (ctx.stuck === undefined || part.kind !== "tool" || (part.status !== "completed" && part.status !== "error")) return "consumed"
    if (view.transcript.fresh === undefined) return "consumed"
    const hit = ctx.stuck.observe({
      tool: part.tool,
      input: part.input,
      status: part.status,
      result: (part.status === "error" ? part.error : part.output) ?? "",
    })
    if (hit === undefined) return "consumed"
    fx.log(
      `⚠ repetitive action detected: ${hit.tool} has ${hit.count} consecutive ${hit.kind === "error" ? "identical errors" : "identical calls with identical results"}; ` +
        `inserting a hint (level ${hit.level}/${STUCK_MAX_HINTS})`,
    )
    await fx.statsModelEvent("stuck")
    // A failed dispatch is ignored: the steer already logged it, and the
    // session keeps running — the hint is an attempt to help, not a gate.
    await fx.steer(renderStuckHint(hit))
    return "consumed"
  },
}
