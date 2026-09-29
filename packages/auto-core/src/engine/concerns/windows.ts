// The usage-windows concern (plans/0061 §4.5, the `limit` row): the account's
// usage windows (plans/0057 §5.2), logged and recorded (§8) when they change,
// nothing else — not a turn event, so the twin-idle guard is untouched. The
// router holds the logged windows (run state, keyed by client); the slice is
// empty on purpose, so the concern owns a key without owning state.
import type { Advice, Concern, TurnState } from "../contract"

export const windowsConcern: Concern<"windows"> = {
  name: "windows",
  initial: (): TurnState["windows"] => ({}),
  handle: async (input, _own, _view, fx, ctx): Promise<Advice> => {
    if (input.kind !== "event" || input.event.type !== "limit") return "pass"
    // A `limit` event is logged only when its status or a window's reset
    // changed against what this client last logged — the router's noteWindows
    // answers that and prints the line — and only a change reaches the run's
    // recorder through onLimit (the attempt layer books it on the chain's
    // account).
    if (ctx.services.router.noteWindows(ctx.client, input.event)) fx.onLimit(input.event)
    return "consumed"
  },
}
