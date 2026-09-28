// Key rings (plans/0055 §4.3, §6.4, §7 step 1): the per-provider rings built
// from a registry, the in-memory position that never moves back, the spawn
// config content (references only — no key value ever appears), the
// usable-key predicate of §6.2 rule 4, and the labels the logs show.
import { afterEach, describe, expect, test } from "bun:test"
import {
  activateRings,
  buildRings,
  clearRingMarks,
  commitRotation,
  markCurrentKeyDown,
  currentKey,
  resetKeyring,
  ringHasUsableKey,
  ringInactiveNote,
  ringKeyLabel,
  ringLabel,
  ringRotation,
  ringsActive,
  spawnKeyConfig,
  type RingRotation,
} from "../src/keyring"
import type { ModelEntry, ModelReference, ModelRegistry } from "../src/models"
import { services } from "../src/services"

const envKey = (name: string): ModelReference => ({ kind: "env", name, ref: `{env:${name}}`, label: name })
const fileKey = (path: string, written: string): ModelReference => ({ kind: "file", path, ref: `{file:${path}}`, label: written })

const entry = (name: string, fields: Partial<ModelEntry> = {}): ModelEntry => ({
  name,
  layer: "operator",
  agent: "opencode",
  ...fields,
})

const KEY_A = envKey("ZHIPU_KEY_A")
const KEY_B = envKey("ZHIPU_KEY_B")
const KEY_C = fileKey("/home/op/.secrets/zhipu-c", "~/.secrets/zhipu-c")

// deep: glm (zhipuai, ringed) → k2 (moonshotai, shares the ring by the
// loader's rule); simple: plain (no ring).
const registry = (models?: ModelEntry[]): ModelRegistry => {
  const list =
    models ??
    [
      entry("glm", { model: "zhipuai/glm-4.6", provider: "zhipuai", keys: [KEY_A, KEY_B, KEY_C] }),
      entry("k2", { model: "zhipuai/kimi-k2", provider: "zhipuai", keys: [KEY_A, KEY_B, KEY_C] }),
      entry("plain", { model: "other/plain" }),
    ]
  return {
    layers: [{ name: "operator", path: "/fleet/models.json" }],
    tz: "UTC",
    agents: new Map([["opencode", { name: "opencode", layer: "operator", adapter: "opencode" }]]),
    models: new Map(list.map((item) => [item.name, item])),
    tiers: {},
    routes: new Map(),
    unused: [],
  }
}

const NOW = Date.parse("2026-09-26T12:00:00Z")

// The key marks live in the run's router; each test reads the fresh
// instance the preload installed (the ring state itself resets through
// resetKeyring until it moves into the router too).
const router = (): ReturnType<typeof services>["router"] => services().router

afterEach(() => {
  resetKeyring()
})

describe("buildRings (pure, from the registry)", () => {
  test("one ring per provider in registry order; the first entry on the provider defines it; keyless entries contribute nothing", () => {
    const rings = buildRings(registry())
    expect([...rings.keys()]).toEqual(["zhipuai"])
    expect(rings.get("zhipuai")).toEqual([KEY_A, KEY_B, KEY_C])
    // The ring is a copy: mutating it cannot reach the registry's entries.
    rings.get("zhipuai")!.pop()
    expect(buildRings(registry()).get("zhipuai")).toHaveLength(3)
  })
})

