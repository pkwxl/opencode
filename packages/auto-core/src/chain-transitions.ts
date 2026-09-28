// The named transitions of the session chain: the one home for the
// computations and (as the consolidation proceeds) the mutations of
// SessionChain, so the chain's state changes stay findable instead of being
// 160-odd field writes spread over the session-driving files (plans/0061
// §4.8). Every module below the session-driving layer may call these; nothing
// else may write a chain field (test/chain-writes.test.ts holds the write
// ratchet: a per-file count table that only goes down, reaching zero when the
// mutations have all moved here).
//
// This file starts with the two pure computations that were copied four times
// each (plans/0061 §1 F5): the fork-source list and the no-registry model
// priority chain. The mutating transitions land here together with the
// conversion of their callers.

import { resolveModel, roleOf, type SessionChain } from "./chain"
import { failbackOverride, stickyModel } from "./failback"
import type { PhaseKey } from "./phases/registry"
import type { Switches } from "./switches"

// One candidate fork source of a retry, failover, key rotation or recovery:
// the session id, its accumulated context usage (the fork value, compared
// below), and `why` — the label the log line of the picking site names the
// source by ("failed session" / "original session").
export type ForkSource = { id: string; used: number; why: string }

// The fork sources of a chain, most valuable first — the one "keep the most
// valuable session" criterion every fork-seeding site of the driver shares
// (the retry ladder, the model failover, the provider-key rotation and the
// recovery loop): the session the prompt was dispatched to, recorded in
// chain.failed, but only when it holds content (a 0-usage session is a pure
// error stub that failed on dispatch and produced nothing), and the chain's
// original session — deduplicated when both name the same one (a non-retryable
// failure promotes the failed session to chain.id), then ordered by
// accumulated context usage descending: a timeout/stream-break fault has
// nothing to do with the session's content, and the 100k+ of verified output
// inside it is the round's most valuable asset; a caller that opened a blank
// session instead would throw it away and hit the same wall from zero again.
export function forkSources(chain: SessionChain): ForkSource[] {
  const sources: ForkSource[] = []
  if (chain.failed && chain.failed.used > 0) sources.push({ ...chain.failed, why: "failed session" })
  if (chain.id !== undefined && chain.id !== chain.failed?.id) sources.push({ id: chain.id, used: chain.used, why: "original session" })
  return sources.sort((a, b) => b.used - a.used)
}

// The model a no-registry dispatch runs on, as one priority chain: the chain's
// failover candidate > the phase-scoped sticky holder > the /failback
// wildcard override > the routing table (role > phase type id > preset letter
// > wildcard). Without a model registry this decides every dispatch target,
// the failover's "from" label and the strict-resume record's model; under a
// registry the selection core decides instead, so callers test their routing
// facts before reaching for this. `phase` is the run's current phase
// reference (its type entry feeds the routing table) while the role comes
// from the chain itself (an explicit role wins over the chain's phase, which
// wins over bypass). A resume has no live chain: its caller passes a minimal
// chain view built from the record's role and phase, so the priority chain
// starts at the sticky holder — the record predates this run's chain and no
// candidate of it can carry over. Undefined = no routing configured; the
// dispatch then sends no model key and the agent's default applies.
export function modelOfChain(chain: SessionChain, switches: Switches, phase: PhaseKey | undefined): string | undefined {
  return chain.model ?? stickyModel() ?? failbackOverride()?.wildcard ?? resolveModel(switches.model, phase?.entry, roleOf(chain))
}
