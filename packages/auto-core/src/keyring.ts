// Key rings (plans/0055 §4.3, §6.4, §7 step 1): an opencode provider's keys
// form one ring, declared on its model entries and applied per provider. The
// driver never holds a key's value: a key is a reference (`{env:NAME}`,
// `{file:/absolute/path}`) that the managed opencode server substitutes in
// its own process through the spawn config (`AgentHostOptions.config`, sent
// as OPENCODE_CONFIG_CONTENT and merged over the project's opencode.json).
// Logs and messages name references only (`key 2/3 ZHIPU_KEY_B`), so no key
// value is ever read, logged or written by the driver (C4).
//
// Ring state is run state, in memory only: the current position per provider
// and the per-key down marks (src/failback.ts, cleared at the failback
// boundaries like every mark). The position never moves back — a cleared key
// mark does not rewind it, only a failure of the current key advances it
// (§6.4), so there is no restart churn. Rotation is a server restart: the
// next key is written into the spawn config and the managed server restarts,
// after which the caller re-dispatches the same model from a fork of the
// failed session (§7 step 1, src/session.ts).
//
// Activation (activateRings) happens where the run's agent starts
// (src/agent-choice.ts), which knows whether the opencode server is managed
// or external. Under an external server (--server, OPENCODE_AUTO_SERVER, an
// agent profile's `server`) rings are inactive: no spawn config, no
// rotation, no §6.2 rule-4 exclusion — and the run-start routing block says
// so. Without a registry nothing here runs (C2). Sits below the session
// layer and above the agent domain (§12): no loop, no session-driving, no
// agent host imports.
import { clearKeyDownMarks, isKeyDown, markKeyDown } from "./failback"
import type { ModelEntry, ModelReference, ModelRegistry } from "./models"

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
// ring advances to `to`. Deciding (ringRotation) mutates nothing; committing
// (commitRotation) writes the mark and the position, so a caller can check
// the preconditions (a host that can take a new spawn config) first.
// AUTO-DECISION: rotation is decide-then-commit rather than one mutating call (the escalation must not leave a mark or move a position it could not act on — no host, no setConfig — while a decided-but-uncommitted rotation stays replayable)
export type RingRotation = { provider: string; from: RingKey; to: RingKey }

// Run state (per process; tests reset it). `rings` is undefined before the
// run's agent starts, and every reader then answers "no ring": selection's
// rule 4 never excludes, nothing rotates, the startup block shows declared
// counts only.
let rings: Map<string, ModelReference[]> | undefined
let positions = new Map<string, number>()
let active = false

// Builds the run's rings from the registry and records whether they are
// active. `external` = the opencode server is not managed by this driver
// (--server, OPENCODE_AUTO_SERVER or the agent profile's `server`), so it
// cannot be restarted onto another key: the rings stay declared (for the
// startup block) but inactive.
export function activateRings(registry: ModelRegistry, external: boolean): void {
  rings = buildRings(registry)
  positions = new Map()
  active = !external
}

// Whether the run's rings rotate. False before activation and under an
// external server.
export function ringsActive(): boolean {
  return rings !== undefined && active
}

// The ring's current key of a provider, by reference; undefined when the
// provider has no ring or the rings never activated.
export function currentKey(provider: string): ModelReference | undefined {
  const keys = rings?.get(provider)
  if (keys === undefined || keys.length === 0) return undefined
  return keys[(positions.get(provider) ?? 0) % keys.length]!
}

// §6.2 rule 4: does this provider's key ring have a key that is not down?
// True for every provider when the rings never activated or are inactive
// (an external server cannot rotate, so the ring never excludes a
// candidate), and for providers without a ring.
export function ringHasUsableKey(provider: string, now: number): boolean {
  const keys = rings?.get(provider)
  if (!ringsActive() || keys === undefined) return true
  return keys.some((key) => !isKeyDown(provider, key.ref, now))
}

