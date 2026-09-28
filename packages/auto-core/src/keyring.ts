// Key rings (plans/0055 §4.3, §6.4, §7 step 1): an opencode provider's keys
// form one ring, declared on its model entries and applied per provider. The
// driver never holds a key's value: a key is a reference (`{env:NAME}`,
// `{file:/absolute/path}`) that the managed opencode server substitutes in
// its own process through the spawn config (`AgentHostOptions.config`, sent
// as OPENCODE_CONFIG_CONTENT and merged over the project's opencode.json).
// Logs and messages name references only (`key 2/3 ZHIPU_KEY_B`), so no key
// value is ever read, logged or written by the driver (C4).
//
// This module is the mechanism's pure half: the rings built from a registry,
// the label logs use for one key, and the rotation shape the escalation
// decides on. The run state — the built rings, the current position per
// provider and whether rotation is active — lives in the router service
// (createRouter's key-ring methods, one instance per run; the position never
// moves back — a cleared key mark does not rewind it, only a failure of the
// current key advances it, §6.4). Rotation is a server restart: the next key
// is written into the spawn config and the managed server restarts, after
// which the caller re-dispatches the same model from a fork of the failed
// session (§7 step 1, src/session.ts).
//
// Activation happens where the run's agent hosts start (src/agent-pool.ts),
// which knows whether the opencode servers are managed or external. Under an
// external server (--server, OPENCODE_AUTO_SERVER, an agent profile's
// `server`) rings are inactive: no spawn config, no rotation, no §6.2 rule-4
// exclusion — and the run-start routing block says so. Without a registry
// nothing here runs (C2). Sits below the session layer and above the agent
// domain (§12): no loop, no session-driving, no agent host imports.
import type { ModelReference, ModelRegistry } from "./models"

// The registry's rings, by provider, in registry order. The loader
// guarantees that every opencode entry on one provider declares the same
// ring in the same order (src/models.ts rings()), so the first entry seen
// per provider defines it and entries without keys contribute nothing.
// Pure: no run state touches this.
export function buildRings(registry: ModelRegistry): Map<string, ModelReference[]> {
  const rings = new Map<string, ModelReference[]>()
  for (const entry of registry.models.values()) {
    if (entry.keys === undefined || entry.keys.length === 0 || entry.provider === undefined) continue
    if (!rings.has(entry.provider)) rings.set(entry.provider, [...entry.keys])
  }
  return rings
}

// One key of a ring at a position: the reference and where it sits.
export type RingKey = { ref: ModelReference; index: number; total: number }

// The label logs use for one key of a ring: "2/3 ZHIPU_KEY_B". The position
// is 1-based; the name is the reference's label (the variable name, or the
// file path as written), never a value.
export function ringKeyLabel(key: RingKey): string {
  return `${key.index + 1}/${key.total} ${key.ref.label}`
}

// A decided rotation (§7 step 1): the current key `from` is marked down, the
// ring advances to `to`. Deciding (the router's ringRotation) mutates
// nothing; committing (its commitRotation) writes the mark and the position,
// so a caller can check the preconditions (a host that can take a new spawn
// config) first.
// AUTO-DECISION: rotation is decide-then-commit rather than one mutating call (the escalation must not leave a mark or move a position it could not act on — no host, no setConfig — while a decided-but-uncommitted rotation stays replayable)
export type RingRotation = { provider: string; from: RingKey; to: RingKey }
