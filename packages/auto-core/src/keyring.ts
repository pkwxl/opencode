// Key rings (plans/0055 §4.3, §6.4, §7 step 1): an opencode provider's keys
// form one ring, declared on its model entries and applied per provider. The
// driver never holds a key's value: a key is a reference (`{env:NAME}`,
// `{file:/absolute/path}`) that the managed opencode server substitutes in
// its own process through the spawn config (`AgentHostOptions.config`, sent
// as OPENCODE_CONFIG_CONTENT and merged over the project's opencode.json).
// Logs and messages name references only (`key 2/3 ZHIPU_KEY_B`), so no key
// value is ever read, logged or written by the driver (C4).
//
// This module is the mechanism's pure half: the rings built from a registry
// (and the registry's whole provider set, the streaming-timeout floor's
// domain — plans/0127), the label logs use for one key, and the rotation
// shape the escalation decides on. The run state — the built rings, the
// current position per provider, the one-shot skip flags and the `until`
// marks of plans/0144, and whether rotation is active — lives in the router
// service (createRouter's key-ring methods, one instance per run; the
// position never moves back on its own — §6.4's floor, "no restart without
// a failure" — but the search is order-first since 0144 D2, so a rotation
// lands on the earliest key the run holds no evidence against, and
// /failback rewinds every position to 0, D3). Rotation is a server restart:
// the landed key is written into the spawn config and the managed server
// restarts, after which the caller re-dispatches the same model from a fork
// of the failed session (§7 step 1, src/session.ts).
//
// Activation happens where the run's agent hosts start (src/agent-pool.ts),
// which knows whether the opencode servers are managed or external. Under an
// external server (--server, OPENCODE_AUTO_SERVER, an agent profile's
// `server`) rings are inactive: no spawn config, no rotation, no §6.2 rule-4
// exclusion — and the run-start routing block says so. Without a registry
// layer nothing here runs (the implicit registry carries no key rings). Sits
// below the session layer and above the agent domain (§12): no loop, no
// session-driving, no agent host imports.
import type { ModelReference, ModelRegistry } from "./models-schema"

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
type RingKey = { ref: ModelReference; index: number; total: number }

// Every provider the registry's opencode entries name (the loader derives
// `provider` from each opencode entry's provider/model id, so the set is the
// fleet's whole provider surface, ringed or not — a ringless provider can
// still receive a dispatch and still needs the streaming-timeout floor of
// plans/0127 in the spawn config). Pure: no run state touches this.
export function registryProviders(registry: ModelRegistry): Set<string> {
  const providers = new Set<string>()
  for (const entry of registry.models.values()) {
    if (entry.provider !== undefined) providers.add(entry.provider)
  }
  return providers
}

// The label logs use for one key of a ring: "2/3 ZHIPU_KEY_B". The position
// is 1-based; the name is the reference's label (the variable name, or the
// file path as written), never a value.
export function ringKeyLabel(key: RingKey): string {
  return `${key.index + 1}/${key.total} ${key.ref.label}`
}

// A decided key search (§7 step 1; the search order-first and the one-shot
// flags of plans/0144 D2): the search starts at declared index 0 and
// considers every key except the current one (`from`, the failure being
// rotated away from). It lands (`to`) on the first key that carries no
// skip flag and no active `until` mark — the earliest key the run holds no
// evidence against, a recovered earlier key included — and `passed` names
// the flagged keys it visited before stopping, by reference string. `to`
// undefined = the ring refuses to land right now (every other key flagged
// or `until`-held; a single-key ring always refuses). Deciding (the
// router's ringRotation) mutates nothing, and committing (its
// commitRotation) applies the search either way: the passed flags clear
// (the one-shot consumed — the next search considers those keys again),
// the from key's failure is written (a stated reset held to its instant, a
// bare failure a fresh flag), and the position moves only when the search
// landed. A landed search stays replayable — a caller that finds no host
// commits nothing and every flag stands.
// AUTO-DECISION: rotation is decide-then-commit rather than one mutating call (the escalation must not leave a mark, clear a flag or move a position it could not act on — no host, no setConfig — while a decided-but-uncommitted search stays replayable; a refusal, needing no host, commits unconditionally)
export type RingRotation = { provider: string; from: RingKey; to?: RingKey; passed: string[] }
