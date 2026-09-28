// Key rings (plans/0055 §4.3, §6.4, §7 step 1): the per-provider rings built
// from a registry, the in-memory position that never moves back, the spawn
// config content (references only — no key value ever appears), the
// usable-key predicate of §6.2 rule 4, and the labels the logs show. The
// ring run state lives in the router service; every test reads the fresh
// instance the preload installed.
import { describe, expect, test } from "bun:test"
import { buildRings, ringKeyLabel, type RingRotation } from "../src/keyring"
import type { ModelEntry, ModelReference, ModelRegistry } from "../src/models"
import { createServices, installServices, services } from "../src/services"

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

// The ring state and the key marks both live in the run's router; each test
// reads the fresh instance the preload installed (a mid-test "before
// activation" reinstalls a holder, whose fresh router has no rings).
const router = (): ReturnType<typeof services>["router"] => services().router
const freshRouter = (): ReturnType<typeof services>["router"] => {
  installServices(createServices())
  return services().router
}

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
    router().activateRings(registry(), false)
    expect(router().ringsActive()).toBe(true)
    expect(router().spawnKeyConfig()).toEqual({ provider: { zhipuai: { options: { apiKey: "{env:ZHIPU_KEY_A}" } } } })
  })

  test("a rotated ring changes the apiKey reference; a {file:} key is the absolute path reference", () => {
    router().activateRings(registry(), false)
    const rotation = router().ringRotation("zhipuai", NOW)!
    router().commitRotation(rotation)
    router().commitRotation(router().ringRotation("zhipuai", NOW)!)
    expect(router().spawnKeyConfig()).toEqual({ provider: { zhipuai: { options: { apiKey: "{file:/home/op/.secrets/zhipu-c}" } } } })
  })

  test("inactive rings (external server) and unactivated rings send no config at all", () => {
    router().activateRings(registry(), true)
    expect(router().ringsActive()).toBe(false)
    expect(router().spawnKeyConfig()).toBeUndefined()
    expect(freshRouter().spawnKeyConfig()).toBeUndefined()
  })

  test("no key value ever appears: the config and its JSON hold references only", () => {
    router().activateRings(registry(), false)
    const text = JSON.stringify(router().spawnKeyConfig())
    expect(text).toContain("{env:ZHIPU_KEY_A}")
    // Nothing but the reference syntaxes: no bare secret shape, and both
    // reference kinds round-trip through the spawn config untouched.
    expect(text.match(/\{env:[A-Z_]+\}|\{file:\/[^}]+\}/g)).toEqual(["{env:ZHIPU_KEY_A}"])
  })
})

describe("rotation (§6.4: the position never moves back)", () => {
  const rotate = (provider = "zhipuai"): RingRotation | undefined => {
    const rotation = router().ringRotation(provider, NOW)
    if (rotation) router().commitRotation(rotation)
    return rotation
  }

  test("a failure of the current key advances to the next key that is not down, wrapping", () => {
    router().activateRings(registry(), false)
    expect(rotate()?.to).toMatchObject({ index: 1, total: 3 })
    expect(rotate()?.to).toMatchObject({ index: 2, total: 3 })
    // The current key was marked down by each rotation; the earlier keys are
    // down too, so the ring is exhausted: no rotation lands.
    expect(rotate()).toBeUndefined()
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_C.ref)
  })

  test("a cleared key mark does not move the ring back; the next failure wraps onto the cleared key", () => {
    router().activateRings(registry(), false)
    rotate()
    rotate()
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_C.ref)
    // A scope boundary clears every mark (§6.4)…
    router().clearDownMarks("task", "task")
    expect(router().ringHasUsableKey("zhipuai", NOW)).toBe(true)
    // …but the position stays on key 3: no restart churn.
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_C.ref)
    expect(router().spawnKeyConfig()).toEqual({ provider: { zhipuai: { options: { apiKey: "{file:/home/op/.secrets/zhipu-c}" } } } })
    // Only a failure of the current key moves it — onto key 1, the wrapped
    // next whose mark the boundary cleared.
    expect(rotate()?.to).toMatchObject({ index: 0, total: 3 })
  })

  test("a down key is skipped: rotation lands on the next key that is not down", () => {
    router().activateRings(registry(), false)
    // Key B marked down out-of-band (a classifier's reset time, say): a
    // failure of key A skips straight to key C.
    router().activateRings(registry(), false)
    router().markKeyDown("zhipuai", KEY_B.ref)
    expect(router().ringRotation("zhipuai", NOW)?.to).toMatchObject({ index: 2, total: 3 })
  })

  test("rotation mutates nothing until committed: deciding leaves the marks and the position alone", () => {
    router().activateRings(registry(), false)
    const rotation = router().ringRotation("zhipuai", NOW)
    expect(rotation).toBeDefined()
    expect(router().keyDownMark("zhipuai", KEY_A.ref)).toBeUndefined()
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_A.ref)
    router().commitRotation(rotation!)
    expect(router().isKeyDown("zhipuai", KEY_A.ref, NOW)).toBe(true)
  })

  test("a single-key ring, an unknown provider, inactive rings and unactivated rings never rotate", () => {
    const single = registry([entry("solo", { model: "prov/m", provider: "prov", keys: [envKey("ONLY")] })])
    router().activateRings(single, false)
    expect(router().ringRotation("prov", NOW)).toBeUndefined()
    expect(router().ringRotation("other", NOW)).toBeUndefined()
    router().activateRings(registry(), true)
    expect(router().ringRotation("zhipuai", NOW)).toBeUndefined()
    expect(freshRouter().ringRotation("zhipuai", NOW)).toBeUndefined()
  })
})

