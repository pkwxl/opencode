// Failback granularity (design document plans/0017-model-routing-design.md):
// OPENCODE_AUTO_MODEL_FAILBACK_SCOPE controls at which pipeline boundary the
// reset back to the preferred model happens after failing over to a
// candidate — inclusive granularity (the same RANK idea as step.ts): phase
// only at phase boundaries (the failover's down marks survive the task
// boundaries); task (default) clears at the task boundary, where the chain
// is destroyed; subtask adds the subtask boundary; session fails back at
// every new-session start (attempt's new-session branch clears the chain's
// route and the session-scope marks; the migrated session forked out by a
// failover goes the pending path and does not trigger it, to prevent
// oscillation). With the implicit registry every run fails over through the
// marks, so the scope is the registry's down-mark scope everywhere.
//
// This module holds the pure half only — the granularity arithmetic. The
// state the semantics moved between (the pending /failback order, the
// run-time model-order override and the down marks of the model registry)
// lives in the router service (src/router.ts), one instance per run inside
// the run's services holder; the boundary hooks that act on the granularity
// are the loop's, the chain's and attempt's, calling the router through the
// carriers named in its header.
import type { Boundary } from "./control-types"
import type { FailbackScope } from "./switches"

// The fineness order of boundaries and granularities: the finer the value,
// the larger the rank; boundary rank ≤ granularity rank means reset (session
// has no matching Boundary — for a candidate on the chain its reset point is
// attempt's new-session branch; for the down marks, "session" is
// scope=session's equivalent boundary: marks cleared at every new-session
// start).
const RANK: Record<FailbackScope | Boundary, number> = { phase: 1, task: 2, subtask: 3, session: 4 }

// Whether the granularity covers the boundary (pure function, for unit
// tests): inclusive — session covers every boundary, subtask covers
// subtask/task/phase, task covers task and phase (all carried naturally by
// the chain/holder lifetimes), phase covers only phase. "session" as a
// boundary is covered only by scope=session.
export function failbackApplies(scope: FailbackScope, boundary: Boundary | "session"): boolean {
  return RANK[boundary] <= RANK[scope]
}