describe("activation and the spawn config (§4.3 injection)", () => {
  test("the managed server's config names each ring's current key as the provider apiKey reference", () => {
    activateRings(registry(), false)
    expect(ringsActive()).toBe(true)
    expect(spawnKeyConfig()).toEqual({ provider: { zhipuai: { options: { apiKey: "{env:ZHIPU_KEY_A}" } } } })
  })

  test("a rotated ring changes the apiKey reference; a {file:} key is the absolute path reference", () => {
    activateRings(registry(), false)
    const rotation = ringRotation(router(), "zhipuai", NOW)!
    commitRotation(router(), rotation)
    commitRotation(router(), ringRotation(router(), "zhipuai", NOW)!)
    expect(spawnKeyConfig()).toEqual({ provider: { zhipuai: { options: { apiKey: "{file:/home/op/.secrets/zhipu-c}" } } } })
  })

  test("inactive rings (external server) and unactivated rings send no config at all", () => {
    activateRings(registry(), true)
    expect(ringsActive()).toBe(false)
    expect(spawnKeyConfig()).toBeUndefined()
    resetKeyring()
    expect(spawnKeyConfig()).toBeUndefined()
  })

  test("no key value ever appears: the config and its JSON hold references only", () => {
    activateRings(registry(), false)
    const text = JSON.stringify(spawnKeyConfig())
    expect(text).toContain("{env:ZHIPU_KEY_A}")
    // Nothing but the reference syntaxes: no bare secret shape, and both
    // reference kinds round-trip through the spawn config untouched.
    expect(text.match(/\{env:[A-Z_]+\}|\{file:\/[^}]+\}/g)).toEqual(["{env:ZHIPU_KEY_A}"])
  })
})

describe("rotation (§6.4: the position never moves back)", () => {
  const rotate = (provider = "zhipuai"): RingRotation | undefined => {
    const rotation = ringRotation(router(), provider, NOW)
    if (rotation) commitRotation(router(), rotation)
    return rotation
  }

  test("a failure of the current key advances to the next key that is not down, wrapping", () => {
    activateRings(registry(), false)
    expect(rotate()?.to).toMatchObject({ index: 1, total: 3 })
    expect(rotate()?.to).toMatchObject({ index: 2, total: 3 })
    // The current key was marked down by each rotation; the earlier keys are
    // down too, so the ring is exhausted: no rotation lands.
    expect(rotate()).toBeUndefined()
    expect(currentKey("zhipuai")?.ref).toBe(KEY_C.ref)
  })

  test("a cleared key mark does not move the ring back; the next failure wraps onto the cleared key", () => {
    activateRings(registry(), false)
    rotate()
    rotate()
    expect(currentKey("zhipuai")?.ref).toBe(KEY_C.ref)
    // A scope boundary clears every mark (§6.4)…
    router().clearDownMarks("task", "task")
    expect(ringHasUsableKey(router(), "zhipuai", NOW)).toBe(true)
    // …but the position stays on key 3: no restart churn.
    expect(currentKey("zhipuai")?.ref).toBe(KEY_C.ref)
    expect(spawnKeyConfig()).toEqual({ provider: { zhipuai: { options: { apiKey: "{file:/home/op/.secrets/zhipu-c}" } } } })
    // Only a failure of the current key moves it — onto key 1, the wrapped
    // next whose mark the boundary cleared.
    expect(rotate()?.to).toMatchObject({ index: 0, total: 3 })
  })

  test("a down key is skipped: rotation lands on the next key that is not down", () => {
    activateRings(registry(), false)
    // Key B marked down out-of-band (a classifier's reset time, say): a
    // failure of key A skips straight to key C.
    activateRings(registry(), false)
    router().markKeyDown("zhipuai", KEY_B.ref)
    expect(ringRotation(router(), "zhipuai", NOW)?.to).toMatchObject({ index: 2, total: 3 })
  })

  test("rotation mutates nothing until committed: deciding leaves the marks and the position alone", () => {
    activateRings(registry(), false)
    const rotation = ringRotation(router(), "zhipuai", NOW)
    expect(rotation).toBeDefined()
    expect(router().keyDownMark("zhipuai", KEY_A.ref)).toBeUndefined()
    expect(currentKey("zhipuai")?.ref).toBe(KEY_A.ref)
    commitRotation(router(), rotation!)
    expect(router().isKeyDown("zhipuai", KEY_A.ref, NOW)).toBe(true)
  })

  test("a single-key ring, an unknown provider, inactive rings and unactivated rings never rotate", () => {
    const single = registry([entry("solo", { model: "prov/m", provider: "prov", keys: [envKey("ONLY")] })])
    activateRings(single, false)
    expect(ringRotation(router(), "prov", NOW)).toBeUndefined()
    expect(ringRotation(router(), "other", NOW)).toBeUndefined()
    activateRings(registry(), true)
    expect(ringRotation(router(), "zhipuai", NOW)).toBeUndefined()
    resetKeyring()
    expect(ringRotation(router(), "zhipuai", NOW)).toBeUndefined()
  })
})