describe("the usable-key predicate (§6.2 rule 4)", () => {
  test("a ring with a key that is not down is usable; an exhausted ring is not; cleared marks restore it", () => {
    router().activateRings(registry(), false)
    expect(router().ringHasUsableKey("zhipuai", NOW)).toBe(true)
    for (const key of [KEY_A, KEY_B, KEY_C]) router().markKeyDown("zhipuai", key.ref)
    expect(router().ringHasUsableKey("zhipuai", NOW)).toBe(false)
    router().clearDownMarks("task", "task")
    expect(router().ringHasUsableKey("zhipuai", NOW)).toBe(true)
  })

  test("providers without a ring, inactive rings and unactivated rings are always usable", () => {
    router().activateRings(registry(), false)
    expect(router().ringHasUsableKey("other", NOW)).toBe(true)
    router().activateRings(registry(), true)
    expect(router().ringHasUsableKey("zhipuai", NOW)).toBe(true)
    expect(freshRouter().ringHasUsableKey("zhipuai", NOW)).toBe(true)
  })
})

describe("the recovery probe's ring half (§6.3)", () => {
  test("clearRingMarks clears the provider's key marks without moving the position; markCurrentKeyDown re-marks the key the probe ran on", () => {
    router().activateRings(registry(), false)
    router().commitRotation(router().ringRotation("zhipuai", NOW)!)
    // The current key (B) and the tail (C) both fail: the ring is exhausted.
    router().markKeyDown("zhipuai", KEY_B.ref)
    router().markKeyDown("zhipuai", KEY_C.ref)
    expect(router().ringHasUsableKey("zhipuai", NOW)).toBe(false)
    router().clearRingMarks("zhipuai")
    expect(router().ringHasUsableKey("zhipuai", NOW)).toBe(true)
    expect(router().currentKey("zhipuai")?.ref).toBe(KEY_B.ref)
    router().markCurrentKeyDown("zhipuai")
    expect(router().isKeyDown("zhipuai", KEY_B.ref, NOW)).toBe(true)
    // A provider without a ring and an unknown provider are no-ops.
    expect(() => router().clearRingMarks("other")).not.toThrow()
    expect(() => router().markCurrentKeyDown("other")).not.toThrow()
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
    expect(router().ringLabel(glm)).toBe("3")
    expect(router().ringLabel(plain)).toBe("0")
    router().activateRings(registry(), false)
    expect(router().ringLabel(glm)).toBe("1/3 ZHIPU_KEY_A")
    router().commitRotation(router().ringRotation("zhipuai", NOW)!)
    expect(router().ringLabel(glm)).toBe("2/3 ZHIPU_KEY_B")
    router().activateRings(registry(), true)
    expect(router().ringLabel(glm)).toBe("3")
  })

  test("the inactive note fires only for declared rings under an external server", () => {
    expect(router().ringInactiveNote()).toBeUndefined()
    router().activateRings(registry(), false)
    expect(router().ringInactiveNote()).toBeUndefined()
    router().activateRings(registry(), true)
    expect(router().ringInactiveNote()).toContain("key rings are inactive")
    // A registry without rings has nothing to be inactive about.
    router().activateRings(registry([entry("plain", { model: "other/plain" })]), true)
    expect(router().ringInactiveNote()).toBeUndefined()
  })
})
