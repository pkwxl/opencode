// The twin-idle guard concern (plans/0061 §4.5, the guard cells of the part,
// message, error, retry and idle rows): one turn end settles only once. At a
// turn's end the server emits two idle events in a row (session.status idle +
// session.idle), and after a steer is dispatched (promptAsync returns
// immediately) the second idle arrives before the steered turn starts —
// handling it would misjudge the session as finished and settle early. After
// one idle is handled, further idles are ignored until a new session event of
// this session (a new turn starting) re-arms acceptance.
import type { Advice, Concern } from "../contract"

export const guardConcern: Concern<"guard"> = {
  name: "guard",
  initial: () => ({ idleHandled: false }),
  handle: async (input, own): Promise<Advice> => {
    // The concern's cells are all event rows; a synthetic or terminal input
    // never reaches it.
    if (input.kind !== "event") return "pass"
    if (input.event.type !== "idle") {
      // A new session event (part, message, error, retry — this concern's
      // non-idle cells) re-arms acceptance: the next idle ends a turn again.
      own.idleHandled = false
      return "pass"
    }
    // The stop: after one idle is handled, further idles are ignored.
    if (own.idleHandled) return "consumed"
    own.idleHandled = true
    // The row continues (the test protocol, the truncation continuation, the
    // natural settle).
    return "pass"
  },
}