describe("the usable-key predicate (§6.2 rule 4)", () => {
  test("a ring with a key that is not down is usable; an exhausted ring is not; cleared marks restore it", () => {
    activateRings(registry(), false)
    expect(ringHasUsableKey(router(), "zhipuai", NOW)).toBe(true)
    for (const key of [KEY_A, KEY_B, KEY_C]) router().markKeyDown("zhipuai", key.ref)
    expect(ringHasUsableKey(router(), "zhipuai", NOW)).toBe(false)
    router().clearDownMarks("task", "task")
    expect(ringHasUsableKey(router(), "zhipuai", NOW)).toBe(true)
  })

  test("providers without a ring, inactive rings and unactivated rings are always usable", () => {
    activateRings(registry(), false)
    expect(ringHasUsableKey(router(), "other", NOW)).toBe(true)
    activateRings(registry(), true)
    expect(ringHasUsableKey(router(), "zhipuai", NOW)).toBe(true)
    resetKeyring()
    expect(ringHasUsableKey(router(), "zhipuai", NOW)).toBe(true)
  })
})

describe("the recovery probe's ring half (§6.3)", () => {
  test("clearRingMarks clears the provider's key marks without moving the position; markCurrentKeyDown re-marks the key the probe ran on", () => {
    activateRings(registry(), false)
    commitRotation(router(), ringRotation(router(), "zhipuai", NOW)!)
    // The current key (B) and the tail (C) both fail: the ring is exhausted.
    router().markKeyDown("zhipuai", KEY_B.ref)
    router().markKeyDown("zhipuai", KEY_C.ref)
    expect(ringHasUsableKey(router(), "zhipuai", NOW)).toBe(false)
    clearRingMarks(router(), "zhipuai")
    expect(ringHasUsableKey(router(), "zhipuai", NOW)).toBe(true)
    expect(currentKey("zhipuai")?.ref).toBe(KEY_B.ref)
    markCurrentKeyDown(router(), "zhipuai")
    expect(router().isKeyDown("zhipuai", KEY_B.ref, NOW)).toBe(true)
    // A provider without a ring and an unknown provider are no-ops.
    expect(() => clearRingMarks(router(), "other")).not.toThrow()
    expect(() => markCurrentKeyDown(router(), "other")).not.toThrow()
  })
})

describe("labels and the startup note (§6.5, §4.3 limits)", () => {
  test("ringKeyLabel names the position and the reference, never a value", () => {
    expect(ringKeyLabel({ ref: KEY_B, index: 1, total: 3 })).toBe("2/3 ZHIPU_KEY_B")
    expect(ringKeyLabel({ ref: KEY_C, index: 2, total: 3 })).toBe("3/3 ~/.secrets/zhipu-c")
  })

  test("ringLabel: the live position while active, the declared count before activation and under an external server", () => {
    const glm = registry().models.get("glm")!
    const plain = registry().models.get("plain")!
    expect(ringLabel(glm)).toBe("3")
    expect(ringLabel(plain)).toBe("0")
    activateRings(registry(), false)
    expect(ringLabel(glm)).toBe("1/3 ZHIPU_KEY_A")
    commitRotation(router(), ringRotation(router(), "zhipuai", NOW)!)
    expect(ringLabel(glm)).toBe("2/3 ZHIPU_KEY_B")
    activateRings(registry(), true)
    expect(ringLabel(glm)).toBe("3")
  })

  test("the inactive note fires only for declared rings under an external server", () => {
    expect(ringInactiveNote()).toBeUndefined()
    activateRings(registry(), false)
    expect(ringInactiveNote()).toBeUndefined()
    activateRings(registry(), true)
    expect(ringInactiveNote()).toContain("key rings are inactive")
    // A registry without rings has nothing to be inactive about.
    activateRings(registry([entry("plain", { model: "other/plain" })]), true)
    expect(ringInactiveNote()).toBeUndefined()
  })
})
