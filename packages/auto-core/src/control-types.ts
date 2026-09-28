// The control modules' shared vocabulary: the pipeline boundary kind and the
// --interactive sideband's interface. Step mode, the graceful /exit and model
// failback all pause or reset at the same three safe boundaries, and step's
// pause takes the sideband instead of opening a second readline over stdin —
// so their types are shared across src/step.ts, src/interactive.ts,
// src/exit.ts and src/failback.ts.
//
// Types only, importing nothing: a leaf every control module can depend on.
// The extraction exists for the dependency direction (plans/0061 §2.2 R8):
// with Boundary defined in step.ts and Interactive in interactive.ts, the
// type edges step → interactive (the pause's sideband) and exit/failback →
// step (the boundary kind) closed the cycle step → interactive → exit/failback
// → step once type edges are counted; the shared vocabulary moves here so the
// control modules depend on this leaf instead of on each other.

// Pipeline boundaries (kind): phase = the --phases phase handover completed; task =
// the task's final-state commit completed; subtask = the checklist item's tick
// committed.
export type Boundary = "phase" | "task" | "subtask"

export type Interactive = {
  // Called by the runner whenever a session is created/reused; subsequent
  // input goes to that session. agent is the agent profile the session lives
  // on (plans/0055 §8.1): the sideband resolves the session's own host
  // through the pool.
  attach(sessionID: string, agent?: string): void
  // Show the prompt and wait for one line of human input; minutes omitted =
  // no timeout (waiting on the input line or stdin closing); with a value set,
  // timeout or close falls back to undefined (the step-mode pause hard-waits
  // through the omitted-value behavior).
  question(promptText: string, minutes?: number): Promise<string | undefined>
  close(): void
}