// Whether the run's rings are active for this provider (the escalation's
// step-1 gate, §7): a key failure on a ringed provider marks the key down
// even when the ring cannot rotate — every key is down, or it holds one key
// — so §6.2 rule 4 then keeps the provider's entries out of selection.
export function hasActiveRing(provider: string): boolean {
  return rings !== undefined && active && rings.get(provider) !== undefined
}

// Would a rotation land on a key? The current key will be marked down
// (step 1 of §7), so the search starts after it and wraps, skipping every
// key that is down; undefined = no ring, inactive rings, or the ring is
// exhausted (every key down). Mutates nothing.
export function ringRotation(provider: string, now: number): RingRotation | undefined {
  const keys = rings?.get(provider)
  if (!ringsActive() || keys === undefined || keys.length < 2) return undefined
  const from = (positions.get(provider) ?? 0) % keys.length
  for (let step = 1; step < keys.length; step++) {
    const index = (from + step) % keys.length
    if (!isKeyDown(provider, keys[index]!.ref, now))
      return {
        provider,
        from: { ref: keys[from]!, index: from, total: keys.length },
        to: { ref: keys[index]!, index, total: keys.length },
      }
  }
  return undefined
}

// Commits a decided rotation: the current key is marked down and the
// position advances. The position stays where it landed afterwards — a
// cleared mark never moves it back (§6.4).
export function commitRotation(rotation: RingRotation): void {
  markKeyDown(rotation.provider, rotation.from.ref.ref)
  positions.set(rotation.provider, rotation.to.index)
}

// The spawn config content for the managed server's next spawn (§4.3
// injection): every active ring's current key as the provider's apiKey
// reference. undefined = send no config at all (no active ring), so the
// spawn environment keeps OPENCODE_CONFIG_CONTENT = "{}" exactly as the SDK
// spawn sends it. Only references appear here; opencode substitutes them in
// its own process.
export function spawnKeyConfig(): Record<string, unknown> | undefined {
  if (!ringsActive() || rings === undefined || rings.size === 0) return undefined
  const provider: Record<string, unknown> = {}
  for (const [id, keys] of rings) {
    const key = currentKey(id)
    if (key !== undefined) provider[id] = { options: { apiKey: key.ref } }
  }
  return { provider }
}

// The run-start block's ring label for a model entry (§6.5): the live
// position by reference name when the rings are active ("1/3 ZHIPU_KEY_A"),
// the declared key count otherwise ("3" — the fleet's shape, not a live
// position), and "0" for an entry without a ring, as the block always did.
export function ringLabel(entry: ModelEntry): string {
  const live = ringsActive() ? rings?.get(entry.provider ?? "") : undefined
  if (live === undefined) return String(entry.keys?.length ?? 0)
  const key = currentKey(entry.provider!)!
  return ringKeyLabel({ ref: key, index: live.indexOf(key), total: live.length })
}

// The startup note for inactive rings (§4.3 limits), or undefined when the
// rings are active, never activated, or the registry declares none.
export function ringInactiveNote(): string | undefined {
  if (rings === undefined || active || rings.size === 0) return undefined
  return (
    "ℹ key rings are inactive: the opencode server is external (--server, OPENCODE_AUTO_SERVER or the agent " +
    "profile's server) and cannot be restarted onto the next key; the tier lines above show declared ring sizes only"
  )
}

// The recovery probe's ring half (§6.3): the probe candidate ignores the
// down marks, the ring and the cap, so an exhausted ring's key marks clear
// for the probe — the position stays where it is — and the key the probe ran
// on is marked down again when the probe fails (markCurrentKeyDown below).
export function clearRingMarks(provider: string): void {
  if (rings?.has(provider) !== true) return
  clearKeyDownMarks(provider)
}

// Marks the ring's current key down without moving the position: what a
// failed recovery probe does to the key it ran on.
export function markCurrentKeyDown(provider: string): void {
  const key = currentKey(provider)
  if (key !== undefined) markKeyDown(provider, key.ref)
}

// Tests reset the module state (one Bun process runs many test files; the
// precedent is resetFailback).
export function resetKeyring(): void {
  rings = undefined
  positions = new Map()
  active = false
}
